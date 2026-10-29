import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart, ReferenceArea, ReferenceLine, Scatter,
  ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { Button, Dropdown, Empty, Modal, Tooltip as AntTip, message } from 'antd';
import {
  DownloadOutlined, FileExcelOutlined, FileImageOutlined, FileTextOutlined, FullscreenExitOutlined, FullscreenOutlined, InfoCircleOutlined,
  ReloadOutlined, TableOutlined, WarningOutlined, BarChartOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useFilters } from '../context/Filters';
import { exportCsv, exportExcel, exportPng } from '../utils/exporters';
import { dayLabel, monthLabel } from '../utils/format';
import { BRAND, FONT, GRID, RAMP, SERIES, TEAM, TEXT } from '../theme';
import { useElementWidth } from './analytics/hooks';
import { compact, fmtInt, niceTicks, rangeTicks, truncate, wrapText } from './analytics/fmt';
import { MIN_VISIBLE, ZoomBar, ZoomButtons, ZoomProvider, ZoomSurface, useChartHeight, useZoom, useZoomView } from './analytics/zoom';
import '../styles/analytics.css';

// ── The card every chart sits in ───────────────────────────────────────────────────────────────────────────────────────────────
// Title, definition tooltip, zoom + expand + download toolbar, loading skeleton, error with retry, empty state and a "view as table" switch.
// `data` is { columns: [...], rows: [[...]] } - exactly what the chart shows - so the downloaded numbers always match the picture.

const TOUCH = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

function Skeleton({ height = 220 }) {
  const bars = [46, 70, 38, 82, 58, 90, 64, 48];
  return (
    <div className="an-skel" style={{ height }} role="status" aria-label="Loading">
      <div className="an-skel-bars">{bars.map((b, i) => <i key={i} style={{ height: `${b}%` }} />)}</div>
    </div>
  );
}

function DataTable({ data }) {
  const rows = data.rows.slice(0, 300);
  const show = v => (v === null || v === undefined ? '-' : typeof v === 'number' ? v.toLocaleString() : String(v));
  return (
    <>
      <div className="an-datatable" tabIndex={0} role="region" aria-label="Chart data">
        <table>
          <thead><tr>{data.columns.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{show(v)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {data.rows.length > rows.length && <div className="an-foot-note">Showing the first {rows.length} of {data.rows.length.toLocaleString()} rows. Download for all of them.</div>}
    </>
  );
}

// Charts made of several drawings (flow + backlog) are joined into one picture for the PNG download.
async function exportPicture(container, options) {
  const stack = container.querySelector('[data-export-stack]');
  const svgs = stack ? [...stack.querySelectorAll('svg.recharts-surface')] : [];
  if (svgs.length < 2) return exportPng(container, options);
  const NS = 'http://www.w3.org/2000/svg';
  const boxes = svgs.map(s => s.getBoundingClientRect());
  const width = Math.ceil(Math.max(...boxes.map(b => b.width)));
  const height = Math.ceil(boxes.reduce((sum, b) => sum + b.height, 0));
  const wrap = document.createElementNS(NS, 'svg');
  wrap.setAttribute('width', width);
  wrap.setAttribute('height', height);
  wrap.setAttribute('viewBox', `0 0 ${width} ${height}`);
  let y = 0;
  svgs.forEach((s, i) => {
    const clone = s.cloneNode(true);
    clone.setAttribute('x', 0);
    clone.setAttribute('y', y);
    clone.setAttribute('width', boxes[i].width);
    clone.setAttribute('height', boxes[i].height);
    wrap.appendChild(clone);
    y += boxes[i].height;
  });
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;';
  holder.appendChild(wrap);
  document.body.appendChild(holder);
  try { await exportPng(holder, options); } finally { holder.remove(); }
}

function Toolbar({ title, info }) {
  return (
    <div className="an-title-row">
      <h3 className="card-title">{title}</h3>
      {info && (
        <AntTip title={info} trigger={['hover', 'focus', 'click']}>
          <button type="button" className="an-info-btn" aria-label={`How "${title}" is calculated`}><InfoCircleOutlined /></button>
        </AntTip>
      )}
    </div>
  );
}

function ChartLegend({ legend }) {
  if (legend.length < 2) return null;
  return (
    <div className="chart-legend" data-no-export>
      {legend.map(item => <span key={item.label} className="legend-item"><i style={{ background: item.color }} />{item.label}</span>)}
    </div>
  );
}

function CardView({ title, subtitle, legend = [], data, filename, children, extra, empty, loading, error, onRetry, hint, style, image = true, info, onExpand, skeleton = 220 }) {
  const z = useZoom();
  const bodyRef = useRef(null);
  const { describe } = useFilters();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('chart');
  const hasData = !!data && data.rows.length > 0;
  const aligned = z.zoomed && hasData && data.rows.length === z.count;
  const showChart = view === 'chart';

  async function run(kind) {
    setBusy(true);
    const zoomNote = z.zoomed ? `zoomed to ${z.label}` : '';
    try {
      if (kind === 'png') {
        await exportPicture(bodyRef.current, {
          title, subtitle: [subtitle, z.zoomed ? `Zoomed to ${z.label}` : ''].filter(Boolean).join(' · '), legend, note: describe(), filename: `${filename || title}${z.zoomed ? '_zoomed' : ''}`,
        });
      } else {
        const visible = kind.endsWith('-view');
        const table = visible ? { columns: data.columns, rows: data.rows.slice(z.lo, z.hi) } : data;
        const base = filename || title;
        if (kind.startsWith('csv')) exportCsv(table, visible ? `${base}_zoomed` : base);
        else await exportExcel(table, { title: visible ? `${title} (${zoomNote})` : title, note: describe(), sheetName: title });
      }
    } catch (error) {
      message.error(error.message || 'The download failed');
    } finally {
      setBusy(false);
    }
  }

  const items = [
    ...(image ? [{ key: 'png', icon: <FileImageOutlined />, label: z.zoomed ? 'Picture (PNG) - current zoom' : 'Picture (PNG)', disabled: !hasData || !showChart }] : []),
    ...(aligned ? [
      { key: 'xlsx-view', icon: <FileExcelOutlined />, label: `Data (Excel) - zoomed range only (${z.hi - z.lo} rows)` },
      { key: 'csv-view', icon: <FileTextOutlined />, label: 'Data (CSV) - zoomed range only' },
    ] : []),
    { key: 'xlsx', icon: <FileExcelOutlined />, label: aligned ? `Data (Excel) - all ${data.rows.length} rows` : 'Data (Excel)', disabled: !hasData },
    { key: 'csv', icon: <FileTextOutlined />, label: aligned ? 'Data (CSV) - all rows' : 'Data (CSV)', disabled: !hasData },
  ];

  let body;
  if (loading) body = <Skeleton height={skeleton} />;
  else if (error) {
    body = (
      <div className="an-state" role="alert">
        <WarningOutlined />
        <p>{error}</p>
        {onRetry && <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>Retry</Button>}
      </div>
    );
  } else if (!hasData && !children) body = <div className="an-state"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty || 'Nothing to show for these filters'} /></div>;
  else if (!hasData) body = <div className="an-state"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty || 'Nothing to show for these filters'} /></div>;
  else body = null;

  const ready = !loading && !error && hasData;
  return (
    <section className="card chart-card an-card" style={style} aria-busy={loading || undefined}>
      <header className="card-head">
        <div style={{ minWidth: 0 }}>
          <Toolbar title={title} info={info} />
          {subtitle && <div className="card-sub">{subtitle}</div>}
        </div>
        <div className="card-actions an-actions">
          {extra}
          {ready && showChart && <ZoomButtons />}
          {ready && data && (
            <AntTip title={showChart ? 'View the numbers as a table' : 'Back to the chart'}>
              <Button size="small" type="text" icon={showChart ? <TableOutlined /> : <BarChartOutlined />} onClick={() => setView(showChart ? 'table' : 'chart')} aria-label={showChart ? 'View as table' : 'View as chart'} aria-pressed={!showChart} />
            </AntTip>
          )}
          {ready && showChart && (
            <AntTip title="Expand"><Button size="small" type="text" icon={<FullscreenOutlined />} onClick={() => onExpand?.(z.range)} aria-label={`Expand ${title}`} /></AntTip>
          )}
          <Dropdown menu={{ items, onClick: ({ key }) => run(key) }} trigger={['click']} disabled={loading || !!error}>
            <Button size="small" type="text" icon={<DownloadOutlined />} loading={busy} aria-label={`Download ${title}`}>
              <span className="an-dl-label">Download</span>
            </Button>
          </Dropdown>
        </div>
      </header>
      {showChart && <ChartLegend legend={legend} />}
      {ready && showChart && <ZoomBar />}
      <div ref={bodyRef} className="chart-body">
        {body || (showChart ? <ZoomSurface>{children}</ZoomSurface> : <DataTable data={data} />)}
      </div>
      {hint && ready && showChart && (
        <div className="card-hint" data-no-export>
          {hint}{z.zoomable ? (TOUCH ? ' · Pinch the chart or use the zoom buttons' : z.drag ? ' · Drag across the chart to zoom' : ' · Zoom with the buttons or Ctrl + scroll') : ''}
        </div>
      )}
    </section>
  );
}

