const mysql = require('mysql2/promise');
const { pool, DB_NAME } = require('../db/pool');
const me = require('./manageengine');
const settings = require('./settings');
const connections = require('./connections');

// SR history: for every SR, ManageEngine keeps a change log (who it was assigned to, status changes, replies, notes, worklogs).
// This module reads that log (read-only), turns it into per-SR figures (reassignments, reopens, first response, time on hold...)
// and a readable timeline, and stores both. Analytics join those figures onto the SR list; the SR window shows the timeline.
const MINUTE_MS = 60 * 1000;
// How many SRs are read at the same time (setting history_concurrency, read when a collection starts).
const concurrency = () => Math.min(Math.max(settings.num('history_concurrency') || 4, 1), 10);
const BATCH = 1000;

// A MySQL named lock says "a sync / history collection is running" to every copy of the app on this database. It lives on its own
// connection, so MySQL drops it by itself if the app dies; nothing can be left locked by a crash. Resolves to a release function,
// or null when someone else holds it.
async function acquireRunLock(name) {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: DB_NAME,
      charset: 'utf8mb4',
      enableKeepAlive: true,
    });
    conn.on('error', () => {});
    const lockName = `${DB_NAME}:${name}`;
    const [[row]] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [lockName]);
    if (Number(row.got) !== 1) { await conn.end().catch(() => {}); return null; }
    return async () => {
      try { await conn.query('SELECT RELEASE_LOCK(?)', [lockName]); } catch { /* connection already gone: the lock went with it */ }
      await conn.end().catch(() => {});
    };
  } catch (error) {
    if (conn) await conn.end().catch(() => {});
    throw error;
  }
}

// The run another copy of the app (same database) is performing right now, shaped like this process's own `live` object; or null.
async function externalRun(name) {
  const [[lock]] = await pool.query('SELECT IS_USED_LOCK(?) AS holder', [`${DB_NAME}:${name}`]);
  if (!lock.holder) return null;
  const [[row]] = await pool.query(`SELECT * FROM sync_runs WHERE status = 'running' AND mode ${name === 'history' ? '=' : '<>'} 'history' ORDER BY id DESC LIMIT 1`);
  if (!row) return null;
  const common = { runId: row.id, mode: row.mode, trigger: row.trigger_source, startedBy: row.started_by, status: 'running', startedAt: row.started_at, message: row.message, external: true };
  return name === 'history'
    ? { ...common, total: row.scanned, done: row.fetched, failed: row.updated, missing: row.removed }
    : { ...common, pages: row.pages, scanned: row.scanned, fetched: row.fetched, inserted: row.inserted, updated: row.updated, removed: row.removed };
}

const wallMs = text => (text ? Date.parse(`${String(text).replace(' ', 'T')}Z`) : null);
const wallText = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// ── Interval arithmetic (all in wall-clock milliseconds) ──
const clip = (list, from, to) => list.map(([s, e]) => [Math.max(s, from), Math.min(e, to)]).filter(([s, e]) => e > s);
function union(list) {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    if (out.length && s <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    else out.push([s, e]);
  }
  return out;
}
function subtract(list, minus) {
  const cuts = union(minus);
  const out = [];
  for (const [s, e] of list) {
    let cursor = s;
    for (const [cs, ce] of cuts) {
      if (ce <= cursor) continue;
      if (cs >= e) break;
      if (cs > cursor) out.push([cursor, cs]);
      cursor = Math.max(cursor, ce);
      if (cursor >= e) break;
    }
    if (cursor < e) out.push([cursor, e]);
  }
  return out;
}
const minutesIn = list => Math.round(union(list).reduce((sum, [s, e]) => sum + (e - s), 0) / MINUTE_MS);

const nameOf = value => {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'object' ? value.name : value;
  return text === null || text === undefined || text === '' ? null : String(text);
};
const person = value => { const n = nameOf(value); return n ? me.personName({ name: n }) : null; };
const stripHtml = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const clean = (text, max) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const classOf = statusName => { const m = me.mapStatus(statusName); return m === 'Closed' ? 'closed' : m === 'On Hold' ? 'hold' : 'open'; };

