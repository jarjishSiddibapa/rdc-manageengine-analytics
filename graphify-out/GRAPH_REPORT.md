# Graph Report - deloitte-sr-analytics  (2026-10-28)

## Corpus Check
- 87 files · ~94,889 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1114 nodes · 2193 edges · 51 communities (48 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]

## God Nodes (most connected - your core abstractions)
1. `useFilters()` - 29 edges
2. `useAuth()` - 23 edges
3. `cfg()` - 22 edges
4. `computeTechnician()` - 22 edges
5. `useAppConfig()` - 21 edges
6. `formatDuration()` - 19 edges
7. `pool` - 16 edges
8. `computeOverview()` - 16 edges
9. `useUi()` - 16 edges
10. `ManageEngine Analytics` - 14 edges

## Surprising Connections (you probably didn't know these)
- `normalizeRequest()` --calls--> `TEXT`  [INFERRED]
  backend/services/manageengine.js → frontend/src/theme.js
- `useZoomView()` --calls--> `LABEL`  [INFERRED]
  frontend/src/components/analytics/zoom.jsx → frontend/src/pages/Account.jsx
- `weekTicks()` --calls--> `monthLabel()`  [EXTRACTED]
  frontend/src/components/charts.jsx → frontend/src/utils/format.js
- `Guard()` --calls--> `useAuth()`  [EXTRACTED]
  frontend/src/App.jsx → frontend/src/context/Auth.jsx
- `Routed()` --calls--> `useAuth()`  [EXTRACTED]
  frontend/src/App.jsx → frontend/src/context/Auth.jsx

## Communities (51 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (47): compact(), niceTicks(), rangeTicks(), truncate(), wrapText(), useElementWidth(), useChartHeight(), useZoom() (+39 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (37): allowed, audit, backup, changed, express, file, mailer, patch (+29 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (43): ALLOWED_WHILE_CHANGING, attachUser(), audit, clearFailures(), clearSessionCookie(), COMMON_PASSWORDS, cookieFlags(), createSession() (+35 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (36): fmtInt(), DonutChart(), DrillContext, DrillHost(), useDrill(), AgingCard, ClosureHeatmapCard, DistributionCard (+28 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (47): analytics, appName(), BAND_FILL, basisLabel(), BOLD, buildWithSummary(), buildWorkbook(), cellValue() (+39 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (31): acquireRunLock(), beginHistory(), classOf(), clean(), collectOne(), concurrency(), connections, ensure() (+23 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (40): accessToken(), apiGet(), assertApiSuccess(), backoffMs(), base(), checkConnectionChange(), CLOSED_STATUSES, connectionKey() (+32 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (27): ANALYTIC_KEYS, awayTest(), BASES, buildRequest(), collator, dayBuckets(), dayWord(), GROUP_DIMENSIONS (+19 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (34): adminRoutes, api, app, auth, authRoutes, backup, CLIENT_MESSAGES, compression (+26 more)

