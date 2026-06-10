---
title: "Phase R3 PRD: Operations — Donation, Kitchen, Volunteer, SOP & Security"
status: draft
phase: R3
month: September 2026
gate: Operations Gate
created: 2026-06-03
updated: 2026-06-03
---

# Phase R3 PRD: Operations — Donation, Kitchen, Volunteer, SOP & Security

## 0. Document Purpose

PRD ฉบับนี้กำหนด scope/FR/NFR ของ **Phase R3 (กันยายน)** — phase ที่เปิด module operations หลังบ้านพร้อมกันหลาย track ผู้อ่านคือ PM/SA, PO, squad owners (S3-S7) และ QA/Release Owner

R3 ต่อจาก [R2 Foundation](phase-r2-foundation.html): ID numbering เดินต่อ (เริ่ม FR-35, NFR-17, UJ-7, SM-11) และพึ่ง resource backbone (Inventory, reorder threshold, donation intake) ที่ R2 วางไว้ ลำดับ dependency ดู [Roadmap §4](roadmap.html)

R3 เป็น **Operations Gate** และคร่อม **internal milestone สิ้น ก.ย. ~80% testable** (ดู [Roadmap §5](roadmap.html)) จึงเป็น phase ที่ scope หนาที่สุดและต้องรันขนาน 5 track — ไม่ใช่ hard finish ที่ต้องตัด scope; งานที่เหลือต่อใน R4 + buffer ต.ค.-ธ.ค.

## 1. Vision

R2 ทำให้ศูนย์เห็นคนเป็นครัวเรือนและเห็น stock R3 ทำให้ศูนย์ "เดินงานประจำวัน" ได้จริง: ของบริจาคไม่ล้นเพราะระบบตัดยอดและ redirect อัตโนมัติ, ครัวกลางวางแผนอาหารจากยอดผู้พักพิงจริง, อาสาสมัครถูกจับคู่กับงานตามทักษะ, ระบบคำนวณ SOP บอกว่าแต่ละวันต้องการวัตถุดิบ/อาสา/ของเท่าไร, และความปลอดภัย/การส่งต่อมีระบบรองรับ

หัวใจของ R3 คือเปลี่ยนข้อมูลที่ R2 เก็บ (occupancy, stock) ให้กลายเป็น **การตัดสินใจอัตโนมัติ** — cut-off, redirect, resource calculation — ที่ลดภาระคนหน้างานและกันความโกลาหลแบบปี 2568

## 2. Target Users

### 2.1 Jobs To Be Done

- **Donation Officer / Donor** ต้องให้ระบบปิดรับของที่เต็มแล้วและแนะนำให้บริจาคไปศูนย์ที่ขาด พร้อมรายงานโปร่งใสที่สาธารณะตรวจได้
- **Kitchen Lead** *(role ใหม่)* ต้องวางแผนอาหารจากยอดผู้พักพิงจริง บันทึกการรับ/ปรุง/แจกจ่ายอาหาร และรู้ว่าต้องเบิกวัตถุดิบจากคลังเท่าไร
- **Volunteer Coordinator** *(role ใหม่)* ต้องรับสมัครอาสา จับคู่ทักษะกับงานที่ขาด และจัดกะ
- **Shelter Manager** ต้องเห็นผลคำนวณ SOP รายวัน (ต้องการวัตถุดิบ/อาสา/ของเท่าไร) เพื่อวางแผนล่วงหน้า
- **Security Officer** *(role ใหม่)* ต้องติดตามการเข้า-ออกเชิงความปลอดภัยและดูแลคน+สัตว์ในศูนย์
- **Shelter Manager** ต้องส่งต่อ (referral) เมื่อศูนย์เต็ม อาหารขาด หรือมีผู้ป่วยฉุกเฉิน

### 2.2 Non-Users (R3)

- EOC/จังหวัด ยังไม่ดึงข้อมูลผ่าน Open API (R4)
- ประชาชนค้นหาญาติ (R4)

### 2.3 Key User Journeys

