---
id: draft # เปลี่ยนเป็น CR-NNN เมื่ออนุมัติ
title: เจ้าหน้าที่กำหนดจุดรับบริจาค — แคมเปญตั้งจุดตอนสร้างประกาศ · บริจาคเองเลือกจุดตอนประเมิน
status: proposed
date: 2026-10-31
updated: 2026-10-31
requested_by: Kunanon Nusaeng
decided_by: (รอ)
layer: volatile
why: "ผู้บริจาคไม่รู้ว่าจุดรับบริจาคไหนเก็บของประเภทไหน · เจ้าหน้าที่รู้ จึงให้เจ้าหน้าที่เป็นคนกำหนดจุดแทนผู้บริจาค (CR-206 FR-MP-8)"
migration: "แคมเปญเดิมไม่มี `needs[].drop_off_point_id` = `null` · ใบบริจาคเดิมคงจุดที่ผู้บริจาคเลือก · ไม่ re-project Mongo"
depends_on: "CR-206-donation-multi-drop-off (#1038 · merge 2026-10-30) · CR-174-donation-campaign-auto-approve · CR-196-donation-line-key · CR-205-storage-drop-off-points"
affects:
  - schema_v donation_campaign 3 → 4 · donation 11 (ไม่เปลี่ยน) · PROJECTION_VERSION 14 (ไม่เปลี่ยน)
  - docs/data/schema.md §2.4 `donation_campaign` — field ใหม่ `needs[].drop_off_point_id`
  - docs/data/schema.md §2.3 `donation` — ผู้เขียน `items[].drop_off_point_id` เปลี่ยนจากผู้บริจาคเป็นระบบ (จากแคมเปญ) และเจ้าหน้าที่ (ตอนประเมิน)
  - docs/data/api-contract.md §5 — `POST /public/v1/donations` (request ไม่รับจุดจาก client ผ่าน BFF · response เพิ่ม `items[]` · เลิก `400 UNKNOWN_DROP_OFF_POINT`) · `PATCH …/{tracking_token}/items` (ไม่รับจุดจาก client · คงจุดของรายการเดิม) · ข้อความ `drop_off_point_id` ที่ ~:860 · body ของ `POST /api/back-office/donations/[query]/approve`
  - docs/changes/04-donation/CR-206-donation-multi-drop-off.md — superseded FR-MP-2 (ส่วนตรวจตอนจอง), FR-MP-2a, FR-MP-2b (ส่วน "FR-MP-2 ยังตรวจกับ Mongo"), FR-MP-3, FR-MP-8 – FR-MP-12, FR-MP-15 (ตัวเลือกจุดใน dialog) · แก้ FR-MP-13 / FR-MP-16 (กลุ่ม "รอเจ้าหน้าที่กำหนดจุดส่ง") · superseded AC-1 – AC-4, AC-13 (ข้อความ "ผู้บริจาคแก้รายการ … id ถูกเขียนเป็น null"), A1 acceptance ข้อ 2
  - docs/changes/00-baseline/CR-205-storage-drop-off-points.md FR-DP-18 / AC-12 — หมุดจุดยังแสดง แตะแล้วไม่เลือกจุด (FR-AP-11)
  - docs/features/public-tier-donation-spec.html — ฟอร์มจองขั้น 3 ไม่มีตัวเลือกจุด
  - frontend/src/lib/features/operations/domain/operations.ts (`CampaignNeed`, `campaignInputSchema`, `createCampaign`, `editNeed`)
  - frontend/src/lib/features/operations/application/use-donation-needs-board.svelte.ts
  - frontend/src/routes/(protected)/back-office/stock-donations/components/create-campaign-form.svelte · edit-campaign-form.svelte · frontend/src/lib/components/needs-board-admin.svelte
  - frontend/src/lib/features/donations/domain/line-points.ts · donation.ts · public-donation.ts · item-review.ts
  - frontend/src/lib/components/form/donor-time-selection-form.svelte · frontend/src/lib/features/donations/ui/drop-off-points-section.svelte · edit-donation-items-dialog.svelte · frontend/src/routes/(public)/donations/donation.svelte.ts · frontend/src/lib/components/public-donor-needs.svelte
  - frontend/src/lib/components/public-donor-success-ticket.svelte · frontend/src/routes/(public)/donations/track/[token]/+page.svelte
  - frontend/src/routes/api/public/v1/donations/+server.ts · [tracking_token]/items/+server.ts
  - frontend/src/routes/api/back-office/donations/[query]/approve/+server.ts · frontend/src/lib/components/pending-review-detail.svelte · frontend/src/routes/(protected)/back-office/stock-donations/+page.svelte
  - backend/apiapp/modules/donations/use_case.py (`create`, `_pair_held_lines`) · schemas.py (`DonationCreateResponse`)
  - tests — backend/tests/test_donation_drop_off_points.py · frontend/e2e/donation-multi-drop-off.test.ts · unit test ของไฟล์ข้างบน
---

# เจ้าหน้าที่กำหนดจุดรับบริจาค — แคมเปญตั้งจุดตอนสร้างประกาศ · บริจาคเองเลือกจุดตอนประเมิน

## สรุป (TL;DR)

