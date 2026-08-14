---
id: CR-055
title: "Enforce reason ↔ ref_id invariant on stock_ledger"
status: approved
date: 2026-07-25
updated: 2026-08-14
requested_by: project owner (design review ของ CR-032 Option A)
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §2.1 (นิยาม `ref_id` — จากคำอธิบายลอย เป็นตาราง mapping ที่บังคับใช้ได้)
  - schema_v stock_ledger — เสนอ **ไม่ bump** (ไม่เปลี่ยนรูป doc) · ต้องเคาะ Q-3
  - frontend/src/lib/features/operations/domain/operations.ts (`stockLedgerInputSchema`, `receiveInputSchema`, `distributeInputSchema`)
  - frontend/src/lib/features/operations/domain/operations.test.ts
  - frontend/src/lib/features/operations/ui/ReceiveStockForm.svelte (ช่อง `ref_id` free text → R4)
  - frontend/src/lib/features/operations/domain/operations.ts (`createStockLedger` — เพิ่ม param `id?` ตาม R7)
  - frontend/src/lib/features/kitchen/data/kitchen.remote.ts + kitchen.remote.test.ts (ผู้เขียน ledger อีกจุด — ต้องผ่าน invariant · R7)
  - script ตรวจข้อมูลเดิมก่อน enforce (ดู Migration)
---

# CR-055 — Enforce reason ↔ ref_id invariant on stock_ledger

> [!NOTE]
> **สรุป (TL;DR):** `stock_ledger.ref_id` ปัจจุบันรับสตริงอะไรก็ได้ ไม่มีอะไรผูกกับ `reason` — เขียน
> `reason:'purchase'` คู่กับ `ref_id:'donation:…'` หรือ `ref_id:null` ได้ และเพราะ ledger เป็น append-only
> จึงแก้ย้อนหลังไม่ได้ · CR นี้บังคับ invariant `reason → prefix ของ ref_id` ที่ชั้น domain (Zod) และ
> เปลี่ยนช่อง `ref_id` ในฟอร์มรับสต็อกจาก free text เป็น picker · **ไม่เปลี่ยนรูป doc** (เสนอไม่ bump
> `schema_v`) · dev ต้อง build: superRefine + test ครบทุกแถวของตาราง R2 + audit script + แก้ฟอร์ม ·
> **ยังมี 6 คำถามค้างต้องเคาะก่อน approve** (§Open questions)

## Why

พบระหว่าง design review ของ CR-032 Option A (2026-07-25) — คำถามคือ "การให้ `purchase` ใช้ `ref_id`
ร่วมกับ doc ต้นเหตุหลายชนิดแบบเดียวกับ `donation` เป็นดีไซน์ที่ดีหรือไม่"

**ข้อสรุปของ review: encoding ถูกแล้ว ปัญหาอยู่ที่ invariant ไม่ถูกบังคับ**

- `ref_id` ไม่ใช่ polymorphic FK แบบคลาสสิก — CouchDB `_id` มี type prefix ในตัว (`purchase:01J…`)
  ตัว pointer จึงบอกชนิดตัวเองได้โดยไม่ต้องอ่าน `reason` ก่อน
- ต้นทุนที่กลัวกัน (ทุก consumer ต้อง branch ตามชนิด) ยังไม่เกิดจริง — ทั้ง repo มี branch เดียวที่
  `operations.ts:468` (`calculateReserved`); `LedgerTable.svelte:180` render เป็นสตริงทึบ
- ทางเลือกที่ type-safe กว่า (แยก field ต่อแหล่ง: `donation_id` / `purchase_id` / …) ซื้อ referential
  integrity ไม่ได้อยู่ดีเพราะ CouchDB ไม่มี FK/join — ได้แค่ field ว่างเพิ่มทุกแถว + ต้อง bump
  `schema_v` ทุกครั้งที่เพิ่มแหล่ง

**สิ่งที่เป็นปัญหาจริง:** `stockLedgerInputSchema` (`operations.ts:160`) ประกาศ

```ts
ref_id: z.string().nullable().default(null)
```

ไม่มี validation ใด ๆ ผูก `ref_id` กับ `reason` เลย. Write path แบ่งเป็นสองกลุ่มที่คุณภาพต่างกันมาก:

| กลุ่ม | ผู้เขียน | สถานะ |
| --- | --- | --- |
| **มินต์ `ref_id` จาก doc จริง** | `keyDonationReceipt` (`operations.ts:408`) · kitchen `issueRequisition` (`kitchen.remote.ts:84`) · `keyPurchaseReceipt` (CR-032, กำลังทำ) | **ถูกต้องโดยโครงสร้าง** — ไม่มีทางผิด |
| **รับ `ref_id` จากภายนอก** | `createReceiveEntry` (ส่ง `d.ref_id` ผ่านตรงที่ `operations.ts:242`) · `createDistributeEntry` (`operations.ts:268`) | **ไม่ถูก validate เลย** |

ช่องโหว่ที่เข้าถึงได้จริงวันนี้ (ไม่ใช่กรณีสมมติ):

1. **`adjust` พก `ref_id` ได้** — `source:'manual'` map เป็น `reason:'adjust'` แต่ `ref_id` ถูกส่งผ่านไป
   ด้วย · `ReceiveStockForm.svelte:126–130` พยายามล้างค่าให้ แต่นั่นคือการกันที่ **UI ชั้นเดียว**
   domain ไม่กัน — เรียก `createReceiveEntry` จากที่อื่นก็ได้แถวเสียทันที
