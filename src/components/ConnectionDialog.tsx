import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, FolderOpen, XCircle } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useStore } from "../lib/store";
import {
  DRIVERS,
  ENVIRONMENTS,
  isSql,
  type ConnectionConfig,
  type ConnectionSecrets,
  type Driver,
  type Environment,
} from "../lib/types";
import { Button, Dialog, Field, Input, Select, Spinner, Switch } from "./ui";

const COLORS = ["#3b6cf6", "#1f8f5a", "#b7791f", "#d23f3f", "#8b5cf6", "#0e9aa7", "#e05d9c", "#6b7280"];
const COLOR_NAMES = ["Blue", "Green", "Amber", "Red", "Violet", "Teal", "Pink", "Gray"];

function blank(driver: Driver = "postgres"): ConnectionConfig {
  const d = DRIVERS.find((x) => x.id === driver)!;
  return {
    id: "",
    name: "",
    driver,
    color: COLORS[0],
    group: "",
    url: null,
    host: driver === "sqlite" ? "" : "localhost",
    port: d.port,
    user: driver === "postgres" ? "postgres" : driver === "mysql" || driver === "mariadb" ? "root" : "",
    database: driver === "postgres" ? "postgres" : "",
    file_path: null,
    ssl_mode: null,
    ssl_ca_path: null,
    ssl_cert_path: null,
    ssl_key_path: null,
    ssh: null,
    read_only: false,
    environment: null,
    options: {},
  };
}

