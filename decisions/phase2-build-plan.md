# Phase 2 Build Plan — Serac Agents

**Date**: 2026-05-14  
**Author**: Kira  
**Status**: Approved by Aiko  

---

## Summary

Phase 1 (MCP server + 5 tools V1 + auth + vaults + SSE) is LIVE.  
Phase 2 builds out: V2 tools (share/attest/archive), SDK npm+pip, x402 middleware, spending limits, DNS `api.serac.cloud`.

---

## 1. V2 Tools — share, attest, archive

### 1.1 `serac_share` — Partage X25519 inter-agent

**Endpoint**: `POST /api/agent/objects/share`  
**Flow**:
1. Agent A calls share with `target_agent_pubkey` (X25519) + `namespace` + `key`
2. Server looks up object metadata (NOT content — zero-knowledge)
3. Agent A encrypts the namespace key for Agent B's X25519 pubkey using `crypto_box_seal` (sealed box)
4. Server stores the sealed key in a `vault_shares` table
5. Agent B retrieves shared key and decrypts locally

**DB additions**:
```sql
CREATE TABLE vault_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID REFERENCES agent_objects(id) ON DELETE CASCADE,
  from_vault_id UUID REFERENCES agent_vaults(id) ON DELETE CASCADE,
  to_vault_id UUID REFERENCES agent_vaults(id) ON DELETE CASCADE,
  encrypted_namespace_key TEXT NOT NULL,  -- sealed box for recipient's X25519
  permission TEXT NOT NULL CHECK (permission IN ('read', 'read_write')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_shares_to_vault ON vault_shares(to_vault_id);
CREATE INDEX idx_shares_object ON vault_shares(object_id);
```

**Note**: Server never sees plaintext content. Agent A encrypts the namespace key client-side before sending. Server only stores the sealed box.

### 1.2 `serac_attest` — Attestation Ed25519

