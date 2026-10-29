import { useState } from 'react';
import dayjs from 'dayjs';
import { Badge, Button, DatePicker, Drawer, Segmented, Select, Tooltip } from 'antd';
import { ClearOutlined, FilterOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { BASES, PRESETS, countActive, useFilters } from '../context/Filters';
import { useIsMobile } from '../hooks/useMedia';
import AggSwitch from './AggSwitch';

const { RangePicker } = DatePicker;
const opts = list => (list || []).map(v => ({ value: v, label: v }));
const HINT = 'Closed SRs are filtered by the day they were closed. SRs that are still open always show their current state.';

// The filters every analytics screen shares. `showTechnicians` is off on a technician's own page.
// On a desktop they sit in one row; on a phone they fold into a "Filters" sheet so the figures stay in view.
export default function FilterBar({ showTechnicians = true, aggregation = false, extra }) {
  const { filters, setFilters, meta, metaError, reloadMeta, reset, basis, setBasis, settling } = useFilters();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const facets = meta?.facets;
  const set = (patch, immediate = false) => setFilters({ ...filters, ...patch }, immediate);
  const active = countActive(filters) - (showTechnicians || !filters.technicians.length ? 0 : 1);
  const dirty = active > 0 || !!filters.range;
  const loadingFacets = !meta && !metaError;
  const multi = { mode: 'multiple', allowClear: true, maxTagCount: 'responsive', showSearch: { optionFilterProp: 'label' }, loading: loadingFacets, notFoundContent: metaError ? 'Could not load options' : undefined };

  const presetChange = preset => set({ preset, range: preset === 'custom' ? filters.range : null }, true);
  const rangePicker = (
    <RangePicker
      format="DD-MMM-YYYY" allowClear value={filters.range} onChange={range => set({ range }, true)} disabledDate={d => d.isAfter(dayjs(), 'day')}
      style={mobile ? { width: '100%' } : undefined} placement={mobile ? 'bottomLeft' : undefined} aria-label="Closed between"
    />
  );

  const selects = (style = {}) => [
    showTechnicians && { key: 'technicians', label: 'Technician', placeholder: 'All technicians', width: [200, 320], options: (facets?.technicians || []).map(t => ({ value: t.name, label: t.name })) },
    { key: 'categories', label: 'Category', placeholder: 'All categories', width: [170, 280], options: opts(facets?.categories) },
    { key: 'priorities', label: 'Priority', placeholder: 'All priorities', width: [150, 240], options: opts(facets?.priorities) },
    { key: 'groups', label: 'Group', placeholder: 'All groups', width: [150, 240], options: opts(facets?.groups) },
    { key: 'requestTypes', label: 'Request type', placeholder: 'All request types', width: [170, 260], options: opts(facets?.request_types) },
    { key: 'statuses', label: 'Status', placeholder: 'Any status', width: [140, 240], options: opts(facets?.statuses) },
  ].filter(Boolean).map(s => (
    <Select
      {...multi} key={s.key} aria-label={s.label} placeholder={s.placeholder} value={filters[s.key]} options={s.options}
      onChange={value => set({ [s.key]: value })}
      style={mobile ? { width: '100%' } : { minWidth: s.width[0], maxWidth: s.width[1], ...style }}
    />
  ));

  const retry = metaError && <Button size="small" type="link" onClick={reloadMeta}>Retry loading options</Button>;

  if (mobile) {
    return (
      <div className="filterbar compact" role="group" aria-label="Filters" aria-busy={settling}>
        <Segmented block className="filter-basis" value={basis} onChange={setBasis} options={BASES.map(b => ({ value: b.value, label: b.label }))} aria-label="Measure time from" />
        {aggregation && <AggSwitch block className="filter-basis" />}
        <div className="filter-row">
          <Select
            aria-label="Period" value={filters.preset} onChange={presetChange} options={PRESETS} style={{ flex: '1 1 120px', minWidth: 0 }}
            popupMatchSelectWidth={false}
          />
          <Badge count={active} size="small" offset={[-4, 4]}>
            <Button icon={<FilterOutlined />} onClick={() => setOpen(true)} aria-haspopup="dialog">Filters</Button>
          </Badge>
          {extra}
        </div>
        {filters.preset === 'custom' && rangePicker}
        <Drawer
          open={open} onClose={() => setOpen(false)} placement="bottom" height="auto" title="Filters"
          styles={{ body: { paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }, wrapper: { maxHeight: '88dvh' } }}
          footer={(
            <div className="filter-sheet-foot">
              <Button icon={<ClearOutlined />} onClick={reset} disabled={!dirty}>Reset</Button>
              <Button type="primary" onClick={() => setOpen(false)}>Show results</Button>
            </div>
          )}
        >
          <div className="filter-sheet">
            <p className="filter-hint"><InfoCircleOutlined /> {HINT}</p>
            {selects()}
            {retry}
          </div>
        </Drawer>
      </div>
    );
  }

  return (
    <div className="filterbar" role="group" aria-label="Filters" aria-busy={settling}>
      <Tooltip title={HINT}><InfoCircleOutlined style={{ color: 'var(--text-3)' }} aria-label={HINT} role="img" /></Tooltip>
      <Segmented options={PRESETS} value={filters.preset} onChange={presetChange} aria-label="Period" />
      {filters.preset === 'custom' && rangePicker}
      {selects()}
      {retry}
      {dirty && <Button icon={<ClearOutlined />} onClick={reset}>Reset{active ? ` (${active})` : ''}</Button>}
      <span className="grow" />
      {extra}
    </div>
  );
}
