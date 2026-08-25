---
id: CR-086
title: T-13 โอนย้ายข้ามศูนย์ — หน้ารายละเอียด Ticket (Banner + Timeline)
status: proposed
date: 2026-08-25
requested_by: CR-059 follow-up (§4.5 UI Safety Standards, Task #13) — spun out จาก CR-084 (2026-08-25, ไม่แตะ schema_v)
decided_by: Project Owner
layer: volatile
affects:
  - frontend/src/routes/(protected)/back-office/supply/transfer/[id]/+page.svelte (ใหม่)
  - frontend/src/routes/(protected)/back-office/supply/transfer/[id]/+page.ts (ใหม่)
  - frontend/src/lib/features/operations/ui/transfer-list.svelte (เพิ่มลิงก์ "ดูรายละเอียด")
  - frontend/src/lib/features/operations/index.ts (barrel export component ใหม่ถ้าจำเป็น)
  - CR-084, CR-085 (สืบเนื่องจากการแยก CR — ไม่ต้องรอทั้งสองอัน approve ก่อน, เป็นอิสระจากกัน)
---

# CR-086 — T-13 โอนย้ายข้ามศูนย์: หน้ารายละเอียด Ticket

> Spun out จาก [CR-084](CR-084-t13-transfer-lot-driver-dispute.md) เมื่อ 2026-08-25 — เดิมรวมอยู่ใน CR
> เดียวกับ lot/driver-plate/dispute แต่หน้ารายละเอียดเป็น UI ล้วน ไม่เปลี่ยน shape ของ `stock_transfer`
> doc เลย จึงไม่มีเหตุผลทางเทคนิคให้ต้องรอ approve พร้อมกับ CR-084 ที่ต้องเคาะ `schema_v` ร่วมกัน —
> approve/ship อิสระจาก CR-084/CR-085 ได้ทั้งหมด (แสดง field จาก CR-084/CR-085 แบบ progressive — field
> ไหนยังไม่มีเพราะ CR นั้นยังไม่ landed ก็แสดงว่างไป ไม่ throw)

## สรุป (TL;DR)

เพิ่มหน้ารายละเอียด Ticket แยกต่างหาก (`/back-office/supply/transfer/[id]`) แสดง banner เส้นทางเต็มรูป
แบบ + timeline การดำเนินการ ตาม CR-059 §4.5 · **ไม่กระทบ `schema_v`** ของ `stock_transfer` เลย (อ่าน field
ที่มีอยู่แล้วเท่านั้น) · เพิ่ม route ใหม่ 1 หน้า + ลิงก์จากตาราง list เดิม · **status ยังเป็น `proposed`**

---

## Requirements

- **FR-01** — เพิ่ม route ใหม่ `src/routes/(protected)/back-office/supply/transfer/[id]/+page.svelte` —
  guard เดียวกับหน้า supply เดิม (`requireAuth` + warehouse role gate ผ่าน `+page.ts`)
- **FR-02** — หน้ารายละเอียดแสดง banner เส้นทางเต็ม: `from_shelter → to_shelter` พร้อมป้ายระบุชัดว่าศูนย์
  ที่ล็อกอินอยู่เป็นต้นทางหรือปลายทางของคำสั่งนี้ (logic เดียวกับ `isOutgoing()` ที่มีอยู่แล้วใน
  `transfer-list.svelte` — เอามาใช้ซ้ำ ไม่เขียนใหม่)
- **FR-03** — แสดงรายการ item ทั้งหมดของคำร้อง พร้อม field ที่มีอยู่แล้ว ณ วันที่หน้านี้ ship (`lot`,
  `source_lot`, `driver_name`, `vehicle_plate` — field ไหนยังไม่มีในโค้ดเพราะ CR-084 ยังไม่ landed ให้
  ข้ามการแสดงผลเงียบๆ ไม่ throw หรือขึ้น error)
- **FR-04** — แสดง `timeline` เต็ม (`requested`/`shipped`/`received` — `at` + `by`) เป็น step list
  แนวตั้ง — เฉพาะ step ที่มีจริงในข้อมูล (ยังไม่ถึง `shipped` ก็ไม่ต้องมี step นั้นให้เห็น)
- **FR-05** — ตาราง `transfer-list.svelte` เพิ่มลิงก์ "ดูรายละเอียด" ต่อแถว ไปหน้าใหม่นี้ — ปุ่ม action
  เดิม (dispatch/receive/cancel/dispute/resume/delete — เท่าที่ CR ที่เกี่ยวข้อง landed ไปแล้ว ณ ตอนนั้น)
  **ยังอยู่ที่ตาราง list เหมือนเดิม ไม่ย้าย** ในรอบนี้ — การยุบปุ่มเข้าหน้ารายละเอียดเพื่อลดความแน่นของแถว
  เป็น follow-up ที่ทำได้ทีหลังเมื่อทุก CR ที่เกี่ยวข้อง (CR-084, CR-085) landed ครบแล้ว ไม่ใช่ scope ของ
  CR นี้
- **FR-06** — badge เส้นทางที่มีอยู่แล้วในตาราง list (`{from}→{to}` + tag ต้นทาง/ปลายทาง) คงไว้เหมือนเดิม
  ไม่ลบ — หน้ารายละเอียดเป็นของเพิ่มเติม ไม่ใช่ของทดแทน

---

## Acceptance (DoD)

- [ ] คลิก "ดูรายละเอียด" จากแถวใดก็ได้ในตาราง list ไปหน้ารายละเอียดของคำร้องนั้นถูกต้อง (FR-01, FR-05)
- [ ] Banner แสดงเส้นทางถูกทิศ + ป้ายต้นทาง/ปลายทางตรงกับศูนย์ที่ล็อกอินอยู่ (FR-02)
- [ ] Timeline แสดงเฉพาะ step ที่เกิดขึ้นจริง ไม่แสดง step ที่ยังไม่ถึง (FR-04)
- [ ] เปิดหน้ารายละเอียดของคำร้องที่สร้างก่อน CR-084/CR-085 landed (ไม่มี `lot`/`driver_name` ฯลฯ) ไม่ error
      — แสดงส่วนที่ไม่มีข้อมูลว่างไปเฉยๆ (FR-03)
- [ ] ผู้ใช้ศูนย์อื่นที่ไม่เกี่ยวกับคำร้องนี้ (ไม่ใช่ทั้ง `from_shelter`/`to_shelter`) เข้าหน้านี้ตรงไม่ได้
      (guard เดียวกับที่ list ใช้กรอง cross-shelter อยู่แล้ว)

---

## Why

- CR-059 §4.5 กำหนด "Banner แสดงเส้นทางส่งมอบ — หน้ารายละเอียด Ticket มี Banner แสดงเส้นทาง 'ต้นทาง →
  ปลายทาง' เต็มรูปแบบ พร้อมระบุชัดเจนว่าศูนย์ปัจจุบันทำหน้าที่เป็นฝั่งใดของคำสั่ง" — ตรวจโค้ดจริงพบว่ามีแค่
  คอลัมน์เส้นทางในตาราง list เท่านั้น ยังไม่มีหน้ารายละเอียดแยกเลย และ `timeline` ที่มีอยู่แล้วใน doc
  (`requested`/`shipped`/`received` at+by) ไม่เคยถูกแสดงในหน้าไหนเลย — เป็นของที่มีอยู่แล้วรอแค่ UI
- แยกออกจาก [CR-084](CR-084-t13-transfer-lot-driver-dispute.md) เพราะหน้านี้เป็น UI ล้วน ไม่เปลี่ยน
  shape ของ `stock_transfer` doc เลย ไม่มีเหตุผลทางเทคนิคให้ผูก schema_v เดียวกับ lot/driver-plate/dispute
  (project owner ถามหลัง CR-084 ฉบับแรกว่าทำไมไม่แยก)
- ออกแบบให้ field จาก CR-084/CR-085 เป็น progressive enhancement (แสดงถ้ามี, ข้ามถ้ายังไม่มี) เพื่อให้
  CR นี้ ship ได้โดยไม่ต้องเรียงลำดับก่อน-หลังกับอีกสอง CR

---

## Change (before → after)

| เรื่อง | ก่อน (โค้ดใน `71fd0b35`) | หลัง (CR นี้) |
| --- | --- | --- |
| Banner เส้นทางเต็ม | มีแค่คอลัมน์ในตาราง list | เพิ่มหน้า `/back-office/supply/transfer/[id]` แสดง banner เต็ม |
| Timeline | มีใน doc (`timeline{}`) แต่ไม่เคยแสดงที่ไหนเลย | แสดงเป็น step list ในหน้ารายละเอียด |

---

## Impact

- **UI (ใหม่):** route `frontend/src/routes/(protected)/back-office/supply/transfer/[id]/+page.svelte`
  + `+page.ts` (guard) — component รายละเอียด (banner + item list + timeline)
- **UI (แก้):** `frontend/src/lib/features/operations/ui/transfer-list.svelte` — เพิ่มลิงก์ "ดูรายละเอียด"
  ต่อแถว (FR-05)
- **Barrel:** `frontend/src/lib/features/operations/index.ts` — export component รายละเอียดใหม่ถ้าแยกเป็น
  ไฟล์ในฟีเจอร์ `operations/ui/` แทนที่จะเขียนอยู่ใน route ตรงๆ
- **Test:** unit test ของ component ใหม่ (ถ้ามี logic derive เช่น step list ordering) + e2e smoke
  (คลิกลิงก์ → เห็น banner ถูกทิศ) ตาม `testing-bestpractices`
- ปิด backlog note ที่ค้างใน CR-059 (§4.5 Banner) บางส่วนของ 3 ไฟล์ที่แยกจาก CR-084 เดิม

---

## Migration

N/A — ไม่แตะ `schema_v` ของ `stock_transfer` เลย (หน้าใหม่อ่านข้อมูลที่มีอยู่แล้ว ไม่เปลี่ยนรูปร่าง doc)

---

## Decision log

- 2026-08-25 — proposed — spun out จาก CR-084 (เดิมรวมกันเป็น CR เดียวครอบคลุม 5 กลุ่ม) หลัง project
  owner ถามเหตุผลที่ไม่แยก CR — เหตุผลทางเทคนิคคือกลุ่มนี้ไม่แตะ `schema_v` ของ `stock_transfer` เลย
  ต่างจาก lot/driver-plate/dispute (CR-084) ที่ต้องเคาะ `schema_v` 2 → 3 ร่วมกันเป็นก้อนเดียว — แยกออกมา
  เพื่อให้ approve/ship ได้อิสระ ไม่ต้องรอ CR-084 หรือ CR-085
- 2026-08-25 — เลือก tier "หน้ารายละเอียดแยก route ใหม่" โดย project owner (ต่างจากตัวเลือกที่เสนอแนะ
  เดิมคือ modal ต่อแถว ซึ่งใช้ effort น้อยกว่า) — project owner เลือกให้ตรงตามตัวอักษรสเปก "หน้ารายละเอียด
  Ticket" ของ CR-059 §4.5
- **ยังไม่ตัดสินใจ:** สถานะยังเป็น `proposed` — รอ project owner เคาะ `approved` ในไฟล์นี้ก่อนเริ่มโค้ด
