# Agent Environment Notes

- Hosting platform: Railway.
- Deployment and operations should assume Railway as the source of truth.
- The agent has Railway CLI access in addition to access through the Railway browser dashboard.
- The repo environment also has GitHub CLI access via `gh`.
- For all UI work, verify the result by opening the app in a browser tab using the MCP browser tooling (for example Playwright/MCP) before considering the task complete.
