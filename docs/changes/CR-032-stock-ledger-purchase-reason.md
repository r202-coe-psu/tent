---
id: CR-032
title: "Add purchase doc type + purchase reason to stock_ledger"
status: proposed
date: 2026-07-05
updated: 2026-07-15
requested_by: development team C
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §2.16 (doc type ใหม่), §2.1 (reason enum + นิยาม `ref_id`)
  - schema_v purchase 1 (ใหม่) · stock_ledger 2 → 3
  - frontend/src/lib/features/operations/domain/operations.ts
  - frontend/src/lib/features/operations/data/operations.remote.ts
  - frontend/src/lib/features/operations/ui/ReceiveStockForm.svelte
---

# CR-032 — Add purchase doc type + purchase reason to stock_ledger

> [!NOTE]
> **สรุป (TL;DR):** เพิ่ม doc type `purchase` (`purchase:{ulid}`) **และ** ค่า `purchase` ใน `stock_ledger.reason` enum เพื่อรองรับการรับสต็อกจากแหล่ง "จัดซื้อจัดจ้าง" แยกจากเงินบริจาค · ledger ของจัดซื้อเขียน `reason: 'purchase'` + `ref_id: 'purchase:{ulid}'` **ตาม pattern เดียวกับ donation** · schema_v stock_ledger 2→3, purchase 1 · **ยังไม่ merge เข้าโค้ด — รอ sign-off จริงจาก @net-lynx**

## Why

Task T-11 (Stock receive + ledger write) ต้องรองรับการรับสต็อกจากแหล่ง "จัดซื้อจัดจ้าง" (purchase) เพิ่มจากเดิมที่มีแค่บริจาคและโอนย้าย และ T-14 (dashboard/BI) ต้องแยกยอดสองแหล่งนี้ออกจากกัน

`stock_ledger` ไม่มี field `source` — `createReceiveEntry` รับ `source` เป็น input แล้ว map ลงเป็น `reason` ก่อนทิ้ง และเพราะ ledger เป็น append-only ถ้าข้อมูลที่มาหายตอนเขียน จะย้อนไป backfill ไม่ได้

ระบบมี pattern สำหรับเรื่องนี้อยู่แล้วที่ `donation` — **ใช้ทั้ง `reason` และ `ref_id` คู่กัน คนละหน้าที่**:

- **`reason` บอก "ประเภท"** — req, มี index `(reason)`, ทำให้แถว ledger อ่านแล้วรู้เรื่องในตัวเอง
- **`ref_id` บอก "ใบไหน"** — ชี้กลับไปที่ doc ต้นเหตุเพื่อดึงรายละเอียด (`operations.remote.ts:407` → `ref_id: donation._id`)

โค้ดจริงอ่านทั้งคู่พร้อมกัน: `operations.ts:467` → `if (ledger.reason === 'donation' && ledger.ref_id)`

`purchase` จึงต้องมีครบทั้งสองอย่างเหมือนกัน: **enum value** เพื่อแยกประเภทผ่าน index ที่มีอยู่แล้ว และ **doc type** เพื่อเก็บผู้ขาย/เลขใบสั่งซื้อที่ enum value เก็บให้ไม่ได้ ปัจจุบัน `purchase` เป็นแหล่งเดียวที่ขาดทั้งคู่

## Change

1. เพิ่ม doc type `purchase` — `purchase:{ulid}` · `schema_v 1` · วางที่ `docs/data/schema.md` §2.16 (ต่อท้าย เลี่ยงการ renumber §2.x เดิม)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `vendor` | str | req | ชื่อผู้ขาย / หน่วยงานที่จัดหา |
| `po_ref` | str | opt | เลขใบสั่งซื้อ / สัญญา (อ้างระบบภายนอก) |
| `items` | [{`item_id`:str, `qty`:qty_str>0, `unit`:str}] | req | ≥1 รายการ — **planning signal เท่านั้น** ยอดจริงมาจาก `stock_ledger` (mirror `donation.items`, data-model.md §4) |
| `occurred_at` | ts | req | วันที่รับของเข้าศูนย์ |
| `note` | str | opt | — |

