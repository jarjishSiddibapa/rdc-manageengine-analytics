const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const fs = require('fs');
const express = require('express');
const compression = require('compression');

const required = ['DB_HOST', 'DB_USER', 'DB_NAME'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`Missing required setting(s) in backend\\.env: ${missing.join(', ')}`);
  process.exit(1);
}

const { pool } = require('./db/pool');
const { initDb } = require('./db/database');
const auth = require('./services/auth');
const passwordReset = require('./services/passwordReset');
const settings = require('./services/settings');
const connections = require('./services/connections');
const secrets = require('./services/secrets');
const sync = require('./services/sync');
const backup = require('./services/backup');
const mailer = require('./services/mailer');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const dataRoutes = require('./routes/data');

const PORT = Number(process.env.PORT) || 7780;
// 127.0.0.1 = only this computer. Set HOST=0.0.0.0 in .env to share the app on the network (people sign in with their own accounts).
const HOST = process.env.HOST || '127.0.0.1';
const PRODUCTION = process.env.NODE_ENV === 'production';
// NO_BACKGROUND=1 starts the web server only: no automatic sync or history collection, and no clean-up of runs another copy may be
// running. For testing a second copy of the app against the same database.
const NO_BACKGROUND = ['1', 'true'].includes(String(process.env.NO_BACKGROUND || '').toLowerCase());

const app = express();
app.disable('x-powered-by');
app.set('etag', false); // JSON is never cached (see below); static files carry their own validators
// Behind a reverse proxy, set TRUST_PROXY (e.g. 1) in .env so sign-in lockouts and the activity log see the real client address.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);

// ── Security headers. The app is one same-origin SPA: scripts and connections only from itself; antd injects inline styles. ──
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
  "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});

// gzip for text (JSON, JS, CSS, HTML). Excel files are already zipped.
app.use(compression({ threshold: 1024, filter: (req, res) => !/spreadsheetml/.test(String(res.getHeader('Content-Type'))) && compression.filter(req, res) }));

// The chart-data export route reads its own (larger) body, after the caller is known to be signed in.
const smallJson = express.json({ limit: '100kb' });
app.use((req, res, next) => (req.path === '/api/reports/tables.xlsx' ? next() : smallJson(req, res, next)));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query({ sql: 'SELECT 1', timeout: 3000 });
    res.set('Cache-Control', 'no-store').json({ ok: true });
  } catch {
    res.status(503).set('Cache-Control', 'no-store').json({ ok: false, message: 'The database is not reachable' });
  }
});

// ── Per-address request limit for the API (sign-in has its own, stricter lockout). Counted in one-minute windows. ──
// The limit is the rate_limit_per_min setting (Admin -> Settings -> Security; RATE_LIMIT_PER_MIN in .env is its default).
const windows = new Map();
setInterval(() => windows.clear(), 60 * 1000).unref();
function rateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const count = (windows.get(key) || 0) + 1;
  windows.set(key, count);
  if (count > settings.num('rate_limit_per_min')) {
    res.set('Retry-After', '30');
    return res.status(429).json({ message: 'Too many requests. Slow down and try again in a moment.', code: 'RATE_LIMITED' });
  }
  next();
}

// What the sign-in page and the browser tab need before anybody has signed in: names, texts and the sign-in rules. Nothing secret.
const publicConfig = () => ({
  app_name: settings.str('app_name'),
  org_name: settings.str('org_name'),
  sidebar_subtitle: settings.str('sidebar_subtitle'),
  login_subtitle: settings.str('login_subtitle'),
  login_headline: settings.str('login_headline'),
  login_blurb: settings.str('login_blurb'),
  login_footer: settings.str('login_footer'),
  support_email: settings.str('support_email'),
  lockout: auth.lockoutPolicy(),
  password: auth.passwordPolicy(),
  password_reset: passwordReset.available(),
});

const api = express.Router();
api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.use(rateLimit);
api.use(auth.requireSameOrigin);
api.get('/public/config', (_req, res) => res.json(publicConfig()));
api.use(auth.attachUser);
api.use(authRoutes.publicRouter);
api.use(auth.requireAuth);
api.use(authRoutes.privateRouter);
api.use(dataRoutes);
api.use('/admin', adminRoutes);

app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found', code: 'NOT_FOUND' }));

// ── Built frontend ──
// (FRONTEND_DIST points the server at another build of the screens; used for testing a build before it replaces frontenddist.)
const dist = process.env.FRONTEND_DIST || path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, {
    index: false,
    etag: true,
    lastModified: true,
    setHeaders(res, file) {
      // Vite names bundles by content hash, so they can be cached for good; the page that points at them must always be re-checked.
      if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else if (/\.html$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  }));
  // Any other page address belongs to the single-page app (technician names can contain dots, so only real file types count as files).
  // A missing script, stylesheet or image is a true 404, not the app's HTML.
  const FILE_TYPES = /(^\/assets\/)|(\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|json|txt|xml|webmanifest|wasm)$)/i;
  // The page itself carries the application name (tab title, loading text) so it is right before any script has run.
  const escapeHtml = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let indexCache = { mtime: 0, html: '' };
  function indexHtml() {
    const file = path.join(dist, 'index.html');
    const stat = fs.statSync(file);
    if (stat.mtimeMs !== indexCache.mtime) indexCache = { mtime: stat.mtimeMs, html: fs.readFileSync(file, 'utf8') };
    const name = escapeHtml(settings.str('app_name') || 'ManageEngine Analytics');
    return indexCache.html.replace(/<title>[^<]*<\/title>/, () => `<title>${name}</title>`)
      .replace('Loading ManageEngine Analytics...', () => `Loading ${name}...`)
      .replace('ManageEngine Analytics needs JavaScript', () => `${name} needs JavaScript`);
  }
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || FILE_TYPES.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    try { res.type('html').send(indexHtml()); } catch { res.sendFile(path.join(dist, 'index.html')); }
  });
}
app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));

