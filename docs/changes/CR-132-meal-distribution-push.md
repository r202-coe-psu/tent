---
id: CR-132
title: จัดสรรอาหารปรุงเสร็จส่งจุดแจกจ่าย (Push to POS) — doc ใหม่ meal_distribution_push (MVP, ไม่ผูก stock_ledger)
status: approved
date: 2026-09-25
updated: 2026-09-25
requested_by: Project Owner (session ปรับ UI /back-office/tickets/kitchen)
decided_by: Project Owner
layer: stable
extends:
  - CR-129/CR-131 (meal_service_receipt — ผลผลิตต้องถูก "ยืนยันตรวจรับ" (`outcome=confirmed`) ก่อน
    ถึงจะจัดสรรส่งจุดแจกได้)
affects:
  - docs/data/schema.md (doc type ใหม่ §2.7.4 `meal_distribution_push`)
  - frontend/src/lib/features/kitchen/domain/meal-distribution-push.ts (ใหม่)
  - frontend/src/lib/features/kitchen/data/kitchen.repository.ts + kitchen.remote.ts (method ใหม่)
  - frontend/src/lib/features/kitchen/application/queries.ts (hooks ใหม่)
  - frontend/src/lib/features/kitchen/index.ts (barrel)
  - frontend/src/routes/(protected)/back-office/kitchen/distribute/+page.svelte (หน้าใหม่)
  - frontend/src/lib/features/tickets/ui/ticket-list.svelte (ปุ่ม "จัดสรรอาหารส่งจุดแจก (Push)" เดิม
    เป็นแค่ toast stub — เปลี่ยนเป็นลิงก์ไปหน้าใหม่)
---

# CR-132: จัดสรรอาหารปรุงเสร็จส่งจุดแจกจ่าย (Push to POS)

## 1. Why

Flow ที่เจ้าของโครงการยืนยัน: รอเบิกวัตถุดิบ → ครัวกำลังปรุง → รอตรวจรับเข้าคลัง →
**ส่งมอบเสร็จสิ้น (ยืนยันตรวจรับแล้ว) → จัดสรรส่งจุดแจกจ่าย**. ขั้นสุดท้ายนี้ยังเป็นปุ่ม stub
("ยังไม่เปิดใช้งานในระบบนี้") ใน ticket-list.svelte — ต้องทำจริง

## 2. สำรวจก่อนตัดสินใจ (สำคัญ — เหตุผลที่ไม่ใช้ของเดิม)

มี backend เดิมสำหรับ "แจกจ่าย" 2 ระบบซ้อนกันอยู่แล้วในโค้ด:

1. **CR-059 `distribution_request`/`distribution_batch`/`distribution_issue`** (`$lib/features/distribution`) —
   domain+data ครบ แต่**ไม่มี UI เลย** ออกแบบมาสำหรับของบรรเทาทุกข์ (NFI) แจกจ่ายรายบุคคล
   (scan บัตร ตรวจสอบสิทธิ์ซ้ำ/ไม่ซ้ำ) — `distribution_batch.allocations[].lot_ref` **บังคับ**
   ต้องชี้ไปยัง `stock_ledger` จริงเสมอ (schema-enforced)
2. **CR-121 `distribution_log`** (schema.md §2.30) — เป็น spec-only ยังไม่ implement เลย

ลองจะใช้ (1) ซ้ำ แต่ชนกับอีกการตัดสินใจ (ไม่ทำ `stock_ledger` ให้อาหารปรุงสำเร็จตอนนี้ — ดู §3):
`distribution_batch` เขียนไม่ได้ถ้าไม่มี lot อ้างอิงจริง และรูปแบบข้อมูล (eligibility/repeat-override)
ก็ไม่ตรงกับ mockup ที่เป็น bulk push ไปจุดแจกทีเดียว ไม่ใช่สแกนรายคน — **จึงตัดสินใจสร้าง doc ใหม่
เล็กๆ เฉพาะอาหาร แยกจาก CR-059/CR-121 ทั้งคู่**

## 3. Change

### 3.1 Doc type ใหม่ `meal_distribution_push`

```ts
interface MealDistributionPushItem {
  meal_service_id: string; // อ้าง meal_service._id ที่ outcome='confirmed' แล้วเท่านั้น
  menu_label: string;
  qty: number; // จำนวนกล่องที่จัดสรรรอบนี้
}
interface MealDistributionPush {
  type: 'meal_distribution_push';
  schema_v: 1;
  pos_station: string; // เลือกจาก shelter_master.zones[] จริง (ดู §3.2) — เก็บเป็น label ไม่ผูก FK
  meal_session_id: string;
  dispatcher: string; // เจ้าหน้าที่ผู้จัดสรร/ทีมลำเลียง
  vehicle?: string;
  items: MealDistributionPushItem[];
}
```

