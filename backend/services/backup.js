const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const cron = require('node-cron');
const { pool, DB_NAME } = require('../db/pool');
const settingsService = require('./settings');
const mailer = require('./mailer');

// Database backups, done the same way as the other RDC apps: a daily `mysqldump` of the whole database into one .sql file in
// backend\db-backup (restorable on any MySQL server with `mysql -u root -p < file.sql`), with an optional copy emailed offsite.
// Added here: a catch-up run when the PC was off at the scheduled time, a rolling "keep the newest N", a check that every dump
// finished, and a failure alert email.
const BACKUP_DIR = path.join(__dirname, '..', 'db-backup');
const FILE_PREFIX = 'manageengine-analytics-';
const SAFE_FILENAME = /^manageengine-analytics-\d{8}-\d{6}\.sql$/;
const LOCK_NAME = `${DB_NAME}:backup`;

fs.mkdirSync(BACKUP_DIR, { recursive: true });

let dailyTask = null;
let catchUpTask = null;
let current = null; // { id, filename, startedAt } while a dump is being made by this copy of the app

// ── mysqldump ──
let dumpPath;
function findMysqldump() {
  if (dumpPath !== undefined) return dumpPath;
  dumpPath = null;
  const configured = process.env.MYSQLDUMP_PATH;
  if (configured) {
    if (fs.existsSync(configured)) return (dumpPath = configured);
    console.warn(`MYSQLDUMP_PATH is "${configured}" but that file does not exist; looking for mysqldump automatically.`);
  }
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(Boolean)) {
      for (const vendor of ['MySQL', 'MariaDB']) {
        const root = path.join(base, vendor);
        if (!fs.existsSync(root)) continue;
        // Newest installed version first, so an upgrade is picked up without any setting.
        const folders = fs.readdirSync(root).filter(d => /^(MySQL Server|MariaDB)/i.test(d)).sort().reverse();
        for (const folder of folders) {
          const candidate = path.join(root, folder, 'bin', 'mysqldump.exe');
          if (fs.existsSync(candidate)) return (dumpPath = candidate);
        }
      }
    }
  }
  const probe = spawnSync('mysqldump', ['--version'], { windowsHide: true });
  if (!probe.error && probe.status === 0) dumpPath = 'mysqldump';
  return dumpPath;
}

function timestamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// A complete dump ends with this line; a dump cut short (disk full, killed server) does not.
function dumpFinished(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, 512);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8').includes('-- Dump completed');
  } finally {
    fs.closeSync(fd);
  }
}

