# P3 — Ed25519 agent challenge raw/SPKI compatibility

- Status: `fixed_local_verified_not_deployed`
- Priority: P3 polish / compatibility
- Created UTC: 2026-05-21T13:53:53Z
- Source report: `audit-2026-05-17/01-security-whitehat.md` around P3-008 Ed25519 challenge-response compatibility
- Serac branch: `remediation/p1f-p2a-p2d-20260520T010137Z`
- Serac commit: `fef1ad14774ad70862ae0c7798ed9dad118e9a3a` (`fix(api): support raw Ed25519 agent keys`)
- Deployment status: not deployed, not rebuilt, not restarted, no migration

## Finding

Agent registration stores `ed25519_public_key` as a raw 32-byte public key. The challenge-response token route previously treated the stored bytes as DER/SPKI and passed them directly to Node `createPublicKey({ format: "der", type: "spki" })`.

Result: agents using the documented/raw 32-byte registration format could fail challenge signature verification even with a valid Ed25519 signature.

## Required outcome

- Accept existing raw 32-byte Ed25519 public keys without a DB migration.
- Continue accepting DER/SPKI Ed25519 public keys if already present.
- Fail closed for malformed key lengths/encodings.
- Route challenge verification through one tested helper instead of duplicating conversion logic inline.

## RED proof

A focused regression test was added first at:

- `apps/api/src/__tests__/agent-ed25519.test.ts`

Initial RED run failed before implementation because the helper module did not exist:

```text
Cannot find module '../lib/agent-ed25519.js'
1 failed suite, 0 tests
```

This proved the new compatibility path was not yet implemented.

## Root cause

Node's Ed25519 verification expects a key object. Creating that key object from DER/SPKI requires the ASN.1 SubjectPublicKeyInfo envelope, not only the raw 32-byte public key.

Known-good Ed25519 SPKI prefix:

```text
302a300506032b6570032100
```

The correct conversion for stored raw keys is:

```text
SPKI_DER = 302a300506032b6570032100 || raw_public_key_32_bytes
```

## Files changed

- `apps/api/src/lib/agent-ed25519.ts`
  - Added `createAgentEd25519PublicKey(publicKey)`.
  - Added `verifyAgentEd25519Signature(publicKey, message, signature)`.
  - Wraps raw 32-byte keys with the Ed25519 SPKI prefix.
  - Passes through existing SPKI DER keys.
  - Returns `false` for malformed keys/signatures instead of throwing through the route.

- `apps/api/src/routes/agent/auth.ts`
  - Imports `verifyAgentEd25519Signature`.
  - Replaces the inline SPKI-only `createPublicKey` block in `POST /api/agent/auth/token`.

- `apps/api/src/__tests__/agent-ed25519.test.ts`
  - Covers valid raw 32-byte public key verification.
  - Covers valid SPKI DER public key verification.
  - Covers malformed key failure.

## GREEN proof

Focused P3 test:

```text
npx --no-install vitest run --config /tmp/serac-p3-ed25519-vitest.config.mjs
✓ apps/api/src/__tests__/agent-ed25519.test.ts (3 tests)
Test Files 1 passed (1)
Tests 3 passed (3)
```

API typecheck:

```text
npm run lint --workspace @serac/api
> @serac/api@0.1.0 lint
> tsc --noEmit
```

Hygiene:

```text
git diff --cached --check
P3_ED25519_STATIC_SCAN_OK
```

Static scan covered the three P3 files and rejected private-key markers, obvious secret env names, eval/function-constructor usage, child-process execution markers, conflict markers, and trailing whitespace.

Remote push verification:

```text
LOCAL=fef1ad14774ad70862ae0c7798ed9dad118e9a3a
REMOTE=fef1ad14774ad70862ae0c7798ed9dad118e9a3a
SERAC_P3_ED25519_SOURCE_PUSH_VERIFIED
```

## Verification caveats

- No live API request was sent.
- No database or S3 operation was executed.
- No deploy/rebuild/restart/migration was performed.
- A broader untracked `agent-auth.test.ts` in the dirty live checkout asserts unrelated public-registration/P0 behavior and was not used as P3 completion evidence. The P3 patch was restored to a minimal auth diff before final verification and commit.
- Temporary Vitest configs were placed under `/tmp`, not under the repository.

## Rollback

Revert Serac commit:

```text
git revert fef1ad14774ad70862ae0c7798ed9dad118e9a3a
```

This removes the helper/test and restores the previous inline SPKI-only auth verification block. No migration rollback is required because the fix does not change schema or stored key format.

## Next step

Continue remaining P3 polish items or decide the release path for branch `remediation/p1f-p2a-p2d-20260520T010137Z`. Production closure still requires an explicit deploy/rebuild/restart plan and live verification approved by Aiko.