function ExpandedView({ title, subtitle, legend, children, initial, onClose, info, data }) {
  return (
    <Modal
      open onCancel={onClose} footer={null} width="min(1400px, 96vw)" centered destroyOnHidden
      closeIcon={<FullscreenExitOutlined aria-label="Close expanded view" />}
      title={<div><Toolbar title={title} info={info} />{subtitle && <div className="card-sub" style={{ fontWeight: 400 }}>{subtitle}</div>}</div>}
    >
      <ZoomProvider initial={initial} expanded>
        <ExpandedBody legend={legend} data={data}>{children}</ExpandedBody>
      </ZoomProvider>
    </Modal>
  );
}

function ExpandedBody({ legend, children, data }) {
  const z = useZoom();
  const [view, setView] = useState('chart');
  return (
    <div>
      <div className="an-actions" style={{ justifyContent: 'flex-start', marginBottom: 6 }}>
        {view === 'chart' && <ZoomButtons labels />}
        {data && <Button size="small" type="text" icon={view === 'chart' ? <TableOutlined /> : <BarChartOutlined />} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>{view === 'chart' ? 'Table' : 'Chart'}</Button>}
        {z.zoomable && view === 'chart' && <span className="an-muted" style={{ fontSize: 12, marginLeft: 6 }}>Scroll to zoom{z.drag ? ', drag across the chart to select a range' : ''}</span>}
      </div>
      {view === 'chart' && <ChartLegend legend={legend} />}
      {view === 'chart' && <ZoomBar />}
      {view === 'chart' ? <ZoomSurface>{children}</ZoomSurface> : <DataTable data={data} />}
    </div>
  );
}

export function ChartCard(props) {
  const [expandedFrom, setExpandedFrom] = useState(null);
  const ready = !props.loading && !props.error && !!props.data && props.data.rows.length > 0;
  return (
    <ZoomProvider>
      <CardView {...props} onExpand={range => setExpandedFrom({ range })} />
      {expandedFrom && ready && (
        <ExpandedView title={props.title} subtitle={props.subtitle} legend={props.legend || []} info={props.info} data={props.data} initial={expandedFrom.range} onClose={() => setExpandedFrom(null)}>
          {props.children}
        </ExpandedView>
      )}
    </ZoomProvider>
  );
}

// ── Shared chart pieces ────────────────────────────────────────────────────────────────────────────────────────────────────────
function Sized({ height, children }) {
  const [ref, width] = useElementWidth();
  return <div ref={ref} style={{ width: '100%', height }}>{width > 0 ? children(width) : null}</div>;
}

