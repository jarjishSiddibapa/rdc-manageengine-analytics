const crypto = require('crypto');
const { promisify } = require('util');
const { pool } = require('../db/pool');
const audit = require('./audit');
const settings = require('./settings');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'mea_session';
// Limits are settings (Admin -> Settings -> Security), read each time they are used so a change applies to the next request:
//   session_idle_hours   sliding: renewed while the person keeps working (default 12)
//   session_max_days     absolute: nobody stays signed in longer than this, however active (default 7)
const sessionHours = () => settings.num('session_idle_hours');
const sessionMaxDays = () => settings.num('session_max_days');
// admin: everything. manager: analytics + running syncs. viewer: analytics only.
const ROLES = ['admin', 'manager', 'viewer'];
const MAX_PASSWORD = 200; // a technical limit, not a policy: nobody types a longer one, and hashing is bounded by it

// ── Passwords: scrypt with a random salt per password ──
// Stored as scrypt$N,r,p$salt$key. Older rows (scrypt$salt$key, N=16384) still verify and are upgraded at the next successful sign-in.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
const LEGACY = { N: 16384, r: 8, p: 1 };
const scryptOptions = ({ N, r, p }) => ({ N, r, p, maxmem: 160 * N * r });

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, SCRYPT.keylen, scryptOptions(SCRYPT));
  return `scrypt$${SCRYPT.N},${SCRYPT.r},${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function parseHash(stored) {
  const parts = String(stored || '').split('$');
  if (parts[0] !== 'scrypt') return null;
  if (parts.length === 3) return { params: LEGACY, salt: parts[1], key: parts[2] };
  if (parts.length === 4) {
    const [N, r, p] = parts[1].split(',').map(Number);
    if (![N, r, p].every(Number.isInteger) || N < 1024 || N > 1 << 20 || (N & (N - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 16) return null;
    return { params: { N, r, p }, salt: parts[2], key: parts[3] };
  }
  return null;
}

async function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed || !parsed.salt || !parsed.key) return false;
  const expected = Buffer.from(parsed.key, 'base64');
  if (!expected.length) return false;
  const actual = await scrypt(String(password), Buffer.from(parsed.salt, 'base64'), expected.length, scryptOptions(parsed.params));
  return crypto.timingSafeEqual(actual, expected);
}

const needsRehash = stored => {
  const parsed = parseHash(stored);
  return !!parsed && (parsed.params.N !== SCRYPT.N || parsed.params.r !== SCRYPT.r || parsed.params.p !== SCRYPT.p);
};

// A real hash at the current cost to compare against when the email is unknown, so "no such user" takes as long as "wrong password".
const dummyHash = hashPassword(crypto.randomBytes(16).toString('hex'));
const getDummyHash = () => dummyHash;

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', '12345678', '123456789', '1234567890', '11111111', 'qwertyui', 'qwerty123',
  'iloveyou', 'admin123', 'administrator', 'welcome1', 'welcome123', 'letmein1', 'abc12345', 'changeme', 'changeme1', 'passw0rd', 'p@ssw0rd', 'p@ssword',
]);

// The password rules an administrator has set (also sent to the screens so they can check as people type).
const passwordPolicy = () => ({
  min_length: settings.num('password_min_length'),
  max_length: MAX_PASSWORD,
  mixed_case: settings.flag('password_require_mixed_case'),
  digit: settings.flag('password_require_digit'),
  symbol: settings.flag('password_require_symbol'),
  block_common: settings.flag('password_block_common'),
});

function passwordProblem(password, { email } = {}) {
  const p = String(password || '');
  const policy = passwordPolicy();
  if (p.length < policy.min_length) return `Password must be at least ${policy.min_length} characters`;
  if (p.length > MAX_PASSWORD) return 'Password is too long';
  if (/^(.)\1+$/.test(p)) return 'Choose a password that is not one repeated character';
  if (policy.mixed_case && !(/[a-z]/.test(p) && /[A-Z]/.test(p))) return 'Use both upper and lower case letters';
  if (policy.digit && !/\d/.test(p)) return 'Include at least one number';
  if (policy.symbol && !/[^A-Za-z0-9]/.test(p)) return 'Include at least one symbol, such as ! # or $';
  if (policy.block_common && COMMON_PASSWORDS.has(p.toLowerCase())) return 'That password is too common. Choose a less guessable one';
  if (policy.block_common && email && p.toLowerCase() === String(email).toLowerCase()) return 'The password cannot be the same as the email address';
  return null;
}

const generatePassword = () => `${crypto.randomBytes(9).toString('base64url')}!1`;

// ── Sessions: a random token in an HttpOnly cookie; only its SHA-256 is stored, so a database leak cannot be replayed ──
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function parseCookies(header) {
  const out = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const value = part.slice(i + 1).trim();
    try { out[part.slice(0, i).trim()] = decodeURIComponent(value); } catch { /* a malformed cookie is simply ignored */ }
  }
  return out;
}

const sessionToken = req => parseCookies(req.headers.cookie)[COOKIE] || null;
const sessionHashOf = req => { const token = sessionToken(req); return token ? sha(token) : ''; };

const cookieFlags = secure => `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
const isSecure = req => req.secure || req.headers['x-forwarded-proto'] === 'https';

