@AGENTS.md

## SMLGateway — Next.js / TypeScript AI Gateway
Stack: Next.js 15, TypeScript, PostgreSQL, Redis, Docker/Caddy

Irrelevant skills (do NOT trigger): auto-pilot, bc-account-expert, bc-deploy, bc-doc, bc-feature, bc-fix, bc-review, api-designer, db-expert, db-migration, flutter-expert, flutter-screen, go-api-handler, go-expert, mcp-tool.

## Docs
- [AGENTS.md](AGENTS.md) — ports, deploy, Caddy, project rules
- [docs/API-GUIDE.md](docs/API-GUIDE.md) — gateway config guide

## Compact instructions
Keep: uncommitted changes, decisions made, bugs + fixes, pending TODOs, current task context.
Drop: command output, failed attempts, exploration results, general discussion.

## Session rules
- Specify file paths directly. Do not search broadly.
- Use sub-agents for codebase exploration.
- Batch multiple questions in one message.
- Run /compact after completing each feature.
- Run /clear when switching to unrelated task.
