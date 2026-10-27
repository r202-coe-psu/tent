---
id: draft
title: บริจาคครั้งเดียวแยกส่งหลายจุดรับบริจาค — ระบุจุดส่งต่อรายการ
status: proposed
date: 2026-10-27
created: 2026-10-27
updated: 2026-10-27
requested_by: "feedback จาก demo 2026-10-23 (epic #825) — issue #813"
decided_by: ""
layer: volatile
depends_on: "draft-storage-drop-off-points (#812, PR #944) — ต้อง approve และ implement ก่อน"
affects:
  - docs/data/schema.md §2.3 `donation.items[]` — field ใหม่ `drop_off_point_id` · donation schema_v 7 → เลขถัดไปตอน merge (ดู §ลำดับ schema_v)
  - docs/data/couchdb-mongodb-sync.md §3.2 `public_donations.items_declared[].drop_off_point_id` · bump PROJECTION_VERSION
  - docs/data/api-contract.md §5 — `POST /public/v1/donations`, `GET /public/v1/donations/{tracking_token}`, `PATCH /public/v1/donations/{tracking_token}/items` (field ใหม่ + error `400 UNKNOWN_DROP_OFF_POINT`)
  - docs/changes/04-donation/CR-087-donation-redirect-target.md (redirect ล้างจุดส่ง)
  - docs/features/public-tier-donation-spec.html (ฟอร์มจองเลือกจุดต่อรายการ)
  - backend/apiapp/modules/donations (schemas.py `DonationItemInput`, use_case.py `create` / `update_items`) · backend/tests/test_donations.py
  - packages/tent-model/src/tent_model/public_donation.py (`DeclaredItem`)
  - worker/src/worker/inbound/donations.py (`DONATION_SCHEMA_V`) · worker/src/worker/projectors/donation.py · worker/src/worker/projection_version.py
  - frontend/src/lib/features/donations (domain/donation.ts, domain/donation-redirect.ts, ui/edit-donation-items-dialog.svelte) · frontend/src/lib/features/operations/domain/operations.ts (`DONATION_SCHEMA_V`)
  - frontend/src/lib/components/form/donor-time-selection-form.svelte · routes/api/public/v1/donations/+server.ts · routes/api/public/v1/donations/[tracking_token]/items/+server.ts
  - back-office: routes/(protected)/back-office/stock-donations/components/scan-station.svelte · lib/components/pending-review-detail.svelte
why: >
  ศูนย์ที่มีจุดรับบริจาคหลายจุดต้องการให้ของแต่ละประเภทไปส่งที่จุดที่เก็บของประเภทนั้น
  (เช่น น้ำดื่มไปโรงยิม ยาไปห้องพยาบาล) แต่ใบบริจาคตอนนี้มีปลายทางเดียวคือศูนย์ — ให้ระบุจุดส่ง
  ต่อรายการในใบเดียว ของจึงเข้าคลังของจุดนั้นได้เลยตอนรับ
migration: >
  optional field ไม่ backfill — ใบเดิมไม่มี key = ส่งที่จุดหลักของศูนย์ · bump donation schema_v
  และ PROJECTION_VERSION
---

# บริจาคครั้งเดียวแยกส่งหลายจุดรับบริจาค — ระบุจุดส่งต่อรายการ

## สรุป (TL;DR)

- ใบบริจาคยังเป็น **ใบเดียว** (token, QR, `booking_ref`, slot ชุดเดียว) แต่ละรายการมี `items[].drop_off_point_id` บอกว่าต้องส่งที่จุดไหน
- ผู้บริจาคเลือกจุดต่อรายการได้เมื่อศูนย์มีจุดรับบริจาค ≥ 2 จุด · ตั๋ว หน้าติดตาม และใบปะหน้ากล่องแสดงแยกกลุ่มตามจุด
- ตอนรับของ ระบบเติม "สถานที่จัดเก็บ" (`storage_point_id`) = จุดที่ส่ง ของจึงเข้าคลังจุดนั้นโดยไม่ต้องย้ายซ้ำ
- redirect (CR-087) ย้ายทั้งใบเหมือนเดิม และล้างจุดของทุกรายการ
- donation schema_v 7 → เลขถัดไปตอน merge · bump PROJECTION_VERSION · ขึ้นกับ CR "ใช้จุดเก็บของเป็นจุดรับบริจาค" (`draft-storage-drop-off-points`)

## Why