2. **`ref_id` ของ donation เป็นข้อความที่ผู้ใช้พิมพ์เอง** — ฟอร์มเป็น free text
   (`ReceiveStockForm.svelte:281–290`) แล้ว `calculateReserved` (`operations.ts:468`) เอาค่านั้นไปใส่
   `keyedDonationIds` ตรง ๆ → พิมพ์ผิด = donation ที่ key แล้วไม่ถูกนับว่า key (ค้างจองตลอดไป),
   พิมพ์ไปชน id ใบอื่น = ปลดจองผิดใบ

ทั้งสองกรณีเขียนลง ledger ที่ **append-only** — ตรงกับเหตุผลตั้งต้นของ CR-032 เองที่ว่า "ถ้าข้อมูลที่มา
หายตอนเขียน จะย้อนไป backfill ไม่ได้"

## Change

### Requirements

- **R1** — `stockLedgerInputSchema` ต้อง validate ความสัมพันธ์ `reason` ↔ `ref_id` ตามตาราง R2.
  การละเมิด = **parse error** (throw) ไม่ใช่ warning และไม่ใช่การแก้ค่าให้เงียบ ๆ
- **R2** — mapping ที่บังคับใช้:

  | `reason` | `ref_id` ต้องเป็น | ที่มา |
  | --- | --- | --- |
  | `donation` | `donation:{ulid}` — req | `keyDonationReceipt` |
  | `purchase` | `purchase:{ulid}` — req | `keyPurchaseReceipt` (CR-032) |
  | `requisition` | `kitchen_requisition:{ulid}` — req | kitchen `issueRequisition` |
  | `transfer_in` / `transfer_out` | `stock_transfer:{ulid}` — req | T-13 (ยังไม่ wired — `operations.ts:224`) |
  | `adjust` | **`null` เสมอ** | ปรับสต็อกมือ ไม่มีใบต้นเหตุ |
  | `distribute` | **ต้องเคาะ — Q-1** | `createDistributeEntry` |
  | `receive` | **ต้องเคาะ — Q-2** | ไม่มีผู้เขียนใน production |

- **R3** — `createReceiveEntry` และ `createDistributeEntry` ต้องตกที่ invariant เดียวกับ R1 (ทั้งคู่เรียก
  ผ่าน `createStockLedger` อยู่แล้ว — ไม่ต้องเพิ่ม validation ซ้ำในสองที่)
- **R4** — `ReceiveStockForm` (ไฟล์จริง: `receive-stock-form.svelte`) ต้องเลิกให้ผู้ใช้พิมพ์ `ref_id` เป็น
  free text → เปลี่ยนเป็น **picker ที่เลือกจาก doc จริง** และเมื่อ source = `manual` ต้องไม่มีช่องนี้เลย
  - **source `donation` — เคาะ D-1 (ค) 2026-08-14:** picker แสดง donation ที่ยังไม่ถูก key **+ ปุ่ม
    "บริจาคหน้างาน (walk-in)"** ที่มินต์ donation doc ผ่าน `createWalkInDonation` แล้วชี้ `ref_id` ไปที่ doc
    ที่เพิ่งสร้าง · **จำเป็น** เพราะ donation doc วันนี้เกิดจาก public portal (worker inbound) เท่านั้น —
    ของบริจาคที่เดินมาส่งหน้างานโดยไม่ได้จองล่วงหน้าจะไม่มี doc ให้เลือก ⇒ picker ว่าง = รับของไม่ได้ ·
    `createWalkInDonation` + `walkInDonationInputSchema` export ผ่าน barrel อยู่แล้ว (`index.ts:33,45`)
    **แต่ยังไม่มี production caller เลยสักที่** — R4 คือจุดที่ปลดล็อกมันใช้งานจริง
  - **source `transfer_in` — เคาะ D-3 (ก) 2026-08-14:** **ซ่อน/disable option นี้ในฟอร์มรับสต็อก** จนกว่า
    T-13 จะมี `stock_transfer` จริง (`grep stock_transfer frontend/src/lib` = **0 hit** วันนี้) · คง
    `transfer_in` / `transfer_out` ไว้ใน **`ledgerReasonSchema`** ตามเดิม (คนละ enum กับ
    `receiveSourceSchema` ที่คุมตัวเลือกในฟอร์ม) · ถ้าไม่ซ่อน ผู้ใช้จะเลือกได้แต่ submit ไม่ผ่านตลอดกาล
    เพราะ R2 บังคับ prefix `stock_transfer:` ที่ยังไม่มีทางมินต์ได้
  - placeholder เดิม (`:311`) เขียน `transfer:6789` ซึ่ง **ผิด prefix จริง** (`stock_transfer:`) มาแต่ต้น —
    หลักฐานว่าปล่อยให้พิมพ์เองแล้วผิดแน่
- **R5** — invariant บังคับ **ตอนเขียน** เท่านั้น. path การอ่าน (`stockBalance`, `LedgerTable`,
  `calculateReserved`) ต้องยังอ่านแถวเก่าที่ละเมิดได้โดยไม่ throw — ห้ามทำให้ข้อมูลเดิมพังแอป
