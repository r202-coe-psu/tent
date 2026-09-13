---
id: draft
title: ข้อกำหนดความปลอดภัยและการจัดเตรียมฟังก์ชันตรวจสอบเอกสาร (CouchDB VDU Provisioning Specification) สำหรับระบบตั๋วและการแจกจ่าย
status: proposed
date: 2026-09-13
requested_by: Architecture & Security Gate Reviewers
decided_by: <รออนุมัติจาก Project Owner>
layer: stable
affects:
  - docs/data/schema.md §8 (Validation rules / validate_doc_update)
  - frontend/src/lib/server/shelter-access-design.ts (เกณฑ์บังคับแก้ไขก่อน deploy)
  - CouchDB _design/access บนฐานข้อมูล shelter_{code} และ catalog
---

# draft-distribution-security-vdu-provisioning — ข้อกำหนดความปลอดภัยและการจัดเตรียมฟังก์ชันตรวจสอบเอกสาร (CouchDB VDU Provisioning) สำหรับระบบตั๋วและการแจกจ่าย

> [!IMPORTANT]
> **เงื่อนไขบังคับก่อนการนำขึ้นใช้งานจริง (Mandatory Deployment Gate):**
> ก่อนที่ไคลเอนต์จะเริ่มส่งคำสั่งเขียนเอกสารประเภทใหม่ตาม CR-059 Extended สู่ฐานข้อมูลจริง สถาปัตยกรรมความปลอดภัยที่กำหนดใน `frontend/src/lib/server/shelter-access-design.ts` และฟังก์ชัน `validate_doc_update` ใน Design Document `_design/access` จะต้องได้รับการอัปเดตและ deploy ลงบนฐานข้อมูลของศูนย์ทุกศูนย์ (`shelter_{shelter_code}`) สำหรับเอกสารระดับศูนย์ 12 ประเภท และฐานข้อมูลกลาง (`catalog`) สำหรับ `item_category` v2
>
> หากไม่มีการจัดเตรียมนี้ CouchDB VDU จะปฏิเสธ (Reject with 403 Forbidden) เอกสารใหม่ทั้งหมดโดยอัตโนมัติเนื่องจากไม่อยู่ใน Type Whitelist. ทั้งนี้ **ฐานข้อมูลกลาง `central_ops` จะไม่ถูกเปิด Whitelist ให้รับเอกสารตั๋วหรือการแจกจ่ายระดับศูนย์เหล่านี้** เพื่อรักษาขอบเขตความปลอดภัยของศูนย์กลาง

---

## 1. วัตถุประสงค์และขอบเขต (Purpose & Scope)

เอกสารฉบับนี้กำหนด **ข้อกำหนดเชิงคุณลักษณะความปลอดภัย (Security Specification)** สำหรับเอกสารกายภาพระดับปฏิบัติการ/การประสานงานใหม่ 12 ประเภท และเอกสารแคตตาล็อกที่แก้ไขเพิ่มเติม 1 ประเภท (`item_category` v2) รวม 13 สเปก เพื่อเตรียมพร้อมสำหรับเฟสการพัฒนาโค้ด (Implementation Phase) โดย:
1. กำหนดบัญชีเอกสารใหม่ที่ได้รับอนุญาตแยกรายฐานข้อมูล (Per-Database Document Whitelist)
2. กำหนดคลาสสิทธิ์การเข้าถึงเชิงนามธรรม (Capability Classes) โดยไม่ผูกมัดหรือตรึงบทบาทผู้ใช้แบบคาดเดา (Capability-Only, No Speculative Roles)
3. กำหนดกฎความไม่แปรเปลี่ยน (Invariants) ที่ CouchDB VDU ต้องบังคับใช้ระดับฐานข้อมูล
4. บังคับใช้ขอบเขตการแยกผู้เช่า (Tenant Isolation) และขอบเขตความเป็นส่วนตัวของคลังพัสดุ (Warehouse Privacy Boundary) อย่างเคร่งครัด

---

## 2. บัญชีเอกสารกายภาพใหม่และคลาสสิทธิ์ (Physical Document Inventory & Capabilities)

