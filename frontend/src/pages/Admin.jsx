import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  Alert, App as AntApp, Button, Dropdown, Form, Input, InputNumber, Modal, Radio, Select, Skeleton, Space, Switch, Table, Tabs, Tag, Typography,
} from 'antd';
import {
  CopyOutlined, DeleteOutlined, EditOutlined, KeyOutlined, LogoutOutlined, MoreOutlined, PlusOutlined, StopOutlined, CheckCircleOutlined, ReloadOutlined, SearchOutlined, TeamOutlined,
} from '@ant-design/icons';
import { adminAPI } from '../services/api';
import { ROLE_LABELS, useAuth } from '../context/Auth';
import useLoad from '../hooks/useLoad';
import useDebounced from '../hooks/useDebounced';
import { ErrorState } from '../components/ui/ErrorState';
import AdminBackups from './AdminBackups';
import AdminConnections from './AdminConnections';
import AdminSettings from './AdminSettings';
import { askToLeave } from '../hooks/useUnsavedGuard';
import { passwordHint, passwordRules, useAppConfig } from '../context/AppConfig';

const { Text, Paragraph } = Typography;
const at = v => (v ? dayjs(v).format('DD-MMM-YYYY hh:mm A') : 'Never');
const ROLE_HELP = {
  admin: 'Everything: users, settings, syncs and all analytics.',
  manager: 'All analytics and Excel reports, and can run syncs.',
  viewer: 'All analytics and Excel reports. Cannot run syncs or change anything.',
};
const TABS = ['users', 'activity', 'backups', 'connections', 'settings'];
const ROLE_COLOR = { admin: 'geekblue', manager: 'purple', viewer: 'default' };
const initialsOf = name => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return `${Array.from(bytes, b => alphabet[b % alphabet.length]).join('')}!7`;
}

// 0-4: a quick guide for people choosing a password, not a rule (the server enforces the real minimum).
function strength(password = '') {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}
const STRENGTH_LABEL = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_COLOR = ['#d03b3b', '#ec835a', '#eda100', '#4f9d4f', '#0a7d0a'];

function StrengthMeter({ password }) {
  const { config } = useAppConfig();
  if (!password) return null;
  const score = password.length < config.password.min_length ? 0 : strength(password);
  return (
    <div aria-live="polite">
      <div className="strength"><i style={{ width: `${Math.max(1, score) * 25}%`, background: STRENGTH_COLOR[score] }} /></div>
      <Text type="secondary" style={{ fontSize: 12 }}>Password strength: {STRENGTH_LABEL[score]}</Text>
    </div>
  );
}

