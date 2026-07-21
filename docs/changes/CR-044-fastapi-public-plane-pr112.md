---
id: CR-044
title: CR-017 Amendment — FastAPI as Public Plane (PR #112)
status: approved
date: 2026-07-21
updated: 2026-07-21
requested_by: project owner
decided_by: project owner
layer: volatile
affects:
  - docs/changes/CR-017-dashboard-api-architecture.md
  - backend/
  - worker/
  - frontend/src/lib/features/public-portal/
---

# CR-044 — CR-017 Amendment: FastAPI Public Plane

## Summary

PR #112 implements CR-017 with **FastAPI** (`backend/`) as the public read/write API instead of SvelteKit `+server.ts` only (CR-017 Decision C/E). This CR records that deviation and the completed public-plane scope:

- Outbound sync: `public_persons`, `public_shelters`, `public_needs`, `public_donations`
- Inbound sync: `donations` buffer → CouchDB
- Retention loop 3 + `_retention_audit`
- FastAPI endpoints: family-search, shelters, needs, donations
- SvelteKit retains captcha/rate-limit proxy for donations; Vite proxies `/public/v1/*` to FastAPI

## Privacy

- `public_persons` stores `last_name_masked` only (not full surname)
- Projector maps `person_id` (CR-028) to hash/mask fields at sync time

## Migration

No CouchDB `schema_v` bump. Re-bootstrap worker after deploy to refresh Mongo projections.
