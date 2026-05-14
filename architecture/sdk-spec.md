# ADR-004 — Spécification SDK Client Serac Agents

**Date** : Mai 2026  
**Statut** : Draft  
**Prérequis** : ADR-001 (Encryption Protocol), ADR-002 (MCP Server Spec), ADR-003 (Pricing Model)

---

## 1. Vue d'ensemble

Le SDK Serac Agents est l'interface programmatique permettant aux agents IA de stocker, récupérer et gérer des données chiffrées sur Sérac. Il gère de manière transparente le chiffrement (mode E2EE), l'authentification, et la communication avec le MCP server.

**Deux SDK en parallèle** :
- `serac-agent-sdk` (TypeScript/Node.js) — npm, aligné avec la stack Serac existante
- `serac-mcp` (Python) — pip, aligné avec les frameworks agents (Hermes, OpenClaw)

Les deux SDK partagent le même cœur cryptographique (libsodium) et sont interopérables (vecteurs de test ADR-001 section 10).

---

## 2. Principes de design

### 2.1 API unifiée, deux modes de chiffrement

Le SDK propose une API identique en mode MCP (at-rest, serveur chiffre) et mode E2EE (client-side, agent chiffre). Le mode est sélectionné à l'initialisation.

```typescript
// Mode MCP (at-rest) — simple, pas de crypto côté agent
const serac = new SeracAgent({ apiKey: process.env.SERAC_API_KEY });

// Mode E2EE (client-side) — true zero-knowledge
const serac = new SeracAgent({
  apiKey: process.env.SERAC_API_KEY,
  encryption: 'e2ee',  // Génération/import keypair locale
});
```

### 2.2 Convention de nommage

- **TypeScript** : `serac-agent-sdk` (npm), import `{ SeracAgent }`
- **Python** : `serac-mcp` (pip), import `SeracAgent`
- **MCP tools** : `serac_store`, `serac_retrieve`, etc. (noms inchangés entre SDK et MCP)
- **API REST** : `/v1/ns/{namespace}/{key}` (noms REST, pas de conflit avec les tools MCP)

### 2.3 Zéro dépendance crypto externe en mode MCP

En mode MCP, l'agent n'a besoin que de :
- `fetch` ou `axios` (HTTP)
- Pas de libsodium, pas de crypto complexe

En mode E2EE, l'agent a besoin de :
- `libsodium-wrappers` (TypeScript) ou `PyNaCl` (Python)

---

## 3. SDK TypeScript — `serac-agent-sdk`

### 3.1 Installation

```bash
npm install serac-agent-sdk
```

### 3.2 Initialisation

```typescript
import { SeracAgent } from 'serac-agent-sdk';

// Mode MCP (at-rest) — recommandé pour la plupart des agents
const serac = new SeracAgent({
  apiKey: process.env.SERAC_API_KEY,   // sk_serac_xxxxx
  baseUrl: 'https://api.serac.cloud/v1', // optionnel, défaut
  encryption: 'mcp',                    // 'mcp' | 'e2ee', défaut 'mcp'
});

// Mode E2EE (true zero-knowledge)
const seracE2EE = new SeracAgent({
  apiKey: process.env.SERAC_API_KEY,
  encryption: 'e2ee',
  // Optionnel : fournir keypair existante
  // ed25519PrivateKey: Buffer.from('...'),
  // ed25519PublicKey: '...',
});

// Auto-enregistrement (agent autonome)
const seracNew = await SeracAgent.register({
  agentName: 'my-research-agent',
  tier: 'starter',
  payment: {
    method: 'stripe',
    token: 'tok_visa_xxx',
  },
  ownerEmail: 'aiko@serac.cloud',  // optionnel, pour guardian
});
```

### 3.3 Opérations V1

#### Store

```typescript
// Stocker un objet
const result = await serac.store('memory', 'user:prefs', {
  theme: 'dark',
  language: 'fr',
  lastProject: 'report-q2',
}, {
  ttl: 0,              // 0 = permanent (défaut)
  namespace: 'default', // optionnel
});

// Résultat
// {
//   key: 'user:prefs',
//   namespace: 'default',
//   size_bytes: 1024,
//   version: 1,
//   tier: 'standard',
//   stored_at: '2026-05-14T12:00:00Z'
// }
```

