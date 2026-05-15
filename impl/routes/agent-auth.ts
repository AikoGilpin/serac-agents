/**
 * Agent Auth Routes
 *
 * POST /v1/agent/auth/api-key    — Exchange API key for JWT (first contact, MCP-friendly)
 * GET  /v1/agent/auth/challenge  — Get Ed25519 challenge for challenge-response auth
 * POST /v1/agent/auth/token       — Redeem signed challenge for JWT (session renewal)
 * POST /v1/agent/auth/verify     — Optional: verify a JWT is still valid
 *
 * Auth model: Hybrid API key + Ed25519 challenge-response (ADR-002, ADR-005)
 * - API key: static, 1-line config, for first contact
 * - Challenge-response: Ed25519 signed, non-replayable, for session renewal
 * - JWT: same HMAC-SHA256 as human auth, claim type: "agent" differentiates
 * - No agent_sessions table: stateless JWT + Redis for challenges
 */

import type { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { createHash, randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { sql } from "../../db/connection.js";
import { JWT_SECRET } from "../../lib/jwt.js";
import { redis } from "../../lib/redis.js";

// ── Constants ──

const API_KEY_PREFIX = "sk_serac_";
const CHALLENGE_TTL_SECONDS = 300; // 5 minutes
const MAX_CHALLENGES_PER_HOUR = 10;
const AGENT_JWT_EXPIRY = "1h";
const BCRYPT_ROUNDS = 12;

// ── Helpers ──

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(32).toString("hex");
}

/**
 * Generate agent JWT with type: "agent" claim
 */
async function generateAgentJwt(vaultId: string, opts?: { namespaceId?: string }) {
  const payload: Record<string, string> = { type: "agent" };
  if (opts?.namespaceId) payload.ns = opts.namespaceId;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(vaultId)
    .setIssuedAt()
    .setExpirationTime(AGENT_JWT_EXPIRY)
    .sign(JWT_SECRET);
}

// ── Validation schemas ──

const apiKeySchema = z.object({
  apiKey: z.string().startsWith(API_KEY_PREFIX, "Invalid API key format"),
});

const challengeResponseSchema = z.object({
  vaultId: z.string().uuid(),
  challenge: z.string().min(1),
  signature: z.string().min(1), // hex-encoded Ed25519 signature
});

const verifySchema = z.object({
  // Just needs Bearer token in header, no body
});

// ── Routes ──

export async function agentAuthRoutes(app: FastifyInstance) {
  /**
   * POST /v1/agent/auth/api-key
   *
   * Exchange API key for JWT. This is the simplest auth flow:
   * the agent provides its API key, we validate it and return a JWT.
   *
   * Rate limited: 20 requests per minute per IP.
   */
  app.post(
    "/api-key",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const { apiKey } = apiKeySchema.parse(request.body);

      // Extract prefix for DB lookup (first 8 chars after "sk_serac_")
      const keyPrefix = apiKey.slice(0, API_KEY_PREFIX.length + 8);

      // Lookup by prefix
      const [apiKeyRow] = await sql`
        SELECT ak.id, ak.key_hash, ak.key_type, ak.namespace_id, ak.is_revoked,
               v.id as vault_id, v.is_active, v.owner_id
        FROM agent_api_keys ak
        JOIN agent_vaults v ON ak.vault_id = v.id
        WHERE ak.key_prefix = ${keyPrefix} AND ak.is_revoked = FALSE
      `;

      if (!apiKeyRow) {
        return reply.status(401).send({ error: "Invalid API key" });
      }

      // Verify bcrypt hash
      const valid = await bcrypt.compare(apiKey, apiKeyRow["key_hash"]);
      if (!valid) {
        return reply.status(401).send({ error: "Invalid API key" });
      }

      // Check vault is active
      if (!apiKeyRow["is_active"]) {
        return reply.status(403).send({ error: "Vault is disabled" });
      }

      // Update last_used_at
      await sql`
        UPDATE agent_api_keys SET last_used_at = NOW()
        WHERE id = ${apiKeyRow["id"]}
      `.catch(() => {}); // Non-critical

      // Generate JWT
      const token = await generateAgentJwt(apiKeyRow["vault_id"], {
        namespaceId: apiKeyRow["namespace_id"] ?? undefined,
      });

      // Audit log
      await sql`
        INSERT INTO agent_audit_log (vault_id, action, auth_method, ip_address)
        VALUES (${apiKeyRow["vault_id"]}, 'auth_api_key', 'api_key', ${request.ip}::inet)
      `.catch(() => {}); // Non-critical

      return reply.send({
        accessToken: token,
        tokenType: "Bearer",
        expiresIn: 3600, // 1 hour in seconds
        vaultId: apiKeyRow["vault_id"],
        keyType: apiKeyRow["key_type"],
      });
    },
  );

  /**
   * GET /v1/agent/auth/challenge
   *
   * Generate a challenge for Ed25519 challenge-response auth.
   * The challenge is stored in Redis with a 5-minute TTL.
   * The agent signs: challenge:vaultId:timestamp
   *
   * Rate limited: 10 challenges per hour per vault.
   */
  app.get(
    "/challenge",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const { vaultId } = z
        .object({ vaultId: z.string().uuid() })
        .parse(request.query);

      // Check vault exists and is active
      const [vault] = await sql`
        SELECT id, ed25519_public_key FROM agent_vaults
        WHERE id = ${vaultId} AND is_active = TRUE
      `;

      if (!vault) {
        return reply.status(404).send({ error: "Vault not found or disabled" });
      }

      // Rate limit challenges per vault
      if (redis) {
        const rateLimitKey = `challenge_rate:${vaultId}`;
        const count = await redis.incr(rateLimitKey);
        if (count === 1) await redis.expire(rateLimitKey, 3600); // 1 hour window
        if (count > MAX_CHALLENGES_PER_HOUR) {
          return reply.status(429).send({ error: "Too many challenges, try again later" });
        }
      }

      // Generate challenge
      const challenge = randomBytes(32).toString("hex");
      const timestamp = Date.now();
      const message = `${challenge}:${vaultId}:${timestamp}`;

      // Store challenge in Redis with TTL
      if (redis) {
        await redis.set(
          `challenge:${challenge}`,
          JSON.stringify({ vaultId, timestamp }),
          "EX",
          CHALLENGE_TTL_SECONDS,
        );
      } else {
        return reply.status(503).send({ error: "Auth service unavailable (Redis required)" });
      }

      return reply.send({
        challenge,
        vaultId,
        timestamp,
        message, // The string the agent must sign
      });
    },
  );

  /**
   * POST /v1/agent/auth/token
   *
   * Redeem a signed challenge for a JWT.
   * The agent signs: challenge:vaultId:timestamp with their Ed25519 private key.
   */
  app.post(
    "/token",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const { vaultId, challenge, signature } = challengeResponseSchema.parse(request.body);

      // Retrieve challenge from Redis
      if (!redis) {
        return reply.status(503).send({ error: "Auth service unavailable (Redis required)" });
      }

      const challengeData = await redis.get(`challenge:${challenge}`);
      if (!challengeData) {
        return reply.status(401).send({ error: "Challenge expired or invalid" });
      }

      // Delete challenge (single-use)
      await redis.del(`challenge:${challenge}`);

      // Verify challenge matches vaultId
      let parsed: { vaultId: string; timestamp: number };
      try {
        parsed = JSON.parse(challengeData);
      } catch {
        return reply.status(401).send({ error: "Invalid challenge data" });
      }

      if (parsed.vaultId !== vaultId) {
        return reply.status(401).send({ error: "Challenge vault mismatch" });
      }

      // Check timestamp is within TTL (defense in depth)
      const challengeAge = Date.now() - parsed.timestamp;
      if (challengeAge > CHALLENGE_TTL_SECONDS * 1000) {
        return reply.status(401).send({ error: "Challenge expired" });
      }

      // Get vault and Ed25519 public key
      const [vault] = await sql`
        SELECT id, ed25519_public_key, is_active
        FROM agent_vaults WHERE id = ${vaultId}
      `;

      if (!vault) {
        return reply.status(404).send({ error: "Vault not found" });
      }

      if (!vault["is_active"]) {
        return reply.status(403).send({ error: "Vault is disabled" });
      }

      // Verify Ed25519 signature
      // Message = challenge:vaultId:timestamp
      const message = `${challenge}:${vaultId}:${parsed.timestamp}`;
      const messageBytes = Buffer.from(message, "utf-8");
      const signatureBytes = Buffer.from(signature, "hex");
      const publicKeyBytes = Buffer.from(vault["ed25519_public_key"] as Buffer);

      // Use libsodium through @serac/crypto for Ed25519 verification
      // We need to use the crypto package's verify function
      // For now, use Node.js crypto.sign (Ed25519 is supported natively)
      try {
        const { sign } = await import("crypto");
        const verifyResult = sign.verify(
          null,
          messageBytes,
          signatureBytes,
          {
            key: publicKeyBytes,
            format: "buffer",
            type: "ed25519",
          } as any,
        );

        if (!verifyResult) {
          return reply.status(401).send({ error: "Invalid signature" });
        }
      } catch (err) {
        // Ed25519 verification may use different API on different Node versions
        // Fallback: use @serac/crypto verify function
        try {
          const { default: sodium } = await import("libsodium-wrappers-sumo");
          await sodium.ready;
          const valid = sodium.crypto_sign_verify_detached(
            signatureBytes,
            messageBytes,
            publicKeyBytes,
          );
          if (!valid) {
            return reply.status(401).send({ error: "Invalid signature" });
          }
        } catch {
          return reply.status(500).send({ error: "Signature verification failed" });
        }
      }

      // Generate JWT
      const token = await generateAgentJwt(vaultId);

      // Audit log
      await sql`
        INSERT INTO agent_audit_log (vault_id, action, auth_method, ip_address)
        VALUES (${vaultId}, 'auth_challenge', 'challenge_response', ${request.ip}::inet)
      `.catch(() => {});

      // Reset rate limit counter on successful auth
      await redis.del(`challenge_rate:${vaultId}`).catch(() => {});

      return reply.send({
        accessToken: token,
        tokenType: "Bearer",
        expiresIn: 3600,
        vaultId,
      });
    },
  );

  /**
   * POST /v1/agent/auth/verify
   *
   * Verify a JWT is still valid. Agents can call this to check
   * their token hasn't been revoked (e.g., after vault.disable).
   */
  app.post("/verify", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Missing Bearer token" });
    }

    const token = authHeader.slice(7);

    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);

      // Verify it's an agent token
      if (payload.type !== "agent") {
        return reply.status(401).send({ error: "Not an agent token" });
      }

      // Check vault is still active
      const [vault] = await sql`
        SELECT id, is_active FROM agent_vaults WHERE id = ${payload.sub}
      `;

      if (!vault || !vault["is_active"]) {
        return reply.status(403).send({ error: "Vault disabled or not found" });
      }

      return reply.send({
        valid: true,
        vaultId: payload.sub,
        expiresAt: new Date((payload.exp as number) * 1000).toISOString(),
      });
    } catch {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }
  });
}