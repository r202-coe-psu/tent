---
id: CR-112
title: Registration foundation — Evacuee/Household/Pet schema, vulnerable groups, stay room_confirmed, occupancy triple, master seeds
status: approved
date: 2026-09-06
updated: 2026-09-06
requested_by: เจ้าของโครงการ (grill-with-docs session)
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/schema.md §1.1 evacuee (schema_v 9 → 10)
  - docs/data/schema.md §1.3 household (schema_v 4 → 5)
  - docs/data/schema.md §1.4 movement (confirm_room; check_out reason req)
  - docs/data/schema.md §3.3 master_data (add housing_type; expand vulnerable_group / pet_types seeds)
  - docs/data/api-contract.md (external residency additive fields; public occupancy forecast/present/in_zone)
  - docs/features/site-occupancy-booking-program.md (D-BOOK-OCC supersede toward Forecast)
  - CONTEXT.md
  - frontend/src/lib/features/people/domain/people.ts
  - frontend/scripts/seed.ts
  - backend public/external occupancy + stay allow-lists
tracking_note: >-
  track=CR file. sheet=OK 2026-09-06. Owner approved 2026-09-06.
  Pair: CR-113 (Unassigned Registration Mongo). Schema delta merged from
  docs/data/proposed-registration-foundation-schema-delta.md (superseded).
---

# Registration foundation — schema, seeds, stay & occupancy

## สรุป (TL;DR)

ขยายรากฐานลงทะเบียนผู้ประสบภัยบน Couch SoR: Anonymous ID, ที่อยู่อาศัยแบบไร้บ้านเลขที่, แยกกลุ่มเปราะบางกับ special needs, สัตว์เลี้ยงหมา/แมว/อื่นๆ, stay `room_confirmed` + movement `confirm_room`, occupancy สามชั้น (Forecast / Present / In-zone) แบบ additive · bump `evacuee` 9→10, `household` 4→5 · **ไม่รวม** Unassigned Registration Mongo ([CR-113](CR-113-unassigned-registration-mongo.md))

## Why

Field intake ต้องรับคนมีบัตร / ไม่มีบัตร / ชาวต่างชาติ และครัวเรือนที่ไม่มีบ้านเลขที่ โดยไม่ทำให้ Person เป็น entity แยกจาก Evacuee · Stakeholder ต้องการ track จนยืนยันถึงโซนจริง และแยกตัวเลขคาดการณ์กับคนที่ถึงศูนย์แล้ว · Master seed ต้องพร้อมใช้โดยไม่ตั้งมือ

## Change (before → after)

### Evacuee (`schema_v` 9 → 10)

| หัวข้อ | Before | After |
| --- | --- | --- |
| `person_id.cardType` | `national_id\|passport\|pink_card\|other` | เพิ่ม `anonymous`; เมื่อ `anonymous` ระบบออก `number = ANON-{ulid}` (unique) |
| Anonymous → มีบัตรภายหลัง | — | แทนที่ `person_id` ด้วยบัตรจริง; ไม่บังคับเก็บ ANON สำหรับค้นย้อน (audit/`card_snapshot` ได้) |
| `country` | req | คง `str` req ทุกคน; UI default `THAILAND` (ไม่บังคับ ISO) |
| `vulnerable_groups` | ไม่มี | ฟิลด์ใหม่ `[str]` opt default `[]` — codes จาก master `vulnerable_group` multi-select |
| `special_needs` | free-form `[str]` | คง free-form — **ไม่** ปน taxonomy กลุ่มเปราะบาง |
| `current_stay.status` | … `active` … | เพิ่ม `room_confirmed` หลัง `active` |
| Phone | ฟิลด์เดียว | คงฟิลด์เดียวต่อคน |

### Stay / movement

**เส้นหลัก**

```text
pre_registered → arriving → active → room_confirmed
pre_registered → cancelled
room_confirmed → temporary_leave | transferred | checked_out | deceased
active → temporary_leave | transferred | checked_out | deceased | room_confirmed
temporary_leave → active   (ต้อง confirm โซนใหม่ → room_confirmed)
checked_out | transferred → active   (re-entry ผ่าน check_in; ไม่มีสถานะ RE_ENTERED)
```

| หัวข้อ | Before | After |
| --- | --- | --- |
| Zone arrival | รวมใน check_in → `active` | Check-in → `active` (ได้โซน); Zone Arrival Confirmation → `room_confirmed` |
| Movement | ไม่มี confirm | เพิ่ม action `confirm_room` |
| Confirm UX | — | รายคน + bulk ทั้ง household; มีรายการค้างยืนยัน; ไม่ auto-timeout |
| Referral รพ. | `transferred` | คง `transferred` + `checkout_destination.type = referred_facility` |
| Check-out remark | optional | บังคับ `reason`/`notes` บน movement `check_out` |

### Occupancy metrics

