---
id: CR-193
title: CR-193 — ออกแบบ bulk_return_pool ใหม่เป็น "กองรวมตอนรับของคืน" (pool header + entry/move/void event log)
status: approved
date: 2026-10-22
updated: 2026-10-26
requested_by: feedback ระบบคลัง & เบิกของ ข้อ 4–5 (GitHub #657, #658)
decided_by: kong (decisions 2026-10-22 — https://github.com/r202-coe-psu/tent/pull/768#issuecomment-6339918664; approved 2026-10-25)
layer: stable
affects:
  - docs/changes/03-C-supply/CR-134-bulk-return-claim-recovery.md (amended — pool v2 / claim flow / ข้อห้าม stock_ledger ตอนสร้าง pool)
  - docs/data/schema.md §2.30 (distribution_log schema_v 1 → 2), §2.31 (bulk_return_pool schema_v 3 — shape เปลี่ยนก่อนปล่อย), §2.31.1 / §2.31.2 / §2.31.3 (ใหม่), §2.32 (legacy), §7, §8
  - schema_v — distribution_log 1 → 2; bulk_return_pool 2 → 3; doc type ใหม่ bulk_return_entry v1, bulk_return_entry_move v1, bulk_return_entry_void v1 (append-only)
  - frontend/src/lib/server/shelter-access-design.ts (VDU + Mango index `BULK_RETURN_ENTRY_MANGO_INDEXES`)
  - frontend/src/lib/features/shelters/domain/views.ts + view-manifest.ts (view `bulk_return_pool_item_totals`, `_design/app` v6)
  - frontend/src/lib/server/shelters.admin.ts / shelters/server/provisioner.ts / scripts/redeploy-access.ts / scripts/seed/registry-shelters.ts (deploy index)
  - frontend/src/lib/features/distribution/domain/food-supplies (bulk-return-pool / entry / entry-move / entry-void) และ distribution-log
---

# CR-193 — ออกแบบ bulk_return_pool ใหม่เป็นกองรวมตอนรับของคืน

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** `bulk_return_pool` เปลี่ยนจาก "โควตา aggregate ต่อ item ที่เปิดหลังรับของเข้าคลัง"
>   เป็น "กองรวมที่เปิดไว้ก่อน แล้วค่อยบันทึกของที่รับคืนเป็นรายการ (entry) เข้ากอง" —
>   pool เป็น header เล็ก ๆ (`name`, `status: OPEN | SUBMITTED | RECEIVED | CANCELLED`), entry / move / void
>   เป็น event doc แบบ append-only, สรุปยอดต่อ `item_id` (`items_summary`) และรายการ entry (`entry_ids`) ถูก snapshot ลง pool ตอน submit
> - **เอกสารใหม่:** `bulk_return_pool` schema_v **3**, `bulk_return_entry` v1, `bulk_return_entry_move` v1, `bulk_return_entry_void` v1;
>   `distribution_log` schema_v **1 → 2** (`applied_bulk_entry_ids`) — Mango index `(type, pool_id)` + view `bulk_return_pool_item_totals` (`_sum`)
> - **ตัดสินครบแล้ว** โดย kong เมื่อ 2026-10-22 และตัดสินเพิ่ม 2026-10-25 (ดูหัวข้อ Decisions ข้อ 1, 15–17) — ไม่มี open question เหลือ
> - **Deploy:** #658 + #659 + #660 merge ใน PR เดียวและ redeploy ครั้งเดียว (ดู Rollout)
> - **CR-121 ไม่ได้รับผลกระทบ** (ไม่มีตั๋วคืนแยก — ดู Decisions ข้อ 7)
> - **อ้างอิง:** [#657](https://github.com/r202-coe-psu/tent/issues/657) (epic),
>   [#658](https://github.com/r202-coe-psu/tent/issues/658) (domain + VDU + view/index),
>   [คำตัดสินของ kong](https://github.com/r202-coe-psu/tent/pull/768#issuecomment-6339918664)

---

## Context

feedback ระบบคลัง & เบิกของ ข้อ 4–5: ของยืมที่ผู้ประสบภัย/จิตอาสานำมาคืนรวมกัน ต้องรับเข้ากองก่อน
(ยังไม่รู้ว่าเป็นของใคร) แล้วค่อยจับคู่กับรายการยืมทีหลัง — flow ปัจจุบันบังคับให้คลังรู้ยอดรวมและ item เดียว
ก่อนเปิด pool

| มิติ        | flow ปัจจุบัน (CR-121 / CR-134)                                                                                  | flow ใหม่ (epic #657)                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| เปิด pool   | หลังตรวจนับของ — ต้องมี `item_id`, `total_received_qty`, `stock_ledger_id` (receive ledger เขียนพร้อมสร้าง pool) | เปิดก่อน มีแค่ `name` (+ จุดเก็บ optional) สถานะ `OPEN` ไม่มียอด                             |
| เนื้อหา     | 1 pool = 1 item, ยอดรวมตัวเดียว                                                                                  | หลาย item — บันทึกเป็น entry ต่อครั้งที่รับ (item, qty, ผู้คืน, loan ที่ปิด/ลด)              |
| การใช้ pool | ด่าน Check-out ตัด `unclaimed_quota` ผ่าน `bulk_return_claim` (CAS ต่อ log)                                      | entry ผูก `loan_refs[]`; ย้าย/void entry ได้ขณะ `OPEN`                                        |
| ปิดงาน      | `ACTIVE → EXHAUSTED/CLOSED`                                                                                      | `OPEN → SUBMITTED → RECEIVED` (ตรวจรับที่ pool เอง) หรือ `OPEN → CANCELLED` เมื่อกองว่าง     |
| สรุปยอด     | `total_received_qty` ตัวเลขเดียว                                                                                 | `items_summary` + `entry_ids` (snapshot ตอน submit) และ `received_items` (ผลตรวจรับ)         |

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

**After** — **DECIDED** (D1–D5 และ Decisions ข้อ 1–14 ตัดสินโดย kong):

### D1 — pool header + event log append-only + snapshot + lock

- `bulk_return_pool:{ULID}` (schema_v 3) เป็น header ที่ mutable เล็ก ๆ: `name`, `location_storage_point_id` + `location_storage_zone` (optional เป็นคู่),
  `status`, `lock?`, `notes?`; ตอน submit เพิ่ม `items_summary`, `entry_ids`, `submitted_at/by`; ตอน cancel เพิ่ม `cancelled_at/by`;
  ตอน receive เพิ่ม `received_at/by`, `received_storage_point_id` + `received_storage_zone`, `received_items[]`
- entry (`bulk_return_entry:{ULID}`), move (`bulk_return_entry_move:{entryULID}:{seq}`) และ void (`bulk_return_entry_void:{entryULID}`)
  เป็น **event doc append-only** — ไม่ update ไม่ delete (VDU บังคับ). **การย้าย = เขียน move doc ใหม่ ไม่แก้ entry doc**
- `items_summary` (`[{ item_id, qty }]`, ไม่ว่าง) และ `entry_ids` (ไม่ว่าง, ไม่ซ้ำ) เขียนลง pool ตอน `OPEN → SUBMITTED` และ immutable หลังจากนั้น;
  ไม่มี `total_received_qty` ตอนเปิด pool. `entry_ids` คือ snapshot ของ entry ที่อยู่ในกองและยังไม่ถูก void ณ ตอน submit (ใช้เป็น fence)
- **lock / fence:** `lock = { op: 'SUBMIT' | 'CANCEL', op_id, locked_at, locked_by } | null` บน pool — ตั้งได้เฉพาะตอน `OPEN`

**Advisory lock protocol** (VDU อ่านเอกสารอื่นไม่ได้ จึงเป็น advisory ที่ฝั่ง application):

1. ผู้จะ submit/cancel ตั้ง `lock` ผ่าน CAS บน pool (`_rev`) — แพ้ CAS = มีคนอื่นถือ lock
2. อ่านยอดจาก view `bulk_return_pool_item_totals` (group_level 1 → จำนวน entry; 2 → ต่อ item)
3. snapshot → เขียน `items_summary` + `entry_ids` + `status: SUBMITTED` + ล้าง `lock` ใน update เดียว (submit) /
   ตรวจ "ว่าง" แล้วเขียน `status: CANCELLED` + `cancelled_at/by` + ล้าง `lock` (cancel)
   ลำดับ submit ใน workflow (#660): ตั้ง lock ก่อนเสมอ (lock `SUBMIT` ของ op เดียวกัน = replay, ของ op อื่น = ชน); ถ้า entry สุทธิเป็น 0 ปล่อย lock
   แล้วปฏิเสธ (ให้ยกเลิกกองแทน); pool ที่ `SUBMITTED` แล้วคืนค่าเดิม; submit ไม่เขียน `stock_ledger`
4. ผู้เขียน entry/move/void **ต้องเรียก `canAppendToPool(pool)`** (`status === 'OPEN'` และไม่มี `lock`)
   ก่อนเขียน แล้ว**อ่าน pool ซ้ำหลังเขียน entry ก่อนอัปเดต loan** (แบบ `fenceReturnReservation`) — เป็น advisory ไม่ใช่ guarantee (ดู Decisions ข้อ 5)

### D2 — `loan_refs[]` และลำดับการเขียน

- entry เก็บ `loan_refs: [{ distribution_log_id, qty }]` (ว่างได้) — ผูกกับรายการยืมที่ปิด/ลดจากการคืนครั้งนั้น
- ลำดับเขียน (สำหรับ workflow #659): **entry ก่อน แล้วค่อย `distribution_log`** — entry `_id` ใช้ ULID ของ
  operation ของผู้เรียก (deterministic) และ `distribution_log` update ใช้ marker `applied_bulk_entry_ids` ต่อ entry →
  retry ซ้ำไม่ทำให้เกิดแถวซ้ำ หาก crash หลังเขียน entry ก่อนอัปเดต loan → replay เดินต่อจาก entry ที่มีอยู่
- invariant ที่ enforce ได้ระดับเอกสาร: `distribution_log_id` ไม่ซ้ำใน array; `sum(loan_refs.qty) ≤ entry.qty`; `returner_type = unspecified` ต้อง `loan_refs` ว่าง

### D3 — ย้ายทั้ง entry เท่านั้น และย้ายแล้วตัดยอด loan ตาม `loan_refs` (แก้ 2026-10-25)

- ไม่มีการย้ายบางส่วนของ qty; move doc คัดลอก `item_id`, `qty` จาก entry (ให้ view `_sum` ใช้งานได้)
- **ย้ายแล้วตัดยอด loan ตาม `loan_refs` ของ entry:** เขียน move doc ก่อน แล้วอ่าน pool ปลายทางซ้ำ (fence แบบเดียวกับเพิ่ม entry) —
  ถ้ายัง `OPEN` และไม่มี `lock` ให้ apply `loan_refs` ที่ยังไม่อยู่ใน `applied_bulk_entry_ids` ของ loan นั้นลง `distribution_log`
  (idempotent: ref ที่ apply แล้วเป็น no-op); loan ที่ปิด/ไม่พบ หรือยอดค้าง < `ref.qty` ข้าม ref นั้นตามข้อ 15.
  ถ้า pool ปลายทางไม่รับต่อแล้ว (ไม่ใช่ `OPEN` หรือมี `lock`) ให้รายงานว่า "มาช้า" และ **ไม่แตะ loan ใด ๆ**.
  นี่คือทางที่ entry มาช้าตัด loan ได้ในที่สุด (ไม่งั้น loan ค้างและคืนซ้ำได้)
- **id scheme:** `bulk_return_entry_move:{entryULID}:{seq}` โดย `seq` = เลขลำดับการย้ายของ entry นั้น
  (1-based, zero-pad 4 หลักให้เรียงตาม `_id` ได้) → การย้ายครั้งที่ n ของ entry เดียวกันสองคำสั่งพร้อมกัน
  จะเขียน `_id` เดียวกัน → **ตัวที่สองชน HTTP 409 แทนที่จะนับซ้ำ**; ผู้แพ้ต้องอ่านสถานะใหม่ (fold) แล้วตัดสินใจเอง
- VDU ตรวจไม่ได้ว่า `from_pool_id` = pool ปัจจุบันของ entry หรือ pool ปลายทาง `OPEN` — เป็นหน้าที่ของ
  domain fold (`resolveEntryPool`) + advisory `canAppendToPool`
- entry ที่ถูก void แล้วย้ายไม่ได้ (advisory ฝั่ง domain/fold)

### D4 — type เดิม, schema_v 3, v1/v2 frozen

- คง `type: 'bulk_return_pool'` — doc ใหม่เป็น `schema_v: 3`; entry/move/void เริ่ม v1. v3 **ยังไม่ปล่อย** จึงแก้ shape ของ pool/entry/move
  ในที่เดิมโดยไม่ bump `schema_v`
- pool v1/v2 ที่มีอยู่ **frozen ตอน deploy**: อ่านได้ แต่ VDU ปฏิเสธทุก update; ไม่ migrate; #661 ลบทิ้ง
- `validate_doc_update` ship ใน #658
- **ผลที่ตามมาของ D4:** เมื่อ VDU ใหม่ถูก redeploy บน shelter DB สร้าง pool v1/v2 ใหม่ และ claim quota (`bulk_return_claim`) ถูกปฏิเสธ —
  flow เดิมของ CR-134 (`clearLoanViaBulkPool`) ใช้งานไม่ได้ทันที จึงต้อง ship #658/#659/#660 พร้อมกัน (Decisions ข้อ 2)

### D5 — index และ view

- Mango index `(type, pool_id)` สำหรับ `bulk_return_entry` (declare ใน `shelter-access-design.ts`,
  deploy ใน `shelters.admin.ts`, เรียกจาก provisioner — ตามแบบ `REQUISITION_TICKET_MANGO_INDEXES`;
  **ไม่แตะ** `TICKET_DISTRIBUTION_MANGO_INDEXES` ซึ่งมีช่องว่างเดิม นอกขอบเขต)
- view `bulk_return_pool_item_totals` ใน `_design/app` reduce `_sum`:
  - entry → `emit([pool_id, item_id, entry_id], [qty, 1])`
  - move → `emit([from_pool_id, item_id, entry_id], [-qty, -1])` และ `emit([to_pool_id, item_id, entry_id], [qty, 1])`
  - void → `emit([pool_id, item_id, entry_id], [-qty, -1])` (หักยอด entry ที่ void ออก)
  - `group_level=1` → ยอด/จำนวน entry ต่อ pool (count 0 = ว่าง), `2` → ต่อ item, `3` → ต่อ entry (net 1 = อยู่ใน pool, 0 = ย้ายออกหรือ void)
  - `qty` ใน map = `parseFloat` ของ qty string (ใช้เพื่อ advisory/ตรวจว่างเท่านั้น; `items_summary` ที่ snapshot
    ใช้ decimal helper ของ repo)
  - `_design/app` เวอร์ชัน 6 (v4 ถูกใช้โดย CR-170 amend และ v5 โดย CR-192 บน develop ก่อน branch นี้ merge)

## Decisions

ตัดสินโดย kong เมื่อ 2026-10-22 — [คอมเมนต์ต้นทาง](https://github.com/r202-coe-psu/tent/pull/768#issuecomment-6339918664).
D1–D5 ข้างบนยังมีผลตามเดิม (ปรับข้อความให้ตรงกับผลด้านล่าง) ข้อ 1–14 ด้านล่างแทนหัวข้อ Open questions เดิมทั้งหมด

### 1. Role ต่อ transition และการย้อนสถานะ

- **เปิด pool / แก้ `name`-จุดเก็บ / ยกเลิก (`OPEN → CANCELLED`) / submit / receive:** `warehouse_staff`, `supply_coordinator`, `shelter_manager`
  (รวมการตั้ง/ล้าง `lock` และแก้ `notes`)
- **เพิ่ม / ย้าย / void entry:** role ข้างบน + `distribution_staff`
- **forward-only:** `OPEN → SUBMITTED`, `SUBMITTED → RECEIVED`, `OPEN → CANCELLED` เท่านั้น — `SUBMITTED → OPEN` ไม่อนุญาต
- **pool ว่างเปล่า submit ไม่ได้** — ให้ยกเลิกแทน. encode: VDU ปฏิเสธ `items_summary` หรือ `entry_ids` ว่าง
- encode: VDU บังคับ role ด้วยตัวช่วยใหม่ (กลุ่ม pool และกลุ่ม entry) และตรวจ `created_by`/`submitted_by`/`received_by`/`cancelled_by`/`lock.locked_by` = ผู้เขียน
- **`system_admin` (ตัดสินเพิ่ม 2026-10-25, แทนข้อความ "ไม่รวม system_admin" ในคำตัดสินรอบแรก):** คงพฤติกรรมเดิมของ `isRole()`
  — `system_admin` ทำได้ทุก transition ข้างบน ไม่มี special case บล็อก SA

### 2. ลำดับ deploy

- #659 และ #660 ทำใน branch/PR เดียวกับ #658 แล้ว merge ครั้งเดียว (provisioner deploy design doc รวม VDU ให้ shelter ใหม่อัตโนมัติ
  การ merge #658 เดี่ยว ๆ โดยไม่ redeploy จึงไม่ปลอดภัย). ยอมรับ PR ที่ใหญ่ขึ้น — ดู Rollout

### 3. แก้ชื่อ/จุดเก็บกอง

- ยืนยัน: `name` และจุดเก็บ (`location_*`) แก้ได้ขณะ `OPEN` เท่านั้น และ frozen ตั้งแต่ pool ออกจาก `OPEN` รวมถึงการเขียน transition เอง (`SUBMITTED`/`CANCELLED`/`RECEIVED`); `notes` แก้ได้ทุก status — บังคับทั้ง domain (`assertPoolTransition`) และ VDU

### 4. ลบกอง → สถานะปลายทาง `CANCELLED`

- เพิ่มสถานะที่ 4 (`OPEN | SUBMITTED | RECEIVED | CANCELLED`); `OPEN → CANCELLED` ได้เฉพาะเมื่อกองว่าง; **ไม่ลบเอกสาร** (VDU ยังห้ามลบ pool ทุกกรณี)
- lock op เปลี่ยนจาก `DELETE` เป็น `CANCEL`; pool ที่ยกเลิกมี `cancelled_at` + `cancelled_by` และต้องไม่มี snapshot/ผลรับ/`lock`
- หน้ารายการกอง (#659) ซ่อน `CANCELLED` โดยปริยาย

### 5. entry/move ที่มาช้าหลังล็อก — fence แบบ `fenceReturnReservation`

- snapshot `entry_ids` ตอน submit; ผู้เขียน entry อ่าน pool ซ้ำหลังเขียน entry และก่อนอัปเดต loan — ถ้าไม่ใช่ `OPEN` หรือมี `lock` ให้หยุด
- entry ที่มาช้า (ไม่อยู่ใน `entry_ids` ของ pool ที่ไม่ใช่ `OPEN`) แสดงใน UI เป็น "ค้าง" ให้ย้ายไป pool `OPEN` อื่น — domain: `findLateEntries` / `isLateEntry`
- ช่องแข่งระดับเสี้ยววินาทีที่เหลือยอมรับ — ตรวจพบภายหลังได้จาก snapshot `entry_ids` และส่วนต่างตอนตรวจรับ

### 6. void entry

- ทำได้: เขียน event doc ใหม่ `bulk_return_entry_void:{entryULID}` (append-only; `_id` deterministic → void ซ้ำชน 409) เฉพาะขณะ pool `OPEN`;
  fields `entry_id`, `pool_id`, `item_id`, `qty`, `notes?`; role ตามข้อ 1 (กลุ่มเพิ่ม/ย้าย entry)
- void **เปิด loan กลับ:** ลด `qty_returned` และถอด entry ออกจาก `applied_bulk_entry_ids` — VDU ของ `distribution_log` ต้องอนุญาตย้อนจาก
  `returned`/`partially_returned` กลับเป็น `partially_returned`/`active` สำหรับ path นี้ (ดูข้อ 11)
- view `bulk_return_pool_item_totals` หักยอด void ออก (`emit(..., [-qty, -1])`)

### 7. ไม่มีตั๋วคืนแยก — ตรวจรับที่ pool

- ถอด `return_ticket_id` ออกจาก pool; ไม่สร้างเอกสารตั๋วคืน; CR-121 ไม่เปลี่ยน
- ตรวจรับเขียนบน pool ตอน `SUBMITTED → RECEIVED`: `received_at/by`, `received_storage_point_id` + `received_storage_zone` (optional เป็นคู่),
  `received_items[]` หนึ่งแถวต่อ `item_id` ใน `items_summary` พอดี: `expected_qty` (ต้องเท่ายอด snapshot), `received_qty` (≤ `expected_qty`),
  `discrepancy_reason?` ∈ `damaged | missing | miscount | other`, `discrepancy_note?` (บังคับเมื่อ `other`) — ใส่เหตุผลเฉพาะแถวที่ยอดไม่ตรง
- จุดเก็บตอนรับ: ศูนย์ที่มี storage point ต้องเลือกใน UI (แบบรับของเข้าคลัง CR-139); ไม่มี → ไม่ใส่คู่ = "คลังหลัก" — บังคับที่ UI, workflow/VDU รับกรณีไม่มีคู่
- `stock_ledger` (`reason='receive'`, `ref_id='bulk_return_pool:{ulid}'`) เขียนด้วย**ยอดรับจริง**ไปยังจุดเก็บที่เลือกตอนรับ — ขอบเขตของ #660
  (ไตเติลเดิม "via return ticket" ต้องเปลี่ยน); VDU ของ `stock_ledger` อนุญาตแถวนี้อยู่แล้ว (`warehouse_staff`/`supply_coordinator`/`shelter_manager`) ไม่แก้
- **ลำดับเขียน (#660):** CAS pool เป็น `RECEIVED` ก่อน แล้ว derive แถว ledger จาก `received_items` ที่ commit แล้ว; รับซ้ำด้วยข้อมูลเดิม = replay ที่ตรวจซ้ำ
  และสร้างแถวที่ขาด, ข้อมูลต่างจากเดิมบน pool ที่ `RECEIVED` แล้ว = ปฏิเสธ
- **แถว ledger:** หนึ่งแถวต่อ item ที่ `received_qty > 0` (รับ 0 ไม่มีแถว); `qty` = `received_qty`, `occurred_at` = `received_at`,
  `lot = { note: 'bulk_return_pool', storage_point_id?, storage_zone? }`, `lot_ref` = `_id` ของแถวเอง; `_id` = `stock_ledger:` + 26 ตัวอักษร Crockford base32
  จาก SHA-256 ของ `bulk_return_receive:{poolId}:{itemId}`; put-if-absent — แถวเหมือนเดิม = replay, แถวขัดแย้ง = integrity error (fail closed)

### 8. จุดเก็บของกอง

- ใช้ storage point (CR-139 `sub_storage[].id`) + snapshot ชื่อ เหมือน `stock_ledger.lot` v5: `location_storage_point_id` + `location_storage_zone`
  — optional แต่ต้องมีเป็นคู่ (ไม่มี free text); แทน `location` free text เดิม

### 9. ชื่อกอง

- `name` ยาวสูงสุด 80 ตัวอักษร (trim, ไม่ว่าง); **ไม่ซ้ำในกลุ่ม pool `OPEN` ของศูนย์ แบบ advisory** (UI ตรวจตอนสร้าง/เปลี่ยนชื่อ) — domain: `isPoolNameTakenAmongOpen`
  เทียบแบบ normalize (NFC, trim, ยุบช่องว่าง, ตัวพิมพ์เล็ก)

### 10. ผู้คืน

- `returner_type` ∈ `evacuee | volunteer | unspecified` (แบบ `recipient_type`); `unspecified` → `returner_id = null` และ `loan_refs` ว่าง;
  `evacuee`/`volunteer` → `returner_id` ขึ้นต้น `evacuee:` / `volunteer:`

### 11. ฝั่ง loan (`distribution_log`)

- schema_v 1 → 2; เพิ่ม `applied_bulk_entry_ids[]` (id ของ entry ที่ปลดภาระ loan นี้แล้ว; marker ให้ replay แบบ idempotent)
- ปลดบางส่วนผ่าน pool ได้: `active`/`partially_returned` → `partially_returned` (หรือ `returned` เมื่อ `qty_returned = qty`)
- v3 เลิกเขียน `bulk_pool_id` — ค่าเดิมอ่านอย่างเดียวและต้องคงเดิม; #661 เก็บกวาด
- encode path apply/revert ใน VDU ตามตารางด้านล่าง

### 12. ผลรวม `loan_refs.qty`

- `sum(loan_refs.qty) ≤ entry.qty` (ผูก loan เกินของที่รับไม่ได้; ส่วนที่ไม่ผูก loan ได้)

### 13. ผู้คืนที่ไม่มี loan ค้าง

- บันทึกเป็น entry ได้ (`loan_refs` ว่าง); UI เตือน (#659) — ไม่มีอะไรให้ VDU บังคับ

### 14. สภาพของที่คืน

- ไม่เก็บ `condition_on_return` บน entry — ของเสียหายบันทึกเป็นเหตุผลส่วนต่างตอนตรวจรับ (`damaged`) ตามข้อ 7

### 15. loan ถูกปิดก่อนตัดยอดผ่านกอง (ตัดสินเพิ่ม 2026-10-25)

- กรณี loan ที่ entry อ้างใน `loan_refs` ถูกปิดไปก่อน (เช่น ถูกเคลียร์เป็น lost/waived) หรือยอดค้างคืนไม่พอ ในช่วงระหว่างจัดสรรกับตัดยอด
- **ไม่ fail และไม่ retry ค้าง:** ข้าม ref นั้น — loan ไม่ถูกแก้ ส่วน entry ยังอยู่และยังนับเข้ายอดกองตามจำนวนจริง (เท่ากับส่วนที่ไม่ผูก loan ตามข้อ 12)
- **ข้ามทั้ง ref ไม่ตัดบางส่วน:** การตัดบางส่วนต้องบันทึกจำนวนที่ตัดจริงต่อ entry เพื่อให้ void ย้อนได้ถูก ซึ่งเป็นฟิลด์ใหม่ — ไม่ทำในรอบนี้
- **เตือนที่รายการในกอง:** UI แสดงคำเตือน "ยอดยืมใบนี้ถูกปิดไปก่อนที่ของจะเข้ากอง — โปรดตรวจสอบว่าปิดถูกต้องหรือไม่"
  (คำนวณตอนอ่านจาก `loan_refs` เทียบ `applied_bulk_entry_ids` ของ loan ไม่มีฟิลด์ใหม่)
- encode: application (`assessBulkReturnRefOnLoan`) — ไม่เปลี่ยน shape หรือ `schema_v`

### 16. move ของ entry มาไม่ตามลำดับ (ตัดสินเพิ่ม 2026-10-25)

- กรณี move ของ entry เดียวกันมีหลาย seq และ seq หลังมาถึงก่อน seq ก่อนหน้า (replication ไม่เรียงลำดับ)
- **ถือเป็นรอซิงก์:** ระหว่างที่ seq ยังขาดช่วง entry ไม่นับเข้ากองใด (ไม่อยู่ในยอดกอง, snapshot `items_summary`/`entry_ids` ตอน submit และการเช็กกองว่าง)
  กองที่ move อ้างถึงแสดง "รอซิงก์" — เมื่อ seq ที่ขาดมาถึง entry กลับเข้ากองที่ถูกต้องเอง
- ย้ายหรือ void entry ที่รอซิงก์ไม่ได้ (ปฏิเสธพร้อมข้อความ) จนกว่าข้อมูลครบ
- seq ซ้ำ หรือ move ที่ต่อกันไม่ได้ (from/to ไม่ตรง) ยังถือเป็นข้อมูลผิดตามเดิม
- กรณีเดียวกันกับ move/void ที่มาถึงก่อน entry: ข้ามแล้วแสดงรอซิงก์ ไม่ให้บอร์ดของศูนย์โหลดไม่ขึ้น
- encode: domain fold (`foldEntryMoves`, `resolveBulkReturnEntries`, `findUnresolvedBulkReturnRefs`)

### 17. ค่าเริ่มต้นที่ยืนยัน (ตัดสินเพิ่ม 2026-10-25)

- ผู้คืนมี loan ของ item เดียวกันหลายใบ → จัดสรรใบที่เก่าที่สุดก่อน
- ตรวจรับได้ 0 ชิ้น → ไม่เขียน `stock_ledger` ของ item นั้น
- ศูนย์ที่มีจุดเก็บของ → ตอนตรวจรับต้องเลือกจุดเก็บ (บังคับใน UI เท่านั้น VDU ไม่บังคับ)
- void entry แล้ว loan กลับเป็น `active` แต่คง `clear_reason: bulk_dropoff` → void log นั้นภายหลังไม่ได้
- `warehouse_staff` / `supply_coordinator` แก้ loan ผ่าน path ของกองได้ (ตามสิทธิ์เพิ่ม entry ในข้อ 1)

### สิ่งที่ encode แล้ว

| หัวข้อ | encode แล้ว |
| --- | --- |
| pool | `status` 4 ค่า + transition forward-only; `lock.op` = `SUBMIT \| CANCEL`; `name` 1–80; `location_storage_point_id` + `location_storage_zone`; `items_summary`/`entry_ids` ไม่ว่างตอน submit; `cancelled_at/by`; `received_at/by`, `received_storage_*`, `received_items[]`; ถอด `return_ticket_id` และ `location` free text |
| entry | `returner_type` + กติกา `unspecified`; `sum(loan_refs.qty) ≤ qty`; role เขียนกลุ่ม entry |
| move | role เขียนกลุ่ม entry; `created_by` = ผู้เขียน |
| void | doc type `bulk_return_entry_void` v1, `_id` `bulk_return_entry_void:{entryULID}`; append-only; role กลุ่ม entry |
| `distribution_log` v2 | `applied_bulk_entry_ids`; apply: ปลดภาระ `active`/`partially_returned` + `clear_reason = bulk_dropoff` + เพิ่ม id ตัวเดียว + `qty_returned` เพิ่มขึ้นและ ≤ `qty` → `returned`/`partially_returned`; revert: `partially_returned`/`returned` + ถอด id ตัวเดียว + `qty_returned` ลดลง (≥ 0) → `active` เมื่อเป็น 0 ไม่เช่นนั้น `partially_returned`; `bulk_dropoff` ต้องมี `bulk_pool_id` (legacy) หรือ `applied_bulk_entry_ids`; void log ไม่ได้เมื่อ `applied_bulk_entry_ids` ไม่ว่าง; upgrade v1 → v2 แบบ lazy ห้าม 2 → 1 |
| view | `bulk_return_pool_item_totals` หัก void |

### VDU บังคับ กับ advisory

VDU อ่านเอกสารอื่นไม่ได้ — กติกาข้ามเอกสารจึงเป็น advisory ฝั่ง domain/application เท่านั้น

| กติกา | VDU | Advisory (domain/application) |
| --- | --- | --- |
| transition forward-only, role, ผู้เขียน (`*_by`), `name` 1–80, submit ไม่ว่าง, ความสมบูรณ์ของ `received_items`, ฟิลด์ freeze immutable, append-only ของ entry/move/void, `distribution_log` apply/revert | บังคับ | — |
| ยกเลิกได้เฉพาะเมื่อกองว่าง | ไม่ได้ | `isPoolEmpty` + lock `CANCEL` (#659) |
| void ได้เฉพาะตอน pool `OPEN` | ไม่ได้ | `canVoidEntry` |
| `pool_id` ของ void ต้องเป็น pool ปัจจุบันของ entry | ไม่ได้ | fold (`resolveBulkReturnEntries`) |
| entry ที่ void แล้วย้ายไม่ได้ | ไม่ได้ | fold / `canMoveEntry` |
| ชื่อไม่ซ้ำในกลุ่ม pool `OPEN` | ไม่ได้ | `isPoolNameTakenAmongOpen` (UI) |
| entry ที่มาช้า | ไม่ได้ | `findLateEntries` / `isLateEntry` |
| item ต้อง `returnable === true` | ไม่ได้ (catalog อยู่คนละ DB) | `isBulkReturnEligibleItem` ใน workflow เพิ่ม entry ของ #659 |
| move/void อ้าง entry ที่ยังไม่มี หรือ move seq ขาดช่วง → รอซิงก์ | ไม่ได้ (อ่าน doc อื่นไม่ได้) | fold ข้ามและรายงานใน `findUnresolvedBulkReturnRefs` (ข้อ 16) |
| loan ถูกปิดก่อนตัดยอด → ข้าม ref และเตือน | ไม่ได้ | `assessBulkReturnRefOnLoan` (ข้อ 15) |

## Amends — ข้อความเดิมที่ถูกแก้

**CR-134 (`docs/changes/03-C-supply/CR-134-bulk-return-claim-recovery.md`)**

- §1.1: "`bulk_return_pool` จัดเก็บเพียงยอดรวมเชิงสถิติ (Aggregate Quota): `total_received_qty`,
  `claimed_qty`, และ `unclaimed_quota`"
  และ §4.3 (pool schema_v 2: `item_id`, `stock_ledger_id`, `total_received_qty`, `claimed_qty`,
  `unclaimed_quota`, `claim_ids`, `status 'ACTIVE' | 'EXHAUSTED' | 'CLOSED'`)
  → **กติกาใหม่:** pool v3 ไม่มี field aggregate เหล่านี้ทั้งหมด — เป็น header (`name`, `status OPEN | SUBMITTED | RECEIVED | CANCELLED`,
  snapshot `items_summary`/`entry_ids` ตอน submit); ยอดต่อ item มาจาก entry/move/void ผ่าน view
- §1.1 ข้อ 1: "ระบบต้องตัดลดโควตาใน `bulk_return_pool` (CAS update)" และ §3 / §5 / §9 (claim flow:
  `bulk_return_claim`, `claim_ids`, Pre-flight Quota Check, Lazy Upgrade v1 → v2, forward recovery 5 ขั้น)
  → **กติกาใหม่:** ไม่มีการตัดโควตาและไม่มี claim — ปลดภาระ/ลดยอดยืมเกิดจาก entry ที่มี `loan_refs[]`
  (entry ก่อน แล้วค่อย loan ด้วย marker `applied_bulk_entry_ids`); Lazy Upgrade v1 → v2 ของ pool **ยกเลิก** (v1/v2 frozen, ไม่ migrate)
- §2.2: "**ห้ามสร้าง `stock_ledger` ซ้ำตอนเคลียร์ของยืม:** การตรวจรับพัสดุกองรวมเข้าคลังได้บันทึก `stock_ledger`
  `reason='receive'` ไปแล้ว ณ ขั้นตอนสร้าง `bulk_return_pool` …"
  → **กติกาใหม่:** การสร้าง `bulk_return_pool` v3 และการเพิ่ม entry **ไม่เขียน `stock_ledger`** — ของยังไม่ถือว่า
  รับเข้าคลังจนกว่า pool จะ `SUBMITTED → RECEIVED` โดยลง ledger ด้วยยอดรับจริงไปยังจุดเก็บที่เลือกตอนรับ (#660)
  ส่วนข้อห้ามไม่ให้เขียน ledger ซ้ำตอนจับคู่กับ loan ยังคงอยู่
  (pool v3 ไม่มี `stock_ledger_id` และไม่ใช้ `stock_ledger:{operationUlid}` — `_id` ของแถว receive derive จาก pool + item; scheme เดิมใช้กับ pool v1/v2 ที่ frozen เท่านั้น)
- §14 (Schema Versions Summary: "`bulk_return_pool`: ยกระดับเป็น `schema_v = 2`") → เป็น `schema_v = 3` (ใหม่); v1/v2 frozen
- `bulk_return_claim` (§2.32 ของ schema.md; CR-134 §4.1, §7, §12) → **legacy: frozen ตอน deploy, ลบใน #661**
- **ไม่เปลี่ยน:** `loan_return_reservation` (CR-134 §15) — ผลต่อ flow ปลดภาระโหมด `BULK` เป็นเรื่องของ #659

**CR-121:** ไม่ได้รับผลกระทบ (ไม่มีตั๋วคืนแยก และ `stock_ledger` แถว `receive` ที่ `ref_id` ขึ้นต้น `bulk_return_pool:` ใช้ได้ตามเดิม)

**ยืนยันตามแบบแผนเดิม:**

- **จำนวน = จำนวนเต็มบวกเท่านั้น:** ใช้ `positiveWholeQtySchema` ของ `food-supplies/shared.ts` ซึ่ง ship แล้ว
  (fix "reject fractional item quantities") และใช้กับ `distribution_log`, `bulk_return_claim`, `loan_return_reservation`

**item ที่รับเข้ากองได้ (ใช้ field catalog เดิม):**

- **กติกา:** รับเฉพาะ item ที่ catalog `returnable === true` — ไม่ดู `type_class` (catalog `returnable` เป็นแหล่งความจริง
  เดียว แบบเดียวกับ `distribution_log.is_returnable`) และ **ไม่ปฏิเสธ item ที่ `deactivated`** (ของที่ยืมไปก่อน catalog
  ปิดใช้งานต้องคืนได้). ไม่เพิ่ม field ใหม่
- **#658:** predicate `isBulkReturnEligibleItem(item: { returnable?: boolean })` ใน `bulk-return-entry.ts` + unit test
- **#659:** workflow เพิ่ม entry อ่าน item จาก catalog แล้วปฏิเสธก่อนเขียน `bulk_return_entry` ถ้า predicate ไม่ผ่าน.
  VDU บังคับไม่ได้ (catalog อยู่คนละ DB และ VDU อ่านเอกสารอื่นไม่ได้) — เป็นการบังคับระดับ application

## Affected files

- `docs/data/schema.md` — §2.30 (v2), §2.31 (v3), §2.31.1, §2.31.2, §2.31.3 (ใหม่), §2.32 (legacy note), §7, §8, frontmatter
- `frontend/src/lib/features/distribution/domain/food-supplies/` — pool v3 + entry + entry-move + entry-void
  (Zod schema, factories, `canAppendToPool`, `canVoidEntry`, `assertPoolTransition`, `resolveBulkReturnEntries`, `summarizePoolItems`,
  `isPoolEmpty`, `findLateEntries`, `isPoolNameTakenAmongOpen`, `isBulkReturnEligibleItem`) + `distribution-log` (`applyBulkEntryToLog`, `revertBulkEntryFromLog`) + tests
- `frontend/src/lib/server/shelter-access-design.ts` — VDU (allowed types, v3 rules, role, freeze v1/v2, append-only
  entry/move/void, `distribution_log` v2 path apply/revert), Mango index declaration (`BULK_RETURN_ENTRY_MANGO_INDEXES`) + tests
- `frontend/src/lib/features/shelters/domain/views.ts` + `view-manifest.ts` — view `bulk_return_pool_item_totals`
  (`_design/app` v6) + tests
- `frontend/src/lib/server/shelters.admin.ts`, `frontend/src/lib/features/shelters/server/provisioner.ts`,
  `frontend/scripts/redeploy-access.ts`, `frontend/scripts/seed/registry-shelters.ts` — deploy index
- ไม่แตะ `TICKET_DISTRIBUTION_MANGO_INDEXES`; ส่วน UI/workflow อยู่ #659/#660 ซึ่ง merge ใน PR เดียวกัน

## Data / schema impact

- `bulk_return_pool` **schema_v 2 → 3**: shape ใหม่ทั้งหมด (ไม่ใช่ additive) — v3 ไม่มี `item_id`,
  `stock_ledger_id`, `total_received_qty`, `claimed_qty`, `unclaimed_quota`, `claim_ids`, `ticket_id`, `shift_id`, `return_ticket_id`
- doc type ใหม่: `bulk_return_entry` v1, `bulk_return_entry_move` v1, `bulk_return_entry_void` v1 (append-only, ห้ามลบ)
- v3 ยังไม่ปล่อย: shape ของ pool/entry/move เปลี่ยนในที่เดิมก่อนปล่อยครั้งแรก — ไม่ bump `schema_v`
- `distribution_log` (§2.30) **schema_v 1 → 2**: เพิ่ม `applied_bulk_entry_ids`; เอกสาร v1 ยังใช้ได้
- **Migration note:** pool v1/v2 ไม่ migrate — frozen ตอน deploy (อ่านอย่างเดียว, ห้าม downgrade/แก้) แล้ว #661 ลบ
  พร้อม `bulk_return_claim`; pool v3 ห้ามลด `schema_v`. `distribution_log` v1 upgrade แบบ lazy เป็น v2 ตอน path bulk v3 เขียน
  `applied_bulk_entry_ids` ครั้งแรก — ไม่ backfill; ห้ามลด 2 → 1; `bulk_pool_id` เดิมอ่านอย่างเดียวจนกว่า #661 เก็บกวาด
- ต้อง redeploy design doc `_design/access` และ `_design/app` + index บน shelter DB **ที่ provision แล้ว**

## Rollout / rollback

- **Rollout (merge ครั้งเดียว):**
  1. #658 + #659 + #660 รวมใน PR เดียวและ merge ครั้งเดียว (ไม่ merge #658 ก่อนโดยลำพัง — หลัง redeploy VDU ปฏิเสธ flow เดิมของ pool v2 / claim)
  2. redeploy design doc (`_design/access`, `_design/app`) + indexes ครั้งเดียวบน shelter ที่มีอยู่ด้วย `frontend/scripts/redeploy-access.ts`;
     provisioner ครอบคลุม shelter ใหม่ (deploy design doc รวม VDU ให้อัตโนมัติ)
  3. #661 เก็บกวาด legacy หลังจากนั้น: pool v1/v2, `bulk_return_claim`, `bulk_pool_id` บน `distribution_log` และโค้ด legacy
- **Rollback:** revert โค้ดได้ แต่ doc v3 / entry / move / void ที่เขียนแล้วคงอยู่ (event doc append-only, VDU เก่าไม่รู้จัก type ใหม่
  จึงอาจปฏิเสธการ update แต่ไม่ลบ) — ถ้า rollback VDU กลับเป็นรุ่นเก่า pool v1/v2 กลับมาแก้ได้อีก แต่ pool v3
  ที่สร้างแล้วจะแก้ผ่าน VDU เก่าไม่ได้ (schema_v ไม่รู้จัก) และ `distribution_log` v2 อาจถูก VDU เก่าปฏิเสธ → ควร rollback เฉพาะก่อนมีการใช้ flow ใหม่จริง
- ลบ index/view ที่ deploy แล้วไม่จำเป็น (ไม่กระทบข้อมูล)

## Decision log

- 2026-10-22 — proposed (draft คู่กับ #658; D1–D5 ตัดสินแล้วโดย kong; จำนวนเต็มยืนยันตามแบบแผนเดิม; item ที่รับได้ = catalog `returnable === true`)
- 2026-10-22 — decided โดย kong ([คอมเมนต์](https://github.com/r202-coe-psu/tent/pull/768#issuecomment-6339918664)): ข้อ 1–14 ใน Decisions
  (role, deploy ใน PR เดียว, `name`/จุดเก็บแก้ได้ตอน `OPEN`, `CANCELLED`, fence + entry ค้าง, void + เปิด loan กลับ, ตรวจรับที่ pool ไม่มี `return_ticket_id`,
  storage point, ชื่อ ≤ 80 ไม่ซ้ำแบบ advisory, `returner_type`, `applied_bulk_entry_ids` + `distribution_log` v2, `loan_refs ≤ qty`,
  ผู้คืนไม่มี loan บันทึกได้, ไม่เก็บ `condition_on_return`); CR-121 ไม่ได้รับผลกระทบ; **Flagged:** `system_admin` รอ kong ตัดสิน;
  รอ kong กำหนดเลข CR (หลีกเลี่ยง CR-185 ที่ถูกใช้แล้วบน branch อื่น) และวิธี track
- 2026-10-25 — kong ตัดสินเพิ่ม: `system_admin` คงพฤติกรรม `isRole()` เดิม (แทน "ไม่รวม system_admin"); ข้อ 15 loan ถูกปิดก่อนตัดยอด → ข้าม ref + เตือน;
  ข้อ 16 move มาไม่ตามลำดับ → รอซิงก์; ข้อ 17 ยืนยันค่าเริ่มต้น 5 ข้อ
- 2026-10-25 — approved (kong) → CR-193 (ย้ายจาก `draft-bulk-return-pool-redesign.md`, track ด้วยไฟล์ CR); เลขถัดจาก CR-192 บน `develop`; amends CR-134; หมายเหตุ `system_admin` ตัดสินแล้วข้างบน
- 2026-10-25 — kong ตัดสินแก้ D3: ย้าย entry แล้วตัดยอด loan ตาม `loan_refs` เมื่อ pool ปลายทางยัง `OPEN` และไม่มี `lock` (idempotent ผ่าน `applied_bulk_entry_ids`, กติกาข้าม ref เดียวกับข้อ 15) — แทนข้อความเดิม "ย้ายไม่แตะ `distribution_log`"; แก้ review finding B1 (entry มาช้าที่ย้ายเข้า pool `OPEN` ไม่เคยตัด loan → คืนซ้ำได้)
- 2026-10-25 — implementation (perf, ไม่เปลี่ยนกติกา): การอ่านต่อ entry/pool (move, void, submit, cancel, loan refs) อ่านเฉพาะขอบเขตแทนการ scan event log ทั้ง shelter — เพิ่ม Mango index `(type, to_pool_id)` บน `bulk_return_entry_move` (หา entry ที่ย้ายเข้า pool; ใช้ร่วมกับ `(type, pool_id)` เดิม); overview ข้าม pool ยังอ่านทั้ง log
- 2026-10-26 — `_design/app` เลื่อนเป็นเวอร์ชัน 6 เพราะ develop ใช้ v5 กับ CR-192 (`station_logs_by_station`) แล้ว — ไม่เปลี่ยนกฎหรือ view ของ CR นี้
