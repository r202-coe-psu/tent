---
id: CR-137
title: "Shrink master_data enum (10→4) + municipality_zone/community free text + fixed pet species enum"
status: approved
date: 2026-09-25
updated: 2026-09-25
requested_by: Project Owner (master data form matrix)
decided_by: Project Owner
layer: volatile
affects:
  - docs/data/schema.md §1.3 household municipality_zone/community; §3.1 shelter address; §3.3 master_type enum
  - docs/master-data/README.md
  - frontend/src/lib/features/master-data/domain (MASTER_DATA_TYPES + subsets)
  - frontend/scripts/seed/master-defs.ts
  - registration-config / household-master-data UI
  - public `/api/public/v1/config/pet-types` (removed)
  - household + shelter forms (zone/community selects → text)
why: Master types health_condition, dietary_restrictions, pet_types, house_damage, municipality_zone, community were unused or over-constrained; zone/community should be free text; pets stay dog|cat|other domain enum
migration: N/A — no schema_v bump. Persisted field names unchanged. Existing zone/community values that are master codes remain as stored strings (no auto-migrate to labels). Orphan master_data docs for removed types are ignored by the enum; re-seed no longer creates them. Soft-deactivate or delete orphan docs separately if desired.
---

# CR-137 — Shrink master_data types + zone/community free text

## Why

1. Six `master_type` values (`health_condition`, `dietary_restrictions`, `pet_types`, `house_damage`, `municipality_zone`, `community`) had config UI / seed surface but little or no live form wiring, or forced operators to pick Hat Yai codes instead of typing local names.
2. `municipality_zone` / `community` on household and shelter docs stay as **string fields** but must be **free text** in UI (no master lookup, no parent_code filter).
3. Pet species is a closed domain enum `dog | cat | other` — not a configurable master list. Public `/config/pet-types` is removed.

## Change

### master_type enum (10 → 4)

| Keep | Remove |
| --- | --- |
| `vulnerable_group` | `health_condition` |
| `housing_type` | `dietary_restrictions` |
| `shelter_type` | `pet_types` |
| `volunteer_skills` | `house_damage` |
| | `municipality_zone` |
| | `community` |

- `REGISTRATION_MASTER_TYPES` → `['vulnerable_group']` only
- `HOUSEHOLD_MASTER_TYPES` → `['housing_type']` only
- Seed drops the six removed types (including Hat Yai zone/community lists)
- `parent_code` remains optional on items for generic hierarchy; no community→zone consumer remains

### Field semantics (names unchanged)

| Field | Before | After |
| --- | --- | --- |
| `household.municipality_zone` / `shelter.municipality_zone` | code from `master_data:municipality_zone` | free-text string (optional) |
| `household.community` / `shelter.community` | code from `master_data:community` | free-text string (optional) |
| `pets[].species` | staff: domain enum; public: codes from pet_types master | domain enum `dog \| cat \| other` everywhere |

### API / UI

- Remove BFF `GET /api/public/v1/config/pet-types` and `usePetTypes` / `fetchPetTypes`
- Registration config UI shows only `vulnerable_group`
- Household master-data UI shows only `housing_type`
- Forms / import: zone & community are text inputs; validation copy uses 「ระบุ」not 「เลือก」

## Impact

- Spec: `docs/data/schema.md`, `docs/master-data/README.md`
- Domain + seed + config pages + household/shelter address UI + people-import sample rows
- Unit + e2e tests that enumerate removed types or mock zone/community dropdowns / pet-types

## Migration

N/A (no `schema_v` bump).

- **No auto-migration** of old zone/community codes → human labels; values display as stored until edited.
- Orphan `master_data:{removed_type}` docs may remain in CouchDB; the app enum no longer loads them. Optional ops cleanup outside this CR.

## Decision log

- 2026-09-25 — approved; track as CR file (owner default for this plan)
