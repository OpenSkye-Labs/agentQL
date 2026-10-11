# Review log — PR #16: themes (Follow system under WebKitGTK, named themes)

Each round: reviewer, findings, resolution. Raw Codex output under `.agent/` (git-ignored).

## 2026-10-11 — Codex round 1 (`codex exec review --uncommitted`, the fix)

Scope: `system_theme` command (`os_theme.rs`), `applyTheme` seq guard and focus re-check, per-theme token blocks with
`--syn-*` tokens, `themes.check.ts`.

No actionable findings. Codex ran `pnpm check` and `pnpm typecheck`; native compilation was verified separately
(`cargo clippy --all-targets -D warnings`, `cargo test`).

## 2026-10-11 — Codex round 2 (`codex exec review --uncommitted`, the named themes)

No actionable findings: every block defines the full token set and passes the WCAG AA pairs in `pnpm check`.

## 2026-10-11 — CodeRabbit on PR #16, round 1

2 comments, addressed:

| #   | Sev   | Finding                                                                | Resolution                                                                                              |
| --- | ----- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | minor | Solarized Light syntax colours below 4.5:1 on the editor surface       | Darkened (same hue); also fixed light, Solarized Dark and Nord syntax colours that failed the new check |
| 2   | minor | `themes.check.ts` did not check syntax text against the editor surface | `PAIRS` covers all four `--syn-*` tokens on `--bg-elev` (the CodeMirror background); mutation-tested    |

## 2026-10-11 — Codex round 3 (`codex exec review --uncommitted`, the contrast fix)

No actionable findings.
