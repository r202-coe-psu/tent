---
id: draft
title: "ติดตามสถานะบริจาคด้วยเบอร์โทรอย่างเดียว (รายการแบบอ่านอย่างเดียว ไม่คืน token)"
status: proposed
date: 2026-10-17
requested_by: "เจ้าของโครงการ — issue #618 (กรอกแค่เบอร์เพื่อดู donation queue) ตัดสินแนวทาง 2026-10-17"
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/changes/04-donation/CR-052-donation-system-design-v8.md §2.6 (ค้นด้วย Ref ID + เบอร์ / ส่งเบอร์ไปเติมหน้าติดตาม)
  - docs/features/public-tier-donation-spec.html — exposure ของหน้าติดตาม
  - docs/data/api-contract.md — endpoint ใหม่ + บันทึก track-search เดิมที่ยังไม่อยู่ในตาราง
  - docs/data/schema.md §2.3 — ความหมายของ `donor.phone_hash` (hash จากเบอร์ที่ normalize แล้ว)
  - packages/tent-model/src/tent_model/donation_buffer.py (`donor_phone_hash` + index)
  - backend/apiapp/modules/donations (endpoint ใหม่)
  - worker/src/worker/inbound/donations.py (hash จากเบอร์ที่ normalize แล้ว)
  - frontend/src/routes/api/public/v1/donations/ (BFF ใหม่) · lib/server/security/rate-limiter.ts
  - frontend/src/routes/(public)/donations/track/+page.svelte · lib/components/public-donor-success-ticket.svelte
why: ผู้บริจาคจำเลขจองไม่ได้ ต้องการดูสถานะด้วยเบอร์ที่ใช้จองเท่านั้น
migration: ไม่เปลี่ยนรูป CouchDB doc — ไม่ bump schema_v; Mongo buffer เพิ่ม field + index
---

# ติดตามสถานะบริจาคด้วยเบอร์โทรอย่างเดียว

## สรุป

- **เปลี่ยน:** หน้า `/donations/track` ค้นด้วยเบอร์โทรอย่างเดียวได้ ผลเป็นรายการแบบอ่านอย่างเดียว ไม่มี QR ไม่มี token ไม่มีสิทธิ์แก้/ยกเลิก
- **เพื่อ:** ผู้บริจาคที่จำเลขจองไม่ได้ดูสถานะได้ โดยไม่เปิดช่องให้คนที่รู้เบอร์แก้หรือยกเลิกการจองของคนอื่น
- **dev ต้อง build:** endpoint FastAPI + BFF (limiter + captcha) · `donor_phone_hash` ใน Mongo buffer · หน้าค้นหาแบบช่องเบอร์ช่องเดียว · เลิกใส่เบอร์ใน URL
- **กระทบ:** CR-052 §2.6 · ไม่เปลี่ยนรูป CouchDB doc (ไม่ bump `schema_v`) · ไม่แตะ projection `public_donations`

## Requirements

### ค้นหาด้วยเบอร์
- **FR-1** — endpoint ใหม่ `POST /public/v1/donations/track-by-phone` (service secret) รับ `{phone}` ตอบ `{items: [...]}`
- **FR-2** — ค้นจาก `DonationBuffer` เท่านั้น (ย้อนหลังเท่าที่ buffer เก็บ ≈ 72 ชม. ตาม `donation_reservation_ttl_hours`)
- **FR-3** — จับคู่ด้วย `donor_phone_hash` = SHA-256 ของเบอร์ที่ผ่าน `normalize_phone` แล้ว (เบอร์ `08x-xxx-xxxx`, `08xxxxxxxx`, `+668xxxxxxxx` ต้องได้ hash เดียวกัน)
- **FR-4** — เรียงใหม่ไปเก่า ไม่เกิน 10 รายการ
- **FR-5** — แต่ละรายการมีเฉพาะ: `booking_ref` แบบ mask บางส่วน (เช่น `DN-98••39`), `status`, ชื่อศูนย์, วันและช่วงเวลานัด, จำนวนรายการ
- **FR-6** — response **ห้าม**มี `tracking_token`, QR, ชื่อผู้บริจาค, เบอร์, `phone_hash`, ชื่อของที่บริจาค
- **FR-7** — ไม่เจอให้ตอบ 200 `{items: []}` รูปเดียวกับตอนเจอ ห้ามตอบ 404 หรือข้อความที่บอกว่าเบอร์นี้ไม่มีในระบบ

