import type { Dispatch, SetStateAction } from "react";
import { FolderOpen } from "lucide-react";
import type { ConnectionConfig, ConnectionSecrets } from "../lib/types";
import { Button, Field, Input, Select } from "./ui";

export type SshAuth = "agent" | "password" | "key";

/** The SSH tunnel fields of the connection dialog; state stays in ConnectionDialog. */
export function SshFields({
  cfg,
  set,
  sshAuth,
  setSshAuth,
  keyPath,
  setKeyPath,
  secrets,
  setSecrets,
  pickFile,
}: {
  cfg: ConnectionConfig;
  set: <K extends keyof ConnectionConfig>(k: K, v: ConnectionConfig[K]) => void;
  sshAuth: SshAuth;
  setSshAuth: (a: SshAuth) => void;
  keyPath: string;
  setKeyPath: (p: string) => void;
  secrets: ConnectionSecrets;
  setSecrets: Dispatch<SetStateAction<ConnectionSecrets>>;
  pickFile: (onPick: (p: string) => void) => Promise<void>;
}) {
  return (
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
          <Select value={sshAuth} onChange={(e) => setSshAuth(e.target.value as SshAuth)}>
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
  );
}
