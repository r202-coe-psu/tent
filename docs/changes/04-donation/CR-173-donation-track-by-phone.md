---
id: CR-173
title: "ติดตามและจัดการการบริจาคด้วยเบอร์โทรอย่างเดียว (เข้าถึงเต็ม + มาตรการกันไล่สุ่มเบอร์)"
status: approved
date: 2026-10-17
updated: 2026-10-27
approved_at: 2026-10-18
requested_by: "Kan"
decided_by: "Soravit Sukkarn (Team Lead)"
layer: volatile
affects:
  - docs/changes/04-donation/CR-052-donation-system-design-v8.md §2.6 (ค้นด้วย Ref ID + เบอร์ / ส่งเบอร์ไปเติมหน้าติดตาม)
  - docs/data/api-contract.md §public — endpoint ใหม่ + track-search เดิม
  - docs/features/public-tier-donation-spec.html — privacy/exposure ของหน้าติดตาม
  - docs/data/schema.md §2.3 — ความหมายของ `donor.phone_hash` (hash จากเบอร์ที่ normalize แล้ว)
  - packages/tent-model (DonationBuffer) · worker/src/worker/inbound/donations.py
  - backend/apiapp/modules/donations (endpoint ใหม่)
  - frontend/src/routes/api/public/v1/donations/ (BFF ใหม่, track-search) · lib/server/security/recaptcha-gate.ts
  - frontend/src/routes/(public)/donations/track/+page.svelte · lib/components/public-donor-success-ticket.svelte
why: ผู้บริจาคจำเลขจอง (DN) ไม่ได้ ต้องการดูและจัดการการบริจาคของตัวเองด้วยเบอร์โทรอย่างเดียว
migration: CouchDB doc ไม่เปลี่ยนรูป ไม่ bump schema_v · Mongo DonationBuffer เพิ่ม field + index · ไม่กระทบ PROJECTION_VERSION
---

# CR-173 — ติดตามและจัดการการบริจาคด้วยเบอร์โทรอย่างเดียว

## สรุป

- **เปลี่ยน:** กรอกเบอร์โทรอย่างเดียวแล้วเห็นการจองที่ยัง active (อายุไม่เกิน 72 ชม. ใน buffer) ทั้งหมดของเบอร์นั้น และ**เข้าถึงได้เต็ม** (ดู แก้ ยกเลิก) เหมือนค้นด้วยเลขจอง + เบอร์ · วิธีเดิม (เลขจอง + เบอร์) ยังใช้ได้
- **ความเสี่ยงที่ยอมรับ:** ใครรู้เบอร์ของผู้บริจาคจะเห็นข้อมูลส่วนบุคคลและแก้/ยกเลิกการจองแทนเจ้าของได้ — เจ้าของโครงการยอมรับแล้ว ระบบจึงต้องมีมาตรการกันการไล่สุ่มเบอร์
- **dev ต้อง build:** endpoint FastAPI + BFF (`POST .../lookup-by-phone`) · `donor_phone_hash` ใน `DonationBuffer` · captcha ทุกครั้งที่ค้น + log/alert · หน้าค้นด้วยเบอร์ (รายการหลายใบ) · rate limit ใช้ nginx (CR-188)
- **กระทบ:** CR-052 §2.6 · privacy rule ของ public plane · CouchDB `schema_v` ไม่เปลี่ยน · ไม่กระทบ `PROJECTION_VERSION`

## Requirements

