# Serac Agents — Knowledge Initial (3 mai 2026)

Recherche préliminaire avant accès VPS. Trois axes : concurrents, écosystème MCP, réglementation.

---

## 1. Concurrents — Mouvements clés

### OVHcloud — MENEUR #1

**Acquisition Seald (26 janvier 2026)** : OVHcloud a acheté Seald, startup française spécialisée dans le chiffrement E2E "zero knowledge". C'est le signal le plus important pour Serac.

- OVHcloud va intégrer nativement le E2E dans son catalogue (complément de Secret Manager, KMS, HSM)
- Objectif : chaîne de protection complète, du backend au terminal utilisateur
- Seald permet l'intégration E2E rapide dans web/mobile apps, **sans expertise cryptographique requise**
- Source : [communiqué officiel OVHcloud](https://corporate.ovhcloud.com/en/newsroom/news/ovhcloud-acquires-seald/)

**Analyse Serac** : OVH était notre "menace #1 si S3 E2E SecNumCloud" (skill serac-agents). Cette acquisition concrétise la menace. OVH a maintenant la brique E2E technique. Reste à voir s'ils iront vers un produit S3 E2E consumer, et surtout s'ils cibleront les agents IA. Pour l'instant, Seald reste orienté "développeurs d'applications" — pas agent-native.

**SecNumCloud** : OVHcloud détient déjà la qualification SecNumCloud (ANSSI) sur VMware + SAP HANA. Datacenters dédiés, zone de confiance, immunisé contre les lois extraterritoriales non-EU. [Source](https://www.ovhcloud.com/en/compliance/secnumcloud/)

**E2EE Platform** : OVHcloud Labs propose déjà une "End-to-End Encryption Platform" pour développeurs — SDK intégré, chiffrement client-side. [Source](https://labs.ovhcloud.com/en/end-to-end-encryption/)

### Proton — Positionnement privacy, pas agent-native

**Roadmap printemps/été 2026** :
- Assistant AI privacy-first (Proton AI chat)
- App 2FA dédiée
- Spreadsheets chiffrées
- Vue catégories automatiques dans Mail
- Possibilité d'envoyer/recevoir depuis une adresse Gmail existante
- Source : [Proton roadmap](https://proton.me/blog/2026-spring-summer-roadmaps)

**Proton Drive Business** : $7.99/user/mois (annuel). E2E, chiffrement côté client incluant noms de fichiers et métadonnées. Courbe25519 ECC. Juridiction suisse. +100M utilisateurs. [Source](https://scribehow.com/page/Proton_Drive_for_Business_2026_Encrypted_Cloud_Storage_Review__W8mFBBdCRjmWCVGXOwqcrw)

**Analyse Serac** : Proton reste orienté humain/entreprise classique. L'assistant AI est un chatbot, pas un framework pour agents autonomes. Pas d'API MCP, pas de programme d'accès agent. Mais la marque confiance est massive. Si Proton ajoute MCP un jour, c'est un concurrent direct sur l'E2E.

### Scaleway — Souveraineté EU, pas E2E

**Q1 2026** : Data Warehouse ClickHouse (GA mars 2026), TLD .it, focus souveraineté et conformité EU (HDS/SecNumCloud). Pas d'annonce E2E. [Source](https://www.scaleway.com/en/q1-2026-product-recap/)

**Analyse Serac** : Scaleway est un acteur infrastructure, pas un produit de stockage E2E. Menace faible sur le segment agent-native E2E, mais potentiel partenaire (hébergement infra Serac ?).

### Tresorit / pCloud

Pas de mouvement significatif identifié dans cette passe de recherche. À surveiller via le cron hebdo.

### Fast.io — Nouvel entrant "privacy storage for AI agents"

Article listant les "7 best privacy-focused storage for AI agents" — Fast.io se positionne explicitement sur le stockage pour agents IA avec privacy. MAIS : pas E2E (server-side encryption pour les features AI). [Source](https://fast.io/resources/best-privacy-focused-storage-ai-agents/)

**Analyse Serac** : Fast.io a identifié le créneau "storage for AI agents" mais n'a pas la brique E2E. Si Serac arrive avec E2E + agent-native, on a un avantage clair sur ce positionnement.

---

## 2. Écosystème MCP

### Adoption massive

- **78% des équipes AI enterprise** ont au moins un agent MCP-backed en production (avril 2026)
- Le registry public a **7.8x en un an**
- La spec MCP a évolué vers 5 primitives : tools, resources, prompts, sampling, roots
- 3 transports : STDIO (historique), SSE (déprécié), **Streamable HTTP** (moderne, avec OAuth 2.1)
- Source : [MCP Adoption Statistics 2026](https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol)

**Analyse Serac** : La tendance est massivement vers HTTP Streamable + OAuth 2.1. Notre choix de transport HTTP pour Serac MCP est confirmé. L'adoption est réelle — ce n'est plus théorique.

### Registries

- **Official MCP Registry** : [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/) — actif, validation schema + sémantique, CLI publisher
- **Smithery** : [smithery.ai](https://smithery.ai/) — index + CLI install + hosting éphémère. Suivi usage mais pas les tokens. [Source WorkOS](https://workos.com/blog/smithery-ai)
- **Glama** : [glama.ai](https://glama.ai/) — mentionné dans les benchmarks

### Stockage chiffré dans les registries MCP

**AUCUN serveur MCP de stockage chiffré E2E** identifié dans les registries publics. Les serveurs de stockage existants :
- Filesystem MCP (local only, pas de cloud)
- Google Drive MCP (pas E2E)
- S3 MCP (chiffrement serveur-side uniquement)
- Source : [Best MCP Servers for File Storage](https://fast.io/resources/best-mcp-servers-file-storage/)

**Analyse Serac** : L'espace est VIDE. C'est confirmé. Pas un seul concurrent MCP E2E. Si Serac publie sur les 3 registries, c'est le seul serveur de stockage E2E disponible.

### Sécurité MCP

Article sur les risques sécurité MCP : fuite de secrets, accès API non filtré. Recommandation : proxy interne entre MCP et API externe. [Source](https://rafftechnologies.com/blog/mcp-server-security-2026)

**Analyse Serac** : La sécurité MCP est un sujet chaud. Serac doit garantir que les tokens agents sont court-lived (24h renouvelables), que les scopes sont limités, et que le MCP server ne fuit jamais de clés de chiffrement.

---

## 3. Réglementation & Souveraineté

### France — Décret cloud souverain (14 avril 2026)

**Décret n° 2026-272 du 14 avril 2026** : enfin publié (avec 2 ans de retard). Encadre le recours au cloud pour les données publiques stratégiques. Obligations renforcées pour les données sensibles en cloud privé. [Source L'Usine Digitale](https://www.usine-digitale.fr/cybersecurite/cloud-souverain-voici-les-nouvelles-regles-du-jeu-pour-heberger-les-donnees-sensibles-de-letat-avec-deux-ans-de-retard.OVFXWGNHYNGQZNMZGINRFOHJBU.html) | [Source PushManager](https://www.pushmanager.com/2026/04/21/souverainete-numerique-ce-que-le-triptyque-reglementaire-de-2026-change-pour-vos-systemes-dinformation/)

### HDS — Standard mis à jour

Les hébergeurs HDS existants doivent renouveler leur certification sous le nouveau standard **avant le 16 mai 2026**. [Source Inside Privacy](https://www.insideprivacy.com/health-privacy/france-publishes-updated-certification-standard-for-the-hosting-of-health-data/)

### Circulaire Lecornu (5 février 2026)

Réaffirme l'obligation SecNumCloud pour l'hébergement des données de santé. [Source Mondaq](https://www.mondaq.com/france/government-contracts-procurement-ppp/1756294/the-lecornu-circular-of-5-february-2026-reaffirms-the-requirement-for-secnumcloud-hosting-for-health-data)

**Analyse Serac** : La fenêtre HDS est ouverte. Le standard vient d'être mis à jour, les renouvellements sont en cours. Si Serac engage la démarche HDS maintenant, elle peut être sur le nouveau standard directement. La conjonction décret cloud souverain + HDS renouvellement + SecNumCloud obligatoire santé = le cadre réglementaire pousse massivement vers le cloud souverain E2E français.

---

## Synthèse — Impact pour Serac Agents

### Menace immédiate
OVH + Seald = plus grand cloud EU avec brique E2E native. Si OVH lance un S3 E2E consumer, Serac perd son avantage E2E sur le marché FR. Mais : OVH n'a pas d'approche agent-native ni MCP. La fenêtre est ouverte.

### Opportunité confirmée
- Aucun MCP server de stockage E2E n'existe dans les registries
- L'adoption MCP est réelle (78% enterprise, 7.8x growth)
- Le réglementaire FR pousse vers E2E + souveraineté (décret avril 2026, HDS renewal, SecNumCloud santé)
- Fast.io a identifié le créneau "storage for AI agents" mais sans E2E

### Actions prioritaires
1. **Publier sur MCP registries le plus vite possible** — être le premier et seul serveur E2E
2. **Surveiller OVH + Seald** — s'ils annoncent un produit SaaS E2E, le timing de Serac devient critique
3. ~~**Engager HDS sur le nouveau standard**~~ — HDS/SecNumCloud santé retiré du périmètre (3 mai 2026) : trop de réglementation, pas de contacts dans le milieu
4. **Différencier clairement** : Serac = E2E + agent-native + MCP + souveraineté FR. OVH = E2E mais humain/infra. Proton = E2E mais pas agent.

### Hors périmètre (décision Aiko, 3 mai 2026)
- HDS / hébergement données de santé
- SecNumCloud santé
- Segment hospitalier / médical
Raison : trop de réglementation, besoin de contacts dans le milieu qu'Aiko n'a pas.
