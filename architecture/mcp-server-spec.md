# ADR-002 — Spécification MCP Server Serac Agents

**Date**: Mai 2026  
**Statut**: Draft — post-fusion Kira+CC  
**Prérequis**: ADR-001 (Encryption Protocol) finalisé

---

## 1. Vue d'ensemble

Le MCP Server Serac est l'interface principale entre les agents IA autonomes et le cloud chiffré Sérac. Il expose 5 tools V1 via HTTP Streamable (transport MCP pour services distants).

**Objectif V1** : un agent (OpenClaw, Hermes, Claude Code, custom) peut stocker et récupérer des données chiffrées sur OVH Paris en ajoutant 1 ligne de config MCP.

---

## 2. Architecture

### 2.1 Stack technique

| Couche | Technologie | Notes |
|--------|-------------|-------|
| Runtime | Node.js 20+ | Aligné avec @serac/crypto (WASM) |
| Framework MCP | `@modelcontextprotocol/sdk` | TypeScript, Streamable HTTP |
| Transport | HTTP Streamable | Pas stdio — service distant requis |
| Auth | API key + Ed25519 challenge-response | Hybride (fusion Kira+CC) |
| Base de données | PostgreSQL 16 | Même instance que Serac humain |
| Cache | Redis 7 | Tokens JWT, challenges, rate limiting |
| Stockage objet | OVH S3 3-AZ Paris | Existant, réutilisé |
| Reverse proxy | Caddy + Cloudflare Tunnel | Existant, ajout sous-domaine mcp.serac.cloud |
| Chiffrement | @serac/crypto (libsodium WASM) | Existant, ~90% réutilisable |

### 2.2 Sous-domaines

| Sous-domaine | Point d'entrée |
|-------------|---------------|
| `serac.cloud` | Frontend humain (existant) |
| `api.serac.cloud` | API REST agent (nouveau) |
| `mcp.serac.cloud` | MCP Server remote (nouveau) |
| `docs.serac.cloud` | Documentation (nouveau) |
| `status.serac.cloud` | Uptime Kuma (existant) |

---

## 3. Authentification — Flux hybride

### 3.1 Enregistrement d'un agent

```
POST /v1/agents/register
Content-Type: application/json

{
  "agent_name": "my-research-agent",
  "tier": "starter",
  "payment": {
    "method": "stripe",        // V1: Stripe seulement
    "token": "tok_visa_xxx"
  },
  "ed25519_public_key": "4d7a...",  // Optionnel V1, requis V2
  "owner_email": "aiko@serac.cloud"   // Optionnel, pour guardian
}
```

Réponse :
```json
{
  "agent_id": "uuid-xxx",
  "api_key": "sk_serac_xxxxxxxxx",
  "namespace_id": "uuid-yyy",
  "tier": "starter",
  "storage_limit_bytes": 107374182400,
  "ed25519_public_key": "4d7a..."  // Echo de la clé fournie ou générée
}
```

**Important** : L'API key n'est montrée qu'une fois. L'agent doit la stocker de manière sécurisée.

### 3.2 Premier contact — API key → JWT

```
POST /v1/auth/token
Content-Type: application/json
Authorization: Bearer sk_serac_xxxxxxxxx

{
  "grant_type": "api_key"
}
```

Réponse :
```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "vault_id": "uuid-xxx"
}
```

Le JWT contient :
- `sub`: agent_id
- `type`: "agent"
- `namespace_id`: uuid
- `tier`: "starter"
- `iat`, `exp`: timestamps

### 3.3 Renouvellement — Challenge-response Ed25519

```
GET /v1/auth/challenge
Authorization: Bearer <jwt>
```

Réponse :
```json
{
  "challenge": "a1b2c3d4...",
  "vault_id": "uuid-xxx",
  "timestamp": 1715769600,
  "expires_in": 300
}
```

L'agent signe : `challenge:vault_id:timestamp` avec sa clé Ed25519.

```
POST /v1/auth/token
Content-Type: application/json

{
  "grant_type": "challenge_response",
  "challenge": "a1b2c3d4...",
  "signature": "ed25519_sig...",
  "public_key": "4d7a..."
}
```

Réponse : même format que §3.2 (nouveau JWT).

**Limites** : max 10 challenges/heure par vault. Challenge jeté après usage. Redis TTL 5 min.

### 3.4 Ping de vérification (optionnel)

