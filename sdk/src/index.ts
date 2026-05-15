/**
 * Serac Agent SDK — Main Entry
 * Sovereign E2EE cloud storage for AI agents
 *
 * Usage:
 *   import { SeracAgent } from 'serac-agent-sdk';
 *
 *   // From existing API key
 *   const agent = SeracAgent.fromApiKey('sk_serac_xxx');
 *
 *   // Self-register
 *   const { agent, apiKey } = await SeracAgent.register({
 *     agentName: 'my-agent',
 *     ed25519PublicKey: '...',
 *     x25519PublicKey: '...',
 *     encryptedMasterKey: '...',
 *     masterKeyNonce: '...',
 *     keyCommitment: '...',
 *   });
 *
 *   // Store data
 *   const result = await agent.store('memory', 'user:prefs', btoa(JSON.stringify({ theme: 'dark' })));
 *
 *   // Retrieve data
 *   const data = await agent.retrieve('memory', 'user:prefs');
 */

import { HttpClient } from './client.js';
import {
  type RegisterOptions,
  type RegisterResult,
  type AuthResult,
  type ClientOptions,
  type StoreDirectOptions,
  type StoreDirectResult,
  type StorePresignedOptions,
  type StorePresignedResult,
  type StoreConfirmOptions,
  type StoreConfirmResult,
  type RetrieveOptions,
  type RetrieveResult,
  type ListOptions,
  type ListResult,
  type DeleteOptions,
  type DeleteResult,
  type QuotaResult,
  type ShareOptions,
  type ShareResult,
  type AttestResult,
  type ArchiveResult,
  type RestoreResult,
  type AgentTier,
  SeracError,
  SeracErrorCode,
} from './types.js';

// Re-export crypto utilities
export {
  generateEd25519KeyPair,
  generateX25519KeyPair,
  generateAgentKeyMaterial,
  encryptAES256GCM,
  decryptAES256GCM,
  deriveNamespaceKey,
  sealWithPublicKey,
  unsealWithPrivateKey,
  sha256,
  signEd25519,
  verifyEd25519,
  base64ToBase64Url,
  base64UrlToBase64,
} from './crypto.js';
export type { KeyPair, AgentKeyMaterial, EncryptedData, SealedBoxResult } from './crypto.js';

// Re-export all types
export { SeracError, SeracErrorCode } from './types.js';
export type {
  RegisterOptions, RegisterResult, AuthResult, ClientOptions,
  StoreDirectOptions, StoreDirectResult,
  StorePresignedOptions, StorePresignedResult,
  StoreConfirmOptions, StoreConfirmResult,
  RetrieveOptions, RetrieveResult,
  ListOptions, ListResult,
  DeleteOptions, DeleteResult,
  QuotaResult,
  ShareOptions, ShareResult,
  AttestResult,
  ArchiveResult, RestoreResult,
  AgentTier,
} from './types.js';

const DEFAULT_BASE_URL = 'https://serac.cloud/api/agent';

/**
 * SeracAgent — Main SDK client
 *
 * Two ways to initialize:
 * 1. `SeracAgent.fromApiKey(key)` — for agents with a pre-existing API key
 * 2. `SeracAgent.register(opts)` — for autonomous agents that self-register
 */
export class SeracAgent {
  private client: HttpClient;
  private _vaultId?: string;
  private _fetchImpl: typeof globalThis.fetch;
  private _timeout: number;

  private constructor(apiKey: string, options?: ClientOptions) {
    this.client = new HttpClient(apiKey, options);
    this._fetchImpl = options?.fetch ?? globalThis.fetch;
    this._timeout = options?.timeout ?? 30_000;
  }

  // ─── Factory Methods ─────────────────────────────────────────────────────

  /**
   * Initialize from an existing API key.
   * Use this when a human has already created the vault and provided the key.
   */
  static fromApiKey(apiKey: string, options?: ClientOptions): SeracAgent {
    return new SeracAgent(apiKey, options);
  }

