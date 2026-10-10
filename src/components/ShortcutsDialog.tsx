import { useEffect, useState } from "react";
import { mod } from "../lib/format";
import { useStore } from "../lib/store";
import { Dialog, Kbd } from "./ui";

/** Open from anywhere: `window.dispatchEvent(new Event("agentql:shortcuts"))` or Mod+/. */
export const SHORTCUTS_EVENT = "agentql:shortcuts";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Editor",
    items: [
      [`${mod}+Enter`, "Run the statement under the cursor (or the selection)"],
      [`${mod}+Shift+Enter`, "Run everything in the tab"],
      ["F5", "Run the statement under the cursor"],
      ["Ctrl+Space", "Open completion (tables, alias columns, JOINs, keywords, snippets)"],
      ["Tab / Shift+Tab", "Next / previous snippet placeholder; otherwise indent"],
      [`${mod}+Z / ${mod}+Shift+Z`, "Undo / redo"],
      [`${mod}+/`, "This dialog"],
    ],
  },
  {
    title: "App",
    items: [
      [`${mod}+T`, "New query tab"],
      [`${mod}+W`, "Close tab"],
      [`${mod}+1…9`, "Switch to tab"],
      [`${mod}+K`, "Toggle the assistant"],
      [`${mod}+N`, "New connection"],
      [`${mod}+,`, "Settings"],
    ],
  },
  {
    title: "Results",
    items: [
      [`${mod}+C`, "Copy selected cells"],
      ["Space / double-click", "Inspect a cell"],
    ],
  },
];

export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const vim = useStore((s) => !!s.settings.editor_vim);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(SHORTCUTS_EVENT, show);
    return () => window.removeEventListener(SHORTCUTS_EVENT, show);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen} title="Keyboard shortcuts" width="max-w-lg">
      <div className="flex flex-col gap-4">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1.5 text-xs font-medium text-muted">{g.title}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              {g.items.map(([keys, what]) => (
                <div key={keys} className="contents">
                  <dt className="whitespace-nowrap">
                    <Kbd>{keys}</Kbd>
                  </dt>
                  <dd className="text-muted">{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="text-xs text-muted">
          Vim keymap is <span className="text-fg">{vim ? "on" : "off"}</span> (Settings → General). Snippets: save a
          query with a trigger word and placeholders like <code className="font-mono">{"${1:table}"}</code>.
        </p>
      </div>
    </Dialog>
  );
}