- **เปลี่ยน:** ผู้บริจาคไม่เลือกจุดรับบริจาคอีกต่อไป · รายการจากแคมเปญได้จุดที่เจ้าหน้าที่ตั้งไว้ใน need ของแคมเปญตอนสร้างประกาศ · รายการที่บริจาคเอง เจ้าหน้าที่เลือกจุดให้ตอนประเมิน
- **เพื่อ:** เจ้าหน้าที่รู้ว่าแต่ละจุดเก็บของอะไรได้ ผู้บริจาคไม่รู้ · ลดของไปผิดจุด
- **dev ต้อง build:** field `needs[].drop_off_point_id` + dropdown ในฟอร์มแคมเปญ · BFF จองใส่จุดจากแคมเปญเอง และส่งจุดต่อรายการกลับให้ตั๋ว · FastAPI คงจุดของรายการเดิมตอนแก้ · dropdown จุดในหน้าประเมิน + body approve · ลบตัวเลือกจุดฝั่งผู้บริจาค
- **กระทบ:** campaign schema_v 3 → 4 · donation schema_v และ PROJECTION_VERSION ไม่เปลี่ยน · แก้ CR-206 ฝั่งผู้บริจาค · ฝั่งรับของทีละจุดของ CR-206 ไม่เปลี่ยน

## Why

- CR-206 ให้ผู้บริจาคเลือกจุดเองทีละรายการ (FR-MP-8) · ผู้บริจาคไม่รู้ว่าจุดไหนเก็บของประเภทไหน · เจ้าหน้าที่เป็นคนรู้
- แคมเปญเป็นของที่เจ้าหน้าที่ประกาศขอเอง จึงรู้ตั้งแต่ตอนสร้างว่าของชิ้นนั้นต้องไปจุดไหน
- ของที่ผู้บริจาคพิมพ์เองต้องผ่านหน้าประเมินอยู่แล้ว (CR-174 FR-2, FR-7) · เจ้าหน้าที่จึงเลือกจุดในขั้นเดียวกันได้โดยไม่เพิ่มขั้นตอน
- ใบเก็บ `items[].drop_off_point_id` อยู่แล้ว (CR-206 FR-MP-1) และหน้าสแกนรับทีละจุดอ่าน field นี้ (CR-206 FR-MP-19) · CR นี้เปลี่ยนผู้เขียน field ไม่เปลี่ยน shape ของใบ

## Requirements

**คำที่ใช้**

- **รายการแคมเปญ** = รายการของใบที่มี `item_id` ตรงกับ need ในแคมเปญที่ผูกกับใบ (`donation.campaign_id`) · ถ้าแคมเปญมีหลาย need ที่ `item_id` เดียวกัน ใช้ need แรกในลำดับ `needs[]`
- **รายการบริจาคเอง** = รายการอื่นทั้งหมด (ไม่มี `item_id`, `item_id` ไม่อยู่ในแคมเปญของใบ หรือใบไม่มี `campaign_id`)
- **จุดปัจจุบันของศูนย์** = จุดรับบริจาคตามกติกา CR-206 FR-MP-2a: `common_areas.sub_storage[]` ของ shelter doc ใน CouchDB ที่ `accepts_donations = true` และมีพิกัด · ฝั่ง server อ่านจาก registry · ฝั่ง client อ่านจาก shelter doc ของศูนย์ที่เปิดอยู่
- **ศูนย์มีจุด** = จุดปัจจุบันของศูนย์ ≥ 1
- ใบเดียวมีทั้งรายการแคมเปญและรายการบริจาคเองได้ · กติกาทั้งหมดใช้ต่อรายการ ไม่ใช่ต่อใบ
- ทุกที่ที่เขียน `drop_off_point_id` ให้เขียนค่า `null` ตรงๆ เมื่อไม่มีจุด (ไม่ละ key) · ตอนอ่าน ไม่มี key = `null`

**แคมเปญ (back-office)**

- **FR-AP-1** — `donation_campaign.needs[]` มี field ใหม่ `drop_off_point_id: str | null` · campaign `schema_v` 4
- **FR-AP-2** — ฟอร์มสร้างแคมเปญ (`create-campaign-form.svelte`) มี dropdown "จุดรับบริจาค" ของ need · ตัวเลือก = จุดปัจจุบันของศูนย์ · ศูนย์ไม่มีจุด → ไม่แสดง dropdown และเขียน `null`
- **FR-AP-2a** — ศูนย์มีจุดเดียว → เลือกจุดนั้นให้อัตโนมัติ (เปลี่ยนไม่ได้เพราะไม่มีตัวเลือกอื่น) · แทนเจตนาของ CR-206 FR-MP-10
- **FR-AP-3** — ศูนย์มีจุด → ปุ่มบันทึกกดไม่ได้จนกว่าจะเลือกจุด (D-2)
- **FR-AP-4** — ฟอร์มแก้แคมเปญ (`edit-campaign-form.svelte`) แก้จุดของ need ได้ · `editNeed` เขียน `drop_off_point_id` ได้เพิ่มจาก `qty_target` / `unit`
- **FR-AP-4a** — ตอนแก้ ศูนย์มีจุด และ need เป็น `null` หรือจุดไม่อยู่ในจุดปัจจุบัน → dropdown ว่าง และปุ่มบันทึกกดไม่ได้จนกว่าจะเลือกจุด (D-2)
- **FR-AP-4b** — บันทึกการแก้แคมเปญเขียน `schema_v: 4` ให้ doc เสมอ (แคมเปญ v3 ที่ถูกแก้กลายเป็น v4)
- **FR-AP-5** — แก้จุดของ need มีผลกับรายการที่จองหลังแก้เท่านั้น · รายการที่จองไปแล้วคง `drop_off_point_id` เดิม รวมถึงตอนผู้บริจาคแก้ใบนั้น (FR-AP-15) (D-4)
- **FR-AP-6** — บอร์ดแคมเปญฝั่งเจ้าหน้าที่ (`needs-board-admin.svelte`) แสดงชื่อจุดของแต่ละ need · ศูนย์มีจุด และ need เป็น `null` → ป้าย "ยังไม่ระบุจุด" · `drop_off_point_id` ไม่อยู่ในจุดปัจจุบัน → ป้าย "จุดถูกลบ"

**จอง (public)**

