import { useCallback, useEffect, useState } from "react";
import { Bot, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useStore, useConnection, type Tab } from "../lib/store";
import type { ChartSpec, QueryResult } from "../lib/types";
import { ChartCard } from "./ChartCard";
import { Button, Select, Empty, Tooltip } from "./ui";

type DTab = Extract<Tab, { kind: "dashboard" }>;

export function DashboardTab({ tab }: { tab: DTab }) {
  const conn = useConnection(tab.connectionId);
  const dashboard = useStore((s) => s.dashboards.find((d) => d.id === tab.dashboardId));
  const saveDashboard = useStore((s) => s.saveDashboard);
  const deleteDashboard = useStore((s) => s.deleteDashboard);
  const updateTab = useStore((s) => s.updateTab);
  const askAssistant = useStore((s) => s.askAssistant);
  const openTab = useStore((s) => s.openTab);
  const [data, setData] = useState<Record<string, { result?: QueryResult; error?: string; loading: boolean }>>({});
  const [interval, setIntervalSec] = useState(0);

  const run = useCallback(
    async (chart: ChartSpec) => {
      if (!conn) return;
      setData((d) => ({ ...d, [chart.id]: { ...d[chart.id], loading: true } }));
      try {
        const result = await api.runChart(conn.id, chart.source);
        setData((d) => ({ ...d, [chart.id]: { result, loading: false } }));
      } catch (e) {
        setData((d) => ({ ...d, [chart.id]: { error: errMsg(e), loading: false } }));
      }
    },
    [conn],
  );

  const runAll = useCallback(() => dashboard?.charts.forEach((c) => void run(c)), [dashboard, run]);

  useEffect(() => {
    runAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard?.charts.map((c) => c.id).join(","), conn?.id]);

  useEffect(() => {
    if (!interval) return;
    const t = setInterval(runAll, interval * 1000);
    return () => clearInterval(t);
  }, [interval, runAll]);

  if (!conn || !dashboard) return <Empty title="Dashboard not found" />;

  const rename = async () => {
    const title = prompt("Dashboard title", dashboard.title);
    if (title && title !== dashboard.title) {
      await saveDashboard({ ...dashboard, title });
      updateTab(tab.id, { title });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center gap-2 border-b border-border bg-elev px-3" role="toolbar">
        <h1 className="text-[13px] font-semibold truncate">{dashboard.title}</h1>
        {dashboard.description && <span className="truncate text-xs text-muted">{dashboard.description}</span>}
        <Tooltip label="Rename"><Button size="icon" variant="ghost" onClick={rename} aria-label="Rename dashboard"><Pencil size={13} /></Button></Tooltip>
        <span className="flex-1" />
        <Button size="sm" onClick={() => { askAssistant(`Add a chart to my dashboard "${dashboard.title}" showing `); }}>
          <Bot size={13} /> Add chart with assistant
        </Button>
        <Select value={interval} onChange={(e) => setIntervalSec(Number(e.target.value))} className="h-7 text-xs" aria-label="Auto refresh">
          <option value={0}>Manual refresh</option>
          <option value={30}>Every 30s</option>
          <option value={60}>Every minute</option>
          <option value={300}>Every 5 min</option>
        </Select>
        <Tooltip label="Refresh all"><Button size="icon" variant="ghost" onClick={runAll} aria-label="Refresh all"><RefreshCw size={13} /></Button></Tooltip>
        <Tooltip label="Delete dashboard"><Button size="icon" variant="ghost" onClick={() => confirm(`Delete dashboard "${dashboard.title}"?`) && void deleteDashboard(dashboard.id)} aria-label="Delete dashboard"><Trash2 size={13} /></Button></Tooltip>
      </div>
      <div className="flex-1 overflow-auto scroll p-3">
        {dashboard.charts.length === 0 ? (
          <Empty title="No charts yet" hint="Ask the assistant for a chart and click “Add to dashboard”." />
        ) : (
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">
            {dashboard.charts.map((c) => (
              <ChartCard
                key={c.id}
                spec={c}
                data={data[c.id]?.result ?? null}
                error={data[c.id]?.error}
                loading={data[c.id]?.loading}
                height={260}
                onRefresh={() => void run(c)}
                onShowQuery={() => c.source.kind === "sql" && openTab({ kind: "query", connectionId: conn.id, title: c.title, sql: c.source.sql })}
                onRemove={() => void saveDashboard({ ...dashboard, charts: dashboard.charts.filter((x) => x.id !== c.id) })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
