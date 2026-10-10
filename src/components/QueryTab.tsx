import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { clsx } from "clsx";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Bot, Download, History, Keyboard, Play, Save, Sparkles, StopCircle, Wand2 } from "lucide-react";
import { snippetCompletion } from "@codemirror/autocomplete";
import { api, errMsg } from "../lib/api";
import { useStore, useConnection, type Tab } from "../lib/store";
import type { QueryResult } from "../lib/types";
import { fmtDuration, mod } from "../lib/format";
import { buildNamespace, editorCompletions } from "../lib/completion";
import { SqlEditor, type SqlEditorHandle } from "./SqlEditor";
import { ResultGrid } from "./ResultGrid";
import { SHORTCUTS_EVENT } from "./ShortcutsDialog";
import { Button, Dialog, Field, Input, Menu, Spinner, Tooltip, Kbd, Empty } from "./ui";

type QTab = Extract<Tab, { kind: "query" }>;

export function QueryTab({ tab }: { tab: QTab }) {
  const conn = useConnection(tab.connectionId);
  const live = useStore((s) => s.live[tab.connectionId]);
  const updateTab = useStore((s) => s.updateTab);
  const toast = useStore((s) => s.toast);
  const addHistory = useStore((s) => s.addHistory);
  const saveQuery = useStore((s) => s.saveQuery);
  const allHistory = useStore((s) => s.history);
  const allSaved = useStore((s) => s.savedQueries);
  const history = useMemo(
    () => allHistory.filter((h) => h.connection_id === tab.connectionId),
    [allHistory, tab.connectionId],
  );
  const savedQueries = useMemo(
    () => allSaved.filter((q) => !q.connection_id || q.connection_id === tab.connectionId),
    [allSaved, tab.connectionId],
  );
  const askAssistant = useStore((s) => s.askAssistant);
  const activeTab = useStore((s) => s.activeTab);
  const vim = useStore((s) => !!s.settings.editor_vim);
  const editor = useRef<SqlEditorHandle>(null);
  const [saveForm, setSaveForm] = useState<{ name: string; trigger: string } | null>(null);
  const [results, setResults] = useState<QueryResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(0);
  const inFlight = useRef(0);

  const tables = live?.tables;
  const catalog = live?.catalog;
  const schema = useMemo(() => (tables ? buildNamespace(tables, catalog ?? {}) : undefined), [tables, catalog]);

  // JOIN / keyword / snippet completion reads the latest data through refs so the editor is configured once.
  const driver = conn?.driver;
  const compDeps = useRef({ catalog, savedQueries, driver });
  compDeps.current = { catalog, savedQueries, driver };
  const completions = useMemo(
    () =>
      editorCompletions({
        catalog: () => compDeps.current.catalog ?? {},
        postgres: () => compDeps.current.driver === "postgres",
        quote: () => (compDeps.current.driver === "mysql" || compDeps.current.driver === "mariadb" ? "`" : '"'),
        snippets: () =>
          compDeps.current.savedQueries
            .filter((q) => q.trigger)
            .map((q) => snippetCompletion(q.sql, { label: q.trigger!, detail: q.name, type: "text", boost: 3 })),
      }),
    [],
  );

  const run = useCallback(
    async (sqlText: string, explain?: "plain" | "analyze") => {
      if (!sqlText.trim() || !conn || inFlight.current) return;
      const id = ++inFlight.current;
      setRunning(true);
      setError(null);
      const started = performance.now();
      try {
        const res = explain
          ? [await api.explainQuery(conn.id, sqlText, explain === "analyze")]
          : await api.runQuery(conn.id, sqlText);
        if (inFlight.current !== id) return;
        setResults(res);
        setActive(res.length - 1);
        if (!explain) {
          void addHistory({
            id: crypto.randomUUID(),
            connection_id: conn.id,
            sql: sqlText,
            ts: new Date().toISOString(),
            duration_ms: Math.round(performance.now() - started),
            ok: true,
            rows: res.reduce((a, r) => a + r.rows.length, 0),
          });
          if (res.some((r) => r.columns.length === 0 && /^\s*(create|drop|alter)/i.test(r.statement)))
            void useStore.getState().refreshSchema(conn.id);
        }
        const first = sqlText.trim().split("\n")[0].slice(0, 32);
        if (tab.title === "Query" || tab.title.endsWith("…"))
          updateTab(tab.id, { title: first.length < sqlText.trim().length ? `${first}…` : first });
      } catch (e) {
        if (inFlight.current !== id) return;
        setError(errMsg(e));
        void addHistory({
          id: crypto.randomUUID(),
          connection_id: conn.id,
          sql: sqlText,
          ts: new Date().toISOString(),
          duration_ms: Math.round(performance.now() - started),
          ok: false,
        });
      } finally {
        if (inFlight.current === id) {
          inFlight.current = 0;
          setRunning(false);
        }
      }
    },
    [conn, tab.id, tab.title, updateTab, addHistory],
  );

  // Insert SQL coming from the chat panel into the active query tab.
  useEffect(() => {
    const onInsert = (e: Event) => {
      if (activeTab !== tab.id) return;
      const sql = (e as CustomEvent<string>).detail;
      const cur = editor.current?.getValue() ?? "";
      const next = cur.trim() ? `${cur.replace(/\s+$/, "")}\n\n${sql}` : sql;
      updateTab(tab.id, { sql: next });
      editor.current?.focus();
    };
    window.addEventListener("agentql:insert-sql", onInsert);
    return () => window.removeEventListener("agentql:insert-sql", onInsert);
  }, [activeTab, tab.id, updateTab]);

  const exportResult = async (format: "csv" | "json" | "sql") => {
    const r = results?.[active];
    if (!r) return;
    const path = await saveDialog({
      defaultPath: `query.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!path) return;
    try {
      const n = await api.exportRows(
        path,
        format,
        r.columns.map((c) => c.name),
        r.rows,
      );
      toast(`Exported ${n} rows`, "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const askAgent = (prompt: string) => askAssistant(prompt);

  const submitSave = () => {
    const sql = editor.current?.getValue() ?? "";
    if (!saveForm || !conn || !saveForm.name.trim() || !sql.trim()) return;
    void saveQuery({
      id: crypto.randomUUID(),
      connection_id: conn.id,
      name: saveForm.name.trim(),
      sql,
      trigger: saveForm.trigger.trim() || null,
      created_at: new Date().toISOString(),
    });
    setSaveForm(null);
  };

  if (!conn) return <Empty title="Connection removed" />;
  const current = results?.[active];

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex h-9 items-center gap-1 border-b border-border bg-elev px-2"
        role="toolbar"
        aria-label="Query actions"
      >
        <Tooltip label={`Run statement at cursor or selection (${mod}+Enter)`}>
          <Button
            size="sm"
            variant="primary"
            onClick={() => run(editor.current?.getRunnable() ?? "")}
            disabled={running}
          >
            {running ? <Spinner className="border-t-accent-fg" /> : <Play size={13} />} Run
          </Button>
        </Tooltip>
        <Tooltip label={`Run everything (${mod}+Shift+Enter)`}>
          <Button size="sm" onClick={() => run(editor.current?.getValue() ?? "")} disabled={running}>
            Run all
          </Button>
        </Tooltip>
        <Menu
          trigger={
            <Button size="sm" disabled={running}>
              <Wand2 size={13} /> Explain
            </Button>
          }
          items={[
            { label: "Explain plan", onSelect: () => run(editor.current?.getRunnable() ?? "", "plain") },
            {
              label: "Explain analyze (runs the query)",
              onSelect: () => run(editor.current?.getRunnable() ?? "", "analyze"),
            },
          ]}
          align="start"
        />
        <Tooltip label="Ask the assistant to optimise this query">
          <Button
            size="sm"
            onClick={() =>
              askAgent(
                `Optimise this ${conn.driver} query. Run EXPLAIN first, then explain the plan and propose a faster version and any indexes:\n\n\`\`\`sql\n${editor.current?.getRunnable() ?? ""}\n\`\`\``,
              )
            }
          >
            <Sparkles size={13} /> Optimise
          </Button>
        </Tooltip>
        <Tooltip label="Explain what this query does">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              askAgent(
                `Explain what this query does in plain language:\n\n\`\`\`sql\n${editor.current?.getRunnable() ?? ""}\n\`\`\``,
              )
            }
            aria-label="Explain query with assistant"
          >
            <Bot size={13} />
          </Button>
        </Tooltip>
        <Tooltip label={`Keyboard shortcuts (${mod}+/)`}>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Keyboard shortcuts"
            onClick={() => window.dispatchEvent(new Event(SHORTCUTS_EVENT))}
          >
            <Keyboard size={13} />
          </Button>
        </Tooltip>
        <span className="flex-1" />
        <Menu
          trigger={
            <Button size="sm" variant="ghost">
              <History size={13} /> History
            </Button>
          }
          items={
            history.length
              ? history.slice(0, 15).map((h) => ({
                  label: `${h.ok ? "✓" : "✗"} ${h.sql.replace(/\s+/g, " ").slice(0, 60)}`,
                  onSelect: () => updateTab(tab.id, { sql: h.sql }),
                }))
              : [{ label: "No history yet", disabled: true }]
          }
        />
        <Menu
          trigger={
            <Button size="sm" variant="ghost">
              <Save size={13} /> Saved
            </Button>
          }
          items={[
            {
              label: "Save current query…",
              onSelect: () => setSaveForm({ name: tab.title === "Query" ? "" : tab.title, trigger: "" }),
            },
            ...(savedQueries.length
              ? [
                  { separator: true, label: "" },
                  ...savedQueries.map((q) => ({
                    label: q.trigger ? `${q.name} · ${q.trigger}` : q.name,
                    onSelect: () => {
                      // Snippet load: `${1:x}` placeholders become Tab stops; plain SQL loads unchanged.
                      editor.current?.loadSnippet(q.sql);
                      updateTab(tab.id, { title: q.name });
                    },
                  })),
                ]
              : []),
          ]}
        />
        <Menu
          trigger={
            <Button size="sm" variant="ghost" disabled={!current || current.rows.length === 0}>
              <Download size={13} /> Export
            </Button>
          }
          items={[
            { label: "CSV…", onSelect: () => exportResult("csv") },
            { label: "JSON…", onSelect: () => exportResult("json") },
            { label: "SQL inserts…", onSelect: () => exportResult("sql") },
          ]}
        />
      </div>

      <PanelGroup direction="vertical" autoSaveId={`query-${tab.connectionId}`}>
        <Panel defaultSize={40} minSize={15}>
          <SqlEditor
            ref={editor}
            value={tab.sql}
            onChange={(sql) => updateTab(tab.id, { sql })}
            driver={conn.driver}
            schema={schema}
            onRun={() => run(editor.current?.getRunnable() ?? "")}
            onRunAll={() => run(editor.current?.getValue() ?? "")}
            vim={vim}
            completions={completions}
            placeholder={`Write ${conn.driver === "postgres" ? "PostgreSQL" : conn.driver} here. ${mod}+Enter runs the statement under the cursor.`}
          />
        </Panel>
        <PanelResizeHandle className="h-px bg-border hover:bg-accent data-[resize-handle-active]:bg-accent relative after:absolute after:inset-x-0 after:-top-1 after:-bottom-1" />
        <Panel minSize={20}>
          <div className="flex h-full flex-col">
            {results && results.length > 1 && (
              <div
                className="flex h-7 items-center gap-1 border-b border-border bg-sunken px-1 text-xs"
                role="group"
                aria-label="Result sets"
              >
                {results.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={active === i}
                    onClick={() => setActive(i)}
                    className={clsx("rounded px-2 py-0.5", active === i ? "bg-active" : "text-muted hover:text-fg")}
                  >
                    Result {i + 1}{" "}
                    <span className="text-faint">
                      ({r.columns.length ? `${r.rows.length} rows` : `${r.affected ?? 0} affected`})
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1 min-h-0">
              {error ? (
                <div
                  role="alert"
                  className="m-3 rounded-md border border-danger/40 bg-danger-soft p-3 font-mono text-xs whitespace-pre-wrap selectable"
                >
                  {error}
                  <div className="mt-2 font-sans">
                    <Button
                      size="sm"
                      onClick={() =>
                        askAgent(
                          `This query failed with the error below. Explain the cause and give me a corrected query.\n\n\`\`\`sql\n${editor.current?.getRunnable() ?? ""}\n\`\`\`\n\nError: ${error}`,
                        )
                      }
                    >
                      <Sparkles size={12} /> Ask the assistant to fix it
                    </Button>
                  </div>
                </div>
              ) : running ? (
                <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
                  <Spinner /> Running…{" "}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      inFlight.current = 0;
                      setRunning(false);
                    }}
                  >
                    <StopCircle size={12} /> Hide
                  </Button>
                </div>
              ) : current ? (
                current.columns.length > 0 ? (
                  <ResultGrid result={current} />
                ) : (
                  <div className="p-4 text-xs text-muted">
                    Statement executed. <span className="text-fg">{current.affected ?? 0}</span> row(s) affected in{" "}
                    {fmtDuration(current.duration_ms)}.
                  </div>
                )
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted">
                  Results appear here. <Kbd>{mod}</Kbd>+<Kbd>Enter</Kbd> to run.
                </div>
              )}
            </div>
            {current && current.columns.length > 0 && (
              <div
                className="flex h-6 items-center gap-3 border-t border-border bg-elev px-2 text-[11px] text-muted"
                role="status"
              >
                <span>
                  {current.rows.length.toLocaleString()} rows
                  {current.truncated && <span className="text-warning"> (truncated at row limit)</span>}
                </span>
                <span>{current.columns.length} columns</span>
                <span>{fmtDuration(current.duration_ms)}</span>
                <span className="flex-1" />
                <span>Double-click or Space to inspect a cell · {mod}+C copies</span>
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>
      <Dialog
        open={saveForm !== null}
        onOpenChange={(o) => !o && setSaveForm(null)}
        title="Save query"
        description={"Placeholders like ${1:table} become Tab stops when the query is loaded."}
        width="max-w-md"
        footer={
          <>
            <Button onClick={() => setSaveForm(null)}>Cancel</Button>
            <Button variant="primary" disabled={!saveForm?.name.trim()} onClick={submitSave}>
              Save
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitSave();
          }}
        >
          <Field label="Name">
            <Input
              autoFocus
              value={saveForm?.name ?? ""}
              onChange={(e) => setSaveForm((f) => f && { ...f, name: e.target.value })}
            />
          </Field>
          <Field
            label="Completion trigger (optional)"
            hint="Typing this word in the editor offers the query as a snippet."
          >
            <Input
              placeholder="e.g. topn"
              value={saveForm?.trigger ?? ""}
              onChange={(e) => setSaveForm((f) => f && { ...f, trigger: e.target.value.replace(/\s+/g, "") })}
            />
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
