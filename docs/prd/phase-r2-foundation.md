---
title: "Phase R2 PRD: Foundation — Household, Zoning & Inventory"
status: active
phase: R2
month: มิ.ย.–ก.ค. 2026 (Foundation Gate 17 ก.ค.)
gate: Backoffice Foundation Gate
created: 2026-06-03
updated: 2026-06-18
---

# Phase R2 PRD: Foundation — Baseline, Household, Zoning & Inventory

## 0. Document Purpose

PRD ฉบับนี้กำหนด scope/FR/NFR ของ **Phase R2 (มิ.ย.–ก.ค. 2026, Foundation Gate 17 ก.ค.)** ซึ่งเป็น phase แรกของการ build ผู้อ่านคือ PM/SA, Product Owner, Lead pair + ทีมที่เกี่ยวข้อง (K-13 ปิดแล้วตาม Squad Roster) และ QA/Release Owner

**Greenfield:** ยังไม่มีระบบ MVP มาก่อน — phase นี้รวมการ build **Baseline FR-1–20** (registration-first: auth, person registration, screening, QR/movement, dashboard, export, offline, fallback) เป็นส่วนแรก ก่อน/ขนานกับ feature ใหม่ของ R2 ด้านล่าง Baseline spec อยู่ใน [`docs/features/`](../features/index.html) + [Task Breakdown module 0](../task-breakdown/00-baseline.md); เอกสารนี้ spec เฉพาะ **FR-21..FR-34** ที่ต่อยอดจาก baseline (numbering เดินต่อ: FR-21, NFR-12, UJ-5, SM-7) field contract อิง [Database Schema](../data/schema.md) + [Data Model](../data/data-model.md) ลำดับ phase และทีม ดูใน [Roadmap](roadmap.html)

จุดยืนของ R2: **build ฐานหน้างาน + ปูฐานหลังบ้าน** — baseline registration-first, Household/zoning และ resource backbone (Inventory) ที่ Donation/Kitchen/SOP ใน R3 ต้องใช้ ยังไม่เปิด module operations เต็ม

## 1. Vision

Baseline registration-first ระดับ Person คือ flow หน้างานหลักที่ต้อง build ให้เสร็จก่อน แต่หน้างานจริงคนมาเป็น **ครัวเรือน** และศูนย์ต้อง **จัดโซน** ตามกลุ่ม (ครอบครัว, ชาย/หญิง, สัตว์เลี้ยง, เปราะบาง) อีกทั้งของบริจาคเริ่มไหลเข้าทันทีที่เปิดศูนย์ ถ้าไม่มีคลังกลางจะเกิดภาวะ "ของกองล้นศูนย์หนึ่ง ขาดอีกศูนย์" แบบปี 2568

R2 เติมสามอย่างที่ทำให้ศูนย์ "บริหารได้" ไม่ใช่แค่ "ลงทะเบียนได้": ผูกคนเป็นครัวเรือนและจัดโซน, เปิดคลังสิ่งของกลางที่เห็น stock real-time ทุกศูนย์, และรับ intake ของบริจาคเข้าคลังอย่างมีระเบียน ฐานนี้คือ data backbone ที่ทำให้ R3 (donation cut-off, ครัว, SOP) ทำงานบนตัวเลขจริงได้

## 2. Target Users

### 2.1 Jobs To Be Done

