---
id: CR-094
title: Volunteer Backoffice V10 — back-office path, CouchDB-native time-bound access, job CRUD in back-office, Couch→Mongo public sync + UI V10 schema deltas
status: proposed
date: 2026-08-26
requested_by: Dev Team B
decided_by: เจ้าของโครงการ
layer: stable + volatile   # FR-VOL-05 enforcement = stable core (auth/write path) — ต้อง review ก่อน apply
affects:
  - docs/changes/CR-092-volunteer-management-v10-flow.md — amend §1 FR-VOL-05, §5 routing table, §1.1 schema delta
  - docs/changes/CR-041-module-a-volunteer-job-board.md — job/shift enum + slots fields ถูกแทนที่
  - docs/data/schema.md §2.8 volunteer · §2.9 shift_assignment · §2.17 job · §2.18 job_application (+ doc type ใหม่ `volunteer_transfer`)
  - schema_v — volunteer 1 → 2 · shift_assignment 2 → 3 · job 1 → 2 · job_application 1 → 2 · volunteer_transfer 1 (ใหม่)
  - docs/data/couchdb-mongodb-sync.md — projector ใหม่ `public_jobs`
  - docs/data/api-contract.md — `/public/v1/volunteer/*`
  - docs/prd/role-permission-matrix.md §4 — dispatch / provisioning / walk-in / transfer / time-bound grant
  - docs/sitemap.md §2.6 — routes ย้ายมาใต้ `/back-office/volunteers`
  - docs/task-breakdown/06-A-volunteer.md — T-28 / T-29 re-scope
  - frontend/src/lib/features/volunteers/** (ใหม่ทั้ง slice)
  - frontend/src/routes/(protected)/back-office/volunteers/**
  - frontend/src/lib/server/couch-admin.ts — time-bound role grant/revoke
  - worker/ — projector `public_jobs`
  - backend/apiapp/modules/ — `/public/v1/volunteer/*`
---

# CR-094 — Volunteer Backoffice V10 (ต่อยอด/แก้ CR-092)

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ปิดข้อค้าง 4 ข้อของ [CR-092](CR-092-volunteer-management-v10-flow.md) — (1) ทุกหน้าจอ back-office ย้ายมาใต้ `/back-office/volunteers` ไม่ใช้ `/admin/*` (2) Time-Bound Write Access บังคับที่ **CouchDB** (role grant ตามกะ + `validate_doc_update`) ไม่ใช่ Server BFF (3) Job CRUD อยู่ใน back-office (4) Public Job Board อ่านผ่าน **Couch → worker → Mongo → FastAPI** ตาม CR-063 — พร้อมเก็บ schema delta ที่ UI V10 ต้องใช้แต่ CR-092 ไม่ได้ระบุ
- **เพื่อใคร/ทำไม:** CR-092 เขียนบนสมมติฐานสถาปัตยกรรมที่ไม่ตรงกับระบบจริง (อ้าง PouchDB / BFF write / route `/admin`) และ mockup UI V10 มี flow ที่ยังไม่มีใน spec (walk-in, โอนย้ายศูนย์, manual override + audit trail, job status `draft`/`paused`/`urgent`)
- **dev ต้อง build:** feature slice `features/volunteers/` + 1 หน้า 3 แท็บใน back-office + kiosk เช็คอินแยกหน้า + CouchDB time-bound grant/revoke + projector `public_jobs`
- **กระทบ schema/scope:** bump 4 doc type + doc type ใหม่ `volunteer_transfer` · FR-VOL-05 เป็น **stable core** ต้อง review ก่อน apply

---

## Why

1. **CR-092 §FR-VOL-05 อ้างสถาปัตยกรรมที่ไม่มีจริง** — ระบุว่า "Client-Side PouchDB หรือ CouchDB Direct Access ตรวจ context เวลาไม่ได้ จึงต้อง write ผ่าน Server BFF" แต่โครงการนี้ **ไม่มี PouchDB** และเป็น remote-first: browser เขียน CouchDB ตรงด้วย `_session` cookie ([CLAUDE.md](../../CLAUDE.md) §Remote-first). การบังคับ write ทั้งระบบผ่าน BFF = รื้อ write path ทั้งแอป
2. **Route `/admin/volunteers/*` ไม่มีในระบบ** — โค้ดจริงรวมทุกหน้าหลังบ้านไว้ใต้ `(protected)/back-office/`
3. **CR-092 มี 6 หน้าจอ แต่ไม่มีหน้า "สร้าง/แก้ job"** ขณะที่ dispatch/quota ทั้งหมดต้องอิง `job` doc — UI V10 มีปุ่ม "ประกาศภารกิจงานอาสาใหม่" อยู่บนกระดานงานฝั่ง back-office
4. **CR-092 ไม่ระบุแหล่งข้อมูลของ public job board** — ระบบมีกติกาอยู่แล้วว่า public plane ต้องอ่าน Mongo ผ่าน FastAPI ([CR-063](CR-063-public-bff-only.md))
5. **UI V10 mockup มีฟิลด์/สถานะที่ schema รองรับไม่ได้** — รหัสอาสา `V-001`, badge "ยืนยันตัวตนแล้ว", ตัวกรอง "แหล่งที่มา", job chip `ร่าง`/`พักรับ`/`ด่วนพิเศษ`, กะ 8 ชม. + `ยืดหยุ่น`, "ขอโอนย้ายศูนย์", "เช็คอินแทน (Manual Override)"

---

## 1. Decisions locked (เจ้าของโครงการเคาะ 2026-08-26)

| ID | ข้อค้างใน CR-092 | มติ |
| --- | --- | --- |
| D-VOL-PATH | route prefix ของหน้าหลังบ้าน | **back-office** — ใช้ `/back-office/volunteers` แทน `/admin/volunteers/*` ทั้งหมด |
| D-VOL-ENFORCE | ชั้นบังคับ Time-Bound Write Access | **CouchDB** — คงสถาปัตยกรรม remote-first, บังคับที่ CouchDB ไม่ใช่ BFF middleware |
| D-VOL-JOBCRUD | หน้าสร้าง/แก้ job | **อยู่ใน back-office** ตาม UI V10 (แท็บ "จัดการงานอาสา") |
| D-VOL-PUBSYNC | แหล่งข้อมูล public job board | **sync เข้า MongoDB จาก CouchDB** ที่สร้างจาก back-office แล้วอ่านผ่าน FastAPI |

---

## 2. Requirements

### 2.1 FR-VOL-05R — Time-Bound Write Access บน CouchDB (แทน FR-VOL-05 เดิมทั้งข้อ)

> **stable core** — แตะ auth/write path ต้อง review ก่อน apply

- **FR-VOL-05R.1** — สิทธิ์เขียนของอาสา staff-capable ต้องบังคับที่ **CouchDB** ผ่าน 2 ชั้น: (ก) การเป็นสมาชิก role ใน `_security` ของ `shelter_{code}` และ (ข) `validate_doc_update` ของฐานนั้น — ห้ามพึ่งการตรวจฝั่ง client เพียงอย่างเดียว
- **FR-VOL-05R.2** — RoleKey ตาม `job.required_roles[]` ต้องถูก **grant เมื่อเช็คอิน** และ **revoke เมื่อเช็คเอาต์หรือหมดหน้าต่างกะ** โดย server-only route ใต้ `src/routes/api/**` ที่ใช้ `$lib/server/couch-admin.ts` (pattern เดียวกับ [CR-075](CR-075-couch-admin-grant-sa.md)) — ห้ามให้ client ถือ admin credential
- **FR-VOL-05R.3** — หน้าต่างที่ grant ได้ = `duty_window.start_ts − 5m` ถึง `duty_window.end_ts + 5m` และต้องมี `check_in_at != null`; นอกเงื่อนไขนี้ห้ามมี role อยู่บนบัญชี
- **FR-VOL-05R.4** — `validate_doc_update` ต้อง reject การเขียนของบัญชีที่ไม่มี role ด้วย `forbidden` + message `ERR_OUTSIDE_SHIFT_WINDOW` (CouchDB ตอบ HTTP 403)
- **FR-VOL-05R.5** — ต้องมีกลไก revoke ที่ไม่ขึ้นกับการกดเช็คเอาต์ของผู้ใช้ (กันกรณีลืมเช็คเอาต์)
  > [NEEDS DECISION: revoke sweeper — (ก) cron/worker กวาดทุก 5 นาที (แนะนำ ใช้ worker ที่มีอยู่) หรือ (ข) ตรวจตอน login/refresh session เท่านั้น]
- **FR-VOL-05R.6** — ทุกครั้งที่ grant/revoke ต้องเขียน audit log พร้อม `volunteer_id`, `shift_assignment_id`, role, actor, timestamp

### 2.2 FR-VOL-08 — โครงหน้าจอ back-office (แทน §5 routing table ของ CR-092 เฉพาะฝั่ง Admin)

- **FR-VOL-08.1** — หน้าหลักเดียว `/back-office/volunteers` ประกอบด้วย 3 แท็บ: `จัดการงานอาสา (Job Board & Capacity)` · `ตารางกะและเช็คอิน (Roster & Live Attendance)` · `รายชื่อและการอนุมัติ`
- **FR-VOL-08.2** — ส่วนหัว **Smart Volunteer Control Hub** แสดงตัวนับสด 5 ค่า: พร้อมปฏิบัติงาน · รับกะแล้ว · เช็คอินอยู่ตอนนี้ · รออนุมัติ · รอยืนยันตัวตน — ทุกค่าคำนวณจากฟังก์ชัน domain ชุดเดียว (single source of truth) ห้ามคำนวณซ้ำใน UI แต่ละแท็บ
- **FR-VOL-08.3** — ตัวเลือกศูนย์ระดับหน้า ต้องจำกัดตาม shelter scope ของผู้ใช้เสมอ
- **FR-VOL-08.4** — จุดเช็คอินหน้างานเป็น **หน้าแยก** `/back-office/volunteers/checkin` (kiosk fullscreen 40/60 ตาม CR-092 FR-VOL-04) เปิดจากปุ่มในแท็บ 2
- **FR-VOL-08.5** — Master data ทักษะ/controlled skill อยู่ที่ `/back-office/volunteers/settings`
- **FR-VOL-08.6** — Route `/admin/volunteers/roster`, `/admin/volunteers/dispatch`, `/admin/volunteers/settings` ใน CR-092 §5 **ยกเลิก**
- **FR-VOL-08.7** — โหมดสาธิต RBAC และแบนเนอร์ "LOCAL OFFLINE MODE" ใน mockup เป็น **artifact ของ mockup เท่านั้น ห้าม implement** — ระบบไม่มี offline write fallback ([CLAUDE.md](../../CLAUDE.md) §Remote-first: เน็ตหลุด = แสดงแบนเนอร์ disconnected, ไม่อ่าน/เขียน local)

### 2.3 FR-VOL-09 — Job CRUD ใน back-office

- **FR-VOL-09.1** — แท็บ "จัดการงานอาสา" ต้องสร้าง/แก้/ปิดรับ `job` ได้ (ปุ่ม "ประกาศภารกิจงานอาสาใหม่")
- **FR-VOL-09.2** — การ์ดงานต้องแสดง 3-Color Quota Bar (`ตอบรับแล้ว` / `เสนอแล้ว` / `ยังขาดอีก`), skill tags, จำนวนกะ, จำนวนผู้สมัคร
- **FR-VOL-09.3** — ตัวกรองงานต้องมี: ไม่รวมงานที่ปิดแล้ว · ด่วนพิเศษ · เปิดรับ · พักรับ · เต็มโควตา · ร่าง · ปิดงาน · แสดงทั้งหมด
- **FR-VOL-09.4** — แถบสรุปอัตราจองกะต้องคำนวณ **ระดับกะ** (ไม่ใช่ระดับงาน): อัตราจองรวม % · ขาดแคลนหนัก (<50%) · ใกล้ครบเป้า (50–99%) · ครบตามเป้า (100%) และคลิกเพื่อกรองได้
- **FR-VOL-09.5** — `auto_accept` เปิดได้เฉพาะ `tier: operational` (คงกติกา F-AUTO ของ CR-041)

### 2.4 FR-VOL-10 — Walk-in registration (ใหม่ ไม่มีใน CR-092)

- **FR-VOL-10.1** — แท็บ 3 ต้องมีปุ่ม "ลงทะเบียนอาสา Walk-in" เปิด modal บันทึกอาสาที่เดินเข้ามาหน้าศูนย์ภายใน 30 วินาที
- **FR-VOL-10.2** — ฟิลด์บังคับ: ชื่อ-นามสกุล, เบอร์โทรศัพท์, สังกัดศูนย์ · ฟิลด์ทางเลือก: เลขบัตรประชาชน 13 หลัก
  > หมายเหตุขัดแย้ง: CR-092 FR-VOL-01 กำหนด `national_id`/`phone` เป็น SSOT — CR นี้ยืนยันว่า **`phone` เพียงพอสำหรับ walk-in** และ `national_id` ยังคง optional ทุกช่องทาง
- **FR-VOL-10.3** — เลือกทักษะจาก master list ได้หลายค่า; ทักษะ `controlled` (การแพทย์/ปฐมพยาบาล) เลือกได้แต่ต้องตกสถานะ `pending_review` รอรับรอง ห้ามข้ามไป active
- **FR-VOL-10.4** — เลือกกะได้จาก `กะเช้า 08:00–16:00` · `กะบ่าย 16:00–00:00` · `กะดึก 00:00–08:00` · `ยืดหยุ่น (standby)`
- **FR-VOL-10.5** — ตัวเลือก "เช็คอินเข้ากะและเริ่มปฏิบัติงานทันที" ต้องสร้าง `shift_assignment` + set `check_in_at` ในธุรกรรมเดียวกับการสร้างโปรไฟล์

### 2.5 FR-VOL-11 — Manual override เช็คอิน + Audit Trail

- **FR-VOL-11.1** — เจ้าหน้าที่ต้องกด "เช็คอินแทน (Manual Override)" ได้เมื่อสแกน QR ไม่สำเร็จ
- **FR-VOL-11.2** — ทุก override ต้องบันทึก actor (`check_in_by`), เหตุผล, timestamp และแสดงในหน้า "ประวัติ Audit Trail" พร้อมตัวนับจำนวนรายการ
- **FR-VOL-11.3** — แถบ "สรุปยอดปฏิบัติงานสดประจำวันนี้" ต้องแสดง 3 ค่า: ปฏิบัติหน้าที่อยู่ขณะนี้ · รอมารายงานตัวเข้ากะ · เสร็จสิ้นภารกิจ/เช็คเอาต์แล้ว

### 2.6 FR-VOL-12 — โอนย้ายศูนย์ (ใหม่ ไม่มีใน CR-092)

- **FR-VOL-12.1** — ต้องขอโอนย้ายอาสาข้ามศูนย์ได้ พร้อมตัวนับคำขอค้างบนปุ่ม "ขอโอนย้ายศูนย์"
- **FR-VOL-12.2** — คำขอเก็บเป็น doc type ใหม่ `volunteer_transfer` (§3.5) สถานะ `pending` → `accepted` | `rejected`
- **FR-VOL-12.3** — เมื่อ `accepted` ต้องอัปเดต `volunteer.current_shelter_code` และ revoke role grant ของศูนย์ต้นทางทันที
  > [NEEDS DECISION: ใครอนุมัติ — ศูนย์ปลายทาง, ศูนย์ต้นทาง, หรือทั้งคู่ (two-phase)]

### 2.7 FR-VOL-13 — Public job board ผ่าน public plane

- **FR-VOL-13.1** — `job` ที่สร้างจาก back-office ต้องถูก project ลง Mongo collection `public_jobs` โดย worker (ตาม [couchdb-mongodb-sync.md](../data/couchdb-mongodb-sync.md))
- **FR-VOL-13.2** — projection ต้อง**ไม่มี PII** และรวมเฉพาะ `job.status ∈ {open, almost_full}` เท่านั้น (`draft`/`paused`/`full`/`closed`/`cancelled` ห้ามออก public)
- **FR-VOL-13.3** — SPA public อ่านผ่าน BFF `/api/public/v1/volunteer/*` → FastAPI `/public/v1/volunteer/*` เท่านั้น ห้ามยิง CouchDB หรือ FastAPI ตรงจาก browser ([CR-063](CR-063-public-bff-only.md))
- **FR-VOL-13.4** — การ **สมัครงาน** เป็น write path ของ public: ต้องผ่าน BFF server route (ที่ถือ reCAPTCHA secret + rate limit ตาม CR-092 FR-VOL-02.3) แล้วเขียน CouchDB ด้วยสิทธิ์ server เท่านั้น

---

## 3. Change — schema (before → after)

> ทุกตัวเลข `schema_v` ด้านล่างต่างจาก CR-092 ซึ่งระบุ "Schema v1" ทั้งที่มีการ rename ฟิลด์ (breaking) — CR นี้แก้ให้ถูกต้อง

### 3.1 `volunteer` §2.8 — schema_v **1 → 2**

| Field | Before | After |
| --- | --- | --- |
| `national_id` | — | `str\|null` opt — เลข 13 หลัก (SSOT ผูกตัวตน 3 สถานะ) |
| `checked_in` | — | `bool` req default `false` |
| `current_shelter_code` | — | `str\|null` opt |
| `volunteer_code` | — | `str` req — รหัสอาสาอ่านง่าย `V-{NNN}` นับต่อศูนย์ (UI V10 แสดงในตาราง) |
| `identity_verified` | — | `bool` req default `false` — badge "ยืนยันตัวตนแล้ว" |
| `source` | — | `enum(public_apply, walk_in, staff_entry, transfer)` req — ตัวกรอง "แหล่งที่มา" |

### 3.2 `shift_assignment` §2.9 — schema_v **2 → 3**

> CR-092 ระบุ "v1 → v2" แต่ schema.md เป็น v2 อยู่แล้วและมี `duty_window` / `check_in_at` / `check_out_at` / `check_in_by` ครบแล้ว — ของใหม่จริงมีเท่านี้

| Field | Before | After |
| --- | --- | --- |
| `status` | `enum(assigned, checked_in, done, no_show, cancelled)` | `enum(assigned, standby, checked_in, completed, no_show, cancelled)` — **rename `done` → `completed`** |
| `shift` | `enum(morning, afternoon, night, custom)` เวลามาตรฐาน 4/5/5 ชม. | `enum(morning, afternoon, night, flex, custom)` เวลามาตรฐาน **8 ชม.**: morning 08:00–16:00 · afternoon 16:00–00:00 · night 00:00–08:00 · `flex` = standby ไม่มีหน้าต่างตายตัว |
| `dispatch_status` | — | `enum(dispatched, accepted, declined)\|null` opt |
| `check_in_method` | — | `enum(qr, manual_override)` req default `qr` |
| `check_in_reason` | — | `str\|null` opt — บังคับกรอกเมื่อ `check_in_method = manual_override` |

### 3.3 `job` §2.17 — schema_v **1 → 2**

| Field | Before | After |
| --- | --- | --- |
| `slots_pending` | `int≥0` | **ลบ** (แทนที่ด้วย `slots_dispatched` + `slots_remaining`) |
| `slots_dispatched` | — | `int≥0` req default `0` — เสนอแล้วรอตอบรับ (🟡) |
| `slots_remaining` | — | `int≥0` req — `quota − slots_confirmed − slots_dispatched` (⚪) |
| `status` | `enum(open, almost_full, full, closed, cancelled)` | `enum(draft, open, paused, almost_full, full, closed, cancelled)` |
| `is_urgent` | — | `bool` req default `false` — chip "ด่วนพิเศษ" |

- **invariant:** `slots_confirmed + slots_dispatched + slots_remaining == quota` เสมอ

### 3.4 `job_application` §2.18 — schema_v **1 → 2**

| Field | Before | After |
| --- | --- | --- |
| `status` | `enum(pending, accepted, rejected, cancelled)` | `enum(pending_review, confirmed, rejected, cancelled)` |
| `applicant.national_id` | — | `str\|null` opt |

- CR-092 ตัด `rejected` ทิ้ง — CR นี้ **คงไว้** เพราะ FR-VOL-07 / UI V10 มีการปฏิเสธใบสมัครหลังตรวจวิชาชีพควบคุม
- mapping: `pending` → `pending_review` · `accepted` → `confirmed`

### 3.5 `volunteer_transfer` — doc type ใหม่ · schema_v **1**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `volunteer_id` | str | req | → `volunteer:{ulid}` |
| `from_shelter_code` / `to_shelter_code` | str | req | — |
| `reason` | str\|null | opt | — |
| `status` | `enum(pending, accepted, rejected, cancelled)` | req | default `pending` |
| `requested_by` / `decided_by` | str\|null | req/opt | username |
| `decided_at` | ts\|null | opt | — |

- ใช้ envelope `BaseDoc` มาตรฐาน · **Index:** `(to_shelter_code, status)` · `(volunteer_id, status)`

### 3.6 `_users` — ไม่แก้ schema

- คงนโยบาย CR-092 §1.1.5: ห้ามเพิ่ม application metadata ใน `_users`; ผูกผ่าน `volunteer.user_name`
- `must_change_password` (CR-092 FR-VOL-07.3) **ยังไม่มีในระบบ** — ต้องเก็บนอก `_users`
  > [NEEDS DECISION: เก็บ `must_change_password` ที่ไหน — (ก) doc `user_profile` ใน DB ระบบ (แนะนำ, ไม่แตะ `_users`) หรือ (ข) ยอมเพิ่มใน `_users` แล้ว amend นโยบาย §1.1.5]

---

## 4. Impact

| ชั้น | กระทบ |
| --- | --- |
| Docs | `schema.md` §2.8/2.9/2.17/2.18 + §ใหม่ `volunteer_transfer` · `couchdb-mongodb-sync.md` · `api-contract.md` · `role-permission-matrix.md` §4 · `sitemap.md` §2.6 · `06-A-volunteer.md` T-28/T-29 · CR-092 §1/§5 |
| Frontend | `features/volunteers/**` (ใหม่ทั้ง slice) · `routes/(protected)/back-office/volunteers/**` · `routes/api/back-office/volunteers/**` (grant/revoke, walk-in, override) · `$lib/server/couch-admin.ts` |
| CouchDB | `validate_doc_update` ต่อ `shelter_{code}` · `_security` role membership lifecycle · Mango index ใหม่ |
| Worker | projector `public_jobs` + revoke sweeper (ถ้าเลือก FR-VOL-05R.5 ก) |
| Backend | FastAPI `/public/v1/volunteer/*` + `pnpm openapi:update` |
| Test | unit: quota invariant, duty window ±5m, time collision, controlled skill · e2e: AC-VOL-01..08 (CR-092 §6) + AC ใหม่ §5 |

---

## 5. Acceptance (เพิ่มจาก CR-092 §6)

- [ ] **AC-094-01** — ทุกหน้าหลังบ้านอยู่ใต้ `/back-office/volunteers*`; ไม่มี route `/admin/volunteers/*` ในบิลด์
- [ ] **AC-094-02** — บัญชีอาสา staff-capable ที่ยังไม่เช็คอิน เขียน CouchDB ตรงถูก reject ด้วย `ERR_OUTSIDE_SHIFT_WINDOW` (ทดสอบด้วย HTTP call ตรงไป CouchDB ไม่ผ่าน UI)
- [ ] **AC-094-03** — เช็คเอาต์แล้ว role ถูก revoke ภายใน 1 คำขอถัดไป และการเขียนถูก reject
- [ ] **AC-094-04** — สร้าง job สถานะ `draft` แล้ว **ไม่ปรากฏ** บน public board; เปลี่ยนเป็น `open` แล้วปรากฏภายใน 1 รอบ sync
- [ ] **AC-094-05** — `slots_confirmed + slots_dispatched + slots_remaining == quota` คงจริงหลัง dispatch / accept / decline ทุกกรณี
- [ ] **AC-094-06** — walk-in + ติ๊ก "เช็คอินทันที" สร้าง `volunteer` + `shift_assignment` + `check_in_at` ครบในครั้งเดียว และตัวนับ "ปฏิบัติหน้าที่อยู่ขณะนี้" +1
- [ ] **AC-094-07** — manual override บันทึก actor + เหตุผล และปรากฏใน Audit Trail
- [ ] **AC-094-08** — เลือกทักษะ controlled ตอน walk-in แล้วสถานะเป็น `pending_review` ไม่ใช่ active
- [ ] **AC-094-09** — ตัวนับบน Control Hub ทั้ง 5 ค่า ตรงกับข้อมูลในทั้ง 3 แท็บ (เรียกฟังก์ชัน domain เดียวกัน)

---

## 6. Migration

| Doc type | schema_v | วิธี migrate |
| --- | --- | --- |
| `volunteer` | 1 → 2 | additive — เติม `checked_in=false`, `identity_verified=false`, `source='staff_entry'`, `national_id=null`, `current_shelter_code=null`; generate `volunteer_code` เรียงตาม `created_at` ต่อศูนย์ |
| `shift_assignment` | 2 → 3 | rename ค่า `status: done → completed`; เติม `check_in_method='qr'`, `dispatch_status=null`; **ไม่แปลงเวลา `duty_window` ของแถวเดิม** (แถวเดิมยังใช้เวลาที่บันทึกไว้) — เวลามาตรฐานใหม่ 8 ชม. ใช้กับกะที่สร้างหลัง deploy เท่านั้น |
| `job` | 1 → 2 | `slots_remaining = quota − slots_confirmed`; `slots_dispatched = 0`; ทิ้งค่า `slots_pending` เดิม (ใบสมัครที่ค้างยังนับจาก `job_application.status='pending_review'`); `is_urgent=false` |
| `job_application` | 1 → 2 | `pending → pending_review` · `accepted → confirmed` · `rejected`/`cancelled` คงเดิม |
| `volunteer_transfer` | — | doc type ใหม่ ไม่มีข้อมูลเดิม |

> ทั้ง 4 doc type ยังไม่มี production data (T-28/T-29 ยังไม่ implement) — migration script เป็น safety net สำหรับ seed/dev data เท่านั้น

---

## 7. Open decisions

| ID | คำถาม | อ้างอิง |
| --- | --- | --- |
| D-VOL-REVOKE | กลไก revoke role เมื่อลืมเช็คเอาต์ — worker sweeper ทุก 5 นาที (แนะนำ) หรือตรวจตอน session refresh | FR-VOL-05R.5 |
| D-VOL-TRANSFER-APPROVE | ใครอนุมัติโอนย้ายศูนย์ — ปลายทาง / ต้นทาง / two-phase | FR-VOL-12.3 |
| D-VOL-PWDFLAG | เก็บ `must_change_password` ที่ `user_profile` doc หรือใน `_users` | §3.6 |

---

## 8. Decision log

- **2026-08-26 — proposed:** เจ้าของโครงการเคาะ D-VOL-PATH = back-office, D-VOL-ENFORCE = CouchDB, D-VOL-JOBCRUD = back-office, D-VOL-PUBSYNC = Couch→Mongo และอนุมัติให้ track ผ่านไฟล์ CR ใน `docs/changes/` (Policy §6)
- **รอเคาะ:** สถานะ `approved` + open decisions §7 · FR-VOL-05R เป็น stable core ต้องผ่าน review ก่อน apply
