const crypto = require('crypto');
const { pool } = require('../db/pool');
const settings = require('./settings');
const auth = require('./auth');
const audit = require('./audit');
const mailer = require('./mailer');

// "Forgot your password?" by email. A person asks for a link; the link carries a random token that works once and expires.
// Only the SHA-256 of the token is stored, so a copy of the database cannot be used to reset anyone's password.
// Rules that matter:
//  - The answer to "send me a link" is always the same, whether or not the address belongs to an account (no way to learn who has one).
//  - The link's address comes from the "web address" setting, never from the request's Host header, so a forged request cannot make the
//    email point at another site.
//  - A reset signs the person out everywhere, and a notice goes to the mailbox.
const TOKEN_FORMAT = /^[a-f0-9]{64}$/;
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

const available = () => settings.flag('password_reset_enabled') && mailer.isConfigured();

function publicUrl() {
  const configured = settings.str('public_url').replace(/\/+$/, '');
  return configured || `http://localhost:${process.env.PORT || 7780}`;
}

// ── Limits (in memory: a restart only ever helps a person who is being limited) ──
const perHour = new Map(); // ip -> [timestamps]
function hourlyLimitHit(ip) {
  const now = Date.now();
  const recent = (perHour.get(ip) || []).filter(t => now - t < 3600000);
  if (recent.length >= settings.num('password_reset_ip_per_hour')) { perHour.set(ip, recent); return true; }
  recent.push(now);
  perHour.set(ip, recent);
  if (perHour.size > 20000) perHour.clear();
  return false;
}
// Wrong or expired links: the same per-address limit as sign-in (Admin > Settings > Security > Sign-in lockout), then a pause.
// A token is 256 random bits, so guessing one is hopeless; this only stops a flood.
const badToken = new auth.Throttle(() => settings.num('ip_max_attempts'), () => settings.num('ip_lock_minutes') * 60 * 1000);
setInterval(() => badToken.prune(), 5 * 60 * 1000).unref();
const lockedFor = ip => badToken.lockedFor(ip);

// Sends a link if the address belongs to an active account. Never throws to the caller and never reveals what it found.
async function request(req, email) {
  const ip = audit.clientIp(req) || 'unknown';
  const [[user]] = await pool.query('SELECT id, name, email, active FROM users WHERE email = ?', [email]);
  if (!user || !user.active) {
    await audit.record(req, 'password_reset_requested', { target: email, detail: user ? 'Account is disabled: no email sent' : 'No such account: no email sent', user: { id: user?.id ?? null, email } });
    return;
  }
  const gap = settings.num('password_reset_gap_minutes');
  if (gap > 0) {
    const [[recent]] = await pool.query('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)', [user.id, gap]);
    if (recent.n) {
      await audit.record(req, 'password_reset_requested', { target: email, detail: `A link was already sent in the last ${gap} minutes: no new email`, user: { id: user.id, email } });
      return;
    }
  }
  const token = crypto.randomBytes(32).toString('hex');
  const minutes = settings.num('password_reset_minutes');
  // A new link replaces any earlier unused one.
  await pool.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [user.id]);
  await pool.query('INSERT INTO password_resets (token_hash, user_id, expires_at, ip) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)', [hashToken(token), user.id, minutes, ip]);
  try {
    await mailer.sendPasswordResetEmail({ to: user.email, name: user.name, url: `${publicUrl()}/reset-password?token=${token}`, minutes });
    await audit.record(req, 'password_reset_requested', { target: email, detail: 'Reset link emailed', user: { id: user.id, email } });
  } catch (error) {
    console.error('Password reset email failed:', error.message);
    await pool.query('DELETE FROM password_resets WHERE token_hash = ?', [hashToken(token)]);
    await audit.record(req, 'password_reset_requested', { target: email, detail: `Email could not be sent: ${String(error.message).slice(0, 200)}`, user: { id: user.id, email } });
  }
}

// The account a still-valid link belongs to, or null.
async function lookup(token) {
  if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) return null;
  const [[row]] = await pool.query(
    `SELECT r.token_hash, u.id, u.name, u.email FROM password_resets r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > NOW() AND u.active = 1`, [hashToken(token)]);
  return row || null;
}

// Result: { ok: true } or { status, message }.
async function complete(req, token, password) {
  const ip = audit.clientIp(req) || 'unknown';
  const wait = lockedFor(ip);
  if (wait) return { status: 429, message: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.`, retry: wait };
  const row = await lookup(token);
  if (!row) {
    badToken.fail(ip);
    await audit.record(req, 'password_reset_failed', { detail: 'Invalid, used or expired reset link' });
    return { status: 400, message: 'This reset link is not valid any more. Ask for a new one.', code: 'LINK_INVALID' };
  }
  const problem = auth.passwordProblem(password, { email: row.email });
  if (problem) return { status: 400, message: problem, code: 'WEAK_PASSWORD' };

  // Using the link and changing the password happen together; the link can be used only once even if two requests arrive at the same moment.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [used] = await conn.query('UPDATE password_resets SET used_at = NOW() WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()', [row.token_hash]);
    if (used.affectedRows !== 1) { await conn.rollback(); return { status: 400, message: 'This reset link is not valid any more. Ask for a new one.', code: 'LINK_INVALID' }; }
    await conn.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [row.id]);
    await conn.query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [await auth.hashPassword(password), row.id]);
    await conn.query('DELETE FROM sessions WHERE user_id = ?', [row.id]);
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
  auth.clearFailures(row.email, ip);
  badToken.clear(ip);
  await audit.record(req, 'password_reset_completed', { target: row.email, detail: 'Password set with an emailed link; signed out everywhere', user: { id: row.id, email: row.email } });
  if (mailer.isConfigured()) {
    mailer.sendPasswordChangedEmail({ to: row.email, name: row.name, when: new Date().toLocaleString() }).catch(error => console.error('Password-changed notice failed:', error.message));
  }
  return { ok: true };
}

const purgeOld = () => pool.query('DELETE FROM password_resets WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY)');

module.exports = { available, request, lookup, complete, hourlyLimitHit, lockedFor, purgeOld, publicUrl, badToken };
