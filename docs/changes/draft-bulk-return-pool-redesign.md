---
id: draft # CR-TBD — PM/lead กำหนดเลข CR และวิธี track ตอน approve (ยังไม่ใส่ใน _index.md)
title: CR-TBD — ออกแบบ bulk_return_pool ใหม่เป็น "กองรวมตอนรับของคืน" (pool header + entry/move event log)
status: proposed
date: 2026-10-22
requested_by: feedback ระบบคลัง & เบิกของ ข้อ 4–5 (GitHub #657, #658)
decided_by: project owner
layer: stable
affects:
  - docs/changes/03-C-supply/CR-134-bulk-return-claim-recovery.md (amended — pool v2 / claim flow / ข้อห้าม stock_ledger ตอนสร้าง pool)
  - docs/changes/03-C-supply/CR-121-spec-ticket.md §3.8 (อาจต้องแก้ — ขึ้นกับคำตอบเรื่อง `return_ticket_id` และ deploy ordering)
  - docs/data/schema.md §2.31 (bulk_return_pool schema_v 2 → 3), §2.31.1 / §2.31.2 (ใหม่), §2.32 (legacy), §7
  - schema_v — bulk_return_pool 2 → 3; doc type ใหม่ bulk_return_entry v1 และ bulk_return_entry_move v1 (append-only)
  - frontend/src/lib/server/shelter-access-design.ts (VDU + Mango index `BULK_RETURN_ENTRY_MANGO_INDEXES`)
  - frontend/src/lib/features/shelters/domain/views.ts + view-manifest.ts (view `bulk_return_pool_item_totals`, `_design/app` v4)
  - frontend/src/lib/server/shelters.admin.ts / shelters/server/provisioner.ts / scripts/redeploy-access.ts / scripts/seed/registry-shelters.ts (deploy index)
  - frontend/src/lib/features/distribution/domain/food-supplies (bulk-return-pool / entry / entry-move)
---

# CR-TBD — ออกแบบ bulk_return_pool ใหม่เป็นกองรวมตอนรับของคืน

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** `bulk_return_pool` เปลี่ยนจาก "โควตา aggregate ต่อ item ที่เปิดหลังรับของเข้าคลัง"
>   เป็น "กองรวมที่เปิดไว้ก่อน แล้วค่อยบันทึกของที่รับคืนเป็นรายการ (entry) เข้ากอง" —
>   pool เป็น header เล็ก ๆ (`name`, `status: OPEN | SUBMITTED | RECEIVED`), entry และการย้าย (move)
>   เป็น event doc แบบ append-only, สรุปยอดต่อ `item_id` (`items_summary`) ถูก snapshot ลง pool ตอน submit
> - **เอกสารใหม่:** `bulk_return_pool` schema_v **3**, `bulk_return_entry` v1, `bulk_return_entry_move` v1
>   - Mango index `(type, pool_id)` + view `bulk_return_pool_item_totals` (`_sum`)
> - **ผลข้างเคียงที่ต้องตัดสินใจ:** เมื่อ deploy แล้ว VDU **ปฏิเสธ** flow เดิม (สร้าง pool v2 / claim quota) จนกว่า
>   #659/#660 จะ ship — ต้องกำหนดลำดับ deploy (ดู Rollout)
> - **implement แล้ว รอยืนยัน:** แก้ `name` / `location` ได้ระหว่าง `OPEN`, ล็อกเมื่อ `SUBMITTED`
> - **ข้อเสนอตามแบบแผนเดิม รอยืนยัน:** ลบกอง (ใช้สถานะปลายทาง `CANCELLED` แทนการลบ), entry/move ที่มาช้าหลัง lock
>   (fence ก่อนอัปเดต loan ตามแบบ `fenceReturnReservation`)
> - **ยังไม่สรุป:** void entry, role ต่อ transition, `return_ticket_id`, `location` (free text หรือ storage point),
>   ชื่อกองซ้ำ, การ encode "ไม่ระบุผู้คืน", ฝั่ง loan, ผลรวม `loan_refs` (= หรือ ≤), ผู้คืนที่ไม่มี loan ค้าง,
>   `condition_on_return` (ดู Open questions) — CR นี้**ไม่ encode** ข้อใดข้อหนึ่งจนกว่า owner ตอบ
> - **ยืนยันตามแบบแผนเดิม:** จำนวนเต็มเท่านั้น (ดู Amends)
> - **งาน implement ที่ยังค้างใน #658 (ไม่ใช่คำถามออกแบบ):** จำกัด item ที่รับเข้ากองด้วย field catalog เดิม
>   `returnable` / `type_class` — โค้ดใหม่ยังไม่ได้บังคับ (ดู Amends)
> - **อ้างอิง:** [#657](https://github.com/r202-coe-psu/tent/issues/657) (epic),
>   [#658](https://github.com/r202-coe-psu/tent/issues/658) (domain + VDU + view/index; งานนี้)

---

## Context

feedback ระบบคลัง & เบิกของ ข้อ 4–5: ของยืมที่ผู้ประสบภัย/จิตอาสานำมาคืนรวมกัน ต้องรับเข้ากองก่อน
(ยังไม่รู้ว่าเป็นของใคร) แล้วค่อยจับคู่กับรายการยืมทีหลัง — flow ปัจจุบันบังคับให้คลังรู้ยอดรวมและ item เดียว
ก่อนเปิด pool

| มิติ        | flow ปัจจุบัน (CR-121 / CR-134)                                                                                  | flow ใหม่ (epic #657)                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| เปิด pool   | หลังตรวจนับของ — ต้องมี `item_id`, `total_received_qty`, `stock_ledger_id` (receive ledger เขียนพร้อมสร้าง pool) | เปิดก่อน มีแค่ `name` (+ `location?`) สถานะ `OPEN` ไม่มียอด                     |
| เนื้อหา     | 1 pool = 1 item, ยอดรวมตัวเดียว                                                                                  | หลาย item — บันทึกเป็น entry ต่อครั้งที่รับ (item, qty, ผู้คืน, loan ที่ปิด/ลด) |
| การใช้ pool | ด่าน Check-out ตัด `unclaimed_quota` ผ่าน `bulk_return_claim` (CAS ต่อ log)                                      | entry ผูก `loan_refs[]`; ย้าย entry ข้าม pool ได้ขณะ `OPEN`                     |
| ปิดงาน      | `ACTIVE → EXHAUSTED/CLOSED`                                                                                      | `OPEN → SUBMITTED` (แนบ `return_ticket_id`) `→ RECEIVED`                        |
| สรุปยอด     | `total_received_qty` ตัวเลขเดียว                                                                                 | `items_summary` ต่อ `item_id` (snapshot ตอน submit)                             |

## Why

- ของคืนจริงมาเป็นกอง หลาย item หลายคน — โมเดล "quota ต่อ item" บังคับให้รู้ผลก่อนเริ่มรับ
- โมเดลเดิมต้องมีเอกสารประสานงานต่อ log (`bulk_return_claim`) และ CAS บน pool เดียวเพื่อกัน
  double-decrement — เมื่อ entry เป็น append-only event ที่มี id deterministic ปัญหา double-count
  หายไปที่ระดับโครงสร้าง ไม่ต้องใช้ counter ที่ต้องแข่ง CAS
- CouchDB ไม่มี cross-document transaction — ต้องออกแบบให้ทุกการเขียนเป็นเอกสารเดี่ยวที่ retry ซ้ำได้
  (idempotent) และ fold สถานะจาก event log

## Change

**Before** — `bulk_return_pool` v2: `item_id`, `stock_ledger_id`, `total_received_qty`, `claimed_qty`,
`unclaimed_quota`, `claim_ids[]`, `status ACTIVE | EXHAUSTED | CLOSED`; ปลดภาระของยืมผ่าน
`bulk_return_claim:{distributionLogUlid}` (4-state machine) + CAS ตัดโควตา pool

**After** — **DECIDED** (D1–D5, ตัดสินโดย project owner):

### D1 — pool header + event log append-only + snapshot + lock

- `bulk_return_pool:{ULID}` (schema_v 3) เป็น header ที่ mutable เล็ก ๆ: `name`, `location?`, `status`,
  `lock?`, `items_summary?` (snapshot), `submitted_at/by?`, `return_ticket_id?`, `notes?`
- entry (`bulk_return_entry:{ULID}`) และ move (`bulk_return_entry_move:{entryULID}:{seq}`) เป็น **event doc
  append-only** — ไม่ update ไม่ delete (VDU บังคับ). **การย้าย = เขียน move doc ใหม่ ไม่แก้ entry doc**
- `items_summary` (`[{ item_id, qty }]`) เขียนลง pool ตอน `OPEN → SUBMITTED` และ immutable หลังจากนั้น;
  ไม่มี `total_received_qty` ตอนเปิด pool
- **lock / fence:** `lock = { op: 'SUBMIT' | 'DELETE', op_id, locked_at, locked_by } | null` บน pool —
  ตั้งได้เฉพาะตอน `OPEN`

**Advisory lock protocol** (VDU อ่านเอกสารอื่นไม่ได้ จึงเป็น advisory ที่ฝั่ง application):

1. ผู้จะ submit/delete ตั้ง `lock` ผ่าน CAS บน pool (`_rev`) — แพ้ CAS = มีคนอื่นถือ lock
2. อ่านยอดจาก view `bulk_return_pool_item_totals` (group_level 1 → จำนวน entry; 2 → ต่อ item)
3. snapshot → เขียน `items_summary` + `status: SUBMITTED` + ล้าง `lock` ใน update เดียว (submit) /
   ตรวจ "ว่าง" แล้วดำเนินการลบ (delete — พฤติกรรมหลังลบ ดูหัวข้อลบกอง)
4. ผู้เขียน entry/move **ต้องเรียก `canAppendToPool(pool)`** (`status === 'OPEN'` และไม่มี `lock`)
   ก่อนเขียน — เป็น advisory ไม่ใช่ guarantee (ช่องโหว่ ดูหัวข้อ entry/move ที่มาช้าหลังล็อก)

### D2 — `loan_refs[]` และลำดับการเขียน

- entry เก็บ `loan_refs: [{ distribution_log_id, qty }]` (ว่างได้) — ผูกกับรายการยืมที่ปิด/ลดจากการคืนครั้งนั้น
- ลำดับเขียน (สำหรับ workflow #659): **entry ก่อน แล้วค่อย `distribution_log`** — entry `_id` ใช้ ULID ของ
  operation ของผู้เรียก (deterministic) และ `distribution_log` update ก็ deterministic ต่อ entry →
  retry ซ้ำไม่ทำให้เกิดแถวซ้ำ หาก crash หลังเขียน entry ก่อนอัปเดต loan → replay เดินต่อจาก entry ที่มีอยู่
  (รายละเอียด marker บน loan ดูหัวข้อฝั่ง loan)
- invariant ที่ enforce ได้ระดับเอกสาร: `distribution_log_id` ไม่ซ้ำใน array; `sum(loan_refs.qty) ≤ entry.qty`
  (= หรือ ≤ ดูหัวข้อผลรวม `loan_refs.qty` — enforce เฉพาะ ≤ ซึ่งจำเป็นเชิงตรรกะ)

### D3 — ย้ายทั้ง entry เท่านั้น และไม่แตะ loan

- ไม่มีการย้ายบางส่วนของ qty; move doc คัดลอก `item_id`, `qty` จาก entry (ให้ view `_sum` ใช้งานได้)
- การย้ายไม่แตะ `distribution_log` เลย
- **id scheme:** `bulk_return_entry_move:{entryULID}:{seq}` โดย `seq` = เลขลำดับการย้ายของ entry นั้น
  (1-based, zero-pad 4 หลักให้เรียงตาม `_id` ได้) → การย้ายครั้งที่ n ของ entry เดียวกันสองคำสั่งพร้อมกัน
  จะเขียน `_id` เดียวกัน → **ตัวที่สองชน HTTP 409 แทนที่จะนับซ้ำ** (ไม่มี counter ให้ double-decrement);
  ผู้แพ้ต้องอ่านสถานะใหม่ (fold) แล้วตัดสินใจเอง
- VDU ตรวจไม่ได้ว่า `from_pool_id` = pool ปัจจุบันของ entry หรือ pool ปลายทาง `OPEN` — เป็นหน้าที่ของ
  domain fold (`resolveEntryPool`) + advisory `canAppendToPool`

### D4 — type เดิม, schema_v 3, v1/v2 frozen

- คง `type: 'bulk_return_pool'` — doc ใหม่เป็น `schema_v: 3`; entry/move เริ่ม v1
- pool v1/v2 ที่มีอยู่ **frozen ตอน deploy**: อ่านได้ แต่ VDU ปฏิเสธทุก update; ไม่ migrate; #661 ลบทิ้ง
- `validate_doc_update` ship ใน #658
- **ผลที่ตามมาของ D4 (ต้องตัดสินลำดับ deploy):** เมื่อ VDU ใหม่ถูก redeploy บน shelter DB
  - สร้าง pool v1/v2 ใหม่ → **ถูกปฏิเสธ** (create ต้อง schema_v 3)
  - claim quota (`bulk_return_claim` → CAS ตัดโควตา pool v2) → **ถูกปฏิเสธ** เพราะ update pool v1/v2 ถูก freeze
  - หมายถึง flow เดิมของ CR-134 (`clearLoanViaBulkPool`) **ใช้งานไม่ได้ทันที** จนกว่า #659 (workflow รับของ)
    และ #660 (ตั๋วคืน/ตรวจรับ) จะ ship — ต้องตกลงว่าจะ deploy พร้อมกัน, ปิดฟีเจอร์ชั่วคราว, หรือรอ

### D5 — index และ view

- Mango index `(type, pool_id)` สำหรับ `bulk_return_entry` (declare ใน `shelter-access-design.ts`,
  deploy ใน `shelters.admin.ts`, เรียกจาก provisioner — ตามแบบ `REQUISITION_TICKET_MANGO_INDEXES`;
  **ไม่แตะ** `TICKET_DISTRIBUTION_MANGO_INDEXES` ซึ่งมีช่องว่างเดิม นอกขอบเขต)
- view `bulk_return_pool_item_totals` ใน `_design/app` reduce `_sum`:
  - entry → `emit([pool_id, item_id, entry_id], [qty, 1])`
  - move → `emit([from_pool_id, item_id, entry_id], [-qty, -1])` และ `emit([to_pool_id, item_id, entry_id], [qty, 1])`
  - `group_level=1` → ยอด/จำนวน entry ต่อ pool (count 0 = ว่าง), `2` → ต่อ item, `3` → ต่อ entry (net 1 = อยู่ใน pool)
  - `qty` ใน map = `parseFloat` ของ qty string (ใช้เพื่อ advisory/ตรวจว่างเท่านั้น; `items_summary` ที่ snapshot
    ใช้ decimal helper ของ repo)

### ที่ยังไม่ encode (รอคำตอบใน Open questions)

ไม่มี void field/event (หัวข้อ void entry), ไม่มี 4th state และ VDU ยังห้ามลบ pool doc ตามเดิม (หัวข้อลบกอง),
ไม่มี role check ใน VDU สำหรับ v3/entry/move (หัวข้อ role), `return_ticket_id` เป็น optional non-empty string
ไม่ตรวจ prefix/ไม่บังคับตาม state และไม่มี field ฝั่ง RECEIVED (หัวข้อ `return_ticket_id`), ไม่บังคับชื่อไม่ซ้ำ
(หัวข้อชื่อกอง), ยังไม่มี discriminator ผู้คืน (หัวข้อ "ไม่ระบุผู้คืน"), `location` free text ชั่วคราว (หัวข้อ `location`),
ยังไม่บังคับ = หรือ ≤ ของ `loan_refs` / ผู้คืนที่ไม่มี loan / `condition_on_return` (หัวข้อที่เกี่ยวข้อง),
ยังไม่จำกัดชนิด item (งานค้าง — ดู Amends), ไม่แตะ `distribution_log` (หัวข้อฝั่ง loan), ไม่มี resolution ของ entry ที่มาช้า
(หัวข้อ entry/move ที่มาช้าหลังล็อก). transition ที่ implement มีแค่ `OPEN → SUBMITTED` และ `SUBMITTED → RECEIVED`;
transition อื่นถูกปฏิเสธพร้อมข้อความว่ารอคำตอบเรื่อง role

## Amends — ข้อความเดิมที่ถูกแก้

**CR-134 (`docs/changes/03-C-supply/CR-134-bulk-return-claim-recovery.md`)**

- §1.1: "`bulk_return_pool` จัดเก็บเพียงยอดรวมเชิงสถิติ (Aggregate Quota): `total_received_qty`,
  `claimed_qty`, และ `unclaimed_quota`"
  และ §4.3 (pool schema_v 2: `item_id`, `stock_ledger_id`, `total_received_qty`, `claimed_qty`,
  `unclaimed_quota`, `claim_ids`, `status 'ACTIVE' | 'EXHAUSTED' | 'CLOSED'`)
  → **กติกาใหม่:** pool v3 ไม่มี field aggregate เหล่านี้ทั้งหมด — เป็น header (`name`, `status OPEN | SUBMITTED | RECEIVED`,
  `items_summary` snapshot ตอน submit); ยอดต่อ item มาจาก entry/move event ผ่าน view
- §1.1 ข้อ 1: "ระบบต้องตัดลดโควตาใน `bulk_return_pool` (CAS update)" และ §3 / §5 / §9 (claim flow:
  `bulk_return_claim`, `claim_ids`, Pre-flight Quota Check, Lazy Upgrade v1 → v2, forward recovery 5 ขั้น)
  → **กติกาใหม่:** ไม่มีการตัดโควตาและไม่มี claim — ปลดภาระ/ลดยอดยืมเกิดจาก entry ที่มี `loan_refs[]`
  (entry ก่อน แล้วค่อย loan); Lazy Upgrade v1 → v2 **ยกเลิก** (v1/v2 frozen, ไม่ migrate)
- §2.2: "**ห้ามสร้าง `stock_ledger` ซ้ำตอนเคลียร์ของยืม:** การตรวจรับพัสดุกองรวมเข้าคลังได้บันทึก `stock_ledger`
  `reason='receive'` ไปแล้ว ณ ขั้นตอนสร้าง `bulk_return_pool` …"
  → **กติกาใหม่:** การสร้าง `bulk_return_pool` v3 และการเพิ่ม entry **ไม่เขียน `stock_ledger`** — ของยังไม่ถือว่า
  รับเข้าคลังจนกว่า pool จะ `SUBMITTED → RECEIVED` ผ่านตั๋วคืนที่ตรวจรับ (รายละเอียดการลง ledger ตอนรับ
  ขึ้นกับคำตอบเรื่อง `return_ticket_id` / #660) ส่วนข้อห้ามไม่ให้เขียน ledger ซ้ำตอนจับคู่กับ loan ยังคงอยู่
- §14 (Schema Versions Summary: "`bulk_return_pool`: ยกระดับเป็น `schema_v = 2`") → เป็น `schema_v = 3` (ใหม่); v1/v2 frozen
- `bulk_return_claim` (§2.32 ของ schema.md; CR-134 §4.1, §7, §12) → **legacy: frozen ตอน deploy, ลบใน #661**
- **ไม่เปลี่ยน:** `loan_return_reservation` (CR-134 §15) — ผลต่อ flow ปลดภาระโหมด `BULK` เป็นเรื่องของ #659 (ดูหัวข้อฝั่ง loan)

**ยืนยันตามแบบแผนเดิม (confirmed by convention — ไม่ใช่คำถามเปิด):**

- **จำนวน = จำนวนเต็มบวกเท่านั้น:** ใช้ `positiveWholeQtySchema` ของ `food-supplies/shared.ts` ซึ่ง ship แล้ว
  (fix "reject fractional item quantities") และใช้กับ `distribution_log`, `bulk_return_claim`, `loan_return_reservation`

**งาน implement ที่ยังค้างใน #658 (planned reuse — ไม่ใช่คำถามออกแบบ):**

- **item ที่รับเข้ากองได้:** วางแผนใช้ field catalog เดิม `returnable` / `type_class` (แบบเดียวกับ
  `distribution_log.is_returnable` และ `catalog-eligibility.ts`) — ไม่เพิ่ม field ใหม่. **ยังไม่ได้บังคับ**ใน
  `bulk-return-entry.ts` / VDU ตอนนี้ (entry รับ `item_id` ใดก็ได้) — ต้อง implement ก่อนปิด #658

> **หมายเหตุแยก — CR-121 §3.8 (อาจต้องแก้ ขึ้นกับคำตอบเรื่อง `return_ticket_id`):**
> CR-121 §3.8 "กฎเหล็กของ Stock Ledger (Invariants)" ข้อ 4 "**Deterministic Bulk-Pool Receipt (P1-03):** … สร้าง `stock_ledger:{operationUlid}`
> (`reason:'receive'`, `ref_id:'bulk_return_pool:{operationUlid}'`) ก่อน แล้วสร้าง
> `bulk_return_pool:{operationUlid}` ที่อ้าง `stock_ledger_id` …" และตาราง mapping `reason ➔ ref_id` (§3.8) แถว `receive` ที่อนุญาต `ref_id` prefix
> `bulk_return_pool:` — ใน flow ใหม่ pool ไม่มี `stock_ledger_id` และไม่มี receipt ตอนสร้าง
> ถ้าคำตอบเรื่อง `return_ticket_id` ตัดสินให้รับของผ่านตั๋วคืน (`requisition_ticket` ที่ `RETURN_PENDING_RECEIPT` หรือ doc ใหม่) แถว `receive`
> จะ `ref_id` ชี้ตั๋ว/โดคใหม่แทน → ต้องแก้ข้อ 4 และ prefix ในตาราง mapping ของ CR-121 §3.8 (ใน CR นี้หรือ CR ของ #660)
> **ยังไม่แก้ CR-121 จนกว่าจะได้คำตอบเรื่อง `return_ticket_id`**

## Affected files

- `docs/data/schema.md` — §2.31 (v3), §2.31.1, §2.31.2 (ใหม่), §2.32 (legacy note), §7 (index/view), frontmatter
- `frontend/src/lib/features/distribution/domain/food-supplies/` — pool v3 + entry + entry-move
  (Zod schema, factories, `canAppendToPool`, `assertPoolTransition`, `resolveEntryPool`, `summarizePoolItems`,
  `isPoolEmpty`) + tests
- `frontend/src/lib/server/shelter-access-design.ts` — VDU (allowed types, v3 rules, freeze v1/v2, append-only
  entry/move), Mango index declaration (`BULK_RETURN_ENTRY_MANGO_INDEXES`) + tests
- `frontend/src/lib/features/shelters/domain/views.ts` + `view-manifest.ts` — view `bulk_return_pool_item_totals`
  (`_design/app` v3 → v4) + tests
- `frontend/src/lib/server/shelters.admin.ts`, `frontend/src/lib/features/shelters/server/provisioner.ts`,
  `frontend/scripts/redeploy-access.ts`, `frontend/scripts/seed/registry-shelters.ts` — deploy index
- ไม่แตะ `distribution_log` (schema/VDU) และ `TICKET_DISTRIBUTION_MANGO_INDEXES`; ไม่แตะ UI/workflow (อยู่ #659/#660)

## Data / schema impact

- `bulk_return_pool` **schema_v 2 → 3**: shape ใหม่ทั้งหมด (ไม่ใช่ additive) — v3 ไม่มี `item_id`,
  `stock_ledger_id`, `total_received_qty`, `claimed_qty`, `unclaimed_quota`, `claim_ids`, `ticket_id`, `shift_id`
- doc type ใหม่: `bulk_return_entry` v1, `bulk_return_entry_move` v1 (append-only, ห้ามลบ)
- **Migration note:** ไม่ migrate — pool v1/v2 frozen ตอน deploy (อ่านอย่างเดียว, ห้าม downgrade/แก้) แล้ว #661 ลบ
  พร้อม `bulk_return_claim`; pool v3 ห้ามลด `schema_v`
- `distribution_log` (§2.30) ไม่เปลี่ยนใน CR นี้ — field `bulk_pool_id` ยังอยู่ (ดูหัวข้อฝั่ง loan)
- ต้อง redeploy design doc `_design/access` และ `_design/app` + index บน shelter DB **ที่ provision แล้ว**

## Rollout / rollback

- **Rollout (ลำดับ):**
  1. merge โค้ด #658 (domain + VDU + view/index; ยังไม่มี workflow/UI ใหม่)
  2. redeploy design doc + indexes บน shelter ที่มีอยู่ (`scripts/redeploy-access.ts`; provisioner ครอบคลุม shelter ใหม่)
  3. **ตัดสินลำดับ deploy ก่อนขั้น 2:** หลังขั้น 2 flow เดิม (สร้าง pool v2 / claim quota) ถูกปฏิเสธโดย VDU
     จนกว่า #659/#660 ship — ทางเลือก: (ก) redeploy VDU พร้อม/หลัง #659/#660, (ข) ปิด UI เดิมชั่วคราวก่อน, (ค) แยก branch
     — **ต้องให้ PM/owner ตัดสิน**
  4. #661 ลบเอกสารเก่า (`bulk_return_pool` v1/v2, `bulk_return_claim`) และโค้ด legacy
- **Rollback:** revert โค้ดได้ แต่ doc v3 / entry / move ที่เขียนแล้วคงอยู่ (entry/move append-only, VDU เก่าไม่รู้จัก type ใหม่
  จึงอาจปฏิเสธการ update แต่ไม่ลบ) — ถ้า rollback VDU กลับเป็นรุ่นเก่า pool v1/v2 กลับมาแก้ได้อีก แต่ pool v3
  ที่สร้างแล้วจะแก้ผ่าน VDU เก่าไม่ได้ (schema_v ไม่รู้จัก) → ควร rollback เฉพาะก่อนมีการใช้ flow ใหม่จริง
- ลบ index/view ที่ deploy แล้วไม่จำเป็น (ไม่กระทบข้อมูล)

## Open questions (สำหรับ PM / Project Owner)

> หัวข้อแรกเป็น **พฤติกรรมที่ implement แล้วในโค้ดของ #658 — ขอให้ยืนยัน**; สองหัวข้อถัดมาเป็น
> **ข้อเสนอที่อิงแบบแผนเดิมของ repo — ขอให้ยืนยันหรือคัดค้าน**; หัวข้อที่เหลือยังเป็นคำถามเปิด
> (มีแบบแผนเดิมประกอบเป็นข้อมูล). นอกจากหัวข้อแรก ทุกข้อ**ยังไม่ได้ใช้**ใน CR/โค้ด/schema.md

### แก้ชื่อ/ที่ตั้งกองได้ระหว่าง `OPEN` และล็อกเมื่อ `SUBMITTED` — ยืนยันหรือไม่?

**implement แล้ว (ไม่ใช่ข้อเสนอ) แต่ยังไม่มีใครยืนยัน:** `name` และ `location` แก้ได้ขณะ pool เป็น `OPEN`
และแก้ไม่ได้อีกเมื่อ `SUBMITTED` / `RECEIVED`

- บังคับสองชั้น: domain (`assertPoolTransition` ใน `bulk-return-pool-v3.ts` — "name/location are immutable once
  SUBMITTED") และ VDU (`shelter-access-design.ts` — "bulk_return_pool name and location are immutable once SUBMITTED")
- เหตุผลที่เลือก: ให้ชื่อ/ที่ตั้งตรงกับ `items_summary` ที่ snapshot ตอน submit และตั๋วคืนที่แนบ
- ทางเลือกถ้าคัดค้าน: (ก) ล็อกตั้งแต่สร้าง (แก้ไม่ได้เลย), (ข) แก้ได้ทุกสถานะ (snapshot ไม่ผูกชื่อ)

### ลบกองทั้งกองได้หรือไม่?

**ข้อเสนอ: ไม่ลบเอกสาร — ใช้สถานะปลายทาง (terminal state) `CANCELLED` แทน** ตามแบบแผนเดิมของ repo — ขอให้ยืนยันหรือคัดค้าน

- แบบแผนเดิม: เอกสารประสานงาน/บันทึกเหตุการณ์ใน repo จบด้วยสถานะปลายทาง ไม่ลบทิ้ง
  - `bulk_return_claim` และ `loan_return_reservation` → `ABORTED`
  - `requisition_ticket` → `CANCELLED` (จาก `PENDING_PICK` / `READY_FOR_DISPATCH`)
  - `shelter_incident` → `closed` / `cancelled` — comment ใน VDU (`frontend/src/lib/server/shelter-access-design.ts`)
    ระบุตรง ๆ ว่า "Incident Log is an occurrence book — records are closed or cancelled, never deleted."
  - VDU ปัจจุบันห้ามลบ `bulk_return_pool` อยู่แล้ว (กลุ่มเดียวกับ `distribution_log`, `bulk_return_claim`,
    `loan_return_reservation`, `shelter_incident`) — ข้อเสนอนี้จึงไม่ต้องยกเลิก delete-ban
- ผลที่ตามมา: เพิ่มสถานะที่ 4 → `OPEN | SUBMITTED | RECEIVED | CANCELLED` — **ขัดกับ enum 3 สถานะตามตัวอักษรใน #658**
  จึงต้องให้ owner ยืนยัน; `OPEN → CANCELLED` ได้เฉพาะเมื่อกองว่าง (ตาม invariant "ลบได้เฉพาะว่าง") และหน้ารายการกอง
  (#659) กรอง `CANCELLED` ออกจากผลค้นหาโดยปริยาย
- ทางเลือกถ้าคัดค้าน: hard delete — ต้องยกเลิก VDU delete-ban สำหรับ type นี้ (stable core) และไม่มี audit trail

### entry/move ที่เขียนเข้ามาหลังล็อกกองแล้ว จะจัดการอย่างไร?

**ข้อเสนอ: fence ก่อนขั้นที่ย้อนกลับไม่ได้ ตามแบบ `fenceReturnReservation`** — ขอให้ยืนยันหรือคัดค้าน

- แบบแผนเดิม: `fenceReturnReservation` (`frontend/src/lib/features/distribution/application/food-supplies/return-workflow.ts`)
  ทำ CAS บน reservation "right before an irreversible side effect" (`RESERVED → FENCED`) เพื่อไม่ให้ owner ที่ล้าสมัย
  หรือ operation ที่ถูกยกเลิกข้ามขอบเขตของผลข้างเคียงได้
- นำมาใช้กับกอง: ขั้นที่ย้อนกลับไม่ได้ของ entry คือ**การอัปเดต loan** (entry เขียนก่อน loan ตาม D2) ดังนั้น
  1. ตอน submit snapshot รายการ entry id ที่นับลง `items_summary` ด้วย → entry ที่ไม่อยู่ใน snapshot ระบุได้แน่นอนว่า "มาช้า"
  2. ผู้เขียน entry อ่าน pool ซ้ำ**หลังเขียน entry และก่อนอัปเดต loan** — ถ้า pool ไม่ใช่ `OPEN` หรือมี `lock` → หยุด
     ไม่ไปต่อที่ขั้น loan
  3. entry ที่มาช้าแสดงใน #659 ให้ย้ายไปกองที่ยัง `OPEN` (move event ปกติ)
- ข้อจำกัดที่ต้องรับรู้: `fenceReturnReservation` fence บนเอกสารเดียวกับที่คุมผลข้างเคียง (reservation ต่อ log)
  แต่ที่นี่ lock อยู่บน pool ซึ่งเป็นคนละเอกสารกับ entry — การอ่านซ้ำในข้อ 2 จึงลดช่องโหว่แต่ไม่ปิดสนิท;
  การปิดสนิทต้องให้ผู้เขียน entry ทำ CAS บน pool ทุกครั้ง ซึ่งนำ hot-doc conflict ที่ D1 หลีกเลี่ยงกลับมา
- schema ที่กระทบถ้ายืนยัน: เพิ่ม field snapshot entry id บน pool v3 (ตอน submit)

### ยกเลิก entry รายการเดียวได้หรือไม่ (void)?

ตัวเลือก (ก) ไม่มี void เลย (ผิดแล้วแก้ไม่ได้ ต้องย้ายไป pool อื่นหรือรับผลต่าง
ตอนตรวจรับ), (ข) เพิ่ม void event doc แบบ append-only; ถ้า void แล้ว loan ที่ entry เคยปิด/ลดยอด **เปิดกลับ** หรือไม่

- แบบแผนเดิม: `distribution_log` มี `status: 'voided'` + `voided_at` / `voided_by` (soft void บนเอกสาร mutable
  ไม่ลบ); entry เป็น append-only จึงเทียบได้กับ void event doc แยก. VDU ของ `distribution_log` ไม่มีทางย้อนจาก
  `returned` กลับ — "void แล้วเปิด loan กลับ" ต้องแก้ VDU ส่วนนั้นด้วย
- ข้อเสนอ (ยังไม่ใช้): append void event; void ไม่เปิด loan กลับ

### ใครทำอะไรได้บ้างในแต่ละขั้น และย้อน `SUBMITTED → OPEN` ได้หรือไม่?

เปิด pool, เพิ่ม entry, ย้าย, ลบ, submit, receive; และ `SUBMITTED → OPEN` ทำได้ไหม
(forward-only vs เฉพาะ manager ก่อนเริ่มตรวจรับ; การยกเลิกตั๋ว); pool ว่างเปล่า submit ได้ไหม

- แบบแผนเดิม:
  - VDU ของ flow เดิม: สร้าง/ปิด pool = `warehouse_staff`, `supply_coordinator`, `shelter_manager`;
    claim = `registration_staff`, `distribution_staff`, `supply_coordinator`, `shelter_manager`
  - `assertReservationModeAuthority` (`frontend/src/lib/features/distribution/application/food-supplies/auth.ts`):
    คืนแบบ `BULK` = `distribution_staff`, `shelter_manager`, `system_admin`; คืนแบบ `PHYSICAL` เพิ่ม
    `warehouse_staff`, `supply_coordinator`
  - `requisition_ticket` ช่วงคืนของเป็น forward-only: `RETURN_PENDING_RECEIPT → RETURN_COMPLETED` เท่านั้น
- **VDU v3 ตอนนี้ไม่มี role check เลย** — ต้องได้คำตอบและเพิ่มก่อน merge
- ข้อเสนอ (ยังไม่ใช้): forward-only; owner กำหนด role

### `return_ticket_id` ควรชี้ไปที่เอกสารใด (กระทบ CR-121)?

(ก) ใช้ `requisition_ticket` ที่ `RETURN_PENDING_RECEIPT`
(ต้องเลือก `requisition_type` อะไร? สร้างเข้า state นั้นตรง ๆ ข้าม lifecycle ปกติ), (ข) doc type ตั๋วคืนใหม่;
ยอดรับจริง / ส่วนต่าง / เหตุผล เก็บที่ไหน — บรรทัดตั๋วมี `returned_qty`/`discrepancy_qty` แต่ **ไม่มี field เหตุผล**

- แบบแผนเดิม: `requisition_type` ปัจจุบันมีแค่ `kitchen | food | supplies | transfer` (ยังไม่มีชนิดสำหรับกองคืน);
  `RETURN_PENDING_RECEIPT` เข้าได้จาก `SHIFT_CLOSED` เท่านั้น — ทางเลือก (ก) จึงต้องเพิ่มทั้ง enum และทางเข้า state
  ใหม่ใน CR-121 (ดูขอบเขตด้านล่าง); flow ตรวจรับเดิม (`WarehouseReturnDialog` / `receiveWarehouseReturns`) อ่าน `ticket.items[].returned_qty`
- **ขอบเขตจริงของทางเลือก (ก) — ไม่ใช่แค่ "เพิ่มค่า enum":** ตาม `TICKET_TRANSITIONS` ปัจจุบัน
  `RETURN_PENDING_RECEIPT` เข้าได้**ทางเดียว**คือจาก `SHIFT_CLOSED` ตาม lifecycle ปกติของตั๋ว
  (`PENDING_PICK → READY_FOR_DISPATCH → IN_TRANSIT → DISTRIBUTING → SHIFT_CLOSED → RETURN_PENDING_RECEIPT → RETURN_COMPLETED → COMPLETED`)
  ซึ่งตั๋วกองคืนไม่ได้ผ่าน (ไม่มีการเบิก/จ่าย/ปิดกะ). ถ้าเลือก (ก) ต้องตัดสินเพิ่มว่าตั๋วกองคืนเข้า state นี้อย่างไร เช่น
  - สร้างตั๋วที่ `RETURN_PENDING_RECEIPT` ตั้งแต่แรก (create-state ใหม่ที่ VDU/domain ต้องอนุญาตเฉพาะชนิดนี้), หรือ
  - เพิ่ม transition ลัดเฉพาะชนิดนี้
    ทั้งสองแบบแก้ state machine ของ CR-121 (stable) และต้องตรวจว่ารายงาน/คิวที่อ่านตั๋วตาม state ไม่นับตั๋วกองคืนผิด
- ข้อเสนอ (ยังไม่ใช้): ใช้ `requisition_ticket` + เพิ่ม field เหตุผลที่บรรทัด ตัดสินร่วมกับ #660

### `location` ของกองควรเป็น free text หรืออ้าง storage point?

(ก) free text, (ข) อ้าง storage point ของศูนย์ (CR-139: `shelter.common_areas.sub_storage[].id`) + snapshot ชื่อ ณ เวลาบันทึก

- แบบแผนเดิม: `stock_ledger.lot` ใช้แบบ (ข) ตั้งแต่ schema_v 5 — `storage_point_id` + `storage_zone` (ชื่อ snapshot);
  แถวก่อนหน้าเป็น free text. โค้ดร่างของ branch นี้ใช้ free text ไว้ก่อน แต่**ไม่ใช่การตัดสิน**
- ข้อเสนอ (ยังไม่ใช้): ไม่มี — ต้องให้ owner เลือก

### ชื่อกองต้องไม่ซ้ำหรือไม่?

`name` unique ในกลุ่ม pool `OPEN` ของศูนย์ หรือทั้งศูนย์ หรือไม่บังคับ / ความยาวสูงสุด

- แบบแผนเดิม — ขึ้นกับ store:
  - **MongoDB (public plane) บังคับ unique ได้จริง:** `third_party_clients.name` มี unique index ระดับ DB
    (`packages/tent-model/src/tent_model/third_party_client.py`: `IndexModel([("name", 1)], name="name_unique_ci",
unique=True, collation={"locale": "en", "strength": 2}, partialFilterExpression={"name": {"$type": "string"},
"deleted_at": None})`) และ API แปลง `DuplicateKeyError` เป็น `409`
  - **CouchDB (staff plane — ที่ `bulk_return_pool` อยู่) ไม่มี secondary unique index:** unique บังคับได้จริงเฉพาะผ่าน
    `_id` deterministic; VDU อ่านเอกสารอื่นไม่ได้จึงตรวจซ้ำข้ามเอกสารไม่ได้. ที่มีอยู่เป็นการตรวจฝั่ง application
    เช่น ชื่อซ้ำภายในไฟล์เดียวของ shelter-import (`import-row.ts`)
  - ดังนั้นชื่อกองบังคับ unique ได้สองแบบเท่านั้น: (ก) advisory (ตรวจตอนสร้างใน UI, ชนกันได้ถ้าสร้างพร้อมกัน)
    หรือ (ข) ใส่ชื่อ (normalize) ลงใน `_id` — ซึ่งทำให้เปลี่ยนชื่อตอน `OPEN` ไม่ได้และขัดกับ `_id` แบบ ULID
- ข้อเสนอ (ยังไม่ใช้): unique ในกลุ่ม `OPEN` แบบ advisory

### "ไม่ระบุผู้คืน" ควร encode อย่างไร?

ตอนนี้ entry รับทั้ง "ไม่มี field `returner_id`" และ `null`; มีทางเลือกเพิ่ม discriminator หรือไม่

- แบบแผนเดิม: `distribution_log` ใช้ discriminator ชัดเจน `recipient_type: evacuee | volunteer | outside` และบังคับ
  `recipient_id` ต้องเป็น `null` เมื่อ `outside` — ไม่ได้อนุมานจากการไม่มีค่า
- ข้อเสนอ (ยังไม่ใช้): เพิ่ม `returner_type` ตามแบบ `recipient_type` (ค่าสำหรับ "ไม่ระบุ" ให้ owner กำหนด)

### ฝั่งรายการยืม (loan) ต้องเปลี่ยนอะไรบ้าง? (surfaced ระหว่างออกแบบ)

- replay ของการอัปเดต loan แบบ idempotent ต้องมี marker บน `distribution_log` ว่า entry ใดถูก apply แล้ว
  (เปลี่ยน §2.30 schema) และ VDU ของ `distribution_log` ต้องอนุญาต `bulk_dropoff` → `partially_returned`
  (ปัจจุบันมีแต่ → `returned`)
- `bulk_pool_id` เดี่ยวบน loan จะ stale เมื่อ entry ถูกย้าย — เก็บ / ทิ้ง / แทนที่
- แบบแผนเดิม: `distribution_log` มี `qty_returned`, `clear_reason`, และ `bulk_pool_id` เดี่ยว (ไม่มีรายการ entry/operation
  ที่ apply แล้ว); CR-134 ประสานต่อ log ด้วยเอกสารแยกที่ `_id` derive จาก log (`loan_return_reservation:{logULID}`
  เก็บ `operation_id` + `mode: BULK`, และ `bulk_return_claim:{logULID}`) — marker จึงทำได้ทั้งแบบ field บน log หรือ
  แบบเอกสารแยกต่อ log ตาม CR-134
- ข้อเสนอ (ยังไม่ใช้): เพิ่ม applied-entry marker; v3 เลิกเขียน `bulk_pool_id`

### ผลรวม `loan_refs.qty` ต้องเท่ากับจำนวนของ entry หรือน้อยกว่าได้?

(ก) `=` — ของทุกชิ้นใน entry ต้องผูก loan, (ข) `≤` — มีส่วนที่ไม่ผูก loan ได้ (เช่น ของเกินยอดยืม หรือไม่รู้ว่าของใคร)

- ตอนนี้บังคับเฉพาะ `≤` ซึ่งจำเป็นเชิงตรรกะอยู่แล้ว (ผูก loan เกินจำนวนของที่รับไม่ได้)
- ข้อเสนอ (ยังไม่ใช้): `≤`

### ผู้คืนที่ไม่มีรายการยืมค้าง บันทึกเข้ากองได้หรือไม่?

ระบุผู้คืนได้ (`evacuee:` / `volunteer:`) แต่ไม่มี loan ค้างของ item นั้น — (ก) บันทึกเป็น entry ปกติ (`loan_refs` ว่าง),
(ข) เตือนแต่ให้บันทึก, (ค) บล็อก

- ข้อเสนอ (ยังไม่ใช้): (ก) บันทึกได้

### ต้องบันทึกสภาพของที่คืน (`condition_on_return`) บน entry หรือไม่?

- ข้อเสนอ (ยังไม่ใช้): ไม่มี

## Decision log

- 2026-10-22 — proposed (draft คู่กับ #658; D1–D5 ตัดสินแล้วโดย project owner; จำนวนเต็มยืนยันตามแบบแผนเดิม; จำกัด item ด้วย `returnable`·`type_class` เป็นงาน implement ที่ค้างใน #658;
  ลบกอง (`CANCELLED`) และ entry ที่มาช้า (fence ก่อนอัปเดต loan) เป็นข้อเสนอรอยืนยัน; คำถามที่เหลือใน Open questions รอ PM/Project Owner;
  รอ PM/lead กำหนดเลข CR และวิธี track)