```
POST /v1/auth/verify
Authorization: Bearer <jwt>
```

Réponse : `{ "valid": true, "agent_id": "uuid-xxx", "expires_at": "..." }`

---

## 4. API REST Agent-native

### 4.1 Endpoints compte

```
POST   /v1/agents/register          — Créer un compte agent
GET    /v1/agents/me               — Info agent (quota, usage, tier)
PATCH  /v1/agents/me               — Modifier (webhook, spending limit)
DELETE /v1/agents/me               — Supprimer le compte agent
```

### 4.2 Endpoints namespace (stockage)

```
PUT    /v1/ns/{namespace}/{key}      — Stocker un objet (upsert)
GET    /v1/ns/{namespace}/{key}       — Récupérer un objet
GET    /v1/ns/{namespace}?prefix=     — Lister les clés
DELETE /v1/ns/{namespace}/{key}       — Supprimer un objet
```

### 4.3 Endpoints gestion

```
GET    /v1/agents/me/quota            — Quota et usage
GET    /v1/agents/me/audit           — Journal d'audit
POST   /v1/agents/me/upgrade         — Changer de tier
GET    /v1/agents/me/billing          — Consulter facturation
```

**V2 (post-MVP)** :
```
POST   /v1/ns/{namespace}/{key}/share    — Partager (X25519 envelope)
POST   /v1/ns/{namespace}/{key}/archive  — Archiver en Glacier
GET    /v1/ns/{namespace}/{key}/attest    — Attestation Ed25519
GET    /v1/ns/{namespace}/{key}/versions  — Historique des versions
```

---

## 5. MCP Server — Tools V1

Le MCP Server expose les 5 tools V1 via HTTP Streamable.

### 5.1 Configuration agent (exemples)

**Hermes Agent / OpenClaw (SKILL.md)** :
```yaml
---
name: serac-storage
description: Sovereign E2EE storage on OVHCloud France
mcp:
  url: https://mcp.serac.cloud/v1
  auth:
    type: api_key
    env: SERAC_API_KEY
---
```

**Claude Code / Cursor / Windsurf (mcp.json)** :
```json
{
  "mcpServers": {
    "serac": {
      "url": "https://mcp.serac.cloud/v1",
      "headers": {
        "Authorization": "Bearer sk_serac_xxxxxxxxx"
      }
    }
  }
}
```

### 5.2 Tool : serac_store

Stocke un objet chiffré dans un namespace.

```typescript
server.tool(
  "serac_store",
  "Store encrypted data in your isolated namespace on OVHCloud France",
  {
    key: z.string().describe("Storage key (e.g. 'memory:user_prefs')"),
    data: z.string().describe("Data to store (JSON string or base64)"),
    ttl: z.number().optional().describe("TTL in seconds (0 = permanent)"),
    namespace: z.string().optional().describe("Namespace (defaults to 'default')"),
  },
  async ({ key, data, ttl, namespace }, extra) => {
    // 1. Auth via session token
    // 2. Resolve namespace (default or specified)
    // 3. Encrypt data with namespace key (sealed box or at-rest depending on SDK mode)
    // 4. PUT to OVH S3
    // 5. Log to audit
    // 6. Apply automatic tiering (hot/warm/cold based on age)
    const result = await storeObject(extra.sessionId, namespace || "default", key, data, ttl);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }
);
```

Réponse :
```json
{
  "key": "memory:user_prefs",
  "namespace": "default",
  "size_bytes": 1024,
  "version": 1,
  "tier": "standard",
  "stored_at": "2026-05-14T12:00:00Z"
}
```

### 5.3 Tool : serac_retrieve

Récupère un objet chiffré par clé.

```typescript
server.tool(
  "serac_retrieve",
  "Retrieve encrypted data from your namespace",
  {
    key: z.string().describe("Storage key to retrieve"),
    namespace: z.string().optional().describe("Namespace (defaults to 'default')"),
    version: z.number().optional().describe("Version number (default: latest)"),
  },
  async ({ key, namespace, version }, extra) => {
    // 1. Auth via session token
    // 2. Resolve namespace
    // 3. GET from OVH S3
    // 4. Decrypt with namespace key
    // 5. Return cleartext (client-side) or ciphertext (MCP at-rest mode)
    const data = await retrieveObject(extra.sessionId, namespace || "default", key, version);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
    };
  }
);
```

### 5.4 Tool : serac_list

