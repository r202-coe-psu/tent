---
id: CR-107
title: Public booking — เก็บที่อยู่ภูมิลำเนาของหัวหน้าครัวเรือน (บังคับ) และไม่แสดง vulnerable group ที่ยังไม่มี label
status: approved
date: 2026-09-01
updated: 2026-09-03
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/features/site-occupancy-booking-program.md (ขอบเขตข้อมูลที่ public booking เก็บ)
  - docs/changes/CR-070-public-booking-gate-confirm.md, CR-081-public-booking-vehicles-ticket.md (ต่อยอด — field list ของ booking form)
  - frontend/src/lib/features/public-register/domain/booking.ts + booking.test.ts
  - frontend/src/lib/features/public-register/{data,application}/ (address cascade queries)
  - frontend/src/lib/features/public-register/ui/booking-form.svelte
  - frontend/src/routes/api/public/v1/config/locations/ (endpoint ใหม่)
  - frontend/src/routes/api/public/v1/registrations/registrations.test.ts, frontend/e2e/public-register.test.ts
  - ไม่ bump schema_v (`household.address_no|village_no|subdistrict|district|province|postal_code` มีอยู่แล้ว)
---

# ที่อยู่ภูมิลำเนาบนฟอร์มจองสาธารณะ + การซ่อน choice ที่ยังไม่มี label

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ฟอร์มจองผ่านเว็บเพิ่มบล็อก "ที่อยู่ตามภูมิลำเนาของหัวหน้าครัวเรือน" —
  บ้านเลขที่ + จังหวัด/อำเภอ/ตำบล (บังคับ), หมู่-ตรอก-ซอย-ถนน (ไม่บังคับ), รหัสไปรษณีย์เติมอัตโนมัติ
- **ทำไม:** หลังบ้านค้นหาและจัดกลุ่มครัวเรือนตามพื้นที่ แต่ booking จากเว็บลง CouchDB โดยไม่มี
  address columns เลย ครัวเรือนที่จองผ่านเว็บจึงหาไม่เจอด้วยที่อยู่
- **dev ต้อง build:** `publicBookingAddressSchema` + `address` ใน `publicBookingInputSchema`,
  BFF `/api/public/v1/config/locations` (cascade จังหวัด→อำเภอ→ตำบล), UI 5 ช่องใน section 1,
  และแก้ให้ vulnerable-group code ที่ resolve label ไม่ได้ **ไม่ถูกเรนเดอร์**
- **schema:** ไม่ bump `schema_v` — เขียนลงคอลัมน์ address ของ `household` ที่มีอยู่แล้ว

## Why

**1. ที่อยู่ภูมิลำเนา.** ฟอร์มลงทะเบียนฝั่ง staff (`householdPreRegisterAddressFormSchema`) บังคับ
ที่อยู่ครบทุกระดับ และหลังบ้านใช้ ตำบล/อำเภอ/จังหวัด ในการค้นหา จัดกลุ่ม และประสานงานพื้นที่ แต่
booking ผ่านเว็บ (CR-070 / T-71, ต่อด้วย CR-081) เก็บแค่ ศูนย์ + เบอร์โทร + สมาชิก + สัตว์เลี้ยง +
ยานพาหนะ ทำให้ `household` ที่เกิดจากเว็บมี `address_no|village_no|subdistrict|district|province|postal_code`
เป็น `null` ทั้งชุด — เจ้าหน้าที่ต้องถามซ้ำที่ประตูทั้งที่ประชาชนกรอกได้ตั้งแต่ตอนจอง

**2. choice ที่โชว์เป็นรหัสดิบ.** รายการ "ความต้องการพิเศษ" ในฟอร์มจองมาจาก
`shelter.admission_policy.supported_vulnerable_groups` (payload จาก **Mongo** ผ่าน sync worker)
แล้วแปลงเป็น label ด้วย `master_data:vulnerable_group` (อ่านจาก **CouchDB**) — สอง store คนละตัว
ที่ไม่ sync พร้อมกัน. ช่วงหลัง seed projection มี code แต่ master data ยังมาไม่ถึง โค้ดเดิม
`byCode.get(code) ?? code` จึงเรนเดอร์ checkbox ที่เขียนว่า `item_01M…` ให้ประชาชนเห็น

## Change

### ฟอร์มจอง — ที่อยู่ภูมิลำเนา (ใหม่)

- เพิ่ม `publicBookingAddressSchema` และ `publicBookingInputSchema.address` (**required object**)

  | field         | บังคับ | หมายเหตุ                                                    |
  | ------------- | ------ | ----------------------------------------------------------- |
  | `address_no`  | ✅     | บ้านเลขที่, ≤100 ตัวอักษร                                   |
  | `village_no`  | —      | หมู่ที่ / ตรอก / ซอย / ถนน, default `''`                    |
  | `province`    | ✅     | เลือกจาก dataset ประเทศไทย                                  |
  | `district`    | ✅     | เลือกจาก dataset (ขึ้นกับจังหวัด)                           |
  | `subdistrict` | ✅     | เลือกจาก dataset (ขึ้นกับอำเภอ)                             |
  | `postal_code` | —      | เติมจาก zipcode ของตำบลที่เลือก; ถ้ามีค่าต้องเป็นเลข 5 หลัก |

- **จังหวัด/อำเภอ/ตำบลเป็น picker ไม่ใช่ free text** — หลังบ้าน search/group ด้วยค่าที่ตรงกับ
  ที่ staff เลือก, ที่อยู่พิมพ์เองจะ match ไม่ได้
