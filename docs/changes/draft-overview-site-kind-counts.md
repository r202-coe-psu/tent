---
id: draft
title: หน้าภาพรวมระบบ — การ์ดจำนวนศูนย์แยกตามประเภท (site_kind)
status: proposed
date: 2026-11-23
requested_by: GitHub #1504
decided_by:
layer: volatile
affects:
  - docs/data/api-contract.md (ไม่มี section overview เดิม — ไม่ต้องแก้; สัญญา BFF อยู่ใน Zod `overviewSummarySchema`)
  - no schema_v bump (ไม่แตะ doc ที่ persist; เพิ่มเฉพาะ field ใน response BFF `summary`)
  - frontend/src/lib/server/system-overview/index.ts (`buildOverviewSummary`)
  - frontend/src/lib/features/system-overview/domain/schemas.ts (`overviewSummarySchema`)
  - frontend/src/lib/features/system-overview/ui (การ์ดใหม่ + page)
  - tests: BFF summary, DOM test ของการ์ด
---

# หน้าภาพรวมระบบ — การ์ดจำนวนศูนย์แยกตามประเภท

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** หน้า `/system-management/overview` แสดงแถวการ์ดบนสุด หนึ่งการ์ดต่อ `site_kind` (master `site_kind`) บอกจำนวนศูนย์ของแต่ละประเภท
> - **เพื่อใคร:** SA ที่ต้องเห็นภาพรวมจำนวนศูนย์แยกประเภท (ศูนย์อพยพ / บ้านพี่เลี้ยง / ประเภทที่ SA เพิ่ม) ก่อนดูตารางศูนย์
> - **dev ต้อง build:** `summary` เพิ่ม `sites_by_site_kind` (ไม่รวม External) + `sites_external` + การ์ดใน UI (label th/en จาก master, ประเภท active แสดงแม้เป็น 0, การ์ด「ศูนย์ภายนอก」แยก)
> - **กระทบ:** response BFF `summary` (additive) · ไม่ bump `schema_v` · ไม่แตะ stable core

---

## Requirements

**BFF `GET /api/back-office/overview/summary`**

