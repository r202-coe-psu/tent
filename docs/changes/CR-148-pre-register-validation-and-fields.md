---
id: CR-148
title: Pre-register validation hardening + religion/disability "other" + dorm address fields
status: approved
date: 2026-10-03
requested_by: usability test feedback (public pre-register + Station 1 registration)
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §1.1 evacuee — add `religion_other`, `disability_other_detail`; schema_v 10 → 11
  - docs/data/schema.md §1.3 household — add `dorm_name`, `dorm_building`, `dorm_floor`, `dorm_room`; schema_v 5 → 6
  - docs/data/schema.md §unassigned_registration — member + household carry the same new fields
  - frontend/src/lib/features/people/domain/{people,unified-registration,religion-ui,birth-calendar}.ts
  - frontend/src/lib/features/public-register/domain/{booking,unassigned-registration}.ts
  - frontend/src/lib/db/model.ts (phone normalization)
  - frontend/src/lib/utils/thai-id.ts (new — shared checksum; moved from volunteer-portal domain)
  - frontend/src/lib/features/people/ui/forms/{personal-info-fields,household-address-fields,vulnerable-groups-fields}.svelte
  - frontend/src/lib/features/people/ui/registration/{unified-registration-form,unified-registration-pets-section}.svelte
  - frontend/src/routes/api/public/v1/registrations/+server.ts (+ unassigned-registrations)
---

# CR-148 — Pre-register validation hardening + "other" free text + dorm address

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** คุม validation ฟอร์มลงทะเบียน (public + Station 1) ให้เข้ม/สอดคล้องกัน — บัตร ปชช.
>   checksum, ปีเกิด 4 หลัก, อายุ/ปีเกิดขอบเขตเดียวกัน (≤150), จำนวนสัตว์มีเพดาน, เบอร์รับ `+66`,
>   ข้อความ error ตามปฏิทินที่เลือก (พ.ศ./ค.ศ.)
> - **เพิ่ม field:** `evacuee.religion_other`, `evacuee.disability_other_detail`,
>   `household.dorm_name|dorm_building|dorm_floor|dorm_room`
> - **schema_v:** evacuee 10 → 11, household 5 → 6 — additive ทั้งหมด ไม่ต้อง backfill
> - **ไม่กระทบ:** public plane projection (field ส่วนบุคคล ไม่ออก Mongo `public_*`)

---

## Why

ผลทดสอบการใช้งาน (หน้าแรก / Pre-register) พบว่า:

- ฟอร์มรับเลขบัตร ปชช. ไม่ครบ 13 หลักได้ และไม่ตรวจ checksum (มีฟังก์ชัน checksum อยู่แล้วแต่ใช้เฉพาะ
  volunteer portal)
- ปีเกิดพิมพ์ 1–3 หลักได้; ขอบเขตอายุ (`age ≤ 150` รวม 150) ไม่ตรงกับขอบเขตปีเกิด
  (`birth_year > currentBE − 150` ตัด 150 ออก) — อายุ 150 กรอกได้ แต่ปีเกิดที่ให้อายุ 150 ถูก reject
- จำนวนสัตว์ (`pets[].count`) ไม่มีเพดาน
- ช่องเบอร์ตัดเครื่องหมาย `+` แล้ว truncate ที่ 10 หลัก — เบอร์ `+66 81 234 5678` กลายเป็นเบอร์ผิด;
  ช่องเบอร์ค้นหาครอบครัวไม่กรองตัวเลข/ไม่มี inline error
- ข้อความ error ปีเกิดบอก「(พ.ศ.)」เสมอ แม้ผู้ใช้เลือกกรอกแบบ ค.ศ.
- ศาสนามี enum `other` แต่ UI map `other → unknown` และไม่มีช่องระบุ; ความพิการ `disability_other`
  ไม่มีช่องระบุรายละเอียด
- ที่อยู่หอพักใช้ `address_no` / `residence_landmark` ร่วมกัน — ไม่มีช่องอาคาร / ชั้น / เลขห้องแยก
  ทำให้เจ้าหน้าที่ตามหาห้องไม่ได้

## Change

### A. Validation (ไม่เปลี่ยน shape ที่ persist)

