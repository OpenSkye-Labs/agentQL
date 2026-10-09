import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, Info, Plus, RefreshCw, Bot } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useStore, useConnection, type Tab } from "../lib/store";
import type { Cell, QueryResult } from "../lib/types";
import { ResultGrid } from "./ResultGrid";
import { Button, Dialog, Input, Spinner, Empty, Tooltip, Textarea } from "./ui";
import { fmtCount } from "../lib/format";

type MTab = Extract<Tab, { kind: "mongo" }>;

export function MongoTab({ tab }: { tab: MTab }) {
  const conn = useConnection(tab.connectionId);
  const toast = useStore((s) => s.toast);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const [mode, setMode] = useState<"find" | "aggregate">("find");
  const [view, setView] = useState<"json" | "table">("json");
  const [filter, setFilter] = useState("{}");
  const [sort, setSort] = useState("");
  const [pipeline, setPipeline] = useState('[\n  { "$match": {} },\n  { "$limit": 50 }\n]');
  const [limit, setLimit] = useState(50);
  const [skip, setSkip] = useState(0);
  const [docs, setDocs] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ doc: Record<string, unknown> | null; text: string } | null>(null);
  const [info, setInfo] = useState<{ indexes: unknown[]; fields: Record<string, string>; stats: unknown } | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const parse = (s: string, fallback: unknown) => {
    if (!s.trim()) return fallback;
    return JSON.parse(s);
  };

  const load = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === "find") {
        const r = await api.mongoFind(conn.id, { db: tab.db, collection: tab.collection, filter: parse(filter, {}), sort: parse(sort, null), limit, skip });
        setDocs(r.docs);
        setTotal(r.total);
      } else {
        const r = await api.mongoAggregate(conn.id, tab.db, tab.collection, parse(pipeline, []), 1000);
        setDocs(r);
        setTotal(null);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [conn, tab.db, tab.collection, mode, filter, sort, pipeline, limit, skip]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id, skip, limit]);

  useEffect(() => {
    if (conn) api.mongoCollectionInfo(conn.id, tab.db, tab.collection).then(setInfo).catch(() => {});
  }, [conn, tab.db, tab.collection]);

  const table = useMemo<QueryResult>(() => {
    const cols: string[] = [];
    for (const d of docs) for (const k of Object.keys(d)) if (!cols.includes(k)) cols.push(k);
    return {
      columns: cols.map((c) => ({ name: c, type_name: info?.fields[c] ?? "" })),
      rows: docs.map((d) => cols.map((c) => (d[c] === undefined ? null : (d[c] as Cell)))),
      affected: null,
      duration_ms: 0,
      truncated: false,
      statement: "",
    };
  }, [docs, info]);

  const saveDoc = async () => {
    if (!conn || !editing) return;
    try {
      const parsed = JSON.parse(editing.text);
      if (editing.doc) await api.mongoReplace(conn.id, tab.db, tab.collection, editing.doc._id, parsed);
      else await api.mongoInsert(conn.id, tab.db, tab.collection, parsed);
      toast(editing.doc ? "Document updated" : "Document inserted", "success");
      setEditing(null);
      await load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const deleteDoc = async (d: Record<string, unknown>) => {
    if (!conn || !confirm("Delete this document?")) return;
    try {
      await api.mongoDelete(conn.id, tab.db, tab.collection, d._id);
      await load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  if (!conn) return <Empty title="Connection removed" />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-elev px-2 py-1.5" role="toolbar">
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs" role="tablist">
          {(["find", "aggregate"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={clsx("rounded px-2.5 py-0.5 capitalize", mode === m ? "bg-active" : "text-muted hover:text-fg")}>{m}</button>
          ))}
        </div>
        {mode === "find" ? (
          <form className="flex flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); setSkip(0); void load(); }}>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} className="h-7 font-mono text-xs" placeholder='{ "status": "active" }' aria-label="Filter document" />
            <Input value={sort} onChange={(e) => setSort(e.target.value)} className="h-7 w-44 font-mono text-xs" placeholder='sort { "_id": -1 }' aria-label="Sort document" />
            <Button size="sm" type="submit">Find</Button>
          </form>
        ) : (
          <span className="flex-1 text-xs text-muted">Edit the pipeline below and run.</span>
        )}
        <Tooltip label="Ask the assistant about this collection">
          <Button size="sm" variant="ghost" aria-label="Ask assistant" onClick={() => { setChatOpen(true); window.dispatchEvent(new CustomEvent("agentql:chat-prefill", { detail: `Describe the collection ${tab.db}.${tab.collection}: fields, indexes, and a few sample documents.` })); }}><Bot size={13} /></Button>
        </Tooltip>
        <Tooltip label="Collection info"><Button size="sm" variant="ghost" aria-label="Collection info" onClick={() => setShowInfo(true)}><Info size={13} /></Button></Tooltip>
        {!conn.read_only && (
          <Tooltip label="Insert document"><Button size="sm" variant="ghost" aria-label="Insert document" onClick={() => setEditing({ doc: null, text: "{\n  \n}" })}><Plus size={13} /></Button></Tooltip>
        )}
        <Tooltip label="Reload"><Button size="sm" variant="ghost" aria-label="Reload" onClick={() => void load()}>{loading ? <Spinner /> : <RefreshCw size={13} />}</Button></Tooltip>
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs" role="tablist">
          {(["json", "table"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={clsx("rounded px-2 py-0.5 uppercase", view === v ? "bg-active" : "text-muted hover:text-fg")}>{v}</button>
          ))}
        </div>
      </div>
      {mode === "aggregate" && (
        <div className="flex gap-2 border-b border-border bg-sunken p-2">
          <Textarea value={pipeline} onChange={(e) => setPipeline(e.target.value)} className="h-28 font-mono text-xs" aria-label="Aggregation pipeline" />
          <Button variant="primary" onClick={() => void load()} disabled={loading}>Run</Button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto scroll">
        {error ? (
          <div role="alert" className="m-3 rounded-md border border-danger/40 bg-danger-soft p-3 font-mono text-xs whitespace-pre-wrap selectable">{error}</div>
        ) : view === "table" ? (
          <ResultGrid result={table} />
        ) : (
          <div className="p-2 space-y-1.5">
            {docs.map((d, i) => (
              <div key={i} className="group rounded-md border border-border bg-elev">
                <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-[11px] text-muted">
                  <span className="font-mono truncate">_id: {JSON.stringify(d._id)}</span>
                  <span className="flex-1" />
                  <button className="hover:text-fg" onClick={() => void navigator.clipboard.writeText(JSON.stringify(d, null, 2))}>Copy</button>
                  {!conn.read_only && (
                    <>
                      <button className="hover:text-fg" onClick={() => setEditing({ doc: d, text: JSON.stringify(d, null, 2) })}>Edit</button>
                      <button className="hover:text-danger" onClick={() => void deleteDoc(d)}>Delete</button>
                    </>
                  )}
                </div>
                <pre className="max-h-64 overflow-auto scroll p-2 font-mono text-xs whitespace-pre-wrap selectable">{JSON.stringify(d, null, 2)}</pre>
              </div>
            ))}
            {docs.length === 0 && !loading && <div className="p-6 text-center text-xs text-muted">No documents</div>}
          </div>
        )}
      </div>
      <div className="flex h-7 items-center gap-3 border-t border-border bg-elev px-2 text-[11px] text-muted" role="status">
        <span>{mode === "find" && total != null ? `${fmtCount(skip + 1)}–${fmtCount(skip + docs.length)} of ${fmtCount(total)}` : `${docs.length} documents`}</span>
        <span className="flex-1" />
        {mode === "find" && (
          <>
            <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setSkip(0); }} className="h-5 rounded border border-border bg-elev text-[11px]" aria-label="Documents per page">
              {[20, 50, 100, 250].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
            <Button size="icon" variant="ghost" aria-label="Previous page" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - limit))}><ChevronLeft size={13} /></Button>
            <Button size="icon" variant="ghost" aria-label="Next page" disabled={docs.length < limit} onClick={() => setSkip(skip + limit)}><ChevronRight size={13} /></Button>
          </>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.doc ? "Edit document" : "Insert document"} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={saveDoc}>Save</Button></>}>
        <Textarea value={editing?.text ?? ""} onChange={(e) => setEditing((s) => (s ? { ...s, text: e.target.value } : s))} className="h-80 font-mono text-xs" aria-label="Document JSON" />
      </Dialog>
      <Dialog open={showInfo} onOpenChange={setShowInfo} title={`${tab.db}.${tab.collection}`}>
        {info ? (
          <div className="space-y-4 text-xs selectable">
            <div>
              <h3 className="font-semibold mb-1">Fields (sampled)</h3>
              <table className="w-full font-mono"><tbody>{Object.entries(info.fields).map(([k, t]) => <tr key={k}><td className="pr-3 py-0.5">{k}</td><td className="text-muted">{t}</td></tr>)}</tbody></table>
            </div>
            <div>
              <h3 className="font-semibold mb-1">Indexes</h3>
              <pre className="rounded border border-border bg-sunken p-2 font-mono">{JSON.stringify(info.indexes, null, 2)}</pre>
            </div>
          </div>
        ) : <Spinner />}
      </Dialog>
    </div>
  );
}
