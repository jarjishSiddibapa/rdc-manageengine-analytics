import { memo, useMemo } from 'react';
import { Alert, Button } from 'antd';
import { Link } from 'react-router-dom';
import { Kpi, KpiGrid } from './Kpi';
import { ChartCard, ColumnChart, HBarChart, LineTrend } from './charts';
import { SERIES, SERIES_ONE } from '../theme';
import { formatDuration, formatPct } from '../utils/duration';
import { monthLabel } from '../utils/format';
import { fillMonths, fmtInt } from './analytics/fmt';
import { dayWord, minutesWord, useUi } from '../utils/ui';
import { useAgg } from '../utils/agg';
import '../styles/analytics.css';

// How the SRs were handled, read from ManageEngine's change log of each SR: handovers, reopens, first replies, time on hold,
// open SRs that have gone quiet. `teamSummary` (a technician's page) adds comparisons; `handovers` adds who passed work to whom.
const gap = (mine, team, { lowerIsBetter = true, unit = 'pts' } = {}) => {
  if (mine === null || mine === undefined || team === null || team === undefined) return null;
  const diff = Math.round((mine - team) * 10) / 10;
  if (Math.abs(diff) < 0.1) return { text: 'same as team', tone: 'flat' };
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return { text: `${diff > 0 ? '+' : ''}${diff}${unit ? ` ${unit}` : ''} vs team`, tone: good ? 'good' : 'bad' };
};

const quickList = ui => [
  ['Reassigned SRs', { handling: 'reassigned' }],
  ['Reopened SRs', { handling: 'reopened' }],
  ['No reply yet', { handling: 'noresponse' }],
  [`Open and idle ${ui.stale_days[0]}+ days`, { handling: 'stale7' }],
  ['Spent time on hold', { handling: 'onhold' }],
];
const EMPTY = [];
const bucketTable = (columns, rows) => ({ columns, rows: rows.map(b => [b.label, b.count, b.pct]) });

