---
id: draft
title: แยกคิวรับของบริจาคเป็นคิวมาส่งเองกับคิวรถศูนย์ไปรับ
status: proposed
date: 2026-09-24
updated: 2026-10-05
requested_by: เจ้าของโครงการ (ทบทวน DN-5 ระหว่าง implement T-60)
decided_by: <รอเจ้าของโครงการ>
layer: stable + volatile   # `_id` pattern ของ donation_slot = stable core -> ต้อง review ก่อน
affects:
  - docs/data/schema.md §2.13 donation_slot — เพิ่ม field `mode`, `capacity` req -> opt/nullable, เปลี่ยน `_id` pattern
  - docs/data/schema.md §2.13 — สูตรนับที่ว่าง (สถานะที่ถือคิว) ให้ตรงกับ CR-052
  - docs/data/api-contract.md §public — endpoint ใหม่ `GET /api/public/v1/donations/slots`
  - docs/data/api-contract.md §public — error code ของ slot ใน `POST /public/v1/donations` (`SLOT_REQUIRED`, `SLOT_UNAVAILABLE`, `SLOT_FULL`, `SLOTS_UNAVAILABLE`)
  - Mongo collection ใหม่ `donation_slot_counters` (schema_v 1) — atomic `SLOT_FULL` (§C-6)
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
  - packages/tent-model/src/tent_model/donation_slot_counter.py, donation_slot_counter_ops.py, donation_buffer.py (`slot_counter_id`)
  - backend/apiapp/modules/donations/schemas.py (`slot_hold`), use_case.py (+ backend/tests/test_donations.py)
  - worker/src/worker/quota/settle.py, worker/src/worker/retention/job.py (+ test)
---

# แยกคิวรับของบริจาคเป็นคิวมาส่งเองกับคิวรถศูนย์ไปรับ

## สรุป (TL;DR)

`donation_slot` เดิมใช้ `capacity` ตัวเดียวคุมทั้งผู้บริจาคที่มาส่งเองและรถที่ศูนย์ส่งออกไปรับ ทั้งที่เป็นคนละ
ข้อจำกัด — เคาน์เตอร์รับใครมาก็ได้ แต่รถศูนย์มีจำกัดจริง. CR นี้เพิ่ม field `mode` (`dropoff` | `pickup`) แยก
เป็นสองคิว, ให้ `capacity` เป็น nullable (ไม่มีเพดาน), และกำหนดว่าคิวมาส่งเองเปิดช่วงมาตรฐานไว้เสมอ ส่วน
คิวรถมีเฉพาะรอบที่ศูนย์ประกาศ; `POST` ปฏิเสธช่วงที่ไม่มีอยู่จริงในแต่ละคิว และตัดสิน `SLOT_FULL` แบบ atomic
ผ่าน Mongo counter. Dev ต้องแก้ `schema.md §2.13`, `_id` pattern, เพิ่ม endpoint อ่าน slot ฝั่ง public และ
collection `donation_slot_counters`. **กระทบ stable core (`_id` pattern) — ต้อง review ก่อน approve.**

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
| `POST` ระบุช่วงที่ไม่อยู่ในกระดาน (ไม่ใช่ช่วงมาตรฐาน และไม่มี doc) | ปฏิเสธ | ปฏิเสธ |

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
ช่วงเวลา/ความจุ/ยอดจอง ไม่มี PII. ยอดจองบนกระดานนับจาก CouchDB (ใช้แสดงผล) — การตัดสิน `SLOT_FULL`
ตอน submit ใช้ counter ใน §C-6

### C-6 atomic `SLOT_FULL` — Mongo collection `donation_slot_counters`

ยอดจองใน CouchDB ตามหลังความจริง: booking เข้า CouchDB หลังผ่าน FastAPI → Mongo → sync worker แล้ว
สอง submit พร้อมกันจึงอ่านเห็นที่ว่างสุดท้ายเหมือนกันได้. ช่วงที่มีเพดานจึงจองผ่าน counter แบบเดียวกับ
`donation_need_counter` (CR-047)