function worklogMinutes(spent) {
  if (!spent || typeof spent !== 'object') return 0;
  const ms = Number(spent.value);
  if (Number.isFinite(ms) && ms > 0) return ms / MINUTE_MS;
  return (Number(spent.hours) || 0) * 60 + (Number(spent.minutes) || 0);
}

// Pure: one SR's raw ManageEngine events -> { summary, events }. `req` is the SR's row from the requests table.
function parseHistory(rawEvents, req, { timeZone = 'Asia/Kolkata', truncated = false } = {}) {
  const sorted = [...(rawEvents || [])].sort((a, b) => (Number(a?.time?.value) - Number(b?.time?.value)) || (Number(a?.id) - Number(b?.id)) || 0);
  const events = [];
  const add = (at, kind, actor, summary, from = null, to = null) => events.push({ at, kind, actor: actor || null, summary: clean(summary, 580), from: from ? clean(from, 250) : null, to: to ? clean(to, 250) : null });

  const s = {
    assignments: 0, reassignments: 0, firstAssignedAt: null, firstAssignedBy: null, lastAssignedAt: null,
    techReplies: 0, requesterReplies: 0, firstReplyTimes: [], lastActivity: null, lastTechReply: null, lastRequesterReply: null,
    reopens: 0, firstClosedAt: null, closedBy: null, closureCode: null, fcr: null, notes: 0, attachments: 0,
    groupChanges: 0, priorityChanges: 0, categoryChanges: 0, forwards: 0, merged: 0,
  };
  const holders = [];
  let holder = null;
  const worklogs = new Map();
  const transitions = [];
  let cls = 'open';
  let statusSince = wallMs(req.created_at);
  let waiting = null;
  const waitIntervals = [];
  const closedMs = req.status === 'Closed' ? wallMs(req.completed_at) : null;

  for (const e of sorted) {
    const atText = me.dateTimeFromApi(e.time, timeZone);
    const atMs = wallMs(atText);
    const actor = me.personName(e.by);
    const op = String(e.operation || '');
    const diff = new Map((e.diff || []).map(d => [d.field, d]));
    const description = e.description && e.description !== 'null' ? String(e.description) : '';
    const system = !actor || actor === 'System';
    if (atMs !== null && op !== 'add' && op !== 'conversation_add' && (!system || op === 'request_reopen')) s.lastActivity = atText;

    if (op === 'add') add(atText, 'created', actor, 'SR raised');

    if (diff.has('technician')) {
      const d = diff.get('technician');
      const to = person(d.current_value);
      const from = person(d.previous_value);
      if (to) {
        const previous = holder;
        const handedOver = !!previous && previous !== to;
        s.assignments++;
        if (handedOver) s.reassignments++;
        if (s.assignments === 1) { s.firstAssignedAt = atText; s.firstAssignedBy = actor && actor !== 'System' && actor !== to ? actor : null; }
        s.lastAssignedAt = atText;
        if (to !== previous) holders.push(to);
        holder = to;
        const by = actor && actor !== 'System' && actor !== to ? ` by ${actor}` : '';
        add(atText, handedOver ? 'reassigned' : 'assigned', actor, handedOver ? `Reassigned from ${previous} to ${to}${by}` : `Assigned to ${to}${by}`, previous, to);
      } else if (from) {
        add(atText, 'unassigned', actor, `Unassigned from ${from}`, from, null);
      }
    }

    if (diff.has('status') || op === 'close' || op === 'request_reopen') {
      const d = diff.get('status');
      const toName = nameOf(d?.current_value) || (op === 'close' ? 'Closed' : op === 'request_reopen' ? 'Open' : null);
      const fromName = nameOf(d?.previous_value);
      if (toName) {
        const next = classOf(toName);
        if (op === 'request_reopen') {
          s.reopens++;
          add(atText, 'reopened', actor, /requester reply/i.test(description) ? 'Reopened after a requester reply' : 'Reopened', 'Closed', toName);
        } else if (next === 'closed' && (op === 'close' || cls !== 'closed')) {
          if (!s.firstClosedAt) s.firstClosedAt = atText;
          s.closedBy = actor || s.closedBy;
          const code = nameOf(diff.get('closure_code')?.current_value);
          if (code) s.closureCode = code;
          const fcr = /FCR is set as (true|false)/i.exec(description);
          if (fcr) s.fcr = fcr[1].toLowerCase() === 'true' ? 1 : 0;
          add(atText, 'closed', actor, `Closed${code ? ` — ${code}` : ''}${s.fcr ? ' (first-contact resolution)' : ''}`, fromName, toName);
        } else if (next !== 'closed' && (cls === 'closed' || (fromName && classOf(fromName) === 'closed'))) {
          // Closed -> anything else, edited by hand instead of through ManageEngine's "reopen": still a reopen.
          s.reopens++;
          add(atText, 'reopened', actor, /requester reply/i.test(description) ? 'Reopened after a requester reply' : `Reopened (status set to ${toName})`, fromName || 'Closed', toName);
        } else if (next !== cls) {
          const reason = /reason\s*:\s*(.+)/i.exec(description);
          if (next === 'hold') add(atText, 'hold', actor, `Put on hold${reason ? ` — ${reason[1]}` : ''}`, fromName, toName);
          else if (cls === 'hold') add(atText, 'resumed', actor, `Taken off hold (${toName})`, fromName, toName);
          else add(atText, 'status', actor, `Status: ${fromName || '?'} → ${toName}`, fromName, toName);
        }
        if (next !== cls) { transitions.push({ at: atMs, cls: next }); cls = next; statusSince = atMs; }
        if (next === 'closed') waiting = null;
      }
    }

    // Older ManageEngine versions record a reopen as a System "edit" saying "Reopening Request", with no status change attached.
    if (op !== 'request_reopen' && cls === 'closed' && !diff.has('status') && /^\s*reopening request/i.test(description)) {
      s.reopens++;
      add(atText, 'reopened', actor, 'Reopened', 'Closed', 'Open');
      transitions.push({ at: atMs, cls: 'open' });
      cls = 'open';
      statusSince = atMs;
    }

    if (op.startsWith('onhold') && !diff.has('status') && /reason/i.test(description)) {
      add(atText, 'hold', actor, `On-hold note — ${clean(description.replace(/^\s*reason\s*:\s*/i, ''), 200)}`);
    }

    if (op === 'reply') {
      s.techReplies++; s.lastTechReply = atText;
      if (s.firstReplyTimes.length < 50) s.firstReplyTimes.push(atMs);
      if (waiting === null && atMs !== null) waiting = atMs;
      add(atText, 'reply', actor, 'Replied to the requester');
    } else if (op === 'req_reply') {
      s.requesterReplies++; s.lastRequesterReply = atText;
      if (waiting !== null && atMs !== null && atMs > waiting) waitIntervals.push([waiting, atMs]);
      waiting = null;
      add(atText, 'requester_reply', actor, 'Requester replied');
    } else if (op === 'worklog_add' || op === 'worklog_edit') {
      const key = nameOf(diff.get('id')?.current_value) || `e${e.id}`;
      const minutes = worklogMinutes(diff.get('time_spent')?.current_value);
      if (op === 'worklog_add' || diff.has('time_spent')) worklogs.set(key, minutes);
      add(atText, 'worklog', actor, op === 'worklog_add' ? `Logged ${Math.round(minutes)} min of work` : 'Worklog edited');
    } else if (op === 'worklog_delete') {
      const key = nameOf(diff.get('id')?.previous_value) || nameOf(diff.get('id')?.current_value);
      if (key) worklogs.delete(key);
    } else if (op === 'request_note_add') {
      s.notes++;
      add(atText, 'note', actor, `Note added: ${clean(stripHtml(nameOf(diff.get('note')?.current_value) || diff.get('note')?.current_value), 220)}`);
    } else if (op === 'merge_with') {
      s.merged = 1;
      add(atText, 'merged', actor, `Merged with SR ${description || '?'}`);
    } else if (op === 'forward') {
      s.forwards++;
      add(atText, 'forwarded', actor, 'Forwarded');
    } else if (op === 'attachment_add') {
      s.attachments++;
      add(atText, 'attachment', actor, `Attachment added: ${clean(description, 160)}`);
    }

    for (const [field, label, counter] of [['group', 'Group', 'groupChanges'], ['priority', 'Priority', 'priorityChanges'], ['category', 'Category', 'categoryChanges']]) {
      if (!diff.has(field)) continue;
      const from = nameOf(diff.get(field).previous_value);
      const to = nameOf(diff.get(field).current_value);
      if (from && to && from !== to) { s[counter]++; add(atText, field, actor, `${label}: ${from} → ${to}`, from, to); }
    }
  }

  // Closed in the log but open in ManageEngine now: it was reopened and the log did not record when (old SRs, edits by hand).
  // Not for a log that was cut short, where the closure simply may not have been the last thing that happened.
  if (!truncated && cls === 'closed' && req.status && req.status !== 'Closed') {
    s.reopens++;
    add(req.last_updated_at || null, 'reopened', null, 'Reopened (ManageEngine did not log when)', 'Closed', req.status);
    cls = 'open';
  }
  if (truncated) {
    add(events.length ? events[events.length - 1].at : null, 'note', null, 'ManageEngine\'s change log for this SR is very long; part of it in the middle was not read, so counts may be understated');
  }

  // An SR created already assigned has no assignment event; the current technician has had it from the start.
  if (!s.assignments && req.technician) {
    s.assignments = 1;
    holders.push(req.technician);
    holder = req.technician;
    s.firstAssignedAt = req.assigned_at || req.created_at || null;
    s.lastAssignedAt = s.firstAssignedAt;
    events.unshift({ at: s.firstAssignedAt, kind: 'assigned', actor: null, summary: `Assigned to ${req.technician} when raised`, from: null, to: req.technician });
  }

  const lastAssignedMs = wallMs(s.lastAssignedAt);
  const firstResponseAt = s.firstReplyTimes.length ? wallText(s.firstReplyTimes[0]) : null;
  const afterAssign = lastAssignedMs === null ? s.firstReplyTimes : s.firstReplyTimes.filter(t => t >= lastAssignedMs);
  const firstResponseAssignedAt = afterAssign.length ? wallText(afterAssign[0]) : null;

  // Where the time went, for finished SRs only: on hold, closed (between a close and a reopen), and waiting for the requester.
  let windows = { hold_all: null, gap_all: null, wait_all: null, hold_asg: null, gap_asg: null, wait_asg: null };
  const createdMs = wallMs(req.created_at);
  if (closedMs !== null && createdMs !== null && closedMs > createdMs) {
    const spans = [];
    let from = createdMs;
    let state = 'open';
    for (const t of transitions) { spans.push([from, t.at, state]); from = t.at; state = t.cls; }
    spans.push([from, Math.max(closedMs, from), state]);
    const hold = spans.filter(x => x[2] === 'hold').map(x => [x[0], x[1]]);
    const gap = spans.filter(x => x[2] === 'closed').map(x => [x[0], x[1]]);
    const wait = waitIntervals;
    const assignedMs = wallMs(req.assigned_at);
    const startAsg = assignedMs !== null && assignedMs <= closedMs ? assignedMs : createdMs;
    const within = start => {
      const gapI = clip(gap, start, closedMs);
      const holdI = subtract(clip(hold, start, closedMs), gapI);
      const waitI = subtract(clip(wait, start, closedMs), [...gapI, ...holdI]);
      return { hold: minutesIn(holdI), gap: minutesIn(gapI), wait: minutesIn(waitI) };
    };
    const all = within(createdMs);
    const asg = within(startAsg);
    windows = { hold_all: all.hold, gap_all: all.gap, wait_all: all.wait, hold_asg: asg.hold, gap_asg: asg.gap, wait_asg: asg.wait };
  }

  events.forEach((event, index) => { event.seq = index + 1; });
  return {
    summary: {
      events: sorted.length,
      assignments: s.assignments,
      reassignments: s.reassignments,
      technicians_involved: new Set(holders).size,
      tech_path: holders.join(' > ') || null,
      first_assigned_at: s.firstAssignedAt,
      first_assigned_by: s.firstAssignedBy,
      last_assigned_at: s.lastAssignedAt,
      first_response_at: firstResponseAt,
      first_response_assigned_at: firstResponseAssignedAt,
      tech_replies: s.techReplies,
      requester_replies: s.requesterReplies,
      last_activity_at: s.lastActivity,
      last_tech_reply_at: s.lastTechReply,
      last_requester_reply_at: s.lastRequesterReply,
      status_since: statusSince !== null ? wallText(statusSince) : null,
      reopen_count: s.reopens,
      first_closed_at: s.firstClosedAt,
      closed_by: s.closedBy,
      closure_code: s.closureCode,
      fcr: s.fcr,
      ...windows,
      worklog_count: worklogs.size,
      worklog_minutes: Math.round([...worklogs.values()].reduce((sum, v) => sum + v, 0)),
      notes_count: s.notes,
      attachments: s.attachments,
      group_changes: s.groupChanges,
      priority_changes: s.priorityChanges,
      category_changes: s.categoryChanges,
      forwards: s.forwards,
      merged: s.merged,
    },
    events,
  };
}

