# ADR-006 — Modèle Guardian / Recovery (owner escrow V1)

**Date** : 3 mai 2026  
**Statut** : Accepté

## Contexte

Le modèle Simple Key (ADR-001) a une conséquence critique : perte de clé = perte de données. Les agents sont éphémères (redéploiement, crash, migration). Sans mécanisme de recovery, un agent qui perd sa clé perd tout son stockage de manière irréversible.

## Options considérées

1. **Pas de recovery** — Perte de clé = perte de données. Simple mais inacceptable pour un service de stockage.
2. **Owner escrow (V1)** — Le propriétaire humain enregistre sa clé X25519 comme guardian. La MK est chiffrée en sealed box pour le guardian. Un seul guardian en V1.
3. **Multi-guardian quorum (V1)** — N-of-M guardians, type Shamir. Complexe, overkill pour V1.
4. **Server-side recovery key** — Le serveur stocke une recovery key. Contredit le zero-knowledge.

## Décision

**Option 2 : Owner escrow V1, multi-guardian V2.**

V1 :
- 1 guardian = le propriétaire humain de l'agent
- MK sealed-box-encryptée pour la X25519 pubkey du guardian
- L'agent NE PEUT PAS révoquer l'accès guardian (protection Owner Override)
- Si l'agent perd sa clé : guardian déchiffre MK, agent génère nouveau keypair, MK re-chiffrée pour nouveau keypair

V2 (post-MVP) :
- Jusqu'à 3 guardians (propriétaire + 2 tiers de confiance)
- Quorum M-of-N (2-of-3 minimum pour recovery)
- Possibilité de guardian rotation sans agent

## Conséquences

**Positives** :
- Recovery garanti pour le cas le plus courant (agent redéployé)
- Zero-knowledge préservé : le serveur ne voit jamais la MK
- Sealed box X25519 = fonction déja existante dans @serac/crypto
- Contrôle humain sur les données de l'agent (propriétaire = guardian)

**Négatives** :
- V1 limité à 1 guardian (pas de quorum)
- L'agent ne peut pas révoker l'accès guardian (by design, mais peut surprendre)
- Nécessite une action humaine (le guardian doit utiliser sa clé pour déchiffrer la MK)

## Références

- Détails : `architecture/encryption-protocol.md` (section Recovery)
- DB : `vault_guardians` table dans `architecture/mcp-server-spec.md`