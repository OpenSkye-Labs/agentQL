import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dagre from "@dagrejs/dagre";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Download, Maximize2, RefreshCw } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useStore, useConnection, type Tab } from "../lib/store";
import type { SchemaObject } from "../lib/types";
import { Button, Empty, Menu, Spinner, Tooltip } from "./ui";

type ETab = Extract<Tab, { kind: "erd" }>;

const HEAD_H = 24;
const ROW_H = 18;
const PAD_X = 8;
const CHAR_W = 6.6; // 11px monospace
const MIN_W = 150;
const MARGIN = 24;

interface ErdNode {
  id: string;
  name: string;
  kind: string;
  cols: { name: string; type: string; pk: boolean; fk: boolean }[];
  w: number;
  h: number;
  x: number; // top-left after layout
  y: number;
}
interface ErdEdge {
  id: string;
  from: string;
  to: string;
  fromRow: number;
  toRow: number;
  label: string;
}

function buildGraph(objects: SchemaObject[]) {
  const nodes = new Map<string, ErdNode>();
  for (const o of objects) {
    if (o.table.kind !== "table") continue;
    const fkCols = new Set(o.details.foreign_keys.flatMap((f) => f.columns));
    const cols = o.details.columns.map((c) => ({
      name: c.name,
      type: c.data_type,
      pk: c.is_primary,
      fk: fkCols.has(c.name),
    }));
    const widest = Math.max(o.table.name.length + 2, ...cols.map((c) => c.name.length + c.type.length + 3));
    nodes.set(o.table.name, {
      id: o.table.name,
      name: o.table.name,
      kind: o.table.kind,
      cols,
      w: Math.max(MIN_W, Math.ceil(widest * CHAR_W) + PAD_X * 2),
      h: HEAD_H + Math.max(1, cols.length) * ROW_H + 4,
      x: 0,
      y: 0,
    });
  }
  const edges: ErdEdge[] = [];
  for (const o of objects) {
    const from = nodes.get(o.table.name);
    if (!from) continue;
    for (const fk of o.details.foreign_keys) {
      // ponytail: references into other schemas are not drawn; add ghost nodes if that ever matters.
      const to = nodes.get(fk.ref_table);
      if (!to || (fk.ref_schema && fk.ref_schema !== o.table.schema)) continue;
      edges.push({
        id: `${o.table.name}.${fk.name}`,
        from: from.id,
        to: to.id,
        fromRow: Math.max(
          0,
          from.cols.findIndex((c) => c.name === fk.columns[0]),
        ),
        toRow: Math.max(
          0,
          to.cols.findIndex((c) => c.name === fk.ref_columns[0]),
        ),
        label: `${fk.columns.join(", ")} → ${fk.ref_table}(${fk.ref_columns.join(", ")})`,
      });
    }
  }
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 70, marginx: MARGIN, marginy: MARGIN });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes.values()) g.setNode(n.id, { width: n.w, height: n.h });
  for (const e of edges) if (e.from !== e.to) g.setEdge(e.from, e.to);
  dagre.layout(g);
  for (const n of nodes.values()) {
    const p = g.node(n.id);
    n.x = p.x - n.w / 2;
    n.y = p.y - n.h / 2;
  }
  const size = g.graph();
  return { nodes: [...nodes.values()], edges, width: size.width ?? 0, height: size.height ?? 0 };
}

function edgePath(e: ErdEdge, byId: Map<string, ErdNode>) {
  const a = byId.get(e.from)!;
  const b = byId.get(e.to)!;
  const y1 = a.y + HEAD_H + e.fromRow * ROW_H + ROW_H / 2;
  const y2 = b.y + HEAD_H + e.toRow * ROW_H + ROW_H / 2;
  if (a === b) {
    const x = a.x + a.w;
    return `M ${x} ${y1} C ${x + 40} ${y1}, ${x + 40} ${a.y + HEAD_H / 2}, ${x} ${a.y + HEAD_H / 2}`;
  }
  // Leave from the side facing the target; a straight cubic reads well with dagre's LR ranks.
  const rightward = b.x + b.w / 2 > a.x + a.w / 2;
  const x1 = rightward ? a.x + a.w : a.x;
  const x2 = rightward ? b.x : b.x + b.w;
  const dx = Math.max(30, Math.abs(x2 - x1) / 2) * (rightward ? 1 : -1);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

const THEME_VARS = [
  "bg",
  "bg-elev",
  "bg-sunken",
  "fg",
  "fg-muted",
  "fg-faint",
  "border",
  "accent",
  "accent-soft",
  "font-mono",
];

function toBase64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(bin);
}

