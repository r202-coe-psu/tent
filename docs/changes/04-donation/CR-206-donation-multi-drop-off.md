---
id: CR-206 # renumbered from draft-donation-multi-drop-off
title: บริจาคครั้งเดียวแยกส่งหลายจุดรับบริจาค — ระบุจุดต่อรายการ และรับของทีละจุด
status: approved
date: 2026-10-27
updated: 2026-10-31 # amendment A2 proposed (staff-assigned drop-off points · board cards per item + point, #1056); A1 approved 2026-10-30
requested_by: "Kunanon Nusaeng — feedback จาก demo 2026-10-23 (epic #825, issue #813)"
decided_by: Soravit Sukkarn (Team Lead)
decision_date: 2026-10-28
layer: volatile
depends_on: "CR-205-storage-drop-off-points (#812, PR #944 · อนุมัติ 2026-10-28 — ต่อยอด `donations/domain/drop-off.ts` ของ #926) — ต้อง implement ก่อน"
affects:
  - docs/data/schema.md §2.4 `donation_campaign` — **Amendment A2:** `needs[].drop_off_point_id` · donation_campaign schema_v 3 → 4 · §2.3 ผู้เขียน `items[].drop_off_point_id` (ระบบจากแคมเปญ / เจ้าหน้าที่ตอนประเมิน) · api-contract.md §5 (`POST` booking request `items[].need_drop_off_point_id`, response `items[]`, ไม่มี `400 UNKNOWN_DROP_OFF_POINT`, body approve `lines[].drop_off_point_id`) · **Amendment A2:** couchdb-mongodb-sync.md `public_needs` (1 แถวต่อ ศูนย์ + `item_id` + `drop_off_point_id` · field `item_id`, `drop_off_point_id`) · api-contract.md `GET /public/v1/needs` (`drop_off_point_id`, `drop_off_point_name`) · `GET /external/v1/needs` shape เดิม · PROJECTION_VERSION 14 → 15
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
- **FR-MP-2a** — ตอนผู้บริจาคแก้รายการ (`PATCH …/{tracking_token}/items`): `id` ที่ไม่อยู่ในจุดรับบริจาคปัจจุบันของศูนย์ → BFF เขียน `null` ให้รายการนั้น ไม่ตอบ error (จุดอาจถูกเลิกติ๊กหลังจอง) · จุดรับบริจาคปัจจุบันอ่านจาก shelter doc ใน CouchDB = `common_areas.sub_storage[]` ที่ `accepts_donations = true` และมีพิกัด (กติกาเดียวกับ FR-DP-11) · **FastAPI ไม่ตรวจจุดตอนแก้รายการ** (Amendment A1 FR-MP-2b)
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
- **FR-MP-17b** — Amendment A1: `[query]/approve` ปฏิเสธรายการที่จุดรับไปแล้วไม่ได้ (`409 LINE_ALREADY_RECEIVED`)

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
  - `total_items` = จำนวนรายการทั้งใบ · `received_at` = เวลาปิด · `remarks` = `remarks` ของแต่ละ receipt ต่อกัน (เก็บใน CouchDB เท่านั้น ไม่ส่ง public plane — Amendment A1 FR-MP-27e)
  - `items[]` = รวม `point_receipts[].items` เรียงตาม `line_no` · รายการที่ไม่มีผล = `qty: "0"` ไม่มี `rejected`
  - `shortfalls` = `donationShortfall` เดิม ไม่นับรายการที่ `rejected` (CR-172 FR-13) · รายการที่ไม่มาจึงอยู่ใน `shortfalls`
  - `closed_by` (ชื่อเจ้าหน้าที่ หรือ `system` · CouchDB เท่านั้น ไม่ส่ง public plane) · `closed_reason`: `all_points` | `staff_close` | `expired`
- **FR-MP-27b** — สถานะตอนปิด: มีรายการที่รับจริง ≥ 1 → `received` · ไม่มีเลย (ทุกรายการไม่รับ หรือไม่รับปนไม่มา) → `rejected` + `reject_reason` / `reject_reason_code` ระดับใบตาม CR-172 FR-12
- **FR-MP-27c** — worker (`processor.py` สาย `doc_type == "donation"`) เรียก `settle_shelved_quota` เมื่อใบมีสถานะ `received` · ยอดจองของ shortfall จึงคืนทันที ไม่ต้องรอ ledger event ถัดไป (ใช้กับใบที่รับทั้งใบแล้วมี shortfall ด้วย)
- **FR-MP-27d** — ก่อนปิดใบ รายการที่จุด "ไม่รับ" ยังถูกจองอยู่ (`calculateReserved`, `compute_needs`, `still_owed` หักเฉพาะแถว ledger) · ตั้งใจ ไม่แก้กติกา T-22 ทั้ง 3 ชุด (TS, Python, `packages/needs-fixtures`) · ยอดคืนตอนปิดใบตาม FR-MP-27c
- **FR-MP-27e** — Amendment A1: `received_summary.remarks` ไม่ส่ง public plane
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
- ~~`received_summary.remarks` (หมายเหตุภายในของเจ้าหน้าที่) ถูกส่งไป public API เพราะ projector ส่ง `received_summary` ทั้งก้อน~~ — **แก้ใน CR นี้โดย Amendment A1 (FR-MP-27e)**: projector และ BFF ตัด `remarks` (และ `closed_by`) ออกจาก `received_summary` · CR นี้ไม่ส่ง `point_receipts[].remarks` ลง Mongo (ตาม §Change)

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

**Mongo `public_donations`** — `items_declared[].drop_off_point_id` และ `point_receipts[]` เฉพาะ `{ point_id, line_nos, received_at }` · `received_summary` ไม่มี `closed_by` / `remarks` (Amendment A1 FR-MP-27e)

**API (public)** — `items[].drop_off_point_id` (opt) ใน request ของ `POST /public/v1/donations` และ `PATCH …/{tracking_token}/items` · `items[].drop_off_point_id` และ `point_receipts[]` (`point_id`, `line_nos`, `received_at`) ใน response ของ `GET …/{tracking_token}` · error ใหม่ `400 UNKNOWN_DROP_OFF_POINT` (เฉพาะ `POST`)

**API (back-office)** — `POST /api/back-office/donations/[query]` เพิ่ม `point_id`, `line_nos` และ error `409 LINE_ALREADY_RECEIVED` · route ใหม่ `POST /api/back-office/donations/[query]/close` · `POST …/[query]/approve` เพิ่ม error `409 LINE_ALREADY_RECEIVED` (Amendment A1 FR-MP-17b)

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

## ข้อตกลง

Soravit Sukkarn (Team Lead) อนุมัติตามที่ผู้ขอเลือก (D-1 – D-12) เมื่อ 2026-10-28 ใน PR #945

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
| D-10 | เก็บผลการรับทีละจุดที่ไหน | `point_receipts[]` ระดับใบ (ผู้ขอเลือก 2026-10-28 · ไม่ใช้ `items[].received_at`) | FR-MP-5 – FR-MP-5b, FR-MP-22f |
| D-11 | รายการที่จุด "ไม่รับ" คืนยอดจองเมื่อไร | ตอนปิดใบ (ผู้ขอเลือก 2026-10-28 · ไม่คืนทันทีที่จุดบันทึก) | FR-MP-27d |
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
  - นอกขอบเขต: `received_summary.remarks` หลุดไป public API (มีอยู่แล้ว · แยก issue) — แก้ภายหลังใน Amendment A1 (2026-10-30)
  - ผู้ขอยืนยัน D-10 (`point_receipts[]`) และ D-11 (คืนยอดจองตอนปิดใบ) ตามที่ FR เขียนไว้ · ไม่ต้องแก้ FR