const tick = { fontSize: 12, fill: TEXT.secondary, fontFamily: FONT };
const axisProps = { tickLine: false, axisLine: { stroke: GRID }, tick };
const CURSOR_BAND = { fill: 'rgba(79,70,229,0.07)' };
const CURSOR_LINE = { stroke: '#b8bcd6', strokeDasharray: '3 3' };
const noSelect = { userSelect: 'none' };

const yWidth = (formatted, extra = 0) => Math.max(34, Math.min(84, Math.max(...formatted.map(s => String(s).length), 1) * 7 + 12)) + extra;
// How many ticks to skip so labels of `maxLen` characters never touch.
const thinInterval = (width, count, maxLen) => {
  const step = Math.ceil((maxLen * 6.6 + 12) / Math.max(1, (width - 56) / Math.max(count, 1)));
  return step <= 1 ? 0 : step - 1;
};

function WrapTick({ x, y, payload, fmt, maxChars, maxLines }) {
  const text = String(fmt ? fmt(payload.value) : payload.value);
  const lines = wrapText(text, maxChars, maxLines);
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{text}</title>
      <text textAnchor="middle" fill={TEXT.secondary} fontSize={12} fontFamily={FONT}>
        {lines.map((l, i) => <tspan key={i} x={0} dy={i === 0 ? 13 : 13}>{l}</tspan>)}
      </text>
    </g>
  );
}

// One tooltip line: marker, name, value. A value made of several figures ("average 5d 11h · median 4h 41m · 5,424 closed") is stacked
// one figure per line, and anything still too long wraps, so a tooltip is never wider than its box.
function TipRow({ item }) {
  const parts = typeof item.value === 'string' && item.value.length > 16 && item.value.includes(' · ') ? item.value.split(' · ') : null;
  const marker = item.color ? <i style={{ background: item.color }} /> : null;
  const hasValue = item.value !== '' && item.value !== null && item.value !== undefined;
  if (!parts) return <div className="chart-tip-row">{marker}<span className="tip-name">{item.name}</span>{hasValue ? <b>{item.value}</b> : null}</div>;
  return (
    <div>
      <div className="chart-tip-row">{marker}<span className="tip-name">{item.name}</span></div>
      {parts.map(p => <div key={p} className="chart-tip-line">{p}</div>)}
    </div>
  );
}

function ChartTooltip({ active, payload, label, title, rows, note }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const items = rows
    ? rows(payload)
    : payload.filter(p => p.value !== null && p.value !== undefined).map(p => ({ name: p.name, value: p.value, color: p.color || p.fill || p.stroke }));
  const heading = title ? title(label, row) : label;
  const footer = note ? note(row) : null;
  return (
    <div className="chart-tip an-tip">
      {heading ? <div className="chart-tip-title">{heading}</div> : null}
      {items.map((i, idx) => (
        <TipRow key={`${i.name}${idx}`} item={i} />
      ))}
      {footer ? <div className="an-tip-note">{footer}</div> : null}
    </div>
  );
}

const tooltipProps = { isAnimationActive: false, wrapperStyle: { zIndex: 50, pointerEvents: 'none' } };

function selectionArea(zv, rows, xKey, vertical = false) {
  if (!zv.selection) return null;
  const a = rows[zv.selection.a]?.[xKey];
  const b = rows[zv.selection.b]?.[xKey];
  if (a === undefined || b === undefined) return null;
  const common = { fill: BRAND, fillOpacity: 0.12, stroke: BRAND, strokeOpacity: 0.45, ifOverflow: 'visible' };
  return vertical ? <ReferenceArea key="sel" y1={a} y2={b} {...common} /> : <ReferenceArea key="sel" x1={a} x2={b} {...common} />;
}

// A click that ends a drag-to-zoom is not a click on a bar.
const useDragGuard = () => {
  const at = useRef(0);
  const mark = useCallback(() => { at.current = Date.now(); }, []);
  const recent = useCallback(() => Date.now() - at.current < 350, []);
  return [mark, recent];
};

function withDragMark(handlers, mark) {
  if (!handlers.onMouseUp) return handlers;
  return { ...handlers, onMouseUp: (...args) => { mark(); handlers.onMouseUp(...args); } };
}