- **R6** — test ครอบทุกแถวของตาราง R2 ทั้งฝั่ง accept และ reject; fixture เดิมใน
  `operations.remote.test.ts` / `kitchen.remote.test.ts` ต้องผ่าน invariant
- **R7** — **ผู้เขียน `stock_ledger` ทุกจุดต้องผ่าน `createStockLedger`** เพื่อให้ตกที่ invariant R1 ที่เดียว.
  kitchen `issueRequisition` (`kitchen.remote.ts:80–94`) ปัจจุบัน **ประกอบ doc ด้วยมือทั้งใบ** ไม่แตะ Zod เลย —
  ค่าที่เขียนวันนี้ถูก (`ref_id = requisition._id` = `kitchen_requisition:…`) แต่ถูกเพราะ *เขียนดี* ไม่ใช่เพราะ
  *ถูกบังคับ* ซึ่งคือปัญหาเดียวกับที่ CR นี้ตั้งขึ้นมาแก้ · ทั้ง repo มีจุดนี้จุดเดียวที่ประกอบเอง
  (`grep "type: 'stock_ledger'" src/lib` → `operations.ts:65` ที่เป็น interface + `kitchen.remote.ts:82`)
  - วิธีบังคับ: เปิด `createStockLedger(input, ctx, id?)` ให้รับ `_id` ล่วงหน้า แล้วส่งต่อไป `makeDoc` ซึ่ง
    **รับ param `id` อยู่แล้ว** (`db/model.ts:89–95`) · ครัวมินต์ ulid ก่อน → ประกอบ `ledger_ids` ให้ requisition
    (`kitchen.ts:173,187` ต้องรู้ `_id` ล่วงหน้า) → เรียก `createStockLedger` ต่อแถวโดยส่ง ulid เดิม
  - **ห้าม** แก้ด้วยการ export ฟังก์ชัน validate แยกไปเรียกซ้ำที่ครัว — จะกลายเป็น guard สองที่ที่ต้องจำให้เรียก
    ซึ่งคือปัญหาเดิมของ CR ในรูปใหม่ (ขัดวงเล็บของ R3)
  - **ข้อควรระวัง:** วันนี้ครัวใช้ `ts` ก้อนเดียวให้ทุกแถว (`kitchen.remote.ts:79`) — ต้องส่ง `occurred_at: ts`
    เข้า input เพื่อคง timestamp เชิงธุรกิจให้เท่ากันทุกแถว · `created_at`/`updated_at` ที่เพี้ยนระดับ ms
    เป็น envelope ยอมรับได้
  - ไม่เปลี่ยนรูป doc · `schema_v` คง 3 เท่ากันทั้งสองทาง (ตรงกับ §2.1 ที่ระบุว่าผู้เขียนทุกที่ stamp เท่ากัน)
- **R8** — **input schema ของ path ที่ตาราง R2 บังคับ `null` ต้องประกาศเป็น `z.null().default(null)`**
  ให้ปฏิเสธตั้งแต่ **compile time** ไม่ต้องรอ runtime — ครอบ 2 ตัว:
  - `adjustInputSchema.ref_id` (`operations.ts:280`) — `createAdjustEntry` (`:291`) เป็นผู้เขียน ledger
    **ตัวที่ 4** ที่ R3 ไม่ได้นับ · วันนี้ประกาศ `z.string().nullable()` แล้วส่งผ่านตรงเข้า
    `createStockLedger` ทั้งที่คอมเมนต์บรรทัดเดียวกันเขียนว่า "Always null" ⇒ เป็นช่องโหว่ข้อ 1 ของ §Why
    ("`adjust` พก `ref_id` ได้") ในรูปที่ตรงกว่า `createReceiveEntry` เสียอีก เพราะ **ไม่มีแม้แต่ UI
    คอยล้างค่าให้** (ฝั่ง receive ยังมี `receive-stock-form.svelte:146–152`)
  - `distributeInputSchema.ref_id` (`operations.ts:254`) — ข้อบกพร่องคลาสเดียวกัน · Q-1 เคาะ (ก) ว่า
    `distribute` ต้อง `null` เสมอ แต่ schema ยังรับ string และ `distribute-stock-form.svelte`
    **ไม่มีช่องนี้ให้กรอกตั้งแต่แรก** (grep `ref_id` = 0) ⇒ เป็น dead field ที่เปิดรูไว้เฉย ๆ
  - **ไม่ breaking ทั้งคู่:** `adjust-stock-form.svelte:204` ส่ง `ref_id: null` อยู่แล้ว · ฝั่ง distribute
    ค่ามาจาก `.default(null)` ของ schema เอง (superforms `defaults(zod4(distributeInputSchema))`) ·
    `AdjustInput` / `DistributeInput` export ผ่าน barrel — type ที่แคบลงยังรับ `null` ได้เหมือนเดิม ·
    test ที่ส่ง `ref_id: null` (3 จุดใน `operations.remote.test.ts`) ไม่กระทบ
  - **ทางเลือกที่ไม่เลือก:** ถอด field ทิ้งเลย — สะอาดกว่าแต่เปลี่ยนรูป `DistributeInput`/`AdjustInput`
    และต้องไล่แก้ caller/test ⇒ เลือก `z.null()` เพื่อให้สมมาตรและ churn น้อย
  - R8 เป็น **การกันชั้นที่สอง ไม่ใช่ตัวแทน R1** — `createStockLedger` ถูกเรียกตรงจากที่อื่นได้
    invariant จึงต้องอยู่ที่ `stockLedgerInputSchema` ด้วยเสมอ
