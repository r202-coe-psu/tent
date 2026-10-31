---
id: draft # เปลี่ยนเป็น CR-NNN เมื่ออนุมัติ
title: เจ้าหน้าที่กำหนดจุดรับบริจาค — แคมเปญตั้งจุดตอนสร้างประกาศ · บริจาคเองเลือกจุดตอนประเมิน
status: proposed
date: 2026-10-31
updated: 2026-10-31
requested_by: Kunanon Nusaeng
decided_by: (รอ)
layer: volatile
depends_on: "CR-206-donation-multi-drop-off (#1038 · merge แล้ว 2026-10-30) · CR-174-donation-campaign-auto-approve (ประเมินทีละรายการ)"
affects:
  - docs/data/schema.md §2.4 `donation_campaign` — field ใหม่ `needs[].drop_off_point_id` · campaign schema_v 3 → 4
  - docs/data/schema.md §2.3 `donation` — ผู้เขียน `items[].drop_off_point_id` เปลี่ยนจากผู้บริจาคเป็นระบบ (จากแคมเปญ) และเจ้าหน้าที่ (ตอนประเมิน) · donation schema_v ไม่เปลี่ยน (11)
  - docs/data/api-contract.md §5 — BFF `POST /api/public/v1/donations` และ `PATCH …/{tracking_token}/items` ไม่รับ `drop_off_point_id` จาก client · FastAPI `POST /public/v1/donations` เลิกตอบ `400 UNKNOWN_DROP_OFF_POINT` · body ของ `POST /api/back-office/donations/[query]/approve` เพิ่ม `lines[].drop_off_point_id`
  - docs/changes/04-donation/CR-206-donation-multi-drop-off.md — FR-MP-8 – FR-MP-12 superseded · FR-MP-2, FR-MP-2a, FR-MP-3, FR-MP-15, FR-MP-25 แก้ตาม CR นี้ · AC-1 – AC-3 superseded
  - docs/features/public-tier-donation-spec.html — ฟอร์มจองขั้น 3 ไม่มีตัวเลือกจุด
  - frontend/src/lib/features/operations/domain/operations.ts (`CampaignNeed`, `campaignInputSchema`, `createCampaign`, `editNeed`)
  - frontend/src/routes/(protected)/back-office/stock-donations/components/create-campaign-form.svelte · edit-campaign-form.svelte · lib/components/needs-board-admin.svelte
  - frontend/src/lib/features/donations/domain/line-points.ts · donation.ts · public-donation.ts · item-review.ts
  - frontend/src/lib/components/form/donor-time-selection-form.svelte · features/donations/ui/drop-off-points-section.svelte · edit-donation-items-dialog.svelte · routes/(public)/donations/donation.svelte.ts · lib/components/public-donor-needs.svelte
  - frontend/src/routes/api/public/v1/donations/+server.ts · [tracking_token]/items/+server.ts
  - frontend/src/routes/api/back-office/donations/[query]/approve/+server.ts · lib/components/pending-review-detail.svelte · routes/(protected)/back-office/stock-donations/+page.svelte
  - backend/apiapp/modules/donations/use_case.py (`create` → ตรวจจุดแบบ non-strict)
  - tests — backend/tests/test_donation_drop_off_points.py · frontend/e2e/donation-multi-drop-off.test.ts · unit test ของไฟล์ข้างบน
---

# เจ้าหน้าที่กำหนดจุดรับบริจาค — แคมเปญตั้งจุดตอนสร้างประกาศ · บริจาคเองเลือกจุดตอนประเมิน

## สรุป (TL;DR)

- **เปลี่ยน:** ผู้บริจาคไม่เลือกจุดรับบริจาคอีกต่อไป · รายการจากแคมเปญได้จุดที่เจ้าหน้าที่ตั้งไว้ใน need ของแคมเปญตอนสร้างประกาศ · รายการที่บริจาคเอง เจ้าหน้าที่เลือกจุดให้ตอนประเมิน
- **เพื่อ:** เจ้าหน้าที่รู้ว่าแต่ละจุดเก็บของอะไรได้ ผู้บริจาคไม่รู้ · ลดของไปผิดจุด
- **dev ต้อง build:** field `needs[].drop_off_point_id` + dropdown ในฟอร์มแคมเปญ · BFF จอง/แก้รายการใส่จุดจากแคมเปญเอง · dropdown จุดในหน้าประเมิน + body approve · ลบตัวเลือกจุดฝั่งผู้บริจาค
- **กระทบ:** campaign schema_v 3 → 4 · donation schema_v และ PROJECTION_VERSION ไม่เปลี่ยน · แก้ CR-206 ฝั่งผู้บริจาค (FR-MP-8 – FR-MP-12) · ฝั่งรับของทีละจุดของ CR-206 ไม่เปลี่ยน

