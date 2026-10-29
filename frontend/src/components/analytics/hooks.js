import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isAbort } from './http';

// Loads data whenever `deps` change. The previous answer stays on screen (dimmed by the page) while the next one loads, and the request
// that is no longer wanted is aborted - an older answer can never overwrite a newer one.
export function useAbortableLoad(loader, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const controller = useRef(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(() => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setState(s => ({ ...s, loading: true, error: null }));
    Promise.resolve(loaderRef.current(c.signal))
      .then(res => { if (!c.signal.aborted) setState({ data: res.data, loading: false, error: null }); })
      .catch(error => {
        if (c.signal.aborted || isAbort(error)) return;
        setState(s => ({ data: s.data, loading: false, error: error.message || 'Failed to load' }));
      });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); return () => controller.current?.abort(); }, deps);
  return { ...state, reload: run };
}

export function useDebounced(value, ms = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return debounced;
}

// Width of an element, kept up to date as it resizes. Measured before the first paint so charts never flash at the wrong size.
export function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(Math.floor(el.clientWidth));
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry.contentRect.width);
      setWidth(prev => (prev === next ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// Page state kept in the address bar (page, sort, search...), so a refreshed or shared link opens the same view.
// Writes read the live address, so two components changing different keys in the same moment cannot overwrite each other.
export function useUrlState() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const patch = useCallback(changes => { 
    const next = new URLSearchParams(window.location.search);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') next.delete(key);
      else next.set(key, String(value));
    });
    const text = next.toString();
    if (text === window.location.search.replace(/^\?/, '')) return;
    navigate({ search: text ? `?${text}` : '' }, { replace: true });
  }, [navigate]);
  return [params, patch];
}

export function useIsCompact(breakpoint = 640) {
  const query = `(max-width: ${breakpoint}px)`;
  const [match, setMatch] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}
