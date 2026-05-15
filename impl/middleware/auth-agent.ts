/**
 * Agent Authentication Middleware
 *
 * Verifies agent JWT tokens (type: "agent") and decorates
 * the request with vaultId.
 *
 * Usage:
 *   app.addHook("preHandler", authenticateAgent);
 *   // then in route handler: request.vaultId
 *
 * Different from human auth middleware:
 * - Checks for type: "agent" claim in JWT
 * - Sets vaultId instead of userId
 * - Optionally checks namespace scope from JWT
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { jwtVerify } from "jose";
import { JWT_SECRET } from "../lib/jwt.js";
import { sql } from "../db/connection.js";

// Augment Fastify's request type
declare module "fastify" {
  interface FastifyRequest {
    vaultId: string;
    agentNamespaceId?: string; // Set if API key is namespace-scoped
  }
}

export async function authenticateAgent(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply
      .status(401)
      .send({ error: "Missing or invalid Authorization header" });
  }

  const token = header.slice(7);

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    // Must be an agent token
    if (payload.type !== "agent") {
      return reply.status(401).send({ error: "Not an agent token" });
    }

    if (!payload.sub) {
      return reply.status(401).send({ error: "Invalid token: no subject" });
    }

    // Check vault is still active
    const [vault] = await sql`
      SELECT id, is_active, disabled_at FROM agent_vaults WHERE id = ${payload.sub}
    `;

    if (!vault || !vault["is_active"]) {
      return reply.status(403).send({ error: "Vault disabled or not found" });
    }

    request.vaultId = payload.sub;
    request.agentNamespaceId = (payload.ns as string) || undefined;
  } catch {
    return reply.status(401).send({ error: "Invalid or expired token" });
  }
}