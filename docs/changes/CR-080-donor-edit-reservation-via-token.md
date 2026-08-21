---
id: CR-080
title: Donor แก้ไขรายการจองบริจาคผ่าน tracking_token (แก้จำนวน / เพิ่ม-ลบรายการ) + revision log
status: proposed
date: 2026-08-01
requested_by: เจ้าของโครงการ (ตอบคำถามขอบเขตคำว่า "แก้" ใน DoD T-21 ข้อ 4)
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/task-breakdown/04-donation.md §T-21 DoD ข้อ 4
  - docs/data/schema.md §2.3 (donation — เพิ่ม revisions[])
  - schema_v donation 3 → 4
  - docs/data/api-contract.md — PATCH /public/v1/donations/{tracking_token}
  - backend/apiapp/modules/donations/ (router.py, use_case.py, schemas)
  - frontend/src/routes/api/public/v1/donations/[tracking_token]/+server.ts
  - frontend/src/lib/features/donations/
  - CR-047 (atomic quota) — เพิ่ม path ที่แก้ reserved_qty แบบ delta
---
# CR-080 — Donor แก้ไขรายการจองบริจาคผ่าน tracking_token

## Why

DoD ของ **T-21 ข้อ 4** เขียนว่า *"Donor แก้/ยกเลิกการจองของตนผ่าน token ได้โดยไม่ login (FR-35)"*
แต่ไม่ได้นิยามว่าคำว่า **"แก้"** กินถึงอะไร ทำให้ implement ไปได้เท่าที่ตีความแคบที่สุด:

> **Baseline ของคอลัมน์ "ตอนนี้"** = branch `team-A-donation-T21-reservation` (ยังไม่ merge เข้า
> `develop` ตอนเขียน CR นี้). บน `develop` เส้นทาง donor ยังมีแค่ `GET`/`PATCH` — ทั้ง `DELETE`
> (ยกเลิก), `DONOR_EDITABLE_STATUSES` และ atomic quota counter ของ CR-047 ยังอยู่บน branch นั้น

| ความสามารถ                             | ตอนนี้                                             | endpoint                                |
| ------------------------------------------------ | -------------------------------------------------------- | --------------------------------------- |
| ยกเลิกการจอง                         | ✅ ทำแล้ว                                          | `DELETE /public/v1/donations/{token}` |
| แก้เลขพัสดุ (`courier_tracking_no`) | ✅ ทำแล้ว (เฉพาะ`delivery_method = parcel`) | `PATCH /public/v1/donations/{token}`  |
| **แก้จำนวนของที่จอง**     | ❌ ยังไม่มี                                      | —                                      |
| **เพิ่ม / ลบรายการ (items)**  | ❌ ยังไม่มี                                      | —                                      |

การขยายจาก "แก้ metadata" → "แก้ payload ของการจอง" ทำให้การแก้ไขไป**กระทบโควตา
(`donation_need_counter.reserved_qty`) โดยตรง** ซึ่งเป็น invariant กลางของ CR-047
จึงเข้าเกณฑ์ change-management §2 (เปลี่ยน business rule + scope ของ task + bump `schema_v`)
— ต้องมี Change Record ก่อนลงมือ

## Change

### 1. ขอบเขตของ "แก้" (before → after)

|                                     | Before                                                 | After                                                                        |
| ----------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| ฟิลด์ที่ donor แก้ได้ | `logistics.courier_tracking_no`                      | +`items[].qty`, เพิ่ม/ลบ element ใน `items[]`                   |
| Method                              | `PATCH` (payload มีแค่ `courier_tracking_no`) | `PATCH` payload รับ `items[]` ชุดเต็ม (replace ทั้งชุด) |
| ผลต่อโควตา                | ไม่กระทบ                                       | ต้อง reserve/release**ส่วนต่าง** ต่อ item               |
| หลักฐานการแก้          | ไม่มี                                             | `revisions[]` ใน donation doc                                            |

### 2. กติกาโควตาเมื่อแก้ (ขยายจาก CR-047)

คิดเป็น **delta ต่อ `item_id`** เทียบ `items[].reserved_qty` เดิมกับที่ขอใหม่:

- delta > 0 → `reserve_quota(delta)` — อาจได้ `NEED_FULL`
- delta < 0 → `release_quota(-delta)` — underflow-guarded อยู่แล้ว
- ลบรายการทิ้ง → `release_quota(reserved_qty เดิมทั้งก้อน)`
- เพิ่มรายการใหม่ → `reserve_quota(qty ใหม่)`