- **Registration Officer** ต้องลงทะเบียนทั้งครัวเรือนในครั้งเดียว ผูกสมาชิกเข้าด้วยกัน และออก Household Shelter ID/QR โดยไม่ช้ากว่าการลงราย Person
- **Shelter Manager** ต้องจัดสรรผู้พักพิงเข้าโซนตามประเภทและความจุของแต่ละโซน เห็นว่าโซนไหนเต็ม
- **Warehouse / Supply Officer** *(role ใหม่)* ต้องรับสิ่งของเข้าคลัง บันทึกประเภท/จำนวน/หน่วย และแจกจ่าย/โอนระหว่างศูนย์ โดยมี stock ledger ที่ตรวจสอบย้อนหลังได้
- **Donor** *(no-auth public surface — FD-16, ไม่ใช่ login role)* ต้องแจ้งของที่จะบริจาคล่วงหน้า **โดยไม่ต้อง login** ให้ระบบบันทึกเข้า pipeline ของคลัง แล้ว track เองผ่าน `tracking_token`
- **System Admin** ต้องเพิ่ม role ใหม่และกำหนดสิทธิ์ระดับ field/action โดยไม่กระทบ permission เดิมของ baseline

### 2.2 Non-Users (R2)

- **Donor** — no-auth public surface (FD-16); สร้าง/track ผ่าน `tracking_token` ไม่มี account ใน users collection
- ทีมครัว, EOC, อาสาสมัคร — module ของพวกเขายังไม่เปิดใน R2 (เปิด R3/R4)
- ประชาชนค้นหาญาติ — public family search อยู่ R4

### 2.3 Key User Journeys

- **UJ-5. นัทลงทะเบียนทั้งครอบครัว 5 คนในคิวเดียว.**
  - **Persona + context:** นัท เป็น Registration Officer วันเปิดศูนย์ คนต่อคิวมาเป็นครอบครัว
  - **Entry state:** login เลือก Shelter เริ่ม Household registration session
  - **Path:** สร้าง Household → เพิ่มสมาชิกเป็น Person ทีละคน (หัวหน้าครัวเรือน + อีก 4) → ระบุความสัมพันธ์ขั้นต่ำ → บันทึกสัตว์เลี้ยง/ทรัพย์สินที่นำมา → submit
  - **Climax:** ระบบออก **Household Shelter ID/QR** หนึ่งใบ + Person ID รายคน และเสนอโซนที่เหมาะ (โซนครอบครัว)
  - **Resolution:** ทั้งครัวเรือน check-in เข้าโซนได้ในสแกนเดียว; dashboard นับเป็น 5 คน 1 ครัวเรือน
  - **Edge case:** เน็ตหลุด → บันทึกเป็น offline draft ทั้ง household แล้ว sync ภายหลังโดย ID mapping ไม่ซ้ำ

- **UJ-6. บอลรับรถบรรทุกน้ำดื่ม 500 แพ็คเข้าคลัง.**
  - **Persona + context:** บอล เป็น Warehouse/Supply Officer ศูนย์ระดับเทศบาล
  - **Entry state:** login เปิดหน้า Inventory ของศูนย์ตน
  - **Path:** เลือก "รับเข้า" → ประเภท=น้ำดื่ม, จำนวน=500, หน่วย=แพ็ค, ที่มา=ผู้บริจาค X → ยืนยัน
  - **Climax:** Stock Dashboard ของน้ำดื่มเพิ่มเป็น real-time และเห็นยอดเทียบทุกศูนย์
  - **Resolution:** เมื่อศูนย์ข้างเคียงขาด บอลสร้างใบ "โอนออก" 100 แพ็ค ระบบลด stock ตนและเพิ่มปลายทางหลังยืนยันรับ

## 3. Glossary *(เพิ่มจาก baseline)*

