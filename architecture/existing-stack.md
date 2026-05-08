# Serac — Architecture du Codebase Existant

> Cartographie complète du VPS Serac (vps-sniper), générée par Kira le 2026-05-07.
> Objectif : documenter l'état actuel avant le pivot agent (Serac Agents).

---

## 1. Vue d'ensemble

| Stat | Valeur |
|------|--------|
| Total lignes de code | ~430 000 (TS/TSX + SQL) |
| Repo | `/home/sniper/serac/` (monorepo Turborepo) |
| Stack | Next.js 14+ / Fastify / PostgreSQL 16 / Redis 7 / OVH S3 |
| Conteneurs | Podman (rootless) — `podman-compose.prod.yml` |
| URL prod | `serac.cloud` via Cloudflare Tunnel → Caddy |

---

## 2. Structure du monorepo

```
serac/
├── apps/
│   ├── api/          # Backend Fastify (TypeScript, ~16 routes)
│   ├── web/          # Frontend Next.js (App Router, Tailwind, shadcn/ui)
│   └── mobile/       # React Native (Expo) — présent dans README, pas inspecté
├── packages/
│   ├── crypto/       # @serac/crypto — E2E encryption primitives (libsodium WASM)
│   ├── types/        # @serac/types — Shared TypeScript types (vide/inexistant au runtime)
│   ├── validators/   # @serac/validators — Zod schemas (vide/inexistant au runtime)
│   └── tsconfig/     # Shared TypeScript configs
├── scripts/
│   └── backup-db.sh  # Backup PG quotidienne + upload restic vers Scaleway S3
├── podman-compose.yml        # Dev
├── podman-compose.prod.yml   # Prod
├── deploy.sh                 # Rebuild + restart stack
├── turbo.json                # Turborepo config
└── README.md
```

---

## 3. Backend (apps/api)

### 3.1 Routes Fastify

Préfixe : `/api`

| Préfixe | Route Group | Description |
|---------|-------------|-------------|
| `/api/auth` | `auth.ts` | Register, login, refresh, logout (HKDF auth_key + bcrypt) |
| `/api/auth` | `totp.ts` | 2FA TOTP setup, verify, disable, validate |
| `/api/files` | `files.ts` | Upload metadata + presigned URL, confirm, download, list, folder, rename, move, favorite, trash |
| `/api/photos` | `photos.ts` | Photo upload avec multi-variant (thumbnail/preview/original), list, download, delete |
| `/api/albums` | `albums.ts` | Albums photos chiffrés (nom chiffré côté client) |
| `/api/shared-albums` | `shared-albums.ts` | Albums publics partagés par lien (clé dans URL fragment) |
| `/api` | `sharing.ts` | Partage E2E : user-to-user (sealed box X25519), liens de partage |
| `/api` | `glacier.ts` | Archivage Scaleway S3 Glacier, restauration (24-48h) |
| `/api` | `photo-embeddings.ts` | Stockage embeddings CLIP chiffrés (recherche sémantique client-side) |
| `/api/billing` | `billing.ts` | Stripe checkout, portal, plans |
| `/api/billing` | webhook | Stripe webhook |
| `/api` | `health.ts` | Health check (PG + uptime) |
| `/api/admin` | `stats.ts` | Admin stats |
| `/api/admin` | `users.ts` | Admin gestion utilisateurs |
| `/api/admin` | `billing.ts` | Admin billing |
| `/api/admin` | `storage.ts` | Admin storage |
| `/api/admin` | `analytics.ts` | Admin analytics |
| `/api/admin` | `infra.ts` | Admin infra |

### 3.2 Authentification

**Flux d'inscription :**
1. Client dérive `passphrase → Argon2id → Master Key` + `passphrase + salt → BLAKE2b + HKDF → Auth Key`
2. Client génère X25519 + Ed25519 keypair, chiffre les privées avec Master Key
3. Client envoie au serveur : `salt`, `authKey`, `encryptedIdentity` (privées chiffrées + publiques en clair)
4. Serveur bcrypt l'auth_key et stocke le hash — **jamais** la passphrase ni le Master Key

**Flux de connexion :**
1. Client dérive `authKey` depuis passphrase + salt (récupéré du serveur)
2. Serveur compare bcrypt, renvoie `encryptedIdentity`
3. Client décrypte l'identity avec le Master Key dérivé

**JWT :**
- Access token : 15 min (configurable via `JWT_ACCESS_EXPIRY`)
- Refresh token : 30 jours (configurable via `JWT_REFRESH_EXPIRY`)
- Max 10 sessions/user, revocables

**TOTP :**
- Secret TOTP chiffré au repos par `SERVER_ENCRYPTION_KEY` (AES-256-GCM)
- Backup codes hashés (bcrypt)
- Flux complet : setup → verify → activate → disable