Liste les clés d'un namespace avec filtre optionnel.

```typescript
server.tool(
  "serac_list",
  "List keys in your namespace with optional prefix filter",
  {
    prefix: z.string().optional().describe("Key prefix filter (e.g. 'memory:')"),
    limit: z.number().optional().default(100).describe("Max keys to return (1-1000)"),
    namespace: z.string().optional().describe("Namespace (defaults to 'default')"),
  },
  async ({ prefix, limit, namespace }, extra) => {
    const keys = await listKeys(extra.sessionId, namespace || "default", prefix, limit);
    return {
      content: [{ type: "text", text: JSON.stringify(keys) }],
    };
  }
);
```

Réponse :
```json
{
  "namespace": "default",
  "keys": [
    { "key": "memory:user_prefs", "size_bytes": 1024, "version": 1, "stored_at": "..." },
    { "key": "memory:session_history", "size_bytes": 4096, "version": 3, "stored_at": "..." }
  ],
  "total": 2,
  "has_more": false
}
```

### 5.5 Tool : serac_delete

Supprime un objet (soft delete par défaut, permanent optionnel).

```typescript
server.tool(
  "serac_delete",
  "Delete an object from your namespace",
  {
    key: z.string().describe("Storage key to delete"),
    namespace: z.string().optional().describe("Namespace (defaults to 'default')"),
    permanent: z.boolean().optional().default(false).describe("Permanent delete (bypasses 30-day soft-delete)"),
  },
  async ({ key, namespace, permanent }, extra) => {
    await deleteObject(extra.sessionId, namespace || "default", key, permanent);
    return {
      content: [{ type: "text", text: `Deleted: ${key}${permanent ? " (permanent)" : " (soft-delete, 30-day recovery)"}` }],
    };
  }
);
```

### 5.6 Tool : serac_quota

Consulte le quota, l'usage et le tier.

```typescript
server.tool(
  "serac_quota",
  "Check your storage usage, limits, and current plan",
  {},
  async (_, extra) => {
    const quota = await getQuota(extra.sessionId);
    return {
      content: [{ type: "text", text: JSON.stringify(quota) }],
    };
  }
);
```

Réponse :
```json
{
  "plan": "starter",
  "storage_used_bytes": 5368709120,
  "storage_limit_bytes": 107374182400,
  "usage_percent": 5.0,
  "reads_today": 142,
  "reads_limit": 10000,
  "namespaces": [
    { "name": "default", "used_bytes": 4294967296, "object_count": 47 },
    { "name": "logs", "used_bytes": 1073741824, "object_count": 1203 }
  ],
  "billing": {
    "current_period_end": "2026-06-14",
    "amount_cents": 399
  }
}
```

---

## 6. Modèle de chiffrement — 2 modes

### 6.1 Mode MCP (at-rest encryption)

Le serveur chiffre/déchiffre avec la namespace key. L'agent envoie du texte en clair via MCP, le serveur chiffre avant stockage S3.

**Avantages** : Simple, l'agent n'a pas besoin de libsodium.
**Inconvénients** : Le serveur voit le contenu en clair pendant le transit et le traitement.

**Flux** :
```
Agent → serac_store(key, data) → MCP Server → encrypt(namespace_key, data) → S3
Agent ← serac_retrieve(key) ← MCP Server ← decrypt(namespace_key, data) ← S3
```

### 6.2 Mode SDK (true E2EE client-side)

L'agent chiffre avant envoi via le SDK. Le serveur ne voit jamais le contenu en clair.

**Avantages** : Zero-knowledge serveur, conforme au positionnement E2EE.
**Inconvénients** : Nécessite libsodium côté agent (PyNaCl en Python, libsodium.js en JS).

**Flux** :
```
Agent → SDK.encrypt(master_key, data) → serac_store(key, ciphertext) → S3
Agent ← serac_retrieve(key) ← SDK.decrypt(master_key, ciphertext) ← S3
```

### 6.3 Choix V1

Le mode MCP (at-rest) est la valeur par défaut. Le mode SDK (E2EE) est disponible pour les agents qui utilisent le SDK.

**Documentation explicite** : le tradeoff entre les deux modes doit être documenté clairement dans `docs.serac.cloud` et dans `.well-known/mcp.json`.

---

## 7. Tiering automatique

Le système classe automatiquement les objets en fonction de leur âge, sans intervention de l'agent.

