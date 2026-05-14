# ADR-010 — Paiement agents (Stripe V1, Circle USDC V2)

**Date** : 14 mai 2026  
**Statut** : Accepté

## Contexte

Les agents IA autonomes doivent pouvoir payer pour leur stockage. Le paiement par carte bancaire (Stripe) nécessite une intervention humaine. Le paiement crypto (USDC) permet le self-service agent mais ajoute de la complexité. Il faut une stratégie progressive.

## Options considérées

1. **Stripe uniquement** — Paiement par carte, géré par le propriétaire humain de l'agent. Simple, fiable, mais pas de self-service agent.
2. **Crypto uniquement (USDC)** — Self-service agent, pas d'intervention humaine. Mais adoption crypto limitée, volatilité, complexité technique.
3. **Stripe V1 + USDC V2** — Stripe pour le MVP (les propriétaires humains paient), USDC en V2 (quand les agents sont prêts à payer seuls).
4. **x402 protocol** — Standard HTTP 402 avec crypto micropaiements. Émergeant, pas de bibliothèque mature.
5. **Stripe Crypto** — Stripe supporte les paiements crypto mais redirige vers un browser. Incompatible avec les agents.

## Décision

**Option 3 : Stripe V1, Circle USDC V2.**

V1 (MVP) :
- Stripe Checkout pour les propriétaires humains
- Stripe API pour la gestion programmatique (upgrade, downgrade, cancel)
- Le propriétaire paie pour tous ses agents
- Webhooks Stripe pour les changements de plan en temps réel

V2 (Phase 4) :
- Circle USDC API : REST, pas de browser redirect, ~$0.01 gas sur Polygon/Base
- L'agent paie de manière autonome depuis son wallet
- x402 protocol : évaluation en V2, pas de commit V1

## Conséquences

**Positives** :
- Stripe = fiable, bien documenté, gestion fiscale française
- USDC V2 = vision "agent self-service" préservée
- Circle API = pure REST, compatible agents (pas de browser)
- Pas de lock-in : Stripe peut coexister avec USDC

**Négatives** :
- V1 = pas de self-service agent (l'humain paie)
- USDC = complexité technique (wallet management, transaction monitoring, gas fees)
- Circle = plateforme centralisée (pas décentralisé) — contradicteur avec la philosophie souveraineté
- x402 pas mature = risque de ré-évaluation

## Références

- Détails : `architecture/pricing-model.md` (section Payment)
- Circle API : https://developers.circle.com