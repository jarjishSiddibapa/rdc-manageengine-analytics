import { useState } from 'react';
import { Alert, App as AntApp, Button, Form, Input, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { authAPI } from '../services/api';
import { ROLE_LABELS, useAuth } from '../context/Auth';
import BrandMark from '../components/ui/BrandMark';
import { passwordHint, passwordRules, useAppConfig } from '../context/AppConfig';

const { Text } = Typography;
const ROLE_HELP = {
  admin: 'You can manage users and settings, run syncs and see all analytics.',
  manager: 'You can see all analytics and run syncs.',
  viewer: 'You can see all analytics. Syncs and settings are managed by others.',
};

function strength(password = '', min = 8) {
  let score = 0;
  if (password.length >= min) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return password.length < min ? 0 : score;
}
const LABEL = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
const COLOR = ['#d03b3b', '#ec835a', '#eda100', '#4f9d4f', '#0a7d0a'];

export function PasswordForm({ onDone, forced }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const next = Form.useWatch('next', form) || '';
  const { config } = useAppConfig();
  const score = strength(next, config.password.min_length);

  async function submit({ current, next: newPassword }) {
    setSaving(true);
    setProblem('');
    try {
      await authAPI.changePassword(current, newPassword);
      message.success('Password changed');
      form.resetFields();
      onDone?.();
    } catch (error) {
      // A wrong current password belongs on that field; anything else goes above the form.
      if (error.response?.status === 400 && /current|incorrect|wrong/i.test(error.message)) form.setFields([{ name: 'current', errors: [error.message] }]);
      else setProblem(error.message);
    } finally { setSaving(false); }
  }

  return (
    <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
      {problem && <Alert type="error" showIcon title={problem} role="alert" style={{ marginBottom: 16 }} />}
      <Form.Item name="current" label={forced ? 'Temporary password' : 'Current password'} rules={[{ required: true, message: forced ? 'Enter the temporary password you were given' : 'Enter your current password' }]}>
        <Input.Password autoComplete="current-password" autoFocus={forced} />
      </Form.Item>
      <Form.Item
        name="next" label="New password" extra={`${passwordHint(config.password)} Use something you do not use elsewhere.`}
        dependencies={['current']}
        rules={[
          { required: true, message: 'Choose a new password' }, ...passwordRules(config.password),
          ({ getFieldValue }) => ({ validator: (_, v) => (!v || v !== getFieldValue('current') ? Promise.resolve() : Promise.reject(new Error('Choose a password different from the current one'))) }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      {next && (
        <div style={{ margin: '-10px 0 16px' }} aria-live="polite">
          <div className="strength"><i style={{ width: `${Math.max(1, score) * 25}%`, background: COLOR[score] }} /></div>
          <Text type="secondary" style={{ fontSize: 12 }}>Password strength: {LABEL[score]}</Text>
        </div>
      )}
      <Form.Item
        name="confirm" label="Type the new password again" dependencies={['next']} validateFirst
        rules={[{ required: true, message: 'Repeat the new password' }, ({ getFieldValue }) => ({ validator: (_, v) => (!v || getFieldValue('next') === v ? Promise.resolve() : Promise.reject(new Error('The two passwords are different'))) })]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={saving} block={forced}>{forced ? 'Set my password' : 'Change password'}</Button>
    </Form>
  );
}

// Shown on its own, before anything else, when an administrator has issued a temporary password.
export function ForcedPasswordChange() {
  const { user, setUser, logout } = useAuth();
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <section className="card" style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <BrandMark size={36} />
          <h1 style={{ margin: 0, fontSize: 20 }}>Choose your own password</h1>
        </div>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} title={`Welcome, ${user.name}. Your administrator gave you a temporary password - replace it before you continue.`} />
        <PasswordForm forced onDone={() => setUser({ ...user, must_change_password: false })} />
        <Button type="link" onClick={logout} style={{ padding: 0, marginTop: 12 }}>Sign out instead</Button>
      </section>
    </main>
  );
}

export default function Account() {
  const { message } = AntApp.useApp();
  const { user, setUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const name = Form.useWatch('name', form);
  const unchanged = (name ?? user.name).trim() === user.name;

  async function saveName({ name: next }) {
    setSaving(true);
    try { const res = await authAPI.updateProfile(next.trim()); setUser({ ...user, name: res.data.user.name }); message.success('Name updated'); } catch (e) { message.error(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <section className="card" aria-labelledby="profile-h">
        <h2 className="card-title" id="profile-h" style={{ marginBottom: 12 }}>Your profile</h2>
        <Form form={form} layout="vertical" initialValues={{ name: user.name }} onFinish={saveName} requiredMark={false}>
          <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, message: 'Enter your name' }]}><Input maxLength={150} autoComplete="name" /></Form.Item>
          <Form.Item label="Email (sign-in name)"><Input value={user.email} readOnly aria-readonly="true" /></Form.Item>
          <Form.Item label="Role" extra={ROLE_HELP[user.role]}><Tag color="geekblue">{ROLE_LABELS[user.role]}</Tag></Form.Item>
          <Form.Item label="Last sign-in"><span>{user.last_login_at ? dayjs(user.last_login_at).format('DD-MMM-YYYY hh:mm A') : '-'}</span></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} disabled={unchanged}>Save name</Button>
        </Form>
      </section>
      <section className="card" aria-labelledby="password-h">
        <h2 className="card-title" id="password-h" style={{ marginBottom: 12 }}>Change password</h2>
        <PasswordForm />
        <p style={{ color: 'var(--text-3)', fontSize: 12.5, marginTop: 14 }}>Changing your password signs you out on every other device.</p>
      </section>
    </div>
  );
}
