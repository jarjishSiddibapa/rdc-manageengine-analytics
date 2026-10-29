import { useMemo } from 'react';
import { Segmented, Select } from 'antd';
import { useFilters } from '../context/Filters';
import FilterBar from '../components/FilterBar';
import RecordsTable from '../components/RecordsTable';
import { useUrlState } from '../components/analytics/hooks';
import { useUi } from '../utils/ui';
import '../styles/analytics.css';

const handlingOptions = ui => [
  { value: 'any', label: 'Any handling' }, { value: 'reassigned', label: 'Reassigned' }, { value: 'multi', label: 'Worked on by 2+ technicians' },
  { value: 'reopened', label: 'Reopened' }, { value: 'noresponse', label: 'No reply yet' }, { value: 'stale7', label: `Open, idle ${ui.stale_days[0]}+ days` },
  { value: 'stale14', label: `Open, idle ${ui.stale_days[1]}+ days` }, { value: 'onhold', label: 'Spent time on hold' }, { value: 'fcr', label: 'First-contact resolved' },
  { value: 'nofcr', label: 'Not first-contact resolved' }, { value: 'worklogged', label: 'Has work logged' }, { value: 'nohistory', label: 'History not collected yet' },
];
const STATES = [{ label: 'All', value: 'all' }, { label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }];

// Every SR, open and closed, with the same filters as the dashboards. Sorting, paging and search run on the server, and the page, sort,
// search and the three quick filters below live in the address bar, so a refreshed or shared link opens the same list.
export default function SRs() {
  const { buildParams, meta } = useFilters();
  const HANDLING = handlingOptions(useUi());
  const [sp, patch] = useUrlState();
  const state = ['open', 'closed'].includes(sp.get('state')) ? sp.get('state') : 'all';
  const overdue = sp.get('overdue') === '1';
  const handling = HANDLING.some(h => h.value === sp.get('handling')) ? sp.get('handling') : 'any';
  const filters = buildParams();
  const filtersKey = JSON.stringify(filters);
  const params = useMemo(() => ({
    ...JSON.parse(filtersKey), state: state === 'all' ? undefined : state, overdue: overdue ? '1' : undefined, handling: handling === 'any' ? undefined : handling,
  }), [filtersKey, state, overdue, handling]);

  return (
    <>
      <p className="page-intro">Every SR with its raised, assigned and closed times and the turnaround for the chosen starting point. Click a row or an SR number for its full detail; use Excel to download exactly what is listed.</p>
      <FilterBar />
      <section className="card">
        <RecordsTable
          params={params} title="SR list" urlState id="srs"
          header={(
            <>
              <Segmented value={state} onChange={v => patch({ state: v === 'all' ? null : v, page: null })} options={STATES} aria-label="Open or closed" />
              <Select value={handling} onChange={v => patch({ handling: v === 'any' ? null : v, page: null })} style={{ width: 210 }} popupMatchSelectWidth={false} options={HANDLING} aria-label="Handling filter" />
              {meta?.facets?.has_due_times && (
                <Segmented value={overdue ? 'overdue' : 'any'} onChange={v => patch({ overdue: v === 'overdue' ? '1' : null, page: null })} options={[{ label: 'Any due time', value: 'any' }, { label: 'Overdue only', value: 'overdue' }]} />
              )}
            </>
          )}
        />
      </section>
    </>
  );
}
