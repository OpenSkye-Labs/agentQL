# ADR-0003: Review logs are one file per PR

Date: 2026-10-11 · Status: accepted, applied once PRs #8–#10 are merged

## Context

Five roadmap milestones were built in parallel by five agents in separate worktrees. Their code barely
overlapped, yet every merge into `dev` made the remaining PRs conflict, twelve conflict rounds in one day. Every
single conflict was in the three append-only logs (`docs/REVIEWS.md`, `docs/FEATURES.md`, `docs/TASKS.md`),
because each branch appended at the same end of the same file.

## Decision

- Review rounds are recorded in `docs/reviews/<pr-number>-<slug>.md`, one file per PR. `docs/REVIEWS.md` keeps
  the pre-PR history and an index line per file.
- `docs/FEATURES.md` stays a single log, but entries are one line each so merges are trivial; `docs/TASKS.md`
  checkboxes are ticked in place, never reordered.
- Worker briefs tell agents to resolve log conflicts by keeping both sides, so if a conflict still happens it is
  mechanical.

## Consequences

- Parallel PRs no longer conflict on review logs at all.
- Reading all reviews means opening a directory instead of one file; the index in `REVIEWS.md` mitigates that.
