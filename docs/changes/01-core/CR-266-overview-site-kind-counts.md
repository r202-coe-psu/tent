---
id: CR-266
title: หน้าภาพรวมระบบ — การ์ดจำนวนศูนย์แยกตามประเภท (site_kind) และกติกานับศูนย์ภายนอก / ปิด / ยกเลิก
status: approved
date: 2026-11-23
updated: 2026-11-25
requested_by: Dev Team B GitHub #1504 (+ ข้อสั่งเพิ่มของเจ้าของโครงการ 2026-11-24)
decided_by: kong
layer: volatile
affects:
  - docs/data/api-contract.md (ไม่มี section overview เดิม — ไม่ต้องแก้; สัญญา BFF อยู่ใน Zod `overviewSummarySchema` / `overviewSiteRowSchema` / `overviewFiltersSchema`)
  - no schema_v bump (ไม่แตะ doc ที่ persist; เพิ่มเฉพาะ field/พารามิเตอร์ใน response/query ของ BFF)
  - frontend/src/lib/server/system-overview/index.ts (`buildOverviewSummary`, `buildOverviewSites`, `matchesShelterGeo`)
  - frontend/src/lib/features/system-overview/domain/schemas.ts (`overviewSummarySchema` +`sites_by_site_kind` +`sites_external` +`sites_closed_or_cancelled`; `overviewSiteRowSchema` +`is_external`; `overviewFiltersSchema` +`external` + `FILTER_KEYS` / `overviewFiltersToSearchParams` +`external`)
  - frontend/src/lib/features/system-overview/ui (การ์ดประเภทศูนย์, ตารางศูนย์, filter bar, หน้ารายการลงทะเบียนล่วงหน้า)
  - frontend/src/lib/constants/i18n/staff-system-overview.ts
  - tests: BFF summary / sites / filters (รวม `frontend/src/routes/api/back-office/overview/summary/server.test.ts` ที่ assert `sites_total`), DOM test ของการ์ดและตารางศูนย์
---

# หน้าภาพรวมระบบ — การ์ดจำนวนศูนย์แยกตามประเภท และกติกานับศูนย์ภายนอก / ปิด / ยกเลิก

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** (1) หน้า `/system-management/overview` เพิ่มแถวการ์ดบนสุด หนึ่งการ์ดต่อ `site_kind` + การ์ด「ศูนย์ภายนอก」+ การ์ด「ศูนย์ที่ปิด/ยกเลิก」แยก; (2) การ์ด「อยู่ในศูนย์」ไม่นับศูนย์ที่ปิด / ยกเลิก / ภายนอก; (3) ตัวกรอง/ตารางศูนย์รองรับศูนย์ภายนอกและสถานะ「ไม่ทราบสถานะ」
> - **เพื่อใคร:** SA ที่ต้องเห็นภาพรวมจำนวนศูนย์แยกประเภทและตัวเลขการใช้ความจุที่สะท้อนเฉพาะศูนย์ที่เปิดใช้งานในระบบนี้
> - **dev ต้อง build:** `summary` เพิ่ม `sites_by_site_kind` (ไม่รวม External) + `sites_external` + `sites_closed_or_cancelled`, ปรับสูตร `sites_total` / `present_total` / `forecast_total` / `avg_*_pct`; แถว `sites` เพิ่ม `is_external`; filter `external=only`; UI ตาม FR-10..FR-19
> - **กระทบ:** response/query ของ BFF (additive + เปลี่ยนสูตรนับ 5 ค่าใน `summary`: `sites_total`, `present_total`, `forecast_total`, `avg_present_pct`, `avg_forecast_pct`) · ไม่ bump `schema_v` · ไม่แตะ stable core

---

## Requirements

**BFF `GET /api/back-office/overview/summary`**

