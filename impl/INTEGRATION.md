# Serac Agents — Phase 1 Implementation

## Integration into existing codebase

All code lives in `/home/hermes/projects/serac-agents/impl/`.
Migration lives in `/home/hermes/projects/serac-agents/migrations/017_agent_vaults.sql`.

### Step 1: Run the migration

```bash
# On VPS
ssh vps-sniper
cd /home/sniper/serac
psql "$DATABASE_URL" -f /path/to/017_agent_vaults.sql
```

### Step 2: Copy implementation files

Copy `impl/` files to `apps/api/src/`:

```bash
# From local to VPS
scp -r impl/* vps-sniper:/home/sniper/serac/apps/api/src/

# New files:
#   routes/agent-auth.ts
#   routes/agent-vaults.ts
#   routes/agent-objects.ts
#   routes/mcp-server.ts
#   middleware/auth-agent.ts
```

### Step 3: Register routes in `apps/api/src/index.ts`

Add these imports near the top:

```typescript
import { agentAuthRoutes } from "./routes/agent-auth.js";
import { agentVaultRoutes } from "./routes/agent-vaults.js";
import { agentObjectRoutes } from "./routes/agent-objects.js";
import { mcpServerRoutes } from "./routes/mcp-server.js";
```

And register BEFORE the error handler (after health routes):

```typescript
  // ── Agent Routes ──
  await app.register(agentAuthRoutes, { prefix: "/api/agent/auth" });
  await app.register(agentVaultRoutes, { prefix: "/api/agent" });
  await app.register(agentObjectRoutes, { prefix: "/api/agent" });
  await app.register(mcpServerRoutes); // /mcp/v1
```

### Step 4: Verify imports resolve

All imports use existing modules:
- `../../db/connection.js` → `sql` (postgres.js)
- `../../lib/jwt.js` → `JWT_SECRET` (jose)
- `../../lib/redis.js` → `redis` (ioredis)
- `../../lib/s3.js` → `s3`, `getUploadUrl`, `getDownloadUrl`
- `../../middleware/auth.js` → `authenticate` (human auth middleware)
- `../../middleware/auth-agent.js` → `authenticateAgent` (new)
- `@aws-sdk/client-s3` → already installed
- `@aws-sdk/s3-request-presigner` → already installed
- `bcrypt`, `jose`, `zod` → already installed

**No new npm packages required.**

### Step 5: Test

```bash
cd /home/sniper/serac
npm run build   # or: tsx apps/api/src/index.ts
npm run test
```

## Architecture Summary

### Migration (017_agent_vaults.sql)

6 new tables:
- `agent_vaults` — Agent identity (Ed25519 pubkey, encrypted MK, plan)
- `agent_namespaces` — Isolated storage per vault
- `agent_audit_log` — Append-only (trigger enforces no UPDATE/DELETE)
- `vault_guardians` — Recovery escrow (owner X25519 pubkey)
- `agent_api_keys` — API key auth for MCP (bcrypt-hashed)
- `agent_objects` — Encrypted blobs on S3 (presigned URL flow)

4 new plans: `agent_free` (5GB), `agent_starter` (100GB), `agent_pro` (500GB), `agent_fleet` (2TB)

### Auth Flow (Hybrid)

1. **API key → JWT**: POST `/api/agent/auth/api-key` with `sk_serac_xxx`
2. **Challenge-response → JWT**: GET `/api/agent/auth/challenge` → sign with Ed25519 → POST `/api/agent/auth/token`
3. **JWT verification**: POST `/api/agent/auth/verify`
4. **All agent routes**: `Authorization: Bearer <jwt>` header

### MCP Protocol (HTTP Streamable)

- **POST /mcp/v1** — JSON-RPC 2.0
  - `initialize` → server info, capabilities
  - `tools/list` → 5 tools (store, retrieve, list, delete, quota)
  - `tools/call` → execute tool
  - `ping` → pong
- **GET /mcp/v1** → 501 (SSE V2)
- No external MCP SDK dependency (implement directly in Fastify)

### Security Model

- All agent JWTs have `type: "agent"` claim (different from human `type: undefined`)
- API keys are bcrypt-hashed, prefixed (`sk_serac_xxx`) for O(1) lookup
- Ed25519 challenge-response: 5-min TTL, single-use, max 10/hour/vault
- Audit log: append-only trigger, every action logged
- Rate limiting on all endpoints
- Vault isolation: JWT scoped to vault, namespace-scoped API keys possible