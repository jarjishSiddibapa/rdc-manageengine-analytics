import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Result } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircleFilled, LockOutlined, MailOutlined } from '@ant-design/icons';
import { authAPI } from '../services/api';
import { passwordHint, passwordRules, useAppConfig } from '../context/AppConfig';
import AuthFrame from '../components/ui/AuthFrame';
import { LoadingNotice } from '../components/ui/LoadingNotice';

// Step 1: ask for a link. The answer is always the same, so nobody can find out which addresses have an account.
export function ForgotPassword() {
  const { config } = useAppConfig();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const [problem, setProblem] = useState(null);

  useEffect(() => { document.title = `Forgot your password? · ${config.app_name}`; }, [config.app_name]);

  async function submit({ email }) {
    setLoading(true);
    setProblem(null);
    try {
      await authAPI.forgotPassword(email.trim());
      setSentTo(email.trim());
    } catch (error) {
      setProblem(error.message || 'Could not send the link');
    } finally {
      setLoading(false);
    }
  }

  if (sentTo) {
    return (
      <AuthFrame>
        <h1>Check your email</h1>
        <p className="lead">If <b>{sentTo}</b> belongs to an account, we have sent a link to choose a new password. It can take a minute to arrive; look in the spam folder too.</p>
        <Alert type="info" showIcon role="status" message="The link works once and expires soon." style={{ marginBottom: 20 }} />
        <Button type="primary" size="large" block onClick={() => setSentTo(null)}>Use another address</Button>
        <p style={{ marginTop: 18, textAlign: 'center' }}><Link to="/">Back to sign in</Link></p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <h1>Forgot your password?</h1>
      <p className="lead">Enter the email address of your account and we will send you a link to choose a new password.</p>
      {problem && <Alert type="error" showIcon role="alert" message={problem} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Enter your email' }, { type: 'email', message: 'That does not look like an email address' }]} validateTrigger="onBlur">
          <Input size="large" type="email" inputMode="email" prefix={<MailOutlined style={{ color: 'var(--text-3)' }} />} autoComplete="username" autoFocus autoCapitalize="none" spellCheck={false} placeholder="you@company.com" />
        </Form.Item>
        <Button type="primary" htmlType="submit" size="large" block loading={loading}>Send me a link</Button>
      </Form>
      <p style={{ marginTop: 18, textAlign: 'center' }}><Link to="/">Back to sign in</Link></p>
    </AuthFrame>
  );
}

// Step 2: the page the emailed link opens.
export function ResetPassword() {
  const { config } = useAppConfig();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const token = useRef(new URLSearchParams(window.location.search).get('token') || '').current;
  const [state, setState] = useState('checking'); // checking | ready | invalid | done
  const [account, setAccount] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState(null);

  useEffect(() => { document.title = `Choose a new password · ${config.app_name}`; }, [config.app_name]);

  // The token is read once, then taken out of the address bar so it does not stay in the history.
  useEffect(() => {
    try { window.history.replaceState(null, '', '/reset-password'); } catch { /* not important */ }
    let cancelled = false;
    if (!token) { setState('invalid'); setMessage('This page needs the link from your email.'); return undefined; }
    authAPI.checkReset(token)
      .then(({ data }) => { if (!cancelled) { setAccount(data); setState('ready'); } })
      .catch(error => { if (!cancelled) { setMessage(error.message); setState('invalid'); } });
    return () => { cancelled = true; };
  }, [token]);

  async function submit({ password }) {
    setLoading(true);
    setProblem(null);
    try {
      await authAPI.resetPassword(token, password);
      setState('done');
    } catch (error) {
      if (error.response?.status === 400 && /not valid any more/i.test(error.message)) { setMessage(error.message); setState('invalid'); } else setProblem(error.message || 'Could not change the password');
    } finally {
      setLoading(false);
    }
  }

  if (state === 'checking') return <AuthFrame><LoadingNotice label="Checking your link..." /></AuthFrame>;

  if (state === 'invalid') {
    return (
      <AuthFrame>
        <h1>This link cannot be used</h1>
        <p className="lead">{message || 'It has expired or was already used.'}</p>
        {config.password_reset
          ? <Button type="primary" size="large" block onClick={() => navigate('/forgot-password', { replace: true })}>Send me a new link</Button>
          : <p>Ask an administrator to reset your password.</p>}
        <p style={{ marginTop: 18, textAlign: 'center' }}><Link to="/">Back to sign in</Link></p>
      </AuthFrame>
    );
  }

  if (state === 'done') {
    return (
      <AuthFrame>
        <Result style={{ padding: '8px 0' }} icon={<CheckCircleFilled style={{ color: '#16a34a' }} />} title="Password changed"
          subTitle="You were signed out on every device. Sign in with your new password."
          extra={<Button type="primary" size="large" onClick={() => { window.location.assign('/'); }}>Go to sign in</Button>} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <h1>Choose a new password</h1>
      <p className="lead">For <b>{account?.email}</b>. {passwordHint(config.password)}</p>
      {problem && <Alert type="error" showIcon role="alert" message={problem} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false} autoComplete="off">
        <Form.Item name="password" label="New password" rules={[{ required: true, message: 'Choose a new password' }, ...passwordRules(config.password)]}>
          <Input.Password size="large" prefix={<LockOutlined style={{ color: 'var(--text-3)' }} />} autoComplete="new-password" autoFocus placeholder="New password" />
        </Form.Item>
        <Form.Item name="confirm" label="Repeat the new password" dependencies={['password']} rules={[
          { required: true, message: 'Repeat the new password' },
          ({ getFieldValue }) => ({ validator: (_, v) => (!v || getFieldValue('password') === v ? Promise.resolve() : Promise.reject(new Error('The two passwords are not the same'))) }),
        ]}>
          <Input.Password size="large" prefix={<LockOutlined style={{ color: 'var(--text-3)' }} />} autoComplete="new-password" placeholder="Repeat it" />
        </Form.Item>
        <Button type="primary" htmlType="submit" size="large" block loading={loading}>Change password</Button>
      </Form>
    </AuthFrame>
  );
}
