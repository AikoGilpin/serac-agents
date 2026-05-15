#!/usr/bin/env python3
"""Serac SDK Interop Test Vectors (ADR-001 §10) — Python validation.

Validates deterministic cross-SDK values (HKDF, SHA-256, key commitment)
against the JS-generated vectors, then tests round-trip within Python.

Known interop divergence:
- Sealed box format: JS uses DER SPKI (88 bytes) for ephemeral key header,
  Python uses raw X25519 (32 bytes). Wire format is SDK-specific until
  unified in V2. Cross-SDK sealed box is NOT yet supported.

Run: python3 test_interop.py
"""

import base64
import sys
from serac_mcp import (
    derive_namespace_key,
    encrypt_aes256_gcm,
    decrypt_aes256_gcm,
    sha256_hash,
    generate_ed25519_keypair,
    sign_ed25519,
    verify_ed25519,
    generate_x25519_keypair,
    seal_with_public_key,
    unseal_with_private_key,
)

# Fixed master key (same as JS test)
MASTER_KEY = bytes([
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
    0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
    0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
])

pass_count = 0
fail_count = 0

def assert_eq(actual, expected, name):
    global pass_count, fail_count
    if actual == expected:
        print(f"  ✅ {name}")
        pass_count += 1
    else:
        print(f"  ❌ {name}")
        print(f"     expected: {expected}")
        print(f"     actual:   {actual}")
        fail_count += 1

def assert_true(cond, name):
    global pass_count, fail_count
    if cond:
        print(f"  ✅ {name}")
        pass_count += 1
    else:
        print(f"  ❌ {name}")
        fail_count += 1

# ─── Test 1: HKDF Namespace Key Derivation (cross-SDK) ──────────────────
print("\n=== Test 1: HKDF Namespace Key Derivation ===")
ns_key_memory = derive_namespace_key(MASTER_KEY, "memory")
ns_key_skills = derive_namespace_key(MASTER_KEY, "skills")
ns_key_memory_b64 = base64.b64encode(ns_key_memory).decode()
ns_key_skills_b64 = base64.b64encode(ns_key_skills).decode()
print(f"  namespace 'memory' key (base64): {ns_key_memory_b64}")
print(f"  namespace 'skills' key (base64): {ns_key_skills_b64}")

# Cross-validate with JS vectors
assert_eq(ns_key_memory_b64, "uEGue4dn3HgtmtC/hhSy1TYnVmrwFa5VE2oScAOvzMQ=", "memory key matches JS")
assert_eq(ns_key_skills_b64, "/Mj623wtwT60EBJgfC54gB2DHtWybwdsY40ol3lVnKI=", "skills key matches JS")

# ─── Test 2: AES-256-GCM Round-Trip ────────────────────────────────────
print("\n=== Test 2: AES-256-GCM ===")
plaintext = "Hello, Serac! Interop test vector #1"
aes_key = ns_key_memory  # Use same derived key as JS
encrypted = encrypt_aes256_gcm(plaintext, aes_key)
decrypted = decrypt_aes256_gcm(encrypted, aes_key)
print(f"  ciphertext (base64): {encrypted.ciphertext}")
print(f"  iv (base64): {encrypted.iv}")
print(f"  tag (base64): {encrypted.tag}")
# Python decrypt returns bytes, compare properly
assert_true(decrypted == plaintext.encode() or decrypted == plaintext, "encrypt→decrypt round-trip")

# ─── Test 3: SHA-256 (cross-SDK) ───────────────────────────────────────
print("\n=== Test 3: SHA-256 ===")
hash_result = sha256_hash("Serac interop test")
print(f"  sha256('Serac interop test') (base64): {hash_result}")
# Cross-validate with JS vector
assert_eq(hash_result, "mRKnaVALx4xk09IXLdoaYu2ERnxkDilP6VdT8IoZWLE=", "SHA-256 matches JS")

# ─── Test 4: Ed25519 Sign/Verify ───────────────────────────────────────
print("\n=== Test 4: Ed25519 Sign/Verify ===")
ed_keys = generate_ed25519_keypair()
message = "Serac interop test message"
sig = sign_ed25519(message, ed_keys.private_key_b64)
verified = verify_ed25519(message, sig, ed_keys.public_key_b64)
print(f"  publicKey (base64): {ed_keys.public_key_b64}")
print(f"  signature (base64): {sig}")
assert_true(verified, "Ed25519 sign→verify")
assert_true(
    not verify_ed25519("wrong message", sig, ed_keys.public_key_b64),
    "Ed25519 wrong message fails"
)

# ─── Test 5: X25519 Sealed Box (Python round-trip) ──────────────────────
print("\n=== Test 5: X25519 Sealed Box ===")
# NOTE: Python uses raw 32-byte X25519 keys, JS uses DER SPKI (88 bytes).
# Cross-SDK sealed box is NOT yet supported due to format divergence.
# This test validates Python-internal round-trip only.
x25519_keys = generate_x25519_keypair()
seal_plaintext = "Sealed box interop test"
pub_key_raw = base64.b64decode(x25519_keys.public_key_b64)  # raw 32 bytes
sealed = seal_with_public_key(seal_plaintext, pub_key_raw)
unsealed = unseal_with_private_key(sealed.sealed, x25519_keys.private_key_b64)
print(f"  x25519 publicKey (base64): {x25519_keys.public_key_b64}")
print(f"  sealed (base64): {sealed.sealed}")
decrypted_text = unsealed.decode() if isinstance(unsealed, bytes) else unsealed
assert_eq(decrypted_text, seal_plaintext, "seal→unseal round-trip (Python)")

# ─── Test 6: Key Commitment (cross-SDK) ────────────────────────────────
print("\n=== Test 6: Key Commitment ===")
key_commitment = sha256_hash(MASTER_KEY)
print(f"  keyCommitment (base64): {key_commitment}")
# Cross-validate with JS vector
assert_eq(key_commitment, "riFsLvUkejeCwTXvonmj5M3GEJQnD10r5YxiBLemEsk=", "key commitment matches JS")

# ─── Summary ────────────────────────────────────────────────────────────
print(f"\n=== Results: {pass_count} passed, {fail_count} failed ===")
if fail_count > 0:
    print("⚠️  Note: Sealed box format diverges between JS (DER SPKI) and Python (raw 32-byte).")
    print("    Cross-SDK sealed box is NOT yet supported. Track as P2 for V2.")
sys.exit(1 if fail_count > 0 else 0)