- **R9** — **ฟอร์มต้องเห็น invariant เป็น field error ไม่ใช่ error ตอน mutation.** `receiveInputSchema`
  (ตัวที่ถูกส่งเข้า superforms ที่ `receive-stock-form.svelte:60,62` ผ่าน `zod4()`) ต้อง `.superRefine()`
  โดย map `source` → `reason` แล้วเช็ค prefix จาก **`REF_PREFIX_BY_REASON` ก้อนเดียวกับ R1** แล้ว
  `addIssue` ที่ path `['ref_id']`
  - **เหตุผล:** กฎของ R1 อยู่ที่ `stockLedgerInputSchema` ซึ่ง **ไม่มีฟอร์มไหนส่งเข้า `zod4()` เลย**
    (ตรวจแล้ว: receive ใช้ `receiveInputSchema` · distribute ใช้ `distributeInputSchema`) ⇒ ถ้าไม่ทำ R9
    ผู้ใช้จะ validate ผ่าน แล้วไป throw ตอน mutation กลายเป็น error toast ที่แก้ไม่ถูกจุด
  - **ไม่ขัด R7:** จุด **บังคับ** ยังอยู่ที่ `stockLedgerInputSchema` ที่เดียวเหมือนเดิม — R9 เป็นชั้น
    **UX pre-validation** ที่อ่านค่าจาก constant เดียวกัน ไม่ใช่การก๊อป logic ไปไว้สองที่
    (สิ่งที่ R7 ห้ามคือ writer ที่เลี่ยง factory แล้วไปเรียก validate เอง — คนละเรื่องกัน)
  - R9 ถูกกลืนโดย R4 บางส่วน (picker ทำให้พิมพ์ผิดไม่ได้) แต่ยัง**จำเป็น** สำหรับกรณีที่ค่าค้างจาก
    การสลับ `source` หรือ donation ถูก key ไปแล้วระหว่างเปิดฟอร์ม

### Before → after

```ts
// before (operations.ts:160)
ref_id: z.string().nullable().default(null)

// after — โครงที่เสนอ (รายละเอียดตอน implement)
.superRefine((d, ctx) => {
  const expected = REF_PREFIX_BY_REASON[d.reason];   // ตาราง R2
  if (expected === null && d.ref_id !== null) ctx.addIssue(...);
  if (expected && !d.ref_id?.startsWith(expected)) ctx.addIssue(...);
})
```

## Open questions — **เคาะแล้ว 2026-08-14: ตามคอลัมน์ "ข้อเสนอ" ทั้ง 6 ข้อ**

> Q-1 (ก) `distribute` → `null` เสมอ · Q-2 (ข) คง `receive` ใน enum + บังคับ `null` · Q-3 (ก) **ไม่ bump**
> `schema_v` (คง 3) · Q-4 บังคับมี audit script + ผลก่อน merge · Q-5 (ก) รวม R4 ไว้ใน CR นี้ ·
> Q-6 (ก) ปิดที่ Zod เท่านั้น ไม่แตะ `validate_doc_update` — ดู Decision log 2026-08-14

| # | คำถาม | ตัวเลือก | ข้อเสนอ |
| --- | --- | --- | --- |
| **Q-1** | `distribute` ควรมี `ref_id` ไหม | (ก) `null` เสมอ (ข) ชี้ไป doc การแจกจ่าย/household | ยังไม่มีผู้ใช้จริง — `distributeInputSchema:254` เปิดรับไว้เฉย ๆ; เสนอ (ก) จนกว่าจะมี doc แจกจ่ายจริง |
| **Q-2** | `receive` ที่เป็นค่ากำพร้า (ไม่มีโค้ด production สร้าง — CR-032 §นอกขอบเขต) | (ก) ถอดออกจาก enum → **bump `schema_v` 3→4** (ข) คงไว้ + บังคับ `ref_id === null` | เสนอ (ข) ใน CR นี้ แล้วแยกการถอด enum เป็น CR ต่างหาก (ถอด = เปลี่ยนรูป, คนละความเสี่ยง) |
| **Q-3** | bump `schema_v` ไหม | (ก) ไม่ bump — field/ชนิดเดิม เปลี่ยนแค่ค่าที่ยอมรับตอนเขียน (ข) bump 3→4 — "ค่าที่ valid เปลี่ยน = รุ่นใหม่" | เสนอ (ก) |
| **Q-4** | ข้อมูลเดิมที่ละเมิด | ต้องรัน audit ก่อน enforce (ดู Migration) | บังคับให้มี audit script + ผลลัพธ์ก่อน merge |
| **Q-5** | R4 (picker แทน free text) อยู่ใน CR นี้ หรือแยก | (ก) รวม — invariant กับ UI ที่ผลิตค่าผิดควรแก้พร้อมกัน (ข) แยกเป็น task UI ของ T-11 | เสนอ (ก); ถ้าแยกต้องยอมรับว่าฟอร์มจะ throw ให้ผู้ใช้เห็นระหว่างรอ |
| **Q-6** | บังคับตาราง R2 ที่ `validate_doc_update` ของ shelter DB ด้วยไหม (ดู Impact §ขอบเขต enforcement) | (ก) ไม่ — domain guard พอ, CR นี้ปิดที่ Zod (ข) ขยาย `buildValidateDocUpdate` ให้ตรวจ `reason` ↔ `ref_id` ด้วย | เสนอ (ก) ใน CR นี้ — (ข) เป็น **provisioning change** ต้อง redeploy `_design/access` ทุก shelter DB + แก้ `shelter-access-design.test.ts` และคนละความเสี่ยงกับการเพิ่ม validation ฝั่ง client → ควรแยก CR |

