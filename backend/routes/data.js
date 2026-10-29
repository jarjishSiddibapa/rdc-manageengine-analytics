const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../services/auth');
const audit = require('../services/audit');
const analytics = require('../services/analytics');
const reports = require('../services/reports');
const settings = require('../services/settings');
const sync = require('../services/sync');
const history = require('../services/history');

const router = express.Router();

// Query strings arrive as text, or as arrays when a name is repeated. Everything is reduced to short text (the filter lists may stay lists)
// so no handler ever has to wonder what type it was given.
const LIST_PARAMS = new Set(['technician', 'category', 'priority', 'group', 'request_type', 'status']);
const MAX_PARAM_CHARS = 300;
function cleanQuery(query) {
  const out = {};
  for (const [name, value] of Object.entries(query || {})) {
    if (Array.isArray(value)) {
      const items = value.filter(v => typeof v === 'string').slice(0, 100).map(v => v.slice(0, MAX_PARAM_CHARS));
      if (LIST_PARAMS.has(name)) out[name] = items;
      else if (items.length) out[name] = items[0];
    } else if (typeof value === 'string') out[name] = value.slice(0, MAX_PARAM_CHARS);
  }
  return out;
}
const filtersOf = req => analytics.parseFilters(cleanQuery(req.query));

// Query strings the drill-down understands, passed straight through to the analytics module.
const drillOf = q => ({
  dim: q.dim, key: q.key, bucket: q.bucket, aging: q.aging, sla: q.sla, overdue: q.overdue, handling: q.handling, handover: q.handover,
});

// ── Filters / app settings every screen needs ──
router.get('/meta', async (req, res) => {
  const cfg = await settings.getAll();
  const { records } = await analytics.loadRecords('assigned');
  const c = analytics.cfg();
  res.json({
    default_basis: cfg.default_basis,
    default_aggregation: cfg.default_aggregation === 'median' ? 'median' : 'average',
    auto_sync_minutes: Number(cfg.auto_sync_minutes) || 0,
    // What the screens need to word their labels and to size their lists (all settings, see Admin -> Settings -> Analytics).
    ui: {
      default_preset: cfg.default_preset,
      default_page_size: Number(cfg.default_page_size),
      targets_days: c.targets,
      first_reply_targets_minutes: c.replyTargets,
      stale_days: c.stale,
      recent_days: c.recentDays,
      min_ranked: c.minSample,
      top_n_charts: Number(cfg.top_n_charts),
      top_n_story: Number(cfg.top_n_story),
      top_n_matrix: Number(cfg.top_n_matrix),
      insight_diff_pct: c.diffPct,
      count_weekends: c.weekends,
      reassign_top: c.reassignTop,
    },
    facets: await analytics.facets(records),
  });
});

// ── Analytics ──
router.get('/analytics/overview', async (req, res) => {
  res.json(await analytics.buildOverview(filtersOf(req)));
});

router.get('/analytics/technician/:name', async (req, res) => {
  const data = await analytics.buildTechnician(String(req.params.name).slice(0, 255), filtersOf(req));
  if (!data) return res.status(404).json({ message: 'No technician with that name' });
  res.json(data);
});

router.get('/analytics/explore', async (req, res) => {
  const q = cleanQuery(req.query);
  const groupBy = q.groupBy || 'technician';
  const thenBy = q.thenBy || null;
  if (!analytics.GROUP_DIMENSIONS.includes(groupBy)) return res.status(400).json({ message: 'Invalid groupBy' });
  if (thenBy && !analytics.GROUP_DIMENSIONS.includes(thenBy)) return res.status(400).json({ message: 'Invalid thenBy' });
  if (thenBy === groupBy) return res.status(400).json({ message: 'groupBy and thenBy must differ' });
  res.json(await analytics.buildExplore(analytics.parseFilters(q), groupBy, thenBy));
});

router.get('/analytics/records', async (req, res) => {
  const q = cleanQuery(req.query);
  res.json(await analytics.buildRecords(analytics.parseFilters(q), {
    page: q.page, pageSize: q.pageSize, sort: q.sort, order: q.order, drill: drillOf(q),
  }));
});

router.get('/analytics/request/:id', async (req, res) => {
  const row = await analytics.buildRequest(String(req.params.id).slice(0, 40));
  if (!row) return res.status(404).json({ message: 'Request not found' });
  res.json(row);
});

