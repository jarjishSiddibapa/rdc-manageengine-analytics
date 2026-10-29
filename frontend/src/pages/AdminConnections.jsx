import { useEffect, useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Input, Select, Skeleton, Tag } from 'antd';
import { ApiOutlined, CheckCircleFilled, CloseCircleFilled, LockOutlined, MailOutlined } from '@ant-design/icons';
import { adminAPI } from '../services/api';
import { useAuth } from '../context/Auth';
import useLoad from '../hooks/useLoad';
import useUnsavedGuard from '../hooks/useUnsavedGuard';
import { ErrorState } from '../components/ui/ErrorState';
import '../styles/settings.css';

// Admin > Connections: the ManageEngine connection and the outgoing-email (SMTP) account.
//   - A value saved here overrides backend/.env; a field left blank falls back to the .env value, so an install set up only through
//     .env keeps working untouched.
//   - Secrets are stored encrypted in the database and are never sent back to this screen: a secret field only says "saved", and typing
//     in it replaces the saved value.
//   - "Test connection" tries the details as they are typed (saved or not) without storing anything.
const SOURCE_TAG = {
  db: <Tag color="green">Saved here</Tag>,
  env: <Tag color="blue">From backend/.env</Tag>,
  default: <Tag>Built-in default</Tag>,
  none: <Tag color="orange">Not set</Tag>,
};

const SECURE_OPTIONS = [{ value: '', label: 'Automatic (SSL on port 465, otherwise STARTTLS)' }, { value: '1', label: 'SSL (secure from the start)' }, { value: '0', label: 'STARTTLS / none' }];
const ORDER = {
  manageengine: ['me_accounts_url', 'me_api_domain', 'me_portal', 'me_client_id', 'me_client_secret', 'me_refresh_token'],
  smtp: ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from_name', 'smtp_from_address'],
};

function Field({ field, value, onChange, secretText, onSecret, clear, onClear, error }) {
  const id = `c-${field.key}`;
  let control;
  if (field.secret) {
    control = (
      <Input.Password
        id={id} value={secretText} onChange={e => onSecret(e.target.value)} autoComplete="new-password" status={error ? 'error' : undefined}
        placeholder={clear ? 'Will be removed when you save' : field.set ? 'Saved (type to replace it)' : 'Not set'} prefix={<LockOutlined style={{ color: 'var(--text-3)' }} />}
        disabled={clear}
      />
    );
  } else if (field.type === 'secure') {
    control = <Select id={id} value={value} onChange={onChange} options={SECURE_OPTIONS} />;
  } else {
    control = <Input id={id} value={value} onChange={e => onChange(e.target.value)} status={error ? 'error' : undefined} autoComplete="off" spellCheck={false} placeholder={field.default || undefined} />;
  }
  return (
    <div className={`set-row${error ? ' has-error' : ''}`} id={`conn-${field.key}`}>
      <div className="set-text">
        <label htmlFor={id}>{field.label}</label>
        {field.help && <div className="set-help">{field.help}</div>}
        <div className="set-default">
          {SOURCE_TAG[field.source] || null}
          {field.secret && field.unreadable && <Tag color="red">Saved value cannot be read (key file changed): enter it again</Tag>}
          {field.source === 'db' && !field.secret && <button type="button" onClick={onClear}>Use the .env value instead</button>}
          {field.source === 'db' && field.secret && !clear && <button type="button" onClick={onClear}>Remove saved value</button>}
          {field.secret && clear && <button type="button" onClick={onClear}>Keep it</button>}
        </div>
        {error && <div className="set-error" role="alert">{error}</div>}
      </div>
      <div className="set-control">{control}</div>
    </div>
  );
}

function Card({ kind, title, icon, intro, fields, drafts, setDrafts, secrets, setSecrets, clears, setClears, errors, onSave, saving, children }) {
  const dirtyKeys = fields.filter(f => (f.secret ? secrets[f.key] || clears[f.key] : drafts[f.key] !== f.value));
  return (
    <section className="card" aria-labelledby={`conn-${kind}`}>
      <header className="card-head">
        <div><h3 className="card-title" id={`conn-${kind}`}>{icon} {title}</h3><div className="card-sub">{intro}</div></div>
      </header>
      {fields.map(f => (
        <Field
          key={f.key} field={f} value={drafts[f.key] ?? ''} onChange={v => setDrafts(d => ({ ...d, [f.key]: v }))}
          secretText={secrets[f.key] || ''} onSecret={v => setSecrets(s => ({ ...s, [f.key]: v }))}
          clear={!!clears[f.key]} onClear={() => (f.secret
            ? setClears(c => ({ ...c, [f.key]: !c[f.key] }))
            : setDrafts(d => ({ ...d, [f.key]: '' })))}
          error={errors[f.key]}
        />
      ))}
      <div className="conn-actions">
        <Button type="primary" onClick={onSave} loading={saving} disabled={!dirtyKeys.length}>Save {title}</Button>
        {children}
        {dirtyKeys.length > 0 && <span style={{ color: '#7a4b00' }}>{dirtyKeys.length} unsaved change{dirtyKeys.length === 1 ? '' : 's'}</span>}
      </div>
    </section>
  );
}