## Why

- CR-206 ให้ผู้บริจาคเลือกจุดเองทีละรายการ · ผู้บริจาคไม่รู้ว่าจุดไหนเก็บของประเภทไหน · เจ้าหน้าที่เป็นคนรู้
- แคมเปญเป็นของที่เจ้าหน้าที่ประกาศขอเอง จึงรู้ตั้งแต่ตอนสร้างว่าของชิ้นนั้นต้องไปจุดไหน
- ของที่ผู้บริจาคพิมพ์เองต้องผ่านหน้าประเมินอยู่แล้ว (CR-174 FR-2, FR-7) · เจ้าหน้าที่จึงเลือกจุดในขั้นเดียวกันได้โดยไม่เพิ่มขั้นตอน
- ข้อมูลที่ต้องใช้มีอยู่แล้ว: ใบเก็บ `items[].drop_off_point_id` (CR-206 FR-MP-1) และหน้าสแกนรับทีละจุดอ่าน field นี้ (CR-206 FR-MP-19) · CR นี้เปลี่ยนแค่ผู้เขียน field

## Requirements

**คำที่ใช้**

- **รายการแคมเปญ** = รายการของใบที่มี `item_id` อยู่ใน `needs[]` ของแคมเปญที่ผูกกับใบ (`donation.campaign_id` · BFF เลือกด้วย `pickCampaignForItems`)
- **รายการบริจาคเอง** = รายการอื่นทั้งหมด (ผู้บริจาคพิมพ์เอง ไม่มี `item_id` หรือ `item_id` ไม่อยู่ในแคมเปญของใบ หรือใบไม่มี `campaign_id`)
- **จุดปัจจุบันของศูนย์** = จุดรับบริจาคที่อ่านจาก shelter doc ใน CouchDB ตามกติกา CR-206 FR-MP-2a (`readCurrentDonationPoints`)
- ใบเดียวมีทั้งสองแบบได้ · กติกาทั้งหมดใช้ต่อรายการ ไม่ใช่ต่อใบ

**แคมเปญ (back-office)**

- **FR-AP-1** — `donation_campaign.needs[]` มี field ใหม่ `drop_off_point_id: str | null` (optional) · ไม่มี key หรือ `null` = ไม่ระบุจุด · campaign `schema_v` 4
- **FR-AP-2** — ฟอร์มสร้างแคมเปญ (`create-campaign-form.svelte`) มี dropdown "จุดรับบริจาค" ของ need · ตัวเลือก = จุดปัจจุบันของศูนย์ · ศูนย์ไม่มีจุด → ไม่แสดง dropdown และเขียน `null`
- **FR-AP-3** — ศูนย์มีจุด ≥ 1 → ต้องเลือกจุดก่อนบันทึก · ไม่เลือก → ปุ่มบันทึกกดไม่ได้ > [NEEDS DECISION: D-2]
- **FR-AP-4** — ฟอร์มแก้แคมเปญ (`edit-campaign-form.svelte`) แก้จุดของ need ได้ · `editNeed` เขียน `drop_off_point_id` เพิ่มจาก `qty_target` / `unit`
- **FR-AP-5** — แก้จุดของ need มีผลกับใบที่จองหลังแก้เท่านั้น · ใบที่จองไปแล้วคง `drop_off_point_id` เดิม > [NEEDS DECISION: D-4]
- **FR-AP-6** — บอร์ดแคมเปญฝั่งเจ้าหน้าที่ (`needs-board-admin.svelte`) แสดงชื่อจุดของแต่ละ need · need ที่ `drop_off_point_id` ไม่อยู่ในจุดปัจจุบันของศูนย์ (เลิกติ๊กหรือลบ) แสดงป้าย "จุดถูกลบ" · need ที่เป็น `null` ในศูนย์ที่มีจุด แสดงป้าย "ยังไม่ระบุจุด"

**จอง (public)**

