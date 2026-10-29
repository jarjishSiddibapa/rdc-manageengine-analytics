const { pool } = require('../db/pool');
const me = require('./manageengine');
const settings = require('./settings');
const connections = require('./connections');
const analytics = require('./analytics');
const history = require('./history');

// Two ways to copy ManageEngine's requests into this app's own database. Both only READ from ManageEngine.
//
//   quick ("Sync SRs")      asks ManageEngine only for the requests changed since the last successful sync (minutes).
//   deep  ("Deep Sync SRs") walks EVERY request, newest to oldest, back to the scan-from date, and also flags requests
//                           that ManageEngine no longer has. It is the complete re-read; the first sync is always deep.
//
// An automatic quick sync runs every `auto_sync_minutes` (default 30). An automatic DEEP sync runs once a day at `deep_sync_time`
// (default 01:00, server time) and, like the nightly backup, catches up once if the PC or the app was off at that time.
// Every number below (pages, pauses, overlap, caps...) is a setting on Admin -> Settings and is read when it is used.
//
// Safety rules: only one sync can run at a time across every copy of the app on this database (a MySQL named lock that the
// database drops by itself if the app dies); a run that does not read everything it should never moves the watermark or flags
// requests as gone; a request is only flagged "no longer in ManageEngine" after ManageEngine itself was asked for it by id.
const TRACKED = ['subject', 'status_name', 'status', 'pending_party', 'technician', 'technician_email', 'requester', 'category',
  'subcategory', 'priority', 'request_type', 'group_name', 'site', 'department', 'mode', 'created_at', 'assigned_at',
  'completed_at', 'due_by', 'last_updated_at'];
// sync_max_pages: safety stop. sync_pause_ms: rest between pages.
// sync_overlap_minutes: a quick sync re-reads this much before the last sync started, so a change made while that sync ran (or a few
// minutes of clock difference between this PC and ManageEngine) is never missed. Re-reading is idempotent, so being generous is free.
// sync_removal_cap: a deep sync that finds more requests than this missing from ManageEngine is assumed to have read an incomplete list.
const DAY_MS = 24 * 60 * 60 * 1000;
const WATERMARK_KEY = 'sync_watermark_ms';
const num = key => settings.num(key);

let live = null; // progress of the run in flight, null when idle
let starting = null;
let finished = null;
let stopRequested = false;
let rosterRetryAt = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const same = (a, b) => String(a ?? '') === String(b ?? '');
const createdMs = request => Number(request?.created_time?.value);
const isTrue = v => v === true || v === 'true';

async function upsertPage(rows, startedAt) {
  if (!rows.length) return { inserted: 0, updated: 0 };
  const ids = rows.map(r => r.me_id);
  const [existing] = await pool.query(`SELECT * FROM requests WHERE me_id IN (${ids.map(() => '?').join(',')})`, ids);
  const byId = new Map(existing.map(r => [r.me_id, r]));
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const current = byId.get(row.me_id);
    if (!current) inserted++;
    else if (!current.in_scope || row.display_id !== current.display_id || TRACKED.some(k => !same(row[k], current[k]))) updated++;
  }
  const columns = ['me_id', 'display_id', ...TRACKED];
  const values = rows.flatMap(r => [...columns.map(c => r[c] ?? null), startedAt]);
  const rowPlaceholder = `(${[...columns, 'last_synced_at'].map(() => '?').join(',')}, 1)`;
  await pool.query(
    `INSERT INTO requests (${columns.join(',')}, last_synced_at, in_scope)
     VALUES ${rows.map(() => rowPlaceholder).join(',')}
     ON DUPLICATE KEY UPDATE ${[...columns.filter(c => c !== 'me_id'), 'last_synced_at', 'in_scope'].map(c => `${c} = VALUES(${c})`).join(', ')}`,
    values,
  );
  return { inserted, updated };
}

async function readWatermark() {
  const [[row]] = await pool.query('SELECT v FROM settings WHERE k = ?', [WATERMARK_KEY]);
  const ms = Number(row?.v);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

async function writeWatermark(ms) {
  await pool.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [WATERMARK_KEY, String(ms)]);
}

