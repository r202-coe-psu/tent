---
title: "Full-System Role Permission Matrix (R2-R4 & V10)"
status: approved
created: 2026-06-04
updated: 2026-10-28 # CR-203 (approved 2026-10-27, #930) pr_staff บทบาทที่ 12 + คอลัมน์ PR แถว kiosk; CR-204 แยกแถว Stock Distribution (WS/SM เบิกจ่าย, SC ไม่ได้); 2026-10-26 CR-153 แยก Daily SOP UI visibility กับ CouchDB read; 2026-10-24 CR-153 amendment Daily SOP Read = UI-visibility; 2026-10-20 CR-153 Daily SOP rows; CR-155 amend incident log เฉพาะ SA/SM/SO; 2026-10-18 CR-165 kiosk_staff แทน banner_staff (11th role) + CR-162 path `/back-office/kiosks/banners`; 2026-10-11 CR-162 banner_staff; เดิม: CR-093 (Compound Roles) & CR-104 (Volunteer Backoffice, 10-Role Taxonomy, Health Policy); decision sync 2026-10-10; CR-155 shelter_incident แทน shelter_report
note: decision sync 2026-10-10 — VC may access /back-office/volunteers (job board/shifts), REG may access Station 2 medical screening; portal groups menus by department (ฝ่าย): ทะเบียน(REG; TRG/MED เห็นเฉพาะ Station 2), ครัว(KS), พัสดุและคลัง(SC, warehouse_staff alias), อาสาสมัคร(VC), รักษาความปลอดภัย(SO), อาคารสถานที่(FAC), บริหารศูนย์(SM), ส่วนกลาง(SA)
closes: K-12 (A1 RBAC phase-blocker)
affects:
  - docs/data/schema.md §6 _users
  - frontend/src/lib/auth/roles.ts
  - frontend/src/lib/server/shelter-access-design.ts
  - docs/changes/14-kiosk/CR-162-kiosk-banner.md
  - docs/changes/14-kiosk/CR-165-kiosk-management-back-office.md
  - docs/changes/07-B-sop/CR-153-daily-sop-role-assessments.md
  - docs/changes/03-C-supply/CR-204-stock-distribute-shelter-manager.md
---

# Full-System Role Permission Matrix (R2-R4 & V10)

## 0. Document Purpose

เอกสารนี้คือแม่บทการควบคุมสิทธิ์การเข้าถึงข้อมูลและการปฏิบัติการของระบบ Smart Shelter (Canonical Role-Based Access Control Specification) ครอบคลุมสถาปัตยกรรม **10 Role Taxonomy**, **Compound Scoped Roles (บทบาทระบุศูนย์)**, **Time-Bound Dynamic Role Provisioning**, และ **Health & Screening Visibility Policy** ตามที่กำหนดใน [CR-093](../changes/01-core/CR-093-multi-shelter-compound-roles.md) และ [CR-104](../changes/06-A-volunteer/CR-104-volunteer-backoffice-and-user-management-v10.md).

---

## 1. Roles & Access Tiers

### 1.1 โครงสร้าง 12 บทบาทผู้ใช้งานภายใน (Internal Authenticated Roles)

