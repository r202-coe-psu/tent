---
title: "Task Breakdown — Module D — Kitchen & Food"
status: active
created: 2026-06-05
updated: 2026-07-16
module: D
note: decision-synced 2026-06-15 — task details and DoD maintained directly in Markdown
---

# Module D — Kitchen & Food

> meal plan (occupancy×SOP), kitchen requisition (deduct stock), meal service record

- **Team owner:** Team C — ก้อง, มิว, พัฟ (Kitchen/Food; ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** R2, R3
- **Design input (บริษัท):** P-01 (ส่งมอบแล้ว), P-02 (กำหนดส่งก่อนกรกฎาคม 2026)
- **Target ส่งมอบ:** ภายในสิงหาคม 2026

## Features / Tasks

| ID | Status | Feature / Task | FR | Phase | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-17 | 🔄 | Groundwork: kitchen schema + Inventory linkage spike | prep R3 | R2 | prod | ส.ค. | 6 | ÷1.25 | 5 | T-02 |
| T-25 | 🔄 | Meal plan from occupancy x SOP ratio | FR-39 | R3 | prod | ส.ค. | 6 | ÷1.4 | 4.5 | T-17,T-31 |
| T-26 | 🔄 | Kitchen requisition (deduct stock) | FR-40 | R3 | prod | ส.ค. | 5 | ÷1.6 | 3 | T-25,T-12 |
| T-27 | 🔄 | Meal service record (served / waste / external) | FR-41 | R3 | prod | ส.ค. | 5 | ÷1.6 | 3 | T-26 |
|  |  | **รวมทั้งโมดูล** |  |  |  |  | **22** |  | **15.5** |  |

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง

### T-17 — Groundwork: kitchen schema + Inventory linkage spike (prep R3)

**Description:** งานเตรียม R3 ระหว่าง R2: ออกแบบ schema ครัวกลาง (meal plan, requisition, service record) และทำ spike พิสูจน์การ link กับ Inventory (ตัด stock จาก ledger T-12) — ลด risk ก่อนเริ่ม build จริง ไม่ใช่ feature ที่ user ใช้

**Definition of Done:**
- Schema ครัวกลางผ่าน review จาก Lead + สอดคล้อง data model T-02
- Spike ตัด stock ผ่าน ledger สำเร็จ end-to-end อย่างน้อย 1 happy path (โค้ดทิ้งได้ แต่ข้อสรุปต้องเขียน)
- บันทึกข้อสรุป design decision + open question ส่งเข้า P-02 review

### T-25 — Meal plan from occupancy × SOP ratio (FR-39)

**Description:** คำนวณแผนอาหารรายวัน/รายมื้อจากยอดผู้พักพิงจริง (occupancy จาก T-06) × SOP ratio (T-31) — ตอบคำถาม "ต้องใช้ข้าว ไข่ ผัก เท่าไรต่อมื้อ" ตาม source proposal Module B/D และนับรวมความต้องการพิเศษ (เด็ก, ผู้ป่วย, ฮาลาล) ตามที่ design P-02 กำหนด

**Definition of Done:**
- สร้างแผนต่อมื้อ/วันอัตโนมัติจาก occupancy ล่าสุด + ratio — occupancy เปลี่ยนแล้ว re-calc ได้
- ปรับแผน manual ได้ (override พร้อมบันทึกเหตุผล)
- แผนแสดงรายการวัตถุดิบ + จำนวนที่ต้องเบิก ส่งต่อเป็น input ให้ T-26 ได้ทันที
- Test สูตรคำนวณเทียบค่าคาดหวังจาก SOP จริง + demo วางแผน 1 วันเต็ม

### T-26 — Kitchen requisition (deduct stock) (FR-40)

**Description:** เบิกวัตถุดิบจากคลังตามแผนอาหาร (T-25) แล้วตัด stock จริงผ่าน outbound ของ Inventory (T-12) — ปิด loop "แผน → เบิก → ของออกจากคลัง" ให้ยอดคลังสะท้อนการใช้งานครัวจริง

**Definition of Done:**
- สร้างใบเบิกจากแผนได้ในคลิกเดียว + แก้รายการ/จำนวนก่อนยืนยันได้
- ยืนยันเบิก → stock ตัดผ่าน ledger (audit ครบ), ของไม่พอ → warning + เบิกบางส่วนได้
- ประวัติใบเบิกต่อวัน/ต่อมื้อ query ได้ และ test + demo เบิกตามแผนจริง

### T-27 — Meal service record (served / waste / external) (FR-41)

**Description:** บันทึกผลการให้บริการอาหาร: จำนวนที่เสิร์ฟจริง, เหลือทิ้ง (waste), และแจกออกนอกศูนย์ (อาสาสมัคร/ผู้ประสบภัยนอกศูนย์ — ตาม source Module D) — ข้อมูล feedback loop สำหรับปรับแผนวันถัดไปและรายงานความโปร่งใส

**Definition of Done:**
- บันทึก served/waste/external ต่อมื้อได้จาก UI หน้างาน (เร็ว ใช้บน mobile ได้)
- เทียบแผน vs จริง (plan vs served) ดูได้ต่อวัน เพื่อปรับ ratio/แผนวันถัดไป
- ยอดแจกนอกศูนย์แยกประเภทตามที่ source กำหนด (อาสา/ผู้ประสบภัยในที่ตั้ง)
- Test + demo บันทึกครบ 3 ประเภทใน 1 มื้อ

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| R2 | 6 | 5 |
| R3 | 16 | 10.5 |
| **รวม** | **22** | **15.5** |

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- `T-02` (Data-model expansion (household, zone, supply, ledger, donation) — additive) — module **Platform/Core**
- `T-12` (Stock distribute (outbound)) — module **Module C — Supply & Inventory**
- `T-31` (Daily resource calculation engine) — module **Module B — SOP & Resource Calc**
