# Serac.cloud Audit Remediation Log

- Created UTC: 2026-05-17T20:52:40Z
- Scope: tracking of fixes derived from `/home/hermes/projects/serac-agents/audit-2026-05-17/99-final-synthesis.md`
- Rule: one fix at a time, no mixed changes, no `git add -A`, no deploy/restart without explicit GO from Aiko.
- Secrets rule: never read or copy `.env`, `.key`, `*.pem`, `credentials/*`, tokens, passwords, cookies, seed phrases or equivalent secrets. Any credential-like value in evidence must be `[REDACTED]`.

## Workflow per fix

For every remediation item, create or update `remediation/fixes/<id>-<short-name>.md` with:

1. Finding reference and source report.
2. Pre-fix proof / observed failure.
3. Files changed, with minimal diff scope.
4. Tests added or updated.
5. Local verification output.
6. Deploy steps, only if explicitly approved.
7. Live verification output, only after deploy.
8. Rollback plan.
9. Final status: `open`, `in_progress`, `fixed_local`, `deployed`, `verified`, or `rolled_back`.

## Current priority queue

1. `P0-A` — register paid: public registration must be free-only.
2. `P0-B` — upload quota réel: enforce real S3 object size with atomic quota accounting.
3. `P0/P1-D` — presigned agent upload token: generate, TTL, one-time use, E2E `store→confirm`.
4. `P0-C` — secrets container env: move/rotate DB/Redis secrets without exposing values.
5. `P1-A/B` — API key scope + expiry enforcement.
6. `P1-C` — x402 fail-closed.
7. `P1-D/E/F` — discovery + SDK + schemas.
8. `P1-G/H/I` — migrations + workspaces + supply-chain.
9. `P1-J/K` — architecture critical debt + repo/prod sync.
10. `P1-L` — ops host issues.
11. `P2` — observability / cleanup / CORS / legacy.
12. `P3` — polish.

## Status summary

- Audit reports packaged permanently: yes.
- Remediation started: yes.
- Current remediation item: `P3 Ed25519 challenge raw-vs-SPKI compatibility` — `fixed local / verified / not deployed`.
- P1-C/D/E/F, P2-A/B/C/D/E/F/G/H/I/J/K, and P3 Ed25519 raw-key challenge compatibility have been retargeted/applied on the real live checkout and verified locally; remaining work is P3 polish or release/deploy/package planning for the accumulated remediation branch.

## Change history

### 2026-05-21T13:53:53Z — P3 Ed25519 challenge raw/SPKI compatibility fixed locally, not deployed

- Confirmed P3 source finding: agent registration stores Ed25519 public keys as raw 32-byte values, while the token challenge route attempted to create a DER/SPKI key directly from the stored bytes.
- Added regression test `apps/api/src/__tests__/agent-ed25519.test.ts` covering raw 32-byte verification, SPKI DER verification, and malformed-key fail-closed behavior.
- RED proof: focused Vitest failed before implementation because `../lib/agent-ed25519.js` did not exist.
- Added `apps/api/src/lib/agent-ed25519.ts` with SPKI wrapping for raw keys using prefix `302a300506032b6570032100` and fail-closed verification semantics.
- Patched `apps/api/src/routes/agent/auth.ts` so `POST /api/agent/auth/token` uses `verifyAgentEd25519Signature()` instead of inline SPKI-only `createPublicKey` logic.
- GREEN proof: focused P3 Vitest passed (`3/3`), API `tsc --noEmit` passed, `git diff --cached --check` passed, `P3_ED25519_STATIC_SCAN_OK` passed.
- Commit: `fef1ad14774ad70862ae0c7798ed9dad118e9a3a` (`fix(api): support raw Ed25519 agent keys`), pushed and remote SHA verified.
- Caveat: a broader untracked `agent-auth.test.ts` in the dirty live checkout asserts unrelated public-registration/P0 behavior and was not used as P3 completion evidence; the final auth diff was restored to P3-only scope before commit.
- No deploy, no image/container/service rebuild, no restart, no Caddy reload, no migration, no production DB/S3 operation.
- Documentation fiche created: `remediation/fixes/p3-ed25519-challenge-raw-spki.md`.

### 2026-05-21T13:24:27Z — P1-E SDK public package contract verified on live branch, not published

- Confirmed P1-E source finding: SDK package/docs/client metadata had drifted between stale `@serac/sdk` / `serac.cloud` endpoint and canonical `serac-agent-sdk` / `api.serac.cloud` endpoint.
- Verified live checkout layout uses `packages/sdk/`, not snapshot `sdk/`.
- Confirmed P1-E changes are present on Serac remediation commit `0bb0128e4d4be28e57022c628789b3c073d0b6a8`, included in branch head `071aa214270274e82b601e630f16c2c0e149ffa0`.
- GREEN proof: SDK package contract passed (`19/19`), SDK search tests passed (`5/5`), SDK `tsc --noEmit` passed, API `tsc --noEmit` passed, `npm pack --dry-run` produced 22 package files and left no `.tgz` artifact.
- Remote verification: local branch head matched `origin/remediation/p1f-p2a-p2d-20260520T010137Z` at `071aa214270274e82b601e630f16c2c0e149ffa0`.
- No deploy, no image/container/service rebuild, no restart, no Caddy reload, no migration, no npm publish/deprecate/reserve action.
- Documentation fiche updated: `remediation/fixes/p1-e-sdk-package-contract.md`.

### 2026-05-21T13:00:31Z — P2-K storage/cleanup reconciliation fixed locally, not deployed

- Confirmed P2-K source finding: `audit-s3.ts` covered human files/photo variants but omitted `agent_objects` and shared album photo variants; cleanup had no verified agent object lifecycle purge.
- Added regression test `apps/api/src/__tests__/storage-cleanup-reconciliation-contract.test.ts`.
- RED proof: focused test failed before patch because `audit-s3.ts` did not reference `agent_objects`, `shared_album_photos`, agent vault/namespace counter checks, and `cleanup.ts` did not include `cleanupAgentObjects()`.
- Patched `apps/api/src/scripts/audit-s3.ts` to include agent object S3 keys, shared album original/thumbnail/preview keys, shared-album human usage, agent pending/expired/soft-deleted lifecycle reporting, and agent vault/namespace storage/object counter drift checks.
- Patched `apps/api/src/lib/cleanup.ts` to purge old pending agent uploads, expired confirmed agent objects with vault/namespace counter decrements, and old soft-deleted agent objects without double-decrementing counters.
- GREEN proof: focused P2-K Vitest passed (`2/2`), targeted P2 combined non-regression passed (`14/14` across 5 files), API `tsc --noEmit` passed.
- Hygiene passed: `git diff --check`, `P2K_STATIC_SCAN_OK`.
- Commit: `071aa214270274e82b601e630f16c2c0e149ffa0` (`[security] reconcile storage cleanup`), pushed and remote SHA verified.
- No deploy, no image/container/service rebuild, no restart, no Caddy reload, no migration, no production DB/S3 audit execution.
- Documentation fiche created: `remediation/fixes/p2-k-storage-cleanup-reconciliation.md`.

### 2026-05-21T12:29:09Z — P2-J supply-chain maintenance guardrail fixed locally, not deployed

