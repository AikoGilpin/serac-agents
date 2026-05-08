# Serac Agents — Gap Analysis

> Analyse des écarts entre le codebase existant (Serac Cloud humain) et le pivot agent (Serac Agents MCP-native).
> Basé sur : `architecture/existing-stack.md` + `brainstorm.md`

---

## 1. Résumé exécutif

Le codebase Serac existant est **solide sur le plan crypto** (XChaCha20-Poly1305, Argon2id, key commitment, streaming, anti-truncation, BIP39 recovery). Le pivot agent nécessite principalement d'**ajouter des couches** (MCP server, SDK, provisioning agent) plutôt que de refactorer l'existant. Les modules humains (Drive, Photos, Billing) restent intouchés.

**Verdict** : ~70% du backend existant est réutilisable tel quel. Les gaps sont concentrés sur l'auth agent, le MCP transport, et le SDK client.

---

## 2. Gap Analysis détaillée

### 2.1 Authentification

| Aspect | Existant (humain) | Requis (agent) | Gap |
|--------|------------------|----------------|------|
| Inscription | Email + passphrase → Argon2id → Master Key + sealed identity | Keypair ed25519 générée par l'agent, pas de passphrase | **NOUVEAU** : POST /v1/vaults/create avec public_key |
| Login | Passphrase → auth_key → bcrypt | Signature ed25519 d'un challenge → token court-vie | **NOUVEAU** : POST /v1/auth/challenge + POST /v1/auth/token |
| Session | JWT access 15min + refresh 30 jours | Token court-vie (1h), renouvellement automatique par l'agent | **ADAPTATION** : nouvelle table `agent_sessions` ou extension `sessions` |
| 2FA | TOTP (humain) | Non applicable pour les agents | **EXCLUSION** : les agents n'ont pas de 2FA |
| Recovery | BIP39 24 mots | Guardian/recovery défini par l'agent propriétaire | **NOUVEAU** : modèle recovery différent |

**Impact API** : nouvelles routes à ajouter (3 endpoints), la table `users` peut être étendue avec une colonne `auth_type = 'passphrase' | 'agent_key'`.

### 2.2 Chiffrement

