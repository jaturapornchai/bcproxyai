<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:sml-gateway-rules -->
# SMLGateway project rules

## Documentation = current state only
When writing/rewriting README.md, AGENTS.md, or any docs file: describe ONLY what exists right now. Never include "previously / migrated from / what's new / changelog / version history". If something was removed, just don't mention it. Treat every doc rewrite as if the reader has never seen the project. Changelogs belong in `git log`, not docs.

**Why:** Mixing history with current state confuses readers. The user explicitly set this as a permanent rule.

## Port map (do not confuse)
| Port | Service |
|------|---------|
| 3333 | SMLGateway via external Caddy (300s timeout) |
| 3334 | SMLGateway via in-compose Caddy (load balanced) |
| 5434 | Postgres (sml-gateway compose service) |
| 6382 | Redis (sml-gateway compose service) |
| 18790 | OpenClaw via Caddy (600s timeout) |
| 18791 | OpenClaw direct (Docker) |

The sml-gateway container exposes only internal port 3000; host traffic routes through the in-compose `caddy` service. Scale with `docker compose up -d --scale sml-gateway=N`.

## Deploy + verify (never claim "done" without all 3 passing)
```bash
rtk npx next build           # (1) must return 0 errors
rtk docker compose up -d --build
sleep 5 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3334/  # (2) must return 200
# (3) container must be `Up` — not `Restarting` or `Exited`
```
Container: `sml-gateway-sml-gateway-1`. OpenClaw: `openclaw-bcproxy-test`.

## Caddy reload
Caddyfile changes need: `powershell -File "C:/Users/jatur/restart-caddy.ps1"`. Caddy logs at `caddy.log` / `caddy.err.log` (gitignored).
<!-- END:sml-gateway-rules -->
