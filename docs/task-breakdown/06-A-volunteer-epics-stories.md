---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
inputDocuments:
  - docs/prd/index.md
  - docs/prd/phase-r3-operations.md
  - docs/prd/role-permission-matrix.md
  - docs/prd/kickoff.md
  - docs/prd/roadmap.md
  - docs/prd/squad-roster.md
  - docs/prd/phase-r2-foundation.md
  - docs/prd/phase-r4-integration-handover.md
  - docs/changes/CR-041-module-a-volunteer-job-board.md
  - docs/features/volunteer-job-board-flow.md
  - docs/task-breakdown/06-A-volunteer.md
  - docs/data/schema.md
  - docs/changes/CR-002-registration-staff-affiliation-tags.md
  - docs/changes/CR-005-public-portal-landing-public-metrics.md
  - frontend/CONTRIBUTING.md
  - frontend/CONVENTIONS.md
status: stories-draft-complete
module: A
source_cr: CR-041
created: 2026-07-22
updated: 2026-07-22
---

# Module A (CR-041) — Epic Breakdown

## Overview

Epic/story breakdown สำหรับ **Module A — Volunteer** ตาม [CR-041](../changes/CR-041-module-a-volunteer-job-board.md) (`approved`) ที่ขยาย FR-42/43 จาก PRD R3  
แมปกับบอร์ดโปรเจกต์: **T-28 / T-29 (+ task ย่อย)** · Team A · Phase R3

มติผลิตภัณฑ์และ follow-ups ปิดครบแล้ว — Epic 1–4 มี stories + AC ครบ · ส่วนท้ายเป็น handoff ให้ dev

## Requirements Inventory

### Functional Requirements

**จาก PRD R3 (canonical IDs):**

- FR-42: อาสาลงทะเบียนพร้อม skill tags และ availability (ขยายโดย CR-041 — ดู MA-* ด้านล่าง)
- FR-43: จับคู่อาสากับงานตามทักษะ + มอบหมาย/จัดกะ (ขยายโดย CR-041 เป็น Job Board + shifts + application + duty access)

**จาก CR-041 / feature flow (testable — ใช้เป็น coverage สำหรับ stories):**

- MA-01: SM เป็นเจ้าของ Job Board / job ops ทั้งศูนย์; SA ไม่มี journey จัดการ job วันต่อวัน (เหลือ skill master / shift preset)
- MA-02: ไม่มีหัวหน้างาน (job lead) ใน R3
- MA-03: Track อาสา vs staff ประจำด้วย `_users.affiliation_tags` มี `"volunteer"` = อาสา; ไม่มี + มี RoleKey = staff ประจำ; แสดงป้าย + กรองใน UI
- MA-04: SM **แก้** RoleKey และชนิดคนของ user ที่มีอยู่ได้ (รวมดึงอาสาเข้า RoleKey โดยไม่ต้องผ่าน Job Board); ฟอร์มแก้ต้องเลือกชนิดคนชัด
- MA-05: ห้าม RoleKey ชื่อ `volunteer`; ห้ามใช้ `affiliation_tags` เป็น permission check
- MA-05b: **สร้าง `_users`:** เฉพาะ self-register หรือ SA — **SM สร้าง user ไม่ได้** (D-USER-PROVISION)
- MA-06: สมัครโปรไฟล์อาสาผ่าน public ได้โดยไม่บังคับ login ตอนสมัคร
- MA-07: เปิด public surface `/volunteer*` พร้อม Module A (nav + สมัคร; board ตาม sitemap) — ต้อง amend CR-005
- MA-08: โปรไฟล์อาสาเป็นโปรไฟล์กลาง — สมัคร/ถูกมอบหมายหลายศูนย์จากโปรไฟล์เดียวได้
- MA-09: โปรไฟล์เก็บ skills, availability, ติดต่อ; แก้ไขภายหลังได้; SM ค้น/กรองตามทักษะและช่วงเวลาได้
- MA-10: มี doc type `job` ต่อศูนย์ — status draft/open/paused/filled/closed; SM สร้าง/แก้/พัก/ปิดได้ตลอด
- MA-11: Job ระบุ capability tier `operational` | `staff-capable`; staff-capable ต้องประกาศ required RoleKey/capability
- MA-12: กะใช้ preset template (platform/SA) + override ต่อ job (เวลา/ความจุ/ทักษะ)
- MA-13: มี `job_application` — สมัครแล้วรออนุมัติเป็นค่าเริ่มต้น; SM อนุมัติ/ปฏิเสธ/มอบหมายได้; รองรับ SM assign ตรง
- MA-14: Job มี setting auto-accept ต่อ job (default ปิด); เมื่อเปิด: รับอัตโนมัติถ้ามีโควตาว่าง + (opt) skill match; staff-capable default ห้ามเปิด auto-accept
- MA-15: Skill match เสนอรายชื่ออาสาที่ทักษะตรงและว่างตรงช่วง
- MA-16: Assign/ถอนกะได้; เก็บ history; ห้ามซ้อนเวลา; กะข้ามวันเป็นหน้าต่างต่อเนื่อง; หลาย job ได้ถ้าไม่ซ้อนเวลา
- MA-17: อาสา (ที่มี login) เห็นตารางกะของตน; SM เห็นภาพรวมต้องการ/ได้/ขาดต่อกะ
- MA-18: ปรับ job/กะกลางทางได้; กระทบ assignment ต้อง confirm + notify; ลดโควตาต่ำกว่าที่รับแล้วต้องจัดการถอน
- MA-19: อาสา operational ใช้ระบบแค่ตาราง/±เช็คอิน — ไม่ได้ RoleKey จาก job operational
- MA-20: อาสา staff-capable ได้สิทธิ์ write ตาม capability ของ job **เฉพาะช่วงกะ active** (shelter local ±5 นาที); นอกกะ / offline นอกหน้าต่าง = deny write; ถอนหรือเลื่อนแล้ว now ไม่อยู่หน้าต่าง = ตัด grant ทันที + แจ้งอาสา
- MA-21: Staff ประจำยังใช้ RoleKey ถาวรตามเดิม (ไม่ผ่าน duty window ของอาสา)
- MA-22: **ไม่**สร้าง/เติม job อัตโนมัติจาก SOP / T-31 / FR-45 ใน R3 (คนละจอ; SM สร้าง job มือ)
- MA-23: Persist ผ่าน PouchDB → CouchDB ตาม layer โปรเจกต์; feature ภายใต้ `features/` barrel; public plane ผ่าน FastAPI เฉพาะที่ออกแบบสำหรับ public volunteer

