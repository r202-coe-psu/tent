---
title: "Phase R4 PRD: Integration — Family Search, Governance & Handover (+ deferred EOC/Open API)"
status: active
phase: R4
month: in-scope ส.ค. 2026 · deferred tail ≤14 ก.ย. 2026
gate: Final Handover Gate
created: 2026-06-03
updated: 2026-06-11
---

# Phase R4 PRD: Integration — Family Search, Governance & Handover (+ deferred EOC/Open API)

## 0. Document Purpose

PRD ฉบับนี้กำหนด scope/FR/NFR ของ **Phase R4** — phase ปิดโครงการส่วน software platform ผู้อ่านคือ PM/SA, PO, Lead pair + ทีมที่เกี่ยวข้อง (จับทีม **รอตัดสินใจ — K-13**) และ QA/Release Owner

R4 ต่อจาก [R3 Operations](phase-r3-operations.html): ID numbering เดินต่อ (เริ่ม FR-49, NFR-22, UJ-9, SM-16) R4 ไม่เพิ่ม module ปฏิบัติการใหม่ แต่เปิด public family search, ปิด governance/UAT/handover และ **ส่งออกข้อมูล aggregate** สู่ EOC/One Data ผ่าน API

**R4 แบ่งสองก้อนตาม schedule decision 2026-06-09** (ดู [_timeline](../task-breakdown/_timeline.md)):

- **In-scope (ส.ค. — ส่งมอบ 31 ส.ค., รันขนานกับปลาย R3):** Family Search + consent (FR-52/53), RoPA/retention minimal (FR-55 — บังคับเพราะ family search เปิด public = PII exposure จริง), cross-module UAT + hardening + handover (FR-56)
- **Deferred (หลัง go-live ก.ย., จบภายใน 14 ก.ย. — hard deadline งาน feature):** EOC aggregate API + API-key principal (FR-49/50 — FD-14), Open API tier (FR-51), SOP simulation (FR-54)

**EOC architecture (FD-14 + เคาะ 2026-06-11):** EOC/Open API เป็น **service แยก** จากระบบหลัก — worker/ETL อ่านจาก CouchDB มาสรุปเป็น aggregate read-model แล้ว expose เป็น API; **ไม่มี human EOC dashboard / EOC viewer role ในระบบหลัก** datastore ของ read-model รอตัดสินใจใน P-03 (K-17)

## 1. Vision

R2-R3 ทำให้แต่ละศูนย์เดินงานได้จริงและผลิตข้อมูล real-time (occupancy, stock, donation, kitchen, resource needs) R4 เปลี่ยนข้อมูลรายศูนย์ให้เป็น **ข้อมูล aggregate ระดับเมือง/จังหวัด** ที่ EOC และ One Data / Hat Yai ROD ดึงไปใช้ตัดสินใจได้ผ่าน API ที่ปลอดภัย (เราเป็น data producer ต้นน้ำ ไม่ทำ dashboard ซ้ำซ้อนกับระบบปลายทาง — FD-14)

พร้อมกันนั้น R4 ตอบโจทย์มนุษยธรรมที่เป็น core public feature: ให้ญาติค้นหาผู้พักพิงได้อย่างปลอดภัยภายใต้ PDPA (ส่งใน ส.ค. ก่อน go-live) และทำให้ระบบทั้งหมด **ส่งมอบได้** — RoPA ครบ, UAT ข้าม module ผ่าน, มี training และ runbook ให้ผู้ใช้จริงเดินต่อ

## 2. Target Users

### 2.1 Jobs To Be Done

- **EOC อำเภอ/จังหวัด (ระบบ/หน่วยงานภายนอก ผ่าน API key)** ต้องดึงภาพรวมทุกศูนย์ (ยอดผู้อพยพ, ทรัพยากร, กลุ่มเปราะบาง — aggregate เท่านั้น) ไปแสดง/ตัดสินใจในเครื่องมือของตน
- **One Data / Hat Yai ROD (ระบบภายนอก)** ต้องดึงข้อมูล aggregate ผ่าน Open API tier ที่ปลอดภัยและไม่มี PII
- **ประชาชน/ญาติ** ต้องค้นหาว่าคนในครอบครัวอยู่ศูนย์ไหน โดยไม่เปิดข้อมูลส่วนตัวเกินจำเป็น
- **Data Protection Owner (ศูนย์คอมพิวเตอร์ ม.อ.)** ต้องมี RoPA, consent, retention ขั้นต่ำครบก่อน family search เปิด public
- **ผู้ดูแลระบบ/ผู้ใช้จริงหลังส่งมอบ** ต้องมี training, user manual, runbook เพื่อดำเนินการต่อเอง

