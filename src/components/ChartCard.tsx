import { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell as RCell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { LayoutDashboard, RefreshCw, Trash2, Code2 } from "lucide-react";
import type { ChartSpec, QueryResult, Cell } from "../lib/types";
import { ResultGrid } from "./ResultGrid";
import { Button, Tooltip } from "./ui";
import { cellText } from "../lib/format";

const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

interface Props {
  spec: ChartSpec;
  data: QueryResult | null;
  error?: string | null;
  loading?: boolean;
  onAddToDashboard?: () => void;
  onRemove?: () => void;
  onRefresh?: () => void;
  onShowQuery?: () => void;
  height?: number;
}

export function ChartCard({ spec, data, error, loading, onAddToDashboard, onRemove, onRefresh, onShowQuery, height = 220 }: Props) {
  const { rows, xKey, yKeys } = useMemo(() => prepare(spec, data), [spec, data]);
  const num = (v: number) => (Math.abs(v) >= 1000 ? Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v) : Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v));
  const axis = { stroke: "var(--fg-faint)", fontSize: 11, fontFamily: "var(--font-ui)" };
  const tooltipStyle = { contentStyle: { background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--fg)" }, labelStyle: { color: "var(--fg-muted)" }, cursor: { fill: "var(--selection)" } };

  return (
    <figure className="flex flex-col rounded-lg border border-border bg-elev" aria-label={spec.title} aria-describedby={`${spec.id}-desc`}>
      <span id={`${spec.id}-desc`} className="sr-only">
        {data ? `${spec.chart_type} chart of ${yKeys.join(", ") || "values"} by ${xKey}, ${rows.length} points` : "no data"}
      </span>
      <figcaption className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{spec.title}</div>
          {spec.description && <div className="truncate text-xs text-muted">{spec.description}</div>}
        </div>
        {onShowQuery && <Tooltip label="Show query"><Button variant="ghost" size="icon" onClick={onShowQuery} aria-label="Show query"><Code2 size={13} /></Button></Tooltip>}
        {onRefresh && <Tooltip label="Refresh"><Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refresh chart"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></Button></Tooltip>}
        {onAddToDashboard && <Tooltip label="Add to dashboard"><Button variant="ghost" size="icon" onClick={onAddToDashboard} aria-label="Add to dashboard"><LayoutDashboard size={13} /></Button></Tooltip>}
        {onRemove && <Tooltip label="Remove"><Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove chart"><Trash2 size={13} /></Button></Tooltip>}
      </figcaption>
      <div className="p-2" style={{ height: spec.chart_type === "number" ? "auto" : height }}>
        {error ? (
          <div role="alert" className="h-full rounded-md bg-danger-soft p-2 font-mono text-xs text-danger whitespace-pre-wrap selectable">{error}</div>
        ) : !data ? (
          <div className="flex h-full items-center justify-center text-xs text-muted">{loading ? "Loading…" : "No data"}</div>
        ) : spec.chart_type === "table" ? (
          <ResultGrid result={data} />
        ) : spec.chart_type === "number" ? (
          <div className="flex flex-wrap gap-6 px-2 py-3">
            {(yKeys.length ? yKeys : data.columns.map((c) => c.name)).slice(0, 4).map((k) => {
              const v = data.rows[0]?.[data.columns.findIndex((c) => c.name === k)];
              return (
                <div key={k}>
                  <div className="text-2xl font-semibold tabular-nums">{typeof v === "number" ? num(v) : cellText(v as Cell)}</div>
                  <div className="text-xs text-muted">{k}</div>
                </div>
              );
            })}
          </div>
        ) : rows.length === 0 || yKeys.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted">Nothing numeric to plot</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {spec.chart_type === "pie" ? (
              <PieChart>
                <Pie data={rows} dataKey={yKeys[0]} nameKey={xKey} innerRadius="45%" outerRadius="80%" paddingAngle={1} stroke="var(--bg-elev)" strokeWidth={2}>
                  {rows.map((_, i) => <RCell key={i} fill={SERIES[i % 8]} />)}
                </Pie>
                <RTooltip {...tooltipStyle} formatter={(v) => num(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            ) : spec.chart_type === "line" ? (
              <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
                <YAxis tick={axis} tickLine={false} axisLine={false} width={48} tickFormatter={num} />
                <RTooltip {...tooltipStyle} formatter={(v) => num(Number(v))} />
                {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                {yKeys.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={SERIES[i % 8]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--bg-elev)" }} isAnimationActive={false} />)}
              </LineChart>
            ) : spec.chart_type === "area" ? (
              <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
                <YAxis tick={axis} tickLine={false} axisLine={false} width={48} tickFormatter={num} />
                <RTooltip {...tooltipStyle} formatter={(v) => num(Number(v))} />
                {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                {yKeys.map((k, i) => <Area key={k} type="monotone" dataKey={k} stroke={SERIES[i % 8]} fill={SERIES[i % 8]} fillOpacity={0.18} strokeWidth={2} stackId={yKeys.length > 1 ? "a" : undefined} isAnimationActive={false} />)}
              </AreaChart>
            ) : (
              <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap="20%" barGap={2}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
                <YAxis tick={axis} tickLine={false} axisLine={false} width={48} tickFormatter={num} />
                <RTooltip {...tooltipStyle} formatter={(v) => num(Number(v))} />
                {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                {yKeys.map((k, i) => <Bar key={k} dataKey={k} fill={SERIES[i % 8]} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={48} />)}
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  );
}

function prepare(spec: ChartSpec, data: QueryResult | null) {
  if (!data) return { rows: [], xKey: "x", yKeys: [] as string[] };
  const names = data.columns.map((c) => c.name);
  const numericCols = names.filter((_n, i) => data.rows.some((r) => typeof r[i] === "number" || (typeof r[i] === "string" && r[i] !== "" && !Number.isNaN(Number(r[i])) && /^-?\d/.test(r[i] as string))));
  const xKey = spec.x && names.includes(spec.x) ? spec.x : names.find((n) => !numericCols.includes(n)) ?? names[0];
  let yKeys = (spec.y ?? []).filter((y) => names.includes(y));
  if (yKeys.length === 0) yKeys = numericCols.filter((n) => n !== xKey).slice(0, 8);
  const rows = data.rows.slice(0, 2000).map((r) => {
    const o: Record<string, unknown> = {};
    names.forEach((n, i) => {
      const v = r[i];
      o[n] = yKeys.includes(n) ? (typeof v === "number" ? v : v === null ? null : Number(v)) : v === null ? "NULL" : cellText(v);
    });
    return o;
  });
  return { rows, xKey, yKeys };
}
