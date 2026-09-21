#!/bin/sh
# The API's first minute on a host: say what is missing before anything can fail quietly,
# migrate (with patience for a database that suspends when idle), seed an empty world once,
# then serve. Every message names the thing to fix.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "daysheet: DATABASE_URL is not set. Set it to the Postgres connection string (Neon: the direct one, ?sslmode=require) and redeploy." >&2
  exit 1
fi
if [ "${#AUTH_SECRET}" -lt 16 ] 2>/dev/null; then
  echo "daysheet: AUTH_SECRET is missing or shorter than 16 characters. Set the same value the web app has, and redeploy." >&2
  exit 1
fi

# The host, never the credentials: enough to see that this is the intended database.
db_host=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://([^@/]*@)?([^/?]+).*#\2#')
echo "daysheet: migrating $db_host"

cd /repo/packages/db
attempt=1
until pnpm exec prisma migrate deploy; do
  if [ "$attempt" -ge 5 ]; then
    echo "daysheet: migrations did not apply after $attempt attempts; the database at $db_host is not reachable or refuses the credentials." >&2
    exit 1
  fi
  echo "daysheet: the database did not answer (attempt $attempt of 5); a suspended compute wakes in a moment — retrying"
  attempt=$((attempt + 1))
  sleep 5
done

node scripts/seed-if-empty.mjs

cd /repo/apps/api
exec node dist/main.js
