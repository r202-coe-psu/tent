---
id: draft
title: บริจาคครั้งเดียวแยกส่งหลายจุดรับบริจาค — ระบุจุดต่อรายการ และรับของทีละจุด
status: proposed
date: 2026-10-27
created: 2026-10-27
updated: 2026-10-27
requested_by: "Kunanon Nusaeng — feedback จาก demo 2026-10-23 (epic #825, issue #813)"
decided_by: ""
layer: volatile
depends_on: "draft-storage-drop-off-points (#812, PR #944) — ต้อง approve และ implement ก่อน"
affects:
  - docs/data/schema.md §2.3 `donation.items[]` — field ใหม่ `drop_off_point_id`, `received_at` · กติการับของทีละจุด / ปิดใบ / หมดอายุ / ยกเลิก · donation schema_v 7 → เลขถัดไปตอน merge (ดู §ลำดับ schema_v)
  - docs/data/couchdb-mongodb-sync.md §3.2 `public_donations.items_declared[]` (`drop_off_point_id`, `received_at`) · bump PROJECTION_VERSION
  - docs/data/api-contract.md §5 — `POST /public/v1/donations`, `GET /public/v1/donations/{tracking_token}`, `PATCH /public/v1/donations/{tracking_token}/items`, `DELETE /public/v1/donations/{tracking_token}` (error ใหม่ `400 UNKNOWN_DROP_OFF_POINT`, `409 PARTIALLY_RECEIVED`)
  - docs/changes/04-donation/CR-087-donation-redirect-target.md (redirect ล้างจุด · ห้าม redirect ใบที่รับไปบางจุดแล้ว)
  - docs/changes/04-donation/CR-196-donation-line-key.md FR-LK-10 (ยกเลิกไม่ได้เมื่อรับไปบางจุดแล้ว)
  - docs/features/public-tier-donation-spec.html (ฟอร์มจองเลือกจุดต่อรายการ)
  - backend/apiapp/modules/donations (schemas.py `DonationItemInput`, use_case.py `create` / `update_items` / cancel) · backend/tests/test_donations.py
  - packages/tent-model/src/tent_model/public_donation.py (`DeclaredItem`)
  - worker/src/worker/inbound/donations.py (`DONATION_SCHEMA_V`) · worker/src/worker/projectors/donation.py · worker/src/worker/projection_version.py · worker/src/worker/quota/expiry.py
  - frontend/src/lib/features/donations (domain/donation.ts, domain/donation-redirect.ts, ui/edit-donation-items-dialog.svelte) · frontend/src/lib/features/operations/domain/operations.ts (`DONATION_SCHEMA_V`)
  - frontend/src/lib/components/form/donor-time-selection-form.svelte · routes/api/public/v1/donations/+server.ts · routes/api/public/v1/donations/[tracking_token]/+server.ts · routes/api/public/v1/donations/[tracking_token]/items/+server.ts
  - back-office: routes/(protected)/back-office/stock-donations/components/scan-station.svelte · routes/api/back-office/donations/[query]/+server.ts · routes/api/back-office/donations/[query]/redirect/+server.ts · lib/components/pending-review-detail.svelte
why: >
  ศูนย์ที่มีจุดรับบริจาคหลายจุดต้องการให้ของแต่ละประเภทไปส่งที่จุดที่เก็บของประเภทนั้น
  (เช่น น้ำดื่มไปโรงยิม ยาไปห้องพยาบาล) แต่ใบบริจาคตอนนี้มีปลายทางเดียวคือศูนย์ และการรับของ
  บันทึกทั้งใบในครั้งเดียว — ให้ระบุจุดต่อรายการในใบเดียว และให้เจ้าหน้าที่แต่ละจุดรับเฉพาะรายการ
  ของจุดตัวเอง ของจึงเข้าคลังของจุดนั้นได้เลย
migration: >
  optional field ไม่ backfill — ใบเดิมไม่มี `drop_off_point_id` = ไม่ระบุจุด (รับได้ทุกจุด ทั้งใบ
  เหมือนเดิม) · bump donation schema_v และ PROJECTION_VERSION
---

# บริจาคครั้งเดียวแยกส่งหลายจุดรับบริจาค — ระบุจุดต่อรายการ และรับของทีละจุด