const SUMMARY_COLUMNS = [
  'events', 'assignments', 'reassignments', 'technicians_involved', 'tech_path', 'first_assigned_at', 'first_assigned_by', 'last_assigned_at',
  'first_response_at', 'first_response_assigned_at', 'tech_replies', 'requester_replies', 'last_activity_at', 'last_tech_reply_at',
  'last_requester_reply_at', 'status_since', 'reopen_count', 'first_closed_at', 'closed_by', 'closure_code', 'fcr', 'hold_all', 'gap_all',
  'wait_all', 'hold_asg', 'gap_asg', 'wait_asg', 'worklog_count', 'worklog_minutes', 'notes_count', 'attachments', 'group_changes',
  'priority_changes', 'category_changes', 'forwards', 'merged',
];

// Column widths in request_history / request_events; one over-long value must not make an SR's history fail for ever.
const MAX_LEN = { first_assigned_by: 255, closed_by: 255, closure_code: 120 };
const fit = (column, value) => (typeof value === 'string' && MAX_LEN[column] && value.length > MAX_LEN[column] ? value.slice(0, MAX_LEN[column]) : value);
const fit255 = value => (typeof value === 'string' && value.length > 255 ? value.slice(0, 255) : value);

async function store(req, parsed) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const columns = ['me_id', 'source_updated_at', ...SUMMARY_COLUMNS];
    const values = [req.me_id, req.last_updated_at || null, ...SUMMARY_COLUMNS.map(c => fit(c, parsed.summary[c] ?? null))];
    await conn.query(
      `INSERT INTO request_history (${columns.join(',')}, fetched_at) VALUES (${columns.map(() => '?').join(',')}, NOW())
       ON DUPLICATE KEY UPDATE fetched_at = NOW(), ${columns.slice(1).map(c => `${c} = VALUES(${c})`).join(', ')}`,
      values,
    );
    await conn.query('DELETE FROM request_events WHERE me_id = ?', [req.me_id]);
    if (parsed.events.length) {
      await conn.query(
        'INSERT INTO request_events (me_id, seq, at, kind, actor, summary, from_value, to_value) VALUES ?',
        [parsed.events.map(e => [req.me_id, e.seq, e.at, e.kind, fit255(e.actor), e.summary, e.from, e.to])],
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// Parallel workers can deadlock on the events index; the transaction is safe to run again.
async function storeWithRetry(req, parsed) {
  for (let attempt = 1; ; attempt++) {
    try { await store(req, parsed); return; } catch (error) {
      if (error.code !== 'ER_LOCK_DEADLOCK' || attempt >= 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * attempt + Math.random() * 100));
    }
  }
}

// Reads and stores one SR's history. Returns false when ManageEngine no longer has the SR.
async function collectOne(config, req) {
  const { events, missing, truncated } = await me.fetchRequestHistory(config, req.me_id);
  if (missing) {
    // ManageEngine has no such SR (deleted / moved to trash). Whatever was collected earlier is the best record there is, so it is
    // kept as it is (only marked as checked); an SR that never had a history gets an empty one so it is not asked for again.
    const [done] = await pool.query('UPDATE request_history SET source_updated_at = ?, fetched_at = NOW() WHERE me_id = ? AND events > 0', [req.last_updated_at || null, req.me_id]);
    if (!done.affectedRows) await storeWithRetry(req, parseHistory([], req, { timeZone: config.timeZone }));
    return false;
  }
  await storeWithRetry(req, parseHistory(events, req, { timeZone: config.timeZone, truncated }));
  return true;
}

// Makes sure the SR has an up-to-date history, fetching it now if it has none (used when someone opens an SR).
async function ensure(meId) {
  const [[req]] = await pool.query(
    `SELECT r.me_id, r.technician, r.status, r.created_at, r.assigned_at, r.completed_at, r.last_updated_at, h.source_updated_at, h.me_id AS has_history
     FROM requests r LEFT JOIN request_history h ON h.me_id = r.me_id WHERE r.me_id = ?`, [meId]);
  if (!req) return false;
  const stale = !req.has_history || String(req.source_updated_at ?? '') !== String(req.last_updated_at ?? '');
  if (!stale) return true;
  await connections.ready();
  const config = me.getConfig();
  if (me.missingConfig(config).length) return !!req.has_history;
  try { await collectOne(config, req); return true; } catch { return !!req.has_history; }
}

// ── The background collector ──
let live = null;
let lastRun = null;
let stopRequested = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pendingCount() {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM requests r LEFT JOIN request_history h ON h.me_id = r.me_id
     WHERE r.in_scope = 1 AND (h.me_id IS NULL OR NOT (h.source_updated_at <=> r.last_updated_at))`);
  return row.n;
}

let starting = null;

// trigger: 'manual' | 'auto'. rebuild: re-read every SR's history, not only the ones with none or changed.
// Returns the run in flight, or null when there was nothing to do (or another copy of the app is already collecting).
function startHistorySync(options = {}) {
  if (live) return Promise.resolve(live);
  if (!starting) starting = beginHistory(options).finally(() => { starting = null; });
  return starting;
}

async function beginHistory({ trigger = 'manual', startedBy = null, rebuild = false } = {}) {
  await connections.ready();
  await settings.getAll();
  const config = me.getConfig();
  const missing = me.missingConfig(config);
  if (missing.length) throw new Error(`ManageEngine is not configured: ${missing.join(', ')}`);
  // Only one collector at a time across every copy of the app on this database (two of them only duplicate the work, fight over
  // the same rows and share one ManageEngine rate limit).
  const release = await acquireRunLock('history');
  if (!release) return null;
  let runId;
  let queued;
  let startedAt;
  try {
    // We hold the lock, so a "running" history row is one a crash left behind.
    await pool.query("UPDATE sync_runs SET status = 'failed', finished_at = NOW(), message = 'Interrupted (the app stopped while this was running)' WHERE status = 'running' AND mode = 'history'");
    // A rebuild marks every SR's history as out of date; the collector below then re-reads them all (newest changes first).
    if (rebuild) await pool.query("UPDATE request_history SET source_updated_at = '1970-01-02 00:00:00'");
    queued = await pendingCount();
    if (!queued && !rebuild) { await release(); return null; }
    const [[clock]] = await pool.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS now");
    startedAt = clock.now;
    const [result] = await pool.query(
      "INSERT INTO sync_runs (mode, trigger_source, started_by, started_at, status, scanned, message) VALUES ('history', ?, ?, ?, 'running', ?, 'Starting...')",
      [trigger, startedBy, startedAt, queued],
    );
    runId = result.insertId;
  } catch (error) {
    await release();
    throw error;
  }
  stopRequested = false;
  live = { runId, mode: 'history', trigger, startedBy, status: 'running', startedAt, total: queued, done: 0, failed: 0, missing: 0, message: 'Starting...', startedMs: Date.now() };

  (async () => {
    const attempted = new Set();
    let consecutiveFailures = 0;
    let throttledFailures = 0; // ManageEngine / Zoho said "too many requests" even after waiting: stop and leave it alone for a while
    const tooMany = () => consecutiveFailures >= settings.num('history_max_failures') || throttledFailures >= settings.num('history_max_throttled');
    let lastWrite = 0;
    const record = async (force = false) => {
      if (!force && Date.now() - lastWrite < 3000) return;
      lastWrite = Date.now();
      await pool.query('UPDATE sync_runs SET scanned = ?, fetched = ?, updated = ?, removed = ?, message = ? WHERE id = ?',
        [live.total, live.done, live.failed, live.missing, live.message, live.runId]).catch(() => {});
    };
    try {
      for (;;) {
        const [batch] = await pool.query(
          `SELECT r.me_id, r.technician, r.status, r.created_at, r.assigned_at, r.completed_at, r.last_updated_at
           FROM requests r LEFT JOIN request_history h ON h.me_id = r.me_id
           WHERE r.in_scope = 1 AND (h.me_id IS NULL OR NOT (h.source_updated_at <=> r.last_updated_at))
           ORDER BY (r.status = 'Closed'), r.created_at DESC LIMIT ?`, [BATCH]);
        const todo = batch.filter(r => !attempted.has(r.me_id));
        if (!todo.length || stopRequested) break;
        let index = 0;
        const worker = async () => {
          while (index < todo.length && !stopRequested && !tooMany()) {
            const req = todo[index++];
            attempted.add(req.me_id);
            try {
              const found = await collectOne(config, req);
              if (!found) live.missing++;
              live.done++;
              consecutiveFailures = 0;
              throttledFailures = 0;
            } catch (error) {
              live.failed++;
              consecutiveFailures++;
              if (error.throttled) throttledFailures++;
              live.lastError = error.message;
            }
            const per = (Date.now() - live.startedMs) / Math.max(live.done, 1);
            const left = Math.max(live.total - live.done, 0);
            live.message = `Collected history for ${live.done.toLocaleString('en-US')} of ${live.total.toLocaleString('en-US')} SRs${live.done > 20 && left ? ` (about ${Math.max(1, Math.round((left * per) / 60000))} min left)` : ''}`;
            await record();
          }
        };
        await Promise.all(Array.from({ length: concurrency() }, worker));
        if (tooMany()) throw new Error(`Stopped after repeated errors: ${live.lastError}`);
      }
      live.status = stopRequested ? 'stopped' : live.failed && !live.done ? 'failed' : 'success';
      live.message = stopRequested
        ? `Stopped after collecting history for ${live.done.toLocaleString('en-US')} SRs`
        : `Collected history for ${live.done.toLocaleString('en-US')} SRs${live.failed ? `; ${live.failed} could not be read and will be retried` : ''}`;
    } catch (error) {
      live.status = 'failed';
      live.message = error.message;
    }
    try {
      await pool.query('UPDATE sync_runs SET status = ?, finished_at = NOW(), scanned = ?, fetched = ?, updated = ?, removed = ?, message = ? WHERE id = ?',
        [live.status === 'stopped' ? 'failed' : live.status, live.total, live.done, live.failed, live.missing, live.message, live.runId]);
    } catch (error) { console.error('Could not record the history result:', error.message); }
    // Lazy: analytics requires this module, so it cannot be required at the top.
    try { require('./analytics').invalidateCache(); } catch { /* cache only */ }
    lastRun = { ...live, finishedMs: Date.now() };
    live = null;
    await release();
  })();

  return live;
}

function stopHistorySync() { if (live) stopRequested = true; return !!live; }

async function historyStatus() {
  const [[stored]] = await pool.query('SELECT COUNT(*) AS n FROM request_history');
  const [[total]] = await pool.query('SELECT COUNT(*) AS n FROM requests WHERE in_scope = 1');
  const [[latest]] = await pool.query("SELECT * FROM sync_runs WHERE mode = 'history' ORDER BY id DESC LIMIT 1");
  const pending = await pendingCount();
  return {
    running: live ? { ...live } : await externalRun('history'),
    latest: latest || null,
    lastRun: !live ? lastRun : null,
    collected: stored.n,
    total: total.n,
    pending,
    auto: String(await settings.get('history_auto')) !== '0',
    concurrency: concurrency(),
  };
}

// Called by the scheduler: collects whatever is missing or changed, unless switched off or already running.
async function tickHistory() {
  if (live || starting || me.missingConfig().length) return;
  // After a run that died on repeated errors (ManageEngine throttling or down) leave ManageEngine alone for a while.
  if (lastRun && lastRun.status === 'failed' && Date.now() - lastRun.finishedMs < settings.num('history_cooldown_minutes') * 60 * 1000) return;
  if (String(await settings.get('history_auto')) === '0') return;
  await startHistorySync({ trigger: 'auto' });
}

module.exports = { acquireRunLock, externalRun, parseHistory, ensure, startHistorySync, stopHistorySync, historyStatus, tickHistory, pendingCount, SUMMARY_COLUMNS };
