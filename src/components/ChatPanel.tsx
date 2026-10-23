import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { clsx } from "clsx";
import {
  BookText,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  LayoutDashboard,
  Lock,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  Square,
  Table2,
  Terminal,
  Trash2,
  Unlock,
  X,
  Zap,
} from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useStore, useActiveTab } from "../lib/store";
import {
  isSql,
  type AgentEvent,
  type Block,
  type ChartSpec,
  type ChatSession,
  type Dashboard,
  type Message,
  type QueryResult,
} from "../lib/types";
import { Button, Menu, Spinner, Empty, Tooltip, EnvBadge } from "./ui";
import { Markdown } from "./Markdown";
import { ChartCard } from "./ChartCard";
import { AgentScopeDialog } from "./AgentScopeDialog";
import { ResultGrid } from "./ResultGrid";
import { fmtDuration } from "../lib/format";

interface Approval {
  id: string;
  kind: "write" | "consent" | "note";
  description: string;
  statement: string;
}
interface ToolRun {
  id: string;
  name: string;
  input: unknown;
  result?: { content: string; is_error: boolean; display?: unknown };
}
/** Live state of one in-progress turn, keyed by session id so switching sessions never loses it. */
interface Turn {
  text: string;
  tools: ToolRun[];
  status?: string;
  approval?: Approval | null;
  startedAt: number;
}