| Metric | สถานะที่นับ |
| --- | --- |
| **Forecast** | `pre_registered`, `arriving`, `active`, `room_confirmed`, `temporary_leave` บน Couch ของศูนย์นั้น |
| **Present** | `active`, `room_confirmed`, `temporary_leave` |
| **In-zone** | `room_confirmed` เท่านั้น |

ไม่นับ: `transferred`, `checked_out`, `deceased`, `cancelled` · **ไม่นับ** Unassigned Registration ใน Mongo

| Surface | Before | After |
| --- | --- | --- |
| Public/booking occupancy field | D-BOOK-OCC=C: `active`+`pre_registered` | คงคีย์ `occupancy` = **Forecast** (สูตรใหม่) + เพิ่ม `present`, `in_zone` |
| Kitchen/SOP | `active` only | คง `active` only |
| External `shelter-residency` | `CHECKED_IN` \| `CHECKED_OUT` | คง binary; เพิ่มฟิลด์ additive (`stay_status` และ/หรือ `in_zone`) |
| Public family search status | ไม่มี `arriving`/`room_confirmed` | เพิ่มทั้งคู่; FE `isInShelterStatus` รวม `room_confirmed` (+ `temporary_leave` ตาม Present) |

### Household (`schema_v` 4 → 5)

| หัวข้อ | Before | After |
| --- | --- | --- |
| Role of status | state machine คู่ขนาน | compatibility เท่านั้น — SoT = สมาชิก Evacuee; UI ไม่ให้เลือกสถานะ household อิสระ |
| Derive `household.status` | transitions ในโค้ด | ตาราง derive ใน appendix A2 |
| `housing_type` | ไม่มี | `owned_house` \| `rented_house` \| `condo` \| `apartment_dorm` \| `homeless` |
| `residence_landmark` | ไม่มี | str opt |
| `address_no` เมื่อ homeless | UI มักบังคับ | ว่างได้เมื่อ `housing_type=homeless`; ต้องมี landmark **หรือ** geo ครบ |
| Pets `species` | `dog\|cat\|bird\|other` | `dog\|cat\|other`; `other` บังคับ `notes`; **migrate** `bird` → `other`+notes=`นก` |

### Master seeds

**vulnerable_group (active set)**

| code | label |
| --- | --- |
| `bedridden` | ผู้ป่วยติดเตียง |
| `dialysis` | ผู้ป่วยฟอกไต |
| `wheelchair` | ผู้ใช้วีลแชร์ |
| `psychiatric` | ผู้ป่วยจิตเวช |
| `elderly_dependent` | ผู้สูงอายุช่วยเหลือตัวเองไม่ได้ |
| `infant` | ทารก |
| `young_child` | เด็กเล็ก |
| `pregnant` | สตรีมีครรภ์ |
| `vision_impaired` | ผู้พิการทางการมองเห็น |
| `hearing_impaired` | ผู้พิการทางการได้ยิน |
| `disability_other` | ผู้พิการ (อื่นๆ / ไม่ระบุรายละเอียด) |
| `chronic_illness` | ผู้มีโรคประจำตัว/เรื้อรัง |

**Migrate รหัสเก่า (hard):** `elderly` → `elderly_dependent`; `disabled` → `disability_other`; `chronic_illness` คงรหัส (เข้า active set)

**pet_types:** `dog`, `cat`, `other` · migrate `bird` → `other`+notes

**housing_type:** ห้า code ด้านบน (master_type ใหม่)

**Geography:** `pnpm seed:thailand` เต็มประเทศ

### Booking (รายศูนย์บน Couch) — ขยายจาก CR-070

1. เกตจองใช้ **Forecast** เทียบ capacity  
2. Cancel hold: SA/SM/RS + audit; ห้าม hard-delete; D-HOLD-TTL ยัง **none**  
3. Report-in → `arriving` ยังนับ Forecast  
4. **No-show aging report — เลื่อนออกจาก CR นี้** (ยังไม่มี SOP; โน้ต stakeholder: จองล่วงหน้าอาจเป็นเดือน / interim ที่เคยพูด N=7 ไม่ lock)  
5. กันจองซ้ำด้วยเลขบัตร / เบอร์ / ANON ข้าม hold ที่ยังไม่ `cancelled`

## Requirements (atomic)

- FR-RF-01 — `person_id.cardType` รวม `anonymous`; สร้าง `ANON-{ulid}` เมื่อเลือก anonymous  
- FR-RF-02 — Evacuee มี `vulnerable_groups: [str]` แยกจาก `special_needs` free-form  
- FR-RF-03 — Stay enum รวม `room_confirmed`; movement `confirm_room` ตั้งสถานะนั้น  
- FR-RF-04 — ยืนยันถึงโซนได้รายคนและ bulk ครัวเรือน; มีรายการค้าง  
- FR-RF-05 — Check-out บังคับ remark บน movement  
- FR-RF-06 — Public occupancy คืน `occupancy`(=Forecast), `present`, `in_zone`  
- FR-RF-07 — External residency คง `CHECKED_IN|CHECKED_OUT` + ฟิลด์ additive  
- FR-RF-08 — Public search คืน `arriving` และ `room_confirmed` ได้  
- FR-RF-09 — Household มี `housing_type`, `residence_landmark` + กฎ validate homeless  
- FR-RF-10 — Pet species `dog|cat|other` + notes เมื่อ other; migrate `bird`  
- FR-RF-11 — Seed VG / housing_type ตามตาราง + hard migrate map; geo เต็ม ปท.  
- FR-RF-12 — `household.status` derive ตามตาราง; ไม่มี UI override อิสระ  
- FR-RF-13 — Booking gate ใช้ Forecast; กันจองซ้ำ; **ไม่** รวม no-show report job ใน CR นี้  