## สรุป (TL;DR)

- ใบบริจาคยังเป็น **ใบเดียว** (token, QR, `booking_ref`, slot ชุดเดียว) · แต่ละรายการมี `items[].drop_off_point_id` บอกว่าต้องส่งที่จุดไหน · เลือกจุดได้เฉพาะวิธี "นำมาส่งเอง" ที่ศูนย์มีจุดรับบริจาค ≥ 2 จุด
- **รับของทีละจุด:** เจ้าหน้าที่เลือก "จุดที่ประจำ" บนหน้าสแกน แล้วรับเฉพาะรายการของจุดนั้น · ใบเป็น `received` เมื่อทุกจุดบันทึกครบ
- **ใบที่ของมาไม่ครบทุกจุด:** เจ้าหน้าที่กด "ปิดใบ" ได้ (ส่วนที่ไม่มา = รับไม่ครบ และคืนยอดจอง) · ถ้าเลยเวลาหมดอายุ worker ปิดให้แบบเดียวกัน
- ใบที่รับไปบางจุดแล้ว ผู้บริจาคยกเลิกไม่ได้ และเจ้าหน้าที่ redirect ไม่ได้
- field ใหม่ `drop_off_point_id`, `received_at` · donation schema_v 7 → เลขถัดไปตอน merge · bump PROJECTION_VERSION · ขึ้นกับ `draft-storage-drop-off-points` (#944)

## Why

- ศูนย์ที่ตั้งจุดรับบริจาคไว้หลายจุด (`draft-storage-drop-off-points`) อยากให้ของแต่ละประเภทไปจุดที่เก็บของประเภทนั้น
- ใบบริจาคตอนนี้มีปลายทางเดียว (`shelter_code`) · ผู้บริจาคที่นำของหลายประเภทมาส่งไม่รู้ว่าต้องแยกไปจุดไหน
- การรับของตอนนี้บันทึกทุกรายการในใบครั้งเดียวแล้วเปลี่ยนใบเป็น `received` ทันที (schema.md §2.3 "รับเข้าจากใบหลายรายการ") · ถ้าใช้กับใบหลายจุด จุดแรกที่สแกนจะปิดใบ และรายการของจุดอื่นกลายเป็น "รับไม่ครบ" ก่อนของจะไปถึง
- จุดรับบริจาค = จุดเก็บของ และล็อตในคลังมี `storage_point_id` อยู่แล้ว (schema.md §2.1) · ถ้ารู้จุดตั้งแต่ตอนจอง ตอนรับของก็เติมที่เก็บให้ได้ทันที

## Requirements

**ข้อมูล**

- **FR-MP-1** — `donation.items[]` มี field ใหม่ `drop_off_point_id: str | null` (optional) · ไม่มี key หรือ `null` = ไม่ระบุจุด
- **FR-MP-2** — ค่าที่ไม่ใช่ `null` ต้องเป็น `id` ที่อยู่ใน `public_shelters.donation_points` ของ `shelter_code` ของใบ ณ ตอนจองหรือตอนแก้รายการ · ไม่อยู่ → `400 UNKNOWN_DROP_OFF_POINT` และโควต้าไม่ขยับ
- **FR-MP-3** — ศูนย์ที่ไม่มีจุดรับบริจาค → ทุกรายการต้องเป็น `null` · ส่ง id มา → `400 UNKNOWN_DROP_OFF_POINT`
- **FR-MP-4** — `logistics.delivery_method` เป็น `shelter_pickup` (ศูนย์ไปรับ) หรือ `parcel` (ส่งพัสดุ) → ระบบเขียน `null` ทุกรายการ ไม่ว่า client จะส่งอะไรมา · ของมาถึงศูนย์ที่เดียว จึงรับทั้งใบที่จุดเดียว
- **FR-MP-5** — `donation.items[]` มี field ใหม่ `received_at: ts | null` (optional) = เวลาที่จุดบันทึกผลของรายการนี้ (รับ หรือ "ไม่รับรายการนี้" ตาม CR-172) · `null` = ยังไม่มีจุดไหนบันทึก
- **FR-MP-6** — ใบยังมี `logistics`, slot, โควต้า, token, QR และ `booking_ref` ชุดเดียว · จุดไม่มีผลกับ slot และโควต้า (slot ผูกกับศูนย์ — `draft-storage-drop-off-points` D-1)
- **FR-MP-7** — ใบ walk-in ที่เจ้าหน้าที่สร้างไม่เขียน `drop_off_point_id`

**ฟอร์มจอง public** (`donor-time-selection-form.svelte`)

- **FR-MP-8** — เพิ่ม section "จุดส่งของแต่ละรายการ" ต่อจาก section เลือกศูนย์ · แสดงเมื่อศูนย์ที่เลือกมีจุดรับบริจาค ≥ 2 จุด และวิธีส่งเป็น `self_dropoff`
- **FR-MP-9** — ค่าเริ่มต้นของทุกรายการ = จุดที่ผู้บริจาคแตะบนแผนที่ (#814) · ถ้าไม่ได้แตะ = จุดแรกในรายการ
- **FR-MP-10** — ศูนย์มีจุดเดียว → ใส่ id ของจุดนั้นให้ทุกรายการอัตโนมัติ และแสดงชื่อจุด (ไม่มีตัวเลือก)
- **FR-MP-11** — ศูนย์ไม่มีจุด หรือวิธีส่งไม่ใช่ `self_dropoff` → ไม่แสดง section และส่ง `null`
- **FR-MP-12** — เปลี่ยนศูนย์ → ล้างจุดของทุกรายการ

**หลังจอง (ฝั่งผู้บริจาค)**

- **FR-MP-13** — ตั๋วและหน้าติดตาม (`/donations/track/[token]`) แสดงปลายทางแยกกลุ่มตามจุด (ชื่อจุด, คำอธิบายตำแหน่ง, ปุ่มนำทาง, รายการในกลุ่ม) และสถานะของแต่ละกลุ่ม: "รอรับ" หรือ "รับแล้ว" (ทุกรายการในกลุ่มมี `received_at`)
- **FR-MP-14** — ใบปะหน้ากล่อง (#591) ออก 1 ใบต่อจุด
- **FR-MP-15** — ผู้บริจาคแก้รายการ (ภายใต้กติกาของ CR-196 — แก้ได้เฉพาะใบที่ยังไม่ประเมิน): รายการเดิมคงจุดเดิม (จับคู่ด้วย `line_key`) · มีตัวเลือกจุดต่อรายการตาม FR-MP-8 · ตรวจตาม FR-MP-2
- **FR-MP-16** — จุดที่ถูกเอาติ๊กออกหรือถูกลบหลังจอง → ใบที่อ้างจุดนั้นแสดงปลายทางเป็นจุดหลักของศูนย์ ไม่ error
- **FR-MP-17** — ใบที่มีรายการ `received_at` ไม่เป็น `null` อย่างน้อย 1 รายการ → ผู้บริจาคยกเลิกไม่ได้ · `DELETE …/{tracking_token}` ตอบ `409 PARTIALLY_RECEIVED` · หน้าติดตาม disable ปุ่มยกเลิก (ยกเว้นจาก CR-196 FR-LK-10)

**รับของทีละจุด (back-office)**

- **FR-MP-18** — หน้าสแกนรับของมีตัวเลือก "จุดที่ประจำ" = จุดรับบริจาคของศูนย์ · เครื่องจำค่าที่เลือกไว้ต่อศูนย์ (เก็บในเครื่อง ไม่บันทึกลงบัญชีผู้ใช้) · เปลี่ยนได้ตลอด · ศูนย์ที่ไม่มีจุดรับบริจาค → ไม่แสดงตัวเลือก และหน้าสแกนทำงานเหมือนเดิม
- **FR-MP-19** — สแกนใบแล้ว รายการที่รับได้ = รายการที่ `drop_off_point_id` = จุดที่ประจำ **และ** รายการที่ไม่ระบุจุด (`null` หรือจุดที่ถูกลบไปแล้ว) · รายการของจุดอื่นแสดงเป็นแถวที่กดไม่ได้ พร้อมชื่อจุดปลายทาง · รายการที่มี `received_at` แล้วแสดงว่า "รับแล้วที่ <จุด>" และกดไม่ได้
- **FR-MP-20** — "สถานที่จัดเก็บ" ของแต่ละรายการเริ่มที่ `storage_point_id = drop_off_point_id` · รายการที่ไม่ระบุจุดเริ่มที่จุดที่ประจำ · เจ้าหน้าที่เปลี่ยนได้
- **FR-MP-21** — ปุ่ม "รับรายการของจุดอื่น" ปลดล็อกรายการของจุดอื่น (ที่ยังไม่มี `received_at`) ให้รับได้ · สถานที่จัดเก็บของรายการเหล่านั้นเริ่มที่จุดที่ประจำ (ใช้เมื่อผู้บริจาคนำของมาผิดจุด)
- **FR-MP-22** — บันทึกที่จุด: เขียนแถว `stock_ledger` ของรายการที่รับ (กติกา `_id` deterministic เดิมของ CR-143 §B) · ตั้ง `received_at` ให้ทุกรายการที่บันทึกผลในครั้งนี้ (รับหรือไม่รับ) · เขียนผลของรายการเหล่านั้นลง `received_summary.items[]`
- **FR-MP-23** — ทุกรายการมี `received_at` ครบ → ใบเปลี่ยนสถานะตามกติกาเดิม (`received` · ไม่มีรายการที่รับจริงเลย → `rejected` ตาม CR-172) และเติม `received_summary.received_at` / `total_items` / `shortfalls` · ยังไม่ครบ → คงสถานะเดิม
- **FR-MP-24** — ใบที่ไม่มีรายการระบุจุดเลย (ใบเดิม, `parcel`, `shelter_pickup`, ศูนย์ไม่มีจุด) → รับทั้งใบในครั้งเดียวเหมือนเดิม
- **FR-MP-25** — scan station และหน้ารอประเมินแสดงชื่อจุดของแต่ละรายการ

**ปิดใบที่ของมาไม่ครบทุกจุด**

- **FR-MP-26** — ใบที่มีรายการ `received_at` แล้วอย่างน้อย 1 รายการ และยังไม่ครบทุกรายการ → หน้าสแกนแสดงปุ่ม "ปิดใบ" · ผู้ที่กดได้ = ผู้ที่รับของบริจาคของศูนย์นั้นได้อยู่แล้ว (route `POST /api/back-office/donations/[query]` และ shelter scope เดิม) · ไม่เพิ่ม role หรือ permission
- **FR-MP-27** — ปิดใบ: รายการที่ยังไม่มี `received_at` นับเป็น "รับไม่ครบ" (counted 0, ลงใน `received_summary.shortfalls`) และคืนยอดจองของรายการนั้น · สถานะใบตาม FR-MP-23 · บันทึก audit ว่าใครปิด
- **FR-MP-28** — ใบที่ยังไม่มีรายการไหน `received_at` → ไม่มีปุ่ม "ปิดใบ" (ใช้ reject / หมดอายุตามเดิม)

**หมดอายุ**

- **FR-MP-29** — worker ที่ทำให้ใบหมดอายุ (`worker/src/worker/quota/expiry.py`) เจอใบที่เลย `expires_at` และมีรายการ `received_at` แล้วอย่างน้อย 1 รายการ → ปิดใบตาม FR-MP-27 (audit `by: system`) แทนการเปลี่ยนเป็น `expired` · ใบที่ไม่มีรายการไหน `received_at` → `expired` ตามเดิม

**redirect (CR-087)**

- **FR-MP-30** — ใบที่มีรายการ `received_at` แล้วอย่างน้อย 1 รายการ → redirect ไม่ได้ (`409 PARTIALLY_RECEIVED`) · ใบที่ยังไม่มี → ย้ายทั้งใบไปศูนย์ปลายทางเหมือนเดิม และเขียน `drop_off_point_id = null` ให้ทุกรายการใน snapshot (จุดเป็นของศูนย์ต้นทาง)

**ไม่เปลี่ยน**

- **FR-MP-31** — `stock_ledger` ไม่เปลี่ยน field หรือ `_id` · ใช้ `lot.storage_point_id` ที่มีอยู่

## Change (before → after)

**CouchDB `donation.items[]`**

| field | ชนิด | ค่าเมื่อไม่มี key | กติกา |
| --- | --- | --- | --- |
| `drop_off_point_id` | str \| null | `null` (= ไม่ระบุจุด) | FR-MP-2 – FR-MP-4 |
| `received_at` | ts \| null | `null` (= ยังไม่บันทึก) | FR-MP-5, FR-MP-22 |

- ก่อน: `items: [{ item_id: 'water', qty: '24', unit: 'ขวด' }, { item_id: 'paracetamol', qty: '10', unit: 'แผง' }]`
- หลังจอง: `items: [{ …water, drop_off_point_id: '01J…GYM', received_at: null }, { …paracetamol, drop_off_point_id: '01J…MED', received_at: null }]`
- หลังโรงยิมรับ: น้ำได้ `received_at: '2026-10-28T09:12:00+07:00'` · ใบยัง `verifying` · ยายัง `null`

**Mongo `public_donations.items_declared[]`** — เพิ่ม `drop_off_point_id`, `received_at` (ส่งต่อจาก CouchDB ตรงๆ)

**API** — `items[].drop_off_point_id` (opt) ใน request ของ `POST /public/v1/donations` และ `PATCH …/{tracking_token}/items` · `items[].drop_off_point_id` และ `items[].received_at` ใน response ของ `GET …/{tracking_token}` · error ใหม่ `400 UNKNOWN_DROP_OFF_POINT`, `409 PARTIALLY_RECEIVED`

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ปลายทางของใบ | ศูนย์ (`shelter_code`) | ศูนย์ + จุดต่อรายการ (เฉพาะนำมาส่งเอง) |
| จำนวนใบต่อการจอง | 1 | 1 (ไม่แตกใบ) |
| slot / โควต้า / QR | ชุดเดียวต่อใบ | ชุดเดียวต่อใบ (ไม่เปลี่ยน) |
| การรับของ | บันทึกทั้งใบครั้งเดียว | บันทึกทีละจุด · ครบทุกจุดแล้วใบถึงเป็น `received` |
| ที่เก็บตอนรับของ | เจ้าหน้าที่เลือกเอง | เริ่มที่จุดของรายการ เจ้าหน้าที่เปลี่ยนได้ |
| ของมาไม่ครบทุกจุด | — | เจ้าหน้าที่ "ปิดใบ" หรือ worker ปิดเมื่อหมดอายุ |
| ยกเลิก / redirect | ทำได้ใน `verifying` | ทำไม่ได้เมื่อมีจุดที่รับแล้ว |

## Acceptance

- **AC-1** — ศูนย์มี 2 จุด → จองน้ำไปโรงยิม ยาไปห้องพยาบาล → doc มี `drop_off_point_id` ตรงกับที่เลือก · หน้าติดตามแสดง 2 กลุ่ม "รอรับ" · ใบปะหน้า 2 ใบ
- **AC-2** — ส่ง `drop_off_point_id` ที่ไม่อยู่ในศูนย์นั้น → `400 UNKNOWN_DROP_OFF_POINT` และโควต้าไม่ขยับ
- **AC-3** — ศูนย์ไม่มีจุดแต่ส่ง id มา → `400 UNKNOWN_DROP_OFF_POINT`
- **AC-4** — `parcel` หรือ `shelter_pickup` แล้วส่ง id มา → บันทึกเป็น `null`
- **AC-5** — เจ้าหน้าที่ประจำโรงยิมสแกนใบจาก AC-1 → รับได้เฉพาะน้ำ · ยาแสดง "ส่งที่ห้องพยาบาล" กดไม่ได้ · บันทึก → น้ำมี `received_at`, ล็อตได้ `storage_point_id` = โรงยิม, ใบยัง `verifying`, หน้าติดตามแสดง "โรงยิม รับแล้ว · ห้องพยาบาล รอรับ"
- **AC-6** — ต่อจาก AC-5 เจ้าหน้าที่ห้องพยาบาลรับยา → ใบเป็น `received`
- **AC-7** — ต่อจาก AC-5 ยาไม่มาส่ง เจ้าหน้าที่กด "ปิดใบ" → ใบ `received` · ยาอยู่ใน `shortfalls` · ยอดจองของยาถูกคืน
- **AC-8** — ต่อจาก AC-5 ไม่มีใครปิดใบจนเลย `expires_at` → worker ปิดใบเป็น `received` แบบ AC-7 ไม่ใช่ `expired`
- **AC-9** — ต่อจาก AC-5 ผู้บริจาคกดยกเลิก → `409 PARTIALLY_RECEIVED` · เจ้าหน้าที่ redirect → `409 PARTIALLY_RECEIVED`
- **AC-10** — ผู้บริจาคนำยามาที่โรงยิม → เจ้าหน้าที่กด "รับรายการของจุดอื่น" แล้วรับยาได้ · สถานที่จัดเก็บเริ่มที่โรงยิม
- **AC-11** — redirect ใบที่ยังไม่มีจุดไหนรับ → ใบที่ศูนย์ปลายทางมี `drop_off_point_id = null` ทุกรายการ
- **AC-12** — ใบเดิมที่ไม่มี key และใบ `parcel` → รับทั้งใบในครั้งเดียวเหมือนก่อนเปลี่ยน
- **AC-13** — เอาติ๊กจุดออกหลังจอง → หน้าติดตามแสดงจุดหลัก · รายการนั้นรับได้ทุกจุด

## Impact

- **backend**: `DonationItemInput.drop_off_point_id: str | None = None` · `create` และ `update_items` ตรวจ FR-MP-2 – FR-MP-4 กับ `PublicShelter.donation_points` · cancel ตรวจ FR-MP-17
- **tent-model**: `DeclaredItem.drop_off_point_id`, `DeclaredItem.received_at` (`str | None = None`)
- **worker**: inbound คัดลอก `drop_off_point_id` ลง CouchDB · bump `DONATION_SCHEMA_V` · projector ส่ง 2 field ลง `items_declared` · bump `PROJECTION_VERSION` · `quota/expiry.py` ทำตาม FR-MP-29
- **frontend public**
  - `donations/domain/donation.ts`: zod input เพิ่ม field
  - `operations/domain/operations.ts`: bump `DONATION_SCHEMA_V` ให้ตรงกับ worker
  - `donor-time-selection-form.svelte`: FR-MP-8 – FR-MP-12 (section ใหม่ ไม่แก้ section เลือกศูนย์ของ #814)
  - BFF `routes/api/public/v1/donations/+server.ts`: ส่ง field ต่อไป FastAPI
  - ตั๋ว หน้าติดตาม ใบปะหน้า: FR-MP-13, FR-MP-14 (ใช้ `resolveDropOffPoint` จาก #590)
  - `edit-donation-items-dialog.svelte` + route `…/[tracking_token]/items`: FR-MP-15
  - route `…/[tracking_token]` (DELETE): FR-MP-17
- **frontend back-office**
  - `scan-station.svelte`: FR-MP-18 – FR-MP-21, FR-MP-25, ปุ่ม "ปิดใบ" (FR-MP-26)
  - route `api/back-office/donations/[query]` (POST): รับบางรายการ (FR-MP-22, FR-MP-23) และปิดใบ (FR-MP-27) · ตอนนี้ route ปฏิเสธใบที่ `received` แล้ว และรับทั้งใบในครั้งเดียว
  - route `…/[query]/redirect` + `donation-redirect.ts`: FR-MP-30
  - `pending-review-detail.svelte`: FR-MP-25
- **OpenAPI**: regenerate `fastapi.json` + `openapi.d.ts`
- **ไม่กระทบ**: `stock_ledger`, `donation_slot`, `donation_campaign`, สูตรโควต้าและ needs (ยอดจองที่หักส่วนที่บันทึกแล้วใช้กติกาเดิมของ CR-143 §B)
- **docs หลัง approve**: schema.md §2.3 (+ หมายเหตุ schema_v, Migration และกติการับของทีละจุด) · couchdb-mongodb-sync.md §3.2 · api-contract.md §5 · CR-087 · CR-196 FR-LK-10 · public-tier-donation-spec.html · อัปเดต `updated:` ทุกไฟล์

## Migration

- `drop_off_point_id` และ `received_at` optional → doc เดิมไม่ backfill
- ใบเดิมไม่มีรายการระบุจุด → รับทั้งใบครั้งเดียวเหมือนเดิม (FR-MP-24) · ใบที่ `received` ไปแล้วไม่มี `received_at` ไม่ต้องเติม
- re-project `public_donations` ผ่าน PROJECTION_VERSION

## ลำดับ `schema_v`

- develop ตอนนี้ donation schema_v = 7 · CR-175 (รูปของบริจาค) และ CR-196 (`line_key`) ยังไม่มีโค้ดบน develop และแย่งเลข 8/9 กันอยู่ตามมติ "ใคร merge ก่อนได้เลขก่อน" (CR-196 §ลำดับ schema_v)
- CR นี้ใช้กติกาเดียวกัน: ได้เลขถัดจากเลขล่าสุดบน develop ตอน merge
- PROJECTION_VERSION ใช้กติกาเดียวกัน (develop ตอนนี้ = 9 · `draft-storage-drop-off-points` จะใช้ 10)

## ข้อตกลงที่รออนุมัติ

ผู้ขอ (Kunanon Nusaeng) เลือกทุกข้อด้านล่างแล้วเมื่อ 2026-10-27 · ต้องรอผู้อนุมัติยืนยัน

| # | เรื่อง | ที่เลือก | FR |
| --- | --- | --- | --- |
| D-1 | ใบเดียว หรือแตกหลายใบ (คำถามใน #813) | ใบเดียว ระบุจุดต่อรายการ | FR-MP-1, FR-MP-6 |
| D-2 | redirect ใบที่มีจุด (คำถามใน #813) | ย้ายทั้งใบ ล้างจุด · ห้ามเมื่อรับไปบางจุดแล้ว | FR-MP-30 |
| D-3 | `parcel` เลือกจุดได้ไหม | ไม่ได้ (`null`) | FR-MP-4 |
| D-4 | เจ้าหน้าที่รู้ได้ยังไงว่ารับรายการไหน | เลือก "จุดที่ประจำ" บนหน้าสแกน | FR-MP-18, FR-MP-19 |
| D-5 | ของมาไม่ครบทุกจุด | เจ้าหน้าที่กด "ปิดใบ" | FR-MP-26 – FR-MP-28 |
| D-6 | ใบที่รับบางจุดแล้วเลยเวลาหมดอายุ | worker ปิดใบเป็น `received` แทน `expired` | FR-MP-29 |
| D-7 | ผู้บริจาคยกเลิกใบที่รับบางจุดแล้ว | ไม่ได้ | FR-MP-17 |
| D-8 | ใครกด "ปิดใบ" ได้ | ผู้ที่รับของบริจาคได้อยู่แล้ว ไม่เพิ่มสิทธิ์ | FR-MP-26 |
| D-9 | ผู้บริจาคนำของมาผิดจุด | ปุ่ม "รับรายการของจุดอื่น" | FR-MP-21 |

## ทางเลือกที่ไม่เลือก

- **แตกเป็นหลายใบ (1 รายการ หรือ 1 จุด = 1 ใบ)** — ข้อมูลง่ายขึ้น (จุดเป็น field ของใบ) แต่ต้องเพิ่มรหัสกลุ่มผูกใบ, นับ slot เป็นกลุ่ม, ยกเลิกทั้งชุดเมื่อใบใดจองไม่ผ่าน และผู้บริจาคถือหลาย QR (ขัดกับ comment ใน #815 "แสดง QR รับของเข้าอันเดียว")
- **ผูกบัญชีเจ้าหน้าที่กับจุด** — ต้องเพิ่มข้อมูลในบัญชีผู้ใช้และแก้ role matrix · เจ้าหน้าที่สลับจุดหน้างานแล้วแอดมินต้องแก้ทุกครั้ง
- **ใส่จุดใน QR ของใบปะหน้า** — ผู้บริจาคไม่ได้พิมพ์ใบปะหน้าทุกคน · QR บนมือถือมีอันเดียวทั้งใบ
- **ให้ระบบปิดใบเองเมื่อพ้นวันนัด** — ต้องมี job ใหม่ · ใช้ job หมดอายุที่มีอยู่แทน (FR-MP-29)

## Decision log

- 2026-10-27 — proposed (draft) จาก issue #813 และแผน epic #825
- 2026-10-27 — ผู้ขอเลือก D-1 – D-9 · เพิ่มการรับของทีละจุด, ปิดใบ, หมดอายุ, ยกเลิก และ field `received_at` (เดิมร่างแรกรับทั้งใบครั้งเดียว ซึ่งทำให้จุดแรกที่สแกนปิดใบแทนจุดอื่น) · `parcel` เปลี่ยนจากเลือกจุดได้เป็น `null`