### BFF และการป้องกัน
- **FR-8** — BFF `POST /api/public/v1/donations/track-by-phone` ผ่าน reCAPTCHA gate (`verifyRecaptchaOrSkip`)
- **FR-9** — limiter ใหม่แยกจากการจอง: ต่อ IP 5 ครั้ง/นาที และต่อเบอร์ 10 ครั้ง/ชั่วโมง (ห้ามใช้ `donationIpLimiter` ร่วม)
- **FR-10** — BFF validate เบอร์ด้วยรูปแบบเดียวกับฟอร์มจอง (`^0\d{9}$` หลัง normalize)

### หน้าติดตาม
- **FR-11** — หน้า `/donations/track` มีช่องเบอร์ช่องเดียวเป็นค่าเริ่มต้น ช่องเลขจองอยู่ใต้ลิงก์ "มีเลขจอง? ดูตั๋วเต็ม" (ค้นแบบเลขจอง + เบอร์เดิมยังใช้ได้)
- **FR-12** — ผลเป็นการ์ดตาม FR-5 แต่ละการ์ดมีปุ่ม "ดูตั๋วเต็ม" ที่ขอให้กรอกเลขจองก่อน
- **FR-13** — ส่งฟอร์มด้วย POST เท่านั้น เลิก auto-submit จาก `?ref&phone`; ลิงก์เก่าที่มี query ให้อ่านครั้งเดียวแล้ว `replaceState` ลบ query ทิ้ง
- **FR-14** — ตั๋วหลังจอง (`public-donor-success-ticket.svelte`) ลิงก์ไปหน้าติดตามด้วย tracking token แทน `?ref&phone`

### ความสอดคล้องของ `phone_hash`
- **FR-15** — worker inbound เขียน `donor.phone_hash` บน CouchDB จากเบอร์ที่ normalize แล้ว (ตอนนี้ hash จากเบอร์ดิบ — `worker/src/worker/inbound/donations.py:64`) ให้ตรงกับ backend (`backend/apiapp/utils/masking.py`)

## Change (before → after)

| เรื่อง | ก่อน (CR-052 §2.6) | หลัง |
| --- | --- | --- |
| วิธีค้น | Ref ID + เบอร์ (exact match) | เบอร์อย่างเดียว → รายการอ่านอย่างเดียว · Ref ID + เบอร์ยังเปิดตั๋วเต็มได้ |
| ผลการค้น | ตั๋วเต็ม (token, QR, แก้/ยกเลิกได้) | ค้นด้วยเบอร์: ข้อมูลขั้นต่ำตาม FR-5 ไม่มี token |
| เบอร์ใน URL | ตั๋วส่ง `?ref&phone` ไปหน้าติดตาม (เบอร์อยู่ใน history) | ลิงก์ด้วย token · ไม่มีเบอร์ใน URL |
| limiter | ใช้ `donationIpLimiter` ร่วมกับการจอง (3/นาที) | limiter แยกต่อ IP + ต่อเบอร์ |
| `donor.phone_hash` บน CouchDB | hash จากเบอร์ดิบ (worker) | hash จากเบอร์ที่ normalize แล้ว |

## Acceptance

