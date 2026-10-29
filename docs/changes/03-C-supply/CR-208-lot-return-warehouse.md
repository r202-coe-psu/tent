---
id: CR-208 # renumbered from draft-lot-return-warehouse
title: ของเหลือจากรอบแจกคืนเข้า lot เดิม (`distribution_return` อ้าง `requisition_ticket`) แทนการเปิด lot ใหม่
status: approved
date: 2026-10-28
updated: 2026-10-28 # approved (kong)
requested_by: Dev Team B · issue #888 (Fishcanwalk, 2026-10-25)
decided_by: kong
decision_date: 2026-10-28
layer: stable # แตะ `_design/access` VDU (role gate + ref_id ของ stock_ledger) ต้อง review ก่อน
amends:
  - CR-121 AC-DST-06.1 (แถว ledger ที่ตรวจรับของเหลือคืน)
  - CR-190 (ข้อยกเว้นของกติกา "แถวบวกเป็นล็อตใหม่เสมอ")
affects:
  - docs/data/schema.md §2.1 stock_ledger — ตาราง field (`reason`, `lot_ref`, `lot.note`), ตาราง `reason` → `ref_id` (`distribution_return`, `receive`), ขอบเขตลำดับการเลือกล็อต (CR-143 §A), Migration note
  - no schema_v bump (stock_ledger คง 6 · ไม่เพิ่ม/ลบ field · ขยายค่า `ref_id` ที่ยอมรับของ `distribution_return`)
  - frontend/src/lib/features/distribution/application/food-supplies/reconciliation-workflow.ts (`receiveWarehouseReturns`, `assertWarehouseReturnLedgerSemantics`)
  - frontend/src/lib/features/operations/domain/operations.ts (`REF_PREFIX_BY_REASON.distribution_return`, `distributionReturnInputSchema` / `createDistributionReturnEntry`)
  - frontend/src/lib/server/shelter-access-design.ts (VDU stock_ledger — role gate และ ref_id ของ `distribution_return`)
  - frontend/src/lib/features/operations/ui/ledger/ledger-view.ts (`LEDGER_GROUP_BY_REASON.distribution_return`)
  - frontend/src/lib/features/distribution/application/food-supplies/reconciliation-workflow.test.ts
  - frontend/src/lib/features/distribution/application/food-supplies/ledger-replay.test.ts
  - frontend/src/lib/server/shelter-access-design.test.ts
  - frontend/src/lib/features/operations/ui/ledger/ledger-view.test.ts
  - frontend/src/lib/features/operations/domain (test ของ `createStockLedger` / `REF_PREFIX_BY_REASON` / `createDistributionReturnEntry`)
---

# CR-208 — ของเหลือจากรอบแจกคืนเข้า lot เดิม

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ตอนคลังตรวจรับของเหลือคืนจากตั๋ว (`receiveWarehouseReturns`) ให้เขียน
>   `reason: 'distribution_return'` **1 แถวต่อ (ชนิด, lot)** ที่ `lot_ref` ชี้ lot ต้นทาง แทน `receive` 1 แถวต่อชนิดที่เปิด lot ใหม่.
>   ยอดส่วนที่ระบุ lot ต้นทางไม่ได้ (เช่นจาก top-up ที่ไม่อ้าง lot) ยังลง `receive` เป็น lot ใหม่แบบเดิม 1 แถว
> - **ทำไม:** lot ใหม่ทำให้ `expiry` / `produced_at` / จุดเก็บ / `lot_no` / ที่มาของ lot หาย → FEFO มองของเก่าเป็นของใหม่
>   และของที่หมดอายุแล้วถูกเลือกไปแจกได้โดยไม่มีป้ายเตือน
> - **Dev ต้อง build:** แบ่งยอดคืนตาม lot ที่จ่ายออก (หมดอายุเร็วสุดก่อน) · ยอดที่ระบุ lot ไม่ได้ลง `receive` lot ใหม่ ·
>   แถวแรกใช้ id เดิมเพื่อกัน client รุ่นเก่าเขียนซ้ำ · replay/retry เทียบชุดแถวที่คาดไว้ทั้งชุด ·
>   ให้ `distribution_return` รับ `ref_id` `requisition_ticket:` ทั้งใน factory และ VDU · เปิดสิทธิ์ให้ role ที่ตรวจรับได้ ·
>   ย้าย `distribution_return` ไปกลุ่ม "รับเข้า" บนหน้า ledger
> - **กระทบ:** schema.md §2.1 (ไม่ bump `schema_v`) · CR-121 AC-DST-06.1 · ข้อยกเว้นจาก CR-190 · **redeploy VDU ก่อนปล่อย client**

---

## Why

### ปัญหา (#888)

`receiveWarehouseReturns` เขียน `stock_ledger` `reason: 'receive'`, `ref_id` = ตั๋ว, `lot: { note: 'distribution_return' }`
โดยไม่มี `lot_ref` ของ lot เดิม. `createParsedStockLedger` ถือว่าแถว `receive` ที่ `qty` บวกเป็น lot ใหม่ จึงตั้ง
`lot_ref = _id` ของแถวเอง และ `lot.produced_at` = เวลาตรวจรับ.

| ข้อมูลของ lot เดิม | หลังรับคืน (ปัจจุบัน) |
| --- | --- |
| `lot.expiry` | หาย |
| `lot.produced_at` | เปลี่ยนเป็นเวลาตรวจรับ |
| `lot.storage_point_id` / `lot.storage_zone` | หาย → แสดง "คลังหลัก" |
| `lot.lot_no` | หาย |
| ที่มาของ lot (ผู้บริจาค / ใบรับเข้า) | หาย → `ref_id` เป็นตั๋ว |