export function ErdTab({ tab }: { tab: ETab }) {
  const conn = useConnection(tab.connectionId);
  const openTab = useStore((s) => s.openTab);
  const toast = useStore((s) => s.toast);
  const [objects, setObjects] = useState<SchemaObject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!conn) return;
    const gen = ++generation.current;
    setObjects(null);
    setError(null);
    try {
      const o = await api.schemaObjects(conn.id, tab.schema);
      if (gen === generation.current) setObjects(o);
    } catch (e) {
      if (gen === generation.current) setError(errMsg(e));
    }
  }, [conn, tab.schema]);

  useEffect(() => {
    void load();
  }, [load]);

  const graph = useMemo(() => (objects ? buildGraph(objects) : null), [objects]);
  const byId = useMemo(() => new Map(graph?.nodes.map((n) => [n.id, n]) ?? []), [graph]);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !graph || !graph.width) return;
    const { width, height } = svg.getBoundingClientRect();
    if (!width || !height) return false; // tab hidden: nothing to fit to yet
    const k = Math.min(1, width / graph.width, height / graph.height);
    setView({ k, x: (width - graph.width * k) / 2, y: (height - graph.height * k) / 2 });
    return true;
  }, [graph]);

  // Fit once the diagram has a size: immediately, or when the tab becomes visible after loading in the background.
  useEffect(() => {
    if (fit() !== false) return;
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(() => {
      if (fit()) ro.disconnect();
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [fit]);

  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    setView((v) => {
      const k = Math.min(4, Math.max(0.1, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) };
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const openTable = (n: ErdNode) => {
    if (!conn) return;
    openTab({
      kind: "table",
      connectionId: conn.id,
      title: n.name,
      schema: tab.schema,
      table: n.name,
      tableKind: n.kind,
    });
  };

  /** Standalone SVG markup with theme variables resolved so it renders outside the app. */
  const exportSvg = () => {
    const svg = svgRef.current;
    if (!svg || !graph) return null;
    const style = getComputedStyle(document.documentElement);
    const vars = Object.fromEntries(THEME_VARS.map((v) => [v, style.getPropertyValue(`--${v}`).trim()]));
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(Math.ceil(graph.width)));
    clone.setAttribute("height", String(Math.ceil(graph.height)));
    clone.setAttribute("viewBox", `0 0 ${Math.ceil(graph.width)} ${Math.ceil(graph.height)}`);
    clone.removeAttribute("class");
    clone.querySelector("[data-viewport]")?.removeAttribute("transform");
    clone.querySelectorAll("[data-hover]").forEach((el) => el.removeAttribute("data-hover"));
    const markup = new XMLSerializer()
      .serializeToString(clone)
      .replace(/var\(--([\w-]+)\)/g, (_, n: string) => vars[n] ?? "#888");
    return markup.replace(/^<svg/, `<svg style="background:${vars.bg}"`);
  };

  const exportAs = async (format: "svg" | "png") => {
    const markup = exportSvg();
    if (!markup || !graph) return;
    const path = await saveDialog({
      defaultPath: `${tab.schema}-erd.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!path) return;
    try {
      let data: string;
      if (format === "svg") data = toBase64(new TextEncoder().encode(markup));
      else {
        const img = new Image();
        img.src = `data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(markup))}`;
        await new Promise<void>((ok, fail) => {
          img.onload = () => ok();
          img.onerror = () => fail(new Error("could not rasterise the diagram"));
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(graph.width) * 2;
        canvas.height = Math.ceil(graph.height) * 2;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(2, 2);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
        ctx.fillRect(0, 0, graph.width, graph.height);
        ctx.drawImage(img, 0, 0);
        data = canvas.toDataURL("image/png").split(",")[1];
      }
      await api.saveFile(path, data);
      toast(`Exported ${format.toUpperCase()}`, "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  if (!conn) return <Empty title="Connection removed" />;

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex h-9 items-center gap-1 border-b border-border bg-elev px-2 text-xs"
        role="toolbar"
        aria-label="Diagram actions"
      >
        <span className="font-semibold">{tab.schema}</span>
        {graph && (
          <span className="text-muted">
            · {graph.nodes.length} tables · {graph.edges.length} relations
          </span>
        )}
        <span className="flex-1" />
        <Tooltip label="Fit to window">
          <Button size="sm" variant="ghost" onClick={fit} aria-label="Fit to window" disabled={!graph}>
            <Maximize2 size={13} />
          </Button>
        </Tooltip>
        <Menu
          trigger={
            <Button size="sm" variant="ghost" aria-label="Export" disabled={!graph}>
              <Download size={13} /> Export
            </Button>
          }
          items={[
            { label: "SVG", onSelect: () => void exportAs("svg") },
            { label: "PNG", onSelect: () => void exportAs("png") },
          ]}
        />
        <Tooltip label="Reload">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void load()}
            aria-label="Reload"
            disabled={!objects && !error}
          >
            <RefreshCw size={13} />
          </Button>
        </Tooltip>
      </div>
      <div className="relative flex-1 min-h-0 bg-sunken">
        {error ? (
          <div
            role="alert"
            className="m-3 rounded-md border border-danger/40 bg-danger-soft p-3 font-mono text-xs whitespace-pre-wrap selectable"
          >
            {error}
          </div>
        ) : !graph ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
            <Spinner /> Introspecting {tab.schema}…
          </div>
        ) : graph.nodes.length === 0 ? (
          <Empty title="No tables in this schema" />
        ) : (
          <svg
            ref={svgRef}
            className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
            role="img"
            aria-label={`Entity relationship diagram of ${tab.schema}`}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <defs>
              <marker
                id="erd-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fg-faint)" />
              </marker>
            </defs>
            <g
              data-viewport
              transform={`translate(${view.x} ${view.y}) scale(${view.k})`}
              fontFamily="var(--font-mono)"
              fontSize="11"
            >
              {graph.edges.map((e) => {
                const lit = hover === e.from || hover === e.to;
                return (
                  <path
                    key={e.id}
                    d={edgePath(e, byId)}
                    fill="none"
                    stroke={lit ? "var(--accent)" : "var(--fg-faint)"}
                    strokeWidth={lit ? 2 : 1.2}
                    opacity={hover && !lit ? 0.25 : 1}
                    markerEnd="url(#erd-arrow)"
                  >
                    <title>{e.label}</title>
                  </path>
                );
              })}
              {graph.nodes.map((n) => (
                <g
                  key={n.id}
                  transform={`translate(${n.x} ${n.y})`}
                  className="cursor-pointer"
                  data-hover={hover === n.id ? "1" : undefined}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                  onClick={() => openTable(n)}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <title>Open {n.name}</title>
                  <rect
                    width={n.w}
                    height={n.h}
                    rx={6}
                    fill="var(--bg-elev)"
                    stroke={hover === n.id ? "var(--accent)" : "var(--border)"}
                    strokeWidth={hover === n.id ? 1.5 : 1}
                  />
                  <path d={`M 0 ${HEAD_H} H ${n.w}`} stroke="var(--border)" />
                  <text x={PAD_X} y={HEAD_H / 2 + 4} fontWeight="600" fill="var(--fg)">
                    {n.name}
                  </text>
                  {n.cols.map((c, i) => {
                    const y = HEAD_H + i * ROW_H + ROW_H / 2 + 4;
                    return (
                      <g key={c.name}>
                        <text
                          x={PAD_X}
                          y={y}
                          fill={c.pk ? "var(--accent)" : "var(--fg)"}
                          fontWeight={c.pk ? "600" : undefined}
                        >
                          {c.name}
                          {c.fk && !c.pk ? " ⇢" : ""}
                        </text>
                        <text x={n.w - PAD_X} y={y} textAnchor="end" fill="var(--fg-faint)" fontSize="10">
                          {c.type}
                        </text>
                      </g>
                    );
                  })}
                </g>
              ))}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}
