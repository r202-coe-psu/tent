---
id: draft
title: แยกคิวรับของบริจาคเป็นคิวมาส่งเองกับคิวรถศูนย์ไปรับ
status: proposed
date: 2026-09-24
requested_by: เจ้าของโครงการ (ทบทวน DN-5 ระหว่าง implement T-60)
decided_by: <รอเจ้าของโครงการ>
layer: stable + volatile   # `_id` pattern ของ donation_slot = stable core -> ต้อง review ก่อน
affects:
  - docs/data/schema.md §2.13 donation_slot — เพิ่ม field `mode`, `capacity` req -> opt/nullable, เปลี่ยน `_id` pattern
  - docs/data/schema.md §2.13 — สูตรนับที่ว่าง (สถานะที่ถือคิว) ให้ตรงกับ CR-052
  - docs/data/api-contract.md §public — endpoint ใหม่ `GET /api/public/v1/donations/slots`
  - docs/features/public-tier-donation-spec.html §DN ขั้น 3 — หน้าจอเลือกช่วงเวลาแยกตามวิธีจัดส่ง
  - docs/task-breakdown/04-donation.md T-60 DoD ขั้น 3 — เกณฑ์ slot
  - schema_v donation_slot 1 → ? (ดู §Migration — ยังไม่เคาะ)
  - frontend/src/lib/features/operations/domain/donation-slot.ts (+ test)
  - frontend/src/lib/features/operations/domain/operations.ts — type DonationSlot, DonationSlotMode
  - frontend/src/lib/features/operations/application/queries.ts — useDonationSlotSchedule, useSaveDonationSlot
  - frontend/src/lib/features/donations/domain/compute-slots.ts (+ test)
  - frontend/src/lib/features/donations/data/public-slots.ts
  - frontend/src/routes/api/public/v1/donations/slots/+server.ts (+ test)
  - frontend/src/routes/api/public/v1/donations/+server.ts — SLOT_FULL re-check
  - frontend/src/lib/components/form/donor-time-selection-form.svelte
  - frontend/src/routes/(protected)/back-office/stock-donations/components/donation-slots-manager.svelte
---

# แยกคิวรับของบริจาคเป็นคิวมาส่งเองกับคิวรถศูนย์ไปรับ

## สรุป (TL;DR)

`donation_slot` เดิมใช้ `capacity` ตัวเดียวคุมทั้งผู้บริจาคที่มาส่งเองและรถที่ศูนย์ส่งออกไปรับ ทั้งที่เป็นคนละ
ข้อจำกัด — เคาน์เตอร์รับใครมาก็ได้ แต่รถศูนย์มีจำกัดจริง. CR นี้เพิ่ม field `mode` (`dropoff` | `pickup`) แยก
เป็นสองคิว, ให้ `capacity` เป็น nullable (ไม่มีเพดาน), และกำหนดว่าคิวมาส่งเองเปิดช่วงมาตรฐานไว้เสมอ ส่วน
คิวรถมีเฉพาะรอบที่ศูนย์ประกาศ. Dev ต้องแก้ `schema.md §2.13`, `_id` pattern, และเพิ่ม endpoint อ่าน slot
ฝั่ง public. **กระทบ stable core (`_id` pattern) — ต้อง review ก่อน approve.**

## Why

1. **คนละข้อจำกัดถูกยัดใน field เดียว** — ศูนย์ที่ตั้ง "10 คิว" ในช่วง 09:00–10:00 กำลังประกาศพร้อมกันว่า
   รับผู้บริจาคที่ขับรถมาเองได้ 10 ราย **และ** ส่งรถออกไปรับได้ 10 เที่ยว ซึ่งไม่มีศูนย์ไหนเป็นแบบนั้น
2. **คิวมาส่งเองไม่ควรมีเพดานโดยปริยาย** — ผู้บริจาคนำของมาส่งช่วงไหนก็ได้ตามสะดวก การบังคับให้เลือก
   จากช่วงที่จำกัดจำนวนสร้างการปฏิเสธที่ไม่มีเหตุผลรองรับ ขณะที่รถศูนย์คือทรัพยากรที่หมดได้จริง
3. **spec กับ code เรื่องสถานะที่ถือคิวไม่ตรงกัน** — `schema.md §2.13` เขียนสูตรที่ว่างโดยนับเฉพาะ
   `{declared, received}` แต่ CR-052 เพิ่ม `pending_review`/`verifying` เข้ามาในเส้นทางจริง code จึงนับสี่
   สถานะมาตั้งแต่ต้น หากยึดตามตัวอักษรของ spec คิวที่เจ้าหน้าที่กดรับเรื่องแล้วจะหลุดจากการนับทันที
4. **DN-5 ไม่เคยมีหน้าจอ** — `CR-005:180` ระบุให้ศูนย์ตั้ง slot เองใน back-office แต่ไม่มี UI ทุกศูนย์จึง
   ตกไปใช้ช่วงเวลาที่ hardcode ไว้ในหน้า `/donate` ซึ่งปักสถานะ "คิวเต็ม" ตายตัวไว้หนึ่งช่วง

