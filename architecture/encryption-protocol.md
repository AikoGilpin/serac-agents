# ADR-001: Encryption Protocol for Agent Vaults

**Date** : 2026-05-07  
**Statut** : En cours de validation  
**Auteurs** : Kira, Aiko

---

## 1. Contexte et motivation

Serac Cloud utilise un système de chiffrement E2E battle-tested (`@serac/crypto`) basé sur une hiérarchie de clés dérivée d'une passphrase humaine :

```
Passphrase → Argon2id → Master Key → chiffre File Keys → chiffre contenu
```

Le pivot Serac Agents introduit un nouveau type d'acteur : les **agents IA autonomes**, qui n'ont pas de passphrase à retenir. Ce document spécifie comment adapter le protocole de chiffrement existant pour les agents tout en conservant une interopérabilité totale avec le système humain.

### Principes directeurs

1. **Réutiliser le maximum de code existant** — `@serac/crypto` a été audité avec 66 correctifs de sécurité (SEC-001 à SEC-066), il serait irresponsable de repartir de zéro
2. **Interopérabilité humain↔agent** — un vault agent doit pouvoir partager un fichier avec un utilisateur humain, et inversement
3. **Simplicité** — un agent n'a pas les mêmes contraintes UX qu'un humain (pas de passphrase à mémoriser, pas de BIP39 à recopier)
4. **Sécurité équivalente** — le niveau de sécurité doit être au minimum égal au système humain

---

## 2. Modèle de clé agent vs humain

### 2.1 Hiérarchie humaine (existant, inchangé)

```
Passphrase
├── HKDF-SHA512("serac-auth-key") → Auth Key → bcrypt (côté serveur)
└── Argon2id(64MB, 3 iter) → Master Key → JAMAIS envoyé au serveur
    ├── chiffre X25519 private key (encryption)
    ├── chiffre Ed25519 private key (signing)
    └── chiffre File Keys (directement ou via Group Keys)
        └── File Key chiffre contenu (XChaCha20-Poly1305)
```

### 2.2 Hiérarchie agent (nouveau)

```
Génération locale (SDK Python) :
  ed25519_keypair = nacl.signing.SigningKey.generate()
  master_key = randombytes_buf(32)  # 256 bits, pas de Argon2id nécessaire
  encrypted_master_key = crypto_box_seal(master_key, ed25525519_to_x25519(keypair.public_key))

Envoi au serveur (provisioning) :
  POST /v1/vaults/create { public_key: "ed25519:...", encrypted_master_key, master_key_nonce }

Résolution ultérieure (authentification) :
  Agent déchiffre master_key = crypto_box_seal_open(encrypted_master_key, pubkey, privkey)
  Master Key → File Keys → contenu (identique au flux humain)
```

**Différence critique** : l'agent **saute le dérivition Argon2id** parce qu'il n'a pas de passphrase. Le Master Key est généré directement comme 256 bits aléatoires — équivalent en entropie à une passphrase de ~40 caractères aléatoires.

### 2.3 Tableau comparatif

| Aspect | Humain | Agent |
|--------|--------|-------|
| Source du Master Key | Passphrase → Argon2id (64MB, 3 iter, ~1-2s) | `randombytes_buf(32)` (~instantané) |
| Dérivation lente | Oui (Argon2id anti-brute-force) | Non (pas nécessaire — clé non devinable) |
| Auth Key | HKDF(passphrase + salt) | Non applicable |
| Auth SERVEUR | bcrypt(auth_key) | ed25519 challenge-response signature |
| Master Key stockage | Jamais au serveur | Chiffré par clé publique agent (sealed box), stocké au serveur |
| Identity Keypair | X25519 + Ed25519, privées chiffrées par MK | Ed25519, générée par l'agent, **restée locale** |
| Recovery | BIP39 24 mots (humain) | Guardian (propriétaire humain) |

