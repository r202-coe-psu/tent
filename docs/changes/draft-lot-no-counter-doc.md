---
id: draft
title: lot_no ไม่ซ้ำ — counter doc `lot_counter` ต่อศูนย์ต่อวัน (แก้คำตัดสิน CR-088 ที่ให้ซ้ำได้)
status: proposed
date: 2026-11-08
requested_by: Dev Team B Issue #1110 (คำตอบของ Fishcanwalk และ Hopewalk ใต้ issue) — Inventory / Supply
decided_by: 
layer: volatile
affects:
  - docs/data/schema.md §2.1 (`lot.lot_no` — ตัดข้อความ "ชนกันได้ / ไม่ใช้ counter doc") + §2 doc type ใหม่ `lot_counter` + §3 index/ตาราง doc type ถ้ามี
  - docs/changes/03-C-supply/CR-088-stock-ledger-lot-storage-zone.md (ถูก amend ด้วย draft นี้ — ไม่แก้ไฟล์ CR-088)
  - schema_v `lot_counter` 1 (doc type ใหม่) · `stock_ledger` ไม่ bump (รูปร่าง doc ไม่เปลี่ยน)
  - VDU `shelter_*` — frontend/src/lib/server/shelter-access-design.ts (whitelist type `lot_counter` + กฎ monotonic ก่อน `_admin` bypass) · deploy ด้วย `pnpm redeploy:access`
  - frontend/src/lib/features/operations/domain/operations.ts (`nextLotNos`, `lotDateStamp`)
  - frontend/src/lib/features/operations/data/ (ลูปจองเลขตัวกลาง — ใหม่)
  - frontend/src/lib/server/lot-number.ts (`allocateLotNos` — BFF รับบริจาค)
  - frontend/src/lib/features/kitchen/data/kitchen.remote.ts (`allocateLotNos` — ตรวจรับผลผลิตครัว)
  - frontend/src/lib/features/operations/data/operations.remote.ts (`allocateLotNos` — หน้า stock: `receiveStock`, `receiveWalkInDonation`, `receiveDonationBatch`)
