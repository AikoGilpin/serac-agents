# Serac.cloud Audit — Remaining Fixes Inventory

- Updated UTC: 2026-05-21T11:49:13Z
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
- `P1-G` — migration runner/checks: `fixed_local`; needs staging DB bootstrap/prod-safe migration verification.
- `P1-H` — workspaces/local deps guard: `fixed_local`; needs clean install/audit in clean environment if desired.
- `P1-I` — npm lockfile critical/high reduced: `fixed_lockfile_local`; two moderate residuals remain due Next/PostCSS metadata.
- `P1-J` — agent/MCP architecture guardrails: `fixed_local`; deeper service extraction remains future hardening.
- `P1-K` — conservative repo/prod sync: branch pushed, `main` untouched; full repo/assets reconciliation deferred.
- `P1-L` — host failed units/swap-load: current state green; alerting/root-level verification pending.

### Still requiring real remediation / integration

- `P1-C` — x402/payment gate fail-closed: `patch_ready_snapshot_only`; must be retargeted to the real live checkout and verified.
- `P1-D` — legacy MCP discovery route: `patch_ready_snapshot_only`; must be retargeted to the real live checkout and verified.
- `P1-E` — SDK public package contract: `patch_ready_snapshot_only`; must be retargeted to the real live checkout, SDK built/test-installed, and npm/package docs aligned.
- `P1-F` — MCP/server-card output schemas: `patch_ready_snapshot_only`; must be retargeted to the real live checkout and verified against handler results.
- `P2-A` to `P2-H` — fixed local / verified / not deployed on remediation branch; live deploy verification remains pending.
- `P2-I` to `P2-K` — open unless covered by a later explicit fix sheet.
- `P3` polish items — open unless covered by a later explicit fix sheet.

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

- Current status: `patch_ready_snapshot_only`.
- Remaining:
  - retarget patch to `/home/sniper/serac` live layout;
  - add/port tests into live `apps/api`;
  - verify paid-tool pricing, missing vault/payment terms, unknown payment methods, missing wallet config all deny rather than allow;
  - run API lint/typecheck and static scans;
  - only then stage into remediation branch.
- Recommended next active coding item.

### P1-D — Legacy MCP discovery route

- Current status: `patch_ready_snapshot_only`.
- Remaining:
  - retarget patch to live route module;
  - ensure nested `/api/agent/.well-known/mcp.json` redirects/aliases canonically and cannot serve stale endpoint/crypto metadata;
  - verify public discovery + OAuth resource behavior still works.

### P1-E — SDK package public contract

- Current status: `patch_ready_snapshot_only`.
- Remaining:
  - retarget SDK/package/docs changes to live checkout;
  - decide canonical npm name permanently (`serac-agent-sdk` is the current patch choice);
  - build SDK and run test install in a clean project;
  - eventually publish/align npm if required by release plan.

### P1-F — MCP output schemas/server-card shapes

- Current status: `patch_ready_snapshot_only`.
- Remaining:
  - retarget schema changes to live checkout;
  - verify every `outputSchema` matches real handler output;
  - ideally deduplicate via single source of truth for tools/server-card/types.

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

- Status: open.
- Fix: split human CORS allowlist from agent/MCP CORS; avoid credentialed wildcard-reflection behavior.

### P2-B — SDK default endpoint non-canonical

- Status: partially addressed in P1-E snapshot patch, not verified live.
- Fix: ensure `https://api.serac.cloud/api/agent/mcp/v1` everywhere in SDK code, docs, registry metadata, examples.

### P2-C — Archive/restore audit log probably loses namespace context

- Status: open.
- Fix: use real `namespace_id`, surface/archive audit errors instead of swallowing them silently.

### P2-D — Crypto SDK streaming buffers everything

- Status: open.
- Fix: implement true streaming with lookahead or document honestly as chunked-buffered encryption/decryption.

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

### P2-I — Legacy human-facing/deps scope unclear

- Status: open.
- Fix: decide official pivot boundaries; feature-flag, remove, or maintain legacy modules intentionally.

### P2-J — Base images/deps maintenance

- Status: open.
- Fix: define regular update cycle for base images and service deps; re-run vulnerability review after lockfile/workspace fixes.

### P2-K — Storage/cleanup reconciliation incomplete

- Status: open.
- Fix: extend `audit-s3.ts` to `agent_objects` and shared albums; reconcile namespace/vault/object/storage counters; add TTL/soft-delete cleanup.

## P3 remaining work

- Ed25519 challenge raw-vs-SPKI compatibility: open.
- SSE false Bearer without `Accept` may return `405` without OAuth challenge: open.
- Dockerfiles lack `HEALTHCHECK` and digest pinning: open.
- Deploy/rollback runbook not verified end-to-end: open.
- Temporary DB backup table(s) like `agent_tool_pricing_backup_*`: open pending DB confirmation and safe removal.
- Repo/source artifacts `.bak`, `.pre-*`, `.docx`: partially reduced by P1-J, but full cleanup/source policy remains open.

## Recommended next order

1. Retarget and verify `P1-C` on live checkout.
2. Retarget and verify `P1-D/E/F` on live checkout.
3. Decide release path for branch `remediation/p0-p1-audit-2026-05-18`: PR/merge/tag/deploy or continue accumulating fixes on branch.
4. If deploying P0/P1: plan explicit live sequence: backup → rebuild → recreate containers if secrets involved → verify endpoints/tests → rollback plan.
5. Start P2 queue: CORS first, then health/metrics/cleanup/alerting.

## Important caveat

The current state is safer than the initial audit, but **not production-closed**:

- most fixes are local/branch-level;
- no new deploy/rebuild/restart was performed during P1-K/P1-L;
- `main` is not updated with the remediation branch;
- snapshot-only P1-C/D/E/F still require real-checkout integration.
