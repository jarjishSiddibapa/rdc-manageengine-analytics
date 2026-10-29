import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { Alert, Button, Descriptions, Grid, Modal, Segmented, Skeleton, Tabs, Tag, Tooltip, message } from 'antd';
import {
  CaretRightOutlined, CheckOutlined, ClockCircleOutlined, CommentOutlined, CopyOutlined, FileExcelOutlined, FileTextOutlined, FlagOutlined, MergeCellsOutlined,
  MessageOutlined, PaperClipOutlined, PauseOutlined, PlusOutlined, ReloadOutlined, SendOutlined, SwapOutlined, SyncOutlined, TagOutlined, TeamOutlined,
  UndoOutlined, UserAddOutlined, UserDeleteOutlined,
} from '@ant-design/icons';
import { reportAPI } from '../services/api';
import { cancellable, isAbort } from '../components/analytics/http';
import { ago, dateTime } from '../components/analytics/fmt';
import { useFilters } from './Filters';
import { ANT_STATUS_TAG } from '../theme';
import { formatDuration } from '../utils/duration';
import '../styles/analytics.css';

const Context = createContext(() => {});
const dash = v => (v === null || v === undefined || v === '' ? '-' : v);
const mins = v => (v === null || v === undefined ? '-' : formatDuration(v));

// Every kind of event in the timeline: an icon, a colour, a short label and the filter group it belongs to. Colour is never the only cue:
// each event also has its icon and its label.
const KIND = {
  created: { icon: PlusOutlined, color: '#6b7194', label: 'Raised', group: 'status' },
  assigned: { icon: UserAddOutlined, color: '#2a78d6', label: 'Assigned', group: 'people' },
  reassigned: { icon: SwapOutlined, color: '#d9541e', label: 'Reassigned', group: 'people' },
  unassigned: { icon: UserDeleteOutlined, color: '#d9541e', label: 'Unassigned', group: 'people' },
  reply: { icon: MessageOutlined, color: '#4f46e5', label: 'Team reply', group: 'talk' },
  requester_reply: { icon: CommentOutlined, color: '#118a5d', label: 'Requester reply', group: 'talk' },
  note: { icon: FileTextOutlined, color: '#c24a7c', label: 'Note', group: 'talk' },
  forwarded: { icon: SendOutlined, color: '#6b7194', label: 'Forwarded', group: 'talk' },
  attachment: { icon: PaperClipOutlined, color: '#6b7194', label: 'Attachment', group: 'talk' },
  closed: { icon: CheckOutlined, color: '#0b8a0b', label: 'Closed', group: 'status' },
  reopened: { icon: UndoOutlined, color: '#d03b3b', label: 'Reopened', group: 'status' },
  hold: { icon: PauseOutlined, color: '#a86f00', label: 'On hold', group: 'status' },
  resumed: { icon: CaretRightOutlined, color: '#a86f00', label: 'Resumed', group: 'status' },
  status: { icon: SyncOutlined, color: '#6250d6', label: 'Status', group: 'status' },
  merged: { icon: MergeCellsOutlined, color: '#d03b3b', label: 'Merged', group: 'status' },
  worklog: { icon: ClockCircleOutlined, color: '#0b7a3b', label: 'Work logged', group: 'work' },
  group: { icon: TeamOutlined, color: '#6250d6', label: 'Group', group: 'work' },
  priority: { icon: FlagOutlined, color: '#6250d6', label: 'Priority', group: 'work' },
  category: { icon: TagOutlined, color: '#6250d6', label: 'Category', group: 'work' },
};
const FALLBACK = { icon: SyncOutlined, color: '#6b7194', label: 'Event', group: 'work' };
const FILTERS = [
  { value: 'all', label: 'All' }, { value: 'people', label: 'Assignments' }, { value: 'talk', label: 'Conversation' },
  { value: 'status', label: 'Status' }, { value: 'work', label: 'Work & changes' },
];

