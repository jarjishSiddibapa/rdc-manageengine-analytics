const { pool } = require('../db/pool');
const history = require('./history');
const settings = require('./settings');

// Turnaround (TAT) analytics over this app's own copy of ManageEngine's requests (table `requests`).
//
// The clock can start in one of two places, chosen per request by the `basis` filter:
//   'assigned' (default)  when ManageEngine assigned the SR to its technician  ->  how long the technician took
//   'raised'              when the requester raised the SR                     ->  how long the requester waited
// Both end when ManageEngine recorded the SR as completed. Time is calendar time (weekends included), whole minutes.

const MINUTE_MS = 60 * 1000;
const DAY_MINUTES = 24 * 60;
const BASES = ['assigned', 'raised'];

// ── Configuration ──
// Every threshold, target, bucket edge and list size below used to be a fixed number. They are settings now (Admin -> Settings ->
// Analytics); cfg() turns the current settings into the ready-to-use structures and is rebuilt only when a setting has changed.
// The defaults reproduce the old numbers exactly: ranked from 5 closures, due-time figures from 20, targets of 1 / 3 / 7 days, the six
// time-to-close buckets, the six first-reply buckets, and reassignments counted as 0 / 1 / 2 / 3+.
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
const times = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Buckets of days: 1,3,7,14,28 -> Under 1 day, 1 - 3 days, 3 - 7 days, 1 - 2 weeks, 2 - 4 weeks, Over 4 weeks. Whole weeks (14 days and up)
// are written in weeks. Keys (lt1d, 1to3d, ... gt4w) are what the screens send back when a bar is clicked.
function dayBuckets(edges) {
  const weekly = (a, b) => b >= 14 && b % 7 === 0 && a % 7 === 0;
  const buckets = edges.map((b, i) => {
    const a = i ? edges[i - 1] : 0;
    const w = weekly(a, b);
    const unit = w ? 7 : 1;
    const word = w ? 'week' : 'day';
    const letter = w ? 'w' : 'd';
    const upper = b / unit;
    return i === 0
      ? { key: `lt${upper}${letter}`, label: `Under ${times(upper, word)}`, max: b * DAY_MINUTES }
      : { key: `${a / unit}to${upper}${letter}`, label: `${a / unit} - ${times(upper, word)}`, max: b * DAY_MINUTES };
  });
  const last = edges[edges.length - 1];
  const w = last >= 14 && last % 7 === 0;
  buckets.push({ key: `gt${w ? last / 7 : last}${w ? 'w' : 'd'}`, label: `Over ${times(w ? last / 7 : last, w ? 'week' : 'day')}`, max: Infinity });
  return buckets;
}

// Buckets of minutes: 15,60,240,1440,4320 -> Under 15 min, 15 min - 1 hour, 1 - 4 hours, 4 - 24 hours, 1 - 3 days, Over 3 days.
function replyBuckets(edges) {
  const unitOf = v => (v > 1440 && v % 1440 === 0 ? { size: 1440, word: 'day' } : v % 60 === 0 ? { size: 60, word: 'hour' } : { size: 1, word: 'min' });
  const full = v => { const u = unitOf(v); const n = v / u.size; return u.word === 'min' ? `${n} min` : times(n, u.word); };
  const keyOf = v => (v % 1440 === 0 ? `${v / 1440}d` : v % 60 === 0 ? `${v / 60}h` : `${v}m`);
  const buckets = edges.map((b, i) => {
    if (i === 0) return { key: `lt${keyOf(b)}`, label: `Under ${full(b)}`, max: b };
    const a = edges[i - 1];
    const u = unitOf(b);
    const from = a % u.size === 0 ? String(a / u.size) : full(a);
    return { key: `lt${keyOf(b)}`, label: `${from} - ${full(b)}`, max: b };
  });
  const last = edges[edges.length - 1];
  buckets.push({ key: `gt${keyOf(last)}`, label: `Over ${full(last)}`, max: Infinity });
  return buckets;
}

// Reassignment counts: 0, 1, 2 ... and one last bucket for "this many or more".
function reassignBuckets(top) {
  const out = [];
  for (let n = 0; n < top; n++) out.push({ key: String(n), label: n === 0 ? 'Never reassigned' : n === 1 ? 'Reassigned once' : n === 2 ? 'Reassigned twice' : `Reassigned ${NUMBER_WORDS[n] || n} times` });
  out.push({ key: `${top}+`, label: `${capital(NUMBER_WORDS[top] || String(top))} or more times` });
  return out;
}

let cfgVersion = -1;
let cfgValue = null;
function cfg() {
  const version = settings.version();
  if (cfgValue && cfgVersion === version) return cfgValue;
  const n = key => settings.num(key);
  cfgValue = {
    minSample: n('min_ranked_closed'),
    minDue: n('min_due_sample'),
    targets: [n('target_days_1'), n('target_days_2'), n('target_days_3')],
    replyTargets: [n('first_reply_target_1_minutes'), n('first_reply_target_2_minutes')],
    stale: [n('stale_days_1'), n('stale_days_2')],
    tat: dayBuckets(settings.ints('tat_bucket_edges')),
    aging: dayBuckets(settings.ints('aging_bucket_edges')),
    reply: replyBuckets(settings.ints('reply_bucket_edges')),
    reassign: reassignBuckets(n('reassign_bucket_max')),
    reassignTop: n('reassign_bucket_max'),
    weekends: settings.flag('count_weekends'),
    recentDays: n('recent_window_days'),
    topMatrix: n('top_n_matrix'),
    topHandovers: n('top_n_handovers'),
    pageDefault: n('default_page_size'),
    pageMax: n('records_max_page_size'),
    slaGood: n('insight_sla_good_pct'),
    slaBad: n('insight_sla_bad_pct'),
    diffPct: n('insight_diff_pct'),
    gapPoints: n('insight_gap_points'),
    p90Ratio: n('insight_p90_ratio'),
  };
  cfgVersion = version;
  return cfgValue;
}

// "1 day", "3 days" - for the sentences the app writes.
const dayWord = days => times(days, 'day');
// ManageEngine only sets due times when SLAs are configured. Below this many closed SRs with a due time, due-time figures say nothing.
const hasDueTimes = summary => (summary?.sla_measured || 0) >= cfg().minDue;

const GROUP_DIMENSIONS = ['technician', 'month', 'week', 'category', 'priority', 'group', 'request_type', 'status', 'site', 'mode'];
// Open SRs have no "closed month", so period dimensions describe closed work only.
const PERIOD_DIMENSIONS = new Set(['month', 'week']);
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Time helpers. Stored values are wall-clock strings ("YYYY-MM-DD HH:MM:SS"); reading them as UTC keeps every
// difference independent of the server's own timezone. ──
const twoDigits = (text, at) => (text.charCodeAt(at) - 48) * 10 + text.charCodeAt(at + 1) - 48;

function wallClockMs(value) {
  if (!value) return null;
  const text = typeof value === 'string' ? value : String(value);
  // Fast path for the stored "YYYY-MM-DD HH:MM:SS" (this runs several times for each of the 64,000 SRs).
  if (text.length === 19 && text.charCodeAt(4) === 45 && text.charCodeAt(10) === 32 && text.charCodeAt(13) === 58) {
    const ms = Date.UTC(twoDigits(text, 0) * 100 + twoDigits(text, 2), twoDigits(text, 5) - 1, twoDigits(text, 8), twoDigits(text, 11), twoDigits(text, 14), twoDigits(text, 17));
    if (!Number.isNaN(ms)) return ms;
  }
  return slowWallClockMs(text);
}

function slowWallClockMs(value) {
  const text = String(value).trim();
  const parsable = text.replace(' ', 'T');
  const ms = Date.parse(parsable.length === 10 ? `${parsable}T00:00:00Z` : `${parsable}Z`);
  return Number.isNaN(ms) ? null : ms;
}

// Minutes of Saturday and Sunday inside [s, e) (wall-clock milliseconds, s <= e).
function weekendMs(s, e) {
  const WEEK = 7 * DAY_MINUTES * MINUTE_MS;
  const weeks = Math.floor((e - s) / WEEK);
  let total = weeks * 2 * DAY_MINUTES * MINUTE_MS; // every whole week holds exactly one Saturday and one Sunday
  let cursor = s + weeks * WEEK;
  while (cursor < e) {
    const day = new Date(cursor);
    const nextMidnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1);
    const segmentEnd = Math.min(nextMidnight, e);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) total += segmentEnd - cursor;
    cursor = segmentEnd;
  }
  return total;
}

// Whole minutes from start to end (wall-clock milliseconds). Calendar time, unless the "count weekends" setting is off.
function elapsedMinutes(startMs, endMs) {
  if (cfg().weekends) return Math.round((endMs - startMs) / MINUTE_MS);
  const [from, to, sign] = endMs >= startMs ? [startMs, endMs, 1] : [endMs, startMs, -1];
  return sign * Math.round((to - from - weekendMs(from, to)) / MINUTE_MS);
}

