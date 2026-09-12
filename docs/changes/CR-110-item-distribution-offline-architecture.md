---
id: CR-110
title: ตัดสินใจสถาปัตยกรรม Offline ของ Flow 2 (Item Distribution / Active Batch) — เลือก Option A: Online-only Remote-First
status: approved
date: 2026-09-02
updated: 2026-09-06
requested_by: ทีมพัฒนา (พบ blocker ระหว่างจะแก้ docs/data/schema.md ตาม CR-059 Flow 2)
decided_by: Project Owner
layer: stable
affects:
  - docs/data/schema.md §4.1-4.5, §5.1-5.4
  - CLAUDE.md "Remote-first data & auth — do not bypass"
  - docs/changes/CR-059-inventory-requisition-inter-shelter-transfer.md (Flow 2 / ข้อ 5.2)
  - frontend/src/lib/features/item-distribution/
---

# CR-110 — ตัดสินใจสถาปัตยกรรม Offline ของ Flow 2 (Item Distribution / Active Batch)

> **สรุป (TL;DR):** ตัดสินใจสถาปัตยกรรม Offline ของการสแกนแจกสิ่งของหน้างาน (CR-059 Flow 2) ให้สอดคล้องกับข้อกำหนด Remote-first ใน `CLAUDE.md` · **Project Owner มีมติอนุมัติเลือก Option A (Online-only Remote-First)** โดยไม่มีการใช้ Local database/PouchDB หรือ Local Write Queue บนอุปกรณ์แท็บเล็ตหน้างาน เขียนตรงผ่าน `/couch` proxy และใช้ Disconnected Banner + Retry เมื่อเครือข่ายขัดข้อง · ปลดบล็อกการออกแบบ Schema ใน `docs/data/schema.md` §4.1–4.5 และ §5.1–5.4

## Why

CR-059 (approved) ข้อ 5.2 กำหนด requirement ของ Flow 2 ไว้ว่า:

> **ขั้นที่ 2 — แจกจ่ายหน้างาน (On-site Distribution):** แท็บเล็ตหน้างานเลือกชุดแจกจ่าย แล้วสแกนแจกจ่าย
> ผู้พักพิงโดยหักยอดจาก Active Batch (ไม่แตะคลังหลักอีก, **รองรับการทำงาน Offline**)

แต่ Decision Log ของ CR-059 เอง (2026-08-22) ระบุไว้ชัดเจนว่า requirement นี้ approve แค่ระดับ business/requirement เท่านั้น โดยต้องมี Architecture Decision แยกต่างหากก่อนเริ่ม implement Flow 2 เพราะอาจขัดกับหลัก Remote-first ใน `CLAUDE.md`

`CLAUDE.md` ("Remote-first data & auth — do not bypass") กำหนดเป็น Stable Core ไว้ว่า:

> "There is **no PouchDB** and **no local database** on the device ... **Writes go to the active
> endpoint directly** (no local write queue, no PouchDB) ... If the network is down, the app shows
> a disconnected banner — it does **not** fall back to reading cached data offline."

เพื่อป้องกันไม่ให้เกิดความขัดแย้งเชิงสถาปัตยกรรมและไม่ให้ทีมพัฒนาออกแบบ Schema ที่ assume ว่ามี Offline Queue ไปผิดทิศทาง จึงได้นำเสนอทางเลือกและขอมติจาก Project Owner ผ่าน Change Record ฉบับนี้

## มติสถาปัตยกรรม (Project Owner Decision: Option A)

เมื่อวันที่ 2026-09-06 Project Owner ได้พิจารณาและมีมติเลือก **Option A — Online-only Remote-First**:

1. **ไม่มี Local DB / PouchDB และไม่มี Local Write Queue บนอุปกรณ์หน้างาน:**
   - การสแกนแจกจ่ายสิ่งของหน้างานทุกครั้ง จะเป็นการส่งคำสั่ง Write ตรงเข้า CouchDB ผ่าน Active Endpoint (`/couch` proxy)
   - ไม่มีการเก็บคิวข้อมูลใน LocalStorage, IndexedDB หรือ PouchDB บนเบราว์เซอร์
2. **การรับมือเมื่อเครือข่ายขัดข้อง (Fault Tolerance):**
   - หากเครือข่ายหลุดหรือขัดข้องระหว่างการสแกน แอปพลิเคชันจะแสดงผล **Disconnected Banner** พร้อมปุ่ม **Retry** เพื่อส่งข้อมูลใหม่ตามมาตรฐานที่ `CLAUDE.md` วางไว้
3. **ผลกระทบต่อแผนพัฒนา (0 Sprint Overhead):**
   - มตินี้ทำให้ไม่ต้องแก้ไข Stable Core ใน `CLAUDE.md` และไม่ต้องเสียเวลา 1–2 Sprints ในการพัฒนาระบบ Sync / Conflict Resolution สำหรับ Local Database
   - ทีมพัฒนาสามารถออกแบบ Schema ใน `docs/data/schema.md` §4 และ §5 ตามแนวทาง Remote-First ปกติได้ทันที

## Requirements

- **FR-ID-01 (Architecture Standard):** สถาปัตยกรรมของ Flow 2 (Item Distribution) ต้องยึดถือแนวทาง Online-only Remote-First ตาม Option A โดยไม่สร้าง Local Write Queue บนอุปกรณ์
- **FR-ID-02 (Direct Persistence):** ทุกการบันทึกสแกนแจกจ่ายสิ่งของช่วยเหลือหน้างาน ต้องส่งตรงเข้า CouchDB ผ่าน `/couch` proxy
- **FR-ID-03 (UI Fault Handling):** เมื่อเครือข่ายขาดการเชื่อมต่อ หน้าจอต้องแสดงสถานะ Disconnected และเตรียมปุ่ม Retry ให้เจ้าหน้าที่ส่งคำขอซ้ำเมื่อสัญญาณกลับมา

## Impact

- ปลดบล็อกการเขียน Schema ใน `docs/data/schema.md` §4.1–4.5 และ §5.1–5.4
- ส่งผลให้ PR #228 ต้องปรับแก้โค้ดให้สอดคล้องกับ Option A โดยตัดความซับซ้อนของ Local Queue หรือกลไกที่ขัดกับ Remote-First ออก

## Decision log
- 2026-09-02 — proposed
- 2026-09-06 — approved Option A by Project Owner (รันรหัส CR-110, สั่งปรับปรุงสถาปัตยกรรมใน PR #228)
