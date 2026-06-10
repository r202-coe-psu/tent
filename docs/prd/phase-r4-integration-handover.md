---
title: "Phase R4 PRD: Integration — EOC, Open API, Family Search & Handover"
status: draft
phase: R4
month: October 2026
gate: Final Handover Gate
created: 2026-06-03
updated: 2026-06-03
---

# Phase R4 PRD: Integration — EOC, Open API, Family Search & Handover

## 0. Document Purpose

PRD ฉบับนี้กำหนด scope/FR/NFR ของ **Phase R4 (ตุลาคม, hardening/handover ต่อถึง ธ.ค.)** — phase ปิดโครงการส่วน software platform ผู้อ่านคือ PM/SA, PO, S1/S2/S6/S7 และ QA/Release Owner

R4 ต่อจาก [R3 Operations](phase-r3-operations.html): ID numbering เดินต่อ (เริ่ม FR-49, NFR-22, UJ-9, SM-16) R4 ไม่เพิ่ม module ปฏิบัติการใหม่ แต่ **รวบข้อมูลจากทุก module ที่ R2-R3 ผลิต** ออกไปสู่ EOC/One Data, เปิด public family search, และทำให้ระบบพร้อม handover

R4 ส่ง **full scope ไม่ตัด** (EOC dashboard เต็ม + Open API + family search + SOP simulation): build จบ ต.ค. แล้วใช้ buffer **ต.ค.-ธ.ค.** ทำ governance/DPIA, consent/masking, cross-module UAT, training, handover ให้ครบก่อน deadline จริง ธ.ค. ([Roadmap §5](roadmap.html))

## 1. Vision

R2-R3 ทำให้แต่ละศูนย์เดินงานได้จริงและผลิตข้อมูล real-time (occupancy, stock, donation, kitchen, resource needs) R4 เปลี่ยนข้อมูลรายศูนย์ให้เป็น **ภาพรวมระดับเมือง/จังหวัด** ที่ EOC ใช้ตัดสินใจได้ ผ่าน Dashboard กลางและ Open API ที่ส่งต่อให้ One Data / Hat Yai ROD โดยไม่ซ้ำซ้อน (เราเป็น data producer ต้นน้ำ)

พร้อมกันนั้น R4 ตอบโจทย์มนุษยธรรมที่ค้างมาตั้งแต่ MVP: ให้ญาติค้นหาผู้พักพิงได้อย่างปลอดภัยภายใต้ PDPA และทำให้ระบบทั้งหมด **ส่งมอบได้** — RoPA ครบ, UAT ข้าม module ผ่าน, มี training และ runbook ให้ผู้ใช้จริงเดินต่อหลังทีมนักศึกษาถอน

## 2. Target Users

### 2.1 Jobs To Be Done

- **EOC Viewer / ผู้บัญชาการ / ผู้ว่าฯ** *(role ใหม่, read-only)* ต้องเห็นภาพรวมทุกศูนย์ (ยอดผู้อพยพ, ทรัพยากร, กลุ่มเปราะบาง) เพื่อจัดสรรและรายงาน
- **One Data / Hat Yai ROD (ระบบภายนอก)** ต้องดึงข้อมูล aggregate ผ่าน Open API ที่ปลอดภัยและไม่มี PII
- **ประชาชน/ญาติ** ต้องค้นหาว่าคนในครอบครัวอยู่ศูนย์ไหน โดยไม่เปิดข้อมูลส่วนตัวเกินจำเป็น
- **Data Protection Owner (ศูนย์คอมพิวเตอร์ ม.อ.)** ต้องมี RoPA, consent, retention ครบก่อน go-live เต็ม
- **ผู้ดูแลระบบ/ผู้ใช้จริงหลังส่งมอบ** ต้องมี training, user manual, runbook เพื่อดำเนินการต่อเอง

### 2.2 Non-Users (R4)

- ไม่มี module ปฏิบัติการใหม่ — operator หน้างานใช้สิ่งที่ส่งมอบจาก R2-R3

### 2.3 Key User Journeys

- **UJ-9. ผู้อำนวยการ EOC ดูภาพรวม 5 เทศบาลก่อนประชุมศูนย์บัญชาการ.**
  - **Persona + context:** ผอ.EOC ต้องรายงานสถานการณ์รวมต่อผู้ว่าฯ
  - **Entry state:** login role EOC Viewer (read-only ทุกศูนย์)
  - **Path:** เปิด EOC Dashboard → เห็นยอดผู้อพยพรวม, capacity %, กลุ่มเปราะบาง, stock ขาดแคลน, ศูนย์ที่ต้อง redirect → filter ตามเทศบาล
  - **Climax:** ตัวเลขทุกศูนย์ aggregate ตรงกับ dashboard รายศูนย์ พร้อม last-updated
  - **Resolution:** ผอ.EOC ส่งสรุป และระบบ push ข้อมูลชุดเดียวกัน (ไม่มี PII) ออก Open API ให้ One Data