**สต็อกคงเหลือคำนวณสด ไม่เก็บ field แยก:** `คงเหลือของ meal_service = actual_yield − Σ(qty ใน
meal_distribution_push.items ที่มี meal_service_id ตรงกัน, ทุก doc)`. ระบบตรวจสอบ all-or-nothing
ก่อนเขียน (เหมือน `dispatchTicket`/`oneStepApproveTicket`) — ห้ามจัดสรรเกินยอดคงเหลือ

**Guard:** `meal_service_id` ที่เลือกได้ต้องมี `meal_service_receipt.outcome = 'confirmed'`
(CR-129/CR-131) เท่านั้น — ยังไม่ยืนยันตรวจรับ ห้ามจัดสรรออก

### 3.2 UI หน้าใหม่ `/back-office/kitchen/distribute`

อิงตาม mockup เฉพาะส่วนที่มีข้อมูลจริงรองรับ:

- ฟอร์ม: จุดแจกจ่ายปลายทาง (เลือกจาก `shelter_master.zones[]` จริงที่ `status != 'closed'` — แพทเทิร์น
  เดียวกับ `evacuee-select-zone.svelte` — บวกตัวเลือก "จุดแจกจ่ายรวมทุกโซน (Main Hub POS)"),
  รอบมื้ออาหาร (เลือกจาก `meal_session` ที่มี `meal_service` รอส่งมอบเท่านั้น), เจ้าหน้าที่ผู้จัดสรร,
  ยานพาหนะ (optional)
- ตารางเมนู: แสดง `meal_service` ที่ยืนยันตรวจรับแล้วของรอบมื้อที่เลือก พร้อมยอดคงเหลือคำนวณสด และ
  ช่องกรอกจำนวนจัดสรร
- ปุ่ม "ยืนยันจัดสรรและออกตั๋วส่งจุดแจก (Push to POS)"

**ตัดออกจาก mockup (ไม่มีข้อมูลจริงรองรับ ไม่ทำ mock):** การ์ดสัดส่วนประชากรตามกลุ่มโภชนาการ
(ทั่วไป/ฮาลาล/เปราะบาง/มังสวิรัติ/น้ำดื่ม) ระดับจุดแจก, badge "Citizen ID Single Source of Truth
Verified" — ไม่มีแหล่งข้อมูล headcount ระดับจุดแจกจริงในระบบตอนนี้ (มีแค่ระดับ meal_session/
target_tags ซึ่งคนละมิติ) เพิ่มได้ภายหลังถ้ามีข้อมูลจริงรองรับ

### 3.3 ticket-list.svelte: หมวดใหม่ "รอส่งมอบ" (`PENDING_DISPATCH`)

หลัง `meal_service` ถูก "ยืนยันตรวจรับ" (`outcome='confirmed'`) แล้ว เดิมถือว่า "ส่งมอบเสร็จสิ้น"
ทันที — ตอนนี้แยกเป็น 2 หมวดตามยอดคงเหลือที่ยังไม่ได้ push (`mealServicePushRemaining`):

- ยังมีคงเหลือ (> 0) → หมวด **"รอส่งมอบ"** (`PENDING_DISPATCH`, สีม่วง) — กด "จัดการ" ไปหน้า
  `/back-office/kitchen/distribute?session={meal_session_id}` (พรีเซ็ตรอบมื้อให้)
- คงเหลือ = 0 (push ครบแล้ว) → หมวด **"ส่งมอบเสร็จสิ้น"** (`DELIVERED_IN`) เหมือนเดิม

## 4. Impact

- Doc type ใหม่ 1 ตัว, schema_v 1, ไม่กระทบของเดิม
- ไม่ใช้ CR-059 distribution engine, ไม่ใช้ CR-121 distribution_log spec — เป็นเส้นทางที่ 3 แยกต่างหาก
  เฉพาะอาหารปรุงสำเร็จเท่านั้น (ของบรรเทาทุกข์/NFI ยังคงใช้ CR-059 เดิมถ้ามี UI ในอนาคต)
- จุดแจกจ่ายปลายทางเลือกจาก `shelter_master.zones[]` จริง (ไม่ใช่ free text อีกต่อไป) — ยังไม่มี FK
  บังคับ (`pos_station` เก็บเป็น label string เหมือน `requisition_ticket.destination_location`)
  ถ้าโซนถูกปิด/เปลี่ยนชื่อภายหลัง label ที่บันทึกไว้ใน push เดิมจะไม่อัปเดตตาม (append-only)