### 2.2 Non-Users (R4)

- ไม่มี module ปฏิบัติการใหม่ — operator หน้างานใช้สิ่งที่ส่งมอบจาก R2-R3
- **ไม่มี EOC viewer ที่ login เข้าระบบหลัก** — EOC ใช้ API key (FD-14); cross-shelter view ภายในระบบ = SA เท่านั้น

### 2.3 Key User Journeys

- **UJ-9. EOC อำเภอดึงภาพรวม 5 เทศบาลเข้าห้องบัญชาการ.**
  - **Persona + context:** ทีมข้อมูลของ EOC ต้องรายงานสถานการณ์รวมต่อผู้บัญชาการ/ผู้ว่าฯ
  - **Entry state:** หน่วยงานได้รับ API key (scope = อำเภอตน) จาก admin ตามขั้นตอนออก key
  - **Path:** ระบบฝั่ง EOC (service แยก/เครื่องมือของหน่วยงาน) เรียก EOC aggregate API → ได้ยอดผู้อพยพรวม, capacity %, กลุ่มเปราะบาง, stock ขาดแคลน, ศูนย์ที่ต้อง redirect ตาม scope ของ key
  - **Climax:** ตัวเลข aggregate ตรงกับ dashboard รายศูนย์ พร้อม as-of timestamp; ไม่มีทาง drill ถึง person-level
  - **Resolution:** ข้อมูลชุดเดียวกัน (หยาบกว่า, ผ่านเกณฑ์เปิดเผยสาธารณะ) ถูกส่งออก Open API tier ให้ One Data

- **UJ-10. แม่ตามหาลูกที่พลัดหลงระหว่างอพยพ.**
  - **Persona + context:** แม่ ไม่มี account ในระบบ ใช้มือถือค้นหาผ่านหน้า public
  - **Entry state:** เปิดหน้า public family search
  - **Path:** กรอกชื่อ/ข้อมูลขั้นต่ำ → ระบบค้นแบบ privacy-preserving → แสดงผลว่า "พบ/ไม่พบ" และศูนย์ที่อยู่ (ระดับที่ปลอดภัย) โดยไม่เปิดข้อมูลสุขภาพ/national ID
  - **Climax:** แม่เห็นว่าลูกอยู่ศูนย์ B และช่องทางติดต่อเจ้าหน้าที่ศูนย์
  - **Edge case:** ผู้พักพิง opt-out จากการค้นหาสาธารณะ → ไม่ปรากฏผล

## 3. Glossary *(เพิ่มจาก R3)*

- **EOC Aggregate API** — read-only API รวมข้อมูลข้ามศูนย์ (aggregate + selected fields, no person drill) สำหรับ EOC อำเภอ/จังหวัด — ส่งมอบเป็น API + API key แทน human dashboard (FD-14)
- **API-key Principal** — กลไก machine-to-machine แทน login role: ออก/หมุน/เพิกถอน key ได้, จำกัด scope ข้อมูลต่อ key, rate-limit + audit ทุก request (แทน `eoc_viewer` role เดิม)
- **Open API** — API tier สาธารณะ/กึ่งสาธารณะ แยกจาก EOC API: ชุดข้อมูล aggregate ที่เปิดกว้างกว่าแต่หยาบกว่า (ไม่มี PII) ให้ One Data / Hat Yai ROD ในฐานะ data producer
- **EOC Read-Model** — aggregate datastore ของ service แยก ที่ worker/ETL สรุปจาก CouchDB (datastore รอตัดสินใจ — K-17)
- **Public Family Search** — ช่องทางสาธารณะให้ค้นหาว่าบุคคลอยู่ศูนย์ใด แบบ privacy-preserving และเคารพ opt-out
- **Search Consent / Opt-out** — สถานะยินยอม/ปฏิเสธของผู้พักพิงต่อการปรากฏใน Public Family Search — **policy = opt-out (CONFIRMED T3/K-15)**
- **RoPA** — Record of Processing Activities ตาม PDPA ที่ศูนย์คอมพิวเตอร์ ม.อ. เป็นเจ้าของ
- **SOP Simulation** — การจำลอง what-if (เช่น ถ้าผู้อพยพเพิ่ม X% ต้องการทรัพยากร/อาสาเท่าไร) ต่อยอดจาก Resource Calculation
- **Handover Package** — ชุดส่งมอบ: user manual, runbook, training material, RoPA, known issues, support plan