ผลที่ยืนยันด้วย probe (vitest บน `fe5720ef9` เรียก `createStockLedger`, `projectStockLotBalances`, `scoreLot`,
`isLotExpired`, `summarizeItemStock` จริง):

- **กรณี A — `shelf_life_days` 30 วัน** (lot ผลิต 2026-10-01, รับคืน 2026-10-25): lot เดิมเหลือ 6 วัน (`isUrgent: true`)
  แต่ lot คืนเหลือ 30.3 วัน (ไม่เร่งด่วน, วันหมดอายุแสดง 2026-11-24 แทน ~2026-10-31). วันที่ 2026-11-02 lot เดิมหมดอายุ
  แต่ lot คืนยังไม่หมด
- **กรณี B — `lot.expiry` = 2026-10-28:** lot คืนไม่มี `expiry` → ใช้ HORIZON ของแห้ง 365 วัน → ถูกจัดลำดับ**หลังสุด**.
  วันที่ 2026-10-30 `isLotExpired: false`, `summarizeItemStock` คืน `earliestExpiry: null` (ไม่มีป้าย) และ
  `validateDispatchLotAllocations` ไม่บล็อก → ของหมดอายุจริงถูกเลือกไปแจกได้

### Spec ขัดกันเอง

- CR-121 AC-DST-06.1 และ schema.md §2.1 (ตาราง `reason` → `ref_id` แถว `receive`) กำหนดให้ลงแถว `receive` แบบที่โค้ดทำอยู่
- schema.md §2.1 field `lot_ref` แนะนำให้แถว `receive` ที่รับของแจกเหลือคืนคลังอ้าง `lot_ref` เดิม — factory ไม่ยอม
  (throw `New inbound stock ledger lot_ref must equal its own _id`)
- CR-190 กำหนดว่ายอดที่เพิ่มเป็นล็อตใหม่เสมอ

CR นี้เลือกทางเดียวและแก้ทั้งสามจุดให้ตรงกัน.

---

## Change

### 1. Ledger ที่เขียนตอนตรวจรับของเหลือคืน

| | ก่อน | หลัง |
| --- | --- | --- |
| `reason` | `receive` | `distribution_return` (+ `receive` ส่วนที่ระบุ lot ไม่ได้ — §1.1) |
| จำนวนแถว | 1 ต่อชนิด | 1 ต่อ (ชนิด, lot ต้นทางที่ระบุได้) ที่ได้ยอดคืน > 0 และอีกไม่เกิน 1 แถวสำหรับส่วนที่ระบุ lot ไม่ได้ |
| `ref_id` | `requisition_ticket:{ulid}` | `requisition_ticket:{ulid}` (เดิม) |
| `lot_ref` | ไม่ส่ง → factory ตั้ง `= _id` (lot ใหม่) | `lot_ref` ของ lot ต้นทางจากแถว `distribute` ของตั๋ว |
| `lot` | `{ note: 'distribution_return', produced_at }` | ไม่ส่ง — metadata มาจาก lot ต้นทาง |
| `qty` | ยอดที่คลังนับได้ต่อชนิด | ยอดที่แบ่งให้ lot นั้น (บวก, จำนวนเต็ม) |
| `_id` | `deriveDeterministicLedgerId('warehouse_return', ticket, item_id)` | แถวแรกของชนิด (ตามลำดับ §2) ใช้ id เดิม `('warehouse_return', ticket, item_id)`; lot ถัดไป `(…, item_id, lot_ref)` — เหตุผลดู §1.2 |

#### 1.1 ยอดที่ระบุ lot ต้นทางไม่ได้

แถว `distribute` ของตั๋วบางแถวไม่ได้ชี้ lot จริง. ตัวอย่างที่มีอยู่แล้ว: top-up ระหว่างแจก (`InFlightTopUpDialog` → `amendActiveTicket`)
ไม่ส่ง `lot_ref` จึงได้ `lot_ref = stock_ledger:{amendmentId}` ซึ่งเป็น `_id` ของแถว `distribute` เอง. ledger เป็น append-only
แถวแบบนี้จึงอยู่ถาวร.

- ยอดคืนที่แบ่งไปถึงกลุ่มนี้ (§2) ลงแถว `receive` แบบเดิม 1 แถว: `ref_id` = ตั๋ว, `lot: { note: 'distribution_return' }`,
  ไม่ส่ง `lot_ref` (factory เปิด lot ใหม่), `qty` = ยอดส่วนนี้
- `_id` = `('warehouse_return', ticket, item_id, 'unresolved_lot')` เว้นแต่เป็นแถวเดียวของชนิด (ไม่มี lot ที่ระบุได้เลย) — กรณีนั้นใช้ id เดิม
  `('warehouse_return', ticket, item_id)` และแถวจะเหมือนรูปแบบเดิมทุกอย่าง
- ไม่ใช้ `brokenItemIds` ของ `projectLotsByItem` ตัดสิน: แถว top-up แถวเดียวที่ไหนก็ได้ในศูนย์ทำให้ projection ของชนิดนั้นพังถาวร
  ถ้าใช้ตัวนี้ ทุกตั๋วที่มีชนิดนั้นจะตรวจรับคืนไม่ได้ (ตั๋วค้าง `RETURN_PENDING_RECEIPT` เพราะ `completeTicket` รับเฉพาะ
  `RETURN_COMPLETED` / `SHIFT_CLOSED`)

#### 1.2 กัน client รุ่นเก่าเขียนซ้ำ

