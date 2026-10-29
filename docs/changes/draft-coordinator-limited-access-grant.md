---
id: draft
title: ผู้ประสานงานจิตอาสาออกสิทธิ์ใช้งานระบบให้จิตอาสาได้แบบจำกัด role และมีวันหมดอายุ
status: proposed
date: 2026-10-27
requested_by: "@net-lynx ใน #879 ข้อ 2 (2026-10-27) + ผู้รับงาน (@Mhapong) ตัดสินรายละเอียด"
decided_by: project owner
layer: stable
affects:
  - docs/data/schema.md §6 `_users` (เพิ่ม `role_grants`, หมายเหตุ `duty_window`, design doc `_design/tent_guard`) และ §2.12 `audit` (reason ของ role grant)
  - docs/prd/role-permission-matrix.md decision sync 2026-10-10 (§3 บรรทัด "การจัดการผู้ใช้ยังเป็น SM/SA เท่านั้น"), แถว User Management (VC), แถว VC และ §4
  - docs/changes/06-A-volunteer/CR-104-volunteer-backoffice-and-user-management-v10.md (ตาราง role แถว `volunteer_coordinator` — อ้าง CR นี้)
  - docs/data/api-contract.md (authorization ของ `/api/v1/users` + แถวใหม่ `POST` / `DELETE /api/v1/volunteer-access`, `permanent_roles`)
  - ไม่ bump `schema_v` (`_users` ไม่มี common envelope / `schema_v`)
  - frontend/src/lib/auth/roles.ts (`COORDINATOR_GRANTABLE_CAPABILITIES`, แก้ comment ของ `STAFF_CAPABILITIES`), frontend/src/lib/auth/role-grants.ts
  - frontend/src/lib/server/user-service.ts, frontend/src/routes/api/v1/volunteer-access/+server.ts, frontend/src/routes/api/v1/users/**
  - frontend/src/lib/server (deploy `_users/_design/tent_guard`)
  - frontend/src/lib/features/volunteers (volunteer-access, volunteer-card, volunteer-access-dialog, server/volunteer-access-grant.ts)
  - frontend/src/lib/features/users (user-form: แสดงวันหมดอายุ, ตัวเลือก "ไม่มีวันหมด")
  - worker/src/worker/role_grants.py + retention/job.py (sweep เป็นขั้นแยก)
  - frontend/e2e/volunteer-access-roles.test.ts (#841)
---

# draft-coordinator-limited-access-grant — coordinator ออกสิทธิ์แบบจำกัดและมีวันหมดอายุ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** `volunteer_coordinator` ออกสิทธิ์ใช้งานระบบให้จิตอาสาได้ เฉพาะศูนย์ตัวเอง, 4 role, จิตอาสาที่ยืนยันตัวตนแล้ว, วันหมดอายุบังคับเลือก (ไม่เกินสิ้นวันที่ +7 นับจากวันนี้) และถอนหรือย่นอายุ grant ที่ตัวเองออกได้
> - **เก็บ:** field ใหม่ `_users.role_grants` ที่ผู้ใช้แก้เองไม่ได้ (`validate_doc_update`) worker ถอน role ที่หมดอายุหรือที่ผลยืนยันตัวตนถูกยกเลิก และทุกการเปลี่ยนเขียน `audit`
> - **ไม่เปลี่ยน:** SM/SA ให้ได้ทุก role ไม่มีวันหมด และ coordinator ยังใช้ `POST /api/v1/users` ไม่ได้
> - **layer: stable** (auth) ต้อง review ก่อน approve

---

## Why

- **ที่มา:** #879 ข้อ 2 คำอธิบาย role `volunteer_coordinator` (CR-104, role-permission-matrix แถว VC) บอกว่า "ออกสิทธิ์ระบบให้อาสาช่วยงาน" แต่ปุ่มและ BFF ยอมเฉพาะ SM/SA
- **คำตอบ @net-lynx (2026-10-27):** ทาง A แบบจำกัดสิทธิ์ เพราะการออกสิทธิ์คือการสร้างบัญชี จึงต้องจำกัดศูนย์, role, ยืนยันตัวตน และอายุ
- **ต่างจาก role-permission-matrix §4:** §4 ออกแบบ Time-Bound Dynamic Role Provisioning ที่เปิดและปิด role ตามช่วงกะ CR นี้เลือก**วันหมดอายุ**แทนเพราะทำง่ายกว่ามาก §4 ยังไม่ถูกทำ (ดู FR-15)

## Change

### FR — การออกสิทธิ์โดย coordinator

- **FR-1 ขอบเขตผู้ออก:** ผู้เรียกต้องมี capability `volunteer_coordinator` ในศูนย์ `SHxxx` ตาม `capabilitiesForShelter` (รองรับทั้ง compound `SHxxx:volunteer_coordinator` และ legacy flat `shelter:SHxxx` + `volunteer_coordinator` เหมือน guard อื่น)
  - ศูนย์อ่านจาก role ใน session ของผู้เรียก ไม่เชื่อ `shelter_code` ใน body: ถ้า body ระบุศูนย์ที่ผู้เรียกไม่มีสิทธิ์ ได้ 403
  - จิตอาสาต้องเป็นของศูนย์นั้น
- **FR-2 role ที่ให้ได้:** `registration_staff`, `kitchen_staff`, `distribution_staff`, `facility_staff` เท่านั้น (constant `COORDINATOR_GRANTABLE_CAPABILITIES` ใน `lib/auth/roles.ts`)
  - บัญชีใหม่ได้ role แค่ `shelter:SHxxx` และ `SHxxx:<role>`
  - comment ของ `STAFF_CAPABILITIES` ต้องไม่บอกว่า coordinator ให้ได้ทั้ง 11 role
- **FR-3 ยืนยันตัวตน (เงื่อนไขของสิทธิ์ ไม่ใช่แค่ตอนออก):** จิตอาสาต้องมี `identity_verification.status = verified` อย่างใดอย่างหนึ่ง
  - (ก) ในโปรไฟล์ของศูนย์นี้
  - (ข) ในโปรไฟล์ของศูนย์อื่นที่ `phone_hash` **และ** `national_id_hash` ตรงกันทั้งคู่ โปรไฟล์ที่ไม่มี `national_id_hash` ใช้ได้แค่ (ก)
  - grant บันทึกโปรไฟล์ที่ใช้ยืนยัน (`verified_by`) ถ้าภายหลังโปรไฟล์นั้นไม่เป็น `verified` แล้ว sweep ถอน grant ทันที (FR-12)
- **FR-4 วันหมดอายุ:** ต้องระบุทุกครั้ง ไม่มีค่าเริ่มต้น
  - เลือกวันได้ตั้งแต่วันนี้ถึงวันนี้ +7 วัน (Asia/Bangkok) หมดอายุตอนสิ้นวันที่เลือก (23:59:59 +07:00)
  - ใช้ได้จริงสูงสุดเกือบ 8 วัน (ออกตอน 00:05 เลือกวัน +7) ข้อความใน UI และเอกสารใช้ "ไม่เกินสิ้นวันที่ +7"
- **FR-5 endpoint:** `POST /api/v1/volunteer-access` (เฉพาะ coordinator) บังคับ FR-1 ถึง FR-4 และ FR-7 ทุกข้อ
  - ไม่ผ่านขอบเขต (ศูนย์ / role / บัญชีเป้าหมาย) ได้ 403, ไม่ผ่านวันหมดหรือยืนยันตัวตนได้ 422 และไม่เขียนอะไรเลย
- **FR-6:** coordinator ยังได้ 403 จาก `POST /api/v1/users` (สร้างผู้ใช้ทั่วไป)
- **FR-7 บัญชีเป้าหมาย (ตรวจฝั่ง server):**
  - บัญชีใหม่: ชื่อยังไม่มีใน `_users`
  - บัญชีเดิมต้องผ่านทุกข้อ ไม่อย่างนั้น 403 และไม่เขียนอะไร:
    - `volunteer_id` ตรงกับจิตอาสาคนนี้ และ `personnel_type: volunteer`, `active: true`
    - ไม่ใช่ `system_admin` และไม่มี `shelter_manager` / `volunteer_coordinator` ในศูนย์ใดก็ตาม
    - ไม่ใช่บัญชีของผู้เรียกเอง (ห้ามออกสิทธิ์ให้ตัวเอง)
  - ออกซ้ำให้บัญชีเดิม: เพิ่ม role และ grant หรือตั้ง `expires_at` ใหม่ของ grant เดิม โดยไม่เปลี่ยนรหัสผ่าน ต่ออายุซ้ำได้ไม่จำกัด ทุกครั้งเขียน audit (FR-14)
  - ถ้าบัญชีมี role นั้นจาก SM อยู่แล้ว (ไม่มี grant) ไม่เปลี่ยนอะไร
- **FR-8 ถอนหรือย่นอายุ:** coordinator ถอน (`DELETE /api/v1/volunteer-access`) หรือย่นอายุ (ออกซ้ำด้วยวันที่เร็วกว่า) ได้**เฉพาะ grant ที่ตัวเองออก** (`granted_by` = ผู้เรียก)
  - grant ของ coordinator คนอื่น: ต่ออายุได้ (FR-7, `granted_by` เปลี่ยนเป็นผู้เรียก) แต่ย่นหรือถอนไม่ได้ (403)
  - ถอน grant = ถอด `SHxxx:<role>` ตาม FR-12 ข้อเดียวกับการหมดอายุ
  - role ที่ไม่มี grant (SM ให้) coordinator แตะไม่ได้
  - dialog ออกสิทธิ์ (coordinator) แสดง grant ในศูนย์นี้ของบัญชีที่โปรไฟล์ผูกอยู่ แต่ละรายการมีชื่อ role และวันหมด
    - อ่านผ่าน `GET /api/v1/volunteer-access?shelter_code=&volunteer_id=` ซึ่งหาบัญชีจาก `user_name` ของโปรไฟล์ฝั่ง server และคืนเฉพาะ `{ email, grants: [{ role, expires_at, mine }] }` ไม่คืนเอกสาร `_users`
    - grant ที่ `mine` (ผู้เรียกออกเอง) มีปุ่ม "ถอนสิทธิ์" ต้องกด "ยืนยันถอนสิทธิ์" อีกครั้งจึงเรียก `DELETE`
    - grant ของคนอื่นแสดง "ออกโดยผู้ประสานงานคนอื่น" ไม่มีปุ่มถอน

### FR — SM/SA, การหมดอายุ และการป้องกัน

- **FR-9:** SM/SA ให้ได้ทุก role ไม่มีวันหมดอายุเหมือนเดิม
- **FR-10:** หน้าแก้ไขผู้ใช้แสดงวันหมดอายุของ role ที่มาจาก grant
  - บันทึกฟอร์มโดยคง role ไว้ grant ยังอยู่
  - ตัวเลือก "ไม่มีวันหมด" ลบ grant ของ role นั้น ทำให้ role ถาวร (ส่ง `permanent_roles` ใน `PUT /api/v1/users`; SM ลบได้เฉพาะ grant ของศูนย์ตัวเอง)
  - ถอน role ใน form ลบ grant ของ role นั้นด้วย
- **FR-11 `_users` กันผู้ใช้แก้เอง:** deploy design doc `_users/_design/tent_guard` ที่มี `validate_doc_update` ปฏิเสธ (403 `forbidden`) เมื่อผู้เขียนไม่ใช่ admin และเปลี่ยน field เหล่านี้ในเอกสาร (รวมเอกสารของตัวเอง): `role_grants`, `active`, `personnel_type`, `volunteer_id`
  - การเปลี่ยน `password` และ field อื่นยังเป็นไปตาม `_auth` เดิม
  - BFF และ worker เขียนด้วย admin credential จึงผ่าน
  - deploy พร้อม design doc อื่นของ central (idempotent, เทียบเวอร์ชันก่อน PUT)
- **FR-12 sweep:** worker กวาดทุกรอบ retention (ทุก 5 นาที `RETENTION_INTERVAL_SECONDS = 300`)
  - grant ที่ `expires_at <= now` หรือโปรไฟล์ `verified_by` ไม่เป็น `verified` แล้ว (FR-3): ถอน `SHxxx:<role>` และลบ grant นั้นออก
  - ห้ามแตะ role ที่ไม่มี grant หรือ role ของศูนย์อื่น
  - ถอด `shelter:SHxxx` เมื่อไม่เหลือ role ในศูนย์นั้น
  - บัญชีและรหัสผ่านคงอยู่
  - sweep เป็นขั้นแยกที่มี try/except ของตัวเอง ไม่พึ่ง MongoDB และรันแม้ขั้น Mongo ของ retention ล้ม
  - worker ใช้ admin credential เขียน `_users` (surface ใหม่ของ stable core)
- **FR-13:** session ที่ login อยู่ได้ role ใหม่เมื่อ CouchDB อ่าน `_users` ซ้ำ ช่วงที่ role ยังใช้ได้หลังหมดอายุหรือถูกถอนสูงสุดประมาณ 5 นาที (รอบ sweep)

### FR — audit

- **FR-14:** ทุกการเปลี่ยน grant เขียนเอกสาร `audit` (append-only §2.12) ใน `shelter_{code}` ของศูนย์ที่ grant อยู่
  - `action: other`, `target_type: user`, `target_id: org.couchdb.user:<name>`
  - `reason` เป็นหนึ่งใน `role_grant.issued`, `role_grant.renewed`, `role_grant.shortened`, `role_grant.revoked`, `role_grant.expired`, `role_grant.verification_revoked`, `role_grant.made_permanent`
  - `context`: `{ role, expires_at, previous_expires_at?, actor }`
    - `expires_at`: วันหมดใหม่ สำหรับ `issued`, `renewed`, `shortened`; วันหมดของ grant ที่ถูกลบ สำหรับ `revoked`, `expired`, `verification_revoked`, `made_permanent`
    - `previous_expires_at`: มีเฉพาะ `renewed` และ `shortened`
    - `actor`: ผู้เรียก หรือ `worker` สำหรับ `expired` และ `verification_revoked`
  - SM/SA ถอด role ที่มี grant ในฟอร์มแก้ไขผู้ใช้ (FR-10) เขียน `role_grant.revoked` โดย `actor` = SM/SA
  - เขียนหลังเปลี่ยน `_users` สำเร็จ ถ้าเขียน audit ไม่สำเร็จให้ลองใหม่ แล้ว log error พร้อม field เดียวกัน (การเปลี่ยนสิทธิ์ไม่ย้อนกลับ)

### schema.md §6 `_users` — เพิ่ม field

| Field         | ชนิด                                                                                                                                           | req | หมายเหตุ                                                                                                                                                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role_grants` | [{`shelter_code`:str, `role`:str, `expires_at`:ts, `granted_by`:str, `granted_at`:ts, `verified_by`:{`shelter_code`:str, `volunteer_id`:str}}] | opt | role ที่ `volunteer_coordinator` ออกให้แบบมีวันหมด (draft-coordinator-limited-access-grant) — หนึ่งรายการต่อ (`shelter_code`, `role`); แก้ได้เฉพาะ admin (`_design/tent_guard`); worker ถอน `SHxxx:<role>` เมื่อพ้น `expires_at` หรือ `verified_by` ไม่ verified แล้ว; role ที่ไม่มีรายการในนี้เป็น role ถาวร |

- **FR-15 `duty_window` ใน `_users` (§6):** ยังไม่ได้ทำ ถ้าทำ §4 (role ตามช่วงกะ) ในอนาคตต้องใช้ `role_grants` (เช่นเพิ่ม `starts_at`) ร่วมกัน ไม่สร้าง field ตัดสิทธิ์ชุดที่สอง ให้เพิ่มหมายเหตุนี้ในแถว `duty_window`

### role-permission-matrix

- **decision sync 2026-10-10 (§3):** "การจัดการผู้ใช้ยังเป็น SM/SA เท่านั้น" ต่อท้ายว่า "ยกเว้น coordinator ออกสิทธิ์จิตอาสาแบบจำกัด (draft-coordinator-limited-access-grant)"
- **แถว User Management:** VC จาก `—` เป็น `grant` พร้อมหมายเหตุ "ออกสิทธิ์จิตอาสาแบบจำกัดเท่านั้น สร้าง/แก้ผู้ใช้ทั่วไปไม่ได้"
- **แถว VC:** คงข้อความ "ออกสิทธิ์ระบบให้อาสาช่วยงาน" แล้วต่อท้ายว่า "(จำกัด 4 role, ศูนย์ตัวเอง, ยืนยันตัวตนแล้ว, หมดอายุไม่เกินสิ้นวันที่ +7 — draft-coordinator-limited-access-grant)"
- **§4:** เพิ่มหมายเหตุว่าการออกสิทธิ์โดย coordinator ใช้วันหมดอายุแทนช่วงกะ และ §4 ในอนาคตต้องใช้ `role_grants` (FR-15)

### api-contract

- **authorization ของ `/api/v1/users`:** เพิ่ม `permanent_roles` ใน `PUT` (SM เฉพาะ grant ของศูนย์ตัวเอง)
- **แถวใหม่:** `GET /api/v1/volunteer-access` (grant ของบัญชีที่โปรไฟล์ผูกอยู่), `POST /api/v1/volunteer-access` (ออก / ต่ออายุ / ย่นอายุ) และ `DELETE /api/v1/volunteer-access` (ถอน) — เฉพาะ coordinator ตาม FR-1 ถึง FR-8

## นอกขอบเขต

- **edge fallback:** การถอน role บน edge CouchDB (ระหว่าง WAN ล่ม และ filtered replication ไม่ส่งการถอด `shelter:SHxxx` ลง edge) ติดตามใน #1002 ตอนนี้ยังไม่มีโค้ด replicate `_users` ลง edge
- **role ตามช่วงกะ (§4):** ไม่ทำใน CR นี้ (FR-15)

## Acceptance

- **AC-1:** coordinator ของ SH001 ออก `distribution_staff` ให้จิตอาสาที่ยืนยันตัวตนแล้ว หมด 3 วัน ได้ role `shelter:SH001` + `SH001:distribution_staff`, `role_grants` 1 รายการ และ `audit` `role_grant.issued` 1 ฉบับใน `shelter_sh001`
- **AC-2:** ยิง BFF ตรงๆ ได้ 4xx และ `_users` ไม่เปลี่ยน ในกรณี:
  - role นอก 4 ตัว, ศูนย์อื่น (รวม `shelter_code` ใน body ไม่ตรงกับ scope ของผู้เรียก), ไม่ระบุวันหมด, วันหมดเกิน +7
  - จิตอาสายังไม่ยืนยันตัวตน
  - บัญชีเป้าหมายไม่ผ่าน FR-7 (`volunteer_id` ไม่ตรง, บัญชี SM/SA/coordinator, บัญชีของผู้เรียกเอง)
- **AC-3:** จิตอาสาที่ยืนยันตัวตนที่ศูนย์อื่นออกสิทธิ์ได้เมื่อ `phone_hash` และ `national_id_hash` ตรงกัน ถ้าตรงแค่ `phone_hash` ได้ 422
- **AC-4:** พ้น `expires_at` แล้ว sweep ถอนเฉพาะ role นั้น role ที่ SM ให้ยังอยู่ บัญชียังอยู่ มี audit `role_grant.expired` และออกสิทธิ์ใหม่ได้โดยไม่ต้องตั้งรหัส
- **AC-5:** SM เห็นวันหมดในหน้าแก้ไขผู้ใช้ บันทึกแล้ว grant ยังอยู่ และเลือก "ไม่มีวันหมด" แล้ว grant หายพร้อม audit `role_grant.made_permanent`
- **AC-6:** coordinator ถอนและย่นอายุ grant ที่ตัวเองออกได้ ส่วน grant ของ coordinator คนอื่นและ role ที่ SM ให้ได้ 403
- **AC-7:** user ที่มี grant `PUT /couch/_users/org.couchdb.user:<self>` โดยลบหรือแก้ `role_grants` (หรือแก้ `active`, `personnel_type`, `volunteer_id`) ได้ 403 และ sweep ยังถอน role ได้ตามเวลา เปลี่ยนรหัสผ่านตัวเองยังทำได้
- **AC-8:** เปลี่ยน `identity_verification.status` ของโปรไฟล์ `verified_by` เป็น `rejected` แล้วรอบ sweep ถัดไปถอน grant พร้อม audit `role_grant.verification_revoked`
- **AC-9:** ขั้น Mongo ของ retention ล้ม sweep ยังทำงาน
- **AC-10:** coordinator เปิด dialog ของจิตอาสาที่มีบัญชีแล้วเห็น grant ในศูนย์นี้ กด "ถอนสิทธิ์" แล้ว "ยืนยันถอนสิทธิ์" ที่ grant ของตัวเองแล้ว role หาย บัญชียังอยู่ และมี audit `role_grant.revoked` ส่วน grant ของคนอื่นไม่มีปุ่มถอน

## Impact

- **auth (stable core):**
  - ขยายสิทธิ์สร้างและแก้บัญชีจาก SM/SA ให้ coordinator ในขอบเขต FR-1 ถึง FR-8
  - เพิ่ม `validate_doc_update` ใน `_users` (FR-11) และ worker เขียน `_users` ด้วย admin credential
  - ไม่เปลี่ยน `_session`, การ login หรือรูปแบบ role (ยังเป็น compound ตาม CR-093)
- **ข้ามศูนย์:** เงื่อนไข `national_id_hash` (FR-3 ข) เข้มกว่าทาง D ของ #886 ที่ใช้ `phone_hash` อย่างเดียว ใช้เฉพาะการออกสิทธิ์ ส่วนการใช้ผลยืนยันข้ามศูนย์อื่น ๆ เป็นไปตาม #886
- **test:**
  - unit test ของ policy, BFF (ออก / ต่ออายุ / ย่น / ถอน / บัญชีเป้าหมาย), form และ worker sweep (หมดอายุ, ยกเลิกยืนยันตัวตน, Mongo ล้ม)
  - test ของ `validate_doc_update` (AC-7)
  - e2e `volunteer-access-roles.test.ts` (#841) เปลี่ยน `test.fixme` ของ coordinator เป็นทดสอบจริง

## Migration

ไม่มี `role_grants` เป็น field เสริม บัญชีเดิมไม่มี field นี้ จึงมี role ถาวรทั้งหมดเหมือนเดิม `_design/tent_guard` เป็นเอกสารใหม่ใน `_users` deploy ครั้งแรกพร้อม design doc อื่นของ central

## Decision log

- 2026-10-25 — ผู้รับงานถามใน #841 และ #879 เรื่องคำอธิบาย role ไม่ตรงสิทธิ์จริง
- 2026-10-27 — @net-lynx ตอบ #879 ข้อ 2: ทาง A แบบจำกัดสิทธิ์
- 2026-10-27 — ผู้รับงานตัดสินรายละเอียด:
  - วันหมดอายุบังคับเลือก ไม่มีค่าเริ่มต้น
  - SM บันทึกฟอร์มแล้ว grant คงอยู่ และมีตัวเลือก "ไม่มีวันหมด"
  - เก็บใน `_users.role_grants`
  - ~~coordinator ถอนเองไม่ได้~~ → เปลี่ยนตาม D2
  - ~~ยืนยันตัวตนนับผลข้ามศูนย์ตาม #886~~ → เปลี่ยนตาม D5
- 2026-10-27 — proposed ใน PR #1000 (#955)
- 2026-10-28 — Soravit Sukkarn (Team Lead) ตัดสินใน review PR #1000:
  - D1 คง `_users.role_grants` และเพิ่ม `validate_doc_update` กันผู้ใช้แก้เอง (FR-11, AC-7)
  - D2 coordinator ถอนหรือย่นอายุได้เฉพาะ grant ที่ตัวเองออก (FR-8, AC-6)
  - D3 audit ใน `shelter_{code}` (FR-14)
  - D4 ยกเลิกผลยืนยันตัวตนแล้ว sweep ถอน grant ทันที (FR-3, FR-12, AC-8)
  - D5 ข้ามศูนย์เพื่อออกสิทธิ์ได้เฉพาะเมื่อ `national_id_hash` ตรงด้วย (FR-3, AC-3) — แจ้ง @net-lynx ใน #886 แล้ว
  - D6 `duty_window` ใน `_users` ยังไม่ทำ §4 อนาคตใช้ `role_grants` (FR-15)
  - D7 edge fallback ไม่อยู่ในขอบเขต ติดตามใน #1002
  - D8 รองรับ legacy flat role ผ่าน `capabilitiesForShelter` (FR-1)
- 2026-10-29 — ผู้รับงานเพิ่มระหว่าง implement:
  - ปุ่มถอนสิทธิ์ใน dialog และ `GET /api/v1/volunteer-access` (FR-8, AC-10)
  - ความหมายของ `context.expires_at` และ audit เมื่อ SM/SA ถอด role ในฟอร์ม (FR-14)