- ศูนย์ที่ตั้งจุดรับบริจาคไว้หลายจุด (`draft-storage-drop-off-points`) อยากให้ของแต่ละประเภทไปจุดที่เก็บของประเภทนั้น
- ใบบริจาคตอนนี้มีปลายทางเดียว (`shelter_code`) และ `logistics` ชุดเดียว · ผู้บริจาคที่นำของหลายประเภทมาส่งไม่รู้ว่าต้องแยกไปจุดไหน
- จุดรับบริจาค = จุดเก็บของ และล็อตในคลังมี `storage_point_id` อยู่แล้ว (schema.md §2.1) · ถ้ารู้จุดตั้งแต่ตอนจอง ตอนรับของก็เติมที่เก็บให้ได้ทันที

## Requirements

**ข้อมูล**

- **FR-MP-1** — `donation.items[]` มี field ใหม่ `drop_off_point_id: str | null` (optional) · ไม่มี key หรือ `null` = ส่งที่จุดหลักของศูนย์
- **FR-MP-2** — ค่าที่ไม่ใช่ `null` ต้องเป็น `id` ที่อยู่ใน `public_shelters.donation_points` ของ `shelter_code` ของใบ ณ ตอนจองหรือตอนแก้รายการ · ไม่อยู่ → `400 UNKNOWN_DROP_OFF_POINT` และโควต้าไม่ขยับ
- **FR-MP-3** — ศูนย์ที่ไม่มีจุดรับบริจาค → ทุกรายการต้องเป็น `null` · ส่ง id มา → `400 UNKNOWN_DROP_OFF_POINT`
- **FR-MP-4** — `logistics.delivery_method = shelter_pickup` (ศูนย์ไปรับ) → ระบบเขียน `null` ทุกรายการ ไม่ว่า client จะส่งอะไรมา
- **FR-MP-5** — ใบยังมี `logistics`, slot, โควต้า, token, QR และ `booking_ref` ชุดเดียว · จุดส่งไม่มีผลกับ slot และโควต้า (slot ผูกกับศูนย์ — `draft-storage-drop-off-points` D-1)
- **FR-MP-6** — ใบ walk-in ที่เจ้าหน้าที่สร้างไม่เขียน `drop_off_point_id`

**ฟอร์มจอง public** (`donor-time-selection-form.svelte`)

