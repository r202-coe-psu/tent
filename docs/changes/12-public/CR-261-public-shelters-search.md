---
id: CR-261
title: หน้า public /shelters — ไม่แสดงบ้านพี่เลี้ยงที่ไม่ใช่ External, กรองที่ DB, คงรัศมีเริ่มต้น 5 กม., การ์ดสรุปจาก endpoint ใหม่ (#1419)
status: approved
date: 2026-11-18
requested_by: "GitHub #1419 (ทีม — Before Floods)"
decided_by: kong
decision_date: 2026-11-18
layer: volatile
affects:
  - docs/changes/00-baseline/CR-067-shelter-site-kind.md (Phase 1: "Public map: ไอคอนศูนย์ ≠ ไอคอนบ้านพี่เลี้ยง" — แก้เฉพาะหน้า /shelters)
  - docs/data/schema.md — ไม่เปลี่ยนรูป doc; schema_v — ไม่เปลี่ยน
  - docs/data/api-contract.md (`GET /public/v1/shelters` — query ใหม่ `q`, `admin_type`, `hide_full`, `hide_evacuation`, `hide_external`, `hide_host_house`, `parking`; endpoint ใหม่ `GET /public/v1/shelters/summary`) — แก้พร้อมตอน promote หลัง approve
  - backend/apiapp/modules/shelter/{router,schemas,use_case}.py, backend/tests/test_shelter.py (กรองใน Mongo + summary)
  - frontend/src/lib/api-specs/fastapi.json, frontend/src/lib/api/openapi.d.ts (regen)
  - frontend/src/routes/api/public/v1/shelters/+server.ts และ summary/+server.ts (BFF)
  - frontend/src/lib/features/public-portal/data/public-api.ts, domain/types.ts (`fetchShelterSummary`, พารามิเตอร์ใหม่)
  - frontend/src/routes/(public)/shelters/+page.ts (ส่งตัวกรองให้ API, การ์ดจาก summary, รัศมีเริ่มต้น 5 กม. ส่งให้ DB เมื่อมีตำแหน่ง)
  - frontend/src/lib/features/public-portal/domain/site-kind.ts (`SHELTER_GROUP_HIDE_PARAMS`, `hiddenShelterGroups`)
  - frontend/src/lib/features/public-portal/ui/shelter-filter-panel.svelte (ถอดสวิตช์ "บ้านพี่เลี้ยง", คงรัศมี 5 กม. เริ่มต้น, กดปุ่มระยะที่เลือกอยู่ซ้ำเพื่อยกเลิก, `aria-pressed` ของปุ่มระยะ)
  - frontend/src/routes/(public)/shelters/+page.svelte (ปักหมุดค้นหาใช้รัศมี 5 กม. เมื่อ URL ยังไม่มี `distance`)
  - frontend/src/lib/constants/i18n/public-filter-panel.ts (`groupHostHouse`)
  - frontend/src/routes/(public)/shelters/page.test.ts, frontend/src/lib/features/public-portal/domain/site-kind.test.ts, frontend/e2e/public-shelters-filter.test.ts
---

# หน้า public `/shelters` — กรองที่ DB, คงรัศมีเริ่มต้น 5 กม., การ์ดสรุปจาก endpoint ใหม่ (#1419)

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** หน้า public `/shelters` (ฝั่งผู้อพยพ) (1) ไม่แสดงบ้านพี่เลี้ยงที่ไม่ใช่ External (2) ให้ DB กรองรายการแทน browser (รวมรัศมี) (3) คงรัศมีเริ่มต้น 5 กม. ตามเดิม (4) การ์ดตัวเลขด้านบนไม่ตามตัวกรอง ดึงจาก endpoint ใหม่ `GET /public/v1/shelters/summary`
> - **ทำไม:** ข้อเสนอของทีมใน #1419 (Before Floods) — ลด load ของหน้าและแก้ตัวเลขการ์ดที่เปลี่ยนไปมา (เปิดครั้งแรก 210 แล้วเหลือ 10 หลัง GPS และสลับตามสวิตช์); ย้อนข้อกำหนดเดิมของ CR-067 (ไอคอนบ้านพี่เลี้ยงบน public map) และสวิตช์ที่เพิ่มใน #1417
> - **Dev ต้อง build:** พารามิเตอร์กรองใหม่ + endpoint summary ใน FastAPI/Mongo, BFF ส่งต่อพารามิเตอร์ + route summary, `+page.ts` ส่งตัวกรองให้ API และเรียก summary, ถอดสวิตช์บ้านพี่เลี้ยง, ส่งรัศมี (ค่าเริ่มต้น 5 กม.) ให้ DB, regen OpenAPI
> - **กระทบ:** public API (เพิ่ม query และ endpoint แบบ additive — ผู้เรียกเดิมไม่เปลี่ยน), UI `/shelters`; ไม่เปลี่ยน schema / `schema_v` / หลังบ้าน

---

## 1. Requirements

| ID   | Requirement |
| ---- | ----------- |
| FR-1 | หน้า `/shelters` ต้องไม่แสดงศูนย์ที่ `shelterGroup = host_house` (ไม่ใช่ External และ `site_kind = host_house`) ในรายการ ในแผนที่ (หมุดศูนย์และหมุดจอดรถของศูนย์นั้น) และในการ์ดสรุป ไม่ว่า URL จะมี query ใด |
| FR-2 | ตัวเลขสรุป (`shelters_total`, `shelters_open`, `counts_by_site_kind`) ต้องคำนวณจากรายการหลังตัดบ้านพี่เลี้ยงออก; การ์ดประเภทสถานที่ไม่แสดงบ้านพี่เลี้ยงที่ถูกซ่อน |
| FR-3 | ตัวกรอง "ประเภทศูนย์พักพิง" เหลือ 2 สวิตช์: "ศูนย์อพยพ" และ "ศูนย์อพยพภายนอก"; ต้องไม่มีสวิตช์ "บ้านพี่เลี้ยง" |
| FR-4 | `hide_host_house` ใน URL (ลิงก์หรือบุ๊กมาร์กเก่าจาก #1417) ถูกเมินและไม่ถูกส่งกลับใน `filters`; `hide_evacuation` และ `hide_external` ทำงานตามเดิม |
| FR-5 | ศูนย์ External ที่ `site_kind = host_house` ยังแสดงเป็นกลุ่ม "ภายนอก" ตามเดิม (กรองได้ด้วย `hide_external`) |
| FR-6 | ขอบเขตของการซ่อนบ้านพี่เลี้ยงจำกัดที่หน้า `/shelters`: หน้า `/shelters/[id]`, ฟอร์มลงทะเบียนล่วงหน้า, หน้าบริจาค, หน้าค้นหาผู้พักพิง, หน้าแรก และหลังบ้านไม่เปลี่ยน; `GET /public/v1/shelters` ยังคืนบ้านพี่เลี้ยงตามเดิมเมื่อไม่ส่ง `hide_host_house` |
| FR-7 | `GET /public/v1/shelters` รับ query ใหม่ (ไม่บังคับ ทั้งหมด AND กัน) และกรองใน Mongo: `q` (ข้อความในชื่อ / รหัส / จังหวัด / อำเภอ, ไม่สนตัวพิมพ์, ตัดช่องว่างหัวท้าย, อักขระ regex ถือเป็นข้อความธรรมดา), `admin_type` (รหัสประเภทอาคาร), `hide_full` (ตัด `status = full`), `hide_evacuation`, `hide_external`, `hide_host_house` (กลุ่มตาม FR-1/FR-5: external = `is_external`; host house/evacuation ไม่รวม external; แถวเก่าที่ไม่มี `is_external` นับเป็นไม่ใช่ external), `parking` (ซ้ำได้ — ศูนย์ต้องรับทุกชนิดที่ส่งมา) |
| FR-8 | `status` กับ `hide_full` ใช้ร่วมกันได้ (`status=full` + `hide_full=true` = ว่าง); พารามิเตอร์เดิม (`province`, `district`, `subdistrict`, `status`, `site_kind`, `lat`, `lng`, `radius_km`) ทำงานเหมือนเดิม |
| FR-9 | endpoint ใหม่ `GET /public/v1/shelters/summary` (Bearer เหมือน list) คืน `shelters_total`, `shelters_open` (นับ `open` และ `full`), `counts_by_site_kind` (แถวที่ไม่มี `site_kind` นับเป็น `evacuation_center`) และ `as_of` โดย**ไม่ตามตัวกรองของรายการ**; รับเฉพาะ `hide_host_house` (ตัดบ้านพี่เลี้ยงที่ไม่ใช่ External) คำนวณด้วย aggregation ใน Mongo (ไม่โหลดรายการ) |
| FR-10 | BFF `/api/public/v1/shelters` ส่งต่อ query ใหม่ทั้งหมด (`parking` ส่งทุกค่า) และเพิ่ม `/api/public/v1/shelters/summary` ส่งต่อเฉพาะ `hide_host_house`; query ที่ไม่รู้จักไม่ถูกส่งต่อ |
| FR-11 | หน้า `/shelters` ส่งตัวกรองทั้งหมดให้ API (ประเภทอาคารส่งเป็นรหัส แปลงจากป้ายใน URL) และไม่กรองรายการซ้ำฝั่ง browser; ส่ง `hide_host_house=true` เสมอ; การ์ด (ทั้งหมด / เปิดใช้งาน / ประเภทสถานที่) มาจาก summary ไม่ว่าตัวกรองจะเป็นอะไร และเป็นศูนย์ทั้งหมดเมื่อ summary ใช้ไม่ได้ (รายการยังแสดง) |
| FR-12 | คงรัศมีเริ่มต้น 5 กม. ตามเดิม: ไม่มี `distance` ใน URL = 5 กม.; เมื่อได้ตำแหน่งผู้ใช้ (GPS ครั้งแรกหรือปักหมุดค้นหา) URL ได้ `distance=5`; เมื่อมีตำแหน่งและรัศมี ส่ง `lat`/`lng`/`radius_km` ให้ API ตัดที่ DB (ไม่มีตำแหน่ง = ไม่ส่ง); กดปุ่มระยะที่เลือกอยู่ซ้ำเพื่อยกเลิกรัศมี — URL เก็บเป็น `distance=` (ค่าว่าง) เพื่อไม่ให้กลับเป็น 5 กม. แล้วแสดงทุกศูนย์ เรียงใกล้→ไกลที่ฝั่ง client (ไม่ส่ง `lat`/`lng` ให้ API เพื่อไม่ให้ศูนย์ที่ไม่มีพิกัดหาย) |

## 2. Acceptance

- **AC-1** ข้อมูลมีศูนย์อพยพ 1, บ้านพี่เลี้ยง (ไม่ใช่ External) 1, ศูนย์ External 1 → `/shelters` แสดง 2 รายการ (ศูนย์อพยพและ External) ไม่มีบ้านพี่เลี้ยงทั้งในรายการและบนแผนที่
- **AC-2** `shelters_total` เท่ากับจำนวนที่แสดง และไม่นับบ้านพี่เลี้ยงที่ซ่อน; การ์ดประเภทสถานที่ไม่มี "บ้านพี่เลี้ยง" เมื่อมีแต่บ้านพี่เลี้ยงที่ซ่อน
- **AC-3** ตัวกรอง "ประเภทศูนย์พักพิง" มีสวิตช์เพียง 2 ตัว
- **AC-4** เปิด `/shelters?hide_host_house=on` ได้ผลเหมือนไม่มี param (ไม่ error ไม่ echo)
- **AC-5** ศูนย์ External ที่ `site_kind = host_house` ยังแสดง และหายเมื่อเปิด `hide_external=on`
- **AC-6** parking pin ของบ้านพี่เลี้ยงที่ซ่อนไม่ขึ้นบนแผนที่ (หมุดจอดรถตามผลลัพธ์ที่แสดง, CR-253 FR-30)
- **AC-7** `/shelters/<id>` ของบ้านพี่เลี้ยงยังเปิดได้ด้วยลิงก์ตรงตามเดิม
- **AC-8** ค้นหาด้วย `q` ที่มีอักขระ regex (เช่น `(A+B)`, `.*`) ตรงเป็นข้อความ ไม่ error และ `.*` ไม่ตรงทุกศูนย์
- **AC-9** `hide_evacuation` / `hide_external` / `hide_host_house` ผสมกันตาม FR-7: ศูนย์ External ที่เป็นบ้านพี่เลี้ยงอยู่กลุ่ม external; แถวที่ไม่มี `is_external` ไม่หายเมื่อ `hide_external`
- **AC-10** `parking=car&parking=boat` คืนเฉพาะศูนย์ที่รับทั้งสองชนิด
- **AC-11** `GET /public/v1/shelters/summary` ไม่มี Bearer → 401; ไม่ส่ง query → นับทุกศูนย์ (เปิด = `open`+`full`); `hide_host_house=true` ตัดเฉพาะบ้านพี่เลี้ยงที่ไม่ใช่ External; ไม่มีข้อมูล → `0 / 0 / {}`
- **AC-12** เปิด `/shelters` ครั้งแรก: การ์ดคงที่ ไม่เปลี่ยนเมื่อ GPS commit และไม่เปลี่ยนเมื่อกดสวิตช์/ค้นหา; รายการเปลี่ยนตามตัวกรอง
- **AC-13** เปิด `/shelters` ครั้งแรก (อนุญาต GPS) URL มี `user_lat`/`user_lng` และ `distance=5`; ปุ่ม "5 กม." อยู่ในสถานะกด และรายการจำกัดที่ 5 กม. ที่ DB
- **AC-14** กดปุ่ม "10 กม." → URL มี `distance=10` และรายการจำกัดที่ DB; กดปุ่มที่เลือกอยู่ซ้ำ → URL เป็น `distance=` ไม่มีปุ่มใดถูกกด รายการกลับเป็นทุกศูนย์ เรียงใกล้→ไกล และศูนย์ที่ไม่มีพิกัดอยู่ท้าย
- **AC-15** ปักหมุดค้นหาบนแผนที่เมื่อ URL ยังไม่มี `distance` → เพิ่ม `distance=5`; ถ้าผู้ใช้เลือกหรือยกเลิกรัศมีไว้แล้ว (`distance=10` / `distance=`) คงค่านั้น

## 3. Why

- ที่มา: #1419 ข้อ "ไม่แสดงบ้านพี่เลี้ยงในฝั่งผู้อพยพ" (ทีม — Before Floods) โดยไม่ระบุเหตุผลเพิ่ม
- ตัดสินใจ (owner, 2026-11-18): ซ่อนเฉพาะบ้านพี่เลี้ยงที่ไม่ใช่ External; ติดตามด้วย CR file
- ย้อน CR-067 Phase 1 บรรทัด "Public map: ไอคอนศูนย์ ≠ ไอคอนบ้านพี่เลี้ยง" เฉพาะหน้า `/shelters` และถอดสวิตช์ที่ #1417 เพิ่ม (#1417 ไม่มี CR แยก)
- ตัดสินใจ (owner, 2026-11-18, ต่อจากข้างบน): ย้ายการกรองไปที่ DB เพื่อลด load, การ์ดไม่ตามตัวกรอง และสร้าง endpoint ใหม่สำหรับจำนวนศูนย์ — อยู่ใน PR เดียวกับข้อ 3 ของ #1419
- ตัดสินใจ (owner, 2026-11-18 หลังประชุม): คงรัศมี 5 กม. ตามเดิม (ตามสรุปประชุม)
- เพิ่ม query และ endpoint แบบ additive: ค่าเริ่มต้นของทุกพารามิเตอร์ใหม่คือ "ไม่กรอง" ผู้เรียก `GET /public/v1/shelters` รายอื่น (หน้าอื่น, API ภายนอก) จึงได้ผลเหมือนเดิม
- ไม่ทำ pagination ในรอบนี้ (ข้อมูลหลักร้อย; ค้นหาใช้ regex แบบ escape ไม่สร้าง text index) — ทบทวนถ้าจำนวนศูนย์โตมาก
- เปิดครั้งแรกที่การ์ดขึ้น 210 แล้วเหลือ 10: `shelters_total` เคยนับจากรายการหลังกรองทุกชั้น (รวมรัศมี) ทำซ้ำได้ด้วย API จำลอง 210 ศูนย์
- ชั้น `volatile`: เปลี่ยนการแสดงผลฝั่ง client เท่านั้น ไม่แตะ auth / sync / schema

## 4. Impact

- **Backend:** `backend/apiapp/modules/shelter/{router,schemas,use_case}.py` — query ใหม่ + `GET /summary` (ประกาศก่อน `/{code}`); ใช้ field ที่ project ไว้แล้วใน `public_shelters` (`name`, `shelter_code`, `province`, `district`, `location_subtype`, `status`, `site_kind`, `is_external`, `parking_vehicle_types`) ไม่แก้ worker/projector; `backend/tests/test_shelter.py`
- **OpenAPI:** `frontend/src/lib/api-specs/fastapi.json`, `frontend/src/lib/api/openapi.d.ts` (regen, เพิ่มอย่างเดียว)
- **BFF:** `frontend/src/routes/api/public/v1/shelters/+server.ts` (ส่งต่อ query ใหม่), `summary/+server.ts` (ใหม่)
- **Frontend:** `public-portal/data/public-api.ts` (`fetchShelterSummary`, พารามิเตอร์ใหม่), `domain/types.ts`, `shelters/+page.ts`, `+page.svelte`, `shelter-filter-panel.svelte`, `i18n/public-filter-panel.ts`; เทสต์ `shelters/page.test.ts`, `shelter-filter-panel.dom.test.ts`, `site-kind.test.ts`, BFF `server.test.ts`, e2e `public-shelters-filter.test.ts` (fixture เปลี่ยนเป็นศูนย์อพยพใกล้ + บ้านพี่เลี้ยงที่ต้องไม่ขึ้น)
- **Docs (หลัง approve, PR แยก):** `docs/data/api-contract.md` — query ใหม่ของ list และ endpoint summary; แถวใน `docs/changes/_index.md`; หมายเหตุใน CR-067 ว่าข้อ "Public map" ถูกแก้เฉพาะหน้า `/shelters`
- **ผลต่อผู้ใช้:** สวิตช์ "บ้านพี่เลี้ยง" หาย; เปิดหน้าครั้งแรกยังเห็นศูนย์ในรัศมี 5 กม. ตามเดิม และยกเลิกรัศมีได้ด้วยการกดปุ่มระยะที่เลือกอยู่ซ้ำ; การ์ดตัวเลขไม่เปลี่ยนตามตัวกรอง; ลิงก์เก่าที่มี `hide_host_house` หรือ `distance` เปิดได้
- **ข้อควรระวังตอน deploy:** staging/prod ต้องใช้ backend ใหม่ก่อน frontend ใหม่ (หน้าใหม่เรียก `/summary`); ข้อมูล e2e ที่ provision ไว้บน staging (`E2E_SHELTERS_MARKER`) ต้องมีศูนย์อพยพใกล้จุด GPS แทนบ้านพี่เลี้ยงเดิม

## 5. Migration

N/A — ไม่เปลี่ยนรูป doc ที่ persist, ไม่ bump `schema_v`, ไม่ต้อง redeploy `_design/access`

## 6. Decision log

- 2026-08-13 — CR-067 (approved) ให้ public map แสดงไอคอนบ้านพี่เลี้ยงแยกจากศูนย์ (อ้างอิงบรรทัดใน CR-067 Phase 1)
- 2026-11-18 — owner ตัดสิน: ซ่อนเฉพาะบ้านพี่เลี้ยงที่ไม่ใช่ External; ติดตามด้วย CR file
- 2026-11-18 — owner เพิ่มขอบเขตใน #1419: กรองที่ DB, การ์ดไม่ตามตัวกรองด้วย endpoint ใหม่ — รวมเป็น CR เดียวกันและ PR โค้ดเดียว
- 2026-11-18 owner: คงรัศมี 5 กม. ตามเดิม (ตามสรุปประชุม)
- 2026-11-18 — proposed (ร่าง CR จาก #1419)
- 2026-11-18 — approved โดย kong; รันเลข CR-261 (เปลี่ยนชื่อจาก draft-public-shelters-search)
