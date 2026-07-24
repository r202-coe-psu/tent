---
title: Smart Shelter — Database Schema v4
status: draft for review
created: 2026-06-11
updated: 2026-07-24
note: field-level canonical — คู่กับ data-model.md (topology/policy) และ api-contract.md (planes)
---

# Database Schema v4 — field-level

Canonical ระดับ field ของทุก doc type. Zod schema ฝั่ง client และ `validate_doc_update` ฝั่ง
CouchDB ต้อง generate/เขียนให้ตรงกับเอกสารนี้

**สัญลักษณ์:** `req` = บังคับตอนสร้าง · `opt` = เติมทีหลังได้ · `sys` = ระบบเติม
**ชนิด:** `str`, `int`, `num`, `bool`, `ts` (ISO-8601 UTC), `enum(...)`, `T|null`, `[T]`, `{...}`,
`qty_str`

### `qty_str` — transactional quantity (CR-038)

JSON **string** matching `^-?\d+(\.\d{1,4})?$` (≤4 fractional digits). Persist via Decimal
`toDecimalPlaces(4)` (`$lib/utils/qty` → `persistQty`). Never store transactional qty as a JSON
`number` (IEEE-754). Ledger `qty` is always in `item_master.base_unit`. Client sums balances with
Decimal — do not rely on CouchDB `_sum` of floats for correctness.

## 0. Common envelope (ทุก doc ทุก db)

| Field | ชนิด | ใคร | หมายเหตุ |
| --- | --- | --- | --- |
| `_id` | str | client | `"{type}:{ulid}"` — ULID upper 26 ตัว; ข้อยกเว้นระบุราย type |
| `_rev` | str | CouchDB | MVCC |
| `type` | str | client | discriminator — ตรงกับชื่อ type ในเอกสารนี้ |
| `schema_v` | int | client | เวอร์ชัน schema ของ type นั้น เริ่ม `1` |
| `shelter_code` | str | client | code ของ shelter (เช่น `SH001`) — ใส่ทุก doc ใน `shelter_{shelter_code}` (ใช้ตรวจ doc หลง db) |
| `created_at` / `updated_at` | ts | client | append-only types: สองค่านี้เท่ากันเสมอ |
| `created_by` | str | client | `_users` name ของผู้สร้าง |

---

## 1. DB `shelter_{shelter_code}` — People

### 1.1 `evacuee` — `evacuee:{ulid}`

> **schema_v 3** — `current_stay.status` เปลี่ยนจาก 4 ค่าเป็น 6 ค่า: `pre_registered`,`active`,
> `temporary_leave`,`transferred`,`checked_out`,`deceased` (UI v5, CR-035).
> `special_needs` เปลี่ยนจาก fixed enum เป็น free-form `[str]` (6).
> schema_v 2 — เพิ่ม `country` (CR-007) และปรับปรุง `national_id` เป็น `person_id` (CR-028).

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `first_name` | str | req | ตัดช่องว่างหัวท้าย; ห้าม empty |
| `last_name` | str | req | — |
| `gender` | enum(`male`,`female`,`other`) | req | — |
| `phone` | str\|null | req | UI บังคับกรอก — กด/พิมพ์ "ไม่มี" → เก็บ `null`; เก็บ normalize แล้ว (ตัวเลขล้วน เช่น `"0812345678"`) |
| `nickname` | str | opt | — |
| `birth_year` | int | opt | พ.ศ. 4 หลัก |
| `person_id` | {`cardType`:enum(`national_id`,`passport`,`pink_card`,`other`), `number`:str\|null} | opt | เอกสารแสดงตน — `cardType` default `"national_id"`; `number` คือเลขที่บัตร (opt); เก็บ plaintext ไม่ออก public tier ทุกกรณี |
| `religion` | enum(`buddhist`,`muslim`,`christian`,`other`,`unknown`) | opt | ใช้วางแผนอาหาร halal |
| `country` | str | req | ประเทศ | 
| `special_needs` | [str] | opt | free-form, nonempty หลัง trim; default `[]` (CR-046 — เดิม fixed enum; ไม่ผูก whitelist ในโค้ด, ไม่ใช่ master_data-wired — รอ CR แยกถ้าจะ wire ไป master_data) |
| `emergency_contact` | {`name`:str, `phone`:str, `relation`:str} | opt | — |
| `household_id` | str\|null | opt | → `household:{ulid}` |
| `current_stay` | {`status`, `zone`, `since`} | req | `status`: enum(`pre_registered`,`active`,`temporary_leave`,`transferred`,`checked_out`,`deceased`) เริ่ม `pre_registered` · `zone`: str\|null · `since`: ts — snapshot เท่านั้น ความจริง = movement |
| `privacy` | {`search_excluded`:bool} | req | default `{search_excluded:false}` (opt-out model) |
| `registered_via` | enum(`app`,`import`,`paper`) | req | — |
| `anonymized` | bool | sys | default ไม่มี field; purge job ตั้ง `true` พร้อมล้าง PII (§retention data-model §7) |

**Index:** `(last_name, first_name)` · `(phone)` · `(household_id)` · `(current_stay.status)`

**Migration (schema_v 2 → 3):** rename บน read — `registered`→`pre_registered`, `checked_in`→`active`;
`checked_out` เดิม (ออกทั่วไป) → `checked_out` ใหม่ (กลับภูมิลำเนา) ชั่วคราวจนกว่า manual review แยก
เคสที่ควรเป็น `transferred`; ไม่มี legacy value map ไป `temporary_leave`/`deceased` (เกิดจาก movement
action ใหม่เท่านั้น). `special_needs` (CR-046) ไม่ต้อง rename/transform — ค่า enum เดิม (เช่น
`"elderly"`) เป็น subset ของ "any nonempty string" อ่านผ่านได้ตรง ๆ

### 1.2 `medical` — `medical:{ulid}` (1 doc ต่อ 1 evacuee)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `evacuee_id` | str | req | unique ต่อ evacuee — บังคับใน validate (สร้างซ้ำ = forbidden) |
| `blood_group` | enum(`A`,`B`,`AB`,`O`,`unknown`) | opt | — |
| `conditions` | [str] | opt | โรคประจำตัว free-text รายตัว |
| `medications` | [str] | opt | — |
| `allergies` | [str] | opt | — |
| `track` | enum(`normal`,`fast_track`) | req | default `normal` — sync กับผล screening ล่าสุด |
| `notes` | str | opt | — |

**Index:** `(evacuee_id)` · ทุก role อ่านได้ (ไม่มี masking) · purge ก่อนใครตามวงจร PDPA

### 1.3 `household` — `household:{ulid}`

> **schema_v 4** — เพิ่ม `status`, `checkout_destination` รองรับวงจรชีวิตครัวเรือน (check-in/out). CR-029.
> schema_v 3 — เพิ่ม `assets`, `vehicles[]` (หลายคัน), ขยาย `pets` (has_cage, image_url). CR-016.
> schema_v 2 — ลบ `zone` เดิม; เพิ่ม `municipality_zone` + `community` + ที่อยู่ flat 6 ฟิลด์. CR-011.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `label` | str | req | ชื่อเรียกครัวเรือน เช่น "บ้านสมชาย" |
| `head_evacuee_id` | str\|null | opt | หัวหน้าครัวเรือน |
| `status` | enum(`pre-registered`,`arriving`,`checked-in`,`checked-out`,`cancelled`) | req | สถานะครัวเรือน — default `'arriving'` (ลงทะเบียนทั่วไป) หรือ `'pre-registered'` (จองล่วงหน้า) |
| `checkout_destination` | {`type`:enum(`returned_home`,`transferred_shelter`,`referred_facility`,`other`), `destination_name`:str?, `notes`:str?} \| null | opt | ปลายทางหลังเช็คเอาต์ — บังคับเมื่อ `status = 'checked-out'` |
| `municipality_zone` | str\|null | opt | เขตเทศบาล เช่น `"zone_1"` — code จาก `master_data:municipality_zone` |
| `community` | str\|null | opt | ชุมชน เช่น `"z1_c16"` — code จาก `master_data:community` (filter by zone) |
| `pets` | [{`species`:enum(`dog`,`cat`,`bird`,`other`), `count`:int, `notes`:str?, `has_cage`:bool?, `image_url`:str?}] | opt | default `[]` — แสดงเฉพาะเมื่อ shelter `feature_flags.allow_pets = true` |
| `assets` | {`description`:str, `image_url`:str\|null} \| null | opt | ทรัพย์สินมีค่า/สัมภาระ — แสดงเฉพาะเมื่อ `feature_flags.allow_assets = true` |
| `vehicles` | [{`type`:enum(`car`,`motorcycle`,`other`), `license_plate`:str\|null}] | opt | default `[]` — รายการยานพาหนะ (หลายคันได้) แสดงเฉพาะเมื่อ `feature_flags.allow_vehicles = true` |
| `notes` | str | opt | — |
| `address_no` | str\|null | opt | บ้านเลขที่ เช่น `"123/45"` |
| `village_no` | str\|null | opt | หมู่ที่ / ตรอก / ซอย / ถนน เช่น `"หมู่ 2"` |
| `subdistrict` | str\|null | opt | ตำบล / แขวง เช่น `"หาดใหญ่"` |
| `district` | str\|null | opt | อำเภอ / เขต เช่น `"หาดใหญ่"` |
| `province` | str\|null | opt | จังหวัด เช่น `"สงขลา"` |
| `postal_code` | str\|null | opt | รหัสไปรษณีย์ เช่น `"90110"` |

