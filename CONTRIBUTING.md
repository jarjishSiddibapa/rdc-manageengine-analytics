# Contributing

## Workflow

1. Create a focused branch from `main`.
2. Keep changes small and describe the user-visible impact in the pull request.
3. Use a local `backend/.env`; never commit secrets, backups, logs or real service-desk data.
4. Update the relevant document in `docs/` when settings, roles, screens or operational behaviour change, and add a line to `docs/CHANGELOG.md`.

## Running locally

```bash
cd backend && npm install && npm start     # API and built screens on http://localhost:7780
cd frontend && npm install && npm run dev  # hot-reloading screens while you work
```

To work without a ManageEngine connection, use a database whose name ends in `_demo`, set `NO_BACKGROUND=1`, start the app once, then run `npm run seed:demo` in `backend/` to load fictional data.

## Before opening a pull request

- Run `npm run build` in `frontend/` and fix any warnings.
- Check the screens you changed with the demo data, in both a wide and a narrow window.
- Include screenshots for meaningful UI changes, taken from demo data only.

`docs/PROGRESS.md` records where the work currently stands.
