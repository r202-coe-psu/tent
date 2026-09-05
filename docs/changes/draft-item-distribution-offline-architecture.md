---
id: draft                  # draft (ตอน proposed) -> เปลี่ยนเป็น CR-NNN เมื่อเจ้าของโครงการ approve
title: ตัดสินใจสถาปัตยกรรม Offline ของ Flow 2 (Item Distribution / Active Batch) ก่อนเขียน schema
status: proposed
date: 2026-09-02
requested_by: ทีมพัฒนา (พบ blocker ระหว่างจะแก้ docs/data/schema.md ตาม CR-059 Flow 2)
decided_by: <รอ Project Owner>
layer: stable              # นี่คือ architecture/stable-core decision ไม่ใช่แค่ field ของ volatile spec
affects:
  - docs/data/schema.md (จะเขียน §4.1-4.5/§5.1-5.4 ตาม CR-059 ไม่ได้จนกว่าจะเคาะเรื่องนี้)
  - CLAUDE.md "Remote-first data & auth — do not bypass"
  - docs/changes/CR-059-inventory-requisition-inter-shelter-transfer.md (Flow 2 / ข้อ 5.2)
  - frontend/src/lib/features/item-distribution/
---

# ตัดสินใจสถาปัตยกรรม Offline ของ Flow 2 (Item Distribution / Active Batch) ก่อนเขียน schema

> **สรุป (TL;DR):** ตัดสินใจสถาปัตยกรรม Offline ของการสแกนแจกสิ่งของหน้างาน (CR-059 Flow 2) ให้สอดคล้องกับข้อกำหนด Remote-first (no local DB) ใน `CLAUDE.md` · เสนอ 3 ทางเลือก (แนะนำ Option A: Online-only remote-first) · เพื่อปลดบล็อกการเขียน Schema ใน `docs/data/schema.md` §4.1–4.5/§5.1–5.4

## Why

CR-059 (approved) ข้อ 5.2 กำหนด requirement ของ Flow 2 ไว้ว่า:

> **ขั้นที่ 2 — แจกจ่ายหน้างาน (On-site Distribution):** แท็บเล็ตหน้างานเลือกชุดแจกจ่าย แล้วสแกนแจกจ่าย
> ผู้พักพิงโดยหักยอดจาก Active Batch (ไม่แตะคลังหลักอีก, **รองรับการทำงาน Offline**)

แต่ Decision Log ของ CR-059 เอง (2026-08-22) บอกไว้ชัดว่า requirement นี้ approve แค่ระดับ
business/requirement เท่านั้น:

> "การ approve requirement ของ Flow 2 (offline on-site distribution) **ไม่ได้แปลว่าวิธีทำ offline
> ได้รับการตัดสินใจแล้ว** — ขัดกับหลัก remote-first/no-PouchDB ใน `CLAUDE.md` ... ต้องมี architecture
> decision แยกต่างหาก (แบบเดียวกับที่ทำให้ T-13 ข้างต้น) **ก่อนเริ่ม implement Flow 2**"

และ `CLAUDE.md` ("Remote-first data & auth — do not bypass") กำหนดเป็น stable core ไว้ตรงๆ ว่า:

> "There is **no PouchDB** and **no local database** on the device ... **Writes go to the active
> endpoint directly** (no local write queue, no PouchDB) ... If the network is down, the app shows
> a disconnected banner — it does **not** fall back to reading cached data offline."

สองข้อนี้ขัดกันตรงๆ: Flow 2 ต้องการ "สแกนแจกจ่ายหน้างานแบบ offline" แต่สถาปัตยกรรมที่ประกาศไว้ห้าม
local write queue เด็ดขาด ⇒ **ต้องเคาะทางออกก่อน** ไม่งั้นเขียน `docs/data/schema.md` ของ Active
Batch / distribution log ไปตาม field ที่ assume ว่ามี offline queue จะกลายเป็นออกแบบผิดตั้งแต่ต้น
(ต้อง reject/แก้ใหม่ทีหลังถ้า project owner เลือกทางอื่น)

**สถานะ mock UI ปัจจุบัน** (`frontend/src/lib/features/item-distribution/`) — ตรวจแล้วยัง**ไม่มี**
โค้ด offline/queue/localStorage/IndexedDB ใดๆ เลย เป็นแค่ store ในหน่วยความจำ (`$state`) ธรรมดา ⇒
ถ้าเลือก Option A ด้านล่าง ของที่มีอยู่แล้วไม่ต้องรื้อ

## Change (ตัวเลือกที่เสนอ — ให้ Project Owner เลือก)