function minutesBetween(startValue, endValue) {
  const start = wallClockMs(startValue);
  const end = wallClockMs(endValue);
  if (start === null || end === null) return null;
  return elapsedMinutes(start, end);
}

const dateOnly = value => (value ? String(value).slice(0, 10) : null);

// Monday of the week containing the given YYYY-MM-DD date.
const weekStarts = new Map();
function weekStart(dateText) {
  const cached = weekStarts.get(dateText);
  if (cached !== undefined) return cached;
  const ms = wallClockMs(dateText);
  if (ms === null) return null;
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  const monday = new Date(ms - sinceMonday * DAY_MINUTES * MINUTE_MS).toISOString().slice(0, 10);
  if (weekStarts.size < 20000) weekStarts.set(dateText, monday);
  return monday;
}

const addDays = (dateText, days) => new Date(wallClockMs(dateText) + days * DAY_MINUTES * MINUTE_MS).toISOString().slice(0, 10);

const UNASSIGNED = '(Unassigned)';
const canonicalTechnician = name => String(name || '').trim() || UNASSIGNED;

// Turns one `requests` row (dateStrings: true, so dates arrive as strings) into the record every metric works from.
function shapeRecord(row, now, basis = 'assigned') {
  const closedStatus = row.status === 'Closed';
  const raised = row.created_at || null;
  const assigned = row.assigned_at || null;
  const closedAt = closedStatus ? row.completed_at || null : null;

  // 'assigned' falls back to the raised time when the SR was never assigned, or was (re)assigned after it was already closed.
  let start = basis === 'raised' ? raised : (assigned || raised);
  let startFallback = basis !== 'raised' && !assigned;
  if (basis !== 'raised' && assigned && closedAt && assigned > closedAt) { start = raised; startFallback = true; }

  const startMs = start ? wallClockMs(start) : null;
  const closedMs = closedAt ? wallClockMs(closedAt) : null;
  const nowMs = wallClockMs(now);
  const dueMs = row.due_by ? wallClockMs(row.due_by) : null;
  const tat = closedMs !== null && startMs !== null ? elapsedMinutes(startMs, closedMs) : null;
  const resolved = tat !== null && tat >= 0;
  const handling = shapeHandling(row, { basis, raised, start, startFallback, closedStatus, resolved, tat, now });

  return {
    id: row.me_id,
    sr_number: row.display_id,
    description: row.subject || null,
    technician: canonicalTechnician(row.technician),
    category: row.category || null,
    subcategory: row.subcategory || null,
    priority: row.priority || null,
    group: row.group_name || null,
    site: row.site || null,
    request_type: row.request_type || null,
    mode: row.mode || null,
    status: row.status,
    manageengine_status: row.status_name || null,
    requester: row.requester || null,
    raised_at: raised,
    assigned_at: assigned,
    start_at: start,
    start_fallback: startFallback,
    closed_at: closedAt,
    resolved,
    tat_minutes: resolved ? tat : null,
    age_minutes: !closedStatus && start ? Math.max(0, startMs !== null && nowMs !== null ? elapsedMinutes(startMs, nowMs) : 0) : null,
    due_by: row.due_by || null,
    overdue: !closedStatus && dueMs !== null && nowMs !== null && dueMs < nowMs,
    sla_met: resolved && dueMs !== null && closedMs !== null ? closedMs <= dueMs : null,
    ...handling,
  };
}

const orNull = value => (value === null || value === undefined ? null : value);
const nonNegative = minutes => (minutes === null || minutes === undefined ? null : Math.max(0, minutes));

// The SR's change-log figures (from `request_history`) as seen from the chosen clock. All null when the history has not been collected yet.
function shapeHandling(row, { basis, raised, start, startFallback, closedStatus, resolved, tat, now }) {
  const ready = row.hist !== null && row.hist !== undefined;
  if (!ready) {
    return {
      history_ready: false, assignments: null, reassignments: null, technicians_involved: null, path: null, first_assigned_by: null,
      time_to_assign_minutes: null, first_response_minutes: null, tech_replies: null, requester_replies: null, reopens: null,
      closed_by: null, closure_code: null, fcr: null, worklog_minutes: null, worklog_count: null, notes_count: null, attachments: null,
      group_changes: null, priority_changes: null, category_changes: null, forwards: null, merged: null, hold_minutes: null,
      closed_gap_minutes: null, est_wait_minutes: null, active_minutes: null, idle_minutes: null, last_activity_at: null,
    };
  }
  const fromRaised = basis === 'raised';
  const hold = fromRaised ? row.hold_all : row.hold_asg;
  const gap = fromRaised ? row.gap_all : row.gap_asg;
  const wait = fromRaised ? row.wait_all : row.wait_asg;
  // From the assignment: the first reply after the SR reached its current technician. When the SR was never assigned, or was assigned
  // only after it closed, the clock runs from the raised time, so the first reply of all counts.
  const respAt = fromRaised || startFallback ? row.first_response_at : row.first_response_assigned_at;
  const respFrom = fromRaised ? raised : start;
  const last = row.last_activity_at || row.status_since || null;
  return {
    history_ready: true,
    assignments: row.assignments,
    reassignments: row.reassignments,
    technicians_involved: row.technicians_involved,
    path: row.tech_path ? String(row.tech_path).split(' > ') : null,
    first_assigned_by: row.first_assigned_by || null,
    time_to_assign_minutes: row.first_assigned_at && raised ? nonNegative(minutesBetween(raised, row.first_assigned_at)) : null,
    first_response_minutes: respAt && respFrom ? nonNegative(minutesBetween(respFrom, respAt)) : null,
    tech_replies: row.tech_replies,
    requester_replies: row.requester_replies,
    reopens: row.reopen_count,
    closed_by: row.closed_by || null,
    closure_code: row.closure_code || null,
    fcr: closedStatus ? orNull(row.fcr) : null,
    worklog_minutes: row.worklog_minutes,
    worklog_count: row.worklog_count,
    notes_count: row.notes_count,
    attachments: row.attachments,
    group_changes: row.group_changes,
    priority_changes: row.priority_changes,
    category_changes: row.category_changes,
    forwards: row.forwards,
    merged: row.merged,
    hold_minutes: closedStatus ? orNull(hold) : null,
    closed_gap_minutes: closedStatus ? orNull(gap) : null,
    est_wait_minutes: closedStatus ? orNull(wait) : null,
    // Turnaround without the time the SR sat on hold or closed-and-awaiting-reopen: what the technician actually had it in hand.
    active_minutes: closedStatus && resolved && hold !== null && hold !== undefined ? Math.max(0, tat - hold - (gap || 0)) : null,
    idle_minutes: !closedStatus && last ? nonNegative(minutesBetween(last, now)) : null,
    last_activity_at: row.last_activity_at || null,
  };
}

// The change-log columns joined onto each request (`hist` is NULL when the history has not been collected yet).
const HISTORY_SELECT = `h.me_id AS hist, h.assignments, h.reassignments, h.technicians_involved, h.tech_path, h.first_assigned_at,
           h.first_assigned_by, h.first_response_at, h.first_response_assigned_at, h.tech_replies, h.requester_replies, h.last_activity_at,
           h.status_since, h.reopen_count, h.closed_by, h.closure_code, h.fcr, h.hold_all, h.gap_all, h.wait_all, h.hold_asg, h.gap_asg,
           h.wait_asg, h.worklog_count, h.worklog_minutes, h.notes_count, h.attachments, h.group_changes, h.priority_changes,
           h.category_changes, h.forwards, h.merged`;

// ── Loading ──
// The whole table is read once into a *snapshot* that every call shares: the rows, the shaped records for each basis and the finished
// results of the builders below. A snapshot stays valid until the database says something changed, which is checked with a cheap
// fingerprint at most every CHECK_EVERY_MS (so a sync run by the command line, or the background history collector, is picked up
// without reloading 64,000 rows each time). Everything that comes out of a snapshot is shared: callers must treat it as read-only.
const CHECK_EVERY_MS = 8 * 1000;
// "Now" (used for the age of open SRs and idle time) is refreshed this often; results derived from the old clock are dropped with it.
const CLOCK_EVERY_MS = 3 * 60 * 1000;
// While the background history collector is writing, new history is picked up this often.
const HISTORY_REFRESH_MS = 15 * 1000;
const MEMO_LIMIT = 50;

let snapshot = null;
let loading = null;
let generation = 0;

// Called after every sync / history run in this process.
function invalidateCache() { generation++; snapshot = null; }

