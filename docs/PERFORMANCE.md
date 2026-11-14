# Performance

Measured numbers for the release build (ROADMAP M9). Re-run them for every release; the Perf workflow does this on
hosted runners for all three platforms.

## What is measured

`scripts/perf/bench-app.mjs` starts the built binary with `AGENTQL_BENCH=<marks.json>`. In that mode the app uses a
throwaway data dir and a non-persistent WebView profile (your connections, settings, history and
localStorage are never read or written), and `src/lib/bench.ts` drives
the real UI.

| Number             | Meaning                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `cold_start_ms`    | From the top of `run()` to the first painted frame showing the UI. Excludes the OS loader's few ms before main.   |
| `setup_ms`         | The part of cold start until Rust `setup` has built the window (GTK/WebView init included).                       |
| `script_ms`        | The part until the page's JS started, as seen by the backend's main thread (so it includes any main-thread wait). |
| `rss_connected_mb` | Resident memory of the whole app (backend + every WebView process) with one idle SQLite connection.               |
| `rss_100k_rows_mb` | The same, with a 100,000-row × 10-column result showing in a query tab.                                           |
| `query_ipc_ms`     | `SELECT * FROM bench` (100k rows) over IPC into JS, without the UI: query + JSON + deserialisation.               |
| `query_total_ms`   | The same query from a click on Run to the frame that paints the grid and its "100,000 rows" status.               |

Memory is the sum of RSS over the process tree: on Linux and Windows the WebView processes are the app's children;
on macOS WKWebView's GPU, WebContent and Networking processes are XPC services under launchd, so the WebKit processes
that appeared after the app started are counted. Close Safari, Mail and other WebKit apps while benchmarking on macOS.
RSS counts shared framework pages once per process, so it is higher than Activity Monitor's "Memory" column; it is
the figure users quote ("480 MB RES") when comparing clients.

There is no separate render time: run-to-run variance in `query_ipc_ms` is larger than the grid's paint, so
`query_total_ms - query_ipc_ms` is noise. The grid itself is benchmarked in the browser mock (TESTING.md, M5).

## Running it

```bash
pnpm tauri build --bundles app        # or --no-bundle on Linux/Windows
node scripts/perf/bench-app.mjs src-tauri/target/release/bundle/macos/AgentQL.app/Contents/MacOS/agentql 7
# Linux: xvfb-run -a dbus-run-session -- node scripts/perf/bench-app.mjs src-tauri/target/release/agentql 7 (or without xvfb on a desktop)
# Windows: node scripts/perf/bench-app.mjs src-tauri/target/release/agentql.exe 7
```

It prints each run to stderr and the medians as JSON to stdout. On GitHub, run the **Perf** workflow (it also runs on
published releases and on PRs that touch the bench); the medians land in the job summary.

## Results

Medians of 7 runs, v0.2.0, release build.

| Platform                      | Cold start | RSS, 1 connection | RSS, 100k rows | 100k-row query: IPC only | 100k-row query: click → grid painted |
| ----------------------------- | ---------- | ----------------- | -------------- | ------------------------ | ------------------------------------ |
| macOS 27.0.1, Apple M6, 32 GB | 334 ms     | 230 MB            | 537 MB         | 275 ms                   | 311 ms                               |

macOS was measured on a developer machine that was also running Docker CI runners; across the 7 runs cold start
ranged 279–443 ms, the 100k-row RSS 527–541 MB and click → grid painted 269–380 ms.

### GitHub-hosted runners

Medians of 5 runs from the Perf workflow (run 43558857621). Shared VMs without a GPU, so these are for comparing
releases with each other, not with the desktop numbers above.

| Runner                    | Cold start | RSS, 1 connection | RSS, 100k rows | 100k-row query: IPC only | 100k-row query: click → grid painted |
| ------------------------- | ---------- | ----------------- | -------------- | ------------------------ | ------------------------------------ |
| ubuntu-22.04 (Xvfb)       | 961 ms     | 403 MB            | 674 MB         | 1108 ms                  | 1200 ms                              |
| macos-latest              | 2249 ms    | 226 MB            | 480 MB         | 788 ms                   | 896 ms                               |
| windows-latest (WebView2) | 553 ms     | 359 MB            | 459 MB         | 417 ms                   | 463 ms                               |

Of the cold start, Rust setup took 94 ms on Linux, 492 ms on macOS and 345 ms on Windows (`setup_ms`); the page's
JS started at 798 ms, 1996 ms and 431 ms (`script_ms`). The first run of each job is slower (cold disk cache); the
median is not moved by it.

**The 30 s Linux start was the runner, not the app.** The first Perf run measured 30.4 s on Linux. `setup_ms` showed
all of it happened before the window existed (30.1 s of 30.4 s), so it was GTK/WebKitGTK start-up, not the
keychain probe the UI makes later. The runner had no D-Bus session bus; under `dbus-run-session`, as in any desktop
session, setup takes 94 ms. A Linux user should only see the same wait when starting AgentQL with no session bus (a bare X
server or some SSH X-forwarding setups); `dbus-run-session agentql` avoids it.

### Where the memory goes (macOS, one run)

| Process                      | 1 connection | 100k rows |
| ---------------------------- | ------------ | --------- |
| agentql (Rust backend)       | 111 MB       | 209 MB    |
| WebKit WebContent (JS + DOM) | 73 MB        | 252 MB    |
| WebKit GPU                   | 31 MB        | 31 MB     |
| WebKit Networking            | 11 MB        | 9 MB      |

A 100k-row result costs about 180 MB in the WebView (the rows as JS arrays, plus results of the bench's untimed
queries not yet collected) and about 100 MB in the backend, its high-water mark from building the JSON (the bench runs
the query three times; the allocator keeps the pages). The WebView's own baseline is about 115 MB.
