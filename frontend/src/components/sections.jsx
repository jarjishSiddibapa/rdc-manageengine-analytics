import { memo, useMemo } from 'react';
import { ChartCard, ColumnChart, DonutChart, FlowChart, HBarChart, Heatmap, LineTrend } from './charts';
import { SERIES, SERIES_ONE, STATUS, STATUS_COLORS, TEAM } from '../theme';
import { dayAxis, dayLabel, monthLabel, toDays } from '../utils/format';
import { formatDuration } from '../utils/duration';
import { fillMonths, fmtInt } from './analytics/fmt';
import { dayWord, timeBasis, useUi } from '../utils/ui';
import { useAgg } from '../utils/agg';
import './../styles/analytics.css';

// Chart cards used by both the team dashboard and a technician's page. Each one passes the exact numbers it draws to its
// download menu, so the picture, the Excel file and the CSV never disagree. Every card accepts { loading, error, onRetry }.

const EMPTY = [];

export const MonthlyClosedCard = memo(function MonthlyClosedCard({ rows, loading, error, onRetry, onSelect, title = 'SRs closed per month' }) {
  const data = useMemo(() => fillMonths(rows, key => ({ key, closed: 0 })).map(r => ({ key: r.key, closed: r.closed })), [rows]);
  const table = useMemo(() => ({ columns: ['Month', 'SRs closed'], rows: data.map(r => [monthLabel(r.key), r.closed]) }), [data]);
  const series = useMemo(() => [{ key: 'closed', label: 'SRs closed', color: SERIES_ONE, format: v => `${fmtInt(v)} SRs` }], []);
  return (
    <ChartCard
      title={title} subtitle="Count of SRs by the month they were closed" loading={loading} error={error} onRetry={onRetry} filename="SRs_closed_per_month" hint="Click a bar to see those SRs"
      info="Closed SRs counted in the calendar month ManageEngine recorded them as completed. Months with no closures show as empty bars." data={table}
    >
      <ColumnChart rows={data} xKey="key" xFormat={monthLabel} timeAxis series={series} yLabel="SRs closed"
        onSelect={row => onSelect?.({ title: `Closed in ${monthLabel(row.key)}`, drill: { dim: 'month', key: row.key } })} />
    </ChartCard>
  );
});

export const MonthlyTurnaroundCard = memo(function MonthlyTurnaroundCard({ rows, teamRows, loading, error, onRetry, basisText, title = 'Turnaround by month' }) {
  const ui = useUi();
  const A = useAgg();
  const data = useMemo(() => {
    const team = new Map((teamRows || []).map(r => [r.key, r]));
    return fillMonths(rows, key => ({ key, closed: 0, avg_minutes: null, median_minutes: null }))
      .map(r => ({
        key: r.key, closed: r.closed, avg: toDays(r.avg_minutes), median: toDays(r.median_minutes), team: toDays(A.pick(team.get(r.key))),
        avg_minutes: r.avg_minutes, median_minutes: r.median_minutes, team_minutes: A.pick(team.get(r.key)) ?? null,
      }));
  }, [rows, teamRows, A]);
  // The chosen figure is the solid line and comes first; the other one is dashed beside it.
  const series = useMemo(() => {
    const avgLine = { key: 'avg', label: 'Average', color: SERIES[0], format: (v, row) => formatDuration(row.avg_minutes) };
    const medianLine = { key: 'median', label: 'Median', color: SERIES[1], format: (v, row) => formatDuration(row.median_minutes) };
    const lines = A.avg ? [avgLine, { ...medianLine, dashed: true }] : [medianLine, { ...avgLine, dashed: true }];
    return [...lines, ...(teamRows ? [{ key: 'team', label: `Team ${A.word}`, color: TEAM, format: (v, row) => formatDuration(row.team_minutes) }] : [])];
  }, [teamRows, A]);
  const legend = useMemo(() => series.map(s => ({ label: s.label, color: s.color })), [series]);
  const table = useMemo(() => ({
    columns: ['Month', 'SRs closed', ...(A.avg ? ['Average (days)', 'Median (days)'] : ['Median (days)', 'Average (days)']), ...(teamRows ? [`Team ${A.word} (days)`] : [])],
    rows: data.map(r => [monthLabel(r.key), r.closed, ...(A.avg ? [r.avg, r.median] : [r.median, r.avg]), ...(teamRows ? [r.team] : [])]),
  }), [data, teamRows, A]);
  return (
    <ChartCard
      title={title} subtitle={`Days ${basisText || 'to close'}, for SRs closed that month`} loading={loading} error={error} onRetry={onRetry} legend={legend} filename="Turnaround_by_month"
      info={`For the SRs closed in each month: the average (pulled up by a few very slow SRs) and the median (the typical SR) of the time, with the one chosen at the top drawn solid, from the clock start you chose - assigned or raised - to completion. ${ui.count_weekends ? 'Calendar time' : 'Weekends not counted'}.`}
      data={table}
    >
      <LineTrend rows={data} xKey="key" xFormat={monthLabel} series={series} yFormat={dayAxis} yLabel="Days" tipNote={row => (row.closed ? `${fmtInt(row.closed)} SRs closed` : 'No SRs closed')} />
    </ChartCard>
  );
});

