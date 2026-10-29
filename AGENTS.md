## graphify

This project has a knowledge graph at `graphify-out/` (god nodes, communities, cross-file relationships). Use it before reading source: it returns a small, scoped answer instead of whole files, which is what saves tokens.

Rules:
- For any question about the code, first run `graphify query "<question>"` (graph at `graphify-out/graph.json`). Use `graphify path "<A>" "<B>"` for how two things connect and `graphify explain "<concept>"` for one concept. Exit code 3 = ambiguous name, 4 = no match; rephrase with a file or function name.
- Read `graphify-out/GRAPH_REPORT.md` only for a broad architecture review or when query/path/explain are not enough. Then open only the specific files and line ranges the graph points to.
- After changing code, run `graphify update .` from the project root (code only, no LLM cost, a few seconds). A stale graph misleads the next session.
- `.graphifyignore` keeps `node_modules`, `frontend/dist`, `backend/db-backup`, tool folders and logs out of the graph. `graphify-out/` is generated: do not edit it by hand.
- When the user types `/graphify`, invoke the graphify skill first.

Token-saving habits for this repo:
1. `graphify query` first, then `Read` with `offset`/`limit` on the one function. Never read `analytics.js` (about 1,300 lines) or `reports.js` whole.
2. Do not read `package-lock.json`, `frontend/dist/`, `graphify-out/cache/` or `backend/db-backup/`.
3. Start every session by reading `docs/PROGRESS.md` (current state, open gaps, what needs the user) and finish every piece of work by updating it, so a session that ends early (credits, context) can be continued exactly from there.
4. Prefer the docs below over re-deriving behaviour from code: `docs/ARCHITECTURE.md` (how it fits together), `docs/OPERATIONS.md` (run, sync, backups, email, restore), `docs/CONFIGURATION.md` (every setting), `docs/CHANGELOG.md` (what changed and why).
5. Long-running or noisy commands (syncs, builds, test suites) go to a file or the background; read only the tail.

---

## Project knowledge

### What this is
ManageEngine Analytics: a read-only analytics web app over ManageEngine ServiceDesk Plus Cloud. It copies SRs (service requests) and each SR's change history into MySQL, then shows turnaround, handling quality (reassignments, reopens, first reply, holds), per-technician performance, Excel reports, user management and database backups. It never writes to ManageEngine (OAuth scope `SDPOnDemand.requests.READ` only).

### Stack
- Backend: Node 20+, Express 5, `mysql2/promise` (pool, `dateStrings: true`, no ORM), `exceljs`, `node-cron`, `nodemailer`, `compression`. Sessions: random token in an HttpOnly cookie `mea_session` (hash stored), scrypt passwords, header `X-Requested-With: ManageEngineAnalytics` required on every write.
- Frontend: React 19, antd 6, Vite 8, recharts, react-router-dom, dayjs. One origin: the backend serves `frontend/dist` and `/api`.
- Roles: `admin` (everything), `manager` (analytics and run syncs), `viewer` (analytics only).
- Database `manageengine_analytics`, port 7780, `HOST=127.0.0.1` by default. Config in `backend/.env` (see `backend/.env.example`).

### Layout
```
startup.bat                      installs, builds, starts (double-click)
backend/server.js                app wiring, security headers, rate limit, static files, error shape, graceful shutdown
backend/db/database.js           CREATE TABLE IF NOT EXISTS + idempotent indexes (initDb)
backend/services/
  manageengine.js                SDP API client: OAuth refresh (shared token, backoff), paging, request history
  sync.js                        quick / deep / auto sync, scheduler, locks, deletion detection
  history.js                     per-SR change-log collector (worker pool) + parseHistory
  analytics.js                   all numbers: in-memory snapshot, basis logic (assigned vs raised), cache, drills
  reports.js                     Excel exports (streaming exceljs), records/dashboard/technician/SR reports
  settings.js                    settings registry (~91, schema = validation + default + Admin screen); everything configurable lives here
  connections.js / secrets.js    ManageEngine + SMTP details (DB value overrides .env), secrets AES-256-GCM, key in backend/.secret
  passwordReset.js               forgot-password by email: hashed single-use tokens, limits, link address from the public_url setting
  auth.js / audit.js             sessions, lockouts, roles; activity log
  backup.js / mailer.js          mysqldump backups (+retention, catch-up, email); SMTP mail
backend/routes/                  auth, data (analytics/reports/sync), admin (users, audit, settings), backups
frontend/src/
  App.jsx, layout/AppShell.jsx   routes (lazy), shell, mobile drawer + bottom nav
  context/                       Auth, Filters (URL + localStorage), Sync (polling), SRViewer (modal)
  pages/                         Dashboard, Technicians, TechnicianProfile, SRs, DataSync, Admin, AdminBackups, Account, Login
  components/                    charts.jsx (ChartCard with zoom/downloads), Kpi, RecordsTable, sections, HandlingSection, DrillDrawer
  services/api.js                fetch wrapper (cookie, CSRF header, abort, 401 handling)
```

### Data model (tables)
`requests` (one row per SR, `me_id` PK, `in_scope`), `request_history` (one row per SR: counts, times, windows), `request_events` (timeline), `sync_runs` (quick/deep/history runs), `users`, `sessions`, `audit_log`, `settings` (key/value), `backup_runs`.

### Rules of the road
- Default analytics basis is **assigned to completed**; the alternative is raised to completed. SRs never assigned (or assigned after closing) fall back to raised. Calendar time, weekends included. Times are wall-clock strings in the portal time zone.
- Never write to ManageEngine. Never delete SR rows (a deep sync only flags `in_scope = 0`).
- Only one sync, one history collector and one backup may run at a time across all copies of the app: they hold MySQL named locks `<DB_NAME>:sync|history|backup`. Extra test copies must set `NO_BACKGROUND=1` and a different `PORT`, or they will start syncs against ManageEngine (which rate-limits).
- New tunable values go in `settings.js` (default + validation), not as constants.
- Backups never include the `sessions` table.

### How changes get verified
1. `node --check` on touched backend files; `npx vite build` in `frontend/` (the final build goes into `frontend/dist`, so stop other work first).
2. Excel suite (264 checks) and security/role suites live in the session scratchpad; the pattern is: start the server on a spare port with `NO_BACKGROUND=1`, log in as the admin from `backend/.env`, hit the API, compare to raw SQL.
3. Browser check of the changed screens at 375 px and desktop width, console clean.
4. Run `graphify update .` and add a line to `docs/CHANGELOG.md`.

### Gotchas
- MySQL reserved words (`stored`) cannot be column aliases.
- `analytics.js` keeps a shared in-memory snapshot of all SRs; call `invalidateCache()` after writes that change SR data.
- Bash heredocs containing apostrophes break in this environment; write scripts with the Write tool.
- ManageEngine's `too many requests` shows up as HTTP 400 from the token endpoint; the client backs off and shares one token across processes.
