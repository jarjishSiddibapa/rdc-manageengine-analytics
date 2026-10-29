import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Grid, Input, Table, Tag, Tooltip, Typography, message } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { reportAPI } from '../services/api';
import { useFilters } from '../context/Filters';
import { useUi } from '../utils/ui';
import { useSRViewer } from '../context/SRViewer';
import { ANT_STATUS_TAG } from '../theme';
import { formatDuration } from '../utils/duration';
import { cancellable, isAbort } from './analytics/http';
import { useDebounced, useUrlState } from './analytics/hooks';
import { ColumnsMenu, DensityToggle, usePersistedState } from './analytics/TableTools';
import { dateTime, fmtInt } from './analytics/fmt';
import '../styles/analytics.css';

const { Text } = Typography;
const dash = <Text type="secondary">-</Text>;
const SORT_FIELDS = new Set(['sr_number', 'technician', 'category', 'priority', 'status', 'raised_at', 'start_at', 'closed_at', 'tat_minutes', 'age_minutes', 'due_by',
  'reassignments', 'reopens', 'first_response_minutes', 'idle_minutes', 'worklog_minutes', 'active_minutes', 'tech_replies']);
const DEFAULT_SORT = { field: 'start_at', order: 'desc' };
const SIZES = ['10', '25', '50', '100'];
const mins = v => (v === null || v === undefined ? dash : formatDuration(v));