export function ChatPanel({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const activeTab = useActiveTab();
  const live = useStore((s) => s.live);
  const connections = useStore((s) => s.connections);
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const chatSessionId = useStore((s) => s.chatSessionId);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const toast = useStore((s) => s.toast);
  const saveDashboard = useStore((s) => s.saveDashboard);
  const dashboards = useStore((s) => s.dashboards);
  const openTab = useStore((s) => s.openTab);
  const prefill = useStore((s) => s.chatPrefill);
  const takeChatPrefill = useStore((s) => s.takeChatPrefill);
  const refreshConnections = useStore((s) => s.refreshConnections);
  const [scopeOpen, setScopeOpen] = useState(false);

  const connId =
    activeTab?.connectionId && live[activeTab.connectionId] ? activeTab.connectionId : (Object.keys(live)[0] ?? null);
  const conn = connections.find((c) => c.id === connId) ?? null;
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Record<string, Turn>>({});
  const loadSeq = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const providers = settings.providers;
  const providerId = session?.provider_id ?? settings.default_provider ?? providers[0]?.id ?? "";
  const provider = providers.find((p) => p.id === providerId);
  const streaming: Turn | null = session ? (turns[session.id] ?? null) : null;
  const approval = streaming?.approval ?? null;
  // The session's own connection, not the active tab's: the write runs where the session is bound.
  const prodWrite =
    approval?.kind === "write" &&
    connections.find((c) => c.id === session?.connection_id)?.environment === "production";
  const busy = !!streaming;
  const patchTurn = useCallback(
    (id: string, f: (t: Turn) => Turn) =>
      setTurns((all) => ({ ...all, [id]: f(all[id] ?? { text: "", tools: [], startedAt: Date.now() }) })),
    [],
  );

  const refreshSessions = useCallback(async () => {
    if (!connId) return;
    setSessions(await api.aiListSessions(connId).catch(() => []));
  }, [connId]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Load the requested/most recent session for this connection; late responses are ignored.
  useEffect(() => {
    if (!connId) {
      setSession(null);
      return;
    }
    const id =
      chatSessionId && sessions.some((s) => s.id === chatSessionId && s.connection_id === connId)
        ? chatSessionId
        : sessions.find((s) => s.connection_id === connId)?.id;
    if (!id) {
      setSession(null);
      return;
    }
    if (session?.id === id) return;
    const seq = ++loadSeq.current;
    api
      .aiGetSession(id)
      .then((s) => {
        if (seq === loadSeq.current) setSession(s);
      })
      .catch(() => {
        if (seq === loadSeq.current) setSession(null);
      });
  }, [connId, chatSessionId, sessions, session?.id]);

  // Agent events: applied to the turn of whichever session they belong to.
  useEffect(() => {
    const un = listen<{ session_id: string; event: AgentEvent }>("ai:event", ({ payload }) => {
      const sid = payload.session_id;
      const ev = payload.event;
      if (ev.kind === "text_delta") patchTurn(sid, (t) => ({ ...t, text: t.text + ev.text }));
      else if (ev.kind === "tool_call")
        patchTurn(sid, (t) => ({ ...t, tools: [...t.tools, { id: ev.id, name: ev.name, input: ev.input }] }));
      else if (ev.kind === "tool_result")
        patchTurn(sid, (t) => ({
          ...t,
          tools: t.tools.map((x) =>
            x.id === ev.id ? { ...x, result: { content: ev.content, is_error: ev.is_error, display: ev.display } } : x,
          ),
        }));
      else if (ev.kind === "status") patchTurn(sid, (t) => ({ ...t, status: ev.text }));
      else if (ev.kind === "approval_request")
        patchTurn(sid, (t) => ({
          ...t,
          approval: { id: ev.id, kind: ev.approval_kind, description: ev.description, statement: ev.statement },
        }));
      else if (ev.kind === "error") toast(ev.message, "error");
      else if (ev.kind === "done") {
        setTurns((all) => {
          const n = { ...all };
          delete n[sid];
          return n;
        });
        setSession((cur) => (cur?.id === sid ? ev.session : cur));
        void refreshSessions();
        // A granted remote-provider consent is stored on the connection by the backend.
        void refreshConnections();
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, [patchTurn, toast, refreshSessions, refreshConnections]);

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

  // Auto-size the composer.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [draft]);

  const newSession = async () => {
    if (!connId) return;
    if (!providerId) {
      toast("Add an AI provider in Settings first", "error");
      onOpenSettings();
      return;
    }
    const s = await api.aiCreateSession(connId, providerId);
    loadSeq.current++;
    setSessions((list) => [s, ...list]);
    setSession(s);
    setChatOpen(true, s.id);
    input.current?.focus();
  };

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? draft).trim();
    if (!text || busy || !connId) return;
    if (!providerId) {
      toast("Add an AI provider in Settings first", "error");
      onOpenSettings();
      return;
    }
    let s = session;
    if (!s) {
      s = await api.aiCreateSession(connId, providerId);
      loadSeq.current++;
      setSessions((list) => [s!, ...list]);
      setChatOpen(true, s.id);
    }
    const sid = s.id;
    setDraft("");
    setTurns((all) => ({ ...all, [sid]: { text: "", tools: [], startedAt: Date.now() } }));
    setSession({
      ...s,
      messages: [...s.messages, { role: "user", blocks: [{ type: "text", text }], ts: new Date().toISOString() }],
    });
    try {
      await api.aiSend(sid, text);
    } catch (e) {
      toast(errMsg(e), "error");
      setTurns((all) => {
        const n = { ...all };
        delete n[sid];
        return n;
      });
    }
  };

  const cancel = () => session && void api.aiCancel(session.id);

  const changeProvider = async (pid: string) => {
    if (session) {
      await api.aiSetSessionProvider(session.id, pid);
      setSession({ ...session, provider_id: pid });
    } else {
      await saveSettings({ ...settings, default_provider: pid });
    }
  };

  const toggleWrites = () => void saveSettings({ ...settings, agent_allow_writes: !settings.agent_allow_writes });

  const addChartToDashboard = async (spec: ChartSpec, dashboardId?: string) => {
    if (!connId) return;
    const existing = dashboardId ? dashboards.find((d) => d.id === dashboardId) : undefined;
    const d: Dashboard = existing
      ? { ...existing, charts: [...existing.charts, spec] }
      : {
          id: crypto.randomUUID(),
          connection_id: connId,
          title: spec.title,
          charts: [spec],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
    await saveDashboard(d);
    toast(`Added to "${d.title}"`, "success");
    openTab({ kind: "dashboard", connectionId: connId, title: d.title, dashboardId: d.id });
  };

  const saveProposedDashboard = async (title: string, description: string | null, charts: ChartSpec[]) => {
    if (!connId) return;
    const d: Dashboard = {
      id: crypto.randomUUID(),
      connection_id: connId,
      title,
      description,
      charts,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await saveDashboard(d);
    openTab({ kind: "dashboard", connectionId: connId, title, dashboardId: d.id });
  };

  const connDashboards = dashboards.filter((d) => d.connection_id === connId);
  const turnsDone = useMemo(() => (session ? groupTurns(session.messages) : []), [session]);
  const handlers: ChartHandlers = {
    connectionId: connId ?? undefined,
    onAddChart: addChartToDashboard,
    dashboards: connDashboards,
    onSaveDashboard: saveProposedDashboard,
  };
  const suggestions = conn ? suggestionsFor(conn.driver) : [];

  return (
    <section className="flex h-full flex-col border-l border-border bg-bg" aria-label="AI assistant">
      {conn && (
        <AgentScopeDialog key={`${conn.id}-${scopeOpen}`} conn={conn} open={scopeOpen} onOpenChange={setScopeOpen} />
      )}
      <header className="flex h-9 items-center gap-1 border-b border-border bg-elev px-2">
        <Menu
          align="start"
          trigger={
            <button
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium hover:bg-hover"
              aria-label="Chat sessions"
            >
              <Sparkles size={13} className="shrink-0 text-accent" />
              <span className="truncate">{session?.title ?? "New chat"}</span>
              <ChevronDown size={12} className="shrink-0 text-faint" />
            </button>
          }
          items={[
            { label: "New chat", icon: <Plus size={13} />, onSelect: () => void newSession() },
            ...(sessions.length ? [{ separator: true, label: "" }] : []),
            ...sessions
              .slice(0, 20)
              .map((s) => ({ label: s.title || "Untitled", onSelect: () => setChatOpen(true, s.id) })),
            ...(session
              ? [
                  { separator: true, label: "" },
                  {
                    label: "Delete this chat",
                    icon: <Trash2 size={13} />,
                    danger: true,
                    onSelect: async () => {
                      await api.aiDeleteSession(session.id);
                      setSession(null);
                      setChatOpen(true, null);
                      await refreshSessions();
                    },
                  },
                ]
              : []),
          ]}
        />
        <Tooltip label="New chat">
          <Button variant="ghost" size="icon" onClick={() => void newSession()} aria-label="New chat">
            <Pencil size={13} />
          </Button>
        </Tooltip>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close assistant">
          <X size={14} />
        </Button>
      </header>

      <div ref={scroller} className="flex-1 overflow-auto scroll px-3 py-4 space-y-5">
        {!conn ? (
          <Empty
            icon={<Bot size={28} />}
            title="Connect to a database"
            hint="The assistant works against the connection of the active tab."
          />
        ) : turnsDone.length === 0 && !streaming ? (
          <div className="flex h-full flex-col justify-end gap-4 pb-2">
            <div>
              <div className="mb-1 flex items-center gap-2 text-[15px] font-semibold">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <Sparkles size={14} />
                </span>
                What do you want to know about {conn.name}?
              </div>
              <p className="text-xs text-muted">
                I can inspect the schema, run read-only queries, explain and optimise SQL, and build charts and
                dashboards. Writes always ask first.
              </p>
            </div>
            <div className="flex flex-col gap-1.5" aria-label="Suggestions">
              {suggestions.map((s) => (
                <button
                  key={s.text}
                  onClick={() => void send(s.text)}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-elev px-3 py-2 text-left text-xs hover:bg-hover hover:border-border-strong"
                >
                  <span className="text-accent">{s.icon}</span>
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turnsDone.map((t, i) => (
          <TurnView key={i} turn={t} handlers={handlers} />
        ))}

        {streaming && (
          <div className="space-y-3">
            <ActivityCard
              tools={streaming.tools}
              running
              startedAt={streaming.startedAt}
              status={streaming.status}
              handlers={handlers}
            />
            {streaming.text ? (
              <div className="relative">
                <Markdown text={streaming.text} connectionId={connId ?? undefined} />
                <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-accent pulse" aria-hidden />
              </div>
            ) : null}
            {approval && (
              <div
                className={clsx(
                  "rounded-xl border p-3",
                  prodWrite ? "border-danger/60 bg-danger-soft" : "border-warning/50 bg-warning/10",
                )}
                role="region"
                aria-live="assertive"
                aria-label="Approval required"
              >
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                  <Lock size={12} className={prodWrite ? "text-danger" : "text-warning"} /> {approval.description}
                  {prodWrite && <EnvBadge env="production" className="ml-auto" />}
                </div>
                <pre
                  className={clsx(
                    "mb-2 max-h-40 overflow-auto scroll rounded-lg bg-sunken p-2 text-xs whitespace-pre-wrap selectable",
                    approval.kind === "write" && "font-mono",
                  )}
                >
                  {approval.statement}
                </pre>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={prodWrite ? "danger" : "primary"}
                    autoFocus={!prodWrite}
                    onClick={() => {
                      void api.aiResolveApproval(approval.id, true);
                      patchTurn(session!.id, (t) => ({ ...t, approval: null }));
                    }}
                  >
                    <Check size={12} />{" "}
                    {approval.kind === "consent"
                      ? "Allow"
                      : approval.kind === "note"
                        ? "Save note"
                        : prodWrite
                          ? "Run on production"
                          : "Run it"}
                  </Button>
                  {/* On production, Enter lands on Deny: a stray keypress must not write. */}
                  <Button
                    size="sm"
                    autoFocus={prodWrite}
                    onClick={() => {
                      void api.aiResolveApproval(approval.id, false);
                      patchTurn(session!.id, (t) => ({ ...t, approval: null }));
                    }}
                  >
                    {approval.kind === "consent" ? "Not now" : "Deny"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form
        className="px-3 pb-3 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div
          className={clsx(
            "rounded-2xl border bg-elev shadow-sm transition-colors",
            busy ? "border-border" : "border-border focus-within:border-accent",
          )}
        >
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={conn ? `Ask about ${conn.name}…` : "Connect to a database first"}
            disabled={!conn}
            aria-label="Message"
            className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[13px] leading-5 outline-none focus-visible:outline-none placeholder:text-faint selectable"
          />
          <div className="flex items-center gap-1 px-2 pb-2 whitespace-nowrap">
            {providers.length > 0 ? (
              <Menu
                align="start"
                trigger={
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-fg"
                    aria-label="Choose provider"
                  >
                    <Zap size={11} className="shrink-0" />
                    <span className="max-w-[120px] truncate">{provider?.name ?? "Choose provider"}</span>
                    <ChevronDown size={11} />
                  </button>
                }
                items={[
                  ...providers.map((p) => ({
                    label: p.name,
                    icon: p.id === providerId ? <Check size={13} /> : <span className="w-[13px]" />,
                    onSelect: () => void changeProvider(p.id),
                  })),
                  { separator: true, label: "" },
                  { label: "Manage providers…", icon: <Settings size={13} />, onSelect: onOpenSettings },
                ]}
              />
            ) : (
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[11px] text-fg hover:brightness-105"
              >
                <Settings size={11} /> Set up a provider
              </button>
            )}
            <Tooltip
              label={
                settings.agent_allow_writes
                  ? "Writes allowed (each one asks for approval). Click to make read-only."
                  : "Read-only. Click to allow writes with approval."
              }
            >
              <button
                type="button"
                onClick={toggleWrites}
                aria-pressed={settings.agent_allow_writes}
                className={clsx(
                  "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                  settings.agent_allow_writes
                    ? "border-warning/50 bg-warning/10 text-warning"
                    : "border-border text-muted hover:bg-hover hover:text-fg",
                )}
              >
                {settings.agent_allow_writes ? <Unlock size={11} /> : <Lock size={11} />}
                {settings.agent_allow_writes ? "Writes on" : "Read-only"}
              </button>
            </Tooltip>
            {conn && isSql(conn.driver) && (
              <Tooltip label="Which schemas and tables the agent may see on this connection">
                <button
                  type="button"
                  onClick={() => setScopeOpen(true)}
                  className={clsx(
                    "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                    conn.agent_scope
                      ? "border-accent/40 bg-accent-soft text-fg"
                      : "border-border text-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  <Table2 size={11} />
                  {conn.agent_scope ? `Scope: ${conn.agent_scope.length}` : "All tables"}
                </button>
              </Tooltip>
            )}
            <span className="flex-1" />
            {busy ? (
              <Tooltip label="Stop">
                <button
                  type="button"
                  onClick={cancel}
                  aria-label="Stop"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-fg text-bg hover:opacity-90"
                >
                  <Square size={11} fill="currentColor" />
                </button>
              </Tooltip>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim() || !conn}
                aria-label="Send"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-40 hover:brightness-110"
              >
                <ArrowUp size={14} />
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

// ------------------------------------------------------------------ data shaping

/** A user message followed by everything the agent did until its final answer. */
interface AgentTurn {
  user: string;
  tools: ToolRun[];
  text: string;
  startedAt: number | null;
  finishedAt: number | null;
}

function groupTurns(msgs: Message[]): AgentTurn[] {
  const out: AgentTurn[] = [];
  const results = new Map<string, { content: string; is_error: boolean; display?: unknown }>();
  for (const m of msgs)
    for (const b of m.blocks)
      if (b.type === "tool_result")
        results.set(b.tool_use_id, { content: b.content, is_error: b.is_error, display: b.display });
  let cur: AgentTurn | null = null;
  for (const m of msgs) {
    const texts = m.blocks
      .filter((b): b is Extract<Block, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const tools = m.blocks
      .filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input, result: results.get(b.id) }));
    const ts = m.ts ? Date.parse(m.ts) : NaN;
    if (m.role === "user" && texts) {
      cur = { user: texts, tools: [], text: "", startedAt: Number.isNaN(ts) ? null : ts, finishedAt: null };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    cur.tools.push(...tools);
    if (m.role === "assistant" && texts) cur.text = cur.text ? `${cur.text}\n\n${texts}` : texts;
    if (!Number.isNaN(ts) && m.role === "assistant") cur.finishedAt = ts;
  }
  return out;
}

type ChartHandlers = {
  connectionId?: string;
  onAddChart: (spec: ChartSpec, dashboardId?: string) => void;
  dashboards: Dashboard[];
  onSaveDashboard: (title: string, description: string | null, charts: ChartSpec[]) => void;
};

function TurnView({ turn, handlers }: { turn: AgentTurn; handlers: ChartHandlers }) {
  const duration = turn.startedAt && turn.finishedAt ? Math.max(0, turn.finishedAt - turn.startedAt) : null;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[13px] whitespace-pre-wrap selectable">
          {turn.user}
        </div>
      </div>
      {turn.tools.length > 0 && (
        <ActivityCard tools={turn.tools} running={false} duration={duration} handlers={handlers} />
      )}
      {turn.text && <Markdown text={turn.text} connectionId={handlers.connectionId} />}
    </div>
  );
}

// ------------------------------------------------------------------ activity timeline

const STEP_ICON: Record<string, React.ReactNode> = {
  list_schemas: <Database size={12} />,
  list_tables: <Database size={12} />,
  describe_table: <Table2 size={12} />,
  save_note: <BookText size={12} />,
  run_sql: <Terminal size={12} />,
  explain_sql: <Search size={12} />,
  create_chart: <LayoutDashboard size={12} />,
  propose_dashboard: <LayoutDashboard size={12} />,
  redis_scan: <Search size={12} />,
  redis_command: <Terminal size={12} />,
  list_databases: <Database size={12} />,
  list_collections: <Database size={12} />,
  describe_collection: <Table2 size={12} />,
  mongo_find: <Search size={12} />,
  mongo_aggregate: <Terminal size={12} />,
};

/** Human summary of a step, using what the tool returned when available. */
function stepLabel(t: ToolRun): { title: string; detail?: string } {
  const inp = (t.input ?? {}) as Record<string, unknown>;
  const disp = t.result?.display as
    | { type?: string; results?: QueryResult[]; spec?: ChartSpec; charts?: unknown[]; docs?: unknown[]; title?: string }
    | undefined;
  const err = t.result?.is_error;
  const name = (k: string) => (typeof inp[k] === "string" ? (inp[k] as string) : "");
  switch (t.name) {
    case "list_schemas":
      return { title: err ? "Could not list schemas" : "Listed schemas" };
    case "list_tables":
      return { title: `Listed tables${name("schema") ? ` in ${name("schema")}` : ""}` };
    case "describe_table":
      return { title: `Inspected ${name("schema") ? `${name("schema")}.` : ""}${name("table")}` };
    case "save_note": {
      const target = [name("schema"), name("table"), name("column") || name("metric")].filter(Boolean).join(".");
      return { title: err ? "Note not saved" : `Saved note on ${target}` };
    }
    case "run_sql": {
      const r = disp?.type === "query_results" ? disp.results?.[disp.results.length - 1] : undefined;
      const detail = r
        ? r.columns.length
          ? `${r.rows.length.toLocaleString()} rows · ${fmtDuration(r.duration_ms)}`
          : `${r.affected ?? 0} affected`
        : undefined;
      return { title: err ? "Query failed" : "Ran query", detail };
    }
    case "explain_sql":
      return { title: err ? "Explain failed" : "Explained query plan" };
    case "create_chart":
      return { title: err ? "Chart failed" : `Built chart “${disp?.spec?.title ?? name("title")}”` };
    case "propose_dashboard":
      return {
        title: err ? "Dashboard failed" : `Proposed dashboard “${disp?.title ?? name("title")}”`,
        detail: disp?.charts ? `${disp.charts.length} charts` : undefined,
      };
    case "redis_scan":
      return { title: `Scanned keys ${name("pattern") || "*"}` };
    case "redis_command":
      return { title: err ? "Command failed" : `Ran ${name("command").split(/\s+/)[0]?.toUpperCase() || "command"}` };
    case "list_databases":
      return { title: "Listed databases" };
    case "list_collections":
      return { title: `Listed collections${name("db") ? ` in ${name("db")}` : ""}` };
    case "describe_collection":
      return { title: `Inspected ${name("collection")}` };
    case "mongo_find":
      return {
        title: err ? "Find failed" : `Searched ${name("collection")}`,
        detail: disp?.docs ? `${disp.docs.length} documents` : undefined,
      };
    case "mongo_aggregate":
      return {
        title: err ? "Aggregation failed" : `Aggregated ${name("collection")}`,
        detail: disp?.docs ? `${disp.docs.length} results` : undefined,
      };
    default:
      return { title: t.name };
  }
}

function ActivityCard({
  tools,
  running,
  startedAt,
  duration,
  status,
  handlers,
}: {
  tools: ToolRun[];
  running: boolean;
  startedAt?: number;
  duration?: number | null;
  status?: string;
  handlers: ChartHandlers;
}) {
  const [open, setOpen] = useState(running);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (!running) setOpen(false);
  }, [running]);
  const elapsed = running && startedAt ? Math.max(0, now - startedAt) : (duration ?? null);
  const steps = tools.filter((t) => !isRichResult(t));
  const rich = tools.filter(isRichResult);
  const failed = tools.filter((t) => t.result?.is_error).length;
  const current = running ? tools.find((t) => !t.result) : undefined;

  return (
    <div className="space-y-3">
      {(steps.length > 0 || running) && (
        <div className="rounded-xl border border-border bg-elev">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
          >
            {running ? (
              <Spinner />
            ) : failed ? (
              <X size={13} className="text-danger" />
            ) : (
              <Check size={13} className="text-success" />
            )}
            <span className="font-medium">
              {running
                ? current
                  ? stepLabel(current).title.replace(
                      /^(Ran|Listed|Inspected|Built|Proposed|Scanned|Searched|Aggregated|Explained)/,
                      (v) =>
                        ({
                          Ran: "Running",
                          Listed: "Listing",
                          Inspected: "Inspecting",
                          Built: "Building",
                          Proposed: "Proposing",
                          Scanned: "Scanning",
                          Searched: "Searching",
                          Aggregated: "Aggregating",
                          Explained: "Explaining",
                        })[v] ?? v,
                    )
                  : (status ?? "Thinking…")
                : `Worked for ${elapsed != null ? fmtDuration(Math.round(elapsed)) : "a moment"} · ${steps.length} step${steps.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}`}
            </span>
            {running && elapsed != null && (
              <span className="text-faint tabular-nums">{Math.round(elapsed / 1000)}s</span>
            )}
            <span className="flex-1" />
            {open ? (
              <ChevronDown size={13} className="text-faint" />
            ) : (
              <ChevronRight size={13} className="text-faint" />
            )}
          </button>
          {open && steps.length > 0 && (
            <ol className="border-t border-border px-3 py-2">
              {steps.map((t) => (
                <StepRow key={t.id} t={t} />
              ))}
            </ol>
          )}
        </div>
      )}
      {rich.map((t) => (
        <RichResult key={t.id} t={t} {...handlers} />
      ))}
    </div>
  );
}

function isRichResult(t: ToolRun) {
  const d = t.result?.display as { type?: string } | undefined;
  return !t.result?.is_error && (d?.type === "chart" || d?.type === "dashboard");
}

function StepRow({ t }: { t: ToolRun }) {
  const [open, setOpen] = useState(false);
  const { title, detail } = stepLabel(t);
  const inp = (t.input ?? {}) as Record<string, unknown>;
  const code =
    typeof inp.sql === "string"
      ? inp.sql
      : typeof inp.command === "string"
        ? inp.command
        : inp.pipeline
          ? JSON.stringify(inp.pipeline, null, 2)
          : inp.filter
            ? JSON.stringify(inp.filter)
            : null;
  const disp = t.result?.display as { type?: string; results?: QueryResult[]; plan?: string } | undefined;
  const pending = !t.result;
  return (
    <li className="group relative flex gap-2.5 py-1 pl-1">
      <span className="absolute left-[11px] top-6 bottom-0 w-px bg-border group-last:hidden" aria-hidden />
      <span
        className={clsx(
          "relative z-[1] mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-elev",
          t.result?.is_error
            ? "border-danger/50 text-danger"
            : pending
              ? "border-accent text-accent"
              : "border-border text-muted",
        )}
      >
        {pending ? <Spinner className="h-2.5 w-2.5 border" /> : (STEP_ICON[t.name] ?? <Terminal size={12} />)}
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left text-xs"
        >
          <span className={clsx(t.result?.is_error ? "text-danger" : "text-fg")}>{title}</span>
          {detail && <span className="text-faint">{detail}</span>}
          <span className="flex-1" />
          {(code || t.result) &&
            (open ? (
              <ChevronDown size={12} className="text-faint" />
            ) : (
              <ChevronRight size={12} className="text-faint" />
            ))}
        </button>
        {code && !open && (
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{code.replace(/\s+/g, " ")}</div>
        )}
        {open && (
          <div className="mt-1.5 space-y-1.5">
            {code && (
              <pre className="max-h-40 overflow-auto scroll rounded-lg bg-sunken p-2 font-mono text-[11px] whitespace-pre-wrap selectable">
                {code}
              </pre>
            )}
            {t.result &&
              (disp?.type === "query_results" && disp.results?.length ? (
                <div className="h-52 overflow-hidden rounded-lg border border-border">
                  <ResultGrid result={disp.results[disp.results.length - 1]} />
                </div>
              ) : (
                <pre
                  className={clsx(
                    "max-h-48 overflow-auto scroll rounded-lg bg-sunken p-2 font-mono text-[11px] whitespace-pre-wrap selectable",
                    t.result.is_error && "text-danger",
                  )}
                >
                  {t.result.content}
                </pre>
              ))}
          </div>
        )}
      </div>
    </li>
  );
}

function RichResult({ t, connectionId, onAddChart, dashboards, onSaveDashboard }: { t: ToolRun } & ChartHandlers) {
  const display = t.result!.display as { type: string; [k: string]: unknown };
  if (display.type === "chart") {
    const spec = display.spec as ChartSpec;
    return (
      <div>
        <ChartCard
          spec={spec}
          data={display.data as QueryResult}
          height={200}
          onAddToDashboard={() => onAddChart(spec)}
          onShowQuery={() =>
            connectionId &&
            window.dispatchEvent(
              new CustomEvent("agentql:insert-sql", {
                detail: spec.source.kind === "sql" ? spec.source.sql : JSON.stringify(spec.source.pipeline, null, 2),
              }),
            )
          }
        />
        {dashboards.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
            add to:
            {dashboards.map((d) => (
              <button
                key={d.id}
                onClick={() => onAddChart(spec, d.id)}
                className="rounded-full border border-border px-2 py-0.5 hover:bg-hover"
              >
                {d.title}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  const charts = display.charts as { spec: ChartSpec; data: QueryResult }[];
  return (
    <div className="rounded-xl border border-accent/40 bg-elev p-2">
      <div className="mb-2 flex items-center gap-2">
        <LayoutDashboard size={14} className="text-accent" />
        <span className="flex-1 text-[13px] font-semibold">{String(display.title)}</span>
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            onSaveDashboard(
              String(display.title),
              (display.description as string | null) ?? null,
              charts.map((c) => c.spec),
            )
          }
        >
          Save dashboard
        </Button>
      </div>
      <div className="grid gap-2">
        {charts.map((c) => (
          <ChartCard key={c.spec.id} spec={c.spec} data={c.data} height={160} />
        ))}
      </div>
    </div>
  );
}

function suggestionsFor(driver: string): { icon: React.ReactNode; text: string }[] {
  if (driver === "redis")
    return [
      { icon: <Search size={13} />, text: "What kinds of keys are in this database and how much memory do they use?" },
      { icon: <Zap size={13} />, text: "Find keys without an expiry that look like sessions or caches" },
    ];
  if (driver === "mongodb")
    return [
      { icon: <Database size={13} />, text: "What collections are here and what do their documents look like?" },
      { icon: <LayoutDashboard size={13} />, text: "Build a dashboard of key metrics for this database" },
    ];
  return [
    { icon: <Database size={13} />, text: "What tables are here and how do they relate?" },
    { icon: <Table2 size={13} />, text: "Show me the 10 most recent rows in the biggest table" },
    { icon: <LayoutDashboard size={13} />, text: "Build a dashboard of key metrics for this database" },
    { icon: <Zap size={13} />, text: "Find missing indexes and slow query patterns" },
  ];
}
