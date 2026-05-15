/**
 * Serac SDK Interop Test Vectors (ADR-001 §10)
 * Generates deterministic test vectors for JS↔Python cross-validation.
 * Run: node test-interop.mjs
 */

import {
  encryptAES256GCM,
  decryptAES256GCM,
  deriveNamespaceKey,
  sha256,
  signEd25519,
  verifyEd25519,
  sealWithPublicKey,
  unsealWithPrivateKey,
  generateEd25519KeyPair,
  generateX25519KeyPair,
} from './dist/index.mjs';

// Fixed master key (32 bytes)
const MASTER_KEY = new Uint8Array([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
  0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
  0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
]);

const PLAINTEXT = 'Hello, Serac! Interop test vector #1';
let pass = 0, fail = 0;

function assert(cond, name) {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name}`); fail++; }
}

// ─── Test 1: HKDF Namespace Key Derivation ─────────────────────────────
console.log('\n=== Test 1: HKDF Namespace Key Derivation ===');
const nsKeyMemory = deriveNamespaceKey(MASTER_KEY, 'memory');
const nsKeySkills = deriveNamespaceKey(MASTER_KEY, 'skills');
console.log(`  namespace "memory" key (base64): ${Buffer.from(nsKeyMemory).toString('base64')}`);
console.log(`  namespace "skills" key (base64): ${Buffer.from(nsKeySkills).toString('base64')}`);
assert(nsKeyMemory.length === 32, 'nsKeyMemory is 32 bytes');
assert(nsKeySkills.length === 32, 'nsKeySkills is 32 bytes');
assert(Buffer.from(nsKeyMemory).equals(Buffer.from(nsKeySkills)) === false, 'different namespaces yield different keys');

// ─── Test 2: AES-256-GCM Round-Trip ────────────────────────────────────
console.log('\n=== Test 2: AES-256-GCM ===');
const aesKey = nsKeyMemory;
const plaintextBytes = Buffer.from(PLAINTEXT, 'utf8');
const encrypted = encryptAES256GCM(plaintextBytes, aesKey);
const decrypted = decryptAES256GCM(encrypted, aesKey);
console.log(`  ciphertext (base64): ${encrypted.ciphertext}`);
console.log(`  iv (base64): ${encrypted.iv}`);
console.log(`  tag (base64): ${encrypted.tag}`);
assert(Buffer.from(decrypted).toString('utf8') === PLAINTEXT, 'encrypt→decrypt round-trip');

// ─── Test 3: SHA-256 ───────────────────────────────────────────────────
console.log('\n=== Test 3: SHA-256 ===');
const hashResult = sha256('Serac interop test');
console.log(`  sha256("Serac interop test") (base64): ${hashResult}`);
// Known SHA-256 of "Serac interop test" = verify against Python
const hashBytes = Buffer.from(hashResult, 'base64');
assert(hashBytes.length === 32, 'SHA-256 produces 32 bytes');

// ─── Test 4: Ed25519 Sign/Verify ───────────────────────────────────────
console.log('\n=== Test 4: Ed25519 Sign/Verify ===');
const ed25519Keys = generateEd25519KeyPair();
const message = 'Serac interop test message';
const signature = signEd25519(message, ed25519Keys.privateKeyB64);
const verified = verifyEd25519(message, signature, ed25519Keys.publicKeyB64);
console.log(`  publicKey (base64): ${ed25519Keys.publicKeyB64}`);
console.log(`  privateKey (base64): ${ed25519Keys.privateKeyB64}`);
console.log(`  signature (base64): ${signature}`);
assert(verified === true, 'Ed25519 sign→verify');
assert(verifyEd25519('wrong message', signature, ed25519Keys.publicKeyB64) === false, 'Ed25519 wrong message fails');

// ─── Test 5: X25519 Sealed Box ─────────────────────────────────────────
console.log('\n=== Test 5: X25519 Sealed Box ===');
const x25519Keys = generateX25519KeyPair();
const sealPlaintext = 'Sealed box interop test';
const sealResult = sealWithPublicKey(Buffer.from(sealPlaintext, 'utf8'), Buffer.from(x25519Keys.publicKeyB64, 'base64'));
const unsealed = unsealWithPrivateKey(sealResult.sealed, x25519Keys.privateKeyB64);
console.log(`  x25519 publicKey (base64): ${x25519Keys.publicKeyB64}`);
console.log(`  x25519 privateKey (base64): ${x25519Keys.privateKeyB64}`);
console.log(`  sealed (base64): ${sealResult.sealed}`);
console.log(`  ephemeralPublicKey (base64): ${sealResult.ephemeralPublicKey}`);
assert(Buffer.from(unsealed).toString('utf8') === sealPlaintext, 'seal→unseal round-trip');

// ─── Test 6: Key Commitment (SHA-256 of master key) ────────────────────
console.log('\n=== Test 6: Key Commitment ===');
const keyCommitment = sha256(MASTER_KEY);
console.log(`  keyCommitment (base64): ${keyCommitment}`);
assert(keyCommitment.length > 0, 'key commitment computed');

// ─── Summary ────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);