| Aspect | Existant (humain) | Requis (agent) | Gap |
|--------|------------------|----------------|------|
| Dérivation principale | Passphrase → Argon2id → Master Key | Agent génère Master Key aléatoire 256 bits directement | **ADAPTATION** : `createAgentVault()` skip Argon2id, Master Key = random 32 bytes |
| Enveloppement clés | Master Key chiffre File Keys/Group Keys | Identique — Master Key chiffre File Keys | ✅ **RÉUTILISABLE** tel quel |
| Chiffrement fichiers | XChaCha20-Poly1305, chunks 64KB, AAD | Identique | ✅ **RÉUTILISABLE** tel quel |
| Key commitment | BLAKE2b-256 du File Key | Identique | ✅ **RÉUTILISABLE** tel quel |
| Streaming | encryptStream/decryptStream | Identique | ✅ **RÉUTILISABLE** tel quel |
| Partage | Sealed box X25519 entre utilisateurs | Identique pour partage agent→agent | ✅ **RÉUTILISABLE** tel quel |
| Recovery | BIP39 24 mots humains | Guardian : l'agent du propriétaire humain re-chiffre Master Key | **NOUVEAU** : concept de recovery agent |
| Stockage Master Key | Jamais côté serveur | Jamais côté serveur (l'agent la garde en mémoire/chiffrée localement) | ✅ **MÊME PRINCIPE** |

**Verdict crypto** : le package `@serac/crypto` est **presque entièrement réutilisable**. Seul ajout : un mode "agent" pour la création de vault (skip Argon2id, Master Key aléatoire).

### 2.3 Stockage et métadonnées

| Aspect | Existant (humain) | Requis (agent) | Gap |
|--------|------------------|----------------|------|
| Stockage blobs | S3 presigned URLs (upload/download direct) | Identique — l'agent utilise les mêmes presigned URLs | ✅ **RÉUTILISABLE** |
| Métadonnées noms | `name_encrypted` + `name_nonce` | Identique — noms chiffrés côté client (SDK) | ✅ **RÉUTILISABLE** |
| MIME types | `mime_encrypted` + `mime_nonce` | Identique | ✅ **RÉUTILISABLE** |
| Arborescence | `parent_id` en clair | Identique (les agents ont aussi besoin de naviguer) | ✅ **RÉUTILISABLE** |
| `date_taken` | En clair (photos) | En clair aussi pour les agents (tri chronologique) | ✅ **RÉUTILISABLE** |
| `size_bytes` | En clair (quota) | En clair (quota agent aussi) | ✅ **RÉUTILISABLE** |
| Quota | Plans fixes (10 Go à 2 To) | Freemium agent (1-5 Go) + plans payants | **ADAPTATION** : nouveau plan `agent_free` |
| Glacier | Scaleway Cold Archive | Identique | ✅ **RÉUTILISABLE** |

### 2.4 MCP Server (n'existe pas)

| Composant | Existant | Requis | Gap |
|-----------|----------|--------|-----|
| Transport HTTP | — | HTTP Streamable (POST + SSE) | **NOUVEAU** |
| Auth | — | Bearer token agent (ed25519-signed) | **NOUVEAU** |
| Tools V1 | — | `vault.create`, `vault.upload`, `vault.download`, `vault.search`, `vault.delete`, `vault.info` | **NOUVEAU** |
| Tools V2 | — | `vault.share`, `vault.embed`, `vault.restore` | **NOUVEAU** |
| Discovery | — | `/.well-known/mcp.json` + `/v1/vaults/{id}/mcp` | **NOUVEAU** |

**Implementation** : nouveau module dans `apps/api/src/routes/mcp.ts` + `apps/api/src/lib/mcp/`. Réutilise le middleware `authenticate` (adapté pour agent tokens).

### 2.5 SDK Client (n'existe pas)

| Composant | Existant | Requis | Gap |
|-----------|----------|--------|-----|
| Package Python | — | `serac-mcp` PyPI | **NOUVEAU** |
| Auth | — | Keypair ed25519, challenge-response | **NOUVEAU** |
| Encryption | — | Reuse logique de `@serac/crypto` réécrite en Python (PyNaCl/pyargon2) | **NOUVEAU** (~80% port du JS) |
| MCP Client | — | HTTP Streamable client | **NOUVEAU** |
| Recherche | — | Download + decrypt embeddings + cosine similarity | **NOUVEAU** |

**Réutilisation** : la logique crypto est documentation-first (les algorithmes, paramètres, constantes sont clairs et portables). Le SDK Python sera un port fidèle de `@serac/crypto`.

### 2.6 Paiement

| Aspect | Existant (humain) | Requis (agent) | Gap |
|--------|------------------|----------------|------|
| Backend | Stripe (checkout, portal, webhooks) | Crypto (USDC) + Stripe pour tiers humains | **NOUVEAU** : crypto payment |
| Plans | Free/Personal/Pro/Pro+/Business | Agent Free (1-5 Go) + Agent Pro + tiers humain existant | **ADAPTATION** : nouveaux plans |
| Quota enforcement | `storage_used_bytes` check | Identique | ✅ **RÉUTILISABLE** |
| Over-quota | Grace period 30 jours, purge auto | Identique pour humains, direct cutoff pour agents ? | **À DÉCIDER** |

### 2.7 Modules à retirer/neutraliser

| Module | Existant | Action agent | Raison |
|--------|----------|-------------|--------|
| Email (produit) | Pages statiques + pas de backend | **Retirer** de la nav + pages | Pas dans le scope agent |
| Visio | Pages statiques | **Retirer** | Pas dans le scope |
| Docs | Pages statiques | **Retirer** | Pas dans le scope |
| Messagerie | Pages statiques | **Garder en attente** | Potentiel futur, mais pas V1 |
| TOTP | Backend complet | **Désactiver pour agents** | Pas applicable |
| Turnstile CAPTCHA | Sur inscription | **Désactiver pour agents** | Pas applicable |
| Email verification | Backend complet | **Désactiver pour agents** | Les agents n'ont pas d'email |

---

## 3. Impact sur la DB

### 3.1 Nouvelles tables

```sql
-- Vaults créés par des agents
CREATE TABLE agent_vaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id),           -- propriétaire humain (optionnel V1)
    public_key BYTEA NOT NULL UNIQUE,              -- ed25519 public key
    encrypted_master_key BYTEA,                    -- Master Key chiffrée par keypair agent (optionnel)
    key_algorithm TEXT NOT NULL DEFAULT 'v1-x25519-ed25519',
    plan_id UUID REFERENCES plans(id),
    storage_used_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions agent (challenge-response, pas JWT passphrase)
CREATE TABLE agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vault_id UUID NOT NULL REFERENCES agent_vaults(id) ON DELETE CASCADE,
    challenge BYTEA NOT NULL,                      -- nonce envoyé à l'agent
    signed_challenge BYTEA,                        -- signature ed25519 de l'agent
    token_hash TEXT NOT NULL,                       -- hash du token de session
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 Modifications de tables existantes

```sql
-- Extension de users pour supporter les agents
ALTER TABLE users ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'passphrase'
    CHECK (auth_type IN ('passphrase', 'agent_key'));
ALTER TABLE users ADD COLUMN agent_vault_id UUID REFERENCES agent_vaults(id);
```

### 3.3 Nouveaux plans

```sql
INSERT INTO plans (name, display_name, storage_bytes, price_cents, glacier_enabled)
VALUES
    ('agent_free', 'Agent Free', 5368709120, 0, FALSE),     -- 5 Go
    ('agent_pro', 'Agent Pro', 107374182400, 999, TRUE);    -- 100 Go
```

---

## 4. Résumé des décisions à prendre

| # | Decision | Options | Recommandation |
|---|----------|---------|----------------|
| D1 | Chiffrement V1 | Simple key (Master Key aléatoire) vs Envelope (wrapping key hierarchy) | **Simple key** —_Master Key déjà random 256-bit, pas besoin de couche supplémentaire |
| D2 | Guardian/Recovery | Opt-in vs default | **Opt-in V1** — l'agent propriétaire humain peut re-chiffrer la vault key |
| D3 | Freemium agent | 1 Go vs 5 Go | **5 Go** — 1 Go est trop petit pour des embeddings + documents |
| D4 | Paiement crypto | USDC sur Polygon vs USDC sur Base vs pas de crypto V1 | **Pas de crypto V1** — Stripe suffit, crypto en V2 |
| D5 | Agent auth | Ed25519 challenge-response vs API key static | **Ed25519 challenge-response** — plus sécurisé, non-replayable |
| D6 | Over-quota agent | Grace period vs cutoff immédiat | **Cutoff immédiat** — les agents n'ont pas de "grace period", ils arrêtent d'écrire |
| D7 | MCP transport | HTTP Streamable vs SSE-only vs WebSocket | **HTTP Streamable** (MCP spec 2025-03) |
| D8 | Modules retirés V1 | Email/Visio/Docs + pages produits | **Retirer** de la nav, garder les routes en 404 soft |
| D9 | `date_taken` photos | Garder en clair vs chiffrer | **Garder en clair** — le tradeoff est acceptable et les agents en ont besoin |
| D10 | SDK Python port | Fidèle (@serac/crypto) vs simplifié | **Fidèle** — mêmes algos, mêmes constantes, interop testé |

---

## 5. Priorisation d'implémentation

### Phase MVP (V1) — 4 à 6 semaines

1. **Agent auth** → nouvelles routes + table `agent_vaults` + challenge-response
2. **MCP server** → `POST /v1/vaults/create` + `/.well-known/mcp.json` + 6 tools V1
3. **SDK Python** → `serac-mcp` PyPI, crypto identique à `@serac/crypto`, MCP client
4. **Quota agent** → plans `agent_free` / `agent_pro`, quota enforcement

### Phase V2 — après validation V1

5. **Crypto payment** — USDC sur Base/Polygon
6. **MCP tools V2** — share, embed, restore
7. **Guardian/recovery** — l'agent humain propriétaire peut recréer l'accès
8. **Recherche sémantique agent** — serveur-side avec embeddings chiffrés (ou client-side délégation)
9. **Nettoyage UI** — retirer Email/Visio/Docs de la nav humaine