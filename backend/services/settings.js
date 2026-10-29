const { pool } = require('../db/pool');

// Application settings, kept in the `settings` table so an administrator can change them (Admin -> Settings) without touching files.
//
// Every setting is declared once in SCHEMA below: its group, label, help text, type, limits and default. The same declaration drives
// the server-side validation, the defaults and the Admin screen (which receives the schema from GET /api/admin/settings), so the
// screen and the server can never disagree. Rules for a default: it reproduces what the app did before the setting existed; where
// an environment variable already existed (`env`), that variable is the default, so an existing install keeps working untouched.
//
// Secrets (ManageEngine client secret, mail password...) are NOT here: see connections.js.
const GROUPS = [
  { id: 'sync', title: 'Sync & history', help: 'How and when the app copies SRs from ManageEngine. Changes apply to the next run; no restart is needed.' },
  { id: 'analytics', title: 'Analytics', help: 'How the figures are measured, grouped and ranked. A change recalculates every screen and Excel report at once.' },
  { id: 'security', title: 'Security', help: 'Sessions, sign-in lockout, passwords and request limits. New limits apply to the next request or sign-in.' },
  { id: 'identity', title: 'Identity', help: 'The names, texts and time zone shown to your people.' },
  { id: 'reports', title: 'Reports & backups', help: 'Excel file names, titles and size limits, and the backup email limits.' },
];

