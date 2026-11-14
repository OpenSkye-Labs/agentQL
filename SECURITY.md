# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private reporting at
<https://github.com/OpenSkye-Labs/agentQL/security/advisories/new> instead. You will get an acknowledgement
within a few days and a fix or a mitigation plan as soon as the issue is confirmed.

## Scope

AgentQL handles database credentials, SSH keys and LLM API keys, so we care most about:

- credential storage, including the opt-in plaintext secrets file
- SSH tunnel and host-key handling
- the read-only and write-approval guarantees around what the assistant can execute
- the local MCP endpoint used by the Claude Code and Codex CLIs
- the update mechanism and release signing

## How secrets are stored

Database passwords, SSH passwords and key passphrases, and LLM API keys go to the OS keychain (macOS
Keychain, Windows Credential Manager, the Secret Service on Linux). They never go into `connections.json` or
`settings.json`.

If the keychain refuses a secret (WSL, a headless Linux box, a locked keychain), the save fails. AgentQL writes
it to `secrets.local.json` in the app data directory only if you turn on Settings > General > "Store secrets in
a plaintext file when no keychain is available". That file is not encrypted; on macOS and Linux only your user
can read it (0600). The status bar shows "plaintext secrets" while any secret is in it, and AgentQL moves its
entries into the keychain on the next start where the keychain works.

Versions up to and including 0.3.0 wrote to this file without asking whenever the keychain refused a secret.

## Supported versions

Only the latest release receives fixes. Update from the status bar or from the
[releases page](https://github.com/OpenSkye-Labs/agentQL/releases/latest).
