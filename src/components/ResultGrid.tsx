import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { clsx } from "clsx";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Maximize2,
  Minimize2,
  Search,
  X,
} from "lucide-react";
import type { Cell, Column, ForeignKeyInfo, QueryResult } from "../lib/types";
import { cellFull, cellPreview, cellText, isBytes, parseCell } from "../lib/format";
import { sortOrder } from "../lib/gridSort";
import { errMsg } from "../lib/api";
import { useStore } from "../lib/store";
import { ValueEditor, type ValueEditorHandle } from "./ValueEditor";
import { ContextMenu, Button } from "./ui";

export interface GridEdit {
  rowIndex: number;
  column: string;
  value: Cell;
}

interface Props {
  result: QueryResult;
  /** Enables cell editing; edited cells are reported via onEdit. */
  editable?: boolean;
  edits?: Map<string, Cell>; // key `${row}:${col}`
  deletedRows?: Set<number>;
  onEdit?: (e: GridEdit) => void;
  onDeleteRows?: (rows: number[]) => void;
  sort?: { column: string; desc: boolean } | null;
  onSort?: (column: string) => void;
  className?: string;
  primaryKeys?: string[];
  /** Foreign keys of the browsed table: cells in FK columns get a jump affordance. */
  foreignKeys?: ForeignKeyInfo[];
  /** Called with the FK and the referenced key (`ref_column -> value`) when the user follows a jump. */
  onFollowFk?: (fk: ForeignKeyInfo, key: Record<string, Cell>) => void;
}

const ROW_H = 26;
const MIN_W = 60;
const ROW_HEADER_W = 48;
/** The sticky header row (`h-7`). */
const HEADER_H = 28;