client รุ่นก่อน CR นี้ (PWA ที่ยังค้างในเครื่อง) ค้นแถวเดิมเฉพาะ `reason === 'receive'`. ถ้า client ใหม่เขียน `distribution_return` แล้ว
แต่เปลี่ยนสถานะตั๋วไม่สำเร็จ แล้ว client เก่ากด retry มันจะเขียน `receive` id `('warehouse_return', ticket, item_id)`.
แถวแรกของ client ใหม่ใช้ id เดียวกัน → client เก่าได้ `ConflictError` → อ่านแถวเดิม → `assertWarehouseReturnLedgerSemantics`
throw เพราะ `reason` ไม่ตรง → ไม่ลง stock ซ้ำ. แถวแรกตามลำดับ §2 ได้ยอด > 0 เสมอเมื่อยอดที่นับได้ > 0 จึงกันได้ทุกชนิดที่มีของคืน.

### 2. กติกาแบ่งยอดคืนเมื่อจ่ายจากหลาย lot

ตั๋วไม่ได้บันทึกว่าของที่เหลือแต่ละชิ้นมาจาก lot ไหน (`ticketItemSchema` เก็บยอดต่อชนิด, `distribution_log` ไม่มี `lot_ref`).
ข้อมูลที่มีคือยอดที่จ่ายออกต่อ lot จากแถว `reason: 'distribute'` ที่ `ref_id` = ตั๋ว.

**ยอดจ่ายออกต่อ lot** = `|Σ qty|` ของแถว `distribute` **ทุกแถว** ที่ `ref_id` = ตั๋ว และ `item_id` = ชนิดนั้น (รวมแถวจาก
`dispatchTicket` และ `amendActiveTicket`) จัดกลุ่มตาม `lot_ref`.

**lot ที่ระบุได้** = มีแถวต้นทางของ lot: แถว `qty` > 0 ที่ `reason` ≠ `distribution_return`, `(lot_ref ?? _id)` = `lot_ref` นั้น
และ `item_id` / `unit` ตรงกับชนิดที่คืน (แถวแรกตาม `occurred_at`, `_id` — แถวเดียวกับที่ `projectStockLotBalances` ใช้ตั้ง metadata ของ lot).
metadata ของ lot = `lot` ของแถวนั้น, `received_at` = `occurred_at` ของแถวนั้น. แถว `distribute` ที่ไม่มี `lot_ref`, `lot_ref` ไม่มีแถวต้นทาง
หรือแถวต้นทางเป็นคนละชนิด/หน่วย (`amendActiveTicket` รับ `lot_ref` ใด ๆ ที่ขึ้นต้น `stock_ledger:` โดยไม่ตรวจชนิด) → กลุ่ม**ระบุ lot ไม่ได้** (§1.1).

**วันหมดอายุของ lot (เวลาสัมบูรณ์ ms)** — คำนวณจาก metadata ของ lot ต้นทาง และ `shelf_life_days` ของ
`item_master` (อ่านผ่าน `catalog.listItemMasters` → `toLotPriorityItems` แบบเดียวกับ `dispatchTicket`):

1. มี `lot.expiry` → `expiryInstant(lot.expiry)` (สิ้นวันเวลา Asia/Bangkok — CR-195 FR-X5)
2. ไม่มี `lot.expiry` แต่ชนิดมี `shelf_life_days` → `(lot.produced_at ?? received_at) + shelf_life_days` วัน
3. ไม่มีทั้งสองอย่าง → **ไม่ทราบ** (ไม่ใช้ HORIZON ของ `storage_type`)

**ลำดับที่รับคืนก่อน:**

1. lot ที่ทราบวันหมดอายุมาก่อน lot ที่ไม่ทราบ
2. ในกลุ่มที่ทราบ: วันหมดอายุเร็วก่อน
3. เท่ากัน หรือไม่ทราบทั้งคู่: `received_at` เก่าก่อน → `lot_ref` (string compare)
4. กลุ่มระบุ lot ไม่ได้อยู่ท้ายสุด (นับเป็นก้อนเดียว)

ลำดับนี้ใช้เวลาสัมบูรณ์เท่านั้น ไม่ขึ้นกับ `now` (ต่างจาก `daysLeft` / `score` ของ `rankLotsForIssue`) เพื่อให้คำนวณซ้ำตอน replay
ได้ผลเท่าเดิม.

**การแบ่ง:** ไล่ตามลำดับ ใส่ยอดคืนให้แต่ละ lot (และกลุ่มระบุ lot ไม่ได้) ไม่เกินยอดจ่ายออกของ lot นั้น จนครบยอดที่คลังนับได้.

**ตัวอย่าง:** จ่ายนม lot A (หมดอายุ 28 ต.ค.) 6 กล่อง, lot B (หมดอายุ 31 ธ.ค.) 4 กล่อง และ top-up ไม่ระบุ lot 2 กล่อง

| คลังนับได้ | lot A | lot B | ระบุ lot ไม่ได้ (`receive` lot ใหม่) |
| --- | --- | --- | --- |
| 3 | 3 | 0 (ไม่เขียนแถว) | 0 (ไม่เขียนแถว) |
| 8 | 6 | 2 | 0 (ไม่เขียนแถว) |
| 11 | 6 | 4 | 1 |

### 3. `reason` → `ref_id` (schema.md §2.1)

| `reason` | ก่อน | หลัง |
| --- | --- | --- |
| `distribution_return` | `distribution_batch:{request_ulid}` | `distribution_batch:{request_ulid}` (legacy) หรือ `requisition_ticket:{ulid}` (ไม่รวม `requisition_ticket:direct-…`) |
| `receive` | `meal_service:`, `requisition_ticket:`, `distribution_log:`, `bulk_return_pool:` | ไม่เปลี่ยนค่าที่ยอมรับ (แถว `receive` ของตั๋วเก่ายังอ่าน/replay ได้) — คำอธิบาย "ของเหลือคืนคลัง" จำกัดเหลือเฉพาะยอดที่ระบุ lot ต้นทางไม่ได้ (§1.1) |

