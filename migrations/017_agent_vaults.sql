-- ============================================================
-- Sérac - Migration 017: Agent vaults & namespaces
-- Agent-native E2E encrypted cloud storage
--
-- Tables:
--   agent_vaults      — Agent identity (Ed25519 pubkey, encrypted MK, plan)
--   agent_namespaces  — Isolated storage namespaces per vault
--   agent_audit_log   — Append-only audit trail (no UPDATE/DELETE)
--   vault_guardians   — Recovery escrow (owner X25519 pubkey)
--   agent_api_keys    — API key authentication for MCP
--
-- Design decisions (ADR-001, ADR-002, ADR-005):
-- - No agent_sessions table: auth is stateless JWT + Redis challenges
-- - Vault (not "account"): brand identity for E2E product
-- - API key + Ed25519 challenge-response hybrid auth
-- - Guardian model: owner escrow V1, multi-guardian V2
-- - Append-only audit log: enforced via trigger (raise on UPDATE/DELETE)
-- ============================================================

-- Enable crypto extension (should already exist)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- AGENT VAULTS
-- ============================================================

CREATE TABLE agent_vaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Owner relationship (nullable for autonomous agents, V1: always linked to human)
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Identity
    vault_name TEXT NOT NULL,                        -- Human-readable name for the vault
    ed25519_public_key BYTEA NOT NULL,              -- Ed25519 pubkey (signing + auth)
    x25519_public_key BYTEA NOT NULL,               -- X25519 pubkey (derived from Ed25519, for encryption)

    -- Encrypted Master Key (sealed box: crypto_box_seal with agent's X25519 pubkey)
    encrypted_master_key BYTEA NOT NULL,            -- MK encrypted via sealed box
    master_key_nonce BYTEA NOT NULL,                -- Nonce for MK sealed box (future use)

    -- Key commitment (BLAKE2b-256 of Master Key, anti multi-key attack)
    key_commitment BYTEA NOT NULL,

    -- Algorithm versioning (quantum-ready)
    key_algorithm TEXT NOT NULL DEFAULT 'v1-x25519-ed25519',

    -- Plan & billing
    plan_id UUID REFERENCES plans(id),
    stripe_customer_id TEXT,                         -- Can share owner's Stripe customer
    storage_used_bytes BIGINT DEFAULT 0,
    object_count INTEGER DEFAULT 0,

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    disabled_at TIMESTAMPTZ,
    disabled_reason TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_vault_name_per_owner UNIQUE (owner_id, vault_name)
);

CREATE INDEX idx_agent_vaults_owner ON agent_vaults (owner_id);
CREATE INDEX idx_agent_vaults_ed25519 ON agent_vaults (ed25519_public_key);
CREATE INDEX idx_agent_vaults_active ON agent_vaults (is_active) WHERE is_active = TRUE;

-- ============================================================
-- AGENT NAMESPACES
-- ============================================================

CREATE TABLE agent_namespaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vault_id UUID NOT NULL REFERENCES agent_vaults(id) ON DELETE CASCADE,

    -- Namespace identity
    name TEXT NOT NULL,                              -- e.g. "memory", "skills", "work"
    description TEXT,                                -- Optional human-readable description

    -- Encryption (per-namespace key, encrypted with Master Key)
    encrypted_namespace_key BYTEA NOT NULL,          -- Namespace key encrypted by MK
    namespace_key_nonce BYTEA NOT NULL,

    -- Usage tracking
    storage_used_bytes BIGINT DEFAULT 0,
    object_count INTEGER DEFAULT 0,

    -- Namespace-level TTL (optional)
    default_ttl_seconds INTEGER,                    -- 0 = permanent

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_namespace_name_per_vault UNIQUE (vault_id, name)
);

CREATE INDEX idx_agent_namespaces_vault ON agent_namespaces (vault_id);

-- ============================================================
-- AGENT AUDIT LOG (append-only)
-- ============================================================

