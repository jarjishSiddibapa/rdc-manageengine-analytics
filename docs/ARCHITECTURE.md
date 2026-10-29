# Architecture

## Data flow

```
ManageEngine SDP Cloud (read-only API)
        │  OAuth refresh token → access token (shared between processes, backoff when throttled)
        ▼
services/sync.js ──► requests            (one row per SR; quick / deep / auto sync)
services/history.js ─► request_history   (per-SR figures)  + request_events (timeline)
        │
        ▼
services/analytics.js   in-memory snapshot of requests + request_history, shaped per basis (assigned | raised),
        │               cached results (LRU), invalidated when sync/history changes the data
        ▼
routes/data.js ─► /api/analytics/*, /api/reports/*.xlsx, /api/sync/*       services/reports.js (exceljs, streaming)
routes/admin.js ─► users, activity log, settings, /backups                 services/backup.js (mysqldump + email)
        ▼
frontend (React) — one origin, served from frontend/dist by the same Express process
```

## Sync modes (services/sync.js)
- **Quick**: SRs whose `last_updated_time` is after the watermark (minus an overlap). Seconds.
- **Deep**: every SR newest → oldest back to the scan-from date; then asks ManageEngine by id about SRs it did not see before flagging them `in_scope = 0` (so a shifted page never hides an SR). Refuses to flag if the read looks incomplete.
- **Auto**: a scheduler ticks every minute: quick sync every N minutes, deep sync once a day at a set time (with catch-up if the app was off).
- Locks: MySQL named locks `<DB_NAME>:sync`, `:history`, `:backup` make runs exclusive across all running copies of the app.

## History (services/history.js)
After syncs, a worker pool fetches `/requests/{id}/history` for SRs that have none or whose `last_updated_at` changed (open SRs first, newest first). `parseHistory` turns events into assignments, reassignments, handover path, first reply, replies, reopens, FCR, holds, closed gaps, worklogs, notes, attachments, plus the timeline rows. Very long histories keep the oldest 6,000 and newest 1,100 events and are flagged truncated. A throttled run stops and cools down.

## Analytics (services/analytics.js)
- The whole table is read once into a snapshot (about 64,000 SRs) and shaped per basis. Results are cached by filter key; a cheap fingerprint query notices data changes.
- `assigned` basis: turnaround = completed − assigned (fallback to raised when never assigned or assigned after closing). `raised` basis: completed − created.
- Every chart/KPI has a drill predicate that returns exactly the SRs behind the number (totals are tested to match).

## Security model
- Passwords: scrypt (parameters stored in the hash; old hashes upgraded on login). Sessions: random token, only its hash stored; HttpOnly SameSite cookie; idle and absolute lifetimes; revoked on disable, role change, password change and delete.
- Password reset by email (`services/passwordReset.js`): random 256-bit token, only its SHA-256 stored (`password_resets`), single use (consumed in the same transaction that changes the password), expires, signs the person out everywhere. The emailed address comes from the `public_url` setting, never from the Host header. Public endpoints: `/auth/forgot-password`, `/auth/reset-password/check`, `/auth/reset-password`.
- Writes need the `X-Requested-With: ManageEngineAnalytics` header. Roles are enforced on the server for every route.
- Lockouts per account and per address; per-address API rate limit; strict CSP and other security headers; errors never include stack traces or SQL.
- Backups omit the `sessions` table. Emailed backups contain user password hashes and all SR data: send them only to trusted addresses.

## Frontend
- Lazy routes with a vendor `react` chunk; charts and tables load with the page that needs them.
- Filters live in the URL (and localStorage) and carry across analytics pages; table state (page, size, sort, search) lives in the URL too.
- `useLoad` cancels stale requests (AbortController) and keeps the previous data while reloading.
- Every chart card has Download (PNG / Excel / CSV), zoom, expand and "view as table".