// The current wall-clock time of the ManageEngine portal, in the same "YYYY-MM-DD HH:MM:SS" form the stored times use. It does not
// depend on the timezone of this PC or of the MySQL server.
function wallClockNow() {
  const zone = settings.str('portal_time_zone') || 'Asia/Kolkata';
  try {
    const parts = {};
    for (const p of new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date())) parts[p.type] = p.value;
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  } catch {
    const d = new Date();
    const two = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  }
}

// Something that changes whenever the requests, their history or the roster change (kept apart, they are reloaded separately).
async function fingerprint() {
  const [[requests], [history], roster] = await Promise.all([
    pool.query("SELECT COUNT(*) AS n, SUM(in_scope) AS s, SUM(status = 'Closed') AS c, MAX(last_synced_at) AS m, SUM(UNIX_TIMESTAMP(last_updated_at)) AS u FROM requests"),
    pool.query('SELECT COUNT(*) AS n, MAX(fetched_at) AS m, SUM(events) AS e, SUM(reassignments + reopen_count + tech_replies) AS x FROM request_history'),
    pool.query('SELECT COUNT(*) AS n, MAX(updated_at) AS m FROM technicians').catch(() => [[{}]]),
  ]);
  return { requests: JSON.stringify(requests[0]), history: JSON.stringify(history[0]), roster: JSON.stringify(roster[0][0]) };
}

async function loadRoster() {
  try {
    const [rows] = await pool.query('SELECT name, email, department FROM technicians');
    return rows;
  } catch { return []; }
}

async function loadRequestRows() {
  const [rows] = await pool.query(`SELECT r.me_id, r.display_id, r.subject, r.status, r.status_name, r.technician, r.technician_email, r.requester, r.category,
           r.subcategory, r.priority, r.request_type, r.group_name, r.site, r.mode, r.created_at, r.assigned_at, r.completed_at, r.due_by, r.in_scope
           FROM requests r`);
  return rows;
}

// `previous` (when only the history changed) lets the unchanged requests and roster be reused instead of read again.
async function readSnapshot(fp, previous) {
  const reuse = previous && previous.fp.requests === fp.requests && previous.fp.roster === fp.roster;
  // Plain scans joined here are several times faster than the same join inside MySQL.
  const [requests, [histories], roster] = await Promise.all([
    reuse ? previous.requestRows : loadRequestRows(),
    pool.query(`SELECT ${HISTORY_SELECT} FROM request_history h`),
    reuse ? previous.roster : loadRoster(),
  ]);
  const byId = new Map();
  for (const h of histories) byId.set(h.hist, h);
  const rows = [];
  for (const r of requests) {
    if (r.in_scope !== 1) continue;
    const h = byId.get(r.me_id);
    rows.push(h ? { ...r, ...h } : r);
  }
  let emailByName = reuse ? previous.emailByName : null;
  if (!emailByName) {
    emailByName = new Map();
    for (const row of rows) if (row.technician && row.technician_email && !emailByName.has(row.technician)) emailByName.set(row.technician, row.technician_email);
  }
  const clock = Date.now();
  return { requestRows: requests, rows, roster, emailByName, fp, now: wallClockNow(), clockAt: clock, loadedAt: clock, checkedAt: clock, shaped: new Map(), memo: new Map() };
}

function getSnapshot() {
  if (snapshot && Date.now() - snapshot.checkedAt < CHECK_EVERY_MS) return Promise.resolve(snapshot);
  // One load at a time, shared by everyone waiting; a load that began before the last invalidateCache() is never reused.
  if (!loading || loading.generation !== generation) {
    const startedIn = generation;
    const promise = (async () => {
      const fp = await fingerprint();
      const current = snapshot;
      let next = current;
      if (!current || fp.requests !== current.fp.requests || fp.roster !== current.fp.roster) next = await readSnapshot(fp, current);
      // The history collector writes all the time; its progress is picked up at most every HISTORY_REFRESH_MS
      // (and exactly when a collection finishes, which calls invalidateCache()).
      else if (fp.history !== current.fp.history && Date.now() - current.loadedAt >= HISTORY_REFRESH_MS) next = await readSnapshot(fp, current);
      next.checkedAt = Date.now();
      if (next.checkedAt - next.clockAt >= CLOCK_EVERY_MS) {
        next = { ...next, now: wallClockNow(), clockAt: next.checkedAt, shaped: new Map(), memo: new Map() };
      }
      if (startedIn === generation) snapshot = next;
      return next;
    })();
    loading = { promise, generation: startedIn };
    promise.catch(() => {}).finally(() => { if (loading && loading.promise === promise) loading = null; });
  }
  return loading.promise;
}

// The shaped records of a snapshot for one basis (computed once, then shared).
function recordsFor(snap, basis) {
  let records = snap.shaped.get(basis);
  if (!records) {
    records = snap.rows.map(row => shapeRecord(row, snap.now, basis));
    snap.shaped.set(basis, records);
  }
  return records;
}

// Finished results of a snapshot, by key; the oldest are dropped past MEMO_LIMIT. Failures are not kept.
function memoized(snap, key, compute) {
  let hit = snap.memo.get(key);
  if (hit) {
    snap.memo.delete(key);
    snap.memo.set(key, hit);
    return hit;
  }
  hit = Promise.resolve().then(compute);
  snap.memo.set(key, hit);
  if (snap.memo.size > MEMO_LIMIT) snap.memo.delete(snap.memo.keys().next().value);
  hit.catch(() => { if (snap.memo.get(key) === hit) snap.memo.delete(key); });
  return hit;
}

async function loadRecords(basis) {
  const snap = await getSnapshot();
  return { now: snap.now, records: recordsFor(snap, basis) };
}

// ── Filters ──
function toList(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  return String(value || '').split('||').map(v => v.trim()).filter(Boolean);
}

const validDate = value => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null);

function parseFilters(query = {}) {
  let from = validDate(query.from);
  let to = validDate(query.to);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    basis: BASES.includes(query.basis) ? query.basis : 'assigned',
    from,
    to,
    technicians: toList(query.technician),
    categories: toList(query.category),
    priorities: toList(query.priority),
    groups: toList(query.group),
    requestTypes: toList(query.request_type),
    statuses: toList(query.status),
    search: String(query.search || '').trim().toLowerCase() || null,
    // 'all' | 'closed' | 'open' - only the raw record list uses this; metrics always use both.
    state: ['closed', 'open'].includes(query.state) ? query.state : 'all',
  };
}

const lowerSet = list => new Set(list.map(v => v.toLowerCase()));

// Everything except the date range. The date range narrows *closed* work (by the day it was closed); open SRs are a live
// snapshot, so a historical range never hides what is still outstanding.
function applyBaseFilters(records, filters) {
  const technicians = lowerSet(filters.technicians);
  const categories = lowerSet(filters.categories);
  const priorities = lowerSet(filters.priorities);
  const groups = lowerSet(filters.groups);
  const types = lowerSet(filters.requestTypes);
  const statuses = lowerSet(filters.statuses);
  return records.filter(r => {
    if (technicians.size && !technicians.has(r.technician.toLowerCase())) return false;
    if (categories.size && !categories.has(String(r.category || '(No category)').toLowerCase())) return false;
    if (priorities.size && !priorities.has(String(r.priority || '(No priority)').toLowerCase())) return false;
    if (groups.size && !groups.has(String(r.group || '(No group)').toLowerCase())) return false;
    if (types.size && !types.has(String(r.request_type || '(No type)').toLowerCase())) return false;
    if (statuses.size && !statuses.has(r.status.toLowerCase())) return false;
    if (filters.search) {
      const haystack = `${r.sr_number} ${r.description || ''} ${r.category || ''} ${r.technician} ${r.requester || ''}`.toLowerCase();
      if (!haystack.includes(filters.search)) return false;
    }
    return true;
  });
}

function applyDateFilter(records, filters) {
  if (!filters.from && !filters.to) return records;
  return records.filter(r => {
    if (r.status !== 'Closed') return true;
    const closedDay = dateOnly(r.closed_at);
    if (!closedDay) return false;
    if (filters.from && closedDay < filters.from) return false;
    if (filters.to && closedDay > filters.to) return false;
    return true;
  });
}

const applyFilters = (records, filters) => applyDateFilter(applyBaseFilters(records, filters), filters);

// ── Statistics ──
// `sorted` is any ascending array-like of numbers (a Float64Array from `ascending()` sorts far faster than a comparator sort).
function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (sorted.length - 1) * p;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

const round = value => (value === null || value === undefined ? null : Math.round(value));
const share = (count, total) => (total ? Math.round((count / total) * 1000) / 10 : null);
const round2 = value => (value === null || value === undefined ? null : Math.round(value * 100) / 100);
const average = values => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);
const ascending = values => Float64Array.from(values).sort();
// Math.max(...values) throws a RangeError once the list is long enough (about 120,000 SRs); this never does.
const maxOf = values => { let best = null; for (const v of values) if (best === null || v > best) best = v; return best; };
const countAtMost = (sorted, limit) => { let n = 0; for (const v of sorted) if (v <= limit) n++; return n; };
const countAtLeast = (sorted, limit) => { let n = 0; for (const v of sorted) if (v >= limit) n++; return n; };

