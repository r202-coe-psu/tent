---
id: draft
title: Referral — ถอนคำขอ (sent → closed), close_reason, และ bulk transition endpoint
status: proposed
date: 2026-10-14
requested_by: project owner
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §5.4 (status transition matrix, authorization, field `close_reason`, schema_v)
  - schema_v referral 1 → 2 (additive — optional field `close_reason`)
  - docs/task-breakdown/09-F-referral.md (T-34 state machine DoD)
  - frontend/src/lib/features/referrals/domain/referral.schema.ts (schema_v union, `close_reason`)
  - frontend/src/lib/features/referrals/domain/referral.transitions.ts (+ test)
  - frontend/src/lib/features/referrals/server/referral.server-repository.ts (transition guard, `makeDoc` version, shared bulk core)
  - frontend/src/routes/api/back-office/referral/[id]/transition/+server.ts
  - frontend/src/routes/api/back-office/referral/bulk-transition/+server.ts (ใหม่)
  - frontend/src/lib/features/referrals/ui (referral-detail, referral-batch-cards, referral-list)
---

# Referral — ถอนคำขอ (`sent → closed`), `close_reason`, และ bulk transition endpoint

## สรุป (TL;DR)

เพิ่ม transition **`sent → closed`** (ถอนคำขอ, ต้นทางเท่านั้น) · เพิ่ม field `close_reason` เก็บเหตุผลปิด/ถอนแยกจาก `response_reason` (schema_v 1→2, additive) · เพิ่ม endpoint `bulk-transition` สำหรับ bulk ใน list พร้อม core function ที่ worker ใช้ร่วมได้
Dev ต้องแก้ state machine + Zod, เพิ่ม guard ใน `transition()` กัน accept หลังถอน, deploy แบบสองขั้นเพราะ schema_v, สร้าง endpoint · สิทธิ์ใช้ชุดเดิม ไม่แก้ role matrix
CR นี้เป็นฐานของ [draft-referral-shelter-closure-worker](draft-referral-shelter-closure-worker.md) (flow ปิดศูนย์) ซึ่งแยกเป็นอีก CR เพราะเป็นชั้น stable

## Why

- referral ขาออกสถานะ `sent` ปิดไม่ได้ในปัจจุบัน (`sent → accepted | rejected` เท่านั้น) ศูนย์ต้นทางที่ส่งผิดหรือต้องปิดศูนย์จึงถอนคำขอไม่ได้ ต้องรอปลายทางตอบ
- `applyTransition` เขียน `response_reason: responseReason ?? doc.response_reason` กับทุก transition รวม `closed` การปิดรายการที่ปลายทางตอบรับแล้วพร้อมเหตุผลจะทับ `response_reason` ที่ปลายทางเขียนไว้ จึงต้องแยก field
- bulk ใน list ต้องเรียกครั้งเดียวต่อกลุ่มที่เลือก แทนการวนยิง endpoint รายตัวจาก browser
- ผลการตรวจ UX `/back-office/referrals` (2026-10-14) กำหนดให้ bulk ใน list จำกัดที่แถวที่โหลดอยู่ (ระดับหลักร้อย)

## Change

### Before → After: transition matrix

**Before**

```
draft    → sent | closed
sent     → accepted | rejected
accepted → closed
rejected → closed
closed   → (terminal)
```

**After**

```
draft    → sent | closed
sent     → accepted | rejected | closed     ← ใหม่ (ถอนคำขอ, ต้นทางเท่านั้น)
accepted → closed
rejected → closed
closed   → (terminal)
```

ไม่เพิ่ม enum `status`

### Requirements — ถอนคำขอ

| ID | Requirement |
| --- | --- |
| FR-W1 | `canTransition('sent','closed')` ต้องเป็น `true` |
| FR-W2 | เมื่อ `sent → closed` ระบบต้องตั้ง `timeline.closed = { at, by }` ตาม pattern เดียวกับ close อื่น และต้องไม่แก้ `timeline.sent` |
| FR-W3 | สิทธิ์ `sent → closed` ใช้กฎ `closed` เดิมของ `assertActorMayTransition`: ทุกประเภท = ศูนย์ต้นทางเท่านั้น ศูนย์ปลายทางต้องได้ `403` |
| FR-W4 | รายการ `closed` ที่ `timeline.sent` มีค่าและ `timeline.responded` ไม่มีค่า ต้องแสดงป้าย "ถอนคำขอ" (derived — ห้ามเก็บเป็น field) รายการที่ไม่มี `timeline.sent` ต้องแสดง "ยกเลิกร่าง" ตาม CR-048 |
| FR-W5 | ศูนย์ปลายทางต้องเห็นรายการที่ถูกถอนใน tab "ปิดรายการ" ของขาเข้า พร้อมป้าย "ถูกถอนโดยศูนย์ต้นทาง" และต้องไม่แสดงปุ่มตอบรับ/ปฏิเสธ (`canActorRespond` เป็น `false` อยู่แล้วเมื่อ `status = closed`) |
| FR-W6 | `ReferralServerRepository.transition()` ต้องตรวจ `canTransition(latest.status, to)` **ก่อน** เรียก `completeCapacityTransfer` และต้อง throw `Invalid referral transition` (HTTP 422) เมื่อ transition ไม่ถูกต้อง |
| FR-W7 | accept ที่มาถึงหลัง referral ถูกถอนแล้ว (รวมกรณี 409 retry ใน BFF) ต้องได้ `422` และต้องไม่เขียน `transfer_in` / `transfer_out` ใดๆ |