- **UJ-10. แม่ตามหาลูกที่พลัดหลงระหว่างอพยพ.**
  - **Persona + context:** แม่ ไม่มี account ในระบบ ใช้มือถือค้นหาผ่านหน้า public
  - **Entry state:** เปิดหน้า public family search
  - **Path:** กรอกชื่อ/ข้อมูลขั้นต่ำ → ระบบค้นแบบ privacy-preserving → แสดงผลว่า "พบ/ไม่พบ" และศูนย์ที่อยู่ (ระดับที่ปลอดภัย) โดยไม่เปิดข้อมูลสุขภาพ/national ID
  - **Climax:** แม่เห็นว่าลูกอยู่ศูนย์ B และช่องทางติดต่อเจ้าหน้าที่ศูนย์
  - **Edge case:** ผู้พักพิง opt-out จากการค้นหาสาธารณะ → ไม่ปรากฏผล

## 3. Glossary *(เพิ่มจาก R3)*

- **EOC Dashboard** — Dashboard ระดับเมือง/จังหวัดที่ aggregate ทุกศูนย์ สำหรับ EOC Viewer (read-only)
- **Open API** — API สาธารณะ/กึ่งสาธารณะที่ส่งข้อมูล aggregate (ไม่มี PII) ให้ One Data / Hat Yai ROD ในฐานะ data producer
- **Public Family Search** — ช่องทางสาธารณะให้ค้นหาว่าบุคคลอยู่ศูนย์ใด แบบ privacy-preserving และเคารพ opt-out
- **Search Consent / Opt-out** — สถานะยินยอม/ปฏิเสธของผู้พักพิงต่อการปรากฏใน Public Family Search
- **RoPA** — Record of Processing Activities ตาม PDPA ที่ศูนย์คอมพิวเตอร์ ม.อ. เป็นเจ้าของ
- **SOP Simulation** — การจำลอง what-if (เช่น ถ้าผู้อพยพเพิ่ม X% ต้องการทรัพยากร/อาสาเท่าไร) ต่อยอดจาก Resource Calculation
- **Handover Package** — ชุดส่งมอบ: user manual, runbook, training material, RoPA, known issues, support plan

## 4. Features

### 4.1 EOC Dashboard & Aggregation (Part 3)

**Description:** รวบ metric จากทุกศูนย์ (R1-R3) เป็นภาพรวมระดับเมือง/จังหวัดสำหรับ EOC Viewer read-only Realizes UJ-9

#### FR-49: City/Province Aggregate Dashboard

EOC Viewer เห็นภาพรวมทุกศูนย์: ยอดผู้อพยพ, capacity %, กลุ่มเปราะบาง, fast-track, stock ขาดแคลน, ศูนย์ที่ต้อง redirect

**Consequences (testable):**
- aggregate ตรงกับผลรวมของ dashboard รายศูนย์ (occupancy MVP + stock R2 + resource R3) ใน UAT
- filter ตามระดับ (เมือง/เทศบาล/ชุมชน) และรายศูนย์ได้
- last-updated timestamp และพฤติกรรม cached-when-offline (แสดงเวลา sync ล่าสุด ตามตาราง analog/offline ใน proposal)

#### FR-50: Role-Scoped EOC Views

EOC Dashboard แสดงตามลำดับชั้นสิทธิ์ (ผู้นำชุมชนเห็นชุมชนตน, เทศบาลเห็นในเขต, ผู้บัญชาการเห็นทุก อปท., ผู้ว่าฯ เห็นสรุป)

**Consequences (testable):**
- scope filter บังคับที่ backend ตามลำดับชั้น (ต่อ NFR-4)
- ทุก EOC view เป็น read-only; ไม่มี write path สู่ operational data
- medical/PII ถูก aggregate/mask (ต่อ NFR-5)

### 4.2 Open API to One Data / Hat Yai ROD (Part 3)

**Description:** ส่งข้อมูล aggregate (ไม่มี PII) ออกในฐานะ data producer ต้นน้ำ ไม่ซ้ำซ้อนกับ Hat Yai ROD

#### FR-51: Aggregate Data Open API

ระบบเปิด Open API ส่งจำนวนผู้อพยพและสถานะทรัพยากรแบบ aggregate ให้ระบบภายนอก

