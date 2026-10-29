---
id: CR-196
title: ระบุตัวตนรายการบริจาคด้วย line_key และบล็อกการแก้รายการหลังได้รับการประเมิน
status: approved
date: 2026-10-25
approved_at: 2026-10-26
created: 2026-10-25
updated: 2026-10-29
requested_by: "Kunanon Nusaeng"
decided_by: "Soravit Sukkarn (Team Lead)"
layer: volatile
affects:
  - docs/data/schema.md §2.3 `donation.items[]` — field ใหม่ `line_key` (opt) · กติกา donor edit (บล็อกการแก้เมื่อประเมินแล้ว)
  - schema_v donation 7 → 8 (ดูส่วนลำดับกับ CR-175)
  - docs/data/couchdb-mongodb-sync.md §3.2 `public_donations.items_declared[].line_key` · PROJECTION_VERSION 10 → 11
  - docs/data/api-contract.md — `GET /public/v1/donations/{tracking_token}` (`items[].line_key`), `PATCH /public/v1/donations/{tracking_token}/items` (บล็อกเมื่อมีผลประเมิน, error `400 ALREADY_REVIEWED` / `400 UNKNOWN_LINE_KEY` / `400 DUPLICATE_LINE_KEY`)
  - docs/changes/04-donation/CR-174-donation-campaign-auto-approve.md FR-18a, FR-23 (ปรับชุดสถานะที่แก้รายการได้)
  - backend/apiapp/modules/donations (schemas `DonationItemInput`, use_case `create` / `update_items` / `_carry_item_ids`, ลบ `_carry_line_details`) · backend/tests/test_donations.py, test_donation_review.py
  - packages/tent-model (`PublicDonation.DeclaredItem`)
  - worker/src/worker/projectors/donation.py · worker/src/worker/projection_version.py · worker/src/worker/inbound/donations.py (`DONATION_SCHEMA_V`)
  - frontend/src/lib/features/donations (domain/tracking.ts, domain/carry-item-ids.ts, data/public-tracking.ts `DonationItemEdit`, ui/edit-donation-items-dialog.svelte) · routes/api/public/v1/donations/[tracking_token]/items/+server.ts