- Confirmed P2-J source finding: base/service images and dependency advisories needed an explicit maintenance cycle, not ad-hoc prod updates.
- Added regression test `apps/api/src/__tests__/supply-chain-maintenance-contract.test.ts`.
- RED proof: focused test failed before patch because `docs/security/dependency-maintenance.md` and `scripts/check-supply-chain-maintenance.mjs` did not exist.
- Added `docs/security/dependency-maintenance.md` documenting monthly review cadence, no-production-install rule, isolated build host workflow, npm advisory handling, and base/service image scope.
- Added `scripts/check-supply-chain-maintenance.mjs`, a no-network checker validating the policy file and API/Web Dockerfile assumptions (`node:20-alpine`, `RUN npm ci`, `USER node`, `tini`).
- Compose/runtime files were intentionally not read for this item because they may contain credentials; PostgreSQL/Redis/Uptime/Plausible image references are documented from the audit baseline.
- GREEN proof: focused P2-J Vitest passed (`2/2`), targeted P2/API non-regression passed (`18/18` across 5 files), no-network checker printed `SUPPLY_CHAIN_MAINTENANCE_CHECK_OK`, API `tsc --noEmit` passed.
- Hygiene passed: `git diff --check`, `P2J_STATIC_SCAN_OK`.
- Commit: `f24617129c2396d8082f5c022d9c783c9e566591` (`[security] document supply-chain maintenance`), pushed and remote SHA verified.
- No dependency upgrade, no image pull/build, no deploy, no restart, no Caddy reload, no migration, no runtime config change.
- Documentation fiche created: `remediation/fixes/p2-j-supply-chain-maintenance.md`.

### 2026-05-21T12:10:31Z — P2-I legacy human-facing feature boundary fixed locally, not deployed

- Confirmed P2-I source finding: the agent-first pivot had no explicit boundary for legacy human-facing routes/deps.
- Added regression test `apps/api/src/__tests__/legacy-human-features-contract.test.ts`.
- RED proof: focused test failed before patch because `../lib/legacy-human-features.js` did not exist and `index.ts` registered legacy routes directly.
- Patched `apps/api/src/lib/legacy-human-features.ts` with `SERAC_ENABLE_LEGACY_HUMAN_FEATURES`, default-enabled non-breaking semantics, disabled values (`false`, `0`, `off`, `disabled`, `no`), and structured registration results.
- Patched `apps/api/src/index.ts` so photos/albums/shared-albums/photo-embeddings/glacier/TOTP route plugins are registered only through `registerLegacyHumanRoutes()`.
- Added `docs/security/legacy-human-features.md` documenting the pivot boundary, route scope, and dependency-removal sequence.
- Dependency inventory: `nodemailer`, `otpauth`, `qrcode`, `heic2any`, `exifr`, TensorFlow/MobileNet, and HuggingFace Transformers are still referenced by active legacy/email/web code, so removal is deferred until those modules are disabled/removed intentionally.
- GREEN proof: focused P2-I Vitest passed (`3/3`), targeted P2/API non-regression passed (`31/31` across 7 files), API `tsc --noEmit` passed.
- Hygiene passed: `git diff --check`, `STATIC_SCAN_OK`, `TEMP_CONFIG_OK`.
- Commit: `2fdb1480ab33787e9fab602f8d37373fd7abe974` (`[security] gate legacy human features`), pushed and remote SHA verified.
- No deploy, no image/container/service rebuild, no restart, no Caddy reload, no migration, no runtime config change.
- Documentation fiche created: `remediation/fixes/p2-i-legacy-human-feature-boundary.md`.

### 2026-05-21T11:49:13Z — P2-H Telegram alerting observability + PII masking fixed locally, not deployed

- Confirmed P2-H/P2-023 source finding: `sendTelegramAlert()` silently skipped missing config/failures, and cleanup over-quota Telegram alert included the raw user email.
- Added regression test `apps/api/src/__tests__/telegram-alerting-contract.test.ts`.
- RED proof: focused test failed before patch (`4/4` failures) because structured results/metrics/redaction/call-site masking were absent.
- Patched `apps/api/src/lib/telegram.ts` to return structured `sent`/`failed`/`skipped` results, update Telegram alert metrics, warn once on missing config without exposing token/chat values, and defensively redact emails before Telegram egress.
- Patched `apps/api/src/lib/cleanup.ts` to use `maskEmail(user["email"] as string)` in the over-quota Telegram purge alert.
- Updated `docs/observability/serac-api-metrics.md` with Telegram alert metric contract.
- GREEN proof: focused P2-H Vitest passed (`4/4`), targeted P2/API non-regression passed (`13/13` across 3 files), API `tsc --noEmit` passed.
- Hygiene passed: `git diff --cached --check`, `STATIC_SCAN_OK`, `TEMP_CONFIG_OK`.
- Backup: `/tmp/serac-p2h-telegram-backup-20260521T1145Z`.
- Caveat: `apps/api/src/routes/admin/infra.ts` remains untracked in the dirty live checkout and was not modified/staged for this fix.
- Commit: `c6a9451873af5b8beb0ad6c65ed4fb638a04b77c` (`[security] add Telegram alert observability`), pushed and remote SHA verified.
- No deploy, no image/container/service rebuild, no restart, no Caddy reload, no migration.
- Documentation fiche created: `remediation/fixes/p2-h-telegram-alerting-pii.md`.

### 2026-05-21T11:26:26Z — P2-G cleanup distributed lock fixed locally, not deployed

- Confirmed P2-G/P2-022 source finding: `startCleanupScheduler()` ran cleanup in every API process with no distributed lock, so rolling deploy/scale-out could execute duplicate cleanup passes.
- Added regression test `apps/api/src/__tests__/cleanup-scheduler-lock.test.ts`.
- RED proof: focused test failed before patch (`3/3` failures) because `runCleanupWithLock` did not exist.
- Patched `apps/api/src/lib/cleanup.ts` to extract `runCleanupTasks()` and wrap scheduler runs in `runCleanupWithLock()`.
- Lock design: PostgreSQL `pg_try_advisory_xact_lock(730002022::bigint)` inside `sql.begin(...)`; transaction-level lock avoids postgres.js pool/session unlock ambiguity.
- Added cleanup metrics: runs, skipped locks, errors, running gauge, last-success timestamp, duration histogram.
- Updated `docs/observability/serac-api-metrics.md` with cleanup metric verification contract.
- GREEN proof: focused P2-G Vitest passed (`3/3`), targeted P2/API non-regression passed (`28/28` across 6 files), API lint/typecheck passed.
- Hygiene passed: `GIT_DIFF_CHECK_OK`, `P2G_STATIC_SCAN_OK files=2`, `TEMP_CONFIG_OK`, `DOC_DIFF_CHECK_OK`.
- Backup: `/tmp/serac-p2g-cleanup-lock-backup-20260521T1116Z/`.
- Caveat: `apps/api/src/lib/cleanup.ts` was previously untracked in the dirty live checkout; it must be staged explicitly with the P2-G test.
- No deploy, no image/container/service rebuild, no restart, no Caddy reload, no migration.
- Documentation fiche created: `remediation/fixes/p2-g-cleanup-distributed-lock.md`.

