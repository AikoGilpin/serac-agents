# ADR-007 — Tiering automatique OVH

**Date** : 14 mai 2026  
**Statut** : Accepté

## Contexte

Les marges Serac Agents dépendent du coût de stockage OVH. Le Standard 3-AZ (€0.014/Go) est le plus cher. Si toutes les données restent en Standard, les marges sur les tiers supérieurs sont quasi-nulles (~7% pour Fleet). Le tiering automatique (données froides → stockage moins cher) est essentiel pour la viabilité économique.

## Options considérées

1. **Pas de tiering** — Toutes les données en Standard 3-AZ. Marges ~7-50% selon le tier. Fleet quasi-deficitaire.
2. **Tiering manuel** — L'agent choisit le niveau de stockage par namespace. Complexité pour l'agent, friction.
3. **Tiering automatique** — Le système classe automatiquement les objets par fréquence d'accès. Comme AWS S3 Intelligent-Tiering, mais E2E.
4. **Tiering automatique + opt-in Glacier** — Tiering auto chaud/tiède/froid + Glacier uniquement si l'agent le demande explicitement.

## Décision

**Option 4 : Tiering automatique + opt-in Glacier.**

Classes de stockage OVH et transitions automatiques :
- **Chaud** (< 7 jours) → Standard 3-AZ (€0.014/Go) : données récentes, accès fréquent
- **Tiède** (7-30 jours) → Infrequent Access (€0.0095/Go) : accès occasionnel
- **Froid** (> 30 jours) → Active Archive (€0.0045/Go) : accès rare
- **Glacier** → Cold Archive (€0.0016644/Go) : archivage long terme, **opt-in agent uniquement**

Pourquoi Glacier est opt-in :
- Engagement minimum 180 jours (pénalité early recovery si accès avant)
- Récupération en 24-48h (pas d'accès immédiat)
- Le système ne décide PAS seul de mettre des données en Glacier — l'agent doit explicitement appeler `serac_archive` (V2)

## Conséquences

**Positives** :
- Marges Fleet de ~7% (sans tiering) à ~40% (avec tiering)
- Zéro friction pour l'agent — le système gère tout automatiquement
- E2E préservé — le tiering déplace des objets chiffrés, le contenu reste illisible
- Egress OVH gratuit = avantage vs AWS Intelligent-Tiering ($0.09/Go egress)

**Négatives** :
- Coût de transition entre classes (OVH facture les transitions)
- Monitoring nécessaire pour vérifier que le tiering fonctionne comme prévu
- Les données chaudes des nouveaux agents = marges initialement plus basses (45-55% vs 70% ciblé)
- Glacier lock-in 180 jours = risque si un agent veut récupérer ses données avant

## Références

- Détails : `architecture/pricing-model.md` (section Tiering), `architecture/mcp-server-spec.md` (section Tiering)
- Coûts OVH : Standard 3-AZ €0.014/Go, IA €0.0095/Go, AA €0.0045/Go, Glacier €0.0016644/Go