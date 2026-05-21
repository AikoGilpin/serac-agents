# P1-D — Legacy nested MCP discovery alias

- Status: `retargeted_on_live_checkout_verified_not_deployed`
- Priority: P1
- Source report: `/home/hermes/projects/serac-agents/audit-2026-05-17/05-mcp-sdk-registries.md` — `[P1-010] Une discovery MCP obsolète est exposée publiquement sous /api/agent/.well-known/mcp.json`
- Final synthesis reference: `/home/hermes/projects/serac-agents/audit-2026-05-17/99-final-synthesis.md` — `P1-D — Discovery MCP obsolète exposée`
- Created UTC: 2026-05-18T00:14:43Z
- Live retarget UTC: 2026-05-19T22:45:01Z
- Deployment status: Not deployed, not rebuilt, not restarted.
- Secret handling: no `.env`, `.key`, `*.pem`, `credentials/*`, tokens, passwords, or production secrets read or copied.

## Finding

`mcpServerRoutes` is registered under the `/api/agent` prefix while `mcp.ts` also defines `app.get("/.well-known/mcp.json")`. That exposes a second public discovery URL at `/api/agent/.well-known/mcp.json`.

The nested discovery document was divergent from the canonical root discovery:

- stale MCP endpoint: `https://api.serac.cloud/mcp/v1` instead of `https://api.serac.cloud/api/agent/mcp/v1`;
- stale crypto metadata: `AES-256-GCM`, `HKDF-SHA256`, `X25519_ECDH_AES256GCM` instead of the canonical XChaCha20/Argon2id model;
- separate static tool metadata that can drift from `routes/agent/discovery.ts`.

## Required outcome

The legacy nested discovery must not serve a second stale static document. Acceptable outcomes from the audit were:

- remove the route;
- return `404`;
- redirect to `/.well-known/mcp.json`;
- or return exactly the canonical root discovery object.

This patch chooses a minimal `308` redirect to `/.well-known/mcp.json`.

## Live checkout retarget result

Applied to `/home/sniper/serac` only; no deploy/rebuild/restart/migration and no Git staging.

Touched paths:

- `apps/api/src/routes/agent/mcp.ts`
  - Replaced the stale static nested discovery response with a `308` redirect to `/.well-known/mcp.json`.
  - Kept `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=3600`.
  - Removed stale `mcp_endpoint`, `AES-256-GCM`, `HKDF-SHA256`, `X25519_ECDH_AES256GCM` metadata.
- `apps/api/src/__tests__/mcp-discovery-alias.test.ts`
  - Added a source-contract Vitest test asserting canonical root discovery values and absence of stale nested metadata.

Backup before live overwrite:

- `/tmp/serac-p1d-backup-20260519T224501Z`

## Regression test coverage

Added focused Vitest regression test:

- `apps/api/src/__tests__/mcp-discovery-alias.test.ts`

The test covers:

1. Root discovery document contains canonical `mcp_endpoint: "https://api.serac.cloud/api/agent/mcp/v1"`.
2. Root discovery document contains canonical `algorithm: "XChaCha20-Poly1305"`.
3. The nested `/.well-known/mcp.json` route in `mcp.ts` uses `.code(308)` redirect.
4. The nested route includes `Location: /.well-known/mcp.json`.
5. The nested route does not contain `"https://api.serac.cloud/mcp/v1"`.
6. The nested route does not contain `AES-256-GCM`.
7. The nested route does not contain `HKDF-SHA256`.
8. The nested route does not contain `X25519_ECDH_AES256GCM`.

## Verification performed on live checkout

Remote contract check (Python, no-network):

```text
route_has_308 True
route_location True
route_no_stale_endpoint True
route_no_aes True
route_no_hkdf True
route_no_old_sealed True
canonical_endpoint True
canonical_crypto True
P1D_REMOTE_CONTRACT_OK
```

Vitest targeted, with temporary `envDir` pointed to an empty readable directory:

```text
npm run test -- --config vitest.p1d.tmp.config.ts mcp-discovery-alias.test.ts
✓ src/__tests__/mcp-discovery-alias.test.ts (2 tests)
Test Files  1 passed; Tests 2 passed
```

Combined non-regression (P1-D + P1-C):

```text
mcp-discovery-alias.test.ts — 2 tests passed
payment-gate-fail-closed.test.ts — 5 tests passed
payment-gate-tool-naming.test.ts — failed (pre-existing DATABASE_URL import, not mock-compatible; unrelated to P1-D)
Tests 7 passed (P1-D + P1-C tests)
```

TypeScript:

```text
npm run lint --workspace @serac/api
> tsc --noEmit
```

Static scan:

```text
STATIC_SCAN_OK files=2
```

Whitespace / temp cleanup:

```text
TEMP_CONFIG_OK
```

Git status for targeted files:

```text
 M apps/api/src/routes/agent/mcp.ts
?? apps/api/src/__tests__/mcp-discovery-alias.test.ts
```

## Verification limitations

- No live endpoint verification was performed because there was no deploy/rebuild/restart.
- `payment-gate-tool-naming.test.ts` fails with `DATABASE_URL is required` because it imports the DB module directly without mocking; this is a pre-existing limitation unrelated to P1-D.
- Files remain unstaged/uncommitted on the dirty live checkout.

## Rollback notes

If rollback is needed before deployment, restore only this P1-D path from:

- `/tmp/serac-p1d-backup-20260519T224501Z`

Target paths:

- `apps/api/src/routes/agent/mcp.ts`
- `apps/api/src/__tests__/mcp-discovery-alias.test.ts` (remove if rolling back the contract test)

Do not use broad `git restore .` in the dirty checkout; previous P0/P1 remediations may share adjacent files.

## Next step

P1-D source-level remediation is verified on the live checkout but not deployed. Deployment/rebuild/restart still requires explicit Aiko approval. Continue with P3 polish, release/deploy planning, or separate SDK package publication planning if Aiko approves it.