## 4. Features

### 4.1 EOC Aggregate API (Part 3) — *deferred ≤14 ก.ย.*

**Description:** service แยก รวบ metric จากทุกศูนย์ (Baseline-R3) เป็นข้อมูล aggregate ระดับเมือง/จังหวัด expose ผ่าน read-only API ให้ EOC ใช้ — ตาม FD-14 ส่งมอบเป็น API + API key, ไม่ใช่ human dashboard Realizes UJ-9

#### FR-49: EOC Cross-Shelter Aggregate Data API

ระบบ (service แยก) เปิด read-only API รวมข้อมูลข้ามศูนย์: ยอดผู้อพยพต่อศูนย์, capacity %, กลุ่มเปราะบาง, fast-track, stock ขาดแคลน, ศูนย์ที่ต้อง redirect

**Consequences (testable):**
- endpoint ครอบชุดข้อมูลที่ P-03 design กำหนด (occupancy, capacity, resource gap, vulnerable counts) — aggregate + selected fields เท่านั้น **ไม่มี person-level drill-down**
- aggregate ตรงกับผลรวมของ dashboard รายศูนย์ (occupancy baseline + stock R2 + resource R3) ใน UAT
- filter ตามระดับ (เมือง/เทศบาล/ชุมชน) และรายศูนย์ได้
- ข้อมูลมี as-of timestamp ชัดเจน; perf รับ polling จาก EOC ได้
- ข้อมูลมาจาก worker/ETL ที่อ่าน CouchDB → read-model (ไม่ query ฐานหลักตรงต่อ request)

#### FR-50: EOC API Scope Rules & API-Key Principal

กลไก API key เป็น principal สำหรับผู้ใช้ API ฝั่ง EOC (แทน `eoc_viewer` role เดิม — FD-14): ออก/หมุน/เพิกถอน key, จำกัด scope ข้อมูลต่อ key, rate-limit + audit

**Consequences (testable):**
- admin issue/rotate/revoke API key ได้ พร้อม scope ต่อ key (เช่น เฉพาะอำเภอตน) — revoke แล้วใช้ไม่ได้ทันที
- request เกิน scope → 403, เกิน rate-limit → 429
- ทุก request ลง audit log (key, endpoint, เวลา) query ย้อนหลังได้
- ไม่มี write path สู่ operational data; medical/PII ถูก aggregate/mask (ต่อ NFR-5)

### 4.2 Open API to One Data / Hat Yai ROD (Part 3) — *deferred ≤14 ก.ย.*

**Description:** API tier แยกจาก EOC API (FD-14): ชุดข้อมูล aggregate ที่ผ่านเกณฑ์เปิดเผยสาธารณะ (ไม่มี PII) ส่งให้ระบบภายนอกในฐานะ data producer ต้นน้ำ ไม่ซ้ำซ้อนกับ Hat Yai ROD

#### FR-51: Aggregate Data Open API

ระบบเปิด Open API ส่งจำนวนผู้อพยพและสถานะทรัพยากรแบบ aggregate ให้ระบบภายนอก

**Consequences (testable):**
- payload เป็น aggregate ระดับศูนย์/พื้นที่เท่านั้น — ไม่มี PII (ต่อ NFR-22)
- มี authentication/rate-limit ระดับ consumer แยกจาก EOC tier; การเข้าถึงถูก audit
- schema มี versioning (`/v1/`) และ documented contract (OpenAPI spec) สำหรับ consumer ภายนอก

**Notes:** [NOTE FOR PM] Open API contract กับ One Data/Hat Yai ROD ต้อง sign-off ร่วมกับเจ้าของระบบภายนอก (K-14) — blocker ของ deferred tail

### 4.3 Public Family Search — *in-scope ส.ค.*

**Description:** ให้ญาติค้นหาผู้พักพิงแบบ privacy-preserving เคารพ opt-out — core public feature อยู่ใน scope ส่งมอบ 31 ส.ค. ภายใต้เงื่อนไข governance review + T-43 RoPA minimal ผ่านก่อน publish Realizes UJ-10. [ASSUMPTION R4-A1]

#### FR-52: Search Consent / Opt-out

ผู้พักพิง(หรือเจ้าหน้าที่แทน) กำหนด consent/opt-out ต่อการปรากฏใน Public Family Search

