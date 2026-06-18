---
id: CR-004
title: "Shelter create + edit — เพิ่ม capacity field, PATCH endpoint, edit UI, schema_v bump"
status: approved
date: 2026-06-18
requested_by: project owner (session 2026-06-18)
decided_by: project owner (session 2026-06-18)
layer: volatile
affects:
  - docs/data/schema.md §3.1 — schema_v 1 → 2 (เพิ่ม capacity field)
  - schema_v 1 → 2 (registry/shelter:{ulid} master doc)
  - frontend/src/lib/features/shelters/domain/schema.ts
  - frontend/src/lib/features/shelters/domain/schema.test.ts (new)
  - frontend/src/lib/features/shelters/data/shelters.api.ts
  - frontend/src/lib/features/shelters/application/queries.ts
  - frontend/src/lib/features/shelters/ui/edit-shelter-form.svelte (new)
  - frontend/src/lib/features/shelters/ui/shelter-list.svelte
  - frontend/src/lib/features/shelters/index.ts
  - frontend/src/routes/(protected)/back-office/shelters/+page.svelte
  - frontend/src/routes/api/back-office/shelter/+server.ts (extend GET/POST)
  - frontend/src/routes/api/back-office/shelter/[code]/+server.ts (new — PATCH route)
---

# CR-004 — Shelter create + edit

## Why

หน้า `/back-office/shelters` ปัจจุบันมีเฉพาะ create (ชื่อศูนย์, code auto-mint ฝั่ง server) ไม่มี edit.
Design spec `spec/shelter-create-edit.html` section [1] กำหนดให้:

1. Table แสดง `รหัสศูนย์`, `ชื่อศูนย์`, `ความจุสูงสุด (คน)`, `จัดการ` (ปุ่ม edit)
2. Form เพิ่ม/แก้ไข: `รหัสศูนย์`, `ชื่อศูนย์`, `ความจุสูงสุด`

Canonical schema (`docs/data/schema.md` §3.1) กำหนด `capacity: int>0` เป็น **required field**
แต่ persisted doc ปัจจุบันมีแค่ 6 fields (`code`, `name`, `zones`, `status`, `created_at`, `updated_at`)
— ขาด `capacity` และ field อื่นๆ อีก 7 ตัว (area_m2, facilities, location, contact, edge_url, opened_at, closed_at).

## Change

### Spec mockup ↔ canonical schema reconciliation

| Spec mockup (HTML) | Canonical schema (§3.1) | Decision |
| --- | --- | --- |
| editable `id` field (kebab: `shelter-hatyai`) | immutable `code` (`^SH\d{3,}$`: `SH001`) | **Follow canonical** — code read-only in edit, hidden in create |
| 3 fields (id, name, capacity) | 12 fields | **Minimum scope** — name + capacity เท่านั้น, field อื่นเพิ่มทีหลัง |

### Status field reconciliation

Server POST ปัจจุบันสร้าง master doc ด้วย `status: 'active'` แต่ schema §3.1 กำหนด `status: enum(open, closed)`.
CR นี้แก้ server POST ให้ใช้ `status: 'open'` แทน `active` — v1 doc ที่มี `status: 'active'` จะถูก
treat เป็น `'open'` ใน migration handler.

### Zone type consolidation

`data/shelters.api.ts` มี hand-written `Zone` interface — CR นี้ replace ด้วย `z.infer<typeof zoneSchema>`
จาก `domain/schema.ts` เพื่อ single source of truth. Re-export `Zone` type จาก barrel.

### Schema_v bump: 1 → 2

registry master doc (`shelter:{ulid}`) เพิ่ม field:

| Field | Before (v1) | After (v2) |
| --- | --- | --- |
| `capacity` | ไม่มี | `int>0`, req |
| `status` | `'active'` | `'open'` (per schema §3.1) |

Server migration: v1 doc ที่ไม่มี `capacity` → default `capacity = sum(zones[].capacity)` หรือ `0` ถ้าไม่มี zones.
v1 doc ที่มี `status: 'active'` → treat เป็น `'open'`.

### API contract change