> **เหตุผลของ FR-W6/W7:** ก่อนการเปลี่ยนนี้ `sent` ออกไปได้เฉพาะ `accepted`/`rejected` ซึ่งทำโดยปลายทางเท่านั้น โค้ดจึงไม่ต้องตรวจ transition ก่อน transfer เมื่อมี `sent → closed` และ `assertActorMayTransition` คืนค่าโดยไม่ throw เมื่อ transition ไม่ถูกต้อง (`referral.authorization.ts`) การ accept บน referral ที่ปิดแล้วจะผ่านไปถึง `completeCapacityTransfer` และย้ายตัวผู้ประสบภัยก่อนที่ `applyTransition` จะ throw

### Requirements — `close_reason` และ schema_v

| ID | Requirement |
| --- | --- |
| FR-C1 | เพิ่ม field `close_reason` (str, ≤ 2000 ตัวอักษร, optional) ใน referral ทุกประเภท เก็บเหตุผลของ transition ไปยัง `closed` (ถอนคำขอ, ยกเลิกร่าง, ปิดรายการ, ปิดศูนย์) |
| FR-C2 | transition ไปยัง `closed` ต้องเขียน `close_reason` เมื่อมี `reason` และต้องไม่แก้ `response_reason` |
| FR-C3 | `response_reason` ต้องถูกเขียนเฉพาะ transition ไปยัง `accepted` / `rejected` (แก้ `applyTransition`) |
| FR-C4 | Zod ต้องรับ `schema_v` ทั้ง `1` และ `2` doc เดิม (v1) ต้องอ่านได้และไม่ถูก backfill |
| FR-C5 | doc ที่สร้างใหม่ต้องเป็น `schema_v: 2` (`makeDoc('referral', 2, …)`) doc v1 ที่ถูกเขียน `close_reason` ต้องถูกยกเป็น `schema_v: 2` ตอนเขียน |
| FR-C6 | หน้า detail ต้องแสดง `close_reason` ในส่วน timeline ของรายการที่ `closed` |
| FR-C7 | ลำดับ deploy: ปล่อย release ที่ Zod รับ `schema_v` 1\|2 **ก่อน** ปล่อย release ที่เริ่มเขียน v2 (FR-C5) ห้ามปล่อยสองอย่างใน release เดียว |

> **เหตุผลของ FR-C7:** `schema_v: z.literal(1)` ในปัจจุบัน และ `isReferral` ใช้ `safeParse` (`referral.schema.ts:218`) โดย `referral.remote.ts:69` กรองรายการที่ parse ไม่ผ่านทิ้งเงียบๆ client ที่ยังเป็น bundle เก่า (PWA) จะมองไม่เห็น referral v2 ทุกรายการโดยไม่มี error `central_ops` ไม่มี `validate_doc_update` (schema.md §5.5) การบังคับจึงอยู่ที่ server code เท่านั้น

### Requirements — bulk transition endpoint