const GRADES = [['10', '10 rows'], ['25', '25 rows'], ['50', '50 rows'], ['100', '100 rows']];
const PRESETS = [['all', 'All time'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['180', 'Last 6 months'], ['year', 'This year']];

const int = (key, section, label, def, min, max, help, extra = {}) => ({ key, section, label, type: 'int', default: String(def), min, max, help, ...extra });
const bool = (key, section, label, def, help, extra = {}) => ({ key, section, label, type: 'bool', default: def ? '1' : '0', help, ...extra });
const text = (key, section, label, def, max, help, extra = {}) => ({ key, section, label, type: 'text', default: def, max, help, ...extra });

const SCHEMA = [
  // ───────────── Sync & history ─────────────
  int('auto_sync_minutes', 'Automatic sync', 'Automatic sync every (minutes)', 30, 0, 1440,
    '0 turns the regular automatic sync off; otherwise at least 5. It reads only SRs changed since the last sync.',
    { unit: 'minutes', zeroOr: 5 }),
  int('sync_retry_minutes', 'Automatic sync', 'Retry a failed automatic sync after (minutes)', 5, 1, 720,
    'After a failed automatic sync (network, ManageEngine busy) the next try happens after this long instead of after the whole interval.', { unit: 'minutes' }),
  { key: 'scan_from', section: 'Automatic sync', label: 'Deep sync reads back to', type: 'date', default: '2025-10-01', env: 'MANAGEENGINE_SCAN_FROM',
    help: 'A date like 2025-10-01, or blank to read back to the very first SR. Older SRs already stored are never removed.' },
  int('sync_overlap_minutes', 'Automatic sync', 'Re-read overlap (minutes)', 30, 0, 1440,
    'A quick sync re-reads this much before the last sync started so a change made while it ran (or a clock difference with ManageEngine) is never missed. Re-reading is harmless.', { unit: 'minutes' }),
  int('sync_removal_cap', 'Automatic sync', 'Deep sync: most SRs checked as "no longer in ManageEngine"', 300, 0, 100000,
    'If a deep sync finds more SRs than this missing from the list it assumes the list was incomplete and flags nothing as removed. 0 never flags any.', { unit: 'SRs' }),

  bool('deep_sync_enabled', 'Daily deep sync', 'Run a deep sync every day', true,
    'Re-reads every SR back to the "Deep sync reads back to" date and flags SRs ManageEngine no longer has. Runs once a day at the time below, in the background.'),
  { key: 'deep_sync_time', section: 'Daily deep sync', label: 'Deep sync time (server time)', type: 'time', default: '01:00',
    help: 'Time of day on the PC that runs this app, 24-hour. A deep sync of every SR takes a while, so pick a quiet hour.' },
  bool('deep_sync_catchup', 'Daily deep sync', 'Catch up if the PC or the app was off', true,
    'If the app was not running at the deep-sync time, it runs once as soon as it is back, unless a deep sync has already succeeded since that time.'),
  int('deep_sync_max_attempts', 'Daily deep sync', 'Attempts per day if it fails', 3, 1, 10,
    'A failed automatic deep sync is tried again (after the retry wait above) up to this many times for each scheduled time, then left until the next one.', { unit: 'attempts' }),

  int('sync_page_size', 'Talking to ManageEngine', 'SRs per request (page size)', 100, 10, 100,
    'How many SRs one ManageEngine call returns when syncing. ManageEngine allows at most 100.', { unit: 'SRs' }),
  int('sync_pause_ms', 'Talking to ManageEngine', 'Pause between ManageEngine calls (milliseconds)', 250, 0, 10000,
    'A short rest between pages, so syncs stay below ManageEngine\'s rate limit.', { unit: 'ms' }),
  int('sync_max_pages', 'Talking to ManageEngine', 'Most pages one sync may read', 5000, 1, 100000,
    'Safety stop for a sync that never reaches the end.', { unit: 'pages' }),
  int('me_max_attempts', 'Talking to ManageEngine', 'Tries per ManageEngine call', 5, 1, 10,
    'Network errors, timeouts, HTTP 429/5xx and "too many requests" answers are retried this many times before the call fails.', { unit: 'tries' }),
  int('me_timeout_seconds', 'Talking to ManageEngine', 'Wait for an answer (seconds)', 45, 5, 300, 'A call that has not been answered after this long is cancelled and retried.', { unit: 'seconds' }),
  int('me_throttle_wait_seconds', 'Talking to ManageEngine', 'Wait after "too many requests" (seconds)', 20, 1, 300,
    'Multiplied by the try number (20, 40, 60... seconds) when ManageEngine says it is being asked too often.', { unit: 'seconds' }),
  int('me_backoff_seconds', 'Talking to ManageEngine', 'First wait after a server error (seconds)', 2, 1, 60,
    'Doubles on every retry, up to 15 times this value.', { unit: 'seconds' }),
  int('me_retry_after_cap_seconds', 'Talking to ManageEngine', 'Longest wait ManageEngine may ask for (seconds)', 120, 10, 900,
    'When ManageEngine answers with a "retry after" time, the app waits that long, but never more than this.', { unit: 'seconds' }),
  int('me_token_attempts', 'Talking to ManageEngine', 'Tries to get an access token', 4, 1, 10,
    'Zoho allows only a few token refreshes in a few minutes; this many tries are made (with waits) before giving up.', { unit: 'tries' }),
  int('roster_retry_hours', 'Talking to ManageEngine', 'Ask for the technician roster again after (hours)', 6, 1, 168,
    'The roster is optional (it needs an extra ManageEngine permission). When it is refused it is not asked for again for this long.', { unit: 'hours' }),

  bool('history_auto', 'SR history', 'Collect SR history automatically', true,
    'Reads each SR\'s change log (reassignments, reopens, replies, holds) in the background after every sync. Switch off to collect only when asked on the Data & sync page.'),
  int('history_concurrency', 'SR history', 'SRs read at the same time', 4, 1, 10,
    'More is faster but uses more of ManageEngine\'s rate limit.', { env: 'HISTORY_CONCURRENCY', unit: 'at once' }),
  int('history_cooldown_minutes', 'SR history', 'Rest after a collection stopped by errors (minutes)', 15, 0, 1440,
    'After a collection stopped because ManageEngine kept refusing, history is left alone for this long.', { unit: 'minutes' }),
  int('history_max_failures', 'SR history', 'Stop after this many failures in a row', 25, 1, 1000, 'A collection that fails this many SRs one after another stops.', { unit: 'failures' }),
  int('history_max_throttled', 'SR history', 'Stop after this many "too many requests" in a row', 3, 1, 100, 'Lower is gentler on ManageEngine.', { unit: 'answers' }),
  int('history_max_pages', 'SR history', 'Change-log pages read per SR', 60, 1, 500,
    'One page is 100 events. Real SRs have tens to a few hundred; a runaway mail loop can have thousands.', { unit: 'pages' }),
  int('history_tail_pages', 'SR history', 'Newest change-log pages added for very long logs', 11, 0, 100,
    'For an SR whose log is longer than the limit above, this many of the newest pages are read as well (closures and reopens live there).', { unit: 'pages' }),
  int('sync_history_rows', 'SR history', 'Runs listed in "Sync history"', 30, 5, 500, 'How many recent runs the Data & sync page shows.', { unit: 'runs' }),

  // ───────────── Analytics ─────────────
  int('target_days_1', 'Closing-time targets', 'First target (days)', 1, 1, 365, 'The "closed within N days" figures. They must rise: first < second < third.', { unit: 'days' }),
  int('target_days_2', 'Closing-time targets', 'Second target (days)', 3, 1, 365, 'Also the target used to rank technicians when ManageEngine sets no due times.', { unit: 'days' }),
  int('target_days_3', 'Closing-time targets', 'Third target (days)', 7, 1, 365, '', { unit: 'days' }),
  int('first_reply_target_1_minutes', 'Closing-time targets', 'First reply target 1 (minutes)', 60, 1, 43200, 'Share of SRs whose first reply came within this time.', { unit: 'minutes' }),
  int('first_reply_target_2_minutes', 'Closing-time targets', 'First reply target 2 (minutes)', 1440, 1, 43200, 'Must be longer than target 1 (1440 = one day).', { unit: 'minutes' }),
  int('stale_days_1', 'Closing-time targets', 'Open SR "gone quiet" after (days)', 7, 1, 365, 'Open SRs with no activity for this long are counted as gone quiet.', { unit: 'days' }),
  int('stale_days_2', 'Closing-time targets', 'Open SR "long quiet" after (days)', 14, 1, 365, 'A second, longer limit; must be more than the first.', { unit: 'days' }),
  bool('count_weekends', 'Closing-time targets', 'Count weekends in turnaround', true,
    'On (default): calendar time. Off: Saturdays and Sundays are not counted in turnaround, age, time to assign, first reply and idle time. Time on hold stays calendar time.'),

  { key: 'tat_bucket_edges', section: 'Buckets', label: 'Time-to-close buckets (days)', type: 'edges', default: '1,3,7,14,28', min: 1, max: 3650, maxCount: 8, unit: 'days',
    help: 'Upper edges, comma separated and rising, e.g. 1,3,7,14,28 gives: under 1 day, 1 - 3 days, 3 - 7 days, 1 - 2 weeks, 2 - 4 weeks, over 4 weeks.' },
  { key: 'aging_bucket_edges', section: 'Buckets', label: 'Age of open SRs / idle time buckets (days)', type: 'edges', default: '1,3,7,14,28', min: 1, max: 3650, maxCount: 8, unit: 'days',
    help: 'Same idea, for how long open SRs have been open and how long they have been quiet.' },
  { key: 'reply_bucket_edges', section: 'Buckets', label: 'First-reply buckets (minutes)', type: 'edges', default: '15,60,240,1440,4320', min: 1, max: 525600, maxCount: 8, unit: 'minutes',
    help: 'Upper edges in minutes, rising, e.g. 15,60,240,1440,4320 = 15 min, 1 hour, 4 hours, 1 day, 3 days.' },
  int('reassign_bucket_max', 'Buckets', 'Reassignment buckets: top bucket starts at', 3, 1, 10,
    'SRs are counted as reassigned 0, 1, 2 ... times; this many or more share the last bucket ("Three or more times").', { unit: 'times' }),

  int('min_ranked_closed', 'Ranking, windows & lists', 'Closed SRs needed to be ranked', 5, 1, 1000,
    'A technician needs this many measured closures before being ranked against peers (fewer are marked "few SRs").', { unit: 'SRs' }),
  int('min_due_sample', 'Ranking, windows & lists', 'Due-time figures need at least', 20, 1, 100000,
    'ManageEngine only sets due times when SLAs are configured. Below this many closed SRs with a due time, due-time figures are hidden.', { unit: 'SRs' }),
  int('recent_window_days', 'Ranking, windows & lists', '"Recent" window (days)', 30, 1, 365,
    'A technician\'s recent closures are compared with the same number of days before (30 = last 30 days vs the 30 before).', { unit: 'days' }),
  int('top_n_charts', 'Ranking, windows & lists', 'Technicians in top-N charts', 12, 3, 50, 'Dashboard charts such as "most SRs closed" and "fastest technicians".', { unit: 'people' }),
  int('top_n_matrix', 'Ranking, windows & lists', 'Technicians in the month-by-month table', 20, 5, 100, 'Busiest technicians shown in the technician-by-month matrix.', { unit: 'people' }),
  int('top_n_handovers', 'Ranking, windows & lists', 'People in "handed over to / received from"', 8, 3, 50, '', { unit: 'people' }),
  int('top_n_story', 'Ranking, windows & lists', 'Strengths / watch points listed per technician', 4, 1, 10, 'On a technician\'s page.', { unit: 'items' }),
  int('insight_sla_good_pct', 'Insight wording', 'On-time share counted as good (%)', 90, 1, 100, 'Used in the plain-language reading of a technician\'s numbers.', { unit: '%' }),
  int('insight_sla_bad_pct', 'Insight wording', 'On-time share counted as bad (%)', 70, 0, 99, 'Must be below the "good" share.', { unit: '%' }),
  int('insight_diff_pct', 'Insight wording', 'Difference from the team that is worth a remark (%)', 10, 1, 100, 'Median turnaround within this many percent of the team is "about the same".', { unit: '%' }),
  int('insight_gap_points', 'Insight wording', 'Target gap that is worth a remark (points)', 5, 1, 50, 'Percentage points above or below the team on the second closing-time target.', { unit: 'points' }),
  { key: 'insight_p90_ratio', section: 'Insight wording', label: 'Slowest tenth: warn when this many times the team\'s', type: 'number', default: '1.5', min: 1, max: 10, step: 0.1,
    help: 'Warn when a technician\'s 90th percentile turnaround is this many times the team\'s.' },

  { key: 'default_basis', section: 'Defaults for everyone', label: 'How turnaround is measured by default', type: 'enum', default: 'assigned',
    options: [['assigned', 'Since the SR was assigned to the technician'], ['raised', 'Since the SR was raised']],
    help: 'Each person can switch this at the top of the page; this is what everyone starts with.' },
  { key: 'default_aggregation', section: 'Defaults for everyone', label: 'Figure shown first for times', type: 'enum', default: 'average',
    options: [['average', 'Average (mean)'], ['median', 'Median (the typical SR)']],
    help: 'Turnaround, first reply and similar times show this figure as the main one, with the other beside it. Each person can switch it at the top of the page; this is what everyone starts with.' },
  { key: 'default_preset', section: 'Defaults for everyone', label: 'Period shown when nobody has chosen one', type: 'enum', default: 'all', options: PRESETS,
    help: 'The date range new visitors start with (people who have chosen their own keep it).' },
  { key: 'default_page_size', section: 'Defaults for everyone', label: 'Rows per page in SR lists', type: 'enum', default: '25', options: GRADES, help: 'People can still change it on each table.' },
  int('records_max_page_size', 'Defaults for everyone', 'Largest page the server will return', 500, 50, 5000, 'Protects the server from huge page requests.', { unit: 'rows' }),

  // ───────────── Security ─────────────
  int('session_idle_hours', 'Sessions', 'Sign out after being idle for (hours)', 12, 1, 720, 'A signed-in person who does nothing for this long must sign in again.', { unit: 'hours' }),
  int('session_max_days', 'Sessions', 'Longest a sign-in may last (days)', 7, 1, 365, 'However active, nobody stays signed in longer than this.', { unit: 'days' }),
  int('login_max_attempts', 'Sign-in lockout', 'Wrong passwords before an account is locked', 5, 3, 100, 'Counted for one email on one address.', { unit: 'attempts' }),
  int('login_lock_minutes', 'Sign-in lockout', 'Account lock lasts (minutes)', 15, 1, 1440, '', { unit: 'minutes' }),
  int('ip_max_attempts', 'Sign-in lockout', 'Wrong passwords before an address is locked', 30, 5, 1000, 'One address trying many different emails. Should be more than the account limit.', { unit: 'attempts' }),
  int('ip_lock_minutes', 'Sign-in lockout', 'Address lock lasts (minutes)', 15, 1, 1440, '', { unit: 'minutes' }),
  int('password_min_length', 'Passwords', 'Shortest password', 8, 6, 64, 'Applies to new passwords. Existing ones keep working.', { unit: 'characters' }),
  bool('password_require_mixed_case', 'Passwords', 'Require upper and lower case letters', false, ''),
  bool('password_require_digit', 'Passwords', 'Require a number', false, ''),
  bool('password_require_symbol', 'Passwords', 'Require a symbol (such as ! # $)', false, ''),
  bool('password_block_common', 'Passwords', 'Refuse very common passwords', true, 'Such as "password123", or a password equal to the email address.'),
  int('rate_limit_per_min', 'Requests & exports', 'API requests per minute from one address', 900, 30, 100000, 'Requests beyond this get "too many requests" for the rest of the minute.', { env: 'RATE_LIMIT_PER_MIN', unit: 'requests' }),
  int('max_concurrent_exports', 'Requests & exports', 'Excel reports prepared at the same time', 2, 1, 20, 'A big report (60,000+ rows) takes seconds and several hundred MB of memory. More people wait with "try again".', { unit: 'reports' }),
  bool('password_reset_enabled', 'Password reset', 'Let people reset a forgotten password by email', true,
    'Shows "Forgot your password?" on the sign-in page. It works only while email is set up (Admin > Connections). Turn it off to make every reset go through an administrator.'),
  int('password_reset_minutes', 'Password reset', 'Reset link stays valid for (minutes)', 60, 10, 1440, 'A reset link works once, and only until this time has passed.', { unit: 'minutes' }),
  int('password_reset_gap_minutes', 'Password reset', 'Wait between reset emails to the same address (minutes)', 2, 0, 60, 'Stops someone filling a mailbox. 0 allows a new email at once.', { unit: 'minutes' }),
  int('password_reset_ip_per_hour', 'Password reset', 'Reset requests per hour from one address', 10, 1, 500, 'Beyond this, further requests from that address are refused until the hour has passed.', { unit: 'requests' }),

  // ───────────── Identity ─────────────
  text('app_name', 'Names', 'Application name', 'ManageEngine Analytics', 60, 'Shown in the sidebar, the sign-in page, the browser tab, emails and Excel files.', { required: true }),
  text('org_name', 'Names', 'Organisation name', '', 80, 'Optional. Shown under the application name on the sign-in page.'),
  text('public_url', 'Names', 'Web address people use to open this app', '', 200,
    'Used for the link in password-reset emails, for example http://servername:7780 or https://analytics.yourcompany.com. Blank uses http://localhost and the port, which only works on the PC that runs the app. It is never taken from the browser, so a forged request cannot point the link elsewhere.'),
  text('sidebar_subtitle', 'Names', 'Sidebar subtitle', 'Service desk', 40, ''),
  text('login_subtitle', 'Sign-in page', 'Sign-in page subtitle', 'Service desk performance', 60, ''),
  text('login_headline', 'Sign-in page', 'Sign-in page headline', 'See how every technician is really performing.', 120, ''),
  text('login_blurb', 'Sign-in page', 'Sign-in page paragraph', 'Turnaround, backlog and due-time performance for every SR in ManageEngine, measured from the moment it was assigned or raised.', 300, ''),
  text('login_footer', 'Sign-in page', 'Sign-in page footer line', 'Syncs with ManageEngine automatically', 100, ''),
  { key: 'support_email', section: 'Sign-in page', label: 'Support email shown on the sign-in page', type: 'email', default: '',
    help: 'Optional. People who cannot sign in are told to write to this address.' },
  { key: 'portal_time_zone', section: 'Time zone', label: 'ManageEngine portal time zone', type: 'timezone', default: 'Asia/Kolkata', env: 'MANAGEENGINE_TIME_ZONE',
    help: 'An IANA name such as Asia/Kolkata. ManageEngine sends moments in absolute time; they are stored as this portal\'s wall-clock time. SRs already stored keep their old conversion until they are read again (run a Deep sync after changing it).' },

  // ───────────── Reports ─────────────
  { key: 'report_file_prefix', section: 'Excel files', label: 'File-name prefix', type: 'filename', default: 'ManageEngine_Analytics', max: 40,
    help: 'Letters, numbers, dashes and underscores. Files are named PREFIX_Report_2026-01-31.xlsx.' },
  text('report_title_prefix', 'Excel files', 'Report title prefix', '', 60, 'Optional text put in front of each report\'s title (inside the workbook), for example your company name.'),
  int('report_max_rows', 'Limits', 'Most rows in a chart/table export', 100000, 1000, 1000000, 'Applies to "Download > Excel" on charts and tables.', { unit: 'rows' }),
  int('report_max_sr_rows', 'Limits', 'Most SR rows in a full report', 1000000, 1000, 1048000, 'The "All SRs" sheet of the dashboard, technician and SR-list reports. Excel itself stops at 1,048,575.', { unit: 'rows' }),
  int('report_max_sheets', 'Limits', 'Most sheets in a chart/table export', 12, 1, 50, '', { unit: 'sheets' }),
  int('report_max_columns', 'Limits', 'Most columns on a sheet in a chart/table export', 60, 1, 200, '', { unit: 'columns' }),

  int('backup_email_max_mb', 'Backup limits', 'Largest backup to attach to an email (MB)', 20, 1, 100,
    'The compressed backup is attached only if it is smaller than this; otherwise the email says where the file is. Gmail refuses attachments over about 25 MB.', { unit: 'MB', env: 'BACKUP_EMAIL_MAX_MB' }),
  int('backup_max_attempts', 'Backup limits', 'Attempts per day when a backup fails', 3, 1, 20,
    'After this many failed automatic attempts for one scheduled time, the app stops retrying until the next day. A manual run is never limited.', { unit: 'attempts' }),

  // ───────────── Backups (edited on Admin -> Backups) ─────────────
  { key: 'backup_enabled', group: 'backups', type: 'bool', default: '1', label: 'Daily backup' },
  { key: 'backup_hour', group: 'backups', type: 'int', default: '2', min: 0, max: 23, label: 'Backup hour' },
  { key: 'backup_minute', group: 'backups', type: 'int', default: '0', min: 0, max: 59, label: 'Backup minute' },
  { key: 'backup_keep', group: 'backups', type: 'int', default: '14', min: 1, max: 365, label: 'Backups kept' },
  { key: 'backup_email_enabled', group: 'backups', type: 'bool', default: '0', label: 'Email backups' },
  { key: 'backup_email_recipients', group: 'backups', type: 'email-list', default: '', label: 'Backup recipients' },
];

// Which group each section belongs to.
const SECTION_GROUP = {
  'Automatic sync': 'sync', 'Daily deep sync': 'sync', 'Talking to ManageEngine': 'sync', 'SR history': 'sync',
  'Closing-time targets': 'analytics', Buckets: 'analytics', 'Ranking, windows & lists': 'analytics', 'Insight wording': 'analytics', 'Defaults for everyone': 'analytics',
  Sessions: 'security', 'Sign-in lockout': 'security', Passwords: 'security', 'Password reset': 'security', 'Requests & exports': 'security',
  Names: 'identity', 'Sign-in page': 'identity', 'Time zone': 'identity', 'Excel files': 'reports', Limits: 'reports', 'Backup limits': 'reports',
};
for (const def of SCHEMA) if (!def.group) def.group = SECTION_GROUP[def.section];

const BY_KEY = Object.fromEntries(SCHEMA.map(def => [def.key, def]));

class SettingsError extends Error {
  constructor(message, field = null) { super(message); this.field = field; }
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// "a@b.com, c@d.com ; e@f.com" -> { valid: [...unique], invalid: [...] }
function parseEmailList(raw) {
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const part of String(raw || '').split(/[,;\s]+/)) {
    const email = part.trim();
    if (!email) continue;
    if (email.length > 190 || !EMAIL.test(email)) { invalid.push(email.slice(0, 80)); continue; }
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    valid.push(email);
  }
  return { valid, invalid };
}

const validZone = zone => { try { new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(); return true; } catch { return false; } };

// Turns a submitted value into the string that is stored, or throws a SettingsError that names the setting.
function coerce(def, raw) {
  const fail = message => { throw new SettingsError(`${def.label}: ${message}`, def.key); };
  switch (def.type) {
    case 'int': {
      const n = typeof raw === 'string' ? (raw.trim() === '' ? NaN : Number(raw)) : Number(raw);
      if (typeof raw === 'boolean' || !Number.isInteger(n) || n < def.min || n > def.max) fail(`must be a whole number from ${def.min} to ${def.max}`);
      if (def.zeroOr && n !== 0 && n < def.zeroOr) fail(`use 0 (off) or at least ${def.zeroOr}`);
      return String(n);
    }
    case 'number': {
      const n = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
      if (typeof raw === 'boolean' || !Number.isFinite(n) || n < def.min || n > def.max) fail(`must be a number from ${def.min} to ${def.max}`);
      return String(Math.round(n * 1000) / 1000);
    }
    case 'bool':
      if (raw === true || raw === '1' || raw === 1 || raw === 'true') return '1';
      if (raw === false || raw === '0' || raw === 0 || raw === 'false') return '0';
      return fail('must be on or off');
    case 'enum': {
      const value = String(raw);
      if (!def.options.some(([v]) => v === value)) fail(`choose one of: ${def.options.map(([v]) => v).join(', ')}`);
      return value;
    }
    case 'text': {
      if (typeof raw !== 'string') fail('must be text');
      const value = raw.trim().replace(/\s+/g, ' ');
      if (value.length > def.max) fail(`at most ${def.max} characters`);
      if (def.required && !value) fail('cannot be blank');
      return value;
    }
    case 'date': {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) fail('must be a date like 2025-10-01 (or blank)');
      return value;
    }
    case 'time': {
      const m = /^(\d{1,2}):(\d{2})$/.exec(typeof raw === 'string' ? raw.trim() : '');
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) fail('must be a time like 01:00 (24-hour)');
      return `${m[1].padStart(2, '0')}:${m[2]}`;
    }
    case 'email': {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (value && (value.length > 190 || !EMAIL.test(value))) fail('must be an email address (or blank)');
      return value;
    }
    case 'email-list': {
      const { valid, invalid } = parseEmailList(raw);
      if (invalid.length) throw new SettingsError(`Not a valid email address: ${invalid.join(', ')}`, def.key);
      if (valid.length > 20) throw new SettingsError('Up to 20 recipients', def.key);
      return valid.join(', ');
    }
    case 'timezone': {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value || !validZone(value)) fail('must be a time zone name such as Asia/Kolkata or Europe/London');
      return value;
    }
    case 'filename': {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (value.length > def.max || !/^[A-Za-z0-9_-]*$/.test(value)) fail(`letters, numbers, dashes and underscores only, at most ${def.max} characters`);
      return value;
    }
    case 'edges': {
      const parts = (typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(',') : String(raw)).split(/[,;\s]+/).filter(Boolean);
      const nums = parts.map(Number);
      if (!nums.length || nums.length > def.maxCount) fail(`give between 1 and ${def.maxCount} numbers`);
      if (nums.some(n => !Number.isInteger(n) || n < def.min || n > def.max)) fail(`whole numbers from ${def.min} to ${def.max}, separated by commas`);
      if (nums.some((n, i) => i && n <= nums[i - 1])) fail('numbers must rise (each one larger than the one before)');
      return nums.join(',');
    }
    default:
      return String(raw);
  }
}