| Method | Before | After |
| --- | --- | --- |
| `GET /api/back-office/shelter` | 5-field summary | เพิ่ม `capacity` field |
| `POST /api/back-office/shelter` | รับ `{ name }` | รับ `{ name, capacity }` + Zod validation |
| `PATCH /api/back-office/shelter/{code}` | ไม่มี | **ใหม่** — รับ `{ name, capacity }`, update registry master + Zod validation |

PATCH ต้องเป็น **separate route file** `routes/api/back-office/shelter/[code]/+server.ts` เพราะ
SvelteKit route matching ต้องการ `[code]` param segment — existing `+server.ts` ที่ collection path
ไม่สามารถ match `/api/back-office/shelter/SH001` ได้.

### Server Zod validation (retrofit)

Server route ปัจจุบัน parse body แบบ ad-hoc `typeof` — เพิ่ม Zod validation สำหรับ POST + PATCH.

### Client-side changes

| Layer | Before | After |
| --- | --- | --- |
| `domain/schema.ts` | `createShelterSchema` (name only) | เพิ่ม `shelterCapacitySchema`, `shelterStatusSchema`, `zoneSchema`, extend `createShelterSchema` (+capacity), เพิ่ม `updateShelterSchema` |
| `data/shelters.api.ts` | `listShelters`, `createShelter` (sends `{ name }` only) | extend `createShelter` body → `{ name, capacity }`; เพิ่ม `updateShelter(code, input)`; replace `Zone` interface with `z.infer`; extend `ShelterSummary` (+capacity) |
| `application/queries.ts` | `useShelters`, `useCreateShelter` | เพิ่ม `useUpdateShelter` |
| `ui/shelter-list.svelte` | 4-column display | เพิ่ม Edit button per row + `onedit` callback + capacity column |
| `ui/edit-shelter-form.svelte` | ไม่มี | **ใหม่** — Superforms + Zod, pre-fill จาก `initial` |
| `+page.svelte` | create card + inline table | refactor inline table → use `ShelterList` component; เพิ่ม edit card + `editing` state |

## Impact

- `docs/data/schema.md` §3.1 — เพิ่ม `capacity` field note, bump `updated:` date
- `docs/changes/_index.md` — เพิ่ม CR-004 row
- `frontend/src/lib/features/shelters/` — 7 ไฟล์แก้/ใหม่
- `frontend/src/routes/api/back-office/shelter/+server.ts` — extend GET/POST
- `frontend/src/routes/api/back-office/shelter/[code]/+server.ts` — **ใหม่** (PATCH route)
- `frontend/src/routes/(protected)/back-office/shelters/+page.svelte` — extend + refactor to use ShelterList
- `frontend/src/lib/features/shelters/domain/schema.test.ts` — **ใหม่** (vitest)

## Migration

**schema_v 1 → 2** สำหรับ `registry/shelter:{ulid}` master doc:

- v1 doc ที่ไม่มี `capacity` → server อ่านแล้ว default `capacity = sum(zones[].capacity) || 0`
- v1 doc ที่มี `status: 'active'` → treat เป็น `'open'`
- PATCH handler ตรวจ `schema_v` ของ doc ปัจจุบัน:
  - ถ้า `schema_v === 1`: migrate → 2 (เติม `capacity` default + fix `status`), แล้ว apply update
  - ถ้า `schema_v === 2`: apply update ตรงๆ
- ไม่จำเป็นต้อง batch-migrate doc เก่า (lazy migration on read/write)

## Decision log

- 2026-06-18 — proposed
- 2026-06-18 — CR tracking method: file in `docs/changes/`
- 2026-06-18 — id field: follow canonical schema (`code` read-only, immutable)
- 2026-06-18 — schema_v: bump 1 → 2
- 2026-06-18 — form scope: minimum (name + capacity only)
- 2026-06-18 — approved by project owner
- 2026-06-18 — review: เพิ่ม `[code]/+server.ts` route, fix `createShelter` body, refactor page to use ShelterList, reconcile `status: 'active'` → `'open'`, consolidate `Zone` type
