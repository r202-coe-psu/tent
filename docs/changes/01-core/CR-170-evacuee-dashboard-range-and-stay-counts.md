---
id: CR-170
title: Evacuee dashboard — ตัวเลือกช่วงวันที่ของกราฟลงทะเบียน + นับ arriving / room_confirmed ให้ครบ
status: approved
date: 2026-10-16
requested_by: ทีม dev (ตรวจ evacuee dashboard — กราฟไม่ครอบช่วงตั้งแต่เปิดศูนย์, ตัวเลข KPI ไม่ตรงกับข้อมูล)
decided_by: project owner
layer: volatile
affects:
  - docs/changes/01-core/CR-020-backoffice-dashboard-api.md §3 ข้อ 1–3
  - docs/data/schema.md §7 (views `demographics_by_age`, `demographics_by_country`)
  - CouchDB `_design/app` view manifest v2 → v3 (redeploy ทุก `shelter_*`)
  - GET /api/back-office/shelter/[code]/dashboard/registrations — default `from`/`to`, validate `from ≤ to`
  - GET /api/back-office/shelter/[code]/dashboard/occupancy — payload เพิ่ม `arriving`, `room_confirmed`, `in_shelter`
  - frontend/src/lib/features/dashboard/{domain,application}
  - frontend/src/lib/features/shelters/domain/{views,view-manifest}.ts
  - frontend/src/routes/(protected)/back-office/evacuee-management/dashboard-*.svelte
  - no schema_v bump (ไม่เปลี่ยน doc ที่ persist)
  - "amend 2026-10-25: view manifest v3 → v4 (`registrations_by_date_status` + series `preregister`), registrations payload + `preregister`"
updated: 2026-10-25
---

# CR-170 — Evacuee dashboard: ช่วงวันที่ของกราฟ + นับสถานะ CR-106/CR-112 ให้ครบ

> **สรุป (TL;DR):**
>
> - **กราฟสถิติการลงทะเบียน:** เพิ่มตัวเลือกช่วงวันที่ — 7 / 14 / 30 วันล่าสุด, ตั้งแต่เปิดศูนย์ (ค่าเริ่มต้น), กำหนดเอง —
>   แทนช่วงตายตัว 14 วัน; ทุกวันที่คิดตาม Asia/Bangkok; API ตอบ `422 VALIDATION` เมื่อ `from > to`
> - **การ์ด KPI:** `arriving` นับในยอดรวม; "อยู่ในศูนย์อพยพ" = `active` + `room_confirmed`; เพิ่มการ์ด `arriving`
> - **ช่วงอายุ / ประเทศ:** view นับ `active` + `room_confirmed` (เดิม `active` อย่างเดียว) → view manifest v3
> - **ไม่ bump `schema_v`**

---

## Why

- CR-020 §3 ข้อ 1 กำหนดแค่ "จำนวนคนลงทะเบียนรายวัน" ไม่ได้กำหนดช่วงวันที่ ช่วงที่ใช้อยู่เป็นค่าที่โค้ดตั้งเอง: 30 วัน
  (`acf473f4e`) → 14 วัน (`3245bd97b`, 2026-07-07, refactor ไม่มี CR) ศูนย์ SH001 (dev data) มีการเข้าพัก 363 จาก 368
  ครั้งในวันที่สร้างศูนย์ (2026-09-22) ซึ่งอยู่นอกช่วง 14 วัน กราฟจึงแสดงเกือบว่าง
- `defaultDateRange()` คิด "วันนี้" ตาม UTC แต่ view `registrations_by_date_status` แบ่งวันตาม +07:00 — ช่วง 00:00–07:00 น.
  กราฟไม่แสดงยอดของวันนี้
- `rowsToOccupancyPayload` รู้จักแค่สถานะก่อน CR-106/CR-112 จึงทิ้ง `arriving` และ `room_confirmed`: SH001 แสดงยอดรวม 377
  (จริง 460) และ "อยู่ในศูนย์อพยพ" 236 (จริง 287)
- view `demographics_by_age` / `demographics_by_country` นับเฉพาะ `active` — ไม่นับ `room_confirmed` (SH001 ขาด 51 คน)

