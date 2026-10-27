---
id: draft
title: "ทะเบียนรถ (ไม่บังคับ) ตอนผู้บริจาคนำของมาส่งเอง — `logistics.vehicle_plate`"
status: proposed
date: 2026-10-26
updated: 2026-10-27
requested_by: "GitHub #823 (roleplay 23/10/69 feedback)"
decided_by: "owner"
layer: volatile
affects:
  - docs/data/schema.md §2.3 `donation` — field ใหม่ `logistics.vehicle_plate`; migration note
  - schema_v donation 7 → 8
  - docs/features/public-tier-donation-spec.html (ตาราง logistics, ตัวอย่าง payload)
  - frontend/src/lib/features/donations/domain (`donation.ts`, `public-donation.ts`, `back-office.ts`)
  - frontend/src/lib/features/operations/domain/operations.ts · worker/src/worker/inbound/donations.py (`DONATION_SCHEMA_V`)
  - frontend/src/lib/components (`form/donor-time-selection-form.svelte`, `public-donor-success-ticket.svelte`, `pending-review-detail.svelte`) · `routes/(public)/donations/donation.svelte.ts`
  - frontend/src/routes/api/back-office/donations/+server.ts · `routes/(protected)/back-office/stock-donations/components/scan-station.svelte`
  - dependency: PR `fix/donation-tracking-pii` (allowlist ของ tracking response) · `draft-donation-donor-pii-retention` (retention ของ PII ผู้บริจาค)