- FR-1 — response เพิ่ม `sites_by_site_kind: Record<string, number>` (key = `site_kind` code); เพิ่มใน `overviewSummarySchema`.
- FR-2 — นับจากชุดศูนย์เดียวกับ `sites_total` (หลังตัวกรองเดียวกัน) ⇒ ผลรวมค่าทุก key ของ `sites_by_site_kind` + `sites_external` = `sites_total`.
- FR-3 — ศูนย์ที่ไม่มี `site_kind` นับเป็น `evacuation_center` (ตาม CR-067; `migrate()` เติมให้อยู่แล้ว).
- FR-4 — นับทุกสถานะ รวม `closed` และ `cancelled` (ตรงกับ `sites_total` ปัจจุบัน). _ดู NEEDS DECISION D-1_
- FR-5 — ศูนย์ `is_external` **ไม่นับ**ใน `sites_by_site_kind`; นับแยกใน `sites_external: number` (เพิ่มใน `overviewSummarySchema`). _ดู D-2_
- FR-6 — ตัวเลขนับจากทุกศูนย์ตามตัวกรอง ไม่ขึ้นกับ pagination ของตารางศูนย์ (#1502).

**UI**

- FR-7 — แถวการ์ดอยู่บนสุดของหน้า ก่อนการ์ดลงทะเบียนล่วงหน้า / อยู่ในศูนย์; หนึ่งการ์ดต่อประเภท.
- FR-8 — เรียงตามลำดับ master `site_kind`; label จาก master ตามภาษาปัจจุบัน (th/en) ด้วย `formatMasterLabel`.
- FR-9a — การ์ด「ศูนย์ภายนอก」(`sites_external`) แสดงต่อท้ายการ์ดประเภททั้งหมด; แสดงเสมอแม้เป็น 0; label th「ศูนย์ภายนอก」/ en「External shelters」.
- FR-9 — แสดงทุกประเภทที่ `active` แม้จำนวน = 0; ประเภทที่ไม่ active แต่มีศูนย์ > 0 แสดงต่อท้ายพร้อม label ตาม code.
- FR-10 — การ์ดตามตัวกรองด้านบนของหน้า (ค่า `summary` เดียวกับการ์ดอื่น). _ดู D-4_
- FR-11 — การ์ด **ไม่** กดกรองตาราง (คงตัวกรอง "ประเภทศูนย์" ที่มีอยู่). _ดู D-3_

## NEEDS DECISION (ค่าตั้งต้นที่ใช้ implement ถ้าไม่มีคำสั่งเปลี่ยน)

| # | คำถาม | ค่าตั้งต้นใน CR นี้ |
| --- | --- | --- |
| D-1 | นับ `cancelled` / `closed` ด้วยไหม | นับทุกสถานะ (สอดคล้อง `sites_total`) |
| D-2 | ศูนย์ External นับรวมตามประเภทหรือแยกการ์ด | **แยกการ์ด「ศูนย์ภายนอก」** (ตัดสินแล้ว — เจ้าของโครงการสั่ง 2026-11-24) |
| D-3 | กดการ์ดแล้วกรองตารางไหม | ไม่กรอง (รอบแรก) |
| D-4 | การ์ดตามตัวกรองหรือคงที่ทั้งระบบ | ตามตัวกรอง |

## Acceptance

- AC-1 — เปิดหน้าภาพรวม เห็นการ์ดจำนวนศูนย์ต่อประเภทบนสุด; ผลรวมการ์ดประเภททั้งหมด + การ์ดศูนย์ภายนอก = `sites_total`.
- AC-2a — ศูนย์ `is_external` แสดงเฉพาะในการ์ดศูนย์ภายนอก ไม่ซ้ำในการ์ดประเภท.
- AC-2 — ประเภท active ที่ไม่มีศูนย์แสดง 0.
- AC-3 — ศูนย์ไม่มี `site_kind` นับเป็น `evacuation_center`.
- AC-4 — สลับภาษาเป็น en แล้ว label เป็นภาษาอังกฤษ.
- AC-5 — เทสต์ BFF `summary` (นับถูก, default kind) + DOM test ของการ์ดผ่าน.

## Why

#1504: ปัจจุบันหัวหน้ามีเฉพาะการ์ด "ลงทะเบียนล่วงหน้า" / "อยู่ในศูนย์" ไม่เห็นจำนวนศูนย์แยกประเภท ทั้งที่ `site_kind` เป็น master ที่ SA เพิ่มประเภทได้ (CR-198). การนับเป็น rule ใหม่ของ `summary` (สถานะ/External/ตัวกรองที่รวมในตัวเลข) จึงบันทึกเป็น CR.

## Change

- **Before:** `summary` ส่ง `sites_total`, `sites_by_status`; ไม่มีจำนวนตามประเภท.
- **After:** เพิ่ม `sites_by_site_kind` + `sites_external` + การ์ดบนสุดตาม FR-1..11.

## Impact

- BFF `summary` response (additive; client เก่าที่ parse ด้วย Zod ใหม่ต้องมี field นี้ — deploy FE+BFF เป็น bundle เดียวอยู่แล้ว).
- ไม่กระทบ `docs/data/schema.md`, worker, FastAPI, role matrix.
- ลำดับกับ #1502: นับใน `buildOverviewSummary` จากทุกศูนย์ จึงไม่ถูกกระทบ pagination.

## Migration

N/A — ไม่มี doc ที่ persist เปลี่ยน, ไม่ bump `schema_v`.

## Decision log

- 2026-11-23 — proposed (ร่างจาก #1504; D-1..D-4 ใช้ค่าตั้งต้น รอเจ้าของโครงการยืนยัน; ยังไม่รันเลข CR)
- 2026-11-24 — D-2 เปลี่ยน: ศูนย์ External แยกเป็นการ์ดของตัวเอง (`sites_external`) ไม่นับรวมในประเภท