- **Household** — กลุ่มผู้พักพิงที่มาเป็นครัวเรือน/เดินทางร่วมกัน; ประกอบด้วย Person ตั้งแต่ 1 คนขึ้นไป มี Household Shelter ID/QR ของตนเอง 1 ต่อ 1 กับครัวเรือน
- **Household Head** — Person ที่เป็นผู้แทนครัวเรือนสำหรับการติดต่อและ check-in รวม
- **Zone** — พื้นที่ย่อยในศูนย์สำหรับจัดสรรผู้พักพิง (โซนครอบครัว / ชาย / หญิง / สัตว์เลี้ยง / เปราะบาง) มี capacity ของตนเอง
- **Zone Allocation** — การกำหนดว่า Person/Household อยู่โซนใด ณ เวลาหนึ่ง
- **Pet / Asset Record** — บันทึกสัตว์เลี้ยง ทรัพย์สิน หรือยานพาหนะที่ผู้พักพิงนำติดตัวมา ผูกกับ Person หรือ Household
- **Supply Item** — สิ่งของในคลัง จำแนกตามประเภท (อาหาร, น้ำดื่ม, ยา, ผ้าห่ม, อุปกรณ์อนามัย ฯลฯ) มีหน่วยนับมาตรฐาน
- **Stock Ledger** — บันทึกการเคลื่อนไหวของ Supply Item ทุกรายการ (รับเข้า, แจกจ่าย, โอน, ปรับยอด) ที่คำนวณ on-hand ได้
- **Stock Dashboard** — มุมมอง real-time ของปริมาณ Supply Item แยกประเภท ณ ทุกศูนย์
- **Inter-Shelter Transfer** — การโอน Supply Item จากศูนย์หนึ่งไปอีกศูนย์ ต้องมีการยืนยันรับปลายทาง
- **Donation Intake** — การรับของบริจาคเข้าสู่ Stock Ledger รวมถึง pre-declared donation จาก Donor
- **Reorder Threshold** — ระดับ stock ขั้นต่ำต่อ Supply Item ต่อศูนย์ ที่เมื่อต่ำกว่าให้ flag ขาดแคลน (ใช้เป็น input ของ Donation redirect และ SOP ใน R3)

## 4. Features

### 4.1 Household Registration & Grouping

**Description:** ขยาย Person registration ของ baseline ให้ผูกหลาย Person เป็น Household และออก Household Shelter ID/QR เพิ่มจาก Person ID เดิม โดยไม่ทำลาย Person-only flow ที่ baseline ใช้อยู่ Realizes UJ-5

#### FR-21: Create Household and Attach Members

Registration Officer สามารถสร้าง Household และผูก Person ตั้งแต่ 1 คนขึ้นไปเข้าด้วยกัน พร้อมระบุ Household Head

**Consequences (testable):**
- สร้าง Household ได้จากข้อมูลขั้นต่ำ: ระบุ Household Head 1 คน (เป็น Person ที่มี required fields `first_name` + `last_name` + `gender` + `phone|null` ตาม FR-5)
- เพิ่ม/ลบสมาชิกจาก Household ได้ และ Person หนึ่งคนอยู่ได้เพียง 1 Household ณ เวลาหนึ่ง
- Person-only registration เดิม (FR-4) ยังทำงานได้ — Household เป็น optional grouping ไม่ใช่ required step

#### FR-22: Household Shelter ID/QR

ระบบสร้าง Household Shelter ID/QR ที่ไม่ซ้ำ ระดับครัวเรือน เพิ่มจาก Person ID/QR เดิม

**Consequences (testable):**
- Household ID unique ภายใน scope ที่กำหนด และแยก namespace จาก Person ID ชัดเจน
- QR scan ของ Household เปิดผ่าน backend/permission check; payload ไม่บรรจุ sensitive data (ต่อ NFR-6)
- ทั้ง Household ID และ Person ID ใช้ค้นหา/check-in ได้

#### FR-23: Household Search & Check-in/out

ผู้ใช้ค้นหา Household และทำ check-in/check-out ทั้งครัวเรือนในครั้งเดียว หรือรายบุคคลในครัวเรือนก็ได้ ตามสิทธิ์

**Consequences (testable):**
- Household check-in เพิ่ม occupancy เท่าจำนวนสมาชิกที่ check-in จริง ไม่นับสมาชิกที่ยัง absent
- Check-in ระดับ Person ภายใน Household ยังทำได้ (สมาชิกบางคนมาทีหลัง)
- กัน check-in ซ้ำทั้งระดับ Household และ Person (ต่อ NFR-7)
- Movement history เก็บว่าเป็น household-level หรือ person-level action

