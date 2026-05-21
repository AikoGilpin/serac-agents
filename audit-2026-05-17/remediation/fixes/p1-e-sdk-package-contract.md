# P1-E — SDK public package contract

- Status: `retargeted_on_live_checkout_verified_not_deployed_not_published`
- Priority: P1
- Updated UTC: 2026-05-21T13:24:27Z
- Serac branch: `remediation/p1f-p2a-p2d-20260520T010137Z`
- Serac commit containing P1-E: `0bb0128e4d4be28e57022c628789b3c073d0b6a8`
- Current branch head verified remote: `071aa214270274e82b601e630f16c2c0e149ffa0`
- Source report: `/home/hermes/projects/serac-agents/audit-2026-05-17/05-mcp-sdk-registries.md` — `[P1-009] Package SDK public incohérent avec le code et la documentation`
- Final synthesis reference: `/home/hermes/projects/serac-agents/audit-2026-05-17/99-final-synthesis.md` — `P1-E — Package SDK public incohérent`

## Finding

The SDK source and docs advertised `@serac/sdk` v1.0.0, while the public npm package line observed by the audit was `serac-agent-sdk` v0.1.x. This breaks onboarding for agents/humans following repo docs or registry metadata, because they can install or import a package name that is not the public package currently used by the project.

A related SDK onboarding drift was fixed in the same contract: SDK default endpoint/docs used `https://serac.cloud/api/agent/mcp/v1`, while canonical discovery/OAuth metadata uses `https://api.serac.cloud/api/agent/mcp/v1`.

## Required outcome

Use a single canonical public SDK package name across source, docs, examples, client metadata, package artifacts, and public onboarding metadata.

Chosen canonical package for this remediation:

- `serac-agent-sdk`
- local package version: `0.1.1` on the existing public `0.1.x` SDK line
- canonical MCP endpoint: `https://api.serac.cloud/api/agent/mcp/v1`

No npm publish/deprecate/reservation action was performed.

## Live checkout scope

The original snapshot patch used `sdk/`, but the real checkout layout is `packages/sdk/`.

Verified live files:

- `packages/sdk/package.json`
- `packages/sdk/README.md`
- `packages/sdk/src/client.ts`
- `packages/sdk/src/index.ts`
- `packages/sdk/src/types.ts`
- `packages/sdk/test/package-contract.test.mjs`
- `apps/api/src/routes/agent/discovery.ts`
- generated/ignored package artifacts under `packages/sdk/dist/*`

The P1-E source changes are already present on the live remediation branch via commit `0bb0128e4d4be28e57022c628789b3c073d0b6a8`.

## RED proof

Initial snapshot RED proof showed the contract was broken before patch:

```text
P1E_CONTRACT_RED
- sdk/package.json must use canonical public package name serac-agent-sdk
- sdk/package.json version must align with public SDK v0.1.x line (0.1.1)
- sdk/package.json must not reference stale @serac/sdk package name
- README title/install/import examples must use serac-agent-sdk
- README must document canonical api.serac.cloud MCP endpoint
- SDK DEFAULT_ENDPOINT must use canonical api.serac.cloud MCP endpoint
- MCP initialize clientInfo must use canonical package name/version
- public discovery onboarding metadata must advertise canonical sdk_package
```

## Root cause

The SDK package contract drifted across three surfaces:

1. local source/package metadata;
2. generated publishable `dist/*` artifacts;
3. public discovery/onboarding metadata.

The snapshot path also differed from the real repo path (`sdk/` vs `packages/sdk/`), which is why live retargeting had to verify the real layout explicitly.

## Files changed / verified

Live branch P1-E changes include:

- `packages/sdk/package.json`
  - `@serac/sdk` → `serac-agent-sdk`
  - version aligned to `0.1.1`
- `packages/sdk/README.md`
  - title, install command, import examples, endpoint updated
- `packages/sdk/src/index.ts`
  - example import updated
