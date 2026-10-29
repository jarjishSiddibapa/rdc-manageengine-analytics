const { pool } = require('../db/pool');
const secrets = require('./secrets');

// The two outside connections an administrator can set up on Admin -> Connections: ManageEngine (OAuth) and outgoing email (SMTP).
//
//   * A value saved here (in the `settings` table, key "conn_<name>") overrides backend\.env; a blank one falls back to backend\.env,
//     so an install configured only through .env keeps working untouched.
//   * Secrets (client secret, refresh token, mail password) are stored ENCRYPTED (AES-256-GCM, key in backend\.secret), are never sent
//     to the browser (only whether one is set) and never written to the activity log.
//   * Everything here is read at the moment it is used, so a change takes effect at once, without a restart.
const FIELDS = [
  // ManageEngine
  { key: 'me_accounts_url', group: 'manageengine', label: 'Accounts server (OAuth)', env: 'MANAGEENGINE_ACCOUNTS_URL', default: 'https://accounts.zoho.com', type: 'url',
    help: 'Where tokens are requested, for example https://accounts.zoho.com (.eu, .in, .com.au... for other data centres).' },
  { key: 'me_api_domain', group: 'manageengine', label: 'API domain', env: 'MANAGEENGINE_API_DOMAIN', default: '', type: 'url', help: 'For example https://sdpondemand.manageengine.com' },
  { key: 'me_portal', group: 'manageengine', label: 'Portal name', env: 'MANAGEENGINE_PORTAL', default: '', type: 'text', max: 120, help: 'The portal in your ServiceDesk Plus address. Leave blank if your portal has none.' },
  { key: 'me_client_id', group: 'manageengine', label: 'Client ID', env: 'MANAGEENGINE_CLIENT_ID', default: '', type: 'text', max: 200, help: 'From the Zoho API console.' },
  { key: 'me_client_secret', group: 'manageengine', label: 'Client secret', env: 'MANAGEENGINE_CLIENT_SECRET', default: '', type: 'text', max: 400, secret: true, help: 'Stored encrypted. Never shown again.' },
  { key: 'me_refresh_token', group: 'manageengine', label: 'Refresh token', env: 'MANAGEENGINE_REFRESH_TOKEN', default: '', type: 'text', max: 400, secret: true, help: 'Needs the SDPOnDemand.requests.READ scope. Stored encrypted. Never shown again.' },
  // Email
  { key: 'smtp_host', group: 'smtp', label: 'Server', env: 'SMTP_HOST', default: 'smtp.gmail.com', type: 'host', help: 'For example smtp.gmail.com or your own mail server.' },
  { key: 'smtp_port', group: 'smtp', label: 'Port', env: 'SMTP_PORT', default: '587', type: 'port', help: '587 (STARTTLS) or 465 (SSL) are the usual ones.' },
  { key: 'smtp_secure', group: 'smtp', label: 'Encryption', env: 'SMTP_SECURE', default: '', type: 'secure', help: 'Automatic uses SSL on port 465 and STARTTLS otherwise.' },
  { key: 'smtp_user', group: 'smtp', label: 'User name', env: 'SMTP_USER', default: '', type: 'text', max: 190, help: 'Usually the full email address of the mailbox that sends.' },
  { key: 'smtp_pass', group: 'smtp', label: 'Password', env: 'SMTP_PASS', default: '', type: 'text', max: 400, secret: true, help: 'For Gmail use an "App password". Stored encrypted. Never shown again.' },
  { key: 'smtp_from_name', group: 'smtp', label: 'Sender name', env: null, default: '', type: 'text', max: 100, help: 'Blank uses the application name.' },
  { key: 'smtp_from_address', group: 'smtp', label: 'Sender address', env: null, default: '', type: 'emailish', max: 190, help: 'Blank uses the user name (or SMTP_FROM in backend\\.env).' },
];
const BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f]));
const ROW = key => `conn_${key}`;

class ConnectionError extends Error {
  constructor(message, field = null) { super(message); this.field = field; }
}

const trimSlash = value => String(value || '').trim().replace(/\/+$/, '');
const envValue = field => (field.env && process.env[field.env] !== undefined ? String(process.env[field.env]).trim() : '');

