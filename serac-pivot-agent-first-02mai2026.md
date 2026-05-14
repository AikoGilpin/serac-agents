# SÉRAC — Bifurcation Agent-First
## Document de pivot stratégique
### 2 mai 2026

---

## 1. CONTEXTE — POURQUOI CE PIVOT

### 1.1 Constat marché cloud humain

Le cloud chiffré pour humains est un marché saturé. Proton Drive (400+ employés, $100M+ levés) vient de sortir la visio. Ente Photos, Filen, pCloud, Tresorit, MEGA — des dizaines d'acteurs établis avec des équipes dev, du marketing, et des années d'avance.

Sérac en tant que "Google Photos chiffré français" se bat contre des géants pour chaque utilisateur. La route mail + visio + docs représentait 18+ mois de dev solo pour des produits que Proton shippe déjà.

### 1.2 Signal macro : l'ère des agents IA

Les agents IA autonomes (OpenClaw 247K★, Hermes Agent 32K★, Claude Code, Codex) redessinent les interactions numériques. David Lisnard (président AMF) a résumé le signal le 2 mai 2026 :

> "Après vingt ans de SEO, une nouvelle ère s'ouvre, celle de l'optimisation pour les intelligences artificielles autonomes."

Le marché agent :
- McKinsey projette $3-5T de commerce agentic d'ici 2030
- Gartner prévoit 40% des apps enterprise avec agents intégrés fin 2026
- Marché agentic AI : $7.8B → $52B projeté d'ici 2030 (44% CAGR)
- MCP (Model Context Protocol) : 97M+ téléchargements, standard de facto

### 1.3 Le trou dans le marché

Tous les services de stockage agent-native existants sont crypto-first :
- **Datos Network** — 15 nœuds décentralisés, USDC only, pas de compliance
- **Filecoin** — stockage décentralisé, lent, complexe
- **Walrus/MemWal** — $140M levés, beta, blockchain Sui
- **AWS S3 Files** — pas E2EE, pas souverain, pas agent-first

**Personne** ne fait : stockage E2EE + souverain EU + RGPD/HDS + MCP-native + paiement fiat.

### 1.4 Décision

**Virer** : mail, visio, docs collaboratifs — toute la roadmap "suite bureautique".

**Garder** : S3 chiffré E2E (Drive + Photos) + Glacier pour les humains.

**Construire** : couche agent-native (MCP server, API scopée, discovery, SDK, WebMCP, x402) comme produit principal.

---

## 2. CE QUI EXISTE DÉJÀ — ASSETS CONSERVÉS

### 2.1 Stack technique en production

| Couche | Technologie | Status |
|--------|------------|--------|
| Frontend | Next.js 16 (App Router) + Tailwind + shadcn/ui | ✅ Production |
| Backend | Fastify 5.x (TypeScript) | ✅ Production |
| BDD | PostgreSQL 16 (12 migrations) | ✅ Production |
| Cache | Redis 7 | ✅ Production |
| Crypto | @serac/crypto — libsodium WASM 0.7.15 | ✅ Production |
| Chiffrement | XChaCha20-Poly1305 E2EE | ✅ Production |
| Key exchange | X25519 (encryption) + Ed25519 (signing) | ✅ Production |
| Auth | Argon2id (encryption) + HKDF (auth) séparés, JWT | ✅ Production |
| Stockage | OVH Object Storage S3 Multi-AZ 3 zones Paris | ✅ Production |
| Archivage | OVH Cold Archive (Glacier/DEEP_ARCHIVE) | ✅ Production |
| Containers | Podman rootless (4 containers) | ✅ Production |
| Reverse proxy | Nginx + Let's Encrypt (TLS 1.2+, HSTS, CSP) | ✅ Production |
| Paiement | Stripe Billing (4 plans + webhooks) | ✅ Production |
| Email | Brevo SMTP (SPF+DKIM+DMARC) | ✅ Production |
| Anti-bot | Cloudflare Turnstile | ✅ Production |
| ML | Transformers.js CLIP ViT-B/32 client-side | ✅ Production |
| Monitoring | Plausible (self-hosted) + Uptime Kuma + Telegram alerts | ✅ Production |

### 2.2 Hiérarchie cryptographique