- 2026-10-28 — approved by Soravit Sukkarn (Team Lead) · รันเลข CR-206 (renumbered from draft-donation-multi-drop-off) ย้ายเข้า 04-donation/
- 2026-10-30 — **Amendment A1 approved (Soravit Sukkarn (Team Lead), review PR #1038)** — เจ้าของโครงการอนุมัติให้บันทึกเป็น amendment ใน CR นี้ (ไม่รันเลข CR ใหม่) · แก้ code ตามที่เจอใน review PR #1038:
  - B1 — `received_summary.remarks` (หมายเหตุของเจ้าหน้าที่ที่ต่อกันจาก `point_receipts[]`) ไม่ส่ง public plane: projector `project_received_summary` และ BFF `toTrackingReceivedSummary` ตัดทั้ง `closed_by` และ `remarks` · doc ใน CouchDB ยังมี · แทนข้อ "นอกขอบเขต" เรื่อง `remarks` หลุด (FR-MP-27e) · ไม่เปลี่ยน PROJECTION_VERSION (14 ของ branch นี้ยังไม่เคย release)
  - W1 — `PATCH /public/v1/donations/{token}/items` ของ FastAPI ไม่ตรวจจุดกับ Mongo `public_shelters` อีก (เรียกได้ผ่าน BFF เท่านั้น) · BFF ตรวจกับ shelter doc ใน CouchDB (FR-MP-2a) และเขียน `null` ให้จุดที่ศูนย์เลิกรับ เพราะ projection ใน Mongo ช้ากว่า doc และจะตัดจุดที่เจ้าหน้าที่เพิ่งเพิ่มทิ้ง · FR-MP-4 ยังตรวจใน FastAPI (FR-MP-2b)
  - W2 — `[query]/approve` ปฏิเสธรายการที่จุดรับไปแล้วไม่ได้: `409 LINE_ALREADY_RECEIVED` พร้อม `lines` (FR-MP-17b)
  - W3 ของ PR เดียวกันอยู่ที่ [CR-172](CR-172-donation-reject-reason.md) Amendment A1 (FR-12) · FR-MP-27b ใช้ FR-12 ฉบับแก้
- 2026-10-31 — **Amendment A2 proposed** (Kunanon Nusaeng): เจ้าหน้าที่กำหนดจุดรับบริจาคแทนผู้บริจาค · แคมเปญตั้งจุดต่อ need ตอนสร้างประกาศ (`donation_campaign` schema_v 3 → 4) · รายการที่บริจาคเองเลือกจุดตอนประเมิน · ร่างเดิมเป็น CR แยก (PR #1053 · รีวิว 5 รอบ) · team lead ตัดสินให้บันทึกเป็น amendment ของ CR นี้ (D-AP-1) · D-AP-2 – D-AP-14 รออนุมัติ

## Amendment A1 (2026-10-30) — `remarks` ไม่ออก public · แก้รายการไม่ตรวจจุดซ้ำใน FastAPI · ปฏิเสธรายการที่จุดรับแล้วไม่ได้ · **approved 2026-10-30 (Soravit Sukkarn (Team Lead), review PR #1038)**

> **สรุป:** (B1) ตัด `received_summary.remarks` ออกจาก public plane เหมือน `closed_by` · (W1) ย้ายการตรวจจุดตอนผู้บริจาคแก้รายการไปที่ BFF อย่างเดียว ·
> (W2) `approve` ตอบ `409 LINE_ALREADY_RECEIVED` เมื่อผลประเมินปฏิเสธรายการที่จุดรับไปแล้ว. ไม่เพิ่ม field · ไม่ bump `schema_v` · ไม่เปลี่ยน PROJECTION_VERSION
> (14 ของ branch นี้ยังไม่ release). เพิ่ม FR-MP-2b / FR-MP-17b / FR-MP-27e (ข้อความ FR เดิมคงไว้ด้านบน)

**ปัญหา (พบใน review PR #1038):** (B1) `remarks` ใน `received_summary` คือหมายเหตุภายในของเจ้าหน้าที่ที่ FR-MP-27a ต่อจากทุก receipt แต่ projector และ BFF ส่ง `received_summary`
ลง public ทั้งก้อน ·
(W1) FastAPI ตรวจจุดตอนแก้รายการกับ `public_shelters` ใน Mongo ซึ่งตามหลัง shelter doc ใน CouchDB — จุดที่เจ้าหน้าที่เพิ่งติ๊กรับบริจาคถูกเขียนเป็น `null` ·
(W2) ผลประเมินที่ปฏิเสธรายการซึ่งจุดรับไปแล้วทำให้ผู้บริจาคเห็น "ไม่รับ" ทั้งที่ของอยู่ในคลัง (receipt และ `received_summary` นับของรายการนั้นว่ารับ)

- **FR-MP-2b** (เพิ่มต่อ FR-MP-2a) — `PATCH /public/v1/donations/{tracking_token}/items` ของ FastAPI **ไม่ตรวจ** `drop_off_point_id` กับ `public_shelters.donation_points` · endpoint นี้เรียกได้ผ่าน BFF เท่านั้น (internal Bearer) ·
  BFF ตรวจกับ shelter doc ใน CouchDB ตาม FR-MP-2a แล้วเขียน `null` ให้ id ที่ศูนย์ไม่รับแล้ว ก่อนส่งต่อ FastAPI · FR-MP-4 (`parcel` / `shelter_pickup` ไม่มีจุด) ยังบังคับใน FastAPI · FR-MP-2 (ตอนจอง) ยังตรวจกับ Mongo ตามเดิม
- **FR-MP-15** (ชี้ FR-MP-2b) — "ตรวจตาม FR-MP-2a" = ตรวจที่ BFF ตาม FR-MP-2b
- **FR-MP-17b** — `POST /api/back-office/donations/[query]/approve`: ผลประเมิน (`lines`) ที่ตัดสิน `rejected` ให้รายการที่จุดรับไปแล้ว → `409 LINE_ALREADY_RECEIVED` พร้อม `lines: int[]` (index ของรายการที่ขัด, เริ่มที่ 0) · ไม่เขียนอะไร ·
  "จุดรับไปแล้ว" = `line_no` อยู่ใน `point_receipts[].line_nos` และ `items[]` ของ receipt นั้นของ `line_no` ไม่ใช่ `rejected: true` · รายการที่จุดเองไม่รับ (`rejected: true`) ปฏิเสธตอนประเมินได้ ·
  เช็คต่อจาก `409 GOODS_IN_STOCK` (FR-MP-17a) · เป็น code เดียวกับ `409 LINE_ALREADY_RECEIVED` ของ route รับของ (FR-MP-22e) แต่เงื่อนไขต่างกัน
- **FR-MP-27e** — `received_summary.remarks` เก็บใน CouchDB เท่านั้น: worker projector `project_received_summary` และ BFF `toTrackingReceivedSummary` ตัด `closed_by` **และ** `remarks` ออกจาก `received_summary` ·
  `public_donations.received_summary` และ response ของ `GET …/{tracking_token}` ไม่มี 2 key นี้ · key อื่น (`closed_reason`, `shortfalls`, `items[]`) ส่งตามเดิม · แทนข้อ "นอกขอบเขต" เรื่อง `remarks` หลุด

**Acceptance A1:** [ ] ใบที่ปิดแล้วมี `remarks` ใน receipt → `received_summary.remarks` อยู่ใน CouchDB · ไม่อยู่ใน `public_donations` และไม่อยู่ใน response ติดตาม (ทั้ง projector และ BFF) ·
[ ] ผู้บริจาคแก้รายการโดยเลือกจุดที่ศูนย์เพิ่งเพิ่ม (shelter doc มี Mongo ยังไม่ตาม) → จุดนั้นคงอยู่ · จุดที่ shelter doc ไม่รับแล้ว → `null` · `parcel` / `shelter_pickup` → `null` ทุกรายการ ·
[ ] `approve` ที่ปฏิเสธรายการซึ่งจุดรับไปแล้ว → `409 LINE_ALREADY_RECEIVED` พร้อม `lines` และใบไม่เปลี่ยน · ปฏิเสธรายการที่จุดไม่รับ → สำเร็จ

## Amendment A2 (2026-10-31) — เจ้าหน้าที่กำหนดจุดรับบริจาค (แคมเปญตั้งจุดตอนสร้างประกาศ · บริจาคเองเลือกจุดตอนประเมิน · ผู้บริจาคเห็นจุดจากการ์ดบนบอร์ด) · **proposed · รออนุมัติใน PR ของงาน 15** · issue #1056

> **ที่มา:** ร่างเป็น CR ใหม่ใน PR #1053 (รีวิว `/pr-code-review` 5 รอบ) แล้ว team lead ตัดสิน (2026-10-31) ให้บันทึกเป็น amendment ใน amendment นี้ · ข้อความ FR เดิมด้านบนคงไว้ · ID ของ amendment นี้ใช้ `FR-AP-*`, `AC-AP-*`, `D-AP-*` ไม่ชนกับ `FR-MP-*`, `AC-*`, `D-*` ของ CR-206
>
> **ขอบเขตเทียบ issue #1056:** #1056 ระบุเฉพาะรายการแคมเปญ · การเลือกจุดตอนประเมินให้รายการบริจาคเอง (FR-AP-17 – FR-AP-20a) อยู่นอก #1056 แต่ team lead เห็นด้วยให้รวมใน amendment นี้ (2026-10-31) · #1056 ให้ผู้บริจาคเห็นจุดแบบอ่านอย่างเดียวก่อนจอง → บอร์ดแยกการ์ดตามของ + จุด (FR-AP-25 – FR-AP-31) แทนข้อเสนอเดิม "ไม่เห็นจุดก่อนจอง"
>
> **แทนที่ (superseded) ใน CR-206:** FR-MP-2 (ส่วนตรวจตอนจอง) · FR-MP-2a (เฉพาะพฤติกรรมตอนแก้รายการ "BFF เขียน `null` ให้ id ที่ไม่อยู่" · นิยามจุดรับบริจาคปัจจุบันยังใช้) · FR-MP-2b (ประโยค "FR-MP-2 ยังตรวจกับ Mongo" และ "BFF ตรวจกับ shelter doc … เขียน `null`") · FR-MP-3 · FR-MP-8 – FR-MP-12 · FR-MP-15 (ตัวเลือกจุดใน dialog และ pointer ของ A1) · AC-1 – AC-3 · AC-13 (ข้อความ "ผู้บริจาคแก้รายการ … id ถูกเขียนเป็น null") · Acceptance A1 ข้อ 2
>
> **แก้ (amended) ใน CR-206:** FR-MP-16 (เพิ่มกลุ่ม "รอเจ้าหน้าที่กำหนดจุดส่ง") · AC-4 (กติกา `null` ยังอยู่ แต่ client ไม่ส่ง id แล้ว) · อื่นๆ ใน CR-206 (รับของทีละจุด ปิดใบ หมดอายุ redirect การจัดกลุ่มรายการที่รับแล้ว) ไม่เปลี่ยน
>
> **กระทบ CR อื่น:** CR-205 FR-DP-18 / AC-12 — หมุดจุดยังแสดง แต่แตะแล้วไม่เลือกจุด (FR-AP-11) · `public_needs` เดิม 1 แถวต่อ `{shelter}:{item_id}` (couchdb-mongodb-sync.md) → 1 แถวต่อของ + จุด (FR-AP-25)

### สรุป (TL;DR)

- **เปลี่ยน:** ผู้บริจาคไม่เลือกจุดรับบริจาคอีกต่อไป · รายการจากแคมเปญได้จุดที่เจ้าหน้าที่ตั้งไว้ใน need ของแคมเปญตอนสร้างประกาศ · รายการที่บริจาคเอง เจ้าหน้าที่เลือกจุดให้ตอนประเมิน · บอร์ดผู้บริจาคแยกการ์ดตามของ + จุด ผู้บริจาคเห็นจุดของรายการแคมเปญแบบอ่านอย่างเดียวก่อนจอง
- **เพื่อ:** เจ้าหน้าที่รู้ว่าแต่ละจุดเก็บของอะไรได้ ผู้บริจาคไม่รู้ · ลดของไปผิดจุด · ผู้บริจาครู้ก่อนจองว่าต้องนำของไปที่ไหน
- **dev ต้อง build:** field `needs[].drop_off_point_id` + dropdown ในฟอร์มแคมเปญ · worker แยกแถว `public_needs` ตามจุด · บอร์ดแสดงการ์ดต่อของ + จุด · ขั้น 3 แสดงจุดต่อรายการแบบอ่านอย่างเดียว · BFF จองเลือกแคมเปญที่ตรงกับจุดของการ์ด แล้วใส่จุดจากแคมเปญเอง · FastAPI คงจุดของรายการเดิมตอนแก้ · dropdown จุดในหน้าประเมิน + body approve · ลบตัวเลือกจุดฝั่งผู้บริจาค
- **กระทบ:** campaign schema_v 3 → 4 · PROJECTION_VERSION 14 → 15 (`public_needs`) · donation schema_v ไม่เปลี่ยน · `/external/v1/needs` shape เดิม · แก้ CR-206 ฝั่งผู้บริจาค · ฝั่งรับของทีละจุดของ CR-206 ไม่เปลี่ยน

### Why

- CR-206 ให้ผู้บริจาคเลือกจุดเองทีละรายการ (FR-MP-8) · ผู้บริจาคไม่รู้ว่าจุดไหนเก็บของประเภทไหน · เจ้าหน้าที่เป็นคนรู้
- แคมเปญเป็นของที่เจ้าหน้าที่ประกาศขอเอง จึงรู้ตั้งแต่ตอนสร้างว่าของชิ้นนั้นต้องไปจุดไหน
- ของที่ผู้บริจาคพิมพ์เองต้องผ่านหน้าประเมินอยู่แล้ว (CR-174 FR-2, FR-7) · เจ้าหน้าที่จึงเลือกจุดในขั้นเดียวกันได้โดยไม่เพิ่มขั้นตอน
- ใบเก็บ `items[].drop_off_point_id` อยู่แล้ว (CR-206 FR-MP-1) และหน้าสแกนรับทีละจุดอ่าน field นี้ (CR-206 FR-MP-19) · amendment นี้เปลี่ยนผู้เขียน field ไม่เปลี่ยน shape ของใบ
- #1056 ให้ผู้บริจาคเห็นจุดแบบอ่านอย่างเดียวก่อนจอง · บอร์ดเดิมรวมทุกแคมเปญของของชิ้นเดียวกันเป็นการ์ดเดียว และ BFF เลือกแคมเปญตอนจอง จึงบอกจุดก่อนจองไม่ได้เมื่อ 2 แคมเปญขอของชิ้นเดียวกันคนละจุด · แยกการ์ดตามของ + จุดทำให้การ์ดที่ผู้บริจาคกดบอกจุดได้แน่นอน
- การ์ดส่ง `need_drop_off_point_id` ไปกับรายการเพื่อบอกว่ากดการ์ดไหน · BFF ใช้ค่านี้กรองแคมเปญเท่านั้น จุดที่เขียนลงรายการยังมาจาก need ของแคมเปญ (FR-AP-8) · ผู้บริจาคจึงเลือกได้แค่การ์ดที่เจ้าหน้าที่ประกาศไว้ ไม่ได้เลือกจุดเอง

### Requirements

**คำที่ใช้**

- **รายการแคมเปญ** = รายการของใบที่มี `item_id` ตรงกับ need ในแคมเปญที่ผูกกับใบ (`donation.campaign_id`) · ถ้าแคมเปญมีหลาย need ที่ `item_id` เดียวกัน ใช้ need แรกในลำดับ `needs[]` · การ์ด (FR-AP-25) และตัวกรองแคมเปญ (FR-AP-7b) ถือว่าแคมเปญหนึ่งไม่มี need `item_id` ซ้ำคนละจุด · ฟอร์มปัจจุบันสร้าง 1 need ต่อแคมเปญจึงไม่เกิด · ถ้าฟอร์มรองรับหลาย need ภายหลังต้องแก้ข้อนี้
- **รายการบริจาคเอง** = รายการอื่นทั้งหมด (ไม่มี `item_id`, `item_id` ไม่อยู่ในแคมเปญของใบ หรือใบไม่มี `campaign_id`)
- **จุดปัจจุบันของศูนย์** = จุดรับบริจาคตามกติกา CR-206 FR-MP-2a: `common_areas.sub_storage[]` ของ shelter doc ใน CouchDB ที่ `accepts_donations = true` และมีพิกัด · route ฝั่ง server อ่านจาก registry · หน้า back-office อ่านจาก shelter doc ของศูนย์ที่เปิดอยู่
- **จุดของศูนย์บนหน้า public** (ฟอร์มจอง ตั๋ว หน้าติดตาม) = `public_shelters.donation_points` (projection · อาจตามหลัง CouchDB 1 รอบ worker) · ใช้ตัดสิน "ศูนย์มีจุด" และการจัดกลุ่มบนหน้า public · รายการ `approved` ที่จุดเพิ่งสร้างและ projection ยังไม่ตามทัน แสดงในกลุ่ม "ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" ชั่วคราว (CR-206 FR-MP-16) · รายการ `pending` แบบเดียวกันแสดงในกลุ่ม "รอ" ตาม FR-AP-22
- **ศูนย์มีจุด** = จุดปัจจุบันของศูนย์ ≥ 1
- ใบเดียวมีทั้งรายการแคมเปญและรายการบริจาคเองได้ · กติกาทั้งหมดใช้ต่อรายการ ไม่ใช่ต่อใบ
- ทุกที่ที่เขียน `drop_off_point_id` ให้เขียนค่า `null` ตรงๆ เมื่อไม่มีจุด (ไม่ละ key) · ตอนอ่าน ไม่มี key = `null`
- **การ์ด** = แถวหนึ่งของ `public_needs` / การ์ดหนึ่งใบบนบอร์ดผู้บริจาค · key = ศูนย์ + `item_id` + `drop_off_point_id` ของ need (`null` เป็นค่าหนึ่งของ key) · need ของหลายแคมเปญที่ของและจุดตรงกันรวมเป็นการ์ดเดียว
- **จุดของการ์ด** = `drop_off_point_id` ใน key ของการ์ด

**แคมเปญ (back-office)**

- **FR-AP-1** — `donation_campaign.needs[]` มี field ใหม่ `drop_off_point_id: str | null` · campaign `schema_v` 4
- **FR-AP-2** — ฟอร์มสร้างแคมเปญ (`create-campaign-form.svelte`) มี dropdown "จุดรับบริจาค" ของ need · ตัวเลือก = จุดปัจจุบันของศูนย์ · ศูนย์ไม่มีจุด → ไม่แสดง dropdown และเขียน `null`
- **FR-AP-2a** — ศูนย์มีจุดเดียว → เลือกจุดนั้นให้อัตโนมัติ (เปลี่ยนไม่ได้เพราะไม่มีตัวเลือกอื่น) · แทนเจตนาของ CR-206 FR-MP-10
- **FR-AP-3** — ศูนย์มีจุด → ปุ่มบันทึกกดไม่ได้จนกว่าจะเลือกจุด (D-AP-2)
- **FR-AP-4** — ฟอร์มแก้แคมเปญ (`edit-campaign-form.svelte`) แก้จุดของ need ได้ · `editNeed` เขียน `drop_off_point_id` ได้เพิ่มจาก `qty_target` / `unit`
- **FR-AP-4a** — ตอนแก้ ศูนย์มีจุด ≥ 2 และ need เป็น `null` หรือจุดไม่อยู่ในจุดปัจจุบัน → dropdown ว่าง และปุ่มบันทึกกดไม่ได้จนกว่าจะเลือกจุด (D-AP-2) · ศูนย์มีจุดเดียว → เลือกจุดนั้นให้ตาม FR-AP-2a
- **FR-AP-4b** — บันทึกการแก้แคมเปญเขียน `schema_v: 4` ให้ doc เสมอ (แคมเปญ v3 ที่ถูกแก้กลายเป็น v4)
- **FR-AP-5** — แก้จุดของ need มีผลกับรายการที่จองหลังแก้เท่านั้น · รายการที่จองไปแล้วคง `drop_off_point_id` เดิม รวมถึงตอนผู้บริจาคแก้ใบนั้น (FR-AP-15) (D-AP-4)
- **FR-AP-6** — บอร์ดแคมเปญฝั่งเจ้าหน้าที่ (`needs-board-admin.svelte`) แสดงชื่อจุดของแต่ละ need · ศูนย์มีจุด และ need เป็น `null` → ป้าย "ยังไม่ระบุจุด" · `drop_off_point_id` ไม่อยู่ในจุดปัจจุบัน → ป้าย "จุดถูกลบ"

**จอง (public)**

- **FR-AP-7** — BFF `POST /api/public/v1/donations` ไม่อ่าน `items[].drop_off_point_id` จาก request · ลบ field ออกจาก zod input (`donation.ts`) และ `buildDonationItemsPayload` (`public-donation.ts`) · client ส่งมาไม่มีผล
- **FR-AP-7a** — zod input ของรายการเพิ่ม `need_drop_off_point_id: string | null` (optional) = จุดของการ์ดที่ผู้บริจาคกด (FR-AP-28) · ไม่ส่ง key = ไม่ได้มาจากการ์ด · ส่ง `null` = การ์ดที่ไม่มีจุด · ใช้เฉพาะรายการที่มี `item_id` · ไม่เขียนลงใบและไม่ส่งต่อ FastAPI
- **FR-AP-7b** — ก่อน `pickCampaignForItems` BFF ตัดแคมเปญที่ไม่ตรงกับการ์ดออก: ทุกรายการที่ส่ง `need_drop_off_point_id` มา แคมเปญต้องมี need ที่ `item_id` ตรงกัน และ `drop_off_point_id` ของ need (ไม่มี key = `null`) เท่ากับค่านั้น · ไม่เหลือแคมเปญที่รับไหว → `409 NEED_FULL` พร้อม `item_id` เหมือนเดิม · **ห้ามย้ายไปแคมเปญของจุดอื่น** (D-AP-17) · ไม่มีรายการไหนส่ง key มา (client รุ่นเก่า, บริจาคเอง) → เลือกจากทุกแคมเปญเหมือนเดิม
- **FR-AP-8** — BFF คำนวณจุดของแต่ละรายการหลังเลือกแคมเปญ (`pickCampaignForItems` บนแคมเปญที่เหลือจาก FR-AP-7b) แล้วส่งต่อ FastAPI:
  - `logistics.delivery_method` ไม่ใช่ `self_dropoff` → `null` ทุกรายการ (CR-206 FR-MP-4 เดิม)
  - รายการแคมเปญ → `drop_off_point_id` ของ need ใน**แคมเปญที่เลือกให้ใบ** (ไม่ใช่แคมเปญอื่นที่ขอของชิ้นเดียวกัน)
  - รายการบริจาคเอง → `null`
  - BFF **ไม่อ่าน registry และไม่ตรวจ** ว่าจุดของ need ยังอยู่ในจุดปัจจุบันหรือไม่ (คง CR-017 §Decision A) · id ที่ไม่อยู่แล้วแสดงและรับตาม CR-206 FR-MP-16 / FR-MP-19 (D-AP-5, D-AP-10)
- **FR-AP-8a** — `DonationCreateResponse` (FastAPI) เพิ่ม `items: [{ drop_off_point_id: str | null, review_status: enum }]` เรียงตามลำดับรายการใน request · BFF ส่ง `items` ต่อใน response ของ `POST /api/public/v1/donations`
- **FR-AP-8b** — ฟอร์มจองเก็บ `items` ของ response ไว้ใน field ใหม่ `donationStore.bookedItems: { drop_off_point_id: string | null; review_status: string }[]` (เขียนพร้อม `trackingToken` / `bookingRef` / `bookingStatus` ใน `donor-time-selection-form.svelte` · ล้างพร้อม field เหล่านั้นตอนเริ่มใหม่) · ตั๋วหลังจอง (`public-donor-success-ticket.svelte`) จัดกลุ่มจาก `bookedItems` ไม่ใช่จาก `donationStore.items`
- **FR-AP-9** — กติกา FR-AP-8 อยู่ใน pure function เดียวใน `features/donations/domain/line-points.ts` · BFF จองและ BFF แก้รายการใช้ร่วมกัน
- **FR-AP-10** — FastAPI `create` เรียก `_drop_off_points` แบบเดียวกับ `update_items`: ไม่เทียบกับ `public_shelters.donation_points` · ไม่ตอบ `400 UNKNOWN_DROP_OFF_POINT` · ยังบังคับ `null` เมื่อวิธีส่งเป็น `parcel` / `shelter_pickup` · `DonationItemInput.drop_off_point_id` ยังรับค่าจาก BFF (D-AP-9) · ลบ branch `strict` และ `_offered_point_ids` ที่ไม่มีคนเรียกแล้ว และแก้ docstring ของ field
- **FR-AP-11** — ฟอร์มจองขั้น 3 ไม่มีตัวเลือกจุด (dropdown หรือแตะหมุดเพื่อเลือก) · หมุดจุดรับบริจาคบนแผนที่ขั้น 1 และขั้น 3 (CR-205 FR-DP-18) ยังแสดง แต่แตะแล้วแสดงชื่อจุดอย่างเดียว ไม่เลือกจุดให้รายการ · แทน CR-206 FR-MP-8 – FR-MP-12 (D-AP-7)
- **FR-AP-12** — ขั้น 3 ของใบ `self_dropoff` ในศูนย์ที่มีจุด แสดงจุดของแต่ละรายการแบบอ่านอย่างเดียว ด้วยการจัดกลุ่มเดียวกับตั๋ว (`groupDropOffDestinations` + `drop-off-groups.svelte` · FR-AP-22a) (D-AP-7):
  - รายการจากการ์ด → กลุ่มของจุดของการ์ด · จุดของการ์ดเป็น `null` หรือไม่อยู่ใน `public_shelters.donation_points` → กลุ่ม "ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" (CR-206 FR-MP-16)
  - รายการบริจาคเอง → กลุ่ม "รอเจ้าหน้าที่กำหนดจุดส่ง" (FR-AP-22)
  - แผนที่ขั้น 3 ซูมไปหมุดของกลุ่มแรกที่มีจุด · ไม่มีกลุ่มที่มีจุด → มุมมองของศูนย์
  - วิธีส่งไม่ใช่ `self_dropoff` → ไม่แสดงจุด (CR-206 FR-MP-4)
  - ลบข้อความ "จุดส่งของแต่ละรายการจะแจ้งในหน้าติดตาม"
- **FR-AP-12a** — จุดที่ขั้น 3 แสดงต้องเท่ากับจุดที่ใบได้หลังจอง: รายการจากการ์ดได้จุดของการ์ดเสมอ (FR-AP-7b, FR-AP-8) · ตั๋วยังจัดกลุ่มจาก response (FR-AP-8b) ไม่ใช่จาก store
- **FR-AP-13** — store ฟอร์มจอง (`donation.svelte.ts`) ไม่เก็บ `dropOffPointId` และ `tappedPointId` · รายการที่สร้างจากการ์ดเก็บ `needDropOffPointId` (จุดของการ์ด) และ `buildDonationItemsPayload` ส่งเป็น `need_drop_off_point_id` (FR-AP-7a)

**ผู้บริจาคแก้รายการ**

- **FR-AP-14** — dialog แก้รายการ (`edit-donation-items-dialog.svelte`) ไม่มีตัวเลือกจุด · แทนส่วน "ตัวเลือกจุดต่อรายการ" ของ CR-206 FR-MP-15
- **FR-AP-15** — FastAPI `update_items` คงจุดของรายการเดิม: รายการที่จับคู่กับรายการเดิมด้วย `line_key` (CR-196 FR-LK-5, `_pair_held_lines`) **และ** `item_id` ไม่เปลี่ยน (เทียบหลัง `_carry_item_ids` / `_pair_held_lines` เติม `item_id` ของรายการเดิมให้รายการที่ request ไม่ส่ง · ทั้งคู่ไม่มี `item_id` นับว่าไม่เปลี่ยน) → ได้ `drop_off_point_id` ของรายการเดิม รวมค่า `null` ไม่ว่า request ส่งอะไรมา · `item_id` เปลี่ยน (ผู้บริจาคเลือกสินค้าให้แถวที่พิมพ์เอง) → ใช้ค่าใน request ตาม FR-AP-15a
- **FR-AP-15a** — BFF `PATCH …/{tracking_token}/items` คำนวณ `drop_off_point_id` ของทุกรายการตาม FR-AP-8 บน `resolvedItems` (หลัง `carryItemIds`) ด้วย `campaign_id` และ `delivery_method` ของใบใน CouchDB · อ่านแคมเปญด้วย id แยกจากการอ่าน headroom (ที่กรองเฉพาะ `open`) ไม่ว่าสถานะ `open` หรือ `closed` · อ่านแคมเปญไม่ได้ → `503 DONATION_UNAVAILABLE` (เหมือนการอ่านแบบ strict เดิมของ route) · doc แคมเปญไม่มีแล้ว หรือใบยังไม่ถึง CouchDB (ช่วง 1 รอบ inbound) → `null` · ยอมรับว่ารายการแคมเปญที่เพิ่มในช่วงนี้อาจได้ `approved` อัตโนมัติ (FR-AP-16) โดยไม่มีจุดและไม่ผ่านหน้าประเมิน · รายการนั้นรับที่จุดไหนก็ได้ (CR-206 FR-MP-19)
- **FR-AP-15b** — BFF เขียน `drop_off_point_id` ตาม FR-AP-15a ทับทุกรายการใน payload ก่อนส่ง FastAPI · FastAPI เลือกใช้ค่าเดิมหรือค่านี้ตาม FR-AP-15 · ลบ `withOfferedPoints` และการอ่าน registry ใน route นี้
- **FR-AP-15c** — ใบที่รายการเดิมไม่มี `line_key` (สร้างก่อน donation schema_v 8 · CR-196 FR-LK-7) ทุกรายการนับเป็นรายการใหม่ จึงคำนวณจุดใหม่ตาม FR-AP-15a · ยอมรับได้เพราะใบรุ่นนั้นหมดอายุไปแล้วตาม TTL ของการจอง
- **FR-AP-16** — กติกาว่าใบไหนแก้รายการได้คงเดิม (CR-196 FR-LK-4, CR-206 FR-MP-17) · ใบที่แก้ได้มีแต่รายการ `pending` · หลังแก้ รายการที่ได้ `approved` อัตโนมัติคือรายการแคมเปญที่ counter พร้อมแล้ว: รายการใหม่ หรือรายการเดิมที่ `item_id` เปลี่ยน → จุดตาม FR-AP-15a · รายการเดิมที่เป็นรายการแคมเปญอยู่แล้ว (ก่อนหน้า `pending` เพราะ `NOT_SEEDED`) → จุดเดิมตาม FR-AP-15

**ประเมิน (back-office)**

- **FR-AP-17** — body ของ `POST /api/back-office/donations/[query]/approve` · `lines[]` เพิ่ม `drop_off_point_id: str | null` (optional)
  1. **schema validation** (`lineReviewDecisionSchema` · ตอน parse body เหมือน `INVALID_REVIEW` เดิม คือหลัง stale check และ `INVALID_TRANSITION` ก่อนข้อ 2–5): ส่ง `drop_off_point_id` (รวมค่า `null`) คู่กับ `decision: rejected` → `422 INVALID_REVIEW`
  - ข้อ 2–5 เช็คหลังเช็คเดิมทั้งหมด (`INVALID_TRANSITION`, `INVALID_REVIEW`, `GOODS_IN_STOCK`, `LINE_ALREADY_RECEIVED`) ตามลำดับ:
  2. วิธีส่งไม่ใช่ `self_dropoff` → route เขียน `null` ให้รายการที่อนุมัติ (ยกเว้นรายการตามข้อ 3) ไม่สนค่าใน body และไม่เช็คข้อ 4–5
  3. รายการที่อยู่ใน `point_receipts[].line_nos` แล้ว (รับที่หน้าสแกนก่อนประเมิน) → ไม่บังคับจุดและไม่เขียนทับ · ส่ง `drop_off_point_id` มา → `422 INVALID_REVIEW` (D-AP-13)
  4. ค่าที่ไม่ใช่ `null` ต้องอยู่ในจุดปัจจุบันของศูนย์ของใบ · ไม่อยู่ → `422 UNKNOWN_DROP_OFF_POINT`
  5. ศูนย์มีจุด · รายการที่อนุมัติไม่มีจุด → `422 POINT_REQUIRED` · "ไม่มีจุด" = ส่ง `null` หรือไม่ส่ง field และรายการเป็น `null` หรือจุดที่ไม่อยู่ในจุดปัจจุบัน · ไม่ส่ง field และรายการมีจุดปัจจุบันอยู่แล้ว = ใช้จุดเดิม (D-AP-3) · "มีจุดอยู่แล้ว" = รายการแคมเปญ หรือรายการของใบที่จองก่อน amendment นี้ซึ่งผู้บริจาคเลือกจุดไว้ (ตั้งใจให้ผ่าน · ผู้บริจาคได้ตั๋วที่บอกจุดนั้นแล้ว)
  - error ใช้ key `error_code` เหมือน error อื่นของ route · `422 POINT_REQUIRED` / `UNKNOWN_DROP_OFF_POINT` เป็นชื่อเดียวกับ route รับของ (CR-206 FR-MP-22a) แต่เงื่อนไขต่างกัน
  - route อ่านจุดปัจจุบันเฉพาะเมื่อวิธีส่งเป็น `self_dropoff` และมีรายการที่ต้องเช็คตามข้อ 4–5 หรือ FR-AP-17a ข้อแรก · การปฏิเสธรายการและใบที่ไม่ใช่ `self_dropoff` ไม่อ่าน registry
  - อ่านจุดปัจจุบันไม่ได้ (`findMasterByCode` throw `ServiceError`) → route map เป็น `503 DONATION_UNAVAILABLE` · ไม่เขียนอะไร
- **FR-AP-17a** — body ไม่มี `lines` (D-AP-12):
  - ใบที่ประเมินทีละรายการ (มี `review_status`) · ศูนย์มีจุด · วิธีส่ง `self_dropoff` · มีรายการ `pending` ที่ไม่มีจุดปัจจุบัน (ไม่นับรายการตาม FR-AP-17 ข้อ 3) → `422 POINT_REQUIRED` · กฎ `503` ของ FR-AP-17 ใช้ด้วย
  - ใบที่ประเมินทีละรายการ กรณีอื่น → อนุมัติรายการ `pending` ทั้งหมดเหมือนเดิม · จุดของรายการคงเดิม
  - ใบก่อน schema_v 7 (ไม่มี `review_status`) → อนุมัติทั้งใบเหมือนเดิม · ไม่บังคับและไม่เขียนจุด · รายการเป็น `null` จึงรับที่จุดไหนก็ได้ (CR-206 FR-MP-19)
- **FR-AP-18** — route approve เขียน `items[i].drop_off_point_id` ของรายการที่อนุมัติใน PUT เดียวกับ `review_status` · รายการที่ปฏิเสธ รายการที่ไม่อยู่ใน `lines` และรายการตาม FR-AP-17 ข้อ 3 ไม่แก้จุด
- **FR-AP-19** — audit ของการประเมินเพิ่ม `context.lines[].drop_off_point_id` = ค่าที่เขียนลงรายการ · รายการที่ปฏิเสธ และรายการตาม FR-AP-17 ข้อ 3 (ไม่เขียนจุด) = `null` · ทางไม่มี `lines` คง audit เดิม (`lines: []`)
- **FR-AP-20** — หน้าประเมิน (`pending-review-detail.svelte`) มี dropdown จุดต่อรายการ `pending` ที่กดอนุมัติ · แสดงเมื่อศูนย์มีจุด และวิธีส่งเป็น `self_dropoff`
  - ตัวเลือก = จุดปัจจุบันของศูนย์ · ศูนย์มีจุดเดียว → เลือกให้อัตโนมัติ (D-AP-11)
  - ค่าเริ่มต้น: รายการที่มีจุดปัจจุบันอยู่แล้ว (ตามนิยามใน FR-AP-17 ข้อ 5) = จุดนั้น · รายการอื่น หรือจุดเดิมไม่อยู่แล้ว = ว่าง
  - ปุ่มยืนยันกดไม่ได้จนทุกรายการที่อนุมัติมีจุด
  - รายการที่บันทึกผลที่หน้าสแกนแล้ว แสดงจุดที่รับแบบ read-only (FR-AP-17 ข้อ 3)
  - รายการ `approved` อยู่แล้ว (อนุมัติอัตโนมัติ) แสดงชื่อจุดแบบ read-only (CR-206 FR-MP-25 ไม่เปลี่ยน)
- **FR-AP-20a** — แถวในคิวประเมิน (`PendingDonationRow` ใน `donations/domain/back-office.ts`) เพิ่ม `point_receipts: { point_id: string | null; line_nos: number[] }[]` · `toPendingRow` (`routes/api/back-office/donations/+server.ts`) copy จากใบ (ไม่มี key = `[]`) · หน้าประเมินใช้ field นี้ตัดสินรายการตาม FR-AP-17 ข้อ 3 และชื่อจุดที่รับ
- **FR-AP-21** — เปลี่ยนจุดของรายการที่ `approved` แล้ว (รวมใบแคมเปญล้วนที่ขึ้น `verifying` ทันที) อยู่นอกขอบเขต · ผู้บริจาคนำของมาผิดจุดใช้ปุ่ม "รับรายการของจุดอื่น" (CR-206 FR-MP-21) (D-AP-6)

**หลังจอง (ฝั่งผู้บริจาค)**

- **FR-AP-22** — ตั๋วและหน้าติดตามของใบ `self_dropoff` ในศูนย์ที่มีจุด: รายการ `pending` ที่ยังไม่บันทึกผล และไม่มีจุด (`null` หรือจุดไม่อยู่ในจุดของศูนย์บนหน้า public) อยู่ในกลุ่ม "รอเจ้าหน้าที่กำหนดจุดส่ง" · กลุ่มนี้แสดงข้อความ "ถ้านำของมาก่อนเจ้าหน้าที่ประเมิน ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" และที่อยู่ศูนย์ (ตรงกับ CR-206 FR-MP-19: รายการไม่ระบุจุด จุดไหนก็รับได้)
- **FR-AP-22b** — รายการ `pending` ที่มีจุดอยู่แล้ว (รายการแคมเปญ `NOT_SEEDED`) อยู่ในกลุ่มของจุดนั้นตาม CR-206 FR-MP-13 · ถ้าเจ้าหน้าที่เปลี่ยนจุดตอนประเมิน หน้าติดตามแสดงจุดใหม่
- **FR-AP-22a** — `groupDropOffDestinations` (`line-points.ts`):
  - เพิ่ม `opts.deliveryMethod` · กลุ่ม "รอ" ใช้เฉพาะ `self_dropoff` (หน้าติดตามเรียก function นี้กับ `parcel` ด้วย ผ่าน `needsDropOffDestination`)
  - key ใหม่ `AWAITING_STAFF_KEY` (แยกจาก `ANY_POINT_KEY` / `AT_SHELTER_KEY`) · เรียงกลุ่มนี้ไว้หลังกลุ่มอื่นทั้งหมด
  - เพิ่ม `opts.awaitingName` · `point` ของกลุ่ม = `{ ...resolveDropOffPoint(shelter), name: awaitingName }` (แบบเดียวกับกลุ่ม "ไหนก็ได้" ใน `lineDestinationResolver`) · `anyPoint: true` · `status: 'pending'`
  - `drop-off-groups.svelte` แยกกลุ่มนี้ด้วย `key === AWAITING_STAFF_KEY` · แสดงข้อความตาม FR-AP-22 · ไม่แสดงป้ายสถานะ "รอรับ" · ชื่อกลุ่มและข้อความอยู่ใน `lib/constants/i18n/public-donations.ts`
  - คืนกลุ่ม (ไม่ใช่ `null`) เมื่อมีรายการที่มีจุด **หรือ** มีรายการตาม FR-AP-22
  - รายการที่บันทึกผลแล้วใน `point_receipts` จัดกลุ่มตามกติกาเดิมของ CR-206 (ไม่แก้): receipt `point_id` เป็น `null` → `AT_SHELTER_KEY` · อื่นๆ → จุดของรายการ หรือ `ANY_POINT_KEY` (`line-points.ts:165-168`) · ไม่เข้ากลุ่ม "รอ" แม้ยัง `pending`
  - รายการ `null` อื่นอยู่ในกลุ่ม "ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" ตาม CR-206 FR-MP-16
- **FR-AP-23** — หลังประเมิน ตั๋ว หน้าติดตาม และใบปะหน้าอ่าน `drop_off_point_id` ตาม CR-206 FR-MP-13, FR-MP-14, FR-MP-16 เดิม

**บอร์ดผู้บริจาค (public)**

- **FR-AP-25** — worker projector `public_needs` (`worker/src/worker/projectors/needs.py`) เขียน 1 แถวต่อการ์ด (ศูนย์ + `item_id` + `drop_off_point_id` ของ need):
  - `_id` = `{shelter}:{item_id}@{drop_off_point_id}` · `null` ใช้ `-` แทน id (`{shelter}:{item_id}@-`)
  - field ใหม่ `item_id: str` และ `drop_off_point_id: str | null` · FastAPI อ่าน `item_id` จาก field ไม่แยกจาก `_id`
  - `qty_needed`, `qty_target`, `reserved` คิดจาก need ของการ์ดนั้นเท่านั้น ด้วยสูตรเดิมของ `compute_needs` / `need_breakdown` (ไม่แก้สองฟังก์ชันนี้ · เรียกกับแคมเปญที่กรอง `needs[]` เหลือจุดเดียว) · `on_hand` = ยอดคลังของของนั้นทั้งศูนย์ เหมือนเดิม · `urgency` = สูงสุดของแคมเปญที่มี need ในการ์ด
  - การ์ดที่ `qty_needed ≤ 0` ถูกลบเหมือนเดิม
- **FR-AP-25a** — แถวที่ไม่ตรงกับการ์ดปัจจุบันของศูนย์ต้องถูกลบ: แถวรูปแบบเดิม `{shelter}:{item_id}` · แถวของจุดที่ need ถูกแก้ไปจุดอื่น · แถวของแคมเปญที่ปิดหรือซ่อน
- **FR-AP-25b** — PROJECTION_VERSION 14 → 15 · tent-model `PublicNeed` เพิ่ม `item_id` และ `drop_off_point_id` (default `None` ให้แถวเก่าโหลดได้)
- **FR-AP-26** — FastAPI `GET /public/v1/needs`: `NeedItemResponse` เพิ่ม `drop_off_point_id: str | null` และ `drop_off_point_name: str | null` · ชื่ออ่านจาก `public_shelters.donation_points` ของศูนย์ · id เป็น `null` หรือไม่อยู่ในจุดของศูนย์ → ชื่อเป็น `null` · ศูนย์เดียวมีหลายแถวที่ `item_id` เดียวกันได้
- **FR-AP-27** — FastAPI `GET /external/v1/needs` คง shape เดิม: 1 แถวต่อศูนย์ + `item_id` · ไม่มี field จุด · รวมแถวของ FR-AP-25 กลับ: `qty_needed`, `qty_target`, `reserved` = ผลรวม · `on_hand` = ค่าของแถวใดก็ได้ (เท่ากันทุกแถว) · `urgency` = สูงสุด · `status` = `open` เมื่อผลรวม `qty_needed` > 0 (D-AP-16)
- **FR-AP-28** — บอร์ดผู้บริจาค (`public-donor-needs.svelte`) แสดงการ์ดต่อแถว · key ของ `{#each}` = `item_id` + `drop_off_point_id` · การ์ดที่ `drop_off_point_name` ไม่เป็น `null` แสดง "จุดรับบริจาค: {ชื่อ}" ใต้ชื่อของ · กดบริจาคจากการ์ด (`donateSingleNeed`) เก็บจุดของการ์ดลงรายการตาม FR-AP-13
- **FR-AP-29** — ทุกที่ที่อ่าน `/api/public/v1/needs` ต้องไม่ถือว่า `item_id` ไม่ซ้ำในศูนย์เดียว: หน้าแรก `(public)/+page.ts`, `public-portal/domain/donation-map.ts`, `donations/data/public-needs.ts` · จำนวนของ / ความเร่งด่วนต่อศูนย์บนแผนที่นับต่อ `item_id` ไม่ใช่ต่อการ์ด
- **FR-AP-30** — `/api/public/v1/needs` (BFF) ส่ง field ใหม่ต่อโดยไม่แปลง · regenerate OpenAPI (`fastapi.json`, `openapi.d.ts`)
- **FR-AP-31** — ยอด "ต้องการอีก" ของการ์ด (FR-AP-25) ต้องตรงกับยอดที่ BFF ใช้ตรวจ `NEED_FULL` ของการ์ดนั้น (FR-AP-7b · `computeNeeds` บนแคมเปญที่ตรงกับการ์ด) · unit test ของ worker และของ BFF ใช้เคสเดียวกัน (2 แคมเปญขอข้าวคนละจุด, 2 แคมเปญขอข้าวจุดเดียวกัน) · ไม่แก้กติกา T-22 ใน `packages/needs-fixtures`

**ไม่เปลี่ยน**

- **FR-AP-24** — รับของทีละจุด ปิดใบ หมดอายุ redirect (CR-206 FR-MP-17a – FR-MP-30) · route `[query]/reject` (ปฏิเสธทั้งใบไม่แก้จุด) · walk-in (CR-206 FR-MP-7) · shape ของ `donation` · `public_donations` · counter โควต้า (`donation_need_counter` ต่อแคมเปญ + `item_id`)

### Change (before → after)

**CouchDB `donation_campaign.needs[]`**

| field | ชนิด | ค่าเมื่อไม่มี key | กติกา |
| --- | --- | --- | --- |
| `drop_off_point_id` | str \| null | `null` (= ไม่ระบุจุด) | FR-AP-1 – FR-AP-5 |

- ก่อน: `needs: [{ item_id: 'item:rice', qty_target: '100', unit: 'kg', status: 'open' }]` · `schema_v: 3`
- หลัง: `needs: [{ item_id: 'item:rice', qty_target: '100', unit: 'kg', status: 'open', drop_off_point_id: '01J…GYM' }]` · `schema_v: 4`

**CouchDB `donation.items[].drop_off_point_id`** — shape เดิม · donation schema_v ยัง 11 (D-AP-8)

| จังหวะ | ก่อน (CR-206) | หลัง |
| --- | --- | --- |
| จอง | ผู้บริจาคเลือก · BFF ส่งต่อ · FastAPI ตรวจกับ Mongo | BFF คำนวณจากแคมเปญ (FR-AP-8) · FastAPI ไม่ตรวจกับ Mongo (FR-AP-10) |
| ผู้บริจาคแก้รายการ | ผู้บริจาคเลือก · BFF ล้าง id ที่ไม่อยู่แล้ว | รายการเดิมที่ `item_id` ไม่เปลี่ยนคงจุด (FR-AP-15) · รายการใหม่และรายการที่ `item_id` เปลี่ยนคำนวณจากแคมเปญ (FR-AP-15a) |
| ประเมิน | แสดงอย่างเดียว | เจ้าหน้าที่เลือกให้รายการที่อนุมัติ (FR-AP-17, FR-AP-18) |

ตัวอย่างใบผสม (ศูนย์มีจุด "โรงยิม" และ "ห้องพยาบาล" · แคมเปญข้าวตั้งจุดโรงยิม):

- จอง: ข้าว 10 กก. (รายการแคมเปญ) + ผ้าห่ม 5 ผืน (พิมพ์เอง) → `items: [{ …ข้าว, review_status: 'approved', drop_off_point_id: '01J…GYM' }, { …ผ้าห่ม, review_status: 'pending', drop_off_point_id: null }]` · ใบ `pending_review` · ตั๋วแสดงกลุ่ม "โรงยิม" (ข้าว) และ "รอเจ้าหน้าที่กำหนดจุดส่ง" (ผ้าห่ม)
- ประเมิน: `lines: [{ index: 1, decision: 'approved', drop_off_point_id: '01J…MED' }]` → `items[1].drop_off_point_id: '01J…MED'` · ใบ `verifying`
- รับของ: เหมือน CR-206 AC-5 / AC-6

**API**

| endpoint | ก่อน | หลัง |
| --- | --- | --- |
| BFF `POST /api/public/v1/donations` request | รับ `items[].drop_off_point_id` | ไม่รับ (FR-AP-7) · เพิ่ม `items[].need_drop_off_point_id` ใช้กรองแคมเปญ (FR-AP-7a, FR-AP-7b) |
| FastAPI `GET /public/v1/needs` (+ BFF `/api/public/v1/needs`) | 1 แถวต่อ `item_id` ในศูนย์ | 1 แถวต่อการ์ด · เพิ่ม `drop_off_point_id`, `drop_off_point_name` (FR-AP-26) |
| FastAPI `GET /external/v1/needs` | 1 แถวต่อ `item_id` ในศูนย์ | ไม่เปลี่ยน shape · รวมแถวการ์ดกลับ (FR-AP-27) |
| BFF `POST /api/public/v1/donations` response | `trackingToken`, `bookingRef`, `status` | เพิ่ม `items[]` (FR-AP-8a) |
| FastAPI `POST /public/v1/donations` | `400 UNKNOWN_DROP_OFF_POINT` · response ไม่มี `items` | ไม่มี error นี้ (FR-AP-10) · response เพิ่ม `items[]` (FR-AP-8a) |
| BFF `PATCH /api/public/v1/donations/{tracking_token}/items` | รับ `items[].drop_off_point_id` · อ่าน registry · `503` เมื่ออ่านไม่ได้ | ไม่รับ · ไม่อ่าน registry (FR-AP-15b) · `503 DONATION_UNAVAILABLE` เมื่ออ่านแคมเปญไม่ได้ (FR-AP-15a) |
| FastAPI `PATCH /public/v1/donations/{tracking_token}/items` | ใช้จุดจาก request | รายการเดิมที่ `item_id` ไม่เปลี่ยนใช้จุดเดิม · รายการอื่นใช้จุดจาก request (FR-AP-15) |
| `POST /api/back-office/donations/[query]/approve` | `lines[]` = `{index, decision, reason_code?, note?}` | เพิ่ม `drop_off_point_id?` · `422 UNKNOWN_DROP_OFF_POINT`, `422 POINT_REQUIRED`, `503 DONATION_UNAVAILABLE` (FR-AP-17, FR-AP-17a) |

**Mongo `public_needs`** — PROJECTION_VERSION 14 → 15 (FR-AP-25 – FR-AP-25b) · `public_donations` ไม่เปลี่ยน

ตัวอย่าง (ศูนย์ SH001 · แคมเปญ ก ข้าว 20 กก. จุดโรงยิม · แคมเปญ ข ข้าว 50 กก. จุดโรงยิม · แคมเปญ ค ข้าว 30 กก. จุดอาคาร A · คลังไม่มีข้าว · ยังไม่มีใครจอง):

- ก่อน: `{ _id: 'SH001:item:rice', qty_needed: 100, … }`
- หลัง: `{ _id: 'SH001:item:rice@01J…GYM', item_id: 'item:rice', drop_off_point_id: '01J…GYM', qty_needed: 70, … }` และ `{ _id: 'SH001:item:rice@01J…BLDA', item_id: 'item:rice', drop_off_point_id: '01J…BLDA', qty_needed: 30, … }`
- `/external/v1/needs` ยังได้ `{ item_id: 'item:rice', qty_needed: '100', … }` แถวเดียว

### Acceptance

**แคมเปญ**

- **AC-AP-1** — ศูนย์มี 2 จุด · สร้างแคมเปญข้าวโดยไม่เลือกจุด → บันทึกไม่ได้ · เลือกโรงยิมแล้วบันทึก → `needs[0].drop_off_point_id` = โรงยิม · `schema_v: 4`
- **AC-AP-2** — ศูนย์ไม่มีจุด → ฟอร์มแคมเปญไม่มี dropdown · `needs[0].drop_off_point_id: null`
- **AC-AP-2a** — ศูนย์มีจุดเดียว → ฟอร์มแคมเปญและหน้าประเมินเลือกจุดนั้นให้เอง
- **AC-AP-2b** — แก้แคมเปญ v3 ที่ need เป็น `null` ในศูนย์ที่มีจุด → ต้องเลือกจุดก่อนบันทึก · บันทึกแล้ว doc เป็น `schema_v: 4`
- **AC-AP-2c** — บอร์ดแคมเปญ: need `null` ในศูนย์ที่มีจุด → ป้าย "ยังไม่ระบุจุด" · need ที่จุดถูกเลิกติ๊ก → ป้าย "จุดถูกลบ"

**จอง**

- **AC-AP-3** — ผู้บริจาคจองข้าวจากการ์ด "ข้าว · จุดรับบริจาค: โรงยิม" → ขั้น 3 แสดงข้าวในกลุ่มโรงยิมแบบอ่านอย่างเดียว และไม่มีตัวเลือกจุด · response มี `items[0].drop_off_point_id` = โรงยิม · ใบ `verifying` · ตั๋วแสดงกลุ่มโรงยิม
- **AC-AP-4** — 2 แคมเปญขอข้าว (A จุดโรงยิม, B จุดห้องพยาบาล) → บอร์ดมี 2 การ์ด · จองจากการ์ดห้องพยาบาล → ใบผูกแคมเปญ B · รายการข้าวได้ห้องพยาบาล
- **AC-AP-4a** — แคมเปญ ก และ ข ขอข้าวที่โรงยิมทั้งคู่ → บอร์ดมีการ์ดข้าว-โรงยิมใบเดียว · ยอด "ต้องการอีก" = ผลรวมของ ก และ ข
- **AC-AP-4b** — การ์ดห้องพยาบาลเต็มระหว่างที่ผู้บริจาคกรอกฟอร์ม แต่การ์ดโรงยิมยังรับได้ → `409 NEED_FULL` · ใบไม่ถูกสร้าง · ไม่ย้ายไปแคมเปญโรงยิม
- **AC-AP-4c** — request จองไม่มี `need_drop_off_point_id` (client รุ่นเก่า) → BFF เลือกแคมเปญจากทุกแคมเปญเหมือนก่อน amendment นี้ · รายการได้จุดตาม FR-AP-8
- **AC-AP-4d** — แก้จุดของ need แคมเปญ ก จากโรงยิมเป็นอาคาร A → หลัง worker รอบถัดไป แถว `…@โรงยิม` ของ ก หายจาก `public_needs` (หรือลดยอด ถ้ายังมีแคมเปญอื่นที่โรงยิม) · มีแถว `…@อาคาร A`
- **AC-AP-4e** — หลัง deploy ไม่มีแถว `_id` รูปแบบเดิม `{shelter}:{item_id}` เหลือใน `public_needs`
- **AC-AP-4f** — `/external/v1/needs` ของศูนย์ใน AC-AP-4 ได้ข้าวแถวเดียว · `qty_needed` = ผลรวมของ 2 การ์ด · ไม่มี field จุด
- **AC-AP-4g** — การ์ดของแคมเปญเก่าที่ need ไม่มีจุด ในศูนย์ที่มีจุด → การ์ดไม่แสดงชื่อจุด · ขั้น 3 แสดงรายการในกลุ่ม "ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" · ตั๋วหลังจองของใบที่ทุกรายการไม่มีจุดแสดงที่อยู่ศูนย์ตาม CR-206 เดิม (ไม่จัดกลุ่ม) · จุดที่ใบได้ยังเป็น `null` ตรงกับขั้น 3 (FR-AP-12a)
- **AC-AP-4h** — บริจาคของอื่น (ไม่ได้มาจากการ์ด) 2 รายการแบบ `self_dropoff` ในศูนย์ที่มีจุด → ขั้น 3 แสดงทั้งสองรายการในกลุ่ม "รอเจ้าหน้าที่กำหนดจุดส่ง" · เลือก `parcel` → ขั้น 3 ไม่แสดงจุด
- **AC-AP-5** — request จองส่ง `drop_off_point_id` มาเอง → ไม่มีผล · ใบได้จุดตาม FR-AP-8
- **AC-AP-6** — จุดของ need ถูกเลิกติ๊กหลังสร้างแคมเปญ แล้วมีคนจอง → จองสำเร็จ · รายการเก็บ id นั้น · หน้าติดตามแสดงรายการในกลุ่ม "ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" · ทุกจุดรับได้
- **AC-AP-7** — จุดถูกสร้างใน CouchDB แต่ `public_shelters` ยังไม่อัปเดต แล้วแคมเปญใช้จุดนั้น → จองสำเร็จ ไม่ได้ `400` · รายการ `approved` แสดงบนตั๋วในกลุ่ม "ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" จน projection ตามทัน แล้วหน้าติดตามแสดงกลุ่มของจุดนั้น
- **AC-AP-8** — จอง `parcel` ของแคมเปญที่มีจุด → ทุกรายการ `null`

**บริจาคเองและประเมิน**

- **AC-AP-9** — ศูนย์มีจุด · ผู้บริจาคบริจาคเอง 2 รายการแบบ `self_dropoff` → ใบ `pending_review` · ทุกรายการ `null` · ตั๋วและหน้าติดตามแสดงกลุ่ม "รอเจ้าหน้าที่กำหนดจุดส่ง" พร้อมข้อความตาม FR-AP-22 · บริจาคเองแบบ `parcel` → ไม่มีกลุ่ม "รอ"
- **AC-AP-10** — ต่อจาก AC-AP-9 เจ้าหน้าที่อนุมัติรายการ 1 ไปโรงยิม รายการ 2 ไปห้องพยาบาล → `items[]` มีจุดตามที่เลือก · ใบ `verifying` · หน้าติดตามแสดง 2 กลุ่ม · ใบปะหน้า 2 ใบ · audit `context.lines[]` มี `drop_off_point_id` ตรงกัน
- **AC-AP-11** — อนุมัติโดยไม่เลือกจุดในศูนย์ที่มีจุด → `422 POINT_REQUIRED` · หน้าประเมินกดยืนยันไม่ได้
- **AC-AP-12** — อนุมัติพร้อมจุดที่ไม่อยู่ในศูนย์ → `422 UNKNOWN_DROP_OFF_POINT` · ส่งจุดคู่กับ `rejected` → `422 INVALID_REVIEW` · รายการที่ปฏิเสธไม่ถูกแก้จุด
- **AC-AP-12a** — อนุมัติใบ `parcel` พร้อมส่งจุดมา → รายการได้ `null` ไม่ได้ error
- **AC-AP-12b** — body ไม่มี `lines` สำหรับใบที่ประเมินทีละรายการ ในศูนย์ที่มีจุด และมีรายการ `pending` ที่ไม่มีจุด → `422 POINT_REQUIRED` · ใบก่อน schema_v 7 อนุมัติแบบเดิมได้ รายการเป็น `null`
- **AC-AP-12c** — ใบผสมจาก AC-AP-13 (ข้าวมีจุดโรงยิม จึงรับทีละจุด) ยัง `pending_review` · หน้าสแกนรับข้าวและผ้าห่มที่โรงยิมไปก่อน แล้วเจ้าหน้าที่ประเมิน → ไม่ต้องเลือกจุดให้ผ้าห่ม · `items[i].drop_off_point_id` ของผ้าห่มไม่ถูกเขียน · ส่งจุดมาให้ผ้าห่ม → `422 INVALID_REVIEW`
- **AC-AP-13** — ใบผสม (ข้าวแคมเปญ + ผ้าห่มพิมพ์เอง) → ข้าวได้โรงยิมตอนจอง · ตั๋วแสดงกลุ่ม "โรงยิม" (ข้าว) และ "รอเจ้าหน้าที่กำหนดจุดส่ง" (ผ้าห่ม) เรียงตามนั้น · หน้าประเมินแสดงข้าวพร้อมจุดแบบ read-only · ผ้าห่มได้จุดตอนประเมิน
- **AC-AP-13a** — รายการแคมเปญที่ `pending` (counter `NOT_SEEDED`) และจุดยังอยู่ → หน้าประเมินเลือกจุดนั้นไว้ให้ · หน้าติดตามแสดงรายการในกลุ่มโรงยิม ไม่ใช่กลุ่ม "รอ" · หน้าสแกนจุดอื่นเห็นรายการนี้เป็นแถวล็อก (CR-206 FR-MP-19) · จุดถูกลบไปแล้ว → dropdown ว่าง และหน้าติดตามแสดงในกลุ่ม "รอ"
- **AC-AP-13b** — ใบผสมจาก AC-AP-13 · หน้าสแกนรับผ้าห่มที่โรงยิมก่อนประเมิน → หน้าติดตามไม่แสดงผ้าห่มในกลุ่ม "รอเจ้าหน้าที่กำหนดจุดส่ง" · คิวประเมินมี `point_receipts` ของใบ · หน้าประเมินไม่แสดง dropdown ให้ผ้าห่ม

**แก้รายการและข้อมูลเดิม**

- **AC-AP-14** — ผู้บริจาคแก้ใบ `pending_review` ที่มีรายการแคมเปญ `NOT_SEEDED` (มีจุดโรงยิม) และเพิ่มรายการใหม่ → dialog ไม่มีตัวเลือกจุด · รายการเดิมคงโรงยิม · รายการใหม่ได้จุดตาม FR-AP-15a
- **AC-AP-14a** — ผู้บริจาคเลือกสินค้าในแคมเปญให้แถวผ้าห่มที่เคยพิมพ์เอง (`item_id` เปลี่ยน) → รายการได้จุดของ need ตาม FR-AP-15a ไม่คง `null` เดิม
- **AC-AP-14b** — แคมเปญของใบถูกปิดหลังจอง แล้วผู้บริจาคเพิ่มรายการของแคมเปญนั้น → รายการใหม่ได้จุดของ need · อ่านแคมเปญไม่ได้ → `503 DONATION_UNAVAILABLE` ไม่มีอะไรเปลี่ยน
- **AC-AP-15** — แก้จุดของ need จากโรงยิมเป็นห้องพยาบาล → ใบที่จองก่อนแก้ยังเป็นโรงยิม แม้ผู้บริจาคแก้รายการของใบนั้นภายหลัง · ใบที่จองหลังแก้เป็นห้องพยาบาล
- **AC-AP-16** — แคมเปญ `schema_v` 3 (ไม่มี key) → อ่านเป็น `null` · จองได้ · รายการได้ `null`
- **AC-AP-17** — ใบที่จองก่อน amendment นี้ (ผู้บริจาคเลือกจุดเอง) → รับของทีละจุดได้เหมือนเดิม

### Impact

- **backend**
  - `use_case.py` `create`: ไม่เทียบจุดกับ `public_shelters` (FR-AP-10) · ลบ branch `strict` ของ `_drop_off_points` และ `_offered_point_ids` · ส่ง `items[]` ใน response จาก `buffer.items_declared` (อ่านจุดด้วย `.get()` เพราะ `model_dump(exclude_none=True)` ตัด `null`) (FR-AP-8a)
  - `use_case.py` `_pair_held_lines`: copy `drop_off_point_id` ของรายการเดิมทุกครั้ง (รวม `null`) เมื่อ `item_id` ไม่เปลี่ยน (FR-AP-15) · ปัจจุบัน carry เฉพาะ field ที่ request ว่าง
  - `schemas.py` `DonationCreateResponse.items` · docstring ของ `DonationItemInput.drop_off_point_id`
  - `tests/test_donation_drop_off_points.py`: ลบเคส `UNKNOWN_DROP_OFF_POINT` ตอนจอง · เพิ่ม AC-AP-7, AC-AP-15 (ฝั่ง FastAPI)
  - `modules/needs` (`schemas.py`, `use_case.py`): FR-AP-26 · `modules/external/router.py` `list_needs`: FR-AP-27 (แยก method ของ use case ให้ external) · test ใน `backend/tests/` ทั้งสอง endpoint
  - regenerate OpenAPI (`fastapi.json`, `openapi.d.ts`)
- **worker / tent-model**
  - `worker/src/worker/projectors/needs.py`: FR-AP-25, FR-AP-25a · `projection_version.py` 15 (FR-AP-25b) · test ของ projector
  - `packages/tent-model/src/tent_model/public_need.py`: `item_id`, `drop_off_point_id` (FR-AP-25b)
- **frontend back-office**
  - `operations/domain/operations.ts`: `CampaignNeed`, `campaignInputSchema`, `createCampaign` (schema_v 4), `editNeed` (FR-AP-4, FR-AP-4b)
  - `operations/application/use-donation-needs-board.svelte.ts`: ส่งจุดจากฟอร์มเข้า `createCampaign` / `editNeed`
  - `create-campaign-form.svelte`, `edit-campaign-form.svelte`, `needs-board-admin.svelte`: FR-AP-2 – FR-AP-6
  - `donations/domain/item-review.ts` (`lineReviewDecisionSchema`, `applyLineReview`): FR-AP-17, FR-AP-18
  - route `[query]/approve`: FR-AP-17 – FR-AP-19 · อ่านจุดปัจจุบันด้วย `readCurrentDonationPoints`
  - `pending-review-detail.svelte` + caller `stock-donations/+page.svelte`: FR-AP-20
  - `donations/domain/back-office.ts` (`PendingDonationRow`) + `routes/api/back-office/donations/+server.ts` (`toPendingRow`): FR-AP-20a
- **frontend public**
  - `donations/domain/line-points.ts`: function ใหม่ตาม FR-AP-9 · `groupDropOffDestinations` ตาม FR-AP-22a · ลบ `defaultDropOffPointId`, `pickerForMapTap`, `ALL_LINES_PICKER` และ export ใน `donations/index.ts` · เก็บ `bookableDropOffPoints`, `lineDropOffPointId`, `withCurrentLinePoints` ถ้ายังมี caller
  - caller ของ `groupDropOffDestinations` ส่ง `deliveryMethod` และ `awaitingName`: ตั๋ว, หน้าติดตาม
  - `donations/ui/drop-off-groups.svelte` + `lib/constants/i18n/public-donations.ts`: กลุ่ม "รอ" (FR-AP-22a)
  - `donations/domain/donation.ts`, `public-donation.ts` (`buildDonationItemsPayload`, ข้อความ error `UNKNOWN_DROP_OFF_POINT`): FR-AP-7, FR-AP-10
  - `donor-time-selection-form.svelte`, `drop-off-points-section.svelte`, `donation.svelte.ts`, `public-donor-needs.svelte`: FR-AP-11 – FR-AP-13 · `bookedItems` ตาม FR-AP-8b
  - `public-donor-needs.svelte`, `(public)/+page.ts`, `public-portal/domain/donation-map.ts`, `donations/data/public-needs.ts`: FR-AP-28, FR-AP-29
  - `donations/domain/compute-needs.ts`: กรองแคมเปญตามการ์ด (FR-AP-7b) เป็น pure function + unit test
  - BFF `api/public/v1/donations/+server.ts`: FR-AP-7a, FR-AP-7b, FR-AP-8, FR-AP-8a
  - `public-donor-success-ticket.svelte`: FR-AP-8b, FR-AP-22
  - `edit-donation-items-dialog.svelte` + BFF `…/[tracking_token]/items/+server.ts`: FR-AP-14, FR-AP-15a, FR-AP-15b
  - หน้าติดตาม `routes/(public)/donations/track/[token]/+page.svelte`: FR-AP-22
- **e2e**: เขียน `donation-multi-drop-off.test.ts` ฝั่งผู้บริจาคใหม่ตาม AC-AP-3, AC-AP-4, AC-AP-9, AC-AP-10, AC-AP-13 · ใช้ `e2e/helpers/donation-points.ts` เดิม · stack ต้องรัน worker ที่ PROJECTION_VERSION 15
- **docs หลังอนุมัติ**
  - schema.md §2.4 (field ใหม่, schema_v 4, Migration) · §2.3 ย่อหน้า CR-206 (ใครเขียน `drop_off_point_id`)
  - api-contract.md §5 (ตาราง API ข้างบน · ข้อความที่ ~:860) · `GET /public/v1/needs` และ `GET /external/v1/needs` · public-tier-donation-spec.html (บอร์ดการ์ดต่อของ + จุด · ขั้น 3 แสดงจุดแบบอ่านอย่างเดียว)
  - couchdb-mongodb-sync.md `public_needs` (`_id`, `item_id`, `drop_off_point_id`, PROJECTION_VERSION 15)
  - CR-206: Decision log ชี้มา amendment นี้ · ทำเครื่องหมาย FR / AC ที่ระบุใน `affects` ว่า superseded
  - CR-205: Decision log ของ FR-DP-18 / AC-AP-12 (หมุดแตะแล้วไม่เลือกจุด)
  - อัปเดต `updated:` ทุกไฟล์

### Migration

- `needs[].drop_off_point_id` optional → แคมเปญเดิมไม่ backfill · อ่านเป็น `null` (AC-AP-16)
- แคมเปญเดิมที่ยังเปิดในศูนย์ที่มีจุด → ใบใหม่ได้ `null` และรับที่จุดไหนก็ได้ (CR-206 FR-MP-19) จนเจ้าหน้าที่แก้ need (FR-AP-4a) · บอร์ดแสดงป้าย "ยังไม่ระบุจุด" (FR-AP-6) · หลัง deploy ควรให้เจ้าหน้าที่ตั้งจุดให้แคมเปญที่เปิดอยู่
- ใบบริจาคเดิมคงจุดที่ผู้บริจาคเลือก · ไม่ migrate (AC-AP-17)
- **re-project `public_needs`:** worker ที่ PROJECTION_VERSION 15 รัน bootstrap เองตอนเริ่ม (`projection_version.py`) · projector ลบแถวรูปแบบเดิม `{shelter}:{item_id}` (FR-AP-25a, AC-AP-4e) · `public_donations` ไม่ต้อง re-project
- **deploy:** worker, FastAPI และ frontend จาก commit เดียวกัน · FastAPI ต้องอ่านแถวเก่าที่ไม่มี `item_id` ได้ในช่วงก่อน bootstrap เสร็จ (fallback แยก `item_id` จาก `_id` และ `drop_off_point_id = null`)
- client รุ่นเก่า (PWA cache) ที่ไม่ส่ง `need_drop_off_point_id` → BFF เลือกแคมเปญแบบเดิม (AC-AP-4c)

### ข้อตกลง

| # | เรื่อง | ข้อเสนอ | สถานะ | FR |
| --- | --- | --- | --- | --- |
| D-AP-1 | วิธี track | Amendment A2 ของ CR-206 (ไม่เปิด CR ใหม่ · PR #1053 ปิด) | team lead ตัดสิน 2026-10-31 | — |
| D-AP-2 | บังคับเลือกจุดตอนสร้าง / แก้แคมเปญ | บังคับเมื่อศูนย์มีจุด | เสนอ | FR-AP-3, FR-AP-4a |
| D-AP-3 | บังคับเลือกจุดตอนประเมิน | บังคับเมื่อศูนย์มีจุด และ `self_dropoff` · รายการบริจาคเองของใบที่จองหลัง amendment นี้ไม่มีค่าเริ่มต้น | เสนอ | FR-AP-17, FR-AP-20 |
| D-AP-4 | แก้จุดของ need มีผลกับรายการที่จองแล้วไหม | ไม่มีผล รวมตอนผู้บริจาคแก้ใบ · จับคู่รายการเดิมด้วย `line_key` และ `item_id` ไม่เปลี่ยน | เสนอ | FR-AP-5, FR-AP-15 |
| D-AP-5 | จุดของ need ถูกลบแล้วมีคนจอง | จองได้ · เก็บ id ไว้ · แสดงและรับแบบ "ไหนก็ได้" ตาม CR-206 FR-MP-16 / FR-MP-19 | เสนอ | FR-AP-8 |
| D-AP-6 | เจ้าหน้าที่เปลี่ยนจุดของรายการที่อนุมัติแล้วได้ไหม | นอกขอบเขต · ใช้ "รับรายการของจุดอื่น" | เสนอ | FR-AP-21 |
| D-AP-7 | ผู้บริจาคเห็นจุดก่อนจองไหม | เห็นแบบอ่านอย่างเดียว ตาม #1056 · บอร์ดแสดงจุดบนการ์ด · ขั้น 3 แสดงจุดต่อรายการ · หมุดจุด CR-205 ยังแสดงแต่แตะไม่เลือก (เดิมเสนอ "ไม่เห็นก่อนจอง" · เปลี่ยนตาม #1056 2026-10-31) | เสนอ | FR-AP-11, FR-AP-12, FR-AP-28 |
| D-AP-8 | bump donation schema_v ไหม | ไม่ bump (shape ไม่เปลี่ยน) | เสนอ | — |
| D-AP-9 | FastAPI `create` ตรวจจุดกับ `public_shelters` ต่อไหม | เลิกตรวจ · เชื่อค่าจาก BFF (endpoint เรียกได้ผ่าน BFF เท่านั้น · กติกาเดียวกับ CR-206 FR-MP-2b ของ PATCH) | เสนอ | FR-AP-10 |
| D-AP-10 | BFF จองตรวจจุดของ need กับ registry ไหม | ไม่ตรวจ · คง CR-017 §Decision A (route จองไม่อ่าน registry) · ใช้ D-AP-5 แทน | เสนอ | FR-AP-8 |
| D-AP-11 | ศูนย์มีจุดเดียว | เลือกให้อัตโนมัติในฟอร์มแคมเปญและหน้าประเมิน (แทน CR-206 FR-MP-10 ที่ใส่ให้ในฟอร์มจอง) | เสนอ | FR-AP-2a, FR-AP-20 |
| D-AP-12 | approve แบบไม่ส่ง `lines` | ใบประเมินทีละรายการ ศูนย์มีจุด มีรายการไม่มีจุด → `422` · ใบก่อน schema_v 7 อนุมัติแบบเดิม จุดเป็น `null` | เสนอ | FR-AP-17a |
| D-AP-13 | รายการที่หน้าสแกนรับไปก่อนประเมิน | ไม่บังคับจุดและไม่เขียนทับ · ส่งจุดมา → `422` | เสนอ | FR-AP-17 ข้อ 3 |
| D-AP-14 | เข้า phase ปัจจุบัน หรือ backlog (change-management §5) | > [NEEDS DECISION: ผู้อนุมัติกำหนด] | รอ | — |
| D-AP-15 | แยกการ์ดบนบอร์ดแบบไหน | ต่อของ + จุด · หลายแคมเปญที่ของและจุดตรงกันรวมเป็นการ์ดเดียว | เจ้าของงานเลือก 2026-10-31 · รอผู้อนุมัติ | FR-AP-25, FR-AP-28 |
| D-AP-16 | `/external/v1/needs` เปลี่ยน shape ไหม | ไม่เปลี่ยน · รวมแถวการ์ดกลับเป็น 1 แถวต่อของ · ผลที่ยอมรับ: การ์ดที่ `qty_needed ≤ 0` ถูกลบ (FR-AP-25) จึงไม่หักลบกับการ์ดอื่น · ยอดรวมที่ภายนอกเห็นอาจสูงกว่าก่อน amendment นี้เมื่อจุดหนึ่งได้ของเกินเป้า | เจ้าของงานเลือก 2026-10-31 · รอผู้อนุมัติ | FR-AP-27 |
| D-AP-17 | การ์ดที่ผู้บริจาคกดเต็มตอนส่ง แต่การ์ดของจุดอื่นยังรับได้ | `409 NEED_FULL` · ไม่ย้ายไปแคมเปญของจุดอื่น (ผู้บริจาคเห็นจุดเดิมไปแล้วในขั้น 3) | เสนอ | FR-AP-7b |

ถ้า D-AP-2 หรือ D-AP-3 เลือก "ไม่บังคับ" ให้ตัด validation ใน FR-AP-3, FR-AP-4a, FR-AP-17 ข้อ 5, FR-AP-17a ข้อแรก และ AC-AP-1, AC-AP-2b, AC-AP-11, AC-AP-12b · FR อื่นคงเดิม

### ทางเลือกที่ไม่เลือก

- **ตั้งจุดระดับแคมเปญ (1 แคมเปญ = 1 จุด)** — แคมเปญมีหลาย need ได้ (`needs[]` ≥ 1) และของต่างประเภทอาจไปคนละจุด · ฟอร์มปัจจุบันสร้างแคมเปญละ 1 need (`use-donation-needs-board.svelte.ts`) จึงใช้งานเหมือนกัน แต่ field ต่อ need ไม่ต้องย้ายข้อมูลถ้าฟอร์มรองรับหลาย need ทีหลัง
- **ให้ผู้บริจาคเลือกต่อ แต่เจ้าหน้าที่แก้ได้** — ผู้บริจาคยังต้องเดาจุดเอง · คำขอระบุให้เจ้าหน้าที่เป็นคนกำหนด
- **ไม่แสดงจุดก่อนจอง (แจ้งในตั๋ว)** — ข้อเสนอเดิมของ D-AP-7 · ขัด #1056 ที่ให้ผู้บริจาคเห็นจุดแบบอ่านอย่างเดียว
- **แยกการ์ดต่อแคมเปญ** — 2 แคมเปญขอข้าวที่จุดเดียวกันจะเป็น 2 การ์ดหน้าตาเหมือนกัน · ผู้บริจาคแยกไม่ออก (D-AP-15)
- **คงการ์ดเดียวต่อของ แสดงจุดเมื่อทุกแคมเปญของของนั้นใช้จุดเดียวกัน** — ยังบอกจุดก่อนจองไม่ได้เมื่อแคมเปญใช้คนละจุด ซึ่งเป็นกรณีที่ #1056 ต้องการ
- **ให้ `/external/v1/needs` แยกแถวตามจุดด้วย** — เปลี่ยนสัญญากับหน่วยงานภายนอกโดยไม่มีคำขอจากฝั่งนั้น (D-AP-16)
- **ย้ายไปแคมเปญของจุดอื่นเมื่อการ์ดเต็ม** — ผู้บริจาคเห็นจุดหนึ่งในขั้น 3 แต่ตั๋วบอกอีกจุด (D-AP-17)
- **BFF จองอ่าน registry เพื่อล้างจุดที่ถูกลบ** — ขัด CR-017 §Decision A (route จองเคยดึง registry ทั้งก้อนทุกครั้งที่จอง) · ระบบรองรับ id ที่ไม่อยู่แล้วทั้งตอนแสดงและตอนรับ (CR-206 FR-MP-16 / FR-MP-19)
- **ผู้บริจาคแก้รายการแล้วคำนวณจุดใหม่ทุกรายการ** — ขัด D-AP-4 · ผู้บริจาคที่ได้ตั๋วบอกจุดแล้วจะเห็นจุดเปลี่ยนเพราะแก้จำนวน
- **คงการตรวจจุดใน FastAPI `create` กับ `public_shelters`** — projection ตามหลัง CouchDB · จุดที่เจ้าหน้าที่เพิ่งสร้างจะทำให้การจองล้ม (AC-AP-7)
- **ตั๋วอ่านจุดจาก GET tracking หลังจอง** — ใบยังไม่ถึง CouchDB ในรอบ inbound แรก และเพิ่ม request · ใช้ response ของการจองแทน (FR-AP-8a)