// ── Vertical bars ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `series` = [{ key, label, color, format? }]. Click a bar to drill in. `timeAxis` for months/days (labels are thinned instead of wrapped).
export function ColumnChart({ rows, xKey, series, stacked = false, height = 260, xFormat, yFormat, yLabel, onSelect, labelFormat, maxBarSize = 44, timeAxis = false, valueLabels, tipNote }) {
  const h = useChartHeight(height);
  const fmtX = useCallback(v => (xFormat ? xFormat(v) : v), [xFormat]);
  const zv = useZoomView(rows, { label: r => String(fmtX(r[xKey])) });
  const [mark, recent] = useDragGuard();
  const { view } = zv;
  const showLabels = valueLabels ?? (series.length === 1 && !stacked && view.length <= 8);
  const yFmt = yFormat || compact;
  const maxValue = Math.max(1, ...view.map(r => series.reduce((s, x) => (stacked ? s + (Number(r[x.key]) || 0) : Math.max(s, Number(r[x.key]) || 0)), 0)));
  const axis = niceTicks(maxValue * (showLabels ? 1.02 : 1), 4, !yFormat);
  const handlers = withDragMark(zv.handlers, mark);

  return (
    <Sized height={h}>{w => {
      const band = (w - 56) / Math.max(view.length, 1);
      const maxLen = Math.max(...view.map(r => String(fmtX(r[xKey])).length), 1);
      const wrap = !timeAxis && band >= 30;
      const maxChars = Math.max(5, Math.floor(band / 6.2));
      const lines = wrap ? Math.min(3, Math.max(1, Math.ceil(maxLen / maxChars))) : 1;
      const interval = wrap ? 0 : thinInterval(w, view.length, maxLen);
      return (
        <BarChart width={w} height={h} data={view} style={noSelect} margin={{ top: showLabels ? 22 : 10, right: 8, left: 0, bottom: 0 }} barCategoryGap="24%" {...handlers}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={xKey} {...axisProps} interval={interval} height={wrap ? 10 + lines * 13 : 26} tickMargin={4}
            tick={wrap ? (p => <WrapTick {...p} fmt={xFormat} maxChars={maxChars} maxLines={lines} />) : tick} tickFormatter={wrap ? undefined : xFormat} />
          <YAxis {...axisProps} axisLine={false} width={yWidth([yFmt(axis.max)], yLabel ? 16 : 0)} tickFormatter={yFmt} ticks={axis.ticks} domain={[0, axis.max]} interval={0}
            label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { ...tick, textAnchor: 'middle' }, offset: 6 } : undefined} />
          <Tooltip {...tooltipProps} cursor={CURSOR_BAND} content={<ChartTooltip title={(l, row) => (labelFormat ? labelFormat(l, row) : fmtX(l))} note={tipNote}
            rows={payload => payload.map(p => {
              const s = series.find(x => x.key === p.dataKey);
              return { name: s?.label || p.name, value: s?.format ? s.format(p.value, p.payload) : fmtInt(p.value), color: s?.color };
            })} />} />
          {series.map(s => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stacked ? 'a' : undefined} maxBarSize={maxBarSize}
              radius={stacked ? 0 : [3, 3, 0, 0]} stroke={stacked ? '#fff' : undefined} strokeWidth={stacked ? 2 : 0}
              cursor={onSelect ? 'pointer' : 'default'} isAnimationActive={false}
              onClick={onSelect ? ((d => { if (!recent()) onSelect(d.payload || d, s.key); }) ) : undefined}>
              {showLabels && s === series[0] && (
                <LabelList dataKey={s.key} position="top" formatter={v => (s.labelFormat ? s.labelFormat(v) : yFmt(v))} style={{ fontSize: 12, fill: TEXT.primary, fontFamily: FONT, fontWeight: 600 }} />
              )}
            </Bar>
          ))}
          {selectionArea(zv, view, xKey)}
        </BarChart>
      );
    }}</Sized>
  );
}

// ── Lines over time ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `series` = [{ key, label, color, dashed?, format? }]. Gaps in the data stay gaps (the line is not drawn across months with no figures).
export function LineTrend({ rows, xKey, series, height = 260, xFormat, yFormat, yLabel, labelFormat, onSelect, tipNote, refs }) {
  const h = useChartHeight(height);
  const fmtX = useCallback(v => (xFormat ? xFormat(v) : v), [xFormat]);
  const zv = useZoomView(rows, { label: r => String(fmtX(r[xKey])) });
  const [mark, recent] = useDragGuard();
  const { view } = zv;
  const yFmt = yFormat || compact;
  const maxValue = Math.max(0.1, ...view.flatMap(r => series.map(s => Number(r[s.key]) || 0)));
  const axis = niceTicks(maxValue, 4, !yFormat);
  const handlers = withDragMark(zv.handlers, mark);
  const dots = view.length <= 40;

  return (
    <Sized height={h}>{w => {
      const maxLen = Math.max(...view.map(r => String(fmtX(r[xKey])).length), 1);
      return (
        <LineChart width={w} height={h} data={view} style={noSelect} margin={{ top: 10, right: 14, left: 0, bottom: 0 }} {...handlers}
          onClick={onSelect ? (state => { const i = Number(state?.activeTooltipIndex); if (!recent() && Number.isFinite(i) && view[i]) onSelect(view[i]); }) : undefined}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormat} interval={thinInterval(w, view.length, maxLen)} height={26} tickMargin={4} />
          <YAxis {...axisProps} axisLine={false} width={yWidth([yFmt(axis.max)], yLabel ? 16 : 0)} tickFormatter={yFmt} ticks={axis.ticks} domain={[0, axis.max]} interval={0}
            label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { ...tick, textAnchor: 'middle' }, offset: 6 } : undefined} />
          <Tooltip {...tooltipProps} cursor={CURSOR_LINE} content={<ChartTooltip title={(l, row) => (labelFormat ? labelFormat(l, row) : fmtX(l))} note={tipNote}
            rows={payload => payload.filter(p => p.value !== null && p.value !== undefined).map(p => {
              const s = series.find(x => x.key === p.dataKey);
              return { name: s?.label || p.name, value: s?.format ? s.format(p.value, p.payload) : fmtInt(p.value), color: s?.color };
            })} />} />
          {(refs || []).map(r => <ReferenceLine key={r.label} y={r.y} stroke={TEXT.muted} strokeDasharray="4 4" label={{ value: r.label, position: 'insideTopRight', fontSize: 11, fill: TEXT.secondary, fontFamily: FONT }} />)}
          {series.map(s => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined}
              dot={dots ? { r: 3, strokeWidth: 2, stroke: '#fff', fill: s.color } : false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
          ))}
          {selectionArea(zv, view, xKey)}
        </LineChart>
      );
    }}</Sized>
  );
}

// ── Weekly flow (SRs started / closed) over the backlog still open ─────────────────────────────────────────────────────────────
// Two panels that share one time axis (hovering one marks the other): counts of SRs per week on top, the open backlog below. They are
// different kinds of number (a rate and a stock), so they are not squeezed onto one scale.
function weekTicks(keys, width) {
  const n = keys.length;
  if (!n) return { ticks: [], fmt: v => v };
  const target = Math.max(2, Math.floor((width - 60) / 80));
  if (n <= 30) {
    const step = Math.max(1, Math.ceil(n / target));
    return { ticks: keys.filter((_, i) => i % step === 0), fmt: dayLabel };
  }
  const seen = new Set();
  const months = [];
  keys.forEach(k => { const m = k.slice(0, 7); if (!seen.has(m)) { seen.add(m); months.push(k); } });
  const step = Math.max(1, Math.ceil(months.length / target));
  return { ticks: months.filter((_, i) => i % step === 0), fmt: k => monthLabel(k.slice(0, 7)) };
}

