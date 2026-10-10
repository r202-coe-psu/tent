---
id: CR-062
title: External API keys for public-plane machine consumers (`/external/v1` + Mongo `api_keys`)
status: approved
date: 2026-08-07
requested_by: ทีมพัฒนา
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - packages/tent-model/src/tent_model/api_key.py (Mongo collection `api_keys`)
  - packages/tent-model/src/tent_model/{db,__init__}.py (register ApiKey)
  - backend/apiapp/core/security.py (`verify_api_key`)
  - backend/apiapp/modules/api_keys/ (admin CRUD `/v1/admin/api-keys`)
  - backend/apiapp/modules/external/ (keyed reads `/external/v1/*`)
  - backend/tests/test_api_keys.py
  - frontend BFF `/api/v1/api-keys` + SA UI (separate slice; not in this CR body as code)
  - docs/data/api-contract.md (pointer — contract split public vs external; edit when approved)
  - docs/prd/role-permission-matrix.md (SA-only FR-50-lite management; edit when approved)
---

# CR-062 — External API keys for public-plane machine consumers

## Why

Public SPA (`/public/*`) must stay **anonymous** so browsers never hold a secret. External /
machine consumers (agencies, ROD-style integrators) still need a managed principal to call the
same public read data. Full EOC aggregate + per-key geographic scope / rate-limit audit
(**T-37 / T-38 / T-39**, FR-49–FR-51) remains **deferred** post-go-live — this CR ships the
**key principal + lifecycle early** (FR-50-lite) so integrators can authenticate against a
stable `/external/v1` surface without waiting for aggregate APIs.

## Change

### Auth split

| Surface | Auth | Audience |
| --- | --- | --- |
| `/public/v1/*` | **Bearer `EXTERNAL_API_SECRET`** (BFF-only; see **CR-063**) | Public SPA via SvelteKit BFF |
| `/external/v1/*` | **Required** `X-API-Key` (managed key) | External / machine clients |
| `/v1/admin/api-keys` | `EXTERNAL_API_SECRET` Bearer | Staff BFF (SA-gated) |

> **CR-063 (2026-08-07):** supersedes the earlier “`/public/v1` stays anonymous” decision in this CR.

### Mongo `api_keys` (Beanie `ApiKey`)

| Field | Purpose |
| --- | --- |
| `_id` | ULID |
| `name` | Label (e.g. "Hat Yai ROD") |
| `owner` | Org / person free text |
| `key_prefix` | First 8 chars of secret for list UI (`tsk_ab12…`) |
| `key_hash` | SHA-256 of full secret (never store plaintext) |
| `expires_at` | Required expiry |
| `created_by` | SA Couch username who issued it |
| `created_at` | Issue time |
| `revoked_at` | Null until revoked |
| `last_used_at` | Optional; updated on successful auth |

Secret format: `tsk_` + high-entropy random. Shown **once** on create. Validation: hash match +
not revoked + `now < expires_at`. Indexed on `key_prefix`.

### Admin + SA management (FR-50-lite)

- FastAPI: `POST/GET /v1/admin/api-keys`, `POST /v1/admin/api-keys/{id}/revoke` behind
  `verify_external_secret` (same pattern as donations).
- Staff UI / BFF (follow-up slice): SA-only via Couch session `isSystemAdmin`; BFF injects
  `EXTERNAL_API_SECRET` — never expose secret or raw keys to non-SA clients.

### Deferred (explicitly out of this CR)

- EOC cross-shelter **aggregate** APIs (T-37 / FR-49)
- Full FR-50 DoD: per-key geographic **scope**, per-key **rate-limit**, request **audit** log (T-38)
- Open API aggregate tier (T-39 / FR-51)
- Replacing `EXTERNAL_API_SECRET` for donation BFF with managed keys

## Impact

- New Mongo collection `api_keys`; no CouchDB `schema_v` bump.
- `/public/v1` is **BFF-only** (Bearer `EXTERNAL_API_SECRET`; CR-063) — not anonymous.
- External clients must use `/external/v1/...` + `X-API-Key` for keyed public reads (shelters,
  needs, family-search, announcements, config/faqs).
- When approved: light updates to `docs/data/api-contract.md` and role matrix row for SA API-key
  management (FR-50-lite) — **do not silent-edit** those docs beyond this CR until owner
  confirms tracking/approval.

## Migration

N/A — new collection; empty until SA issues keys. No backfill.

## Decision log

- 2026-08-07 — proposed (plan: External API Keys for Public Plane)
- 2026-08-07 — approved by owner