### 2026-05-20T12:18:35Z — P2-E/F forwarded-chain guard hardened locally, not deployed

- Pre-PR review found that `/api/health/deep` and `/metrics` trusted the first `X-Forwarded-For` value, allowing spoofed chains such as `127.0.0.1, 203.0.113.x` to be treated as internal.
- Added RED tests to `health-contract.test.ts` and `metrics-contract.test.ts`; both failed before patch (`expected 403, received 200`).
- Patched `apps/api/src/routes/health.ts` and `apps/api/src/routes/metrics.ts` so every forwarded hop must be loopback/private; any public hop fails closed before dependency checks/metrics rendering.
- Updated `docs/observability/serac-api-metrics.md` to document full forwarded-chain validation.
- GREEN proof: health + metrics focused tests passed (`10/10`); targeted P2/API non-regression passed (`23/23`); API lint/typecheck passed.
- Hygiene passed: `git diff --check`, `FORWARDED_GUARD_SCAN_OK`, `TEMP_CONFIG_OK`.
- Backup: `/tmp/serac-p2ef-forwarded-guard-backup-20260520T121542Z/`.
- Commit: `3157ee89aecf784230a42183c42d780ee28ae71b` (`[security] harden forwarded guard checks`), pushed and remote SHA verified.
- No deploy, no image/container/service rebuild, no restart, no Caddy reload, no migration.

### 2026-05-20T11:48:43Z — P2-F metrics internal scrape contract fixed locally, not deployed

- Confirmed P2-F/P2-020/P2-021 source finding: `/metrics` was app-unauthenticated and hidden publicly only by proxy routing; internal Prometheus scrape path was not documented/proven, DB gauge refresh failures were silent, and duration metrics lacked real histogram buckets.
- Added regression test `apps/api/src/__tests__/metrics-contract.test.ts`.
- RED proof: focused P2-F test failed before patch (`4/4` failures): public forwarded client got `200` instead of `403`, scrape/db freshness metrics were absent, DB failure was silent, and duration metrics had no histogram buckets.
- Patched `apps/api/src/routes/metrics.ts` with internal-source enforcement, scrape health metrics, DB refresh success/error/timestamp metrics, and scrape-duration observation.
- Patched `apps/api/src/lib/metrics.ts` so duration observations render as real Prometheus histograms (`_bucket`, `_sum`, `_count`).
- Added source-level scrape contract doc `docs/observability/serac-api-metrics.md` defining the private target `serac-api:3001/metrics` or host loopback equivalent.
- GREEN proof: focused P2-F Vitest passed (`4/4`), targeted P2/API non-regression passed (`33/33`), API `npm run lint --workspace @serac/api` / `tsc --noEmit` passed.
- Hygiene passed: `git diff --cached --check`, `P2F_FULL_FILE_SCAN_OK`, `P2F_STAGED_SCAN_OK`, `TEMP_CONFIG_OK`.
- Backup: `/tmp/serac-p2f-metrics-backup-20260520T114108Z/`.
- Caveat: live Prometheus target health `up{job="serac-api"} == 1` remains pending until deploy/config work is explicitly approved; no runtime config was changed here.
- Committed and pushed on branch `remediation/p1f-p2a-p2d-20260520T010137Z`.
- Commit: `7cf26bd002c1a17416928f01bd61ed0b0d47a76a` (`[security] add P2F metrics scrape contract`).
- Remote verification: local SHA matches GitHub branch SHA.
- Targeted post-push status for the 4 P2-F files is clean.
- No deploy, no image/container/service rebuild, no restart, no Caddy reload, no migration.
- Documentation fiche created: `remediation/fixes/p2-f-metrics-internal-scrape.md`.

### 2026-05-20T11:29:03Z — P2-E healthcheck/domain contract fixed locally, not deployed

- Confirmed P2-E source finding: `/api/health` had no build/domain contract and no deep/internal dependency health; `api.serac.cloud/api/health` live routing remains a proxy/deploy verification item.
- Added regression test `apps/api/src/__tests__/health-contract.test.ts`.
- RED proof: focused P2-E test failed before patch (`4/4` failures): missing `build.sha`, missing domain contract, `/api/health/deep` returning `404` instead of `403/200/503`.
- Patched `apps/api/src/routes/health.ts` so lightweight `/api/health` includes build SHA + explicit `serac.cloud`/`api.serac.cloud` contract, and internal-only `/api/health/deep` checks DB/Redis/S3/MCP/cleanup status.
- Patched `apps/api/src/lib/s3.ts` with readonly `checkS3()` using `HeadBucketCommand`.
- GREEN proof: focused P2-E Vitest passed (`4/4`), targeted P2/API non-regression passed (`24/24`), API `npm run lint --workspace @serac/api` / `tsc --noEmit` passed.
- Hygiene passed: `git diff --check`, `P2E_STATIC_SCAN_OK`, `P2E_FULL_FILE_SCAN_OK`, `TEMP_CONFIG_OK`.
- Backup: `/tmp/serac-p2e-health-backup-20260520T112510Z/`.
- Caveat: `apps/api/src/lib/s3.ts` and `apps/api/src/__tests__/health-contract.test.ts` are untracked in this checkout and must be staged explicitly if committing.
- Committed and pushed on branch `remediation/p1f-p2a-p2d-20260520T010137Z`.
- Commit: `525c77a4c76b4fb05b7cae3f98da16c64e9793ea` (`[security] add P2E health contract`).
- Remote verification: local SHA matches GitHub branch SHA.
- Targeted post-push status for the 3 P2-E files is clean.
- No deploy, no image/container/service rebuild, no restart, no Caddy reload, no migration.
- Documentation fiche created: `remediation/fixes/p2-e-health-domain-contract.md`.

### 2026-05-20T01:43:54Z — P1-F/P2-A-D git checkpoint pushed, not deployed

- Created live-checkout branch `remediation/p1f-p2a-p2d-20260520T010137Z` from `main` HEAD `f4ea664`.
- Committed scoped remediation files only: P1-F MCP output schemas, P2-A CORS split, P2-B SDK package/contract, P2-C archive/restore audit logging, P2-D crypto streaming bounded lookahead, and related tests.
- Commit: `0bb0128e4d4be28e57022c628789b3c073d0b6a8` (`[security] apply P1F and P2A-D audit fixes`).
- Pushed branch to `github-serac:AikoGilpin/serac-cloud.git`; verified remote SHA matches local SHA.
- Verification before commit: API targeted Vitest `13/13`, API `tsc --noEmit`, SDK build/lint/package contract `19/19` + search tests `5/5`, crypto targeted Vitest `25/25`, crypto lint/build, `git diff --cached --check`, staged secret-pattern scan.
- Targeted post-push status for the 21 committed files is clean.
- No merge to `main`, no deploy, no rebuild, no restart, no migration.
- Caveat: commit author remained the auto-configured local identity (`Kira agent (Hermes from s1) <hermes@...>`) because the branch ref was created as `hermes`; changing it would require an amend/force-push cycle and was not worth perturbing the verified checkpoint.

### 2026-05-20T00:48:12Z — P2-D crypto streaming bounded lookahead fixed, verified, not deployed