**Pourquoi Argon2id n'est pas nécessaire pour les agents** : Argon2id est un ralentissement volontaire contre le brute-force de passphrases faibles. Un Master Key de 256 bits purement aléatoire a déjà une entropie de 2^256 — il est impossible de le brute-forcer, donc il n'y a pas besoin de ralentir la dérivation.

---

## 3. Provisioning crypto d'un vault agent

### 3.1 Flux complet de création

```
┌─────────────── AGENT (SDK Python ou MCP client) ───────────────┐
│                                                                 │
│  1. ed25519_keypair = SigningKey.generate()                      │
│  2. master_key = randombytes_buf(32)                             │
│  3. x25519_pubkey = ed25519_to_x25519(keypair.public_key)       │
│  4. encrypted_master_key = crypto_box_seal(master_key,           │
│                                            x25519_pubkey)        │
│  5. master_key_nonce = randombytes_buf(24)  # nonce pas utilisé  │
│     (crypto_box_seal inclut son propre nonce éphémère)           │
│                                                                 │
│  Champs optionnels pour V1 :                                    │
│  6. key_commitment = blake2b(master_key, 32)  # anti-tampering │
│  7. key_algorithm = "v1-x25519-ed25519"                         │
│                                                                 │
├─────────────── REQUÊTE HTTP ────────────────────────────────────┤
│                                                                 │
│  POST /v1/vaults/create                                         │
│  {                                                              │
│    "public_key": "ed25519:R4ND0MBA5E64URL...",
│    "encrypted_master_key": "hex...",
│    "key_commitment": "hex...",
│    "key_algorithm": "v1-x25519-ed25519",                        │
│    "plan": "agent_free"                                         │
│  }                                                              │
│                                                                 │
├─────────────── SERVEUR ─────────────────────────────────────────┤
│                                                                 │
│  8. Valider public_key (32 bytes ed25519)                       │
│  9. Valider key_commitment (blake2b-256)                        │
│  10. Vérifier plan valide                                       │
│  11. INSERT agent_vaults (public_key, encrypted_master_key,    │
│       master_key_nonce, key_commitment, key_algorithm, plan)   │
│  12. Signer JWT HMAC-SHA256 {sub, type, exp}                  │
│  13. Retourner { vault_id, access_token (JWT), expires_in: 3600 }│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Récupération du Master Key par l'agent

Chaque fois que l'agent démarre une nouvelle session :

```
1. Challenge-response (cf section 4)
2. Après authentification réussie, l'agent DICHT le vault :
   GET /v1/vaults/{vault_id}/master-key
   Authorization: Bearer <access_token>
   
   Réponse :
   {
     "encrypted_master_key": "hex...",
     "public_key": "ed25519:..."
   }
   
3. L'agent déchiffre :
   master_key = crypto_box_seal_open(
     encrypted_master_key,
     ed25519_to_x25519(keypair.public_key),
     ed25519_to_x25519(keypair.private_key)  # conversion ed25519 → x25519
   )
   
4. Vérification du key_commitment :
   computed = blake2b(master_key, 32)
   assert computed == stored_key_commitment, "Key commitment check failed"
   
