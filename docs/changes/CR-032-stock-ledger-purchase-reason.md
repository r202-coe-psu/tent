---
id: CR-032
title: "Add purchase doc type + purchase reason to stock_ledger"
status: approved
date: 2026-07-05
updated: 2026-07-25
requested_by: development team C
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §2.16 (doc type ใหม่), §2.1 (reason enum + นิยาม `ref_id`)
  - schema_v purchase 1 (ใหม่) · stock_ledger 2 → 3
  - frontend/src/lib/features/operations/domain/operations.ts (Purchase, purchaseInputSchema, createPurchase, keyPurchaseReceipt, isPurchase)
  - frontend/src/lib/features/operations/data/operations.repository.ts (interface + purchase methods)
  - frontend/src/lib/features/operations/data/operations.remote.ts
  - frontend/src/lib/features/operations/application/queries.ts (purchase keys/hooks + live-query branch)
  - frontend/src/lib/features/operations/index.ts (barrel exports)
  - frontend/src/lib/features/kitchen/data/kitchen.remote.ts (stock_ledger schema_v stamp — ripple ของ bump 2→3)
  - UI surface ใหม่ของ purchase (สร้างใบ + key รับเข้า) — ที่วางยังไม่เคาะ (ดู Open items)
  - frontend/scripts/seed.ts (purchase demo 1 ใบ + receipt)
  - (superseded 2026-07-25) frontend/src/lib/features/operations/ui/ReceiveStockForm.svelte — Option A ไม่แตะฟอร์มนี้
---
# CR-032 — Add purchase doc type + purchase reason to stock_ledger

> [!NOTE]
> **สรุป (TL;DR):** เพิ่ม doc type `purchase` (`purchase:{ulid}`) **และ** ค่า `purchase` ใน `stock_ledger.reason` enum เพื่อรองรับการรับสต็อกจากแหล่ง "จัดซื้อจัดจ้าง" แยกจากเงินบริจาค · ledger ของจัดซื้อเขียน `reason: 'purchase'` + `ref_id: 'purchase:{ulid}'` **ตาม pattern เดียวกับ donation** · schema_v stock_ledger 2→3, purchase 1 · **อนุมัติแล้ว 2026-07-24 (@net-lynx sign-off ในแชท — แนว doc type + enum)** · role/permission = เหมือน FR-28 receive (`warehouse_staff` + SA; SM ไม่เขียน ledger ตรงตาม §3) · **design = Option A (donation-style 2 สเต็ป, เคาะ 2026-07-25)**: purchase doc เกิดคนละ action กับตอน key รับเข้า → **ไม่มี cross-doc atomic write** และ purchase **ไม่ใช่** ค่าใน `receiveSourceSchema` · **สถานะ implement: slice 2/3 เสร็จ** (reason enum + `schema_v` 3 · doc type §2.16 · domain + data + application layer พร้อม test) — เหลือ UI surface (รอเคาะ Open items) + `seed.ts`

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

