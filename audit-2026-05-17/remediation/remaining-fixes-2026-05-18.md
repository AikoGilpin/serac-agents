# Serac.cloud Audit — Remaining Fixes Inventory

- Updated UTC: 2026-05-21T13:53:53Z
- Source of truth:
  - `/home/hermes/projects/serac-agents/audit-2026-05-17/99-final-synthesis.md`
  - `/home/hermes/projects/serac-agents/audit-2026-05-17/remediation/00-remediation-log.md`
  - `/home/hermes/projects/serac-agents/audit-2026-05-17/remediation/fixes/*.md`
- Scope note: this report tracks remediation state, not deployment state. Most P0/P1 fixes are not live unless explicitly stated.

## Executive status

### Done / mitigated locally or in branch

- `P0-A` — public agent register free-only: `fixed_local`; needs deploy/live verification.
- `P0-B` — presigned upload real S3 size + atomic quota: `fixed_local`; needs deploy/live verification.
- `P0/P1-D` — presigned upload token generation/hash/TTL/one-time use: `fixed_local`; needs deploy/live verification.
- `P0-C` — container secret-file support + compose secret pattern: `fixed_local`; still needs real secret creation/rotation/deploy.
- `P1-A/B` — API key scope + expiry: `fixed_local`; needs deploy/live verification.
- `P1-C` — x402/payment gate fail-closed: `retargeted_on_live_checkout_verified_not_deployed`; needs deploy/live verification.
- `P1-D` — legacy MCP discovery route: `retargeted_on_live_checkout_verified_not_deployed`; needs deploy/live verification.
- `P1-E` — SDK public package contract: `retargeted_on_live_checkout_verified_not_deployed_not_published`; needs package-release decision.
- `P1-F` — MCP/server-card output schemas: `retargeted_on_live_checkout_verified_not_deployed`; needs deploy/live verification.
- `P1-G` — migration runner/checks: `fixed_local`; needs staging DB bootstrap/prod-safe migration verification.
- `P1-H` — workspaces/local deps guard: `fixed_local`; needs clean install/audit in clean environment if desired.
- `P1-I` — npm lockfile critical/high reduced: `fixed_lockfile_local`; two moderate residuals remain due Next/PostCSS metadata.
- `P1-J` — agent/MCP architecture guardrails: `fixed_local`; deeper service extraction remains future hardening.
- `P1-K` — conservative repo/prod sync: branch pushed, `main` untouched; full repo/assets reconciliation deferred.
- `P1-L` — host failed units/swap-load: current state green; alerting/root-level verification pending.

### Still requiring real remediation / integration

- `P2-A` to `P2-K` — fixed local / verified / not deployed on remediation branch; live deploy verification remains pending.
- `P3-008` — Ed25519 challenge raw-vs-SPKI compatibility: fixed local / verified / not deployed on remediation branch.
- Remaining `P3` polish items — open unless covered by a later explicit fix sheet.

## P0 remaining work

### P0-A — Public self-registration paid bypass

- Current status: `fixed_local`.
- Remaining:
  - merge/push decision for branch vs `main`;
  - deploy/rebuild/restart only after Aiko GO;
  - live verification that public register cannot create paid tiers.

### P0-B — Presigned upload quota bypass

- Current status: `fixed_local`.
- Remaining:
  - deploy/rebuild/restart only after Aiko GO;
  - live/staging E2E verification with real S3 `HeadObject` size;
  - confirm quota-exceeded cleanup behavior on rejected object.

### P0/P1-D — Upload token missing/broken

- Current status: `fixed_local`.
- Remaining:
  - deploy/rebuild/restart only after Aiko GO;
  - staging E2E `store → upload → confirm → retrieve/list/quota`;
  - invalid/expired/reused token negative tests against deployed API.

### P0-C — Secrets exposed via container env/args

- Current status: `fixed_local` support code + compose pattern.
- Remaining:
  - create actual Podman secret files without exposing values;
  - rotate DB/Redis credentials;
  - recreate containers so `_FILE` vars are loaded;
  - verify `podman exec <container> env` no longer reveals secrets;
  - verify DB/Redis connectivity after rotation.
- Requires explicit Aiko GO because it touches live secrets and containers.

## P1 remaining work

### P1-A/B — API key scope and expiry

- Current status: `fixed_local`.
- Remaining:
  - deploy/rebuild/restart only after Aiko GO;
  - live/staging matrix verification for `full`, `readonly`, `namespace_scoped`, expired keys across REST and MCP.

### P1-C — x402/payment-gate fail-closed

- Current status: `retargeted_on_live_checkout_verified_not_deployed`.
- Remaining:
  - deploy/rebuild/restart only after Aiko GO;
  - live/staging verification that paid-tool pricing, missing vault/payment terms, unknown payment methods, missing wallet config all deny rather than allow;
  - production migration/status check for canonical tool-pricing rows only if explicitly approved.

