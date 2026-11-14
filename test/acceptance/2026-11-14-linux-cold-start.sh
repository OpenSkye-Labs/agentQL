#!/usr/bin/env bash
# Acceptance checks for .agent/plans/2026-11-14-linux-cold-start.md (criteria 1, 3, 6–10). Run from anywhere.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

cmds=(src-tauri/src/commands.rs src-tauri/src/commands/*.rs)

# 1: keychain commands are async (Tauri runs sync commands on the main thread) and use spawn_blocking.
for c in secret_storage app_info get_connection_secrets has_provider_key set_provider_key save_connection; do
  check "1 $c is async" "grep -qE '^pub async fn $c\\b' ${cmds[*]} 2>/dev/null && ! grep -qE '^pub fn $c\\b' ${cmds[*]} 2>/dev/null"
  check "1 $c uses blocking" "awk '/^pub async fn $c[(<]/{f=1} f&&/^}/{exit} f' ${cmds[*]} 2>/dev/null | grep -q 'blocking('"
done

# 2: every write of connections.json goes through the one locked update_connections (the race test covers the lock).
rs=$(find src-tauri/src -name '*.rs' ! -name config.rs | tr '\n' ' ')
check "2 one caller of save_connections" "[ \$(grep -n 'save_connections(' $rs | wc -l) -eq 1 ]"
check "2 update_connections holds a lock" "awk '/^pub fn update_connections[(<]/{f=1} f&&/^}/{exit} f' $rs | grep -q 'lock()'"
check "2 consent write uses update_connections" "grep -q 'update_connections' src-tauri/src/ai/mod.rs && ! grep -q 'save_connections' src-tauri/src/ai/mod.rs"

# 3: the split leaves every commands file under the 20000-byte commit limit, and lib.rs still registers the same names.
check "3 commands split into submodules" "ls src-tauri/src/commands/*.rs >/dev/null 2>&1"
for f in "${cmds[@]}"; do [ -f "$f" ] && check "3 $f <= 20000 bytes" "[ \$(wc -c < '$f') -le 20000 ]"; done
check "3 lib.rs registers the same command names" \
  "diff <(git show c577b97:src-tauri/src/lib.rs | grep -oE 'commands::[a-z_:]+' | sed 's/.*:://' | sort) \
        <(grep -oE 'commands::[a-z_:]+' src-tauri/src/lib.rs | sed 's/.*:://' | sort) >/dev/null"

# 6: PERFORMANCE.md names the confirmed cause instead of the guess.
check "6 PERFORMANCE.md cause confirmed" "! grep -q 'Not yet confirmed' docs/PERFORMANCE.md"
check "6 PERFORMANCE.md documents the new marks" "grep -q 'script_ms' docs/PERFORMANCE.md && grep -q 'setup_ms' docs/PERFORMANCE.md"

# 7: every README has a performance table with all three platforms and links PERFORMANCE.md.
for f in README.md README.*.md; do
  check "7 $f links docs/PERFORMANCE.md" "grep -q 'docs/PERFORMANCE.md' '$f'"
  check "7 $f has a Linux/macOS/Windows table" "grep -E '^\\|' '$f' | grep -q Linux && grep -E '^\\|' '$f' | grep -q macOS && grep -E '^\\|' '$f' | grep -q Windows"
  check "7 $f table has times and memory" "grep -E '^\\|.*Windows' '$f' | grep -E -q '[0-9] ?ms.*[0-9] ?MB|[0-9] ?MB.*[0-9] ?ms'"
done

# 8: FEATURES.md split, nothing lost.
check "8 FEATURES.md <= 12000 bytes" "[ \$(wc -c < docs/FEATURES.md) -le 12000 ]"
check "8 FEATURES.md links the archive" "grep -q 'features/2026-10.md' docs/FEATURES.md"
check "8 no line from c577b97 lost" "! git show c577b97:docs/FEATURES.md | grep -v '^\$' | grep -vxFf <(cat docs/FEATURES.md docs/features/*.md 2>/dev/null) | grep -q ."

# 9, 10: review index and task board.
check "9 REVIEWS.md indexes #35" "grep -q 'reviews/0035-m9-perf-bench.md' docs/REVIEWS.md"
check "10 Linux cold-start task checked" "grep -E '^- \\[x\\].*Linux' docs/TASKS.md | grep -Eqi 'cold start|first frame|D-Bus'"
check "10 README numbers task checked" "grep -qE '^- \\[x\\].*numbers.*README' docs/TASKS.md"

exit $fail