// What is stored for a field, and where the value in force comes from. `stored` holds the decrypted DB values.
function resolve(stored = {}, unreadable = new Set()) {
  const values = {};
  const source = {};
  for (const field of FIELDS) {
    const own = stored[field.key];
    if (own) { values[field.key] = own; source[field.key] = 'db'; continue; }
    const fromEnv = envValue(field);
    if (fromEnv) { values[field.key] = fromEnv; source[field.key] = 'env'; continue; }
    values[field.key] = field.default;
    source[field.key] = field.default ? 'default' : 'none';
  }
  return { values, source, unreadable };
}

let state = resolve();
let loadedAt = 0;
let loading = null;
const listeners = new Set();
const TTL_MS = 15 * 1000;

async function load() {
  if (loading) return loading;
  loading = (async () => {
    const [rows] = await pool.query("SELECT k, v FROM settings WHERE k LIKE 'conn\\_%'");
    const stored = {};
    const unreadable = new Set();
    for (const row of rows) {
      const key = row.k.slice(5);
      const field = BY_KEY[key];
      if (!field || !row.v) continue;
      if (field.secret) {
        try { stored[key] = secrets.decrypt(row.v); } catch { unreadable.add(key); }
      } else stored[key] = row.v;
    }
    const before = state;
    state = resolve(stored, unreadable);
    loadedAt = Date.now();
    if (JSON.stringify(before.values) !== JSON.stringify(state.values)) for (const l of listeners) { try { l(); } catch { /* listeners must not break loading */ } }
    return state;
  })().finally(() => { loading = null; });
  return loading;
}

// Loaded at least once and not stale: await this before using a connection from a background job or the command line.
async function ready() {
  if (!loadedAt || Date.now() - loadedAt > TTL_MS) await load();
  return state;
}

const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

// Re-reads now and then, so a change made through another copy of the app (same database) is picked up.
let refreshTimer = null;
function startRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => { load().catch(() => {}); }, 30 * 1000);
  refreshTimer.unref?.();
}

// ── The values other modules use (synchronous: they read the last loaded state) ──
function manageEngine(overrides = {}) {
  const v = { ...state.values, ...overrides };
  return {
    accountsUrl: trimSlash(v.me_accounts_url || 'https://accounts.zoho.com'),
    apiDomain: trimSlash(v.me_api_domain),
    portal: String(v.me_portal || '').trim(),
    clientId: String(v.me_client_id || '').trim(),
    clientSecret: String(v.me_client_secret || '').trim(),
    refreshToken: String(v.me_refresh_token || '').trim(),
  };
}

function smtp(overrides = {}, appName = 'ManageEngine Analytics') {
  const v = { ...state.values, ...overrides };
  const port = Number(v.smtp_port) || 587;
  const secureRaw = String(v.smtp_secure ?? '').trim().toLowerCase();
  const secure = secureRaw ? ['1', 'true'].includes(secureRaw) : port === 465;
  const user = String(v.smtp_user || '').trim();
  const address = String(v.smtp_from_address || '').trim();
  const name = String(v.smtp_from_name || '').trim() || appName;
  let from;
  if (address) from = `"${name.replace(/"/g, '')}" <${address}>`;
  else if (process.env.SMTP_FROM && state.source.smtp_from_name !== 'db') from = process.env.SMTP_FROM;
  else from = `"${name.replace(/"/g, '')}" <${user}>`;
  return { host: String(v.smtp_host || 'smtp.gmail.com').trim(), port, secure, user, pass: String(v.smtp_pass || ''), from };
}

// ── Validation and saving ──
function cleanValue(field, raw) {
  const fail = message => { throw new ConnectionError(`${field.label}: ${message}`, field.key); };
  if (typeof raw !== 'string') fail('must be text');
  const value = raw.trim();
  if (/[\r\n\0]/.test(value)) fail('cannot contain line breaks');
  switch (field.type) {
    case 'url': {
      if (!value) return '';
      let url;
      try { url = new URL(value); } catch { return fail('must be a web address starting with https://'); }
      if (!['https:', 'http:'].includes(url.protocol)) fail('must be a web address starting with https://');
      return trimSlash(value).slice(0, 300);
    }
    case 'host':
      if (value && !/^[A-Za-z0-9._-]{1,253}$/.test(value)) fail('must be a server name such as smtp.gmail.com');
      return value;
    case 'port': {
      if (!value) return '';
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 65535) fail('must be a port number from 1 to 65535');
      return String(n);
    }
    case 'secure':
      if (!['', '0', '1', 'true', 'false'].includes(value.toLowerCase())) fail('choose automatic, SSL or STARTTLS');
      return value === 'true' ? '1' : value === 'false' ? '0' : value;
    case 'emailish':
      if (value && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(value)) fail('must be an email address');
      return value;
    default:
      if (value.length > field.max) fail(`at most ${field.max} characters`);
      return value;
  }
}

