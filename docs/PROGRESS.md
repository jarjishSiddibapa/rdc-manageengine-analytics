# Progress and hand-off

Keep this file current. It is the first thing a new session (or a person) reads to continue exactly where the last one stopped, without re-deriving anything. Update it at the end of every piece of work, before starting the next one.

Last updated: 2026-11-26 (renamed to RDC ManageEngine SR Analytics; active/inactive technicians; more filters; new-PC setup; welcome email; network-address links; forgot-password link shows right after email setup; startup.bat library repair).

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
| Security review (Cloudflare audit-skill classes) + dependency fixes + CI | done | docs/SECURITY.md; npm audit 0 high; reset 50/50, roles 16/16, Excel 264/264 |
| Regression | passing | Excel suite 264/0, role suite 16/0, backup suite 64/0 (last run 2026-10-28 on a clean server) |
| Welcome email for new users (set-password link) | done | 44/44 end-to-end checks with a local fake mail server on a throwaway database; browser check of Add user and the set-password page |
| Emailed links use the PC's network address; app shared on this PC (HOST=0.0.0.0) | done | 10/10 checks over the LAN address with an empty throwaway database; 44/44 email checks; set-password page opened by IP |
| Rename to RDC ManageEngine SR Analytics | done | browser check; internal identifiers unchanged |
| Active / inactive technicians; sub-category, region, site and other filters | done | feature checks 80/0 against SQL on a throwaway copy of the database; browser check at 1366 and 375 px |
| New-PC setup: startup.bat, docs/SETUP_NEW_PC.md | done | see CHANGELOG 2026-11-26 |
| startup.bat repairs damaged or half-installed libraries | done, not yet confirmed on the second PC | reproduced "not a valid Win32 application" in a test copy; damaged build file, interrupted install, damaged server library, offline fallback and a healthy second run all behaved |
| Browser check (desktop and 375 px): Backups, Settings, Connections, dashboard | done | no horizontal overflow, console clean apart from the expected pre-sign-in 401 |

## Needs the user (cannot be done by the assistant)
1. The app was restarted on 2026-11-26 (new code is live). Press Ctrl+F5, then mark inactive technicians under Technicians > Active / inactive. To move to another PC follow docs/SETUP_NEW_PC.md.
2. Change the default administrator password after the first sign-in.
3. Email is set up on this PC (2026-11-26): "Forgot your password?" and welcome emails are on, and the mail server accepted a sample welcome mail. Check that it reached the inbox. HOST=0.0.0.0 is set on this PC, so links use its network address. If the App password was ever shared in a chat or message, replace it under Admin > Connections. The assistant does not type passwords.
4. Keep a copy of backend\.secret (it decrypts the saved passwords). Backups do not include it.
5. Optional: `graphify hook install` and `graphify install --project --platform claude` (the permission system blocked the assistant from installing git/Claude hooks). Without them run `graphify update .` after code changes.
6. The old database deloitte_sr_analytics can be dropped.

## Known gaps (honest list)
- README screenshots still show the old name and the old filter bar.
- The older suites (Excel 264, roles 16, reset 50, backup 64) lived in a temporary folder that has since been cleared; they were not re-run for the 2026-11-26 changes. Write new ones into the repository when the next big change comes.
- Region comes from site names; sites such as "Head Office", "Base Site", "Robo-..." and "Ultrafine - ..." form their own regions unless added to the region rules.
- Not tested on a real touch device: pinch zoom on charts. Not tested: the download buttons on the newest heatmap and scatter charts.
- Real mailbox: one sample welcome mail was accepted by the mail server. Emailed backups have only been tested against a local fake mail server.
- About 58 SRs removed from ManageEngine are not flagged until the next Deep Sync (the 01:00 daily one does it). A few hundred SR histories affected by earlier parsing bugs are re-read when ManageEngine reports a change; they were not force re-queued.
- The unsaved-changes guard on the Settings screen does not cover the browser Back button.
- ManageEngine sets no due times, so due and overdue figures are hidden.
- Dark mode was not built.
- Forgot password was tested with a local fake mail server; a reset mail has not been sent through the real mailbox yet. Opening the app from a second device has not been tried. This PC's Wi-Fi is listed as Public and Node.js is allowed through the firewall there.
- Not implemented (offered): workload-reminder emails from the reference app.
- A welcome link for a real new user has not been used end to end through the real mailbox (the sample's button is a dummy).

## How to continue (token-saving)
1. `graphify query "<question>"` before reading code; docs/ARCHITECTURE.md, OPERATIONS.md and CONFIGURATION.md for behaviour and settings.
2. New tunable values go in backend/services/settings.js (a schema entry gives validation, default, Admin screen and doc).
3. To verify a change: `node --check`, `npx vite build` in frontend/, then the suites (see AGENTS.md > How changes get verified). Extra test servers must use NO_BACKGROUND=1 and another PORT.
4. Regenerate CONFIGURATION.md after changing the settings schema (pattern: require settings.js, write tables from SCHEMA, GROUPS and DEFAULTS).
5. Finish by running `graphify update .`, adding a line to CHANGELOG.md and updating this file.

## Next ideas (not started)
- Workload-reminder emails; a "Send reset link" button per user in Admin > Users (welcome links cover users who have not signed in); a force re-queue button for history; dark mode.
