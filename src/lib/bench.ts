// Bench mode (docs/PERFORMANCE.md). Runs only when the backend was started with AGENTQL_BENCH: drives the real UI
// against a throwaway SQLite database and reports timings to the backend, which writes the result file.
import { invoke } from "@tauri-apps/api/core";
import { api } from "./api";
import { useStore } from "./store";
import type { ConnectionConfig } from "./types";

const ROWS = 100_000;
// 10 mixed-type columns, NULLs every 7th row; deterministic so runs compare.
const FIXTURE = `CREATE TABLE bench AS
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${ROWS})
SELECT i AS id, 'user' || i || '@example.com' AS email, i % 97 AS bucket, i * 1.25 AS amount,
  CASE WHEN i % 7 = 0 THEN NULL ELSE 'note ' || i END AS note, date('2026-01-01', '+' || (i % 365) || ' days') AS day,
  i % 2 = 0 AS active, printf('%016x', i * 2654435761) AS token, length('x' || i) AS len, printf('%08d', i) AS code
FROM n`;

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const mark = (name: string, ms?: number) => invoke("bench_mark", { name, ms });
// scripts/perf/bench-app.mjs samples memory 1.5 s after "connected" and "rendered"; hold still until it has.
const settle = () => new Promise((r) => setTimeout(r, 3000));

/** Waits for `ok`, then for the frame that paints it. */
async function until(ok: () => boolean, what: string) {
  const deadline = performance.now() + 120_000;
  while (!ok()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await frame();
  }
  await frame();
}

export async function run(dir: string) {
  try {
    await useStore.getState().init(); // or its connection list could land after ours
    await api.saveSettings({ ...(await api.getSettings()), row_limit: ROWS });
    const conn = await api.saveConnection({
      id: "",
      name: "bench",
      driver: "sqlite",
      host: "",
      port: 0,
      user: "",
      database: "",
      file_path: `${dir}/bench.db`,
      read_only: false,
      options: {},
    } as ConnectionConfig);
    const store = useStore.getState();
    await store.refreshConnections();
    await store.connect(conn.id);
    await api.runQuery(conn.id, FIXTURE);
    await mark("connected");
    await settle();

    // Query + IPC + deserialisation on its own (release builds freeze __TAURI_INTERNALS__, so invoke can't be
    // hooked), then the same query through the real Run button up to the grid's first paint.
    const sql = "SELECT * FROM bench";
    await api.runQuery(conn.id, sql); // warm-up, so both timed runs start from the same cache state
    let t = performance.now();
    await api.runQuery(conn.id, sql);
    const ipcMs = performance.now() - t;
    store.openTab({ kind: "query", connectionId: conn.id, title: "Query", sql });
    const runButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Run");
    await until(() => !!runButton(), "the query tab");
    const label = `${ROWS.toLocaleString()} rows`;
    t = performance.now();
    runButton()!.click();
    await until(() => !!document.body.textContent?.includes(label), label);
    const totalMs = performance.now() - t;
    await mark("query_total_ms", totalMs);
    // No render_ms = total - ipc: run-to-run IPC variance is larger than the grid's paint, so the difference is noise.
    await mark("query_ipc_ms", ipcMs);
    await mark("rendered");
    await settle();
  } catch (e) {
    await mark(`error: ${e instanceof Error ? e.message : String(e)}`);
  }
  await mark("done");
}