// ── Errors: always the same JSON shape, never a stack trace ──
const CLIENT_MESSAGES = {
  400: 'That request could not be understood', 401: 'Please sign in', 403: 'Not allowed', 404: 'Not found', 405: 'That method is not allowed',
  408: 'The request took too long', 413: 'That request is too large', 415: 'That kind of content is not accepted', 416: 'Bad range', 431: 'The request headers are too large',
};
const DB_DOWN = new Set(['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT', 'ENOTFOUND', 'ER_CON_COUNT_ERROR', 'ECONNRESET']);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'That request was not valid JSON', code: 'BAD_JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'That request is too large', code: 'TOO_LARGE' });
  const status = Number(err.status || err.statusCode);
  if (status >= 400 && status < 500) {
    // Errors the app raised on purpose carry a safe message; anything else gets the generic text for its status.
    const message = err.expose && err.message ? err.message : CLIENT_MESSAGES[status] || CLIENT_MESSAGES[400];
    return res.status(status).json({ message, code: err.code && /^[A-Z_]+$/.test(err.code) ? err.code : 'BAD_REQUEST' });
  }
  console.error(`${new Date().toISOString()} ${req.method} ${req.originalUrl.split('?')[0]} failed:`, err);
  if (DB_DOWN.has(err.code)) return res.status(503).json({ message: 'The database is not reachable right now. Try again in a moment.', code: 'DB_UNAVAILABLE' });
  res.status(500).json({ message: 'Something went wrong on the server', code: 'SERVER_ERROR' });
});

// ── Start ──
let server = null;
let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal ? `${signal} received. ` : ''}Shutting down...`);
  const force = setTimeout(() => { console.error('Forcing exit.'); process.exit(exitCode || 1); }, 10000);
  force.unref();
  try {
    backup.stop();
    if (server) {
      server.close();
      server.closeIdleConnections?.();
      // Give requests in flight a moment to finish, then cut whatever is left.
      setTimeout(() => server.closeAllConnections?.(), 4000).unref();
    }
    await pool.end();
  } catch (error) {
    console.error('Error while shutting down:', error.message);
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
// A forgotten promise in a background job should be reported, not take the whole app (and everyone's session) down.
process.on('unhandledRejection', reason => console.error(`${new Date().toISOString()} Unhandled promise rejection:`, reason));
process.on('uncaughtException', error => { console.error(`${new Date().toISOString()} Uncaught exception:`, error); shutdown('uncaughtException', 1); });

function explainStartupFailure(error) {
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return `Cannot reach MySQL at ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}. Start the MySQL service, or check DB_HOST / DB_PORT in backend\\.env.`;
  }
  if (error.code === 'ER_ACCESS_DENIED_ERROR') return 'MySQL refused the DB_USER / DB_PASSWORD in backend\\.env.';
  return error.message;
}

initDb({ recoverRuns: !NO_BACKGROUND })
  .then(() => secrets.ensureKey())
  // Settings and connections are read once now and then kept fresh (a change on the Admin screen applies at once; a change made
  // through another copy of the app is picked up within half a minute).
  .then(() => Promise.all([settings.load(), connections.load()]))
  .then(() => { settings.startRefresh(); connections.startRefresh(); })
  .then(() => auth.seedAdmin())
  .then(() => new Promise((resolve, reject) => {
    server = app.listen(PORT, HOST, resolve);
    server.once('error', reject);
  }))
  .then(() => {
    server.on('error', error => console.error('Server error:', error.message));
    // Slow or stalled clients cannot hold connections open forever.
    server.requestTimeout = 120000;
    server.headersTimeout = 30000;
    console.log(`ManageEngine Analytics running on http://localhost:${PORT}${NO_BACKGROUND ? ' (background sync disabled)' : ''}`);
    if (!NO_BACKGROUND) {
      sync.startScheduler();
      backup.init().catch(error => console.error('Backup schedule could not start:', error.message));
      mailer.verifyMailer().catch(() => {});
    }
    // Expired sign-ins are removed hourly.
    setInterval(() => {
      auth.purgeExpiredSessions().catch(error => console.error('Session clean-up failed:', error.message));
      passwordReset.purgeOld().catch(error => console.error('Reset-link clean-up failed:', error.message));
    }, 60 * 60 * 1000).unref();
  })
  .catch(error => {
    if (error.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Is ManageEngine Analytics already running? Close it, or change PORT in backend\\.env.`);
    else if (error.code === 'EACCES') console.error(`Not allowed to listen on port ${PORT}. Try a different PORT in backend\\.env.`);
    else console.error('Could not start:', explainStartupFailure(error));
    process.exit(1);
  });