ทำ **release ก่อน reserve** เสมอ เพื่อให้การ "ย้ายจำนวนระหว่าง item" ไม่ชนเพดานตัวเอง
ถ้า reserve ตัวใดตัวหนึ่งได้ `NEED_FULL` → **compensation rollback** คืนทุก op ที่ทำไปแล้วใน
คำขอเดียวกัน (Mongo single-node ไม่มี multi-doc transaction — pattern เดียวกับตอน create)

### 2.1 ลำดับการเขียน — แก้ **ต่างจาก** ยกเลิก

ตอนแก้บั๊กโควตารั่ว (commit `73a20569` บน branch `team-A-donation-T21-reservation`) ได้วางกลไกให้ worker คืนโควตาจาก change feed หลังจาก
CouchDB เปลี่ยนสถานะแล้ว — **กลไกนั้นใช้กับการแก้ไม่ได้** เพราะ "ยกเลิก" ปฏิเสธไม่ได้ (คืนของ
อย่างเดียว จะช้าไปหน่อยก็ยังถูก) แต่ "แก้เพิ่มจำนวน" **ปฏิเสธได้** (`NEED_FULL`) และผู้บริจาค
ต้องได้คำตอบทันทีในคำขอเดียวกัน จะบอกว่า "แก้สำเร็จ" แล้วค่อยให้ worker มาพบทีหลังว่าโควตาไม่พอไม่ได้

ดังนั้นลำดับต้องเป็น **จอง delta ที่ Mongo ก่อน แล้วค่อยเขียน CouchDB**:

```
BFF  ──1─→ FastAPI: จอง delta (atomic)  ──ไม่พอ─→ 409 NEED_FULL, ไม่มีอะไรเปลี่ยน
     ←─2── สำเร็จ
     ──3─→ เขียน items[] ใหม่ลง CouchDB (หรือ buffer ถ้ายังไม่ sync)
```

ข้อจำกัดที่บังคับรูปนี้: **BFF เรียก `reserve_quota` เองไม่ได้** (เป็น Python/Beanie อยู่ฝั่ง Mongo)
และ **FastAPI เขียน CouchDB ไม่ได้** — เจ้าของโควตากับเจ้าของ SoR เป็นคนละ process จึงต้องแยก
2 จังหวะแบบนี้ ถ้าขั้น 3 ล้มหลังขั้น 1 ผ่าน โควตาจะค้างเกินจริงชั่วคราว → กู้ด้วย
`donation-quota recalculate` (CR-061) ซึ่งนับจาก CouchDB เป็นหลักอยู่แล้ว

### 3. Revision log

เพิ่ม `revisions[]` ใน donation doc (schema_v 3 → 4) — append-only, ผู้แก้เป็น donor เท่านั้น:

```jsonc
"revisions": [
  {
    "at": "2026-08-01T09:15:00Z",
    "by": "donor",                 // donor | staff (เผื่อ adjust ตอนรับของ)
    "items_before": [{ "item_id": "item:rice", "qty": "5" }],
    "items_after":  [{ "item_id": "item:rice", "qty": "8" }]
  }
]
```

เจ้าหน้าที่เห็น log นี้ในหน้า "รอการประเมิน" เพื่อรู้ว่า donor แก้อะไรมาบ้างก่อน adjust จริง
(ต่อกับ CR-052 §Back-office Verification Flow)

## Impact

**Docs**

- `docs/task-breakdown/04-donation.md` — ขยายข้อความ DoD T-21 ข้อ 4 ให้ระบุขอบเขต "แก้" ชัดเจน
- `docs/data/schema.md §2.3` — เพิ่ม `revisions[]`, bump `schema_v` donation 3 → 4
- `docs/data/api-contract.md` — `PATCH /public/v1/donations/{token}` รับ payload ใหม่

**Code**

- `backend/apiapp/modules/donations/use_case.py` — เพิ่ม `update_items()` ที่คิด delta +
  compensation rollback; ตอนนี้ `PATCH` ทำได้แค่ `update_courier_tracking()`
- `frontend/.../[tracking_token]/+server.ts` — ต้องเรียก FastAPI จอง delta **ก่อน** เขียน
  CouchDB (§2.1) ทั้งเส้นทางก่อน-sync และหลัง-sync
