---
id: draft
title: แก้ไขเพิ่มเติม CR-055 — ขยายตาราง Reason และ Invariant ของ StockLedger รองรับระบบตั๋ว ครัว และการคืนพัสดุ
status: proposed
date: 2026-09-13
requested_by: Extended Distribution Architecture Working Group
decided_by: <รออนุมัติจาก Project Owner>
layer: volatile
affects:
  - docs/data/schema.md §2.1 (`stock_ledger` — ตาราง `reason` → `ref_id` และ enum ของเหตุผล)
  - docs/changes/CR-055-stock-ledger-refid-invariant.md (AMENDED BY draft-stock-ledger-reasons-cr055-amendment)
  - frontend/src/lib/features/operations/domain/operations.ts (`REF_PREFIX_BY_REASON`, `stockLedgerReasonSchema`, `stockLedgerInputSchema`)
  - frontend/src/lib/server/shelter-access-design.ts (CouchDB VDU `_design/access`)
---

# draft-stock-ledger-reasons-cr055-amendment — แก้ไขเพิ่มเติม CR-055: ขยายตาราง Reason และ Invariant ของ StockLedger

> [!NOTE]
> **สรุป (TL;DR):**
> แก้ไขเพิ่มเติม [CR-055](CR-055-stock-ledger-refid-invariant.md) โดยคงตาราง Reason และ Invariant เดิมของ `stock_ledger` ไว้ทั้งหมด 100% และเพิ่มเหตุผลเฉพาะทางใหม่ 5 รายการ (`ticket_dispatch`, `kitchen_yield`, `loan_return`, `fulfillment_return`, `loan_bulk_return`) เพื่อรองรับการตัดจ่ายพัสดุตามตั๋ว การรับผลผลิตอาหารปรุงสุกเข้าสต็อก การคืนพัสดุรายบุคคล และการส่งคืนพัสดุรวมเข้าคลัง โดยไม่มีการใช้เหตุผลเดิมซ้ำหรือโอเวอร์โหลด (No Re-purposing/Overloading) และห้ามใช้ `adjust` กับกระบวนการปกติ

---

## 1. Why (เหตุผลและความเป็นมา)

ใน [CR-055](CR-055-stock-ledger-refid-invariant.md) ได้มีการกำหนดตารางความสัมพันธ์ระหว่าง `reason` และ `ref_id` ของบัญชีคุมสต็อก (`stock_ledger`) ไว้อย่างเข้มงวด เพื่อป้องกันความผิดพลาดระดับโครงสร้างข้อมูลและรักษาความถูกต้องของการตรวจสอบย้อนกลับ (Referential Audit Integrity).

เมื่อมีการพัฒนาระบบตั๋วเบิกจ่ายรวมศูนย์ (Unified Tickets), ครัวกลาง (Kitchen Yield), และระบบยืม-คืนพัสดุ (Supply Loan & Dropoff) ตาม CR-059 Extended:
1. หากนำเหตุผลเดิม เช่น `distribute` หรือ `receive` มาชี้ไปยังเอกสารตั๋ว จะทำให้เกิดความสับสนกับ Flow 2 เดิมที่ผูกกับ `distribution_batch`
2. การใช้ `adjust` สำหรับการรับคืนพัสดุจากการจัดส่งที่ถูกปฏิเสธ จะทำลายประวัติการตรวจสอบย้อนกลับ
3. การใช้ `ticket_dispatch` เป็นค่าบวกสำหรับขากลับ จะทำให้เกิดความกำกวมในทิศทางการเคลื่อนไหวของสต็อก

ดังนั้น โครงการจึงมีมติให้ขยายเหตุผลใหม่อย่างอนุรักษนิยม (Conservative Extension) 5 รายการที่มีความหมายชัดเจน ทิศทางเดียว (Unidirectional) และระบุเอกสารต้นทางที่ถูกต้อง

---

## 2. ขยายตาราง Reason และ Prefix ของ ref_id

### ตาราง Reason เดิม (คงไว้ 100% ตาม CR-055)