| ID | Requirement |
| --- | --- |
| FR-01 | เมื่อ `person_id.cardType = national_id` และ `number` ไม่ว่าง: ต้องเป็นตัวเลข 13 หลักพอดี **และ** ผ่าน checksum mod-11 ของบัตรประชาชนไทย มิฉะนั้น reject พร้อมข้อความ「เลขบัตรประชาชนไม่ถูกต้อง」 |
| FR-02 | checksum ใช้ฟังก์ชันเดียวทั้งระบบ (`$lib/utils/thai-id.ts`); volunteer portal ย้ายมาใช้ตัวเดียวกัน |
| FR-03 | FR-01 ใช้ตอน **create** และตอน **แก้ค่า `number`** เท่านั้น — doc เดิมที่เลขไม่ผ่าน checksum ยังอ่าน/บันทึก field อื่นได้ |
| FR-04 | `birth_year` (เมื่อกรอก) ต้องเป็นตัวเลข 4 หลัก; input จำกัด 4 หลัก + `inputmode="numeric"` |
| FR-05 | ขอบเขตปีเกิด = `currentBE − 150 ≤ birth_year ≤ currentBE` (**รวม** 150) ให้ตรงกับ `age ∈ [0, 150]`; ค่าคงที่ `MAX_AGE_YEARS = 150` ใช้ที่เดียว |
| FR-06 | เมื่อกรอกทั้ง `birth_year` และ `age`: \|age − (currentBE − birth_year)\| ≤ 1 มิฉะนั้น reject「อายุไม่ตรงกับปีเกิด」 |
| FR-07 | ข้อความ error ของปีเกิดอ้างปฏิทินที่ผู้ใช้เลือกอยู่ (พ.ศ. หรือ ค.ศ.) และแสดงช่วงที่รับได้ในปฏิทินนั้น; placeholder เปลี่ยนตาม toggle; ค่าที่เก็บยังเป็น พ.ศ. เสมอ |
| FR-08 | `pets[].count` เป็น int `1 ≤ count ≤ PETS_MAX_COUNT` และจำนวนสัตว์รวมต่อครัวเรือน ≤ `PETS_MAX_COUNT`; UI ปิดปุ่มเพิ่มเมื่อครบ พร้อมข้อความ |
| FR-09 | `normalizeThaiPhone(input)`: ตัดช่องว่าง/ขีด/วงเล็บ แล้วแปลง `+66XXXXXXXXX` / `66XXXXXXXXX` → `0XXXXXXXXX`; ค่าที่เก็บยังเป็นรูป `0XXXXXXXXX` (ตัวเลขล้วน) ตาม schema เดิม |
| FR-10 | FR-09 ใช้กับเบอร์สมาชิก, เบอร์ผู้ติดต่อฉุกเฉิน และเบอร์ค้นหาครอบครัว; ช่องเบอร์ต้องพิมพ์ `+` ได้ |
| FR-11 | ช่องเบอร์ค้นหาครอบครัว: กรองตัวเลขผ่าน FR-09, แสดง inline error เมื่อไม่ตรง `^0\d{8,9}$` |

**ค่าที่เคาะ (2026-10-03):** `PETS_MAX_COUNT = 10` ตัวต่อครัวเรือน · FR-06 คลาดเคลื่อนได้ **±1 ปี**

### B. Field ใหม่ — `evacuee` (schema_v 10 → 11)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `religion_other` | str\|null | opt | ระบุศาสนาเมื่อ `religion = other` — trim, ≤ 60 ตัวอักษร; ต้องไม่ว่างเมื่อ `religion = other`; ล้างเป็น `null` เมื่อเปลี่ยนศาสนาอื่น |
| `disability_other_detail` | str\|null | opt | รายละเอียดความพิการเมื่อ `vulnerable_groups` มี `disability_other` — trim, ≤ 120 ตัวอักษร; **ไม่บังคับ**; ล้างเป็น `null` เมื่อเอา `disability_other` ออก |

| ID | Requirement |
| --- | --- |
| FR-12 | UI ศาสนาแสดง 5 ตัวเลือก: พุทธ, อิสลาม, คริสต์, **อื่นๆ (ระบุ)**, ไม่ระบุ — เลิก map `other → unknown` |
| FR-13 | เลือก「อื่นๆ」→ แสดงช่อง `religion_other` (required) |
| FR-14 | ติ๊ก「ผู้พิการ (อื่นๆ)」→ แสดงช่อง `disability_other_detail` (optional) |

### C. Field ใหม่ — `household` (schema_v 5 → 6)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `dorm_name` | str\|null | opt | ชื่อหอพัก / อะพาร์ตเมนต์ — **required เมื่อ `housing_type = apartment_dorm`** |
| `dorm_building` | str\|null | opt | อาคาร / ตึก |
| `dorm_floor` | str\|null | opt | ชั้น (str — รองรับ "G", "M", "3A") |
| `dorm_room` | str\|null | opt | เลขห้อง — **required เมื่อ `housing_type = apartment_dorm`** |