| ชนิดเอกสาร (`type`) | ฐานข้อมูลเป้าหมาย | คลาสสิทธิ์การเขียน (Capability Class) | กฎความปลอดภัยและการเปลี่ยนสถานะที่ VDU ต้องตรวจ |
| :--- | :--- | :--- | :--- |
| **`requisition_ticket`** | `shelter_{code}` | `ticket.create`<br>`ticket.manage`<br>`ticket.close` | - `shelter_code` ตรงกับ db<br>- State machine เดินหน้าเท่านั้น ห้ามย้อนสถานะ<br>- เมื่อเข้าสู่ `in_progress` ห้ามแก้ `items[]` และ `requested_qty` |
| **`requisition_fulfillment`** | `shelter_{code}` | `warehouse.verify`<br>`warehouse.dispatch`<br>`distribution.receive` | - State machine เดินหน้าตามกราฟ<br>- ห้ามแก้ `allocations[]` หลัง dispatch<br>- ตรวจสอบผลรวมการอนุรักษ์ยอดพัสดุตอนตรวจรับ |
| **`distribution_log`** | `shelter_{code}` | `distribution.scan`<br>`distribution.void`<br>`loan.return` | - Append-only เป็นหลัก (ห้าม hard-delete)<br>- การ Void ทำได้เฉพาะฟิลด์ audit และเปลี่ยนสถานะ<br>- ห้ามแก้ `kind`, `ticket_id`, `recipient_id` |
| **`meal_entitlement_guard`** | `shelter_{code}` | `distribution.scan`<br>`distribution.void` | - ห้าม Delete เอกสารเด็ดขาด<br>- อนุญาตเฉพาะ transition: `create` (claimed), `claimed` $\rightarrow$ `voided`, `voided` $\rightarrow$ `claimed` (CAS reclaim) |
| **`meal_distribution_operation`** | `shelter_{code}` | `distribution.scan` | - ควบคุมวงจรชีวิต operation ครัวเรือน<br>- ชดเชยได้เฉพาะ Guard ที่มี `operation_id` ตรงกัน |
| **`meal_override_guard`** | `shelter_{code}` | `distribution.override_entitlement` | - บันทึกการอนุมัติแจกซ้ำเป็นกรณีพิเศษ<br>- ต้องระบุ `override_by` และเหตุผล |
| **`supply_distribution_idempotency`** | `shelter_{code}` | `distribution.scan` | - Append-only แบบเด็ดขาด (ห้าม update, ห้าม delete)<br>- รหัสเอกสาร deterministic ตาม request token |
| **`supply_distribution_capacity`** | `shelter_{code}` | `distribution.scan`<br>`distribution.void` | - ควบคุมยอดจองหน้างานชั่วคราว<br>- ยอดจองรวมต้องไม่เกินความจุที่ตรวจรับ |
| **`supply_distribution_guard`** | `shelter_{code}` | `distribution.scan`<br>`distribution.override_entitlement` | - ป้องกันการแจกของแจกขาดซ้ำโควตา<br>- มีเจ้าของ claim ได้ไม่เกิน 1 รายการ |
| **`supply_distribution_gate`** | `shelter_{code}` | `ticket.manage`<br>`distribution.close_shift` | - ควบคุมการปิดรอบแจกจ่ายพัสดุ<br>- เมื่อ `sealed` ต้องไม่มี pending claim ค้าง |
| **`loan_active_guard`** | `shelter_{code}` | `loan.issue`<br>`loan.return` | - ควบคุมจำนวนอุปกรณ์คงทนที่ผู้ประสบภัยยืมค้างอยู่<br>- อัปเดตยอด active ยืมเข้า/คืนออก |
| **`loan_dropoff_batch`** | `shelter_{code}` | `loan.return`<br>`warehouse.restock` | - State machine: `staged` $\rightarrow$ `in_transfer` $\rightarrow$ `warehouse_received`<br>- เมื่อถึงคลังแล้วห้ามแก้ไขจำนวนพัสดุ |
| **`item_category` (v2)** | `catalog` | `system.manage_catalog` | - จัดเก็บใน DB กลาง `catalog`<br>- หาก `is_protected: true` ห้ามลบหรือเปลี่ยน `system_key` |

---

## 3. คลาสสิทธิ์การใช้งาน (Capability Classes Specification)

ข้อกำหนดสิทธิ์ในสเปกฉบับนี้กำหนดในรูปแบบ **Capability-Oriented** โดยระบุวัตถุประสงค์และเอกสารที่เกี่ยวข้อง:

