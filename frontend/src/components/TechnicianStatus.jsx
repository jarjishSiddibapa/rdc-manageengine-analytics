import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Alert, Button, Grid, Input, Modal, Segmented, Switch, Table, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { technicianAPI } from '../services/api';
import { useFilters } from '../context/Filters';
import { fmtInt } from './analytics/fmt';
import { compareNullable } from '../utils/duration';

const SHOWN = [{ value: 'all', label: 'Everyone' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }];

// Choose who counts as active, one at a time or many at once. Nothing is saved until "Save changes".
export default function TechnicianStatus({ open, onClose }) {
  const { bumpData } = useFilters();
  const wide = Grid.useBreakpoint().md;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // Only the differences from what is saved: name -> wanted state.
  const [draft, setDraft] = useState({});
  const [selected, setSelected] = useState([]);
  const [typed, setTyped] = useState('');
  const [shown, setShown] = useState('all');

  const load = useCallback(async () => {
    setError(null);
    try { setData((await technicianAPI.list()).data); } catch (e) { setError(e.message || 'The technicians could not be loaded'); }
  }, []);
  useEffect(() => {
    if (!open) return;
    setData(null); setDraft({}); setSelected([]); setTyped(''); setShown('all');
    load();
  }, [open, load]);

  const people = useMemo(() => (data?.technicians || []).map(t => ({ ...t, wanted: draft[t.name] ?? t.active })), [data, draft]);
  const rows = useMemo(() => {
    const query = typed.trim().toLowerCase();
    return people.filter(t => (shown === 'all' || t.wanted === (shown === 'active'))
      && (!query || `${t.name} ${t.email || ''}`.toLowerCase().includes(query)));
  }, [people, typed, shown]);

  const mark = useCallback((names, wanted) => setDraft(previous => {
    const next = { ...previous };
    const saved = new Map((data?.technicians || []).map(t => [t.name, t.active]));
    for (const name of names) { if (saved.get(name) === wanted) delete next[name]; else next[name] = wanted; }
    return next;
  }), [data]);

  const changes = Object.keys(draft).length;
  const activeCount = people.filter(t => t.wanted).length;
  // Only what can still be seen is acted on: a search or the Active / Inactive view must not change hidden rows by surprise.
  const chosen = useMemo(() => { const visible = new Set(rows.map(r => r.name)); return selected.filter(n => visible.has(n)); }, [rows, selected]);

  async function save() {
    setSaving(true);
    try {
      await technicianAPI.setStatus({
        active: Object.keys(draft).filter(n => draft[n]),
        inactive: Object.keys(draft).filter(n => !draft[n]),
      });
      message.success(`Saved: ${activeCount} active, ${people.length - activeCount} inactive`);
      bumpData();
      onClose();
    } catch (e) { message.error(e.message || 'The changes could not be saved'); } finally { setSaving(false); }
  }

  const count = (key, title, extra = {}) => ({ title, dataIndex: key, width: 88, align: 'right', sorter: (a, b) => compareNullable(a[key], b[key]), render: fmtInt, ...extra });
  const columns = [
    { title: 'Technician', dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name), defaultSortOrder: 'ascend',
      render: (name, row) => <><b>{name}</b>{row.email && <div className="tech-status-email">{row.email}</div>}</> },
    { title: 'Active', dataIndex: 'wanted', width: 80, sorter: (a, b) => Number(a.wanted) - Number(b.wanted),
      render: (wanted, row) => <Switch checked={wanted} onChange={value => mark([row.name], value)} aria-label={`${row.name} is active`} /> },
    count('open', 'Open now', { responsive: ['sm'] }),
    count('closed_recent', `Closed, ${data?.recent_days ?? 30} days`, { width: 112, responsive: ['md'] }),
    count('closed', 'Closed, ever', { width: 100, responsive: ['md'] }),
    { title: 'Last SR activity', dataIndex: 'last_activity', width: 124, responsive: ['sm'], sorter: (a, b) => String(a.last_activity || '').localeCompare(String(b.last_activity || '')),
      render: value => (value ? dayjs(value).format('DD-MMM-YYYY') : '-') },
  ];

  return (
    <Modal
      open={open} onCancel={onClose} title="Active and inactive technicians" width={860} style={{ top: wide ? 24 : 8 }} destroyOnHidden
      mask={{ closable: !changes }} okText={changes ? `Save changes (${changes})` : 'Save changes'} onOk={save} confirmLoading={saving} okButtonProps={{ disabled: !changes }}
    >
      <p className="tech-status-intro">
        Switch off anyone who should no longer be counted. With <b>Active only</b> chosen above the filters, their SRs are left out of dashboards, lists and Excel files.
        Nothing is deleted, nothing changes in ManageEngine, and you can switch them back at any time.
      </p>
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} action={<Button size="small" onClick={load}>Retry</Button>} />}
      <div className="tech-status-tools">
        <Input allowClear prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />} placeholder="Find a technician" value={typed} onChange={e => setTyped(e.target.value)} aria-label="Find a technician" />
        <Segmented options={SHOWN} value={shown} onChange={setShown} aria-label="Show" />
        <span className="tech-status-count" role="status">{data ? `${activeCount} of ${people.length} active` : ''}</span>
      </div>
      <div className="tech-status-tools">
        <Button size="small" disabled={!chosen.length} onClick={() => mark(chosen, true)}>Mark active</Button>
        <Button size="small" disabled={!chosen.length} onClick={() => mark(chosen, false)}>Mark inactive</Button>
        <span className="tech-status-count">{chosen.length ? `${chosen.length} selected` : 'Tick rows to change many at once'}</span>
      </div>
      <Table
        rowKey="name" size="small" columns={columns} dataSource={rows} loading={!data && !error} scroll={{ y: `max(160px, calc(100dvh - ${wide ? 360 : 570}px))` }} pagination={false}
        rowSelection={{ selectedRowKeys: chosen, onChange: setSelected, columnWidth: 40 }}
        locale={{ emptyText: data ? 'No technicians match' : ' ' }}
      />
    </Modal>
  );
}
