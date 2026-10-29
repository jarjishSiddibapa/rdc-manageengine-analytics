import { useCallback, useState } from 'react';
import { Button, Checkbox, Dropdown, Segmented, Tooltip } from 'antd';
import { ColumnHeightOutlined, ControlOutlined } from '@ant-design/icons';
import '../../styles/analytics.css';

// Small preferences (visible columns, row density) remembered in this browser. A private window just forgets them.
export function usePersistedState(key, initial) {
  const [value, setValue] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initial; } catch { return initial; }
  });
  const set = useCallback(next => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* not remembered */ }
  }, [key]);
  return [value, set];
}

// columns = [{ key, label, group?, locked? }]; `visible` = array of keys. The first column is locked on so a row can always be identified.
export function ColumnsMenu({ columns, visible, defaults, onChange }) {
  const groups = [];
  columns.forEach(c => { const g = c.group || 'Columns'; if (!groups.includes(g)) groups.push(g); });
  const toggle = (key, on) => onChange(on ? [...visible, key] : visible.filter(k => k !== key));
  const menu = (
    <div className="an-cols-menu" role="group" aria-label="Choose columns">
      {groups.map(g => (
        <div key={g}>
          <div className="grp">{g}</div>
          {columns.filter(c => (c.group || 'Columns') === g).map(c => (
            <label key={c.key}>
              <Checkbox checked={c.locked || visible.includes(c.key)} disabled={c.locked} onChange={e => toggle(c.key, e.target.checked)} />
              {c.label}
            </label>
          ))}
        </div>
      ))}
      <div className="foot">
        <Button size="small" onClick={() => onChange(defaults)}>Default</Button>
        <Button size="small" onClick={() => onChange(columns.map(c => c.key))}>Show all</Button>
      </div>
    </div>
  );
  return (
    <Dropdown trigger={['click']} placement="bottomRight" popupRender={() => menu}>
      <Button icon={<ControlOutlined />} aria-label="Choose columns">Columns</Button>
    </Dropdown>
  );
}

export function DensityToggle({ value, onChange }) {
  return (
    <Tooltip title="Row density">
      <Segmented
        size="small" value={value} onChange={onChange} aria-label="Row density"
        options={[{ value: 'middle', label: 'Roomy', icon: <ColumnHeightOutlined /> }, { value: 'small', label: 'Compact' }]}
      />
    </Tooltip>
  );
}
