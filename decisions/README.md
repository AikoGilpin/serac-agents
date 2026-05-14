# Décisions — Architecture Decision Records (ADR)

*Dossier créé le 3 mai 2026, mis à jour le 14 mai 2026.*

## Format ADR
- **ADR-XXX** : Titre court
- **Contexte** : Pourquoi la décision est nécessaire
- **Options considérées** : Avec pros/cons
- **Décision** : Ce qu'on retient
- **Conséquences** : Impact positif et négatif

---

## ADR formels

Chaque ADR a un document dédié dans ce dossier :

| Fichier | Décision | Statut |
|---------|----------|--------|
| `001-encryption-protocol.md` | Protocole chiffrement agent (Simple Key, Ed25519 + MK random) | ✅ Accepté |
| `002-mcp-server.md` | Spécification MCP Server (HTTP Streamable + REST, 5 tools V1) | ✅ Accepté |
| `003-pricing-model.md` | Modèle de pricing (4 tiers, tiering auto OVH, Stripe V1) | ✅ Accepté |
| `004-sdk-spec.md` | SDK Client TS + Python (2 modes MCP/E2EE, interop, build S1-S5) | ✅ Accepté |
| `005-hybrid-auth.md` | Authentification hybride (API key + Ed25519 challenge-response) | ✅ Accepté |
| `006-guardian-recovery.md` | Guardian/Recovery (owner escrow V1, multi-guardian V2) | ✅ Accepté |
| `007-automatic-tiering.md` | Tiering automatique OVH (chaud/tiède/froid/Glacier opt-in) | ✅ Accepté |
| `008-discovery-layers.md` | Discovery 4 couches (well-known, serac.json, MCP Remote, WebMCP) | ✅ Accepté |
| `009-remove-modules.md` | Suppression modules V1 (Email, Visio, Docs ; garder Messagerie) | ✅ Accepté |
| `010-payment-strategy.md` | Paiement agents (Stripe V1, Circle USDC V2) | ✅ Accepté |

## Détails validés (fusion Kira+CC, mai 2026)

| ADR | Décision | Date |
|-----|----------|------|
| ADR-001 | Protocole chiffrement agent : Simple Key (Ed25519 + MK random 256-bit, skip Argon2id) | 03-05-2026 |
| D1 | Simple Key (existing crypto) | Validé Kira+CC |
| D2 | Guardian V1 : owner escrow (1 guardian = human owner) | Validé Kira+CC |
| D3 | Freemium 5 Go (pas 1 Go) | Validé Kira+CC |
| D4 | Circle USDC API pour agents (V2), Stripe pour humains | Validé Kira+CC |
| D5 | Auth : Ed25519 challenge-response | Validé Kira+CC |
| D6 | Grace period 30d capped 5 Go → read-only 30d → deletion | Validé Kira+CC |
| D7 | HTTP Streamable MCP transport | Validé Kira+CC |
| D8 | Remove Email/Visio/Docs from nav | Validé Kira+CC |
| D9 | date_taken stays in clear | Validé Kira+CC |
| D10 | SDK Python : faithful port of @serac/crypto | Validé Kira+CC |
| — | Table : agent_vaults (branding) / namespaces (API) | Validé Kira+CC |
| — | Tools V1 : 5 tools (store/retrieve/list/delete/quota) | Validé Kira+CC |
| — | Auth hybride : API key → JWT + challenge-response Ed25519 | Validé Kira+CC |
| — | Pricing : Free 5Go/€0, Starter 100Go/€3.99, Pro 500Go/€9.99, Fleet 2TB/€29.99 | Validé Kira+CC |
| — | Tiering automatique OVH (chaud/tiède/froid/Glacier) | Validé Kira+CC |
| — | Discovery : 4 couches (.well-known/mcp.json, serac.json, MCP server, WebMCP) | Validé Kira+CC |
| — | SDK : TS + Python en parallèle dès Phase 1 | Validé Kira+CC |
| — | SDK modes : MCP (at-rest) + E2EE (client-side), même API | ADR-004 |
| — | SDK interop : vecteurs de test JS↔Python partagés | ADR-004 |
| — | SDK build : 5 semaines (S1-S3 TS, S4-S5 Python) | ADR-004 |
| — | Attestation Ed25519 : V2 (pas MVP core) | Validé Kira+CC |
| — | Search sémantique : V2 haute priorité | Validé Kira+CC |
| — | x402 USDC : V2 (Phase 4) | Validé Kira+CC |
| — | WebMCP : Phase 3 (polyfill maintenant, natif quand Chrome stable) | Validé Kira+CC |

## Décisions antérieures

- **HDS/SecNumCloud santé hors périmètre** (3 mai 2026) — trop de réglementation, pas de contacts. Serac ne vise pas le segment santé.

## Décisions en attente

- Pricing Enterprise : aligner sur €29.99/2TB (acquisition) vs marges plus élevées sur tiers inférieurs
- OVH/Seald threat : si OVH lance S3 E2E consumer, le moat "E2E + OVH" s'effondre. Le vrai différenciant devient "agent-native + MCP"
- Semantic search V2 : client-side indexing vs server-side with encrypted embeddings (profil performance détaillé à faire)
- ~~SDK Python timeline : parallèle vs séquentiel (TS d'abord, Python ensuite)~~ → **Résolu ADR-004** : TypeScript S1-S3, Python S4-S5 (parallèle mais décalé)