สมาชิก = evacuee ที่ `household_id` ชี้มา (ทางเดียว — ไม่เก็บ list สมาชิกใน household กัน conflict)

**Migration (schema_v 1 → 2):** ลบ `zone`; field ใหม่ทั้งหมด optional → doc เดิมไม่ต้อง backfill.
**Migration (schema_v 2 → 3):** `assets`/`vehicles` optional/default-empty — doc เดิมไม่ต้อง backfill; ไม่มีข้อมูล production ณ วันที่ bump จึง ignore `vehicle` เดี่ยว (ถ้ามี) แล้วเริ่มต้น `vehicles: []`.
**Migration (schema_v 3 → 4):** lazy read-on-open — doc ที่ไม่มี `status` ได้ `status: 'checked-in'` (สมมติอยู่ในศูนย์แล้ว); `checkout_destination` default `null`; ไม่ต้อง backfill batch

### 1.4 `movement` — `movement:{ulid}` · **append-only**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `evacuee_id` | str | req | — |
| `action` | enum(`check_in`,`check_out`,`transfer_out`,`transfer_in`,`leave_temporary`,`return_from_leave`,`mark_deceased`) | req | ผลต่อ `current_stay.status`: `check_in`/`transfer_in`→`active` · `check_out`→`checked_out` · `transfer_out`→`transferred` · `leave_temporary`→`temporary_leave` · `return_from_leave`→`active` · `mark_deceased`→`deceased` (terminal, ไม่มี action ย้อนกลับ) |
| `zone` | str\|null | opt | โซนที่เข้า (check_in) |
| `destination` | {`kind`:enum(`home`,`shelter`,`hospital`,`other`), `shelter_code`:str?, `detail`:str?} | opt | ใช้กับ check_out / transfer_out |
| `reason` | str | opt | — |
| `occurred_at` | ts | req | เวลาเหตุการณ์จริง (ไม่ใช่เวลา sync) |

**Index:** `(evacuee_id, occurred_at)` · view `occupancy`

### 1.5 `screening` — `screening:{ulid}` · **append-only**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `evacuee_id` | str | req | — |
| `symptoms` | [str] | opt | default `[]` |
| `temperature_c` | num\|null | opt | — |
| `track` | enum(`normal`,`fast_track`) | req | ผลการคัดแยกครั้งนี้ |
| `needs_referral` | bool | req | default `false` |
| `notes` | str | opt | — |
| `screened_at` | ts | req | — |

**Index:** `(evacuee_id, screened_at)` · view `latest_screening`

---

## 2. DB `shelter_{shelter_code}` — Operations

### 2.1 `stock_ledger` — `stock_ledger:{ulid}` · **append-only**

> **schema_v 2** — `qty` เป็น `qty_str` (ไม่ใช่ JSON number). CR-038.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `item_id` | str | req | → `item_master:{sku\|ulid}` ใน catalog |
| `qty` | qty_str | req | **signed**: + รับเข้า / − จ่ายออก; ≠ 0; ใน `base_unit` |
| `unit` | str | req | ต้องตรงกับ `item_master.base_unit` |
| `reason` | enum(`receive`,`distribute`,`requisition`,`adjust`,`transfer_out`,`transfer_in`,`donation`) | req | — |
| `ref_id` | str\|null | opt | doc ต้นเหตุ (donation/transfer/requisition) |
| `lot` | {`expiry`:ts?, `note`:str?} | opt | ของหมดอายุได้ (อาหาร/ยา) |
| `occurred_at` | ts | req | — |

**Index:** `(item_id, occurred_at)` · `(reason)` · `stock_balance` = **client** Decimal sum ของ `qty` ต่อ item (อย่าพึ่ง CouchDB `_sum` ของ float/string)

**Migration (schema_v 1 → 2):** pre-prod — wipe/re-seed; ไม่มี dual-read บังคับ

### 2.2 `stock_transfer` — `stock_transfer:{ulid}` · state machine (forward-only)

> **schema_v 2** — `items[].qty` เป็น `qty_str`. CR-038.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `from_shelter` / `to_shelter` | str | req | shelter_code (เช่น `SH001`) — doc เกิดฝั่งต้นทาง replicate ผ่าน central |
| `items` | [{`item_id`:str, `qty`:qty_str>0, `unit`:str}] | req | ≥1 รายการ |
| `status` | enum(`requested`,`shipped`,`received`,`cancelled`) | req | forward-only: received > shipped > requested; cancelled ได้ก่อน shipped เท่านั้น |
| `timeline` | {`requested`:{at,by}, `shipped`:{at,by}?, `received`:{at,by}?} | req/sys | เติมตาม transition |
| `notes` | str | opt | — |

แต่ละ transition เขียน `stock_ledger` คู่: shipped → `transfer_out` (−) ฝั่งต้นทาง; received → `transfer_in` (+) ฝั่งปลายทาง

### 2.3 `donation` — `donation:{ulid}` · state machine

> **schema_v 3** — `items[].qty` เป็น `qty_str`. CR-038.
> schema_v 2 — เพิ่ม `donor.line_id`/`donor.email` (optional), `items[].category`/`condition`/`note`, `booking_ref`, และ `logistics{}` (วิธีส่ง/ยานพาหนะ/slot/eta/courier tracking) รองรับ public donation + queue booking flow ของหน้า `/donate`. CR-005 §F (DN-2/DN-6/DN-7). ใบอนุโมทนา/ลดหย่อนภาษี (DN-3) **ระบบไม่รองรับ** — ไม่มี `tax_receipt_requested`. field-level canonical ของ [Donation & Queue Booking spec](../features/public-tier-donation-spec.html).

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `channel` | enum(`public`,`walk_in`) | req | `public` = มาจาก /public/v1 (`/donate`) |
| `donor` | {`name`:str, `phone`:str\|null, `phone_hash`:str, `line_id`:str\|null, `email`:str\|null} | req | PII ลบตาม retention — เหลือ `phone_hash`; `line_id`/`email` optional (DN-2) ลบพร้อม PII; ไม่ echo `phone`/`phone_hash` สู่ public |
| `kind` | enum(`items`,`money`) | req | — |
| `items` | [{`item_id`:str?, `free_text`:str?, `category`:str?, `qty`:qty_str>0, `unit`:str, `condition`:str?, `note`:str?}] | kind=items | `item_id` หรือ `free_text` อย่างใดอย่างหนึ่ง; `item_id` → `item_master:{sku\|ulid}`; `category` = ป้าย label จาก `item_category`; `condition` เช่น "ของใหม่ 100%" (public donor กรอกเอง) |
| `amount_thb` | num>0 | kind=money | — (เงินอยู่นอกขอบเขต CR-038; ระบบเป้าไม่เก็บเงิน — ลบเป็น CR แยกถ้าต้องการ) |
| `campaign_id` | str\|null | opt | → `donation_campaign:{ulid}` |
| `logistics` | {`delivery_method`:enum(`self_dropoff`,`parcel`,`shelter_pickup`), `vehicle`:enum(`motorcycle`,`car`,`pickup`,`truck`)?, `slot`:{`date`:str, `from`:str, `to`:str}?, `eta`:ts?, `courier_tracking_no`:str\|null, `pickup_address`:str?} | opt | **req เมื่อ `channel=public`**; `slot` ชี้ `donation_slot` (§2.13, deterministic ต่อ วัน+เวลา); `vehicle` เฉพาะ self_dropoff/shelter_pickup; `eta` = ต้น slot ที่จอง; `courier_tracking_no` donor เติม/แก้ภายหลังผ่าน ticket (DN-6); `pickup_address` ใช้เมื่อให้ศูนย์ไปรับ (CR-010) |
| `status` | enum(`declared`,`received`,`expired`,`cancelled`) | req | forward-only; `declared`→`expired` โดย job เมื่อพ้น TTL |
| `booking_ref` | str | sys | รหัสอ่านออก เช่น `DN-306892` — แสดง/พิมพ์บนตั๋วเพื่อแปะลงของ; **unique** |
| `tracking_token_hash` | str | sys | SHA-256 ของ token — **ไม่เก็บ token ตรง**; public service lookup/แก้ (PATCH) ด้วย hash |
| `declared_at` / `received_at` | ts / ts\|null | req/sys | — |
| `expires_at` | ts | sys | `declared_at` + `config.donation_reservation_ttl_hours` (default 72) |

