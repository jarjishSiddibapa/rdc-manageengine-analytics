// Read-only ManageEngine ServiceDesk Plus Cloud client. Nothing here ever writes to ManageEngine.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const settings = require('./settings');
const connections = require('./connections');

const ACCEPT = 'application/vnd.manageengine.sdp.v3+json';
const CLOSED_STATUSES = new Set(['closed', 'resolved', 'cancelled', 'canceled', 'rejected', 'completed']);
// The most rows ManageEngine returns for one call (its own limit; the sync page size setting is capped by it).
const API_MAX_ROWS = 100;
const PAGE_SIZE = API_MAX_ROWS;

// Read at the moment of use: the connection (Admin -> Connections, falling back to backend\.env) and the portal time zone can change
// while the app runs.
function getConfig() {
  return { ...connections.manageEngine(), timeZone: settings.str('portal_time_zone') || 'Asia/Kolkata' };
}

function missingConfig(config = getConfig()) {
  return [
    ['API domain', config.apiDomain],
    ['Client ID', config.clientId],
    ['Client secret', config.clientSecret],
    ['Refresh token', config.refreshToken],
  ].filter(([, value]) => !value).map(([name]) => name);
}

const normalizeStatusName = value => String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
const isClosedFamily = value => CLOSED_STATUSES.has(normalizeStatusName(value));

// Same status vocabulary as the RDC tracker, so the analytics read identically in both apps.
function mapStatus(value) {
  const normalized = normalizeStatusName(value);
  if (isClosedFamily(normalized)) return 'Closed';
  if (normalized === 'on hold' || normalized === 'onhold') return 'On Hold';
  if (normalized.includes('pending with user') || normalized.includes('pending on user')) return 'Pending with User';
  if (normalized.includes('pending')) return 'Pending';
  if (normalized === 'in progress' || normalized === 'inprogress' || normalized === 'work in progress') return 'In Progress';
  return 'Open';
}

function pendingPartyFor(request) {
  if (isClosedFamily(request?.status?.name)) return null;
  const status = normalizeStatusName(request?.status?.name);
  if (status.includes('pending with user') || status.includes('pending on user')) return 'User';
  if (status.includes('pending with technician') || status.includes('pending on technician')) return 'Technician';
  if (request?.unreplied_count === null || request?.unreplied_count === undefined || request?.unreplied_count === '') return null;
  return Number(request.unreplied_count || 0) > 0 ? 'Technician' : 'User';
}

