---
id: draft
title: หน้าภาพรวมระบบ — การ์ดจำนวนศูนย์แยกตามประเภท (site_kind) และกติกานับศูนย์ภายนอก / ปิด / ยกเลิก
status: proposed
date: 2026-11-23
requested_by: Dev Team B GitHub #1504 (+ ข้อสั่งเพิ่มของเจ้าของโครงการ 2026-11-24)
decided_by:
layer: volatile
affects:
  - docs/data/api-contract.md (ไม่มี section overview เดิม — ไม่ต้องแก้; สัญญา BFF อยู่ใน Zod `overviewSummarySchema` / `overviewSiteRowSchema` / `overviewFiltersSchema`)
  - no schema_v bump (ไม่แตะ doc ที่ persist; เพิ่มเฉพาะ field/พารามิเตอร์ใน response/query ของ BFF)
  - frontend/src/lib/server/system-overview/index.ts (`buildOverviewSummary`, `buildOverviewSites`, `matchesShelterGeo`)
  - frontend/src/lib/features/system-overview/domain/schemas.ts (`overviewSummarySchema` +`sites_by_site_kind` +`sites_external`; `overviewSiteRowSchema` +`is_external`; `overviewFiltersSchema` +`external`)
  - frontend/src/lib/features/system-overview/ui (การ์ดประเภทศูนย์, ตารางศูนย์, filter bar, หน้ารายการลงทะเบียนล่วงหน้า)
  - frontend/src/lib/constants/i18n/staff-system-overview.ts
  - tests: BFF summary / sites / filters, DOM test ของการ์ดและตารางศูนย์
---

# หน้าภาพรวมระบบ — การ์ดจำนวนศูนย์แยกตามประเภท และกติกานับศูนย์ภายนอก / ปิด / ยกเลิก

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** (1) หน้า `/system-management/overview` เพิ่มแถวการ์ดบนสุด หนึ่งการ์ดต่อ `site_kind` + การ์ด「ศูนย์ภายนอก」แยก; (2) การ์ด「อยู่ในศูนย์」ไม่นับศูนย์ที่ปิด / ยกเลิก / ภายนอก; (3) ตัวกรอง/ตารางศูนย์รองรับศูนย์ภายนอกและสถานะ「ไม่ทราบสถานะ」
> - **เพื่อใคร:** SA ที่ต้องเห็นภาพรวมจำนวนศูนย์แยกประเภทและตัวเลขการใช้ความจุที่สะท้อนเฉพาะศูนย์ที่เปิดใช้งานในระบบนี้
> - **dev ต้อง build:** `summary` เพิ่ม `sites_by_site_kind` (ไม่รวม External) + `sites_external`, ปรับสูตร `present_total` / `forecast_total` / `avg_*_pct`; แถว `sites` เพิ่ม `is_external`; filter `external=only`; UI ตาม FR-10..FR-19
> - **กระทบ:** response/query ของ BFF (additive + เปลี่ยนสูตรนับ 4 ค่าใน `summary`) · ไม่ bump `schema_v` · ไม่แตะ stable core

---

## Requirements

**BFF `GET /api/back-office/overview/summary`**