| ตัวย่อ  | รหัสบทบาท (`RoleKey`)   | ชื่อบทบาท (ภาษาไทย)          | ขอบเขตความรับผิดชอบหลัก                                                                                                                                                                                                              |
| :-----: | :---------------------- | :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SA**  | `system_admin`          | ผู้ดูแลระบบส่วนกลาง          | มีสิทธิ์สูงสุดระดับสากล (Global Access) เข้าถึงและจัดการได้ทุกศูนย์พักพิง, จัดการบัญชีผู้ใช้, กำหนดค่าระบบส่วนกลาง และกู้คืนข้อมูล                                                                                                   |
| **SM**  | `shelter_manager`       | ผู้จัดการศูนย์พักพิง         | ควบคุมการปฏิบัติงานทั้งหมดภายในศูนย์ของตนเอง มีอำนาจครอบคลุมสิทธิ์ของบทบาทที่ 3 ถึง 10 ทั้งหมดในศูนย์นั้น รวมถึงงานคัดกรองและการแพทย์                                                                                                |
| **REG** | `registration_staff`    | เจ้าหน้าที่รับลงทะเบียน      | บันทึกข้อมูลทะเบียนประวัติผู้อพยพ (Evacuees), ข้อมูลครัวเรือน, ยานพาหนะ, สัตว์เลี้ยง, การเช็คอิน-เช็คเอาต์ประจำวัน และออกบัตรประจำตัว                                                                                                |
| **TRG** | `triage_staff`          | เจ้าหน้าที่คัดกรอง           | คัดกรองกลุ่มเปราะบาง (ผู้สูงอายุ, ผู้พิการ, เด็ก, สตรีมีครรภ์) และคัดแยกผู้ป่วยเบื้องต้นเพื่อส่งต่อไปยังพื้นที่พักพิงที่เหมาะสม                                                                                                      |
| **MED** | `medical_staff`         | เจ้าหน้าที่การแพทย์และพยาบาล | บันทึกข้อมูลสุขภาพ, ประวัติการรักษาพยาบาลเบื้องต้น, การจ่ายยา, การเฝ้าระวังโรคติดต่อ และการส่งต่อผู้ป่วยไปยังโรงพยาบาลภายนอก                                                                                                         |
| **KS**  | `kitchen_staff`         | เจ้าหน้าที่ครัวกลาง          | วางแผนรายการอาหารประจำวัน (Meal Planning), คำนวณวัตถุดิบและแก๊สหุงต้ม, เบิกจ่ายวัตถุดิบ, และบันทึกยอดการแจกจ่ายอาหาร                                                                                                                 |
| **SC**  | `supply_coordinator`    | ผู้ประสานงานพัสดุและคลัง     | รับมอบสิ่งของบริจาค, จัดการคลังพัสดุ, ตัดจ่ายสิ่งของจำเป็น, เบิกถุงยังชีพ, และควบคุมระดับสต็อกขั้นต่ำ                                                                                                                                |
| **VC**  | `volunteer_coordinator` | ผู้ประสานงานจิตอาสา          | สร้างประกาศภารกิจงานอาสา (`job`), ดูแลกระดานงาน, จัดสรรกะงาน, ดูแลจุดเช็คอินแท็บเล็ตหน้าศูนย์, และออกสิทธิ์ระบบให้อาสาช่วยงาน                                                                                                        |
| **SO**  | `security_officer`      | เจ้าหน้าที่รักษาความปลอดภัย  | ควบคุมความสงบเรียบร้อย, บันทึกเหตุการณ์ความไม่ปลอดภัย (Incidents), จัดการพื้นที่หวงห้าม, และเฝ้าระวังจุดเข้า-ออกศูนย์                                                                                                                |
| **FAC** | `facility_staff`        | เจ้าหน้าที่ฝ่ายอาคารสถานที่  | จัดการโซนที่พัก (Zoning), บริหารจัดการเต็นท์และพื้นที่นอน, ดูแลระบบไฟฟ้า น้ำประปา สุขาภิบาล และการซ่อมบำรุงอาคาร                                                                                                                     |
| **KIO** | `kiosk_staff`           | เจ้าหน้าที่ดูแลตู้ Kiosk     | ดูแลตู้ kiosk ของศูนย์ตัวเอง — เครื่อง + staff PIN ([CR-165](../changes/14-kiosk/CR-165-kiosk-management-back-office.md)) และแบนเนอร์รูปภาพบนตู้ ([CR-162](../changes/14-kiosk/CR-162-kiosk-banner.md)) — ไม่มีสิทธิ์อื่นของศูนย์    |
| **PR**  | `pr_staff`              | เจ้าหน้าที่ประชาสัมพันธ์     | ข่าวสารบนตู้ kiosk ของศูนย์ตัวเอง — banner + กลุ่ม banner, ผูกกลุ่มกับเครื่อง, ดูรายชื่อเครื่องและดู staff PIN (reveal + log) — ตั้งค่าเครื่องหรือแก้ PIN ไม่ได้ ([CR-203](../changes/14-kiosk/CR-203-pr-staff-role.md))               |