5. Master Key en mémoire pour la durée de la session
6. zeroMemory(master_key) à la fin de la session
```

### 3.3 Pourquoi sealed box et pas secretbox

`crypto_box_seal` (sealed box) est utilisé pour chiffrer le Master Key plutôt que `crypto_secretbox` car :
- L'agent chiffre son propre Master Key **au moment du provisioning**, alors qu'il n'a pas encore de clé symétrique dérivée
- Sealed box utilise un nonce éphémère automatiquement inclus — pas de risque de réutilisation de nonce
- La paire X25519 de l'agent peut servir à la fois pour l'authentification (Ed25519 signatures) et le chiffrement (X25519 DH)
- C'est le même pattern que le partage inter-utilisateurs existant dans `sharing.ts`

### 3.4 Format de sérialisation

| Champ | Format API (JSON) | Format interne (SDK) |
|-------|-------------------|----------------------|
| `public_key` | `"ed25519:<base64url_nopad_32bytes>"` | `Uint8Array(32)` (Python `bytes(32)`) |
| `encrypted_master_key` | Hex string (128 octets = 256 hex chars) | `Uint8Array(128)` (sealed box output = 32 + 24 + 32 = 48 bytes overhead + 32 bytes plaintext) |
| `key_commitment` | Hex string (64 chars = 32 bytes) | `Uint8Array(32)` |
| `signed_challenge` | Base64url no-padding | `Uint8Array(64)` (Ed25519 signature) |
| `file_id`, `vault_id` | UUID v4 | string |
| Champs chiffrés existants | Hex string | `Uint8Array` |

**Note** : le format hex est maintenu pour compatibilité avec l'API existante. Le SDK Python utilise `bytes` en interne et convertit en hex pour les requêtes HTTP.

---

## 4. Authentification agent : Ed25519 challenge-response

### 4.1 Flux d'authentification

```
┌─────────────── AGENT ──────────────┐         ┌─────────────── SERVEUR ───────────────┐
│                                      │         │                                       │
│  1. GET /v1/auth/challenge           │         │                                       │
│     ?vault_id=<uuid>                │ ──────► │                                       │
│                                      │         │  2. Générer challenge (32 bytes)      │
│                                      │         │     Stocker dans Redis :             │
│                                      │         │     key = vault_id                  │
│                                      │         │     value = challenge (hex)          │
│                                      │         │     TTL = 300 (5 minutes)           │
│                                      │         │                                       │
│  3. Réponse :                        │ ◄────── │                                       │
│     { challenge, vault_id,           │         │                                       │
│       expires_at }                    │         │                                       │
│                                      │         │                                       │
│  4. Signer le challenge :            │         │                                       │
│     message = challenge || vault_id  │         │                                       │
│                || timestamp          │         │                                       │
│     signature = ed25519_sign(         │         │                                       │
│       message, private_key)           │         │                                       │
│                                      │         │                                       │
│  5. POST /v1/auth/token              │         │                                       │
│     { vault_id, signed_challenge,    │ ──────► │                                       │
│       timestamp }                     │         │  6. Vérifier :                        │
│                                      │         │     - challenge existe dans Redis     │
│                                      │         │     - timestamp < 5 min               │
│                                      │         │     - ed25519_verify(signature,       │
│                                      │         │         message, public_key)          │
│                                      │         │     - Supprimer challenge (1 usage)   │
│                                      │         │                                       │
│                                      │         │  7. Générer access_token (JWT)        │
│                                      │         │     claims: { sub: vault_id,         │
│                                      │         │              type: "agent",          │
│                                      │         │              iat, exp }               │
│                                      │         │                                       │
│  8. Réponse :                        │ ◄────── │                                       │
│     { access_token, expires_in: 3600}│         │                                       │
│                                      │         │                                       │
└──────────────────────────────────────┘         └───────────────────────────────────────┘
```

### 4.2 Détails du message signé

Le message signé par l'agent est construit comme suit :

```python
# SDK Python
import time

def sign_challenge(challenge_hex: str, vault_id: str, private_key: SigningKey) -> str:
    timestamp = int(time.time())
    message = f"{challenge_hex}:{vault_id}:{timestamp}".encode('utf-8')
    signature = private_key.sign(message).signature
    return base64url_encode(signature)
