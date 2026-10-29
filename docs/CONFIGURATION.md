# Configuration

Nothing about how the app behaves is fixed in code. This page is generated from the settings registry (`backend/services/settings.js`), which also drives the validation and the Admin screen, so the three can never disagree.

## Where each kind of value lives
| What | Where | Needs a restart? |
|---|---|---|
| Database, web port and address, first administrator | `backend/.env` (the app cannot start without them) | yes |
| ManageEngine connection and email (SMTP) account | **Admin > Connections** (secrets are stored encrypted; a blank field falls back to `backend/.env`) | no |
| Backup time, number kept, email recipients | **Admin > Backups** | no |
| Everything below (sync, analytics, security, names, reports) | **Admin > Settings** | no |

A value saved in the app wins over `backend/.env`. "Reset to default" removes the saved value. Every change is written to the activity log (Admin > Activity log) without secret values.

## Secrets
Saved secrets (ManageEngine client secret and refresh token, mail password) are encrypted with AES-256-GCM. The key is a random file, `backend/.secret`, created on the first start. **Keep a copy of it safe**: a restored database without that file cannot decrypt the saved secrets (the values from `backend/.env` still work, or re-enter them). Never commit or share it; it is git-ignored.

## Daily deep sync
Setting keys `deep_sync_enabled` (on), `deep_sync_time` (01:00 server time), `deep_sync_catchup` (on) and `deep_sync_max_attempts` (3). It runs once a day at that time. If the PC or the app was off then, it runs once as soon as the app is back, unless a deep sync (manual or automatic) has already succeeded since that time. A failed attempt is retried after `sync_retry_minutes`, up to the attempts limit, then left until the next day.

## Backups
Set on Admin > Backups: `backup_enabled`, `backup_hour`, `backup_minute`, `backup_keep` (1 to 365), `backup_email_enabled`, `backup_email_recipients`. The two backup limits are in the table below (group "Reports & backups").

## Settings
Defaults reproduce what the app did before the setting existed.

### Sync & history
How and when the app copies SRs from ManageEngine. Changes apply to the next run; no restart is needed.

**Automatic sync**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Automatic sync every (minutes) | `auto_sync_minutes` | 30 minutes | 0 to 1440 |
| Retry a failed automatic sync after (minutes) | `sync_retry_minutes` | 5 minutes | 1 to 720 |
| Deep sync reads back to | `scan_from` | 2025-10-01 (starts from `MANAGEENGINE_SCAN_FROM` in .env) |  |
| Re-read overlap (minutes) | `sync_overlap_minutes` | 30 minutes | 0 to 1440 |
| Deep sync: most SRs checked as "no longer in ManageEngine" | `sync_removal_cap` | 300 SRs | 0 to 100000 |

**Daily deep sync**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Run a deep sync every day | `deep_sync_enabled` | On | On / Off |
| Deep sync time (server time) | `deep_sync_time` | 01:00 |  |
| Catch up if the PC or the app was off | `deep_sync_catchup` | On | On / Off |
| Attempts per day if it fails | `deep_sync_max_attempts` | 3 attempts | 1 to 10 |

**Talking to ManageEngine**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| SRs per request (page size) | `sync_page_size` | 100 SRs | 10 to 100 |
| Pause between ManageEngine calls (milliseconds) | `sync_pause_ms` | 250 ms | 0 to 10000 |
| Most pages one sync may read | `sync_max_pages` | 5000 pages | 1 to 100000 |
| Tries per ManageEngine call | `me_max_attempts` | 5 tries | 1 to 10 |
| Wait for an answer (seconds) | `me_timeout_seconds` | 45 seconds | 5 to 300 |
| Wait after "too many requests" (seconds) | `me_throttle_wait_seconds` | 20 seconds | 1 to 300 |
| First wait after a server error (seconds) | `me_backoff_seconds` | 2 seconds | 1 to 60 |
| Longest wait ManageEngine may ask for (seconds) | `me_retry_after_cap_seconds` | 120 seconds | 10 to 900 |
| Tries to get an access token | `me_token_attempts` | 4 tries | 1 to 10 |
| Ask for the technician roster again after (hours) | `roster_retry_hours` | 6 hours | 1 to 168 |