- **FR-AP-7** — BFF `POST /api/public/v1/donations` ไม่อ่าน `items[].drop_off_point_id` จาก request · ลบ field ออกจาก zod input (`donation.ts`) และ `buildDonationItemsPayload` (`public-donation.ts`) · client ส่งมาไม่มีผล
- **FR-AP-8** — BFF คำนวณจุดของแต่ละรายการหลังเลือกแคมเปญ (`pickCampaignForItems`) แล้วส่งต่อ FastAPI:
  - `logistics.delivery_method` ไม่ใช่ `self_dropoff` → `null` ทุกรายการ (CR-206 FR-MP-4 เดิม)
  - รายการแคมเปญ → `drop_off_point_id` ของ need ใน**แคมเปญที่เลือกให้ใบ** (ไม่ใช่แคมเปญอื่นที่ขอของชิ้นเดียวกัน)
  - รายการบริจาคเอง → `null`
  - BFF **ไม่อ่าน registry และไม่ตรวจ** ว่าจุดของ need ยังอยู่ในจุดปัจจุบันหรือไม่ (คง CR-017 §Decision A) · id ที่ไม่อยู่แล้วแสดงและรับตาม CR-206 FR-MP-16 / FR-MP-19 (D-5, D-10)
- **FR-AP-8a** — `DonationCreateResponse` (FastAPI) เพิ่ม `items: [{ drop_off_point_id: str | null, review_status: enum }]` เรียงตามลำดับรายการใน request · BFF ส่ง `items` ต่อใน response ของ `POST /api/public/v1/donations`
- **FR-AP-8b** — ตั๋วหลังจอง (`public-donor-success-ticket.svelte`) จัดกลุ่มจุดจาก `items` ของ response (FR-AP-8a) ไม่ใช่จาก store ของฟอร์ม
- **FR-AP-9** — กติกา FR-AP-8 อยู่ใน pure function เดียวใน `features/donations/domain/line-points.ts` · BFF จองและ BFF แก้รายการใช้ร่วมกัน
- **FR-AP-10** — FastAPI `create` เรียก `_drop_off_points` แบบเดียวกับ `update_items` (`strict=False`, `offered=None`): ไม่เทียบกับ `public_shelters.donation_points` · ไม่ตอบ `400 UNKNOWN_DROP_OFF_POINT` · ยังบังคับ `null` เมื่อวิธีส่งเป็น `parcel` / `shelter_pickup` · `DonationItemInput.drop_off_point_id` ยังรับค่าจาก BFF (D-9)
- **FR-AP-11** — ฟอร์มจองขั้น 3 ไม่มี section "จุดส่งของแต่ละรายการ" · หมุดจุดรับบริจาคบนแผนที่ขั้น 1 และขั้น 3 (CR-205 FR-DP-18) ยังแสดง แต่แตะแล้วไม่เลือกจุดให้รายการ · แทน CR-206 FR-MP-8 – FR-MP-12 (D-7)
- **FR-AP-12** — ขั้น 3 แสดงข้อความ "จุดส่งของแต่ละรายการจะแจ้งในหน้าติดตาม" เมื่อศูนย์ที่เลือกมีจุด และวิธีส่งเป็น `self_dropoff` · ผู้บริจาคไม่เห็นจุดก่อนจอง (D-7)
- **FR-AP-13** — store ฟอร์มจอง (`donation.svelte.ts`) ไม่เก็บ `dropOffPointId` และ `tappedPointId`

**ผู้บริจาคแก้รายการ**

- **FR-AP-14** — dialog แก้รายการ (`edit-donation-items-dialog.svelte`) ไม่มีตัวเลือกจุด · แทนส่วน "ตัวเลือกจุดต่อรายการ" ของ CR-206 FR-MP-15
- **FR-AP-15** — FastAPI `update_items` คงจุดของรายการเดิม: รายการที่จับคู่กับรายการเดิมด้วย `line_key` (CR-196 FR-LK-5, `_pair_held_lines`) ได้ `drop_off_point_id` ของรายการเดิม ไม่ว่า request ส่งอะไรมา
- **FR-AP-15a** — รายการใหม่ (ไม่มี `line_key`): BFF `PATCH …/{tracking_token}/items` เขียน `drop_off_point_id` ตาม FR-AP-8 ด้วย `campaign_id` และ `delivery_method` ของใบใน CouchDB · อ่านแคมเปญด้วย id ไม่ว่าสถานะ `open` หรือ `closed` · ใบยังไม่ถึง CouchDB (ช่วง 1 รอบ inbound) → `null`
- **FR-AP-15b** — BFF เขียน `drop_off_point_id` ทับทุกรายการใน payload ก่อนส่ง FastAPI (รายการเดิมด้วย ค่าใดก็ได้ เพราะ FastAPI ใช้ค่าเดิมตาม FR-AP-15) · ลบ `withOfferedPoints` และการอ่าน registry ใน route นี้
- **FR-AP-16** — กติกาว่าใบไหนแก้รายการได้คงเดิม (CR-196 FR-LK-4, CR-206 FR-MP-17) · ใบที่แก้ได้มีแต่รายการ `pending` · รายการใหม่ที่ได้ `approved` อัตโนมัติหลังแก้เกิดได้เฉพาะรายการแคมเปญที่ counter พร้อมแล้ว (ก่อนหน้าเป็น `pending` เพราะ `NOT_SEEDED`)

**ประเมิน (back-office)**