```

**Pourquoi inclure `vault_id` et `timestamp` dans le message signé ?**
- `vault_id` lie le challenge à un vault spécifique — empêche de reprendre un challenge d'un vault pour s'authentifier sur un autre
- `timestamp` protège contre les attaques par rejeu même si le challenge n'est pas supprimé du Redis (double protection)

### 4.3 Stockage des challenges (Redis)

```
Clé Redis :  agent_challenge:<vault_id>
Valeur :      <challenge_hex>
TTL :         300 secondes (5 minutes)
```

- Single-use : la clé est supprimée immédiatement après vérification
- Rate limiting : max 10 challenges/heure par vault (anti-brute force)

### 4.4 Jetons d'accès (JWT)

```json
{
  "sub": "<vault_id>",
  "type": "agent",
  "plan": "agent_free",
  "iat": 1746835200,
  "exp": 1746838800
}
```

- Signature : HMAC-SHA256 avec le même `JWT_SECRET` que l'API humaine
- TTL : 1 heure (3600 secondes)
- Renouvellement automatique par le SDK (refresh 5 min avant expiration)
- Le claim `type: "agent"` permet au middleware de différencier les requêtes agent/humain

### 4.5 Middleware d'authentification (adaptation de l'existant)

```typescript
// apps/api/src/middleware/auth.ts — ajout
declare module "fastify" {
  interface FastifyRequest {
    userId?: string;      // utilisateur humain (existant)
    vaultId?: string;      // vault agent (nouveau)
  }
}

