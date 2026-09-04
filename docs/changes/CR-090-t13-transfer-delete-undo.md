---
id: CR-090
title: T-13 โอนย้ายข้ามศูนย์ — ลบคำร้อง (เฉพาะ requested) + Undo 5 วินาที
status: approved
date: 2026-08-25
updated: 2026-09-04
requested_by: CR-059 follow-up (§4.5 UI Safety Standards, Task #13) — spun out จาก CR-089 (2026-08-25, ไม่แตะ schema_v)
decided_by: Project Owner
layer: volatile
affects:
  - frontend/src/lib/features/operations/domain/transfer.authorization.ts
  - frontend/src/lib/features/operations/data/transfer.server-repository.ts (remove() + restore() — ดู FR-05/FR-08/FR-09)
  - frontend/src/routes/api/back-office/transfer/+server.ts (POST + branch restore — ดู FR-05)
  - frontend/src/lib/features/operations/data/operations.remote.ts
  - frontend/src/lib/features/operations/application/queries.ts
  - frontend/src/lib/features/operations/ui/transfer-list.svelte
  - frontend/src/routes/api/back-office/transfer/[id]/+server.ts (เพิ่ม DELETE method)
  - frontend/e2e/transfer-delete-undo.test.ts (ใหม่ — ปิด DoD ข้อ 1/3/4 ที่ unit test เข้าไม่ถึง)
  - CR-089 (สืบเนื่องจากการแยก CR — ไม่ต้องรอ CR-089 approve ก่อน, เป็นอิสระจากกัน)
---

# CR-090 — T-13 โอนย้ายข้ามศูนย์: ลบคำร้อง + Undo

> Spun out จาก [CR-089](CR-089-t13-transfer-driver-dispute.md) เมื่อ 2026-08-25 — เดิมรวมอยู่ใน CR
> เดียวกับ lot/driver-plate/dispute แต่การลบไม่เปลี่ยน shape ของ `stock_transfer` doc เลย (ไม่มี field
> ใหม่ค้างอยู่บน doc ที่รอด — ลบคือลบ) จึงไม่มีเหตุผลทางเทคนิคให้ต้องรอ approve พร้อมกับ CR-089 ที่ต้องเคาะ
> `schema_v` ร่วมกัน — approve/ship อิสระจาก CR-089/CR-091 ได้ทั้งหมด

## สรุป (TL;DR)

เพิ่มปุ่มลบคำร้องโอนย้าย (`stock_transfer`) — ลบได้เฉพาะสถานะ `requested` เท่านั้น (ก่อนมี `stock_ledger`
เกิดขึ้นจากคำร้องนี้) พร้อม Undo ผ่าน toast ค้าง 5 วินาที ตาม CR-059 §4.5 · **ไม่กระทบ `schema_v`** ของ
`stock_transfer` เลย (ไม่มี field ใหม่ — เป็นแค่ operation ใหม่) · กระทบ `operations` feature (data +
application + ui layer) และ 1 API route · **status `approved` (2026-09-01)** — เป็น hard-delete ตัวแรก
ของระบบที่ปกติยึด append-only/soft-transition ทุกจุด ⇒ FR-03 (server re-check) และ FR-08/FR-09
(กติกาการกู้คืน) ห้ามตัดออกเพื่อความเร็ว · **ต้องทำ technical spike ตาม §Spike ก่อนเขียนโค้ด restore**

---

## Requirements

- **FR-01** — ลบได้เฉพาะตอน `status === 'requested'` เท่านั้น (ก่อนจุดที่ `dispatchTransfer` เขียน
  `stock_ledger` ครั้งแรก — ลบตอนนี้จึงไม่มี ledger row ค้างเป็น orphan) — source shelter (`from_shelter`)
  เท่านั้นที่ลบได้ (ใช้กฎเดียวกับ dispatch/cancel ใน `transfer.authorization.ts`)
- **FR-02** — ลบจริง (CouchDB `DELETE /central_ops/{id}?rev=...`) ผ่าน `adminRaw` แบบเดียวกับ write
  path เดิม — ไม่ใช่ soft-mark ด้วย status ใหม่
- **FR-03** — server ต้อง re-check `status === 'requested'` ที่จังหวะลบจริง (ไม่เชื่อ client-side gate
  เพียงอย่างเดียว) — ถ้ามีคนอื่น dispatch ไปแล้วก่อนหน้าคำสั่งลบมาถึง (race) ต้อง reject การลบด้วย error
  ที่ชัดเจน ไม่ silently no-op
- **FR-04** — UI (`transfer-list.svelte`) แสดง toast พร้อมปุ่ม "เลิกทำ" (Undo) ค้าง 5 วินาทีหลังกดลบ —
  client เก็บ doc body ที่ลบไว้ในหน่วยความจำชั่วคราวก่อนเรียก delete
- **FR-05** — กด Undo ภายใน 5 วินาที → `PUT` doc เดิมกลับด้วย `_id` เดิม (เนื้อหาตรงกับก่อนลบทุก field)
  ผ่าน route `create`/`+server.ts` เดิม (ใช้ `_id` explicit ไม่ใช่ mint ใหม่) — เส้นทางนี้ต้องเป็น
  **code path แยก** ที่อยู่ใต้ route เดิม ไม่ใช่การเติม `_id` เข้า input schema ของการสร้างคำร้องปกติ
- **FR-06** — เกิน 5 วินาที cache ฝั่ง client ถูกทิ้ง — กู้คืนไม่ได้อีกผ่าน UI นี้ (ต้องสร้างคำร้องใหม่)
- **FR-07** — ปุ่มลบอยู่ในตาราง `transfer-list.svelte` แถวเดิม (ไม่ผูกกับหน้ารายละเอียดของ
  [CR-091](CR-091-t13-transfer-detail-page.md) เพื่อให้ ship ได้เองโดยไม่ต้องรอ CR-091)

### กติกาการกู้คืน (amend 2026-09-02 — ข้อบังคับที่ FR-05 เดิมยังไม่ได้ระบุ)

- **FR-08** — เส้นทาง restore ต้อง `PUT` **body ที่ client capture ไว้ตาม FR-04 ตรงๆ** ห้ามวิ่งผ่าน
  `createTransfer()` หรือ factory ใดๆ · เหตุผลเชิงเทคนิค: `createTransfer()`
  (`domain/operations.ts`) เรียก `makeDoc()` (`$lib/db/model.ts`) ซึ่ง mint `_id` ใหม่ และ stamp
  `created_at` / `updated_at` / `created_by` ใหม่ทั้งชุด แล้วยัง stamp `timeline.requested.at = now()`
  ทับอีกชั้น ⇒ กู้คืนผ่าน factory จะได้เอกสารที่ประวัติเป็นเวลาที่กด Undo ซึ่งขัด FR-05
  ("เนื้อหาตรงกับก่อนลบทุก field")
  | field ที่ต้องคงค่าเดิมหลัง restore | ที่มา |
  | --- | --- |
  | `_id` | doc เดิม (FR-05) |
  | `created_at` / `created_by` | envelope เดิม — ห้ามประทับใหม่ |
  | `updated_at` | ค่าเดิมก่อนลบ |
  | `timeline.requested.at` / `.by` | ค่าเดิมก่อนลบ |
  | `status` | ต้องเป็น `requested` เท่านั้น (สอดคล้อง FR-01) |
- **FR-09** (amend 2026-09-04 — **กลับด้านจากฉบับ 2026-09-02** ตามผล §Spike) — เส้นทาง restore ต้อง
  `PUT` **โดยไม่แนบ `_rev`** · ผลวัดจริงกับ CouchDB 3.5.2 (ดู §Spike): `PUT` `_id` เดิมกลับหลัง
  `DELETE` โดยไม่แนบ `_rev` ได้ `201` และ CouchDB ต่อ revision chain จาก tombstone ให้เอง ส่วนการ
  แนบ tombstone `_rev` — ไม่ว่าจะใส่ใน body หรือ `?rev=` — ได้ `409 conflict` เสมอ ⇒ การแนบ `_rev`
  ทำให้ restore พังทุกครั้ง **ห้ามแนบ**
  `rev` ที่ `DELETE` คืนมายังส่งกลับไปกับ response ของการลบตามเดิม (ไว้อ้างอิง/ตรวจสอบ) แต่ client
  ไม่ต้องส่งกลับมาตอน restore
  **ผลพลอยได้:** `PUT` แบบไม่แนบ `_rev` ทับเอกสารที่ยัง**ไม่ถูกลบ**ก็ได้ `409` เหมือนกัน ⇒ CouchDB
  บังคับข้อ "ห้ามทับเอกสารที่มีอยู่" ของ FR-10 ให้เองในระดับ storage โดยไม่ต้อง read-then-check
  (ซึ่ง race ได้) — โค้ดเพียง map `409` เป็น error ที่อ่านรู้เรื่อง
- **FR-10** — guard ของเส้นทาง restore ต้องบังคับกฎเดียวกับ FR-01/FR-03: source shelter เท่านั้น และ
  body ที่กู้คืนต้องมี `status === 'requested'` — client ต้องไม่สามารถใช้เส้นทางนี้สร้างเอกสารใหม่
  หรือทับเอกสารที่มีอยู่ได้

---

## Acceptance (DoD)

- [x] ลบคำร้องที่ `status === 'requested'` สำเร็จ, คำร้องหายจากตาราง list ทันที (FR-01, FR-02)
- [x] พยายามลบคำร้องที่ `status !== 'requested'` (เช่น `shipped`) ต้องถูก **server** reject แม้ client
      พยายามส่ง request ตรงมา (ไม่ใช่แค่ปุ่มถูกซ่อนที่ UI) (FR-03)
- [x] ลบแล้วกด Undo ภายใน 5 วิ คำร้องกลับมาเหมือนเดิมทุก field รวมทั้ง `_id` เดิม (FR-04, FR-05)
- [x] ลบแล้วปล่อยเกิน 5 วิโดยไม่กด Undo — ปุ่ม Undo หายไป, คำร้องกู้คืนไม่ได้อีก (FR-06)
- [x] ปลายทาง (`to_shelter`) กดลบคำร้องของศูนย์ตนเองไม่ได้ (source-only) (FR-01)
- [x] หลัง Undo — `created_at` / `created_by` / `updated_at` / `timeline.requested` ของ doc ที่กู้คืน
      **เท่ากับค่าก่อนลบทุกตัว** (ไม่ใช่เวลาที่กด Undo) (FR-05, FR-08)
- [x] เส้นทาง restore `PUT` โดย**ไม่แนบ** `_rev` (ตรงกับผลที่บันทึกไว้ใน §Spike) และมี test ยืนยันว่า
      body ที่ส่งไป CouchDB ไม่มี `_rev` ติดไป · restore ทับ `_id` ที่ยังมีเอกสารอยู่ → `409` (FR-09, FR-10)
- [x] ยิง restore ด้วย body ที่ `status !== 'requested'` หรือจากศูนย์ที่ไม่ใช่ `from_shelter`
      → ถูก server reject (FR-10)

---

## Spike (ต้องทำก่อนเขียนโค้ด restore — amend 2026-09-02)

ยืนยันพฤติกรรมจริงของ CouchDB กับ tombstone ก่อน implement FR-08/FR-09 · ใช้เวลาไม่กี่นาที:

1. สร้าง doc ทดสอบใน `central_ops`
2. `DELETE /central_ops/{id}?rev={rev}` — บันทึก `rev` ที่ response คืนมา
3. ลอง `PUT /central_ops/{id}` ด้วย body เดิม **ไม่แนบ** `_rev` → บันทึก status code ที่ได้
4. ลอง `PUT` เดิมอีกครั้ง **แนบ** `_rev` จากขั้นที่ 2 → บันทึก status code ที่ได้

บันทึกผลทั้ง 2 เคสลง Decision log ของไฟล์นี้ก่อนเปิด PR — ถ้าผลออกมาว่า `PUT` โดยไม่แนบ `_rev` สำเร็จ
ให้ amend FR-09 ตามผลจริง (ห้ามเดาจากเอกสาร CouchDB อย่างเดียว)

### ผลจริง (รัน 2026-09-04 · CouchDB 3.5.2 · db `central_ops` · doc `type: stock_transfer`)

| เคส | คำสั่ง | ผล |
| --- | --- | --- |
| A | `PUT /central_ops/{id}` body เดิม **ไม่แนบ** `_rev` (หลัง `DELETE`) | **`201`** — `rev` ที่ได้คือ `3-…` (ต่อ chain จาก tombstone `2-…`) · อ่านกลับมาแล้ว `created_at` / `created_by` / `updated_at` / `timeline.requested` ตรงกับก่อนลบครบทุกตัว |
| B | `PUT /central_ops/{id}` **แนบ** tombstone `_rev` ใน body | **`409`** `{"error":"conflict","reason":"Document update conflict."}` |
| B′ | `PUT /central_ops/{id}?rev={tombstone}` (ไม่ใส่ `_rev` ใน body) | **`409`** — เหมือนเคส B |
| C | `PUT /central_ops/{id}` **ไม่แนบ** `_rev` ทับเอกสารที่ยัง**ไม่ถูกลบ** | **`409`** — CouchDB กันการทับให้เอง |

สรุป: สมมติฐานของ FR-09 ฉบับ 2026-09-02 ผิด — tombstone `_rev` **ใช้ restore ไม่ได้เลย** ไม่ใช่แค่
"ไม่จำเป็น" ⇒ amend FR-09 กลับด้าน · เคส C ทำให้ข้อ "ห้ามทับเอกสารที่มีอยู่" ของ FR-10 ได้มาฟรีจาก
storage layer ซึ่งกัน race ได้ดีกว่า read-then-check ในโค้ด

---

## Why

- CR-059 §4.5 (UI Safety Standards, ผูกกับ Task #13) กำหนด "ปุ่ม Undo การลบแถวรายการผ่าน Toast
  Notification ค้างไว้ 5 วินาที เพื่อป้องกันการกดลบพลาด" — ตรวจโค้ดจริงพบว่า `stock_transfer`
  ทั้งฟีเจอร์ไม่มีปุ่มลบเลยแม้แต่ปุ่มเดียว (`71fd0b35` ทำแค่ create/dispatch/receive/cancel)
- แยกออกจาก [CR-089](CR-089-t13-transfer-driver-dispute.md) เพราะการลบไม่เปลี่ยน shape ของ
  `stock_transfer` doc ที่ยังอยู่ (ลบคือลบทั้ง doc) — ไม่มีเหตุผลทางเทคนิคให้ผูก schema_v เดียวกับ
  lot/driver-plate/dispute ซึ่งเป็นคนละเรื่องกัน (project owner ถามหลัง CR-089 ฉบับแรกว่าทำไมไม่แยก)
- **ข้อควรระวังที่ต้องตัดสินใจก่อน approve:** ระบบทั้งระบบยึดหลัก append-only (`stock_ledger`) หรือ
  soft-transition (`status`) ทุกจุด — ไม่มี operational doc ไหนเคยถูกลบจริงมาก่อน FR-01–FR-03 จำกัด
  ขอบเขตให้ลบได้เฉพาะก่อนมี ledger เกิดขึ้นเพื่อไม่ขัดหลัก append-only ของ `stock_ledger` (ตัว
  `stock_transfer` เองไม่ใช่ append-only doc อยู่แล้วในทางเทคนิค — เปลี่ยน `status` ไปมาได้ตาม state
  machine) แต่ยังเป็น **operation ใหม่** (hard delete) ที่ไม่มี precedent เดิมในโค้ดฐานให้เทียบ

---

## Change (before → after)

| เรื่อง | ก่อน (โค้ดใน `71fd0b35`) | หลัง (CR นี้) |
| --- | --- | --- |
| ปุ่มลบคำร้อง | ไม่มีเลย — มีแค่ปุ่ม "ยกเลิก" (`cancel`, soft-transition) | เพิ่มปุ่มลบจริง เฉพาะสถานะ `requested`, source-only |
| Undo | ไม่มี | Toast ค้าง 5 วิ, กด Undo คืน doc เดิมทุก field |

---

## Impact

- **Authorization:** `frontend/src/lib/features/operations/domain/transfer.authorization.ts` — เพิ่ม
  guard สำหรับ delete (source-only + status `requested`, มิเรอร์ pattern เดียวกับ `assertActorMayTransition`
  ที่ใช้กับ dispatch/cancel)
- **Data/server:** `frontend/src/lib/features/operations/data/transfer.server-repository.ts` — เพิ่ม
  `remove(id, actorShelter)` ที่คืน `rev` ของ tombstone กลับมาด้วย (FR-01–FR-03, FR-09) และ
  `restore(doc, rev, actorShelter)` ที่ `PUT` body ตรงๆ **ไม่ผ่าน `createTransfer()`** (FR-08, FR-10);
  `routes/api/back-office/transfer/[id]/+server.ts` เพิ่ม `DELETE` method (re-use `_auth.ts` เดิม);
  `routes/api/back-office/transfer/+server.ts` เพิ่ม branch restore ใต้ `POST` เดิม (FR-05)
- **Client:** `operations.remote.ts`, `application/queries.ts` เพิ่ม hook `useDeleteTransfer`
- **UI:** `transfer-list.svelte` — เพิ่มปุ่มลบ + toast Undo (FR-04–FR-06)
- **Test:** `transfer.authorization.test.ts`, `transfer.server-repository.test.ts`,
  `routes/api/back-office/transfer/[id]/server.test.ts` (เพิ่ม `DELETE` case)
- ปิด backlog note ที่ค้างใน CR-059 (§4.5 Undo) บางส่วนของ 3 ไฟล์ที่แยกจาก CR-089 เดิม

---

## Migration

N/A — ไม่แตะ `schema_v` ของ `stock_transfer` เลย (delete เป็น operation ใหม่ ไม่ใช่การเปลี่ยนรูปร่าง doc
ที่ยัง persist อยู่)

---

## Decision log

- 2026-08-25 — proposed — spun out จาก CR-089 (เดิมรวมกันเป็น CR เดียวครอบคลุม 5 กลุ่ม) หลัง project
  owner ถามเหตุผลที่ไม่แยก CR — เหตุผลทางเทคนิคคือกลุ่มนี้ไม่แตะ `schema_v` ของ `stock_transfer` เลย
  ต่างจาก lot/driver-plate/dispute (CR-089) ที่ต้องเคาะ `schema_v` 2 → 3 ร่วมกันเป็นก้อนเดียว — แยกออกมา
  เพื่อให้ approve/ship ได้อิสระ ไม่ต้องรอ CR-089 หรือ CR-091
- 2026-09-01 — **project owner เคาะ `approved`** — FR-01–FR-07 ตามที่เสนอไว้ ไม่มีการแก้ scope
- 2026-09-02 — **amend: เพิ่ม FR-08/FR-09/FR-10 + §Spike** (tracking = amend + Decision log ตามที่
  project owner เคาะ) — FR-05 เดิมระบุปลายทาง ("PUT `_id` เดิม เนื้อหาตรงกับก่อนลบทุก field") แต่ไม่ได้
  ระบุข้อบังคับ 2 ข้อที่จำเป็นต่อการทำให้เป็นจริง ซึ่งตรวจพบจากการเทียบกับโค้ดจริงบน `develop @ e0296dac`:
  1. **envelope ถูกประทับใหม่** — เส้นทางสร้างคำร้องปัจจุบัน (`transfer.server-repository.ts` →
     `createTransfer()` → `makeDoc()`) mint `_id` ใหม่ + stamp `created_at`/`updated_at`/`created_by`
     ใหม่ และ stamp `timeline.requested.at = now()` ⇒ กู้คืนผ่าน factory ได้เอกสารที่ประวัติเพี้ยน
     ซึ่งขัดตัว FR-05 เอง ⇒ **FR-08**
  2. **tombstone/`_rev`** — ไฟล์นี้ฉบับก่อนหน้าไม่ได้กล่าวถึง `_rev` ของ tombstone เลย ทั้งที่ FR-02
     สั่งลบจริง การ `PUT` `_id` เดิมกลับจึงอาจชนกับ revision history ⇒ **FR-09** + **§Spike**
  เพิ่ม **FR-10** กำกับ guard ของเส้นทาง restore ด้วย เพราะการรับ `_id` จาก client เปิดช่องให้สร้าง/ทับ
  เอกสารได้ถ้า guard หลวม · การแก้นี้ไม่เปลี่ยน `schema_v`, enum, หรือ state machine — เป็นการเติม
  ข้อบังคับให้ FR-05 ที่ approve แล้วทำได้จริง ⇒ ไม่เข้าเงื่อนไข `docs/change-management.md` §2
  ที่ต้องเปิด CR ใหม่
- 2026-09-04 — **รัน §Spike แล้ว · amend FR-09 กลับด้าน** (tracking = amend + Decision log ตามที่
  §Spike สั่งไว้เอง) — ผลวัดจริงกับ CouchDB 3.5.2 อยู่ในตาราง §Spike: restore ต้อง `PUT` **โดยไม่แนบ**
  `_rev` (ได้ `201`) ส่วนการแนบ tombstone `_rev` ได้ `409` ทุกรูปแบบ ⇒ ข้อสันนิษฐานของ FR-09 ฉบับ
  2026-09-02 ("ต้องแนบ `_rev` ไม่งั้นเสี่ยง `409`") ผิดทั้งข้อ · ปรับ FR-09 + DoD ข้อ 7 ตามผลจริง
  เพิ่มเติม: `PUT` แบบไม่แนบ `_rev` ทับเอกสารที่ยังมีอยู่ได้ `409` ⇒ ข้อ "ห้ามทับเอกสารที่มีอยู่" ของ
  FR-10 บังคับโดย storage layer เอง โค้ดจึงไม่ต้อง read-then-check (ซึ่ง race ได้) แค่ map `409`
  การแก้นี้ไม่เปลี่ยน `schema_v`, enum, state machine หรือ scope — เป็นการแก้ข้อเท็จจริงทางเทคนิคของ
  FR ที่ §Spike เปิดช่องให้แก้ไว้แล้ว ⇒ ไม่เข้าเงื่อนไข `docs/change-management.md` §2 ที่ต้องเปิด CR ใหม่
- **ทางเลือกที่พิจารณาแล้วไม่เลือกในรอบนี้:** (ข) แยก endpoint `POST .../transfer/[id]/restore` —
  จัดการ `_rev` ตรงกว่าแต่เพิ่ม API surface และ pattern ใหม่ที่ไม่มีที่อื่นในโค้ดฐาน · (ค) เลื่อนการลบจริง
  5 วินาที (Undo = ยกเลิก timer ไม่เคยยิง `DELETE`) — failure mode ปลอดภัยกว่า แต่ขัดตัวอักษร
  FR-02/FR-04/FR-05 ⇒ ต้องขอ deviation อย่างเป็นทางการ · **คงทาง (ก) ตาม FR-05 เดิม** — เหตุผล:
  (ก) ตรงตัวอักษร FR-05 ที่ approve แล้ว และไม่เพิ่ม API surface · ข้อแลกเปลี่ยนที่ยอมรับคือ route เดียว
  ทำ 2 ความหมาย จึงต้องมี FR-10 คุม guard กำกับไว้