**Option A — Online-only, ตีความ "Offline" ใหม่เป็น "ทนต่อเน็ตกระตุก" (Recommended)**
เหมือน precedent ของ `stock_transfer`/`referral` ที่ CR-059 เองเลือกไปแล้ว (T-13 cross-DB decision,
2026-08-22): ไม่มี local write queue ทุกการสแกนเขียนตรงเข้า CouchDB ผ่าน `/couch` proxy แบบ
remote-first ปกติ —
- ขั้นที่ 1 (Active Batch) เขียนตอนคลังอนุมัติ ต้องออนไลน์อยู่แล้ว (เหมือนการอนุมัติอื่นๆ ในระบบ)
- ขั้นที่ 2 (สแกนหน้างาน) แต่ละ scan = 1 write ตรง ไม่มี queue สะสมไว้ในเครื่อง — ถ้าเน็ตหลุดกลางสแกน
  ใช้ disconnected banner + retry ตาม pattern เดิมของทั้งระบบ (`CLAUDE.md`) ไม่ใช่ fallback อ่าน/เขียน
  แบบออฟไลน์จริง
- ข้อเสีย: ถ้าเน็ตหน้างานหลุดจริงจะแจกไม่ได้ตาม pain point เดิมที่ CR-059 §Why ข้อ 2 ระบุไว้
  ("หากอินเทอร์เน็ตหน้างานหลุด เจ้าหน้าที่จะไม่สามารถแจกสิ่งของให้ผู้พักพิงได้") — Option นี้ไม่แก้
  ปัญหานั้นจริง แค่ทำให้ scope ตรงกับ stable core ที่มีอยู่

**Option B — เปิดข้อยกเว้น stable core เฉพาะ feature นี้ (local queue จริง)**
เพิ่ม local persistence (เช่น IndexedDB) เฉพาะจุดสแกนหน้างาน เพื่อคิว write ไว้ตอนเน็ตหลุดแล้ว sync
ทีหลัง — แก้ pain point ตรงจุดแต่ **ขัดกับ "no PouchDB/no local database" ตรงๆ** ต้องเป็น
stable-core exception ที่ผ่าน review ระดับสูง (ตาม `docs/change-management.md` §1: stable core
"ต้อง CR + review ก่อนเสมอ") และตั้ง precedent ว่าฟีเจอร์อื่นขอข้อยกเว้นแบบนี้ได้ด้วยหรือไม่

**Option C — Edge CouchDB LAN fallback (ของที่มีอยู่แล้วในสถาปัตยกรรม)**
`CLAUDE.md` ระบุไว้แล้วว่ามี "Edge CouchDB on LAN — fallback only when WAN/central unreachable" —
ถ้าปัญหาจริงคือ "เน็ต **WAN** หลุดแต่ LAN หน้างานยังใช้ได้" (ไม่ใช่เน็ตหลุดทั้งหมด) Flow 2 อาจจะใช้
edge replica ที่มีอยู่แล้วได้เลยโดยไม่ต้องเปิด local queue ใหม่ — ต้องเช็คว่า pain point จริงของ
CR-059 §Why ตรงกับเคสนี้หรือเป็นกรณีเน็ตหลุดทั้ง WAN+LAN (ซึ่ง edge ก็ช่วยไม่ได้)

## Requirements

- **FR-ID-01 (Architecture Gate):** ต้องได้รับการอนุมัติตัวเลือกสถาปัตยกรรม (Option A/B/C) จาก Project Owner ก่อนเขียนรายละเอียด Schema ใน `docs/data/schema.md` §4.1–4.5 และ §5.1–5.4
- **FR-ID-02 (Remote-First Persistence):** หากเลือก Option A ทุกการสแกนแจกจ่ายสิ่งของต้องส่งตรงเข้า CouchDB Proxy (`/couch`) โดยไม่มี Local Write Queue / PouchDB บนอุปกรณ์
- **FR-ID-03 (UI Fault Handling):** หากเครือข่ายขัดข้องระหว่างการสแกน แอปพลิเคชันต้องแสดง Disconnected Banner + Retry Mechanism ตาม pattern มาตรฐานของระบบ (`CLAUDE.md`)

## Impact

- ปลดบล็อกการเขียน `docs/data/schema.md` §4.1-4.5/§5.1-5.4 (CR-059 Flow 2 — Active Batch,
  distribution log, NFI one-time control) ที่ค้างอยู่เพราะรอ decision นี้
- **ถ้าเลือก Option A (Recommended):** ไม่ต้องแก้ `CLAUDE.md`, schema ออกแบบ remote-first ปกติทันที,
  โค้ด UI ใน `frontend/src/lib/features/item-distribution/` พัฒนาต่อบน API ได้เลย **ระยะเวลาพัฒนาเร็วที่สุด (0 sprint overhead)**
- **ถ้าเลือก Option B:** ต้องแก้ `CLAUDE.md` เพิ่ม exception clause + ผ่าน review stable-core ก่อน
  และต้องเพิ่มเวลาพัฒนาอีกอย่างน้อย 1-2 sprint เพื่อทำ IndexedDB local queue, sync engine, และ conflict resolution
- **ถ้าเลือก Option C:** ไม่ต้องแก้ `CLAUDE.md`, แต่ต้องทดสอบ edge replication topology ร่วมกับทีม Infra

## Migration

N/A — เป็น architecture decision ล้วนๆ ยังไม่มี persisted doc ของ Flow 2 อยู่จริง

## Decision log
- 2026-09-02 — proposed