| `reason` | `ref_id` ต้องเป็น | ทิศทาง (Sign) | ที่มา (ผู้เขียน) |
| :--- | :--- | :--- | :--- |
| `donation` | `donation:{ulid}` — req | บวก (+) | `keyDonationReceipt` |
| `purchase` | `purchase:{ulid}` — req | บวก (+) | `keyPurchaseReceipt` (CR-032) |
| `requisition` | `kitchen_requisition:{ulid}` — req | ลบ (-) | kitchen `issueRequisition` |
| `transfer_in` | `stock_transfer:{ulid}` — req | บวก (+) | transition ของ T-13 |
| `transfer_out` | `stock_transfer:{ulid}` — req | ลบ (-) | transition ของ T-13 |
| `adjust` | `null` เสมอ | บวก (+) หรือ ลบ (-) | การปรับปรุงสต็อกทางกายภาพที่ไม่มีเอกสารต้นทาง |
| `distribute` | `distribution_batch:{request_ulid}` — req | ลบ (-) | Flow 2 เดิม: จ่ายออกจาก batch (ต้องการ `lot_ref`) |
| `distribution_return` | `distribution_batch:{request_ulid}` — req | บวก (+) | Flow 2 เดิม: คืนของเหลือจาก batch กลับเข้าล็อต |
| `receive` | `null` เสมอ | บวก (+) | ค่าประวัติศาสตร์คงไว้ใน enum (ห้ามเขียนใหม่) |

### เหตุผลที่เพิ่มใหม่ 5 รายการ (Proposed Extensions)

| `reason` | `ref_id` ต้องเป็น | ทิศทาง (Sign) | ข้อกำหนดล็อต (`lot_ref`) | คำอธิบายและวัตถุประสงค์ |
| :--- | :--- | :--- | :--- | :--- |
| **`ticket_dispatch`** | `requisition_fulfillment:{ulid}` — req | **ลบ (-) เสมอ** | บังคับเมื่อสินค้านั้นมี `lot_ref` | การตัดจ่ายพัสดุ/อาหารออกจากคลังตามใบจัดส่งของตั๋วเบิกจ่าย |
| **`kitchen_yield`** | `meal_service:{ulid}` — req | **บวก (+) เสมอ** | self-reference `_id` ของแถวนี้ | การรับอาหารปรุงสุกเข้าสต็อกคลังเพื่อรอแจกจ่าย |
| **`loan_return`** | `distribution_log:{ulid}` — req | **บวก (+) เสมอ** | บังคับเมื่อเป็นสินค้าที่มีล็อต (lot-managed); ไม่บังคับหากไม่มีล็อต | การรับคืนพัสดุยืมรายบุคคลที่นำส่งกลับเข้าคลังพัสดุโดยตรง (คงประวัติ physical lot) |
| **`fulfillment_return`** | `requisition_fulfillment:{ulid}` — req | **บวก (+) เสมอ** | บังคับเมื่อสินค้านั้นมี `lot_ref` | การรับคืนพัสดุที่ถูกปฏิเสธหรือยกเลิกการจัดส่งกลับเข้าคลัง |
| **`loan_bulk_return`** | `loan_dropoff_batch:{ulid}` — req | **บวก (+) เสมอ** | บังคับเมื่อเป็นสินค้าที่มีล็อต (lot-managed); ไม่บังคับหากไม่มีล็อต | การรับคืนพัสดุที่รวบรวมจากจุดคืนรวม (Dropoff Bin) เข้าคลังพัสดุ |

---

## 3. Invariants และกฎเหล็กทางสถาปัตยกรรม (Stock Ledger Invariants)

1. **`ticket_dispatch` ต้องเป็นขาออกเท่านั้น (Outbound Only):**
   - ห้ามบันทึก `ticket_dispatch` ด้วยจำนวนที่เป็นบวกเด็ดขาด
   - หากมีการยกเลิกหรือคืนพัสดุจาก fulfillment ต้องบันทึกด้วย `fulfillment_return`
2. **ห้ามใช้ `adjust` กับกระบวนการปกติ:**
   - การรับพัสดุคืนจากการส่งมอบที่ล้มเหลวหรือถูกปฏิเสธ ต้องใช้ `fulfillment_return` ห้ามใช้ `adjust` เพื่อคงความถูกต้องของการสืบย้อน (Audit Trail)
3. **การคืนของหน้างานไม่มีผลต่อสต็อกคลัง (Frontline Return != Warehouse Restock):**
   - การที่ผู้ประสบภัยนำของมาส่งคืนที่เต็นท์แจกจ่าย เคาน์เตอร์ หรือประตูหน้าศูนย์ ไม่มีการบันทึก StockLedger ใด ๆ
   - สต็อกคลังจะเพิ่มขึ้นก็ต่อเมื่อสิ่งของนั้นได้รับการตรวจรับเข้าคลังพัสดุจริง (Physical Warehouse Restock) เท่านั้น
4. **ความเสียหายระหว่างขนส่งห้ามหักสต็อกซ้ำ (No Double Deduction for Damage):**
   - การตัดสต็อกคลังเกิดขึ้นตอน dispatch ครั้งเดียว (เช่น -100)
   - หากสินค้าเสียหายระหว่างทาง 5 ชิ้น และปลายทางรับจริง 95 ชิ้น ให้บันทึกเหตุการณ์ความเสียหายใน fulfillment แต่**ห้ามเขียนหักสต็อกคลังซ้ำอีก -5 เด็ดขาด** (มิฉะนั้นจะกลายเป็น -105)
