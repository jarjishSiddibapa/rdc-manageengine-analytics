# ManageEngine Analytics

A complete analytics application for ManageEngine ServiceDesk Plus Cloud: how long every technician takes to close SRs, how SRs are handled (reassignments, reopens, first replies, holds), team dashboards, SR lists, Excel reports and user management. It only ever **reads** from ManageEngine.

## Start it

You need **Node.js 20 or newer** (<https://nodejs.org>) and a running **MySQL** server.

Double-click **`startup.bat`**. It checks Node.js, `backend\.env`, that the port is free and that MySQL is reachable (and says plainly what to fix if not), installs packages and builds the screens on the first run (and again whenever the screen source is newer than the last build); after that it just starts.
Open <http://localhost:7780> and keep the window open while you use it. Close it, or press Ctrl+C, to stop (the app finishes what it is doing and shuts down cleanly).

- Database: `manageengine_analytics` (MySQL; created automatically on first start).
- Settings live in `backend/.env` (database, ManageEngine OAuth, port). Copy `backend/.env.example` to `backend/.env` to start a new one. By default the app listens on `127.0.0.1` (this PC only); set `HOST=0.0.0.0` to share it on your network (put it behind HTTPS if it leaves a trusted network, and set `TRUST_PROXY` if a reverse proxy sits in front).

## Signing in

The first start (only when there are no users yet) creates the administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `backend/.env`.
If `ADMIN_PASSWORD` is not set, a random temporary password is printed once in the console and must be changed at the first sign-in.
Change your password from the Account page after your first sign-in (8 to 200 characters; very common passwords are refused).

| Role | Can do |
|---|---|
| Administrator | Everything, including Admin: users, activity log, settings |
| Manager | All analytics, and run syncs |
| Viewer | All analytics (read only) |

Admin → Users: create, edit, reset passwords (a temporary password forces a change at next sign-in), disable, delete and sign users out. The last active administrator can't be removed. Disabling, deleting, changing the role of, or resetting the password of a user signs them out of every device immediately.

Security in short: passwords are stored as salted scrypt hashes; the session cookie is HttpOnly and only its hash is stored in the database; every write request must carry the app's `X-Requested-With` header (so other websites cannot act on a signed-in browser); roles are enforced on the server for every route. By default five wrong passwords lock that email on that address for 15 minutes (30 from one address locks the address), and sessions last 12 hours of inactivity and never more than 7 days in total; these limits, the password rules and the request limit are settings (Admin → Settings → Security). Everything that matters (sign-ins and failures, user changes, settings, syncs, report downloads, refused actions) is written to Admin → Activity.

## How turnaround is measured

Two switches sit at the top of the analytics pages. The first decides where the clock starts; the second (**Average | Median**, Average by default) decides which figure leads for times, with the other always shown beside it. Neither is remembered between visits: each visit starts from the defaults set in Admin > Settings. Where the clock starts:

- **Since assigned** (default): from when ManageEngine assigned the SR to its current technician until it was completed. SRs never assigned (or assigned after they closed) fall back to the raised time.
- **Since raised**: from when the requester raised it until it was completed.

Calendar time, weekends included. ManageEngine sets almost no due times on this portal, so due-time/overdue figures are hidden and "closed within 1 / 3 / 7 days" is used instead (they appear automatically if due times are ever populated).

## Syncing

- **Sync SRs** – only SRs changed since the last sync (seconds).
- **Deep Sync SRs** – re-reads every SR, newest to oldest, and flags SRs ManageEngine no longer has.
- **Automatic** – a Sync runs every 30 minutes, and a **Deep sync runs once a day at 01:00** (server time). If the PC or the app was off at that time, the deep sync runs once as soon as the app is back (unless one has succeeded since). A failed attempt is retried (up to 3 times a day). It never overlaps another sync. Every time, interval, retry limit and the on/off switches are on Admin → Settings → Sync & history. The very first run is always a deep sync.

## SR history

For every SR the app also reads ManageEngine's change log and keeps: who it was assigned to and when (reassignment count and handover path), reopens, first-contact-resolution flag, first reply time, replies, time to assign, worklogs, time on hold, notes, and a full **timeline**. This is collected in the background after each sync (the first complete collection of ~60,000 SRs takes about two hours; progress and manual start/stop/rebuild are on **Data & sync**). Figures cover SRs whose history is collected; the dashboards say how many that is.

Click any SR number to see its details, handling figures and timeline, or download that single SR as Excel.

## Downloads

Every chart has a **Download** menu (PNG picture, Excel, CSV of exactly the numbers drawn). Dashboard, technician and SR-list pages have full Excel reports built on the server with real number/date formats. A report covering every SR (60,000+ rows) takes several seconds to prepare; at most two are prepared at a time, so a third click shows "try again in a few seconds".

## Command line

```
cd backend
npm run sync          # quick sync
npm run sync:deep     # deep sync
```

## Database backups and email

Admin → **Backups** makes a complete copy of the database (SRs, history, users, settings; not the sign-in sessions) with `mysqldump`, once a day at the time you set (default 02:00), into `backend\db-backup\`. If the PC was off at that time, a backup runs when the app next starts. The newest N backups are kept (default 14). A dump is kept only when it finished completely. You can run one now, download or delete any, and the tab shows how to restore. Optionally each backup is **emailed** (compressed, to the addresses you list) and a failure email is sent when a backup fails; enter the mail account under Admin → Connections and use *Send a test email*. Backups contain password hashes and all SR data: keep the folder and the emails private. Details: `docs/OPERATIONS.md`.

## Forgot password

When email is set up, the sign-in page offers **Forgot your password?**: the person enters their email address and receives a link (valid once, 60 minutes by default) to choose a new password; they are signed out everywhere and a notice is emailed. Set **Web address** under Admin → Settings → Identity so the link opens on the right address, and switch the feature off or tune its limits under Settings → Security → Password reset. Without email, an administrator resets passwords under Admin → Users.

## Working on the code (and saving tokens)

- `AGENTS.md` (also imported by `CLAUDE.md`) holds the rules and project knowledge for AI assistants; `docs/PROGRESS.md` says exactly where the work stands, so a new session can continue without re-reading everything.
- A **graphify** knowledge graph of the code is in `graphify-out/`: ask `graphify query "<question>"` before opening files, and run `graphify update .` after changing code.
- `docs/ARCHITECTURE.md` (how it fits together), `docs/OPERATIONS.md` (run, sync, backups, restore), `docs/CONFIGURATION.md` (every setting), `docs/CHANGELOG.md` (what changed and why).

## Settings and connections on the Admin screen

Nothing the business might want to change is fixed in the code. Admin → **Settings** (grouped: Sync & history, Analytics, Security, Identity, Reports & backups) holds every target, bucket, limit, schedule, name and text, each with help text, its default, a per-field and per-section *Reset to default*, and a warning before you leave with unsaved changes. Changes apply at once; no restart is needed. Admin → **Connections** holds the ManageEngine (OAuth) and email (SMTP) details with *Test connection* buttons. A value saved there overrides `backend/.env`; a blank one falls back to `.env`, so an install configured only through `.env` keeps working. Secrets (client secret, refresh token, mail password) are stored **encrypted** (AES-256-GCM) with a random key in `backend/.secret` (created on the first start, git-ignored; keep a copy, never share it), are never sent back to the browser and never written to the activity log. Every change is recorded in Admin → Activity (field names only for secrets).

## Settings in `backend/.env`

Only the database, `PORT`, `HOST` and `TRUST_PROXY` (and the first-administrator lines) must be here; everything else in `.env.example` is just the starting value for something that can then be changed on the Admin screen.

| Setting | Meaning |
|---|---|
| `PORT`, `HOST` | Where the app listens (default `7780` on `127.0.0.1`). |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection. `DB_POOL_SIZE` (default 10) sets the connection pool. |
| `MANAGEENGINE_*` | ManageEngine OAuth and portal details (see `.env.example`). |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First administrator, used only while there are no users. |
| `TRUST_PROXY` | Number of reverse proxies in front of the app (so lockouts and the activity log see the real address). |
| `RATE_LIMIT_PER_MIN` | Requests per minute allowed from one address (default 900). |
| `NO_BACKGROUND=1` | Web server only: no automatic sync or history collection. For running a second copy against the same database. |

## Notes

- ManageEngine OAuth scope used: `SDPOnDemand.requests.READ`. Adding `SDPOnDemand.setup.READ` would also list technicians who have no SRs.
- The old *Deloitte SR Analytics* database (`deloitte_sr_analytics`) is no longer used and can be dropped.