- FR-1 — response เพิ่ม `sites_by_site_kind: Record<string, number>` (key = `site_kind` code) ใน `overviewSummarySchema`.
- FR-2 — `sites_by_site_kind` + `sites_external` นับจากชุดศูนย์เดียวกับ `sites_total` (หลังตัวกรองเดียวกัน และหลังตัดศูนย์ปิด / ยกเลิกตาม FR-4) ⇒ ผลรวมค่าทุก key ของ `sites_by_site_kind` + `sites_external` = `sites_total`.
- FR-3 — ศูนย์ที่ไม่มี `site_kind` นับเป็น `evacuation_center` (ตาม CR-067; `migrate()` เติมให้อยู่แล้ว).
- FR-4 — **ไม่นับ**ศูนย์ที่ `operation_status` เป็น `closed` หรือ `cancelled` ใน `sites_total`, `sites_by_site_kind` และ `sites_external`; **ไม่มีข้อยกเว้น** แม้ตัวกรอง `operation_status` เลือก `closed` / `cancelled` ตรงๆ (การ์ดประเภทและ `sites_total` ขึ้น 0 โดยตั้งใจ ศูนย์เหล่านั้นแสดงในตารางและในการ์ด「ศูนย์ที่ปิด/ยกเลิก」ตาม FR-7b / FR-13a). `sites_by_status` และ `sites_closed` ยังนับทุกศูนย์. _D-1_
- FR-5 — ศูนย์ `is_external` **ไม่นับ**ใน `sites_by_site_kind`; นับแยกใน `sites_external: number` (เพิ่มใน `overviewSummarySchema`). _D-2_
- FR-6 — ตัวเลขนับจากทุกศูนย์ตามตัวกรอง ไม่ขึ้นกับ pagination ของตารางศูนย์ (#1502).
- FR-7 — `present_total`, `forecast_total`, `avg_present_pct`, `avg_forecast_pct` รวมเฉพาะศูนย์ที่ผ่าน FR-4 และไม่ใช่ `is_external`; **ความจุรวมที่เป็นตัวหารของ `avg_*_pct` ตัดศูนย์กลุ่มเดียวกันออกด้วย**. เหตุผลของ External: ศูนย์ External ไม่มีข้อมูลผู้พักในระบบนี้ (CR-252 FR-12) แต่กรอกความจุได้ (CR-252 FR-6) ความจุจึงบิดตัวหารของเปอร์เซ็นต์ถ้านับรวม. `sites_by_status`, `sites_closed`, `pre_registered_at_sites` ไม่เปลี่ยน (ยังนับทุกศูนย์ตามตัวกรอง). _D-5_
- FR-7a — ตัวเลขอื่นใน `summary` ที่ไม่ได้ระบุใน FR-4 / FR-7:
  - `checkouts_in_window` ไม่เปลี่ยน — นับทุกศูนย์ตามตัวกรอง รวมศูนย์ปิด / ยกเลิก / External (คนที่เช็กเอาต์จริงต้องไม่หายเพราะศูนย์ปิดภายหลัง).
  - `sites_open_with_present` ไม่เปลี่ยนสูตร — ตัดศูนย์ปิด / ยกเลิกอยู่แล้ว; ศูนย์ External ไม่มีข้อมูลผู้พัก (CR-252 FR-12) จึงไม่ถูกนับอยู่แล้ว.
  - dev ต้องคำนวณตัวเลขกลุ่ม「ไม่เปลี่ยน」จากรายการศูนย์**ก่อน**ตัดตาม FR-4 / FR-7 ไม่ใช่จากรายการที่ตัดแล้ว (`buildOverviewSummary` ใช้รายการเดียวกันทุกตัวอยู่ในปัจจุบัน).
- FR-7b — `sites_closed_or_cancelled: number` (ใหม่ใน `overviewSummarySchema`) = จำนวนศูนย์ที่ `operation_status` เป็น `closed` หรือ `cancelled` หลังตัวกรองเดียวกัน (ไม่ขึ้นกับ pagination). ไม่นับซ้ำกับ `sites_by_site_kind` / `sites_external` เสมอ เพราะ FR-4 ตัดศูนย์เหล่านี้ออกจากสองค่านั้นโดยไม่มีข้อยกเว้น. `sites_total` **ไม่เท่า**ผลรวม `sites_by_status` โดยตั้งใจ (ผลรวม `sites_by_status` = `sites_total` + `sites_closed_or_cancelled`).

**BFF `GET /api/back-office/overview/sites` และตัวกรองร่วม**

- FR-8 — แต่ละแถวของ `sites` เพิ่ม `is_external: boolean` (`isExternalShelter(master)`).
- FR-9 — ตัวกรองศูนย์ (ใช้กับ summary / sites / รายการลงทะเบียนล่วงหน้า):
  - ใหม่ `external=only` ⇒ เหลือเฉพาะศูนย์ `is_external`.
  - เมื่อมี `site_kind` (ประเภทปกติ) และ**ไม่มี** `external=only` ⇒ **ตัดศูนย์ `is_external` ออก** (ศูนย์ภายนอกเลือกผ่าน `external=only` เท่านั้น). ถ้ามีทั้งสองค่า ดูข้อสุดท้ายของ FR-9.
  - ศูนย์ที่ไม่มี `operation_status` ถือเป็น `unknown` ทั้งในแถวและในตัวกรอง `operation_status=unknown`. _D-6_
  - `external` ต้องเพิ่มใน `FILTER_KEYS` ของ `parseOverviewFilters` และใน `overviewFiltersToSearchParams` (ไม่เช่นนั้น `?external=only` ถูกทิ้งเงียบ ตารางแสดงทุกศูนย์).
  - `site_kind` กับ `external=only` เลือกคู่กันไม่ได้: เมื่อ URL มีทั้งสองค่า ให้ `external=only` ชนะและเมินค่า `site_kind` (ไม่ให้ตารางว่างจากเงื่อนไขขัดกัน).

**UI — หน้า `/system-management/overview`**

- FR-10 — แถวการ์ดอยู่บนสุดของหน้า ก่อนการ์ดลงทะเบียนล่วงหน้า / อยู่ในศูนย์; หนึ่งการ์ดต่อประเภท; ทุกการ์ดกว้างเท่ากันและเต็มแถวบนจอกว้าง (หนึ่งคอลัมน์ต่อการ์ด).
- FR-11 — เรียงตามลำดับ master `site_kind`; label จาก master ตามภาษาปัจจุบัน (th/en) ด้วย `formatMasterLabel`.
- FR-12 — แสดงทุกประเภทที่ `active` แม้จำนวน = 0; ประเภทที่ไม่ active แต่มีศูนย์ > 0 แสดงต่อท้ายพร้อม label ตาม code.
- FR-13 — การ์ด「ศูนย์ภายนอก」(`sites_external`) ต่อท้ายการ์ดประเภททั้งหมด; แสดงเสมอแม้เป็น 0; label th「ศูนย์ภายนอก」/ en「External shelters」.
- FR-13a — การ์ด「ศูนย์ที่ปิด/ยกเลิก」(`sites_closed_or_cancelled`) ต่อท้ายการ์ดศูนย์ภายนอก; แสดงเสมอแม้เป็น 0; label th「ศูนย์ที่ปิด/ยกเลิก」/ en「Closed / cancelled shelters」; ขนาดเท่าการ์ดอื่นตาม FR-10.
- FR-14 — การ์ดตามตัวกรองด้านบนของหน้า (ค่า `summary` เดียวกับการ์ดอื่น). _D-4_
- FR-15 — การ์ด **ไม่** กดกรองตาราง (คงตัวกรอง "ประเภทศูนย์" ที่มีอยู่). _D-3_
- FR-16 — การ์ด「อยู่ในศูนย์」มีคำอธิบายว่า "ไม่รวมศูนย์ที่ปิด ยกเลิก และศูนย์ภายนอก" (th/en).
- FR-17 — ตารางศูนย์: สถานะ `unknown` แสดง「ไม่ทราบสถานะ」(en「Unknown」); ศูนย์ `is_external` มี badge「ศูนย์อพยพภายนอก」(en「External evacuation center」) ต่อท้ายรหัสศูนย์.
- FR-18 — ตัวกรอง「ประเภทศูนย์」มีตัวเลือก「ศูนย์อพยพภายนอก」(`external=only`) ต่อท้ายประเภท master; ตัวกรอง「สถานะศูนย์」มีตัวเลือก「ไม่ทราบสถานะ」. เป็น dropdown เดียว: เลือกประเภทปกติ ⇒ ล้าง `external`; เลือก「ศูนย์อพยพภายนอก」⇒ ล้าง `site_kind`.
- FR-19 — หน้า `/system-management/pre-registrations` ใช้ตัวกรองชุดเดียวกัน แต่ **ไม่แสดง**ตัวเลือก「ศูนย์อพยพภายนอก」.

## Decisions

| # | คำถาม | ผล |
| --- | --- | --- |
| D-1 | นับ `cancelled` / `closed` ในจำนวนศูนย์ (`sites_total`, การ์ดประเภท) ไหม | **ไม่นับ** (เจ้าของโครงการสั่ง 2026-11-24) ไม่มีข้อยกเว้น แม้ตัวกรองสถานะเลือก `closed` / `cancelled` (ศูนย์เหล่านั้นแสดงในการ์ด「ศูนย์ที่ปิด/ยกเลิก」; ตัดสินใจ 2026-11-25) |
| D-2 | ศูนย์ External นับรวมตามประเภทหรือแยกการ์ด | **แยกการ์ด「ศูนย์ภายนอก」** (เจ้าของโครงการสั่ง 2026-11-24) |
| D-3 | กดการ์ดแล้วกรองตารางไหม | ไม่กรอง (ค่าตั้งต้น รอบแรก) |
| D-4 | การ์ดตามตัวกรองหรือคงที่ทั้งระบบ | ตามตัวกรอง (ค่าตั้งต้น) |
| D-5 | ตัวเลข「อยู่ในศูนย์」นับศูนย์ปิด / ยกเลิก / External ไหม | **ไม่นับ** (เจ้าของโครงการสั่ง 2026-11-24); การ์ด「ลงทะเบียนล่วงหน้า」คงนับทุกศูนย์ |
| D-6 | ตัวกรองประเภทศูนย์ปกติรวม External ไหม; มีตัวเลือก External / ไม่ทราบสถานะ | ตัด External เมื่อเลือกประเภทปกติ; เพิ่มตัวเลือก External (ไม่แสดงในหน้ารายการลงทะเบียนล่วงหน้า) และ「ไม่ทราบสถานะ」 (เจ้าของโครงการสั่ง 2026-11-24) |
| D-7 | มีการ์ดแสดงจำนวนศูนย์ที่ปิด / ยกเลิกไหม; ตัวกรองสถานะปิด / ยกเลิกทำให้การ์ดประเภทขึ้นเท่าไร | **มี** การ์ดเดียวรวมปิด + ยกเลิก (`sites_closed_or_cancelled`); ตัวกรองสถานะปิด / ยกเลิก ⇒ การ์ดประเภทและ `sites_total` ขึ้น **0** (ตัดสินใจ 2026-11-25) |

## Acceptance

- AC-1 — เปิดหน้าภาพรวม เห็นการ์ดจำนวนศูนย์ต่อประเภทบนสุด กว้างเท่ากัน; ผลรวมการ์ดประเภททั้งหมด + การ์ดศูนย์ภายนอก = `sites_total`; ศูนย์ปิด / ยกเลิกไม่ถูกนับ.
- AC-1a — การ์ด「ศูนย์ที่ปิด/ยกเลิก」แสดงผลรวมศูนย์ `closed` + `cancelled` ตามตัวกรอง; ตัวอย่าง 10 ศูนย์ ปิด 2 ยกเลิก 1 ⇒ การ์ดประเภท + ศูนย์ภายนอก = 7 (`sites_total`), การ์ดปิด/ยกเลิก = 3, ผลรวม `sites_by_status` = 10.
- AC-2 — ประเภท active ที่ไม่มีศูนย์แสดง 0; ศูนย์ `is_external` แสดงเฉพาะในการ์ดศูนย์ภายนอก ไม่ซ้ำในการ์ดประเภท.
- AC-3 — ศูนย์ไม่มี `site_kind` นับเป็น `evacuation_center`.
- AC-4 — สลับภาษาเป็น en แล้ว label เป็นภาษาอังกฤษ.
- AC-5 — `present_total` / `forecast_total` / `avg_*_pct` ไม่รวมศูนย์ `closed` / `cancelled` / External (เทสต์ BFF: ความจุตัวหารก็ตัดด้วย); ไม่มีข้อยกเว้นเมื่อตัวกรองสถานะเลือก `closed` / `cancelled`.
- AC-5a — เมื่อตัวกรองสถานะเลือก「ปิดศูนย์」หรือ「ยกเลิกศูนย์」การ์ดประเภทและ `sites_total` = 0, การ์ด「ศูนย์ที่ปิด/ยกเลิก」นับศูนย์สถานะนั้น, ตารางยังแสดงศูนย์เหล่านั้น.
- AC-6 — เลือกประเภท「ศูนย์อพยพ」แล้วไม่มีศูนย์ External ในตารางและการ์ด; เลือก「ศูนย์อพยพภายนอก」เหลือเฉพาะศูนย์ External.
- AC-6a — เลือก「ศูนย์อพยพภายนอก」(`external=only`): การ์ด「อยู่ในศูนย์」แสดงจำนวนคน = 0 และเปอร์เซ็นต์ใช้ความจุแสดง「—」(ความจุรวมหลังตัด External = 0 ⇒ `avg_*_pct` = `null`); เป็นค่าที่ถูกต้อง ไม่ใช่ข้อมูลหาย.
- AC-6b — เปิดลิงก์ที่มี `external=only` ตารางเหลือเฉพาะศูนย์ External; ลิงก์ที่มีทั้ง `site_kind=<ประเภทปกติ>` และ `external=only` ให้ผลเท่ากับ `external=only` อย่างเดียว (ไม่ว่าง).
- AC-7 — ตัวกรองสถานะ「ไม่ทราบสถานะ」เจอศูนย์ที่ไม่มีสถานะ; ตารางแสดงป้าย「ไม่ทราบสถานะ」และ badge ศูนย์ภายนอกถูกต้อง.
- AC-8 — หน้ารายการลงทะเบียนล่วงหน้าไม่มีตัวเลือก「ศูนย์อพยพภายนอก」.
- AC-9 — เทสต์ BFF `summary` / `sites` และ DOM test ของการ์ดกับตารางศูนย์ผ่าน.

## Why

#1504: ปัจจุบันหัวหน้ามีเฉพาะการ์ด "ลงทะเบียนล่วงหน้า" / "อยู่ในศูนย์" ไม่เห็นจำนวนศูนย์แยกประเภท ทั้งที่ `site_kind` เป็น master ที่ SA เพิ่มประเภทได้ (CR-198). ระหว่างพัฒนาเจ้าของโครงการกำหนดเพิ่ม (2026-11-24): ศูนย์ External แยกการ์ด, ตัวเลข「อยู่ในศูนย์」ต้องไม่รวมศูนย์ที่ปิด / ยกเลิก / External เพราะบิดอัตราการใช้ความจุ (เช่นศูนย์ทดสอบความจุ 6,000 ทำให้ค่าเฉลี่ยต่ำเกินจริง). ศูนย์ปิด / ยกเลิกถูกตัดออกจากการนับแล้ว จึงมีการ์ด「ศูนย์ที่ปิด/ยกเลิก」แสดงว่ามีกี่แห่ง (2026-11-25). การนับเป็น rule ใหม่ของ `summary` (สถานะ / External / ตัวกรอง) จึงบันทึกเป็น CR.

## Change

- **Before:** `summary` ส่ง `sites_total`, `sites_by_status`; ไม่มีจำนวนตามประเภท; `present_total` / `forecast_total` / `avg_*_pct` รวมทุกศูนย์ตามตัวกรอง; ไม่มีตัวกรอง External / unknown; ตารางศูนย์ไม่บอก External.
- **After:** ตาม FR-1..FR-19 (รวม FR-7a / FR-7b / FR-13a).

## Impact

- BFF `summary` / `sites` response (additive) และ query `external` (ใหม่); client ที่ parse ด้วย Zod ใหม่ต้องมี field ใหม่ — deploy FE+BFF เป็น bundle เดียวอยู่แล้ว.
- ตัวเลข `present_total` / `forecast_total` / `avg_*_pct` เปลี่ยนค่าเมื่อมีศูนย์ปิด / ยกเลิก / External ที่มีคนหรือความจุ; `sites_total` เปลี่ยนความหมาย (ไม่นับศูนย์ปิด / ยกเลิก) จึงไม่เท่าผลรวม `sites_by_status` โดยตั้งใจ — ตรวจแล้วไม่มีหน้าจอใดอ่าน `sites_total` ตอนนี้ (มีแค่ schema และ `summary/server.test.ts`).
- ไม่กระทบ `docs/data/schema.md`, worker, FastAPI, role matrix.
- ลำดับกับ #1502: นับใน `buildOverviewSummary` จากทุกศูนย์ จึงไม่ถูกกระทบ pagination.

## Migration

N/A — ไม่มี doc ที่ persist เปลี่ยน, ไม่ bump `schema_v`.

## Decision log

- 2026-11-23 — proposed (ร่างจาก #1504; D-1..D-4 ใช้ค่าตั้งต้น รอเจ้าของโครงการยืนยัน; ยังไม่รันเลข CR)
- 2026-11-24 — D-2 เปลี่ยน: ศูนย์ External แยกเป็นการ์ดของตัวเอง (`sites_external`) ไม่นับรวมในประเภท
- 2026-11-24 — เพิ่ม FR-7 / D-5 (ตัวเลข「อยู่ในศูนย์」ไม่นับศูนย์ปิด / ยกเลิก / External), FR-8..FR-9 / FR-17..FR-19 / D-6 (ตัวกรอง External และ「ไม่ทราบสถานะ」, ตัดศูนย์ External เมื่อเลือกประเภทปกติ, badge ในตารางศูนย์) ตามข้อสั่งของเจ้าของโครงการ
- 2026-11-24 — D-1 เปลี่ยนค่าตั้งต้น: ไม่นับศูนย์ที่ปิดและศูนย์ที่ยกเลิกในจำนวนศูนย์ (`sites_total`, การ์ดประเภท, `sites_external`) ยกเว้นเมื่อตัวกรองสถานะเลือกสถานะนั้นตรงๆ (FR-4, AC-1, AC-5a)
- 2026-11-25 — จากรีวิว PR #1511: เพิ่ม FR-7a (ระบุ `checkouts_in_window` / `sites_open_with_present`), FR-7b + FR-13a + AC-1a (การ์ด「ศูนย์ที่ปิด/ยกเลิก」, `sites_total` ไม่เท่าผลรวม `sites_by_status` โดยตั้งใจ); เพิ่มกติกาตัวกรอง `external` (FR-9 / FR-18 / AC-6a / AC-6b); ตัดข้อยกเว้นของ FR-4 (ตัวกรองสถานะปิด / ยกเลิก): การ์ดประเภทและ `sites_total` ขึ้น 0 โดยตั้งใจ ศูนย์เหล่านั้นแสดงในการ์ดปิด/ยกเลิก (D-1, D-7, FR-4, AC-5, AC-5a)
- 2026-11-25 — approved by kong; รันเลข CR-266 (เลข CR-265 ถูกจองโดย PR #1470 ที่ยังเปิดอยู่); ย้ายจาก `draft-overview-site-kind-counts.md` เข้า `01-core/`; ซิงก์ Change / Impact / Why ให้ตรงกับ FR-7a / FR-7b / FR-13a
