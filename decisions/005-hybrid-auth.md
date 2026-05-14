# ADR-005 — Modèle d'authentification hybride (API key + Ed25519 challenge-response)

**Date** : 14 mai 2026  
**Statut** : Accepté

## Contexte

Les agents IA ont besoin d'une authentification pour Serac Agents. Le modèle humain (email + mot de passe + 2FA) est inutilisable. L'agent doit pouvoir s'authentifier programmatiquement, mais l'authentification doit rester sécurisée contre le replay et le vol de token.

## Options considérées

1. **API key statique uniquement** — Simple, une ligne de config. Mais vulnérable au replay et au vol (la key est en clair dans la config).
2. **Ed25519 challenge-response uniquement** — Sécurisé, non-replayable. Mais complexe à configurer pour le premier contact (l'agent doit générer un keypair, enregistrer la pubkey, etc.).
3. **API key → JWT + challenge-response pour renouvellement** — API key pour le premier contact (simple), Ed25519 pour les renouvellements (sécurisé). Le meilleur des deux mondes.
4. **OAuth 2.0** — Dédié aux humains. Inutile pour les agents (pas de browser, pas de consent screen).

## Décision

**Option 3 : Authentification hybride.**

Flux :
1. **Premier contact** : L'agent envoie `Authorization: Bearer sk_serac_xxxxx` (API key statique). Le serveur valide et émet un JWT TTL 1h avec claim `type: "agent"`.
2. **Renouvellement JWT** : L'agent utilise challenge-response Ed25519 :
   - GET `/v1/auth/challenge` → nonce + timestamp (Redis TTL 5 min, single-use)
   - POST `/v1/auth/token` → sign challenge avec Ed25519 key → nouveau JWT
   - POST `/v1/auth/verify` (optional) → vérification supplémentaire
3. **Auto-enrollment** : POST `/v1/vaults/create` avec Ed25519 pubkey + encrypted MK + commitment

Limites de sécurité :
- Max 10 challenges/heure par vault
- JWT TTL 1h (renouvellement 5 min avant expiration)
- API key révocable individuellement sans casser les autres

## Conséquences

**Positives** :
- API key = 1 ligne de config (`SERAC_API_KEY=sk_serac_xxxxx`) → zéro friction MCP
- Challenge-response = non-replayable, résistant au vol de token
- JWT claim `type: "agent"` différencie des sessions humaines
- Auto-enrollment possible (l'agent crée son vault via API key puis setup le challenge-response)

**Négatives** :
- Deux mécanismes à maintenir
- L'API key est en clair dans les configs des agents (atténuation : rotation possible, révocation individuelle)
- Le flux challenge-response ajoute 2 requêtes HTTP par renouvellement (negligeable vs sécurité gagnée)

## Références

- Détails : `architecture/encryption-protocol.md` (section Auth), `architecture/mcp-server-spec.md` (section Auth)
- ADR-001 pour le modèle de clé Ed25519