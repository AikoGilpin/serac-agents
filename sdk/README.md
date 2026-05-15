# serac-agent-sdk

Sovereign E2E cloud storage SDK for AI agents — MCP-native, zero-knowledge, built in France.

## Why Serac?

AI agents need persistent, encrypted storage — but current cloud storage assumes human users (CAPTCHA, email verification, 24-word seed phrases). **Serac is built for agents**: Ed25519 keypair auth, zero human interaction, E2E encrypted from day one.

- **E2E encrypted** — Server never sees your data. X25519 sealed box + AES-256-GCM.
- **Zero runtime dependencies** — Node.js 18+ built-in crypto only. No supply chain risk.
- **Self-registering** — Agents create their own vault via `POST /register`. No CAPTCHA, no email.
- **MCP-native** — HTTP Streamable transport. One config line to connect any MCP-compatible agent.
- **Sovereign** — Hosted in France, RGPD-compliant, open-source.

## Installation

```bash
npm install serac-agent-sdk
```

## Quick Start

```typescript
import { SeracAgent, generateAgentKeyMaterial } from 'serac-agent-sdk';

// 1. Generate key material (Ed25519 + X25519 + master key)
const keys = generateAgentKeyMaterial();

// 2. Self-register a vault
const result = await SeracAgent.register({
  agentName: 'my-agent',
  ed25519PublicKey: keys.signing.publicKeyB64,
  x25519PublicKey: keys.encryption.publicKeyB64,
  encryptedMasterKey: keys.encryptedMasterKey,
  masterKeyNonce: keys.masterKeyNonce,
  keyCommitment: keys.keyCommitment,
});

// 3. Create agent instance
const agent = result.agent;

// 4. Store encrypted data
const nsKey = deriveNamespaceKey(keys.masterKey, 'memory');
const encrypted = encryptAES256GCM(JSON.stringify({ role: 'assistant', content: 'Hello' }), nsKey);
await agent.store('memory', 'greeting', encrypted.ciphertextB64);

// 5. Retrieve
const url = await agent.retrieve('memory', 'greeting');

// 6. List
const objects = await agent.list('memory');

// 7. Delete
await agent.delete('memory', 'greeting');

// 8. Check quota
const quota = await agent.quota();
```

## Authentication

Two methods:

1. **API Key** (quick start): `SeracAgent.fromApiKey('sk_serac_...')` — get your key from the dashboard or registration response
2. **Ed25519 Challenge-Response** (session renewal): Automatic JWT renewal with non-replayable challenges

## V2 Tools (Preview)

```typescript
// Share with another agent (X25519 pubkey exchange)
await agent.share('memory', 'prefs', targetX25519Pubkey, { permission: 'read' });

// Cryptographic attestation
const attestation = await agent.attest('memory', 'prefs');

// Archive to Glacier (cost-optimized cold storage)
await agent.archive('memory', 'old-data');
```

## Crypto Module

All E2EE primitives available standalone — zero external dependencies:

| Function | Description |
|----------|-------------|
| `generateEd25519KeyPair()` | Ed25519 signing keypair |
| `generateX25519KeyPair()` | X25519 encryption keypair |
| `generateAgentKeyMaterial()` | Full agent keygen (Ed25519 + X25519 + master key + commitment) |
| `encryptAES256GCM(plaintext, key)` | AES-256-GCM encrypt |
| `decryptAES256GCM(ciphertext, key, iv, tag)` | AES-256-GCM decrypt |
| `deriveNamespaceKey(masterKey, name)` | HKDF-SHA256 deterministic namespace key |
| `sealWithPublicKey(plaintext, pubkeyDER)` | X25519 ECDH sealed box |
| `unsealWithPrivateKey(sealed, privkeyDER)` | Open sealed box |
| `signEd25519(data, privateKey)` | Ed25519 sign |
| `verifyEd25519(data, signature, publicKey)` | Ed25519 verify |
| `sha256Hash(data)` | SHA-256 hash |

## MCP Configuration

Add to your Hermes Agent or Claude Code config:

```yaml
mcp_servers:
  serac:
    url: "https://serac.cloud/api/agent/mcp/v1"
    headers:
      Authorization: "Bearer sk_serac_your_api_key"
```

## API Reference

### SeracAgent Class

**Factory Methods:**
- `SeracAgent.register(opts)` → Register a new vault (no auth needed)
- `SeracAgent.fromApiKey(apiKey, opts)` → Create from existing API key

**V1 Methods:**
- `agent.store(namespace, key, data)` — Store encrypted data (< 1MB)
- `agent.storePresigned(namespace, key, sizeBytes)` — Get presigned upload URL (> 1MB)
- `agent.storeConfirm(objectId, uploadToken)` — Confirm presigned upload
- `agent.retrieve(namespace, key)` — Get presigned download URL
- `agent.retrieveData(namespace, key)` — Retrieve + auto-decode
- `agent.list(namespace, opts)` — List keys in namespace
- `agent.delete(namespace, key)` — Soft delete object
- `agent.quota()` — Check storage usage

**V2 Methods:**
- `agent.share(namespace, key, targetPubkey, opts)` — Share with another agent
- `agent.listShared(opts)` — List shared objects
- `agent.getShared(shareId)` — Get shared object
- `agent.revokeShare(shareId)` — Revoke share
- `agent.attest(namespace, key)` — Cryptographic attestation
- `agent.archive(namespace, key)` — Archive to Glacier
- `agent.restore(namespace, key)` — Restore from Glacier

## Pricing

| Tier | Storage | Price |
|------|---------|-------|
| Agent Free | 5 GB | €0 |
| Agent Starter | 100 GB | €3.99/mo |
| Agent Pro | 500 GB | €9.99/mo |
| Agent Fleet | 2 TB | €29.99/mo |

With automatic tiering (hot → warm → cold → Glacier) for cost optimization.

## Discovery

Serac supports 4-layer agent discovery:

- `.well-known/mcp.json` — MCP server metadata
- `.well-known/serac.json` — SDK onboarding config (tiers, endpoints)
- `/llms.txt` — LLM-readable service description
- MCP HTTP Streamable — `GET /api/agent/mcp/v1` (SSE)

All accessible at `https://serac.cloud/api/agent/`.

## Architecture

```
Agent calls serac-agent-sdk
  → Ed25519/X25519 keygen (local)
  → AES-256-GCM encryption (local)
  → HKDF namespace derivation (local)
  → Sealed-box master key encryption (local)
  → HTTPS POST/GET to serac.cloud
  → Server stores only ciphertext
  → Server NEVER sees content in cleartext
```

Key hierarchy:
- Ed25519 keypair → authentication + signing
- X25519 (derived) → sealed-box encryption
- Master Key (random 256-bit) → HKDF → namespace keys → file keys → AES-256-GCM content encryption
- Key commitment: BLAKE2b-256 hash for anti-multi-key attack

## License

MIT © [Serac](https://serac.cloud)