---
id: CR-095
title: "amend CR-094 — `job.shifts[]` (กะย่อยรายวัน, quota derive) + `volunteer.personnel_type` (อาสา/เจ้าหน้าที่) + skill master list"
status: proposed
date: 2026-08-29
requested_by: เจ้าของโครงการ (ฟอร์ม "ประกาศภารกิจงานอาสาใหม่" 2026-08-27 · ตัวกรอง "บุคลากร" 2026-08-28)
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/changes/CR-094-volunteer-backoffice-v10-reconcile.md — amend §3.1 (`volunteer`) และ §3.3 (`job`)
  - docs/data/schema.md §2.8 `volunteer` · §2.17 `job`
  - schema_v — volunteer 2 → 3 · job 2 → 3
  - docs/plans/volunteer-backoffice/00-foundation.md — ภาคผนวก `job.shifts[]` (ปิด [NEEDS CR])
  - frontend/src/lib/features/volunteers/domain/job.schema.ts · volunteer.schema.ts
  - frontend/src/lib/features/volunteers/domain/shift-batch.ts · skill-master.ts (โมดูลใหม่)
  - frontend/src/lib/features/volunteers/ui/job-form-dialog.svelte · volunteer-filter-bar.svelte · volunteer-manage-dialog.svelte · people-tab.svelte
---

# CR-095 — `job.shifts[]` + `volunteer.personnel_type` (amend CR-094)

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** (1) `job` เก็บ **กะย่อยรายวันหลายแถว** (`shifts[]`) แทน `shift_template` อันเดียว และ `quota` กลายเป็นค่า **derive** จากผลรวมของทุกกะ (2) `volunteer` เพิ่ม `personnel_type` (`volunteer` | `staff`) แยกอาสาสมัครออกจากเจ้าหน้าที่ประจำในตาราง/ตัวกรอง
- **เพื่อใคร/ทำไม:** ฟอร์ม "ประกาศภารกิจงานอาสาใหม่" ที่เจ้าของโครงการส่งมา (2026-08-27) รับกะย่อยหลายแถว แต่ละแถวมีวัน + เวลาเข้า/ออก + จำนวนรับของตัวเอง ซึ่ง `job` schema_v 2 เก็บไม่ได้ · ตัวกรอง "บุคลากร" ในแท็บ 3 (2026-08-28) ต้องแยกอาสา/เจ้าหน้าที่ ซึ่ง `affiliation_tags` บน `_users` (CR-002/CR-041 D-AFFIL) ใช้ไม่ได้เพราะอาสาส่วนใหญ่ไม่มี login
- **dev ต้อง build:** ไม่มีของใหม่ — **CR นี้เป็น record ย้อนหลังของสิ่งที่ implement ไปแล้ว** ตามที่ [`00-foundation.md`](../plans/volunteer-backoffice/00-foundation.md) ภาคผนวกกำกับ `[NEEDS CR]` ไว้
- **กระทบ schema/scope:** bump `job` 2 → 3 · `volunteer` 2 → 3 · ไม่แตะ `shift_assignment` (3) / `job_application` (2) / `volunteer_transfer` (1)

---

## Why

1. **ฟอร์มงานอาสาเก็บหลายกะ แต่ schema เก็บได้กะเดียว** — `job` schema_v 2 มี `shift_template` ก้อนเดียว (`shift_name`/`start_time`/`end_time`/`days[]`) + `quota` ก้อนเดียว งานที่ประกาศครอบคลุมหลายวันโดยแต่ละวันรับคนไม่เท่ากัน (เช่น เสาร์–อาทิตย์รับ 20 วันธรรมดารับ 5) เขียนลง doc ไม่ได้เลย และ `days[]` เป็นชื่อวันในสัปดาห์ซึ่งไม่ผูกกับวันที่จริง จึงคำนวณ KPI รายกะไม่ได้
2. **ตัวกรอง "บุคลากร" ไม่มีฟิลด์รองรับ** — CR-041 D-AFFIL ตัดสินให้ track อาสา vs staff ด้วย `affiliation_tags` บน `_users` แต่ CR-092/CR-094 เปิดทางให้อาสาสมัคร**ไม่มี login** (No-SMS OTP + Digital Pass) ⇒ อาสาส่วนใหญ่ไม่มี `_users` doc ให้ติด tag เลย ตัวกรองในแท็บ 3 จึงต้องอ่านจาก `volunteer` doc เอง
3. **ทั้งสองข้อ implement ลงโค้ดไปแล้วโดยไม่มี CR** — ผิด [change-management.md](../change-management.md) §2 (bump `schema_v` + เปลี่ยนรูป doc ที่ persist) `00-foundation.md` ภาคผนวกกำกับ `[NEEDS CR]` ค้างไว้ตั้งแต่ 2026-08-27 เพราะยังไม่ได้เคาะวิธี track — เจ้าของโครงการเคาะ **2026-08-29 ว่าให้ track เป็นไฟล์ CR** CR นี้จึงเป็นการบันทึกย้อนหลังให้ครบ