### NonFunctional Requirements

- NFR-5: Mask / ไม่เปิด PII เกิน role (อ้างจาก FR-42 consequences)
- NFR-20: Volunteer PII (contact, skills) ต้อง mask ตาม role ทั้ง UI/API — SA/SM scope; ไม่เปิด public เกินที่อนุญาต
- SM-14: UAT — งานที่ต้องการทักษะถูกจับคู่กับอาสาที่ skill ตรงและ available
- Kickoff/engineering: DoD ต่อ slice = UI + data/write path + validation + permission + test + demo; remote-first; ห้ามแตะ stable core โดยไม่ review (โดยเฉพาะ MA-20)
- PDPA/RoPA: โปรไฟล์อาสาจาก public ต้องสอดคล้อง retention/RoPA (T-43) ตาม DoD T-28 เดิม

### Additional Requirements

- Apply canonical หลัง approve: `schema.md` (job, job_application, shift_assignment bump, volunteer multi-shelter), data-model/ER, FR-42/43 text ใน PRD, role-permission-matrix (time-bound duty), `06-A-volunteer.md` DoD, sitemap, feature flow → `active`, **amend CR-005**
- Schema field table ยังไม่มีใน CR — story แรกของ data epic ต้องเขียน/apply field table ก่อนโค้ดโดเมน
- D-DUTY-ACCESS=B ใกล้ stable core — แยก epic + Lead/pair review ก่อน merge guards
- Baseline schema ปัจจุบัน: `volunteer` ไม่มี `availability` field ใน §2.8; `shift_assignment` ยังเป็น enum morning/afternoon/night — ต้อง bump ตามมติ
- Skill master list อิง T-18 / Module B (dependency เดิมของ T-28)
- SA: skill tag master + shift template presets ทั้งแพลตฟอร์ม
- Non-goals R3: job lead, SOP→Job auto, payroll, matching เต็มอัตโนมัติโดยไม่มีคน (ยกเว้น auto-accept ตาม F-AUTO), mobile native, cross-province marketplace เกินโปรไฟล์กลาง+สมัครหลายศูนย์

### UX Design Requirements

ไม่พบ UX design contract แบบ BMad (`DESIGN.md` / `EXPERIENCE.md`)

อิงจาก feature flow + UI ที่มีอยู่:

- UX-DR1: Public `/volunteer*` — ฟอร์มสมัครโปรไฟล์ + เข้าถึง Job Board ตาม sitemap (ไม่โชว์ PII อาสาคนอื่น)
- UX-DR2: SM Job Board — สร้าง/แก้ job, ตั้ง tier, templates/overrides, applications queue, dashboard ขาดคน
- UX-DR3: ป้ายชนิดคน (อาสา / Staff ประจำ) + filter ใน user admin และรายชื่อสมาชิกกะ
- UX-DR4: ตารางกะฝั่งอาสา (หลัง login)
- UX-DR5: ใช้ shadcn-svelte / รูปแบบ protected routes ที่มีอยู่; toast สำหรับ feedback; ไม่ invent design system ใหม่
- UX-DR6: สถานะ job/application ตาม state machine ใน feature flow (draft→open→… / submitted→accepted→…)

### FR Coverage Map