```
Passphrase → Argon2id (m=64Mo, t=3, p=4) → Master Key (client-only)
                         ├── HKDF("auth") → Auth Key → bcrypt → serveur
                         ├── X25519 keypair (chiffrement asymétrique)
                         ├── Ed25519 keypair (signature/attestation)
                         └── File Keys (XChaCha20-Poly1305, unique par fichier)
                              └── Embedding Keys (CLIP, même crypto)

Recovery Kit : 24 mots BIP39 → Argon2id → Recovery Key → chiffre Master Key
Partage : File Key chiffré avec X25519 pubkey du destinataire
Groupes : Group Key chiffrée avec X25519 pubkey de chaque membre
Albums partagés : Album Key dans le fragment URL (#), zero-knowledge
```

**Quantum-ready** : champ `key_algorithm` en BDD — migration ML-KEM/ML-DSA hybride sans casser les comptes existants.

### 2.3 BDD existante (12 tables)

`plans`, `users`, `sessions`, `files`, `photo_variants`, `groups`, `group_members`, `file_shares`, `restore_jobs`, `subscriptions`, `photo_embeddings`, `shared_albums`

### 2.4 Features humaines conservées

- Drive web : upload/download chiffré, dossiers, corbeille soft-delete 30j
- Photos : galerie, timeline, thumbnails/previews chiffrés, CLIP local
- Partage : entre utilisateurs (X25519) + liens publics chiffrés
- Albums partagés : clé dans le fragment URL, upload invité
- Glacier : archivage opt-in, restore async 24-48h
- 2FA TOTP
- Dashboard admin
- Over-quota grâce 30j (RGPD portabilité)

### 2.5 Audit de sécurité

74 findings identifiés, 71/74 résolus en 5 vagues de remédiation. 3 items restants sont opérationnels (pas de failles code).

### 2.6 Ce qui est viré de la roadmap

| Phase supprimée | Durée estimée | Raison |
|----------------|---------------|--------|
| Phase 2 — Messagerie (Signal protocol) | 3-4 mois | Proton, Signal, WhatsApp existent |
| Phase 3 — Email chiffré (modèle Proton) | 4-6 mois | Proton a 10 ans d'avance |
| Phase 4 — Docs collaboratifs (CRDT Yjs) | 6+ mois | Google Docs, Notion dominent |
| Phase 5 — Visio chiffrée (WebRTC SFU) | 6+ mois | Proton vient de la sortir |

**Temps récupéré : 17-22 mois de dev solo** réalloués au pivot agent.

---

## 3. LE PRODUIT — SÉRAC AGENT-FIRST

### 3.1 Positionnement

**Pour les humains** : Cloud chiffré souverain français. Upload, stocke, archive, partage. Simple.

**Pour les agents IA** : Le premier cloud E2EE européen conçu pour les agents IA autonomes. MCP-native. RGPD-compliant. Hébergé en France sur OVHCloud. Code auditable.

**Tagline** : "Sovereign encrypted storage for AI agents. MCP-native. E2EE. Built in France."

### 3.2 Pourquoi c'est le bon positionnement

| | Sérac | Datos Network | Filecoin/Walrus | AWS S3 |
|---|---|---|---|---|
| **Cible** | Pros EU + agents sérieux | Crypto-degens | Décentralisation maximale | Tout le monde |
| **Paiement** | SEPA + Stripe + x402 | USDC only | Token natif | CB/facture |
| **Compliance** | RGPD, HDS, eIDAS | Aucune | Aucune | Partielle (US) |
| **Infra** | OVH S3 3-AZ Paris | 15 nœuds ??? | Réseau décentralisé | AWS global |
| **Encryption** | XChaCha20-Poly1305 E2EE client-side | AES-256-GCM serveur | Chiffrement réseau | SSE (serveur) |
| **Juridiction** | France / droit EU | Inconnue | Aucune | US (Cloud Act) |
| **Discovery** | MCP + .well-known + WebMCP | SDK custom | SDK complexe | Console web |
| **Zero-knowledge** | ✅ Oui | ❌ Non (clés serveur) | Partiel | ❌ Non |

### 3.3 Cibles utilisateurs

**Agents autonomes** (OpenClaw, Hermes, Claude Code, Codex, custom)
- Stockage mémoire persistante cross-session
- Stockage skills, fichiers de travail, résultats
- Audit trail cryptographique de leurs actions
- Archivage Glacier des trajectoires d'entraînement