- **FR-AP-7** — BFF `POST /api/public/v1/donations` ไม่อ่าน `items[].drop_off_point_id` จาก request · ลบ field ออกจาก zod input (`donation.ts`) · client ส่งมาไม่มีผล
- **FR-AP-8** — BFF คำนวณจุดของแต่ละรายการหลังเลือกแคมเปญ (`pickCampaignForItems`) แล้วส่งต่อ FastAPI:
  - รายการแคมเปญ → `drop_off_point_id` ของ need ใน**แคมเปญที่เลือกให้ใบ** (ไม่ใช่แคมเปญอื่นที่ขอของชิ้นเดียวกัน)
  - รายการบริจาคเอง → `null`
  - จุดของ need ไม่อยู่ในจุดปัจจุบันของศูนย์ → `null` ไม่ตอบ error > [NEEDS DECISION: D-5]
  - `logistics.delivery_method` ไม่ใช่ `self_dropoff` → `null` ทุกรายการ (CR-206 FR-MP-4 เดิม)
- **FR-AP-9** — กติกา FR-AP-8 อยู่ใน pure function เดียว (`features/donations/domain/line-points.ts`) ที่ BFF จองและ BFF แก้รายการใช้ร่วมกัน
- **FR-AP-10** — FastAPI `create` ตรวจ `drop_off_point_id` แบบเดียวกับ `update_items` (CR-206 FR-MP-2b): ไม่เทียบกับ `public_shelters.donation_points` · ไม่ตอบ `400 UNKNOWN_DROP_OFF_POINT` · ยังบังคับ `null` เมื่อวิธีส่งเป็น `parcel` / `shelter_pickup` (FR-MP-4) · แทน CR-206 FR-MP-2 และ FR-MP-3
- **FR-AP-11** — ฟอร์มจองขั้น 3 ไม่มี section "จุดส่งของแต่ละรายการ" และไม่มีการแตะหมุดเลือกจุด · แผนที่ขั้น 3 แสดงศูนย์ · แทน CR-206 FR-MP-8 – FR-MP-12
- **FR-AP-12** — ขั้น 3 แสดงข้อความ "จุดส่งของจะแจ้งในตั๋วหลังจอง" เมื่อศูนย์ที่เลือกมีจุด ≥ 1 และวิธีส่งเป็น `self_dropoff` · ผู้บริจาคไม่เห็นจุดก่อนจอง > [NEEDS DECISION: D-7]
- **FR-AP-13** — store ฟอร์มจอง (`donation.svelte.ts`) ไม่เก็บจุดต่อรายการ (`dropOffPointId`) และจุดที่แตะบนแผนที่บอร์ด (`tappedPointId`)

**ผู้บริจาคแก้รายการ**

- **FR-AP-14** — dialog แก้รายการ (`edit-donation-items-dialog.svelte`) ไม่มีตัวเลือกจุด · แทนส่วน "ตัวเลือกจุดต่อรายการ" ของ CR-206 FR-MP-15
- **FR-AP-15** — BFF `PATCH …/{tracking_token}/items` ไม่อ่านจุดจาก request · คำนวณจุดตาม FR-AP-8 ด้วย `campaign_id` เดิมของใบ (route นี้ไม่เลือกแคมเปญใหม่) · แทนการตรวจจุดที่ client ส่งของ CR-206 FR-MP-2a
- **FR-AP-16** — กติกาว่าใบไหนแก้รายการได้คงเดิม (CR-196 FR-LK-4, CR-206 FR-MP-17)

**ประเมิน (back-office)**

- **FR-AP-17** — body ของ `POST /api/back-office/donations/[query]/approve` · `lines[]` เพิ่ม `drop_off_point_id: str | null` (optional)
  - ใช้กับ `decision: approved` เท่านั้น · ส่งมากับ `rejected` → `422`
  - ค่าที่ไม่ใช่ `null` ต้องอยู่ในจุดปัจจุบันของศูนย์ของใบ · ไม่อยู่ → `422 UNKNOWN_DROP_OFF_POINT`
  - ศูนย์มีจุด ≥ 1 · วิธีส่ง `self_dropoff` · อนุมัติโดยไม่ส่งจุด → `422 POINT_REQUIRED` > [NEEDS DECISION: D-3]
  - วิธีส่งไม่ใช่ `self_dropoff` → route เขียน `null` ไม่ว่า body ส่งอะไรมา
