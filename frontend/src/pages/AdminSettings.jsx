import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Alert, App as AntApp, Button, Input, InputNumber, Select, Skeleton, Switch, TimePicker } from 'antd';
import { RollbackOutlined } from '@ant-design/icons';
import { adminAPI, syncAPI } from '../services/api';
import { useAppConfig } from '../context/AppConfig';
import useLoad from '../hooks/useLoad';
import useUnsavedGuard from '../hooks/useUnsavedGuard';
import { ErrorState } from '../components/ui/ErrorState';
import '../styles/settings.css';

// Admin > Settings. The screen is drawn from the schema the server sends (label, help, type, limits, default for every setting), and the
// checks below are the same rules the server applies, so a value that passes here is accepted there. Saved settings apply at once:
// no restart. A value equal to its default is saved as "use the default" (the stored row is removed).

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

const isNumeric = def => def.type === 'int' || def.type === 'number';
const toDraft = (def, v) => {
  if (isNumeric(def)) return v === '' || v === null || v === undefined ? null : Number(v);
  if (def.type === 'bool') return v === '1';
  return String(v ?? '');
};
const toServer = (def, d) => {
  if (def.type === 'bool') return d ? '1' : '0';
  if (d === null || d === undefined) return '';
  return String(d).trim();
};
const toPayload = (def, d) => {
  if (isNumeric(def)) return Number(d);
  if (def.type === 'bool') return !!d;
  return String(d ?? '').trim();
};

function problemWith(def, d) {
  const text = toServer(def, d);
  switch (def.type) {
    case 'int':
      if (d === null || d === undefined || !Number.isInteger(d) || d < def.min || d > def.max) return `Enter a whole number from ${def.min} to ${def.max}`;
      if (def.zero_or && d !== 0 && d < def.zero_or) return `Use 0 (off) or at least ${def.zero_or}`;
      return null;
    case 'number':
      return d === null || d === undefined || !Number.isFinite(d) || d < def.min || d > def.max ? `Enter a number from ${def.min} to ${def.max}` : null;
    case 'text':
      if (def.required && !text) return 'This cannot be blank';
      return text.length > def.max_chars ? `At most ${def.max_chars} characters` : null;
    case 'date':
      return text && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !dayjs(text, 'YYYY-MM-DD', true).isValid()) ? 'Use the form YYYY-MM-DD, for example 2025-10-01 (or leave blank)' : null;
    case 'time':
      return /^([01]?\d|2[0-3]):[0-5]\d$/.test(text) ? null : 'Choose a time of day, for example 01:00';
    case 'email':
      return text && !EMAIL.test(text) ? 'That does not look like an email address' : null;
    case 'timezone': {
      try { new Intl.DateTimeFormat('en-CA', { timeZone: text }).format(); return text ? null : 'Choose a time zone'; } catch { return 'Not a known time zone name, for example Asia/Kolkata'; }
    }
    case 'filename':
      return /^[A-Za-z0-9_-]*$/.test(text) && text.length <= def.max_chars ? null : `Letters, numbers, dashes and underscores only (at most ${def.max_chars})`;
    case 'edges': {
      const nums = text.split(/[,;\s]+/).filter(Boolean).map(Number);
      if (!nums.length || nums.length > def.maxCount) return `Give between 1 and ${def.maxCount} numbers, separated by commas`;
      if (nums.some(n => !Number.isInteger(n) || n < def.min || n > def.max)) return `Whole numbers from ${def.min} to ${def.max}, separated by commas`;
      if (nums.some((n, i) => i && n <= nums[i - 1])) return 'The numbers must rise: each one larger than the one before';
      return null;
    }
    default:
      return null;
  }
}

function defaultText(def) {
  const v = def.default;
  if (def.type === 'bool') return v === '1' ? 'On' : 'Off';
  if (def.type === 'enum') return def.options.find(o => o.value === v)?.label || v;
  if (v === '') return def.type === 'date' ? 'blank (read back to the first SR)' : 'blank';
  return def.unit && isNumeric(def) ? `${v} ${def.unit}` : v;
}

const zones = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } })();

