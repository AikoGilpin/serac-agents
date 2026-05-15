/**
 * Agent Archive Routes — Glacier storage class for cold storage.
 *
 * POST   /objects/:key/archive  — Move object to Glacier (DEEP_ARCHIVE)
 * POST   /objects/:key/restore  — Request restoration from Glacier
 * GET    /objects/:key/archive-status — Check archive/restore status
 *
 * Archive flow:
 * 1. Agent calls POST /archive → sets archive_status='archiving', copies S3 object to Glacier tier
 * 2. S3 copy changes storage class to DEEP_ARCHIVE (or configured class)
 * 3. Agent calls GET /archive-status → returns current status
 * 4. Agent calls POST /restore → sets archive_status='restoring', requests Glacier restore
 * 5. After 24-48h, GET /archive-status → returns 'active' and object is accessible again
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../../db/connection.js";
import { authenticateAgent } from "../../middleware/auth-agent.js";
import { x402Middleware } from "../../middleware/x402.js";
import {
  archiveToGlacier,
  restoreFromGlacier,
  getRestoreStatus,
} from "../../lib/s3.js";

const namespaceQuerySchema = z.object({
  namespace: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
});

export async function agentArchiveRoutes(app: FastifyInstance) {
  /**
   * POST /objects/:key/archive
   *
   * Archive an object to Glacier storage class.
   * Cheaper storage, but retrieval takes 12-48h.
   */
  app.post(
    "/objects/:key/archive",
    { preHandler: [authenticateAgent, x402Middleware] },
    async (request, reply) => {
      const { key } = request.params as { key: string };
      const query = namespaceQuerySchema.parse(request.query);
      const vaultId = request.vaultId;

      // Find the object
      const [obj] = await sql`
        SELECT o.id, o.object_key, o.size_bytes, o.s3_key, o.upload_status, o.archive_status
        FROM agent_objects o
        JOIN agent_namespaces ns ON o.namespace_id = ns.id
        WHERE o.vault_id = ${vaultId}
          AND ns.name = ${query.namespace}
          AND o.object_key = ${key}
          AND o.upload_status = 'confirmed'
          AND o.deleted_at IS NULL
      `;

      if (!obj) {
        return reply.status(404).send({ error: "Object not found" });
      }

      // Already archived or in progress
      const currentStatus = obj["archive_status"] as string ?? "active";
      if (currentStatus === "archiving" || currentStatus === "archived") {
        return reply.status(409).send({ error: `Object is already in '${currentStatus}' state` });
      }

      if (currentStatus === "restoring") {
        return reply.status(409).send({ error: "Object is currently being restored, cannot archive" });
      }

      // Set status to 'archiving'
      const s3Key = (obj["s3_key"] ?? `${vaultId}/${obj["id"]}`) as string;

      await sql`
        UPDATE agent_objects
        SET archive_status = 'archiving', updated_at = NOW()
        WHERE id = ${obj["id"]}
      `;

      // Perform S3 Glacier copy (async, but we wait for it)
      try {
        await archiveToGlacier(s3Key);
      } catch (err) {
        // Rollback status on failure
        await sql`
          UPDATE agent_objects
          SET archive_status = 'active', updated_at = NOW()
          WHERE id = ${obj["id"]}
        `;
        request.log.error({ err, s3Key }, "Failed to archive object to Glacier");
        return reply.status(500).send({ error: "Failed to archive object — S3 error" });
      }

      // Update status to 'archived'
      await sql`
        UPDATE agent_objects
        SET archive_status = 'archived', archived_at = NOW(), updated_at = NOW()
        WHERE id = ${obj["id"]}
      `;

      // Audit
      await sql`
        INSERT INTO agent_audit_log (vault_id, namespace_id, action, object_key, auth_method, ip_address)
        VALUES (${vaultId}, ${obj["id"]}, 'archive', ${key}, 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      return reply.send({
        key,
        namespace: query.namespace,
        archiveStatus: "archived",
        archivedAt: new Date().toISOString(),
        message: "Object archived to Glacier. Retrieval takes 12-48h.",
      });
    },
  );

  /**
   * POST /objects/:key/restore
   *
   * Request restoration of an archived object.
   * After restoration (12-48h), the object becomes accessible again.
   */
  app.post(
    "/objects/:key/restore",
    { preHandler: [authenticateAgent, x402Middleware] },
    async (request, reply) => {
      const { key } = request.params as { key: string };
      const query = namespaceQuerySchema.parse(request.query);
      const vaultId = request.vaultId;

      const [obj] = await sql`
        SELECT o.id, o.object_key, o.s3_key, o.archive_status
        FROM agent_objects o
        JOIN agent_namespaces ns ON o.namespace_id = ns.id
        WHERE o.vault_id = ${vaultId}
          AND ns.name = ${query.namespace}
          AND o.object_key = ${key}
          AND o.deleted_at IS NULL
      `;

      if (!obj) {
        return reply.status(404).send({ error: "Object not found" });
      }

      const currentStatus = obj["archive_status"] as string ?? "active";

      if (currentStatus === "active") {
        return reply.status(400).send({ error: "Object is not archived" });
      }

      if (currentStatus === "restoring") {
        return reply.status(409).send({ error: "Object restoration already in progress" });
      }

      if (currentStatus === "archiving") {
        return reply.status(409).send({ error: "Object is still being archived, try again later" });
      }

      const s3Key = (obj["s3_key"] ?? `${vaultId}/${obj["id"]}`) as string;

      // Set status to 'restoring'
      await sql`
        UPDATE agent_objects
        SET archive_status = 'restoring', restore_requested_at = NOW(), updated_at = NOW()
        WHERE id = ${obj["id"]}
      `;

      // Request Glacier restore (7-day temporary restore)
      try {
        await restoreFromGlacier(s3Key, 7);
      } catch (err) {
        // Don't rollback — restore request may have still been sent
        request.log.error({ err, s3Key }, "Failed to request Glacier restore");
      }

      // Audit
      await sql`
        INSERT INTO agent_audit_log (vault_id, namespace_id, action, object_key, auth_method, ip_address)
        VALUES (${vaultId}, ${obj["id"]}, 'restore', ${key}, 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      return reply.send({
        key,
        namespace: query.namespace,
        archiveStatus: "restoring",
        restoreRequestedAt: new Date().toISOString(),
        estimatedAvailableAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
        message: "Restoration requested. Object will be available within 12-48h.",
      });
    },
  );

  /**
   * GET /objects/:key/archive-status
   *
   * Check the current archive/restore status of an object.
   * For 'restoring' objects, polls S3 to check if ready.
   */
  app.get(
    "/objects/:key/archive-status",
    { preHandler: [authenticateAgent, x402Middleware] },
    async (request, reply) => {
      const { key } = request.params as { key: string };
      const query = namespaceQuerySchema.parse(request.query);
      const vaultId = request.vaultId;

      const [obj] = await sql`
        SELECT o.id, o.object_key, o.archive_status, o.archived_at, o.restore_requested_at, o.s3_key
        FROM agent_objects o
        JOIN agent_namespaces ns ON o.namespace_id = ns.id
        WHERE o.vault_id = ${vaultId}
          AND ns.name = ${query.namespace}
          AND o.object_key = ${key}
          AND o.deleted_at IS NULL
      `;

      if (!obj) {
        return reply.status(404).send({ error: "Object not found" });
      }

      const archiveStatus = (obj["archive_status"] as string) ?? "active";
      const s3Key = (obj["s3_key"] ?? `${vaultId}/${obj["id"]}`) as string;

      // If restoring, check S3 restore status
      if (archiveStatus === "restoring") {
        try {
          const restoreStatus = await getRestoreStatus(s3Key);
          if (restoreStatus === "ready") {
            // Transition back to active
            await sql`
              UPDATE agent_objects
              SET archive_status = 'active', updated_at = NOW()
              WHERE id = ${obj["id"]}
            `;
            return reply.send({
              key,
              namespace: query.namespace,
              archiveStatus: "active",
              restoredAt: new Date().toISOString(),
              message: "Object is now available",
            });
          }
        } catch {
          // S3 check failed, return DB status
        }
      }

      return reply.send({
        key,
        namespace: query.namespace,
        archiveStatus,
        archivedAt: (obj["archived_at"] as Date)?.toISOString() ?? null,
        restoreRequestedAt: (obj["restore_requested_at"] as Date)?.toISOString() ?? null,
      });
    },
  );
}