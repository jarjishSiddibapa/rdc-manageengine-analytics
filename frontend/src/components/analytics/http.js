// Read-only analytics calls that can be cancelled: when the filters change, or the screen closes, the request still in flight is
// aborted so a slow earlier answer can never replace a newer one.
import { SESSION_ENDED } from '../../services/api';

const BASE = '/api';

function queryString(params) {
  const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
}

export const isAbort = error => error?.name === 'AbortError';

export async function getJSON(path, params, signal) {
  const response = await fetch(`${BASE}${path}${queryString(params)}`, {
    method: 'GET', credentials: 'same-origin', signal, headers: { 'X-Requested-With': 'ManageEngineAnalytics' },
  });
  if (response.status === 401) window.dispatchEvent(new Event(SESSION_ENDED));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.message || `Request failed (${response.status})`);
    error.response = { status: response.status, data };
    throw error;
  }
  return { data: await response.json().catch(() => ({})) };
}

export const cancellable = {
  overview: (params, signal) => getJSON('/analytics/overview', params, signal),
  technician: (name, params, signal) => getJSON(`/analytics/technician/${encodeURIComponent(name)}`, params, signal),
  records: (params, signal) => getJSON('/analytics/records', params, signal),
  request: (id, signal) => getJSON(`/analytics/request/${encodeURIComponent(id)}`, undefined, signal),
};
