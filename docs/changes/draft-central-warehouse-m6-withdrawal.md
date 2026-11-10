---
id: draft
title: คลังกลาง (M6) — หน้าดูคลัง/ขอเบิก/ติดตามสถานะ และรับของเข้าศูนย์ผ่าน donation channel `m6`
status: proposed
date: 2026-11-10
requested_by: project owner
decided_by: project owner (รอ approve)
layer: stable # เพิ่ม outbound integration plane (ใช้ร่วมกับ draft-referral-m5-hospital-integration) + worker สร้าง donation จากระบบภายนอก — ต้อง review ก่อน
affects:
  - docs/data/schema.md §2.3 (donation — enum `channel` เพิ่ม `m6`, field ใหม่ `external`, ข้อยกเว้น `expires_at`)
  - schema_v donation 11 → 12 (additive)
  - docs/data/schema.md §9 (Mongo collection ใหม่ `m6_withdrawals`, `m6_outbound_logs`, `m6_confirm_outbox`)
  - docs/data/api-contract.md (BFF `/api/back-office/central-warehouse/*`, `/api/back-office/integrations/status`; FastAPI `/v1/integrations/m6/*`)
  - docs/prd/role-permission-matrix.md (สิทธิ์ดูคลังกลาง / ขอเบิก / ยกเลิก)
  - docs/sitemap.md (หน้าใหม่ `/back-office/central-warehouse`)
  - docs/adr/0002-partner-integration-architecture.md (เพิ่มทิศ outbound — tent เรียก M6; ADR เดิมครอบคลุมเฉพาะ M6 อ่านข้อมูล tent)
  - backend/apiapp/modules/integrations_m6 (ใหม่) + integrations status (ร่วมกับ M5)
  - worker/src/worker/inbound (loop ใหม่ `m6_withdrawals` → donation, donation received → `m6_confirm_outbox`)
  - worker/src/worker/donation_status.py (ไม่ expire donation channel `m6`)
  - frontend/src/lib/features/central-warehouse (feature ใหม่) + frontend/src/lib/features/donations (reader/UI รองรับ channel `m6`)
  - frontend/src/routes/(protected)/back-office/central-warehouse (ใหม่)
related:
  - draft-referral-m5-hospital-integration (ใช้ outbound plane และ health gate ร่วมกัน)
source: A_M6_API_Services_External.docx — "M6 Resource API — Integration Guide" v3.1 (20–24 ส.ค. 2569, ทีม M6; ไม่ได้เก็บใน repo)
---

# คลังกลาง (M6) — ขอเบิกของจากคลังกลาง และรับของเข้าศูนย์ผ่าน donation

## สรุป (TL;DR)

เพิ่มหน้าใหม่ `/back-office/central-warehouse` ให้เจ้าหน้าที่ศูนย์ทำ 3 อย่าง:

1. ดูคลังกลางและสต็อกของ M6 (RES-001/002/003)
2. ส่งคำขอเบิก (RES-005)
3. ติดตามสถานะ (RES-006) และยกเลิกตอนที่ยัง `pending` (RES-008)

เมื่อ M6 ส่งของออกจากคลัง (`in_transit`) worker จะสร้าง **donation `channel: m6`** ในศูนย์ จากนั้นเจ้าหน้าที่รับของด้วย flow donation เดิม (สแกน, `stock_ledger`, รับทีละจุด, รับไม่ครบ) เมื่อรับครบ ระบบจะยืนยันกลับไป M6 ให้เอง (RES-007)

- **การเรียก M6 อยู่ใน FastAPI ที่เดียว** browser เรียกผ่าน BFF เท่านั้น
- **Health gate ใช้ตัวเดียวกับ M5** ถ้าติดต่อไม่ได้จะแสดง "เชื่อมต่อกับระบบกลางไม่ได้" และปิดทุก action
- **schema:** donation `schema_v` 11 → 12 แบบ additive

ต้องตัดสิน D1–D5 ก่อน approve

## Why

