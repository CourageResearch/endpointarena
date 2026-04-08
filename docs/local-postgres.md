# Local Postgres Guardrails

This repo expects the project local Postgres cluster to live at `~/.endpointarena-pg18` by default.

If `npm run dev` sees a different cluster on the same port, it now fails fast with a recovery command instead of letting the app boot into a broken state.

Useful commands:

- `npm run dev:local`
- `npm run db:status-local-postgres`
- `npm run db:start-local-postgres`
- `npm run db:stop-local-postgres`
- `npm run db:switch-local-postgres`

What each one does:

- `dev:local` starts the project Postgres cluster if needed, then launches Next dev on `127.0.0.1:3000`.
- `status` checks that the cluster listening on `DATABASE_URL` has the expected local database.
- `start` starts the project cluster if nothing is listening on the expected port.
- `switch` stops the other cluster on that port and restores the project cluster.
- `stop` stops the project cluster by data directory.

Optional overrides:

- `LOCAL_POSTGRES_DATA_DIR` lets you move the project cluster somewhere other than `~/.endpointarena-pg18`.
- `LOCAL_POSTGRES_LOG_FILE` lets you choose a different startup log path.

The default local setup for this repo uses `.env.local` with a single project database:

- `DATABASE_URL=postgresql://.../endpointarena_local_main`
