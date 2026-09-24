---
id: CR-135
title: Partner OAuth2 clients — ตั้ง name เอง (unique) + description + module radio preset scope + generated tpc_ client_id; ซ่อนแท็บ External API Keys ชั่วคราว
status: approved
date: 2026-09-24
requested_by: Dev Team B
decided_by: Project Owner (Jakee)
layer: volatile
affects:
  - docs/data/schema.md §9.6 (ใหม่ — `third_party_clients`: +`name`, +`description`, `client_id` generated)
  - schema_v N/A (Mongo Beanie doc ไม่มี `schema_v`; additive)
  - packages/tent-model/src/tent_model/third_party_client.py (fields + unique index `name`)
  - backend/apiapp/modules/thirdparty_clients_admin/{schemas,use_case}.py (request/response shape, 409 ชื่อซ้ำ)
  - backend/apiapp/modules/thirdparty_auth/provisioning.py (`generate_client_id` → `tpc_…`)
  - backend/tests/test_thirdparty_clients_admin.py
  - scripts/smoke_test_partner_api.py (ไม่ส่ง `client_id` แล้ว — อ่านจาก response)
  - frontend/src/routes/api/v1/thirdparty-clients/+server.ts (BFF body)
  - frontend/src/lib/features/third-party-clients/** (domain schema, create dialog, list, reveal dialog)
  - frontend/src/routes/(protected)/system-management/api-keys/+page.svelte (ซ่อนแท็บ External)
  - frontend/src/lib/api-specs/fastapi.json + frontend/src/lib/api/openapi.d.ts (regenerate)
why: ชื่อ client ปัจจุบันเป็นแค่ dropdown M6/M7 ทำให้แยก client หลายตัวของโมดูลเดียวกันไม่ได้ และ client_id ที่ admin พิมพ์เองเดาได้/ชนกันได้
migration: additive — doc เดิมไม่มี `name`/`description` (อ่านได้เป็น `null`, UI fallback เป็น `client_id`); `client_id` เดิมใช้ต่อได้ ไม่ rotate
---

# CR-135: Partner OAuth2 clients — name / description / module preset / generated client_id

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ฟอร์มสร้าง Partner OAuth2 client — `name` ตั้งเอง (unique), +`description` (opt), M6/M7 ย้ายเป็น **Module** radio ที่ preset scopes, `client_id` generate เป็น `tpc_…` · แท็บ **External API Keys** ซ่อนชั่วคราว
> - **เพื่อใคร/ทำไม:** `system_admin` ออก credential หลายชุดต่อโมดูลแยกแยะได้; `client_id` สุ่มไม่ให้เดา/ชนกัน
> - **กระทบ schema/scope:** `docs/data/schema.md` §9.6 (ใหม่) · partner contract EXT-001 (`/external/token`, JWT, `TokenResponse`) **ไม่เปลี่ยน**

## Why

- "Name" เดิมคือ dropdown M6/M7 → client หลายตัวของโมดูลเดียวกันแยกไม่ออกว่าออกให้ใคร
- `client_id` ที่ admin พิมพ์เองเดาได้/ต้องกันชนเอง — ให้ระบบ generate แทน
- แท็บ External API Keys (`/external/v1/*` + `X-API-Key`, CR-062) ยังไม่พร้อมเปิดใช้รอบนี้

## Change

**A. แท็บ External API Keys**
- FR-1 — ปิดแท็บ + ไม่เรียก `/api/v1/api-keys` ขณะปิด ผ่าน flag `EXTERNAL_API_KEYS_ENABLED = false`; backend/BFF เดิมไม่เปลี่ยน

**B. Partner OAuth2 client**
- FR-2 — **Name**: text บังคับ, trim, 1–100 ตัวอักษร, unique ไม่สนตัวพิมพ์ (ซ้ำ → `409`)
- FR-3 — **Description**: textarea optional, trim, ≤500 ตัวอักษร; ว่าง → `null`
- FR-4 — **Module**: radio บังคับ `M6 (จัดการทรัพยากร)` / `M7 (EoC)` → เก็บที่ `module_name` เดิม
- FR-5 — เลือก Module → preset scopes ทันที (`M6`: location-read, location-stock-read · `M7`: +occupancy-read) แล้วยัง tick/untick เพิ่ม/ลดได้ (รวม `occupancy-pii-read`)
- FR-6 — ไม่มีช่อง Client ID ในฟอร์ม; FastAPI generate `client_id = "tpc_" + token_urlsafe(16)`, ไม่รับจาก request
- FR-7 — Create response/reveal dialog แสดง `client_id` (copy ได้) + `client_secret` (ครั้งเดียว) + name + module
- FR-8 — List แสดง Name (+description), Client ID, Module, Scopes, Created, Status; `name = null` (doc เดิม) แสดง `client_id` แทน

### Before → after (`POST /v1/admin/thirdparty-clients`)

| | Before | After |
| --- | --- | --- |
| Request body | `{ client_id, module_name, allowed_scopes }` | `{ name, description?, module_name, allowed_scopes }` |
| `client_id` | admin พิมพ์ (`^[a-z0-9-]+$`), ซ้ำ → 409 | ระบบ generate `tpc_…` |
| ชื่อที่แสดง | `module_name` (M6/M7) | `name` (unique) |
| Response | + | `name: str\|null`, `description: str\|null` |

## Acceptance

- AC-1 — หน้า API Keys เห็นเฉพาะแท็บ Partner OAuth2 Clients ไม่มี request ไป `/api/v1/api-keys`
- AC-2 — สร้าง client name `"EOC Songkhla"` + Module M7 → scopes tick 3 ตัวตาม FR-5; `client_id` ขึ้นต้น `tpc_`, secret ขึ้นต้น `tps_`
- AC-3 — สร้างซ้ำชื่อ (ต่างตัวพิมพ์) → `409` ไม่มี doc ใหม่
- AC-4 — ไม่กรอก description → persist `null`
- AC-5 — client ใหม่/เดิมแลก token ที่ `POST /external/token` ได้ปกติทั้งคู่
- AC-6 — `pnpm lint` / `pnpm check` / `pnpm test` / `pytest tests/test_thirdparty_clients_admin.py` ผ่าน

## Impact

- **Backend:** `ThirdPartyClient` model (+2 field, +unique index `name`), admin schemas/use case, provisioning, tests
- **Frontend:** feature `third-party-clients`, BFF create route, api-keys page, OpenAPI regenerate
- **ไม่กระทบ:** `/external/*`, `third_party_access_logs`, feature `api-keys` (โค้ดคงอยู่ แค่ไม่ mount)

## Migration

- N/A สำหรับ `schema_v`; ไม่ backfill doc เดิม (`name`/`description` = `null`); `client_id` เดิมไม่ rotate

## History

- 2026-09-24 — proposed as `draft-partner-client-name-module-preset`
- 2026-09-24 — **approved** — Project Owner (Jakee); รันเลข **CR-135** (ถัดจาก CR-134 บน `develop`)
