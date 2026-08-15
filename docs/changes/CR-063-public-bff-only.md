---
id: CR-063
title: Lock /public/v1 to BFF-only (Bearer EXTERNAL_API_SECRET); browser never hits FastAPI
status: approved
date: 2026-08-07
requested_by: ทีมพัฒนา
decided_by: เจ้าของโครงการ
layer: stable
affects:
  - docs/changes/CR-062-external-api-keys.md (supersedes anonymous /public/v1 claim)
  - backend/apiapp/modules/{shelter,evacuee,needs,config,announcements}/router.py
  - frontend BFF /api/public/v1/{family-search,shelters,needs,…}
  - frontend/src/lib/features/public-portal/data/public-api.ts
  - frontend/vite.config.ts (remove /public-api proxy)
  - nginx/nginx.conf (remove /public-api location)
  - frontend/CONTRIBUTING.md §4.2, CONVENTIONS.md §12
---

# CR-063 — BFF-only public plane (approach 1)

## Why

`/public/v1` was reachable anonymously via browser `/public-api` → FastAPI. That cannot
enforce “เฉพาะระบบเรา” for sensitive public-plane data (esp. family-search). Donations
already used BFF + `EXTERNAL_API_SECRET`; the rest of the public plane must match.

## Change

| Surface | Before | After |
| --- | --- | --- |
| `/public/v1/*` | Mostly anonymous (donations already Bearer) | **All** routes require Bearer `EXTERNAL_API_SECRET` |
| Public SPA | Some reads via `/public-api` → FastAPI | **Only** same-origin `/api/public/v1/*` BFF |
| `/external/v1/*` | Managed `X-API-Key` | Unchanged (CR-062) |
| Vite `/public-api` proxy | Present | **Removed** |
| nginx `/public-api/` | Present | **Removed** |

Amends **CR-062** auth table: `/public/v1/*` is no longer anonymous.

## Impact

- Browser cannot call FastAPI directly; secret stays server-side (`fastapiServiceHeaders`).
- External agencies continue on `/external/v1` + SA-issued keys.
- Backend tests that assumed anonymous public reads must send Bearer.
- Local FastAPI `:9000` may still be published for BFF/debug but rejects unauthenticated `/public/v1`.

## Migration

N/A (no CouchDB `schema_v`). Redeploy FastAPI + frontend; ensure `EXTERNAL_API_SECRET`
matches between Node BFF and FastAPI. Remove stale `/public-api` from any reverse-proxy
configs outside this repo if present.

## Decision log

- 2026-08-07 — proposed (owner requested full approach 1)
- 2026-08-07 — approved by owner
