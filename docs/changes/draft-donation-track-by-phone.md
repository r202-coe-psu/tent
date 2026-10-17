---
id: draft
title: "ติดตามและจัดการการบริจาคด้วยเบอร์โทรอย่างเดียว (เข้าถึงเต็ม + มาตรการกันไล่สุ่มเบอร์)"
status: proposed
date: 2026-10-17
requested_by: "เจ้าของโครงการ — issue #618 (ข้อกำหนดในคำอธิบาย issue) และ #459 (แยก limiter)"
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/changes/04-donation/CR-052-donation-system-design-v8.md §2.6 (ค้นด้วย Ref ID + เบอร์ / ส่งเบอร์ไปเติมหน้าติดตาม)
  - docs/data/api-contract.md §public — endpoint ใหม่ + track-search เดิม
  - docs/features/public-tier-donation-spec.html — privacy/exposure ของหน้าติดตาม
  - docs/data/schema.md §2.3 — ความหมายของ `donor.phone_hash` (hash จากเบอร์ที่ normalize แล้ว)
  - docs/data/couchdb-mongodb-sync.md §3.2 — `public_donations.donor_phone_hash`
  - packages/tent-model (DonationBuffer, PublicDonation) · worker/src/worker/projectors/donation.py · worker/src/worker/inbound/donations.py
  - backend/apiapp/modules/donations (endpoint ใหม่)
  - frontend/src/routes/api/public/v1/donations/ (BFF ใหม่, track-search) · lib/server/security/rate-limiter.ts
  - frontend/src/routes/(public)/donations/track/+page.svelte · lib/components/public-donor-success-ticket.svelte
why: ผู้บริจาคจำเลขจอง (DN) ไม่ได้ ต้องการดูและจัดการการบริจาคของตัวเองด้วยเบอร์โทรอย่างเดียว
migration: CouchDB doc ไม่เปลี่ยนรูป ไม่ bump schema_v · Mongo buffer/projection เพิ่ม field + index · bump PROJECTION_VERSION
---

# ติดตามและจัดการการบริจาคด้วยเบอร์โทรอย่างเดียว

## สรุป

