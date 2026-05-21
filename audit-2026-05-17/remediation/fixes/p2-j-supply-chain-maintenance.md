# P2-J — Base images and dependency maintenance guardrail

- Status: `fixed_local_branch`, not deployed
- Priority: P2
- Source finding: `audit-2026-05-17/99-final-synthesis.md` `P2-J — Images/base/deps à maintenir`
- Source details: `audit-2026-05-17/00-phase0-baseline.md` supply-chain risk notes and `03-dependencies-supply-chain.md` dependency audit findings
- Fixed UTC: 2026-05-21T12:29:09Z
- Serac branch: `remediation/p1f-p2a-p2d-20260520T010137Z`
- Serac commit: `f24617129c2396d8082f5c022d9c783c9e566591` (`[security] document supply-chain maintenance`)

## Finding

The audit identified stale or unmanaged base/service images and unresolved npm advisory review work:

- `node:20-alpine` for API/Web Dockerfiles.
- `postgres:16-alpine` and `redis:7-alpine` from the baseline runtime stack.
- Uptime Kuma and Plausible service images from the baseline runtime stack.
- Remaining npm vulnerability maintenance after lockfile/workspace reconciliation.

The risk is not one single exploitable code path. It is release hygiene drift: updates may be done manually, too late, or directly on production without a repeatable review/test/deploy gate.

## Required outcome

- Define an explicit maintenance cycle for base images, service images, and npm advisories.
- Add a persistent no-network checker so future branches can verify the policy file and current API/Web Dockerfile assumptions.
- Avoid `npm install`, `npm audit fix`, image pulls, fetches, deploys, restarts, or migrations during this remediation item.

## Pre-fix proof / RED

Added `apps/api/src/__tests__/supply-chain-maintenance-contract.test.ts` first.

Focused RED run failed as expected before the fix:

```text
apps/api/src/__tests__/supply-chain-maintenance-contract.test.ts (2 tests | 2 failed)
- expected docs/security/dependency-maintenance.md to exist
- expected scripts/check-supply-chain-maintenance.mjs to exist
```

This proved the regression contract was checking the missing maintenance documentation and checker, not an unrelated runtime behavior.

## Files changed

- `docs/security/dependency-maintenance.md`
  - documents monthly maintenance cadence, no-production-install rule, isolated build host workflow, npm advisory handling, base/service image handling, and verification gate.
- `scripts/check-supply-chain-maintenance.mjs`
  - no-network Node checker validating the policy file and API/Web Dockerfile assumptions.
  - checks `node:20-alpine`, `RUN npm ci`, `USER node`, and `tini` in API/Web Dockerfiles.
  - intentionally does not read compose files because compose/runtime config can contain credentials.
- `apps/api/src/__tests__/supply-chain-maintenance-contract.test.ts`
  - contract test requiring the policy and checker to exist and forbidding shell-exec imports in the checker.

## Fix summary

The remediation creates an auditable maintenance guardrail rather than changing live dependencies in-place:

- Pinned the current documented baseline in policy: `node:20-alpine`, `postgres:16-alpine`, `redis:7-alpine`, `louislam/uptime-kuma:1`, and `ghcr.io/plausible/community-edition`.
- Required monthly review cadence.
- Required `isolated build host` / disposable worktree workflow.
- Required `npm ci --ignore-scripts` for inspection when possible.
- Explicitly forbids using production as the first place where package/image updates are executed.
- Leaves real dependency/image upgrades for a later approved maintenance cycle.

## Verification

Focused GREEN:

```text
npx --no-install vitest run --config /tmp/serac-p2j-vitest.config.mjs
✓ apps/api/src/__tests__/supply-chain-maintenance-contract.test.ts (2 tests)
```

No-network checker:

```text
node scripts/check-supply-chain-maintenance.mjs
SUPPLY_CHAIN_MAINTENANCE_CHECK_OK
```

Targeted P2/API non-regression:

```text
npx --no-install vitest run --config /tmp/serac-p2j-combined-vitest.config.mjs
✓ cleanup-scheduler-lock.test.ts (3 tests)
✓ telegram-alerting-contract.test.ts (4 tests)
✓ metrics-contract.test.ts (6 tests)
✓ supply-chain-maintenance-contract.test.ts (2 tests)
✓ legacy-human-features-contract.test.ts (3 tests)
Test Files 5 passed; Tests 18 passed
```

Typecheck:

```text
cd apps/api && npx --no-install tsc --noEmit
# exit 0, no output
```

Hygiene:

```text
git diff --check -- apps/api/src/__tests__/supply-chain-maintenance-contract.test.ts docs/security/dependency-maintenance.md scripts/check-supply-chain-maintenance.mjs
# exit 0
python3 /tmp/serac-p2j-static-scan.py
P2J_STATIC_SCAN_OK
```

Push verification:

```text
LOCAL_SHA=f24617129c2396d8082f5c022d9c783c9e566591
REMOTE_SHA=f24617129c2396d8082f5c022d9c783c9e566591
```

## Limitations

- No dependency was upgraded.
- No image was pulled or rebuilt.
- No `npm audit fix` was run.
- No compose/runtime files were read for this item because they may contain credentials; service-image references are documented from the audit baseline instead.
- Digest pinning and Dockerfile `HEALTHCHECK` remain P3 polish/follow-up items unless promoted.
- Live deployment verification remains pending because no deploy/rebuild/restart was performed.

## Deployment status

Not deployed.

No image/container/service rebuild, no restart, no Caddy reload, no migration, no runtime config change.

## Rollback

Revert only the P2-J commit if needed:

```bash
git revert f24617129c2396d8082f5c022d9c783c9e566591
```

This removes the documentation/checker/test only. It does not affect runtime behavior.

## Next step

Continue to `P2-K — Storage/cleanup reconciliation incomplete`, or pause and decide whether to merge/deploy the accumulated remediation branch before adding more fixes.
