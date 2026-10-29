import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { LeftOutlined, RightOutlined, UndoOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';

// Zoom for every chart. A chart card owns one range [from, to] (fractions of the chart's categories, 0..1). Charts read it through
// useZoomView() and draw only the visible part; the card's toolbar, drag-to-select, Ctrl + scroll and two-finger pinch change it.

export const MIN_VISIBLE = 3;
const ZoomCtx = createContext(null);
export const useZoom = () => useContext(ZoomCtx);

const clampRange = (a, w, minW) => {
  const width = Math.max(minW, Math.min(1, w));
  const start = Math.max(0, Math.min(1 - width, a));
  return [start, start + width];
};

export function ZoomProvider({ initial, expanded = false, children }) {
  const [range, setRange] = useState(initial || [0, 1]);
  const [meta, setMeta] = useState({ count: 0, label: '', lo: 0, hi: 0, drag: true });
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const minWidth = () => Math.min(1, MIN_VISIBLE / Math.max(metaRef.current.count, MIN_VISIBLE));
  const register = useCallback((count, label, lo, hi, drag) => {
    setMeta(m => (m.count === count && m.label === label && m.lo === lo && m.hi === hi && m.drag === drag ? m : { count, label, lo, hi, drag }));
  }, []);

  const zoomBy = useCallback((factor, center) => {
    const [a, b] = rangeRef.current;
    const w = b - a;
    const nw = Math.max(minWidth(), Math.min(1, w * factor));
    const c = center ?? (a + b) / 2;
    setRange(clampRange(c - ((c - a) / w) * nw, nw, minWidth()));
  }, []);
  // Used by pinch: scale the range that was visible when the gesture began, keeping the pinch centre still.
  const zoomFrom = useCallback((start, scale, frac) => {
    const w0 = start[1] - start[0];
    const nw = Math.max(minWidth(), Math.min(1, w0 * scale));
    const c = start[0] + frac * w0;
    setRange(clampRange(c - frac * nw, nw, minWidth()));
  }, []);
  const pan = useCallback(direction => {
    const [a, b] = rangeRef.current;
    setRange(clampRange(a + (b - a) * 0.5 * direction, b - a, minWidth()));
  }, []);
  const reset = useCallback(() => setRange([0, 1]), []);
  const selectIndices = useCallback((i, j, n) => setRange(clampRange(i / n, (j - i + 1) / n, minWidth())), []);

  const value = useMemo(() => ({
    range, rangeRef, zoomed: range[0] > 0.0001 || range[1] < 0.9999, expanded, ...meta,
    zoomable: meta.count > MIN_VISIBLE, register, zoomBy, zoomFrom, pan, reset, selectIndices, setRange,
  }), [range, expanded, meta, register, zoomBy, zoomFrom, pan, reset, selectIndices]);

  return <ZoomCtx.Provider value={value}>{children}</ZoomCtx.Provider>;
}

// Wraps the drawn chart: Ctrl + scroll (plain scroll in the expanded view) and two-finger pinch zoom it, plain scrolling keeps scrolling the page.
export function ZoomSurface({ children, className = '' }) {
  const zoom = useZoom();
  const ref = useRef(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let pinch = null;
    const fracOf = clientX => { const r = el.getBoundingClientRect(); return Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width))); };
    const spread = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onWheel = e => {
      const z = zoomRef.current;
      if (!z?.zoomable || !(z.expanded || e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const [a, b] = z.rangeRef.current;
      z.zoomBy(e.deltaY < 0 ? 0.8 : 1.25, a + fracOf(e.clientX) * (b - a));
    };
    const onStart = e => {
      const z = zoomRef.current;
      if (e.touches.length === 2 && z?.zoomable) {
        pinch = { d0: spread(e.touches), start: [...z.rangeRef.current], frac: fracOf((e.touches[0].clientX + e.touches[1].clientX) / 2) };
      }
    };
    const onMove = e => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const d = spread(e.touches);
      if (d > 0) zoomRef.current.zoomFrom(pinch.start, pinch.d0 / d, pinch.frac);
    };
    const onEnd = () => { pinch = null; };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return <div ref={ref} className={`an-chart-surface${zoom?.zoomable ? ' an-zoomable' : ''} ${className}`}>{children}</div>;
}

