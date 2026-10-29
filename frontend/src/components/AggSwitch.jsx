import { memo } from 'react';
import { Segmented, Tooltip } from 'antd';
import { AGGREGATIONS, useFilters } from '../context/Filters';

// Which figure leads for every time on the screen: the average (default) or the median. The other one always sits beside it
// (cards, tooltips, tables), so nothing is hidden by the choice.
const AggSwitch = memo(function AggSwitch({ agg, setAgg, block = false, className }) {
  return (
    <Tooltip title="Which figure leads for turnaround, first reply and other times. 'Average' adds up every SR and divides (a few very slow SRs pull it up); 'Median' is the typical SR. The other one is always shown next to it.">
      <Segmented block={block} className={className} value={agg} onChange={setAgg} options={AGGREGATIONS.map(a => ({ value: a.value, label: a.label }))} aria-label="Lead with average or median" />
    </Tooltip>
  );
});

export default function AggSwitchConnected(props) {
  const { agg, setAgg } = useFilters();
  return <AggSwitch agg={agg} setAgg={setAgg} {...props} />;
}