// ManageEngine timestamps arrive as epoch milliseconds ({ value: "..." }); stored as portal wall-clock time.
// Empty values come as null, '', 'null' or '0' (an unset date); all of them mean "no date" and never become 1970.
function dateTimeFromApi(value, timeZone) {
  const raw = value && typeof value === 'object' ? value.value : value;
  if (raw === null || raw === undefined || raw === '' || raw === 'null') return null;
  const milliseconds = Number(raw);
  if (Number.isFinite(milliseconds) && milliseconds <= 0) return null;
  const date = Number.isFinite(milliseconds) ? new Date(milliseconds) : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const t = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${t.year}-${t.month}-${t.day} ${t.hour}:${t.minute}:${t.second}`;
}

// ManageEngine names sometimes carry a " - Department" suffix ("Aniket Sawant - Credit Control").
function personName(person) {
  const name = String(person?.name || '').trim();
  if (!name) return null;
  const idx = name.indexOf(' - ');
  return idx === -1 ? name : name.slice(0, idx).trim();
}

function normalizeRequest(request, config = getConfig()) {
  const statusName = String(request?.status?.name || '').trim();
  const mapped = mapStatus(statusName);
  const pendingParty = pendingPartyFor(request);
  const status = mapped === 'Closed' || mapped === 'On Hold'
    ? mapped
    : pendingParty === 'User' ? 'Pending with User' : pendingParty === 'Technician' ? 'Pending' : mapped;
  const text = value => String(value?.name ?? value ?? '').trim() || null;
  const closed = status === 'Closed';
  return {
    me_id: String(request?.id || '').trim(),
    display_id: String(request?.display_id || request?.id || '').trim(),
    subject: String(request?.subject || '').trim() || null,
    status_name: statusName || null,
    status,
    pending_party: pendingParty,
    // A request nobody has picked up has no technician; it is reported as "(Unassigned)", never as its group.
    technician: personName(request?.technician),
    technician_email: String(request?.technician?.email_id || '').trim().toLowerCase() || null,
    requester: personName(request?.requester) || personName(request?.created_by),
    category: text(request?.category),
    subcategory: text(request?.subcategory),
    priority: text(request?.priority),
    // ManageEngine leaves request_type empty on many portals; is_service_request still tells the two apart.
    request_type: text(request?.request_type) || (request?.is_service_request === true ? 'Service Request' : 'Incident'),
    group_name: text(request?.group),
    site: text(request?.site),
    department: text(request?.department),
    mode: text(request?.mode),
    created_at: dateTimeFromApi(request?.created_time, config.timeZone),
    // When ManageEngine last assigned the request to its current technician: the start of that technician's clock.
    assigned_at: dateTimeFromApi(request?.assigned_time, config.timeZone),
    // "Resolved" requests carry resolved_time but no completed_time.
    completed_at: closed ? dateTimeFromApi(request?.completed_time, config.timeZone) || dateTimeFromApi(request?.resolved_time, config.timeZone) : null,
    due_by: dateTimeFromApi(request?.due_by_time, config.timeZone),
    last_updated_at: dateTimeFromApi(request?.last_updated_time, config.timeZone),
  };
}

// ── HTTP: retries, back-off ──
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const THROTTLE_TEXT = /too many requests|try again after some time|rate limit/i;

function backoffMs(attempt, retryAfterHeader, throttled) {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, settings.num('me_retry_after_cap_seconds') * 1000);
  // Throttled: wait long (the limiter counts per minute / per ten minutes). Server trouble: short exponential back-off.
  const first = settings.num('me_backoff_seconds') * 1000;
  const base = throttled ? settings.num('me_throttle_wait_seconds') * 1000 * attempt : Math.min(first * 2 ** (attempt - 1), first * 15);
  return base + Math.floor(Math.random() * 1000);
}

// Fetch a URL and return its parsed JSON. Retries network errors, timeouts, HTTP 429/5xx, "too many requests" answers (Zoho
// sends those as HTTP 400) and bodies that are not JSON (a login page, a cut-off answer). Other 4xx answers are thrown at once.
async function fetchJson(url, options, attempts = settings.num('me_max_attempts')) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let wait = 0;
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(settings.num('me_timeout_seconds') * 1000) });
      const text = await response.text();
      if (!response.ok) {
        const throttled = response.status === 429 || THROTTLE_TEXT.test(text);
        const error = new Error(`ManageEngine API returned HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
        error.status = response.status;
        error.body = text;
        error.throttled = throttled;
        error.retryable = throttled || response.status >= 500;
        error.retryAfter = response.headers.get('retry-after');
        throw error;
      }
      try { return JSON.parse(text); } catch {
        const error = new Error(`ManageEngine API returned an answer that is not JSON: ${text.slice(0, 120)}`);
        error.retryable = true;
        throw error;
      }
    } catch (error) {
      lastError = error;
      // fetch() failures (network, DNS, timeout) carry no status and are worth another try.
      const retryable = error.retryable ?? !error.status;
      if (!retryable || attempt === attempts) throw error;
      wait = backoffMs(attempt, error.retryAfter, error.throttled);
    }
    await sleep(wait);
  }
  throw lastError;
}

