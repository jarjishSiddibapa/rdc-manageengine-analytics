# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Contact the repository owner privately through the GitHub profile with:

- the affected commit or deployment;
- reproduction steps;
- impact and a suggested mitigation;
- whether any credentials or service-desk data may have been exposed.

Allow time for a fix before public disclosure.

## Deployment safeguards

- Keep `backend/.env`, `backend/.secret` (the key that encrypts saved passwords) and `backend/db-backup/` out of version control. They are ignored by default; never remove them from `.gitignore`.
- Rotate the ManageEngine OAuth client secret and refresh token, the database password and the SMTP password if any of them may have been exposed.
- Use a ManageEngine OAuth client with the read-only scope `SDPOnDemand.requests.READ`; the application never writes to ManageEngine.
- The app listens on `127.0.0.1` by default. If you set `HOST=0.0.0.0` to share it, put it behind HTTPS and set `TRUST_PROXY` to the number of reverse proxies in front of it.
- Database backups contain user password hashes and all SR data. Email them only to trusted addresses and store them on a restricted drive.
- Change the first administrator's password at first sign-in and give people the lowest role they need (Viewer, Manager, Administrator).

How authentication, sessions, password reset and rate limiting work is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-model).
