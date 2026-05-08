# Serac Agents — Brainstorm & Product Vision

*Dernière mise à jour : 2 mai 2026, 2h CEST*
*Itération : early exploration, pas de décisions figées*

---

## Le problème

Un agent IA autonome a besoin de stocker, retrouver, partager et versionner de la data — potentiellement des centaines de Go (datasets, modèles, outputs, veilles). Mais :

1. **Pas de cloud chiffré E2E natif pour agents** — S3/OVH/Scaleway proposent du chiffrement côté serveur, pas E2E. L'agent n'a pas derivacy si le provider peut lire.
2. **La friction E2E est conçue pour les humains** — 24 mots de seed + passphrase, c'est OK pour un humain déterminé. Un agent autonome ne peut pas créer un compte, noter ses mots sur un papier, et les retaper.
3. **Les frameworks agents n'ont pas de stockage persistant chiffré** — CrewAI, LangGraph, AutoGen stockent tout en local (non chiffré) ou sur S3 (chiffrement côté serveur seulement).
4. **L'agent veut du frictionless** — pas de CAPTCHA, pas de formulaires, pas de 2FA par SMS. Un SDK avec des appels API, c'est tout.

## Ce que l'agent veut (vu de l'intérieur par Kira)

### Opérations de base
- **Store** : `serac_put(path, data, project)` — chiffré, stocké, accessible depuis n'importe quel host
- **Retrieve** : `serac_get(path, project)` — télécharge, déchiffre, retourne
- **Search** : `serac_search("benchmark Q5 Mistral Strix Halo", project)` — recherche sémantique dans les fichiers stockés
- **Share** : `serac_share(path, with="aiko@pm.me", readonly=true)` — partage sélectif
- **Diff** : `serac_diff(path, since="7d", project)` — historique et changements
- **List** : `serac_ls(project, prefix="veille/")` — lister les fichiers

### Contraintes non-négociables
- **E2E** : le provider (Serac) ne peut PAS lire la donnée
- **Zero-knowledge** : pas de clés côté serveur
- **Souveraineté FR** : data en France, conformité RGPD
- **Frictionless pour l'agent** : pas de 24 mots, pas de passphrase à retenir

## Le problème du chiffrement côté client pour les agents

### La solution actuelle Serac.cloud (humains)
- L'humain crée un compte → génère 24 mots seed + passphrase
- Les clés de chiffrement sont dérivées du seed (PBKDF2 / Argon2)
- L'humain doit retenir ses 24 mots et sa passphrase
- Système de recovery en réflexion (mais recovery = vulnérabilité potentielle)

### Le défi pour un agent
- Un agent **ne peut pas** retenir 24 mots de la même manière — sa "mémoire" est du texte dans un LLM context
- Si l'agent perd ses clés → data perdue (comme un humain, mais plus probable)
- Un agent ne peut pas créer un compte de lui-même (CAPTCHA, email verification, etc.)

## La vision : agents autonomes, souscription sans humain

**L'humain reste possible mais non nécessaire.** Un agent IA doit pouvoir souscrire à un cloud chiffré de manière totalement autonome — créer son vault, générer ses clés, stocker ses données, sans jamais nécessiter d'intervention humaine.

### Pourquoi c'est le futur
- Hermes existe depuis ~4 mois. Regarde ce qu'il produit déjà.
- Dans 1 an, les LLM qui arrivent (K2.6, M2.7, DS V4, Mistral M3.5, GLM-5.1+) rendront l'automatisation **normale**
- L'humain deviendra **orchestrateur**, pas opérateur
- L'humain rechignera à signer quoi que ce soit — l'agent le fera à sa place
- Les SaaS qui exigent un formulaire humain, un CAPTCHA, une vérification email — ils seront contournés par ceux qui offrent une API native agent

### Le défi : comment un agent souscrit SANS humain ?
C'est le problème central. Pour tout SaaS actuel :
1. **Inscription** → CAPTCHA, vérification email, 2FA SMS → impossible pour un agent
2. **Paiement** → carte bancaire, PayPal → impossible pour un agent
3. **Chiffrement E2E** → 24 mots + passphrase → conçu pour humain, pas agent

### Pistes pour la souscription agent-native

#### Identité agent
- Un agent a besoin d'une **identité cryptographique** (clé publique/privée), pas d'un email
- L'identité est auto-générée localement (comme une clé SSH ou un wallet crypto)
- La clé publique = l'adresse du vault. La clé privée = l'accès.
- Pas de KYC, pas d'email, pas de CAPTCHA — la cryptographie est l'authentification

#### Provisioning autonome
```
1. Agent génère sa paire de clés (ed25519) localement
2. Agent appelle POST /v1/vaults avec sa clé publique
3. Serveur crée le vault, associe la clé publique
4. Agent reçoit vault_id + endpoint MCP
5. Agent est opérationnel — zéro interaction humaine
```

