# Feature log

Append-only record of shipped behaviour. Newest at the bottom.
A month moves to `docs/features/<yyyy-mm>.md` once this file nears the 20 KB commit limit.

Earlier entries: [October 2026](features/2026-10.md).

## 2026-11-14

- Bench mode (M9): `AGENTQL_BENCH`, `scripts/perf/bench-app.mjs` and the Perf workflow. docs/PERFORMANCE.md.
- Secrets go to the plaintext `secrets.local.json` only with the new `allow_plaintext_secrets` setting (off by
  default); a refused keychain save now fails with a pointer to it. Existing file entries move to the keychain
  at startup. Status bar and About say "plaintext" / "no keychain". SECURITY.md documents it.