- **UJ-7. ฝนปิดรับผ้าห่มที่ศูนย์เต็มและ redirect ผู้บริจาค.**
  - **Persona + context:** ฝน เป็น Donation Officer ศูนย์ A ที่ผ้าห่มเต็มเป้าแล้ว
  - **Entry state:** ผู้บริจาคสแกน QR แจ้งจะบริจาคผ้าห่ม 200 ผืน
  - **Path:** ระบบเช็ค stock ผ้าห่มศูนย์ A = 100% → ปิดรับอัตโนมัติ → แสดงศูนย์ B,C ที่ผ้าห่มต่ำกว่า reorder threshold
  - **Climax:** ผู้บริจาคเห็นคำแนะนำ "ศูนย์ B ยังขาด 150 ผืน" และเลือก redirect ไป B
  - **Resolution:** รายการเข้า pipeline ของศูนย์ B; Transparency Report อัปเดตยอดรับ/แจกใน 24 ชม.

- **UJ-8. ครรชิตวางแผนมื้อเย็นจากยอดผู้พักพิง 1,200 คน.**
  - **Persona + context:** ครรชิต เป็น Kitchen Lead ศูนย์ระดับเทศบาล
  - **Entry state:** เปิดหน้า Kitchen ของศูนย์ตน เห็น occupancy ปัจจุบัน 1,200
  - **Path:** เลือกมื้อเย็น → ระบบ SOP คำนวณวัตถุดิบ (ข้าว/ไข่/ผัก ต่อจำนวนเตา) และจำนวนอาสาครัวที่ต้องการ → ครรชิตยืนยันเบิกวัตถุดิบจากคลัง
  - **Climax:** ใบเบิกตัด stock จาก Inventory อัตโนมัติ และบันทึกแผนมื้อ
  - **Resolution:** หลังเสิร์ฟ ครรชิตบันทึกยอดผู้เข้ารับอาหารจริง เพื่อปรับแผนมื้อถัดไป

## 3. Glossary *(เพิ่มจาก R2)*

- **Donation Reservation** — การจองบริจาคล่วงหน้าที่ระบบตรวจ stock คงค้างก่อนยืนยัน เพื่อกันการบริจาคพร้อมกันเกินเป้า
- **Donation Cut-off** — การปิดรับ Supply Item อัตโนมัติเมื่อ stock ถึงเป้า (เช่น 100% ของ target) ต่อศูนย์
- **Smart Redirect** — การแนะนำให้ผู้บริจาคโอนของไปศูนย์อื่นที่ยังต่ำกว่า reorder threshold
- **Donation Transparency Report** — สรุปการรับ/แจกจ่ายของบริจาคทุก 24 ชม. เผยแพร่สาธารณะพร้อม QR ตรวจสอบ
- **Meal Plan** — แผนอาหารต่อมื้อต่อศูนย์ คำนวณจาก occupancy และ SOP ratio
- **Meal Service Record** — บันทึกการรับ/ปรุง/แจกจ่ายอาหาร รวมยอดผู้เข้ารับจริง
- **Kitchen Requisition** — ใบเบิกวัตถุดิบจาก Inventory เข้าครัว ตัด stock ตาม FR-29 pattern
- **Volunteer** — อาสาสมัครที่ลงทะเบียน มีทักษะ (skill tags) และความพร้อม
- **Skill Match** — การจับคู่ Volunteer กับงานที่ต้องการทักษะตรงกัน
- **SOP Ratio** — อัตราส่วนมาตรฐาน (วัตถุดิบ/ของ/อาสา ต่อจำนวนผู้พักพิงต่อวัน) ที่ตั้งค่าได้
- **Resource Calculation** — ผลคำนวณความต้องการรายวันจาก occupancy × SOP Ratio
- **Security Event** — เหตุการณ์ด้านความปลอดภัย (เข้า-ออกผิดปกติ, incident) ที่บันทึกแยกจาก movement ปกติ
- **Referral** — การส่งต่อผู้พักพิง/ความต้องการไปยังศูนย์หรือหน่วยงานอื่น (ศูนย์เต็ม, อาหารขาด, ผู้ป่วยฉุกเฉิน)

## 4. Features

### 4.1 Donation Management Full (Module C — donation)