| รายการ | ค่า |
| --- | --- |
| collection | `donation_slot_counters` (Mongo) · schema_v 1 |
| `_id` | `{shelter_code}:{mode}:{date}:{from}` — identity เดียวกับ `donation_slot` ต่อศูนย์ |
| field | `booked`:int≥0, `created_at`:ts, `updated_at`:ts |
| สร้างเมื่อ | booking แรกของช่วงที่ `capacity ≠ null`; ช่วงที่ไม่มีเพดานไม่มี counter |
| ค่าเริ่ม | `booked` = ยอดที่ BFF นับจาก CouchDB ใน request นั้น (ครอบ booking ก่อนมี counter) — seed ครั้งเดียว |
| เพดาน | `capacity` ที่ BFF อ่านจาก CouchDB ใน request นั้น (ส่งมาใน `slot_hold`) — ไม่เก็บใน counter |

ลำดับใน `POST /public/v1/donations`: BFF ตรวจ slot (§C-3, FR-DS-7, FR-DS-11..13) → ถ้ามีเพดาน ส่ง
`slot_hold {mode, date, from, capacity, booked}` ไป FastAPI → FastAPI `$inc` แบบมีเงื่อนไข
`booked < capacity`; ไม่ผ่าน = 409 `SLOT_FULL`

ปล่อยที่ (`booked − 1`, ไม่ต่ำกว่า 0) เมื่อ:

- เขียน booking ไม่สำเร็จหลังจองที่แล้ว (compensation ใน FastAPI)
- ผู้บริจาคยกเลิกผ่าน FastAPI
- worker settle: donation ออกจากสถานะที่ถือคิว {`declared`,`pending_review`,`verifying`,`received`}
- worker retention: donation ที่ยังค้าง (`declared`/`pending_review`/`verifying`) หมดอายุ

`donation_buffer` เก็บ `slot_counter_id` ไว้ให้ทุกจุดข้างบนปล่อยถูกช่อง

## Requirements

| id | requirement |
| --- | --- |
| FR-DS-1 | `donation_slot` ต้องมี field `mode` เป็น enum(`dropoff`,`pickup`) และ required |
| FR-DS-2 | `_id` ต้อง deterministic ตามรูป `donation_slot:{mode}:{date}:{from}` — สองอุปกรณ์ที่สร้างช่วงเดียวกันต้องได้ doc เดียว |
| FR-DS-3 | `capacity` รับค่า `null` ได้ = ไม่มีเพดาน; ถ้า `mode = pickup` ต้องเป็นจำนวนเต็ม > 0 เท่านั้น |
| FR-DS-4 | ระบบต้องนับคิวที่ถือครองจาก donation ที่ `status` ∈ {`declared`,`pending_review`,`verifying`,`received`} |
| FR-DS-5 | กระดาน dropoff ต้องแสดงช่วงมาตรฐานเสมอ และให้ slot ของศูนย์ override เฉพาะช่วงที่ `from` ตรงกัน |
| FR-DS-6 | กระดาน pickup ต้องแสดงเฉพาะรอบที่ศูนย์ประกาศ; ไม่มีรอบ = แสดงข้อความว่าวันนั้นไม่มีรถออกไปรับ |
| FR-DS-7 | `POST /public/v1/donations` ต้องคืน 409 `SLOT_FULL` เมื่อช่วงที่ระบุมี doc ที่ `status = closed` หรือมีเพดานและจองเต็ม |
| FR-DS-8 | ต้องมีหน้าจอ back-office (DN-5) ให้เจ้าหน้าที่ตั้งช่วงเวลา จำนวนคิว/เที่ยว และปิด-เปิดรับ แยกตามคิว |
| FR-DS-9 | doc ที่ไม่มี field `mode` (เขียนก่อน CR นี้) ต้องถูกอ่านเป็น `dropoff` |
| FR-DS-10 | เมื่อมี doc มากกว่าหนึ่งใบที่ `from` เดียวกันในคิวเดียวกัน ให้ใบที่ระบุ `mode` ชัดเจนชนะ |
| FR-DS-11 | `POST` ที่ `delivery_method = shelter_pickup` ต้องมี `logistics.slot` — ไม่มี = 422 `SLOT_REQUIRED`; มีแต่ไม่มี doc `pickup` ของช่วงนั้น = 409 `SLOT_UNAVAILABLE` |
| FR-DS-12 | `POST` ที่ `delivery_method = self_dropoff` และไม่มี doc ของช่วงนั้น ต้องมี `from`/`to` ตรงกับช่วงมาตรฐาน (§C-3) — ไม่ตรง = 409 `SLOT_UNAVAILABLE` |
| FR-DS-13 | อ่าน `donation_slot` ไม่สำเร็จ (ไม่ใช่ 200/404) ต้องปฏิเสธ 503 `SLOTS_UNAVAILABLE` — ห้ามรับ booking ที่ตรวจช่วงไม่ได้ |
| FR-DS-14 | ช่วงที่มีเพดานต้องตัดสิน `SLOT_FULL` ด้วย `$inc` แบบมีเงื่อนไขบน `donation_slot_counters` (§C-6) — สอง submit พร้อมกันที่เหลือที่เดียว ต้องผ่านได้ไม่เกินหนึ่ง |
| FR-DS-15 | ทุกเส้นทางที่ปล่อย quota ของ donation (compensation, ยกเลิก, settle, retention) ต้องปล่อยที่ใน counter ด้วย และ `booked` ต้องไม่ต่ำกว่า 0 |

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
- AC-DS-10 — `POST` แบบ `shelter_pickup` ไม่ส่ง `slot` ได้ 422 `SLOT_REQUIRED`; ส่งวัน/เวลาที่ศูนย์ไม่ได้ประกาศรอบได้ 409 `SLOT_UNAVAILABLE`
- AC-DS-11 — `POST` แบบ `self_dropoff` ช่วง 03:00–04:00 ในวันที่ไม่มี override ได้ 409 `SLOT_UNAVAILABLE`; ช่วง 09:00–10:00 ผ่าน
- AC-DS-12 — CouchDB ตอบ error ระหว่างตรวจ slot ได้ 503 `SLOTS_UNAVAILABLE` และไม่มี booking ถูกสร้าง
- AC-DS-13 — ช่วง `pickup` ที่ `capacity = 1` รับสอง submit พร้อมกัน: หนึ่งรายการผ่าน อีกรายการได้ 409 `SLOT_FULL`
- AC-DS-14 — ยกเลิก หรือปล่อยให้ booking หมดอายุ แล้ว `booked` ของช่วงนั้นลดลง 1 และจองใหม่ได้

