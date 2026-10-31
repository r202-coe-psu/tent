---
id: CR-174
title: "ประเมินใบบริจาคทีละรายการ — รายการที่อยู่ในแคมเปญไม่ต้องรอประเมิน (ใบที่ทุกรายการอยู่ในแคมเปญได้ QR ทันที)"
status: approved
date: 2026-10-17
approved_at: 2026-10-19
updated: 2026-10-26
requested_by: "Kan"
decided_by: "Soravit Sukkarn (Team Lead)"
layer: volatile
affects:
  - docs/changes/04-donation/CR-052-donation-system-design-v8.md §1.4 (บังคับประเมินทุกรายการ), flowchart B1, §2.6 (QR เมื่ออนุมัติ)
  - docs/task-breakdown/04-donation.md T-16 (ข้อ "CR-052 (Task #52)" และ "CR-052 Cold-chain")
  - docs/data/schema.md §2.3 `donation` — field ระดับรายการ `items[].review_status`, `items[].review_reason`, `items[].review_reason_code`; เส้นทางสถานะ
  - schema_v donation 6 → 7 (CR-172 ใช้ 6 แล้ว)
  - docs/data/couchdb-mongodb-sync.md §3.2 (`public_donations.items_declared[]`)
  - docs/features/public-tier-donation-spec.html — สถานะที่ผู้บริจาคเห็น
  - docs/data/api-contract.md — response ของ `POST /public/v1/donations` (`status`), เส้นทาง donor edit, แถว `400` ที่อ้าง `DONOR_EDITABLE_STATUSES` (`{declared, pending_review}` → เพิ่ม `verifying`)
  - docs/changes/04-donation/CR-080-donor-edit-reservation-via-token.md (สิทธิ์แก้รายการ)
  - backend/apiapp/modules/donations (use_case: create, update_items · schemas: `DonationCreateResponse`, `DonationItemsPatchResponse`) · packages/tent-model (`DonationBuffer`, `PublicDonation.DeclaredItem`)
  - worker/src/worker/inbound/donations.py (copy field ใหม่ + audit) · worker/src/worker/projectors/donation.py · worker/src/worker/projection_version.py
  - frontend/src/lib/features/operations/domain/operations.ts (type, `DONATION_TRANSITIONS`)
  - frontend/src/lib/features/donations/domain/public-donation.ts (`receiveDonationInputSchema`)
  - frontend/src/routes/api/back-office/donations/[query]/+server.ts (รับของ) · [query]/approve (+ reject) · frontend/src/lib/components/pending-review-detail.svelte
  - frontend/src/routes/(protected)/back-office/stock-donations/components/scan-station.svelte
  - frontend/src/routes/api/public/v1/donations/[tracking_token]/items/+server.ts (เขียน `status`, `schema_v`)
  - frontend/src/lib/components/public-donor-success-ticket.svelte · lib/features/donations/domain/tracking.ts
why: ของที่ศูนย์ประกาศขอในแคมเปญไม่ต้องรอเจ้าหน้าที่ประเมิน คิว "รอการประเมิน" จะเหลือเฉพาะของนอกแคมเปญ
migration: field ใหม่ optional — doc เดิมไม่ต้อง backfill (ไม่มี `review_status` = ใช้สถานะระดับใบตามเดิม)
---

# CR-174 — ประเมินใบบริจาคทีละรายการ — รายการในแคมเปญไม่ต้องรอประเมิน

## สรุป

- **เปลี่ยน:** การประเมินย้ายจากระดับใบเป็น**ระดับรายการ** รายการที่เป็นของในแคมเปญถือว่าอนุมัติแล้วตั้งแต่จอง ส่วนรายการที่พิมพ์เอง/นอกแคมเปญยังต้องประเมิน · ใบที่ทุกรายการอยู่ในแคมเปญเริ่มที่ `verifying` และได้ QR ทันที · ยกเลิกกฎ CR-052 §1.4
- **เพื่อ:** ลดงานในคิว "รอการประเมิน" ที่ล้นโดยไม่จำเป็น
- **dev ต้อง build:** `items[].review_status` + คำนวณสถานะใบจากรายการ (ตอนสร้างและตอนผู้บริจาคแก้) · BFF เขียนสถานะใบที่คำนวณใหม่ลง CouchDB · route รับของเช็ค `expected_rev` · หน้าประเมินแสดงเฉพาะรายการที่ต้องประเมิน · ตั๋ว/หน้าติดตามแสดงสถานะใหม่
- **สิทธิ์ผู้บริจาคหลังได้ QR:** ยกเลิก แก้รายการ และใส่เลขพัสดุได้ (ถ้าแก้แล้วมีรายการที่ต้องประเมิน ใบจะกลับไปรอประเมิน) · บันทึก audit การอนุมัติอัตโนมัติ
- **กระทบ:** `donation` schema_v 6 → 7 · projection `public_donations` (bump `PROJECTION_VERSION`) · CR-052 §1.4 · CR-080 (สิทธิ์แก้รายการ) · quota/slot ไม่เปลี่ยน

