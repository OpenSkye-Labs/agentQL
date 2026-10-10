# Contributing to AgentQL

Thanks for helping out. This page is the whole workflow; `CLAUDE.md` has the architecture overview and `docs/` has the plans and feature log.

## Setup

Prerequisites: Node 22, pnpm 10, Rust stable, and the [Tauri 2 system deps](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
pnpm install
pnpm tauri dev          # desktop app (vite + cargo)
pnpm dev                # browser-only UI with sample data: open http://localhost:1420/?mock=1
```

## Branches and pull requests

- `main` is protected. Nobody pushes to it directly; every change lands through a pull request with a passing CI run and a maintainer approval.
- Branch from `main`: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`. Fork the repo if you don't have write access.
- Keep PRs focused on one change. Squash-merge is the only merge method, so the PR title becomes the commit message on `main`. Write it as `type: short imperative summary` (`feat: redis TTL column`, `fix: grid scroll jump on sort`).
- Fill in the PR template. Say what changed and how you verified it, and attach a screenshot for UI changes.
- Record notable behaviour in `docs/FEATURES.md` as part of the same PR.

## Checks

CI only runs the jobs for the stack you touched (frontend under `src/`, Rust under `src-tauri/`). Run the same checks locally before pushing:

```bash
# frontend
pnpm format            # oxfmt, writes
pnpm lint              # oxlint
pnpm typecheck         # tsc --noEmit
pnpm check             # SQL helper self-check
pnpm build

# rust (from src-tauri/)
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test
cargo test --test live -- --ignored   # optional, needs the Docker databases
```

`pnpm version:check` guards that `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` agree on the version.

## Code conventions

- Rust commands return `Result<T, AppError>`; `AppError` serialises to a plain string for the UI.
- Query results are driver-agnostic `QueryResult { columns, rows }`. Binary values are `{ "$bytes": base64, "len": n }`.
- Secrets never go into `connections.json`; they live in the OS keychain.
- Anything the agent does that writes to a database goes through the in-app approval flow.
- Prefer the smallest change that works. Mark deliberate simplifications with a `ponytail:` comment naming the ceiling and the upgrade path.

## Versioning and releases

AgentQL uses [semantic versioning](https://semver.org) with `v`-prefixed tags. Maintainers cut a release like this:

```bash
pnpm version:set 0.2.0                 # updates package.json, tauri.conf.json, Cargo.toml, Cargo.lock
git commit -am "chore: release v0.2.0" # open a PR, merge it
git tag v0.2.0 && git push origin v0.2.0
```

Pushing the tag builds installers for macOS (Apple Silicon and Intel), Linux and Windows and attaches them to a draft GitHub Release with auto-generated notes. A maintainer reviews the draft and publishes it.

## Reporting bugs and proposing features

Open an issue with the steps to reproduce, the database engine and version, your OS, and the AgentQL version from the About screen. For larger features, open an issue first so we can agree on the approach before you spend time on it.