// Roster of technicians (including those with no requests yet). Optional: the token may lack the scope for it, in which case
// it is not asked again for a few hours.
async function refreshRoster(config) {
  if (Date.now() < rosterRetryAt) return 0;
  try {
    const roster = await me.fetchTechnicianRoster(config);
    for (const t of roster) {
      await pool.query(
        "INSERT INTO technicians (name, email, department, source) VALUES (?, ?, ?, 'roster') ON DUPLICATE KEY UPDATE email = VALUES(email), department = VALUES(department), updated_at = NOW()",
        [t.name, t.email, t.department],
      );
    }
    return roster.length;
  } catch {
    rosterRetryAt = Date.now() + num('roster_retry_hours') * 60 * 60 * 1000;
    return 0;
  }
}

// Of the requests a deep sync did not see, finds the ones ManageEngine really no longer has (asked for by id, one by one).
// Resolves to { gone: [me_id], refreshed: n, unverified: n }. Requests ManageEngine still has are re-stored on the spot.
async function verifyMissing(config, candidates, startedAt) {
  const gone = [];
  let refreshed = 0;
  let unverified = 0;
  for (const c of candidates) {
    if (stopRequested) { unverified++; continue; }
    try {
      const { request, missing } = await me.fetchRequest(config, c.me_id);
      if (missing) { gone.push(c.me_id); continue; }
      const row = me.normalizeRequest(request, config);
      if (row.me_id === c.me_id) { await upsertPage([row], startedAt); refreshed++; } else unverified++;
    } catch { unverified++; }
    await sleep(num('sync_pause_ms'));
  }
  return { gone, refreshed, unverified };
}

// mode: 'quick' | 'deep'. trigger: 'manual' | 'auto'. Returns the run now in flight (or the one already running).
function startSync(options = {}) {
  if (live) return Promise.resolve(live);
  if (!starting) starting = begin(options).finally(() => { starting = null; });
  return starting;
}