// Le middleware existant authenticate() vérifie :
// - Si Authorization: Bearer <jwt> et jwt.type === "user" → request.userId
// - Si Authorization: Bearer <jwt> et jwt.type === "agent" → request.vaultId
// - Les routes MCP vérifient request.vaultId (pas request.userId)
// - Les routes humaines vérifient request.userId (pas request.vaultId)
```

---

## 5. Réutilisation de @serac/crypto

### 5.1 Fonctions réutilisées sans modification

| Fonction | Usage agent | Changement |
|----------|------------|------------|
| `generateFileKey()` | Générer un File Key par fichier | ✅ Aucun |
| `wrapFileKey()` | Envelopper un File Key avec le Master Key | ✅ Aucun |
| `unwrapFileKey()` | Déballer un File Key | ✅ Aucun |
| `computeKeyCommitment()` | Empreinte BLAKE2b anti-tampering | ✅ Aucun |
| `verifyKeyCommitment()` | Vérifier l'empreinte | ✅ Aucun |
| `encryptFile()` | Chiffrer un fichier ≤ 4MB | ✅ Aucun |
| `decryptFile()` | Déchiffrer un fichier ≤ 4MB | ✅ Aucun |
| `encryptStream()` | Chiffer un flux > 4MB | ✅ Aucun |
| `decryptStream()` | Déchiffrer un flux > 4MB | ✅ Aucun |
| `encryptForRecipient()` | Sealed box X25519 | ✅ Aucun |
| `decryptFromSender()` | Déballer sealed box | ✅ Aucun |
| `shareFileKey()` | Partager un File Key | ✅ Aucun |
| `receiveSharedFileKey()` | Recevoir un File Key partagé | ✅ Aucun |
| `generateGroupKey()` | Clé de groupe | ✅ Aucun |
| `createGroupKeyBundle()` | Bundle de groupe | ✅ Aucun |
| `addGroupMember()` | Ajouter un membre | ✅ Aucun |
| `rotateGroupKey()` | Rotation clé de groupe | ✅ Aucun |
| `hash()` | BLAKE2b | ✅ Aucun |
| `randomBytes()` | Bytes aléatoires | ✅ Aucun |
| `toHex()`, `fromHex()` | Encodage | ✅ Aucun |
| `toBase64()`, `fromBase64()` | Encodage | ✅ Aucun |
| `secureCompare()` | Comparaison en temps constant | ✅ Aucun |
| `zeroMemory()` | Zéroisation mémoire | ✅ Aucun |

**Total : 22 fonctions réutilisées sans aucun changement.**

### 5.2 Fonctions adaptées pour les agents

| Fonction existante | Adaptation agent | Description |
|-------------------|-----------------|-------------|
| `createRegistrationBundle()` | NON utilisée | L'agent ne dérive pas de passphrase → Argon2id |
| `loginDecrypt()` | NON utilisée | L'agent ne fait pas de login passphrase |
| `deriveKeys()` | NON utilisée | Pas de dérivation HKDF/Argon2id pour les agents |
| `generateSalt()` | NON utilisée | Pas de sel pour les agents |
| `encryptIdentity()` | Adapté → `encryptAgentMasterKey()` | Chiffre le Master Key avec la clé publique X25519 de l'agent (sealed box au lieu de secretbox) |
| `decryptIdentity()` | Adapté → `decryptAgentMasterKey()` | Déchiffre le Master Key avec la clé privée X25519 de l'agent |
| `generateIdentityKeypair()` | Adapté → Ed25519 natif | L'agent génère un keypair Ed25519 (signing + X25519 dérivé) au lieu de X25519 + Ed25519 séparés |
| `generateRecoveryKit()` | NON utilisée | Pas de BIP39 pour les agents |
| `recoverMasterKey()` | NON utilisée | Pas de recovery par mnémonique |

**Fonctions nouvelles pour les agents (SDK Python)** :

| Nouvelle fonction | Description |
|------------------|-------------|
| `createAgentVault()` | Génère keypair Ed25519 + Master Key aléatoire + sealed box |
| `signChallenge(challenge, vault_id, private_key)` | Signature Ed25519 du challenge |
| `decryptAgentMasterKey(encrypted_mk, public_key, private_key)` | Déballage sealed box du Master Key |
| `ed25519ToX25519(ed_key)` | Conversion Ed25519 → X25519 (pour sealed box) |

### 5.3 Constantes partagées

Ces constantes sont **identiques** entre `@serac/crypto` et `serac-mcp` SDK Python :

```python
# serac_mcp/crypto/constants.py
MASTER_KEY_LENGTH = 32       # 256 bits
FILE_KEY_LENGTH = 32         # 256 bits
GROUP_KEY_LENGTH = 32        # 256 bits
CHUNK_SIZE = 65536           # 64 KB
AEAD_TAG_LENGTH = 16         # Poly1305 tag
KEY_ALGORITHM_V1 = "v1-x25519-ed25519"
ARGON2_MEM_LIMIT = 67108864  # 64 MB (humain seulement)
ARGON2_OPS_LIMIT = 3         # (humain seulement)
SALT_LENGTH = 16             # (humain seulement)
```

---

## 6. Recovery agent (opt-in V1)

### 6.1 Principe

Les agents n'ont pas de passphrase à perdre, mais ils peuvent **perdre leur clé privée Ed25519** (corruption, suppression accidentelle). Le recovery agent permet à un **propriétaire humain** de récupérer l'accès au vault.

### 6.2 Enregistrement du guardian

```
1. Le propriétaire humain a un compte Serac avec Master Key (MK_human)
2. L'agent provisionne son vault comme d'habitude
3. L'humain enregistre son X25519 public key comme guardian du vault agent :
   POST /v1/vaults/{vault_id}/guardian
   {
     "guardian_public_key": "x25519:<base64url>",
     "encrypted_master_key_for_guardian": "hex...",
     "guardian_key_nonce": "hex..."
   }
   
   encrypted_master_key_for_guardian = crypto_box_seal(
     agent_master_key,
     x25519_public_key_of_human
   )
```

### 6.3 Recovery

```
1. L'agent perd sa clé privée → ne peut plus déchiffrer son Master Key
2. Le propriétaire humain s'authentifie sur l'API avec son compte Serac
3. Le propriétaire télécharge le encrypted_master_key_for_guardian
4. Le propriétaire déchiffre avec sa propre clé : 
   recovered_mk = crypto_box_seal_open(encrypted_mk_human, x25519_pub_human, x25519_priv_human)