export function FlowChart({ rows, height = 300, onSelect }) {
  const h = useChartHeight(height);
  const zv = useZoomView(rows, { label: r => dayjs(r.key).format('D MMM YYYY') });
  const [mark, recent] = useDragGuard();
  const { view } = zv;
  const handlers = withDragMark(zv.handlers, mark);
  const topH = Math.round(h * 0.58);
  const botH = h - topH;
  const maxFlow = Math.max(1, ...view.map(r => Math.max(r.assigned, r.closed)));
  const maxBacklog = Math.max(1, ...view.map(r => r.backlog));
  const flowAxis = niceTicks(maxFlow, 3, true);
  const backlogAxis = niceTicks(maxBacklog, 2, true);
  const lw = yWidth([compact(flowAxis.max), compact(backlogAxis.max)], 18);
  const click = state => { const i = Number(state?.activeTooltipIndex); if (!recent() && onSelect && Number.isFinite(i) && view[i]) onSelect(view[i]); };

  return (
    <div data-export-stack>
      <Sized height={h}>{w => {
        const { ticks, fmt } = weekTicks(view.map(r => r.key), w - lw);
        const common = { width: w, data: view, syncId: 'flow', syncMethod: 'index', style: noSelect };
        return (
          <>
            <LineChart {...common} height={topH} margin={{ top: 8, right: 14, left: 0, bottom: 8 }} {...handlers} onClick={click}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="key" hide />
              <YAxis {...axisProps} axisLine={false} width={lw} tickFormatter={compact} ticks={flowAxis.ticks} domain={[0, flowAxis.max]} interval={0}
                label={{ value: 'SRs per week', angle: -90, position: 'insideLeft', style: { ...tick, textAnchor: 'middle' }, offset: 4 }} />
              <Tooltip {...tooltipProps} cursor={CURSOR_LINE} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload;
                return (
                  <div className="chart-tip an-tip">
                    <div className="chart-tip-title">Week of {dayjs(r.key).format('D MMM YYYY')}</div>
                    <div className="chart-tip-row"><i style={{ background: SERIES[0] }} />SRs started<b>{fmtInt(r.assigned)}</b></div>
                    <div className="chart-tip-row"><i style={{ background: SERIES[2] }} />SRs closed<b>{fmtInt(r.closed)}</b></div>
                    <div className="chart-tip-row"><i style={{ background: SERIES[1] }} />Backlog at week end<b>{fmtInt(r.backlog)}</b></div>
                  </div>
                );
              }} />
              <Line type="monotone" dataKey="assigned" name="SRs started" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="closed" name="SRs closed" stroke={SERIES[2]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
              {selectionArea(zv, view, 'key')}
            </LineChart>
            <AreaChart {...common} height={botH} margin={{ top: 10, right: 14, left: 0, bottom: 0 }} {...handlers} onClick={click}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="key" {...axisProps} ticks={ticks} tickFormatter={fmt} interval={0} height={26} tickMargin={4} />
              <YAxis {...axisProps} axisLine={false} width={lw} tickFormatter={compact} ticks={backlogAxis.ticks} domain={[0, backlogAxis.max]} interval={0}
                label={{ value: 'Open SRs', angle: -90, position: 'insideLeft', style: { ...tick, textAnchor: 'middle' }, offset: 4 }} />
              <Tooltip {...tooltipProps} cursor={CURSOR_LINE} content={() => null} />
              <Area type="monotone" dataKey="backlog" name="Backlog" stroke={SERIES[1]} strokeWidth={2} fill={SERIES[1]} fillOpacity={0.16} dot={false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
              {selectionArea(zv, view, 'key')}
            </AreaChart>
          </>
        );
      }}</Sized>
    </div>
  );
}

// ── Ranked horizontal bars ─────────────────────────────────────────────────────────────────────────────────────────────────────
// The value is printed at the end of each bar. `color` may be a function of the row. Long names are cut with the full name in the tooltip.
export function HBarChart({ rows, labelKey = 'label', valueKey = 'value', color = SERIES[0], format = v => v, tip, onSelect, rowHeight = 30, labelWidth, maxRows }) {
  const base = useMemo(() => (maxRows ? rows.slice(0, maxRows) : rows), [rows, maxRows]);
  const zv = useZoomView(base, { label: r => String(r[labelKey]) });
  const [mark, recent] = useDragGuard();
  const shown = zv.view;
  const fullHeight = useChartHeight(Math.max(120, base.length * rowHeight + 24));
  const max = Math.max(...shown.map(r => Number(r[valueKey]) || 0), 1);
  const handlers = withDragMark(zv.handlers, mark);
  const colorOf = r => (typeof color === 'function' ? color(r) : color);

  return (
    <Sized height={fullHeight}>{w => {
      const lw = labelWidth ?? Math.round(Math.max(88, Math.min(170, w * 0.36)));
      const maxChars = Math.floor((lw - 6) / 6.6);
      return (
        <BarChart width={w} height={fullHeight} data={shown} layout="vertical" style={noSelect} margin={{ top: 4, right: 58, left: 4, bottom: 4 }} barCategoryGap="26%" {...handlers}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" hide domain={[0, max]} />
          <YAxis type="category" dataKey={labelKey} width={lw} tickLine={false} axisLine={false} interval={0}
            tick={p => <HLabel {...p} maxChars={maxChars} />} />
          <Tooltip {...tooltipProps} cursor={CURSOR_BAND} content={<ChartTooltip title={() => ''} rows={payload => [{
            name: String(payload[0].payload[labelKey]), value: tip ? tip(payload[0].payload) : format(payload[0].value, payload[0].payload), color: colorOf(payload[0].payload),
          }]} />} />
          <Bar dataKey={valueKey} radius={[0, 3, 3, 0]} maxBarSize={26} isAnimationActive={false} cursor={onSelect ? 'pointer' : 'default'}
            onClick={onSelect ? (d => { if (!recent()) onSelect(d.payload || d); }) : undefined}>
            {shown.map((r, i) => <Cell key={i} fill={colorOf(r)} />)}
            <LabelList dataKey={r => r} content={({ x, y, width, height: bh, value: row }) => (
              <text x={Math.max(x, x + width) + 6} y={y + bh / 2 + 4} fontSize={12} fontWeight={600} fill={TEXT.primary} fontFamily={FONT}>{format(row[valueKey], row)}</text>
            )} />
          </Bar>
          {selectionArea(zv, shown, labelKey, true)}
        </BarChart>
      );
    }}</Sized>
  );
}