CREATE TABLE agent_audit_log (
    id BIGSERIAL PRIMARY KEY,
    vault_id UUID NOT NULL REFERENCES agent_vaults(id) ON DELETE CASCADE,
    namespace_id UUID REFERENCES agent_namespaces(id) ON DELETE SET NULL,

    -- Action details
    action TEXT NOT NULL,                            -- 'store', 'retrieve', 'delete', 'share', 'archive', 'attest', 'create_vault', 'create_namespace', 'auth_challenge'
    object_key TEXT,                                 -- Key of the affected object (nullable for vault-level actions)
    size_bytes BIGINT DEFAULT 0,                    -- Bytes transferred (0 for metadata actions)

    -- Auth context
    auth_method TEXT NOT NULL,                       -- 'api_key', 'challenge_response', 'jwt'
    ip_address INET,

    -- Cryptographic attestation (optional, V2)
    ed25519_signature BYTEA,                         -- Agent's Ed25519 signature of the action

    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Append-only enforcement: trigger that raises on UPDATE or DELETE
CREATE OR REPLACE FUNCTION enforce_append_only()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'audit_log is append-only: UPDATE not allowed';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'audit_log is append-only: DELETE not allowed';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_audit_append_only
    BEFORE UPDATE OR DELETE ON agent_audit_log
    FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

-- Performance indexes (partition by time in V2 if needed)
CREATE INDEX idx_audit_vault_time ON agent_audit_log (vault_id, created_at DESC);
CREATE INDEX idx_audit_namespace ON agent_audit_log (namespace_id) WHERE namespace_id IS NOT NULL;
CREATE INDEX idx_audit_action ON agent_audit_log (action);

-- ============================================================
-- VAULT GUARDIANS (recovery escrow)
-- ============================================================

CREATE TABLE vault_guardians (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vault_id UUID NOT NULL REFERENCES agent_vaults(id) ON DELETE CASCADE,

    -- Guardian identity (V1: always the human owner)
    guardian_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    x25519_public_key BYTEA NOT NULL,               -- Owner's X25519 pubkey for sealed box

    -- Master Key encrypted for this guardian
    encrypted_master_key BYTEA NOT NULL,             -- MK sealed-box-encrypted for guardian's X25519 pubkey

    -- Guardian metadata
    relationship TEXT NOT NULL DEFAULT 'owner',      -- 'owner' | 'trusted_contact' (V2)

    -- Verification
    verified_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_guardian_per_vault_user UNIQUE (vault_id, guardian_user_id)
);

CREATE INDEX idx_vault_guardians_vault ON vault_guardians (vault_id);
CREATE INDEX idx_vault_guardians_user ON vault_guardians (guardian_user_id);

-- ============================================================
-- AGENT OBJECTS (encrypted blobs stored on S3)
-- ============================================================

CREATE TABLE agent_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vault_id UUID NOT NULL REFERENCES agent_vaults(id) ON DELETE CASCADE,
    namespace_id UUID NOT NULL REFERENCES agent_namespaces(id) ON DELETE CASCADE,

    -- Object identity
    object_key TEXT NOT NULL,                        -- Human-readable key (e.g. 'memory:user_prefs')
    s3_key TEXT NOT NULL,                            -- S3 object key (agents/{vaultId}/{ns}/{objectId})

    -- Metadata
    size_bytes BIGINT DEFAULT 0,
    content_type TEXT,                               -- MIME type (optional)

    -- Upload flow (presigned URL: pending → confirmed)
    upload_status TEXT NOT NULL DEFAULT 'confirmed', -- 'pending' | 'confirmed'
    upload_token TEXT,                               -- One-time token to confirm presigned upload
    confirmed_at TIMESTAMPTZ,

    -- TTL (optional)
    ttl_seconds INTEGER DEFAULT 0,                  -- 0 = permanent
    expires_at TIMESTAMPTZ,                          -- Auto-delete after this time

    -- Soft delete
    deleted_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_object_per_namespace UNIQUE (vault_id, namespace_id, object_key)
        WHERE deleted_at IS NULL
);

CREATE INDEX idx_agent_objects_vault ON agent_objects (vault_id);
CREATE INDEX idx_agent_objects_namespace ON agent_objects (namespace_id);
CREATE INDEX idx_agent_objects_key ON agent_objects (vault_id, namespace_id, object_key)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_agent_objects_expires ON agent_objects (expires_at)
    WHERE expires_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_agent_objects_upload_pending ON agent_objects (upload_status)
    WHERE upload_status = 'pending';

CREATE TRIGGER tr_agent_objects_updated_at
    BEFORE UPDATE ON agent_objects FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- AGENT API KEYS
-- ============================================================

CREATE TABLE agent_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vault_id UUID NOT NULL REFERENCES agent_vaults(id) ON DELETE CASCADE,

    -- Key material (bcrypt hash, like human auth)
    key_hash TEXT NOT NULL,                          -- bcrypt hash of the API key
    key_prefix TEXT NOT NULL,                        -- First 8 chars for identification (e.g. "sk_serac_1234...")
    key_type TEXT NOT NULL DEFAULT 'full',           -- 'full' | 'readonly' | 'namespace_scoped'

    -- Scoping (nullable = full access)
    namespace_id UUID REFERENCES agent_namespaces(id) ON DELETE SET NULL,

    -- Security
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,                         -- Nullable = no expiry

    -- Status
    is_revoked BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    revoke_reason TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- One vault can have multiple API keys (rotation, scoped access)
    -- Key prefix must be unique for lookup
    CONSTRAINT uq_api_key_prefix UNIQUE (key_prefix)
);

CREATE INDEX idx_agent_api_keys_vault ON agent_api_keys (vault_id);
CREATE INDEX idx_agent_api_keys_prefix ON agent_api_keys (key_prefix) WHERE is_revoked = FALSE;
CREATE INDEX idx_agent_api_keys_namespace ON agent_api_keys (namespace_id) WHERE namespace_id IS NOT NULL;

-- ============================================================
-- AGENT PLANS (seed data)
-- ============================================================

-- Agent-specific plans (separate from human plans)
INSERT INTO plans (name, display_name, storage_bytes, price_cents, glacier_enabled, billing_interval) VALUES
    ('agent_free',      'Agent Free',      5368709120,    0,    FALSE, 'month'),   -- 5 Go
    ('agent_starter',   'Agent Starter',   107374182400,  399,  TRUE,  'month'),   -- 100 Go
    ('agent_pro',       'Agent Pro',       536870912000,  999,  TRUE,  'month'),   -- 500 Go
    ('agent_fleet',     'Agent Fleet',     2199023255552, 2999,  TRUE,  'month');  -- 2 To

-- ============================================================
-- ADD updated_at TRIGGER for agent tables
-- ============================================================

CREATE TRIGGER tr_agent_vaults_updated_at
    BEFORE UPDATE ON agent_vaults FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_agent_namespaces_updated_at
    BEFORE UPDATE ON agent_namespaces FOR EACH ROW EXECUTE FUNCTION update_updated_at();