### 4. Role gate ของ `distribution_return` (VDU)

| `ref_id` | ก่อน | หลัง |
| --- | --- | --- |
| `distribution_batch:` | warehouse_staff, system_admin | ไม่เปลี่ยน |
| `requisition_ticket:` | (ไม่ยอมรับ) | warehouse_staff, supply_coordinator, shelter_manager, system_admin — ตรงกับ `canReceiveWarehouseReturns` |

### 5. ข้อยกเว้นจาก CR-190

กติกา CR-190 "ยอดที่เพิ่มเป็นล็อตใหม่เสมอ (`lot_ref = _id`)" ใช้กับ `adjust` บวก และแถวรับเข้าใหม่. **`distribution_return`
เป็นข้อยกเว้น:** `qty` บวกแต่ต้องอ้าง `lot_ref` ของ lot ที่มีอยู่แล้ว (factory บังคับอยู่แล้วที่ `operations.ts`
`d.reason !== 'distribution_return'`).

### 6. หน้า ledger

| | ก่อน | หลัง |
| --- | --- | --- |
| `LEDGER_GROUP_BY_REASON.distribution_return` | `'out'` | `'in'` |
| ของคืนจากตั๋วบนหน้า ledger | กลุ่ม "รับเข้า" (เป็นแถว `receive`) | กลุ่ม "รับเข้า" (เป็นแถว `distribution_return`, ป้าย "รับคืนจากการแจกจ่าย") |

กลุ่มมีผลกับป้ายบนการ์ด, ตัวกรองประเภท และการ์ดสรุปรายวัน (`ledger-view.ts`). ถ้าไม่ย้าย ของคืนจากตั๋วที่ `qty` บวกจะไปอยู่ใน
"จ่ายออก". การย้ายมีผลกับแถว `distribution_batch` รุ่นเดิมด้วย ซึ่งก็เป็นของรับคืนที่ `qty` บวกเหมือนกัน.

---

## Requirements

### Workflow (`receiveWarehouseReturns`) — คำนวณและเขียน

- **FR-RTN-01** — ระบบต้องอ่านแถว `stock_ledger` `reason: 'distribute'` ทุกแถวที่ `ref_id` = ตั๋ว แล้วคำนวณยอดจ่ายออกต่อ (ชนิด, `lot_ref`) ตาม §2
- **FR-RTN-02** — ระบบต้องหา lot ต้นทางและ metadata จากแถวต้นทางของ lot ตาม §2 (ไม่ใช้ `brokenItemIds` ของ `projectLotsByItem` ตัดสิน);
  `lot_ref` ที่ไม่มีแถวต้นทาง, แถวต้นทางที่ `item_id` / `unit` ไม่ตรงกับชนิดที่คืน และแถว `distribute` ที่ไม่มี `lot_ref` เข้ากลุ่มระบุ lot ไม่ได้
  (§1.1) — ห้าม throw เพราะเหตุนี้ และห้ามเขียน `distribution_return` อ้าง lot ของชนิดอื่น
- **FR-RTN-03** — ระบบต้องแบ่งยอดที่คลังนับได้ของแต่ละชนิดไปตาม lot และกลุ่มระบุ lot ไม่ได้ ตามกติกา §2
- **FR-RTN-04** — เพิ่มจาก guard เดิม (ยอดนับได้ ≤ `allocated_qty − distributed_qty`): ถ้ายอดที่นับได้ของชนิดใด > ผลรวมยอดจ่ายออก
  ทุกกลุ่ม (ระบุ lot ได้ + ไม่ได้) ของชนิดนั้น ระบบต้อง throw `StockIntegrityError` และไม่เขียน ledger ใดของตั๋วนั้น
- **FR-RTN-05** — ระบบต้องเขียน `distribution_return` 1 แถวต่อ (ชนิด, lot ที่ระบุได้) ที่ยอดแบ่ง > 0 ตามรูปแบบ §1 และ `receive`
  ไม่เกิน 1 แถวต่อชนิดเมื่อยอดของกลุ่มระบุ lot ไม่ได้ > 0 ตาม §1.1; ไม่เขียนแถวที่ยอด 0
- **FR-RTN-06** — แถว `distribution_return` ต้องไม่ส่ง `lot`; แถว `receive` ของ §1.1 ส่ง `lot: { note: 'distribution_return' }` แบบเดิม
- **FR-RTN-07** — `_id`: แถวแรกของชนิดตามลำดับ §2 = `deriveDeterministicLedgerId('warehouse_return', ticket._id, item_id)`;
  `distribution_return` แถวอื่น = `(…, item_id, lot_ref)`; `receive` ของ §1.1 ที่ไม่ใช่แถวแรก = `(…, item_id, 'unresolved_lot')`
- **FR-RTN-08** — ส่วนอื่นของ workflow คงเดิม: `discrepancy_qty` (AC-DST-06.2) และสถานะ `RETURN_COMPLETED` (AC-DST-06.3)

### Workflow — replay / retry (idempotency)

ให้ **E** = ชุดแถวที่คาดไว้ของชนิดหนึ่งจาก FR-RTN-01..07 (`_id`, `reason`, `lot_ref`, `qty`) และ **X** = แถวที่มีอยู่แล้วที่
`ref_id` = ตั๋ว, `item_id` = ชนิดนั้น และ `reason` ∈ {`receive`, `distribution_return`}.

