/**
 * Agent Object Routes
 *
 * POST   /v1/agent/objects/store        — Store an object (get presigned upload URL)
 * POST   /v1/agent/objects/store/direct  — Store small objects directly (< 1MB, base64)
 * GET    /v1/agent/objects/retrieve       — Retrieve an object (get presigned download URL)
 * GET    /v1/agent/objects/list           — List objects in a namespace
 * DELETE /v1/agent/objects/delete         — Delete an object
 *
 * All operations require agent JWT auth.
 * Objects are stored as encrypted blobs on OVH S3.
 * The server never sees plaintext content.
 *
 * Two storage modes:
 * 1. Presigned URL: client encrypts, uploads directly to S3 (large files)
 * 2. Direct: client sends base64-encoded encrypted blob via API (small files, MCP-friendly)
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { sql } from "../../db/connection.js";
import { authenticateAgent } from "../../middleware/auth-agent.js";
import { s3, generateS3Key, getUploadUrl, getDownloadUrl } from "../../lib/s3.js";

const MAX_DIRECT_UPLOAD_BYTES = 1024 * 1024; // 1 MB for direct uploads
const S3_AGENT_PREFIX = "agents"; // S3 key prefix: agents/{vaultId}/{namespace}/{objectId}

// ── Validation schemas ──

const storeSchema = z.object({
  namespace: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  key: z.string().min(1).max(500),
  sizeBytes: z.number().int().min(1).optional(), // Required for presigned URL mode
  contentType: z.string().max(200).optional(),
  ttl: z.number().int().min(0).optional(), // 0 = permanent
});

const storeDirectSchema = z.object({
  namespace: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  key: z.string().min(1).max(500),
  data: z.string().min(1), // Base64-encoded encrypted blob
  contentType: z.string().max(200).optional(),
  ttl: z.number().int().min(0).optional(),
});

const retrieveSchema = z.object({
  namespace: z.string().min(1).max(100),
  key: z.string().min(1).max(500),
});

const listSchema = z.object({
  namespace: z.string().min(1).max(100),
  prefix: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
  cursor: z.string().optional(), // Pagination cursor
});

const deleteSchema = z.object({
  namespace: z.string().min(1).max(100),
  key: z.string().min(1).max(500),
});

// ── Helper: S3 key for agent objects ──

function agentS3Key(vaultId: string, namespace: string, objectId: string): string {
  return `${S3_AGENT_PREFIX}/${vaultId}/${namespace}/${objectId}`;
}

// ── Routes ──

export async function agentObjectRoutes(app: FastifyInstance) {

  /**
   * POST /v1/agent/objects/store
   *
   * Get a presigned upload URL for storing an encrypted object.
   * The agent encrypts the data client-side, then uploads directly to S3.
   * After upload, the agent calls /confirm to register the object.
   */
  app.post(
    "/objects/store",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const body = storeSchema.parse(request.body);
      const vaultId = request.vaultId;

      // Verify namespace exists and belongs to vault
      const [ns] = await sql`
        SELECT id, default_ttl_seconds FROM agent_namespaces
        WHERE vault_id = ${vaultId} AND name = ${body.namespace}
      `;

      if (!ns) {
        return reply.status(404).send({ error: `Namespace '${body.namespace}' not found` });
      }

      // Check storage quota
      const [vault] = await sql`
        SELECT v.storage_used_bytes, p.storage_bytes as plan_limit
        FROM agent_vaults v
        LEFT JOIN plans p ON v.plan_id = p.id
        WHERE v.id = ${vaultId}
      `;

      if (vault && body.sizeBytes) {
        const used = Number(vault["storage_used_bytes"]);
        const limit = Number(vault["plan_limit"]);
        if (limit > 0 && used + body.sizeBytes > limit) {
          return reply.status(413).send({
            error: "Storage quota exceeded",
            usedBytes: used,
            limitBytes: limit,
          });
        }
      }

      // Generate object ID and S3 key
      const objectId = randomUUID();
      const s3Key = agentS3Key(vaultId, body.namespace, objectId);

      // Get presigned upload URL
      const uploadUrl = await getUploadUrl(s3Key);

      // Store pending object (confirmed after upload)
      const ttl = body.ttl ?? ns["default_ttl_seconds"] ?? 0;
      const expiresAt = ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null;

      const [obj] = await sql`
        INSERT INTO agent_objects (
          id, vault_id, namespace_id, object_key,
          s3_key, size_bytes, content_type,
          ttl_seconds, expires_at,
          upload_status
        ) VALUES (
          ${objectId}, ${vaultId}, ${ns["id"]}, ${body.key},
          ${s3Key}, ${body.sizeBytes || 0}, ${body.contentType || null},
          ${ttl}, ${expiresAt},
          'pending'
        ) RETURNING id, upload_token
      `;

      return reply.send({
        objectId: obj!["id"],
        uploadUrl,
        uploadToken: obj!["upload_token"],
        s3Key,
      });
    },
  );

  /**
   * POST /v1/agent/objects/confirm
   *
   * Confirm that an object was uploaded to S3.
   * Called after the agent completes the presigned URL upload.
   */
  app.post(
    "/objects/confirm",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const { objectId, uploadToken, sizeBytes } = z.object({
        objectId: z.string().uuid(),
        uploadToken: z.string().min(1),
        sizeBytes: z.number().int().min(0).optional(),
      }).parse(request.body);

      const vaultId = request.vaultId;

      // Verify object and token
      const [obj] = await sql`
        UPDATE agent_objects
        SET upload_status = 'confirmed',
            size_bytes = COALESCE(${sizeBytes}, size_bytes),
            confirmed_at = NOW()
        WHERE id = ${objectId}
          AND vault_id = ${vaultId}
          AND upload_token = ${uploadToken}
          AND upload_status = 'pending'
        RETURNING id, namespace_id, object_key, size_bytes
      `;

      if (!obj) {
        return reply.status(404).send({ error: "Object not found or already confirmed" });
      }

      // Update namespace and vault storage counters
      await sql`
        UPDATE agent_namespaces
        SET storage_used_bytes = storage_used_bytes + ${obj["size_bytes"]},
            object_count = object_count + 1
        WHERE id = ${obj["namespace_id"]}
      `;

      await sql`
        UPDATE agent_vaults
        SET storage_used_bytes = storage_used_bytes + ${obj["size_bytes"]},
            object_count = object_count + 1
        WHERE id = ${vaultId}
      `;

      // Audit
      await sql`
        INSERT INTO agent_audit_log (vault_id, namespace_id, action, object_key, size_bytes, auth_method, ip_address)
        VALUES (${vaultId}, ${obj["namespace_id"]}, 'store', ${obj["object_key"]}, ${obj["size_bytes"]}, 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      return reply.send({
        objectId: obj["id"],
        key: obj["object_key"],
        sizeBytes: obj["size_bytes"],
        confirmed: true,
      });
    },
  );

  /**
   * POST /v1/agent/objects/store/direct
   *
   * Store small objects directly via API (base64-encoded).
   * This is the MCP-friendly endpoint: the agent sends data in one request.
   * Size limit: 1 MB (encrypted).
   */
  app.post(
    "/objects/store/direct",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const body = storeDirectSchema.parse(request.body);
      const vaultId = request.vaultId;

      // Check size
      const dataBytes = Buffer.from(body.data, "base64");
      if (dataBytes.length > MAX_DIRECT_UPLOAD_BYTES) {
        return reply.status(413).send({
          error: `Direct upload limited to ${MAX_DIRECT_UPLOAD_BYTES / 1024} KB. Use presigned URL for larger objects.`,
        });
      }

      // Verify namespace
      const [ns] = await sql`
        SELECT id, default_ttl_seconds FROM agent_namespaces
        WHERE vault_id = ${vaultId} AND name = ${body.namespace}
      `;

      if (!ns) {
        return reply.status(404).send({ error: `Namespace '${body.namespace}' not found` });
      }

      // Check quota
      const [vault] = await sql`
        SELECT v.storage_used_bytes, p.storage_bytes as plan_limit
        FROM agent_vaults v
        LEFT JOIN plans p ON v.plan_id = p.id
        WHERE v.id = ${vaultId}
      `;

      if (vault) {
        const used = Number(vault["storage_used_bytes"]);
        const limit = Number(vault["plan_limit"]);
        if (limit > 0 && used + dataBytes.length > limit) {
          return reply.status(413).send({
            error: "Storage quota exceeded",
            usedBytes: used,
            limitBytes: limit,
          });
        }
      }

      // Upload to S3
      const objectId = randomUUID();
      const s3Key = agentS3Key(vaultId, body.namespace, objectId);

      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      await s3.send(new PutObjectCommand({
        Bucket: process.env["S3_BUCKET"] ?? "serac-files",
        Key: s3Key,
        Body: dataBytes,
        ContentType: body.contentType || "application/octet-stream",
      }));

      // Store metadata
      const ttl = body.ttl ?? ns["default_ttl_seconds"] ?? 0;
      const expiresAt = ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null;

      await sql`
        INSERT INTO agent_objects (
          id, vault_id, namespace_id, object_key,
          s3_key, size_bytes, content_type,
          ttl_seconds, expires_at,
          upload_status, confirmed_at
        ) VALUES (
          ${objectId}, ${vaultId}, ${ns["id"]}, ${body.key},
          ${s3Key}, ${dataBytes.length}, ${body.contentType || null},
          ${ttl}, ${expiresAt},
          'confirmed', NOW()
        )
      `;

      // Update counters
      await sql`
        UPDATE agent_namespaces
        SET storage_used_bytes = storage_used_bytes + ${dataBytes.length},
            object_count = object_count + 1
        WHERE id = ${ns["id"]}
      `;

      await sql`
        UPDATE agent_vaults
        SET storage_used_bytes = storage_used_bytes + ${dataBytes.length},
            object_count = object_count + 1
        WHERE id = ${vaultId}
      `;

      // Audit
      await sql`
        INSERT INTO agent_audit_log (vault_id, namespace_id, action, object_key, size_bytes, auth_method, ip_address)
        VALUES (${vaultId}, ${ns["id"]}, 'store', ${body.key}, ${dataBytes.length}, 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      return reply.status(201).send({
        objectId,
        key: body.key,
        namespace: body.namespace,
        sizeBytes: dataBytes.length,
      });
    },
  );

  /**
   * GET /v1/agent/objects/retrieve?namespace=...&key=...
   *
   * Get a presigned download URL for an encrypted object.
   */
  app.get(
    "/objects/retrieve",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const { namespace, key } = retrieveSchema.parse(request.query);
      const vaultId = request.vaultId;

      const [obj] = await sql`
        SELECT o.id, o.s3_key, o.size_bytes, o.content_type, o.created_at
        FROM agent_objects o
        JOIN agent_namespaces ns ON o.namespace_id = ns.id
        WHERE o.vault_id = ${vaultId}
          AND ns.name = ${namespace}
          AND o.object_key = ${key}
          AND o.upload_status = 'confirmed'
          AND (o.expires_at IS NULL OR o.expires_at > NOW())
          AND o.deleted_at IS NULL
      `;

      if (!obj) {
        return reply.status(404).send({ error: "Object not found" });
      }

      const downloadUrl = await getDownloadUrl(obj["s3_key"]);

      // Audit
      await sql`
        INSERT INTO agent_audit_log (vault_id, namespace_id, action, object_key, size_bytes, auth_method, ip_address)
        VALUES (${vaultId}, (SELECT id FROM agent_namespaces WHERE name = ${namespace} AND vault_id = ${vaultId}),
                'retrieve', ${key}, ${obj["size_bytes"]}, 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      return reply.send({
        downloadUrl,
        sizeBytes: obj["size_bytes"],
        contentType: obj["content_type"],
        createdAt: obj["created_at"],
      });
    },
  );

  /**
   * GET /v1/agent/objects/list?namespace=...&prefix=...&limit=...
   *
   * List objects in a namespace with optional prefix filter.
   */
  app.get(
    "/objects/list",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const { namespace, prefix, limit } = listSchema.parse(request.query);
      const vaultId = request.vaultId;

      const prefixFilter = prefix ? `${prefix}%` : "%";

      const objects = await sql`
        SELECT o.object_key, o.size_bytes, o.content_type,
               o.created_at, o.expires_at
        FROM agent_objects o
        JOIN agent_namespaces ns ON o.namespace_id = ns.id
        WHERE o.vault_id = ${vaultId}
          AND ns.name = ${namespace}
          AND o.object_key LIKE ${prefixFilter}
          AND o.upload_status = 'confirmed'
          AND (o.expires_at IS NULL OR o.expires_at > NOW())
          AND o.deleted_at IS NULL
        ORDER BY o.object_key ASC
        LIMIT ${limit}
      `;

      return reply.send({
        namespace,
        objects: objects.map((o) => ({
          key: o["object_key"],
          sizeBytes: o["size_bytes"],
          contentType: o["content_type"],
          createdAt: o["created_at"],
          expiresAt: o["expires_at"],
        })),
        count: objects.length,
      });
    },
  );

  /**
   * DELETE /v1/agent/objects/delete
   *
   * Soft-delete an object (mark as deleted, schedule cleanup).
   * Hard delete happens asynchronously via cleanup scheduler.
   */
  app.delete(
    "/objects/delete",
    { preHandler: authenticateAgent },
    async (request, reply) => {
      const { namespace, key } = deleteSchema.parse(request.body);
      const vaultId = request.vaultId;

      const [obj] = await sql`
        UPDATE agent_objects
        SET deleted_at = NOW()
        WHERE vault_id = ${vaultId}
          AND namespace_id = (SELECT id FROM agent_namespaces WHERE name = ${namespace} AND vault_id = ${vaultId})
          AND object_key = ${key}
          AND deleted_at IS NULL
        RETURNING id, size_bytes, namespace_id
      `;

      if (!obj) {
        return reply.status(404).send({ error: "Object not found" });
      }

      // Update counters
      await sql`
        UPDATE agent_namespaces
        SET storage_used_bytes = GREATEST(0, storage_used_bytes - ${obj["size_bytes"]}),
            object_count = GREATEST(0, object_count - 1)
        WHERE id = ${obj["namespace_id"]}
      `;

      await sql`
        UPDATE agent_vaults
        SET storage_used_bytes = GREATEST(0, storage_used_bytes - ${obj["size_bytes"]}),
            object_count = GREATEST(0, object_count - 1)
        WHERE id = ${vaultId}
      `;

      // Audit
      await sql`
        INSERT INTO agent_audit_log (vault_id, namespace_id, action, object_key, auth_method, ip_address)
        VALUES (${vaultId}, ${obj["namespace_id"]}, 'delete', ${key}, 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      return reply.send({ deleted: true, key });
    },
  );
}