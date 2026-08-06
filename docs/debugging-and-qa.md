# Debugging And QA

- `pnpm dev` prints the active frontend URL, server API URL, host daemon port, data dir, and logs dir. Do not assume fixed dev ports.
- The packaged app defaults to server/frontend `:38886`, host daemon `:38887`, data dir `~/.bb/`, and logs under `~/.bb/logs/`.
- Entity IDs in URLs (`proj_*`, `thr_*`) are primary keys. Query them directly against the active data dir: `sqlite3 <data>/bb.db "SELECT * FROM threads WHERE id = 'thr_xxx';"`.
- API routes are under `/api/v1/`, for example `GET /api/v1/threads/:id`.
- Use `curl` against the server API to isolate frontend issues from server behavior.
- Use the CLI to inspect state: `pnpm bb thread show <id>`, `pnpm bb project list`, `pnpm bb status`. From source, use `pnpm bb:dev`.

## Local Dev QA Launcher

Use `scripts/bb-dev-app` when validating changes in the desktop dev app or helping QA from this checkout:

- `scripts/bb-dev-app status` prints the active branch, dev URLs, data dir, and logs.
- `scripts/bb-dev-app current` restarts the dev server on the current branch.
- `scripts/bb-dev-app main` fetches `origin/main`, fast-forwards `main`, and launches the dev server from this checkout.
- `scripts/bb-dev-app branch <branch>` switches to a local branch, or creates it from `origin/<branch>`, then launches the dev server.
- `scripts/bb-dev-app stop` stops the launcher-managed dev server and desktop.
- `scripts/bb-dev-app logs dev` and `scripts/bb-dev-app logs desktop` follow logs.

By default the launcher starts only the dev server (web frontend, server, host daemon) and prints the URL without opening a browser. Pass `--open` to open the browser after startup. Pass `--desktop` (e.g. `scripts/bb-dev-app current --desktop`) to also launch the Electron desktop shell — only do this when the user is testing a desktop-only change.

Branch switches intentionally keep dirty work in this checkout; git will stop if a local file would be overwritten. Set `BB_DEV_APP_STASH_DIRTY=1` for a one-off launch that stashes first.

For CLI QA against the dev instance, run `eval "$(scripts/bb-dev-app env)"` first. This sets `BB_SERVER_URL`, `BB_HOST_DAEMON_PORT`, and `BB_PROJECT_ID=proj_personal` so `pnpm bb:dev ...` does not accidentally target the packaged app.

Test agents with:

```bash
eval "$(scripts/bb-dev-app env)"
pnpm bb:dev thread spawn --project proj_personal --provider codex --permission-mode accept-edits --title "Smoke test" --prompt "Reply only with ok." --json
```

## Visual Verification

Launch the app, drive it, and screenshot the result. Do not settle for reading
the markup and reasoning about what it renders.

- `scripts/bb-dev-app current --desktop` runs the Electron shell against this
  checkout. Prefer it whenever the change touches window chrome — traffic
  lights, title-bar geometry, window insets, full-screen layout — because only
  the desktop build has any of that.
- Capture the desktop window with `screencapture`. A DevTools screenshot cannot
  show native chrome: CDP captures the renderer's web contents, and macOS draws
  the window frame outside it. `screencapture: could not create image from
  display` means the process hosting the agent lacks Screen Recording
  permission (System Settings → Privacy & Security → Screen Recording) — it does
  not mean the command is wrong, so ask for the grant instead of debugging the
  invocation.
- For in-page changes the dev web app is faster. `scripts/bb-dev-app current`
  prints the URL; capture one state with a headless screenshot, or drive Chrome
  for Testing over CDP when the check needs interaction — open a menu, confirm a
  dialog, screenshot each state — by keeping a single attached session and
  scripting `Page.navigate` / `Input.dispatchMouseEvent` /
  `Page.captureScreenshot`.
- Do not fake `window.bbDesktop` to coax macOS chrome out of the web build. The
  desktop path expects the whole `BbDesktopApi`: a partial stub throws during
  render and silently blanks the page (subscribe methods must *return* an
  unsubscribe function, not be one), and even a complete stub only proves what
  the renderer does, never what the native frame does.
