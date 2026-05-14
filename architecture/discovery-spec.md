# Discovery Specification — Serac Agents

**Date** : Mai 2026  
**Statut** : Draft  
**ADR associé** : ADR-008  
**Prérequis** : ADR-002 (MCP Server Spec)

---

## 1. Vue d'ensemble

Serac Agents expose 4 couches de discovery permettant aux agents IA de trouver et configurer le service de stockage chiffré. Ce document détaille les 3 couches V1 et prépare la couche V2 (WebMCP).

**Principe** : un agent doit pouvoir découvrir, configurer et utiliser Serac en moins de 5 minutes, sans intervention humaine après la première configuration API key.

---

## 2. Couche 1 — `.well-known/mcp.json`

### 2.1 Objectif

Discovery passive. Un agent qui connaît `serac.cloud` peut vérifier si un MCP server est disponible à cette adresse.

### 2.2 Spécification

**URL** : `https://serac.cloud/.well-known/mcp.json`

**Format** : MCP Discovery (brouillon IETF, aligné avec `modelcontextprotocol.io`).

```json
{
  "version": "1.0",
  "servers": [
    {
      "name": "serac-agents",
      "description": "Sovereign E2E-encrypted cloud storage for AI agents — OVHCloud France",
      "url": "https://mcp.serac.cloud/v1",
      "transport": "streamable-http",
      "authentication": {
        "type": "bearer",
        "description": "API key (sk_serac_xxxxx) or JWT token"
      },
      "capabilities": {
        "tools": ["serac_store", "serac_retrieve", "serac_list", "serac_delete", "serac_quota"],
        "streaming": false,
        "notifications": false
      },
      "icon": "https://serac.cloud/icon-512.png",
      "documentation": "https://serac.cloud/docs/mcp",
      "terms": "https://serac.cloud/terms",
      "privacy": "https://serac.cloud/privacy"
    }
  ]
}
```

### 2.3 Headers de réponse

```
Content-Type: application/json
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=3600
X-Content-Type-Options: nosniff
```

### 2.4 Sécurité

- CORS ouvert (`Access-Control-Allow-Origin: *`) — nécessaire pour les agents browser-side
- Pas de données sensibles dans le JSON (pas de clés, pas de tokens)
- HTTPS uniquement (redirection HTTP → HTTPS via Caddy)

### 2.5 Implémentation

Fichier statique servi par Caddy (pas de route Fastify). Mise à jour uniquement lors d'un changement de version MCP.

```
# Caddyfile
serac.cloud {
    handle /.well-known/mcp.json {
        root * /var/www/serac
        file_server
        header Content-Type application/json
        header Access-Control-Allow-Origin *
        header Cache-Control "public, max-age=3600"
    }
    # ... autres routes
}
```

---

## 3. Couche 2 — `.well-known/serac.json`

### 3.1 Objectif

Onboarding automatique. Un agent qui découvre Serac peut s'enregistrer programmatiquement en lisant ce document, qui décrit les tiers, capacités, et point d'entrée d'enregistrement.

### 3.2 Spécification

**URL** : `https://serac.cloud/.well-known/serac.json`