- **FR-RTN-09** — **ชนิดแบบเดิม:** X ไม่ว่าง, ทุกแถวเป็น `receive` และไม่มีแถว id `(…, item_id, 'unresolved_lot')` → ตรวจด้วยกฎเดิมทั้งหมด
  (1 แถวต่อชนิด, `qty` = ยอดที่นับได้, `lot.note` = `distribution_return`, id แบบเดิม) และไม่เขียนแถวใหม่ให้ชนิดนั้น
- **FR-RTN-10** — **ชนิดแบบใหม่** (กรณีอื่นทั้งหมด): ทุกแถวใน X ต้องมีใน E ที่ `_id` เดียวกัน และตรงกันทั้ง `reason`, `ref_id`, `item_id`,
  `unit`, `lot_ref`, `qty` (และ `lot.note` ของแถว `receive`); แถวไม่ตรงหรือแถวที่ไม่อยู่ใน E → throw `StockIntegrityError`.
  ชนิดเดียวที่มีทั้ง `receive` แบบเดิมและ `distribution_return` จึง throw (id แรกชนกันแต่ `reason` ต่างกัน)
- **FR-RTN-11** — ตั๋วที่ยังไม่ `RETURN_COMPLETED`: เขียนแถวใน E ที่ยังไม่มีใน X ตามลำดับ §2 (แถวแรกก่อนเสมอ) ด้วย put แบบ
  return-existing on conflict แล้วตรวจตาม FR-RTN-10; แถวที่มีครบแล้วไม่เขียนซ้ำ
- **FR-RTN-12** — ตั๋วที่ `RETURN_COMPLETED` แล้ว (completed replay): X ต้องเท่ากับ E ทุกแถว; ขาดแถวใด → throw `StockIntegrityError`;
  ไม่เขียนแถวใหม่
- **FR-RTN-13** — ชนิดที่ยอดนับได้ = 0: E ว่าง และ X ต้องว่าง ไม่งั้น throw `StockIntegrityError`
- **FR-RTN-14** — แยกฟังก์ชันตรวจ replay: ชุดเดิม (`assertWarehouseReturnLedgerSemantics`, `reason: 'receive'`) ใช้กับ FR-RTN-09 และแถว
  `receive` ของ §1.1; ชุดใหม่สำหรับ `distribution_return` (ตรวจ `reason`, `lot_ref`, `qty`, `_id` และไม่มี `lot`) ใช้กับ FR-RTN-10..12
- **FR-RTN-15** — ถ้า `shelf_life_days` ของชนิดถูกแก้ระหว่างที่เขียนไปได้บางแถวกับตอน retry จนลำดับ lot เปลี่ยน E จะไม่ตรงกับ X →
  FR-RTN-10 throw (fail closed); ห้ามเขียนแถวเพิ่มเพื่อชดเชย. แก้ยอดด้วย `adjust` ตาม CR-190
- **FR-RTN-16** — client รุ่นก่อน CR นี้ที่ retry ตั๋วซึ่งมีแถวแรกแบบใหม่แล้ว ต้องได้ `StockIntegrityError` และไม่เกิดแถว `receive` เพิ่ม
  (§1.2); ห้ามเปลี่ยน id ของแถวแรกเป็นรูปแบบอื่น

### Domain (`operations.ts`)

- **FR-RTN-17** — `distribution_return` ต้องรับ `ref_id` ทั้ง `distribution_batch:` และ `requisition_ticket:` ในทุกจุดที่ตรวจ `ref_id` ของ reason นี้:
  - `REF_PREFIX_BY_REASON.distribution_return`
  - `distributionReturnInputSchema.ref_id` (ปัจจุบัน regex `^distribution_batch:.+` — input ของ `createDistributionReturnEntry` ที่ export ผ่าน barrel)
- **FR-RTN-18** — `createStockLedger` ต้องปฏิเสธ `distribution_return` ที่ `ref_id` ขึ้นต้น `requisition_ticket:direct-`

### VDU (`shelter-access-design.ts`)

- **FR-RTN-19** — VDU ต้องรับ `distribution_return` ที่ `ref_id` ตรง `^requisition_ticket:.+` และไม่ใช่ `^requisition_ticket:direct-`
- **FR-RTN-20** — `distribution_return` ที่ `ref_id` = `requisition_ticket:` ต้องเขียนได้โดย warehouse_staff, supply_coordinator, shelter_manager, system_admin และถูกปฏิเสธจาก role อื่น (รวม distribution_staff)
- **FR-RTN-21** — `distribution_return` ที่ `ref_id` = `distribution_batch:` คงสิทธิ์เดิม (warehouse_staff, system_admin)
- **FR-RTN-22** — กฎเดิมของ `distribution_return` คงไว้: ต้องมี `lot_ref` ตรง `^stock_ledger:.+` และ `qty` เป็น decimal string บวก

### UI (`ledger-view.ts`)

- **FR-RTN-23** — `LEDGER_GROUP_BY_REASON.distribution_return` = `'in'`
- **FR-RTN-24** — ตัด special-case `entry.reason !== 'distribution_return'` ใน `toLedgerRow` (`isOut`) ออก เพราะ `distribution_return` ไม่อยู่ในกลุ่ม `out` แล้ว;
  พฤติกรรมของแถว `distribute` / `requisition` คงเดิม

---

## Acceptance

- [x] CR ได้รับการ approve (stable core — ผ่าน review VDU) รวมข้อที่ตีความเพิ่มจาก #888 ใน Decision log
- [ ] ตรวจรับของเหลือคืนแล้ว ledger ใหม่เป็น `distribution_return` ที่ `lot_ref` ชี้ lot ต้นทาง; จำนวน lot ใน `projectStockLotBalances` ไม่เพิ่ม
      (ยกเว้นยอดที่ระบุ lot ไม่ได้)