| ID | Requirement |
| --- | --- |
| FR-15 | เมื่อ `housing_type = apartment_dorm` ฟอร์ม Residence แสดงช่อง หอพัก / อาคาร / ชั้น / เลขห้อง แทนช่อง「เลขห้อง / ห้องเลขที่」เดิม; ช่องที่อยู่ส่วนที่เหลือ (หมู่ / ตำบล / อำเภอ / จังหวัด / รหัสไปรษณีย์) คงเดิม |
| FR-16 | เขียน `address_no` เป็นค่าสรุปอัตโนมัติ `"<dorm_room> <dorm_name> อาคาร <dorm_building> ชั้น <dorm_floor>"` (ตัดส่วนที่ว่าง) เพื่อให้ผู้อ่าน `address_no` เดิม (รายงาน, export, search) ยังใช้ได้ |
| FR-17 | เปลี่ยน `housing_type` ออกจาก `apartment_dorm` → ล้าง `dorm_*` เป็น `null` |
| FR-18 | `unassigned_registration` (Mongo) เก็บ field ใหม่ตาม B/C และ claim คัดลอกไป Couch |

**ค่าที่เคาะ (2026-10-03):** FR-16 เขียนค่าสรุปลง `address_no` (consumer เดิมไม่ต้องแก้)

## Acceptance

- เลขบัตร 13 หลักที่ checksum ผิด → reject ทั้ง public และ Station 1; เลขถูก → ผ่าน
- ปีเกิด 3 หรือ 5 หลัก → reject; ปีเกิดที่ให้อายุ 150 → ผ่าน; อายุ 151 → reject
- เลือก ค.ศ. แล้วกรอกปีนอกช่วง → ข้อความ error เป็นปี ค.ศ.
- กรอกเบอร์ `+66812345678` / `+66 81-234-5678` → เก็บ `0812345678`
- จำนวนสัตว์รวมเกิน `PETS_MAX_COUNT` → เพิ่มไม่ได้ + มีข้อความ
- ศาสนา「อื่นๆ」ไม่ระบุข้อความ → reject; ระบุแล้ว persist `religion = other` + `religion_other`
- ติ๊ก「ผู้พิการ (อื่นๆ)」แล้วไม่กรอกรายละเอียด → ผ่าน
- หอพัก: ไม่กรอกชื่อหอหรือเลขห้อง → reject; กรอกครบ → persist `dorm_*` + `address_no` สรุป
- doc เดิม (evacuee schema_v ≤ 10, household ≤ 5) เปิด/แก้ไขได้โดยไม่ error
- unit test ใน domain ครอบคลุมทุกข้อด้านบน; Playwright flow pre-register ผ่าน

## Impact

- **Docs:** `docs/data/schema.md` §1.1, §1.3, §unassigned_registration (+ `updated:`)
- **Domain/Zod:** `people.ts` (`evacueeInputSchema`, profile edit schema, `minBirthYearBE`), `unified-registration.ts`, `religion-ui.ts`, `birth-calendar.ts`, `public-register/domain/booking.ts`, `unassigned-registration.ts`
- **Shared util:** `$lib/utils/thai-id.ts` (new), `$lib/db/model.ts` (`normalizeThaiPhone`); `volunteer-portal/domain/volunteer.ts` re-export
- **UI:** `personal-info-fields`, `household-address-fields`, `vulnerable-groups-fields`, `unified-registration-form` (family-search phone), `unified-registration-pets-section`
- **BFF:** `/api/public/v1/registrations`, `/api/public/v1/unassigned-registrations`
- **i18n:** `public-booking-form.ts` (labels + error copy ทั้ง th/en)
- **Worker/public plane:** ไม่กระทบ — field ใหม่เป็นข้อมูลส่วนบุคคล ไม่ project ออก `public_*`
- **ไม่อยู่ใน CR นี้:** guard ห้าม check-in จาก `pre_registered` ใน domain (ปัจจุบันบังคับเฉพาะ UI สถานี 3) — แยก CR หากต้องการ

## Migration

- **evacuee schema_v 10 → 11:** purely additive — `religion_other`, `disability_other_detail` default `null` ตอนอ่าน; doc เดิมไม่ต้อง backfill; เขียนใหม่ stamp schema_v 11
- **household schema_v 5 → 6:** purely additive — `dorm_*` default `null`; doc หอพักเดิมคงข้อมูลใน `address_no` / `residence_landmark` (ไม่ parse ย้อนหลัง); เขียนใหม่ stamp schema_v 6
- validation ที่เข้มขึ้น (FR-01, FR-04–FR-06) ใช้เฉพาะ input ใหม่/ค่าที่ถูกแก้ — ไม่ invalidate doc เดิม

## Decision log

- 2026-10-03 — proposed (draft; owner เลือก track แบบ CR ไฟล์เดียว รวมทุกข้อ pre-register)
- 2026-10-03 — approved — `PETS_MAX_COUNT = 10`; อายุ/ปีเกิด ±1; `address_no` = ค่าสรุปหอพัก; รันเลข CR-148 (ข้าม 144–147 ที่ schema.md note อ้างถึงแล้ว)
