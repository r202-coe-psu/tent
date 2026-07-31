---
id: CR-060
title: "CR-060 scope amendment — worker projector seeds donation_need_counter.qty_target"
status: approved
date: 2026-07-28
updated: 2026-07-29
requested_by: ทีมพัฒนา (Team A — ชิโน, นัท, กาน)
decided_by: เจ้าของโครงการ (PR review #130, 2026-07-29)
layer: volatile
affects:
  - docs/changes/CR-045-donation-quota-atomic-reservation.md (affects list — เพิ่ม worker/src/worker/projectors/)
  - worker/src/worker/projectors/needs.py (หรือ module ใหม่ในกลุ่มเดียวกัน)
  - worker/src/worker/couch/processor.py (§ donation_campaign CDC dispatch, บรรทัด ~96)
  - packages/tent-model/src/tent_model/donation_need_counter.py (schema_v 1 — สร้างตาม CR-045)
  - worker/tests/projectors/test_projectors.py
  - CR-045 Migration & Maintenance §One-time Backfill Script — ต้องรวม qty_target seed ด้วย
---
# CR-060 — worker projector seeds `donation_need_counter.qty_target`

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เพิ่มให้ worker เขียน `qty_target` ลง Mongo collection `donation_need_counter`
  (ที่ CR-045-donation-quota-atomic-reservation นิยามไว้) ตอนรับ CDC event ของ `donation_campaign` — เขียนครั้งแรกครั้งเดียว
  (`$setOnInsert`) ไม่ sync ซ้ำเมื่อแคมเปญถูกแก้ทีหลัง
- **เพื่อใคร/ทำไม:** FastAPI (`backend/`) ไม่มี CouchDB client — อ่าน `qty_target` ไม่ได้เอง ถ้าไม่มี
  ค่านี้ใน Mongo ก่อน CR-045 จะทำ atomic reserve (`find_one_and_update` guard `$expr`) ไม่ได้เลย
- **dev ต้อง build:** ต่อยอด hook ที่มีอยู่แล้วใน `processor.py:96` (รับ event `donation_campaign`)
  ให้ upsert `donation_need_counter` ต่อ item ใน `needs[]` — เขียนเฉพาะ field ที่ตัวเองเป็นเจ้าของ
  (`qty_target`, `shelter_code`, `campaign_id`, `item_id`, `created_at`); ห้ามแตะ `reserved_qty`
  (FastAPI เป็นเจ้าของ field นั้น)
- **กระทบ scope:** ขยาย `affects:` ของ CR-045 ที่ approved แล้วให้ครอบคลุม
  `worker/src/worker/projectors/` เพิ่ม — ไม่กระทบ schema_v ใดๆ (collection ใหม่ยังเป็น schema_v 1
  ตามที่ CR-045 กำหนดไว้เดิม)

## Why

CR-045-donation-quota-atomic-reservation กำหนด `DonationsUseCase.create()` (FastAPI) ให้เช็ค quota แบบ atomic ด้วย
`find_one_and_update` guard `$expr: reserved_qty + qty ≤ qty_target` — แต่ตรวจโค้ดจริงพบว่า:

- `backend/apiapp/` ไม่มี CouchDB client ใดๆ เลย คุยกับ Mongo อย่างเดียว (สอดคล้อง two-plane
  architecture: `CouchDB → worker → MongoDB → FastAPI`)
- `qty_target` มาจาก `donation_campaign.needs[].qty_target` ซึ่งอยู่ใน CouchDB เท่านั้น
- collection ที่มีอยู่แล้ว (`public_needs`) เป็นค่า aggregate ข้ามแคมเปญต่อ item (ไม่ใช่ target ต่อ
  แคมเปญเดียว) และ recompute เต็มรอบทุกครั้ง — ใช้แทนไม่ได้

สรุป: ไม่มีช่องทางใดในระบบปัจจุบันที่ทำให้ FastAPI รู้ `qty_target` ได้ ถ้า worker ไม่เป็นคนส่งเข้า Mongo
ก่อน — และงานนี้ไม่อยู่ใน `affects:` เดิมของ CR-045 (ระบุแค่ `backend/apiapp/modules/donations/*` +
`worker/src/worker/retention/job.py`) จึงต้องขอ scope เพิ่มแยกเป็น CR ใหม่แทนที่จะแก้เงียบๆ

## Change

### Before

`worker/src/worker/couch/processor.py:96` รับ event `donation_campaign`/`supply_item` แล้ว trigger
แค่ recompute `public_needs` (`worker/src/worker/projectors/needs.py`) — ไม่มี path ใดเขียนข้อมูล
ระดับ per-campaign ลง Mongo

### After

- เมื่อ processor รับ CDC event `type: donation_campaign` (create หรือ update, `status: open`):
  ต่อทุก entry ใน `needs[]` → upsert หนึ่ง `donation_need_counter` doc คีย์
  `_id = f"{shelter_code}:{campaign_id}:{item_id}"`
- upsert ใช้ `$setOnInsert` สำหรับ `qty_target`, `shelter_code`, `campaign_id`, `item_id`,
  `reserved_qty: Decimal("0")`, `created_at` — และ `$set` เฉพาะ `updated_at`
- ถ้า doc มีอยู่แล้ว (`_id` ซ้ำ) → `qty_target` เดิม**ไม่ถูกเขียนทับ** แม้แคมเปญจะถูกแก้ไขค่า
  `qty_target` ทีหลัง (ตรงกับมติที่ตกลงไว้แล้วว่า `qty_target` เป็นค่า fixed จนกว่าจะมี
  Recalculation CLI ตาม CR-045 §Migration & Maintenance รันสั่ง recompute ตรงๆ)
- campaign ปิด (`status: closed`) หรือ item หลุดจาก `needs[]` → **ไม่ลบ** `donation_need_counter`
  doc ที่มีอยู่ (อาจมี `reserved_qty` ค้างอยู่ที่ยังต้องคืนโควตาผ่าน cancel/expire) — cleanup อยู่นอก
  scope ของ CR นี้

## Requirements

- **FR-1** — worker upsert `donation_need_counter` ต่อทุก item ใน `donation_campaign.needs[]`
  เมื่อได้รับ CDC event ของ campaign นั้น (create/update, `status: open`)
- **FR-2** — `qty_target` เขียนด้วย `$setOnInsert` เท่านั้น — CDC event ครั้งถัดไปของ campaign เดิม
  (เช่น แก้ `qty_target`) ต้องไม่เปลี่ยนค่าที่ตั้งไว้แล้วใน `donation_need_counter`
- **FR-3** — worker เขียนได้เฉพาะ `qty_target`/`shelter_code`/`campaign_id`/`item_id`/`created_at`/
  `updated_at` — ห้ามเขียน/เคลียร์ `reserved_qty` (field นั้นเป็นของ FastAPI ล้วน ตาม CR-045)
- **FR-4** — campaign `status: closed` หรือ item ถูกลบออกจาก `needs[]` → `donation_need_counter`
  doc ที่มีอยู่แล้วต้องไม่ถูกลบหรือแก้โดย projector นี้
- **FR-5** — One-time Backfill Script ของ CR-045 (§Migration & Maintenance) ต้องขยายให้ seed
  `qty_target` ของทุก open-campaign ที่มีอยู่ก่อน cutover ด้วย ไม่ใช่แค่ `reserved_qty`

## Acceptance

- Unit test: CDC event ของ campaign ที่มี 2 items ใน `needs[]` → ได้ `donation_need_counter` 2 docs
  พร้อม `qty_target` ถูกต้อง, `reserved_qty = 0`
- Unit test: ประมวลผล CDC event ซ้ำของ campaign เดิมที่ `qty_target` ถูกแก้ไขแล้ว → ค่า `qty_target`
  ใน `donation_need_counter` เดิม**ไม่เปลี่ยน**
- Unit test: campaign เปลี่ยนเป็น `closed` → `donation_need_counter` docs ที่มีอยู่ยังอยู่ครบ ไม่ถูกลบ
- Unit test: mock ให้ FastAPI `$inc reserved_qty` บน doc เดียวกันพร้อมกับ worker upsert
  `qty_target` (`$setOnInsert`) → ไม่มี field ไหนถูกเขียนทับข้าม concern กัน

## Impact

- **code:** `worker/src/worker/projectors/needs.py` (หรือ sibling module ใหม่ เช่น
  `worker/src/worker/projectors/donation_need_counter.py`), `worker/src/worker/couch/processor.py`
  (dispatch), `worker/tests/projectors/test_projectors.py`
- **depends on:** `packages/tent-model/src/tent_model/donation_need_counter.py` ต้องมีอยู่ก่อน
  (สร้างตาม CR-059 — คนละงาน implement แต่ต้อง merge ก่อน/พร้อมกัน)
- **ไม่กระทบ:** schema_v ใดๆ, CouchDB `donation_campaign` doc shape, retention job (`purge_expired_buffers`)
  ที่ CR-059 คุมอยู่แล้ว

## Migration

N/A ต่อ schema_v เดิม (collection ใหม่ทั้งหมด, schema_v 1 ตาม CR-045) — แต่ **ผูกกับ Backfill Script
ของ CR-045**: ต้องรันหลัง projector นี้ deploy แล้ว หรือขยาย backfill script ให้ seed `qty_target`
เองพร้อมกันในรอบเดียว (ดู FR-5) กัน gap ที่ counter doc ถูกสร้างจาก backfill โดยไม่มี `qty_target`
(เพราะ backfill เดิมตาม CR-045 คำนวณแค่ `reserved_qty` จาก `DonationBuffer` ที่มีอยู่ ไม่ได้อ่าน
campaign เพื่อเติม `qty_target` ให้)

## Decision log

- 2026-07-28 — proposed โดยทีมพัฒนา ระหว่าง implement CR-045 (T-21) — พบ gap สถาปัตยกรรมว่า FastAPI
  ไม่มีทางอ่าน `qty_target` จาก CouchDB ได้เอง ต้องขยาย scope ของ CR-045 ให้ worker เป็นคน seed ค่านี้
  — รอเจ้าของโครงการเคาะ `approved` + ยืนยันวิธี track (เอกสารนี้ = ไฟล์ CR ตามที่ตกลง)
- 2026-07-29 — **approved** โดยเจ้าของโครงการ ผ่าน PR review #130 ("Verdict: Approve / Merge
  readiness: ✅ พร้อม merge") — ยืนยันวิธี track = ไฟล์ CR นี้ + แถวใน `docs/changes/_index.md`
  (แถว CR-060 หายไปตอน resolve conflict ของ #130 — เติมกลับแล้วใน CR-061)
- **Known consequence ของ FR-2 (ยกมาให้เห็นชัด ไม่ใช่ข้อเปลี่ยนแปลง):** เพราะ `qty_target` เขียนด้วย
  `$setOnInsert` เท่านั้น การที่เจ้าหน้าที่แก้ `qty_target` ของแคมเปญทีหลัง (เช่น 50 → 100) จะไม่มีผลกับ
  counter — ขณะที่ `public_needs` recompute เต็มรอบทุกครั้งจึงขึ้นเป้าใหม่ ผลคือหน้ากระดานสาธารณะบอก
  "ยังขาด" แต่ผู้บริจาคกดจองแล้วเด้ง `NEED_FULL` ที่เพดานเดิม จนกว่าจะรัน Recalculation CLI
  (`donation-quota recalculate` ตาม CR-061) ปิด gap ให้
