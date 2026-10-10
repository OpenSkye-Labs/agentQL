import { clsx } from "clsx";
import { Bot, Database, FileCode2, LayoutDashboard, Plus, Table2, X, Braces, KeySquare } from "lucide-react";
import { useStore, type Tab } from "../lib/store";
import { Tooltip, ContextMenu, EnvBadge } from "./ui";
import { mod } from "../lib/format";

const icons: Record<Tab["kind"], React.ReactNode> = {
  query: <FileCode2 size={13} />,
  table: <Table2 size={13} />,
  chat: <Bot size={13} />,
  dashboard: <LayoutDashboard size={13} />,
  redis: <KeySquare size={13} />,
  mongo: <Braces size={13} />,
  welcome: <Database size={13} />,
};

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  const setActive = useStore((s) => s.setActiveTab);
  const close = useStore((s) => s.closeTab);
  const openTab = useStore((s) => s.openTab);
  const connections = useStore((s) => s.connections);
  const live = useStore((s) => s.live);
  const current = tabs.find((t) => t.id === activeTab);
  const connId = current?.connectionId ?? Object.keys(live)[0];

  return (
    <div className="flex h-9 items-stretch border-b border-border bg-sunken" role="tablist" aria-label="Open tabs">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto scroll">
        {tabs.map((t) => {
          const conn = t.connectionId ? connections.find((c) => c.id === t.connectionId) : null;
          const active = t.id === activeTab;
          return (
            <ContextMenu
              key={t.id}
              items={[
                { label: "Close", onSelect: () => close(t.id), shortcut: `${mod}+W` },
                {
                  label: "Close others",
                  onSelect: () => tabs.filter((x) => x.id !== t.id && x.kind !== "welcome").forEach((x) => close(x.id)),
                },
                { label: "Close all", onSelect: () => tabs.forEach((x) => close(x.id)) },
              ]}
            >
              <div
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                onClick={() => setActive(t.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setActive(t.id);
                  if (e.key === "Delete" || e.key === "Backspace") close(t.id);
                  const idx = tabs.findIndex((x) => x.id === t.id);
                  const target =
                    e.key === "ArrowRight"
                      ? idx + 1
                      : e.key === "ArrowLeft"
                        ? idx - 1
                        : e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? tabs.length - 1
                            : -1;
                  if (target >= 0 && target < tabs.length) {
                    e.preventDefault();
                    setActive(tabs[target].id);
                    e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[role=tab]")[target]?.focus();
                  }
                }}
                onAuxClick={(e) => e.button === 1 && close(t.id)}
                className={clsx(
                  "group relative flex max-w-[220px] min-w-[120px] cursor-default items-center gap-2 border-r border-border px-3 text-xs",
                  active ? "bg-bg text-fg" : "text-muted hover:bg-hover hover:text-fg",
                )}
              >
                {active && (
                  <span
                    className="absolute inset-x-0 top-0 h-[2px]"
                    style={{ background: conn?.color ?? "var(--accent)" }}
                  />
                )}
                <span className="shrink-0 text-faint">{icons[t.kind]}</span>
                <span className="truncate flex-1">{t.title}</span>
                <EnvBadge env={conn?.environment} className="shrink-0" />
                {t.kind !== "welcome" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      close(t.id);
                    }}
                    aria-label={`Close ${t.title}`}
                    className={clsx(
                      "rounded p-1 hover:bg-active focus-visible:opacity-100",
                      active ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70",
                    )}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </ContextMenu>
          );
        })}
      </div>
      {connId && (
        <Tooltip label={`New query tab (${mod}+T)`}>
          <button
            onClick={() => openTab({ kind: "query", connectionId: connId, title: "Query", sql: "" })}
            className="flex w-9 items-center justify-center text-muted hover:bg-hover hover:text-fg"
            aria-label="New query tab"
          >
            <Plus size={15} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