## Requirements

### กราฟสถิติการลงทะเบียน — ตัวเลือกช่วงวันที่ (UI)

- **FR-1** — หัวการ์ด "สถิติการลงทะเบียน" ต้องมีตัวเลือกช่วงวันที่ 5 แบบ: `7 วันล่าสุด`, `14 วันล่าสุด`, `30 วันล่าสุด`,
  `ตั้งแต่เปิดศูนย์`, `กำหนดเอง`
- **FR-2** — `N วันล่าสุด` = วันนี้ย้อนหลังรวม N วัน (`from` = วันนี้ − (N−1) วัน, `to` = วันนี้)
- **FR-3** — `ตั้งแต่เปิดศูนย์` = `from` คือวันที่ (Asia/Bangkok) ของ `created_at` ใน registry `shelter`; ถ้ามี movement
  ที่ลงวันที่ก่อนหน้านั้น ให้ `from` ถอยไปที่วันของ movement แรก; `to` = วันนี้
- **FR-4** — `กำหนดเอง` ต้องให้เลือก `from` และ `to` (รวมปลายทั้งสองข้าง) ด้วย `DateRangePicker`; ต้องบังคับ `from ≤ to` และ
  `to ≤ วันนี้`; เมื่อเปลี่ยนมาเป็น `กำหนดเอง` ครั้งแรก picker เริ่มที่ช่วงที่แสดงอยู่
- **FR-5** — ช่วงเริ่มต้นเมื่อเปิดแท็บ = `ตั้งแต่เปิดศูนย์`
- **FR-6** — เปลี่ยนช่วงวันที่ต้องโหลดใหม่เฉพาะกราฟ; การ์ด KPI / ช่วงอายุ / ประเทศ ต้องไม่กลับไปเป็น skeleton; กราฟแสดงข้อมูลชุดเดิม
  (จางลง) จนชุดใหม่มาถึง; error ของกราฟแสดงในการ์ดกราฟเท่านั้น
- **FR-7** — เปลี่ยนศูนย์ที่เลือก หรือ reload หน้า → กลับไปใช้ช่วงเริ่มต้นตาม FR-5
- **FR-8** — ใต้หัวการ์ดแสดงช่วงวันที่ที่ใช้จริง (`range.from – range.to` จาก response)
- **FR-9** — ช่วง > 60 วัน แสดงแบบรายสัปดาห์, ≤ 60 วัน แสดงรายวัน (พฤติกรรมเดิม — คงไว้)

### API — `GET /api/back-office/shelter/[code]/dashboard/registrations`

- **FR-10** — query `from` / `to` (`YYYY-MM-DD`) เป็น optional
- **FR-11** — ไม่ส่ง `from` → ใช้กฎ FR-3 (อ่าน `created_at` ด้วย `findMasterByCode`; อ่าน view โดยไม่มี `startkey`);
  ไม่ส่ง `to` → วันนี้ตาม Asia/Bangkok
- **FR-12** — `from > to` หรือรูปแบบวันที่ผิด → `422 VALIDATION` (envelope ของ BFF) โดยไม่ query CouchDB
- **FR-13** — ทุกวันที่ต้องเป็น Asia/Bangkok ให้ตรงกับ bucket ของ view `registrations_by_date_status`
- **FR-14** — payload คงรูปเดิม (`shelter_code`, `range`, `checkin`, `checkout`, `total`); `range` = ช่วงที่ใช้ query จริง

### การ์ด KPI — `GET …/dashboard/occupancy`

- **FR-15** — payload ต้องมี `arriving` และ `room_confirmed` (นับตาม `current_stay.status`)
- **FR-16** — `total` = ผลรวมทุกสถานะยกเว้น `cancelled` (รวม `arriving` และ `room_confirmed`)
- **FR-17** — `in_shelter` = `active` + `room_confirmed`; การ์ด "อยู่ในศูนย์อพยพ" แสดง `in_shelter`
  (แคบกว่า CR-112 "Present" ที่รวม `temporary_leave` — สถานะนั้นมีการ์ด "ออกชั่วคราว" แยก)