| ID | Epic | สั้น ๆ |
| --- | --- | --- |
| FR-42 | Epic 2 | สมัครโปรไฟล์ + skills + availability (public + กลาง) |
| FR-43 | Epic 3 (+ Epic 4 สำหรับ staff-capable write) | Job Board + match + กะ; duty window ใน Epic 4 |
| MA-01 | Epic 3 | SM เจ้าของ job ops |
| MA-02 | Epic 3 | ไม่มี lead ใน R3 |
| MA-03 | Epic 1 | ป้ายอาสา / staff |
| MA-04 | Epic 1 | SM แก้ RoleKey + ชนิดคน |
| MA-05 | Epic 1 (+ guard ใน Epic 4) | ห้าม RoleKey volunteer / tag≠permission |
| MA-05b | Epic 1 | SM สร้าง user ไม่ได้; สร้างได้แค่ self-reg หรือ SA |
| MA-06 | Epic 2 | Public สมัครโปรไฟล์ |
| MA-07 | Epic 2 | เปิด `/volunteer*` + CR-005 |
| MA-08 | Epic 2 | โปรไฟล์กลางหลายศูนย์ |
| MA-09 | Epic 2 | skills / availability / ค้นกรอง |
| MA-10 | Epic 3 | doc `job` + lifecycle |
| MA-11 | Epic 3 | tier operational / staff-capable |
| MA-12 | Epic 3 | template + override |
| MA-13 | Epic 3 | application รออนุมัติ |
| MA-14 | Epic 3 | auto-accept ต่อ job |
| MA-15 | Epic 3 | skill match suggest |
| MA-16 | Epic 3 | assign / ไม่ซ้อนเวลา |
| MA-17 | Epic 3 | ตารางอาสา + dashboard ขาดคน |
| MA-18 | Epic 3 | ปรับ job กลางทาง + notify |
| MA-19 | Epic 4 | operational ไม่ได้ RoleKey จาก job |
| MA-20 | Epic 4 | time-bound duty write |
| MA-21 | Epic 4 | staff ประจำ RoleKey ถาวร |
| MA-22 | ทุก epic (constraint) | ไม่ผูก SOP→Job ใน R3 |
| MA-23 | ทุก epic (constraint) | PouchDB / feature barrel / public plane |
| NFR-5 / NFR-20 | Epic 2 (+ mask ใน Epic 3) | mask volunteer PII |
| SM-14 | Epic 3 | UAT skill match |
| UX-DR1..6 | Epic 2–3 เป็นหลัก; Epic 1 = UX-DR3 | ตาม flow |

## Epic List

### Epic 1: แยกอาสาจาก staff ประจำบน login
SM เห็นและกรองได้ว่า user เป็นอาสาหรือ staff ประจำ แม้ถือ RoleKey เดียวกัน — ป้ายจาก `affiliation_tags` ไม่ให้สิทธิ์
**FRs covered:** MA-03, MA-04, MA-05, MA-05b  
**บอร์ด:** ส่วนของ T-28 / user admin · **standalone** ก่อน Job Board

### Epic 2: สมัครเป็นอาสาจาก public + โปรไฟล์กลาง
คนนอกสมัครโปรไฟล์ผ่าน `/volunteer*` ได้โดยไม่ login; มีโปรไฟล์กลาง skills/availability; สมัครงานหลายศูนย์ได้ภายหลัง; PII mask ตาม NFR-20
**FRs covered:** FR-42, MA-06, MA-07, MA-08, MA-09 · NFR-5, NFR-20 · UX-DR1, UX-DR5  
**บอร์ด:** T-28 · ต้อง amend CR-005 + schema volunteer (multi)

### Epic 3: Job Board — ประกาศงาน สมัคร จับคู่ และจัดกะ
SM สร้าง/ปรับ job (tier, template+override), รับใบสมัคร (± auto-accept), skill match, มอบหมายกะ, ดูขาดคน, อาสาเห็นตาราง — **ไม่**ดึงจาก SOP ใน R3
**FRs covered:** FR-43, MA-01, MA-02, MA-10–MA-18, MA-22 · SM-14 · UX-DR2, UX-DR4, UX-DR6  
**บอร์ด:** T-29 · พึ่ง Epic 2 สำหรับมีอาสาในระบบ (Epic 1 ไม่บังคับแต่แนะนำก่อน)

### Epic 4: สิทธิ์ตามกะสำหรับอาสา staff-capable
อาสาบน job staff-capable ใช้ write path ตาม capability ได้เฉพาะช่วงกะ active (shelter local ±5 นาที); นอกกะ/offline = deny; ถอน/เลื่อนตัดทันที — **แยก epic เพราะใกล้ stable core / ต้อง review**
**FRs covered:** MA-11 (consume), MA-19, MA-20, MA-21, MA-05  
**บอร์ด:** task ย่อยใหม่แนะนำ (เช่น T-29b / T-xx) · พึ่ง Epic 3 มี assignment + tier

**Dependencies (ธรรมชาติ):** Epic 1 ∥ Epic 2 → Epic 3 → Epic 4  
**Constraint ทุก epic:** MA-22, MA-23

---

## Epic 1: แยกอาสาจาก staff ประจำบน login

SM เห็นและกรองได้ว่า user เป็นอาสาหรือ staff ประจำ แม้ถือ RoleKey เดียวกัน — ป้ายจาก `affiliation_tags` ไม่ให้สิทธิ์

**FRs covered:** MA-03, MA-04, MA-05, MA-05b · UX-DR3  
**บอร์ด:** ส่วนของ T-28 / user admin

### Story 1.1: แสดงป้ายชนิดคนในรายชื่อ user

As a Shelter Manager,  
I want to see whether each user is อาสา or Staff ประจำ on the user list,  
So that I can tell them apart even when they share the same RoleKey.

**Acceptance Criteria:**

**Given** รายชื่อ user ในศูนย์ที่มีทั้งคนมีและไม่มี `affiliation_tags` ค่า `"volunteer"`  
**When** SM เปิดหน้ารายชื่อ user  
**Then** แต่ละแถวแสดงป้าย **อาสา** หรือ **Staff ประจำ** จาก `affiliation_tags` (ไม่จากชื่อ role)  
**And** การเปลี่ยนป้ายอย่างเดียวไม่เปลี่ยนสิทธิ์เมนู/write path (MA-03, MA-05, UX-DR3)