// Closed-work and open-work figures for one set of records. `includeOpen: false` is for period groupings, where "open" has no meaning.
function summarize(records, { includeOpen = true } = {}) {
  const c = cfg();
  let closedCount = 0;
  const tatValues = [];
  const ages = [];
  let fastest = null;
  let slowest = null;
  let slaMeasured = 0;
  let slaMet = 0;
  let open = 0;
  let overdue = 0;
  let onHold = 0;
  let waitingOnUser = 0;
  for (const r of records) {
    if (r.status === 'Closed') {
      closedCount++;
      if (!r.resolved) continue;
      tatValues.push(r.tat_minutes);
      if (!fastest || r.tat_minutes < fastest.tat_minutes) fastest = r;
      if (!slowest || r.tat_minutes > slowest.tat_minutes) slowest = r;
      if (r.sla_met !== null) { slaMeasured++; if (r.sla_met) slaMet++; }
    } else {
      open++;
      if (r.age_minutes !== null) ages.push(r.age_minutes);
      if (r.overdue) overdue++;
      if (r.status === 'On Hold') onHold++;
      if (r.status === 'Pending with User') waitingOnUser++;
    }
  }
  const tats = ascending(tatValues);
  const total = tatValues.reduce((sum, v) => sum + v, 0);

  const summary = {
    closed: closedCount,
    measured: tats.length,
    avg_minutes: tats.length ? round(total / tats.length) : null,
    median_minutes: round(percentile(tats, 0.5)),
    p90_minutes: round(percentile(tats, 0.9)),
    min_minutes: tats.length ? tats[0] : null,
    max_minutes: tats.length ? tats[tats.length - 1] : null,
    fastest_sr: fastest ? fastest.sr_number : null,
    slowest_sr: slowest ? slowest.sr_number : null,
    // The three "closed within N days" targets are settings; the field names keep the original 1 / 3 / 7 so every screen and report reads them.
    within_1d_pct: share(countAtMost(tats, c.targets[0] * DAY_MINUTES), tats.length),
    within_3d_pct: share(countAtMost(tats, c.targets[1] * DAY_MINUTES), tats.length),
    within_7d_pct: share(countAtMost(tats, c.targets[2] * DAY_MINUTES), tats.length),
    sla_measured: slaMeasured,
    sla_met: slaMet,
    sla_met_pct: share(slaMet, slaMeasured),
    open: null,
    open_avg_age_minutes: null,
    open_oldest_minutes: null,
    overdue: null,
    on_hold: null,
    waiting_on_user: null,
    assigned: null,
    closure_rate_pct: null,
    handling: summarizeHandling(records),
  };

  if (includeOpen) {
    summary.open = open;
    summary.open_avg_age_minutes = ages.length ? round(ages.reduce((s, v) => s + v, 0) / ages.length) : null;
    summary.open_oldest_minutes = maxOf(ages);
    summary.overdue = overdue;
    summary.on_hold = onHold;
    summary.waiting_on_user = waitingOnUser;
    summary.assigned = closedCount + open;
    summary.closure_rate_pct = share(closedCount, closedCount + open);
  }
  return summary;
}

// How the SRs were handled, from their change logs: handovers, reopens, first replies, time on hold, idle open SRs.
// Only SRs whose history has been collected count, so the figures never mix "unknown" in as zero (`covered` says how many that is).
function summarizeHandling(records) {
  const c = cfg();
  let covered = 0;
  let closedCovered = 0;
  let openCovered = 0;
  let reassigned = 0;
  let reassignmentSum = 0;
  let maxReassignments = null;
  let multiTechnician = 0;
  let reopened = 0;
  let reopenEvents = 0;
  let fcrKnown = 0;
  let fcrYes = 0;
  let noReply = 0;
  let techReplies = 0;
  let requesterReplies = 0;
  let worklogged = 0;
  let worklogSum = 0;
  let holdKnown = 0;
  let holdCount = 0;
  let holdSum = 0;
  let activeCount = 0;
  let activeSum = 0;
  let activeTatSum = 0;
  const responses = [];
  const toAssign = [];
  const idle = [];
  for (const r of records) {
    if (!r.history_ready) continue;
    covered++;
    if (r.reassignments > 0) reassigned++;
    reassignmentSum += r.reassignments;
    if (maxReassignments === null || r.reassignments > maxReassignments) maxReassignments = r.reassignments;
    if (r.technicians_involved > 1) multiTechnician++;
    if (r.first_response_minutes === null) noReply++; else responses.push(r.first_response_minutes);
    if (r.time_to_assign_minutes !== null) toAssign.push(r.time_to_assign_minutes);
    techReplies += r.tech_replies;
    requesterReplies += r.requester_replies;
    if (r.worklog_count > 0) { worklogged++; worklogSum += r.worklog_minutes; }
    if (r.status === 'Closed') {
      closedCovered++;
      if (r.reopens > 0) { reopened++; reopenEvents += r.reopens; }
      if (r.fcr !== null) { fcrKnown++; if (r.fcr === 1) fcrYes++; }
      if (r.hold_minutes !== null) { holdKnown++; if (r.hold_minutes > 0) { holdCount++; holdSum += r.hold_minutes; } }
      if (r.active_minutes !== null && r.resolved) { activeCount++; activeSum += r.active_minutes; activeTatSum += r.tat_minutes; }
    } else {
      openCovered++;
      if (r.idle_minutes !== null) idle.push(r.idle_minutes);
    }
  }
  const responseTimes = ascending(responses);
  const assignTimes = ascending(toAssign);
  const idleTimes = ascending(idle);
  return {
    covered,
    of: records.length,
    coverage_pct: share(covered, records.length),
    reassigned,
    reassigned_pct: share(reassigned, covered),
    avg_reassignments: covered ? round2(reassignmentSum / covered) : null,
    max_reassignments: maxReassignments,
    multi_technician: multiTechnician,
    reopened,
    reopened_pct: share(reopened, closedCovered),
    reopen_events: reopenEvents,
    fcr_pct: share(fcrYes, fcrKnown),
    fcr_measured: fcrKnown,
    response_measured: responseTimes.length,
    median_first_response_minutes: round(percentile(responseTimes, 0.5)),
    avg_first_response_minutes: round(average(responseTimes)),
    p90_first_response_minutes: round(percentile(responseTimes, 0.9)),
    // First-reply targets 1 and 2 (settings; 1 hour and 1 day by default).
    response_within_1h_pct: share(countAtMost(responseTimes, c.replyTargets[0]), responseTimes.length),
    response_within_1d_pct: share(countAtMost(responseTimes, c.replyTargets[1]), responseTimes.length),
    // SRs with no reply on this clock yet (the same SRs as the "No reply yet" bar and its drill-down).
    no_reply: noReply,
    median_time_to_assign_minutes: round(percentile(assignTimes, 0.5)),
    avg_time_to_assign_minutes: round(average(assignTimes)),
    avg_tech_replies: covered ? round2(techReplies / covered) : null,
    avg_requester_replies: covered ? round2(requesterReplies / covered) : null,
    worklog_pct: share(worklogged, covered),
    avg_worklog_minutes: worklogged ? round(worklogSum / worklogged) : null,
    total_worklog_minutes: worklogSum,
    on_hold_pct: share(holdCount, holdKnown),
    avg_hold_minutes: holdCount ? round(holdSum / holdCount) : null,
    active_measured: activeCount,
    avg_active_minutes: activeCount ? round(activeSum / activeCount) : null,
    avg_active_tat_minutes: activeCount ? round(activeTatSum / activeCount) : null,
    open_covered: openCovered,
    avg_idle_minutes: round(average(idleTimes)),
    median_idle_minutes: round(percentile(idleTimes, 0.5)),
    max_idle_minutes: idleTimes.length ? idleTimes[idleTimes.length - 1] : null,
    stale_7d: countAtLeast(idleTimes, c.stale[0] * DAY_MINUTES),
    stale_14d: countAtLeast(idleTimes, c.stale[1] * DAY_MINUTES),
  };
}

const reassignKey = count => { const top = cfg().reassignTop; return count >= top ? `${top}+` : String(count); };
const responseIndex = minutes => cfg().reply.findIndex(b => minutes < b.max);

