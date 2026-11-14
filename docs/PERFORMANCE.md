# Performance

Measured numbers for the release build (ROADMAP M9). Re-run them for every release; the Perf workflow does this on
hosted runners for all three platforms.

## What is measured

`scripts/perf/bench-app.mjs` starts the built binary with `AGENTQL_BENCH=<marks.json>`. In that mode the app uses a
throwaway data dir and a non-persistent WebView profile (your connections, settings, history and
localStorage are never read or written), and `src/lib/bench.ts` drives
the real UI.

| Number             | Meaning                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `cold_start_ms`    | From the top of `run()` to the first painted frame showing the UI. Excludes the OS loader's few ms before main. |
| `setup_ms`         | The part of cold start until Rust `setup` has built the window (GTK/WebView init included).                     |
| `script_ms`        | The part until the bundle's modules have evaluated and `main.tsx` runs, as the backend's main thread sees it.   |
| `rss_connected_mb` | Resident memory of the whole app (backend + every WebView process) with one idle SQLite connection.             |
| `rss_100k_rows_mb` | The same, with a 100,000-row × 10-column result showing in a query tab.                                         |
| `query_ipc_ms`     | `SELECT * FROM bench` (100k rows) over IPC into JS, without the UI: query + JSON + deserialisation.             |
| `query_total_ms`   | The same query from a click on Run to the frame that paints the grid and its "100,000 rows" status.             |

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

Medians of 5 runs from the Perf workflow (run 43561000113). Shared VMs without a GPU, so these are for comparing
releases with each other, not with the desktop numbers above.

| Runner                    | Cold start | RSS, 1 connection | RSS, 100k rows | 100k-row query: IPC only | 100k-row query: click → grid painted |
| ------------------------- | ---------- | ----------------- | -------------- | ------------------------ | ------------------------------------ |
| ubuntu-22.04 (Xvfb)       | 987 ms     | 404 MB            | 667 MB         | 899 ms                   | 1066 ms                              |
| macos-latest              | 1646 ms    | 257 MB            | 520 MB         | 490 ms                   | 514 ms                               |
| windows-latest (WebView2) | 729 ms     | 364 MB            | 458 MB         | 645 ms                   | 712 ms                               |

Of the cold start, Rust setup took 104 ms on Linux, 173 ms on macOS and 540 ms on Windows (`setup_ms`); the page's
JS started at 824 ms, 1470 ms and 669 ms (`script_ms`). The first run of each job is slower (cold disk cache); the
median is not moved by it.

**The 30 s Linux start was the runner, not the app.** In the diagnostic run (43557629563) Linux took 30.4 s to its
first frame and `setup_ms` was 30.1 s: the wait happened before the window existed (plugin, GTK and WebView
initialisation, window build), so it was not the keychain probe the UI makes later. `xvfb-run` starts no D-Bus
session bus; running the bench under `dbus-run-session`, as any desktop session provides, brought setup down to about
100 ms, so start-up was waiting on that bus. A Linux user should only see the same wait when starting AgentQL with no
session bus (a bare X server or some SSH X-forwarding setups); `dbus-run-session agentql` should avoid it.

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
