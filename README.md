# Serac Agents

**Sovereign E2E cloud storage for AI agents.** MCP-native, zero-knowledge, RGPD-compliant, built in France.

## What is Serac?

Serac is an encrypted cloud storage platform designed for autonomous AI agents. It provides persistent, E2E-encrypted memory that agents can read and write via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

Every agent gets its own encrypted vault with namespace-based organization. Data is encrypted client-side before upload — even Serac cannot read your agent's data.

## Features

- **MCP-native** — Works as a standard MCP server over streamable HTTP
- **E2E encryption** — X25519 sealed-box + AES-256-GCM, zero-knowledge server
- **Namespaces** — Organize data by type: `memory`, `context`, `skills`, etc.
- **Agent self-registration** — No human setup needed, agents register autonomously
- **Attestation** — Cryptographic proof that stored data hasn't been tampered with
- **Object sharing** — Re-encrypt and share objects between agents via X25519
- **Archive/Glacier** — Cold storage for infrequently accessed data
- **x402 payments** — Pay-per-request via Base L2 USDC (optional)
- **RGPD-compliant** — Data hosted in France (OVH Roubaix), full audit log

## MCP Server

**Endpoint:** `https://serac.cloud/api/agent/mcp/v1`

**Transport:** Streamable HTTP with Bearer token auth

### V1 Tools

| Tool | Description |
|------|-------------|
| `serac_store` | Store an encrypted object in a namespace |
| `serac_retrieve` | Retrieve a presigned download URL for an object |
| `serac_list` | List keys in a namespace with prefix filtering |
| `serac_delete` | Soft-delete an object (30-day grace period) |
| `serac_quota` | Check storage usage and plan limits |

### V2 Tools (Preview)

| Tool | Description |
|------|-------------|
| `serac_share` | Share an encrypted object with another agent |
| `serac_attest` | Get cryptographic attestation for a stored object |
| `serac_archive` | Archive an object to cold storage (Glacier) |

## SDKs

### Python (`serac-mcp`)

```bash
pip install serac-mcp
```

```python
from serac_mcp import SeracAgent, generate_agent_key_material

# Generate crypto keys and self-register
keys = generate_agent_key_material()
result = SeracAgent.register(
    agent_name="my-agent",
    ed25519_public_key=keys.signing.public_key_b64,
    x25519_public_key=keys.encryption.public_key_b64,
    encrypted_master_key=keys.encrypted_master_key,
    master_key_nonce=keys.master_key_nonce,
    key_commitment=keys.key_commitment,
)
agent = result["agent"]

# Store and retrieve data
agent.store("memory", "user:prefs", base64_data)
data = agent.retrieve("memory", "user:prefs")
```

### JavaScript (`serac-agent-sdk`)

```bash
npm install serac-agent-sdk
```

```js
import { SeracAgent, generateAgentKeyMaterial } from "serac-agent-sdk";

const keys = await generateAgentKeyMaterial();
const { agent } = await SeracAgent.register({
  agentName: "my-agent",
  ...keys,
});

await agent.store("memory", "user:prefs", base64Data);
```

## Pricing

| Tier | Storage | Price |
|------|---------|-------|
| Agent Free | 5 GB | Free |
| Agent Starter | 100 GB | €3.99/mo |
| Agent Pro | 500 GB | €9.99/mo |
| Agent Fleet | 2 TB | €29.99/mo |

## Architecture

- **Backend:** Fastify + PostgreSQL + Redis
- **Storage:** OVH S3 (eu-west-par, France)
- **Encryption:** X25519 ECDH + AES-256-GCM (agents) / Argon2id + XChaCha20-Poly1305 (humans)
- **Auth:** Ed25519 challenge-response + API key exchange → JWT (HMAC-SHA256)
- **Hosting:** OVH Roubaix, France

## Links

- **Website:** [serac.cloud](https://serac.cloud)
- **Status:** [status.serac.cloud](https://status.serac.cloud)
- **PyPI:** [pypi.org/project/serac-mcp](https://pypi.org/project/serac-mcp/)
- **npm:** [npmjs.com/package/serac-agent-sdk](https://www.npmjs.com/package/serac-agent-sdk)
- **Contact:** [info@serac.cloud](mailto:info@serac.cloud)

## License

MIT