function setSessionCookie(res, token, secure) {
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; ${cookieFlags(secure)}; Max-Age=${sessionHours() * 3600}`);
}

function clearSessionCookie(res, req) {
  res.append('Set-Cookie', `${COOKIE}=; ${cookieFlags(req ? isSecure(req) : false)}; Max-Age=0`);
}

async function createSession(req, res, userId) {
  // A fresh token on every sign-in (never reuse one the browser already holds), and the old one is retired.
  const old = sessionHashOf(req);
  if (old) await pool.query('DELETE FROM sessions WHERE token_hash = ?', [old]);
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?, ?)',
    [sha(token), userId, sessionHours(), audit.clientIp(req), String(req.headers['user-agent'] || '').slice(0, 255)],
  );
  setSessionCookie(res, token, isSecure(req));
}

async function destroySession(req) {
  const hash = sessionHashOf(req);
  if (hash) await pool.query('DELETE FROM sessions WHERE token_hash = ?', [hash]);
}

const purgeExpiredSessions = () => pool.query('DELETE FROM sessions WHERE expires_at < NOW() OR created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [sessionMaxDays()]);

const publicUser = u => ({
  id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active,
  must_change_password: !!u.must_change_password, last_login_at: u.last_login_at || null, created_at: u.created_at || null,
});

// Reads the cookie and attaches req.user (or leaves it unset). The session slides forward while it is in use.
async function attachUser(req, _res, next) {
  try {
    const hash = sessionHashOf(req);
    if (!hash) return next();
    const [rows] = await pool.query(
      `SELECT u.*, TIMESTAMPDIFF(MINUTE, s.last_seen_at, NOW()) AS idle_minutes
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > NOW() AND s.created_at > DATE_SUB(NOW(), INTERVAL ? DAY) AND u.active = 1`,
      [hash, sessionMaxDays()],
    );
    if (rows[0]) {
      req.user = publicUser(rows[0]);
      if (rows[0].idle_minutes >= 5) {
        await pool.query('UPDATE sessions SET last_seen_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR) WHERE token_hash = ?', [sessionHours(), hash]);
      }
    }
    next();
  } catch (error) { next(error); }
}

// Every route behind this needs a signed-in user. A user who must pick a new password can do nothing else first.
const ALLOWED_WHILE_CHANGING = new Set(['/auth/me', '/auth/logout', '/auth/change-password']);
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Please sign in', code: 'UNAUTHENTICATED' });
  if (req.user.must_change_password && !ALLOWED_WHILE_CHANGING.has(req.path)) {
    return res.status(403).json({ message: 'You must choose a new password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
}

const requireRole = (...roles) => (req, res, next) => {
  if (roles.includes(req.user?.role)) return next();
  if (req.user) audit.record(req, 'access_denied', { target: `${req.method} ${req.baseUrl}${req.path}`.slice(0, 255), detail: `Role ${req.user.role} needs ${roles.join(' or ')}` });
  return res.status(403).json({ message: 'You do not have permission to do that', code: 'FORBIDDEN' });
};

// A cookie alone would let another website post to this API from a signed-in browser. Requiring a custom header closes that
// (a browser cannot add it to a cross-site request without a CORS preflight, which this server never approves).
function requireSameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'ManageEngineAnalytics') return res.status(403).json({ message: 'Blocked request', code: 'BAD_ORIGIN' });
  next();
}

// ── Throttling: wrong passwords lock that email + address (and, more loosely, the address alone) for 15 minutes ──
// In memory on purpose: a restart clears it, which only ever helps a locked-out person.
// `max` and `lockMs` are functions, so the limits (settings) apply as soon as they are changed.
class Throttle {
  constructor(max, lockMs) { this.maxOf = max; this.lockMsOf = lockMs; this.map = new Map(); }
  get max() { return this.maxOf(); }
  get lockMs() { return this.lockMsOf(); }
  lockedFor(key) {
    const entry = this.map.get(key);
    if (!entry || entry.until <= Date.now()) return 0;
    return Math.ceil((entry.until - Date.now()) / 1000);
  }
  fail(key) {
    const entry = this.map.get(key) || { count: 0, until: 0, last: 0 };
    if (entry.until && entry.until <= Date.now()) { entry.count = 0; entry.until = 0; }
    entry.count += 1;
    entry.last = Date.now();
    if (entry.count >= this.max) entry.until = Date.now() + this.lockMs;
    this.map.set(key, entry);
    return entry.until > Date.now();
  }
  clear(key) { this.map.delete(key); }
  prune() {
    const cutoff = Date.now() - this.lockMs;
    for (const [key, entry] of this.map) if (entry.until <= Date.now() && entry.last < cutoff) this.map.delete(key);
    // Hard ceiling so a flood of made-up emails cannot grow the map without bound.
    if (this.map.size > 20000) this.map.clear();
  }
}

const accountMax = () => settings.num('login_max_attempts');
const accountLockMs = () => settings.num('login_lock_minutes') * 60 * 1000;
const loginThrottle = new Throttle(accountMax, accountLockMs); // email|ip
const ipThrottle = new Throttle(() => settings.num('ip_max_attempts'), () => settings.num('ip_lock_minutes') * 60 * 1000); // one address trying many emails
const passwordChangeThrottle = new Throttle(accountMax, accountLockMs); // guessing the current password through "change password"
setInterval(() => { loginThrottle.prune(); ipThrottle.prune(); passwordChangeThrottle.prune(); }, 5 * 60 * 1000).unref();

const lockoutPolicy = () => ({ attempts: settings.num('login_max_attempts'), minutes: settings.num('login_lock_minutes') });
const loginKey = (email, ip) => `${String(email).toLowerCase()}|${ip}`;
// Seconds left on a lock (0 = not locked).
const lockedFor = (email, ip) => Math.max(loginThrottle.lockedFor(loginKey(email, ip)), ipThrottle.lockedFor(ip));
function noteFailure(email, ip) {
  const locked = loginThrottle.fail(loginKey(email, ip));
  ipThrottle.fail(ip);
  return locked;
}
const clearFailures = (email, ip) => loginThrottle.clear(loginKey(email, ip));

// First run: create the administrator. Does nothing once any user exists.
// With no ADMIN_PASSWORD in .env a random one is generated, shown once on this console, and must be changed at first sign-in.
async function seedAdmin() {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM users');
  if (n > 0) return null;
  const email = String(process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
  const configured = process.env.ADMIN_PASSWORD;
  const password = configured || generatePassword();
  const name = process.env.ADMIN_NAME || 'Administrator';
  await pool.query(
    "INSERT INTO users (name, email, password_hash, role, active, must_change_password) VALUES (?, ?, ?, 'admin', 1, ?)",
    [name, email, await hashPassword(password), configured ? 0 : 1],
  );
  console.log(`Created the first administrator: ${email}`);
  if (!configured) console.log(`  Temporary password (shown once, you must change it at first sign-in): ${password}`);
  return email;
}

module.exports = {
  ROLES, hashPassword, verifyPassword, needsRehash, getDummyHash, passwordProblem, generatePassword, createSession, destroySession, purgeExpiredSessions,
  publicUser, parseCookies, sessionHashOf, attachUser, requireAuth, requireRole, requireSameOrigin, lockedFor, noteFailure, clearFailures,
  passwordChangeThrottle, Throttle, loginThrottle, loginKey, seedAdmin, clearSessionCookie, sessionHours, sessionMaxDays, passwordPolicy, lockoutPolicy,
};
