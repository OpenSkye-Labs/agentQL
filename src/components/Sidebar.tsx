import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  FolderOpen,
  KeySquare,
  Braces,
  MoreHorizontal,
  Pencil,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Table2,
  Trash2,
  FileCode2,
  Layers,
  LayoutDashboard,
} from "lucide-react";
import { useStore, type LiveConn } from "../lib/store";
import { api, errMsg } from "../lib/api";
import { driverLabel, isSql, type ConnectionConfig, type TableInfo } from "../lib/types";
import { Button, ContextMenu, Menu, Spinner, Tooltip } from "./ui";
import { fmtCount } from "../lib/format";

type Items = React.ComponentProps<typeof ContextMenu>["items"];
/** One Radix context menu for the whole tree; rows just publish their items on right-click. */
const MenuCtx = createContext<(items: Items) => void>(() => {});

export function Sidebar({
  onNewConnection,
  onEditConnection,
  onOpenSettings,
}: {
  onNewConnection: () => void;
  onEditConnection: (c: ConnectionConfig) => void;
  onOpenSettings: () => void;
}) {
  const connections = useStore((s) => s.connections);
  const live = useStore((s) => s.live);
  const filter = useStore((s) => s.sidebarFilter);
  const setFilter = useStore((s) => s.setSidebarFilter);
  const dashboards = useStore((s) => s.dashboards);
  const [menuItems, setMenuItems] = useState<Items>([]);

  const groups = useMemo(() => {
    const m = new Map<string, ConnectionConfig[]>();
    for (const c of connections) {
      const g = c.group?.trim() || "";
      m.set(g, [...(m.get(g) ?? []), c]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  }, [connections]);

  return (
    <aside className="flex h-full flex-col border-r border-border bg-sunken" aria-label="Connections">
      <div className="flex h-9 items-center gap-1 border-b border-border px-2">
        <span className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
          <Database size={13} /> Connections
        </span>
        <span className="flex-1" />
        <Tooltip label="New connection">
          <Button variant="ghost" size="icon" onClick={onNewConnection} aria-label="New connection">
            <Plus size={15} />
          </Button>
        </Tooltip>
        <Tooltip label="Settings">
          <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="Settings">
            <Settings size={14} />
          </Button>
        </Tooltip>
      </div>
      <div className="px-2 py-1.5">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tables…"
            aria-label="Filter tables"
            className="h-7 w-full rounded-md border border-border bg-elev pl-7 pr-2 text-xs placeholder:text-faint focus:border-accent"
          />
        </div>
      </div>
      <MenuCtx.Provider value={setMenuItems}>
        <ContextMenu items={menuItems.length ? menuItems : [{ label: "No actions here", disabled: true }]}>
          <div
            className="flex-1 overflow-auto scroll pb-4"
            role="tree"
            aria-label="Database objects"
            onKeyDown={(e) => {
              if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
              const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=treeitem]")];
              const i = items.indexOf(document.activeElement as HTMLElement);
              const next = items[e.key === "ArrowDown" ? i + 1 : i - 1];
              if (next) {
                e.preventDefault();
                next.focus();
              }
            }}
          >
            {connections.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted">
                No connections yet.
                <div className="mt-2">
                  <Button size="sm" variant="primary" onClick={onNewConnection}>
                    <Plus size={13} /> Add connection
                  </Button>
                </div>
              </div>
            )}
            {groups.map(([group, list]) => (
              <div key={group || "_"}>
                {group && (
                  <div className="mt-2 flex items-center gap-1 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                    <FolderOpen size={12} /> {group}
                  </div>
                )}
                {list.map((c) => (
                  <ConnectionNode
                    key={c.id}
                    conn={c}
                    live={live[c.id]}
                    filter={filter}
                    onEdit={() => onEditConnection(c)}
                    dashboards={dashboards.filter((d) => d.connection_id === c.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        </ContextMenu>
      </MenuCtx.Provider>
    </aside>
  );
}

function ConnectionNode({
  conn,
  live,
  filter,
  onEdit,
  dashboards,
}: {
  conn: ConnectionConfig;
  live: LiveConn | undefined;
  filter: string;
  onEdit: () => void;
  dashboards: { id: string; title: string }[];
}) {
  const connect = useStore((s) => s.connect);
  const disconnect = useStore((s) => s.disconnect);
  const openTab = useStore((s) => s.openTab);
  const toast = useStore((s) => s.toast);
  const refreshConnections = useStore((s) => s.refreshConnections);
  const refreshSchema = useStore((s) => s.refreshSchema);
  const askAssistant = useStore((s) => s.askAssistant);
  const [open, setOpen] = useState(true);
  const connected = !!live && !live.loading;
  const loading = !!live?.loading;

  const toggle = async () => {
    if (!live) {
      try {
        await connect(conn.id);
        setOpen(true);
      } catch {
        /* toast already shown */
      }
    } else setOpen((o) => !o);
  };

  const menu = [
    connected
      ? { label: "Disconnect", icon: <PlugZap size={13} />, onSelect: () => void disconnect(conn.id) }
      : { label: "Connect", icon: <Plug size={13} />, onSelect: () => void connect(conn.id) },
    {
      label: "New query",
      icon: <FileCode2 size={13} />,
      disabled: !connected,
      onSelect: () => openTab({ kind: "query", connectionId: conn.id, title: "Query", sql: "" }),
    },
    {
      label: "Ask the assistant",
      icon: <Bot size={13} />,
      disabled: !connected,
      onSelect: () => askAssistant(`Give me an overview of the ${conn.name} database.`),
    },
    {
      label: "Refresh",
      icon: <RefreshCw size={13} />,
      disabled: !connected,
      onSelect: () => void refreshSchema(conn.id),
    },
    ...(connected && live && live.databases.length > 1 && conn.driver !== "mongodb"
      ? [
          { separator: true, label: "" },
          { label: `Database: ${live.database || "default"}`, disabled: true },
          ...live.databases
            .filter((d) => d !== live.database)
            .slice(0, 25)
            .map((d) => ({
              label: `Switch to ${d}`,
              icon: <Database size={13} />,
              onSelect: () => void connect(conn.id, d),
            })),
        ]
      : []),
    { separator: true, label: "" },
    { label: "Edit connection…", icon: <Pencil size={13} />, onSelect: onEdit },
    {
      label: "Duplicate",
      onSelect: async () => {
        const copy = { ...conn, id: "", name: `${conn.name} copy` };
        const secrets = await api.getConnectionSecrets(conn.id);
        await api.saveConnection(copy, secrets);
        await refreshConnections();
      },
    },
    {
      label: "Delete",
      icon: <Trash2 size={13} />,
      danger: true,
      onSelect: async () => {
        if (!confirm(`Delete connection "${conn.name}"?`)) return;
        try {
          await api.deleteConnection(conn.id);
          await disconnect(conn.id);
          await refreshConnections();
        } catch (e) {
          toast(errMsg(e), "error");
        }
      },
    },
  ];

  const publish = useContext(MenuCtx);
  return (
    <div>
      <div
        onContextMenu={() => publish(menu)}
        role="treeitem"
        aria-expanded={connected ? open : undefined}
        aria-label={`${conn.name}, ${driverLabel(conn.driver)}, ${connected ? "connected" : loading ? "connecting" : "disconnected"}`}
        className={clsx(
          "group flex h-7 items-center gap-1.5 pr-1 pl-2 text-[13px] cursor-default hover:bg-hover",
          connected && "font-medium",
        )}
        onClick={toggle}
        onDoubleClick={() => connected && openTab({ kind: "query", connectionId: conn.id, title: "Query", sql: "" })}
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && void toggle()}
      >
        <span className="w-3.5 text-faint">
          {connected ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
        </span>
        <span className="relative flex h-3 w-3 items-center justify-center">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: conn.color ?? "var(--accent)", opacity: connected ? 1 : 0.4 }}
          />
          {connected && (
            <span className="absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5 rounded-full bg-success ring-1 ring-sunken" />
          )}
        </span>
        <span className="truncate flex-1">{conn.name}</span>
        {loading && <Spinner />}
        {conn.read_only && (
          <span className="rounded bg-warning/15 px-1 text-[10px] text-warning" title="Read-only connection">
            ro
          </span>
        )}
        <Menu
          trigger={
            <button
              className="rounded p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-active"
              aria-label={`Actions for ${conn.name}`}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={14} />
            </button>
          }
          items={menu}
        />
      </div>
      {connected && open && live && (
        <div role="group">
          {dashboards.map((d) => (
            <Row
              key={d.id}
              depth={1}
              icon={<LayoutDashboard size={13} className="text-accent" />}
              label={d.title}
              meta="dashboard"
              onOpen={() => openTab({ kind: "dashboard", connectionId: conn.id, title: d.title, dashboardId: d.id })}
            />
          ))}
          {isSql(conn.driver) && <SqlTree conn={conn} live={live} filter={filter} />}
          {conn.driver === "redis" && (
            <Row
              depth={1}
              icon={<KeySquare size={13} className="text-warning" />}
              label={`Keys (db ${live.database || "0"})`}
              onOpen={() => openTab({ kind: "redis", connectionId: conn.id, title: `Keys · ${conn.name}` })}
            />
          )}
          {conn.driver === "mongodb" && <MongoTree conn={conn} live={live} filter={filter} />}
        </div>
      )}
    </div>
  );
}

function Row({
  depth,
  icon,
  label,
  meta,
  onOpen,
  onToggle,
  expanded,
  menu,
  active,
}: {
  depth: number;
  icon: React.ReactNode;
  label: string;
  meta?: string;
  onOpen?: () => void;
  onToggle?: () => void;
  expanded?: boolean;
  menu?: React.ComponentProps<typeof ContextMenu>["items"];
  active?: boolean;
}) {
  const publish = useContext(MenuCtx);
  return (
    <div
      role="treeitem"
      aria-expanded={onToggle ? expanded : undefined}
      tabIndex={0}
      onContextMenu={() => publish(menu ?? [])}
      className={clsx(
        "flex h-6 items-center gap-1.5 pr-2 text-xs cursor-default hover:bg-hover",
        active && "bg-active",
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => (onToggle ? onToggle() : onOpen?.())}
      onDoubleClick={() => onToggle && onOpen?.()}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen?.();
        if (e.key === " " || e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          onToggle?.();
        }
      }}
    >
      {onToggle ? (
        <span className="w-3.5 text-faint">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      ) : (
        <span className="w-3.5" />
      )}
      <span className="shrink-0">{icon}</span>
      <span className="truncate flex-1">{label}</span>
      {meta && <span className="text-[10px] text-faint tabular-nums">{meta}</span>}
    </div>
  );
}

function tableIcon(kind: string) {
  if (kind === "view" || kind === "matview") return <Eye size={13} className="text-muted" />;
  if (kind === "foreign") return <Layers size={13} className="text-muted" />;
  return <Table2 size={13} className="text-accent" />;
}

function SqlTree({ conn, live, filter }: { conn: ConnectionConfig; live: LiveConn; filter: string }) {
  const toggleSchema = useStore((s) => s.toggleSchema);
  const openTab = useStore((s) => s.openTab);
  const askAssistant = useStore((s) => s.askAssistant);
  const f = filter.trim().toLowerCase();
  const q = (name: string) => (conn.driver === "mysql" || conn.driver === "mariadb" ? `\`${name}\`` : `"${name}"`);
  const qualified = (t: TableInfo) =>
    conn.driver === "sqlite" && t.schema === "main" ? q(t.name) : `${q(t.schema)}.${q(t.name)}`;

  return (
    <>
      {live.schemas.map((schema) => {
        const tables = live.tables[schema];
        const visible = tables?.filter((t) => !f || t.name.toLowerCase().includes(f)) ?? [];
        const expanded = !!live.expanded[schema] || (!!f && visible.length > 0);
        if (f && tables && visible.length === 0) return null;
        return (
          <div key={schema}>
            <Row
              depth={1}
              icon={<Database size={13} className="text-muted" />}
              label={schema}
              meta={tables ? String(tables.length) : undefined}
              expanded={expanded}
              onToggle={() => toggleSchema(conn.id, schema)}
            />
            {expanded && (
              <div role="group">
                {!tables && (
                  <div className="flex items-center gap-2 px-10 py-1 text-xs text-faint">
                    <Spinner /> loading…
                  </div>
                )}
                {visible.map((t) => (
                  <Row
                    key={t.name}
                    depth={2}
                    icon={tableIcon(t.kind)}
                    label={t.name}
                    meta={t.row_estimate != null ? fmtCount(t.row_estimate) : undefined}
                    onOpen={() =>
                      openTab({
                        kind: "table",
                        connectionId: conn.id,
                        title: t.name,
                        schema: t.schema,
                        table: t.name,
                        tableKind: t.kind,
                      })
                    }
                    menu={[
                      {
                        label: "Open",
                        icon: <Table2 size={13} />,
                        onSelect: () =>
                          openTab({
                            kind: "table",
                            connectionId: conn.id,
                            title: t.name,
                            schema: t.schema,
                            table: t.name,
                            tableKind: t.kind,
                          }),
                      },
                      {
                        label: "SELECT in new query",
                        icon: <FileCode2 size={13} />,
                        onSelect: () =>
                          openTab({
                            kind: "query",
                            connectionId: conn.id,
                            title: `${t.name} query`,
                            sql: `SELECT *\nFROM ${qualified(t)}\nLIMIT 100;`,
                          }),
                      },
                      {
                        label: "Ask the assistant about this table",
                        icon: <Bot size={13} />,
                        onSelect: () => {
                          askAssistant(`Describe the table ${t.schema}.${t.name} and show me a few example rows.`);
                        },
                      },
                      { separator: true, label: "" },
                      { label: "Copy name", onSelect: () => void navigator.clipboard.writeText(t.name) },
                      {
                        label: "Copy qualified name",
                        onSelect: () => void navigator.clipboard.writeText(qualified(t)),
                      },
                    ]}
                  />
                ))}
                {tables && visible.length === 0 && <div className="px-10 py-1 text-xs text-faint">empty</div>}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function MongoTree({ conn, live, filter }: { conn: ConnectionConfig; live: LiveConn; filter: string }) {
  const openTab = useStore((s) => s.openTab);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    live.database ? { [live.database]: true } : {},
  );
  const [cols, setCols] = useState<Record<string, { name: string; count: number | null }[] | null | undefined>>({});
  const toast = useStore((s) => s.toast);
  const f = filter.trim().toLowerCase();

  // Load collections for newly expanded databases (once each; null marks a failed load).
  useEffect(() => {
    const pending = Object.keys(expanded).filter((db) => expanded[db] && cols[db] === undefined);
    if (pending.length === 0) return;
    setCols((c) => ({ ...c, ...Object.fromEntries(pending.map((db) => [db, null])) }));
    for (const db of pending) {
      api
        .mongoCollections(conn.id, db)
        .then((list) => setCols((c) => ({ ...c, [db]: list })))
        .catch((e) => toast(errMsg(e), "error"));
    }
  }, [expanded, cols, conn.id, toast]);
  const dbs = live.databases.filter((d) => !["admin", "local", "config"].includes(d) || d === live.database);
  return (
    <>
      {dbs.map((db) => {
        const isOpen = !!expanded[db];
        const list = (cols[db] ?? []).filter((c) => !f || c.name.toLowerCase().includes(f));
        return (
          <div key={db}>
            <Row
              depth={1}
              icon={<Database size={13} className="text-muted" />}
              label={db}
              expanded={isOpen}
              onToggle={() => setExpanded((e) => ({ ...e, [db]: !e[db] }))}
              meta={cols[db] ? String(cols[db]!.length) : undefined}
            />
            {isOpen && (
              <div role="group">
                {!cols[db] && (
                  <div className="flex items-center gap-2 px-10 py-1 text-xs text-faint">
                    <Spinner /> loading…
                  </div>
                )}
                {list.map((c) => (
                  <Row
                    key={c.name}
                    depth={2}
                    icon={<Braces size={13} className="text-success" />}
                    label={c.name}
                    meta={c.count != null ? fmtCount(c.count) : undefined}
                    onOpen={() =>
                      openTab({ kind: "mongo", connectionId: conn.id, title: c.name, db, collection: c.name })
                    }
                    menu={[{ label: "Copy name", onSelect: () => void navigator.clipboard.writeText(c.name) }]}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
