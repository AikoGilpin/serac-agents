# P2-K — Storage / cleanup reconciliation

- Status: `fixed_local_verified_not_deployed`
- Priority: `P2`
- Updated UTC: 2026-05-21T13:00:31Z
- Serac branch: `remediation/p1f-p2a-p2d-20260520T010137Z`
- Serac commit: `071aa214270274e82b601e630f16c2c0e149ffa0`
- Source report: `audit-2026-05-17/04-db-data-migrations.md` — sections “Audit S3 incomplet pour agents et albums partagés” and “TTL / soft-delete agents sans cleanup vérifié”.

## Finding

The storage reconciliation surface was incomplete:

- `audit-s3.ts` covered `files.s3_key` and `photo_variants.s3_key`, but not `agent_objects.s3_key`.
- `audit-s3.ts` did not include `shared_album_photos.s3_key`, `s3_key_thumbnail`, or `s3_key_preview`.
- Agent storage/object counters (`agent_vaults`, `agent_namespaces`) were not reconciled from confirmed, non-expired, non-deleted `agent_objects`.
- Agent object TTL and soft-delete state was filtered from reads, but there was no verified cleanup path for expired, pending, or old soft-deleted agent objects.

## Required outcome

- S3 audit must compare all DB-backed object keys against bucket contents.
- Storage counter drift must be visible for human shared albums and agent vault/namespace counters.
- Cleanup must purge agent pending uploads, expired TTL objects, and old soft-deleted objects.
- Counter updates must avoid double-decrementing soft-deleted objects whose quota was already released by the DELETE route.

## Pre-fix / RED proof

Added `apps/api/src/__tests__/storage-cleanup-reconciliation-contract.test.ts`.

The focused contract test failed before the patch because the source did not include the required contracts:

- `audit-s3.ts` did not reference `agent_objects`.
- `audit-s3.ts` did not reference `shared_album_photos` or preview/thumbnail keys.
- `audit-s3.ts` did not reconcile `agent_vaults` / `agent_namespaces` counters.
- `cleanup.ts` did not expose `cleanupAgentObjects()` or include agent object cleanup in `runCleanupTasks()`.

## Root cause

The original storage audit and cleanup scheduler were written around the human file/photo model, while the later agent storage model added separate tables and lifecycle state. The agent tables became read-filtered (`expires_at`, `deleted_at`) without a matching purge/reconciliation worker.

## Files changed

- `apps/api/src/scripts/audit-s3.ts`
- `apps/api/src/lib/cleanup.ts`
- `apps/api/src/__tests__/storage-cleanup-reconciliation-contract.test.ts`

## Fix summary

`audit-s3.ts` now:

- includes DB references from `agent_objects.s3_key`;
- includes `shared_album_photos.s3_key`, `s3_key_thumbnail`, and `s3_key_preview`;
- reports pending, expired, and soft-deleted agent objects awaiting cleanup;
- includes shared-album usage in human storage drift checks;
- reconciles `agent_vaults.storage_used_bytes` / `object_count` from live agent objects;
- reconciles `agent_namespaces.storage_used_bytes` / `object_count` from live agent objects.

`cleanup.ts` now:

- adds `cleanupAgentObjects()` to the hourly cleanup task chain;
- purges pending agent uploads older than the abandoned-upload threshold;
- purges confirmed expired agent objects and decrements vault/namespace bytes + object counters;
- purges old soft-deleted agent objects after trash retention without decrementing counters a second time;
- includes agent cleanup counts in the cleanup summary/log output.

## Verification

Commands were run on the Serac checkout `/home/sniper/serac` with temporary Vitest configs under `/tmp` using `envDir: /tmp/vitest-empty-env`; no production `.env` file was read.

Verification output:

```text
P2K_FOCUSED_VITEST_OK
Test Files  1 passed (1)
Tests       2 passed (2)

P2_COMBINED_VITEST_OK
Test Files  5 passed (5)
Tests       14 passed (14)

API_TSC_OK
GIT_DIFF_CHECK_OK
P2K_STATIC_SCAN_OK
```

Push verification:

```text
LOCAL=071aa214270274e82b601e630f16c2c0e149ffa0
REMOTE=071aa214270274e82b601e630f16c2c0e149ffa0
SERAC_PUSH_VERIFIED
```

## Static safety scan

`P2K_STATIC_SCAN_OK` checked the three targeted files for:

- conflict markers;
- trailing whitespace / CRLF;
- private-key/token markers;
- `eval`, `new Function`, shell execution helpers;
- required P2-K contract strings in `audit-s3.ts` and `cleanup.ts`.

## Limitations

- Not deployed.
- No container/image rebuild.
- No service restart.
- No migration.
- No production DB/S3 audit execution; running `audit-s3.ts` against live data requires approved runtime credentials/config and should be done after deploy planning.
- The cleanup behavior is source/test verified locally; live cleanup effects remain pending until the remediation branch is merged/deployed and observed.

## Rollback

Code rollback for the Serac branch is scoped to commit `071aa214270274e82b601e630f16c2c0e149ffa0`:

```bash
git revert 071aa214270274e82b601e630f16c2c0e149ffa0
```

This reverts only the P2-K audit/cleanup/test changes if no later commit depends on them.

## Next step

Decide release path for the accumulated remediation branch:

- PR/merge into `main`, or keep accumulating fixes;
- then explicit Aiko GO for deploy/rebuild/restart/live verification.
