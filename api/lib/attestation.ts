/**
 * Attestation Service — Ed25519 existence proofs for stored objects.
 *
 * The server signs a proof that an object existed at a given timestamp.
 * The proof is verifiable by anyone using the service's Ed25519 public key.
 *
 * How it works:
 * 1. Agent calls GET /objects/:key/attest?namespace=...
 * 2. Server computes SHA-256 of (namespace + key + sizeBytes + uploadedAt)
 * 3. Server signs the hash with the service Ed25519 private key
 * 4. Returns: { key, namespace, hashSha256, sizeBytes, uploadedAt, ed25519Signature, servicePublicKey, verifyUrl }
 *
 * Key management:
 * - Production: set SERVICE_ED25519_PRIVATE_KEY (base64-encoded 64-byte seed)
 * - Dev/test: auto-generates an ephemeral key (changes on restart)
 * - The public key is derivable from the private key
 */

import * as crypto from "crypto";
import { createHash } from "crypto";

let servicePrivateKey: crypto.KeyObject | null = null;
let servicePublicKeyB64: string | null = null;

/**
 * Initialize or get the service Ed25519 keypair.
 * Env var SERVICE_ED25519_PRIVATE_KEY (base64 seed) takes priority.
 * Otherwise, generates an ephemeral key (dev mode — not stable across restarts).
 */
function ensureServiceKey(): { privateKey: crypto.KeyObject; publicKeyB64: string } {
  if (servicePrivateKey && servicePublicKeyB64) {
    return { privateKey: servicePrivateKey, publicKeyB64: servicePublicKeyB64 };
  }

  const envKey = process.env["SERVICE_ED25519_PRIVATE_KEY"];

  if (envKey) {
    // Parse base64-encoded Ed25519 seed (64 bytes for PKCS8, or 32-byte seed)
    const keyData = Buffer.from(envKey, "base64");
    servicePrivateKey = crypto.createPrivateKey({
      key: keyData,
      format: "der",
      type: "pkcs8",
    });
  } else {
    // Ephemeral key for dev/test
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    servicePrivateKey = privateKey;
  }

  // Derive public key
  const publicKey = crypto.createPublicKey(servicePrivateKey!);
  servicePublicKeyB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  return { privateKey: servicePrivateKey!, publicKeyB64: servicePublicKeyB64! };
}

/**
 * Sign a message with the service Ed25519 private key.
 */
export function signWithServiceKey(message: string): string {
  const { privateKey } = ensureServiceKey();
  const signature = crypto.sign(null, Buffer.from(message, "utf8"), privateKey);
  return signature.toString("base64");
}

/**
 * Verify a signature with the service Ed25519 public key.
 */
export function verifyWithServiceKey(message: string, signatureB64: string): boolean {
  const { publicKeyB64 } = ensureServiceKey();
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(publicKeyB64, "base64"),
    format: "der",
    type: "spki",
  });
  const signature = Buffer.from(signatureB64, "base64");
  return crypto.verify(null, Buffer.from(message, "utf8"), publicKey, signature);
}

/**
 * Get the service's Ed25519 public key (DER SPKI, base64).
 */
export function getServicePublicKeyB64(): string {
  return ensureServiceKey().publicKeyB64;
}

/**
 * Compute the attestation payload hash.
 * Format: SHA-256("serac-attest-v1:{namespace}:{key}:{sizeBytes}:{uploadedAt}")
 */
export function computeAttestationHash(
  namespace: string,
  key: string,
  sizeBytes: number,
  uploadedAt: string,
): string {
  const payload = `serac-attest-v1:${namespace}:${key}:${sizeBytes}:${uploadedAt}`;
  return createHash("sha256").update(payload).digest("base64");
}