### Story 1.2: ปิดการสร้าง user ของ SM — สมัครเองหรือให้ SA สร้าง

As a Shelter Manager,  
I want the create-user action removed from my UI,  
So that accounts only appear after self-registration or SA provisioning.

**Acceptance Criteria:**

**Given** SM เปิดหน้าจัดการ user ของศูนย์ตน  
**When** SM พยายามสร้าง user ใหม่  
**Then** ไม่มีปุ่ม/ฟอร์มสร้าง user ใน UI ของ SM  
**And** API สร้าง user โดย session ของ SM ถูกปฏิเสธ (403)  
**And** บัญชี `_users` ใหม่เกิดได้จาก self-register หรือที่ SA สร้างเท่านั้น (MA-05b, D-USER-PROVISION)

### Story 1.3: SM แก้ RoleKey และชนิดคนของ user ที่มีอยู่

As a Shelter Manager,  
I want to edit an existing user's RoleKey and person type,  
So that I can grant staff capabilities to a volunteer without using the Job Board.

**Acceptance Criteria:**

**Given** มี `_users` ในศูนย์ตนแล้ว (จาก self-reg หรือ SA)  
**When** SM แก้ RoleKey และ/หรือชนิดคน แล้วบันทึก  
**Then** `roles` และ `affiliation_tags` อัปเดตตามที่เลือก  
**And** เลือกชนิดอาสา → มี tag `"volunteer"`; เลือก Staff ประจำ → ไม่ใส่ `"volunteer"` โดยปริยาย  
**And** ไม่มีตัวเลือก RoleKey ชื่อ `volunteer`  
**And** การให้อาสาถือ RoleKey ทำได้โดยไม่ต้องผ่าน Job Board (MA-04, MA-05, D-USER-PROVISION)

### Story 1.4: กรองรายชื่อตามชนิดคน

As a Shelter Manager,  
I want to filter the user list by อาสา / Staff ประจำ / ทั้งหมด,  
So that I can manage each group separately.

**Acceptance Criteria:**

**Given** ศูนย์มี user ทั้งอาสาและ staff ประจำ  
**When** SM เลือกฟิลเตอร์ชนิดคน  
**Then** รายการแสดงเฉพาะกลุ่มที่เลือก (หรือทั้งหมด)  
**And** ฟิลเตอร์ใช้ `affiliation_tags` ไม่ใช้ RoleKey (MA-03, UX-DR3)

---

## Epic 2: สมัครเป็นอาสาจาก public + โปรไฟล์กลาง

คนนอกสมัครโปรไฟล์ผ่าน `/volunteer*` ได้โดยไม่ login; มีโปรไฟล์กลาง skills/availability; PII mask ตาม NFR-20

**FRs covered:** FR-42, MA-06, MA-07, MA-08 (schema พื้นฐาน), MA-09 · NFR-5, NFR-20 · UX-DR1, UX-DR5  
**บอร์ด:** T-28  
**หมายเหตุ:** การสมัคร job หลายศูนย์ (MA-08 ครบวงจร) ย้ายไป Story 3.x หลังมี Job Board

### Story 2.1: สมัครโปรไฟล์อาสาผ่าน public form

As an anonymous visitor,  
I want to submit a volunteer profile on the public site,  
So that I can join the volunteer pool without having a login first.

**Acceptance Criteria:**

**Given** เปิด public route สมัครอาสา  
**When** กรอกชื่อ ติดต่อ skills availability แล้วส่ง  
**Then** สร้าง `volunteer` เป็นโปรไฟล์กลาง (รองรับ D-MULTI=A) ตาม schema ที่ apply แล้ว  
**And** ไม่สร้าง RoleKey และไม่ให้สิทธิ์ใด ๆ จากขั้นตอนนี้  
**And** availability ถูก persist และใช้กรอง/จัดกะได้ในขั้นถัดไป  
**And** validation ปฏิเสธข้อมูลไม่ครบหรือไม่ถูกต้อง (MA-06, MA-08, MA-09, FR-42)

### Story 2.2: เปิด nav และหน้า `/volunteer*` บน public portal

As a visitor,  
I want to find Volunteer entry points on the public portal,  
So that I can reach registration and related volunteer pages.

**Acceptance Criteria:**

**Given** CR-041 D-PUBLIC=A และ CR-005 เดิมซ่อน volunteer nav/card  
**When** Module A public surface ถูกเปิด  
**Then** nav และ/หรือ card อาสาสมัครแสดงและลิงก์ไป `/volunteer*` ตาม sitemap  
**And** มี amend/sync กับ CR-005 ว่าเปิด surface นี้แล้ว  
**And** หน้า public ไม่เปิดเผย PII อาสาคนอื่น (MA-07, NFR-20, UX-DR1)

### Story 2.3: SM ค้นและกรองอาสาตามทักษะ/ช่วงว่าง

As a Shelter Manager,  
I want to search and filter volunteers by skills and availability,  
So that I can find people who fit open work.

**Acceptance Criteria:**

**Given** มีโปรไฟล์อาสาหลายคนในระบบ  
**When** SM ค้นด้วยทักษะและ/หรือช่วงเวลา  
**Then** รายการแสดงเฉพาะคนที่ตรงเงื่อนไข  
**And** PII ถูก mask ตาม role (MA-09, NFR-20, FR-42)

