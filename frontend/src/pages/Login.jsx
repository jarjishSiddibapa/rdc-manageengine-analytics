import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input } from 'antd';
import { Link } from 'react-router-dom';
import { ExclamationCircleOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../context/Auth';
import { useAppConfig } from '../context/AppConfig';
import AuthFrame from '../components/ui/AuthFrame';

const EMAIL_KEY = 'mea.email';
const readEmail = () => { try { return localStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; } };
const saveEmail = value => { try { if (value) localStorage.setItem(EMAIL_KEY, value); else localStorage.removeItem(EMAIL_KEY); } catch { /* not remembered in a private window */ } };

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const capital = text => text.charAt(0).toUpperCase() + text.slice(1);

// "Too many wrong passwords. Try again in 14 minutes." -> 14
const lockMinutes = error => (error?.response?.status === 429 ? Number(/(\d+)\s*minute/i.exec(error.message)?.[1]) || 15 : 0);
const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export default function Login() {
  const { login, expired } = useAuth();
  const { config } = useAppConfig();
  const [form] = Form.useForm();
  const remembered = useRef(readEmail()).current;
  const [problem, setProblem] = useState(null); // { type, text }
  const [loading, setLoading] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const remaining = lockedUntil - now;
  const locked = remaining > 0;

  useEffect(() => { document.title = `Sign in · ${config.app_name}`; }, [config.app_name]);

  useEffect(() => {
    if (!locked) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [locked]);

  async function submit({ email, password, remember }) {
    if (locked || loading) return;
    setLoading(true);
    setProblem(null);
    try {
      await login(email.trim(), password);
      saveEmail(remember ? email.trim() : '');
    } catch (error) {
      const minutes = lockMinutes(error);
      if (minutes) {
        setNow(Date.now());
        setLockedUntil(Date.now() + minutes * 60000);
        setProblem({ type: 'warning', text: `Too many wrong passwords, so sign-in is paused for ${minutes} minute${minutes === 1 ? '' : 's'}. You can try again then, or ask an administrator to reset your password.` });
      } else if (error.network) {
        setProblem({ type: 'error', text: error.message });
      } else {
        setProblem({ type: 'error', text: error.message || 'Could not sign in' });
        form.setFieldValue('password', '');
        setTimeout(() => document.getElementById('password')?.focus(), 0);
      }
      setLoading(false);
    }
  }

  const trackCaps = e => { if (e.getModifierState) setCapsLock(e.getModifierState('CapsLock')); };

  return (
    <AuthFrame>
          <h1>Sign in</h1>
          <p className="lead">Use the account your administrator created for you.</p>
          {expired && !problem && <Alert type="info" showIcon role="status" message="You were signed out" description="Your session ended. Sign in again and you will return to the page you were on." style={{ marginBottom: 16 }} />}
          {problem && <Alert type={problem.type} showIcon role="alert" message={problem.text} style={{ marginBottom: 16 }} />}
          <Form form={form} layout="vertical" onFinish={submit} requiredMark={false} autoComplete="on" initialValues={{ email: remembered, remember: !!remembered }} >
            <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Enter your email' }, { type: 'email', message: 'That does not look like an email address' }]} validateTrigger="onBlur">
              <Input
                size="large" type="email" inputMode="email" prefix={<UserOutlined style={{ color: 'var(--text-3)' }} />}
                autoComplete="username" autoFocus={!remembered} autoCapitalize="none" spellCheck={false} placeholder="you@company.com"
              />
            </Form.Item>
            <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter your password' }]}>
              <Input.Password
                size="large" prefix={<LockOutlined style={{ color: 'var(--text-3)' }} />} autoComplete="current-password"
                autoFocus={!!remembered} placeholder="Your password" onKeyDown={trackCaps} onKeyUp={trackCaps} onBlur={() => setCapsLock(false)}
              />
            </Form.Item>
            {capsLock && <div className="hint" role="status"><ExclamationCircleOutlined />Caps Lock is on - passwords are case-sensitive.</div>}
            <div className="login-row">
              <Form.Item name="remember" valuePropName="checked" noStyle><Checkbox>Remember my email on this device</Checkbox></Form.Item>
              {config.password_reset && <Link to="/forgot-password" style={{ fontSize: 13.5, whiteSpace: 'nowrap' }}>Forgot your password?</Link>}
            </div>
            <Button type="primary" htmlType="submit" size="large" block loading={loading} disabled={locked}>
              {locked ? `Try again in ${clock(remaining)}` : 'Sign in'}
            </Button>
          </Form>
          <p style={{ color: 'var(--text-3)', fontSize: 12.5, marginTop: 22, lineHeight: 1.5 }}>
            {config.password_reset ? 'Cannot reset it yourself? Ask an administrator' : 'Forgotten your password? Ask an administrator to reset it'}{config.support_email ? <>, or write to <a href={`mailto:${config.support_email}`}>{config.support_email}</a></> : ''}.
            {' '}{capital(WORDS[config.lockout.attempts] || String(config.lockout.attempts))} wrong passwords pause sign-in for {config.lockout.minutes} minutes.
          </p>
    </AuthFrame>
  );
}