### 3.3 Middleware auth

- `authenticate` : vérifie Bearer JWT, extrait `userId`, check `disabled_at`, update `last_active_at` (max 1/jour), reset `deletion_warning_sent_at` + `scheduled_deletion_at`

---

## 4. Package @serac/crypto

### 4.1 Hiérarchie de chiffrement

```
PASSPHRASE
├── HKDF-SHA512("serac-auth-key") → Auth Key → bcrypt (serveur)
└── Argon2id (64MB, 3 iterations) → Master Key → JAMAIS envoyé au serveur
    └── chiffre Identity Keypair (X25519 priv + Ed25519 priv)
        └── Master Key ou Group Key chiffre File Keys
            └── File Key chiffre contenu du fichier (XChaCha20-Poly1305)
```

### 4.2 Fichiers source

| Fichier | Lignes | Contenu |
|---------|--------|---------|
| `keys.ts` | ~180 | Dérivation Argon2id + HKDF, keypair X25519/Ed25519, registration/login bundle |
| `encryption.ts` | ~200 | Chiffrement fichiers : single-shot (≤4MB) + streaming (>4MB), XChaCha20-Poly1305, key commitment (BLAKE2b), AAD anti-réordonnancement |
| `recovery.ts` | ~130 | Recovery kit : BIP39 24 mots, Argon2id → Recovery Key → chiffre Master Key |
| `sharing.ts` | ~100 | Partage asymétrique : sealed box (X25519), Group Keys, rotation on member removal |
| `constants.ts` | ~35 | Paramètres crypto : Argon2id (64MB, 3 iter), SALT 128 bits, MASTER/FILE/GROUP KEY 256 bits, CHUNK 64KB, KEY_ALGORITHM_V1 |
| `utils.ts` | ~70 | hex/base64 encode/decode, BLAKE2b hash, randomBytes, secureCompare, zeroMemory |
| `init.ts` | ~15 | Singleton libsodium WASM init |
| `bip39-wordlist.ts` | ~2048 | BIP39 wordlist (2048 mots) |

### 4.3 Détails crypto critiques

- **XChaCha20-Poly1305** pour le chiffrement de fichiers (pas AES-256-GCM) — 192-bit nonce, pas de risque de collision, pas de hardware dependency
- **Argon2id** : 64 MB mémoire, 3 itérations (OWASP minimum), parallelisme 1 (limitation WASM libsodium)
- **Key commitment** : BLAKE2b-256 du File Key pour prévenir les attaques multi-clés (decrypt avec mauvaise clé → contenu différent)
- **Streaming** : chunks 64 KB, AAD = `(chunkIndex uint32 BE, isFinal flag uint8)`, nonce = base_nonce XOR chunk_index
- **Recovery** : 256 bits d'entropie → BIP39 24 mots, Argon2id → Recovery Key → secretbox(Master Key)
- **Anti-truncation** : le dernier chunk DOIT avoir `isFinal=true`, tout chunk après est rejeté

### 4.4 Domain separation

