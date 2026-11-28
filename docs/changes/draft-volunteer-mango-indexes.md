---
id: draft # draft (ตอน proposed) -> เปลี่ยนเป็น CR-NNN เมื่อเจ้าของโครงการ approve
title: Mango index ของงานอาสา (shift_assignment, job_application) สำหรับการแบ่งหน้าจาก DB
status: proposed
updated: 2026-11-27
date: 2026-11-24
requested_by: @mhapong (#1534)
decided_by: รอผู้ approve # [NEEDS DECISION: @Fishcanwalk หรือ @Jackyzaz — ตามบันทึกทีม ผู้ approve CR คือ @Jackyzaz ตั้งแต่ 28/10]
layer: volatile
affects:
  - docs/data/schema.md §7 (แถว `shelter_*` — เพิ่ม index ของ shift_assignment และ job_application)
  - docs/data/schema.md §2.9, §2.18 (บรรทัด `**Index:**` ไม่ตรงกับโค้ดปัจจุบัน — ปรับให้ตรงกับ index ชุดนี้)
  - frontend/src/lib/server/shelter-access-design.ts (index ชุดใหม่ + warm-up selector)
  - frontend/src/lib/server/shelter-access-design.test.ts (ตรวจ warm-up ครบทุก index ใหม่)
  - frontend/src/lib/server/shelters.admin.ts (สร้าง index ตอนสร้างศูนย์ใหม่)
  - frontend/scripts/redeploy-access.ts (สร้าง index ให้ศูนย์ที่มีอยู่)
  - frontend/scripts/seed/registry-shelters.ts (seed)
  - ไม่ bump schema_v (ไม่มี field ใหม่ รูป doc เดิม)
---

# Mango index ของงานอาสาสำหรับการแบ่งหน้าจาก DB

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม Mango index 5 ตัวใน DB `shelter_*` สำหรับ `shift_assignment` และ `job_application`
> - **ทำไม:** แท็บผู้สมัครและตารางกะของงานอาสาโหลดเอกสารทั้งชนิดมากรองใน browser ต้องเปลี่ยนเป็น `_find`
>   พร้อมแบ่งหน้าจาก DB และ `_find` ที่ไม่มี index สแกนทั้ง DB
> - **dev ต้องทำ:** ประกาศ index ใน `shelter-access-design.ts` ให้ทั้งสามเส้นทาง deploy อ่านไปสร้าง, เพิ่ม
>   warm-up ใหม่ใน `redeploy-access.ts` และรันบน staging/production
> - **กระทบ schema/scope:** เพิ่ม index ใน `docs/data/schema.md §7` เท่านั้น ไม่มี field ใหม่ ไม่ bump `schema_v`

---

## Requirements

| ID    | ข้อกำหนด                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1  | DB `shelter_*` ทุกใบต้องมี index ทั้ง 5 ตัวในตาราง Change                                                                                                                                               |
| FR-2  | ศูนย์ที่สร้างใหม่ต้องได้ index ครบตั้งแต่ provisioning (`shelters.admin.ts`) และ seed (`registry-shelters.ts`)                                                                                          |
| FR-3  | ศูนย์ที่มีอยู่แล้วต้องได้ index ครบเมื่อรัน `redeploy-access.ts` การรันซ้ำต้องไม่ error (`POST /_index` ตอบ `exists`)                                                                                   |
| FR-4  | ทุก index ต้องมี warm-up selector (map ใหม่ `VOLUNTEER_MANGO_WARMUP_SELECTORS`) และ `redeploy-access.ts` ต้อง warm-up ครบทุกตัวหลังสร้าง (ลูปใหม่ ต่อจากแบบ `warmUpKioskLookupMangoIndexes` ของ CR-229) |
| FR-4a | > [NEEDS DECISION: `shelters.admin.ts` และ `registry-shelters.ts` ต้อง warm-up หลังสร้างด้วยหรือไม่ — ปัจจุบันสองจุดนี้ไม่มี warm-up และ DB ที่เพิ่งสร้างยังว่าง]                                       |
| FR-5  | ชื่อ index ต้องขึ้นต้นด้วย `volunteer-` ไม่ชนกับชื่อ index เดิม                                                                                                                                         |
| FR-6  | ไม่ลบหรือเปลี่ยน index เดิมของ DB                                                                                                                                                                       |

## Why

แท็บผู้สมัครของงานอาสา (`job-applicants-tab.svelte`) เรียก `allByType('job_application')` แล้วกรอง/จัดกลุ่ม
ใน browser ส่วนตารางกะและเช็คอิน (`roster-attendance-tab.svelte`) ก็โหลด `shift_assignment` ทั้งวันก่อนตัดหน้า
ศูนย์ที่มีผู้สมัครและกะจำนวนมากจึงโหลดเอกสารทั้งชนิดทุกครั้งที่เปิดหน้า (ติดตามใน #1534)

การย้ายไปใช้ Mango `_find` พร้อม `bookmark` ทำให้แบ่งหน้าจาก DB ได้ แต่ `_find` ที่ field ของ selector ไม่มี index
รองรับ CouchDB จะอ่านเอกสารทั้ง DB (ทดสอบบน dev ก่อนสร้าง index: `No matching index found … documents examined is
high`) การแบ่งหน้าจึงไม่เร็วขึ้นจนกว่าจะมี index

## Change

เพิ่ม index ใน DB `shelter_*` (ชนิด `json`):

| ชื่อ                                    | fields                     | ใช้กับ                                                       |
| --------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| `volunteer-assignment-type-date-status` | `type`, `date`, `status`   | ตารางกะและเช็คอิน: กรองตามวันที่ + สถานะ, นับต่อสถานะ (tile) |
| `volunteer-assignment-type-date-shift`  | `type`, `date`, `shift`    | ตารางกะและเช็คอิน: กรองตามวันที่ + ช่วงกะ                    |
| `volunteer-assignment-type-job`         | `type`, `job_id`           | รายการ assignment ของงานหนึ่ง                                |
| `volunteer-application-type-job-status` | `type`, `job_id`, `status` | แท็บผู้สมัคร: กรองตามสถานะ, นับต่อสถานะ                      |
| `volunteer-application-type-job`        | `type`, `job_id`           | แท็บผู้สมัคร: ใบสมัครทั้งหมดของงานหนึ่ง                      |

กลไกสร้าง index ใช้ของเดิม: ประกาศเป็นรายการใน `shelter-access-design.ts` (คู่กับ `KIOSK_LOOKUP_MANGO_INDEXES`) แล้วให้
`shelters.admin.ts`, `redeploy-access.ts`, `registry-shelters.ts` อ่านไปสร้าง ส่วน warm-up เป็นงานใหม่: map
`VOLUNTEER_MANGO_WARMUP_SELECTORS` + ลูปใน `redeploy-access.ts` (warm-up เดิมวนเฉพาะ `KIOSK_LOOKUP_MANGO_INDEXES`)

> [NEEDS DECISION: `ddoc` ของแต่ละ index — ถ้าไม่ระบุ CouchDB ตั้งชื่อ ddoc เป็น hash ทำให้ rollback ตาม Migration resolve ไม่ได้ และ index ที่สร้างมือบน dev อาจซ้ำกับที่โค้ดสร้าง]
>
> [NEEDS DECISION: selector/sort ที่แต่ละหน้าใช้ต่อ index — Mango sort ต้องตรง field order ของ index จึงควรล็อกตัวอย่าง query ก่อนอนุมัติ]

## Acceptance

- `_find` ของแท็บผู้สมัครและตารางกะทุกแบบที่ใช้ index ใหม่ไม่ตอบ `No matching index found`
- `shelter-access-design.test.ts` ผ่าน: warm-up selector ครบทุก index ใหม่
- รัน `redeploy-access.ts` ซ้ำบนศูนย์เดิมแล้ว exit 0 (`POST /_index` ตอบ `exists`)
- DB `shelter_*` ใหม่ที่สร้างผ่าน `shelters.admin.ts` มี index ครบ 5 ตัว

## Impact

- **Doc:** `docs/data/schema.md §7` แถว `shelter_*` เพิ่มรายการ index ข้างต้น และปรับบรรทัด `**Index:**` ใน §2.9, §2.18 ให้ตรงกัน (แก้ใน PR โค้ด ตามแบบ CR-229)
- **Code:** `shelter-access-design.ts` (รายการใหม่ + warm-up), `shelters.admin.ts`, `redeploy-access.ts`, `seed/registry-shelters.ts`
- **Test:** เทสต์ใน `shelter-access-design.test.ts` ต้องตรวจว่า warm-up selector ครบทุก index ใหม่ (เหมือน CR-229)
- **Runtime:** ศูนย์ละ 5 index เพิ่ม ใช้ดิสก์และเวลาเขียนเพิ่มเล็กน้อย การสร้างครั้งแรกบน DB ใหญ่ใช้เวลา
  (warm-up ทำให้เสร็จก่อนผู้ใช้เข้ามา)
- **ไม่กระทบ:** รูป doc, `schema_v`, `validate_doc_update`, สิทธิ์, UI

## Migration

- `schema_v`: ไม่ bump
- ศูนย์ที่มีอยู่: รัน `redeploy-access.ts` ต่อศูนย์ที่ staging/production `POST /_index` ซ้ำได้ ถ้ามีแล้วตอบ `exists`
- Dev: สร้างด้วยมือบน CouchDB ของ dev แล้ว (10 DB) ชื่อและ fields ตรงกับตาราง Change
- Rollback: `DELETE /{db}/_index/_design/{ddoc}/json/{name}` ถ้าไม่มีโค้ดใช้ index ลบได้โดยไม่กระทบข้อมูล

## Decision log

- 2026-11-24 — proposed (จากงานแบ่งหน้าแท็บผู้สมัครและตารางกะจาก DB, #1534)
- 2026-11-27 — แก้ตาม review: warm-up เป็นงานใหม่, เพิ่ม Acceptance, `affects` ครบ, ทำเครื่องหมายประเด็นที่รอเจ้าของตัดสิน