- Confirmed live `packages/crypto/src/encryption.ts` still collected all plaintext chunks before yielding the first encrypted chunk, and still documented a stale 9-byte AAD layout with `totalChunks` even though implementation used 5 bytes.
- Added focused regression test in `packages/crypto/src/__tests__/encryption.test.ts` proving chunk 0 must be emitted after only one-chunk lookahead rather than waiting on a never-ending third source read.
- RED proof: focused test failed before patch with `expected 'timeout' to be 'yield'`.
- Patched `encryptStream()` to use bounded one-chunk lookahead and updated comments to the real 5-byte AAD (`chunkIndex`, `isFinal`) without changing the encrypted format.
- GREEN proof: focused P2-D Vitest passed, full `@serac/crypto` test suite passed (`3 files`, `51 tests`), `npm run lint --workspace @serac/crypto` passed, `npm run build --workspace @serac/crypto` passed.
- Hygiene passed: `git diff --check`, `P2D_STATIC_SCAN_OK`.
- Backup: `/tmp/serac-p2d-crypto-backup-20260520T004528Z/`.
- Caveat: `packages/crypto/src/__tests__/encryption.test.ts` was already untracked; `packages/crypto/dist/` is ignored and was generated/updated by the package build.
- No deploy, no container/image/service rebuild, no restart, no migration.
- Documentation fiche created: `remediation/fixes/p2-d-crypto-streaming-lookahead.md`.

### 2026-05-20T00:41:00Z — P2-C archive/restore audit namespace fixed, verified, not deployed

- Confirmed REST archive/restore and MCP `serac.archive` audit inserts used object id as `agent_audit_log.namespace_id` and swallowed archive/restore audit insert failures.
- Added focused regression test `apps/api/src/__tests__/archive-audit.test.ts`.
- RED proof: focused test failed before patch (`5/5` failures): wrong namespace id for REST/MCP archive/restore and swallowed audit insert errors.
- Patched `apps/api/src/routes/agent/archive.ts` and `apps/api/src/routes/agent/mcp.ts` so archive/restore SELECTs include `o.namespace_id`, audit inserts use `${obj["namespace_id"]}`, and archive/restore audit failures are no longer swallowed.
- GREEN proof: focused P2-C Vitest passed (`5/5`), targeted API non-regression passed (`20/20`), API `npm run lint --workspace @serac/api` / `tsc --noEmit` passed.
- Hygiene passed: targeted block inspection, regex static scan `P2C_STATIC_SCAN_OK`, `TEMP_CONFIG_OK`.
- Backup: `/tmp/serac-p2c-archive-backup-20260519T232848Z/`.
- Caveat: other `.catch(() => {})` audit calls remain in `mcp.ts` outside P2-C scope; not changed deliberately.
- No deploy, no rebuild, no restart, no migration.
- Documentation fiche created: `remediation/fixes/p2-c-archive-restore-audit-log.md`.

### 2026-05-19T23:24:05Z — P2-B SDK artifact contract fixed, verified, not published

- Confirmed SDK source already used canonical endpoint `https://api.serac.cloud/api/agent/mcp/v1`, but generated publishable `dist/*` artifacts were stale.
- Extended `packages/sdk/test/package-contract.test.mjs` to validate `src` and generated `dist` artifacts.
- RED proof: stronger contract failed before rebuild on stale dist endpoint and stale `@serac/sdk` import examples (`P2B_RED_EXIT=1`).
- Regenerated `packages/sdk/dist/*` with `npm run build` from corrected source.
- GREEN proof: SDK contract passed (`1..19`), SDK search tests passed (`5/5`), `npm pack --dry-run` succeeded with package `serac-agent-sdk@0.1.1` and 22 files.
- Hygiene passed: `STALE_SCAN_OK`, `PACK_ARTIFACTS_OK`.
- Backups: `/tmp/serac-p2b-sdk-backup-20260519T232248Z/package-contract.test.mjs` and `/tmp/serac-p2b-sdk-backup-20260519T232248Z/dist/`.
- Caveat: `packages/sdk/` is entirely untracked in the live checkout; `packages/sdk/dist/*` is ignored by root `.gitignore` `dist/`. Future commit/publish must handle this deliberately.
- No deploy, no rebuild/restart of services, no npm publish.
- Documentation fiche created: `remediation/fixes/p2-b-sdk-default-endpoint.md`.

### 2026-05-19T23:19:13Z — P2-A CORS fixed locally, verified, not deployed

- Confirmed the live code intended agent routes to be open without credentials and human routes to be app-origin credentialed, but implementation still reflected all origins with `credentials: true` globally.
- Added `apps/api/src/lib/cors-policy.ts` with isolated `isAgentPath()` and `buildCorsOptions()` policy.
- Patched `apps/api/src/index.ts` to use `@fastify/cors` `delegator` per request instead of global allow-all credentialed CORS.
- Added regression test `apps/api/src/__tests__/cors-policy.test.ts`.
- RED proof: focused test failed before helper existed (`Cannot find module '../lib/cors-policy.js'`).
- GREEN proof: focused P2-A Vitest passed (`4/4`), API `npm run lint --workspace @serac/api` / `tsc --noEmit` passed, and targeted non-regression with P1-D/P1-F passed (`10/10`).
- Hygiene passed: tracked diff check, `STATIC_SCAN_OK files=3`, `TEMP_CONFIG_OK`.
- Live backup: `/tmp/serac-p2a-cors-backup-20260519T231824Z/index.ts`.
- Caveat: new P2-A helper/test are untracked in the dirty live checkout and must be staged explicitly in any future Serac commit.
- No deploy, no rebuild, no restart, no migration.
- Documentation fiche created: `remediation/fixes/p2-a-cors-human-agent.md`.

### 2026-05-19T23:15:11Z — P1-F retargeted on live checkout, verified, not deployed

- Retargeted P1-F from the older flattened snapshot layout to live `/home/sniper/serac` on `vps-sniper`.
- Patched `apps/api/src/routes/agent/mcp-tool-registry.ts` so all 8 MCP tool `outputSchema` blocks match current handler result shapes.
- Patched `apps/api/src/routes/agent/discovery.ts` so `MCP_SERVER_CARD.tools` reuses `MCP_TOOLS`, removing duplicated divergent server-card schemas.
- Patched `apps/api/src/routes/agent/mcp.ts` so `tools/call` returns `structuredContent: toolResult.result` while preserving existing text JSON `content`.
- Added regression test `apps/api/src/__tests__/mcp-output-schemas.test.ts`.
- Verification passed: focused Vitest with no-secret temp config (`2 files`, `6 tests`), and API `npm run lint --workspace @serac/api` / `tsc --noEmit`.
- Default Vitest startup hit protected `apps/api/.env` with `EACCES`; `.env` was not read, copied, chmodded, or inspected.
- Live backup: `/tmp/serac-p1f-live-backup-20260519T230600Z/`.
- Caveat: `apps/api/src/routes/agent/mcp-tool-registry.ts` and the new test are untracked in the dirty live checkout and must be staged explicitly in any future Serac commit.
- No deploy, no rebuild, no restart, no migration.
- Documentation fiche updated: `remediation/fixes/p1-f-mcp-output-schemas.md`.