### Story 2.4: ผูกโปรไฟล์อาสากับ login และแก้ skills/availability เอง

As a volunteer with a login,  
I want to link my profile and update my skills/availability,  
So that matching and scheduling stay accurate.

**Acceptance Criteria:**

**Given** มี `volunteer` profile และมี `_users` (self-reg หรือ SA)  
**When** ผูก `user_name` กับโปรไฟล์ และแก้ skills/availability  
**Then** การเปลี่ยนแปลงถูกบันทึกและใช้ในการ match/จัดกะได้  
**And** เมื่อชนิดคนเป็นอาสา ต้องมี `affiliation_tags` รวม `"volunteer"` (MA-09, MA-03, D-USER-PROVISION)

---

## Epic 3: Job Board — ประกาศงาน สมัคร จับคู่ และจัดกะ

SM สร้าง/ปรับ job (tier, template+override), รับใบสมัคร (± auto-accept), skill match, มอบหมายกะ, ดูขาดคน, อาสาเห็นตาราง — **ไม่**ดึงจาก SOP ใน R3

**FRs covered:** FR-43, MA-01, MA-02, MA-10–MA-18, MA-08 (ครบวงจรสมัครหลายศูนย์), MA-22 · SM-14 · UX-DR2, UX-DR4, UX-DR6  
**บอร์ด:** T-29 · พึ่ง Epic 2 สำหรับมีอาสาในระบบ  
**Constraint ทุก story:** MA-22 (ห้าม SOP→Job), MA-23 (PouchDB / feature barrel / public plane ตามออกแบบ), D-OWNER (SM เท่านั้น; SA ไม่มี journey job ops), D-LEAD=A (ไม่มีหัวหน้างานใน R3)

### Story 3.1: SM สร้างและเผยแพร่ job พร้อม capability tier

As a Shelter Manager,  
I want to create and publish a job for my shelter with an operational or staff-capable tier,  
So that volunteers can apply to clearly scoped work without anyone inventing jobs from SOP.

**Acceptance Criteria:**

**Given** schema field table สำหรับ `job` (v1) ถูกเขียน/apply ใน `schema.md` ก่อนโค้ดโดเมน (รวม status, tier, required roles, shelter scope)  
**When** SM สร้าง job ในศูนย์ตน เลือก tier `operational` หรือ `staff-capable` และ (ถ้า staff-capable) ระบุ required RoleKey/capability  
**Then** บันทึก `job` ได้สถานะเริ่มต้น `draft` และเผยแพร่เป็น `open` ได้; พัก `paused` / ปิด `closed` / ทำเครื่องหมาย `filled` ได้ตาม state machine  
**And** job staff-capable ที่ไม่มี required RoleKey/capability ถูกปฏิเสธโดย validation  
**And** ไม่มี UI/flow สร้าง job จาก SOP / T-31 / FR-45 ใน R3 — SM สร้างมือเท่านั้น  
**And** SA และ role อื่นไม่มี journey จัดการ job วันต่อวัน; ไม่มีหัวหน้างานใน R3 (MA-01, MA-02, MA-10, MA-11, MA-22, UX-DR2, UX-DR6)

### Story 3.2: ตั้งกะด้วย shift template + override ต่อ job

As a Shelter Manager,  
I want to configure shifts from platform presets and override time/capacity/skills per job,  
So that each posting matches real duty windows instead of fixed morning/afternoon/night enums.

**Acceptance Criteria:**

**Given** มี platform/SA shift template presets และ job ของศูนย์ (จาก 3.1); schema `shift_assignment` bump ตาม D-SHIFT=C ถูก apply แล้ว (ลิงก์ `job_id` + เวลาจาก template±override)  
**When** SM เลือก preset แล้ว override เวลา ความจุ และ/หรือทักษะที่ต้องต่อ job  
**Then** กะที่มีผลใช้ค่าหลัง override เป็น duty window ของ assignment ถัดไป  
**And** กะข้ามเที่ยงคืนเป็นหน้าต่างเวลาต่อเนื่องช่วงเดียว (F-OVERLAP)  
**And** SA ตั้ง/แก้ preset ทั้งแพลตฟอร์มได้ แต่ไม่เข้า journey job ops ของศูนย์ (MA-12, D-SHIFT=C, MA-01)

### Story 3.3: อาสาสมัครเข้า job แล้วรออนุมัติ

As a volunteer with a profile,  
I want to apply to an open job and wait for approval by default,  
So that I can express interest without automatically getting a shift.

**Acceptance Criteria:**

**Given** มี `volunteer` profile และ job สถานะ `open` (พร้อมกะที่สมัครได้); schema `job_application` v1 apply แล้ว  
**When** อาสาส่งใบสมัครเข้า job (± เลือกกะที่สนใจ)  
**Then** สร้าง `job_application` สถานะรออนุมัติ (`submitted` / under review ตาม state machine) เป็นค่าเริ่มต้น  
**And** ยังไม่สร้าง `shift_assignment` และไม่ให้ RoleKey/write จากขั้นตอนนี้  
**And** job ที่ไม่ใช่ `open` (draft/paused/closed) ปฏิเสธการสมัคร (MA-13, D-APP, UX-DR6)