// ── Excel reports ──
// A big workbook (60,000+ rows) takes seconds and a few hundred MB while it is built, so only a couple are built at once;
// further requests are told to retry shortly instead of piling up and exhausting memory.
// (The limit is the max_concurrent_exports setting.)
let runningExports = 0;

function sendWorkbook(res, { buffer, filename }) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(buffer);
}

// Runs build() under the export limit, then sends the file and records who downloaded what.
// build() returns { buffer, filename } or null (not found, answered with notFound).
async function exportReport(req, res, kind, notFound, build) {
  if (runningExports >= settings.num('max_concurrent_exports')) {
    res.set('Retry-After', '5');
    return res.status(429).json({ message: 'Other reports are still being prepared. Try again in a few seconds.', code: 'BUSY' });
  }
  runningExports += 1;
  let report;
  try { report = await build(); } finally { runningExports -= 1; }
  if (!report) return res.status(404).json({ message: notFound });
  sendWorkbook(res, report);
  audit.record(req, 'report_exported', { target: kind, detail: report.filename });
}

router.get('/reports/dashboard.xlsx', (req, res) => exportReport(req, res, 'Dashboard report', 'Not found', () => reports.dashboardReport(filtersOf(req))));

router.get('/reports/technician.xlsx', (req, res) => exportReport(req, res, 'Technician report', 'No technician with that name',
  () => reports.technicianReport(String(cleanQuery(req.query).name || ''), filtersOf(req))));

router.get('/reports/request/:id.xlsx', (req, res) => exportReport(req, res, 'SR report', 'Request not found', () => reports.requestReport(String(req.params.id).slice(0, 40))));

router.get('/reports/records.xlsx', (req, res) => {
  const q = cleanQuery(req.query);
  return exportReport(req, res, 'SR list report', 'Not found', () => reports.recordsReport(analytics.parseFilters(q), drillOf(q), String(q.title || 'SR list').slice(0, 80)));
});

// Data behind any chart or table on screen. Larger body limit than the rest of the API.
router.post('/reports/tables.xlsx', express.json({ limit: '8mb' }), (req, res) => exportReport(req, res, 'Table export', 'Not found', () => reports.tablesReport(req.body)));

// ── Sync ──
router.get('/sync/status', async (_req, res) => res.json(await sync.syncStatus()));

router.post('/sync/run', auth.requireRole('admin', 'manager'), async (req, res) => {
  const mode = req.query.mode === 'deep' ? 'deep' : 'quick';
  try {
    const before = await sync.syncStatus();
    const run = await sync.startSync({ mode, trigger: 'manual', startedBy: req.user.email });
    if (!before.running) await audit.record(req, mode === 'deep' ? 'deep_sync_started' : 'sync_started', { detail: run.mode !== mode ? 'Nothing was stored yet, so a deep sync ran' : null });
    res.status(202).json(await sync.syncStatus());
  } catch (error) {
    if (/not configured/.test(error.message)) return res.status(400).json({ message: error.message });
    throw error;
  }
});

// Asks the running sync (quick or deep) to stop at the next safe point.
router.post('/sync/stop', auth.requireRole('admin', 'manager'), async (req, res) => {
  if (sync.stopSync()) await audit.record(req, 'sync_stopped');
  res.json(await sync.syncStatus());
});

// SR history (reassignments, reopens, replies...) is collected in the background; this starts, rebuilds or stops that.
router.post('/sync/history', auth.requireRole('admin', 'manager'), async (req, res) => {
  const rebuild = req.query.rebuild === '1';
  try {
    const run = await history.startHistorySync({ trigger: 'manual', startedBy: req.user.email, rebuild });
    if (run) await audit.record(req, rebuild ? 'history_rebuild_started' : 'history_started');
    res.status(202).json(await sync.syncStatus());
  } catch (error) {
    if (/not configured/.test(error.message)) return res.status(400).json({ message: error.message });
    throw error;
  }
});

router.post('/sync/history/stop', auth.requireRole('admin', 'manager'), async (req, res) => {
  if (history.stopHistorySync()) await audit.record(req, 'history_stopped');
  res.json(await sync.syncStatus());
});

router.get('/sync/history', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?', [settings.num('sync_history_rows')]);
  res.json({ runs: rows });
});

module.exports = router;
