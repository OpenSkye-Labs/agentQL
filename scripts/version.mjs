// Fails if package.json, tauri.conf.json and Cargo.toml disagree on the version. release-please bumps them.
import { readFileSync } from "node:fs";

const versions = {
  "package.json": JSON.parse(readFileSync("package.json", "utf8")).version,
  "src-tauri/tauri.conf.json": JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version,
  "src-tauri/Cargo.toml": readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version = "([^"]+)"/m)[1],
};

if (new Set(Object.values(versions)).size !== 1) {
  console.error("Version mismatch:", versions);
  process.exit(1);
}
console.log(`version ${versions["package.json"]} is consistent`);