- **FR-AP-18** — route approve เขียน `items[i].drop_off_point_id` ของรายการที่อนุมัติใน PUT เดียวกับ `review_status` · รายการที่ปฏิเสธไม่แก้จุด · รายการที่ไม่อยู่ใน `lines` ไม่แก้จุด
- **FR-AP-19** — `context` ของ audit การประเมินเพิ่มจุดที่เลือกต่อรายการ
- **FR-AP-20** — หน้าประเมิน (`pending-review-detail.svelte`) มี dropdown จุดต่อรายการ `pending` ที่กดอนุมัติ · ตัวเลือก = จุดปัจจุบันของศูนย์
  - ค่าเริ่มต้น: รายการแคมเปญที่ตก `pending` (จองโควต้าไม่ได้) = จุดที่ BFF ใส่ไว้ตอนจอง · รายการบริจาคเอง = ว่าง
  - ปุ่มยืนยันกดไม่ได้จนทุกรายการที่อนุมัติมีจุด (เมื่อ FR-AP-17 บังคับ)
  - รายการ `approved` อยู่แล้ว (อนุมัติอัตโนมัติ) แสดงชื่อจุดแบบ read-only (CR-206 FR-MP-25 เดิม)
- **FR-AP-21** — เปลี่ยนจุดของรายการที่ `approved` แล้ว (รวมใบแคมเปญล้วนที่ขึ้น `verifying` ทันที) อยู่นอกขอบเขต · ผู้บริจาคนำของมาผิดจุดใช้ปุ่ม "รับรายการของจุดอื่น" (CR-206 FR-MP-21) > [NEEDS DECISION: D-6]

**หลังจอง (ฝั่งผู้บริจาค)**

- **FR-AP-22** — หน้าติดตามแสดงรายการ `pending` ในศูนย์ที่มีจุดเป็นกลุ่ม "รอเจ้าหน้าที่กำหนดจุดส่ง" แยกจากกลุ่ม "ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" ของ CR-206 FR-MP-16
- **FR-AP-23** — ตั๋ว หน้าติดตาม ใบปะหน้า หลังประเมินอ่าน `drop_off_point_id` ตาม CR-206 FR-MP-13, FR-MP-14, FR-MP-16 เดิม ไม่แก้

**ไม่เปลี่ยน**

- **FR-AP-24** — รับของทีละจุด ปิดใบ หมดอายุ redirect (CR-206 FR-MP-17a – FR-MP-30) · walk-in (FR-MP-7) · shape ของ `donation` · `public_donations` · `public_needs`

## Change (before → after)

**CouchDB `donation_campaign.needs[]`**

| field | ชนิด | ค่าเมื่อไม่มี key | กติกา |
| --- | --- | --- | --- |
| `drop_off_point_id` | str \| null | `null` (= ไม่ระบุจุด) | FR-AP-1 – FR-AP-5 |

- ก่อน: `needs: [{ item_id: 'item:rice', qty_target: '100', unit: 'kg', status: 'open' }]` · `schema_v: 3`
- หลัง: `needs: [{ item_id: 'item:rice', qty_target: '100', unit: 'kg', status: 'open', drop_off_point_id: '01J…GYM' }]` · `schema_v: 4`

**CouchDB `donation.items[].drop_off_point_id`** — shape เดิม · donation schema_v ยัง 11 > [NEEDS DECISION: D-8]

| ใครเขียน | ก่อน (CR-206) | หลัง |
| --- | --- | --- |
| ตอนจอง | ผู้บริจาคเลือก · BFF ส่งต่อ · FastAPI ตรวจกับ Mongo | BFF คำนวณจากแคมเปญ (FR-AP-8) · FastAPI ไม่ตรวจกับ Mongo |
| ตอนผู้บริจาคแก้รายการ | ผู้บริจาคเลือก · BFF ล้าง id ที่หายไป | BFF คำนวณจากแคมเปญเดิมของใบ (FR-AP-15) |
| ตอนประเมิน | ไม่มี (แสดงอย่างเดียว) | เจ้าหน้าที่เลือกให้รายการที่อนุมัติ (FR-AP-17, FR-AP-18) |

ตัวอย่างใบผสม (ศูนย์มีจุด "โรงยิม" และ "ห้องพยาบาล" · แคมเปญข้าวตั้งจุดโรงยิม):