// Everything the "handling" views need for one set of records.
function handlingSection(records) {
  const withHistory = records.filter(r => r.history_ready);
  const reassignments = cfg().reassign.map(b => ({ ...b, count: 0 }));
  for (const r of withHistory) reassignments[cfg().reassign.findIndex(b => b.key === reassignKey(r.reassignments))].count++;
  const responses = cfg().reply.map(b => ({ key: b.key, label: b.label, count: 0 }));
  let noReply = 0;
  for (const r of withHistory) {
    if (r.first_response_minutes === null) noReply++;
    else responses[responseIndex(r.first_response_minutes)].count++;
  }
  const idle = bucketList(cfg().aging);
  for (const r of withHistory) if (r.status !== 'Closed' && r.idle_minutes !== null) idle[bucketIndex(r.idle_minutes, cfg().aging)].count++;

  // By the month the SR was closed: how often work was handed over or reopened, and how fast the first reply came.
  const months = new Map();
  for (const r of withHistory) {
    if (r.status !== 'Closed' || !r.closed_at) continue;
    const key = r.closed_at.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(r);
  }
  const trend = [...months].sort((a, b) => a[0].localeCompare(b[0])).map(([key, members]) => {
    const resp = ascending(members.map(r => r.first_response_minutes).filter(v => v !== null));
    return {
      key,
      closed: members.length,
      reassigned_pct: share(members.filter(r => r.reassignments > 0).length, members.length),
      reopened_pct: share(members.filter(r => r.reopens > 0).length, members.length),
      avg_reassignments: round2(average(members.map(r => r.reassignments))),
      avg_first_response_minutes: round(average(resp)),
      median_first_response_minutes: round(percentile(resp, 0.5)),
    };
  });
  return {
    summary: summarizeHandling(records),
    reassignments: finishBuckets(reassignments),
    responses: finishBuckets([...responses, { key: 'none', label: 'No reply yet', count: noReply }]),
    idle: finishBuckets(idle),
    trend,
  };
}

function bucketIndex(minutes, buckets = cfg().tat) {
  return buckets.findIndex(b => minutes < b.max);
}

function bucketList(buckets = cfg().tat) {
  return buckets.map((b, i) => ({
    key: b.key, label: b.label, count: 0,
    from_minutes: i ? buckets[i - 1].max : 0,
    to_minutes: Number.isFinite(b.max) ? b.max : null,
  }));
}

function finishBuckets(counts) {
  const total = counts.reduce((sum, b) => sum + b.count, 0);
  return counts.map(b => ({ ...b, pct: share(b.count, total) }));
}

// How long closed SRs took.
function distribution(records) {
  const counts = bucketList();
  for (const r of records) if (r.resolved) counts[bucketIndex(r.tat_minutes)].count++;
  return finishBuckets(counts);
}

// How long the SRs that are still open have been open.
function aging(records) {
  const buckets = cfg().aging;
  const counts = bucketList(buckets);
  for (const r of records) if (r.status !== 'Closed' && r.age_minutes !== null) counts[bucketIndex(r.age_minutes, buckets)].count++;
  return finishBuckets(counts);
}

// ── Grouping ──
function dimensionKey(record, dimension) {
  switch (dimension) {
    case 'technician': return record.technician;
    case 'category': return record.category || '(No category)';
    case 'priority': return record.priority || '(No priority)';
    case 'group': return record.group || '(No group)';
    case 'request_type': return record.request_type || '(No type)';
    case 'site': return record.site || '(No site)';
    case 'mode': return record.mode || '(No mode)';
    case 'status': return record.status;
    case 'month': return record.closed_at ? record.closed_at.slice(0, 7) : null;
    case 'week': return record.closed_at ? weekStart(record.closed_at) : null;
    default: return null;
  }
}

