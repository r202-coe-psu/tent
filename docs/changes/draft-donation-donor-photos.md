---
id: draft
title: "ผู้บริจาคแนบรูปของบริจาค (ทั้งใบ) และแสดงให้เจ้าหน้าที่ดูตอนประเมิน/ตรวจรับ"
status: proposed
date: 2026-10-18
requested_by: "เจ้าของโครงการ — issue #678 (ขอบเขตตัดสินแล้ว 2026-10-17)"
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/data/schema.md §2.3 `donation` — field ใหม่ `photos`
  - schema_v donation 5 → 6 (หรือเลขถัดไป — เรียงกับ draft-donation-reject-reason และ draft-donation-campaign-auto-approve)
  - docs/data/schema.md §1.6 `image` — field ใหม่ `purpose`, writer ใหม่ (public donation), ขนาดรูปของบริจาค
  - schema_v image 1 → 2
  - docs/data/api-contract.md — BFF `POST /api/public/v1/donations/photos`, `photos` ใน `POST /public/v1/donations`
  - docs/features/public-tier-donation-spec.html — ช่องแนบรูป (ไม่เปิดให้ public อ่านรูป)
  - frontend/src/routes/api/public/v1/donations/ (BFF ใหม่ + POST booking) · lib/features/public-register/save-public-booking-image.server.ts · lib/utils/image-compress.ts
  - frontend/src/lib/components/form/form-donor.svelte · lib/components/pending-review-detail.svelte · stock-donations/components/scan-station.svelte
  - backend/apiapp/modules/donations (schemas, create) · packages/tent-model (DonationBuffer)
  - worker/src/worker/inbound/donations.py · worker retention (ลบรูปที่ไม่ถูกใช้)
why: เจ้าหน้าที่ประเมินของบริจาคที่ผู้บริจาคพิมพ์เองได้จากชื่ออย่างเดียว ไม่เห็นสภาพของจริง
migration: field ใหม่ optional ทั้งสอง doc type — doc เดิมไม่ต้อง backfill
---

# ผู้บริจาคแนบรูปของบริจาค และเจ้าหน้าที่เห็นตอนประเมิน/ตรวจรับ

## สรุป

- **เปลี่ยน:** ฟอร์มบริจาคแบบพิมพ์เองมีช่องแนบรูป (ทั้งใบ ไม่บังคับ) · เจ้าหน้าที่เห็นรูปในหน้าประเมินและหน้าตรวจรับ
- **เพื่อ:** เจ้าหน้าที่ตัดสินใจรับ/ไม่รับได้จากสภาพของจริงก่อนของมาถึง
- **dev ต้อง build:** BFF อัปโหลดรูป (ใช้ทางเดียวกับรูปลงทะเบียนล่วงหน้า → doc `image:{ulid}` ใน shelter DB) · `donation.photos` · ช่องแนบรูปในฟอร์ม · แถบรูปฝั่งเจ้าหน้าที่ · worker ลบรูปที่ไม่ได้ใช้หลัง 24 ชม.
- **กระทบ:** `donation` schema_v +1 · `image` schema_v 1 → 2 · ผู้บริจาคไม่เห็นรูปบนหน้าติดตาม

## Requirements

### ขอบเขตการแนบ
- **FR-1** — ช่องแนบรูปมีเฉพาะการบริจาคที่ผู้บริจาคพิมพ์เอง (โหมด unsolicited) · โหมดเลือกจากแคมเปญไม่มีช่องนี้
- **FR-2** — แนบรูประดับใบ (`donation.photos: string[]` เก็บ `image:{ulid}`) ไม่ผูกกับรายการ
- **FR-3** — ไม่บังคับแนบ · ไม่จำกัดจำนวนรูป