### 2026-05-18T23:31:41Z — P1-L host ops triaged; immediate symptoms green, alerting pending

- Completed read-only host diagnostic for P1-L; no service restart/reset/enable/disable, no package install, no deploy, no migration.
- Current state no longer reproduces the audit's immediate P1 symptoms: `systemctl --failed` returned `0 loaded units listed`, `logrotate.service` last run exited `0/SUCCESS`, load was low (`1.11`, `1.27`, `1.34`), and swap was absent (`0B`).
- `mdmonitor-oneshot.service` / timer are inactive; `/proc/mdstat` and `lsblk` show no visible md RAID device. Full `mdadm --detail --scan` and full unit journals were not verified because they require super-user / journal permissions.
- Created documentation fiche: `remediation/fixes/p1-l-ops-host-units-swap.md`.
- Remaining P1-L closure work is monitoring/alerting, not an immediate runtime fix: failed units, logrotate timer/service, mdmonitor when arrays exist, load threshold, swap threshold if swap returns.

### 2026-05-18T23:19:39Z — P1-K conservative branch pushed; main untouched

- Aiko approved the conservative P1-K policy: protect P0/P1 fixes first, exclude ML/WASM assets and broad product/source drift, push a dedicated branch rather than `main`.
- Direct staging in `/home/sniper/serac` failed because `.git/objects/*` has mixed ownership (`sniper` plus older `hermes` object directories); no root sudo available to chown safely.
- Created clean temporary clone as `sniper` at `/tmp/serac-p1k-push`, copied only the explicit P0/P1 manifest, and committed one atomic branch commit: `9ae54091109525fb64d356ccf7a5cd7e15bc6b1f` (`[security] apply P0/P1 audit remediation`).
- Pushed branch `remediation/p0-p1-audit-2026-05-18`; SHA verification passed (`LOCAL_SHA == REMOTE_SHA == 9ae54091109525fb64d356ccf7a5cd7e15bc6b1f`).
- Remote suggested PR URL: `https://github.com/AikoGilpin/serac-cloud/pull/new/remediation/p0-p1-audit-2026-05-18`.
- Verification: live `check:workspaces`, `check:architecture`, API `tsc --noEmit`, `TEMP_CONFIG_OK`; temp clone staged `check:workspaces`, `check:architecture`, `node --check` guards/runner, `git diff --cached --check`, and staged secret-literal scan all passed.
- Limitation: full temp-clone API lint was not rerun because offline `npm ci --ignore-scripts --offline` lacked cached `xml-naming-0.1.0.tgz`; no online package fetch was performed. Live API lint remains the proof for TypeScript.
- Live checkout switched back to `main` at `f4ea664bdaf7`; no deploy, rebuild, restart, production migration, tag, merge to `main`, or secret rotation.
- Full repo/prod source reconciliation remains deferred, especially ML/WASM artifact policy and remaining broad drift.

### 2026-05-18T22:51:33Z — P1-K scoped; blocked pending staging decision

- Scoped repo/prod divergence on live checkout `/home/sniper/serac` after P1-J.
- Confirmed Git must be run as `sniper` for this repo: `github-serac` resolves to `git@github.com:AikoGilpin/serac-cloud.git` via `/home/sniper/.ssh/id_ed25519_serac`.
- Remote verification as `sniper` passed: `git ls-remote origin refs/heads/main` returned `f4ea664bdaf70e961bba5bb1265d2be604aaece3`, matching local `HEAD` before dirty remediation commits.
- Current drift remains large: `STATUS_TOTAL 114`, `TRACKED_MODIFIED 28`, `UNTRACKED 253`, untracked total about `205619533` bytes.
- Added `.turbo/` to `.gitignore`; Turbo cache no longer appears in status (`TURBO_VISIBLE False`).
- Confirmed `TRACKED_SECRET_LIKE 0` by path scan; no secret files were read.
- Identified large untracked public ML/WASM assets that require explicit policy before Git staging (ONNX/CLIP/MobileNet/WASM, ~205 MB total untracked).
- No commit, no tag, no push, no deploy, no rebuild, no restart, no migration.
- Documentation fiche created: `remediation/fixes/p1-k-repo-prod-sync.md`.
- Blocker: Aiko must choose P1-K staging policy before live Serac Git commits/tags/pushes.

### 2026-05-18T22:37:29Z — P1-J architecture guardrails fixed locally, not deployed

- Retargeted P1-J to the real live checkout `/home/sniper/serac`; no flattened snapshot patch was used.
- Added persistent no-network architecture checker `scripts/check-architecture.mjs` and root script `check:architecture`.
- RED proof before patch: checker failed on 23 backup/pre-release artifacts, `mcp.ts` line budget breach (~1605 > 1250), and inline MCP tool registry/no extracted registry.
- Extracted `MCP_TOOLS` plus access mapping (`mcpAccessAction`, `AgentAccessAction`) into `apps/api/src/routes/agent/mcp-tool-registry.ts`.
- Reduced `apps/api/src/routes/agent/mcp.ts` to 1121 lines and made it import the registry/access mapping instead of defining them inline.
- Moved 23 `.bak` / `pre-*` / `.origin*` artifacts out of source to `/tmp/serac-p1j-backup-artifacts`; pre-patch backups for `package.json`, `.gitignore`, and `mcp.ts` are under `/tmp/serac-p1j-before`.
- GREEN proof: `node --check scripts/check-architecture.mjs`, `npm run check:architecture --silent`, `npm run check:workspaces --silent`, `npm run lint --workspace @serac/api`, and `git diff --check` all passed.
- Hygiene passed: `STATIC_SCAN_OK files=5`, `TEMP_CONFIG_OK`, `MCP_HAS_FUNCTION False`, `REGISTRY_EXPORTS_ACCESS True`.
- No deploy, no rebuild, no restart, no migration.
- Documentation fiche created: `remediation/fixes/p1-j-agent-mcp-architecture.md`.

### 2026-05-18T21:29:57Z — P1-I lockfile fixed locally, not deployed

- Ran reliable post-P1-H npm audit on the live workspace lockfile: before fix = `critical: 1`, `high: 4`, `moderate: 8`, total `13`.
- Created isolated minimal worktree `/tmp/serac-p1i-work` containing only manifests, lockfile, and `scripts/check-workspaces.mjs`.
- Ran `npm audit fix --package-lock-only --ignore-scripts --workspaces --include-workspace-root --audit-level=moderate` in that isolated worktree, then copied only the resulting `package-lock.json` back to `/home/sniper/serac`.
- Security-relevant lockfile updates include: `next 16.2.3→16.2.6`, `fastify 5.8.4→5.8.5`, `fast-uri 3.1.0→3.1.2`, `protobufjs 7.5.4→7.6.0`, `@aws-sdk/xml-builder 3.972.17→3.972.24`, `fast-xml-parser 5.5.8→5.7.3`, `fast-xml-builder 1.1.4→1.2.0`, `hono 4.12.12→4.12.19`, `ip-address 10.1.0→10.2.0`, `postcss 8.5.6→8.5.14`.
- Post-fix npm audit: `critical: 0`, `high: 0`, `moderate: 2`, total `2`.
- Residual advisories are bounded to `next -> postcss@8.4.31`; official npm metadata shows `next@latest = 16.2.6` and `next@16.2.6 dependencies.postcss = 8.4.31`. npm proposes `next@9.3.3`, which is an unacceptable downgrade/major automatic fix.
- Verification passed: `npm run check:workspaces --silent`, package-lock dry-run offline, `git diff --check`, version guard, `TEMP_CONFIG_OK`, and targeted lint for `@serac/api`, `@serac/crypto`, `@serac/sdk`.
- Root `npm run lint` was attempted but remains blocked by existing `apps/web` lint errors unrelated to P1-I; P1-I changed only `package-lock.json`.
- No deploy, no rebuild, no restart, no migration, no `npm install`/`npm ci` writing `node_modules`.
- Documentation fiche created: `remediation/fixes/p1-i-npm-vulnerabilities.md`.

