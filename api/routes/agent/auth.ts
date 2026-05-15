/**
 * Agent Auth Routes
 *
 * POST /api/agent/register          — Self-register a new agent vault (PUBLIC, no auth)
 * POST /api/agent/auth/api-key      — Exchange API key for JWT
 * GET  /api/agent/auth/challenge    — Get Ed25519 challenge
 * POST /api/agent/auth/token        — Redeem signed challenge for JWT
 * POST /api/agent/auth/verify      — Verify a JWT is still valid
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
  if (opts?.namespaceId) payload["ns"] = opts.namespaceId;

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

const registerSchema = z.object({
  agent_name: z.string().min(2).max(120).regex(/^[a-zA-Z0-9_-]+(?:\s[a-zA-Z0-9_-]+)*$/, "Agent name: alphanumeric, spaces, hyphens, underscores"),
  ed25519_public_key: z.string().min(1), // hex or base64
  x25519_public_key: z.string().min(1),
  encrypted_master_key: z.string().min(1), // base64
  master_key_nonce: z.string().min(1),     // base64
  key_commitment: z.string().min(1),        // base64 (BLAKE2b-256 hash)
  tier: z.enum(["agent_free", "agent_starter", "agent_pro", "agent_fleet"]).default("agent_free"),
  owner_id: z.string().uuid().optional(),   // Link to human account (optional)
  webhook_url: z.string().url().optional(),
  spending_limit_monthly_cents: z.number().int().min(0).optional(),
  x402_wallet_address: z.string().optional(), // Base L2 USDC address
  agent_type: z.string().max(100).optional(), // Analytics-only, free-form
});

// ── Routes ──

export async function agentAuthRoutes(app: FastifyInstance) {
  /**
   * POST /register
   *
   * Public endpoint — no auth required.
   * An autonomous AI agent can self-register a vault.
   *
   * Flow:
   * 1. Agent generates Ed25519 + X25519 keypair locally
   * 2. Agent derives X25519 from Ed25519 (or generates separately)
   * 3. Agent encrypts its master key (MK) with X25519 sealed box
   * 4. Agent sends pubkey, encrypted MK, commitment, tier choice
   * 5. Server creates vault + default namespace + initial API key
   * 6. Server returns vault_id + API key (one-time display)
   *
   * Rate limited: 3 registrations per hour per IP.
   */
  app.post(
    "/register",
    {
      config: {
        rateLimit: { max: 3, timeWindow: "1 hour" },
      },
    },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }

      const reg = parsed.data;

      // Decode binary fields from base64
      let ed25519PubBuf: Buffer, x25519PubBuf: Buffer, encMkBuf: Buffer, mkNonceBuf: Buffer, commitmentBuf: Buffer;
      try {
        ed25519PubBuf = Buffer.from(reg.ed25519_public_key, "base64");
        x25519PubBuf = Buffer.from(reg.x25519_public_key, "base64");
        encMkBuf = Buffer.from(reg.encrypted_master_key, "base64");
        mkNonceBuf = Buffer.from(reg.master_key_nonce, "base64");
        commitmentBuf = Buffer.from(reg.key_commitment, "base64");
      } catch {
        return reply.status(400).send({ error: "Invalid base64 encoding in key fields" });
      }

      // Validate key lengths
      if (ed25519PubBuf.length !== 32) {
        return reply.status(400).send({ error: "ed25519_public_key must be 32 bytes" });
      }
      if (x25519PubBuf.length !== 32) {
        return reply.status(400).send({ error: "x25519_public_key must be 32 bytes" });
      }
      if (commitmentBuf.length !== 32) {
        return reply.status(400).send({ error: "key_commitment must be 32 bytes (BLAKE2b-256)" });
      }

      // Look up plan
      const [plan] = await sql`
        SELECT id FROM plans WHERE name = ${reg.tier}
      `;
      if (!plan) {
        return reply.status(400).send({ error: `Unknown tier: ${reg.tier}` });
      }

      // Look up owner_id if provided
      let ownerId: string | null = null;
      if (reg.owner_id) {
        const [user] = await sql`
          SELECT id FROM users WHERE id = ${reg.owner_id}
        `;
        if (!user) {
          return reply.status(400).send({ error: "owner_id not found" });
        }
        ownerId = reg.owner_id;
      }

      // Payment method logic
      let paymentMethod = "free";
      let paymentStatus = "active";
      if (reg.x402_wallet_address) {
        paymentMethod = "x402";
        paymentStatus = "active";
      }

      // Create vault
      const [vault] = await sql`
        INSERT INTO agent_vaults (
          owner_id, vault_name,
          ed25519_public_key, x25519_public_key,
          encrypted_master_key, master_key_nonce, key_commitment,
          key_algorithm, plan_id,
          payment_method, payment_status,
          x402_wallet_address, x402_spending_limit_cents,
          webhook_url,
          agent_type
        ) VALUES (
          ${ownerId}, ${reg.agent_name},
          ${ed25519PubBuf}, ${x25519PubBuf},
          ${encMkBuf}, ${mkNonceBuf}, ${commitmentBuf},
          'v1-x25519-ed25519', ${plan['id']},
          ${paymentMethod}, ${paymentStatus},
          ${reg.x402_wallet_address ?? null}, ${reg.spending_limit_monthly_cents ?? null},
          ${reg.webhook_url ?? null},
          ${reg.agent_type ?? null}
        )
        RETURNING id
      `;

      if (!vault) {
        return reply.status(500).send({ error: "Failed to create vault" });
      }

      const vaultId = vault['id'] as string;

      // Create default namespace ("memory")
      const defaultNamespaceKey = Buffer.from(
        randomBytes(32).toString("base64") + ":" + randomBytes(16).toString("base64"),
        "utf-8"
      );

      await sql`
        INSERT INTO agent_namespaces (
          vault_id, name, description,
          encrypted_namespace_key, namespace_key_nonce,
          default_ttl_seconds
        ) VALUES (
          ${vaultId}, 'memory', 'Default memory namespace',
          ${defaultNamespaceKey}, ${randomBytes(12)},
          0
        )
      `;

      // Generate initial API key
      const apiKey = generateApiKey();
      const keyPrefix = apiKey.slice(0, API_KEY_PREFIX.length + 8);
      const keyHash = await bcrypt.hash(apiKey, BCRYPT_ROUNDS);

      await sql`
        INSERT INTO agent_api_keys (vault_id, key_hash, key_prefix, key_type)
        VALUES (${vaultId}, ${keyHash}, ${keyPrefix}, 'full')
      `;

      // Create owner guardian if linked to human
      if (ownerId) {
        // Get owner's X25519 public key from their vault (if they have one)
        // For now, we'll need the client to provide this separately
        // The guardian creation can be a separate POST after registration
      }

      // Generate initial JWT
      const token = await generateAgentJwt(vaultId);

      // Audit log
      await sql`
        INSERT INTO agent_audit_log (vault_id, action, auth_method, ip_address)
        VALUES (${vaultId}, 'register', 'self_register', ${request.ip}::inet)
      `.catch(() => {});

      return reply.status(201).send({
        vaultId,
        accessToken: token,
        tokenType: "Bearer",
        expiresIn: 3600,
        apiKey, // One-time display! Not shown again.
        namespace: "memory",
        tier: reg.tier,
        message: "Keep your API key safe. It will not be shown again.",
      });
    },
  );

  /**
   * POST /api-key
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
   * GET /challenge
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
   * POST /token
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

      // Ed25519 signature verification using Node.js crypto.verify
      const { createPublicKey, verify: cryptoVerify } = await import("crypto");
      const ed25519Key = createPublicKey({
        key: publicKeyBytes,
        format: "der",
        type: "spki",
      });
      const valid = cryptoVerify("ed25519", messageBytes, ed25519Key, signatureBytes);
      if (!valid) {
        return reply.status(401).send({ error: "Invalid signature" });
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
   * POST /verify
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
      if (payload['type'] !== "agent") {
        return reply.status(401).send({ error: "Not an agent token" });
      }

      // Check vault is still active
      const [vault] = await sql`
        SELECT id, is_active FROM agent_vaults WHERE id = ${payload.sub as string}
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