---
id: CR-175
title: "ผู้บริจาคแนบรูปของบริจาค (ทั้งใบ) และแสดงให้เจ้าหน้าที่ดูตอนประเมิน/ตรวจรับ"
status: approved
date: 2026-10-18
updated: 2026-10-23
approved_at: 2026-10-20
requested_by: "Kan"
decided_by: "Soravit Sukkarn (Team Lead)"
layer: volatile
affects:
  - docs/data/schema.md §2.3 `donation` — field ใหม่ `photos`
  - schema_v donation 7 → 8 (CR-172 ใช้ 6 · CR-174 ใช้ 7)
  - docs/data/schema.md §1.6 `image` — field ใหม่ `purpose`, `donation_id`, writer ใหม่ (public donation), ขนาดรูปของบริจาค
  - schema_v image 1 → 2
  - docs/data/api-contract.md — BFF `POST /api/public/v1/donations/photos`, `photos` ใน `POST /public/v1/donations`, error code ของ 422
  - docs/features/public-tier-donation-spec.html — ช่องแนบรูป (ไม่เปิดให้ public อ่านรูป)
  - frontend/src/routes/api/public/v1/donations/ (BFF ใหม่ + POST booking) · lib/utils/image-compress.ts
  - frontend/src/lib/features/images/domain/image.ts (`ImageDoc`) · writer ของ `image` ทุกจุด: lib/features/images/data/image.remote.ts · lib/features/kiosk/server/kiosk-photo.server.ts · lib/features/public-register/save-public-booking-image.server.ts (+ รับ `purpose`) · backend/apiapp/modules/unassigned_registrations/couch_birth.py (`IMAGE_SCHEMA_V`)
  - frontend/src/lib/features/kiosk/domain/kiosk-photo.ts (`detectImageMime` ใช้ร่วม)
  - frontend/src/lib/server/shelter-access-design.ts (Mango partial index ใหม่) · frontend/src/lib/server/security/rate-limiter.ts (limiter ใหม่)
  - frontend/src/lib/components/form/form-donor.svelte · lib/components/pending-review-detail.svelte · stock-donations/components/scan-station.svelte
  - backend/apiapp/modules/donations (schemas, create) · packages/tent-model (DonationBuffer: `photos`, `photos_linked`)
  - worker/src/worker/inbound/donations.py (copy `photos` + ผูกรูปกับใบ) · worker/src/worker/retention/job.py (ลบรูปที่ไม่ถูกใช้)
why: เจ้าหน้าที่ประเมินของบริจาคที่ผู้บริจาคพิมพ์เองได้จากชื่ออย่างเดียว ไม่เห็นสภาพของจริง
migration: field ใหม่ optional ทั้งสอง doc type — doc เดิมไม่ต้อง backfill
---

# ผู้บริจาคแนบรูปของบริจาค และเจ้าหน้าที่เห็นตอนประเมิน/ตรวจรับ

## สรุป

- **เปลี่ยน:** ฟอร์มบริจาคแบบพิมพ์เองมีช่องแนบรูป (ทั้งใบ ไม่บังคับ สูงสุด 30 รูป) · เจ้าหน้าที่เห็นรูปในหน้าประเมินและหน้าตรวจรับ
- **เพื่อ:** เจ้าหน้าที่ตัดสินใจรับ/ไม่รับได้จากสภาพของจริงก่อนของมาถึง
- **dev ต้อง build:** BFF อัปโหลดรูป (ใช้ทางเดียวกับรูปลงทะเบียนล่วงหน้า → doc `image:{ulid}` ใน shelter DB) · `donation.photos` · worker ผูกรูปกับใบ (`image.donation_id`) · ช่องแนบรูปในฟอร์ม · แถบรูปฝั่งเจ้าหน้าที่ · worker ลบรูปที่ไม่ถูกใช้หลัง 24 ชม.
- **กระทบ:** `donation` schema_v 7 → 8 · `image` schema_v 1 → 2 · ผู้บริจาคไม่เห็นรูปบนหน้าติดตาม

