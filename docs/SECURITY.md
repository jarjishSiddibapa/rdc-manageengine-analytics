# Security review

Last reviewed: 2026-11-04. Method: the attack classes in Cloudflare's open `security-audit-skill` (web protocol and authentication, client side, resource exhaustion, data isolation, supply chain, cloud and deployment) were applied to this code by hand, class by class. This is a checklist review, not the skill's full multi-agent audit with its coverage ledger and validators, so treat it as a strong baseline, not a guarantee. Rule used for every item: a missing header or limit is only a finding if an invalid request is accepted, one person can reach another's data, or a credential leaks.

## Checked and found sound
| Class | What was checked | Result |
|---|---|---|
| Browser sessions | Cookie `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS; token 256-bit random, only its hash stored; fresh token on every sign-in, old one retired; sessions removed on logout, password change, disable, role change and delete; idle and absolute lifetimes | sound |
| CSRF | Every write needs the `X-Requested-With: ManageEngineAnalytics` header; no CORS is enabled, so another site cannot send it; reads never change state; sign-in is a write, so login CSRF is closed too | sound |
| Authorisation | Role checked on the server for every route (admin / manager / viewer); the role suite (16 checks) covers each route family | sound |
| Password reset | 256-bit token, only its SHA-256 stored, single use inside the password-change transaction, expiry, same answer for known and unknown addresses, link address from the `public_url` setting or the PC's own network address (never the Host header), all sessions ended, per-address gap and per-address hourly cap, wrong-link pause (50 checks) | sound |
| Welcome email (added after the review) | no password is emailed; the new account holds a random unknowable one; the link is built like a reset link (hashed, single use, expiry, server-chosen address), only administrators can send it, and it is revoked when the address, access or password changes | covered by 44 end-to-end checks |
| Host / forwarded headers | The only request-derived URLs are none; client address is `req.ip`, which follows `TRUST_PROXY` only | sound |
| Injection | No raw HTML sinks in the front end (no `dangerouslySetInnerHTML`, `innerHTML`, `eval`); SQL uses placeholders; CSV exports prefix formula cells (`=`, `+`, `-`, `@`); Excel files write text as text | sound |
| Path handling | Backup download and delete accept only names matching a strict pattern, joined to one folder | sound |
| Error handling | One JSON error shape, no stack traces or SQL in responses | sound |
| Resource exhaustion | Request limit per address; JSON body 100 kB (8 MB only for the signed-in table export); page size capped by a setting; at most two Excel reports prepared at once; one sync, one history run and one backup at a time (MySQL named locks); sign-in and reset throttles | sound |
| Secrets at rest | ManageEngine and mail secrets AES-256-GCM encrypted, key in `backend/.secret` (not in git, not in backups); never sent back to the browser, never written to the activity log | sound |

## Changed in this review
1. **Secure-cookie flag no longer trusts a client header.** `isSecure` believed `X-Forwarded-Proto: https` from any caller. It now uses Express's `req.secure`, which honours that header only from the proxy named in `TRUST_PROXY`. Behind an HTTPS reverse proxy, set `TRUST_PROXY=1` or the session cookie will not be marked `Secure`.
2. **Dependencies.** `nodemailer` 9.1.1 to 10.3.1 (seven advisories: SMTP credential disclosure across transports, parser denial of service, malformed recipients) and `compression` 1.8.1 to 1.8.2 (memory-leak denial of service). `npm audit --omit=dev` went from 2 high and 9 moderate to 9 moderate, 0 high. The front end has 0.
3. **CI** (`.github/workflows/ci.yml`): syntax check, front-end build and `npm audit --audit-level=high` on every push, with read-only repository permissions.

## Accepted, with reasons
- **9 moderate advisories** (`uuid`, `minimatch` and the `glob` family) all arrive through `exceljs`. The only offered fix is downgrading `exceljs` to 3.4.0, a breaking change that would trade known-good reports for a worse library. The vulnerable code paths (glob patterns, uuid with a caller-supplied buffer) are not reachable from user input here. Revisit when `exceljs` publishes an update.
- **`style-src 'unsafe-inline'`** in the Content-Security-Policy: the component library injects inline styles. Scripts are `'self'` only, which is what blocks injected script.
- **In-memory sign-in throttles** reset on restart. That only ever helps a locked-out person; an attacker restarting the server already has control of it.
- **`SameSite=Lax`, not `Strict`**: a link opened from another site (a chat message, for example) would otherwise arrive signed out.

## Not covered
- Deployed configuration: the reverse proxy, TLS certificates, the MySQL server's own accounts and network exposure, the mail account, the ManageEngine OAuth client. Review these where they live.
- Dynamic testing with hostile input beyond the project's own suites. Run a scanner against a staging copy before exposing the app beyond a trusted network.

## Running it safely
- Keep `HOST=127.0.0.1` unless people need to reach it; if they do, put it behind HTTPS and set `TRUST_PROXY`.
- Change the first administrator password at once; keep a copy of `backend/.secret` apart from the backups.
- Backups and emailed backups contain password hashes and every SR: send them only to trusted addresses.
- Run `npm audit` in `backend` and `frontend` now and then, and after every dependency change.