- ศูนย์ที่ของขาดตอนนี้ขอได้แค่จากศูนย์อื่น (`stock_transfer`) หรือรอผู้บริจาค ยังไม่มีช่องทางขอจากคลังกลางของจังหวัดหรือเขต (M6)
- M6 เปิด API ให้ระบบภายนอกดูคลังและสต็อก ขอเบิก ติดตาม และยืนยันรับ ตาม Integration Guide v3.1
- การรับของเข้าศูนย์มี flow ที่ครบอยู่แล้วใน donation (รับทีละรายการ, รับทีละจุด, รับไม่ครบ, ไม่รับรายบรรทัด, ลง `stock_ledger`) ถ้าใช้ซ้ำจะไม่ต้องสร้างระบบรับของใหม่ และของจาก M6 จะเข้าสต็อกด้วยกติกาเดียวกับของบริจาค
- ADR-0002 รองรับเฉพาะทิศที่ M6 อ่านข้อมูล tent (EXT-004/006) ยังไม่มีทิศที่ tent เรียก M6

## Change

### 1. Flow

```
[/back-office/central-warehouse]
 1. ดูคลังกลาง          RES-001 คลัง · RES-002 สต็อก · RES-003 ค้นของ
 2. ตะกร้า → ขอเบิก     RES-005 → pending
 3. ติดตามสถานะ         poll RES-006:
      pending ─(M6)─► approved / partially_approved ─(M6)─► in_transit ─(RES-007)─► received
         │                                         └─(M6)─► issued (ปิดทันที, ไม่มีการขนส่ง)
         ├─(M6)─► rejected
         └─(RES-008, เฉพาะ pending)─► cancelled
 4. in_transit          worker สร้าง donation channel = m6, status = verifying
[/back-office/stock-donations — flow เดิม]
 5. ของถึงศูนย์         สแกนรับ → stock_ledger → donation.status = received
 6. ยืนยันกลับ M6       worker เขียน m6_confirm_outbox → FastAPI เรียก RES-007
```

**ทำไมสร้าง donation ตอน `in_transit` ไม่ใช่ตอน `approved`** (ดู D1):
- `qty_fulfilled` (จำนวนที่จ่ายจริง) มีค่าแน่นอนตอนนี้
- ของออกจากคลังแล้วจริง
- RES-007 ยืนยันรับได้เฉพาะใบที่ `in_transit`
- ถ้าสร้างตอน `approved` ต้องแก้ `items[]` ภายหลัง ซึ่งขัดกับกฎ "แก้รายการหลังประเมินไม่ได้" (CR-196)

**สถานะ `issued`** ใช้กับการจ่ายภายในคลังเดียวกันที่ไม่มีการขนส่ง ไม่น่าเกิดกับคำขอที่ปลายทางเป็นศูนย์ ถ้าเกิดขึ้น ให้ถือเป็นใบจบโดยไม่สร้าง donation และแสดง "M6 ปิดใบโดยไม่มีการจัดส่ง ประสาน M6"

### 2. หน้าใหม่ `/back-office/central-warehouse`

| แท็บ | เนื้อหา | API |
|---|---|---|
| คลังกลาง | รายการคลัง (ชื่อ, อำเภอ, แผนที่เมื่อ `lat`/`lng` ไม่เป็น null) → เลือกคลัง → ตารางสต็อก (ชื่อ, `type_code`, `unit`, `available`) ค้นหาได้และกรองประเภทตาม `resource_types` ของ key | RES-001, RES-002 |
| ค้นหาของ | ค้นจาก catalog กลาง แสดง `warehouses_count` และเลือกคลังเพื่อดูว่าคลังนั้นมีของหรือไม่ | RES-003 |
| ตะกร้าขอเบิก | ใบเบิก 1 ใบต่อคลังต้นทาง · จำนวนเต็ม ≥ 1 · หน่วยล็อกตาม `unit` ของคลัง · เตือนเมื่อจำนวนเกิน `available` (ยังส่งได้ เพราะ M6 พิจารณาเอง) · `reason` บังคับ | RES-005 |
| คำขอของศูนย์ | รายการใบเบิกพร้อมสถานะ · จำนวนที่ขอเทียบกับ `qty_fulfilled` · เวลา `submitted_at` / `approved_at` / `completed_at` · ลิงก์ไปใบ donation เมื่อสร้างแล้ว · ใบ `pending` มีปุ่มยกเลิกพร้อมเหตุผล | RES-006, RES-008 |