function Result({ result }) {
  if (!result) return null;
  return (
    <Alert
      className="conn-result" role="status" showIcon type={result.ok ? 'success' : 'error'}
      icon={result.ok ? <CheckCircleFilled /> : <CloseCircleFilled />} title={result.ok ? 'It works' : 'It did not work'} description={result.message}
    />
  );
}

export default function AdminConnections({ onDirty }) {
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const { data, loading, error, reload } = useLoad(() => adminAPI.connections(), []);
  const [drafts, setDrafts] = useState({});
  const [secrets, setSecrets] = useState({});
  const [clears, setClears] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState('');
  const [testing, setTesting] = useState('');
  const [results, setResults] = useState({});
  const [mailTo, setMailTo] = useState('');

  const fields = useMemo(() => (data ? Object.values(data.fields) : []), [data]);
  const byKey = useMemo(() => Object.fromEntries(fields.map(f => [f.key, f])), [fields]);

  useEffect(() => {
    if (!data) return;
    setDrafts(Object.fromEntries(Object.values(data.fields).filter(f => !f.secret).map(f => [f.key, f.value ?? ''])));
    setSecrets({}); setClears({}); setErrors({});
  }, [data]);
  useEffect(() => { setMailTo(m => m || user?.email || ''); }, [user]);

  const dirty = fields.some(f => (f.secret ? secrets[f.key] || clears[f.key] : drafts[f.key] !== f.value));
  useUnsavedGuard(dirty);
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // What changed in one card, in the shape the server wants.
  const changesOf = group => {
    const out = {};
    for (const key of ORDER[group]) {
      const f = byKey[key];
      if (!f) continue;
      if (f.secret) {
        if (clears[key]) out[key] = null;
        else if (secrets[key]) out[key] = secrets[key];
      } else if (drafts[key] !== f.value) out[key] = drafts[key];
    }
    return out;
  };

  async function save(group, label) {
    const values = changesOf(group);
    if (!Object.keys(values).length) return;
    setSaving(group); setErrors({});
    try {
      await adminAPI.saveConnections(values);
      message.success(`${label} saved. It is used from now on - no restart needed.`);
      setResults(r => ({ ...r, [group]: null }));
      reload();
    } catch (e) {
      const field = e.response?.data?.field;
      if (field) setErrors({ [field]: e.message });
      message.error(e.message);
    } finally { setSaving(''); }
  }

  async function test(group, send = false) {
    setTesting(`${group}${send ? ':send' : ''}`);
    setResults(r => ({ ...r, [group]: null }));
    try {
      const values = changesOf(group);
      const res = group === 'manageengine' ? await adminAPI.testManageEngine(values) : await adminAPI.testSmtp(values, send, send ? mailTo : undefined);
      setResults(r => ({ ...r, [group]: res.data }));
    } catch (e) {
      setResults(r => ({ ...r, [group]: { ok: false, message: e.message } }));
    } finally { setTesting(''); }
  }

  if (error && !data) return <ErrorState title="Could not load the connections" message={error} onRetry={reload} />;
  if (!data) return <Skeleton active paragraph={{ rows: 8 }} />;

  const of = group => ORDER[group].map(key => byKey[key]).filter(Boolean);
  const common = { drafts, setDrafts, secrets, setSecrets, clears, setClears, errors };

  return (
    <div className="conn-grid">
      <Alert
        type="info" showIcon title="Values saved here win over backend/.env"
        description={<>Leave a field blank to use the <code>.env</code> value (shown with a blue tag). Secrets are stored <b>encrypted</b> in the database with a key kept in <code>backend\.secret</code> on this PC, and are never shown again. Changes apply immediately.</>}
      />

      <Card
        kind="manageengine" title="ManageEngine connection" icon={<ApiOutlined />} fields={of('manageengine')} {...common}
        intro="The app only ever reads from ManageEngine (scope SDPOnDemand.requests.READ)." saving={saving === 'manageengine'} onSave={() => save('manageengine', 'ManageEngine connection')}
      >
        <Button onClick={() => test('manageengine')} loading={testing === 'manageengine'}>Test connection</Button>
        <Tag color={data.manageengine_ready ? 'green' : 'orange'}>{data.manageengine_ready ? 'Configured' : `Missing: ${data.manageengine_missing.join(', ')}`}</Tag>
        <div style={{ flexBasis: '100%' }}><Result result={results.manageengine} /></div>
      </Card>

      <Card
        kind="smtp" title="Email (SMTP)" icon={<MailOutlined />} fields={of('smtp')} {...common}
        intro="Used for emailed database backups, failure alerts and test messages. Optional." saving={saving === 'smtp'} onSave={() => save('smtp', 'Email settings')}
      >
        <Button onClick={() => test('smtp')} loading={testing === 'smtp'}>Test connection</Button>
        <Input value={mailTo} onChange={e => setMailTo(e.target.value)} placeholder="send the test to..." aria-label="Send a test email to" style={{ width: 240, maxWidth: '100%' }} inputMode="email" />
        <Button onClick={() => test('smtp', true)} loading={testing === 'smtp:send'}>Send a test email</Button>
        <Tag color={data.mail_ready ? 'green' : 'default'}>{data.mail_ready ? 'Configured' : 'Not set up'}</Tag>
        <div style={{ flexBasis: '100%' }}><Result result={results.smtp} /></div>
      </Card>
    </div>
  );
}