- จอง: ข้าว 10 กก. (รายการแคมเปญ, จองโควต้าได้) + ผ้าห่ม 5 ผืน (พิมพ์เอง) → `items: [{ …ข้าว, review_status: 'approved', drop_off_point_id: '01J…GYM' }, { …ผ้าห่ม, review_status: 'pending', drop_off_point_id: null }]` · ใบ `pending_review`
- ประเมิน: เจ้าหน้าที่อนุมัติผ้าห่มพร้อมเลือกห้องพยาบาล → `items[1].drop_off_point_id: '01J…MED'` · ใบ `verifying`
- รับของ: เหมือน CR-206 AC-5 / AC-6

**API**

| endpoint | ก่อน | หลัง |
| --- | --- | --- |
| BFF `POST /api/public/v1/donations` | รับ `items[].drop_off_point_id` | ไม่รับ (FR-AP-7) |
| BFF `PATCH /api/public/v1/donations/{tracking_token}/items` | รับ `items[].drop_off_point_id` | ไม่รับ (FR-AP-15) |
| FastAPI `POST /public/v1/donations` | `400 UNKNOWN_DROP_OFF_POINT` | ไม่มี error นี้ · รับค่าจาก BFF (FR-AP-10) |
| `POST /api/back-office/donations/[query]/approve` | `lines[]` = `{index, decision, reason_code?, note?}` | เพิ่ม `drop_off_point_id?` · error `422 UNKNOWN_DROP_OFF_POINT`, `422 POINT_REQUIRED` (FR-AP-17) |

**Mongo** — ไม่เปลี่ยน · `donation_campaign` ไม่ถูก project เป็นแคมเปญ (worker พับเข้า `public_needs` ต่อ `{shelter}:{item_id}`) · ไม่ bump PROJECTION_VERSION

## Acceptance

- **AC-1** — ศูนย์มีจุด 2 จุด · สร้างแคมเปญข้าวโดยไม่เลือกจุด → บันทึกไม่ได้ · เลือกโรงยิมแล้วบันทึก → doc มี `needs[0].drop_off_point_id` = โรงยิม · `schema_v: 4`
- **AC-2** — ศูนย์ไม่มีจุด → ฟอร์มแคมเปญไม่มี dropdown · `needs[0].drop_off_point_id` = `null`
- **AC-3** — ผู้บริจาคจองข้าวจากการ์ดบนบอร์ด → ใบมี `drop_off_point_id` = โรงยิม · ใบ `verifying` · ตั๋วแสดงกลุ่มโรงยิม · ฟอร์มจองไม่มีตัวเลือกจุด
- **AC-4** — 2 แคมเปญขอข้าว (แคมเปญ A จุดโรงยิม, แคมเปญ B จุดห้องพยาบาล) · BFF เลือกแคมเปญ B ให้ใบ → รายการข้าวได้ห้องพยาบาล
- **AC-5** — request จองส่ง `drop_off_point_id` มาเอง → ไม่มีผล · ใบได้จุดตาม FR-AP-8
- **AC-6** — จุดของ need ถูกเลิกติ๊กหลังสร้างแคมเปญ แล้วมีคนจอง → จองสำเร็จ · รายการได้ `null` · บอร์ดแคมเปญแสดงป้าย "จุดถูกลบ"
- **AC-7** — จุดถูกสร้างใน CouchDB แต่ `public_shelters` ยังไม่อัปเดต แล้วแคมเปญใช้จุดนั้น → จองสำเร็จ ไม่ได้ `400`
- **AC-8** — จอง `parcel` ของแคมเปญที่มีจุด → ทุกรายการ `null`
- **AC-9** — ผู้บริจาคบริจาคเอง 2 รายการ → ใบ `pending_review` · ทุกรายการ `null` · หน้าติดตามแสดงกลุ่ม "รอเจ้าหน้าที่กำหนดจุดส่ง"
- **AC-10** — ต่อจาก AC-9 เจ้าหน้าที่อนุมัติรายการ 1 ไปโรงยิม รายการ 2 ไปห้องพยาบาล → `items[]` มีจุดตามที่เลือก · ใบ `verifying` · หน้าติดตามแสดง 2 กลุ่ม · ใบปะหน้า 2 ใบ · audit มีจุดต่อรายการ
- **AC-11** — อนุมัติโดยไม่เลือกจุดในศูนย์ที่มีจุด → `422 POINT_REQUIRED` · หน้าประเมินกดยืนยันไม่ได้
- **AC-12** — อนุมัติพร้อมจุดที่ไม่อยู่ในศูนย์ → `422 UNKNOWN_DROP_OFF_POINT` · ส่งจุดคู่กับ `rejected` → `422`
- **AC-13** — ใบผสม (ข้าวแคมเปญ + ผ้าห่มพิมพ์เอง) → ข้าวได้โรงยิมตอนจอง · หน้าประเมินแสดงข้าวพร้อมจุดแบบ read-only · ผ้าห่มได้จุดตอนประเมิน
- **AC-14** — ผู้บริจาคแก้รายการของใบ `pending_review` → dialog ไม่มีตัวเลือกจุด · รายการที่ได้ `approved` อัตโนมัติหลังแก้ ได้จุดจากแคมเปญเดิมของใบ
- **AC-15** — แก้จุดของ need จากโรงยิมเป็นห้องพยาบาล → ใบที่จองก่อนแก้ยังเป็นโรงยิม · ใบที่จองหลังแก้เป็นห้องพยาบาล
- **AC-16** — แคมเปญ `schema_v` 3 (ไม่มี key) → อ่านเป็น `null` · จองได้ · รายการได้ `null`
- **AC-17** — ใบที่จองก่อน CR นี้ (ผู้บริจาคเลือกจุดเอง) → รับของทีละจุดได้เหมือนเดิม