function Control({ def, value, onChange, invalid }) {
  const id = `f-${def.key}`;
  const status = invalid ? 'error' : undefined;
  switch (def.type) {
    case 'bool':
      return <Switch id={id} checked={!!value} onChange={onChange} aria-label={def.label} />;
    case 'int':
    case 'number':
      return (
        <>
          <InputNumber id={id} value={value} step={def.step || 1} onChange={v => onChange(v)} status={status} style={{ width: 150 }} />
          {def.unit && <span className="set-unit">{def.unit}</span>}
        </>
      );
    case 'enum':
      return <Select id={id} value={value} onChange={onChange} options={def.options} status={status} />;
    case 'time':
      return <TimePicker id={id} value={value ? dayjs(`2000-01-01 ${value}`) : null} format="HH:mm" allowClear={false} needConfirm={false} minuteStep={5} onChange={v => onChange(v ? v.format('HH:mm') : '')} status={status} style={{ width: 150 }} />;
    case 'timezone':
      return zones.length
        ? <Select id={id} showSearch value={value} onChange={onChange} status={status} options={[...new Set([value, ...zones])].filter(Boolean).map(z => ({ value: z, label: z }))} />
        : <Input id={id} value={value} onChange={e => onChange(e.target.value)} status={status} />;
    case 'text':
      return def.long
        ? <Input.TextArea id={id} value={value} onChange={e => onChange(e.target.value)} maxLength={def.max_chars} autoSize={{ minRows: 3, maxRows: 6 }} status={status} style={{ maxWidth: 'none' }} />
        : <Input id={id} value={value} onChange={e => onChange(e.target.value)} maxLength={def.max_chars} status={status} />;
    case 'date':
      return <Input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder="YYYY-MM-DD (blank = everything)" allowClear status={status} />;
    case 'email':
      return <Input id={id} type="email" inputMode="email" value={value} onChange={e => onChange(e.target.value)} placeholder="name@company.com" allowClear status={status} />;
    case 'edges':
      return <Input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder="for example 1,3,7,14,28" status={status} />;
    default:
      return <Input id={id} value={value} onChange={e => onChange(e.target.value)} status={status} />;
  }
}

function DeepSyncNote() {
  const { data } = useLoad(() => syncAPI.status(), []);
  const deep = data?.deep;
  if (!deep) return null;
  const at = v => dayjs(v).format('DD MMM YYYY, hh:mm A');
  const last = deep.last;
  return (
    <Alert
      type={last?.status === 'failed' ? 'warning' : 'info'} showIcon style={{ marginBottom: 16 }}
      title={deep.enabled ? `Next automatic deep sync: ${at(deep.next_run)} (server time)` : 'The daily deep sync is switched off'}
      description={last
        ? `Last deep sync: ${last.status === 'success' ? 'completed' : last.status} on ${at(last.started_at)} (${last.trigger_source === 'auto' ? 'automatic' : 'started by hand'}).`
        : 'No deep sync has run yet.'}
    />
  );
}