## Requirements

### ขอบเขตการแนบ
- **FR-1** — ช่องแนบรูปมีเฉพาะการบริจาคที่ผู้บริจาคพิมพ์เอง (โหมด unsolicited) · โหมดเลือกจากแคมเปญไม่มีช่องนี้
- **FR-2** — แนบรูประดับใบ (`donation.photos: string[]` เก็บ `image:{ulid}`) ไม่ผูกกับรายการใดรายการหนึ่ง
- **FR-3** — ไม่บังคับแนบ · **สูงสุด 30 รูปต่อใบ** · ฟอร์มไม่ให้เลือกเพิ่มเมื่อครบ 30
- **FR-3a** — แนบรูปได้ตอนจองเท่านั้น · ผู้บริจาคแก้ใบภายหลัง (`PATCH items`) รูปเดิมยังอยู่ แต่เพิ่มหรือลบรูปไม่ได้

### ขนาดรูป
- **FR-4** — ไฟล์ต้นฉบับที่เลือกได้ไม่เกิน **20MB ต่อรูป** (ตรวจในเครื่องผู้บริจาค)
- **FR-5** — ย่อในเครื่องผู้บริจาคก่อนส่ง: `full` WEBP ด้านยาวสุด **1600px** คุณภาพ 0.8 · `thumb` WEBP square-crop 200px
- **FR-6** — server ปฏิเสธ `full` ที่ใหญ่เกิน **1.5MB** หรือชนิดไฟล์ไม่ใช่รูป · ตรวจ magic bytes จริง ไม่เชื่อ `content-type` (ใช้ `detectImageMime` ร่วมกับ kiosk ไม่เขียนใหม่)
- **FR-7** — ขนาดรวมของรูปทั้งใบ (`full` + `thumb` ทุกรูป) ไม่เกิน **10MB** · ฟอร์มแสดงแถบ "ใช้ไปแล้ว X / 10 MB" และไม่ให้เลือกเพิ่มเมื่อเต็ม · BFF ตรวจซ้ำตอนกดจอง

### อัปโหลดและผูกกับใบจอง
- **FR-8** — BFF ใหม่ `POST /api/public/v1/donations/photos` (multipart: `shelter_code`, `full`, `thumb`) เขียน `image:{ulid}` ลง `shelter_{code}` ผ่าน `public_writer` (ใช้ `savePublicBookingImage` เดิม ขยายให้รับ `purpose`) ตั้ง `purpose: 'donation'` · คืน `photo_id` (ชื่อเดียวกับ `POST /api/public/v1/registrations/photos`)
- **FR-9** — BFF อัปโหลดมี limiter ของตัวเอง **60 ครั้ง/นาที ต่อ IP** (ไม่ใช้ `donationIpLimiter` ที่ 3 ครั้ง/นาที) — ใบหนึ่งอัปได้ 30 รูป รูปละ 1 คำขอ จึงอัปครบใบได้ในนาทีเดียวและลองใหม่ได้อีกรอบ · รับเฉพาะศูนย์ที่เปิดรับบริจาค
- **FR-10** — `POST /api/public/v1/donations` รับ `photos?: string[]` · BFF ตรวจตามลำดับ ไม่ผ่านตอบ 422 พร้อม `error_code`:
  - เกิน 30 id → `PHOTO_LIMIT_EXCEEDED` (ตรวจก่อนอ่าน CouchDB)
  - อ่านเอกสารรูปทีละ id (`GET` ตาม `_id` ไม่ต้องใช้ index) ไม่พบใน shelter DB นั้น → `PHOTO_NOT_FOUND`
  - ไม่ใช่ `purpose: 'donation'` → `PHOTO_INVALID`
  - มี `donation_id` แล้ว (ผูกกับใบอื่น) → `PHOTO_ALREADY_USED`
  - ขนาดรวมเกิน FR-7 → `PHOTOS_TOO_LARGE`