**Index:** `(status)` · `(tracking_token_hash)` · `(booking_ref)` · `(campaign_id)` · `(logistics.slot.date)`

**Migration (schema_v 1 → 2):** field ใหม่ทั้งหมด optional/sys → doc เดิมไม่ต้อง backfill; reader ถือว่าไม่มี `logistics`/`line_id`/`email`/`booking_ref` = walk_in เดิม. public donation ใหม่ทุกใบเขียนเป็น schema_v 2 (มี `logistics` + `booking_ref`).
**Migration (schema_v 2 → 3):** pre-prod — wipe/re-seed; `items[].qty` จาก num → qty_str

### 2.4 `donation_campaign` — `donation_campaign:{ulid}`

> **schema_v 3** — `needs[].qty_target` เป็น `qty_str`. CR-038.
> schema_v 2 — เพิ่ม `needs[].status` (enum(`open`,`closed`), default `"open"`) และ `visible_on_home` (bool, default `true`). CR-034.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `title` | str | req | — |
| `needs` | [{`item_id`:str, `qty_target`:qty_str>0, `unit`:str, `status`:enum(`open`,`closed`)?}] | req | ≥1 — `status` default `"open"` |
| `status` | enum(`open`,`closed`) | req | — |
| `visible_on_home` | bool | opt | default `true` — ควบคุมการโปรโมตแคมเปญบนหน้าแรก (back-office toggle) |
| `opens_at` / `closes_at` | ts / ts\|null | opt | — |
| `notes` | str | opt | — |

view `needs_open` = `needs` − donation(declared+received ของ campaign) → /public/v1/needs

**Migration (schema_v 2 → 3):** pre-prod — wipe/re-seed; `qty_target` num → qty_str

### 2.5 `meal_plan` — `meal_plan:{date}:{meal}` (deterministic — 1 doc/วัน/มื้อ)

> **schema_v 2** — เพิ่ม `calc_source` (audit trail ของการคำนวณ ingredient จาก SOP ratio). CR-025.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `date` | str | req | `YYYY-MM-DD` (เวลาท้องถิ่นศูนย์) |
| `meal` | enum(`breakfast`,`lunch`,`dinner`,`snack`) | req | — |
| `headcount` | {`total`:int, `halal`:int, `soft_food`:int, `infant`:int} | req | มาจาก occupancy (T-06) — ดู mapping ด้านล่าง; แก้ manual ได้; แต่ละ sub-count ≤ total (มิติตั้งฉาก บวกกันไม่ได้) |
| `recipes` | [{`recipe_id`:str, `planned_qty`:int>0}] | req | qty = ปริมาณวัตถุดิบต่อมื้อ (หน่วยตาม recipe_id เช่น `ingredient:rice` = กรัม); T-26 map เป็น item_id |
| `status` | enum(`draft`,`confirmed`) | req | — |
| `override_reason` | str\|null | opt | **บังคับ** เมื่อ headcount ต่างจาก occupancy snapshot ล่าสุด (CR-022) |
| `calc_source` | {`sop_profile_id`:str, `sop_profile_version`:int>0, `headcount_as_of`:ts}\|null | opt | audit trail — SOP profile + version + snapshot เวลาอ่าน headcount ที่ใช้คำนวณ |

**Headcount source — occupancy mapping (CR-022):** derive จาก evacuee ที่ `current_stay.status = 'active'` —
`total` = จำนวนทั้งหมด, `halal` = `religion = 'muslim'`, `infant` = `special_needs` มี `'infant'`,
`soft_food` = `special_needs` มี ∈ {`bedridden`,`chronic_illness`,`elderly`}. sub-count เป็นมิติตั้งฉาก
(คนหนึ่งเป็นได้หลายกลุ่ม) → บวกกันเกิน total ได้ แต่แต่ละช่อง ≤ total. **Handoff T-26:** แต่ละ `recipe`
→ stock item (`ingredient:rice` → `item:rice`) เป็น `kitchen_requisition` input, `qty_issued` เริ่ม 0.
`planned_qty` เก็บเป็นกรัม (ความละเอียดที่ต้องใช้คำนวณ SOP ratio) แต่ `toRequisitionInput` **แปลงเป็น
`kg` ก่อนส่งต่อ** — `kitchen_requisition.items[].unit` และ `stock_ledger.unit` ที่ตัดจริงต้องเป็น `kg`
เสมอ ตามกฎ §2.1 (`unit` ต้องตรงกับ `item_master.base_unit`; `item:rice.base_unit = kg`) (CR-030)

`_id` deterministic → กันสร้างแผนซ้ำมื้อเดียวกันสอง device (ชนเป็น conflict ให้ resolve ไม่ใช่ doc ซ้ำ)

**Migration (schema_v 1 → 2):** `calc_source` optional → doc เดิมไม่ต้อง backfill; reader ถือว่าไม่มี `calc_source` = แผนที่สร้างก่อนมี audit trail

### 2.6 `kitchen_requisition` — `kitchen_requisition:{ulid}` · **append-only**

> **schema_v 2** — `qty_requested` / `qty_issued` เป็น `qty_str`. CR-038.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `meal_plan_id` | str\|null | opt | เบิกนอกแผนได้ |
| `items` | [{`item_id`:str, `qty_requested`:qty_str>0, `qty_issued`:qty_str≥0, `unit`:str}] | req | `qty_issued` < requested = เบิกบางส่วน (ของไม่พอ) |
| `ledger_ids` | [str] | sys | `stock_ledger` (reason=`requisition`, qty ลบ) ที่เกิดจากใบนี้ |
| `issued_at` | ts | req | — |

**Migration (schema_v 1 → 2):** pre-prod — wipe/re-seed

### 2.7 `meal_service` — `meal_service:{date}:{meal}` (deterministic) · **append-only**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `date` / `meal` | str / enum | req | คู่กับ meal_plan |
| `served` | int≥0 | req | เสิร์ฟในศูนย์ |
| `waste` | int≥0 | req | เหลือทิ้ง |
| `external` | {`volunteers`:int≥0, `outside_evacuees`:int≥0} | req | แจกนอกศูนย์ (ตาม source Module D) |
| `notes` | str | opt | — |

view `meals_served` + เทียบ plan vs actual ต่อวัน

### 2.7.1 `gas_cylinder_type` — `gas_cylinder_type:{ulid}` · **schema_v 2**

