import { clsx } from "clsx";
import { X } from "lucide-react";
import { useStore } from "../lib/store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-8 right-3 z-[80] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={clsx(
            "pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-[var(--shadow)] selectable",
            t.kind === "error" ? "border-danger/40 bg-danger-soft text-fg" : t.kind === "success" ? "border-success/40 bg-elev" : "border-border bg-elev",
          )}
        >
          <span className="flex-1 break-words">{t.text}</span>
          <button onClick={() => dismiss(t.id)} className="rounded p-1.5 -m-1 text-muted hover:text-fg" aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