export const FlowCard = memo(function FlowCard({ rows, loading, error, onRetry, onSelect }) {
  const table = useMemo(() => ({ columns: ['Week starting', 'SRs started', 'SRs closed', 'Backlog at week end'], rows: rows.map(r => [r.key, r.assigned, r.closed, r.backlog]) }), [rows]);
  const legend = useMemo(() => [{ label: 'SRs started', color: SERIES[0] }, { label: 'SRs closed', color: SERIES[2] }, { label: 'Backlog (open at week end)', color: SERIES[1] }], []);
  return (
    <ChartCard
      title="Weekly flow and backlog" subtitle="SRs started and closed each week (top), and how many were still open at the end of it (bottom)"
      loading={loading} error={error} onRetry={onRetry} filename="Weekly_flow_and_backlog" hint="Click a week to see the SRs that closed in it"
      info="Started = SRs that reached a technician that week (or were raised, with the 'since raised' clock). Closed = SRs completed that week. Backlog = SRs started but not yet closed at the end of the week. Weeks start on Monday." legend={legend} data={table}
    >
      <FlowChart rows={rows} onSelect={row => onSelect?.({ title: `Closed in the week of ${dayLabel(row.key)}`, drill: { dim: 'flow_closed', key: row.key } })} />
    </ChartCard>
  );
});

export const DistributionCard = memo(function DistributionCard({ rows, teamRows, loading, error, onRetry, onSelect, title = 'How long SRs take to close', basisText }) {
  const ui = useUi();
  const data = useMemo(() => rows.map((b, i) => ({ ...b, mine: b.pct ?? 0, team: teamRows?.[i]?.pct ?? 0 })), [rows, teamRows]);
  const series = useMemo(() => (teamRows
    ? [{ key: 'mine', label: 'This technician', color: SERIES_ONE, format: (v, row) => `${v}% (${fmtInt(row.count)} SRs)` }, { key: 'team', label: 'Team', color: TEAM, format: v => `${v}%` }]
    : [{ key: 'mine', label: 'Share of closed SRs', color: SERIES_ONE, format: (v, row) => `${v}% (${fmtInt(row.count)} SRs)`, labelFormat: v => `${v}%` }]), [teamRows]);
  const legend = useMemo(() => (teamRows ? series.map(s => ({ label: s.label, color: s.color })) : []), [series, teamRows]);
  const table = useMemo(() => ({ columns: ['Closed within', 'SRs', 'Share (%)', ...(teamRows ? ['Team share (%)'] : [])], rows: data.map(b => [b.label, b.count, b.pct, ...(teamRows ? [b.team] : [])]) }), [data, teamRows]);
  return (
    <ChartCard
      title={title} subtitle={`Share of closed SRs by time ${basisText || 'to close'}`} loading={loading} error={error} onRetry={onRetry} filename="Time_to_close" hint="Click a bar to see those SRs"
      info={`Every closed SR is placed in one time band by its turnaround (${timeBasis(ui)}, clock per the switch at the top). Each bar is that band's share of all closed SRs, so the bars add up to 100%.`} legend={legend} data={table}
    >
      <ColumnChart rows={data} xKey="label" series={series} yFormat={v => `${v}%`} height={250}
        onSelect={row => onSelect?.({ title: `Took ${row.label.toLowerCase()} to close`, drill: { bucket: row.key } })} />
    </ChartCard>
  );
});

