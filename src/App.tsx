import { Suspense, lazy, useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { clsx } from "clsx";
import { useStore, useActiveTab } from "./lib/store";
import { TooltipProvider } from "./components/ui";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { Welcome } from "./components/Welcome";
import { TableTab } from "./components/TableTab";
import { Spinner } from "./components/ui";
// Heavy screens load on first use so the window appears quickly.
const QueryTab = lazy(() => import("./components/QueryTab").then((m) => ({ default: m.QueryTab })));
const RedisTab = lazy(() => import("./components/RedisTab").then((m) => ({ default: m.RedisTab })));
const MongoTab = lazy(() => import("./components/MongoTab").then((m) => ({ default: m.MongoTab })));
const DashboardTab = lazy(() => import("./components/DashboardTab").then((m) => ({ default: m.DashboardTab })));
const ChatPanel = lazy(() => import("./components/ChatPanel").then((m) => ({ default: m.ChatPanel })));
const ErdTab = lazy(() => import("./components/ErdTab").then((m) => ({ default: m.ErdTab })));
const SchemaDiffTab = lazy(() => import("./components/SchemaDiffTab").then((m) => ({ default: m.SchemaDiffTab })));
import { ConnectionDialog } from "./components/ConnectionDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { ConnectionConfig } from "./lib/types";
import { isMac } from "./lib/format";

export default function App() {
  const init = useStore((s) => s.init);
  const tabs = useStore((s) => s.tabs);
  const activeTab = useActiveTab();
  const chatOpen = useStore((s) => s.chatOpen);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const [connDialog, setConnDialog] = useState<{ open: boolean; edit?: ConnectionConfig | null }>({ open: false });
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const s = useStore.getState();
      const active = s.tabs.find((t) => t.id === s.activeTab);
      if (e.key === "t" && !e.shiftKey) {
        const connId = active?.connectionId ?? Object.keys(s.live)[0];
        if (connId) {
          e.preventDefault();
          s.openTab({ kind: "query", connectionId: connId, title: "Query", sql: "" });
        }
      } else if (e.key === "w") {
        if (active && active.kind !== "welcome") {
          e.preventDefault();
          s.closeTab(active.id);
        }
      } else if (e.key === "k" || e.key === "j") {
        e.preventDefault();
        s.setChatOpen(!s.chatOpen);
      } else if (e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        setConnDialog({ open: true, edit: null });
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (s.tabs[idx]) {
          e.preventDefault();
          s.setActiveTab(s.tabs[idx].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-bg text-fg">
        <PanelGroup direction="horizontal" className="flex-1 min-h-0" autoSaveId="agentql-main">
          <Panel defaultSize={20} minSize={14} maxSize={40} className="min-w-[200px]">
            <Sidebar
              onNewConnection={() => setConnDialog({ open: true, edit: null })}
              onEditConnection={(c) => setConnDialog({ open: true, edit: c })}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </Panel>
          <ResizeHandle />
          <Panel minSize={30}>
            <div className="flex h-full flex-col min-w-0">
              <TabBar />
              <main className="flex-1 min-h-0 relative" role="main">
                {tabs.map((t) => (
                  <div
                    key={t.id}
                    className={clsx("absolute inset-0 flex flex-col", t.id !== activeTab?.id && "hidden")}
                    aria-hidden={t.id !== activeTab?.id}
                  >
                    <ErrorBoundary label="tab">
                      <Suspense fallback={<Loading />}>
                        {t.kind === "welcome" && (
                          <Welcome onNewConnection={() => setConnDialog({ open: true, edit: null })} />
                        )}
                        {t.kind === "query" && <QueryTab tab={t} />}
                        {t.kind === "table" && <TableTab tab={t} />}
                        {t.kind === "redis" && <RedisTab tab={t} />}
                        {t.kind === "mongo" && <MongoTab tab={t} />}
                        {t.kind === "dashboard" && <DashboardTab tab={t} />}
                        {t.kind === "erd" && <ErdTab tab={t} />}
                        {t.kind === "diff" && <SchemaDiffTab tab={t} />}
                      </Suspense>
                    </ErrorBoundary>
                  </div>
                ))}
              </main>
            </div>
          </Panel>
          {chatOpen && (
            <>
              <ResizeHandle />
              <Panel defaultSize={30} minSize={22} maxSize={55} className="min-w-[320px]">
                <ErrorBoundary label="assistant panel">
                  <Suspense fallback={<Loading />}>
                    <ChatPanel onClose={() => setChatOpen(false)} onOpenSettings={() => setSettingsOpen(true)} />
                  </Suspense>
                </ErrorBoundary>
              </Panel>
            </>
          )}
        </PanelGroup>
        <StatusBar onToggleChat={() => setChatOpen(!chatOpen)} />
        <Toasts />
        <ConnectionDialog
          open={connDialog.open}
          edit={connDialog.edit ?? null}
          onOpenChange={(o) => setConnDialog((d) => ({ ...d, open: o }))}
        />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
    </TooltipProvider>
  );
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
      <Spinner /> Loading…
    </div>
  );
}

function ResizeHandle() {
  return (
    <PanelResizeHandle className="w-px bg-border hover:bg-accent data-[resize-handle-active]:bg-accent transition-colors relative after:absolute after:inset-y-0 after:-left-1 after:-right-1" />
  );
}
