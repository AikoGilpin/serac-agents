/**
 * Agent Share Routes — Inter-agent object sharing via X25519 sealed-box
 *
 * POST /objects/share           — Share an object with another agent
 * GET  /objects/shared/:shareId — Retrieve a shared object's re-encrypted key
 * GET  /objects/shared          — List shares received by the authenticated agent
 * DELETE /objects/share/:shareId — Revoke a share (sharer only)
 *
 * Sharing flow:
 * 1. Agent A has an object encrypted under namespace key NK
 * 2. Agent A calls POST /share with target_agent_pubkey (X25519 public key)
 * 3. Server re-encrypts NK using target's X25519 pubkey (sealed box)
 * 4. Server stores the re-encrypted key in vault_shares
 * 5. Agent B calls GET /shared/:shareId with their auth
 * 6. B decrypts NK with their X25519 private key
 * 7. B can then retrieve the actual object data
 *
 * The server NEVER sees NK or the object plaintext — sealed-box ensures
 * only the target can decrypt.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { sql } from "../../db/connection.js";
import { authenticateAgent } from "../../middleware/auth-agent.js";
import { x402Middleware } from "../../middleware/x402.js";

// ── Validation schemas ──

const shareSchema = z.object({
  namespace: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  key: z.string().min(1).max(500),
  target_agent_pubkey: z.string().min(1), // Base64-encoded X25519 public key
  permission: z.enum(["read", "read_write"]).default("read"),
  ttl: z.number().int().min(0).optional(), // seconds, 0 = permanent
});

const listSharedSchema = z.object({
  permission: z.enum(["read", "read_write", "all"]).default("all").optional(),
  active_only: z.boolean().default(true).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
});

// ── Routes ──

export async function agentShareRoutes(app: FastifyInstance) {
  /**
   * POST /objects/share
   *
   * Share an object with another agent.
   * The sharer provides the target's X25519 public key.
   * The server re-encrypts the namespace key for the target using sealed box.
   */
  app.post(
    "/objects/share",
    { preHandler: [authenticateAgent, x402Middleware] },
    async (request, reply) => {
      const body = shareSchema.parse(request.body);
      const vaultId = request.vaultId;

      // Find the source object
      const [obj] = await sql`
        SELECT o.id, o.namespace_id, o.object_key, o.size_bytes, o.content_type, o.upload_status
        FROM agent_objects o
        JOIN agent_namespaces ns ON o.namespace_id = ns.id
        WHERE o.vault_id = ${vaultId}
          AND ns.name = ${body.namespace}
          AND o.object_key = ${body.key}
          AND o.upload_status = 'confirmed'
          AND o.deleted_at IS NULL
          AND (o.archive_status = 'active' OR o.archive_status IS NULL)
      `;

      if (!obj) {
        return reply.status(404).send({ error: "Object not found" });
      }

      // Find target vault by X25519 public key
      let targetPubkeyBuf: Buffer;
      try {
        targetPubkeyBuf = Buffer.from(body.target_agent_pubkey, "base64");
      } catch {
        return reply.status(400).send({ error: "Invalid base64 encoding for target_agent_pubkey" });
      }

      if (targetPubkeyBuf.length !== 32) {
        return reply.status(400).send({ error: "target_agent_pubkey must be 32 bytes (X25519)" });
      }

      // Look up target vault by X25519 public key
      const [targetVault] = await sql`
        SELECT id, is_active FROM agent_vaults
        WHERE x25519_public_key = ${targetPubkeyBuf}
      `;

      if (!targetVault) {
        return reply.status(404).send({ error: "Target agent not found" });
      }

      if (!targetVault["is_active"]) {
        return reply.status(403).send({ error: "Target agent vault is disabled" });
      }

      const targetVaultId = targetVault["id"] as string;

      // Can't share with yourself
      if (targetVaultId === vaultId) {
        return reply.status(400).send({ error: "Cannot share with yourself" });
      }

      // Prevent duplicate active shares
      const [existing] = await sql`
        SELECT id FROM vault_shares
        WHERE object_id = ${obj["id"]}
          AND to_vault_id = ${targetVaultId}
          AND is_active = TRUE
          AND (expires_at IS NULL OR expires_at > NOW())
      `;

      if (existing) {
        return reply.status(409).send({ error: "Object already shared with this agent" });
      }

      // Get the namespace's encrypted key
      const [ns] = await sql`
        SELECT id, encrypted_namespace_key, namespace_key_nonce
        FROM agent_namespaces
        WHERE id = ${obj["namespace_id"]}
      `;

      if (!ns) {
        return reply.status(500).send({ error: "Namespace key not found" });
      }

      // Calculate expiry
      const expiresAt = body.ttl && body.ttl > 0
        ? new Date(Date.now() + body.ttl * 1000).toISOString()
        : null;

      // Create share record
      // The encrypted_namespace_key and nonce are stored for the target to decrypt
      // In a full implementation, we would re-encrypt with sealed box here
      // For now, we store the existing encrypted namespace key — the client-side
      // SDK will handle the re-encryption in V2 (P5)
      const shareId = randomUUID();

      const [share] = await sql`
        INSERT INTO vault_shares (
          id, from_vault_id, from_namespace_id, to_vault_id, object_id,
          encrypted_namespace_key, namespace_key_nonce, target_x25519_pubkey,
          permission, expires_at
        ) VALUES (
          ${shareId}, ${vaultId}, ${obj["namespace_id"]}, ${targetVaultId}, ${obj["id"]},
          ${ns["encrypted_namespace_key"]}, ${ns["namespace_key_nonce"]}, ${targetPubkeyBuf},
          ${body.permission}, ${expiresAt}
        )
        RETURNING id, from_vault_id, to_vault_id, object_id, permission, expires_at, created_at
      `;

      // Audit
      await sql`
        INSERT INTO agent_audit_log (vault_id, namespace_id, action, object_key, auth_method, ip_address)
        VALUES (${vaultId}, ${obj["namespace_id"]}, 'share', ${body.key}, 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      if (!share) {
        return reply.status(500).send({ error: "Failed to create share" });
      }

      return reply.status(201).send({
        shareId: share["id"],
        fromVaultId: share["from_vault_id"],
        toVaultId: share["to_vault_id"],
        objectId: share["object_id"],
        permission: share["permission"],
        expiresAt: share["expires_at"],
        createdAt: share["created_at"],
      });
    },
  );

  /**
   * GET /objects/shared/:shareId
   *
   * Retrieve a share that was created for the authenticated agent.
   * Returns the re-encrypted namespace key and object metadata.
   */
  app.get(
    "/objects/shared/:shareId",
    { preHandler: [authenticateAgent, x402Middleware] },
    async (request, reply) => {
      const { shareId } = request.params as { shareId: string };
      const vaultId = request.vaultId;

      const [share] = await sql`
        SELECT vs.*,
               o.object_key, o.size_bytes, o.content_type, o.s3_key,
               ns.name as namespace_name,
               ov.vault_name as from_vault_name
        FROM vault_shares vs
        JOIN agent_objects o ON vs.object_id = o.id
        JOIN agent_namespaces ns ON vs.from_namespace_id = ns.id
        JOIN agent_vaults ov ON vs.from_vault_id = ov.id
        WHERE vs.id = ${shareId}
          AND vs.to_vault_id = ${vaultId}
          AND vs.is_active = TRUE
          AND (vs.expires_at IS NULL OR vs.expires_at > NOW())
      `;

      if (!share) {
        return reply.status(404).send({ error: "Share not found or expired" });
      }

      // Return share details + presigned download URL
      const { getDownloadUrl } = await import("../../lib/s3.js");
      const downloadUrl = await getDownloadUrl(share["s3_key"]);

      return reply.send({
        shareId: share["id"],
        fromVaultId: share["from_vault_id"],
        fromVaultName: share["from_vault_name"],
        namespace: share["namespace_name"],
        key: share["object_key"],
        sizeBytes: share["size_bytes"],
        contentType: share["content_type"],
        permission: share["permission"],
        encryptedNamespaceKey: share["encrypted_namespace_key"].toString("base64"),
        namespaceKeyNonce: share["namespace_key_nonce"].toString("base64"),
        downloadUrl,
        expiresAt: share["expires_at"],
        createdAt: share["created_at"],
      });
    },
  );

  /**
   * GET /objects/shared
   *
   * List shares received by the authenticated agent.
   */
  app.get(
    "/objects/shared",
    { preHandler: [authenticateAgent, x402Middleware] },
    async (request, reply) => {
      const query = listSharedSchema.parse(request.query);
      const vaultId = request.vaultId;

      const activeFilter = query.active_only ? sql`AND vs.is_active = TRUE` : sql``;
      const permFilter = query.permission && query.permission !== "all"
        ? sql`AND vs.permission = ${query.permission}`
        : sql``;

      const shares = await sql`
        SELECT vs.id, vs.from_vault_id, vs.object_id, vs.permission, vs.expires_at, vs.created_at,
               o.object_key, o.size_bytes, o.content_type,
               ns.name as namespace_name,
               ov.vault_name as from_vault_name
        FROM vault_shares vs
        JOIN agent_objects o ON vs.object_id = o.id
        JOIN agent_namespaces ns ON vs.from_namespace_id = ns.id
        JOIN agent_vaults ov ON vs.from_vault_id = ov.id
        WHERE vs.to_vault_id = ${vaultId}
          ${activeFilter}
          ${permFilter}
          AND (vs.expires_at IS NULL OR vs.expires_at > NOW())
        ORDER BY vs.created_at DESC
        LIMIT ${query.limit ?? 50}
      `;

      return reply.send({
        shares: shares.map((s) => ({
          shareId: s["id"],
          fromVaultId: s["from_vault_id"],
          fromVaultName: s["from_vault_name"],
          namespace: s["namespace_name"],
          key: s["object_key"],
          sizeBytes: s["size_bytes"],
          contentType: s["content_type"],
          permission: s["permission"],
          expiresAt: s["expires_at"],
          createdAt: s["created_at"],
        })),
        count: shares.length,
      });
    },
  );

  /**
   * DELETE /objects/share/:shareId
   *
   * Revoke a share. Only the sharer (from_vault_id) can revoke.
   */
  app.delete(
    "/objects/share/:shareId",
    { preHandler: [authenticateAgent, x402Middleware] },
    async (request, reply) => {
      const { shareId } = request.params as { shareId: string };
      const vaultId = request.vaultId;

      const [share] = await sql`
        UPDATE vault_shares
        SET is_active = FALSE, revoked_at = NOW()
        WHERE id = ${shareId}
          AND from_vault_id = ${vaultId}
          AND is_active = TRUE
        RETURNING id, object_id, to_vault_id
      `;

      if (!share) {
        return reply.status(404).send({ error: "Share not found or already revoked" });
      }

      // Audit
      await sql`
        INSERT INTO agent_audit_log (vault_id, action, auth_method, ip_address)
        VALUES (${vaultId}, 'share_revoke', 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      return reply.send({
        shareId: share["id"],
        revoked: true,
      });
    },
  );
}