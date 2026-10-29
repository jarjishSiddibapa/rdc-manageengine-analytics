# Progress and hand-off

Keep this file current. It is the first thing a new session (or a person) reads to continue exactly where the last one stopped, without re-deriving anything. Update it at the end of every piece of work, before starting the next one.

Last updated: 2026-10-28 (Average/Median switch, flicker and layout fixes added).

## State: all requested work is built and tested

| Area | State | Evidence |
|---|---|---|
| Audit and optimisation (data, ingestion, backend, two frontend reviews) | done | see CHANGELOG.md, 2026-10-27 |
| Zoomable, downloadable charts | done | chart cards have zoom, expand, table view, PNG/Excel/CSV |
| Database backups + email (same method as the reference app: mysqldump, daily, keep N, catch-up, email) | done | API suite 64/64, real 136 MB dump, mock SMTP |
| Daily deep sync at 01:00 (configurable, catch-up, retry) | done | 25 schedule cases + in-process run, unit suite 52/0 |
| Everything configurable (90 settings, encrypted Connections for ManageEngine and SMTP) | done | API suite 203/0; CONFIGURATION.md is generated from the registry |
| graphify graph + AGENTS.md / CLAUDE.md + docs | done | graphify-out/ rebuilt after the last change |
| Forgot password by email (link, reset page, limits, notice, audit) | done | reset suite 50/50 + browser walk-through desktop and 375 px; see OPERATIONS.md |
| Average / Median switch (default Average), flicker fix, layout tested 320-1920 px | done | Excel 264/0, roles 16/0, browser probe on every page at 320, 375, 820, 1024, 1365, 1920 px |
| Regression | passing | Excel suite 264/0, role suite 16/0, backup suite 64/0 (last run 2026-10-28 on a clean server) |
| Browser check (desktop and 375 px): Backups, Settings, Connections, dashboard | done | no horizontal overflow, console clean apart from the expected pre-sign-in 401 |

## Needs the user (cannot be done by the assistant)
1. Close any old "Deloitte" copy on port 7780, then double-click startup.bat.
2. Change the default administrator password after the first sign-in.
3. Email: enter the mail account under Admin > Connections (Gmail needs an App password), then "Send a test email". The reference app's credentials were not copied.
4. Keep a copy of backend\.secret (it decrypts the saved passwords). Backups do not include it.
5. Optional: `graphify hook install` and `graphify install --project --platform claude` (the permission system blocked the assistant from installing git/Claude hooks). Without them run `graphify update .` after code changes.
6. The old database deloitte_sr_analytics can be dropped.

## Known gaps (honest list)
- Not tested on a real touch device: pinch zoom on charts. Not tested: the download buttons on the newest heatmap and scatter charts.
- Email was tested against a local fake mail server only, not a real mailbox.
- About 58 SRs removed from ManageEngine are not flagged until the next Deep Sync (the 01:00 daily one does it). A few hundred SR histories affected by earlier parsing bugs are re-read when ManageEngine reports a change; they were not force re-queued.
- The unsaved-changes guard on the Settings screen does not cover the browser Back button.
- ManageEngine sets no due times, so due and overdue figures are hidden.
- Dark mode was not built.
- Forgot password was tested with a local fake mail server, not a real mailbox. For links to open from other PCs, set Settings > Identity > Names > Web address.
- Not implemented (offered): workload-reminder emails and the welcome email for new users from the reference app.

## How to continue (token-saving)
1. `graphify query "<question>"` before reading code; docs/ARCHITECTURE.md, OPERATIONS.md and CONFIGURATION.md for behaviour and settings.
2. New tunable values go in backend/services/settings.js (a schema entry gives validation, default, Admin screen and doc).
3. To verify a change: `node --check`, `npx vite build` in frontend/, then the suites (see AGENTS.md > How changes get verified). Extra test servers must use NO_BACKGROUND=1 and another PORT.
4. Regenerate CONFIGURATION.md after changing the settings schema (pattern: require settings.js, write tables from SCHEMA, GROUPS and DEFAULTS).
5. Finish by running `graphify update .`, adding a line to CHANGELOG.md and updating this file.

## Next ideas (not started)
- Welcome email with a set-password link when an administrator creates a user (reuses passwordReset.js); workload-reminder emails; a "Send reset link" button per user in Admin > Users; a force re-queue button for history; dark mode.
