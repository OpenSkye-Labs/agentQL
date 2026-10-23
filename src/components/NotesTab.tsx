import { useMemo, useState } from "react";
import { BookText, Plus, Table2, Trash2 } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { noteRank, useNotes } from "../lib/notes";
import { useConnection, useStore, type Tab } from "../lib/store";
import type { Note } from "../lib/types";
import { NoteText } from "./NoteText";
import { Button, Empty, Field, Input, Spinner } from "./ui";

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
      const key = `${n.schema}.${n.table}`;
      by.set(key, [...(by.get(key) ?? []), n]);
    }
    return [...by.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, list]) => ({
        key,
        list: list.sort(
          (a, b) => noteRank(a) - noteRank(b) || (a.column ?? a.metric ?? "").localeCompare(b.column ?? b.metric ?? ""),
        ),
      }));
  }, [notes]);

  const save = (n: Note, text: string) => api.noteSave(tab.connectionId, { ...n, text });
  const remove = (n: Note) => save(n, "").catch((e) => toast(`Could not delete the note: ${errMsg(e)}`, "error"));

  if (!conn) return <Empty title="Connection not found" />;
  if (error) return <Empty title="Notes unavailable" hint={error} />;
  if (!notes)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
        <Spinner /> Loading notes…
      </div>
    );

  const tableOptions = Object.values(liveTables ?? {})
    .flat()
    .map((t) => `${t.schema}.${t.name}`);

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
          groups.map(({ key, list }) => (
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
                    tableKind: "table",
                  })
                }
              >
                <Table2 size={12} /> {key}
              </button>
              <ul className="divide-y divide-border rounded-md border border-border">
                {list.map((n) => {
                  const what = n.column ? n.column : n.metric ? `metric ${n.metric}` : "table";
                  return (
                    <li key={`${n.column ?? ""}|${n.metric ?? ""}`} className="group flex items-start gap-2 px-2 py-1">
                      <span className="w-40 shrink-0 truncate pt-0.5 font-mono text-muted" title={what}>
                        {what}
                      </span>
                      <div className="min-w-0 flex-1">
                        <NoteText
                          value={n.text}
                          label={`Note for ${key} ${what}`}
                          onSave={(text) => save(n, text)}
                          className={n.metric ? "font-mono" : undefined}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                        aria-label={`Delete note for ${key} ${what}`}
                        onClick={() => void remove(n)}
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

function MetricForm({
  tableOptions,
  onAdd,
  exists,
}: {
  tableOptions: string[];
  onAdd: (n: Note) => Promise<void>;
  exists: (n: Note) => boolean;
}) {
  const toast = useStore((s) => s.toast);
  const [table, setTable] = useState("");
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const [busy, setBusy] = useState(false);
  const dot = table.indexOf(".");
  const note: Note | null =
    dot > 0 && dot < table.length - 1 && name.trim() && definition.trim()
      ? {
          schema: table.slice(0, dot).trim(),
          table: table.slice(dot + 1).trim(),
          column: null,
          metric: name.trim(),
          text: definition.trim(),
        }
      : null;

  const submit = async () => {
    if (!note || busy) return;
    if (exists(note) && !confirm(`Replace the existing metric "${note.metric}" on ${table}?`)) return;
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
      <Field label="Table" hint={dot > 0 || !table ? undefined : "Write it as schema.table"}>
        <Input
          value={table}
          onChange={(e) => setTable(e.target.value)}
          list="notes-tables"
          placeholder="public.orders"
          className="font-mono"
        />
      </Field>
      <datalist id="notes-tables">
        {tableOptions.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <Field label="Metric name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="revenue" className="font-mono" />
      </Field>
      <Field label="Definition" className="col-span-2 md:col-span-1">
        <Input
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
          placeholder="SUM(total) WHERE status <> 'cancelled'"
          className="font-mono"
        />
      </Field>
      <Button type="submit" variant="primary" disabled={!note || busy}>
        <Plus size={12} /> Add metric
      </Button>
    </form>
  );
}