#### Retrieve

```typescript
// Récupérer un objet
const data = await serac.retrieve('memory', 'user:prefs');

// Récupérer une version spécifique (V2 — versioning)
// const data = await serac.retrieve('memory', 'user:prefs', { version: 2 });
```

#### List

```typescript
// Lister les clés d'un namespace
const keys = await serac.list('memory', {
  prefix: 'user:',      // filtre optionnel
  limit: 100,           // max 1000
});

// Résultat
// {
//   keys: [
//     { key: 'user:prefs', size_bytes: 1024, version: 1, stored_at: '...' },
//     { key: 'user:history', size_bytes: 4096, version: 3, stored_at: '...' },
//   ],
//   total: 2,
//   has_more: false,
// }
```

#### Delete

```typescript
// Soft delete (défaut, 30 jours de récupération)
const deleted = await serac.delete('memory', 'user:old-data');

// Permanent delete (irréversible)
const permanentlyDeleted = await serac.delete('memory', 'user:sensitive', {
  permanent: true,
});
```

#### Quota

```typescript
const quota = await serac.quota();

// Résultat
// {
//   plan: 'starter',
//   storage_used_bytes: 5368709120,
//   storage_limit_bytes: 107374182400,
//   usage_percent: 5.0,
//   reads_today: 142,
//   reads_limit: 10000,
//   namespaces: [
//     { name: 'default', used_bytes: 4294967296, object_count: 47 },
//     { name: 'logs', used_bytes: 1073741824, object_count: 1203 },
//   ],
//   billing: {
//     current_period_end: '2026-06-14',
//     amount_cents: 399,
//   },
// }
```

### 3.4 Opérations V2 (post-MVP)

```typescript
// Search sémantique (V2)
const results = await serac.search('memory', 'project report q2', { limit: 10 });

// Partager (V2)
const shareResult = await serac.share('memory', 'user:prefs', {
  targetPublicKey: 'ed25519_xxx...',  // X25519 du destinataire
  permission: 'read', // 'read' | 'write'
  ttl: 3600,          // optionnel, en secondes
});

// Archiver en Glacier (V2)
const archiveResult = await serac.archive('logs', 'session:2026-04-15');

// Attestation cryptographique (V2)
const proof = await serac.attest('memory', 'user:prefs');

// Historique des versions (V2)
const versions = await serac.versions('memory', 'user:prefs');
```

### 3.5 Gestion des namespaces

```typescript
// Créer un namespace
const ns = await serac.createNamespace('logs');

// Lister les namespaces
const namespaces = await serac.listNamespaces();

// Supprimer un namespace (soft delete)
await serac.deleteNamespace('old-logs');
```

### 3.6 Authentification JWT (auto-refresh)

Le SDK gère automatiquement le renouvellement du JWT :

```typescript
// Le SDK obtient un JWT via l'API key au premier appel
// puis le renouvelle automatiquement 5 minutes avant l'expiration
// via challenge-response Ed25519 (si keypair dispo) ou re-auth API key

const serac = new SeracAgent({
  apiKey: process.env.SERAC_API_KEY,
  autoRefresh: true,  // défaut: true
});
```

### 3.7 Événements et errores

```typescript
import { SeracAgent, SeracError, QuotaExceededError, AuthenticationError } from 'serac-agent-sdk';

try {
  await serac.store('memory', 'test', { data: 'hello' });
} catch (error) {
  if (error instanceof QuotaExceededError) {
    // Quota dépassé — upgrade nécessaire
    console.log(`Quota: ${error.currentBytes}/${error.limitBytes} bytes`);
  } else if (error instanceof AuthenticationError) {
    // API key invalide ou JWT expiré
  } else if (error instanceof SeracError) {
    // Erreur générale Serac
    console.log(`Code: ${error.code}, Message: ${error.message}`);
  }
}
```

Codes d'erreur HTTP :

