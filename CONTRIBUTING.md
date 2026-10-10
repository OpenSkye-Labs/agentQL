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

- `dev` is the default branch and where day-to-day work lands. `main` is the release branch and only moves by a pull request from `dev`.
- Both branches are protected. Nobody pushes to them directly; every change lands through a pull request with a passing CI run and a maintainer approval.
- Branch from `dev`: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, and open your PR against `dev`. Fork the repo if you don't have write access.
- Keep PRs focused on one change. Squash-merge is the only merge method, so the PR title becomes the commit message. Write it as `type: short imperative summary` (`feat: redis TTL column`, `fix: grid scroll jump on sort`).
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

Versions follow [semantic versioning](https://semver.org) and are managed by [release-please](https://github.com/googleapis/release-please). Nobody edits version numbers by hand.

1. PR titles use [conventional commits](https://www.conventionalcommits.org): `feat:` bumps the minor version, `fix:` the patch, `feat!:` or a `BREAKING CHANGE:` footer the minor while we are pre-1.0. Other types (`chore:`, `docs:`, `ci:`, `refactor:`) do not trigger a release.
2. Feature PRs are squash-merged into `dev`. When `dev` is ready to ship, a maintainer opens a PR from `dev` into `main` and merges it with a **merge commit** so the individual titles survive.
3. release-please then opens a release PR against `main` that bumps `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` and updates `CHANGELOG.md`.
4. Merging the release PR creates the `vX.Y.Z` tag and GitHub Release and starts the installer build for macOS (Apple Silicon and Intel), Linux and Windows. Assets appear on the release a few minutes later.

`pnpm version:check` fails CI if the three version files ever disagree.

## Reporting bugs and proposing features

Open an issue with the steps to reproduce, the database engine and version, your OS, and the AgentQL version from the About screen. For larger features, open an issue first so we can agree on the approach before you spend time on it.