**Description:** ต่อยอด Donation Intake (R2) ด้วย logic ตัดยอด/redirect/รายงานโปร่งใส บนฐาน stock + reorder threshold ของ R2 Realizes UJ-7

#### FR-35: Donation Reservation (no-auth)

ผู้บริจาคจองบริจาคล่วงหน้า **โดยไม่ต้อง login** (FD-16) ระบบตรวจ stock คงค้างและความต้องการก่อนยืนยัน และผูกการจองกับ `tracking_token`

**Consequences (testable):**
- reservation แสดงความต้องการคงค้าง (target − on-hand) ต่อ item ต่อศูนย์ก่อนยืนยัน
- reservation ที่ยืนยันแล้ว reserve โควตา กันบริจาคซ้อนเกินเป้าจากหลายผู้บริจาคพร้อมกัน
- **no-auth (FD-16):** reservation ผูกกับ `tracking_token` + ผ่าน OTP/เบอร์เหมือน FR-32; donor แก้/ยกเลิกการจองของตนผ่าน token ได้โดยไม่ login
- reservation หมดอายุได้ถ้าไม่ส่งมอบตามเวลา แล้วคืนโควตา — กัน abuse จองทิ้งจน cut-off เพี้ยน (anonymous reservation = TTL สั้น + rate-limit ต่อเบอร์/IP)

#### FR-36: Donation Cut-off

ระบบปิดรับ Supply Item อัตโนมัติเมื่อ stock (รวม reservation) ถึงเป้า

**Consequences (testable):**
- เมื่อ on-hand + reserved ≥ target → item แสดงสถานะ "รับแล้ว/ปิดรับ" ต่อศูนย์
- cut-off ต่อ item ต่อศูนย์ ไม่กระทบ item อื่น
- เปิดรับใหม่อัตโนมัติเมื่อ stock ลดต่ำกว่าเป้า (จากการแจกจ่าย)

#### FR-37: Smart Redirect

เมื่อศูนย์เป้าหมายปิดรับ ระบบแนะนำศูนย์อื่นที่ต่ำกว่า reorder threshold

**Consequences (testable):**
- redirect list เรียงตามความขาดแคลน (gap จาก reorder threshold) ของ item เดียวกัน
- ผู้บริจาคเลือก redirect แล้วรายการเข้า pipeline ศูนย์ปลายทาง (FR-32 pattern)
- ไม่ redirect ไปศูนย์ที่ปิดรับ item นั้นเช่นกัน

#### FR-38: Donation Transparency Report

ระบบสรุปการรับ/แจกจ่ายของบริจาคทุก 24 ชม. เผยแพร่สาธารณะพร้อม QR ตรวจสอบ

**Consequences (testable):**
- รายงานรวมยอดรับ/แจกต่อ item ต่อศูนย์ในรอบ 24 ชม. จาก Stock Ledger (R2)
- report สาธารณะต้องไม่เปิด sensitive data ของผู้พักพิง (ต่อ NFR-5) — เป็น aggregate เท่านั้น
- QR เปิดรายงานฉบับตรวจสอบได้

**Notes:** [NOTE FOR PM] public transparency report เป็น public-facing surface → ต้องผ่าน data-governance review ก่อน publish (ต่อ NFR-15 ของ R2)

### 4.2 Central Kitchen & Food Tracking (Module D)

**Description:** Kitchen Lead วางแผนและติดตามอาหารจาก occupancy จริง โดยเบิกวัตถุดิบตัด stock จาก Inventory (R2) Realizes UJ-8

#### FR-39: Meal Plan from Occupancy

Kitchen Lead สร้าง Meal Plan ต่อมื้อต่อศูนย์ โดยระบบคำนวณวัตถุดิบจาก occupancy × SOP Ratio (FR-44)

**Consequences (testable):**
- Meal Plan ดึง occupancy ปัจจุบัน (รวม fast-track/diet ถ้ามี) เป็นฐานคำนวณ
- แสดงวัตถุดิบที่ต้องใช้ต่อมื้อตาม SOP Ratio
- ปรับจำนวนมื้อ/หัวด้วยมือได้ (override) พร้อม audit

