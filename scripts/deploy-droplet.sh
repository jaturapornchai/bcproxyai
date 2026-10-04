#!/usr/bin/env bash
# Run this on the droplet in /opt/bcai-router after copying the code (README.md → Deploy).
# Assumes /etc/caddy/Caddyfile already reverse-proxies the bcairouter site to 127.0.0.1:8335
# and .env.production is filled in (see .env.production.example).

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env.production ]]; then
  echo "ERROR: .env.production not found. Copy from .env.production.example and fill in secrets." >&2
  exit 1
fi

# An open gateway on the internet = anyone can spend the owner's provider keys.
# Same test as src/instrumentation.ts; example placeholders (<generate-...>) are public, so they count as unset.
env_val() {
  { grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" .env.production || true; } | tail -n1 | cut -d= -f2- \
    | tr -d '\r' | sed -E "s/^[[:space:]]*['\"]?//; s/['\"]?[[:space:]]*$//"
}
auth_set=0
for var in GATEWAY_API_KEY AUTH_OWNER_EMAIL ADMIN_PASSWORD; do
  val=$(env_val "$var")
  if [[ "$val" == *"<"* ]]; then
    echo "ERROR: $var in .env.production is still the example placeholder. Set a real value or leave it empty." >&2
    exit 1
  fi
  min=1
  if [[ "$var" == ADMIN_PASSWORD ]]; then min=4; fi  # app ignores shorter passwords
  if (( ${#val} >= min )); then auth_set=1; fi
done
if [[ $auth_set -eq 0 ]]; then
  echo "ERROR: .env.production sets none of GATEWAY_API_KEY / AUTH_OWNER_EMAIL / ADMIN_PASSWORD." >&2
  echo "       Refusing to deploy an open gateway — anyone on the internet could use your provider keys." >&2
  exit 1
fi

# compose interpolates the DB credentials from .env.production (never hardcode them in the compose files)
for var in POSTGRES_PASSWORD DATABASE_URL; do
  if [[ -z "$(env_val "$var")" || "$(env_val "$var")" == *"<"* ]]; then
    echo "ERROR: $var is not set in .env.production (see .env.production.example)." >&2
    exit 1
  fi
done

# pre-rebrand (sml-gateway) data not moved yet → deploying would start an empty DB beside the old stack
if docker volume inspect sml-gateway_sml-gateway-pg >/dev/null 2>&1 && ! docker volume inspect bcai-router_bcai-router-pg >/dev/null 2>&1; then
  echo "ERROR: pre-rebrand stack detected. Run once:" >&2
  echo "  docker compose -p sml-gateway stop" >&2
  echo "  COMPOSE=\"docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml\" bash scripts/migrate-from-smlgateway.sh" >&2
  exit 1
fi

echo "==> Building and starting containers..."
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml up -d --build

echo "==> Waiting for health..."
for i in {1..30}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8335/api/health || echo 000)
  if [[ "$code" == "200" ]]; then
    echo "    health OK (${i}s)"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "ERROR: health check never returned 200 within 30s (last=${code})" >&2
    docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml ps
    docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml logs --tail 50 bcai-router
    exit 1
  fi
  sleep 1
done

echo "==> Verifying container state..."
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml ps

echo
echo "Deploy complete. Test:"
echo "    curl -s -o /dev/null -w '%{http_code}\\n' https://bcairouter.bcaicloud.com/api/health"