### P1-D — Legacy MCP discovery route

- Current status: `retargeted_on_live_checkout_verified_not_deployed`.
- Remaining:
  - deploy/rebuild/restart only after Aiko GO;
  - live verification that nested `/api/agent/.well-known/mcp.json` redirects/aliases canonically and cannot serve stale endpoint/crypto metadata;
  - verify public discovery + OAuth resource behavior still works.

### P1-E — SDK package public contract

- Current status: `retargeted_on_live_checkout_verified_not_deployed_not_published`.
- Remaining:
  - decide package release strategy (`serac-agent-sdk` publish/reserve/deprecate old names) before any npm action;
  - clean-project install/import test from registry only if package publication/registry validation is explicitly approved;
  - no deploy/rebuild/restart required for SDK package metadata itself unless bundled into a broader release.

### P1-F — MCP output schemas/server-card shapes

- Current status: `retargeted_on_live_checkout_verified_not_deployed`.
- Remaining:
  - deploy/rebuild/restart only after Aiko GO;
  - live/client verification that every `outputSchema` matches real handler output;
  - ideally deduplicate further via single source of truth for tools/server-card/types.

### P1-G — Migrations runner

- Current status: `fixed_local`.
- Remaining:
  - staging DB bootstrap from empty database with canonical runner;
  - upgrade simulation from a production-like snapshot;
  - production migration/status check only after explicit GO.

### P1-H — Workspaces/supply-chain drift

- Current status: `fixed_local`.
- Remaining:
  - full clean install/build in isolated environment if package cache allows;
  - ensure `npm audit --workspaces --include-workspace-root` is reliable on clean clone;
  - decide how to handle large ML/WASM assets outside the conservative branch.

### P1-I — npm vulnerabilities

- Current status: `fixed_lockfile_local`.
- Remaining:
  - residual moderate advisories: Next/PostCSS metadata; current automatic fix suggests bad downgrade path;
  - re-run reliable audit after clean install/workspaces reconciliation;
  - full API/Web/Crypto/SDK tests after dependency lockfile update.

### P1-J — Agent/MCP architecture concentration

- Current status: `fixed_local` guardrails.
- Remaining:
  - deeper extraction still recommended later: `agentObjectService`, quota/payment services, tests around concurrency/payment semantics;
  - root/product lint remains separate from the targeted API checks.

### P1-K — Repo/prod sync and rollback fragility

- Current status: `mitigated_conservative_branch_pushed`.
- Branch: `remediation/p0-p1-audit-2026-05-18`.
- Commit: `9ae54091109525fb64d356ccf7a5cd7e15bc6b1f`.
- Remaining:
  - review/merge/tag/deploy decision;
  - full repo/prod source reconciliation deferred;
  - classify large ML/WASM assets and remaining dirty/untracked source drift;
  - avoid touching `main` until Aiko chooses release policy.

### P1-L — Host ops failed units and swap/load

- Current status: `triaged_current_state_green_alerting_pending`.
- Remaining:
  - add alerting for failed units, logrotate, mdmonitor when arrays exist, load threshold, swap threshold if swap returns;
  - root-level `mdadm --detail --scan` and full `journalctl` verification if Aiko wants full closure;
  - no immediate runtime fix needed based on current read-only state.

## P2 remaining work

### P2-A — CORS global reflects origin with credentials

- Status: fixed local / verified / not deployed.
- Fix: split human CORS allowlist from agent/MCP CORS; avoid credentialed wildcard-reflection behavior.
- Verification: focused P2-A Vitest `4/4`, API lint/typecheck, targeted P1-D/P1-F non-regression `10/10`, `STATIC_SCAN_OK`, `TEMP_CONFIG_OK`.

### P2-B — SDK default endpoint non-canonical

- Status: fixed local / verified / not published.
- Fix: canonical endpoint `https://api.serac.cloud/api/agent/mcp/v1` verified in SDK source, generated `dist`, docs, package contract, and package dry-run.
- Verification: SDK contract `19/19`, SDK search tests `5/5`, `npm pack --dry-run` succeeded for `serac-agent-sdk@0.1.1`, `STALE_SCAN_OK`, `PACK_ARTIFACTS_OK`.

### P2-C — Archive/restore audit log probably loses namespace context

- Status: fixed local / verified / not deployed.
- Fix: archive/restore audit logs now use real `namespace_id` and surface audit insert failures instead of swallowing them silently.
- Verification: focused P2-C Vitest `5/5`, targeted API non-regression `20/20`, API lint/typecheck, `P2C_STATIC_SCAN_OK`, `TEMP_CONFIG_OK`.

### P2-D — Crypto SDK streaming buffers everything

- Status: fixed local / verified / not deployed.
- Fix: `encryptStream()` now uses bounded one-chunk lookahead and comments document the real 5-byte AAD layout without changing the encrypted format.
- Verification: focused P2-D regression, full `@serac/crypto` suite `51/51`, crypto lint/build, `P2D_STATIC_SCAN_OK`.

