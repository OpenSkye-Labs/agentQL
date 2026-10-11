\pset format aligned
SELECT 'title_basics' AS t, count(*) FROM imdb.title_basics
UNION ALL SELECT 'title_ratings', count(*) FROM imdb.title_ratings
UNION ALL SELECT 'name_basics', count(*) FROM imdb.name_basics
UNION ALL SELECT 'title_principals', count(*) FROM imdb.title_principals
UNION ALL SELECT 'pgbench_accounts', count(*) FROM public.pgbench_accounts;
SELECT pg_size_pretty(pg_database_size('perf')) AS database_size;
SELECT conname, conrelid::regclass FROM pg_constraint WHERE contype = 'f' AND connamespace = 'imdb'::regnamespace;
SELECT indexrelid::regclass FROM pg_index WHERE indrelid IN ('imdb.title_principals'::regclass, 'imdb.title_basics'::regclass, 'imdb.name_basics'::regclass);
