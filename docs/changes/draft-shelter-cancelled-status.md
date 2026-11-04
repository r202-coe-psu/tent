---
id: draft
title: Shelter operation_status `cancelled` — ซ่อนศูนย์จาก public plane ทั้งหมด
status: draft
date: 2026-10-19
requested_by: Dev Team B feedback หน้างาน (จัดการศูนย์อพยพ ข้อ 9.1) — GitHub #652
decided_by:
layer: volatile
affects:
  - docs/data/schema.md §3.1 shelter `operation_status` (enum +`cancelled`) · §9.1 `public_shelters`
  - no schema_v bump (additive enum value; doc เดิมยัง valid)
  - worker PROJECTION_VERSION 4 → 5 (worker/src/worker/projection_version.py)
  - worker/src/worker/projectors/shelter.py · couch/processor.py · couch/bootstrap.py · mongo/shelter.py · mongo/job.py
  - frontend/src/lib/features/shelters/domain/schema.ts (`operationStatusSchema`, `isShelterCancelled`, `isShelterBookable`)
  - frontend/src/lib/features/shelters/ui/basic-info-section.svelte · shelter-form-page.svelte
  - frontend/src/lib/features/system-overview/ui/** · referrals/ui/shelter-combobox.svelte · lib/server/system-overview
  - frontend BFF /api/v1/shelters · /api/v1/shelters/{code}/risk (+ /public/v1 alias) · /api/public/v1/transparency/shelters · /api/public/v1/config/shelter-policy
---

# draft-shelter-cancelled-status — สถานะ「ยกเลิกศูนย์」

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** shelter `operation_status` เพิ่มค่า `cancelled` (ศูนย์ที่สร้างผิด / ไม่เคยเปิดใช้งาน)
> - **ผล:** ศูนย์ `cancelled` **ไม่ปรากฏใน public plane ทุกหน้าและ external API** และรับจอง/ลงทะเบียนล่วงหน้าไม่ได้; ย้อนกลับเป็นสถานะอื่นได้
> - **build:** worker ลบ projection ทั้งหมดของศูนย์ (ไม่ต้อง filter ราย endpoint ใน FastAPI) + BFF ที่อ่าน registry ตรงกรองเอง + UI ยืนยันก่อนตั้งสถานะ
> - **กระทบ:** schema.md enum (ไม่ bump `schema_v`) · worker `PROJECTION_VERSION` 4→5

---

## Requirements

**Domain / data**

- FR-1 — `operationStatusSchema` = `standby | active | full_capacity | closed | cancelled`.
- FR-2 — `cancelled` เปลี่ยนไป/กลับจากสถานะอื่นได้ทุกทาง (ไม่ใช่ terminal state).
- FR-3 — `isShelterBookable()` คืน `false` เมื่อ `cancelled` (เหมือน `closed`) — ครอบคลุม BFF public registrations + photos และ residence-match.

**Worker (CouchDB → Mongo)**

- FR-4 — `project_shelter()` คืน `("delete", {"_id": code})` เมื่อ `cancelled`; caller ลบแถว `public_shelters` แล้วเรียก `delete_{persons,occupants,needs,stocks,jobs}_for_shelter(code)` ลบ `public_persons`, `shelter_occupants`, `public_needs`, `shelter_stocks`, `public_jobs` ของศูนย์นั้น.
- FR-5 — `is_shelter_open()` คืน `false` เมื่อ `cancelled` → bootstrap ไม่ scan DB ของศูนย์ และ listener ของ `shelter_{code}` ถูกหยุดในรอบ reconcile ถัดไป.
- FR-6 — change จาก DB `shelter_{code}` ที่ไม่มีแถว `public_shelters` (= cancelled) ต้องไม่ project อะไร แต่ยัง save checkpoint.
- FR-7 — เมื่อ registry shelter upsert แล้ว **ก่อนหน้านี้ไม่มีแถว** `public_shelters` (ย้อนจาก cancelled หรือศูนย์ใหม่) ให้ rescan DB `shelter_{code}` ด้วย `bootstrap_database` (ถ้า DB มีอยู่).
- FR-8 — bump `PROJECTION_VERSION` 4 → 5.
- ไม่ลบ: `public_job_applications`, `public_shift_assignments`, `public_volunteers`, `public_donations` — อ่านได้เฉพาะเจ้าของผ่าน phone hash / tracking token ไม่ถูก list สาธารณะ.

**FastAPI (public / external)**

- FR-9 — ไม่ต้องแก้: ทุก endpoint (`/public/v1/shelters`, needs, transparency, occupants, `/external/v1/*`, bookings, donations, volunteer jobs) อ่านจาก collection ที่ถูกลบแล้ว → ศูนย์ cancelled = not found. Booking (`thirdparty_bookings`) ได้ `404 location_not_found`; donation/volunteer apply ถูกปฏิเสธเพราะไม่มี `PublicShelter` / `PublicJob`.

**BFF ที่อ่าน registry CouchDB ตรง**

- FR-10 — `GET /api/v1/shelters` และ `GET /api/public/v1/transparency/shelters` ตัดศูนย์ `cancelled` ออกจาก list.
- FR-11 — `GET /api/v1/shelters/{code}/risk` (+ alias `/public/v1/...`) และ `GET /api/public/v1/config/shelter-policy` ตอบ 404 เหมือนไม่พบศูนย์.

**Staff UI**

- FR-12 — ฟอร์มศูนย์มีตัวเลือก「ยกเลิกศูนย์ (Cancelled)」; เลือกแล้วต้องผ่าน AlertDialog ยืนยันก่อนตั้งค่า (ยกเลิก dialog = สถานะเดิม). Badge หัวฟอร์มแสดง「ยกเลิกศูนย์」.
- FR-13 — System overview: label + ตัวกรองสถานะรองรับ `cancelled`; `sites_open_with_present` ไม่นับ `cancelled`.
- FR-14 — Referral shelter picker ไม่เสนอศูนย์ `cancelled`.

## Acceptance

- [ ] ตั้งศูนย์เป็น `cancelled` → ไม่ปรากฏในหน้า public ทุกหน้า (ค้นหาศูนย์, needs, transparency, ค้นหาผู้พักพิง, งานอาสา) และ external API (locations, occupancy, stock, occupants, booking 404).
- [ ] เปลี่ยนกลับเป็น `standby`/`active` → ศูนย์และข้อมูลราย shelter กลับมาใน public หลัง worker ประมวลผล.
- [ ] จอง/ลงทะเบียนล่วงหน้าเข้าศูนย์ `cancelled` ไม่ได้ (BFF + partner booking).
- [ ] Tests: worker (projector, processor gate/delete/rescan, mongo `delete_jobs_for_shelter`) · frontend domain (`isShelterBookable`, `isShelterCancelled`, enum) · BFF shelter-policy 404.

## Why

ศูนย์ที่สร้างผิดหรือไม่เคยเปิดใช้ ถ้าตั้ง `closed` ยังแสดงใน public เป็น「ปิด」 ทำให้ประชาชนสับสน. `closed` ต้องคงแถวไว้ตาม partner ODT "Soft Delete / State Separation" สำหรับศูนย์จริงที่ปิดแล้ว — จึงแยกเป็นสถานะใหม่แทนการเปลี่ยนความหมายของ `closed`.


## Migration

- CouchDB: ไม่มี — enum กว้างขึ้น, doc เดิมยัง valid, ไม่ bump `schema_v`.
- Mongo: `PROJECTION_VERSION` 5 → worker full bootstrap ครั้งเดียวหลัง deploy (ยังไม่มีศูนย์ `cancelled` อยู่ก่อน จึงไม่มีข้อมูลต้องลบ).