> **schema_v 2** — `capacity_kg` / `burn_rate_kg_per_hour` / `time_multiplier` เป็น `qty_str`. CR-038.
> schema_v 1 — reference data สำหรับคำนวณเวลา/ปริมาณการใช้แก๊สหุงต้ม (LPG) ในครัว. CR-025 (ต่อยอด CR-003 T-56). mutable — LWW ผ่าน `touch()`.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | เช่น "เตาแรงดันสูง + ถัง 15kg" |
| `capacity_kg` | qty_str>0 | req | น้ำหนักแก๊สเติมต่อถัง (kg) |
| `burn_rate_kg_per_hour` | qty_str>0 | req | อัตราสิ้นเปลือง (kg/ชม.) |
| `time_multiplier` | qty_str>0 | req | ตัวคูณเวลา; default `"1"` |

**Migration (schema_v 1 → 2):** pre-prod — wipe/re-seed

### 2.8 `volunteer` — `volunteer:{ulid}`

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `first_name` / `last_name` | str | req | — |
| `nickname` | str | opt | — |
| `phone` | str\|null | req | กติกาเดียวกับ evacuee ("ไม่มี" → null) |
| `skills` | [str] | opt | เช่น "พยาบาล", "ขับรถ", "ครัว" |
| `organization` | str\|null | opt | สังกัด |
| `status` | enum(`active`,`inactive`) | req | default `active` |
| `user_name` | str\|null | opt | ผูกกับ `_users` ถ้าอาสามี login |

### 2.9 `shift_assignment` — `shift_assignment:{ulid}`

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `volunteer_id` | str | req | — |
| `date` | str | req | `YYYY-MM-DD` |
| `shift` | enum(`morning`,`afternoon`,`night`) | req | — |
| `station` | str | req | จุดงาน เช่น "ครัว", "ประตูหน้า", "ทะเบียน" |
| `status` | enum(`assigned`,`done`,`no_show`,`cancelled`) | req | default `assigned` |

**Index:** `(date, shift)` · `(volunteer_id, date)`

### 2.10 `shelter_report` — `shelter_report:{ulid}` · state machine (forward-only) · **schema_v 1**

> **schema_v 1** — แทน `security_event` (append-only) ที่ยังไม่ implement. หน่วยหลัก = Report · แยกประเภทด้วย `kind`. [CR-040](../changes/CR-040-shelter-case-grievance-reframe.md). Flow: [shelter-report-flow.md](../features/shelter-report-flow.md)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `kind` | enum(`grievance`,`incident`) | req | grievance = ร้องเรียน/ร้องทุกข์; incident = เหตุที่ staff/SM บันทึก — **ห้าม** field ชื่อ `type` (ชน CouchDB `type`) |
| `category` | enum(`theft`,`violence`,`fire`,`intrusion`,`lost_person`,`pet_related`,`facility`,`food_service`,`staff_conduct`,`noise`,`privacy`,`other`) | req | whitelist |
| `severity` | enum(`info`,`warning`,`critical`) | req | ความเร่งด่วน / ความรุนแรง |
| `status` | enum(`open`,`in_progress`,`resolved`,`closed`,`escalated`) | req | forward-only — ดู transitions ด้านล่าง |
| `subject` | str | req | หัวข้อสั้น |
| `description` | str | req | รายละเอียด |
| `zone` | str\|null | opt | โซนที่เกี่ยวข้อง |
| `reporter` | `{ source: enum(evacuee,staff,anonymous,other), evacuee_id?:str, display_name?:str, contact?:str }` | req | ใครร้อง/ใครพบ |
| `evacuee_ids` | [str] | opt | ผู้เกี่ยวข้อง default `[]` |
| `pet_refs` | [{`household_id`:str, `pet_index`:int≥0}] | opt | อ้าง `household.pets[]` — ไม่ duplicate pet doc |
| `assignee_user_id` | str\|null | opt | Couch `_users` name |
| `actions` | [{`at`:ts, `by`:str, `note`:str}] | req | timeline — append เท่านั้น |
| `escalation` | `{ referral_id:str, reason?:str }\|null` | opt | เมื่อ `escalated` **ต้องมี** `referral_id` |
| `occurred_at` | ts | req | เวลาเกิดเหตุ / เวลาร้อง |
| `closed_at` | ts\|null | opt | ตั้งเมื่อ `resolved`/`closed` |

**Status transitions (forward-only):**

```
open → in_progress → resolved → closed
open → in_progress → escalated
open → resolved → closed
open → escalated
* ห้ามย้อนกลับ — แก้ผิด = เปิดรายงานใหม่ + อ้างรายงานเดิมใน description/actions
```

**Escalate (atomic กับ Module F):** สร้าง `referral` สำเร็จก่อน → ตั้ง `escalation.referral_id` + `status=escalated` — ห้าม `escalated` โดยไร้ `referral_id`

**Index:** `(status, occurred_at)` · `(severity, status)` · `(kind, status)` · `(assignee_user_id, status)`

**Migration:** ไม่มี `security_event` จาก production → ไม่ backfill; ห้ามสร้าง `security_event` ใหม่

### 2.11 `referral` — `referral:{ulid}` · state machine

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `evacuee_id` | str | req | — |
| `to_org` | {`name`:str, `kind`:enum(`hospital`,`social_services`,`other`), `contact`:str?} | req | — |
| `reason` | str | req | — |
| `urgency` | enum(`normal`,`urgent`) | req | — |
| `status` | enum(`draft`,`sent`,`accepted`,`rejected`,`closed`) | req | forward-only |
| `timeline` | {`sent`:{at,by}?, `responded`:{at,by}?, `closed`:{at,by}?} | sys | — |
| `notes` | str | opt | — |

### 2.12 `audit` — `audit:{ulid}` · **append-only**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `action` | enum(`duplicate_override`,`retro_edit`,`export`,`purge`,`conflict_resolved`,`manual_adjust`,`created`,`other`) | req | — |
| `target_type` / `target_id` | str / str | req | doc ที่ถูกกระทำ |
| `reason` | str | req | — |
| `context` | {} | opt | payload แล้วแต่ action (เช่น revision ที่แพ้ conflict) |
| `occurred_at` | ts | req | — |

### 2.13 `donation_slot` — `donation_slot:{date}:{from}` (deterministic) · DN-5

> เพิ่มใน CR-005 §F (DN-5) — รองรับ queue booking ("จองคิว") ของ public donation. **ศูนย์เป็นผู้ตั้งค่า slot เอง** (Donation module / back-office); หน้า public `/donate` อ่าน slot + ความจุที่เหลือ. `_id` deterministic ต่อ วัน+เวลาเริ่ม (shelter implicit จาก db) กันสร้าง slot ซ้ำสอง device.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `date` | str | req | `YYYY-MM-DD` (เวลาท้องถิ่นศูนย์) |
| `from` / `to` | str / str | req | `HH:mm` ช่วงเวลารับของ เช่น `09:00`–`10:00` |
| `capacity` | int>0 | req | จำนวนคิวสูงสุดต่อ slot — ศูนย์กำหนด |
| `status` | enum(`open`,`closed`) | req | default `open`; `closed` = งดรับ slot นี้ |
| `note` | str | opt | — |

ที่ว่าง = `capacity` − count(`donation` ที่ `logistics.slot` ตรงกัน และ `status` ∈ {`declared`,`received`}); เต็มหรือ `closed` → public แสดง "คิวเต็ม (งด)" + submit คืน `SLOT_FULL`

**Index:** `(date)` · `(date, from)` · view `slot_availability` (capacity − booked count ต่อ slot)

### 2.14 `sop_override` — `sop_override:{ulid}`

