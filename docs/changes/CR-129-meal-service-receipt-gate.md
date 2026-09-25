---
id: CR-129
title: เพิ่มขั้น "รอตรวจรับเข้าคลัง" จริงระหว่างบันทึกผลผลิตครัวกับส่งมอบเสร็จสิ้น (`meal_service_receipt`)
status: approved
date: 2026-09-25
updated: 2026-09-25
requested_by: Project Owner (session ปรับ UI /back-office/tickets/kitchen)
decided_by: Project Owner
layer: stable
extends:
  - CR-121 §3.2/§4.2 (ผลผลิตครัว `meal_service`/`yield_items` — ไม่แตะ scope นั้น, ส่วน
    `yield_items`/`stock_ledger` รับเข้าอัตโนมัติยังไม่ implement ในโค้ดจริงตอนนี้ แยกเป็นงานอื่น)
  - CR-125/CR-128 (ticket-list.svelte unified hub — เดิมมี tab "รอตรวจรับเข้าคลัง" เป็น mock
    placeholder เท่านั้น เพราะไม่มี state จริงรองรับ — CR นี้ทำให้เป็นของจริง)
affects:
  - docs/data/schema.md (เพิ่ม doc type ใหม่ §2.7.3 `meal_service_receipt`)
  - frontend/src/lib/features/kitchen/domain/kitchen.ts (type + factory ใหม่ `MealServiceReceipt`)
  - frontend/src/lib/features/kitchen/data/kitchen.repository.ts + kitchen.remote.ts (method ใหม่
    `confirmMealServiceReceipt`, `listMealServiceReceipts`)
  - frontend/src/lib/features/kitchen/application/queries.ts (hooks ใหม่)
  - frontend/src/lib/features/kitchen/index.ts (barrel)
  - frontend/src/lib/features/tickets/ui/ticket-list.svelte (tab "รอตรวจรับเข้าคลัง" ใช้ข้อมูลจริง
    + ปุ่มยืนยันตรวจรับ)
---

# CR-129: ขั้น "รอตรวจรับเข้าคลัง" จริงหลังบันทึกผลผลิตครัว

## 1. Why

Flow เต็มที่เจ้าของโครงการยืนยัน: **รอเบิกวัตถุดิบ → ครัวกำลังปรุง → รอตรวจรับเข้าคลัง (หลังบันทึก
ผลผลิต) → ส่งมอบเสร็จสิ้น**. ของเดิม (ก่อน CR นี้) พอครัวกด "บันทึกผลผลิต" ที่ production-board
(`recordMealService`) ระบบเอา `meal_service` ไปตีความเป็น "ส่งมอบเสร็จสิ้น" ทันทีใน
ticket-list.svelte (tab "รอตรวจรับเข้าคลัง" เป็น mock placeholder ที่ไม่มีวันมีแถวจริง ตามที่เคย
บันทึกไว้ในคอมเมนต์เดิม) — ข้ามขั้นตอนที่คลังต้องตรวจนับจริงก่อนรับเข้า

## 2. Change

### 2.1 Doc type ใหม่ `meal_service_receipt` (ไม่แก้ `meal_service` เดิม)

`meal_service` เป็น **append-only** (docs/data/schema.md §1817 invariant) ห้าม update/delete —
จึงไม่เพิ่มฟิลด์ `received_by`/`received_at` ลงบน doc เดิม แต่สร้าง doc แยกใหม่ (append-only
เช่นกัน) แทน ตามแพทเทิร์นเดียวกับ `gas_ledger`/`stock_ledger` ที่บันทึกเหตุการณ์เป็นแถวใหม่แทนการ
แก้ record เดิม:

```ts
interface MealServiceReceipt {
  type: 'meal_service_receipt';
  schema_v: 1;
  meal_service_id: string; // อ้าง meal_service._id — 1 ใบเสร็จต่อ meal_service (idempotent guard)
  received_by: string;
}
```

### 2.2 การไหลของสถานะ (synthetic — ไม่แตะ `RequisitionTicket.status`)

ticket-list.svelte ตีความหมวดของแถว `meal_service` จากการมี/ไม่มี `meal_service_receipt` คู่กัน:

- ไม่มี receipt → หมวด **"รอตรวจรับเข้าคลัง"** (`PENDING_RECEIPT`, จริงแล้วไม่ใช่ mock อีกต่อไป)
- มี receipt → หมวด **"ส่งมอบเสร็จสิ้น"** (`DELIVERED_IN`)

ปุ่ม "ยืนยันตรวจรับ" (คลิกเดียว ตามแพทเทิร์น CR-128) อยู่ในแถวของ ticket-list.svelte เอง เรียก
`confirmMealServiceReceipt(mealServiceId, ctx)` — reject ถ้ามี receipt อยู่แล้ว (idempotency)

### 2.3 ไม่กระทบ `RequisitionTicket`/`stock_ledger`

CR นี้เป็นแค่ checkpoint ตรวจรับเชิงธุรการ (audit gate) ไม่ผูกกับการตัดสต็อกวัตถุดิบ (จบไปแล้วที่
CR-128) และไม่ผูกกับการรับเข้าสต็อกอาหารปรุงสำเร็จ (`yield_items`/`stock_ledger reason=receive`
ตาม CR-121 §3.2 ซึ่งยังไม่ implement ในโค้ดจริง — คนละงาน แยกทำภายหลังถ้าต้องการ)

## 3. Impact

- Schema ใหม่ 1 doc type (`meal_service_receipt`, schema_v 1) — ไม่กระทบ backward-compat เดิม
  ของ `meal_service`/`requisition_ticket`
- ticket-list.svelte comment เดิมที่บอกว่า "PENDING_RECEIPT เป็น mock-only tab" ไม่จริงอีกต่อไป
  หลัง CR นี้ — ต้องอัปเดตคอมเมนต์ให้ตรง
