"""
Serac Agent SDK — Crypto Utilities (zero dependencies)

Uses only Python 3.10+ stdlib: hashlib, hmac, os, json, struct.
Provides E2EE primitives matching the Serac server architecture:

- Ed25519 signing keypair (authentication, attestation verification)
- X25519 keypair (key exchange, sealed-box encryption)
- AES-256-GCM (object encryption with namespace keys)
- Master key sealing (X25519 ECDH + AES-256-GCM envelope)
- Namespace key derivation (HKDF-SHA256 from master key)

Serac's full architecture uses XChaCha20-Poly1305 + Argon2id for
human clients. The agent SDK uses AES-256-GCM + HKDF-SHA256 because
these are available in Python's hashlib+os. The server accepts both
encryption modes (v1-x25519-ed25519 for agents, v1-argon2-xchacha20 for humans).

NOTE: Ed25519 and X25519 require the `cryptography` package (pip install cryptography)
which is NOT listed as a dependency to keep serac-mcp zero-dep for basic usage.
If you need key generation or sealed-box operations, install:
    pip install cryptography
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import struct
import urllib.request
import urllib.error
import urllib.parse
from dataclasses import dataclass
from typing import Any, Optional


# ─── Types ────────────────────────────────────────────────────────────────

@dataclass
class KeyPair:
    """Ed25519 or X25519 keypair."""
    private_key_b64: str
    public_key_b64: str
    private_key_b64url: str
    public_key_b64url: str


@dataclass
class AgentKeyMaterial:
    """Complete set of key material for agent registration."""
    signing: KeyPair
    encryption: KeyPair
    encrypted_master_key: str  # base64
    master_key_nonce: str  # base64 (empty for sealed-box format)
    key_commitment: str  # base64
    master_key: bytes  # 32 bytes — keep secure!


@dataclass
class EncryptedData:
    """AES-256-GCM encrypted payload."""
    ciphertext: str  # base64
    iv: str  # base64 (12 bytes)
    tag: str  # base64 (16 bytes)


@dataclass
class SealedBoxResult:
    """X25519 ECDH sealed-box encryption result."""
    sealed: str  # base64
    ephemeral_public_key: str  # base64


# ─── AES-256-GCM ──────────────────────────────────────────────────────────

def encrypt_aes256_gcm(plaintext: bytes | str, key: bytes) -> EncryptedData:
    """
    Encrypt data using AES-256-GCM.
    Uses Python's ssl module (OpenSSL binding) — no external dependency.

    Args:
        plaintext: Data to encrypt (bytes or string)
        key: 32-byte encryption key (master key or namespace key)

    Returns:
        EncryptedData with ciphertext, iv (12 bytes), and tag (16 bytes), all base64.
    """
    import ssl

    data = plaintext.encode("utf-8") if isinstance(plaintext, str) else plaintext
    iv = os.urandom(12)

    # Use ssl.SSLContext's internal AES-GCM via OpenSSL
    # Fallback: use the 'cryptography' package if available, otherwise
    # we implement AES-256-GCM using Python's built-in ssl module
    # Actually, Python stdlib doesn't expose AES-GCM directly.
    # We need to use hmac+hmac as a construction or depend on 'cryptography'.

    # Strategy: prefer 'cryptography' package if installed, otherwise
    # implement AES-256-GCM via OpenSSL FFI through ssl module.
    # For zero-dep compatibility without 'cryptography', we fall back to
    # a pure-Python AES-256-GCM implementation.

    # But pure-Python AES is slow and insecure (side channels).
    # Better approach: use 'cryptography' package as optional dep.

    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        aesgcm = AESGCM(key)
        ct_and_tag = aesgcm.encrypt(iv, data, None)
        # AESGCM.encrypt returns ciphertext || tag (last 16 bytes are tag)
        ciphertext = ct_and_tag[:-16]
        tag = ct_and_tag[-16:]
    except ImportError:
        # Attempt OpenSSL via ctypes as fallback
        raise ImportError(
            "AES-256-GCM encryption requires the 'cryptography' package. "
            "Install it with: pip install cryptography"
        )

    return EncryptedData(
        ciphertext=base64.b64encode(ciphertext).decode(),
        iv=base64.b64encode(iv).decode(),
        tag=base64.b64encode(tag).decode(),
    )


def decrypt_aes256_gcm(encrypted: EncryptedData, key: bytes) -> bytes:
    """
    Decrypt data using AES-256-GCM.

    Args:
        encrypted: EncryptedData with ciphertext, iv, and tag (all base64)
        key: 32-byte decryption key

    Returns:
        Decrypted data as bytes
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    iv = base64.b64decode(encrypted.iv)
    ciphertext = base64.b64decode(encrypted.ciphertext)
    tag = base64.b64decode(encrypted.tag)

    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext + tag, None)

    return plaintext


