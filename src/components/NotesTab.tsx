import { useMemo, useState } from "react";
import { BookText, Plus, Table2, Trash2 } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { noteRank, useNotes } from "../lib/notes";
import { useConnection, useStore, type Tab } from "../lib/store";
import type { Note, TableInfo } from "../lib/types";
import { NoteText } from "./NoteText";
import { Button, Empty, Field, Input, Select, Spinner } from "./ui";

/** Every data-dictionary note of a connection, grouped by table, plus the place to define named metrics. */
export function NotesTab({ tab }: { tab: Extract<Tab, { kind: "notes" }> }) {
  const conn = useConnection(tab.connectionId);
  const toast = useStore((s) => s.toast);
  const openTab = useStore((s) => s.openTab);
  const liveTables = useStore((s) => s.live[tab.connectionId]?.tables);
  const { notes, error } = useNotes(tab.connectionId);

  const groups = useMemo(() => {
    const by = new Map<string, Note[]>();
    for (const n of notes ?? []) {
      // NUL-separated so a dot inside a schema or table name cannot merge two tables.
      const key = `${n.schema}\u0000${n.table}`;
      by.set(key, [...(by.get(key) ?? []), n]);
    }
    return [...by.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, list]) => ({
        key,
        label: `${list[0].schema}.${list[0].table}`,
        list: list.sort(
          (a, b) => noteRank(a) - noteRank(b) || (a.column ?? a.metric ?? "").localeCompare(b.column ?? b.metric ?? ""),
        ),
      }));
  }, [notes]);

  const save = (n: Note, text: string) => api.noteSave(tab.connectionId, { ...n, text });
  const remove = (n: Note, what: string) => {
    if (!confirm(`Delete the note for ${what}?`)) return;
    save(n, "").catch((e) => toast(`Could not delete the note: ${errMsg(e)}`, "error"));
  };

  if (!conn) return <Empty title="Connection not found" />;
  if (error) return <Empty title="Notes unavailable" hint={error} />;
  if (!notes)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
        <Spinner /> Loading notes…
      </div>
    );

  // ponytail: only tables of schemas already loaded in the sidebar; expand a schema there to pick from it.
  const tableOptions = Object.values(liveTables ?? {}).flat();

  return (
    <div className="flex-1 overflow-auto scroll p-4 text-xs selectable">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-sm font-semibold">Data dictionary · {conn.name}</h2>
        <p className="mb-4 text-muted">
          What tables, columns and metrics mean. The assistant reads these before it writes SQL. They are stored in
          AgentQL, never in the database.
        </p>
        <MetricForm
          tableOptions={tableOptions}
          onAdd={(n) => api.noteSave(tab.connectionId, n)}
          exists={(n) =>
            (notes ?? []).some((x) => x.schema === n.schema && x.table === n.table && x.metric === n.metric)
          }
        />
        {groups.length === 0 ? (
          <Empty
            icon={<BookText size={22} />}
            title="No notes yet"
            hint="Describe tables and columns in a table's Structure tab, add a metric above, or ask the assistant to draft notes for you."
          />
        ) : (
          groups.map(({ key, label, list }) => (
            <section key={key} className="mb-4">
              <button
                type="button"
                className="mb-1 flex items-center gap-1 font-mono font-semibold hover:text-accent"
                onClick={() =>
                  openTab({
                    kind: "table",
                    connectionId: tab.connectionId,
                    title: list[0].table,
                    schema: list[0].schema,
                    table: list[0].table,
                    tableKind:
                      tableOptions.find((t) => t.schema === list[0].schema && t.name === list[0].table)?.kind ??
                      "table",
                  })
                }
              >
                <Table2 size={12} /> {label}
              </button>
              <ul className="divide-y divide-border rounded-md border border-border">
                {list.map((n) => {
                  const what = n.column ? n.column : n.metric ? `metric ${n.metric}` : "table";
                  return (
                    <li key={`${n.column ?? ""}|${n.metric ?? ""}`} className="group flex items-center gap-2 px-2 py-1">
                      <span className="w-48 shrink-0 truncate font-mono text-muted" title={what}>
                        {what}
                      </span>
                      <div className="min-w-0 flex-1">
                        <NoteText
                          value={n.text}
                          label={`Note for ${label} ${what}`}
                          onSave={(text) => save(n, text)}
                          className={n.metric ? "font-mono" : undefined}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                        aria-label={`Delete note for ${label} ${what}`}
                        onClick={() => remove(n, `${label} ${what}`)}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

const tableKey = (t: TableInfo) => `${t.schema}\u0000${t.name}`;

function MetricForm({
  tableOptions,
  onAdd,
  exists,
}: {
  tableOptions: TableInfo[];
  onAdd: (n: Note) => Promise<void>;
  exists: (n: Note) => boolean;
}) {
  const toast = useStore((s) => s.toast);
  // NUL-joined schema/table, not a list index: it follows the table when a sidebar refresh reorders the list,
  // and a dot in either name is harmless.
  const [picked, setPicked] = useState("");
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const [busy, setBusy] = useState(false);
  const target = tableOptions.find((t) => tableKey(t) === picked);
  const note: Note | null =
    target && name.trim() && definition.trim()
      ? { schema: target.schema, table: target.name, column: null, metric: name.trim(), text: definition.trim() }
      : null;

  const submit = async () => {
    if (!note || busy) return;
    if (exists(note) && !confirm(`Replace the existing metric "${note.metric}" on ${note.schema}.${note.table}?`))
      return;
    setBusy(true);
    try {
      await onAdd(note);
      toast(`Metric "${note.metric}" saved`, "success");
      setName("");
      setDefinition("");
    } catch (e) {
      toast(`Could not save the metric: ${errMsg(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mb-6 grid grid-cols-[1fr_1fr] gap-2 rounded-md border border-border bg-elev p-3 md:grid-cols-[12rem_10rem_1fr_auto] md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Table" hint={tableOptions.length ? undefined : "Connect and expand a schema in the sidebar"}>
        <Select value={picked} onChange={(e) => setPicked(e.target.value)} className="font-mono">
          <option value="">Pick a table…</option>
          {tableOptions.map((t) => (
            <option key={tableKey(t)} value={tableKey(t)}>
              {t.schema}.{t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Metric name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="revenue"
          maxLength={64}
          className="font-mono"
        />
      </Field>
      <Field label="Definition" className="col-span-2 md:col-span-1">
        <Input
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
          placeholder="SUM(total) WHERE status <> 'cancelled'"
          maxLength={2000}
          className="font-mono"
        />
      </Field>
      <Button type="submit" variant="primary" disabled={!note || busy}>
        <Plus size={12} /> Add metric
      </Button>
    </form>
  );
}