5. **การรับคืนแบบถังรวมนับสต็อกครั้งเดียว (Bulk Dropoff Once-Only Invariant):**
   - เมื่อนำถังคืนพัสดุเข้าคลัง สต็อกจะเพิ่มขึ้นผ่าน `loan_bulk_return` ตามจำนวนของจริงครั้งเดียว
   - การจับคู่ย้อนหลังกับสัญญาผู้ยืมในภายหลัง เป็นเพียงการบันทึกประวัติการปลดภาระหนี้ใน `DistributionLog` **โดยห้ามเขียน StockLedger เพิ่มเติมอีก**
6. **การระบุตัวตนของผลผลิตครัว (Kitchen Yield Deterministic Identity):**
   - การสร้างประวัติสต็อกอาหารปรุงสุก ใช้รหัสเอกสารแบบกำหนดได้ (Deterministic Ledger ID):
     `stock_ledger:kitchen_yield:{meal_service_id}:{yield_line_id}`
   - ห้ามใช้ `recipe_id` หรือ `lot_no` ในการประกอบรหัสตัวตนเด็ดขาด
7. **Exactly-Once Retry Verification:**
   - การบันทึกสต็อกทุกจุดต้องสร้างรหัสแบบ deterministic หรือส่ง idempotency token
   - หากการส่งข้อมูลขัดข้องทางเครือข่ายแล้วไคลเอนต์ retry เมื่อพบข้อผิดพลาด 409 Conflict ระบบต้องตรวจสอบว่าเอกสารที่มีอยู่เดิมมีความสอดคล้องเชิงความหมาย (Semantic Equivalence) หรือไม่ หากตรงกันให้ถือว่าสำเร็จและคืนผลลัพธ์เดิม ห้ามถือว่า 409 สำเร็จโดยไม่ตรวจความสอดคล้อง

---

## 4. ผลกระทบต่อสกีมาและการเขียนโปรแกรม (Impact)

- **`docs/data/schema.md` §2.1:** ปรับปรุงตาราง Reason และเพิ่มคำอธิบายของทั้ง 5 เหตุผลใหม่
- **`operations.ts`:**
  - อัปเดต `stockLedgerReasonSchema` รองรับ enum ทั้ง 14 ค่า
  - ขยาย `REF_PREFIX_BY_REASON`:
    ```ts
    export const REF_PREFIX_BY_REASON = {
      // เดิม
      donation: 'donation:',
      purchase: 'purchase:',
      requisition: 'kitchen_requisition:',
      transfer_in: 'stock_transfer:',
      transfer_out: 'stock_transfer:',
      distribute: 'distribution_batch:',
      distribution_return: 'distribution_batch:',
      adjust: null,
      receive: null,
      // ใหม่ (draft-stock-ledger-reasons-cr055-amendment)
      ticket_dispatch: 'requisition_fulfillment:',
      kitchen_yield: 'meal_service:',
      loan_return: 'distribution_log:',
      fulfillment_return: 'requisition_fulfillment:',
      loan_bulk_return: 'loan_dropoff_batch:',
    } as const;
    ```
  - อัปเดต `superRefine` ตรวจสอบเครื่องหมาย (+/-) และความสัมพันธ์ของ `lot_ref`

---

## 5. การอพยพข้อมูลและความเข้ากันได้ (Migration & Compatibility)

- **`schema_v`:** คงไว้ที่ **`schema_v: 4`** เท่าเดิม (ไม่เปลี่ยนโครงสร้างฟิลด์ เป็นเพียงการเพิ่มค่า enum ที่ยอมรับตามแนวทาง CR-055 และ CR-032)
- **ข้อมูลเดิม:** ข้อมูลแถวในอดีตไม่มีผลกระทบใด ๆ และยังคงอ่านได้ตามปกติ
- **ความเข้ากันได้:** ระบบเดิมที่อ่านเฉพาะ reason เดิมจะไม่พบข้อผิดพลาด หากมีตัวกรองเฉพาะทางให้เพิ่มเหตุผลใหม่เข้าไปในรายงานที่เกี่ยวข้อง

---

## 6. บันทึกการตัดสินใจ (Decision Log)

- **2026-09-13:** จัดทำข้อเสนอ draft-stock-ledger-reasons-cr055-amendment เพื่อ formalize มติสถาปัตยกรรมที่ผ่าน Design Gate Phase 2C (P0=0, P1=0, P2=0, P3=0)
