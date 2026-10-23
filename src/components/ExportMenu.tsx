import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Download, X } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useStore } from "../lib/store";
import { Button, Menu, Spinner } from "./ui";

export type ExportFormat = "csv" | "json" | "sql";

/** What an export reports back: rows written, and whether only the rows already in the grid were written. */
export type ExportOutcome = { rows: number; loadedOnly?: boolean };

const CANCELLED = "Export cancelled";

/**
 * One export at a time per tab: asks for a path, runs `start(id, path)`, follows `export:progress` for that id and
 * toasts the outcome. Cancel asks the backend to stop; the backend deletes the partial file.
 */
export function useExport() {
  const toast = useStore((s) => s.toast);
  const [job, setJob] = useState<{ id: string; rows: number } | null>(null);
  const jobId = job?.id;

  useEffect(() => {
    if (!jobId) return;
    const un = listen<{ id: string; rows: number }>("export:progress", ({ payload }) => {
      if (payload.id === jobId) setJob((j) => (j && j.id === jobId ? { ...j, rows: payload.rows } : j));
    });
    return () => {
      void un.then(
        (f) => f(),
        () => undefined,
      );
    };
  }, [jobId]);

  const run = async (
    name: string,
    format: ExportFormat,
    start: (id: string, path: string) => Promise<ExportOutcome>,
  ) => {
    if (job) return;
    let path: string | null;
    try {
      path = await saveDialog({
        defaultPath: `${name}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
    } catch (e) {
      toast(`Could not open the save dialog: ${errMsg(e)}`, "error");
      return;
    }
    if (!path) return;
    const id = crypto.randomUUID();
    setJob({ id, rows: 0 });
    try {
      const r = await start(id, path);
      toast(
        r.loadedOnly
          ? `Exported the ${r.rows.toLocaleString()} loaded rows (the statement is not read-only, so it was not re-run)`
          : `Exported ${r.rows.toLocaleString()} rows`,
        "success",
      );
    } catch (e) {
      const m = errMsg(e);
      if (m === CANCELLED) toast(CANCELLED, "info");
      else toast(`Export failed: ${m}`, "error");
    } finally {
      setJob(null);
    }
  };

  const cancel = () => {
    if (job) api.exportCancel(job.id).catch((e) => toast(`Could not cancel: ${errMsg(e)}`, "error"));
  };

  return { job, run, cancel };
}

/** The Export menu, or, while an export runs, its live row count and a Cancel button. */
export function ExportMenu({
  exporter,
  disabled,
  onPick,
}: {
  exporter: ReturnType<typeof useExport>;
  disabled?: boolean;
  onPick: (format: ExportFormat) => void;
}) {
  if (exporter.job)
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs text-muted">
        <Spinner /> Exporting… {exporter.job.rows.toLocaleString()} rows
        <Button size="sm" variant="ghost" onClick={exporter.cancel} aria-label="Cancel export">
          <X size={12} /> Cancel
        </Button>
      </div>
    );
  return (
    <Menu
      trigger={
        <Button size="sm" variant="ghost" disabled={disabled}>
          <Download size={13} /> Export
        </Button>
      }
      items={[
        { label: "CSV…", onSelect: () => onPick("csv") },
        { label: "JSON…", onSelect: () => onPick("json") },
        { label: "SQL inserts…", onSelect: () => onPick("sql") },
      ]}
    />
  );
}