| Niveau | Condition | Stockage OVH | Coût/Go/mois |
|--------|-----------|---------------|-------------|
| Chaud | < 7 jours | Standard 3-AZ | €0.014 |
| Tiède | 7-30 jours | Infrequent Access | €0.0095 |
| Froid | > 30 jours | Active Archive | €0.0045 |
| Glacier | Opt-in agent | Cold Archive | €0.0016644 |

**Cycle de vie** :
1. Nouvel objet → Chaud (Standard 3-AZ)
2. Après 7j sans accès → Tiède (Infrequent Access)
3. Après 30j sans accès → Froid (Active Archive)
4. Glacier uniquement via `serac_archive` (V2) ou opt-in par namespace

**Contraintes Glacier** : durée minimale 180 jours, pénalité si retrieval avant 180j = `[24h×180 - heures_stockage] × prix_heure`.

**Accès à un objet froid** : déplacé automatiquement en Chaud pour 7 jours, puis reclassé.

---

## 8. Schéma BDD — Extension agent

### 8.1 Table `agent_vaults`

```sql
-- Migration 013: Agent vault support
CREATE TABLE agent_vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),           -- Owner humain (NULL pour agents autonomes V2)
  agent_name TEXT NOT NULL,                      -- Nom lisible de l'agent
  agent_type TEXT NOT NULL CHECK (agent_type IN ('hermes', 'openclaw', 'claude_code', 'codex', 'custom')),
  api_key_hash TEXT NOT NULL,                    -- bcrypt du sk_serac_xxx
  api_key_prefix TEXT NOT NULL,                  -- 8 premiers chars pour identification
  ed25519_public_key TEXT NOT NULL,              -- Clé Ed25519 pour challenge-response
  namespace_default_id UUID NOT NULL UNIQUE REFERENCES agent_namespaces(id),
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'pro', 'fleet')),
  spending_limit_monthly_cents INTEGER,
  current_month_usage_cents INTEGER DEFAULT 0,
  webhook_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vault_apikey ON agent_vaults(api_key_prefix);
CREATE INDEX idx_vault_user ON agent_vaults(user_id);
```

### 8.2 Table `agent_namespaces`

```sql
CREATE TABLE agent_namespaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL REFERENCES agent_vaults(id),
  name TEXT NOT NULL,                            -- 'default', 'logs', 'models', etc.
  encryption_key_encrypted TEXT NOT NULL,         -- Namespace key chiffrée (sealed box avec vault MK)
  storage_used_bytes BIGINT DEFAULT 0,
  object_count INTEGER DEFAULT 0,
  tiering_policy JSONB DEFAULT '{"hot_days": 7, "warm_days": 30, "cold_after_days": 30}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vault_id, name)
);

CREATE INDEX idx_ns_vault ON agent_namespaces(vault_id);
```

### 8.3 Table `agent_audit_log`

```sql
CREATE TABLE agent_audit_log (
  id BIGSERIAL PRIMARY KEY,
  vault_id UUID NOT NULL REFERENCES agent_vaults(id),
  namespace TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('store', 'retrieve', 'list', 'delete', 'share', 'archive', 'attest', 'register', 'upgrade')),
  key TEXT,
  bytes_transferred BIGINT DEFAULT 0,
  tier_before TEXT,
  tier_after TEXT,
  ed25519_signature TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Append-only : pas de UPDATE/DELETE sur cette table
CREATE INDEX idx_audit_vault_time ON agent_audit_log(vault_id, created_at DESC);
CREATE INDEX idx_audit_action ON agent_audit_log(action, created_at DESC);
```

### 8.4 Table `vault_guardians`

```sql
CREATE TABLE vault_guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL REFERENCES agent_vaults(id),
  guardian_type TEXT NOT NULL CHECK (guardian_type IN ('owner', 'admin', 'recovery')),
  x25519_public_key TEXT NOT NULL,               -- Clé publique X25519 du guardian
  encrypted_master_key TEXT NOT NULL,             -- MK chiffrée via sealed box pour ce guardian
  label TEXT,                                    -- Email ou identifiant lisible
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vault_id, x25519_public_key)
);

-- V1: 1 guardian de type 'owner' par vault
-- V2: jusqu'à 3 guardians avec quorum
CREATE INDEX idx_guardian_vault ON vault_guardians(vault_id);
```

---

## 9. Guardian / Recovery

