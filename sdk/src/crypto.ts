/**
 * Serac Agent SDK — Client-Side Encryption (zero dependencies)
 *
 * Uses only Node 18+ built-in crypto. No libsodium required.
 * Provides E2EE primitives matching the Serac server architecture:
 *
 * - Ed25519 signing keypair (authentication, attestation verification)
 * - X25519 keypair (key exchange, sealed-box encryption)
 * - AES-256-GCM (object encryption with namespace keys)
 * - Master key sealing (X25519 ECDH + AES-256-GCM envelope)
 * - Namespace key derivation (HKDF-SHA256 from master key)
 *
 * Serac's full architecture uses XChaCha20-Poly1305 + Argon2id for
 * human clients. The agent SDK uses AES-256-GCM + HKDF-SHA256 because
 * these are available in Node's built-in crypto. The server accepts both
 * encryption modes (v1-x25519-ed25519 for agents, v1-argon2-xchacha20 for humans).
 */

import * as nodeCrypto from 'node:crypto';

const generateKeyPairSync = nodeCrypto.generateKeyPairSync;
const createPublicKey = nodeCrypto.createPublicKey;
const createPrivateKey = nodeCrypto.createPrivateKey;
const createCipheriv = nodeCrypto.createCipheriv;
const createDecipheriv = nodeCrypto.createDecipheriv;
const createHmac = nodeCrypto.createHmac;
const createHash = nodeCrypto.createHash;
const randomBytes = nodeCrypto.randomBytes;
const diffieHellman = nodeCrypto.diffieHellman;

// ─── Types ────────────────────────────────────────────────────────────────

export interface KeyPair {
  /** Base64-encoded private key (PKCS8 DER) */
  privateKeyB64: string;
  /** Base64-encoded public key (SPKI DER) */
  publicKeyB64: string;
  /** Base64URL-encoded private key (JWK-compatible) */
  privateKeyB64Url: string;
  /** Base64URL-encoded public key (JWK-compatible) */
  publicKeyB64Url: string;
}

export interface AgentKeyMaterial {
  /** Ed25519 signing keypair */
  signing: KeyPair;
  /** X25519 encryption keypair */
  encryption: KeyPair;
  /** Encrypted master key (sealed with X25519) */
  encryptedMasterKey: string; // base64
  /** Nonce used for master key encryption */
  masterKeyNonce: string; // base64
  /** SHA-256 commitment of the master key */
  keyCommitment: string; // base64
  /** Raw master key bytes (keep secure!) */
  masterKey: Uint8Array;
}

export interface EncryptedData {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded IV/nonce (12 bytes for AES-GCM) */
  iv: string;
  /** Base64-encoded auth tag (16 bytes for AES-GCM) */
  tag: string;
}

export interface SealedBoxResult {
  /** Base64-encoded sealed data */
  sealed: string;
  /** Base64-encoded ephemeral public key (X25519 SPKI DER) */
  ephemeralPublicKey: string;
}

// ─── Key Generation ───────────────────────────────────────────────────────

/**
 * Generate an Ed25519 signing keypair.
 * Used for agent authentication and attestation.
 */
export function generateEd25519KeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const privateKeyB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  return {
    privateKeyB64,
    publicKeyB64,
    privateKeyB64Url: base64ToBase64Url(privateKeyB64),
    publicKeyB64Url: base64ToBase64Url(publicKeyB64),
  };
}

/**
 * Generate an X25519 encryption keypair.
 * Used for sealed-box encryption and key exchange.
 */
export function generateX25519KeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const privateKeyB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  return {
    privateKeyB64,
    publicKeyB64,
    privateKeyB64Url: base64ToBase64Url(privateKeyB64),
    publicKeyB64Url: base64ToBase64Url(publicKeyB64),
  };
}

/**
 * Generate a complete set of agent key material.
 * This is what you pass to SeracAgent.register().
 *
 * @returns All key material needed for registration + a raw master key for encryption.
 */
export function generateAgentKeyMaterial(): AgentKeyMaterial {
  const signing = generateEd25519KeyPair();
  const encryption = generateX25519KeyPair();

  // Generate a random 32-byte master key
  const masterKey = randomBytes(32);

  // Compute key commitment (SHA-256 hash of master key)
  const keyCommitment = createHash('sha256').update(masterKey).digest('base64');

  // Seal the master key using X25519 ECDH + AES-256-GCM
  // Only the holder of the X25519 private key can decrypt
  const pubKeyDer = Buffer.from(encryption.publicKeyB64, 'base64');
  const { sealed: encryptedMasterKey } = sealWithPublicKey(masterKey, pubKeyDer);

  return {
    signing,
    encryption,
    encryptedMasterKey,
    masterKeyNonce: '', // included in sealed data
    keyCommitment,
    masterKey,
  };
}

