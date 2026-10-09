import { Bot, Database, KeyRound, Plug, Sparkles, Table2 } from "lucide-react";
import { Button, Kbd } from "./ui";
import { useStore } from "../lib/store";
import { mod } from "../lib/format";

export function Welcome({ onNewConnection }: { onNewConnection: () => void }) {
  const connections = useStore((s) => s.connections);
  const connect = useStore((s) => s.connect);
  return (
    <div className="flex h-full items-center justify-center p-8 overflow-auto scroll">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-fg shadow">
            <Database size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">AgentQL</h1>
            <p className="text-sm text-muted">A native database client with an agent that understands your data.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-8">
          <Card icon={<Plug size={16} />} title="Connect" text="PostgreSQL, MySQL, MariaDB, SQLite, Redis and MongoDB. Direct, URL, SSL or over SSH." />
          <Card icon={<Table2 size={16} />} title="Browse & edit" text="Fast virtualised grids, inline edits that become reviewable SQL, filters, structure and DDL." />
          <Card icon={<Bot size={16} />} title="Ask the agent" text="Use your Claude or OpenAI key, or your Claude Code / Codex subscription, to chat with your data and build dashboards." />
        </div>

        {connections.length > 0 ? (
          <div className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Your connections</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {connections.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void connect(c.id)}
                  className="flex items-center gap-3 rounded-lg border border-border bg-elev px-3 py-2 text-left hover:bg-hover"
                >
                  <span className="h-3 w-3 rounded-full" style={{ background: c.color ?? "var(--accent)" }} />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[13px] font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {c.driver} · {c.url ? c.url.replace(/:\/\/[^@]*@/, "://•••@") : `${c.host || c.file_path || ""}${c.database ? `/${c.database}` : ""}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={onNewConnection}>
            <Plug size={14} /> New connection
          </Button>
          <span className="text-xs text-muted flex items-center gap-3">
            <span><Kbd>{mod}</Kbd> <Kbd>N</Kbd> new connection</span>
            <span><Kbd>{mod}</Kbd> <Kbd>T</Kbd> new query</span>
            <span><Kbd>{mod}</Kbd> <Kbd>K</Kbd> assistant</span>
            <span><Kbd>{mod}</Kbd> <Kbd>,</Kbd> settings</span>
          </span>
        </div>
        <p className="mt-6 flex items-center gap-1.5 text-xs text-faint">
          <KeyRound size={12} /> Passwords are stored in your OS keychain. <Sparkles size={12} className="ml-2" /> Agent writes are off until you enable them.
        </p>
      </div>
    </div>
  );
}

function Card({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border bg-elev p-3">
      <div className="mb-1 flex items-center gap-2 text-[13px] font-medium">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      <p className="text-xs text-muted">{text}</p>
    </div>
  );
}