## Change

### C-1 `donation_slot` §2.13 — field และ `_id`

| รายการ | before | after |
| --- | --- | --- |
| `_id` | `donation_slot:{date}:{from}` | `donation_slot:{mode}:{date}:{from}` |
| `mode` | — | enum(`dropoff`,`pickup`) · **req** |
| `capacity` | int>0 · req | int>0 \| `null` · opt (default `null`) — `null` = ไม่มีเพดาน |
| `date` / `from` / `to` / `status` / `note` | คงเดิม | คงเดิม |

**Invariant ใหม่:** `mode = pickup` → `capacity` ต้องไม่เป็น `null`

### C-2 สูตรที่ว่าง (§2.13)

- before: ที่ว่าง = `capacity` − count(donation ที่ `logistics.slot` ตรงกัน และ `status` ∈ {`declared`,`received`})
- after: ที่ว่าง = `capacity` − count(donation ที่ `logistics.slot` ตรงกัน และ `status` ∈
  {`declared`,`pending_review`,`verifying`,`received`}) · `capacity = null` → ไม่มีวันเต็ม

### C-3 กติกากระดานฝั่ง public (§DN ขั้น 3)

| กรณี | dropoff | pickup |
| --- | --- | --- |
| ศูนย์ไม่ได้ตั้ง slot ของวันนั้น | แสดงช่วงมาตรฐาน 5 ช่วง ทุกช่วงว่าง ไม่มีเพดาน | ไม่แสดงช่วงใดเลย = วันนั้นศูนย์ไม่ออกไปรับ |
| ศูนย์ตั้ง slot บางช่วง | ช่วงมาตรฐานยังอยู่ครบ slot ที่ตั้งเป็น **override รายช่วง** (ปิดช่วง / ใส่เพดาน / เพิ่มช่วงนอกเวลามาตรฐาน) | แสดงเฉพาะรอบที่ประกาศ |
| ช่วงที่เต็มหรือ `closed` | แสดง "คิวเต็ม (งด)" + disable | เหมือนกัน |

ช่วงมาตรฐาน = 09:00–10:00, 10:00–11:00, 13:00–14:00, 14:00–15:00, 15:00–16:00 (ตาม
`public-tier-donation-spec.html:383`)

### C-4 การผูก `delivery_method` กับคิว

| `logistics.delivery_method` | คิวที่จอง |
| --- | --- |
| `self_dropoff` | `dropoff` |
| `shelter_pickup` | `pickup` |
| `parcel` | ไม่จองคิว (ไม่มี `logistics.slot`) |

`logistics.slot` ใน `donation` §2.3 **ไม่เปลี่ยนรูป** — โหมดอนุมานจาก `delivery_method` ไม่เก็บซ้ำ

### C-5 endpoint ใหม่ (api-contract.md)

`GET /api/public/v1/donations/slots?shelter_code={code}&date={YYYY-MM-DD}&mode={dropoff|pickup}`
— BFF อ่าน `donation_slot` จาก CouchDB ฝั่ง server (doc type นี้ไม่ถูก project ลง Mongo) คืนเฉพาะ
ช่วงเวลา/ความจุ/ยอดจอง ไม่มี PII

## Requirements

| id | requirement |
| --- | --- |
| FR-DS-1 | `donation_slot` ต้องมี field `mode` เป็น enum(`dropoff`,`pickup`) และ required |
| FR-DS-2 | `_id` ต้อง deterministic ตามรูป `donation_slot:{mode}:{date}:{from}` — สองอุปกรณ์ที่สร้างช่วงเดียวกันต้องได้ doc เดียว |
| FR-DS-3 | `capacity` รับค่า `null` ได้ = ไม่มีเพดาน; ถ้า `mode = pickup` ต้องเป็นจำนวนเต็ม > 0 เท่านั้น |
| FR-DS-4 | ระบบต้องนับคิวที่ถือครองจาก donation ที่ `status` ∈ {`declared`,`pending_review`,`verifying`,`received`} |
| FR-DS-5 | กระดาน dropoff ต้องแสดงช่วงมาตรฐานเสมอ และให้ slot ของศูนย์ override เฉพาะช่วงที่ `from` ตรงกัน |
| FR-DS-6 | กระดาน pickup ต้องแสดงเฉพาะรอบที่ศูนย์ประกาศ; ไม่มีรอบ = แสดงข้อความว่าวันนั้นไม่มีรถออกไปรับ |
| FR-DS-7 | `POST /public/v1/donations` ต้องคืน `SLOT_FULL` เฉพาะช่วงที่ `status = closed` หรือมีเพดานและจองเต็ม |
| FR-DS-8 | ต้องมีหน้าจอ back-office (DN-5) ให้เจ้าหน้าที่ตั้งช่วงเวลา จำนวนคิว/เที่ยว และปิด-เปิดรับ แยกตามคิว |
| FR-DS-9 | doc ที่ไม่มี field `mode` (เขียนก่อน CR นี้) ต้องถูกอ่านเป็น `dropoff` |
| FR-DS-10 | เมื่อมี doc มากกว่าหนึ่งใบที่ `from` เดียวกันในคิวเดียวกัน ให้ใบที่ระบุ `mode` ชัดเจนชนะ |