> **schema_v 2** — อัปเดต ratios whitelist 3 → 20 canonical keys (CR-006 amendment 2026-06-25 + CR-021). สร้างเฉพาะศูนย์ที่ต้องการใช้สัดส่วนทรัพยากรต่างจาก Master Profile ส่วนกลาง (ตาม [CR-006](../changes/CR-006-sop-profile-master-override.md) และ [CR-015](../changes/CR-015-sop-ratio-schema-two-tier.md))
> **Migration Note:** `schema_v` bumped due to CR-006 / CR-021. No production backfill needed. Devs must re-run the seed script (which now auto-overwrites) or delete stale catalog docs. **Breaking Change:** Legacy 3-key ratios (rice_g_per_person_meal, toilet_per_person) removed. All 20 canonical keys required; no auto-mapping from legacy keys. Devs must re-run seed or delete stale docs.
> schema_v 1 — สร้าง doc type ใหม่ สำหรับ per-shelter override (CR-006)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `shelter_code` | str | req | ศูนย์ที่เป็นเจ้าของ override (ตรงกับ session) |
| `base_profile_id` | str | req | อ้างอิง ID ของ `sop_profile` ที่เป็นต้นทางของการ override |
| `name` | str | req | เช่น "Override ช่วงฤดูร้อน" |
| `ratios` | {`water_l_per_person_day`:num, `drinking_water_l_per_person_day`:num, `cooking_water_l_per_person_day`:num, `hygiene_water_l_per_person_day`:num, `kcal_per_adult_day`:num, `people_per_tap`:num, `people_per_handpump`:num, `people_per_open_well`:num, `people_per_laundry`:num, `people_per_bathing`:num, `people_per_toilet_female`:num, `people_per_toilet_male`:num, `people_per_dining_point_adult`:num, `people_per_dining_point_child`:num, `m2_per_person_living`:num, `m2_per_person_living_cold`:num, `m2_per_person_total`:num, `max_waterpoint_distance_m`:num, `max_queue_minutes`:num, `people_per_volunteer`:num} | req | ratios ต้องระบุคีย์ครบถ้วน (Full Ratios Requirement) |
| `version` | int | req | — |
| `active` | bool | req | สลับใช้ profile นี้หากเป็น true |

### 2.15 `daily_calc` — `daily_calc:{date}` (deterministic — 1 doc/วัน/ศูนย์) · **schema_v 2**

> **schema_v 2** — เพิ่ม `ratio_source` + `sop_override_id` + `sop_override_version` สำหรับ drill-down T-32 ([CR-042](../changes/CR-042-daily-sop-calc-follow-up.md) OD-1=A). Pre-prod: wipe หรือ re-run on-demand — ไม่มี lazy migration.
> **schema_v 1** — baseline doc type ([CR-036](../changes/CR-036-daily-calc-doc-type.md)).
> Snapshot ผลการคำนวณทรัพยากรประจำวันของ engine T-31 (FR-45). `_id` deterministic ต่อวัน (`daily_calc:2026-07-08`) → **idempotent**: รันซ้ำวันเดียวกันเขียนทับ doc เดิม (ไม่สร้างซ้ำ). Input (occupancy, effective ratio, stock, shelter facilities/area ตาม hardcode map [CR-042](../changes/CR-042-daily-sop-calc-follow-up.md) OD-2=B) อ่านผ่าน barrel ของ peer feature เท่านั้น. ค่าทุกตัวถูก freeze ณ เวลาคำนวณ. ทับข้อมูลเดิม → เขียน `audit:{action:retro_edit}` **ก่อน** เขียนทับ. R3 runtime = **on-demand อย่างเดียว** (CR-042 OD-3=A).

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `formula_v` | str | req | เวอร์ชันสูตร (`FORMULA_V`) ที่ผลิตผลชุดนี้ — algorithm version ไม่ใช่ schema |
| `sop_profile_version` | int>0 | req | `version` ของ effective SOP profile (override active ?? master) ที่ใช้ ([CR-006](../changes/CR-006-sop-profile-master-override.md)) |
| `ratio_source` | enum(`master`,`override`) | req | ที่มาของ effective ratio ที่ freeze ใน snapshot ([CR-042](../changes/CR-042-daily-sop-calc-follow-up.md)) |
| `sop_override_id` | str\|null | req | `_id` ของ `sop_override` ที่ใช้; **ต้อง `null` เมื่อ `ratio_source=master`**; บังคับมีค่าเมื่อ `override` |
| `sop_override_version` | int\|null | req | `version` ของ override ที่ใช้; **ต้อง `null` เมื่อ `ratio_source=master`**; บังคับมีค่าเมื่อ `override` |
| `ratio_snapshot` | {str:num} | req | ratio ทุกคีย์ที่ freeze ตอนคำนวณ. คีย์ **generic string** (ไม่ผูก whitelist 20 keys — engine domain-agnostic); `{}` ว่างได้ |
| `occupancy_snapshot` | num≥0 | req | headcount ที่ `current_stay.status = active` (physically present, [CR-035](../changes/CR-035-evacuee-stay-status-v3-scan-check-in-out.md) stay-status v3) ณ เวลาคำนวณ |
| `as_of` | ts | req | ISO-8601 UTC ตอนจัดทำ snapshot (เวลาที่ freeze input — ต่างจาก `updated_at` ที่เป็นเวลาคำนวณล่าสุด) |
| `stock_snapshot` | {str:num\|null} | req | ยอดคงเหลือ/`have` ต่อ resource ตาม hardcode map; `null` = ไม่ sync / ไม่มี mapping |
| `results` | ResourceCalcResult[] | req | ผลรายแถว: `ordinal,key,kind,input_valid,ratio,need,have,gap,status,data_status,as_of` (T-31.1/31.3) |

> ใช้ envelope มาตรฐาน `BaseDoc` (`_id`,`type`,`schema_v`,`shelter_code`,`created_at`,`updated_at`,`created_by`). append หรือ overwrite เท่านั้น — ไม่ mutate in place.
> **Index:** `(_id)` (deterministic; `listRange` ใช้ bounded `startkey`/`endkey` = `daily_calc:{from}`..`daily_calc:{to}` ไม่สแกนทั้ง collection)

---

## 3. DB `registry` (central-managed → pull ลง device; edge fallback replica)

### 3.1 `shelter` — `shelter:{ulid}`