**Consequences (testable):**
- **default = opt-out policy (CONFIRMED T3/K-15):** เห็นทุกคนเว้นแต่ถอนตัว; opt-out มีผลทันที
- ผู้ที่ opt-out ต้องไม่ปรากฏในผลค้นหาสาธารณะทุกกรณี

#### FR-53: Privacy-Preserving Public Search

ประชาชนค้นหาว่าบุคคลอยู่ศูนย์ใด โดยเปิดข้อมูลขั้นต่ำที่ปลอดภัย

**Consequences (testable):**
- ผลค้นหาแสดงเฉพาะ masked directory (`first_name`, `last_name`, `nickname`, `shelter_status` — ตาม matrix §7.3) + ช่องทางติดต่อเจ้าหน้าที่ ไม่เปิด medical/national ID/ที่อยู่ติดต่อ
- ต้องมี anti-enumeration / rate-limit กันการกวาดข้อมูล
- ทุก public query auditable (ไม่เก็บ PII ของผู้ค้น แต่เก็บ trace พอสำหรับ abuse detection)

**Feature-specific NFRs:** ต้องผ่าน data-governance review + DPIA ก่อนเปิด public — ถ้า review ไม่ผ่านทัน 31 ส.ค. ให้เลื่อนการ publish (ไม่เลื่อนการ build)

### 4.4 SOP Simulation — *deferred ≤14 ก.ย.*

**Description:** ต่อยอด Resource Calculation (R3) ให้จำลอง what-if สำหรับวางแผนล่วงหน้า

#### FR-54: What-if Resource Simulation

Shelter Manager / SA จำลองสถานการณ์ (เช่น occupancy +X%, ศูนย์ปิด Y) แล้วดูความต้องการทรัพยากร/อาสาที่เปลี่ยน

**Consequences (testable):**
- simulation ใช้ SOP Ratio (FR-44) และไม่เขียนทับ operational data จริง
- เทียบ baseline ปัจจุบันกับ scenario ได้

### 4.5 Governance, UAT & Handover — *in-scope ส.ค.*

**Description:** ปิดงาน cross-cutting ที่ทำให้ระบบส่งมอบได้ — ครอบคลุมทุก module

#### FR-55: RoPA, Consent & Retention (minimal ใน ส.ค., finalize ต่อเนื่อง)

ระบบและเอกสารรองรับ RoPA, consent records และ data retention ตาม PDPA — **minimal scope (T-43) บังคับใน ส.ค.** เพราะ family search เปิด public; ส่วน finalize เต็มทำต่อช่วง maintenance

**Consequences (testable):**
- RoPA ครอบคลุมทุกการประมวลผล PII ที่ระบบทำ ณ go-live (รวม family search + donor data)
- retention/cleanup policy บังคับใช้ได้ (รวม offline local cleanup จาก FR-17)
- เจ้าของคือศูนย์คอมพิวเตอร์ ม.อ.

#### FR-56: Cross-Module UAT & Handover Package

ระบบผ่าน UAT ข้าม module และมี Handover Package ครบ

**Consequences (testable):**
- UAT end-to-end ครอบ flow ข้าม module (registration → kitchen requisition → donation redirect → aggregate data ถูกต้อง) ผ่านโดย critical bug = 0
- Handover Package: user manual, runbook, training material, known issues, support plan ครบ
- production hardening: backup/restore tested, rollback owner, monitoring (ต่อ NFR-8, NFR-11)

## 5. Non-Goals (R4)

- ไม่สร้าง module ปฏิบัติการใหม่
- **ไม่ทำ human EOC dashboard / role-scoped EOC views ในระบบหลัก** (FD-14 — ส่งมอบเป็น aggregate API; dashboard เป็นเรื่องของระบบฝั่ง EOC/service แยก)
- ไม่ทำระบบเตือนภัยน้ำท่วม (Hat Yai ROD เป็นเจ้าของ — เราส่งข้อมูลให้ผ่าน Open API)
- ไม่ทำ data warehouse/BI เต็มรูปสำหรับ One Data (เราเป็น producer ส่ง aggregate เท่านั้น)
- ไม่ทำ recovery-phase modules (อาชีพ, ปิดศูนย์ระยะยาว)

## 6. Phase Scope

### 6.1 In Scope — ส.ค. (ส่งมอบ 31 ส.ค.)

- Public family search + consent/opt-out (FR-52/53)
- RoPA/consent/retention minimal (FR-55 / T-43)
- Cross-module UAT, production hardening, handover package (FR-56)

### 6.2 Deferred — หลัง go-live, จบภายใน 14 ก.ย.