- [ ] test ตัวอย่างนม: นับได้ 3 → A 3 แถวเดียว · นับได้ 8 → A 6 + B 2 · นับได้ 11 (มี top-up 2) → A 6 + B 4 + `receive` 1 ·
      ยอดต่อ lot ≤ ยอดจ่ายออก และรวม = ยอดที่นับได้
- [ ] test ลำดับ: lot ที่มี `expiry` มาก่อน lot ที่ไม่ทราบวันหมดอายุ · lot ที่ใช้ `shelf_life_days` เทียบกับ `expiry` ตามเวลาสัมบูรณ์ ·
      ไม่ทราบทั้งคู่เรียง `received_at` → `lot_ref` · กลุ่มระบุ lot ไม่ได้อยู่ท้ายสุด · ผลการแบ่งเท่าเดิมเมื่อเรียกด้วย `now` ต่างกัน
- [ ] lot ที่รับคืนยังมี `expiry`, `produced_at`, `storage_point_id`/`storage_zone`, `lot_no` เดิม; probe กรณี A และ B ให้ผล
      ตาม lot เดิม (`isUrgent`, `isLotExpired`, `earliestExpiry` มีป้ายบนตารางสต็อก)
- [ ] ตั๋วที่มี top-up แบบไม่ระบุ lot (`lot_ref = stock_ledger:{amendmentId}`) ตรวจรับคืนได้และถึง `RETURN_COMPLETED`; ชนิดที่ projection
      พังจากตั๋วอื่นไม่บล็อกการตรวจรับ · แถว `distribute` ที่อ้าง lot ของชนิดอื่นนับเป็นกลุ่มระบุ lot ไม่ได้ (ไม่เขียน `distribution_return`
      ข้ามชนิด) · ยอดที่นับได้เกินยอดจ่ายออกรวม → `StockIntegrityError` และไม่มีแถว ledger ถูกเขียน
- [ ] replay: กดตรวจรับซ้ำไม่เกิดแถวซ้ำ · เขียนไปได้บางแถวแล้ว retry → เขียนเฉพาะแถวที่ขาดและได้ชุดเท่า E · แถวที่มีแต่ `qty`/`lot_ref`
      ไม่ตรง หรือมีแถวเกิน → `StockIntegrityError` · ชนิดเดียวมีทั้ง `receive` แบบเดิมและ `distribution_return` → `StockIntegrityError` ·
      completed replay ที่ขาดแถว → `StockIntegrityError`
- [ ] client รุ่นเก่า (ตรรกะ `receiveWarehouseReturns` ก่อน CR นี้) retry ตั๋วที่มีแถวแรกแบบใหม่แล้ว → `StockIntegrityError` และไม่มีแถว `receive` เพิ่ม
- [ ] ตั๋วเก่าที่มีแถว `receive` แบบเดิม replay ได้ (ทั้งก่อนและหลัง `RETURN_COMPLETED`) และไม่เกิดแถว `distribution_return` เพิ่ม
- [ ] VDU: warehouse_staff / supply_coordinator / shelter_manager / system_admin เขียน `distribution_return` อ้าง
      `requisition_ticket:` ได้ · role อื่นถูกปฏิเสธ · `requisition_ticket:direct-` ถูกปฏิเสธ · `distribution_batch:` สิทธิ์เดิม
- [ ] หน้า ledger: แถว `distribution_return` อยู่กลุ่ม "รับเข้า" ทั้งป้าย ตัวกรอง และการ์ดสรุปรายวัน (`ledger-view.test.ts`)
- [ ] unit test `receiveWarehouseReturns` ตรวจ `reason`, `lot_ref`, `qty` ต่อ lot, `_id`, การไม่ส่ง `lot`; test VDU ครอบคลุม FR-RTN-19..22
- [ ] schema.md §2.1 และ CR-121 AC-DST-06.1 อัปเดตตรงกับโค้ด พร้อม `updated:`

---

## Impact

### Spec (แก้หลัง approve)

| เอกสาร | ส่วน | การแก้ |
| --- | --- | --- |
| `docs/data/schema.md` §2.1 | field `reason` (คำอธิบาย enum) | "`distribution_return` = คืนของที่เหลือจาก batch กลับ physical lot เดิม" → คืนของเหลือจาก batch (legacy) หรือตั๋ว `requisition_ticket` กลับ physical lot เดิม |
| `docs/data/schema.md` §2.1 | field `lot_ref` | ตัดวงเล็บ "เว้นแต่การรับของแจกเหลือคืนคลัง `reason='receive'` ที่แนะนำให้อ้างอิง `lot_ref` เดิม…" → ระบุว่า `distribution_return` จากตั๋วอ้าง `lot_ref` ของ lot ต้นทาง (ข้อยกเว้นของแถวบวก) |
| `docs/data/schema.md` §2.1 | field `lot.note` | "บันทึก `distribution_return` เมื่อรับของเหลือจากตั๋วแจก (CR-121)" → จำกัดเหลือแถว `receive` ของยอดที่ระบุ lot ต้นทางไม่ได้ (§1.1); คงค่า system `distribution_return` ในกฎแสดงสถานที่ |
| `docs/data/schema.md` §2.1 | ตาราง `reason` → `ref_id` | ตาม Change §3 |
| `docs/data/schema.md` §2.1 | ขอบเขตการบังคับ / Migration | เพิ่ม note ไม่ bump `schema_v` ตาม Migration ด้านล่าง; อ้างกติกาแบ่งยอด §2 ของ CR นี้ |
| `docs/data/schema.md` §2.1 | ลำดับการเลือกล็อตเพื่อเบิก (CR-143 §A) | ขอบเขต "ใช้ทั้งระบบ (หน้าคลัง + distribution dispatch / return / reconciliation)" → ตัด "return / reconciliation" ของตั๋วออก แล้วเพิ่มข้อยกเว้น: การแบ่งยอดของเหลือคืนจากตั๋วใช้ลำดับ §2 ของ CR นี้ (เวลาสัมบูรณ์, ไม่ใช้ HORIZON / `score`) |
| CR-121 | AC-DST-06.1 | แทนด้วย: บันทึก `stock_ledger` `reason: 'distribution_return'`, `ref_id: ticket._id`, `lot_ref` = lot ต้นทาง 1 แถวต่อ (ชนิด, lot) ตามกติกาแบ่งยอดของ CR นี้; ยอดที่ระบุ lot ไม่ได้ลง `receive` lot ใหม่ (ห้ามมีฟิลด์ `notes` ระดับบน — คงเดิม) |
| CR-190 | Change / TL;DR | บันทึกข้อยกเว้น `distribution_return` ตาม Change §5 |