- **FR-AP-17** — body ของ `POST /api/back-office/donations/[query]/approve` · `lines[]` เพิ่ม `drop_off_point_id: str | null` (optional) · route เช็คตามลำดับนี้ หลังเช็คเดิมทั้งหมด (`INVALID_TRANSITION`, `INVALID_REVIEW`, `GOODS_IN_STOCK`, `LINE_ALREADY_RECEIVED`):
  1. ส่ง `drop_off_point_id` (รวมค่า `null`) คู่กับ `decision: rejected` → `422 INVALID_REVIEW`
  2. วิธีส่งไม่ใช่ `self_dropoff` → route เขียน `null` ให้ทุกรายการที่อนุมัติ ไม่สนค่าใน body และไม่เช็คข้อ 3–5
  3. รายการที่อยู่ใน `point_receipts[].line_nos` แล้ว (รับที่หน้าสแกนก่อนประเมิน) → ไม่บังคับจุดและไม่เขียนทับ · ส่ง `drop_off_point_id` มา → `422 INVALID_REVIEW` (D-13)
  4. ค่าที่ไม่ใช่ `null` ต้องอยู่ในจุดปัจจุบันของศูนย์ของใบ · ไม่อยู่ → `422 UNKNOWN_DROP_OFF_POINT`
  5. ศูนย์มีจุด · รายการที่อนุมัติไม่มีจุด → `422 POINT_REQUIRED` · "ไม่มีจุด" = ส่ง `null` หรือไม่ส่ง field และรายการเป็น `null` หรือจุดที่ไม่อยู่ในจุดปัจจุบัน · ไม่ส่ง field และรายการมีจุดปัจจุบันอยู่แล้ว (รายการแคมเปญ) = ใช้จุดเดิม (D-3)
  - error ใช้ key `error_code` เหมือน error อื่นของ route · `422 POINT_REQUIRED` / `UNKNOWN_DROP_OFF_POINT` เป็นชื่อเดียวกับ route รับของ (CR-206 FR-MP-22a) แต่เงื่อนไขต่างกัน
  - อ่านจุดปัจจุบันไม่ได้ → `503 DONATION_UNAVAILABLE` · ไม่เขียนอะไร
- **FR-AP-17a** — body ไม่มี `lines` (D-12):
  - ใบที่ประเมินทีละรายการ (มี `review_status`) · ศูนย์มีจุด · วิธีส่ง `self_dropoff` · มีรายการ `pending` ที่ไม่มีจุดปัจจุบัน → `422 POINT_REQUIRED`
  - ใบที่ประเมินทีละรายการ กรณีอื่น → อนุมัติรายการ `pending` ทั้งหมดเหมือนเดิม · จุดของรายการคงเดิม
  - ใบก่อน schema_v 7 (ไม่มี `review_status`) → อนุมัติทั้งใบเหมือนเดิม · ไม่บังคับและไม่เขียนจุด · รายการเป็น `null` จึงรับที่จุดไหนก็ได้ (CR-206 FR-MP-19)
- **FR-AP-18** — route approve เขียน `items[i].drop_off_point_id` ของรายการที่อนุมัติใน PUT เดียวกับ `review_status` · รายการที่ปฏิเสธ รายการที่ไม่อยู่ใน `lines` และรายการตาม FR-AP-17 ข้อ 3 ไม่แก้จุด
- **FR-AP-19** — audit ของการประเมินเพิ่ม `context.lines[].drop_off_point_id` (ค่าที่เขียนลงรายการ · `null` สำหรับรายการที่ปฏิเสธ)
- **FR-AP-20** — หน้าประเมิน (`pending-review-detail.svelte`) มี dropdown จุดต่อรายการ `pending` ที่กดอนุมัติ · แสดงเมื่อศูนย์มีจุด และวิธีส่งเป็น `self_dropoff`
  - ตัวเลือก = จุดปัจจุบันของศูนย์ · ศูนย์มีจุดเดียว → เลือกให้อัตโนมัติ (D-11)
  - ค่าเริ่มต้น: รายการที่มีจุดปัจจุบันอยู่แล้ว (รายการแคมเปญ) = จุดนั้น · รายการอื่น หรือจุดเดิมไม่อยู่แล้ว = ว่าง
  - ปุ่มยืนยันกดไม่ได้จนทุกรายการที่อนุมัติมีจุด
  - รายการที่บันทึกผลที่หน้าสแกนแล้ว แสดงจุดที่รับแบบ read-only (FR-AP-17 ข้อ 3)
  - รายการ `approved` อยู่แล้ว (อนุมัติอัตโนมัติ) แสดงชื่อจุดแบบ read-only (CR-206 FR-MP-25 ไม่เปลี่ยน)
- **FR-AP-21** — เปลี่ยนจุดของรายการที่ `approved` แล้ว (รวมใบแคมเปญล้วนที่ขึ้น `verifying` ทันที) อยู่นอกขอบเขต · ผู้บริจาคนำของมาผิดจุดใช้ปุ่ม "รับรายการของจุดอื่น" (CR-206 FR-MP-21) (D-6)

**หลังจอง (ฝั่งผู้บริจาค)**

- **FR-AP-22** — ตั๋วและหน้าติดตาม: รายการ `pending` ของใบ `self_dropoff` ในศูนย์ที่มีจุด อยู่ในกลุ่ม "รอเจ้าหน้าที่กำหนดจุดส่ง" ไม่ว่ารายการจะมีจุดใส่ไว้ล่วงหน้าหรือไม่ (เจ้าหน้าที่เปลี่ยนได้ตอนประเมิน) · กลุ่มนี้แสดงข้อความ "ถ้านำของมาก่อนเจ้าหน้าที่ประเมิน ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" และที่อยู่ศูนย์ (สอดคล้องกับ CR-206 FR-MP-19)
- **FR-AP-22a** — `groupDropOffDestinations` (`line-points.ts`) คืนกลุ่ม (ไม่ใช่ `null`) เมื่อมีรายการที่มีจุด **หรือ** มีรายการตาม FR-AP-22 · รายการอื่นที่เป็น `null` อยู่ในกลุ่ม "ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" ตาม CR-206 FR-MP-16
- **FR-AP-23** — หลังประเมิน ตั๋ว หน้าติดตาม และใบปะหน้าอ่าน `drop_off_point_id` ตาม CR-206 FR-MP-13, FR-MP-14, FR-MP-16 เดิม