why: จุดรับของ/รปภ. ต้องตรวจรถที่มาส่งของ แต่ฟอร์มปัจจุบันเก็บแค่ประเภทรถ (GitHub #823)
migration: field ใหม่ optional — doc เดิมไม่ต้อง backfill; reader feature-detect ไม่ branch ตาม `schema_v`
---

# draft-donation-vehicle-plate — ทะเบียนรถ (ไม่บังคับ) ตอนนำของมาส่งเอง

## สรุป

- **เปลี่ยน:** เพิ่ม `donation.logistics.vehicle_plate` (ไม่บังคับ, free text ช่องเดียว ≤ 40) เฉพาะ `self_dropoff` ทุกประเภทรถ · แสดงบนตั๋วและ back-office (สแกน, รอประเมิน) · **ไม่**แสดงหน้าติดตาม
- **เพื่อ:** จุดรับของ/รปภ. ตรวจรถคันที่มาส่งได้
- **dev ต้อง build:** zod + type + ช่องในฟอร์ม + ตั๋ว + 2 หน้า back-office · `DONATION_SCHEMA_V` 7 → 8 (frontend + worker)
- **กระทบ:** schema.md §2.3 · ทะเบียนเป็น PII ผู้บริจาค · ต้อง merge หลัง allowlist ของ tracking response (`fix/donation-tracking-pii`) · FastAPI / Mongo / openapi ไม่ต้องแก้

## Requirements

**ข้อมูลและ validation**
- **FR-1** — `logistics.vehicle_plate`: free text ช่องเดียว · trim ก่อนตรวจ · ว่างหลัง trim = ไม่ส่ง key · ยาวสุด 40 ตัวอักษร (error `ทะเบียนรถยาวเกินไป`) · ไม่ตรวจรูปแบบ (พิมพ์ทะเบียน + จังหวัดในช่องเดียวได้) · ไม่บังคับ · ทุกประเภทรถรวม `motorcycle`
- **FR-1a** — `donationPreDeclarationInputSchema.logistics` ปฏิเสธ `vehicle_plate` เมื่อ `delivery_method` ≠ `self_dropoff` (path `['vehicle_plate']`)
- **FR-1b** — type `Donation.logistics` และ `PublicDonationDoc.logistics` เพิ่ม `vehicle_plate?: string`
- **FR-1c** — refine เดิมของ `vehicle` คงเดิม (อนุญาต `shelter_pickup`, ห้าม `parcel`)

**ฟอร์มผู้บริจาค**
- **FR-2** — ช่อง "ทะเบียนรถ (ถ้ามี)" แสดงต่อจากประเภทรถ เมื่อเลือก `self_dropoff` · ค่าเก็บใน `donationStore.vehiclePlate`
- **FR-2a** — payload ใส่ `vehicle_plate` เฉพาะเมื่อ `self_dropoff` และค่าหลัง trim ไม่ว่าง · สลับวิธีส่ง → ไม่ส่ง แต่ค่าใน store คงอยู่ (กลับมา `self_dropoff` เห็นค่าเดิม)

**การแสดงผล**
- **FR-3a** — ตั๋วหลังจองแสดงทะเบียนอย่างเดียว (ไม่แสดงประเภทรถ) เมื่อ `self_dropoff` และมีค่า · อ่านจาก `donationStore` ไม่ fetch ใหม่
- **FR-3b** — หน้าสแกน (`scan-station`) แสดงทะเบียนข้างประเภทรถเมื่อ `logistics.vehicle_plate` มีค่า
- **FR-3c** — หน้ารอประเมิน (`pending-review-detail`) แสดงทะเบียนข้างประเภทรถ · `PendingDonationRow.vehicle_plate?: string | null` · list route map `d.logistics?.vehicle_plate ?? null`
- **FR-3d** — doc ที่ไม่มีทะเบียนแสดงเหมือนเดิม ไม่มีข้อความ "ไม่ระบุ" ใหม่

**หน้าติดตาม (dependency)**
- **FR-4** — PR ของ CR นี้ merge **หลัง** allowlist ของ tracking response จาก PR `fix/donation-tracking-pii` อยู่บน `develop` (allowlist `logistics` = `delivery_method`, `vehicle`, `slot`, `eta`, `courier_tracking_no`, `pickup_address`) · CR นี้ไม่เขียน allowlist เอง · ห้ามเพิ่ม `vehicle_plate` เข้า allowlist

**PII และ schema version**
- **FR-5** — `vehicle_plate` เป็น PII ผู้บริจาค อยู่ใต้ retention ของ `draft-donation-donor-pii-retention` (CR นี้ไม่กำหนด retention เอง) · CR retention ต้องรวม field นี้
- **FR-6** — `donation.schema_v` 7 → 8 · `DONATION_SCHEMA_V` frontend = worker = 8 · reader feature-detect field ห้าม branch ตาม `schema_v`

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ข้อมูลรถใน `logistics` | `vehicle` (ประเภทรถ) | `vehicle` + `vehicle_plate?` (เฉพาะ `self_dropoff`) |
| ฟอร์ม "นำมาส่งด้วยตนเอง" | เลือกประเภทรถ | + ช่อง "ทะเบียนรถ (ถ้ามี)" |
| ตั๋ว / back-office | ไม่แสดงรถ (ตั๋ว) · ประเภทรถ (back-office) | + ทะเบียนรถ |
| หน้าติดตาม | — | ไม่แสดงทะเบียน (allowlist) |
| `donation.schema_v` | 7 | 8 |

## Acceptance

- **AC-1** — `self_dropoff` + "กข 1234" → ผ่าน validation, ถึง FastAPI, อยู่ใน `logistics` ของ CouchDB doc
- **AC-2** — ทะเบียน 41 ตัวขึ้นไป → ปฏิเสธด้วย `ทะเบียนรถยาวเกินไป` (40 ผ่าน)
- **AC-3** — `parcel` หรือ `shelter_pickup` พร้อมทะเบียน → ปฏิเสธ
- **AC-4** — whitespace ล้วน → omit ไม่ปฏิเสธ
- **AC-5** — สลับวิธีส่งจาก `self_dropoff` → payload ไม่มีทะเบียน · สลับกลับ → ช่องยังมีค่าเดิม
- **AC-6** — response ของ tracking BFF ไม่มี `vehicle_plate` และยังมีทุก field ใน allowlist (ทั้งแหล่ง CouchDB และ FastAPI fallback)
- **AC-7** — ผู้ที่ไม่ใช่บทบาทคลังเรียก back-office GET → 403
- **AC-8** — doc v7 (ไม่มีทะเบียน) และ v8 (มีทะเบียน) แสดงถูกในทุก reader (ตั๋ว, สแกน, รอประเมิน, ติดตาม)
- **AC-9** — `DONATION_SCHEMA_V` ของ frontend และ worker = 8

## Impact

- **Gate:** implement ได้เมื่อ CR approve · merge ได้เมื่อ allowlist (FR-4) อยู่บน `develop` แล้ว · ไม่ต้องรอ `draft-donation-donor-pii-retention` merge
- **ไม่ต้องแก้:** FastAPI (`logistics: dict[str, Any]`), `DonationBuffer`, openapi types, worker inbound (copy `logistics` ทั้งก้อน — แก้แค่ `DONATION_SCHEMA_V`), projector `public_donations` (ไม่ project `logistics`), CouchDB VDU
- **ทะเบียนอยู่ที่ไหน:** Mongo `DonationBuffer` (ชั่วคราว, purge ทั้งแถวหลัง sync) · CouchDB `donation` (ตาม retention CR) · back-office BFF (`authorizeWarehouse`) · backup (ตาม retention CR) · **ไม่อยู่**ใน `PublicDonation`, tracking response, audit, log
- **mixed-version:** worker v7 + frontend ใหม่ → doc มีทะเบียนแต่ stamp 7 (อ่านได้เพราะ reader ไม่ดู `schema_v`) · worker v8 + frontend เก่า → stamp 8 ไม่มีทะเบียน · rollback frontend ไม่ทำทะเบียนหาย (`Math.max` ไม่ลด `schema_v`) · version ก่อน `fix/donation-tracking-pii` ห้ามเป็น rollback target เมื่อมี doc ที่มีทะเบียน

## Migration

- `schema_v` 7 → 8: field optional → ไม่ backfill · ไม่มีทะเบียน = ไม่มี field · donation สาธารณะใหม่เขียน 8
- ไม่มี migration ของ Mongo · ไม่ bump `PROJECTION_VERSION`
- **ลำดับ `schema_v`:** CR-175 และ CR-196 จอง 7 → 8 ไว้ (ยังไม่ implement บน `develop`) — ตามมติ Team Lead ใน CR-196 PR ที่ merge ก่อนได้เลขถัดไป · ใบอื่น merge ก่อน → CR นี้ขยับเป็น 9 ทั้ง frontend, worker และ test
- schema.md §2.3 และ `public-tier-donation-spec.html` แก้ตอน approve + รันเลข (`docs/change-management.md` §3)

## Why

- ประเภทรถอย่างเดียวระบุรถคันจริงไม่ได้
- ไม่บังคับ — บางรายไม่มีทะเบียนหรือไม่ต้องการให้ข้อมูล
- ไม่รวม `shelter_pickup` — รถที่ไปรับเป็นรถของศูนย์
- ทะเบียนระบุตัวบุคคลได้ → กันจากหน้าสาธารณะด้วย allowlist และผูกกับ retention เดียวกับ PII ผู้บริจาคอื่น (ชื่อ, เบอร์, LINE, อีเมล)
- ตัดทิ้ง: บังคับกรอก · แสดงบนหน้าติดตาม · สองช่อง (ทะเบียน + dropdown จังหวัด 77) · สามช่องมี validation · ช่องเดียว ≤ 20 · flag `config:app` ให้ SA เปิดปิด + endpoint `donation-settings` (เกินขอบเขต #823 — PII ผู้บริจาคอื่นเก็บโดยไม่มี flag และการรั่วทางหน้าติดตามปิดด้วย allowlist แล้ว)

## Decision log

- 2026-10-26 — owner: field `logistics.vehicle_plate`; ไม่บังคับ; เฉพาะ `self_dropoff`; รถทุกประเภทรวมมอเตอร์ไซค์
- 2026-10-26 — owner: ทะเบียนเป็น PII ผู้บริจาค อยู่ใต้ retention policy (CR แยก)
- 2026-10-26 — owner: `donation.schema_v` 7 → 8
- 2026-10-26 — owner: ตั๋วแสดงทะเบียนอย่างเดียว ไม่แสดงประเภทรถ
- 2026-10-26 — owner: คง allowance เดิมของ `vehicle` กับ `shelter_pickup`; `vehicle_plate` ห้ามทั้ง `shelter_pickup` และ `parcel`
- 2026-10-26 — owner: allowlist ของ tracking response ทำใน PR แยก `fix/donation-tracking-pii`; CR นี้ขึ้นกับ PR นั้น
- 2026-10-27 — owner: ช่องเดียว free text trim ≤ 40 ว่าง = omit
- 2026-10-27 — ลดขอบเขตให้ตรง #823: ตัด flag `config:app.donation_vehicle_plate_enabled` และ endpoint `donation-settings` · merge หลัง allowlist แทนการคุมด้วย flag