// ── OAuth token ──
// One token is shared by every worker of this process and, through a small file in the temp folder, by every process on this PC
// using the same ManageEngine client: Zoho refuses more than a handful of refreshes in a few minutes, and several apps/workers
// each refreshing on their own got the whole client locked out ("too many requests").
let accessTokenCache = null;
let refreshing = null;
const tokenFile = config => path.join(os.tmpdir(), `me-analytics-token-${crypto.createHash('sha1').update(`${config.accountsUrl}|${config.clientId}`).digest('hex').slice(0, 12)}.json`);
const tokenFresh = t => !!t && !!t.token && t.expiresAt > Date.now() + 120000;

function readSharedToken(config) {
  try {
    const t = JSON.parse(fs.readFileSync(tokenFile(config), 'utf8'));
    return tokenFresh(t) ? t : null;
  } catch { return null; }
}
function writeSharedToken(config, t) {
  try { fs.writeFileSync(tokenFile(config), JSON.stringify(t), { mode: 0o600 }); } catch { /* only an optimisation */ }
}

// One token request to Zoho (a single try; callers decide about retries).
async function requestNewToken(config) {
  const payload = await fetchJson(`${config.accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken,
    }),
  }, 1);
  if (!payload.access_token) throw new Error(`Zoho did not return an access token (${payload.error || 'unknown response'})`);
  return { token: payload.access_token, expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000 };
}

// The token belongs to one connection. When the administrator changes it (Admin -> Connections) the cached token - and the token other
// apps left in the shared temp file - are no longer trusted until a new one has been fetched with the new details.
let tokenFor = null;
let ignoreSharedToken = false;
const connectionKey = config => crypto.createHash('sha256').update([config.accountsUrl, config.clientId, config.clientSecret, config.refreshToken].join('|')).digest('hex');
function checkConnectionChange(config) {
  const key = connectionKey(config);
  if (tokenFor !== null && tokenFor !== key) { accessTokenCache = null; ignoreSharedToken = true; }
  tokenFor = key;
}
connections.onChange(() => { try { checkConnectionChange(getConfig()); } catch { /* checked again on the next call */ } });

// `rejected`: a token ManageEngine just answered 401 to; it is never handed out again.
async function accessToken(config, rejected = null) {
  checkConnectionChange(config);
  if (tokenFresh(accessTokenCache) && accessTokenCache.token !== rejected) return accessTokenCache.token;
  const shared = ignoreSharedToken ? null : readSharedToken(config);
  if (shared && shared.token !== rejected) { accessTokenCache = shared; return shared.token; }
  if (!refreshing) {
    refreshing = (async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          const fresh = await requestNewToken(config);
          if (connectionKey(getConfig()) !== tokenFor) return fresh.token; // the connection changed while waiting: use it once, do not keep it
          accessTokenCache = fresh;
          ignoreSharedToken = false;
          writeSharedToken(config, accessTokenCache);
          return accessTokenCache.token;
        } catch (error) {
          const retryable = error.throttled || error.status >= 500 || !error.status;
          if (!retryable || attempt >= settings.num('me_token_attempts')) throw error;
          await sleep(backoffMs(attempt, error.retryAfter, error.throttled));
          // Another process may have refreshed while this one waited.
          const again = ignoreSharedToken ? null : readSharedToken(config);
          if (again && again.token !== rejected) { accessTokenCache = again; return again.token; }
        }
      }
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

// "Test connection" on the Admin screen: asks Zoho for a brand-new token with the given details (nothing cached or shared is used or
// changed), then reads one request. Never throws; resolves to { ok, message }.
async function testConnection(config) {
  const missing = missingConfig(config);
  if (missing.length) return { ok: false, message: `Not complete yet. Missing: ${missing.join(', ')}.` };
  let token;
  try {
    token = (await requestNewToken(config)).token;
  } catch (error) {
    const hint = error.throttled ? ' Zoho is limiting token requests; wait a few minutes and try again.' : '';
    return { ok: false, message: `Zoho refused the sign-in details (${String(error.message).slice(0, 200)}).${hint}` };
  }
  try {
    const url = new URL(`${base(config)}/requests`);
    url.searchParams.set('input_data', JSON.stringify({ list_info: { row_count: 1, start_index: 1, get_total_count: true, sort_field: 'id', sort_order: 'desc', filter_by: { name: 'All_Requests' }, fields_required: ['id'] } }));
    const payload = await fetchJson(url, { headers: { Accept: ACCEPT, Authorization: `Zoho-oauthtoken ${token}` } }, 1);
    assertApiSuccess(payload);
    const total = Number(payload?.list_info?.total_count);
    return { ok: true, message: `Connected. ManageEngine answered${Number.isFinite(total) ? ` and holds ${total.toLocaleString('en-US')} requests` : ''}.` };
  } catch (error) {
    return { ok: false, message: `The sign-in worked, but ManageEngine would not list requests (${String(error.message).slice(0, 200)}). Check the API domain, the portal name and the token's scope.` };
  }
}

