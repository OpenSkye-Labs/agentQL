import { useEffect, useState } from "react";
import { api, errMsg } from "../lib/api";
import { useStore } from "../lib/store";
import type { ConnectionConfig, ScopeEntry } from "../lib/types";
import { Button, Dialog, Spinner } from "./ui";

const SEP = "\u0000";
const key = (schema: string, table?: string) => (table ? `${schema}${SEP}${table}` : schema);
const keysOf = (scope?: ScopeEntry[] | null) => new Set((scope ?? []).map((e) => key(e.schema, e.table)));

/**
 * Pick which schemas/tables the agent may see on a connection. Saved on the connection config and
 * enforced by the backend tools. Mount with a changing `key` to reset the draft when reopened.
 */
export function AgentScopeDialog({
  conn,
  open,
  onOpenChange,
}: {
  conn: ConnectionConfig;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const live = useStore((s) => s.live[conn.id]);
  const loadTables = useStore((s) => s.loadTables);
  const refreshConnections = useStore((s) => s.refreshConnections);
  const toast = useStore((s) => s.toast);
  const [all, setAll] = useState(!conn.agent_scope);
  const [picked, setPicked] = useState(() => keysOf(conn.agent_scope));
  const [saving, setSaving] = useState(false);
  const schemas = live?.schemas ?? [];
  const tables = live?.tables ?? {};

  // The sidebar loads tables lazily; the picker needs every schema.
  useEffect(() => {
    if (!open) return;
    for (const sc of schemas) if (!tables[sc]) void loadTables(conn.id, sc);
  }, [open, conn.id, schemas, tables, loadTables]);

  const toggle = (k: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  const toggleSchema = (sc: string) =>
    setPicked((p) => {
      const n = new Set([...p].filter((k) => k !== sc && !k.startsWith(sc + SEP)));
      if (!p.has(sc)) n.add(sc);
      return n;
    });

  const save = async () => {
    const scope: ScopeEntry[] | null = all
      ? null
      : [...picked].map((k) => {
          const [schema, table] = k.split(SEP);
          return table ? { schema, table } : { schema };
        });
    setSaving(true);
    try {
      await api.saveConnection({ ...conn, agent_scope: scope });
      await refreshConnections();
      onOpenChange(false);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Agent scope"
      description={`What the assistant may see on ${conn.name}. Enforced by the tools, not only the prompt.`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || (!all && picked.size === 0)}>
            {saving ? <Spinner className="h-3 w-3" /> : null} Save
          </Button>
        </>
      }
    >
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" className="accent-accent" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Everything on this connection (default)
      </label>
      {!all && (
        <div className="mt-3 space-y-3" aria-label="Schemas and tables">
          {schemas.length === 0 && <p className="text-xs text-muted">Connect first to list schemas.</p>}
          {schemas.map((sc) => {
            const whole = picked.has(sc);
            return (
              <div key={sc}>
                <label className="flex items-center gap-2 text-[13px] font-medium">
                  <input type="checkbox" className="accent-accent" checked={whole} onChange={() => toggleSchema(sc)} />
                  {sc}
                  <span className="text-xs font-normal text-muted">whole schema</span>
                </label>
                <div className="ml-5 mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {tables[sc] ? (
                    tables[sc].map((t) => {
                      const k = key(sc, t.name);
                      return (
                        <label key={t.name} className="flex min-w-0 items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            className="accent-accent"
                            disabled={whole}
                            checked={whole || picked.has(k)}
                            onChange={(e) => toggle(k, e.target.checked)}
                          />
                          <span className="truncate">{t.name}</span>
                        </label>
                      );
                    })
                  ) : (
                    <Spinner className="h-3 w-3" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
