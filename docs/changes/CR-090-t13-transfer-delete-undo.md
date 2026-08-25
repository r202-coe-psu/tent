---
id: CR-090
title: T-13 โอนย้ายข้ามศูนย์ — ลบคำร้อง (เฉพาะ requested) + Undo 5 วินาที
status: proposed
date: 2026-08-25
requested_by: CR-059 follow-up (§4.5 UI Safety Standards, Task #13) — spun out จาก CR-089 (2026-08-25, ไม่แตะ schema_v)
decided_by: Project Owner
layer: volatile
affects:
  - frontend/src/lib/features/operations/domain/transfer.authorization.ts
  - frontend/src/lib/features/operations/data/transfer.server-repository.ts
  - frontend/src/lib/features/operations/data/operations.remote.ts
  - frontend/src/lib/features/operations/application/queries.ts
  - frontend/src/lib/features/operations/ui/transfer-list.svelte
  - frontend/src/routes/api/back-office/transfer/[id]/+server.ts (เพิ่ม DELETE method)
  - CR-089 (สืบเนื่องจากการแยก CR — ไม่ต้องรอ CR-089 approve ก่อน, เป็นอิสระจากกัน)
---

# CR-090 — T-13 โอนย้ายข้ามศูนย์: ลบคำร้อง + Undo

> Spun out จาก [CR-089](CR-089-t13-transfer-lot-driver-dispute.md) เมื่อ 2026-08-25 — เดิมรวมอยู่ใน CR
> เดียวกับ lot/driver-plate/dispute แต่การลบไม่เปลี่ยน shape ของ `stock_transfer` doc เลย (ไม่มี field
> ใหม่ค้างอยู่บน doc ที่รอด — ลบคือลบ) จึงไม่มีเหตุผลทางเทคนิคให้ต้องรอ approve พร้อมกับ CR-089 ที่ต้องเคาะ
> `schema_v` ร่วมกัน — approve/ship อิสระจาก CR-089/CR-091 ได้ทั้งหมด

## สรุป (TL;DR)

เพิ่มปุ่มลบคำร้องโอนย้าย (`stock_transfer`) — ลบได้เฉพาะสถานะ `requested` เท่านั้น (ก่อนมี `stock_ledger`
เกิดขึ้นจากคำร้องนี้) พร้อม Undo ผ่าน toast ค้าง 5 วินาที ตาม CR-059 §4.5 · **ไม่กระทบ `schema_v`** ของ
`stock_transfer` เลย (ไม่มี field ใหม่ — เป็นแค่ operation ใหม่) · กระทบ `operations` feature (data +
application + ui layer) และ 1 API route · **status ยังเป็น `proposed`** — เป็น hard-delete ตัวแรกของระบบ
ที่ปกติยึด append-only/soft-transition ทุกจุด แนะนำให้ project owner พิจารณาเป็นพิเศษก่อน approve

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
  ผ่าน route `create`/`+server.ts` เดิม (ใช้ `_id` explicit ไม่ใช่ mint ใหม่)
- **FR-06** — เกิน 5 วินาที cache ฝั่ง client ถูกทิ้ง — กู้คืนไม่ได้อีกผ่าน UI นี้ (ต้องสร้างคำร้องใหม่)
- **FR-07** — ปุ่มลบอยู่ในตาราง `transfer-list.svelte` แถวเดิม (ไม่ผูกกับหน้ารายละเอียดของ
  [CR-091](CR-091-t13-transfer-detail-page.md) เพื่อให้ ship ได้เองโดยไม่ต้องรอ CR-091)

---

## Acceptance (DoD)

- [ ] ลบคำร้องที่ `status === 'requested'` สำเร็จ, คำร้องหายจากตาราง list ทันที (FR-01, FR-02)
- [ ] พยายามลบคำร้องที่ `status !== 'requested'` (เช่น `shipped`) ต้องถูก **server** reject แม้ client
      พยายามส่ง request ตรงมา (ไม่ใช่แค่ปุ่มถูกซ่อนที่ UI) (FR-03)
- [ ] ลบแล้วกด Undo ภายใน 5 วิ คำร้องกลับมาเหมือนเดิมทุก field รวมทั้ง `_id` เดิม (FR-04, FR-05)
- [ ] ลบแล้วปล่อยเกิน 5 วิโดยไม่กด Undo — ปุ่ม Undo หายไป, คำร้องกู้คืนไม่ได้อีก (FR-06)
- [ ] ปลายทาง (`to_shelter`) กดลบคำร้องของศูนย์ตนเองไม่ได้ (source-only) (FR-01)

---

## Why

- CR-059 §4.5 (UI Safety Standards, ผูกกับ Task #13) กำหนด "ปุ่ม Undo การลบแถวรายการผ่าน Toast
  Notification ค้างไว้ 5 วินาที เพื่อป้องกันการกดลบพลาด" — ตรวจโค้ดจริงพบว่า `stock_transfer`
  ทั้งฟีเจอร์ไม่มีปุ่มลบเลยแม้แต่ปุ่มเดียว (`71fd0b35` ทำแค่ create/dispatch/receive/cancel)
- แยกออกจาก [CR-089](CR-089-t13-transfer-lot-driver-dispute.md) เพราะการลบไม่เปลี่ยน shape ของ
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
  `remove(id, actorShelter)` (FR-01–FR-03); `routes/api/back-office/transfer/[id]/+server.ts` เพิ่ม
  `DELETE` method (re-use `_auth.ts` เดิม)
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
- **ยังไม่ตัดสินใจ:** สถานะยังเป็น `proposed` — แนะนำให้ project owner พิจารณา FR-01–FR-03 เป็นพิเศษก่อน
  approve เพราะเป็น hard-delete ตัวแรกของระบบ ไม่มี precedent เดิมให้เทียบ (ต่างจาก CR-089/CR-091 ที่
  ขยายจาก pattern ที่มีอยู่แล้ว)
