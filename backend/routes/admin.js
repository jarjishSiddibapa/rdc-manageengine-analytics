const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../services/auth');
const audit = require('../services/audit');
const settings = require('../services/settings');

const router = express.Router();
router.use(auth.requireRole('admin'));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_FIELDS = 'id, name, email, role, active, must_change_password, last_login_at, created_at';

// Only real strings count; an object or array in a JSON body must not become "[object Object]".
const str = value => (typeof value === 'string' ? value.trim() : '');

// A positive whole number from the URL, or null.
const idOf = value => (/^\d{1,10}$/.test(String(value)) && Number(value) > 0 ? Number(value) : null);

// Runs fn(connection) in a transaction that first locks every active administrator row, so two administrators
// demoting or deleting each other at the same instant cannot leave the system with none.
async function withAdminLock(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 FOR UPDATE");
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch { /* connection already gone */ }
    throw error;
  } finally {
    conn.release();
  }
}

async function otherActiveAdmins(conn, exceptId) {
  const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", [exceptId]);
  return n;
}

function readUserBody(body, { requirePassword }) {
  const name = str(body?.name);
  const email = str(body?.email).toLowerCase();
  if (!name || name.length > 150) return { error: 'Enter the person\'s name (up to 150 characters)' };
  if (!EMAIL.test(email) || email.length > 190) return { error: 'Enter a valid email address' };
  if (!auth.ROLES.includes(body?.role)) return { error: 'Choose a role: admin, manager or viewer' };
  if (requirePassword) {
    const problem = auth.passwordProblem(body?.password, { email });
    if (problem) return { error: problem };
  }
  return { name, email, role: body.role };
}

// ── Users ──
router.get('/users', async (_req, res) => {
  const [rows] = await pool.query(`
    SELECT ${USER_FIELDS.split(', ').map(f => `u.${f}`).join(', ')}, (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > NOW()) AS active_sessions
    FROM users u ORDER BY u.active DESC, u.name`);
  res.json({ users: rows.map(u => ({ ...auth.publicUser(u), active_sessions: u.active_sessions })), roles: auth.ROLES });
});

router.post('/users', async (req, res) => {
  const data = readUserBody(req.body, { requirePassword: true });
  if (data.error) return res.status(400).json({ message: data.error });
  const [[taken]] = await pool.query('SELECT id FROM users WHERE email = ?', [data.email]);
  if (taken) return res.status(409).json({ message: 'Someone already uses that email address' });
  let result;
  try {
    [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, role, active, must_change_password) VALUES (?, ?, ?, ?, 1, ?)',
      [data.name, data.email, await auth.hashPassword(req.body.password), data.role, req.body.must_change_password === false ? 0 : 1],
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Someone already uses that email address' });
    throw error;
  }
  await audit.record(req, 'user_created', { target: data.email, detail: `Role: ${data.role}` });
  const [[user]] = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [result.insertId]);
  res.status(201).json({ user: auth.publicUser(user) });
});

router.patch('/users/:id', async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(404).json({ message: 'User not found' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  if (body.active !== undefined && ![true, false, 1, 0].includes(body.active)) return res.status(400).json({ message: 'Active must be true or false' });

  const outcome = await withAdminLock(async conn => {
    const [[existing]] = await conn.query('SELECT * FROM users WHERE id = ? FOR UPDATE', [id]);
    if (!existing) return { status: 404, message: 'User not found' };
    const data = readUserBody({ name: existing.name, email: existing.email, role: existing.role, ...body }, { requirePassword: false });
    if (data.error) return { status: 400, message: data.error };
    const active = body.active === undefined ? !!existing.active : !!body.active;

    if (id === req.user.id && (!active || data.role !== 'admin')) {
      return { status: 400, message: 'You cannot disable yourself or take away your own admin role. Ask another administrator.' };
    }
    if (existing.role === 'admin' && existing.active && (data.role !== 'admin' || !active) && (await otherActiveAdmins(conn, id)) === 0) {
      return { status: 400, message: 'There must always be at least one active administrator' };
    }
    const [[clash]] = await conn.query('SELECT id FROM users WHERE email = ? AND id <> ?', [data.email, id]);
    if (clash) return { status: 409, message: 'Someone already uses that email address' };

    await conn.query('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?', [data.name, data.email, data.role, active ? 1 : 0, id]);
    // Disabled, or a different role: every device is signed out, so the old permissions can never outlive the change.
    // Email changes also end the sessions (the account is now a different identity), except an administrator editing their own.
    if (!active || data.role !== existing.role || (data.email !== existing.email && id !== req.user.id)) await conn.query('DELETE FROM sessions WHERE user_id = ?', [id]);
    return { existing, data, active };
  });
  if (outcome.status) return res.status(outcome.status).json({ message: outcome.message });

  const { existing, data, active } = outcome;
  const changes = [];
  if (data.name !== existing.name) changes.push('name');
  if (data.email !== existing.email) changes.push(`email ${existing.email} -> ${data.email}`);
  if (data.role !== existing.role) changes.push(`role ${existing.role} -> ${data.role}`);
  if (active !== !!existing.active) changes.push(active ? 'enabled' : 'disabled');
  await audit.record(req, active !== !!existing.active ? (active ? 'user_enabled' : 'user_disabled') : 'user_updated', { target: data.email, detail: changes.join(', ') || 'No changes' });
  const [[user]] = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [id]);
  res.json({ user: auth.publicUser(user) });
});

