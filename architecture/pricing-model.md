# ADR-003 — Modèle de Pricing Serac Agents

**Date** : Mai 2026  
**Statut** : Draft  
**Prérequis** : ADR-001 (Encryption Protocol), ADR-002 (MCP Server Spec)

---

## 1. Coûts OVH réels (données source)

Données tarifaires OVH Cloud Object Storage, validées Mai 2026 :

| Classe de stockage | Prix HT/Go/mois | Egress | Durée min. | Cas d'usage |
|--------------------|------------------|--------|------------|-------------|
| Standard 3-AZ | €0.014 | **Gratuit** | Aucune | Données chaudes (< 7j) |
| Infrequent Access | €0.0095 | **Gratuit** | Aucune | Données tièdes (7-30j) |
| Active Archive | €0.0045 | **Gratuit** | Aucune | Données froides (> 30j) |
| Cold Archive (Glacier) | €0.0016644 | **Gratuit** | **180 jours** | Archivage long terme |

**Pénalité Glacier** : récupération avant 180j = `[24h × 180 - heures_stockage] × prix_heure_classe`

**Opérations** :
- PUT/POST : €0.0054/1000 requêtes (Standard), €0.0027/1000 (Infrequent), €0.00135/1000 (Active Archive)
- GET/HEAD : €0.00054/1000 requêtes (Standard), €0.00027/1000 (Infrequent), €0.000135/1000 (Active Archive)
- DELETE : Gratuit (toutes classes)