### ขนาดรูป
- **FR-4** — ไฟล์ต้นฉบับที่เลือกได้ไม่เกิน **20MB ต่อรูป** (ตรวจในเครื่องผู้บริจาค)
- **FR-5** — ย่อในเครื่องผู้บริจาคก่อนส่ง: `full` WEBP ด้านยาวสุด **1600px** คุณภาพ 0.8 · `thumb` WEBP square-crop 200px
- **FR-6** — server ปฏิเสธ `full` ที่ใหญ่เกิน **1.5MB** หรือชนิดไฟล์ไม่ใช่รูป (ตรวจ magic bytes จริง ไม่เชื่อ `content-type`)
- **FR-7** — ขนาดรวมของรูปทั้งใบ (`full` + `thumb` ทุกรูป) ไม่เกิน **10MB** · ฟอร์มแสดงแถบ "ใช้ไปแล้ว X / 10 MB" และไม่ให้เลือกเพิ่มเมื่อเต็ม · BFF ตรวจซ้ำตอนกดจอง

### อัปโหลดและผูกกับใบจอง
- **FR-8** — BFF ใหม่ `POST /api/public/v1/donations/photos` (multipart: `shelter_code`, `full`, `thumb`) เขียน `image:{ulid}` ลง `shelter_{code}` ผ่าน `public_writer` (ใช้ `savePublicBookingImage` เดิม) ตั้ง `purpose: 'donation'` · คืน `image_id`
- **FR-9** — BFF อัปโหลดมี limiter ของตัวเอง (ไม่ใช้ `donationIpLimiter` ที่ 3 ครั้ง/นาที) และรับเฉพาะศูนย์ที่เปิดรับบริจาค
- **FR-10** — `POST /api/public/v1/donations` รับ `photos?: string[]` · BFF ตรวจทุก id ว่ามีอยู่ใน shelter DB นั้น, `purpose: 'donation'`, ยังไม่ถูกผูกกับใบอื่น และขนาดรวมไม่เกิน FR-7 · ไม่ผ่าน → 422
- **FR-11** — FastAPI `DonationCreateRequest` และ `DonationBuffer` เก็บ `photos` · worker inbound copy `photos` ลง CouchDB doc

### เจ้าหน้าที่
- **FR-12** — หน้าประเมิน (`pending-review-detail`) และหน้าตรวจรับแสดงแถบ thumbnail เมื่อใบมีรูป · กดแล้วเปิดรูปเต็ม (อ่านผ่าน session `/couch` ของเจ้าหน้าที่ — `imageRepository`)
- **FR-13** — ใบที่ไม่มีรูปไม่แสดงส่วนนี้

### ผู้บริจาค
- **FR-14** — หน้าติดตามสถานะ**ไม่แสดง**รูป และไม่มี public read path ของรูป
- **FR-15** — ฟอร์มมีข้อความเตือนว่ารูปอาจติดข้อมูลส่วนตัว (หน้าคน ทะเบียนรถ บ้านเลขที่)

### ลบรูปที่ไม่ได้ใช้
- **FR-16** — worker retention ลบ `image` ที่ `purpose: 'donation'` ซึ่งไม่มี donation ใดอ้างถึง และสร้างมานานกว่า **24 ชั่วโมง**

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| แนบรูปของบริจาค | ไม่มี (ช่องรูปถูกถอดออก — `form-donor.svelte:337-339`) | มี เฉพาะโหมดพิมพ์เอง |
| `donation` | ไม่มี field รูป | `photos: string[]` (opt) |
| `image` | ไม่มี `purpose` · `full` ≤1024px | `purpose` (opt) · รูปของบริจาค `full` ≤1600px |
| writer ของ `image` | staff onsite, public shelter booking, unassigned claim, kiosk | + public donation |
| ตรวจชนิดไฟล์ route สาธารณะ | ไม่ตรวจ magic bytes | ตรวจ (route ใหม่) |

## Acceptance

