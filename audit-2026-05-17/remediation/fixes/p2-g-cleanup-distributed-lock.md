# P2-G — Cleanup scheduler distributed lock

- Status: `fixed_local_branch`, not deployed
- Priority: P2
- Source finding: `audit-2026-05-17/06-ops-observability.md` `[P2-022] Cleanup scheduler in-process sans verrou distribué apparent`
- Fixed UTC: 2026-05-21T11:26:26Z
- Branch: `remediation/p1f-p2a-p2d-20260520T010137Z`

## Finding

`startCleanupScheduler()` ran an in-process hourly cleanup from every API process. During rolling deploys or future horizontal scale-out, two API instances could run lifecycle cleanup concurrently, creating duplicate emails/logs and race conditions around file/user cleanup.

## Required outcome

Only one API instance may execute the cleanup body at a time. Other instances must skip visibly. Cleanup observability must expose success, skip, error, running, last-success, and duration metrics.

## RED proof

Added `apps/api/src/__tests__/cleanup-scheduler-lock.test.ts`.

Initial run before patch:

```text
src/__tests__/cleanup-scheduler-lock.test.ts (3 tests | 3 failed)
TypeError: runCleanupWithLock is not a function
```

## Root cause

`cleanup.ts` had scheduler logic embedded inside `startCleanupScheduler()` and directly executed cleanup tasks without a distributed lock or cleanup-specific metrics.

## Files changed

- `apps/api/src/lib/cleanup.ts`
- `apps/api/src/__tests__/cleanup-scheduler-lock.test.ts`
- `docs/observability/serac-api-metrics.md`

## Fix summary

- Extracted `runCleanupTasks()` for the cleanup body.
- Added `runCleanupWithLock()` around the cleanup body.
- Uses PostgreSQL `pg_try_advisory_xact_lock(730002022::bigint)` inside `sql.begin(...)`.
- Chose transaction-level advisory lock instead of session-level lock to avoid pool/session unlock bugs.
- If lock is already held, cleanup is skipped and `serac_cleanup_lock_skipped_total{job="hourly"}` increments.
- Added cleanup metrics:
  - `serac_cleanup_runs_total`
  - `serac_cleanup_lock_skipped_total`
  - `serac_cleanup_errors_total`
  - `serac_cleanup_running`
  - `serac_cleanup_last_success_timestamp_seconds`
  - `serac_cleanup_duration_seconds`
- Documented expected cleanup metrics in `docs/observability/serac-api-metrics.md`.

## Verification

Focused GREEN:

```text
src/__tests__/cleanup-scheduler-lock.test.ts (3 tests) passed
```

Targeted P2/API non-regression:

```text
6 files passed, 28 tests passed
health-contract, metrics-contract, archive-audit, mcp-output-schemas, cors-policy, cleanup-scheduler-lock
```

Typecheck:

```text
npm run lint --workspace @serac/api  # tsc --noEmit: OK
npx --no-install tsc --noEmit -p tsconfig.json  # OK
```

Hygiene:

```text
GIT_DIFF_CHECK_OK
P2G_STATIC_SCAN_OK files=2
TEMP_CONFIG_OK
DOC_DIFF_CHECK_OK
```

## Limitations

- No deploy, rebuild, restart, migration, DB mutation, or container operation performed.
- The lock is source-verified with tests; staging verification with two live API instances remains pending after deploy approval.
- `cleanup.ts` was previously untracked in the dirty live checkout; this fix stages it explicitly because `apps/api/src/index.ts` imports `startCleanupScheduler()`.

## Deployment status

Not deployed.

## Rollback

Revert the P2-G commit on branch `remediation/p1f-p2a-p2d-20260520T010137Z` or restore:

- `apps/api/src/lib/cleanup.ts`
- `apps/api/src/__tests__/cleanup-scheduler-lock.test.ts`
- `docs/observability/serac-api-metrics.md`

Backup before patch:

```text
/tmp/serac-p2g-cleanup-lock-backup-20260521T1116Z/
```

## Next step

Commit/push the scoped P2-G changes, then continue with `P2-H` alerting Telegram best-effort + PII masking, unless Aiko chooses deployment planning first.
