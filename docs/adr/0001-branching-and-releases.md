# ADR-0001: Branching model and automated releases

Date: 2026-10-11 · Status: accepted

## Context

AgentQL went public under OpenSkye-Labs with one maintainer and parallel AI agents contributing. We need
protection against direct pushes, a release cadence that does not depend on remembering to bump three version
files, and installers built from CI only.

## Decision

- `dev` is the default and integration branch. Feature branches are squash-merged into it through PRs, so each PR
  title becomes one conventional commit.
- `main` is the release branch. It moves only by a merge-commit PR from `dev`, so the individual conventional
  commits survive for the changelog.
- Both branches are protected by one ruleset: PR required, code-owner review, `ci-ok` status, no force-push or
  deletion. Repo admins bypass, which is the maintainer merging their own PRs.
- release-please runs on pushes to `main`, opens a release PR that bumps `package.json`, `tauri.conf.json`,
  `Cargo.toml` and `CHANGELOG.md`, and on merge tags `vX.Y.Z`, creates the GitHub Release and dispatches the
  installer workflow (`workflow_dispatch`, because tags created by the workflow token do not trigger workflows).
- CI runs only the stack a change touches, with a single `ci-ok` gate so skipped jobs still satisfy protection.
  `cargo check` additionally runs on Windows and macOS because the v0.1.0 Windows build broke on a Unix-only API.

## Consequences

- Nobody edits versions by hand; `pnpm version:check` guards consistency.
- Release PRs come from a bot, so CI does not run on them unless a `RELEASE_PLEASE_TOKEN` PAT is configured.
  In that mode the maintainer checks out the release branch and runs `pnpm version:check` before merging via
  bypass, since the `versions` job never saw the PR's version edits. The preceding `dev` → `main` PR must be green.
- Squash on `dev` means review-fix commits disappear from history, which is intended.
