---
id: CR-260
title: Audit log เฟส C — `updated_by` ใน envelope + worker สร้าง audit event จากการเปลี่ยนแปลงของ `shelter_{code}` และ `catalog`
status: approved
date: 2026-11-18
requested_by: Jackyzaz — GitHub EPIC #1357 (เฟส C ต่อจาก CR-259)
decided_by: PM (approved 2026-11-18 · Open questions ตามข้อเสนอ)
layer: stable + volatile
related:
  - docs/changes/01-core/CR-259-audit-log.md (เฟส A+B — DB `audit_log`, `audit_event`, API อ่าน, หน้า Audit Log, PR #1453 / #1454)
  - docs/changes/01-core/CR-247-edge-per-shelter-repl-user.md (role `repl:<CODE>` ผ่าน VDU แบบเดียวกับ `_admin`)
  - docs/features/audit-privacy-rbac-flow-spec.html (ห้ามเก็บข้อมูลการแพทย์ / เลขบัตรดิบใน log)
affects:
  - docs/data/schema.md §0 (envelope เพิ่ม `updated_by`) · ไม่ bump `schema_v` ของ doc type ใด (additive)
  - docs/data/schema.md §8 (กฎ VDU ใหม่ — `updated_by` ต้องตรงผู้เขียน)
  - docs/data/schema.md §11 (`audit_event`: `_id` แบบ deterministic ของ worker, `source` + `worker_diff`, `actor.kind` + `unknown`, `changes_unknown`, entity type ใหม่, allowlist ของ type ใหม่)
  - frontend/src/lib/db/couch-db.ts (`putDoc`, `putDocStrict`, `bulkDocs`, `bulkDocsDetailed` ประทับ `updated_by` · `deleteDoc` เปลี่ยนจาก HTTP `DELETE` เป็น `PUT` tombstone)
  - frontend/src/lib/server/** ที่เขียน `shelter_{code}` / `catalog` ด้วย admin credentials (helper ใหม่ `withActor(doc, actor)`) · frontend/src/lib/server/couch-public-writer.ts
  - frontend/src/lib/server/shelter-access-design.ts (VDU `shelter_{code}` · bump version ของ design) · frontend/scripts/sync-central-db.ts `syncCatalogAccessDesign` (VDU `catalog`)
  - worker/src/worker/audit_log.py (projector ใหม่ `audit_diff`) · worker/src/worker/couch/processor.py · worker/src/worker/listeners/ (listener ใหม่ของ `catalog`) · worker เขียน `shelter_{code}` ทุกจุดใส่ `updated_by: "worker"` · worker/tests
  - frontend/src/lib/features/audit-log (label ของ entity type / event ใหม่) · แถบ "ประวัติการแก้ไข" ในหน้าโปรไฟล์ผู้อพยพ, หน้าครัวเรือน และหน้า catalog
  - frontend/src/routes/api/v1/users/staff-card/rotate/+server.ts · frontend/src/routes/api/v1/thirdparty-clients/[id]/secret/+server.ts (event ที่ค้างจาก CR-259)
  - tests: couch-db (stamp + tombstone), VDU (`shelter_{code}`, `catalog`), worker `audit_diff`, route tests 2 route ข้างบน, DOM test แถบประวัติ
why: >
  เฟส A+B (CR-259) บันทึกเฉพาะการเขียนที่ผ่าน BFF · ข้อมูลส่วนใหญ่ของศูนย์ (ผู้อพยพ ครัวเรือน catalog บริจาค ฯลฯ) browser เขียนตรงเข้า CouchDB
  จึงยังตอบไม่ได้ว่าใครแก้ข้อมูลผู้อพยพหรือสินค้า · doc ส่วนใหญ่รู้แค่ `created_by` ไม่มีผู้แก้ล่าสุด และการลบด้วย HTTP `DELETE` ไม่เหลือว่าใครลบ
migration: >
  additive — ไม่ backfill · doc เดิมที่ไม่มี `updated_by` อ่านเป็น `null` · ไม่สร้าง event ย้อนหลังจาก doc ที่มีอยู่ (bootstrap ไม่สร้าง event)
  · ลำดับ deploy: (1) client + BFF + worker ประทับ `updated_by` → (2) redeploy VDU (`pnpm redeploy:access` + `pnpm sync:central`) → (3) เปิด `AUDIT_DIFF_ENABLED=true` ที่ worker
---

# CR-260 — Audit log เฟส C (การเขียนตรงจาก browser)

> **สรุป (TL;DR):**
>
> - **เปลี่ยน:** envelope ทุก doc มี `updated_by` (ผู้เขียนล่าสุด) ที่ VDU บังคับให้ตรงกับผู้ login · การลบเปลี่ยนเป็น tombstone ที่บอกผู้ลบ · worker อ่าน `_changes` ของ `shelter_{code}` และ `catalog` แล้วเขียน `audit_event` ลง `audit_log` (DB เดิมจาก CR-259)
> - **เพื่อใคร:** SA / SM ตรวจย้อนหลังได้ว่าใครสร้าง แก้ หรือลบข้อมูลผู้อพยพ ครัวเรือน catalog และงานอื่นในศูนย์ — ต่อจากลำดับที่ Jackyzaz เลือกใน #1357 (catalog → ผู้อพยพ/ครัวเรือน → อื่น ๆ)
> - **build:** ประทับ `updated_by` ที่ `couch-db.ts` จุดเดียวสำหรับ browser · helper ฝั่ง BFF + worker · กฎ VDU ใหม่ 2 DB · projector `audit_diff` ใน worker · label + แถบประวัติในหน้าผู้อพยพ ครัวเรือน และ catalog · event ที่ค้างจาก CR-259 (หมุนบัตร QR เจ้าหน้าที่, เปิดดู secret ของ third-party client)
> - **กระทบ:** stable core (envelope + VDU) — approved โดย PM 2026-11-18 · schema.md §0 / §8 / §11 · ไม่ bump `schema_v` · ไม่แตะ FastAPI / public plane

> **นอกขอบเขต:** DB `central_ops` (referral, export_job) · `registry` และ `_users` (CR-259 ครอบคลุมแล้ว) · DB `printing_*` · Mongo public plane · การสร้าง event ย้อนหลังของข้อมูลเดิม

---

## Requirements

### Envelope

- FR-C1 — envelope §0 เพิ่ม `updated_by`: str · `_users` name ของผู้เขียนครั้งล่าสุด · ตอนสร้าง = `created_by` · doc เดิมไม่มี key อ่านเป็น `null`
- FR-C2 — ค่าพิเศษของ `updated_by` (ไม่ใช่ `_users` name): `worker` (sync worker) · `kiosk:{device_id}` (ตู้ kiosk ผ่าน BFF — แบบเดียวกับ `created_by` §1.x) · `system:{job}` (script / job ฝั่ง server เช่น `system:seed`, `system:shelter-close`) · `<ชื่อ public writer>` (ผู้เขียนแทนประชาชน, FR-C9)

### การเขียนจาก browser

- FR-C3 — `putDoc`, `putDocStrict`, `bulkDocs`, `bulkDocsDetailed` ใน `couch-db.ts` ประทับ `updated_by = authStore.user.name` ทุก doc ก่อนส่ง เมื่อ `dbName` เป็น `shelter_*` หรือ `catalog` · ค่าที่ caller ใส่มาถูกเขียนทับ · ไม่แก้ `updated_at` (caller ตั้งเหมือนเดิม)
- FR-C4 — `deleteDoc` เปลี่ยนจาก HTTP `DELETE` เป็น `PUT /{db}/{id}` body `{ _id, _rev, _deleted: true, updated_by, updated_at }` (tombstone ที่บอกผู้ลบ) · พฤติกรรมของผู้เรียกเหมือนเดิม (409 / 404 เดิม)
- FR-C5 — ไม่มี user login (ไม่ควรเกิดใน path ที่เขียน) → ไม่ประทับ และให้ VDU ตัดสิน (FR-C10)

### การเขียนจาก server และ worker

- FR-C6 — helper `withActor(doc, actor)` ใน `$lib/server/` ตั้ง `updated_by` (และ `created_by` เมื่อเป็น doc ใหม่ที่ยังไม่มีค่า) · ทุก route / job ฝั่ง SvelteKit ที่เขียน `shelter_{code}` หรือ `catalog` ด้วย admin credentials ใช้ helper นี้ · actor = `caller.name` เมื่อมี session, ค่าตาม FR-C2 เมื่อไม่มี
- FR-C7 — worker ทุกจุดที่เขียน `shelter_{code}` (role grant, M6, volunteer inbound, shift ฯลฯ) ใส่ `updated_by: "worker"`
- FR-C8 — จุดเขียนที่ยังไม่ใส่ตาม FR-C6/FR-C7 ไม่ทำให้การเขียนล้ม (admin ผ่าน VDU) แต่ event จะได้ผู้ทำ `unknown` (FR-C16) · Acceptance กำหนดให้หลัง deploy ไม่มี event `unknown` จาก path ที่รู้จัก
- FR-C9 — public writer (`couch-public-writer.ts`, member ธรรมดา) ประทับ `updated_by` = ชื่อ CouchDB user ของตัวเอง · worker แปลงชื่อนี้เป็น actor `{ name: "public", kind: "system" }`

### VDU

- FR-C10 — VDU ของ `shelter_{code}`: ผู้เขียนที่ไม่ใช่ `_admin` / `repl:<CODE>` ถ้า `newDoc.updated_by` มีค่า ต้องเท่ากับ `userCtx.name` ไม่งั้น reject `updated_by must match the authenticated user` · ไม่มีค่า → ผ่าน (ดู Q1) · ใช้กับ tombstone ด้วย
- FR-C11 — VDU ของ `catalog` (`syncCatalogAccessDesign`) ใช้กฎเดียวกับ FR-C10
- FR-C12 — ไม่แตะกฎเดิมของแต่ละ type · append-only types ยัง reject update/delete เหมือนเดิม · bump version ของ `_design/access` ของ `shelter_{code}` และ `catalog` เพื่อให้ `redeploy:access` / `sync:central` เขียนทับ

### Worker — projector `audit_diff`

- FR-C13 — listener เดิมของ `shelter_{code}` เรียก `audit_diff` ทุก change ที่ type อยู่ใน `AUDITED_TYPES` (ตาราง §Change) · เพิ่ม listener ใหม่ของ DB `catalog` · เปิดด้วย env `AUDIT_DIFF_ENABLED=true` (ค่าเริ่มต้น `false`)
- FR-C14 — `_id` ของ event = `audit_event:rev:{sha256("{db}|{doc_id}|{rev}") 64 hex}` → replay จาก checkpoint ไม่เกิดแถวซ้ำ (409 = มีแล้ว)
- FR-C15 — `action`: rev `1-…` และไม่ `_deleted` → `create` · `_deleted` → `delete` · ค่าของ `status`, `operation_status`, `deactivated` หรือ `active` เปลี่ยน → `status_change` · นอกนั้น `update` · `event` = `{type}.{created|updated|deleted|status_changed}` ตาม `action` (รูปเดียวกับ CR-259 FR-25) เช่น `evacuee.updated`, `item_master.deleted`
- FR-C16 — `actor`: `updated_by` ของ doc ใหม่ (rev 1 ที่ไม่มี `updated_by` ใช้ `created_by`) · `worker` → kind `worker` · `kiosk:*` / `system:*` / public writer → kind `system` · `_users` name → kind `user` · ไม่มีค่าเลย → `{ name: "unknown", kind: "unknown" }`
- FR-C17 — `changes` (เฉพาะ `update` / `status_change`): worker อ่าน rev ก่อนหน้าด้วย `GET /{db}/{id}?revs=true` แล้ว `GET /{db}/{id}?rev={prev}` · คำนวณด้วยกติกาเดียวกับ CR-259 FR-29/FR-30 และ allowlist ใน §11.2 · อ่าน rev ก่อนหน้าไม่ได้ (ถูก compaction) → ไม่มี `changes` และตั้ง `changes_unknown: true`
- FR-C18 — `entity`: `type` = `doc.type` (tombstone ใช้ prefix ของ `_id`) · `id` = `_id` · `label` = field ตามตาราง §Change (ไม่ใช้ชื่อคน — ผู้อพยพ / ครัวเรือน `label = null`) · `shelter_code` = รหัสจากชื่อ DB (`shelter_*`) หรือ `doc.shelter_code` ของ catalog (ไม่มี = `null` = รายการกลาง)
- FR-C19 — `occurred_at` = `updated_at` ของ doc (ไม่มี → `created_at` → เวลาที่ worker เห็น) · `source` = `worker_diff`
- FR-C20 — bootstrap (`--bootstrap`) **ไม่** สร้าง event จาก doc ที่มีอยู่ · สร้างเฉพาะ change ที่เข้ามาใน `_changes` หลังเปิด `AUDIT_DIFF_ENABLED`
- FR-C21 — `audit_diff` ล้มเหลวชั่วคราว (5xx, 408, 429, network error ทั้งตอนอ่าน rev ก่อนหน้าและเขียน `audit_log`) → ค้าง checkpoint ของ DB นั้นไว้เพื่อ retry รอบถัดไป (แบบเดียวกับ `copy_audit_doc`) · กรณีถาวรที่ retry ไม่ช่วย (4xx อื่น เช่น ไม่มี DB `audit_log` หรือ build error) → log แล้วไปต่อไม่ค้าง checkpoint · กรณี rev ก่อนหน้าถูก compaction (404 / ไม่มี `_revisions`) → บันทึก `changes_unknown: true` แล้วไปต่อ
- FR-C22 — ไม่สร้าง event ของ type นอก `AUDITED_TYPES` · การเพิ่ม type ภายหลังทำใน config + allowlist โดยไม่ต้องมี CR ใหม่ ถ้า type อยู่ในตาราง "รอบถัดไป" ของ CR นี้

### event ที่ค้างจาก CR-259 (ผ่าน BFF)

- FR-C26 — `POST /api/v1/users/staff-card/rotate` สำเร็จ → `recordAudit` event `user.staff_card_rotated` · `action: update` · `entity: { type: "user", id: <ชื่อผู้ใช้>, label: display_name }` · `shelter_code` ตามกติกา CR-259 FR-28 · ไม่เก็บค่าของบัตรหรือ token
- FR-C27 — `POST /api/v1/thirdparty-clients/{id}/secret` (เปิดดู secret หลังยืนยันรหัสผ่าน) สำเร็จ → event `thirdparty_client.secret_viewed` · `action: other` · `entity: { type: "thirdparty_client", id }` · `shelter_code: null` · ไม่เก็บค่า secret · ยืนยันรหัสผ่านไม่ผ่าน → ไม่มี event
- FR-C28 — เพิ่มทั้งสอง event ใน const `AUDIT_EVENTS` และ label ไทย ("หมุนบัตร QR เจ้าหน้าที่", "เปิดดู secret ของหน่วยงานภายนอก")

### หน้าเว็บและสิทธิ์

- FR-C23 — API อ่านและหน้า `/back-office/audit-log` ใช้ของ CR-259 ไม่เปลี่ยน · เพิ่ม label ไทยของ entity type / event ใหม่ · ตัวกรอง "ประเภทข้อมูล" มี type ใหม่
- FR-C24 — แถบ "ประวัติการแก้ไข" (`EntityHistory`) เพิ่มในหน้าโปรไฟล์ผู้อพยพ (`/back-office/evacuee-management/edit/evacuee/{id}`), หน้าครัวเรือน (`/back-office/households/edit/{id}`) และหน้าแก้ไข catalog (`/back-office/catalog/{entity}/edit/{id}`)
- FR-C25 — สิทธิ์ตาม CR-259 FR-35 ไม่เปลี่ยน: SA ทุกศูนย์รวมรายการกลางของ catalog · SM เฉพาะ event ที่ `shelter_code` เป็นศูนย์ตน (ไม่เห็นการแก้ catalog กลาง)

---

## Change (before → after)

**schema.md §0 envelope**

| field | before | after |
| --- | --- | --- |
| `updated_by` | ไม่มี | str · client / server · ผู้เขียนครั้งล่าสุด (FR-C1/FR-C2) · VDU ตรวจตาม FR-C10 · doc เดิมอ่านเป็น `null` |

**schema.md §8** — ข้อใหม่: กฎ `updated_by` ของ `shelter_{code}` และ `catalog` (FR-C10/FR-C11)

**schema.md §11 `audit_event`**

| field | before (CR-259) | after |
| --- | --- | --- |
| `_id` | `audit_event:{ulid}` | + `audit_event:rev:{sha256}` สำหรับ `source = worker_diff` (FR-C14) |
| `source` | `bff` \| `worker_copy` | + `worker_diff` |
| `actor.kind` | `user` \| `system` \| `worker` | + `unknown` |
| `changes_unknown` | ไม่มี | bool · opt · `true` เมื่ออ่าน rev ก่อนหน้าไม่ได้ |
| `entity.type` | `shelter`, `user`, `master_data`, `api_key`, `thirdparty_client` + type ของ doc `audit` | + type ใน `AUDITED_TYPES` |

**`AUDITED_TYPES` รอบนี้ + allowlist (§11.2)**

| type | DB | `label` | เก็บ `from` / `to` |
| --- | --- | --- | --- |
| `item_category` | `catalog`, `shelter_*` | `name` | `name`, `default_class`, `is_default`, `deactivated` |
| `item_master` | `catalog`, `shelter_*` | `name` | `name`, `sku`, `category`, `base_unit`, `distribution_type`, `type_class`, `qty_per_person`, `returnable`, `shelf_life_days`, `storage_type`, `deactivated`, `merged_into` |
| `recipe` | `catalog`, `shelter_*` | `label` | `label`, `standard_portions`, `standard_duration_hours`, `deactivated` |
| `unit_of_measure` | `catalog` | `label_th` | `code`, `label_th`, `label_en`, `dimension`, `sort_order`, `deactivated` |
| `food_sphere_standard`, `requirement_group`, `replenishment_policy` | `catalog`, `shelter_*` | — | field เท่านั้น |
| `evacuee` | `shelter_*` | `null` | `household_id`, `preferred_zone`, `registered_via`, `anonymized` |
| `household` | `shelter_*` | `null` | `status`, `head_evacuee_id`, `housing_type` |
| `medical` | `shelter_*` | `null` | — (field เท่านั้น เสมอ) |

**รอบถัดไป (เพิ่มผ่าน config ตาม FR-C22, allowlist = field เท่านั้นจนกว่าจะกำหนด):** `donation`, `donation_campaign`, `donation_slot`, `stock_transfer`, `volunteer`, `shift_assignment`, `job`, `shelter_incident`, `meal_plan`, `requisition_ticket`, `distribution_request`, `distribution_batch`, `sop_override`, `fuel_cylinder`, `daily_sop_assessment`, `daily_sop_role_assessment`

**ไม่ทำ event เด็ดขาด:** append-only types ใน §8 ข้อ 2 (มีประวัติในตัว) · `audit` (CR-259 คัดลอกแล้ว) · doc ประสานงาน / ระบบ (`lot_counter`, `stock_lot_reservation`, `distribution_issue_*`, `distribution_one_time_guard`, `bulk_return_claim`, `loan_return_reservation`, `daily_calc`, `simulation`, `meal_distribution_push`, `evacuee_qr`, `image`)

---

## Acceptance

- [ ] เจ้าหน้าที่แก้ชื่อสินค้าใน catalog กลาง → event `item_master.updated` ผู้ทำ = เจ้าหน้าที่คนนั้น · `changes` มี `name` พร้อมค่าเดิม→ใหม่ · `shelter_code = null` · SA เห็น SM ไม่เห็น
- [ ] แก้เบอร์โทรผู้อพยพ → event `evacuee.updated` มี `{ field: "phone" }` ไม่มีค่า · `label = null`
- [ ] ลบรายการ (เช่น recipe ของศูนย์) → event `recipe.deleted` มีผู้ลบ
- [ ] user ปลอม `updated_by` เป็นคนอื่นแล้วเขียนตรงผ่าน `/couch` → VDU reject · `_admin` / `repl:<CODE>` ไม่ถูกตรวจ
- [ ] replay `_changes` จาก checkpoint เดิม → ไม่มี event ซ้ำ
- [ ] rev ก่อนหน้าถูก compaction → event มี `changes_unknown: true` และไม่ error
- [ ] `--bootstrap` ไม่สร้าง event · `AUDIT_DIFF_ENABLED=false` ไม่สร้าง event
- [ ] หลัง deploy ครบ 3 ขั้น ไม่มี event `actor.kind = unknown` จาก path ที่ระบุใน FR-C6/FR-C7 (ตรวจจาก staging 1 วัน)
- [ ] แถบ "ประวัติการแก้ไข" ในหน้าผู้อพยพ ครัวเรือน และ catalog แสดง event ของรายการนั้น
- [ ] หมุนบัตร QR เจ้าหน้าที่ และเปิดดู secret ของ third-party client → มี event ที่ไม่มีค่าของบัตร / secret

---

## Resolved questions (PM 2026-11-18 — ตามข้อเสนอ)

- **Q1 — doc ที่ไม่มี `updated_by` จาก user ทั่วไป** → รับไว้ บันทึกผู้ทำ `unknown` (FR-C10, FR-C16) · การ reject หลังช่วงเปลี่ยนผ่านต้องมี CR ใหม่
- **Q2 — rev ก่อนหน้าหายเพราะ compaction** → ยอมรับ `changes_unknown: true` (FR-C17) · ไม่เก็บ fingerprint แยก
- **Q3 — ADR แยก** → ไม่ทำ · บันทึก design ใน CR นี้
- **Q4 — ลำดับ type รอบถัดไป** → ตามตาราง "รอบถัดไป" ใน §Change

---

## Why

- browser เขียน `shelter_{code}` และ `catalog` ตรงผ่าน `/couch` (remote-first) ไม่ผ่าน BFF · ถ้าให้แต่ละหน้าเขียน log เอง จะลืมง่ายและ client ข้ามได้ · worker เห็นทุกการเปลี่ยนแปลงจาก `_changes` อยู่แล้ว จึงสร้าง event ได้ครบโดยไม่พึ่ง browser
- ผู้ทำต้องเชื่อถือได้ → VDU ตรวจ `updated_by` กับ `userCtx.name` (แบบเดียวกับ `created_by` ที่ VDU ตรวจอยู่แล้วในหลาย type)
- ประทับที่ `couch-db.ts` จุดเดียว → ทุก feature ได้ `updated_by` โดยไม่ต้องแก้ทีละหน้า
- HTTP `DELETE` ไม่มี body จึงไม่รู้ผู้ลบ → เปลี่ยนเป็น tombstone `PUT` ที่ CouchDB รองรับอยู่แล้ว
- `_id` deterministic จาก rev → ทน replay และ worker restart โดยไม่ต้องเก็บ state เพิ่ม
- allowlist default ปิด + ผู้อพยพ / ครัวเรือน `label = null` → ไม่เอาชื่อหรือข้อมูลส่วนบุคคลเข้า log (spec audit/privacy)
- เปิดด้วย env flag + ไม่สร้าง event ย้อนหลัง → deploy ทีละขั้นได้และย้อนกลับได้โดยปิด flag

## Decision log

- 2026-11-17 — Jackyzaz ตอบคำถาม #1357 "ตามแนะนำ" (ลำดับ: ศูนย์ → ผู้ใช้/สิทธิ์ → master data / catalog → ผู้อพยพ/ครัวเรือน; เก็บค่าเดิม→ใหม่เฉพาะ field ที่ไม่ใช่ข้อมูลส่วนบุคคล; เก็บถาวร)
- 2026-11-17 — CR-259 แยกเฟส C ออก เพราะแตะ stable core · catalog ย้ายมาเฟส C เพราะ browser เขียนตรง
- 2026-11-18 — proposed
- 2026-11-18 — เพิ่ม FR-C26–FR-C28: event ที่ค้างจาก CR-259 (หมุนบัตร QR เจ้าหน้าที่, เปิดดู secret ของ third-party client)
- 2026-11-18 — approved โดย PM · Q1–Q4 ตามข้อเสนอ · รันเลข CR-260 (CR-259 อยู่ใน PR #1453)
