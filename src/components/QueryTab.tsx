import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { clsx } from "clsx";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Bot, Download, FileText, History, Keyboard, Play, Save, Sparkles, StopCircle, Wand2 } from "lucide-react";
import { snippetCompletion } from "@codemirror/autocomplete";
import { api, errMsg } from "../lib/api";
import { useStore, useConnection, type Tab } from "../lib/store";
import type { QueryResult, SavedQuery, WriteInfo } from "../lib/types";
import { fmtDuration, mod } from "../lib/format";
import { buildNamespace, editorCompletions, isSnippet, snippetTemplate } from "../lib/completion";
import { countStatements } from "../lib/sql";
import { SqlEditor, type SqlEditorHandle } from "./SqlEditor";
import { ResultGrid } from "./ResultGrid";
import { SHORTCUTS_EVENT } from "./ShortcutsDialog";
import { Button, Dialog, Field, Input, Menu, Spinner, Tooltip, Kbd, Empty } from "./ui";

const basename = (p: string) => p.split(/[\\/]/).pop() || p;

type QTab = Extract<Tab, { kind: "query" }>;

/** Identifiers can carry newlines/control chars; keep the native prompt on one line per write. */
const plain = (s: string) => Array.from(s, (c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c)).join("");

export function QueryTab({ tab }: { tab: QTab }) {
  const conn = useConnection(tab.connectionId);
  const live = useStore((s) => s.live[tab.connectionId]);
  const updateTab = useStore((s) => s.updateTab);
  const openTab = useStore((s) => s.openTab);
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
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<QueryResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(0);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const inFlight = useRef(0);
  const guarding = useRef(false);
  const savedCurrent = tab.savedId ? allSaved.find((q) => q.id === tab.savedId) : undefined;

  const driver = conn?.driver;
  const quote = driver === "mysql" || driver === "mariadb" ? "`" : '"';
  const tables = live?.tables;
  const catalog = live?.catalog;
  const schema = useMemo(
    () => (tables ? buildNamespace(tables, catalog ?? {}, quote) : undefined),
    [tables, catalog, quote],
  );

  // JOIN / keyword / snippet completion reads the latest data through refs so the editor is configured once.
  const compDeps = useRef({ catalog, savedQueries, driver, quote });
  compDeps.current = { catalog, savedQueries, driver, quote };
  const completions = useMemo(
    () =>
      editorCompletions({
        catalog: () => compDeps.current.catalog ?? {},
        postgres: () => compDeps.current.driver === "postgres",
        quote: () => compDeps.current.quote,
        snippets: () =>
          compDeps.current.savedQueries
            .filter((q) => q.trigger)
            .map((q) =>
              isSnippet(q.sql)
                ? snippetCompletion(snippetTemplate(q.sql), {
                    label: q.trigger!,
                    detail: q.name,
                    type: "text",
                    boost: 3,
                  })
                : { label: q.trigger!, detail: q.name, type: "text", boost: 3, apply: q.sql },
            ),
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

  const confirmAndRun = useCallback(
    async (sqlText: string, opts: { all?: boolean; explain?: "plain" | "analyze" }) => {
      if (!conn) return;
      const lines: string[] = [];
      // Count what is about to execute (selection or whole script), not which button was pressed.
      const n = countStatements(sqlText);
      if (n > 1) lines.push(`Run ${opts.all ? "all " : ""}${n} statements?`);
      if (conn.environment === "production" && opts.explain !== "plain") {
        const docBefore = editor.current?.getValue();
        let writes: WriteInfo[];
        try {
          writes = await api.classifySql(conn.driver, sqlText);
        } catch (e) {
          toast(`Could not classify statements, not running on production: ${errMsg(e)}`, "error");
          return;
        }
        // The editor stayed editable during the IPC round trip: never prompt for, or run, SQL the user no longer sees.
        if (editor.current?.getValue() !== docBefore || useStore.getState().activeTab !== tab.id) {
          toast("Editor changed while checking the statements; run again.", "error");
          return;
        }
        if (writes.length)
          lines.push(
            `"${conn.name}" is tagged PRODUCTION. This will run:`,
            ...writes.map((w) => `  • ${plain(w.kind)}${w.table ? ` on ${plain(w.table)}` : ""}`),
          );
      }
      // ponytail: native confirm(), same as the delete prompts elsewhere; swap for <Dialog> if it needs styling.
      if (lines.length && !confirm(lines.join("\n"))) return;
      run(sqlText, opts.explain);
    },
    [conn, run, toast, tab.id],
  );

  // M1 safety: confirm "run all" when the script has several statements, and every write on a production connection.
  const runGuarded = useCallback(
    async (sqlText: string, opts: { all?: boolean; explain?: "plain" | "analyze" } = {}) => {
      if (!sqlText.trim() || !conn || inFlight.current || guarding.current) return;
      // Hold the guard across classification + confirmation so a second shortcut press cannot queue a duplicate run.
      guarding.current = true;
      try {
        await confirmAndRun(sqlText, opts);
      } finally {
        guarding.current = false;
      }
    },
    [conn, confirmAndRun],
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

  const sqlFilter = [{ name: "SQL", extensions: ["sql"] }];
  const openFile = async () => {
    try {
      const path = await openDialog({ multiple: false, filters: sqlFilter });
      if (!path) return;
      const sql = await api.readTextFile(path);
      const patch = { sql, filePath: path, title: basename(path), savedId: undefined };
      // Never clobber unsaved text: a non-empty tab opens the file next to it.
      if ((editor.current?.getValue() ?? "").trim())
        openTab({ kind: "query", connectionId: tab.connectionId, ...patch, id: undefined });
      else updateTab(tab.id, patch);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const saveFile = async (as = false) => {
    try {
      let path = as ? null : (tab.filePath ?? null);
      if (!path) path = await saveDialog({ defaultPath: tab.filePath ?? "query.sql", filters: sqlFilter });
      if (!path) return;
      await api.writeTextFile(path, editor.current?.getValue() ?? "");
      updateTab(tab.id, { filePath: path, title: basename(path) });
      toast(`Saved ${basename(path)}`, "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  /** Save to the store; re-saving an existing query records the previous text as a version. */
  const persistNamed = async (q: SavedQuery) => {
    if (saving) return;
    setSaving(true);
    try {
      await saveQuery(q);
      updateTab(tab.id, { savedId: q.id, title: q.name });
      setSaveForm(null);
      toast(`Saved "${q.name}"`, "success");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setSaving(false);
    }
  };
  /** Re-save the query this tab was loaded from (name, trigger and connection kept). */
  const saveNamed = (existing: SavedQuery) => {
    const sql = editor.current?.getValue() ?? "";
    if (sql.trim()) void persistNamed({ ...existing, sql });
  };
  /** Save dialog submit: a new saved query (optionally a snippet trigger). */
  const submitSave = () => {
    const sql = editor.current?.getValue() ?? "";
    if (!saveForm || !conn || !saveForm.name.trim() || !sql.trim()) return;
    void persistNamed({
      id: crypto.randomUUID(),
      connection_id: conn.id,
      name: saveForm.name.trim(),
      sql,
      trigger: saveForm.trigger.trim() || null,
      created_at: new Date().toISOString(),
    });
  };
  // Mod+S (global shortcut in App.tsx) saves whatever this tab is bound to: its .sql file, else its
  // saved query, else a new file.
  const onSave = useRef<() => void>(() => {});
  onSave.current = () => void (tab.filePath ? saveFile() : savedCurrent ? saveNamed(savedCurrent) : saveFile());
  useEffect(() => {
    const h = () => activeTab === tab.id && onSave.current();
    window.addEventListener("agentql:save", h);
    return () => window.removeEventListener("agentql:save", h);
  }, [activeTab, tab.id]);

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
            onClick={() => runGuarded(editor.current?.getRunnable() ?? "")}
            disabled={running}
          >
            {running ? <Spinner className="border-t-accent-fg" /> : <Play size={13} />} Run
          </Button>
        </Tooltip>
        <Tooltip label={`Run everything (${mod}+Shift+Enter)`}>
          <Button
            size="sm"
            onClick={() => runGuarded(editor.current?.getValue() ?? "", { all: true })}
            disabled={running}
          >
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
            {
              label: "Explain plan",
              onSelect: () => runGuarded(editor.current?.getRunnable() ?? "", { explain: "plain" }),
            },
            {
              label: "Explain analyze (runs the query)",
              onSelect: () => runGuarded(editor.current?.getRunnable() ?? "", { explain: "analyze" }),
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
        <Menu
          trigger={
            <Button size="sm" variant="ghost">
              <FileText size={13} /> File
            </Button>
          }
          items={[
            { label: "Open .sql file…", onSelect: () => void openFile() },
            {
              label: tab.filePath ? `Save ${basename(tab.filePath)}` : "Save as .sql…",
              shortcut: `${mod}+S`,
              onSelect: () => void saveFile(),
            },
            ...(tab.filePath ? [{ label: "Save as…", onSelect: () => void saveFile(true) }] : []),
          ]}
          align="start"
        />
        {tab.filePath && (
          <span className="min-w-0 max-w-[280px] truncate text-[11px] text-muted" title={tab.filePath}>
            {tab.filePath}
          </span>
        )}
        <Tooltip label={`Keyboard shortcuts (${mod}+Shift+/)`}>
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
            savedCurrent
              ? { label: `Save "${savedCurrent.name}"`, onSelect: () => saveNamed(savedCurrent) }
              : {
                  label: "Save current query…",
                  onSelect: () => setSaveForm({ name: tab.title === "Query" ? "" : tab.title, trigger: "" }),
                },
            ...(savedCurrent
              ? [
                  { label: "Save as new…", onSelect: () => setSaveForm({ name: "", trigger: "" }) },
                  {
                    label: `Versions (${savedCurrent.versions?.length ?? 0})…`,
                    onSelect: () => setVersionsOpen(true),
                  },
                ]
              : []),
            ...(savedQueries.length
              ? [
                  { separator: true, label: "" },
                  ...savedQueries.map((q) => ({
                    label: q.trigger ? `${q.name} · ${q.trigger}` : q.name,
                    onSelect: () => {
                      const bind = { title: q.name, savedId: q.id, filePath: undefined };
                      // `${1:x}` placeholders become Tab stops; anything else loads verbatim.
                      if (isSnippet(q.sql)) {
                        editor.current?.loadSnippet(snippetTemplate(q.sql));
                        updateTab(tab.id, bind);
                      } else updateTab(tab.id, { sql: q.sql, ...bind });
                    },
                  })),
                ]
              : []),
          ]}
        />
        <Dialog
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
          title={`Versions of "${savedCurrent?.name ?? ""}"`}
          description="Earlier edits, newest first. Restore puts a version in the editor; Saved › Save keeps it."
        >
          {savedCurrent?.versions?.length ? (
            <ul className="flex flex-col gap-2">
              {savedCurrent.versions.map((v, i) => (
                <li key={v.ts + i} className="rounded-md border border-border bg-sunken p-2">
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span>{new Date(v.ts).toLocaleString()}</span>
                    <span className="flex-1" />
                    <Button
                      size="sm"
                      onClick={() => {
                        updateTab(tab.id, { sql: v.sql });
                        setVersionsOpen(false);
                        toast("Version restored into the editor. Save to keep it.", "info");
                      }}
                    >
                      Restore
                    </Button>
                  </div>
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11px] selectable">
                    {v.sql}
                  </pre>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No earlier versions yet" hint="Versions are recorded each time you save this query." />
          )}
        </Dialog>
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
            onRun={() => runGuarded(editor.current?.getRunnable() ?? "")}
            onRunAll={() => runGuarded(editor.current?.getValue() ?? "", { all: true })}
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
        description={"Numbered placeholders like ${1:table} or ${2} become Tab stops when the query is loaded."}
        width="max-w-md"
        footer={
          <>
            <Button onClick={() => setSaveForm(null)}>Cancel</Button>
            <Button variant="primary" type="submit" form="save-query-form" disabled={saving || !saveForm?.name.trim()}>
              Save
            </Button>
          </>
        }
      >
        <form
          id="save-query-form"
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
            hint="Letters, digits, _ or $ only. Typing this word in the editor offers the query as a snippet."
          >
            <Input
              placeholder="e.g. topn"
              value={saveForm?.trigger ?? ""}
              onChange={(e) => setSaveForm((f) => f && { ...f, trigger: e.target.value.replace(/[^\w$]/g, "") })}
            />
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