### Story 3.4: ตั้งค่า auto-accept ต่อ job

As a Shelter Manager,  
I want an optional auto-accept setting on each job (off by default),  
So that high-volume operational posts can accept matching applicants without manual review every time.

**Acceptance Criteria:**

**Given** SM กำลังสร้างหรือแก้ job  
**When** เปิด/ปิด `auto_accept` บน job นั้น  
**Then** ค่าเริ่มต้นทุก job = ปิด; เมื่อเปิด: รับอัตโนมัติเฉพาะเมื่อมีโควตาว่าง และ (ถ้าเปิดเงื่อนไข) skill match ตาม F-AUTO  
**And** job `staff-capable` ห้ามเปิด auto-accept โดยปริยาย (ซ่อน/บล็อก หรือต้อง confirm สองชั้นถ้าผลิตภัณฑ์บังคับเปิดได้)  
**And** เมื่อ auto-accept ไม่ผ่านเงื่อนไข ใบสมัครยังเข้าคิวรออนุมัติตาม 3.3 (MA-14, F-AUTO)

### Story 3.5: SM อนุมัติ ปฏิเสธ หรือมอบหมายอาสาตรง

As a Shelter Manager,  
I want to approve or reject applications and assign volunteers directly,  
So that I can fill jobs even when nobody self-applies.

**Acceptance Criteria:**

**Given** มีคิว `job_application` และ/หรือรายชื่ออาสาในศูนย์  
**When** SM อนุมัติหรือปฏิเสธใบสมัคร หรือมอบหมายอาสาเข้า job โดยตรง (ไม่ผ่าน self-apply)  
**Then** สถานะ application อัปเดตตาม state machine; การมอบหมายตรงสร้างเส้นทางเข้า job ได้โดยไม่บังคับมี application ก่อน  
**And** เฉพาะ SM ของศูนย์ (ไม่ใช่ SA job ops, ไม่มี lead) ที่ทำได้ (MA-01, MA-02, MA-13, UX-DR2)

### Story 3.6: Skill match เสนอรายชื่ออาสา

As a Shelter Manager,  
I want the system to suggest volunteers whose skills and availability match a job or shift,  
So that I can fill gaps faster with people who fit.

**Acceptance Criteria:**

**Given** มี job/กะที่ระบุทักษะที่ต้อง และมีโปรไฟล์อาสาที่มี skills + availability  
**When** SM ขอรายชื่อที่ match สำหรับ job หรือกะนั้น  
**Then** ระบบเสนออาสาที่ทักษะตรงและว่างตรงช่วง  
**And** รายการไม่เปิด PII เกิน role (mask ตาม NFR-20)  
**And** การเสนอเป็น suggestion — ไม่ auto-assign ยกเว้นเมื่อ auto-accept ตาม 3.4 ทำงาน (MA-15, SM-14, FR-43)

### Story 3.7: มอบหมายและถอนกะ — ไม่ซ้อนเวลา + history

As a Shelter Manager,  
I want to assign or remove volunteers from shifts with history and no overlapping times,  
So that the schedule stays conflict-free across jobs.

**Acceptance Criteria:**

**Given** อาสาอยู่ใน job (ผ่าน accept หรือ assign ตรง) และมีกะว่าง  
**When** SM มอบหมายหรือถอน `shift_assignment`  
**Then** assignment ถูกบันทึกพร้อม history; ถอนอัปเดตสถานะตาม state machine  
**And** validation ปฏิเสธถ้าช่วงเวลาซ้อนกับ assignment อื่นของอาสาคนเดียวกัน (หลาย job ได้ถ้าไม่ซ้อน)  
**And** กะข้ามวันใช้หน้าต่างต่อเนื่องตาม F-OVERLAP (MA-16, F-OVERLAP)

### Story 3.8: Dashboard ขาดคน (SM) และตารางกะของอาสา

As a Shelter Manager and as a logged-in volunteer,  
I want staffing gaps per shift and a personal duty schedule,  
So that we both know what still needs people and when each volunteer works.

**Acceptance Criteria:**

**Given** มี job/กะและ assignments ในศูนย์  
**When** SM เปิดภาพรวม Job Board / กะ  
**Then** เห็นต้องการ / ได้แล้ว / ขาด ต่อกะ  
**And** เมื่ออาสาที่มี login เปิดตารางของตน เห็นเฉพาะกะที่ตนถูกมอบหมาย  
**And** สมาชิกรายชื่อกะแสดงป้ายชนิดคนตาม Epic 1 ถ้ามี login (MA-17, UX-DR2, UX-DR4)

### Story 3.9: ปรับ job หรือกะกลางทางพร้อม confirm และ notify

As a Shelter Manager,  
I want to change an open job or its shifts mid-stream with confirmation when assignments are affected,  
So that plans can change without silently stranding volunteers.

**Acceptance Criteria:**

**Given** job สถานะ `open` / `filled` / `paused` มีหรือไม่มี assignment  
**When** SM แก้ metadata เวลา ความจุ หรือปิด/พัก job  
**Then** การแก้ที่กระทบ assignment ต้อง confirm และแจ้งอาสาที่กระทบ  
**And** การลดโควตาต่ำกว่าจำนวนที่รับแล้วบังคับให้จัดการถอนก่อน หรือเลือกคนที่จะถอน — ห้ามเหลือสถานะขัดแย้ง  
**And** audit/history บันทึกว่าใครแก้อะไรเมื่อไร (MA-18)