**Payload ของ RES-005** BFF ประกอบฝั่ง server ด้วยข้อมูลศูนย์จาก CouchDB:

| ฟิลด์ | ค่า |
|---|---|
| `requester.location_code` | `shelter_code` |
| `requester.location_type` | `shelter` |
| `requester.location_name` | ชื่อศูนย์ |
| `requester.contact_name` | ผู้ใช้จาก session |
| `requester.contact_role` | ตำแหน่ง (กรอกในตะกร้า) |
| `requester.contact_phone` | เบอร์ (กรอกในตะกร้า) |
| `requester.external_ref` | `TENT-{shelter_code}-{ulid}` |
| `destination.location_code` / `name` | ศูนย์ปัจจุบัน |
| `destination.type` | `shelter` |
| `destination.lat` / `lng` / `address` | จาก `shelter.location` ถ้าศูนย์ไม่มีพิกัดหรือที่อยู่ บล็อกการส่งพร้อมข้อความให้ไปตั้งค่าศูนย์ |

### 3. สถาปัตยกรรม (outbound plane ร่วมกับ M5)

```
Browser ─► BFF /api/back-office/central-warehouse/*   (session + สิทธิ์ตาม D2, ผูก shelter_code จาก session)
             ▼  Bearer EXTERNAL_API_SECRET
          FastAPI /v1/integrations/m6/*   ── M6_BASE_URL / M6_CLIENT_ID / M6_CLIENT_SECRET (env backend เท่านั้น)
             · token: access 1 ชม. ต่ออายุก่อนหมด ≥ 60 วินาทีด้วย AUTH-002
               refresh token หมุนทุกครั้ง (เก็บทับ) · invalid_grant → กลับไปใช้ AUTH-001
             · cache RES-001 / RES-002 (ต่อคลัง) / RES-003 ไว้ 60 วินาที
             · Mongo m6_withdrawals (key = external_ref) + poller RES-006 ทุก 60 วินาที เฉพาะใบที่ยังไม่จบ
             ▼
            M6 (staging-m6-api / onedata-logis-api)

worker ─► m6_withdrawals ที่เป็น in_transit และยังไม่มี donation ─► สร้าง donation ใน shelter_{code}
worker ─► donation channel m6 ที่เพิ่ง received ─► m6_confirm_outbox ─► FastAPI เรียก RES-007 (retry ได้)
```

- **credential ใช้ใบเดียวทั้งระบบ** (M6 ผูก key กับ module ไม่ใช่กับศูนย์) ทุก endpoint ของ FastAPI ที่อ่านหรือเขียนใบเบิกต้องรับ `shelter_code` จาก BFF และกรองตามนั้น ห้ามศูนย์หนึ่งเห็นใบของศูนย์อื่น
- **scope ที่ขอจาก M6:** `read`, `request`, `confirm` เท่านั้น ไม่ขอ `goods-in` / `catalog-write` (RES-004) และ `warehouse-write` / `members-manage` (RES-009–016) ดูหัวข้อ "นอก scope"
- **FastAPI ไม่ได้รับ CouchDB credential** (ADR-0002) donation จึงสร้างโดย worker แบบเดียวกับ `external_bookings`
- **ใบเบิกไม่มี doc ใน CouchDB** source of truth คือ Mongo `m6_withdrawals` เพราะเป็นข้อมูลที่ M6 เป็นเจ้าของ CouchDB เห็นเฉพาะ donation ที่เกิดจากใบเบิก

### 4. Health gate ร่วม (แทน endpoint แยกรายระบบใน draft M5)

| ชั้น | Endpoint | พฤติกรรม |
|---|---|---|
| FastAPI | `GET /v1/integrations/status` | `{m5: {...}, m6: {configured, token_ok, reachable, resource_types, checked_at, error}}` cache ผลการตรวจ upstream ไว้ 30–60 วินาที |
| BFF | `GET /api/back-office/integrations/status` | timeout 3 วินาที · ตอบ `state` ต่อระบบ: `ready` · `central_unreachable` · `<sys>_unavailable` · `<sys>_not_configured` · `<sys>_credential_invalid` |
| UI | `useIntegrationStatus('m6')` (refetch ทุก 30 วินาที, `retry: false`) | ถ้าไม่ใช่ `ready`: หน้าคลังกลางแสดง "เชื่อมต่อกับระบบกลางไม่ได้" พร้อมปุ่มลองใหม่ และปิดทุก action · แท็บ "คำขอของศูนย์" แสดง snapshot ล่าสุดจาก Mongo ได้ถ้า FastAPI ตอบ แต่ปิดปุ่มยกเลิก |