---

## 1. Change — `job` schema_v 2 → 3

### 1.1 Field delta

| Field | before (schema_v 2) | after (schema_v 3) |
| --- | --- | --- |
| `shifts` | — | **req** `[{id, date, end_date, start_time, end_time, quota}]` อย่างน้อย 1 แถว |
| `quota` | req, ตั้งเอง | req แต่ **derive** = `sum(shifts[].quota)` — ห้ามตั้งเอง |
| `shift_template` | req | **opt + deprecated** — คงไว้อ่าน doc ที่เขียนตอน schema_v 2 |

**`shifts[]` แต่ละแถว:**

| Field | ชนิด | หมายเหตุ |
| --- | --- | --- |
| `id` | str | คงที่ตลอดอายุแถว — ใช้เป็น key ของรายการที่ลบได้ และให้ `shift_assignment` ชี้กลับได้ในอนาคต |
| `date` | `YYYY-MM-DD` | วันเริ่มกะ (wall-clock Asia/Bangkok) |
| `end_date` | `YYYY-MM-DD` | วันสิ้นสุด — **แยกจาก `date`** เพราะกะข้ามเที่ยงคืนได้ (16:00–00:00, 22:00–06:00) จึง infer จาก `date` อย่างเดียวไม่ได้ |
| `start_time` / `end_time` | `HH:mm` | — |
| `quota` | int>0 | จำนวนรับของกะนั้น |

### 1.2 Invariant (เพิ่มจาก schema_v 2)

> - `quota == sum(shifts[].quota)` เสมอ
> - ต่อแถว: `end_date + end_time > date + start_time`
> - (คงเดิม) `slots_confirmed + slots_dispatched + slots_remaining == quota`

### 1.3 `jobInputSchema.status`

ขยายเป็น `draft` / `open` / `paused` / `full` / `closed` ตามปุ่ม LIFECYCLE STATUS 5 ตัวในดีไซน์
**`almost_full` และ `cancelled` ไม่อยู่ในชุดนี้** — `almost_full` ผลิตจาก `deriveJobStatus` ตามระดับการเติมโควตาเท่านั้น (ถ้าเลือกมือก็จะถูกทับในการ dispatch/accept ครั้งถัดไป) ส่วน `jobStatusSchema` ของ **doc** ยังคง 7 ค่าเดิมตาม schema.md §2.17

### 1.4 KPI รายกะ

FR-VOL-09.4 เปลี่ยนจาก 1 bucket ต่องาน → **1 bucket ต่อกะจริง** (เดิมงานหลายวันยุบเป็นแท่งเดียวจนอ่านกำลังพลรายวันไม่ได้)

### 1.5 Domain modules ใหม่ (มาคู่กับ `shifts[]`)

- **`domain/skill-master.ts`** — master list ทักษะ (`key`/`label`/`description`/`icon`/`controlled`) เป็น SSOT ของทักษะทั้งฟอร์ม job และหน้าลงทะเบียน walk-in · `skills.ts#DEFAULT_CONTROLLED_SKILLS` derive จากที่นี่ ⇒ การ์ดที่ SM ติ๊กกับ gate ที่บังคับ `pending_review` (FR-VOL-10.3) ไม่มีทางไม่ตรงกัน · **ยังเป็น constant ไม่ใช่ master data** — FR-VOL-08.5 ย้ายไปหน้าตั้งค่าในขั้นถัดไป
- **`domain/shift-batch.ts`** — ตัวขยายช่วงวันของ Batch Generator (pure) · เพดาน `MAX_BATCH_SHIFTS = 180` แถวต่อการกด Generate หนึ่งครั้ง และปฏิเสธช่วงยาวเกิน 1 ปี

---

## 2. Change — `volunteer` schema_v 2 → 3

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `personnel_type` | enum(`volunteer`,`staff`) | req | default `volunteer` — ตัวกรอง "บุคลากร" + toggle "ชนิดบุคคล" ในไดอะล็อกจัดการอาสา |

