# Prefer IPv4 for localhost (PR #20)

Codex round 1 (`codex exec review --uncommitted`):

- P1 `verify-full` certificates are issued for the hostname, so rewriting to an IP breaks TLS verification — applied: the rewrite is skipped under verify-full.
- P2 IPv6-only local servers would become unreachable — skipped: rare, and the fix for it (retry with the original name on refusal) is named in the ponytail comment.
