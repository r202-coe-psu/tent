---
id: CR-090
title: T-13 โอนย้ายข้ามศูนย์ — ยกเลิกคำร้อง + Undo การยกเลิก 5 วินาที
status: approved
date: 2026-08-25
updated: 2026-09-09
requested_by: CR-059 follow-up (§4.5 UI Safety Standards, Task #13) — spun out จาก CR-089 (2026-08-25, ไม่แตะ schema_v)
decided_by: Project Owner
layer: volatile
affects:
  - docs/data/schema.md §5.5 (ตาราง transition — เพิ่ม `cancelled → requested`, ไม่แตะ schema_v)
  - docs/changes/CR-089-t13-transfer-driver-dispute.md (FR-05 amend — resume ลบ `dispute_reason`)
  - frontend/src/lib/features/operations/domain/transfer.authorization.ts
  - frontend/src/lib/features/operations/domain/operations.ts (transition `cancelled → requested` + ลบ reason)
  - frontend/src/lib/features/operations/data/transfer.server-repository.ts
  - frontend/src/routes/api/back-office/transfer/[id]/transition/+server.ts (รองรับ from `cancelled`)
  - frontend/src/lib/features/operations/data/operations.remote.ts
  - frontend/src/lib/features/operations/application/queries.ts
  - frontend/src/lib/features/operations/ui/transfer-list.svelte (toast undo + ตัวกรองซ่อน `cancelled`)
  - frontend/e2e/transfer-cancel-undo.test.ts (ใหม่ — แทน transfer-delete-undo.test.ts)
  - CR-089 (สืบเนื่องจากการแยก CR — ไม่ต้องรอ CR-089 approve ก่อน, เป็นอิสระจากกัน)
---


# CR-090 — T-13 โอนย้ายข้ามศูนย์: ยกเลิกคำร้อง + Undo การยกเลิก

> Spun out จาก [CR-089](CR-089-t13-transfer-driver-dispute.md) เมื่อ 2026-08-25 — เดิมรวมอยู่ใน CR
> เดียวกับ lot/driver-plate/dispute แต่กลุ่มนี้ไม่เปลี่ยน shape ของ `stock_transfer` doc เลย จึงไม่มี
> เหตุผลทางเทคนิคให้ต้องรอ approve พร้อมกับ CR-089 ที่ต้องเคาะ `schema_v` ร่วมกัน

> **⚠️ ขอบเขตเปลี่ยนเมื่อ 2026-09-09** — CR ฉบับ 2026-08-25 ถึง 2026-09-04 กำหนดให้ทำ **hard delete +
> undo (restore)** · ฉบับปัจจุบันถอน hard delete ออกทั้งหมดและใช้ **ยกเลิก (soft-transition) + undo
> การยกเลิก** แทน · FR-01–FR-10 ชุดเดิมถูกแทนด้วย FR-01–FR-09 ชุดใหม่ทั้งหมด — ดู Decision log
> 2026-09-09 · §Spike ด้านล่างเก็บไว้เป็นบันทึกผลวัด CouchDB ไม่มีโค้ดใดใช้แล้ว

## สรุป (TL;DR)

`stock_transfer` **ไม่มี hard delete** — การเอาคำร้องออกจากงานทำได้ทางเดียวคือปุ่ม "ยกเลิก"
(`requested → cancelled`, บังคับ `cancel_reason` ตาม CR-089 FR-03) · เพิ่ม **Undo การยกเลิก** ผ่าน
toast 5 วินาที ซึ่ง implement เป็น transition ใหม่ `cancelled → requested` (source-only, ลบ
`cancel_reason`) · เพิ่มตัวกรองซ่อนแถว `cancelled` เป็นค่าตั้งต้น · **แตะ state machine ของ
`stock_transfer` (stable core)** — เจ้าของโครงการเคาะเอง 2026-09-09 · **ไม่ bump `schema_v`** (ไม่มี
field/enum/`timeline` entry ใหม่) · กระทบ `operations` feature ทั้ง 4 ชั้น + route transition เดิม

---

## Requirements

- **FR-01** — `stock_transfer` **ห้ามมี hard delete** · ไม่มี endpoint `DELETE` และไม่มีเส้นทาง restore
  · การเอาคำร้องออกจากงานทำได้ทางเดียวคือ transition `requested → cancelled` ตาม CR-089 FR-03
- **FR-02** — เพิ่ม transition `cancelled → requested` ("เลิกทำการยกเลิก") — **source shelter
  (`from_shelter`) เท่านั้น** · ไม่บังคับ field เพิ่ม · ไม่มีกำหนดเวลาและไม่จำกัดจำนวนครั้ง
  · มิเรอร์ resume (`disputed → requested`, CR-089 FR-05) ทุกประการ
- **FR-03** — server ต้องบังคับ FR-02 ที่ `transfer.authorization.ts` + `transition()` ไม่ใช่แค่ซ่อนปุ่ม
  ที่ UI · `cancelled → shipped` / `received` / `disputed` ตรง ๆ ยังห้ามเหมือนเดิม (ต้องผ่าน
  `requested` ก่อนเสมอ)
- **FR-04** — transition `cancelled → requested` ต้อง **ลบ `cancel_reason` ออกจาก doc**
  · กติกาที่ใช้ร่วมกันทั้งฟีเจอร์: field `*_reason` มีได้เฉพาะบน doc ที่อยู่ในสถานะที่บังคับกรอกมัน
  · CR-089 FR-05 ถูก amend วันเดียวกันให้ resume ลบ `dispute_reason` ด้วยกฎเดียวกัน
  · `timeline.*` **ไม่ถูกลบ** — เป็นประวัติ ไม่ใช่ field สถานะปัจจุบัน
- **FR-05** — UI (`transfer-list.svelte`) แสดง toast พร้อมปุ่ม **"เลิกทำ"** ค้าง 5 วินาทีหลังยกเลิก
  สำเร็จ · กดแล้วยิง transition ตาม FR-02
- **FR-06** — **toast คือช่องทางเดียวของการ undo ใน UI ของ CR นี้** — ตาราง `transfer-list.svelte`
  ไม่มีปุ่ม "เลิกทำการยกเลิก" บนแถว `cancelled` · ผู้ใช้ที่พลาดหน้าต่าง 5 วินาทีต้องสร้างคำร้องใหม่
  · ที่มา: CR-059 §4.5 ระบุช่องทาง (Toast Notification), อายุ (5 วินาที) และวัตถุประสงค์ (กันกดพลาด)
  ไว้ครบ — การกดพลาดคือสิ่งที่รู้ตัวภายในไม่กี่วินาที ซึ่ง toast ครอบคลุมเต็มที่แล้ว
  · **การเปิดคำร้องที่ยกเลิกไปแล้วกลับมาใหม่เป็นคนละเรื่อง** (การตัดสินใจใหม่ทางธุรกิจ ไม่ใช่การกัน
  กดพลาด) — ไม่อยู่ใน scope ของ CR นี้ ถ้าต้องการต้องมี requirement ของตัวเอง น่าจะอยู่ที่
  [CR-091](CR-091-t13-transfer-detail-page.md) ซึ่งมี timeline ให้ดูประกอบการตัดสินใจ
- **FR-06.1** — หน้าต่าง 5 วินาทีบังคับที่ **UI เท่านั้น ไม่ใช่กติกาของ state machine** — server ไม่จำกัด
  เวลาของ `cancelled → requested` ตาม FR-02 · เจตนา: เอกสารไม่ถูกทำลาย และ CR-091 หยิบ transition
  นี้ไปทำ UI ของตัวเองได้โดยไม่ต้องแก้ฝั่ง server
- **FR-07** — ตารางรายการโอนย้ายต้อง **ซ่อนแถว `cancelled` เป็นค่าตั้งต้น** และมีตัวกรองให้เปิดดูได้
  · เหตุผล: เมื่อไม่มีการลบ แถวที่ยกเลิกจะสะสมถาวรจนบังรายการที่ยังทำงานอยู่
- **FR-08** — หลัง undo เอกสารต้องคง `_id`, `created_at`, `created_by`, `timeline.requested` เดิม
  (ได้โดยปริยายเพราะเป็น transition ไม่ใช่การเขียนเอกสารใหม่) · `updated_at` ประทับใหม่ตามปกติของทุก
  transition
- **FR-09** — ปุ่มทั้งหมดอยู่ในตาราง `transfer-list.svelte` แถวเดิม ไม่ผูกกับหน้ารายละเอียดของ
  [CR-091](CR-091-t13-transfer-detail-page.md) เพื่อให้ ship ได้เองโดยไม่ต้องรอ CR-091
- **FR-10** — คอลัมน์สถานะต้องแสดง **เหตุผล**ใต้ป้ายสถานะสำหรับสถานะที่บังคับกรอกเหตุผล:
  `cancel_reason` เมื่อ `cancelled` และ `dispute_reason` เมื่อ `disputed` · เดิมแสดงเฉพาะ
  `disputed` · จำเป็นเพราะแถว `cancelled` เห็นได้เฉพาะตอนเปิดตัวกรอง (FR-07) ซึ่งเป็นจังหวะที่
  ผู้ใช้ต้องการรู้ว่าคำร้องถูกยกเลิกเพราะอะไร
  · **อ่านจาก `status` ไม่ใช่จากการมีอยู่ของ field** — `*_reason` ผูกกับสถานะเดียวเสมอ (FR-04)
  ค่าที่ค้างจาก build เก่าจึงไม่มีทางโผล่ใต้ป้ายสถานะผิด

---

## Acceptance (DoD)

- [ ] ไม่มี handler `DELETE` บน `/api/back-office/transfer/[id]` และไม่มี branch `restore` บน
      `POST /api/back-office/transfer` (FR-01)
- [ ] ยกเลิกคำร้อง `requested` ได้ พร้อมบังคับ `cancel_reason` ตามเดิม (CR-089 FR-03)
- [ ] กด "เลิกทำ" ภายใน 5 วินาที → คำร้องกลับเป็น `requested` โดย `_id` / `created_at` / `created_by` /
      `timeline.requested` ไม่เปลี่ยน (FR-02, FR-08)
- [ ] หลัง undo เอกสาร **ไม่มี field `cancel_reason`** เหลืออยู่ (FR-04)
- [ ] resume (`disputed → requested`) ลบ `dispute_reason` ด้วยกฎเดียวกัน แต่ **ไม่ลบ**
      `timeline.disputed` (FR-04 + CR-089 FR-05 amend 2026-09-09)
- [ ] ศูนย์ปลายทาง (`to_shelter`) ยิง `cancelled → requested` ไม่ผ่าน — server ตอบ `403` (FR-02, FR-03)
- [ ] ยิง `cancelled → shipped` / `received` / `disputed` ตรง ๆ ไม่ผ่าน — server reject (FR-03)
- [ ] เกิน 5 วินาที ปุ่ม "เลิกทำ" หายจาก toast และ **ไม่มีปุ่ม undo ที่อื่นใน UI** — แถว `cancelled`
      ที่เปิดผ่านตัวกรองไม่มีปุ่มนี้ (FR-06)
- [ ] เอกสารที่พลาดหน้าต่างยังอยู่ใน `central_ops` สถานะ `cancelled` พร้อม `cancel_reason` เดิม
      (FR-06.1 — เอกสารไม่ถูกทำลาย แม้ UI จะไม่มีทาง undo แล้ว)
- [ ] ตารางไม่แสดงแถว `cancelled` จนกว่าจะเปิดตัวกรอง (FR-07)
- [ ] แถว `cancelled` แสดง `cancel_reason` ใต้ป้ายสถานะ และแถว `disputed` แสดง `dispute_reason`
      เหมือนเดิม (FR-10)
- [ ] E2E: ยกเลิก → แถวหายจากมุมมองตั้งต้น → กด "เลิกทำ" → แถวกลับมาเป็น "รอส่งมอบ"

---

## Spike (บันทึกอ้างอิง — ไม่ถูกใช้แล้วตั้งแต่ amend 2026-09-09)

> เนื้อหาส่วนนี้เขียนไว้ตอนที่ CR ยังกำหนด hard delete + restore · เก็บไว้เพราะผลวัดพฤติกรรม
> tombstone ของ CouchDB 3.5.2 ยังมีค่าอ้างอิงสำหรับงานอื่น · **ไม่มี FR ข้อใดในฉบับปัจจุบันอ้างถึง**

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

---

## Why

- CR-059 §4.5 (UI Safety Standards, ผูกกับ Task #13) กำหนด "ปุ่ม Undo การลบแถวรายการผ่าน Toast
  Notification ค้างไว้ 5 วินาที เพื่อป้องกันการกดลบพลาด" — ข้อกำหนดที่แท้จริงคือ **ผู้ใช้ต้องมีทางถอย
  จากการกดพลาด** · CR-059 ไม่ได้ระบุว่าการ "ลบ" ต้องเป็น hard delete
- **ทำไมไม่ใช้ hard delete** (เคาะ 2026-09-09) — ระบบยึด append-only (`stock_ledger`) หรือ
  soft-transition (`status`) ทุกจุด ไม่มี operational doc ไหนถูกลบจริงมาก่อน · `cancel_reason` ที่
  CR-089 FR-03 บังคับกรอกอยู่แล้วให้ข้อมูลว่าคำร้องนี้ไม่เดินต่อเพราะอะไร ซึ่ง hard delete ทำลายทิ้ง
  · กรณีกรอกผิดใช้ปุ่มยกเลิกพร้อมเขียนเหตุผลประกอบได้ ไม่จำเป็นต้องลบเอกสาร
- **ทำไมต้องมี FR-07 (ซ่อน `cancelled`)** — เมื่อไม่มีการลบ แถวที่ยกเลิกจะสะสมถาวร · ตารางจริงบน
  branch `CR-090` มีแถว "ยกเลิกแล้ว" 3 จาก 5 แถวตั้งแต่ยังไม่ขึ้น production
- **ทำไมแยกเป็น CR ของตัวเอง** — แยกจาก CR-089 เพราะกลุ่มนี้ไม่แตะ `schema_v` ต่างจาก
  lot/driver-plate/dispute ที่ต้องเคาะ `schema_v` 2 → 3 ร่วมกันเป็นก้อนเดียว
- **ข้อควรระวังที่ยังเหลือ:** FR-02 เพิ่มคู่ transition ย้อนกลับตัวที่สองเข้า state machine — `cancelled`
  เลิกเป็นสถานะปลายทาง · เป็นการแตะ **stable core** ตาม `docs/change-management.md` §1 ⇒ ต้องผ่าน
  review ก่อน merge (เจ้าของโครงการเคาะเอง 2026-09-09)

---

## Change (before → after)

| เรื่อง | ก่อน (CR-090 ฉบับ 2026-09-04) | หลัง (ฉบับ 2026-09-09) |
| --- | --- | --- |
| การเอาคำร้องออกจากงาน | hard delete (`DELETE /central_ops/{id}`) เฉพาะ `requested` | ไม่มี hard delete — ใช้ `requested → cancelled` อย่างเดียว |
| Undo | restore เอกสารที่ลบไปแล้ว (`PUT` body เดิม ไม่แนบ `_rev`) | transition `cancelled → requested` (source-only) |
| พลาดหน้าต่าง 5 วิ | เอกสารหายถาวร กู้ไม่ได้ | เอกสารยังอยู่ กลับมาแก้ได้ตามสิทธิ์ปกติ |
| `cancel_reason` | ถูกทำลายพร้อมเอกสาร | ถูกลบตอน undo, คงอยู่ตราบที่ `status === 'cancelled'` |
| แถว `cancelled` ในตาราง | แสดงทั้งหมด | ซ่อนเป็นค่าตั้งต้น + ตัวกรอง |
| API surface | `DELETE /[id]` + branch `restore` ใต้ `POST` | ไม่เพิ่ม endpoint — ใช้ route `transition` เดิม |
| state machine | ไม่แตะ | เพิ่ม `cancelled → requested` (stable core) |

---

## Impact

- **Domain:** `transfer.authorization.ts` — `isValidTransition()` เพิ่ม `cancelled → requested`
  และสาขา source-only · `operations.ts` — `transition()` ลบ `cancel_reason` / `dispute_reason`
  ตอนย้อนกลับ `requested` (FR-04)
- **Data/server:** `transfer.server-repository.ts` — ไม่มี `remove()` / `restore()` / `couchDelete()`
- **Route:** `routes/api/back-office/transfer/[id]/transition/+server.ts` รองรับ `from: cancelled`
  · `routes/api/back-office/transfer/[id]/+server.ts` ไม่มี `DELETE`
  · `routes/api/back-office/transfer/+server.ts` ไม่มี branch `restore`
- **Client:** `operations.remote.ts` + `application/queries.ts` — hook `useUndoCancelTransfer`
- **UI:** `transfer-list.svelte` — toast undo ผูกกับ `handleCancel()` + ตัวกรองซ่อน `cancelled` (FR-07)
- **Docs:** `docs/data/schema.md` §5.5 (ตาราง transition + `cancel_reason` / `dispute_reason`)
  · `CR-089` FR-05/FR-11 (resume ลบ `dispute_reason`) · `CR-059` §4.3/§4.5 decision sync
- **Test:** `transfer.authorization.test.ts`, `operations.test.ts`, `transfer.server-repository.test.ts`,
  `routes/api/back-office/transfer/[id]/transition/server.test.ts`, `e2e/transfer-cancel-undo.test.ts`

---

## Migration

**ไม่ bump `schema_v`** (คงที่ 3) — ไม่มี field ใหม่ ไม่มีค่า enum ใหม่ ไม่มี `timeline` entry ใหม่
· เปลี่ยนเฉพาะกฎ transition ซึ่งบังคับที่โค้ด server

**ข้อมูลเดิม:** ไม่ต้อง migrate · doc ที่ `status === 'cancelled'` อยู่แล้วจะย้อนกลับ `requested` ได้
ทันทีตาม FR-02 และ `cancel_reason` จะถูกลบตอนย้อนกลับ

**เส้นทาง `DELETE` ที่เคย implement:** ไม่เคยขึ้น `develop` — CR-090 ยังไม่ merge ⇒ ไม่มีเอกสารใน
production ที่ถูกลบไปแล้ว และไม่ต้องกู้คืนอะไร

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
- 2026-09-09 — **amend: ถอน hard delete ทั้งหมด → ยกเลิก + undo การยกเลิก** (tracking = amend +
  Decision log ตามที่ project owner เคาะ 2026-09-09) — project owner ทบทวนแล้วเห็นว่า CR-059 §4.5
  กำหนดเพียง "ปุ่ม Undo การลบรายการ" โดยไม่ได้ระบุว่าต้องเป็น hard delete และกรณีกรอกผิดใช้ปุ่มยกเลิก
  พร้อม `cancel_reason` (CR-089 FR-03) แทนได้ ⇒ ไม่มีเหตุผลให้เพิ่ม hard delete ตัวแรกของโค้ดฐาน
  ซึ่ง §Why ของ CR นี้เตือนไว้เองตั้งแต่ก่อน approve 2026-09-01
  · FR-01–FR-10 ฉบับเดิมถูกแทนด้วย FR-01–FR-09 ชุดใหม่ทั้งหมด · DoD เขียนใหม่ทั้งชุด
  · §Spike และผลวัด CouchDB 3.5.2 **คงไว้เป็นบันทึกอ้างอิง** — ไม่มีโค้ดใดใช้แล้ว
  · **แตะ stable core:** เพิ่ม `cancelled → requested` เข้า state machine ⇒ `cancelled` เลิกเป็น
    สถานะปลายทาง · `docs/change-management.md` §1 กำหนดให้ review ก่อน — **project owner เคาะเอง**
    (2026-09-09) ไม่ส่งให้ผู้อื่น review
  · **ไม่ bump `schema_v`** (ยังเป็น 3) — ไม่มี field / enum / `timeline` entry ใหม่ เปลี่ยนเฉพาะกฎ
    transition ที่บังคับในโค้ด server (เคาะโดย project owner 2026-09-09)
  · **`cancel_reason` ถูกลบตอน undo** (FR-04) และ **CR-089 FR-05 ถูก amend วันเดียวกัน** ให้ resume
    ลบ `dispute_reason` ด้วยกฎเดียวกัน — เพื่อไม่ให้ transition ย้อนกลับ 2 ตัวในฟีเจอร์เดียวกันมีกฎ
    จัดการ reason ต่างมาตรฐาน · `timeline.*` ไม่ถูกลบทั้งสองกรณี
  · **FR-07 (ซ่อนแถว `cancelled`) อยู่ใน CR นี้** ไม่แยกงาน — เป็นผลโดยตรงจากการเลิกลบเอกสาร
  · **FR-06 แก้ถ้อยคำ (2026-09-09, รอบเดียวกัน)** — ฉบับร่างแรกของ amend นี้เขียนว่าผู้ใช้ที่พลาด
    หน้าต่าง "ยังกลับมาแก้ได้ตามสิทธิ์ปกติ" ซึ่งสัญญาเส้นทางที่ UI ไม่มีจริง (ปุ่ม undo อยู่บน toast
    อย่างเดียว) · เทียบกับ CR-059 §4.5 แล้ว requirement ระบุช่องทาง/อายุ/วัตถุประสงค์ไว้ครบและ
    ไม่ได้ขอปุ่มบนแถว ⇒ แก้ถ้อยคำให้ตรงกับสิ่งที่ทำจริง แทนการเพิ่ม UI ที่ spec ไม่ได้ขอ
    · แยก FR-06.1 ออกมาเพื่อไม่ให้สับสนระหว่าง "UI ไม่มีทางอื่น" กับ "state machine ไม่จำกัดเวลา"
    ซึ่งเป็นคนละข้อและทั้งคู่เป็นเจตนา
  · **FR-10 (แสดงเหตุผลใต้สถานะ) เพิ่มในการ amend เดียวกัน** — ตารางเดิมแสดงเฉพาะ `dispute_reason`
    ทำให้แถวที่ยกเลิกไม่บอกสาเหตุ ซึ่งขัดกับ FR-07 ที่ทำให้แถวเหล่านั้นเห็นได้เฉพาะตอนตั้งใจเปิดดู
    · เป็นการเพิ่มการแสดงผลของ field ที่มีอยู่แล้ว ไม่แตะ field / rule / enum / scope
    ⇒ ไม่เข้าเงื่อนไข `docs/change-management.md` §2 ที่ต้องเปิด CR ใหม่
  · CR-089 กลับจาก `done` เป็น `approved` จนกว่าโค้ด resume จะแก้ตาม FR-05 ฉบับใหม่เสร็จ
