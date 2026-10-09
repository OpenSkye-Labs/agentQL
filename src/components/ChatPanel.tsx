import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { clsx } from "clsx";
import { Bot, Check, ChevronDown, ChevronRight, LayoutDashboard, Plus, Send, Settings, Square, Trash2, Wrench, X } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useStore, useActiveTab } from "../lib/store";
import type { AgentEvent, Block, ChartSpec, ChatSession, Dashboard, Message, QueryResult } from "../lib/types";
import { Button, Menu, Select, Spinner, Empty } from "./ui";
import { Markdown } from "./Markdown";
import { ChartCard } from "./ChartCard";
import { ResultGrid } from "./ResultGrid";
import { mod } from "../lib/format";

interface Approval { id: string; description: string; statement: string }
interface ToolRun { id: string; name: string; input: unknown; result?: { content: string; is_error: boolean; display?: unknown } }
/** Live state of one in-progress turn, keyed by session id so switching sessions never loses it. */
interface Turn { text: string; tools: ToolRun[]; status?: string; approval?: Approval | null }

export function ChatPanel({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const activeTab = useActiveTab();
  const live = useStore((s) => s.live);
  const connections = useStore((s) => s.connections);
  const settings = useStore((s) => s.settings);
  const chatSessionId = useStore((s) => s.chatSessionId);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const toast = useStore((s) => s.toast);
  const saveDashboard = useStore((s) => s.saveDashboard);
  const dashboards = useStore((s) => s.dashboards);
  const openTab = useStore((s) => s.openTab);

  const connId = activeTab?.connectionId && live[activeTab.connectionId] ? activeTab.connectionId : Object.keys(live)[0] ?? null;
  const conn = connections.find((c) => c.id === connId) ?? null;
  const prefill = useStore((s) => s.chatPrefill);
  const takeChatPrefill = useStore((s) => s.takeChatPrefill);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Record<string, Turn>>({});
  const loadSeq = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const providers = settings.providers;
  const providerId = session?.provider_id ?? settings.default_provider ?? providers[0]?.id ?? "";
  const streaming: Turn | null = session ? (turns[session.id] ?? null) : null;
  const approval = streaming?.approval ?? null;
  const busy = !!streaming;
  const patchTurn = useCallback((id: string, f: (t: Turn) => Turn) => setTurns((all) => ({ ...all, [id]: f(all[id] ?? { text: "", tools: [] }) })), []);

  const refreshSessions = useCallback(async () => {
    if (!connId) return;
    setSessions(await api.aiListSessions(connId).catch(() => []));
  }, [connId]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Load the requested/most recent session for this connection; late responses are ignored.
  useEffect(() => {
    if (!connId) { setSession(null); return; }
    const id = chatSessionId && sessions.some((s) => s.id === chatSessionId && s.connection_id === connId) ? chatSessionId : sessions.find((s) => s.connection_id === connId)?.id;
    if (!id) { setSession(null); return; }
    if (session?.id === id) return;
    const seq = ++loadSeq.current;
    api
      .aiGetSession(id)
      .then((s) => { if (seq === loadSeq.current) setSession(s); })
      .catch(() => { if (seq === loadSeq.current) setSession(null); });
  }, [connId, chatSessionId, sessions, session?.id]);

  // Agent events: applied to the turn of whichever session they belong to.
  useEffect(() => {
    const un = listen<{ session_id: string; event: AgentEvent }>("ai:event", ({ payload }) => {
      const sid = payload.session_id;
      const ev = payload.event;
      if (ev.kind === "text_delta") patchTurn(sid, (t) => ({ ...t, text: t.text + ev.text }));
      else if (ev.kind === "tool_call") patchTurn(sid, (t) => ({ ...t, tools: [...t.tools, { id: ev.id, name: ev.name, input: ev.input }] }));
      else if (ev.kind === "tool_result") patchTurn(sid, (t) => ({ ...t, tools: t.tools.map((x) => (x.id === ev.id ? { ...x, result: { content: ev.content, is_error: ev.is_error, display: ev.display } } : x)) }));
      else if (ev.kind === "status") patchTurn(sid, (t) => ({ ...t, status: ev.text }));
      else if (ev.kind === "approval_request") patchTurn(sid, (t) => ({ ...t, approval: { id: ev.id, description: ev.description, statement: ev.statement } }));
      else if (ev.kind === "error") toast(ev.message, "error");
      else if (ev.kind === "done") {
        setTurns((all) => { const n = { ...all }; delete n[sid]; return n; });
        setSession((cur) => (cur?.id === sid ? ev.session : cur));
        void refreshSessions();
      }
    });
    return () => { void un.then((f) => f()); };
  }, [patchTurn, toast, refreshSessions]);

  // Prefill queued from elsewhere in the app (store-backed, so it survives the panel mounting late).
  useEffect(() => {
    if (prefill === null) return;
    setDraft(prefill);
    takeChatPrefill();
    setTimeout(() => input.current?.focus(), 50);
  }, [prefill, takeChatPrefill]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [session?.messages.length, streaming?.text, streaming?.tools.length]);

  const newSession = async () => {
    if (!connId) return;
    if (!providerId) { toast("Add an AI provider in Settings first", "error"); onOpenSettings(); return; }
    const s = await api.aiCreateSession(connId, providerId);
    loadSeq.current++;
    setSessions((list) => [s, ...list]);
    setSession(s);
    setChatOpen(true, s.id);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !connId) return;
    if (!providerId) { toast("Add an AI provider in Settings first", "error"); onOpenSettings(); return; }
    let s = session;
    if (!s) {
      s = await api.aiCreateSession(connId, providerId);
      loadSeq.current++;
      setSessions((list) => [s!, ...list]);
      setChatOpen(true, s.id);
    }
    const sid = s.id;
    setDraft("");
    patchTurn(sid, (t) => t);
    setSession({ ...s, messages: [...s.messages, { role: "user", blocks: [{ type: "text", text }], ts: new Date().toISOString() }] });
    try {
      await api.aiSend(sid, text);
    } catch (e) {
      toast(errMsg(e), "error");
      setTurns((all) => { const n = { ...all }; delete n[sid]; return n; });
    }
  };

  const cancel = () => session && void api.aiCancel(session.id);

  const changeProvider = async (pid: string) => {
    if (!session) return;
    await api.aiSetSessionProvider(session.id, pid);
    setSession({ ...session, provider_id: pid });
  };

  const addChartToDashboard = async (spec: ChartSpec, dashboardId?: string) => {
    if (!connId) return;
    const existing = dashboardId ? dashboards.find((d) => d.id === dashboardId) : undefined;
    const d: Dashboard = existing
      ? { ...existing, charts: [...existing.charts, spec] }
      : { id: crypto.randomUUID(), connection_id: connId, title: spec.title, charts: [spec], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    await saveDashboard(d);
    toast(`Added to "${d.title}"`, "success");
    openTab({ kind: "dashboard", connectionId: connId, title: d.title, dashboardId: d.id });
  };

  const saveProposedDashboard = async (title: string, description: string | null, charts: ChartSpec[]) => {
    if (!connId) return;
    const d: Dashboard = { id: crypto.randomUUID(), connection_id: connId, title, description, charts, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    await saveDashboard(d);
    openTab({ kind: "dashboard", connectionId: connId, title, dashboardId: d.id });
  };

  const connDashboards = dashboards.filter((d) => d.connection_id === connId);
  const messages = useMemo(() => (session ? groupMessages(session.messages) : []), [session]);

  return (
    <section className="flex h-full flex-col border-l border-border bg-bg" aria-label="AI assistant">
      <header className="flex h-9 items-center gap-1 border-b border-border bg-elev px-2">
        <Bot size={14} className="text-accent" />
        <Menu
          align="start"
          trigger={
            <button className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium hover:bg-hover" aria-label="Chat sessions">
              <span className="truncate">{session?.title ?? "New chat"}</span>
              <ChevronDown size={12} className="text-faint" />
            </button>
          }
          items={[
            { label: "New chat", icon: <Plus size={13} />, onSelect: () => void newSession() },
            ...(sessions.length ? [{ separator: true, label: "" }] : []),
            ...sessions.slice(0, 20).map((s) => ({ label: s.title || "Untitled", onSelect: () => setChatOpen(true, s.id) })),
            ...(session ? [{ separator: true, label: "" }, { label: "Delete this chat", icon: <Trash2 size={13} />, danger: true, onSelect: async () => { await api.aiDeleteSession(session.id); setSession(null); setChatOpen(true, null); await refreshSessions(); } }] : []),
          ]}
        />
        {providers.length > 0 ? (
          <Select value={providerId} onChange={(e) => (session ? void changeProvider(e.target.value) : void useStore.getState().saveSettings({ ...settings, default_provider: e.target.value }))} className="h-6 w-[132px] shrink-0 truncate text-[11px] py-0" aria-label="Provider">
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        ) : (
          <Button size="sm" variant="ghost" onClick={onOpenSettings}><Settings size={12} /> Set up provider</Button>
        )}
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close assistant"><X size={14} /></Button>
      </header>

      <div ref={scroller} className="flex-1 overflow-auto scroll px-3 py-3 space-y-3">
        {!conn ? (
          <Empty icon={<Bot size={28} />} title="Connect to a database" hint="The assistant works against the connection of the active tab." />
        ) : messages.length === 0 && !streaming ? (
          <div className="text-xs text-muted space-y-3">
            <p>Ask anything about <span className="font-medium text-fg">{conn.name}</span>. The agent inspects the schema and runs read-only queries itself; writes need your approval.</p>
            <div className="flex flex-col gap-1.5">
              {["What tables are here and how do they relate?", "Show me the 10 most recent records in the biggest table", "Build a dashboard of key metrics", "Find slow or missing indexes"].map((p) => (
                <button key={p} onClick={() => { setDraft(p); input.current?.focus(); }} className="rounded-md border border-border bg-elev px-2.5 py-1.5 text-left hover:bg-hover">{p}</button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m, i) => (
          <MessageView key={i} m={m} connectionId={connId ?? undefined} onAddChart={addChartToDashboard} dashboards={connDashboards} onSaveDashboard={saveProposedDashboard} />
        ))}
        {streaming && (
          <div className="space-y-2">
            {streaming.tools.map((t) => (
              <ToolCard key={t.id} name={t.name} input={t.input} result={t.result} connectionId={connId ?? undefined} onAddChart={addChartToDashboard} dashboards={connDashboards} onSaveDashboard={saveProposedDashboard} />
            ))}
            {streaming.text ? <Markdown text={streaming.text} connectionId={connId ?? undefined} /> : null}
            {approval && (
              <div className="rounded-lg border border-warning/50 bg-warning/10 p-3" role="region" aria-live="assertive" aria-label="Approval required">
                <div className="mb-1 text-xs font-semibold">{approval.description}</div>
                <pre className="mb-2 max-h-40 overflow-auto scroll rounded bg-sunken p-2 font-mono text-xs whitespace-pre-wrap selectable">{approval.statement}</pre>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" autoFocus onClick={() => { void api.aiResolveApproval(approval.id, true); patchTurn(session!.id, (t) => ({ ...t, approval: null })); }}><Check size={12} /> Run it</Button>
                  <Button size="sm" onClick={() => { void api.aiResolveApproval(approval.id, false); patchTurn(session!.id, (t) => ({ ...t, approval: null })); }}>Deny</Button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-muted"><Spinner /> {streaming.status ?? (streaming.tools.some((t) => !t.result) ? "Running tools…" : "Thinking…")}</div>
          </div>
        )}
      </div>

      <form
        className="border-t border-border bg-elev p-2"
        onSubmit={(e) => { e.preventDefault(); void send(); }}
      >
        <div className="flex items-end gap-2 rounded-lg border border-border bg-bg p-1.5 focus-within:border-accent">
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            rows={Math.min(8, Math.max(2, draft.split("\n").length))}
            placeholder={conn ? `Ask about ${conn.name}…` : "Connect to a database first"}
            disabled={!conn}
            aria-label="Message"
            className="flex-1 resize-none overflow-y-auto bg-transparent px-1 py-1 text-[13px] outline-none placeholder:text-faint selectable"
          />
          {busy ? (
            <Button size="icon" variant="ghost" onClick={cancel} aria-label="Stop"><Square size={13} /></Button>
          ) : (
            <Button size="icon" variant="primary" type="submit" disabled={!draft.trim() || !conn} aria-label="Send"><Send size={13} /></Button>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 px-1 text-[10px] text-faint">
          <span>{settings.agent_allow_writes ? "Writes allowed with approval" : "Read-only agent"}</span>
          <span className="flex-1" />
          <span>Enter sends · Shift+Enter newline · {mod}+K toggles</span>
        </div>
      </form>
    </section>
  );
}

/** Pair tool_use blocks with their results so they render as one card. */
interface Grouped { role: "user" | "assistant"; text: string; tools: { id: string; name: string; input: unknown; result?: { content: string; is_error: boolean; display?: unknown } }[] }

function groupMessages(msgs: Message[]): Grouped[] {
  const out: Grouped[] = [];
  const results = new Map<string, { content: string; is_error: boolean; display?: unknown }>();
  for (const m of msgs) for (const b of m.blocks) if (b.type === "tool_result") results.set(b.tool_use_id, { content: b.content, is_error: b.is_error, display: b.display });
  for (const m of msgs) {
    const text = m.blocks.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
    const tools = m.blocks.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input, result: results.get(b.id) }));
    if (!text && tools.length === 0) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role && m.role === "assistant" && !text) { last.tools.push(...tools); continue; }
    out.push({ role: m.role, text, tools });
  }
  return out;
}

type ChartHandlers = { connectionId?: string; onAddChart: (spec: ChartSpec, dashboardId?: string) => void; dashboards: Dashboard[]; onSaveDashboard: (title: string, description: string | null, charts: ChartSpec[]) => void };

function MessageView({ m, ...h }: { m: Grouped } & ChartHandlers) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] rounded-2xl rounded-br-md bg-accent-soft px-3 py-2 text-[13px] whitespace-pre-wrap selectable">{m.text}</div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {m.tools.map((t) => <ToolCard key={t.id} {...t} {...h} />)}
      {m.text && <Markdown text={m.text} connectionId={h.connectionId} />}
    </div>
  );
}

const TOOL_LABELS: Record<string, string> = { list_schemas: "Listed schemas", list_tables: "Listed tables", describe_table: "Described table", run_sql: "Ran SQL", explain_sql: "Explained query", create_chart: "Created chart", propose_dashboard: "Proposed dashboard", redis_scan: "Scanned keys", redis_command: "Ran Redis command", list_databases: "Listed databases", list_collections: "Listed collections", describe_collection: "Described collection", mongo_find: "Found documents", mongo_aggregate: "Ran aggregation" };

function ToolCard({ name, input, result, connectionId, onAddChart, dashboards, onSaveDashboard }: { name: string; input: unknown; result?: { content: string; is_error: boolean; display?: unknown } } & ChartHandlers) {
  const display = result?.display as { type?: string; [k: string]: unknown } | undefined;
  const [open, setOpen] = useState(false);
  const inp = input as Record<string, unknown>;
  const summary = typeof inp?.sql === "string" ? inp.sql : typeof inp?.table === "string" ? `${inp.schema ? `${inp.schema}.` : ""}${inp.table}` : typeof inp?.command === "string" ? inp.command : typeof inp?.collection === "string" ? `${inp.db ?? ""}.${inp.collection}` : typeof inp?.title === "string" ? inp.title : "";

  // Rich displays
  if (display?.type === "chart" && !result?.is_error) {
    const spec = display.spec as ChartSpec;
    return (
      <div>
        <ChartCard spec={spec} data={display.data as QueryResult} height={200} onAddToDashboard={() => onAddChart(spec)} onShowQuery={() => connectionId && window.dispatchEvent(new CustomEvent("agentql:insert-sql", { detail: spec.source.kind === "sql" ? spec.source.sql : JSON.stringify(spec.source.pipeline, null, 2) }))} />
        {dashboards.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted">
            add to:
            {dashboards.map((d) => <button key={d.id} onClick={() => onAddChart(spec, d.id)} className="rounded border border-border px-1.5 hover:bg-hover">{d.title}</button>)}
          </div>
        )}
      </div>
    );
  }
  if (display?.type === "dashboard" && !result?.is_error) {
    const charts = display.charts as { spec: ChartSpec; data: QueryResult }[];
    return (
      <div className="rounded-lg border border-accent/40 bg-elev p-2">
        <div className="mb-2 flex items-center gap-2">
          <LayoutDashboard size={14} className="text-accent" />
          <span className="text-[13px] font-semibold flex-1">{String(display.title)}</span>
          <Button size="sm" variant="primary" onClick={() => onSaveDashboard(String(display.title), (display.description as string | null) ?? null, charts.map((c) => c.spec))}>Save dashboard</Button>
        </div>
        <div className="grid gap-2">{charts.map((c) => <ChartCard key={c.spec.id} spec={c.spec} data={c.data} height={160} />)}</div>
      </div>
    );
  }

  return (
    <div className={clsx("rounded-md border text-xs", result?.is_error ? "border-danger/40" : "border-border", "bg-elev")}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-hover" aria-expanded={open}>
        {open ? <ChevronDown size={12} className="text-faint" /> : <ChevronRight size={12} className="text-faint" />}
        <Wrench size={12} className={result ? (result.is_error ? "text-danger" : "text-success") : "text-muted"} aria-hidden />
        <span className="sr-only">{result ? (result.is_error ? "failed" : "succeeded") : "running"}</span>
        <span className="font-medium">{TOOL_LABELS[name] ?? name}</span>
        <span className="truncate font-mono text-muted flex-1">{summary}</span>
        {!result && <Spinner />}
      </button>
      {open && (
        <div className="border-t border-border p-2 space-y-2">
          <pre className="max-h-32 overflow-auto scroll rounded bg-sunken p-1.5 font-mono whitespace-pre-wrap selectable">{typeof inp?.sql === "string" ? inp.sql : JSON.stringify(input, null, 2)}</pre>
          {result && (display?.type === "query_results" ? (
            <div className="h-56 rounded border border-border overflow-hidden">
              <ResultGrid result={(display.results as QueryResult[])[(display.results as QueryResult[]).length - 1]} />
            </div>
          ) : (
            <pre className={clsx("max-h-48 overflow-auto scroll rounded bg-sunken p-1.5 font-mono whitespace-pre-wrap selectable", result.is_error && "text-danger")}>{result.content}</pre>
          ))}
        </div>
      )}
    </div>
  );
}