export const AgingCard = memo(function AgingCard({ rows, loading, error, onRetry, onSelect }) {
  const table = useMemo(() => ({ columns: ['Open for', 'SRs', 'Share (%)'], rows: rows.map(b => [b.label, b.count, b.pct]) }), [rows]);
  const series = useMemo(() => [{ key: 'count', label: 'Open SRs', color: SERIES[1], format: (v, row) => `${fmtInt(v)} (${row.pct ?? 0}%)` }], []);
  return (
    <ChartCard
      title="Open SRs by age" subtitle="How long the SRs that are still open have been open" loading={loading} error={error} onRetry={onRetry} filename="Open_SR_ageing"
      info="SRs that are not closed right now, grouped by the time since the clock start (assigned or raised). Not affected by the date range." hint="Click a bar to see those SRs" empty="No open SRs" data={table}
    >
      <ColumnChart rows={rows} xKey="label" height={250} series={series}
        onSelect={row => onSelect?.({ title: `Open for ${row.label.toLowerCase()}`, drill: { aging: row.key } })} />
    </ChartCard>
  );
});

export const StatusCard = memo(function StatusCard({ rows, loading, error, onRetry, onSelect }) {
  const legend = useMemo(() => rows.map(r => ({ label: `${r.key} · ${fmtInt(r.count)}`, color: STATUS_COLORS[r.key] || '#8b90ad' })), [rows]);
  const donut = useMemo(() => rows.map(r => ({ name: r.key, value: r.count })), [rows]);
  const table = useMemo(() => ({ columns: ['Status', 'SRs'], rows: rows.map(r => [r.key, r.count]) }), [rows]);
  return (
    <ChartCard
      title="Status mix" subtitle="Every SR by its current status" loading={loading} error={error} onRetry={onRetry} filename="Status_mix" legend={legend} data={table}
      info="All SRs in scope by the status they have in ManageEngine right now. 'Pending with User' means the technician is waiting for the requester." hint="Click a slice or name to see those SRs"
    >
      <DonutChart rows={donut} colors={r => STATUS_COLORS[r.name] || '#8b90ad'} onSelect={r => onSelect?.({ title: `Status: ${r.name}`, drill: { dim: 'status', key: r.name } })} />
    </ChartCard>
  );
});

// Used when ManageEngine sets no due times: how quickly SRs close against simple targets (1, 3 and 7 days by default; a setting).
export const TargetsCard = memo(function TargetsCard({ summary, teamSummary, loading, error, onRetry }) {
  const ui = useUi();
  const [t1, t2, t3] = ui.targets_days;
  const rows = useMemo(() => [
    { label: `Within ${dayWord(t1)}`, mine: summary?.within_1d_pct ?? 0, team: teamSummary?.within_1d_pct ?? 0 },
    { label: `Within ${dayWord(t2)}`, mine: summary?.within_3d_pct ?? 0, team: teamSummary?.within_3d_pct ?? 0 },
    { label: `Within ${dayWord(t3)}`, mine: summary?.within_7d_pct ?? 0, team: teamSummary?.within_7d_pct ?? 0 },
  ], [summary, teamSummary, t1, t2, t3]);
  const withTeam = !!teamSummary;
  const series = useMemo(() => (withTeam
    ? [{ key: 'mine', label: 'This technician', color: SERIES_ONE, format: v => `${v}%` }, { key: 'team', label: 'Team', color: TEAM, format: v => `${v}%` }]
    : [{ key: 'mine', label: 'Share of closed SRs', color: SERIES_ONE, format: v => `${v}%` }]), [withTeam]);
  const legend = useMemo(() => (withTeam ? series.map(s => ({ label: s.label, color: s.color })) : []), [series, withTeam]);
  const table = useMemo(() => ({ columns: ['Target', 'Share (%)', ...(withTeam ? ['Team share (%)'] : [])], rows: rows.map(r => [r.label, r.mine, ...(withTeam ? [r.team] : [])]) }), [rows, withTeam]);
  return (
    <ChartCard
      title="Closed within target" subtitle={`Share of closed SRs finished within ${t1}, ${t2} and ${dayWord(t3)}`} loading={loading} error={error} onRetry={onRetry} filename="Closed_within_target" legend={legend} data={table}
      info={`Share of closed SRs whose turnaround (clock per the switch at the top) was at most ${t1}, ${t2} or ${dayWord(t3)}. Shown because ManageEngine sets no due times on this portal.`}
    >
      <ColumnChart rows={rows} xKey="label" series={series} yFormat={v => `${v}%`} height={250} valueLabels={!withTeam} />
    </ChartCard>
  );
});

