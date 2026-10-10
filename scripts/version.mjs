// Single source of truth for the app version across package.json, tauri.conf.json and Cargo.toml.
//   pnpm version:check          fail if the three files disagree
//   pnpm version:set 1.2.3      write 1.2.3 to all three (then run `cargo update -p agentql` is done for you)
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const files = {
  "package.json": {
    read: (s) => JSON.parse(s).version,
    write: (s, v) => s.replace(/"version": "[^"]+"/, `"version": "${v}"`),
  },
  "src-tauri/tauri.conf.json": {
    read: (s) => JSON.parse(s).version,
    write: (s, v) => s.replace(/"version": "[^"]+"/, `"version": "${v}"`),
  },
  "src-tauri/Cargo.toml": {
    read: (s) => s.match(/^version = "([^"]+)"/m)[1],
    write: (s, v) => s.replace(/^version = "[^"]+"/m, `version = "${v}"`),
  },
};

const [cmd, version] = process.argv.slice(2);
const current = Object.fromEntries(Object.entries(files).map(([f, { read }]) => [f, read(readFileSync(f, "utf8"))]));

if (cmd === "check") {
  const versions = new Set(Object.values(current));
  if (versions.size !== 1) {
    console.error("Version mismatch:", current);
    process.exit(1);
  }
  console.log(`version ${[...versions][0]} is consistent`);
} else if (cmd === "set" && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
  for (const [f, { write }] of Object.entries(files)) writeFileSync(f, write(readFileSync(f, "utf8"), version));
  execSync("cargo update -p agentql --offline", { cwd: "src-tauri", stdio: "inherit" });
  console.log(`set version ${version} in ${Object.keys(files).join(", ")} and Cargo.lock`);
} else {
  console.error("usage: node scripts/version.mjs check | set X.Y.Z");
  process.exit(2);
}