async function begin({ mode = 'quick', trigger = 'manual', startedBy = null } = {}) {
  await connections.ready();
  await settings.getAll();
  const config = me.getConfig();
  const missing = me.missingConfig(config);
  if (missing.length) throw new Error(`ManageEngine is not configured: ${missing.join(', ')}`);

  // Another copy of the app (or the command line) on this database may already be syncing.
  const release = await history.acquireRunLock('sync');
  if (!release) {
    return { mode, trigger, status: 'running', external: true, message: 'A sync is already running in another copy of the app' };
  }
  let runId;
  let effectiveMode;
  let deep;
  let watermark;
  let scanFrom;
  let scanFromMs;
  let startedAt;
  const beganMs = Date.now();
  try {
    // We hold the lock, so nothing is really running: any "running" row was left behind by a crash.
    await pool.query("UPDATE sync_runs SET status = 'failed', finished_at = NOW(), message = 'Interrupted (the app stopped while this was running)' WHERE status = 'running' AND mode <> 'history'");
    watermark = await readWatermark();
    const [[stored]] = await pool.query('SELECT COUNT(*) AS n FROM requests');
    // With nothing stored yet there is no "since the last sync", so the first run is always a deep one.
    effectiveMode = mode === 'deep' || !watermark || !stored.n ? 'deep' : 'quick';
    deep = effectiveMode === 'deep';
    scanFrom = String((await settings.get('scan_from')) || '').trim();
    scanFromMs = scanFrom ? Date.parse(`${scanFrom}T00:00:00Z`) : null;
    const [[clock]] = await pool.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS now");
    startedAt = clock.now;
    const [result] = await pool.query(
      'INSERT INTO sync_runs (mode, trigger_source, started_by, started_at, status) VALUES (?, ?, ?, ?, ?)',
      [effectiveMode, trigger, startedBy, startedAt, 'running'],
    );
    runId = result.insertId;
  } catch (error) {
    await release();
    throw error;
  }
  stopRequested = false;
  live = {
    runId, mode: effectiveMode, trigger, startedBy, status: 'running', startedAt, pages: 0, scanned: 0, fetched: 0,
    inserted: 0, updated: 0, removed: 0, message: 'Starting...',
  };
  const run = live;

  (async () => {
    try {
      const criteria = deep ? null : { field: 'last_updated_time', condition: 'greater than', value: String(watermark - num('sync_overlap_minutes') * 60 * 1000) };
      let startIndex = 1;
      let totalCount = null;
      let completed = false;
      const seen = new Set();
      while (run.pages < num('sync_max_pages')) {
        if (stopRequested) break;
        const payload = await me.fetchRequestPage(config, startIndex, { criteria, totalCount: run.pages === 0 });
        if (!Array.isArray(payload.requests)) throw new Error('ManageEngine did not return a list of requests');
        const page = payload.requests;
        if (run.pages === 0) {
          const t = Number(payload?.list_info?.total_count);
          if (Number.isFinite(t) && t >= 0) totalCount = t;
        }
        run.scanned += page.length;
        const rows = page.map(r => me.normalizeRequest(r, config)).filter(r => r.me_id);
        const fresh = rows.filter(r => !seen.has(r.me_id));
        fresh.forEach(r => seen.add(r.me_id));
        const { inserted, updated } = await upsertPage(fresh, startedAt);
        run.pages += 1;
        run.fetched = seen.size;
        run.inserted += inserted;
        run.updated += updated;
        run.message = deep
          ? `Deep sync: read ${seen.size} requests so far${totalCount ? ` of ${totalCount}` : ''}`
          : `Sync: ${seen.size} changed requests so far`;
        await pool.query('UPDATE sync_runs SET pages = ?, scanned = ?, fetched = ?, inserted = ?, updated = ?, message = ? WHERE id = ?',
          [run.pages, run.scanned, run.fetched, run.inserted, run.updated, run.message, runId]);
        if (!isTrue(payload?.list_info?.has_more_rows) || page.length === 0) { completed = true; break; }
        // Newest first: once every request on a page predates the limit (with a day of slack for time zones), nothing older can matter.
        if (deep && scanFromMs && page.every(r => createdMs(r) < scanFromMs - DAY_MS)) { run.reachedLimit = true; completed = true; break; }
        startIndex += page.length;
        await sleep(num('sync_pause_ms'));
      }
      if (stopRequested) throw new Error('Stopped before the end; nothing was marked as removed');
      if (!completed) throw new Error(`Stopped after ${num('sync_max_pages')} pages without reaching the end`);
      // The list is paged while people keep working in ManageEngine, so a page can shift. If ManageEngine's own count says more
      // requests exist than were read, this run is not trusted (the stored requests are still fine; only bookkeeping is skipped).
      if (totalCount !== null && !run.reachedLimit && seen.size < totalCount) {
        throw new Error(`Read ${seen.size} of ${totalCount} requests; the list changed while it was being read. Run the sync again.`);
      }

      // Only a deep run that reached the end may say which requests ManageEngine no longer has. Requests older than the
      // scan limit were not re-read, so they are left exactly as they were.
      let unverified = 0;
      if (deep) {
        const limit = scanFrom || '1900-01-01';
        const [candidates] = await pool.query(
          'SELECT me_id, display_id FROM requests WHERE in_scope = 1 AND last_synced_at < ? AND created_at >= ?',
          [startedAt, limit],
        );
        if (candidates.length > num('sync_removal_cap')) {
          unverified = candidates.length;
        } else if (candidates.length) {
          run.message = `Checking ${candidates.length} requests that were not in the list`;
          const verdict = await verifyMissing(config, candidates, startedAt);
          unverified = verdict.unverified;
          run.updated += verdict.refreshed;
          if (verdict.gone.length) {
            const [removed] = await pool.query(`UPDATE requests SET in_scope = 0 WHERE in_scope = 1 AND me_id IN (${verdict.gone.map(() => '?').join(',')})`, verdict.gone);
            run.removed = removed.affectedRows;
          }
        }
      }
      const roster = await refreshRoster(config);
      await writeWatermark(beganMs);
      run.status = 'success';
      const changes = `${run.inserted} new, ${run.updated} changed${run.removed ? `, ${run.removed} no longer in ManageEngine` : ''}`;
      const caveat = unverified ? ` (${unverified} not in the list could not be confirmed as removed and were left alone)` : '';
      run.message = deep
        ? `Deep sync complete: read ${run.fetched} requests${run.reachedLimit ? ` back to ${scanFrom}` : ' back to the very first'} (${changes})${caveat}${roster ? `; ${roster} technicians in the roster` : ''}`
        : `Sync complete: ${run.fetched} requests had changed (${changes})`;
    } catch (error) {
      run.status = 'failed';
      run.message = error.message;
    }
    try {
      await pool.query('UPDATE sync_runs SET status = ?, finished_at = NOW(), pages = ?, scanned = ?, fetched = ?, inserted = ?, updated = ?, removed = ?, message = ? WHERE id = ?',
        [run.status, run.pages, run.scanned, run.fetched, run.inserted, run.updated, run.removed, run.message, runId]);
    } catch (error) { console.error('Could not record the sync result:', error.message); }
    try { analytics.invalidateCache(); } catch { /* cache only */ }
    finished = { ...run };
    live = null;
    await release();
  })();

  return live;
}