> **schema_v 4** — ขยาย shelter form v4/v5: structured address, project level, key personnel,
> zone area/specifics, admission/luggage/parking policy และ risk/common-area เพิ่มเติม. CR-023.
> **schema_v 3** — เพิ่ม `feature_flags` (allow_pets, allow_vehicles, allow_assets) ควบคุม step ลงทะเบียน. CR-016.
> schema_v 2 — `capacity` เพิ่มเป็น required, `status` enum(`open`,`closed`). CR-004.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `code` | str | sys | code ที่อ่านออก เช่น `SH001` — **unique**, immutable; central mint ตอน provisioning (จาก `central_ops` counter §5.3) เป็นชื่อ db `shelter_{code}` + ใช้อ้างข้ามศูนย์ทุกที่ (`shelter_code`). pattern `^SH\d{3,}$`: เลข 1–999 pad 3 หลัก (`SH001`), ≥1000 ความกว้างตามจริง (`SH1000`) |
| `name` | str | req | — |
| `operation_status` | enum(`standby`,`active`,`full_capacity`,`closed`) | req | default `standby`; ใช้แทน `status` เดิม |
| `capacity` | int>0 | req | จำนวนคนสูงสุด — ควรสอดคล้องกับ `area_m2` (Sphere ≥3.5 m²/คน); ผลรวม zone capacity ≤ ค่านี้ |
| `shelter_type` | str\|null | opt | code จาก `master_data:shelter_type` (ไม่ใช่ free text) |
| `project_level` | enum(`community`,`lao`,`provincial`)\|null | opt | ระดับศูนย์ |
| `location` | {`address`:str, `lat`:num?, `lng`:num?} | opt | คงไว้เพื่อ backward compatibility |
| `contact` | {`name`:str, `phone`:str} | opt | — |
| `municipality_zone` | str\|null | opt | code จาก `master_data:municipality_zone` |
| `community` | str\|null | opt | code จาก `master_data:community` |
| `address_no` | str\|null | opt | บ้านเลขที่ |
| `village_no` | str\|null | opt | หมู่/ซอย/ถนน |
| `subdistrict` | str\|null | opt | ตำบล/แขวง |
| `district` | str\|null | opt | อำเภอ/เขต |
| `province` | str\|null | opt | จังหวัด |
| `postal_code` | str\|null | opt | รหัสไปรษณีย์ |
| `key_personnel` | {`eoc_liaison`:{`name`:str\|null,`phone`:str\|null}?, `medical_lead`:{`name`:str\|null,`phone`:str\|null}?, `kitchen_lead`:{`name`:str\|null,`phone`:str\|null}?}\|null | opt | ผู้ประสานงานหลักของศูนย์ |
| `area_m2` | num≥0\|null | opt | พื้นที่ปิดรวม (m²) — ใช้คำนวณ m²/คน เทียบ Sphere 3.5 m² minimum; `null` = ยังไม่ได้วัด |
| `area_type` | enum(`indoor`,`outdoor`,`hybrid`)\|null | opt | ชนิดพื้นที่ |
| `facilities` | {`toilets_female`:int≥0?, `toilets_male`:int≥0?, `toilets_accessible`:int≥0?, `showers`:int≥0?, `water_points`:int≥0?, `handwashing_stations`:int≥0?, `car_toilet_accessible`:bool?, `car_toilet_supported`:int≥0?} | opt | นับจริงที่ศูนย์; ถ้า `car_toilet_accessible != true` ให้ถือ `car_toilet_supported = null` |
| `common_areas` | {`central_kitchen`:bool?, `helipad`:bool?, `parking_capacity`:int≥0?, `sub_storage`:[{`id`:str?, `name`:str, `type`:enum(`general`,`food_dry`,`drinking_water`,`medical_supplies`), `area_m2`:num≥0?}], `isolation_room`:bool?, `women_child_friendly_space`:bool?, `logistics_area_m2`:num≥0?} | opt | ข้อมูลพื้นที่ส่วนกลาง |
| `utilities` | {`power_source`:enum(`city_grid`,`generator`,`solar`)\|null, `water_source`:enum(`city_water`,`water_tank`,`groundwater`)\|null, `communications`:[enum(`cellular`,`wifi`,`vhf_radio`)], `vhf_channel`:str\|null} | opt | utility profile ของศูนย์ |
| `risk` | {`elevation_m`:num≥0?, `entrance_description`:str?, `constraints`:str?, `secondary_muster_point`:str?} | opt | ความเสี่ยงและข้อจำกัดเชิงกายภาพ |
| `zones` | [{`code`:str, `name`:str, `capacity`:int>0, `type`:enum(`general`,`male`,`female`,`vulnerable`,`pet`,`quarantine`), `status`:enum(`active`,`closed`), `closed_at`:ts\|null, `closed_by`:str\|null, `reopened_at`:ts\|null, `reopened_by`:str\|null, `reason`:str\|null, `area_m2`:num≥0?, `specifics`:str?}] | req | โครงสร้างโซน + state |
| `admission_policy` | {`supported_vulnerable_groups`:[str], `pet_policy`:{`policy`:enum(`no_pets`,`conditional`)\|null, `categories`:[{`category`:enum(`small_general`,`large_dog`,`livestock`), `conditions`:[str]?, `max_capacity`:int≥0?, `location`:str?, `other`:str?}]}} | opt | section นโยบายการรับผู้อพยพ/สัตว์ |
| `luggage_policy` | {`limitation`:enum(`no_limit`,`limited`)\|null, `max_per_family`:int≥0\|null, `rules`:[enum(`valuables_self_responsibility`,`no_hazardous_items`,`no_large_appliances`,`has_temp_storage_service`)], `rules_other`:str\|null} | opt | section นโยบายทรัพย์สิน/สัมภาระ |
| `parking_policy` | {`availability`:enum(`none`,`available`)\|null, `supported_vehicles`:[{`type`:enum(`motorcycle`,`car`,`truck`,`boat`), `max_capacity`:int≥0\|null}], `rules`:[enum(`no_liability`,`first_come_first_served`,`key_deposit_required`,`no_blocking_emergency_lane`,`ev_emergency_charging`)], `rules_other`:str\|null} | opt | section นโยบายยานพาหนะ |
| `feature_flags` | {`allow_pets`:bool, `allow_vehicles`:bool, `allow_assets`:bool} | opt | default ทุก flag = `false`; ตั้งตอนสร้างศูนย์โดย shelter_manager/SA — `true` = เปิดใช้ step นั้นในฟอร์มลงทะเบียน; doc เก่าที่ไม่มี field นี้ถือเป็น `false` ทุก flag (ไม่แสดง) |
| `edge_url` | str\|null | sys | base URL ของ LAN Edge fallback ศูนย์นั้น — ใช้เมื่อ WAN/central เข้าไม่ได้; ไม่ใช่ normal client remote |
| `opened_at` / `closed_at` | ts / ts\|null | sys | — |

**Migration (schema_v 3 → 4):** additive default-fill บน read/write — field ใหม่เติม `null`/`[]`/default object ตาม domain schema; `status` เดิม migrate เป็น `operation_status` (`open`→`active`, `closed`→`closed`).

### 3.2 `config` — `config:app` (singleton)

| Field | ชนิด | default | หมายเหตุ |
| --- | --- | --- | --- |
| `public_otp_required` | bool | `false` | risk-based — เปิดเมื่อโดน spam |
| `duplicate_hint_threshold` | num 0–1 | `0.8` | soft-match registration |
| `donation_reservation_ttl_hours` | int | `72` | — |
| `device_db_ttl_days` | int | `30` | อายุ local db บน device |
| `retention_months_after_close` | int | `3` | PDPA purge |
| `fam_search_max_results` | int | `10` | — |

---

### 3.3 `master_data` — `master_data:{master_type}` (deterministic 1 doc ต่อ type) · CR-012

> central-managed, pull ลง device; edge fallback replica. **SA only** write. ทุก authenticated role อ่านได้.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `master_type` | enum(7 type) | req | `vulnerable_group` \| `health_condition` \| `dietary_restrictions` \| `pet_types` \| `house_damage` \| `municipality_zone` \| `community` |
| `items` | [{`code`:str, `label`:str, `is_default`:bool, `parent_code`:str?}] | req | ≥1 item; `code` = lower_snake immutable; `parent_code` ใช้สำหรับ `community` → อ้างถึง `code` ของ `municipality_zone` item |

**Item shape:**
```ts
interface MasterDataItem {
  code: string;          // immutable slug, auto-generate จาก label (lower_snake / transliteration)
  label: string;         // Thai display, editable
  is_default: boolean;   // 1 item per type = true (enforce)
  parent_code?: string;  // community เท่านั้น — ref code ของ municipality_zone
}
```