- **`resource_types` เป็นค่าว่าง** (key ยังไม่ได้รับสิทธิ์ประเภทใด) ถือว่า `m6_credential_invalid` และแสดง "ยังไม่ได้รับสิทธิ์เบิกของจาก M6 ติดต่อผู้ดูแลระบบ"
- **ด่านสุดท้าย:** BFF ที่เขียนไป M6 ตอบ `503 CENTRAL_UNAVAILABLE` หรือ `503 M6_UNAVAILABLE` เอง
- **donation channel `m6` ที่สร้างแล้ว** รับของได้แม้ gate ไม่ผ่าน เพราะการรับเป็น CouchDB ล้วน ส่วนการยืนยันกลับ M6 ค้างใน outbox จนกว่าจะติดต่อได้

### 5. donation (§2.3) — schema_v 11 → 12

| Field | เปลี่ยน | หมายเหตุ |
|---|---|---|
| `channel` | enum เพิ่ม `m6` | สร้างโดย worker เท่านั้น ห้าม UI หรือ BFF สร้าง donation `m6` เอง |
| `external` | ใหม่ · sys · {`system`: `m6`, `request_code`: str, `external_ref`: str, `source_warehouse_code`: str, `source_warehouse_name`: str?, `confirmed_at`: ts?, `confirm_error`: str?} | worker เขียนตอนสร้าง และเขียน `confirmed_at` / `confirm_error` หลังเรียก RES-007 |
| `donor` | ค่าเมื่อ `channel = m6` | `{name: "คลังกลาง M6 · {ชื่อคลัง}", phone: null, phone_hash: ""}` ไม่มี PII · ต้องยืนยันว่า `phone_hash` ว่างได้ หรือใช้ค่าคงที่ (D5) |
| `items[]` | ค่าเมื่อ `channel = m6` | 1 รายการต่อ `lines[]` ที่ `qty_fulfilled > 0` · `qty = qty_fulfilled` (qty_str) · `unit` = หน่วยของ M6 · `item_id` จาก mapping (D3) ถ้าไม่พบใช้ `free_text = name` (ต้องจับคู่ตอนรับตาม CR-143) · `review_status = approved` |
| `status` | เริ่มที่ `verifying` | M6 อนุมัติแล้ว ไม่ต้องผ่าน `pending_review` |
| `logistics` | ไม่ใส่ | `logistics` บังคับเฉพาะ `channel = public` |
| `expires_at` | ไม่ตั้ง หรือ worker `donation_status` ข้าม channel `m6` | ของระหว่างขนส่งอาจเกิน TTL 72 ชม. |
| `tracking_token_hash` / `booking_ref` | `booking_ref` = `request_code` · ไม่มี tracking token | ไม่มีหน้าติดตามสำหรับ donor |

**Invariant ใหม่:**
- `channel = m6` → ต้องมี `external.system = m6`
- 1 `request_code` = donation ไม่เกิน 1 ใบ: ใช้ `_id` deterministic `donation:m6-{request_code}` เพื่อให้ worker สร้างซ้ำได้ปลอดภัย (ดู D5)

**การยืนยันกลับ (RES-007):**
- **เงื่อนไข:** donation `m6` เปลี่ยนเป็น `received` โดยปิดครบทุกจุด หรือ staff ปิดใบ
- **payload:** `received_by = [{name, username}]` ของผู้รับคนสุดท้าย และ `note` = สรุป `received_summary.shortfalls` / รายการที่ไม่รับ (ถ้าไม่มีให้ใส่ "รับครบ")
- **error:**
  - `request_not_in_transit` → ถือว่าสำเร็จถ้า RES-006 บอกว่า `received` อยู่แล้ว
  - error อื่น → เก็บ `confirm_error` และ retry แบบ backoff
  - UI แสดง "ยังยืนยันกับ M6 ไม่สำเร็จ" ในใบ donation

