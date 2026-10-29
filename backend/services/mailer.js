const nodemailer = require('nodemailer');
const settings = require('./settings');
const connections = require('./connections');

// Outgoing email (database backups, test messages, failure alerts). It is optional: with no mail details (Admin -> Connections, or the
// SMTP_* lines in backend\.env) the app works exactly the same and the backup screen says email is not set up.
// The details are read at the moment of sending, so a change on the Admin screen applies to the very next email.
const BRAND = '#0e7c86';
const appName = () => settings.str('app_name') || 'ManageEngine Analytics';

let transporter = null;
let transporterKey = null;

const config = (overrides = {}) => connections.smtp(overrides, appName());

function isConfigured() {
  const c = config();
  return Boolean(c.user && c.pass);
}

const NOT_SET_UP = 'Email is not set up. Add the mail server, user name and password under Admin > Connections (or SMTP_USER and SMTP_PASS in backend\\.env).';

function buildTransporter(c) {
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 120000, // a backup attachment can take a while to upload
  });
}

function getTransporter() {
  const c = config();
  if (!c.user || !c.pass) throw new Error(NOT_SET_UP);
  const key = JSON.stringify([c.host, c.port, c.secure, c.user, c.pass]);
  if (!transporter || transporterKey !== key) {
    try { transporter?.close?.(); } catch { /* an old connection pool being dropped */ }
    transporter = buildTransporter(c);
    transporterKey = key;
  }
  return transporter;
}