export const SlaCard = memo(function SlaCard({ sla, loading, error, onRetry, onSelect }) {
  const rows = useMemo(() => [
    { name: 'Closed by the due time', value: sla.met, color: STATUS.good, sla: 'met' },
    { name: 'Closed after the due time', value: sla.missed, color: STATUS.critical, sla: 'missed' },
    { name: 'No due time recorded', value: sla.no_due_date, color: '#c3c6dd' },
  ].filter(r => r.value > 0), [sla]);
  const legend = useMemo(() => rows.map(r => ({ label: `${r.name} · ${fmtInt(r.value)}`, color: r.color })), [rows]);
  const table = useMemo(() => ({ columns: ['Outcome', 'SRs'], rows: rows.map(r => [r.name, r.value]) }), [rows]);
  return (
    <ChartCard
      title="Due-time performance" subtitle={sla.met_pct === null ? 'Closed SRs against the ManageEngine due time' : `${sla.met_pct}% of closed SRs with a due time were closed by it`}
      loading={loading} error={error} onRetry={onRetry} filename="Due_time_performance" legend={legend} data={table}
      info="Closed SRs compared with the due time ManageEngine set on each. SRs without a due time are shown separately and are not counted as met or missed." hint="Click a slice to see those SRs"
    >
      <DonutChart rows={rows} colors={r => r.color} onSelect={r => r.sla && onSelect?.({ title: r.name, drill: { sla: r.sla } })} />
    </ChartCard>
  );
});

// Ranked bars of average turnaround per category / priority / group.
export const GroupAvgCard = memo(function GroupAvgCard({ title, subtitle, rows, dim, onSelect, loading, error, onRetry, filename, maxRows = 10 }) {
  const A = useAgg();
  const label = `${A.Word} (days)`;
  const heading = title.replace(/^Average/, A.Word);
  const sorted = useMemo(() => [...rows].filter(r => r.closed > 0).sort((a, b) => b.closed - a.closed).slice(0, maxRows), [rows, maxRows]);
  const data = useMemo(() => sorted.map(r => ({ key: r.key, label: r.key, value: toDays(A.pick(r)) ?? 0, closed: r.closed, open: r.open, row: r })), [sorted, A]);
  const table = useMemo(() => ({
    columns: [title.replace(/^.* by /, '') || 'Group', 'SRs closed', 'Open now', label, `${A.OtherWord} (days)`],
    rows: sorted.map(r => [r.key, r.closed, r.open, toDays(A.pick(r)), toDays(A.other(r))]),
  }), [sorted, title, label, A]);
  return (
    <ChartCard
      title={heading} subtitle={subtitle} loading={loading} error={error} onRetry={onRetry} filename={filename} hint={`Longest bar = slowest by ${A.word}. Click a bar to see those SRs`}
      info={`${A.Word} turnaround in days (clock per the switch at the top) of the closed SRs in each group, for the groups with the most closed SRs. Hover a bar for both figures and the SR count.`} data={table}
    >
      <HBarChart rows={data} labelKey="label" valueKey="value" color={SERIES_ONE} format={(v, row) => formatDuration(A.pick(row.row))}
        tip={row => `${A.both(row.row, formatDuration)} · ${fmtInt(row.closed)} closed`}
        onSelect={row => onSelect?.({ title: `${row.key}`, drill: { dim, key: row.key } })} />
    </ChartCard>
  );
});

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

export const ClosureHeatmapCard = memo(function ClosureHeatmapCard({ heatmap, loading, error, onRetry, onSelect }) {
  const table = useMemo(() => ({ columns: ['Day', ...HOURS.map(h => `${h}:00`)], rows: heatmap.days.map((d, i) => [d, ...heatmap.grid[i]]) }), [heatmap]);
  return (
    <ChartCard
      title="When SRs get closed" subtitle="Closed SRs by weekday and hour of the day (ManageEngine time)" loading={loading} error={error} onRetry={onRetry} filename="Closed_by_weekday_and_hour"
      info="Count of closed SRs for each weekday and hour at which ManageEngine recorded the completion. Darker = more SRs. The colour scale runs from 0 to the busiest cell." hint="Darker = more SRs closed. Click a cell to see them" empty="No closed SRs" data={heatmap.total ? table : null}
    >
      <Heatmap rowLabels={heatmap.days} colLabels={HOURS} values={heatmap.grid} labelWidth={48} cellHeight={28}
        tip={v => `${fmtInt(v)} SR${v === 1 ? '' : 's'} closed`}
        onSelect={(r, c) => onSelect?.({ title: `Closed on ${heatmap.days[r]} around ${HOURS[c]}:00`, drill: { dim: 'weekday_hour', key: `${heatmap.days[r]}|${c}` } })} />
    </ChartCard>
  );
});

export { EMPTY };
