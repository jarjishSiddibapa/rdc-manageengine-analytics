import dayjs from 'dayjs';
import { Alert, App as AntApp, Button, Popconfirm, Progress, Skeleton, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
import { syncAPI } from '../services/api';
import { useAuth } from '../context/Auth';
import { useSync } from '../context/Sync';
import { useFilters } from '../context/Filters';
import useLoad from '../hooks/useLoad';
import SyncButtons from '../components/SyncButtons';
import { ErrorState } from '../components/ui/ErrorState';
import { Kpi, KpiGrid } from '../components/Kpi';
import { friendlyError } from '../utils/errors';

const { Text } = Typography;
const at = v => (v ? dayjs(v).format('DD-MMM-YYYY hh:mm A') : '-');
const STATUS_TAG = { success: 'green', failed: 'red', running: 'blue' };
const STATUS_WORD = { success: 'Done', failed: 'Failed', running: 'Running' };
const MODE_TAG = { deep: <Tag color="purple">Deep sync</Tag>, quick: <Tag color="blue">Sync</Tag>, history: <Tag color="cyan">SR history</Tag> };

function lengthOf(run) {
  if (!run.finished_at) return '-';
  const seconds = Math.max(0, dayjs(run.finished_at).diff(dayjs(run.started_at), 'second'));
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m` : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

// 95 -> "about 1 h 35 min"; 0.4 -> "less than a minute".
function timeLeft(minutes) {
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `about ${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 60 ? `about ${h + 1} h` : `about ${h} h${m ? ` ${m} min` : ''}`;
}

export default function DataSync() {
  const { message } = AntApp.useApp();
  const { status, refresh, historyEta, offline } = useSync();
  const { canSync } = useAuth();
  const { dataVersion } = useFilters();
  const { data, loading, error, reload } = useLoad(() => syncAPI.history(), [dataVersion, status?.latest?.id, !!status?.running]);
  const running = status?.running;
  const auto = status?.auto;
  const deep = status?.deep;
  const hist = status?.history;
  const histRun = hist?.running;
  const histPct = hist?.total ? Math.min(100, Math.floor((hist.collected / hist.total) * 1000) / 10) : 0;
  const latest = status?.latest;

  async function collect(rebuild) {
    try {
      await syncAPI.collectHistory(rebuild);
      message.info(rebuild ? 'Rebuilding the history of every SR' : 'Collecting SR history');
      refresh();
    } catch (e) { message.error(e.message || 'Could not start the collection'); }
  }
  async function stop() {
    try { await syncAPI.stopHistory(); message.info('Stopping after the SRs in progress'); refresh(); } catch (e) { message.error(e.message || 'Could not stop'); }
  }

  const columns = [
    { title: 'Started', dataIndex: 'started_at', width: 170, render: at },
    { title: 'Type', dataIndex: 'mode', width: 110, render: v => MODE_TAG[v] || v },
    { title: 'Result', dataIndex: 'status', width: 100, render: v => <Tag color={STATUS_TAG[v]} icon={v === 'success' ? <CheckCircleFilled /> : v === 'failed' ? <CloseCircleFilled /> : <ClockCircleOutlined />}>{STATUS_WORD[v] || v}</Tag> },
    { title: 'Took', width: 90, responsive: ['md'], render: (_, r) => lengthOf(r) },
    { title: 'Started by', dataIndex: 'trigger_source', width: 190, responsive: ['lg'], render: (v, r) => (v === 'auto' ? <Text type="secondary">Automatic</Text> : r.started_by || '-') },
    { title: <Tooltip title="SRs read from ManageEngine">SRs read</Tooltip>, dataIndex: 'fetched', width: 96, align: 'right', responsive: ['md'], render: v => v.toLocaleString() },
    { title: <Tooltip title="SRs this app had not seen before">New</Tooltip>, dataIndex: 'inserted', width: 80, align: 'right', responsive: ['md'], render: v => v.toLocaleString() },
    { title: <Tooltip title="SRs that were already stored and had changed">Changed</Tooltip>, dataIndex: 'updated', width: 90, align: 'right', responsive: ['md'], render: v => v.toLocaleString() },
    { title: <Tooltip title="SRs ManageEngine no longer has">Gone</Tooltip>, dataIndex: 'removed', width: 80, align: 'right', responsive: ['lg'] },
    { title: 'Message', dataIndex: 'message', ellipsis: { showTitle: false }, render: v => <Tooltip title={friendlyError(v)} placement="topLeft">{friendlyError(v)}</Tooltip> },
  ];

  return (
    <>
      <p className="page-intro">
        This app keeps its own copy of ManageEngine's SRs so every screen is fast, and it only ever reads from ManageEngine. <b>Sync SRs</b> fetches just the SRs that changed since the last sync (seconds).
        <b> Deep Sync SRs</b> re-reads every SR, newest to oldest, and flags any that ManageEngine no longer has.
        {auto?.minutes ? ` A Sync also runs by itself every ${auto.minutes} minutes.` : ' Automatic sync is switched off (an administrator can turn it on in Admin, Settings).'}
        {deep?.enabled ? ` A Deep sync runs by itself every day at ${deep.time}${deep.catchup ? ' (and once more as soon as the app is back if it was off then)' : ''}.` : ''}
      </p>

      {!status?.configured && status && <Alert type="warning" showIcon style={{ marginBottom: 16 }} title="ManageEngine is not configured" description="An administrator can enter the ManageEngine details under Admin, Connections (or in backend/.env). No restart is needed." />}
      {latest?.status === 'failed' && !running && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} title={`The last sync failed (${at(latest.started_at)})`} description={friendlyError(latest.message)} />
      )}
      {offline && <Alert type="warning" showIcon style={{ marginBottom: 16 }} title="Cannot reach the server" description="The figures below are the last ones received and will refresh when the connection returns." />}

      <KpiGrid>
        <Kpi label="SRs stored" value={(status?.stored.total ?? 0).toLocaleString()} sub={`${(status?.stored.closed ?? 0).toLocaleString()} closed`} />
        <Kpi label="Last successful sync" value={status?.lastSuccess ? dayjs(status.lastSuccess.finished_at).format('hh:mm A') : 'Never'}
          sub={status?.lastSuccess ? `${dayjs(status.lastSuccess.finished_at).format('DD MMM YYYY')} · ${status.lastSuccess.mode === 'deep' ? 'deep sync' : 'sync'}` : undefined} />
        <Kpi label="Next automatic sync" value={!auto?.minutes ? 'Off' : running ? 'Running now' : auto.nextInMinutes === null ? 'Soon' : auto.nextInMinutes === 0 ? 'Due now' : `in ${auto.nextInMinutes} min`}
          sub={auto?.minutes ? `every ${auto.minutes} minutes` : undefined} />
        <Kpi label="Next automatic deep sync" value={!deep?.enabled ? 'Off' : running?.mode === 'deep' ? 'Running now' : dayjs(deep.next_run).format('DD MMM, hh:mm A')}
          sub={deep?.last_success ? `last: ${dayjs(deep.last_success.finished_at || deep.last_success.started_at).format('DD MMM, hh:mm A')}` : deep?.enabled ? 'none has run yet' : undefined} />
      </KpiGrid>

      <section className="card" style={{ marginBottom: 16 }} aria-labelledby="sync-now">
        <header className="card-head"><div><h3 className="card-title" id="sync-now">Sync now</h3><div className="card-sub">Manual syncs are for managers and administrators</div></div></header>
        {running ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }} role="status">
            <Progress type="circle" size={52} percent={100} status="active" showInfo={false} />
            <div>
              <b>{running.mode === 'deep' ? 'Deep sync' : 'Sync'} in progress</b>
              <div style={{ color: 'var(--text-2)' }}>{running.message}</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{running.pages} pages · {running.scanned.toLocaleString()} SRs scanned · {running.inserted.toLocaleString()} new · {running.updated.toLocaleString()} changed</div>
            </div>
          </div>
        ) : <SyncButtons />}
      </section>

      <section className="card" style={{ marginBottom: 16 }} aria-labelledby="sr-history">
        <header className="card-head">
          <div>
            <h3 className="card-title" id="sr-history">SR history</h3>
            <div className="card-sub">What happened to each SR: reassignments, reopens, replies, holds, worklogs. Read from ManageEngine's change log of every SR (read-only).</div>
          </div>
        </header>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 260, flex: '1 1 320px' }}>
            <Progress percent={histPct} status={histRun ? 'active' : 'normal'} aria-label="SR history collected" />
            <div style={{ color: 'var(--text-2)' }}>
              <b>{(hist?.collected ?? 0).toLocaleString()}</b> of {(hist?.total ?? 0).toLocaleString()} SRs have their history
              {hist?.pending ? ` · ${hist.pending.toLocaleString()} still to collect or refresh` : ' · up to date'}
            </div>
            {hist?.pending > 0 && (histRun || historyEta) && (
              <div style={{ marginTop: 8 }}>
                {historyEta ? (
                  <span className="eta" role="status"><ClockCircleOutlined /> {timeLeft(historyEta.minutesLeft)} left · finishing around {dayjs().add(historyEta.minutesLeft, 'minute').format('hh:mm A')} · {Math.round(historyEta.perMinute).toLocaleString()} SRs a minute</span>
                ) : (
                  <span className="eta" role="status"><HistoryOutlined /> Working out how long this will take...</span>
                )}
              </div>
            )}
            {histRun && <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 6 }}>{histRun.message}{histRun.failed ? ` · ${histRun.failed} will be retried` : ''}</div>}
            {!histRun && hist?.latest?.status === 'failed' && <div style={{ color: 'var(--bad)', fontSize: 12, marginTop: 6 }}>The last collection did not finish: {friendlyError(hist.latest.message)} It continues from where it stopped.</div>}
            <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 6 }}>
              {hist?.auto ? 'Collected automatically in the background after each sync. The first full collection takes a couple of hours; the figures on the dashboards cover the SRs collected so far.' : 'Automatic collection is off (an administrator can turn it on in Admin, Settings).'}
            </div>
          </div>
          {canSync && (
            <Space wrap>
              {histRun
                ? (
                  <Popconfirm title="Stop collecting?" description="It finishes the SRs in progress and stops. You can continue later and it picks up where it left off." okText="Stop" onConfirm={stop}>
                    <Button danger>Stop</Button>
                  </Popconfirm>
                )
                : <Button type="primary" disabled={!status?.configured || !hist?.pending} onClick={() => collect(false)}>Collect SR history</Button>}
              <Popconfirm title="Rebuild all SR history?" description="Re-reads the change log of every SR. Takes a couple of hours; the existing figures stay visible meanwhile." okText="Rebuild" onConfirm={() => collect(true)} disabled={!!histRun || !status?.configured}>
                <Button disabled={!!histRun || !status?.configured}>Rebuild all</Button>
              </Popconfirm>
            </Space>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="sync-history">
        <header className="card-head">
          <div><h3 className="card-title" id="sync-history">Sync history</h3><div className="card-sub">The last 30 runs</div></div>
          <div className="card-actions"><Button icon={<ReloadOutlined />} onClick={reload} loading={loading && !!data} aria-label="Refresh sync history" /></div>
        </header>
        {error && !data ? <ErrorState compact title="Could not load the sync history" message={error} onRetry={reload} /> : (
          <Table
            rowKey="id" size="small" columns={columns} dataSource={data?.runs || []} loading={loading && !!data} scroll={{ x: 'max-content' }} pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
            locale={{ emptyText: loading && !data ? <Skeleton active title={false} paragraph={{ rows: 4 }} /> : <div className="empty-block"><HistoryOutlined /><b>No syncs yet</b><span>Press Sync SRs to fetch the SRs from ManageEngine.</span></div> }}
          />
        )}
      </section>
    </>
  );
}
