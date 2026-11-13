# Bench mode and docs/PERFORMANCE.md, M9 part A (PR #35)

Reviewed with Codex (`codex exec review --uncommitted`), three rounds: 6 findings, all applied; the third round found nothing.

- Releases published with the workflow token trigger no other workflow, so `release: published` would never start
  the Perf run. Applied: release-please.yml dispatches perf.yml on the new tag next to release.yml; the `release`
  trigger is gone (with a PAT it would have run twice).
- Bench mode redirected the Rust stores but the WebView kept the user's persistent profile, so the update prompt's
  `lastSeenVersion` and panel sizes were read and written. Applied: the main window is built in `setup`
  (`"create": false` in tauri.conf.json) with `incognito(true)` in bench mode.
- The ready mark could reach the backend before the first paint (an rAF callback runs before rendering). Applied: it
  is sent from the frame after the UI first reached the DOM.
- On Windows the SQLite fixture is still open when the app deletes its data dir on "done", so the delete failed
  silently and PID-named dirs could collide later. Applied: the data dir is `<marks>.data` inside the runner's temp
  dir, and the runner removes it after the process has exited.

Round 2:

- The bench could refresh connections while the startup `init()` was still waiting, and init's older, empty list
  then overwrote it, so Run found no connection and the bench timed out. Applied: `init()` runs once and returns the
  same promise (this also stops StrictMode registering the focus and `history:added` listeners twice in dev); the
  bench awaits it first.
- On Windows, incognito alone still uses the default WebView2 user-data dir, so with AgentQL already open the bench
  could join that instance's browser process and the runner would miss its memory. Applied: bench mode gives the
  WebView its own data dir inside the bench dir (ignored on macOS).

Found while testing: release builds freeze `window.__TAURI_INTERNALS__`, so the M5 grid benchmark's `invoke` hook
cannot work in the real app. The bench times the query over IPC separately instead, and reports no render time:
run-to-run IPC variance (254–391 ms) is larger than the grid's paint, so `total - ipc` came out negative in 4 of 7
runs.