| Capability | วัตถุประสงค์ทางธุรกิจ (Purpose) | เอกสารที่เกี่ยวข้อง (Affected Document Types) |
| :--- | :--- | :--- |
| `ticket.create` | สร้างคำร้องเบิกจ่ายพัสดุ/อาหารภายในศูนย์ | `requisition_ticket` |
| `ticket.manage` | จัดการและดูแลวงจรชีวิตของตั๋วเบิกจ่าย | `requisition_ticket`, `supply_distribution_gate` |
| `ticket.close` | ปิดรอบและกระทบยอดตั๋วเบิกจ่าย | `requisition_ticket` |
| `warehouse.verify` | ตรวจสอบการจัดเตรียมและหยิบของในคลัง | `requisition_fulfillment` |
| `warehouse.dispatch` | ตัดจ่ายและยืนยันการนำส่งพัสดุออกจากคลัง | `requisition_fulfillment`, `stock_ledger` |
| `warehouse.restock` | ตรวจรับพัสดุ/ของคืนเข้าคลังสินค้า | `stock_ledger`, `loan_dropoff_batch` |
| `distribution.scan` | บันทึกการแจกจ่ายพัสดุ/อาหารให้แก่ผู้ประสบภัยหน้างาน | `distribution_log`, `meal_entitlement_guard`, `meal_distribution_operation`, `supply_distribution_*` |
| `distribution.receive` | ยืนยันการตรวจรับพัสดุที่นำส่งมาถึงจุดแจกจ่าย | `requisition_fulfillment` |
| `distribution.void` | ยกเลิกรายการแจกจ่ายที่ผิดพลาดพร้อมบันทึก audit | `distribution_log`, `meal_entitlement_guard`, `supply_distribution_capacity` |
| `distribution.override_entitlement` | อนุมัติการแจกซ้ำเป็นกรณีพิเศษ (Exceptional repeat) | `meal_override_guard`, `supply_distribution_guard` |
| `loan.issue` | บันทึกการยืมพัสดุคงทนแก่ผู้พักพิงที่ระบุตัวตนได้ | `distribution_log`, `loan_active_guard` |
| `loan.return` | บันทึกการรับคืนพัสดุยืมหน้างานหรือที่จุดรับคืน | `distribution_log`, `loan_active_guard`, `loan_dropoff_batch` |
| `distribution.close_shift` | ปิดรอบ/ปิดกะการแจกจ่ายประจำวัน | `supply_distribution_gate` |
| `system.manage_catalog` | จัดการหมวดหมู่และข้อมูลหลักในแคตตาล็อกกลาง | `item_category` (v2) |

> [!IMPORTANT]
> **Role-to-capability mapping is intentionally NOT frozen by this CR. It requires a separate RBAC Amendment / Authorization Matrix approved by the Project Owner.**
>
> การผูกโยงคลาสสิทธิ์เข้ากับบทบาทผู้ใช้งานที่เป็นรูปธรรม (Concrete RBAC Roles) จะกระทำผ่านเอกสารแก้ไขเพิ่มเติมสิทธิ์ (RBAC Amendment / Authorization Matrix) ในภายหลัง ห้ามถือว่าการมีชื่อบทบาทอยู่แล้ว (เช่น `supply_coordinator` หรือ `warehouse_staff`) จะได้รับสิทธิ์ใหม่เหล่านี้โดยอัตโนมัติ (No Silent Privilege Expansion)
>
> **ขอบเขตความเป็นส่วนตัวของคลังพัสดุ (Warehouse Privacy Boundary):**
> บทบาทเจ้าหน้าที่คลัง (`warehouse_staff`) ต้องมุ่งเน้นเฉพาะการดูแลพัสดุทางกายภาพ (`warehouse.verify`, `warehouse.dispatch`, `warehouse.restock`) และ**ต้องไม่ได้รับสิทธิ์เข้าถึงข้อมูลระบุตัวตนของผู้ประสบภัย (Person / Evacuee / Medical records) หรือสิทธิ์หน้างานผู้ประสบภัย (`distribution.scan`, `loan.issue`) โดยปริยาย** หากจะมีการมอบหมายสิทธิ์หน้างานใด ๆ จะต้องผ่านการอนุมัติใน RBAC Amendment แยกต่างหากอย่างชัดแจ้ง

