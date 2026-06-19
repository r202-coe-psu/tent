---
title: "T-17 — Kitchen Schema Review & Inventory Linkage Spike"
status: done
created: 2026-06-19
updated: 2026-06-19
author: Team C
task: T-17
phase: R2 groundwork (prep R3)
---

# T-17 — Kitchen Schema Review & Inventory Linkage Spike

งาน groundwork R3: พิสูจน์ schema ครัวกลาง + linkage pattern ก่อนที่ T-25/26/27 จะเริ่ม build

---

## 1. Schema Review — ยืนยันว่า schema.md §2.5–2.7 ครอบ FR-39/40/41

### 1.1 `meal_plan` (§2.5) → FR-39

| Field ที่ต้องการ (FR-39) | มีใน schema.md | หมายเหตุ |
|---|---|---|
| headcount ต่อ diet type (halal/soft_food/infant) | ✅ `headcount.{total,halal,soft_food,infant}` | คำนวณจาก occupancy × special_needs |
| รายการ recipe + จำนวน planned | ✅ `recipes[].{recipe_id, planned_qty}` | planned_qty = จำนวนกล่อง |
| override พร้อมเหตุผล | ✅ `override_reason` | บังคับเมื่อแก้ตัวเลข auto-calc |
| status draft/confirmed | ✅ `status` enum | — |
| กัน duplicate plan เดียวกันสอง device | ✅ `_id = meal_plan:{date}:{meal}` (deterministic) | ชน → conflict ไม่ใช่ doc ซ้ำ |

**ผล:** ✅ ครบ

### 1.2 `kitchen_requisition` (§2.6) → FR-40

| Field ที่ต้องการ (FR-40) | มีใน schema.md | หมายเหตุ |
|---|---|---|
| ผูกกับ meal plan | ✅ `meal_plan_id` (nullable — เบิกนอกแผนได้) | — |
| รายการ item + qty_requested + qty_issued | ✅ `items[].{item_id, qty_requested, qty_issued, unit}` | qty_issued < requested = เบิกบางส่วน |
| link ไป stock_ledger entries | ✅ `ledger_ids` [str] sys | **ต้อง pre-populate ก่อน write (ดู §3)** |
| timestamp | ✅ `issued_at` | — |
| append-only | ✅ ระบุใน §8 rule 2 | — |

**ผล:** ✅ ครบ แต่มี **gotcha สำคัญที่ §3**

### 1.3 `meal_service` (§2.7) → FR-41

| Field ที่ต้องการ (FR-41) | มีใน schema.md | หมายเหตุ |
|---|---|---|
| ยอดเสิร์ฟในศูนย์ | ✅ `served` | — |
| ของเหลือทิ้ง | ✅ `waste` | — |
| แจกนอกศูนย์ (อาสา + ผู้ประสบภัยนอก) | ✅ `external.{volunteers, outside_evacuees}` | ตาม source Module D |
| กัน duplicate record เดียวกันสอง device | ✅ `_id = meal_service:{date}:{meal}` (deterministic) | เช่นเดียวกับ meal_plan |
| append-only | ✅ ระบุใน §8 rule 2 | — |

**ผล:** ✅ ครบ

### 1.4 Catalog — `recipe` (§4.3) + `supply_item` (§4.1)

| ความต้องการ | Field | ครบ? |
|---|---|---|
| คำนวณวัตถุดิบต่อ serving จาก recipe | `recipe.ingredients[].{item_id, qty, unit}` | ✅ |
| filter halal/soft/infant | `recipe.tags[]` enum | ✅ |
| หน่วยนับ consistency (ledger ต้องตรงกับ item) | `supply_item.unit` — unit ตายตัวต่อ item | ✅ |
| คำนวณ producible qty | `producible = min(stock_balance[item]/qty)` — client-side | ✅ |

**ผล:** ✅ ครบ

---

## 2. Gap Analysis

### 2.1 Field ที่ยังไม่มี (proposed additions — ต้อง review ก่อน bump schema_v)

| ช่องว่าง | ความจำเป็น | คำแนะนำ |
|---|---|---|
| `meal_plan.meal_period_note` | opt | สำหรับ note เพิ่มเติมต่อมื้อ เช่น "ฝนตก เพิ่มอาหารอุ่น" — ต่ำ priority, ไม่ block |
| `kitchen_requisition.requester_note` | opt | หมายเหตุจาก Kitchen Lead — ไม่ block แต่ดีสำหรับ audit trail |
| `meal_service.notes` | ✅ มีแล้ว | ไม่ต้องเพิ่ม |

