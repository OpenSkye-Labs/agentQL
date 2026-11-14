# Plaintext secrets only by opt-in (PR #36)

Prompted by an outside report: when the OS keychain failed, the app saved database passwords, SSH secrets and API
keys to a plaintext `secrets.local.json`, and Settings called it "Local file". A refused save also went there while
Settings still said "OS keychain", because the fallback happened per save and the status came from a separate probe.

Plan review (before code), 3 findings, all applied:

- Migration wrote the old file value to the keychain without a lock, so a save made meanwhile could be reverted.
  Applied: one write lock for `set_secret` and each migration step, which re-checks the file still holds its
  snapshot value. A test parks migration mid-write; it fails with the lock removed.
- The "none" UI state was never exercised. Applied: the mock takes `&secrets=none|file|keychain`.
- The connection row saved before its secrets, so a refused save left a passwordless connection and every retry
  added another. Applied: `store_connection` saves secrets first.

Code review: Codex plus correctness, security, requirements and maintainability reviewers. 9 findings applied; the
first 5 each have a test that failed before the fix:

- An emptied password field sends `""`, which counted as a secret, so a connection without a password could not
  be saved on a machine with no keychain. Applied: `""` removes the secret.
- A `.corrupt` copy still holds plaintext but About said "None". Applied: `secret_storage` reports "file" while
  one exists, and an existing `.corrupt` is never replaced.
- `.mode(0o600)` only applies on create, so a leftover 0644 `.tmp` made the secrets file 0644. Applied: permissions
  are set after open, and a stale `.tmp` is removed at load.
- `?password=` in a Postgres URL was kept in `connections.json` (older than this PR). Applied: it is moved out on
  save like `user:pass@`.
- "Migration stops at the first refusal" had no test. Added, with a counting fake keychain.
- (Codex) A failed delete dropped the in-memory entry before the file write, so a retry did nothing and the secret
  came back on restart. Applied: the cache changes only after the write succeeds.
- (Codex) A failed `.corrupt` rename, or a file that couldn't be read, left the next save free to overwrite it.
  Applied: the file is never written over when it can't be read and parsed.
- Every settings save ran the keychain probe, which can block ~30 s on Linux without a Secret Service. Applied:
  only when the plaintext switch changes, or after a connection save while it is on.
- SECURITY.md said the badge always shows plaintext secrets; it rechecks only at those points. Applied: worded
  exactly, plus Windows permissions and `.corrupt` copies.

Not applied:

- Duplicate in the sidebar has no error toast. `Sidebar.tsx` is over the 20 KB limit already; it needs a split or a
  catch in the shared menu first.
- A connection's three secrets save one by one, so a refusal partway leaves a partial change.
- Migration stops at the first refusal even if only that entry is refused (too long for Windows); marked
  `shortcut:`.
- `extra_headers` on a provider can hold a key in `settings.json`; the UI can't set it today.