## Acceptance

- AC-DS-1 — สร้าง slot `dropoff` และ `pickup` ที่วัน+เวลาเดียวกันได้ เป็นคนละ doc และความจุไม่กระทบกัน
- AC-DS-2 — สร้าง `pickup` โดยไม่ใส่ `capacity` ถูกปฏิเสธพร้อมข้อความ; `dropoff` ไม่ใส่ได้
- AC-DS-3 — วันที่ไม่มี slot: `mode=dropoff` คืน 5 ช่วงว่าง, `mode=pickup` คืน list ว่าง
- AC-DS-4 — ตั้ง `dropoff` หนึ่งช่วงเป็น `closed` แล้วอีก 4 ช่วงมาตรฐานยังเปิดรับอยู่
- AC-DS-5 — ตั้ง `dropoff` ช่วง 18:00 ที่ไม่อยู่ในช่วงมาตรฐาน แล้วกระดานมี 6 ช่วง
- AC-DS-6 — จอง `pickup` จนครบ `capacity` แล้วช่องนั้น disable และ submit ซ้ำได้ `SLOT_FULL` 409
- AC-DS-7 — donation ที่ `status = pending_review` ยังถูกนับว่าถือคิวอยู่
- AC-DS-8 — เจ้าหน้าที่ศูนย์ (session ปกติ ไม่ใช่ `_admin`) เขียน `donation_slot` ผ่าน `validate_doc_update` ได้
- AC-DS-9 — response ของ `GET .../slots` ไม่มีข้อมูลผู้บริจาค

## Impact

**Doc**

- `docs/data/schema.md §2.13` — ตาราง field, `_id` pattern, สูตรที่ว่าง, index
- `docs/data/api-contract.md` — เพิ่มแถว endpoint ใหม่ (§C-5)
- `docs/features/public-tier-donation-spec.html` ขั้น 3 (บรรทัด ~382–389) — แยกสองคิว
- `docs/task-breakdown/04-donation.md:132` — DoD ขั้น 3 ของ T-60

**Code** — ดู `affects:` ใน frontmatter (implement แล้วบน branch `team-A-donation`: `461bce58`,
`d73bed26`, `a214c1f7`)

**ยังไม่ทำในรอบนี้ (out of scope)**

- view `slot_availability` + index `(date)` / `(date, from)` ตาม `schema.md:714` — ปัจจุบันคำนวณใน
  memory จาก `_all_docs` ทุก request
- seed ตัวอย่าง `donation_slot`
- `logistics.eta` ของ `self_dropoff` ที่ `schema.md:367` ระบุว่า = ต้นช่วงที่จอง แต่ยังไม่ถูก set (ของเดิม
  ก่อน CR นี้)

## Migration

**ข้อมูลที่ persist แล้ว:** ยังไม่มี `donation_slot` ใน production; dev/staging มี 0 ใบ ณ 2026-09-24
(ตรวจแล้วทั้ง 4 shelter db) — จึงไม่ต้อง backfill

**doc รูปเก่า (ถ้ามีหลงเหลือ):** `_id` รูป `donation_slot:{date}:{from}` และไม่มี `mode` → reader ถือเป็น
`dropoff` (FR-DS-9) ไม่ต้องเขียนใหม่ เมื่อเจ้าหน้าที่แก้ช่วงนั้นระบบจะสร้าง doc รูปใหม่และให้ใบใหม่ชนะ
(FR-DS-10) ใบเก่าค้างไว้ได้โดยไม่แสดงซ้ำ

> [NEEDS DECISION: `schema_v` ของ `donation_slot`]
> เพิ่ม field req (`mode`) + เปลี่ยนชนิด `capacity` เข้าเกณฑ์ bump ตาม change-management §4 แต่ยังไม่มี
> doc ที่ persist จริง จึงมีสองทาง:
> (ก) คง `schema_v 1` — ถือว่ารูปนี้คือรุ่นแรกที่ใช้งานจริง เขียน migration note ว่า pre-prod
> (ข) bump เป็น `schema_v 2` — ตามตัวอักษรของกติกา และได้ร่องรอยว่ารูปเคยเปลี่ยน
> ผู้ร่างเสนอ (ก) โดยเทียบเคียง §2.4 ที่ใช้ "pre-prod — wipe/re-seed" มาก่อน — **รอเจ้าของโครงการเคาะ**

## Decision log

- 2026-09-24 — proposed (ร่างจากการทบทวน DN-5 ระหว่าง implement T-60; `_id` pattern = stable core
  จึงยังไม่เสนอให้ approve ทันที)
