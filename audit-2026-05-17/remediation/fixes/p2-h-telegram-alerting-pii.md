# P2-H — Telegram alerting observability and PII masking

- Status: `fixed_local_branch`, not deployed
- Priority: P2
- Source finding: `audit-2026-05-17/06-ops-observability.md` `[P2-023] Alerting Telegram best-effort silencieux et fuite PII partielle`
- Fixed UTC: 2026-05-21T11:49:13Z
- Branch: `remediation/p1f-p2a-p2d-20260520T010137Z`
- Commit: `c6a9451873af5b8beb0ad6c65ed4fb638a04b77c` (`[security] add Telegram alert observability`)

## Finding

`sendTelegramAlert()` silently no-oped when Telegram configuration was absent and swallowed delivery failures. Separately, the over-quota cleanup path sent the raw user email in the Telegram alert body, even though local cleanup logs already used `maskEmail()`.

## Required outcome

Best-effort alerting must remain non-blocking, but skipped/failed/sent outcomes must be observable. Missing Telegram configuration must be visible without exposing token/chat values. Alert payloads that include user identifiers must be masked before network egress.

## RED proof

Added `apps/api/src/__tests__/telegram-alerting-contract.test.ts`.

Initial run before patch:

```text
apps/api/src/__tests__/telegram-alerting-contract.test.ts (4 tests | 4 failed)
TypeError: refreshTelegramAlertMetrics is not a function
AssertionError: expected undefined to match object { status: 'sent' }
AssertionError: expected undefined to match object { status: 'failed', reason: 'http_503' }
AssertionError: expected cleanup.ts to contain masked over-quota Telegram call site
```

## Root cause

`apps/api/src/lib/telegram.ts` returned `void`, did not expose structured outcomes, did not update metrics, and returned early when configuration was absent. The cleanup over-quota Telegram call used `user["email"]` directly instead of the existing `maskEmail()` helper.

## Files changed

- `apps/api/src/lib/telegram.ts`
- `apps/api/src/lib/cleanup.ts`
- `apps/api/src/__tests__/telegram-alerting-contract.test.ts`
- `docs/observability/serac-api-metrics.md`

## Fix summary

- Added structured `TelegramAlertResult` return values:
  - `{ status: "sent" }`
  - `{ status: "failed", reason }`
  - `{ status: "skipped", reason: "not_configured" }`
- Added `refreshTelegramAlertMetrics()` so missing configuration is visible without reading or printing secret values.
- Added Telegram metrics:
  - `serac_telegram_alert_configured{channel="admin"}`
  - `serac_telegram_alerts_total{result="sent"}`
  - `serac_telegram_alerts_total{result="skipped",reason="not_configured"}`
  - `serac_telegram_alerts_total{result="failed",reason="http_<status>|network_error"}`
  - `serac_telegram_alert_last_failure_timestamp_seconds`
- Added defensive `maskSensitive()` email redaction in `sendTelegramAlert()` before Telegram network egress.
- Updated the cleanup over-quota call site to pass `maskEmail(user["email"] as string)`.
- Documented Telegram alert metrics in `docs/observability/serac-api-metrics.md`.

## Verification

Focused GREEN:

```text
apps/api/src/__tests__/telegram-alerting-contract.test.ts (4 tests) passed
```

Targeted P2/API non-regression:

```text
3 files passed, 13 tests passed
cleanup-scheduler-lock, telegram-alerting-contract, metrics-contract
```

Typecheck:

```text
cd /home/sniper/serac/apps/api && npx --no-install tsc --noEmit
API_TSC_OK
```

Hygiene:

```text
git diff --cached --check: OK
STATIC_SCAN_OK
TEMP_CONFIG_OK
LOCAL_SHA == REMOTE_SHA == c6a9451873af5b8beb0ad6c65ed4fb638a04b77c
```

## Limitations

- No deploy, rebuild, restart, migration, DB mutation, Caddy reload, or runtime config change performed.
- Live Telegram delivery and live Prometheus scrape verification remain pending until deployment/config work is explicitly approved.
- `apps/api/src/routes/admin/infra.ts` remains untracked in the dirty live checkout and was not modified/staged for this fix.

## Deployment status

Not deployed.

## Rollback

Revert commit `c6a9451873af5b8beb0ad6c65ed4fb638a04b77c` on branch `remediation/p1f-p2a-p2d-20260520T010137Z` or restore these files from the pre-patch backup:

```text
/tmp/serac-p2h-telegram-backup-20260521T1145Z
```

Affected files:

- `apps/api/src/lib/telegram.ts`
- `apps/api/src/lib/cleanup.ts`
- `apps/api/src/__tests__/telegram-alerting-contract.test.ts`
- `docs/observability/serac-api-metrics.md`

## Next step

Continue the P2 queue with `P2-I` legacy human-facing/dependency scope, unless Aiko chooses deployment planning or a broader branch review first.
