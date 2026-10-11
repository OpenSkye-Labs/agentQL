# M8 query versions / portable profiles (PR #6)

Review rounds for PR #6. Moved from docs/REVIEWS.md per ADR-0003.

## 2026-10-11 — M8 query versions / portable profiles (Codex, `codex exec review --uncommitted`)

Round 1: 1 finding, addressed. Round 2 (after the panel fixes below): no findings.

| #   | Sev | Finding                                                                                                         | Resolution                                                                                           |
| --- | --- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | P2  | `stripUrlPassword` treated an `@` inside the query string as the userinfo separator (`…?appName=a@b` corrupted) | Authority bounded at the first `/`, `?` or `#` before looking for userinfo; cases added to the check |

Reviewer panel (correctness / security / requirements / skeptic, read-only agents on the same diff), 0 blockers:

| #   | Sev  | Finding                                                                                    | Resolution                                                                                                            |
| --- | ---- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1   | high | A `.sql` written with a UTF-8 BOM loads invisibly broken; UTF-16 surfaces a raw io error   | BOM stripped on read; non-UTF-8 mapped to a plain message                                                             |
| 2   | med  | Import saved profiles one by one; a bad entry mid-file left earlier ones imported silently | All entries validated before any save (port, ssh shape); toast reports "imported N of M"; list refreshed in `finally` |
| 3   | med  | Imported `color` is rendered as inline CSS                                                 | Only hex colours accepted                                                                                             |
| 4   | med  | `read_text_file` / `write_text_file` take any path the webview sends                       | Kept (same shape as `export_rows`, first-party webview); `ponytail:` comment names the dialog-gated allowlist upgrade |
| 5   | low  | Sync file commands ran on the main thread                                                  | Made `async` like `export_rows`                                                                                       |
| 6   | low  | "Open .sql file…" replaced unsaved editor text                                             | Opens in a new tab when the editor is non-empty                                                                       |
| 7   | low  | Saving a file-bound tab as a named query dropped the file binding                          | Bindings are independent; Mod+S prefers the file                                                                      |
| 8   | low  | Version logic had no runnable check                                                        | Extracted to `src/lib/queries.ts` with `queries.check.ts` in `pnpm check`                                             |
| 9   | low  | Mod+S outside the editor falls through to the webview default; `write` is not tmp+rename   | Skipped: pre-existing behaviour, same as `export_rows`                                                                |

CodeRabbit on PR #6, round 1: 10 comments, all addressed (table below). Codex round 3 on those fixes: 3 findings,
addressed: unique per-save temp file name (pid + nanos, removed on a failed rename); destination permissions copied
onto the temp file before the rename; `saveQuery` rolls back its optimistic state when `kvSet` rejects, unless a
newer save already landed. Codex round 4: 2 findings on the same write path, addressed: the destination symlink is
resolved first so the target gets the text; the temp file is created `create_new` with mode 0600 (Unix) before any
bytes are written, then takes the destination's mode and is removed on any failure. Codex round 5: 1 finding
skipped (a dangling symlink picked in the save dialog would be replaced by a regular file; not a realistic flow for
`.sql` files chosen in a native dialog, and the ceiling is noted in the function's comment).

| #   | Sev   | Finding                                                                           | Resolution                                                                                                                       |
| --- | ----- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | major | File commands did blocking fs work on the async runtime                           | Both run through `spawn_blocking`                                                                                                |
| 2   | major | Saving over an existing `.sql` truncated it before writing                        | Write `<path>.tmp` then rename                                                                                                   |
| 3   | major | Mongo `authMechanismProperties=AWS_SESSION_TOKEN:…` survived in exported URLs     | `stripUrlSecrets` drops credential-bearing query params (password/pwd/token/secret/authMechanismProperties) on export and import |
| 4   | major | Two tabs saving the same query could lose a version (state set after `kvSet`)     | State updated synchronously first, then persisted                                                                                |
| 5   | minor | Dialog rejections in QueryTab / Sidebar escaped the `try`                         | Dialog calls moved inside the `try` blocks                                                                                       |
| 6   | minor | `refreshConnections` failure in `finally` rejected the import handler silently    | Caught and toasted                                                                                                               |
| 7   | minor | Mod+S only worked with editor focus; `cbs.current` written during render          | Shortcut moved to the global handler in App.tsx (dispatches `agentql:save` to the active query tab); SqlEditor change reverted   |
| 8   | minor | Versions dialog said "Save keeps it" but Mod+S saves the file in a file-bound tab | Text now points at Saved › Save                                                                                                  |

CodeRabbit on PR #6, round 2: 0 new comments; one follow-up on the `saveQuery` rollback (two overlapping failed
saves could leave an unpersisted list in the store). Addressed: saved-query writes (save and delete) now go
through one promise queue in `src/lib/store.ts`, each starting from the state the previous write left and rolling
back to the last persisted list on failure.
