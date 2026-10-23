import { useRef, useState } from "react";
import { clsx } from "clsx";
import { errMsg } from "../lib/api";
import { useStore } from "../lib/store";
import { Input } from "./ui";

/**
 * A note shown as text that turns into an input on click. Enter or blur saves, Escape cancels.
 * A failed save keeps the input open with the draft and toasts the error.
 */
export function NoteText({
  value,
  label,
  placeholder = "Add description",
  onSave,
  className,
}: {
  value: string;
  /** Accessible name, e.g. "Description of status". */
  label: string;
  placeholder?: string;
  onSave: (text: string) => Promise<void>;
  /** Applies to the read state only, so the input is never hidden by it. */
  className?: string;
}) {
  const toast = useStore((s) => s.toast);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Enter commits and then the input unmounts and blurs; Escape cancels and blurs. One outcome per edit.
  const settled = useRef(false);

  const start = () => {
    settled.current = false;
    setDraft(value);
  };
  const commit = async () => {
    if (settled.current || draft === null) return;
    settled.current = true;
    if (draft.trim() === value.trim()) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft.trim());
      setDraft(null);
    } catch (e) {
      settled.current = false;
      toast(`Could not save the note: ${errMsg(e)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  if (draft === null)
    return (
      <button
        type="button"
        onClick={start}
        aria-label={`${label}: ${value || "none"}`}
        className={clsx(
          "w-full rounded px-1 text-left hover:bg-hover focus-visible:bg-hover",
          value ? "text-fg" : "text-faint",
          className,
        )}
      >
        {value || placeholder}
      </button>
    );
  return (
    <Input
      autoFocus
      aria-label={label}
      value={draft}
      maxLength={2000}
      // readOnly, not disabled: a disabled input drops focus, so after a failed save Escape would do nothing.
      readOnly={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          settled.current = true;
          setDraft(null);
        }
      }}
      className="h-6"
    />
  );
}