- เลือกระดับบนแล้วระดับล่างถูกล้างทั้งหมด (เปลี่ยนจังหวัด → อำเภอ/ตำบล/รหัสไปรษณีย์ ว่าง) —
  กันที่อยู่ครึ่ง ๆ กลาง ๆ ถูกส่ง
- `toHouseholdInput` เขียนลง `household.address_no|village_no|subdistrict|district|province|postal_code`
  ค่าว่าง (หมู่/ถนน, ตำบลที่ dataset ไม่มี zipcode) normalize เป็น `null` ไม่ใช่ `''`
- ข้อความ error เป็นไทยทั้งชุด ตามแนวเดียวกับ CR-081

### BFF — `/api/public/v1/config/locations` (endpoint ใหม่)

- staff plane มี `/api/v1/thailand-location/*` อยู่แล้ว แต่ public SPA **ห้ามเรียก service plane**
  (`serviceFetch` แนบ session cookie ของ staff) จึง re-expose helper เดิมบน public prefix
- handler เดียว 3 รูปแบบ ตามระดับที่กรอกมา: ไม่มี query → `{provinces}` · `?province=` →
  `{districts}` · `?province=&district=` → `{subdistricts:[{subdistrict, zipcode}]}`
- reference data ไม่มี PII → `Cache-Control: public, max-age=86400`; error ตอบ list ว่าง (ไม่ 500)

### ฟอร์มจอง — vulnerable group ที่ไม่มี label (แก้ของที่ผิดอยู่)

- **before:** `codes.map((code) => byCode.get(code) ?? code)` → code ที่ยังไม่มี label ถูกโชว์เป็น
  รหัสดิบ (`item_01M…`) ทั้งบน checkbox และค่าที่ถูกบันทึกลง `evacuee.special_needs`
- **after:** drop code ที่ resolve label ไม่ได้ทิ้งทั้งตัวเลือก — ไม่มี label = ไม่มี choice
- ผลข้างเคียงที่ยอมรับ: ถ้า master data ยังไม่ sync ประชาชนจะไม่เห็นรายการความต้องการพิเศษเลย
  ซึ่งดีกว่าให้ติ๊กรหัสที่อ่านไม่ออกและได้ `special_needs: ['item_01M…']` ติดไปกับ evacuee

## Impact

| ชั้น      | ผลกระทบ                                                                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| schema.md | ไม่มี field ใหม่ฝั่ง persist — ใช้คอลัมน์ address ของ `household` ที่มีอยู่ (ไม่ bump `schema_v`)                                                                          |
| wire      | `POST /api/public/v1/registrations` body **breaking**: `address` เป็น required — payload เดิมถูกปฏิเสธ 422                                                                 |
| code      | `public-register/` domain+data+application+ui, barrel `index.ts`/`server.ts`, i18n `public-booking-form.ts`, route `config/locations/`                                     |
| test      | `booking.test.ts` (+4 เคส), `registrations.test.ts` (fixture), `config/locations/server.test.ts` (ใหม่), e2e `public-register.test.ts` (fill address + เคส label ไม่ sync) |
| ประชาชน   | ฟอร์มจองมีช่องบังคับเพิ่ม 4 ช่อง — ใช้เวลากรอกนานขึ้นเล็กน้อย แลกกับที่อยู่ที่หลังบ้านค้นได้                                                                               |

## Migration

- **ไม่มี migration ของ doc ที่ persist แล้ว** — `household` ที่จองผ่านเว็บก่อนหน้านี้ยังมี address
  เป็น `null` ต่อไป (คอลัมน์ nullable อยู่แล้ว) และเจ้าหน้าที่แก้ที่อยู่ได้จากหน้า household profile
- **client ↔ server ต้อง deploy พร้อมกัน**: BFF ปฏิเสธ payload ที่ไม่มี `address` ตั้งแต่วินาทีแรก
  ฟอร์มเวอร์ชันเก่าที่ค้างอยู่ในเบราว์เซอร์จะจองไม่ผ่านจนกว่าจะ reload

## Acceptance

- [ ] กรอกฟอร์มโดยไม่เลือก จังหวัด/อำเภอ/ตำบล หรือไม่กรอกบ้านเลขที่ → submit ไม่ผ่าน ขึ้น error ไทย
- [ ] เลือกจังหวัดแล้วอำเภอ/ตำบลถูกล้าง; เลือกตำบลแล้วรหัสไปรษณีย์ถูกเติมให้เอง
- [ ] จองสำเร็จ → `household` มี `address_no/subdistrict/district/province` ครบ, หมู่/รหัสไปรษณีย์
      ที่ไม่ได้กรอกเป็น `null`
- [ ] `/api/public/v1/config/locations` ล่ม → ฟอร์มยังเปิดใช้งานได้ (ตัวเลือกว่าง ไม่ crash)
- [ ] ศูนย์ประกาศ vulnerable group ที่ยังไม่มี label ใน master data → ไม่มี checkbox รหัสดิบโผล่
- [ ] `pnpm lint`, `pnpm check`, `pnpm test` ผ่าน; e2e `public-register.test.ts` ผ่าน

## Decision log

- 2026-09-01 — proposed (เจ้าของโครงการสั่ง: เพิ่มที่อยู่ในฟิลด์หัวหน้าครัวเรือนเพราะหลังบ้านต้อง
  search ผ่านที่อยู่ + ห้ามโชว์ id ดิบเมื่อยังไม่มี label; เลือกรูปแบบ cascading select และบังคับกรอก
  ต./อ./จ. + บ้านเลขที่; ให้ track ด้วยไฟล์ CR)
- 2026-09-03 — approved (อนุมัติเป็น CR-107, ปรับแก้ Prettier linter และรวมเข้า develop)