**ไม่เปลี่ยน**

- **FR-AP-24** — รับของทีละจุด ปิดใบ หมดอายุ redirect (CR-206 FR-MP-17a – FR-MP-30) · route `[query]/reject` (ปฏิเสธทั้งใบไม่แก้จุด) · walk-in (CR-206 FR-MP-7) · shape ของ `donation` · `public_donations` · `public_needs`

## Change (before → after)

**CouchDB `donation_campaign.needs[]`**

| field | ชนิด | ค่าเมื่อไม่มี key | กติกา |
| --- | --- | --- | --- |
| `drop_off_point_id` | str \| null | `null` (= ไม่ระบุจุด) | FR-AP-1 – FR-AP-5 |

- ก่อน: `needs: [{ item_id: 'item:rice', qty_target: '100', unit: 'kg', status: 'open' }]` · `schema_v: 3`
- หลัง: `needs: [{ item_id: 'item:rice', qty_target: '100', unit: 'kg', status: 'open', drop_off_point_id: '01J…GYM' }]` · `schema_v: 4`

**CouchDB `donation.items[].drop_off_point_id`** — shape เดิม · donation schema_v ยัง 11 (D-8)

| จังหวะ | ก่อน (CR-206) | หลัง |
| --- | --- | --- |
| จอง | ผู้บริจาคเลือก · BFF ส่งต่อ · FastAPI ตรวจกับ Mongo | BFF คำนวณจากแคมเปญ (FR-AP-8) · FastAPI ไม่ตรวจกับ Mongo (FR-AP-10) |
| ผู้บริจาคแก้รายการ | ผู้บริจาคเลือก · BFF ล้าง id ที่ไม่อยู่แล้ว | รายการเดิมคงจุด (FR-AP-15) · รายการใหม่คำนวณจากแคมเปญ (FR-AP-15a) |
| ประเมิน | แสดงอย่างเดียว | เจ้าหน้าที่เลือกให้รายการที่อนุมัติ (FR-AP-17, FR-AP-18) |

ตัวอย่างใบผสม (ศูนย์มีจุด "โรงยิม" และ "ห้องพยาบาล" · แคมเปญข้าวตั้งจุดโรงยิม):

- จอง: ข้าว 10 กก. (รายการแคมเปญ) + ผ้าห่ม 5 ผืน (พิมพ์เอง) → `items: [{ …ข้าว, review_status: 'approved', drop_off_point_id: '01J…GYM' }, { …ผ้าห่ม, review_status: 'pending', drop_off_point_id: null }]` · ใบ `pending_review` · ตั๋วแสดงกลุ่ม "โรงยิม" (ข้าว) และ "รอเจ้าหน้าที่กำหนดจุดส่ง" (ผ้าห่ม)
- ประเมิน: `lines: [{ index: 1, decision: 'approved', drop_off_point_id: '01J…MED' }]` → `items[1].drop_off_point_id: '01J…MED'` · ใบ `verifying`
- รับของ: เหมือน CR-206 AC-5 / AC-6

**API**

| endpoint | ก่อน | หลัง |
| --- | --- | --- |
| BFF `POST /api/public/v1/donations` request | รับ `items[].drop_off_point_id` | ไม่รับ (FR-AP-7) |
| BFF `POST /api/public/v1/donations` response | `trackingToken`, `bookingRef`, `status` | เพิ่ม `items[]` (FR-AP-8a) |
| FastAPI `POST /public/v1/donations` | `400 UNKNOWN_DROP_OFF_POINT` · response ไม่มี `items` | ไม่มี error นี้ (FR-AP-10) · response เพิ่ม `items[]` (FR-AP-8a) |
| BFF `PATCH /api/public/v1/donations/{tracking_token}/items` | รับ `items[].drop_off_point_id` · อ่าน registry · `503` เมื่ออ่านไม่ได้ | ไม่รับ · ไม่อ่าน registry (FR-AP-15b) |
| FastAPI `PATCH /public/v1/donations/{tracking_token}/items` | ใช้จุดจาก request | รายการเดิมใช้จุดเดิม (FR-AP-15) |
| `POST /api/back-office/donations/[query]/approve` | `lines[]` = `{index, decision, reason_code?, note?}` | เพิ่ม `drop_off_point_id?` · `422 UNKNOWN_DROP_OFF_POINT`, `422 POINT_REQUIRED`, `503 DONATION_UNAVAILABLE` (FR-AP-17, FR-AP-17a) |

**Mongo** — ไม่เปลี่ยน · `donation_campaign` ไม่ถูก project เป็นแคมเปญ (worker พับเข้า `public_needs` ต่อ `{shelter}:{item_id}`) · ไม่ bump PROJECTION_VERSION

## Acceptance

**แคมเปญ**

- **AC-1** — ศูนย์มี 2 จุด · สร้างแคมเปญข้าวโดยไม่เลือกจุด → บันทึกไม่ได้ · เลือกโรงยิมแล้วบันทึก → `needs[0].drop_off_point_id` = โรงยิม · `schema_v: 4`
- **AC-2** — ศูนย์ไม่มีจุด → ฟอร์มแคมเปญไม่มี dropdown · `needs[0].drop_off_point_id: null`
- **AC-2a** — ศูนย์มีจุดเดียว → ฟอร์มแคมเปญและหน้าประเมินเลือกจุดนั้นให้เอง
- **AC-2b** — แก้แคมเปญ v3 ที่ need เป็น `null` ในศูนย์ที่มีจุด → ต้องเลือกจุดก่อนบันทึก · บันทึกแล้ว doc เป็น `schema_v: 4`
- **AC-2c** — บอร์ดแคมเปญ: need `null` ในศูนย์ที่มีจุด → ป้าย "ยังไม่ระบุจุด" · need ที่จุดถูกเลิกติ๊ก → ป้าย "จุดถูกลบ"