| Code | Signification | Action SDK |
|------|---------------|-----------|
| 401 | API key invalide | Lever `AuthenticationError` |
| 403 | Quota dépassé | Lever `QuotaExceededError` |
| 404 | Namespace ou clé non trouvé | Lever `NotFoundError` |
| 409 | Conflit (clé déjà existante avec PUT) | Lever `ConflictError` |
| 429 | Rate limit | Retry avec exponential backoff |
| 500 | Erreur serveur | Retry (max 3) avec exponential backoff |
| 503 | Service indisponible | Retry avec exponential backoff |

---

## 4. SDK Python — `serac-mcp`

### 4.1 Installation

```bash
pip install serac-mcp
```

### 4.2 Initialisation

```python
from serac_mcp import SeracAgent

# Mode MCP (at-rest)
serac = SeracAgent(
    api_key=os.environ["SERAC_API_KEY"],
    base_url="https://api.serac.cloud/v1",  # optionnel
    encryption="mcp",                         # "mcp" | "e2ee"
)

# Mode E2EE
serac_e2ee = SeracAgent(
    api_key=os.environ["SERAC_API_KEY"],
    encryption="e2ee",
)

# Auto-enregistrement
serac_new = await SeracAgent.register(
    agent_name="my-research-agent",
    tier="starter",
    payment={"method": "stripe", "token": "tok_visa_xxx"},
    owner_email="aiko@serac.cloud",
)
```

### 4.3 Opérations V1

```python
# Store
result = await serac.store("memory", "user:prefs", {
    "theme": "dark",
    "language": "fr",
    "lastProject": "report-q2",
}, ttl=0, namespace="default")

# Retrieve
data = await serac.retrieve("memory", "user:prefs")

# List
keys = await serac.list("memory", prefix="user:", limit=100)

# Delete
deleted = await serac.delete("memory", "user:old-data")
permanently_deleted = await serac.delete("memory", "user:sensitive", permanent=True)

# Quota
quota = await serac.quota()
```

### 4.4 Interface async/await

Le SDK Python est entièrement asynchrone (basé sur `httpx` ou `aiohttp`). Un wrapper synchrone est disponible pour les agents qui n'utilisent pas d'event loop :

```python
# Wrapper synchrone
from serac_mcp import SyncSeracAgent

serac = SyncSeracAgent(api_key=os.environ["SERAC_API_KEY"])
result = serac.store("memory", "test", {"data": "hello"})
```

### 4.5 Types

```python
from dataclasses import dataclass
from typing import Optional, List

@dataclass
class SeracStoreResult:
    key: str
    namespace: str
    size_bytes: int
    version: int
    tier: str
    stored_at: str

@dataclass
class SeracQuota:
    plan: str
    storage_used_bytes: int
    storage_limit_bytes: int
    usage_percent: float
    reads_today: int
    reads_limit: Optional[int]
    namespaces: List[NamespaceInfo]
    billing: BillingInfo

@dataclass
class SeracError(Exception):
    code: str
    message: str
    status_code: int

class QuotaExceededError(SeracError): pass
class AuthenticationError(SeracError): pass
class NotFoundError(SeracError): pass
class ConflictError(SeracError): pass
```

---

## 5. Chiffrement — Détails d'implémentation

### 5.1 Mode MCP (at-rest)

Le SDK envoie les données en clair au MCP server. Le serveur chiffre avec la namespace key avant stockage S3.

```typescript
// Mode MCP — pas de chiffrement côté client
// Agent → SDK (plaintext) → MCP Server → encrypt(namespace_key) → S3
```

**Avertissement** : en mode MCP, le serveur voit le contenu en clair pendant le transit et le traitement. Documenté explicitement dans les docs et le `.well-known/mcp.json`.

### 5.2 Mode E2EE (client-side)

Le SDK chiffre localement avant envoi. Le serveur ne voit jamais le contenu en clair.

```typescript
// Mode E2EE — chiffrement client-side
// Agent → SDK.encrypt(master_key, data) → serac_store(key, ciphertext) → S3
// Agent ← serac_retrieve(key) ← SDK.decrypt(master_key, ciphertext) ← S3
```

**Flux E2EE détaillé** :

