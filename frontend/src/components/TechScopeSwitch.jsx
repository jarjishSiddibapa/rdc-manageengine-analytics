import { Segmented, Tooltip } from 'antd';
import { TECH_SCOPES, useFilters } from '../context/Filters';

// Count only active technicians, or everyone. Shown once somebody is marked inactive (until then both choices give the same figures).
export default function TechScopeSwitch({ block = false, className }) {
  const { techScope, setTechScope, meta } = useFilters();
  const inactive = meta?.facets?.inactive_technicians || 0;
  if (!inactive) return null;
  const who = inactive === 1 ? '1 technician' : `${inactive} technicians`;
  return (
    <Tooltip title={`'Active only' leaves out the SRs of the ${who} marked inactive; unassigned SRs stay. A technician you pick by name is shown either way. Mark who is active on the Technicians page.`}>
      <Segmented block={block} className={className} value={techScope} onChange={setTechScope} options={TECH_SCOPES.map(t => ({ value: t.value, label: t.label }))} aria-label="Which technicians to count" />
    </Tooltip>
  );
}