**จอง**

- **AC-3** — ผู้บริจาคจองข้าวจากการ์ดบนบอร์ด → response มี `items[0].drop_off_point_id` = โรงยิม · ใบ `verifying` · ตั๋วแสดงกลุ่มโรงยิม · ฟอร์มจองไม่มีตัวเลือกจุด · ขั้น 3 แสดงข้อความตาม FR-AP-12
- **AC-4** — 2 แคมเปญขอข้าว (A จุดโรงยิม, B จุดห้องพยาบาล) · BFF เลือกแคมเปญ B ให้ใบ → รายการข้าวได้ห้องพยาบาล
- **AC-5** — request จองส่ง `drop_off_point_id` มาเอง → ไม่มีผล · ใบได้จุดตาม FR-AP-8
- **AC-6** — จุดของ need ถูกเลิกติ๊กหลังสร้างแคมเปญ แล้วมีคนจอง → จองสำเร็จ · รายการเก็บ id นั้น · หน้าติดตามแสดงรายการในกลุ่ม "ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" · ทุกจุดรับได้
- **AC-7** — จุดถูกสร้างใน CouchDB แต่ `public_shelters` ยังไม่อัปเดต แล้วแคมเปญใช้จุดนั้น → จองสำเร็จ ไม่ได้ `400`
- **AC-8** — จอง `parcel` ของแคมเปญที่มีจุด → ทุกรายการ `null`

**บริจาคเองและประเมิน**

- **AC-9** — ผู้บริจาคบริจาคเอง 2 รายการ → ใบ `pending_review` · ทุกรายการ `null` · ตั๋วและหน้าติดตามแสดงกลุ่ม "รอเจ้าหน้าที่กำหนดจุดส่ง" พร้อมข้อความตาม FR-AP-22
- **AC-10** — ต่อจาก AC-9 เจ้าหน้าที่อนุมัติรายการ 1 ไปโรงยิม รายการ 2 ไปห้องพยาบาล → `items[]` มีจุดตามที่เลือก · ใบ `verifying` · หน้าติดตามแสดง 2 กลุ่ม · ใบปะหน้า 2 ใบ · audit `context.lines[]` มี `drop_off_point_id` ตรงกัน
- **AC-11** — อนุมัติโดยไม่เลือกจุดในศูนย์ที่มีจุด → `422 POINT_REQUIRED` · หน้าประเมินกดยืนยันไม่ได้
- **AC-12** — อนุมัติพร้อมจุดที่ไม่อยู่ในศูนย์ → `422 UNKNOWN_DROP_OFF_POINT` · ส่งจุดคู่กับ `rejected` → `422 INVALID_REVIEW` · รายการที่ปฏิเสธไม่ถูกแก้จุด
- **AC-12a** — อนุมัติใบ `parcel` พร้อมส่งจุดมา → รายการได้ `null` ไม่ได้ error
- **AC-12b** — body ไม่มี `lines` สำหรับใบที่ประเมินทีละรายการ ในศูนย์ที่มีจุด และมีรายการ `pending` ที่ไม่มีจุด → `422 POINT_REQUIRED` · ใบก่อน schema_v 7 อนุมัติแบบเดิมได้ รายการเป็น `null`
- **AC-12c** — ใบ `pending_review` ที่หน้าสแกนรับผ้าห่มที่โรงยิมไปก่อน แล้วเจ้าหน้าที่ประเมิน → ไม่ต้องเลือกจุดให้ผ้าห่ม · `items[i].drop_off_point_id` ของผ้าห่มไม่ถูกเขียน · ส่งจุดมาให้ผ้าห่ม → `422 INVALID_REVIEW`
- **AC-13** — ใบผสม (ข้าวแคมเปญ + ผ้าห่มพิมพ์เอง) → ข้าวได้โรงยิมตอนจอง · หน้าประเมินแสดงข้าวพร้อมจุดแบบ read-only · ผ้าห่มได้จุดตอนประเมิน
- **AC-13a** — รายการแคมเปญที่ `pending` (counter `NOT_SEEDED`) และจุดยังอยู่ → หน้าประเมินเลือกจุดนั้นไว้ให้ · จุดถูกลบไปแล้ว → dropdown ว่าง

**แก้รายการและข้อมูลเดิม**

- **AC-14** — ผู้บริจาคแก้ใบ `pending_review` ที่มีรายการแคมเปญ `NOT_SEEDED` (มีจุดโรงยิม) และเพิ่มรายการใหม่ → dialog ไม่มีตัวเลือกจุด · รายการเดิมคงโรงยิม · รายการใหม่ได้จุดตาม FR-AP-15a
- **AC-15** — แก้จุดของ need จากโรงยิมเป็นห้องพยาบาล → ใบที่จองก่อนแก้ยังเป็นโรงยิม แม้ผู้บริจาคแก้รายการของใบนั้นภายหลัง · ใบที่จองหลังแก้เป็นห้องพยาบาล
- **AC-16** — แคมเปญ `schema_v` 3 (ไม่มี key) → อ่านเป็น `null` · จองได้ · รายการได้ `null`
- **AC-17** — ใบที่จองก่อน CR นี้ (ผู้บริจาคเลือกจุดเอง) → รับของทีละจุดได้เหมือนเดิม

## Impact

- **backend**
  - `use_case.py` `create`: `_drop_off_points` แบบ `strict=False, offered=None` (FR-AP-10) · ส่ง `items[]` ใน response (FR-AP-8a)
  - `use_case.py` `_pair_held_lines`: carry `drop_off_point_id` ของรายการเดิม (FR-AP-15)
  - `schemas.py` `DonationCreateResponse.items`
  - `tests/test_donation_drop_off_points.py`: ลบเคส `UNKNOWN_DROP_OFF_POINT` ตอนจอง · เพิ่ม AC-7, AC-15 (ฝั่ง FastAPI)
  - regenerate OpenAPI (`fastapi.json`, `openapi.d.ts`)