## Impact

- **backend**: `use_case.py` `create` เรียก `_drop_off_points` แบบ `strict=False, offered=None` (FR-AP-10) · ลบ test `UNKNOWN_DROP_OFF_POINT` ตอนจองใน `tests/test_donation_drop_off_points.py` แล้วเพิ่ม AC-7 · regenerate OpenAPI ถ้า error response เปลี่ยน
- **worker / tent-model**: ไม่กระทบ
- **frontend back-office**
  - `operations/domain/operations.ts`: `CampaignNeed`, `campaignInputSchema`, `createCampaign` (schema_v 4), `editNeed`
  - `operations/application/use-donation-needs-board.svelte.ts`: ส่งจุดจากฟอร์มเข้า `createCampaign` / `editNeed`
  - `create-campaign-form.svelte`, `edit-campaign-form.svelte`, `needs-board-admin.svelte`: FR-AP-2 – FR-AP-6
  - `donations/domain/item-review.ts` (`lineReviewDecisionSchema`, `applyLineReview`): FR-AP-17, FR-AP-18
  - route `[query]/approve`: FR-AP-17 – FR-AP-19 · อ่านจุดด้วย `readCurrentDonationPoints`
  - `pending-review-detail.svelte` + caller `stock-donations/+page.svelte`: FR-AP-20
- **frontend public**
  - `donations/domain/line-points.ts`: function ใหม่ตาม FR-AP-9 · ลบ `defaultDropOffPointId`, `pickerForMapTap` · เก็บ `bookableDropOffPoints`, `lineDropOffPointId`, `withCurrentLinePoints`, `groupDropOffDestinations` ถ้ายังมี caller
  - `donations/domain/donation.ts`, `public-donation.ts` (`buildDonationItemsPayload`): FR-AP-7
  - `donor-time-selection-form.svelte`, `drop-off-points-section.svelte`, `donation.svelte.ts`, `public-donor-needs.svelte`: FR-AP-11 – FR-AP-13
  - BFF `api/public/v1/donations/+server.ts`: FR-AP-8
  - `edit-donation-items-dialog.svelte` + BFF `…/[tracking_token]/items/+server.ts`: FR-AP-14, FR-AP-15
  - หน้าติดตาม `donations/track/[token]` + `groupDropOffDestinations`: FR-AP-22
- **e2e**: เขียน `donation-multi-drop-off.test.ts` ฝั่งผู้บริจาคใหม่ตาม AC-3, AC-9, AC-10, AC-13 · ใช้ `e2e/helpers/donation-points.ts` เดิม
- **docs หลังอนุมัติ**
  - schema.md §2.4 (field ใหม่, schema_v 4, Migration) · §2.3 ย่อหน้า CR-206 (ใครเขียน `drop_off_point_id`)
  - api-contract.md §5 · public-tier-donation-spec.html
  - CR-206: Decision log ชี้มา CR นี้ · ทำเครื่องหมาย FR-MP-8 – FR-MP-12 และ AC-1 – AC-3 ว่า superseded
  - อัปเดต `updated:` ทุกไฟล์