**Out of Scope:** ความสัมพันธ์เชิงลึกในครัวเรือน (เครือญาติหลายชั้น) — เก็บแค่ member + head

#### FR-24: Pet, Asset and Vehicle Records

เจ้าหน้าที่บันทึกสัตว์เลี้ยง ทรัพย์สิน และยานพาหนะที่ผู้พักพิงนำมา ผูกกับ Person หรือ Household

**Consequences (testable):**
- บันทึก pet (ประเภท, จำนวน), asset, vehicle ได้โดยไม่ block registration
- จำนวนสัตว์เลี้ยงใช้เป็น input ของ zone allocation (โซนสัตว์เลี้ยง) ใน FR-25

### 4.2 Zoning & Allocation

**Description:** Shelter Manager จัดสรรผู้พักพิงเข้าโซนตามประเภทและความจุ ต่อยอดจาก capacity warning ของ baseline ที่เดิมเป็นระดับศูนย์ ให้ลงเป็นระดับโซน Realizes UJ-5

#### FR-25: Zone Definition and Capacity

System Admin / Shelter Manager กำหนดโซนของศูนย์ พร้อมประเภทและ capacity ของแต่ละโซน

**Consequences (testable):**
- โซนรองรับประเภท: ครอบครัว, ชาย, หญิง, สัตว์เลี้ยง, กลุ่มเปราะบาง (ขยายได้)
- ผลรวม zone capacity ไม่จำเป็นต้องเท่ากับ shelter capacity; ระบบเตือนเมื่อไม่สอดคล้อง
- โซนที่ปิดไม่รับ allocation ใหม่

#### FR-26: Assign Person/Household to Zone

ระบบเสนอโซนที่เหมาะตอน registration/check-in และเจ้าหน้าที่ยืนยันหรือ override ได้

**Consequences (testable):**
- ระบบ suggest โซนจากประเภทผู้พักพิง (ครอบครัว → โซนครอบครัว, มี pet → พิจารณาโซนสัตว์เลี้ยง, vulnerable flag → โซนเปราะบาง)
- Zone capacity เป็น **warning-only** ไม่ hard block (สอดคล้องหลัก capacity ของ baseline) override บันทึก actor
- ย้ายโซนได้และเก็บ history การย้าย

### 4.3 Inventory & Supply Management (Module C core)

**Description:** Warehouse/Supply Officer บริหารคลังสิ่งของกลางต่อศูนย์ ด้วย stock ledger ที่ตรวจสอบได้ และ stock dashboard ที่เห็น real-time ทุกศูนย์ Realizes UJ-6 — เป็น resource backbone ของ R3

#### FR-27: Supply Item Catalog

System Admin กำหนด catalog ของ Supply Item พร้อมประเภทและหน่วยนับมาตรฐาน

**Consequences (testable):**
- Supply Item มีประเภท (อาหาร/น้ำดื่ม/ยา/ผ้าห่ม/อนามัย/อื่น ๆ) และหน่วยนับที่ fix ต่อ item
- catalog เป็น master ใช้ร่วมทุกศูนย์ เพื่อให้ stock dashboard เทียบข้ามศูนย์ได้

#### FR-28: Stock Receive (Inbound)

Warehouse Officer บันทึกการรับ Supply Item เข้าคลังของศูนย์

**Consequences (testable):**
- รับเข้าได้พร้อม source marker (donation / transfer-in / manual) เพื่อ audit
- ทุกการรับเข้าเขียน Stock Ledger entry และเพิ่ม on-hand ทันที
- ปริมาณติดลบหรือศูนย์ถูก validate

#### FR-29: Stock Distribute (Outbound to Evacuees)

Warehouse Officer บันทึกการแจกจ่าย Supply Item ให้ผู้พักพิง