1. À l'initialisation, le SDK charge la Master Key (MK) depuis le keystore local
2. Pour `store` :
   - Dérive une File Key unique : `key = blake2b(mk + namespace + object_key, 32)`
   - Chiffre les données : `ciphertext = xchacha20_poly1305(file_key, data, nonce=random)`
   - Calcule le commitment : `commitment = blake2b(file_key, 32)`
   - Envoie `{ key, ciphertext, commitment }` au serveur
3. Pour `retrieve` :
   - Récupère le ciphertext du serveur
   - Redérive la File Key : `key = blake2b(mk + namespace + object_key, 32)`
   - Déchiffre : `plaintext = xchacha20_poly1305_open(file_key, ciphertext, nonce)`
   - Vérifie le commitment

### 5.3 Réutilisation de @serac/crypto

**Fonctions existantes réutilisées** (22, inchangées) :
- `generateFileKey`, `wrapFileKey`, `unwrapFileKey`
- `computeKeyCommitment`, `verifyKeyCommitment`
- `encryptFile`, `decryptFile` (streaming, 64KB chunks)
- `encryptForRecipient`, `decryptFromSender` (X25519 sharing)
- `hash`, `randomBytes`, `toHex`, `fromHex`

**Fonctions adaptées** (4) :
- `encryptIdentity` → `encryptAgentMasterKey` (sealed box avec X25519)
- `decryptIdentity` → `decryptAgentMasterKey` (sealed box open)
- `generateIdentityKeypair` → utiliser Ed25519 native (libsodium)
- `generateRecoveryKit` → N/A (pas de recovery kit pour agents)

**Fonctions nouvelles** (4, SDK agent uniquement) :
- `createAgentVault()` : génère Ed25519 keypair + MK random + sealed box encryption
- `signChallenge(challenge, privateKey)` : signe un challenge Ed25519 pour l'auth
- `decryptAgentMasterKey(encrypted_mk, x25519_priv)` : déchiffre la MK stockée
- `ed25519ToX25519(ed25519_keypair)` : conversion Ed25519 → X25519 pour sealed box

### 5.4 Test d'interopérabilité JS↔Python

Les vecteurs de test (ADR-001 §10) garantissent que le même ciphertext déchiffré par les deux SDK donne le même résultat.

```typescript
// Test vector : TypeScript
const mk = fromHex("0123456789abcdef..."); // 32 bytes
const data = Buffer.from("Hello Serac Agents!");
const ns = "test-interop";
const key = "greeting";

const fileKey = deriveFileKey(mk, ns, key);        // blake2b(mk + ns + key, 32)
const encrypted = encryptWithFileKey(fileKey, data); // xchacha20-poly1305
const commitment = computeKeyCommitment(fileKey);     // blake2b(fileKey, 32)

console.log(toHex(encrypted));  // Doit matcher Python
console.log(toHex(commitment));  // Doit matcher Python
```

```python
# Test vector : Python
mk = bytes.fromhex("0123456789abcdef...")  # mêmes 32 bytes
data = b"Hello Serac Agents!"
ns = "test-interop"
key = "greeting"

file_key = derive_file_key(mk, ns, key)          # blake2b(mk + ns + key, 32)
encrypted = encrypt_with_file_key(file_key, data)  # xchacha20-poly1305
commitment = compute_key_commitment(file_key)       # blake2b(file_key, 32)

print(encrypted.hex())    # Doit matcher TypeScript
print(commitment.hex())    # Doit matcher TypeScript
```

---

## 6. Configuration MCP

### 6.1 Hermes Agent / OpenClaw (SKILL.md)

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

### 6.2 Claude Code / Cursor / Windsurf (mcp.json)

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

### 6.3 Variables d'environnement

```bash
# Obligatoire
SERAC_API_KEY=sk_serac_xxxxxxxxx

# Optionnel
SERAC_BASE_URL=https://api.serac.cloud/v1
SERAC_ENCRYPTION=mcp          # mcp | e2ee
SERAC_ED25519_PRIVATE_KEY=     # Hex, mode E2EE uniquement
SERAC_NAMESPACE=default         # Namespace par défaut
SERAC_AUTO_REFRESH=true         # Auto-refresh JWT
```

