# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private reporting at
<https://github.com/OpenSkye-Labs/agentQL/security/advisories/new> instead. You will get an acknowledgement
within a few days and a fix or a mitigation plan as soon as the issue is confirmed.

## Scope

AgentQL handles database credentials, SSH keys and LLM API keys, so we care most about:

- credential storage and the keychain fallback file
- SSH tunnel and host-key handling
- the read-only and write-approval guarantees around what the assistant can execute
- the local MCP endpoint used by the Claude Code and Codex CLIs
- the update mechanism and release signing

## Supported versions

Only the latest release receives fixes. Update from the status bar or from the
[releases page](https://github.com/OpenSkye-Labs/agentQL/releases/latest).
