// Small fetch wrapper that answers like axios ({ data }). Every call carries the session cookie and the header the server
// requires on writes. A 401 anywhere tells the app the session has ended.
const BASE = '/api';

export const SESSION_ENDED = 'mea:session-ended';

function queryString(params) {
  const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
}

async function readError(response) {
  const data = await response.json().catch(() => ({}));
  const fallback = response.status >= 500 ? 'The server had a problem. Please try again in a moment.' : `Request failed (${response.status})`;
  const error = new Error(data.message || fallback);
  error.response = { status: response.status, data };
  return error;
}

export const isAbort = error => error?.name === 'AbortError';

// A request that never reached the server (offline, server restarting) gets a plain-language message instead of "Failed to fetch".
function networkError(error) {
  if (isAbort(error)) return error;
  const wrapped = new Error(navigator.onLine === false ? 'You are offline. Check your connection and try again.' : 'Cannot reach the server. It may be restarting - try again in a moment.');
  wrapped.network = true;
  wrapped.cause = error;
  return wrapped;
}

// useLoad() registers its AbortSignal here for the synchronous moment its loader runs, so every GET started by that loader is
// cancelled when a newer request replaces it - without each API call having to pass a signal around.
let ambientSignal = null;
export function withSignal(signal, fn) {
  const previous = ambientSignal;
  ambientSignal = signal;
  try { return fn(); } finally { ambientSignal = previous; }
}

async function send(method, path, { params, body, signal } = {}) {
  try {
    return await fetch(`${BASE}${path}${queryString(params)}`, {
      method,
      credentials: 'same-origin',
      signal: signal || (method === 'GET' ? ambientSignal : null) || undefined,
      headers: { 'X-Requested-With': 'ManageEngineAnalytics', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) { throw networkError(error); }
}

async function request(method, path, options = {}) {
  const response = await send(method, path, options);
  if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event(SESSION_ENDED));
  if (!response.ok) throw await readError(response);
  return { data: await response.json().catch(() => ({})) };
}

// Fetches a file (an Excel report) and hands it to the browser as a download.
async function download(method, path, { params, body, filename } = {}) {
  const response = await send(method, path, { params, body, signal: null });
  if (response.status === 401) window.dispatchEvent(new Event(SESSION_ENDED));
  if (!response.ok) throw await readError(response);
  const blob = await response.blob();
  if (!blob.size) throw new Error('The report came back empty');
  const disposition = response.headers.get('Content-Disposition') || '';
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] || filename || 'report.xlsx';
  saveBlob(blob, name);
  return name;
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const authAPI = {
  login: (email, password) => request('POST', '/auth/login', { body: { email, password } }),
  me: signal => request('GET', '/auth/me', { signal }),
  logout: () => request('POST', '/auth/logout'),
  forgotPassword: email => request('POST', '/auth/forgot-password', { body: { email } }),
  checkReset: token => request('POST', '/auth/reset-password/check', { body: { token } }),
  resetPassword: (token, password) => request('POST', '/auth/reset-password', { body: { token, password } }),
  changePassword: (current, next) => request('POST', '/auth/change-password', { body: { current, next } }),
  updateProfile: name => request('PATCH', '/auth/profile', { body: { name } }),
};

// Names, texts and sign-in rules for the sign-in page and the browser tab (no sign-in needed, nothing secret).
export const publicAPI = { config: () => request('GET', '/public/config') };

export const metaAPI = { get: () => request('GET', '/meta') };

export const analyticsAPI = {
  overview: params => request('GET', '/analytics/overview', { params }),
  technician: (name, params) => request('GET', `/analytics/technician/${encodeURIComponent(name)}`, { params }),
  records: params => request('GET', '/analytics/records', { params }),
  request: id => request('GET', `/analytics/request/${encodeURIComponent(id)}`),
};

export const syncAPI = {
  status: () => request('GET', '/sync/status'),
  run: mode => request('POST', `/sync/run?mode=${mode}`),
  history: () => request('GET', '/sync/history'),
  collectHistory: rebuild => request('POST', `/sync/history${rebuild ? '?rebuild=1' : ''}`),
  stopHistory: () => request('POST', '/sync/history/stop'),
};

export const adminAPI = {
  users: () => request('GET', '/admin/users'),
  createUser: body => request('POST', '/admin/users', { body }),
  updateUser: (id, body) => request('PATCH', `/admin/users/${id}`, { body }),
  resetPassword: (id, password) => request('POST', `/admin/users/${id}/reset-password`, { body: password ? { password } : {} }),
  revokeSessions: id => request('POST', `/admin/users/${id}/revoke-sessions`),
  deleteUser: id => request('DELETE', `/admin/users/${id}`),
  audit: params => request('GET', '/admin/audit', { params }),
  settings: () => request('GET', '/admin/settings'),
  saveSettings: body => request('PUT', '/admin/settings', { body }),
  connections: () => request('GET', '/admin/connections'),
  saveConnections: values => request('PUT', '/admin/connections', { body: { values } }),
  testManageEngine: values => request('POST', '/admin/connections/test/manageengine', { body: { values } }),
  testSmtp: (values, send, to) => request('POST', '/admin/connections/test/smtp', { body: { values, send, to } }),
  backups: () => request('GET', '/admin/backups'),
  saveBackupSettings: body => request('PUT', '/admin/backups/settings', { body }),
  runBackup: () => request('POST', '/admin/backups/run'),
  testBackupEmail: to => request('POST', '/admin/backups/test-email', { body: { to } }),
  deleteBackup: filename => request('DELETE', `/admin/backups/${encodeURIComponent(filename)}`),
};

export const reportAPI = {
  dashboard: params => download('GET', '/reports/dashboard.xlsx', { params }),
  technician: (name, params) => download('GET', '/reports/technician.xlsx', { params: { ...params, name } }),
  request: id => download('GET', `/reports/request/${encodeURIComponent(id)}.xlsx`),
  records: (params, title) => download('GET', '/reports/records.xlsx', { params: { ...params, title } }),
  // The rows a chart or table is showing: { title, note, sheets: [{ name, columns, rows }] }.
  tables: body => download('POST', '/reports/tables.xlsx', { body, filename: 'report.xlsx' }),
};