- **FR-11** — FastAPI `DonationCreateRequest` และ `DonationBuffer` เก็บ `photos` · `DonationBuffer.photos_linked: bool` (ใบที่ไม่มีรูป = `True` · มีรูป = `False` จนผูกครบ) · worker inbound copy `photos` ลง CouchDB doc
- **FR-11a** — worker inbound เขียน `donation_id` ลงเอกสารรูปทุกรูปใน `photos` ตอนเขียนใบลง CouchDB · รูปที่มี `donation_id` ของใบอื่นอยู่แล้ว → ไม่เขียนทับ และตัด id นั้นออกจาก `photos` ของใบใหม่ · เขียนแบบอ่าน-แก้-เขียนด้วย `_rev` ล่าสุด ได้ 409 → อ่านใหม่แล้วลองอีก (สูงสุด 3 ครั้ง) ถ้ารอบที่อ่านใหม่เจอ `donation_id` ของใบอื่นแล้วให้ทำตามกรณีข้างต้น · ครบ 3 ครั้งแล้วยังไม่สำเร็จ → ใบยังเขียนลง CouchDB ตามปกติ (`photos` คง id นั้นไว้) · log ระดับ warning พร้อม id รูป · `photos_linked` คง `False` → loop inbound หยิบใบที่ `synced_to_couch == True` และ `photos_linked == False` มาลองผูกรูปที่ยังไม่มี `donation_id` ซ้ำทุกรอบ จนผูกครบหรือรูปถูกลบไปแล้วจึงตั้ง `True` (inbound เดิมเขียนใบครั้งเดียวแล้วไม่กลับมาแตะอีก — `worker/src/worker/inbound/donations.py:83`, `:101`) · ถ้ารูปถูกลบไปก่อนตาม FR-16 หน้าเจ้าหน้าที่แสดงตาม FR-13b

### เจ้าหน้าที่
- **FR-12** — หน้าประเมิน (`pending-review-detail`) และหน้าตรวจรับแสดงแถบ thumbnail เมื่อใบมีรูป · กดแล้วเปิดรูปเต็ม (อ่านผ่าน session `/couch` ของเจ้าหน้าที่ — `imageRepository`)
- **FR-13** — ใบที่ไม่มีรูปไม่แสดงส่วนนี้
- **FR-13a** — ส่งต่อใบไปศูนย์อื่น (`donation_redirect` §2.19) รูปไม่ตามไปในรอบนี้ · เจ้าหน้าที่ศูนย์ปลายทางไม่เห็นรูป (รูปอยู่ใน shelter DB ต้นทาง)
- **FR-13b** — อ่านรูปที่อยู่ใน `photos` ไม่เจอ (เช่น ถูกลบตาม FR-16 เพราะ worker คัดลอกใบลง CouchDB ช้ากว่า 24 ชม.) → แสดงช่องว่าง "รูปไม่พร้อมใช้" แทนรูปนั้น · ไม่ขึ้น error และรูปอื่นในใบยังแสดงตามปกติ

### ผู้บริจาค
- **FR-14** — หน้าติดตามสถานะ**ไม่แสดง**รูป และไม่มี public read path ของรูป
- **FR-15** — ฟอร์มมีข้อความเตือนว่ารูปอาจติดข้อมูลส่วนตัว (หน้าคน ทะเบียนรถ บ้านเลขที่)

