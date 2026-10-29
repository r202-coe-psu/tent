---
id: draft
title: ยืนยันการเข้างานหลังกะจบ (มา / ขาด) และ worker ตั้ง `no_show` อัตโนมัติหลังกะจบ 24 ชั่วโมง
status: proposed
date: 2026-10-29
requested_by: "#885 (คำตอบ @net-lynx 2026-10-26 · ผู้รับงาน @Mhapong)"
decided_by: รอ approve (@Jackyzaz)
layer: volatile
affects:
  - docs/data/schema.md §2.9 shift_assignment (field `no_show_at` / `no_show_by`, ตาราง transition, enum `status` เติม `standby`)
  - schema_v `shift_assignment` 5 → 6 (เฉพาะเมื่อ D3 ใช้ค่าเสนอ)
  - docs/changes/06-A-volunteer/CR-104-volunteer-backoffice-and-user-management-v10.md §3.5 (Manual No-Show) · AC-104-06
  - docs/changes/06-A-volunteer/CR-207-applicant-tab-filters-and-counts.md FR-1, FR-2
  - docs/features/volunteer-job-board-flow.md §4.4 (state machine — Shift assignment)
  - docs/task-breakdown/06-A-volunteer.md T-29 DoD (บรรทัด "การจัดการ No-Show")
  - frontend/src/lib/features/volunteers/domain/applicant-attendance.ts (`awaitingAttendanceConfirmation`, ค่าคงที่ 30 นาที / 24 ชม.)
  - frontend/src/lib/features/volunteers/domain/applicant-filter.ts (`bucketOf`, ตัวเลือก "ขาดปฏิบัติงาน")
  - frontend/src/lib/features/volunteers/domain/shift-assignment.schema.ts (field ใหม่, `schema_v` 6, builder "มา" ย้อนหลัง / "ขาด")
  - frontend/src/lib/features/volunteers/data/volunteer.repository.ts + shift-assignment.remote.ts (method `confirmAttended`, `markNoShow`)
  - frontend/src/lib/features/volunteers/application/queries.ts (mutation ทีละคน / หลายคน)
  - frontend/src/lib/features/volunteers/ui/roster-attendance-tab.svelte, roster-row.svelte (รายการรอยืนยัน + ปุ่ม มา / ขาด)
  - worker/src/worker/retention/job.py (`run_retention_once` เรียก sweep ใหม่)
  - worker/src/worker/volunteer_attendance.py (ใหม่ — ชื่อเสนอ, sweep `no_show`)
  - worker/tests/test_shift_no_show_sweep.py (ใหม่)
  - ไม่ bump `PROJECTION_VERSION` (projector ไม่อ่าน field ใหม่)
---

# ยืนยันการเข้างานหลังกะจบ และตั้ง `no_show` อัตโนมัติ

> **สรุป (TL;DR):**
>
> - **ขั้นที่ 1:** กะที่ยังไม่เช็คอิน (ไม่ใช่ `flex`) และจบไปแล้ว ≥ 30 นาที ขึ้นรายการ "รอยืนยันการเข้างาน" ในแท็บ "ตารางกะและเช็คอิน" — SA / SM / VC กด **มา** (→ `completed` ย้อนหลังด้วยเวลา `duty_window`, `manual_override` + เหตุผล) หรือ **ขาด** (→ `no_show`) ทีละคนหรือหลายคน
> - **ขั้นที่ 2:** ครบ 24 ชม. หลังกะจบโดยไม่มีใครยืนยัน worker (รอบ retention ทุก 5 นาที) ตั้ง `no_show` ให้ — idempotent, ชนกับเจ้าหน้าที่แล้วเจ้าหน้าที่ชนะ; `no_show` แก้กลับเป็น "มา" ได้
> - **dev build:** predicate กลาง 1 ตัว (TS + Python), repo method 2 ตัว, UI รายการรอยืนยัน, sweep ใน worker — เป็นผู้เขียน `no_show` รายแรกของระบบ
> - **schema:** เสนอเพิ่ม `no_show_at` / `no_show_by` (`shift_assignment` schema_v 5 → 6, additive) · แก้ CR-104 §3.5, CR-207 FR-1/FR-2 · มี 7 ข้อ `[NEEDS DECISION]` (D1–D7)

---

## Why

