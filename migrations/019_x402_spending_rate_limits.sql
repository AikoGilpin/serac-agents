-- Migration 019: x402 spending tracking + rate limiting
--
-- Adds monthly usage tracking for agent vaults with x402 payment.
-- Adds rate limiting counters per vault.

-- Monthly spending tracking for x402 agents
ALTER TABLE agent_vaults
  ADD COLUMN IF NOT EXISTS current_month_usage_cents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_month_start DATE;

-- Index for fast spending queries
CREATE INDEX IF NOT EXISTS idx_agent_vaults_x402_payment
  ON agent_vaults (payment_method, payment_status)
  WHERE payment_method = 'x402';

-- Rate limit tracking: per-vault request counters (Redis would be better, but this is fallback)
CREATE TABLE IF NOT EXISTS agent_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL REFERENCES agent_vaults(id) ON DELETE CASCADE,
  window_type TEXT NOT NULL CHECK (window_type IN ('minute', 'hour', 'day')),
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(vault_id, window_type, window_start)
);

-- Index for rate limit lookups
CREATE INDEX IF NOT EXISTS idx_agent_rate_limits_lookups
  ON agent_rate_limits (vault_id, window_type, window_start DESC);

-- Audit log for x402 payments
CREATE TABLE IF NOT EXISTS agent_x402_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL REFERENCES agent_vaults(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  payment_tx_hash TEXT,            -- On-chain tx hash (Base L2)
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'confirmed', 'failed', 'refunded')),
  endpoint TEXT NOT NULL,          -- Which endpoint was paid for
  request_id TEXT,                 -- Original request ID for idempotency
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_agent_x402_payments_vault
  ON agent_x402_payments (vault_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_x402_payments_status
  ON agent_x402_payments (payment_status, created_at DESC);