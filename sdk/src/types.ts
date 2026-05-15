/**
 * Serac Agent SDK — Types
 * Sovereign E2EE cloud storage for AI agents
 */

// ─── Auth ───────────────────────────────────────────────────────────────────

export interface RegisterOptions {
  /** Agent name (3-64 chars, alphanumeric + dash/underscore) */
  agentName: string;
  /** Ed25519 public key (base64, 32 bytes) */
  ed25519PublicKey: string;
  /** X25519 public key (base64, 32 bytes) for sealed-box encryption */
  x25519PublicKey: string;
  /** Master Key encrypted via sealed box with agent's X25519 pubkey (base64) */
  encryptedMasterKey: string;
  /** Nonce used for sealed-box encryption of master key (base64, 24 bytes) */
  masterKeyNonce: string;
  /** BLAKE2b-256 commitment hash of the master key (base64, 32 bytes) */
  keyCommitment: string;
  /** Plan tier */
  tier?: AgentTier;
  /** Optional: email of the human owner */
  ownerEmail?: string;
  /** Optional: webhook URL for notifications */
  webhookUrl?: string;
  /** Optional: x402 wallet address (Base L2 USDC) */
  x402WalletAddress?: string;
  /** Optional: monthly spending limit in cents */
  x402SpendingLimitCents?: number;
  /** Optional: agent type for analytics (free-form text) */
  agentType?: string;
}

export type AgentTier = 'agent_free' | 'agent_starter' | 'agent_pro' | 'agent_fleet';

export interface RegisterResult {
  vaultId: string;
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  apiKey: string;
  namespace: string;
  tier: AgentTier;
  message: string;
}

export interface AuthResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

// ─── Client Options ──────────────────────────────────────────────────────────

export interface ClientOptions {
  /** Base URL of the Serac API. Default: https://serac.cloud/api/agent */
  baseUrl?: string;
  /** Custom fetch implementation (for Node 18+ native fetch works) */
  fetch?: typeof globalThis.fetch;
  /** Request timeout in ms. Default: 30000 */
  timeout?: number;
  /** Max retries on transient errors (429, 502-504). Default: 3 */
  maxRetries?: number;
  /** Retry delay base in ms (exponential backoff). Default: 1000 */
  retryDelay?: number;
}

// ─── Store (direct upload) ──────────────────────────────────────────────────

export interface StoreDirectOptions {
  /** Namespace to store in (e.g. "memory", "skills", "logs") */
  namespace: string;
  /** Key for the object (e.g. "user:prefs:v1") */
  key: string;
  /** Base64-encoded data (encrypted blob). Max 1 MB. */
  data: string;
  /** Content type hint (e.g. "application/json", "text/plain") */
  contentType?: string;
  /** Time-to-live in seconds. 0 = permanent */
  ttl?: number;
}

export interface StoreDirectResult {
  objectId: string;
  key: string;
  namespace: string;
  sizeBytes: number;
}

// ─── Store (presigned URL — for large objects > 1 MB) ─────────────────────────

export interface StorePresignedOptions {
  /** Namespace to store in */
  namespace: string;
  /** Key for the object */
  key: string;
  /** Size of the encrypted data in bytes */
  sizeBytes: number;
  /** Content type hint */
  contentType?: string;
  /** Time-to-live in seconds. 0 = permanent */
  ttl?: number;
}

export interface StorePresignedResult {
  objectId: string;
  uploadUrl: string;
  uploadToken: string;
  key: string;
  namespace: string;
}

export interface StoreConfirmOptions {
  objectId: string;
  uploadToken: string;
  sizeBytes?: number;
}

export interface StoreConfirmResult {
  objectId: string;
  key: string;
  sizeBytes: number;
  confirmed: boolean;
}

// ─── Retrieve ────────────────────────────────────────────────────────────────

export interface RetrieveOptions {
  namespace: string;
  key: string;
}

export interface RetrieveResult {
  downloadUrl: string;
  sizeBytes: number;
  contentType: string | null;
  createdAt: string;
}

// ─── List ────────────────────────────────────────────────────────────────────

export interface ListOptions {
  namespace: string;
  /** Prefix filter (e.g. "user:" lists keys starting with "user:") */
  prefix?: string;
  /** Maximum number of keys to return. Default: 100, max: 1000 */
  limit?: number;
  /** Cursor for pagination */
  cursor?: string;
}

export interface ListResult {
  namespace: string;
  objects: Array<{
    key: string;
    sizeBytes: number;
    contentType: string | null;
    createdAt: string;
    expiresAt: string | null;
  }>;
  count: number;
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export interface DeleteOptions {
  namespace: string;
  key: string;
}

export interface DeleteResult {
  key: string;
  namespace: string;
  deletedAt: string;
  permanent: boolean;
}

// ─── Quota ───────────────────────────────────────────────────────────────────

export interface QuotaResult {
  storage: {
    usedBytes: number;
    limitBytes: number;
    usagePercent: number;
  };
  objects: {
    count: number;
  };
  plan: {
    name: string;
    displayName: string;
  };
}

// ─── V2: Share ───────────────────────────────────────────────────────────────

export interface ShareOptions {
  namespace: string;
  key: string;
  /** Recipient's X25519 public key (base64, 32 bytes) */
  targetAgentPubkey: string;
  /** Permission level. Default: 'read' */
  permission?: 'read' | 'read_write';
  /** Expiration time in seconds. 0 = no expiration */
  ttl?: number;
}

export interface ShareResult {
  shareId: string;
  objectId: string;
  fromVaultId: string;
  toVaultId: string;
  permission: string;
  expiresAt: string | null;
}

// ─── V2: Attest ─────────────────────────────────────────────────────────────

export interface AttestResult {
  key: string;
  namespace: string;
  hashSha256: string;
  sizeBytes: number;
  uploadedAt: string;
  vaultId: string;
  ed25519Signature: string;
  verifyUrl: string;
}

// ─── V2: Archive ─────────────────────────────────────────────────────────────

export interface ArchiveResult {
  key: string;
  namespace: string;
  archiveStatus: 'archiving' | 'archived';
  archivedAt: string;
  message: string;
}

export interface RestoreResult {
  key: string;
  namespace: string;
  archiveStatus: 'restoring';
  restoreRequestedAt: string;
  estimatedAvailableAt: string;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export enum SeracErrorCode {
  AUTH_FAILED = 'AUTH_FAILED',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  PAYMENT_REQUIRED = 'PAYMENT_REQUIRED',
  SERVER_ERROR = 'SERVER_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
}

export class SeracError extends Error {
  constructor(
    public readonly code: SeracErrorCode,
    message: string,
    public readonly statusCode?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SeracError';
  }
}