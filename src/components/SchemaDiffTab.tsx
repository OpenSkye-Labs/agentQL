import { useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { ArrowRight, Copy, GitCompare } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useStore, type Tab } from "../lib/store";
import { isSql } from "../lib/types";
import { diffLines, formatDiff } from "../lib/diff";
import { compareSchemas, migrationSql, type ObjectDiff } from "../lib/schemaDiff";
import { Button, Empty, Select, Spinner } from "./ui";

type DTab = Extract<Tab, { kind: "diff" }>;
type Side = { conn: string; schema: string };

const STATUS_CLS: Record<ObjectDiff["status"], string> = {
  added: "text-success",
  removed: "text-danger",
  changed: "text-warning",
  same: "text-faint",
};
const STATUS_MARK: Record<ObjectDiff["status"], string> = { added: "+", removed: "−", changed: "~", same: "=" };

export function SchemaDiffTab({ tab }: { tab: DTab }) {
  const connections = useStore((s) => s.connections);
  const live = useStore((s) => s.live);
  const toast = useStore((s) => s.toast);
  const sqlConns = connections.filter((c) => isSql(c.driver) && live[c.id] && !live[c.id].loading);
  const [a, setA] = useState<Side>({ conn: tab.connectionId, schema: tab.schema ?? "" });
  const [b, setB] = useState<Side>({ conn: tab.connectionId, schema: "" });
  const [result, setResult] = useState<{ diffs: ObjectDiff[]; a: Side; b: Side; driver: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(true);
  const generation = useRef(0);

  const schemasOf = (id: string) => live[id]?.schemas ?? [];
  const ready = a.conn && a.schema && b.conn && b.schema && !(a.conn === b.conn && a.schema === b.schema);

  const compare = async () => {
    if (!ready) return;
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const [l, r] = await Promise.all([api.schemaObjects(a.conn, a.schema), api.schemaObjects(b.conn, b.schema)]);
      if (gen !== generation.current) return;
      const diffs = compareSchemas(l, r);
      // The migration runs on A (source), so it is written for A's schema and dialect.
      const driver = connections.find((c) => c.id === a.conn)?.driver ?? "postgres";
      setResult({ diffs, a, b, driver });
      setSelected(diffs.find((d) => d.status !== "same")?.name ?? diffs[0]?.name ?? null);
    } catch (e) {
      if (gen === generation.current) setError(errMsg(e));
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  };

  const visible = useMemo(
    () => result?.diffs.filter((d) => !onlyChanges || d.status !== "same") ?? [],
    [result, onlyChanges],
  );
  const current = result?.diffs.find((d) => d.name === selected) ?? null;
  const lines = useMemo(() => (current ? diffLines(current.leftDdl, current.rightDdl) : []), [current]);
  const counts = useMemo(() => {
    const c = { added: 0, removed: 0, changed: 0, same: 0 };
    for (const d of result?.diffs ?? []) c[d.status]++;
    return c;
  }, [result]);

  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text);
    toast(`${what} copied`, "success");
  };

  const sidePicker = (label: string, side: Side, set: (s: Side) => void) => (
    <div className="flex items-center gap-1">
      <span className="text-muted">{label}</span>
      <Select
        value={side.conn}
        onChange={(e) => set({ conn: e.target.value, schema: schemasOf(e.target.value)[0] ?? "" })}
        className="h-7 max-w-48 text-xs"
        aria-label={`${label} connection`}
      >
        {!sqlConns.some((c) => c.id === side.conn) && <option value="">connection…</option>}
        {sqlConns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select
        value={side.schema}
        onChange={(e) => set({ ...side, schema: e.target.value })}
        className="h-7 max-w-40 text-xs"
        aria-label={`${label} schema`}
      >
        {!side.schema && <option value="">schema…</option>}
        {schemasOf(side.conn).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex min-h-9 flex-wrap items-center gap-2 border-b border-border bg-elev px-2 py-1 text-xs"
        role="toolbar"
        aria-label="Schema diff"
      >
        {sidePicker("A", a, setA)}
        <ArrowRight size={13} className="text-faint" />
        {sidePicker("B", b, setB)}
        <Button size="sm" variant="primary" onClick={() => void compare()} disabled={!ready || loading}>
          {loading ? <Spinner /> : <GitCompare size={13} />} Compare
        </Button>
        <span className="flex-1" />
        {result && (
          <>
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
              only changes
            </label>
            <Button
              size="sm"
              onClick={() => copy(migrationSql(result.driver, result.a.schema, result.diffs), "Migration")}
              disabled={counts.added + counts.removed + counts.changed === 0}
            >
              <Copy size={12} /> Copy as migration
            </Button>
          </>
        )}
      </div>
      {error ? (
        <div
          role="alert"
          className="m-3 rounded-md border border-danger/40 bg-danger-soft p-3 font-mono text-xs whitespace-pre-wrap selectable"
        >
          {error}
        </div>
      ) : !result ? (
        <Empty
          icon={<GitCompare size={28} />}
          title="Compare two schemas"
          hint={
            sqlConns.length
              ? "Pick a source (A) and a target (B) among the connected databases, then Compare. The migration moves A towards B."
              : "Connect to at least one SQL database first."
          }
        />
      ) : (
        <div className="flex flex-1 min-h-0">
          <ul
            className="w-64 shrink-0 overflow-auto scroll border-r border-border bg-sunken py-1 font-mono text-xs"
            aria-label="Objects"
          >
            {visible.length === 0 && <li className="px-3 py-2 text-muted font-sans">No differences</li>}
            {visible.map((d) => (
              <li key={d.name}>
                <button
                  type="button"
                  onClick={() => setSelected(d.name)}
                  aria-current={d.name === selected ? "true" : undefined}
                  className={clsx(
                    "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-hover",
                    d.name === selected && "bg-active",
                  )}
                >
                  <span className={clsx("w-3 text-center font-bold", STATUS_CLS[d.status])}>
                    {STATUS_MARK[d.status]}
                  </span>
                  <span className="truncate flex-1">{d.name}</span>
                  {d.kind !== "table" && <span className="text-[10px] text-faint">{d.kind}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-1 min-w-0 flex-col">
            {current ? (
              <>
                <div className="flex h-7 items-center gap-2 border-b border-border px-3 text-xs">
                  <span className={clsx("font-semibold", STATUS_CLS[current.status])}>{current.status}</span>
                  <span className="font-mono">{current.name}</span>
                  <span className="flex-1" />
                  <Button size="sm" variant="ghost" onClick={() => copy(formatDiff(lines), "Diff")}>
                    <Copy size={12} /> Copy diff
                  </Button>
                </div>
                <pre
                  className="flex-1 overflow-auto scroll bg-elev p-0 font-mono text-xs selectable"
                  aria-label="DDL diff"
                >
                  {lines.map((l, i) => (
                    <div
                      key={i}
                      className={clsx(
                        "px-3 whitespace-pre",
                        l.kind === "add" && "bg-success/15 text-success",
                        l.kind === "del" && "bg-danger/15 text-danger",
                      )}
                    >
                      <span className="inline-block w-4 select-none text-faint">
                        {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
                      </span>
                      {l.text}
                    </div>
                  ))}
                </pre>
              </>
            ) : (
              <Empty title="Select an object" />
            )}
          </div>
        </div>
      )}
      {result && (
        <div
          className="flex h-7 items-center gap-3 border-t border-border bg-elev px-3 text-[11px] text-muted"
          role="status"
        >
          <span className="text-success">{counts.added} added</span>
          <span className="text-danger">{counts.removed} removed</span>
          <span className="text-warning">{counts.changed} changed</span>
          <span>{counts.same} unchanged</span>
          <span className="flex-1" />
          <span>
            A = {connections.find((c) => c.id === result.a.conn)?.name}.{result.a.schema} · B ={" "}
            {connections.find((c) => c.id === result.b.conn)?.name}.{result.b.schema}
          </span>
        </div>
      )}
    </div>
  );
}