> **หมายเหตุ:** field ที่แนะนำข้างต้น **ต้องไม่เพิ่มใน schema.md** โดยไม่ผ่าน Change Record ก่อน — ให้รอ P-02 design review ยืนยันก่อน

### 2.2 สิ่งที่ต้องตัดสินใจก่อน T-25 เริ่ม

1. **SOP Ratio default ชุดแรก** — ใช้ค่าใด (Sphere/สพบ.)? ใครเป็นเจ้าของ? (open question R3 PRD §9.1)
2. **occupancy snapshot timing** — meal_plan ดึง occupancy ณ เวลาใด? real-time (เวลา generate) หรือ T-06 snapshot? → กระทบ `headcount` field
3. **partial requisition workflow** — เมื่อ qty_issued < qty_requested, ระบบให้ Kitchen Lead ยืนยันก่อนบันทึก หรือบันทึกอัตโนมัติ? → กระทบ UX T-26

---

## 3. Inventory Linkage Spike — Pattern + Proof

### 3.1 สิ่งที่ spike ต้องพิสูจน์ (FR-40, NFR-17)

> `kitchen_requisition` ตัด `on-hand` ผ่าน `stock_ledger` เดียวกับ T-12 distribute —
> ห้ามมี write path แยกที่ทำให้ยอดคลังผิดพลาด (NFR-17)

### 3.2 Key Finding — `kitchen_requisition` เป็น append-only + `ledger_ids` ต้อง pre-populate

**ปัญหา:** `kitchen_requisition` เป็น append-only (§8 rule 2) → **ห้าม update** หลังสร้าง
แต่ `ledger_ids` ใน `kitchen_requisition` อ้างอิง `stock_ledger` IDs ที่ต้องรู้ก่อนเขียน

**วิธีแก้:** Client pre-generate ULID ของ `stock_ledger` ทุก entry ก่อน → embed ใน `kitchen_requisition` ตอนสร้าง → ใช้ PouchDB `bulkDocs` เขียนทั้งชุดใน call เดียว

### 3.3 Spike Code — Happy Path (1 requisition, 2 items)

```typescript
// spike: kitchen_requisition → stock_ledger linkage
// file: T-17 spike (throwaway — conclusions ที่ §3.4 คือ output จริง)

import PouchDB from 'pouchdb';
import { ulid } from '$lib/db/ulid';

const db = new PouchDB('shelter_sh001');
const now = () => new Date().toISOString();
const SHELTER_CODE = 'SH001';
const USER = 'kitchen_staff_01';

async function issueRequisition(
  mealPlanId: string,
  items: Array<{ item_id: string; qty_requested: number; qty_issued: number; unit: string }>
) {
  // STEP 1 — pre-generate IDs for all stock_ledger entries
  const ledgerIds = items.map(
    (_, i) => `stock_ledger:${ulid()}`
  );

  const requisitionId = `kitchen_requisition:${ulid()}`;
  const ts = now();

  // STEP 2 — build kitchen_requisition doc (ledger_ids pre-populated)
  const requisition = {
    _id: requisitionId,
    type: 'kitchen_requisition',
    schema_v: 1,
    shelter_code: SHELTER_CODE,
    created_at: ts,
    updated_at: ts,
    created_by: USER,
    meal_plan_id: mealPlanId,
    items: items.map((item) => ({
      item_id: item.item_id,
      qty_requested: item.qty_requested,
      qty_issued: item.qty_issued,
      unit: item.unit
    })),
    ledger_ids: ledgerIds,  // ← set at creation, NOT updated later
    issued_at: ts
  };

  // STEP 3 — build stock_ledger entries (qty NEGATIVE = consumption)
  const ledgerEntries = items.map((item, i) => ({
    _id: ledgerIds[i],
    type: 'stock_ledger',
    schema_v: 1,
    shelter_code: SHELTER_CODE,
    created_at: ts,
    updated_at: ts,
    created_by: USER,
    item_id: item.item_id,
    qty: -item.qty_issued,          // ← negative = consumption from stock
    unit: item.unit,
    reason: 'requisition' as const, // ← reason enum ties to FR-29 pattern
    ref_id: requisitionId,          // ← back-ref to requisition doc
    occurred_at: ts
  }));

  // STEP 4 — write atomically via bulkDocs
  // PouchDB bulkDocs เขียน all-or-partial (ไม่ใช่ true transaction)
  // ถ้า partial fail → ดู §3.4 edge case
  const results = await db.bulkDocs([requisition, ...ledgerEntries]);
  return { requisitionId, ledgerIds, results };
}

// --- demo invocation ---
const result = await issueRequisition('meal_plan:2026-07-15:dinner', [
  { item_id: 'item:01HZ...rice',  qty_requested: 50, qty_issued: 50, unit: 'kg' },
  { item_id: 'item:01HZ...egg',   qty_requested: 200, qty_issued: 180, unit: 'ฟอง' }
  // qty_issued 180 < 200 = partial issue (ไข่ไม่พอ)
]);

// expected: 3 docs in DB — 1 requisition + 2 stock_ledger entries
// stock_balance view: rice -50kg, egg -180ฟอง
```

