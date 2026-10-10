import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, Filter, Plus, RefreshCw, Save, Trash2, Undo2, Copy, Bot } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useStore, useConnection, type Tab } from "../lib/store";
import type { Cell, QueryResult, RowChange, TableDetails } from "../lib/types";
import { fmtCount, fmtDuration } from "../lib/format";
import { ResultGrid, type GridEdit } from "./ResultGrid";
import { Button, Dialog, Input, Select, Spinner, Tooltip, Empty } from "./ui";

type TTab = Extract<Tab, { kind: "table" }>;
const PAGE_SIZES = [100, 250, 500, 1000];

export function TableTab({ tab }: { tab: TTab }) {
  const conn = useConnection(tab.connectionId);
  const toast = useStore((s) => s.toast);
  const openTab = useStore((s) => s.openTab);
  const askAssistant = useStore((s) => s.askAssistant);
  const [view, setView] = useState<"data" | "structure">("data");
  const [details, setDetails] = useState<TableDetails | null>(null);
  const [page, setPage] = useState<{ result: QueryResult; total: number | null; sql: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [filterDraft, setFilterDraft] = useState("");
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

  const showPreview = async () => {
    if (!conn) return;
    try {
      setPreview(await api.previewChanges(conn.id, tab.schema, tab.table, changes, types));
    } catch (e) {
      toast(errMsg(e), "error");
    }
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
              <span className="text-muted">Nothing is written until you apply.</span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={discard}>
                <Undo2 size={12} /> Discard
              </Button>
              <Button size="sm" onClick={showPreview}>
                Preview SQL
              </Button>
              <Button size="sm" variant="primary" onClick={apply} disabled={applying}>
                {applying ? <Spinner /> : <Save size={12} />} Apply
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
        <Structure details={details} schema={tab.schema} table={tab.table} />
      )}

      <Dialog
        open={preview !== null}
        onOpenChange={(o) => !o && setPreview(null)}
        title="Review changes"
        description="These statements run in one transaction."
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

function Structure({ details, schema, table }: { details: TableDetails | null; schema: string; table: string }) {
  const toast = useStore((s) => s.toast);
  if (!details)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
        <Spinner /> Loading structure…
      </div>
    );
  return (
    <div className="flex-1 overflow-auto scroll p-4 text-xs selectable">
      <h2 className="mb-2 text-sm font-semibold">
        {schema}.{table}
      </h2>
      <table className="mb-6 w-full border-collapse">
        <thead>
          <tr className="text-left text-muted">
            <th className="border-b border-border py-1 pr-3 font-medium">#</th>
            <th className="border-b border-border py-1 pr-3 font-medium">Column</th>
            <th className="border-b border-border py-1 pr-3 font-medium">Type</th>
            <th className="border-b border-border py-1 pr-3 font-medium">Nullable</th>
            <th className="border-b border-border py-1 pr-3 font-medium">Default</th>
            <th className="border-b border-border py-1 pr-3 font-medium">Extra / comment</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {details.columns.map((c) => (
            <tr key={c.name} className="hover:bg-hover">
              <td className="border-b border-border py-1 pr-3 text-faint">{c.position}</td>
              <td className={clsx("border-b border-border py-1 pr-3", c.is_primary && "font-semibold text-accent")}>
                {c.name}
                {c.is_primary && <span className="ml-1 text-[10px]">PK</span>}
              </td>
              <td className="border-b border-border py-1 pr-3">{c.data_type}</td>
              <td className="border-b border-border py-1 pr-3 text-muted">{c.nullable ? "yes" : "no"}</td>
              <td className="border-b border-border py-1 pr-3 text-muted">{c.default ?? ""}</td>
              <td className="border-b border-border py-1 pr-3 text-muted font-sans">
                {[c.extra, c.comment].filter(Boolean).join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-6 md:grid-cols-2 mb-6">
        <div>
          <h3 className="mb-1 font-semibold">Indexes ({details.indexes.length})</h3>
          {details.indexes.length === 0 && <p className="text-muted">None</p>}
          <ul className="space-y-1 font-mono">
            {details.indexes.map((i) => (
              <li key={i.name} className="rounded border border-border bg-elev px-2 py-1">
                <span className={clsx(i.primary && "text-accent")}>{i.name}</span>{" "}
                <span className="text-muted">({i.columns.join(", ")})</span>
                {i.unique && <span className="ml-1 rounded bg-accent-soft px-1 text-[10px]">unique</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 font-semibold">Foreign keys ({details.foreign_keys.length})</h3>
          {details.foreign_keys.length === 0 && <p className="text-muted">None</p>}
          <ul className="space-y-1 font-mono">
            {details.foreign_keys.map((f) => (
              <li key={f.name} className="rounded border border-border bg-elev px-2 py-1">
                {f.name}: ({f.columns.join(", ")}) → {f.ref_schema ? `${f.ref_schema}.` : ""}
                {f.ref_table}({f.ref_columns.join(", ")})
              </li>
            ))}
          </ul>
        </div>
      </div>
      {details.ddl && (
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h3 className="font-semibold">DDL</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(details.ddl!);
                toast("DDL copied", "success");
              }}
            >
              <Copy size={12} /> Copy
            </Button>
          </div>
          <pre className="overflow-auto scroll rounded-md border border-border bg-sunken p-3 font-mono whitespace-pre-wrap">
            {details.ddl}
          </pre>
        </div>
      )}
    </div>
  );
}

export { Trash2 };