## Requirements

### สถานะแยกตามรายการ
- **FR-1** — `donation.items[]` เพิ่ม `review_status: enum('approved','pending','rejected')`, `review_reason_code: enum|null` (ค่าเดียวกับ `reject_reason_code` ของ CR-172 FR-2: `not_needed`, `expired`, `damaged`, `other`) และ `review_reason: str|null` (≤ 500) — สอง field เหตุผลเขียนเมื่อ `rejected` เท่านั้น
- **FR-2** — ตอนสร้าง รายการที่มี `item_id` อยู่ในแคมเปญที่เปิดอยู่ของใบนั้น และจองโควต้าได้ → `approved` · รายการอื่น (พิมพ์เอง, ไม่มีแคมเปญ, counter `NOT_SEEDED`) → `pending`
- **FR-3** — ฝั่ง client กำหนด `review_status` เองไม่ได้ (FastAPI คำนวณหลังจองโควต้า)

### สถานะระดับใบ (derived จากรายการ)
- **FR-4** — มีรายการ `pending` อย่างน้อย 1 → ใบเป็น `pending_review`
- **FR-5** — ไม่มีรายการ `pending` และมี `approved` อย่างน้อย 1 → ใบเป็น `verifying`
- **FR-6** — ทุกรายการ `rejected` → ใบเป็น `rejected`
- **FR-7** — ใบที่ทุกรายการอยู่ในแคมเปญเริ่มที่ `verifying` ทันที ไม่ขึ้นในคิว "รอการประเมิน" · ใบที่มีแต่รายการที่พิมพ์เองเริ่มที่ `pending_review` (เหมือนเดิม)

### หน้าประเมิน (เจ้าหน้าที่)
- **FR-8** — หน้าประเมิน (`pending-review-detail`) แสดงเฉพาะรายการ `pending` ให้อนุมัติหรือปฏิเสธ รายการ `approved` แสดงเป็นข้อมูล (read-only) แยกป้ายตามที่มา: อนุมัติอัตโนมัติตาม FR-2 → "อยู่ในแคมเปญ · อนุมัติอัตโนมัติ" · เจ้าหน้าที่อนุมัติ → "อนุมัติแล้ว"
- **FR-9** — ปฏิเสธรายการต้องเลือกเหตุผลสำเร็จรูป (`review_reason_code`) และกรอกรายละเอียด (`review_reason`) — กติกาเดียวกับ CR-172 FR-6 (รายละเอียดบังคับเมื่อเลือก `other`)
- **FR-10** — ประเมินครบทุกรายการที่ `pending` แล้ว ระบบคำนวณสถานะใบตาม FR-4..FR-6 (ใบไป `verifying` หรือ `rejected`)
- **FR-11** — การอนุมัติ/ปฏิเสธเขียน `audit` เหมือนเดิม (route `/approve`, `/reject` เดิมขยายให้รับผลแยกตามรายการ)
- **FR-12** — ปุ่ม "ปฏิเสธคำขอ" ทั้งใบยังอยู่ · **ทุกทาง**ที่ใบเปลี่ยนเป็น `rejected` (ปุ่มบนหน้าประเมิน · ปุ่มปฏิเสธบนหน้าสแกน `verifying → rejected` · ไม่รับทุกรายการตอนตรวจรับตาม CR-172 FR-12) → ทุกรายการที่ยังไม่ `rejected` (ทั้ง `approved` และ `pending`) เปลี่ยนเป็น `rejected` ในการบันทึกครั้งเดียวกับที่ใบเปลี่ยนเป็น `rejected` · เหตุผลเก็บที่ระดับใบ (`reject_reason`, `reject_reason_code` ตาม CR-172) ไม่ copy ลง `review_reason` ของแต่ละรายการ · โควต้าและ slot คืนตามกลไกเดิมของ `rejected`