---

## 4. กฎการแบ่งแยกฐานข้อมูลและขอบเขตความปลอดภัย (Tenant Isolation & Database Boundaries)

1. **การแบ่งแยกขอบเขตฐานข้อมูล (Per-Database Scope):**
   - **`shelter_{code}`:** เป็นพื้นที่จัดเก็บเอกสารระดับปฏิบัติการและเอกสารประสานงานความพร้อมกันภายในศูนย์ 12 ประเภท (`requisition_ticket`, `requisition_fulfillment`, `distribution_log`, `meal_entitlement_guard`, `meal_distribution_operation`, `meal_override_guard`, `supply_distribution_idempotency`, `supply_distribution_capacity`, `supply_distribution_guard`, `supply_distribution_gate`, `loan_active_guard`, `loan_dropoff_batch`)
   - **`catalog`:** จัดเก็บเฉพาะเอกสารมาตรฐานกลาง `item_category` (schema_v2) โดยการเขียน/ปรับปรุงต้องมี capability `system.manage_catalog` (การผูกโยงบทบาทรอการอนุมัติใน RBAC Amendment)
   - **`central_ops`:** มุ่งเน้นเฉพาะเอกสารโอนย้ายข้ามศูนย์ `stock_transfer` (schema_v4) ตามสถาปัตยกรรมเดิม (CR-089 / CR-118) **ห้ามนำเอกสารตั๋วและแจกจ่ายระดับศูนย์ไปเปิด Whitelist บน `central_ops` โดยเด็ดขาด** เพื่อลดพื้นผิวการโจมตี (Attack Surface)
2. **ห้ามผู้ใช้ระดับศูนย์เขียนตรงเข้า `central_ops`:**
   การเปลี่ยนแปลงสถานะหรือการสร้าง `stock_transfer` บน `central_ops` จะต้องทำผ่าน Server Admin Route ที่มีการตรวจสอบสิทธิ์ตามสถาปัตยกรรมความปลอดภัยเดิมเท่านั้น
3. **การบังคับใช้สิทธิ์ระดับศูนย์พักพิง (Shelter-Scoped Authority):**
   การเข้าถึงและเขียนข้อมูลบนฐานข้อมูล `shelter_{shelter_code}` ต้องผ่านการตรวจสอบว่าผู้ใช้มีสิทธิ์ที่ผูกกับรหัสศูนย์พักพิงเป้าหมาย (Shelter-Scoped Authority) ตามสถาปัตยกรรมความปลอดภัยและการพิสูจน์สิทธิ์เดิมของระบบ
4. **การปฏิเสธการดำเนินการออฟไลน์ (Fail-Closed Remote Mutation):**
   ฟังก์ชัน VDU จะทำงานบนฝั่ง Server/CouchDB เสมอ การร้องขอที่ไม่มี Session ที่ถูกต้องหรือขาดการเชื่อมต่อจะถูกปฏิเสธทันที (CR-110 Remote-First)

---

## 5. เกณฑ์การยอมรับ (Acceptance Criteria)

- **AC-SEC-01 (Whitelist Provisioning):** เมื่อส่งเอกสารระดับศูนย์พักพิง 12 ประเภทเข้าสู่ `shelter_{code}` และ `item_category` v2 เข้าสู่ `catalog` ที่ได้รับการ provision แล้ว เอกสารต้องไม่ถูก VDU ปฏิเสธด้วยข้อหา unknown doc type
- **AC-SEC-02 (State Reversal Blocked):** หากมีคำสั่งพยายามเปลี่ยนสถานะของ `RequisitionTicket` ย้อนหลังจาก `in_progress` กลับไปเป็น `draft` VDU ต้องปฏิเสธคำสั่งนั้น
- **AC-SEC-03 (Anti-Delete Guards):** หากมีคำสั่งส่ง `_deleted: true` สำหรับเอกสาร `meal_entitlement_guard` VDU ต้องปฏิเสธคำสั่งนั้น (ห้ามลบเอกสาร guard)
- **AC-SEC-04 (Capability Enforcement):** ผู้ใช้หรือเซสชันที่ไม่มี capability `distribution.override_entitlement` จะไม่สามารถเขียนเอกสาร `meal_override_guard` ได้
