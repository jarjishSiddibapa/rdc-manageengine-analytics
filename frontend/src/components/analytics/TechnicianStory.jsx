import { memo, useMemo } from 'react';
import { CheckCircleFilled, InfoCircleFilled, RiseOutlined, WarningFilled } from '@ant-design/icons';
import { ChartCard, DivergingBars } from '../charts';
import { formatDuration, formatPct } from '../../utils/duration';
import { fmtInt } from './fmt';
import { UI_DEFAULTS, dayWord, useUi } from '../../utils/ui';
import { useAgg } from '../../utils/agg';
import '../../styles/analytics.css';

// A technician measured against the whole team: which measures are strengths, which need attention, and how the last months compare.
// Every measure is turned into "% better or worse than the team", flipped so that better is always the same direction.

const pct = v => formatPct(v);
const min = v => formatDuration(v);

export function compareWithTeam({ s, t, hs, ht, ui = UI_DEFAULTS, avg = true }) {
  if (!s || !t) return [];
  const [t1, t2] = ui.targets_days;
  const averageRow = { key: 'avg', label: 'Average turnaround', mine: s.avg_minutes, team: t.avg_minutes, lower: true, fmt: min, noun: 'average turnaround' };
  const medianRow = { key: 'median', label: 'Median turnaround', mine: s.median_minutes, team: t.median_minutes, lower: true, fmt: min, noun: 'median turnaround' };
  const defs = [
    ...(avg ? [averageRow, medianRow] : [medianRow, averageRow]),
    { key: 'p90', label: 'Slowest tenth', mine: s.p90_minutes, team: t.p90_minutes, lower: true, fmt: min, noun: 'slowest-tenth turnaround' },
    { key: 'd1', label: `Closed within ${dayWord(t1)}`, mine: s.within_1d_pct, team: t.within_1d_pct, lower: false, fmt: pct, noun: `share closed within ${t1 === 1 ? 'a day' : dayWord(t1)}` },
    { key: 'd3', label: `Closed within ${dayWord(t2)}`, mine: s.within_3d_pct, team: t.within_3d_pct, lower: false, fmt: pct, noun: `share closed within ${dayWord(t2)}` },
    { key: 'rate', label: 'Closure rate', mine: s.closure_rate_pct, team: t.closure_rate_pct, lower: false, fmt: pct, noun: 'closure rate' },
    { key: 'reassigned', label: 'Reassigned', mine: hs?.reassigned_pct, team: ht?.reassigned_pct, lower: true, fmt: pct, noun: 'share of SRs reassigned' },
    { key: 'reopened', label: 'Reopened', mine: hs?.reopened_pct, team: ht?.reopened_pct, lower: true, fmt: pct, noun: 'share of SRs reopened' },
    { key: 'fcr', label: 'First-contact resolution', mine: hs?.fcr_pct, team: ht?.fcr_pct, lower: false, fmt: pct, noun: 'first-contact resolution' },
    { key: 'reply', label: `${avg ? 'Average' : 'Median'} first reply`, mine: hs?.[`${avg ? 'avg' : 'median'}_first_response_minutes`], team: ht?.[`${avg ? 'avg' : 'median'}_first_response_minutes`], lower: true, fmt: min, noun: 'first reply time' },
  ];
  return defs
    .filter(d => d.mine !== null && d.mine !== undefined && d.team !== null && d.team !== undefined && d.team > 0)
    .map(d => {
      const diff = (d.mine - d.team) / d.team;
      const score = Math.round(Math.max(-1, Math.min(1, d.lower ? -diff : diff)) * 100);
      const size = Math.abs(Math.round(diff * 100));
      const note = Math.abs(diff) < 0.02 ? 'About the same as the team'
        : d.lower ? `${size}% ${diff < 0 ? 'lower (better)' : 'higher (worse)'} than the team` : `${size}% ${diff > 0 ? 'higher (better)' : 'lower (worse)'} than the team`;
      return { ...d, score, note, text: `${score > 0 ? '+' : ''}${score}%`, mineText: d.fmt(d.mine), teamText: d.fmt(d.team) };
    });
}

function trendStory(trend, A) {
  const usable = (trend || []).filter(r => A.pick(r) !== null && A.pick(r) !== undefined && r.closed >= 5);
  if (usable.length < 4) return null;
  const recent = usable.slice(-3);
  const before = usable.slice(-6, -3);
  if (!before.length) return null;
  const mean = list => list.reduce((s, r) => s + A.pick(r), 0) / list.length;
  const a = mean(recent);
  const b = mean(before);
  const diff = (a - b) / b;
  if (Math.abs(diff) < 0.05) return { tone: 'info', text: `Turnaround has been steady: the ${A.word} over the last ${recent.length} months with activity is about ${formatDuration(a)}.` };
  return {
    tone: diff < 0 ? 'good' : 'warn',
    text: `Turnaround is getting ${diff < 0 ? 'faster' : 'slower'}: the ${A.word} over the last ${recent.length} active months is ${formatDuration(a)}, ${Math.abs(diff) >= 1 ? `${(Math.max(a, b) / Math.min(a, b)).toFixed(1)} times ${diff < 0 ? 'quicker' : 'slower'} than` : `${Math.abs(Math.round(diff * 100))}% ${diff < 0 ? 'down' : 'up'} on`} the ${before.length} before (${formatDuration(b)}).`,
  };
}