## Impact

- **Data model:** `docs/data/schema.md` §2.1 บรรทัด 160 ปัจจุบันเขียน `ref_id | str\|null | opt | doc
  ต้นเหตุ (donation/transfer/requisition/purchase)` — เป็นคำอธิบายลอย ไม่ผูกกับ `reason` → แทนด้วยตาราง R2
- **Domain:** `stockLedgerInputSchema` เพิ่ม superRefine + ตาราง `REF_PREFIX_BY_REASON`;
  `receiveInputSchema` / `distributeInputSchema` ได้ผลตามผ่าน `createStockLedger` (R3)
- **UI:** `ReceiveStockForm` R4 — ต้องมี query ดึง donation/transfer ที่เลือกได้ (กระทบ application layer
  ของ `operations`)
- **Test:** `operations.test.ts` (R6) · fixture ของ `operations.remote.test.ts` และ
  `kitchen.remote.test.ts` ต้องผ่าน invariant
- **CR-032:** `keyPurchaseReceipt` ถูกต้องโดยโครงสร้างอยู่แล้ว → CR นี้ **ไม่บล็อก** CR-032 slice
  domain/data/application · แต่ถ้า approve **ก่อน** CR-032 ทำ UI (slice 4.5) จะไม่ต้องทำฟอร์มสองรอบ
- **กับดัก 3 ของ CR-032:** Option A ทำให้ `purchase` เลี่ยงช่อง `ref_id` free text ได้ แต่กับดักนั้น
  **ยังคาอยู่กับ `donation` / `transfer_in`** — R4 คือการแก้ที่ต้นเหตุ ไม่ใช่การเลี่ยง
- **ขอบเขต enforcement:** shelter DB **มี** `validate_doc_update` อยู่แล้ว — `_design/access` ที่สร้างจาก
  `frontend/src/lib/server/shelter-access-design.ts` (deploy ตอน provisioning ที่
  `routes/api/back-office/shelter/+server.ts` · redeploy ผ่าน `lib/server/shelters.admin.ts`) บังคับ
  **envelope ตาม schema.md §0** (`type` / `schema_v` / `shelter_code` / `created_at` / `updated_at` /
  `created_by` ต้องมี), **`shelter_code` ต้องตรงกับ db**, **allowlist ของ `type`** และ — **แก้ข้อเท็จจริง
  2026-08-14** — **กฎเฉพาะชนิด doc อีก 3 ข้อ** (`shelter-access-design.ts:94–113`):
  1. **append-only** — `stock_ledger` / `audit` / `movement` / `screening` เขียนทับหรือลบไม่ได้
  2. **`donation.status` ห้ามถอยกลับเป็น `declared`** — นี่คือ invariant ระดับ field ที่มีอยู่แล้วจริง
  3. **role gate เฉพาะ `stock_ledger`** — `if (newDoc.type === 'stock_ledger')` เขียนได้เฉพาะ
     `warehouse_staff` / `shelter_manager` / `system_admin`

  ⇒ ที่ **ไม่มี** คือกฎ `reason` ↔ `ref_id` โดยเฉพาะ (ไม่ใช่ "ไม่ตรวจ field เลย" อย่างที่ฉบับก่อนเขียน) ·
  invariant ของ CR นี้ยังเป็น **domain guard ฝั่ง client เท่านั้น** เหมือนเดิม · เอกสาร/PR ห้ามเคลมเกินนี้
  - **`_admin` bypass** (`:59`) — back-office intake route (เขียนด้วย admin cred · gate จริงคือ
    `authorizeWarehouse()`) และ `frontend/scripts/seed.ts` **ไม่ผ่าน guard นี้อยู่แล้ว** ไม่ว่าจะเพิ่มกฎหรือไม่
  - `seed.ts` deploy `_design/access` ให้แค่ **catalog DB** ไม่ deploy ให้ shelter DB → ฐาน dev ที่ seed มา
    ไม่มี guard ฝั่ง server เลยแม้แต่ envelope
  - **ผลต่อ Q-6:** คำเคาะ **(ก) ยังเหมือนเดิม** (เพิ่มกฎ = provisioning change ต้อง redeploy ทุก shelter DB
    = คนละความเสี่ยง) แต่ **ต้นทุนจริงต่ำกว่าที่ประเมินไว้** เพราะมี branch ของ `stock_ledger` ให้ต่อยอด
    อยู่แล้ว — บันทึกไว้เผื่อวันที่ยกเป็น CR แยก

## Migration

- ไม่เปลี่ยนรูป doc → ไม่มี backfill (ขึ้นกับ Q-3)
- **บังคับก่อน enforce:** script สแกน `stock_ledger` ทั้งฐาน รายงานแถวที่ละเมิดตาราง R2 แยกตาม `reason`
  (dev / seed / ข้อมูลสาธิต) — ผลต้องแนบใน PR