5. L'agent (ou un nouvel agent) génère un nouveau keypair
6. Le Master Key est re-chiffré pour le nouveau keypair :
   new_encrypted_mk = crypto_box_seal(recovered_mk, new_x25519_pubkey)
7. PUT /v1/vaults/{vault_id}/rotate-key
   { new_public_key, new_encrypted_master_key, new_key_commitment }
```

### 6.4 Contraintes

- Un vault peut avoir **jusqu'à 3 guardians** (multi-sig pas en V1)
- Le guardian est **opt-in** — un vault agent peut fonctionner sans guardian, mais la perte de la clé privée est alors irréversible
- Le guardian ne voit **jamais** le contenu en clair — il ne fait que déballer le Master Key chiffré, pas les fichiers
- En V1, pas de rotation automatique des clés guardian

---

## 7. Interopérabilité humain ↔ agent

### 7.1 Partage humain → agent

Un utilisateur humain peut partager un fichier avec un vault agent en utilisant **le même protocole de partage existant** :

```
1. L'humain récupère la X25519 public key du vault agent :
   GET /v1/vaults/{vault_id}/public-key → { public_key: "x25519:..." }
   
2. L'humain chiffre le File Key avec la clé publique du vault agent :
   encrypted_file_key = shareFileKey(file_key, agent_x25519_pubkey)
   
3. Le serveur stocke le share comme d'habitude dans file_shares
```

L'agent déchiffre avec `receiveSharedFileKey()` — **exactement le même code que le partage humain-humain**.

### 7.2 Partage agent → humain

Même flux inverse :
```
1. L'agent récupère la X25519 public key de l'utilisateur humain :
   GET /v1/users/public-key/{email}
   
2. L'agent chiffre le File Key avec la clé publique humaine :
   encrypted_file_key = shareFileKey(file_key, human_x25519_pubkey)
   
3. Le serveur stocke le share dans file_shares
```

**Aucun changement au protocole de partage existant.** La seule différence est le source du `encrypted_file_key` — le mécanisme sealed box X25519 est identique.

### 7.3 Partage agent → agent

Identique au partage humain-humain. Deux vaults agent peuvent partager des fichiers entre eux via sealed box X25519.

---

## 8. Format de la clé publique agent

### 8.1 Spécification

```
ed25519:<base64url_nopad>
```

Exemple :
```
ed25519:R4ND0MBA5E64URL52yT3Th4t1s32Byt3sL0ngXXXX=
```

Le préfixe `ed25519:` indique l'algorithme et permet la migration future vers des keypairs post-quantiques (ex: `mlkem768:...`).

### 8.2 Conversion Ed25519 → X25519

Les clés Ed25519 et X25519 sont mathématiquement liées. La conversion se fait via la formule standard de libsodium :

```python
from nacl.bindings import crypto_sign_ed25519_pk_to_curve25519

def ed25519_to_x25519_public(ed25519_public_key: bytes) -> bytes:
    """Convert Ed25519 public key to X25519 public key."""
    return crypto_sign_ed25519_pk_to_curve25519(ed25519_public_key)

def ed25519_to_x25519_private(ed25519_private_key: bytes) -> bytes:
    """Convert Ed25519 private key to X25519 private key."""
    return crypto_sign_ed25519_sk_to_curve25519(ed25519_private_key)