```json
{
  "version": "1.0",
  "service": "serac-agents",
  "description": "Sovereign E2E-encrypted cloud storage for AI agents",
  "url": "https://api.serac.cloud/v1",
  "mcp_url": "https://mcp.serac.cloud/v1",
  "documentation": "https://serac.cloud/docs",
  "registration": {
    "url": "https://api.serac.cloud/v1/vaults/create",
    "method": "POST",
    "authentication": "api_key",
    "fields": {
      "agent_name": "string (required, 1-64 chars, alphanumeric + -)",
      "plan": "free | starter | pro | fleet",
      "public_key": "ed25519 public key (base64, 32 bytes)",
      "encrypted_master_key": "sealed box encrypted MK (base64, 48 bytes)",
      "key_commitment": "blake2b commitment (base64, 32 bytes)",
      "key_algorithm": "ed25519-x25519-xsalsa20poly1305",
      "owner_email": "string (optional, for guardian V1)",
      "payment": {
        "method": "stripe",
        "token": "string (required for paid plans)"
      }
    },
    "response": {
      "vault_id": "string (uuid)",
      "access_token": "string (jwt, TTL 1h)",
      "plan": "string",
      "storage_limit_bytes": "number"
    }
  },
  "plans": [
    {
      "name": "free",
      "storage_bytes": 5368709120,
      "price_cents": 0,
      "description": "5 Go free, forever"
    },
    {
      "name": "starter",
      "storage_bytes": 107374182400,
      "price_cents": 399,
      "price_monthly_eur": "3.99",
      "description": "100 Go, E2E encryption, tiering"
    },
    {
      "name": "pro",
      "storage_bytes": 536870912000,
      "price_cents": 999,
      "price_monthly_eur": "9.99",
      "description": "500 Go, priority support, search V2"
    },
    {
      "name": "fleet",
      "storage_bytes": 2199023255552,
      "price_cents": 2999,
      "price_monthly_eur": "29.99",
      "description": "2 To, multi-namespace, SLA"
    }
  ],
  "capabilities": {
    "encryption": ["mcp", "e2ee"],
    "tools": ["serac_store", "serac_retrieve", "serac_list", "serac_delete", "serac_quota"],
    "v2_tools": ["serac_search", "serac_share", "serac_attest", "serac_archive", "serac_versions"],
    "protocols": ["mcp-streamable-http", "rest"],
    "storage_classes": ["standard", "infrequent-access", "active-archive", "cold-archive"],
    "tiering": "automatic",
    "egress": "free",
    "regions": ["eu-west-gra", "eu-west-sbg", "eu-par"]
  },
  "contact": {
    "support": "support@serac.cloud",
    "status": "https://status.serac.cloud"
  }
}
```

### 3.3 Champs obligatoires vs optionnels

| Champ | Obligatoire | Description |
|-------|------------|-------------|
| `version` | ✅ | Version du schema serac.json |
| `service` | ✅ | Nom du service |
| `url` | ✅ | API base URL |
| `mcp_url` | ✅ | MCP server URL |
| `registration` | ✅ | Point d'entrée auto-enrollment |
| `plans` | ✅ | Tiers disponibles |
| `capabilities` | ✅ | Fonctionnalités supportées |
| `documentation` | ⬜ | Lien vers la doc |
| `contact` | ⬜ |

### 3.4 Implémentation

Fichier statique JSON, versionné avec le déploiement. Mise à jour lors des changements de plans, outils ou capacités.

Servi via Caddy avec les mêmes headers que `.well-known/mcp.json`.

---

## 4. Couche 3 — MCP Server Remote (HTTP Streamable)

### 4.1 Objectif

Connexion directe via l'URL du MCP server. C'est le mode principal de fonctionnement pour les agents configurés avec un outil MCP.

### 4.2 Configuration Hermes Agent

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  serac:
    url: "https://mcp.serac.cloud/v1"
    headers:
      Authorization: "Bearer sk_serac_xxxxx"
```

### 4.3 Configuration Claude Code / Cursor / Windsurf

```json
// .mcp.json ou mcp.json
{
  "mcpServers": {
    "serac": {
      "url": "https://mcp.serac.cloud/v1",
      "headers": {
        "Authorization": "Bearer sk_serac_xxxxx"
      }
    }
  }
}
```

### 4.4 Configuration Python (CrewAI, LangGraph, OpenAI Agents SDK)

```python
# Via le SDK Python
from serac_mcp import SeracAgent

serac = SeracAgent(
    api_key="sk_serac_xxxxx",
    base_url="https://api.serac.cloud/v1",
    encryption="e2ee",  # ou "mcp"
)
```

### 4.5 MCP Protocol Exchange

Le MCP server supporte le protocole HTTP Streamable (MCP spec 2025-03).

**Initialisation** :

```json
// Client → Server
POST /v1
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": {
      "name": "hermes-agent",
      "version": "0.11.0"
    }
  }
}

// Server → Client
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-03-26",
    "capabilities": {
      "tools": {
        "listChanged": false
      }
    },
    "serverInfo": {
      "name": "serac-agents-mcp",
      "version": "1.0.0"
    }
  }
}
```

**Liste des outils** :

```json
// Client → Server
POST /v1
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}