### ของสด / แช่เย็น
- **FR-13** — ไม่มีข้อยกเว้นสำหรับของสด/แช่เย็น รายการในแคมเปญไม่ต้องรอประเมินเหมือนกันทุกชนิด · เจ้าหน้าที่ปฏิเสธได้ที่หน้าตรวจรับตอนของมาถึง (`verifying → rejected` มีอยู่แล้ว · ไม่รับบางรายการตาม CR-172)
- **FR-14** — ตัดข้อ "CR-052 Cold-chain" (เช็ค `is_cold_chain` จาก item master) ออกจาก T-16 — field นี้ไม่เคยมีในโค้ดหรือ schema

### ผู้บริจาค
- **FR-15** — response ของ `POST /public/v1/donations` (FastAPI และ BFF) ส่ง `status` กลับ
- **FR-16** — ตั๋วหลังจอง: ไม่มีรายการรอประเมิน → แสดง QR ทันที · มีรายการรอประเมิน → ข้อความรอเจ้าหน้าที่ตรวจสอบ
- **FR-17** — หน้าติดตามแสดงสถานะแยกตามรายการ: "อนุมัติแล้ว / รอนำส่ง" (`approved`) · "รอประเมิน" (`pending`) · "ไม่รับ" + เหตุผล (`rejected`) · ใบที่ `rejected` ทั้งใบแสดงเหตุผลระดับใบตาม CR-172 FR-15
- **FR-18** — ผู้บริจาคแก้รายการ (PATCH items) → FastAPI คำนวณ `review_status` ของทุกรายการใหม่ตาม FR-2 แล้วคำนวณสถานะใบตาม FR-4..FR-6 และเขียนทั้งสองลง `DonationBuffer` (ใบที่ยังไม่ sync ลง CouchDB ได้สถานะใหม่ผ่าน inbound ซึ่ง copy `status` จาก buffer) · รายการที่เจ้าหน้าที่ประเมินไปแล้วและไม่ถูกแก้คงผลเดิม
- **FR-18a** — "รายการไม่ถูกแก้" = มีรายการในใบเดิมที่ `item_id`, `category`, `free_text`, `qty`, `unit`, `condition`, `note` ตรงกันทุก field (ทุก field ของ `DonationItemInput`; ค่าว่างกับไม่มี field ถือว่าเท่ากัน; `qty` เทียบเป็นตัวเลข) · รายการเดิมหนึ่งรายการจับคู่ได้ครั้งเดียว · ต่างแม้ field เดียว (รวม `note`, `condition`, `category`) = ถูกแก้ → คำนวณใหม่ตาม FR-2
- **FR-18b** — `DonationItemsPatchResponse` ส่ง `status` (สถานะใบหลังคำนวณ) กลับ · BFF `items/+server.ts` เขียน `items`, `revisions`, `status` และ `schema_v` ปัจจุบันของ donation (อ้างค่าคงที่ร่วม ไม่ hard-code) ลง CouchDB ใน `PUT` เดียวกัน (เลิกเขียน `schema_v = 4` ตายตัว)
- **FR-18c** — ใบที่ไม่มี `review_status` (สร้างก่อน schema_v 7) ผู้บริจาคแก้รายการ:
  - `verifying` → ก่อนใช้ FR-18a ถือว่าทุกรายการเดิม `approved` (เจ้าหน้าที่อนุมัติทั้งใบแล้ว)
  - `pending_review` → ถือว่ายังไม่มีรายการใดถูกประเมิน · คำนวณทุกรายการตาม FR-2 (เงื่อนไข "จองโควต้าได้" ใช้ผลการจองของ `update_items` ครั้งนั้น) แล้วคำนวณสถานะใบตาม FR-4..FR-6 — ผลเท่ากับใบใหม่
  - `declared` → ไม่เขียน `review_status` ลงรายการใด และไม่คำนวณสถานะใบใหม่ (คง `declared`)

> **แทนที่โดย [CR-196](CR-196-donation-line-key.md) (approved 2026-10-26):** ผู้บริจาคแก้รายการได้เฉพาะใบที่ยังไม่ได้รับการประเมิน (FR-LK-4) จึงไม่มีผลประเมินเดิมให้คง — FR-18a (จับคู่ "รายการไม่ถูกแก้" ด้วย 7 field) และ decision sync 2026-10-25 ข้างล่างเลิกใช้ ทุกรายการคำนวณใหม่ตาม FR-2 และจับคู่รายการเดิมด้วย `items[].line_key` · FR-18c `verifying` ไม่เกิดแล้ว (ใบ `verifying` แก้ไม่ได้) · `pending_review` / `declared` คงเดิม

