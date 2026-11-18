---
id: CR-258
title: Audit log กลาง (เฟส A+B) — ผู้สร้าง/ผู้แก้ศูนย์ + DB `audit_log` + หน้า Audit Log
status: approved
date: 2026-11-17
requested_by: Jackyzaz — GitHub EPIC #1357 และ sub-issue #1356
decided_by: Soravit Sukkarn (Team Lead)
layer: stable + volatile
affects:
  - docs/data/schema.md §3.1 `shelter` (เขียน `created_by` จริงตาม envelope §0 · เพิ่ม `updated_by`) · ไม่ bump shelter schema_v (คง 11)
  - docs/data/schema.md §11 ใหม่ — DB `audit_log` · doc `audit_event` schema_v 1
  - docs/data/schema.md §7 / §8 (index และ `validate_doc_update` ของ `audit_log`)
  - docs/prd/role-permission-matrix.md §3 (สิทธิ์ "ดู audit log")
  - frontend/src/lib/features/shelters/domain/schema.ts (`ShelterMaster` + `created_by` / `updated_by`)
  - frontend/src/lib/server/shelters.admin.ts (`updateMaster` รับ actor) · frontend/src/lib/features/shelters/server/provisioner.ts (`provisionShelter` รับ actor)
  - frontend/src/routes/api/back-office/shelter/** (POST, GET list, GET/PATCH `[code]`, close, zones, zones/reopen, storage-points) · frontend/src/lib/server/storage-points.ts
  - frontend/src/routes/api/internal/shelter-import/worker/next/+server.ts
  - frontend/src/routes/api/v1/users/** · frontend/src/lib/server/user-service.ts
  - frontend/src/routes/api/back-office/master-data/**
  - frontend/src/routes/api/v1/api-keys/** · frontend/src/routes/api/v1/thirdparty-clients/**
  - frontend/src/lib/server/audit-log.ts (ใหม่ — `recordAudit`, ตัวคำนวณ `changes`, allowlist ต่อ entity type)
  - frontend/src/routes/api/back-office/audit-log/+server.ts (ใหม่ — API อ่าน)
  - frontend/src/lib/features/audit-log/ (ใหม่ — domain / data / application / ui ตาม layer)
  - frontend/src/routes/(protected)/back-office/audit-log/ (ใหม่) · เมนู back-office
  - frontend/src/lib/features/shelters/ui (shelter-form-page.svelte บรรทัดผู้สร้าง/ผู้แก้ + แถบประวัติ)
  - frontend/src/lib/features/users/ui (user-edit-page.svelte แถบประวัติ)
  - frontend/scripts/sync-central-db.ts (สร้าง `audit_log` + `_security` + `_design`) · frontend/scripts/seed/registry-shelters.ts · frontend/scripts/seed-mock-search.ts
  - worker/src/worker (คัดลอก doc `audit` จาก `shelter_{code}` → `audit_log`) · worker/tests
  - tests: provisioner / `updateMaster` / route tests ของทุก route ใน FR-24 · audit-log.ts · API อ่าน · หน้า audit-log (dom) · worker copy
why: >
  ระบบไม่รู้ว่าใครสร้างหรือแก้ข้อมูลสำคัญ (ศูนย์ ผู้ใช้ master data API key) และไม่มีหน้ารวมให้ตรวจย้อนหลัง
  doc `shelter` ไม่มี `created_by` ทั้งที่ envelope §0 กำหนดไว้ · doc `audit` ที่มีอยู่ (§2.12) กระจายอยู่ในแต่ละศูนย์และไม่มีหน้าแสดง
migration: >
  additive ทั้งหมด — ไม่มี batch script แก้ doc เดิม · shelter เดิมที่ไม่มี `created_by` / `updated_by` อ่านเป็น `null` (ไม่ backfill)
  · `audit_log` เป็น DB ใหม่ สร้างด้วย `pnpm sync:central` · worker คัดลอก doc `audit` ที่มีอยู่ทั้งหมดตอน bootstrap (idempotent ด้วย `_id`)
  · ไม่มี event ย้อนหลังของการ CRUD ก่อน deploy
---

# CR-258 — Audit log กลาง (เฟส A+B)

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** (A) doc `shelter` เก็บ `created_by` / `updated_by` · (B) DB กลางใหม่ `audit_log` เก็บ event "ใคร / เมื่อไร / ทำอะไร / เปลี่ยนอะไร" ของทุกการเขียนที่ผ่าน BFF + สำเนาของ doc `audit` เดิมจากทุกศูนย์
> - **เพื่อใคร:** SA ตรวจย้อนหลังได้ทุกศูนย์ · ผู้จัดการศูนย์ (SM) ตรวจได้เฉพาะศูนย์ตัวเอง (#1356, #1357)
> - **build:** ประทับผู้กระทำใน doc ศูนย์ · `recordAudit()` ฝั่ง server เรียกจาก BFF route ที่เขียนข้อมูล · worker คัดลอก doc `audit` · API อ่าน + หน้า `/back-office/audit-log` + แถบ "ประวัติ" ในหน้าศูนย์และหน้าผู้ใช้
> - **กระทบ:** schema.md §3.1 (additive ไม่ bump) + §11 ใหม่ · permission matrix เพิ่มสิทธิ์ดู log · stable core: DB ใหม่และเส้นทางเขียนใหม่ (ต้อง review) · ไม่แตะ envelope, VDU ของ `shelter_{code}`, FastAPI, public plane

> **นอกขอบเขต (เฟส C — CR/ADR แยก):** log ของข้อมูลที่ browser เขียนตรงเข้า CouchDB (catalog, ผู้อพยพ, ครัวเรือน, สต็อก ฯลฯ) · `updated_by` ใน envelope + VDU · worker หาความต่างจาก `_changes`

---

## Requirements — เฟส A: ผู้สร้างและผู้แก้ศูนย์ (#1356)

**ข้อมูล (CouchDB `registry` → `shelter`)**

- FR-1 — `shelter.created_by`: str · `_users` name ของผู้สร้าง · เขียนครั้งเดียวตอนสร้าง · ห้ามเปลี่ยนหลังสร้าง
- FR-2 — `shelter.updated_by`: str · `_users` name ของผู้เขียนครั้งล่าสุด · ตอนสร้างมีค่าเท่ากับ `created_by`
- FR-3 — actor แยกตามช่องทาง:

  | ช่องทาง | actor |
  | --- | --- |
  | หน้าเว็บ (`POST` / `PATCH` / close / zones / storage-points) | `name` ของ caller จาก cookie `_session` (ค่าที่ guard คืน) |
  | import Excel (async worker) | `imported_by` ของ `shelter_import_job` (§3.8) ทั้งศูนย์ที่สร้างใหม่และศูนย์ที่ import ทับ |
  | seed script | `system:seed` |

- FR-4 — server ไม่รับ `created_by` / `updated_by` จาก request body · ค่าที่ client ส่งมาถูกทิ้ง ไม่ error
- FR-5 — doc เดิมที่ไม่มี key อ่านเป็น `null` ทั้งสอง field · ไม่ backfill · ไม่เติม `created_by` ย้อนหลังตอนแก้ไข

**ฝั่ง server**

- FR-6 — `updateMaster(code, actor, mutator)` รับ `actor` เป็นพารามิเตอร์บังคับ · ทุกการเขียนประทับ `updated_by = actor` และ `updated_at = nowIso()` เอง · `updated_by` / `created_by` ใน `patch` ของ mutator ถูกเขียนทับ (`created_by` คงค่าเดิมของ doc)
- FR-7 — `provisionShelter` รับ `actor` เป็นพารามิเตอร์บังคับ · doc ที่สร้างมี `created_by = updated_by = actor`
- FR-8 — ชนิดของ `actor` เป็น `string` ไม่ optional · ทุก caller ส่งค่าตาม FR-3

**API (BFF)**

- FR-9 — `GET /api/back-office/shelter/{code}` คืนเพิ่ม `created_by`, `updated_by` (`string | null`) และ `created_by_name`, `updated_by_name` (`string | null`) · `*_name` = `display_name` จาก `getDisplayNames` · ไม่มี `display_name` หรือไม่พบผู้ใช้ → คืน username · field ต้นทางเป็น `null` → `*_name` เป็น `null`
- FR-10 — `GET /api/back-office/shelter` (รายการ) ไม่เปลี่ยน · ไม่คืนผู้สร้าง/ผู้แก้ (Q1 = ไม่มีคอลัมน์ในหน้ารายการ)
- FR-11 — สิทธิ์อ่านของแต่ละ route เท่าเดิม

**หน้าเว็บ**

- FR-12 — หน้า `/back-office/shelters/edit/{code}` แสดงบรรทัดใต้หัวข้อ: `สร้างโดย {created_by_name} · {created_at} · แก้ไขล่าสุดโดย {updated_by_name} · {updated_at}` · วันเวลาแบบไทย (พ.ศ. ย่อ เช่น `12 พ.ย. 69 14:30`)
- FR-13 — `created_by` เป็น `null` → "ไม่ทราบ (สร้างก่อนมีการบันทึก)" · `updated_by` เป็น `null` → "ไม่ทราบ" · เวลายังแสดงถ้ามีค่า
- FR-14 — โหมดสร้างไม่แสดงบรรทัดนี้ · หลังบันทึกสำเร็จบรรทัดนี้อัปเดตหลัง refetch โดยไม่ต้องโหลดหน้าใหม่
- FR-15 — หน้ารายการศูนย์ (`/back-office/shelters`) ไม่เปลี่ยน · ไม่มีคอลัมน์ "สร้างโดย" (Q1)

**ขอบเขต**

- FR-16 — ไม่แก้ `validate_doc_update` ของ `registry` · `REGISTRY_DESIGN_VERSION` คงเดิม
- FR-17 — worker คัดลอก doc ศูนย์ทั้งก้อนไป `public_shelters.raw_data` อยู่แล้ว · FastAPI (public และ external) ต้องไม่คืน `created_by` / `updated_by` · ไม่เพิ่ม field ใน projection · ไม่ bump `PROJECTION_VERSION`

---

## Requirements — เฟส B: `audit_log` และหน้า Audit Log (#1357)

**DB `audit_log`**

- FR-18 — DB กลางใหม่ชื่อ `audit_log` อยู่บน central CouchDB เท่านั้น · ไม่ replicate ไป device หรือ edge · ไม่สร้าง `audit_log` บน edge · ระหว่างโหมด edge (central ล่ม) `recordAudit` ล้มเหลวตาม FR-23 (ข้อมูลหลักสำเร็จ · log error) และการเขียนช่วงนั้นไม่มี event ใน `audit_log` (Q2)
- FR-19 — `_security` ของ `audit_log` ไม่มี member role ใดนอกจาก `_admin` · browser อ่านหรือเขียนตรงผ่าน `/couch` ไม่ได้ (ตอบ 401/403)
- FR-20 — `validate_doc_update` ของ `audit_log`: รับเฉพาะ `type = audit_event` · มี `oldDoc` (แก้ไข) หรือ `_deleted` → reject · field บังคับตาม §Change ไม่ครบ → reject
- FR-21 — `pnpm sync:central` สร้าง `audit_log`, ตั้ง `_security` และ deploy `_design` (VDU + index) · รันซ้ำได้ผลเดิม
- FR-22 — เก็บถาวร ไม่มี TTL ไม่มี job ลบ (คำตอบ Q5 ของ #1357)

**การเขียน — `recordAudit()` ฝั่ง server**

- FR-23 — `recordAudit(event)` ใน `$lib/server/audit-log.ts` (server-only) · เรียก **หลัง** การเขียนข้อมูลหลักสำเร็จ · สร้าง `_id = audit_event:{ulid}` ครั้งเดียวแล้วใช้ `_id` เดิมทุกครั้งที่ลองใหม่ (ลองได้ 3 ครั้ง · 409 = บันทึกแล้ว) · ล้มเหลวทั้ง 3 ครั้ง → log error พร้อม event ทั้งก้อน และ **ไม่** ทำให้ request หลักล้มเหลว หรือ rollback ข้อมูลหลัก (แบบเดียวกับ `recordRoleGrantAudit`)
- FR-24 — ทุก handler ที่เขียนข้อมูล (POST / PUT / PATCH / DELETE) ใน route ต่อไปนี้ต้องเรียก `recordAudit` หนึ่งครั้งต่อหนึ่ง entity ที่เปลี่ยน:

  | entity_type | route | event (ตัวอย่าง) |
  | --- | --- | --- |
  | `shelter` | `api/back-office/shelter` (POST) · `[code]` (PATCH) · `[code]/close` · `[code]/zones/[zoneCode]` · `.../reopen` · `[code]/storage-points/**` · `api/internal/shelter-import/worker/next` | `shelter.created` · `shelter.updated` · `shelter.closed` · `shelter.zone_closed` · `shelter.zone_reopened` · `shelter.storage_point_changed` · `shelter.imported` |
  | `user` | `api/v1/users/**` | `user.created` · `user.updated` · `user.roles_changed` · `user.deleted` · `user.password_reset` |
  | `master_data` | `api/back-office/master-data/**` | `master_data.updated` |
  | `api_key` | `api/v1/api-keys/**` | `api_key.created` · `api_key.updated` · `api_key.revoked` |
  | `thirdparty_client` | `api/v1/thirdparty-clients/**` | `thirdparty_client.created` · `thirdparty_client.updated` · `thirdparty_client.deleted` |

- FR-25 — `event` ตั้งชื่อแบบ `{entity_type}.{verb}` (snake_case) · ชุดค่าที่ใช้จริงบันทึกเป็น const ใน `audit-log.ts` จุดเดียว
- FR-26 — การให้/ถอนสิทธิ์ชั่วคราว (role grant) **ไม่** เรียก `recordAudit` ซ้ำ · event ของ role grant มาจากการคัดลอก doc `audit` (FR-31) เพื่อไม่ให้ซ้ำสองแถว
- FR-27 — `actor` = `{ name, kind }` · `kind = user` เมื่อมาจาก session · `kind = system` สำหรับ seed / script · import ใช้ `imported_by` (`kind = user`)
- FR-28 — `shelter_code` ของ event: entity ที่เป็นศูนย์ = `code` ของศูนย์ · ผู้ใช้ = รหัสศูนย์จาก role ที่เปลี่ยน (ถ้าเปลี่ยนหลายศูนย์ → หนึ่ง event ต่อศูนย์) หรือ `null` ถ้าไม่เกี่ยวกับศูนย์ · master data ระดับศูนย์ = รหัสศูนย์ · ระดับ global, API key, third-party client = `null`

**ความต่าง (`changes`) และข้อมูลส่วนบุคคล**

- FR-29 — `changes` = รายการ field ระดับบนสุดที่ค่าต่างกันระหว่าง doc ก่อนและหลังเขียน · `action = create` / `delete` ไม่เก็บ `changes`
- FR-30 — เก็บ `from` / `to` เฉพาะเมื่อ (1) field อยู่ใน value allowlist ของ entity type นั้น **และ** (2) ค่าเป็น string / number / boolean / `null` หรือ array ของ string · นอกนั้นเก็บแค่ `field` · ไม่อยู่ใน allowlist = ไม่เก็บค่าเสมอ (default ปิด) · ห้ามเก็บรหัสผ่าน, token, secret ของ API key, เลขบัตร, เบอร์โทร, อีเมล, ข้อมูลการแพทย์ ไม่ว่ากรณีใด

  | entity_type | value allowlist (ตั้งต้น) |
  | --- | --- |
  | `shelter` | `name`, `operation_status`, `capacity`, `site_kind`, `shelter_type`, `project_level`, `area_m2`, `area_type`, `floor_count`, `province`, `district`, `subdistrict` |
  | `user` | `roles`, `display_name`, `active` |
  | `master_data` | — (field เท่านั้น) |
  | `api_key` | `name`, `scopes`, `status`, `expires_at` |
  | `thirdparty_client` | `name`, `status`, `allowed_scopes` |

**การคัดลอก doc `audit` เดิม (worker)**

- FR-31 — worker ที่ tail `shelter_{code}` อยู่แล้ว เมื่อเห็น doc `type = audit` ให้เขียน `audit_event` ลง `audit_log` · `_id = audit_event:{ULID เดียวกับ doc ต้นทาง}` (คัดลอกซ้ำได้ผลเดิม · 409 = มีแล้ว)
- FR-32 — การแปลงค่า: `event = audit.{action}` (เมื่อ `action = other` ใช้ `reason` เช่น `role_grant.issued`, `donor_contact_view`) · `action` = `other` · `entity` = `{ type: target_type, id: target_id, label: null }` · `actor.name` = `created_by` ของต้นทาง (`kind = worker` เมื่อเป็น `worker`) · `reason` คัดลอก · `context` ของต้นทาง **ไม่** คัดลอก · `source = worker_copy` · `source_ref` = `_id` ต้นทาง
- FR-33 — worker bootstrap (`--bootstrap`) คัดลอก doc `audit` ที่มีอยู่ทั้งหมดของศูนย์ที่ tail อยู่ · ศูนย์ที่ worker ไม่ tail (External, ศูนย์ปิดที่พ้น retention) ไม่ถูกคัดลอก

**API อ่าน**

- FR-34 — `GET /api/back-office/audit-log` · query: `shelter_code`, `entity_type`, `entity_id`, `actor`, `action`, `from`, `to` (ISO), `cursor`, `limit` (default 50, สูงสุด 200) · เรียงใหม่ → เก่า · คืน `{ items, next_cursor }`
- FR-35 — สิทธิ์: SA เห็นทุก event รวม `shelter_code = null` · SM เห็นเฉพาะ event ที่ `shelter_code` เป็นศูนย์ที่ตนถือ role `shelter_manager` · SM ไม่ส่ง `shelter_code` → ใช้ศูนย์ปัจจุบันของตน · SM ขอศูนย์ที่ไม่ได้ถือ → 403 · role อื่น → 403 (คำตอบ Q1 ของ #1357)
- FR-36 — แต่ละ item มี `actor.display_name` จาก `getDisplayNames` (fallback username) · เรียกครั้งเดียวต่อ request
- FR-37 — `_design` ของ `audit_log` มี index รองรับ 4 รูปแบบ เรียงตาม `occurred_at`: ทั้งหมด · ตาม `shelter_code` · ตาม `entity.type` + `entity.id` · ตาม `actor.name` · filter อื่นกรองต่อจากผลของ index

**หน้าเว็บ**

- FR-38 — หน้าใหม่ `/back-office/audit-log` เข้าได้เฉพาะ SA และ SM (route guard) · มีเมนูใน back-office เฉพาะสองบทบาทนี้
- FR-39 — ตาราง: เวลา · ผู้ทำ (ชื่อจริง) · การกระทำ · ประเภท + ชื่อรายการ · ศูนย์ · ปุ่มดูรายละเอียดที่แสดง `changes` (`from → to` หรือ "มีการแก้ไข" เมื่อไม่มีค่า) และ `reason`
- FR-40 — ตัวกรอง: ประเภทข้อมูล · การกระทำ · ผู้ทำ · ช่วงวันที่ · ศูนย์ (เฉพาะ SA) · ตัวกรองอยู่ใน URL (reload แล้วยังอยู่)
- FR-41 — แบ่งหน้าด้วยปุ่ม "โหลดเพิ่ม" ตาม `next_cursor` · ไม่มีผล → "ไม่พบรายการ" · โหลดไม่สำเร็จ → toast error
- FR-42 — component แถบ "ประวัติการแก้ไข" ใช้ API เดียวกันด้วย `entity_type` + `entity_id` · ใส่ในหน้า `/back-office/shelters/edit/{code}` และหน้าแก้ไขผู้ใช้ `/back-office/users/{name}` · แสดงตามสิทธิ์ FR-35
- FR-43 — feature ใหม่ `lib/features/audit-log/` แบ่ง layer domain / data / application / ui · หน้าและ feature อื่นใช้ผ่าน barrel เท่านั้น

**สิทธิ์**

- FR-44 — `role-permission-matrix.md` §3 เพิ่มแถว "ดู audit log": SA ✓ ทุกศูนย์ · SM ✓ ศูนย์ของตน · role อื่น ✗

---

## Change (before → after)

**schema.md §3.1 `shelter`**

| field | before | after |
| --- | --- | --- |
| `created_by` | กำหนดใน envelope §0 แต่ไม่ถูกเขียน | str · `_users` name ผู้สร้าง · immutable · doc เดิมไม่มี key (อ่านเป็น `null`) |
| `updated_by` | ไม่มี | str · `_users` name ผู้เขียนล่าสุด · doc เดิมไม่มี key (อ่านเป็น `null`) |
| `schema_v` | 11 | 11 (ไม่ bump — additive) |

**schema.md §11 ใหม่ — DB `audit_log` (central เท่านั้น) · `audit_event:{ulid}` · append-only · schema_v 1**

| field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `_id` | str | sys | `audit_event:{ulid}` · สำเนาจาก doc `audit` ใช้ ULID ของต้นทาง |
| `type` | `audit_event` | req | — |
| `schema_v` | 1 | req | — |
| `occurred_at` | ts | req | เวลาที่เกิดการเปลี่ยน (สำเนา = `occurred_at` ของต้นทาง) |
| `created_at` / `updated_at` | ts | req | เวลาที่เขียน event · เท่ากันเสมอ (append-only) |
| `created_by` | str | req | = `actor.name` |
| `actor` | {`name`:str, `kind`:enum(`user`,`system`,`worker`)} | req | — |
| `action` | enum(`create`,`update`,`delete`,`status_change`,`other`) | req | หมวดสำหรับกรอง |
| `event` | str | req | `{entity_type}.{verb}` หรือ `audit.{action}` / `reason` สำหรับสำเนา |
| `entity` | {`type`:str, `id`:str, `label`:str\|null} | req | `label` = ชื่อที่อ่านได้ ณ เวลาเกิด (เช่น ชื่อศูนย์) |
| `shelter_code` | str\|null | req | ตาม FR-28 |
| `changes` | [{`field`:str, `from`?:any, `to`?:any}] | opt | ตาม FR-29/FR-30 |
| `reason` | str\|null | opt | — |
| `source` | enum(`bff`,`worker_copy`) | req | — |
| `source_ref` | str\|null | opt | `_id` ของ doc `audit` ต้นทาง |

**BFF response** — `GET /api/back-office/shelter/{code}` เพิ่ม `created_by`, `updated_by`, `created_by_name`, `updated_by_name` · `GET /api/back-office/shelter` (รายการ) ไม่เปลี่ยน · API ใหม่ `GET /api/back-office/audit-log`

**role-permission-matrix.md §3** — แถวใหม่ "ดู audit log" ตาม FR-44

---

## Acceptance

**เฟส A**

- [ ] SA สร้างศูนย์จากหน้าเว็บ → doc มี `created_by` = `updated_by` = username ของ SA คนนั้น
- [ ] import Excel สร้างศูนย์ใหม่ → `created_by` = `imported_by` · import ทับศูนย์เดิม → `updated_by` = `imported_by` และ `created_by` เดิมไม่เปลี่ยน
- [ ] SM แก้ข้อมูล / ปิดศูนย์ / ปิด-เปิดโซน / แก้จุดเก็บของ → `updated_by` = SM คนนั้น · `created_by` ไม่เปลี่ยน
- [ ] ส่ง `created_by` / `updated_by` ปลอมใน body → doc เก็บค่าจาก session
- [ ] หน้าแก้ไขศูนย์แสดงชื่อจริง · ไม่มี `display_name` แสดง username · ศูนย์เก่าแสดง "ไม่ทราบ (สร้างก่อนมีการบันทึก)" และหน้าไม่ error
- [ ] response ของ FastAPI `/public/v1/shelters*` และ `/external/v1/shelters*` ไม่มี `created_by` / `updated_by`

**เฟส B**

- [ ] ทุก handler ใน FR-24 เขียน `audit_event` หนึ่งแถวต่อการเปลี่ยนหนึ่งครั้ง (มี route test ยืนยันทุก handler)
- [ ] แก้ `capacity` ของศูนย์จาก 120 เป็น 150 → event มี `changes: [{ field: 'capacity', from: 120, to: 150 }]`
- [ ] แก้ `contact` ของศูนย์ → event มี `{ field: 'contact' }` ไม่มี `from` / `to`
- [ ] เขียน `audit_log` ไม่สำเร็จ → request หลักยังสำเร็จ ข้อมูลหลักถูกบันทึก และมี error log ของ event
- [ ] ผู้ใช้ทั่วไปเรียก `/couch/audit_log/_all_docs` → ถูกปฏิเสธ · แก้หรือลบ `audit_event` ด้วย admin → VDU reject
- [ ] doc `audit` (เช่น `duplicate_override`, `role_grant.issued`) ที่เกิดหลัง deploy ปรากฏใน `audit_log` · bootstrap ซ้ำไม่เกิดแถวซ้ำ · role grant หนึ่งครั้ง = หนึ่งแถว
- [ ] SM เปิด `/back-office/audit-log` เห็นเฉพาะศูนย์ตัวเอง · ขอศูนย์อื่นผ่าน API → 403 · role อื่นเข้าหน้าไม่ได้และ API ตอบ 403
- [ ] กรองตามประเภท / การกระทำ / ผู้ทำ / ช่วงวันที่ แล้วผลตรง · reload แล้วตัวกรองยังอยู่ · "โหลดเพิ่ม" ไม่ซ้ำและไม่ข้ามแถว
- [ ] แถบ "ประวัติการแก้ไข" ในหน้าศูนย์และหน้าผู้ใช้แสดงเฉพาะ event ของรายการนั้น

---

## Resolved questions

- **Q1 — หน้ารายการศูนย์ต้องมีคอลัมน์ "สร้างโดย" ไหม** → ไม่ต้อง · แสดงเฉพาะหน้าแก้ไขศูนย์ (FR-10, FR-15)
- **Q2 — ระหว่างทำงานโหมด edge (central ล่ม)** → ไม่สร้าง `audit_log` บน edge · `recordAudit` ล้มเหลวแบบไม่กระทบข้อมูลหลัก · ยอมรับว่าการเขียนช่วง edge ไม่มี event (FR-18)
- **Q3 — catalog** → Q2 ของ #1357 วาง master data / catalog เป็นลำดับที่ 3 แต่ catalog ถูก browser เขียนตรงเข้า DB `catalog` ไม่ผ่าน BFF จึงย้ายไปเฟส C · master data อยู่ในเฟส B (ผ่าน BFF)

---

## Why

- doc `shelter` ไม่มี `created_by` ทั้งที่ envelope §0 กำหนดไว้ เพราะ provisioner เขียนเฉพาะ `created_at` / `updated_at`
- ศูนย์ ผู้ใช้ master data API key และ third-party client ถูกเขียนผ่าน BFF ด้วย admin credentials ทั้งหมด จึงรู้ผู้กระทำจาก session ได้แน่นอนและบันทึกที่ server ได้โดยไม่ต้องพึ่ง browser
- ประทับผู้กระทำที่จุดเดียว (`updateMaster` / `provisionShelter` / `recordAudit`) ทำให้ caller ใหม่ลืมใส่ไม่ได้
- DB กลางเดียว + อ่านผ่าน BFF: หน้าจอ query ได้ที่เดียวและกรองสิทธิ์ที่ server · ไม่ใช้ MongoDB เพราะ staff plane อ่านจาก CouchDB การให้ staff อ่าน Mongo เป็นเส้นทางข้าม plane ใหม่
- เก็บ `_users` name ใน doc (ไม่เก็บชื่อจริง) เพราะชื่อจริงเปลี่ยนได้ · แปลงเป็น `display_name` ตอนอ่าน
- allowlist แบบ default ปิด: field ใหม่ที่เพิ่มภายหลังจะไม่ถูกเก็บค่าโดยไม่ตั้งใจ (spec audit/privacy: ห้ามเก็บข้อมูลการแพทย์หรือเลขบัตรดิบใน log)
- แยกเฟส C ออก เพราะต้องเพิ่ม `updated_by` ใน envelope ของทุก doc และแก้ VDU ของ `shelter_{code}` ซึ่งเป็น stable core ต้อง review และทำ ADR ก่อน

## Decision log

- 2026-11-15 — คำถาม design ของ #1356/#1357 โพสต์ใน #1357
- 2026-11-17 — Jackyzaz ตอบ "ตามแนะนำ" ทุกข้อ: SA เห็นทุกศูนย์ / SM เห็นศูนย์ตัวเอง · ลำดับ ศูนย์ → ผู้ใช้และสิทธิ์ → master data / catalog → ผู้อพยพและครัวเรือน · ใคร/เมื่อไร/ทำอะไร + ค่าเดิม→ค่าใหม่เฉพาะ field ที่ไม่ใช่ข้อมูลส่วนบุคคล · แสดงชื่อจริง fallback username · เก็บถาวร
- 2026-11-17 — รวมเฟส A (#1356) และเฟส B (#1357) เป็น CR ใบเดียว · เฟส C แยกเป็น CR/ADR ภายหลัง
- 2026-11-17 — proposed
- 2026-11-17 — Q1 = ไม่มีคอลัมน์ในหน้ารายการศูนย์ · Q2 = ตามข้อเสนอ (ไม่มี `audit_log` บน edge)
- 2026-11-17 — approved โดย Soravit Sukkarn (Team Lead) · รันเลข CR-258
- 2026-11-18 — แก้ allowlist ของ `user` จาก `disabled` เป็น `active` ให้ตรงกับ field จริงใน `_users` (ความหมายเดิม: สถานะเปิด/ปิดบัญชี)
