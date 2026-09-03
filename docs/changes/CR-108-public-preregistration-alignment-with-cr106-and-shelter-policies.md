---
id: CR-108
title: Public Pre-registration Alignment with CR-106 Decoupled Intake and Shelter Policies
status: done
date: 2026-09-03
updated: 2026-09-03
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/changes/CR-106-decoupled-registration-medical-screening-flow.md (ส่วนต่อขยาย public flow)
  - CONTEXT.md (Public Pre-registration definition)
  - frontend/src/routes/(public)/pre-register/ (dedicated page route ใหม่)
  - frontend/src/routes/api/public/v1/config/shelter-policy/ (endpoint ตรวจสอบ policy & feature flags)
  - frontend/src/lib/features/public-register/
  - frontend/src/lib/components/public-navbar.svelte
  - frontend/src/routes/(public)/
---

# CR-108: Public Pre-registration Alignment with CR-106 Decoupled Intake and Shelter Policies

## สรุป (TL;DR)

1. **Dedicated Page Route (`/pre-register`):** ยกเลิก Dialog modal (`BookingModal`) และเปลี่ยนเป็นหน้าเพจเฉพาะ `/pre-register` พร้อมรับ query parameter `?shelter=CODE` เพื่อรองรับการใช้งานบนสมาร์ตโฟนได้อย่างสมบูรณ์
2. **ระบบประวัติและการจัดเก็บในเครื่อง (`localStorage`):** บันทึกตั๋วการจองลงใน `localStorage` อัตโนมัติ พร้อมแท็บ "ประวัติการจองของฉัน" ให้ผู้ประสบภัยเปิดแสดง Person QR code ต่อเจ้าหน้าที่ประตูศูนย์ (Station 1 Report-in) ได้สะดวกรวดเร็ว แม้ไม่ได้ต่ออินเทอร์เน็ต
3. **ความสอดคล้องกับ CR-106 Demographics:**
   - รองรับบุคคลไม่มีนามสกุล (Mononym / ชาวต่างชาติ) ตาม CR-106 FR-18..20 โดย `last_name` เป็น optional และจัดรูปแบบ `household.label` สะอาดตา
   - เพิ่มการระบุปีเกิดและอายุ พร้อมปุ่มสลับศักราช **พ.ศ. (ค่าเริ่มต้น) / ค.ศ.** และระบบคำนวณอายุ ↔ ปีเกิด สองทางอัตโนมัติ
