import { memo, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { Alert, Button, Select, message } from 'antd';
import { ArrowLeftOutlined, FileExcelOutlined } from '@ant-design/icons';
import { reportAPI } from '../services/api';
import { useFilters } from '../context/Filters';
import FilterBar from '../components/FilterBar';
import { DrillHost, useDrill } from '../components/DrillDrawer';
import RecordsTable from '../components/RecordsTable';
import { Kpi, KpiGrid } from '../components/Kpi';
import HandlingSection from '../components/HandlingSection';
import {
  AgingCard, ClosureHeatmapCard, DistributionCard, FlowCard, GroupAvgCard, MonthlyClosedCard, MonthlyTurnaroundCard, SlaCard, StatusCard, TargetsCard,
} from '../components/sections';
import { TechnicianStory, VersusTeamCard } from '../components/analytics/TechnicianStory';
import { cancellable } from '../components/analytics/http';
import { useAbortableLoad } from '../components/analytics/hooks';
import { fillMonths, fmtInt } from '../components/analytics/fmt';
import { formatDuration, formatPct } from '../utils/duration';
import { compare, toDays } from '../utils/format';
import { SERIES, SERIES_ONE } from '../theme';
import { dayWord, timeBasis, useUi } from '../utils/ui';
import { useAgg } from '../utils/agg';
import '../styles/analytics.css';

const EMPTY = [];
const NO_SLA = { met: 0, missed: 0, no_due_date: 0, met_pct: null };
const NO_HEATMAP = { days: [], grid: [], total: 0 };
const initials = name => String(name).split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
const points = (mine, team, { lowerIsBetter = false } = {}) => {
  if (mine === null || mine === undefined || team === null || team === undefined) return null;
  const diff = Math.round((mine - team) * 10) / 10;
  if (Math.abs(diff) < 0.1) return { text: 'same as team', tone: 'flat' };
  return { text: `${diff > 0 ? '+' : ''}${diff} pts vs team`, tone: (lowerIsBetter ? diff < 0 : diff > 0) ? 'good' : 'bad' };
};

function RankBadge({ label, rank }) {
  return (
    <div className="rank-badge" title={rank ? `Ranked ${rank.rank} of ${rank.of}` : 'Not enough measured closures to rank'}>
      <b>{rank ? `#${rank.rank}` : '-'}</b>
      <span>{label}{rank ? ` of ${rank.of}` : ''}</span>
    </div>
  );
}

export default function TechnicianProfile() {
  const { name: routeName } = useParams();
  const name = decodeURIComponent(routeName);
  const navigate = useNavigate();
  const { buildParams, basis, meta, dataVersion } = useFilters();
  const [exporting, setExporting] = useState(false);
  const params = buildParams(false);
  const paramsKey = JSON.stringify(params);
  const { data: raw, loading, error, reload } = useAbortableLoad(signal => cancellable.technician(name, params, signal), [name, paramsKey, dataVersion]);
  // While another technician's numbers are still loading, show placeholders rather than the previous person's figures.
  const data = raw && raw.technician?.name === name ? raw : null;
  const drillParams = useMemo(() => ({ ...params, technician: name }), [paramsKey, name]); // eslint-disable-line react-hooks/exhaustive-deps
  const goTo = useCallback(n => navigate(`/technicians/${encodeURIComponent(n)}`), [navigate]);

  async function exportReport() {
    setExporting(true);
    try { await reportAPI.technician(name, params); } catch (e) { message.error(e.message || 'The report could not be created'); } finally { setExporting(false); }
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}><Link to="/technicians"><ArrowLeftOutlined /> All technicians</Link></div>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="profile-head">
          <div className="avatar lg" aria-hidden="true">{initials(name)}</div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2>{name}</h2>
            <div className="an-profile-meta">
              {data?.technician.email && <span>{data.technician.email}</span>}
              <span>{data?.technician.first_assigned ? `SRs assigned from ${dayjs(data.technician.first_assigned).format('DD-MMM-YYYY')} to ${dayjs(data.technician.last_assigned).format('DD-MMM-YYYY')}` : loading ? 'Loading...' : ''}</span>
            </div>
          </div>
          <Select
            showSearch style={{ width: 280, maxWidth: '100%' }} value={name} optionFilterProp="label" aria-label="Switch technician"
            options={(meta?.facets?.technicians || []).filter(x => !x.unassigned).map(x => ({ value: x.name, label: x.name }))}
            onChange={goTo}
          />
          <Button type="primary" icon={<FileExcelOutlined />} loading={exporting} disabled={!data} onClick={exportReport}>Excel report</Button>
        </div>
      </section>

      <FilterBar showTechnicians={false} aggregation />
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} action={<Button size="small" onClick={reload}>Retry</Button>} />}
      {loading && data && <div className="an-updating" role="status">Updating...</div>}

      <div className={loading && data ? 'an-refreshing' : undefined}>
        <DrillHost params={drillParams} showTechnician={false} onNavigate={goTo}>
          <ProfileBody name={name} data={data} pending={loading && !data} error={!data ? error : null} onRetry={reload} basis={basis} />
        </DrillHost>

        <section className="card">
          <header className="card-head"><div><h3 className="card-title">Every SR assigned to {name}</h3><div className="card-sub">Open and closed, newest first. Click a row or an SR number for its full detail.</div></div></header>
          <RecordsTable params={drillParams} title={`SRs - ${name}`} showTechnician={false} urlState id="technician" />
        </section>
      </div>
    </>
  );
}