### Story 3.10: โปรไฟล์กลางสมัคร job ได้หลายศูนย์

As a volunteer with one central profile,  
I want to apply to open jobs at more than one shelter,  
So that I can help where needed without creating duplicate profiles.

**Acceptance Criteria:**

**Given** มี `volunteer` โปรไฟล์กลาง (D-MULTI=A) จาก Epic 2 และมี job `open` ในอย่างน้อยสองศูนย์  
**When** อาสาสมัคร (หรือถูกมอบหมาย) เข้า job ของศูนย์ต่าง ๆ จากโปรไฟล์เดียว  
**Then** แต่ละศูนย์มี application/assignment ของตนเองโดยไม่ต้องสร้างโปรไฟล์ซ้ำ  
**And** กติกาไม่ซ้อนเวลายังใช้ข้ามศูนย์ (F-OVERLAP)  
**And** PII ยัง mask ตาม NFR-20; ไม่ขยายสิทธิ์ข้ามศูนย์จากแค่สมัคร (MA-08, MA-13, MA-16)

---

## Epic 4: สิทธิ์ตามกะสำหรับอาสา staff-capable

อาสาบน job staff-capable ใช้ write path ตาม capability ได้เฉพาะช่วงกะ active (shelter local ±5 นาที); นอกกะ/offline = deny; ถอน/เลื่อนตัดทันที — **แยก epic เพราะใกล้ stable core / ต้อง review**

**FRs covered:** MA-11 (consume), MA-19, MA-20, MA-21, MA-05  
**บอร์ด:** task ย่อยใหม่แนะนำ (เช่น T-29b) · พึ่ง Epic 3 มี assignment + tier  
**Gate:** Lead/pair review ก่อน merge guards (D-DUTY-ACCESS=B · ใกล้ stable core) — ห้ามแตะ sync/auth core โดยไม่ review

### Story 4.1: Job operational ไม่ให้ RoleKey หรือ write จากกะ

As a volunteer on an operational job,  
I want only my schedule (± optional check-in) from that job,  
So that chopping vegetables does not unlock registration or kitchen write menus.

**Acceptance Criteria:**

**Given** อาสามี `shift_assignment` ของ job tier `operational`  
**When** อาสา login ในหรือนอกช่วงกะ  
**Then** ไม่ได้รับ RoleKey และไม่เปิด write path จาก job/กะนั้น  
**And** UI ไม่แสดงเมนูหน้าที่เสมือนมีสิทธิ์ staff จาก job operational (MA-19, MA-11)

### Story 4.2: เปิด write ตาม capability เฉพาะในหน้าต่างกะ staff-capable

As a staff-capable volunteer with an active assignment,  
I want write access for the job’s required capability only while my shift window is active,  
So that I can perform the duty (e.g. registration) during my scheduled time.

**Acceptance Criteria:**

**Given** job tier `staff-capable` ประกาศ required RoleKey/capability และอาสามี assignment ที่ผูกกะ  
**When** เวลาปัจจุบันอยู่ในหน้าต่างกะแบบ **shelter local** รวม clock skew **±5 นาที** (F-CLOCK)  
**Then** write path ตาม capability ของ job ถูกอนุญาตใน shelter scope ของ session  
**And** grant มาจาก assignment/duty window — **ห้าม**เช็ค permission จาก `affiliation_tags` หรือ RoleKey ชื่อ `volunteer`  
**And** การออกแบบ/merge guard ผ่าน Lead หรือ pair review ก่อนขึ้น main (MA-20, MA-05, MA-11, F-CLOCK)

### Story 4.3: ปฏิเสธ write นอกกะ และเมื่อ offline นอกหน้าต่าง

As the system enforcing duty access,  
I want writes denied outside the active shift window and when offline outside that window,  
So that time-bound grants cannot be stretched by clock games or stale offline clients.

**Acceptance Criteria:**

**Given** อาสาถือ assignment staff-capable  
**When** `now` อยู่นอกหน้าต่างกะ (หลังคิด ±5 นาที) หรือ client offline และ grant หมดอายุ/นอกหน้าต่าง  
**Then** write ตาม capability ของ job = **deny**; ไม่มี grace period (F-OFFLINE)  
**And** อ่านตารางกะของตนยังทำได้ตามที่ออกแบบใน Epic 3 (MA-20, F-OFFLINE, F-CLOCK)

### Story 4.4: ถอนหรือเลื่อนกะแล้วตัด grant ทันทีพร้อมแจ้งอาสา

As a Shelter Manager,  
I want duty write access to drop immediately when I revoke or reschedule a shift out from under “now”,  
So that volunteers do not keep staff write paths after they are no longer on duty.

**Acceptance Criteria:**

**Given** อาสาอยู่ช่วงที่ได้ grant จากกะ staff-capable  
**When** SM ถอน assignment หรือเลื่อนเวลาแล้ว `now` ไม่อยู่ในหน้าต่างใหม่  
**Then** ตัด grant ทันที และแจ้งอาสา  
**And** write ครั้งถัดไปถูกปฏิเสธโดยไม่รอหมดกะเดิม (MA-20, F-REVOKE)

### Story 4.5: Staff ประจำใช้ RoleKey ถาวร — ไม่ผ่าน duty window ของอาสา