**Consequences (testable):**
- payload เป็น aggregate ระดับศูนย์/พื้นที่เท่านั้น — ไม่มี PII (ต่อ NFR-22)
- มี authentication/rate-limit ระดับ consumer; การเข้าถึงถูก audit
- schema มี versioning และ documented contract สำหรับ consumer ภายนอก

**Notes:** [NOTE FOR PM] Open API contract กับ One Data/Hat Yai ROD ต้อง sign-off ร่วมกับเจ้าของระบบภายนอก — phase-blocker ของ R4

### 4.3 Public Family Search

**Description:** ให้ญาติค้นหาผู้พักพิงแบบ privacy-preserving เคารพ opt-out — feature ที่ MVP เลื่อนเพราะ PDPA risk ปลดล็อกเมื่อ governance/masking โตพอ Realizes UJ-10. [ASSUMPTION FD-A1]

#### FR-52: Search Consent / Opt-out

ผู้พักพิง(หรือเจ้าหน้าที่แทน) กำหนด consent/opt-out ต่อการปรากฏใน Public Family Search

**Consequences (testable):**
- default consent state กำหนดโดย policy ของ data owner; opt-out มีผลทันที
- ผู้ที่ opt-out ต้องไม่ปรากฏในผลค้นหาสาธารณะทุกกรณี

#### FR-53: Privacy-Preserving Public Search

ประชาชนค้นหาว่าบุคคลอยู่ศูนย์ใด โดยเปิดข้อมูลขั้นต่ำที่ปลอดภัย

**Consequences (testable):**
- ผลค้นหาแสดงเฉพาะ "พบ/ไม่พบ" + ศูนย์ระดับที่ปลอดภัย + ช่องทางติดต่อเจ้าหน้าที่ ไม่เปิด medical/national ID/ที่อยู่ติดต่อ
- ต้องมี anti-enumeration / rate-limit กันการกวาดข้อมูล
- ทุก public query auditable (ไม่เก็บ PII ของผู้ค้น แต่เก็บ trace พอสำหรับ abuse detection)

**Feature-specific NFRs:** ต้องผ่าน data-governance review + DPIA ก่อนเปิด; buffer ต.ค.-ธ.ค. มีไว้ทำ governance/consent/masking ให้ครบก่อน publish (ถ้า DPIA ไม่ผ่านจริงๆ จึงค่อยพิจารณาเลื่อน — ไม่ใช่ตัดทิ้งตามแผนเดิม)

### 4.4 SOP Simulation

**Description:** ต่อยอด Resource Calculation (R3) ให้จำลอง what-if สำหรับวางแผนล่วงหน้า — อยู่ใน full scope R4 (build จบ ต.ค., polish ใน buffer)

#### FR-54: What-if Resource Simulation

Shelter Manager / EOC จำลองสถานการณ์ (เช่น occupancy +X%, ศูนย์ปิด Y) แล้วดูความต้องการทรัพยากร/อาสาที่เปลี่ยน

**Consequences (testable):**
- simulation ใช้ SOP Ratio (FR-44) และไม่เขียนทับ operational data จริง
- เทียบ baseline ปัจจุบันกับ scenario ได้

### 4.5 Governance, UAT & Handover

**Description:** ปิดงาน cross-cutting ที่ทำให้ระบบส่งมอบได้ — ครอบคลุมทุก module R1-R4

#### FR-55: RoPA, Consent & Retention Finalization

ระบบและเอกสารรองรับ RoPA, consent records และ data retention ครบตาม PDPA

**Consequences (testable):**
- RoPA ครอบคลุมทุกการประมวลผล PII ที่ module R1-R4 ทำ
- retention/cleanup policy บังคับใช้ได้ (รวม offline local cleanup จาก MVP FR-17)
- เจ้าของคือศูนย์คอมพิวเตอร์ ม.อ. (ต่อ OQ-4 เดิม)

#### FR-56: Cross-Module UAT & Handover Package

ระบบผ่าน UAT ข้าม module และมี Handover Package ครบ

**Consequences (testable):**
- UAT end-to-end ครอบ flow ข้าม module (registration → kitchen requisition → donation redirect → EOC view) ผ่านโดย critical bug = 0
- Handover Package: user manual, runbook, training material, known issues, support plan ครบ
- production hardening: backup/restore tested, rollback owner, monitoring (ต่อ NFR-8, NFR-11 เดิม)

## 5. Non-Goals (R4)

- ไม่สร้าง module ปฏิบัติการใหม่
- ไม่ทำระบบเตือนภัยน้ำท่วม (Hat Yai ROD เป็นเจ้าของ — เราส่งข้อมูลให้ผ่าน Open API)
- ไม่ทำ data warehouse/BI เต็มรูปสำหรับ One Data (เราเป็น producer ส่ง aggregate เท่านั้น)
- ไม่ทำ native EOC mobile app
- ไม่ทำ recovery-phase modules (อาชีพ, ปิดศูนย์ระยะยาว)