| ID | Requirement |
| --- | --- |
| FR-B1 | เพิ่ม `POST /api/back-office/referral/bulk-transition` รับ `{ ids: string[], to: ReferralStatus, reason?: string }` |
| FR-B2 | ระบบต้องตรวจสิทธิ์และ `canTransition` ต่อรายการ ด้วย `assertActorMayTransition` ตัวเดียวกับ endpoint รายตัว ไม่ข้ามกฎเมื่อเรียกแบบ bulk |
| FR-B3 | ผลลัพธ์ต้องเป็น partial success: `{ succeeded: Referral[], failed: { id, error }[] }` รายการที่ผ่านไม่ถูก rollback เมื่อรายการอื่นล้มเหลว |
| FR-B4 | `reason` เดียวใช้กับทุกรายการ ≤ 2000 ตัวอักษร ถูกเก็บตาม FR-C2/C3: `to = closed` → `close_reason`, `to = accepted \| rejected` → `response_reason` |
| FR-B5 | bulk ใน list (`referral-batch-cards.svelte`) ต้องเรียก endpoint นี้ ไม่เรียก endpoint รายตัวเป็นลูป |
| FR-B6 | ขนาด `ids` ต่อคำขอ: proposed default 200 รายการ (list เลือกได้เฉพาะแถวที่โหลดอยู่ จึงอยู่ระดับหลักร้อย) ค่าปรับได้โดยไม่ต้องมี CR ใหม่ |
| FR-B7 | การทำ 409 retry ต่อรายการต้องคงพฤติกรรมเดิมของ endpoint รายตัว (สูงสุด 3 ครั้ง) |
| FR-B8 | ระบบต้องประมวลผลรายการด้วย concurrency จำกัด (proposed default 5) ห้ามใช้ `Promise.all` กับทั้ง chunk เพื่อกัน CouchDB เปิด connection/file descriptor เกินจำนวน (อาการ `EMFILE` ที่พบใน CR-126) |
| FR-B9 | logic การ transition หลายรายการต้องอยู่ใน core function ฝั่ง server ตัวเดียว (`bulkTransition(ids, to, reason, actor, actorShelter)`) ที่ endpoint นี้และ referral-worker ([draft-referral-shelter-closure-worker](draft-referral-shelter-closure-worker.md)) เรียกร่วมกัน ห้ามเขียนซ้ำใน worker |

## Impact

- `docs/data/schema.md` §5.4 — เพิ่ม `sent → closed` ใน matrix, เพิ่ม `close_reason`, ระบุว่า `closed` เป็นสิทธิ์ของต้นทางเท่านั้นสำหรับทุกประเภท, หมายเหตุ derived "ถอนคำขอ", ระบุ `schema_v` referral = 2
- `docs/task-breakdown/09-F-referral.md` — แก้บรรทัด state machine DoD ของ T-34
- `referral.schema.ts` — `schema_v` เป็น union 1|2, เพิ่ม `close_reason`
- `referral.transitions.ts` + `referral.test.ts` — เพิ่ม `sent → closed`, แยกการเขียน `response_reason`/`close_reason`, ปรับ test matrix
- `referral.server-repository.ts` — guard ตาม FR-W6, `makeDoc('referral', 2, …)`, core function ตาม FR-B9, test ของ FR-W7
- `[id]/transition/+server.ts` — คอมเมนต์ในไฟล์ระบุว่า `sent` mirror เอกสารไปยัง DB ปลายทาง ซึ่งล้าสมัยหลังย้ายไป `central_ops` (schema.md §5.4) ให้แก้คอมเมนต์ (comment-only) คอมเมนต์ "Mirrored copies" ใน `referral.authorization.ts` เช่นกัน
- `bulk-transition/+server.ts` (ใหม่) + test
- UI: ป้าย "ถอนคำขอ", ปุ่มถอนคำขอใน `referral-detail` และแถวขาออกสถานะ `sent`, แสดง `close_reason`, bulk ใน list เรียก endpoint ใหม่
- ไม่กระทบ: `completeCapacityTransfer` (ไม่ถูกเรียกเมื่อ `to ≠ accepted`), index ใน `central_ops`, worker/backend Python (ไม่ projection referral), `role-permission-matrix.md`

### ข้อสังเกตนอกขอบเขต CR นี้

- `list()` ใช้ `$or: [shelter_code, to_shelter_code]` โดยไม่กรองสถานะ ศูนย์ปลายทางจึงอาจเห็น capacity `draft` ของศูนย์อื่น ยังไม่ได้ตรวจว่า BFF กรองออกที่อื่นหรือไม่ ต้องตรวจแยก ไม่แก้ใน CR นี้

## Migration

**schema_v referral 1 → 2 (additive):**

- เพิ่ม `close_reason` (optional) เท่านั้น ไม่เปลี่ยนชนิด/ไม่ลบ field/ไม่เพิ่ม enum
- doc v1 เดิมอ่านได้ตามเดิมและไม่ถูก backfill ไม่มีการ rewrite
- doc v1 ถูกยกเป็น v2 เฉพาะเมื่อมีการเขียน `close_reason` (FR-C5)
- "ถอนคำขอ" คำนวณตอนอ่านจาก `timeline` ไม่ต้อง backfill
- doc ที่ถูกปิดก่อนหน้านี้ไม่มี `close_reason` UI ต้องแสดงได้โดยไม่มีเหตุผล
- ลำดับ deploy ตาม FR-C7: (1) ปล่อย Zod ที่รับ v1|v2 และ `close_reason` (ยังเขียน v1) (2) รอให้ client รุ่นเก่าหมดอายุ/รีเฟรช (3) ปล่อย release ที่เขียน v2
- ไม่มี `validate_doc_update` บน `central_ops` จึงไม่มี DB-level guard ที่ต้องอัปเดต

## Acceptance