// patch: { key: value }. Non-secret: '' or null removes the saved value (back to backend\.env). Secret: a non-blank string sets it,
// null removes it, blank/undefined leaves it alone. Returns the names of the fields that changed (never their values).
async function update(patch) {
  const writes = [];
  for (const [key, raw] of Object.entries(patch || {})) {
    const field = BY_KEY[key];
    if (!field) throw new ConnectionError(`Unknown field "${key}"`, key);
    if (raw === undefined) continue;
    if (raw === null) { writes.push({ key, remove: true }); continue; }
    if (field.secret) {
      if (typeof raw !== 'string') throw new ConnectionError(`${field.label}: must be text`, key);
      if (raw.trim() === '') continue;
      if (raw.trim().length > field.max) throw new ConnectionError(`${field.label}: at most ${field.max} characters`, key);
      if (/[\r\n\0]/.test(raw.trim())) throw new ConnectionError(`${field.label}: cannot contain line breaks`, key);
      writes.push({ key, value: secrets.encrypt(raw.trim()), secretValue: raw.trim() });
    } else {
      const value = cleanValue(field, raw);
      if (value === '') writes.push({ key, remove: true }); else writes.push({ key, value });
    }
  }
  const [rows] = await pool.query("SELECT k, v FROM settings WHERE k LIKE 'conn\\_%'");
  const had = new Map(rows.map(r => [r.k.slice(5), r.v]));
  const changed = [];
  for (const w of writes) {
    if (w.remove) {
      if (had.has(w.key)) { await pool.query('DELETE FROM settings WHERE k = ?', [ROW(w.key)]); changed.push(w.key); }
      continue;
    }
    const field = BY_KEY[w.key];
    // An unchanged non-secret value is not a change; a secret always is (it cannot be compared, and a new value was typed).
    if (!field.secret && had.get(w.key) === w.value) continue;
    await pool.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [ROW(w.key), w.value]);
    changed.push(w.key);
  }
  await load();
  return changed;
}

// The values as they would be if `patch` were saved - for "Test connection" with details typed but not yet saved. Nothing is stored.
// Same rules as update(): a blank ordinary field falls back to backend\.env, a blank secret keeps the saved one.
function preview(patch) {
  const overrides = {};
  for (const [key, raw] of Object.entries(patch || {})) {
    const field = BY_KEY[key];
    if (!field) throw new ConnectionError(`Unknown field "${key}"`, key);
    if (raw === undefined || raw === null) continue;
    if (field.secret) {
      if (typeof raw !== 'string') throw new ConnectionError(`${field.label}: must be text`, key);
      if (raw.trim()) overrides[key] = raw.trim();
    } else {
      const value = cleanValue(field, raw);
      overrides[key] = value || envValue(field) || field.default;
    }
  }
  return overrides;
}

// What the Admin screen may see: values of ordinary fields, only "is it set" for secrets.
function overview() {
  const out = {};
  for (const field of FIELDS) {
    const source = state.source[field.key];
    const base = { key: field.key, label: field.label, help: field.help, group: field.group, type: field.type, secret: !!field.secret, source, env: field.env || null };
    if (field.secret) {
      out[field.key] = { ...base, set: source === 'db' || source === 'env', unreadable: state.unreadable.has(field.key) };
    } else {
      const saved = source === 'db' ? state.values[field.key] : '';
      out[field.key] = { ...base, value: state.values[field.key], saved, default: field.default };
    }
  }
  return out;
}

module.exports = { FIELDS, load, ready, onChange, startRefresh, manageEngine, smtp, update, preview, overview, ConnectionError };