### 2026-05-18T19:38:18Z — P1-H fixed locally on live layout, not deployed

- Retargeted P1-H to the real live checkout layout `/home/sniper/serac` (`apps/*`, `packages/*`) instead of applying the older flattened snapshot patch.
- Confirmed live root `workspaces` were already correct: `apps/*`, `packages/*`.
- Added no-network guard `scripts/check-workspaces.mjs` and root script `check:workspaces`.
- RED proof before manifest patch: guard failed on missing root script plus internal wildcard specs in manifests and lockfile.
- Replaced internal wildcard specs with npm-compatible local file specs:
  - `apps/api` → `@serac/crypto: file:../../packages/crypto`, `@serac/tsconfig: file:../../packages/tsconfig`
  - `apps/web` → `@serac/crypto: file:../../packages/crypto`
  - `packages/crypto` → `@serac/tsconfig: file:../tsconfig`
  - `packages/sdk` → `@serac/tsconfig: file:../tsconfig`
- Regenerated `package-lock.json` with `npm install --package-lock-only --ignore-scripts --workspaces --include-workspace-root --audit=false --fund=false --offline`.
- GREEN proof: `node scripts/check-workspaces.mjs`, `npm run check:workspaces --silent`, and npm offline dry-run all passed.
- Hygiene passed: `git diff --check`, `node --check scripts/check-workspaces.mjs`, `STATIC_SCAN_OK files=7 internal_wildcards=0`, `TEMP_CONFIG_OK`.
- No deploy, no rebuild, no restart, no migration, no `node_modules` install.
- Documentation fiche updated: `remediation/fixes/p1-h-workspaces-supply-chain.md`.

### 2026-05-18T19:23:00Z — P1-G fixed locally, not deployed

- Patched the live VPS checkout `/home/sniper/serac` for canonical API migrations; no snapshot-only patch was used.
- Added `apps/api/src/db/migrate.ts` with strict migration inventory, SHA-256 checksums, `schema_migrations`, `--dry-run`, `--status`, and `--target`.
- Updated `apps/api/package.json` scripts to use `tsx src/db/migrate.ts`; added status/dry-run scripts and disabled unsafe `db:reset`.
- Converted `apps/api/run-migration-017.mjs` into a compatibility wrapper around the canonical runner (`--target 017_agent_vaults.sql`), removing the hardcoded repo path and raw SQL execution.
- Patched `apps/api/migrations/018_agent_register_x402.sql` to drop the unique constraint before dropping/recreating the index and to use `IF NOT EXISTS` indexes.
- Hardened `apps/api/src/__tests__/global-setup.ts`: requires explicit `TEST_DB_CONTAINER`, `NODE_ENV=test`, and `TEST_DATABASE_URL`/test-only DB; force-recreates a `*_test` DB and runs the canonical runner.
- Removed the embedded PostgreSQL URL from `apps/api/vitest.config.ts`.
- Added regression test `apps/api/src/__tests__/agent-migrations-runner.test.ts`.
- RED proof: P1-G test failed 5/5 before patch.
- GREEN proof: P1-G targeted test passed 5/5; combined remediation suite passed 29/29 across 7 test files.
- `npm run lint` passed; migration dry-run listed 23 canonical migrations through `021_tool_pricing_dot_notation.sql`; `node --check run-migration-017.mjs` passed.
- Hygiene passed: `TEMP_CONFIG_OK`, `GIT_DIFF_CHECK_OK`, `STATIC_SCAN_OK files=7`.
- Limitation: no production migration/status check, no deploy/rebuild/restart. Most touched API files are pre-existing untracked files in the dirty checkout; no broad git cleanup was attempted.
- Documentation fiche created: `remediation/fixes/p1-g-migrations-runner.md`.
- Important next-step correction: the previous P1-H snapshot patch assumed a flattened repo layout; the live checkout uses `apps/*` / `packages/*`, so P1-H must be retargeted instead of applying the old patch blindly.

### 2026-05-18T01:01:27Z — P1-H patch ready in snapshot only, not deployed

- Patched snapshot root workspaces from legacy `apps/*` / `packages/*` to flattened `api`, `web`, `crypto`, `sdk`, `tsconfig` layout.
- Patched root scripts to stop using `cd apps/web` / `cd apps/api`; they now use npm workspace selectors.
- Replaced internal registry-wildcard dependencies (`@serac/crypto: "*"`, `@serac/tsconfig: "*"`) with npm-compatible local file specs (`file:../crypto`, `file:../tsconfig`).
- Compatibility note: attempted `workspace:*` first, but npm `10.9.7` rejects it with `EUNSUPPORTEDPROTOCOL`; `file:../…` keeps dependencies local without breaking npm dry-run.
- Added missing local `@serac/tsconfig` workspace (`tsconfig/package.json`, `base.json`, `node.json`) required by existing TypeScript configs.
- Patched `package-lock.json` so workspace package paths/links match the flattened layout and P1-E SDK name `serac-agent-sdk`.
- Added no-network regression script `scripts/check-workspaces.mjs` and root script `check:workspaces`.
- Generated patch bundle: `/tmp/serac-p1h-workspaces-supply-chain.patch` (`13581` bytes, sha256 `76bce832676b1d2fb93d45f1d4c36eba190961a210b3531ffa14a55379e02ab6`).
- Patch applicability verified on a synthetic pre-fix tree: `PATCH_APPLY_CHECK_OK`; content verified: `PATCH_CONTENT_VERIFY_OK`.
- GREEN proof: `P1H_CONTRACT_GREEN`, `WORKSPACE_CONTRACT_GREEN`, and npm offline dry-run `NPM_DRY_RUN_OFFLINE_GREEN` (`up to date in 1s`).
- P1-D/E/F non-regression still passed.
- Static scan passed: `STATIC_SCAN_GREEN manifests=6 scripts=1`.
- Limitation: true checkout `/home/sniper/serac` is inaccessible; no full install/build/test/audit was run.
- Documentation fiche created: `remediation/fixes/p1-h-workspaces-supply-chain.md`.
- No deploy, no rebuild, no restart, no migration.

### 2026-05-18T00:40:48Z — P1-F patch ready in snapshots only, not deployed

