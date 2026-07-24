---
id: CR-045
title: Atomic quota reservation counter สำหรับ donation intake (กัน overbooking, T-21)
status: proposed
date: 2026-07-24
requested_by: ทีมพัฒนา (Team A — ชิโน, นัท, กาน)
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/couchdb-mongodb-sync.md §4.1
  - Mongo collection ใหม่ donation_need_counter (schema_v 1)
  - backend/apiapp/modules/donations/{use_case.py,schemas.py,router.py}
  - worker/src/worker/retention/job.py
---
# CR-045 — Atomic quota reservation counter สำหรับ donation intake

## Why

T-21 (`docs/task-breakdown/04-donation.md` T-21 DoD) กำหนดไว้ว่า "จองที่ยืนยันแล้ว reserve
โควตา กันบริจาคซ้อนเกินเป้าจากหลายคนพร้อมกัน" — แต่ implementation ปัจจุบันยังไม่ atomic จริง:
`frontend/src/routes/api/public/v1/donations/+server.ts` อ่าน `campaigns`/`donations` จาก CouchDB
มา compute `remaining` ใน memory (read) แล้วค่อยยิง `POST` ไป FastAPI (write) แยกกันคนละจังหวะ —
มี race window ให้สองคำขอพร้อมกันผ่าน check เดียวกันได้ทั้งคู่ → จองเกินเป้า (overbooking)

เดิมเข้าใจว่า atomicity เป็น scope ของ T-02 (Platform/Core) แต่ตรวจ DoD จริงแล้ว T-02
(`docs/task-breakdown/01-core.md:61-71`) ครอบคลุมแค่ schema shape + sync/conflict (endpoint
failover) + `validate_doc_update` รับ field ใหม่ — ไม่มี invariant เรื่อง quota/race ตอนจองเลย
ส่วน "กัน race ตอน submit: service re-check atomic" ที่เขียนไว้ชัดคือ DoD ของ **T-60**
(`04-donation.md:115`) ซึ่ง depend บน T-21 อยู่แล้ว — งานนี้จึงอยู่ใน scope ของ T-21 เอง ไม่ทับ T-02

## Change

- เพิ่ม Mongo collection ใหม่ `donation_need_counter` (schema_v 1) — 1 doc ต่อ
  `(shelter_code, campaign_id, item_id)` เก็บ `qty_target`, `reserved_qty`
- `DonationsUseCase.create()` เปลี่ยนจาก "เช็คแล้วค่อยเขียน" เป็น atomic
  `find_one_and_update` พร้อม guard `$expr: reserved_qty + qty ≤ qty_target` ต่อ item ก่อน
  insert `DonationBuffer` — ถ้าเงื่อนไขไม่ผ่าน reject `NEED_FULL` ทันทีในคำสั่งเดียว (ไม่มี
  read-then-write gap อีกต่อไป)
- เพิ่ม field บันทึกจำนวนที่ reserve จริงต่อ item ใน `DonationBuffer` (เพื่อคืนโควตาถูกจำนวนตอน
  cancel/expire)
- `cancel()` และ worker retention job (`purge_expired_buffers`) ต้อง decrement ตัวนับคืนเมื่อ
  ยกเลิก/หมดอายุ
- ถ้าจองหลาย item ในใบเดียว แล้ว item หนึ่ง reject ระหว่างทาง ต้อง compensate (ลดตัวนับ item ที่
  increment ไปแล้วคืน) เพราะ Mongo deployment ปัจจุบันเป็น single-node ไม่มี replica set — ไม่มี
  multi-document transaction ให้ใช้ all-or-nothing แบบ built-in

## Impact

- `backend/apiapp/modules/donations/{use_case.py,schemas.py,router.py}` + `backend/tests/test_donations.py`
- `worker/src/worker/retention/job.py` + `worker/tests/test_retention.py` (ต้อง decrement counter ตอน purge)
- `docs/data/couchdb-mongodb-sync.md` §4.1 — เพิ่มขั้นตอน atomic reserve ในลำดับ inbound donations
- **ไม่กระทบ** CouchDB `donation` doc schema/`schema_v` — counter เป็นกลไก Mongo-only ที่ write-time
  ก่อน sync เข้า CouchDB ไม่ persist ไปที่ SoR
- **ไม่กระทบ scope T-02** — schema/`validate_doc_update` ของ T-02 ยังทำแยกตามเดิม; งานนี้คือ T-21/T-60
  DoD ที่มีอยู่แล้ว

## Migration

N/A สำหรับ CouchDB (ไม่มี doc shape เดิมให้ migrate) — แต่ก่อน rollout ต้องรัน **one-time backfill
script** นับ `DonationBuffer` ที่ยังเป็น `declared`/synced แล้วเป็น `received` ปัจจุบัน ต่อ
`(shelter_code, campaign_id, item_id)` มาตั้งค่า `reserved_qty` เริ่มต้นของ `donation_need_counter`
ก่อนเปิดใช้ atomic check — ไม่งั้นตัวนับเริ่มจาก 0 จะยอมให้จองเกินเป้าที่มี pending อยู่แล้วซ้ำ

## Decision log

- 2026-07-24 — proposed
