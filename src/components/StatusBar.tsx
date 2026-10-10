import { Bot, KeyRound } from "lucide-react";
import { useStore, useActiveTab, useConnection } from "../lib/store";
import { driverLabel } from "../lib/types";
import { Tooltip, EnvBadge } from "./ui";
import { UpdateButton } from "./Updates";
import { mod } from "../lib/format";

export function StatusBar({ onToggleChat }: { onToggleChat: () => void }) {
  const tab = useActiveTab();
  const conn = useConnection(tab?.connectionId ?? null);
  const live = useStore((s) => (tab?.connectionId ? s.live[tab.connectionId] : null));
  const secretStorage = useStore((s) => s.secretStorage);
  const chatOpen = useStore((s) => s.chatOpen);
  return (
    <footer
      className="flex h-6 items-center gap-3 border-t border-border bg-elev px-3 text-[11px] text-muted"
      role="contentinfo"
    >
      {conn ? (
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: conn.color ?? "var(--success)" }} />
          <span className="font-medium text-fg">{conn.name}</span>
          <span>· {driverLabel(conn.driver)}</span>
          {live?.database && <span>· {live.database}</span>}
          {live?.version && <span className="text-faint">· {live.version}</span>}
          <EnvBadge env={conn.environment} />
          {conn.read_only && <span className="rounded bg-warning/20 px-1 text-warning">read-only</span>}
        </span>
      ) : (
        <span>No connection selected</span>
      )}
      <span className="flex-1" />
      <UpdateButton />
      {secretStorage === "file" && (
        <Tooltip label="No OS keychain was found; passwords are stored in a local file in the app data directory.">
          <span className="flex items-center gap-1 text-warning">
            <KeyRound size={11} /> file secrets
          </span>
        </Tooltip>
      )}
      <Tooltip label={`Toggle AI assistant (${mod}+K)`}>
        <button onClick={onToggleChat} className="flex items-center gap-1 hover:text-fg" aria-pressed={chatOpen}>
          <Bot size={12} /> Assistant
        </button>
      </Tooltip>
    </footer>
  );
}