// The default a setting has right now: its environment variable when one is set (and valid), otherwise the built-in value.
function defaultFor(def) {
  if (def.env && process.env[def.env] !== undefined) {
    const raw = process.env[def.env];
    try {
      if (def.type === 'int' && raw.trim() !== '' && Number.isFinite(Number(raw))) return String(Math.min(Math.max(Math.trunc(Number(raw)), def.min), def.max));
      return coerce(def, raw);
    } catch { /* an unusable value in .env: the built-in default applies */ }
  }
  return def.default;
}

const DEFAULTS = Object.fromEntries(SCHEMA.map(def => [def.key, defaultFor(def)]));

// Rules that involve several settings at once, checked against the values as they will be after the change.
const CROSS = [
  { keys: ['public_url'], check: v => (!v.public_url || /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(v.public_url) ? null : 'The web address must start with http:// or https:// and have no spaces, for example http://servername:7780') },
  { keys: ['target_days_1', 'target_days_2', 'target_days_3'], check: v => (Number(v.target_days_1) < Number(v.target_days_2) && Number(v.target_days_2) < Number(v.target_days_3) ? null : 'The three closing-time targets must rise: first < second < third') },
  { keys: ['first_reply_target_1_minutes', 'first_reply_target_2_minutes'], check: v => (Number(v.first_reply_target_1_minutes) < Number(v.first_reply_target_2_minutes) ? null : 'First reply target 2 must be longer than target 1') },
  { keys: ['stale_days_1', 'stale_days_2'], check: v => (Number(v.stale_days_1) < Number(v.stale_days_2) ? null : '"Long quiet" must be more days than "gone quiet"') },
  { keys: ['insight_sla_good_pct', 'insight_sla_bad_pct'], check: v => (Number(v.insight_sla_bad_pct) < Number(v.insight_sla_good_pct) ? null : 'The "bad" on-time share must be below the "good" one') },
  { keys: ['login_max_attempts', 'ip_max_attempts'], check: v => (Number(v.ip_max_attempts) >= Number(v.login_max_attempts) ? null : 'The address limit must not be lower than the account limit') },
  { keys: ['session_idle_hours', 'session_max_days'], check: v => (Number(v.session_idle_hours) <= Number(v.session_max_days) * 24 ? null : 'The idle timeout cannot be longer than the longest a sign-in may last') },
  { keys: ['backup_email_enabled', 'backup_email_recipients'], check: v => (v.backup_email_enabled === '1' && !parseEmailList(v.backup_email_recipients).valid.length ? 'Add at least one email address to send backups to' : null) },
];