## Impact

**Doc**

- `docs/data/schema.md §2.13` — ตาราง field, `_id` pattern, สูตรที่ว่าง, index
- `docs/data/schema.md §2.3` `logistics.slot` — "deterministic ต่อ วัน+เวลา" → ต่อ คิว+วัน+เวลา (คิวอนุมานจาก `delivery_method` ตาม §C-4)
- `docs/data/api-contract.md` — เพิ่มแถว endpoint ใหม่ (§C-5) + error code ของ slot (FR-DS-7, FR-DS-11..13)
- `docs/features/public-tier-donation-spec.html` ขั้น 3 (บรรทัด ~382–389) — แยกสองคิว
- `docs/task-breakdown/04-donation.md:132` — DoD ขั้น 3 ของ T-60

**Code** — ดู `affects:` ใน frontmatter (implement แล้วบน branch `team-A-donation`: `461bce58`,
`d73bed26`, `a214c1f7`, `63bdd522` (นับแยกคิว + FR-DS-11), `8a5c6450` (§C-6, FR-DS-14/15))

**ยังไม่ตรงกับ CR (ต้องแก้ code ก่อนปิด CR)**

- FR-DS-12 — `self_dropoff` ที่ไม่มี doc ยังผ่านทุกช่วงเวลา; BFF ไม่ได้เทียบกับช่วงมาตรฐาน
  (`frontend/src/routes/api/public/v1/donations/+server.ts` กรณี 404 ของ dropoff)
- FR-DS-10 — มีเฉพาะกระดานฝั่ง public (`compute-slots.ts`); back-office `slotsOnDate` ยังแสดงทั้งสองใบ
  (ดู §Migration)

**ยังไม่ทำในรอบนี้ (out of scope)**

- view `slot_availability` + index `(date)` / `(date, from)` ตาม `schema.md:714` — ปัจจุบัน
  `GET .../slots` และ `POST` อ่าน `donation:` ทั้งหมดของศูนย์ผ่าน `_all_docs` แล้วนับใน memory
  ทุก request (endpoint public ไม่ต้อง login)

> [NEEDS DECISION: ต้องมี view `slot_availability` หรือ cache/rate limit ของ `GET .../slots` ก่อน go-live หรือไม่]
- seed ตัวอย่าง `donation_slot`
- `logistics.eta` ของ `self_dropoff` ที่ `schema.md:367` ระบุว่า = ต้นช่วงที่จอง แต่ยังไม่ถูก set (ของเดิม
  ก่อน CR นี้)