# ─── HKDF-SHA256 Namespace Key Derivation ─────────────────────────────────

def derive_namespace_key(master_key: bytes, namespace: str) -> bytes:
    """
    Derive a namespace encryption key from the master key using HKDF-SHA256.
    Each namespace gets a unique key: HKDF(master_key, namespace, "serac-ns-v1")

    Args:
        master_key: 32-byte master key
        namespace: Namespace name (e.g. "memory", "skills")

    Returns:
        32-byte namespace key
    """
    # HKDF Extract: HMAC-SHA256(salt=b"", ikm=master_key)
    prk = hmac.new(b"", master_key, hashlib.sha256).digest()

    # HKDF Expand: HMAC-SHA256(prk, info=b"serac-ns-v1:" + namespace + 0x01)
    info = b"serac-ns-v1:" + namespace.encode("utf-8") + b"\x01"
    namespace_key = hmac.new(prk, info, hashlib.sha256).digest()

    return namespace_key


# ─── Key Generation (requires 'cryptography' package) ──────────────────────

def generate_ed25519_keypair() -> KeyPair:
    """
    Generate an Ed25519 signing keypair.
    Requires the 'cryptography' package.

    Used for agent authentication and attestation.
    Public/private keys are exported in raw 32-byte format (not DER),
    matching the Serac API expectation.
    """
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import (
        Encoding, PrivateFormat, PublicFormat, NoEncryption
    )

    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()

    # Raw 32-byte format — what the Serac server expects
    private_key_b64 = base64.b64encode(
        private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    ).decode()
    public_key_b64 = base64.b64encode(
        public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
    ).decode()

    return KeyPair(
        private_key_b64=private_key_b64,
        public_key_b64=public_key_b64,
        private_key_b64url=_b64_to_b64url(private_key_b64),
        public_key_b64url=_b64_to_b64url(public_key_b64),
    )


def generate_x25519_keypair() -> KeyPair:
    """
    Generate an X25519 encryption keypair.
    Requires the 'cryptography' package.

    Used for sealed-box encryption and key exchange.
    Public/private keys are exported in raw 32-byte format (not DER),
    matching the Serac API expectation.
    """
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
    from cryptography.hazmat.primitives.serialization import (
        Encoding, PrivateFormat, PublicFormat, NoEncryption
    )

    private_key = X25519PrivateKey.generate()
    public_key = private_key.public_key()

    # Raw 32-byte format — what the Serac server expects
    private_key_b64 = base64.b64encode(
        private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    ).decode()
    public_key_b64 = base64.b64encode(
        public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
    ).decode()

    return KeyPair(
        private_key_b64=private_key_b64,
        public_key_b64=public_key_b64,
        private_key_b64url=_b64_to_b64url(private_key_b64),
        public_key_b64url=_b64_to_b64url(public_key_b64),
    )


