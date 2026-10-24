---
id: draft
title: ระบุตัวตนรายการบริจาคด้วย line_key แทนการเดาจากชื่อตอนผู้บริจาคแก้รายการ
status: proposed
date: 2026-10-25
created: 2026-10-25
updated: 2026-10-25
requested_by: "Kunanon Nusaeng"
decided_by: "(รอ approve)"
layer: volatile
affects:
  - docs/data/schema.md §2.3 `donation.items[]` — field ใหม่ `line_key` (opt) · กติกาจับคู่รายการตอนผู้บริจาคแก้ (ย่อหน้า "ประเมินทีละรายการ (CR-174)")
  - schema_v donation 7 → 8 (ดู NEEDS DECISION D-1 เรื่องลำดับกับ CR-175)
  - docs/data/couchdb-mongodb-sync.md §3.2 `public_donations.items_declared[].line_key` · PROJECTION_VERSION 7 → 8
  - docs/data/api-contract.md — `GET /public/v1/donations/{tracking_token}` (`items[].line_key`), `PATCH /public/v1/donations/{tracking_token}/items` (request + response `items[].line_key`, error `400 UNKNOWN_LINE_KEY` / `400 DUPLICATE_LINE_KEY`)
  - docs/changes/04-donation/CR-174-donation-campaign-auto-approve.md FR-18a — แทนที่การจับคู่ด้วยเนื้อหา
  - backend/apiapp/modules/donations (schemas `DonationItemInput`, use_case `create` / `update_items` / `_carry_item_ids` / `_carry_line_details`, review `line_key` / `review_edited_booking`) · backend/tests/test_donations.py, test_donation_review.py
  - packages/tent-model (`PublicDonation.DeclaredItem`)
  - worker/src/worker/projectors/donation.py · worker/src/worker/projection_version.py
  - frontend/src/lib/features/donations (domain/tracking.ts, data/public-tracking.ts `DonationItemEdit`, ui/edit-donation-items-dialog.svelte) · routes/api/public/v1/donations/[tracking_token]/items/+server.ts