### P2-E — Healthcheck incomplete and API domain inconsistent

- Status: fixed local / verified / not deployed; public proxy verification still pending after deploy.
- Fix: documented health contract for `serac.cloud` vs `api.serac.cloud`; added internal-only deep health for Redis, S3, MCP, and critical dependencies.

### P2-F — Metrics internal scrape not proven

- Status: fixed local / verified / not deployed; live Prometheus target health pending after deploy/config.
- Fix: defined private scrape contract (`serac-api:3001/metrics` or host loopback), added app-level internal-only guard, scrape/db refresh health metrics, and real duration histograms.

### P2-G — Cleanup scheduler lacks distributed lock

- Status: fixed local / verified / not deployed.
- Fix: wraps hourly cleanup in PostgreSQL transaction-level advisory lock (`pg_try_advisory_xact_lock`) and exposes cleanup run/skip/error/running/last-success/duration metrics.

### P2-H — Telegram alerting best-effort and partial PII

- Status: fixed local / verified / not deployed.
- Fix: Telegram alert helper now exposes configured/sent/skipped/failed metrics, returns structured best-effort results, warns once when config is absent without exposing token/chat values, defensively redacts emails before Telegram egress, and cleanup over-quota alert uses `maskEmail()`.

### P2-I — Legacy human-facing/deps boundary

- Status: fixed local / verified / not deployed.
- Fix: added `SERAC_ENABLE_LEGACY_HUMAN_FEATURES` as a non-breaking default-enabled feature flag; routed photos/albums/shared-albums/photo-embeddings/glacier/TOTP through one explicit registration helper; documented route/dependency scope and deferred dependency removal until the matching legacy modules are intentionally disabled or removed.

### P2-J — Base images/deps maintenance

- Status: fixed local / verified / not deployed.
- Fix: added `docs/security/dependency-maintenance.md` and `scripts/check-supply-chain-maintenance.mjs` to define and verify a no-production-install maintenance cycle.
- Verification: focused P2-J Vitest `2/2`, targeted P2/API non-regression `18/18`, `SUPPLY_CHAIN_MAINTENANCE_CHECK_OK`, API `tsc --noEmit`, `git diff --check`, `P2J_STATIC_SCAN_OK`.
- Limitation: no dependency/image upgrade, pull, build, deploy, restart, or migration was performed; real updates remain a later approved maintenance cycle.

### P2-K — Storage/cleanup reconciliation incomplete

- Status: fixed local / verified / not deployed.
- Fix: extended `audit-s3.ts` to include `agent_objects` and shared album photo original/thumbnail/preview keys; added human shared-album usage drift checks; reconciles `agent_vaults` and `agent_namespaces` storage/object counters from live confirmed agent objects; added cleanup of pending, expired, and old soft-deleted agent objects.
- Verification: focused P2-K Vitest `2/2`, targeted P2 combined non-regression `14/14`, API `tsc --noEmit`, `git diff --check`, `P2K_STATIC_SCAN_OK`.
- Limitation: no deploy/rebuild/restart/migration and no live DB/S3 audit execution; production effects remain pending release/deploy approval.

## P3 remaining work

- Ed25519 challenge raw-vs-SPKI compatibility: fixed local / verified / not deployed on branch `remediation/p1f-p2a-p2d-20260520T010137Z`, commit `fef1ad14774ad70862ae0c7798ed9dad118e9a3a`.
- SSE false Bearer without `Accept` may return `405` without OAuth challenge: open.
- Dockerfiles lack `HEALTHCHECK` and digest pinning: open.
- Deploy/rollback runbook not verified end-to-end: open.
- Temporary DB backup table(s) like `agent_tool_pricing_backup_*`: open pending DB confirmation and safe removal.
- Repo/source artifacts `.bak`, `.pre-*`, `.docx`: partially reduced by P1-J, but full cleanup/source policy remains open.

## Recommended next order

1. Decide release path for branch `remediation/p1f-p2a-p2d-20260520T010137Z`: PR/merge/tag/deploy or continue accumulating fixes.
2. If deploying the accumulated branch: plan explicit live sequence: backup → rebuild → restart/recreate only approved services → verify health/metrics/API tests → run read-only storage audit → rollback plan.
3. Decide SDK package release policy separately: no npm publish/reservation/deprecation without explicit approval.
4. Continue remaining P3 polish items, starting with the SSE/OAuth challenge behavior and Docker/runbook items that do not require deploy.
5. Keep live verification/deployment debt visible; none of the branch-level fixes should be called production-closed before deploy/live checks.

## Important caveat

The current state is safer than the initial audit, but **not production-closed**:

- most fixes are local/branch-level;
- no new deploy/rebuild/restart was performed during P3 Ed25519;
- `main` is not updated with the remediation branch;
- `P1-E` is verified on the remediation branch but package publication/registry validation is still an explicit release decision.