function HLabel({ x, y, payload, maxChars }) {
  const text = String(payload.value);
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{text}</title>
      <text x={-8} y={0} dy={4} textAnchor="end" fill={TEXT.primary} fontSize={12} fontFamily={FONT}>{truncate(text, maxChars)}</text>
    </g>
  );
}

// ── Share of a whole ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// The total sits in the middle; the parts are listed beside it with counts and percentages, so nothing relies on colour alone.
export function DonutChart({ rows, nameKey = 'name', valueKey = 'value', colors = SERIES, height = 220, onSelect, centerLabel = 'SRs' }) {
  const size = useChartHeight(height);
  const total = useMemo(() => rows.reduce((sum, r) => sum + (Number(r[valueKey]) || 0), 0), [rows, valueKey]);
  const colorOf = (r, i) => (typeof colors === 'function' ? colors(r) : colors[i % colors.length]);
  const pct = v => (total ? `${Math.round((v / total) * 1000) / 10}%` : '');
  return (
    <div className="donut">
      <div style={{ width: size, height: size, position: 'relative', flex: '0 0 auto', maxWidth: '100%' }}>
        <PieChart width={size} height={size}>
          <Pie data={rows} dataKey={valueKey} nameKey={nameKey} innerRadius="62%" outerRadius="92%" paddingAngle={rows.length > 1 ? 2 : 0} stroke="#fff" strokeWidth={2}
            isAnimationActive={false} cursor={onSelect ? 'pointer' : 'default'} onClick={onSelect ? (d => onSelect(d.payload || d)) : undefined}>
            {rows.map((r, i) => <Cell key={i} fill={colorOf(r, i)} />)}
          </Pie>
          <Tooltip {...tooltipProps} content={<ChartTooltip title={() => ''} rows={payload => [{ name: payload[0].name, value: `${fmtInt(payload[0].value)} (${pct(payload[0].value)})`, color: payload[0].payload.fill }]} />} />
        </PieChart>
        <div className="donut-center"><b>{fmtInt(total)}</b><span>{centerLabel}</span></div>
      </div>
      <ul className="donut-list an-donut-list">
        {rows.map((r, i) => (
          <li key={r[nameKey]} title={r[nameKey]}
            role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} style={{ cursor: onSelect ? 'pointer' : 'default' }}
            onClick={onSelect ? (() => onSelect(r)) : undefined}
            onKeyDown={onSelect ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r); } }) : undefined}>
            <i style={{ background: colorOf(r, i) }} /><span className="an-donut-name" style={{ width: 'auto', textAlign: 'left', color: 'inherit', fontSize: 13 }}>{r[nameKey]}</span><b>{fmtInt(r[valueKey])}</b>
            <span>{pct(r[valueKey])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Heatmap (SVG, so it downloads like every other chart) ──────────────────────────────────────────────────────────────────────
const rampColor = (value, max) => {
  if (!value) return '#f1f3fa';
  return RAMP[Math.min(RAMP.length - 1, Math.floor((value / max) * RAMP.length - 1e-9))];
};

// values[r][c] = number (or null). Zoom narrows the columns (months, hours); a number is printed inside a cell when it fits.
export function Heatmap({ rowLabels, colLabels, values, labelWidth = 130, cellHeight = 26, format = v => v, showValues = true, onSelect, tip, legendLabel = 'Fewer' }) {
  const z = useZoom();
  const columns = useMemo(() => colLabels.map((c, i) => ({ c, i })), [colLabels]);
  const zv = useZoomView(columns, { label: r => String(r.c), drag: false });
  const [ref, measured] = useElementWidth();
  const [hover, setHover] = useState(null);
  const dragFrom = useRef(null);
  const view = zv.view;
  const lw = measured && measured < 520 ? Math.min(labelWidth, 100) : labelWidth;
  const maxChars = Math.floor((lw - 10) / 6.4);
  const width = Math.max(measured || 320, lw + view.length * 15);
  const cellW = (width - lw) / Math.max(view.length, 1);
  const headerH = 28;
  const bodyH = rowLabels.length * cellHeight;
  const height = headerH + bodyH + 30;
  const max = useMemo(() => Math.max(1, ...values.flat().map(v => v || 0)), [values]);
  const labelEvery = cellW < 17 ? 3 : cellW < 30 ? 2 : 1;
  const textFits = showValues && cellW >= 28;
  const up = ci => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from !== null && from !== ci && z) z.selectIndices(zv.lo + Math.min(from, ci), zv.lo + Math.max(from, ci), zv.n);
  };

  return (
    <div ref={ref} className="an-scroll-x" style={{ position: 'relative' }}>
      <div style={{ position: 'relative', width }}>
        <svg width={width} height={height} role="img" aria-label="Heatmap. Use the table view for the numbers." style={{ display: 'block', fontFamily: FONT }} onMouseLeave={() => { setHover(null); dragFrom.current = null; }}>
          {view.map((col, ci) => ci % labelEvery === 0 && (
            <text key={col.c} x={lw + ci * cellW + cellW / 2} y={18} textAnchor="middle" fontSize="11" fill={TEXT.secondary}>{col.c}</text>
          ))}
          {rowLabels.map((r, ri) => (
            <g key={r}>
              <title>{r}</title>
              <text x={lw - 8} y={headerH + ri * cellHeight + cellHeight / 2 + 4} textAnchor="end" fontSize="12" fill={TEXT.primary}>{truncate(r, maxChars)}</text>
              {view.map((col, ci) => {
                const v = values[ri][col.i];
                const on = hover && hover.r === ri && hover.c === ci;
                return (
                  <g key={col.c} style={{ cursor: onSelect && v ? 'pointer' : 'default' }}
                    onMouseEnter={() => setHover({ r: ri, c: ci })} onMouseDown={() => { dragFrom.current = ci; }} onMouseUp={() => up(ci)}
                    onClick={() => onSelect && v && onSelect(ri, col.i)}>
                    <rect x={lw + ci * cellW + 1} y={headerH + ri * cellHeight + 1} width={Math.max(1, cellW - 2)} height={cellHeight - 2} rx="3"
                      fill={rampColor(v, max)} stroke={on ? '#14172e' : 'none'} strokeWidth="1.5" />
                    {textFits && v ? <text x={lw + ci * cellW + cellW / 2} y={headerH + ri * cellHeight + cellHeight / 2 + 4} textAnchor="middle" fontSize="11" fontWeight="600"
                      fill={(v / max) > 0.45 ? '#ffffff' : '#14172e'} style={{ pointerEvents: 'none' }}>{format(v)}</text> : null}
                  </g>
                );
              })}
            </g>
          ))}
          <g transform={`translate(${lw}, ${headerH + bodyH + 12})`}>
            <text x={0} y={9} fontSize="11" fill={TEXT.secondary}>{legendLabel}</text>
            {RAMP.map((c, i) => <rect key={c} x={44 + i * 18} y={0} width={16} height={12} rx="2" fill={c} />)}
            <text x={44 + RAMP.length * 18 + 4} y={9} fontSize="11" fill={TEXT.secondary}>More (up to {format(max)})</text>
          </g>
        </svg>
        {hover && values[hover.r][view[hover.c]?.i] ? (
          <div className="chart-tip an-tip" data-no-export style={{ position: 'absolute', left: Math.max(70, Math.min(lw + hover.c * cellW + cellW / 2, width - 90)), top: headerH + hover.r * cellHeight - 6, transform: 'translate(-50%, -100%)', pointerEvents: 'none', zIndex: 3 }}>
            <div className="chart-tip-title">{rowLabels[hover.r]} · {view[hover.c].c}</div>
            {String(tip ? tip(values[hover.r][view[hover.c].i], hover.r, view[hover.c].i) : format(values[hover.r][view[hover.c].i])).split(' · ').map((p, n) => <div key={n} className="chart-tip-line flush"><b>{p}</b></div>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Volume against speed: one dot per technician ───────────────────────────────────────────────────────────────────────────────
// Dashed lines mark the team (typical volume across, team median up) so the four corners mean something. Zoom narrows the x range.
export function ScatterPlot({ points, height = 320, xLabel, yLabel, onSelect, xRef, yRef, yFormat = v => `${+v.toFixed(1)}d` }) {
  const h = useChartHeight(height);
  const z = useZoom();
  const xmax = Math.max(...points.map(p => p.x), 1);
  const fullMax = niceTicks(xmax * 1.04, 5, true).max;
  const [from, to] = z ? z.range : [0, 1];
  const domain = [from * fullMax, to * fullMax];
  const visible = useMemo(() => points.filter(p => p.x >= domain[0] && p.x <= domain[1]), [points, domain[0], domain[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  // One very slow technician would squash everyone else against the floor, so the vertical axis stops a little above the typical
  // spread; anything beyond is drawn on the top edge with an arrow and keeps its real value in the tooltip.
  const sortedY = useMemo(() => visible.map(p => p.y).sort((a, b) => a - b), [visible]);
  const q = sortedY.length ? sortedY[Math.min(sortedY.length - 1, Math.floor(sortedY.length * 0.85))] : 1;
  const real = Math.max(...sortedY, yRef?.value || 0, 0.1);
  const cap = Math.min(real, Math.max(q * 1.6, (yRef?.value || 0) * 2.5, 0.5));
  const yAxis = niceTicks(cap * 1.05, 4);
  const shown = useMemo(() => visible.map(p => (p.y > yAxis.max ? { ...p, plotY: yAxis.max, clipped: true } : { ...p, plotY: p.y })), [visible, yAxis.max]);
  const register = z?.register;
  useEffect(() => { register?.(Math.max(points.length, MIN_VISIBLE + 1) * 3, `${fmtInt(Math.round(domain[0]))} to ${fmtInt(Math.round(domain[1]))} ${xLabel}`, 0, 0, false); }, [register, points.length, domain[0], domain[1], xLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  const labelled = useMemo(() => {
    if (points.length <= 10) return new Set(points.map(p => p.name));
    const set = new Set();
    [...points].sort((a, b) => b.x - a.x).slice(0, 3).forEach(p => set.add(p.name));
    [...points].sort((a, b) => a.y - b.y).slice(0, 2).forEach(p => set.add(p.name));
    [...points].sort((a, b) => b.y - a.y).slice(0, 2).forEach(p => set.add(p.name));
    return set;
  }, [points]);

  return (
    <Sized height={h}>{w => {
      const placed = [];
      return (
        <ScatterChart width={w} height={h} style={noSelect} margin={{ top: 16, right: 24, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis type="number" dataKey="x" name={xLabel} {...axisProps} domain={domain} allowDataOverflow ticks={rangeTicks(domain[0], domain[1], w < 480 ? 4 : 6)} tickFormatter={compact} height={44}
            label={{ value: xLabel, position: 'insideBottom', offset: 0, style: { ...tick, textAnchor: 'middle' } }} />
          <YAxis type="number" dataKey="plotY" name={yLabel} {...axisProps} axisLine={false} domain={[0, yAxis.max]} ticks={yAxis.ticks} interval={0} tickFormatter={yFormat} width={52}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', style: { ...tick, textAnchor: 'middle' }, offset: 4 }} />
          <ZAxis range={[80, 80]} />
          {xRef && xRef.value >= domain[0] && xRef.value <= domain[1] && (
            <ReferenceLine x={xRef.value} stroke={TEXT.muted} strokeDasharray="4 4" label={{ value: xRef.label, position: 'insideTopRight', fontSize: 11, fill: TEXT.secondary, fontFamily: FONT }} />
          )}
          {yRef && yRef.value <= yAxis.max && <ReferenceLine y={yRef.value} stroke={TEXT.muted} strokeDasharray="4 4" label={{ value: yRef.label, position: 'insideTopLeft', fontSize: 11, fill: TEXT.secondary, fontFamily: FONT }} />}
          <Tooltip {...tooltipProps} cursor={{ strokeDasharray: '3 3' }} content={<ChartTooltip title={() => ''} rows={payload => {
            const p = payload[0].payload;
            return [{ name: p.name, value: '', color: SERIES[0] }, { name: xLabel, value: p.xText ?? p.x }, { name: yLabel, value: p.yText ?? p.y }];
          }} />} />
          <Scatter data={shown} fill={SERIES[0]} fillOpacity={0.85} stroke="#fff" strokeWidth={1.5} isAnimationActive={false} cursor={onSelect ? 'pointer' : 'default'}
            onClick={onSelect ? (d => onSelect(d.payload || d)) : undefined}>
            <LabelList dataKey="name" content={({ x, y, value }) => {
              const p = shown.find(r => r.name === value);
              if (!p || !(labelled.has(value) || p.clipped)) return null;
              const text = `${p.clipped ? '↑ ' : ''}${truncate(value, 16)}`;
              const wText = text.length * 6;
              // A dot near an edge gets its name beside it (not centred over it) so the name is never cut off or drawn over the axis.
              const anchor = x - wText / 2 < 62 ? 'start' : x + wText / 2 > w - 12 ? 'end' : 'middle';
              const cx = anchor === 'start' ? x + 8 + wText / 2 : anchor === 'end' ? x - 8 - wText / 2 : x;
              if (placed.some(o => Math.abs(o.x - cx) < (o.w + wText) / 2 + 4 && Math.abs(o.y - y) < 14)) return null;
              placed.push({ x: cx, y, w: wText });
              const tx = anchor === 'start' ? x + 8 : anchor === 'end' ? x - 8 : x;
              return <text x={tx} y={anchor === 'middle' ? y - 10 : y + 4} textAnchor={anchor} fontSize={11} fill={TEXT.secondary} fontFamily={FONT} style={{ pointerEvents: 'none' }}>{text}</text>;
            }} />
          </Scatter>
        </ScatterChart>
      );
    }}</Sized>
  );
}

// ── Technician against the team ────────────────────────────────────────────────────────────────────────────────────────────────
// rows = [{ label, score, text, mine, team, note }]. score is % better (+, to the right, blue) or worse (-, to the left, orange) than
// the team, already flipped so that "better" is always to the right whether lower or higher is good for that measure.
export function DivergingBars({ rows, rowHeight = 30, onSelect }) {
  const zv = useZoomView(rows, { label: r => r.label });
  const [mark, recent] = useDragGuard();
  const shown = zv.view;
  const height = useChartHeight(Math.max(150, rows.length * rowHeight + 56));
  const handlers = withDragMark(zv.handlers, mark);
  return (
    <Sized height={height}>{w => {
      const lw = Math.round(Math.max(96, Math.min(170, w * 0.34)));
      const maxChars = Math.floor((lw - 6) / 6.6);
      return (
        <BarChart width={w} height={height} data={shown} layout="vertical" style={noSelect} margin={{ top: 4, right: 14, left: 4, bottom: 4 }} barCategoryGap="28%" {...handlers}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" domain={[-130, 130]} ticks={[-100, -50, 0, 50, 100]} tickFormatter={v => `${Math.abs(v)}%`} {...axisProps} height={42}
            label={{ value: w < 420 ? '← worse     better →' : '← worse than the team          better than the team →', position: 'insideBottom', offset: 0, style: { ...tick, textAnchor: 'middle', fontSize: 11 } }} />
          <YAxis type="category" dataKey="label" width={lw} tickLine={false} axisLine={false} interval={0} tick={p => <HLabel {...p} maxChars={maxChars} />} />
          <ReferenceLine x={0} stroke={TEXT.muted} />
          <Tooltip {...tooltipProps} cursor={CURSOR_BAND} content={<ChartTooltip title={(l, row) => row?.label}
            rows={payload => [{ name: 'This technician', value: payload[0].payload.mine }, { name: 'Team', value: payload[0].payload.team }]}
            note={row => row?.note} />} />
          <Bar dataKey="plot" maxBarSize={20} radius={3} isAnimationActive={false} cursor={onSelect ? 'pointer' : 'default'}
            onClick={onSelect ? (d => { if (!recent()) onSelect(d.payload || d); }) : undefined}>
            {shown.map((r, i) => <Cell key={i} fill={Math.abs(r.score) < 2 ? TEAM : r.score >= 0 ? SERIES[0] : SERIES[1]} />)}
            <LabelList dataKey={r => r} content={({ x, y, width, height: bh, value: row }) => {
              const positive = row.score >= 0;
              const left = Math.min(x, x + width);
              const right = Math.max(x, x + width);
              return <text x={positive ? right + 5 : left - 5} y={y + bh / 2 + 4} textAnchor={positive ? 'start' : 'end'} fontSize={11.5} fontWeight={600} fill={TEXT.primary} fontFamily={FONT}>{row.text}</text>;
            }} />
          </Bar>
          {selectionArea(zv, shown, 'label', true)}
        </BarChart>
      );
    }}</Sized>
  );
}
