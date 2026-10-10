import { getVersion } from "@tauri-apps/api/app";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errMsg } from "../lib/api";
import { useStore } from "../lib/store";
import { Markdown } from "./Markdown";
import { Button, Dialog, Spinner, Tooltip } from "./ui";
import changelog from "../../CHANGELOG.md?raw";

const LAST_SEEN = "agentql.lastSeenVersion";
const PROMPTED = "agentql.updatePromptedFor";

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode or blocked storage: dialogs just show again next time */
    }
  },
};

/** The `## <version> ...` section of the bundled CHANGELOG, without the version heading. */
export function changelogFor(version: string, text = changelog): string | null {
  const lines = text.split("\n");
  // Exact version only: "## 0.1.1" must not match "## 0.1.10". Accepts "## 0.1.1 (date)" and "## [0.1.1](url)".
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## \\[?${esc}\\]?(?=\\s|\\(|$)`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

/**
 * Status-bar "Update to vX" button plus the two dialogs around it:
 * "Update available" (release notes, Later / Update now) and "What's new" after an update installed.
 */
export function UpdateButton() {
  const toast = useStore((s) => s.toast);
  const [update, setUpdate] = useState<{ version: string; notes: string | null } | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"update" | "whatsnew" | null>(null);
  const [installing, setInstalling] = useState(false);
  // An update found while "What's new" is showing waits here until that dialog closes.
  const [pendingPrompt, setPendingPrompt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Installed version first (local, instant): "What's new" runs once per version, never on first launch.
      let showingWhatsNew = false;
      try {
        const v = await getVersion();
        if (cancelled) return;
        setCurrent(v);
        const seen = ls.get(LAST_SEEN);
        ls.set(LAST_SEEN, v);
        showingWhatsNew = !!seen && seen !== v && changelogFor(v) !== null;
        if (showingWhatsNew) setDialog("whatsnew");
      } catch {
        /* not running under Tauri (browser mock): no version, no What's new */
      }
      // 2. Then the network check, so the two can never race for the dialog.
      // ponytail: one check at startup; add a periodic re-check if sessions run for days.
      try {
        const u = await api.checkUpdate();
        if (cancelled || !u) return;
        setUpdate(u);
        if (ls.get(PROMPTED) === u.version) return;
        if (showingWhatsNew) setPendingPrompt(true);
        else setDialog("update");
      } catch (e) {
        // Offline or no release yet: nothing the user can act on, so stay quiet (the button shows once a check succeeds).
        console.warn("update check failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Record "prompted" only once the update dialog has actually been shown.
  useEffect(() => {
    if (dialog === "update" && update) ls.set(PROMPTED, update.version);
  }, [dialog, update]);

  const closeWhatsNew = () => {
    setPendingPrompt(false);
    setDialog(pendingPrompt && update ? "update" : null);
  };

  const install = () => {
    setInstalling(true);
    api.installUpdate().catch((e) => {
      setInstalling(false);
      toast(errMsg(e), "error");
    });
  };

  return (
    <>
      {update && (
        <Tooltip label="An update is ready to install.">
          <button
            onClick={() => setDialog("update")}
            className="flex items-center gap-1 text-accent hover:text-fg disabled:opacity-60"
            disabled={installing}
          >
            <Download size={11} /> {installing ? "Updating…" : `Update to v${update.version}`}
          </button>
        </Tooltip>
      )}

      {update && (
        <Dialog
          open={dialog === "update"}
          onOpenChange={(o) => !installing && setDialog(o ? "update" : null)}
          title={`Update available: v${update.version}`}
          description={current ? `You are on v${current}. The app restarts after installing.` : undefined}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(null)} disabled={installing}>
                Later
              </Button>
              <Button onClick={install} disabled={installing}>
                {installing ? (
                  <>
                    <Spinner className="mr-1.5" /> Installing…
                  </>
                ) : (
                  "Update now"
                )}
              </Button>
            </>
          }
        >
          <Markdown text={update.notes?.trim() || "_No release notes for this version._"} />
        </Dialog>
      )}

      {current && (
        <Dialog
          open={dialog === "whatsnew"}
          onOpenChange={(o) => (o ? setDialog("whatsnew") : closeWhatsNew())}
          title={`What's new in v${current}`}
          footer={<Button onClick={closeWhatsNew}>Close</Button>}
        >
          <Markdown text={changelogFor(current) ?? "_No notes for this version._"} />
        </Dialog>
      )}
    </>
  );
}