why: >
  `lot_no` ซ้ำได้ในศูนย์เดียวกันวันเดียวกัน (รับพร้อมกัน / ค้นเลขเดิมไม่สำเร็จแล้วเริ่ม 001 ใหม่ /
  ค้นติด limit) และแก้ทีหลังไม่ได้เพราะ `stock_ledger` append-only. เป้าหมายของเลขล็อต (#1069, #1070)
  คือกันหยิบ/ปรับยอดผิดล็อต — เลขซ้ำทำให้เป้าหมายนั้นไม่สำเร็จ. Project owner เลือกตัวเลือก 1C (#1110).
migration: >
  Additive. doc type ใหม่ `lot_counter` schema_v 1; ไม่แตะ `stock_ledger` เดิม ไม่ backfill.
  Counter ของวัน D ถูกสร้างตอนจองครั้งแรกของวันนั้น โดย seed จาก `lot_no` สูงสุดที่มีอยู่แล้วของวัน D
  (ครั้งเดียว) เพื่อไม่ให้ชนกับแถวที่ออกก่อน deploy
---

# draft-lot-no-counter-doc — `lot_counter` กันเลขล็อตซ้ำ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ออก `lot_no` จาก counter doc `lot_counter:{L-YYMMDD}` (1 doc ต่อศูนย์ต่อวัน)
>   จองช่วงเลขด้วย `_rev` ของ CouchDB แทนการค้น `stock_ledger` แล้วนับต่อ
> - **เพื่อใคร/ทำไม:** คลัง/ครัวที่ติดป้ายล็อต — เลขต้องไม่ซ้ำ จึงจะแยกล็อตตอนหยิบ/ปรับยอดได้
> - **dev ต้อง build:** doc type `lot_counter` + VDU · ตรรกะจองเลขที่เดียวใช้ร่วมทั้ง 3 จุดออกเลข
>   (BFF รับบริจาค, ครัว, หน้า stock) · ยกเลิก fallback "ค้นไม่สำเร็จ → เริ่ม 001" ของ BFF
> - **กระทบ:** amend CR-088 · schema.md §2.1 + doc type ใหม่ (schema_v 1) · `stock_ledger` ไม่ bump ·
>   รูปแบบเลข `L-YYMMDD-XXX` และลำดับร่วมทุกสินค้า **คงเดิม** (คำถามที่ 2 = A)

---

## 1. Requirements

### Counter doc

- **FR-1** — เพิ่ม doc type `lot_counter` ใน `shelter_<code>` — `_id = lot_counter:{L-YYMMDD}`
  (เช่น `lot_counter:L-261102`); 1 doc ต่อศูนย์ต่อวัน; ลำดับใช้ร่วมทุกสินค้า
- **FR-2** — `lot_counter.last` = เลขลำดับล่าสุดที่ถูกจองแล้วของวันนั้น (int ≥ 0)
- **FR-3** — เลขที่ออกยังเป็น `L-YYMMDD-XXX` (`XXX` = ลำดับ 3 หลัก zero-pad; เกิน 999 ให้ขยายเป็น 4 หลักขึ้นไป
  ไม่ตัดทิ้ง)

### การจองเลข (ตรรกะเดียว ใช้ร่วมทั้ง 3 จุดออกเลข)

- **FR-4** — จอง `count` เลข: อ่าน `lot_counter:{L-YYMMDD}` → `PUT` ค่าใหม่ `last' = last + count` พร้อม `_rev` ที่อ่านมา →
  ได้เลข `last+1 … last+count`
- **FR-5** — `PUT` ได้ `409 Conflict` → อ่านใหม่แล้วลองอีกครั้ง; จำกัดจำนวนครั้ง (ค่าเริ่มต้น 5 —
  ดู [NEEDS DECISION] ND-2)
- **FR-6** — ยังไม่มี doc ของวันนั้น → สร้างด้วย `PUT` ไม่มี `_rev`; ค่าเริ่มต้น `last` = `lot_no` ลำดับสูงสุดของวันนั้นที่มีอยู่แล้วใน
  `stock_ledger` (ค้นครั้งเดียวตอนสร้าง) ถ้าไม่มี = 0; `409` จากการสร้างซ้อน → อ่านแล้วเข้าขั้น FR-4;
  ค้นเลขสูงสุดไม่สำเร็จ → **throw error** ตาม FR-8 (ห้ามถือว่า = 0)
- **FR-7** — ตรรกะจองเลข (FR-4–FR-6, FR-8) มีที่เดียวใน feature `operations` และรับตัวเชื่อม CouchDB เข้ามา
  (`get(id)`, `put(doc)` ที่บอกได้ว่าสำเร็จหรือชน `409`, `seedMax(stamp)`) — ส่วนที่ไม่แตะ CouchDB (สร้าง `_id`,
  คำนวณ `last` ใหม่, แปลงเป็น `L-YYMMDD-XXX`) อยู่ใน `operations/domain`; ลูปจองเลขอยู่ใน `operations/data`
  และ export ผ่าน barrel. ทั้ง 3 จุดออกเลข — BFF รับบริจาค (`lot-number.ts`, `adminRaw`), ครัว
  (`kitchen.remote.ts`, `repo`), หน้า stock (`operations.remote.ts`, `repo`) — ส่งตัวเชื่อมของตัวเองเข้าไป;
  ห้ามมีลูปจองเลขสองสำเนา
- **FR-8** — จองเลขไม่สำเร็จ (หมดจำนวนครั้ง / ติดต่อ CouchDB ไม่ได้ / 5xx) → **throw error** ให้ผู้ใช้เห็นและกดซ้ำได้;
  **ห้าม** fallback เริ่มนับ `001` ใหม่ (ปัจจุบัน fallback นี้มีเฉพาะ BFF รับบริจาค; ครัวและหน้า stock throw อยู่แล้ว)
- **FR-9** — จองแล้วเขียน `stock_ledger` ไม่สำเร็จ → เลขที่จองไว้ถูกทิ้ง (เว้นลำดับ) ไม่ rollback counter;
  อนุญาตเลขไม่ต่อเนื่อง ห้ามซ้ำ
- **FR-10** — `lot_counter` อยู่ใน `shelter_*` เดิม (ไม่เพิ่ม DB); replicate ไป edge ตามปกติ

### VDU / สิทธิ์

- **FR-11** — เพิ่ม `lot_counter` ใน VDU whitelist ของ `shelter_*`
- **FR-12** — VDU บังคับ (วางก่อน `_admin` bypass แบบเดียวกับ `evacuee_qr` CR-233 ⇒ มีผลกับ admin และ
  `repl:<code>` ด้วย): `last` เป็น int ≥ 0 และ **เพิ่มขึ้นเท่านั้น** (`new.last > old.last`); `_id` ต้องตรง pattern
  `lot_counter:L-{6 หลัก}` (prefix เดียวกับ `lot_no` ของวันนั้น). **ห้ามลบ** — เฉพาะผู้ที่ไม่ใช่ `_admin` (admin ลบได้เพื่อ unseed/reset; ลบแล้วไม่ทำให้เลขซ้ำ
  เพราะ FR-6 seed ใหม่จากเลขสูงสุดใน ledger)
- **FR-13** — สิทธิ์เขียน `lot_counter` ผูกกับสิทธิ์รับของ: **ใครเขียน `stock_ledger` แบบรับเข้าในศูนย์นี้ได้ตาม VDU
  ก็เขียน `lot_counter` ได้** (ครอบคลุม role ครัวตาม CR-121, warehouse / shelter_manager, `donation_staff` ตาม CR-227)
  — ไม่ไล่ชื่อ role แยก ไม่ขยายสิทธิ์อื่น; BFF (`_admin`) และ repl user ของ edge (`repl:<code>`, #1298) ผ่านในฐานะ
  admin แต่ยังติดกฎ FR-12 ([NEEDS DECISION] ND-3)
- **FR-14** — ตอน deploy รัน `pnpm redeploy:access` เพื่ออัปเดต VDU ทุก `shelter_*`

### Domain

- **FR-15** — `nextLotNos` (ค้นแล้วนับต่อ) ถูกแทนที่ด้วยตัวสร้างสตริงจาก `(date, firstSeq, count)` —
  ตัดตรรกะหา max จาก `existing[]`; `lotDateStamp` คงอยู่ (ดู §4)
- **FR-16** — ลบข้อความ "ไม่ atomic / ยอมรับเลขซ้ำ" ใน JSDoc ของ `nextLotNos` และ `allocateLotNos` ทั้ง 3 จุด

---

## 2. Spec delta

### 2.1 `docs/data/schema.md` — doc type ใหม่ `lot_counter` · schema_v 1

`lot_counter:{L-YYMMDD}` ใน `shelter_<code>` · common envelope ตาม schema.md (ไม่มี field พิเศษเกิน envelope + ตารางนี้)

| Field  | ชนิด    | req | หมายเหตุ                                                 |
| ------ | ------- | --- | -------------------------------------------------------- |
| `last` | int ≥ 0 | req | ลำดับล่าสุดที่จองแล้วของวันนั้น; เพิ่มขึ้นเท่านั้น (VDU) |

### 2.2 `docs/data/schema.md` §2.1 — `lot.lot_no`

|            | ข้อความ                                                                                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Before** | label สำหรับคนอ่านเท่านั้น ไม่มี business rule ผูก; ชนกันในเคสรับพร้อมกันได้ (ยอมรับ); ไม่บังคับ unique                                                                                                    |
| **After**  | ออกจาก `lot_counter` ⇒ **ไม่ซ้ำภายในศูนย์เดียวกันบน CouchDB ตัวเดียวกัน**; ยังเป็น label ไม่ใช่ identity ของแถว (identity = `_id` ของ `stock_ledger` / `lot_ref`); แถวเก่าก่อน CR นี้ไม่รับประกันว่าไม่ซ้ำ |

### 2.3 การ amend CR-088

CR-088 (status `done`) ไม่ถูกแก้ไฟล์. ข้อความของ CR-088 ที่ draft นี้แทนที่:

- "ชนกันได้ในเคสรับพร้อมกันแบบหายาก ยอมรับความเสี่ยงนี้ได้"
- "ไม่ใช้ counter doc" (อ้างในเหตุผลของ `lot-number.ts`)
- "ค้นเลขเดิมไม่สำเร็จให้ restart `001` เพื่อไม่ให้ intake ติด"

เมื่อ approve ให้ `_index.md` แถว CR-088 ระบุ "amended by CR-NNN" (ตามข้อกำหนดของ index; ไม่แก้ไฟล์ CR-088)

---

## 3. Acceptance

- **AC-1** — รับ 2 รายการพร้อมกัน (จับคู่ใดก็ได้จาก BFF บริจาค / ตรวจรับครัว / หน้า stock) ในศูนย์/วันเดียวกัน → เลขที่ได้ไม่ซ้ำ (test: จอง
  concurrent, `409` แล้ว retry ได้ช่วงที่ไม่ทับกัน)
- **AC-2** — จอง `count=3` ตอน `last=7` → `L-…-008`, `-009`, `-010` และ `last=10`
- **AC-3** — `_find`/CouchDB ล่ม → จองเลขโยน error; ไม่มีแถว `stock_ledger` ถูกเขียนด้วยเลข `001` ใหม่
- **AC-4** — วันที่มี `stock_ledger` ที่มี `lot_no` อยู่แล้วแต่ยังไม่มี counter → counter ถูกสร้างโดย `last` = ลำดับสูงสุดเดิม;
  เลขถัดไปไม่ชนกับแถวเดิม
- **AC-5** — VDU ปฏิเสธการเขียน `lot_counter` ที่ `last` ไม่เพิ่ม, `last` ติดลบ/ไม่ใช่ int หรือ `_id` ผิด pattern
  (รวมเมื่อเขียนด้วย `_admin`); ปฏิเสธการลบจากผู้ที่ไม่ใช่ `_admin`; ปฏิเสธ user ที่เขียน `stock_ledger` รับเข้าไม่ได้
- **AC-6** — ทั้ง 3 จุดออกเลข (BFF บริจาค, ครัว, หน้า stock) เรียกลูปจองเลขตัวเดียวกัน (ไม่มีโค้ดค้น `stock_ledger`
  เพื่อนับเลขเหลืออยู่)
- **AC-7** — รูปแบบ `L-YYMMDD-XXX` คงเดิม; test เดิมของ format ยังผ่าน
- **AC-8** — replicate `lot_counter` จาก edge ขึ้น central ด้วย `repl:<code>` (#1298) ผ่าน VDU ได้

---

## 4. Out of scope / ไม่เปลี่ยน

- **รูปแบบเลข** — คง `L-YYMMDD-XXX` ลำดับร่วมทุกสินค้า (ไม่ใช้ `L-YYMMDD-<SKU>-XXX`; คำถามที่ 2 ของ #1110 = A)
- **เขตเวลาของ `YYMMDD`** (คำถามที่ 3 ของ #1110) — **ไม่ได้ตัดสินใน CR นี้**. เจ้าของให้เช็ค TZ ของ server
  production ก่อน: ถ้าเป็นเวลาไทย ไม่ต้องแก้; ถ้าเป็น UTC ให้แก้ `lotDateStamp` เป็น Asia/Bangkok ทั้ง
  client/server เป็น bug fix แยก (ไม่ต้อง CR ใหม่ ถ้าไม่เปลี่ยนรูปแบบเลข) — ดู ND-1
- **ข้อมูลเก่า / script ที่ใส่ `lot_no` เอง** — ไม่ backfill ไม่ de-dup แถวที่ซ้ำอยู่แล้ว
- **Edge CouchDB** — ดู §5 (ความเสี่ยงคงเหลือ)
- **`ticket_no`** (`tickets/domain/ticket-no.ts`) — ยังออกเลขแบบค้นแล้วนับต่อ (อ้างเหตุผลเดียวกับ CR-088); CR นี้ไม่เปลี่ยน
- Rename draft → `CR-NNN-…` + ลง `_index.md` จนกว่า owner อนุมัติ

---

## 5. ความเสี่ยงคงเหลือ

| กรณี                                                            | ผล                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| ใช้ edge CouchDB ตอน central ล่ม แล้ว central/edge จองเลขแยกกัน | counter ของวันเดียวกันสองฝั่งได้ช่วงเลขชุดเดียวกัน → เกิด conflict ตอน replicate; **CR นี้ไม่กันกรณีนี้** (ดู ND-4) |
| แถวเก่า / script ใส่เลขเอง                                      | อาจซ้ำอยู่แล้ว ไม่แก้ย้อนหลัง                                                                                       |
| จองแล้วเขียน ledger ล้มเหลว                                     | เลขเว้น ไม่ซ้ำ                                                                                                      |

**ต้นทุน:** +1 request อ่าน + 1 เขียน counter ต่อการรับ 1 ครั้ง (ลดการ `_find` ที่ใช้ index ของ `stock_ledger`);
retry เมื่อรับพร้อมกันถี่

---

## 6. [NEEDS DECISION]

- **ND-1** — ยืนยันว่าคำตอบ "เลือก C" ของ Fishcanwalk ใน #1110 หมายถึง **คำถามที่ 1 ตัวเลือก C** และผลเช็ก TZ production
  (ยังไม่ได้ตรวจ) ก่อนตัดสินว่าต้องแก้ `lotDateStamp` หรือไม่
- **ND-2** — จำนวน retry สูงสุดเมื่อ `409` (draft ใช้ 5) และ FR-8 ที่ **ไม่ให้ intake ผ่านเมื่อจองเลขไม่ได้** ซึ่งต่างจากเหตุผลเดิมของ
  CR-088 (ไม่ให้หน้าประตูรับบริจาคติด) — ยืนยันว่ายอมรับ
- **ND-3** — ยืนยันกฎ FR-13 "ใครเขียน `stock_ledger` รับเข้าได้ ก็เขียน `lot_counter` ได้" (แตะ role/permission ต้องให้
  owner เคาะ)
- **ND-4** — กรณี edge/central ชนกัน: เลือกกลยุทธ์ conflict (เช่น รวมด้วย `max(last)` แล้วยอมรับว่าเลขที่ออกช่วงตัดขาดอาจซ้ำ) หรือ
  ยอมรับเป็น residual risk ไม่ทำอะไรใน CR นี้

---

## 7. Decision log

- 2026-11-08 — proposed (จาก #1110: ข้อ 1 = C, ข้อ 2 = A, ข้อ 3 = เช็ค TZ server ก่อน)
- 2026-11-10 — แก้ตาม review PR #1287: เพิ่มจุดออกเลขที่ 3 (หน้า stock, decision sync 2026-11-06), FR-7 ตรรกะกลาง +
  ตัวเชื่อม CouchDB, FR-12 กฎ VDU ก่อน `_admin` bypass, FR-13 ผูกสิทธิ์กับการรับของ, AC-8 replicate, ใช้ `_id` `lot_counter:{L-YYMMDD}` ทั้งไฟล์ (ตรงกับ prefix `lot_no` ในระบบ)