const ProfileBody = memo(function ProfileBody({ name, data, pending, error, onRetry, basis }) {
  const setDrill = useDrill();
  const ui = useUi();
  const A = useAgg();
  const [t1, t2] = ui.targets_days;
  const s = data?.summary;
  const t = data?.team;
  const hasDue = !!data?.has_due_times;
  const basisWord = basis === 'raised' ? 'from raised to closed' : 'from assigned to closed';
  const state = { loading: pending, error, onRetry };
  const kpi = { loading: pending };

  const filled = useMemo(() => fillMonths(data?.trend || EMPTY, key => ({ key, closed: 0, avg_minutes: null, median_minutes: null })).slice(-12), [data?.trend]);
  const closedSpark = useMemo(() => filled.map(r => r.closed), [filled]);
  const avgSpark = useMemo(() => filled.map(r => toDays(r.avg_minutes)), [filled]);
  const medianSpark = useMemo(() => filled.map(r => toDays(r.median_minutes)), [filled]);

  return (
    <>
      <div className="grid g-wide">
        {data ? <TechnicianStory data={data} name={name} /> : <TechnicianStory data={null} name={name} loading={pending} />}
        <section className="card an-card">
          <header className="card-head"><div><h3 className="card-title">{data ? `Rank among ${data.technician_count} technicians` : 'Rank'}</h3><div className="card-sub">Needs {data?.min_sample ?? 5}+ measured closures to be ranked</div></div></header>
          {data ? (
            <div className="an-rank-row">
              <RankBadge label="by volume" rank={data.ranks.closed} />
              <RankBadge label={`by speed (${A.word})`} rank={data.ranks[A.avg ? 'avg' : 'median']} />
              <RankBadge label={data.ranks.target_days ? `≤ ${dayWord(data.ranks.target_days)}` : 'on time'} rank={data.ranks.target} />
            </div>
          ) : <div className="an-skel-line" style={{ height: 56 }} />}
        </section>
      </div>

      <KpiGrid>
        <Kpi {...kpi} label="SRs closed" value={fmtInt(s?.closed ?? 0)} sub={s?.closure_rate_pct == null ? undefined : `${s.closure_rate_pct}% of ${fmtInt(s.assigned)} assigned`} accent={SERIES[0]} spark={closedSpark}
          hint="SRs this technician closed within the date range. Sparkline = SRs closed per month, last 12 months." />
        {(A.avg ? ['avg', 'median'] : ['median', 'avg']).map(prefix => (prefix === 'avg'
          ? <Kpi key="avg" {...kpi} label="Average turnaround" value={formatDuration(s?.avg_minutes)} delta={s && t ? compare(s.avg_minutes, t.avg_minutes, { lowerIsBetter: true }) : null} sub={`team ${formatDuration(t?.avg_minutes)}`} accent={SERIES_ONE} timeBased spark={avgSpark}
            hint={`Mean time from the clock start to completion for their closed SRs, in ${timeBasis(ui)}. The comparison is with the whole team. Sparkline = monthly average, last 12 months.`} />
          : <Kpi key="median" {...kpi} label="Median turnaround" value={formatDuration(s?.median_minutes)} delta={s && t ? compare(s.median_minutes, t.median_minutes, { lowerIsBetter: true }) : null} sub={`team ${formatDuration(t?.median_minutes)}`} accent={SERIES_ONE} timeBased spark={medianSpark}
            hint="The typical SR: half were closed faster, half slower. Sparkline = monthly median, last 12 months." />))}
        <Kpi {...kpi} label="Slowest tenth" value={formatDuration(s?.p90_minutes)} sub={`team ${formatDuration(t?.p90_minutes)}`} accent={SERIES_ONE} timeBased hint="90th percentile: 9 in 10 of their closed SRs finished within this time." />
        {hasDue && <Kpi {...kpi} label="Closed by due time" value={formatPct(s?.sla_met_pct)} delta={s && t ? points(s.sla_met_pct, t.sla_met_pct) : null} sub={`team ${formatPct(t?.sla_met_pct)}`} accent={SERIES[2]}
          hint="Share of closed SRs completed on or before the ManageEngine due time." />}
        <Kpi {...kpi} label={`Closed within ${dayWord(t1)}`} value={formatPct(s?.within_1d_pct)} delta={s && t ? points(s.within_1d_pct, t.within_1d_pct) : null} sub={`team ${formatPct(t?.within_1d_pct)}`} accent={SERIES[2]} timeBased
          hint={`Share of closed SRs with a turnaround of ${t1 * 24} hours or less.`} />
        <Kpi {...kpi} label={`Closed within ${dayWord(t2)}`} value={formatPct(s?.within_3d_pct)} delta={s && t ? points(s.within_3d_pct, t.within_3d_pct) : null} sub={`team ${formatPct(t?.within_3d_pct)}`} accent={SERIES[2]} timeBased
          hint={`Share of closed SRs with a turnaround of ${t2 * 24} hours or less.`} />
        <Kpi {...kpi} label="Open now" value={fmtInt(s?.open ?? 0)} tone={s?.overdue ? 'bad' : undefined} sub={s?.overdue ? `${s.overdue} past their due time` : hasDue ? 'none overdue' : undefined} accent={SERIES[1]}
          hint="SRs currently assigned to them that are not closed. A live snapshot, not affected by the date range." />
        <Kpi {...kpi} label="Oldest open" value={formatDuration(s?.open_oldest_minutes)} sub={s?.waiting_on_user ? `${fmtInt(s.waiting_on_user)} waiting on the requester` : undefined} accent={SERIES[1]} timeBased
          hint="The longest an open SR of theirs has been open, from the clock start until now." />
      </KpiGrid>

      <div className="grid g2">
        <VersusTeamCard data={data} name={name} {...state} />
        <MonthlyTurnaroundCard rows={data?.trend || EMPTY} teamRows={data?.team_trend} {...state} basisText={basisWord} />
      </div>
      <div className="grid g-wide">
        <MonthlyClosedCard rows={data?.trend || EMPTY} {...state} onSelect={setDrill} />
        <DistributionCard rows={data?.distribution || EMPTY} teamRows={data?.team_distribution} {...state} onSelect={setDrill} basisText={basis === 'raised' ? 'from raised' : 'from assigned'} />
      </div>
      <div className="grid">
        <FlowCard rows={data?.flow || EMPTY} {...state} onSelect={setDrill} />
      </div>
      <div className="grid g3">
        <StatusCard rows={data?.statuses || EMPTY} {...state} onSelect={setDrill} />
        <AgingCard rows={data?.aging || EMPTY} {...state} onSelect={setDrill} />
        {hasDue
          ? <SlaCard sla={data?.sla || NO_SLA} {...state} onSelect={setDrill} />
          : <TargetsCard summary={s} teamSummary={t} {...state} />}
      </div>
      <div className="grid g3">
        <GroupAvgCard title="Average days by category" subtitle="Their 10 busiest categories" rows={data?.categories || EMPTY} dim="category" {...state} filename={`${name}_by_category`} onSelect={setDrill} />
        <GroupAvgCard title="Average days by priority" subtitle="Every priority they handle" rows={data?.priorities || EMPTY} dim="priority" {...state} filename={`${name}_by_priority`} onSelect={setDrill} />
        <GroupAvgCard title="Average days by group" subtitle="Support groups they work in" rows={data?.groups || EMPTY} dim="group" {...state} filename={`${name}_by_group`} onSelect={setDrill} />
      </div>
      <div className="grid">
        <ClosureHeatmapCard heatmap={data?.closure_heatmap || NO_HEATMAP} {...state} onSelect={setDrill} />
      </div>

      <HandlingSection handling={data?.handling} teamSummary={data?.team_handling} handovers={data?.handovers} name={name} {...state} onSelect={setDrill} />
    </>
  );
});