- **AC-1** — บริจาคแบบพิมพ์เองพร้อมรูป 2 รูป → เจ้าหน้าที่เห็น thumbnail ทั้ง 2 ในหน้าประเมินและหน้าตรวจรับ · กดแล้วเห็นรูปเต็ม
- **AC-2** — โหมดเลือกจากแคมเปญไม่มีช่องแนบรูป
- **AC-3** — เลือกรูปต้นฉบับ 25MB → ถูกปฏิเสธในฟอร์ม · รวมเกิน 10MB → เลือกเพิ่มไม่ได้
- **AC-4** — ส่ง id รูปของศูนย์อื่นหรือรูปที่ไม่ใช่ `purpose: 'donation'` ตอนจอง → 422
- **AC-5** — ไฟล์ที่ไม่ใช่รูป (เปลี่ยนนามสกุล) → อัปโหลดไม่ผ่าน
- **AC-6** — หน้าติดตามของผู้บริจาคไม่มีรูป
- **AC-7** — รูปที่อัปโหลดแล้วไม่ได้กดจอง ถูกลบหลัง 24 ชม. · รูปที่ผูกกับใบแล้วไม่ถูกลบ

## Impact

- **frontend:** BFF ใหม่ + limiter · POST booking ตรวจ `photos` · `image-compress.ts` รองรับขนาด 1600px · ฟอร์มผู้บริจาค · `DonationPhotoStrip` (`features/donations/ui`) ในหน้าประเมินและหน้าตรวจรับ · type `PendingDonationRow` / `ScanDonationView` + projection ฝั่ง back-office (`toPendingRow`, `toScanView`)
- **backend:** schemas + create + test · `pnpm openapi:update`
- **tent-model / worker:** `DonationBuffer.photos` · inbound copy · retention job ลบรูปกำพร้า + test
- **CouchDB:** `image` อยู่ใน allow-list ของ VDU แล้ว (`shelter-access-design.ts`) — ตรวจว่า `public_writer` เขียน `purpose` ได้
- **e2e:** จองแบบพิมพ์เองพร้อมรูป (fixture รูปเล็ก) → เจ้าหน้าที่เห็นรูป · helper จองแบบพิมพ์เองใช้ร่วมกับงาน #610

## Migration

- **`donation` schema_v +1:** `photos` optional → doc เดิมไม่ต้อง backfill · ไม่มี field = ไม่มีรูป · ลำดับเลขเรียงกับ CR ของ #621 และ #610 (ตัวที่อนุมัติก่อนได้เลขก่อน หรือรวมเป็น bump เดียวถ้าออกพร้อมกัน)
- **`image` schema_v 1 → 2:** `purpose` optional → doc เดิมไม่ต้อง backfill · ไม่มี `purpose` = รูปประเภทเดิม (ไม่ถูกลบโดย FR-16)

## Why

- ของที่ผู้บริจาคพิมพ์เองเจ้าหน้าที่ไม่รู้ว่าเป็นอะไรจริง รูปช่วยให้ประเมินได้ก่อนของมาถึง
- เฉพาะโหมดพิมพ์เอง เพราะของในแคมเปญข้ามการประเมินอยู่แล้ว (#610)
- จำกัดขนาดรวมแทนจำนวนรูป ตามที่เจ้าของโครงการกำหนด · 10MB หลังย่อ ≈ 20–50 รูป (ใบทั่วไป 2–3 รูปใช้ราว 1MB) จึงพอโดยไม่ทำให้ shelter DB โตเร็ว
- ไม่แสดงรูปบนหน้าติดตาม เพราะหน้าติดตามอ่านจาก public plane (FastAPI อ่าน CouchDB ไม่ได้) ต้องสร้าง read path ใหม่ และรูปอาจมีข้อมูลส่วนตัว
- ใช้ทางเดียวกับรูปลงทะเบียนล่วงหน้า (BFF → `public_writer` → `image:{ulid}`) เพราะ wizard รู้ศูนย์ปลายทางตั้งแต่ก่อนถึงฟอร์ม ไม่ต้อง sync รูปผ่าน worker

## Decision log

- 2026-10-17 — เจ้าของโครงการ: ทั้งใบ · ไม่จำกัดจำนวนแต่จำกัดขนาด (ต้นฉบับ ≤ 20MB/รูป, รวมทั้งใบ ≤ 10MB หลังย่อ) · เฉพาะของพิมพ์เอง · ไม่โชว์บนหน้าติดตาม · ลบรูปกำพร้าหลัง 24 ชม.
- 2026-10-18 — proposed (track ด้วย CR file แยก branch)