// Server → Client
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "serac_store",
        "description": "Store an encrypted object in a namespace",
        "inputSchema": {
          "type": "object",
          "properties": {
            "namespace": { "type": "string", "description": "Namespace name", "default": "default" },
            "key": { "type": "string", "description": "Object key (max 256 chars)" },
            "data": { "type": "string", "description": "Object data (base64-encoded for binary)" },
            "ttl": { "type": "integer", "description": "TTL in seconds (0=permanent)" },
            "encryption": { "type": "string", "enum": ["mcp", "e2ee"], "default": "mcp" }
          },
          "required": ["key", "data"]
        }
      },
      {
        "name": "serac_retrieve",
        "description": "Retrieve an encrypted object by key",
        "inputSchema": { /* ... */ }
      },
      {
        "name": "serac_list",
        "description": "List keys in a namespace",
        "inputSchema": { /* ... */ }
      },
      {
        "name": "serac_delete",
        "description": "Delete an object (soft delete by default)",
        "inputSchema": { /* ... */ }
      },
      {
        "name": "serac_quota",
        "description": "Check storage quota and usage",
        "inputSchema": { /* ... */ }
      }
    ]
  }
}
```

**Appel d'outil** :

```json
// Client → Server
POST /v1
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "serac_store",
    "arguments": {
      "namespace": "memory",
      "key": "user:prefs",
      "data": "{\"theme\":\"dark\",\"language\":\"fr\"}",
      "ttl": 0,
      "encryption": "e2ee"
    }
  }
}

// Server → Client (mode E2EE)
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"key\":\"user:prefs\",\"namespace\":\"memory\",\"size_bytes\":42,\"version\":1,\"tier\":\"standard\",\"stored_at\":\"2026-05-14T12:00:00Z\"}"
      }
    ]
  }
}
```

### 4.6 Authentification sur le MCP transport

Chaque requête MCP inclut le header `Authorization: Bearer <token>` :
- Premier appel : API key `sk_serac_xxxxx`
- Appels suivants : JWT obtenu via challenge-response (ADR-005)

Le server remplace l'API key par un JWT après le premier appel réussi. Le client gère le renouvellement automatiquement (SDK).

### 4.7 Rate limiting par tier

| Tier | Requêtes/minute | Stockage/l heure | Bande passante/jour |
|------|----------------|-------------------|---------------------|
| Free | 30 | 100 | 1 Go |
| Starter | 100 | 1000 | 10 Go |
| Pro | 300 | 5000 | 50 Go |
| Fleet | 1000 | 20000 | Illimité |

Headers de réponse :
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1715664000
Retry-After: 60  # seulement si 429
```

---

## 5. Couche 4 — WebMCP (Phase 3)

### 5.1 Objectif

Discovery native via le navigateur. Quand un agent tourne dans un browser (ex: Chrome avec WebMCP intégré), il peut découvrir Serac automatiquement sans configuration.

### 5.2 Statut

WebMCP est un draft W3C. Chrome 146+ a une implémentation expérimentale. La spec n'est pas stabilisée.

### 5.3 Planifié

- **Phase 1-2** : Pas de WebMCP. Les couches 1-3 suffisent.
- **Phase 3** : Ajouter le polyfill `@mcp-b/global` pour les agents browser-side qui veulent découvrir Serac via `navigator.mcp`.
- **Phase 4+** : WebMCP natif quand Chrome stabilise et Firefox/Safari adoptent.

### 5.4 Polyfill (Phase 3)

```javascript
// Installation du polyfill
import { MCPClient } from '@mcp-b/global';

const client = new MCPClient({
  servers: {
    'serac-agents': {
      url: 'https://mcp.serac.cloud/v1',
      authentication: {
        type: 'bearer',
        token: process.env.SERAC_API_KEY
      }
    }
  }
});

// Discovery
const servers = await client.discover('https://serac.cloud');
// → détecte .well-known/mcp.json et .well-known/serac.json
```

### 5.5 Intégration future

Quand WebMCP sera natif dans les navigateurs majeurs :

