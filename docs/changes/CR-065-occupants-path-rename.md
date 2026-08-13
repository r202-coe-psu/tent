---
id: CR-065
title: Rename public/external family-search path to occupants
status: done
date: 2026-08-13
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/api-contract.md §5
  - docs/data/couchdb-mongodb-sync.md §3.2 §4.0 §6
  - docs/data/schema.md §5.1 (query_kind note)
  - docs/sitemap.md
  - docs/features/public-tier-find-spec.html
  - docs/features/public-tier-flow-spec.html
  - docs/task-breakdown/11-famsearch.md (T-41 DoD path)
  - backend/apiapp/modules/evacuee/router.py
  - backend/apiapp/modules/external/router.py
  - frontend BFF /api/public/v1/occupants
  - frontend/src/lib/features/public-portal/data/public-api.ts
  - frontend/src/lib/api-specs/fastapi.json + openapi.d.ts
---

# CR-065 — Rename `family-search` path to `occupants`

## สรุป (TL;DR)

เปลี่ยน HTTP path ของการค้นผู้อยู่อาศัยในศูนย์ จาก `family-search` เป็น `occupants`
ให้ตรงกับ resource ที่ค้น · ไม่ bump `schema_v` · SPA `/search` คงเดิม ·
breaking สำหรับ caller ของ `/public/v1` และ `/external/v1` (ไม่มี alias)

## Why

ชื่อ `family-search` บอกเจตนา (ค้นญาติ) แต่ไม่บอก resource. `occupants` ตรงกับสิ่งที่
endpoint คืน (ผู้อยู่อาศัยในศูนย์ ที่ mask แล้ว)

## Change

| Surface | Before | After |
| --- | --- | --- |
| Public FastAPI | `POST /public/v1/family-search` | `POST /public/v1/occupants` |
| External FastAPI | `POST /external/v1/family-search` | `POST /external/v1/occupants` |
| SvelteKit BFF | `POST /api/public/v1/family-search` | `POST /api/public/v1/occupants` |
| SPA route | `/search` | unchanged |
| Feature name | Family Search (T-41) | unchanged |
| Request/response body | `{ search }` / masked results | unchanged |
| Auth | Bearer (public) / `X-API-Key` (external) | unchanged |

Historical CRs (CR-005, CR-017, CR-044, CR-063) keep the old path as the record of what
was decided then.

## Requirements

- FR-065-1 — FastAPI public router prefix is `/public/v1/occupants` (POST, same body)
- FR-065-2 — FastAPI external mirror is `POST /external/v1/occupants` (same handler)
- FR-065-3 — BFF is `POST /api/public/v1/occupants` and proxies to FastAPI occupants path
- FR-065-4 — old `family-search` paths return 404 (no redirect/alias)
- FR-065-5 — living specs (`api-contract`, sitemap, find/flow specs, T-41 DoD, sync map)
  use the new path

## Acceptance

- `POST /public/v1/occupants` with Bearer succeeds; `POST /public/v1/family-search` is 404
- `POST /external/v1/occupants` with `X-API-Key` succeeds
- SPA `/search` still searches via BFF `/api/public/v1/occupants`
- OpenAPI snapshot (`fastapi.json` + `openapi.d.ts`) lists `/public/v1/occupants`

## Impact

- Backend tests that hit `/public/v1/family-search` must use `/public/v1/occupants`
- External agency clients must update the path (breaking)
- Client helpers (`familySearch`, `FamilySearchResponse`) keep names — only the URL changes

## Migration

N/A (no CouchDB `schema_v`). Redeploy FastAPI + frontend. External API consumers must
switch from `/external/v1/family-search` to `/external/v1/occupants`.

## Decision log

- 2026-08-13 — owner requested path rename family-search → occupants + spec update
- 2026-08-13 — done