- Patched snapshot `api/src/routes/agent/mcp.ts` so all 8 MCP tool `outputSchema` blocks match current handler result shapes.
- Patched snapshot `api/src/routes/agent/discovery.ts` so duplicated `MCP_SERVER_CARD` output schemas use the same canonical shapes.
- Added Vitest source-contract regression test `api/src/__tests__/mcp-output-schemas.test.ts`.
- Synchronized source schema changes across `/tmp/serac-full-audit-src/api/src` and `/tmp/serac_api_src/src`.
- Backups created before mutation with suffix `.bak.kira-p1f-schema` for `mcp.ts` and `discovery.ts` in both snapshot roots.
- Generated patch bundle: `/tmp/serac-p1f-mcp-output-schemas.patch` (`21110` bytes, sha256 `7357e95f57f268ca65d2e92957ebe4d6ccde98a98180d9384b2ca7a3a06e4809`).
- Patch applicability verified on a synthetic pre-fix tree: `PATCH_APPLY_CHECK_OK`; content verified: `PATCH_CONTENT_VERIFY_OK`.
- RED proof: no-network contract checker failed before patch with missing current fields and stale fields across `mcp.ts` + `MCP_SERVER_CARD` in both roots.
- GREEN proof: `P1F_CONTRACT_GREEN roots=2`; P1-D and P1-E non-regression also passed.
- Static scan passed: `STATIC_SCAN_GREEN touched_files=4 temp_vitest_configs=0`.
- Limitation: true checkout `/home/sniper/serac` is inaccessible; `node_modules` missing in snapshots, so Vitest/tsc/lint were not run.
- Documentation fiche created: `remediation/fixes/p1-f-mcp-output-schemas.md`.
- No deploy, no rebuild, no restart, no migration.

### 2026-05-18T00:25:48Z — P1-E patch ready in snapshot only, not deployed

- Chose `serac-agent-sdk` as the canonical public SDK package name for the snapshot patch.
- Patched snapshot SDK source/docs so `sdk/package.json`, `sdk/README.md`, `sdk/src/index.ts`, `sdk/src/client.ts`, and `sdk/src/types.ts` no longer advertise stale `@serac/sdk` onboarding.
- Aligned SDK default endpoint/docs with canonical discovery/OAuth endpoint: `https://api.serac.cloud/api/agent/mcp/v1`.
- Added `sdk_package: "serac-agent-sdk"` to public onboarding metadata in `api/src/routes/agent/discovery.ts`.
- Added dependency-free regression test `sdk/test/package-contract.test.mjs`.
- Generated patch bundle: `/tmp/serac-p1e-sdk-package-contract.patch`.
- Patch applicability verified on a synthetic pre-fix tree: `PATCH_APPLY_CHECK_OK bytes=5096`.
- RED proof: no-network contract checker failed before patch with stale package name/imports/version, stale endpoint docs/default, and missing discovery `sdk_package`.
- GREEN proof: `P1E_CONTRACT_GREEN`; Node regression test passed 3/3; P1-D non-regression still passed (`P1D_CONTRACT_GREEN roots=2`).
- Static scan passed: `STATIC_SCAN_OK files=8`.
- Temporary Vitest configs absent in the active full snapshot.
- Limitation: true checkout `/home/sniper/serac` is inaccessible; npm view/install/publish, SDK build/typecheck, and package-lock regeneration were not run. Lockfile/workspace mismatch remains deferred to P1-H.
- Documentation fiche created: `remediation/fixes/p1-e-sdk-package-contract.md`.
- No deploy, no rebuild, no restart, no migration, no npm publish.

### 2026-05-18T00:14:43Z — P1-D patch ready in snapshots only, not deployed

- Patched snapshot `api/src/routes/agent/mcp.ts` so the nested legacy discovery route exposed under `/api/agent/.well-known/mcp.json` returns `308 Location: /.well-known/mcp.json` instead of serving a divergent stale static JSON document.
- Added snapshot regression test `api/src/__tests__/mcp-discovery-alias.test.ts` asserting canonical root discovery and absence of stale nested metadata.
- Synchronized patched files across `/tmp/serac-full-audit-src/api/src` and `/tmp/serac_api_src/src`.
- Generated patch bundle: `/tmp/serac-p1d-discovery-alias.patch`.
- Patch applicability verified on a synthetic pre-fix tree: `PATCH_APPLY_CHECK_OK`.
- RED proof: no-network contract checker failed before patch because the legacy route still served `https://api.serac.cloud/mcp/v1`, `AES-256-GCM`, `HKDF-SHA256`, and `X25519_ECDH_AES256GCM`.
- GREEN proof: no-network contract checker passed for both snapshots: `P1D_CONTRACT_GREEN roots=2`.
- Static scan passed: `STATIC_SCAN_OK files=5`.
- Temporary Vitest configs absent in both active snapshots.
- Limitation: true checkout `/home/sniper/serac` is inaccessible in this tool environment; Vitest/tsc/lint were not run because snapshots lack `node_modules` and no npm fetch was performed.
- Documentation fiche created: `remediation/fixes/p1-d-legacy-mcp-discovery.md`.
- No deploy, no rebuild, no restart, no migration.

### 2026-05-17T22:53:54Z — P1-C patch ready in snapshots only, not deployed

- Added regression test `api/src/__tests__/payment-gate-fail-closed.test.ts` in accessible snapshots.
- Patched snapshot `api/src/lib/tool-pricing.ts` with known paid/free tool classification and explicit pricing decisions.
- Patched snapshot `api/src/middleware/payment-gate.ts` so REST x402 fails closed, missing vaults/unknown payment methods fail closed, and paid-tool pricing misconfiguration returns `PAYMENT_CONFIGURATION_ERROR` instead of becoming free.
- Patched snapshot `api/src/middleware/x402.ts` so missing paid-tool pricing or missing `X402_WALLET_ADDRESS` returns `X402_CONFIGURATION_ERROR` instead of allowing execution.
- Synchronized patched files across `/tmp/serac-full-audit-src/api/src` and `/tmp/serac_api_src/src`.
- Generated patch bundle: `/tmp/serac-p1c-x402-fail-closed.patch`.
- RED proof: no-network contract checker failed before patch with REST x402 pass-through, MCP missing-vault/unknown-method allow, and x402 missing-terms allow.
- GREEN proof: no-network contract checker passed for both snapshots.
- Static scan passed: `STATIC_SCAN_OK files=8`.
- Temporary Vitest configs absent in both snapshots.
- Limitation: true checkout `/home/sniper/serac` is inaccessible in this resumed tool environment; Vitest/tsc were not run because snapshots lack `node_modules` and no npm fetch was performed.
- Documentation fiche created: `remediation/fixes/p1-c-x402-fail-closed.md`.
- No deploy, no rebuild, no restart, no migration.

### 2026-05-17T22:37:33Z — P1-A/B fixed locally, not deployed