// ── Loading and reading ──
const TTL_MS = 10 * 1000;
let cache = null;
let loadedAt = 0;
let version = 0;
let refreshTimer = null;
const listeners = new Set();

async function loadAll() {
  const [rows] = await pool.query("SELECT k, v FROM settings WHERE k NOT LIKE 'conn\\_%'");
  const next = { ...DEFAULTS };
  for (const row of rows) {
    const def = BY_KEY[row.k];
    if (!def) continue;
    try { next[row.k] = coerce(def, row.v ?? ''); } catch { /* a row that no longer validates is ignored: the default applies */ }
  }
  const previous = cache;
  const changed = previous ? Object.keys(next).filter(k => next[k] !== previous[k]) : [];
  cache = next;
  loadedAt = Date.now();
  if (!previous || changed.length) version++;
  if (changed.length) for (const listener of listeners) { try { listener(changed); } catch (error) { console.error('Settings listener failed:', error.message); } }
  return cache;
}

async function getAll() {
  if (!cache || Date.now() - loadedAt > TTL_MS) await loadAll();
  return { ...cache };
}
const get = async key => (await getAll())[key];

// Synchronous reads for hot paths (every request, every record). The values are those last loaded; they are refreshed by update(),
// by the periodic refresh below, and by getAll().
const snapshot = () => cache || DEFAULTS;
const raw = key => snapshot()[key];
const num = key => Number(raw(key));
const flag = key => raw(key) === '1';
const str = key => String(raw(key) ?? '');
const ints = key => str(key).split(',').filter(Boolean).map(Number);