const ICON = {
  good: <CheckCircleFilled className="an-good-ico" aria-label="Strength" />,
  warn: <WarningFilled className="an-warn-ico" aria-label="Needs attention" />,
  info: <InfoCircleFilled className="an-info-ico" aria-label="Note" />,
};

export const TechnicianStory = memo(function TechnicianStory({ data, name, loading }) {
  const ui = useUi();
  const A = useAgg();
  const rows = useMemo(() => (data ? compareWithTeam({ s: data.summary, t: data.team, hs: data.handling?.summary, ht: data.team_handling, ui, avg: A.avg }) : []), [data, ui.targets_days.join(), A.avg]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = name.split(' ')[0];
  const strengths = useMemo(() => rows.filter(r => r.score >= ui.insight_diff_pct).sort((a, b) => b.score - a.score).slice(0, ui.top_n_story), [rows, ui.insight_diff_pct, ui.top_n_story]);
  const watch = useMemo(() => rows.filter(r => r.score <= -ui.insight_diff_pct).sort((a, b) => a.score - b.score).slice(0, ui.top_n_story), [rows, ui.insight_diff_pct, ui.top_n_story]);
  const trend = useMemo(() => trendStory(data?.trend, A), [data?.trend, A]);
  const volume = data?.recent && data.recent.prev30 > 0 ? (() => {
    const d = Math.round(((data.recent.last30 - data.recent.prev30) / data.recent.prev30) * 100);
    return { tone: d >= 0 ? 'info' : 'warn', text: `Closed ${fmtInt(data.recent.last30)} SRs in the last ${dayWord(data.recent.days || 30)}, ${Math.abs(d) < 3 ? 'about the same as' : `${Math.abs(d)}% ${d > 0 ? 'more than' : 'fewer than'}`} the ${fmtInt(data.recent.prev30)} in the ${dayWord(data.recent.days || 30)} before.` };
  })() : null;
  const line = r => `${r.label}: ${r.mineText} against ${r.teamText} for the team - ${r.note.toLowerCase()}.`;

  return (
    <section className="card an-card" aria-busy={loading || undefined}>
      <header className="card-head">
        <div>
          <h3 className="card-title">How {first} is doing</h3>
          <div className="card-sub">Measured against the whole team for the same filters and time basis. A difference of {ui.insight_diff_pct}% or more counts as a strength or a point to watch.</div>
        </div>
      </header>
      <div className="an-story">
        <div className="an-story-cols">
          <div>
            <h4><CheckCircleFilled className="an-good-ico" /> Strengths</h4>
            <ul>
              {strengths.length ? strengths.map(r => <li key={r.key}>{ICON.good}<span>{line(r)}</span></li>) : <li className="an-muted">Nothing stands out ahead of the team.</li>}
            </ul>
          </div>
          <div>
            <h4><WarningFilled className="an-warn-ico" /> Points to watch</h4>
            <ul>
              {watch.length ? watch.map(r => <li key={r.key}>{ICON.warn}<span>{line(r)}</span></li>) : <li className="an-muted">Nothing is notably behind the team.</li>}
            </ul>
          </div>
          <div>
            <h4><RiseOutlined className="an-info-ico" /> Direction</h4>
            <ul>
              {[trend, volume].filter(Boolean).map((r, i) => <li key={i}>{ICON[r.tone]}<span>{r.text}</span></li>)}
              {!trend && !volume && <li className="an-muted">Not enough months of activity to show a direction.</li>}
            </ul>
          </div>
        </div>
        {data?.insights?.length > 0 && (
          <div>
            <h4>At a glance</h4>
            <ul>{data.insights.map((i, idx) => <li key={idx}>{ICON[i.tone] || ICON.info}<span>{i.text}</span></li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
});

export const VersusTeamCard = memo(function VersusTeamCard({ data, name, loading, error, onRetry }) {
  const ui = useUi();
  const A = useAgg();
  const rows = useMemo(() => (data ? compareWithTeam({ s: data.summary, t: data.team, hs: data.handling?.summary, ht: data.team_handling, ui, avg: A.avg }) : []), [data, ui.targets_days.join(), A.avg]); // eslint-disable-line react-hooks/exhaustive-deps
  const chartRows = useMemo(() => rows.map(r => ({ label: r.label, score: r.score, plot: r.score === 0 ? 0.8 : r.score, text: r.text, mine: r.mineText, team: r.teamText, note: r.note })), [rows]);
  const legend = useMemo(() => [{ label: 'Better than the team', color: '#2a78d6' }, { label: 'Worse than the team', color: '#eb6834' }, { label: 'About the same', color: '#9aa1c4' }], []);
  const table = useMemo(() => ({ columns: ['Measure', name.split(' ')[0], 'Team', 'Difference (% better +, worse -)'], rows: rows.map(r => [r.label, r.mineText, r.teamText, r.score]) }), [rows, name]);
  return (
    <ChartCard
      title="Against the team" subtitle="Every measure as the % better or worse than the team average - right is always better" loading={loading} error={error} onRetry={onRetry}
      filename={`${name}_vs_team`} legend={legend} data={rows.length ? table : null} empty="Not enough data to compare yet"
      info="Each bar is (technician - team) / team for that measure, capped at 100%. For times and for 'reassigned' / 'reopened' lower is better, for the rest higher is better; the sign is flipped so a bar to the right is always better. Time measures use the clock chosen at the top."
      hint="Hover a bar for the two values"
    >
      <DivergingBars rows={chartRows} />
    </ChartCard>
  );
});