// Zoom in / out buttons for the card toolbar, and the always-visible "Zoomed to ... Reset" strip.
export function ZoomButtons({ labels = false }) {
  const z = useZoom();
  if (!z?.zoomable) return null;
  return (
    <>
      <Tooltip title="Zoom in"><Button size="small" type="text" icon={<ZoomInOutlined />} onClick={() => z.zoomBy(0.5)} disabled={z.count > 0 && (z.range[1] - z.range[0]) * z.count <= MIN_VISIBLE + 0.01} aria-label="Zoom in">{labels ? 'Zoom in' : null}</Button></Tooltip>
      <Tooltip title="Zoom out"><Button size="small" type="text" icon={<ZoomOutOutlined />} onClick={() => z.zoomBy(2)} disabled={!z.zoomed} aria-label="Zoom out">{labels ? 'Zoom out' : null}</Button></Tooltip>
      {z.zoomed && <Button size="small" type="text" className="an-reset" icon={<UndoOutlined />} onClick={z.reset} aria-label="Reset zoom">Reset</Button>}
    </>
  );
}

export function ZoomBar() {
  const z = useZoom();
  if (!z?.zoomable || !z.zoomed) return null;
  return (
    <div className="an-zoombar" data-no-export role="status">
      <span>Zoomed to <b>{z.label || 'part of the chart'}</b></span>
      <span className="grow" />
      <Button size="small" type="text" icon={<LeftOutlined />} onClick={() => z.pan(-1)} disabled={z.range[0] <= 0.0001} aria-label="Earlier" />
      <Button size="small" type="text" icon={<RightOutlined />} onClick={() => z.pan(1)} disabled={z.range[1] >= 0.9999} aria-label="Later" />
      <Button size="small" type="primary" icon={<UndoOutlined />} onClick={z.reset}>Reset zoom</Button>
    </div>
  );
}

// What a chart calls to get the part of its rows that is visible, plus drag-to-select handlers for the chart element.
// `label(row)` names a row for the "Zoomed to ..." strip. `drag: false` for charts that cannot map the mouse to a row.
export function useZoomView(rows, { label, drag = true } = {}) {
  const z = useZoom();
  const n = rows.length;
  const [from, to] = z ? z.range : [0, 1];
  const lo = n ? Math.min(n - 1, Math.floor(from * n + 1e-6)) : 0;
  const hi = n ? Math.max(lo + 1, Math.min(n, Math.ceil(to * n - 1e-6))) : 0;
  const view = useMemo(() => (lo === 0 && hi === n ? rows : rows.slice(lo, hi)), [rows, lo, hi, n]);
  const text = view.length && label ? (view.length === 1 ? label(view[0]) : `${label(view[0])} to ${label(view[view.length - 1])}`) : '';

  const register = z?.register;
  useEffect(() => { register?.(n, text, lo, hi, drag); }, [register, n, text, lo, hi, drag]);
  // New data with a different number of categories (filters changed): start from the full range again.
  const previousCount = useRef(n);
  useEffect(() => { if (previousCount.current !== n) { previousCount.current = n; z?.reset(); } }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  const [sel, setSel] = useState(null);
  const selRef = useRef(null);
  const enabled = !!z && drag && n > MIN_VISIBLE;
  const idxOf = state => { const i = Number(state?.activeTooltipIndex ?? state?.activeIndex); return Number.isFinite(i) ? i : null; };
  const handlers = useMemo(() => (enabled ? {
    onMouseDown: state => { const i = idxOf(state); if (i !== null) { selRef.current = { a: i, b: i }; setSel(selRef.current); } },
    onMouseMove: state => {
      if (!selRef.current) return;
      const i = idxOf(state);
      if (i !== null && i !== selRef.current.b) { selRef.current = { ...selRef.current, b: i }; setSel(selRef.current); }
    },
    onMouseUp: () => {
      const s = selRef.current;
      selRef.current = null;
      setSel(null);
      if (s && s.a !== s.b) z.selectIndices(lo + Math.min(s.a, s.b), lo + Math.max(s.a, s.b), n);
    },
    onMouseLeave: () => { selRef.current = null; setSel(null); },
  } : {}), [enabled, z?.selectIndices, lo, n]); // eslint-disable-line react-hooks/exhaustive-deps

  const selection = sel && sel.a !== sel.b && view[sel.a] && view[sel.b] ? { a: Math.min(sel.a, sel.b), b: Math.max(sel.a, sel.b) } : null;
  return { view, lo, hi, n, handlers, selection, zoomed: !!z?.zoomed, expanded: !!z?.expanded };
}

// Taller charts in the expanded (full-screen) view.
export function useChartHeight(base) {
  const z = useZoom();
  if (!z?.expanded) return base;
  const room = typeof window === 'undefined' ? 600 : window.innerHeight;
  return Math.max(Math.round(base * 1.5), Math.min(720, Math.round(room * 0.62)));
}