**Consequences (testable):**
- แจกจ่ายลด on-hand ทันทีและเขียน Ledger entry พร้อม actor/timestamp
- แจกจ่ายเกิน on-hand ถูกเตือน/ปฏิเสธ (ไม่ทำให้ stock ติดลบ — ต่อหลัก NFR-7)
- [ASSUMPTION] R2 บันทึกการแจกจ่ายระดับรวม/ต่อโซน; การผูกแจกจ่ายกับ Person รายคนเป็น optional และอาจเลื่อนไป R3 ครัว

#### FR-30: Inter-Shelter Transfer

เจ้าหน้าที่สร้างใบโอน Supply Item ระหว่างศูนย์ พร้อมการยืนยันรับปลายทาง

**Consequences (testable):**
- โอนออกลด stock ต้นทางเป็นสถานะ in-transit; ปลายทางต้องยืนยันรับก่อนเพิ่ม on-hand
- ของที่ยังไม่ยืนยันรับต้องไม่ถูกนับซ้ำทั้งสองศูนย์
- Transfer ทุกใบ auditable

#### FR-31: Stock Dashboard & Reorder Threshold

ระบบแสดง stock real-time แยกประเภทต่อศูนย์และข้ามศูนย์ พร้อม flag เมื่อต่ำกว่า reorder threshold

**Consequences (testable):**
- Stock Dashboard แสดง on-hand ต่อประเภทต่อศูนย์ และยอดรวมทุกศูนย์ พร้อม last-updated timestamp (ต่อหลัก dashboard baseline)
- ตั้ง reorder threshold ต่อ item ต่อศูนย์ได้; ต่ำกว่าเกณฑ์ → flag "ขาดแคลน"
- ตัวเลขต้อง reconcile กับ Stock Ledger ใน UAT (ต่อ SM แนวเดียวกับ dashboard baseline)

### 4.4 Donation Intake Foundation

**Description:** วาง pipeline รับของบริจาคเข้าคลัง รองรับ pre-declared donation จาก Donor เป็นฐานของ Donation cut-off/redirect/transparency ใน R3 (ยังไม่ทำ logic ตัดยอด/redirect ใน R2) Realizes UJ-6

#### FR-32: Donor Pre-Declaration (no-auth)

Donor แจ้งประเภท/ปริมาณของที่จะบริจาคล่วงหน้า ผ่าน QR/ฟอร์ม **โดยไม่ต้อง login/account** (FD-16) แล้วได้ `tracking_token` ไว้ติดตามสถานะเอง (เจ้าหน้าที่ยังแจ้งแทนได้ผ่าน walk_in/phone)

**Consequences (testable):**
- pre-declaration สร้างรายการ pending ที่ยังไม่เข้า on-hand จนกว่าจะรับจริง (FR-28)
- ผูก pre-declaration กับการรับเข้าจริงได้ เพื่อ reconcile
- **no-auth track (FD-16):** ระบบคืน `tracking_token` (random เดาไม่ได้); donor เปิด track ด้วย token ได้โดยไม่ login เห็นเฉพาะสถานะของตน — **ห้าม** lookup ด้วย `donation_code` ที่เป็น sequential (กัน enumeration/IDOR)
- **บังคับเบอร์ + OTP (FD-16):** ต้องกรอกเบอร์และยืนยัน OTP ก่อนสร้าง declaration เป็น anti-spam (lightweight, ไม่สร้าง session/account); เบอร์เก็บแบบ masked + ลง RoPA (FR-55)
- public donor write surface = rate-limit + CAPTCHA + anti-enumeration (ต่อ NFR-15/NFR-24)
- [SUPERSEDES FD-12(1)] Donor ไม่ใช่ RBAC role ที่มี login อีกต่อไป — เป็น public no-auth surface (ดู role matrix §7.4); ยังต้องผ่าน data-governance review ก่อนเปิด public