#### FR-40: Kitchen Requisition (ตัด stock)

Kitchen Lead เบิกวัตถุดิบจาก Inventory เข้าครัว

**Consequences (testable):**
- requisition ลด on-hand ของ Supply Item ที่เป็นวัตถุดิบและเขียน Stock Ledger (ใช้ FR-29 pattern)
- เบิกเกิน on-hand ถูกเตือน/ปฏิเสธ (ต่อ NFR-13)
- requisition ผูกกับ Meal Plan เพื่อ reconcile แผนกับการใช้จริง

#### FR-41: Meal Service Record

Kitchen Lead บันทึกการแจกจ่ายอาหารและยอดผู้เข้ารับจริง รวมอาหารที่แจกออกนอกศูนย์

**Consequences (testable):**
- บันทึกยอดเสิร์ฟจริงต่อมื้อ; ส่วนต่างจากแผนใช้ปรับมื้อถัดไป
- แยกประเภท: ผู้พักพิงในศูนย์ / อาสา / แจกจ่ายนอกศูนย์ (ผู้ประสบภัยที่ยังอยู่ในที่ตั้ง)
- [ASSUMPTION] การผูก meal กับ Person รายคน (ใครรับมื้อไหน) เป็น optional; R3 เน้นยอดรวม/ประเภท

### 4.3 Volunteer Management & Skill Matching (Module A)

**Description:** Volunteer Coordinator รับสมัครอาสา จับคู่ทักษะกับงาน และจัดกะ Realizes ความต้องการอาสาจาก Resource Calculation (FR-45)

#### FR-42: Volunteer Registration & Skills

Volunteer ลงทะเบียนพร้อม skill tags และความพร้อม (availability)

**Consequences (testable):**
- volunteer profile เก็บ skill tags (เช่น แพทย์, ครัว, ขนของ, ดูแลเด็ก), availability และศูนย์ที่สังกัด
- ข้อมูลส่วนตัวอาสา mask ตาม role เช่นเดียวกับผู้พักพิง (ต่อ NFR-5)

#### FR-43: Skill Match & Task Assignment

ระบบจับคู่ Volunteer กับงานที่ต้องการทักษะตรงกัน และ Coordinator มอบหมาย/จัดกะได้

**Consequences (testable):**
- ระบบ suggest อาสาที่ skill ตรงและ available สำหรับงานที่เปิด
- มอบหมายงาน/กะแล้วเก็บ assignment history; กันมอบหมายชนเวลา
- งานที่มาจาก Resource Calculation (ต้องการอาสาครัว N คน) สร้างเป็น demand ให้จับคู่ได้

### 4.4 SOP Resource Calculator (Module B)

**Description:** ระบบคำนวณความต้องการรายวัน (วัตถุดิบ/ของ/อาสา) จาก occupancy × SOP Ratio เป็น input ของครัว, donation, volunteer — เป็น track ที่ depend ทุก producer จึงเริ่ม data contract แต่ต้น phase, logic มาทีหลัง Realizes UJ-8

#### FR-44: SOP Ratio Configuration

ผู้ดูแลตั้งค่า SOP Ratio (วัตถุดิบ/ของ/อาสา ต่อผู้พักพิงต่อวัน, ต่อเตาประกอบอาหาร ฯลฯ)

**Consequences (testable):**
- ตั้ง ratio ได้ต่อประเภททรัพยากร และต่อหน่วยอ้างอิง (ต่อหัว, ต่อเตา, ต่อครัวเรือน)
- ค่า default อ้างอิงมาตรฐาน Sphere/SOP ต้นฉบับ; override ได้พร้อม audit

#### FR-45: Daily Resource Calculation

ระบบคำนวณความต้องการรายวันต่อศูนย์จาก occupancy ปัจจุบัน × SOP Ratio

**Consequences (testable):**
- คำนวณวัตถุดิบ/ของ/จำนวนอาสาที่ต้องการต่อวันต่อศูนย์
- เทียบกับ on-hand stock (R2) → แสดง gap (ต้องเบิก/ต้องบริจาคเพิ่มเท่าไร)
- ผลคำนวณ feed เข้า Meal Plan (FR-39), Donation redirect (FR-37), Volunteer demand (FR-43)