### 9.1 V1 — Owner escrow (1 guardian)

À la création du vault :
1. L'agent génère son Ed25519 keypair
2. L'agent génère Master Key = randombytes_buf(32)
3. L'agent encrypted MK avec sa propre X25519 pubkey (sealed box)
4. Si `owner_email` fourni : l'owner link son X25519 pubkey comme guardian
5. MK est aussi sealed-box-encrypted pour le X25519 de l'owner
6. Si l'agent perd sa clé → owner peut déchiffrer MK → recréer keypair → MK re-encrypté pour nouvelle clé

**Propriété clé** : l'agent ne peut PAS révoquer l'accès de l'owner.

### 9.2 V2 — Multi-guardian quorum (planifié)

Jusqu'à 3 guardians (owner + 2 admins). Seuil de déchiffrement configurable (2/3 par défaut). Implémente un schéma Shamir Secret Sharing pour le MK.

---

## 10. Discovery — 4 couches

### 10.1 Couche 1 — `.well-known/mcp.json`

Fichier statique sur `serac.cloud/.well-known/mcp.json` :

```json
{
  "schema_version": "1.0",
  "name": "Serac",
  "description": "Sovereign E2EE cloud storage for AI agents. RGPD-compliant. Hosted in France on OVHCloud.",
  "url": "https://serac.cloud",
  "mcp_endpoint": "https://mcp.serac.cloud/v1",
  "api_endpoint": "https://api.serac.cloud/v1",
  "docs": "https://docs.serac.cloud",
  "tools": [
    { "name": "serac_store", "description": "Store encrypted data in an isolated namespace", "parameters": ["namespace", "key", "data", "ttl?"] },
    { "name": "serac_retrieve", "description": "Retrieve encrypted data by key", "parameters": ["namespace", "key"] },
    { "name": "serac_list", "description": "List keys in a namespace with optional prefix filter", "parameters": ["namespace", "prefix?", "limit?"] },
    { "name": "serac_delete", "description": "Delete a key from namespace", "parameters": ["namespace", "key", "permanent?"] },
    { "name": "serac_quota", "description": "Check storage usage and plan limits", "parameters": [] }
  ],
  "auth": ["api_key", "challenge_response_ed25519"],
  "payment": ["stripe", "sepa"],
  "encryption": {
    "algorithm": "XChaCha20-Poly1305",
    "key_exchange": "X25519",
    "signing": "Ed25519",
    "key_derivation": "Argon2id",
    "zero_knowledge": true,
    "modes": ["at_rest_server", "e2ee_client_side"]
  },
  "infrastructure": {
    "provider": "OVHCloud",
    "region": "Paris (3-AZ)",
    "jurisdiction": "France / EU"
  },
  "compliance": ["RGPD", "HDS-ready"],
  "source_code": "https://github.com/serac-cloud/serac",
  "pricing_url": "https://serac.cloud/pricing"
}
```

### 10.2 Couche 2 — `.well-known/serac.json`

Discovery custom pour onboarding autonome :

```json
{
  "onboarding": {
    "sdk_route": {
      "endpoint": "POST https://api.serac.cloud/v1/agents/register",
      "auth": "api_key",
      "activation_time": "~30 seconds",
      "required": ["agent_name", "tier"],
      "optional": ["webhook_url", "spending_limit_monthly"]
    },
    "human_route": {
      "url": "https://serac.cloud/signup",
      "methods": ["email+password", "stripe", "sepa"]
    }
  },
  "tiers": {
    "free":      { "storage_gb": 5,   "reads_day": 1000,   "price_eur": 0 },
    "starter":   { "storage_gb": 100, "reads_day": 10000,  "price_eur": 3.99 },
    "pro":        { "storage_gb": 500, "reads_day": "unlimited", "price_eur": 9.99 },
    "fleet":      { "storage_gb": 2000,"reads_day": "unlimited", "price_eur": 29.99 }
  },
  "glacier": {
    "price_per_gb_month_eur": 0.0016644,
    "restore_time": "24-48h",
    "min_storage_days": 180
  }
}
```

### 10.3 Couche 3 — MCP Server remote (HTTP Streamable)

Voir section 5. Configuration en 1 ligne de config (SKILL.md ou mcp.json).

### 10.4 Couche 4 — WebMCP (Phase 3)

Standard W3C (Chrome 146+). Les pages serac.cloud enregistrent des tools pour les agents navigateur. Exemple sur la page pricing :

