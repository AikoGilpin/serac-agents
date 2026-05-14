# ADR-009 — Suppression modules V1 (Email, Visio, Docs)

**Date** : 3 mai 2026  
**Statut** : Accepté

## Contexte

Serac.cloud propose actuellement Drive, Photos, Messagerie, Email, Docs, Visio et Archivage Glacier. Le pivot agent-storage implique de se concentrer sur le stockage chiffré (Drive, Photos, Glacier) et d'éliminer les modules qui ajoutent de la complexité sans contribuer à la proposition agent. Email, Visio et Docs sont les candidats à la suppression.

## Options considérées

1. **Tout garder** — Continuer à maintenir tous les modules. Charge de maintenance élevée, pas de focus.
2. **Supprimer Email + Visio + Docs** — Les 3 modules les moins alignés avec le stockage agent. Messagerie reste (potentiel Agent Messaging Phase 6).
3. **Supprimer aussi Messagerie** — Focus maximal sur le stockage. Plus simple mais perd le potentiel Agent Messaging.
4. **Garder Email** — Email a des synergies avec les agents (réception de notifications, rapports). Mais complexité d'infrastructure (MX records, spam filtering, deliverabilité).

## Décision

**Option 2 : Supprimer Email, Visio, Docs. Garder Messagerie.**

- Email : supprimé (infrastructure lourde, MX records, spam filtering — pas aligné avec stockage agent)
- Visio : supprimé (WebRTC, signaling server — totalement hors scope)
- Docs : supprimé (éditeur collaboratif — les agents n'éditent pas de docs collaboratifs)
- Messagerie : conservé (potentiel Agent Messaging en Phase 6 — messages inter-agents)

Implémentation Phase 0 :
- Supprimer les routes du frontend (nav, pages)
- Soft-404 sur les URLs existantes (pas de 500)
- Garder le code en place (pas de suppression massive) — désactivation, pas suppression
- Mettre à jour les migrations DB (ne pas supprimer les tables existantes)

## Conséquences

**Positives** :
- Focus sur le cœur du produit : stockage chiffré + MCP
- Charge de maintenance réduite (pas de MX records, pas de WebRTC, pas de collaborative editing)
- Messagerie conservée pour le potentiel Agent Messaging

**Négatives** :
- Perte potentielle d'utilisateurs humains qui utilisaient Email/Visio/Docs
- Code désactivé mais pas supprimé = dette technique (cleanup complet en Phase 2)
- Messagerie = complexité maintenue pour un feature V2 lointain

## Références

- Gap analysis : `architecture/gap-analysis.md` (D8)