// ── Users ──
function UserForm({ editing, onClose, onSaved }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [reveal, setReveal] = useState(false);
  const isNew = !editing?.id;
  const password = Form.useWatch('password', form);
  const { config } = useAppConfig();

  async function submit(values) {
    setSaving(true);
    setProblem('');
    const body = { ...values, name: values.name.trim(), email: values.email.trim().toLowerCase() };
    try {
      if (isNew) await adminAPI.createUser(body);
      else await adminAPI.updateUser(editing.id, body);
      message.success(isNew ? `${body.name} can now sign in` : 'User updated');
      onSaved();
    } catch (error) {
      if (error.response?.status === 409) form.setFields([{ name: 'email', errors: [error.message] }]);
      else setProblem(error.message);
    } finally { setSaving(false); }
  }

  return (
    <Modal
      open={!!editing} title={isNew ? 'Add a user' : `Edit ${editing?.name}`} onCancel={onClose} onOk={() => form.submit()} okText={isNew ? 'Create user' : 'Save changes'}
      confirmLoading={saving} destroyOnHidden maskClosable={false} afterOpenChange={open => { if (!open) { setProblem(''); setReveal(false); } }}
    >
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false} initialValues={isNew ? { role: 'viewer', must_change_password: true } : editing} style={{ marginTop: 16 }}>
        {problem && <Alert type="error" showIcon title={problem} style={{ marginBottom: 16 }} role="alert" />}
        <Form.Item name="name" label="Full name" rules={[{ required: true, whitespace: true, message: 'Enter their name' }]}><Input maxLength={150} autoFocus autoComplete="off" /></Form.Item>
        <Form.Item
          name="email" label="Email (their sign-in name)" validateTrigger="onBlur"
          rules={[{ required: true, message: 'Enter their email address' }, { type: 'email', message: 'That does not look like an email address' }]}
        ><Input maxLength={190} inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} /></Form.Item>
        <Form.Item name="role" label="Role" extra={<Form.Item noStyle shouldUpdate>{() => ROLE_HELP[form.getFieldValue('role')]}</Form.Item>}>
          <Select options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        {isNew && (
          <>
            <Form.Item label="Temporary password" required extra="Share it with them privately. Use Generate for a strong one, then Copy.">
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item name="password" noStyle rules={[{ required: true, message: 'Enter a password' }, ...passwordRules(config.password)]}>
                  <Input.Password autoComplete="new-password" visibilityToggle={{ visible: reveal, onVisibleChange: setReveal }} aria-label="Temporary password" />
                </Form.Item>
                <Button onClick={() => { form.setFieldValue('password', randomPassword()); setReveal(true); form.validateFields(['password']).catch(() => {}); }}>Generate</Button>
                <Button icon={<CopyOutlined />} aria-label="Copy password" disabled={!password} onClick={() => copy(password, message)} />
              </Space.Compact>
              <StrengthMeter password={password} />
            </Form.Item>
            <Form.Item name="must_change_password" label="Ask them to choose their own password at first sign-in" valuePropName="checked"><Switch /></Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}

async function copy(text, message) {
  try { await navigator.clipboard.writeText(text); message.success('Copied'); } catch { message.info('Select the text and copy it'); }
}

function ResetPassword({ user, onClose }) {
  const { message } = AntApp.useApp();
  const [custom, setCustom] = useState(false);
  const [password, setPassword] = useState('');
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const { config } = useAppConfig();
  const tooShort = custom && password.length < config.password.min_length;

  async function submit() {
    if (tooShort) { setProblem(`Use at least ${config.password.min_length} characters, or let the app generate a password.`); return; }
    setSaving(true);
    setProblem('');
    try {
      const res = await adminAPI.resetPassword(user.id, custom ? password : null);
      if (res.data.password) setResult(res.data.password);
      else { message.success('Password changed'); onClose(); }
    } catch (error) { setProblem(error.message); } finally { setSaving(false); }
  }
  const close = () => { setResult(null); setPassword(''); setCustom(false); setProblem(''); onClose(); };

  return (
    <Modal
      open={!!user} title={`Reset password for ${user?.name}`} onCancel={close} destroyOnHidden maskClosable={!result} keyboard={!result}
      footer={result ? <Button type="primary" onClick={close}>Done</Button> : undefined} onOk={submit} okText="Reset password" confirmLoading={saving}
    >
      {result ? (
        <>
          <Alert type="success" showIcon title="New password created" description="Share it with them privately. It is shown only now, and they must change it when they sign in." style={{ margin: '12px 0' }} />
          <Space.Compact style={{ width: '100%' }}>
            <Input readOnly value={result} aria-label="New password" style={{ fontFamily: 'Consolas, monospace' }} onFocus={e => e.target.select()} />
            <Button icon={<CopyOutlined />} onClick={() => copy(result, message)}>Copy</Button>
          </Space.Compact>
        </>
      ) : (
        <>
          {problem && <Alert type="error" showIcon title={problem} role="alert" style={{ margin: '12px 0' }} />}
          <Paragraph type="secondary" style={{ marginTop: 12 }}>They are signed out everywhere and must choose a new password at their next sign-in.</Paragraph>
          <Radio.Group value={custom} onChange={e => { setCustom(e.target.value); setProblem(''); }} style={{ marginBottom: 12 }}>
            <Radio value={false}>Generate a password</Radio>
            <Radio value>I will type one</Radio>
          </Radio.Group>
          {custom && (
            <>
              <Input.Password placeholder={`At least ${config.password.min_length} characters`} aria-label="New password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" autoFocus status={password && tooShort ? 'error' : undefined} />
              <StrengthMeter password={password} />
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function Users() {
  const { message, modal } = AntApp.useApp();
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useLoad(() => adminAPI.users(), []);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [typed, setTyped] = useState('');
  const [role, setRole] = useState();
  const [state, setState] = useState();
  // Changes show at once and are put back if the server says no ("optimistic" updates). `patches` holds the pending ones.
  const [patches, setPatches] = useState({});
  const query = useDebounced(typed, 200).trim().toLowerCase();

  useEffect(() => { setPatches({}); }, [data]);

  const act = async (id, patch, call, ok) => {
    setPatches(p => ({ ...p, [id]: { ...p[id], ...patch } }));
    try { await call(); if (ok) message.success(ok); reload(); } catch (e) {
      setPatches(p => { const next = { ...p }; delete next[id]; return next; });
      message.error(e.message);
    }
  };

  const all = useMemo(() => (data?.users || []).filter(u => !patches[u.id]?.removed).map(u => ({ ...u, ...patches[u.id] })), [data, patches]);
  const users = useMemo(() => all.filter(u => (!query || `${u.name} ${u.email}`.toLowerCase().includes(query))
    && (!role || u.role === role) && (!state || (state === 'active' ? u.active : !u.active))), [all, query, role, state]);
  const filtered = !!(query || role || state);

  const columns = [
    {
      title: 'User', dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name),
      render: (v, u) => (
        <div className="user-cell">
          <div className="avatar sm" aria-hidden="true">{initialsOf(v)}</div>
          <div style={{ minWidth: 0 }}>
            <b>{v}</b>{u.id === me.id && <Tag style={{ marginLeft: 6 }}>you</Tag>}
            <div className="sub">{u.email}</div>
            <div className="only-mobile" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              <Tag color={ROLE_COLOR[u.role]} style={{ margin: 0 }}>{ROLE_LABELS[u.role]}</Tag>
              {u.active ? <Tag color="green" style={{ margin: 0 }}>Active</Tag> : <Tag color="red" style={{ margin: 0 }}>Disabled</Tag>}
              {u.must_change_password && <Tag color="gold" style={{ margin: 0 }}>must change password</Tag>}
            </div>
          </div>
        </div>
      ),
    },
    { title: 'Role', dataIndex: 'role', width: 130, responsive: ['md'], render: v => <Tag color={ROLE_COLOR[v]}>{ROLE_LABELS[v]}</Tag>, sorter: (a, b) => a.role.localeCompare(b.role) },
    {
      title: 'Status', dataIndex: 'active', width: 190, responsive: ['md'], sorter: (a, b) => Number(b.active) - Number(a.active),
      render: (v, u) => (<Space size={4} wrap>{v ? <Tag color="green">Active</Tag> : <Tag color="red">Disabled</Tag>}{u.must_change_password && <Tag color="gold">must change password</Tag>}</Space>),
    },
    { title: 'Last sign-in', dataIndex: 'last_login_at', width: 180, responsive: ['md'], render: at, sorter: (a, b) => String(a.last_login_at || '').localeCompare(String(b.last_login_at || '')) },
    { title: 'Signed in on', dataIndex: 'active_sessions', width: 110, responsive: ['lg'], render: v => (v ? `${v} device${v === 1 ? '' : 's'}` : '-') },
    {
      title: <span className="sr-only">Actions</span>, key: 'actions', width: 64, fixed: 'right',
      render: (_, u) => (
        <Dropdown trigger={['click']} menu={{
          items: [
            { key: 'edit', icon: <EditOutlined />, label: 'Edit details and role' },
            { key: 'reset', icon: <KeyOutlined />, label: 'Reset password' },
            { key: 'revoke', icon: <LogoutOutlined />, label: 'Sign out of all devices', disabled: !u.active_sessions },
            { type: 'divider' },
            u.active
              ? { key: 'disable', icon: <StopOutlined />, label: 'Disable account', disabled: u.id === me.id }
              : { key: 'enable', icon: <CheckCircleOutlined />, label: 'Enable account' },
            { key: 'delete', icon: <DeleteOutlined />, label: 'Delete user', danger: true, disabled: u.id === me.id },
          ],
          onClick: ({ key }) => {
            if (key === 'edit') setEditing(u);
            else if (key === 'reset') setResetting(u);
            else if (key === 'revoke') {
              modal.confirm({
                title: `Sign ${u.name} out of all devices?`, content: 'They can sign straight back in with their password.', okText: 'Sign out',
                onOk: () => act(u.id, { active_sessions: 0 }, () => adminAPI.revokeSessions(u.id), 'Signed out of all devices'),
              });
            } else if (key === 'disable') {
              modal.confirm({
                title: `Disable ${u.name}?`, content: 'They are signed out immediately and cannot sign in until you enable the account again.', okText: 'Disable',
                onOk: () => act(u.id, { active: false, active_sessions: 0 }, () => adminAPI.updateUser(u.id, { active: false }), 'Account disabled'),
              });
            } else if (key === 'enable') act(u.id, { active: true }, () => adminAPI.updateUser(u.id, { active: true }), 'Account enabled');
            else if (key === 'delete') {
              modal.confirm({
                title: `Delete ${u.name}?`, okText: 'Delete user', okButtonProps: { danger: true }, icon: <DeleteOutlined style={{ color: '#d03b3b' }} />,
                content: `This permanently removes ${u.email}. Their past activity stays in the log. To keep the account but block sign-in, disable it instead.`,
                onOk: () => act(u.id, { removed: true }, () => adminAPI.deleteUser(u.id), 'User deleted'),
              });
            }
          },
        }}>
          <Button type="text" size="large" icon={<MoreOutlined />} aria-label={`Actions for ${u.name}`} />
        </Dropdown>
      ),
    },
  ];

  if (error && !data) return <ErrorState title="Could not load the users" message={error} onRetry={reload} />;

  return (
    <>
      <div className="toolbar">
        <Input allowClear prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />} placeholder="Find by name or email" aria-label="Find a user" style={{ width: 260, maxWidth: '100%' }} value={typed} onChange={e => setTyped(e.target.value)} />
        <Select allowClear placeholder="Any role" aria-label="Filter by role" value={role} onChange={setRole} style={{ width: 150 }} options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} />
        <Select allowClear placeholder="Any status" aria-label="Filter by status" value={state} onChange={setState} style={{ width: 150 }} options={[{ value: 'active', label: 'Active' }, { value: 'disabled', label: 'Disabled' }]} />
        <span className="grow" />
        <Text type="secondary" aria-live="polite">{data ? (filtered ? `${users.length} of ${all.length} users` : `${all.length} users`) : ''}</Text>
        <Button icon={<ReloadOutlined />} onClick={reload} loading={loading && !!data} aria-label="Refresh users" />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>Add user</Button>
      </div>
      <Table
        rowKey="id" size="middle" loading={loading && !!data} columns={columns} dataSource={users} scroll={{ x: 'max-content' }} pagination={{ pageSize: 15, hideOnSinglePage: true, showSizeChanger: false }}
        locale={{
          emptyText: loading && !data ? <Skeleton active title={false} paragraph={{ rows: 3 }} /> : (
            <div className="empty-block"><TeamOutlined />
              <b>{filtered ? 'No one matches these filters' : 'No users yet'}</b>
              {filtered && <Button onClick={() => { setTyped(''); setRole(undefined); setState(undefined); }}>Clear filters</Button>}
            </div>
          ),
        }}
      />
      <section className="card" style={{ marginTop: 16 }}>
        <h3 className="card-title">What each role can do</h3>
        <ul className="insight-list" style={{ marginTop: 8 }}>
          {Object.keys(ROLE_LABELS).map(r => <li key={r}><span className="dot info" /><span><Tag color={ROLE_COLOR[r]}>{ROLE_LABELS[r]}</Tag>{ROLE_HELP[r]}</span></li>)}
        </ul>
      </section>
      <UserForm editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      <ResetPassword user={resetting} onClose={() => { setResetting(null); reload(); }} />
    </>
  );
}

// ── Activity log ──
const ACTION_LABELS = {
  login: 'Signed in', login_failed: 'Failed sign-in', logout: 'Signed out', password_changed: 'Changed password', profile_updated: 'Updated profile',
  user_created: 'Created user', user_updated: 'Updated user', user_enabled: 'Enabled user', user_disabled: 'Disabled user', user_deleted: 'Deleted user',
  password_reset: 'Reset password', sessions_revoked: 'Signed user out', settings_updated: 'Changed settings', sync_started: 'Started sync', deep_sync_started: 'Started deep sync',
  history_started: 'Started SR history', history_rebuild_started: 'Rebuilt SR history', history_stopped: 'Stopped SR history',
  connections_updated: 'Changed connections', connection_tested: 'Tested a connection', sync_stopped: 'Stopped sync',
  password_reset_requested: 'Asked for a password reset link', password_reset_completed: 'Reset password with a link', password_reset_failed: 'Failed password reset link',
};
const ACTION_COLOR = { login_failed: 'red', user_deleted: 'red', user_disabled: 'orange', password_reset: 'gold', settings_updated: 'purple', connections_updated: 'purple', sync_started: 'blue', deep_sync_started: 'blue' };

function Activity() {
  const [action, setAction] = useState();
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const q = useDebounced(typed, 350).trim();
  useEffect(() => { setPage(1); }, [q]);
  const { data, loading, error, reload } = useLoad(() => adminAPI.audit({ action, q: q || undefined, page, pageSize: size }), [action, q, page, size]);

  const columns = [
    { title: 'When', dataIndex: 'at', width: 180, render: at },
    { title: 'What', dataIndex: 'action', width: 190, render: v => <Tag color={ACTION_COLOR[v]}>{ACTION_LABELS[v] || v}</Tag> },
    { title: 'Who', dataIndex: 'user_email', width: 220, ellipsis: true, render: v => v || <Text type="secondary">-</Text> },
    { title: 'Target', dataIndex: 'target', width: 220, ellipsis: true, responsive: ['md'], render: v => v || <Text type="secondary">-</Text> },
    { title: 'Detail', dataIndex: 'detail', ellipsis: true, responsive: ['lg'], render: v => v || <Text type="secondary">-</Text> },
    { title: 'From', dataIndex: 'ip', width: 130, responsive: ['xl'], render: v => v || '-' },
  ];

  return (
    <>
      <div className="toolbar">
        <Select allowClear placeholder="Any activity" aria-label="Filter by activity" style={{ width: 220, maxWidth: '100%' }} value={action} onChange={v => { setAction(v); setPage(1); }}
          options={(data?.actions || []).map(a => ({ value: a, label: ACTION_LABELS[a] || a }))} />
        <Input allowClear prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />} placeholder="Search by person, target or detail" aria-label="Search the activity log" style={{ width: 320, maxWidth: '100%' }} value={typed} onChange={e => setTyped(e.target.value)} />
        <span className="grow" />
        <Button icon={<ReloadOutlined />} onClick={reload} loading={loading && !!data}>Refresh</Button>
      </div>
      {error && !data ? <ErrorState title="Could not load the activity log" message={error} onRetry={reload} /> : (
        <Table
          rowKey="id" size="small" loading={loading && !!data} columns={columns} dataSource={data?.entries || []} scroll={{ x: 'max-content' }}
          expandable={{ expandedRowRender: r => <div style={{ fontSize: 13 }}><b>{ACTION_LABELS[r.action] || r.action}</b> by {r.user_email || 'nobody'}{r.target ? ` on ${r.target}` : ''}{r.detail ? ` - ${r.detail}` : ''}{r.ip ? ` (from ${r.ip})` : ''}</div>, rowExpandable: () => true }}
          locale={{ emptyText: loading && !data ? <Skeleton active title={false} paragraph={{ rows: 4 }} /> : <div className="empty-block"><SearchOutlined /><b>Nothing matches</b></div> }}
          pagination={{ current: page, pageSize: size, total: data?.total || 0, showSizeChanger: true, showTotal: (t, r) => `${r[0]}-${r[1]} of ${t.toLocaleString()}`, onChange: (p, s) => { setPage(p); setSize(s); } }}
        />
      )}
    </>
  );
}

export default function Admin() {
  const { modal } = AntApp.useApp();
  const { config } = useAppConfig();
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'users';
  // Settings and Connections report whether they hold unsaved changes, so moving to another tab asks first.
  const dirty = useRef(false);
  const onDirty = useCallback(value => { dirty.current = value; }, []);
  const go = key => {
    const move = () => { dirty.current = false; setParams(key === 'users' ? {} : { tab: key }, { replace: true }); };
    if (dirty.current) askToLeave(modal, move); else move();
  };
  return (
    <>
      <p className="page-intro">Administrators manage who can use {config.app_name}, review what has been done in it, connect it to ManageEngine and email, and set how it behaves.</p>
      <Tabs
        activeKey={tab} destroyOnHidden onChange={go}
        items={[
          { key: 'users', label: 'Users', children: <Users /> },
          { key: 'activity', label: 'Activity log', children: <Activity /> },
          { key: 'backups', label: 'Backups', children: <AdminBackups /> },
          { key: 'connections', label: 'Connections', children: <AdminConnections onDirty={onDirty} /> },
          { key: 'settings', label: 'Settings', children: <AdminSettings onDirty={onDirty} /> },
        ]}
      />
    </>
  );
}