ตามนโยบาย CR เดิมเป็น read-only ระหว่างร่าง — การแก้ CR-121 และ CR-190 บันทึกไว้ที่ draft นี้ และลงมือแก้เมื่อ CR นี้ approve.

### Code / test

| Path | การแก้ |
| --- | --- |
| `features/distribution/application/food-supplies/reconciliation-workflow.ts` | FR-RTN-01..16 — แทนตรรกะ replay เดิมที่ throw `Multiple warehouse return ledger rows exist for ticket item` เมื่อ > 1 แถวต่อชนิด; แยก `assertWarehouseReturnLedgerSemantics` (เดิม) กับตัวตรวจ `distribution_return` (ใหม่) |
| `features/operations/domain/operations.ts` | FR-RTN-17..18 |
| `server/shelter-access-design.ts` | FR-RTN-19..22 |
| `features/operations/ui/ledger/ledger-view.ts` | FR-RTN-23..24 |
| `…/food-supplies/reconciliation-workflow.test.ts`, `ledger-replay.test.ts` | test แบ่งยอด, ลำดับ lot, ยอดที่ระบุ lot ไม่ได้ (top-up), idempotent, partial write retry, client เก่า retry, replay ตั๋วเก่า |
| `server/shelter-access-design.test.ts` | test role/ref ของ `distribution_return` |
| `features/operations/ui/ledger/ledger-view.test.ts` | กลุ่ม `in` ของ `distribution_return` |
| `features/operations/domain` tests | `REF_PREFIX_BY_REASON` / `createStockLedger` / `createDistributionReturnEntry` รับ `requisition_ticket:` และปฏิเสธ `direct-` |

UI ตรวจรับ (`features/distribution/ui/model/warehouse-return.ts`) ไม่เปลี่ยน — คลังยังนับยอดต่อชนิด.

---

## Migration

- **ไม่ bump `schema_v`** (stock_ledger คง 6): ไม่เพิ่ม/ลบ/เปลี่ยนชนิด field; ขยายค่า `ref_id` ที่ยอมรับของ `distribution_return`
- **ไม่ backfill:** ledger เป็น append-only; แถว `receive` + `lot.note: 'distribution_return'` เดิมอ่านได้ปกติเป็น lot แยก
  (คงข้อมูลเสียของแถวเดิม). ถ้าต้องแก้ยอดของ lot เดิมให้ใช้ `adjust` ตามกติกา T-11 / CR-190
- **Rollout:** redeploy VDU (`pnpm redeploy:access --write --confirm`) **ก่อน** deploy client — client ใหม่ที่เขียน
  `distribution_return` อ้าง `requisition_ticket:` จะถูก VDU เดิมปฏิเสธ
- **client รุ่นเก่าที่ยังค้าง (PWA):** retry ตั๋วที่ client ใหม่เขียนไปแล้วจะชน id แถวแรกและ fail closed (§1.2, FR-RTN-16) — ไม่ลง stock ซ้ำ;
  ผู้ใช้ต้องรีเฟรชเป็นรุ่นใหม่แล้วกดตรวจรับอีกครั้ง
- ระหว่าง rollout: ชนิดที่ตรวจรับด้วยรูปแบบเดิมไปแล้ว replay ตาม FR-RTN-09; ชนิดที่ยังไม่มีแถวใช้รูปแบบใหม่ (ตั๋วเดียวมีทั้งสองแบบต่างชนิดกันได้)

---

## Decision log

- 2026-10-25 — #888 เปิดโดย Fishcanwalk (`📋 change request`, `priority:high`, milestone Phase 3)
- 2026-10-25 — kong เลือกทางแก้: เขียน `distribution_return` คืนเข้า lot เดิม (แบบเดียวกับ flow `distribution_batch`
  ใน `distribution.remote.ts`). ทางที่ไม่เลือก:
  - คงเป็น lot ใหม่แต่คัดลอก metadata จาก lot ต้นทาง — แก้น้อยกว่า แต่ lot เพิ่มขึ้นเรื่อย ๆ, `received_at` เริ่มนับใหม่, สืบย้อนกลับไป lot เดิมไม่ได้
  - เขียน `receive` พร้อม `lot_ref` เดิม — `receive` มีสองความหมาย และซ้ำกับ `distribution_return`
