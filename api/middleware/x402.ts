/**
 * x402 Payment Middleware
 *
 * Implements the HTTP 402 Payment Required protocol for agent requests.
 * When a vault uses payment_method = 'x402', the middleware:
 * 1. Checks monthly spending limit
 * 2. If limit exceeded, returns 402 with payment instructions
 * 3. If spending is within limits, passes through to the route handler
 * 4. After successful request, increments spending counter
 *
 * For free-tier and stripe vaults, this middleware is a no-op.
 *
 * ADR: x402 spec — USDC on Base L2, EIP-712 typed data signatures
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { sql } from "../db/connection.js";

// Pricing per operation (in cents)
const OPERATION_COSTS: Record<string, number> = {
  "POST /objects/store": 1,         // 1 cent per store
  "POST /objects/store/direct": 1,  // 1 cent per direct store
  "POST /objects/confirm": 0,       // Free (part of store flow)
  "GET /objects/retrieve": 0,       // Free (reads are free for now)
  "GET /objects/list": 0,           // Free
  "DELETE /objects/delete": 0,      // Free
  "GET /quota": 0,                  // Free (self-service)
  "POST /objects/share": 2,         // 2 cents per share
  "GET /objects/attest": 1,         // 1 cent per attestation
  "POST /objects/archive": 1,       // 1 cent per archive
};

/** Cost in cents for the request, or 0 if free/untracked */
function getOperationCost(request: FastifyRequest): number {
  const key = `${request.method} ${request.url.replace(/^\/api\/agent/, "")}`;
  // Try exact match first
  if (key in OPERATION_COSTS) return OPERATION_COSTS[key];
  // Try prefix match for dynamic routes
  for (const [pattern, cost] of Object.entries(OPERATION_COSTS)) {
    if (key.startsWith(pattern)) return cost;
  }
  return 0; // Unknown operations = free (safe default)
}

/**
 * Get current month usage in cents for a vault, resetting if new month.
 */
async function getCurrentMonthUsage(vaultId: string): Promise<{ usageCents: number; monthStart: Date }> {
  const [vault] = await sql`
    SELECT current_month_usage_cents, current_month_start
    FROM agent_vaults
    WHERE id = ${vaultId}
  `;

  if (!vault) return { usageCents: 0, monthStart: new Date() };

  const now = new Date();
  const monthStart = vault["current_month_start"] ? new Date(vault["current_month_start"] as string | Date) : null;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Reset if month has changed or never set
  if (!monthStart || monthStart < startOfMonth) {
    await sql`
      UPDATE agent_vaults
      SET current_month_usage_cents = 0,
          current_month_start = ${startOfMonth}
      WHERE id = ${vaultId}
    `;
    return { usageCents: 0, monthStart: startOfMonth };
  }

  return {
    usageCents: Number(vault["current_month_usage_cents"]) || 0,
    monthStart: monthStart,
  };
}

/**
 * Increment monthly spending for a vault.
 * Called AFTER a successful paid operation.
 */
async function incrementSpending(vaultId: string, costCents: number): Promise<void> {
  await sql`
    UPDATE agent_vaults
    SET current_month_usage_cents = current_month_usage_cents + ${costCents}
    WHERE id = ${vaultId}
  `;
}

/**
 * x402 Payment Required response.
 * Follows the x402 spec: returns 402 with payment details.
 */
function send402Response(
  reply: FastifyReply,
  vaultId: string,
  usageCents: number,
  limitCents: number,
  walletAddress: string | null,
): FastifyReply {
  // x402 spec response — tells the client where to pay and how much
  const paymentData: Record<string, unknown> = {
    error: "Payment required",
    code: "PAYMENT_REQUIRED",
    details: {
      payment_method: "x402",
      amount_cents: limitCents - usageCents, // Remaining to unlock
      currency: "USDC",
      network: "base", // Base L2
      // The Serac Treasury wallet (env-configured)
      pay_to: process.env["X402_TREASURY_WALLET"] || "0x0000000000000000000000000000000000000000",
      usage_cents: usageCents,
      limit_cents: limitCents,
      reset_date: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
    },
  };

  if (walletAddress) {
    paymentData.details["from_wallet"] = walletAddress;
  }

  return reply
    .status(402)
    .header("X-Payment-Required", "x402")
    .header("X-Payment-Amount", String(limitCents - usageCents))
    .header("X-Payment-Currency", "USDC")
    .header("X-Payment-Network", "base")
    .send(paymentData);
}

/**
 * Main middleware: x402 payment check for agent requests.
 *
 * Flow:
 * 1. Skip if vault is not x402 payment method
 * 2. Get monthly usage and check against spending limit
 * 3. If over limit, return 402 with payment instructions
 * 4. If under limit, pass through and track cost after response
 */
export async function x402Middleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const vaultId = request.vaultId;
  if (!vaultId) return; // No vault context, skip

  // Get vault payment info
  const [vault] = await sql`
    SELECT payment_method, x402_wallet_address, x402_spending_limit_cents
    FROM agent_vaults
    WHERE id = ${vaultId}
  `;

  if (!vault) return; // Vault not found, skip (let auth middleware handle this)

  const paymentMethod = vault["payment_method"] as string;
  const walletAddress = vault["x402_wallet_address"] as string | null;
  const spendingLimit = vault["x402_spending_limit_cents"] as number | null;

  // Only apply x402 to vaults that actually use it
  if (paymentMethod !== "x402") return;

  // Free tier with no spending limit = unlimited (but payment_method=x402 without limit is weird)
  if (!spendingLimit || spendingLimit <= 0) return; // No limit = no check

  // Get current cost for this operation
  const costCents = getOperationCost(request);

  // Get current monthly usage
  const { usageCents } = await getCurrentMonthUsage(vaultId);

  // Check if operation would exceed limit
  if (usageCents + costCents > spendingLimit) {
    send402Response(reply, vaultId, usageCents, spendingLimit, walletAddress);
    return; // Don't call next — request is blocked
  }

  // If we reach here, the request is allowed.
  // Track spending AFTER successful response.
  if (costCents > 0) {
    // Use onResponse hook to track spending only on success (2xx)
    reply.raw.on("finish", async () => {
      if (reply.raw.statusCode >= 200 && reply.raw.statusCode < 300) {
        try {
          await incrementSpending(vaultId, costCents);
        } catch (err) {
          // Spending tracking failure should NOT break the request
          console.error(`Failed to track x402 spending for vault ${vaultId}:`, err);
        }
      }
    });
  }
}