- **worker / tent-model**: ไม่กระทบ
- **frontend back-office**
  - `operations/domain/operations.ts`: `CampaignNeed`, `campaignInputSchema`, `createCampaign` (schema_v 4), `editNeed` (FR-AP-4, FR-AP-4b)
  - `operations/application/use-donation-needs-board.svelte.ts`: ส่งจุดจากฟอร์มเข้า `createCampaign` / `editNeed`
  - `create-campaign-form.svelte`, `edit-campaign-form.svelte`, `needs-board-admin.svelte`: FR-AP-2 – FR-AP-6
  - `donations/domain/item-review.ts` (`lineReviewDecisionSchema`, `applyLineReview`): FR-AP-17, FR-AP-18
  - route `[query]/approve`: FR-AP-17 – FR-AP-19 · อ่านจุดปัจจุบันด้วย `readCurrentDonationPoints`
  - `pending-review-detail.svelte` + caller `stock-donations/+page.svelte`: FR-AP-20
- **frontend public**
  - `donations/domain/line-points.ts`: function ใหม่ตาม FR-AP-9 · `groupDropOffDestinations` ตาม FR-AP-22a · ลบ `defaultDropOffPointId`, `pickerForMapTap`, `ALL_LINES_PICKER` · เก็บ `bookableDropOffPoints`, `lineDropOffPointId`, `withCurrentLinePoints` ถ้ายังมี caller
  - `donations/domain/donation.ts`, `public-donation.ts` (`buildDonationItemsPayload`, ข้อความ error `UNKNOWN_DROP_OFF_POINT`): FR-AP-7, FR-AP-10
  - `donor-time-selection-form.svelte`, `drop-off-points-section.svelte`, `donation.svelte.ts`, `public-donor-needs.svelte`: FR-AP-11 – FR-AP-13
  - BFF `api/public/v1/donations/+server.ts`: FR-AP-8, FR-AP-8a
  - `public-donor-success-ticket.svelte`: FR-AP-8b, FR-AP-22
  - `edit-donation-items-dialog.svelte` + BFF `…/[tracking_token]/items/+server.ts`: FR-AP-14, FR-AP-15a, FR-AP-15b
  - หน้าติดตาม `routes/(public)/donations/track/[token]/+page.svelte`: FR-AP-22
- **e2e**: เขียน `donation-multi-drop-off.test.ts` ฝั่งผู้บริจาคใหม่ตาม AC-3, AC-9, AC-10, AC-13 · ใช้ `e2e/helpers/donation-points.ts` เดิม
- **docs หลังอนุมัติ**
  - schema.md §2.4 (field ใหม่, schema_v 4, Migration) · §2.3 ย่อหน้า CR-206 (ใครเขียน `drop_off_point_id`)
  - api-contract.md §5 (ตาราง API ข้างบน · ข้อความที่ ~:860) · public-tier-donation-spec.html
  - CR-206: Decision log ชี้มา CR นี้ · ทำเครื่องหมาย FR / AC ที่ระบุใน `affects` ว่า superseded
  - CR-205: Decision log ของ FR-DP-18 / AC-12 (หมุดแตะแล้วไม่เลือกจุด)
  - อัปเดต `updated:` ทุกไฟล์

## Migration

- `needs[].drop_off_point_id` optional → แคมเปญเดิมไม่ backfill · อ่านเป็น `null` (AC-16)
- แคมเปญเดิมที่ยังเปิดในศูนย์ที่มีจุด → ใบใหม่ได้ `null` และรับที่จุดไหนก็ได้ (CR-206 FR-MP-19) จนเจ้าหน้าที่แก้ need (FR-AP-4a) · บอร์ดแสดงป้าย "ยังไม่ระบุจุด" (FR-AP-6) · หลัง deploy ควรให้เจ้าหน้าที่ตั้งจุดให้แคมเปญที่เปิดอยู่
- ใบบริจาคเดิมคงจุดที่ผู้บริจาคเลือก · ไม่ migrate (AC-17)
- ไม่ re-project Mongo

## ข้อตกลง