- **FR-18** — เพิ่มการ์ด "รายงานตัวแล้ว (รอคัดกรอง/จัดที่พัก)" แสดง `arriving`
- **FR-19** — field `active` คงความหมายเดิม (`active` อย่างเดียว) — consumer อื่นที่ใช้ `active` ไม่เปลี่ยนใน CR นี้

### ช่วงอายุ / ประเทศ — CouchDB views

- **FR-20** — `demographics_by_age` และ `demographics_by_country` นับ evacuee ที่ `current_stay.status` ∈ {`active`, `room_confirmed`}
- **FR-21** — bump `SHELTER_VIEW_MANIFEST.version` 2 → 3 และ redeploy `_design/app` ทุก `shelter_*` ตาม CR-056
  (`deploy:shelter-views --deploy-candidate` → `--promote`) **ก่อน** deploy app รุ่นนี้ — ไม่เช่นนั้น view-version guard ตอบ 500

### Amend 2026-10-25 — แท่งจำนวนผู้ลงทะเบียนล่วงหน้า

- **FR-22** — กราฟสถิติการลงทะเบียนแสดงแท่งที่สาม "จำนวนผู้ลงทะเบียนล่วงหน้า" เรียงก่อน "ลงทะเบียนเข้า" และ "ลงทะเบียนออก";
  ใช้ช่วงวันที่และโหมดรายวัน/รายสัปดาห์เดียวกับแท่งเดิม (FR-1..FR-9)
- **FR-23** — ค่าต่อวัน = จำนวน doc `evacuee` ที่ `registered_via` ∈ {`web`, `kiosk`, `api`} และ `current_stay.status` ≠ `cancelled`
  โดยวันที่ = วันที่ (Asia/Bangkok) ของ `created_at`; นับเหตุการณ์การลงทะเบียน ไม่ใช่สถานะปัจจุบัน จึงยังนับอยู่หลังเช็คอิน;
  `registered_via = staff` (ลงทะเบียนหน้างาน) ไม่นับ
- **FR-24** — view `registrations_by_date_status` emit `[date, 'preregister']` จาก doc ตาม FR-23 เพิ่ม; series `checkin` /
  `checkout` จาก `movement` ไม่เปลี่ยน; consumer ที่ไม่รู้จัก series ใหม่ (system-overview `movementTotals`) ข้ามไป
- **FR-25** — payload registrations เพิ่ม `preregister` (`YYYY-MM-DD` → จำนวน) — แทนข้อความ "คงรูปเดิม" ใน FR-14;
  `total` ยังเป็นผลรวม `checkin` อย่างเดียว
- **FR-26** — bump `SHELTER_VIEW_MANIFEST.version` 3 → 4 และ redeploy `_design/app` ทุก `shelter_*` ก่อน deploy app (ลำดับเดียวกับ FR-21)

## Out of scope

- consumer อื่นที่ใช้ `occupancy.active` เป็น headcount: `shelters/ui/shelter-occupancy-cell.svelte`,
  `back-office/supply/+page.svelte`, `sop-ratios/ui/food-sphere-stock-tab.svelte` (ไม่นับ `room_confirmed` เช่นกัน — ต้องตัดสินแยก)
- Export / report (FR-15..16 ของ baseline)
- เก็บช่วงวันที่ที่เลือกใน URL หรือ localStorage

## Acceptance