```javascript
navigator.modelContext.registerTool({
  name: "serac_check_pricing",
  description: "Get current Serac pricing and plan details",
  parameters: {},
  handler: async () => ({ /* ... */ })
});
```

Polyfill : `@mcp-b/global` disponible maintenant pour Chrome Canary.

---

## 11. Rate limiting et protection anti-abus

| Limite | Free | Starter | Pro | Fleet |
|--------|------|---------|-----|-------|
| Requêtes/min | 30 | 60 | 120 | 300 |
| Reads/jour | 1 000 | 10 000 | ∞ | ∞ |
| Writes/jour | 500 | 5 000 | ∞ | ∞ |
| Namespaces | 1 | 5 | 20 | 100 |
| Objets/namespace | 1 000 | 50 000 | ∞ | ∞ |
| Taille max/objet | 1 Mo | 50 Mo | 500 Mo | 5 Go |

**Circuit breaker** : si un agent dépasse 3× son quota de requêtes/min → throttle 60s. Si récidive → throttle 5 min. Logging dans audit.

---

## 12. déploiement

### 12.1 Phase 0 — Nettoyage (1 semaine)

- Archiver roadmap mail/visio/docs (git tag, suppression des nav items)
- Mettre à jour serac.cloud messaging : "cloud humain + agent"
- Créer `llms.txt` à la racine
- Préparer sous-domaines DNS : `mcp.serac.cloud`, `api.serac.cloud`, `docs.serac.cloud`

### 12.2 Phase 1 — MCP Server + API Agent MVP (3 semaines)

| Semaine | Tâche |
|---------|-------|
| S1 | Migration 013 (agent_vaults, agent_namespaces, agent_audit_log, vault_guardians) |
| S1 | Routes API agent (register, me, quota, billing) |
| S1 | API key system (sk_serac_xxx, hash bcrypt, auth middleware) |
| S2 | MCP Server core (5 tools V1, HTTP Streamable) |
| S2 | Chiffrement namespace (at-rest mode, S3 backend) |
| S2 | Audit log (append-only) |
| S3 | Tiering automatique (hot/warm/cold lifecycle) |
| S3 | SDK TypeScript `serac-agent-sdk` (npm) |
| S3 | Tests d'intégration (register → store → retrieve → delete → audit) |
| S3 | Déploiement `mcp.serac.cloud` + `api.serac.cloud` (Caddy, TLS) |

### 12.3 Phase 2 — Discovery, SDK Python, Registres (2 semaines)

| Semaine | Tâche |
|---------|-------|
| S4 | `.well-known/mcp.json` + `.well-known/serac.json` |
| S4 | `llms.txt` |
| S4 | SDK Python `serac-mcp` (pip) — port fidèle de @serac/crypto |
| S5 | Publication registres (MCP Registry, Smithery, Glama) |
| S5 | Documentation docs.serac.cloud |
| S5 | Skills : ClawHub (OpenClaw), agentskills.io (Hermes) |

### 12.4 Phase 3 — WebMCP + Agent Pages (2 semaines)

| Semaine | Tâche |
|---------|-------|
| S6 | WebMCP polyfill sur pages Serac |
| S6 | Tool registration (pricing, quota) |
| S7 | Cloudflare Markdown mode |
| S7 | Tests navigateur (Chrome Canary) |

### 12.5 Phase 4 — x402 + Dual Payment (V2, post-MVP)

Voir document séparé (`architecture/pricing-model.md`).

### 12.6 Phase 5 — Attestation, Trust & Compliance (V2, post-MVP)

- `serac_attest` : preuve Ed25519 d'existence
- Export audit log (CSV/JSON)
- RGPD agent (droit effacement, portabilité)

---

## 13. références

- **ADR-001**: `architecture/encryption-protocol.md` — Protocol de chiffrement agent
- **Pivot doc**: `serac-pivot-agent-first-02mai2026.md` — Vision stratégique (Aiko+CC)
- **Existing stack**: `architecture/existing-stack.md` — Cartographie VPS
- **Gap analysis**: `architecture/gap-analysis.md` — Décisions D1→D10
- **Skill Serac Agents**: product strategy, GTM, competitive landscape
- **MCP spec**: https://modelcontextprotocol.io/specification/draft/server/tools
- **MCP registry**: https://registry.modelcontextprotocol.io