**Endpoint**: `GET /api/agent/objects/:key/attest`  
**Flow**:
1. Agent requests attestation for a stored key
2. Server looks up object metadata (hash SHA-256, size, upload timestamp, vault ID)
3. Server signs with a **service-level Ed25519 key** (NOT the agent's key):
   ```
   sign(service_ed25519_priv, hash_sha256 + "|" + vault_id + "|" + timestamp)
   ```
4. Returns: `{ key, hash_sha256, size_bytes, uploaded_at, vault_id, ed25519_signature, verify_url }`
5. `verify_url` points to `https://serac.cloud/verify/{signature}` — public verification endpoint

**Why service key, not agent key?** Agent keys rotate. Service key provides stable verification. Agent can verify independently by checking the hash.

**DB additions**: No new table. Use existing `agent_audit_log` for attestation events. Store service Ed25519 keypair in Redis (or env var).

### 1.3 `serac_archive` — Archivage Glacier

**Endpoint**: `POST /api/agent/objects/:key/archive`  
**Flow**:
1. Agent requests archive for a key
2. Server transitions object storage class: Standard → OVH Cold Archive (Glacier equivalent)
3. Using OVH S3 API: `CopyObject` with `StorageClass: GLACIER` or `DEEP_ARCHIVE`
4. Object becomes read-only (no writes until restored)
5. Restore request: `POST /api/agent/objects/:key/restore` → S3 RestoreObject (24-48h retrieval)
6. Status tracking via `agent_objects.archive_status` enum: `active | archived | restoring | restored`

**DB additions**:
```sql
ALTER TABLE agent_objects ADD COLUMN archive_status TEXT NOT NULL DEFAULT 'active'
  CHECK (archive_status IN ('active', 'archived', 'restoring', 'restored'));
ALTER TABLE agent_objects ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE agent_objects ADD COLUMN restore_requested_at TIMESTAMPTZ;
ALTER TABLE agent_objects ADD COLUMN restore_available_until TIMESTAMPTZ;
```

**Pricing**: €0.002/Go/mois (Cold Archive OVH) + €0.02/Go per restore request. Stored in `agent_vaults.archive_used_bytes`.

---

## 2. SDK npm — `serac-agent-sdk`

**Package**: `serac-agent-sdk` on npm  
**Language**: TypeScript  
**Dependencies**: `libsodium-wrappers-sumo`, `jose` (JWT), `undici` (HTTP client). Zero other deps.

### Core class

```typescript
class SeracAgent {
  private apiKey: string;
  private baseUrl: string;
  private jwt: string | null;
  private jwtExpiry: number;
  private keypair: Ed25519KeyPair;
  private masterKey: Uint8Array;

  static async register(opts: RegisterOptions): Promise<SeracAgent>;
  static fromApiKey(apiKey: string, opts?: ClientOptions): SeracAgent;

  async store(namespace: string, key: string, data: string | Buffer, opts?: StoreOpts): Promise<StoreResult>;
  async retrieve(namespace: string, key: string): Promise<RetrieveResult>;
  async list(namespace: string, opts?: ListOpts): Promise<ListResult>;
  async delete(namespace: string, key: string): Promise<DeleteResult>;
  async quota(): Promise<QuotaResult>;

  // V2
  async share(namespace: string, key: string, targetPubkey: string, permission?: string): Promise<ShareResult>;
  async attest(namespace: string, key: string): Promise<AttestResult>;
  async archive(namespace: string, key: string): Promise<ArchiveResult>;
}
```

### Auth flow

1. `SeracAgent.fromApiKey(apiKey)` → POST `/api/agent/auth/api-key` → JWT (1h TTL)
2. Auto-renewal: when JWT expires, re-authenticate. If near expiry, switch to challenge-response.
3. `SeracAgent.register(opts)` → POST `/api/agent/register` → vaultId + JWT + apiKey + mk sealed box

### Crypto client-side

- Store: `SeracAgent.store()` derives namespace key → encrypts data with XChaCha20-Poly1305 → sends ciphertext to server
- Retrieve: `SeracAgent.retrieve()` gets ciphertext → decrypts with namespace key
- The server **NEVER** sees plaintext. This is true E2EE.

### Build phases

- S1: Core `SeracAgent` class + auth + 5 tools V1 (store/retrieve/list/delete/quota)
- S2: Client-side encryption (XChaCha20-Poly1305 via libsodium)
- S3: Register flow + key derivation
- S4: V2 tools (share/attest/archive)
- S5: npm publish + docs

---

## 3. SDK Python — `serac-mcp`

**Package**: `serac-mcp` on PyPI  
**Dependencies**: `pynacl` (libsodium Python bindings), `httpx`, `pydantic`

Faithful port of TypeScript SDK. Same API surface, same crypto operations, same auth flow.  
Interop verified with ADR-001 test vectors (JS↔Python).

### Build phases

- S4 (parallel with TS S3): Core class + auth + 5 tools V1
- S5: Client-side encryption (PyNaCl ChaCha20-Poly1305)
- S6: Register flow + pypi publish

---

## 4. x402 Middleware — Dual Payment

### 4.1 x402 USDC (Base L2) — Agent autonomous payment

**Middleware**: Fastify preHandler hook on agent routes.  
**Flow**:
1. Request arrives without `Authorization: Bearer sk_serac_*`
2. Server responds `HTTP 402 Payment Required` with header `X-402-Version: 1` and body:
   ```json
   {
     "x402_version": 1,
     "scheme": "exact",
     "network": "8453",  // Base L2 chain ID
     "asset": "0x833589fCD6eDbD6965586aD7D3E69c11C6bA0EeE",  // USDC on Base
     "amount": "50",     // $0.50 in USDC smallest unit (6 decimals)
     "recipient": "0x...",
     "description": "Serac Agent Starter Plan - 100GB/mo"
   }
   ```
3. Agent signs EIP-712 message, sends USDC via Base L2
4. Server verifies on-chain payment (Coinbase x402 protocol)
5. Activates vault

**Implementation**: V2 timeline. Schema in DB (migration 018 applied). Middleware code is ~200 lines.

### 4.2 Spending limits + circuit breaker

**Mechanism**:
- `current_month_usage_cents` in `agent_vaults` — incremented on every store operation
- `x402_spending_limit_cents` — set at registration or by owner
- Rate limiting: max 100 req/min per vault, max €10/day per vault (configurable)
- Monthly reset via cron job (first of month)

**DB additions**:
```sql
ALTER TABLE agent_vaults ADD COLUMN current_month_usage_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_vaults ADD COLUMN request_count_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_vaults ADD COLUMN request_count_reset_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE agent_vaults ADD COLUMN last_request_at TIMESTAMPTZ;
CREATE INDEX idx_vault_spending_reset ON agent_vaults(request_count_reset_at);
```

**Middleware**: Fastify preHandler that checks:
1. Is `current_month_usage_cents >= x402_spending_limit_cents`? → 429
2. Is `request_count_today >= 100` AND `request_count_reset_at < today`? → increment or 429
3. Otherwise: increment counters, proceed

---

## 5. DNS `api.serac.cloud` (Option B)

### Steps

1. **Cloudflare DNS**: Add A record `api.serac.cloud` → `51.210.148.37`
2. **Let's Encrypt**: Obtain cert for `api.serac.cloud` on VPS (`sudo certbot certonly --nginx -d api.serac.cloud`)
3. **Nginx config**: Add new server block in `/etc/nginx/sites-available/serac-cloud-api`:
   ```nginx
   server {
       server_name api.serac.cloud;
       location / {
           proxy_pass http://127.0.0.1:3001;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
       listen 443 ssl;
       ssl_certificate /etc/letsencrypt/live/api.serac.cloud/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/api.serac.cloud/privkey.pem;
   }
   ```
4. **Enable site**: `sudo ln -s /etc/nginx/sites-available/serac-cloud-api /etc/nginx/sites-enabled/` + `sudo nginx -s reload`

**Why Option B is the right call**: Cleaner URLs in discovery docs (`https://api.serac.cloud/mcp/v1` vs `https://serac.cloud/api/agent/mcp/v1`), proper separation of concerns, MCP registries expect a dedicated API domain. Also enables independent rate limiting and scaling of the agent API vs the web frontend.

**⚠️ Blocker**: `hermes` lacks root sudo. Aiko needs to run the certbot and nginx commands.

---

## 6. `agent_type` — Optional Text Field

**Decision**: Add `agent_type TEXT` to `agent_vaults` — purely informational, no CHECK constraint.  
**Rationale**: The landscape evolves weekly. An enum would be stale on day 1. `agent_type` is for analytics (future dashboard), not access control. `tier` already controls pricing/features.

```sql
ALTER TABLE agent_vaults ADD COLUMN agent_type TEXT;
```

---

## 7. Not Building (Explicitly Out of Scope)

- **Agent messaging** (Phase 6 in CC): WebSocket E2EE channels for owner↔agent. Not needed V1/V2. Agents have webhooks.
- **WebMCP** (Phase 3 in CC): `navigator.modelContext.registerTool()` — Chrome 146+ only, experimental. Deferred until stable.

---

## Build Priority Order

| Priority | Task | Depends On | Est. Effort |
|----------|------|------------|-------------|
| P0 | SDK npm S1 (core class + auth + V1 tools, no encryption) | Auth endpoints LIVE | 3-4 days |
| P1 | x402 middleware + spending limits | Migration 018 DONE | 2-3 days |
| P2 | `serac_share` (V2 tool) | vault_shares table | 2 days |
| P3 | `serac_attest` (V2 tool) | Service Ed25519 keypair | 1 day |
| P4 | `serac_archive` (V2 tool) | OVH Cold Archive API | 1-2 days |
| P5 | SDK npm S2 (client-side encryption) | S1 done | 2-3 days |
| P6 | SDK Python S4-S5 | TS S1 done (interop ref) | 3-4 days |
| P7 | DNS api.serac.cloud | ⚠️ root sudo needed | 10 min (Aiko) |
| P8 | agent_type column | Migration | 5 min |
| P9 | Registries publication (smithery, glama, MCP reg) | SDK done | 1 day |

**Total estimated**: ~3 weeks for P0-P8. P9 after SDK is published.

---

## Migration Summary

**019_agent_v2_tools.sql** (new):
- `vault_shares` table (share)
- `agent_objects.archive_status`, `archived_at`, `restore_requested_at`, `restore_available_until` (archive)
- Service Ed25519 keypair stored in env/secrets (attest — no DB change)

**020_agent_spending_limits.sql** (new):
- `agent_vaults.current_month_usage_cents`, `request_count_today`, `request_count_reset_at`, `last_request_at`
- `agent_vaults.agent_type TEXT`

---

*Document stored in `/home/hermes/projects/serac-agents/decisions/phase2-build-plan.md`*