> **decision sync 2026-10-25 (เสนอโดย Kunanon Nusaeng · รอ approve):** ข้อยกเว้นของ FR-18a/FR-2 — ตอนผู้บริจาคแก้รายการ รายการที่ `free_text` ตรงกับรายการเดิม ≥ 2 รายการที่ `category`/`condition`/`note` ต่างกัน (ฟอร์มแก้รายการไม่ส่งสาม field นี้ จึงบอกไม่ได้ว่าเป็นรายการเดิมตัวไหน) และไม่ตรงกับรายการเดิมตาม FR-18a → `pending` เสมอ **ไม่อนุมัติอัตโนมัติ** แม้จองโควต้าในแคมเปญได้. เหตุผล: review PR #783 H1 — รายการในแคมเปญที่เจ้าหน้าที่ `rejected` กลับเป็น `approved` และใบได้ QR. ชั่วคราวจนกว่า `draft-donation-line-key` (PR #859) จะ approve และจับคู่รายการด้วย `line_key` แทน. ไม่เปลี่ยน field / schema_v

### สิทธิ์ผู้บริจาคหลังได้ QR (`verifying`)
- **FR-20** — ใบ `verifying` ผู้บริจาค**ยกเลิกได้** (เหมือน `pending_review`) · ยกเลิกแล้วคืนโควต้าและ slot ทันทีตามกลไกเดิมของการยกเลิก (ยกเว้นใบที่มีของเข้าคลังแล้ว — decision sync 2026-10-22 ด้านล่าง)
- **FR-21** — ใบ `verifying` ผู้บริจาค**แก้รายการได้** ตามกฎ FR-18: รายการที่แก้หรือเพิ่มถูกคำนวณ `review_status` ใหม่ (ถ้าเป็นรายการที่พิมพ์เอง → `pending` แม้เจ้าหน้าที่เคยอนุมัติรายการนั้นแล้ว) · ถ้ามีรายการ `pending` ใบกลับไป `pending_review` และ QR ใช้ไม่ได้จนกว่าประเมินครบ (ยกเว้นใบที่มีของเข้าคลังแล้ว — decision sync 2026-10-22 ด้านล่าง)
- **FR-22** — ใบ `verifying` ผู้บริจาค**ใส่/แก้เลขพัสดุได้**
- **FR-23** — กฎสิทธิ์ (แก้ / ยกเลิก / เลขพัสดุ) ใช้ชุดสถานะเดียวกันทั้ง backend (`DONOR_EDITABLE_STATUSES`) และ frontend (`public-donation.ts`, `tracking.ts`) → `{declared, pending_review, verifying}`

> **แก้โดย [CR-196](CR-196-donation-line-key.md) (approved 2026-10-26):** ชุด `{declared, pending_review, verifying}` ใช้กับยกเลิกและเลขพัสดุเท่านั้น (FR-LK-10/11) · แก้รายการได้เฉพาะ `declared`/`pending_review` ที่ไม่มีรายการ `approved`/`rejected` (FR-LK-4, `item_edit_gate` / `donationItemEditGate`) → FR-21 และ FR-24 เลิกใช้

