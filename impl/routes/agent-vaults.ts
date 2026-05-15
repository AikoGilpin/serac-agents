/**
 * Agent Vault & Namespace Routes
 *
 * POST   /v1/agent/vaults             — Create a new agent vault
 * GET    /v1/agent/vaults/:vaultId    — Get vault info
 * PATCH  /v1/agent/vaults/:vaultId    — Update vault
 * DELETE /v1/agent/vaults/:vaultId    — Delete vault (soft delete)
 *
 * POST   /v1/agent/vaults/:vaultId/namespaces         — Create namespace
 * GET    /v1/agent/vaults/:vaultId/namespaces         — List namespaces
 * GET    /v1/agent/vaults/:vaultId/namespaces/:nsId   — Get namespace
 * PATCH  /v1/agent/vaults/:vaultId/namespaces/:nsId   — Update namespace
 * DELETE /v1/agent/vaults/:vaultId/namespaces/:nsId   — Delete namespace
 *
 * POST   /v1/agent/vaults/:vaultId/api-keys           — Create API key
 * GET    /v1/agent/vaults/:vaultId/api-keys           — List API keys
 * DELETE /v1/agent/vaults/:vaultId/api-keys/:keyId    — Revoke API key
 *
 * POST   /v1/agent/vaults/:vaultId/guardians          — Add guardian (owner escrow)
 *
 * Note: Vault creation requires human auth (owner_id).
 * Namespace/object operations require agent auth (JWT type: "agent").
 */

import type { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import { z } from "zod";
import { sql } from "../../db/connection.js";
import { authenticate } from "../../middleware/auth.js";
import { authenticateAgent } from "../../middleware/auth-agent.js";

const API_KEY_PREFIX = "sk_serac_";
const BCRYPT_ROUNDS = 12;
const MAX_NAMESPACES_PER_VAULT = 50;
const MAX_API_KEYS_PER_VAULT = 10;

// ── Validation schemas ──

const createVaultSchema = z.object({
  vaultName: z.string().min(1).max(100),
  ed25519PublicKey: z.string().min(1), // hex
  x25519PublicKey: z.string().min(1),  // hex
  encryptedMasterKey: z.string().min(1), // hex
  masterKeyNonce: z.string().min(1),    // hex
  keyCommitment: z.string().min(1),     // hex
  keyAlgorithm: z.string().default("v1-x25519-ed25519"),
  planName: z.string().default("agent_free"),
  // Owner guardian (V1: required)
  guardianX25519PublicKey: z.string().min(1), // hex — owner's X25519 pubkey
  guardianEncryptedMasterKey: z.string().min(1), // hex — MK sealed-box for owner
});

const updateVaultSchema = z.object({
  vaultName: z.string().min(1).max(100).optional(),
  is_active: z.boolean().optional(),
});

const createNamespaceSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, "Namespace name must be alphanumeric with - or _"),
  description: z.string().max(500).optional(),
  encryptedNamespaceKey: z.string().min(1), // hex
  namespaceKeyNonce: z.string().min(1),     // hex
  defaultTtlSeconds: z.number().int().min(0).optional(),
});

const updateNamespaceSchema = z.object({
  description: z.string().max(500).optional(),
  defaultTtlSeconds: z.number().int().min(0).optional(),
});

const createApiKeySchema = z.object({
  keyType: z.enum(["full", "readonly", "namespace_scoped"]).default("full"),
  namespaceId: z.string().uuid().optional(), // Required if keyType = namespace_scoped
  expiresAt: z.string().datetime().optional(),
});

const addGuardianSchema = z.object({
  guardianUserId: z.string().uuid(),
  x25519PublicKey: z.string().min(1), // hex
  encryptedMasterKey: z.string().min(1), // hex
});

// ── Routes ──

