import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbort, withSignal } from '../services/api';

// Runs an async loader whenever `deps` change and keeps only the newest answer. A newer request cancels the older one on the
// network (AbortController) as well as ignoring its answer, so quick filter changes never pile up or overwrite each other.
// The loader may also take `({ signal })` if it wants to pass the signal on itself.
//
// Returns { data, loading, error, reload }. While reloading, the previous `data` stays available (`loading` is true).
export default function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const latest = useRef(0);
  const controller = useRef(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(() => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const id = ++latest.current;
    setState(s => (s.loading && !s.error ? s : { ...s, loading: true, error: null }));
    let promise;
    try { promise = Promise.resolve(withSignal(ctrl.signal, () => loaderRef.current({ signal: ctrl.signal }))); } catch (error) { promise = Promise.reject(error); }
    promise
      .then(res => { if (id === latest.current) setState({ data: res.data, loading: false, error: null }); })
      .catch(error => {
        if (id !== latest.current || isAbort(error)) return;
        setState(s => ({ data: s.data, loading: false, error: error.message || 'Failed to load', network: !!error.network }));
      });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, deps);
  useEffect(() => () => { latest.current += 1; controller.current?.abort(); }, []);

  // Back online after a failed (network) load: try again by itself.
  useEffect(() => {
    if (!state.error || !state.network) return undefined;
    window.addEventListener('online', run);
    return () => window.removeEventListener('online', run);
  }, [state.error, state.network, run]);

  return { data: state.data, loading: state.loading, error: state.error, reload: run };
}