- `packages/tent-model` — ใช้ `reserve_quota`/`release_quota` เดิม ไม่ต้องเพิ่ม op ใหม่
- `worker/src/worker/quota/settle.py` — **ต้องไม่** ขยายให้ settle การแก้ items จาก CDC
  (ดู §2.1 เหตุผล) ปัจจุบันมันดูแค่การเปลี่ยน *สถานะ* ซึ่งถูกต้องแล้ว
- Test: race ระหว่าง "แก้เพิ่มจำนวน" กับ "คนอื่นจองพร้อมกัน" ต้องไม่ทะลุเพดาน;
  ขั้น 3 ล้มหลังขั้น 1 ผ่าน → `recalculate` ต้องซ่อมได้

**สิ่งที่ CR นี้ *ไม่* ครอบคลุม**

- ไม่แตะ flow ฝั่งเจ้าหน้าที่ (adjust ตอนรับของ = T-16 / CR-052 เดิม)
- ไม่แตะ `logistics` / slot — แก้ได้เฉพาะ `items[]` ในรอบนี้

## ต้องให้เจ้าของโครงการเคาะก่อนลงมือ

| # | คำถาม                                                                                   | ตัวเลือก / ข้อเสนอของทีม                                                                                                                                                                                                                                                                                                                        |
| - | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | แก้ได้ถึงสถานะไหน                                                           | ตอนนี้ code จำกัดที่`declared` เท่านั้น (`DONOR_EDITABLE_STATUSES`). CR-052 บังคับทุกรายการเข้า `pending_review` — **ถ้าอยู่ `pending_review` แล้วยังให้แก้ได้ไหม?** ทีมเสนอ: **แก้ไม่ได้** เมื่อเจ้าหน้าที่เริ่มประเมินแล้ว |
| 2 | แก้แล้วโควตาไม่พอ (`NEED_FULL`)                                           | (ก) reject ทั้งคำขอ ของเดิมไม่เปลี่ยน ←**ทีมเสนอ** (ข) รับเท่าที่เหลือ (ค) ตัดเฉพาะรายการที่เต็ม                                                                                                                                                                                       |
| 3 | TTL (ตอนนี้อ่านจาก`config:app.donation_reservation_ttl_hours` ได้แล้ว) | (ก) นับต่อจาก`declared_at` เดิม ← **ทีมเสนอ** (กัน abuse ต่ออายุไม่รู้จบด้วยการแก้รัวๆ) (ข) รีเซ็ตใหม่ทุกครั้งที่แก้                                                                                                                                                          |
| 4 | Log ละเอียดแค่ไหน / เก็บที่ไหน                                        | (ก)`revisions[]` ใน donation doc เก็บ items ก่อน-หลังทั้งชุด ← **ทีมเสนอ** (ข) เก็บแค่ diff (ค) แยกเป็น audit doc ต่างหาก                                                                                                                                                                               |
| 5 | จำกัดจำนวนครั้งไหม                                                         | ตอนนี้ rate-limit ที่ BFF 3 ครั้ง/นาที ต่อ IP (limiter ตัวเดียวร่วมกันทุก endpoint) + FastAPI อีกชั้น 30 ครั้ง/นาที ต่อ IP.**ต้องมีเพดาน "แก้ได้ N ครั้งต่อการจอง" เพิ่มไหม?** ทีมเสนอ: ไม่ต้อง — มี log ครบแล้ว                                                                                                                             |

## Migration

`schema_v` donation 3 → 4 — เพิ่ม `revisions[]` เป็น **optional** doc เดิมที่ไม่มี field นี้
อ่านได้ปกติ (treat as `[]`) **ไม่ต้อง backfill**

## Decision log

- 2026-08-01 — proposed (drafted as CR-062)
- 2026-08-19 — renumbered CR-062 → CR-080: `CR-062-external-api-keys.md` already held 062, and
  `CR-079-sop-what-if-simulation.md` (branch `team-D-T-42`) holds 079, so this record takes the
  next free number at the end of the sequence (same convention as CR-055). Content unchanged —
  still `proposed`, still blocked on the 5 questions above.
- 2026-08-19 — ตรวจเนื้อหาเทียบ `develop` ก่อนเปิด PR: แก้ `schema_v` donation **2 → 3** เป็น
  **3 → 4** (§2.3 ขึ้น 3 ไปแล้วตอน CR-038 `items[].qty` → `qty_str`), ระบุ baseline ของคอลัมน์
  "ตอนนี้" และแก้ตัวเลข rate-limit ให้ครบทั้งสองชั้น — ข้อเสนอ/กติกาไม่เปลี่ยน