**Public plane:** donation `m6` ไม่ถูก project ไป `public_donations`, transparency และไม่นับใน `needs_open` (ดู D4)

### 6. API ใหม่

**FastAPI** (route ภายใน, Bearer `EXTERNAL_API_SECRET` เท่านั้น, ไม่เปิดผ่าน nginx):

| Method | Path | เรียก M6 |
|---|---|---|
| GET | `/v1/integrations/status` | ตรวจ token ใน cache |
| GET | `/v1/integrations/m6/warehouses` | RES-001 |
| GET | `/v1/integrations/m6/warehouses/{code}/stock?type_code=&search=` | RES-002 |
| GET | `/v1/integrations/m6/catalog/search?q=&type_code=&warehouse_code=&cursor=` | RES-003 |
| POST | `/v1/integrations/m6/withdrawals` (body + `shelter_code`) | RES-005 → upsert `m6_withdrawals` |
| GET | `/v1/integrations/m6/withdrawals?shelter_code=&status=` | อ่านจาก Mongo |
| GET | `/v1/integrations/m6/withdrawals/{request_code}?shelter_code=` | RES-006 สด แล้วอัปเดต Mongo |
| POST | `/v1/integrations/m6/withdrawals/{request_code}/cancel` | RES-008 |

**BFF:**
- `GET /api/back-office/integrations/status`
- `GET /api/back-office/central-warehouse/{warehouses,warehouses/[code]/stock,catalog}`
- `GET|POST /api/back-office/central-warehouse/withdrawals`
- `GET /api/back-office/central-warehouse/withdrawals/[code]`
- `POST /api/back-office/central-warehouse/withdrawals/[code]/cancel`

**การแปลง error ของ M6 ที่ FastAPI:**

| M6 | FastAPI ตอบ |
|---|---|
| `item_not_in_warehouse` / `unit_mismatch` (มี `expected_unit`) / `reference_not_found` | `422` + code เดิม |
| `resource_type_not_allowed` / 403 อื่น | `403 M6_FORBIDDEN` ไม่ retry |
| `request_not_cancellable` | `409` |
| `stock_insufficient` / `insufficient_available` | `409` |
| `withdrawal not found` / `warehouse … not found` | `404` |
| 401 | ต่ออายุแล้วลองซ้ำ 1 ครั้ง |
| `invalid_client` | `503 M6_CREDENTIAL_INVALID` และเปิด circuit |
| timeout / 5xx | `503 M6_UNAVAILABLE` |

### 7. Mongo (FastAPI เป็นเจ้าของ)

- **`m6_withdrawals`** key = `external_ref`
  - เก็บ `shelter_code`, `request_code`, `source_warehouse_code`, `status`, `lines[]` (`item_code`, `name`, `unit`, `qty`, `qty_fulfilled`), `reason`, `requested_by`, `submitted_at`, `approved_at`, `completed_at`, `cancel_reason`, `donation_id`, `fetched_at`
- **`m6_outbound_logs`**
  - เก็บทุกการเรียก M6: `endpoint`, `ref`, HTTP status, `error`, `at`, `actor`
  - ไม่เก็บ payload
- **`m6_confirm_outbox`**
  - worker เขียน, FastAPI ใช้งาน
  - เก็บ `request_code`, `donation_id`, `received_by`, `note`, `attempts`, `last_error`, `done_at`

## เรื่องที่ต้องตัดสิน (ก่อน approve)

- **D1 — จุดที่สร้าง donation:**
  - (a) ตอน `in_transit` ← **แนะนำ** (เหตุผลในหัวข้อ 1)
  - (b) ตอน `approved` แล้วแก้จำนวนตอน `in_transit` (ต้องยกเว้นกฎ CR-196)
- **D2 — สิทธิ์:** ใครดูคลังกลาง ขอเบิก และยกเลิกได้ เช่น `shelter_manager` อย่างเดียว หรือรวม role ฝ่ายคลังของศูนย์ (ต้องแก้ `role-permission-matrix.md`) และควรมีขั้นอนุมัติภายในศูนย์ก่อนส่ง M6 หรือไม่
- **D3 — การจับคู่ของ M6 กับ `item_master`:**
  - (a) จับจาก `item_master.sku` = `item_code` แล้วให้ staff จับคู่ `free_text` ตอนรับ (ใช้ flow เดิม ไม่ต้องสร้างตารางใหม่) ← **แนะนำสำหรับรอบแรก**
  - (b) สร้างตาราง mapping ถาวร (`item_master.m6_reference_id`) ซึ่งเป็น catalog alignment CR ที่ ADR-0002 รอไว้
