// Measures a built app for docs/PERFORMANCE.md: cold start, memory with one connection, 100k-row query + render.
//   node scripts/perf/bench-app.mjs <app binary> [runs=5]
// Each run starts the binary with AGENTQL_BENCH (see src-tauri/src/bench.rs, src/lib/bench.ts), follows the marks
// file, samples the resident memory of the app's whole process tree (WebView processes included) 1.5 s after the
// "connected" and "rendered" marks, and prints the median of every number as JSON.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [bin, runsArg = "5"] = process.argv.slice(2);
if (!bin) {
  console.error("usage: node scripts/perf/bench-app.mjs <app binary> [runs]");
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** [pid, ppid, bytes, name] for every process. */
function processes() {
  if (process.platform === "win32") {
    const ps =
      'Get-CimInstance Win32_Process | % { "$($_.ProcessId) $($_.ParentProcessId) $($_.WorkingSetSize) $($_.Name)" }';
    return execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" })
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/))
      .map(([pid, ppid, bytes, ...name]) => [+pid, +ppid, +bytes, name.join(" ")]);
  }
  return execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,comm="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .map(([pid, ppid, kb, ...name]) => [+pid, +ppid, +kb * 1024, name.join(" ")]);
}

/** Resident MB of `root` and its descendants, plus on macOS the WebKit XPC services it launched (see note). */
function treeMb(root, webkitBefore) {
  const all = processes();
  const mine = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of all)
      if (mine.has(ppid) && !mine.has(pid)) {
        mine.add(pid);
        grew = true;
      }
  }
  // WKWebView's WebContent/Networking/GPU processes are XPC services parented to launchd, not to the app. The ones
  // that appeared after the app started are counted; close other WebKit apps (Safari, Mail) while benchmarking.
  if (process.platform === "darwin")
    for (const [pid, , , name] of all) if (/com\.apple\.WebKit\./.test(name) && !webkitBefore.has(pid)) mine.add(pid);
  const bytes = all.filter(([pid]) => mine.has(pid)).reduce((a, [, , b]) => a + b, 0);
  return Math.round(bytes / 1048576);
}

async function once() {
  // The app keeps its throwaway data dir next to the marks file (marks.data), so removing `dir` cleans up both.
  const dir = mkdtempSync(join(tmpdir(), "agentql-bench-run-"));
  const out = join(dir, "marks.json");
  const webkitBefore = new Set(
    process.platform === "darwin"
      ? processes()
          .filter(([, , , n]) => /com\.apple\.WebKit\./.test(n))
          .map(([p]) => p)
      : [],
  );
  const child = spawn(bin, [], { env: { ...process.env, AGENTQL_BENCH: out }, stdio: "ignore" });
  let exited = false;
  const exit = new Promise((r) => child.on("exit", r).on("error", r)).then(() => (exited = true));
  const mem = {};
  const deadline = Date.now() + 180_000;
  try {
    for (;;) {
      if (Date.now() > deadline) throw new Error("no 'done' mark within 180 s");
      let marks = {};
      try {
        marks = JSON.parse(readFileSync(out, "utf8")).marks;
      } catch {} // not written yet, or mid-rename
      const error = Object.keys(marks).find((k) => k.startsWith("error"));
      if (error) throw new Error(error);
      // The UI holds 3 s after each of these marks so the sample lands on a settled process tree.
      for (const [mark, key] of [
        ["connected", "rss_connected_mb"],
        ["rendered", "rss_100k_rows_mb"],
      ])
        if (marks[mark] !== undefined && mem[key] === undefined) {
          await sleep(1500);
          mem[key] = treeMb(child.pid, webkitBefore);
        }
      if (marks.done !== undefined) return { cold_start_ms: marks.ready, ...mem, ...pick(marks) };
      if (exited) throw new Error(`app exited before 'done' (code ${child.exitCode})`);
      await sleep(100);
    }
  } finally {
    if (!exited) child.kill();
    await exit; // Windows keeps the SQLite fixture locked until the process is gone
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (e) {
      console.error(`could not remove ${dir}: ${e.message}`); // a WebView2 helper still exiting; harmless temp files
    }
  }
}

// setup_ms: Rust setup done (window built). script_ms: the page's JS started. Both split cold_start_ms.
const pick = (m) => ({
  setup_ms: m.setup,
  script_ms: m.script,
  query_total_ms: m.query_total_ms,
  query_ipc_ms: m.query_ipc_ms,
});

const results = [];
for (let i = 0; i < +runsArg; i++) {
  results.push(await once());
  console.error(`run ${i + 1}: ${JSON.stringify(results.at(-1))}`);
  await sleep(2000); // let the previous WebView processes go away
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const summary = { os: process.platform, arch: process.arch, runs: results.length };
for (const k of Object.keys(results[0])) summary[k] = median(results.map((r) => r[k]));
console.log(JSON.stringify(summary, null, 2));