## Migration

- `needs[].drop_off_point_id` optional → แคมเปญเดิมไม่ backfill · อ่านเป็น `null` (AC-16)
- แคมเปญเดิมที่ยังเปิดในศูนย์ที่มีจุด → ใบใหม่ได้ `null` และรับที่จุดไหนก็ได้ (CR-206 FR-MP-19) จนเจ้าหน้าที่แก้จุดของ need · บอร์ดแสดงป้าย "ยังไม่ระบุจุด" (FR-AP-6)
- ใบบริจาคเดิมคงจุดที่ผู้บริจาคเลือก · ไม่ migrate (AC-17)
- ไม่ re-project Mongo

## ข้อตกลง (รอตัดสิน)

| # | เรื่อง | ข้อเสนอ | FR |
| --- | --- | --- | --- |
| D-1 | วิธี track | CR ไฟล์ใหม่ (ไฟล์นี้) | — |
| D-2 | บังคับเลือกจุดตอนสร้างแคมเปญไหม | บังคับเมื่อศูนย์มีจุด ≥ 1 | FR-AP-3 |
| D-3 | บังคับเลือกจุดตอนประเมินไหม | บังคับเมื่อศูนย์มีจุด ≥ 1 และ `self_dropoff` · ไม่มีค่าเริ่มต้นสำหรับรายการบริจาคเอง | FR-AP-17, FR-AP-20 |
| D-4 | แก้จุดของ need มีผลกับใบที่จองแล้วไหม | ไม่มีผล · ใบเก็บจุดตอนจอง | FR-AP-5 |
| D-5 | จุดของ need ถูกลบแล้วมีคนจอง | จองได้ · รายการได้ `null` | FR-AP-8 |
| D-6 | เจ้าหน้าที่เปลี่ยนจุดของรายการที่อนุมัติแล้วได้ไหม | นอกขอบเขต · ใช้ "รับรายการของจุดอื่น" | FR-AP-21 |
| D-7 | ผู้บริจาคเห็นจุดก่อนจองไหม | ไม่เห็น · เห็นในตั๋ว | FR-AP-12 |
| D-8 | bump donation schema_v ไหม | ไม่ bump (shape ไม่เปลี่ยน) | — |

ถ้า D-2 หรือ D-3 เลือก "ไม่บังคับ" ให้ตัด validation ใน FR-AP-3 / FR-AP-17 และ AC-1 / AC-11 · FR อื่นคงเดิม

## ทางเลือกที่ไม่เลือก

- **ตั้งจุดระดับแคมเปญ (1 แคมเปญ = 1 จุด)** — แคมเปญมีหลาย need ได้ (`needs[]` ≥ 1) และของต่างประเภทอาจไปคนละจุด · ฟอร์มปัจจุบันสร้างแคมเปญละ 1 need จึงใช้งานเหมือนกัน แต่ field ต่อ need ไม่ต้องย้ายข้อมูลถ้าฟอร์มรองรับหลาย need ทีหลัง
- **ให้ผู้บริจาคเลือกต่อ แต่เจ้าหน้าที่แก้ได้** — ผู้บริจาคยังต้องเดาจุดเอง · คำขอระบุให้เจ้าหน้าที่เป็นคนกำหนด
- **แสดงจุดของ need บนบอร์ดก่อนจอง** — `public_needs` รวมยอดหลายแคมเปญเป็นแถวเดียวต่อ `{shelter}:{item_id}` และ BFF เลือกแคมเปญตอนจอง · ต้องแก้ projector, model และ PROJECTION_VERSION · แยกเป็นงานอื่นถ้าต้องการ
- **คงการตรวจจุดใน FastAPI `create` กับ `public_shelters`** — projection ตามหลัง CouchDB · จุดที่เจ้าหน้าที่เพิ่งสร้างจะทำให้การจองล้ม (AC-7) · BFF ตรวจกับ CouchDB แล้ว และ FastAPI เรียกได้ผ่าน BFF เท่านั้น (กติกาเดียวกับ CR-206 FR-MP-2b)

## Decision log

- 2026-10-31 — proposed (Kunanon Nusaeng) · ผู้ขอเลือก track เป็น CR ใหม่ (D-1) · D-2 – D-8 รอตัดสิน