#### FR-46: Resource Calculation Dashboard

Shelter Manager เห็นความต้องการรายวันและ gap เทียบ stock/อาสาในมุมมองเดียว

**Consequences (testable):**
- แสดง required vs on-hand vs gap ต่อทรัพยากรต่อวัน พร้อม last-updated
- ตัวเลข reconcile กับ occupancy + Stock Ledger ใน UAT

### 4.5 Security & Referral (Modules E + F)

**Description:** Security Officer ติดตามความปลอดภัยเข้า-ออกเชิง incident (ต่อยอด movement ของ MVP) และ **Shelter Manager** ส่งต่อ (referral) เมื่อศูนย์เต็ม/อาหารขาด/ผู้ป่วยฉุกเฉิน — referral owner = `shelter_manager` เดิม, ไม่เพิ่ม role ใหม่ (FD-13)

#### FR-47: Security Check-in/out & Safety Monitoring

Security Officer ติดตามการเข้า-ออกเชิงความปลอดภัยและบันทึก Security Event สำหรับคนและสัตว์

**Consequences (testable):**
- Security Event แยกจาก movement event ปกติ (FR-12/13) แต่ reference กันได้
- บันทึกเหตุการณ์ผิดปกติ (เข้า-ออกนอกเวลา, incident) พร้อม actor/timestamp; auditable
- ครอบคลุมความปลอดภัยสัตว์ในศูนย์ (ผูกกับ Pet Record FR-24)

#### FR-48: Referral & Hand-off

Shelter Manager (`shelter_manager`) สร้างคำขอส่งต่อ (ศูนย์เต็ม / อาหารขาด / ผู้ป่วยฉุกเฉิน) ไปศูนย์หรือหน่วยงานอื่น

**Consequences (testable):**
- referral ระบุประเภท (capacity / resource / medical-emergency), ต้นทาง, ปลายทาง, สถานะ
- referral medical-emergency: SM (referral owner) เห็น flag แต่ medical detail mask; detail เห็นเฉพาะ `medical_staff` + SA ผ่าน `is_medical_visible()` เดิม (ต่อ NFR-5, FD-13)
- สถานะ referral ติดตามได้จนปิด; auditable
- [ASSUMPTION] R3 ทำ referral ภายในเครือข่ายศูนย์ในระบบ; การส่งต่อหน่วยงานภายนอกเต็มรูปเชื่อมผ่าน EOC/Open API ใน R4

## 5. Non-Goals (R3)

- ไม่ทำ EOC dashboard รวมจังหวัด/Open API (R4) — R3 ผลิตข้อมูล ยังไม่ส่งออก
- ไม่ทำ public family search (R4)
- ไม่ทำ SOP simulation/what-if scenario (R4 หรือ backlog) — R3 ทำ calculator จริงเท่านั้น
- ไม่ทำ donation logistics/ขนส่งจริง (ระบบจัดการข้อมูล ไม่ใช่ fleet management)
- ไม่ทำ payroll/ค่าตอบแทนอาสา หรือระบบส่งเสริมอาชีพ (recovery phase, นอก scope)
- ไม่ทำ full offline sync สำหรับ module เหล่านี้ (online-first)

## 6. Phase Scope

### 6.1 In Scope (R3)

- Donation: reservation, cut-off, smart redirect, transparency report
- Kitchen: meal plan, requisition (ตัด stock), meal service record
- Volunteer: registration + skills, skill match + task/shift assignment
- SOP: ratio config, daily resource calculation, calculation dashboard
- Security: security check-in/out + safety monitoring (คน+สัตว์)
- Referral: referral & hand-off ภายในเครือข่ายศูนย์

### 6.2 Out of Scope for R3

- EOC dashboard + Open API → R4
- Public family search → R4
- SOP simulation/scenario → R4 หรือ backlog
- External-agency referral integration เต็มรูป → R4 (ผ่าน Open API)
- Per-person meal/supply consumption ledger → optional, backlog

## 7. Cross-Cutting NFRs *(เพิ่มจาก R2)*