export default function AdminSettings({ onDirty }) {
  const { message } = AntApp.useApp();
  const { refresh: refreshConfig } = useAppConfig();
  const { data, loading, error, reload } = useLoad(() => adminAPI.settings(), []);
  const [draft, setDraft] = useState({});
  const [group, setGroup] = useState('sync');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  // (for a text the schema's `max` is its length limit; numbers use min/max as their range)
  const textDefs = useMemo(() => (data?.schema || []).map(def => (def.type === 'text' || def.type === 'filename' ? { ...def, max_chars: def.max } : def)), [data]);
  const byKey = useMemo(() => Object.fromEntries(textDefs.map(d => [d.key, d])), [textDefs]);

  useEffect(() => {
    if (!data) return;
    setDraft(Object.fromEntries(data.schema.map(def => [def.key, toDraft(def, data.settings[def.key])])));
    setErrors({});
  }, [data]);

  const saved = data?.settings || {};
  const changed = useMemo(() => textDefs.filter(def => def.key in draft && toServer(def, draft[def.key]) !== toServer(def, toDraft(def, saved[def.key]))), [textDefs, draft, saved]);
  const changedKeys = useMemo(() => new Set(changed.map(d => d.key)), [changed]);
  const dirty = changed.length > 0;
  useUnsavedGuard(dirty);
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = data?.groups || [];
  const live = useMemo(() => Object.fromEntries(textDefs.map(def => [def.key, problemWith(def, draft[def.key])])), [textDefs, draft]);
  const problems = textDefs.filter(def => changedKeys.has(def.key) && live[def.key]);

  const set = (key, value) => { setDraft(d => ({ ...d, [key]: value })); setErrors(e => (e[key] ? { ...e, [key]: undefined } : e)); };
  const resetOne = def => set(def.key, toDraft(def, def.default));
  const resetSection = defs => defs.forEach(resetOne);

  async function save() {
    if (problems.length) { setErrors(Object.fromEntries(problems.map(d => [d.key, live[d.key]]))); setGroup(problems[0].group); message.error(`Fix ${problems.length === 1 ? 'one setting' : `${problems.length} settings`} first`); return; }
    const body = {};
    for (const def of changed) body[def.key] = toServer(def, draft[def.key]) === def.default ? null : toPayload(def, draft[def.key]);
    setSaving(true);
    try {
      await adminAPI.saveSettings(body);
      message.success('Settings saved. They apply now - no restart needed.');
      refreshConfig();
      reload();
    } catch (e) {
      const field = e.response?.data?.field;
      if (field && byKey[field]) { setErrors({ [field]: e.message }); setGroup(byKey[field].group); }
      message.error(e.message);
    } finally { setSaving(false); }
  }

  if (error && !data) return <ErrorState title="Could not load the settings" message={error} onRetry={reload} />;
  if (!data) return <Skeleton active paragraph={{ rows: 8 }} />;

  const inGroup = textDefs.filter(d => d.group === group);
  const sections = [...new Set(inGroup.map(d => d.section))];
  const groupInfo = groups.find(g => g.id === group);

  return (
    <section className="card" style={{ maxWidth: 980 }}>
      <p style={{ marginTop: 0, color: 'var(--text-2)' }}>
        Everything here can be changed without a restart. Each setting shows the value it has by default; <b>Reset to default</b> puts it back. Backups are set on the Backups tab, and the ManageEngine and email connections on the Connections tab.
      </p>

      <div className="set-groups" role="tablist" aria-label="Settings groups">
        {groups.map(g => {
          const n = changed.filter(d => d.group === g.id).length;
          return (
            <Button key={g.id} role="tab" aria-selected={group === g.id} type={group === g.id ? 'primary' : 'default'} onClick={() => setGroup(g.id)}>
              {g.title}{n > 0 && <span className="set-count" aria-label={`${n} unsaved`}>{n}</span>}
            </Button>
          );
        })}
      </div>
      {groupInfo?.help && <p style={{ color: 'var(--text-2)', marginTop: -4 }}>{groupInfo.help}</p>}
      {group === 'sync' && <DeepSyncNote />}

      {sections.map(section => {
        const defs = inGroup.filter(d => d.section === section);
        const atDefault = defs.every(d => toServer(d, draft[d.key]) === d.default);
        return (
          <div className="set-section" key={section}>
            <div className="set-section-head">
              <h3>{section}</h3>
              <Button size="small" icon={<RollbackOutlined />} disabled={atDefault} onClick={() => resetSection(defs)}>Reset section to defaults</Button>
            </div>
            {defs.map(def => {
              const value = draft[def.key];
              const error = errors[def.key] || (changedKeys.has(def.key) ? live[def.key] : null);
              const isDefault = toServer(def, value) === def.default;
              return (
                <div className={`set-row${changedKeys.has(def.key) ? ' dirty' : ''}${error ? ' has-error' : ''}`} key={def.key} id={`set-${def.key}`}>
                  <div className="set-text">
                    <label htmlFor={`f-${def.key}`}>{def.label}</label>
                    {def.help && <div className="set-help">{def.help}</div>}
                    <div className="set-default">
                      <span>Default: <b>{defaultText(def)}</b>{def.from_env ? ` (taken from ${def.from_env} in backend/.env)` : ''}</span>
                      <button type="button" disabled={isDefault} onClick={() => resetOne(def)} aria-label={`Reset ${def.label} to its default`}>Reset to default</button>
                    </div>
                    {error && <div className="set-error" role="alert">{error}</div>}
                  </div>
                  <div className="set-control"><Control def={def} value={value} onChange={v => set(def.key, v)} invalid={!!error} /></div>
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="set-savebar">
        <span className="grow" aria-live="polite">
          {dirty ? <b>{changed.length} unsaved change{changed.length === 1 ? '' : 's'}</b> : <span style={{ color: 'var(--text-3)' }}>No unsaved changes</span>}
          {problems.length > 0 && <span style={{ color: '#b42318', marginLeft: 10 }}>{problems.length} to fix</span>}
        </span>
        {dirty && <Button onClick={() => { reload(); }}>Discard changes</Button>}
        <Button type="primary" onClick={save} loading={saving} disabled={!dirty}>Save settings</Button>
      </div>
    </section>
  );
}