// ── API calls ──
const FIELDS = [
  'id', 'display_id', 'subject', 'status', 'requester', 'created_by', 'technician', 'group', 'site', 'department', 'mode',
  'category', 'subcategory', 'priority', 'request_type', 'is_service_request', 'created_time', 'assigned_time',
  'completed_time', 'resolved_time', 'due_by_time', 'last_updated_time', 'unreplied_count',
];

function assertApiSuccess(payload) {
  const statuses = Array.isArray(payload?.response_status) ? payload.response_status : payload?.response_status ? [payload.response_status] : [];
  const failure = statuses.find(item => item?.status && item.status !== 'success');
  if (!failure) return;
  const error = new Error(`ManageEngine API rejected the request: ${failure.messages?.[0]?.message || failure.message || failure.status_code || 'unknown API error'}`);
  error.apiCode = failure.status_code;
  if (Number(failure.status_code) === 4001) error.status = 401; // invalid / expired OAuth token
  throw error;
}

const base = config => `${config.apiDomain}${config.portal ? `/app/${encodeURIComponent(config.portal)}` : ''}/api/v3`;
const truthy = v => v === true || v === 'true';

// One authenticated GET against the SDP API (read-only). A 401 refreshes the token once and tries again.
async function apiGet(config, resource, inputData, { refreshOn401 = true } = {}) {
  const url = new URL(`${base(config)}/${resource}`);
  if (inputData) url.searchParams.set('input_data', JSON.stringify(inputData));
  let token = await accessToken(config);
  for (let pass = 0; ; pass++) {
    try {
      const payload = await fetchJson(url, { headers: { Accept: ACCEPT, Authorization: `Zoho-oauthtoken ${token}` } });
      assertApiSuccess(payload);
      return payload;
    } catch (error) {
      if (error.status === 401 && pass === 0 && refreshOn401) { token = await accessToken(config, token); continue; }
      throw error;
    }
  }
}

// ManageEngine answers a request that does not exist with HTTP 404, or with a 4xxx "not found / invalid id" error. Any other
// failure (throttling, bad token, malformed input) is NOT "missing" - treating it so would wipe good data.
function isNotFound(error) {
  if (!error || error.throttled || error.status === 401) return false;
  if (error.status === 404) return true;
  const text = `${error.body || ''} ${error.message || ''}`;
  return (error.status === 400 || (Number(error.apiCode) >= 4000 && Number(error.apiCode) < 5000))
    && /not\s*found|invalid\s*(request|id)|does\s*not\s*exist|no such|no longer/i.test(text);
}

// One page of requests, newest first. `criteria` is a ManageEngine search_criteria object (omit it to read everything).
async function fetchRequestPage(config, startIndex, { rowCount = Math.min(settings.num('sync_page_size') || API_MAX_ROWS, API_MAX_ROWS), criteria, totalCount = false } = {}) {
  const listInfo = {
    row_count: rowCount,
    start_index: startIndex,
    sort_field: 'id',
    sort_order: 'desc',
    fields_required: FIELDS,
    filter_by: { name: 'All_Requests' },
  };
  if (criteria) listInfo.search_criteria = criteria;
  if (totalCount) listInfo.get_total_count = true;
  return apiGet(config, 'requests', { list_info: listInfo });
}