**ความสัมพันธ์กับ `affiliation_tags` (CR-002 / CR-041 D-AFFIL):** `personnel_type` เป็น **domain field บน `volunteer` doc** ใช้จำแนกคนในตารางกำลังพลเท่านั้น — เหมือน `affiliation_tags` ตรงที่ **ไม่ให้สิทธิ์ใด ๆ** สิทธิ์ยังมาจาก RoleKey บน `_users` + time-bound grant (FR-VOL-05R) เท่านั้น `affiliation_tags` ยังใช้ต่อสำหรับ user ที่มี login ทั้งสองไม่ทับกัน (อาสาไม่มี login จะมีแค่ `personnel_type`)

---

## 3. Impact

| ที่ | ผล |
| --- | --- |
| `docs/data/schema.md` §2.17 | ตาราง `job` — `shifts[]`, `shift_template` deprecated, `quota` = derive, invariant + migration (มีอยู่แล้ว — รอบนี้แค่เปลี่ยนคำเตือน "ต้องมี CR" ให้ชี้มาที่ CR-095) |
| `docs/data/schema.md` §2.8 | ตาราง `volunteer` — เพิ่ม `personnel_type`, bump หัวข้อเป็น schema_v 3 + migration |
| `docs/plans/volunteer-backoffice/00-foundation.md` | ภาคผนวก `job.shifts[]` — ปิด `[NEEDS CR]` ชี้มาที่ CR นี้ |
| `frontend/.../domain/job.schema.ts` | `jobShiftSchema`, `totalShiftQuota`, `.refine` quota, `schema_v: z.literal(3)` |
| `frontend/.../domain/volunteer.schema.ts` | `personnelTypeSchema`, `schema_v: z.literal(3)` |
| `frontend/.../domain/shift-batch.ts` · `skill-master.ts` | โมดูลใหม่ + unit test |
| `frontend/.../ui/` | `job-form-dialog.svelte` (Single / Batch Generator), `volunteer-filter-bar.svelte`, `volunteer-manage-dialog.svelte`, `people-tab.svelte` |
| **ไม่กระทบ** | `shift_assignment` (v3), `job_application` (v2), `volunteer_transfer` (v1), worker projector, FastAPI |

---

## 4. Migration

**`job` 2 → 3:** สร้าง `shifts` 1 แถวจาก `shift_template` + `quota` เดิม
`id` = ulid ใหม่ · `start_time`/`end_time` จาก template · `quota` = `quota` เดิม ·
`date` ไม่มีข้อมูลเดิม → ใช้วันที่ของ `created_at` ตามเวลา Asia/Bangkok ·
`end_date` = `date` หรือ `date + 1 วัน` ถ้า `end_time <= start_time` ·
`shift_template` **คงไว้ตามเดิม** (ไม่ลบ)

**`volunteer` 2 → 3:** additive — เติม `personnel_type = 'volunteer'` ให้ทุกแถว

> ยังไม่มี production data ณ วันที่เขียน CR — migration ทั้งสองเป็น safety net สำหรับ seed/dev data เท่านั้น (เหมือน CR-094 §6)

---

## 5. Open — ยังไม่เคาะ

| ID | เรื่อง | สถานะ |
| --- | --- | --- |
| **D-VOL-ALMOSTFULL** | เกณฑ์ `job.status = almost_full` — ข้อเสนอที่ implement ไว้: `full` เมื่อ `slots_remaining === 0` · `almost_full` เมื่อ `slots_remaining <= max(1, ceil(quota × 0.2))` · นอกนั้น `open` (เกณฑ์ 80% ของ `slots_confirmed` แบบเดิมทำให้งาน quota ≤ 4 ข้ามจาก `open` ไป `full` เลย) | **รอเจ้าของโครงการเคาะ** |
| **D-VOL-SHIFTLINK** | `shift_assignment` ควรอ้าง `job.shifts[].id` ไหม (ตอนนี้อ้างแค่ `job_id` + `date`/`shift`) — ถ้าเอา จะ bump `shift_assignment` 3 → 4 | เลื่อน — นอกขอบเขต CR นี้ |
| **D-VOL-TRANSFER-APPROVE** | `volunteer_transfer.shelter_code` ต้นทาง/ปลายทาง (ค้างจาก CR-094 §7) | ยังค้าง — ไม่แตะใน CR นี้ |

---

## Decision log

- 2026-08-27 — implement `job.shifts[]` ตามฟอร์มที่เจ้าของโครงการส่งมา, กำกับ `[NEEDS CR]` ไว้ใน `00-foundation.md`
- 2026-08-28 — implement `volunteer.personnel_type` ตามตัวกรอง "บุคลากร" ในแท็บ 3
- 2026-08-29 — เจ้าของโครงการเคาะให้ track เป็น **ไฟล์ CR** → เปิด CR-095 บันทึกย้อนหลัง + sync `schema.md` · `proposed`