- Patched `/home/sniper/serac/apps/api/src/lib/agent-access.ts` to centralize agent key access decisions for `full`, `readonly`, and `namespace_scoped` keys.
- Patched `/home/sniper/serac/apps/api/src/routes/agent/auth.ts` so API-key exchange filters expired keys with `ak.expires_at IS NULL OR ak.expires_at > NOW()` and signs `key_id` / `key_type` / `namespace_id` into JWTs.
- Patched `/home/sniper/serac/apps/api/src/middleware/auth-agent.ts` so verified agent JWTs expose key identity/type/scope on the request.
- Patched `/home/sniper/serac/apps/api/src/routes/agent/objects.ts` so REST store/confirm/direct-store/retrieve/list/delete paths enforce scope before mutation/S3-sensitive work.
- Patched `/home/sniper/serac/apps/api/src/routes/agent/mcp.ts` so MCP tool calls enforce key scope before x402/payment/tool execution and deny with JSON-RPC `-32003`.
- Added regression test `/home/sniper/serac/apps/api/src/__tests__/agent-api-key-scope-expiry.test.ts`.
- RED proof before patch: missing expiry predicate, missing key JWT claims, readonly REST/MCP destructive paths not denied, namespace-scoped REST store outside namespace not denied.
- GREEN proof after patch: P1-A/B targeted test passed, 5/5 tests.
- Combined non-regression: P1-A/B + P0-A + P0-B + P0/P1-D agent tests passed, 17/17 tests.
- TypeScript check passed with `npm run lint` in `apps/api`.
- `git diff --check` passed for targeted files.
- Static scans passed: previous diff scan `STATIC_SCAN_OK`; resumed-session full-file scan `STATIC_SCAN_OK files=6` on the staging mirror.
- Temporary Vitest configs removed from staging mirror; `TEMP_CONFIG_OK` verified. VPS checkout cleanup was already part of the pre-compaction workflow but could not be re-checked from this resumed shell because `/home/sniper/serac` is not mounted in the current tool environment.
- Documentation fiche created: `remediation/fixes/p1-ab-api-key-scope-expiry.md`.
- No deploy, no rebuild, no restart, no migration.


### 2026-05-17T22:05:21Z — P0-C fixed locally, not deployed

- Patched `/home/sniper/serac/podman-compose.prod.yml` so DB/Redis bootstrap/runtime secrets are passed through external Podman secret files instead of direct env/command args.
- Added API support for file-backed runtime secrets via `/home/sniper/serac/apps/api/src/lib/secret-env.ts` and wired `DATABASE_URL` / `REDIS_PASSWORD` through `*_FILE` support.
- Patched `/home/sniper/serac/podman-compose.yml` to remove committed literal dev Postgres password.
- Patched `/home/sniper/serac/apps/api/vitest.config.ts` to remove a non-test DB URL literal.
- Added regression test `/home/sniper/serac/apps/api/src/__tests__/ops-secrets-compose.test.ts`.
- RED proof before patch: compose exposed direct `POSTGRES_PASSWORD`, Redis interpolated `${REDIS_PASSWORD}` in command args, secret-file declarations were missing, and `_FILE` helper was absent.
- GREEN proof after patch: P0-C targeted test passed, 3/3 tests.
- Combined non-regression: P0-A + P0-B + P0/P1-D + P0-C passed, 15/15 tests.
- TypeScript check passed with `npm run lint` in `apps/api`.
- `git diff --check` passed for targeted files.
- Static scan passed: `STATIC_SCAN_OK files=8`.
- Temporary Vitest configs removed; `TEMP_CONFIG_OK` verified.
- Documentation fiche created: `remediation/fixes/p0-c-container-secrets.md`.
- No deploy, no rebuild, no restart, no migration, no secret creation, no password rotation.

### 2026-05-17T21:47:51Z — P0/P1-D fixed locally, not deployed

- Patched `/home/sniper/serac/apps/api/src/routes/agent/objects.ts` so presigned `store` generates a strong raw upload token and stores only its SHA-256 hash in `agent_objects.upload_token`.
- Hardened `/objects/confirm` to hash the provided token, enforce a 1-hour TTL via `created_at`, reject invalid/expired tokens with `403` before S3 `HeadObject`, and consume the token with `upload_token = NULL` on success and quota failure.
- Added regression test `/home/sniper/serac/apps/api/src/__tests__/agent-objects-upload-token.test.ts`.
- RED proof before patch: 4/4 failures (`uploadToken` undefined, invalid/expired/valid token confirmation paths impossible).
- GREEN proof after patch: P0/P1-D targeted test passed, 4/4 tests.
- Combined non-regression: P0-A + P0-B + P0/P1-D passed, 12/12 tests.
- TypeScript check passed with `npm run lint` in `apps/api`.
- `git diff --check` passed for targeted files.
- Static scan passed: `STATIC_SCAN_OK added_lines=140 files=6`.
- Temporary Vitest configs removed; `TEMP_CONFIG_OK` verified.
- Documentation fiche created: `remediation/fixes/p0-d-presigned-upload-token.md`.
- No deploy, no rebuild, no restart, no migration.

### 2026-05-17T21:28:53Z — P0-B fixed locally, not deployed

- Patched `/home/sniper/serac/apps/api/src/routes/agent/objects.ts` so presigned `store` requires `sizeBytes` and `/objects/confirm` uses real S3 `HeadObject.ContentLength`.
- Added atomic confirmation SQL CTE: pending row lock, quota-guarded vault counter update, object confirmation, namespace counter update.
- Added quota-exceeded branch: return `413` and attempt immediate `deleteFromS3(s3_key)` cleanup without writing successful audit log.
- Updated `/home/sniper/serac/apps/api/src/lib/s3.ts` comment to document declared-size + HeadObject + atomic-confirmation contract. Note: `apps/api/src/lib/*` is pre-existing untracked in this checkout.
- Added regression test `/home/sniper/serac/apps/api/src/__tests__/agent-objects-quota.test.ts`.
- RED proof before patch: 3/3 failures (`200` instead of `400`, no `HeadObject`, `200` instead of `413`).
- GREEN proof after patch: P0-B targeted test passed, 3/3 tests.
- Combined non-regression: P0-A + P0-B passed, 8/8 tests.
- TypeScript check passed with `npm run lint` in `apps/api`.
- `git diff --check` passed for targeted files.
- Static scans passed: tracked added-line scan and full-file scan over relevant tracked/untracked files.
- Temporary Vitest configs removed; `TEMP_CONFIG_OK` verified.
- No deploy, no rebuild, no restart, no migration.

### 2026-05-17T21:14:06Z — P0-A fixed locally, not deployed

- Patched `/home/sniper/serac/apps/api/src/routes/agent/auth.ts` so public agent self-registration is free-only.
- Added regression test `/home/sniper/serac/apps/api/src/__tests__/agent-auth.test.ts`.
- RED proof before patch: public `agent_fleet` / entitlement fields returned `201` instead of `403`.
- GREEN proof after patch: `src/__tests__/agent-auth.test.ts` passed, 5/5 tests.
- TypeScript check passed with `npm run lint` in `apps/api`.
- `git diff --check` passed for the two touched files.
- Static added-line scan passed: no hardcoded secret / eval / shell injection / SQL string-format findings.
- Normal `vitest.config.ts` targeted run was blocked by `.env` filesystem permissions before setup; no secret content read.
- No deploy, no rebuild, no restart, no migration.

### 2026-05-17T20:52:40Z — remediation tracking initialized

- Copied audit reports from `/tmp/serac-*.md` into permanent folder `/home/hermes/projects/serac-agents/audit-2026-05-17/`.
- Added this remediation log and `remediation/fixes/` folder.
- No application code changed.
- No deployment performed.
- No service restarted.
