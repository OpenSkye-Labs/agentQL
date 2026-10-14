# Structure tab edits as reviewable DDL (PR #25)

Codex round 1 (`codex exec review --uncommitted`): 4 findings, all applied.

- P1: MySQL `CHANGE`/`MODIFY` dropped `ON UPDATE …` and `COMMENT` because the definition was rebuilt from the
  dialog fields only — applied (superseded in round 2, see below).
- P2: MySQL `RENAME TABLE a.t TO t2` resolves `t2` in the _current_ database, so a rename in another schema moved
  the table — applied: the destination is qualified with the original schema.
- P2: Postgres `ALTER COLUMN … TYPE` fails when the old default cannot be cast, even with `USING` — applied: the
  default is dropped before the type change and the requested default set after it.
- P2: the dialog normalised the default with `trim() || null`, so an empty or padded MySQL `DEFAULT ''` was silently
  lost on an unrelated edit — applied: a "Has default" switch distinguishes no default from an empty string and the
  value is kept verbatim.

Codex round 2: 4 findings, all applied.

- P1: even with ON UPDATE / COMMENT re-emitted, MySQL `CHANGE`/`MODIFY` resets charset, collation and anything else
  not introspected — applied: renames use `RENAME COLUMN` and default-only changes use `ALTER COLUMN SET/DROP
  DEFAULT` (both keep every other attribute; MySQL 8.0 / MariaDB 10.5+). Only a type or nullability change still
  needs `MODIFY`, and that statement is preceded by a comment saying what falls back to the table defaults.
- P2: stripping `extra` before classifying the default turned an unchanged MySQL 8 expression default
  (`DEFAULT (rand())`) into the string `'(rand())'` — applied: the `DEFAULT_GENERATED` flag is kept when the default
  is unchanged, expression defaults are emitted in parentheses (also fixes the schema-diff migration output, which
  printed `DEFAULT uuid()` without them), and a user can mark a new default as an expression by wrapping it in
  parentheses.
- P2: `DROP INDEX` on a Postgres UNIQUE-constraint index or a SQLite autoindex cannot work — applied: SQLite
  `sqlite_autoindex_*` entries generate a rebuild note; Postgres unique indexes carry the `DROP CONSTRAINT`
  alternative as a comment above the `DROP INDEX` (whether the index is constraint-backed is not introspected,
  `ponytail:` in `dropIndexSql`).
- P2: SQLite `CREATE INDEX "aux"."i" ON "aux"."t"` is invalid: the schema belongs on the index name, the table must be
  bare — applied: `addIndexSql` takes schema and table separately and emits SQLite's form.

Claude Code security plugin (automated, between rounds): the "parentheses mean expression" rule from round 2 also
applied to introspected MySQL defaults, so a schema-diff migration would have emitted a string default such as
`(1); DROP TABLE t; -- (` from the source database verbatim — applied: the rule now only applies to a value typed
in the column dialog (`typed` flag on `columnDef` / `defaultSql`); introspected defaults keep the strict allow-list.
The suggested `;` / newline rejection was not added: the typed value is the user's own SQL and lands in a query
tab they review before running.

Codex round 3: 2 findings, both applied.

- P2: MariaDB 10.2.7+ reports `COLUMN_DEFAULT` as SQL (`'active'`, `current_timestamp()`), so the MySQL quoting
  path turned an unchanged default into `'''active'''` on a type change — applied: the `mariadb` driver emits
  introspected defaults verbatim (like Postgres); only `mysql` goes through the quote/allow-list branch
  (`ponytail:` note for pre-10.2.7 servers). The MariaDB dialog hint changed accordingly.
- P2: generated MySQL literals only doubled apostrophes, so a default or comment containing a backslash was
  mis-escaped — applied: defaults and the re-emitted `COMMENT` go through `sqlLiteral`, which already escapes
  backslashes for MySQL/MariaDB.

Codex round 4: 1 finding, applied.

- P2: SQLite targets in `main` were emitted unqualified, so a temp table of the same name (SQLite connections
  share one pooled connection) would be the one dropped, altered or renamed — applied: `qualifiedName` always
  emits `"main"."t"`; `CREATE INDEX` keeps the schema on the index name and the table bare, as SQLite requires.