- 2026-10-25 — kong เลือกกติกาแบ่งยอด: หมดอายุเร็วสุดก่อน (`lot.expiry` → `produced_at` + `shelf_life_days` → `received_at` → `lot_ref`).
  เหตุผล: ถ้าเดาผิด ผลเสียคือเตือนใกล้หมดอายุเร็วกว่าความจริง ไม่มีทางที่ของหมดอายุหลุดไปแจกโดยไม่มีป้าย. ทางที่ไม่เลือก:
  - หมดอายุช้าสุดก่อน — ถ้าเจ้าหน้าที่หยิบสลับลำดับ ของใกล้หมดอายุจะถูกบันทึกเป็นวันหมดอายุที่ไกลกว่าจริง
  - ให้คลังนับแยกตาม lot ตอนตรวจรับ — แม่นกว่า แต่ต้องแก้ UI ตรวจรับ และต้องมีเลข lot / วันหมดอายุบนของ
- 2026-10-28 — proposed (Dev Team B)
- 2026-10-28 — **ตีความ / เพิ่มจาก #888 โดย Dev Team B** (เคาะทุกข้อด้านล่าง 2026-10-28):
  1. lot ที่ไม่ทราบวันหมดอายุอยู่หลัง lot ที่ทราบ และไม่ใช้ HORIZON (#888 เขียน "วิธีเดียวกับ `scoreLot`" ซึ่งใช้ HORIZON) —
     เหตุผล: HORIZON ขึ้นกับ `now` ทำให้ replay ได้ผลต่างกัน และไม่ใช่ข้อมูลจริงของ lot (CR-143 FR-A3a); ตรงกับ `compareLotConsumptionOrder` เดิมที่ไม่มี expiry ไปท้าย
  2. ยอดที่ระบุ lot ต้นทางไม่ได้ลง `receive` lot ใหม่ (§1.1) แทน fail closed — เหตุผล: top-up ไม่ส่ง `lot_ref` ทำให้ projection ของชนิดพังถาวร
     ถ้า fail closed ตั๋วที่มี top-up จะค้าง `RETURN_PENDING_RECEIPT` ทั้งที่ตอนนี้ตรวจรับได้. ทางที่ไม่เลือก: บังคับแก้ `amendActiveTicket` ก่อน — แถวเดิมที่เสียแล้วยังต้องมีทางออกอยู่ดี
  3. แถวแรกใช้ id เดิม (§1.2) — กัน PWA รุ่นเก่าลง stock ซ้ำระหว่าง rollout (แบบเดียวกับ `planItemDispatchRows`)
  4. ปฏิเสธ `distribution_return` อ้าง `requisition_ticket:direct-` (FR-RTN-18/19) — เบิกตรงจากหน้าคลังไม่มีขั้นรับคืน
  5. ย้าย `distribution_return` ไปกลุ่ม `in` บนหน้า ledger (§6) — กระทบแถว `distribution_batch` เดิมด้วย
  6. แก้ขอบเขต CR-143 §A ใน schema.md ให้การรับคืนจากตั๋วใช้ลำดับ §2 แทน `rankLotsForIssue`
  7. VDU คงสิทธิ์ `distribution_return` อ้าง `distribution_batch:` ไว้ที่ warehouse_staff / system_admin (#888 ให้ "ปรับสิทธิ์ให้ตรงกับ `auth.ts`") —
     เปิดเพิ่มเฉพาะ `requisition_ticket:` ซึ่งเป็น flow ที่ #888 แก้ เพื่อไม่ขยายสิทธิ์ของ flow `distribution_batch` เดิมโดยไม่จำเป็น
- 2026-10-28 — **approved (kong)** — เคาะข้อตีความด้านบน:
  - ข้อ 1, 2 — ตามที่เสนอ
  - ข้อ 3 — คง id เดิมของแถวแรก (ระบบยังไม่ใช้งานจริง ผลกับ client รุ่นเก่าจำกัดที่เครื่อง dev/test)
  - ข้อ 4 — ตามที่เสนอ (เบิกตรงจากหน้าคลังไม่มีขั้นรับคืน)
  - ข้อ 5 — ตามที่เสนอ (ของคืนแสดงในกลุ่ม "รับเข้า")
  - ข้อ 6 — ตามที่เสนอ (อนุมัติพร้อม CR ทั้งฉบับ)
  - ข้อ 7 — คงสิทธิ์ `distribution_batch:` ไว้ที่ warehouse_staff / system_admin
- 2026-10-28 — FR-RTN-17 ขยายให้ครอบ `distributionReturnInputSchema` (`createDistributionReturnEntry`) ด้วย — จาก PR review #993; ไม่เปลี่ยนพฤติกรรมที่ approve (kong)
- 2026-10-28 — stable-core review ส่วน VDU (`_design/access` role gate + `ref_id` ของ `distribution_return`, FR-RTN-19..22) โดย kong ใน PR #993 — review บน GitHub ที่ลงไว้เป็น comment "Deleted" เป็นการลงผิด ไม่ใช่ผล review

## Out of scope

- คืนของยืมที่โต๊ะ (`returnLoanAtCounter`) และกองรับคืน (`receiveBulkReturnPool`) ยังเปิด lot ใหม่ — ของมาจากหลายคนหลาย lot ที่แยกไม่ได้
- แก้ `amendActiveTicket` ที่ตั้ง `lot_ref = stock_ledger:${amendmentId}` เมื่อไม่ระบุ lot — แยก issue; CR นี้รองรับแถวแบบนี้ด้วย §1.1
  (ยอดส่วนนั้นเปิด lot ใหม่แบบเดิม)
- แก้ข้อมูลของแถว `receive` เดิมที่เปิด lot ใหม่ไปแล้ว