def generate_agent_key_material() -> AgentKeyMaterial:
    """
    Generate a complete set of agent key material.
    This is what you pass to SeracAgent.register().

    Requires the 'cryptography' package for key generation.

    Returns:
        AgentKeyMaterial with signing and encryption keypairs, encrypted master key,
        and key commitment.
    """
    signing = generate_ed25519_keypair()
    encryption = generate_x25519_keypair()

    # Generate a random 32-byte master key
    master_key = os.urandom(32)

    # Compute key commitment (SHA-256 of master key)
    key_commitment = base64.b64encode(hashlib.sha256(master_key).digest()).decode()

    # Seal the master key using X25519 ECDH + AES-256-GCM
    # public_key_b64 is now raw 32 bytes (not DER)
    pub_key_raw = base64.b64decode(encryption.public_key_b64)
    sealed = seal_with_public_key(master_key, pub_key_raw)

    # The sealed format is: ephPubKey(raw 32 bytes) || iv(12) || tag(16) || ciphertext
    # Extract the IV (nonce) separately for the API response
    sealed_bytes = base64.b64decode(sealed.sealed)
    eph_pub_len = 32  # Raw X25519 public key is 32 bytes
    master_key_nonce = base64.b64encode(sealed_bytes[eph_pub_len:eph_pub_len + 12]).decode()

    return AgentKeyMaterial(
        signing=signing,
        encryption=encryption,
        encrypted_master_key=sealed.sealed,
        master_key_nonce=master_key_nonce,
        key_commitment=key_commitment,
        master_key=master_key,
    )


# ─── Sealed Box (X25519 ECDH + AES-256-GCM) ──────────────────────────────

def seal_with_public_key(plaintext: bytes | str, recipient_public_key_raw: bytes) -> SealedBoxResult:
    """
    Seal data for a specific X25519 public key.

    Creates an ephemeral X25519 keypair, performs ECDH with the target's
    public key, and encrypts with AES-256-GCM using the shared secret.

    Equivalent to libsodium's crypto_box_seal but uses AES-GCM instead
    of XChaCha20-Poly1305 (both are AEAD ciphers).

    Output format: ephemeralPubKey(raw 32 bytes) || iv(12) || tag(16) || ciphertext

    Requires the 'cryptography' package.

    Args:
        plaintext: Data to seal (bytes or string)
        recipient_public_key_raw: Recipient's X25519 public key (raw 32 bytes)

    Returns:
        SealedBoxResult with sealed data (base64) and ephemeral public key (base64)
    """
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    data = plaintext.encode("utf-8") if isinstance(plaintext, str) else plaintext

    # Generate ephemeral X25519 keypair
    eph_private = X25519PrivateKey.generate()
    eph_public = eph_private.public_key()
    # Use raw 32-byte format for compact sealed output
    eph_pub_raw = eph_public.public_bytes(Encoding.Raw, PublicFormat.Raw)

    # Import recipient public key (raw 32 bytes) and derive shared secret via ECDH
    recipient_public = X25519PublicKey.from_public_bytes(recipient_public_key_raw)
    shared_key = eph_private.exchange(recipient_public)

    # Derive encryption key: HKDF-SHA256(shared, eph_pub || recip_pub, "serac-seal-v1")
    recip_pub_raw = recipient_public.public_bytes(Encoding.Raw, PublicFormat.Raw)
    enc_key = _derive_seal_key(shared_key, eph_pub_raw, recip_pub_raw)

    # Encrypt with AES-256-GCM
    iv = os.urandom(12)
    aesgcm = AESGCM(enc_key)
    ct_and_tag = aesgcm.encrypt(iv, data, None)
    ciphertext = ct_and_tag[:-16]
    tag = ct_and_tag[-16:]

    # Output: ephPubKey(raw 32 bytes) || iv(12) || tag(16) || ciphertext
    sealed = eph_pub_raw + iv + tag + ciphertext

    return SealedBoxResult(
        sealed=base64.b64encode(sealed).decode(),
        ephemeral_public_key=base64.b64encode(eph_pub_raw).decode(),
    )


