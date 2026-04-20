# OpenClaw Integration

**Status:** 🚧 In Progress

## Goal

Integrate writing-mcp with OpenClaw runtime and agent policy while core MCP functionality is being validated and operationalized.

## Integration Points

### Docker Compose

- [ ] Add `writing-mcp` service to OpenClaw `docker-compose.yml`
- [ ] Configure healthcheck at `/healthz`
- [ ] Mount named volume `writing-mcp-data` for SQLite index
- [ ] Set `WRITING_SYNC_DIR` env var pointing to mounted sync folder

### Service Configuration

- [ ] Register in OpenClaw `mcp.servers` config
- [ ] Service name: `writing-mcp`
- [ ] Pattern: Same as `health-mcp` and `pdf-mcp` — Node.js, SSEServerTransport at `/sse`

### Agent Policy

- [ ] Add `writing__*` to Writing World agent `tools.allow`
- [ ] Consider elevating Writing World agent up in Desk System (currently deferred)

## Current Direction

The integration is no longer purely speculative. Work is underway toward making `writing-mcp` fit the OpenClaw runtime shape, so this now belongs in active planning rather than the deferred backlog.

Current signals of progress:

- the MCP server is already structured around the expected service pattern
- deployment expectations for healthcheck, volume, and runtime wiring are defined
- agent/tool policy integration points are known

## Prerequisites

- Core functionality tested and stable (Phases 1-3 complete)
- Sync folder can be mounted from OpenClaw persistent storage
- Git remote configured for backup/version history
- No hard dependencies on external services (embeddings can remain deferred)

## Known Dependencies

- `writing-mcp` requires Node.js 18+
- Requires git CLI available in container
- Requires read/write access to sync folder (detect and warn if read-only)
- SQLite database stored in named volume for persistence

## Rollout Strategy

1. Test writing-mcp standalone with sample manuscripts
2. Verify Docker build and healthcheck
3. Stage in OpenClaw dev environment
4. Test with Writing World agent (limited tool set first)
5. Expand tool access as needed
6. Deploy to production

## Related

- [import-sync.md](../done/import-sync.md) — Sync folder structure and setup
- [editing.md](../done/editing.md) — Git requirements
