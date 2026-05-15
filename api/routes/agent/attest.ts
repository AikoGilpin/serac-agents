/**
 * Agent Attestation Routes — Ed25519 existence proofs for stored objects.
 *
 * GET /objects/:key/attest — Get a signed proof that an object exists/existed
 * GET /objects/attest/verify — Verify a proof (public, no auth)
 *
 * The attestation proves:
 * - An object with the given key existed in the given namespace at uploadedAt
 * - The proof is signed by the Serac service Ed25519 key
 * - Anyone can verify using the service's public key
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../../db/connection.js";
import { authenticateAgent } from "../../middleware/auth-agent.js";
import { x402Middleware } from "../../middleware/x402.js";
import {
  signWithServiceKey,
  computeAttestationHash,
  getServicePublicKeyB64,
  verifyWithServiceKey,
} from "../../lib/attestation.js";

const attestQuerySchema = z.object({
  namespace: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
});

const verifyQuerySchema = z.object({
  namespace: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  key: z.string().min(1).max(500),
  hashSha256: z.string().min(1),
  sizeBytes: z.coerce.number().int().min(0),
  uploadedAt: z.string().min(1),
  signature: z.string().min(1),
});

export async function agentAttestRoutes(app: FastifyInstance) {
  /**
   * GET /objects/:key/attest?namespace=...
   *
   * Generate a signed attestation for an object.
   * Proves the object existed at a specific timestamp.
   */
  app.get(
    "/objects/:key/attest",
    { preHandler: [authenticateAgent, x402Middleware] },
    async (request, reply) => {
      const { key } = request.params as { key: string };
      const query = attestQuerySchema.parse(request.query);
      const vaultId = request.vaultId;

      // Find the object
      const [obj] = await sql`
        SELECT o.id, o.object_key, o.size_bytes, o.content_type, o.upload_status,
               o.created_at, o.uploaded_at, ns.name as namespace_name
        FROM agent_objects o
        JOIN agent_namespaces ns ON o.namespace_id = ns.id
        WHERE o.vault_id = ${vaultId}
          AND ns.name = ${query.namespace}
          AND o.object_key = ${key}
          AND o.upload_status = 'confirmed'
          AND o.deleted_at IS NULL
          AND (o.archive_status = 'active' OR o.archive_status IS NULL)
      `;

      if (!obj) {
        return reply.status(404).send({ error: "Object not found" });
      }

      const uploadedAt = (obj["uploaded_at"] ?? obj["created_at"]).toISOString();
      const sizeBytes = obj["size_bytes"] as number;
      const namespace = obj["namespace_name"] as string;

      // Compute hash
      const hash = computeAttestationHash(namespace, key, sizeBytes, uploadedAt);

      // Sign with service Ed25519 key
      const signature = signWithServiceKey(hash);

      // Get the service public key
      const servicePublicKey = getServicePublicKeyB64();

      // Audit
      await sql`
        INSERT INTO agent_audit_log (vault_id, namespace_id, action, object_key, auth_method, ip_address)
        VALUES (${vaultId}, ${obj["id"]}, 'attest', ${key}, 'jwt', ${request.ip}::inet)
      `.catch(() => {});

      return reply.send({
        key,
        namespace,
        hashSha256: hash,
        sizeBytes,
        uploadedAt,
        ed25519Signature: signature,
        servicePublicKey,
        verifyUrl: `https://serac.cloud/api/agent/objects/attest/verify`,
      });
    },
  );

  /**
   * GET /objects/attest/verify — Verify an attestation proof (public, no auth)
   *
   * Query params: namespace, key, hashSha256, sizeBytes, uploadedAt, signature
   */
  app.get(
    "/objects/attest/verify",
    async (request, reply) => {
      const query = verifyQuerySchema.parse(request.query);

      // Recompute hash
      const computedHash = computeAttestationHash(
        query.namespace,
        query.key,
        query.sizeBytes,
        query.uploadedAt,
      );

      if (computedHash !== query.hashSha256) {
        return reply.status(400).send({ valid: false, error: "Hash mismatch — data may have been tampered" });
      }

      // Verify signature
      const valid = verifyWithServiceKey(query.hashSha256, query.signature);

      return reply.send({
        valid,
        namespace: query.namespace,
        key: query.key,
        sizeBytes: query.sizeBytes,
        uploadedAt: query.uploadedAt,
        servicePublicKey: getServicePublicKeyB64(),
      });
    },
  );
}