// Asks the sync in flight to stop at the end of the page it is reading. Returns false when none is running here.
function stopSync() { if (live) stopRequested = true; return !!live; }

async function syncStatus() {
  const [[last]] = await pool.query("SELECT * FROM sync_runs WHERE status = 'success' AND mode <> 'history' ORDER BY id DESC LIMIT 1");
  const [[latest]] = await pool.query("SELECT * FROM sync_runs WHERE mode <> 'history' ORDER BY id DESC LIMIT 1");
  const [[counts]] = await pool.query("SELECT COUNT(*) AS total, SUM(status = 'Closed') AS closed FROM requests WHERE in_scope = 1");
  const cfg = await settings.getAll();
  const minutes = Number(cfg.auto_sync_minutes) || 0;
  let nextInMinutes = null;
  if (minutes && latest) {
    const [[since]] = await pool.query('SELECT TIMESTAMPDIFF(MINUTE, ?, NOW()) AS m', [latest.started_at]);
    nextInMinutes = Math.max(0, minutes - since.m);
  }
  return {
    configured: me.missingConfig().length === 0,
    running: live ? { ...live } : await history.externalRun('sync'),
    latest: latest || null,
    lastSuccess: last || null,
    justFinished: !live && finished && latest && finished.runId === latest.id ? finished : null,
    stored: { total: counts.total || 0, closed: Number(counts.closed) || 0 },
    auto: { minutes, nextInMinutes },
    deep: await deepStatus(cfg),
    history: await history.historyStatus(),
  };
}

// ── The daily deep sync (schedule) ──
// Times here are wall-clock strings "YYYY-MM-DD HH:MM:SS" of the database server's clock (the same clock that stamps sync_runs), so
// the schedule, the history and the screen all agree; they are compared as text and the arithmetic is done in UTC so a daylight-saving
// change can never shift the due time. Everything below is pure (clock and history passed in) so it can be tested with injected clocks.
const GRACE_MINUTES = 10; // a deep sync started within this long after its time counts as "on time", later ones as catch-ups
const wallMs = text => Date.parse(`${String(text).replace(' ', 'T').slice(0, 19)}Z`);
const wallText = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// The most recent moment a deep sync was due (at or before `now`) and the next one.
function deepDueTimes(time, now) {
  const [hour, minute] = String(time || '01:00').split(':').map(Number);
  const nowMs = wallMs(now);
  const day = new Date(nowMs);
  const today = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour || 0, minute || 0, 0);
  return { last: wallText(today <= nowMs ? today : today - DAY_MS), next: wallText(today > nowMs ? today : today + DAY_MS) };
}

// Decides whether the automatic deep sync should start now. `runs` are the deep runs started since the last due time (any trigger).
//   - one already succeeded (or is running) since the due time -> nothing to do (this is what stops a second one after a catch-up)
//   - the app was off at that time and catch-up is switched off -> skipped once the grace period has passed
//   - failed automatic attempts since then reached the daily limit -> wait for the next due time
//   - the last failed attempt is more recent than the retry wait -> wait
function decideDeepSync({ enabled, time, catchup = true, maxAttempts = 3, retryMinutes = 5, now, runs = [] }) {
  if (!enabled) return { run: false, reason: 'off' };
  const { last, next } = deepDueTimes(time, now);
  const since = runs.filter(r => String(r.started_at) >= last);
  const base = { last, next };
  if (since.some(r => r.status === 'success' || r.status === 'running')) return { run: false, reason: 'done', ...base };
  const lateMinutes = Math.floor((wallMs(now) - wallMs(last)) / 60000);
  if (!catchup && lateMinutes > GRACE_MINUTES) return { run: false, reason: 'missed', lateMinutes, ...base };
  const failed = since.filter(r => r.status === 'failed' && r.trigger_source === 'auto');
  if (failed.length >= maxAttempts) return { run: false, reason: 'attempts', lateMinutes, ...base };
  if (failed.length) {
    const lastFailure = failed[failed.length - 1];
    const waited = (wallMs(now) - wallMs(lastFailure.finished_at || lastFailure.started_at)) / 60000;
    if (waited < retryMinutes) return { run: false, reason: 'retry-wait', lateMinutes, ...base };
  }
  return { run: true, reason: lateMinutes > GRACE_MINUTES ? 'catchup' : 'schedule', lateMinutes, ...base };
}

