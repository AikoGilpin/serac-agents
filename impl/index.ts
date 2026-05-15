/**
 * Agent Routes Registration
 *
 * Registers all agent-related routes on the existing Fastify app.
 * This module should be imported in apps/api/src/index.ts.
 *
 * Routes:
 *   /api/agent/auth/*     — Agent authentication (API key ↔ JWT, challenge-response)
 *   /api/agent/vaults/*   — Vault, namespace, API key, guardian management
 *   /api/agent/objects/*  — Object store/retrieve/list/delete (presigned + direct)
 *   /api/agent/quota      — Quota check
 *   /mcp/v1               — MCP server endpoint (HTTP Streamable)
 *
 * All new tables are created by migration 017_agent_vaults.sql.
 */

import type { FastifyInstance } from "fastify";
import { agentAuthRoutes } from "./routes/agent-auth.js";
import { agentVaultRoutes } from "./routes/agent-vaults.js";
import { agentObjectRoutes } from "./routes/agent-objects.js";
import { mcpServerRoutes } from "./routes/mcp-server.js";

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  // ── Agent Auth ──
  // POST /api/agent/auth/api-key     — Exchange API key for JWT
  // GET  /api/agent/auth/challenge   — Get Ed25519 challenge
  // POST /api/agent/auth/token       — Redeem signed challenge for JWT
  // POST /api/agent/auth/verify      — Verify JWT validity
  await app.register(agentAuthRoutes, { prefix: "/api/agent/auth" });

  // ── Agent Vaults & Namespaces ──
  // POST   /api/agent/vaults                          — Create vault (human auth)
  // GET    /api/agent/vaults                           — List owner's vaults (human auth)
  // GET    /api/agent/vaults/:vaultId                  — Get vault details
  // POST   /api/agent/vaults/:vaultId/namespaces       — Create namespace
  // GET    /api/agent/vaults/:vaultId/namespaces       — List namespaces
  // DELETE /api/agent/vaults/:vaultId/namespaces/:nsId  — Delete namespace
  // POST   /api/agent/vaults/:vaultId/api-keys          — Create API key
  // GET    /api/agent/vaults/:vaultId/api-keys          — List API keys
  // DELETE /api/agent/vaults/:vaultId/api-keys/:keyId   — Revoke API key
  // POST   /api/agent/vaults/:vaultId/guardians         — Add guardian
  // GET    /api/agent/quota                             — Check quota
  await app.register(agentVaultRoutes, { prefix: "/api/agent" });

  // ── Agent Objects ──
  // POST   /api/agent/objects/store        — Get presigned upload URL
  // POST   /api/agent/objects/confirm      — Confirm presigned upload
  // POST   /api/agent/objects/store/direct — Direct upload (< 1MB, base64)
  // GET    /api/agent/objects/retrieve      — Get presigned download URL
  // GET    /api/agent/objects/list          — List namespace objects
  // DELETE /api/agent/objects/delete        — Soft-delete object
  await app.register(agentObjectRoutes, { prefix: "/api/agent" });

  // ── MCP Server ──
  // POST /mcp/v1 — MCP HTTP Streamable endpoint
  // GET  /mcp/v1 — SSE placeholder (V2)
  await app.register(mcpServerRoutes);
}

export default registerAgentRoutes;