### ค้นด้วยเบอร์
- **FR-1** — endpoint ใหม่ `POST /public/v1/donations/lookup-by-phone` (service secret) และ BFF `POST /api/public/v1/donations/lookup-by-phone` · BFF รับ body `{ phone: string, captcha_token?: string }` และส่งต่อ FastAPI เป็น `{ phone: string }` เท่านั้น ห้ามรับทาง URL/query · BFF normalize เบอร์แล้วตอบ 422 `INVALID_PHONE` ถ้าไม่ตรง `^0\d{8,9}$` (มือถือ 10 หลักหรือเบอร์บ้าน 9 หลัก)
- **FR-2** — จับคู่ด้วย `donor_phone_hash` = SHA-256 ของเบอร์ที่ผ่าน `normalize_phone` แล้ว (`081-234-5678`, `0812345678`, `+66812345678` ได้ผลเดียวกัน)
- **FR-3** — คืนการจองที่ยัง active ทั้งหมดของเบอร์นั้น เรียงล่าสุดก่อน (ค้นจาก `DonationBuffer` ภายในอายุ buffer 72 ชม.) ไม่รวมใบที่พ้น TTL และถูก purge ไปแล้ว · คืนสูงสุด 50 ใบล่าสุดต่อเบอร์ ไม่มี pagination
- **FR-4** — แต่ละใบคืน `tracking_token` + ข้อมูลสรุป (เลขจอง, สถานะ, ศูนย์, วันเวลานัด, จำนวนรายการ) — เปิดตั๋วเต็ม แก้ และยกเลิกต่อได้ด้วย token เดิม (CR-080)
- **FR-5** — ไม่พบให้ตอบ 200 `{items: []}` รูปเดียวกับตอนพบ ไม่บอกว่าเบอร์มีอยู่หรือไม่
- **FR-6** — วิธีเดิม (`track-search` ด้วยเลขจอง + เบอร์) ยังใช้ได้