function HandlingSection({ handling, teamSummary, handovers, loading, error, onRetry, onSelect, name }) {
  const ui = useUi();
  const A = useAgg();
  const [r1, r2] = ui.first_reply_targets_minutes;
  const s = handling?.summary;
  const team = teamSummary;
  const ready = !!s && s.covered > 0;
  const first = name ? name.split(' ')[0] : null;
  const who = first ? `${first}'s` : 'the';

  const reassignments = handling?.reassignments ?? EMPTY;
  const responses = handling?.responses ?? EMPTY;
  const idle = handling?.idle ?? EMPTY;
  const trend = useMemo(() => fillMonths(handling?.trend ?? EMPTY, key => ({
    key, closed: 0, reassigned_pct: null, reopened_pct: null, avg_reassignments: null, avg_first_response_minutes: null, median_first_response_minutes: null,
  })), [handling?.trend]);
  const trendTable = useMemo(() => ({
    columns: ['Month', 'SRs closed', 'Reassigned (%)', 'Reopened (%)', 'Average reassignments', ...(A.avg ? ['Average first reply (min)', 'Median first reply (min)'] : ['Median first reply (min)', 'Average first reply (min)'])],
    rows: trend.map(r => [monthLabel(r.key), r.closed, r.reassigned_pct, r.reopened_pct, r.avg_reassignments, ...(A.avg ? [r.avg_first_response_minutes, r.median_first_response_minutes] : [r.median_first_response_minutes, r.avg_first_response_minutes])]),
  }), [trend, A]);
  const trendSeries = useMemo(() => [
    { key: 'reassigned_pct', label: 'Reassigned', color: SERIES[0], format: v => `${v}%` },
    { key: 'reopened_pct', label: 'Reopened', color: SERIES[1], dashed: true, format: v => `${v}%` },
  ], []);
  const trendLegend = useMemo(() => trendSeries.map(x => ({ label: x.label, color: x.color })), [trendSeries]);
  const cardState = { loading, error, onRetry };

  const reassignSeries = useMemo(() => [{ key: 'count', label: 'SRs', color: SERIES[0], format: (v, row) => `${fmtInt(v)} (${row.pct ?? 0}%)`, labelFormat: v => fmtInt(v) }], []);
  const responseSeries = useMemo(() => [{ key: 'count', label: 'SRs', color: SERIES_ONE, format: (v, row) => `${fmtInt(v)} (${row.pct ?? 0}%)`, labelFormat: v => fmtInt(v) }], []);
  const idleSeries = useMemo(() => [{ key: 'count', label: 'Open SRs', color: SERIES[1], format: (v, row) => `${fmtInt(v)} (${row.pct ?? 0}%)`, labelFormat: v => fmtInt(v) }], []);

  return (
    <section className="an-section">
      <div className="an-section-head"><h2>How SRs are handled</h2><span>From each SR's ManageEngine change log</span></div>
      {!loading && s && s.coverage_pct !== null && s.coverage_pct < 100 && (
        <Alert
          type={s.covered ? 'info' : 'warning'} showIcon style={{ marginBottom: 12 }}
          title={s.covered
            ? `History is collected for ${fmtInt(s.covered)} of ${fmtInt(s.of)} SRs (${s.coverage_pct}%). These figures cover those SRs; the rest fill in as the collection runs.`
            : 'The change history of these SRs has not been collected yet.'}
          description={<>Collection runs automatically in the background after each sync. Progress and a manual start are on the <Link to="/sync">Data & sync</Link> page.</>}
        />
      )}
      {ready && (
        <>
          <KpiGrid>
            <Kpi label="Reassigned" value={formatPct(s.reassigned_pct)} sub={`${fmtInt(s.reassigned)} of ${fmtInt(s.covered)} SRs changed hands`} accent={SERIES[0]}
              delta={team ? gap(s.reassigned_pct, team.reassigned_pct) : null}
              hint="Share of SRs (with collected history) that were handed from one technician to another at least once. Lower is better." />
            <Kpi label="Reassignments per SR" value={s.avg_reassignments ?? '-'} sub={`most on one SR: ${s.max_reassignments}`} accent={SERIES[0]}
              delta={team ? gap(s.avg_reassignments, team.avg_reassignments, { unit: '' }) : null}
              hint="Average number of times an SR was handed to a different technician (SRs never handed over count as 0)." />
            <Kpi label="Reopened" value={formatPct(s.reopened_pct)} sub={`${fmtInt(s.reopened)} closed SRs came back`} accent={SERIES[1]}
              delta={team ? gap(s.reopened_pct, team.reopened_pct) : null}
              hint="Share of closed SRs that were reopened at least once (for example after the requester replied). Lower is better." />
            <Kpi label="First-contact resolution" value={formatPct(s.fcr_pct)} sub={`of ${fmtInt(s.fcr_measured)} closed SRs with the flag`} accent={SERIES[2]}
              delta={team ? gap(s.fcr_pct, team.fcr_pct, { lowerIsBetter: false }) : null}
              hint="Share of closed SRs the technician marked as resolved at first contact when closing. Higher is better." />
            <Kpi label={`${A.Word} time to first reply`} value={formatDuration(A.pick(s, 'first_response'))} accent={SERIES_ONE} timeBased
              sub={`${A.otherWord} ${formatDuration(A.other(s, 'first_response'))} · ${formatPct(s.response_within_1h_pct)} within ${minutesWord(r1)} · ${formatPct(s.response_within_1d_pct)} within ${minutesWord(r2)}`}
              hint={`Wait from the clock start to the first reply to the requester (${A.word}: ${A.meaning}). SRs that never got a reply are not included.`} />
            <Kpi label={`${A.Word} time to assign`} value={formatDuration(A.pick(s, 'time_to_assign'))} sub={`${A.otherWord} ${formatDuration(A.other(s, 'time_to_assign'))}`} accent={SERIES_ONE}
              hint="From the moment the SR was raised to the first time anyone assigned it to a technician. Always measured from raised." />
            <Kpi label="Active time" value={formatDuration(s.avg_active_minutes)} sub={`of ${formatDuration(s.avg_active_tat_minutes)} elapsed, on average`} accent={SERIES[2]} timeBased
              hint="Turnaround minus the time an SR sat on hold or closed-and-awaiting-reopen: the time it was really in the technician's hands." />
            <Kpi label="Work logged" value={formatDuration(s.avg_worklog_minutes)} sub={`per SR with a worklog · ${formatPct(s.worklog_pct)} of SRs have one`} accent={SERIES[3]}
              hint="Average of the work hours technicians logged on the SRs that have a worklog." />
            <Kpi label="Open SRs gone quiet" value={fmtInt(s.stale_7d)} sub={`idle ${ui.stale_days[0]}+ days · ${fmtInt(s.stale_14d)} idle ${ui.stale_days[1]}+ days`} accent={SERIES[1]} tone={s.stale_7d ? 'bad' : undefined}
              hint={`Open SRs with no activity (reply, note, status change) for that long. Quiet time across open SRs: ${A.word} ${formatDuration(A.pick(s, 'idle'))}, ${A.otherWord} ${formatDuration(A.other(s, 'idle'))}.`} />
          </KpiGrid>

          <div className="an-chips">
            <span>Show the SRs:</span>
            {quickList(ui).map(([label, drill]) => (
              <Button key={label} size="small" onClick={() => onSelect?.({ title: label, drill })}>{label}</Button>
            ))}
          </div>
        </>
      )}

      <div className="grid g3">
        <ChartCard
          title="Times reassigned" subtitle="How many times each SR was handed to a different technician" {...cardState} filename="Reassignments_per_SR"
          info="Every SR with collected history placed in a band by how many times it moved from one technician to another."
          hint="Click a bar to see those SRs" empty="No history collected yet" data={bucketTable(['Times reassigned', 'SRs', 'Share (%)'], reassignments)}
        >
          <ColumnChart rows={reassignments} xKey="label" height={250} series={reassignSeries}
            onSelect={row => onSelect?.({ title: row.label, drill: { dim: 'reassignments', key: row.key } })} />
        </ChartCard>
        <ChartCard
          title="Time to first reply" subtitle="How quickly the requester got a first answer" {...cardState} filename="Time_to_first_reply"
          info="From the clock start (assigned or raised, per the switch at the top) to the first reply to the requester. 'No reply' = none yet."
          hint="Click a bar to see those SRs" empty="No history collected yet" data={bucketTable(['First reply within', 'SRs', 'Share (%)'], responses)}
        >
          <ColumnChart rows={responses} xKey="label" height={250} series={responseSeries}
            onSelect={row => onSelect?.({ title: `First reply: ${row.label.toLowerCase()}`, drill: { dim: 'response', key: row.key } })} />
        </ChartCard>
        <ChartCard
          title="Open SRs by quiet time" subtitle={s?.open_covered ? `Time since the last activity on ${fmtInt(s.open_covered)} open SRs` : 'Time since the last activity on open SRs'}
          {...cardState} filename="Open_SRs_by_idle_time" hint="Click a bar to see those SRs" empty="No open SRs with history"
          info="Open SRs grouped by how long ago anything last happened on them (reply, note, status change)."
          data={bucketTable(['No activity for', 'Open SRs', 'Share (%)'], idle)}
        >
          <ColumnChart rows={idle} xKey="label" height={250} series={idleSeries}
            onSelect={row => onSelect?.({ title: `Open, quiet for ${row.label.toLowerCase()}`, drill: { dim: 'idle', key: row.key } })} />
        </ChartCard>
      </div>

      <div className="grid g-wide">
        <ChartCard
          title="Handovers and reopens by month" subtitle={`Share of ${who} SRs closed that month that changed hands or came back`} {...cardState} filename="Handovers_and_reopens_by_month"
          info="For the SRs closed in each month (with collected history): the % that were handed to another technician and the % that were reopened at least once."
          legend={trendLegend} empty="No history collected yet" data={trend.length ? trendTable : null}
        >
          <LineTrend rows={trend} xKey="key" xFormat={monthLabel} yFormat={v => `${v}%`} yLabel="% of SRs closed" series={trendSeries}
            tipNote={row => (row.closed ? `${fmtInt(row.closed)} SRs closed` : 'No SRs closed')} />
        </ChartCard>
        {handovers ? (
          <div className="stack">
            <HandoverCard title="Handed over to" subtitle={`${fmtInt(handovers.handed_away)} SRs ${first || 'they'} worked on that now belong to someone else`} rows={handovers.handed_to} color={SERIES[0]}
              filename="Handed_over_to" empty="Nothing handed over" onSelect={onSelect} state={cardState} />
            <HandoverCard title="Received from" subtitle={`${fmtInt(handovers.received)} SRs that reached ${first || 'them'} from another technician`} rows={handovers.received_from} color={SERIES[2]}
              filename="Received_from" empty="Nothing received by handover" onSelect={onSelect} state={cardState} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function HandoverCard({ title, subtitle, rows, color, filename, empty, onSelect, state }) {
  const bars = useMemo(() => rows.map(r => ({ label: r.key, value: r.count })), [rows]);
  const table = useMemo(() => ({ columns: ['Technician', 'SRs'], rows: rows.map(r => [r.key, r.count]) }), [rows]);
  return (
    <ChartCard title={title} subtitle={subtitle} {...state} filename={filename} empty={empty} hint="Click a name to open their page" data={table}
      info="From the assignment history of each SR: the technician it moved to (or came from) when ownership changed.">
      <HBarChart rows={bars} color={color} rowHeight={26} format={fmtInt} onSelect={r => onSelect?.({ navigate: r.label })} />
    </ChartCard>
  );
}

export default memo(HandlingSection);