**SR history**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Collect SR history automatically | `history_auto` | On | On / Off |
| SRs read at the same time | `history_concurrency` | 4 at once (starts from `HISTORY_CONCURRENCY` in .env) | 1 to 10 |
| Rest after a collection stopped by errors (minutes) | `history_cooldown_minutes` | 15 minutes | 0 to 1440 |
| Stop after this many failures in a row | `history_max_failures` | 25 failures | 1 to 1000 |
| Stop after this many "too many requests" in a row | `history_max_throttled` | 3 answers | 1 to 100 |
| Change-log pages read per SR | `history_max_pages` | 60 pages | 1 to 500 |
| Newest change-log pages added for very long logs | `history_tail_pages` | 11 pages | 0 to 100 |
| Runs listed in "Sync history" | `sync_history_rows` | 30 runs | 5 to 500 |

### Analytics
How the figures are measured, grouped and ranked. A change recalculates every screen and Excel report at once.

**Closing-time targets**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| First target (days) | `target_days_1` | 1 days | 1 to 365 |
| Second target (days) | `target_days_2` | 3 days | 1 to 365 |
| Third target (days) | `target_days_3` | 7 days | 1 to 365 |
| First reply target 1 (minutes) | `first_reply_target_1_minutes` | 60 minutes | 1 to 43200 |
| First reply target 2 (minutes) | `first_reply_target_2_minutes` | 1440 minutes | 1 to 43200 |
| Open SR "gone quiet" after (days) | `stale_days_1` | 7 days | 1 to 365 |
| Open SR "long quiet" after (days) | `stale_days_2` | 14 days | 1 to 365 |
| Count weekends in turnaround | `count_weekends` | On | On / Off |

**Buckets**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Time-to-close buckets (days) | `tat_bucket_edges` | 1,3,7,14,28 days | 1 to 3650 |
| Age of open SRs / idle time buckets (days) | `aging_bucket_edges` | 1,3,7,14,28 days | 1 to 3650 |
| First-reply buckets (minutes) | `reply_bucket_edges` | 15,60,240,1440,4320 minutes | 1 to 525600 |
| Reassignment buckets: top bucket starts at | `reassign_bucket_max` | 3 times | 1 to 10 |

**Ranking, windows & lists**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Closed SRs needed to be ranked | `min_ranked_closed` | 5 SRs | 1 to 1000 |
| Due-time figures need at least | `min_due_sample` | 20 SRs | 1 to 100000 |
| "Recent" window (days) | `recent_window_days` | 30 days | 1 to 365 |
| Technicians in top-N charts | `top_n_charts` | 12 people | 3 to 50 |
| Technicians in the month-by-month table | `top_n_matrix` | 20 people | 5 to 100 |
| People in "handed over to / received from" | `top_n_handovers` | 8 people | 3 to 50 |
| Strengths / watch points listed per technician | `top_n_story` | 4 items | 1 to 10 |

**Insight wording**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| On-time share counted as good (%) | `insight_sla_good_pct` | 90 % | 1 to 100 |
| On-time share counted as bad (%) | `insight_sla_bad_pct` | 70 % | 0 to 99 |
| Difference from the team that is worth a remark (%) | `insight_diff_pct` | 10 % | 1 to 100 |
| Target gap that is worth a remark (points) | `insight_gap_points` | 5 points | 1 to 50 |
| Slowest tenth: warn when this many times the team's | `insight_p90_ratio` | 1.5 | 1 to 10 |

**Defaults for everyone**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| How turnaround is measured by default | `default_basis` | assigned |  |
| Figure shown first for times | `default_aggregation` | average |  |
| Period shown when nobody has chosen one | `default_preset` | all |  |
| Rows per page in SR lists | `default_page_size` | 25 |  |
| Largest page the server will return | `records_max_page_size` | 500 rows | 50 to 5000 |

### Security
Sessions, sign-in lockout, passwords and request limits. New limits apply to the next request or sign-in.

**Sessions**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Sign out after being idle for (hours) | `session_idle_hours` | 12 hours | 1 to 720 |
| Longest a sign-in may last (days) | `session_max_days` | 7 days | 1 to 365 |