- [ ] ศูนย์ต้นทางกดถอนคำขอจาก detail ของ referral `sent` → สถานะ `closed`, มี `timeline.closed`, `timeline.sent` คงเดิม, เก็บเหตุผลที่ `close_reason` และแสดงป้าย "ถอนคำขอ"
- [ ] ศูนย์ปลายทางเรียก `sent → closed` ได้ `403`
- [ ] ศูนย์ปลายทางเห็นรายการที่ถูกถอนเป็น `closed` และไม่มีปุ่มตอบรับ/ปฏิเสธ
- [ ] accept บน capacity referral ที่ `closed` แล้วได้ `422` และไม่มี `transfer_in` / `transfer_out` ถูกเขียน (รวมกรณีจำลอง 409 retry)
- [ ] ปิด referral `accepted` พร้อมเหตุผล → `response_reason` เดิมของปลายทางไม่เปลี่ยน และเหตุผลปิดอยู่ที่ `close_reason`
- [ ] doc v1 อ่านได้ทุกหน้า, doc ใหม่เป็น `schema_v: 2`, Zod รับทั้งสองรุ่น
- [ ] unit test ของ state machine ครอบคลุม `sent → closed` และปฏิเสธ transition ถอยหลังอื่นทุกตัว
- [ ] `bulk-transition` ที่มี id ผสม (สำเร็จ/ไม่มีสิทธิ์/สถานะไม่ถูกต้อง) คืน `succeeded` และ `failed` ครบทุก id โดยรายการที่ผ่านถูกบันทึกจริง
- [ ] bulk ที่มี 200 id ไม่เปิด request พร้อมกันกับ CouchDB เกิน concurrency ที่กำหนด (test ด้วย mock นับ in-flight)
- [ ] core function `bulkTransition` ถูก import ได้จากโค้ดที่ไม่ใช่ route (worker) โดยไม่ต้องผ่าน HTTP

## Decision log

- 2026-10-14 — project owner: "เลือกทั้งหมด" ใน list = แถวที่โหลดอยู่เท่านั้น การปิด referral ทั้งศูนย์แยกเป็น flow ของตัวเอง
- 2026-10-14 — project owner: ขาออกปิดได้ทุกสถานะ โดยเพิ่ม transition `sent → closed` (ถอนคำขอ)
- 2026-10-14 — project owner: bulk ใช้ผลลัพธ์ partial success พร้อมผลรายตัว เหตุผลเดียวกันทุกรายการ
- 2026-10-14 — project owner: track ด้วย CR file ใน `docs/changes/` ระดับเต็ม (กฎ + state machine + ผลกระทบ + migration)
- 2026-10-14 — project owner (N-1): สิทธิ์ใช้ `authorizeReferral` เดิม (`shelter_manager` ของศูนย์ตัวเอง + `system_admin`) ไม่แก้ role matrix
- 2026-10-14 — project owner (N-3): เพิ่ม `close_reason` และ bump `schema_v` 1→2 แทนการใช้ `response_reason` ร่วม (ทางเลือก (a) ถูกปฏิเสธเพราะ `applyTransition` ทับ `response_reason` ของปลายทางเมื่อปิดรายการที่ตอบแล้ว)
- 2026-10-14 — project owner: แยกเป็นสอง CR — ฉบับนี้ (volatile) กับ flow ปิดศูนย์/worker (stable)
- 2026-10-14 — project owner: ใช้ logic bulk ร่วมกันระหว่าง list endpoint และ worker (FR-B9) ปรับจากเดิมที่ใช้ endpoint เดียวกันทั้งสองฝั่ง เพราะ flow ปิดศูนย์เปลี่ยนเป็น worker job
- 2026-10-14 — proposed (ร่างโดย Claude): เพิ่ม FR-W6/W7 หลังตรวจ `referral.server-repository.ts` `transition()` พบว่า `completeCapacityTransfer` รันก่อนการตรวจ transition
- 2026-10-14 — proposed (ร่างโดย Claude): เพิ่ม FR-C7 (deploy สองขั้น) หลังพบ `schema_v: z.literal(1)` + `isReferral` ใช้ `safeParse` ทำให้ client รุ่นเก่ากรอง doc v2 ทิ้งเงียบๆ
- 2026-10-14 — proposed (ร่างโดย Claude): เพิ่ม FR-B8 หลังตรวจ CR-126 (`EMFILE` จากการเขียนพร้อมกันจำนวนมาก)
- 2026-10-14 — ผลการตรวจ: referral เก็บใน `central_ops` เอกสารเดียวต่อรายการ ไม่มี mirror (schema.md §5.4) ปลายทางเห็นเอกสารเดียวกันที่เป็น `closed`
- ยังไม่ approve; ยังไม่มีเลข `CR-NNN` (ตั้งหลัง owner approve ตาม `docs/change-management.md`)