**Seed data (Hat Yai):** ข้อมูล `municipality_zone` (4 เขต) และ `community` (102 ชุมชน) มาจาก [Wikipedia — เทศบาลนครหาดใหญ่](https://th.wikipedia.org/wiki/%E0%B9%80%E0%B8%97%E0%B8%A8%E0%B8%9A%E0%B8%B2%E0%B8%A5%E0%B8%99%E0%B8%84%E0%B8%A3%E0%B8%AB%E0%B8%B2%E0%B8%94%E0%B9%83%E0%B8%AB%E0%B8%8D%E0%B9%88); รายละเอียด seed ใน CR-012 Appendix A.

**Index:** `(master_type)` unique — 1 doc ต่อ type

---

### 3.4 `location_province` — `location_province:{province}` · **schema_v 1** (CR-037)

> ข้อมูลอ้างอิงเขตการปกครองไทย (จังหวัด/อำเภอ/ตำบล + รหัสไปรษณีย์). central-managed, pull ลง device;
> edge fallback replica. `_id` เป็น deterministic hierarchical key จาก natural name path → re-seed
> idempotent (ไม่ใช้ ULID). โมเดล MongoDB-style: doc ลูกอ้าง `_id` พ่อผ่าน field + Mango index.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | ชื่อจังหวัด (ภาษาไทย) |

### 3.5 `location_district` — `location_district:{province}:{district}` · **schema_v 1** (CR-037)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | ชื่ออำเภอ/เขต |
| `province` | str | req | ชื่อจังหวัดแม่ (denormalized, immutable) |
| `province_id` | str | req | `_id` ของ `location_province` แม่ (foreign key) |

### 3.6 `location_subdistrict` — `location_subdistrict:{province}:{district}:{subdistrict}` · **schema_v 1** (CR-037)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | ชื่อตำบล/แขวง |
| `province` | str | req | ชื่อจังหวัด (denormalized) |
| `district` | str | req | ชื่ออำเภอ (denormalized) |
| `district_id` | str | req | `_id` ของ `location_district` แม่ (foreign key) |
| `zipcode` | int | req | รหัสไปรษณีย์ 5 หลัก (10100–96220 — lossless เป็น number) |

**Seed:** `pnpm seed:thailand` (`frontend/scripts/seed-thailand-location.ts`, แยกจาก `pnpm seed` หลัก)
อ่าน `frontend/static/data/thailand_location_data.json` (7,426 ตำบล / 928 อำเภอ / 77 จังหวัด) → bulk
insert. Idempotent: `_id` เป็น deterministic → re-seed ไม่เกิด duplicate. BFF `/api/v1/thailand-location/*`
อ่านจากที่นี่.

**Index:** `(province_id)` — list อำเภอในจังหวัด · `(district_id)` — list ตำบลในอำเภอ

---

### 3.7 `shelter_import_log` — `shelter_import_log:{ulid}` · **schema_v 1** · **append-only** (CR-039)

Log 1 doc ต่อ 1 batch ของการ import ศูนย์พักพิงจาก Excel. envelope กลาง (ไม่มี `shelter_code` —
เป็น registry doc). เขียนหลัง commit เสร็จ; ไม่แก้ย้อนหลัง.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `source` | enum(`shelter`) | req | ชนิดข้อมูลที่ import (ตอนนี้มีแค่ shelter) |
| `filename` | str | req | ชื่อไฟล์ที่อัปโหลด |
| `imported_by` | str | req | `name` ของผู้ import (จาก session) |
| `total_rows` | int | req | จำนวนแถวข้อมูล (ไม่รวม header) |
| `success_count` | int | req | จำนวนศูนย์ที่สร้างสำเร็จ |
| `error_count` | int | req | จำนวนแถวที่ล้มเหลว (validation + server) |
| `results` | array | req | ผลราย row — ดูรูปด้านล่าง |
| `started_at` | str (ISO) | req | เวลาเริ่ม commit |
| `finished_at` | str (ISO) | req | เวลาเสร็จ |

`results[]`: `{ row: int, name: str|null, status: 'created'|'validation_error'|'server_error',
code?: str (เมื่อ created), errors?: [{ column: str, message: str }] }`

**เขียน/อ่าน:** system_admin เท่านั้น (เป็น member ของ registry). อ่านตรงจาก browser ผ่าน
`createRemoteRepository('registry')`; live-sync ผ่าน changes feed ของ registry (เหมือน `shelter`).

**Index:** ไม่ต้องมี secondary index — prefix scan `import_log:` ผ่าน `_all_docs` เพียงพอ.

---

## 4. DB `catalog` (central-managed → pull ลง device; edge fallback replica)

> **schema_v bump (CR-013):** `item_category` ใหม่ (v1), `item_master` แทนที่ `supply_item` เดิม (v2), `recipe` ขยาย field (v2), `sop_profile` ย้ายออกจาก catalog ไปอยู่ใน `sop-ratios` feature แยกต่างหาก

### 4.1 `item_category` — `item_category:{ulid}` · **schema_v 1** (ใหม่)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | ห้ามว่างเปล่า |
| `is_default` | bool | req | default `false`; ถ้า `true` จะเป็นหมวดหมู่ตั้งต้น |

### 4.2 `item_master` — `item_master:{sku}` หรือ `item_master:{ulid}` · **schema_v 3** (แทนที่ `supply_item`)

> **schema_v 3** — `conversions[].multiplier` / `consumption_rate` เป็น `qty_str`. CR-038.
> **Reconcile (CR-031):** เพิ่มฟิลด์ `category` (opt) อ้างอิง `item_category.name` — schema_v 2 คงเดิม

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | ห้ามว่างเปล่า |
| `SKU` | str | opt | รหัสสินค้า เช่น `P-001` |
| `description` | str | opt | รายละเอียด / หมายเหตุ |
| `category` | str | opt | หมวดหมู่สินค้า อ้างอิงชื่อจาก `item_category.name` เช่น `"food"`, `"medicine"`, `"hygiene"` |
| `base_unit` | str | req | หน่วยที่เล็กที่สุด เช่น `ชิ้น`, `กรัม`, `มิลลิลิตร` |
| `conversions` | [{`uom_name`:str, `multiplier`:qty_str>0, `barcode`:str?}] | opt | หน่วยทวีคูณสำหรับรับ/จ่ายล็อตใหญ่ |
| `default_purchasing_uom` | str | opt | หน่วยเริ่มต้นตอนทำใบสั่งซื้อ |
| `default_inventory_uom` | str | opt | หน่วยรายงานสต็อกหลัก |
| `default_issue_uom` | str | opt | หน่วยเริ่มต้นตอนเบิกจ่าย |
| `distribution_type` | enum(`consumable`,`one_time`) | req | `consumable` = วัสดุสิ้นเปลือง; `one_time` = รายคน |
| `target_reserve_days` | num | opt | เป้าหมายจำนวนวันสำรองสูงสุด |
| `consumption_rate` | qty_str | opt | อัตราการใช้ต่อคน/ครัวเรือน ตาม `distribution_type` |
| `unit` | str | opt | หน่วยของ `consumption_rate` |
| `timeframe` | enum(`daily`,`weekly`) | opt | กรอบเวลาของ `consumption_rate` |
| `sphere_standard` | num | opt | เกณฑ์ Sphere สากลต่อคน (เช่น น้ำ 3 ล./วัน) |
| `overstock_alert_days` | num | opt | แจ้งเตือน overstock หากของในคลังเกินจำนวนวันนี้ |
| `target_audience_type` | enum(`all`,`specific_segments`) | req | `all` = แจกทุกคน; `specific_segments` = จำกัดกลุ่ม |
| `target_restrictions` | {`genders`?:[str], `vulnerable_groups`?:[str], `diet_religions`?:[str]} | opt | บังคับเมื่อ `target_audience_type = specific_segments`; `genders` ∈ {`male`,`female`,`other`}; `vulnerable_groups` ∈ {`elderly`,`pregnant`,`bedridden`,`infant`,`isolated`}; `diet_religions` ∈ {`halal`,`vegetarian`,`vegan`} |
| `is_default` | bool | req | default `false`; ตั้งเป็น item มาตรฐานหลัก |

### 4.3 `recipe` — `recipe:{ulid}` · **schema_v 3** (ขยาย field)

> **schema_v 3** — `ingredients[].quantity` / `standard_portions` / `standard_duration_hours` เป็น `qty_str`. CR-038.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `label` | str | req | ชื่อแสดงผลภาษาไทย เช่น "ข้าวไข่เจียว" |
| `ingredients` | [{`item_master_id`:str, `quantity`:qty_str>0, `uom`:str}] | req | รายการวัตถุดิบและปริมาณ; `item_master_id` → `item_master:{sku\|ulid}` |
| `standard_portions` | qty_str>0 | req | จำนวนที่ผลิตได้ต่อหนึ่งรอบประกอบอาหาร |
| `standard_duration_hours` | qty_str>0 | req | ระยะเวลาปรุงในหน่วยชั่วโมง |
| `is_default` | bool | req | default `false`; ตั้งเป็นสูตรมาตรฐานหลักของศูนย์ |

`producible(recipe) = min(stock_balance[item_master_id] / quantity)` — คำนวณฝั่ง client ด้วย Decimal (data-model §4)

**Migration (schema_v 2 → 3):** pre-prod — wipe/re-seed; item_master 2→3 เช่นกัน

> **Migration note:** `supply_item` docs (schema_v 1) ยังคงอยู่ใน DB จนกว่าจะ migrate; client ต้อง handle ทั้ง `item:` prefix (เดิม) และ `item_master:` prefix (ใหม่) ในช่วง transition

### 4.4 `sop_profile` — `sop_profile:{ulid}`

> **schema_v 3** — อัปเดต ratios whitelist 3 → 20 canonical keys (CR-006 amendment 2026-06-25 + CR-021). เพิ่ม `SOP_RATIO_KIND` (multiply/divide/threshold) สำหรับ calc engine (T-31).
> **Migration Note:** `schema_v` bumped due to CR-006 / CR-021. No production backfill needed. Devs must re-run the seed script (which now auto-overwrites) or delete stale catalog docs. **Breaking Change:** Legacy 3-key ratios (rice_g_per_person_meal, toilet_per_person) removed. All 20 canonical keys required; no auto-mapping from legacy keys. Devs must re-run seed or delete stale docs.
> schema_v 2 — ย้ายมาอยู่ catalog DB, ตัด `shelter_code` ออกเพื่อใช้เป็น Master Profile ส่วนกลาง (ตาม [CR-006](../changes/CR-006-sop-profile-master-override.md) และ [CR-015](../changes/CR-015-sop-ratio-schema-two-tier.md))

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | เช่น "Sphere baseline", "ปภ. มาตรฐาน" |
| `ratios` | {`water_l_per_person_day`:num, `drinking_water_l_per_person_day`:num, `cooking_water_l_per_person_day`:num, `hygiene_water_l_per_person_day`:num, `kcal_per_adult_day`:num, `people_per_tap`:num, `people_per_handpump`:num, `people_per_open_well`:num, `people_per_laundry`:num, `people_per_bathing`:num, `people_per_toilet_female`:num, `people_per_toilet_male`:num, `people_per_dining_point_adult`:num, `people_per_dining_point_child`:num, `m2_per_person_living`:num, `m2_per_person_living_cold`:num, `m2_per_person_total`:num, `max_waterpoint_distance_m`:num, `max_queue_minutes`:num, `people_per_volunteer`:num} | req | ratios ต้องระบุคีย์ครบถ้วน (Full Ratios Requirement) ใช้ 20-key strict schema ทั้ง Master และ Override |
| `version` | int | req | — |
| `active` | bool | req | ศูนย์เลือกใช้ profile ที่ active |

---

## 5. DB `central_ops` (central เท่านั้น)

### 5.1 `search_audit` — `search_audit:{ulid}` · **append-only**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `query_kind` | enum(`name`,`phone`,`national_id`,`passport`) | req | ชนิด query ที่ parse ได้จาก public family-search (CR-044) |
| `query_hash` | str | req | SHA-256 ของ query (normalize แล้ว) — ไม่เก็บ query ตรง |
| `ip_hash` | str | req | — |
| `result_count` | int≥0 | req | — |
| `occurred_at` | ts | req | — |

### 5.2 `export_job` — `export_job:{ulid}`

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `kind` | enum(`evacuees`,`movements`,`stock`,`donations`) | req | — |
| `shelter_code` | str | req | — |
| `format` | enum(`csv`,`xlsx`) | req | — |
| `filters` | {} | opt | — |
| `status` | enum(`queued`,`running`,`done`,`failed`) | req | — |
| `requested_by` | str | req | — |
| `file` | {`url`:str, `expires_at`:ts}\|null | sys | ลิงก์อายุ 24 ชม. |
| `error` | str\|null | sys | เมื่อ failed |

### 5.3 `shelter_counter` — `counter:shelter` (singleton)

ตัวนับกลางสำหรับ mint `shelter.code` แบบ sequential — อยู่ที่ central เท่านั้น (ไม่ replicate ลง edge/device:
edge/device ไม่เคย mint code). central เป็น single writer → code unique + monotonic by construction.
ไม่ขัดกับกติกา "ห้าม sequence กลางตอน offline" (data-model §2): rule นั้นห้ามเฉพาะ operational doc ที่
เขียน offline บน device; การ mint shelter เป็น central-only + ต้องมี WAN (`POST /api/v1/shelters`, api-contract §3).

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `value` | int≥0 | sys | เลขที่ allocate ล่าสุด (เริ่ม `0`) — provision ศูนย์ใหม่ = read-modify-write `value+1` แล้ว mint `code = "SH" + pad3(value)`; ชน `_rev` (409) → retry |

---

## 6. DB `_users` (CouchDB system DB — central-managed)

CouchDB `_users` DB ไม่ใช่ operational doc ธรรมดา — ไม่มี common envelope; managed ผ่าน `/api/v1/users`
(ห่อ CouchDB admin API, central เท่านั้น) เอกสารนี้ระบุเฉพาะ field ที่โครงการ extend เพิ่มเข้า `_users` doc

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | CouchDB username (login id) |
| `password` | str | req | CouchDB hash จัดการโดย CouchDB เอง |
| `display_name` | str\|null | opt | ชื่อแสดงผล (UI บังคับกรอกตอนสร้าง) |
| `roles` | [str] | req | CouchDB role list: `["shelter:{id}"]` + RoleKey ต่อ function เช่น `"registration_staff"`, `"kitchen_staff"`, `"warehouse_staff"`, `"shelter_manager"`, `"system_admin"` — 1 user 1 shelter; SA มี `shelter_id = null` (ไม่มี `shelter:{id}` prefix) |
| `affiliation_tags` | [str] | opt | **metadata เท่านั้น** — lower_snake string เช่น `"volunteer"`, `"governance"` · default `[]` · **ห้ามใช้แทน permission**: ไม่ให้สิทธิ์, ไม่เปลี่ยน shelter scope, ไม่ bypass role check ใด ๆ ทั้งสิ้น |
| `shelter_id` | str\|null | opt | shelter `_id` ที่ user นี้สังกัด (เดียวกับ `shelter:{id}` ใน roles); `null` = global (SA); server derive จาก session ไม่เชื่อ client |

**กฎ migration (CR-002):**
- `_users.roles[]` ค่า `volunteer` ทั้งหมดต้องถูก migrate เป็น `registration_staff` ก่อน deploy
- ห้าม infer `affiliation_tags: ["volunteer"]` อัตโนมัติจาก role เดิม — เพิ่มได้เฉพาะจากข้อมูลที่ยืนยันแล้ว
- หลัง deploy ห้ามรับ `roles[]` ค่า `"volunteer"` — server validate reject

---

## 7. Index & view สรุปต่อ db (deploy ใน `_design/app` ตอน provisioning)

| DB | Mango indexes | Views (map/reduce) |
| --- | --- | --- |
| `shelter_*` | evacuee: name, phone, household_id, stay.status · movement: (evacuee_id, occurred_at) · screening: (evacuee_id, screened_at) · stock_ledger: (item_id, occurred_at) · donation: status, tracking_token_hash, booking_ref, campaign_id, (logistics.slot.date) · donation_slot: (date), (date, from) · medical: evacuee_id · shift: (date, shift) · shelter_report: (status, occurred_at), (severity, status), (kind, status), (assignee_user_id, status) · sop_override: (active) | `occupancy` (count by stay status) · `stock_balance` (client Decimal sum qty_str by item; CR-038) · `latest_screening` · `meals_served` (sum by date+meal) · `needs_open` · `slot_availability` |
| `registry` | shelter: status · shelter: code (unique) · location_district: (province_id) · location_subdistrict: (district_id) | — |
| `catalog` | item_master: distribution_type, target_audience_type · item_category: is_default · recipe: is_default · sop_profile: active | — |
| `central_ops` | export_job: (status, requested_by) · search_audit: occurred_at | — |

## 8. Validation rules (สรุปที่ `validate_doc_update` ต้องบังคับ — ทั้ง central และ edge)

Design docs / `validate_doc_update` ต้อง deploy ทั้ง central และ edge เพราะ edge อาจเป็น active
write target ระหว่าง LAN fallback; schema/role enforcement ต้องเหมือนกันทุก remote.

1. `type` อยู่ใน whitelist ของ db นั้น; `_id` ขึ้นต้นด้วย `{type}:`
2. append-only types (`movement`, `screening`, `stock_ledger`, `kitchen_requisition`, `meal_service`, `audit`, `search_audit`) — ปฏิเสธ update/delete ทุกกรณี
3. state machine types (`stock_transfer`, `donation`, `referral`, `shelter_report`, …) — ปฏิเสธ transition ถอยหลัง (ตามลำดับ enum / กราฟของ type นั้น)
4. role→type เขียนได้ตาม role-permission-matrix (ตรวจ `userCtx.roles`)
5. `shelter_code` ใน doc ต้องตรงกับ db
6. required fields ครบ + enum ถูกต้อง (โครงสร้างลึกตรวจฝั่ง client/Zod — validate_doc_update ตรวจเท่าที่จำเป็นกัน doc พัง ไม่ duplicate ทุก rule)
7. master `sop_profile` (catalog) เขียน/แก้ไขได้เฉพาะบทบาท `system_admin` เท่านั้น (replicate ลงเครื่องแบบ read-only)
8. `sop_override` (shelter_*) ต้องเขียนโดยบทบาท `shelter_manager` ที่มี `shelter_code` ตรงกับ database และเซสชันการทำงาน