> **decision sync 2026-10-22 (เสนอโดย Kunanon Nusaeng · รอ approve):** ใบที่มีของเข้าคลังแล้วอย่างน้อย 1 รายการ (มีแถว `stock_ledger` ที่ `reason: donation` และ `ref_id` ชี้มาที่ใบนี้) ผู้บริจาค**ยกเลิกไม่ได้และแก้รายการไม่ได้** แม้สถานะยังอยู่ใน `DONOR_EDITABLE_STATUSES` — BFF ตอบ `409 GOODS_IN_STOCK` ก่อนแตะโควตาที่ FastAPI (`DELETE /public/v1/donations/{tracking_token}`, `PATCH …/items`). ใส่/แก้เลขพัสดุ (FR-22) ทำได้ตามเดิม. เหตุผล: การยกเลิกจะคืนโควตาทั้งที่ของอยู่บนชั้นแล้ว และการแก้รายการจะเลื่อนลำดับรายการใต้แถวคลังที่บันทึกตามลำดับเดิม (`deriveDonationReceiptLineId`). ไม่เปลี่ยน field / schema_v
- **FR-24** — หน้าติดตามเตือนก่อนบันทึกการแก้ใบที่ได้ QR แล้วว่า "ถ้ามีรายการที่ต้องประเมิน QR จะใช้ไม่ได้จนกว่าเจ้าหน้าที่ประเมินเสร็จ"
- **FR-25** — `receiveDonationInputSchema` เพิ่ม `expected_rev: str` (req) · `scan-station.svelte` ส่ง `_rev` ของใบที่โหลดมาตอนเปิดหน้าตรวจรับ · route รับของ (`[query]/+server.ts`) เทียบกับ `_rev` ของใบล่าสุด ไม่ตรง → 409 ให้โหลดใหม่
- **FR-25a** — การเช็ค FR-25 ต้องทำก่อนเขียน `stock_ledger` / `audit` ใด ๆ → 409 จาก FR-25 ไม่มีแถวใหม่
  > ไม่อยู่ในขอบเขต CR นี้: route นี้สุ่ม `_id` ของ ledger ใหม่ทุกครั้ง ถ้า `PUT` donation ชนหลังเขียน ledger แล้วเจ้าหน้าที่กดรับซ้ำ ของจะเข้าคลังซ้ำ — ขัด CR-143 FR-B4a อยู่แล้ว แก้เป็น bug แยก (#695) โดยใช้ `deriveDonationReceiptLineId` แบบหน้ารับของทีละรายการ

### Audit
- **FR-26** — รายการที่อนุมัติอัตโนมัติ (FR-2) บันทึก `audit` (`action: manual_adjust`, `context: {approved_by: 'system', rule: 'campaign_line', lines: [...]}`) — worker inbound เป็นคนเขียนตอนเขียน doc ลง CouchDB (FastAPI เขียน CouchDB ไม่ได้) · ผู้บริจาคแก้ใบแล้วมีรายการที่ได้ `approved` อัตโนมัติเพิ่ม (รวมใบที่ไป `verifying` เพราะลบรายการที่พิมพ์เองออก) → BFF `items/+server.ts` เขียน audit รูปเดียวกัน (`lines` = เฉพาะรายการที่เพิ่งได้ `approved`) หลัง `PUT` donation สำเร็จ · ใบที่ยังไม่ sync ลง CouchDB ให้ inbound เขียนตามสถานะสุดท้ายใน buffer · ใช้ `manual_adjust` เพราะ enum `audit.action` (schema §2.12) ไม่มีค่าสำหรับการอนุมัติ และการอนุมัติ/ปฏิเสธโดยเจ้าหน้าที่ใช้ค่านี้อยู่แล้ว · แยกระบบกับคนด้วย `context.approved_by` ไม่เพิ่มค่า enum ใน CR นี้

### Projection (`public_donations`)
- **FR-27** — `DeclaredItem` (`packages/tent-model/src/tent_model/public_donation.py`) เพิ่ม `review_status`, `review_reason_code`, `review_reason` · projector `donation.py` ส่งต่อทั้งสามไปที่ `items_declared[]` · bump `PROJECTION_VERSION` (หน้าติดตามอ่าน `items` จาก CouchDB ก่อน — projection เป็น fallback และต้องมีข้อมูลเท่ากัน)

### Quota / slot
- **FR-19** — quota counter และ slot นับเหมือนเดิม (`pending_review` และ `verifying` อยู่ใน `DONATION_OUTSTANDING_STATUSES` ทั้งสองฝั่ง)

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ระดับการประเมิน | ทั้งใบ | แยกตามรายการ (`items[].review_status`) |
| สถานะตั้งต้น | `pending_review` ทุกใบ (`use_case.py` `INITIAL_DONATION_STATUS`) | คำนวณจากรายการ (FR-4..FR-7) |
| CR-052 §1.4 | บังคับประเมินทุกรายการ ห้ามออก QR อัตโนมัติทุกกรณี | รายการในแคมเปญไม่ต้องประเมิน · ใบที่ทุกรายการอยู่ในแคมเปญได้ QR ทันที |
| T-16 "CR-052 Cold-chain" | เช็ค `is_cold_chain` แล้วบังคับประเมิน | ตัดออก (FR-14) |
| หน้าประเมิน | อนุมัติ/ปฏิเสธทั้งใบ | อนุมัติ/ปฏิเสธเฉพาะรายการที่รอประเมิน (ปฏิเสธทั้งใบยังทำได้) |
| ตั๋วหลังจอง | "ส่งรายการรอเจ้าหน้าที่ตรวจสอบ" เสมอ | QR ทันทีเมื่อไม่มีรายการรอประเมิน |

## Acceptance

- **AC-1** — ใบที่ทุกรายการเป็นของในแคมเปญ → สร้างเป็น `verifying` · ไม่ขึ้นในคิว "รอการประเมิน" · ตั๋วแสดง QR
- **AC-2** — ใบผสม (มีทั้งรายการในแคมเปญและรายการที่พิมพ์เอง) → รายการในแคมเปญ `approved` · รายการที่พิมพ์เอง `pending` ขึ้นให้ประเมิน · อนุมัติครบ → ใบไป `verifying`
- **AC-3** — ใบผสม ปฏิเสธรายการที่พิมพ์เองทุกรายการ → ใบไป `verifying` (เหลือรายการในแคมเปญ) · ผู้บริจาคเห็นเหตุผลของแต่ละรายการที่ถูกปฏิเสธ
- **AC-4** — ใบที่มีแต่รายการที่พิมพ์เอง → เริ่มที่ `pending_review` · ปฏิเสธทุกรายการ → `rejected`
- **AC-5** — ของสด/แช่เย็นในแคมเปญไม่ต้องรอประเมินเหมือนรายการอื่น และปฏิเสธได้ที่หน้าตรวจรับ
- **AC-6** — quota counter และ slot นับเหมือนเดิม
- **AC-7** — ผู้บริจาคแก้ใบที่ `verifying` โดยเพิ่มรายการที่พิมพ์เอง → ใบกลับไป `pending_review` และรายการใหม่ `pending`
- **AC-8** — doc ก่อน schema_v 7 (ไม่มี `review_status`) แสดงผลและประเมินแบบทั้งใบได้ตามเดิม
- **AC-9** — ใบ `verifying` ผู้บริจาคกดยกเลิกได้ · โควต้าและ slot คืนทันที (จองต่อได้)
- **AC-10** — ใบ `verifying` ที่เจ้าหน้าที่อนุมัติรายการที่พิมพ์เองไปแล้ว ผู้บริจาคแก้รายการนั้น → รายการกลับเป็น `pending` ใบกลับ `pending_review`
- **AC-11** — ใบ `verifying` ใส่เลขพัสดุได้
- **AC-12** — ใบที่ทุกรายการอยู่ในแคมเปญมี audit `approved_by: system`
- **AC-13** — ผู้บริจาคแก้ใบขณะเจ้าหน้าที่เปิดหน้าตรวจรับค้าง → กดยืนยันรับเข้าคลังแล้วได้ 409 · ไม่มีแถว `stock_ledger` ใหม่ · โหลดใหม่แล้วรับได้ปกติ
- **AC-14** — ผู้บริจาคแก้ใบ `verifying` ให้มีรายการ `pending` → doc ใน CouchDB เป็น `pending_review` และ `schema_v` 7 · ใบขึ้นในคิว "รอการประเมิน"
- **AC-15** — ปฏิเสธทั้งใบที่มีรายการ `approved` จากหน้าประเมินและจากหน้าสแกน → ทุกรายการเป็น `rejected` · หน้าติดตามแสดงเหตุผลระดับใบ
- **AC-16** — ผู้บริจาคแก้เฉพาะ `note` ของรายการที่พิมพ์เองซึ่งเจ้าหน้าที่อนุมัติแล้ว → รายการนั้นกลับเป็น `pending` · รายการอื่นที่ไม่แตะคงผลเดิม
- **AC-17** — ปฏิเสธรายการด้วยเหตุผล `other` โดยไม่กรอกรายละเอียด → ยืนยันไม่ได้ (422 จาก API ด้วย)
- **AC-18** — `public_donations.items_declared[]` ของใบใหม่มี `review_status` ตรงกับ CouchDB
- **AC-19** — ใบ `verifying` ก่อน schema_v 7 ที่มีรายการที่พิมพ์เองด้วย ผู้บริจาคแก้เฉพาะจำนวนของรายการในแคมเปญ → รายการที่พิมพ์เองคง `approved` · ใบคง `verifying`
- **AC-20** — ใบ `pending_review` ก่อน schema_v 7 ที่มีทั้งรายการในแคมเปญและรายการที่พิมพ์เอง ผู้บริจาคแก้รายการใดก็ได้ → รายการในแคมเปญทุกรายการ `approved` · รายการที่พิมพ์เอง `pending` · ใบคง `pending_review`
- **AC-21** — ใบ `declared` ผู้บริจาคแก้รายการ → ใบคง `declared` · ไม่มีรายการที่มี `review_status`
- **AC-22** — ใบ `pending_review` ผู้บริจาคลบรายการที่พิมพ์เองออกจนเหลือแต่รายการในแคมเปญ → ใบเป็น `verifying` · ทุกรายการที่เหลือมี audit `approved_by: system` (จากตอนสร้าง หรือจากการแก้ครั้งนี้สำหรับใบก่อน schema_v 7) · ไม่มี audit ซ้ำของรายการที่เคยได้ `approved` แล้ว

## Impact

- **backend:** ฟังก์ชัน pure คำนวณ `review_status` และสถานะใบ (ใช้ทั้ง create และ `update_items`) + กฎจับคู่รายการไม่ถูกแก้ (FR-18a) และใบก่อน schema_v 7 (FR-18c) + test ครบทุกกรณี · `DonationCreateResponse.status` และ `DonationItemsPatchResponse.status` (FR-18b) · `DONOR_EDITABLE_STATUSES` เพิ่ม `verifying` (gate ของ edit / cancel / courier) · `pnpm openapi:update`
- **tent-model:** `DonationBuffer.items_declared[]` และ `PublicDonation.DeclaredItem` เพิ่ม `review_status`, `review_reason_code`, `review_reason`
- **worker:** inbound copy `items` ทั้งก้อน (field ใหม่ผ่านถึง CouchDB) + เขียน audit อนุมัติอัตโนมัติ (FR-26) · projector `donation.py` ส่งต่อ field ใหม่ + bump `PROJECTION_VERSION` (FR-27)
- **frontend:** type `Donation` + `DONATION_TRANSITIONS` (เพิ่ม edge `verifying → pending_review` สำหรับ FR-18/FR-21) · gate สิทธิ์ผู้บริจาคใน BFF (`[tracking_token]/+server.ts` DELETE + courier, `items/+server.ts`) และ `public-donation.ts` / `tracking.ts` · BFF `items/+server.ts` เขียน `status` + `schema_v` ปัจจุบัน (FR-18b) และ audit อนุมัติอัตโนมัติจากการแก้ (FR-26) · `receiveDonationInputSchema.expected_rev` + `scan-station.svelte` ส่ง `_rev` + route รับของเช็คก่อนเขียน ledger (FR-25, FR-25a) · route approve/reject รับผลแยกตามรายการ · ทุก route ที่เปลี่ยนใบเป็น `rejected` (reject, รับของเมื่อไม่รับทุกรายการ) เปลี่ยนทุกรายการ (FR-12) · `pending-review-detail.svelte` (ป้าย FR-8, ฟอร์มเหตุผล FR-9) · ตั๋ว · `tracking.ts` + หน้าติดตาม
- **e2e:** `bookAsDonor` จองจากการ์ดแคมเปญ → จะได้ `verifying` ทันที ต้องแยก helper (`bookFromCampaign` / `bookUnsolicited`) · test ที่ต้องการใบรอประเมินใช้ `bookUnsolicited`
- **ซ้อนกับ CR-172 (#621):** การไม่รับบางรายการ**ตอนตรวจรับ**ใช้ `received_summary.items[].rejected` ส่วน FR-9 นี้คือการปฏิเสธบางรายการ**ตอนประเมิน** ใช้ชุดเหตุผลเดียวกัน และหน้าติดตามแสดงแบบเดียวกัน · ทั้งสอง CR แก้ route รับของ, projector และ `PROJECTION_VERSION` — ถ้า implement พร้อมกัน bump ครั้งเดียว

## Migration

- **schema_v 6 → 7:** `items[].review_status` / `review_reason_code` / `review_reason` optional → doc เดิมไม่ต้อง backfill · reader ที่เจอใบไม่มี `review_status` ใช้สถานะระดับใบตามเดิม · donation ใหม่และใบที่ผู้บริจาคแก้ เขียนเป็น schema_v 7
- `public_donations`: bump `PROJECTION_VERSION` เพื่อ re-project ใบเดิม (ใบเดิมไม่มี field ใหม่ ผลคือรูปเท่าเดิม)

## Why

- ของในแคมเปญคือของที่ศูนย์ประกาศขอเอง การบังคับประเมินซ้ำทำให้คิว "รอการประเมิน" ล้นโดยไม่จำเป็น
- รายการนอกแคมเปญยังต้องประเมิน เพราะศูนย์ยังไม่รู้ว่าเป็นของอะไร — การประเมินทีละรายการทำให้ใบผสมไม่ต้องรอทั้งใบเพราะรายการเดียว
- เหตุผลเดิมของ CR-052 §1.4 คือของแช่เย็น — ของมาถึงแล้วเจ้าหน้าที่ยังตรวจจริงที่หน้างานและปฏิเสธได้ จึงไม่ต้องกั้นไว้ที่ขั้นประเมิน
- ทางเลือกที่ตัดทิ้ง: ยกเว้นการประเมินทั้งใบเฉพาะใบที่ทุกรายการอยู่ในแคมเปญ (ใบผสมรอประเมินทั้งใบ) — ใบผสมจะยังติดคิวทั้งที่ส่วนใหญ่อยู่ในแคมเปญ

## Decision log

- 2026-10-17 — เจ้าของโครงการ: ใช้ข้อกำหนดตามคำอธิบาย issue #610 (ประเมินทีละรายการ · ไม่มีข้อยกเว้น cold-chain · quota/slot ไม่เปลี่ยน)
- 2026-10-18 — เจ้าของโครงการ: ใบที่ได้ QR แล้ว (`verifying`) ผู้บริจาคยังยกเลิกได้ (คืนโควต้า — ช่วงน้ำท่วมอาจเดินทางมาส่งไม่ได้) และแก้ไขได้ · เก็บ audit การอนุมัติอัตโนมัติ
- 2026-10-17 — proposed (track ด้วย CR file แยก branch)
- 2026-10-18 — แก้ตาม review PR #676: `expected_rev` เช็คก่อนเขียน ledger (FR-25, FR-25a) · BFF sync `status` และ `schema_v` (FR-18b) · projector (FR-27) · `review_reason_code` · ปฏิเสธทั้งใบ (FR-12) · กฎรายการไม่ถูกแก้ (FR-18a) และใบก่อน schema_v 7 (FR-18c: `pending_review` เดิมคำนวณใหม่เหมือนใบใหม่ · `declared` ไม่เขียน `review_status`) · audit อนุมัติอัตโนมัติจากการแก้ของผู้บริจาค (FR-26) · schema_v 6 → 7 หลัง CR-172
- 2026-10-18 — เจ้าของโครงการ: รายการในแคมเปญคงอนุมัติอัตโนมัติ หน้าประเมินไม่มีปุ่มปฏิเสธรายการเหล่านี้ (ไม่รับได้ที่หน้าตรวจรับตาม FR-13)
- 2026-10-18 — เจ้าของโครงการ: ledger ซ้ำเมื่อ `PUT` donation ชนหลังเขียน ledger เป็น bug เดิม แก้แยกจาก CR นี้ (#695)
- 2026-10-19 — approved by Soravit Sukkarn (Team Lead) — requested by Kan (รันเลข CR-174 ย้ายเข้าหมวด 04-donation)
- 2026-10-21 — implement ใน branch `feat/donation-review-intake-flow` (ต่อจาก CR-172) · `PROJECTION_VERSION` 7 ครอบทั้ง CR-172 + CR-174 (bump ครั้งเดียว ยังไม่ release) · `PATCH …/items` รับ `current_items` / `current_status` (opt) จาก BFF เพราะผลประเมินของเจ้าหน้าที่อยู่ใน CouchDB ที่ FastAPI อ่านไม่ได้ · response เพิ่ม `auto_approved_lines` ให้ BFF เขียน audit FR-26 · audit ของ inbound ใช้ `_id` คงที่ต่อใบ (idempotent) · ข้อ "CR-052 (Task #52)" / "CR-052 Cold-chain" ที่ `affects` อ้างเป็น T-16 จริง ๆ อยู่ใน DoD ของ T-15 — แก้ที่ T-15
- 2026-10-25 — decision sync 2026-10-25 (รายการชื่อซ้ำที่จับคู่ไม่ได้ → `pending`, review #783 H1) และระบุผู้เสนอ decision sync 2026-10-22 — เสนอโดย Kunanon Nusaeng, รอ approve