function groupRecords(records, dimension) {
  const groups = new Map();
  for (const record of records) {
    const key = dimensionKey(record, dimension);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return groups;
}

function sortGroups(rows, dimension) {
  if (PERIOD_DIMENSIONS.has(dimension)) return rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows.sort((a, b) => (b.closed + (b.open || 0)) - (a.closed + (a.open || 0)) || a.key.localeCompare(b.key));
}

// One row per group of `dimension`, each with its own summary. With `thenBy`, every row also carries `cells`: the same
// summary for each value of the second dimension (a cross-tab), plus the ordered list of column keys.
function explore(records, dimension, thenBy = null) {
  const includeOpen = !PERIOD_DIMENSIONS.has(dimension);
  const columns = thenBy ? [...groupRecords(records, thenBy).keys()].sort((a, b) => a.localeCompare(b)) : [];
  const rows = [...groupRecords(records, dimension)].map(([key, members]) => {
    const row = { key, ...summarize(members, { includeOpen }) };
    if (thenBy) {
      row.cells = {};
      for (const [columnKey, columnMembers] of groupRecords(members, thenBy)) {
        row.cells[columnKey] = summarize(columnMembers, { includeOpen: includeOpen && !PERIOD_DIMENSIONS.has(thenBy) });
      }
    }
    return row;
  });
  return { dimension, thenBy, columns, rows: sortGroups(rows, dimension) };
}

// ── Time series ──
// Monthly closed work: counts and turnaround, for the closed SRs of `records`.
const monthlyTrend = records => explore(records.filter(r => r.status === 'Closed'), 'month').rows;

// Week by week: SRs that started (assigned or raised, per the basis), SRs closed, and the backlog still open at the end of the week.
// `base` must not be date-filtered, or the backlog would forget everything older than the range.
function weeklyFlow(base, filters, nowText) {
  const starts = new Map();
  const closes = new Map();
  // Closed SRs ManageEngine gave no completion time: they started, but can never be dated as closed, so they are not backlog either.
  const undated = new Map();
  let firstWeek = null;
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  for (const r of base) {
    const startDay = dateOnly(r.start_at);
    if (startDay) {
      const w = weekStart(startDay);
      bump(starts, w);
      if (!firstWeek || w < firstWeek) firstWeek = w;
      if (r.status === 'Closed' && !r.closed_at) bump(undated, w);
    }
    const closedDay = dateOnly(r.closed_at);
    if (closedDay) { const w = weekStart(closedDay); bump(closes, w); if (!firstWeek || w < firstWeek) firstWeek = w; }
  }
  if (!firstWeek) return [];
  const lastWeek = weekStart(dateOnly(nowText));
  const shownFrom = filters.from ? weekStart(filters.from) : firstWeek;
  const shownTo = filters.to ? weekStart(filters.to) : lastWeek;
  const rows = [];
  let backlog = 0;
  for (let w = firstWeek; w <= lastWeek; w = addDays(w, 7)) {
    const assigned = starts.get(w) || 0;
    const closed = closes.get(w) || 0;
    // Backlog = every SR started so far minus every SR closed so far (an SR closed in the week it started nets to zero).
    backlog += assigned - closed - (undated.get(w) || 0);
    if (w >= shownFrom && w <= shownTo) rows.push({ key: w, assigned, closed, backlog: Math.max(0, backlog) });
  }
  return rows;
}

// Closed SRs by weekday and hour of the day they were closed: 7 rows (Mon..Sun) of 24 counts.
function closureHeatmap(records) {
  const grid = WEEKDAYS.map(() => new Array(24).fill(0));
  let total = 0;
  for (const r of records) {
    if (r.status !== 'Closed' || !r.closed_at) continue;
    const ms = wallClockMs(r.closed_at);
    if (ms === null) continue;
    const d = new Date(ms);
    grid[(d.getUTCDay() + 6) % 7][d.getUTCHours()]++;
    total++;
  }
  return { days: WEEKDAYS, grid, total };
}

// Technicians (rows) by month closed (columns): closed counts and median turnaround, for the busiest technicians.
function technicianMonthMatrix(records, limit = cfg().topMatrix) {
  const closed = records.filter(r => r.status === 'Closed' && r.closed_at);
  const months = [...new Set(closed.map(r => r.closed_at.slice(0, 7)))].sort();
  const byTech = groupRecords(closed, 'technician');
  const rows = [...byTech].map(([name, members]) => {
    const perMonth = {};
    for (const [month, ms] of groupRecords(members, 'month')) {
      const tats = ms.filter(r => r.resolved).map(r => r.tat_minutes).sort((a, b) => a - b);
      perMonth[month] = { closed: ms.length, avg_minutes: round(average(tats)), median_minutes: round(percentile(tats, 0.5)) };
    }
    return { technician: name, total: members.length, months: perMonth };
  }).sort((a, b) => b.total - a.total).slice(0, limit);
  return { months, rows };
}

function slaBreakdown(records) {
  const measured = records.filter(r => r.status === 'Closed' && r.resolved);
  const met = measured.filter(r => r.sla_met === true).length;
  const missed = measured.filter(r => r.sla_met === false).length;
  return { met, missed, no_due_date: measured.length - met - missed, met_pct: share(met, met + missed) };
}

function statusMix(records) {
  return explore(records, 'status').rows.map(r => ({ key: r.key, count: r.closed + (r.open || 0) }));
}

// ── Facets (everything a filter dropdown can offer) ──
const STATUS_ORDER = ['Open', 'In Progress', 'Pending', 'Pending with User', 'On Hold', 'Closed'];

async function facets(records) {
  const snap = await getSnapshot();
  // The dropdowns always describe the whole data set; when handed that, the answer is shared with every other call.
  if ([...snap.shaped.values()].includes(records)) return memoized(snap, 'facets', () => buildFacets(snap, records));
  return buildFacets(snap, records);
}

function buildFacets(snap, records) {
  const roster = snap.roster;
  const emailByName = new Map(snap.emailByName);

  const stats = new Map();
  for (const r of records) {
    const entry = stats.get(r.technician) || { name: r.technician, assigned: 0, closed: 0, open: 0 };
    entry.assigned++;
    if (r.status === 'Closed') entry.closed++; else entry.open++;
    stats.set(r.technician, entry);
  }
  for (const t of roster) {
    if (!stats.has(t.name)) stats.set(t.name, { name: t.name, assigned: 0, closed: 0, open: 0 });
    if (t.email && !emailByName.has(t.name)) emailByName.set(t.name, t.email);
  }
  const distinct = pick => [...new Set(records.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const closedDays = records.filter(r => r.closed_at).map(r => dateOnly(r.closed_at)).sort();
  const withDue = records.filter(r => r.status === 'Closed' && r.resolved && r.due_by).length;
  const present = new Set(records.map(r => r.status));
  return {
    has_due_times: withDue >= cfg().minDue,
    technicians: [...stats.values()]
      .map(t => ({ ...t, email: emailByName.get(t.name) || null, unassigned: t.name === UNASSIGNED }))
      .sort((a, b) => a.unassigned - b.unassigned || a.name.localeCompare(b.name)),
    categories: distinct(r => r.category),
    priorities: distinct(r => r.priority),
    groups: distinct(r => r.group),
    request_types: distinct(r => r.request_type),
    // Only the statuses that exist in the data (a filter on one that never occurs would just show an empty page).
    statuses: [...STATUS_ORDER.filter(s => present.has(s)), ...[...present].filter(s => !STATUS_ORDER.includes(s)).sort()],
    first_closed: closedDays[0] || null,
    last_closed: closedDays[closedDays.length - 1] || null,
  };
}

// ── Builders ──
async function buildOverview(filters) {
  const snap = await getSnapshot();
  return memoized(snap, `overview|${JSON.stringify(filters)}`, () => computeOverview(snap, filters));
}

async function computeOverview(snap, filters) {
  const now = snap.now;
  const all = recordsFor(snap, filters.basis);
  const base = applyBaseFilters(all, filters);
  const records = applyDateFilter(base, filters);
  const matrix = technicianMonthMatrix(records);
  return {
    generated_at: now,
    basis: filters.basis,
    summary: summarize(records),
    technicians: explore(records, 'technician').rows,
    trend: monthlyTrend(records),
    flow: weeklyFlow(base, filters, now),
    categories: explore(records, 'category').rows,
    priorities: explore(records, 'priority').rows,
    groups: explore(records, 'group').rows,
    request_types: explore(records, 'request_type').rows,
    statuses: statusMix(records),
    distribution: distribution(records),
    aging: aging(records),
    sla: slaBreakdown(records),
    closure_heatmap: closureHeatmap(records),
    technician_months: matrix,
    handling: handlingSection(records),
    facets: await facets(recordsFor(snap, 'assigned')),
  };
}

async function buildExplore(filters, dimension, thenBy) {
  const snap = await getSnapshot();
  return memoized(snap, `explore|${dimension}|${thenBy || ''}|${JSON.stringify(filters)}`, () => {
    const records = applyFilters(recordsFor(snap, filters.basis), filters);
    return {
      generated_at: snap.now,
      basis: filters.basis,
      summary: summarize(records),
      distribution: distribution(records),
      trend: monthlyTrend(records),
      ...explore(records, dimension, thenBy),
    };
  });
}

// Position among the technicians who have enough measured closures (the "(Unassigned)" bucket is not a person). Equal values share a rank.
const rankOf = (rows, name, valueOf, ascending) => {
  const eligible = rows.filter(r => r.key !== UNASSIGNED && r.measured >= cfg().minSample && valueOf(r) !== null && valueOf(r) !== undefined);
  const mine = eligible.find(r => r.key === name);
  if (!mine) return null;
  const value = valueOf(mine);
  const ahead = eligible.filter(r => (ascending ? valueOf(r) < value : valueOf(r) > value)).length;
  return { rank: ahead + 1, of: eligible.length };
};

const pctDiff = (mine, team) => (mine === null || team === null || !team ? null : Math.round(((mine - team) / team) * 1000) / 10);

function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined) return '-';
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  if (m < DAY_MINUTES) return `${Math.floor(m / 60)}h ${m % 60}m`;
  const d = Math.floor(m / DAY_MINUTES);
  const h = Math.round((m % DAY_MINUTES) / 60);
  return h && d < 30 ? `${d}d ${h}h` : `${d}d`;
}

// Plain-language reading of one technician's numbers against the team.
function insights(name, mine, team, ranks, recent) {
  const c = cfg();
  const MIN_SAMPLE = c.minSample;
  const out = [];
  const add = (tone, text) => out.push({ tone, text });
  if (!mine.closed && !mine.open) return [{ tone: 'info', text: `${name} has no SRs in the selected period.` }];

  if (ranks.closed) add('info', `Closed ${mine.closed} SR${mine.closed === 1 ? '' : 's'} — ranked ${ranks.closed.rank} of ${ranks.closed.of} technicians by volume.`);
  else if (mine.closed) add('info', `Closed ${mine.closed} SR${mine.closed === 1 ? '' : 's'}.`);

  if (mine.measured < MIN_SAMPLE) {
    add('info', `Only ${mine.measured} measured closure${mine.measured === 1 ? '' : 's'} so far — too few to rank on speed.`);
  } else {
    // The average leads (it is the figure people expect first); the median, the typical SR, follows.
    const diff = pctDiff(mine.avg_minutes, team.avg_minutes);
    if (diff !== null) {
      const faster = diff < 0;
      add(Math.abs(diff) < c.diffPct ? 'info' : faster ? 'good' : 'warn',
        `Average turnaround ${fmtDuration(mine.avg_minutes)} — ${Math.abs(diff)}% ${faster ? 'faster' : 'slower'} than the team average (${fmtDuration(team.avg_minutes)}); median ${fmtDuration(mine.median_minutes)} against the team's ${fmtDuration(team.median_minutes)}.`);
    }
    if (mine.p90_minutes !== null && team.p90_minutes && mine.p90_minutes > team.p90_minutes * c.p90Ratio) {
      add('warn', `The slowest tenth of their SRs took ${fmtDuration(mine.p90_minutes)} or longer (team: ${fmtDuration(team.p90_minutes)}).`);
    }
  }
  if (hasDueTimes(team) && mine.sla_met_pct !== null && mine.sla_measured >= MIN_SAMPLE) {
    const gap = team.sla_met_pct === null ? 0 : mine.sla_met_pct - team.sla_met_pct;
    add(mine.sla_met_pct >= c.slaGood ? 'good' : mine.sla_met_pct < c.slaBad ? 'bad' : 'info',
      `${mine.sla_met_pct}% closed within the ManageEngine due time${team.sla_met_pct === null ? '' : ` (team ${team.sla_met_pct}%${Math.abs(gap) >= 1 ? `, ${gap > 0 ? '+' : ''}${Math.round(gap * 10) / 10} pts` : ''})`}.`);
  }
  if (!hasDueTimes(team) && mine.measured >= MIN_SAMPLE && mine.within_3d_pct !== null) {
    const gap = team.within_3d_pct === null ? 0 : Math.round((mine.within_3d_pct - team.within_3d_pct) * 10) / 10;
    add(gap >= c.gapPoints ? 'good' : gap <= -c.gapPoints ? 'warn' : 'info', `${mine.within_3d_pct}% of their SRs close within ${dayWord(c.targets[1])} (team ${team.within_3d_pct}%).`);
  }
  if (mine.open) {
    add(mine.overdue ? 'bad' : 'info', `${mine.open} open now${mine.overdue ? `, ${mine.overdue} past their due time` : hasDueTimes(team) ? ', none overdue' : ''}${mine.open_oldest_minutes ? `; the oldest has been open ${fmtDuration(mine.open_oldest_minutes)}` : ''}.`);
    if (mine.waiting_on_user) add('info', `${mine.waiting_on_user} of the open SRs ${mine.waiting_on_user === 1 ? 'is' : 'are'} waiting on the requester, not the technician.`);
  } else {
    add('good', 'Nothing open — the queue is clear.');
  }
  if (recent && (recent.last30 || recent.prev30)) {
    if (recent.last30 > recent.prev30) add('good', `Closing more lately: ${recent.last30} SRs in the last ${dayWord(c.recentDays)} vs ${recent.prev30} in the ${dayWord(c.recentDays)} before.`);
    else if (recent.last30 < recent.prev30) add('warn', `Closing fewer lately: ${recent.last30} SRs in the last ${dayWord(c.recentDays)} vs ${recent.prev30} in the ${dayWord(c.recentDays)} before.`);
  }
  return out;
}

async function buildTechnician(name, filters) {
  const snap = await getSnapshot();
  return memoized(snap, `technician|${String(name).trim().toLowerCase()}|${JSON.stringify(filters)}`, () => computeTechnician(snap, String(name).trim(), filters));
}

function computeTechnician(snap, name, filters) {
  const now = snap.now;
  const all = recordsFor(snap, filters.basis);
  const wanted = name.toLowerCase();
  const existing = all.find(r => r.technician.toLowerCase() === wanted);
  const onRoster = snap.roster.find(t => t.name.toLowerCase() === wanted);
  if (!existing && !onRoster) return null;
  const canonical = existing ? existing.technician : onRoster.name;

  // The team is everyone under the same filters, apart from the technician filter itself.
  const teamFilters = { ...filters, technicians: [] };
  const teamBase = applyBaseFilters(all, teamFilters);
  const team = applyDateFilter(teamBase, teamFilters);
  const mineBase = teamBase.filter(r => r.technician === canonical);
  const mine = applyDateFilter(mineBase, filters);

  const summary = summarize(mine);
  const teamSummary = summarize(team);
  const peers = explore(team, 'technician').rows;
  const dueTimes = hasDueTimes(teamSummary);
  const ranks = {
    closed: rankOf(peers, canonical, r => r.closed, false),
    avg: rankOf(peers, canonical, r => r.avg_minutes, true),
    median: rankOf(peers, canonical, r => r.median_minutes, true),
    // Without due times on the portal, "on target" means closing within the second closing-time target (3 days by default).
    target: rankOf(peers, canonical, r => (dueTimes ? r.sla_met_pct : r.within_3d_pct), false),
    target_label: dueTimes ? 'closed by the due time' : `closed within ${dayWord(cfg().targets[1])}`,
    target_days: dueTimes ? null : cfg().targets[1],
  };

  // SRs closed in the window (now - fromDays, now - toDays]; the two windows meet without overlap or gap.
  const nowMs = wallClockMs(now);
  const closedWithin = (fromDays, toDays) => mineBase.filter(r => {
    const ms = wallClockMs(r.closed_at);
    return ms !== null && ms > nowMs - fromDays * DAY_MINUTES * MINUTE_MS && ms <= nowMs - toDays * DAY_MINUTES * MINUTE_MS;
  }).length;
  // (The field names say 30 for history's sake; the window is the "recent window" setting, reported in `days`.)
  const windowDays = cfg().recentDays;
  const recent = { last30: closedWithin(windowDays, 0), prev30: closedWithin(2 * windowDays, windowDays), days: windowDays };

  const email = snap.emailByName.get(canonical) || onRoster?.email || null;
  const starts = mineBase.map(r => dateOnly(r.start_at)).filter(Boolean).sort();

  const teamCategories = new Map(explore(team, 'category').rows.map(r => [r.key, r]));
  return {
    generated_at: now,
    basis: filters.basis,
    technician: { name: canonical, email, first_assigned: starts[0] || null, last_assigned: starts[starts.length - 1] || null },
    summary,
    team: teamSummary,
    technician_count: peers.filter(p => p.key !== UNASSIGNED).length,
    ranks,
    min_sample: cfg().minSample,
    has_due_times: dueTimes,
    insights: insights(canonical, summary, teamSummary, ranks, recent),
    recent,
    trend: monthlyTrend(mine),
    team_trend: monthlyTrend(team),
    flow: weeklyFlow(mineBase, filters, now),
    distribution: distribution(mine),
    team_distribution: distribution(team),
    aging: aging(mine),
    categories: explore(mine, 'category').rows.map(r => ({ ...r, team_avg_minutes: teamCategories.get(r.key)?.avg_minutes ?? null })),
    priorities: explore(mine, 'priority').rows,
    groups: explore(mine, 'group').rows,
    statuses: statusMix(mine),
    sla: slaBreakdown(mine),
    closure_heatmap: closureHeatmap(mine),
    handling: handlingSection(mine),
    team_handling: summarizeHandling(team),
    handovers: handoverSummary(canonical, mine, team),
  };
}

// Work passed between technicians: SRs this person handed away (now with someone else) and SRs they received from someone else.
const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const awayTest = person => r => r.history_ready && !!r.path && !sameName(r.technician, person) && r.path.some(p => sameName(p, person));
const receivedTest = person => r => r.history_ready && !!r.path && r.path.some(p => sameName(p, person)) && !sameName(r.path[0], person);

function handoverSummary(name, mine, team) {
  const away = team.filter(awayTest(name));
  const received = mine.filter(receivedTest(name));
  const lastIndex = path => { for (let i = path.length - 1; i >= 0; i--) if (sameName(path[i], name)) return i; return -1; };
  const firstIndex = path => path.findIndex(p => sameName(p, name));
  const tally = (list, pick) => {
    const counts = new Map();
    for (const r of list) { const who = pick(r); if (who) counts.set(who, (counts.get(who) || 0) + 1); }
    return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, cfg().topHandovers);
  };
  return {
    handed_away: away.length,
    received: received.length,
    handed_to: tally(away, r => r.path[lastIndex(r.path) + 1]),
    received_from: tally(received, r => r.path[firstIndex(r.path) - 1]),
  };
}