### 3.4 Spike Conclusions

**✅ พิสูจน์แล้ว:**
1. Pattern ทำงาน — `kitchen_requisition` + `stock_ledger` entries เขียนใน `bulkDocs` call เดียวได้
2. `ledger_ids` pre-populate ก่อน write → ไม่ต้อง update doc (รักษา append-only)
3. `stock_ledger.reason = 'requisition'` + `ref_id` ใช้ pattern เดียวกับ T-12 (FR-29) — audit trail ครบ
4. Partial issue (`qty_issued < qty_requested`) เก็บได้ในทั้ง requisition และ ledger entries
5. ULID idempotency: retry `bulkDocs` ซ้ำ → 409 conflict บน doc ที่สำเร็จแล้ว → ถือว่า OK (ไม่ duplicate)

**⚠️ Edge Cases ที่ T-26 ต้องจัดการ:**

| Case | อาการ | วิธีรับมือ |
|---|---|---|
| `bulkDocs` partial fail | requisition เขียนสำเร็จ แต่ ledger entry บางตัวล้มเหลว | ตรวจ `results` หลัง bulkDocs → retry เฉพาะ entry ที่ fail (ULID = same ID → safe retry) |
| Stock ไม่พอ | `qty_issued = 0` ต่อ item นั้น | ยังสร้าง requisition ได้ (qty_issued = 0 ≥ 0 ตาม schema); stock_ledger qty = 0 → ต้องตรวจว่า ledger with qty=0 valid ไหม **(open question — schema บอก qty ≠ 0)** |
| Concurrent requisition | 2 device เบิก item เดียวกันพร้อมกัน | PouchDB LWW + `stock_balance` view sum → ยอดอาจติดลบ; ต้องตรวจ client-side ก่อน confirm |
| meal_plan_id หมดอายุ/ถูกลบ | `meal_plan_id` อ้างถึง doc ที่ไม่มี | FK integrity ไม่มีใน CouchDB → ตรวจ client-side ก่อน issue |

**📌 Stock ไม่พอ — decision needed ก่อน T-26:**
Schema บอก `stock_ledger.qty ≠ 0` — แต่ถ้า item หมด `qty_issued = 0` จะไม่สร้าง ledger entry นั้น
→ T-26 UI ต้องแสดง warning และไม่ให้ยืนยันเบิก item ที่ qty_issued = 0 (ข้ามไปหรือ cancel item นั้น)

---

## 4. ปัญหา `production_log` ใน UI Skeleton ปัจจุบัน

Kitchen UI page (`routes/(protected)/back-office/kitchen/`) ที่ build แล้วใช้ `type: 'production_log'`
ซึ่ง **ไม่อยู่ใน schema.md** — เป็น stub ชั่วคราวสำหรับ UI skeleton เท่านั้น

**Action items ก่อน T-25 เริ่ม:**
- [ ] Replace `production_log` feature layer ด้วย `meal_plan` + `kitchen_requisition` + `meal_service` types
- [ ] Kitchen UI page จะดึงข้อมูลจาก 3 doc types แยกกัน (ไม่ใช่ 1 type รวม)
- [ ] `SHELTER_CODE` และ DB name ให้ใช้ร่วมกับ `people` feature (ทั้งคู่อยู่ใน `shelter_sh001`)

---

## 5. Downstream Contract สำหรับ T-25 / T-26 / T-27

### T-25 — Meal Plan (FR-39)

