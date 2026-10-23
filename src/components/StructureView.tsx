import { useState } from "react";
import { clsx } from "clsx";
import { Copy, KeyRound, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useNotes } from "../lib/notes";
import { useStore } from "../lib/store";
import type { ColumnInfo, ConnectionConfig, TableDetails } from "../lib/types";
import {
  addColumnSql,
  addIndexSql,
  alterColumnSql,
  dropColumnSql,
  dropForeignKeySql,
  dropIndexSql,
  dropTableSql,
  qualifiedName,
  renameTableSql,
  type ColumnDraft,
} from "../lib/ddl";
import { NoteText } from "./NoteText";
import { Button, ContextMenu, Dialog, Field, Input, Menu, Spinner, Switch } from "./ui";

type ColumnDialog = { mode: "add" } | { mode: "edit"; col: ColumnInfo };

/**
 * Structure tab. Every edit generates DDL and opens it in a query tab: the user reviews and runs it there,
 * the same "edit becomes SQL" path the data grid uses, so nothing here touches the database.
 * Descriptions are data-dictionary notes stored in AgentQL, editable on read-only connections and views too.
 */
export function StructureView({
  details,
  conn,
  schema,
  table,
  editable,
}: {
  details: TableDetails | null;
  conn: ConnectionConfig;
  schema: string;
  table: string;
  /** False for read-only connections and views: the tab is then the old read-only listing. */
  editable: boolean;
}) {
  const toast = useStore((s) => s.toast);
  const openTab = useStore((s) => s.openTab);
  const [colDialog, setColDialog] = useState<ColumnDialog | null>(null);
  const [indexDialog, setIndexDialog] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const { notes, error: notesError } = useNotes(conn.id);
  const mine = (notes ?? []).filter((n) => n.schema === schema && n.table === table);
  const tableNote = mine.find((n) => !n.column && !n.metric)?.text ?? "";
  const columnNote = (col: string) => mine.find((n) => n.column === col)?.text ?? "";
  const saveNote = (column: string | null, text: string) =>
    api.noteSave(conn.id, { schema, table, column, metric: null, text });

  const driver = conn.driver;
  const qualified = qualifiedName(driver, schema, table);
  const openSql = (sql: string) => {
    if (!sql) return;
    openTab({ kind: "query", connectionId: conn.id, title: `ALTER ${table}`, sql: `${sql}\n` });
    toast("Review the statement, then run it", "info");
  };

  if (!details)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
        <Spinner /> Loading structure…
      </div>
    );

  const columnMenu = (c: ColumnInfo) => [
    { label: "Edit column…", icon: <Pencil size={13} />, onSelect: () => setColDialog({ mode: "edit", col: c }) },
    {
      label: "Drop column…",
      icon: <Trash2 size={13} />,
      danger: true,
      onSelect: () => openSql(dropColumnSql(driver, qualified, c.name)),
    },
  ];

  return (
    <div className="flex-1 overflow-auto scroll p-4 text-xs selectable">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">
          {schema}.{table}
        </h2>
        {editable && (
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" onClick={() => setColDialog({ mode: "add" })}>
              <Plus size={12} /> Column
            </Button>
            <Button size="sm" onClick={() => setIndexDialog(true)}>
              <Plus size={12} /> Index
            </Button>
            <Menu
              trigger={
                <Button size="sm" variant="ghost" aria-label="Table actions">
                  <MoreHorizontal size={13} />
                </Button>
              }
              items={[
                { label: "Rename table…", icon: <Pencil size={13} />, onSelect: () => setRename(table) },
                { separator: true, label: "" },
                {
                  label: "Drop table…",
                  icon: <Trash2 size={13} />,
                  danger: true,
                  onSelect: () => openSql(dropTableSql(qualified)),
                },
              ]}
            />
          </div>
        )}
      </div>
      <div className="mb-3 -ml-1 max-w-2xl">
        {notesError ? (
          <p className="ml-1 text-danger">Notes unavailable: {notesError}</p>
        ) : (
          <NoteText
            value={tableNote}
            label={`Description of ${table}`}
            placeholder="Add a table description the assistant reads"
            onSave={(text) => saveNote(null, text)}
          />
        )}
      </div>
      <table className="mb-6 w-full border-collapse">
        <thead>
          <tr className="text-left text-muted">
            <th className="border-b border-border py-1 pr-3 font-medium">#</th>
            <th className="border-b border-border py-1 pr-3 font-medium">Column</th>
            <th className="border-b border-border py-1 pr-3 font-medium">Type</th>
            <th className="border-b border-border py-1 pr-3 font-medium">Nullable</th>
            <th className="border-b border-border py-1 pr-3 font-medium">Default</th>
            <th className="border-b border-border py-1 pr-3 font-medium">Extra / comment</th>
            <th className="border-b border-border py-1 pr-3 font-medium">Description</th>
            {editable && <th className="border-b border-border py-1 w-8" />}
          </tr>
        </thead>
        <tbody className="font-mono">
          {details.columns.map((c) => {
            const row = (
              <tr key={c.name} className="group hover:bg-hover">
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
                <td className="border-b border-border py-0.5 pr-3 min-w-48">
                  {!notesError && (
                    <NoteText
                      value={columnNote(c.name)}
                      label={`Description of ${c.name}`}
                      placeholder="Add"
                      className={
                        columnNote(c.name) ? undefined : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      }
                      onSave={(text) => saveNote(c.name, text)}
                    />
                  )}
                </td>
                {editable && (
                  <td className="border-b border-border py-0.5 text-right">
                    <Menu
                      trigger={
                        <Button
                          size="sm"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
                          aria-label={`Actions for ${c.name}`}
                        >
                          <MoreHorizontal size={13} />
                        </Button>
                      }
                      items={columnMenu(c)}
                    />
                  </td>
                )}
              </tr>
            );
            return editable ? (
              <ContextMenu key={c.name} items={columnMenu(c)}>
                {row}
              </ContextMenu>
            ) : (
              row
            );
          })}
        </tbody>
      </table>
      <div className="grid gap-6 md:grid-cols-2 mb-6">
        <div>
          <h3 className="mb-1 font-semibold">Indexes ({details.indexes.length})</h3>
          {details.indexes.length === 0 && <p className="text-muted">None</p>}
          <ul className="space-y-1 font-mono">
            {details.indexes.map((i) => (
              <li key={i.name} className="group flex items-center gap-1 rounded border border-border bg-elev px-2 py-1">
                <span className="flex-1 truncate">
                  <span className={clsx(i.primary && "text-accent")}>{i.name}</span>{" "}
                  <span className="text-muted">({i.columns.join(", ")})</span>
                  {i.unique && <span className="ml-1 rounded bg-accent-soft px-1 text-[10px]">unique</span>}
                </span>
                {editable && !i.primary && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                    aria-label={`Drop index ${i.name}`}
                    onClick={() => openSql(dropIndexSql(driver, schema, qualified, i))}
                  >
                    <Trash2 size={12} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 font-semibold">Foreign keys ({details.foreign_keys.length})</h3>
          {details.foreign_keys.length === 0 && <p className="text-muted">None</p>}
          <ul className="space-y-1 font-mono">
            {details.foreign_keys.map((f) => (
              <li key={f.name} className="group flex items-center gap-1 rounded border border-border bg-elev px-2 py-1">
                <span className="flex-1 truncate">
                  {f.name}: ({f.columns.join(", ")}) → {f.ref_schema ? `${f.ref_schema}.` : ""}
                  {f.ref_table}({f.ref_columns.join(", ")})
                </span>
                {editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                    aria-label={`Drop foreign key ${f.name}`}
                    onClick={() => openSql(dropForeignKeySql(driver, qualified, f.name))}
                  >
                    <Trash2 size={12} />
                  </Button>
                )}
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
                navigator.clipboard.writeText(details.ddl!).then(
                  () => toast("DDL copied", "success"),
                  () => toast("Could not copy", "error"),
                );
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

      {colDialog && (
        <ColumnDialog
          driver={driver}
          dialog={colDialog}
          onClose={() => setColDialog(null)}
          onSubmit={(draft) => {
            setColDialog(null);
            openSql(
              colDialog.mode === "add"
                ? addColumnSql(driver, qualified, draft)
                : alterColumnSql(driver, qualified, colDialog.col, draft),
            );
          }}
        />
      )}
      {indexDialog && (
        <IndexDialog
          table={table}
          columns={details.columns.map((c) => c.name)}
          onClose={() => setIndexDialog(false)}
          onSubmit={(idx) => {
            setIndexDialog(false);
            openSql(addIndexSql(driver, schema, table, idx));
          }}
        />
      )}
      <Dialog
        open={rename !== null}
        onOpenChange={(o) => !o && setRename(null)}
        title="Rename table"
        width="max-w-sm"
        footer={
          <>
            <Button onClick={() => setRename(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!rename?.trim() || rename.trim() === table}
              onClick={() => {
                const name = rename!.trim();
                setRename(null);
                openSql(renameTableSql(driver, schema, qualified, name));
              }}
            >
              Generate SQL
            </Button>
          </>
        }
      >
        <Field label="New name">
          <Input autoFocus value={rename ?? ""} onChange={(e) => setRename(e.target.value)} className="font-mono" />
        </Field>
      </Dialog>
    </div>
  );
}

const DEFAULT_HINT: Record<string, string> = {
  mysql:
    "Plain text is quoted for you; numbers, NULL, CURRENT_TIMESTAMP and anything in parentheses, e.g. (uuid()), stay expressions.",
};

function ColumnDialog({
  driver,
  dialog,
  onClose,
  onSubmit,
}: {
  driver: string;
  dialog: ColumnDialog;
  onClose: () => void;
  onSubmit: (draft: ColumnDraft) => void;
}) {
  const before = dialog.mode === "edit" ? dialog.col : null;
  const [name, setName] = useState(before?.name ?? "");
  const [type, setType] = useState(before?.data_type ?? "");
  const [nullable, setNullable] = useState(before?.nullable ?? true);
  // null = no default; the string is kept verbatim so an empty or padded MySQL default survives a rename.
  const [def, setDef] = useState<string | null>(before?.default ?? null);
  const draft: ColumnDraft = { name: name.trim(), data_type: type.trim(), nullable, default: def };
  const unchanged =
    !!before &&
    before.name === draft.name &&
    before.data_type === draft.data_type &&
    before.nullable === draft.nullable &&
    (before.default ?? null) === draft.default;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={before ? `Edit column ${before.name}` : "Add column"}
      description="Generates the ALTER statement in a query tab; nothing runs until you execute it there."
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!draft.name || !draft.data_type || unchanged}
            onClick={() => onSubmit(draft)}
          >
            Generate SQL
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.name && draft.data_type && !unchanged) onSubmit(draft);
        }}
      >
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="font-mono" />
        </Field>
        <Field label="Type" hint="As the driver spells it, e.g. varchar(255), timestamptz, numeric(10,2)">
          <Input value={type} onChange={(e) => setType(e.target.value)} className="font-mono" placeholder="text" />
        </Field>
        <Switch checked={def !== null} onChange={(on) => setDef(on ? "" : null)} label="Has default" />
        {def !== null && (
          <Field label="Default" hint={DEFAULT_HINT[driver] ?? "A SQL expression: 'active', 0, now()"}>
            <Input autoFocus value={def} onChange={(e) => setDef(e.target.value)} className="font-mono" />
          </Field>
        )}
        <Switch checked={nullable} onChange={setNullable} label="Nullable" />
        {before?.is_primary && (
          <p className="flex items-center gap-1 text-xs text-muted">
            <KeyRound size={12} /> Primary key column: the generated statement does not touch the key itself.
          </p>
        )}
      </form>
    </Dialog>
  );
}

function IndexDialog({
  table,
  columns,
  onClose,
  onSubmit,
}: {
  table: string;
  columns: string[];
  onClose: () => void;
  onSubmit: (idx: { name: string; columns: string[]; unique: boolean }) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const [name, setName] = useState("");
  const suggested = `${table}_${picked.join("_") || "x"}_${unique ? "key" : "idx"}`;
  const idx = { name: name.trim() || suggested, columns: picked, unique };
  const toggle = (c: string) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add index"
      description="Pick columns in the order they should appear in the index."
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={picked.length === 0} onClick={() => onSubmit(idx)}>
            Generate SQL
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 text-xs text-muted">
          <span id="index-columns" className="font-medium">
            Columns
          </span>
          <div
            role="group"
            aria-labelledby="index-columns"
            className="flex max-h-48 flex-col gap-1 overflow-auto scroll rounded-md border border-border p-2 font-mono"
          >
            {columns.map((c) => {
              const pos = picked.indexOf(c);
              return (
                <label key={c} className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={pos >= 0} onChange={() => toggle(c)} />
                  <span className="flex-1">{c}</span>
                  {pos >= 0 && <span className="text-faint">{pos + 1}</span>}
                </label>
              );
            })}
          </div>
        </div>
        <Switch checked={unique} onChange={setUnique} label="Unique" />
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} className="font-mono" />
        </Field>
      </div>
    </Dialog>
  );
}