- **NFR-17** (Reliability): Kitchen requisition และ donation intake/redirect ที่เขียน stock ต้องผ่าน Stock Ledger เดียวกับ R2 — ห้ามมี write path ที่ทำให้ on-hand ไม่ตรง ledger Validates FR-40, FR-35, FR-37
- **NFR-18** (Consistency): Resource Calculation ต้องคำนวณจาก occupancy + Stock Ledger ล่าสุด ไม่ cache ค้างจน gap ผิด; แสดง last-updated เสมอ Validates FR-45, FR-46
- **NFR-19** (Security/Privacy): public transparency report และ donor-facing redirect ต้องเป็น aggregate เท่านั้น ห้ามรั่ว PII; ผ่าน governance review ก่อน publish Validates FR-37, FR-38
- **NFR-20** (Security): medical-emergency referral และ volunteer PII ต้อง mask ตาม role ทั้ง UI/API Validates FR-42, FR-48
- **NFR-21** (Performance): 5 module รันขนานบน data เดียวกัน — read model ของ dashboard (stock, resource calc) ต้องไม่ scan record ทีละตัวต่อ request (ต่อ NFR-3) Validates FR-31, FR-46

## 8. Success Metrics *(ต่อจาก SM-10)*

**Primary**
- **SM-11**: Cut-off correctness — เมื่อ stock ถึงเป้า ระบบปิดรับ item นั้นและ redirect ไปศูนย์ที่ขาดใน UAT Validates FR-36, FR-37
- **SM-12**: Kitchen-stock integrity — Kitchen requisition ตัด on-hand ถูกต้องและ reconcile กับ Meal Plan ใน UAT (ผลต่าง = 0) Validates FR-40, FR-39
- **SM-13**: Resource calc correctness — Daily Resource Calculation ให้ตัวเลขตรงกับ occupancy × SOP Ratio และ gap ตรงกับ on-hand ใน UAT Validates FR-44, FR-45

**Secondary**
- **SM-14**: Skill match usefulness — งานที่ต้องการทักษะถูกจับคู่กับอาสาที่ skill ตรงและ available ใน UAT Validates FR-43
- **SM-15**: Transparency integrity — Transparency Report ยอดรับ/แจกตรงกับ Stock Ledger และไม่มี PII รั่ว Validates FR-38

**Counter-metrics (do not optimize)**
- **SM-C6**: อย่าทำ donation cut-off จนของจำเป็นถูกปิดรับทั้งที่บางศูนย์ยังขาด (redirect ต้องทำงานคู่กัน) Counterbalances SM-11
- **SM-C7**: อย่าเร่ง meal/requisition จนข้าม stock validation ทำให้ on-hand ติดลบ Counterbalances SM-12
- **SM-C8**: อย่าเปิด transparency/redirect data มากจนรั่ว PII เพื่อความโปร่งใส Counterbalances SM-15

## 9. Open Questions

1. SOP Ratio default ชุดแรกใช้ค่าใด (อ้าง Sphere/สพบ.) และใครเป็นเจ้าของค่ามาตรฐาน?
2. Donation reservation หมดอายุที่กี่ชั่วโมงก่อนคืนโควตา?
3. Transparency Report เผยแพร่ช่องทางใด (เว็บ public / QR เท่านั้น) และใคร approve การ publish?
4. Volunteer ลงทะเบียนเองผ่าน public หรือผ่าน Coordinator เท่านั้น? (กระทบ auth surface)
5. Security Event ต้องเชื่อม CCTV/access control hardware ไหม หรือเป็น manual log เท่านั้น? (default: manual)

## 10. Assumptions Index

- [ASSUMPTION] FR-41 — การผูก meal กับ Person รายคนเป็น optional; R3 เน้นยอดรวม/ประเภท
- [ASSUMPTION] FR-48 — referral ภายในเครือข่ายศูนย์ใน R3; external-agency เต็มรูปผ่าน Open API ใน R4
- [ASSUMPTION] SOP Calculator เริ่ม data contract แต่ต้น phase ขนานกับ producer; calc logic ส่งท้าย phase (Roadmap §7 risk)
