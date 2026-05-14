# ADR-001 — Protocole de chiffrement agent (Simple Key)

**Date** : 3 mai 2026  
**Statut** : Accepté  
**Spécification complète** : `architecture/encryption-protocol.md`

## Contexte

Serac utilise un modèle de chiffrement E2E conçu pour les humains : passphrase 24 mots → Argon2id → Master Key. Ce modèle est inutilisable pour les agents IA qui ne peuvent pas mémoriser de passphrases ni compléter de CAPTCHAs. Il faut un protocole de chiffrement agent-compatible tout en maintenant l'interopérabilité avec le système humain existant.

## Options considérées

1. **Simple Key** — Ed25519 keypair + Master Key aléatoire 256-bit, pas de Argon2id. Le client gère la clé, le serveur ne voit jamais la MK en clair.
2. **Delegated Key** — Le serveur génère la MK et l'envoie chiffrée à l'agent. Plus simple mais le serveur voit la MK en transit.
3. **Threshold Secret Sharing** — La MK est splitée entre N serveurs (Shamir). Complexe, overkill pour V1.
4. **HSM/KMS** — Utiliser AWS KMS ou OVH KMS. Ajoute une dépendance cloud et un coût récurrent.

## Décision

**Simple Key** (option 1).

- Ed25519 keypair pour l'authentification (signature de challenges)
- X25519 dérivé pour le chiffrement (sealed box)
- Master Key = `randombytes_buf(32)` (pas de Argon2id — pas de passphrase à dériver)
- MK chiffrée via `crypto_box_seal(mk, x25519_pubkey)` → stockée côté serveur, impossible à lire sans la clé privée
- Clé privée Ed25519 stockée localement par l'agent (env var, keystore OS, fichier chiffré)

Hiérarchie des clés :
```
ed25519_keypair (généré localement, jamais envoyé au serveur)
  → x25519 derived (for sealed box encryption)
  → Master Key = randombytes_buf(32)
     → File Keys (même @serac/crypto que le système humain)
        → XChaCha20-Poly1305 streaming (64KB chunks)
```

## Conséquences

**Positives** :
- 90% de `@serac/crypto` réutilisé tel quel (22 fonctions inchangées, 4 adaptées, 4 nouvelles)
- Zéro changement au protocole humain existant
- Interopérabilité humain↔agent garantie (sealed box X25519)
- Provisioning autonome possible (l'agent peut créer son vault seul)

**Négatives** :
- Perte de clé = perte de données (pas de passphrase à récupérer) — atténué par le Guardian (ADR-006)
- L'agent doit gérer sa clé privée (env var ou keystore) — le SDK gère cela
- Pas de Argon2id signifie pas de dérivation depuis passphrase — OK pour agents, différent du modèle humain

## Références

- Détails : `architecture/encryption-protocol.md`
- Analyse gap : `architecture/gap-analysis.md` (D1)