## Migration

**ข้อมูลที่ persist แล้ว:** ยังไม่มี `donation_slot` ใน production; dev/staging มี 0 ใบ ณ 2026-09-24
(ตรวจแล้วทั้ง 4 shelter db) — จึงไม่ต้อง backfill

**doc รูปเก่า (ถ้ามีหลงเหลือ):** `_id` รูป `donation_slot:{date}:{from}` และไม่มี `mode` → reader ถือเป็น
`dropoff` (FR-DS-9) ไม่ต้องเขียนใหม่. FR-DS-9 เป็น safety net เท่านั้น ไม่ใช่เส้นทาง migrate:

| จุด | พฤติกรรมจริง |
| --- | --- |
| กระดาน public (`compute-slots.ts`) | ใบเก่าอ่านเป็น `dropoff`; ถ้ามีใบใหม่ `from` เดียวกัน ใบใหม่ชนะ (FR-DS-10) |
| `POST` re-check | หาใบใหม่ก่อน ไม่เจอจึงหาใบเก่า (`dropoff` เท่านั้น) |
| back-office `slotsOnDate` | ไม่ dedupe — ใบเก่ากับใบใหม่ `from` เดียวกันแสดงสองแถว |
| back-office แก้ไขใบเก่า | ผ่าน validation (`mode` default `dropoff`) แต่บันทึกทับ `_id` เดิม พร้อมเติม `mode: dropoff` — ไม่ได้สร้าง doc รูปใหม่ |

ไม่มีใบเก่าใน dev/staging/production (ตรวจ 2026-09-24) จึงไม่ทำ migration หรือ dedupe ฝั่ง back-office.
ถ้าเจอใบเก่าใน local dev ให้ลบทิ้ง หรือ reset ด้วย `docker compose -f docker-compose.yml -f docker-compose.seed.yml run --rm unseed`

**`donation_slot_counters`:** collection ใหม่ ไม่มีข้อมูลเดิม. booking ที่เกิดก่อนมี counter ถูกนับเข้า
`booked` ตอนสร้าง counter (§C-6 ค่าเริ่ม) — ข้อจำกัดที่ยอมรับ: booking ที่ยังอยู่ระหว่าง sync เข้า CouchDB
ตอนสร้าง counter ไม่ถูกนับ ทำให้ `booked` ต่ำกว่าความจริงชั่วคราวได้ (worker settle/retention ปล่อยที่ตามสถานะจริง)

> [NEEDS DECISION: `schema_v` ของ `donation_slot`]
> เพิ่ม field req (`mode`) + เปลี่ยนชนิด `capacity` เข้าเกณฑ์ bump ตาม change-management §4 แต่ยังไม่มี
> doc ที่ persist จริง จึงมีสองทาง:
> (ก) คง `schema_v 1` — ถือว่ารูปนี้คือรุ่นแรกที่ใช้งานจริง เขียน migration note ว่า pre-prod
> (ข) bump เป็น `schema_v 2` — ตามตัวอักษรของกติกา และได้ร่องรอยว่ารูปเคยเปลี่ยน
> ผู้ร่างเสนอ (ก) โดยเทียบเคียง §2.4 ที่ใช้ "pre-prod — wipe/re-seed" มาก่อน — **รอเจ้าของโครงการเคาะ**

## Decision log

- 2026-09-24 — proposed (ร่างจากการทบทวน DN-5 ระหว่าง implement T-60; `_id` pattern = stable core
  จึงยังไม่เสนอให้ approve ทันที)
- 2026-10-05 — แก้ตาม review PR #308: แยก FR-DS-7 เป็น FR-DS-7/11/12/13 ตาม error code ที่ BFF ใช้
  (ไม่รวมทุกกรณีเป็น `SLOT_FULL` เพราะ donor ต้องรู้ว่าช่วงเต็ม หรือช่วงไม่มีอยู่จริง); เพิ่ม §C-6
  + FR-DS-14/15 ให้ครอบ Mongo counter ที่ implement ใน `8a5c6450`; แก้ §Migration ให้ตรงกับพฤติกรรม
  back-office จริง; ระบุ FR-DS-12 กับ FR-DS-10 (back-office) ว่ายังไม่ตรง code
