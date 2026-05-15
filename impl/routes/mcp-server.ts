/**
 * MCP Server Endpoint — HTTP Streamable Transport
 *
 * Endpoint: POST /mcp/v1
 *
 * Implements the MCP (Model Context Protocol) HTTP Streamable transport
 * as defined in the spec (2025-03 draft).
 *
 * No external MCP SDK dependency — we implement the protocol directly
 * using Fastify. This avoids the supply chain risk of @modelcontextprotocol/sdk.
 *
 * The MCP server exposes 5 tools (V1):
 *   1. serac_store    — Store encrypted data in a namespace
 *   2. serac_retrieve — Retrieve encrypted data by key
 *   3. serac_list     — List keys in a namespace
 *   4. serac_delete   — Delete a key from namespace
 *   5. serac_quota    — Check storage usage and limits
 *
 * Protocol flow:
 *   1. Client sends POST with JSON-RPC request
 *   2. Server authenticates via Bearer token (agent JWT)
 *   3. Server processes the MCP method (tools/call, tools/list, initialize)
 *   4. Server returns JSON-RPC response
 *
 * Reference: https://modelcontextprotocol.io/specification/draft/server
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { sql } from "../../db/connection.js";
import { redis } from "../../lib/redis.js";
import { jwtVerify } from "jose";
import { JWT_SECRET } from "../../lib/jwt.js";

// ── MCP Protocol Types ──

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ── MCP Error Codes ──

const MCP_ERRORS = {
  PARSE_ERROR: { code: -32700, message: "Parse error" },
  INVALID_REQUEST: { code: -32600, message: "Invalid request" },
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
  INVALID_PARAMS: { code: -32602, message: "Invalid params" },
  INTERNAL_ERROR: { code: -32603, message: "Internal error" },
  UNAUTHORIZED: { code: -32001, message: "Unauthorized" },
  FORBIDDEN: { code: -32003, message: "Forbidden" },
  NOT_FOUND: { code: -32004, message: "Not found" },
  QUOTA_EXCEEDED: { code: -32005, message: "Storage quota exceeded" },
} as const;

// ── Tool Definitions ──

const TOOLS = [
  {
    name: "serac_store",
    description: "Store encrypted data in an isolated namespace on OVHCloud France. Data must be base64-encoded and client-side encrypted.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Namespace name (e.g. 'memory', 'skills', 'work')" },
        key: { type: "string", description: "Storage key (e.g. 'user:preferences')" },
        data: { type: "string", description: "Base64-encoded encrypted data" },
        ttl: { type: "number", description: "TTL in seconds (0 = permanent)" },
      },
      required: ["namespace", "key", "data"],
    },
  },
  {
    name: "serac_retrieve",
    description: "Retrieve encrypted data from your namespace by key",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Namespace name" },
        key: { type: "string", description: "Storage key to retrieve" },
      },
      required: ["namespace", "key"],
    },
  },
  {
    name: "serac_list",
    description: "List keys in a namespace with optional prefix filter",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Namespace name" },
        prefix: { type: "string", description: "Key prefix filter" },
        limit: { type: "number", description: "Max results (default 100, max 1000)" },
      },
      required: ["namespace"],
    },
  },
  {
    name: "serac_delete",
    description: "Delete a key from your namespace",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Namespace name" },
        key: { type: "string", description: "Storage key to delete" },
      },
      required: ["namespace", "key"],
    },
  },
  {
    name: "serac_quota",
    description: "Check your storage usage and plan limits",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

// ── Auth Helper ──

async function authenticateMcpRequest(request: any): Promise<{ vaultId: string } | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (payload.type !== "agent" || !payload.sub) return null;

    // Check vault active
    const [vault] = await sql`
      SELECT id FROM agent_vaults WHERE id = ${payload.sub} AND is_active = TRUE
    `;
    if (!vault) return null;

    return { vaultId: payload.sub };
  } catch {
    return null;
  }
}

// ── Tool Implementations ──

async function toolStore(vaultId: string, params: Record<string, unknown>, ip: string) {
  const schema = z.object({
    namespace: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
    key: z.string().min(1).max(500),
    data: z.string().min(1),
    ttl: z.number().int().min(0).optional(),
  });

  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    return { error: { ...MCP_ERRORS.INVALID_PARAMS, data: parsed.error.issues } };
  }

  const { namespace, key, data, ttl } = parsed.data;
  const dataBytes = Buffer.from(data, "base64");

  // 1 MB limit for MCP direct upload
  if (dataBytes.length > 1024 * 1024) {
    return { error: { code: -32006, message: "Data too large for MCP (max 1 MB). Use REST API with presigned URLs." } };
  }

  // Get namespace
  const [ns] = await sql`
    SELECT id, default_ttl_seconds FROM agent_namespaces
    WHERE vault_id = ${vaultId} AND name = ${namespace}
  `;
  if (!ns) return { error: { ...MCP_ERRORS.NOT_FOUND, message: `Namespace '${namespace}' not found` } };

  // Check quota
  const [vault] = await sql`
    SELECT v.storage_used_bytes, p.storage_bytes as plan_limit
    FROM agent_vaults v LEFT JOIN plans p ON v.plan_id = p.id
    WHERE v.id = ${vaultId}
  `;
  if (vault) {
    const used = Number(vault["storage_used_bytes"]);
    const limit = Number(vault["plan_limit"]);
    if (limit > 0 && used + dataBytes.length > limit) {
      return { error: { ...MCP_ERRORS.QUOTA_EXCEEDED, data: { usedBytes: used, limitBytes: limit } } };
    }
  }

  // Check if key already exists (upsert)
  const [existing] = await sql`
    SELECT id, size_bytes FROM agent_objects
    WHERE vault_id = ${vaultId} AND namespace_id = ${ns["id"]}
      AND object_key = ${key} AND deleted_at IS NULL
  `;

  // Upload to S3
  const objectId = existing ? existing["id"] : randomUUID();
  const s3Key = `agents/${vaultId}/${namespace}/${objectId}`;

  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { s3 } = await import("../../lib/s3.js");
  await s3.send(new PutObjectCommand({
    Bucket: process.env["S3_BUCKET"] ?? "serac-files",
    Key: s3Key,
    Body: dataBytes,
  }));

  const effectiveTtl = ttl ?? ns["default_ttl_seconds"] ?? 0;
  const expiresAt = effectiveTtl > 0 ? new Date(Date.now() + effectiveTtl * 1000).toISOString() : null;

  if (existing) {
    // Update existing object
    const sizeDiff = dataBytes.length - Number(existing["size_bytes"]);
    await sql`
      UPDATE agent_objects
      SET s3_key = ${s3Key}, size_bytes = ${dataBytes.length},
          ttl_seconds = ${effectiveTtl}, expires_at = ${expiresAt},
          updated_at = NOW()
      WHERE id = ${existing["id"]}
    `;
    // Adjust counters
    await sql`
      UPDATE agent_namespaces SET storage_used_bytes = storage_used_bytes + ${sizeDiff}
      WHERE id = ${ns["id"]}
    `;
    await sql`
      UPDATE agent_vaults SET storage_used_bytes = storage_used_bytes + ${sizeDiff}
      WHERE id = ${vaultId}
    `;
  } else {
    // Insert new object
    await sql`
      INSERT INTO agent_objects (
        id, vault_id, namespace_id, object_key,
        s3_key, size_bytes, ttl_seconds, expires_at,
        upload_status, confirmed_at
      ) VALUES (
        ${objectId}, ${vaultId}, ${ns["id"]}, ${key},
        ${s3Key}, ${dataBytes.length}, ${effectiveTtl}, ${expiresAt},
        'confirmed', NOW()
      )
    `;
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
  }

  // Audit
  await sql`
    INSERT INTO agent_audit_log (vault_id, namespace_id, action, object_key, size_bytes, auth_method, ip_address)
    VALUES (${vaultId}, ${ns["id"]}, 'store', ${key}, ${dataBytes.length}, 'api_key', ${ip}::inet)
  `.catch(() => {});

  return {
    result: {
      key,
      namespace,
      sizeBytes: dataBytes.length,
      objectId,
      upserted: !!existing,
    },
  };
}

async function toolRetrieve(vaultId: string, params: Record<string, unknown>, ip: string) {
  const schema = z.object({
    namespace: z.string().min(1),
    key: z.string().min(1),
  });

  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    return { error: { ...MCP_ERRORS.INVALID_PARAMS, data: parsed.error.issues } };
  }

  const { namespace, key } = parsed.data;

  const [obj] = await sql`
    SELECT o.s3_key, o.size_bytes, o.content_type, o.created_at
    FROM agent_objects o
    JOIN agent_namespaces ns ON o.namespace_id = ns.id
    WHERE o.vault_id = ${vaultId} AND ns.name = ${namespace}
      AND o.object_key = ${key}
      AND o.upload_status = 'confirmed'
      AND (o.expires_at IS NULL OR o.expires_at > NOW())
      AND o.deleted_at IS NULL
  `;

  if (!obj) return { error: { ...MCP_ERRORS.NOT_FOUND, message: `Object '${key}' not found in namespace '${namespace}'` } };

  // For MCP, we download the encrypted blob and return it as base64
  // This is the "direct" mode — works for small objects
  if (Number(obj["size_bytes"]) > 1024 * 1024) {
    // Return presigned URL for large objects
    const { getDownloadUrl } = await import("../../lib/s3.js");
    const downloadUrl = await getDownloadUrl(obj["s3_key"]);
    return {
      result: {
        key,
        namespace,
        sizeBytes: obj["size_bytes"],
        downloadUrl,
        mode: "presigned",
      },
    };
  }

  // Download small objects directly
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { s3 } = await import("../../lib/s3.js");
  const response = await s3.send(new GetObjectCommand({
    Bucket: process.env["S3_BUCKET"] ?? "serac-files",
    Key: obj["s3_key"],
  }));

  const bodyBytes = await response.Body!.transformToByteArray();
  const base64Data = Buffer.from(bodyBytes).toString("base64");

  // Audit
  await sql`
    INSERT INTO agent_audit_log (vault_id, namespace_id, action, object_key, size_bytes, auth_method, ip_address)
    VALUES (${vaultId}, (SELECT id FROM agent_namespaces WHERE name = ${namespace} AND vault_id = ${vaultId}),
            'retrieve', ${key}, ${obj["size_bytes"]}, 'api_key', ${ip}::inet)
  `.catch(() => {});

  return {
    result: {
      key,
      namespace,
      data: base64Data,
      sizeBytes: obj["size_bytes"],
      mode: "direct",
    },
  };
}

async function toolList(vaultId: string, params: Record<string, unknown>) {
  const schema = z.object({
    namespace: z.string().min(1),
    prefix: z.string().optional(),
    limit: z.number().int().min(1).max(1000).default(100),
  });

  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    return { error: { ...MCP_ERRORS.INVALID_PARAMS, data: parsed.error.issues } };
  }

  const { namespace, prefix, limit } = parsed.data;
  const prefixFilter = prefix ? `${prefix}%` : "%";

  const objects = await sql`
    SELECT o.object_key, o.size_bytes, o.created_at, o.expires_at
    FROM agent_objects o
    JOIN agent_namespaces ns ON o.namespace_id = ns.id
    WHERE o.vault_id = ${vaultId} AND ns.name = ${namespace}
      AND o.object_key LIKE ${prefixFilter}
      AND o.upload_status = 'confirmed'
      AND (o.expires_at IS NULL OR o.expires_at > NOW())
      AND o.deleted_at IS NULL
    ORDER BY o.object_key ASC
    LIMIT ${limit}
  `;

  return {
    result: {
      namespace,
      keys: objects.map((o) => ({
        key: o["object_key"],
        sizeBytes: o["size_bytes"],
        createdAt: o["created_at"],
      })),
      count: objects.length,
    },
  };
}

async function toolDelete(vaultId: string, params: Record<string, unknown>, ip: string) {
  const schema = z.object({
    namespace: z.string().min(1),
    key: z.string().min(1),
  });

  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    return { error: { ...MCP_ERRORS.INVALID_PARAMS, data: parsed.error.issues } };
  }

  const { namespace, key } = parsed.data;

  const [obj] = await sql`
    UPDATE agent_objects SET deleted_at = NOW()
    WHERE vault_id = ${vaultId}
      AND namespace_id = (SELECT id FROM agent_namespaces WHERE name = ${namespace} AND vault_id = ${vaultId})
      AND object_key = ${key} AND deleted_at IS NULL
    RETURNING id, size_bytes, namespace_id
  `;

  if (!obj) return { error: { ...MCP_ERRORS.NOT_FOUND, message: `Object '${key}' not found` } };

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
    VALUES (${vaultId}, ${obj["namespace_id"]}, 'delete', ${key}, 'api_key', ${ip}::inet)
  `.catch(() => {});

  return { result: { deleted: true, key } };
}

async function toolQuota(vaultId: string) {
  const [vault] = await sql`
    SELECT v.storage_used_bytes, v.object_count,
           p.name as plan_name, p.display_name, p.storage_bytes
    FROM agent_vaults v
    LEFT JOIN plans p ON v.plan_id = p.id
    WHERE v.id = ${vaultId}
  `;

  if (!vault) return { error: MCP_ERRORS.NOT_FOUND };

  const usedBytes = Number(vault["storage_used_bytes"]);
  const limitBytes = Number(vault["storage_bytes"] || 0);

  return {
    result: {
      storage: {
        usedBytes,
        limitBytes,
        usagePercent: limitBytes > 0 ? Math.round((usedBytes / limitBytes) * 10000) / 100 : 0,
      },
      objects: { count: Number(vault["object_count"]) },
      plan: {
        name: vault["plan_name"],
        displayName: vault["display_name"],
      },
    },
  };
}

// ── MCP Route Handler ──

export async function mcpServerRoutes(app: FastifyInstance) {
  /**
   * POST /mcp/v1
   *
   * MCP HTTP Streamable endpoint.
   * Handles JSON-RPC 2.0 requests for MCP protocol methods.
   */
  app.post("/mcp/v1", {
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute" },
    },
  }, async (request, reply) => {
    // ── Authenticate ──
    const auth = await authenticateMcpRequest(request);
    if (!auth) {
      return reply.status(401).send({
        jsonrpc: "2.0",
        id: null,
        error: MCP_ERRORS.UNAUTHORIZED,
      });
    }

    const { vaultId } = auth;
    const ip = request.ip;

    // ── Parse JSON-RPC ──
    let rpcRequest: JsonRpcRequest;
    try {
      rpcRequest = request.body as JsonRpcRequest;
      if (rpcRequest.jsonrpc !== "2.0") throw new Error("Not JSON-RPC 2.0");
    } catch {
      return reply.send({
        jsonrpc: "2.0",
        id: null,
        error: MCP_ERRORS.INVALID_REQUEST,
      });
    }

    const requestId = rpcRequest.id ?? null;

    // ── Route method ──
    try {
      switch (rpcRequest.method) {
        // ── Initialize ──
        case "initialize": {
          return reply.send({
            jsonrpc: "2.0",
            id: requestId,
            result: {
              protocolVersion: "2025-03-26",
              capabilities: {
                tools: { listChanged: false },
              },
              serverInfo: {
                name: "serac-storage",
                version: "1.0.0",
              },
            },
          } satisfies JsonRpcResponse);
        }

        // ── List tools ──
        case "tools/list": {
          return reply.send({
            jsonrpc: "2.0",
            id: requestId,
            result: { tools: TOOLS },
          } satisfies JsonRpcResponse);
        }

        // ── Call tool ──
        case "tools/call": {
          const { name, arguments: args } = (rpcRequest.params ?? {}) as {
            name: string;
            arguments?: Record<string, unknown>;
          };

          if (!name) {
            return reply.send({
              jsonrpc: "2.0",
              id: requestId,
              error: MCP_ERRORS.INVALID_PARAMS,
            });
          }

          let toolResult: { result?: unknown; error?: JsonRpcResponse["error"] };

          switch (name) {
            case "serac_store":
              toolResult = await toolStore(vaultId, args ?? {}, ip);
              break;
            case "serac_retrieve":
              toolResult = await toolRetrieve(vaultId, args ?? {}, ip);
              break;
            case "serac_list":
              toolResult = await toolList(vaultId, args ?? {});
              break;
            case "serac_delete":
              toolResult = await toolDelete(vaultId, args ?? {}, ip);
              break;
            case "serac_quota":
              toolResult = await toolQuota(vaultId);
              break;
            default:
              return reply.send({
                jsonrpc: "2.0",
                id: requestId,
                error: {
                  ...MCP_ERRORS.METHOD_NOT_FOUND,
                  message: `Unknown tool: ${name}`,
                },
              });
          }

          if (toolResult.error) {
            return reply.send({
              jsonrpc: "2.0",
              id: requestId,
              error: toolResult.error,
            });
          }

          return reply.send({
            jsonrpc: "2.0",
            id: requestId,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(toolResult.result, null, 2),
                },
              ],
            },
          } satisfies JsonRpcResponse);
        }

        // ── Ping ──
        case "ping": {
          return reply.send({
            jsonrpc: "2.0",
            id: requestId,
            result: {},
          });
        }

        // ── Unknown method ──
        default: {
          return reply.send({
            jsonrpc: "2.0",
            id: requestId,
            error: MCP_ERRORS.METHOD_NOT_FOUND,
          });
        }
      }
    } catch (err) {
      request.log.error(err, "MCP handler error");
      return reply.send({
        jsonrpc: "2.0",
        id: requestId,
        error: MCP_ERRORS.INTERNAL_ERROR,
      });
    }
  });

  /**
   * GET /mcp/v1 — SSE stream placeholder
   *
   * For future MCP notifications support (server → client push).
   * V1: not implemented, returns 501.
   */
  app.get("/mcp/v1", async (_request, reply) => {
    return reply.status(501).send({
      error: "SSE transport not yet implemented. Use POST for JSON-RPC.",
    });
  });
}