As permanent shelter staff,  
I want my RoleKey write access to work independently of volunteer shift windows,  
So that payroll staff are not locked out when no volunteer job is active.

**Acceptance Criteria:**

**Given** `_users` เป็น Staff ประจำ (ไม่มี tag `"volunteer"` เป็นตัวกำหนดสิทธิ์) และถือ RoleKey ตามปกติ  
**When** staff ใช้ write path ของ role นั้น ในหรือนอกช่วงเวลาใด ๆ  
**Then** สิทธิ์เป็นไปตาม RoleKey ถาวร — **ไม่**ผ่าน duty-window gate ของอาสา  
**And** การมีหรือไม่มี `affiliation_tags` ไม่เปลี่ยนผล permission (MA-21, MA-05)

---

## Handoff สรุปให้ Dev (Module A / CR-041)

### สถานะเอกสาร

| ชั้น | สถานะ |
| --- | --- |
| CR-041 | `approved` (2026-07-22) — **อย่าเปลี่ยนมติโดยไม่ถาม owner** |
| Epic list | 4 epics อนุมัติแล้ว |
| Stories | Epic 1–4 มี AC ครบในไฟล์นี้ |
| Canonical apply | ยังค้างตาม CR Acceptance (schema field table, PRD text, matrix, `06-A` DoD, sitemap, feature flow → `active`, amend CR-005) |

### ลำดับ implement ที่แนะนำ

```
Epic 1 ∥ Epic 2  →  Epic 3  →  Epic 4 (review gate)
   T-28 ส่วน user     T-28 public      T-29 Job Board     T-29b duty
```

1. **ก่อนโค้ดโดเมน Epic 3:** apply field table ใน `schema.md` สำหรับ `job` v1, `job_application` v1, bump `shift_assignment`, และ `volunteer` multi/availability ตาม D-MULTI — **ห้ามเดา field ในโค้ดก่อน spec**
2. **Epic 1** — user admin ป้าย/ฟิลเตอร์/ห้าม SM สร้าง user / SM แก้ RoleKey+ชนิดคน (D-USER-PROVISION)
3. **Epic 2** — public `/volunteer*` + amend CR-005 + โปรไฟล์กลาง + ค้นกรอง + ผูก login
4. **Epic 3** — Job Board ตาม 3.1→3.10 (SM-only; ไม่มี lead; ไม่มี SOP→Job)
5. **Epic 4** — time-bound duty guards; **Lead/pair review ก่อน merge**; อย่าแตะ sync/auth stable core โดยไม่ review

### บอร์ด / งานตัด DoD

| บอร์ด | สะท้อนจาก stories |
| --- | --- |
| **T-28** | Epic 1 + Epic 2 (ตัด/เลื่อนของที่ไป Job Board) |
| **T-29** | Epic 3 — **ตัด** DoD “demand จาก T-31 สร้างงาน” ออกจาก R3 (D-DEMAND=C) |
| **T-29b (แนะนำ)** | Epic 4 duty-access |

### Non-goals R3 (อย่าทำ)

- หัวหน้างาน (D-LEAD=A)
- SOP / daily_calc → สร้างหรือเติม job อัตโนมัติ
- RoleKey ชื่อ `volunteer` / ใช้ `affiliation_tags` เป็น permission
- SM สร้าง `_users` (สร้างได้แค่ self-reg หรือ SA)
- Payroll, mobile native, cross-province marketplace เกินโปรไฟล์กลาง+สมัครหลายศูนย์
- Matching เต็มอัตโนมัติโดยไม่มีคน (ยกเว้น auto-accept ตาม F-AUTO)

### มติที่ lock แล้ว (อ้างอิงอย่างเดียว — แหล่งความจริง = CR-041)

D-OWNER · D-AFFIL · D-TIER=A · D-DUTY-ACCESS=B · D-LEAD=A · D-REG=A · D-SHIFT=C · D-APP+F-AUTO · D-DEMAND=C · D-MULTI=A · D-PUBLIC=A · F-CLOCK · F-OFFLINE · F-OVERLAP · F-REVOKE · D-USER-PROVISION

### Definition of done ต่อ slice

ตาม kickoff/engineering: UI + data/write path + validation + permission + test + demo · remote-first · feature ผ่าน barrel · public ผ่าน FastAPI เฉพาะที่ออกแบบ · `pnpm lint` / `check` / `test` + svelte-autofixer ตาม CONTRIBUTING

### จุดเสี่ยงที่ต้องระวัง

| จุด | ทำไม |
| --- | --- |
| Epic 4 guards | ใกล้ stable core — review ก่อน merge |
| Schema placement โปรไฟล์กลาง | ระบุใน field table ตอน apply — ห้ามเดา shared vs per-shelter ในโค้ด |
| CR-005 amend | บังคับก่อนเปิด nav `/volunteer*` |
| Skill master | พึ่ง T-18 / Module B |

### Coverage ครบหรือยัง

| Epic | Stories | MA / FR หลัก |
| --- | --- | --- |
| 1 | 1.1–1.4 | MA-03, 04, 05, 05b |
| 2 | 2.1–2.4 | FR-42, MA-06..09 |
| 3 | 3.1–3.10 | FR-43, MA-01..02, 08, 10–18, 22 · SM-14 |
| 4 | 4.1–4.5 | MA-11, 19–21, 05 |