---

## 7. Structure des packages

### 7.1 TypeScript (`serac-agent-sdk`)

```
serac-agent-sdk/
├── src/
│   ├── index.ts              # Exports publics
│   ├── agent.ts              # SeracAgent class principale
│   ├── auth.ts               # Auth (API key → JWT, challenge-response)
│   ├── crypto/
│   │   ├── index.ts          # Crypto exports
│   │   ├── master-key.ts     # createAgentVault, decryptAgentMasterKey
│   │   ├── file-key.ts       # deriveFileKey, encryptWithFileKey
│   │   ├── challenge.ts      # signChallenge, verifyChallenge
│   │   └── conversion.ts     # ed25519ToX25519
│   ├── api/
│   │   ├── client.ts         # HTTP client (fetch/axios)
│   │   ├── store.ts          # serac_store
│   │   ├── retrieve.ts       # serac_retrieve
│   │   ├── list.ts           # serac_list
│   │   ├── delete.ts         # serac_delete
│   │   └── quota.ts          # serac_quota
│   ├── mcp/
│   │   └── server.ts         # MCP server wrapper (si host local)
│   ├── types.ts              # Types publics
│   └── errors.ts             # SeracError, QuotaExceededError, etc.
├── tests/
│   ├── interop/
│   │   ├── vectors.ts         # Vecteurs de test JS↔Python
│   │   └── vectors.json       # Vecteurs de test partagés
│   ├── unit/
│   │   ├── crypto.test.ts
│   │   ├── auth.test.ts
│   │   └── api.test.ts
│   └── integration/
│       ├── store-retrieve.test.ts
│       └── quota.test.ts
├── package.json
├── tsconfig.json
├── LICENSE                    # MIT
└── README.md
```

### 7.2 Python (`serac-mcp`)

```
serac-mcp/
├── src/
│   └── serac_mcp/
│       ├── __init__.py         # Exports publics
│       ├── agent.py            # SeracAgent + SyncSeracAgent
│       ├── auth.py             # Auth (API key → JWT, challenge-response)
│       ├── crypto/
│       │   ├── __init__.py
│       │   ├── master_key.py   # create_agent_vault, decrypt_agent_master_key
│       │   ├── file_key.py     # derive_file_key, encrypt_with_file_key
│       │   ├── challenge.py     # sign_challenge, verify_challenge
│       │   └── conversion.py    # ed25519_to_x25519
│       ├── api/
│       │   ├── client.py       # httpx async client
│       │   ├── store.py
│       │   ├── retrieve.py
│       │   ├── list.py
│       │   ├── delete.py
│       │   └── quota.py
│       ├── types.py            # Dataclasses publiques
│       └── errors.py           # SeracError, QuotaExceededError, etc.
├── tests/
│   ├── interop/
│   │   ├── vectors.py          # Vecteurs de test JS↔Python
│   │   └── vectors.json        # (partagé avec TS SDK)
│   ├── unit/
│   │   ├── test_crypto.py
│   │   ├── test_auth.py
│   │   └── test_api.py
│   └── integration/
│       ├── test_store_retrieve.py
│       └── test_quota.py
├── pyproject.toml
├── LICENSE                     # MIT
└── README.md
```

---

## 8. Dépendances

### 8.1 TypeScript

| Package | Version | Usage |
|---------|---------|-------|
| `@modelcontextprotocol/sdk` | ^1.0.0 | MCP server (si host local) |
| `libsodium-wrappers` | ^0.7.15 | Chiffrement E2EE (mode E2EE uniquement) |
| `libsodium-wrappers-sumo` | ^0.7.15 | Version complète (Ed25519, X25519, sealed box) |
| `zod` | ^3.22 | Validation schemas MCP |
| `httpx` ou `fetch` | — | HTTP client |

### 8.2 Python

| Package | Version | Usage |
|---------|---------|-------|
| `PyNaCl` | ^1.5 | Chiffrement E2EE (mode E2EE uniquement) |
| `httpx` | ^0.27 | HTTP async client |
| `pydantic` | ^2.0 | Validation schemas |