| # | เรื่อง | ข้อเสนอ | สถานะ | FR |
| --- | --- | --- | --- | --- |
| D-1 | วิธี track | CR ไฟล์ใหม่ (ไฟล์นี้) | ผู้ขอเลือก 2026-10-31 · รอผู้อนุมัติยืนยัน | — |
| D-2 | บังคับเลือกจุดตอนสร้าง / แก้แคมเปญ | บังคับเมื่อศูนย์มีจุด | เสนอ | FR-AP-3, FR-AP-4a |
| D-3 | บังคับเลือกจุดตอนประเมิน | บังคับเมื่อศูนย์มีจุด และ `self_dropoff` · รายการบริจาคเองไม่มีค่าเริ่มต้น | เสนอ | FR-AP-17, FR-AP-20 |
| D-4 | แก้จุดของ need มีผลกับรายการที่จองแล้วไหม | ไม่มีผล รวมตอนผู้บริจาคแก้ใบ · จับคู่รายการเดิมด้วย `line_key` | เสนอ | FR-AP-5, FR-AP-15 |
| D-5 | จุดของ need ถูกลบแล้วมีคนจอง | จองได้ · เก็บ id ไว้ · แสดงและรับแบบ "ไหนก็ได้" ตาม CR-206 FR-MP-16 / FR-MP-19 | เสนอ | FR-AP-8 |
| D-6 | เจ้าหน้าที่เปลี่ยนจุดของรายการที่อนุมัติแล้วได้ไหม | นอกขอบเขต · ใช้ "รับรายการของจุดอื่น" | เสนอ | FR-AP-21 |
| D-7 | ผู้บริจาคเห็นจุดก่อนจองไหม | ไม่เห็น · เห็นในตั๋วและหน้าติดตาม · หมุดจุด CR-205 ยังแสดงแต่แตะไม่เลือก | เสนอ | FR-AP-11, FR-AP-12 |
| D-8 | bump donation schema_v ไหม | ไม่ bump (shape ไม่เปลี่ยน) | เสนอ | — |
| D-9 | FastAPI `create` ตรวจจุดกับ `public_shelters` ต่อไหม | เลิกตรวจ · เชื่อค่าจาก BFF (endpoint เรียกได้ผ่าน BFF เท่านั้น · กติกาเดียวกับ CR-206 FR-MP-2b ของ PATCH) | เสนอ | FR-AP-10 |
| D-10 | BFF จองตรวจจุดของ need กับ registry ไหม | ไม่ตรวจ · คง CR-017 §Decision A (route จองไม่อ่าน registry) · ใช้ D-5 แทน | เสนอ | FR-AP-8 |
| D-11 | ศูนย์มีจุดเดียว | เลือกให้อัตโนมัติในฟอร์มแคมเปญและหน้าประเมิน (แทน CR-206 FR-MP-10 ที่ใส่ให้ในฟอร์มจอง) | เสนอ | FR-AP-2a, FR-AP-20 |
| D-12 | approve แบบไม่ส่ง `lines` | ใบประเมินทีละรายการ ศูนย์มีจุด มีรายการไม่มีจุด → `422` · ใบก่อน schema_v 7 อนุมัติแบบเดิม จุดเป็น `null` | เสนอ | FR-AP-17a |
| D-13 | รายการที่หน้าสแกนรับไปก่อนประเมิน | ไม่บังคับจุดและไม่เขียนทับ · ส่งจุดมา → `422` | เสนอ | FR-AP-17 ข้อ 3 |
| D-14 | เข้า phase ปัจจุบัน หรือ backlog (change-management §5) | > [NEEDS DECISION: ผู้อนุมัติกำหนด] | รอ | — |

ถ้า D-2 หรือ D-3 เลือก "ไม่บังคับ" ให้ตัด validation ใน FR-AP-3, FR-AP-4a, FR-AP-17 ข้อ 5, FR-AP-17a ข้อแรก และ AC-1, AC-2b, AC-11, AC-12b · FR อื่นคงเดิม

## ทางเลือกที่ไม่เลือก

- **ตั้งจุดระดับแคมเปญ (1 แคมเปญ = 1 จุด)** — แคมเปญมีหลาย need ได้ (`needs[]` ≥ 1) และของต่างประเภทอาจไปคนละจุด · ฟอร์มปัจจุบันสร้างแคมเปญละ 1 need (`use-donation-needs-board.svelte.ts`) จึงใช้งานเหมือนกัน แต่ field ต่อ need ไม่ต้องย้ายข้อมูลถ้าฟอร์มรองรับหลาย need ทีหลัง
- **ให้ผู้บริจาคเลือกต่อ แต่เจ้าหน้าที่แก้ได้** — ผู้บริจาคยังต้องเดาจุดเอง · คำขอระบุให้เจ้าหน้าที่เป็นคนกำหนด
- **แสดงจุดของ need บนบอร์ดก่อนจอง** — `public_needs` รวมยอดหลายแคมเปญเป็นแถวเดียวต่อ `{shelter}:{item_id}` และ BFF เลือกแคมเปญตอนจอง · ต้องแก้ projector, model และ PROJECTION_VERSION · แยกเป็นงานอื่นถ้าต้องการ
- **BFF จองอ่าน registry เพื่อล้างจุดที่ถูกลบ** — ขัด CR-017 §Decision A (route จองเคยดึง registry ทั้งก้อนทุกครั้งที่จอง) · ระบบรองรับ id ที่ไม่อยู่แล้วทั้งตอนแสดงและตอนรับ (CR-206 FR-MP-16 / FR-MP-19)
- **ผู้บริจาคแก้รายการแล้วคำนวณจุดใหม่ทุกรายการ** — ขัด D-4 · ผู้บริจาคที่ได้ตั๋วบอกจุดแล้วจะเห็นจุดเปลี่ยนเพราะแก้จำนวน
- **คงการตรวจจุดใน FastAPI `create` กับ `public_shelters`** — projection ตามหลัง CouchDB · จุดที่เจ้าหน้าที่เพิ่งสร้างจะทำให้การจองล้ม (AC-7)
- **ตั๋วอ่านจุดจาก GET tracking หลังจอง** — ใบยังไม่ถึง CouchDB ในรอบ inbound แรก และเพิ่ม request · ใช้ response ของการจองแทน (FR-AP-8a)

## Decision log

- 2026-10-31 — proposed (Kunanon Nusaeng) · ผู้ขอเลือก track เป็น CR ใหม่ (D-1) · D-2 – D-14 รอผู้อนุมัติ
- 2026-10-31 — แก้ตาม `/pr-code-review` รอบ 1 (ก่อนเปิด PR): ตั๋วอ่านจุดจาก response (FR-AP-8a, 8b) · approve แบบไม่มี `lines` (FR-AP-17a) · แก้รายการคงจุดเดิมด้วย `line_key` ใน FastAPI (FR-AP-15) · BFF จองไม่อ่าน registry (D-10) · กติการายการที่รับก่อนประเมิน (D-13) · ลำดับเช็คของ approve · ฟอร์มแก้แคมเปญ (FR-AP-4a, 4b) · กลุ่ม "รอเจ้าหน้าที่กำหนดจุดส่ง" (FR-AP-22, 22a) · เพิ่ม D-9 – D-14 · เติม `affects` และ AC
