# ADR-003 — Modèle de pricing agents

**Date** : 14 mai 2026  
**Statut** : Accepté  
**Spécification complète** : `architecture/pricing-model.md`

## Contexte

Serac Agents doit avoir un pricing adapté aux agents IA autonomes qui n'ont pas de budget marketing traditionnel. Les agents ne cliquent pas sur des pubs, ne lisent pas des emails — ils découvrent les services via MCP registries et configurent des outils en une ligne de config. Le pricing doit être simple, compétitif, et permettre le self-service.

## Options considérées

1. **Freemium 1 Go** — Suffit pour des fichiers texte, trop petit pour des datasets réels (300+ Go). Aucune conversion.
2. **Freemium 5 Go** — Suffit pour tester avec des vraies données. La taille d'un petit dataset de recherche.
3. **Pas de freemium** — Payant dès le début. Friction d'acquisition maximale.
4. **Pay-per-use** — €/Go/mois sans tiers. Simple mais imprévisible pour les agents.
5. **Tiers + pay-per-use overflow** — Tiers pour le prépayé, overflow au Go. Complexe en V1.

## Décision

**Option 2 + tiers** : Freemium 5 Go + 3 tiers payants.

| Tier | Stockage | Prix TTC | Coût estimé (avec tiering) | Marge |
|------|----------|----------|---------------------------|-------|
| Free | 5 Go | €0 | ~€0.07 | — |
| Starter | 100 Go | €3.99 | ~€1.20 | ~70% |
| Pro | 500 Go | €9.99 | ~€5.50 | ~45% |
| Fleet | 2 To | €29.99 | ~€18 | ~40% |

**Tiering automatique OVH** (comme AWS Intelligent-Tiering, mais E2E) :
- Chaud (< 7j) → Standard 3-AZ (€0.014/Go)
- Tiède (7-30j) → Infrequent Access (€0.0095/Go)
- Froid (> 30j) → Active Archive (€0.0045/Go)
- Glacier → Cold Archive (€0.0016644/Go, 180j min + pénalité early recovery)

Over-quota : 30 jours de grâce plafonné 5 Go → 30 jours read-only → suppression.

Paiement : Stripe V1 (humains + API agent owners), Circle USDC V2 (agents autonomes).

## Conséquences

**Positives** :
- 5 Go free = zéro friction pour l'agent qui teste
- Tiering automatique maximise les marges sans complexité pour l'agent
- Egress OVH gratuit = avantage majeur vs AWS ($0.09/Go)
- Break-even estimé ~25-30 agents payants

**Négatives** :
- Free 5 Go = coût réel ~€2.40/agent/an (stockage chaud, sans tiering)
- Marges réelles initialement 45-55% (données majoritairement chaudes) avant que le tiering n'optimise
- Fleet 2TB = marge ~40% avec tiering, ~7% sans tiering — le tiering est critique
- USDC V2 complexe à implémenter, Stripe ne permet pas le self-service agent sans browser

## Références

- Détails : `architecture/pricing-model.md`
- Coûts OVH réels : Standard 3-AZ €0.014/Go, Infrequent Access €0.0095/Go, Active Archive €0.0045/Go, Cold Archive €0.0016644/Go