## 6. Phase Scope

### 6.1 In Scope (R4)

- EOC aggregate dashboard + role-scoped views
- Open API (aggregate, no PII) → One Data / Hat Yai ROD
- Public family search + consent/opt-out
- SOP simulation
- RoPA/consent/retention finalization
- Cross-module UAT, production hardening, handover package

### 6.2 Out of Scope for R4

- Operational modules ใหม่ (จบที่ R3)
- Per-person consumption analytics — backlog
- *(R4 ส่ง full scope ไม่ตัด — EOC dashboard เต็ม + Open API + family search + SOP simulation; buffer ต.ค.-ธ.ค. รองรับ)*

## 7. Cross-Cutting NFRs *(เพิ่มจาก R3)*

- **NFR-22** (Privacy): Open API และ public family search ต้องไม่ส่ง PII ออกนอกระบบ — aggregate-only และ privacy-preserving โดยออกแบบ Validates FR-51, FR-53
- **NFR-23** (Consistency): EOC aggregate ต้อง reconcile กับผลรวม dashboard รายศูนย์ ณ last-updated เดียวกัน Validates FR-49
- **NFR-24** (Security): Open API consumer ต้อง authenticate + rate-limited + audited; public search ต้องมี anti-enumeration Validates FR-51, FR-53
- **NFR-25** (Operability): ก่อน Final Handover Gate ต้องมี backup/restore tested, rollback owner, monitoring runbook และ known-issues ที่ยอมรับแล้ว (ต่อ NFR-8, NFR-11) Validates FR-56
- **NFR-26** (Compliance): RoPA ครอบคลุมการประมวลผล PII ทุก module และ retention บังคับใช้ได้ Validates FR-55

## 8. Success Metrics *(ต่อจาก SM-15)*

**Primary**
- **SM-16**: EOC reconcile — EOC aggregate ตรงกับผลรวม dashboard รายศูนย์ใน UAT (ผลต่าง = 0) Validates FR-49
- **SM-17**: API privacy — Open API payload ผ่านการตรวจว่าไม่มี PII และ consumer ต้อง auth ใน security test Validates FR-51
- **SM-18**: Handover readiness — Final Handover Gate ผ่าน: cross-module UAT critical bug = 0, backup/restore tested, handover package ครบ Validates FR-56

**Secondary**
- **SM-19**: Family-search safety — opt-out ทำงาน 100% และผลค้นหาไม่เปิด sensitive field ใน privacy test Validates FR-52, FR-53
- **SM-20**: RoPA completeness — RoPA ครอบคลุมทุก PII-processing module โดยไม่มี gap ใน review Validates FR-55

**Counter-metrics (do not optimize)**
- **SM-C9**: อย่าเพิ่มความสมบูรณ์ของ EOC dashboard ด้วยการดึง PII เข้า aggregate Counterbalances SM-16
- **SM-C10**: อย่าทำ family search ให้ค้นง่ายจนเปิดช่องกวาดข้อมูล/ละเมิด opt-out Counterbalances SM-19

## 9. Open Questions

1. Open API contract/schema กับ One Data / Hat Yai ROD ตกลงร่วมกันเมื่อไร และใคร sign-off? (phase-blocker)
2. Public family search consent: default opt-in หรือ opt-out? เจ้าของ policy คือศูนย์คอมพิวเตอร์ ม.อ. ต้องยืนยัน
3. milestone ก.ย. 80% ถ้าไม่ถึง ใครตัดสิน re-balance squad / ดึง buffer ต.ค.-ธ.ค. (PM/SA + sponsor) และ review เมื่อไร?
4. SOP simulation depth — what-if ลึกแค่ไหนพอสำหรับ handover?
5. EOC offline/cached behavior ต้องเก็บ snapshot ถี่แค่ไหน?

## 10. Assumptions Index

- [ASSUMPTION FD-A1] Public family search อยู่ R4 หลัง governance/DPIA gate; buffer ต.ค.-ธ.ค. ทำ consent/masking ให้ครบก่อน publish (ไม่ตัดทิ้ง)
- [ASSUMPTION FD-A2] Sep = internal checkpoint ~80% testable (ไม่ตัด scope); deadline จริง = ธ.ค. ใช้ buffer ต.ค.-ธ.ค. ปิดงานที่เหลือ
- [ASSUMPTION] FR-54 SOP simulation อยู่ใน full scope R4; build จบ ต.ค. polish ใน buffer