// One request by id (used to double-check a request before it is flagged as gone). Resolves to { request, missing }.
async function fetchRequest(config, requestId) {
  try {
    const payload = await apiGet(config, `requests/${encodeURIComponent(requestId)}`);
    return { request: payload.request || null, missing: !payload.request };
  } catch (error) {
    if (isNotFound(error)) return { request: null, missing: true };
    throw error;
  }
}

// Optional technician roster. Needs the SDPOnDemand.setup.READ scope on the refresh token; without it ManageEngine answers
// 401 and the app falls back to the technicians found on requests.
async function fetchTechnicianRoster(config) {
  const roster = [];
  let startIndex = 1;
  for (let page = 0; page < 50; page++) {
    const payload = await apiGet(config, 'technicians', { list_info: { row_count: Math.min(settings.num('sync_page_size') || API_MAX_ROWS, API_MAX_ROWS), start_index: startIndex, sort_field: 'name', sort_order: 'asc' } }, { refreshOn401: false });
    const list = Array.isArray(payload.technicians) ? payload.technicians : [];
    for (const t of list) {
      const name = personName(t);
      if (name) roster.push({ name, email: String(t.email_id || '').trim().toLowerCase() || null, department: t.department?.name || null });
    }
    if (!truthy(payload?.list_info?.has_more_rows) || !list.length) break;
    startIndex += list.length;
  }
  return roster;
}

// A request's change log is read oldest-first, this many pages of 100 events at most. Real SRs have tens to a few hundred events;
// a runaway mail loop can have thousands of "requester replied" entries. For those the newest TAIL_PAGES pages are read as well
// (newest-first), because the closure, the last assignment and the reopens are the entries that matter.
// (Both limits are settings: history_max_pages and history_tail_pages.)

// The change log of one request: every assignment, status change, reply, note and worklog, oldest first. Read-only.
// Resolves to { events, missing, truncated } - `missing` is true when ManageEngine no longer has the request;
// `truncated` is true when the log was so long that a stretch in the middle was not read.
async function fetchRequestHistory(config, requestId) {
  const resource = `requests/${encodeURIComponent(requestId)}/history`;
  const read = async (order, startIndex) => {
    const payload = await apiGet(config, resource, { list_info: { row_count: API_MAX_ROWS, start_index: startIndex, sort_field: 'time', sort_order: order } });
    const list = Array.isArray(payload.history) ? payload.history : [];
    return { list, more: truthy(payload?.list_info?.has_more_rows) && list.length > 0 };
  };
  const events = [];
  let startIndex = 1;
  let more = false;
  try {
    for (let page = 0; page < settings.num('history_max_pages'); page++) {
      const r = await read('asc', startIndex);
      events.push(...r.list);
      more = r.more;
      if (!more) break;
      startIndex += r.list.length;
    }
  } catch (error) {
    if (isNotFound(error)) return { events: [], missing: true, truncated: false };
    throw error;
  }
  if (!more) return { events, missing: false, truncated: false };

  // Longer than the limit: add the newest entries, until they meet what was already read.
  const have = new Set(events.map(e => e.id));
  let joined = false;
  let tailIndex = 1;
  for (let page = 0; page < settings.num('history_tail_pages') && !joined; page++) {
    const r = await read('desc', tailIndex);
    for (const e of r.list) { if (have.has(e.id)) joined = true; else { have.add(e.id); events.push(e); } }
    if (!r.more) joined = true; // reached the very first entry: nothing is missing
    tailIndex += r.list.length;
  }
  return { events, missing: false, truncated: !joined };
}

module.exports = {
  PAGE_SIZE, API_MAX_ROWS, testConnection, fetchTechnicianRoster, getConfig, missingConfig, normalizeRequest, fetchRequestPage, fetchRequest, fetchRequestHistory,
  isClosedFamily, dateTimeFromApi, mapStatus, personName, isNotFound,
};