  /**
   * Self-register as an autonomous agent.
   * Creates a new vault with namespace "memory" and returns the agent instance
   * ready to use. The API key is shown ONCE — caller must save it.
   */
  static async register(
    opts: RegisterOptions,
    clientOptions?: ClientOptions,
  ): Promise<{ agent: SeracAgent; apiKey: string; vaultId: string }> {
    const baseUrl = (clientOptions?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const fetchImpl = clientOptions?.fetch ?? globalThis.fetch;
    const timeout = clientOptions?.timeout ?? 30_000;

    const res = await fetchImpl(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: opts.agentName,
        ed25519_public_key: opts.ed25519PublicKey,
        x25519_public_key: opts.x25519PublicKey,
        encrypted_master_key: opts.encryptedMasterKey,
        master_key_nonce: opts.masterKeyNonce,
        key_commitment: opts.keyCommitment,
        tier: opts.tier ?? 'agent_free',
        agent_type: opts.agentType,
        webhook_url: opts.webhookUrl,
        x402_wallet_address: opts.x402WalletAddress,
        x402_spending_limit_cents: opts.x402SpendingLimitCents,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      let data: Record<string, unknown> = {};
      try { data = await res.json() as Record<string, unknown>; } catch { /* empty */ }

      const codeMap: Record<number, SeracErrorCode> = {
        400: SeracErrorCode.VALIDATION_FAILED,
        409: SeracErrorCode.ALREADY_EXISTS,
        429: SeracErrorCode.RATE_LIMITED,
      };

      throw new SeracError(
        codeMap[res.status] ?? SeracErrorCode.SERVER_ERROR,
        typeof data['error'] === 'string' ? data['error'] : `Registration failed: ${res.status}`,
        res.status,
        data,
      );
    }

    const result = await res.json() as RegisterResult;

    const agent = new SeracAgent(result.apiKey, clientOptions);
    agent._vaultId = result.vaultId;
    agent._fetchImpl = fetchImpl;
    agent._timeout = timeout;

    // Pre-authenticate with the JWT from registration
    // @ts-expect-error - accessing private for initialization
    agent.client.jwt = result.accessToken;
    // @ts-expect-error - accessing private for initialization
    agent.client.jwtExpiry = Date.now() + result.expiresIn * 1000 - 30_000;

    return {
      agent,
      apiKey: result.apiKey,
      vaultId: result.vaultId,
    };
  }

  // ─── V1 Tools ─────────────────────────────────────────────────────────────

  /**
   * Store a small object directly via base64.
   * Max 1 MB encrypted payload. For larger objects, use storePresigned().
   *
   * @param namespace - Namespace (e.g. "memory", "skills")
   * @param key - Object key (e.g. "user:prefs:v1")
   * @param data - Base64-encoded data (ideally encrypted client-side)
   * @param options - Optional content type and TTL
   */
  async store(namespace: string, key: string, data: string, options?: { contentType?: string; ttl?: number }): Promise<StoreDirectResult> {
    return this.client.post<StoreDirectResult>('/objects/store/direct', {
      namespace,
      key,
      data,
      content_type: options?.contentType,
      ttl: options?.ttl,
    });
  }

  /**
   * Get a presigned upload URL for large objects (> 1 MB).
   * Step 1 of 2-step upload. After uploading to the URL, call storeConfirm().
   */
  async storePresigned(options: StorePresignedOptions): Promise<StorePresignedResult> {
    return this.client.post<StorePresignedResult>('/objects/store', {
      namespace: options.namespace,
      key: options.key,
      size_bytes: options.sizeBytes,
      content_type: options.contentType,
      ttl: options.ttl,
    });
  }

  /**
   * Confirm that a presigned upload completed.
   * Step 2 of 2-step upload.
   */
  async storeConfirm(options: StoreConfirmOptions): Promise<StoreConfirmResult> {
    return this.client.post<StoreConfirmResult>('/objects/confirm', {
      object_id: options.objectId,
      upload_token: options.uploadToken,
      size_bytes: options.sizeBytes,
    });
  }

  /**
   * Retrieve an object — returns a presigned download URL.
   * The caller must fetch the URL and decode the base64 data.
   * For convenience, use retrieveData() which does this automatically.
   */
  async retrieve(namespace: string, key: string): Promise<RetrieveResult> {
    return this.client.get<RetrieveResult>('/objects/retrieve', { namespace, key });
  }

  /**
   * Retrieve an object and decode the response automatically.
   * Fetches the presigned URL and returns the base64 data string.
   */
  async retrieveData(namespace: string, key: string): Promise<string> {
    const { downloadUrl } = await this.retrieve(namespace, key);
    const res = await this._fetchImpl(downloadUrl, {
      signal: AbortSignal.timeout(this._timeout),
    });
    if (!res.ok) {
      throw new SeracError(SeracErrorCode.SERVER_ERROR, `Failed to download object: ${res.status}`, res.status);
    }
    const buffer = await res.arrayBuffer();
    // Convert ArrayBuffer to base64 without Node Buffer dependency
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  /**
   * List keys in a namespace with optional prefix filter.
   */
  async list(namespace: string, options?: { prefix?: string; limit?: number; cursor?: string }): Promise<ListResult> {
    const params: Record<string, string | number | undefined> = { namespace };
    if (options?.prefix) params['prefix'] = options.prefix;
    if (options?.limit) params['limit'] = options.limit;
    if (options?.cursor) params['cursor'] = options.cursor;
    return this.client.get<ListResult>('/objects/list', params);
  }

  /**
   * Delete an object (soft delete by default, 30-day grace).
   */
  async delete(namespace: string, key: string): Promise<DeleteResult> {
    return this.client.delete<DeleteResult>('/objects/delete', {
      namespace,
      key,
    });
  }

  /**
   * Check storage usage and plan limits.
   */
  async quota(): Promise<QuotaResult> {
    return this.client.get<QuotaResult>('/quota');
  }

  // ─── V2 Tools ─────────────────────────────────────────────────────────────

  /**
   * Share an object with another agent via X25519 sealed-box re-encryption.
   * The recipient can decrypt using their private key.
   */
  async share(namespace: string, key: string, targetPubkey: string, permission?: 'read' | 'read_write', ttl?: number): Promise<ShareResult> {
    return this.client.post<ShareResult>('/objects/share', {
      namespace,
      key,
      target_agent_pubkey: targetPubkey,
      permission: permission ?? 'read',
      ttl,
    });
  }

  /**
   * Get a cryptographic attestation for a stored object.
   * Proves the object existed at a given timestamp (Ed25519 signature).
   */
  async attest(namespace: string, key: string): Promise<AttestResult> {
    return this.client.get<AttestResult>(`/objects/${encodeURIComponent(key)}/attest`, { namespace });
  }

  /**
   * Archive an object to cold storage (Glacier).
   * Archived objects are cheaper to store but take 24-48h to restore.
   */
  async archive(namespace: string, key: string): Promise<ArchiveResult> {
    return this.client.post<ArchiveResult>(`/objects/${encodeURIComponent(key)}/archive`, { namespace });
  }

  /**
   * Request restoration of an archived object.
   * Restored objects become available within 24-48h.
   */
  async restore(namespace: string, key: string): Promise<RestoreResult> {
    return this.client.post<RestoreResult>(`/objects/${encodeURIComponent(key)}/restore`, { namespace });
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  /**
   * List shares received by the authenticated agent.
   */
  async listShared(options?: { permission?: 'read' | 'read_write' | 'all'; activeOnly?: boolean; limit?: number }): Promise<{ shares: Array<{ shareId: string; fromVaultId: string; fromVaultName: string; namespace: string; key: string; sizeBytes: number; contentType: string | null; permission: string; expiresAt: string | null; createdAt: string }>; count: number }> {
    const params: Record<string, string | number | undefined> = {};
    if (options?.permission && options.permission !== 'all') params['permission'] = options.permission;
    if (options?.activeOnly !== undefined) params['active_only'] = String(options.activeOnly);
    if (options?.limit) params['limit'] = options.limit;
    return this.client.get('/objects/shared', params);
  }

  /**
   * Get details and download URL for a share received by the authenticated agent.
   */
  async getShared(shareId: string): Promise<{
    shareId: string; fromVaultId: string; fromVaultName: string;
    namespace: string; key: string; sizeBytes: number; contentType: string | null;
    permission: string; encryptedNamespaceKey: string; namespaceKeyNonce: string;
    downloadUrl: string; expiresAt: string | null; createdAt: string;
  }> {
    return this.client.get(`/objects/shared/${encodeURIComponent(shareId)}`);
  }

  /**
   * Revoke a share. Only the sharer can revoke.
   */
  async revokeShare(shareId: string): Promise<{ shareId: string; revoked: boolean }> {
    return this.client.delete(`/objects/share/${encodeURIComponent(shareId)}`);
  }

  /** Get the vault ID (available after registration) */
  get vaultId(): string | undefined {
    return this._vaultId;
  }

  /** Re-authenticate manually (rarely needed, SDK auto-renews) */
  async reauthenticate(): Promise<AuthResult> {
    return this.client.refreshAuth();
  }
}