```

Cette conversion est bine supportée par PyNaCl (Python) et libsodium.js (JavaScript).

### 8.3 Tableau des tailles

| Élément | Taille en octets | Taille hex | Taille base64url |
|---------|------------------|------------|-------------------|
| Ed25519 public key | 32 | 64 | 43 |
| Ed25519 private key | 32 | 64 | 43 |
| Ed25519 signature | 64 | 128 | 86 |
| Master Key | 32 | 64 | 43 |
| Sealed box output (32 bytes in) | 80 | 160 | 108 |
| Challenge nonce | 32 | 64 | 43 |
| X25519 public key (converti) | 32 | 64 | 43 |

---

## 9. Considérations de sécurité

### 9.1 Attaques mitigées

| Attaque | Mitigation |
|---------|------------|
| Brute force du Master Key agent | Impossible — 2^256 entropie, pas de dérivation |
| Rejeu du challenge d'auth | Challenge single-use (Redis TTL 5 min) + timestamp dans signature |
| Élévation de privilège agent→humain | JWT claim `type: "agent"` différencie les deux |
| Échange de challenges entre vaults | `vault_id` inclus dans le message signé |
| Fuite du Master Key au serveur | Sealed box — le serveur stocke le MK chiffré, ne peut pas le lire |
| Fuite de la clé privée agent | Résidence mémoire uniquement, zéroisation en fin de session |
| Multi-key attack | `key_commitment` BLAKE2b-256 vérifié lors du décryptage |
| Truncation attack | `isFinal` flag sur le dernier chunk (hérité de l'existant) |
| Chunk reordering | `chunkIndex` dans l'AAD (hérité de l'existant) |

### 9.2 Risques résiduels

| Risque | Probabilité | Impact | Mitigation |
|--------|------------|--------|------------|
| Perte de clé privée agent sans guardian | Moyen (misconfiguration) | Perte totale des données | Opt-in guardian V1, documentation claire |
| Corruption du `encrypted_master_key` en DB | Faible | Perte d'accès | Backup DB quotidien + restic vers S3 |
| Attaque side-channel sur la mémoire agent | Très faible | Fuite du Master Key | `zeroMemory()` en fin de session, exécution dans environnement isolé |
| Collision de `key_commitment` | Négligeable (2^128) | Acceptation d'une mauvaise clé | BLAKE2b-256 est résistant aux collisions |

---

## 10. Tests d'interopérabilité

### 10.1 Vecteurs de test croisés

Pour garantir que le SDK Python et `@serac/crypto` JavaScript produisent des résultats identiques, les tests suivants doivent passer :

```python
# Test 1 : Chiffrement JavaScript → Déchiffrement Python
# 1. Générer un Master Key en JS
# 2. Chiffrer un fichier avec encryptFile() en JS
# 3. Exporter : ciphertext, nonce, encryptedFileKey, fileKeyNonce, keyCommitment, masterKey (hex)
# 4. En Python : déchiffrer avec les mêmes paramètres
# 5. Vérifier que le plaintext correspond

# Test 2 : Chiffrement Python → Déchiffrement JavaScript
# Inverse du Test 1

# Test 3 : Streaming JavaScript → Déchiffrement Python
# 1. Chiffrer un fichier de 10 MB avec encryptStream() en JS (chunks 64 KB)
# 2. Exporter : chunks chiffrés + masterKey
# 3. En Python : déchiffrer avec decryptStream()
# 4. Vérifier que le plaintext correspond

# Test 4 : Sealed box partage JavaScript → Python
# 1. Générer keypair agent en Python
# 2. En JS : shareFileKey(fileKey, pythonX25519PublicKey)
# 3. En Python : receiveSharedFileKey(encryptedFileKey, pythonPub, pythonPriv)
# 4. Vérifier que le File Key correspond

