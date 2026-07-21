---
id: CR-044
title: CR-017 Amendment — FastAPI as Public Plane (PR #112)
status: approved
date: 2026-07-21
updated: 2026-07-22
requested_by: project owner
decided_by: project owner
layer: volatile
affects:
  - docs/changes/CR-017-dashboard-api-architecture.md
  - docs/data/schema.md
  - docs/data/couchdb-mongodb-sync.md
  - backend/
  - worker/
  - frontend/src/lib/features/public-portal/
---

# CR-044 — CR-017 Amendment: FastAPI Public Plane

## Summary

PR #112 implements CR-017 with **FastAPI** (`backend/`) as the public read/write API instead of SvelteKit `+server.ts` only (CR-017 Decision C/E). This CR records that deviation and the completed public-plane scope:

- Outbound sync: `public_persons`, `public_shelters`, `public_needs`, `public_donations`
- Inbound sync: `donations` buffer → CouchDB; `search_audits` → `central_ops.search_audit`
- Retention loop 3 + `_retention_audit`
- FastAPI endpoints: family-search, shelters, needs, donations
- SvelteKit retains captcha/rate-limit proxy for donations; Vite/nginx proxy **exact paths**
  `/public/v1/family-search` and `/public/v1/shelters` only (needs/donations stay on SvelteKit BFF)

## Privacy

- `public_persons` stores `last_name_masked` only (not full surname)
- Projector maps `person_id` (CR-028) to hash/mask fields at sync time
- Family-search writes `search_audits` with `query_hash` / `ip_hash` only (no raw query/IP)

## Schema notes (2026-07-22)

- `search_audit.query_kind` extended to `name|phone|national_id|passport` (was `name|phone`) to match
  public-plane query parsing
- Mongo `donations.booking_ref` unique index + create-time retry (aligns with schema unique)

## Migration

No CouchDB `schema_v` bump. Re-bootstrap worker after deploy to refresh Mongo projections.
Ensure `central_ops` exists (worker `ensure_database` on first search_audit inbound).
