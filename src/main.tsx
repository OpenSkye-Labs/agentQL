import "./lib/mock";
import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import "./index.css";

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
    .then((dir) => {
      if (dir) void import("./lib/bench").then((b) => b.run(dir));
    })
    .catch(() => {});
const ready = () => requestAnimationFrame(root.childElementCount ? mark : ready);
requestAnimationFrame(ready);
