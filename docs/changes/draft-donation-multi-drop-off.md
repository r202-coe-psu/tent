---
id: draft
title: บริจาคครั้งเดียวแยกส่งหลายจุดรับบริจาค — ระบุจุดต่อรายการ และรับของทีละจุด
status: proposed
date: 2026-10-27
updated: 2026-10-28
requested_by: "Kunanon Nusaeng — feedback จาก demo 2026-10-23 (epic #825, issue #813)"
decided_by: ""
layer: volatile
depends_on: "CR-205-storage-drop-off-points (#812, PR #944 · อนุมัติ 2026-10-28 — ต่อยอด `donations/domain/drop-off.ts` ของ #926) — ต้อง implement ก่อน"
affects:
  - docs/data/schema.md §2.3 `donation` — field ใหม่ `items[].drop_off_point_id`, `point_receipts[]`, `received_summary.closed_by` / `closed_reason` · `received_summary` ของใบที่มีจุดเขียนตอนปิดใบ · กติการับของทีละจุด / ปิดใบ / หมดอายุ · donation schema_v 7 → เลขถัดไปตอน merge (ดู §ลำดับ schema_v)
  - docs/data/couchdb-mongodb-sync.md §3.2 `public_donations` (`items_declared[].drop_off_point_id`, `point_receipts[]`) · bump PROJECTION_VERSION
  - docs/data/api-contract.md §5 — `POST /public/v1/donations` (error ใหม่ `400 UNKNOWN_DROP_OFF_POINT`), `GET /public/v1/donations/{tracking_token}`, `PATCH /public/v1/donations/{tracking_token}/items`, `DELETE /public/v1/donations/{tracking_token}` (`409 GOODS_IN_STOCK` ครอบคลุมใบที่รับไปบางจุด)
  - docs/changes/04-donation/CR-087-donation-redirect-target.md (redirect ล้างจุด · ห้าม redirect ใบที่รับไปบางจุดแล้ว)
  - docs/changes/03-C-supply/CR-143-stock-redesign-rules.md §B — FR-B4a (audit id ต่อชุดรายการ) · FR-B4b (batch receive ปฏิเสธใบที่มีจุด)
  - docs/changes/04-donation/CR-172-donation-reject-reason.md FR-12 (สถานะใบคิดตอนปิดใบ)
  - docs/changes/04-donation/CR-196-donation-line-key.md FR-LK-10 (ยกเลิกไม่ได้เมื่อรับไปบางจุดแล้ว)
  - docs/changes/00-baseline/CR-205-storage-drop-off-points.md §Change แถว "เอาติ๊กออก หรือลบจุด" (คำว่า "จุดหลัก" → ตาม FR-MP-16)
  - docs/features/public-tier-donation-spec.html (ฟอร์มจองเลือกจุดต่อรายการ)
  - backend/apiapp/modules/donations (schemas.py `DonationItemInput`, use_case.py `create`) · backend/tests/test_donations.py
  - packages/tent-model/src/tent_model/public_donation.py (`DeclaredItem`, `PublicDonation.point_receipts`)
  - worker/src/worker/inbound/donations.py (`DONATION_SCHEMA_V`) · worker/src/worker/projectors/donation.py · worker/src/worker/projection_version.py · worker/src/worker/quota/expiry.py · worker/src/worker/couch/processor.py (settle เมื่อใบเป็น `received`) · port `donationShortfall` ไป worker
  - frontend/src/lib/features/donations (domain/donation.ts, domain/public-donation.ts `receiveDonationInputSchema`, domain/drop-off.ts, domain/donation-redirect.ts, ui/edit-donation-items-dialog.svelte)
  - frontend/src/lib/features/operations (domain/operations.ts `DONATION_SCHEMA_V` / `completeDonationReceipt` · domain/donation-batch.ts `deriveDonationReceiptAuditId` / `donationShortfall` · data/operations.remote.ts `receiveDonationBatch` / `hasKeyedDonationStock`)
  - frontend/src/lib/server/donation-docs.ts (`hasKeyedDonationStock`)
  - frontend/src/lib/components/form/donor-time-selection-form.svelte · routes/api/public/v1/donations/+server.ts · routes/api/public/v1/donations/[tracking_token]/+server.ts · routes/api/public/v1/donations/[tracking_token]/items/+server.ts
  - back-office: routes/(protected)/back-office/stock-donations/components/scan-station.svelte · routes/api/back-office/donations/[query]/+server.ts · routes/api/back-office/donations/[query]/close/+server.ts (ใหม่) · routes/api/back-office/donations/[query]/redirect/+server.ts · routes/api/back-office/donations/[query]/approve/+server.ts · routes/api/back-office/donations/[query]/reject/+server.ts (ผ่าน FR-MP-17a) · lib/components/pending-review-detail.svelte
why: >
  ศูนย์ที่มีจุดรับบริจาคหลายจุดต้องการให้ของแต่ละประเภทไปส่งที่จุดที่เก็บของประเภทนั้น
  (เช่น น้ำดื่มไปโรงยิม ยาไปห้องพยาบาล) แต่ใบบริจาคตอนนี้มีปลายทางเดียวคือศูนย์ และการรับของ
  บันทึกทั้งใบในครั้งเดียว — ให้ระบุจุดต่อรายการในใบเดียว และให้เจ้าหน้าที่แต่ละจุดรับเฉพาะรายการ
  ของจุดตัวเอง ของจึงเข้าคลังของจุดนั้นได้เลย
migration: >
  optional field ไม่ backfill — ใบเดิมไม่มี `drop_off_point_id` และ `point_receipts` = ไม่ระบุจุด
  (รับทั้งใบครั้งเดียวเหมือนเดิม) · bump donation schema_v และ PROJECTION_VERSION
---

# บริจาคครั้งเดียวแยกส่งหลายจุดรับบริจาค — ระบุจุดต่อรายการ และรับของทีละจุด

## สรุป (TL;DR)