- **AC-1** — เบอร์เดียวจอง 2 ใบ → ค้นด้วยเบอร์ได้ 2 การ์ด เรียงใหม่ไปเก่า ไม่มี QR ไม่มีชื่อผู้บริจาค
- **AC-2** — เบอร์ที่ไม่มีในระบบ → หน้าตาเหมือนตอนไม่มีรายการ ไม่มีข้อความ "ไม่พบเบอร์นี้"
- **AC-3** — กรอกเบอร์รูปแบบต่างกัน (`081-234-5678` / `0812345678`) → ผลเหมือนกัน
- **AC-4** — ค้นเกิน limiter → 429 · captcha ไม่ผ่าน → ถูกปฏิเสธ
- **AC-5** — response ของ endpoint ใหม่ไม่มี `tracking_token`, `phone`, `phone_hash`, ชื่อผู้บริจาค (ตรวจด้วย test)
- **AC-6** — ตั๋วหลังจองพาไปหน้าติดตามได้โดยไม่มีเบอร์ใน URL

## Impact

- **backend:** endpoint + use case + schema · test ใน `backend/tests/test_donations.py` · `pnpm openapi:update`
- **tent-model:** `DonationBuffer.donor_phone_hash` + index `(donor_phone_hash, created_at)` · ตั้งค่าตอนสร้าง buffer
- **worker:** inbound hash จากเบอร์ที่ normalize แล้ว · test ใน `worker/tests/test_donation_inbound.py`
- **frontend:** BFF route + test · limiter ใหม่ · หน้า track · ตั๋ว · e2e `donation-fullstack.test.ts` (เคส lookup ด้วยเลขจอง + เบอร์ และเบอร์ผิด ต้องปรับตาม UI ใหม่ + เคสค้นด้วยเบอร์)
- **ไม่กระทบ:** projection `public_donations`, `PROJECTION_VERSION`, CouchDB `schema_v`

## Migration

- CouchDB doc ไม่เปลี่ยนรูป → ไม่ bump `schema_v`
- Mongo `DonationBuffer`: field ใหม่ optional + index ใหม่
- **ไม่ backfill** `donor_phone_hash` ให้ buffer ที่สร้างก่อน deploy — production ยังไม่เปิดใช้งานจริง จึงไม่มีการจองจริงที่ต้องค้นย้อนหลัง
- `donor.phone_hash` บน CouchDB ที่ hash จากเบอร์ดิบไปแล้ว: ไม่ต้องแก้ เพราะ endpoint นี้ไม่ได้ค้นจาก CouchDB

## Why

- ผู้บริจาคจำเลขจองไม่ได้ แต่จำเบอร์ตัวเองได้
- เบอร์โทรเดาได้หรือคนอื่นรู้ได้ ถ้าค้นด้วยเบอร์แล้วได้ token จะแก้หรือยกเลิกการจองของคนอื่นได้ จึงให้ได้แค่ข้อมูลขั้นต่ำแบบอ่านอย่างเดียว ตามแบบ "ค้นหาตั๋วของฉัน" ของจิตอาสา (`api/public/v1/volunteer/ticket/find`, `volunteerTicketFindLimiter`)
- ความเสี่ยงที่ยังเหลือ: คนที่รู้เบอร์จะรู้ว่าเจ้าของเบอร์บริจาคที่ศูนย์ไหน วันไหน — เจ้าของโครงการยอมรับแนวทางนี้ 2026-10-17
- ทางเลือกที่ปลอดภัยกว่า (OTP SMS) ตัดออกจากรอบนี้ เพราะยังไม่มีระบบส่ง OTP (มีแค่ flag `public_otp_required`)

## Decision log

- 2026-10-17 — เจ้าของโครงการ: ตกลงแนวทางรายการอ่านอย่างเดียว ไม่คืน token · ดูย้อนหลังตามเดิม (buffer ≈ 72 ชม.) ไม่ขยายไป `public_donations`
- 2026-10-17 — เจ้าของโครงการ: ไม่ต้อง backfill `donor_phone_hash` เพราะ production ยังไม่เปิดใช้งานจริง
- 2026-10-17 — proposed (track ด้วย CR file แยก branch ตามที่เจ้าของโครงการกำหนด)
