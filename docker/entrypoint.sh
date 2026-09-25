#!/bin/sh
set -e
echo "[raptorforge] waiting for database…"
until pg_isready -h db -U postgres -d raptorforge >/dev/null 2>&1; do
  sleep 1
done
echo "[raptorforge] applying migrations…"
npx prisma migrate deploy
echo "[raptorforge] seeding demo data…"
npx prisma db seed || true
echo "[raptorforge] starting server…"
exec node_modules/.bin/next start -p 3000