- แถวเดิมที่ละเมิดแก้ไม่ได้ (append-only) → ตาม R5 ปล่อยให้อ่านได้ตามปกติ; ถ้าจำเป็นต้องแก้ยอดให้ใช้
  correction entry (`adjust`) ตามกติกาเดิมของ T-11
- ถ้าเคาะ Q-2 เป็น (ก) ถอด `receive` ออกจาก enum → เป็นการเปลี่ยนรูป ต้อง bump `schema_v` + แยก CR

## Acceptance / DoD

- [ ] ทุกแถวในตาราง R2 มี test ทั้งกรณี accept และ reject
- [ ] แถวเก่าที่ละเมิด invariant ยังอ่านผ่าน `stockBalance` / `LedgerTable` / `calculateReserved` ได้ (R5)
- [ ] audit script รันแล้วรายงานผล 0 แถวละเมิด หรือรายการที่เจ้าของรับทราบแล้ว (Q-4)
- [ ] `docs/data/schema.md` §2.1 มีตาราง R2 + อัป `updated:`
- [ ] **ไม่มีการประกอบ doc `stock_ledger` ด้วยมือหลงเหลือ** — `grep -rn "type: 'stock_ledger'" frontend/src/lib`
      เจอเฉพาะ `operations.ts` (นิยาม interface) · kitchen `issueRequisition` เขียนผ่าน `createStockLedger` (R7)
- [ ] `kitchen.remote.test.ts` เดิมยังเขียว (`ref_id === requisition._id`) + มี case ใหม่ที่ `issueRequisition`
      **โยน** เมื่อ `ref_id` ไม่ขึ้นต้นด้วย `kitchen_requisition:` (R7 × แถว `requisition` ของ R2)
- [ ] `adjustInputSchema.ref_id` **และ** `distributeInputSchema.ref_id` เป็น `z.null()` — ส่ง string เข้าไป
      แล้ว **ไม่ compile** (type-level) และ `parse` ไม่ผ่าน (runtime) · ฟอร์มปรับสต็อก/จ่ายออกยังทำงาน
      เหมือนเดิม (R8)
- [ ] กรอก `ref_id` ผิดในฟอร์มรับสต็อกแล้วขึ้นเป็น **ข้อความใต้ช่อง `ref_id`** ไม่ใช่ error toast —
      มี test ของ `receiveInputSchema` ที่ยืนยัน issue ออกที่ path `['ref_id']` (R9)
- [ ] ฟอร์มรับสต็อก: source `donation` มี picker + ปุ่มบริจาคหน้างานที่มินต์ donation doc จริง (D-1 ค) ·
      source `transfer_in` **ไม่ปรากฏเป็นตัวเลือก** แต่ `transfer_in`/`transfer_out` ยังอยู่ใน
      `ledgerReasonSchema` (D-3 ก) — R4
- [ ] `pnpm check` 0 error · `pnpm test` ผ่าน · `pnpm lint` ผ่าน
- [ ] ถ้าทำ R4 → `.svelte` ที่แตะผ่าน `svelte-autofixer` จน clean

## Decision log

- 2026-07-25 — **approved** · ค้นพบระหว่าง design review ของ CR-032 Option A: encoding `reason` + `ref_id`
  ถูกต้องแล้ว (pointer self-describing ผ่าน `_id` prefix, branch จริงในระบบมีที่เดียว) แต่ invariant
  ระหว่างสองฟิลด์ไม่ถูกบังคับเลย · แยกเป็น CR ใหม่แทนการขยาย CR-032 เพราะกระทบ `donation` / `transfer` /
  `requisition` / `distribute` ด้วย ไม่ใช่แค่ `purchase` และลากเรื่องช่อง `ref_id` free text ในฟอร์ม
  รับสต็อกเข้ามา · *(ตอนบันทึกยังเป็น `proposed` รอเคาะ Q-1..Q-5 — เคาะครบและเลื่อนเป็น `approved`
  เมื่อ 2026-08-14 ดู entry ท้ายไฟล์)*
- 2026-07-25 — **แก้ข้อเท็จจริง (ยังไม่ approve)** · §Impact เดิมเขียนว่า "โปรเจกต์ไม่มี
  `validate_doc_update`" ซึ่งไม่ตรงกับ code: shelter DB มี `_design/access` จาก
  `lib/server/shelter-access-design.ts` อยู่แล้ว แต่บังคับแค่ envelope + `shelter_code` + allowlist ของ
  `type` ไม่ตรวจ invariant ระดับ field · **ข้อสรุปเดิมไม่เปลี่ยน** (invariant นี้ยังเป็น client-side
  guard) แต่เปลี่ยนเหตุผลที่รองรับ และเปิด **Q-6** ว่าจะบังคับ R2 ฝั่ง server ด้วยไหม
- 2026-07-26 — **renumber CR-045 → CR-050 + กู้ไฟล์คืน** · ไฟล์เดิม `CR-045-stock-ledger-refid-invariant.md`
  ถูกลบก่อน commit (ไม่เคยอยู่ใน git history — กู้จาก dangling blob `240b58ca`) · เปลี่ยนเลขเพราะ
  **CR-045 ถูกใช้ซ้ำอยู่แล้ว 3 ไฟล์** (donation-quota-atomic-reservation / kitchen-meal-plan-workflow-rework /
  referral-full-dod-alignment) · CR-050 เป็นเลขว่างถัดไป (043 จองในดัชนีแล้ว; 048/049 ใช้บน branch อื่น)
  · **เนื้อหา/ข้อเสนอไม่เปลี่ยน** — ยังเป็น `approved` รอเคาะ Q-1..Q-6 · ripple: `_index.md` เพิ่มแถว
  CR-050, `CR-032-stock-ledger-purchase-reason.md` §Decision log แก้ลิงก์ follow-up ให้ชี้ CR-050