// Sets a new password (typed, or generated when left blank). The person must change it at their next sign-in.
router.post('/users/:id/reset-password', async (req, res) => {
  const id = idOf(req.params.id);
  const [[user]] = id ? await pool.query('SELECT * FROM users WHERE id = ?', [id]) : [[]];
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (req.body?.password !== undefined && req.body.password !== '' && typeof req.body.password !== 'string') return res.status(400).json({ message: 'Password must be text' });
  const generated = !req.body?.password;
  const password = generated ? auth.generatePassword() : req.body.password;
  const problem = auth.passwordProblem(password, { email: user.email });
  if (problem) return res.status(400).json({ message: problem });
  await pool.query('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?', [await auth.hashPassword(password), id === req.user.id ? 0 : 1, id]);
  await pool.query('DELETE FROM sessions WHERE user_id = ? AND NOT (user_id = ? AND token_hash = ?)', [id, req.user.id, auth.sessionHashOf(req)]);
  await audit.record(req, 'password_reset', { target: user.email });
  res.json({ ok: true, password: generated ? password : undefined });
});

router.post('/users/:id/revoke-sessions', async (req, res) => {
  const id = idOf(req.params.id);
  const [[user]] = id ? await pool.query('SELECT email FROM users WHERE id = ?', [id]) : [[]];
  if (!user) return res.status(404).json({ message: 'User not found' });
  const [result] = await pool.query('DELETE FROM sessions WHERE user_id = ? AND NOT (user_id = ? AND token_hash = ?)', [id, req.user.id, auth.sessionHashOf(req)]);
  await audit.record(req, 'sessions_revoked', { target: user.email, detail: `${result.affectedRows} session(s)` });
  res.json({ ok: true, revoked: result.affectedRows });
});

router.delete('/users/:id', async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(404).json({ message: 'User not found' });
  if (id === req.user.id) return res.status(400).json({ message: 'You cannot delete your own account' });
  const outcome = await withAdminLock(async conn => {
    const [[user]] = await conn.query('SELECT * FROM users WHERE id = ? FOR UPDATE', [id]);
    if (!user) return { status: 404, message: 'User not found' };
    if (user.role === 'admin' && user.active && (await otherActiveAdmins(conn, id)) === 0) {
      return { status: 400, message: 'There must always be at least one active administrator' };
    }
    await conn.query('DELETE FROM users WHERE id = ?', [id]); // sessions go with it (foreign key cascade)
    return { user };
  });
  if (outcome.status) return res.status(outcome.status).json({ message: outcome.message });
  await audit.record(req, 'user_deleted', { target: outcome.user.email });
  res.json({ ok: true });
});

// ── Activity log ──
router.get('/audit', async (req, res) => {
  const page = Math.min(Math.max(Math.floor(Number(req.query.page)) || 1, 1), 1_000_000);
  const pageSize = Math.min(Math.max(Math.floor(Number(req.query.pageSize)) || 25, 1), 200);
  const where = [];
  const params = [];
  if (req.query.action) { where.push('action = ?'); params.push(String(req.query.action).slice(0, 60)); }
  if (req.query.q) {
    where.push('(user_email LIKE ? OR target LIKE ? OR detail LIKE ?)');
    const like = `%${String(req.query.q).slice(0, 100).replace(/[\\%_]/g, m => `\\${m}`)}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_log ${clause}`, params);
  const [rows] = await pool.query(`SELECT * FROM audit_log ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  const [actions] = await pool.query('SELECT DISTINCT action FROM audit_log ORDER BY action');
  res.json({ total, page, pageSize, entries: rows, actions: actions.map(a => a.action) });
});

// ── Database backups ──
router.use('/backups', require('./backups'));

// ── Connections (ManageEngine and email; secrets are encrypted and never returned) ──
router.use('/connections', require('./connections'));

// ── Settings ──
// GET sends the current values together with the schema (labels, help, limits, defaults) the screen is drawn from, so the screen and
// the server validate the same way. PUT takes { key: value } for the keys to change; a value of null puts a setting back to its default.
async function settingsPayload() {
  return { settings: await settings.getAll(), schema: settings.describe(), groups: settings.GROUPS, stored: await settings.storedKeys() };
}

router.get('/settings', async (_req, res) => res.json(await settingsPayload()));

const shown = value => { const text = String(value ?? '') || '(blank)'; return text.length > 80 ? `${text.slice(0, 77)}...` : text; };

router.put('/settings', async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  try {
    const before = await settings.getAll();
    const after = await settings.update(body);
    const changed = Object.keys(after).filter(k => after[k] !== before[k]).map(k => `${k}: ${shown(before[k])} -> ${shown(after[k])}${body[k] === null ? ' (reset to default)' : ''}`);
    if (changed.length) await audit.record(req, 'settings_updated', { detail: changed.join('; ') });
    res.json({ ...(await settingsPayload()), changed: changed.length });
  } catch (error) {
    if (error instanceof settings.SettingsError) return res.status(400).json({ message: error.message, field: error.field });
    throw error;
  }
});

module.exports = router;
