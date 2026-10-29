import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, message } from 'antd';
import { FileExcelOutlined, ReloadOutlined } from '@ant-design/icons';
import { reportAPI } from '../services/api';
import { BASES, useFilters } from '../context/Filters';
import FilterBar from '../components/FilterBar';
import { DrillHost, useDrill } from '../components/DrillDrawer';
import { Kpi, KpiGrid } from '../components/Kpi';
import HandlingSection from '../components/HandlingSection';
import { ChartCard, Heatmap, HBarChart } from '../components/charts';
import {
  AgingCard, ClosureHeatmapCard, DistributionCard, FlowCard, GroupAvgCard, MonthlyClosedCard, MonthlyTurnaroundCard, SlaCard, StatusCard, TargetsCard,
} from '../components/sections';
import { cancellable } from '../components/analytics/http';
import { useAbortableLoad } from '../components/analytics/hooks';
import { fillMonths, fmtInt } from '../components/analytics/fmt';
import { formatDuration, formatPct } from '../utils/duration';
import { monthLabel, toDays } from '../utils/format';
import { SERIES, SERIES_ONE, STATUS_TEXT } from '../theme';
import { dayWord, timeBasis, useUi } from '../utils/ui';
import { useAgg } from '../utils/agg';
import '../styles/analytics.css';

const EMPTY = [];
const NO_SLA = { met: 0, missed: 0, no_due_date: 0, met_pct: null };
const NO_HEATMAP = { days: [], grid: [], total: 0 };

export default function Dashboard() {
  const { buildParams, basis, dataVersion, meta } = useFilters();
  const [exporting, setExporting] = useState(false);
  const params = buildParams();
  const paramsKey = JSON.stringify(params);
  const { data, loading, error, reload } = useAbortableLoad(signal => cancellable.overview(params, signal), [paramsKey, dataVersion]);
  const hasDue = !!meta?.facets?.has_due_times;
  const ui = useUi();
  const basisText = basis === 'raised' ? 'since the SR was raised' : 'since it was assigned to the technician';

  async function exportReport() {
    setExporting(true);
    try { await reportAPI.dashboard(params); } catch (e) { message.error(e.message || 'The report could not be created'); } finally { setExporting(false); }
  }

  return (
    <>
      <p className="page-intro">
        How long it takes to close ManageEngine SRs, {basisText} until ManageEngine recorded it as completed. {ui.count_weekends ? 'Calendar time: weekends and time' : 'Weekends are not counted; time'}{' '}
        spent waiting on the requester {ui.count_weekends ? 'are' : 'is'} included. Switch the starting point at the top of the page ({BASES.map(b => b.label.toLowerCase()).join(' or ')}).
      </p>
      <FilterBar aggregation extra={(
        <>
          <Button icon={<ReloadOutlined />} onClick={reload} loading={loading} aria-label="Refresh" />
          <Button type="primary" icon={<FileExcelOutlined />} loading={exporting} disabled={!data} onClick={exportReport}>Excel report</Button>
        </>
      )} />
      {error && data && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} action={<Button size="small" onClick={reload}>Retry</Button>} />}
      {loading && data && <div className="an-updating" role="status">Updating...</div>}
      <div className={loading && data ? 'an-refreshing' : undefined}>
        <DrillHost params={params}>
          <DashboardBody data={data} pending={loading && !data} error={!data ? error : null} onRetry={reload} basis={basis} hasDue={hasDue} params={params} />
        </DrillHost>
      </div>
    </>
  );
}

