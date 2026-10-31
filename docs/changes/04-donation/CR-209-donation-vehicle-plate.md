---
id: CR-209 # renumbered from draft-donation-vehicle-plate
title: "ทะเบียนรถ (ไม่บังคับ) ตอนผู้บริจาคนำของมาส่งเอง — `logistics.vehicle_plate`"
status: approved
date: 2026-10-26
updated: 2026-10-29 # approved (Soravit Sukkarn, Team Lead)
requested_by: "Verse (William)"
decided_by: "Soravit Sukkarn (Team Lead)"
decision_date: 2026-10-29
layer: volatile
affects:
  - docs/data/schema.md §2.3 `donation` — field ใหม่ `logistics.vehicle_plate`; migration note
  - schema_v donation 9 → 10 (เลขถัดไปตอน merge — 8 = CR-196, 9 = CR-175)
  - docs/features/public-tier-donation-spec.html (ตาราง logistics, ตัวอย่าง payload)
  - frontend/src/lib/features/donations/domain (`donation.ts`, `public-donation.ts`, `back-office.ts`)
  - frontend/src/lib/features/operations/domain/operations.ts · worker/src/worker/inbound/donations.py (`DONATION_SCHEMA_V`)
  - frontend/src/lib/components (`form/donor-time-selection-form.svelte`, `public-donor-success-ticket.svelte`, `pending-review-detail.svelte`) · `routes/(public)/donations/donation.svelte.ts`
  - frontend/src/routes/api/back-office/donations/+server.ts · `routes/(protected)/back-office/stock-donations/components/scan-station.svelte`
  - frontend/src/routes/api/public/v1/donations/[tracking_token]/+server.ts (tracking response — เกี่ยวข้อง #927)
  - backend/apiapp/modules/donations/schemas.py (validator `logistics.vehicle_plate`, FR-1d) · backend/tests/test_donations.py
  - docs/data/api-contract.md (response ของ API ติดตามใบ: `donor` / `logistics` ตาม allowlist)
why: จุดรับของ/รปภ. ต้องตรวจรถที่มาส่งของ แต่ฟอร์มปัจจุบันเก็บแค่ประเภทรถ (GitHub #823)
migration: field ใหม่ optional — doc เดิมไม่ต้อง backfill; reader feature-detect ไม่ branch ตาม `schema_v`
---

# CR-209 — ทะเบียนรถ (ไม่บังคับ) ตอนนำของมาส่งเอง

## สรุป

- **เปลี่ยน:** เพิ่ม `donation.logistics.vehicle_plate` (ไม่บังคับ, free text ช่องเดียว ≤ 40) เฉพาะ `self_dropoff` ทุกประเภทรถ · แสดงบนตั๋วและ back-office (สแกน, รอประเมิน) · **ไม่**แสดงหน้าติดตาม
- **เพื่อ:** จุดรับของ/รปภ. ตรวจรถคันที่มาส่งได้
- **dev ต้อง build:** zod + type + ช่องในฟอร์ม + ตั๋ว + 2 หน้า back-office · `DONATION_SCHEMA_V` 9 → 10 (frontend + worker)
- **กระทบ:** schema.md §2.3 · ทะเบียนเป็น PII ผู้บริจาค · ทะเบียนต้องไม่อยู่ใน response ของ API ติดตามใบ · FastAPI ตรวจ `logistics.vehicle_plate` ด้วยกฎเดียวกับ BFF (FR-1d) · Mongo / openapi ไม่ต้องแก้

## Requirements

**ข้อมูลและ validation**
- **FR-1** — `logistics.vehicle_plate`: free text ช่องเดียว · trim ก่อนตรวจ · ว่างหลัง trim = ไม่ส่ง key · ยาวสุด 40 ตัวอักษร (error `ทะเบียนรถยาวเกินไป`) · ไม่ตรวจรูปแบบ (พิมพ์ทะเบียน + จังหวัดในช่องเดียวได้) · ไม่บังคับ · ทุกประเภทรถรวม `motorcycle`
- **FR-1a** — `donationPreDeclarationInputSchema.logistics` ปฏิเสธ `vehicle_plate` เมื่อ `delivery_method` ≠ `self_dropoff` (path `['vehicle_plate']`)
- **FR-1b** — type `Donation.logistics` และ `PublicDonationDoc.logistics` เพิ่ม `vehicle_plate?: string`
- **FR-1c** — refine เดิมของ `vehicle` คงเดิม (อนุญาต `shelter_pickup`, ห้าม `parcel`)
- **FR-1d** — FastAPI `POST /public/v1/donations` ตรวจ `logistics.vehicle_plate` ด้วยกฎเดียวกับ FR-1 / FR-1a (trim, ว่าง = ไม่เก็บ key, ≤ 40, เฉพาะ `self_dropoff`) → ผิดกฎตอบ 422 · ไม่พึ่ง BFF ที่เดียว

**ฟอร์มผู้บริจาค**
- **FR-2** — ช่อง "ทะเบียนรถ (ถ้ามี)" แสดงต่อจากประเภทรถ เมื่อเลือก `self_dropoff` · ค่าเก็บใน `donationStore.vehiclePlate`
- **FR-2a** — payload ใส่ `vehicle_plate` เฉพาะเมื่อ `self_dropoff` และค่าหลัง trim ไม่ว่าง · สลับวิธีส่ง → ไม่ส่ง แต่ค่าใน store คงอยู่ (กลับมา `self_dropoff` เห็นค่าเดิม)

**การแสดงผล**
- **FR-3a** — ตั๋วหลังจองแสดงทะเบียนอย่างเดียว (ไม่แสดงประเภทรถ) เมื่อ `self_dropoff` และมีค่า · อ่านจาก `donationStore` ไม่ fetch ใหม่ · `donationStore` อยู่ในหน่วยความจำของหน้าเท่านั้น ⇒ refresh / ปิดแท็บแล้วหน้า `/donations` กลับไปขั้นแรก ตั๋วและทะเบียนไม่แสดงอีก (ผู้บริจาคแคปเก็บก่อนออกจากหน้า) · ดูใบภายหลังได้ทางหน้าติดตามซึ่งไม่แสดงทะเบียน (FR-4)
- **FR-3b** — หน้าสแกน (`scan-station`) แสดงทะเบียนข้างประเภทรถเมื่อ `logistics.vehicle_plate` มีค่า
- **FR-3c** — หน้ารอประเมิน (`pending-review-detail`) แสดงทะเบียนข้างประเภทรถ · `PendingDonationRow.vehicle_plate?: string | null` · list route map `d.logistics?.vehicle_plate ?? null`
- **FR-3d** — doc ที่ไม่มีทะเบียนแสดงเหมือนเดิม ไม่มีข้อความ "ไม่ระบุ" ใหม่

**หน้าติดตาม**
- **FR-4** — response ของ API ติดตามใบ (`GET /api/public/v1/donations/{tracking_token}`) ต้องไม่มี `vehicle_plate` · `logistics` ที่ส่งกลับมีได้เฉพาะ `delivery_method`, `vehicle`, `slot` (`date` / `from` / `to`), `eta`, `courier_tracking_no`, `pickup_address` · **PR โค้ดของ CR นี้ทำเอง:** allowlist ใน BFF `[tracking_token]/+server.ts` จุดเดียว ครอบทั้งข้อมูลจาก CouchDB และ FastAPI fallback (FastAPI ส่ง `logistics` ทั้งก้อนต่อไป ไม่ต้องแก้) · ก่อนแก้ `develop` ส่ง `logistics` ทั้งก้อน
- **FR-4b** — `donor` ใน response เดียวกันก็ใช้ allowlist: มีได้เฉพาะ `name` และ `phone_masked` (`***-***-1234` — ปิดเบอร์ของ doc ใน CouchDB ด้วยรูปเดียวกับที่ FastAPI ส่ง) · ไม่ส่ง `phone`, `phone_hash`, `line_id`, `email` ทั้งจาก CouchDB และ FastAPI fallback · หน้าติดตามแสดงแค่ชื่อและเบอร์ที่ปิดอยู่แล้ว

**PII และ schema version**
- **FR-5** — `vehicle_plate` เป็น PII ผู้บริจาค อยู่ใต้ retention เดียวกับ PII ผู้บริจาคอื่น (ชื่อ, เบอร์, LINE, อีเมล) ตาม `docs/data/data-model.md` §7 (ลบภายใน 3 เดือนหลังปิดศูนย์) · CR นี้ไม่กำหนด retention เอง · **สถานะจริง:** ยังไม่มีงานลบ donor PII ใน CouchDB `donation` อัตโนมัติ — ทะเบียนจึงถูกเก็บเท่ากับชื่อ / เบอร์ที่มีอยู่ตอนนี้ · worker ลบ Mongo `DonationBuffer` ทั้งแถว (ทะเบียนหายไปด้วย)
- **FR-6** — `donation.schema_v` 9 → 10 · `DONATION_SCHEMA_V` frontend = worker = 10 · reader feature-detect field ห้าม branch ตาม `schema_v`

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ข้อมูลรถใน `logistics` | `vehicle` (ประเภทรถ) | `vehicle` + `vehicle_plate?` (เฉพาะ `self_dropoff`) |
| ฟอร์ม "นำมาส่งด้วยตนเอง" | เลือกประเภทรถ | + ช่อง "ทะเบียนรถ (ถ้ามี)" |
| ตั๋ว / back-office | ไม่แสดงรถ (ตั๋ว) · ประเภทรถ (back-office) | + ทะเบียนรถ |
| API ติดตามใบ | ส่ง `logistics` ทั้งก้อน | ไม่มีทะเบียน (FR-4) |
| `donation.schema_v` | 9 | 10 |

## Acceptance

- **AC-1** — `self_dropoff` + "กข 1234" → ผ่าน validation, ถึง FastAPI, อยู่ใน `logistics` ของ CouchDB doc
- **AC-2** — ทะเบียน 41 ตัวขึ้นไป → ปฏิเสธด้วย `ทะเบียนรถยาวเกินไป` (40 ผ่าน)
- **AC-3** — `parcel` หรือ `shelter_pickup` พร้อมทะเบียน → ปฏิเสธ
- **AC-4** — whitespace ล้วน → omit ไม่ปฏิเสธ
- **AC-5** — สลับวิธีส่งจาก `self_dropoff` → payload ไม่มีทะเบียน · สลับกลับ → ช่องยังมีค่าเดิม
- **AC-6** — response ของ API ติดตามใบไม่มี `vehicle_plate` และยังมี field `logistics` ตาม FR-4 (ทั้งแหล่ง CouchDB และ FastAPI fallback)
- **AC-6b** — response ของ API ติดตามใบมี `donor` แค่ `name` + `phone_masked` · ไม่มีเบอร์เต็ม, `phone_hash`, `line_id`, `email` (ทั้งสองแหล่ง)
- **AC-7** — ผู้ที่ไม่ใช่บทบาทคลังเรียก back-office GET → 403
- **AC-8** — doc ก่อน v10 (ไม่มีทะเบียน) และ v10 (มีทะเบียน) แสดงถูกในทุก reader (ตั๋ว, สแกน, รอประเมิน, ติดตาม)
- **AC-9** — `DONATION_SCHEMA_V` ของ frontend และ worker = 10

## Impact

- **Gate:** implement ได้เมื่อ CR approve · PR โค้ดของ CR นี้ implement FR-4 เอง และต้องผ่าน AC-6 ก่อน merge
- **FastAPI:** `DonationCreateRequest.logistics` ยังเป็น `dict` (openapi ไม่เปลี่ยน) แต่มี validator ของ `vehicle_plate` ตาม FR-1d
- **ไม่ต้องแก้:** `DonationBuffer`, openapi types, worker inbound (copy `logistics` ทั้งก้อน — แก้แค่ `DONATION_SCHEMA_V`), projector `public_donations` (ไม่ project `logistics`), CouchDB VDU
- **ทะเบียนอยู่ที่ไหน:** Mongo `DonationBuffer` (ชั่วคราว, purge ทั้งแถวหลัง sync) · CouchDB `donation` (ตาม data-model §7 — ยังไม่มีงานลบอัตโนมัติ, FR-5) · back-office BFF (`authorizeWarehouse`) · backup (ตาม data-model §7) · **ไม่อยู่**ใน `PublicDonation`, tracking response, audit, log
- **mixed-version:** worker v9 + frontend ใหม่ → doc มีทะเบียนแต่ stamp 9 (อ่านได้เพราะ reader ไม่ดู `schema_v`) · worker v10 + frontend เก่า → stamp 10 ไม่มีทะเบียน · rollback frontend ไม่ทำทะเบียนหาย (`Math.max` ไม่ลด `schema_v`) · เมื่อมี doc ที่มีทะเบียนแล้ว ห้าม rollback ไปเวอร์ชันที่ API ติดตามใบยังส่ง `logistics` ทั้งก้อน

## Migration

- `schema_v` 9 → 10: field optional → ไม่ backfill · ไม่มีทะเบียน = ไม่มี field · donation สาธารณะใหม่เขียน 10
- ไม่มี migration ของ Mongo · ไม่ bump `PROJECTION_VERSION`
- **ลำดับ `schema_v`:** CR-175 (#957), CR-196 (#956), CR-206 และ CR นี้ต่างจองเลขถัดจาก 7 — ตามมติใน CR-196 PR ที่ merge ก่อนได้เลขก่อน · CR นี้ใช้ **เลขถัดไปจาก `DONATION_SCHEMA_V` บน `develop` ตอน merge** (ตอนร่าง = 8; ตอน merge = 10 หลัง CR-196 / CR-175) ทั้ง frontend, worker, test และ schema.md · ถ้า CR-206 merge ก่อนและเพิ่ม key ใน `logistics` ที่ต้องแสดงบนหน้าติดตาม ต้องเพิ่ม key นั้นใน allowlist ของ FR-4
- schema.md §2.3, `public-tier-donation-spec.html` และ `data-model.md` §7 แก้ใน PR โค้ดของ CR นี้

## Why

- ประเภทรถอย่างเดียวระบุรถคันจริงไม่ได้
- ไม่บังคับ — บางรายไม่มีทะเบียนหรือไม่ต้องการให้ข้อมูล
- ไม่รวม `shelter_pickup` — รถที่ไปรับเป็นรถของศูนย์
- ทะเบียนระบุตัวบุคคลได้ → กันจาก API ติดตามใบ (FR-4) และผูกกับ retention เดียวกับ PII ผู้บริจาคอื่น (ชื่อ, เบอร์, LINE, อีเมล)
- ตัดทิ้ง: บังคับกรอก · แสดงบนหน้าติดตาม · สองช่อง (ทะเบียน + dropdown จังหวัด 77) · สามช่องมี validation · ช่องเดียว ≤ 20 · flag `config:app` ให้ SA เปิดปิด + endpoint `donation-settings` (เกินขอบเขต #823 — PII ผู้บริจาคอื่นเก็บโดยไม่มี flag และการรั่วทางหน้าติดตามกันด้วย FR-4)

## Decision log

- 2026-10-26 — proposed (Team D): field `logistics.vehicle_plate`; ไม่บังคับ; เฉพาะ `self_dropoff`; รถทุกประเภทรวมมอเตอร์ไซค์
- 2026-10-26 — proposed (Team D): ทะเบียนเป็น PII ผู้บริจาค อยู่ใต้ retention policy (CR แยก)
- 2026-10-26 — proposed (Team D): `donation.schema_v` 7 → 8
- 2026-10-26 — proposed (Team D): ตั๋วแสดงทะเบียนอย่างเดียว ไม่แสดงประเภทรถ
- 2026-10-26 — proposed (Team D): คง allowance เดิมของ `vehicle` กับ `shelter_pickup`; `vehicle_plate` ห้ามทั้ง `shelter_pickup` และ `parcel`
- 2026-10-27 — proposed (Team D): ช่องเดียว free text trim ≤ 40 ว่าง = omit
- 2026-10-27 — proposed (Team D): ลดขอบเขตให้ตรง #823: ตัด flag `config:app.donation_vehicle_plate_enabled` และ endpoint `donation-settings` · กันทะเบียนจาก API ติดตามใบ (FR-4) แทนการคุมด้วย flag
- 2026-10-28 — ตัดสินโดย Jackyzaz (คำถาม 1–3 ใน PR #962 · ข้อตั๋วตอบใน [คอมเมนต์ข้อ 6](https://github.com/r202-coe-psu/tent/pull/974#issuecomment-6468911552)) เห็นด้วยตามที่เสนอ:
  1. ช่องทะเบียนไม่บังคับ · free text ช่องเดียว ≤ 40 ตัวอักษร (FR-1)
  2. ถามทะเบียนเฉพาะ `self_dropoff` ไม่ถามตอน `shelter_pickup` / `parcel` (FR-1a, FR-2)
  3. ทะเบียนเห็นได้เฉพาะเจ้าหน้าที่คลังในหน้าหลังบ้าน (สแกนรับของ, รอประเมิน) และตั๋วหลังจองเสร็จ (ให้ผู้บริจาคแคปเก็บไว้) · **ห้าม**แสดงหรือส่งทางหน้าติดตามสถานะ / API ติดตามใบ (FR-3a–FR-3c, FR-4)
- 2026-10-29 — approved by Soravit Sukkarn (Team Lead) · รันเลข CR-209 (renumbered from draft-donation-vehicle-plate) ย้ายเข้า 04-donation/
- 2026-10-29 — ชี้แจงถ้อยคำตามรีวิว PR #962 ไม่เปลี่ยนมติ: FR-4 ทำใน PR โค้ดของ CR นี้ (Gate) · FR-5 อ้าง data-model §7 และสถานะการลบจริง · ลำดับ `schema_v` นับ CR-206 และใช้เลขถัดไปตอน merge · FR-3a ตั๋วหลัง refresh
- 2026-10-29 — แก้ตามรีวิว PR #1017: `schema_v` เป็น 9 → 10 (CR-196 = 8 และ CR-175 = 9 merge ก่อน — ตามกติกาเลขถัดไปตอน merge) · บันทึก allowlist ของ `donor` ในหน้าติดตาม (FR-4b, AC-6b) ที่ PR โค้ดทำเพิ่ม เพราะ CouchDB doc ส่งเบอร์เต็ม / `phone_hash` / LINE / อีเมล ออกไปก่อนแก้ · FastAPI ตรวจ `logistics.vehicle_plate` ด้วยกฎเดียวกับ BFF (FR-1d)