4. **ควบคุมตาม Flag ของศูนย์พักพิง (`allow_pets`, `allow_assets`, `allow_vehicles`):**
   - ให้บริการ endpoint [`/api/public/v1/config/shelter-policy?shelter=CODE`](file:///home/jakee/Projects/tent/frontend/src/routes/api/public/v1/config/shelter-policy/+server.ts) ดึงค่าจาก master doc ใน CouchDB
   - ปิดการกรอกและแสดงแบนเนอร์แจ้งนโยบายอย่างชัดเจน เมื่อศูนย์ปิดรับสัตว์เลี้ยง, ทรัพย์สิน หรือยานพาหนะ
5. **ฟอร์มสัตว์เลี้ยงและยานพาหนะมาตรฐานเดียวกับ `/people/new`:**
   - ปุ่มสลับ "ไม่มีสัตว์เลี้ยง" / "มีสัตว์เลี้ยง"
   - ปุ่มปรับจำนวนตามชนิดสัตว์ (`- / +`)
   - การ์ดรายละเอียดสัตว์เลี้ยงแต่ละตัว (ชื่อ, สุขภาพ/พฤติกรรม, กรง/สายจูง, ปุ่มลบ `X`)
   - แมปข้อมูลลง `pet.notes` ด้วยรูปแบบ `${name} | ${condition}` ตรงกับตัวอ่านของ Station 1
   - เพิ่มส่วนบันทึกทรัพย์สินมีค่าพิเศษ (`household.assets = { description, image_url: null }`)
   - เพิ่มส่วนยานพาหนะรองรับได้หลายคัน
6. **กล่องยืนยันเงื่อนไขและมาตรการความปลอดภัย (Policy Disclaimer):**
   - นำเงื่อนไขจริงของศูนย์ (`admission_policy`, `luggage_policy`, `parking_policy`) มาแสดงผ่าน `buildDisclaimerGroups`
   - บังคับติ๊กรับทราบเงื่อนไขความปลอดภัยก่อนส่งแบบฟอร์ม

---

## 1. Context & Motivation (Why)

- **ความไม่สอดคล้องระหว่างหน้างานและเว็บ:** การลงทะเบียนที่ศูนย์พักพิงได้รับการปรับปรุงตาม [CR-106](file:///home/jakee/Projects/tent/docs/changes/CR-106-decoupled-registration-medical-screening-flow.md) ให้แยก Station 1 (ทะเบียน), Station 2 (คัดกรองแพทย์), Station 3 (จัดโซน) แต่ระบบจองล่วงหน้าสำหรับประชาชน (Public Pre-registration) เดิมยังเป็น Dialog modal ที่คับแคบ ไม่เหมาะกับมือถือ และมีฟิลด์ข้อมูลที่ไม่ตรงกับหน้างาน
- **ปัญหาชื่อบุคคลไม่มีนามสกุล:** ในพื้นที่ประสบภัยมีชาวต่างชาติและผู้ไม่มีนามสกุล แต่ระบบเดิมบังคับนามสกุล
- **การขาดการเชื่อมโยงกับนโยบายศูนย์:** แบบฟอร์มเดิมเปิดรับสัตว์เลี้ยงและยานพาหนะเสมอ แม้ศูนย์พักพิงนั้นๆ จะตั้งค่าไม่อนุญาตให้นำสัตว์เลี้ยงเข้าพัก หรือไม่มีพื้นที่จอดรถ
- **ความเสี่ยงด้านความปลอดภัยและความรับผิดชอบ:** ประชาชนนำสัตว์เลี้ยงหรือทรัพย์สินมีค่ามาโดยไม่ทราบนโยบายของศูนย์พักพิงล่วงหน้า และไม่มีขั้นตอนยืนยันข้อกำหนดด้านความปลอดภัย

---

## 2. Requirements & Specification

### 2.1 Dedicated Page Route & Navigation
- **FR-01 (Route):** หน้าเฉพาะ `frontend/src/routes/(public)/pre-register/+page.svelte` และ `+page.ts`
- **FR-02 (Shelter Preselection):** อ่าน `?shelter=CODE` เพื่อ pre-select ศูนย์พักพิงโดยอัตโนมัติ
- **FR-03 (CTA Alignment):** ปรับปุ่มบน Navbar, Landing page (`/+page.svelte`), หน้ารายการศูนย์ (`/shelters`), และหน้าละเอียดศูนย์ (`/shelters/[id]`) ให้ลิงก์เข้าสู่ `/pre-register` ทั้งหมด ยกเลิกการเปิด `BookingModal`

### 2.2 Local Storage Persistence & Ticket History
- **FR-04 (Storage Manager):** จัดเก็บตั๋วลง `localStorage` คีย์ `tent_public_booking_tickets_v1` ผ่าน [`ticket-storage.ts`](file:///home/jakee/Projects/tent/frontend/src/lib/features/public-register/data/ticket-storage.ts) ป้องกันข้อมูลซ้ำซ้อน
- **FR-05 (History UI):** แท็บ "ประวัติการจองของฉัน" แสดงประวัติการจองทั้งหมด ตั๋ว และ Person QR code สำหรับสแกนเข้าประตูศูนย์
- **FR-06 (Banners):** แบนเนอร์แนะนำให้ทำรายการบนมือถือ และแบนเนอร์แจ้งเตือนหากมีตั๋วในเครื่องอยู่แล้ว

### 2.3 Demographics & Mononym Support (CR-106 Alignment)
- **FR-07 (Mononym Support):** `last_name` เป็น optional (`.default('')`) ใน [`publicBookingMemberSchema`](file:///home/jakee/Projects/tent/frontend/src/lib/features/public-register/domain/booking.ts)
- **FR-08 (Household Label):** `householdLabelFrom` ตัดช่องว่างต่อท้ายออกหากไม่มีนามสกุล (เช่น `ครอบครัวสมชาย`)
- **FR-09 (Calendar Era Toggle):** ปุ่มสลับ พ.ศ. (ค่าเริ่มต้น) และ ค.ศ. สำหรับปีเกิด พร้อมการคำนวณสองทางกับช่องอายุ

### 2.4 Shelter Policies & Feature Flags
- **FR-10 (Policy Endpoint):** `GET /api/public/v1/config/shelter-policy?shelter=CODE` อ่าน CouchDB master doc ของศูนย์ และส่งคืน `feature_flags` (`allow_pets`, `allow_assets`, `allow_vehicles`), `admission_policy`, `luggage_policy`, `parking_policy`
- **FR-11 (Dynamic Gating):** ซ่อน/ปิดการกรอก และแสดงข้อความนโยบายของศูนย์เมื่อหมวดสัตว์เลี้ยง ทรัพย์สิน หรือยานพาหนะไม่ได้เปิดใช้งาน

### 2.5 Pet, Asset, and Vehicle Forms (`/people/new` Alignment)
- **FR-12 (Pet Form):** ปุ่มสลับ มี/ไม่มี, ตัวนับชนิดสัตว์เลี้ยง (`- / +`), และการ์ดข้อมูลสัตว์เลี้ยงรายตัว (ชื่อ, อาการ, กรง/สายจูง, ลบ `X`)
- **FR-13 (Notes Encoding):** จัดเก็บ `${name} | ${condition}` ใน `pet.notes` เพื่อให้ฟังก์ชัน `petDetailFromGroup` ฝั่ง Station 1 แยกอ่านได้ทันที
- **FR-14 (Assets):** รองรับการระบุทรัพย์สินมีค่าพิเศษ และบันทึกลง `household.assets = { description, image_url: null }`
- **FR-15 (Vehicles):** รองรับการเพิ่มยานพาหนะได้สูงสุด 10 คัน (ประเภท + ทะเบียน)

### 2.6 Policy Disclaimer & Agreement
- **FR-16 (Disclaimer):** เมื่อมีการระบุสัตว์เลี้ยง ทรัพย์สิน หรือยานพาหนะ ระบบจะเรนเดอร์ข้อกำหนดจริงจากศูนย์พักพิงผ่าน `buildDisclaimerGroups`
- **FR-17 (Enforced Acknowledgment):** บังคับติ๊กยอมรับเงื่อนไขความปลอดภัยก่อนจึงจะสามารถกดยืนยันการจองได้

---

## 3. Verification & Validation

### Automated Tests
- **Vitest Unit Tests:** ผ่านครบ 100% (**170 test files, 2,161 tests passed**, 0 failures)
  - `src/lib/features/public-register/`: 45 tests (ครอบคลุม mononym, age/birth_year, assets, pets, localStorage persistence)
  - `src/routes/api/public/v1/config/shelter-policy/`: 3 tests (ครอบคลุมการดึง policy และ fallback)
  - `src/routes/api/public/v1/registrations/`: 29 tests (ครอบคลุม mononym bulk write, first name required, assets recording)
- **Type Checking:** `pnpm check` ผ่านโดยสมบูรณ์ (**0 errors, 0 warnings**)
- **E2E Tests:** ปรับปรุง `e2e/public-register.test.ts` ให้รองรับ `/pre-register` page, การจำลอง `/api/public/v1/config/shelter-policy` และการติ๊ก disclaimer agreement