const DashboardBody = memo(function DashboardBody({ data, pending, error, onRetry, basis, hasDue, params }) {
  const navigate = useNavigate();
  const setDrill = useDrill();
  const s = data?.summary;
  const ui = useUi();
  const A = useAgg();
  const MIN_SAMPLE = ui.min_ranked;
  const [t1, t2, t3] = ui.targets_days;
  const basisText = basis === 'raised' ? 'since the SR was raised' : 'since it was assigned to the technician';
  const state = { loading: pending, error, onRetry };
  const goToTechnician = name => navigate(`/technicians/${encodeURIComponent(name)}`);

  const people = useMemo(() => (data?.technicians || EMPTY).filter(t => t.key !== '(Unassigned)'), [data]);
  const byVolume = useMemo(() => [...people].filter(t => t.closed > 0).sort((a, b) => b.closed - a.closed).slice(0, ui.top_n_charts)
    .map(t => ({ name: t.key, label: t.key, value: t.closed, row: t, open: t.open })), [people, ui.top_n_charts]);
  const bySpeed = useMemo(() => [...people].filter(t => t.measured >= MIN_SAMPLE).sort(A.byFigure()).slice(0, ui.top_n_charts)
    .map(t => ({ name: t.key, label: t.key, value: toDays(A.pick(t)), closed: t.closed, row: t })), [people, ui.top_n_charts, MIN_SAMPLE, A]);
  const matrix = data?.technician_months;
  const matrixTable = useMemo(() => (matrix ? {
    columns: ['Technician', ...matrix.months.map(monthLabel), 'Total'],
    rows: matrix.rows.map(r => [r.technician, ...matrix.months.map(m => r.months[m]?.closed ?? 0), r.total]),
  } : null), [matrix]);
  const matrixLabels = useMemo(() => (matrix ? matrix.rows.map(r => r.technician) : EMPTY), [matrix]);
  const matrixCols = useMemo(() => (matrix ? matrix.months.map(monthLabel) : EMPTY), [matrix]);
  const matrixValues = useMemo(() => (matrix ? matrix.rows.map(r => matrix.months.map(m => r.months[m]?.closed ?? 0)) : EMPTY), [matrix]);

  const filled = useMemo(() => fillMonths(data?.trend || EMPTY, key => ({ key, closed: 0, avg_minutes: null, median_minutes: null })).slice(-12), [data?.trend]);
  const closedSpark = useMemo(() => filled.map(r => r.closed), [filled]);
  const avgSpark = useMemo(() => filled.map(r => toDays(r.avg_minutes)), [filled]);
  const medianSpark = useMemo(() => filled.map(r => toDays(r.median_minutes)), [filled]);

  const kpi = { loading: pending };
  return (
    <>
      <KpiGrid>
        <Kpi {...kpi} label="SRs assigned" value={fmtInt(s?.assigned ?? 0)} sub={`${fmtInt(s?.closed ?? 0)} closed · ${fmtInt(s?.open ?? 0)} open`} accent={SERIES[0]} spark={closedSpark}
          hint="SRs in scope: those closed within the date range plus every SR still open. Sparkline = SRs closed per month, last 12 months." />
        {(A.avg ? ['avg', 'median'] : ['median', 'avg']).map(prefix => (prefix === 'avg'
          ? <Kpi key="avg" {...kpi} label="Average turnaround" value={formatDuration(s?.avg_minutes)} sub={`${fmtInt(s?.measured ?? 0)} closed SRs measured`} accent={SERIES_ONE} timeBased spark={avgSpark}
            hint={`Mean of (completed - clock start) over the closed SRs, in ${timeBasis(ui)}. A few very slow SRs pull it up, so read it next to the median. Sparkline = monthly average.`} />
          : <Kpi key="median" {...kpi} label="Median turnaround" value={formatDuration(s?.median_minutes)} sub="half close faster than this" accent={SERIES_ONE} timeBased spark={medianSpark}
            hint="The typical SR: half of the closed SRs finished faster, half slower. Not pulled up by a few very slow tickets. Sparkline = monthly median." />))}
        <Kpi {...kpi} label="Slowest tenth" value={formatDuration(s?.p90_minutes)} sub="90% close within this" accent={SERIES_ONE} timeBased
          hint="90th percentile turnaround: 9 in 10 closed SRs finished within this time." />
        {hasDue && (
          <Kpi {...kpi} label="Closed by due time" value={formatPct(s?.sla_met_pct)} sub={s?.sla_measured ? `of ${fmtInt(s.sla_measured)} SRs with a due time` : undefined} accent={SERIES[2]}
            hint="Share of closed SRs (that have a due time) completed on or before the due time ManageEngine set." />
        )}
        <Kpi {...kpi} label={`Closed within ${dayWord(t1)}`} value={formatPct(s?.within_1d_pct)} sub={s?.within_7d_pct == null ? undefined : `${s.within_7d_pct}% within ${dayWord(t3)}`} accent={SERIES[2]} timeBased
          hint={`Share of closed SRs whose turnaround was ${t1 * 24} hours or less.`} />
        <Kpi {...kpi} label={`Closed within ${dayWord(t2)}`} value={formatPct(s?.within_3d_pct)} accent={SERIES[2]} timeBased hint={`Share of closed SRs whose turnaround was ${t2 * 24} hours or less.`} />
        <Kpi {...kpi} label="Open now" value={fmtInt(s?.open ?? 0)} tone={s?.overdue ? 'bad' : undefined} accent={SERIES[1]}
          sub={s?.overdue ? `${fmtInt(s.overdue)} past their due time` : hasDue ? 'none overdue' : `${fmtInt(s?.waiting_on_user ?? 0)} waiting on the requester`}
          hint="SRs not closed right now. Always a live snapshot: the date range and clock do not change it." />
        <Kpi {...kpi} label="Average age of open SRs" value={formatDuration(s?.open_avg_age_minutes)} sub={s?.open_oldest_minutes ? `oldest ${formatDuration(s.open_oldest_minutes)}` : undefined} accent={SERIES[1]} timeBased
          hint="Mean time that the currently open SRs have been open, from the clock start until now." />
      </KpiGrid>

      <div className="an-section-head"><h2>Turnaround</h2><span>How many SRs close and how long they take</span></div>
      <div className="grid g2">
        <MonthlyClosedCard rows={data?.trend || EMPTY} {...state} onSelect={setDrill} />
        <MonthlyTurnaroundCard rows={data?.trend || EMPTY} {...state} basisText={basis === 'raised' ? 'from raised to closed' : 'from assigned to closed'} />
      </div>
      <div className="grid g-wide">
        <FlowCard rows={data?.flow || EMPTY} {...state} onSelect={setDrill} />
        <DistributionCard rows={data?.distribution || EMPTY} {...state} onSelect={setDrill} basisText={basis === 'raised' ? 'from raised' : 'from assigned'} />
      </div>

      <div className="an-section-head"><h2>Technicians</h2><span>Who closes the most and who closes fastest</span></div>
      <div className="grid g2">
        <ChartCard
          title="Most SRs closed" subtitle="Technicians ranked by the number of SRs they closed" {...state} filename="Most_SRs_closed_by_technician"
          info={`Closed SRs per technician (the SR's current owner) within the date range, top ${ui.top_n_charts}.`}
          hint="Click a technician to open their page" empty="No closed SRs for these filters"
          data={{ columns: ['Technician', 'SRs closed', 'Average (days)', 'Median (days)', 'Open now'], rows: byVolume.map(r => [r.name, r.value, toDays(r.row.avg_minutes), toDays(r.row.median_minutes), r.open]) }}
        >
          <HBarChart rows={byVolume} color={SERIES_ONE} format={fmtInt} tip={r => `${fmtInt(r.value)} closed · ${A.both(r.row, formatDuration)}`} onSelect={r => goToTechnician(r.name)} />
        </ChartCard>
        <ChartCard
          title="Fastest technicians" subtitle={`${A.Word} days to close (technicians with at least ${MIN_SAMPLE} closed SRs)`} {...state} filename="Fastest_technicians"
          info={`${A.Word} turnaround of each technician's closed SRs (clock per the switch at the top). Only technicians with ${MIN_SAMPLE}+ measured closures are ranked, so a lucky one-off cannot top the list.`}
          hint="Shorter is faster. Click a technician to open their page" empty={`No technician has ${MIN_SAMPLE} closed SRs yet`}
          data={{ columns: ['Technician', `${A.Word} (days)`, `${A.OtherWord} (days)`, 'SRs closed'], rows: bySpeed.map(r => [r.name, r.value, toDays(A.other(r.row)), r.closed]) }}
        >
          <HBarChart rows={bySpeed} color={SERIES[2]} format={(v, row) => formatDuration(A.pick(row.row))} tip={r => `${A.both(r.row, formatDuration)} · ${fmtInt(r.closed)} closed`} onSelect={r => goToTechnician(r.name)} />
        </ChartCard>
      </div>
      <div className="grid">
        <ChartCard
          title="Technician by month" subtitle={`SRs closed per month by the ${ui.top_n_matrix} busiest technicians`} {...state} filename="Technician_by_month_closed"
          info="Closed SRs per technician per month. The colour scale runs from 0 to the busiest cell; hover a cell for the average and median time."
          hint="Darker = more SRs closed. Click a cell to see them" empty="No closed SRs for these filters" data={matrixTable}
        >
          {matrix && (
            <Heatmap rowLabels={matrixLabels} colLabels={matrixCols} values={matrixValues} labelWidth={170} cellHeight={26}
              tip={(v, r, c) => `${fmtInt(v)} closed · ${A.both(matrix.rows[r].months[matrix.months[c]], formatDuration)}`}
              onSelect={(r, c) => setDrill({ title: `${matrix.rows[r].technician} · closed in ${monthLabel(matrix.months[c])}`, params: { technician: matrix.rows[r].technician }, drill: { dim: 'month', key: matrix.months[c] } })} />
          )}
        </ChartCard>
      </div>

      <HandlingSection handling={data?.handling} {...state} onSelect={setDrill} />

      <div className="an-section-head"><h2>Mix and breakdowns</h2><span>Status, age and where the time goes</span></div>
      <div className="grid g3">
        <StatusCard rows={data?.statuses || EMPTY} {...state} onSelect={setDrill} />
        <AgingCard rows={data?.aging || EMPTY} {...state} onSelect={setDrill} />
        {hasDue
          ? <SlaCard sla={data?.sla || NO_SLA} {...state} onSelect={setDrill} />
          : <TargetsCard summary={s} {...state} />}
      </div>

      <div className="grid g3">
        <GroupAvgCard title="Average days by category" subtitle="The 10 busiest categories" rows={data?.categories || EMPTY} dim="category" {...state} filename="Turnaround_by_category" onSelect={setDrill} />
        <GroupAvgCard title="Average days by priority" subtitle="Every priority" rows={data?.priorities || EMPTY} dim="priority" {...state} filename="Turnaround_by_priority" onSelect={setDrill} />
        <GroupAvgCard title="Average days by group" subtitle="The 10 busiest support groups" rows={data?.groups || EMPTY} dim="group" {...state} filename="Turnaround_by_group" onSelect={setDrill} />
      </div>

      <div className="grid">
        <ClosureHeatmapCard heatmap={data?.closure_heatmap || NO_HEATMAP} {...state} onSelect={setDrill} />
      </div>

      {s?.overdue ? (
        <Alert
          type="warning" showIcon style={{ marginBottom: 16 }}
          title={<span style={{ color: STATUS_TEXT.serious }}><b>{fmtInt(s.overdue)}</b> open SRs are past their due time.</span>}
          action={<Button size="small" onClick={() => setDrill({ title: 'Open SRs past their due time', drill: { overdue: '1' }, params: { ...params } })}>Show them</Button>}
        />
      ) : null}
    </>
  );
});