export function ResultGrid({
  result,
  editable,
  edits,
  deletedRows,
  onEdit,
  onDeleteRows,
  sort,
  onSort,
  className,
  primaryKeys = [],
  foreignKeys = [],
  onFollowFk,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; text: string } | null>(null);
  const [inspect, setInspect] = useState<{ r: number; c: number } | null>(null);
  // Draft text while the inspector panel is in edit mode; null = viewing.
  const [draft, setDraft] = useState<string | null>(null);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  // Text the draft started from; leaving the inspector only asks when the draft differs from it.
  const draftStart = useRef<string | null>(null);
  const toast = useStore((st) => st.toast);
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).catch((e) => toast(`Copy failed: ${errMsg(e)}`, "error"));
  /** Move or close the inspector, confirming first when an unsaved draft would be lost. */
  const openInspector = (cell: { r: number; c: number } | null) => {
    if (cell && inspect && cell.r === inspect.r && cell.c === inspect.c) return;
    // ponytail: native confirm(), same as the delete prompts elsewhere.
    if (draft !== null && draft !== draftStart.current && !confirm("Discard unsaved edit?")) return;
    setInspect(cell);
  };
  const valueEditor = useRef<ValueEditorHandle>(null);
  const [widths, setWidths] = useState<number[]>([]);
  const [clientSort, setClientSort] = useState<{ column: number; desc: boolean } | null>(null);
  const [menuCell, setMenuCell] = useState<{ r: number; c: number } | null>(null);
  const gridId = useMemo(() => `grid-${Math.random().toString(36).slice(2, 8)}`, []);

  const cols = result.columns;
  // ponytail: a column in several FKs follows the first one; add a chooser if that ever matters.
  const fkByCol = useMemo(() => {
    const m = new Map<string, ForeignKeyInfo>();
    for (const fk of foreignKeys) for (const c of fk.columns) if (!m.has(c)) m.set(c, fk);
    return m;
  }, [foreignKeys]);
  // Client-side sort only when the parent does not handle sorting.
  const order = useMemo(() => {
    if (!clientSort || onSort) return result.rows.map((_, i) => i);
    return sortOrder(result.rows, clientSort.column, clientSort.desc, cellText);
  }, [result.rows, clientSort, onSort]);

  useEffect(() => {
    // Measure widths from header + first 50 rows.
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) ctx.font = "12px ui-monospace, monospace";
    const measure = (s: string) => (ctx ? ctx.measureText(s).width : s.length * 7);
    setWidths(
      cols.map((c, ci) => {
        let w = measure(c.name) + measure(c.type_name.toLowerCase()) * 0.85 + 44;
        for (const row of result.rows.slice(0, 50)) w = Math.max(w, measure(cellPreview(row[ci]).slice(0, 80)) + 18);
        return Math.min(420, Math.max(MIN_W, Math.ceil(w)));
      }),
    );
    setSel(null);
    setAnchor(null);
    setInspect(null);
    setEditing(null);
  }, [cols, result.rows]);

  // The virtualizers measure the viewport with offsetWidth/Height, scrollbars included, and do not know about the
  // sticky header row and row-number column: tell them, so scrolling a cell into view lands it fully visible.
  // ponytail: read during render, so null on the first one and a frame stale after a resize that adds or removes a
  // scrollbar without re-rendering; measure in a ResizeObserver if a cell ever lands under a scrollbar.
  const el = parentRef.current;
  const scrollbarH = el ? el.offsetHeight - el.clientHeight : 0;
  const scrollbarW = el ? el.offsetWidth - el.clientWidth : 0;
  const rowVirtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    // Rows start below the header: item offsets include it, rendering subtracts it again.
    scrollMargin: HEADER_H,
    scrollPaddingStart: HEADER_H,
    scrollPaddingEnd: scrollbarH,
    overscan: 6,
  });

  // Columns are virtualised too: every visible row re-renders while scrolling, so a wide result must not mount
  // every one of its cells. Offsets start after the 48 px sticky row-number column.
  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: cols.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => widths[i] ?? MIN_W,
    paddingStart: ROW_HEADER_W,
    scrollPaddingStart: ROW_HEADER_W,
    scrollPaddingEnd: scrollbarW,
    overscan: 2,
  });
  // Before paint: cells already use the new widths, so the offsets must not lag a frame behind them.
  useLayoutEffect(() => colVirtualizer.measure(), [widths, colVirtualizer]);
  const vcols = colVirtualizer.getVirtualItems();
  // Width of the columns scrolled out on the left, kept as a spacer so the rendered ones sit at their offsets.
  const lead = vcols.length ? vcols[0].start - ROW_HEADER_W : 0;

  const totalW = widths.reduce((a, b) => a + b, 0) + ROW_HEADER_W;

  const startEdit = useCallback(
    (r: number, c: number) => {
      if (!editable) return;
      const rowIdx = order[r];
      const key = `${rowIdx}:${cols[c].name}`;
      const cur = edits?.has(key) ? edits.get(key)! : result.rows[rowIdx][c];
      // The cell may be scrolled out (and so not mounted): bring it in, or no input would appear to type into.
      rowVirtualizer.scrollToIndex(r);
      colVirtualizer.scrollToIndex(c);
      setEditing({ r, c, text: cellFull(cur) });
    },
    [editable, order, cols, edits, result.rows, rowVirtualizer, colVirtualizer],
  );

  const commitEdit = useCallback(
    (setNull = false) => {
      if (!editing) return;
      const rowIdx = order[editing.r];
      const col = cols[editing.c];
      const original = result.rows[rowIdx][editing.c];
      const value = setNull ? null : parseCell(editing.text, col.type_name, original);
      onEdit?.({ rowIndex: rowIdx, column: col.name, value });
      setEditing(null);
      parentRef.current?.focus();
    },
    [editing, order, cols, result.rows, onEdit],
  );

  // A cell scrolled out of the rendered window is unmounted, and WebKit fires no blur for it: commit the edit then,
  // as blur would, so the value reaches the pending changes and the grid keeps its keyboard. Only once the cell has
  // been on screen, so an edit started on a cell that is still being scrolled in is not committed straight away.
  const vrows = rowVirtualizer.getVirtualItems();
  const editSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!editing) {
      editSeen.current = null;
      return;
    }
    const id = `${editing.r}:${editing.c}`;
    const inView = vrows.some((v) => v.index === editing.r) && vcols.some((v) => v.index === editing.c);
    if (inView) editSeen.current = id;
    else if (editSeen.current === id) commitEdit();
  }, [editing, vrows, vcols, commitEdit]);

  const followFk = useCallback(
    (rowIdx: number, fk: ForeignKeyInfo) => {
      const row = result.rows[rowIdx];
      const key: Record<string, Cell> = {};
      for (const [i, c] of fk.columns.entries()) {
        const ci = cols.findIndex((x) => x.name === c);
        const ref = fk.ref_columns[i];
        if (!ref || ci < 0) return; // malformed FK metadata: nothing sensible to filter on
        const k = `${rowIdx}:${c}`;
        key[ref] = edits?.has(k) ? edits.get(k)! : (row[ci] ?? null);
      }
      onFollowFk?.(fk, key);
    },
    [result.rows, cols, edits, onFollowFk],
  );

  const copySelection = useCallback(
    (asJson = false) => {
      if (!sel) return;
      const r1 = Math.min(sel.r, anchor?.r ?? sel.r);
      const r2 = Math.max(sel.r, anchor?.r ?? sel.r);
      const c1 = Math.min(sel.c, anchor?.c ?? sel.c);
      const c2 = Math.max(sel.c, anchor?.c ?? sel.c);
      const withEdits = (ri: number) =>
        result.rows[ri].map((v, ci) =>
          edits?.has(`${ri}:${cols[ci].name}`) ? edits.get(`${ri}:${cols[ci].name}`)! : v,
        );
      const rows = order.slice(r1, r2 + 1).map(withEdits);
      let text: string;
      if (asJson) {
        text = JSON.stringify(
          rows.map((row) => Object.fromEntries(cols.slice(c1, c2 + 1).map((c, i) => [c.name, row[c1 + i]]))),
          null,
          2,
        );
      } else if (r1 === r2 && c1 === c2) {
        text = cellFull(rows[0][c1]);
      } else {
        text = rows
          .map((row) =>
            row
              .slice(c1, c2 + 1)
              .map(cellText)
              .join("\t"),
          )
          .join("\n");
      }
      void copy(text);
    },
    [sel, anchor, order, result.rows, cols, edits],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    if (!sel) return;
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      const r = Math.max(0, Math.min(order.length - 1, sel.r + dr));
      const c = Math.max(0, Math.min(cols.length - 1, sel.c + dc));
      setSel({ r, c });
      if (!e.shiftKey) setAnchor({ r, c });
      rowVirtualizer.scrollToIndex(r);
      colVirtualizer.scrollToIndex(c);
    };
    if (e.key === "ArrowDown") move(1, 0);
    else if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "ArrowLeft") move(0, -1);
    else if (e.key === "ArrowRight") move(0, 1);
    else if (e.key === "PageDown") move(20, 0);
    else if (e.key === "PageUp") move(-20, 0);
    else if (e.key === "Home") move(0, -cols.length);
    else if (e.key === "End") move(0, cols.length);
    else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit(sel.r, sel.c);
    } else if ((e.key === "c" || e.key === "C") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      copySelection(e.shiftKey);
    } else if (e.key === " ") {
      e.preventDefault();
      openInspector(sel);
    } else if ((e.key === "Delete" || e.key === "Backspace") && editable) {
      e.preventDefault();
      if (e.shiftKey) {
        const r1 = Math.min(sel.r, anchor?.r ?? sel.r);
        const r2 = Math.max(sel.r, anchor?.r ?? sel.r);
        onDeleteRows?.(order.slice(r1, r2 + 1));
      } else onEdit?.({ rowIndex: order[sel.r], column: cols[sel.c].name, value: null });
    } else if (editable && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Type-to-edit: same as startEdit, bring the cell in first so its input exists.
      rowVirtualizer.scrollToIndex(sel.r);
      colVirtualizer.scrollToIndex(sel.c);
      setEditing({ r: sel.r, c: sel.c, text: e.key });
      e.preventDefault();
    }
  };

  const inSelection = (r: number, c: number) => {
    if (!sel) return false;
    const a = anchor ?? sel;
    return (
      r >= Math.min(sel.r, a.r) && r <= Math.max(sel.r, a.r) && c >= Math.min(sel.c, a.c) && c <= Math.max(sel.c, a.c)
    );
  };

  const resizing = useRef<{ c: number; x: number; w: number } | null>(null);
  const onResizeStart = (c: number, e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = { c, x: e.clientX, w: widths[c] };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      // Read the ref now: the updater can run after mouseup has cleared it (fast drag-and-release crashed the tab).
      const { c: col, w: start, x } = resizing.current;
      const w = Math.max(MIN_W, start + ev.clientX - x);
      setWidths((ws) => ws.map((cw, i) => (i === col ? w : cw)));
    };
    const onUp = () => {
      resizing.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const headerSort = (ci: number) => {
    if (onSort) onSort(cols[ci].name);
    else
      setClientSort((s) =>
        s?.column === ci ? (s.desc ? null : { column: ci, desc: true }) : { column: ci, desc: false },
      );
  };
  const sortState = (ci: number): "asc" | "desc" | null => {
    if (onSort) return sort?.column === cols[ci].name ? (sort.desc ? "desc" : "asc") : null;
    return clientSort?.column === ci ? (clientSort.desc ? "desc" : "asc") : null;
  };

  const menuItems = (() => {
    if (!menuCell || menuCell.r >= order.length || menuCell.c >= cols.length)
      return [{ label: "No cell selected", disabled: true }];
    const rowIdx = order[menuCell.r];
    const row = result.rows[rowIdx];
    const c = cols[menuCell.c];
    const key = `${rowIdx}:${c.name}`;
    const v = edits?.has(key) ? edits.get(key)! : row[menuCell.c];
    const cellOf = (cc: Column, i: number) =>
      edits?.has(`${rowIdx}:${cc.name}`) ? edits.get(`${rowIdx}:${cc.name}`)! : row[i];
    return [
      { label: "Copy value", onSelect: () => void copy(cellFull(v)) },
      {
        label: "Copy row as JSON",
        onSelect: () =>
          void copy(JSON.stringify(Object.fromEntries(cols.map((cc, i) => [cc.name, cellOf(cc, i)])), null, 2)),
      },
      {
        label: "Copy row as TSV",
        onSelect: () => void copy(cols.map((cc, i) => cellText(cellOf(cc, i))).join("\t")),
      },
      { label: "View value", onSelect: () => openInspector(menuCell) },
      ...(onFollowFk && fkByCol.has(c.name) && v !== null
        ? [
            {
              label: `Open referenced row in ${fkByCol.get(c.name)!.ref_table}`,
              icon: <ArrowUpRight size={13} />,
              onSelect: () => followFk(rowIdx, fkByCol.get(c.name)!),
            },
          ]
        : []),
      ...(editable
        ? [
            { separator: true, label: "" },
            { label: "Edit cell", onSelect: () => startEdit(menuCell.r, menuCell.c) },
            { label: "Set NULL", onSelect: () => onEdit?.({ rowIndex: rowIdx, column: c.name, value: null }) },
            { label: "Delete row", danger: true, onSelect: () => onDeleteRows?.([rowIdx]) },
          ]
        : []),
    ];
  })();

  useEffect(() => {
    setDraft(null);
    setDraftErr(null);
  }, [inspect]);

  const inspectValue = (() => {
    if (!inspect || inspect.r >= order.length || inspect.c >= cols.length) return undefined;
    const key = `${order[inspect.r]}:${cols[inspect.c].name}`;
    return edits?.has(key) ? edits.get(key)! : result.rows[order[inspect.r]]?.[inspect.c];
  })();
  const inspectJson =
    !!inspect &&
    inspectValue !== undefined &&
    (/JSON/i.test(cols[inspect.c].type_name) ||
      (typeof inspectValue === "object" && inspectValue !== null && !isBytes(inspectValue)));

  const formatDraft = () => {
    if (draft === null) return;
    try {
      valueEditor.current?.setValue(JSON.stringify(JSON.parse(draft), null, 2));
    } catch (e) {
      setDraftErr(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const saveDraft = () => {
    if (!inspect || draft === null) return;
    if (inspectJson && draft.trim() !== "") {
      try {
        JSON.parse(draft);
      } catch (e) {
        setDraftErr(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    const rowIdx = order[inspect.r];
    const col = cols[inspect.c];
    onEdit?.({
      rowIndex: rowIdx,
      column: col.name,
      value: parseCell(draft, col.type_name, result.rows[rowIdx][inspect.c]),
    });
    setDraft(null);
  };

  return (
    <div className={clsx("relative flex h-full min-h-0", className)}>
      <ContextMenu items={menuItems}>
        <div
          ref={parentRef}
          className="flex-1 overflow-auto scroll bg-elev font-mono text-xs"
          tabIndex={0}
          role="grid"
          aria-rowcount={order.length}
          aria-colcount={cols.length + 1}
          aria-activedescendant={sel ? `${gridId}-${sel.r}-${sel.c}` : undefined}
          onFocus={() => {
            if (!sel && order.length && cols.length) {
              setSel({ r: 0, c: 0 });
              setAnchor({ r: 0, c: 0 });
            }
          }}
          onKeyDown={onKeyDown}
        >
          <div style={{ width: totalW, position: "relative" }}>
            {/* header */}
            <div className="sticky top-0 z-10 flex h-7 border-b border-border bg-sunken" role="row">
              <div
                className="sticky left-0 z-20 w-12 shrink-0 border-r border-border bg-sunken"
                role="columnheader"
                aria-label="Row number"
                aria-colindex={1}
              />
              {lead > 0 && <div className="shrink-0" style={{ width: lead }} aria-hidden />}
              {vcols.map(({ index: ci }) => {
                const c = cols[ci];
                const s = sortState(ci);
                return (
                  <div
                    key={ci}
                    role="columnheader"
                    aria-colindex={ci + 2}
                    aria-sort={s === "asc" ? "ascending" : s === "desc" ? "descending" : "none"}
                    style={{ width: widths[ci] }}
                    className="relative flex shrink-0 items-center gap-1 border-r border-border select-none hover:bg-hover"
                    title={`${c.name} · ${c.type_name}`}
                  >
                    <button
                      type="button"
                      onClick={() => headerSort(ci)}
                      aria-label={`Sort by ${c.name}`}
                      className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left"
                    >
                      <span className={clsx("truncate font-semibold", primaryKeys.includes(c.name) && "text-accent")}>
                        {c.name}
                      </span>
                      <span className="shrink-0 truncate text-[10px] font-normal text-faint">
                        {c.type_name.toLowerCase()}
                      </span>
                      {s && (
                        <span className="ml-auto text-accent">
                          {s === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                        </span>
                      )}
                    </button>
                    <div
                      onMouseDown={(e) => onResizeStart(ci, e)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-accent/50"
                      aria-hidden
                    />
                  </div>
                );
              })}
            </div>
            {/* rows */}
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const rowIdx = order[vi.index];
                const row = result.rows[rowIdx];
                const deleted = deletedRows?.has(rowIdx);
                return (
                  <div
                    key={vi.key}
                    role="row"
                    aria-rowindex={vi.index + 1}
                    className={clsx(
                      "absolute left-0 flex",
                      vi.index % 2 ? "bg-elev" : "bg-bg/40",
                      deleted && "line-through opacity-50",
                    )}
                    style={{ top: vi.start - HEADER_H, height: ROW_H, width: totalW }}
                  >
                    <div
                      className="sticky left-0 z-[5] flex w-12 shrink-0 items-center justify-end border-b border-r border-border bg-sunken px-1.5 text-[10px] text-faint tabular-nums"
                      role="rowheader"
                      aria-colindex={1}
                    >
                      {rowIdx + 1}
                    </div>
                    {lead > 0 && <div className="shrink-0" style={{ width: lead }} aria-hidden />}
                    {vcols.map(({ index: ci }) => {
                      const c = cols[ci];
                      const key = `${rowIdx}:${c.name}`;
                      const edited = edits?.has(key);
                      const v = edited ? edits!.get(key)! : row[ci];
                      const isEditing = editing && editing.r === vi.index && editing.c === ci;
                      const selected = inSelection(vi.index, ci);
                      const focused = sel?.r === vi.index && sel?.c === ci;
                      const fk = onFollowFk && v !== null && !isEditing ? fkByCol.get(c.name) : undefined;
                      return (
                        <div
                          key={ci}
                          role="gridcell"
                          aria-colindex={ci + 2}
                          id={`${gridId}-${vi.index}-${ci}`}
                          aria-selected={selected}
                          onContextMenu={() => {
                            setMenuCell({ r: vi.index, c: ci });
                            setSel({ r: vi.index, c: ci });
                            setAnchor({ r: vi.index, c: ci });
                          }}
                          style={{ width: widths[ci] }}
                          className={clsx(
                            "relative flex shrink-0 items-center overflow-hidden border-b border-r border-border px-2 whitespace-nowrap",
                            selected && "bg-[var(--selection)]",
                            focused && "outline outline-1 -outline-offset-1 outline-accent",
                            edited && "bg-warning/15",
                          )}
                          onMouseDown={(e) => {
                            setSel({ r: vi.index, c: ci });
                            if (!e.shiftKey) setAnchor({ r: vi.index, c: ci });
                            if (inspect) openInspector({ r: vi.index, c: ci });
                          }}
                          onDoubleClick={() =>
                            editable ? startEdit(vi.index, ci) : openInspector({ r: vi.index, c: ci })
                          }
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editing.text}
                              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                              onBlur={() => commitEdit()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitEdit();
                                else if (e.key === "Escape") {
                                  setEditing(null);
                                  parentRef.current?.focus();
                                } else if (e.key === "Tab") {
                                  e.preventDefault();
                                  commitEdit();
                                  const c2 = Math.max(0, Math.min(cols.length - 1, ci + (e.shiftKey ? -1 : 1)));
                                  setSel({ r: vi.index, c: c2 });
                                  setAnchor({ r: vi.index, c: c2 });
                                  colVirtualizer.scrollToIndex(c2);
                                }
                                e.stopPropagation();
                              }}
                              aria-label={`Edit ${c.name}`}
                              className="absolute inset-0 w-full bg-elev px-2 font-mono text-xs outline outline-2 -outline-offset-2 outline-accent selectable"
                            />
                          ) : v === null ? (
                            <span className="italic text-[var(--null)]">NULL</span>
                          ) : (
                            <span
                              className={clsx(
                                "truncate",
                                typeof v === "number" && "ml-auto tabular-nums",
                                typeof v === "boolean" && "text-accent",
                              )}
                            >
                              {cellPreview(v)}
                            </span>
                          )}
                          {fk && (
                            <button
                              type="button"
                              title={`Open referenced row in ${fk.ref_table}`}
                              aria-label={`Open referenced row in ${fk.ref_table}`}
                              className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded bg-elev/90 p-0.5 text-accent opacity-0 hover:bg-accent-soft focus-visible:opacity-100 [[role=gridcell]:hover_&]:opacity-100"
                              onMouseDown={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                followFk(rowIdx, fk);
                              }}
                            >
                              <ArrowUpRight size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            {order.length === 0 && <div className="p-6 text-center text-xs text-muted font-sans">No rows</div>}
          </div>
        </div>
      </ContextMenu>
      {inspect && inspectValue !== undefined && (
        <aside
          className={clsx(
            "flex shrink-0 flex-col border-l border-border bg-elev",
            maximized ? "absolute inset-0 z-10" : draft === null ? "w-80" : "w-[32rem]",
          )}
          aria-label="Cell inspector"
        >
          <div className="flex h-7 items-center gap-2 border-b border-border px-2 text-xs">
            <span className="font-semibold truncate">{cols[inspect.c].name}</span>
            <span className="text-faint">{cols[inspect.c].type_name}</span>
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => valueEditor.current?.search()}
              aria-label="Search value"
              title="Search (Ctrl+F)"
            >
              <Search size={13} />
            </Button>
            {inspectJson && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => valueEditor.current?.foldAll()}
                  aria-label="Fold all"
                  title="Fold all"
                >
                  <ChevronsDownUp size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => valueEditor.current?.unfoldAll()}
                  aria-label="Unfold all"
                  title="Unfold all"
                >
                  <ChevronsUpDown size={13} />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMaximized((m) => !m)}
              aria-label={maximized ? "Restore inspector" : "Maximize inspector"}
              title={maximized ? "Restore" : "Maximize"}
            >
              {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => openInspector(null)} aria-label="Close inspector">
              <X size={13} />
            </Button>
          </div>
          {draft === null ? (
            <ValueEditor
              key="view"
              ref={valueEditor}
              readOnly
              json={inspectJson}
              value={inspectValue === null ? "NULL" : cellFull(inspectValue)}
              ariaLabel="Cell value"
            />
          ) : (
            <ValueEditor
              key="edit"
              ref={valueEditor}
              json={inspectJson}
              value={draft}
              onChange={(t) => {
                setDraft(t);
                setDraftErr(null);
              }}
              onSubmit={saveDraft}
              onCancel={() => setDraft(null)}
              ariaLabel={`Edit ${cols[inspect.c].name}`}
            />
          )}
          {draftErr && <div className="border-t border-border px-2 py-1 text-xs text-danger">{draftErr}</div>}
          <div className="flex gap-1 border-t border-border p-1.5">
            {draft === null ? (
              <>
                <Button size="sm" onClick={() => void copy(cellFull(inspectValue))}>
                  Copy
                </Button>
                {editable && (
                  <Button
                    size="sm"
                    onClick={() => {
                      const start =
                        inspectValue === null
                          ? ""
                          : inspectJson
                            ? JSON.stringify(inspectValue, null, 2)
                            : cellFull(inspectValue);
                      draftStart.current = start;
                      setDraft(start);
                    }}
                  >
                    Edit
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button size="sm" onClick={saveDraft} title="Ctrl/Cmd+Enter">
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)} title="Escape">
                  Cancel
                </Button>
                {inspectJson && (
                  <Button size="sm" variant="ghost" onClick={formatDraft} title="Pretty-print the JSON">
                    Format
                  </Button>
                )}
                <span className="flex-1 self-center text-right text-[11px] text-faint">
                  Ctrl+F search · Ctrl+Enter save
                </span>
              </>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