- `HKDF_CONTEXT_AUTH = "serac-auth-key"` (clé d'authentification)
- `HKDF_CONTEXT_ENC = "serac-enc-key"` (non utilisé actuellement, réservé)
- `KEY_ALGORITHM_V1 = "v1-x25519-ed25519"` (version pour migration quantique future)

---

## 5. Frontend (apps/web)

### 5.1 Pages (App Router)

```
src/app/
├── (app)/
│   ├── drive/          # Drive principal (fichiers/dossiers)
│   ├── photos/         # Galerie photos (timeline)
│   ├── settings/       # Paramètres (plan, 2FA, etc.)
│   ├── shared/         # Partages reçus
│   └── trash/          # Corbeille
├── (auth)/
│   ├── login/          # Connexion
│   ├── register/       # Inscription
│   └── verify-email/   # Vérification email
├── admin/
│   ├── analytics/      # Stats analytics
│   ├── billing/        # Gestion abonnements
│   ├── infra/          # Monitoring infra
│   ├── storage/        # Utilisation stockage
│   └── users/          # Gestion utilisateurs
├── legal/
│   ├── privacy/        # Politique de confidentialité
│   └── terms/          # CGU
├── produits/
│   ├── docs/           # Page produit Docs
│   ├── drive/          # Page produit Drive
│   ├── email/          # Page produit Email
│   ├── messagerie/     # Page produit Messagerie
│   ├── photos/         # Page produit Photos
│   └── visio/          # Page produit Visio
├── s/[token]/          # Partage public par lien
└── security/           # Page sécurité/chiffrement
```

### 5.2 Lib client (chiffrement côté navigateur)

| Fichier | Lignes | Contenu |
|---------|--------|---------|
| `crypto-client.ts` | 224 | Wrapper navigateur : register, login, file encrypt/decrypt, recovery |
| `auth-context.tsx` | 315 | React context : JWT management, auto-refresh, session persistence |
| `photo-crypto.ts` | 271 | Chiffrement photos multi-variant avec File Key |
| `sharing-crypto.ts` | 109 | Partage asymétrique côté client |
| `embedding-crypto.ts` | 74 | Chiffrement/déchiffrement embeddings CLIP |
| `clip-service.ts` | 138 | CLIP ViT-B/32 via Transformers.js (ONNX Runtime Web), local browser |
| `ml-classifier.ts` | ? | Classification ML photos |
| `folder-upload.ts` | ? | Upload récursif de dossiers |
| `image-utils.ts` | ? | Utils image (resize, thumbnail) |
| `fr-en-search-dict.json` | ? | Dictionnaire FR/EN pour recherche |
| `api.ts` | 153 | Client HTTP API (fetch wrapper, JWT refresh) |

### 5.3 Composants UI

- **Drive** : upload-button, upload-progress, file-row, file-actions-menu, file-preview, file-icon, folder-breadcrumb, search-bar, selection-bar, share-modal, archive-modal, restore-modal, create-folder-modal, file-type-badge, encryption-dot
- **Photos** : add-to-album-modal
- **Settings** : setup-2fa-modal, disable-2fa-modal
- **Marketing** : feature-card, pricing-section, section-heading, status-badge, shell, auth-redirect
- **UI (shadcn)** : alert, badge, button, card, checkbox, dialog, dropdown-menu, input, label, progress, separator + custom : altitude-marker, crystal-pattern, frost-background, glacier-storage, serac-logo, theme-toggle, topo-lines, turnstile (CAPTCHA Cloudflare)

---

## 6. Base de données (PostgreSQL 16)

### 6.1 Tables principales

| Table | Description | Points clés |
|-------|-------------|-------------|
| `plans` | 5 plans : Free (10 Go), Personal (200 Go / 3.99€), Pro (500 Go / 9.99€), Pro+ (1 To / 14.99€), Business (2 To / 24.99€) | Stripe price IDs, `glacier_enabled` |
| `users` | Comptes utilisateurs | Auth key (bcrypt), identity chiffrée, key_algorithm v1, TOTP, plan, storage_used_bytes |
| `sessions` | JWT refresh tokens | Max 10/user, device_name, ip_address, expires_at |
| `files` | Fichiers et dossiers (Drive + Photos) | Noms chiffrés, MIME chiffré, File Key chiffré, key_commitment, S3 key, `is_photo`, `date_taken` en clair, Glacier support, soft delete (trash 30 jours) |
| `photo_variants` | Variants photo : thumbnail/preview/original | S3 key, dimensions |
| `groups` | Groupes de partage | Nom chiffré (Group Key), rotation key_version |
| `group_members` | Membres de groupe | Group Key chiffrée par clé publique du membre |
| `file_shares` | Partages individuels | Sealed box X25519, share_token pour liens, permission read/write |
| `restore_jobs` | Jobs Glacier restore | Pending/restoring/ready/failed |
| `subscriptions` | Abonnements Stripe | status, period |

### 6.2 Migrations

16 migrations séquentielles (001 à 016) :

1. Initial (Drive MVP + Phase 1.5)
2. Security fixes + Update plans
3. TOTP + Drop business plan
4. Albums
5. Photo tags
6. Inactive purge
7. Cascade fixes
8. Over-quota grace period
9. Email verification
10. Photo embeddings
11. Admin
12. Shared albums
13. Pricing overhaul
14. Webhook idempotency
15. Security v4
16. Security v5

### 6.3 Index critiques

- `idx_files_owner` : fichiers par propriétaire
- `idx_files_parent` : fichiers dans un dossier
- `idx_files_deleted` : corbeille
- `idx_files_photo_timeline` : photos triées par date (WHERE is_photo AND deleted_at IS NULL)
- `idx_files_glacier` : fichiers archivés
- `idx_file_shares_token` : partage par token (UNIQUE WHERE NOT NULL)

---

## 7. Infrastructure

### 7.1 Conteneurs Podman (prod)

```yaml
services:
  postgres:  postgres:16-alpine, 127.0.0.1:5432, volume pgdata_prod
  redis:     redis:7-alpine, --maxmemory 128mb --requirepass ${REDIS_PASSWORD}
  api:       serac-api:latest, 127.0.0.1:3001, depends_on postgres+redis
  web:       serac-web:latest, 127.0.0.1:3000, depends_on api
```

### 7.2 Stockage objet

- **S3** : OVH/Scaleway Object Storage (`s3.fr-par.scw.cloud` ou `s3.eu-west-par.io.cloud.ovh.net`)
- **Bucket** : `serac-prod`
- **Glacier** : Scaleway Cold Archive / OVH Deep Archive (`DEEP_ARCHIVE` par défaut)
- **Key format** : `{userId}/{uuid}` — flat, pas de filename (évite les fuites de métadonnées)
- **Presigned URLs** : upload 1h, download 15min

### 7.3 Email

- **Module** : nodemailer (lazy import), SMTP configurable
- **Emails transactionnels** : vérification email, alertes 2FA, suppression compte inactif (J-14, J-7, J-1), over-quota grace, confirmation suppression
- **Template** : HTML wrapper dark (#0C1220) + couleurs Sérac (#BAE6FD, #0369A1)
- **Désactivable** : `EMAIL_ENABLED=false` → logs console

### 7.4 Monitoring

- **Uptime Kuma** : connecté au réseau Podman `serac_default`
- **Health check** : `/api/health` (PG + uptime)
- **Telegram alerts** : `sendTelegramAlert()` pour événements critiques (startup, purge over-quota)
- **Backup PG** : script quotidien, pg_dump + gzip, 30 jours de rétention, upload restic vers Scaleway S3

---

## 8. Nettoyage et lifecycle

| Tâche | Fréquence | Détail |
|-------|-----------|--------|
| Uploads abandonnés | Toutes les heures | `upload_confirmed_at IS NULL` + `> 24h` → supprime S3 + DB |
| Corbeille expirée | Toutes les heures | `deleted_at > 30 jours` → supprime S3 + DB |
| Comptes non vérifiés | Toutes les heures | `email_verified = false` + `> 48h` → purge complète |
| Comptes inactifs free | Toutes les heures | J-14 email → J-7 rappel → J-1 dernier avertissement → J0 suppression |
| Over-quota grace | Toutes les heures | J-7 avertissement → J-1 rappel → J0 suppression fichiers les plus anciens |
| Rate limiting | Global | 100 req/min par IP (Redis store) |

---

## 9. Modèle de sécurité existant

### 9.1 Ce qui est déjà en place

- ✅ **Zero-knowledge** : serveur ne voit jamais passphrase, Master Key, File Keys, contenu
- ✅ **E2E encryption** : XChaCha20-Poly1305, 256-bit File Keys, Argon2id (64MB, 3 iter)
- ✅ **Key commitment** : BLAKE2b anti-multi-key attack
- ✅ **Streaming encryption** : chunks 64KB, AAD avec chunkIndex + isFinal
- ✅ **Anti-truncation** : vérification chunk final obligatoire
- ✅ **WASM buffer aliasing** : copie systématique `new Uint8Array()` des retours libsodium
- ✅ **memzero** : zeromemory des clés sensibles après usage
- ✅ **Recovery kit** : BIP39 24 mots, Argon2id dérivation Recovery Key
- ✅ **2FA TOTP** : secret chiffré au repos (AES-256-GCM server-side)
- ✅ **Rate limiting** : Redis-backed, 100/min
- ✅ **Presigned URLs** : serveur ne touche jamais le contenu, upload/download direct S3
- ✅ **Safe directory fix** : git safe.directory configuré pour déploiement
- ✅ **JWT validation** : vérifie `disabled_at`, refresh token bcrypt, max 10 sessions
- ✅ **Cloudflare Turnstile** : CAPTCHA sur inscription
- ✅ **Email verification** : 24h, verification token, duplicate registration alert

### 9.2 Métadonnées encore en clair côté serveur

- ❌ `date_taken` (photos) — en clair pour timeline sorting (tradeoff documenté)
- ❌ Noms de groupes — chiffrés (`name_encrypted` + `name_nonce`)
- ✅ Noms de fichiers — chiffrés (`name_encrypted` + `name_nonce`)
- ✅ MIME types — chiffrés (`mime_encrypted` + `mime_nonce`)
- ❌ Taille des fichiers (`size_bytes`) — en clair pour quota
- ❌ Arborescence (`parent_id`) — en clair pour navigation

---

## 10. Ce qui n'existe PAS encore

- ❌ **MCP server** — aucune trace
- ❌ **SDK client Python** — inexistant
- ❌ **API provisioning agent** — pas de `POST /v1/vaults/create` autonome
- ❌ **Auth agent** — pas de keypair ed25519 sans passphrase humaine
- ❌ **Paiement crypto** — Stripe uniquement
- ❌ **Recherche sémantique serveur** — tout est client-side (CLIP + embeddings chiffrés)
- ❌ **Module Email/Visio/Docs** — pages produits statiques, pas de backend
- ❌ **Mobile** — listé dans README mais pas de code inspecté
- ❌ **Tests e2e** — aucun playbook Cypress/Playwright inspecté