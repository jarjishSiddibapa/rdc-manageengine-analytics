const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../services/auth');
const audit = require('../services/audit');
const passwordReset = require('../services/passwordReset');

const publicRouter = express.Router();
const privateRouter = express.Router();

publicRouter.post('/auth/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const ip = audit.clientIp(req) || 'unknown';
  if (!email || !password) return res.status(400).json({ message: 'Enter your email and password' });

  const locked = auth.lockedFor(email, ip);
  if (locked) {
    res.set('Retry-After', String(locked));
    const minutes = Math.ceil(locked / 60);
    return res.status(429).json({ message: `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, code: 'LOCKED' });
  }

  // Absurdly long input is never a real sign-in; refuse it without spending a password hash on it.
  if (email.length > 190 || password.length > 200) {
    auth.noteFailure(email.slice(0, 190), ip);
    return res.status(401).json({ message: 'Incorrect email or password' });
  }

  const [[user]] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  // An unknown email is checked against a decoy hash so it takes as long as a wrong password (no way to tell which emails exist).
  const ok = await auth.verifyPassword(password, user ? user.password_hash : await auth.getDummyHash());
  if (!user || !ok || !user.active) {
    const nowLocked = auth.noteFailure(email, ip);
    await audit.record(req, 'login_failed', { target: email, detail: user && ok && !user.active ? 'Account is disabled' : null, user: { id: user?.id ?? null, email } });
    if (nowLocked) await audit.record(req, 'login_locked', { target: email, detail: `Too many wrong passwords: locked for ${auth.lockoutPolicy().minutes} minutes`, user: { id: user?.id ?? null, email } });
    return res.status(401).json({ message: 'Incorrect email or password' });
  }

  auth.clearFailures(email, ip);
  if (auth.needsRehash(user.password_hash)) {
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await auth.hashPassword(password), user.id]);
  }
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  await auth.createSession(req, res, user.id);
  await audit.record(req, 'login', { target: email, user: { id: user.id, email } });
  res.json({ user: auth.publicUser({ ...user, last_login_at: new Date().toISOString() }) });
});

// ── Forgot password (by email) ──
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_SENT = 'If that address belongs to an account, a reset link is on its way. It can take a minute to arrive.';

publicRouter.post('/auth/forgot-password', async (req, res) => {
  if (!passwordReset.available()) {
    return res.status(403).json({ message: 'Resetting a password by email is not available. Ask an administrator to reset it for you.', code: 'RESET_UNAVAILABLE' });
  }
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || email.length > 190 || !EMAIL_SHAPE.test(email)) return res.status(400).json({ message: 'Enter the email address of your account' });
  const ip = audit.clientIp(req) || 'unknown';
  if (passwordReset.hourlyLimitHit(ip)) {
    res.set('Retry-After', '3600');
    return res.status(429).json({ message: 'Too many reset requests from this computer. Try again in an hour, or ask an administrator.', code: 'RATE_LIMITED' });
  }
  // The work (look-up, link, email) runs after the answer is sent, so the reply takes the same time whether or not the account exists.
  setImmediate(() => passwordReset.request(req, email).catch(error => console.error('Password reset request failed:', error.message)));
  res.json({ ok: true, message: GENERIC_SENT });
});

publicRouter.post('/auth/reset-password/check', async (req, res) => {
  const wait = passwordReset.lockedFor(audit.clientIp(req) || 'unknown');
  if (wait) return res.status(429).json({ message: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.`, code: 'LOCKED' });
  const row = await passwordReset.lookup(req.body?.token);
  if (!row) {
    passwordReset.badToken.fail(audit.clientIp(req) || 'unknown');
    return res.status(400).json({ message: 'This reset link is not valid any more. Ask for a new one.', code: 'LINK_INVALID' });
  }
  res.json({ ok: true, name: row.name, email: row.email });
});

publicRouter.post('/auth/reset-password', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!token || !password) return res.status(400).json({ message: 'The reset link and a new password are needed' });
  const result = await passwordReset.complete(req, token, password);
  if (result.ok) return res.json({ ok: true, message: 'Your password was changed. Sign in with the new one.' });
  if (result.retry) res.set('Retry-After', String(result.retry));
  res.status(result.status).json({ message: result.message, code: result.code });
});

privateRouter.get('/auth/me', (req, res) => res.json({ user: req.user }));

privateRouter.post('/auth/logout', async (req, res) => {
  await auth.destroySession(req);
  auth.clearSessionCookie(res, req);
  await audit.record(req, 'logout');
  res.json({ ok: true });
});

privateRouter.post('/auth/change-password', async (req, res) => {
  const current = typeof req.body?.current === 'string' ? req.body.current : '';
  const next = typeof req.body?.next === 'string' ? req.body.next : '';
  const key = String(req.user.id);
  const locked = auth.passwordChangeThrottle.lockedFor(key);
  if (locked) {
    res.set('Retry-After', String(locked));
    return res.status(429).json({ message: 'Too many wrong passwords. Try again in a few minutes.', code: 'LOCKED' });
  }
  const problem = auth.passwordProblem(next, { email: req.user.email });
  if (problem) return res.status(400).json({ message: problem });
  const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (current.length > 200 || !(await auth.verifyPassword(current, user.password_hash))) {
    auth.passwordChangeThrottle.fail(key);
    await audit.record(req, 'password_change_failed', { target: req.user.email, detail: 'Current password was wrong' });
    return res.status(400).json({ message: 'Your current password is not right' });
  }
  if (current === next) return res.status(400).json({ message: 'Choose a password different from the current one' });

  auth.passwordChangeThrottle.clear(key);
  await pool.query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [await auth.hashPassword(next), req.user.id]);
  // Every other device is signed out; this one stays.
  await pool.query('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [req.user.id, auth.sessionHashOf(req)]);
  await audit.record(req, 'password_changed', { target: req.user.email });
  res.json({ ok: true });
});

privateRouter.patch('/auth/profile', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 150) return res.status(400).json({ message: 'Enter your name (up to 150 characters)' });
  await pool.query('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id]);
  await audit.record(req, 'profile_updated', { target: req.user.email });
  res.json({ user: { ...req.user, name } });
});

module.exports = { publicRouter, privateRouter };
