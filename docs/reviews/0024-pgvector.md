# pgvector decoding, index methods and agent guide (PR #24)

Codex round 1 (`codex exec review --uncommitted`): no actionable findings. (The live probe was run locally against
`pgvector/pgvector:pg16`: decoded rows, k-NN ordering, hnsw index definition and a `'[…]'` UPDATE all checked.)

CodeRabbit round 1:

- Minor: the guide recommended `<+>` (L1) unconditionally, but pgvector < 0.7 has no such operator — applied:
  marked "pgvector 0.7+ only" in the guide.
- Minor: the index method was read by `split_once(" USING ")` on `pg_get_indexdef`, which a quoted index name
  containing " USING " could fool — applied: `IndexInfo.method` now comes from `pg_am.amname`; the opclass/WITH
  tail is taken from the definition anchored on `USING <method> (`. Live probe rerun.

CodeRabbit round 2:

- Minor: the anchored `find(" USING <method> (")` could still match inside a quoted index name — applied: opclasses
  (`pg_index.indclass` → `pg_opclass`) and storage options (`pg_class.reloptions`) are catalog fields on
  `IndexInfo`; describe_table builds the line from fields only, no definition text is parsed. Probe asserts all three.
