# ADR-004 — Spécification SDK Client (TypeScript + Python)

**Date** : 14 mai 2026  
**Statut** : Accepté  
**Spécification complète** : `architecture/sdk-spec.md`

## Contexte

Les agents IA interagissent avec Serac via un SDK, pas via interface web. Le SDK doit gérer le chiffrement de manière transparente, supporter les deux modes (MCP at-rest et E2EE client-side), et être disponible dans les deux langages principaux des frameworks agents : TypeScript et Python.

## Options considérées

1. **TypeScript d'abord, Python ensuite (séquentiel)** — Plus rapide pour V1, mais retarde l'écosystème Python.
2. **TypeScript et Python en parallèle** — Plus de travail initial, mais les deux écosystèmes sont couverts dès le lancement. PyNaCl = port trivial de @serac/crypto.
3. **Python d'abord** — La plupart des frameworks agents (Hermes, CrewAI) sont Python. Mais la stack Serac est TypeScript.
4. **SDK unique en WASM** — Un seul SDK compilé en WASM, consommé par TS et Python. Complexe, peu de tooling.

## Décision

**Option 2 : TypeScript + Python en parallèle, décalé de 2 semaines.**

- `serac-agent-sdk` (npm) — S1-S3, aligné avec la stack Serac existante
- `serac-mcp` (pip) — S4-S5, port fidèle de @serac/crypto via PyNaCl

Deux modes de chiffrement, même API :
- `mcp` (at-rest) — pas de crypto côté agent, le serveur chiffre. Dépendances : fetch uniquement.
- `e2ee` (client-side) — l'agent chiffre localement. Dépendances : libsodium-wrappers (TS) / PyNaCl (Python).

Vecteurs de test interop JS↔Python partagés (ADR-001 section 10) pour garantir qu'un ciphertext produit par le SDK TS est déchiffrable par le SDK Python et inverse-versa.

## Conséquences

**Positives** :
- Couverture double écosystème dès le lancement
- Interopérabilité garantie par vecteurs de test partagés
- 22 fonctions @serac/crypto réutilisées tel quel, 4 adaptées, 4 nouvelles
- Mode MCP = zéro dépendance crypto = adoption aisée pour les agents basiques
- Python = aligned avec Hermes, CrewAI, LangGraph, OpenAI Agents SDK

**Négatives** :
- Deux SDK à maintenir en parallèle
- Le SDK Python arrive 2 semaines après le TS (S4 vs S1)
- Le mode E2EE ajoute une dépendance crypto (libsodium/PyNaCl) — optionnelle, pas requise en mode MCP

## Références

- Détails : `architecture/sdk-spec.md`
- Crypto : ADR-001
- Auth : ADR-005