- FR-1 — response เพิ่ม `sites_by_site_kind: Record<string, number>` (key = `site_kind` code) ใน `overviewSummarySchema`.
- FR-2 — `sites_by_site_kind` + `sites_external` นับจากชุดศูนย์เดียวกับ `sites_total` (หลังตัวกรองเดียวกัน และหลังตัดศูนย์ปิด / ยกเลิกตาม FR-4) ⇒ ผลรวมค่าทุก key ของ `sites_by_site_kind` + `sites_external` = `sites_total`.
- FR-3 — ศูนย์ที่ไม่มี `site_kind` นับเป็น `evacuation_center` (ตาม CR-067; `migrate()` เติมให้อยู่แล้ว).
- FR-4 — **ไม่นับ**ศูนย์ที่ `operation_status` เป็น `closed` หรือ `cancelled` ใน `sites_total`, `sites_by_site_kind` และ `sites_external`; ยกเว้นเมื่อตัวกรอง `operation_status` เลือก `closed` / `cancelled` ตรงๆ (นับศูนย์สถานะนั้น เพื่อไม่ให้การ์ดเป็น 0 ขณะตารางแสดงศูนย์เหล่านั้น). `sites_by_status` และ `sites_closed` ยังนับทุกศูนย์. _D-1_
- FR-5 — ศูนย์ `is_external` **ไม่นับ**ใน `sites_by_site_kind`; นับแยกใน `sites_external: number` (เพิ่มใน `overviewSummarySchema`). _D-2_
- FR-6 — ตัวเลขนับจากทุกศูนย์ตามตัวกรอง ไม่ขึ้นกับ pagination ของตารางศูนย์ (#1502).
- FR-7 — `present_total`, `forecast_total`, `avg_present_pct`, `avg_forecast_pct` รวมเฉพาะศูนย์ที่ผ่าน FR-4 และไม่ใช่ `is_external`; **ความจุรวมที่เป็นตัวหารของ `avg_*_pct` ตัดศูนย์กลุ่มเดียวกันออกด้วย**. `sites_by_status`, `sites_closed`, `pre_registered_at_sites` ไม่เปลี่ยน (ยังนับทุกศูนย์ตามตัวกรอง). _D-5_

**BFF `GET /api/back-office/overview/sites` และตัวกรองร่วม**

- FR-8 — แต่ละแถวของ `sites` เพิ่ม `is_external: boolean` (`isExternalShelter(master)`).
- FR-9 — ตัวกรองศูนย์ (ใช้กับ summary / sites / รายการลงทะเบียนล่วงหน้า):
  - ใหม่ `external=only` ⇒ เหลือเฉพาะศูนย์ `is_external`.
  - เมื่อมี `site_kind` (ประเภทปกติ) ⇒ **ตัดศูนย์ `is_external` ออก** (ศูนย์ภายนอกเลือกผ่าน `external=only` เท่านั้น).
  - ศูนย์ที่ไม่มี `operation_status` ถือเป็น `unknown` ทั้งในแถวและในตัวกรอง `operation_status=unknown`. _D-6_

**UI — หน้า `/system-management/overview`**

- FR-10 — แถวการ์ดอยู่บนสุดของหน้า ก่อนการ์ดลงทะเบียนล่วงหน้า / อยู่ในศูนย์; หนึ่งการ์ดต่อประเภท; ทุกการ์ดกว้างเท่ากันและเต็มแถวบนจอกว้าง (หนึ่งคอลัมน์ต่อการ์ด).
- FR-11 — เรียงตามลำดับ master `site_kind`; label จาก master ตามภาษาปัจจุบัน (th/en) ด้วย `formatMasterLabel`.
- FR-12 — แสดงทุกประเภทที่ `active` แม้จำนวน = 0; ประเภทที่ไม่ active แต่มีศูนย์ > 0 แสดงต่อท้ายพร้อม label ตาม code.
- FR-13 — การ์ด「ศูนย์ภายนอก」(`sites_external`) ต่อท้ายการ์ดประเภททั้งหมด; แสดงเสมอแม้เป็น 0; label th「ศูนย์ภายนอก」/ en「External shelters」.
- FR-14 — การ์ดตามตัวกรองด้านบนของหน้า (ค่า `summary` เดียวกับการ์ดอื่น). _D-4_
- FR-15 — การ์ด **ไม่** กดกรองตาราง (คงตัวกรอง "ประเภทศูนย์" ที่มีอยู่). _D-3_
- FR-16 — การ์ด「อยู่ในศูนย์」มีคำอธิบายว่า "ไม่รวมศูนย์ที่ปิด ยกเลิก และศูนย์ภายนอก" (th/en).
- FR-17 — ตารางศูนย์: สถานะ `unknown` แสดง「ไม่ทราบสถานะ」(en「Unknown」); ศูนย์ `is_external` มี badge「ศูนย์อพยพภายนอก」(en「External evacuation center」) ต่อท้ายรหัสศูนย์.
- FR-18 — ตัวกรอง「ประเภทศูนย์」มีตัวเลือก「ศูนย์อพยพภายนอก」(`external=only`) ต่อท้ายประเภท master; ตัวกรอง「สถานะศูนย์」มีตัวเลือก「ไม่ทราบสถานะ」.
- FR-19 — หน้า `/system-management/pre-registrations` ใช้ตัวกรองชุดเดียวกัน แต่ **ไม่แสดง**ตัวเลือก「ศูนย์อพยพภายนอก」.

## Decisions

| # | คำถาม | ผล |
| --- | --- | --- |
| D-1 | นับ `cancelled` / `closed` ในจำนวนศูนย์ (`sites_total`, การ์ดประเภท) ไหม | **ไม่นับ** (เจ้าของโครงการสั่ง 2026-11-24) ยกเว้นเมื่อตัวกรองสถานะเลือกสถานะนั้นตรงๆ |
| D-2 | ศูนย์ External นับรวมตามประเภทหรือแยกการ์ด | **แยกการ์ด「ศูนย์ภายนอก」** (เจ้าของโครงการสั่ง 2026-11-24) |
| D-3 | กดการ์ดแล้วกรองตารางไหม | ไม่กรอง (ค่าตั้งต้น รอบแรก) |
| D-4 | การ์ดตามตัวกรองหรือคงที่ทั้งระบบ | ตามตัวกรอง (ค่าตั้งต้น) |
| D-5 | ตัวเลข「อยู่ในศูนย์」นับศูนย์ปิด / ยกเลิก / External ไหม | **ไม่นับ** (เจ้าของโครงการสั่ง 2026-11-24); การ์ด「ลงทะเบียนล่วงหน้า」คงนับทุกศูนย์ |
| D-6 | ตัวกรองประเภทศูนย์ปกติรวม External ไหม; มีตัวเลือก External / ไม่ทราบสถานะ | ตัด External เมื่อเลือกประเภทปกติ; เพิ่มตัวเลือก External (ไม่แสดงในหน้ารายการลงทะเบียนล่วงหน้า) และ「ไม่ทราบสถานะ」 (เจ้าของโครงการสั่ง 2026-11-24) |

## Acceptance

- AC-1 — เปิดหน้าภาพรวม เห็นการ์ดจำนวนศูนย์ต่อประเภทบนสุด กว้างเท่ากัน; ผลรวมการ์ดประเภททั้งหมด + การ์ดศูนย์ภายนอก = `sites_total`; ศูนย์ปิด / ยกเลิกไม่ถูกนับ.
- AC-2 — ประเภท active ที่ไม่มีศูนย์แสดง 0; ศูนย์ `is_external` แสดงเฉพาะในการ์ดศูนย์ภายนอก ไม่ซ้ำในการ์ดประเภท.
- AC-3 — ศูนย์ไม่มี `site_kind` นับเป็น `evacuation_center`.
- AC-4 — สลับภาษาเป็น en แล้ว label เป็นภาษาอังกฤษ.
- AC-5a — เมื่อตัวกรองสถานะเลือก「ปิดศูนย์」หรือ「ยกเลิกศูนย์」การ์ดนับศูนย์สถานะนั้น (ไม่เป็น 0).
- AC-5 — `present_total` / `forecast_total` / `avg_*_pct` ไม่รวมศูนย์ `closed` / `cancelled` / External (เทสต์ BFF: ความจุตัวหารก็ตัดด้วย).
- AC-6 — เลือกประเภท「ศูนย์อพยพ」แล้วไม่มีศูนย์ External ในตารางและการ์ด; เลือก「ศูนย์อพยพภายนอก」เหลือเฉพาะศูนย์ External.
- AC-7 — ตัวกรองสถานะ「ไม่ทราบสถานะ」เจอศูนย์ที่ไม่มีสถานะ; ตารางแสดงป้าย「ไม่ทราบสถานะ」และ badge ศูนย์ภายนอกถูกต้อง.
- AC-8 — หน้ารายการลงทะเบียนล่วงหน้าไม่มีตัวเลือก「ศูนย์อพยพภายนอก」.
- AC-9 — เทสต์ BFF `summary` / `sites` และ DOM test ของการ์ดกับตารางศูนย์ผ่าน.

## Why

#1504: ปัจจุบันหัวหน้ามีเฉพาะการ์ด "ลงทะเบียนล่วงหน้า" / "อยู่ในศูนย์" ไม่เห็นจำนวนศูนย์แยกประเภท ทั้งที่ `site_kind` เป็น master ที่ SA เพิ่มประเภทได้ (CR-198). ระหว่างพัฒนาเจ้าของโครงการกำหนดเพิ่ม (2026-11-24): ศูนย์ External แยกการ์ด, ตัวเลข「อยู่ในศูนย์」ต้องไม่รวมศูนย์ที่ปิด / ยกเลิก / External เพราะบิดอัตราการใช้ความจุ (เช่นศูนย์ทดสอบความจุ 6,000 ทำให้ค่าเฉลี่ยต่ำเกินจริง). การนับเป็น rule ใหม่ของ `summary` (สถานะ / External / ตัวกรอง) จึงบันทึกเป็น CR.

## Change

- **Before:** `summary` ส่ง `sites_total`, `sites_by_status`; ไม่มีจำนวนตามประเภท; `present_total` / `forecast_total` / `avg_*_pct` รวมทุกศูนย์ตามตัวกรอง; ไม่มีตัวกรอง External / unknown; ตารางศูนย์ไม่บอก External.
- **After:** ตาม FR-1..FR-19.

## Impact

- BFF `summary` / `sites` response (additive) และ query `external` (ใหม่); client ที่ parse ด้วย Zod ใหม่ต้องมี field ใหม่ — deploy FE+BFF เป็น bundle เดียวอยู่แล้ว.
- ตัวเลข `present_total` / `forecast_total` / `avg_*_pct` เปลี่ยนค่าเมื่อมีศูนย์ปิด / ยกเลิก / External ที่มีคนหรือความจุ.
- ไม่กระทบ `docs/data/schema.md`, worker, FastAPI, role matrix.
- ลำดับกับ #1502: นับใน `buildOverviewSummary` จากทุกศูนย์ จึงไม่ถูกกระทบ pagination.

## Migration

N/A — ไม่มี doc ที่ persist เปลี่ยน, ไม่ bump `schema_v`.

## Decision log

- 2026-11-23 — proposed (ร่างจาก #1504; D-1..D-4 ใช้ค่าตั้งต้น รอเจ้าของโครงการยืนยัน; ยังไม่รันเลข CR)
- 2026-11-24 — D-2 เปลี่ยน: ศูนย์ External แยกเป็นการ์ดของตัวเอง (`sites_external`) ไม่นับรวมในประเภท
- 2026-11-24 — เพิ่ม FR-7 / D-5 (ตัวเลข「อยู่ในศูนย์」ไม่นับศูนย์ปิด / ยกเลิก / External), FR-8..FR-9 / FR-17..FR-19 / D-6 (ตัวกรอง External และ「ไม่ทราบสถานะ」, ตัดศูนย์ External เมื่อเลือกประเภทปกติ, badge ในตารางศูนย์) ตามข้อสั่งของเจ้าของโครงการ
- 2026-11-24 — D-1 เปลี่ยนค่าตั้งต้น: ไม่นับศูนย์ที่ปิดและศูนย์ที่ยกเลิกในจำนวนศูนย์ (`sites_total`, การ์ดประเภท, `sites_external`) ยกเว้นเมื่อตัวกรองสถานะเลือกสถานะนั้นตรงๆ (FR-4, AC-1, AC-5a)