### ลบรูปที่ไม่ได้ใช้
- **FR-16** — worker retention ลบ `image` ที่ `purpose: 'donation'` ไม่มี `donation_id` และสร้างมานานกว่า **24 ชั่วโมง** · ค้นด้วย Mango **partial index** ใหม่ใน `shelter-access-design.ts`: `fields: ['created_at']` + `partial_filter_selector: { type: 'image', purpose: 'donation', donation_id: { $exists: false } }` — index เก็บเฉพาะรูปที่ยังไม่ผูกกับใบ รูปที่ผูกแล้วหลุดออกจาก index ทันทีที่ worker เขียน `donation_id` จึงไม่ถูกอ่านซ้ำทุกรอบ (index ธรรมดา `[type, purpose, created_at]` ต้องไล่รูปเก่าที่ผูกแล้วทั้งหมด) · query ต้องใส่ selector เดียวกันและระบุ `use_index`
- **FR-16a** — รูปที่ผูกกับใบแล้ว (มี `donation_id`) ไม่ถูกลบ แม้ใบจะถูกยกเลิก ปฏิเสธ หรือหมดอายุ

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| แนบรูปของบริจาค | ไม่มี (ช่องรูปถูกถอดออก — `form-donor.svelte:337-339`) | มี เฉพาะโหมดพิมพ์เอง สูงสุด 30 รูป |
| `donation` | ไม่มี field รูป | `photos: string[]` (opt) |
| `image` | ไม่มี `purpose` · `full` ≤1024px · writer ทุกจุดเขียน schema_v 1 | `purpose`, `donation_id` (opt) · รูปของบริจาค `full` ≤1600px · writer ทุกจุดเขียน schema_v 2 |
| writer ของ `image` | staff onsite, public shelter booking, unassigned claim, kiosk | + รูปของบริจาคจากผู้บริจาค (BFF → `public_writer` ไม่มี role) · ทุกจุดเขียน schema_v 2 |
| ตรวจชนิดไฟล์ route สาธารณะ | ไม่ตรวจ magic bytes | ตรวจ (route ใหม่) |

## Acceptance

- **AC-1** — บริจาคแบบพิมพ์เองพร้อมรูป 2 รูป → เจ้าหน้าที่เห็น thumbnail ทั้ง 2 ในหน้าประเมินและหน้าตรวจรับ · กดแล้วเห็นรูปเต็ม
- **AC-2** — โหมดเลือกจากแคมเปญไม่มีช่องแนบรูป
- **AC-3** — เลือกรูปต้นฉบับ 25MB → ถูกปฏิเสธในฟอร์ม · รวมเกิน 10MB → เลือกเพิ่มไม่ได้
- **AC-4** — ส่ง id รูปของศูนย์อื่น → 422 `PHOTO_NOT_FOUND` · รูปที่ไม่ใช่ `purpose: 'donation'` → 422 `PHOTO_INVALID`
- **AC-5** — ไฟล์ที่ไม่ใช่รูป (เปลี่ยนนามสกุล) → อัปโหลดไม่ผ่าน
- **AC-6** — หน้าติดตามของผู้บริจาคไม่มีรูป
- **AC-7** — รูปที่อัปโหลดแล้วไม่ได้กดจอง ถูกลบหลัง 24 ชม. · รูปที่ผูกกับใบแล้ว (มี `donation_id`) ไม่ถูกลบ
- **AC-8** — ฟอร์มเลือกรูปที่ 31 ไม่ได้ · ส่ง 31 id ตรงเข้า API → 422 `PHOTO_LIMIT_EXCEEDED`
- **AC-9** — ใช้ id รูปที่ผูกกับใบอื่นแล้วตอนจองใบใหม่ → 422 `PHOTO_ALREADY_USED`
- **AC-10** — ส่งต่อใบที่มีรูปไปศูนย์อื่น → ตั๋วปลายทางไม่มีรูป · ใบต้นทางยังเห็นรูปตามเดิม
- **AC-11** — รูปจาก kiosk, ลงทะเบียนล่วงหน้า, เคลม unassigned registration และเจ้าหน้าที่ที่สร้างหลังเปลี่ยน มี schema_v 2 และไม่มี `purpose` → ไม่ถูกลบโดย FR-16
- **AC-12** — ผู้บริจาคแก้รายการในใบที่มีรูป → รูปเดิมยังอยู่ครบ · หน้าแก้ใบไม่มีช่องเพิ่มหรือลบรูป
- **AC-13** — ใบที่มี 2 รูป ลบเอกสารรูป 1 รูปออก → หน้าประเมินแสดงรูปที่เหลือ 1 รูป และช่อง "รูปไม่พร้อมใช้" 1 ช่อง ไม่มี error

