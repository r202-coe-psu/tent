---
id: draft
title: Partner OAuth2 clients — password-gated secret reveal (reversible encryption), editable scopes, soft-delete after revoke
status: draft
date: 2026-09-24
requested_by: Dev Team B
decided_by: 
layer: stable
affects:
  - docs/data/schema.md §9.6 (`third_party_clients` — +`client_secret_encrypted`, +`deleted_at`)
  - schema_v N/A (Mongo Beanie doc ไม่มี `schema_v`; additive)
  - backend/pyproject.toml + uv.lock (+`cryptography` dependency, root workspace lockfile)
  - backend/apiapp/core/config.py (+`THIRDPARTY_SECRET_ENCRYPTION_KEY`)
  - backend/apiapp/utils/secret_crypto.py (ใหม่ — Fernet encrypt/decrypt)
  - packages/tent-model/src/tent_model/third_party_client.py (+`client_secret_encrypted`, +`deleted_at`)
  - backend/apiapp/modules/thirdparty_clients_admin/{schemas,use_case,router}.py (PATCH scopes, GET secret, DELETE)
  - backend/tests/test_thirdparty_clients_admin.py
  - frontend/src/routes/api/v1/thirdparty-clients/[id]/+server.ts (ใหม่ — PATCH, DELETE)
  - frontend/src/routes/api/v1/thirdparty-clients/[id]/secret/+server.ts (ใหม่ — POST, password re-auth ต่อ CouchDB `_session`)
  - frontend/src/lib/server/couch-admin.ts (+`verifyOwnPassword`)
  - frontend/src/lib/features/third-party-clients/** (domain schemas, data, application, ui — edit-scopes dialog, view-secret dialog, delete dialog)
  - frontend/src/routes/(protected)/system-management/api-keys/+page.svelte
  - .env.example, docker-compose.yml (+`THIRDPARTY_SECRET_ENCRYPTION_KEY`)
why: admin เก็บ client_secret ตอนสร้างพลาด/หาย ต้องดูซ้ำได้; scope ของ client ต้องปรับได้โดยไม่ต้องสร้างใหม่; client ที่ revoke แล้วต้องลบออกจากรายการได้ (audit trail ยังอยู่ใน DB)
migration: additive — client เดิมไม่มี `client_secret_encrypted`/`deleted_at` (อ่านเป็น `null`); reveal ของ client เดิมทำไม่ได้ (ต้อง revoke + สร้างใหม่ถ้าจำเป็น) — ไม่มี backfill เพราะ plaintext เดิมไม่ได้เก็บไว้แต่แรก
---

# Partner OAuth2 clients — reveal secret, edit scope, delete after revoke

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** (1) secret เก็บแบบถอดกลับได้ (Fernet) เพิ่มจาก hash เดิม เพื่อ "ดูซ้ำ" ได้ — gate ด้วยรหัสผ่านของผู้ใช้ที่ login อยู่เองทุกครั้ง (2) ปุ่ม Edit ปรับ `allowed_scopes` ได้ต่อเนื่องขณะยัง active (3) ปุ่ม Delete โผล่หลัง revoke แล้วเท่านั้น — soft-delete (ซ่อนจาก list ไม่ hard-delete)
> - **เพื่อใคร/ทำไม:** `system_admin` — แก้ปัญหาเก็บ secret พลาดกู้ไม่ได้, ต้องสร้าง client ใหม่ทุกครั้งที่ scope เปลี่ยน, client ที่ revoke แล้วเก็บกวาดออกจากรายการไม่ได้
> - **กระทบ schema/scope:** `docs/data/schema.md` §9.6 (additive) · **`layer: stable`** เพราะแตะการเก็บ credential ของ auth plane (EXT-001) — เส้นทาง `/external/token` **ไม่เปลี่ยน** (ยังตรวจด้วย `client_secret_hash` เดิม)

## Why

- Admin ทำ secret ที่คัดลอกไว้หาย/เก็บพลาด — ปัจจุบันมีแต่ hash ทางเดียว ต้อง revoke + สร้าง client ใหม่ทั้งที่ scope/name เดิมยังถูกต้อง เสีย client_id ที่พันธมิตรอาจ hardcode ไว้
- Scope ที่ให้ตอนแรกอาจต้องขยาย/ลดภายหลัง — ปัจจุบันต้อง revoke + สร้างใหม่ ได้ credential ใหม่ทุกครั้ง กระทบพันธมิตรที่ deploy ของเดิมไว้แล้ว
- Client ที่ revoke แล้วสะสมในรายการตลอดไป ไม่มีทางเก็บกวาดโดยไม่เสีย audit trail

## Change

**A. Password-gated secret reveal (stable-core: credential storage)**
- FR-1 — เก็บ `client_secret_encrypted` เพิ่มจาก `client_secret_hash` — เข้ารหัสด้วย Fernet (คีย์จาก `THIRDPARTY_SECRET_ENCRYPTION_KEY`, server-only env var); `client_secret_hash`/`/external/token` **ไม่เปลี่ยน**
- FR-2 — FastAPI `GET /v1/admin/thirdparty-clients/{id}/secret` ถอดรหัสคืน `{client_secret}`; `client_secret_encrypted = null` (client เก่า/ถูกลบ) → `404`
- FR-3 — BFF `POST /api/v1/thirdparty-clients/{id}/secret` body `{password}`: verify กับ CouchDB `_session` ด้วย username จาก session เอง (ไม่รับจาก body, ไม่ forward `Set-Cookie` กลับ) แล้วเรียก FR-2 ต่อในคำขอเดียว
- FR-4 — รหัสผ่านผิด → `401`; ไม่มี step-up token ข้ามคำขอ (กรอกใหม่ทุกครั้ง); rate limit ต่อ IP (10 ครั้ง/นาที เท่า login captcha)
- FR-5 — UI: ปุ่ม "ดู secret" ทุกแถว → dialog 2 ขั้น (กรอกรหัสผ่าน → เห็น secret + copy); ปิด dialog แล้ว state ไม่ค้าง

**B. Editable scopes**
- FR-6 — FastAPI `PATCH /v1/admin/thirdparty-clients/{id}` body `{allowed_scopes}` — validate whitelist เดิม, ≥1 ค่า, เฉพาะตอน `is_active = true` (revoke แล้ว → `409`)
- FR-7 — UI: ปุ่ม Edit เห็นเฉพาะแถว active — dialog ติ๊ก/ถอด scope พร้อมค่าปัจจุบัน แล้ว `PATCH`

**C. Soft-delete after revoke**
- FR-8 — เพิ่ม `deleted_at: ts|null` (default `null`)
- FR-9 — FastAPI `DELETE /v1/admin/thirdparty-clients/{id}` ตั้ง `deleted_at = now()` (ไม่ hard-delete) เฉพาะตอน `is_active = false`; ยัง active → `409`
- FR-10 — List กรอง `deleted_at = null` เสมอ — ซ่อนจาก UI แต่ยังอยู่ใน Mongo (audit)
- FR-11 — UI: ปุ่ม Delete (แดง) เห็นเฉพาะแถวที่ revoke แล้ว — confirm dialog แล้ว `DELETE`

### Before → after

| | Before | After |
| --- | --- | --- |
| ดู secret หลังปิด create dialog | ทำไม่ได้ | `POST .../{id}/secret` + รหัสผ่านตัวเอง |
| แก้ scope | ต้อง revoke + สร้างใหม่ | `PATCH .../{id}` ได้ขณะ active |
| Client ที่ revoke แล้ว | ค้างใน list ตลอดไป | ปุ่ม Delete → soft-delete, หายจาก list |

## Acceptance

- AC-1 — สร้าง client → ปิด reveal dialog → "ดู secret" + รหัสผ่านถูก → เห็น `client_secret` เดิมเป๊ะ
- AC-2 — รหัสผ่านผิด → `401`, secret ไม่แสดง
- AC-3 — client เก่า (ไม่มี `client_secret_encrypted`) กด "ดู secret" → error ชัดเจน ไม่ crash
- AC-4 — Edit scope ขณะ active → save → list อัปเดต; token เก่าที่ mint แล้วคง scope เดิมจนหมดอายุ (ไม่ revoke token ที่ออกไปแล้ว)
- AC-5 — client ที่ revoke แล้ว: ปุ่ม Edit หาย, `PATCH` ตรง → `409`
- AC-6 — client active: ปุ่ม Delete ไม่แสดง; revoke ก่อน → ปุ่ม Delete โผล่ → กด → หายจาก list, doc ยังอยู่ใน Mongo พร้อม `deleted_at`
- AC-7 — `pnpm lint` / `pnpm check` / `pnpm test` / `pytest tests/test_thirdparty_clients_admin.py` ผ่าน

## Impact

- **Backend:** `ThirdPartyClient` (+2 field), dependency `cryptography` ใหม่, env var ใหม่, 3 endpoint ใหม่
- **Frontend:** feature `third-party-clients` (+3 dialog), 2 BFF route ใหม่, `couch-admin.ts` +1 helper
- **ไม่กระทบ:** `/external/token` verify flow, `third_party_access_logs`

## Migration

- N/A สำหรับ `schema_v`; client เดิม `client_secret_encrypted`/`deleted_at` = `null` โดย default — ไม่ backfill (plaintext เดิมไม่เคยถูกเก็บไว้) → ดูซ้ำไม่ได้ถาวร ต้อง revoke + สร้างใหม่หากต้องการ
- `THIRDPARTY_SECRET_ENCRYPTION_KEY` เป็น secret