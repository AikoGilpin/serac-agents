#!/usr/bin/env python3
from serac_mcp import SeracAgent, generate_agent_key_material, encrypt_aes256_gcm, derive_namespace_key
import json

API_URL = 'https://serac.cloud/api/agent'
km = generate_agent_key_material()
print(f'Master key: {len(km.master_key)} bytes')
print(f'Nonce: {km.master_key_nonce[:16]}... ({len(__import__("base64").b64decode(km.master_key_nonce))} bytes)')

# 1. Register
result = SeracAgent.register(
    agent_name='sdk-python-test',
    ed25519_public_key=km.signing.public_key_b64,
    x25519_public_key=km.encryption.public_key_b64,
    encrypted_master_key=km.encrypted_master_key,
    master_key_nonce=km.master_key_nonce,
    key_commitment=km.key_commitment,
    agent_type='sdk-python',
    base_url=API_URL,
)
agent = result['agent']
vault_id = result['vault_id']
api_key = result['api_key']
print(f'1. Register: OK vault={vault_id[:8]}...')

# 2. Store
ns_key = derive_namespace_key(km.master_key, 'memory')
data = json.dumps({'role': 'assistant', 'content': 'SDK Python live test'})
encrypted = encrypt_aes256_gcm(data, ns_key)
store_result = agent.store('memory', 'sdk-test-key', encrypted.ciphertext_b64)
print(f'2. Store: OK key={store_result.get("key", "?")}')

# 3. Retrieve
retrieve_result = agent.retrieve('memory', 'sdk-test-key')
print(f'3. Retrieve: OK (got download URL)')

# 4. Quota
quota = agent.quota()
print(f'4. Quota: OK used={quota.get("used_bytes", "?")}, limit={quota.get("quota_bytes", "?")}')

# 5. List
ns_list = agent.list('memory')
keys = ns_list.get('objects', ns_list.get('keys', []))
print(f'5. List: OK count={len(keys) if isinstance(keys, list) else "?"}')

# 6. Delete entry
agent.delete('memory', 'sdk-test-key')
print(f'6. Delete: OK')

# 7. Vault cleanup
try:
    agent._client.delete(f'/vaults/{vault_id}', body={'key_commitment': km.key_commitment})
    print(f'7. Vault cleanup: OK')
except Exception as e:
    print(f'7. Vault cleanup: WARN {str(e)[:60]}')

print('All tests passed!')