1. L'agent browser-side appelle `navigator.mcp.discover('serac.cloud')`
2. Le browser lit `.well-known/mcp.json`
3. L'agent configure le MCP server automatiquement
4. L'agent stocke et récupère des données via Serac sans aucune configuration manuelle

---

## 6. MCP Registries (diffusion)

### 6.1 Objectif

Publier Serac Agents sur les registries MCP pour que les agents qui ne connaissent pas `serac.cloud` puissent le découvrir.

### 6.2 Registries cibles V1

| Registry | URL | Statut |
|----------|-----|--------|
| MCP Registry | `registry.modelcontextprotocol.io` | À créer |
| Smithery | `smithery.ai` | À créer |
| Glama | `glama.ai` | À créer |

### 6.3 Metadata pour les registries

```json
{
  "name": "serac-agents",
  "display_name": "Serac Agents",
  "description": "Sovereign E2E-encrypted cloud storage for AI agents — France",
  "url": "https://mcp.serac.cloud/v1",
  "transport": "streamable-http",
  "authentication": "bearer",
  "categories": ["storage", "encryption", "cloud", "e2e", "sovereignty"],
  "tags": ["storage", "encrypted", "e2e", "zero-knowledge", "agent-native", "france", "ovh", "mcp"],
  "pricing": {
    "free_tier": "5 Go",
    "paid_plans_from": "€3.99/month"
  },
  "documentation": "https://serac.cloud/docs/mcp",
  "repository": "https://github.com/AikoGilpin/serac-agents",
  "maintainer": {
    "name": "Serac",
    "email": "support@serac.cloud",
    "website": "https://serac.cloud"
  },
  "security": {
    "encryption": "E2E optional, at-rest mandatory",
    "data_location": "France (OVH Gravelines/Strasbourg/Paris)",
    "zero_knowledge": true,
    "compliance": ["GDPR"]
  }
}
```

### 6.4 SEO pour agents

Page `https://serac.cloud/agents` avec :
- OpenAPI 3.1 spec (`/docs/openapi.json`)
- Schema.org `SoftwareApplication` markup
- README GitHub avec keywords MCP, E2E, agent, storage
- Lien vers les trois registries

Les agents qui cherchent "E2E encrypted cloud storage for agents" doivent trouver Serac.

---

## 7. Séquence de discovery complète

```
Agent démarre
  │
  ├─ L'humain a configuré l'API key ? ── OUI ──► Connexion directe (Couche 3)
  │                                           (MCP Remote HTTP Streamable)
  │
  └─ NON
     │
     ├─ L'agent connaît "serac.cloud" ? ── OUI ──► GET .well-known/serac.json
     │                                            (Couche 2 → auto-registration)
     │
     └─ NON
        │
        ├─ L'agent cherche un registry ? ── OUI ──► MCP Registry / Smithery / Glama
        │                                           (Couche registries)
        │
        └─ NON
           │
           └─ L'agent est browser-side ? ── OUI ──► WebMCP discover()
                                                    (Couche 4, Phase 3)
```

---

## 8. Checklist d'implémentation V1

- [ ] `.well-known/mcp.json` — fichier statique, servi par Caddy
- [ ] `.well-known/serac.json` — fichier statique, servi par Caddy
- [ ] MCP server HTTP Streamable — route `/v1` sur `mcp.serac.cloud`
- [ ] Health check — `GET /v1/health` retourne `{"status": "ok"}`
- [ ] Auth middleware — API key → JWT + challenge-response
- [ ] Rate limiting — par tier, headers X-RateLimit-*
- [ ] TLS — HTTPS uniquement via Caddy + Cloudflare
- [ ] MCP Registry — soumission à `registry.modelcontextprotocol.io`
- [ ] Smithery — soumission à `smithery.ai`
- [ ] Glama — soumission à `glama.ai`
- [ ] Page `/agents` — OpenAPI 3.1 + Schema.org + README
- [ ] DNS — `mcp.serac.cloud` et `api.serac.cloud` enregistrés

Phase 3 seulement :
- [ ] WebMCP polyfill `@mcp-b/global`
- [ ] `navigator.mcp.discover()` testing

---

*Spécification discovery Serac Agents — 4 couches.*  
*Kira — Mai 2026*