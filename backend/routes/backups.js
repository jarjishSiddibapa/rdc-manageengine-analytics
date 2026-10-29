const express = require('express');
const backup = require('../services/backup');
const mailer = require('../services/mailer');
const settings = require('../services/settings');
const audit = require('../services/audit');

// Mounted under /api/admin/backups, so only administrators reach it (see routes/admin.js).
const router = express.Router();

router.get('/', async (_req, res) => res.json(await backup.overview()));

router.put('/settings', async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const allowed = ['backup_enabled', 'backup_hour', 'backup_minute', 'backup_keep', 'backup_email_enabled', 'backup_email_recipients'];
  const patch = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
  try {
    const before = await settings.getAll();
    const after = await settings.update(patch);
    const changed = allowed.filter(k => k in patch && after[k] !== before[k]).map(k => `${k.replace('backup_', '')}: ${before[k] || '(blank)'} -> ${after[k] || '(blank)'}`);
    if (changed.length) await audit.record(req, 'backup_settings_updated', { detail: changed.join('; ') });
    await backup.reschedule();
    res.json(await backup.overview());
  } catch (error) {
    if (error instanceof settings.SettingsError) return res.status(400).json({ message: error.message });
    throw error;
  }
});

// Starts a backup and answers at once; the screen watches GET / until it finishes (a large database takes a while).
router.post('/run', async (req, res) => {
  try {
    const run = await backup.startBackup({ triggeredBy: 'manual', startedBy: req.user.email });
    await audit.record(req, 'backup_started', { target: run.filename });
    run.done.then(outcome => audit.record(req, outcome.success ? 'backup_finished' : 'backup_failed', { target: run.filename, detail: outcome.success ? `${outcome.size} bytes` : outcome.message }));
    res.status(202).json({ id: run.id, filename: run.filename });
  } catch (error) {
    if (error instanceof backup.BackupBusy) return res.status(409).json({ message: error.message, code: 'BUSY' });
    throw error;
  }
});

router.post('/test-email', async (req, res) => {
  if (!mailer.isConfigured()) {
    return res.status(400).json({ message: 'Email is not set up. Add the mail server details under Admin > Connections (or SMTP_USER and SMTP_PASS in backend\\.env).', code: 'MAIL_NOT_CONFIGURED' });
  }
  const given = typeof req.body?.to === 'string' ? req.body.to : '';
  const configured = (await settings.getAll()).backup_email_recipients;
  const { valid, invalid } = settings.parseEmailList(given || configured || req.user.email);
  if (invalid.length) return res.status(400).json({ message: `Not a valid email address: ${invalid.join(', ')}` });
  if (!valid.length || valid.length > 20) return res.status(400).json({ message: 'Enter between 1 and 20 email addresses' });
  try {
    await mailer.sendTestEmail({ to: valid.join(', '), sentBy: req.user.name });
  } catch (error) {
    return res.status(502).json({ message: `The email could not be sent: ${String(error.message).slice(0, 300)}`, code: 'MAIL_FAILED' });
  }
  await audit.record(req, 'backup_test_email', { target: valid.join(', ') });
  res.json({ message: `Test email sent to ${valid.join(', ')}` });
});

router.get('/download/:filename', async (req, res) => {
  const file = backup.filePath(req.params.filename);
  if (!file) return res.status(404).json({ message: 'That backup file is not available' });
  await audit.record(req, 'backup_downloaded', { target: req.params.filename });
  res.download(file, req.params.filename);
});

router.delete('/:filename', async (req, res) => {
  const removed = await backup.removeBackup(req.params.filename);
  if (!removed) return res.status(404).json({ message: 'That backup cannot be removed (it does not exist or is still running)' });
  await audit.record(req, 'backup_deleted', { target: req.params.filename });
  res.json({ message: 'Backup removed' });
});

module.exports = router;