## Acceptance

- ลงทะเบียน anonymous ได้และค้นด้วย ANON ได้  
- ติ๊กกลุ่มเปราะบางหลายค่า + กรอก special needs อิสระ แล้ว persist แยกฟิลด์  
- Walk flow ถึง `room_confirmed`; occupancy สามตัวเลขสอดคล้องสูตร  
- สร้าง household `homeless` โดยไม่มี `address_no` ได้เมื่อมี landmark หรือ geo  
- เพิ่มสัตว์ `other` โดยไม่มี notes แล้ว validation ล้ม  
- External client เก่าที่อ่านแค่ CHECKED_IN/OUT ยังทำงาน  

## Impact

- Zod / `validate_doc_update` / movement guards / dashboard occupancy / public BFF / FastAPI allow-lists / seed scripts / `admission_policy` ที่อ้าง VG เก่า  

## Migration

- Evacuee 9→10: additive; `vulnerable_groups` default `[]`; stay เก่าอ่านได้  
- Household 4→5: additive; **backfill pets** `bird` → `other`+notes=`นก`  
- Master VG: seed ชุดใหม่ + migrate เอกสาร/`admission_policy` ตาม map  
- D-BOOK-OCC=C → supersede ความหมาย `occupancy` เป็น Forecast สูตรใหม่  

## Decision log

- 2026-09-06 — Q1–Q38 ล็อก; Q39+ sheet=OK (foundation bits: country, VG migrate, bird migrate, kitchen=active only; no-show report deferred)
- 2026-09-06 — Owner approve: `track=CR file` → **CR-112**; merge delta เข้า `schema.md`

## Open / out of scope here

- Unassigned Registration → [CR-113](CR-113-unassigned-registration-mongo.md)
- Pet image upload UX
- Offline ANON/บัตร merge
- No-show aging report / SOP


## Appendix A — Implementable contracts

### A1. Stay / movement guards

```text
StayStatus += room_confirmed

CONFIRM_ROOM_ELIGIBLE = [active]
CHECK_IN_ELIGIBLE     = [pre_registered, arriving, temporary_leave, checked_out, transferred]
  → result stay = active (zone required)
CHECK_OUT / TRANSFER_OUT / LEAVE_TEMPORARY / MARK_DECEASED eligible from:
  [active, room_confirmed]
ZONE_CHANGE eligible from: [active, room_confirmed]

movement.action += confirm_room
check_out: reason|notes required nonempty after trim
```

### A2. Household status derive

1. if no members OR every member `cancelled` → `cancelled`
2. else if any member Present (`active|room_confirmed|temporary_leave`) → `checked_in`
3. else if any member `arriving` → `arriving`
4. else if any member `pre_registered` → `pre_registered`
5. else if any member in `checked_out|transferred|deceased` → `checked_out`
6. else → `cancelled`

### A3. Public occupancy (additive)

```json
{
  "occupancy": 120,
  "present": 80,
  "in_zone": 55,
  "capacity": 200
}
```

`occupancy` === Forecast. Booking gate uses Forecast vs `capacity`.

### A4. External residency (additive)

```json
{
  "status": "CHECKED_IN",
  "stay_status": "room_confirmed",
  "in_zone": true
}
```

CHECKED_IN when stay ∈ `{active, room_confirmed, temporary_leave}`; else CHECKED_OUT.

### A5. Seed payloads

**vulnerable_group** active = table in body (รวม `disability_other`, `chronic_illness`).

**pet_types** active: `dog`, `cat`, `other`.

**housing_type** (new `master_type`):

| key | label |
| --- | --- |
| `owned_house` | บ้านตนเอง |
| `rented_house` | บ้านเช่า |
| `condo` | คอนโดมิเนียม |
| `apartment_dorm` | อพาร์ตเมนต์/หอพัก |
| `homeless` | คนไร้บ้าน / ไม่มีบ้านเลขที่ / ริมคลอง |

### A6. Locked grill items (foundation slice)

| Item | Lock |
| --- | --- |
| Q45 country | string `THAILAND` default |
| Q46/Q60 VG | hard migrate per map; active set includes `disability_other`, `chronic_illness` |
| Q47 bird | migrate → `other`+notes |
| Q48 kitchen | `active` only |
| Q59 no-show report | deferred from this CR |