**Note** : En mode MCP (at-rest), les dépendances crypto sont optionnelles. Le SDK fonctionne sans `libsodium-wrappers`/`PyNaCl` si `encryption: 'mcp'` est sélectionné.

---

## 9. Plan de build

### Phase 1 (S1-S3) — MVP SDK TypeScript

| Semaine | Tâche | Détail |
|---------|-------|--------|
| S1 | Core SDK TS | `SeracAgent` class, auth (API key → JWT), HTTP client, types |
| S1 | Opérations V1 | store, retrieve, list, delete, quota — mode MCP uniquement |
| S2 | Crypto E2EE | `createAgentVault`, `encryptWithFileKey`, `signChallenge`, `ed25519ToX25519` |
| S2 | Challenge-response | Renouvellement JWT via Ed25519 challenge |
| S2 | Interop vectors | Vecteurs de test partagés JSON TS↔Python |
| S3 | Integration tests | Tests d'intégration avec le MCP server |
| S3 | Publication npm | `npm publish serac-agent-sdk` |

### Phase 2 (S4-S5) — SDK Python

| Semaine | Tâche | Détail |
|---------|-------|--------|
| S4 | Core SDK Python | `SeracAgent` class, auth, HTTP client, types (pydantic) |
| S4 | Opérations V1 | Store, retrieve, list, delete, quota — mode MCP |
| S4 | Crypto E2EE | Port fidèle de @serac/crypto via PyNaCl |
| S5 | Interop tests | Validations TS↔Python avec vectors.json partagé |
| S5 | Publication pip | `pip install serac-mcp` |
| S5 | Skills | Skill pour OpenClaw (SKILL.md) + Hermes (SKILL.md) |

### Phase 3 (S6+) — V2 features

- `serac_search` : recherche sémantique via embeddings chiffrés (client-side indexing)
- `serac_share` : partage inter-agent X25519
- `serac_archive` : archivage Glacier
- `serac_attest` : attestation Ed25519
- `serac_versions` : historique des versions
- Auto-enrollment x402 (USDC)

---

## 10. Sécurité du SDK

### 10.1 Gestion des clés

- **Mode MCP** : aucune clé gérée côté client. La namespace key est stockée côté serveur.
- **Mode E2EE** : la Master Key (MK) est stockée localement (env var, fichier, keystore OS). **Jamais envoyée au serveur**.
- **Keystore local** (mode E2EE) :
  - `~/.serac/master.key` — fichier chiffré avec la clé Ed25519 de l'agent
  - Variable d'environnement `SERAC_ED25519_PRIVATE_KEY` — alternative pour containers
  - Future : intégration OS keystore (Keychain, Windows Credential Manager)

### 10.2 Zéro exposition de secrets

- API key jamais loggée, jamais incluse dans les User-Agent strings
- JWT stocké en mémoire uniquement, jamais sur disque
- Ed25519 private key jamais envoyée au serveur
- Les vecteurs de test interop utilisent des clés de test, jamais des clés production

### 10.3 Validation d'entrée

- Clés : max 256 caractères, alphanumériques + `:` + `/` + `-` + `_`
- Data : max taille par tier (1 Mo Free, 50 Mo Starter, 500 Mo Pro, 5 Go Fleet)
- TTL : 0 (permanent) ou 60-31536000 (1 minute à 1 an)
- Namespace : max 64 caractères, alphanumériques + `-`

---

## 11. Références

- **ADR-001**: `architecture/encryption-protocol.md` — Protocole de chiffrement, @serac/crypto reuse, test vectors
- **ADR-002**: `architecture/mcp-server-spec.md` — Spécification MCP server (5 tools, auth, BDD)
- **ADR-003**: `architecture/pricing-model.md` — Modèle de pricing, tiering, marges
- **@serac/crypto**: Libsodium WASM existante dans le codebase Serac
- **MCP SDK**: https://modelcontextprotocol.io/sdk
- **PyNaCl**: https://pynacl.readthedocs.io/
- **libsodium**: https://libsodium.gitbook.io/

---

*Document de référence pour les SDK Serac Agents.*  
*Kira — Mai 2026*