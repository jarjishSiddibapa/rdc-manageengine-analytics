# Changelog

Newest first. One line per change that matters to a person using or maintaining the app.

## 2026-10-28 (latest)
- **Average / Median switch**: a second switch at the top (Average | Median, default **Average**, default configurable in Settings > Defaults for everyone) decides which figure leads for turnaround, first reply, time to assign and similar times: KPI order, ranking, scatter, fastest list, group charts, sparkline, story text, table column order. The other figure is always beside it (KPI sub-line, tooltips: 'average X · median Y'). New server fields: average first reply per month, average per technician-month, rank by average, average-led insight text; Excel puts average before median. Stored in the address as ?agg=median, not remembered between visits.
- **Tooltips**: a tooltip with several figures (average, median, count) now stacks one figure per line and wraps, so text is never wider than its box (it was cut off in the technician bar charts). **Top bar**: switches, status and sync buttons now share one group that shrinks gracefully: icon-only sync buttons below 1300 px, the Synced text hidden below 1180 px, tighter spacing below 1000 px; one row from 901 px up.
- **Basis default**: every fresh open starts on the default basis (since assigned); a choice lives only in the address for that visit.
- **Flicker and layout**: the sync poll no longer redraws the top bar (memoised switches and buttons, CSS spinner, fixed-width tabular counter); 'How to read this' sentences flow as normal text; card headers wrap on narrow screens; scatter labels stay inside the plot; the phone top bar can no longer be pushed wide by the sync counter. Tested 320 to 1920 px on every page with no horizontal overflow; Excel suite 264/0 and role suite 16/0 still pass.

## 2026-10-28 (later)
- **Forgot password by email**: "Forgot your password?" on the sign-in page, a single-use expiring link (only its hash is stored), a new "choose a new password" page, signs the person out everywhere, a "password was changed" notice, activity-log entries. Same answer whether or not the address has an account; no email for disabled accounts; per-address email gap, hourly cap and wrong-link pause. New table `password_resets` (not in backups), settings `password_reset_*` and `public_url` (the link's address; never taken from the Host header, unlike the reference app). Wrong-link pause uses the existing sign-in address limits. 50-check API suite plus a browser walk-through.

## 2026-10-28
- **Backups**: daily `mysqldump` backups with catch-up after downtime, keep-newest-N retention, completeness check, history screen (Admin → Backups), download/delete, run-now (background), email of each backup (compressed) and failure alert emails, test email. Table `backup_runs`; settings `backup_*`.
- **Email**: `services/mailer.js` (nodemailer). Optional; configured with `SMTP_*`.
- **Daily deep sync** at 01:00 (configurable time, on/off, catch-up if the PC was off, retry limit); the weekly hardcoded one is gone. Quick sync no longer starts beside it.
- **Configurable everything**: 90 settings in a validated registry (`settings.js`) shown on Admin → Settings (sync, analytics buckets/targets/weekends, security limits and password rules, names and login texts, time zone, report limits, backup email limit and attempts). **Admin → Connections** holds the ManageEngine and SMTP details, secrets encrypted (AES-256-GCM, key in `backend/.secret`), overriding `.env`. Full list: `CONFIGURATION.md` (generated from the registry).
- **Docs for assistants**: `docs/PROGRESS.md` (live hand-off state), `AGENTS.md`, `CLAUDE.md`, graphify graph.
- **graphify** knowledge graph set up (`graphify-out/`, `.graphifyignore`), with `AGENTS.md` / `CLAUDE.md` rules for token-efficient work.

## 2026-10-27 — audit and optimisation (five parallel reviews)
- **Data (analytics)**: eight bugs fixed (backlog inflated by never-dated Closed SRs; "No reply yet" had three definitions; reopened and flow drills did not match their totals; ties/unassigned ranking; empty values sorted first; first reply measured from the wrong start for late-assigned SRs; a crash above ~120k SRs; request-type filter). First loads 130–1,250 ms, repeat views 10–35 ms (was 1.4–4 s).
- **Data (ingestion)**: shared OAuth token and throttle backoff (ended an outage that locked ManageEngine out for ~35 min); histories over 4,000 events no longer truncated silently; reopen counting fixed for old-format SRs and hand edits; HTTP 400 no longer wipes a stored history; named locks stop overlapping runs; deep sync checks each SR by id before flagging it removed.
- **Backend**: scrypt N=32768 with parameters stored in the hash; per-address lockout and rate limit; CSP and security headers; gzip; consistent JSON errors; last-admin protection in a transaction; streaming Excel export (63k rows: 17 s / 2.1 GB → 6–10 s / ~670 MB); new indexes; `startup.bat` checks (port, MySQL, Node, packages).
- **Frontend**: lazy routes (login 869 kB vs 1,774 kB before), mobile drawer + bottom nav + filter sheet, URL-persisted filters and table state, request cancellation, accessible dialogs/skip link/focus, login improvements, admin search/filters, history ETA, richer charts with zoom/expand/table view, KPI definitions, SR viewer timeline.

## 2026-10-26 and earlier
- First complete version: ManageEngine sync (quick/deep/auto), assigned vs raised analytics, per-technician analysis, SR history (reassignments, reopens, replies, holds), Excel reports (264 automated checks), user management, activity log, chart downloads.