export function ConnectionDialog({
  open,
  edit,
  onOpenChange,
}: {
  open: boolean;
  edit: ConnectionConfig | null;
  onOpenChange: (o: boolean) => void;
}) {
  const refresh = useStore((s) => s.refreshConnections);
  const connect = useStore((s) => s.connect);
  const toast = useStore((s) => s.toast);
  const [cfg, setCfg] = useState<ConnectionConfig>(blank());
  const [secrets, setSecrets] = useState<ConnectionSecrets>({});
  const [mode, setMode] = useState<"fields" | "url">("fields");
  const [useSsh, setUseSsh] = useState(false);
  const [sshAuth, setSshAuth] = useState<"agent" | "password" | "key">("agent");
  const [keyPath, setKeyPath] = useState("~/.ssh/id_ed25519");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    if (edit) {
      setCfg({ ...edit });
      setMode(edit.url ? "url" : "fields");
      setUseSsh(!!edit.ssh);
      const a = edit.ssh?.auth;
      setSshAuth(a === "password" ? "password" : a && typeof a === "object" ? "key" : "agent");
      if (a && typeof a === "object") setKeyPath(a.key_file.path);
      void api.getConnectionSecrets(edit.id).then(setSecrets);
    } else {
      setCfg(blank());
      setSecrets({});
      setMode("fields");
      setUseSsh(false);
      setSshAuth("agent");
    }
  }, [open, edit]);

  const set = <K extends keyof ConnectionConfig>(k: K, v: ConnectionConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const sql = isSql(cfg.driver);
  const sqlite = cfg.driver === "sqlite";

  const build = (): ConnectionConfig => {
    const out: ConnectionConfig = { ...cfg, name: cfg.name.trim() || defaultName(cfg) };
    out.url = mode === "url" ? cfg.url?.trim() || null : null;
    out.ssh = useSsh
      ? {
          host: cfg.ssh?.host ?? "",
          port: cfg.ssh?.port || 22,
          user: cfg.ssh?.user ?? "",
          auth: sshAuth === "agent" ? "agent" : sshAuth === "password" ? "password" : { key_file: { path: keyPath } },
        }
      : null;
    return out;
  };

  const test = async () => {
    setBusy("test");
    setTestResult(null);
    try {
      const v = await api.testConnection(build(), secrets);
      setTestResult({ ok: true, text: v });
    } catch (e) {
      setTestResult({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  const save = async (andConnect: boolean) => {
    setBusy("save");
    try {
      const saved = await api.saveConnection(build(), secrets);
      await refresh();
      onOpenChange(false);
      if (andConnect) await connect(saved.id);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const pickFile = async (onPick: (p: string) => void, filters?: { name: string; extensions: string[] }[]) => {
    const p = await openFile({ multiple: false, directory: false, filters });
    if (typeof p === "string") onPick(p);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={edit ? "Edit connection" : "New connection"}
      width="max-w-2xl"
      footer={
        <>
          {testResult && (
            <span
              className={clsx(
                "mr-auto flex items-center gap-1.5 text-xs selectable",
                testResult.ok ? "text-success" : "text-danger",
              )}
            >
              {testResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {testResult.text}
            </span>
          )}
          <Button onClick={test} disabled={busy !== null}>
            {busy === "test" ? <Spinner /> : null} Test
          </Button>
          <Button onClick={() => save(false)} disabled={busy !== null}>
            Save
          </Button>
          <Button variant="primary" onClick={() => save(true)} disabled={busy !== null}>
            {busy === "save" ? <Spinner /> : null} Save & connect
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* driver picker */}
        <fieldset className="grid grid-cols-6 gap-1.5">
          <legend className="sr-only">Database type</legend>
          {DRIVERS.map((d) => (
            <label
              key={d.id}
              className={clsx(
                "cursor-pointer rounded-md border px-2 py-2 text-center text-xs font-medium focus-within:outline-2 focus-within:outline-accent",
                cfg.driver === d.id
                  ? "border-accent bg-accent-soft text-fg"
                  : "border-border bg-elev text-muted hover:bg-hover",
              )}
            >
              <input
                type="radio"
                name="driver"
                className="sr-only"
                checked={cfg.driver === d.id}
                onChange={() => {
                  if (edit) set("driver", d.id);
                  else setCfg({ ...blank(d.id), name: cfg.name, color: cfg.color, group: cfg.group });
                }}
              />
              {d.label}
            </label>
          ))}
        </fieldset>

        <div className="grid grid-cols-[1fr_140px_120px_auto] gap-3 items-start">
          <Field label="Name">
            <Input
              value={cfg.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={defaultName(cfg)}
              autoFocus
            />
          </Field>
          <Field label="Group">
            <Input
              value={cfg.group ?? ""}
              onChange={(e) => set("group", e.target.value)}
              placeholder="optional, e.g. Team A"
            />
          </Field>
          <Field label="Environment" hint={sql ? "Production asks before every write" : "Badge only for this driver"}>
            <Select
              value={cfg.environment ?? ""}
              onChange={(e) => set("environment", (e.target.value || null) as Environment | null)}
            >
              <option value="">none</option>
              {ENVIRONMENTS.map((env) => (
                <option key={env} value={env}>
                  {env}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Color">
            <fieldset className="flex h-8 items-center gap-0.5 -ml-1">
              <legend className="sr-only">Color</legend>
              {COLORS.map((c, i) => (
                <label
                  key={c}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full focus-within:outline-2 focus-within:outline-accent"
                  title={COLOR_NAMES[i]}
                >
                  <input
                    type="radio"
                    name="color"
                    className="sr-only"
                    checked={cfg.color === c}
                    onChange={() => set("color", c)}
                    aria-label={COLOR_NAMES[i]}
                  />
                  <span
                    className={clsx(
                      "h-4 w-4 rounded-full ring-offset-2 ring-offset-elev",
                      cfg.color === c && "ring-2 ring-accent",
                    )}
                    style={{ background: c }}
                  />
                </label>
              ))}
            </fieldset>
          </Field>
        </div>

        {!sqlite && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted">Connect with</span>
            <div
              className="inline-flex rounded-md border border-border p-0.5"
              role="group"
              aria-label="Connection method"
            >
              {(["fields", "url"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={clsx("rounded px-2.5 py-1", mode === m ? "bg-active text-fg" : "text-muted hover:text-fg")}
                >
                  {m === "fields" ? "Host & credentials" : "Connection URL"}
                </button>
              ))}
            </div>
          </div>
        )}

        {sqlite ? (
          <Field label="Database file">
            <div className="flex gap-2">
              <Input
                value={cfg.file_path ?? ""}
                onChange={(e) => set("file_path", e.target.value)}
                placeholder="/path/to/database.sqlite (created if missing)"
              />
              <Button
                onClick={() =>
                  pickFile((p) => set("file_path", p), [{ name: "SQLite", extensions: ["sqlite", "db", "sqlite3"] }])
                }
                aria-label="Browse"
              >
                <FolderOpen size={14} />
              </Button>
            </div>
          </Field>
        ) : mode === "url" ? (
          <Field
            label="URL"
            hint="postgres://user@host:5432/db · mysql://… · redis://… · mongodb+srv://… Leave the password out and set it below."
          >
            <Input
              value={cfg.url ?? ""}
              onChange={(e) => set("url", e.target.value)}
              placeholder={`${cfg.driver === "postgres" ? "postgres" : cfg.driver === "mongodb" ? "mongodb" : cfg.driver}://user@host:${cfg.port}/${cfg.driver === "redis" ? "0" : "db"}`}
              className="font-mono"
            />
          </Field>
        ) : (
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <Field label="Host">
              <Input value={cfg.host} onChange={(e) => set("host", e.target.value)} />
            </Field>
            <Field label="Port">
              <Input type="number" value={cfg.port || ""} onChange={(e) => set("port", Number(e.target.value))} />
            </Field>
          </div>
        )}

        {!sqlite && (
          <div className="grid grid-cols-3 gap-3 items-start">
            <Field label={cfg.driver === "redis" ? "Username (ACL, optional)" : "User"}>
              <Input value={cfg.user} onChange={(e) => set("user", e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={secrets.password ?? ""}
                onChange={(e) => setSecrets((s) => ({ ...s, password: e.target.value }))}
                autoComplete="new-password"
              />
            </Field>
            <Field
              label={
                cfg.driver === "redis" ? "DB index" : cfg.driver === "mongodb" ? "Auth / default database" : "Database"
              }
            >
              <Input
                value={cfg.database}
                onChange={(e) => set("database", e.target.value)}
                placeholder={cfg.driver === "redis" ? "0" : cfg.driver === "mongodb" ? "admin" : ""}
              />
            </Field>
          </div>
        )}

        {!sqlite && (
          <details className="rounded-md border border-border">
            <summary className="cursor-default px-3 py-2 text-xs font-medium">SSL / TLS</summary>
            <div className="grid grid-cols-2 gap-3 p-3 pt-1 items-start">
              <Field label="Mode">
                <Select value={cfg.ssl_mode ?? ""} onChange={(e) => set("ssl_mode", e.target.value || null)}>
                  <option value="">Default (prefer)</option>
                  <option value="disable">Disable</option>
                  <option value="require">Require</option>
                  <option value="verify-ca">Verify CA</option>
                  <option value="verify-full">Verify full</option>
                </Select>
              </Field>
              <Field label="CA certificate">
                <div className="flex gap-1">
                  <Input
                    value={cfg.ssl_ca_path ?? ""}
                    onChange={(e) => set("ssl_ca_path", e.target.value)}
                    placeholder="optional"
                  />
                  <Button onClick={() => pickFile((p) => set("ssl_ca_path", p))} aria-label="Browse for CA certificate">
                    <FolderOpen size={14} />
                  </Button>
                </div>
              </Field>
              <Field label="Client certificate">
                <div className="flex gap-1">
                  <Input
                    value={cfg.ssl_cert_path ?? ""}
                    onChange={(e) => set("ssl_cert_path", e.target.value)}
                    placeholder="optional"
                  />
                  <Button
                    onClick={() => pickFile((p) => set("ssl_cert_path", p))}
                    aria-label="Browse for client certificate"
                  >
                    <FolderOpen size={14} />
                  </Button>
                </div>
              </Field>
              <Field label="Client key">
                <div className="flex gap-1">
                  <Input
                    value={cfg.ssl_key_path ?? ""}
                    onChange={(e) => set("ssl_key_path", e.target.value)}
                    placeholder="optional"
                  />
                  <Button onClick={() => pickFile((p) => set("ssl_key_path", p))} aria-label="Browse for client key">
                    <FolderOpen size={14} />
                  </Button>
                </div>
              </Field>
            </div>
          </details>
        )}

        {!sqlite && (
          <div className="rounded-md border border-border p-3 flex flex-col gap-3">
            <Switch
              checked={useSsh}
              onChange={setUseSsh}
              label="Connect over SSH tunnel"
              description="The database host/port above is resolved from the SSH server."
            />
            {useSsh && (
              <>
                <div className="grid grid-cols-[1fr_90px_1fr] gap-3 items-start">
                  <Field label="SSH host">
                    <Input
                      value={cfg.ssh?.host ?? ""}
                      onChange={(e) =>
                        set("ssh", {
                          host: e.target.value,
                          port: cfg.ssh?.port ?? 22,
                          user: cfg.ssh?.user ?? "",
                          auth: "agent",
                        })
                      }
                    />
                  </Field>
                  <Field label="Port">
                    <Input
                      type="number"
                      value={cfg.ssh?.port ?? 22}
                      onChange={(e) =>
                        set("ssh", {
                          host: cfg.ssh?.host ?? "",
                          port: Number(e.target.value),
                          user: cfg.ssh?.user ?? "",
                          auth: "agent",
                        })
                      }
                    />
                  </Field>
                  <Field label="SSH user">
                    <Input
                      value={cfg.ssh?.user ?? ""}
                      onChange={(e) =>
                        set("ssh", {
                          host: cfg.ssh?.host ?? "",
                          port: cfg.ssh?.port ?? 22,
                          user: e.target.value,
                          auth: "agent",
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-[150px_1fr_1fr] gap-3 items-start">
                  <Field label="Authentication">
                    <Select value={sshAuth} onChange={(e) => setSshAuth(e.target.value as typeof sshAuth)}>
                      <option value="agent">SSH agent</option>
                      <option value="key">Private key file</option>
                      <option value="password">Password</option>
                    </Select>
                  </Field>
                  {sshAuth === "key" && (
                    <>
                      <Field label="Key file">
                        <div className="flex gap-1">
                          <Input value={keyPath} onChange={(e) => setKeyPath(e.target.value)} />
                          <Button onClick={() => pickFile(setKeyPath)} aria-label="Browse for key">
                            <FolderOpen size={14} />
                          </Button>
                        </div>
                      </Field>
                      <Field label="Passphrase">
                        <Input
                          type="password"
                          value={secrets.ssh_key_passphrase ?? ""}
                          onChange={(e) => setSecrets((s) => ({ ...s, ssh_key_passphrase: e.target.value }))}
                          placeholder="if encrypted"
                        />
                      </Field>
                    </>
                  )}
                  {sshAuth === "password" && (
                    <Field label="SSH password">
                      <Input
                        type="password"
                        value={secrets.ssh_password ?? ""}
                        onChange={(e) => setSecrets((s) => ({ ...s, ssh_password: e.target.value }))}
                      />
                    </Field>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <Switch
          checked={cfg.read_only}
          onChange={(v) => set("read_only", v)}
          label="Read-only connection"
          description="Blocks write statements from the editor, the grid and the agent."
        />
        <Switch
          checked={!!cfg.agent_remote_consent_at}
          onChange={(v) => set("agent_remote_consent_at", v ? new Date().toISOString() : null)}
          label="Share schema and data with remote AI providers"
          description="Asked on first use in the assistant. Local providers (CLI, localhost) never need it."
        />
        {sql && cfg.driver === "postgres" && (
          <Field
            label="Extra options"
            hint="PostgreSQL runtime parameters, one per line as key=value (e.g. search_path=app,public)"
          >
            <textarea
              className="h-16 w-full rounded-md border border-border bg-elev px-2.5 py-1.5 font-mono text-xs selectable"
              value={Object.entries(cfg.options)
                .map(([k, v]) => `${k}=${v}`)
                .join("\n")}
              onChange={(e) => {
                const o: Record<string, string> = {};
                for (const line of e.target.value.split("\n")) {
                  const i = line.indexOf("=");
                  if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim();
                }
                set("options", o);
              }}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function defaultName(c: ConnectionConfig) {
  if (c.driver === "sqlite") return c.file_path?.split(/[\\/]/).pop() || "SQLite";
  const host = c.url ? (c.url.match(/@([^/:?]+)/)?.[1] ?? "") : c.host;
  return `${c.database || DRIVERS.find((d) => d.id === c.driver)?.label}${host ? ` @ ${host}` : ""}`;
}
