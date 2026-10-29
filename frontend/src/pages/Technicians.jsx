import { memo, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Empty, Grid, Input, Select, Table, Tag, Tooltip, Typography, message } from 'antd';
import { FileExcelOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons';
import { reportAPI } from '../services/api';
import { useFilters } from '../context/Filters';
import FilterBar from '../components/FilterBar';
import { Kpi, KpiGrid } from '../components/Kpi';
import { ChartCard, ScatterPlot } from '../components/charts';
import { cancellable } from '../components/analytics/http';
import { useAbortableLoad, useDebounced } from '../components/analytics/hooks';
import { ColumnsMenu, DensityToggle, usePersistedState } from '../components/analytics/TableTools';
import { fmtInt } from '../components/analytics/fmt';
import { formatDuration, formatPct, compareNullable } from '../utils/duration';
import { toDays } from '../utils/format';
import { SERIES, SERIES_ONE } from '../theme';
import { dayWord, useUi } from '../utils/ui';
import { useAgg } from '../utils/agg';
import '../styles/analytics.css';

const { Text } = Typography;
const EMPTY = [];
const dash = <Text type="secondary">-</Text>;

function BarCell({ minutes, max }) {
  if (minutes === null || minutes === undefined) return dash;
  return <div className="an-barcell"><i style={{ width: `${max ? Math.min(100, (minutes / max) * 100) : 0}%` }} /><span>{formatDuration(minutes)}</span></div>;
}

// Speed against the team: a marker next to the value (not colour alone) when someone is clearly faster or slower than the team figure (average or median, as chosen).
function VsTeam({ value, team, what = 'median' }) {
  const ui = useUi();
  if (value === null || value === undefined || !team) return null;
  const diff = (value - team) / team;
  if (Math.abs(diff) < ui.insight_diff_pct / 100) return null;
  const faster = diff < 0;
  return (
    <Tooltip title={`${Math.abs(Math.round(diff * 100))}% ${faster ? 'faster' : 'slower'} than the team ${what} (${formatDuration(team)})`}>
      <span className={faster ? 'tone-good' : 'tone-bad'} style={{ marginLeft: 6, fontSize: 12 }} aria-label={faster ? 'faster than the team' : 'slower than the team'}>{faster ? '✓' : '⚠'}</span>
    </Tooltip>
  );
}

// Every technician side by side, plus a dropdown to open any one of them.
export default function Technicians() {
  const { buildParams, meta, dataVersion, basis } = useFilters();
  const defaultBasis = meta?.default_basis || 'assigned';
  const ui = useUi();
  const A = useAgg();
  const MIN_SAMPLE = ui.min_ranked;
  const [t1, t2] = ui.targets_days;
  const stale = ui.stale_days[0];
  const hasDue = !!meta?.facets?.has_due_times;
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const params = buildParams(false);
  const paramsKey = JSON.stringify(params);
  const { data, loading, error, reload } = useAbortableLoad(signal => cancellable.overview(params, signal), [paramsKey, dataVersion]);
  const [exporting, setExporting] = useState(false);
  const [typed, setTyped] = useState('');
  const query = useDebounced(typed.trim().toLowerCase(), 250);
  const [density, setDensity] = usePersistedState('mea.an.density', 'small');
  const [chosen, setChosen] = usePersistedState('mea.an.cols.technicians', null);

  const allRows = data?.technicians || EMPTY;
  const rows = useMemo(() => (query ? allRows.filter(t => t.key.toLowerCase().includes(query)) : allRows), [allRows, query]);
  const maxBar = useMemo(() => Math.max(0, ...allRows.map(t => A.pick(t) || 0)), [allRows, A]);
  const teamValue = A.pick(data?.summary);
  const open = useCallback(name => navigate(`/technicians/${encodeURIComponent(name)}`), [navigate]);
  const pending = loading && !data;

  const defs = useMemo(() => {
    const num = (key, title, width, extra = {}) => ({ title, dataIndex: key, width, sorter: (a, b) => compareNullable(a[key], b[key]), ...extra });
    const h = (key, title, width, render) => ({ title, width, sorter: (a, b) => compareNullable(a.handling?.[key], b.handling?.[key]), render: (_, r) => render(r.handling?.[key]) });
    return [
      { key: 'name', label: 'Technician', group: 'Who', locked: true, on: true,
        col: { title: 'Technician', dataIndex: 'key', width: 210, fixed: 'left', sorter: (a, b) => a.key.localeCompare(b.key),
          render: (v, row) => (
            <>
              {v === '(Unassigned)' ? <Text type="secondary">{v}</Text> : <button type="button" className="an-tech-link" onClick={e => { e.stopPropagation(); open(v); }}>{v}</button>}
              {row.measured > 0 && row.measured < MIN_SAMPLE && <Tooltip title={`Only ${row.measured} measured - too few to rank`}><Tag style={{ marginLeft: 6 }}>few SRs</Tag></Tooltip>}
            </>
          ) } },
      { key: 'assigned', label: 'Assigned', group: 'Volume', on: false, col: num('assigned', 'Assigned', 92, { render: fmtInt }) },
      { key: 'closed', label: 'Closed', group: 'Volume', on: true, col: num('closed', 'Closed', 84, { defaultSortOrder: 'descend', render: fmtInt }) },
      { key: 'closure_rate_pct', label: 'Closure rate', group: 'Volume', on: true, col: num('closure_rate_pct', 'Closure rate', 108, { render: formatPct }) },
      { key: 'open', label: 'Open now', group: 'Volume', on: true, col: num('open', 'Open now', 92, { render: fmtInt }) },
      ...(hasDue ? [{ key: 'overdue', label: 'Overdue', group: 'Volume', on: true, col: num('overdue', 'Overdue', 92, { render: v => (v ? <Text type="danger" strong>{v}</Text> : <Text type="secondary">0</Text>) }) }] : []),
      { key: 'waiting_on_user', label: 'Waiting on requester', group: 'Volume', on: false, col: num('waiting_on_user', 'Waiting on requester', 150, { render: fmtInt }) },
      { key: 'open_oldest_minutes', label: 'Oldest open', group: 'Volume', on: false, col: num('open_oldest_minutes', 'Oldest open', 110, { render: formatDuration }) },
      ...(A.avg ? ['avg', 'median'] : ['median', 'avg']).map(prefix => {
        const first = prefix === (A.avg ? 'avg' : 'median');
        const label = prefix === 'avg' ? 'Average' : 'Median';
        return { key: `${prefix}_minutes`, label, group: 'Speed', on: true, col: num(`${prefix}_minutes`, label, first ? 150 : 110, {
          render: v => (first ? (v === null || v === undefined ? dash : <><BarCell minutes={v} max={maxBar} /><VsTeam value={v} team={teamValue} what={A.word} /></>) : formatDuration(v)) }) };
      }),
      { key: 'p90_minutes', label: '90th percentile', group: 'Speed', on: true, col: num('p90_minutes', '90th pct', 96, { render: formatDuration }) },
      { key: 'min_minutes', label: 'Fastest', group: 'Speed', on: false, col: num('min_minutes', 'Fastest', 90, { render: formatDuration }) },
      { key: 'max_minutes', label: 'Slowest', group: 'Speed', on: false, col: num('max_minutes', 'Slowest', 90, { render: formatDuration }) },
      { key: 'within_3d_pct', label: `Closed within ${dayWord(t2)}`, group: 'Speed', on: true, col: num('within_3d_pct', `≤ ${dayWord(t2)}`, 92, { render: formatPct }) },
      ...(hasDue
        ? [{ key: 'sla_met_pct', label: 'Closed by due time', group: 'Speed', on: true, col: num('sla_met_pct', 'By due time', 104, { render: formatPct }) }]
        : [{ key: 'within_1d_pct', label: `Closed within ${dayWord(t1)}`, group: 'Speed', on: false, col: num('within_1d_pct', `≤ ${dayWord(t1)}`, 92, { render: formatPct }) }]),
      { key: 'reassigned', label: 'Reassigned', group: 'Handling', on: true, col: h('reassigned_pct', 'Reassigned', 100, formatPct) },
      { key: 'reopened', label: 'Reopened', group: 'Handling', on: true, col: h('reopened_pct', 'Reopened', 92, formatPct) },
      { key: 'fcr', label: 'First-contact resolution', group: 'Handling', on: false, col: h('fcr_pct', 'First-contact res.', 130, formatPct) },
      { key: 'first_reply', label: `${A.Word} first reply`, group: 'Handling', on: true, col: h(A.key('first_response'), `${A.Word} first reply`, 130, formatDuration) },
      { key: 'active', label: 'Active time (avg)', group: 'Handling', on: false, col: h('avg_active_minutes', 'Active time (avg)', 130, formatDuration) },
      { key: 'idle', label: `Idle ${stale}d+ (open)`, group: 'Handling', on: false, col: h('stale_7d', `Idle ${stale}d+ (open)`, 120, v => v ?? '-') },
    ];
  }, [maxBar, hasDue, open, teamValue, MIN_SAMPLE, t1, t2, stale, A]); // eslint-disable-line react-hooks/exhaustive-deps
  const defaults = useMemo(() => defs.filter(d => d.on).map(d => d.key), [defs]);
  const visible = chosen || defaults;
  const columns = useMemo(() => defs.filter(d => d.locked || visible.includes(d.key)).map(d => d.col), [defs, visible]);

  const tableData = useMemo(() => ({
    columns: ['Technician', 'Assigned', 'SRs closed', 'Closure rate (%)', ...(A.avg ? ['Average (days)', 'Median (days)'] : ['Median (days)', 'Average (days)']), '90th percentile (days)', 'Fastest (days)', 'Slowest (days)',
      `Closed within ${dayWord(t2)} (%)`, hasDue ? 'Closed by due time (%)' : `Closed within ${dayWord(t1)} (%)`, 'Open now', 'Overdue', 'Waiting on requester', 'Oldest open (days)',
      'Reassigned (%)', 'Reopened (%)', 'First-contact resolution (%)', `${A.Word} first reply (min)`, 'Active time avg (days)', `Open SRs idle ${stale}+ days`],
    rows: rows.map(t => [t.key, t.assigned, t.closed, t.closure_rate_pct, ...(A.avg ? [toDays(t.avg_minutes), toDays(t.median_minutes)] : [toDays(t.median_minutes), toDays(t.avg_minutes)]), toDays(t.p90_minutes), toDays(t.min_minutes),
      toDays(t.max_minutes), t.within_3d_pct, hasDue ? t.sla_met_pct : t.within_1d_pct, t.open, t.overdue, t.waiting_on_user, toDays(t.open_oldest_minutes),
      t.handling?.reassigned_pct, t.handling?.reopened_pct, t.handling?.fcr_pct, A.pick(t.handling, 'first_response'), toDays(t.handling?.avg_active_minutes), t.handling?.stale_7d]),
  }), [rows, hasDue, t1, t2, stale, A]);

  const points = useMemo(() => allRows.filter(t => t.key !== '(Unassigned)' && t.measured > 0).map(t => ({
    name: t.key, x: t.closed, y: toDays(A.pick(t)), xText: `${fmtInt(t.closed)} closed`, yText: A.both(t, formatDuration),
  })), [allRows, A]);
  const scatterTable = useMemo(() => ({ columns: ['Technician', 'SRs closed', `${A.Word} (days)`], rows: points.map(p => [p.name, p.x, p.y]) }), [points, A]);
  const xRef = useMemo(() => (points.length ? { value: Math.round(points.reduce((s, p) => s + p.x, 0) / points.length), label: 'Average per technician' } : null), [points]);
  const yRef = useMemo(() => (teamValue ? { value: toDays(teamValue), label: `Team ${A.word} ${formatDuration(teamValue)}` } : null), [teamValue, A]);

  const ranked = useMemo(() => allRows.filter(t => t.key !== '(Unassigned)' && t.measured >= MIN_SAMPLE), [allRows]);
  const fastest = useMemo(() => [...ranked].sort(A.byFigure())[0], [ranked, A]);
  const busiest = useMemo(() => [...allRows].filter(t => t.key !== '(Unassigned)').sort((a, b) => b.closed - a.closed)[0], [allRows]);

  async function exportReport() {
    setExporting(true);
    try { await reportAPI.dashboard(params); } catch (e) { message.error(e.message || 'The report could not be created'); } finally { setExporting(false); }
  }

  return (
    <>
      <p className="page-intro">Everyone who has been assigned SRs, side by side. Open any technician for their complete analysis: trends, workload, comparison with the team and every SR behind the numbers.</p>
      <div className="filterbar">
        <UserOutlined style={{ color: '#4f46e5' }} />
        <Select
          showSearch placeholder="Choose a technician to open their page..." style={{ width: 360, maxWidth: '100%' }} optionFilterProp="label" aria-label="Open a technician"
          options={(meta?.facets?.technicians || []).filter(t => !t.unassigned).map(t => ({ value: t.name, label: t.name }))}
          onChange={open} value={null}
        />
        <span className="grow" />
        <Button type="primary" icon={<FileExcelOutlined />} loading={exporting} disabled={!data} onClick={exportReport}>Excel report</Button>
      </div>
      <FilterBar showTechnicians={false} aggregation />
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} action={<Button size="small" onClick={reload}>Retry</Button>} />}

      <div className={loading && data ? 'an-refreshing' : undefined}>
        <KpiGrid>
          <Kpi loading={pending} label="Technicians" value={fmtInt(allRows.filter(t => t.key !== '(Unassigned)').length)} sub={`${fmtInt(ranked.length)} with ${MIN_SAMPLE}+ measured closures`} accent={SERIES[0]}
            hint="People with at least one SR in scope for these filters. Only those with enough closed SRs are ranked." />
          <Kpi loading={pending} label={`Team ${A.word} turnaround`} value={formatDuration(teamValue)} sub={`${A.otherWord} ${formatDuration(A.other(data?.summary))}`} accent={SERIES_ONE} timeBased
            hint={`${A.Word} turnaround of all closed SRs in scope: ${A.meaning}. The ${A.otherWord} is shown beneath.`} />
          <Kpi loading={pending} label={`Fastest ${A.word}`} value={fastest ? formatDuration(A.pick(fastest)) : '-'} sub={fastest ? `${fastest.key} · ${A.otherWord} ${formatDuration(A.other(fastest))}` : `needs ${MIN_SAMPLE}+ closed SRs`} accent={SERIES[2]} timeBased
            hint={`Lowest ${A.word} turnaround among technicians with at least ${MIN_SAMPLE} measured closures.`} />
          <Kpi loading={pending} label="Most SRs closed" value={busiest ? fmtInt(busiest.closed) : '-'} sub={busiest?.key} accent={SERIES[0]}
            hint="Highest number of closed SRs for a single technician within the date range." />
        </KpiGrid>

        <div className="grid g-wide">
          <ChartCard
            title="Volume against speed" subtitle={`Each dot is a technician: SRs closed (across) and ${A.word} days to close (up). Bottom-right = busy and quick.`}
            loading={pending} error={!data ? error : null} onRetry={reload} filename="Technicians_volume_vs_speed" empty="No technician has a measured closure yet"
            info={`One dot per technician. Across: SRs closed. Up: ${A.word} turnaround in days (clock per the switch at the top; the other figure is in the tooltip). The dashed lines are the team ${A.word} and the average volume per technician.`}
            hint="Click a dot to open that technician. A dot marked ↑ is beyond the top of the scale: hover for its value" data={points.length ? scatterTable : null}
          >
            <ScatterPlot points={points} xLabel="SRs closed" yLabel={`${A.Word} days to close`} onSelect={p => open(p.name)} xRef={xRef} yRef={yRef} />
          </ChartCard>
          <section className="card">
            <header className="card-head"><div><h3 className="card-title">How to read this</h3><div className="card-sub">Fair comparisons</div></div></header>
            <ul className="insight-list">
              <li><span className="dot info" />Speed is shown as the <b>{A.word}</b>: {A.meaning}. Switch to the <b>{A.otherWord}</b> at the top; both are in every tooltip.</li>
              <li><span className="dot info" />A technician needs at least <b>{MIN_SAMPLE} measured closures</b> to be ranked; fewer is marked <Tag>few SRs</Tag>.</li>
              <li><span className="dot info" />Time is measured per the switch at the top: now <b>{basis === 'assigned' ? 'since the SR was assigned to the technician' : 'since the SR was raised'}</b>{basis === defaultBasis ? ' (the default)' : ''}.</li>
              <li><span className="dot info" />A <b className="tone-good">✓</b> or <b className="tone-bad">⚠</b> next to the {A.word} means {ui.insight_diff_pct}% or more faster or slower than the team {A.word}.</li>
              <li><span className="dot info" />{hasDue ? <><b>By due time</b> is the share closed on or before the due time ManageEngine set.</> : <>ManageEngine sets no due times on this portal, so speed targets are <b>closed within {t1} / {dayWord(t2)}</b>.</>}</li>
            </ul>
          </section>
        </div>

        <ChartCard title="All technicians" subtitle={`${fmtInt(rows.length)}${query ? ` of ${fmtInt(allRows.length)}` : ''} people with SRs for these filters`} image={false} loading={pending} error={!data ? error : null} onRetry={reload}
          filename="Technicians" data={tableData} hint="Click a column to sort. Click a row to open the technician. Use Columns to choose what is shown"
          extra={(
            <>
              <Input allowClear size="small" prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />} placeholder="Find a technician" value={typed} onChange={e => setTyped(e.target.value)} aria-label="Find a technician" style={{ width: screens.sm ? 190 : 140 }} />
              <ColumnsMenu columns={defs.map(d => ({ key: d.key, label: d.label, group: d.group, locked: d.locked }))} visible={visible} defaults={defaults} onChange={setChosen} />
              <DensityToggle value={density} onChange={setDensity} />
            </>
          )}>
          <TechTable columns={columns} rows={rows} density={density} onOpen={open} compactScreen={!screens.md} />
        </ChartCard>
      </div>
    </>
  );
}

const TechTable = memo(function TechTable({ columns, rows, density, onOpen, compactScreen }) {
  const onRow = useCallback(row => (row.key === '(Unassigned)' ? {} : {
    className: 'an-row', tabIndex: 0, 'aria-label': `Open ${row.key}`,
    onClick: () => onOpen(row.key),
    onKeyDown: e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen(row.key); } },
  }), [onOpen]);
  const topbar = typeof document !== 'undefined' ? document.querySelector('.topbar')?.getBoundingClientRect().height || 0 : 0;
  return (
    <Table
      className="an-table" rowKey="key" size={density} bordered columns={columns} dataSource={rows} scroll={{ x: 'max-content' }} sticky={{ offsetHeader: topbar }} onRow={onRow}
      pagination={{ defaultPageSize: 25, showSizeChanger: true, pageSizeOptions: ['10', '25', '50', '100'], simple: compactScreen, size: 'small', showTotal: compactScreen ? undefined : (t, r) => `${r[0]}-${r[1]} of ${t} technicians` }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No technicians match" /> }}
    />
  );
});
