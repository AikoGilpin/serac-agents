/**
 * Serac Agent SDK — HTTP Client
 * Zero runtime dependencies — Node 18+ native fetch
 */

import type { ClientOptions, AuthResult } from './types.js';
import { SeracError, SeracErrorCode } from './types.js';

const DEFAULT_BASE_URL = 'https://serac.cloud/api/agent';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1_000;

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export class HttpClient {
  private baseUrl: string;
  private apiKey: string;
  private jwt: string | null = null;
  private jwtExpiry: number = 0;
  private fetchImpl: typeof globalThis.fetch;
  private timeout: number;
  private maxRetries: number;
  private retryDelay: number;

  constructor(apiKey: string, options?: ClientOptions) {
    this.apiKey = apiKey;
    this.baseUrl = (options?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options?.fetch ?? globalThis.fetch;
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelay = options?.retryDelay ?? DEFAULT_RETRY_DELAY;
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  /** Authenticate with API key, obtain JWT. Auto-called on first request. */
  async authenticate(): Promise<AuthResult> {
    const res = await this.doFetch('POST', '/api-key', { api_key: this.apiKey }, { noAuth: true });

    if (!res.ok) {
      await this.throwError(res, 'Authentication failed');
    }

    const data = (await res.json()) as AuthResult;
    this.jwt = data.accessToken;
    this.jwtExpiry = Date.now() + data.expiresIn * 1000 - 30_000; // 30s margin
    return data;
  }

  /** Force-refresh the JWT */
  async refreshAuth(): Promise<AuthResult> {
    this.jwt = null;
    return this.authenticate();
  }

  // ─── Core request methods ────────────────────────────────────────────────

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) qs.set(k, String(v));
      }
      url += '?' + qs.toString();
    }
    return this.request<T>('GET', url, undefined);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', `${this.baseUrl}${path}`, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', `${this.baseUrl}${path}`, body);
  }

  async delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', `${this.baseUrl}${path}`, body);
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    // Ensure we have a valid JWT (unless it's a no-auth path)
    if (!this.jwt || Date.now() >= this.jwtExpiry) {
      await this.authenticate();
    }

    let lastError: SeracError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Authorization': `Bearer ${this.jwt!}`,
          'Content-Type': 'application/json',
        };

        const init: RequestInit = {
          method,
          headers,
          signal: AbortSignal.timeout(this.timeout),
        };

        if (body !== undefined) {
          init.body = JSON.stringify(body);
        }

        const res = await this.fetchImpl(url, init);

        // Success
        if (res.ok) {
          if (res.status === 204) return undefined as T;
          return (await res.json()) as T;
        }

        // Auth expired — re-auth once
        if (res.status === 401 && attempt === 0) {
          await this.refreshAuth();
          // Update header for next retry
          continue;
        }

        // Rate limited — wait and retry
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
          await this.sleep(retryAfter * 1000);
          continue;
        }

        // x402 — don't retry
        if (res.status === 402) {
          const data = await res.json().catch(() => ({}));
          throw new SeracError(SeracErrorCode.PAYMENT_REQUIRED, 'Payment required', 402, data);
        }

        // Other errors
        await this.throwError(res, `Serac API error: ${res.status}`);
      } catch (err) {
        if (err instanceof SeracError) {
          if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500 && !RETRYABLE_STATUS.has(err.statusCode)) {
            throw err;
          }
          lastError = err;
        } else if (err instanceof TypeError) {
          lastError = new SeracError(SeracErrorCode.NETWORK_ERROR, `Network error: ${err.message}`);
        } else {
          lastError = new SeracError(SeracErrorCode.SERVER_ERROR, `Unexpected error: ${err}`);
        }
      }

      // Exponential backoff before retry
      if (attempt < this.maxRetries) {
        await this.sleep(this.retryDelay * Math.pow(2, attempt));
      }
    }

    throw lastError ?? new SeracError(SeracErrorCode.SERVER_ERROR, 'Max retries exceeded');
  }

  private async doFetch(method: string, path: string, body?: unknown, opts?: { noAuth?: boolean }): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (!opts?.noAuth && this.jwt) {
      headers['Authorization'] = `Bearer ${this.jwt}`;
    }

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    try {
      return await this.fetchImpl(url, init);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new SeracError(SeracErrorCode.TIMEOUT, `Request timed out after ${this.timeout}ms`);
      }
      throw new SeracError(SeracErrorCode.NETWORK_ERROR, `Network error: ${err}`);
    }
  }

  private async throwError(res: Response, context: string): Promise<never> {
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      // non-JSON response
    }

    const error = data['error'] ?? data['message'] ?? res.statusText;
    const details = data['details'] ?? data;

    const codeMap: Record<number, SeracErrorCode> = {
      400: SeracErrorCode.VALIDATION_FAILED,
      401: SeracErrorCode.AUTH_FAILED,
      403: SeracErrorCode.AUTH_FAILED,
      404: SeracErrorCode.NOT_FOUND,
      409: SeracErrorCode.ALREADY_EXISTS,
      413: SeracErrorCode.QUOTA_EXCEEDED,
      429: SeracErrorCode.RATE_LIMITED,
      402: SeracErrorCode.PAYMENT_REQUIRED,
    };

    throw new SeracError(
      codeMap[res.status] ?? SeracErrorCode.SERVER_ERROR,
      typeof error === 'string' ? error : context,
      res.status,
      details,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}