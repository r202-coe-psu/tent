---
id: CR-055
title: "Enforce reason ↔ ref_id invariant on stock_ledger"
status: approved
date: 2026-07-25
updated: 2026-07-26
requested_by: project owner (design review ของ CR-032 Option A)
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §2.1 (นิยาม `ref_id` — จากคำอธิบายลอย เป็นตาราง mapping ที่บังคับใช้ได้)
  - schema_v stock_ledger — เสนอ **ไม่ bump** (ไม่เปลี่ยนรูป doc) · ต้องเคาะ Q-3
  - frontend/src/lib/features/operations/domain/operations.ts (`stockLedgerInputSchema`, `receiveInputSchema`, `distributeInputSchema`)
  - frontend/src/lib/features/operations/domain/operations.test.ts
  - frontend/src/lib/features/operations/ui/ReceiveStockForm.svelte (ช่อง `ref_id` free text → R4)
  - frontend/src/lib/features/kitchen/data/kitchen.remote.ts + kitchen.remote.test.ts (ผู้เขียน ledger อีกจุด — ต้องผ่าน invariant)
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
- **R4** — `ReceiveStockForm` ต้องเลิกให้ผู้ใช้พิมพ์ `ref_id` เป็น free text → เปลี่ยนเป็น **picker ที่
  เลือกจาก doc จริง** (donation ที่ยังไม่ถูก key / `stock_transfer` ที่รอรับ) และเมื่อ source = `manual`
  ต้องไม่มีช่องนี้เลย
- **R5** — invariant บังคับ **ตอนเขียน** เท่านั้น. path การอ่าน (`stockBalance`, `LedgerTable`,
  `calculateReserved`) ต้องยังอ่านแถวเก่าที่ละเมิดได้โดยไม่ throw — ห้ามทำให้ข้อมูลเดิมพังแอป
- **R6** — test ครอบทุกแถวของตาราง R2 ทั้งฝั่ง accept และ reject; fixture เดิมใน
  `operations.remote.test.ts` / `kitchen.remote.test.ts` ต้องผ่าน invariant

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

## Open questions (ต้องเคาะก่อน approve)

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
  `routes/api/back-office/shelter/+server.ts` · redeploy ผ่าน `lib/server/shelters.admin.ts`) แต่บังคับแค่
  **envelope ตาม schema.md §0** (`type` / `schema_v` / `shelter_code` / `created_at` / `updated_at` /
  `created_by` ต้องมี), **`shelter_code` ต้องตรงกับ db** และ **allowlist ของ `type`** — **ไม่ตรวจ invariant
  ระดับ field เลย** จึงไม่กัน `reason` ↔ `ref_id` ให้
  ⇒ invariant ของ CR นี้เป็น **domain guard ฝั่ง client เท่านั้น** · เอกสาร/PR ห้ามเคลมเกินนี้
  (ยิ่งกว่านั้น `frontend/scripts/seed.ts` deploy `_design/access` ให้แค่ **catalog DB** ไม่ deploy ให้
  shelter DB → ฐาน dev ที่ seed มาไม่มี guard ฝั่ง server เลยแม้แต่ envelope)
  ถ้าต้องการกันที่ระดับ CouchDB จริงต้องขยาย `buildValidateDocUpdate` — **ไม่อยู่ในขอบเขต CR นี้** ดู Q-6

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
- [ ] `pnpm check` 0 error · `pnpm test` ผ่าน · `pnpm lint` ผ่าน
- [ ] ถ้าทำ R4 → `.svelte` ที่แตะผ่าน `svelte-autofixer` จน clean

## Decision log

- 2026-07-25 — **proposed** · ค้นพบระหว่าง design review ของ CR-032 Option A: encoding `reason` + `ref_id`
  ถูกต้องแล้ว (pointer self-describing ผ่าน `_id` prefix, branch จริงในระบบมีที่เดียว) แต่ invariant
  ระหว่างสองฟิลด์ไม่ถูกบังคับเลย · แยกเป็น CR ใหม่แทนการขยาย CR-032 เพราะกระทบ `donation` / `transfer` /
  `requisition` / `distribute` ด้วย ไม่ใช่แค่ `purchase` และลากเรื่องช่อง `ref_id` free text ในฟอร์ม
  รับสต็อกเข้ามา · **ยังไม่ approve — รอเคาะ Q-1..Q-5**
- 2026-07-25 — **แก้ข้อเท็จจริง (ยังไม่ approve)** · §Impact เดิมเขียนว่า "โปรเจกต์ไม่มี
  `validate_doc_update`" ซึ่งไม่ตรงกับ code: shelter DB มี `_design/access` จาก
  `lib/server/shelter-access-design.ts` อยู่แล้ว แต่บังคับแค่ envelope + `shelter_code` + allowlist ของ
  `type` ไม่ตรวจ invariant ระดับ field · **ข้อสรุปเดิมไม่เปลี่ยน** (invariant นี้ยังเป็น client-side
  guard) แต่เปลี่ยนเหตุผลที่รองรับ และเปิด **Q-6** ว่าจะบังคับ R2 ฝั่ง server ด้วยไหม
- 2026-07-26 — **renumber CR-045 → CR-050 + กู้ไฟล์คืน** · ไฟล์เดิม `CR-045-stock-ledger-refid-invariant.md`
  ถูกลบก่อน commit (ไม่เคยอยู่ใน git history — กู้จาก dangling blob `240b58ca`) · เปลี่ยนเลขเพราะ
  **CR-045 ถูกใช้ซ้ำอยู่แล้ว 3 ไฟล์** (donation-quota-atomic-reservation / kitchen-meal-plan-workflow-rework /
  referral-full-dod-alignment) · CR-050 เป็นเลขว่างถัดไป (043 จองในดัชนีแล้ว; 048/049 ใช้บน branch อื่น)
  · **เนื้อหา/ข้อเสนอไม่เปลี่ยน** — ยังเป็น `proposed` รอเคาะ Q-1..Q-6 · ripple: `_index.md` เพิ่มแถว
  CR-050, `CR-032-stock-ledger-purchase-reason.md` §Decision log แก้ลิงก์ follow-up ให้ชี้ CR-050