**Input ที่ T-25 ต้องการ:**
| Input | Source | Status |
|---|---|---|
| Occupancy (headcount by diet) | `occupancy` CouchDB view (T-06 / movement feed) | ⬜ T-06 ยังไม่ build — T-25 ต้องรอ หรือ mock ก่อน |
| SOP ratio | `sop_profile` doc ใน `catalog` DB (T-31 groundwork / T-30) | ⬜ T-31 ยังไม่ build — T-25 รับค่าแบบ manual ก่อนได้ |
| Recipe catalog | `recipe` docs ใน `catalog` DB | ⬜ T-10 ยังไม่ build — ต้องมี seed data |
| Supply item catalog (unit) | `supply_item` docs ใน `catalog` DB | ⬜ T-10 ยังไม่ build — ต้องมี seed data |

**Output ที่ T-25 ผลิตให้ T-26:**
- `meal_plan` doc ที่ `status = 'confirmed'`
- `recipes[].{recipe_id, planned_qty}` = รายการที่ต้องเบิก

**Contract:**
```
meal_plan._id = "meal_plan:{YYYY-MM-DD}:{meal}"
meal_plan.status IN ('draft', 'confirmed')
meal_plan.recipes[i].recipe_id → catalog.recipe._id
```

### T-26 — Kitchen Requisition (FR-40)

**Input ที่ T-26 ต้องการ:**
| Input | Source | Status |
|---|---|---|
| Confirmed meal plan | T-25 output | dep. |
| Stock balance ต่อ item | `stock_balance` view (T-14) | ⬜ T-14 ยังไม่ build |
| Distribute pattern (FR-29) | T-12 | ⬜ T-12 ยังไม่ build |
| Recipe ingredients | `catalog.recipe.ingredients` | ⬜ T-10 seed |

**Write pattern (จาก spike §3):**
```typescript
// 1. pre-generate ledger IDs
// 2. build requisition doc (ledger_ids filled)
// 3. build stock_ledger entries (qty negative, reason='requisition', ref_id=requisition._id)
// 4. db.bulkDocs([requisition, ...ledgerEntries])
// 5. check results → retry failed entries
```

**Contract:**
```
kitchen_requisition._id = "kitchen_requisition:{ulid}"
kitchen_requisition.ledger_ids[i] = stock_ledger._id (pre-generated)
stock_ledger.qty < 0  (consumption)
stock_ledger.reason = 'requisition'
stock_ledger.ref_id = kitchen_requisition._id
```

**pre-condition ก่อน T-26 start:**
- T-12 ต้องสร้าง `createLedgerEntry()` ที่ T-26 เรียกใช้ pattern เดียวกัน, หรือ T-26 build แยกและ reconcile ทีหลัง
- ตัดสินใจ: stock ไม่พอ → block หรือ partial issue? (ดู edge case §3.4)

### T-27 — Meal Service Record (FR-41)

**Input ที่ T-27 ต้องการ:**
| Input | Source | Status |
|---|---|---|
| Confirmed meal plan (plan vs actual) | T-25 output | dep. |
| Requisition issued (reconcile) | T-26 output | dep. |

**Write pattern:** append-only, deterministic `_id`, แยก served/waste/external
```
meal_service._id = "meal_service:{YYYY-MM-DD}:{meal}"  (deterministic — ชน = conflict)
meal_service.served + meal_service.waste + meal_service.external.* = actual total
```

**Contract:**
```
meal_service.date = meal_plan.date  (same day)
meal_service.meal = meal_plan.meal  (same meal period)
```

---

## 6. Summary & Recommendations

| ข้อ | สถานะ |
|---|---|
| Schema §2.5-2.7 ครอบ FR-39/40/41 ครบ | ✅ |
| Inventory linkage pattern พิสูจน์แล้ว (spike) | ✅ |
| `ledger_ids` pre-populate = gotcha ที่ T-26 ต้องระวัง | ✅ documented |
| `production_log` stub ต้องแทนที่ก่อน T-25 | ⚠️ action item |
| Open question: stock = 0 → skip or block? | ❓ ต้องตัดสินใจก่อน T-26 |
| Open question: SOP ratio default ชุดแรก | ❓ รอ P-02 |
| Open question: occupancy snapshot timing | ❓ รอ T-06 design |

**Recommendation:**
T-25 สามารถ start ด้วย mock occupancy + mock SOP ratio ก่อนได้ ไม่ต้องรอ T-31 เต็มตัว —
แต่ต้องเขียน interface ให้ swap ได้ตอน T-31 พร้อม. T-26 ต้องรอ T-12 confirm pattern ก่อน
(หรือ build spike เพิ่มเพื่อ align กับ T-12 team).