> **CR-165 FR-SBO-41 / CR-162** — บทบาทที่ 11 คือ `kiosk_staff` (compound `{code}:kiosk_staff`, อยู่ใน `STAFF_CAPABILITIES` — SM ของศูนย์และ SA grant/revoke ได้) · `banner_staff` ของ CR-162 ฉบับ 2026-10-11 ถูกแทนที่และไม่มีใน `roles.ts`
>
> **[CR-203](../changes/14-kiosk/CR-203-pr-staff-role.md) (#930)** — บทบาทที่ 12 คือ `pr_staff` (compound `{code}:pr_staff`, อยู่ใน `STAFF_CAPABILITIES` — SM ของศูนย์และ SA grant/revoke ได้) · user ที่มีแค่ `kiosk_staff` และ/หรือ `pr_staff` ในศูนย์ที่เลือกเข้า back-office ได้เฉพาะหน้า kiosk (FR-SBO-29): มี `kiosk_staff` → `/back-office/kiosks/**` · `pr_staff` อย่างเดียว → `/back-office/kiosks/banners/**` เท่านั้น

| หมวดงาน / เอกสาร                                 | การกระทำ (Action)                                     | SA  |  SM   |  KIO  |  PR   | บทบาทอื่น |
| :----------------------------------------------- | :---------------------------------------------------- | :-: | :---: | :---: | :---: | :-------: |
| **Kiosk Device** (`/back-office/kiosks`)         | สร้าง / แก้ไข / เปิดปิด / ตั้งหรือสุ่ม staff PIN / ลบ |  ✓  | scope | scope |   —   |     —     |
| **Kiosk Device** (รายชื่อในหน้ากลุ่ม banner)     | ดูรายชื่อเครื่อง / ดู staff PIN (reveal + log)        |  ✓  | scope | scope | scope |     —     |
| **Kiosk Banner** (`/back-office/kiosks/banners`) | ดู / สร้าง / แก้ไข / เปิดปิด / จัดลำดับ / ลบ          |  ✓  | scope | scope | scope |     —     |
| **Kiosk Banner Group**                           | ดู / สร้าง / แก้ชื่อ / ผูกเครื่อง / ลบ                |  ✓  | scope | scope | scope |     —     |

> scope = เฉพาะศูนย์ที่ถือ `{code}:shelter_manager` / `{code}:kiosk_staff` / `{code}:pr_staff` (คอลัมน์ PR = CR-203) · เครื่องหรือ banner ของศูนย์อื่นที่เรียกด้วย `{id}` ตอบ `404` · `pr_staff` เรียก API เขียนเครื่อง / ตั้ง PIN ได้ `403`

---

### 1.2 สถาปัตยกรรมบทบาทระบุศูนย์ (Compound Scoped Roles Architecture)

เพื่อรองรับให้ผู้ใช้งาน 1 บัญชีสามารถปฏิบัติงานข้ามหลายศูนย์พักพิงและถือครองหลายบทบาทได้อย่างปลอดภัย โดยไม่มีปัญหาสิทธิ์รั่วไหลข้ามศูนย์ (Privilege Bleeding):

1. **โครงสร้างใน `_users.roles`:**
   - บันทึกในรูปแบบ `["shelter:{code}", "{code}:{role_key}"]` เช่น:
     `["shelter:SH001", "shelter:SH002", "SH001:volunteer_coordinator", "SH001:facility_staff", "SH002:supply_coordinator"]`
2. **ข้อยกเว้นสำหรับ `system_admin`:**
   - บันทึกเป็นบทบาทเดี่ยว `["system_admin"]` โดยไม่มีรหัสศูนย์นำหน้า และได้รับสิทธิ์เต็มทุกศูนย์โดยอัตโนมัติ
3. **การตรวจสอบสิทธิ์ระดับฐานข้อมูล (`validate_doc_update`):**
   - ฟังก์ชันความปลอดภัยของแต่ละฐานข้อมูล `shelter_{code}` จะตรวจสอบบทบาทเฉพาะของศูนย์ตนเองอย่างเคร่งครัด

---

### 1.3 Non-user access tiers (ไม่อยู่ใน `_users`)

| ตัวย่อ  | Tier                   | รายละเอียด                                                                                        |
| :-----: | :--------------------- | :------------------------------------------------------------------------------------------------ |
| **VOL** | Operational Volunteer  | อาสาสมัครทั่วไป (ช่วยงานครัว, ยกของ, แจกของ) **ไม่มีบัญชีผู้ใช้** ใช้เพียง Digital Ticket QR Code |
| **DN**  | Donor (public)         | ผู้บริจาค ไม่ต้องล็อกอิน สร้างคำขอและติดตามผ่าน `tracking_token`                                  |
| **PUB** | Public / anonymous     | ประชาชนทั่วไป เข้าชมกระดานงานอาสา ค้นหาศูนย์พักพิง รายงานความโปร่งใส                              |
| **FAM** | Family search (public) | ค้นหาครอบครัวผู้ประสบภัยแบบ Masked PII (ชื่อ-นามสกุล, สถานะพักพิง)                                |
| **API** | API consumer (machine) | บริการเชื่อมต่อภายนอก (One Data / Hat Yai ROD) ด้วย API Key                                       |

---

## 2. นโยบายการมองเห็นข้อมูลสุขภาพและการคัดกรอง (Health & Screening Policy)

- **ลักษณะของข้อมูล:** ข้อมูลโรคและอาการในระบบเป็นข้อมูลการคัดกรองเบื้องต้นระยะสั้นหน้างาน (Non-sensitive Short-Term Screening Flags) เช่น อาการไข้, ท้องเสีย, บาดแผล, โรคประจำตัว (หอบหืด, เบาหวาน), หรือข้อจำกัดทางกายภาพ
- **สิทธิ์การมองเห็น (Read Access):** **เจ้าหน้าที่ทุกบทบาทที่ได้รับอนุญาตเข้าถึงศูนย์พักพิงนั้น (`shelter:{code}`) สามารถอ่านข้อมูลอาการคัดกรองได้ทั้งหมด** เพื่อการเตรียมความพร้อมในการปฏิบัติงาน:
  - ฝ่ายครัว (`kitchen_staff`): จัดอาหารเฉพาะโรค / อาหารสำหรับผู้ป่วย
  - ฝ่ายสถานที่ (`facility_staff`): จัดโซนพักใกล้ห้องน้ำ หรือแยกโซนลดการแพร่เชื้อ
  - ฝ่ายความปลอดภัย (`security_officer`): เข้าช่วยเหลือผู้มีข้อจำกัดทางร่างกายเมื่อมีเหตุฉุกเฉิน
- **สิทธิ์การบันทึกข้อมูล (Write Access):** สงวนไว้เฉพาะ `medical_staff`, `triage_staff`, และ `shelter_manager`

---

## 3. Action Matrix — สิทธิ์การปฏิบัติการในระดับศูนย์พักพิง

> **decision sync 2026-10-10** — VC เข้า `/back-office/volunteers` (Job Board/กะงาน) ได้ และ REG เข้า Station 2 คัดกรองการแพทย์ได้ (แถว Volunteer Job Board / Triage & Screening); การจัดการผู้ใช้ยังเป็น SM/SA เท่านั้น. หน้า portal จัดกลุ่มเมนูตามฝ่าย: ทะเบียน(REG; TRG/MED เห็นเฉพาะ Station 2), ครัว(KS), พัสดุและคลัง(SC, `warehouse_staff` เป็น alias), อาสาสมัคร(VC), รักษาความปลอดภัย(SO), อาคารสถานที่(FAC), บริหารศูนย์(SM), ส่วนกลาง(SA).

| หมวดงาน / เอกสาร                                                                            | การกระทำ (Action)                                                                                                                                                                          | SA  |  SM   |  REG  |  TRG  |  MED  |  KS   |  SC   |  VC   |  SO   |  FAC  |
| :------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Evacuee / Household**                                                                     | บันทึกทะเบียนประวัติ, เช็คอิน/เอาต์                                                                                                                                                        |  ✓  | scope | scope |   —   |   —   |   —   |   —   |   —   |   —   |   —   |
| **Triage & Screening**                                                                      | บันทึกผลคัดกรองกลุ่มเปราะบาง/อาการ                                                                                                                                                         |  ✓  | scope | scope | scope | scope |   —   |   —   |   —   |   —   |   —   |
| **Medical Record**                                                                          | บันทึกเวชระเบียน, การรักษา, จ่ายยา                                                                                                                                                         |  ✓  | scope |   —   |   —   | scope |   —   |   —   |   —   |   —   |   —   |
| **Health Flags (Read)**                                                                     | ดูข้อมูลโรค/อาการคัดกรองเพื่อเตรียมงาน                                                                                                                                                     |  ✓  | scope | scope | scope | scope | scope | scope | scope | scope | scope |
| **Meal Planning & Service**                                                                 | แผนอาหาร, บันทึกแจกจ่ายมื้ออาหาร                                                                                                                                                           |  ✓  | scope |   —   |   —   |   —   | scope |   —   |   —   |   —   |   —   |
| **Kitchen Requisition**                                                                     | เบิกวัตถุดิบทำอาหารตัดสต็อก                                                                                                                                                                |  ✓  | scope |   —   |   —   |   —   | scope | scope |   —   |   —   |   —   |
| **Inventory & Supply**                                                                      | รับของบริจาค, สต็อก                                                                                                                                                                        |  ✓  | scope |   —   |   —   |   —   |   —   | scope |   —   |   —   |   —   |
| **Stock Distribution**      | เบิกจ่ายพัสดุออกจากคลังโดยตรง (ตัดจ่าย)                                                                                                                                                    |  ✓  | scope |   —   |   —   |   —   |   —   |  WS   |   —   |   —   |   —   |
| **Volunteer Job Board**                                                                     | สร้างประกาศภารกิจงานอาสา, จัดกะ                                                                                                                                                            |  ✓  | scope |   —   |   —   |   —   |   —   |   —   | scope |   —   |   —   |
| **Volunteer Check-in**                                                                      | รับรายงานตัวอาสาหน้างาน (POS/Kiosk)                                                                                                                                                        |  ✓  | scope | scope |   —   |   —   |   —   |   —   | scope |   —   |   —   |
| **Shelter Incident Log** ([CR-155](../changes/08-E-reports/CR-155-shelter-incident-log.md)) | เฉพาะ SA/SM/SO (incident staff) เข้าเมนู/route · เปิดบันทึก + เพิ่มบันทึกสังเกตการณ์ · เปลี่ยนสถานะ/ส่งต่อ/ปิด = เจ้าของเคสหรือ SM · ยกเลิก = SM · ลบไม่ได้ทุก role · role อื่นไม่มีสิทธิ์ |  ✓  | scope |   —   |   —   |   —   |   —   |   —   |   —   | scope |   —   |
| **Zoning & Facilities**                                                                     | จัดการโซน, เต็นท์, ทรัพย์สินอาคาร                                                                                                                                                          |  ✓  | scope |   —   |   —   |   —   |   —   |   —   |   —   |   —   | scope |
| **Daily SOP (UI visibility)**                                                               | หน้า Daily SOP แสดงเฉพาะ Role ที่ประเมินได้ (frontend เท่านั้น)                                                                                                                            |  ✓  | scope |  own  |  own  |  own  |  own  |  own  |  own  |  own  |  own  |
| **Daily SOP (CouchDB read)**                                                                | อ่านเอกสารทุก Role ในฐาน shelter ตาม `_security` (ข้อจำกัดที่ทราบ)                                                                                                                         |  ✓  | scope | scope | scope | scope | scope | scope | scope | scope | scope |
| **Daily SOP (Write)**                                                                       | บันทึกแบบประเมินของวันนี้                                                                                                                                                                  |  ✓  | scope |  own  |  own  |  own  |  own  |  own  |  own  |  own  |  own  |
| **User Management**                                                                         | สร้าง/แก้ไขผู้ใช้ประจำศูนย์ตน                                                                                                                                                              |  ✓  | scope |   —   |   —   |   —   |   —   |   —   |   —   |   —   |   —   |

> **CR-204 (2026-10-27, approved)** — แถว Stock Distribution: `WS` ในคอลัมน์ SC = เฉพาะ `{code}:warehouse_staff`; `supply_coordinator` ดูสต็อกและรับเข้าได้แต่เบิกจ่ายไม่ได้ (คง [CR-156](../changes/03-C-supply/CR-156-stock-redesign-amendment.md) §H FR-H1); SM ของศูนย์เบิกจ่ายได้ (GitHub #837)

> **CR-153 (2026-10-24)** — แยกสิทธิ์อ่าน Daily SOP เป็น UI visibility (`own`; SM/SA เห็นครบ 9 Role) กับ CouchDB read (shelter-wide ตาม `_security`); การจำกัดเป็นการแสดงผลใน UI เท่านั้น ไม่ใช่ access control.
>
> **CR-153 (2026-10-20)** — เพิ่มแถว Daily SOP จดสิทธิ์ที่ CR-153 กำหนดไว้แล้ว ไม่เพิ่มสิทธิ์ใหม่. `own` = เฉพาะ Role ของตนในศูนย์ตน (SC รวม `warehouse_staff`); `scope` ในแถว Write = ทุก Role ในศูนย์ตน (SM); SA ทุกศูนย์; เขียนได้เฉพาะวันนี้ตามเวลา Asia/Bangkok
>
> **CR-153 amendment (2026-10-24)** — แถว Read เปลี่ยนเป็น UI-visibility: `own` = UI แสดงเฉพาะ Role ของตน (SC รวม `warehouse_staff`); SM `scope` และ SA เห็นครบ 9 Role. การอ่านเอกสารระดับ DB (CouchDB `_security`) ยังเป็นทั้งศูนย์สำหรับสมาชิก shelter — ไม่ใช่ access control; notes/observations จึงยังห้ามมีข้อมูลส่วนบุคคล

---

## 4. กลไกการควบคุมสิทธิ์ตามเวลากะงาน (Time-Bound Dynamic Role Provisioning)

สำหรับอาสาช่วยงานระบบ (Staff-Capable Volunteer):

1. **การเปิดสิทธิ์ (Grant):** เมื่อสแกนเช็คอินเข้างานที่จุดรับรายงานตัวในเวลากะงาน ($\pm 5$ นาที) ระบบจะเพิ่มบทบาทชั่วคราว เช่น `SH001:registration_staff` เข้าในเอกสาร `_users` ของอาสา
2. **การถอนสิทธิ์ (Revoke):**
   - เมื่อสแกนเช็คเอาต์ออกงาน
   - หรือเมื่อหมดเวลากะงาน ตัวกวาดสิทธิ์อัตโนมัติ (Background Worker Sweeper) จะถอนบทบาทออกจาก `_users` อัตโนมัติ
3. **ผลลัพธ์:** การส่งคำขอเขียนข้อมูลลง CouchDB นอกเวลากะงานจะถูกปฏิเสธด้วย `403 Forbidden` ทันทีในระดับฐานข้อมูล

---

## 5. การจัดการความปลอดภัยของบัญชีผู้ใช้และการกู้คืนรหัสผ่าน (Account Security & Recovery)

1. **Username เป็นเบอร์โทรศัพท์ 10 หลัก (CR-105):** บัญชีผู้ปฏิบัติงานทั่วไป (Staff/Volunteer) ใช้เบอร์โทรศัพท์เป็น Username เพื่อความสะดวกในการใช้งานภาคสนาม
2. **การกู้คืนรหัสผ่านด้วยตนเอง (Self-Service Recovery):**
   - ผู้ใช้สามารถตอบคำถามความปลอดภัยที่เคยตั้งไว้ (จาก 6 คำถามมาตรฐาน) ที่หน้า `/forgot-password` เพื่อตั้งรหัสผ่านใหม่และเข้าใช้งานระบบได้ทันทีโดยไม่ต้องพึ่งพาแอดมิน
3. **การรีเซ็ตรหัสผ่านโดยผู้จัดการศูนย์/แอดมิน (Admin Reset):**
   - SM / SA สามารถกดออกรหัสผ่านชั่วคราวแบบจำง่าย (Memorable Temporary Passphrase เช่น `Safe-Camp-2026!`) จากพูล 100 คำศัพท์เพื่อแจ้งให้ผู้ใช้นำไปเข้าสู่ระบบ
   - ระบบจะบังคับให้ผู้ใช้ตั้งรหัสผ่านถาวรและบันทึกคำถามความปลอดภัยทันทีที่หน้า `/force-setup`
4. **ความต่อเนื่องในการ Deploy (Zero-Admin Deploy):**
   - ผู้ใช้เดิมที่มีรหัสผ่านอยู่แล้วสามารถล็อกอินได้ตามปกติ และจะถูกนำทางไปบันทึกคำถามความปลอดภัยโดยไม่ต้องเปลี่ยนรหัสผ่านเดิม