- `packages/sdk/src/client.ts`
  - `DEFAULT_ENDPOINT` → `https://api.serac.cloud/api/agent/mcp/v1`
  - MCP `clientInfo` → `serac-agent-sdk` / `0.1.1`
- `packages/sdk/src/types.ts`
  - endpoint documentation comment updated
- `packages/sdk/test/package-contract.test.mjs`
  - dependency-free Node contract test covering source and generated `dist/*`
- `apps/api/src/routes/agent/discovery.ts`
  - public metadata advertises `sdk_package: "serac-agent-sdk"`

## GREEN proof on live checkout

Commands were run on `vps-sniper:/home/sniper/serac`. No `.env` or secret file was read. No network install/fetch was performed.

Package contract:

```text
node packages/sdk/test/package-contract.test.mjs
ok - package name = serac-agent-sdk
ok - package version = 0.1.1
ok - README has serac-agent-sdk
ok - README has npm install serac-agent-sdk
ok - README no stale @serac/sdk
ok - client.ts clientInfo = serac-agent-sdk/0.1.1
ok - client.ts no stale serac-sdk
ok - client.ts endpoint = api.serac.cloud
ok - client.ts no stale serac.cloud endpoint
ok - types.ts endpoint docs = api.serac.cloud
ok - index.ts no stale @serac/sdk
ok - dist client endpoint = api.serac.cloud
ok - dist client no stale serac.cloud endpoint
ok - dist types endpoint docs = api.serac.cloud
ok - dist types no stale serac.cloud endpoint
ok - dist index.js import example = serac-agent-sdk
ok - dist index.js no stale @serac/sdk
ok - dist index.d.ts import example = serac-agent-sdk
ok - dist index.d.ts no stale @serac/sdk
1..19
```

SDK search tests:

```text
node packages/sdk/test/search.test.mjs
1..5
# tests 5
# pass 5
# fail 0
```

Typecheck / package dry-run:

```text
npm run lint --workspace serac-agent-sdk
> tsc --noEmit

npm run lint --workspace @serac/api
> tsc --noEmit

npm pack --dry-run
serac-agent-sdk-0.1.1.tgz
npm notice total files: 22

PACK_ARTIFACT_CLEAN
```

Remote branch verification:

```text
LOCAL=071aa214270274e82b601e630f16c2c0e149ffa0
REMOTE=071aa214270274e82b601e630f16c2c0e149ffa0
SERAC_REMEDIATION_BRANCH_REMOTE_MATCH
```

## Static / packaging notes

- `packages/sdk/dist/*` is ignored by Git but included in `npm pack --dry-run` from the workspace.
- `npm pack --dry-run` did not leave a `.tgz` artifact.
- The contract test intentionally contains stale strings such as `@serac/sdk` in negative assertions; scans must exclude those assertions or inspect semantics, not raw substring presence.

## Limitations

- Not deployed.
- No container/image/service rebuild.
- No npm publish.
- No npm deprecation/reservation for `@serac/sdk`.
- No clean-project `npm install serac-agent-sdk` from registry was performed; publication/registry validation remains a release task.
- Production live behavior is not changed until the remediation branch is merged/deployed where applicable.

## Rollback notes

Rollback is scoped to commit `0bb0128e4d4be28e57022c628789b3c073d0b6a8` if no later commit depends on it:

```bash
git revert 0bb0128e4d4be28e57022c628789b3c073d0b6a8
```

That commit includes P1-F and P2-A-D as well as P1-E, so a narrower rollback would need targeted file reverts for the SDK/discovery files listed above.

## Next step

P1-E source/package contract is verified on the live remediation branch. Remaining work is release policy only:

1. decide whether/when to publish or reserve package names;
2. decide PR/merge/tag/deploy path for `remediation/p1f-p2a-p2d-20260520T010137Z`;
3. keep deployment/publish steps blocked until explicit Aiko approval.
