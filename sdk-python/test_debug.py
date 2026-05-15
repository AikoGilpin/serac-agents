#!/usr/bin/env python3
from serac_mcp import SeracAgent, generate_agent_key_material, encrypt_aes256_gcm, derive_namespace_key
from serac_mcp.client import HttpClient, SeracError
import json, time

API_URL = 'https://serac.cloud/api/agent'
km = generate_agent_key_material()
print(f'Master key: {len(km.master_key)} bytes')
print(f'Ed25519 pub key: {len(__import__("base64").b64decode(km.signing.public_key_b64))} bytes')

# Try with unique name
unique_name = f'sdk-python-test-{int(time.time())}'

client = HttpClient(api_key="", base_url=API_URL)
body = {
    "agent_name": unique_name,
    "ed25519_public_key": km.signing.public_key_b64,
    "x25519_public_key": km.encryption.public_key_b64,
    "encrypted_master_key": km.encrypted_master_key,
    "master_key_nonce": km.master_key_nonce,
    "key_commitment": km.key_commitment,
    "tier": "agent_free",
    "agent_type": "sdk-python",
}

try:
    result = client.post("/register", body)
    print(f'Server response keys: {list(result.keys())}')
    print(f'Full response: {json.dumps(result, indent=2)[:2000]}')
except SeracError as e:
    print(f'Error: code={e.code}, message={e.message}, status={e.status_code}')
    if e.details:
        print(f'Details: {json.dumps(e.details, indent=2)[:1000]}')