// Records behind a number: the filters, plus an optional "what did the user click" drill (dimension/key, duration bucket, ...).
function drillPredicate(query = {}) {
  const parts = [];
  const { dim, key, bucket, aging: agingKey, sla } = query;
  if (dim && key !== undefined && key !== '') {
    if (dim === 'weekday') parts.push(r => { const ms = wallClockMs(r.closed_at); return r.status === 'Closed' && ms !== null && WEEKDAYS[(new Date(ms).getUTCDay() + 6) % 7] === key; });
    else if (dim === 'hour') parts.push(r => { const ms = wallClockMs(r.closed_at); return r.status === 'Closed' && ms !== null && new Date(ms).getUTCHours() === Number(key); });
    else if (dim === 'weekday_hour') {
      const [day, hour] = String(key).split('|');
      parts.push(r => { const ms = wallClockMs(r.closed_at); return r.status === 'Closed' && ms !== null && WEEKDAYS[(new Date(ms).getUTCDay() + 6) % 7] === day && new Date(ms).getUTCHours() === Number(hour); });
    } else if (dim === 'flow_assigned') parts.push(r => !!r.start_at && weekStart(dateOnly(r.start_at)) === key);
    else if (dim === 'flow_closed') parts.push(r => !!r.closed_at && weekStart(dateOnly(r.closed_at)) === key);
    else if (GROUP_DIMENSIONS.includes(dim)) parts.push(r => dimensionKey(r, dim) === key);
  }
  const c = cfg();
  const b = c.tat.findIndex(x => x.key === bucket);
  if (b !== -1) parts.push(r => r.resolved && bucketIndex(r.tat_minutes, c.tat) === b);
  const a = c.aging.findIndex(x => x.key === agingKey);
  if (a !== -1) parts.push(r => r.status !== 'Closed' && r.age_minutes !== null && bucketIndex(r.age_minutes, c.aging) === a);
  if (sla === 'met') parts.push(r => r.sla_met === true);
  if (sla === 'missed') parts.push(r => r.sla_met === false);
  if (query.overdue === '1') parts.push(r => r.overdue);
  if (dim === 'reassignments' && key !== undefined && key !== '') {
    // "3+" arrives as "3 " when the plus sign was not URL-encoded; the top count is never a bucket of its own.
    const wanted = String(key).trim() === String(c.reassignTop) ? `${c.reassignTop}+` : String(key).trim();
    parts.push(r => r.history_ready && reassignKey(r.reassignments) === wanted);
  }
  if (dim === 'response' && key !== undefined && key !== '') {
    parts.push(r => r.history_ready && (key === 'none' ? r.first_response_minutes === null : r.first_response_minutes !== null && c.reply[responseIndex(r.first_response_minutes)].key === key));
  }
  if (dim === 'idle' && key !== undefined && key !== '') {
    const i = c.aging.findIndex(x => x.key === key);
    parts.push(r => r.history_ready && r.status !== 'Closed' && r.idle_minutes !== null && bucketIndex(r.idle_minutes, c.aging) === i);
  }
  if (dim === 'reopen_month' && key) parts.push(r => r.history_ready && r.status === 'Closed' && r.closed_at && r.closed_at.slice(0, 7) === key);
  const HANDLING = {
    reassigned: r => r.history_ready && r.reassignments > 0,
    multi: r => r.history_ready && r.technicians_involved > 1,
    // Closed SRs that were reopened at some point: the same SRs as the "Reopened" figure.
    reopened: r => r.history_ready && r.status === 'Closed' && r.reopens > 0,
    noresponse: r => r.history_ready && r.first_response_minutes === null,
    onhold: r => r.history_ready && r.hold_minutes > 0,
    fcr: r => r.history_ready && r.fcr === 1,
    nofcr: r => r.history_ready && r.fcr === 0,
    stale7: r => r.history_ready && r.status !== 'Closed' && r.idle_minutes >= c.stale[0] * DAY_MINUTES,
    stale14: r => r.history_ready && r.status !== 'Closed' && r.idle_minutes >= c.stale[1] * DAY_MINUTES,
    worklogged: r => r.history_ready && r.worklog_count > 0,
    nohistory: r => !r.history_ready,
  };
  if (Object.hasOwn(HANDLING, query.handling)) parts.push(HANDLING[query.handling]);
  return parts.length ? r => parts.every(p => p(r)) : null;
}