# Test 5 : Challenge-response end-to-end
# 1. Générer keypair en Python
# 2. Signer un challenge avec la clé privée
# 3. Vérifier la signature avec la clé publique en JS
# 4. Vice versa
```

### 10.2 Intégration continue

Ces tests seront exécutés dans le CI des deux projets :
- `serac` (JS) : `npm run test:interop`
- `serac-mcp` (Python) : `pytest tests/test_interop.py`

Les vecteurs de test sont stockés dans un fichier JSON partagé : `tests/vectors/interop-v1.json`

---

## 11. Résumé des décisions

| ID | Décision | Choix | Justification |
|----|---------|-------|---------------|
| ADR-001-D1 | Chiffrement V1 | Simple Key (MK → FK → contenu) | Battle-tested, 66 correctifs, interopérable |
| ADR-001-D2 | Auth agent | Ed25519 challenge-response | Non-rejeu, pas de secret stocké, preuve cryptographique |
| ADR-001-D3 | Master Key agent | randombytes_buf(32) | Pas de passphrase → pas de Argon2id nécessaire |
| ADR-001-D4 | Recovery agent | Opt-in guardian (V1) | Propriétaire humain peut recréer l'accès |
| ADR-001-D5 | Interopérabilité | 100% rétro-compatible | Sealed box X25519 existant pour partage humain↔agent |
| ADR-001-D6 | Constantes | Identiques JS/Python | Même CHUNK_SIZE, KEY_LENGTH, algorithme |
| ADR-001-D7 | Format clé publique | `ed25519:<base64url>` | Préfixe pour migration future (PQC) |
| ADR-001-D8 | Key commitment | BLAKE2b-256 (hérité) | Anti multi-key attack, identique au système humain |

---

## Annexe A : Schéma de la DB additionnel

```sql
-- Vaults créés par des agents IA
CREATE TABLE agent_vaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id),                    -- propriétaire humain (optionnel V1)
    public_key BYTEA NOT NULL UNIQUE,                      -- Ed25519 public key (32 bytes)
    encrypted_master_key BYTEA NOT NULL,                   -- Master Key chiffré par sealed box
    key_commitment BYTEA NOT NULL,                         -- BLAKE2b-256 du Master Key
    key_algorithm TEXT NOT NULL DEFAULT 'v1-x25519-ed25519',
    plan_id UUID REFERENCES plans(id),
    storage_used_bytes BIGINT DEFAULT 0,
    disabled_at TIMESTAMPTZ,                               -- désactivation
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_vaults_public_key ON agent_vaults (public_key);
CREATE INDEX idx_agent_vaults_owner ON agent_vaults (owner_id) WHERE owner_id IS NOT NULL;

-- NOTE : Les sessions agent utilisent JWT+Redis (ADR-002/ADR-005), PAS une table PostgreSQL.
-- Les challenges Ed25519 sont stockés dans Redis avec TTL 5 min (single-use).
-- Les JWT sont signés HMAC-SHA256, vérifiés sans accès DB.
-- La table agent_sessions du draft initial est supprimée — voir ADR-002 section Auth.

-- Guardians du vault (propriétaires humains)
CREATE TABLE vault_guardians (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vault_id UUID NOT NULL REFERENCES agent_vaults(id) ON DELETE CASCADE,
    guardian_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_master_key_for_guardian BYTEA NOT NULL,      -- MK chiffré par X25519 pubkey du guardian
    guardian_key_nonce BYTEA,                              -- nonce (si secretbox, null si sealed box)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_vault_guardians_per_vault ON vault_guardians (vault_id, guardian_user_id);

-- Extension de la table files pour supporter les vaults agents
ALTER TABLE files ADD COLUMN vault_id UUID REFERENCES agent_vaults(id);
ALTER TABLE files ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'user'
    CHECK (owner_type IN ('user', 'agent'));

-- Extension de users pour supporter les agents
ALTER TABLE users ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'passphrase'
    CHECK (auth_type IN ('passphrase', 'agent_key'));
ALTER TABLE users ADD COLUMN agent_vault_id UUID REFERENCES agent_vaults(id);
```

## Annexe B : Nouveaux plans tarifaires

```sql
INSERT INTO plans (name, display_name, storage_bytes, price_cents, glacier_enabled) VALUES
    ('agent_free', 'Agent Free', 5368709120, 0, FALSE),       -- 5 Go
    ('agent_pro', 'Agent Pro', 107374182400, 999, TRUE),       -- 100 Go à 9.99€/mois
    ('agent_enterprise', 'Agent Enterprise', 536870912000, 4999, TRUE);  -- 500 Go à 49.99€/mois
```