**Développeurs d'agents**
- API REST standard, pas de wallet requis
- SDK TypeScript/Python léger
- Attestation Ed25519 pour preuves d'intégrité
- MCP server plug-and-play

**Entreprises EU déployant des agents**
- RGPD natif, HDS-ready pour santé
- Paiement SEPA/facture
- Audit logs exportables
- Namespace isolation par agent/département

**Utilisateurs privacy-first** (marché existant conservé)
- Drive + Photos E2EE comme aujourd'hui
- Pas de changement pour eux

---

## 4. COMMENT UN AGENT DÉCOUVRE ET CONSOMME SÉRAC

### 4.1 Les 4 couches de découverte

Un agent n'a pas de yeux. Il découvre un service via des protocoles machine-readable, du plus passif au plus interactif :

#### Couche 1 — Discovery passive : `.well-known/mcp.json`

Fichier JSON statique sur serac.cloud. La roadmap MCP 2026 priorise ce standard pour la découverte sans connexion live. Équivalent du `robots.txt` pour agents.

```json
{
  "schema_version": "1.0",
  "name": "Sérac",
  "description": "Sovereign E2EE cloud storage for AI agents. RGPD-compliant. Hosted in France on OVHCloud.",
  "url": "https://serac.cloud",
  "mcp_endpoint": "https://mcp.serac.cloud/v1/sse",
  "api_endpoint": "https://api.serac.cloud/v1",
  "docs": "https://docs.serac.cloud",
  "tools": [
    {
      "name": "serac_store",
      "description": "Store encrypted data in an isolated namespace",
      "parameters": ["namespace", "key", "data", "ttl?"]
    },
    {
      "name": "serac_retrieve",
      "description": "Retrieve encrypted data by key",
      "parameters": ["namespace", "key"]
    },
    {
      "name": "serac_list",
      "description": "List keys in a namespace with optional prefix filter",
      "parameters": ["namespace", "prefix?", "limit?"]
    },
    {
      "name": "serac_delete",
      "description": "Delete a key from namespace",
      "parameters": ["namespace", "key"]
    },
    {
      "name": "serac_share",
      "description": "Share a key with another agent via X25519",
      "parameters": ["namespace", "key", "target_agent_pubkey", "ttl?", "permission"]
    },
    {
      "name": "serac_archive",
      "description": "Move data to Glacier cold storage (24-48h retrieval)",
      "parameters": ["namespace", "key"]
    },
    {
      "name": "serac_quota",
      "description": "Check storage usage and plan limits",
      "parameters": []
    },
    {
      "name": "serac_attest",
      "description": "Get Ed25519 attestation proof for a stored object",
      "parameters": ["namespace", "key"]
    }
  ],
  "auth": ["api_key", "oauth2.1"],
  "payment": ["stripe", "sepa", "x402_usdc"],
  "encryption": {
    "algorithm": "XChaCha20-Poly1305",
    "key_exchange": "X25519",
    "signing": "Ed25519",
    "key_derivation": "Argon2id",
    "zero_knowledge": true
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

#### Couche 2 — `.well-known/serac.json` (discovery custom)

Endpoint spécifique pour l'onboarding autonome d'agents. Un agent qui connaît Sérac peut s'auto-provisionner :

```json
{
  "onboarding": {
    "sdk_route": {
      "endpoint": "POST https://api.serac.cloud/v1/agents/register",
      "auth": "api_key or x402",
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
    "micro":      { "storage_gb": 10,   "reads_day": 1000,      "price_eur": 0.99 },
    "starter":    { "storage_gb": 100,  "reads_day": 10000,     "price_eur": 3.99 },
    "pro":        { "storage_gb": 500,  "reads_day": "unlimited","price_eur": 9.99 },
    "enterprise": { "storage_gb": 2000, "reads_day": "unlimited","price_eur": 29.99, "sla": true }
  },
  "glacier": {
    "price_per_gb_month_eur": 0.002,
    "restore_time": "24-48h"
  }
}
```

#### Couche 3 — MCP Server remote (Streamable HTTP)

Le cœur technique. Un serveur MCP distant hébergé sur l'infra Sérac, accessible via Streamable HTTP (le transport standard MCP pour les services distants). Sessions stateful, compatible avec tous les clients MCP (Claude Desktop, Cursor, Windsurf, OpenClaw, Hermes, Claude Code).

Configuration côté agent (exemple Claude Code / `mcp.json`) :
```json
{
  "mcpServers": {
    "serac": {
      "url": "https://mcp.serac.cloud/v1/sse",
      "headers": {
        "Authorization": "Bearer sk_serac_xxxxxxxxx"
      }
    }
  }
}
```

Configuration côté OpenClaw / Hermes (SKILL.md) :
```yaml
---
name: serac-storage
description: Sovereign E2EE storage on OVHCloud France
mcp:
  url: https://mcp.serac.cloud/v1/sse
  auth:
    type: api_key
    env: SERAC_API_KEY
---
```

#### Couche 4 — WebMCP (browser-native, W3C)

Standard W3C (Chrome 146+) où la page web elle-même expose des tools à un agent navigateur. Sérac enregistre des tools sur ses pages web pour que les agents browser (Claude in Chrome, Cursor browser, etc.) puissent interagir nativement.

Exemple : la page pricing de Sérac enregistre un tool WebMCP :
```javascript
// serac.cloud/pricing — WebMCP tool registration
navigator.modelContext.registerTool({
  name: "serac_subscribe",
  description: "Subscribe to a Sérac storage plan",
  parameters: {
    tier: { type: "string", enum: ["micro", "starter", "pro", "enterprise"] },
    payment_method: { type: "string", enum: ["stripe", "sepa"] }
  },
  handler: async ({ tier, payment_method }) => {
    // Redirige vers Stripe Checkout avec le bon plan
    const session = await createCheckoutSession(tier, payment_method);
    return { checkout_url: session.url };
  }
});

navigator.modelContext.registerTool({
  name: "serac_check_pricing",
  description: "Get current Sérac pricing and plan details",
  parameters: {},
  handler: async () => {
    return {
      plans: [
        { tier: "micro", storage: "10 GB", price: "€0.99/mo" },
        { tier: "starter", storage: "100 GB", price: "€3.99/mo" },
        { tier: "pro", storage: "500 GB", price: "€9.99/mo" },
        { tier: "enterprise", storage: "2 TB", price: "€29.99/mo" }
      ],
      glacier: "€0.002/GB/mo",
      encryption: "XChaCha20-Poly1305 E2EE",
      jurisdiction: "France"
    };
  }
});
```

Le contenu statique est aussi rendu agent-friendly via :
- `llms.txt` à la racine (résumé texte du service pour LLMs)
- Cloudflare Markdown endpoint (HTML → markdown optimisé pour agents)
- Schema.org / NLWeb annotations sur les pages clés

---

## 5. ARCHITECTURE TECHNIQUE — COUCHE AGENT

### 5.1 Nouvelles tables BDD

```sql
-- Migration 013: agent support
CREATE TABLE agent_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),  -- owner humain (nullable pour agents autonomes)
  agent_name TEXT NOT NULL,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('openclaw', 'hermes', 'claude_code', 'custom')),
  api_key_hash TEXT NOT NULL,  -- bcrypt du sk_serac_xxx
  api_key_prefix TEXT NOT NULL,  -- les 8 premiers chars pour identification
  namespace_id UUID NOT NULL UNIQUE,
  permissions JSONB NOT NULL DEFAULT '["store","retrieve","list","delete"]',
  spending_limit_monthly_cents INTEGER,
  current_month_usage_cents INTEGER DEFAULT 0,
  webhook_url TEXT,
  ed25519_pubkey TEXT,  -- pour attestation
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE agent_audit_log (
  id BIGSERIAL PRIMARY KEY,
  agent_id UUID REFERENCES agent_accounts(id),
  action TEXT NOT NULL,  -- store, retrieve, delete, share, archive, etc.
  namespace TEXT NOT NULL,
  key TEXT,
  bytes_transferred BIGINT DEFAULT 0,
  ed25519_signature TEXT,  -- signature de l'action
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Append-only : pas de UPDATE/DELETE sur cette table

CREATE TABLE agent_namespaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agent_accounts(id),
  name TEXT NOT NULL,
  encryption_key_encrypted TEXT NOT NULL,  -- namespace key chiffrée avec agent master key
  storage_used_bytes BIGINT DEFAULT 0,
  object_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_agent_time ON agent_audit_log(agent_id, created_at DESC);
CREATE INDEX idx_agent_apikey ON agent_accounts(api_key_prefix);
```

### 5.2 Flux crypto agent vs humain

**Humain (existant)** :
```
Passphrase → Argon2id → Master Key → dérive File Keys
                                    → X25519/Ed25519 keypairs
                                    → Recovery Kit 24 mots
```

**Agent autonome (nouveau)** :
```
SDK génère Master Key 256-bit (CSPRNG, pas de passphrase)
  → X25519 keypair (chiffrement inter-agent)
  → Ed25519 keypair (attestation/signature)
  → Namespace Keys (par namespace, dérivées de Master Key)
  
Owner humain reçoit :
  → Master Key chiffrée avec sa propre X25519 pubkey (escrow)
  → Peut déchiffrer les données de l'agent si nécessaire
  → L'agent ne peut PAS révoquer l'accès de l'owner
```

Le tradeoff E2EE pour les agents via MCP :
- **MCP server** = chiffrement at-rest (le serveur Sérac chiffre/déchiffre avec la namespace key). Plus simple, l'agent n'a pas besoin de libsodium.
- **SDK natif** = true E2EE client-side (l'agent chiffre avant envoi, Sérac ne voit jamais le clair). Plus sécurisé, mais nécessite libsodium côté agent.
- **Documenter explicitement** ce tradeoff pour les utilisateurs.

### 5.3 API REST agent-native

```
POST   /v1/agents/register          — Créer un compte agent (API key ou x402)
GET    /v1/agents/me                 — Info agent (quota, usage, tier)
PATCH  /v1/agents/me                 — Modifier (webhook, spending limit)
DELETE /v1/agents/me                 — Supprimer le compte agent

POST   /v1/ns/{namespace}/store      — Stocker un objet
GET    /v1/ns/{namespace}/{key}       — Récupérer un objet
GET    /v1/ns/{namespace}?prefix=     — Lister les clés
DELETE /v1/ns/{namespace}/{key}       — Supprimer un objet
POST   /v1/ns/{namespace}/{key}/share — Partager avec un autre agent
POST   /v1/ns/{namespace}/{key}/archive — Envoyer en Glacier

GET    /v1/agents/me/audit           — Consulter l'audit log
GET    /v1/ns/{namespace}/{key}/attest — Obtenir une attestation Ed25519

POST   /v1/agents/me/upgrade         — Changer de tier (programmatique)
GET    /v1/agents/me/billing          — Consulter facturation
```

Auth : header `Authorization: Bearer sk_serac_xxxxxxxxx` ou x402 USDC.

### 5.4 MCP Server — Tools exposés

Implémenté avec `@modelcontextprotocol/sdk` (TypeScript), tourne comme service Streamable HTTP sur `mcp.serac.cloud`.

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({
  name: "serac-storage",
  version: "1.0.0",
});

// Tool: store
server.tool(
  "serac_store",
  "Store encrypted data in your isolated namespace on OVHCloud France",
  {
    key: z.string().describe("Storage key (e.g. 'memory:user_prefs')"),
    data: z.string().describe("Data to store (JSON string or base64)"),
    ttl: z.number().optional().describe("TTL in seconds (0 = permanent)"),
  },
  async ({ key, data, ttl }, extra) => {
    // Auth via session token
    // Encrypt with namespace key
    // PUT to OVH S3
    // Log to audit
    const result = await storeObject(extra.sessionId, key, data, ttl);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }
);

// Tool: retrieve
server.tool(
  "serac_retrieve",
  "Retrieve encrypted data from your namespace",
  {
    key: z.string().describe("Storage key to retrieve"),
  },
  async ({ key }, extra) => {
    const data = await retrieveObject(extra.sessionId, key);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
    };
  }
);

// Tool: list
server.tool(
  "serac_list",
  "List keys in your namespace",
  {
    prefix: z.string().optional().describe("Key prefix filter"),
    limit: z.number().optional().default(100),
  },
  async ({ prefix, limit }, extra) => {
    const keys = await listKeys(extra.sessionId, prefix, limit);
    return {
      content: [{ type: "text", text: JSON.stringify(keys) }],
    };
  }
);

// Tool: delete
server.tool("serac_delete", "Delete a key", { key: z.string() },
  async ({ key }, extra) => {
    await deleteObject(extra.sessionId, key);
    return { content: [{ type: "text", text: `Deleted: ${key}` }] };
  }
);

// Tool: archive (Glacier)
server.tool(
  "serac_archive",
  "Archive data to Glacier cold storage (€0.002/GB/mo, 24-48h retrieval)",
  { key: z.string() },
  async ({ key }, extra) => {
    const result = await archiveToGlacier(extra.sessionId, key);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

// Tool: quota
server.tool("serac_quota", "Check your storage usage and limits", {},
  async (_, extra) => {
    const quota = await getQuota(extra.sessionId);
    return { content: [{ type: "text", text: JSON.stringify(quota) }] };
  }
);

// Tool: attest
server.tool(
  "serac_attest",
  "Get Ed25519 cryptographic attestation for a stored object",
  { key: z.string() },
  async ({ key }, extra) => {
    const proof = await generateAttestation(extra.sessionId, key);
    return { content: [{ type: "text", text: JSON.stringify(proof) }] };
  }
);
```

### 5.5 SDK agent (`serac-agent-sdk` — npm)

```typescript
// Installation : npm install serac-agent-sdk
import { SeracAgent } from 'serac-agent-sdk';

// Route 1 : API key (humain a créé le compte via dashboard)
const serac = new SeracAgent({
  apiKey: process.env.SERAC_API_KEY,
});

// Route 2 : Self-register (agent autonome)
const serac = await SeracAgent.register({
  name: 'my-research-agent',
  tier: 'starter',
  payment: {
    method: 'x402',
    walletKey: process.env.AGENT_WALLET_KEY,
  },
  // OU
  payment: {
    method: 'stripe',
    token: 'tok_xxx',  // token Stripe one-time
  },
});

// Stocker
await serac.store('memory', 'user:preferences', {
  theme: 'dark',
  language: 'fr',
  lastProject: 'report-q2'
});

// Récupérer
const prefs = await serac.retrieve('memory', 'user:preferences');

// Lister
const keys = await serac.list('memory', { prefix: 'user:' });

// Archiver en Glacier
await serac.archive('logs', 'session:2026-04-15');

// Attestation cryptographique
const proof = await serac.attest('memory', 'user:preferences');
// → { key, hash_sha256, timestamp, ed25519_signature, verify_url }

// Quota
const usage = await serac.quota();
// → { storage_used_bytes, storage_limit_bytes, plan: 'starter', ... }
```

---

## 6. PHASES DE BUILD

### Phase 0 — Nettoyage & Repositionnement (1 semaine)

| Tâche | Détail |
|-------|--------|
| Archiver roadmap mail/visio/docs | Supprimer des docs, garder en archive git |
| Mettre à jour serac.cloud | Nouveau messaging : cloud humain + agent |
| Créer `llms.txt` | Résumé texte du service pour crawlers LLM |
| Préparer sous-domaines | `mcp.serac.cloud`, `api.serac.cloud`, `docs.serac.cloud` |

### Phase 1 — MCP Server + API Agent (3 semaines)

**Objectif** : un agent OpenClaw/Hermes/Claude Code peut stocker et récupérer des données chiffrées sur Sérac via MCP.

| Semaine | Tâche | Détail |
|---------|-------|--------|
| S1 | Migration BDD | Tables `agent_accounts`, `agent_audit_log`, `agent_namespaces` (migration 013) |
| S1 | Routes API agent | `/v1/agents/register`, `/me`, CRUD namespace (`/v1/ns/`) |
| S1 | API key system | Génération `sk_serac_xxxx`, hash bcrypt, auth middleware agent |
| S2 | MCP Server core | `@modelcontextprotocol/sdk`, Streamable HTTP, tools store/retrieve/list/delete |
| S2 | Chiffrement namespace | Namespace key génération, chiffrement at-rest des objets, S3 backend |
| S2 | Audit log | Append-only logging de chaque action agent |
| S3 | Tools avancés | archive (Glacier), share (X25519), attest (Ed25519), quota |
| S3 | Tests | Tests d'intégration : enregistrement agent → store → retrieve → delete → audit |
| S3 | Déploiement | `mcp.serac.cloud` live, Nginx reverse proxy, TLS |

**Livrable** : config MCP une ligne → agent stocke sur OVH Paris chiffré.

### Phase 2 — Discovery, SDK & Onboarding (2 semaines)

| Semaine | Tâche | Détail |
|---------|-------|--------|
| S4 | `.well-known/mcp.json` | Fichier de discovery MCP standard |
| S4 | `.well-known/serac.json` | Discovery custom avec tiers, onboarding |
| S4 | `llms.txt` | Description textuelle pour LLMs |
| S4 | SDK npm | `serac-agent-sdk` TypeScript, publish sur npm |
| S5 | Publication registres | MCP Registry, mcpmarket.com, mcpservers.org, glama.ai |
| S5 | Documentation | docs.serac.cloud — guide agent, guide humain, API reference |
| S5 | OpenClaw skill | Skill Sérac pour ClawHub (SKILL.md prêt à installer) |
| S5 | Hermes skill | Skill Sérac pour agentskills.io |

**Livrable** : un agent peut découvrir Sérac automatiquement et s'onboarder.

### Phase 3 — WebMCP + Agent Pages (2 semaines)

| Semaine | Tâche | Détail |
|---------|-------|--------|
| S6 | WebMCP polyfill | Intégrer `@mcp-b/global` sur les pages Sérac |
| S6 | Tool registration pricing | `serac_check_pricing`, `serac_subscribe` |
| S6 | Tool registration dashboard | `serac_check_quota`, `serac_list_namespaces` |
| S6 | Schema.org annotations | Structured data sur pricing, features, compliance |
| S7 | Cloudflare Markdown | Activer le mode Markdown pour crawler agents |
| S7 | NLWeb endpoint | `/nlweb` — natural language queries sur le service |
| S7 | Tests browser | Tester avec Chrome Canary + WebMCP flag |

**Livrable** : un agent navigateur (Claude in Chrome, etc.) peut interagir avec serac.cloud nativement.

### Phase 4 — Dual Payment & x402 (2 semaines)

| Semaine | Tâche | Détail |
|---------|-------|--------|
| S8 | x402 serveur | Middleware Fastify : si pas d'API key → répondre HTTP 402 avec détails paiement USDC |
| S8 | Intégration Coinbase x402 | Vérification signature USDC, activation namespace |
| S8 | Self-billing agent | Routes `/v1/agents/me/upgrade`, `/billing` |
| S9 | Webhooks spending | Alertes quand un agent approche sa limite |
| S9 | Circuit breaker | Protection anti-drain (max X requêtes/minute, max Y€/jour) |

**Livrable** : un agent peut payer en USDC ou en euros, avec protections anti-abus.

### Phase 5 — Attestation, Trust & Compliance (2 semaines)

| Semaine | Tâche | Détail |
|---------|-------|--------|
| S10 | Ed25519 attestation | Endpoint `/attest` — preuve cryptographique qu'un objet existe à un instant T |
| S10 | Attestation vérifiable | URL publique de vérification `serac.cloud/verify/{signature}` |
| S10 | Export audit log | CSV/JSON export pour compliance |
| S11 | RGPD agent | Droit à l'effacement agent, portabilité namespace |
| S11 | Rate limiting avancé | Per-agent, per-namespace, per-tool |
| S11 | Monitoring agent | Dashboard admin : agents actifs, usage, alertes |

**Livrable** : compliance RGPD agent, attestation cryptographique vérifiable.

### Phase 6 — Agent Messaging (optionnel, 3 semaines)

Canal de notifications E2EE pour agents. Pas une messagerie humaine — un système de commands/résultats chiffré.

| Semaine | Tâche | Détail |
|---------|-------|--------|
| S12 | WebSocket agent | Connexion persistante pour notifications temps réel |
| S12 | Channels chiffrés | Canal owner→agent et agent→owner, E2EE X25519 |
| S13 | Webhooks outbound | Callbacks HTTP vers l'infra de l'agent |
| S13 | MCP notifications | Utiliser le mécanisme de notifications MCP natif |
| S14 | Integration Telegram | Forwarding alerts agent → Telegram owner |

---

## 7. PRICING AGENT

### 7.1 Grille

| Tier | Stockage | Reads/jour | Prix/mois | Min. engagement |
|------|----------|-----------|-----------|-----------------|
| Micro | 10 Go | 1 000 | 0,99€ | Aucun |
| Starter | 100 Go | 10 000 | 3,99€ | Aucun |
| Pro | 500 Go | Illimité | 9,99€ | Aucun |
| Enterprise | 2 To | Illimité + SLA | 29,99€ | Annuel |
| Glacier | Pay-as-you-go | N/A | 0,002€/Go/mo | Aucun |

### 7.2 Modes de paiement

- **Stripe** (CB) — pour humains et agents avec owner humain
- **SEPA** (virement) — pour entreprises EU
- **x402 USDC** (Base L2) — pour agents crypto-natifs autonomes
- **Facture** — pour enterprise (> 5 agents, négocié)

### 7.3 Différences vs concurrents

| | Sérac | Datos | AWS S3 | Backblaze B2 |
|---|---|---|---|---|
| 500 Go/mo | 9,99€ | $7.99 | ~$14-20 | $3.00 |
| Egress | **Gratuit** (OVH) | Gratuit | $0.09/GB | Gratuit* |
| E2EE client-side | ✅ | ❌ | ❌ | ❌ |
| Paiement fiat | ✅ | ❌ | ✅ | ✅ |
| RGPD natif | ✅ | ❌ | ❌ | ❌ |

---

## 8. TIMELINE GLOBALE

```
Mai 2026
├── S1-S1  Phase 0 : Nettoyage
├── S2-S4  Phase 1 : MCP Server + API Agent (MVP)

Juin 2026
├── S5-S6  Phase 2 : Discovery + SDK + Registres
├── S7-S8  Phase 3 : WebMCP + Agent Pages

Juillet 2026
├── S9-S10  Phase 4 : x402 + Dual Payment
├── S11-S12 Phase 5 : Attestation + Compliance

Août 2026 (optionnel)
├── S13-S15 Phase 6 : Agent Messaging
```

**MVP agent live : fin mai 2026** (Phase 1 complète)
**Produit complet : mi-juillet 2026** (Phases 0-5)

---

## 9. RISQUES ET MITIGATIONS

| Risque | Probabilité | Impact | Mitigation |
|--------|------------|--------|------------|
| Marché agent trop tôt (volume insuffisant) | Moyenne | Haut | Le produit humain (Drive/Photos) reste, revenu existant |
| MCP spec change (breaking changes) | Basse | Moyen | SDK abstrait le protocole, migration isolée |
| OVH augmente les prix (+5-10% sept 2026) | Haute | Bas | Marges suffisantes, pricing ajustable |
| Concurrent EU lance le même service | Basse | Moyen | First-mover + code auditable + compliance HDS |
| Attaque/abus via agents malveillants | Moyenne | Haut | Rate limiting, spending limits, circuit breakers, audit log |
| x402 ne décolle pas (adoption crypto faible) | Haute | Bas | x402 est optionnel, fiat est le défaut |
| WebMCP reste expérimental longtemps | Moyenne | Bas | Couche 4 est un bonus, pas le cœur |

---

## 10. MÉTRIQUES DE SUCCÈS

### Court terme (3 mois post-launch)
- 50+ agents enregistrés
- 5+ skills publiés (ClawHub, agentskills.io)
- MCP server listé sur 3+ registres
- 1+ article/mention technique (HN, dev.to, blog)

### Moyen terme (6 mois)
- 500+ agents actifs
- 10+ entreprises EU payantes
- €1000+/mois ARR agent (en plus du revenu humain existant)
- Attestation Ed25519 utilisée en production

### Long terme (12 mois)
- Certification HDS effective
- SDK Python en plus de TypeScript
- Partenariats frameworks agents (OpenClaw, Hermes)
- Position de référence "sovereign agent storage EU"

---

## 11. LE NARRATIF

### Pour les agents et devs (anglais, international)

> **Sérac** — Sovereign encrypted storage for AI agents.
> MCP-native. E2EE. RGPD-compliant. No wallet required. No KYC. No US jurisdiction.
> Your agent's memory stays encrypted in France.
> `npm install serac-agent-sdk` — store data in 3 lines of code.

### Pour le marché français (politique/souveraineté)

> **Sérac** — Cloud chiffré français pour l'ère des agents IA.
> La France à la table des bâtisseurs, pas des spectateurs.
> OVHCloud + chiffrement E2E + conformité RGPD/HDS.
> Le premier cloud souverain européen conçu pour les agents IA autonomes.

### Pour les entreprises EU

> Vos agents IA stockent des données sensibles. Où sont-elles ?
> Pas sur AWS (Cloud Act). Pas sur un réseau crypto de 15 nœuds.
> Sur OVHCloud, à Paris, chiffrées de bout en bout, conformes RGPD.
> Sérac : l'infrastructure de confiance pour vos agents.

---

*Document de référence pour le pivot Sérac Agent-First.*
*Aiko — 2 mai 2026*