#### FR-33: Donation Intake Audit Trail

ทุก donation ที่เข้าคลังต้องตรวจสอบย้อนหลังได้ ระบุที่มาและผู้รับเข้า

**Consequences (testable):**
- เชื่อม donation intake → Stock Ledger โดยคง source = donation และ donor reference
- เป็น data source ของ Donation Transparency Report ใน R3

### 4.5 RBAC Extension & Data-Model Expansion (Platform)

**Description:** Lead pair (Platform/Core) ขยาย role/permission และ data model แบบ additive รองรับทุก feature R2 และเตรียม R3-R4 โดยไม่ทำลาย baseline

#### FR-34: New Roles & Field-Level Permissions

System Admin กำหนด role ใหม่ (`registration_staff`, `kitchen_staff`, `warehouse_staff`) พร้อมสิทธิ์ระดับ field/action — Volunteer Coordinator และ Security Officer ไม่ใช่ role แยก: ความรับผิดชอบเหล่านี้อยู่ที่ `shelter_manager` (CR-002, role-permission-matrix §4)

> หมายเหตุ: **Donor ไม่ใช่ RBAC role** (FD-16 — no-auth public surface) และ **EOC ไม่ใช่ human role** (FD-14 — API-key principal) จึงไม่อยู่ใน role ใหม่ชุดนี้

**Consequences (testable):**
- role ใหม่ enforce ทั้ง UI, API และ export (ต่อ NFR-4, NFR-5)
- permission เดิมของ baseline role ไม่เปลี่ยนพฤติกรรม (regression test ผ่าน)
- ขยายต่อจาก [Role Permission Matrix full-system](role-permission-matrix.html) (lean 5 roles — K-12)

**Notes:** [NOTE FOR PM] ต้อง approve role matrix ขยายก่อนต้น R2 — ถือเป็น phase-blocker สำหรับ squad อื่นที่ขึ้นกับ permission ใหม่

## 5. Non-Goals (R2)

- ไม่ทำ Donation cut-off / smart redirect / transparency report (logic อยู่ R3 — R2 แค่ intake foundation)
- ไม่ทำครัว/food tracking, volunteer, security module, referral (R3)
- ไม่ทำ SOP calculator (R3) แม้ reorder threshold จะเป็น input ของมัน
- ไม่ทำ EOC/Open API (R4)
- ไม่ผูกการแจกจ่าย supply กับ meal/รายคนแบบเต็ม (R3 ครัว)
- ไม่ทำ public family search
- ไม่ทำ full offline sync สำหรับ inventory/household (offline ยังเน้น registration/screening ตาม baseline)

## 6. Phase Scope

### 6.1 In Scope (R2)

- Household registration + Household Shelter ID/QR + household search + household check-in/out
- Pet/asset/vehicle records
- Zone definition, capacity, allocation (warning-only)
- Supply catalog, stock receive/distribute/transfer, stock dashboard, reorder threshold
- Donation pre-declaration + intake audit trail
- RBAC extension (role ใหม่ + field-level) + additive data-model expansion

### 6.2 Out of Scope for R2

- Donation cut-off/redirect/transparency → R3
- Kitchen, volunteer, security, referral → R3
- SOP calculator → R3
- EOC dashboard + Open API, family search → R4
- Per-person supply consumption ledger → R3 (ครัว)

## 7. Cross-Cutting NFRs *(เพิ่มจาก baseline NFR-1..NFR-11)*

