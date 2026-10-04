#!/usr/bin/env bash
# One-shot data move after the SMLGateway → BCAiRouter rebrand.
# Old stack: compose project "sml-gateway", volume sml-gateway_sml-gateway-pg, db smlgateway / user sml.
# New stack: compose project "bcai-router", db bcairouter / user bcai (fresh volume).
# The old volume is left untouched for rollback. Redis is cache/state only — not migrated.
#
# Usage (run from repo root). Stop the old stack first — after the rename a plain `docker compose down`
# targets bcai-router, NOT the old project:  docker compose -p sml-gateway stop   (never -v)
#   bash scripts/migrate-from-smlgateway.sh
#   COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml" bash scripts/migrate-from-smlgateway.sh   # droplet
# Droplet: move the deploy dir first (mv /opt/sml-gateway /opt/bcai-router).
# Note: issued sml_live_* client keys stop working (new prefix bcai_live_) — reissue at /admin/keys.
set -euo pipefail

COMPOSE="${COMPOSE:-docker compose}"
OLD_VOLUME="${OLD_VOLUME:-sml-gateway_sml-gateway-pg}"
TMP=smlgw-migrate-old-pg

docker volume inspect "$OLD_VOLUME" >/dev/null 2>&1 || { echo "old volume $OLD_VOLUME not found — nothing to migrate"; exit 0; }

# a second postmaster on a live data dir corrupts it (separate PID/IPC namespaces defeat postgres lock checks)
if [ -n "$(docker ps -q --filter volume="$OLD_VOLUME")" ]; then
  echo "old stack still running on $OLD_VOLUME — stop it first: docker compose -p sml-gateway stop"; exit 1
fi

cleanup() { docker rm -f "$TMP" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "[1/4] start old postgres on $OLD_VOLUME (temp container, no host port)"
docker run -d --name "$TMP" -v "$OLD_VOLUME":/var/lib/postgresql/data pgvector/pgvector:pg17 >/dev/null
wait_ready() { for _ in $(seq 1 60); do docker exec "$1" pg_isready -U "$2" -d "$3" >/dev/null 2>&1 && return 0; sleep 1; done; echo "postgres in $1 not ready after 60s"; exit 1; }
wait_ready "$TMP" sml smlgateway

echo "[2/4] start new postgres"
$COMPOSE up -d postgres
NEW=$($COMPOSE ps -q postgres) # docker exec, not compose exec — compose exec needs .env.local for every service
wait_ready "$NEW" bcai bcairouter

existing=$(docker exec "$NEW" psql -U bcai -d bcairouter -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
if [ "$existing" != "0" ]; then
  echo "new db already has $existing tables — refusing to overwrite (drop the bcai-router pg volume first if that is intended)"
  exit 1
fi

echo "[3/4] dump smlgateway → restore bcairouter"
docker exec "$TMP" pg_dump -U sml -d smlgateway --no-owner --no-privileges \
  | docker exec -i "$NEW" psql -q -U bcai -d bcairouter -v ON_ERROR_STOP=1 >/dev/null

echo "[4/4] verify row counts"
old=$(docker exec "$TMP" psql -U sml -d smlgateway -tAc "SELECT count(*) FROM pg_stat_user_tables")
new=$(docker exec "$NEW" psql -U bcai -d bcairouter -tAc "SELECT count(*) FROM pg_stat_user_tables")
echo "tables old=$old new=$new"
[ "$old" = "$new" ] || { echo "table count mismatch"; exit 1; }
for t in $(docker exec "$TMP" psql -U sml -d smlgateway -tAc "SELECT relname FROM pg_stat_user_tables ORDER BY relname"); do
  a=$(docker exec "$TMP" psql -U sml -d smlgateway -tAc "SELECT count(*) FROM \"$t\"")
  b=$(docker exec "$NEW" psql -U bcai -d bcairouter -tAc "SELECT count(*) FROM \"$t\"")
  [ "$a" = "$b" ] || { echo "row mismatch $t old=$a new=$b"; exit 1; }
done
echo "done — all row counts match. Old volume $OLD_VOLUME kept for rollback."
