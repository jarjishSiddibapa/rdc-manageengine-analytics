import { useState } from 'react';
import dayjs from 'dayjs';
import { Badge, Button, DatePicker, Drawer, Popover, Segmented, Select, Tag, Tooltip } from 'antd';
import { ClearOutlined, ControlOutlined, FilterOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { BASES, FILTER_FIELDS, PRESETS, countActive, filterOptions, useFilters } from '../context/Filters';
import { useIsMobile } from '../hooks/useMedia';
import AggSwitch from './AggSwitch';
import TechScopeSwitch from './TechScopeSwitch';
import { technicianOptions } from '../utils/technicians';

const { RangePicker } = DatePicker;
const HINT = 'Closed SRs are filtered by the day they were closed. SRs that are still open always show their current state.';

// The filters every analytics screen shares. `showTechnicians` is off on a technician's own page.
// On a desktop the main filters sit on the bar and the rest under "More filters"; on a phone they all fold into a sheet.
export default function FilterBar({ showTechnicians = true, aggregation = false, extra }) {
  const { filters, setFilters, meta, metaError, reloadMeta, reset, basis, setBasis, settling } = useFilters();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const facets = meta?.facets;
  const set = (patch, immediate = false) => setFilters({ ...filters, ...patch }, immediate);
  const active = countActive(filters) - (showTechnicians || !filters.technicians.length ? 0 : 1);
  const dirty = active > 0 || !!filters.range;
  const loadingFacets = !meta && !metaError;

  // A filter with nothing to choose between is not offered (unless something is still selected in it).
  const usable = FILTER_FIELDS.filter(f => {
    if (f.field === 'technicians') return showTechnicians;
    return filters[f.field].length > 0 || (facets ? (facets[f.facet || f.field]?.length || 0) > 1 : f.main);
  });
  const main = usable.filter(f => f.main);
  const more = usable.filter(f => !f.main);
  const moreChosen = more.filter(f => filters[f.field].length);

  // Narrowing a filter also drops choices in the filters that depend on it which no longer fit.
  function choose(field, value) {
    const patch = { [field]: value };
    for (const child of FILTER_FIELDS.filter(f => f.parent === field)) {
      if (!value.length || !filters[child.field].length) continue;
      const allowed = new Set(filterOptions(child, facets, { ...filters, ...patch }));
      patch[child.field] = filters[child.field].filter(v => allowed.has(v));
    }
    set(patch);
  }

  const select = (f, labelled) => {
    const control = (
      <Select
        mode="multiple" allowClear maxTagCount="responsive" showSearch={{ optionFilterProp: 'label' }} loading={loadingFacets}
        notFoundContent={metaError ? 'Could not load options' : undefined} popupMatchSelectWidth={false} aria-label={f.label} placeholder={f.all}
        value={filters[f.field]} onChange={value => choose(f.field, value)}
        options={f.field === 'technicians' ? technicianOptions(facets?.technicians) : filterOptions(f, facets, filters).map(v => ({ value: v, label: v }))}
        className={labelled ? undefined : 'filter-select'}
        style={labelled ? { width: '100%' } : undefined}
      />
    );
    return labelled
      ? <div className="filter-field" key={f.field}><span>{f.label}</span>{control}</div>
      : <span className="filter-slot" key={f.field}>{control}</span>;
  };

  const presetChange = preset => set({ preset, range: preset === 'custom' ? filters.range : null }, true);
  const rangePicker = (
    <RangePicker
      format="DD-MMM-YYYY" allowClear value={filters.range} onChange={range => set({ range }, true)} disabledDate={d => d.isAfter(dayjs(), 'day')}
      style={mobile ? { width: '100%' } : undefined} placement={mobile ? 'bottomLeft' : undefined} aria-label="Closed between"
    />
  );
  const retry = metaError && <Button size="small" type="link" onClick={reloadMeta}>Retry loading options</Button>;

  if (mobile) {
    return (
      <div className="filterbar compact" role="group" aria-label="Filters" aria-busy={settling}>
        <Segmented block className="filter-basis" value={basis} onChange={setBasis} options={BASES.map(b => ({ value: b.value, label: b.label }))} aria-label="Measure time from" />
        {aggregation && <AggSwitch block className="filter-basis" />}
        <TechScopeSwitch block className="filter-basis" />
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
            {usable.map(f => select(f, true))}
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
      <TechScopeSwitch />
      <span className="grow" />
      {retry}
      {dirty && <Button icon={<ClearOutlined />} onClick={reset}>Reset{active ? ` (${active})` : ''}</Button>}
      {extra}
      <div className="filter-main">
        {main.map(f => select(f, false))}
        {more.length > 0 && (
          <Popover trigger="click" placement="bottomRight" title="More filters" content={<div className="filter-more">{more.map(f => select(f, true))}</div>}>
            <Button icon={<ControlOutlined />} aria-haspopup="dialog">More filters{moreChosen.length ? ` (${moreChosen.length})` : ''}</Button>
          </Popover>
        )}
      </div>
      {moreChosen.length > 0 && (
        <div className="filter-chips" aria-label="Also filtering by">
          {moreChosen.map(f => (
            <Tag key={f.field} closable onClose={() => choose(f.field, [])}>
              {f.label}: {filters[f.field].length > 2 ? `${filters[f.field].length} chosen` : filters[f.field].join(', ')}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}