- **FR-MP-7** — เพิ่ม section "จุดส่งของแต่ละรายการ" ต่อจาก section เลือกศูนย์ · แสดงเมื่อศูนย์ที่เลือกมีจุดรับบริจาค ≥ 2 จุด และวิธีส่งเป็น `self_dropoff` หรือ `parcel`
- **FR-MP-8** — ค่าเริ่มต้นของทุกรายการ = จุดที่ผู้บริจาคแตะบนแผนที่ (#814) · ถ้าไม่ได้แตะ = จุดแรกในรายการ
- **FR-MP-9** — ศูนย์มีจุดเดียว → ใส่ id ของจุดนั้นให้ทุกรายการอัตโนมัติ และแสดงชื่อจุด (ไม่มีตัวเลือก)
- **FR-MP-10** — ศูนย์ไม่มีจุด → ไม่แสดง section และส่ง `null`
- **FR-MP-11** — เปลี่ยนศูนย์ → ล้างจุดของทุกรายการ

**หลังจอง**

- **FR-MP-12** — ตั๋วและหน้าติดตาม (`/donations/track/[token]`) แสดงปลายทางแยกกลุ่มตามจุด (ชื่อจุด, คำอธิบายตำแหน่ง, ปุ่มนำทาง, รายการในกลุ่มนั้น)
- **FR-MP-13** — ใบปะหน้ากล่อง (#591) ออก 1 ใบต่อจุด
- **FR-MP-14** — ผู้บริจาคแก้รายการ (ภายใต้กติกาของ CR-196 — แก้ได้เฉพาะใบที่ยังไม่ประเมิน): รายการเดิมคงจุดเดิม (จับคู่ด้วย `line_key`) · มีตัวเลือกจุดต่อรายการเมื่อศูนย์มี ≥ 2 จุด · ตรวจตาม FR-MP-2
- **FR-MP-15** — จุดที่ถูกเอาติ๊กออกหรือถูกลบหลังจอง → ใบที่อ้างจุดนั้นแสดงปลายทางเป็นจุดหลักของศูนย์ ไม่ error

**redirect (CR-087)**

- **FR-MP-16** — redirect ย้ายทั้งใบไปศูนย์ปลายทางเหมือนเดิม และเขียน `drop_off_point_id = null` ให้ทุกรายการใน snapshot (จุดเป็นของศูนย์ต้นทาง ใช้ที่ศูนย์ใหม่ไม่ได้)

**back-office**

- **FR-MP-17** — scan station และหน้ารอประเมินแสดงชื่อจุดส่งของแต่ละรายการ
- **FR-MP-18** — ตอนรับของ "สถานที่จัดเก็บ" ของแต่ละรายการเริ่มที่ `storage_point_id = drop_off_point_id` · เจ้าหน้าที่เปลี่ยนได้ · จุดถูกลบไปแล้วหรือเป็น `null` → ไม่เติม
- **FR-MP-19** — `stock_ledger` ไม่เปลี่ยน field หรือ `_id` · ใช้ `lot.storage_point_id` ที่มีอยู่

## Change (before → after)

**CouchDB `donation.items[]`**

| field | ชนิด | ค่าเมื่อไม่มี key | กติกา |
| --- | --- | --- | --- |
| `drop_off_point_id` | str \| null | `null` (= จุดหลัก) | FR-MP-2 – FR-MP-4 |

- ก่อน: `items: [{ item_id: 'water', qty: '24', unit: 'ขวด' }, { item_id: 'paracetamol', qty: '10', unit: 'แผง' }]`
- หลัง: `items: [{ item_id: 'water', qty: '24', unit: 'ขวด', drop_off_point_id: '01J…GYM' }, { item_id: 'paracetamol', qty: '10', unit: 'แผง', drop_off_point_id: '01J…MED' }]`

**Mongo `public_donations.items_declared[]`** — เพิ่ม `drop_off_point_id` (ส่งต่อจาก CouchDB ตรงๆ)

**API** — `items[].drop_off_point_id` (opt) ใน request ของ `POST /public/v1/donations` และ `PATCH …/{tracking_token}/items` · ใน response ของ `GET …/{tracking_token}` · error ใหม่ `400 UNKNOWN_DROP_OFF_POINT`

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ปลายทางของใบ | ศูนย์ (`shelter_code`) | ศูนย์ + จุดต่อรายการ |
| จำนวนใบต่อการจอง | 1 | 1 (ไม่แตกใบ) |
| slot / โควต้า / QR | ชุดเดียวต่อใบ | ชุดเดียวต่อใบ (ไม่เปลี่ยน) |
| ที่เก็บตอนรับของ | เจ้าหน้าที่เลือกเอง | เริ่มที่จุดที่ส่ง เจ้าหน้าที่เปลี่ยนได้ |
| redirect | ย้ายทั้งใบ | ย้ายทั้งใบ + ล้างจุดทุกรายการ |

## Acceptance

- **AC-1** — ศูนย์มี 2 จุด → จอง 2 รายการคนละจุด → doc มี `drop_off_point_id` ตรงกับที่เลือก · หน้าติดตามแสดง 2 กลุ่ม · ใบปะหน้า 2 ใบ
- **AC-2** — ส่ง `drop_off_point_id` ที่ไม่อยู่ในศูนย์นั้น → `400 UNKNOWN_DROP_OFF_POINT` และโควต้าไม่ขยับ
- **AC-3** — ศูนย์ไม่มีจุดแต่ส่ง id มา → `400 UNKNOWN_DROP_OFF_POINT`
- **AC-4** — `shelter_pickup` แล้วส่ง id มา → บันทึกเป็น `null`
- **AC-5** — ศูนย์มีจุดเดียว → ไม่มีตัวเลือก ทุกรายการได้ id ของจุดนั้น
- **AC-6** — redirect ใบที่มีจุด → ใบที่ศูนย์ปลายทางมี `drop_off_point_id = null` ทุกรายการ
- **AC-7** — รับของจากใบที่มีจุด → ล็อตได้ `storage_point_id` ตรงกับจุดของรายการนั้น (เมื่อเจ้าหน้าที่ไม่เปลี่ยน)
- **AC-8** — เอาติ๊กจุดออกหลังจอง → หน้าติดตามแสดงจุดหลัก · หน้ารับของไม่เติมที่เก็บ
- **AC-9** — ใบเดิมที่ไม่มี key → หน้าติดตามและหน้ารับของทำงานเหมือนก่อนเปลี่ยน

## Impact

- **backend**: `DonationItemInput.drop_off_point_id: str | None = None` · `create` และ `update_items` ตรวจ FR-MP-2 – FR-MP-4 กับ `PublicShelter.donation_points`
- **tent-model**: `DeclaredItem.drop_off_point_id: str | None = None`
- **worker**: inbound คัดลอก field ลง CouchDB · bump `DONATION_SCHEMA_V` · projector ส่งต่อลง `items_declared` · bump `PROJECTION_VERSION`
- **frontend**
  - `donations/domain/donation.ts`: zod input เพิ่ม field
  - `operations/domain/operations.ts`: bump `DONATION_SCHEMA_V` ให้ตรงกับ worker
  - `donor-time-selection-form.svelte`: FR-MP-7 – FR-MP-11 (section ใหม่ ไม่แก้ section เลือกศูนย์ของ #814)
  - BFF `routes/api/public/v1/donations/+server.ts`: ส่ง field ต่อไป FastAPI
  - ตั๋ว หน้าติดตาม ใบปะหน้า: จัดกลุ่มตามจุด (FR-MP-12, FR-MP-13) — ใช้ `resolveDropOffPoint` จาก #590
  - `edit-donation-items-dialog.svelte` + route `…/[tracking_token]/items`: FR-MP-14
  - `donation-redirect.ts`: FR-MP-16
  - `scan-station.svelte`, `pending-review-detail.svelte`, หน้ารับของ: FR-MP-17, FR-MP-18
- **OpenAPI**: regenerate `fastapi.json` + `openapi.d.ts`
- **ไม่กระทบ**: `stock_ledger`, `donation_slot`, `donation_campaign`, สูตรโควต้าและ needs
- **docs หลัง approve**: schema.md §2.3 (+ หมายเหตุ schema_v และ Migration) · couchdb-mongodb-sync.md §3.2 · api-contract.md §5 · CR-087 (หมายเหตุว่า redirect ล้างจุด) · public-tier-donation-spec.html · อัปเดต `updated:` ทุกไฟล์

## Migration

- `drop_off_point_id` optional → doc เดิมไม่ backfill · ไม่มี key = จุดหลัก (ใบที่จองก่อน deploy แสดงและรับของได้เหมือนเดิม — AC-9)
- re-project `public_donations` ผ่าน PROJECTION_VERSION

## ลำดับ `schema_v`

- develop ตอนนี้ donation schema_v = 7 · CR-175 (รูปของบริจาค) และ CR-196 (`line_key`) ยังไม่มีโค้ดบน develop และแย่งเลข 8/9 กันอยู่ตามมติ "ใคร merge ก่อนได้เลขก่อน" (CR-196 §ลำดับ schema_v)
- CR นี้ใช้กติกาเดียวกัน: ได้เลขถัดจากเลขล่าสุดบน develop ตอน merge (น่าจะเป็น 8, 9 หรือ 10)
- PROJECTION_VERSION ใช้กติกาเดียวกัน (develop ตอนนี้ = 9 · `draft-storage-drop-off-points` จะใช้ 10)

## ต้องตัดสิน

- **D-1 — ใบเดียวที่ระบุจุดต่อรายการ หรือแตกเป็นหลายใบ** (คำถามใน #813)
  - ข้อเสนอ: **ใบเดียว ระบุจุดต่อรายการ** — slot ผูกกับศูนย์ จึงไม่มี logistics ต่อจุดให้แยก · ถ้าแตกหลายใบ ผู้บริจาคต้องจอง slot และโควต้าหลายรอบ ได้ตั๋วหลายใบ และต้องจัดการหลายลิงก์ · comment ใน #815 ต้องการ QR รับของอันเดียว
  - ถ้าเลือกแตกหลายใบ ต้องเขียน CR นี้ใหม่ทั้งฉบับ
- **D-2 — redirect ใบที่มีหลายจุด** (คำถามใน #813)
  - ข้อเสนอ: **ย้ายทั้งใบและล้างจุดทุกรายการ** (FR-MP-16) · redirect รายรายการเป็นงานใหญ่ และยังไม่มีใครขอ
- **D-3 — วิธีส่ง `parcel` เลือกจุดได้ไหม**
  - ข้อเสนอ: **ได้** (FR-MP-7) — ขนส่งส่งถึงที่อยู่ศูนย์ แต่ใบปะหน้าบอกเจ้าหน้าที่ว่ากล่องนี้ต้องไปจุดไหน

## Decision log

- 2026-10-27 — proposed (draft) จาก issue #813 และแผน epic #825
