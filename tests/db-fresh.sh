#!/usr/bin/env bash
# Stand up a clean database for testing and apply supabase/schema.sql to it.
#
#   ./tests/db-fresh.sh                 throwaway local Postgres (default)
#   ./tests/db-fresh.sh "$DATABASE_URL" an existing database you point it at
#
# It only ever CREATES; it never drops your tables. To wipe the rows as well,
# add --reset, which truncates club_data and nothing else.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA="$ROOT/supabase/schema.sql"
RESET=""
TARGET=""
STOP=""
for a in "$@"; do
  case "$a" in
    --reset) RESET=1 ;;
    --stop)  STOP=1 ;;
    *) TARGET="$a" ;;
  esac
done

PGBIN_EARLY=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
if [ -n "$STOP" ]; then
  AS_USER=""; [ "$(id -u)" = "0" ] && AS_USER=${PGT_USER:-pgrunner}
  D=${PGT_DATA:-/tmp/acdb/data}
  if [ -n "$AS_USER" ]; then su "$AS_USER" -c "$PGBIN_EARLY/pg_ctl -D $D stop"; else "$PGBIN_EARLY/pg_ctl" -D "$D" stop; fi
  exit 0
fi

if [ -n "$TARGET" ]; then
  echo "→ applying schema to the database you supplied"
  [ -n "$RESET" ] && psql "$TARGET" -q -c 'truncate table public.club_data;' \
    && echo "  club_data truncated"
  psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$SCHEMA" >/dev/null
  echo "✓ schema applied"
  psql "$TARGET" -c 'select count(*) as rows from public.club_data;'
  exit 0
fi

# ---- throwaway local cluster -------------------------------------------------
PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
if [ -z "$PGBIN" ]; then
  echo "No local Postgres server found. Install it, or pass a connection string:" >&2
  echo "  ./tests/db-fresh.sh 'postgresql://user:pass@host:5432/db'" >&2
  exit 1
fi

DATA=${PGT_DATA:-/tmp/acdb/data}
SOCK=${PGT_SOCK:-/tmp/acdb/sock}      # socket paths have a ~107 byte limit
PORT=${PGT_PORT:-55432}

# Postgres refuses to run as root, so drop to an unprivileged user if we are one.
AS_USER=""
if [ "$(id -u)" = "0" ]; then
  AS_USER=${PGT_USER:-pgrunner}
  id -u "$AS_USER" >/dev/null 2>&1 || useradd -m "$AS_USER"
fi
run() { if [ -n "$AS_USER" ]; then su "$AS_USER" -c "$*"; else sh -c "$*"; fi; }

run "$PGBIN/pg_ctl -D $DATA stop" >/dev/null 2>&1 || true
rm -rf "$DATA" "$SOCK"; mkdir -p "$DATA" "$SOCK"
[ -n "$AS_USER" ] && chown -R "$AS_USER" "$DATA" "$SOCK"

run "$PGBIN/initdb -D $DATA -U postgres --auth=trust" >/dev/null
run "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k $SOCK -c listen_addresses=' -l $SOCK/pg.log start" >/dev/null
sleep 1

psql -h "$SOCK" -p "$PORT" -U postgres -q -c "create role anon nologin;"
psql -h "$SOCK" -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 -f "$SCHEMA" >/dev/null

cat <<MSG
✓ fresh Postgres running, schema applied

  socket   $SOCK
  port     $PORT
  psql     psql -h $SOCK -p $PORT -U postgres

  run the sync suite against it:
    SYNC_TEST_PG=1 PGHOST=$SOCK PGPORT=$PORT npm test

  stop it:
    ./tests/db-fresh.sh --stop
MSG