2. เพิ่ม `purchase` เข้าไปในค่า `reason` ที่อนุญาตของ `stock_ledger` (7 → 8 ค่า)
3. Bump `schema_v` ของ `stock_ledger` จาก `2` เป็น `3`
4. เมื่อรับสต็อกด้วย source `purchase`: สร้าง `purchase` doc ก่อน แล้วเขียน `stock_ledger` ที่ `reason: 'purchase'` + `ref_id` = `_id` ของ purchase doc นั้น (mirror `keyDonationReceipt`)
5. `receiveSourceSchema` เพิ่มค่า `purchase` → map ตรงไปยัง reason `purchase`

แยกที่มาได้ครบทุกแหล่ง โดยทุกแหล่งใช้ pattern เดียวกัน:

| แหล่ง | `reason` | `ref_id` |
| --- | --- | --- |
| บริจาค | `donation` | `donation:{ulid}` |
| โอนระหว่างศูนย์ | `transfer_in` / `transfer_out` | `stock_transfer:{ulid}` |
| เบิกครัว | `requisition` | `kitchen_requisition:{ulid}` |
| **จัดซื้อ** | **`purchase`** | **`purchase:{ulid}`** |
| ปรับสต็อกมือ | `adjust` | `null` |

### Alternatives considered

- **เพิ่ม `purchase` เข้า enum อย่างเดียว ไม่มี doc type** (แนวทางเดิมของ CR นี้ ถึง 2026-07-15): แยกประเภทได้ แต่ `ref_id` ต้องเป็น `null` เพราะไม่มี doc ให้ชี้ → เก็บผู้ขาย/เลข PO ไม่ได้เลย และ `purchase` จะเป็น reason เดียวที่มี `ref_id` เป็น null ทั้งที่ไม่ใช่การปรับมือ
- **เพิ่ม doc type อย่างเดียว แล้วใช้ `reason: 'receive'` + `ref_id`** (พิจารณา 2026-07-15): ไม่ต้อง bump `schema_v` แต่ (ก) `ref_id` เป็น `string | null` ส่วน `reason` เป็น req — เท่ากับฝากมิติ "ที่มา" ไว้ในฟิลด์ที่เป็น null ได้ (ข) ต้องเพิ่ม index `(ref_id)` + query แบบ prefix match ทั้งที่ index `(reason)` มีอยู่แล้วและเทียบ equality ตรง ๆ (ค) แถว ledger ไม่บอกตัวเอง ต้องเปิด ref_id ถึงรู้ว่าคือจัดซื้อ (ง) เสียสมมาตรกับ donation/transfer_in ที่มี reason ของตัวเอง
- **Map ไปที่ `receive` แทน**: ตอนแรก map `purchase` ไปที่ `receive` แต่จะทำให้เสียข้อมูลเชิงประวัติ ทำให้ dashboard/BI (T-14) แยกไม่ออกระหว่างเงินบริจาคกับการจัดซื้อ และแยกจากการปรับสต็อกมือไม่ออกด้วย เพราะ `ref_id` เป็น null ทั้งคู่
- **เพิ่ม field `source` ใน `stock_ledger`**: แยกสองแกนออกจากกันได้จริง แต่ซ้ำซ้อนกับ `ref_id` ที่ทำหน้าที่ชี้ต้นเหตุอยู่แล้ว และต้อง bump `schema_v` เหมือนกัน
- **เก็บราคา / มูลค่าใน purchase doc**: ตัดออก — CR-038 ระบุว่าระบบไม่เก็บเงิน (ไม่แตะ `amount_thb`) **ถ้า `vendor` + `po_ref` ไม่จำเป็นจริง doc type ก็ไม่คุ้ม — ให้ลดเหลือแค่ข้อ 2–3 (enum + schema_v) แล้วตัดข้อ 1 ทิ้ง**
- **ใส่ state machine (`ordered` → `received`)**: ตัดออกจาก scope — ข้อเสนอนี้เป็น record ย้อนหลัง (บันทึกเมื่อของถึงศูนย์) ถ้าต้องติดตาม "สั่งแล้วรอของ" ต้องเพิ่ม `status` + timeline ซึ่งขยาย scope ขึ้นมาก

## Impact