async function dumpDatabase(file) {
  const bin = findMysqldump();
  if (!bin) {
    throw new Error('mysqldump was not found on this PC. Install MySQL Server tools, or set MYSQLDUMP_PATH in backend\\.env to the full path of mysqldump.exe.');
  }
  const args = [
    '-h', process.env.DB_HOST || 'localhost',
    '-P', String(process.env.DB_PORT || 3306),
    '-u', process.env.DB_USER || 'root',
    '--single-transaction', // a consistent snapshot without locking the app while it runs
    '--routines', '--triggers',
    '--default-character-set=utf8mb4',
    // Without this the dump carries GTID statements that fail when restored on any other MySQL server.
    '--set-gtid-purged=OFF',
    // Signed-in session tokens are temporary and should not sit in a file that gets emailed; the table is recreated on start-up.
    `--ignore-table=${DB_NAME}.sessions`,
    `--ignore-table=${DB_NAME}.password_resets`,
    '--databases', DB_NAME,
  ];
  const partial = `${file}.partial`;
  const child = spawn(bin, args, { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' }, windowsHide: true });
  const out = fs.createWriteStream(partial);
  let stderr = '';
  child.stderr.on('data', chunk => { if (stderr.length < 4000) stderr += chunk.toString(); });
  const exited = new Promise((resolve, reject) => {
    child.on('error', error => reject(error.code === 'ENOENT' ? new Error(`Could not start mysqldump at "${bin}". Set MYSQLDUMP_PATH in backend\\.env.`) : error));
    child.on('close', resolve);
  });
  try {
    const [code] = await Promise.all([exited, pipeline(child.stdout, out)]);
    // mysqldump prints warnings such as the "password on the command line" notice; only a non-zero exit is a failure.
    if (code !== 0) throw new Error(stderr.replace(/\s+/g, ' ').trim().slice(0, 800) || `mysqldump stopped with exit code ${code}`);
    if (!dumpFinished(partial)) throw new Error('The dump file is incomplete (it does not end with the expected line). It was discarded.');
    fs.renameSync(partial, file);
    return fs.statSync(file).size;
  } catch (error) {
    out.destroy();
    fs.rm(partial, { force: true }, () => {});
    throw error;
  }
}

// ── Email ──
async function emailIfEnabled({ filename, file, size, triggeredBy }) {
  const settings = await settingsService.getAll();
  if (settings.backup_email_enabled !== '1') return null;
  const { valid } = settingsService.parseEmailList(settings.backup_email_recipients);
  if (!valid.length) return { status: 'failed', message: 'Email is on but there is no valid recipient.' };
  if (!mailer.isConfigured()) return { status: 'failed', message: 'Email is not set up (enter the mail account under Admin > Connections).' };

  let zipped = null;
  try {
    // Dumps compress to a fraction of their size, which is what gets attached.
    zipped = path.join(os.tmpdir(), `${filename}.gz`);
    await pipeline(fs.createReadStream(file), zlib.createGzip({ level: 6 }), fs.createWriteStream(zipped));
    const zippedSize = fs.statSync(zipped).size;
    const tooBig = zippedSize > settingsService.num('backup_email_max_mb') * 1024 * 1024;
    await mailer.sendBackupEmail({
      to: valid.join(', '),
      filename,
      sizeBytes: size,
      triggeredBy,
      attachmentPath: tooBig ? null : zipped,
      attachmentName: `${filename}.gz`,
      note: tooBig ? `The compressed backup is ${mailer.formatBytes(zippedSize)}, too large to attach. It is saved on the PC running the app, in backend\\db-backup.` : null,
    });
    return {
      status: tooBig ? 'failed' : 'sent',
      message: tooBig ? `Too large to attach (${mailer.formatBytes(zippedSize)} compressed); a notice was sent to ${valid.join(', ')}.` : `Sent to ${valid.join(', ')} (${mailer.formatBytes(zippedSize)} compressed)`,
    };
  } catch (error) {
    console.error('Backup email failed:', error.message);
    return { status: 'failed', message: String(error.message).slice(0, 500) };
  } finally {
    if (zipped) fs.rm(zipped, { force: true }, () => {});
  }
}

async function alertFailure({ triggeredBy, message }) {
  try {
    const settings = await settingsService.getAll();
    if (settings.backup_email_enabled !== '1' || !mailer.isConfigured()) return;
    const { valid } = settingsService.parseEmailList(settings.backup_email_recipients);
    if (valid.length) await mailer.sendBackupFailedEmail({ to: valid.join(', '), triggeredBy, message });
  } catch (error) {
    console.error('Backup failure alert could not be sent:', error.message);
  }
}

// ── Keep only the newest N ──
async function applyRetention() {
  const keep = Number((await settingsService.getAll()).backup_keep) || 14;
  const [rows] = await pool.query("SELECT id, filename FROM backup_runs WHERE status = 'success' AND is_deleted = 0 ORDER BY started_at DESC, id DESC");
  for (const row of rows.slice(keep)) {
    if (SAFE_FILENAME.test(row.filename)) fs.rmSync(path.join(BACKUP_DIR, row.filename), { force: true });
    await pool.query('UPDATE backup_runs SET is_deleted = 1 WHERE id = ?', [row.id]);
  }
  return Math.max(rows.length - keep, 0);
}

// ── Running a backup ──
class BackupBusy extends Error {}

// Reserves the run (a MySQL named lock, so a second copy of the app on this database cannot dump at the same time), records it, and
// returns at once; the dump continues in the background. `done` resolves with the outcome.
async function startBackup({ triggeredBy = 'manual', startedBy = null } = {}) {
  if (current) throw new BackupBusy('A backup is already running.');
  const conn = await pool.getConnection();
  let locked = false;
  try {
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [LOCK_NAME]);
    locked = Boolean(lock.got);
    if (!locked) throw new BackupBusy('A backup is already running.');
    const filename = `${FILE_PREFIX}${timestamp()}.sql`;
    const [result] = await pool.query('INSERT INTO backup_runs (filename, status, triggered_by, started_by) VALUES (?, ?, ?, ?)', [filename, 'running', triggeredBy, startedBy]);
    const run = { id: result.insertId, filename, startedAt: new Date() };
    current = run;
    const done = (async () => {
      try {
        const file = path.join(BACKUP_DIR, filename);
        const size = await dumpDatabase(file);
        await pool.query("UPDATE backup_runs SET status = 'success', size_bytes = ?, finished_at = NOW() WHERE id = ?", [size, run.id]);
        // Emailing never changes whether the backup itself counts as a success.
        const email = await emailIfEnabled({ filename, file, size, triggeredBy });
        if (email) await pool.query('UPDATE backup_runs SET email_status = ?, email_message = ? WHERE id = ?', [email.status, email.message, run.id]);
        const removed = await applyRetention().catch(error => { console.error('Backup clean-up failed:', error.message); return 0; });
        console.log(`Backup ${filename} done (${mailer.formatBytes(size)})${removed ? `, removed ${removed} old` : ''}`);
        return { success: true, id: run.id, filename, size, email };
      } catch (error) {
        const message = String(error.message || error).slice(0, 1500);
        console.error(`Backup failed: ${message}`);
        await pool.query("UPDATE backup_runs SET status = 'failed', message = ?, finished_at = NOW() WHERE id = ?", [message, run.id]).catch(() => {});
        // One alert per scheduled time, not one per retry.
        const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM backup_runs WHERE status = 'failed' AND triggered_by = ? AND started_at > NOW() - INTERVAL 12 HOUR", [triggeredBy]).catch(() => [[{ n: 1 }]]);
        if (triggeredBy === 'manual' || n <= 1) await alertFailure({ triggeredBy, message });
        return { success: false, id: run.id, filename, message };
      } finally {
        current = null;
        await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {});
        conn.release();
      }
    })();
    return { id: run.id, filename, done };
  } catch (error) {
    if (!current) {
      if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {});
      conn.release();
    }
    throw error;
  }
}

