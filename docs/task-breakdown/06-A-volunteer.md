---
title: "Task Breakdown — Module A — Volunteer"
status: active
created: 2026-06-05
updated: 2026-07-16
module: A
note: decision-synced 2026-06-15 — task details and DoD maintained directly in Markdown
---

# Module A — Volunteer

> volunteer registration + skills, skill-match + shift assignment

> **หมายเหตุ (CR-002):** คำว่า "Volunteer" ในโมดูลนี้คือ **domain/profile concept** (`volunteer:{ulid}` doc ใน `shelter_{code}`) ไม่ใช่ RBAC RoleKey. การจัดการอาสา (FR-42/43) เป็นความรับผิดชอบของ `shelter_manager` — ไม่มี `volunteer_coordinator` เป็น role แยก. ผู้ที่มี login account สามารถมี `affiliation_tags: ["volunteer"]` เป็น metadata แต่ไม่ให้สิทธิ์ใด ๆ เพิ่ม

- **Team owner:** Team A — ชิโน, นัท, กาน (Volunteer; ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** R3
- **Design input (บริษัท):** P-02 (กำหนดส่งก่อนกรกฎาคม 2026)
- **Target ส่งมอบ:** ภายในสิงหาคม 2026

## Features / Tasks

| ID | Status | Feature / Task | FR | Phase | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-28 | ⬜ | Volunteer registration + skills + availability | FR-42 | R3 | prod | ส.ค. | 5 | ÷1.6 | 3 | T-18 |
| T-29 | ⬜ | Skill match + task/shift assignment | FR-43 | R3 | prod | ส.ค. | 6 | ÷1.4 | 4.5 | T-28 |
|  |  | **รวมทั้งโมดูล** |  |  |  |  | **11** |  | **7.5** |  |

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง

### T-28 — Volunteer registration + skills + availability (FR-42)

**Description:** รับสมัครอาสาสมัคร (Super Volunteers ตาม source Module A) พร้อมบันทึกทักษะ (พยาบาล, ครัว, ขนของ, ล่าม ฯลฯ) และช่วงเวลาที่สะดวก (availability) — ฐานข้อมูลให้ skill match (T-29) และยอดอาสาเป็น input ของ resource calc (T-31)

**Definition of Done:**
- ฟอร์มสมัคร + profile อาสา: ข้อมูลติดต่อ, skill tags (เลือกจาก master list ตาม schema T-18), availability, ศูนย์ที่สังกัด
- แก้ไข profile/ทักษะ/ช่วงเวลาของตัวเองได้ภายหลัง
- เจ้าหน้าที่ค้น/กรองอาสาตามทักษะและช่วงเวลาได้
- PII อาสา mask ตาม role เช่นเดียวกับผู้พักพิง (NFR-5) + ลง RoPA (T-43) และ test + demo สมัครจริง

### T-29 — Skill match + task/shift assignment (FR-43)

**Description:** จับคู่อาสากับงานตามทักษะที่ต้องการ + จัดตาราง shift — ตอบโจทย์ source Module A "จับคู่อาสาสมัครกับทักษะที่ต้องการ" จำนวนอาสาที่ต้องการต่อวันมาจาก SOP calc (T-31/30)

**Definition of Done:**
- สร้างงาน/กะ พร้อมระบุทักษะและจำนวนคนที่ต้องการ → ระบบเสนอรายชื่ออาสาที่ match (ทักษะ + ว่างตรงช่วง)
- Demand จาก resource calc (T-31 เช่น "ต้องการอาสาครัว N คน") สร้างเป็นงานให้จับคู่ได้ (FR-45 → FR-43)
- Assign/ถอนอาสาจาก shift ได้พร้อม assignment history, อาสาคนเดียวไม่ถูกซ้อน shift เวลาเดียวกัน (validation)
- อาสาเห็นตารางงานของตัวเอง, เจ้าหน้าที่เห็นภาพรวมว่ากะไหนยังขาดกี่คน
- Test matching logic + demo จัดกะ 1 วันที่มีหลายทักษะ

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| R3 | 11 | 7.5 |
| **รวม** | **11** | **7.5** |

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- `T-18` (Groundwork: SOP ratio data gathering + volunteer schema) — module **Module B — SOP & Resource Calc**