### กันไล่สุ่มเบอร์ (enumeration)
- **FR-7** — ~~limiter ใหม่แยกจาก limiter อื่น: ต่อ IP และต่อเบอร์ (5 ครั้ง/นาที/IP, 10 ครั้ง/ชม./เบอร์)~~ ยกเลิกโดย [CR-188](../01-core/CR-188-rate-limit-to-nginx.md) — request rate ใช้ nginx zone `public_write` (route นี้เป็น POST)
- **FR-8** — ป้องกันการสุ่มค้นหลายเบอร์ (enumeration): BFF ตรวจ reCAPTCHA **ทุกครั้ง**ที่ค้นด้วยเบอร์ (action `donation_lookup`) ไม่นับจำนวนเบอร์ต่อ IP ในแอป · ไม่มี token → 403 `CAPTCHA_REQUIRED` · token ไม่ผ่าน → 403 `CAPTCHA_FAILED` · captcha ปิดตามสวิตช์ `config:app.recaptcha_enabled` เหมือน route สาธารณะอื่น — เมื่อปิด เหลือแค่ rate limit ของ nginx (ยอมรับแล้ว)
- **FR-9** — log ทุกการค้น (IP, hash ของเบอร์, จำนวนผล — ไม่ log เบอร์ดิบ) และ structured log alert (`logger.warning`) เมื่อจำนวนการค้นจากแหล่งเดียวสูงผิดปกติ — แหล่ง = IP ที่ BFF ส่งมาทาง `X-Real-IP` · เกณฑ์: เกิน 20 ครั้ง หรือเกิน 5 เบอร์ต่างกัน ภายใน 10 นาที · alert ครั้งเดียวต่อแหล่งต่อ window · ไม่ block
- **FR-10** — ~~`track-search` เดิมเลิกใช้ `donationIpLimiter` ร่วมกับการจอง ให้มี limiter ของตัวเอง (#459)~~ ไม่ต้องทำแล้ว — CR-188 ลบ limiter ในแอปของ route donations ทั้งหมด (#459 ปิดด้วย nginx)

### หน้าติดตาม
- **FR-11** — หน้า `/donations/track` ให้กรอกเบอร์อย่างเดียวได้ ผลเป็นรายการการจอง แตะใบไหนก็เปิดตั๋วเต็มของใบนั้น · ช่องเลขจองยังมีให้ใช้
- **FR-12** — ส่งฟอร์มด้วย POST · เลิก auto-submit จาก `?ref&phone` · ตั๋วหลังจองลิงก์ไปหน้าติดตามด้วย tracking token แทน `?ref&phone` (เบอร์ไม่อยู่ใน URL)

### ความสอดคล้องของ `phone_hash`
- **FR-13** — worker inbound เขียน `donor.phone_hash` บน CouchDB จากเบอร์ที่ normalize แล้ว (ตอนนี้ hash จากเบอร์ดิบ — `worker/src/worker/inbound/donations.py:64`) ให้ตรงกับ backend

## Change (before → after)

| เรื่อง | ก่อน (CR-052 §2.6) | หลัง |
| --- | --- | --- |
| วิธีค้น | เลขจอง + เบอร์ (exact match) | เบอร์อย่างเดียว **หรือ** เลขจอง + เบอร์ |
| ผลการค้นด้วยเบอร์ | — | การจองที่ยัง active ทั้งหมดของเบอร์ พร้อม token เข้าถึงเต็ม |
| privacy | ต้องรู้ทั้งเลขจองและเบอร์ | รู้เบอร์อย่างเดียวพอ (ยอมรับความเสี่ยง + มาตรการ FR-8, FR-9 และ nginx) |
| limiter | track-search ใช้ `donationIpLimiter` ร่วมกับการจอง | ไม่มี limiter ในแอป — nginx `public_write` (CR-188) + captcha ทุกครั้งที่ค้นด้วยเบอร์ |
| เบอร์ใน URL | ตั๋วส่ง `?ref&phone` | ไม่มีเบอร์ใน URL |
| ย้อนหลัง | ตามที่ buffer เก็บ | ตามที่ buffer เก็บ (อายุ 72 ชม. / active reservations — ใบที่พ้น TTL และ purge แล้วไม่รวมในผลลัพธ์) |

## Acceptance

- **AC-1** — กรอกเบอร์อย่างเดียว → ได้การจองที่ยัง active ของเบอร์นั้น เรียงล่าสุดก่อน
- **AC-2** — เลือกใบแล้วดูรายละเอียด แก้ไข และยกเลิกได้เหมือนเข้าด้วยเลขจอง + เบอร์
- **AC-3** — เบอร์ที่ไม่มีการจอง → response รูปเดียวกับกรณีพบ (รายการว่าง)
- **AC-4** — ค้นด้วยเบอร์โดยไม่มี captcha token (เมื่อเปิด captcha) → 403 `CAPTCHA_REQUIRED` · token ไม่ผ่าน → 403 `CAPTCHA_FAILED` · เบอร์ผิดรูปแบบ → 422 `INVALID_PHONE` · ทุกการค้นมี log และแหล่งที่ค้นเกินเกณฑ์ FR-9 มี alert
- **AC-5** — request ใหม่ไม่มีเบอร์ใน URL/query
- **AC-6** — backend test ครบ: พบ / ไม่พบ / หลายใบ / alert ค้นมากเกินจากแหล่งเดียว / เบอร์รูปแบบต่างกัน
- **AC-7** — ใบที่ buffer ถูก purge แล้ว (เก่ากว่า TTL 72 ชม.) จะไม่ปรากฏในผลลัพธ์การค้นหาด้วยเบอร์

## Impact

- **backend:** endpoint + use case + test · `pnpm openapi:update`
- **tent-model / worker:** `DonationBuffer.donor_phone_hash` + index · inbound hash จากเบอร์ที่ normalize · **ไม่แตะ `PublicDonation` หรือ projector และไม่ bump `PROJECTION_VERSION`**
- **frontend:** BFF + captcha gate ทุกครั้ง · หน้าติดตาม · ตั๋ว · e2e (lookup ด้วยเลขจอง + เบอร์เดิม, เบอร์ผิด, เคสค้นด้วยเบอร์หลายใบ)
- **ไม่กระทบ:** CouchDB `schema_v`, worker projector, `PROJECTION_VERSION`

## Migration

- CouchDB doc ไม่เปลี่ยนรูป → ไม่ bump `schema_v`
- Mongo: field + index ใหม่ใน `DonationBuffer` · ไม่กระทบ `PublicDonation` หรือ `PROJECTION_VERSION`
- ไม่ backfill buffer เดิม — production ยังไม่เปิดใช้งานจริง
- `donor.phone_hash` บน CouchDB ที่ hash จากเบอร์ดิบไปแล้วจะไม่ตรงกับ hash ใหม่จนกว่าจะ re-sync — production ยังไม่มีข้อมูลจริง จึงไม่ต้องแก้ย้อนหลัง

## Why

- ผู้บริจาคจำเลขจองไม่ได้ แต่จำเบอร์ตัวเองได้ และต้องการจัดการการจองของตนเองที่กำลังจะมาส่ง
- **จำกัดขอบเขตใน `DonationBuffer` (active 72 ชม.):**
  1. สามารถส่งมอบ `tracking_token` ของจริงเพื่อเปิดตั๋วเต็ม/แก้ไข/ยกเลิกการจองได้จริงตามสถาปัตยกรรม (CouchDB และ `public_donations` เก็บเฉพาะ SHA-256 hash จึงถอดรหัสคืน token ไม่ได้)
  2. ใบที่พ้น TTL/purge ไปแล้วถือเป็นใบที่สิ้นสุดแล้ว (`received`/`expired`) ซึ่งตามกฎความปลอดภัย CR-080 ไม่เปิดให้แก้ไขหรือยกเลิกได้อยู่แล้ว
  3. ไม่กระทบ CouchDB schema หรือ projector และไม่ต้อง bump `PROJECTION_VERSION`
  4. ลดความเสี่ยง PII enumeration ไม่เปิดช่องให้ใครเอาเบอร์โทรไปสุ่มดูประวัติการบริจาคย้อนหลังทั้งหมดของผู้อื่น
- **ความเสี่ยงที่ยอมรับ (บันทึกตามข้อกำหนด issue #618):** การค้นด้วยเบอร์อย่างเดียวแบบเข้าถึงเต็มทำให้ใครก็ตามที่รู้เบอร์ เห็นชื่อ เบอร์ อีเมล และที่อยู่รับของ (CR-010) และแก้/ยกเลิกการจองแทนเจ้าของได้ (CR-080) · เบอร์เดาและไล่ได้ง่ายกว่าเลขจอง + เบอร์ · เจ้าของโครงการยอมรับความเสี่ยงนี้ โดยมีมาตรการ FR-5, FR-8, FR-9 และ rate limit ของ nginx ลดการไล่สุ่ม
- ทางเลือกที่ตัดทิ้ง: (1) รายการแบบอ่านอย่างเดียวไม่คืน token — ผู้บริจาคยังต้องจำเลขจองเพื่อแก้/ยกเลิก ไม่ตอบโจทย์ (2) OTP ทาง SMS — ยังไม่มีระบบส่ง OTP (มีแค่ flag `public_otp_required`) อยู่นอกขอบเขต (3) ค้นหาย้อนหลังใน `public_donations` — ไม่สามารถคืน plaintext `tracking_token` ได้เนื่องจากเก็บเป็น SHA-256 hash

## Decision log

- 2026-10-17 — เจ้าของโครงการ: ใช้ข้อกำหนดตามคำอธิบาย issue #618 (เข้าถึงเต็ม · ยอมรับความเสี่ยง PII · มาตรการกันไล่สุ่มเบอร์) แทนแบบอ่านอย่างเดียวที่ร่างไว้ก่อนหน้า
- 2026-10-17 — ไม่ backfill buffer เดิม เพราะ production ยังไม่เปิดใช้งานจริง
- 2026-10-17 — proposed (track ด้วย CR file แยก branch)
- 2026-10-18 — ตัดการค้นหาใน `public_donations` ออก คงการค้นหาเฉพาะใน `DonationBuffer` (active 72 ชม.) เพื่อให้สามารถคืน `tracking_token` ได้อย่างถูกต้องตามสถาปัตยกรรม, ปรับ FR-1 ให้รองรับ `captcha_token` และกำหนดเกณฑ์ป้องกัน enumeration ใน FR-8 ให้ชัดเจน
- 2026-10-18 — approved โดย Soravit Sukkarn (Team Lead) ตามคำขอของ Kan (รันเลข CR-173 ย้ายเข้าหมวด 04-donation)
- 2026-10-23 — **Superseded (rate limit) by [CR-188](../01-core/CR-188-rate-limit-to-nginx.md):** FR-7 (limiter ต่อ IP และต่อเบอร์ของ track-by-phone) ถูกยกเลิกก่อน implement — ใช้ nginx zone `public_read`
- 2026-10-27 — อัปเดตโดย Soravit Sukkarn (Team Lead) ให้ตรงกับที่ implement (#931): FR-8 เปลี่ยนเป็น captcha ทุกครั้งที่ค้นด้วยเบอร์ (แทนการนับ 3 เบอร์ต่อ IP ใน 5 นาที ซึ่งต้องมี state ต่อ IP ในแอปที่ CR-188 ลบไป) และยอมรับว่าเมื่อ operator ปิด captcha จะเหลือแค่ rate limit ของ nginx · อนุญาตให้ค้นด้วยเบอร์โทรอย่างเดียว · FR-1 แยก body ของ BFF/FastAPI + 422 `INVALID_PHONE` · FR-3 จำกัด 50 ใบ · FR-9 ระบุเกณฑ์ alert · FR-10 ไม่ต้องทำแล้ว · AC-4/AC-6 ปรับตาม · แก้ zone ของ route นี้เป็น `public_write` (POST) ไม่ใช่ `public_read`