- `shift_assignment` ที่ไม่ได้เช็คอินค้างเป็น `assigned` / `standby` ตลอดไป ตัวเลขการเข้างานและประวัติจิตอาสาไม่ตรงความจริง
- ไม่มีโค้ดส่วนไหนเขียน `no_show` — มีแค่ enum กับป้าย "ขาดปฏิบัติงาน"; ปุ่ม Mark No-Show ของ CR-104 §3.5 ไม่เคยถูก implement
- @net-lynx ตอบ #885 (2026-10-26): ทำแบบสองขั้น — เจ้าหน้าที่ยืนยันก่อน แล้ว worker ตัดสินเมื่อครบ 24 ชม.
  - 24 ชม. ใช้กติกาเดียวได้ทุกกะ (รวมกะข้ามเที่ยงคืน) และเผื่อเวลากรอกการเช็คอินด้วยบัตรแทนย้อนหลัง (#880 / #952)
  - sweep อยู่ใน worker ไม่ทำเป็น HTTP endpoint — route cron เดิมไม่มี auth และไม่มีอะไรเรียก (บทเรียนเดียวกับ `worker/src/worker/quota/expiry.py`)
- CR-207 (approved 2026-10-28) ทำเฉพาะการแสดงผล "รอยืนยันการเข้างาน" ในแท็บผู้สมัคร และยกขั้นที่ 1 (ปุ่ม) กับขั้นที่ 2 (worker) มาไว้ที่ CR ของ #885
- **พบจากโค้ด (ที่มาของ D1):** การอนุมัติใบสมัคร (`JobApplicationRemoteRepository#assignConfirmed` → `ShiftAssignmentRemoteRepository#assign`), การมอบหมายโดยเจ้าหน้าที่ และการรับใบสมัคร public ทันที (`public-application.ts#makeConfirmedAssignment`) เขียน `status: 'standby'` ให้ **ทุกกะ** ไม่ใช่เฉพาะ `flex` — `awaitingAttendanceConfirmation` ใน PR #968 ที่ดูเฉพาะ `assigned` จึงแทบไม่ขึ้นเลยกับข้อมูลจริง

## Change

### นิยาม

- **กะที่รอยืนยัน (P)** — `shift_assignment` ที่ครบทุกข้อ:
  1. `status` ∈ {`assigned`, `standby`} (D1)
  2. `shift` ≠ `flex`
  3. `dispatch_status` ≠ `dispatched` (ข้อเสนองานแบบเก่าที่ยังไม่ตอบรับ — D1)
  4. `duty_window.end_ts` parse ได้
  5. `now ≥ duty_window.end_ts + 30 นาที`
- **กะที่ worker ตั้งขาด (Q)** — P และ `now ≥ duty_window.end_ts + 24 ชม.` (และเข้าเงื่อนไข cutoff ของ D6)

### Transition ที่ CR นี้เพิ่ม

| จาก                                | ไป          | ใครทำ                 | เงื่อนไข                            |
| ---------------------------------- | ----------- | --------------------- | ----------------------------------- |
| `assigned` / `standby`             | `completed` | SA / SM / VC กด "มา"  | เข้า P                              |
| `assigned` / `standby`             | `no_show`   | SA / SM / VC กด "ขาด" | เข้า P                              |
| `assigned` / `standby`             | `no_show`   | worker                | เข้า Q                              |
| `no_show` (เจ้าหน้าที่หรือ worker) | `completed` | SA / SM / VC กด "มา"  | ไม่จำกัดเวลา (D5)                   |
| `completed`                        | `no_show`   | —                     | ไม่อนุญาต (D5)                      |
| `checked_in` (ลืมเช็คเอาต์)        | —           | —                     | ไม่อยู่ใน CR นี้ — ใช้เช็คเอาต์เดิม |

### FR — นิยามและค่าคงที่

- **FR-1** — predicate P / Q มีที่เดียวใน `volunteers/domain` (`awaitingAttendanceConfirmation`, `autoNoShowDue`); แท็บตารางกะ ตัวกรองแท็บผู้สมัคร และ guard ใน repository เรียกตัวเดียวกัน
- **FR-2** — ค่าคงที่ทั้งระบบ ไม่มีหน้าตั้งค่า: `ATTENDANCE_CONFIRM_AFTER_MINUTES = 30`, `AUTO_NO_SHOW_AFTER_HOURS = 24`
- **FR-3** — worker ถือค่าคงที่ชุดเดียวกันใน Python; test ทั้งสองฝั่งใช้ชุดกรณีขอบเดียวกัน (29/30 นาที, 23:59/24:00 ชม., `flex`, `standby`, `dispatched`, `end_ts` เสีย)
- **FR-4** — กะ `flex` ไม่เข้าทั้งสองขั้น (ไม่มีเวลาจบกะที่มีความหมาย และ standby ไม่ได้แปลว่าต้องมา)

### FR — ขั้นที่ 1: รายการรอยืนยันในแท็บ "ตารางกะและเช็คอิน" (`/back-office/volunteers`)

- **FR-5** — แสดงส่วน "รอยืนยันการเข้างาน (n)" รวมทุกกะที่เข้า P ของศูนย์ที่เลือก **ไม่ขึ้นกับตัวกรองวันที่** ของ roster (กะที่จบเมื่อวานยังขึ้นจนกว่าจะถูกยืนยันหรือ worker ตั้งขาด)
- **FR-6** — คำนวณตอนแสดงผลจาก `now` ที่ tick ทุกนาที (เหมือน CR-207 D3); ไม่เขียน DB จนกว่าจะกดยืนยัน
- **FR-7** — แต่ละแถวแสดง ชื่อจิตอาสา · งาน / กะ · `duty_window` · เวลาที่ระบบจะตั้งขาดอัตโนมัติ (`end_ts + 24 ชม.`)
- **FR-8** — ปุ่มแสดงเฉพาะ `system_admin`, `shelter_manager`, `volunteer_coordinator` ของศูนย์นั้น (`canAccessVolunteerBackoffice`); role อื่นเห็นรายการแต่ไม่เห็นปุ่ม
- **FR-9** — เลือกได้ทีละแถวหรือหลายแถว (checkbox + เลือกทั้งหมด) แล้วกด **มา** หรือ **ขาด**
- **FR-10 "มา" (ย้อนหลัง — D2)** — เขียนใน PUT เดียว:

  | field                                  | ค่า                          |
  | -------------------------------------- | ---------------------------- |
  | `status`                               | `completed`                  |
  | `check_in_at`                          | `duty_window.start_ts`       |
  | `check_out_at`                         | `duty_window.end_ts`         |
  | `check_in_by` / `check_out_by`         | username ผู้กด               |
  | `check_in_method` / `check_out_method` | `manual_override`            |
  | `check_in_reason` / `check_out_reason` | เหตุผลที่กรอก (ข้อความเดียว) |
  | `schema_v` / `updated_at`              | 6 (ตาม D3) / เวลาที่กด       |
  - เหตุผลบังคับ (ไม่ว่าง หลัง trim); กดหลายแถว → เหตุผลเดียวใช้กับทุกแถว

- **FR-11** — "มา" ไม่แก้ `volunteer.checked_in`, ไม่เพิ่มบทบาทชั่วคราวตามเวลากะ (CR-104 §2.4) และไม่เขียนตัวนับโควตาของ `job` (D4)
- **FR-12 "ขาด"** — เขียน `status: no_show`, `no_show_at` = เวลาที่กด, `no_show_by` = username ผู้กด (D3), `updated_at`; ไม่ต้องกรอกเหตุผล; ไม่เขียน `job` (D4)
- **FR-13** — repository (data layer) อ่านเอกสารล่าสุดและตรวจเงื่อนไขก่อนเขียนทุกครั้ง: "ขาด" ต้องเข้า P; "มา" ต้องเข้า P หรือเป็น `no_show`; ไม่เข้า → ปฏิเสธแถวนั้นพร้อมสถานะปัจจุบัน ไม่เขียนทับ
- **FR-14** — กดหลายแถว: เขียนทีละแถวตามลำดับ แถวที่ล้มไม่หยุดแถวที่เหลือ แล้วสรุป "สำเร็จ n · ไม่สำเร็จ m" พร้อมเหตุผลรายแถว (รูปแบบเดียวกับ "อนุมัติทุกกะ" ของ CR-180 FR-12/FR-13)
- **FR-15** — `409 conflict` ระหว่างเขียน → อ่านใหม่ ตรวจ FR-13 ใหม่ 1 ครั้ง; ยังเข้าเงื่อนไขค่อยเขียน ไม่เข้าก็รายงานเป็นแถวไม่สำเร็จ

### FR — แก้ย้อนหลัง

- **FR-16** — แถว `no_show` (ทั้งที่เจ้าหน้าที่และ worker ตั้ง) ในแท็บตารางกะมีปุ่ม "แก้เป็นมาปฏิบัติงาน" ใช้การเขียนเดียวกับ FR-10 ไม่จำกัดเวลา (D5)
- **FR-17** — เมื่อแก้เป็น "มา" ให้คง `no_show_at` / `no_show_by` ไว้เป็นประวัติ; สถานะที่แสดงอ่านจาก `status` เท่านั้น
- **FR-18** — `checkIn` / `checkOut` เดิมไม่เปลี่ยน

### FR — ขั้นที่ 2: worker ตั้ง `no_show`

- **FR-19** — เพิ่ม sweep ใน worker เรียกจาก `run_retention_once` ทุกรอบ (`RETENTION_INTERVAL_SECONDS = 300`) เมื่อมี CouchDB client ต่อจาก sweep เดิม; ไม่มี HTTP endpoint
- **FR-20** — วนทุกศูนย์จาก `list_all_shelter_codes` (รวมศูนย์ที่ปิดแล้ว) ข้าม DB ที่ไม่มี; เลือก `shift_assignment` ที่เข้า Q
  - ต้องครอบคลุมทุกเอกสารที่เข้าเงื่อนไข ห้ามถูกตัดที่ `limit` ของ Mango — ใช้ `_find` บน index `(status)` แบบแบ่งหน้า หรือ `iter_all_docs` แบบ `quota/expiry.py`
  - รวบรวมรายการก่อนแล้วค่อยเขียน (ไม่เขียนระหว่างแบ่งหน้า)
- **FR-21** — เขียน `status: no_show`, `no_show_at` = เวลารอบ sweep, `no_show_by: 'system'`, `updated_at`, `schema_v: 6` (D3); field อื่นคงเดิม
- **FR-22 idempotent** — ตรวจ Q กับเอกสารที่อ่านมา; รันซ้ำไม่เขียนซ้ำเพราะ `status` ไม่ใช่ `assigned` / `standby` แล้ว
- **FR-23 ชนกับเจ้าหน้าที่** — PUT พร้อม `_rev` ที่อ่านมา; `409` → ข้าม (เจ้าหน้าที่ชนะ) แล้วประเมินใหม่รอบถัดไป
- **FR-24** — `end_ts` parse ไม่ได้ → ข้าม + log warning; เอกสาร / ศูนย์ที่ error → log exception แล้วทำรายการถัดไปต่อ
- **FR-25** — sweep ไม่เขียน `job`, `volunteer`, `_users` และไม่สร้าง `audit` doc (ผู้กระทำอยู่ใน `no_show_by` — D3)
- **FR-26** — log จำนวนที่ตั้งขาดต่อ DB ต่อรอบ (ระดับ info เมื่อ > 0)
- **FR-27 cutoff (D6)** — worker ตั้งขาดเฉพาะกะที่ `duty_window.end_ts ≥ AUTO_NO_SHOW_EFFECTIVE_FROM` (ค่าคงที่ = วัน deploy); กะเก่ากว่านั้นที่ยังเข้า P อยู่ในรายการรอยืนยันให้เจ้าหน้าที่จัดการเอง

### FR — แท็บผู้สมัคร (แก้ CR-207)

- **FR-28** — "รอยืนยันการเข้างาน" ของแท็บผู้สมัครใช้ P (รวม `standby` ที่ไม่ใช่ `flex`) แทน `status = assigned`
- **FR-29** — ตัวกรองสถานะการเข้างานเพิ่มตัวเลือก **"ขาดปฏิบัติงาน"** (`no_show`) (D7)
- **FR-30** — แท็บผู้สมัครยังแสดงผลอย่างเดียว ไม่มีปุ่ม มา / ขาด (D7)

### Before → after ของเอกสารที่ถูกแก้

| เอกสาร / บรรทัด                                  | ก่อน                                                                                                                                | หลัง                                                                                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CR-104 §3.5 "เจ้าหน้าที่กดยกเลิกหน้างาน" ข้อ 1   | เลยเวลากะแล้วอาสาไม่มา เจ้าหน้าที่คลิกแถบของอาสาในทำเนียบกะ เลือก `[ ⚠️ ไม่มาปฏิบัติงาน (Mark No-Show) ]` หรือ `[ ❌ ยกเลิกกะงาน ]` | `[ ❌ ยกเลิกกะงาน ]` คงเดิม · ไม่มาปฏิบัติงาน: กะที่จบ ≥ 30 นาทีขึ้นรายการ "รอยืนยันการเข้างาน" ในแท็บตารางกะ กด มา / ขาด ทีละคนหรือหลายคน; ครบ 24 ชม. worker ตั้ง `no_show` (CR นี้) |
| CR-104 §3.5 ข้อ 2                                | ระบบเปลี่ยน `shift_assignment` เป็น `no_show` หรือ `cancelled`                                                                      | `cancelled` คงเดิม · `no_show` เขียนตาม FR-12 / FR-21 พร้อม `no_show_at` / `no_show_by`                                                                                               |
| CR-104 §3.5 ข้อ 3                                | โควตาคืนเป็น ⚪ ช่องว่าง ทันที                                                                                                      | `cancelled` คงเดิม · `no_show` ไม่เขียนตัวนับของ `job` ตอนตั้งสถานะ ตัวนับปรับเองเมื่อ `reconcileQuota` ครั้งถัดไป เหมือน `completed` (D4)                                            |
| CR-104 AC-104-06                                 | เจ้าหน้าที่ยกเลิกหรือ Mark No-Show ด้วยมือ และระบบคืนโควตาสีขาวทันที                                                                | ยกเลิกด้วยมือแล้วคืนโควตาทันที (คงเดิม) · ไม่มาปฏิบัติงานตาม AC-1 – AC-11 ของ CR นี้                                                                                                  |
| CR-207 FR-1 ข้อ 1                                | `status = assigned`, ไม่ใช่กะ `flex`, `now ≥ end_ts + 30 นาที`                                                                      | P ของ CR นี้: `status` ∈ {`assigned`, `standby`}, ไม่ใช่ `flex`, `dispatch_status` ≠ `dispatched`, `now ≥ end_ts + 30 นาที` (D1)                                                      |
| CR-207 FR-1 ข้อ 4                                | ขั้นที่ 1 (ปุ่ม) และขั้นที่ 2 (worker) ทำใน #885 และ CR ของ #885                                                                    | ปุ่มอยู่ที่แท็บตารางกะ (FR-5 – FR-15) · worker ตาม FR-19 – FR-27 · แท็บผู้สมัครแสดงผลอย่างเดียว (FR-30)                                                                               |
| CR-207 FR-2 รายการตัวเลือก                       | ยังไม่เช็คอิน / รอยืนยันการเข้างาน / กำลังปฏิบัติงาน / เสร็จสิ้น                                                                    | เพิ่ม "ขาดปฏิบัติงาน" (FR-29, D7)                                                                                                                                                     |
| CR-207 FR-2 ข้อ 2                                | กะ `flex` / `standby` และกะที่ไม่มี `end_ts` อยู่ใน "ยังไม่เช็คอิน" เสมอจนกว่าจะเช็คอิน                                             | กะ `flex` และกะที่ไม่มี `end_ts` อยู่ใน "ยังไม่เช็คอิน" เสมอ · `standby` ที่ไม่ใช่ `flex` ใช้ P (D1)                                                                                  |
| schema.md §2.9 `status`                          | enum(`assigned`,`checked_in`,`completed`,`no_show`,`cancelled`)                                                                     | เติม `standby` ให้ตรง CR-094 และโค้ด (ไม่เปลี่ยนความหมาย) + ตาราง transition ของ CR นี้                                                                                               |
| schema.md §2.9 field                             | ไม่มี                                                                                                                               | `no_show_at` ts\|null opt · `no_show_by` str\|null opt (username หรือ `'system'`) · schema_v 5 → 6 (D3)                                                                               |
| volunteer-job-board-flow.md §4.4                 | `assigned → done / no_show / cancelled`                                                                                             | `assigned`/`standby` → `checked_in` → `completed` · → `completed` (มา ย้อนหลัง) · → `no_show` (เจ้าหน้าที่ / worker) · `no_show` → `completed` (แก้ย้อนหลัง) · → `cancelled`          |
| task-breakdown 06-A T-29 DoD "การจัดการ No-Show" | เจ้าหน้าที่กดยกเลิกหรือระบุคนไม่มาทำงานด้วยมือ คืนโควตาสีขาวทันที                                                                   | ยกเลิกด้วยมือ คืนโควตาทันที · ไม่มา: ยืนยัน มา / ขาด หลังกะจบ 30 นาที + worker `no_show` ที่ 24 ชม. (CR นี้)                                                                          |
| CR-180                                           | —                                                                                                                                   | **ไม่แก้** — กะมอบหมายที่เป็น `no_show` ยังนับ "มอบหมายโดยเจ้าหน้าที่" ตาม CR-207 FR-3 เดิม (นับ "ปฏิเสธ/ยกเลิก" เฉพาะ `cancelled`)                                                   |

### Decisions — `[NEEDS DECISION]` (ค่าเสนอใช้เขียน FR ข้างบน)

- **D1 `[NEEDS DECISION]` กะ `standby` นับเป็นกะที่รอยืนยันไหม** — ค่าเสนอ: นับ ถ้าไม่ใช่ `flex`; ตัด `dispatch_status = dispatched` ออก
  - เหตุผล: ทุก flow หลัก (อนุมัติใบสมัคร, มอบหมายโดยเจ้าหน้าที่, public รับทันที) เขียน `standby` ให้ทุกกะ; ถ้าใช้ `assigned` อย่างเดียวตามคำตอบ #885 ทั้งสองขั้นแทบไม่ทำงาน · "standby ไม่ได้แปลว่าต้องมา" ในคำตอบหมายถึงกะ `flex` ซึ่ง P ตัดออกแล้ว
  - ทางเลือก: `assigned` อย่างเดียว (ตามตัวอักษรของ #885 / CR-207)
- **D2 `[NEEDS DECISION]` "มา" ย้อนหลังบันทึกเวลาอย่างไร** — ค่าเสนอ: ตามข้อเสนอใน #885 → `completed`, เวลาเข้า-ออก = `duty_window.start_ts` / `end_ts`, `manual_override` ทั้งขาเข้าและขาออก, เหตุผลกรอกครั้งเดียวใช้ทั้งสองขา
  - ทางเลือก: ให้เจ้าหน้าที่กรอกเวลาเข้า-ออกจริงเอง / เช็คอินอย่างเดียวแล้วค้าง `checked_in`
- **D3 `[NEEDS DECISION]` บันทึกผู้ตั้ง `no_show` อย่างไร** — ค่าเสนอ: เพิ่ม `no_show_at`, `no_show_by` (`'system'` เมื่อ worker) → `shift_assignment` schema_v 5 → 6 (additive) ตามแบบ `check_out_by` ของ CR-108
  - ทางเลือก: ไม่เพิ่ม field — worker เขียน `audit` doc (§2.12, `action: other`, `_id` คงที่ต่อเอกสาร) และฝั่งเจ้าหน้าที่ไม่มีบันทึกผู้กด → ไม่ bump `schema_v`
- **D4 `[NEEDS DECISION]` `no_show` คืนโควตาไหม** — ค่าเสนอ: ไม่เขียนตัวนับของ `job` ตอนตั้ง `no_show` (กะจบไปแล้ว ที่นั่งใช้ซ้ำไม่ได้) ตัวนับปรับเองตอน `reconcileQuota` ครั้งถัดไป เหมือน `completed` · worker จึงไม่ต้องเขียน `job` แข่งกับ `mutateQuota` ฝั่ง frontend
  - ทางเลือก: เรียก `releaseSlot` ทันทีตาม CR-104 §3.5 เดิม (ทั้งฝั่งเจ้าหน้าที่และ worker)
- **D5 `[NEEDS DECISION]` ขอบเขตการแก้ย้อนหลัง** — ค่าเสนอ: `no_show` → "มา" ได้ไม่จำกัดเวลา; `completed` → `no_show` ไม่ได้
- **D6 `[NEEDS DECISION]` กะเก่าก่อน deploy** — ค่าเสนอ: worker ไม่แตะกะที่จบก่อน `AUTO_NO_SHOW_EFFECTIVE_FROM` (วัน deploy) กะเหล่านั้นอยู่ในรายการรอยืนยันให้เจ้าหน้าที่เคลียร์เอง
  - เหตุผล: ประวัติก่อนมีระบบเช็คอินจริงอาจเป็นคนที่มาแต่ไม่ได้สแกน — ตั้งขาดเป็นชุดใหญ่รอบแรกจะขึ้น "ไม่มาปฏิบัติงาน" ใน portal ของจิตอาสา
  - ทางเลือก: ไม่มี cutoff — รอบแรกตั้งขาดทุกกะเก่าที่เข้า Q
- **D7 `[NEEDS DECISION]` ตำแหน่ง UI** — ค่าเสนอ: ปุ่ม มา / ขาด อยู่แท็บตารางกะเท่านั้น (ตาม #885 "หน้า roster"); แท็บผู้สมัครแสดงผลอย่างเดียว + เพิ่มตัวกรอง "ขาดปฏิบัติงาน"
  - ทางเลือก: มีปุ่มในแท็บผู้สมัครด้วย / ไม่เพิ่มตัวกรอง "ขาดปฏิบัติงาน"

### ไม่อยู่ใน CR นี้

- VDU จำกัด role ที่เขียน `shift_assignment` (แยกตรวจตาม #885)
- บัตรแทน (#952) — ใช้รายการรอยืนยันเป็นจุดกรอกย้อนหลังได้ แต่ทำใน #952
- กะที่ `checked_in` แล้วไม่เช็คเอาต์หลังกะจบ
- หน้าตั้งค่า 30 นาที / 24 ชม.

## Acceptance

- **AC-1:** กะ `standby` (ไม่ใช่ `flex`) ที่อนุมัติจากแท็บผู้สมัครและจบไปแล้ว 31 นาที ขึ้นในรายการรอยืนยันของแท็บตารางกะและตัวกรอง "รอยืนยันการเข้างาน" ของแท็บผู้สมัคร; จบ 29 นาทีไม่ขึ้น; กะ `flex` และ `dispatch_status = dispatched` ไม่ขึ้น
- **AC-2:** กะที่จบเมื่อวาน 22:00 ยังขึ้นในรายการรอยืนยันแม้ตัวกรองวันที่ของ roster เป็นวันนี้
- **AC-3:** กด "มา" พร้อมเหตุผล → `completed`, `check_in_at = start_ts`, `check_out_at = end_ts`, method ทั้งสองขา `manual_override`, เหตุผลทั้งสองขา = ที่กรอก, `*_by` = ผู้กด; `volunteer.checked_in` ไม่เปลี่ยน; ไม่กรอกเหตุผลกดไม่ได้
- **AC-4:** กด "ขาด" → `no_show`, `no_show_at`, `no_show_by` = ผู้กด; ตัวนับโควตาของ `job` ไม่ถูกเขียน
- **AC-5:** เลือก 3 แถว โดย 1 แถวถูกเจ้าหน้าที่อื่นยืนยันไปแล้ว → สำเร็จ 2 แถว อีกแถวแจ้งสถานะปัจจุบัน และไม่ถูกเขียนทับ
- **AC-6:** `registration_staff` เห็นรายการแต่ไม่เห็นปุ่ม มา / ขาด
- **AC-7:** worker — กะที่จบครบ 24 ชม. เป็น `no_show` + `no_show_by: 'system'` ภายในรอบ sweep ถัดไป (≤ 5 นาที); 23:59 ชม. ไม่เปลี่ยน; `flex` / `checked_in` / `completed` / `cancelled` ไม่เปลี่ยน
- **AC-8:** worker รันซ้ำไม่เขียนซ้ำ (`_rev` ไม่เปลี่ยน); PUT ได้ `409` → ข้าม ไม่ error ทั้งรอบ
- **AC-9:** `no_show` ที่ worker ตั้ง → กด "แก้เป็นมาปฏิบัติงาน" ได้ผลตาม AC-3 และ `no_show_at` / `no_show_by` ยังอยู่
- **AC-10:** เอกสารที่ `end_ts` เสียถูกข้าม เอกสารอื่นใน DB เดียวกันยังถูกประมวลผล
- **AC-11:** (D6 ค่าเสนอ) กะที่จบก่อน `AUTO_NO_SHOW_EFFECTIVE_FROM` ไม่ถูก worker แตะ และยังอยู่ในรายการรอยืนยัน
- **AC-12:** หลัง worker ตั้ง `no_show` portal ของจิตอาสาแสดงกะนั้นเป็น "ไม่มาปฏิบัติงาน"
- **DoD (จาก #885):** unit test domain (P / Q, builder มา / ขาด) + worker sweep · `.svelte` ที่แก้ผ่าน `svelte-autofixer` · pre-push ผ่าน · ส่งขั้นตอนทดสอบมือ

## Impact

- **ลำดับ merge:** ต้องตามหลัง PR #968 (`awaitingAttendanceConfirmation`, `bucketOf` ของ CR-207 อยู่ใน PR นั้น)
- **Docs (เมื่อ approve):** schema.md §2.9, CR-104 §3.5 + AC-104-06, CR-207 FR-1 / FR-2, volunteer-job-board-flow.md §4.4, task-breakdown 06-A T-29 ตามตาราง before → after
- **Code:** ตาม `affects:`; worker เป็นผู้เขียน `shift_assignment` ใน CouchDB ด้วย admin client แบบเดียวกับ `quota/expiry.py` — ไม่ใช่ sync path ใหม่
- **Public plane:** change feed → `project_shift_assignment` → `public_shift_assignments` (`no_show` อยู่ใน `PUBLIC_SHIFT_STATUSES` อยู่แล้ว) จิตอาสาเห็น "ไม่มาปฏิบัติงาน" ใน portal · ตัวนับที่นั่งของกะใน Mongo (`worker/mongo/job.py`) ลดลงได้เฉพาะกะที่จบไปแล้ว ไม่กระทบกะที่เปิดรับ · ไม่ bump `PROJECTION_VERSION`
- **ตัวเลข:** ไทล์ "วันนี้" ใน roster (`hub-metrics`) ไม่เปลี่ยนนิยาม; กะที่ยืนยัน "มา" ย้อนหลังนับเป็น `completed` ของวันที่ของกะ
- **Load:** worker เพิ่ม query 1 ชุดต่อศูนย์ต่อ 5 นาที
- **Test:** `applicant-attendance.test.ts`, `applicant-filter.test.ts`, `shift-assignment.schema.test.ts`, `shift-assignment.remote.test.ts`, `worker/tests/test_shift_no_show_sweep.py` (ใหม่), `test_retention.py`

## Migration

- **D3 ค่าเสนอ:** `shift_assignment` schema_v 5 → 6 additive — `no_show_at` / `no_show_by` เป็น opt, อ่านเอกสารเก่าเป็น `null`, ไม่ batch backfill; การเขียนตาม CR นี้ (มา / ขาด / worker) เขียน `schema_v: 6`; writer อื่นคงเดิม; Zod union เพิ่ม `6`
- **D3 ทางเลือก:** ไม่เปลี่ยนรูปร่างเอกสาร ไม่ bump `schema_v`
- **D6 ค่าเสนอ:** ไม่แก้ประวัติก่อน deploy; ทางเลือกไม่มี cutoff = รอบ sweep แรกหลัง deploy ตั้ง `no_show` ให้กะเก่าทั้งหมดที่เข้า Q (ควรนับจำนวนต่อศูนย์ก่อน deploy)

## Decision log

- 2026-10-26 — @net-lynx ตอบ #885: สองขั้น (รายการรอยืนยัน 30 นาที + worker `no_show` 24 ชม.), ค่าคงที่ไม่มีหน้าตั้งค่า, ไม่รวม `flex`, แก้ย้อนหลังได้, sweep ใน worker ไม่ใช่ HTTP endpoint; ข้อเสนอเวลาเช็คอินย้อนหลังให้ผู้รับงานยืนยันใน CR
- 2026-10-27 — #885 เปลี่ยนจากคำถามเป็นงานลงมือทำ
- 2026-10-28 — CR-207 approved: "รอยืนยันการเข้างาน" ในแท็บผู้สมัครแสดงผลอย่างเดียว ยกปุ่มและ worker มาที่ CR นี้
- 2026-10-29 — owner (@Mhapong) เลือก track เป็น draft CR file ใน `docs/changes/`
- 2026-10-29 — proposed (draft) โดยผู้รับงาน; พบจากโค้ดว่า flow หลักเขียน `standby` ให้ทุกกะ (D1); เปิด D1 – D7 รอเคาะ
