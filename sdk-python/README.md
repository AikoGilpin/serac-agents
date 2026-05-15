# serac-mcp

Sovereign E2E cloud storage SDK for AI agents — Python edition.

Zero runtime dependencies. Python 3.10+. Uses only stdlib `hashlib`, `hmac`, `os`, `urllib.request`, `json`.

## Installation

```bash
pip install serac-mcp
```

## Quick Start

```python
from serac_mcp import SeracAgent, generate_agent_key_material

# 1. Generate key material (Ed25519 + X25519 + master key)
keys = generate_agent_key_material()

# 2. Self-register a vault
result = SeracAgent.register(
    agent_name="my-agent",
    ed25519_public_key=keys.signing.public_key_b64,
    x25519_public_key=keys.encryption.public_key_b64,
    encrypted_master_key=keys.encrypted_master_key,
    master_key_nonce=keys.master_key_nonce,
    key_commitment=keys.key_commitment,
)
agent = result["agent"]
vault_id = result["vault_id"]

# 3. Store encrypted data
from serac_mcp import derive_namespace_key, encrypt_aes256_gcm
ns_key = derive_namespace_key(keys.master_key, "memory")
encrypted = encrypt_aes256_gcm('{"role": "assistant", "content": "Hello"}', ns_key)
agent.store("memory", "greeting", encrypted.ciphertext_b64)

# 4. Retrieve
agent.retrieve("memory", "greeting")

# 5. List
agent.list("memory")

# 6. Delete
agent.delete("memory", "greeting")

# 7. Check quota
agent.quota()
```

## Authentication

Two methods:

1. **API Key** (quick start): `SeracAgent.from_api_key("sk_serac_...")`
2. **Ed25519 Challenge-Response** (session renewal): Automatic JWT renewal

## V2 Tools (Preview)

```python
# Share with another agent
agent.share("memory", "prefs", target_x25519_pubkey, permission="read")

# Cryptographic attestation
agent.attest("memory", "prefs")

# Archive to Glacier
agent.archive("memory", "old-data")
```

## Crypto Module

All E2EE primitives available standalone — no external dependencies:

| Function | Description |
|----------|-------------|
| `generate_ed25519_keypair()` | Ed25519 signing keypair |
| `generate_x25519_keypair()` | X25519 encryption keypair |
| `generate_agent_key_material()` | Full agent keygen |
| `encrypt_aes256_gcm(plaintext, key)` | AES-256-GCM encrypt |
| `decrypt_aes256_gcm(enc, key)` | AES-256-GCM decrypt |
| `derive_namespace_key(master_key, name)` | HKDF-SHA256 namespace key |
| `seal_with_public_key(plaintext, pubkey_der)` | X25519 sealed box |
| `unseal_with_private_key(sealed_b64, privkey_b64)` | Open sealed box |
| `sign_ed25519(data, privkey_b64)` | Ed25519 sign |
| `verify_ed25519(data, sig_b64, pubkey_b64)` | Ed25519 verify |
| `sha256_hash(data)` | SHA-256 hash |

## MCP Configuration

Add to your agent config:

```yaml
mcp_servers:
  serac:
    url: "https://serac.cloud/api/agent/mcp/v1"
    headers:
      Authorization: "Bearer sk_serac_your_api_key"
```

## Pricing

| Tier | Storage | Price |
|------|---------|-------|
| Agent Free | 5 GB | €0 |
| Agent Starter | 100 GB | €3.99/mo |
| Agent Pro | 500 GB | €9.99/mo |
| Agent Fleet | 2 TB | €29.99/mo |

Automatic tiering (hot → warm → cold → Glacier) for cost optimization.

## Interop

The Python SDK (`serac-mcp`) and TypeScript SDK (`serac-agent-sdk`) use identical crypto primitives:
- Ed25519 for signing
- X25519 for encryption
- AES-256-GCM with HKDF-SHA256 for namespace key derivation
- Sealed box format: `ephPubKey(DER) || iv(12) || tag(16) || ciphertext`

Cross-SDK test vectors verified (ADR-001 §10).

## License

MIT © [Serac](https://serac.cloud)