- ใบบริจาคยังเป็น **ใบเดียว** (token, QR, `booking_ref`, slot ชุดเดียว) · แต่ละรายการมี `items[].drop_off_point_id` บอกว่าต้องส่งที่จุดไหน · เลือกจุดได้เฉพาะวิธี "นำมาส่งเอง" ที่ศูนย์มีจุดรับบริจาค ≥ 2 จุด
- **รับของทีละจุด:** เจ้าหน้าที่เลือก "จุดที่ประจำ" แล้วรับเฉพาะรายการของจุดนั้น · การรับแต่ละครั้งเพิ่ม 1 รายการใน `point_receipts[]` (ไม่เขียนทับ `items[]`) · ทุกรายการมีผลครบ → ปิดใบ และเขียน `received_summary` ครั้งเดียวตอนนั้น
- **ของมาไม่ครบทุกจุด:** เจ้าหน้าที่กด "ปิดใบ" หรือ worker ปิดให้เมื่อหมดอายุ · ส่วนที่ไม่มา = รับไม่ครบ · worker คืนยอดจองเมื่อใบเป็น `received`
- ใบที่รับไปบางจุดแล้ว: ผู้บริจาคแก้รายการและยกเลิกไม่ได้ · เจ้าหน้าที่ redirect และ reject ไม่ได้ (`409 GOODS_IN_STOCK` เดิม)
- field ใหม่ `items[].drop_off_point_id`, `point_receipts[]`, `received_summary.closed_by` / `closed_reason` · donation schema_v 7 → เลขถัดไปตอน merge · bump PROJECTION_VERSION · ขึ้นกับ CR-205 (#944)

## Why

- ศูนย์ที่ตั้งจุดรับบริจาคไว้หลายจุด (CR-205) อยากให้ของแต่ละประเภทไปจุดที่เก็บของประเภทนั้น
- ใบบริจาคตอนนี้มีปลายทางเดียว (`shelter_code`) · ผู้บริจาคที่นำของหลายประเภทมาส่งไม่รู้ว่าต้องแยกไปจุดไหน
- การรับของตอนนี้บันทึกทุกรายการในใบครั้งเดียวแล้วเปลี่ยนใบเป็น `received` ทันที (schema.md §2.3 "รับเข้าจากใบหลายรายการ") · ถ้าใช้กับใบหลายจุด จุดแรกที่สแกนจะปิดใบ และรายการของจุดอื่นกลายเป็น "รับไม่ครบ" ก่อนของจะไปถึง
- route รับของปัจจุบัน (`routes/api/back-office/donations/[query]/+server.ts`) ใช้ audit id เดียวต่อใบ และตอบ `409 RECEIPT_MISMATCH` เมื่อการรับครั้งใหม่มีชุดรายการต่างจากครั้งก่อน · จุดที่สองจึงรับไม่ได้ถ้าไม่เปลี่ยนกติกานี้
- จุดรับบริจาค = จุดเก็บของ และล็อตในคลังมี `storage_point_id` อยู่แล้ว (schema.md §2.1) · ถ้ารู้จุดตั้งแต่ตอนจอง ตอนรับของก็เติมที่เก็บให้ได้ทันที

## Requirements

**ข้อมูล**

- **FR-MP-1** — `donation.items[]` มี field ใหม่ `drop_off_point_id: str | null` (optional) · ไม่มี key หรือ `null` = ไม่ระบุจุด
- **FR-MP-2** — ตอนจอง (`POST /public/v1/donations`): ค่าที่ไม่ใช่ `null` ต้องเป็น `id` ที่อยู่ใน `public_shelters.donation_points` ของ `shelter_code` ของใบ · ไม่อยู่ → `400 UNKNOWN_DROP_OFF_POINT` และโควต้าไม่ขยับ
- **FR-MP-2a** — ตอนผู้บริจาคแก้รายการ (`PATCH …/{tracking_token}/items`): `id` ที่ไม่อยู่ในจุดรับบริจาคปัจจุบันของศูนย์ → BFF เขียน `null` ให้รายการนั้น ไม่ตอบ error (จุดอาจถูกเลิกติ๊กหลังจอง) · จุดรับบริจาคปัจจุบันอ่านจาก shelter doc ใน CouchDB = `common_areas.sub_storage[]` ที่ `accepts_donations = true` และมีพิกัด (กติกาเดียวกับ FR-DP-11)
- **FR-MP-3** — ศูนย์ที่ไม่มีจุดรับบริจาค → ทุกรายการต้องเป็น `null` · ตอนจองส่ง id มา → `400 UNKNOWN_DROP_OFF_POINT`
- **FR-MP-4** — `logistics.delivery_method` เป็น `shelter_pickup` (ศูนย์ไปรับ) หรือ `parcel` (ส่งพัสดุ) → ระบบเขียน `null` ทุกรายการ ไม่ว่า client จะส่งอะไรมา · ของมาถึงศูนย์ที่เดียว จึงรับทั้งใบที่จุดเดียว
- **FR-MP-5** — `donation` มี field ใหม่ระดับใบ `point_receipts: [...]` (optional) = ผลการรับของแต่ละครั้งที่จุด · รับ 1 ครั้ง = 1 รายการ · ไม่มี key หรือ `[]` = ยังไม่มีจุดไหนรับ · shape ตามตาราง §Change
- **FR-MP-5a** — รายการของใบที่ `line_no` อยู่ใน `point_receipts[].line_nos` = "บันทึกผลแล้ว" (รับ หรือไม่รับตาม CR-172) · `line_no` = ตำแหน่งใน `donation.items[]` เริ่มที่ 0 (นับแบบเดียวกับ route รับของปัจจุบัน) · `line_no` หนึ่งอยู่ใน `point_receipts` ได้ไม่เกิน 1 รายการ
- **FR-MP-5b** — การรับของไม่เขียนทับ `donation.items[]` (คง invariant "รายการที่ประกาศไม่ถูกเขียนทับ" ของ schema.md §2.3)
- **FR-MP-6** — ใบยังมี `logistics`, slot, โควต้า, token, QR และ `booking_ref` ชุดเดียว · จุดไม่มีผลกับ slot และโควต้า (slot ผูกกับศูนย์ — CR-205 D-1)
- **FR-MP-7** — ใบ walk-in ที่เจ้าหน้าที่สร้างไม่เขียน `drop_off_point_id` และ `point_receipts`

**ฟอร์มจอง public** (`donor-time-selection-form.svelte`)

- **FR-MP-8** — เพิ่ม section "จุดส่งของแต่ละรายการ" ต่อจาก section เลือกศูนย์ · แสดงเมื่อศูนย์ที่เลือกมีจุดรับบริจาค ≥ 2 จุด และวิธีส่งเป็น `self_dropoff`
- **FR-MP-9** — ค่าเริ่มต้นของทุกรายการ = จุดที่ผู้บริจาคแตะบนแผนที่ (#814) · ถ้าไม่ได้แตะ = จุดแรกในรายการ
- **FR-MP-10** — ศูนย์มีจุดเดียว → ใส่ id ของจุดนั้นให้ทุกรายการอัตโนมัติ และแสดงชื่อจุด (ไม่มีตัวเลือก)
- **FR-MP-11** — ศูนย์ไม่มีจุด หรือวิธีส่งไม่ใช่ `self_dropoff` → ไม่แสดง section และส่ง `null`
- **FR-MP-12** — เปลี่ยนศูนย์ → ล้างจุดของทุกรายการ

**หลังจอง (ฝั่งผู้บริจาค)**

- **FR-MP-13** — ตั๋วและหน้าติดตาม (`/donations/track/[token]`) แสดงปลายทางแยกกลุ่มตามจุด (ชื่อจุด, คำอธิบายตำแหน่ง, ปุ่มนำทาง, รายการในกลุ่ม) และสถานะของแต่ละกลุ่ม: "รอรับ" หรือ "รับแล้ว" (ทุกรายการในกลุ่มบันทึกผลแล้วตาม FR-MP-5a) · รายการที่บันทึกผลด้วย receipt ที่ `point_id = null` (FR-MP-18b) แสดงว่า "รับแล้วที่ศูนย์" · ข้อมูลจุดได้จาก `listDropOffPoints(shelter)` ของ CR-205 แล้วหาด้วย `pointId`
- **FR-MP-14** — ใบปะหน้ากล่อง (#591) ออก 1 ใบต่อจุด
- **FR-MP-15** — ผู้บริจาคแก้รายการได้เฉพาะใบที่ยังไม่มี `point_receipts` (FR-MP-17) และอยู่ภายใต้กติกาแก้รายการเดิม · dialog มีตัวเลือกจุดต่อรายการตาม FR-MP-8 · ค่าเริ่มต้นของรายการเดิม = `drop_off_point_id` ปัจจุบันของรายการนั้น · request ส่ง `drop_off_point_id` ของทุกรายการ (ไม่ต้องจับคู่รายการเดิมด้วย `line_key`) · ตรวจตาม FR-MP-2a
- **FR-MP-16** — รายการที่ `drop_off_point_id` ไม่อยู่ในจุดรับบริจาคปัจจุบันของศูนย์ (จุดถูกเลิกติ๊ก หรือถูกลบหลังจอง) → ตั๋วและหน้าติดตามแสดงรายการนั้นในกลุ่ม "ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" พร้อมที่อยู่ศูนย์ · ไม่ error · ไม่ใช้คำว่า "จุดหลัก" (ตาม CR-205 D-3 จุดหลักมีเฉพาะศูนย์ที่ไม่มีจุดติ๊ก)
- **FR-MP-17** — ใบที่มี `point_receipts` ไม่ว่าง → ผู้บริจาคยกเลิกและแก้รายการไม่ได้ · `DELETE …/{tracking_token}` และ `PATCH …/{tracking_token}/items` ตอบ `409 GOODS_IN_STOCK` (code เดิม) · หน้าติดตาม disable ปุ่มยกเลิกและแก้รายการ (ยกเว้นจาก CR-196 FR-LK-10)
- **FR-MP-17a** — `hasKeyedDonationStock` (`lib/server/donation-docs.ts` และ copy ใน `operations/data/operations.remote.ts`) ต้องตอบ `true` เมื่อใบมี `point_receipts` ไม่ว่าง นอกเหนือจากเมื่อมีแถว `stock_ledger` ของใบ · จุดที่ "ไม่รับ" ทุกรายการของจุดนั้นไม่มีแถว ledger แต่ใบนับว่าเริ่มรับแล้ว · ทุก route ที่ใช้ guard นี้ได้ผลเดียวกัน: ยกเลิก, แก้รายการ, redirect, staff reject ทั้งสองทาง (`[query]/approve` ที่ผลเป็น rejected และ `[query]/reject`)

**รับของทีละจุด (back-office)**

- **FR-MP-18** — หน้าสแกนรับของมีตัวเลือก "จุดที่ประจำ" = จุดรับบริจาคของศูนย์ อ่านจาก shelter doc ใน CouchDB (กติกาเดียวกับ FR-MP-2a ไม่ใช่ public projection) · เครื่องจำค่าที่เลือกไว้ต่อศูนย์ (เก็บในเครื่อง ไม่บันทึกลงบัญชีผู้ใช้) · เปลี่ยนได้ตลอด · ศูนย์ที่ไม่มีจุดรับบริจาค → ไม่แสดงตัวเลือก และหน้าสแกนทำงานเหมือนเดิม
- **FR-MP-18a** — ศูนย์ที่มีจุดรับบริจาค: สแกนและดูใบได้ก่อนเลือกจุดที่ประจำ · ปุ่มบันทึกรับของ disable จนกว่าจะเลือกจุด
- **FR-MP-18b** — ใบที่ `point_receipts` ไม่ว่าง แต่ศูนย์ไม่เหลือจุดรับบริจาคแล้ว (เลิกติ๊กหรือลบทุกจุดหลังเริ่มรับ) → หน้าสแกนไม่มีตัวเลือกจุดที่ประจำ · รายการที่ยังไม่บันทึกผลรับได้ทั้งหมด (ทุกรายการนับเป็นไม่ระบุจุดตาม FR-MP-19) · เจ้าหน้าที่เลือก "สถานที่จัดเก็บ" ของแต่ละรายการเอง (FR-MP-20 · จุดเก็บของไหนก็ได้ ไม่ต้องติ๊กรับบริจาค) · request ส่ง `point_id: null` พร้อม `line_nos` · receipt ครั้งนั้นมี `point_id = null`
  - หน้าสแกนแสดงแถบ "ศูนย์ไม่มีจุดรับบริจาคแล้ว รับรายการที่เหลือเข้าสถานที่จัดเก็บที่เลือก"
  - หมายเหตุ (`remarks`) ใส่ได้แต่ไม่บังคับ · เหตุผลและที่เก็บบันทึกเป็นข้อมูลแล้ว (`point_id = null` ใน receipt และ `lot.storage_point_id` ในแถว ledger)
- **FR-MP-19** — สแกนใบแล้ว รายการที่รับได้ = รายการที่ `drop_off_point_id` = จุดที่ประจำ **และ** รายการที่ไม่ระบุจุด (`null` หรือ id ที่ไม่อยู่ในจุดปัจจุบัน — เลิกติ๊กหรือถูกลบ) · รายการของจุดอื่นแสดงเป็นแถวที่กดไม่ได้ พร้อมชื่อจุดปลายทาง · รายการที่บันทึกผลแล้วแสดงว่า "รับแล้วที่ <จุด>" และกดไม่ได้
- **FR-MP-20** — "สถานที่จัดเก็บ" ของแต่ละรายการเริ่มที่ `storage_point_id = drop_off_point_id` · รายการที่ไม่ระบุจุดเริ่มที่จุดที่ประจำ · เจ้าหน้าที่เปลี่ยนได้
- **FR-MP-21** — ปุ่ม "รับรายการของจุดอื่น" ปลดล็อกรายการของจุดอื่นที่ยังไม่บันทึกผล ให้รับได้ · สถานที่จัดเก็บของรายการเหล่านั้นเริ่มที่จุดที่ประจำ (ใช้เมื่อผู้บริจาคนำของมาผิดจุด)
- **FR-MP-22** — `receiveDonationInputSchema` (body ของ `POST /api/back-office/donations/[query]`) เพิ่ม `point_id: str` และ `line_nos: int[]` = รายการที่บันทึกผลครั้งนี้ ทั้งรับและไม่รับ · `items` ยังส่งครบทุกรายการตามลำดับเดิม และ route ใช้เฉพาะรายการใน `line_nos` · รายการที่ไม่อยู่ใน `line_nos` ไม่ถูกเขียนอะไร (ไม่ต้องมีสถานะ "ข้าม")
- **FR-MP-22a** — validate: `line_nos` ไม่ว่าง ไม่ซ้ำกัน และทุกค่าอยู่ในช่วง `0 ≤ n < items.length` · ส่ง `point_id` โดยไม่มี `line_nos` หรือกลับกัน → `422` · `point_id: null` พร้อม `line_nos` ใช้ได้เฉพาะเมื่อศูนย์ไม่เหลือจุดรับบริจาค (FR-MP-18b) · ศูนย์ยังมีจุดแต่ส่ง `null` → `422` · ใบที่มีรายการระบุจุด**ที่ยังอยู่ในจุดรับบริจาคปัจจุบันของศูนย์** (อ่านแบบ FR-MP-2a) อย่างน้อย 1 รายการ แต่ไม่ส่ง `line_nos` → `422` (กันหน้าเวอร์ชันเก่ารับทั้งใบ) · id ที่ไม่อยู่ในจุดปัจจุบันแล้วนับเป็นไม่ระบุจุด (กติกาเดียวกับ FR-MP-19) · ศูนย์ที่ไม่เหลือจุดรับบริจาค → รับทั้งใบตาม FR-MP-24
- **FR-MP-22b** — แถว `stock_ledger` ของรายการที่รับใช้ `_id` = `deriveDonationReceiptLineId(donationId, itemId, lineNo)` เดิม (CR-143 FR-B4a) · ใช้ข้ามจุดได้เพราะ `line_no` ไม่เปลี่ยนหลังเริ่มรับ (FR-MP-17)
- **FR-MP-22c** — audit ของการรับครั้งนี้ใช้ `_id` = `deriveDonationReceiptAuditId(donationId, lineNos)` คำนวณจาก `line_nos` ที่เรียงแล้ว · ไม่ส่ง `lineNos` = id เดิมต่อใบ (ใบเดิมและ FR-MP-24) · retry ด้วย `line_nos` ชุดเดิมได้ audit id เดิม · `context` ของ audit เพิ่ม `point_id`, `line_nos`
- **FR-MP-22d** — เช็ค `409 RECEIPT_MISMATCH` เฉพาะรายการของครั้งนี้: (1) audit เดิมที่นำมาเทียบ = audit id ตาม FR-MP-22c ของ `line_nos` ชุดนี้ (2) เช็ค "แถว ledger ของใบนี้ที่อยู่นอก `ids`" ไม่นับ id ที่อยู่ใน `point_receipts[].ledger_ids` แล้ว
- **FR-MP-22e** — `line_nos` มีรายการที่อยู่ใน `point_receipts` แล้ว: ถ้า `point_receipts` มีรายการที่ `audit_id` ตรงกับ audit id ของครั้งนี้ (= retry ของการรับที่สำเร็จแล้ว) → ตอบ `200` พร้อมใบปัจจุบัน ไม่เขียนอะไรเพิ่ม · ไม่ตรง → `409 LINE_ALREADY_RECEIVED` พร้อมชื่อจุดที่รับไปแล้ว
- **FR-MP-22f** — บันทึกที่จุด: เขียนแถว `stock_ledger` ของรายการที่รับ · เพิ่ม 1 รายการใน `point_receipts` (shape ตาม §Change) · ไม่แก้ `items[]` · ไม่เขียน `received_summary` จนกว่าจะปิดใบ (FR-MP-27a)
- **FR-MP-23** — หลังเพิ่ม `point_receipts` ถ้าทุกรายการของใบบันทึกผลครบ → ปิดใบตาม FR-MP-27a ใน PUT เดียวกัน (`closed_reason: all_points`) · ยังไม่ครบ → คงสถานะเดิม (`verifying` หรือ `pending_review`)
- **FR-MP-23a** — PUT ใบได้ `409` (อีกจุดบันทึกพร้อมกัน): route อ่านใบใหม่แล้ว
  - สถานะเป็น terminal (อีกคนกด "ปิดใบ" หรือ worker ปิด / expire ไปก่อน) → `409 DONATION_CLOSED` · หน้าสแกนแจ้งเจ้าหน้าที่ว่า**ของที่สแกนครั้งนี้ลงคลังแล้ว** แต่ไม่อยู่ในผลรับของของใบ ให้แจ้งผู้ดูแลคลัง (ดูหัวข้อนอกขอบเขต)
  - `line_nos` ชนกับ `point_receipts` ของใบใหม่ → ทำตาม FR-MP-22e
  - ไม่ชน → เพิ่ม receipt ของครั้งนี้ลงใบที่อ่านใหม่ คำนวณ FR-MP-23 ใหม่ แล้ว PUT อีกครั้ง
  - retry สูงสุด 3 ครั้ง · ยังได้ `409` → ตอบ `409 DONATION_CONFLICT` ตามเดิม (แถว ledger คง id เดิม การรับซ้ำจึงไม่ลงคลังซ้ำ)
- **FR-MP-23b** — เช็ค `expected_rev` ตอนเริ่ม (`409 DONATION_CHANGED`) คงเดิม · จุดที่เปิดหน้าไว้ก่อนอีกจุดบันทึกต้องสแกนใหม่ · FR-MP-23a ใช้กับกรณีที่สองจุดผ่านเช็คนี้พร้อมกันเท่านั้น
- **FR-MP-24** — ใบที่ไม่มีรายการระบุจุด**ที่ยังอยู่ในจุดรับบริจาคปัจจุบันของศูนย์** (ใบเดิม, `parcel`, `shelter_pickup`, ศูนย์ไม่มีจุด หรือทุกจุดของใบถูกเลิกติ๊กหรือลบหลังจอง) และไม่มี `point_receipts` → รับทั้งใบในครั้งเดียวเหมือนเดิม (ไม่ส่ง `point_id` / `line_nos`)
- **FR-MP-24a** — batch receive (`receiveDonationBatch` ใน `operations.remote.ts` → `completeDonationReceipt`, CR-143 FR-B4b) ปฏิเสธใบที่มีรายการระบุจุด หรือมี `point_receipts` ไม่ว่าง · แจ้ง "ใบนี้แยกส่งหลายจุด — รับที่หน้าสแกน" · ไม่เขียนแถว ledger · `completeDonationReceipt` throw สำหรับใบแบบนี้
- **FR-MP-25** — scan station และหน้ารอประเมินแสดงชื่อจุดของแต่ละรายการ

**ปิดใบ**

- **FR-MP-26** — ใบที่มี `point_receipts` ไม่ว่าง และยังมีรายการที่ไม่บันทึกผล → หน้าสแกนแสดงปุ่ม "ปิดใบ" · ปุ่มเรียก route ใหม่ `POST /api/back-office/donations/[query]/close` (body: `expected_rev`) · route ใช้ `authorizeWarehouse` และ shelter scope เดียวกับ route รับของ · ไม่เพิ่ม role หรือ permission
- **FR-MP-27** — ปิดใบด้วยปุ่ม: ปิดตาม FR-MP-27a ด้วย `closed_by` = ชื่อผู้กด และ `closed_reason: staff_close` · เขียน audit 1 รายการต่อใบ (`_id` deterministic) · ใบที่ `point_receipts` ว่าง → `422` · `expected_rev` ไม่ตรง → `409 DONATION_CHANGED`
- **FR-MP-27a** — ปิดใบ (ทุกทาง: ครบทุกจุด, ปุ่ม, worker) เขียน `received_summary` ครั้งเดียว:
  - `total_items` = จำนวนรายการทั้งใบ · `received_at` = เวลาปิด · `remarks` = `remarks` ของแต่ละ receipt ต่อกัน
  - `items[]` = รวม `point_receipts[].items` เรียงตาม `line_no` · รายการที่ไม่มีผล = `qty: "0"` ไม่มี `rejected`
  - `shortfalls` = `donationShortfall` เดิม ไม่นับรายการที่ `rejected` (CR-172 FR-13) · รายการที่ไม่มาจึงอยู่ใน `shortfalls`
  - `closed_by` (ชื่อเจ้าหน้าที่ หรือ `system`) · `closed_reason`: `all_points` | `staff_close` | `expired`
- **FR-MP-27b** — สถานะตอนปิด: มีรายการที่รับจริง ≥ 1 → `received` · ไม่มีเลย (ทุกรายการไม่รับ หรือไม่รับปนไม่มา) → `rejected` + `reject_reason` / `reject_reason_code` ระดับใบตาม CR-172 FR-12
- **FR-MP-27c** — worker (`processor.py` สาย `doc_type == "donation"`) เรียก `settle_shelved_quota` เมื่อใบมีสถานะ `received` · ยอดจองของ shortfall จึงคืนทันที ไม่ต้องรอ ledger event ถัดไป (ใช้กับใบที่รับทั้งใบแล้วมี shortfall ด้วย)
- **FR-MP-27d** — ก่อนปิดใบ รายการที่จุด "ไม่รับ" ยังถูกจองอยู่ (`calculateReserved`, `compute_needs`, `still_owed` หักเฉพาะแถว ledger) · ตั้งใจ ไม่แก้กติกา T-22 ทั้ง 3 ชุด (TS, Python, `packages/needs-fixtures`) · ยอดคืนตอนปิดใบตาม FR-MP-27c
- **FR-MP-28** — ใบที่ `point_receipts` ว่าง → ไม่มีปุ่ม "ปิดใบ" (ใช้ reject / หมดอายุตามเดิม)

**หมดอายุ**

- **FR-MP-29** — worker ที่ทำให้ใบหมดอายุ (`worker/src/worker/quota/expiry.py`) เจอใบที่เลย `expires_at`: `point_receipts` ไม่ว่าง → ปิดใบตาม FR-MP-27a (`closed_by: system`, `closed_reason: expired`) แทนการเปลี่ยนเป็น `expired` · `point_receipts` ว่าง → `expired` ตามเดิม · worker ไม่เขียน audit (`closed_by` ในใบเป็นหลักฐาน)
- **FR-MP-29a** — worker ตัดสินว่าจะ expire หรือปิดใบจาก doc ที่อ่านในรอบนั้น และ PUT ด้วย `_rev` ของ doc นั้น · ได้ `409` → ข้ามใบนั้น รอบถัดไปอ่านใหม่ (พฤติกรรมเดิมของ `expire_declared_donations`)
- **FR-MP-29b** — port `donationShortfall` (`operations/domain/donation-batch.ts`) ไป worker · ทั้งสองฝั่งต้องผ่าน fixture ชุดเดียวกัน (แบบ `packages/needs-fixtures`)

**redirect (CR-087)**

- **FR-MP-30** — ใบที่ `point_receipts` ไม่ว่าง → redirect ไม่ได้ (`409 GOODS_IN_STOCK` ผ่าน FR-MP-17a) · ใบที่ยังว่าง → ย้ายทั้งใบไปศูนย์ปลายทางเหมือนเดิม และเขียน `drop_off_point_id = null` ให้ทุกรายการใน snapshot (จุดเป็นของศูนย์ต้นทาง)

**ไม่เปลี่ยน**

- **FR-MP-31** — `stock_ledger` ไม่เปลี่ยน field หรือ `_id` · ใช้ `lot.storage_point_id` ที่มีอยู่

**นอกขอบเขต (มีอยู่แล้วก่อน CR นี้)**

- route รับของเขียนแถว ledger แล้วใบถูกปิดก่อน PUT ของ route → แถว ledger ลงคลังแล้วแต่ไม่อยู่ใน `received_summary` · เกิดได้ 3 แบบ แยกเป็น issue ต่างหากที่ครอบทั้ง 3 แบบ:
  - worker เปลี่ยนใบเป็น `expired` (มีอยู่แล้วบน develop กับการรับทั้งใบ)
  - worker ปิดใบตาม FR-MP-29 (CR นี้)
  - เจ้าหน้าที่อีกคนกด "ปิดใบ" (FR-MP-27) ระหว่างที่จุดนี้เขียน ledger ไปแล้ว (CR นี้)
  - CR นี้กำหนดแค่ให้ route ตอบ `409 DONATION_CLOSED` และแจ้งเจ้าหน้าที่ตาม FR-MP-23a
- `received_summary.remarks` (หมายเหตุภายในของเจ้าหน้าที่) ถูกส่งไป public API เพราะ projector ส่ง `received_summary` ทั้งก้อน (`worker/src/worker/projectors/donation.py:64`) · FR-MP-27a รวม `remarks` ของทุก receipt ไว้ที่ field นี้ จึงหลุดแบบเดียวกัน · แยกเป็น issue ต่างหาก · CR นี้ไม่ส่ง `point_receipts[].remarks` ลง Mongo (ตาม §Change)

## Change (before → after)

**CouchDB `donation`**

| field | ชนิด | ค่าเมื่อไม่มี key | กติกา |
| --- | --- | --- | --- |
| `items[].drop_off_point_id` | str \| null | `null` (= ไม่ระบุจุด) | FR-MP-1 – FR-MP-4 |
| `point_receipts[]` | [receipt] | `[]` (= ยังไม่มีจุดไหนรับ) | FR-MP-5, FR-MP-22f |
| `received_summary.closed_by` | str | ไม่มี (ใบรับทั้งใบ) | FR-MP-27a |
| `received_summary.closed_reason` | enum `all_points` \| `staff_close` \| `expired` | ไม่มี (ใบรับทั้งใบ) | FR-MP-27a |

**receipt ใน `point_receipts[]`**

| key | ชนิด | ความหมาย |
| --- | --- | --- |
| `point_id` | str \| null | จุดที่ประจำของผู้บันทึก · `null` = รับตอนศูนย์ไม่เหลือจุดรับบริจาค (FR-MP-18b) |
| `line_nos` | [int] | รายการที่บันทึกผลครั้งนี้ |
| `received_at` | ts | เวลาบันทึก |
| `received_by` | str | ชื่อผู้ใช้ของผู้บันทึก (ไม่ project ลง Mongo) |
| `audit_id` | str | `_id` ของ audit ตาม FR-MP-22c |
| `ledger_ids` | [str] | `_id` ของแถว `stock_ledger` ที่ครั้งนี้เขียน |
| `items` | [{`line_no`:int, `item_id`:str?, `free_text`:str?, `qty`:qty_str, `unit`:str, `rejected`:bool?, `reject_reason`:str?, `reject_reason_code`:enum?}] | ผลราย line · shape เดียวกับ `received_summary.items[]` + `line_no` |
| `remarks` | str? | หมายเหตุจากผู้บันทึก |

- ก่อน: `items: [{ item_id: 'water', qty: '24', unit: 'ขวด' }, { item_id: 'paracetamol', qty: '10', unit: 'แผง' }]`
- หลังจอง: `items: [{ …water, drop_off_point_id: '01J…GYM' }, { …paracetamol, drop_off_point_id: '01J…MED' }]` · ไม่มี `point_receipts`
- หลังโรงยิมรับ: `items` ไม่เปลี่ยน · `point_receipts: [{ point_id: '01J…GYM', line_nos: [0], received_at: '2026-10-28T09:12:00+07:00', … }]` · ใบคงสถานะเดิม · ยังไม่มี `received_summary`
- หลังห้องพยาบาลรับ: `point_receipts` มี 2 รายการ · ใบ `received` · `received_summary.closed_reason: 'all_points'`

**Mongo `public_donations`** — `items_declared[].drop_off_point_id` และ `point_receipts[]` เฉพาะ `{ point_id, line_nos, received_at }`

**API (public)** — `items[].drop_off_point_id` (opt) ใน request ของ `POST /public/v1/donations` และ `PATCH …/{tracking_token}/items` · `items[].drop_off_point_id` และ `point_receipts[]` (`point_id`, `line_nos`, `received_at`) ใน response ของ `GET …/{tracking_token}` · error ใหม่ `400 UNKNOWN_DROP_OFF_POINT` (เฉพาะ `POST`)

**API (back-office)** — `POST /api/back-office/donations/[query]` เพิ่ม `point_id`, `line_nos` และ error `409 LINE_ALREADY_RECEIVED` · route ใหม่ `POST /api/back-office/donations/[query]/close`

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ปลายทางของใบ | ศูนย์ (`shelter_code`) | ศูนย์ + จุดต่อรายการ (เฉพาะนำมาส่งเอง) |
| จำนวนใบต่อการจอง | 1 | 1 (ไม่แตกใบ) |
| slot / โควต้า / QR | ชุดเดียวต่อใบ | ชุดเดียวต่อใบ (ไม่เปลี่ยน) |
| การรับของ | บันทึกทั้งใบครั้งเดียว · audit 1 รายการต่อใบ | บันทึกทีละจุดลง `point_receipts` · audit 1 รายการต่อชุดรายการ · ครบทุกจุดแล้วใบถึงปิด |
| `received_summary` | เขียนตอนรับทั้งใบ | ใบที่มีจุด: เขียนครั้งเดียวตอนปิดใบ |
| ที่เก็บตอนรับของ | เจ้าหน้าที่เลือกเอง | เริ่มที่จุดของรายการ เจ้าหน้าที่เปลี่ยนได้ |
| ของมาไม่ครบทุกจุด | — | เจ้าหน้าที่ "ปิดใบ" หรือ worker ปิดเมื่อหมดอายุ |
| ยอดจองของ shortfall | คืนเมื่อมี ledger event ถัดไป | คืนเมื่อใบเป็น `received` |
| ยกเลิก / แก้รายการ / redirect / staff reject | `409 GOODS_IN_STOCK` เมื่อมีแถว ledger ของใบ | `409 GOODS_IN_STOCK` เมื่อมีแถว ledger **หรือ** `point_receipts` ไม่ว่าง |

## Acceptance

- **AC-1** — ศูนย์มี 2 จุด → จองน้ำไปโรงยิม ยาไปห้องพยาบาล → doc มี `drop_off_point_id` ตรงกับที่เลือก · หน้าติดตามแสดง 2 กลุ่ม "รอรับ" · ใบปะหน้า 2 ใบ
- **AC-2** — ตอนจองส่ง `drop_off_point_id` ที่ไม่อยู่ในศูนย์นั้น → `400 UNKNOWN_DROP_OFF_POINT` และโควต้าไม่ขยับ
- **AC-3** — ศูนย์ไม่มีจุดแต่ส่ง id มาตอนจอง → `400 UNKNOWN_DROP_OFF_POINT`
- **AC-4** — `parcel` หรือ `shelter_pickup` แล้วส่ง id มา → บันทึกเป็น `null`
- **AC-5** — เจ้าหน้าที่ประจำโรงยิมสแกนใบจาก AC-1 → รับได้เฉพาะน้ำ · ยาแสดง "ส่งที่ห้องพยาบาล" กดไม่ได้ · บันทึก → `point_receipts` มี 1 รายการ (โรงยิม, `line_nos: [0]`) · `items[]` ไม่เปลี่ยน · ล็อตได้ `storage_point_id` = โรงยิม · ใบคงสถานะเดิม · ไม่มี `received_summary` · หน้าติดตามแสดง "โรงยิม รับแล้ว · ห้องพยาบาล รอรับ"
- **AC-6** — ต่อจาก AC-5 เจ้าหน้าที่ห้องพยาบาลสแกนใหม่แล้วรับยา → ไม่มี `409` · ใบ `received` · `received_summary.items` มี 2 รายการ · `closed_reason: all_points`
- **AC-7** — ต่อจาก AC-5 ยาไม่มาส่ง เจ้าหน้าที่กด "ปิดใบ" → ใบ `received` · ยาอยู่ใน `shortfalls` · `closed_reason: staff_close` · มี audit การปิด · `reserved_qty` ของยาลดลงโดยไม่ต้องมี ledger event อื่น
- **AC-8** — ต่อจาก AC-5 ไม่มีใครปิดใบจนเลย `expires_at` → worker ปิดใบเป็น `received` แบบ AC-7 ด้วย `closed_by: system`, `closed_reason: expired` ไม่ใช่ `expired`
- **AC-9** — ต่อจาก AC-5: ผู้บริจาคยกเลิก → `409 GOODS_IN_STOCK` · ผู้บริจาคแก้รายการ → `409 GOODS_IN_STOCK` · เจ้าหน้าที่ redirect → `409 GOODS_IN_STOCK` · เจ้าหน้าที่ reject ใบ ทั้งผ่าน `[query]/approve` (ผลเป็น rejected) และ `[query]/reject` → `409 GOODS_IN_STOCK`
- **AC-10** — ผู้บริจาคนำยามาที่โรงยิม → เจ้าหน้าที่กด "รับรายการของจุดอื่น" แล้วรับยาได้ · สถานที่จัดเก็บเริ่มที่โรงยิม · receipt มี `point_id` = โรงยิม
- **AC-11** — redirect ใบที่ยังไม่มีจุดไหนรับ → ใบที่ศูนย์ปลายทางมี `drop_off_point_id = null` ทุกรายการ
- **AC-12** — ใบเดิมที่ไม่มี key และใบ `parcel` → รับทั้งใบในครั้งเดียวเหมือนก่อนเปลี่ยน · audit id เดิมต่อใบ
- **AC-13** — เลิกติ๊กหรือลบจุดหลังจอง → หน้าติดตามแสดงรายการนั้นในกลุ่ม "ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" พร้อมที่อยู่ศูนย์ · เจ้าหน้าที่ทุกจุดรับรายการนั้นได้ · ผู้บริจาคแก้รายการได้โดยไม่ error และ id นั้นถูกเขียนเป็น `null`
- **AC-14** — โรงยิมกับห้องพยาบาลบันทึกพร้อมกัน (ทั้งคู่ผ่านเช็ค `expected_rev`) → `point_receipts` มีครบ 2 รายการ · ใบ `received` · แถว ledger ไม่ซ้ำ
- **AC-15** — โรงยิมบันทึกสำเร็จแต่ response หาย แล้วกดซ้ำด้วยรายการชุดเดิม → `200` · ไม่มีแถว ledger, audit หรือ receipt เพิ่ม · อีกจุดส่ง `line_nos` ที่มีน้ำ → `409 LINE_ALREADY_RECEIVED`
- **AC-16** — worker อ่านใบที่ยังไม่มี `point_receipts` แล้วโรงยิมบันทึกก่อน worker PUT → worker ได้ `409` และข้ามใบนั้น · รอบถัดไปปิดใบตาม FR-MP-29 ไม่เปลี่ยนเป็น `expired`
- **AC-17** — โรงยิม "ไม่รับ" น้ำ (รายการเดียวของจุด) → `point_receipts` มี 1 รายการ ไม่มีแถว ledger · ผู้บริจาคยกเลิก → `409 GOODS_IN_STOCK` · ยอดจองของน้ำยังค้างจนปิดใบ
- **AC-18** — ปิดใบที่ทุกรายการไม่รับหรือไม่มา → ใบ `rejected` พร้อม `reject_reason` ระดับใบ
- **AC-19** — หน้ารับของแบบ batch เลือกใบที่มีรายการระบุจุด → ปฏิเสธพร้อมข้อความ "ใบนี้แยกส่งหลายจุด — รับที่หน้าสแกน" · ไม่มีแถว ledger
- **AC-20** — request รับของที่ไม่ส่ง `line_nos` สำหรับใบที่มีรายการระบุจุดที่ยังอยู่ในจุดปัจจุบัน → `422`
- **AC-21** — จองแยก 2 จุด แล้วศูนย์เลิกติ๊กทั้งสองจุด → หน้าสแกนไม่มีตัวเลือกจุด และรับทั้งใบได้ในครั้งเดียว (ไม่ได้ `422`) · audit id เดิมต่อใบ
- **AC-22** — ห้องพยาบาลกำลังบันทึก (เขียน ledger แล้ว) แต่อีกคนกด "ปิดใบ" ก่อน → ห้องพยาบาลได้ `409 DONATION_CLOSED` พร้อมข้อความว่าของลงคลังแล้ว
- **AC-23** — ต่อจาก AC-5 ศูนย์เลิกติ๊กทั้งสองจุด แล้วยามาส่ง → หน้าสแกนไม่มีตัวเลือกจุดและแสดงแถบอธิบาย · เจ้าหน้าที่รับยาเข้า "ห้องเก็บของ 3" โดยไม่ใส่หมายเหตุได้ · ใบ `received` (`closed_reason: all_points`) · receipt ของยามี `point_id = null` · ล็อตยาได้ `storage_point_id` = ห้องเก็บของ 3 · หน้าติดตามแสดงกลุ่มยาว่า "รับแล้วที่ศูนย์"
- **AC-24** — ศูนย์ยังมีจุดรับบริจาค แต่ request ส่ง `point_id: null` → `422`

## Impact

- **backend**: `DonationItemInput.drop_off_point_id: str | None = None` · `create` ตรวจ FR-MP-2 – FR-MP-4 กับ `PublicShelter.donation_points`
- **tent-model**: `DeclaredItem.drop_off_point_id: str | None = None` · `PublicDonation.point_receipts` (`point_id`, `line_nos`, `received_at`)
- **worker**
  - inbound คัดลอก `drop_off_point_id` ลง CouchDB · bump `DONATION_SCHEMA_V`
  - projector ส่ง `drop_off_point_id` และ `point_receipts` แบบย่อลง `public_donations` · bump `PROJECTION_VERSION`
  - `quota/expiry.py`: FR-MP-29, FR-MP-29a · port `donationShortfall` (FR-MP-29b)
  - `couch/processor.py`: FR-MP-27c
- **frontend public**
  - `donations/domain/donation.ts`: zod input เพิ่ม field
  - `donations/domain/drop-off.ts`: ใช้ `listDropOffPoints(shelter)` ของ CR-205 แล้วหาด้วย `pointId` · id ที่ไม่เจอ → กลุ่มตาม FR-MP-16
  - `operations/domain/operations.ts`: bump `DONATION_SCHEMA_V` ให้ตรงกับ worker
  - `donor-time-selection-form.svelte`: FR-MP-8 – FR-MP-12 (section ใหม่ ไม่แก้ section เลือกศูนย์ของ #814)
  - BFF `routes/api/public/v1/donations/+server.ts`: ส่ง field ต่อไป FastAPI
  - ตั๋ว หน้าติดตาม ใบปะหน้า: FR-MP-13, FR-MP-14, FR-MP-16
  - `edit-donation-items-dialog.svelte` + route `…/[tracking_token]/items`: FR-MP-2a, FR-MP-15, FR-MP-17
  - route `…/[tracking_token]` (DELETE): FR-MP-17 ผ่าน FR-MP-17a
- **frontend back-office**
  - `lib/server/donation-docs.ts` + `operations.remote.ts` `hasKeyedDonationStock`: FR-MP-17a · route ที่ได้ผลตาม: `…/[tracking_token]` (DELETE), `…/items`, `[query]/redirect`, `[query]/approve` (outcome rejected, `:123`), `[query]/reject` (`:82`)
  - `scan-station.svelte`: FR-MP-18 – FR-MP-21 (รวม FR-MP-18b), FR-MP-25, ปุ่ม "ปิดใบ" (FR-MP-26)
  - `donations/domain/public-donation.ts` `receiveDonationInputSchema`: FR-MP-22, FR-MP-22a
  - `operations/domain/donation-batch.ts` `deriveDonationReceiptAuditId(donationId, lineNos?)`: FR-MP-22c
  - route `api/back-office/donations/[query]` (POST): FR-MP-22 – FR-MP-23b · `422` ตาม FR-MP-22a นับเฉพาะจุดปัจจุบันของศูนย์ (อ่าน shelter doc แบบ FR-MP-2a)
  - route ใหม่ `api/back-office/donations/[query]/close`: FR-MP-26 – FR-MP-27b
  - `operations.remote.ts` `receiveDonationBatch` + `completeDonationReceipt`: FR-MP-24a
  - route `…/[query]/redirect` + `donation-redirect.ts`: FR-MP-30
  - `pending-review-detail.svelte`: FR-MP-25
- **OpenAPI**: regenerate `fastapi.json` + `openapi.d.ts`
- **ไม่กระทบ**: `stock_ledger`, `donation_slot`, `donation_campaign`, สูตรโควต้าและ needs (FR-MP-27d)
- **docs หลัง approve**
  - schema.md §2.3: field ใหม่ตาราง §Change · แก้ข้อความ `received_summary` (~:486) ว่าใบที่มีจุดเขียนตอนปิดใบ ไม่ใช่ทุกครั้งที่ตรวจ · กติการับของทีละจุด · หมายเหตุ schema_v และ Migration
  - couchdb-mongodb-sync.md §3.2 · api-contract.md §5
  - CR-087 · CR-143 §B FR-B4a / FR-B4b · CR-172 FR-12 · CR-196 FR-LK-10
  - CR-205 ตาราง §Change แถว "เอาติ๊กออก หรือลบจุด" (เลิกใช้คำว่า "จุดหลัก")
  - public-tier-donation-spec.html · อัปเดต `updated:` ทุกไฟล์

## Migration

- `drop_off_point_id`, `point_receipts`, `closed_by`, `closed_reason` optional → doc เดิมไม่ backfill
- ใบเดิมไม่มีรายการระบุจุด → รับทั้งใบครั้งเดียวเหมือนเดิม (FR-MP-24) · `received_summary` ของใบเดิมไม่ต้องเติม `closed_by` / `closed_reason`
- re-project `public_donations` ผ่าน PROJECTION_VERSION

## ลำดับ `schema_v`

- develop ตอนนี้ donation schema_v = 7 · CR-175 (รูปของบริจาค) และ CR-196 (`line_key`) ยังไม่มีโค้ดบน develop และแย่งเลข 8/9 กันอยู่ตามมติ "ใคร merge ก่อนได้เลขก่อน" (CR-196 §ลำดับ schema_v)
- CR นี้ใช้กติกาเดียวกัน: ได้เลขถัดจากเลขล่าสุดบน develop ตอน merge
- PROJECTION_VERSION ใช้กติกาเดียวกัน (2026-10-28: develop = 10 · CR-196 #956 และโค้ดของ CR-205 ใช้ 11 บน branch ของตัวเอง ตัวที่ merge ทีหลังขยับเลข)

## ข้อตกลงที่รออนุมัติ

ผู้ขอ (Kunanon Nusaeng) เลือก D-1 – D-9 แล้วเมื่อ 2026-10-27 และ D-12 เมื่อ 2026-10-28 · D-10, D-11 มาจาก review ของ PR #945 และรอผู้ขอเลือก · ทุกข้อต้องรอผู้อนุมัติยืนยัน

| # | เรื่อง | ที่เลือก | FR |
| --- | --- | --- | --- |
| D-1 | ใบเดียว หรือแตกหลายใบ (คำถามใน #813) | ใบเดียว ระบุจุดต่อรายการ | FR-MP-1, FR-MP-6 |
| D-2 | redirect ใบที่มีจุด (คำถามใน #813) | ย้ายทั้งใบ ล้างจุด · ห้ามเมื่อรับไปบางจุดแล้ว | FR-MP-30 |
| D-3 | `parcel` เลือกจุดได้ไหม | ไม่ได้ (`null`) | FR-MP-4 |
| D-4 | เจ้าหน้าที่รู้ได้ยังไงว่ารับรายการไหน | เลือก "จุดที่ประจำ" บนหน้าสแกน | FR-MP-18, FR-MP-19 |
| D-5 | ของมาไม่ครบทุกจุด | เจ้าหน้าที่กด "ปิดใบ" | FR-MP-26 – FR-MP-28 |
| D-6 | ใบที่รับบางจุดแล้วเลยเวลาหมดอายุ | worker ปิดใบเป็น `received` แทน `expired` | FR-MP-29 |
| D-7 | ผู้บริจาคยกเลิกหรือแก้รายการใบที่รับบางจุดแล้ว | ไม่ได้ | FR-MP-17 |
| D-8 | ใครกด "ปิดใบ" ได้ | ผู้ที่รับของบริจาคได้อยู่แล้ว ไม่เพิ่มสิทธิ์ | FR-MP-26 |
| D-9 | ผู้บริจาคนำของมาผิดจุด | ปุ่ม "รับรายการของจุดอื่น" | FR-MP-21 |
| D-10 | เก็บผลการรับทีละจุดที่ไหน | `point_receipts[]` ระดับใบ (เสนอ) **หรือ** `items[].received_at` | FR-MP-5 – FR-MP-5b, FR-MP-22f |
| D-11 | รายการที่จุด "ไม่รับ" คืนยอดจองเมื่อไร | ตอนปิดใบ (เสนอ) **หรือ** ทันทีที่จุดบันทึก | FR-MP-27d |
| D-12 | ใบที่รับไปบางจุดแล้ว แต่ศูนย์เลิกติ๊กทุกจุดที่เหลือ | รับรายการที่เหลือเข้าสถานที่จัดเก็บไหนก็ได้ · `point_id = null` · หมายเหตุไม่บังคับ (ผู้ขอเลือก 2026-10-28) | FR-MP-18b, FR-MP-22a |

## ทางเลือกที่ไม่เลือก

- **แตกเป็นหลายใบ (1 รายการ หรือ 1 จุด = 1 ใบ)** — ข้อมูลง่ายขึ้น (จุดเป็น field ของใบ) แต่ต้องเพิ่มรหัสกลุ่มผูกใบ, นับ slot เป็นกลุ่ม, ยกเลิกทั้งชุดเมื่อใบใดจองไม่ผ่าน และผู้บริจาคถือหลาย QR (ขัดกับ comment ใน #815 "แสดง QR รับของเข้าอันเดียว")
- **ผูกบัญชีเจ้าหน้าที่กับจุด** — ต้องเพิ่มข้อมูลในบัญชีผู้ใช้และแก้ role matrix · เจ้าหน้าที่สลับจุดหน้างานแล้วแอดมินต้องแก้ทุกครั้ง
- **ใส่จุดใน QR ของใบปะหน้า** — ผู้บริจาคไม่ได้พิมพ์ใบปะหน้าทุกคน · QR บนมือถือมีอันเดียวทั้งใบ
- **ให้ระบบปิดใบเองเมื่อพ้นวันนัด** — ต้องมี job ใหม่ · ใช้ job หมดอายุที่มีอยู่แทน (FR-MP-29)
- **`items[].received_at` (ร่างก่อนหน้า)** — เขียนทับ `items[]` ซึ่งขัดกับ invariant ของ schema.md §2.3 · ต้อง merge `received_summary` ทุกครั้งที่จุดรับ · เก็บผลราย line ที่ต้องใช้ตอนปิดใบไม่ได้
- **audit id ต่อ (ใบ, จุด)** — จุดเดียวรับใบเดียวกันสองครั้งไม่ได้ (เช่น รับของจุดอื่นตาม FR-MP-21 ทีหลัง) · ใช้ id ต่อชุดรายการแทน (FR-MP-22c)
- **หักรายการที่ "ไม่รับ" ออกจากยอดจองทันที** — ต้องแก้กติกา T-22 ทั้ง 3 ชุดพร้อมกัน · ยอดค้างอยู่แค่จนปิดใบ

## Decision log

- 2026-10-27 — proposed (draft) จาก issue #813 และแผน epic #825
- 2026-10-27 — ผู้ขอเลือก D-1 – D-9 · เพิ่มการรับของทีละจุด, ปิดใบ, หมดอายุ, ยกเลิก และ field `received_at` (เดิมร่างแรกรับทั้งใบครั้งเดียว ซึ่งทำให้จุดแรกที่สแกนปิดใบแทนจุดอื่น) · `parcel` เปลี่ยนจากเลือกจุดได้เป็น `null`
- 2026-10-27 — แก้ตาม review PR #945:
  - เปลี่ยน `items[].received_at` เป็น `point_receipts[]` ระดับใบ และเขียน `received_summary` ตอนปิดใบ (FR-MP-5 – FR-MP-5b, FR-MP-22f, FR-MP-27a)
  - กติการับของทีละจุดกับ route เดิม: `line_nos`, audit id ต่อชุดรายการ, `RECEIPT_MISMATCH` เฉพาะรายการของครั้งนี้, `LINE_ALREADY_RECEIVED` (FR-MP-22 – FR-MP-22e)
  - concurrency: สองจุดบันทึกพร้อมกัน และ expiry แข่งกับการรับ (FR-MP-23a, FR-MP-23b, FR-MP-29a)
  - ตัด `409 PARTIALLY_RECEIVED` ใช้ `GOODS_IN_STOCK` เดิม และขยาย `hasKeyedDonationStock` (FR-MP-17a) · แก้แถว "ยกเลิก / redirect" ในตาราง Change
  - ห้ามแก้รายการหลังรับบางจุด · ไม่ใช้ `line_key` จึงไม่ขึ้นกับ CR-196 (FR-MP-15, FR-MP-17)
  - batch receive ปฏิเสธใบที่มีจุด (FR-MP-24a) · worker คืนยอดจองเมื่อใบเป็น `received` (FR-MP-27c) · ระบุว่ารายการที่ไม่รับยังถูกจองจนปิดใบ (FR-MP-27d)
  - FR-MP-16 เลิกใช้คำว่า "จุดหลัก" ให้ตรงกับ #944 D-3 · FR-MP-19 / AC-13 ใช้ "เลิกติ๊กหรือลบ" ตรงกัน · staff อ่านจุดจาก CouchDB
  - ใช้ `listDropOffPoints` ของ #944 แทน `resolveDropOffPoint` "จาก #590"
  - FR-MP-2 ตรวจเฉพาะตอนจอง · ตอนแก้รายการ id ที่หายเขียนเป็น `null` (FR-MP-2a)
  - worker ปิดใบ: port `donationShortfall` และใช้ `closed_by: system` แทน audit (FR-MP-29, FR-MP-29b)
  - เพิ่ม CR-143 §B, CR-172 FR-12 และ `draft-storage-drop-off-points` ใน `affects` · ตัด `created` ออกจาก frontmatter ตาม `_template.md`
- 2026-10-28 — แก้ตาม re-review PR #945 (Comment · ไม่มี blocker):
  - Warning ใบค้างเมื่อศูนย์เลิกติ๊กทุกจุดหลังจอง: FR-MP-22a และ FR-MP-24 นับเฉพาะรายการที่ระบุจุดที่ยังอยู่ในจุดปัจจุบันของศูนย์ · AC-20 ปรับตาม · เพิ่ม AC-21
  - หัวข้อนอกขอบเขตครอบ 3 กรณีที่ใบถูกปิดหลังเขียน ledger · FR-MP-23a ให้หน้าสแกนแจ้งว่าของลงคลังแล้ว · เพิ่ม AC-22
  - route `[query]/reject` อยู่ใน `affects` / Impact · FR-MP-17a และ AC-9 ครอบ reject ทั้งสองทาง
  - อ้าง `draft-storage-drop-off-points` เป็น CR-205 (อนุมัติ 2026-10-28) · อัปเดตเลข PROJECTION_VERSION
  - ช่องโหว่ที่เจอระหว่างแก้: ใบที่รับไปบางจุดแล้วแต่ศูนย์เลิกติ๊กทุกจุด รับของที่เหลือไม่ได้ (FR-MP-24 ใช้กับใบที่ยังไม่มี `point_receipts` เท่านั้น) · ผู้ขอเลือก D-12: รับเข้าสถานที่จัดเก็บไหนก็ได้ `point_id = null` หมายเหตุไม่บังคับ (FR-MP-18b, FR-MP-22a, FR-MP-13, AC-23, AC-24)
  - นอกขอบเขต: `received_summary.remarks` หลุดไป public API (มีอยู่แล้ว · แยก issue)