- **เปลี่ยน:** กรอกเบอร์โทรอย่างเดียวแล้วเห็นการจองทั้งหมดของเบอร์นั้น และ**เข้าถึงได้เต็ม** (ดู แก้ ยกเลิก) เหมือนค้นด้วยเลขจอง + เบอร์ · วิธีเดิม (เลขจอง + เบอร์) ยังใช้ได้
- **ความเสี่ยงที่ยอมรับ:** ใครรู้เบอร์ของผู้บริจาคจะเห็นข้อมูลส่วนบุคคลและแก้/ยกเลิกการจองแทนเจ้าของได้ — เจ้าของโครงการยอมรับแล้ว ระบบจึงต้องมีมาตรการกันการไล่สุ่มเบอร์
- **dev ต้อง build:** endpoint FastAPI + BFF · `donor_phone_hash` ใน buffer และ `public_donations` · limiter แยก + หน่วง/captcha + log/alert · หน้าค้นด้วยเบอร์ (รายการหลายใบ) · แยก limiter ของ track-search เดิม (#459)
- **กระทบ:** CR-052 §2.6 · privacy rule ของ public plane · CouchDB `schema_v` ไม่เปลี่ยน

## Requirements

### ค้นด้วยเบอร์
- **FR-1** — endpoint ใหม่ `POST /public/v1/donations/lookup-by-phone` (service secret) รับ `{phone}` ใน body เท่านั้น ห้ามรับทาง URL/query
- **FR-2** — จับคู่ด้วย `donor_phone_hash` = SHA-256 ของเบอร์ที่ผ่าน `normalize_phone` แล้ว (`081-234-5678`, `0812345678`, `+66812345678` ได้ผลเดียวกัน)
- **FR-3** — คืนการจอง**ทั้งหมด**ของเบอร์นั้น เรียงล่าสุดก่อน (ค้นทั้ง `DonationBuffer` และ `public_donations` แล้วตัดใบซ้ำ เพื่อให้ใบที่ buffer ถูก purge แล้วยังเจอ)
- **FR-4** — แต่ละใบคืน `tracking_token` + ข้อมูลสรุป (เลขจอง, สถานะ, ศูนย์, วันเวลานัด, จำนวนรายการ) — เปิดตั๋วเต็ม แก้ และยกเลิกต่อได้ด้วย token เดิม (CR-080)
- **FR-5** — ไม่พบให้ตอบ 200 `{items: []}` รูปเดียวกับตอนพบ ไม่บอกว่าเบอร์มีอยู่หรือไม่
- **FR-6** — วิธีเดิม (`track-search` ด้วยเลขจอง + เบอร์) ยังใช้ได้

### กันไล่สุ่มเบอร์ (enumeration)
- **FR-7** — limiter ใหม่แยกจาก limiter อื่น: ต่อ IP และต่อเบอร์ (ค่าเริ่มต้นเสนอ 5 ครั้ง/นาที/IP, 10 ครั้ง/ชม./เบอร์)
- **FR-8** — ค้นซ้ำเกินเกณฑ์ (เช่น IP เดียวค้นหลายเบอร์ต่างกันภายในช่วงสั้น) → บังคับ reCAPTCHA และ/หรือหน่วงเวลาการตอบ
- **FR-9** — log ทุกการค้น (IP, hash ของเบอร์, จำนวนผล — ไม่ log เบอร์ดิบ) และ alert เมื่อจำนวนการค้นจากแหล่งเดียวสูงผิดปกติ
- **FR-10** — `track-search` เดิมเลิกใช้ `donationIpLimiter` ร่วมกับการจอง ให้มี limiter ของตัวเอง (#459)

### หน้าติดตาม
- **FR-11** — หน้า `/donations/track` ให้กรอกเบอร์อย่างเดียวได้ ผลเป็นรายการการจอง แตะใบไหนก็เปิดตั๋วเต็มของใบนั้น · ช่องเลขจองยังมีให้ใช้
- **FR-12** — ส่งฟอร์มด้วย POST · เลิก auto-submit จาก `?ref&phone` · ตั๋วหลังจองลิงก์ไปหน้าติดตามด้วย tracking token แทน `?ref&phone` (เบอร์ไม่อยู่ใน URL)

### ความสอดคล้องของ `phone_hash`
- **FR-13** — worker inbound เขียน `donor.phone_hash` บน CouchDB จากเบอร์ที่ normalize แล้ว (ตอนนี้ hash จากเบอร์ดิบ — `worker/src/worker/inbound/donations.py:64`) ให้ตรงกับ backend

## Change (before → after)

| เรื่อง | ก่อน (CR-052 §2.6) | หลัง |
| --- | --- | --- |
| วิธีค้น | เลขจอง + เบอร์ (exact match) | เบอร์อย่างเดียว **หรือ** เลขจอง + เบอร์ |
| ผลการค้นด้วยเบอร์ | — | ทุกใบของเบอร์ พร้อม token เข้าถึงเต็ม |
| privacy | ต้องรู้ทั้งเลขจองและเบอร์ | รู้เบอร์อย่างเดียวพอ (ยอมรับความเสี่ยง + มาตรการ FR-7..FR-9) |
| limiter | track-search ใช้ `donationIpLimiter` ร่วมกับการจอง | limiter แยกของแต่ละ endpoint |
| เบอร์ใน URL | ตั๋วส่ง `?ref&phone` | ไม่มีเบอร์ใน URL |
| ย้อนหลัง | ตามที่ buffer เก็บ | ทุกใบ (ผ่าน `public_donations`) |

## Acceptance

- **AC-1** — กรอกเบอร์อย่างเดียว → ได้ทุกการจองของเบอร์นั้น เรียงล่าสุดก่อน
- **AC-2** — เลือกใบแล้วดูรายละเอียด แก้ไข และยกเลิกได้เหมือนเข้าด้วยเลขจอง + เบอร์
- **AC-3** — เบอร์ที่ไม่มีการจอง → response รูปเดียวกับกรณีพบ (รายการว่าง)
- **AC-4** — ค้นเกิน limiter → 429 · ค้นหลายเบอร์ติดกันจาก IP เดียว → ถูกบังคับ captcha/หน่วง · มี log
- **AC-5** — request ใหม่ไม่มีเบอร์ใน URL/query
- **AC-6** — backend test ครบ: พบ / ไม่พบ / หลายใบ / ถูก rate limit / เบอร์รูปแบบต่างกัน
- **AC-7** — ใบที่ buffer ถูก purge แล้ว (เก่ากว่า TTL) ยังค้นด้วยเบอร์เจอ

## Impact

- **backend:** endpoint + use case + test · `pnpm openapi:update`
- **tent-model / worker:** `DonationBuffer.donor_phone_hash` + index · `PublicDonation.donor_phone_hash` + index · projector ส่งต่อจาก `donor.phone_hash` · inbound hash จากเบอร์ที่ normalize · **bump `PROJECTION_VERSION`**
- **frontend:** BFF + limiter + captcha gate · track-search limiter แยก · หน้าติดตาม · ตั๋ว · e2e (lookup ด้วยเลขจอง + เบอร์เดิม, เบอร์ผิด, เคสค้นด้วยเบอร์หลายใบ)
- **ไม่กระทบ:** CouchDB `schema_v`

## Migration

- CouchDB doc ไม่เปลี่ยนรูป → ไม่ bump `schema_v`
- Mongo: field + index ใหม่ใน buffer และ `public_donations` · bump `PROJECTION_VERSION` ให้ re-project ใบเดิม
- ไม่ backfill buffer เดิม — production ยังไม่เปิดใช้งานจริง
- `donor.phone_hash` บน CouchDB ที่ hash จากเบอร์ดิบไปแล้วจะไม่ตรงกับ hash ใหม่จนกว่าจะ re-sync — production ยังไม่มีข้อมูลจริง จึงไม่ต้องแก้ย้อนหลัง

## Why

- ผู้บริจาคจำเลขจองไม่ได้ แต่จำเบอร์ตัวเองได้ และต้องการจัดการการจองได้เอง
- **ความเสี่ยงที่ยอมรับ (บันทึกตามข้อกำหนด issue #618):** การค้นด้วยเบอร์อย่างเดียวแบบเข้าถึงเต็มทำให้ใครก็ตามที่รู้เบอร์ เห็นชื่อ เบอร์ อีเมล และที่อยู่รับของ (CR-010) และแก้/ยกเลิกการจองแทนเจ้าของได้ (CR-080) · เบอร์เดาและไล่ได้ง่ายกว่าเลขจอง + เบอร์ · เจ้าของโครงการยอมรับความเสี่ยงนี้ โดยมีมาตรการ FR-5, FR-7..FR-9 ลดการไล่สุ่ม
- ทางเลือกที่ตัดทิ้ง: (1) รายการแบบอ่านอย่างเดียวไม่คืน token — ผู้บริจาคยังต้องจำเลขจองเพื่อแก้/ยกเลิก ไม่ตอบโจทย์ (2) OTP ทาง SMS — ยังไม่มีระบบส่ง OTP (มีแค่ flag `public_otp_required`) อยู่นอกขอบเขต

## Decision log

- 2026-10-17 — เจ้าของโครงการ: ใช้ข้อกำหนดตามคำอธิบาย issue #618 (เข้าถึงเต็ม · ยอมรับความเสี่ยง PII · มาตรการกันไล่สุ่มเบอร์) แทนแบบอ่านอย่างเดียวที่ร่างไว้ก่อนหน้า
- 2026-10-17 — ไม่ backfill buffer เดิม เพราะ production ยังไม่เปิดใช้งานจริง
- 2026-10-17 — proposed (track ด้วย CR file แยก branch)
