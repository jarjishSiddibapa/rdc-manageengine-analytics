import { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  Alert, App as AntApp, Button, Collapse, Form, Input, InputNumber, Popconfirm, Space, Switch, Table, TimePicker, Tooltip, Tag, Typography,
} from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, DeleteOutlined, DownloadOutlined, MailOutlined, PlayCircleOutlined, SendOutlined, SyncOutlined,
} from '@ant-design/icons';
import { adminAPI } from '../services/api';
import useLoad from '../hooks/useLoad';
import { ErrorState } from '../components/ui/ErrorState';

const { Text } = Typography;
const when = v => (v ? dayjs(v).format('DD-MMM-YYYY hh:mm A') : '-');

function formatBytes(bytes) {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

const STATUS = {
  success: <Tag icon={<CheckCircleFilled />} color="success">Done</Tag>,
  failed: <Tag icon={<CloseCircleFilled />} color="error">Failed</Tag>,
  running: <Tag icon={<SyncOutlined spin />} color="processing">Running</Tag>,
};
const EMAIL = {
  sent: <Tag icon={<CheckCircleFilled />} color="success">Sent</Tag>,
  failed: <Tag icon={<CloseCircleFilled />} color="error">Not sent</Tag>,
};
const TRIGGER = { schedule: 'Automatic', catchup: 'Catch-up', manual: 'By hand' };

function Stat({ label, value, hint, tone }) {
  return (
    <div className="card" style={{ flex: '1 1 200px', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--text-3, #5b6b80)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4, color: tone === 'bad' ? '#cf1322' : undefined }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: 'var(--text-3, #5b6b80)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export default function AdminBackups() {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const { data, error, loading, reload } = useLoad(() => adminAPI.backups(), []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [testing, setTesting] = useState(false);
  const watched = useRef(null); // the run a person started here, to tell them how it ended

  useEffect(() => {
    if (!data || dirty) return;
    const s = data.settings;
    form.setFieldsValue({ ...s, time: dayjs().hour(s.hour).minute(s.minute).second(0) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // While a backup is running, keep looking until it ends.
  const running = Boolean(data?.running);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [running, reload]);

  useEffect(() => {
    if (!data || data.running || watched.current === null) return;
    const run = data.runs.find(r => r.id === watched.current);
    if (!run || run.status === 'running') return;
    watched.current = null;
    if (run.status === 'success') message.success(`Backup finished (${formatBytes(run.size_bytes)})${run.email_status === 'failed' ? ' - but the email was not sent' : ''}`);
    else message.error(`Backup failed: ${run.message || 'unknown reason'}`);
  }, [data, message]);

  async function save(values) {
    setSaving(true);
    try {
      await adminAPI.saveBackupSettings({
        backup_enabled: values.enabled,
        backup_hour: values.time.hour(),
        backup_minute: values.time.minute(),
        backup_keep: values.keep,
        backup_email_enabled: values.email_enabled,
        backup_email_recipients: values.email_recipients || '',
      });
      message.success('Backup settings saved');
      setDirty(false);
      reload();
    } catch (e) { message.error(e.message); } finally { setSaving(false); }
  }

  async function runNow() {
    setStarting(true);
    try {
      const res = await adminAPI.runBackup();
      watched.current = res.data.id;
      message.info('Backup started. It can take a few minutes for a large database.');
      reload();
    } catch (e) { message.error(e.message); } finally { setStarting(false); }
  }

  async function testEmail() {
    setTesting(true);
    try {
      const res = await adminAPI.testBackupEmail(form.getFieldValue('email_recipients') || '');
      message.success(res.data.message);
    } catch (e) { message.error(e.message); } finally { setTesting(false); }
  }

  async function remove(filename) {
    try {
      await adminAPI.deleteBackup(filename);
      message.success('Backup removed');
      reload();
    } catch (e) { message.error(e.message); }
  }

  if (error && !data) return <ErrorState title="Could not load the backups" message={error} onRetry={reload} />;

  const last = data?.last_success;
  const emailOn = Form.useWatch('email_enabled', form);
  const columns = [
    { title: 'Backup file', dataIndex: 'filename', ellipsis: true, render: v => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    {
      title: 'Result', dataIndex: 'status', width: 100,
      render: (v, row) => (row.status === 'failed' && row.message ? <Tooltip title={row.message}>{STATUS[v]}</Tooltip> : STATUS[v] || v),
    },
    { title: 'Size', dataIndex: 'size_bytes', width: 90, render: formatBytes },
    { title: 'How', dataIndex: 'triggered_by', width: 100, render: (v, row) => <Tooltip title={row.started_by || ''}><Tag>{TRIGGER[v] || v}</Tag></Tooltip> },
    {
      title: 'Emailed', dataIndex: 'email_status', width: 100,
      render: (v, row) => (v ? <Tooltip title={row.email_message}>{EMAIL[v] || v}</Tooltip> : <Text type="secondary">-</Text>),
    },
    { title: 'Started', dataIndex: 'started_at', width: 180, render: when },
    {
      title: '', key: 'actions', width: 96, align: 'right',
      render: (_, row) => (
        <Space size={4}>
          {row.file_exists && (
            <Tooltip title="Download this backup">
              <Button size="small" icon={<DownloadOutlined />} href={`/api/admin/backups/download/${encodeURIComponent(row.filename)}`} download aria-label={`Download ${row.filename}`} />
            </Tooltip>
          )}
          {row.status !== 'running' && row.file_exists && (
            <Popconfirm title="Delete this backup file?" description="It cannot be brought back." okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove(row.filename)}>
              <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${row.filename}`} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {data && !data.mysqldump && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message="Backups cannot run: mysqldump was not found"
          description="Install the MySQL Server tools, or set MYSQLDUMP_PATH in backend\.env to the full path of mysqldump.exe, then restart the app." />
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Stat label="Last backup" value={last ? when(last.started_at) : 'None yet'} hint={last ? formatBytes(last.size_bytes) : 'Run one now to make sure it works'} tone={last ? undefined : 'bad'} />
        <Stat label="Next automatic backup" value={data?.settings.enabled ? when(data.next_run) : 'Off'} hint={data?.settings.enabled ? 'Server time. If the PC is off then, it runs when the app next starts.' : 'Automatic backups are switched off'} />
        <Stat label="Backups kept" value={`${data ? data.runs.filter(r => r.file_exists).length : 0} (${formatBytes(data?.disk_bytes)})`} hint={`The newest ${data?.settings.keep ?? '-'} are kept`} />
        <Stat label="Email" value={data?.mail_configured ? 'Ready' : 'Not set up'} hint={data?.mail_configured ? 'Sending with the mail account on the Connections tab' : 'Enter the mail account on the Connections tab'} />
      </div>

      <section className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <Form form={form} layout="vertical" onFinish={save} onValuesChange={() => setDirty(true)} requiredMark={false} disabled={loading && !data}>
          <Form.Item name="enabled" label="Automatic daily backup" valuePropName="checked" extra="A complete copy of the database (SRs, history, users and settings) is saved to the folder shown below.">
            <Switch checkedChildren="On" unCheckedChildren="Off" />
          </Form.Item>
          <Space size={24} wrap align="start">
            <Form.Item name="time" label="Every day at (server time)" rules={[{ required: true, message: 'Choose a time' }]}>
              <TimePicker format="hh:mm A" use12Hours allowClear={false} minuteStep={5} needConfirm={false} />
            </Form.Item>
            <Form.Item name="keep" label="Keep the newest" rules={[{ required: true, type: 'number', min: 1, max: 365, message: '1 to 365' }]} extra="Older backups are deleted automatically.">
              <InputNumber min={1} max={365} addonAfter="backups" style={{ width: 170 }} />
            </Form.Item>
          </Space>
          <Form.Item name="email_enabled" label="Email every backup" valuePropName="checked" extra="A compressed copy is attached, so a copy always exists away from this PC. Failures are emailed too.">
            <Switch checkedChildren="On" unCheckedChildren="Off" />
          </Form.Item>
          <Form.Item name="email_recipients" label="Send to" extra="Separate several addresses with commas."
            rules={[{ validator: (_, v) => (!emailOn || String(v || '').trim() ? Promise.resolve() : Promise.reject(new Error('Add at least one email address'))) }]}>
            <Input prefix={<MailOutlined />} placeholder="name@yourcompany.com, other@yourcompany.com" disabled={!emailOn} />
          </Form.Item>
          {!data?.mail_configured && emailOn && (
            <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="Email is not set up yet"
              description="Add SMTP_USER and SMTP_PASS (and SMTP_HOST / SMTP_PORT if you do not use Gmail) to backend\.env and restart the app. Backups still run; they just will not be emailed." />
          )}
          <Space wrap>
            <Button type="primary" htmlType="submit" loading={saving} disabled={!dirty}>Save settings</Button>
            {dirty && <Button onClick={() => { setDirty(false); reload(); }}>Discard changes</Button>}
            <Button icon={<SendOutlined />} loading={testing} disabled={!data?.mail_configured} onClick={testEmail}>Send a test email</Button>
          </Space>
        </Form>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <b>Backup history</b>
            <div style={{ fontSize: 12, color: 'var(--text-3, #5b6b80)' }}>Saved in <Text code style={{ fontSize: 12 }}>{data?.folder}</Text></div>
          </div>
          <Button type="primary" icon={<PlayCircleOutlined />} loading={starting || running} disabled={!data?.mysqldump} onClick={runNow}>
            {running ? 'Backing up...' : 'Run a backup now'}
          </Button>
        </div>
        <Table
          rowKey="id" size="small" columns={columns} dataSource={data?.runs || []} loading={loading && !data}
          pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }} scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'No backups yet. Use "Run a backup now" to make the first one.' }}
        />
      </section>

      <Collapse ghost items={[{
        key: 'restore',
        label: 'How to restore a backup',
        children: (
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <ol style={{ paddingLeft: 18, margin: 0 }}>
              <li>Stop the app (close the <Text code>startup.bat</Text> window).</li>
              <li>Download the backup file you want. A file from an email is zipped (.gz): unzip it first.</li>
              <li>Open a Command Prompt in the folder with the file and run: <Text code>mysql -u root -p &lt; manageengine-analytics-YYYYMMDD-HHMMSS.sql</Text></li>
              <li>Start the app again. People are asked to sign in again (sign-ins are not part of a backup).</li>
            </ol>
            <p style={{ marginTop: 8 }}>This replaces everything in the <Text code>manageengine_analytics</Text> database with the state at the time of the backup. Backups contain user accounts (password hashes) and all SR data, so keep the files and the emails private.</p>
          </div>
        ),
      }]} />
    </div>
  );
}
