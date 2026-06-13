---
title: Schema v3 — Implementation Status
created: 2026-06-11
updated: 2026-06-12
---

# Schema v3 — Implementation Status

สถานะ implement ของ `frontend/src/lib/features/` เทียบกับ `docs/data/schema.md` v3 และ `docs/data/data-model.md` v3

---

## Common Envelope (`docs/data/schema.md §0`)

**ครบแล้ว** — `frontend/src/lib/db/model.ts`

| Field | สถานะ |
|---|---|
| `_id = "{type}:{ulid}"` | ✓ `makeDoc()` ใช้ `ulid()` |
| `type`, `schema_v` | ✓ |
| `shelter_code`, `created_by` | ✗ ต้องแก้ `AuthorContext` → ใช้ shelter code (เช่น `SH001`) |
| `created_at`, `updated_at` | ✓ |

---

## Feature: `people` — `schema.md §1`

**ครบทุก doc type**

| Type | Interface | Factory | ไฟล์ |
|---|---|---|---|
| `evacuee` | ✓ | `createEvacuee()` | `people/domain/people.ts` |
| `medical` | ✓ | `createMedical()` | same |
| `household` | ✓ | `createHousehold()` | same |
| `movement` (append-only) | ✓ | `createMovement()` | same |
| `screening` (append-only) | ✓ | `createScreening()` | same |

Extras: `applyMovementToStay()` + type guards ครบ

---

## Feature: `operations` — `schema.md §2`

**Partial** — stock + donation ครบ; types อื่นยังไม่มี

### ครบแล้ว

| Type | Interface | Factory | หมายเหตุ |
|---|---|---|---|
| `stock_ledger` (append-only) | ✓ | `createStockLedger()` | `operations/domain/operations.ts` |
| `donation` (state machine) | ✓ | `createWalkInDonation()` | transitions + `keyDonationReceipt()` |
| `donation_campaign` | ✓ | `createCampaign()` | `openNeeds()` read model |

### ยังต้องทำ

| Type | Schema ref | หมายเหตุ |
|---|---|---|
| `stock_transfer` (state machine) | §2.2 | โอนของข้ามศูนย์; requested→shipped→received |
| `meal_plan` | §2.5 | deterministic `_id = meal_plan:{date}:{meal}` |
| `kitchen_requisition` (append-only) | §2.6 | เบิกวัตถุดิบ; สร้าง `stock_ledger` คู่ |
| `meal_service` (append-only) | §2.7 | บันทึกแจกอาหารจริง |
| `volunteer` | §2.8 | คนละ doc กับ `_users` |
| `shift_assignment` | §2.9 | ตารางเวร |
| `security_event` (append-only) | §2.10 | เหตุการณ์ความปลอดภัย |
| `referral` (state machine) | §2.11 | ส่งต่อหน่วยงานนอก |
| `audit` (append-only) | §2.12 | การกระทำสำคัญ |

---

## Feature: `shelter` (demo)

**ไม่ได้ update** — ยังเป็น schema เก่าก่อน v3 ทั้งหมด

| จุดต่าง | shelter (ปัจจุบัน) | schema v3 |
|---|---|---|
| Common envelope | ไม่มี `schema_v`, `shelter_code`, `created_at/by` | บังคับทุก doc |
| `_id` | `crypto.randomUUID()` | ULID `{type}:{ulid}` |
| คน | `Occupant` (`name`, `note`, `status: in/out`) | `evacuee` + `movement` แยก doc |
| Inventory | `InventoryItem` อยู่ใน shelter db | `supply_item` อยู่ใน `catalog` db |
| Stock | `StockTxn` (`itemId`, `delta`, `byUser`, `at`) | `stock_ledger` (`item_id`, `qty` signed, `reason` enum) |
| Config | `ShelterConfig` อยู่ใน shelter db | `shelter:{ulid}` อยู่ใน `registry` db |
| Roles | `shelter_a_manager/volunteer` | `shelter:{id}` role model ใหม่ |
| DB name | `shelter_a/b/c` | `shelter_{shelter_code}` (เช่น `shelter_SH001`) |

ดู `docs/demo/shelter-demo.md` สำหรับ context เดิม

---

## DBs ใน `catalog` / `registry` — ยังไม่มี feature layer

| Type | DB | Schema ref | สถานะ |
|---|---|---|---|
| `supply_item` | `catalog` | §4.1 | ✗ |
| `sop_profile` | `catalog` | §4.2 | ✗ |
| `recipe` | `catalog` | §4.3 | ✗ |
| `shelter` (registry) | `registry` | §3.1 | ✗ |
| `config:app` | `registry` | §3.2 | ✗ |

---

## สรุป

| Feature | สถานะ |
|---|---|
| `$lib/db/model.ts` (envelope) | **ครบ** |
| `people` | **ครบ** |
| `operations` (stock + donation) | **Partial** |
| `operations` (meal, volunteer, security, audit) | **ยังไม่ทำ** |
| `shelter` (demo) | **ไม่ได้ update** |
| `catalog` / `registry` feature layer | **ยังไม่ทำ** |