const fromAddress = () => config().from;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function layout(bodyHtml) {
  return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #14233a;">
      <div style="background: ${BRAND}; padding: 18px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="color: #fff; margin: 0; font-size: 18px;">${escapeHtml(appName())}</h2>
      </div>
      <div style="border: 1px solid #dde3ea; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">${bodyHtml}</div>
    </div>`;
}

const row = (label, value, mono) => `
  <tr><td style="padding: 6px 0; color: #5b6b80; font-size: 13px; width: 38%;">${escapeHtml(label)}</td>
  <td style="padding: 6px 0; font-weight: 600;${mono ? ' font-family: monospace;' : ''}">${escapeHtml(value)}</td></tr>`;

async function verifyMailer() {
  if (!isConfigured()) {
    console.log('Email is not set up (Admin > Connections, or SMTP_USER / SMTP_PASS in backend\\.env): emailed backups are unavailable.');
    return { ok: false, message: 'Not set up' };
  }
  try {
    await getTransporter().verify();
    console.log(`Mailer ready: ${config().user}`);
    return { ok: true };
  } catch (error) {
    console.warn('Mailer not ready (emails will fail):', error.message);
    return { ok: false, message: error.message };
  }
}

async function sendMail(message) {
  return getTransporter().sendMail({ from: fromAddress(), ...message });
}

const TRIGGER_LABEL = {
  schedule: 'the daily automatic schedule',
  catchup: 'the automatic schedule (a catch-up, because the app was not running at the scheduled time)',
  manual: 'a manual "Run backup now"',
};

// `to` is a comma-separated list. attachmentPath may be null: when the dump is too large to email, the message says so instead.
async function sendBackupEmail({ to, filename, sizeBytes, triggeredBy, attachmentPath, attachmentName, note }) {
  await sendMail({
    to,
    subject: `Database backup - ${filename}`,
    html: layout(`
      <p>A fresh database backup was just taken by ${escapeHtml(TRIGGER_LABEL[triggeredBy] || triggeredBy)}${attachmentPath ? ' and is attached to this email as an offsite copy' : ''}.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        ${row('File', filename, true)}
        ${row('Size', formatBytes(sizeBytes))}
      </table>
      ${note ? `<p style="background: #fff7e6; border: 1px solid #ffd591; padding: 10px 12px; border-radius: 6px; font-size: 13px;">${escapeHtml(note)}</p>` : ''}
      <p style="font-size: 13px; color: #5b6b80;">It is a complete MySQL dump. To restore it on any MySQL server${attachmentName && attachmentName.endsWith('.gz') ? ' (unzip the .gz file first)' : ''}:
      <code>mysql -u root -p &lt; ${escapeHtml(filename)}</code>. These emails are managed under Admin &rarr; Backups.</p>`),
    attachments: attachmentPath ? [{ filename: attachmentName || filename, path: attachmentPath }] : [],
  });
}

async function sendBackupFailedEmail({ to, triggeredBy, message }) {
  await sendMail({
    to,
    subject: `Database backup FAILED - ${appName()}`,
    html: layout(`
      <p style="color: #cf1322; font-weight: 600;">A database backup did not complete.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        ${row('Started by', TRIGGER_LABEL[triggeredBy] || triggeredBy)}
        ${row('Reason', String(message || 'Unknown error').slice(0, 600))}
      </table>
      <p style="font-size: 13px; color: #5b6b80;">Open Admin &rarr; Backups to see the history and run a backup by hand once the cause is fixed.</p>`),
  });
}

const greeting = name => `<p>Hello${name ? ` ${escapeHtml(String(name).split(' ')[0])}` : ''},</p>`;

async function sendPasswordResetEmail({ to, name, url, minutes }) {
  await sendMail({
    to,
    subject: `Reset your password - ${appName()}`,
    html: layout(`
      ${greeting(name)}
      <p>Someone asked to reset the password for this account. If that was you, choose a new password with the button below. The link works once and expires in ${escapeHtml(minutes)} minutes.</p>
      <p style="margin: 22px 0;"><a href="${escapeHtml(url)}" style="background: ${BRAND}; color: #fff; text-decoration: none; padding: 12px 26px; border-radius: 6px; font-weight: 600; display: inline-block;">Choose a new password</a></p>
      <p style="font-size: 12px; color: #5b6b80; word-break: break-all;">Or copy this address into your browser: ${escapeHtml(url)}</p>
      <p style="font-size: 13px; color: #5b6b80;">If you did not ask for this, ignore this email: your password stays as it is.</p>`),
    text: `Choose a new password for ${appName()}: ${url}\nThe link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this email.`,
  });
}

async function sendPasswordChangedEmail({ to, name, when }) {
  await sendMail({
    to,
    subject: `Your password was changed - ${appName()}`,
    html: layout(`
      ${greeting(name)}
      <p>The password for this account was just changed using a reset link (${escapeHtml(when)}). You were signed out everywhere.</p>
      <p style="font-size: 13px; color: #5b6b80;">If this was not you, ask an administrator to disable the account and reset it.</p>`),
  });
}

async function sendTestEmail({ to, sentBy }) {
  await sendMail({
    to,
    subject: `Test email - ${appName()}`,
    html: layout(`
      <p>This is a test message from ${escapeHtml(appName())}${sentBy ? `, sent by ${escapeHtml(sentBy)}` : ''}.</p>
      <p style="font-size: 13px; color: #5b6b80;">If you can read this, emailed backups will reach this address.</p>`),
  });
}

// Admin -> Connections "Test": checks the given details (saved ones where a field is left out) by logging in to the mail server,
// and optionally sends a short message. Never throws; resolves to { ok, message }.
async function testConnection(overrides = {}, { to = null, sentBy = null } = {}) {
  const c = config(overrides);
  if (!c.user || !c.pass) return { ok: false, message: 'Not complete yet. Enter the user name and password (or set SMTP_USER and SMTP_PASS in backend\\.env).' };
  const probe = buildTransporter(c);
  try {
    await probe.verify();
    if (to) {
      await probe.sendMail({ from: c.from, to, subject: `Test email - ${appName()}`, html: layout(`<p>This is a test message from ${escapeHtml(appName())}${sentBy ? `, sent by ${escapeHtml(sentBy)}` : ''}.</p><p style="font-size: 13px; color: #5b6b80;">If you can read this, the email connection works.</p>`) });
    }
    return { ok: true, message: to ? `Connected, and a test email was sent to ${to}.` : `Connected to ${c.host}:${c.port} and signed in as ${c.user}.` };
  } catch (error) {
    return { ok: false, message: `The mail server did not accept this: ${String(error.message).slice(0, 250)}` };
  } finally {
    try { probe.close?.(); } catch { /* nothing to close */ }
  }
}

module.exports = { testConnection, isConfigured, verifyMailer, sendMail, sendBackupEmail, sendBackupFailedEmail, sendPasswordResetEmail, sendPasswordChangedEmail, sendTestEmail, escapeHtml, formatBytes, layout };
