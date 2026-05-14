# Architecture — Specs techniques Serac Agents

*Dossier créé le 3 mai 2026, mis à jour le 14 mai 2026.*

## Documents

| Fichier | Statut | Description |
|---------|--------|-------------|
| `existing-stack.md` | ✅ Finalisé | Cartographie VPS (routes, modèles, DB, services, crypto) |
| `gap-analysis.md` | ✅ Finalisé | Écarts entre l'existant et le pivot agent (décisions D1→D10) |
| `encryption-protocol.md` | ✅ Finalisé (ADR-001) | Protocole de chiffrement agent (Ed25519 + MK random, challenge-response, guardian, interop) |
| `mcp-server-spec.md` | ✅ Draft (ADR-002) | Spécification MCP server (5 tools V1, auth hybride, tiering, discovery, BDD) |
| `pricing-model.md` | ✅ Draft (ADR-003) | Modèle de pricing (coûts OVH, tiering auto, marges, scénarios financiers) |
| `sdk-spec.md` | ✅ Draft (ADR-004) | Spécification SDK TS + Python (2 modes, auth, opérations V1/V2, plan de build S1-S5) |

## À créer

| Fichier | Priorité | Description |
|---------|----------|-------------|
| `discovery-spec.md` | Phase 2 | Détail des 4 couches de discovery (.well-known, WebMCP) |

## Conventions

- **ADR** = Architecture Decision Record (numéroté ADR-001, ADR-002, etc.)
- Les ADRs vivent dans `decisions/` une fois finalisés
- Les drafts vivent dans `architecture/` pendant l'itération