function Timeline({ events }) {
  const [filter, setFilter] = useState('all');
  const grouped = useMemo(() => {
    const out = [];
    let previous = null;
    events.forEach(e => {
      const meta = KIND[e.kind] || FALLBACK;
      const day = dayjs(e.at).format('dddd, D MMM YYYY');
      const gap = previous ? dayjs(e.at).diff(dayjs(previous.at), 'minute') : null;
      out.push({ ...e, meta, day, gap });
      previous = e;
    });
    return out.filter(e => filter === 'all' || e.meta.group === filter);
  }, [events, filter]);

  if (!events?.length) return <Alert type="info" showIcon title="No history is available for this SR yet." />;
  const first = events[0];
  const last = events[events.length - 1];
  const span = dayjs(last.at).diff(dayjs(first.at), 'minute');
  return (
    <div>
      <div className="an-tl-tools">
        <Segmented size="small" value={filter} onChange={setFilter} options={FILTERS} aria-label="Filter the timeline" />
        <span>{events.length} events{span > 0 ? ` over ${formatDuration(span)}` : ''}</span>
      </div>
      {grouped.length === 0 && <div className="an-muted">No events of this kind.</div>}
      <ol className="an-tl">
        {grouped.map((e, i) => {
          const Icon = e.meta.icon;
          const newDay = i === 0 || grouped[i - 1].day !== e.day;
          return [
            newDay ? <li key={`day-${e.seq}`} className="an-tl-dayrow"><div className="an-tl-day">{e.day}</div></li> : null,
            <li key={e.seq}>
              <span className="an-tl-ico" style={{ background: e.meta.color }} aria-hidden="true"><Icon /></span>
              <div>
                <div className="an-tl-main"><span className="an-kind-label" style={{ color: e.meta.color }}>{e.meta.label}</span>{e.summary}</div>
                <div className="an-tl-meta">
                  <Tooltip title={dateTime(e.at)}><span>{dayjs(e.at).format('hh:mm A')}</span></Tooltip>
                  <span>{ago(e.at)}</span>
                  {e.actor ? <span>by {e.actor}</span> : null}
                  {e.gap !== null && e.gap >= 5 ? <span className="an-tl-gap">+{formatDuration(e.gap)} after the previous event</span> : null}
                </div>
              </div>
            </li>,
          ];
        })}
      </ol>
    </div>
  );
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

const SRViewerModal = memo(function SRViewerModal({ state, onClose, onRetry }) {
  const { basis } = useFilters();
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;
  const { row, loading, error, open } = state;
  const [tab, setTab] = useState('details');
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (open) setTab('details'); }, [open, row?.me_id]);

  const h = row?.handling?.[basis] || row?.handling?.assigned;
  const ready = !!h?.history_ready;
  const turnaround = row ? (basis === 'raised' ? row.turnaround_raised_minutes : row.turnaround_assigned_minutes) : null;
  const columns = mobile ? 1 : 2;

  async function exportSR() {
    setExporting(true);
    try { await reportAPI.request(row.me_id); } catch (e) { message.error(e.message || 'The download failed'); } finally { setExporting(false); }
  }
  async function copy() {
    if (await copyText(String(row.display_id))) { setCopied(true); message.success(`SR ${row.display_id} copied`); setTimeout(() => setCopied(false), 1800); } else message.error('Could not copy');
  }

  const details = row && (
    <Descriptions column={columns} size="small" bordered layout={mobile ? 'vertical' : 'horizontal'} styles={{ label: { width: 170 } }}>
      <Descriptions.Item label="Subject" span={columns}>{row.subject || '-'}</Descriptions.Item>
      <Descriptions.Item label="Status"><Tag color={ANT_STATUS_TAG[row.status]}>{row.status}</Tag></Descriptions.Item>
      <Descriptions.Item label="ManageEngine status">{row.status_name || '-'}</Descriptions.Item>
      <Descriptions.Item label="Technician">{row.technician || '(Unassigned)'}</Descriptions.Item>
      <Descriptions.Item label="Requester">{row.requester || '-'}</Descriptions.Item>
      <Descriptions.Item label="Category">{row.category || '-'}</Descriptions.Item>
      <Descriptions.Item label="Subcategory">{row.subcategory || '-'}</Descriptions.Item>
      <Descriptions.Item label="Priority">{row.priority || '-'}</Descriptions.Item>
      <Descriptions.Item label="Request type">{row.request_type || '-'}</Descriptions.Item>
      <Descriptions.Item label="Group">{row.group_name || '-'}</Descriptions.Item>
      <Descriptions.Item label="Site / mode">{[row.site, row.mode].filter(Boolean).join(' / ') || '-'}</Descriptions.Item>
      <Descriptions.Item label="Raised">{dateTime(row.created_at)}</Descriptions.Item>
      <Descriptions.Item label="Assigned to technician">{dateTime(row.assigned_at)}</Descriptions.Item>
      <Descriptions.Item label="Completed">{dateTime(row.completed_at)}</Descriptions.Item>
      <Descriptions.Item label="Due by">{dateTime(row.due_by)}{row.overdue ? <Tag color="red" style={{ marginLeft: 8 }}>overdue</Tag> : null}</Descriptions.Item>
      <Descriptions.Item label="Turnaround since assigned">{mins(row.turnaround_assigned_minutes)}</Descriptions.Item>
      <Descriptions.Item label="Turnaround since raised">{mins(row.turnaround_raised_minutes)}</Descriptions.Item>
      <Descriptions.Item label="Last refreshed">{dateTime(row.last_synced_at)}</Descriptions.Item>
    </Descriptions>
  );

  const handling = row && (ready ? (
    <Descriptions column={columns} size="small" bordered layout={mobile ? 'vertical' : 'horizontal'} styles={{ label: { width: 190 } }}>
      <Descriptions.Item label="Reassignments">{h.reassignments ? <Tag color="orange">{h.reassignments}×</Tag> : '0'}</Descriptions.Item>
      <Descriptions.Item label="Technicians involved">{dash(h.technicians_involved)}</Descriptions.Item>
      <Descriptions.Item label="Handover path" span={columns}>{h.path ? h.path.join(' → ') : '-'}</Descriptions.Item>
      <Descriptions.Item label="First assigned by">{dash(h.first_assigned_by)}</Descriptions.Item>
      <Descriptions.Item label="Time to first assignment">{mins(h.time_to_assign_minutes)}</Descriptions.Item>
      <Descriptions.Item label="First reply">{h.first_response_minutes === null ? 'No reply yet' : mins(h.first_response_minutes)}</Descriptions.Item>
      <Descriptions.Item label="Replies (team / requester)">{`${h.tech_replies} / ${h.requester_replies}`}</Descriptions.Item>
      <Descriptions.Item label="Times reopened">{h.reopens ? <Tag color="red">{h.reopens}×</Tag> : '0'}</Descriptions.Item>
      <Descriptions.Item label="First-contact resolution">{h.fcr === null || h.fcr === undefined ? '-' : h.fcr ? 'Yes' : 'No'}</Descriptions.Item>
      <Descriptions.Item label="Closed by">{dash(h.closed_by)}</Descriptions.Item>
      <Descriptions.Item label="Closure code">{dash(h.closure_code)}</Descriptions.Item>
      <Descriptions.Item label="Work logged">{h.worklog_count ? `${mins(h.worklog_minutes)} (${h.worklog_count} entries)` : 'None'}</Descriptions.Item>
      <Descriptions.Item label="Notes / attachments">{`${h.notes_count} / ${h.attachments}`}</Descriptions.Item>
      <Descriptions.Item label="Time on hold">{h.hold_minutes === null ? '-' : mins(h.hold_minutes)}</Descriptions.Item>
      <Descriptions.Item label="Active time">{mins(h.active_minutes)}</Descriptions.Item>
      <Descriptions.Item label="Est. waiting on requester">{h.est_wait_minutes === null ? '-' : mins(h.est_wait_minutes)}</Descriptions.Item>
      <Descriptions.Item label="Quiet for (open SRs)">{mins(h.idle_minutes)}</Descriptions.Item>
      <Descriptions.Item label="Group / priority / category changes">{`${h.group_changes} / ${h.priority_changes} / ${h.category_changes}`}</Descriptions.Item>
      <Descriptions.Item label="Last activity">{dateTime(h.last_activity_at)}</Descriptions.Item>
    </Descriptions>
  ) : <Alert type="info" showIcon title="The history of this SR could not be read from ManageEngine right now." />);

  const title = (
    <div className="an-viewer-head">
      <h3>{row ? `SR ${row.display_id}` : 'SR'}</h3>
      {row && (
        <Tooltip title={copied ? 'Copied' : 'Copy the SR number'}>
          <Button size="small" type="text" icon={copied ? <CheckOutlined /> : <CopyOutlined />} onClick={copy} aria-label={`Copy SR number ${row.display_id}`} />
        </Tooltip>
      )}
      {row && <Tag color={ANT_STATUS_TAG[row.status]} style={{ marginInlineEnd: 0 }}>{row.status}</Tag>}
      {row?.priority && <Tag style={{ marginInlineEnd: 0 }}>{row.priority}</Tag>}
    </div>
  );

  return (
    <Modal
      open={open} onCancel={onClose} footer={null} width={mobile ? '100vw' : 880} centered={!mobile} title={title} destroyOnHidden
      wrapClassName={mobile ? 'an-viewer-full' : ''} styles={{ body: { paddingTop: 4 } }}
    >
      {loading && !row && <Skeleton active paragraph={{ rows: 8 }} />}
      {error && !row && (
        <Alert type="error" showIcon title={error} action={<Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>Retry</Button>} />
      )}
      {row && (
        <div className="an-viewer-body">
          <div className="an-viewer-subject">{row.subject || '(No subject)'}</div>
          <div className="an-viewer-people">
            <span>Technician: <b>{row.technician || '(Unassigned)'}</b></span>
            <span>Requester: <b>{row.requester || '-'}</b></span>
            {row.category && <span>{row.category}</span>}
          </div>
          <div className="an-viewer-stats">
            <div className="an-vstat"><span>Turnaround ({basis === 'raised' ? 'since raised' : 'since assigned'})</span><b>{turnaround === null || turnaround === undefined ? (row.status === 'Closed' ? '-' : 'Still open') : formatDuration(turnaround)}</b></div>
            {ready && <div className="an-vstat"><span>First reply</span><b>{h.first_response_minutes === null ? 'None yet' : formatDuration(h.first_response_minutes)}</b></div>}
            {ready && <div className="an-vstat"><span>Reassigned</span><b>{h.reassignments ? `${h.reassignments}×` : 'Never'}</b></div>}
            {ready && <div className="an-vstat"><span>Reopened</span><b>{h.reopens ? `${h.reopens}×` : 'Never'}</b></div>}
            {ready && <div className="an-vstat"><span>Replies (team / requester)</span><b>{h.tech_replies} / {h.requester_replies}</b></div>}
          </div>
          <Tabs
            size="small" activeKey={tab} onChange={setTab}
            tabBarExtraContent={<Button size="small" icon={<FileExcelOutlined />} loading={exporting} onClick={exportSR}>{mobile ? 'Excel' : 'Excel (details + timeline)'}</Button>}
            items={[
              { key: 'details', label: 'Details', children: details },
              { key: 'handling', label: 'Handling', children: handling },
              { key: 'timeline', label: `Timeline${row.events?.length ? ` (${row.events.length})` : ''}`, children: <Timeline events={row.events} /> },
            ]}
          />
        </div>
      )}
    </Modal>
  );
});

// One request-detail window for the whole app: call openSR(id) from any table row.
export function SRViewerProvider({ children }) {
  const [state, setState] = useState({ open: false, row: null, loading: false, error: null });
  const controller = useRef(null);
  const lastId = useRef(null);

  const load = useCallback(id => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    lastId.current = id;
    setState({ open: true, row: null, loading: true, error: null });
    cancellable.request(id, c.signal)
      .then(res => { if (!c.signal.aborted) setState({ open: true, row: res.data, loading: false, error: null }); })
      .catch(error => {
        if (c.signal.aborted || isAbort(error)) return;
        setState({ open: true, row: null, loading: false, error: error.message || 'Failed to load the request' });
      });
  }, []);
  const close = useCallback(() => { controller.current?.abort(); setState(s => ({ ...s, open: false })); }, []);
  const retry = useCallback(() => { if (lastId.current) load(lastId.current); }, [load]);
  useEffect(() => () => controller.current?.abort(), []);

  return (
    <Context.Provider value={load}>
      {children}
      <SRViewerModal state={state} onClose={close} onRetry={retry} />
    </Context.Provider>
  );
}

export const useSRViewer = () => useContext(Context);
