# ADR-008 — Discovery en 4 couches

**Date** : 14 mai 2026  
**Statut** : Accepté  
**Spécification complète** : `architecture/discovery-spec.md`

## Contexte

Les agents IA découvrent les services de trois manières : instruction (humain configure), recherche web, et écosystème (registries, frameworks). Serac Agents doit être découvrable par les agents de manière automatique, sans intervention humaine après la première configuration.

## Options considérées

1. **MCP Registry uniquement** — Publier sur `registry.modelcontextprotocol.io`. Limité aux agents qui consultent le registry.
2. **Well-known uniquement** — `.well-known/mcp.json` sur `serac.cloud`. Limité aux agents qui connaissent déjà le domaine.
3. **Registry + well-known** — Couvre 2 cannaux de découverte. Pas de découverte passive.
4. **4 couches** — Well-known (passif), Onboarding JSON (auto-configuration), MCP Remote (HTTP Streamable), WebMCP (browser).

## Décision

**Option 4 : 4 couches de discovery.**

| Couche | Mécanisme | Statut | Description |
|--------|-----------|--------|-------------|
| 1 | `.well-known/mcp.json` | V1 | Discovery passive. Un agent qui connaît `serac.cloud` peut trouver le MCP server. |
| 2 | `.well-known/serac.json` | V1 | Onboarding auto. Décrit les tiers, capacités, et comment s'enregistrer. |
| 3 | MCP Server Remote | V1 | HTTP Streamable. L'agent configure l'URL du MCP server dans son config. |
| 4 | WebMCP (W3C) | Phase 3 | Découverte native via le navigateur. Chrome 146+. Polyfill `@mcp-b/global` disponible maintenant. |

Priorité d'implémentation : couches 1-3 en V1 (simple, bien supporté), couche 4 en Phase 3 (quand WebMCP sera stabilisé dans Chrome).

## Conséquences

**Positives** :
- 3 couches en V1 = couverture maximale pour les agents d'aujourd'hui
- `.well-known` = zéro friction, standard IETF
- MCP Remote = compatible avec tous les frameworks agents actuels
- WebMCP = préparation pour l'avenir, sans blocker sur une spec W3C non stabilisée

**Négatives** :
- 3 endpoints à maintenir en V1
- WebMCP pas prêt = pas de découverte native navigateur en V1
- Le registry MCP (`registry.modelcontextprotocol.io`) est un écosystème tiers, pas contrôlé par Serac

## Références

- Détails : `architecture/discovery-spec.md`
- Registry : https://registry.modelcontextprotocol.io
- WebMCP : https://github.com/nichochar/mcp-b