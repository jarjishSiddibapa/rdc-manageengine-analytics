const express = require('express');
const connections = require('../services/connections');
const manageengine = require('../services/manageengine');
const mailer = require('../services/mailer');
const settings = require('../services/settings');
const audit = require('../services/audit');

// Mounted under /api/admin/connections, so only administrators reach it (see routes/admin.js).
// Secrets (client secret, refresh token, mail password) go in but never come out: the screen only learns whether one is set.
// The activity log names the fields that changed, never their values.
const router = express.Router();

const bodyOf = req => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const valuesOf = req => { const v = bodyOf(req).values; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const labelOf = key => { const f = connections.FIELDS.find(x => x.key === key); return f ? `${f.group === 'smtp' ? 'Email' : 'ManageEngine'} ${f.label.toLowerCase()}` : key; };

async function overview() {
  await connections.ready();
  const fields = connections.overview();
  const me = manageengine.missingConfig();
  return {
    fields,
    manageengine_ready: me.length === 0,
    manageengine_missing: me,
    mail_ready: mailer.isConfigured(),
    // Where backend\.env still supplies a value, for the "from .env" tags.
    env_in_use: Object.values(fields).filter(f => f.source === 'env').map(f => f.key),
  };
}

router.get('/', async (_req, res) => res.json(await overview()));

router.put('/', async (req, res) => {
  try {
    const changed = await connections.update(valuesOf(req));
    if (changed.length) await audit.record(req, 'connections_updated', { detail: `Changed: ${changed.map(labelOf).join(', ')}` });
    res.json({ ...(await overview()), changed });
  } catch (error) {
    if (error instanceof connections.ConnectionError) return res.status(400).json({ message: error.message, field: error.field });
    throw error;
  }
});

// One test at a time per kind, and not more often than every few seconds: Zoho limits how often tokens may be requested.
const lastTest = { manageengine: 0, smtp: 0 };
const TEST_GAP_MS = 8000;
function tooSoon(kind) {
  const wait = lastTest[kind] + TEST_GAP_MS - Date.now();
  if (wait > 0) return Math.ceil(wait / 1000);
  lastTest[kind] = Date.now();
  return 0;
}

router.post('/test/manageengine', async (req, res) => {
  const wait = tooSoon('manageengine');
  if (wait) return res.status(429).json({ message: `Wait ${wait} seconds before testing again (Zoho limits how often tokens may be requested).`, code: 'TOO_SOON' });
  let overrides;
  try { overrides = connections.preview(valuesOf(req)); } catch (error) {
    if (error instanceof connections.ConnectionError) return res.status(400).json({ message: error.message, field: error.field });
    throw error;
  }
  await connections.ready();
  const config = { ...connections.manageEngine(overrides), timeZone: settings.str('portal_time_zone') };
  const result = await manageengine.testConnection(config);
  await audit.record(req, 'connection_tested', { target: 'ManageEngine', detail: result.ok ? 'Connected' : 'Failed' });
  res.json(result);
});

router.post('/test/smtp', async (req, res) => {
  const wait = tooSoon('smtp');
  if (wait) return res.status(429).json({ message: `Wait ${wait} seconds before testing again.`, code: 'TOO_SOON' });
  let overrides;
  try { overrides = connections.preview(valuesOf(req)); } catch (error) {
    if (error instanceof connections.ConnectionError) return res.status(400).json({ message: error.message, field: error.field });
    throw error;
  }
  await connections.ready();
  let to = null;
  if (bodyOf(req).send) {
    const given = typeof bodyOf(req).to === 'string' ? bodyOf(req).to : '';
    const { valid, invalid } = settings.parseEmailList(given || req.user.email);
    if (invalid.length) return res.status(400).json({ message: `Not a valid email address: ${invalid.join(', ')}` });
    if (!valid.length || valid.length > 5) return res.status(400).json({ message: 'Enter between 1 and 5 email addresses' });
    to = valid.join(', ');
  }
  const result = await mailer.testConnection(overrides, { to, sentBy: req.user.name });
  await audit.record(req, 'connection_tested', { target: 'Email', detail: result.ok ? (to ? `Connected; test email sent to ${to}` : 'Connected') : 'Failed' });
  res.json(result);
});

module.exports = router;
