import { Bot, Download, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errMsg } from "../lib/api";
import { useStore, useActiveTab, useConnection } from "../lib/store";
import { driverLabel } from "../lib/types";
import { Tooltip } from "./ui";
import { mod } from "../lib/format";

export function StatusBar({ onToggleChat }: { onToggleChat: () => void }) {
  const tab = useActiveTab();
  const conn = useConnection(tab?.connectionId ?? null);
  const live = useStore((s) => (tab?.connectionId ? s.live[tab.connectionId] : null));
  const secretStorage = useStore((s) => s.secretStorage);
  const chatOpen = useStore((s) => s.chatOpen);
  const toast = useStore((s) => s.toast);
  const [update, setUpdate] = useState<{ version: string } | null>(null);
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    // ponytail: one check at startup; add a periodic re-check if sessions run for days.
    api
      .checkUpdate()
      .then(setUpdate)
      .catch(() => {});
  }, []);
  const install = () => {
    setInstalling(true);
    api.installUpdate().catch((e) => {
      setInstalling(false);
      toast(errMsg(e), "error");
    });
  };
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
          {conn.read_only && <span className="rounded bg-warning/20 px-1 text-warning">read-only</span>}
        </span>
      ) : (
        <span>No connection selected</span>
      )}
      <span className="flex-1" />
      {update && (
        <Tooltip
          label={
            installing ? "Downloading and installing; the app will restart." : "Download and install, then restart."
          }
        >
          <button
            onClick={install}
            disabled={installing}
            className="flex items-center gap-1 text-accent hover:text-fg disabled:opacity-60"
          >
            <Download size={11} /> {installing ? "Updating…" : `Update to v${update.version}`}
          </button>
        </Tooltip>
      )}
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
