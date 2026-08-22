---
id: CR-061
title: "CR-061 scope correction — แหล่งข้อมูลของ reserved_qty recalculation + worker CLI `donation-quota`"
status: approved
date: 2026-07-29
updated: 2026-07-30
requested_by: ทีมพัฒนา (Team A — ชิโน, นัท, กาน)
decided_by: เจ้าของโครงการ (PR review #144, 2026-07-30)
layer: volatile
affects:
  - docs/changes/CR-047-donation-quota-atomic-reservation.md §Migration & Maintenance (แก้แหล่งข้อมูล) + affects list (เพิ่ม worker CLI)
  - worker/src/worker/quota/reconcile.py (module ใหม่)
  - worker/src/worker/cli/donation_quota.py (module ใหม่) + worker/pyproject.toml `[project.scripts]`
  - packages/tent-model/src/tent_model/donation_need_counter_ops.py (`set_reserved_qty`)
  - worker/tests/test_quota_reconcile.py
  - docs/data/couchdb-mongodb-sync.md §4.1 (ยังไม่อัปเดต — ค้างจาก CR-047)
---
# CR-061 — แหล่งข้อมูลของ `reserved_qty` recalculation + worker CLI

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** แก้แหล่งข้อมูลที่ CR-047 §Migration ระบุไว้สำหรับคำนวณ `reserved_qty` ตั้งต้น —
  จาก "`DonationBuffer`" เป็น "**CouchDB `donation:` docs + `DonationBuffer` ที่ยัง `synced_to_couch=false`**"
  และกำหนดที่อยู่ของ Backfill/Recalculation tool ไว้ที่ **worker** (`donation-quota` CLI)
- **เพื่อใคร/ทำไม:** สูตรเดิมนับ**ต่ำกว่าความจริง** เพราะ retention job ลบ buffer row ที่หมดอายุแล้ว
  sync แล้วทิ้ง รวมถึงตัวที่ `received` ซึ่งกินโควตาถาวร → backfill/recalculate จะแจกโควตาที่ถูกใช้ไปแล้ว
  ออกใหม่ = overbooking ซึ่งเป็นสิ่งที่ CR-047 มีอยู่เพื่อป้องกัน
- **dev ต้อง build:** CLI `donation-quota {backfill|recalculate}` ใน worker (component เดียวที่มีทั้ง
  CouchDB client และ Mongo) + `set_reserved_qty()` แบบ optimistic-filter ใน shared ops module
- **กระทบ scope:** ไม่กระทบ `schema_v` ใด ๆ, ไม่กระทบ CouchDB doc shape, ไม่กระทบ runtime write path
  (`reserve_quota`/`release_quota` เดิมไม่เปลี่ยน) — ขยาย `affects:` ของ CR-047 ที่ approved แล้ว

## Why

CR-047 §Migration & Maintenance กำหนด Backfill Script ว่า *"คำนวณ `reserved_qty` ตั้งต้นจาก
`DonationBuffer` ที่มีสถานะ `declared`/synced `received` ปัจจุบัน"* — ตรวจโค้ดจริงแล้วสูตรนี้ใช้ไม่ได้:

- `worker/src/worker/retention/job.py` (`purge_expired_buffers`) **ลบ** `DonationBuffer` row ทิ้งเมื่อ
  row นั้นหมดอายุแล้วและ `synced_to_couch=true` — **รวมถึง row สถานะ `received`** ซึ่งตามกลไก CR-047
  ยังกินโควตาอยู่ตลอด (คืนโควตาเฉพาะ `cancelled`/timeout `declared` เท่านั้น)
- ผลคือการบริจาคที่อายุเกิน TTL (72 ชม.) **หายจาก `DonationBuffer` ทั้งหมด** การรวมยอดจาก collection นี้
  จึงได้ค่าต่ำกว่าความจริงเสมอ และเมื่อเขียนกลับจะ **ลด** `reserved_qty` = เปิดโควตาที่ถูกใช้ไปแล้วให้จองซ้ำ
- `DonationBuffer` ยังไม่มีการบริจาคที่เจ้าหน้าที่บันทึกเอง (walk-in ผ่าน back-office) เลย เพราะรายการ
  เหล่านั้นเกิดใน CouchDB โดยตรง ไม่ผ่าน public intake buffer

แหล่งข้อมูลที่ถูกต้องคือ CouchDB `donation` docs (SoR) — ตรงกับที่ frontend `calculateReserved()` /
`computeNeeds()` ใช้อยู่แล้ว. ผลพลอยได้: tool ต้องอ่าน CouchDB ได้ จึงอยู่ใน `backend/` ไม่ได้ (ไม่มี
CouchDB client — ข้อจำกัดเดียวกับที่ทำให้ต้องมี CR-060) ต้องอยู่ใน `worker/`

`affects:` เดิมของ CR-047 ระบุแค่ `backend/apiapp/modules/donations/*` + `worker/.../retention/job.py`
ไม่ครอบคลุม module ใหม่ทั้งสองตัวนี้ จึงขอ scope correction แยกเป็น CR ใหม่ ไม่แก้เงียบ ๆ

## Change

### Before (ตาม CR-047 §Migration & Maintenance)

- Backfill Script คำนวณ `reserved_qty` ตั้งต้น **จาก `DonationBuffer`** ที่สถานะ `declared` / synced `received`
- Recalculation CLI สั่ง recompute `reserved_qty` **จาก `DonationBuffer`** ใหม่
- ไม่ระบุว่า tool ทั้งสองอยู่ที่ component ไหน

### After

- Truth set ของ `reserved_qty` = union ของสองแหล่ง dedupe ด้วย donation `_id`
  (normalize prefix `donation:`):
  1. **CouchDB `donation:` docs** ใน `shelter_<code>` — authoritative สำหรับทุกอย่างที่ sync แล้ว
     และเป็นที่เดียวที่มี walk-in ของเจ้าหน้าที่
  2. **Mongo `DonationBuffer` ที่ `synced_to_couch=false`** — จองแล้วแต่ inbound ยังไม่ตามทัน
     (ถ้าไม่นับ ช่วง pre-inbound จะ reserve ต่ำกว่าจริง); CouchDB doc ชนะเสมอเมื่อ id ซ้ำ
- นับจาก `items[].qty` **ไม่ใช่** `items[].reserved_qty` ที่ stamp ไว้ตอนจอง — รายการที่หลุด fail-open
  ของ `NOT_SEEDED` ไม่มี `reserved_qty` แต่กินของจริง; recalculation ต้องสะท้อนความจริง
- สถานะที่ถือโควตา = `declared`, `received` (`cancelled`/`expired` คืนแล้ว)
- Tool ทั้งสองรวมเป็น CLI ตัวเดียวใน worker: `donation-quota backfill` / `donation-quota recalculate`
- เพิ่ม `set_reserved_qty()` ใน `tent_model/donation_need_counter_ops.py` — writer ตัวที่สามและตัวสุดท้าย
  ของ field นี้ (คุม DRY ตาม CR-047 §Shared Domain Helper)

## Requirements

- **FR-1** — Recalculation ต้องรวมยอดจาก CouchDB `donation:` docs (status `declared`/`received`) ของศูนย์นั้น
  เป็นแหล่งหลัก
- **FR-2** — ต้องรวม `DonationBuffer` ที่ `synced_to_couch=false` ของศูนย์นั้นด้วย และ **ห้ามนับซ้ำ**
  กับ CouchDB doc ที่เป็นรายการเดียวกัน
- **FR-3** — ต้องรวมยอดจาก `items[].qty`; รายการที่ไม่มี `item_id` หรือ donation ที่ไม่มี `campaign_id`
  **ห้ามเดา** ว่าเป็น item ใด — ต้องรายงานเป็น unattributed ให้ผู้ปฏิบัติงานตรวจเอง
- **FR-4** — `backfill` ต้อง seed `qty_target` ของทุก open campaign ก่อนคำนวณ `reserved_qty`
  (ปิด CR-060 FR-5); `recalculate` ต้อง**ไม่**แตะ `qty_target`
- **FR-5 (Cutover Lock)** — dry-run เป็นค่า default; การเขียนต้องระบุทั้ง `--apply` และ
  `--confirm-write-path-locked` มิฉะนั้นปฏิเสธการรัน
- **FR-6 (Cutover Lock ระดับ document)** — ทุกการเขียน `reserved_qty` ต้องมี filter เป็นค่าที่อ่านมา
  ก่อนหน้า ถ้าค่าเปลี่ยนระหว่างรัน (มี `$inc` จาก FastAPI แทรก) ต้อง**ไม่เขียน** รายงานเป็น conflict
  และ exit code ≠ 0
- **FR-7** — ต้องครอบคลุมศูนย์ที่ปิดแล้วด้วย (counter อาจมี `reserved_qty` ค้าง) และครอบคลุม
  `shelter_code` ที่มี counter อยู่แม้ไม่มีใน registry
- **FR-8** — รายงาน dry-run ต้องแสดงยอดคงค้างของคีย์ที่**ยังไม่มี counter** ด้วย ไม่งั้นรอบ backfill
  ครั้งแรกจะแสดง "0 to change" ซึ่งอ่านแล้วเข้าใจผิดว่าไม่มีอะไรเกิดขึ้น

## Acceptance

- `received` donation ที่ buffer row ถูก purge ไปแล้ว ยังถูกนับเข้า `reserved_qty` (regression test ตรงของ
  สูตรเดิม)
- `cancelled` / `expired` donation ไม่ถูกนับ
- buffer ที่ `synced_to_couch=false` ถูกนับ; buffer ที่มี CouchDB doc คู่กันถูกนับครั้งเดียว
- counter ที่สูงเกินความจริงถูกปรับ**ลด**, counter ที่ไม่มี donation คงค้างถูก set เป็น 0
- dry-run ไม่เขียนอะไรเลย และรายงานคีย์ที่ยังไม่มี counter
- `$inc` ที่แทรกกลางระหว่างรัน → รายงาน conflict, ค่า `reserved_qty` ของ booking จริงไม่ถูกทับ
- `--apply` โดยไม่มี `--confirm-write-path-locked` → ปฏิเสธ
- เขียนสำเร็จแล้วต้อง stamp `last_recalculated_at`

## Impact

- **code:** `worker/src/worker/quota/`, `worker/src/worker/cli/`, `worker/pyproject.toml`,
  `packages/tent-model/src/tent_model/donation_need_counter_ops.py`
- **test:** `worker/tests/test_quota_reconcile.py`
- **docs:** CR-047 §Migration & Maintenance (แก้สูตร) + `affects:`; `docs/data/couchdb-mongodb-sync.md §4.1
  ยังค้างไม่อัปเดตตั้งแต่ CR-047 — รวมเข้ารอบนี้หรือแยก follow-up ตามที่เจ้าของโครงการเห็นสมควร
- **ไม่กระทบ:** `schema_v` ใด ๆ, CouchDB `donation`/`donation_campaign` doc shape, runtime write path
  (`reserve_quota`/`release_quota`/`seed_counter` ไม่เปลี่ยน), scope ของ T-02

## Migration

N/A ต่อ `schema_v`. ลำดับการ rollout:

1. deploy worker ที่มี projector ของ CR-060 (seed `qty_target`) ให้ตามทัน
2. หยุด public donation write path (maintenance window)
3. `donation-quota backfill` (dry-run) → ตรวจรายงาน โดยเฉพาะรายการ unattributed
4. `donation-quota backfill --apply --confirm-write-path-locked`
5. เปิด write path คืน
6. หลังจากนั้นใช้ `donation-quota recalculate` เมื่อสงสัยว่ายอดคลาดเคลื่อน หรือหลัง DB recovery

> **หมายเหตุที่ต้องตัดสินใจต่อ:** รายการ unattributed (donation ที่ไม่มี `campaign_id` หรือ item ที่ไม่อยู่
> ใน `needs[]` ของ campaign ที่ผูกไว้) จะไม่ถูกนับเข้า counter ใด ๆ เลย — ตรวจ dev data 2026-07-29 พบ
> 6 รายการ (`item:rice` รวม 30) และ `item:blanket` 20 ที่ผูกกับ campaign ที่ไม่ได้ประกาศขอผ้าห่ม
> ต้องมีนโยบายว่าจะจัดการยอดกลุ่มนี้อย่างไร (นอก scope CR นี้)

## Decision log

- 2026-07-29 — proposed โดยทีมพัฒนา ระหว่าง implement CR-047 §Migration & Maintenance — พบว่าสูตร
  คำนวณที่ CR-047 ระบุไว้ทำให้ `reserved_qty` ต่ำกว่าความจริงและย้อนกลับไปเปิดโควตาที่ถูกใช้แล้ว
  จึงต้องแก้แหล่งข้อมูล + ระบุที่อยู่ของ tool. เจ้าของโครงการเลือกวิธี track = ไฟล์ CR ใหม่
  (ยืนยัน 2026-07-29) — รอเคาะ `approved`
- 2026-07-30 — **approved** โดยเจ้าของโครงการ ผ่าน PR review #144 ("Verdict: Approve / Merge
  readiness: ✅ พร้อม merge / Blockers: None") — รับรองว่าแหล่งข้อมูลที่แก้ตรงตามสถาปัตยกรรม
  Remote-First (CouchDB = SoR) และกัน overbooking ได้ถูกต้อง
- **Follow-up ที่ reviewer ระบุ (ยังไม่ทำ):** `docs/data/couchdb-mongodb-sync.md §4.1` ค้างไม่อัปเดต
  ตั้งแต่ CR-047 — แยกเป็น PR เอกสารต่างหากได้ ไม่บล็อกการ merge โค้ดของ CR นี้