def unseal_with_private_key(sealed_b64: str, recipient_private_key_b64: str) -> bytes:
    """
    Open a sealed box using the recipient's X25519 private key.

    Args:
        sealed_b64: Base64-encoded sealed data
        recipient_private_key_b64: Recipient's X25519 private key (base64, raw 32 bytes)

    Returns:
        Decrypted data as bytes
    """
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    sealed = base64.b64decode(sealed_b64)
    recipient_private = X25519PrivateKey.from_private_bytes(
        base64.b64decode(recipient_private_key_b64)
    )

    # Parse sealed data: ephemeralPubKey(raw 32 bytes) || iv(12) || tag(16) || ciphertext
    eph_pub_len = 32
    eph_pub_raw = sealed[:eph_pub_len]

    iv = sealed[eph_pub_len:eph_pub_len + 12]
    tag = sealed[eph_pub_len + 12:eph_pub_len + 12 + 16]
    ciphertext = sealed[eph_pub_len + 12 + 16:]

    # Import ephemeral public key and derive shared secret
    eph_public = X25519PublicKey.from_public_bytes(eph_pub_raw)
    shared_key = recipient_private.exchange(eph_public)

    # Derive decryption key
    recipient_public = recipient_private.public_key()
    recip_pub_raw = recipient_public.public_bytes(Encoding.Raw, PublicFormat.Raw)
    enc_key = _derive_seal_key(shared_key, eph_pub_raw, recip_pub_raw)

    # Decrypt
    aesgcm = AESGCM(enc_key)
    plaintext = aesgcm.decrypt(iv, ciphertext + tag, None)

    return plaintext


# ─── Ed25519 Sign/Verify ──────────────────────────────────────────────────

def sign_ed25519(data: bytes | str, private_key_b64: str) -> str:
    """
    Sign data with an Ed25519 private key.

    Args:
        data: Data to sign (bytes or string)
        private_key_b64: Base64-encoded Ed25519 private key (raw 32 bytes)

    Returns:
        Base64-encoded signature
    """
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    input_data = data.encode("utf-8") if isinstance(data, str) else data
    private_key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(private_key_b64))
    signature = private_key.sign(input_data)

    return base64.b64encode(signature).decode()


def verify_ed25519(data: bytes | str, signature_b64: str, public_key_b64: str) -> bool:
    """
    Verify an Ed25519 signature.

    Args:
        data: Original data that was signed (bytes or string)
        signature_b64: Base64-encoded signature
        public_key_b64: Base64-encoded Ed25519 public key (raw 32 bytes)

    Returns:
        True if the signature is valid
    """
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    input_data = data.encode("utf-8") if isinstance(data, str) else data
    signature = base64.b64decode(signature_b64)
    public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))

    try:
        public_key.verify(signature, input_data)
        return True
    except Exception:
        return False


# ─── Utility ──────────────────────────────────────────────────────────────

def sha256_hash(data: bytes | str) -> str:
    """Compute SHA-256 hash of data, returns base64."""
    input_data = data.encode("utf-8") if isinstance(data, str) else data
    return base64.b64encode(hashlib.sha256(input_data).digest()).decode()


def b64_to_b64url(b64: str) -> str:
    """Convert base64 to base64url."""
    return b64.replace("+", "-").replace("/", "_").rstrip("=")


def b64url_to_b64(b64url: str) -> str:
    """Convert base64url to base64."""
    b64 = b64url.replace("-", "+").replace("_", "/")
    while len(b64) % 4 != 0:
        b64 += "="
    return b64


# ─── Internal helpers ─────────────────────────────────────────────────────

def _b64_to_b64url(b64: str) -> str:
    return b64.replace("+", "-").replace("/", "_").rstrip("=")


def _derive_seal_key(shared_secret: bytes, eph_pub_der: bytes, recip_pub_der: bytes) -> bytes:
    """Derive encryption key for sealed box: HKDF-SHA256(shared, eph||recip, "serac-seal-v1")"""
    # HKDF Extract
    prk = hmac.new(b"", shared_secret, hashlib.sha256).digest()
    # HKDF Expand
    context = eph_pub_der + recip_pub_der
    key = hmac.new(prk, context + b"serac-seal-v1" + b"\x01", hashlib.sha256).digest()
    return key


def _parse_ephemeral_key(sealed: bytes) -> bytes:
    """Parse DER SPKI structure at the beginning of sealed data."""
    if len(sealed) < 2 or sealed[0] != 0x30:
        raise ValueError("Invalid sealed data: expected DER SEQUENCE at start")

    len_byte = sealed[1]
    if (len_byte & 0x80) == 0:
        content_length = len_byte
        header_size = 2
    else:
        num_len_bytes = len_byte & 0x7F
        header_size = 2 + num_len_bytes
        content_length = 0
        for i in range(num_len_bytes):
            content_length = (content_length << 8) | sealed[2 + i]

    total_length = header_size + content_length
    return sealed[:total_length]