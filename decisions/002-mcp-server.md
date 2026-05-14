# ADR-002 — Spécification MCP Server

**Date** : 14 mai 2026  
**Statut** : Accepté  
**Spécification complète** : `architecture/mcp-server-spec.md`

## Contexte

Les agents IA ont besoin d'une interface programmatique pour stocker et récupérer des données chiffrées. Le MCP (Model Context Protocol) est le standard émergeant pour l'interaction agent↔outil. Serac doit exposer ses fonctionnalités de stockage via MCP pour devenir le stockage cloud natif des agents.

## Options considérées

1. **MCP HTTP Streamable** — Transport HTTP, stateful côté serveur, compatible cloud. Agent envoie des requêtes HTTP POST avec JSON-RPC.
2. **MCP stdio** — Transport local, le MCP server tourne comme subprocess de l'agent. Simple mais incompatible avec le cloud.
3. **REST API pure** — Pas de MCP, API REST classique. Plus de contrôle mais pas d'intégration native avec les frameworks agents.
4. **MCP + REST hybride** — MCP pour les outils agents, REST pour les opérations de gestion (namespace, quota, admin). Meilleur des deux mondes.

## Décision

**Option 4 : MCP + REST hybride**.

- MCP (HTTP Streamable) pour les 5 tools V1 : `serac_store`, `serac_retrieve`, `serac_list`, `serac_delete`, `serac_quota`
- REST API pour la gestion : `/v1/vaults`, `/v1/ns`, `/v1/auth`, `/v1/quota`
- Authentification hybride : API key statique pour premier contact → JWT TTL 1h → renouvellement via challenge-response Ed25519 (ADR-005)
- Deux modes de chiffrement : MCP (at-rest, serveur chiffre) et E2EE (client-side, SDK chiffre)

Stack technique : Node.js + Fastify + @modelcontextprotocol/sdk + PostgreSQL + Redis + OVH S3.

## Conséquences

**Positives** :
- MCP = découverte et intégration native dans les frameworks agents (Hermes, CrewAI, Claude Code, etc.)
- REST = gestion programmatique fine (CRUD namespaces, quota, admin)
- HTTP Streamable = compatible cloud, pas de subprocess local requis
- Background : le code Serac existant est déjà Node.js + Fastify + PostgreSQL + Redis

**Négatives** :
- Deux interfaces à maintenir (MCP + REST)
- Noms différents entre SDK et MCP (store/retrieve vs put/get) — résolu : store/retrieve pour les deux
- `agent_sessions` dans ADR-001 vs JWT+Redis dans ADR-002 — à réconcilier avant implémentation

## Références

- Détails : `architecture/mcp-server-spec.md`
- Auth : ADR-005