- EOC aggregate API + API-key principal (FR-49/50 — service แยก, FD-14)
- Open API tier (FR-51) → One Data / Hat Yai ROD
- SOP simulation (FR-54)
- Inventory/donation/kitchen polish (T-45)

### 6.3 Out of Scope

- Per-person consumption analytics — backlog
- งาน feature ใดๆ หลัง 14 ก.ย. — เข้า maintenance/feedback เท่านั้น (จนครบโครงการ 12 เดือน)

## 7. Cross-Cutting NFRs *(เพิ่มจาก R3)*

- **NFR-22** (Privacy): EOC API, Open API และ public family search ต้องไม่ส่ง PII ออกนอกระบบ — aggregate-only / masked directory โดยออกแบบ Validates FR-49, FR-51, FR-53
- **NFR-23** (Consistency): ข้อมูล aggregate จาก EOC API ต้อง reconcile กับผลรวม dashboard รายศูนย์ ณ as-of timestamp เดียวกัน Validates FR-49
- **NFR-24** (Security): API consumer ทุก tier ต้อง authenticate (API key) + rate-limited + audited; public search ต้องมี anti-enumeration Validates FR-50, FR-51, FR-53
- **NFR-25** (Operability): ก่อน Final Handover Gate ต้องมี backup/restore tested, rollback owner, monitoring runbook และ known-issues ที่ยอมรับแล้ว (ต่อ NFR-8, NFR-11) Validates FR-56
- **NFR-26** (Compliance): RoPA ครอบคลุมการประมวลผล PII ทุก module และ retention บังคับใช้ได้ Validates FR-55

## 8. Success Metrics *(ต่อจาก SM-15)*

**Primary**
- **SM-16**: EOC reconcile — ข้อมูลจาก EOC aggregate API ตรงกับผลรวม dashboard รายศูนย์ใน UAT (ผลต่าง = 0) Validates FR-49
- **SM-17**: API privacy — EOC/Open API payload ผ่านการตรวจว่าไม่มี PII (รวม parameter manipulation test) และ consumer ต้อง auth ใน security test Validates FR-49, FR-51
- **SM-18**: Handover readiness — Final Handover Gate ผ่าน: cross-module UAT critical bug = 0, backup/restore tested, handover package ครบ Validates FR-56

**Secondary**
- **SM-19**: Family-search safety — opt-out ทำงาน 100% และผลค้นหาไม่เปิด sensitive field ใน privacy test Validates FR-52, FR-53
- **SM-20**: RoPA completeness — RoPA (minimal) ครอบคลุมทุก PII-processing ณ go-live โดยไม่มี gap ใน review Validates FR-55

**Counter-metrics (do not optimize)**
- **SM-C9**: อย่าเพิ่มความสมบูรณ์ของ EOC API ด้วยการเปิด person-level data เข้า payload Counterbalances SM-16
- **SM-C10**: อย่าทำ family search ให้ค้นง่ายจนเปิดช่องกวาดข้อมูล/ละเมิด opt-out Counterbalances SM-19

## 9. Open Questions

1. Open API contract/schema กับ One Data / Hat Yai ROD ตกลงร่วมกันเมื่อไร และใคร sign-off? (K-14 — blocker ของ deferred tail)
2. **Datastore ของ EOC aggregate read-model (K-17 — รอตัดสินใจใน P-03):** ร่างเดิม MongoDB; ทางเลือก CouchDB database แยก / PostgreSQL — เกณฑ์: ops burden ของทีมหลังส่งมอบ
3. SOP simulation depth — what-if ลึกแค่ไหนพอสำหรับ handover?
4. ETL/worker ของ EOC read-model ต้อง refresh ถี่แค่ไหน (polling interval / near-real-time)?

## 10. Assumptions Index

- [ASSUMPTION R4-A1] Family search อยู่ใน scope ส.ค. ภายใต้ governance/DPIA gate + T-43 minimal; ถ้า review ไม่ผ่านทันให้เลื่อน publish ไม่เลื่อน build
- [ASSUMPTION R4-A2] Deferred tail (FR-49/50/51/54) ทำหลัง go-live โดยทีมที่เบาลง จบภายใน 14 ก.ย. — หลังจากนั้นไม่มี feature ใหม่ (maintenance จนครบโครงการ 12 เดือน)
- [ASSUMPTION] FR-55 — RoPA minimal (T-43) เพียงพอสำหรับ go-live; finalize เต็มทำต่อช่วง maintenance โดยศูนย์คอมพิวเตอร์ ม.อ. เป็นเจ้าของ