## Impact

- **frontend:**
  - BFF ใหม่ + limiter · POST booking ตรวจ `photos` ตาม FR-10 · `image-compress.ts` รองรับขนาด 1600px · ฟอร์มผู้บริจาค (นับรูป + แถบขนาด) · `DonationPhotoStrip` (`features/donations/ui`) ในหน้าประเมินและหน้าตรวจรับ · type `PendingDonationRow` / `ScanDonationView` + projection ฝั่ง back-office (`toPendingRow`, `toScanView`)
  - `ImageDoc` (`features/images/domain/image.ts`) เพิ่ม `purpose?`, `donation_id?` · writer ทุกจุดอ้างค่าคงที่ schema_v ของ `image` แทนเลข 1 ตายตัว: `image.remote.ts:52`, `kiosk-photo.server.ts:67`, `save-public-booking-image.server.ts:59` · `SavePublicBookingImageInput` / `savePublicBookingImage` รับ `purpose?` แล้วส่งต่อให้ `makeDoc`
  - `detectImageMime` (`features/kiosk/domain/kiosk-photo.ts:34`) ใช้ร่วมกับ BFF ใหม่ · ย้ายไปที่ส่วนกลางได้ถ้าจำเป็นต่อ layer boundary
  - หมายเหตุ: `savePublicBookingImage` อยู่ใน `features/public-register` · ใช้ผ่าน barrel ได้ ย้ายไป `features/images` เป็นงานแยกถ้าต้องการ
- **backend:** `IMAGE_SCHEMA_V` 1 → 2 (`modules/unassigned_registrations/couch_birth.py:26` — writer ของ `image` ฝั่ง FastAPI ตอนเคลม unassigned registration) · schemas + create + test · `pnpm openapi:update`
- **tent-model / worker:** `DonationBuffer.photos`, `photos_linked` · inbound copy + ผูก `donation_id` + loop ลองผูกซ้ำใบที่ `photos_linked == False` (FR-11a) · retention job ลบรูปกำพร้า (FR-16) + test
- **CouchDB:** `image` อยู่ใน allow-list ของ VDU แล้ว (`shelter-access-design.ts`) — ตรวจว่า `public_writer` เขียน `purpose` ได้ · Mango partial index ใหม่ตาม FR-16 (CouchDB 3.5 รองรับ `partial_filter_selector`)
- **e2e:** จองแบบพิมพ์เองพร้อมรูป (fixture รูปเล็ก) → เจ้าหน้าที่เห็นรูป · helper จองแบบพิมพ์เองใช้ร่วมกับงาน #610

## Migration

- **`donation` schema_v 7 → 8:** `photos` optional → doc เดิมไม่ต้อง backfill · ไม่มี field = ไม่มีรูป · เรียงต่อจาก CR-172 (6) และ CR-174 (7)
- **`image` schema_v 1 → 2:** `purpose`, `donation_id` optional → doc เดิมไม่ต้อง backfill · ไม่มี `purpose` = รูปประเภทเดิม (ไม่ถูกลบโดย FR-16) · writer ทุกจุด (frontend 3 จุด + `couch_birth.py`) เขียน schema_v 2 หลังเปลี่ยน

## Why

