#!/usr/bin/env bash
# Load the IMDb public dataset (https://datasets.imdbws.com) into the agentql-perf-pg container, schema "imdb".
set -euo pipefail
D=${IMDB_DIR:-$HOME/datasets/imdb}
PSQL=(${DOCKER:-docker} exec -i agentql-perf-pg psql -U postgres -d perf -v ON_ERROR_STOP=1 -q)
t0=$(date +%s)

"${PSQL[@]}" <<'SQL'
DROP SCHEMA IF EXISTS imdb CASCADE;
CREATE SCHEMA imdb;
CREATE TABLE imdb.title_basics (
  tconst text PRIMARY KEY, title_type text, primary_title text, original_title text,
  is_adult int, start_year int, end_year int, runtime_minutes int, genres text);
CREATE TABLE imdb.title_ratings (tconst text PRIMARY KEY, average_rating numeric(3,1), num_votes int);
CREATE TABLE imdb.name_basics (
  nconst text PRIMARY KEY, primary_name text, birth_year int, death_year int,
  primary_profession text, known_for_titles text);
CREATE TABLE imdb.title_principals (
  tconst text, ordering int, nconst text, category text, job text, characters text);
SQL

load() { # file table
  echo "loading $2 from $1"
  gzip -dc "$D/$1" | "${PSQL[@]}" -c "\\copy imdb.$2 FROM STDIN WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N', HEADER)"
  echo "  done at $(( $(date +%s) - t0 ))s"
}
load title.basics.tsv.gz title_basics
load title.ratings.tsv.gz title_ratings
load name.basics.tsv.gz name_basics
load title.principals.tsv.gz title_principals

echo "indexes + foreign keys"
"${PSQL[@]}" <<'SQL'
CREATE INDEX ON imdb.title_principals (tconst);
CREATE INDEX ON imdb.title_principals (nconst);
CREATE INDEX ON imdb.title_basics (start_year);
CREATE INDEX ON imdb.title_basics (title_type);
CREATE INDEX ON imdb.name_basics (primary_name);
ALTER TABLE imdb.title_principals ADD CONSTRAINT fk_principals_title FOREIGN KEY (tconst) REFERENCES imdb.title_basics (tconst) NOT VALID;
ALTER TABLE imdb.title_principals ADD CONSTRAINT fk_principals_name  FOREIGN KEY (nconst) REFERENCES imdb.name_basics (nconst) NOT VALID;
ALTER TABLE imdb.title_ratings    ADD CONSTRAINT fk_ratings_title    FOREIGN KEY (tconst) REFERENCES imdb.title_basics (tconst) NOT VALID;
ANALYZE imdb.title_basics; ANALYZE imdb.title_ratings; ANALYZE imdb.name_basics; ANALYZE imdb.title_principals;
SQL

"${PSQL[@]}" -At <<'SQL'
SELECT 'title_basics', count(*) FROM imdb.title_basics
UNION ALL SELECT 'title_ratings', count(*) FROM imdb.title_ratings
UNION ALL SELECT 'name_basics', count(*) FROM imdb.name_basics
UNION ALL SELECT 'title_principals', count(*) FROM imdb.title_principals
UNION ALL SELECT 'database size', pg_size_pretty(pg_database_size('perf'));
SQL
echo "total $(( $(date +%s) - t0 ))s"
