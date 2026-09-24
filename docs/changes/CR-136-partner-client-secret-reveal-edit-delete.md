---
id: CR-136
title: Partner OAuth2 clients — password-gated secret reveal (deterministic HMAC derivation), editable scopes, soft-delete after revoke, regenerate secret
status: approved
date: 2026-09-24
requested_by: Dev Team B
decided_by: Project Owner (Jakee)
layer: stable
affects:
  - docs/data/schema.md §9.6 (`third_party_clients` — +`secret_issued_at`, +`deleted_at`)
  - schema_v N/A (Mongo Beanie doc ไม่มี `schema_v`; additive)
  - backend/pyproject.toml + uv.lock (~~+`cryptography` dependency~~ — ไม่ต้องใช้ library ภายนอก, HMAC จาก stdlib)
  - backend/apiapp/core/config.py (+`THIRDPARTY_SECRET_SALT`, เดิมชื่อ `THIRDPARTY_SECRET_ENCRYPTION_KEY`)
  - backend/apiapp/utils/secret_derivation.py (ใหม่ — แทน `secret_crypto.py`/Fernet เดิม; `derive_secret(client_id, issued_at)` แบบ HMAC-SHA256, ไม่มี encrypt/decrypt แล้ว)
  - packages/tent-model/src/tent_model/third_party_client.py (+`secret_issued_at`, +`deleted_at`; ตัด `client_secret_encrypted` ออก — ไม่เคยขึ้น production)
  - backend/apiapp/modules/thirdparty_clients_admin/{schemas,use_case,router}.py (PATCH scopes, GET secret, DELETE, POST regenerate-secret)
  - backend/apiapp/modules/thirdparty_auth/provisioning.py (ตัด `generate_client_secret()` ออก — secret มาจาก derive แทน random)
  - backend/tests/test_thirdparty_clients_admin.py, backend/tests/test_secret_derivation.py (แทน test_secret_crypto.py เดิม)
  - frontend/src/routes/api/v1/thirdparty-clients/[id]/+server.ts (ใหม่ — PATCH, DELETE)
  - frontend/src/routes/api/v1/thirdparty-clients/[id]/secret/+server.ts (ใหม่ — POST, password re-auth ต่อ CouchDB `_session`)
  - frontend/src/routes/api/v1/thirdparty-clients/[id]/regenerate-secret/+server.ts (ใหม่ — POST)
  - frontend/src/lib/server/couch-admin.ts (+`verifyOwnPassword`)
  - frontend/src/lib/features/third-party-clients/** (domain schemas, data, application, ui — edit-scopes, view-secret, delete, regenerate-secret dialogs)
  - frontend/src/routes/(protected)/system-management/api-keys/+page.svelte
  - .env.example, docker-compose*.yml (+`THIRDPARTY_SECRET_SALT`, เดิมชื่อ `THIRDPARTY_SECRET_ENCRYPTION_KEY`)
why: admin เก็บ client_secret ตอนสร้างพลาด/หาย ต้องดูซ้ำได้; scope ของ client ต้องปรับได้โดยไม่ต้องสร้างใหม่; client ที่ revoke แล้วต้องลบออกจากรายการได้ (audit trail ยังอยู่ใน DB); secret ที่สงสัยว่าหลุด/รั่วต้องเปลี่ยนได้โดยไม่เสีย client_id เดิม
migration: additive — client เดิมไม่มี `secret_issued_at`/`deleted_at` (อ่านเป็น `null`); reveal ของ client เดิมทำไม่ได้ (ต้อง revoke + สร้างใหม่ถ้าจำเป็น) — ไม่มี backfill เพราะ plaintext เดิมไม่ได้เก็บไว้แต่แรก
revision note (2026-09-24): เปลี่ยนกลไก FR-1 จาก **reversible encryption (Fernet)** เป็น **deterministic derivation (HMAC-SHA256)** ก่อน CR นี้เคย merge เข้า main — ยังไม่เคยขึ้น production จึงแก้ไฟล์นี้ตรงๆ แทนการเปิด CR ใหม่ (ตามที่เจ้าของโครงการเลือก). เหตุผลของ Dev Team B ที่ขอเปลี่ยน: ไม่อยากพึ่ง `cryptography` dependency; เหตุผลด้าน security ที่ยอมรับ trade-off นี้ (แจ้งไว้ระหว่างพัฒนา): ถ้า `THIRDPARTY_SECRET_SALT` รั่ว จะ derive secret ของ**ทุก** client ได้ทันทีจาก `client_id` + `secret_issued_at` ที่เป็น plaintext ใน Mongo อยู่แล้ว — กว้างกว่าความเสี่ยงเดิมของ Fernet key รั่ว (ซึ่งยังต้องมี ciphertext ต่อ client ประกอบด้วย) ยังไม่มี key-rotation policy เหมือนเดิม
---

# CR-136: Partner OAuth2 clients — reveal secret, edit scope, delete after revoke, regenerate secret

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** (1) secret ดูซ้ำได้โดย derive กลับแบบ deterministic (HMAC-SHA256 จาก `client_id` + `secret_issued_at`, ไม่มี ciphertext เก็บเลย) เพิ่มจาก hash เดิม — gate ด้วยรหัสผ่านของผู้ใช้ที่ login อยู่เองทุกครั้ง (2) ปุ่ม Edit ปรับ `allowed_scopes` ได้ต่อเนื่องขณะยัง active (3) ปุ่ม Delete โผล่หลัง revoke แล้วเท่านั้น — soft-delete (ซ่อนจาก list ไม่ hard-delete) (4) ปุ่ม "Generate new secret" ออก secret ใหม่ให้ client_id เดิม โดยมี confirm dialog เตือนก่อนว่า secret เก่าจะใช้ไม่ได้ทันที
> - **เพื่อใคร/ทำไม:** `system_admin` — แก้ปัญหาเก็บ secret พลาดกู้ไม่ได้, ต้องสร้าง client ใหม่ทุกครั้งที่ scope เปลี่ยน, client ที่ revoke แล้วเก็บกวาดออกจากรายการไม่ได้, secret สงสัยรั่วต้องเปลี่ยนได้โดยไม่เสีย client_id เดิม
> - **กระทบ schema/scope:** `docs/data/schema.md` §9.6 (additive) · **`layer: stable`** เพราะแตะการเก็บ credential ของ auth plane (EXT-001) — เส้นทาง `/external/token` **ไม่เปลี่ยน** (ยังตรวจด้วย `client_secret_hash` เดิม)

## Why

- Admin ทำ secret ที่คัดลอกไว้หาย/เก็บพลาด — ปัจจุบันมีแต่ hash ทางเดียว ต้อง revoke + สร้าง client ใหม่ทั้งที่ scope/name เดิมยังถูกต้อง เสีย client_id ที่พันธมิตรอาจ hardcode ไว้
- Scope ที่ให้ตอนแรกอาจต้องขยาย/ลดภายหลัง — ปัจจุบันต้อง revoke + สร้างใหม่ ได้ credential ใหม่ทุกครั้ง กระทบพันธมิตรที่ deploy ของเดิมไว้แล้ว
- Client ที่ revoke แล้วสะสมในรายการตลอดไป ไม่มีทางเก็บกวาดโดยไม่เสีย audit trail
- Secret ที่สงสัยว่ารั่ว/หลุด ต้องเปลี่ยนได้ทันทีโดยไม่กระทบ client_id/name/scope ที่พันธมิตร config ไว้แล้ว — revoke+create ใหม่ทั้งชุดหนักเกินไปสำหรับแค่ต้องการ secret ใหม่

## Change

**A. Password-gated secret reveal (stable-core: credential storage)**
- FR-1 — เก็บ `secret_issued_at` เพิ่มจาก `client_secret_hash` — ไม่เก็บ ciphertext ใดๆ: `client_secret` derive แบบ deterministic ด้วย `HMAC-SHA256(key=THIRDPARTY_SECRET_SALT, msg=client_id + secret_issued_at)` (คีย์/salt จาก server-only env var); `client_secret_hash`/`/external/token` **ไม่เปลี่ยน**
- FR-2 — FastAPI `GET /v1/admin/thirdparty-clients/{id}/secret` คำนวณ derive ซ้ำคืน `{client_secret}`; `secret_issued_at = null` (client เก่า/ถูกลบ) → `404`
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
- FR-11.1 — unique index ของ `name` (§9.6) ต้องนับเฉพาะแถว `deleted_at = null` — client ที่ถูกลบแล้วไม่กันชื่อ สร้าง client ใหม่ด้วยชื่อเดิมได้ (ทั้ง pre-check ระดับ use-case และ partial index ระดับ Mongo)

**D. Regenerate secret**
- FR-12 — FastAPI `POST /v1/admin/thirdparty-clients/{id}/regenerate-secret` — ตั้ง `secret_issued_at` เป็นเวลาปัจจุบัน แล้ว derive secret ใหม่จากค่านั้น, เขียนทับ `client_secret_hash`; `client_id`/`name`/`scopes` **ไม่เปลี่ยน**; คืน response ทรงเดียวกับตอนสร้าง (`client_secret` plaintext ครั้งเดียว)
- FR-13 — เฉพาะตอน `is_active = true` เท่านั้น (เหมือน Edit scope) — revoke แล้ว → `409`
- FR-14 — secret เก่าใช้ authenticate ไม่ได้ทันทีที่ regenerate สำเร็จ (`client_secret_hash` ถูกเขียนทับ) — ไม่มี grace period
- FR-15 — UI: ปุ่ม "Generate new secret" (เห็นเฉพาะแถว active) → **confirm dialog เตือนก่อนเสมอ** ว่าจะทำให้ secret เดิมใช้งานไม่ได้ทันที ต้องกดยืนยันอีกครั้งจึงจะเรียก API จริง — สำเร็จแล้วเปิด dialog เดียวกับตอนสร้าง client แสดง secret ใหม่ครั้งเดียว

### Before → after

| | Before | After |
| --- | --- | --- |
| ดู secret หลังปิด create dialog | ทำไม่ได้ | `POST .../{id}/secret` + รหัสผ่านตัวเอง |
| แก้ scope | ต้อง revoke + สร้างใหม่ | `PATCH .../{id}` ได้ขณะ active |
| Client ที่ revoke แล้ว | ค้างใน list ตลอดไป | ปุ่ม Delete → soft-delete, หายจาก list |
| Secret สงสัยรั่ว | revoke + สร้าง client ใหม่ทั้งชุด (เสีย client_id เดิม) | ปุ่ม Generate new secret (มี confirm) → client_id เดิม, secret ใหม่ |

## Acceptance

- AC-1 — สร้าง client → ปิด reveal dialog → "ดู secret" + รหัสผ่านถูก → เห็น `client_secret` เดิมเป๊ะ
- AC-2 — รหัสผ่านผิด → `401`, secret ไม่แสดง
- AC-3 — client เก่า (ไม่มี `secret_issued_at`) กด "ดู secret" → error ชัดเจน ไม่ crash
- AC-4 — Edit scope ขณะ active → save → list อัปเดต; token เก่าที่ mint แล้วคง scope เดิมจนหมดอายุ (ไม่ revoke token ที่ออกไปแล้ว)
- AC-5 — client ที่ revoke แล้ว: ปุ่ม Edit หาย, `PATCH` ตรง → `409`
- AC-6 — client active: ปุ่ม Delete ไม่แสดง; revoke ก่อน → ปุ่ม Delete โผล่ → กด → หายจาก list, doc ยังอยู่ใน Mongo พร้อม `deleted_at`
- AC-6.1 — สร้าง client ชื่อ X → revoke + delete → สร้าง client ใหม่ชื่อ X (case ต่างกันก็ได้) → สำเร็จ `201`; ระหว่างที่ X ตัวแรกยัง active สร้างซ้ำชื่อ X → `409`
- AC-7 — กด "Generate new secret" → เห็น confirm dialog เตือนก่อน; ยืนยัน → `client_id` เดิม, `client_secret` ใหม่ (คนละค่ากับตอนสร้าง)
- AC-8 — ลอง `/external/token` ด้วย secret เก่าหลัง regenerate → `401`; ด้วย secret ใหม่ → สำเร็จ
- AC-9 — client ที่ revoke แล้ว: ปุ่ม Generate new secret หาย, เรียก endpoint ตรง → `409`
- AC-10 — `pnpm lint` / `pnpm check` / `pnpm test` / `pytest tests/test_thirdparty_clients_admin.py` ผ่าน

## Impact

- **Backend:** `ThirdPartyClient` (+2 field), env var ใหม่ (`THIRDPARTY_SECRET_SALT`, ไม่ต้องเพิ่ม dependency ภายนอก — HMAC จาก stdlib), 4 endpoint ใหม่ (`GET .../secret`, `PATCH`, `DELETE`, `POST .../regenerate-secret`)
- **Frontend:** feature `third-party-clients` (+4 dialog), 3 BFF route ใหม่, `couch-admin.ts` +1 helper
- **ไม่กระทบ:** `/external/token` verify flow (ยกเว้นว่า secret ที่ถูก regenerate จะใช้ไม่ได้ทันที — ตามที่ตั้งใจ), `third_party_access_logs`

## Migration

- N/A สำหรับ `schema_v`; client เดิม `secret_issued_at`/`deleted_at` = `null` โดย default — ไม่ backfill (plaintext เดิมไม่เคยถูกเก็บไว้) → ดูซ้ำไม่ได้ถาวร ต้อง revoke + สร้างใหม่หากต้องการ
- `THIRDPARTY_SECRET_SALT` เป็น production secret ที่**ความเสี่ยงกว้างกว่า Fernet key เดิม**: รั่ว = derive secret ของ**ทุก** client ได้ทันทีจาก `client_id` + `secret_issued_at` ที่เป็น plaintext ใน Mongo อยู่แล้ว (ไม่ต้องพึ่ง ciphertext ต่อ client เหมือนก่อน) — ยังไม่มี key-rotation policy/ที่เก็บ salt จริงใน production กำหนดแยกก่อน deploy
- **Index migration (manual, ทุก environment ที่เคย deploy CR นี้มาก่อนรอบล่าสุด):** `name_unique_ci` เปลี่ยน `partialFilterExpression` (เพิ่ม `deleted_at: null`) — Mongo ไม่ auto-update index ที่มีอยู่แล้ว ต้องรันก่อน deploy โค้ดใหม่ ไม่งั้น Beanie startup จะ error `IndexKeySpecsConflict`:
  ```js
  db.third_party_clients.dropIndex("name_unique_ci")
  ```
  (Beanie สร้าง index ใหม่ให้อัตโนมัติตอน startup ครั้งถัดไป)

## History

- 2026-09-24 — proposed as `draft-partner-client-secret-reveal-edit-delete` (รวม revision เปลี่ยน Fernet → HMAC ก่อนขึ้น production)
- 2026-09-24 — **approved** — Project Owner (Jakee); รันเลข **CR-136** (ถัดจาก CR-135 บน `develop`)