async function databaseNow() {
  const [[clock]] = await pool.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS now");
  return clock.now;
}

const deepPolicy = cfg => ({
  enabled: cfg.deep_sync_enabled === '1', time: cfg.deep_sync_time, catchup: cfg.deep_sync_catchup === '1',
  maxAttempts: Number(cfg.deep_sync_max_attempts), retryMinutes: Number(cfg.sync_retry_minutes),
});

// Starts the automatic deep sync if it is due and has not happened yet. One routine serves both the exact time and the catch-up, so
// the two can never produce two syncs. `options.now` (a wall-clock string) lets a test pretend it is another time. It never overlaps
// another sync: it does nothing while this app (or another copy of it, via the MySQL lock) is syncing, and tries again a minute later.
async function runDueDeepSync(options = {}) {
  if (live || starting) return { started: false, reason: 'busy' };
  const cfg = await settings.getAll();
  const policy = deepPolicy(cfg);
  if (!policy.enabled) return { started: false, reason: 'off' };
  const now = options.now || await databaseNow();
  const { last } = deepDueTimes(policy.time, now);
  const [runs] = await pool.query("SELECT id, status, trigger_source, started_at, finished_at FROM sync_runs WHERE mode = 'deep' AND started_at >= ? ORDER BY id", [last]);
  const decision = decideDeepSync({ ...policy, now, runs });
  if (!decision.run) return { ...decision, started: false };
  const run = await (options.start || startSync)({ mode: 'deep', trigger: 'auto', startedBy: 'automatic' });
  if (run.external) return { ...decision, started: false, reason: 'busy' };
  return { ...decision, started: true, runId: run.runId };
}

// For the screens: when the next deep sync is due, and how the last one went.
async function deepStatus(cfg) {
  const policy = deepPolicy(cfg);
  const now = await databaseNow();
  const { next } = deepDueTimes(policy.time, now);
  const [[lastDeep]] = await pool.query("SELECT id, status, trigger_source, started_at, finished_at, message FROM sync_runs WHERE mode = 'deep' ORDER BY id DESC LIMIT 1");
  const [[lastSuccess]] = await pool.query("SELECT id, trigger_source, started_at, finished_at FROM sync_runs WHERE mode = 'deep' AND status = 'success' ORDER BY id DESC LIMIT 1");
  return { enabled: policy.enabled, time: policy.time, catchup: policy.catchup, next_run: policy.enabled ? next : null, last: lastDeep || null, last_success: lastSuccess || null };
}

// ── Automatic sync ──
let timer = null;

async function tick() {
  try {
    await connections.ready();
    await settings.getAll();
    if (live || starting || me.missingConfig().length) return;
    const watermark = await readWatermark();
    const minutes = num('auto_sync_minutes');
    const [[latest]] = await pool.query("SELECT status, started_at, TIMESTAMPDIFF(MINUTE, started_at, NOW()) AS since FROM sync_runs WHERE mode <> 'history' ORDER BY id DESC LIMIT 1");
    // Nothing has ever synced: read everything now (even if automatic sync is off, an empty app is useless).
    if (!watermark && !latest) { await startSync({ mode: 'deep', trigger: 'auto' }); return; }
    // The daily deep sync (and its catch-up) goes first; while it runs, no quick sync is started.
    const deep = await runDueDeepSync();
    if (deep.started) return;
    // A sync that failed (network, ManageEngine busy) is tried again after a few minutes, not after the whole interval.
    const due = !latest || latest.since >= (latest.status === 'failed' ? Math.min(minutes, num('sync_retry_minutes')) : minutes);
    if (minutes > 0 && due) await startSync({ mode: 'quick', trigger: 'auto' });
  } catch (error) {
    console.error('Automatic sync could not start:', error.message);
  }
  // Once the SRs themselves are in, collect their history (new and changed SRs first; the backlog fills in over time).
  try {
    if (!live && !starting && (await readWatermark())) await history.tickHistory();
  } catch (error) {
    console.error('Automatic history collection could not start:', error.message);
  }
}

function startScheduler() {
  if (timer) return;
  setTimeout(tick, 5000);
  timer = setInterval(tick, 60 * 1000);
  timer.unref?.();
}

module.exports = { startSync, stopSync, syncStatus, startScheduler, runDueDeepSync, decideDeepSync, deepDueTimes, deepStatus, tick };
