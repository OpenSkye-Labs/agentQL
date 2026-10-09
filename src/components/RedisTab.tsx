import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { ChevronDown, RefreshCw, Search, Terminal, Trash2, Clock } from "lucide-react";
import { api, errMsg, type RedisValue } from "../lib/api";
import { useStore, useConnection, type Tab } from "../lib/store";
import type { RedisKey } from "../lib/types";
import { Button, Input, Spinner, Empty, Tooltip } from "./ui";
import { fmtBytes } from "../lib/format";

type RTab = Extract<Tab, { kind: "redis" }>;

const TYPE_COLORS: Record<string, string> = { string: "bg-accent-soft text-accent", hash: "bg-success/15 text-success", list: "bg-warning/15 text-warning", set: "bg-danger-soft text-danger", zset: "bg-active text-fg", stream: "bg-hover text-muted" };

export function RedisTab({ tab }: { tab: RTab }) {
  const conn = useConnection(tab.connectionId);
  const toast = useStore((s) => s.toast);
  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<RedisKey[]>([]);
  const [cursor, setCursor] = useState("0");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<RedisValue | null>(null);
  const [cmd, setCmd] = useState("");
  const [log, setLog] = useState<{ cmd: string; out: string; err?: boolean }[]>([]);
  const [info, setInfo] = useState<Record<string, string> | null>(null);

  const scan = useCallback(
    async (reset: boolean) => {
      if (!conn) return;
      setLoading(true);
      try {
        const r = await api.redisScan(conn.id, reset ? "0" : cursor, pattern, 200);
        setKeys((k) => (reset ? r.keys : [...k, ...r.keys]));
        setCursor(r.cursor);
      } catch (e) {
        toast(errMsg(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [conn, cursor, pattern, toast],
  );

  useEffect(() => {
    void scan(true);
    if (conn) api.redisInfo(conn.id).then(setInfo).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id]);

  const open = async (key: string) => {
    if (!conn) return;
    try {
      setSelected(await api.redisGet(conn.id, key));
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const afterWrite = (first: string) => {
    if (/^(del|set|expire|persist|hset|lpush|rpush|sadd|zadd|rename|flushdb)$/i.test(first)) {
      void scan(true);
      if (selected) void open(selected.key);
    }
  };

  const runCmd = async (line: string) => {
    if (!conn || !line.trim()) return;
    try {
      const out = await api.redisCommand(conn.id, line);
      setLog((l) => [...l, { cmd: line, out: typeof out === "string" ? out : JSON.stringify(out, null, 2) }]);
      afterWrite(line.trim().split(/\s+/)[0]);
    } catch (e) {
      setLog((l) => [...l, { cmd: line, out: errMsg(e), err: true }]);
    }
    setCmd("");
  };

  /** Structured commands: keys/values travel as separate arguments, so no quoting is involved. */
  const exec = async (args: string[]) => {
    if (!conn) return;
    const shown = args.map((a) => (/\s|"/.test(a) ? JSON.stringify(a) : a)).join(" ");
    try {
      const out = await api.redisExec(conn.id, args);
      setLog((l) => [...l, { cmd: shown, out: typeof out === "string" ? out : JSON.stringify(out, null, 2) }]);
      afterWrite(args[0]);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  if (!conn) return <Empty title="Connection removed" />;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        <form
          className="flex items-center gap-1 border-b border-border p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void scan(true);
          }}
        >
          <Search size={13} className="text-faint" />
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} className="h-7 font-mono text-xs" aria-label="Key pattern" placeholder="pattern, e.g. user:*" />
          <Button size="sm" type="submit" aria-label="Scan">{loading ? <Spinner /> : <RefreshCw size={13} />}</Button>
        </form>
        <div className="flex-1 overflow-auto scroll" role="list" aria-label="Keys">
          {keys.map((k) => (
            <button
              key={k.key}
              type="button"
              role="listitem"
              aria-current={selected?.key === k.key}
              onClick={() => void open(k.key)}
              className={clsx("flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-hover", selected?.key === k.key && "bg-active")}
            >
              <span className={clsx("w-11 shrink-0 rounded px-1 text-center text-[10px] font-medium", TYPE_COLORS[k.kind] ?? "bg-hover")}>{k.kind}</span>
              <span className="truncate font-mono flex-1">{k.key}</span>
              {k.ttl >= 0 && <span className="text-[10px] text-faint tabular-nums">{k.ttl}s</span>}
            </button>
          ))}
          {keys.length === 0 && !loading && <div className="p-4 text-center text-xs text-muted">No keys match</div>}
          {cursor !== "0" && (
            <button onClick={() => void scan(false)} className="flex w-full items-center justify-center gap-1 py-2 text-xs text-accent hover:bg-hover">
              <ChevronDown size={13} /> Load more
            </button>
          )}
        </div>
        <div className="border-t border-border px-2 py-1 text-[11px] text-muted">
          {keys.length} keys loaded{info && ` · ${info.dbsize} total · ${info.used_memory_human ?? ""}`}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 min-h-0 overflow-auto scroll">
          {selected ? (
            <div className="p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-medium", TYPE_COLORS[selected.type] ?? "bg-hover")}>{selected.type}</span>
                <span className="font-mono text-sm font-semibold selectable truncate">{selected.key}</span>
                <span className="text-xs text-muted">{selected.type === "string" ? fmtBytes(selected.size) : `${selected.size} items`}</span>
                <span className="flex items-center gap-1 text-xs text-muted"><Clock size={11} /> {selected.ttl < 0 ? "no expiry" : `${selected.ttl}s`}</span>
                <span className="flex-1" />
                <Tooltip label="Set TTL">
                  <Button size="sm" variant="ghost" onClick={() => { const t = prompt("TTL in seconds (-1 to persist)", String(selected.ttl)); if (t !== null) void exec(Number(t) < 0 ? ["PERSIST", selected.key] : ["EXPIRE", selected.key, String(Math.max(0, Math.floor(Number(t)) || 0))]); }}>TTL</Button>
                </Tooltip>
                <Tooltip label="Delete key">
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => { if (confirm(`Delete key "${selected.key}"?`)) { void exec(["DEL", selected.key]); setSelected(null); } }} aria-label="Delete key"><Trash2 size={13} /></Button>
                </Tooltip>
              </div>
              <RedisValueView v={selected} onSet={(val) => exec(["SET", selected.key, val, ...(selected.ttl > 0 ? ["EX", String(selected.ttl)] : [])])} readOnly={conn.read_only} />
            </div>
          ) : (
            <Empty title="Select a key" hint="Keys are loaded with SCAN, so large databases stay responsive. Use the console below for any command." />
          )}
        </div>
        <div className="flex h-56 shrink-0 flex-col border-t border-border bg-sunken">
          <div className="flex-1 overflow-auto scroll p-2 font-mono text-xs selectable" aria-live="polite">
            {log.map((l, i) => (
              <div key={i} className="mb-1.5">
                <div className="text-accent">&gt; {l.cmd}</div>
                <pre className={clsx("whitespace-pre-wrap", l.err && "text-danger")}>{l.out}</pre>
              </div>
            ))}
            {log.length === 0 && <div className="text-faint">Redis console — try INFO, HGETALL user:1, SCAN 0 MATCH sess:* COUNT 50</div>}
          </div>
          <form
            className="flex items-center gap-2 border-t border-border px-2 py-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void runCmd(cmd);
            }}
          >
            <Terminal size={13} className="text-faint" />
            <input value={cmd} onChange={(e) => setCmd(e.target.value)} className="flex-1 bg-transparent font-mono text-xs outline-none selectable" placeholder="command…" aria-label="Redis command" />
            <Button size="sm" type="submit">Run</Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function RedisValueView({ v, onSet, readOnly }: { v: RedisValue; onSet: (s: string) => void; readOnly: boolean }) {
  const [draft, setDraft] = useState<string>(typeof v.value === "string" ? v.value : JSON.stringify(v.value, null, 2));
  useEffect(() => setDraft(typeof v.value === "string" ? v.value : JSON.stringify(v.value, null, 2)), [v]);
  if (v.type === "string") {
    const pretty = (() => { try { return JSON.stringify(JSON.parse(draft), null, 2); } catch { return null; } })();
    return (
      <div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} readOnly={readOnly} className="h-64 w-full rounded-md border border-border bg-elev p-2 font-mono text-xs selectable" aria-label="Value" />
        <div className="mt-2 flex gap-2">
          {!readOnly && <Button size="sm" variant="primary" disabled={draft === v.value} onClick={() => onSet(draft)}>Save</Button>}
          {pretty && pretty !== draft && <Button size="sm" onClick={() => setDraft(pretty)}>Format JSON</Button>}
          <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(draft)}>Copy</Button>
        </div>
      </div>
    );
  }
  const val = v.value;
  if (v.type === "hash" && val && typeof val === "object" && !Array.isArray(val)) {
    return <KV rows={Object.entries(val as Record<string, unknown>)} head={["field", "value"]} />;
  }
  if (v.type === "zset" && Array.isArray(val)) {
    const rows: [string, unknown][] = [];
    for (let i = 0; i < val.length; i += 2) rows.push([String(val[i]), val[i + 1]]);
    return <KV rows={rows} head={["member", "score"]} />;
  }
  if (Array.isArray(val)) return <KV rows={val.map((x, i) => [String(i), x] as [string, unknown])} head={["#", "value"]} />;
  return <pre className="rounded-md border border-border bg-elev p-2 font-mono text-xs selectable whitespace-pre-wrap">{JSON.stringify(val, null, 2)}</pre>;
}

function KV({ rows, head }: { rows: [string, unknown][]; head: [string, string] }) {
  return (
    <table className="w-full border-collapse font-mono text-xs selectable">
      <thead>
        <tr className="text-left text-muted">
          <th className="border-b border-border px-2 py-1 font-medium font-sans">{head[0]}</th>
          <th className="border-b border-border px-2 py-1 font-medium font-sans">{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i} className="hover:bg-hover">
            <td className="border-b border-border px-2 py-1 text-accent align-top whitespace-nowrap">{k}</td>
            <td className="border-b border-border px-2 py-1 whitespace-pre-wrap break-all">{typeof v === "string" ? v : JSON.stringify(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
