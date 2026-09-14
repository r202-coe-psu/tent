---
id: CR-091
title: T-13 โอนย้ายข้ามศูนย์ — หน้ารายละเอียด Ticket (Banner + Timeline)
status: approved
date: 2026-08-25
updated: 2026-09-14
requested_by: CR-059 follow-up (§4.5 UI Safety Standards, Task #13) — spun out จาก CR-089 (2026-08-25, ไม่แตะ schema_v)
decided_by: Project Owner
layer: volatile
affects:
  - frontend/src/routes/(protected)/back-office/supply/transfer/[id]/+page.svelte (ใหม่)
  - frontend/src/routes/(protected)/back-office/supply/transfer/[id]/+page.ts (ใหม่)
  - frontend/src/lib/features/operations/ui/transfer-list.svelte (เพิ่มลิงก์ "ดูรายละเอียด")
  - frontend/src/lib/features/operations/index.ts (barrel export component ใหม่ถ้าจำเป็น)
  - frontend/src/lib/features/operations/data/operations.remote.ts (`getTransfer()` — 403 → `null`, amend 2026-09-14)
  - CR-089 (สืบเนื่องจากการแยก CR — ไม่ต้องรอทั้งสองอัน approve ก่อน, เป็นอิสระจากกัน) · FR-11 `timeline.disputed` → CR นี้ FR-04
  - CR-090 · FR-10 เหตุผลอ่านจาก `status` → CR นี้ FR-07 · FR-01/FR-06 ไม่มี hard delete, undo อยู่บน toast เท่านั้น → CR นี้ FR-05
  - CR-118 (lot metadata, เดิม draft/CR-106/CR-114) · FR-23 supersede FR-03 เดิม · FR-02 `item_id` ซ้ำได้ → CR นี้ FR-03
---

# CR-091 — T-13 โอนย้ายข้ามศูนย์: หน้ารายละเอียด Ticket

> Spun out จาก [CR-089](CR-089-t13-transfer-driver-dispute.md) เมื่อ 2026-08-25 — เดิมรวมอยู่ใน CR
> เดียวกับ lot/driver-plate/dispute แต่หน้ารายละเอียดเป็น UI ล้วน ไม่เปลี่ยน shape ของ `stock_transfer`
> doc เลย จึงไม่มีเหตุผลทางเทคนิคให้ต้องรอ approve พร้อมกับ CR-089 ที่ต้องเคาะ `schema_v` ร่วมกัน —
> approve/ship อิสระจาก CR-089/CR-090/CR-118 ได้ทั้งหมด (แสดง field จาก CR อื่นแบบ progressive — field
> ไหนยังไม่มีบน doc หรือยังไม่มีในโค้ดเพราะ CR นั้นยังไม่ landed ก็แสดงว่างไป ไม่ throw)

> **amend 2026-09-14** — sync ข้อความให้ตรงกับสิ่งที่ CR-089 / CR-090 / CR-118 เคาะหลังวันที่ CR นี้
> approve: FR-03 (lot + บรรทัด `item_id` ซ้ำ), FR-04 (`timeline.disputed`), FR-05 (ไม่มี delete / undo),
> FR-07 ใหม่ (เหตุผลใต้สถานะ) · และเคาะเพิ่ม: ป้ายฝั่งกรณีที่ 3 (FR-02), 403 แสดงเหมือน 404 (DoD),
> ส่วนแสดงล็อตเป็นงานของ PR ที่ land ทีหลัง · ไม่เปลี่ยน `schema_v`, enum, state machine หรือ route —
> ดู Decision log

## สรุป (TL;DR)

เพิ่มหน้ารายละเอียด Ticket แยกต่างหาก (`/back-office/supply/transfer/[id]`) แบบ **อ่านอย่างเดียว** แสดง
banner เส้นทางเต็มรูปแบบ + เหตุผลใต้สถานะ + รายการสินค้า (รวมล็อตเมื่อมี) + timeline การดำเนินการ ตาม
CR-059 §4.5 · **ไม่กระทบ `schema_v`** ของ `stock_transfer` (อ่าน field ที่มีอยู่แล้วเท่านั้น) · เพิ่ม
route ใหม่ 1 หน้า + ลิงก์จากตาราง list เดิม · **status `approved` (2026-09-01)** — แนะนำให้ทำท้ายสุดของ
ชุด T-13 เพื่อแสดง field ที่ CR-089/CR-118 เพิ่มไว้ในรอบเดียว

---

## Requirements

- **FR-01** — เพิ่ม route ใหม่ `src/routes/(protected)/back-office/supply/transfer/[id]/+page.svelte` —
  guard เดียวกับหน้า supply เดิม (`requireAuth` + warehouse role gate ผ่าน `+page.ts`)
- **FR-02** — หน้ารายละเอียดแสดง banner เส้นทางเต็ม: `from_shelter → to_shelter` พร้อมป้ายระบุชัดว่าศูนย์
  ที่ล็อกอินอยู่เป็นต้นทางหรือปลายทางของคำสั่งนี้ (logic เดียวกับ `isOutgoing()` ที่มีอยู่แล้วใน
  `transfer-list.svelte` — เอามาใช้ซ้ำ ไม่เขียนใหม่)
  - (amend 2026-09-14) ป้ายฝั่งมี 3 ค่า — ศูนย์ที่ล็อกอิน/เลือกอยู่ไม่ใช่ทั้ง `from_shelter` และ
    `to_shelter` (เกิดได้เฉพาะ `system_admin` ที่เปิด URL ตรง) ต้องขึ้นป้าย **"ไม่ใช่ศูนย์ของคำร้องนี้"**
    ห้ามขึ้น "ปลายทาง":
    | ศูนย์ที่ล็อกอิน/เลือกอยู่ | ป้าย |
    | --- | --- |
    | `= from_shelter` | ต้นทาง |
    | `= to_shelter` | ปลายทาง |
    | ไม่ตรงทั้งคู่ | ไม่ใช่ศูนย์ของคำร้องนี้ |
  - ตาราง list ใช้ logic ตัวเดียวกันและคงป้าย 2 แบบเดิม — list กรองเฉพาะคำร้องของศูนย์ที่เลือกอยู่แล้ว
    จึงไม่มีแถวที่ตกกรณีที่ 3 (FR-06)
- **FR-03** (amend 2026-09-14) — แสดงรายการ item ทั้งหมดของคำร้อง พร้อม field ต่อไปนี้ **เฉพาะเมื่อมีค่า**
  — field ที่ไม่มีบน doc ให้ข้ามการแสดงผลเงียบๆ ไม่ throw หรือขึ้น error:
  | field | ที่มา | ระดับ |
  | --- | --- | --- |
  | `driver_name`, `vehicle_plate` | [CR-089](CR-089-t13-transfer-driver-dispute.md) FR-01/FR-02 | คำร้อง |
  | `received_qty` | `stock_transfer` เดิม | บรรทัด |
  | `source_lot` (`lot_no`, `storage_zone`, `expiry`) | [CR-118](CR-118-t13-transfer-lot-metadata.md) FR-05, FR-23 | บรรทัด |
  | `dest_lots[]` (`lot_no`, `storage_zone`, `expiry` ต่อ `item_id`) | CR-118 FR-13, FR-23 | คำร้อง (ต่อ `item_id`) |
  - บรรทัดที่ `item_id` ซ้ำกัน (ผลของ Split Allocation — CR-118 FR-02) ต้องแสดง **แยกบรรทัดตามเดิม** ห้าม
    รวมยอดตาม `item_id` · key ของแต่ละบรรทัดใช้ `line_id` เมื่อมี (CR-118 FR-01) และต้องไม่ชนกันบน doc
    ที่ไม่มี `line_id` (CR-118 FR-04)
  > ฉบับก่อน 2026-09-14 ระบุว่า "**ไม่มี `lot`/`source_lot`**" เพราะ CR-089 ตัดกลุ่ม Lot ออก · ข้อความนั้น
  > ถูก supersede โดย CR-118 FR-23 (approved 2026-09-06)
- **FR-04** (amend 2026-09-14) — แสดง `timeline` เต็มเป็น step list แนวตั้ง (`at` + `by` ต่อ step) —
  เฉพาะ step ที่มีจริงในข้อมูล (ยังไม่ถึง `shipped` ก็ไม่ต้องมี step นั้นให้เห็น):
  | step | ที่มา | หมายเหตุ |
  | --- | --- | --- |
  | `requested` | `stock_transfer` เดิม | มีทุก doc |
  | `disputed` | [CR-089](CR-089-t13-transfer-driver-dispute.md) FR-11 | ค่าครั้งล่าสุดครั้งเดียว · **ยังอยู่หลัง resume** — แสดงแม้ `status` ไม่ใช่ `disputed` แล้ว |
  | `shipped` | `stock_transfer` เดิม | — |
  | `received` | `stock_transfer` เดิม | — |
  - ลำดับการแสดง: `requested` → `disputed` → `shipped` → `received` (`disputed` เกิดได้จาก `requested`
    เท่านั้น — CR-089 FR-07 — จึงเกิดก่อน `shipped` เสมอ)
  - `cancelled` **ไม่มี timeline entry** (CR-089 FR-11, CR-090 §Migration) ⇒ ไม่แสดงเป็น step และห้าม
    อนุมานเวลาจาก field อื่น (เช่น `updated_at`)
- **FR-05** (amend 2026-09-14) — ตาราง `transfer-list.svelte` เพิ่มลิงก์ "ดูรายละเอียด" ต่อแถว ไปหน้าใหม่นี้
  — ปุ่ม action เดิม (dispatch / receive / cancel / dispute / resume) **ยังอยู่ที่ตาราง list เหมือนเดิม
  ไม่ย้าย** ในรอบนี้ · หน้ารายละเอียด **ไม่มีปุ่ม action ใดๆ**
  - ไม่มีปุ่มลบ — `stock_transfer` ไม่มี hard delete ([CR-090](CR-090-t13-transfer-cancel-undo.md) FR-01)
  - ไม่มีปุ่มเลิกทำการยกเลิก / เปิดคำร้อง `cancelled` กลับมาใหม่ — undo อยู่บน toast ของ list เท่านั้น
    (CR-090 FR-06) · การเปิดคำร้องที่ยกเลิกไปแล้วกลับมาใหม่ต้องมี requirement ของตัวเอง ไม่อยู่ใน CR นี้
  - การยุบปุ่มเข้าหน้ารายละเอียดเพื่อลดความแน่นของแถวเป็น follow-up ที่ทำได้ทีหลังเมื่อทุก CR ที่เกี่ยวข้อง
    (CR-089, CR-090, CR-118) landed ครบแล้ว ไม่ใช่ scope ของ CR นี้
- **FR-06** — badge เส้นทางที่มีอยู่แล้วในตาราง list (`{from}→{to}` + tag ต้นทาง/ปลายทาง) คงไว้เหมือนเดิม
  ไม่ลบ — หน้ารายละเอียดเป็นของเพิ่มเติม ไม่ใช่ของทดแทน
- **FR-07** (ใหม่ 2026-09-14) — banner แสดง **เหตุผล** ใต้ป้ายสถานะด้วยกฎเดียวกับคอลัมน์สถานะของ list
  ([CR-090](CR-090-t13-transfer-cancel-undo.md) FR-10):
  | `status` | แสดง |
  | --- | --- |
  | `cancelled` | `cancel_reason` |
  | `disputed` | `dispute_reason` |
  | อื่นๆ | ไม่แสดงเหตุผล |
  - **อ่านจาก `status` ไม่ใช่จากการมีอยู่ของ field** — `*_reason` ผูกกับสถานะเดียวเสมอ (CR-090 FR-04)
    ค่าที่ค้างบน doc จาก build เก่าจึงไม่แสดงใต้สถานะผิด
  - ใช้ logic ตัวเดียวกับ list — ไม่เขียนกฎซ้ำ (หลักเดียวกับ FR-02)

---

## Acceptance (DoD)

- [ ] คลิก "ดูรายละเอียด" จากแถวใดก็ได้ในตาราง list ไปหน้ารายละเอียดของคำร้องนั้นถูกต้อง (FR-01, FR-05)
- [ ] Banner แสดงเส้นทางถูกทิศ + ป้ายต้นทาง/ปลายทางตรงกับศูนย์ที่ล็อกอินอยู่ (FR-02)
- [ ] `system_admin` ที่เลือกศูนย์ซึ่งไม่ใช่ทั้งต้นทางและปลายทาง เปิด URL ตรง → ป้าย "ไม่ใช่ศูนย์ของคำร้องนี้"
      (FR-02)
- [ ] Timeline แสดงเฉพาะ step ที่เกิดขึ้นจริง ไม่แสดง step ที่ยังไม่ถึง (FR-04)
- [ ] คัดค้าน → resume → เปิดหน้ารายละเอียด: step `disputed` ยังแสดงพร้อม `at`/`by` · คำร้อง `cancelled`
      ไม่มี step ยกเลิก (FR-04)
- [ ] เปิดหน้ารายละเอียดของคำร้องที่สร้างก่อน CR-089 landed (ไม่มี `driver_name`/`vehicle_plate`) ไม่ error
      — แสดงส่วนที่ไม่มีข้อมูลว่างไปเฉยๆ (FR-03)
- [ ] เปิดคำร้องที่ไม่มี `line_id` / `source_lot` / `dest_lots` ไม่ error · คำร้องที่มีบรรทัด `item_id` ซ้ำ
      แสดงครบทุกบรรทัดแยกกัน ไม่รวมยอด (FR-03)
- [ ] เมื่อ doc มี `source_lot` / `dest_lots` (หลัง CR-118 landed) หน้ารายละเอียดแสดงค่าเหล่านั้น (FR-03)
- [ ] คำร้อง `cancelled` แสดง `cancel_reason` · `disputed` แสดง `dispute_reason` · คำร้อง `requested` ที่มี
      `*_reason` ค้างบน doc ไม่แสดงเหตุผล (FR-07)
- [ ] หน้ารายละเอียดไม่มีปุ่ม action ใดๆ รวมถึงปุ่มลบและปุ่มเลิกทำการยกเลิก (FR-05)
- [ ] ผู้ใช้ศูนย์อื่นที่ไม่เกี่ยวกับคำร้องนี้ (ไม่ใช่ทั้ง `from_shelter`/`to_shelter`) เข้าหน้านี้ตรงไม่ได้
      (guard เดียวกับที่ list ใช้กรอง cross-shelter อยู่แล้ว)
  - (amend 2026-09-14) server คงตอบ `403` เหมือนเดิม · หน้ารายละเอียดแสดงข้อความเดียวกันทั้ง `403` และ
    `404` คือ **"ไม่พบคำร้อง หรือไม่มีสิทธิ์เข้าถึง"** — ไม่เปิดเผยว่าคำร้องนั้นมีอยู่จริงหรือไม่ และไม่แสดง
    field ใดของคำร้อง
  - client ต้องไม่ retry เมื่อได้ `403` (ผลเท่าเดิมทุกครั้ง)

---

## Why

- CR-059 §4.5 กำหนด "Banner แสดงเส้นทางส่งมอบ — หน้ารายละเอียด Ticket มี Banner แสดงเส้นทาง 'ต้นทาง →
  ปลายทาง' เต็มรูปแบบ พร้อมระบุชัดเจนว่าศูนย์ปัจจุบันทำหน้าที่เป็นฝั่งใดของคำสั่ง" — ตรวจโค้ดจริงพบว่ามีแค่
  คอลัมน์เส้นทางในตาราง list เท่านั้น ยังไม่มีหน้ารายละเอียดแยกเลย และ `timeline` ที่มีอยู่แล้วใน doc
  (`requested`/`shipped`/`received` at+by) ไม่เคยถูกแสดงในหน้าไหนเลย — เป็นของที่มีอยู่แล้วรอแค่ UI
- แยกออกจาก [CR-089](CR-089-t13-transfer-driver-dispute.md) เพราะหน้านี้เป็น UI ล้วน ไม่เปลี่ยน
  shape ของ `stock_transfer` doc เลย ไม่มีเหตุผลทางเทคนิคให้ผูก schema_v เดียวกับ lot/driver-plate/dispute
  (project owner ถามหลัง CR-089 ฉบับแรกว่าทำไมไม่แยก)
- ออกแบบให้ field จาก CR-089/CR-118 เป็น progressive enhancement (แสดงถ้ามี, ข้ามถ้ายังไม่มี) เพื่อให้
  CR นี้ ship ได้โดยไม่ต้องเรียงลำดับก่อน-หลังกับ CR อื่น
- CR-089 FR-11 เพิ่ม `timeline.disputed` โดยระบุเหตุผลว่า "เพื่อให้หน้ารายละเอียดของ CR-091 แสดงได้ว่า
  คัดค้านเมื่อไรและโดยใคร" ⇒ FR-04 ต้องครอบ step นี้

---

## Change (before → after)

| เรื่อง | ก่อน (โค้ดใน `71fd0b35`) | หลัง (CR นี้) |
| --- | --- | --- |
| Banner เส้นทางเต็ม | มีแค่คอลัมน์ในตาราง list | เพิ่มหน้า `/back-office/supply/transfer/[id]` แสดง banner เต็ม |
| Timeline | มีใน doc (`timeline{}`) แต่ไม่เคยแสดงที่ไหนเลย | แสดงเป็น step list ในหน้ารายละเอียด รวม `disputed` (CR-089 FR-11) |
| เหตุผลของสถานะ | แสดงเฉพาะในคอลัมน์สถานะของ list (CR-090 FR-10) | แสดงใต้ป้ายสถานะใน banner ด้วยกฎเดียวกัน |
| ล็อตต่อบรรทัด / ล็อตปลายทาง | ไม่มีที่แสดง | แสดง `source_lot` / `dest_lots` เมื่อมี (CR-118 FR-23) |

---

## Impact

- **UI (ใหม่):** route `frontend/src/routes/(protected)/back-office/supply/transfer/[id]/+page.svelte`
  + `+page.ts` (guard) — component รายละเอียด (banner + เหตุผล + item list + timeline)
- **UI (แก้):** `frontend/src/lib/features/operations/ui/transfer-list.svelte` — เพิ่มลิงก์ "ดูรายละเอียด"
  ต่อแถว (FR-05) · logic ฝั่ง/เหตุผลที่ต้องใช้ร่วมกับหน้าใหม่ (FR-02, FR-07)
- **Data (แก้, amend 2026-09-14):** `frontend/src/lib/features/operations/data/operations.remote.ts` —
  `getTransfer()` คืน `null` ทั้ง `403` และ `404` (เดิมคืน `null` เฉพาะ `404` และโยน error สำหรับ `403`)
  · ไม่แตะ route `GET /api/back-office/transfer/[id]`
- **Barrel:** `frontend/src/lib/features/operations/index.ts` — export component รายละเอียดใหม่ถ้าแยกเป็น
  ไฟล์ในฟีเจอร์ `operations/ui/` แทนที่จะเขียนอยู่ใน route ตรงๆ
- **Test:** unit test ของ logic derive (step list ordering, เหตุผลตาม `status`, key ของบรรทัด `item_id`
  ซ้ำ) + e2e smoke (คลิกลิงก์ → เห็น banner ถูกทิศ) ตาม `testing-bestpractices`
- ปิด backlog note ที่ค้างใน CR-059 (§4.5 Banner) บางส่วนของ 3 ไฟล์ที่แยกจาก CR-089 เดิม
- **CR อื่น:** ไม่แก้ข้อความของ CR-089 / CR-090 / CR-118 — amend 2026-09-14 เป็นการ sync ฝั่ง CR นี้ฝั่งเดียว

---

## Migration

N/A — ไม่แตะ `schema_v` ของ `stock_transfer` เลย (หน้าใหม่อ่านข้อมูลที่มีอยู่แล้ว ไม่เปลี่ยนรูปร่าง doc)

---

## Decision log

- 2026-08-25 — proposed — spun out จาก CR-089 (เดิมรวมกันเป็น CR เดียวครอบคลุม 5 กลุ่ม) หลัง project
  owner ถามเหตุผลที่ไม่แยก CR — เหตุผลทางเทคนิคคือกลุ่มนี้ไม่แตะ `schema_v` ของ `stock_transfer` เลย
  ต่างจาก lot/driver-plate/dispute (CR-089) ที่ต้องเคาะ `schema_v` 2 → 3 ร่วมกันเป็นก้อนเดียว — แยกออกมา
  เพื่อให้ approve/ship ได้อิสระ ไม่ต้องรอ CR-089 หรือ CR-090
- 2026-08-25 — เลือก tier "หน้ารายละเอียดแยก route ใหม่" โดย project owner (ต่างจากตัวเลือกที่เสนอแนะ
  เดิมคือ modal ต่อแถว ซึ่งใช้ effort น้อยกว่า) — project owner เลือกให้ตรงตามตัวอักษรสเปก "หน้ารายละเอียด
  Ticket" ของ CR-059 §4.5
- 2026-09-01 — **project owner เคาะ `approved`** — tier "หน้ารายละเอียดแยก route ใหม่" ตามข้อเสนอ
  2026-08-25 ไม่มีการแก้ scope
- 2026-09-02 — แก้ข้อความ `proposed` ที่ค้างใน TL;DR และ Decision log ให้ตรงกับ `frontmatter` ซึ่งเป็น
  ตัวจริง (สถานะไม่เปลี่ยน — แก้ถ้อยคำที่ไม่เปลี่ยนความหมายของกฎ เข้าข้อยกเว้น
  `docs/change-management.md` §2 จึงไม่ต้องเปิด CR ใหม่)
- 2026-09-14 — **amend: sync กับ CR ที่เคาะหลังวันที่ CR นี้ approve** (tracking = amend + Decision log
  ตามที่ project owner เคาะ 2026-09-14) — เทียบไฟล์นี้กับ CR-089 (`done`), CR-090 (`approved`, PR #259)
  และ CR-118 (`approved` 2026-09-06) แล้วพบข้อความค้าง 4 จุด:
  1. **FR-03** — "ไม่มี `lot`/`source_lot`" ถูก **CR-118 FR-23** supersede ⇒ เพิ่ม `source_lot` /
     `dest_lots` แบบ progressive · เพิ่มกฎแสดงบรรทัด `item_id` ซ้ำแยกกัน ตาม **CR-118 FR-02/FR-04**
     (ของเดิมสมมติ 1 `item_id` = 1 บรรทัด)
  2. **FR-04** — ขาด step `disputed` ที่ **CR-089 FR-11** (amend 2026-09-02) เพิ่มไว้ให้หน้านี้โดยตรง ⇒
     เพิ่ม step + ลำดับการแสดง + ระบุว่า `cancelled` ไม่มี timeline entry
  3. **FR-05** — รายการปุ่มเดิมมี "delete" ซึ่ง **CR-090 FR-01** (amend 2026-09-09) ถอนออกแล้ว ⇒ ตัดออก ·
     **CR-090 FR-06** ชี้ว่าการเปิดคำร้อง `cancelled` กลับมาใหม่ "น่าจะอยู่ที่ CR-091" แต่ FR-05 ของ CR นี้
     ไม่ให้มี action บนหน้ารายละเอียด ⇒ ระบุชัดว่าไม่อยู่ใน CR นี้ ต้องมี requirement ของตัวเอง
  4. **FR-07 (ใหม่)** — banner แสดงเหตุผลตาม **CR-090 FR-10** (อ่านจาก `status`) · CR-089 FR-11 §เหตุผล
     อ้างถึงการที่หน้ารายละเอียดเห็น `dispute_reason` อยู่แล้ว
  · ไม่เปลี่ยน `schema_v`, enum, state machine, role หรือ route · ไม่เพิ่ม action · ไม่แก้ข้อความของ
    CR-089 / CR-090 / CR-118 · **status คง `approved`** (ยังไม่เริ่มโค้ด)
- 2026-09-14 — **เคาะ 3 ข้อที่เปิดไว้จากการเทียบรอบเดียวกัน** (tracking = amend + Decision log ตามที่
  project owner เคาะ 2026-09-14 · อยู่ในการ amend เดียวกับ entry ด้านบน):
  1. **ป้ายฝั่งกรณีที่ 3 (FR-02)** — `isOutgoing()` เดิมคืนค่า 2 แบบ ⇒ `system_admin` ที่เปิดคำร้องระหว่าง
     ศูนย์อื่นสองศูนย์จะได้ป้าย "ปลายทาง" ผิด ซึ่งขัดกับ CR-059 §4.5 ("ระบุชัดเจนว่าศูนย์ปัจจุบันทำหน้าที่
     เป็นฝั่งใด") ⇒ เพิ่มป้าย "ไม่ใช่ศูนย์ของคำร้องนี้" · **ทางเลือกที่ไม่เลือก:** ไม่แสดงป้ายเลยในกรณีนี้ —
     ผู้ดูต้องอนุมานเองจากรหัสศูนย์
  2. **403 แสดงเหมือน 404 (DoD ข้อสุดท้าย)** — ไม่เปิดเผยการมีอยู่ของคำร้องต่อศูนย์ที่ไม่เกี่ยวข้อง และตัด
     การ retry ที่ไม่มีทางสำเร็จ · server ไม่เปลี่ยน · **ทางเลือกที่ไม่เลือก:** แยกข้อความ 403/404 — บอกผู้ใช้
     ได้ละเอียดกว่าแต่ยืนยันว่ามี `_id` นั้นอยู่จริง · ข้อแลกเปลี่ยนที่ยอมรับ: URL ผิดกับไม่มีสิทธิ์เห็นข้อความ
     เดียวกัน (ตรวจแยกได้จาก status code ใน network)
  3. **ส่วนแสดงล็อตเมื่อ CR นี้กับโค้ด CR-118 land ไม่พร้อมกัน** — **PR ที่ land ทีหลังเป็นผู้เพิ่มส่วน
     แสดง `source_lot` / `dest_lots`** · ถ้า CR นี้ land ก่อน ห้ามเพิ่ม type `line_id` / `source_lot` /
     `dest_lots` ล่วงหน้า (เป็น field ของ `schema_v` 4 ตาม CR-118) — FR-03 ยังเป็น requirement ของหน้านี้
     ตามเดิม เปลี่ยนเฉพาะการแบ่งงานระหว่าง PR · **ทางเลือกที่ไม่เลือก:** รอโค้ด CR-118 merge ก่อนเริ่ม CR นี้ —
     ทำให้ CR-059 §4.5 ค้างโดยไม่จำเป็น