why: ผู้บริจาคแก้รายการแล้ว ระบบเดาว่ารายการไหนคือรายการเดิมจากชื่อและเนื้อหา — เดาไม่ได้เมื่อมีรายการชื่อซ้ำ ทำให้รายการในแคมเปญที่เจ้าหน้าที่ปฏิเสธแล้วกลับเป็นอนุมัติอัตโนมัติ (review PR #783 H1); แก้ปัญหาด้วยการให้มี line_key คงที่ และบล็อกการแก้รายการทันทีที่ใบได้รับการประเมินแล้ว (มติ Owner แบบที่ 1)
migration: optional field, ไม่ backfill — ใบที่ประเมินแล้วบล็อกการแก้ทันที; ใบ public มี TTL 72 ชม. จึงหมดเองภายใน 3 วัน
---

# ระบุตัวตนรายการบริจาคด้วย `line_key` และบล็อกการแก้รายการหลังได้รับการประเมิน

## สรุป (TL;DR)

- เพิ่ม `items[].line_key` (ULID) ให้ทุกรายการของใบบริจาค public; FastAPI สร้างตอนจอง (`create`) และส่งกลับใน GET เสมอ
- **บล็อกการแก้รายการทันทีที่ใบได้รับการประเมินแล้ว** ไม่ว่าจะจากระบบ Auto-Approve ในแคมเปญ (`verifying` ได้ QR แล้ว) หรือเจ้าหน้าที่ตรวจประเมินรายบรรทัด (`items[].review_status` เป็น `approved` หรือ `rejected`)
- การบล็อกนี้ปิดช่องโหว่ความปลอดภัย 100% ไม่ให้รายการที่เจ้าหน้าที่เคย `rejected` หลุดกลายเป็นอนุมัติอัตโนมัติ และตัดความซับซ้อนของการเดา/carry ผลประเมินเดิมทิ้งทั้งหมด
- หากผู้บริจาคต้องการเปลี่ยนของหลังใบได้รับการประเมินแล้ว: ให้กดยกเลิกใบเดิมแล้วจองใหม่ หรือนำของจริงมาแจ้งเจ้าหน้าที่เพื่อปรับยอดหน้างาน (Scan Station)
- donation schema_v 7 → 8, PROJECTION_VERSION 10 → 11; ไม่แตะ `stock_ledger` `_id`

## Why

- ฟอร์มแก้รายการเดิมส่งกลับแค่ `item_id`/`free_text`/`qty`/`unit` ระบบเดิมจึงต้องเดาว่ารายการใหม่คือรายการเดิมตัวไหน (`_carry_line_details` จับคู่ด้วยชื่อ)
- เมื่อมีรายการเดิมชื่อเดียวกัน ≥ 2 รายการที่ `category`/`condition`/`note` ต่างกัน การเดาเป็นไปไม่ได้ → รายการถูกนับเป็น "แก้แล้ว" → รายการที่มี `item_id` และจองโควต้าได้ถูกอนุมัติอัตโนมัติตาม FR-2 แม้เจ้าหน้าที่ปฏิเสธไว้ → ใบกลับเป็น `verifying` พร้อม QR (ขัด CR-174 FR-18)
- ตัวอย่าง: A "เสื้อ ×3 ของใหม่" `approved` + B "เสื้อ ×3 มือสอง" `rejected` → ผู้บริจาคลบ A → B กลายเป็น `approved`
- Team Lead มีมติเด็ดขาด (แบบที่ 1): **หากใบจองได้รับการประเมินแล้ว (ไม่ว่าจะผ่านหมด ผ่านบางส่วน หรือไม่ผ่าน) ให้บล็อกการแก้ไขรายการทุกกรณี** เพื่อปิดช่องโหว่ความปลอดภัย และใช้ `line_key` เป็นตัวตนที่แน่นอนของรายการสำหรับใบบริจาค

## Requirements

- **FR-LK-1** — `POST /public/v1/donations` ต้องตั้ง `line_key` = ULID (Crockford 26 ตัวอักษร) ใหม่ให้ทุกรายการ ก่อนเขียน buffer
- **FR-LK-2** — `line_key` ไม่ซ้ำกันภายในใบเดียว และไม่เปลี่ยนตลอดอายุรายการนั้น
- **FR-LK-3** — `GET /public/v1/donations/{tracking_token}` (FastAPI และ BFF overlay จาก CouchDB) ต้องคืน `items[].line_key`
- **FR-LK-4 — กติกาการบล็อกการแก้ไขรายการ (แบบที่ 1):**
  - อนุญาตให้ผู้บริจาคแก้ไขรายการ (`PATCH …/items`) ได้เฉพาะใบจองที่ **ยังไม่ได้รับการประเมิน** เท่านั้น (`status: 'declared'` หรือ `pending_review` ที่ทุกรายการมี `review_status` เป็น `pending` หรือไม่มีค่า)
  - หากใบจองอยู่ในสถานะ `verifying` (ออก QR แล้ว), `rejected`, หรือมีรายการใดรายการหนึ่งที่ `review_status` เป็น `approved` หรือ `rejected` → ให้ตอบกลับ `400 ALREADY_REVIEWED` และไม่อนุญาตให้แก้ไข
  - รายการที่ระบบอนุมัติอัตโนมัติจากการ์ดความต้องการในแคมเปญตอนจอง (`approved`) นับเป็น "ประเมินแล้ว" · ใบที่มีรายการแบบนี้ (ทั้ง `verifying` และ `pending_review` ที่มีรายการปนกัน) จึงแก้รายการไม่ได้ตั้งแต่จอง (amendment 2026-10-29)
  - บนหน้าติดตาม (`/donations/track/[token]`): Disable ปุ่ม "แก้ไขรายการ" (ไม่ซ่อน เพื่อให้ UI ไม่กระโดด) และหากผู้บริจาคกดปุ่ม ให้แสดง toast แจ้งเตือน: *"ใบบริจาคได้รับการอนุมัติ/ออก QR แล้ว ไม่สามารถแก้ไขรายการได้ หากต้องการเปลี่ยนแปลง กรุณายกเลิกเพื่อทำรายการใหม่ หรือแจ้งเจ้าหน้าที่หน้างานตอนนำของมาส่ง"*
- **FR-LK-5** — สำหรับใบที่ยังไม่ได้รับการประเมินและแก้รายการได้:
  - dialog แก้รายการต้องส่ง `line_key` ของรายการเดิมกลับมาทุกรายการที่ยังอยู่; รายการที่ผู้บริจาคเพิ่มใหม่ไม่ส่ง `line_key`
  - รายการที่ไม่มี `line_key` = รายการใหม่ → FastAPI ตั้ง ULID ใหม่
  - `line_key` ที่ไม่มีในใบเดิม → `400 UNKNOWN_LINE_KEY`; `line_key` ซ้ำในคำขอเดียว → `400 DUPLICATE_LINE_KEY`; ทั้งสองกรณีไม่ขยับโควต้า
- **FR-LK-6** — ลบ heuristic การเดาจับคู่ชื่อ `_carry_line_details` และ `line_key()` tuple ออก; เมื่อคำขอแก้ผ่าน gate (ใบยังไม่ประเมิน) ระบบจะจับคู่รายการเดิมด้วย `line_key` เพื่อคำนวณ diff ของโควต้า
- **FR-LK-7** — ใบที่รายการเดิมไม่มี `line_key` (สร้างก่อน schema_v 8): หากยังไม่ได้รับการประเมิน ทุกรายการในคำขอแก้นับเป็นรายการใหม่ และตั้ง `line_key` ใหม่ให้ครบ
- **FR-LK-8** — `public_donations.items_declared[]` เก็บ `line_key`; bump PROJECTION_VERSION
- **FR-LK-9** — ไม่เปลี่ยน `stock_ledger` `_id` (`deriveDonationReceiptLineId` ยังใช้ ลำดับรายการ + `item_id`) และไม่เปลี่ยน path รับของ
- **FR-LK-10 (สิทธิ์การยกเลิกคงเดิม)** — การยกเลิกใบจอง (`status → cancelled` ตาม CR-174 FR-20) ยังคงอนุญาตให้ผู้บริจาคทำได้ตามเดิมในสถานะ `{declared, pending_review, verifying}` เพื่อคืนโควต้า (Quota release) กลับสู่ศูนย์ และเปิดทางให้ผู้บริจาคจองใบใหม่ได้อย่างถูกต้อง
- **FR-LK-11 (การระบุเลขพัสดุคงเดิม)** — การอัปเดตเลขพัสดุ (`courier_tracking_no`) สำหรับการจัดส่งแบบพัสดุ (`parcel`) ยังคงอนุญาตให้ทำได้ตามปกติในสถานะ `verifying` (บล็อกเฉพาะการแก้ไขรายการสิ่งของ `items`)
- **FR-LK-12 (การปรับยอดรับจริงหน้างาน)** — เจ้าหน้าที่ยังคงสามารถปรับยอดรับจริงหรือเปิด "ไม่รับรายการนี้" ที่หน้า Scan Station ของ Back-office ได้ตามปกติ (CR-143 / CR-172) เมื่อของจริงที่นำมาส่งไม่ตรงกับในใบ โดยไม่ได้รับผลกระทบจากการบล็อกฝั่งผู้บริจาค

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ตัวตนของรายการ | ไม่มี — ใช้ลำดับ/ชื่อ/เนื้อหา | `items[].line_key` (ULID) |
| สิทธิ์การแก้รายการ | แก้ได้ใน `declared`, `pending_review`, `verifying` (CR-174) | แก้ได้เฉพาะ **ก่อนได้รับการประเมิน** เท่านั้น; มีผลประเมินแล้วบล็อกเด็ดขาด |
| รายการที่ถูก rejected | มีโอกาสถูกผู้บริจาคแก้แล้วหลุดเป็น auto-approve | บล็อกการแก้ทันที ไม่มีทางหลุด |
| จับคู่ตอนผู้บริจาคแก้ | เดาชื่อ / tuple เนื้อหา 7 field | ใช้ `line_key` ตรงกัน |
| ใบเก่าที่ไม่มี key | — | หากยังไม่ประเมินแก้ได้และได้ key ใหม่ |

## Acceptance

- **AC-1** — สร้างใบ 2 รายการ → ทั้งสองมี `line_key` ไม่ซ้ำกัน และ GET คืนค่าเดิม
- **AC-2** — ใบที่มีผลประเมินแล้ว (เช่น `verifying` จาก campaign auto-approve หรือเจ้าหน้าที่ประเมินแล้ว) → ผู้บริจาคส่ง PATCH แก้รายการ → 400 `ALREADY_REVIEWED` และหน้าเว็บปิดปุ่มแก้ไข
- **AC-3** — ใบสถานะ `pending_review` ที่ยังไม่มีการประเมินรายบรรทัด → ผู้บริจาคแก้จำนวนรายการ A → รายการ B ที่ไม่แตะคง `line_key` เดิม และโควต้าขยับเฉพาะส่วนต่างของ A
- **AC-4** — ส่ง `line_key` ที่ไม่มีในใบเดิม → 400 `UNKNOWN_LINE_KEY` และโควต้าไม่ขยับ
- **AC-5** — ส่ง `line_key` เดียวกันสองรายการในคำขอเดียว → 400 `DUPLICATE_LINE_KEY`
- **AC-6** — รายการที่เพิ่มใหม่ในการแก้ไข → ได้รับ `line_key` (ULID) ใหม่ที่ไม่ซ้ำกับของเดิม

## Impact

- ฐานโค้ด: implementation ของ CR-174 ได้ merge เข้า `develop` แล้ว (#783, `commit e3160336`); CR นี้จะ implement เป็น PR ใหม่แยกต่างหากบน develop
- backend:
  - `schemas.py`: `DonationItemInput.line_key: str | None = None`
  - `use_case.py`: create ตั้ง key; `update_items` ตรวจสอบ gate บล็อกใบที่ประเมินแล้ว, ตรวจ/ตั้ง key รายการใหม่, ลบ `_carry_line_details`
  - `review.py`: ลบ tuple `line_key()`
- tent-model: `DeclaredItem.line_key: str | None = None`
- worker:
  - `projector/donation.py`: คัดลอก `line_key` ลง `items_declared`; `PROJECTION_VERSION` 10 → 11
  - `inbound/donations.py`: อัปเดต `DONATION_SCHEMA_V` 7 → 8
- frontend:
  - `tracking.ts`: parse `line_key`
  - `carry-item-ids.ts`: จับคู่ด้วย `line_key` ก่อนชื่อ
  - `DonationItemEdit`: เพิ่ม `line_key`
  - `edit-donation-items-dialog.svelte`: ซ่อน/disable เมื่อใบมีผลประเมินแล้ว; สำหรับรายการใหม่ใน `{#each}` ให้คง local key หรือ fallback `row.line_key ?? row.local_id`
  - `routes/api/public/v1/donations/[tracking_token]/items/+server.ts`: ตรวจสอบบล็อกใบที่มีผลประเมินแล้ว
- OpenAPI: regenerate `fastapi.json` + `openapi.d.ts`
- ไม่กระทบ: `stock_ledger`, back-office approve/reject, walk-in (ผู้บริจาคไม่แก้)

## Migration

- `line_key` optional → doc เดิมไม่ backfill
- ใบที่ได้รับการประเมินแล้วบล็อกการแก้ไขทันทีตาม FR-LK-4; ใบ public มี TTL 72 ชม. จึงหมดไปเองภายใน 3 วันหลัง deploy
- `public_donations` re-project ผ่าน PROJECTION_VERSION 11
- walk-in (frontend) ไม่เขียน `line_key`

## ลำดับ `schema_v` (กับ CR-175)

- มติ Team Lead: PR implementation ใดทำเสร็จและ merge เข้า `develop` ก่อน ให้รัน `schema_v` ต่อจากเลขล่าสุดบน develop ทันที
  - หาก PR ของ CR-196 merge ก่อน → CR-196 ใช้ `schema_v 8` และให้ CR-175 ขยับเป็น `schema_v 9`
  - หาก PR ของ CR-175 merge ก่อน → CR-175 ใช้ `schema_v 8` และให้ CR-196 ใช้ `schema_v 9`

## Decision log

- 2026-10-25 — proposed (review PR #783 H1 + M3)
- 2026-10-26 — approved โดย Soravit Sukkarn (Team Lead):
  1. รันเลข CR-196 ย้ายเข้าหมวด `04-donation/` และเห็นชอบการเพิ่ม `items[].line_key` (ULID)
  2. เลือกใช้นโยบายแบบที่ 1: บล็อกการแก้ไขรายการ (`update_items`) ทันทีที่มีการประเมินแล้ว (ไม่ว่าจะจาก auto-approve / `verifying` หรือเจ้าหน้าที่ตรวจรายบรรทัด)
  3. สิทธิ์การยกเลิก (`cancel`) คงเดิมในสถานะ `{declared, pending_review, verifying}` เพื่อคืนโควต้า
  4. สิทธิ์การระบุเลขพัสดุ (`courier_tracking_no`) ในสถานะ `verifying` คงเดิม
  5. UX หน้าติดตาม: Disable ปุ่ม "แก้ไขรายการ" เมื่อบล็อก และหากกดให้แสดง toast แจ้งเตือนแนะนำการยกเลิก/แจ้งหน้างาน
  6. เจ้าหน้าที่ยังคงปรับยอดรับจริงหน้างาน (Scan Station) ได้ตามปกติ
  7. ลำดับ `schema_v`: ยึดตามลำดับการ merge โค้ดจริงเข้า develop (first-merged gets 8, subsequent gets 9)
- 2026-10-29 — amendment (review PR #956 Warning 1–2), ยืนยันโดย Kunanon Nusaeng:
  1. FR-LK-4: `review_status: 'pending'` = ยังไม่ประเมิน · `approved`/`rejected` = ประเมินแล้ว รวมรายการที่อนุมัติอัตโนมัติจากการ์ดแคมเปญตอนจอง (ตรงกับข้อ 2 ด้านบน) — ข้อความเดิม "ทุกรายการยังไม่มี `review_status`" ใช้ไม่ได้จริง เพราะ FastAPI stamp `pending` ให้ทุกรายการตั้งแต่ schema_v 7
  2. PROJECTION_VERSION ที่ใช้จริงคือ 10 → 11 (develop อยู่ที่ 10 ตอน implement) ไม่ใช่ 7 → 8