// ─── Symmetric Encryption (AES-256-GCM) ──────────────────────────────────

/**
 * Encrypt data using AES-256-GCM.
 * Primary encryption method for namespace keys and object data.
 *
 * @param plaintext - Data to encrypt (Uint8Array or string)
 * @param key - 32-byte encryption key (master key or namespace key)
 * @returns Encrypted data with IV and auth tag
 */
export function encryptAES256GCM(plaintext: Uint8Array | string, key: Uint8Array): EncryptedData {
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : Buffer.from(plaintext);
  const iv = randomBytes(12); // 96-bit IV for AES-GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypt data using AES-256-GCM.
 *
 * @param encrypted - Encrypted data object
 * @param key - 32-byte decryption key
 * @returns Decrypted data as Uint8Array
 */
export function decryptAES256GCM(encrypted: EncryptedData, key: Uint8Array): Uint8Array {
  const iv = Buffer.from(encrypted.iv, 'base64');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
  const tag = Buffer.from(encrypted.tag, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return new Uint8Array(decrypted);
}

// ─── Namespace Key Derivation (HKDF-SHA256) ───────────────────────────────

/**
 * Derive a namespace encryption key from the master key using HKDF-SHA256.
 * Each namespace gets a unique key: HKDF(masterKey, namespace, "serac-ns-v1")
 *
 * @param masterKey - 32-byte master key
 * @param namespace - Namespace name (e.g. "memory", "skills")
 * @returns 32-byte namespace key
 */
export function deriveNamespaceKey(masterKey: Uint8Array, namespace: string): Uint8Array {
  // HKDF-SHA256: Extract then Expand
  // Extract: HMAC-SHA256(salt="", ikm=masterKey)
  const prk = createHmac('sha256', Buffer.alloc(0)).update(masterKey).digest();

  // Expand: HMAC-SHA256(prk, info="serac-ns-v1:" + namespace + 0x01)
  const info = Buffer.concat([
    Buffer.from('serac-ns-v1:'),
    Buffer.from(namespace),
    Buffer.from([0x01]),
  ]);
  const namespaceKey = createHmac('sha256', prk).update(info).digest();

  return new Uint8Array(namespaceKey);
}

// ─── Sealed Box (X25519 ECDH + AES-256-GCM) ──────────────────────────────

/**
 * Seal data for a specific X25519 public key.
 * Creates an ephemeral X25519 keypair, performs ECDH with the target's
 * public key, and encrypts with AES-256-GCM using the shared secret.
 *
 * Equivalent to libsodium's crypto_box_seal but uses AES-GCM instead
 * of XChaCha20-Poly1305 (both are AEAD ciphers).
 *
 * Output format: ephemeralPubKey(DER) || iv(12) || tag(16) || ciphertext
 *
 * @param plaintext - Data to seal
 * @param recipientPublicKeyDer - Recipient's X25519 public key (SPKI DER Buffer)
 * @returns Sealed data object
 */
export function sealWithPublicKey(
  plaintext: Uint8Array | Buffer,
  recipientPublicKeyDer: Buffer,
): SealedBoxResult {
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);

  // Generate ephemeral X25519 keypair
  const { publicKey: ephemeralPublic, privateKey: ephemeralPrivate } = generateKeyPairSync('x25519');

  // Import recipient public key
  const recipientPublic = createPublicKey({ key: recipientPublicKeyDer, format: 'der', type: 'spki' });

  // Derive shared secret via ECDH
  const shared = diffieHellman({ publicKey: recipientPublic, privateKey: ephemeralPrivate });

  // Derive encryption key: HKDF-SHA256(sharedSecret, ephemeralPub || recipientPub, "serac-seal-v1")
  const ephemeralPubDer = ephemeralPublic.export({ type: 'spki', format: 'der' });
  const encKey = deriveSealKey(shared, ephemeralPubDer, recipientPublicKeyDer);

  // Encrypt with AES-256-GCM
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Output: ephemeralPubKey(DER) || iv(12) || tag(16) || ciphertext
  const sealed = Buffer.concat([ephemeralPubDer, iv, tag, ciphertext]);

  return {
    sealed: sealed.toString('base64'),
    ephemeralPublicKey: ephemeralPubDer.toString('base64'),
  };
}

/**
 * Open a sealed box using the recipient's X25519 private key.
 *
 * @param sealedB64 - Base64-encoded sealed data
 * @param recipientPrivateKeyB64 - Recipient's X25519 private key (base64 PKCS8 DER)
 * @returns Decrypted data as Uint8Array
 */
export function unsealWithPrivateKey(
  sealedB64: string,
  recipientPrivateKeyB64: string,
): Uint8Array {
  const sealed = Buffer.from(sealedB64, 'base64');
  const recipientPrivate = createPrivateKey({
    key: Buffer.from(recipientPrivateKeyB64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });

  // Parse sealed data format: ephemeralPubKey(DER) || iv(12) || tag(16) || ciphertext
  // X25519 SPKI DER is 48 bytes (0x30 0x59 = SEQUENCE of length 89, total 91 bytes... actually 88 bytes)
  // Wait: 0x30 0x59 means total length including tag byte is 0x59 + 2 = 91 bytes? No.
  // DER: 0x30 0x59 = SEQUENCE, content length 0x59 = 89. Total = 2 + 89 = 91 bytes
  // But Node exports 88 bytes for X25519 SPKI... let me check.
  // Actually let me find the ephemeral key length by trying to parse.

  // X25519 SPKI DER from Node is 88 bytes (0x30 0x56 ...)
  // But let's not hardcode — find 0x30 XX pattern near start
  const ephemeralPubDer = parseEphemeralKey(sealed);
  const ephemeralPubDerLen = ephemeralPubDer.length;

  const iv = sealed.subarray(ephemeralPubDerLen, ephemeralPubDerLen + 12);
  const tag = sealed.subarray(ephemeralPubDerLen + 12, ephemeralPubDerLen + 12 + 16);
  const ciphertext = sealed.subarray(ephemeralPubDerLen + 12 + 16);

  // Import ephemeral public key
  const ephemeralPublic = createPublicKey({ key: ephemeralPubDer, format: 'der', type: 'spki' });

  // Derive shared secret
  const shared = diffieHellman({ publicKey: ephemeralPublic, privateKey: recipientPrivate });

  // Derive decryption key
  // Need recipient's public key DER for the KDF
  const recipientPublic = createPublicKey(recipientPrivate).export({ type: 'spki', format: 'der' });
  const encKey = deriveSealKey(shared, ephemeralPubDer, recipientPublic);

  // Decrypt
  const decipher = createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return new Uint8Array(decrypted);
}

// ─── Utility ──────────────────────────────────────────────────────────────

/**
 * Convert base64 to base64url.
 */
export function base64ToBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Convert base64url to base64.
 */
export function base64UrlToBase64(b64url: string): string {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return b64;
}

/**
 * Compute SHA-256 hash of data.
 */
export function sha256(data: Uint8Array | string): string {
  const input = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  return createHash('sha256').update(input).digest('base64');
}

/**
 * Sign data with an Ed25519 private key (for attestation verification).
 */
export function signEd25519(data: Uint8Array | string, privateKeyB64: string): string {
  const input = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyB64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const sig = nodeCrypto.sign(null, input, privateKey);
  return sig.toString('base64');
}

/**
 * Verify an Ed25519 signature.
 */
export function verifyEd25519(
  data: Uint8Array | string,
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  const input = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeyB64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const sig = Buffer.from(signatureB64, 'base64');
  return nodeCrypto.verify(null, input, publicKey, sig);
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function deriveSealKey(
  sharedSecret: Buffer,
  ephemeralPubDer: Buffer,
  recipientPubDer: Buffer,
): Buffer {
  // Key = HKDF-SHA256(sharedSecret, ephemeralPub || recipientPub, "serac-seal-v1")
  const contextInfo = Buffer.concat([ephemeralPubDer, recipientPubDer]);

  // HKDF Extract: HMAC-SHA256(salt="", ikm=sharedSecret)
  const prk = createHmac('sha256', Buffer.alloc(0)).update(sharedSecret).digest();
  // HKDF Expand: HMAC-SHA256(prk, context || label || 0x01)
  const key = createHmac('sha256', prk)
    .update(Buffer.concat([contextInfo, Buffer.from('serac-seal-v1'), Buffer.from([0x01])]))
    .digest();

  return key;
}

function parseEphemeralKey(sealed: Buffer): Buffer {
  // Parse DER SPKI structure at the beginning of the sealed data
  // DER SEQUENCE tag = 0x30, followed by length
  if (sealed.length < 2 || sealed[0] !== 0x30) {
    throw new Error('Invalid sealed data: expected DER SEQUENCE at start');
  }

  // DER length encoding: if byte 1 has high bit clear, length is byte 1.
  // If high bit set, lower 7 bits = number of subsequent bytes for length.
  const lenByte = sealed[1]!;
  let contentLength: number;
  let headerSize: number;

  if ((lenByte & 0x80) === 0) {
    contentLength = lenByte;
    headerSize = 2;
  } else {
    const numLenBytes = lenByte & 0x7f;
    headerSize = 2 + numLenBytes;
    contentLength = 0;
    for (let i = 0; i < numLenBytes; i++) {
      contentLength = (contentLength << 8) | (sealed[2 + i] ?? 0);
    }
  }

  const totalLength = headerSize + contentLength;
  return sealed.subarray(0, totalLength);
}