**Sign-in lockout**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Wrong passwords before an account is locked | `login_max_attempts` | 5 attempts | 3 to 100 |
| Account lock lasts (minutes) | `login_lock_minutes` | 15 minutes | 1 to 1440 |
| Wrong passwords before an address is locked | `ip_max_attempts` | 30 attempts | 5 to 1000 |
| Address lock lasts (minutes) | `ip_lock_minutes` | 15 minutes | 1 to 1440 |

**Passwords**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Shortest password | `password_min_length` | 8 characters | 6 to 64 |
| Require upper and lower case letters | `password_require_mixed_case` | Off | On / Off |
| Require a number | `password_require_digit` | Off | On / Off |
| Require a symbol (such as ! # $) | `password_require_symbol` | Off | On / Off |
| Refuse very common passwords | `password_block_common` | On | On / Off |

**Requests & exports**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| API requests per minute from one address | `rate_limit_per_min` | 900 requests (starts from `RATE_LIMIT_PER_MIN` in .env) | 30 to 100000 |
| Excel reports prepared at the same time | `max_concurrent_exports` | 2 reports | 1 to 20 |

**Password reset**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Let people reset a forgotten password by email | `password_reset_enabled` | On | On / Off |
| Reset link stays valid for (minutes) | `password_reset_minutes` | 60 minutes | 10 to 1440 |
| Wait between reset emails to the same address (minutes) | `password_reset_gap_minutes` | 2 minutes | 0 to 60 |
| Reset requests per hour from one address | `password_reset_ip_per_hour` | 10 requests | 1 to 500 |

### Identity
The names, texts and time zone shown to your people.

**Names**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Application name | `app_name` | ManageEngine Analytics | text, up to 60 characters |
| Organisation name | `org_name` | (blank) | text, up to 80 characters |
| Web address people use to open this app | `public_url` | (blank) | text, up to 200 characters |
| Sidebar subtitle | `sidebar_subtitle` | Service desk | text, up to 40 characters |

**Sign-in page**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Sign-in page subtitle | `login_subtitle` | Service desk performance | text, up to 60 characters |
| Sign-in page headline | `login_headline` | See how every technician is really performing. | text, up to 120 characters |
| Sign-in page paragraph | `login_blurb` | Turnaround, backlog and due-time performance for every SR in ManageEngine, measured from the moment it was assigned or raised. | text, up to 300 characters |
| Sign-in page footer line | `login_footer` | Syncs with ManageEngine automatically | text, up to 100 characters |
| Support email shown on the sign-in page | `support_email` | (blank) |  |

**Time zone**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| ManageEngine portal time zone | `portal_time_zone` | Asia/Kolkata (starts from `MANAGEENGINE_TIME_ZONE` in .env) |  |

### Reports & backups
Excel file names, titles and size limits, and the backup email limits.

**Excel files**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| File-name prefix | `report_file_prefix` | ManageEngine_Analytics |  |
| Report title prefix | `report_title_prefix` | (blank) | text, up to 60 characters |

**Limits**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Most rows in a chart/table export | `report_max_rows` | 100000 rows | 1000 to 1000000 |
| Most SR rows in a full report | `report_max_sr_rows` | 1000000 rows | 1000 to 1048000 |
| Most sheets in a chart/table export | `report_max_sheets` | 12 sheets | 1 to 50 |
| Most columns on a sheet in a chart/table export | `report_max_columns` | 60 columns | 1 to 200 |

**Backup limits**

| Setting | Key | Default | Allowed |
|---|---|---|---|
| Largest backup to attach to an email (MB) | `backup_email_max_mb` | 20 MB (starts from `BACKUP_EMAIL_MAX_MB` in .env) | 1 to 100 |
| Attempts per day when a backup fails | `backup_max_attempts` | 3 attempts | 1 to 20 |

## Connections (Admin > Connections)
- ManageEngine: accounts server (OAuth), API domain, portal name, client ID, client secret*, refresh token*.
- Email (SMTP): server, port, encryption, user name, password*, sender name, sender address.
(* encrypted at rest, never shown again.) "Test connection" and "Send a test email" accept unsaved values.

## Kept fixed on purpose
ManageEngine's own limit of 100 rows per call, the 200-character password maximum, the 60-second scheduler tick, the analytics cache timings, the 60-second rate-limit window and the request timeout and body-size limits.