// The SRs behind a number. Paging, sorting and searching all happen on the server, so it stays quick with every SR in the company.
//  params     the filters (plus any drill-down)
//  title      names the Excel file
//  urlState   keep page / page size / sort / search in the address bar (use on a page of its own, not in a drawer)
//  id         remembers this table's columns separately from other tables
function RecordsTable({ params, title = 'SR list', showTechnician = true, pageSize: pageSizeProp, searchable = true, header, urlState = false, id = 'records' }) {
  const { basis, dataVersion, meta } = useFilters();
  const pageSize = pageSizeProp ?? useUi().default_page_size;
  const hasDue = !!meta?.facets?.has_due_times;
  const openSR = useSRViewer();
  const screens = Grid.useBreakpoint();
  const compactScreen = !screens.md;
  const [sp, patch] = useUrlState();
  const [local, setLocal] = useState({ page: 1, size: pageSize, sort: DEFAULT_SORT.field, order: DEFAULT_SORT.order, q: '' });

  // One place for the table's state: in the address bar on a page of its own, in memory inside a drawer.
  const state = urlState
    ? {
      page: Math.max(1, Number(sp.get('page')) || 1),
      size: SIZES.includes(sp.get('size')) ? Number(sp.get('size')) : pageSize,
      sort: SORT_FIELDS.has(sp.get('sort')) ? sp.get('sort') : DEFAULT_SORT.field,
      order: sp.get('order') === 'asc' ? 'asc' : sp.get('order') === 'desc' ? 'desc' : DEFAULT_SORT.order,
      q: sp.get('q') || '',
    }
    : local;
  const { page, size, sort, order, q } = state;
  const update = useCallback(change => {
    if (urlState) {
      patch({
        ...('page' in change ? { page: change.page > 1 ? change.page : null } : {}),
        ...('size' in change ? { size: change.size !== pageSize ? change.size : null } : {}),
        ...('sort' in change ? { sort: change.sort !== DEFAULT_SORT.field || change.order !== DEFAULT_SORT.order ? change.sort : null, order: change.sort !== DEFAULT_SORT.field || change.order !== DEFAULT_SORT.order ? change.order : null } : {}),
        ...('q' in change ? { q: change.q || null } : {}),
      });
    } else setLocal(s => ({ ...s, ...change }));
  }, [urlState, patch, pageSize]);

  // Typing waits a moment before searching; every new search starts again at page 1.
  const [typed, setTyped] = useState(q);
  const debounced = useDebounced(typed.trim(), 350);
  useEffect(() => { if (debounced !== q) update({ q: debounced, page: 1 }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  // A change of filters or drill-down goes back to page 1 (but not on first load, so a shared link keeps its page).
  const paramsKey = JSON.stringify(params);
  const firstKey = useRef(paramsKey);
  useEffect(() => { if (firstKey.current !== paramsKey) { firstKey.current = paramsKey; update({ page: 1 }); } }, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loading: the request for a view that is no longer wanted is cancelled, so a slow answer can never overwrite a newer one.
  const [result, setResult] = useState({ data: null, loading: true, error: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(r => ({ ...r, loading: true, error: null }));
    cancellable.records({ ...JSON.parse(paramsKey), search: q || undefined, page, pageSize: size, sort, order }, controller.signal)
      .then(res => { if (!controller.signal.aborted) setResult({ data: res.data, loading: false, error: null }); })
      .catch(error => { if (!controller.signal.aborted && !isAbort(error)) setResult(r => ({ data: r.data, loading: false, error: error.message || 'Failed to load the SRs' })); });
    return () => controller.abort();
  }, [paramsKey, q, page, size, sort, order, dataVersion, retry]);
  const { data, loading, error } = result;

  const [exporting, setExporting] = useState(false);
  async function exportExcel() {
    setExporting(true);
    try { await reportAPI.records({ ...JSON.parse(paramsKey), search: q || undefined }, title); } catch (e) { message.error(e.message || 'The download failed'); } finally { setExporting(false); }
  }

  const startLabel = basis === 'raised' ? 'Raised' : 'Assigned';
  const defs = useMemo(() => {
    const list = [
      { key: 'sr_number', label: 'SR No', group: 'Request', locked: true, on: true,
        col: { title: 'SR No', dataIndex: 'sr_number', width: 96, fixed: 'left', sorter: true, render: (v, row) => <button type="button" className="an-sr-link" onClick={e => { e.stopPropagation(); openSR(row.id); }}>{v}</button> } },
      { key: 'description', label: 'Subject', group: 'Request', on: true, col: { title: 'Subject', dataIndex: 'description', width: 280, ellipsis: { showTitle: true }, render: v => v || dash } },
      ...(showTechnician ? [{ key: 'technician', label: 'Technician', group: 'Request', on: true, col: { title: 'Technician', dataIndex: 'technician', width: 160, sorter: true, ellipsis: true } }] : []),
      { key: 'status', label: 'Status', group: 'Request', on: true, col: { title: 'Status', dataIndex: 'status', width: 130, sorter: true, render: v => <Tag color={ANT_STATUS_TAG[v]}>{v}</Tag> } },
      { key: 'priority', label: 'Priority', group: 'Request', on: true, col: { title: 'Priority', dataIndex: 'priority', width: 110, ellipsis: true, sorter: true, render: v => v || dash } },
      { key: 'category', label: 'Category', group: 'Request', on: true, col: { title: 'Category', dataIndex: 'category', width: 150, ellipsis: true, sorter: true, render: v => v || dash } },
      { key: 'raised_at', label: 'Raised', group: 'Dates', on: false, col: { title: 'Raised', dataIndex: 'raised_at', width: 160, sorter: true, render: dateTime } },
      { key: 'start_at', label: startLabel, group: 'Dates', on: true,
        col: { title: startLabel, dataIndex: 'start_at', width: 160, sorter: true,
          render: (v, row) => (row.start_fallback && basis !== 'raised'
            ? <Tooltip title="Never assigned (or assigned after it closed), so the raised time is used">{dateTime(v)} <Text type="secondary">*</Text></Tooltip> : dateTime(v)) } },
      { key: 'closed_at', label: 'Closed', group: 'Dates', on: true, col: { title: 'Closed', dataIndex: 'closed_at', width: 160, sorter: true, render: dateTime } },
      { key: 'tat_minutes', label: 'Turnaround', group: 'Time', on: true, col: { title: 'Turnaround', dataIndex: 'tat_minutes', width: 120, sorter: true, render: v => (v === null ? dash : <b>{formatDuration(v)}</b>) } },
      { key: 'age_minutes', label: 'Open for', group: 'Time', on: true, col: { title: 'Open for', dataIndex: 'age_minutes', width: 110, sorter: true, render: mins } },
      ...(hasDue ? [
        { key: 'due_by', label: 'Due by', group: 'Time', on: true,
          col: { title: 'Due by', dataIndex: 'due_by', width: 170, sorter: true, render: (v, row) => (v ? <span style={row.overdue ? { color: '#b02a2a', fontWeight: 600 } : undefined}>{dateTime(v)}{row.overdue ? ' (overdue)' : ''}</span> : dash) } },
        { key: 'sla_met', label: 'On time', group: 'Time', on: true,
          col: { title: 'On time', dataIndex: 'sla_met', width: 90, align: 'center', render: v => (v === null ? dash : v
            ? <Tooltip title="Closed by the ManageEngine due time"><CheckCircleFilled style={{ color: '#0ca30c' }} aria-label="Closed on time" /></Tooltip>
            : <Tooltip title="Closed after the due time"><CloseCircleFilled style={{ color: '#d03b3b' }} aria-label="Closed late" /></Tooltip>) } },
      ] : []),
      { key: 'reassignments', label: 'Reassigned', group: 'Handling', on: true,
        col: { title: 'Reassigned', dataIndex: 'reassignments', width: 106, sorter: true, align: 'center',
          render: (v, row) => (v === null ? dash : v ? <Tooltip title={row.path ? row.path.join(' → ') : ''}><Tag color="orange">{v}×</Tag></Tooltip> : <Text type="secondary">0</Text>) } },
      { key: 'reopens', label: 'Reopened', group: 'Handling', on: true, col: { title: 'Reopened', dataIndex: 'reopens', width: 96, sorter: true, align: 'center', render: v => (v === null ? dash : v ? <Tag color="red">{v}×</Tag> : <Text type="secondary">0</Text>) } },
      { key: 'first_response_minutes', label: 'First reply', group: 'Handling', on: false, col: { title: 'First reply', dataIndex: 'first_response_minutes', width: 108, sorter: true, render: (v, row) => (row.history_ready ? (v === null ? <Text type="secondary">none</Text> : formatDuration(v)) : dash) } },
      { key: 'tech_replies', label: 'Replies (team / requester)', group: 'Handling', on: false, col: { title: 'Replies', dataIndex: 'tech_replies', width: 92, sorter: true, render: (v, row) => (v === null ? dash : `${v} / ${row.requester_replies}`) } },
      { key: 'worklog_minutes', label: 'Work logged', group: 'Handling', on: false, col: { title: 'Work logged', dataIndex: 'worklog_minutes', width: 112, sorter: true, render: v => (v === null ? dash : v ? formatDuration(v) : <Text type="secondary">0</Text>) } },
      { key: 'active_minutes', label: 'Active time', group: 'Handling', on: false, col: { title: 'Active time', dataIndex: 'active_minutes', width: 110, sorter: true, render: mins } },
      { key: 'idle_minutes', label: 'Quiet for', group: 'Handling', on: false, col: { title: 'Quiet for', dataIndex: 'idle_minutes', width: 104, sorter: true, render: mins } },
    ];
    return list;
  }, [openSR, showTechnician, startLabel, basis, hasDue]);

  const defaults = useMemo(() => defs.filter(d => d.on).map(d => d.key), [defs]);
  const [chosen, setChosen] = usePersistedState(`mea.an.cols.${id}`, null);
  const [density, setDensity] = usePersistedState('mea.an.density', 'small');
  const visible = chosen || defaults;
  const columns = useMemo(() => defs.filter(d => d.locked || visible.includes(d.key)).map(d => ({
    ...d.col, sortOrder: sort === d.col.dataIndex ? (order === 'asc' ? 'ascend' : 'descend') : null,
  })), [defs, visible, sort, order]);

  // Sticky header: below the top bar on a page, inside the scrolling body of a drawer.
  const wrapRef = useRef(null);
  const [sticky, setSticky] = useState(true);
  useEffect(() => {
    const drawer = wrapRef.current?.closest('.ant-drawer-body');
    if (drawer) setSticky({ getContainer: () => drawer, offsetHeader: 0 });
    else setSticky({ offsetHeader: document.querySelector('.topbar')?.getBoundingClientRect().height || 0 });
  }, [compactScreen]);

  const onRow = useCallback(row => ({
    className: 'an-row', tabIndex: 0, 'aria-label': `SR ${row.sr_number}: ${row.description || ''}`.trim(),
    onClick: () => { if (!window.getSelection()?.toString()) openSR(row.id); },
    onKeyDown: e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); openSR(row.id); } },
  }), [openSR]);

  const total = data?.total || 0;
  const empty = (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={q ? `No SRs match "${q}"` : 'No SRs match these filters'}>
      {q && <Button size="small" onClick={() => { setTyped(''); update({ q: '', page: 1 }); }}>Clear search</Button>}
    </Empty>
  );

  return (
    <div ref={wrapRef}>
      <div className="an-records-bar">
        {searchable && (
          <Input allowClear prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />} placeholder="Search SR no, subject, requester..." value={typed} aria-label="Search SRs"
            onChange={e => setTyped(e.target.value)} style={{ width: 300, maxWidth: '100%' }} />
        )}
        {header}
        <span className="grow" />
        <ColumnsMenu columns={defs.map(d => ({ key: d.key, label: d.label, group: d.group, locked: d.locked }))} visible={visible} defaults={defaults} onChange={setChosen} />
        <span className="an-hide-sm"><DensityToggle value={density} onChange={setDensity} /></span>
        <Button icon={<DownloadOutlined />} loading={exporting} disabled={!total} onClick={exportExcel} aria-label="Download as Excel">Excel</Button>
      </div>
      {data && (
        <div className="an-records-summary" style={{ marginBottom: 8 }} aria-live="polite">
          <span><b>{fmtInt(data.total)}</b> SRs</span>
          <span>{fmtInt(data.stats.closed)} closed · {fmtInt(data.stats.open)} open</span>
          {data.stats.avg_minutes !== null && <span>avg {formatDuration(data.stats.avg_minutes)} · median {formatDuration(data.stats.median_minutes)}</span>}
        </div>
      )}
      {error && (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} title={error}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={() => setRetry(n => n + 1)}>Retry</Button>} />
      )}
      <Table
        className="an-table" rowKey="id" size={density} bordered columns={columns} dataSource={data?.records || []} loading={loading}
        scroll={{ x: 'max-content' }} sticky={sticky} onRow={onRow}
        onChange={(pagination, _f, sorter, extra) => {
          if (extra?.action === 'sort') {
            const s = Array.isArray(sorter) ? sorter[0] : sorter;
            if (s?.order && SORT_FIELDS.has(s.field)) update({ sort: s.field, order: s.order === 'ascend' ? 'asc' : 'desc', page: 1 });
            else update({ sort: DEFAULT_SORT.field, order: DEFAULT_SORT.order, page: 1 });
          } else update({ page: pagination.current, size: pagination.pageSize });
        }}
        pagination={{
          current: page, pageSize: size, total, showSizeChanger: !compactScreen || total > 10, pageSizeOptions: SIZES, simple: compactScreen, size: 'small',
          showTotal: compactScreen ? undefined : (t, range) => `${range[0]}-${range[1]} of ${fmtInt(t)} SRs`,
        }}
        locale={{ emptyText: loading ? ' ' : empty }}
      />
    </div>
  );
}

export default memo(RecordsTable);
