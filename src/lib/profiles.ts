// Portable connection profiles: JSON without secrets, for onboarding teammates.
import { DRIVERS, type ConnectionConfig, type Driver } from "./types.ts";

export const PROFILES_FORMAT = "agentql-profiles";
export const PROFILES_VERSION = 1;

/** Drop a `user:password@` password from a URL's userinfo. Mirrors config.rs strip_url_password. */
export function stripUrlPassword(url: string): string {
  const scheme = url.indexOf("://");
  if (scheme < 0) return url;
  const start = scheme + 3;
  const end = url.slice(start).search(/[/?#]/);
  const authority = end < 0 ? url.slice(start) : url.slice(start, start + end);
  const at = authority.lastIndexOf("@");
  if (at < 0) return url;
  const colon = authority.slice(0, at).indexOf(":");
  if (colon < 0) return url;
  return url.slice(0, start) + authority.slice(0, colon) + url.slice(start + at);
}

/** Connection profiles as JSON. ConnectionConfig never carries secrets (keychain only), and any
 *  password still embedded in a URL is stripped again here as a belt-and-braces guard. */
export function exportProfiles(connections: ConnectionConfig[]): string {
  const list = connections.map(({ id: _id, created_at: _c, updated_at: _u, url, ...rest }) => ({
    ...rest,
    url: url ? stripUrlPassword(url) : url,
  }));
  return JSON.stringify({ format: PROFILES_FORMAT, version: PROFILES_VERSION, connections: list }, null, 2);
}

/** Parse a profiles file. Returns configs with empty ids (save_connection assigns new ones). */
export function parseProfiles(json: string): ConnectionConfig[] {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new Error("not a JSON file");
  }
  if (!doc || typeof doc !== "object" || (doc as { format?: unknown }).format !== PROFILES_FORMAT)
    throw new Error("not an AgentQL profiles file");
  const raw = (doc as { connections?: unknown }).connections;
  if (!Array.isArray(raw)) throw new Error("profiles file has no connections");
  return raw.map((c, i) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const driver = o.driver as Driver;
    if (typeof o.name !== "string" || !o.name.trim()) throw new Error(`connection #${i + 1} has no name`);
    if (!DRIVERS.some((d) => d.id === driver)) throw new Error(`connection "${o.name}" has unknown driver`);
    const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
    const port = (v: unknown) =>
      Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 65535 ? (v as number) : null;
    if (o.port !== undefined && port(o.port) === null) throw new Error(`connection "${o.name}" has an invalid port`);
    let ssh: ConnectionConfig["ssh"] = null;
    if (o.ssh && typeof o.ssh === "object") {
      const h = o.ssh as Record<string, unknown>;
      if (typeof h.host !== "string" || typeof h.user !== "string" || (h.port !== undefined && port(h.port) === null))
        throw new Error(`connection "${o.name}" has an invalid ssh section`);
      const auth = h.auth;
      const keyPath = (auth as { key_file?: { path?: unknown } } | null)?.key_file?.path;
      ssh = {
        host: h.host,
        port: port(h.port) ?? 22,
        user: h.user,
        auth:
          auth === "password" ? "password" : typeof keyPath === "string" ? { key_file: { path: keyPath } } : "agent",
      };
    }
    const color = str("color");
    return {
      id: "",
      name: o.name.trim(),
      driver,
      // Colours are rendered as inline CSS, so only accept hex values.
      color: color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : null,
      group: str("group"),
      url: str("url") ? stripUrlPassword(str("url") as string) : null,
      host: str("host") ?? "",
      port: port(o.port) ?? 0,
      user: str("user") ?? "",
      database: str("database") ?? "",
      file_path: str("file_path"),
      ssl_mode: str("ssl_mode"),
      ssl_ca_path: str("ssl_ca_path"),
      ssl_cert_path: str("ssl_cert_path"),
      ssl_key_path: str("ssl_key_path"),
      ssh,
      read_only: o.read_only === true,
      options:
        o.options && typeof o.options === "object"
          ? Object.fromEntries(Object.entries(o.options).filter(([, v]) => typeof v === "string"))
          : {},
    } as ConnectionConfig;
  });
}