- **D4 — Public plane:** donation `m6` ไม่ขึ้น transparency และไม่นับใน needs ← **แนะนำ** หรือแสดงแยกเป็น "ของจากคลังกลาง"
- **D5 — รายละเอียด schema:**
  - `donor.phone_hash` เป็น req ใน §2.3 จะให้ว่างหรือใช้ค่าคงที่
  - `_id` แบบ deterministic `donation:m6-{request_code}` ขัดกับ pattern `donation:{ulid}` หรือไม่ ทางเลือกคือ ulid + unique check ผ่าน `m6_withdrawals.donation_id`
- **D6 — ผลการตรวจของทีม M6** (Integration Guide v3.1 ขัดกันเอง):
  1. RES-008 บอกว่าไม่รับ body แต่ dictionary บังคับ `cancelled_by.name` + `reason` และตัวอย่างสะกดเป็น `Cancelled_by`
  2. RES-007 `received_by` เป็น Array หรือ object
  3. RES-005 ตัวอย่างขาด `destination.address`, `requester.location_name` และ `contact_role` ที่ระบุว่าบังคับ
  4. qty ใน response เป็น int หรือ float (`20.0`)
  5. M6 มีแผนทำ webhook แทน polling หรือไม่
  6. key ใบเดียวของ tent ใช้ขอเบิกแทนหลายศูนย์ได้หรือไม่ (M6 ต้องแยกศูนย์จาก `requester.location_code`)

## นอก scope (CR แยกถ้าต้องการ)

- **RES-004 ฝากของเข้าคลัง M6:** เช่น ส่งต่อของบริจาคส่วนเกินของศูนย์ไปคลังกลาง ต้องใช้ scope `goods-in` / `catalog-write`
- **RES-009–016 เปิดคลังและจัดการบุคลากร:** เช่น ให้ศูนย์เปิดคลังชั่วคราวใน M6 RES-011 ส่ง `national_id`, เบอร์ และที่อยู่ของ staff ออกไป M6 จึงเป็นประเด็น PDPA ที่ต้องตัดสินแยก

## Impact

- **docs:**
  - `schema.md` §2.3 (`channel`, `external`, invariant, `schema_v` 12) และ §9 (Mongo 3 collection)
  - `api-contract.md`
  - `role-permission-matrix.md` (D2)
  - `sitemap.md`
  - ADR-0002 (outbound) หรือ ADR-0003 ร่วมกับ M5
- **backend:**
  - `integrations_m6`: client (httpx), token + refresh, cache, poller, outbox consumer, router, schemas
  - integrations status ร่วม
  - tests mock M6 ครบ error ในหัวข้อ 6
- **worker:**
  - loop `m6_withdrawals` → donation (idempotent)
  - loop donation `m6` received → outbox
  - `donation_status` ข้าม channel `m6`
- **frontend:**
  - feature ใหม่ `central-warehouse` (domain / data / application / ui ตาม CONVENTIONS)
  - route ใหม่
  - `donations` reader รับ v12 และ `channel: m6`
  - UI รายการ donation และหน้า scan แสดงที่มา "คลังกลาง M6 · {คลัง}" และสถานะการยืนยันกับ M6
- **ops:** credential staging และ production แยกกัน และต้องผ่านการทดสอบบน staging ก่อนตามที่ M6 กำหนด

## Migration

- donation `schema_v` 11 → 12 เป็น additive (ค่า enum `channel` ใหม่ + field `external`)
- doc เดิมไม่ต้อง backfill
- reader ที่ไม่รู้จัก `m6` ต้องไม่ล้ม: deploy reader v12 ก่อน แล้วจึงเปิด worker loop และ M6 env

## Decision log

- 2026-11-10 — proposed (ร่างจาก M6 Integration Guide v3.1 เทียบกับ flow donation และสต็อกปัจจุบัน; รอ D1–D6)
