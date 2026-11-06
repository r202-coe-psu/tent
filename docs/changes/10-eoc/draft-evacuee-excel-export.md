---
id: draft # draft (ตอน proposed) -> เปลี่ยนเป็น CR-NNN เมื่อเจ้าของโครงการ approve
title: Export Excel ในแท็บ dashboard ผู้อพยพ — รายชื่อชาวต่างชาติสำหรับกงสุล (PII) + ตัวเลข dashboard
status: proposed
date: 2026-11-06
updated: 2026-11-06
requested_by: Dev Team B (epic #1050 · issue #1206, #1207)
decided_by: รอเจ้าของโครงการ approve · DPO ยืนยัน O-1
layer: volatile
affects:
  - docs/data/schema.md §2.12 `audit` (เพิ่มค่า `reason = consulate_export` ของ `action = export` — enum `action` เดิม ไม่เพิ่มค่า)
  - docs/features/ (flow ของ evacuee-management dashboard — เพิ่มปุ่ม export 2 ปุ่ม, แก้พร้อม PR โค้ด)
  - frontend/src/lib/features/data-export/{domain,data,application,ui,index.ts} (feature ใหม่)
  - frontend/src/lib/features/people/ (barrel — อ่าน evacuee ผ่าน barrel เท่านั้น)
  - frontend/src/routes/(protected)/back-office/evacuee-management (แท็บ dashboard — การ์ดสัญชาติ + หัวแท็บ)
  - ไม่ bump schema_v (ไม่มี field ใหม่ ไม่มี view/index ใหม่ ไม่มี endpoint ใหม่)
---

# Export Excel ในแท็บ dashboard ผู้อพยพ (epic #1050)

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่มปุ่ม export `.xlsx` 2 ปุ่มในแท็บ dashboard ของ `/back-office/evacuee-management` — (1) รายชื่อผู้อพยพชาวต่างชาติ **ทีละประเทศ ทีละศูนย์** สำหรับกงสุล (มี PII) (2) ตัวเลขทุกส่วนของ dashboard
> - **เพื่อใคร/ทำไม:** เจ้าหน้าที่ศูนย์ส่งรายชื่อให้กงสุลและทำรายงานตัวเลขได้ โดยไม่ต้องไล่ดูทีละคน
> - **dev ต้อง build:** feature ใหม่ `features/data-export/` — สร้างไฟล์ใน browser ด้วย `exceljs` จากข้อมูลที่ผู้ใช้อ่านผ่าน session ตัวเอง; เขียน `audit` fail-closed เฉพาะไฟล์กงสุล
> - **กระทบ:** ไม่ bump `schema_v` · ไม่เพิ่ม role / endpoint / index / `export_job` · เพิ่มค่า `reason = consulate_export` ใน schema.md §2.12

---

## Why

- ระบบไม่มีทาง export ข้อมูลเป็น Excel (มีเพียง CSV ledger คลัง; `export_job` มีใน spec §5.2 เท่านั้น ยังไม่ implement)
- คำขอเดิม: export ข้อมูลกงสุล (ผู้อพยพแต่ละประเทศ) และ export ข้อมูล dashboard
- ไฟล์กงสุลเป็น **ช่องทางนำ PII ออกจากระบบช่องใหม่** จึงต้องกำหนดตัวตนในไฟล์ คอลัมน์ที่ห้ามออก และ audit ให้ชัดก่อน implement
- สร้างไฟล์ฝั่ง browser จากข้อมูลที่ผู้ใช้อ่านได้อยู่แล้ว เพื่อไม่ขยายสิทธิ์และไม่เพิ่ม server surface

## Change

### A. ปุ่มและสิทธิ์ (ใช้ร่วมทั้งสองไฟล์)

| ID | Requirement |
| --- | --- |
| FR-1 | ปุ่ม export ทั้งสองอยู่ในแท็บ dashboard ของ `/back-office/evacuee-management` และใช้ศูนย์ที่เลือกอยู่ในหน้านั้น |
| FR-2 | สิทธิ์ใช้ได้เฉพาะ SA และ shelter_manager (`requireEvacueeRegistration`) — ไม่เพิ่ม role; shelter_manager export ได้เฉพาะศูนย์ตนเอง, SA เลือกศูนย์ใดก็ได้ |
| FR-3 | ไฟล์สร้างใน browser ด้วย `exceljs` จากข้อมูลที่อ่านผ่าน session ของผู้ใช้; ไม่มี endpoint ใหม่, ไม่ใช้ `export_job`, ไม่เพิ่ม Mango index / view |
| FR-4 | export สำเร็จหรือล้มเหลวแจ้งด้วย toast เท่านั้น (ไม่ใช้ `console.log`) |
| FR-5 | เวลาในชื่อไฟล์และหัว sheet ใช้ +07 (`Asia/Bangkok`) |
| FR-6 | โค้ดอยู่ใน `src/lib/features/data-export/` (domain / data / application / ui) และถูก import จากแท็บ dashboard ผ่าน barrel `$lib/features/data-export` เท่านั้น; อ่าน evacuee ผ่าน barrel `$lib/features/people` |
| FR-7 | `writeWorkbook` (exceljs → Blob) เป็นตัวเดียวที่ใช้ร่วมทั้งสองไฟล์ |

### B. ไฟล์กงสุล — issue #1206 (มี PII)

**UI**

| ID | Requirement |
| --- | --- |
| FR-10 | การ์ดสัญชาติ (`dashboard-nationality-list`) มีปุ่ม "Export รายชื่อสำหรับกงสุล" |
| FR-11 | กดปุ่มแล้วเปิด dialog ให้เลือกประเทศ **1 ประเทศ**; ไม่มีตัวเลือก "ทุกประเทศ" และ export หลายประเทศในไฟล์เดียวไม่ได้ |
| FR-12 | รายการประเทศใน dialog แสดงเฉพาะประเทศที่ไม่ใช่ `THAILAND` และมีคนที่ export ได้ (FR-20) ในศูนย์ พร้อมจำนวนคน; ไม่มีชาวต่างชาติเลย → ปุ่มกดไม่ได้หรือ dialog แจ้งว่าไม่มีข้อมูล |
| FR-13 | ชื่อไฟล์ `consulate-{shelter_code}-{country}-{YYYYMMDD-HHmm}.xlsx`, มี sheet เดียว |

**คนที่อยู่ในไฟล์**

| ID | Requirement |
| --- | --- |
| FR-20 | รวมเฉพาะ evacuee ที่ `country` ตรงกับประเทศที่เลือก (เทียบหลัง trim + uppercase แบบเดียวกับ view `demographics_by_country`) **และ** `current_stay.status` ∈ {`arriving`, `active`, `room_confirmed`, `temporary_leave`, `transferred`, `checked_out`, `deceased`} |
| FR-21 | ไม่รวม `pre_registered`, `kiosk_registered`, `cancelled` และ doc ที่ `anonymized = true` |
| FR-22 | คนที่ `privacy.search_excluded = true` หรือ `consent.mode = basic` **ยังรวมในไฟล์** (การไม่แสดงในระบบค้นหาญาติคนละเรื่องกับการแจ้งกงสุล) — **รอ DPO ยืนยัน (O-1)** |
| FR-23 | อ่านด้วย `allByType('evacuee')` แล้วกรองฝั่ง client แบบเดียวกับหน้ารายชื่อ |

**คอลัมน์** (หัวคอลัมน์และค่าสถานะ 2 ภาษา ไทย / อังกฤษ เช่น "ชื่อ / First name")

| ID | Requirement |
| --- | --- |
| FR-30 | คอลัมน์ตามลำดับ: ลำดับ · ชื่อ · นามสกุล · เพศ · ปีเกิด (พ.ศ.) หรืออายุ · ประเทศ · ประเภทบัตร · เลขบัตร/passport · เบอร์โทร · สถานะการพัก · วันที่เริ่มสถานะ (`current_stay.since`) · โซน · ผู้ติดต่อฉุกเฉิน (ชื่อ / เบอร์ / ความสัมพันธ์) · ศาสนา · กลุ่มเปราะบาง · special needs (ดู FR-31) |
| FR-31 | **ต้องใส่** ศาสนา (`religion`; ถ้า `other` ให้แสดง `religion_other`), กลุ่มเปราะบาง (`vulnerable_groups` แสดงเป็นชื่อจาก master `vulnerable_group`, ต่อท้ายด้วย `disability_other_detail` เมื่อมี) และ special needs (`special_needs` คั่นด้วย `,`) — ค่าว่างให้เซลล์ว่าง. evacuee ไม่มี field ข้อมูลการแพทย์แยกต่างหาก จึงไม่มีคอลัมน์การแพทย์ |
| FR-32 | เรียงแถวตามชื่อ แล้วตามนามสกุล |

**Audit**

| ID | Requirement |
| --- | --- |
| FR-40 | ทุก export เขียน doc `audit` ลง `shelter_{code}` ด้วย `createAuditEntry` เดิม: `action: export`, `target_type: shelter`, `reason: consulate_export`, `context: {country, row_count}` |
| FR-41 | audit **ห้ามเก็บ**ชื่อหรือข้อมูลของคนในไฟล์ |
| FR-42 | **fail-closed:** เขียน audit ไม่สำเร็จ → ไม่ดาวน์โหลดไฟล์ และแจ้ง toast error |

### C. ไฟล์ตัวเลข dashboard — issue #1207 (ไม่มี PII รายบุคคล)

| ID | Requirement |
| --- | --- |
| FR-50 | ปุ่ม "Export Excel" ที่หัวแท็บ dashboard ใช้ศูนย์และช่วงวันที่เลือกอยู่บนจอ; ถ้า query ใดยังโหลดไม่เสร็จหรือ error ปุ่มกดไม่ได้ |
| FR-51 | ชื่อไฟล์ `dashboard-{shelter_code}-{YYYYMMDD-HHmm}.xlsx`; ภาษาไทย เป็นตัวเลขอย่างเดียว ไม่มีกราฟ |
| FR-52 | ไฟล์มี 1 sheet ต่อ 1 ส่วน รวม 6 sheet: KPI (`dashboard/occupancy`) · ลงทะเบียนตามวัน (`dashboard/registration`, ช่วงวันเดียวกับบนจอ) · ช่วงอายุ (`dashboard/demographics` `age_groups`) · สัญชาติ (`dashboard/demographics` `countries`) · เวลาบริการต่อจุด และ อันดับเจ้าหน้าที่ (`dashboard/station-times`) |
| FR-53 | ทุก sheet มีหัวบอกชื่อและรหัสศูนย์, ช่วงวัน, เวลาที่ export (+07) |
| FR-54 | ไม่มีข้อมูลรายคน → **ไม่เขียน `audit`** |

### D. นอกขอบเขต

- ไฟล์กงสุลรวมทุกศูนย์ (ต้องมี BFF อ่านทุก `shelter_*` — เปิด issue แยกเมื่อต้องการ)
- export ของ `/back-office/resource-dashboard` และ `/system-management/overview`
- `export_job` แบบ async ฝั่ง server
- ส่งไฟล์ให้กงสุลผ่านระบบ (อีเมล / API)
- export กราฟเป็นรูปภาพหรือ PDF · dashboard รวมหลายศูนย์
- Mango index หรือ view ใหม่สำหรับ country

## Impact

| ที่ | ผลกระทบ |
| --- | --- |
| `docs/data/schema.md` §2.12 | เพิ่มหมายเหตุค่า `reason = consulate_export` ของ `action = export` (`target_type: shelter`, `context: {country, row_count}`) — แก้พร้อม PR โค้ด หลัง approve |
| `docs/features/` | เพิ่มปุ่ม export 2 ปุ่มใน flow dashboard evacuee-management — แก้พร้อม PR โค้ด |
| code | feature ใหม่ `data-export` + แก้แท็บ dashboard (การ์ดสัญชาติ, หัวแท็บ) |
| security / PDPA | ช่องทางนำ PII ออกช่องใหม่ (เลขบัตร/passport, เบอร์, ผู้ติดต่อฉุกเฉิน, ศาสนา, กลุ่มเปราะบาง, special needs — ข้อมูลอ่อนไหว PDPA) — จำกัดด้วยสิทธิ์ FR-2, ทีละประเทศ FR-11, audit FR-40..42 |
| test | seam ตาม issue: S1 `buildConsulateRows` · S2 `listExportCountries` · S3 `buildDashboardSheets` · S4 `writeWorkbook` · S5 `exportConsulateList` (audit + fail-closed) · S6 dialog (DOM) |
| ไม่กระทบ | role matrix, `schema_v`, Mango index, `_design/*`, FastAPI / Mongo / worker, public plane |

## Migration

N/A — ไม่เปลี่ยนรูป doc ที่ persist; `audit` doc เดิมไม่ต้อง backfill (`reason` เป็น str อิสระ)

## Open decisions

| ID | ประเด็น | ผู้ตัดสิน | สถานะ |
| --- | --- | --- | --- |
| O-1 | คนที่ `privacy.search_excluded = true` หรือ `consent.mode = basic` ต้องอยู่ในไฟล์กงสุลหรือไม่ (FR-22 ตั้งเป็น "รวม") | DPO | รอยืนยัน — ถ้าผลเป็น "ไม่รวม" ให้แก้ FR-22 + S1 ก่อน merge |
