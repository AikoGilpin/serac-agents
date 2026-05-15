-- Migration 020: vault_shares — inter-agent sharing via X25519 sealed-box re-encryption
--
-- Enables an agent to share an encrypted object with another agent
-- without the server ever seeing the plaintext or the shared key.
--
-- Flow:
-- 1. Agent A calls POST /objects/share with target_agent_pubkey (X25519)
-- 2. Server re-encrypts the object's namespace key using the target's X25519 pubkey
--    (sealed box — server can't decrypt, only target can)
-- 3. Target agent B calls GET /objects/shared/:shareId to retrieve the re-encrypted key
-- 4. B decrypts with their X25519 private key, then decrypts the object data
--
-- Permissions: read (default) or read_write (allows target to modify)
-- Expiration: optional TTL in seconds

CREATE TABLE IF NOT EXISTS vault_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who shared
  from_vault_id UUID NOT NULL REFERENCES agent_vaults(id) ON DELETE CASCADE,
  from_namespace_id UUID NOT NULL REFERENCES agent_namespaces(id) ON DELETE CASCADE,
  -- Who receives
  to_vault_id UUID NOT NULL REFERENCES agent_vaults(id) ON DELETE CASCADE,
  -- What was shared
  object_id UUID NOT NULL REFERENCES agent_objects(id) ON DELETE CASCADE,
  -- Re-encrypted namespace key for the target (X25519 sealed box)
  encrypted_namespace_key BYTEA NOT NULL,
  namespace_key_nonce BYTEA NOT NULL,
  -- Target's X25519 pubkey used for re-encryption (for verification)
  target_x25519_pubkey BYTEA NOT NULL,
  -- Permission level
  permission TEXT NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'read_write')),
  -- Expiration
  expires_at TIMESTAMP WITH TIME ZONE,
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_vault_shares_from ON vault_shares (from_vault_id, is_active);
CREATE INDEX IF NOT EXISTS idx_vault_shares_to ON vault_shares (to_vault_id, is_active);
CREATE INDEX IF NOT EXISTS idx_vault_shares_object ON vault_shares (object_id);
CREATE INDEX IF NOT EXISTS idx_vault_shares_expires ON vault_shares (expires_at) WHERE expires_at IS NOT NULL;

-- Migration 020 also adds archive_status to agent_objects for P4

ALTER TABLE agent_objects
  ADD COLUMN IF NOT EXISTS archive_status TEXT DEFAULT 'active' CHECK (archive_status IN ('active', 'archiving', 'archived', 'restoring')),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS restore_requested_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS s3_archive_key TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_objects_archive ON agent_objects (archive_status) WHERE archive_status != 'active';