- 2026-08-14 — **เพิ่ม R7 + DoD 2 ข้อ (เจ้าของสั่งในรอบ review)** · ตรวจ code พบว่า kitchen `issueRequisition`
  **ไม่ได้เรียก `createStockLedger` เลย** (ประกอบ doc เองทั้งใบที่ `kitchen.remote.ts:80–94`) → R1 ที่ผูกไว้กับ
  `stockLedgerInputSchema` จะ **ครอบไม่ถึงแถว `reason:'requisition'`** ทั้งที่ `affects:` ระบุไฟล์นี้ไว้ตั้งแต่ต้น
  ว่า "ต้องผ่าน invariant" และ §Impact สั่งให้ fixture ของครัวผ่าน invariant · R3 ไม่ครอบเพราะพูดถึงเฉพาะ
  `createReceiveEntry` / `createDistributeEntry` (ซึ่งข้อความ R3 **ถูกต้อง** — สองตัวนั้นเรียกผ่านจริง)
  ⇒ **R7** ปิดช่องนี้โดยเปิด `createStockLedger(input, ctx, id?)` (= ทางเลือก **D-2 (ก)** ของ implement plan
  2026-08-01) · เป็น refactor ล้วน **ไม่เปลี่ยนรูป doc ไม่แตะ `schema_v` (คง 3) ไม่แตะ business rule/enum**
  จึงไม่เข้าเงื่อนไข `change-management.md` §2 ที่ต้องตั้ง CR ใหม่ — บันทึกเป็น requirement ใน CR เดิมพอ
  · **หมายเหตุเลขข้อ:** implement plan ฉบับ 2026-08-01 จองเลข "R7" ไว้ให้เรื่อง `adjustInputSchema.ref_id`
  → `z.null()` (ข้อ B-3 ของ plan — `createAdjustEntry` เป็น writer ตัวที่ 4 ที่ CR ไม่ได้นับ) · ข้อนั้น
  **ขึ้นเป็น R8 แทน** ตาม entry ถัดไป
- 2026-08-14 — **เพิ่ม R8 (เจ้าของเคาะต่อในรอบเดียวกัน)** · `createAdjustEntry` เป็นผู้เขียน ledger ตัวที่ 4
  ที่ R3 ไม่ได้นับ และ `adjustInputSchema.ref_id` ยังเป็น `z.string().nullable()` ส่งผ่านตรง สวนกับคอมเมนต์
  ของตัวเองที่เขียนว่า "Always null" (`operations.ts:280`) ⇒ **R8** บีบเป็น `z.null()` ให้ปฏิเสธตั้งแต่
  compile time · ตรวจ caller แล้ว **ไม่ breaking** — มีที่เดียวคือ `adjust-stock-form.svelte:204` ซึ่งส่ง
  `ref_id: null` อยู่แล้ว · เป็นการแคบชนิดของ **input schema** ไม่ใช่ของ doc ที่ persist (ค่า `ref_id` ของ
  แถว `adjust` เป็น `null` เหมือนเดิมทุกประการ) ⇒ ไม่เปลี่ยนรูป doc ไม่ bump `schema_v` (คง 3)
  · R8 ไม่แทน R1 — เป็นการกันชั้นที่สองเฉพาะ path `adjust` เท่านั้น
- 2026-08-14 — **เคาะ Q-1..Q-6 = ตามคอลัมน์ "ข้อเสนอ" ทั้งหมด** (เจ้าของโปรเจกต์) ⇒ ตาราง R2 ปิดค่าครบทุกแถว
  และ Phase domain guard เริ่มได้:
  | # | คำเคาะ | ผลต่อ implement |
  | --- | --- | --- |
  | Q-1 | (ก) `distribute` → `ref_id` **null เสมอ** | ทบทวนใหม่เมื่อ CR-059 (Active Batch) ลง — ต้อง ripple สองทาง |
  | Q-2 | (ข) คง `receive` ใน enum + บังคับ `null` | seed 8 แถวพึ่งค่านี้ (`seed.ts:1137–1153`, `:1304`) — ถ้ากลับคำตอบต้องแก้ seed |
  | Q-3 | (ก) **ไม่ bump** `schema_v` (คง 3) | ไม่มี backfill · เติมบรรทัด Migration ใน schema.md §2.1 ว่าค่าที่ยอมรับ**ตอนเขียน**แคบลง |
  | Q-4 | บังคับมี audit script + ผลก่อน merge | ตรวจแล้ว seed ผ่าน invariant ทุกแถว → ฐาน dev ควรได้ 0 |
  | Q-5 | (ก) รวม R4 (picker) ไว้ใน CR นี้ | ยังต้องเคาะต่อว่า source `donation` / `transfer_in` เอายังไง (ดู entry ถัดไป) |
  | Q-6 | (ก) ปิดที่ Zod เท่านั้น ไม่แตะ `validate_doc_update` | **แต่เหตุผลที่ §Impact ใช้รองรับข้อนี้คลาดเคลื่อน** — ดูหมายเหตุล่าง |

  ⚠️ **ข้อเท็จจริงใน §Impact ที่ต้องแก้ (ยังไม่แก้ รอเจ้าของสั่ง):** §Impact เขียนว่า `_design/access` บังคับแค่
  envelope + `shelter_code` + allowlist ของ `type` และ "**ไม่ตรวจ invariant ระดับ field เลย**" — ไม่ตรงกับ
  `shelter-access-design.ts:94–113` ซึ่ง **มีกฎเฉพาะชนิด doc อยู่แล้ว 3 ข้อ**: append-only ของ `stock_ledger`,
  `donation.status` ห้ามถอยกลับเป็น `declared` (นี่คือ invariant ระดับ field), และ **role gate เฉพาะ
  `stock_ledger`** (`if (newDoc.type === 'stock_ledger')`) · **คำเคาะ Q-6 (ก) ไม่เปลี่ยน** (การเพิ่มกฎยังต้อง
  redeploy `_design/access` ทุก shelter DB = คนละความเสี่ยง) แต่ต้นทุนจริงต่ำกว่าที่ CR ประเมิน เพราะมี branch
  ของ `stock_ledger` ให้ต่อยอดอยู่แล้ว · เพิ่มเติม: `_admin` bypass (`:59`) ⇒ back-office intake route และ
  `seed.ts` ที่เขียนด้วย admin cred **ไม่ผ่าน guard นี้อยู่แล้ว** ไม่ว่าจะเพิ่มกฎหรือไม่