- **NFR-12** (Performance): Household registration ของครัวเรือน ~5 คน ควรเสร็จในเวลาใกล้เคียง Person registration × จำนวนสมาชิก โดยไม่มี overhead จากการ grouping ที่ทำให้คิวช้า Validates FR-21, FR-23
- **NFR-13** (Reliability): Stock Ledger ต้อง consistent — on-hand ที่คำนวณจาก ledger ต้องตรงกับ stock dashboard เสมอ และห้ามมี stock ติดลบ Validates FR-28, FR-29, FR-30, FR-31
- **NFR-14** (Reliability): Inter-shelter transfer ต้องไม่ทำให้ของถูกนับซ้ำหรือหายระหว่าง in-transit (no double-count, no loss) Validates FR-30
- **NFR-15** (Security): role ใหม่ทั้งหมด enforce ที่ backend; **donor no-auth surface (FD-16)** ต้อง rate-limit + CAPTCHA + OTP บังคับเบอร์, track ด้วย `tracking_token` แบบ unguessable (ห้ามใช้ sequential `donation_code` เป็น public lookup → กัน IDOR/enumeration); ผ่าน governance review ก่อนเปิด public Validates FR-32, FR-34
- **NFR-16** (Compatibility): การขยาย data model ต้อง additive — baseline collections (`evacuees`, `movement_events` ฯลฯ) และ API เดิมต้องทำงานได้โดยไม่ migration ที่ทำลายข้อมูล Validates FR-34

## 8. Success Metrics *(ต่อจาก SM-6)*

**Primary**
- **SM-7**: Household throughput — ลงทะเบียนครัวเรือน 5 คนแล้ว check-in ทั้งครัวเรือนใน UAT ได้ถูกต้อง occupancy +5 Validates FR-21, FR-23
- **SM-8**: Stock correctness — on-hand บน Stock Dashboard ตรงกับ Stock Ledger หลัง receive/distribute/transfer ใน UAT (ผลต่าง = 0) Validates FR-28, FR-29, FR-30, FR-31

**Secondary**
- **SM-9**: Zone fit — ผู้พักพิงที่มี pet / vulnerable flag ถูก suggest โซนถูกประเภทใน UAT Validates FR-24, FR-26
- **SM-10**: Transfer integrity — โอนระหว่างศูนย์แล้วยอดรวมสองศูนย์คงที่ก่อน/หลังโอน Validates FR-30

**Counter-metrics (do not optimize)**
- **SM-C4**: อย่าเร่ง household registration จนข้าม screening/vulnerable flag รายบุคคล (สมาชิกแต่ละคนยังต้องคัดกรองได้) Counterbalances SM-7
- **SM-C5**: อย่าทำ stock dashboard ให้ดู real-time โดยข้าม ledger consistency (ตัวเลขสวยแต่ reconcile ไม่ได้) Counterbalances SM-8

## 9. Open Questions

1. ~~Donor pre-declaration เปิดให้ public โดยตรง หรือผ่านเจ้าหน้าที่เท่านั้น?~~ ✅ ปิดแล้ว — public no-auth + OTP/rate-limit (FD-16, CONFIRMED 2026-06-06); ยังต้องผ่าน governance review ก่อนเปิด
2. การแจกจ่าย supply ใน R2 ต้องผูกรายคนเลย หรือรอ R3 ครัว? (FR-29 ตั้ง assumption ว่ารอได้)
3. Zone capacity model ใช้ Sphere 3.5 ตร.ม./คน เป็น default หรือให้ admin กรอกเอง?
4. Household head เปลี่ยนได้ระหว่าง stay ไหม และกระทบ check-in รวมอย่างไร?

## 10. Assumptions Index

- [ASSUMPTION] FR-29 — R2 บันทึกการแจกจ่ายระดับรวม/โซน; ผูกรายคนเลื่อนไป R3 ได้
- ~~[ASSUMPTION] FR-32 — Donor อาจเป็น public/limited-access role~~ → ✅ ปิดแล้ว (FD-16): Donor = no-auth public surface (`tracking_token` + OTP); ยังต้องผ่าน governance review ก่อนเปิด public
- [ASSUMPTION] NFR-16 — data-model expansion ทำได้แบบ additive โดยไม่ต้อง destructive migration ของ baseline collections