- [ ] เปิดแท็บภาพรวม → กราฟใช้ `ตั้งแต่เปิดศูนย์`; `range.from` = วันที่สร้างศูนย์ (หรือ movement แรกถ้าเก่ากว่า)
- [ ] ศูนย์อายุ > 60 วัน + `ตั้งแต่เปิดศูนย์` → กราฟรายสัปดาห์
- [ ] `7 วันล่าสุด` → แกน X มี 7 วัน (รวมวันนี้)
- [ ] `กำหนดเอง` เลือกวันในอนาคตไม่ได้; เรียก API ตรงด้วย `from > to` → 422 `VALIDATION`
- [ ] 03:00 น. (Asia/Bangkok) movement หลังเที่ยงคืนนับเป็นวันนี้ และ `range.to` = วันนี้
- [ ] เปลี่ยนช่วง → การ์ด KPI / ช่วงอายุ / ประเทศ ไม่ขึ้น skeleton
- [ ] SH001 (dev data): ยอดรวม = 460, อยู่ในศูนย์อพยพ = 287, รายงานตัวแล้ว = 32, ช่วงอายุ/ประเทศรวม = 287
- [ ] Unit test: default `from` (FR-3/FR-13), `from ≤ to` (FR-12), preset (FR-2), occupancy mapper (FR-15..17), demographics map (FR-20)
- [ ] (amend) ลงทะเบียนล่วงหน้าผ่านเว็บ 1 คน → แท่ง "จำนวนผู้ลงทะเบียนล่วงหน้า" ของวันนั้น +1 และยังอยู่หลังเช็คอิน; ยกเลิกแล้วหายไป
- [ ] (amend) Unit test: map emit `preregister` เฉพาะ `web`/`kiosk`/`api` ที่ไม่ `cancelled`, ตัดวันตาม +07:00; mapper ไม่รวม `preregister` ใน `total`

## Impact

- `frontend/src/lib/features/dashboard/domain/registration.schema.ts` — `defaultRangeFrom` แทน `defaultDateRange`, presets +
  `registrationRangeParams`, refine `from ≤ to`
- `frontend/src/lib/features/dashboard/domain/occupancy.schema.ts` — `arriving`, `room_confirmed`, `in_shelter`
- `frontend/src/lib/features/dashboard/application/queries.ts` — `placeholderData: keepPreviousData` ของ registrations
- `frontend/src/lib/features/shelters/domain/views.ts`, `view-manifest.ts` (v3)
- `frontend/src/routes/api/back-office/shelter/[code]/dashboard/{registrations,demographics}/+server.ts` (+ tests)
- `frontend/src/routes/(protected)/back-office/evacuee-management/dashboard-{tab,kpi-cards,registration-card}.svelte`
- `docs/data/schema.md` §7, `docs/changes/01-core/CR-020-backoffice-dashboard-api.md` §3

## Migration

ไม่เปลี่ยน doc ที่ persist, ไม่ bump `schema_v`. **ต้อง redeploy view** (`_design/app` v3) ทุก `shelter_*` ก่อน release (FR-21).
client ที่ไม่ส่ง `from` จะได้ช่วงตั้งแต่เปิดศูนย์แทน 14 วัน.

## Decision log

- 2026-10-16 — proposed (ช่วงวันที่ของกราฟ); owner เลือก "ให้ผู้ใช้เลือกช่วงเอง", track เป็น CR ไฟล์ใหม่
- 2026-10-16 — ตรวจ query กับ dev data: `registrations_by_date_status` ตรงกับ movement ดิบ (ปัญหาอยู่ที่ช่วงวันที่);
  พบ occupancy mapper ทิ้ง `arriving`/`room_confirmed` และ demographics views นับเฉพาะ `active`
- 2026-10-16 — owner: `arriving` นับในยอดรวมแต่ไม่นับใน "อยู่ในศูนย์อพยพ"; redeploy view ได้; ค่าเริ่มต้นของกราฟ = `ตั้งแต่เปิดศูนย์`
- 2026-10-16 — approved
- 2026-10-25 — amend: owner ขอแท่งจำนวนผู้ลงทะเบียนล่วงหน้าในกราฟ; ไม่มี movement ตอนลงทะเบียนล่วงหน้า จึงนับจาก doc `evacuee`
  (`registered_via` + `created_at`); owner เลือก "จำนวนที่ลงทะเบียนล่วงหน้าในวันนั้น" (รวมตู้ kiosk) แทนยอดค้างรอเข้าพัก
  ซึ่งย้อนหลังไม่ได้; track เป็น amend ในไฟล์ CR-170 นี้; `api` (partner booking) และการไม่นับ `cancelled` เป็นข้อตัดสินของ dev
  ตามนิยาม — ให้ owner ทบทวน