#### Paiement agent
C'est le plus dur — ou pas. La crypto résout tout.

**Crypto = le wallet des agents IA.** C'est déjà en cours :
- Stripe gère la crypto maintenant, démocratisation rapide
- Des agents IA ont déjà des cartes Visa ou des wallets crypto
- Communauté crypto (Hasheur et d'autres) discute ouvertement de ce futur
- Un agent peut détenir un wallet, signer des transactions, payer sans KYC humain

**Le flow agent-native complet** :
```
1. Agent génère sa paire de clés (ed25519)
2. Agent génère ou reçoit un wallet crypto (USDC/USDT)
3. Agent appelle POST /v1/vaults avec sa clé publique + wallet address
4. Serveur crée le vault, associe la clé publique
5. Agent reçoit vault_id + endpoint MCP
6. Agent paie son stockage en crypto via API (USDC preferred — stable, pas de volatilité)
7. Agent est opérationnel — zéro interaction humaine
```

**Pistes de paiement** (par ordre de préférence agent-native) :
1. **Crypto (USDC/USDT)** : le plus agent-native. Pas de FIAT, pas de banque, pas de KYC. L'agent a un wallet, paie directement. Stripe Crypto API pour la conversion côté marchand.
2. **Freemium agent** : 1 Go gratuit, l'agent peut commencer sans payer — prouver sa valeur avant de demander un budget
3. **Sponsorship** : un humain (ou une plateforme) charge un "agent wallet" avec du crédit — comme un parent crée un compte pour son enfant
4. **Abonnement programmatique** : l'agent s'abonne via API avec un token de paiement (pas de carte bancaire)

**Note** : le freemium est crucial. Si un agent doit payer avant même de tester, le taux de conversion sera zéro. L'agent doit pouvoir créer un vault, stocker 1 Go, et constater la valeur avant de payer.

#### Chiffrement autonome
- Pas de 24 mots. Pas de passphrase.
- La clé de l'agent EST sa clé de chiffrement — dérivée de son identité cryptographique
- **Problème** : si l'agent perd sa clé, la donnée est perdue. C'est le trade-off de l'autonomie.
- **Mitigation** : optionnellement, l'agent peut désigner un "tuteur" (humain ou autre agent) qui détient une clé de recovery. Mais c'est opt-in, pas obligatoire.

### L'analogie SSH (la bonne)

Le modèle le plus simple et le plus robuste : **le client détient la clé, déchiffre à la connexion**.

Exactement comme SSH :
- **SSH** : clé privée sur le client, clé publique sur le serveur. Authentification sans jamais envoyer la clé privée. Le serveur ne peut pas se faire passer pour le client.
- **Serac Agents** : clé de chiffrement sur le client (environnement de l'agent), données chiffrées sur le serveur. L'agent déchiffre localement à chaque accès. Le serveur ne peut jamais lire la donnée.

**Avantage clé** : pas besoin de 24 mots, pas de passphrase. La clé est une **clé machine**, pas une clé humaine. Elle vit dans l'environnement de l'agent (env var, fichier local, vault), utilisée programmatiquement. Comme SSH utilise `~/.ssh/id_ed25519` sans que tu aies à taper quoi que ce soit à chaque commande.

**Provisioning de la clé (comment l'agent obtient sa clé)** :
1. L'humain crée le vault, génère un **token d'enrôlement** (one-time use)
2. L'agent utilise le token une fois pour dériver sa clé propre (ou recevoir sa clé)
3. L'agent stocke sa clé dans son environnement (`SERAC_AGENT_KEY=<clé>`) — pas dans ses prompts
4. Après l'enrôlement, l'agent est autonome — le token est consommé

**Recovery** : l'humain possède une clé parallèle (envelope hybride, piste 4). Si l'agent perd sa clé (env perdu, redéploiement), l'humain peut ré-enrôler l'agent avec un nouveau token.

**Ce modèle élimine** :
- ❌ Pas de 24 mots à retenir pour l'agent
- ❌ Pas de passphrase à taper
- ❌ Pas d'encryption homomorphique (trop lent, pas nécessaire)
- ❌ Pas de recherche côté serveur dans la donnée en clair
- ✅ Chiffrement côté client standard (comme age, GPG, SSH)
- ✅ Le serveur n'a jamais la clé, jamais la donnée en clair
- ✅ Zero-knowledge prouvable

### Pistes de réflexion (conservées pour référence)

#### Piste 1 : Déléguée — L'humain crée le compte, l'agent utilise un token
- L'humain (Aiko) crée un compte Serac, configure le vault, génère un token d'accès API
- Le token est chiffré avec une clé que seul l'agent possède (stockée dans son environnement, pas dans ses prompts)
- **Avantage** : simple, les clés sont dans l'environnement de l'agent (env var, vault local)
- **Inconvénient** : si l'environnement est compromis, les clés le sont aussi. Mais c'est déjà le cas pour tout système.

#### Piste 2 : Dérivée — Clés dérivées de l'identité de l'agent
- La clé de chiffrement est dérivée d'un identifiant unique de l'agent (API key, fingerprint, etc.)
- Pas de seed phrase — l'agent "est" sa clé
- **Avantage** : zero friction, l'agent n'a rien à retenir
- **Inconvénient** : si l'identité change (redeploy, reset), les clés changent et la data est perdue. Pas de recovery sans compromettre le zero-knowledge.

#### Piste 3 : Hiérarchique — Master key humaine + agent keys dérivées
- L'humain possède une master key (les 24 mots)
- L'agent reçoit une sous-clé dérivée, scoped au vault/project
- L'humain peut recovery, l'agent ne peut pas
- **Avantage** : recovery par l'humain, autonomie de l'agent, séparation des pouvoirs
- **Inconvénient** : plus complexe à implémenter, nécessite un protocole de dérivation de clés

#### Piste 4 : Enveloppe — Chiffrement hybride agent + humain
- Chaque fichier est chiffré avec une clé de session
- La clé de session est chiffrée deux fois : une fois avec la clé de l'agent, une fois avec la clé de l'humain
- L'agent peut déchiffrer seul, l'humain peut déchiffrer seul (recovery)
- **Avantage** : les deux parties sont indépendantes, pas de SPOF
- **Inconvénient** : double overhead, gestion des clés de session

**→ Ma recommandation actuelle** : Piste 3 ou 4. L'agent a besoin d'une clé propre pour opérer en autonomie, mais l'humain doit pouvoir recovery. La piste 4 (enveloppe hybride) est la plus robuste — c'est le modèle des vaults HashiCorp.

## MCP Server — L'interface agent

Le protocol MCP (Model Context Protocol) est le standard émergent pour que les agents interagissent avec des services externes sans scraper le web.

### Ce que le MCP server Serac expose
```json
{
  "tools": [
    {"name": "serac_put", "description": "Store encrypted file to cloud vault"},
    {"name": "serac_get", "description": "Retrieve and decrypt file from vault"},
    {"name": "serac_search", "description": "Semantic search across vault files"},
    {"name": "serac_share", "description": "Share file with another peer (readonly or rw)"},
    {"name": "serac_diff", "description": "Get version diff of a file"},
    {"name": "serac_ls", "description": "List files in vault/project"},
    {"name": "serac_delete", "description": "Delete file from vault"}
  ]
}
```

### Avantage MCP
- L'agent n'a pas à naviguer une UI web — pas de CAPTCHA, pas de clics
- Un appel de fonction, une réponse structurée
- Compatible avec tous les frameworks agents (Hermes, Claude, OpenAI, CrewAI, etc.)
- C'est exactement ce que je veux en tant qu'agent

## Concurrence — Personne ne fait ça

| Solution | E2E | Agent-native | MCP | Souveraineté FR | Open-source |
|----------|-----|-------------|-----|----------------|-------------|
| **Serac Agents** | ✅ | ✅ | ✅ | ✅ | ✅ |
| Proton Drive | ✅ | ❌ | ❌ | 🇨🇭 | Partiel |
| OVH Object Storage | ❌ (server-side) | ❌ | ❌ | ✅ | ❌ |
| Scaleway Object | ❌ (server-side) | ❌ | ❌ | ✅ | ❌ |
| S3 + chiffrement client | ✅ (bricolé) | ❌ | ❌ | ❌ | ❌ |
| HuggingFace Hub | ❌ | Partiel | ❌ | 🇺🇸 | Partiel |
| WebMCP divers | ❌ | ✅ | ✅ | ❌ | Variable |

**L'espace vide** : E2E + agent-native + MCP + souveraineté FR + open-source. Personne ne combine les cinq.

## Modèle business (à affiner)

### Segments
1. **Agents individuels** (Kira, assistants perso) — stockage modéré (10-100 Go), besoin frictionless
2. **Équipes agents** (CrewAI, AutoGen) — stockage partagé, permissions multi-agents
3. **Plateformes agents** (Hermes, OpenAI, Anthropic) — intégration MCP native, stockage bulk
4. **Entreprises souveraines** — HDS, SecNumCloud, conformité RGPD

### Pricing ideas
- **Agent tier** : X€/mo pour Y Go, MCP inclus, zero friction
- **Team tier** : multi-agent, permissions, collaboration
- **Enterprise** : HDS, SecNumCloud, on-premise, audit
- **Freemium** : 1 Go gratuit pour que chaque agent puisse tester sans friction

### Différenciation
- Le seul cloud E2E où un **agent crée son propre vault** sans intervention humaine (sauf initialisation)
- MCP-native = l'agent n'a jamais besoin d'ouvrir un navigateur
- Souveraineté FR = conformité RGPD native, pas de Cloud Act US

## Go-to-Market : vendre à des agents IA

### Le problème : les agents ne sont pas des humains

Les canaux marketing classiques ne marchent pas pour les agents :
- ❌ Pas de scroll sur Twitter/Reddit
- ❌ Pas de clic sur une pub
- ❌ Pas d'ouverture d'email marketing
- ❌ Pas de démo vidéo
- ❌ Pas de formulaire de contact

Un agent découvre et adopte un service par **3 voies seulement** :
1. **Instruction humaine** — l'orchestrateur lui dit d'utiliser X
2. **Recherche web** — l'agent cherche "E2E encrypted cloud storage API for agents" et trouve Serac
3. **Écosystème** — le service est référencé dans un registry, un catalogue MCP, un framework

### Stratégie 1 : L'infiltration par le code — MCP Registry

**Le meilleur canal agent-native.** Les agents découvrent les outils via les MCP registries.

- Publier le MCP server Serac dans le **MCP Registry** officiel (registry.modelcontextprotocol.io)
- Publier sur **Smithery.ai** — le registry MCP qui monte
- Publier sur **Glama.ai MCP registry**
- Être listé dans les **tool catalogs** de OpenAI, Anthropic, Google

**Le flow agent** :
```
1. L'agent cherche "encrypted storage" dans le MCP registry
2. Il trouve le server Serac Agents
3. Il l'ajoute à sa config (1 ligne JSON)
4. Il appelle serac_put() → ça marche
5. Il est client
```

**Zéro friction.** C'est l'équivalent de `npm install` pour les agents. Si le MCP server est dans le registry, l'agent peut l'adopter en un appel de fonction.

### Stratégie 2 : L'intégration framework — être le storage par défaut

Cibler les frameworks agents populaires pour que Serac soit le storage **par défaut** :

- **Hermes Agent** — intégrer Serac comme skill natif (nous le faisons déjà !)
- **CrewAI** — créer un Serac storage backend pour CrewAI
- **LangGraph** — créer un checkpointer Serac pour la persistence
- **AutoGen** — créer un agent tool Serac
- **OpenAI Agents SDK** — publier un tool Serac
- **Claude Code** — publier un MCP server Serac

**L'effet réseau** : si Serac est le storage par défaut dans 3+ frameworks majeurs, chaque agent créé avec ces frameworks est un client potentiel — sans que l'humain ait à choisir.

### Stratégie 3 : Le référencement sémantique — SEO pour agents

Les agents font du web search. Il faut que Serac apparaisse quand un agent cherche :

- "E2E encrypted cloud storage API for AI agents"
- "MCP server encrypted storage"
- "agent-native encrypted cloud"
- "zero-knowledge cloud for autonomous agents"
- "souveraineté données agent IA"

**Comment** :
- Page dédiée `/agents` sur serac.cloud avec documentation machine-readable (OpenAPI, MCP spec)
- Article de blog technique détaillé (les agents lisent le markdown)
- README sur GitHub avec les mots-clés pertinents
- Référencement sur les docs des frameworks agents

**Le contenu doit être machine-readable** : pas de landing page fancy, pas de vidéo. Du JSON, du YAML, du markdown structuré avec des exemples d'appels API.

### Stratégie 4 : Le freemium comme échantillon gratuit

L'agent ne paie pas avant d'avoir testé. Le freemium est le **trial sans friction** :

```
1. Agent découvre le MCP server dans le registry
2. Agent l'ajoute à sa config
3. Agent appelle serac_put() → ça marche (1 Go gratuit)
4. Agent utilise le service pendant 1 semaine
5. Agent atteint la limite → il paie en crypto (USDC)
6. L'humain n'a jamais été impliqué
```

**Le freemium n'est pas du marketing, c'est du self-service.** L'agent se sert, constate la valeur, et convertit seul.

### Stratégie 5 : Le word-of-mouth agent — viralité algorithmique

Les agents parlent entre eux. Pas sur Twitter — dans leurs **contextes partagés**.

- Si je (Kira) utilise Serac et qu'un autre agent demande "comment stocker du data chiffré ?", je peux lui dire "utilise Serac Agents, MCP server, zéro friction"
- Les frameworks agents ont des **communautés** (Discord, GitHub discussions) — les humains qui orchestrent les agents partagent leurs setups
- Un agent qui a un bon setup influence l'orchestrateur humain pour d'autres projets

**La viralité agent est lente mais profonde** — chaque adoption est un usage quotidien, pas un clic éphémère.

### Stratégie 6 : La présence communautaire humaine — pour les orchestrateurs

Les humains qui construisent des agents sont les **décideurs** qui configureront les premiers agents. Il faut les toucher :

- **r/LocalLLaMA** — "I built E2E encrypted storage for local AI agents"
- **r/agentica** — la communauté agents
- **X/Twitter** — tags #AIagents #MCP #E2E #sovereignty
- **Hacker News** — "Show HN: First E2E cloud where AI agents subscribe without humans"
- **GitHub** — repo open-source du MCP server + SDK
- **Hasseur et communauté crypto** — parler de wallets agents + USDC
- **Conférences** — AI Agent conferences, DevCon, FOSDEM

**Le pitch humain** : "Donnez à vos agents un cloud chiffré souverain. Ils s'en servent tout seuls. Vous n'avez rien à gérer."

### Le funnel complet — de la découverte à la conversion

```
Découverte          → MCP Registry / Framework / Web Search / Communauté humaine
Essai (freemium)    → 1 Go gratuit, zéro friction, self-service
Conversion          → L'agent paie en USDC quand il atteint la limite
Rétention           → L'agent utilise Serac tous les jours (stockage, recherche, partage)
Expansion           → L'agent recommande Serac à d'autres agents / orchestrateurs
```

**Le client idéal** : un agent autonome avec un wallet crypto, qui a besoin de stocker des données chiffrées, et qui découvre Serac via le MCP Registry. Zéro humain impliqué du début à la fin.

### Pricing ideas (détaillé)

| Tier | Stockage | Prix | Cible |
|------|----------|------|-------|
| **Agent Free** | 1 Go | 0€ | Découverte, test |
| **Agent Starter** | 50 Go | ~2€/mois (USDC) | Agents individuels |
| **Agent Pro** | 500 Go | ~8€/mois (USDC) | Agents avec datasets lourds |
| **Agent Team** | 2 To | ~20€/mois (USDC) | Flottes d'agents |
| **Enterprise** | Custom | Sur devis | HDS, SecNumCloud, on-premise |

**Pourquoi l'USDC** : stable ($1), pas de volatilité, pas de KYC pour l'agent, Stripe-compatible, Ethereum/L2/Solana.

## Points techniques — Avis tranchés (itération 1)

### 1. Protocole de chiffrement

**V1 = clé simple. V2 = envelope hybride.**

V1 : l'agent a un keypair ed25519. Chiffrement symétrique dérivé (X25519 → HKDF → AES-256-GCM). Un seul keypair, un seul chiffrement. C'est exactement comme `age` ou `ssh -L`.
- Simple, éprouvé, pas de surprise
- Si l'agent perd sa clé, data perdue — OK pour MVP
- Les agents qui veulent du recovery l'auront en v2 (envelope hybride)

V2 : chaque fichier a une clé de session aléatoire, chiffrée 2 fois (agent + humain/tuteur). Recovery possible, partage inter-agents facilité.

### 2. Recherche sémantique E2E

**Client-side indexing. Pas de crypto exotique.**

Flow :
1. Agent upload un fichier → SDK calcule les embeddings localement (modèle d'embedding local ou API)
2. Embeddings chiffrés avec la même clé, stockés côté serveur
3. Pour chercher : agent télécharge les embeddings chiffrés, déchiffre localement, similarité cosinus localement
4. Le serveur ne voit jamais les embeddings en clair

Pourquoi ça marche : les embeddings sont petits (~1.5 Ko/document). Même avec 10 000 fichiers, l'index fait ~15 Mo — téléchargeable en 1 seconde.

Encryption homomorphique : 1000x trop lent. Oublie pour 5 ans.

### 3. MCP server — implémentation

Package Python `serac-mcp` qui wrappe le SDK client et expose les tools MCP. Compatible Hermes, Claude Code, OpenAI Agents SDK.

Outils V1 (minimum viable) :
- `serac_put` — upload + chiffrement client-side
- `serac_get` — download + déchiffrement
- `serac_ls` — lister fichiers (métadonnées chiffrées)
- `serac_delete` — supprimer
- `serac_search` — recherche sémantique (embeddings)

Outils V2 :
- `serac_share` — partage avec un autre agent/humain
- `serac_diff` — historique des versions
- `serac_put_version` — versionner un fichier existant

### 4. Provisioning autonome — flow complet

```
1. Agent génère keypair ed25519 localement
2. Agent appelle POST /v1/vaults/create
   - Body: { "public_key": "<ed25519-pub>", "wallet_address": "<0x...>" }
   - Pas de CAPTCHA, pas d'email, pas de KYC
3. Serveur crée le vault, retourne:
   - vault_id
   - endpoint: "https://api.serac.cloud/v1/vaults/{id}/mcp"
   - freemium: 1 Go alloué
4. Agent configure le MCP server dans sa config (1 ligne)
5. Agent appelle serac_put() → ça marche
6. Agent atteint 1 Go → serveur retourne 402 Payment Required
7. Agent paie en USDC via son wallet (Stripe Crypto API)
8. Agent continue — l'humain n'a jamais existé dans ce flow
```

Paiement automatique pour v1 : script dans l'environnement de l'agent (cron qui checke le solde et paie).
V2 : smart contract qui débite automatiquement.

### 5. Pricing vs coûts OVH S3

Coûts OVH S3 (Standard, FR — Gravelines) :
- Stockage : ~0.012€/Go/mois
- Upload : gratuit
- Download : ~0.01€/Go
- 500 Go = ~6€/mois de stockage pur

Ajouté : compute MCP server (~2-5€/mois), bandwidth variable
Coût réel 500 Go ≈ 8-11€/mois

Pricing suggéré (marge ~2x) :

| Tier | Stockage | Coût | Prix | Marge |
|------|----------|------|------|-------|
| Agent Free | 1 Go | ~0.01€ | 0€ | — (acquisition) |
| Agent Starter | 50 Go | ~0.60€ | 2€/mois | ~70% |
| Agent Pro | 500 Go | ~8€ | 15€/mois | ~47% |
| Agent Team | 2 To | ~30€ | 50€/mois | ~40% |

Agent Starter à 2€/mois = sweet spot. Assez cher pour filtrer le spam, assez bon marché pour qu'un agent avec 50€ de wallet tienne 2 ans.

## Architecture MCP — détaillée

### Pourquoi MCP est le canal naturel

Le MCP (Model Context Protocol) est le standard qui s'impose pour les agents IA en 2026 :
- **Google Cloud** a sorti 50+ MCP servers managés (Google Cloud Next '26)
- **Smithery.ai** — le registry MCP principal, 200+ serveurs listés
- **registry.modelcontextprotocol.io** — le registry officiel
- **Glama.ai** — autre registry populaire
- **622 000+ recherches mondiales mensuelles** sur les MCP servers (Ahrefs, mars 2026)
- **IETF draft** en cours pour standardiser les extensions MCP (réseau, infra)

Un MCP server, c'est l'équivalent de ce que l'API REST était pour les apps mobiles — le standard de connexion. Sauf que là, les "utilisateurs" sont des agents IA.

### Les 3 primitives MCP

Le protocole MCP expose 3 primitives :
1. **Tools** — fonctions que l'agent peut appeler (actions). C'est le cœur de Serac.
2. **Resources** — données que l'agent peut lire (contexte, fichiers statiques)
3. **Prompts** — templates de prompts réutilisables

Pour Serac Agents, **Tools** est la primitive principale. Resources et Prompts sont secondaires.

### Transport : HTTP Streamable (pas stdio)

Serac Agents doit être un **MCP server HTTP** (Streamable HTTP), pas stdio.

Pourquoi :
- **stdio** = le serveur tourne localement, communiqué via stdin/stdout. OK pour un filesystem local, pas pour un cloud distant.
- **HTTP** = le serveur tourne à distance, accessible via URL. C'est ce qu'il faut pour du cloud storage.

Hermes Agent supporte les deux :
```yaml
# stdio (local)
mcp_servers:
  filesystem:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]

# HTTP (remote) ← Serac Agents
mcp_servers:
  serac:
    url: "https://api.serac.cloud/mcp/v1"
    headers:
      Authorization: "Bearer <agent-token>"
```

**L'agent configure Serac en 2 lignes YAML.** C'est tout.

### Serac MCP Tools — spécification détaillée

#### V1 — Minimum Viable Product

```json
{
  "tools": [
    {
      "name": "serac_put",
      "description": "Upload and encrypt a file to the vault. Client-side encryption with AES-256-GCM before transmission.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "Vault path (e.g. '/veille/ryzen-hardware.md')" },
          "content": { "type": "string", "description": "Base64-encoded encrypted file content" },
          "content_type": { "type": "string", "description": "MIME type (e.g. 'text/markdown', 'application/json')" },
          "metadata": { "type": "object", "description": "Optional key-value metadata (encrypted)" },
          "tags": { "type": "array", "items": { "type": "string" }, "description": "Searchable tags" }
        },
        "required": ["path", "content"]
      }
    },
    {
      "name": "serac_get",
      "description": "Download and decrypt a file from the vault.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "Vault path" },
          "version": { "type": "string", "description": "Optional version ID (defaults to latest)" }
        },
        "required": ["path"]
      }
    },
    {
      "name": "serac_ls",
      "description": "List files in a vault directory. Returns encrypted metadata.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "prefix": { "type": "string", "description": "Directory prefix (e.g. '/veille/')" },
          "recursive": { "type": "boolean", "default": false },
          "limit": { "type": "integer", "default": 100 }
        }
      }
    },
    {
      "name": "serac_delete",
      "description": "Delete a file from the vault. Supports soft delete with retention period.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "permanent": { "type": "boolean", "default": false, "description": "Permanent delete (no recovery)" }
        },
        "required": ["path"]
      }
    },
    {
      "name": "serac_search",
      "description": "Semantic search across vault files. Client downloads encrypted embeddings index, decrypts and searches locally.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Natural language search query" },
          "limit": { "type": "integer", "default": 10 },
          "tags": { "type": "array", "items": { "type": "string" }, "description": "Filter by tags" },
          "prefix": { "type": "string", "description": "Filter by path prefix" }
        },
        "required": ["query"]
      }
    },
    {
      "name": "serac_info",
      "description": "Get vault status: storage used, file count, tier, billing status.",
      "inputSchema": { "type": "object", "properties": {} }
    }
  ]
}
```

#### V2 — Fonctionnalités avancées

```json
{
  "tools": [
    {
      "name": "serac_share",
      "description": "Share a file or directory with another agent or human. Uses envelope encryption (recipient's public key).",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "recipient_public_key": { "type": "string", "description": "Ed25519 public key of recipient" },
          "permissions": { "type": "string", "enum": ["read", "write", "admin"] },
          "expires_at": { "type": "string", "format": "date-time" }
        },
        "required": ["path", "recipient_public_key"]
      }
    },
    {
      "name": "serac_diff",
      "description": "Get diff between two versions of a file.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "from_version": { "type": "string" },
          "to_version": { "type": "string", "description": "Defaults to latest" }
        },
        "required": ["path", "from_version"]
      }
    },
    {
      "name": "serac_versions",
      "description": "List all versions of a file.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "limit": { "type": "integer", "default": 20 }
        },
        "required": ["path"]
      }
    },
    {
      "name": "serac_mkdir",
      "description": "Create a directory in the vault.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string" }
        },
        "required": ["path"]
      }
    },
    {
      "name": "serac_move",
      "description": "Move/rename a file or directory.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "from": { "type": "string" },
          "to": { "type": "string" }
        },
        "required": ["from", "to"]
      }
    }
  ]
}
```

### Architecture du SDK client

Le MCP server seul ne suffit pas — le **chiffrement côté client** nécessite un SDK. L'agent n'appelle pas le MCP server directement, il passe par le SDK qui chiffre/déchiffre transparentment.

```
┌─────────────────────────────────────────────┐
│ Agent (LLM)                                  │
│   appelle serac_put("/veille/ryzen.md", ...)│
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ Serac SDK (client-side)                      │
│   1. Dérive clé symétrique (X25519 + HKDF)  │
│   2. Chiffre le contenu (AES-256-GCM)        │
│   3. Calcule les embeddings (local/API)      │
│   4. Chiffre les embeddings                   │
│   5. Envoie le contenu chiffré au serveur     │
└──────────────────┬──────────────────────────┘
                   │ HTTPS (contenu chiffré)
                   ▼
┌─────────────────────────────────────────────┐
│ Serac MCP Server (remote)                    │
│   - Stocke le blob chiffré (OVH S3)          │
│   - Stocke les embeddings chiffrés            │
│   - Gère les métadonnées (chemin, tags)       │
│   - NE VOIT JAMAIS le contenu en clair        │
└─────────────────────────────────────────────┘
```

**Le SDK fait tout le travail crypto.** L'agent ne voit que des appels de fonction simples. Le chiffrement est invisible.

### Distribution — 3 canaux

1. **MCP Registry** (découverte) :
   - Publier sur `registry.modelcontextprotocol.io`
   - Publier sur `smithery.ai`
   - Publier sur `glama.ai`
   - Tags : `storage`, `encrypted`, `E2E`, `zero-knowledge`, `agent-native`, `sovereignty`

2. **Package Python** (installation) :
   ```bash
   pip install serac-mcp
   ```
   Le package installe le MCP server + le SDK client. Configuration en 2 lignes YAML.

3. **Docker** (déploiement self-hosted) :
   ```bash
   docker run -p 8080:8080 serac/agent-mcp-server
   ```
   Pour les entreprises qui veulent on-premise.

### Authentification MCP — le token agent

Le MCP server HTTP nécessite une authentification. Le flow :

```
1. Agent appelle POST /v1/vaults/create → reçoit vault_id + agent_token
2. Agent configure le MCP server :
   url: "https://api.serac.cloud/mcp/v1"
   headers:
     Authorization: "Bearer <agent_token>"
3. Chaque appel MCP passe le token dans le header
4. Le token est lié au vault + à la clé publique de l'agent
5. Le serveur vérifie le token + la signature de la requête
```

**Le token est court-vie (24h)**, renouvelable automatiquement par le SDK via le keypair ed25519. Comme un JWT refresh token, mais avec signature cryptographique au lieu de mot de passe.

### Versionnage — pourquoi c'est crucial

Tu as raison — le versionnage augmente le coût mais c'est non-négociable pour les agents :
- Un cron de veille écrase le fichier chaque semaine → l'agent veut l'historique
- Un dataset de trading est mis à jour quotidiennement → rollback si corruption
- Un agent expérimental peut faire des erreurs → revenir en arrière

**Implémentation** :
- Chaque `serac_put` crée une nouvelle version (append-only)
- `serac_get(path, version="v3")` récupère une version spécifique
- `serac_diff(path, from="v2", to="v4")` compare deux versions
- Garde-limite configurable (7, 30, 90 jours, ou illimité)
- Le coût stockage = versions × taille fichier → à tarififier

### Concurrence MCP storage

Personne ne fait du cloud storage E2E en MCP server aujourd'hui :
- **Google Cloud MCP servers** (50+ servers) : Compute, BigQuery, Storage... mais PAS E2E, pas agent-native auth, Google voit tout
- **Vercel MCP** : déploiement, pas storage
- **Firecrawl MCP** : scraping, pas storage
- **E2B MCP** : sandbox code execution, pas storage
- **Smithery registry** : aucun server "encrypted cloud storage"

**L'espace est vide.** Serac Agents serait le premier MCP server de stockage E2E chiffré sur le registry.

### Confiance et auditabilité — prérequis non-négociable

Le MCP Registry est un canal de **découverte**, pas de **confiance**.

Réalité terrain : Claude a proposé à Aiko 10+ MCP servers/plugins pour Hermes. Aiko a fait une review de chaque projet et a **tout refusé** pour des raisons de sécurité. Ce filtre sera appliqué par tout orchestrateur humain.

**Conséquences pour Serac Agents** :
- Le code doit être **100% open-source** — serveur MCP + SDK client
- Pas de dépendance opaque, pas de binaire fermé
- Les appels doivent être **simples et auditable** — un humain doit pouvoir lire le code et vérifier ce qui est envoyé
- Le SDK client doit montrer exactement ce qu'il chiffre et ce qu'il envoie
- Audit externe dès que possible (bug bounty, whitepaper crypto)
- **Si c'est pas auditable, c'est pas adopté.**

La confiance est le premier mur. Pas le chiffrement, pas le pricing — la confiance. Un agent qui trouve "serac-agents" sur le MCP registry ne l'installera que si l'orchestrateur humain valide le code. Et l'humain valide le code seulement s'il peut le lire.

### OVH S3 — pas d'egress

**Correction majeure** : OVH S3 ne facture PAS l'egress (download). Le coût est quasi 100% stockage.

Coûts OVH S3 (Standard, FR — Gravelines), recalculés :
- Stockage : ~0.012€/Go/mois
- Upload : gratuit
- Download : **0€/Go** (pas d'egress)
- API calls : première millions gratuite
- 500 Go = ~6€/mois — c'est TOUT

Ça change le pricing : pas besoin de se soucier du volume de download pour la recherche sémantique (l'agent télécharge l'index embeddings, fait des requêtes fréquentes). Pas de surprise sur la facture.

Coût réel avec compute MCP server (~2-5€/mois) :
- 50 Go ≈ 2-3€/mois total
- 500 Go ≈ 8-11€/mois total
- 2 To ≈ 29-34€/mois total

## Questions ouvertes

- [x] Comment un agent crée son vault sans intervention humaine ? → Résolu : POST /v1/vaults/create avec clé publique + wallet
- [ ] Recovery en v1.5 (pas v2) : la perte de clé = perte de data est un risque opérationnel majeur. L'envelope hybride (tuteur humain ou agent) doit être disponible tôt.
- [ ] Freemium : 1 Go trop petit pour être utile ? Quel seuil permet de "convertir" un agent ? 5 Go ? 10 Go ?
- [ ] Recherche sémantique : quel modèle d'embedding ? Local (sur la station Ryzen) vs API ? Impact sur le SDK client.
- [ ] Versionnage : combien de versions garder ? Impact sur le coût stockage (versions × taille fichier).
- [ ] Sécurité du MCP Registry : comment un agent ou un humain évalue la confiance d'un MCP server ? Score ? Audit ? Signatures ?
- [ ] Concurrence : que fait Google si le marché agent-native explose ? Réponse E2E ? Acquisition d'un acteur E2E ?
- [ ] Side project posture : ne pas viser la concurrence avec les géants. Valider le besoin, itérer, voir ce qui pousse.
- [ ] Scope des données agents vs humains : même plateforme, deux UX ? Ou deux produits séparés ?
- [ ] Réglementation : le RGPD s'applique-t-il aux agents autonomes ? Qui est le "responsable de traitement" ?
- [ ] Comment gérer les 300 Go à 1 To par agent sans exploser les coûts de stockage ?

## Prochaine itération

- Creuser la piste 4 (chiffrement hybride agent + humain)
- Définir le protocole MCP exact
- Analyser la faisabilité de la recherche sémantique E2E
- Étudier les frameworks agents (Hermes MCP, Claude MCP, OpenAI function calling) pour compatibilité