why: ผู้บริจาคแก้รายการแล้ว ระบบเดาว่ารายการไหนคือรายการเดิมจากชื่อและเนื้อหา — เดาไม่ได้เมื่อมีรายการชื่อซ้ำ ทำให้รายการในแคมเปญที่เจ้าหน้าที่ปฏิเสธแล้วกลับเป็นอนุมัติอัตโนมัติ (review PR #783 H1)
migration: optional field, ไม่ backfill — รายการที่ไม่มี line_key ใช้กติกา FR-LK-7
---

# ระบุตัวตนรายการบริจาคด้วย `line_key`

## สรุป (TL;DR)

- เพิ่ม `items[].line_key` (ULID) ให้ทุกรายการของใบบริจาค public; FastAPI สร้างตอนจอง และหน้าแก้รายการส่งกลับมาทุกครั้ง
- ตอนผู้บริจาคแก้ ระบบจับคู่รายการเดิมด้วย `line_key` แทนการเทียบชื่อ/เนื้อหา → ผลประเมินของเจ้าหน้าที่ (รวม `rejected`) ไม่หลุดอีก
- dev ต้องแก้ FastAPI create/update_items, review, projection `public_donations`, หน้าติดตาม + dialog แก้รายการ
- donation schema_v 7 → 8, PROJECTION_VERSION 7 → 8; ไม่แตะ `stock_ledger` `_id`

## Why

- ฟอร์มแก้รายการส่งกลับแค่ `item_id`/`free_text`/`qty`/`unit` ระบบจึงต้องเดาว่ารายการใหม่คือรายการเดิมตัวไหน (CR-174 FR-18a + `_carry_line_details` จับคู่ด้วยชื่อ)
- เมื่อมีรายการเดิมชื่อเดียวกัน ≥ 2 รายการที่ `category`/`condition`/`note` ต่างกัน การเดาเป็นไปไม่ได้ → รายการถูกนับเป็น "แก้แล้ว" → รายการที่มี `item_id` และจองโควต้าได้ถูกอนุมัติอัตโนมัติตาม FR-2 แม้เจ้าหน้าที่ปฏิเสธไว้ → ใบกลับเป็น `verifying` พร้อม QR (ขัด CR-174 FR-18)
- ตัวอย่าง: A "เสื้อ ×3 ของใหม่" `approved` + B "เสื้อ ×3 มือสอง" `rejected` → ผู้บริจาคลบ A → B กลายเป็น `approved`
- heuristic การจับคู่ถูกแก้มาแล้วหลายรอบ (review รอบก่อนใน PR #783) และแต่ละรอบเปิดช่องใหม่ — ต้นเหตุคือรายการไม่มีตัวตนของตัวเอง

## Requirements

- **FR-LK-1** — `POST /public/v1/donations` ต้องตั้ง `line_key` = ULID ใหม่ให้ทุกรายการ ก่อนเขียน buffer
- **FR-LK-2** — `line_key` ไม่ซ้ำกันภายในใบเดียว และไม่เปลี่ยนตลอดอายุรายการนั้น
- **FR-LK-3** — `GET /public/v1/donations/{tracking_token}` (FastAPI และ BFF overlay จาก CouchDB) ต้องคืน `items[].line_key`
- **FR-LK-4** — dialog แก้รายการต้องส่ง `line_key` ของรายการเดิมกลับมาทุกรายการที่ยังอยู่; รายการที่ผู้บริจาคเพิ่มใหม่ไม่ส่ง `line_key`
- **FR-LK-5** — `PATCH …/items`: รายการที่ไม่มี `line_key` = รายการใหม่ → FastAPI ตั้ง ULID ใหม่; `line_key` ที่ไม่มีในใบ → `400 UNKNOWN_LINE_KEY`; `line_key` ซ้ำในคำขอเดียว → `400 DUPLICATE_LINE_KEY`; ทั้งสองกรณีไม่ขยับโควต้า
- **FR-LK-6** — จับคู่รายการเดิมด้วย `line_key` เท่านั้น (แทนการจับคู่ด้วยเนื้อหาใน CR-174 FR-18a):
  - `category`/`condition`/`note` ที่คำขอไม่ส่ง → คัดลอกจากรายการเดิมที่ `line_key` ตรงกัน
  - `line_key` ตรง และ `item_id`, `category`, `free_text`, `qty` (เทียบเป็นตัวเลข), `unit`, `condition`, `note` เท่าเดิม → คงผลประเมินเดิมทั้ง 3 field รวม `rejected`
  - `line_key` ตรง แต่เนื้อหาต่าง → ประเมินใหม่ตาม FR-2 ยกเว้นตาม D-2
  - รายการใหม่ → ประเมินตาม FR-2
- **FR-LK-7** — ใบที่รายการเดิมไม่มี `line_key` (สร้างก่อน schema_v 8): ทุกรายการในคำขอแก้นับเป็นรายการใหม่ และ **ไม่อนุมัติอัตโนมัติ** — รายการทั้งหมดเป็น `pending` (ใบ → `pending_review`) ยกเว้นใบ `declared` ตาม CR-174 FR-18c
- **FR-LK-8** — ลบ `_carry_line_details` และการจับคู่ด้วย `line_key()` (tuple เนื้อหา) ใน `review.py` ออก
- **FR-LK-9** — `public_donations.items_declared[]` เก็บ `line_key`; bump PROJECTION_VERSION
- **FR-LK-10** — ไม่เปลี่ยน `stock_ledger` `_id` (`deriveDonationReceiptLineId` ยังใช้ ลำดับรายการ + `item_id`) และไม่เปลี่ยน path รับของ

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ตัวตนของรายการ | ไม่มี — ใช้ลำดับ/ชื่อ/เนื้อหา | `items[].line_key` (ULID) |
| จับคู่ตอนผู้บริจาคแก้ | เนื้อหาตรงทุก 7 field; รายละเอียดที่ฟอร์มไม่ส่งเติมจากรายการชื่อเดียวกัน | `line_key` ตรง |
| รายการชื่อซ้ำที่รายละเอียดต่างกัน | ไม่เติมรายละเอียด → นับเป็นแก้ → campaign line อนุมัติอัตโนมัติ | จับคู่ถูกเสมอ |
| ใบเก่าที่ไม่มี key | — | ทุกรายการ `pending` (FR-LK-7) |

## Acceptance

- **AC-1** — สร้างใบ 2 รายการ → ทั้งสองมี `line_key` ไม่ซ้ำกัน และ GET คืนค่าเดิม
- **AC-2** — A "เสื้อ ×3 ของใหม่" `approved` + B "เสื้อ ×3 มือสอง" `rejected` (มี `item_id`, จองโควต้าแล้ว) → ผู้บริจาคลบ A → B ยังเป็น `rejected`; `auto_approved_lines` ว่าง; ใบไม่ได้ QR ใหม่
- **AC-3** — แก้จำนวนรายการ A → รายการ B ที่ไม่แตะคงผลเดิม
- **AC-4** — ส่ง `line_key` ที่ไม่มีในใบ → 400 `UNKNOWN_LINE_KEY` และโควต้าไม่ขยับ
- **AC-5** — ส่ง `line_key` เดียวกันสองรายการ → 400 `DUPLICATE_LINE_KEY`
- **AC-6** — ใบ schema_v 7 สถานะ `verifying` ผู้บริจาคแก้ → ทุกรายการ `pending`, ใบ `pending_review`
- **AC-7** — test ของ AC-2 ใช้รายการที่มี `item_id` (ไม่ใช่ free text อย่างเดียว)

## Impact

- ฐานโค้ด: implementation ของ CR-174 ใน PR #783 (`_carry_line_details`, `review_edited_booking`, edit dialog) — ยังไม่ merge เข้า develop; CR นี้ implement หลัง/ใน PR นั้น
- backend: `schemas.py` (`DonationItemInput.line_key`), `use_case.py` (create ตั้ง key, `update_items` ตรวจ/ตั้ง key, ลบ `_carry_line_details`), `review.py` (`review_edited_booking` จับคู่ด้วย key) + tests
- tent-model: `DeclaredItem.line_key`
- worker: projector donation คัดลอก `line_key`; `PROJECTION_VERSION` 7 → 8; inbound คัดลอก `items` ทั้งก้อนอยู่แล้ว (ไม่ต้องแก้)
- frontend: `tracking.ts` parse `line_key`, `DonationItemEdit.line_key`, dialog ส่ง key กลับ (ใช้ `line_key` เป็น key ของ `{#each}` ด้วย), BFF items route ส่งต่อ
- OpenAPI: regenerate `fastapi.json` + `openapi.d.ts`
- ไม่กระทบ: `stock_ledger`, back-office approve/reject (เขียนทับเฉพาะ field review บนรายการเดิม — `line_key` ติดไปด้วย), walk-in (ผู้บริจาคไม่แก้)

## Migration

- `line_key` optional → doc เดิมไม่ backfill
- ใบที่ไม่มี key ใช้ FR-LK-7 (กันฝั่งปลอดภัย: เจ้าหน้าที่ประเมินใหม่); ใบ public มี TTL 72 ชม. จึงหมดไปเองภายใน 3 วันหลัง deploy
- `public_donations` re-project ผ่าน PROJECTION_VERSION 8
- walk-in (frontend) ไม่เขียน `line_key`

## NEEDS DECISION

> [NEEDS DECISION D-1: เลข schema_v — CR-175 (donor photos) จอง donation 7 → 8 ไว้แล้ว (approved, ยังไม่ merge). CR นี้ใช้ 7 → 8 ถ้า merge ก่อน CR-175 (แล้ว CR-175 เลื่อนเป็น 8 → 9) หรือ 8 → 9 ถ้า CR-175 ลงก่อน]

> [NEEDS DECISION D-2 (review PR #783 M3): รายการที่ `line_key` ตรงกับรายการที่เจ้าหน้าที่ `rejected` แล้วผู้บริจาคแก้เนื้อหา (เช่น 5 kg → 4 kg หรือเปลี่ยนสภาพ) ให้เป็นอะไร —
> (ก) ประเมินใหม่ตาม FR-2 ตาม CR-174 เดิม: campaign line → `approved` อัตโนมัติ;
> (ข) `pending` เสมอ ให้เจ้าหน้าที่ดูอีกครั้ง.
> ข้อเสนอ: (ข) — เจ้าหน้าที่ปฏิเสธรายการนี้ด้วยเหตุผลที่ผู้บริจาคเห็นแล้ว การแก้จำนวนไม่ได้แปลว่าเหตุผลนั้นหมดไป]

## Decision log

- 2026-10-25 — proposed (review PR #783 H1 + M3)
