// Runnable self-check: node --experimental-strip-types src/lib/profiles.check.ts
import assert from "node:assert/strict";
import { exportProfiles, parseProfiles, stripUrlPassword } from "./profiles.ts";
import type { ConnectionConfig } from "./types.ts";

assert.equal(stripUrlPassword("postgres://bob:s%3Acret@db:5432/app"), "postgres://bob@db:5432/app");
assert.equal(stripUrlPassword("redis://localhost:6379/0"), "redis://localhost:6379/0");
assert.equal(stripUrlPassword("mongodb://h/db?x=a@b"), "mongodb://h/db?x=a@b");
assert.equal(stripUrlPassword("mongodb://localhost:27017?appName=a@b"), "mongodb://localhost:27017?appName=a@b");
assert.equal(stripUrlPassword("mysql://u:p%40w@h:3306/d?x=a@b"), "mysql://u@h:3306/d?x=a@b");
assert.equal(stripUrlPassword("postgres://u@h/d"), "postgres://u@h/d");

const conn: ConnectionConfig = {
  id: "abc",
  name: "Prod",
  driver: "postgres",
  url: "postgres://bob:pw@db/app",
  host: "db",
  port: 5432,
  user: "bob",
  database: "app",
  ssh: { host: "bastion", port: 22, user: "ops", auth: "agent" },
  read_only: true,
  options: { sslmode: "require" },
  created_at: "2026-01-01",
};
const json = exportProfiles([conn]);
assert.ok(!json.includes("pw@"), "url password must not be exported");
assert.ok(!json.includes('"id"'), "ids are not portable");
const [back] = parseProfiles(json);
assert.equal(back.id, "");
assert.equal(back.name, "Prod");
assert.equal(back.url, "postgres://bob@db/app");
assert.deepEqual(back.ssh, conn.ssh);
assert.equal(back.read_only, true);
assert.deepEqual(back.options, { sslmode: "require" });
assert.ok(!("password" in back), "no secret fields");

const [loose] = parseProfiles(
  `{"format":"agentql-profiles","connections":[{"name":"x","driver":"mysql","color":"url(http://evil)","ssh":{"host":"b","user":"u","auth":{"key_file":{"path":"/k"}}}}]}`,
);
assert.equal(loose.color, null);
assert.deepEqual(loose.ssh, { host: "b", port: 22, user: "u", auth: { key_file: { path: "/k" } } });
assert.throws(
  () => parseProfiles(`{"format":"agentql-profiles","connections":[{"name":"x","driver":"mysql","port":70000}]}`),
  /invalid port/,
);
assert.throws(
  () => parseProfiles(`{"format":"agentql-profiles","connections":[{"name":"x","driver":"mysql","ssh":{}}]}`),
  /invalid ssh/,
);
assert.throws(() => parseProfiles("nope"), /not a JSON/);
assert.throws(() => parseProfiles('{"connections":[]}'), /not an AgentQL/);
assert.throws(
  () => parseProfiles(`{"format":"agentql-profiles","connections":[{"name":"x","driver":"oracle"}]}`),
  /unknown driver/,
);
console.log("profiles.check ok");