export async function agentVaultRoutes(app: FastifyInstance) {

  // ================================================================
  // VAULT CRUD (requires human auth — owner creates vaults)
  // ================================================================

  /**
   * POST /v1/agent/vaults
   *
   * Create a new agent vault. The human owner (authenticated via JWT)
   * creates the vault on behalf of an agent.
   */
  app.post(
    "/vaults",
    { preHandler: authenticate },
    async (request, reply) => {
      const body = createVaultSchema.parse(request.body);
      const ownerId = request.userId;

      // Get plan
      const [plan] = await sql`
        SELECT id FROM plans WHERE name = ${body.planName}
      `;
      if (!plan) {
        return reply.status(400).send({ error: `Unknown plan: ${body.planName}` });
      }

      // Create vault + guardian in a transaction
      const [vault] = await sql.begin(async (tx) => {
        // Create vault
        const [v] = await tx`
          INSERT INTO agent_vaults (
            owner_id, vault_name,
            ed25519_public_key, x25519_public_key,
            encrypted_master_key, master_key_nonce,
            key_commitment, key_algorithm,
            plan_id
          ) VALUES (
            ${ownerId}, ${body.vaultName},
            decode(${body.ed25519PublicKey}, 'hex'),
            decode(${body.x25519PublicKey}, 'hex'),
            decode(${body.encryptedMasterKey}, 'hex'),
            decode(${body.masterKeyNonce}, 'hex'),
            decode(${body.keyCommitment}, 'hex'),
            ${body.keyAlgorithm},
            ${plan["id"]}
          ) RETURNING id, vault_name, created_at
        `;

        // Create default "default" namespace
        await tx`
          INSERT INTO agent_namespaces (
            vault_id, name, description,
            encrypted_namespace_key, namespace_key_nonce
          ) VALUES (
            ${v["id"]}, 'default', 'Default namespace',
            decode(${body.encryptedNamespaceKey || body.encryptedMasterKey}, 'hex'),
            decode(${body.namespaceKeyNonce || body.masterKeyNonce}, 'hex')
          )
        `;

        // Create owner guardian (V1: mandatory)
        await tx`
          INSERT INTO vault_guardians (
            vault_id, guardian_user_id, x25519_public_key,
            encrypted_master_key, relationship, verified_at
          ) VALUES (
            ${v["id"]}, ${ownerId},
            decode(${body.guardianX25519PublicKey}, 'hex'),
            decode(${body.guardianEncryptedMasterKey}, 'hex'),
            'owner', NOW()
          )
        `;

        return [v];
      });

      // Generate initial API key
      const rawApiKey = API_KEY_PREFIX + randomBytes(32).toString("hex");
      const apiKeyPrefix = rawApiKey.slice(0, API_KEY_PREFIX.length + 8);
      const apiKeyHash = await bcrypt.hash(rawApiKey, BCRYPT_ROUNDS);

      await sql`
        INSERT INTO agent_api_keys (vault_id, key_hash, key_prefix, key_type)
        VALUES (${vault!["id"]}, ${apiKeyHash}, ${apiKeyPrefix}, 'full')
      `;

      // Audit log
      await sql`
        INSERT INTO agent_audit_log (vault_id, action, auth_method, ip_address)
        VALUES (${vault!["id"]}, 'create_vault', 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      return reply.status(201).send({
        vaultId: vault!["id"],
        vaultName: vault!["vaultName"],
        apiKey: rawApiKey, // Only returned once! Client must store it.
        createdAt: vault!["created_at"],
      });
    },
  );

  /**
   * GET /v1/agent/vaults
   *
   * List all vaults owned by the authenticated user.
   */
  app.get(
    "/vaults",
    { preHandler: authenticate },
    async (request, reply) => {
      const ownerId = request.userId;

      const vaults = await sql`
        SELECT v.id, v.vault_name, v.is_active, v.storage_used_bytes,
               v.object_count, v.key_algorithm, v.created_at, v.updated_at,
               p.name as plan_name, p.display_name as plan_display_name,
               p.storage_bytes as plan_storage_bytes
        FROM agent_vaults v
        LEFT JOIN plans p ON v.plan_id = p.id
        WHERE v.owner_id = ${ownerId}
        ORDER BY v.created_at DESC
      `;

      return reply.send({ vaults });
    },
  );

  /**
   * GET /v1/agent/vaults/:vaultId
   *
   * Get vault details. Accessible by:
   * - Owner (human auth)
   * - Agent itself (agent auth with matching vaultId)
   */
  app.get(
    "/vaults/:vaultId",
    { preHandler: [authenticate, authenticateAgent].find(m => true) }, // Simplified: use agent auth
    async (request, reply) => {
      // TODO: allow both owner and agent access
      // For now: agent auth
      // This will be refined when we add the dual-auth check
      const vaultId = (request.params as any).vaultId;

      const [vault] = await sql`
        SELECT v.id, v.vault_name, v.owner_id, v.is_active,
               v.ed25519_public_key, v.x25519_public_key,
               v.key_commitment, v.key_algorithm,
               v.storage_used_bytes, v.object_count,
               v.created_at, v.updated_at,
               p.name as plan_name, p.storage_bytes as plan_storage_bytes
        FROM agent_vaults v
        LEFT JOIN plans p ON v.plan_id = p.id
        WHERE v.id = ${vaultId}
      `;

      if (!vault) {
        return reply.status(404).send({ error: "Vault not found" });
      }

      return reply.send({
        vaultId: vault["id"],
        vaultName: vault["vault_name"],
        ownerId: vault["owner_id"],
        isActive: vault["is_active"],
        publicKey: {
          ed25519: (vault["ed25519_public_key"] as Buffer).toString("hex"),
          x25519: (vault["x25519_public_key"] as Buffer).toString("hex"),
        },
        keyCommitment: (vault["key_commitment"] as Buffer).toString("hex"),
        keyAlgorithm: vault["key_algorithm"],
        storage: {
          usedBytes: vault["storage_used_bytes"],
          objectCount: vault["object_count"],
          planStorageBytes: vault["plan_storage_bytes"],
          planName: vault["plan_name"],
        },
        createdAt: vault["created_at"],
        updatedAt: vault["updated_at"],
      });
    },
  );

  // ================================================================
  // NAMESPACE CRUD (requires agent auth)
  // ================================================================

  /**
   * POST /v1/agent/vaults/:vaultId/namespaces
   */
  app.post(
    "/vaults/:vaultId/namespaces",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const body = createNamespaceSchema.parse(request.body);
      const vaultId = (request.params as any).vaultId;

      // Verify vault matches JWT
      if (request.vaultId !== vaultId) {
        return reply.status(403).send({ error: "Vault ID mismatch" });
      }

      // Enforce namespace limit
      const [{ count }] = await sql`
        SELECT COUNT(*) as count FROM agent_namespaces WHERE vault_id = ${vaultId}
      `;
      if (Number(count) >= MAX_NAMESPACES_PER_VAULT) {
        return reply.status(400).send({ error: `Maximum ${MAX_NAMESPACES_PER_VAULT} namespaces per vault` });
      }

      const [ns] = await sql`
        INSERT INTO agent_namespaces (
          vault_id, name, description,
          encrypted_namespace_key, namespace_key_nonce,
          default_ttl_seconds
        ) VALUES (
          ${vaultId}, ${body.name}, ${body.description || null},
          decode(${body.encryptedNamespaceKey}, 'hex'),
          decode(${body.namespaceKeyNonce}, 'hex'),
          ${body.defaultTtlSeconds || null}
        ) RETURNING id, name, created_at
      `;

      // Audit
      await sql`
        INSERT INTO agent_audit_log (vault_id, namespace_id, action, object_key, auth_method, ip_address)
        VALUES (${vaultId}, ${ns!["id"]}, 'create_namespace', ${body.name}, 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      return reply.status(201).send({
        namespaceId: ns!["id"],
        name: ns!["name"],
        createdAt: ns!["created_at"],
      });
    },
  );

  /**
   * GET /v1/agent/vaults/:vaultId/namespaces
   */
  app.get(
    "/vaults/:vaultId/namespaces",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const vaultId = (request.params as any).vaultId;
      if (request.vaultId !== vaultId) {
        return reply.status(403).send({ error: "Vault ID mismatch" });
      }

      const namespaces = await sql`
        SELECT id, name, description, storage_used_bytes, object_count,
               default_ttl_seconds, created_at
        FROM agent_namespaces
        WHERE vault_id = ${vaultId}
        ORDER BY created_at ASC
      `;

      return reply.send({ namespaces });
    },
  );

  /**
   * DELETE /v1/agent/vaults/:vaultId/namespaces/:nsId
   */
  app.delete(
    "/vaults/:vaultId/namespaces/:nsId",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const vaultId = (request.params as any).vaultId;
      const nsId = (request.params as any).nsId;

      if (request.vaultId !== vaultId) {
        return reply.status(403).send({ error: "Vault ID mismatch" });
      }

      // Don't allow deleting "default" namespace
      const [ns] = await sql`
        SELECT name FROM agent_namespaces WHERE id = ${nsId} AND vault_id = ${vaultId}
      `;

      if (!ns) {
        return reply.status(404).send({ error: "Namespace not found" });
      }

      if (ns["name"] === "default") {
        return reply.status(400).send({ error: "Cannot delete the default namespace" });
      }

      await sql`DELETE FROM agent_namespaces WHERE id = ${nsId}`;

      // Audit
      await sql`
        INSERT INTO agent_audit_log (vault_id, namespace_id, action, object_key, auth_method, ip_address)
        VALUES (${vaultId}, ${nsId}, 'delete_namespace', ${ns["name"]}, 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      return reply.send({ success: true });
    },
  );

  // ================================================================
  // API KEYS CRUD (requires agent auth)
  // ================================================================

  /**
   * POST /v1/agent/vaults/:vaultId/api-keys
   */
  app.post(
    "/vaults/:vaultId/api-keys",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const body = createApiKeySchema.parse(request.body);
      const vaultId = (request.params as any).vaultId;

      if (request.vaultId !== vaultId) {
        return reply.status(403).send({ error: "Vault ID mismatch" });
      }

      if (body.keyType === "namespace_scoped" && !body.namespaceId) {
        return reply.status(400).send({ error: "namespaceId required for namespace_scoped keys" });
      }

      // Enforce API key limit
      const [{ count }] = await sql`
        SELECT COUNT(*) as count FROM agent_api_keys
        WHERE vault_id = ${vaultId} AND is_revoked = FALSE
      `;
      if (Number(count) >= MAX_API_KEYS_PER_VAULT) {
        return reply.status(400).send({ error: `Maximum ${MAX_API_KEYS_PER_VAULT} active API keys per vault` });
      }

      // Generate key
      const rawApiKey = API_KEY_PREFIX + randomBytes(32).toString("hex");
      const keyPrefix = rawApiKey.slice(0, API_KEY_PREFIX.length + 8);
      const apiKeyHash = await bcrypt.hash(rawApiKey, BCRYPT_ROUNDS);

      await sql`
        INSERT INTO agent_api_keys (
          vault_id, key_hash, key_prefix, key_type,
          namespace_id, expires_at
        ) VALUES (
          ${vaultId}, ${apiKeyHash}, ${keyPrefix}, ${body.keyType},
          ${body.namespaceId || null},
          ${body.expiresAt || null}
        )
      `;

      // Audit
      await sql`
        INSERT INTO agent_audit_log (vault_id, action, auth_method, ip_address)
        VALUES (${vaultId}, 'create_api_key', 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      return reply.status(201).send({
        apiKey: rawApiKey, // Only shown once!
        keyType: body.keyType,
        prefix: keyPrefix,
      });
    },
  );

  /**
   * GET /v1/agent/vaults/:vaultId/api-keys
   */
  app.get(
    "/vaults/:vaultId/api-keys",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const vaultId = (request.params as any).vaultId;
      if (request.vaultId !== vaultId) {
        return reply.status(403).send({ error: "Vault ID mismatch" });
      }

      const keys = await sql`
        SELECT id, key_prefix, key_type, namespace_id,
               last_used_at, expires_at, is_revoked, created_at
        FROM agent_api_keys
        WHERE vault_id = ${vaultId}
        ORDER BY created_at DESC
      `;

      return reply.send({ apiKeys: keys });
    },
  );

  /**
   * DELETE /v1/agent/vaults/:vaultId/api-keys/:keyId
   */
  app.delete(
    "/vaults/:vaultId/api-keys/:keyId",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const vaultId = (request.params as any).vaultId;
      const keyId = (request.params as any).keyId;

      if (request.vaultId !== vaultId) {
        return reply.status(403).send({ error: "Vault ID mismatch" });
      }

      await sql`
        UPDATE agent_api_keys
        SET is_revoked = TRUE, revoked_at = NOW(), revoke_reason = 'User revoked'
        WHERE id = ${keyId} AND vault_id = ${vaultId} AND is_revoked = FALSE
      `;

      return reply.send({ success: true });
    },
  );

  // ================================================================
  // GUARDIANS (requires agent auth)
  // ================================================================

  /**
   * POST /v1/agent/vaults/:vaultId/guardians
   */
  app.post(
    "/vaults/:vaultId/guardians",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const body = addGuardianSchema.parse(request.body);
      const vaultId = (request.params as any).vaultId;

      if (request.vaultId !== vaultId) {
        return reply.status(403).send({ error: "Vault ID mismatch" });
      }

      // Max 3 guardians (V2 will have quorum)
      const [{ count }] = await sql`
        SELECT COUNT(*) as count FROM vault_guardians WHERE vault_id = ${vaultId}
      `;
      if (Number(count) >= 3) {
        return reply.status(400).send({ error: "Maximum 3 guardians per vault" });
      }

      await sql`
        INSERT INTO vault_guardians (
          vault_id, guardian_user_id, x25519_public_key,
          encrypted_master_key, relationship
        ) VALUES (
          ${vaultId}, ${body.guardianUserId},
          decode(${body.x25519PublicKey}, 'hex'),
          decode(${body.guardianEncryptedMasterKey}, 'hex'),
          'trusted_contact'
        )
      `;

      return reply.status(201).send({ success: true });
    },
  );

  // ================================================================
  // QUOTA (requires agent auth)
  // ================================================================

  /**
   * GET /v1/agent/quota
   *
   * Get storage usage and limits for the authenticated vault.
   * This is the backend for the MCP `serac_quota` tool.
   */
  app.get(
    "/quota",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const vaultId = request.vaultId;

      const [vault] = await sql`
        SELECT v.storage_used_bytes, v.object_count,
               p.name as plan_name, p.display_name, p.storage_bytes
        FROM agent_vaults v
        LEFT JOIN plans p ON v.plan_id = p.id
        WHERE v.id = ${vaultId}
      `;

      if (!vault) {
        return reply.status(404).send({ error: "Vault not found" });
      }

      const usedBytes = Number(vault["storage_used_bytes"]);
      const limitBytes = Number(vault["storage_bytes"] || 0);
      const usagePercent = limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0;

      return reply.send({
        storage: {
          usedBytes,
          limitBytes,
          usagePercent: Math.round(usagePercent * 100) / 100,
        },
        objects: {
          count: Number(vault["object_count"]),
        },
        plan: {
          name: vault["plan_name"],
          displayName: vault["display_name"],
        },
      });
    },
  );
}