- 2026-08-14 — **เคาะ D-1 / D-3 + เพิ่ม R9 + ขยาย R8 + แก้ข้อเท็จจริง §Impact** (เจ้าของโปรเจกต์) ·
  ปิด gate ที่เหลือทั้งหมด — CR นี้ไม่มีข้อค้างที่ต้องเคาะอีก:
  - **D-1 = (ค)** picker + ปุ่มบริจาคหน้างาน (`createWalkInDonation`) · เขียนลง **R4** · เหตุผล: donation doc
    วันนี้เกิดจาก public portal เท่านั้น ถ้าใช้ picker เปล่า ๆ จะรับของ walk-in ไม่ได้ และถ้าตัด source
    `donation` ทิ้งไปใช้ scan-station ทางเดียวก็เสียเส้นทางที่เขียนผ่าน CouchDB ตรง
  - **D-3 = (ก)** ซ่อน option `transfer_in` ในฟอร์ม แต่คงไว้ใน `ledgerReasonSchema` · เขียนลง **R4** ·
    เหตุผล: `stock_transfer` ยังไม่มีในโค้ด (0 hit) — ถ้าคง option ไว้ ผู้ใช้จะ submit ไม่ผ่านตลอดกาล
  - **R8 ขยาย** ให้ครอบ `distributeInputSchema.ref_id` ด้วย — Q-1 (ก) เคาะว่า `distribute` ต้อง null เสมอ
    แต่ schema ยังรับ string ทั้งที่ฟอร์มไม่มีช่องนี้ ⇒ dead field ที่เปิดรูไว้ (คลาสเดียวกับ `adjust`)
  - **R9 ใหม่** — `receiveInputSchema` ต้อง refine ด้วย เพื่อให้ invariant ขึ้นเป็น **field error**
    ตรวจแล้วว่าไม่มีฟอร์มไหนส่ง `stockLedgerInputSchema` เข้า `zod4()` เลย ⇒ ถ้าไม่ทำ ผู้ใช้จะเจอ
    error toast ตอน mutation แทนข้อความใต้ช่อง · **ผลพลอยได้:** ความเสี่ยง "superRefine ทำ superforms
    adapter สะดุด" ที่เคยประเมินไว้สูงสุด **ตกไป** เพราะ R1 ไม่ได้แตะ schema ที่ฟอร์มใช้
  - **§Impact แก้ข้อเท็จจริง** เรื่อง `validate_doc_update` (ดูหัวข้อนั้น) — คำเคาะ Q-6 (ก) คงเดิม
- 2026-08-14 — **เก็บ trace การ renumber ให้ครบ: `CR-045 → CR-050 → CR-055`** · entry 2026-07-26 เล่าถึงแค่
  รอบแรก (045 → 050) · รอบสอง (050 → 055) เกิดที่ commit `34960e75` เพราะ **CR-050 ถูกใช้ซ้ำ** โดย
  `CR-050-evacuee-special-needs-freeform-reconcile.md` ซึ่งเป็นคนละเรื่องสนิท · ripple ที่ตามมาแก้ในรอบนี้:
  `CR-032-stock-ledger-purchase-reason.md` §Decision log ลิงก์ไป `CR-050-stock-ledger-refid-invariant.md`
  ที่ **ไม่มีไฟล์นั้นอยู่แล้ว** → แก้ให้ชี้ `CR-055-stock-ledger-refid-invariant.md`
  · **ยังค้าง:** Q-1..Q-6 ไม่มีบรรทัดใดบันทึกคำตอบ — entry 2026-07-25 ยังปิดท้ายว่า "ยังไม่ approve — รอเคาะ
  Q-1..Q-5" สวนกับ `status: approved` ที่หัวไฟล์ · R7 implement ได้โดยไม่ต้องรอ Q ข้อไหน แต่ R1/R2 ยังรอ Q-1/Q-2
