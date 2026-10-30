# DEPLOY — v47.2 server half: `POST /api/events` + Neon `events` table

**Date:** 2026-10-30
**Deployed by:** engineer (v47.2 server-half delegation)
**Deploy target:** Vercel project `site` (`prj_j9hp8mOwIokZ5fFH8RqUgAgTTWOn`, team `notesnap`)
**Live URL:** https://site-notesnap.vercel.app — the deploy printed `LIVE:` and `STABLE:` as the same URL
**Deployed commit (sha):** `db4b5fd` — `test(v47.2): make the /api/events hosting guard actually bite`
(on branch `v472-events-endpoint`; its parent `5158d7a` is the feature commit, and `1d350bd` is the trunk HEAD it branched from)
**Rollback sha:** `1d350bd` — `security: pin Node >= 22.23.4 … (#195)`, the `feat/find-piece-catalog-search` trunk HEAD.
Rollback = check out `1d350bd` in `/home/team/shared/site-fresh` and redeploy:
`VERCEL_PROJECT_NAME=site bun run go-live`. (The two commits being rolled back are additive — six files, one
new endpoint, one new table script — so a rollback loses only event collection, never catalog/money-path code.)

## What shipped

| File | Purpose |
|---|---|
| `scripts/migrate-events-table.ts` | Idempotent `CREATE TABLE IF NOT EXISTS events` + the two indexes; self-verifies against `information_schema` |
| `src/services/events-handler.ts` | `POST /api/events` — allowlist, PII refusal, size caps, rate limit, short write timeout |
| `src/services/events-handler.test.ts` | 30 guards, incl. HOSTING (not just wiring) assertions, mutation-proven |
| `tsconfig.events-check.json` | Targeted type-check (whole-project `tsc` is OOM-killed on this box) |
| `vercel-entry.ts` | Route `/api/events` before the SSR fallthrough |
| `serve.ts` | Same route in the Bun dev entry, so dev and prod agree |

## Commands actually run

```bash
# 1) table (real Neon, DATABASE_URL from site-fresh/.env)
cd /home/team/shared/site-fresh && bun scripts/migrate-events-table.ts
#  -> applying: table events / index (name, created_at) / index (install_id, created_at) / comment
#  -> OK: events table + both indexes exist.   EXIT=0

# 2) gates
bun test --timeout 60000        # 369 tests / 23 files: 358 pass, 11 skip, 0 fail, EXIT=0
node_modules/.bin/tsc -p tsconfig.events-check.json   # EXIT=0 (production files clean)

# 3) deploy (documented step, not a side effect)
cd /home/team/shared/site-fresh
VERCEL_PROJECT_NAME=site nohup bun run go-live > /tmp/v472-golive.log 2>&1 &
#  -> LIVE: https://site-notesnap.vercel.app
#     STABLE: https://site-notesnap.vercel.app
#     domain already registered
```

`VERCEL_PROJECT_NAME=site` matters: without it `go-live.sh` derives the project name from the directory
(`site-fresh`) and prints/registers the wrong stable URL.

## Live verification (curl, 2026-10-30 ~10:16 UTC)

| Probe | Expected | Got |
|---|---|---|
| `POST /api/events` one valid `app_open` | 204 | **204**, empty body |
| `POST /api/events` batch of 2 (`plans_view`, `upgrade_tap`) | 204 | **204**, empty body |
| unknown name `delete_everything` | 400 | **400** `{"success":false,"error":"unknown event name"}` |
| PII prop key `email` | 400 | **400** `{"success":false,"error":"prop key \"email\" is not allowed"}` |
| PII envelope key `phone` | 400 | **400** `{"success":false,"error":"event key \"phone\" is not allowed"}` |
| 21-event batch (cap is 20) | 400 | **400** `{"success":false,"error":"at most 20 events per request"}` |
| `GET /api/events` (wrong method) | 405 | **405** `{"success":false,"error":"Method not allowed. Use POST."}` |
| `GET /api/pieces?limit=1` (money path untouched) | 200, total 536 | **200, total = 536** |

Rows written by those probes, selected back out of Neon:

```json
{"id":"1","install_id":"v472curlverify0001install","name":"app_open","props":{"source":"curl_verify"},"app_version":"0.1.40","build_number":"47","created_at":"2026-10-30T10:15:57.774Z"}
{"id":"2","install_id":"v472curlverify0001install","name":"plans_view","props":{"trigger":"curl_verify"},"app_version":null,"build_number":null,"created_at":"2026-10-30T10:15:58.028Z"}
{"id":"3","install_id":"v472curlverify0001install","name":"upgrade_tap","props":{"tier":"pro_complete","checkout":"opened"},"app_version":null,"build_number":null,"created_at":"2026-10-30T10:15:58.028Z"}
row count for this install: 3
```

## Notes for the next session

* **This deploy shipped unmerged work, deliberately and with the lead's instruction** ("a deploy is fine and
  wanted — just make it an explicit, documented step"). The branch is `v472-events-endpoint`; its diff against the
  trunk is six additive files. If the PR is rejected, run the rollback above.
* `purchase_complete` is **not** collected — it must come from Stripe server-side (webhook endpoint added by the
  owner, or a Stripe key in the server env), never from the client. TODO is in the module header.
* The app-side client module and call sites are a **separate** delegation; until it ships, the only rows in
  `events` are the three probe rows above.
* Neon invoice note: this table is a few rows a day at launch scale; no new cost line.