| Field           | ชนิด                                             | req | หมายเหตุ                                                                                                                                       |
| --------------- | ---------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vendor`      | str                                                  | req | ชื่อผู้ขาย / หน่วยงานที่จัดหา                                                                                                |
| `po_ref`      | str                                                  | opt | เลขใบสั่งซื้อ / สัญญา (อ้างระบบภายนอก)                                                                                 |
| `items`       | [{`item_id`:str, `qty`:qty_str>0, `unit`:str}] | req | ≥1 รายการ —**planning signal เท่านั้น** ยอดจริงมาจาก `stock_ledger` (mirror `donation.items`, data-model.md §4) |
| `occurred_at` | ts                                                   | req | วันที่รับของเข้าศูนย์                                                                                                             |
| `note`        | str                                                  | opt | —                                                                                                                                                     |

> **ไม่มี `status`** — CR นี้ตัด state machine (`ordered` → `received`) ออกจาก scope (ดู Alternatives) → คำถาม "รับแล้วหรือยัง" **อนุมานจาก ledger** ที่มี `ref_id = purchase._id` (mirror `calculateReserved` → `keyedDonationIds`) ไม่ใช่จาก field ใน doc

2. เพิ่ม `purchase` เข้าไปในค่า `reason` ที่อนุญาตของ `stock_ledger` (7 → 8 ค่า)
3. Bump `schema_v` ของ `stock_ledger` จาก `2` เป็น `3`
4. **flow 2 สเต็ป — Option A (amended 2026-07-25):** `purchase` doc เกิด **คนละ action** กับการรับของ (เหมือน `donation` ที่ declare ก่อน แล้วค่อย key รับเข้า)
   1. `createPurchase()` → put `purchase` doc ใบเดียว (vendor / po_ref / items เป็น planning signal)
   2. ตอนของถึงศูนย์ `keyPurchaseReceipt(purchase, counted)` → **append** `stock_ledger` `reason: 'purchase'` + `ref_id` = `_id` ของ purchase doc นั้น (mirror `keyDonationReceipt`)

   เพราะ doc commit ไปแล้วตั้งแต่สเต็ป 1 การเขียน ledger จึงเป็น append ล้วน — **ไม่มี cross-doc atomic write** ที่ค้างครึ่งทางได้ (multi-row ใน receipt เดียว = ยอมรับ partial แบบเดียวกับ donation: ถ้าแถวไหนพลาด key ใหม่ได้ purchase doc ยัง valid)
5. ~~`receiveSourceSchema` เพิ่มค่า `purchase` → map ตรงไปยัง reason `purchase`~~
   > ⚠️ **SUPERSEDED 2026-07-25 (Option A)** — `purchase` **ไม่** เป็นค่าใน `receiveSourceSchema` และไม่โผล่ในฟอร์มรับสต็อกสเต็ปเดียว แต่มี flow ของตัวเองตามข้อ 4 · เหตุผล: ฟอร์มรับของปัจจุบันให้ผู้ใช้ **พิมพ์ `ref_id` เอง** (source = donation/transfer) ซึ่งขัดกับ `ref_id` ของ purchase ที่ = `_id` ที่ระบบ mint ให้ — ห้ามพิมพ์

แยกที่มาได้ครบทุกแหล่ง โดยทุกแหล่งใช้ pattern เดียวกัน:

| แหล่ง                     | `reason`                         | `ref_id`                     |
| ------------------------------ | ---------------------------------- | ------------------------------ |
| บริจาค                   | `donation`                       | `donation:{ulid}`            |
| โอนระหว่างศูนย์ | `transfer_in` / `transfer_out` | `stock_transfer:{ulid}`      |
| เบิกครัว               | `requisition`                    | `kitchen_requisition:{ulid}` |
| **จัดซื้อ**       | **`purchase`**             | **`purchase:{ulid}`**  |
| ปรับสต็อกมือ       | `adjust`                         | `null`                       |

### Alternatives considered

- **เพิ่ม `purchase` เข้า enum อย่างเดียว ไม่มี doc type** (แนวทางเดิมของ CR นี้ ถึง 2026-07-15): แยกประเภทได้ แต่ `ref_id` ต้องเป็น `null` เพราะไม่มี doc ให้ชี้ → เก็บผู้ขาย/เลข PO ไม่ได้เลย และ `purchase` จะเป็น reason เดียวที่มี `ref_id` เป็น null ทั้งที่ไม่ใช่การปรับมือ
- **เพิ่ม doc type อย่างเดียว แล้วใช้ `reason: 'receive'` + `ref_id`** (พิจารณา 2026-07-15): ไม่ต้อง bump `schema_v` แต่ (ก) `ref_id` เป็น `string | null` ส่วน `reason` เป็น req — เท่ากับฝากมิติ "ที่มา" ไว้ในฟิลด์ที่เป็น null ได้ (ข) ต้องเพิ่ม index `(ref_id)` + query แบบ prefix match ทั้งที่ index `(reason)` มีอยู่แล้วและเทียบ equality ตรง ๆ (ค) แถว ledger ไม่บอกตัวเอง ต้องเปิด ref_id ถึงรู้ว่าคือจัดซื้อ (ง) เสียสมมาตรกับ donation/transfer_in ที่มี reason ของตัวเอง
- **Map ไปที่ `receive` แทน**: ตอนแรก map `purchase` ไปที่ `receive` แต่จะทำให้เสียข้อมูลเชิงประวัติ ทำให้ dashboard/BI (T-14) แยกไม่ออกระหว่างเงินบริจาคกับการจัดซื้อ และแยกจากการปรับสต็อกมือไม่ออกด้วย เพราะ `ref_id` เป็น null ทั้งคู่
- **เพิ่ม field `source` ใน `stock_ledger`**: แยกสองแกนออกจากกันได้จริง แต่ซ้ำซ้อนกับ `ref_id` ที่ทำหน้าที่ชี้ต้นเหตุอยู่แล้ว และต้อง bump `schema_v` เหมือนกัน
- **เก็บราคา / มูลค่าใน purchase doc**: ตัดออก — CR-038 ระบุว่าระบบไม่เก็บเงิน (ไม่แตะ `amount_thb`) **ถ้า `vendor` + `po_ref` ไม่จำเป็นจริง doc type ก็ไม่คุ้ม — ให้ลดเหลือแค่ข้อ 2–3 (enum + schema_v) แล้วตัดข้อ 1 ทิ้ง**
- **ให้ `purchase` เป็น source ในฟอร์มรับสต็อก "สเต็ปเดียวจบ"** (= ข้อ 5 เดิมของ CR นี้ ถึง 2026-07-25): กด key ครั้งเดียวได้ทั้ง purchase doc + ledger ดูสั้นกว่า แต่ **ตกไป** เพราะ (ก) ต้องเขียน 2 doc ในการกดครั้งเดียวโดยที่ CouchDB **ไม่มี transaction ข้าม doc** → ค้างครึ่งทางได้ (มี doc แต่ไม่มี ledger หรือกลับกัน) และ backfill ไม่ได้เพราะ ledger เป็น append-only (ข) ช่อง `ref_id` ในฟอร์มปัจจุบันเป็น free text ที่ผู้ใช้พิมพ์เอง ขัดกับ `ref_id` ของ purchase ที่ระบบต้อง mint → **เลือก Option A (2 สเต็ปแบบ donation)** ซึ่งทำให้ปัญหาทั้งสองข้อหายไปเอง ไม่ใช่แค่ถูกกัน
- **ใส่ state machine (`ordered` → `received`)**: ตัดออกจาก scope — ข้อเสนอนี้เป็น record ย้อนหลัง (บันทึกเมื่อของถึงศูนย์) ถ้าต้องติดตาม "สั่งแล้วรอของ" ต้องเพิ่ม `status` + timeline ซึ่งขยาย scope ขึ้นมาก

## Impact

- **Data Model:** `docs/data/schema.md` §2.16 doc type `purchase` ใหม่ (`schema_v 1`); §2.1 `stock_ledger` `schema_v` 2→3 พร้อม reason ใหม่ + ขยายนิยาม `ref_id` ให้ครอบ `purchase` — index เดิม `(reason)` ครอบคลุมแล้ว **ไม่ต้องเพิ่ม index ใหม่**
- **Domain Layer:** เพิ่ม `Purchase` / `PurchaseItem` / `purchaseInputSchema` / `createPurchase` / `keyPurchaseReceipt` / `isPurchase` (+ เข้า `OperationsDoc` union และ barrel); `ledgerReasonSchema` เพิ่ม `purchase`; `createStockLedger` ต้อง stamp `schema_v 3` · ~~`receiveSourceSchema` และ `createReceiveEntry` ต้องรองรับ `purchase`~~ ⚠️ **SUPERSEDED 2026-07-25 (Option A)** — ไม่แตะทั้งสองตัว
- **Data Layer:** repository interface + remote impl เพิ่ม `createPurchase` / `listPurchases` / `getPurchase` / `receivePurchase` · **สองสเต็ปแยกกัน** — `createPurchase` put doc ใบเดียว; `receivePurchase` append ledger rows ที่ชี้ `ref_id` กลับไปหา doc ที่ commit แล้ว (mirror `keyDonationReceipt`; multi-row เขียนแบบ `bulkDocs` เหมือน kitchen `issueRequisition`) พร้อม validate ทุกแถวกับ catalog ก่อนเขียนเหมือน `receiveStock` · ~~ผูก `ref_id` เข้ากับ ledger ในขั้นตอนเดียวกัน~~ ⚠️ **SUPERSEDED 2026-07-25 (Option A)** — **ไม่มี cross-doc atomic write**
- **Application Layer:** `operationsKeys.purchases()`, `usePurchases` / `useCreatePurchase` / `useReceivePurchase`, และ branch `purchase` ใน `startOperationsLiveQuery` (ledger เปลี่ยน → invalidate balance ผ่าน branch `stock_ledger` เดิม)
- **UI Layer:** ~~ตัวเลือกใน `ReceiveStockForm` เพิ่ม "จัดซื้อ / หน่วยงานรัฐ" พร้อมช่อง `vendor` (req) และ `po_ref` (opt)~~ ⚠️ **SUPERSEDED 2026-07-25 (Option A)** → เป็น **surface ใหม่ของ purchase** ที่ route `(protected)/back-office/purchases/` แทน: (1) ฟอร์มสร้างใบจัดซื้อ (vendor req / po_ref opt / items[] / occurred_at / note) (2) list ใบจัดซื้อ + **badge 3 สถานะ** (ยังไม่รับ / รับบางส่วน / รับครบ — คำนวณจาก ledger ที่ `ref_id` ตรง ไม่เก็บใน doc) (3) action "รับเข้าคลัง" ต่อใบ → ฟอร์ม counted items (default = `purchase.items` แก้ qty ได้; item perishable บังคับ `lot.expiry` เหมือน `ReceiveStockForm`) (4) action "แก้ใบ" เฉพาะใบสถานะ "ยังไม่รับ" · guard `requireWarehouseAccess` · **กติกาครบใน §UX decisions**
- **Role/permission:** สร้าง `purchase` doc + เขียน ledger `reason:purchase` = **เหมือน FR-28 receive เป๊ะ** — `warehouse_staff` เป็นผู้เขียน (+ `system_admin` global); **SM ไม่เขียน ledger ตรง** ตาม operating note §3 (แม้ SM ⊇ WS) · shelter-scoped (ข้ามศูนย์ = NoPermission) · internal-only (ไม่มี public/donor tier) · gate ทั้ง purchase doc + ledger row ที่ **route guard (`requireWarehouseAccess`) + Zod** — โปรเจกต์ไม่มี `validate_doc_update` จึง **ไม่มี enforcement ระดับ CouchDB** (~~gate 2 write แบบ atomic~~ ⚠️ ถ้อยคำเดิมแก้ 2026-07-25: Option A เป็น 2 action แยกกัน ไม่มี atomic gate ระดับ DB — อย่าเคลม) · ตัดสิน 2026-07-24 (ดู role-permission-matrix §3)
- **T-13:** ไม่กระทบ — คนละ path (transfer items) ทำคู่ขนานได้
- **T-24 (donation transparency report — public, ไม่ login) ⚠️ ต้องระวังตอน build:** DoD ของ T-24 คือ *"สรุปรับเข้า/แจกออกต่อ item ต่อศูนย์ **จาก Stock Ledger**"* — ถ้านับทุกแถวบวกเป็น "รับเข้า" **ยอดจัดซื้อจะปนเข้าไปในรายงานความโปร่งใสของการบริจาค** ทำให้ยอดบริจาคเกินจริง · T-24 ต้อง filter `reason` (ทำได้เพราะ CR นี้ให้ค่า enum แยก — ถ้า map เป็น `receive` แบบเดิมจะแยกไม่ออก) · ตอนนี้ T-24 ยังไม่ build จึงยังไม่มีความเสียหาย
- **T-21 (donation reservation):** ไม่พัง — `calculateReserved` filter `reason === 'donation'` แถว purchase จึงไม่หลุดเข้า `keyedDonationIds` · แต่ on-hand (`stockBalance`) **รวม** purchase ⇒ "ความต้องการคงค้าง = target − on-hand" ลดลงเมื่อจัดซื้อเข้าคลัง = **intended** (มีของแล้วไม่ต้องขอบริจาคซ้ำ) ไม่ใช่ bug
- **Public plane:** ไม่รั่ว — worker projector เป็น allowlist (`worker/src/worker/couch/processor.py` รับเฉพาะ `evacuee` / `donation` / `donation_campaign` / `supply_item`) → `purchase` ถูกข้าม `vendor`/`po_ref` ไม่ขึ้น Mongo `public_*` · ถ้าอนาคตจะ project ต้องทำอย่างมีสติ (ข้อมูลคู่ค้า)
- **นอกขอบเขต:** `reason: 'receive'` ยังเป็นค่ากำพร้า (ไม่มีโค้ด production สร้าง — `source: manual` map ไป `adjust`) CR นี้ไม่แตะ

## UX decisions (เคาะครบ 2026-07-25 — ปิด Open items ทั้ง 4 ข้อ)

Option A ปิด open item เรื่อง write path ไปแล้ว · 4 ข้อฝั่ง UX เคาะครบเมื่อ 2026-07-25 (project owner) โดยเทียบบรรทัดฐานของ task พี่น้องใน `docs/task-breakdown/03-C-supply.md` / `05-D-kitchen.md` / `04-donation.md`:

1. **ที่วาง surface** — **route ใหม่ `(protected)/back-office/purchases/`** (แยกชัดจาก supply/stock-donations · guard `requireWarehouseAccess` เหมือน `supply/+page.ts`) — ไม่ทำเป็น tab
2. **วิธี key รับเข้า** — **counted ทีละ item แก้ qty ได้** (prefill จาก `purchase.items` · item perishable บังคับ `lot.expiry` เหมือน `ReceiveStockForm`) ตามบรรทัดฐาน **T-26** (*"แก้รายการ/จำนวนก่อนยืนยันได้"*) และทำให้ audit *"จำนวนจริง vs ที่แจ้ง"* ของ **T-16** เกิดขึ้นเองจาก `items[]` เทียบ ledger
3. **partial / รับหลายรอบ — อนุญาต** (append ได้เรื่อย ๆ; key เกิน/ผิดแก้ด้วย correction entry `adjust` ตาม T-11 DoD) · **badge = 3 สถานะ derive จาก ledger เท่านั้น ไม่เก็บ status ใน doc** (T-14 DoD: reconcile กับ ledger ผลต่าง = 0 — SM-8):

   | สถานะ | นิยาม (ยอดรวมของแถว ledger ที่ `reason:'purchase'` และ `ref_id = purchase._id`) |
   | --- | --- |
   | ยังไม่รับ | ไม่มีแถวเลย |
   | รับบางส่วน | มี ≥1 แถว แต่ยังมี item ใน `items[]` ที่ยอดรวม < `qty` ที่สั่ง |
   | รับครบ | ทุก item ใน `items[]` มียอดรวม **≥** `qty` ที่สั่ง |

   **รับเกินที่สั่ง (สั่ง 100 รับ 120) = "รับครบ" เฉย ๆ** ไม่มีสถานะที่ 4 และ **ไม่ block ตอน key** (ของจริงหน้างานมาเกินได้ · T-26 ก็ยอมให้เบิกต่างจากที่ขอ) · ส่วนเกินเห็นได้จากตัวเลข ledger เทียบ `items[]` · item ที่ key เข้ามาโดยไม่อยู่ใน `items[]` ไม่เปลี่ยนสถานะ (นับเป็นส่วนเกิน)
4. **แก้ใบ — มี, เฉพาะใบสถานะ "ยังไม่รับ"** (ยังไม่มี ledger ผูกเลย): แก้ `vendor` / `po_ref` / `items` / `occurred_at` / `note` ผ่าน LWW `touch()` · **ไม่มีการยกเลิก/ลบใบ** — ใบที่พิมพ์ผิดแล้วปล่อยค้างไม่กระทบยอดสต็อก เพราะยอดมาจาก ledger เท่านั้น (ต่างจาก T-13 transfer ที่ตัดยอดต้นทางทันทีจึงต้องมีปุ่มยกเลิก) · **ไม่เพิ่มฟิลด์ใหม่ → `schema_v` ของ `purchase` ยังเป็น 1**
   > เหตุที่ห้ามแก้หลังเริ่มรับ: `items[]` เป็นตัวหารของ badge ข้อ 3 และเป็นฝั่ง "ที่สั่ง" ของ audit T-16 — แก้ย้อนหลังจะทำให้สถานะกระโดดและ audit เสียความหมาย

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
- 2026-07-16 — PR #99 (docs-only) merged เข้า develop โดย @net-lynx — เป็นการ land ตัว **ข้อเสนอ** (ไฟล์ยังคง `status: proposed`) ไม่ใช่ sign-off ในตัว
- 2026-07-24 — **approved**: @net-lynx sign-off ในแชท (2026-07-24) ยืนยันเอาแนว **doc type + enum** ตามข้อเสนอ → `status: proposed → approved` · **ยังไม่ implement**: `docs/data/schema.md` §2.16/§2.1 + code (`features/operations` domain/data/ui) ยังไม่แตะ · **open item ก่อน implement:** ยังไม่กำหนด role/permission ว่าใครสร้าง `purchase` doc ได้ (ดู Impact §role/permission · change-management §2)
- 2026-07-24 — **role/permission decided** (ปิด open item ข้างบน): purchase = source ของ FR-28 receive → เขียน purchase doc + ledger `reason:purchase` **เหมือน FR-28/29/30 พี่น้องเป๊ะ** — `warehouse_staff` เขียน (+ `system_admin`); **SM ไม่เขียนตรง** ตาม operating note §3 · shelter-scoped, internal-only, gate 2 write แบบ atomic · sync `role-permission-matrix` §3 · (เคยพิจารณาให้ SM เขียนตรงตาม SM ⊇ WS แต่ **เลือก reconcile ให้ตรงพี่น้อง** เพื่อไม่แตะ RBAC core FR-28/29/30 นอก CR-032 — ไม่มี inconsistency ค้าง)
- 2026-07-24 — clarification (per project owner): @net-lynx อนุมัติ CR-032 (doc type + enum) ในแชทแล้ว — เหตุที่ PR #99 (07-16) ยังคง `status: proposed` = ลืมแก้ status ตอน merge ไม่ใช่เพราะยังไม่อนุมัติ · role model final (WS-only เหมือนพี่น้อง) = project owner decision 2026-07-24 · role/permission **ไม่ใช่ open item ที่ค้างอีกต่อไป**
- 2026-07-25 — **implement slice 1/3 (schema_v bump + reason enum)**: เพิ่ม `purchase` ใน `ledgerReasonSchema` + bump `stock_ledger` `schema_v` 2→3 ที่ **ผู้เขียน ledger ทั้งสองที่** — operations `createStockLedger` (`operations.ts`) และ kitchen `issueRequisition` (`kitchen.remote.ts`, **ripple ที่ CR เดิมไม่ได้ระบุ** — เพิ่มใน `affects` แล้ว) · schema.md §2.1 (enum + schema_v 3 + migration note) · test 2 จุด (operations.remote.test:149, kitchen.remote.test:57) — `meal_plan` schema_v คงเดิมที่ 2 (คนละ doc type) · **ยังไม่ทำ (slice 2–3)**: doc type `purchase` §2.16, write path (purchase doc + ledger, mirror kitchen `issueRequisition`/`bulkDocs`), UI vendor/po_ref · status ยัง `approved` (ยังไม่ `done`)
- 2026-07-25 — **design decided: Option A (donation-style 2 สเต็ป)** — project owner เคาะ: `purchase` doc เกิด **คนละ action** กับการ key รับเข้า เหมือน `donation` (`createPurchase` → put doc; `keyPurchaseReceipt` → append ledger `reason:purchase`, `ref_id = purchase._id`). key insight: ความต่างระหว่าง purchase กับแหล่งอื่น **ไม่ใช่ "มี doc หรือไม่มี" แต่คือ "doc เกิดตอนไหน"** → พอ doc เกิดก่อน การรับของก็เหลือแค่ append ledger ใบเดียว **ไม่มี cross-doc atomic write** และ **ไม่มีช่อง `ref_id` ให้ผู้ใช้พิมพ์ขัดกัน** · **ผลต่อ CR:** §Change ข้อ 4 amended เป็น 2 สเต็ป · §Change ข้อ 5 (`receiveSourceSchema` += purchase) **superseded** — purchase ไม่ใช่ `receiveSource` · §Impact Domain (`receiveSourceSchema`/`createReceiveEntry`) + §Impact UI (`ReceiveStockForm` option) **superseded** → surface ใหม่แทน · §Impact Role/permission แก้ถ้อยคำ "gate 2 write แบบ atomic" (โปรเจกต์ไม่มี `validate_doc_update` → enforce ที่ route guard + Zod เท่านั้น) · purchase doc **ไม่มี `status`** — "รับแล้ว?" อนุมานจาก ledger ที่ `ref_id` ตรง, `items[]` = planning signal · `affects` ขยายครอบ repository / application queries / barrel / UI ใหม่ / `seed.ts` · **open item ใหม่ = UX 4 ข้อ** (ดู §Open items) — ไม่บล็อก slice domain/data/application
- 2026-07-25 — **downstream sync ของ Option A** (ripple ที่อ้างถ้อยคำเดิม): `docs/prd/role-permission-matrix.md` §3 (ถอน "gate ทั้งสอง write แบบ atomic" → route guard + Zod, ไม่มี `validate_doc_update`; และ purchase ไม่ใช่ตัวเลือก source ของฟอร์ม FR-28 — สิทธิ์เท่ากันแต่คนละ surface) · `docs/task-breakdown/03-C-supply.md` T-11 DoD (แยก bullet purchase flow ออกจาก source marker + สถานะ slice 1/3) · `docs/changes/_index.md` แถว CR-032 (สรุป + affects) · ทั้งสามไฟล์อัป `updated:` เป็น 2026-07-25 · `docs/data/schema.md` §2.1 ไม่ต้องแก้ (note "doc type §2.16 + write path มาใน slice ถัดไป" ยังถูกต้อง)
- 2026-07-25 — **implement slice 2/3 (data + application layer)**: repository interface + remote impl ได้ `createPurchase` / `listPurchases` / `getPurchase` / `receivePurchase` (`operations.remote.ts` เพิ่ม field `dbName` เพื่อเรียก `bulkDocs` แบบ kitchen `issueRequisition` — **1 request ต่อ 1 receipt**) · application ได้ `operationsKeys.purchases()` + `usePurchases` / `useCreatePurchase` / `useReceivePurchase` + branch `purchase` ใน `startOperationsLiveQuery` · barrel widen 3 hook · test data layer 7 ข้อ (`operations.remote.test.ts` — mock `bulkDocs` เข้า in-memory store) · **2 กติกาที่เพิ่มจากดีไซน์ (ระดับ implementation ไม่ใช่ spec)**: (ก) `receivePurchase` ปฏิเสธ `counted` ว่าง (สอดคล้องกับ `items[]` ที่บังคับ ≥1) (ข) validate ทุกแถวกับ catalog **ก่อน** เขียน → แถวเสียแถวเดียว reject ทั้ง receipt ไม่เขียนครึ่ง ๆ · data layer **ยอมให้ key ซ้ำใบเดิมได้** (append-only) — ยังไม่บังคับกติกา partial receive เพราะ Open item ข้อ 3 ยังไม่เคาะ · verify: `pnpm check` 0 error · vitest operations+kitchen 116 passed · `pnpm lint` clean · **ยังไม่ทำ (slice 3/3)**: UI surface (บล็อกด้วย Open items UX 4 ข้อ) + `seed.ts` demo · status ยัง `approved`
- 2026-07-25 — **UX decided (ปิด Open items ทั้ง 4 ข้อ)** — project owner เคาะหลัง cross-module review ของ `03-C-supply.md` (+ Standard DoD `_index.md`), `05-D-kitchen.md` T-26, `04-donation.md` T-16/T-21/T-24: (1) route ใหม่ `/back-office/purchases` (2) counted ต่อ item แก้ qty ได้ — ตาม T-26 DoD *"แก้รายการ/จำนวนก่อนยืนยันได้"* (3) partial อนุญาต + **badge 3 สถานะ derive จาก ledger เท่านั้น** (ยังไม่รับ / รับบางส่วน / รับครบ; **รับเกินที่สั่ง = รับครบ** ไม่ block ตอน key) ตาม T-14 DoD reconcile ผลต่าง 0 (4) **มีปุ่มแก้เฉพาะใบสถานะ "ยังไม่รับ"** ผ่าน LWW `touch()` · **ไม่มียกเลิก/ลบใบ** — ใบผิดไม่กระทบยอดเพราะยอดมาจาก ledger (ต่างจาก T-13 ที่ตัดยอดต้นทางทันที) · **ไม่เพิ่มฟิลด์ → `schema_v` purchase ยัง 1, ไม่ต้อง bump** · ข้อ 3–4 เป็น **business rule ใหม่** จึงเขียนลง §UX decisions + `schema.md` §2.16 · **cross-module finding ที่บันทึกเพิ่มใน §Impact:** T-24 ต้อง filter `reason` ไม่ให้ยอดจัดซื้อปนในรายงานบริจาค (CR เดิมพูดถึงแค่ T-14) · T-21 ไม่พัง แต่ on-hand ที่รวม purchase ทำให้ความต้องการคงค้างลดลง = intended · public plane ไม่รั่วเพราะ worker projector เป็น allowlist
- 2026-07-25 — **follow-up CR ที่แตกออกไป:** design review ของ Option A พบว่า invariant `reason` ↔ `ref_id` ไม่ถูกบังคับที่ไหนเลย (`stockLedgerInputSchema` รับสตริงอะไรก็ได้) และกับดัก 3 (ช่อง `ref_id` free text ในฟอร์มรับสต็อก) **ยังคาอยู่กับ `donation` / `transfer_in`** แม้ purchase จะเลี่ยงได้แล้ว → เปิด **[CR-045](CR-045-stock-ledger-refid-invariant.md)** (`proposed`) แยกต่างหาก เพราะกระทบทุกแหล่ง ไม่ใช่แค่ purchase · **ไม่บล็อก CR-032** — `keyPurchaseReceipt` มินต์ `ref_id` จาก doc จริงจึงถูกต้องโดยโครงสร้างอยู่แล้ว
