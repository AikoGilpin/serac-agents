# P2-I — Legacy human-facing feature boundary

- Status: `fixed_local_branch`, not deployed
- Priority: P2
- Source finding: `audit-2026-05-17/99-final-synthesis.md` `P2-I — Legacy humain-facing et deps lourdes`; baseline details in `audit-2026-05-17/00-phase0-baseline.md` `P2-002` and `P2-003`
- Fixed UTC: 2026-05-21T12:10:31Z
- Branch: `remediation/p1f-p2a-p2d-20260520T010137Z`
- Commit: `2fdb1480ab33787e9fab602f8d37373fd7abe974` (`[security] gate legacy human features`)

## Finding

The agent-first pivot had no explicit boundary for legacy human-facing product modules. Legacy routes for photos, albums, shared albums, Glacier, photo embeddings, and TOTP were still registered directly at API startup, while related heavy dependencies remained present in API/web package manifests.

## Required outcome

Make the product boundary explicit and operationally testable without breaking current deployments. Legacy human-facing routes should either be intentionally maintained, feature-flagged, or removed. Dependency removal must not be a blind lockfile cleanup while source code still imports those packages.

## RED proof

Added `apps/api/src/__tests__/legacy-human-features-contract.test.ts`.

Initial run before patch:

```text
FAIL src/__tests__/legacy-human-features-contract.test.ts
Error: Cannot find module '../lib/legacy-human-features.js'
```

This proved there was no explicit registration boundary helper, and `index.ts` still registered the legacy route plugins directly.

## Root cause

`apps/api/src/index.ts` mixed agent-first API routes and legacy human-facing routes in the same direct startup registration block. There was no single flag, manifest, or contract describing which legacy routes are intentionally retained during the pivot.

## Files changed

- `apps/api/src/index.ts`
- `apps/api/src/lib/legacy-human-features.ts`
- `apps/api/src/__tests__/legacy-human-features-contract.test.ts`
- `docs/security/legacy-human-features.md`

## Fix summary

- Added `SERAC_ENABLE_LEGACY_HUMAN_FEATURES` as the explicit API feature flag.
- Default remains enabled for non-breaking deployments.
- Disabled values are `false`, `0`, `off`, `disabled`, `no`.
- Added `registerLegacyHumanRoutes()` to centralize the legacy route boundary.
- Moved the following route registrations behind that helper:
  - `photos`
  - `albums`
  - `shared-albums`
  - `photo-embeddings`
  - `glacier`
  - `totp`
- Left agent-first routes and generic encrypted file storage outside the flag.
- Added `docs/security/legacy-human-features.md` documenting route scope, flag behavior, and dependency removal sequence.

## Dependency inventory result

A source scan confirmed the heavy/relic dependencies are still actively referenced and should not be removed blindly:

- `nodemailer`: lazy-loaded by API email helpers;
- `otpauth`: API TOTP routes/tests;
- `qrcode`: web 2FA setup UI;
- `heic2any` / `exifr`: web photo import/metadata pipeline;
- TensorFlow/MobileNet / HuggingFace Transformers: web ML/photo-classification and CLIP embedding code.

Follow-up removal requires first disabling/removing the corresponding feature modules, then updating package manifests and lockfile.

## Verification

Focused GREEN:

```text
apps/api/src/__tests__/legacy-human-features-contract.test.ts (3 tests) passed
```

Targeted P2/API non-regression:

```text
7 files passed, 31 tests passed
cors-policy, archive-audit, health-contract, metrics-contract,
cleanup-scheduler-lock, telegram-alerting-contract,
legacy-human-features-contract
```

Typecheck:

```text
cd /home/sniper/serac/apps/api && npx --no-install tsc --noEmit
# exit 0
```

Hygiene:

```text
git diff --check -- targeted files
STATIC_SCAN_OK
TEMP_CONFIG_OK
```

Push verification:

```text
LOCAL_SHA=2fdb1480ab33787e9fab602f8d37373fd7abe974
REMOTE_SHA=2fdb1480ab33787e9fab602f8d37373fd7abe974
```

## Verification limitations

- No live deployment was performed.
- The flag is source-level only until deployed/configured.
- Legacy web dependencies remain by design because the corresponding web modules still import them.
- No production `.env` or secrets were read.

## Deployment status

Not deployed. No image/container/service rebuild, restart, Caddy reload, migration, or runtime config change was performed.

## Rollback

Revert commit `2fdb1480ab33787e9fab602f8d37373fd7abe974` on the remediation branch. This restores direct registration of legacy route plugins in `index.ts` and removes the new helper/test/doc.

## Next step

Continue with `P2-J` base images/dependencies maintenance or `P2-K` storage/cleanup reconciliation. `P2-J` may require package/image update policy and should avoid installing/fetching new dependencies without explicit review.
