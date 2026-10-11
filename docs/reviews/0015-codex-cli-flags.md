# Codex CLI provider flags (PR #15)

Codex round 1 (`codex exec review --uncommitted`): no actionable regressions. Codex confirmed both CLI paths accept the config overrides and that database writes remain behind the in-app approval flow.

CodeRabbit round 1: approval_policy=never alone does not auto-approve MCP tools under a read-only sandbox; added the per-server default_tools_approval_mode on the agentql server (verified under strict config).
