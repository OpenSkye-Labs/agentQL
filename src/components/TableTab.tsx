import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, Filter, Plus, RefreshCw, Save, Trash2, Undo2, Copy, Bot } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useStore, useConnection, type Tab } from "../lib/store";
import type { Cell, ExportFormat, ForeignKeyInfo, QueryResult, RowChange, TableDetails } from "../lib/types";
import { fmtCount, fmtDuration } from "../lib/format";
import { keyFilter } from "../lib/sql";
import { ResultGrid, type GridEdit } from "./ResultGrid";
import { StructureView } from "./StructureView";
import { Button, Dialog, Input, Select, Spinner, Tooltip, Empty } from "./ui";
import { ExportMenu, useExport } from "./ExportMenu";

type TTab = Extract<Tab, { kind: "table" }>;
const PAGE_SIZES = [100, 250, 500, 1000];

export function TableTab({ tab }: { tab: TTab }) {
  const conn = useConnection(tab.connectionId);
  const toast = useStore((s) => s.toast);
  const openTab = useStore((s) => s.openTab);
  const updateTab = useStore((s) => s.updateTab);
  const askAssistant = useStore((s) => s.askAssistant);
  const [view, setView] = useState<"data" | "structure">("data");
  const [details, setDetails] = useState<TableDetails | null>(null);
  const [page, setPage] = useState<{ result: QueryResult; total: number | null; sql: string } | null>(null);
  // The filter lives on the tab so an FK jump can re-target an already open table.
  const filter = tab.filter ?? "";
  const setFilter = (f: string) => updateTab(tab.id, { filter: f });
  const [filterDraft, setFilterDraft] = useState(filter);
  const [sort, setSort] = useState<{ column: string; desc: boolean } | null>(null);
  const [limit, setLimit] = useState(250);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // pending edits
  const [edits, setEdits] = useState<Map<string, Cell>>(new Map());
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [inserts, setInserts] = useState<number>(0); // number of appended blank rows
  const [preview, setPreview] = useState<string[] | null>(null);
  const [applying, setApplying] = useState(false);
  const generation = useRef(0);

  const pks = useMemo(() => details?.columns.filter((c) => c.is_primary).map((c) => c.name) ?? [], [details]);
  const types = useMemo(() => Object.fromEntries(details?.columns.map((c) => [c.name, c.data_type]) ?? []), [details]);
  const editable = !!conn && !conn.read_only && pks.length > 0 && tab.tableKind === "table";

  const exporter = useExport();
  // The whole table with the filter and sort the grid shows (limit/offset are ignored by the export).
  const exportTable = (format: ExportFormat) => {
    if (!conn) return;
    const query = {
      schema: tab.schema,
      table: tab.table,
      filter: filter || null,
      order_by: sort?.column ?? null,
      order_desc: sort?.desc ?? false,
      limit: 0,
      offset: 0,
    };
    void exporter.run(tab.table, format, async (id, path) => ({
      rows: await api.exportTable(id, conn.id, query, path, format),
    }));
  };

  const load = useCallback(async () => {
    if (!conn) return;
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const q = {
        schema: tab.schema,
        table: tab.table,
        filter: filter || null,
        order_by: sort?.column ?? null,
        order_desc: sort?.desc ?? false,
        limit,
        offset,
      };
      const p = await api.fetchTable(conn.id, q);
      if (gen !== generation.current) return; // a newer request superseded this one
      setPage({ result: p.result, total: null, sql: p.sql_text });
      setEdits(new Map());
      setDeleted(new Set());
      setInserts(0);
      // Exact count arrives separately so large tables render without waiting for COUNT(*).
      void api
        .countTable(conn.id, q)
        .then((total) => {
          if (gen === generation.current) setPage((pg) => (pg ? { ...pg, total } : pg));
        })
        .catch(() => {});
    } catch (e) {
      if (gen !== generation.current) return;
      setError(errMsg(e));
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, [conn, tab.schema, tab.table, filter, sort, limit, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setFilterDraft(filter);
    setOffset(0);
  }, [filter]);

  useEffect(() => {
    if (!conn) return;
    api
      .tableDetails(conn.id, tab.schema, tab.table)
      .then(setDetails)
      .catch((e) => toast(errMsg(e), "error"));
  }, [conn, tab.schema, tab.table, toast]);

  // Grid data including appended blank rows for inserts.
  const gridResult = useMemo<QueryResult | null>(() => {
    if (!page) return null;
    if (!inserts) return page.result;
    const blank = page.result.columns.map(() => null);
    return { ...page.result, rows: [...page.result.rows, ...Array.from({ length: inserts }, () => [...blank])] };
  }, [page, inserts]);

  const changes = useMemo<RowChange[]>(() => {
    if (!page) return [];
    const base = page.result.rows.length;
    const byRow = new Map<number, Record<string, Cell>>();
    for (const [k, v] of edits) {
      const i = k.indexOf(":");
      const r = Number(k.slice(0, i));
      const col = k.slice(i + 1);
      if (deleted.has(r)) continue;
      byRow.set(r, { ...byRow.get(r), [col]: v });
    }
    const keyOf = (r: number) =>
      Object.fromEntries(
        pks.map((pk) => [pk, page.result.rows[r][page.result.columns.findIndex((c) => c.name === pk)]]),
      );
    const out: RowChange[] = [];
    for (const [r, values] of byRow) {
      if (r >= base) out.push({ op: "insert", values });
      else out.push({ op: "update", key: keyOf(r), values });
    }
    // Appended rows with no edits still insert (all defaults).
    for (let r = base; r < base + inserts; r++)
      if (!byRow.has(r) && !deleted.has(r)) out.push({ op: "insert", values: {} });
    for (const r of deleted) if (r < base) out.push({ op: "delete", key: keyOf(r) });
    return out;
  }, [edits, deleted, page, pks, inserts]);

  const onEdit = (e: GridEdit) => {
    setEdits((m) => {
      const n = new Map(m);
      const original = page?.result.rows[e.rowIndex]?.[page.result.columns.findIndex((c) => c.name === e.column)];
      if (e.rowIndex < (page?.result.rows.length ?? 0) && JSON.stringify(original) === JSON.stringify(e.value))
        n.delete(`${e.rowIndex}:${e.column}`);
      else n.set(`${e.rowIndex}:${e.column}`, e.value);
      return n;
    });
  };

  const discard = () => {
    setEdits(new Map());
    setDeleted(new Set());
    setInserts(0);
    setPreview(null);
  };

  // Production connections always go through the SQL preview so the user sees kind + table before anything runs.
  const production = conn?.environment === "production";
  const previewCount = preview?.length ?? 0;
  const previewNote = `These ${previewCount} statement${previewCount === 1 ? "" : "s"} run in one transaction and are rolled back together on error.`;
  const showPreview = async () => {
    if (!conn) return;
    try {
      setPreview(await api.previewChanges(conn.id, tab.schema, tab.table, changes, types));
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  // Publish dirtiness so FK jumps into this tab can ask before load() discards the edits.
  const dirty = changes.length > 0;
  useEffect(() => {
    if (!!tab.dirty !== dirty) updateTab(tab.id, { dirty });
  }, [dirty, tab.dirty, tab.id, updateTab]);

  const followFk = (fk: ForeignKeyInfo, key: Record<string, Cell>) => {
    if (!conn) return;
    const f = keyFilter(conn.driver, key);
    if (!f) return;
    const schema = fk.ref_schema ?? tab.schema;
    const st = useStore.getState();
    const target = st.tabs.find(
      (t) => t.kind === "table" && t.connectionId === conn.id && t.schema === schema && t.table === fk.ref_table,
    );
    if (target?.kind === "table" && target.dirty && !confirm(`Discard pending changes in ${fk.ref_table}?`)) return;
    const info = st.live[conn.id]?.tables[schema]?.find((t) => t.name === fk.ref_table);
    openTab({
      kind: "table",
      connectionId: conn.id,
      title: fk.ref_table,
      schema,
      table: fk.ref_table,
      tableKind: info?.kind ?? "table",
      filter: f,
    });
  };

  const apply = async () => {
    if (!conn) return;
    setApplying(true);
    try {
      const n = await api.applyChanges(conn.id, tab.schema, tab.table, changes, types);
      toast(`Applied ${changes.length} change(s), ${n} row(s) affected`, "success");
      setPreview(null);
      await load();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setApplying(false);
    }
  };

  const estimate = useStore(
    (s) => s.live[tab.connectionId]?.tables[tab.schema]?.find((t) => t.name === tab.table)?.row_estimate ?? null,
  );
  if (!conn) return <Empty title="Connection removed" />;
  const total = page?.total ?? null;
  const from = offset + 1;
  const to = offset + (page?.result.rows.length ?? 0);

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex h-9 items-center gap-1 border-b border-border bg-elev px-2"
        role="toolbar"
        aria-label="Table actions"
      >
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs" role="group" aria-label="View">
          {(["data", "structure"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={clsx(
                "rounded px-2.5 py-0.5 capitalize",
                view === v ? "bg-active" : "text-muted hover:text-fg",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        {view === "data" && (
          <>
            <form
              className="ml-2 flex flex-1 items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (dirty && !confirm(`Discard pending changes in ${tab.table}?`)) return;
                setOffset(0);
                setFilter(filterDraft.trim());
              }}
            >
              <Filter size={13} className="text-faint" />
              <Input
                value={filterDraft}
                onChange={(e) => setFilterDraft(e.target.value)}
                placeholder={`WHERE … e.g. ${pks[0] ?? "id"} > 100 AND status = 'active'`}
                className="h-7 font-mono text-xs max-w-xl"
                aria-label="Filter rows (WHERE clause)"
              />
              <Button size="sm" type="submit">
                Apply
              </Button>
              {filter && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (dirty && !confirm(`Discard pending changes in ${tab.table}?`)) return;
                    setFilter("");
                    setFilterDraft("");
                    setOffset(0);
                  }}
                >
                  Clear
                </Button>
              )}
            </form>
            <Tooltip label="Ask the assistant about this table">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Ask assistant"
                onClick={() => {
                  askAssistant(
                    `Tell me about the table ${tab.schema}.${tab.table}: what it stores, interesting columns, and a quick summary of the data.`,
                  );
                }}
              >
                <Bot size={13} />
              </Button>
            </Tooltip>
            <Tooltip label="Open as SQL query">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  page && openTab({ kind: "query", connectionId: conn.id, title: `${tab.table} query`, sql: page.sql })
                }
                aria-label="Open as query"
              >
                <Copy size={13} />
              </Button>
            </Tooltip>
            <Tooltip label="Reload">
              <Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Reload" disabled={loading}>
                {loading ? <Spinner /> : <RefreshCw size={13} />}
              </Button>
            </Tooltip>
            <ExportMenu exporter={exporter} disabled={!page} onPick={exportTable} />
            {editable && (
              <Tooltip label="Add row">
                <Button size="sm" variant="ghost" onClick={() => setInserts((n) => n + 1)} aria-label="Add row">
                  <Plus size={13} />
                </Button>
              </Tooltip>
            )}
          </>
        )}
      </div>

      {view === "data" ? (
        <>
          <div className="flex-1 min-h-0">
            {error ? (
              <div
                role="alert"
                className="m-3 rounded-md border border-danger/40 bg-danger-soft p-3 font-mono text-xs whitespace-pre-wrap selectable"
              >
                {error}
              </div>
            ) : gridResult ? (
              <ResultGrid
                result={gridResult}
                editable={editable}
                edits={edits}
                deletedRows={deleted}
                onEdit={onEdit}
                onDeleteRows={(rows) =>
                  setDeleted((d) => {
                    const n = new Set(d);
                    rows.forEach((r) => (n.has(r) ? n.delete(r) : n.add(r)));
                    return n;
                  })
                }
                sort={sort}
                onSort={(column) => {
                  setOffset(0);
                  setSort((s) =>
                    s?.column === column ? (s.desc ? null : { column, desc: true }) : { column, desc: false },
                  );
                }}
                primaryKeys={pks}
                foreignKeys={details?.foreign_keys}
                onFollowFk={followFk}
              />
            ) : (
              <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
                <Spinner /> Loading…
              </div>
            )}
          </div>
          {changes.length > 0 ? (
            <div
              className="flex h-9 items-center gap-2 border-t border-warning/40 bg-warning/10 px-3 text-xs"
              role="status"
            >
              <span className="font-medium">
                {changes.length} pending change{changes.length > 1 ? "s" : ""}
              </span>
              <span className="text-muted">Nothing is written until you apply; changes run in one transaction.</span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={discard}>
                <Undo2 size={12} /> Discard
              </Button>
              {!production && (
                <Button size="sm" onClick={showPreview}>
                  Preview SQL
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={production ? showPreview : apply} disabled={applying}>
                {applying ? <Spinner /> : <Save size={12} />} {production ? "Review & apply" : "Apply"}
              </Button>
            </div>
          ) : (
            <div
              className="flex h-7 items-center gap-3 border-t border-border bg-elev px-2 text-[11px] text-muted"
              role="status"
            >
              <span>
                {page
                  ? total != null
                    ? `${fmtCount(from)}–${fmtCount(to)} of ${fmtCount(total)}`
                    : estimate != null && !filter
                      ? `${fmtCount(from)}–${fmtCount(to)} of ~${fmtCount(estimate)}`
                      : `${fmtCount(from)}–${fmtCount(to)}`
                  : "…"}
                {filter && <span className="ml-1 text-accent">filtered</span>}
              </span>
              {page && <span>{fmtDuration(page.result.duration_ms)}</span>}
              {!editable && tab.tableKind === "table" && !conn.read_only && pks.length === 0 && details && (
                <span className="text-warning">no primary key — read-only grid</span>
              )}
              {conn.read_only && <span className="text-warning">read-only connection</span>}
              <span className="flex-1" />
              <Select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setOffset(0);
                }}
                className="h-5 text-[11px] py-0"
                aria-label="Rows per page"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </Select>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Previous page"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                <ChevronLeft size={13} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Next page"
                disabled={!page || page.result.rows.length < limit}
                onClick={() => setOffset(offset + limit)}
              >
                <ChevronRight size={13} />
              </Button>
            </div>
          )}
        </>
      ) : (
        <StructureView
          details={details}
          conn={conn}
          schema={tab.schema}
          table={tab.table}
          editable={!conn.read_only && tab.tableKind === "table"}
        />
      )}

      <Dialog
        open={preview !== null}
        onOpenChange={(o) => !o && setPreview(null)}
        title="Review changes"
        description={`${production ? `"${conn.name}" is tagged production. ` : ""}${previewNote}`}
        footer={
          <>
            <Button onClick={() => setPreview(null)}>Cancel</Button>
            <Button variant="primary" onClick={apply} disabled={applying}>
              {applying ? <Spinner /> : null} Apply {changes.length} change{changes.length > 1 ? "s" : ""}
            </Button>
          </>
        }
      >
        <pre className="max-h-80 overflow-auto scroll rounded-md border border-border bg-sunken p-3 font-mono text-xs whitespace-pre-wrap selectable">
          {preview?.join(";\n\n")}
          {preview?.length ? ";" : ""}
        </pre>
      </Dialog>
    </div>
  );
}

export { Trash2 };
