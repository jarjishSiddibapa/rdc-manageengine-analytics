# Operations guide

## Start and stop
- Start: double-click `startup.bat` (installs packages and builds the screens on first run). Open http://localhost:7780 and keep the window open.
- Stop: close the window (or Ctrl+C). The app shuts down cleanly.
- Only one copy should run per database. A second copy for testing: set `PORT` to a spare port and `NO_BACKGROUND=1` so it does not start syncs or backups.

## Settings you must provide (`backend/.env`, see `backend/.env.example`)
Database (`DB_*`), the web server (`PORT`, `HOST`, `TRUST_PROXY`), the ManageEngine connection (`MANAGEENGINE_*`) and the first administrator (`ADMIN_*`). Everything else is configured in the app under **Admin → Settings / Connections / Backups** (see `CONFIGURATION.md`).

## Syncs
| What | When | Notes |
|---|---|---|
| Sync SRs (quick) | every N minutes (default 30), or the button | only SRs changed since the last sync |
| Deep Sync SRs | every day at the configured time (default 01:00), or the button | re-reads every SR and flags the ones ManageEngine no longer has |
| History collection | in the background after syncs | first complete collection of ~64,000 SRs takes about two hours |

If the PC is off at the deep-sync time, the deep sync runs when the app next starts. ManageEngine throttles heavy use; the app backs off and retries by itself.

## Database backups (Admin → Backups)
- **Method**: `mysqldump` of the whole database into one `.sql` file in `backend\db-backup\` (restores on any MySQL server). Done daily at the configured time; if the PC was off, a catch-up backup runs on the next start. The newest N backups are kept (default 14). `sessions` are not included.
- **Checks**: a dump is only kept when it finished (ends with the `-- Dump completed` line); partial files are discarded.
- **Email** (optional): each backup is emailed, compressed (.gz), to the recipients you list; backups too big to attach (default over 20 MB compressed) are not attached and the email says where the file is. A failure email is sent when a backup fails. Use **Send a test email** to check the setup.
- **Email setup**: put `SMTP_USER` and `SMTP_PASS` in `backend\.env` (Gmail: an *App password*, not the normal password; `SMTP_HOST` defaults to smtp.gmail.com, port 587) or enter them under Admin → Connections, then restart.
- **mysqldump** is found automatically in `C:\Program Files\MySQL\...`; otherwise set `MYSQLDUMP_PATH`.

### Restore
1. Close the app. 2. Get the `.sql` (unzip the `.gz` from an email). 3. In a Command Prompt: `mysql -u root -p < manageengine-analytics-YYYYMMDD-HHMMSS.sql`. 4. Start the app; people sign in again.
This replaces the whole `manageengine_analytics` database with the backup's state.

## Forgot password (by email)
- The sign-in page shows **Forgot your password?** when it is switched on (Admin > Settings > Security > Password reset) **and** email is set up (Admin > Connections). People enter their address and get a link that works once and expires (default 60 minutes). Choosing a new password signs them out everywhere and a notice goes to their mailbox. Every step is in the Activity log.
- The link points to the **web address** under Admin > Settings > Identity > Names. Leave it blank and the link is `http://localhost:7780/...`, which only opens on the PC that runs the app; set it to the address people really use (for example `http://servername:7780`). It is never taken from the browser, so a forged request cannot point the email elsewhere.
- The page always answers the same ("if that address belongs to an account..."), so nobody can find out who has an account. Disabled accounts and unknown addresses get no email. Limits: one email per address per 2 minutes, 10 requests per hour per computer; wrong links pause that computer like wrong passwords do (same Settings).
- If email is not set up, or the feature is off, the link is hidden and an administrator resets passwords under Admin > Users.

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `startup.bat` says port in use | another copy (or the old Deloitte app) is running on 7780; close it |
| "Cannot reach MySQL" | start the MySQL service; check `DB_HOST` / `DB_PORT` |
| History runs fail with "too many requests" | ManageEngine is throttling; it cools down and resumes. Do not run several copies at once |
| Sync says "not authorised" | the refresh token in `.env` / Connections expired or lacks `SDPOnDemand.requests.READ` |
| Backup fails: mysqldump not found | install MySQL tools or set `MYSQLDUMP_PATH` |
| Backup email "Not sent" | SMTP details wrong, or the provider blocks the sign-in (Gmail needs an app password) |
| Locked out of sign-in | wait 15 minutes, or another administrator resets the password |
| "Forgot your password?" missing | email is not set up (Admin > Connections) or the feature is off (Settings > Security) |
| Reset email never arrives | check the spam folder; Admin > Activity log shows "Asked for a password reset link" with the reason (no email sent / could not be sent) |
| Reset link opens "localhost" and fails on another PC | set the web address under Settings > Identity > Names |

## Security checklist
Change the default administrator password after the first sign-in. Keep `HOST=127.0.0.1` unless you want to share the app, and then put it behind HTTPS. Treat `backend\db-backup` and backup emails as sensitive.
