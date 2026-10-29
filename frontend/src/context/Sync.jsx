import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { syncAPI } from '../services/api';
import { useAuth } from './Auth';
import { useFilters } from './Filters';
import { friendlyError } from '../utils/errors';

const SyncContext = createContext(null);

const WINDOW_MS = 10 * 60 * 1000; // progress over the last ten minutes sets the pace for the estimate
const MIN_SPAN_MS = 20 * 1000;

// Turns "how many SRs have their history now" snapshots into a speed and a time left.
function estimate(samples) {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const spanMs = last.t - first.t;
  const progressed = last.done - first.done;
  if (spanMs < MIN_SPAN_MS || progressed <= 0) return null;
  const perMinute = (progressed / spanMs) * 60000;
  return { perMinute, minutesLeft: Math.max(0, last.remaining) / perMinute };
}

// Watches ManageEngine syncs: polls quickly while one runs, slowly otherwise (and not at all while the tab is hidden), and tells
// every screen to reload when one finishes (including the automatic syncs that nobody clicked).
export function SyncProvider({ children }) {
  const { user } = useAuth();
  const { bumpData } = useFilters();
  const [status, setStatus] = useState(null);
  const [offline, setOffline] = useState(false);
  const [historyEta, setHistoryEta] = useState(null);
  const seenRun = useRef(null);
  const wasRunning = useRef(false);
  const samples = useRef({ kind: null, list: [] });
  const lastJson = useRef('');

  const trackHistory = useCallback(next => {
    const hist = next.history;
    if (!hist) { setHistoryEta(null); return; }
    const run = hist.running;
    // While this app is collecting, use the run's own counters; otherwise watch the stored total (another process may be collecting).
    const kind = run ? `run${run.runId}` : 'stored';
    const point = run ? { done: run.done, remaining: Math.max(0, run.total - run.done) } : { done: hist.collected, remaining: hist.pending };
    if (samples.current.kind !== kind) samples.current = { kind, list: [] };
    const now = Date.now();
    const list = samples.current.list;
    if (list.length && point.done < list[list.length - 1].done) list.length = 0;
    list.push({ t: now, ...point });
    while (list.length > 2 && now - list[0].t > WINDOW_MS) list.shift();
    const eta = point.remaining > 0 ? estimate(list) : null;
    setHistoryEta(prev => (prev?.perMinute === eta?.perMinute && prev?.minutesLeft === eta?.minutesLeft ? prev : eta));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await syncAPI.status();
      const next = res.data;
      setOffline(false);
      trackHistory(next);
      // The server answers with the same figures most of the time; only change state (and re-render the screens) when it differs.
      const json = JSON.stringify(next);
      if (json !== lastJson.current) { lastJson.current = json; setStatus(next); }
      const latest = next.latest;
      if (!next.running && latest && latest.status !== 'running' && seenRun.current !== latest.id) {
        // First look after opening the app only records which run is the latest; a run that finishes while watching is announced.
        if (seenRun.current !== null || wasRunning.current) {
          if (latest.status === 'success') message.success(latest.message);
          else message.error(`Sync failed: ${friendlyError(latest.message)}`);
          bumpData();
        }
        seenRun.current = latest.id;
      }
      wasRunning.current = !!next.running;
    } catch (error) { if (error.network) setOffline(true); /* the next poll tries again */ }
  }, [bumpData, trackHistory]);

  const active = !!user && !user.must_change_password;
  useEffect(() => { if (active) refresh(); }, [active, refresh]);
  useEffect(() => {
    if (!active) return undefined;
    const every = status?.running ? 2000 : status?.history?.running ? 5000 : 15000;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, every);
    const wake = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', wake);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', wake); };
  }, [active, refresh, status?.running, status?.history?.running]);

  const start = useCallback(async mode => {
    try {
      const res = await syncAPI.run(mode);
      lastJson.current = JSON.stringify(res.data);
      setStatus(res.data);
      wasRunning.current = true;
      if (seenRun.current === null) seenRun.current = res.data.latest?.id ?? 0;
      message.info(mode === 'deep' ? 'Deep sync started - reading every SR from ManageEngine' : 'Sync started');
    } catch (error) { message.error(error.message || 'Could not start the sync'); }
  }, []);

  const value = useMemo(() => ({ status, start, refresh, offline, historyEta }), [status, start, refresh, offline, historyEta]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export const useSync = () => useContext(SyncContext);