// ── Schedule ──
function atTime(base, hour, minute) {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// The most recent moment a backup was due, and the next one.
function dueTimes(settings, now = new Date()) {
  const hour = Number(settings.backup_hour);
  const minute = Number(settings.backup_minute);
  const today = atTime(now, hour, minute);
  const last = today <= now ? today : atTime(new Date(now.getTime() - 86400000), hour, minute);
  const next = today > now ? today : atTime(new Date(now.getTime() + 86400000), hour, minute);
  return { last, next };
}

const sqlTime = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

// Runs the automatic backup when it is due and has not happened yet. This one routine serves both the exact daily time and the
// catch-up (the PC was off or asleep then), so the two can never produce two backups.
async function runDueBackup() {
  const settings = await settingsService.getAll();
  if (settings.backup_enabled !== '1' || current) return null;
  const { last } = dueTimes(settings);
  const since = sqlTime(last);
  const [[done]] = await pool.query("SELECT COUNT(*) AS n FROM backup_runs WHERE status IN ('success', 'running') AND is_deleted = 0 AND started_at >= ?", [since]);
  if (done.n) return null; // already backed up since it was due (by schedule, catch-up or by hand)
  const [[tried]] = await pool.query("SELECT COUNT(*) AS n FROM backup_runs WHERE status = 'failed' AND triggered_by <> 'manual' AND started_at >= ?", [since]);
  if (tried.n >= Number(settings.backup_max_attempts)) return null;
  const lateByMinutes = (Date.now() - last.getTime()) / 60000;
  try {
    const run = await startBackup({ triggeredBy: lateByMinutes > 10 ? 'catchup' : 'schedule', startedBy: 'automatic' });
    return await run.done;
  } catch (error) {
    if (error instanceof BackupBusy) return null;
    throw error;
  }
}

function safeRun() {
  runDueBackup().catch(error => console.error('Scheduled backup failed:', error.message));
}

async function reschedule() {
  if (dailyTask) { dailyTask.stop(); dailyTask = null; }
  if (catchUpTask) { catchUpTask.stop(); catchUpTask = null; }
  const settings = await settingsService.getAll();
  if (settings.backup_enabled !== '1') { console.log('Automatic backups are off'); return; }
  dailyTask = cron.schedule(`${Number(settings.backup_minute)} ${Number(settings.backup_hour)} * * *`, safeRun);
  // Catches a missed time after the PC was off, asleep or the app was stopped.
  catchUpTask = cron.schedule('*/20 * * * *', safeRun);
  console.log(`Automatic backups: daily at ${String(settings.backup_hour).padStart(2, '0')}:${String(settings.backup_minute).padStart(2, '0')} (server time), keeping the newest ${settings.backup_keep}`);
}

async function init() {
  // Half-written dumps from a crash.
  for (const name of fs.readdirSync(BACKUP_DIR)) if (name.endsWith('.partial')) fs.rmSync(path.join(BACKUP_DIR, name), { force: true });
  await reschedule();
  setTimeout(safeRun, 60 * 1000).unref();
}

function stop() {
  if (dailyTask) dailyTask.stop();
  if (catchUpTask) catchUpTask.stop();
}

// ── For the Admin screen ──
async function overview() {
  const settings = await settingsService.getAll();
  const [runs] = await pool.query('SELECT * FROM backup_runs WHERE is_deleted = 0 ORDER BY started_at DESC, id DESC LIMIT 100');
  const files = new Set(fs.readdirSync(BACKUP_DIR));
  const { next } = dueTimes(settings);
  const lastSuccess = runs.find(r => r.status === 'success') || null;
  let diskBytes = 0;
  for (const r of runs) if (r.status === 'success' && files.has(r.filename)) diskBytes += Number(r.size_bytes) || 0;
  return {
    settings: {
      enabled: settings.backup_enabled === '1',
      hour: Number(settings.backup_hour),
      minute: Number(settings.backup_minute),
      keep: Number(settings.backup_keep),
      email_enabled: settings.backup_email_enabled === '1',
      email_recipients: settings.backup_email_recipients,
    },
    next_run: settings.backup_enabled === '1' ? sqlTime(next) : null,
    last_success: lastSuccess && { id: lastSuccess.id, started_at: lastSuccess.started_at, size_bytes: lastSuccess.size_bytes, filename: lastSuccess.filename },
    running: current && { id: current.id, filename: current.filename, started_at: current.startedAt.toISOString() },
    mysqldump: Boolean(findMysqldump()),
    mail_configured: mailer.isConfigured(),
    folder: BACKUP_DIR,
    disk_bytes: diskBytes,
    runs: runs.map(r => ({ ...r, file_exists: r.status === 'success' && files.has(r.filename) })),
  };
}

function filePath(filename) {
  if (!SAFE_FILENAME.test(String(filename))) return null;
  const full = path.join(BACKUP_DIR, filename);
  return fs.existsSync(full) ? full : null;
}

async function removeBackup(filename) {
  if (!SAFE_FILENAME.test(String(filename))) return false;
  const [[row]] = await pool.query("SELECT id, status FROM backup_runs WHERE filename = ? AND is_deleted = 0", [filename]);
  if (!row || row.status === 'running') return false;
  fs.rmSync(path.join(BACKUP_DIR, filename), { force: true });
  await pool.query('UPDATE backup_runs SET is_deleted = 1 WHERE id = ?', [row.id]);
  return true;
}

module.exports = { init, stop, reschedule, startBackup, overview, filePath, removeBackup, findMysqldump, BackupBusy, BACKUP_DIR, SAFE_FILENAME };
