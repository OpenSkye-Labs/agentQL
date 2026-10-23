// Grid benchmark (M5). Evaluated inside the app page by agent-browser, in the browser mock:
//   1. open http://localhost:<port>/?mock=1 (fresh load per run), connect "shop", open a query tab, type
//      `SELECT * FROM bench_wide`
//   2. agent-browser eval "$(cat scripts/bench-grid.js)"
// Reports JSON: first paint after Run, scroll smoothness (vertical, horizontal), client sort time, mounted cells.
(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const button = (name) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
  const mounted = () => document.querySelectorAll("[role=gridcell]").length;

  // First paint: from the moment the 200,000-row result reaches the UI (the mock's run_query resolving; in the app
  // that is after IPC) to the next painted frame showing it. Run on a freshly loaded page.
  const ipc = window.__TAURI_INTERNALS__;
  const invoke = ipc.invoke;
  let arrived = 0;
  ipc.invoke = async (cmd, ...rest) => {
    const r = await invoke(cmd, ...rest);
    if (cmd === "run_query") arrived = performance.now();
    return r;
  };
  let firstPaint;
  try {
    button("Run").click();
    // Bounded: a failed query or a missing fixture reports an error instead of waiting forever.
    const deadline = performance.now() + 60_000;
    while (!arrived || !document.body.textContent.includes("200,000 rows")) {
      if (performance.now() > deadline) return JSON.stringify({ error: "no 200,000-row result within 60 s" });
      await frame();
    }
    await frame();
    firstPaint = performance.now() - arrived;
  } finally {
    ipc.invoke = invoke;
  }

  const grid = document.querySelector("[role=grid]");
  /** Scroll back and forth for `ms`; count frames and the ones that took longer than 50 ms. */
  async function scroll(axis, step, ms = 3000) {
    let frames = 0;
    let long = 0;
    let worst = 0;
    let dir = 1;
    const start = performance.now();
    let last = start;
    while (performance.now() - start < ms) {
      if (axis === "y") {
        grid.scrollTop += step * dir;
        if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 1 || grid.scrollTop <= 0) dir = -dir;
      } else {
        grid.scrollLeft += step * dir;
        if (grid.scrollLeft + grid.clientWidth >= grid.scrollWidth - 1 || grid.scrollLeft <= 0) dir = -dir;
      }
      await frame();
      const now = performance.now();
      frames++;
      worst = Math.max(worst, now - last);
      if (now - last > 50) long++;
      last = now;
    }
    return { fps: Math.round((frames * 1000) / (performance.now() - start)), long, worstMs: Math.round(worst) };
  }
  const cellsAtTop = mounted();
  const vertical = await scroll("y", 400);
  grid.scrollTop = 0;
  await frame();
  const horizontal = await scroll("x", 160);
  grid.scrollLeft = 0;
  await frame();

  // Client sort (query results sort in the browser): a text column, then a numeric one.
  const sortBy = async (prefix) => {
    const b = document.querySelector(`button[aria-label^='Sort by ${prefix}']`);
    const t = performance.now();
    b.click();
    await frame();
    await frame();
    return Math.round(performance.now() - t);
  };
  const sortTextMs = await sortBy("c02_text");
  const sortNumberMs = await sortBy("c01_numeric");

  return JSON.stringify({
    firstPaintMs: Math.round(firstPaint),
    vertical,
    horizontal,
    sortTextMs,
    sortNumberMs,
    mountedCells: cellsAtTop,
    columns: document.querySelectorAll("[role=columnheader]").length - 1,
    userAgent: navigator.userAgent.replace(/^.*\) /, ""),
  });
})();