- **Data Model:** `docs/data/schema.md` §2.16 doc type `purchase` ใหม่ (`schema_v 1`); §2.1 `stock_ledger` `schema_v` 2→3 พร้อม reason ใหม่ + ขยายนิยาม `ref_id` ให้ครอบ `purchase` — index เดิม `(reason)` ครอบคลุมแล้ว **ไม่ต้องเพิ่ม index ใหม่**
- **Domain Layer:** เพิ่ม `purchaseSchema` / `createPurchase` / `isPurchase`; `ledgerReasonSchema` เพิ่ม `purchase`; `receiveSourceSchema` และ `createReceiveEntry` ต้องรองรับ `purchase`; `createStockLedger` ต้อง stamp `schema_v 3`
- **Data Layer:** repo + remote ต้องสร้าง purchase doc แล้วผูก `ref_id` เข้ากับ ledger ในขั้นตอนเดียวกัน (mirror `keyDonationReceipt`)
- **UI Layer:** ตัวเลือกใน `ReceiveStockForm` เพิ่ม "จัดซื้อ / หน่วยงานรัฐ" พร้อมช่อง `vendor` (req) และ `po_ref` (opt)
- **Role/permission:** ยังไม่กำหนดว่าใครสร้าง `purchase` doc ได้ — ต้องระบุก่อน implement (change-management §2)
- **T-13:** ไม่กระทบ — คนละ path (transfer items) ทำคู่ขนานได้
- **นอกขอบเขต:** `reason: 'receive'` ยังเป็นค่ากำพร้า (ไม่มีโค้ด production สร้าง — `source: manual` map ไป `adjust`) CR นี้ไม่แตะ

## Migration

`schema_v` 2→3 ของ `stock_ledger` เป็นการเพิ่ม enum value ใหม่เท่านั้น ไม่มีการเปลี่ยนโครงสร้างฟิลด์ — เอกสารเดิมที่มี `schema_v: 2` ยังอ่าน/ใช้งานได้ปกติ ไม่ต้อง backfill

- `purchase` — doc type ใหม่ ไม่มี doc เดิมให้ migrate
- ledger ที่มีอยู่ก่อน CR นี้ไม่มีของจัดซื้อ (ยังไม่เคยรองรับ) — ไม่มี backfill
- index — ใช้ `(reason)` เดิม ไม่มี index ใหม่ให้ deploy

## Decision log

- 2026-07-05 — proposed; renumbered CR-031 → CR-032 (CR-031 ถูกใช้โดย develop สำหรับ item master schema reconciliation)
- 2026-07-05 — มาร์กเป็น accepted ในโค้ดโดยไม่มีหลักฐาน sign-off จริงจาก @net-lynx
- 2026-07-06 — ตรวจพบว่าไม่มี sign-off จริง; revert สถานะกลับเป็น proposed และถอนโค้ด/schema.md ที่ ship ไปแล้ว (`purchase` reason, `schema_v 2`) ออกจนกว่าจะอนุมัติจริง
- 2026-07-06 — renumbered CR-032 → CR-033 (ชนกับ CR-032 donation-campaign-cutoff-rules)
- 2026-07-15 — แก้ `schema_v` จาก 1→2 เป็น 2→3: CR-038 (done, 2026-07-14) bump `stock_ledger` 1→2 ไปก่อนแล้ว (`qty` เป็น `qty_str`) เลข 1→2 เดิมจึงกลายเป็น no-op
- 2026-07-15 — พิจารณาแนวทาง "doc type อย่างเดียว + `reason: 'receive'`" (ไม่ bump `schema_v`) แล้ว**ตกไป** เพราะ `ref_id` เป็น nullable ส่วน `reason` เป็น req และต้องเพิ่ม index `(ref_id)` ทั้งที่ `(reason)` มีอยู่แล้ว
- 2026-07-15 — **ขยายขอบเขตเป็น doc type + enum value คู่กัน** ตาม pattern ของ `donation` (`reason` = ประเภท, `ref_id` = ใบไหน; ดู `operations.ts:467`) `schema_v` ของ `stock_ledger` จึงกลับมาเป็น 2→3 ตามข้อ 5 ข้างบน · ขอบเขตเดิม (แยกจัดซื้อออกจากบริจาคเพื่อ T-14) ไม่เปลี่ยน · ยัง `proposed` รอ sign-off จริงจาก @net-lynx