**Avantage egress** : OVH = gratuit. AWS S3 = $0.09/Go. Pour un agent qui store/récupère en boucle (cas d'usage typique), c'est un delta massif.

---

## 2. Architecture de tiering automatique

Le système classe automatiquement les objets en fonction de leur âge et pattern d'accès, sans intervention de l'agent. Équivalent AWS S3 Intelligent-Tiering, mais E2E.

### 2.1 Règles de transition

| Transition | Condition | Classe cible | Coût/Go/mois |
|------------|-----------|--------------|-------------|
| Chaud → Tiède | 7 jours sans accès | Infrequent Access | €0.0095 |
| Tiède → Froid | 30 jours sans accès | Active Archive | €0.0045 |
| Froid → Glacier | Opt-in agent ou namespace `archive:` | Cold Archive | €0.0017 |
| Glacier → Chaud | Accès déclenché | Standard 3-AZ | €0.014 (7j) |

**Remontée automatique** : tout accès à un objet froid/tiède le remonte en Chaud pour 7 jours, puis reclassement automatique.

### 2.2 Profil d'usage typique par type de données

| Type de données agent | Pattern d'accès | Distribution estimée | Coût pondéré/Go/mois |
|-----------------------|-----------------|---------------------|---------------------|
| Mémoire contextuelle (prefs, configs) | Très fréquent | 100% Chaud | €0.014 |
| Résultats de recherche, logs | Fréquent < 7j, puis rare | 30% Chaud, 70% Tiède | ~€0.012 |
| Datasets de training, snapshots | Écrit une fois, lu rarement | 10% Tiède, 90% Froid | ~€0.005 |
| Archives Glacier (trajectoires, backups) | Quasi jamais | 100% Glacier | €0.0017 |

### 2.3 Coût estimé pondéré par tier

Pour un namespace agent mixte (mémoire + logs + datasets + archives) :

| Poids estimé | Classe | Coût/Go/mois |
|-------------|--------|-------------|
| 15% | Standard (Chaud) | €0.014 |
| 35% | Infrequent Access (Tiède) | €0.0095 |
| 40% | Active Archive (Froid) | €0.0045 |
| 10% | Cold Archive (Glacier) | €0.0017 |

**Coût pondéré moyen** : 0.15×0.014 + 0.35×0.0095 + 0.40×0.0045 + 0.10×0.0017 ≈ **€0.0072/Go/mois**

C'est le coût cible pour le calcul de marge. En réalité, les agents récents auront plus de données chaudes (coût plus élevé) et les agents matures auront plus de données froides (coût plus bas). Le tiering lisse cette variation.

---

## 3. Grille de pricing agent

### 3.1 Tiers定价

| Tier | Stockage | Prix TTC/mois | Coût estimé (tiering) | Marge brute | Reads/jour | Writes/jour | Namespaces | Objets/namespace | Taille max/objet |
|------|----------|---------------|----------------------|-------------|-----------|------------|-----------|-------------------|----------------|
| **Free** | 5 Go | €0 | ~€0.07 | — | 1 000 | 500 | 1 | 1 000 | 1 Mo |
| **Starter** | 100 Go | €3.99 | ~€1.20 | ~70% | 10 000 | 5 000 | 5 | 50 000 | 50 Mo |
| **Pro** | 500 Go | €9.99 | ~€5.50 | ~45% | ∞ | ∞ | 20 | ∞ | 500 Mo |
| **Fleet** | 2 To | €29.99 | ~€18 | ~40% | ∞ | ∞ | 100 | ∞ | 5 Go |

> **Note sur les marges** : les coûts estimés utilisent le coût pondéré avec tiering automatique (mix chaud/tiède/froid/glacier). Les nouveaux agents auront des coûts plus élevés (données majoritairement chaudes) pendant les premiers mois. Les marges réelles convergent vers les chiffres ci-dessus après ~60 jours d'activité avec tiering actif.

### 3.2 Justification des marges

- **Free** : coût négligeable (~3 centimes/mois). Acquisition zero-friction. L'agent teste, valide, puis son owner upgrade.
- **Starter** : marge ~70% (cost weighted avec tiering). Cible agents individuels (mémoire, logs, datasets). Volume faible = surtout chaud les premiers mois, marge réelle 45-55% initialement, converge vers 70% après 60 jours.
- **Pro** : marge ~45%. Cible agents avancés (recherche, quant, ML). Volume élevé = plus de données froides = tiering efficace dès le départ. Marge réelle bonne rapidement.
- **Fleet** : marge ~40%. Cible entreprises avec flottes d'agents. Volume massif = tiering très efficace. Lock-in par compte + API volume + SLA payant en option.

**Note** : les marges incluent uniquement le stockage. Les coûts de compute (Fastify MCP server, Redis, PostgreSQL) sont facteurs fixes partagés entre tous les clients (~€50-100/mois pour l'infra complète). À 50 agents payants (mix Starter/Pro/Fleet), le revenu mensuel couvre 3-5× les coûts fixes.

### 3.3 Option Glacier (pay-as-you-go)

| Usage | Prix TTC |
|-------|---------|
| Stockage Glacier | €0.002/Go/mois |
| Récupération | €0.01/Go |
| Durée minimale | 180 jours |
| Temps de récupération | 24-48h |

Disponible à partir du tier Starter. Les agents peuvent explicitement archiver en Glacier via `serac_archive` (V2) ou configurer un namespace `archive:` qui auto-classe en Glacier.

### 3.4 Over-quota

Comportement progressif, aligné sur le RGPD (droit à la portabilité) :

1. **Jour 1-30** : écritures bloquées au-dessus du quota, lectures autorisées, rappels email/webhook
2. **Jour 31-60** : read-only complet (l'agent peut récupérer ses données)
3. **Jour 61+** : suppression après notification (30 jours de préavis email + webhook)

---

## 4. Modèle financier prévisionnel

### 4.1 Coûts fixes mensuels (infra)

| Composant | Coût/mois |
|-----------|-----------|
| VPS Serac (existant) | €0 (déjà payé pour cloud humain) |
| VPS MCP Server (nouveau) | ~€10-20 (1 vCPU, 2 Go RAM, Caddy) |
| OVH S3 stockage (variable) | Inclus dans le coût par Go |
| Redis (sessions, challenges) | ~€5 (managed) ou €0 (same VPS) |
| PostgreSQL (existant) | €0 (même instance que Serac humain) |
| Cloudflare Tunnel | €0 (free tier) |
| Domaines DNS | ~€5/an (négligeable) |
| **Total fixe** | **~€15-25/mois** |

### 4.2 Scénarios de revenus

| Scénario | Agents payants | Mix estimé | Revenu TTC/mois | Coût stockage/mois | Coût fixe/mois | **Résultat** |
|----------|---------------|-----------|-----------------|-------------------|----------------|-------------|
| Bootstrap | 10 | 5 Free + 3 Starter + 2 Pro | ~€44 | ~€10 | €20 | **€14** |
| Croissance | 50 | 10 Free + 20 Starter + 15 Pro + 5 Fleet | ~€350 | ~€75 | €20 | **€255** |
| Traction | 200 | 30 Free + 80 Starter + 70 Pro + 20 Fleet | ~€1 300 | ~€300 | €25 | **€975** |
| Scale | 500 | 50 Free + 200 Starter + 200 Pro + 50 Fleet | ~€3 350 | ~€900 | €30 | **€2 420** |

### 4.3 Break-even

**Break-even stockage + infra** : ~25-30 agents payants (mix Starter/Pro) couvrent les coûts fixes + stockage. Les marges étant plus faibles les premiers mois (données chaudes), le break-even arrive quand le tiering réduit les coûts de stockage (~60-90 jours après les premiers abonnements).

**Break-even incluant le temps dev** : à valoriser selon l'investissement. 6 semaines de dev solo (Phase 0+1+2) ≈ 250-300h. Au taux market d'un dev senior freelance (~€80/h), l'investissement est ~€20-24K. Break-even à ~200-300 agents payants, soit 3-6 mois post-launch.

---

## 5. Analyse concurrentielle pricing

| Service | 500 Go/mois | Egress | E2EE | Agent-native | RGPD |
|---------|------------|--------|------|--------------|------|
| **Serac Pro** | **€9.99** | **Gratuit** | **✅** | **✅** | **✅** |
| Proton Drive | ~€10 | 5 Go/mois | ✅ | ❌ | ✅ (CH) |
| AWS S3 | ~€14-20 | $0.09/Go | ❌ | ❌ | ❌ (US) |
| Datos Network | ~€8 (crypto) | Variable | ❌ | ❌ | ❌ |
| Backblaze B2 | ~€3 | Gratuit* | ❌ | ❌ | ❌ |
| Tresorit | ~€15 | Illimité | ✅ | ❌ | ✅ (CH) |
| Scaleway S3 | ~€6 | Variable | ❌ | ❌ | ✅ |

*Backblaze egress gratuit jusqu'à 3× le stockage, puis payant.

**Positionnement Serac** : pas le moins cher au Go, mais le seul à combiner E2EE + agent-native + RGPD FR + egress gratuit. Le prix inclut ce qui est payant ailleurs (egress, E2EE, compliance).

---

## 6. Stratégie de paiement

### 6.1 V1 — Stripe (fiat uniquement)

- **Stripe Checkout** pour les humains (CB, SEPA)
- **Stripe Billing** pour les agents (API, géré par l'owner humain)
- Webhooks Stripe pour événements de paiement (invoice.paid, subscription.canceled)
- Price IDs Stripe mappés aux tiers agent :
  - `price_starter` → €3.99/mois
  - `price_pro` → €9.99/mois
  - `price_fleet` → €29.99/mois
  - `price_free` → €0 (pas de Stripe subscription)

### 6.2 V2 — x402 USDC (agents autonomes)

- **Circle USDC API** pour paiements crypto
- Pas de browser redirect (pur REST, compatible agent)
- Gas fees négligeables (~$0.01 sur Polygon/Base)
- L'agent paie de son propre wallet, zero interaction humaine
- Circuit breaker : max €50/mois par agent en crypto

### 6.3 V2+ — Facture entreprise

- Pour les fleets > 5 agents
- Facturation mensuelle, paiement par virement SEPA
- Contrat annuel optionnel (SLA, support dédié)

---

## 7. Risques financiers et mitigations

| Risque | Probabilité | Impact | Mitigation |
|--------|------------|--------|------------|
| Agent Free utilisé comme proxy S3 gratuit | Haute | Moyen | Rate limiting strict (30 req/min, 1 Go max/objet) + surveillance adresse IP |
| Un agent consomme tout le quota en écritures | Moyen | Bas | Writes limités par tier + soft-delete 30j + suppression automatique |
| OVH augmente les prix (+5-10% sept 2026) | Haute | Faible | Marges confortables (52-82%), room pour absorber +10%. Pricing ajustable avec 30j préavis |
| Break-even plus long que prévu | Moyen | Moyen | Le cloud humain existe déjà (revenus existants). Les coûts additionnels sont ~€15-25/mois. Risque minimal |
| Concurrence prix (Backblaze B2 €3/500Go) | Faible | Faible | Serac ne joue pas sur le prix au Go, mais sur E2EE + agent-native + RGPD. Le client Backblaze n'est pas le client Serac |
| Assault crypto (x402 abuse, wallet drain) | Faible | Haut | Circuit breaker max €50/mois/agent + spending limits + alertes webhook + audit log |

---

## 8. Métriques de succès

### 8.1 Court terme (3 mois post-launch)

- 50+ agents enregistrés (mix Free + payants)
- 10+ agents Starter+ payants
- 5+ skills publiés (ClawHub, agentskills.io, Smithery)
- MCP server listé sur 3+ registres
- 1+ article/mention technique (HN, dev.to, blog Serac)
- WAU (Weekly Active Agents) > 30%

### 8.2 Moyen terme (6 mois)

- 500+ agents actifs
- 50+ payants
- €500+/mois ARR agent
- Marge brute > 60%
- Attestation Ed25519 utilisée en production (V2)
- 2+ entreprises EU en discussion

### 8.3 Long terme (12 mois)

- 2 000+ agents actifs
- 200+ payants
- €2 000+/mois ARR agent
- Certification HDS effective
- SDK Python publié (pip)
- Partenariats frameworks agents (Hermes, OpenClaw)
- Position "sovereign agent storage EU" établie

### 8.4 Métriques à tracker

| Métrique | Fréquence | Source |
|----------|-----------|--------|
| Agents enregistrés | Hebdo | `SELECT COUNT(*) FROM agent_vaults` |
| Agents actifs (≥1 req/sem) | Hebdo | `agent_audit_log` |
 WAU | Hebdo | Requêtes uniques/sem |
| Stockage moyen/agent | Hebdo | `agent_namespaces.storage_used_bytes` |
| Revenu TTC | Mensuel | Stripe Dashboard |
| Churn rate | Mensuel | Stripe + `agent_vaults.is_active` |
| Distribution tiering | Mensuel | S3 metrics (chaud/tiède/froid/glacier) |
| Marge brute | Mensuel | Calcul (revenu - coût OVH - coût fixe) |

---

*Document de référence pour le modèle de pricing Serac Agents.*  
*Kira — Mai 2026*