- ของที่ผู้บริจาคพิมพ์เองเจ้าหน้าที่ไม่รู้ว่าเป็นอะไรจริง รูปช่วยให้ประเมินได้ก่อนของมาถึง
- เฉพาะโหมดพิมพ์เอง เพราะของในแคมเปญไม่ต้องรอประเมินอยู่แล้ว (#610)
- จำกัดทั้งขนาดรวม (10MB) และจำนวน (30 รูป) · 10MB หลังย่อพอสำหรับใบทั่วไป (2–3 รูปใช้ราว 1MB) โดยไม่ทำให้ shelter DB โตเร็ว · เพดานจำนวนกันไม่ให้ BFF ต้องอ่านเอกสารรูปจำนวนมากในคำขอเดียว (รูปเล็กมากหลายร้อยรูปยังไม่ถึง 10MB)
- จดการผูกรูปไว้ที่เอกสารรูป (`donation_id`) แทนการค้นใน `donation.photos` เพราะ index ของ CouchDB ค้นค่าใน array ได้ไม่ดี · BFF อ่านรูปตาม `_id` ได้ทันที และ worker ค้นรูปกำพร้าด้วย index ได้
- ไม่แสดงรูปบนหน้าติดตาม เพราะหน้าติดตามอ่านจาก public plane (FastAPI อ่าน CouchDB ไม่ได้) ต้องสร้าง read path ใหม่ และรูปอาจมีข้อมูลส่วนตัว
- ใช้ทางเดียวกับรูปลงทะเบียนล่วงหน้า (BFF → `public_writer` → `image:{ulid}`) เพราะ wizard รู้ศูนย์ปลายทางตั้งแต่ก่อนถึงฟอร์ม ไม่ต้อง sync รูปผ่าน worker

## Decision log

- 2026-10-17 — เจ้าของโครงการ: ทั้งใบ · ไม่จำกัดจำนวนแต่จำกัดขนาด (ต้นฉบับ ≤ 20MB/รูป, รวมทั้งใบ ≤ 10MB หลังย่อ) · เฉพาะของพิมพ์เอง · ไม่โชว์บนหน้าติดตาม · ลบรูปกำพร้าหลัง 24 ชม.
- 2026-10-18 — proposed (track ด้วย CR file แยก branch)
- 2026-10-18 — เจ้าของโครงการ: **สูงสุด 30 รูปต่อใบ** (แทน "ไม่จำกัดจำนวน") ตามที่ review PR #679 ยกเรื่องคำขอที่มี id รูปจำนวนมาก
- 2026-10-18 — แก้ตาม review PR #679: schema_v เรียงต่อ CR-172 · ผูกรูปกับใบด้วย `image.donation_id` + Mango index สำหรับลบรูปกำพร้า (FR-10, FR-11a, FR-16) · writer ของ `image` ทุกจุดเขียน schema_v 2 · รูปไม่ตามไปเมื่อส่งต่อศูนย์ (FR-13a) · error code ของ 422 · ใช้ `detectImageMime` ร่วม
- 2026-10-18 — เจ้าของโครงการ: แนบรูปได้ตอนจองเท่านั้น แก้ใบภายหลังไม่เปลี่ยนรูป (FR-3a) · รูปที่หายแสดง "รูปไม่พร้อมใช้" (FR-13b) · รูปของใบที่จบแล้ว (ยกเลิก/ปฏิเสธ/หมดอายุ) **เก็บไว้ก่อน** ไม่ลบในรอบนี้ — ทบทวนนโยบายเก็บรูปภายหลัง
- 2026-10-19 — แก้ตาม review รอบ 2 PR #679: partial index สำหรับรูปที่ยังไม่ผูกกับใบ (FR-16) · `couch_birth.py` อยู่ในรายการ writer ของ `image` · schema_v donation 7 → 8 หลัง CR-174 · limiter 60 ครั้ง/นาที/IP (FR-9) · `savePublicBookingImage` รับ `purpose` · 409 ตอนผูกรูปลองใหม่ 3 ครั้ง ไม่สำเร็จให้ loop inbound ลองซ้ำด้วย `DonationBuffer.photos_linked` (FR-11a) · คืน `photo_id`
- 2026-10-20 — approved โดย Soravit Sukkarn (Team Lead) รันเลข CR-175 ย้ายเข้าหมวด `04-donation/`
- 2026-10-23 — **Superseded (rate limit) by [CR-188](../01-core/CR-188-rate-limit-to-nginx.md):** FR-9 (limiter อัปโหลดรูป 60 ครั้ง/นาที/IP ใน BFF) ถูกยกเลิกก่อน implement — ใช้ nginx zone `public_write`