### Community 9 - "Community 9"
Cohesion: 0.14
Nodes (24): useAbortableLoad(), useDebounced(), useUrlState(), cancellable, getJSON(), isAbort(), queryString(), ColumnsMenu() (+16 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (26): AggSwitch, AggSwitchConnected(), FilterBar(), AGGREGATIONS, ANALYTIC_PATHS, BASES, countActive(), DEFAULT_FILTERS (+18 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (16): useLoad(), askToLeave(), useUnsavedGuard(), Activity(), Settings(), Users(), AdminConnections(), AdminSettings() (+8 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (17): audit, auth, changed, changes, data, express, id, page (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (25): analytics, begin(), connections, databaseNow(), decideDeepSync(), deepDueTimes(), deepPolicy(), deepStatus() (+17 more)

### Community 14 - "Community 14"
Cohesion: 0.10
Nodes (19): dependencies, @ant-design/icons, antd, dayjs, react, react-dom, react-router-dom, recharts (+11 more)

### Community 15 - "Community 15"
Cohesion: 0.13
Nodes (15): AuthContext, AuthProvider(), ROLE_LABELS, useAuth(), Account(), COLOR, ForcedPasswordChange(), LABEL (+7 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (18): dependencies, compression, dotenv, exceljs, express, mysql2, node-cron, nodemailer (+10 more)

### Community 17 - "Community 17"
Cohesion: 0.20
Nodes (11): addDays(), closureHeatmap(), dateOnly(), dimensionKey(), groupRecords(), slowWallClockMs(), technicianMonthMatrix(), twoDigits() (+3 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (17): analytics, audit, auth, c, cleanQuery(), exportReport(), express, filtersOf() (+9 more)

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (19): SRViewerProvider(), useIsMobile(), useMedia(), Account, Admin, App(), Dashboard, DataSync (+11 more)

### Community 20 - "Community 20"
Cohesion: 0.24
Nodes (9): ensureIndex(), initDb(), mysql, { pool, DB_NAME }, mysql, pool, { initDb }, { pool } (+1 more)

### Community 21 - "Community 21"
Cohesion: 0.13
Nodes (16): ago(), dateTime(), min(), trendStory(), mins(), Context, FALLBACK, FILTERS (+8 more)

### Community 22 - "Community 22"
Cohesion: 0.06
Nodes (30): audit, bodyOf(), config, connections, express, lastTest, mailer, manageengine (+22 more)

### Community 23 - "Community 23"
Cohesion: 0.15
Nodes (5): ORDER, SECURE_OPTIONS, SOURCE_TAG, ErrorBoundary, ErrorState()

### Community 24 - "Community 24"
Cohesion: 0.24
Nodes (14): ascending(), average(), countAtLeast(), countAtMost(), fmtDuration(), insights(), maxOf(), pctDiff() (+6 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (22): SyncButtons(), SyncButtonsView, SyncContext, SyncProvider(), useSync(), ANALYTIC_PAGES, AppShell(), BasisSwitch (+14 more)

### Community 26 - "Community 26"
Cohesion: 0.24
Nodes (23): appName(), buildTransporter(), config(), connections, escapeHtml(), formatBytes(), fromAddress(), getTransporter() (+15 more)

### Community 27 - "Community 27"
Cohesion: 0.19
Nodes (20): aging(), applyBaseFilters(), applyDateFilter(), applyFilters(), bucketIndex(), bucketList(), computeOverview(), computeTechnician() (+12 more)

### Community 28 - "Community 28"
Cohesion: 0.12
Nodes (15): code:block1 (cd backend), Command line, Database backups and email, Downloads, Forgot password, How turnaround is measured, ManageEngine Analytics, Notes (+7 more)

### Community 29 - "Community 29"
Cohesion: 0.17
Nodes (16): AdminBackups(), EMAIL, formatBytes(), STATUS, TRIGGER, when(), adminAPI, analyticsAPI (+8 more)

### Community 30 - "Community 30"
Cohesion: 0.14
Nodes (13): audit, auth, express, key, locked, minutes, nowLocked, passwordReset (+5 more)

### Community 31 - "Community 31"
Cohesion: 0.14
Nodes (18): fillMonths(), ICON, pct(), TechnicianStory, VersusTeamCard, ChartCard(), bucketTable(), EMPTY (+10 more)

### Community 32 - "Community 32"
Cohesion: 0.09
Nodes (26): BY_KEY, coerce(), CROSS, defaultFor(), DEFAULTS, flag(), get(), getAll() (+18 more)

### Community 33 - "Community 33"
Cohesion: 0.29
Nodes (10): buildExplore(), buildFacets(), buildOverview(), buildRecords(), buildTechnician(), facets(), getSnapshot(), loadRecords() (+2 more)

### Community 34 - "Community 34"
Cohesion: 0.29
Nodes (8): canonicalTechnician(), elapsedMinutes(), minutesBetween(), nonNegative(), orNull(), shapeHandling(), shapeRecord(), weekendMs()

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (3): clientIp(), { pool }, record()

### Community 41 - "Community 41"
Cohesion: 0.14
Nodes (13): Analytics, Backups, Configuration, Connections (Admin > Connections), Daily deep sync, Identity, Kept fixed on purpose, Reports & backups (+5 more)

### Community 43 - "Community 43"
Cohesion: 0.18
Nodes (10): code:block1 (startup.bat                      installs, builds, starts (d), Data model (tables), Gotchas, graphify, How changes get verified, Layout, Project knowledge, Rules of the road (+2 more)

### Community 44 - "Community 44"
Cohesion: 0.18
Nodes (11): capital(), cfg(), drillPredicate(), MIN_DUE_SAMPLE(), MIN_SAMPLE(), REASSIGN_BUCKETS(), reassignBuckets(), reassignKey() (+3 more)

### Community 45 - "Community 45"
Cohesion: 0.22
Nodes (8): Analytics (services/analytics.js), Architecture, code:block1 (ManageEngine SDP Cloud (read-only API)), Data flow, Frontend, History (services/history.js), Security model, Sync modes (services/sync.js)

### Community 46 - "Community 46"
Cohesion: 0.20
Nodes (9): Database backups (Admin → Backups), Forgot password (by email), Operations guide, Restore, Security checklist, Settings you must provide (`backend/.env`, see `backend/.env.example`), Start and stop, Syncs (+1 more)

### Community 47 - "Community 47"
Cohesion: 0.29
Nodes (6): How to continue (token-saving), Known gaps (honest list), Needs the user (cannot be done by the assistant), Next ideas (not started), Progress and hand-off, State: all requested work is built and tested

### Community 48 - "Community 48"
Cohesion: 0.29
Nodes (6): 2026-10-26 and earlier, 2026-10-27 — audit and optimisation (five parallel reviews), 2026-10-28, 2026-10-28 (later), 2026-10-28 (latest), Changelog

### Community 51 - "Community 51"
Cohesion: 0.09
Nodes (25): AppConfigContext, AppConfigProvider(), FALLBACK_CONFIG, passwordHint(), passwordRules(), useAppConfig(), PasswordForm(), strength() (+17 more)

### Community 52 - "Community 52"
Cohesion: 0.14
Nodes (14): audit, auth, badToken, complete(), crypto, hashToken(), lockedFor(), lookup() (+6 more)

## Knowledge Gaps
- **370 isolated node(s):** `name`, `version`, `private`, `main`, `start` (+365 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TEXT` connect `Community 6` to `Community 0`, `Community 3`?**
  _High betweenness centrality (0.378) - this node is a cross-community bridge._
- **Why does `useFilters()` connect `Community 10` to `Community 0`, `Community 3`, `Community 36`, `Community 9`, `Community 21`, `Community 25`, `Community 31`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _370 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06504494976203067 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05919661733615222 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.055051421657592255 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._