// Sortable columns. Rows with no value (never replied, still open, ...) always come last, whichever way the column is sorted.
const SORT_VALUES = {
  sr_number: r => { const n = Number(r.sr_number); return Number.isNaN(n) ? String(r.sr_number) : n; },
  technician: r => r.technician,
  status: r => r.status,
  priority: r => r.priority,
  category: r => r.category,
  raised_at: r => r.raised_at,
  start_at: r => r.start_at,
  closed_at: r => r.closed_at,
  due_by: r => r.due_by,
  tat_minutes: r => r.tat_minutes,
  age_minutes: r => r.age_minutes,
  reassignments: r => r.reassignments,
  reopens: r => r.reopens,
  first_response_minutes: r => r.first_response_minutes,
  idle_minutes: r => r.idle_minutes,
  worklog_minutes: r => r.worklog_minutes,
  active_minutes: r => r.active_minutes,
  tech_replies: r => r.tech_replies,
};
const collator = new Intl.Collator('en');
const isBlank = v => v === null || v === undefined || v === '';
const compareValues = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b)));
// Newest SR number first: the tie-break that makes every sort a total order, so pages never repeat or skip a row.
const newestFirst = (a, b) => (Number(b.sr_number) - Number(a.sr_number)) || String(b.sr_number).localeCompare(String(a.sr_number));

function sortRecords(list, sortKey, direction) {
  const valueOf = SORT_VALUES[sortKey];
  return list.map(r => ({ r, v: valueOf(r) })).sort((x, y) => {
    const xBlank = isBlank(x.v);
    const yBlank = isBlank(y.v);
    if (xBlank !== yBlank) return xBlank ? 1 : -1;
    return (xBlank ? 0 : direction * compareValues(x.v, y.v)) || newestFirst(x.r, y.r);
  }).map(x => x.r);
}

// opts: { page, pageSize, sort, order, drill } - pageSize 0 returns everything (used by the Excel reports).
async function buildRecords(filters, opts = {}) {
  const snap = await getSnapshot();
  const sortKey = Object.hasOwn(SORT_VALUES, opts.sort) ? opts.sort : 'start_at';
  const direction = opts.order === 'asc' ? 1 : -1;
  // The sorted list is the expensive part and is the same for every page of it, so it is kept (the page is cut from it each time).
  const found = await memoized(snap, `records|${JSON.stringify(filters)}|${sortKey}|${direction}|${JSON.stringify(opts.drill || {})}`, () => {
    const all = recordsFor(snap, filters.basis);
    let scope = filters;
    let drill = drillPredicate(opts.drill);
    // "Handed over by X" / "received from someone else": SRs that now belong to somebody else, so the technician filter is replaced by a path test.
    const handover = opts.drill?.handover;
    const person = filters.technicians[0];
    if ((handover === 'away' || handover === 'in') && person) {
      scope = { ...scope, technicians: handover === 'away' ? [] : scope.technicians };
      const base = drill;
      const test = handover === 'away' ? awayTest(person) : receivedTest(person);
      drill = r => test(r) && (!base || base(r));
    }
    // The weekly flow counts SRs by the week they started / closed whatever the date range (it only chooses which weeks to show),
    // so its drill-down must not apply the date range either, or the list would not match the bar that was clicked.
    const dim = opts.drill?.dim;
    const flow = (dim === 'flow_assigned' || dim === 'flow_closed') && opts.drill?.key !== undefined && opts.drill?.key !== '';
    const scoped = flow ? applyBaseFilters(all, scope) : applyFilters(all, scope);
    const matching = scoped
      .filter(r => filters.state === 'all' || (filters.state === 'closed' ? r.status === 'Closed' : r.status !== 'Closed'))
      .filter(r => !drill || drill(r));
    const records = sortRecords(matching, sortKey, direction);
    let closed = 0;
    const measured = [];
    for (const r of records) {
      if (r.status === 'Closed') closed++;
      if (r.resolved) measured.push(r.tat_minutes);
    }
    const tats = ascending(measured);
    return {
      records,
      // Figures for ALL matching rows (not just the page), so a drill-down can headline them.
      stats: {
        closed,
        open: records.length - closed,
        avg_minutes: tats.length ? round(measured.reduce((s, v) => s + v, 0) / tats.length) : null,
        median_minutes: round(percentile(tats, 0.5)),
      },
    };
  });
  const pageSize = opts.pageSize === 0 ? 0 : Math.min(Math.max(Number(opts.pageSize) || cfg().pageDefault, 1), cfg().pageMax);
  const page = Math.max(Number(opts.page) || 1, 1);
  return {
    generated_at: snap.now,
    basis: filters.basis,
    total: found.records.length,
    page,
    pageSize,
    stats: found.stats,
    records: pageSize === 0 ? found.records : found.records.slice((page - 1) * pageSize, page * pageSize),
  };
}

async function buildRequest(id) {
  const [found] = await pool.query('SELECT me_id FROM requests WHERE me_id = ? OR display_id = ? LIMIT 1', [id, id]);
  if (!found[0]) return null;
  const meId = found[0].me_id;
  await history.ensure(meId);
  const [rows] = await pool.query(
    `SELECT r.*, ${HISTORY_SELECT} FROM requests r LEFT JOIN request_history h ON h.me_id = r.me_id WHERE r.me_id = ?`, [meId]);
  const row = rows[0];
  const [events] = await pool.query('SELECT seq, at, kind, actor, summary, from_value, to_value FROM request_events WHERE me_id = ? ORDER BY seq', [meId]);
  const now = wallClockNow();
  const shaped = { assigned: shapeRecord(row, now, 'assigned'), raised: shapeRecord(row, now, 'raised') };
  return {
    ...row,
    turnaround_assigned_minutes: shaped.assigned.tat_minutes,
    turnaround_raised_minutes: shaped.raised.tat_minutes,
    overdue: shaped.assigned.overdue,
    sla_met: shaped.assigned.sla_met,
    handling: { assigned: shaped.assigned, raised: shaped.raised },
    events,
  };
}

// A setting that changes how the figures are worked out: results are recalculated from the rows already in memory (a new time zone also
// needs the clock re-read). Not a reload of the database.
const ANALYTIC_KEYS = new Set(['min_ranked_closed', 'min_due_sample', 'target_days_1', 'target_days_2', 'target_days_3', 'first_reply_target_1_minutes',
  'first_reply_target_2_minutes', 'stale_days_1', 'stale_days_2', 'count_weekends', 'tat_bucket_edges', 'aging_bucket_edges', 'reply_bucket_edges',
  'reassign_bucket_max', 'recent_window_days', 'top_n_matrix', 'top_n_handovers', 'insight_sla_good_pct', 'insight_sla_bad_pct', 'insight_diff_pct',
  'insight_gap_points', 'insight_p90_ratio', 'portal_time_zone']);
settings.onChange(changed => {
  if (!changed.some(k => ANALYTIC_KEYS.has(k)) || !snapshot) return;
  generation++;
  snapshot = { ...snapshot, shaped: new Map(), memo: new Map(), ...(changed.includes('portal_time_zone') ? { now: wallClockNow(), clockAt: Date.now() } : {}) };
});

module.exports = {
  BASES, DAY_MINUTES, hasDueTimes, GROUP_DIMENSIONS, WEEKDAYS, cfg, dayWord, dayBuckets, replyBuckets, reassignBuckets, weekendMs, elapsedMinutes,
  get MIN_DUE_SAMPLE() { return cfg().minDue; }, get MIN_SAMPLE() { return cfg().minSample; },
  get TAT_BUCKETS() { return cfg().tat; }, get RESPONSE_BUCKETS() { return cfg().reply; }, get REASSIGN_BUCKETS() { return cfg().reassign; },
  aging, applyFilters, handlingSection, summarizeHandling, buildExplore, buildOverview, buildRecords, buildRequest, buildTechnician, distribution, explore, facets,
  fmtDuration, invalidateCache, loadRecords, minutesBetween, parseFilters, percentile, shapeRecord, summarize, weekStart,
};
