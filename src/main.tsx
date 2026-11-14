import "./lib/mock";
import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import "./index.css";

// Bench mode: the entry script ran (stamped when the backend's main thread handles it). A no-op otherwise.
void invoke("bench_mark", { name: "script" }).catch(() => {});

const root = document.getElementById("root") as HTMLElement;
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Cold-start mark for bench mode (docs/PERFORMANCE.md): the frame after the UI first reached the DOM, so it has been
// painted. The backend answers null unless started with AGENTQL_BENCH.
const mark = () =>
  void invoke<string | null>("bench_mark", { name: "ready" })
    .then(async (dir) => {
      if (!dir) return;
      try {
        await (await import("./lib/bench")).run(dir);
      } catch (e) {
        // run() reports its own failures; this is the bench chunk failing to load. End the run instead of a timeout.
        await invoke("bench_mark", { name: `error: ${String(e)}` });
        await invoke("bench_mark", { name: "done" });
      }
    })
    .catch(() => {});
const ready = () => requestAnimationFrame(root.childElementCount ? mark : ready);
requestAnimationFrame(ready);