// Re-reads the settings now and then, so a change made through another copy of the app (same database) is picked up.
function startRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => { loadAll().catch(() => {}); }, 30 * 1000);
  refreshTimer.unref?.();
}

const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

// The part of the schema the Admin screen needs (backup settings have their own screen).
function describe() {
  return SCHEMA.filter(def => def.group !== 'backups').map(def => ({
    key: def.key, group: def.group, section: def.section, label: def.label, help: def.help || '', type: def.type, unit: def.unit || null,
    min: def.min ?? null, max: def.max ?? null, step: def.step ?? null, maxCount: def.maxCount ?? null, zero_or: def.zeroOr ?? null, required: !!def.required, long: def.type === 'text' && def.max > 120,
    options: def.options ? def.options.map(([value, label]) => ({ value, label })) : null,
    default: DEFAULTS[def.key], from_env: def.env && DEFAULTS[def.key] !== def.default ? def.env : null,
  }));
}

// ── Changing ──
// patch: { key: value }; a value of null puts the setting back to its default (its row is removed).
async function update(patch) {
  const current = await getAll();
  const clean = {};
  const reset = [];
  for (const [key, value] of Object.entries(patch || {})) {
    const def = BY_KEY[key];
    if (!def) throw new SettingsError(`Unknown setting "${key}"`, key);
    if (value === null) reset.push(key); else clean[key] = coerce(def, value);
  }
  const merged = { ...current, ...clean, ...Object.fromEntries(reset.map(k => [k, DEFAULTS[k]])) };
  const touched = new Set([...Object.keys(clean), ...reset]);
  for (const rule of CROSS) {
    if (!rule.keys.some(k => touched.has(k))) continue;
    const problem = rule.check(merged);
    if (problem) throw new SettingsError(problem, rule.keys.find(k => touched.has(k)));
  }
  for (const [key, value] of Object.entries(clean)) {
    await pool.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [key, value]);
  }
  for (const key of reset) await pool.query('DELETE FROM settings WHERE k = ?', [key]);
  return loadAll();
}

// For tests and the Admin "reset": the key list of everything that is stored in the settings table for the schema.
async function storedKeys() {
  const [rows] = await pool.query("SELECT k FROM settings WHERE k NOT LIKE 'conn\\_%'");
  return rows.map(r => r.k).filter(k => BY_KEY[k]);
}

module.exports = {
  getAll, get, update, load: loadAll, snapshot, num, flag, str, ints, onChange, startRefresh, describe, storedKeys,
  version: () => version, parseEmailList, coerce, DEFAULTS, SCHEMA, GROUPS, SettingsError, validZone,
};
