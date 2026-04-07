# Agent Environment Notes

- Hosting platform: Railway.
- Deployment and operations should assume Railway as the source of truth.
- The agent has Railway CLI access in addition to access through the Railway browser dashboard.
- The repo environment also has GitHub CLI access via `gh`.
- Start the local app directly with `cmd /c .\\node_modules\\.bin\\next.cmd dev --hostname 127.0.0.1 --port 3000 --turbopack` if `npm run dev` gets stuck in the `predev` Postgres guard.
- For local browser automation, use Playwright CLI with Chrome and keep the persistent `endpointarena-local` session alive so cookies/login state persist. Prefer navigating within the existing session instead of closing and reopening pages unless a fresh browser state is actually needed.
- Use the persistent profile `C:\Users\elo\AppData\Local\Codex\playwright-profiles\endpointarena-local` and keep Playwright artifacts plus local dev logs under `output/playwright/local-session/`.
- First open from the repo root: `cmd /c npx --yes --package @playwright/cli playwright-cli --session endpointarena-local open http://127.0.0.1:3000 --browser chrome --headed --persistent --profile "C:\Users\elo\AppData\Local\Codex\playwright-profiles\endpointarena-local"`.
- After that, reuse the same browser with `cmd /c npx --yes --package @playwright/cli playwright-cli --session endpointarena-local <command>`. The local home page is `http://127.0.0.1:3000/`.
