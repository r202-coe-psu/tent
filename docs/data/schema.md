---
title: Smart Shelter — Database Schema v3
status: draft for review
created: 2026-06-11
updated: 2026-06-19
note: field-level canonical — คู่กับ data-model.md (topology/policy) และ api-contract.md (planes)
---

# Database Schema v3 — field-level

Canonical ระดับ field ของทุก doc type. Zod schema ฝั่ง client และ `validate_doc_update` ฝั่ง
CouchDB ต้อง generate/เขียนให้ตรงกับเอกสารนี้

**สัญลักษณ์:** `req` = บังคับตอนสร้าง · `opt` = เติมทีหลังได้ · `sys` = ระบบเติม
**ชนิด:** `str`, `int`, `num`, `bool`, `ts` (ISO-8601 UTC), `enum(...)`, `T|null`, `[T]`, `{...}`

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

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `first_name` | str | req | ตัดช่องว่างหัวท้าย; ห้าม empty |
| `last_name` | str | req | — |
| `gender` | enum(`male`,`female`,`other`) | req | — |
| `phone` | str\|null | req | UI บังคับกรอก — กด/พิมพ์ "ไม่มี" → เก็บ `null`; เก็บ normalize แล้ว (ตัวเลขล้วน เช่น `"0812345678"`) |
| `nickname` | str | opt | — |
| `birth_year` | int | opt | พ.ศ. 4 หลัก |
| `national_id` | str | opt | 13 หลัก — เก็บ plaintext (ไม่มี masking — เคาะ 2026-06-11); ไม่ออก public tier ทุกกรณี |
| `religion` | enum(`buddhist`,`muslim`,`christian`,`other`,`unknown`) | opt | ใช้วางแผนอาหาร halal |
| `special_needs` | [enum(`elderly`,`disabled`,`pregnant`,`infant`,`chronic_illness`,`bedridden`)] | opt | default `[]` |
| `emergency_contact` | {`name`:str, `phone`:str, `relation`:str} | opt | — |
| `household_id` | str\|null | opt | → `household:{ulid}` |
| `current_stay` | {`status`, `zone`, `since`} | req | `status`: enum(`registered`,`checked_in`,`checked_out`,`transferred`) เริ่ม `registered` · `zone`: str\|null · `since`: ts — snapshot เท่านั้น ความจริง = movement |
| `privacy` | {`search_excluded`:bool} | req | default `{search_excluded:false}` (opt-out model) |
| `registered_via` | enum(`app`,`import`,`paper`) | req | — |
| `anonymized` | bool | sys | default ไม่มี field; purge job ตั้ง `true` พร้อมล้าง PII (§retention data-model §7) |

**Index:** `(last_name, first_name)` · `(phone)` · `(household_id)` · `(current_stay.status)`

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

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `label` | str | req | ชื่อเรียกครัวเรือน เช่น "บ้านสมชาย" |
| `head_evacuee_id` | str\|null | opt | หัวหน้าครัวเรือน |
| `zone` | str\|null | opt | โซนพักของครัวเรือน |
| `pets` | [{`species`:enum(`dog`,`cat`,`bird`,`other`), `count`:int, `notes`:str?}] | opt | default `[]` |
| `notes` | str | opt | — |

สมาชิก = evacuee ที่ `household_id` ชี้มา (ทางเดียว — ไม่เก็บ list สมาชิกใน household กัน conflict)

### 1.4 `movement` — `movement:{ulid}` · **append-only**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `evacuee_id` | str | req | — |
| `action` | enum(`check_in`,`check_out`,`transfer_out`,`transfer_in`) | req | — |
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

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `item_id` | str | req | → `item:{ulid}` ใน catalog |
| `qty` | num | req | **signed**: + รับเข้า / − จ่ายออก; ≠ 0 |
| `unit` | str | req | ต้องตรงกับ `supply_item.unit` |
| `reason` | enum(`receive`,`distribute`,`requisition`,`adjust`,`transfer_out`,`transfer_in`,`donation`) | req | — |
| `ref_id` | str\|null | opt | doc ต้นเหตุ (donation/transfer/requisition) |
| `lot` | {`expiry`:ts?, `note`:str?} | opt | ของหมดอายุได้ (อาหาร/ยา) |
| `occurred_at` | ts | req | — |

**Index:** `(item_id, occurred_at)` · `(reason)` · view `stock_balance` (sum qty per item)

### 2.2 `stock_transfer` — `stock_transfer:{ulid}` · state machine (forward-only)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `from_shelter` / `to_shelter` | str | req | shelter_code (เช่น `SH001`) — doc เกิดฝั่งต้นทาง replicate ผ่าน central |
| `items` | [{`item_id`:str, `qty`:num>0, `unit`:str}] | req | ≥1 รายการ |
| `status` | enum(`requested`,`shipped`,`received`,`cancelled`) | req | forward-only: received > shipped > requested; cancelled ได้ก่อน shipped เท่านั้น |
| `timeline` | {`requested`:{at,by}, `shipped`:{at,by}?, `received`:{at,by}?} | req/sys | เติมตาม transition |
| `notes` | str | opt | — |

แต่ละ transition เขียน `stock_ledger` คู่: shipped → `transfer_out` (−) ฝั่งต้นทาง; received → `transfer_in` (+) ฝั่งปลายทาง

### 2.3 `donation` — `donation:{ulid}` · state machine

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `channel` | enum(`public`,`walk_in`) | req | `public` = มาจาก /public/v1 |
| `donor` | {`name`:str, `phone`:str\|null, `phone_hash`:str} | req | PII ลบตาม retention — เหลือ `phone_hash` |
| `kind` | enum(`items`,`money`) | req | — |
| `items` | [{`item_id`:str?, `free_text`:str?, `qty`:num>0, `unit`:str}] | kind=items | `item_id` หรือ `free_text` อย่างใดอย่างหนึ่ง |
| `amount_thb` | num>0 | kind=money | — |
| `campaign_id` | str\|null | opt | → `donation_campaign:{ulid}` |
| `status` | enum(`declared`,`received`,`expired`,`cancelled`) | req | forward-only; `declared`→`expired` โดย job เมื่อพ้น TTL |
| `tracking_token_hash` | str | sys | SHA-256 ของ token — **ไม่เก็บ token ตรง**; public service lookup ด้วย hash |
| `declared_at` / `received_at` | ts / ts\|null | req/sys | — |
| `expires_at` | ts | sys | `declared_at` + `config.donation_reservation_ttl_hours` (default 72) |

**Index:** `(status)` · `(tracking_token_hash)` · `(campaign_id)`

### 2.4 `donation_campaign` — `donation_campaign:{ulid}`

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `title` | str | req | — |
| `needs` | [{`item_id`:str, `qty_target`:num>0, `unit`:str}] | req | ≥1 |
| `status` | enum(`open`,`closed`) | req | — |
| `opens_at` / `closes_at` | ts / ts\|null | opt | — |
| `notes` | str | opt | — |

view `needs_open` = `needs` − donation(declared+received ของ campaign) → /public/v1/needs

### 2.5 `meal_plan` — `meal_plan:{date}:{meal}` (deterministic — 1 doc/วัน/มื้อ)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `date` | str | req | `YYYY-MM-DD` (เวลาท้องถิ่นศูนย์) |
| `meal` | enum(`breakfast`,`lunch`,`dinner`,`snack`) | req | — |
| `headcount` | {`total`:int, `halal`:int, `soft_food`:int, `infant`:int} | req | จาก occupancy × special_needs ตอน generate; แก้ manual ได้ |
| `recipes` | [{`recipe_id`:str, `planned_qty`:int>0}] | req | qty = จำนวนกล่อง/หน่วยเสิร์ฟ |
| `status` | enum(`draft`,`confirmed`) | req | — |
| `override_reason` | str\|null | opt | บังคับเมื่อแก้ตัวเลข auto-calc |

`_id` deterministic → กันสร้างแผนซ้ำมื้อเดียวกันสอง device (ชนเป็น conflict ให้ resolve ไม่ใช่ doc ซ้ำ)

### 2.6 `kitchen_requisition` — `kitchen_requisition:{ulid}` · **append-only**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `meal_plan_id` | str\|null | opt | เบิกนอกแผนได้ |
| `items` | [{`item_id`:str, `qty_requested`:num>0, `qty_issued`:num≥0, `unit`:str}] | req | `qty_issued` < requested = เบิกบางส่วน (ของไม่พอ) |
| `ledger_ids` | [str] | sys | `stock_ledger` (reason=`requisition`, qty ลบ) ที่เกิดจากใบนี้ |
| `issued_at` | ts | req | — |

### 2.7 `meal_service` — `meal_service:{date}:{meal}` (deterministic) · **append-only**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `date` / `meal` | str / enum | req | คู่กับ meal_plan |
| `served` | int≥0 | req | เสิร์ฟในศูนย์ |
| `waste` | int≥0 | req | เหลือทิ้ง |
| `external` | {`volunteers`:int≥0, `outside_evacuees`:int≥0} | req | แจกนอกศูนย์ (ตาม source Module D) |
| `notes` | str | opt | — |

view `meals_served` + เทียบ plan vs actual ต่อวัน

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

### 2.10 `security_event` — `security_event:{ulid}` · **append-only**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `severity` | enum(`info`,`warning`,`critical`) | req | — |
| `category` | enum(`theft`,`violence`,`fire`,`intrusion`,`lost_person`,`other`) | req | — |
| `description` | str | req | — |
| `zone` | str\|null | opt | — |
| `evacuee_ids` | [str] | opt | ผู้เกี่ยวข้อง default `[]` |
| `actions_taken` | str | opt | — |
| `occurred_at` | ts | req | — |

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
| `action` | enum(`duplicate_override`,`retro_edit`,`export`,`purge`,`conflict_resolved`,`manual_adjust`,`other`) | req | — |
| `target_type` / `target_id` | str / str | req | doc ที่ถูกกระทำ |
| `reason` | str | req | — |
| `context` | {} | opt | payload แล้วแต่ action (เช่น revision ที่แพ้ conflict) |
| `occurred_at` | ts | req | — |

---

## 3. DB `registry` (central-managed → pull ลง device; edge fallback replica)

### 3.1 `shelter` — `shelter:{ulid}`

> **schema_v 2** — `capacity` เพิ่มเป็น required field, `status` ใช้ enum(`open`,`closed`) (เลิกใช้ `active`). CR-004.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `code` | str | sys | code ที่อ่านออก เช่น `SH001` — **unique**, immutable; central mint ตอน provisioning (จาก `central_ops` counter §5.3) เป็นชื่อ db `shelter_{code}` + ใช้อ้างข้ามศูนย์ทุกที่ (`shelter_code`). pattern `^SH\d{3,}$`: เลข 1–999 pad 3 หลัก (`SH001`), ≥1000 ความกว้างตามจริง (`SH1000`) |
| `name` | str | req | — |
| `status` | enum(`open`,`closed`) | req | `closed` → เริ่มนาฬิกา retention |
| `capacity` | int>0 | req | จำนวนคนสูงสุด — ควรสอดคล้องกับ `area_m2` (Sphere ≥3.5 m²/คน); ผลรวม zone capacity ≤ ค่านี้ |
| `zones` | [{`code`:str, `name`:str, `capacity`:int>0}] | req | — |
| `area_m2` | num>0\|null | opt | พื้นที่ปิดรวม (m²) — ใช้คำนวณ m²/คน เทียบ Sphere 3.5 m² minimum; `null` = ยังไม่ได้วัด |
| `facilities` | {`toilets_female`:int≥0, `toilets_male`:int≥0, `toilets_accessible`:int≥0, `showers`:int≥0, `water_points`:int≥0, `handwashing_stations`:int≥0} | opt | นับจริงที่ศูนย์ — ใช้คำนวณ Sphere ratio vs occupancy (เช่น 1 toilet:20 คน แยกเพศ, 1 water point:250 คน); `null` = ยังไม่ได้สำรวจ |
| `location` | {`address`:str, `lat`:num?, `lng`:num?} | opt | — |
| `contact` | {`name`:str, `phone`:str} | opt | — |
| `edge_url` | str\|null | sys | base URL ของ LAN Edge fallback ศูนย์นั้น — ใช้เมื่อ WAN/central เข้าไม่ได้; ไม่ใช่ normal client remote |
| `opened_at` / `closed_at` | ts / ts\|null | sys | — |

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

## 4. DB `catalog` (central-managed → pull ลง device; edge fallback replica)

### 4.1 `supply_item` — `item:{ulid}`

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | — |
| `category` | enum(`food`,`water`,`medicine`,`clothing`,`hygiene`,`bedding`,`equipment`,`other`) | req | — |
| `unit` | str | req | หน่วยเดียวตายตัวต่อ item เช่น `kg`, `ขวด`, `ชิ้น` — ledger ทุกแถวต้องใช้หน่วยนี้ |
| `reorder_level` | num\|null | opt | ต่ำกว่านี้ → แจ้งเตือน |
| `perishable` | bool | req | default `false` — บังคับกรอก `lot.expiry` ตอนรับเข้า |

### 4.2 `sop_profile` — `sop_profile:{ulid}`

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | เช่น "Sphere baseline", "ปภ. มาตรฐาน" |
| `ratios` | {str: num} | req | key ตายตัวที่ระบบรู้จัก เช่น `water_l_per_person_day`, `rice_g_per_person_meal`, `toilet_per_person` |
| `version` | int | req | — |
| `active` | bool | req | ศูนย์เลือกใช้ profile ที่ active |

### 4.3 `recipe` — `recipe:{ulid}`

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | เช่น "ข้าวไข่เจียว" |
| `serving_unit` | str | req | default `box` |
| `ingredients` | [{`item_id`:str, `qty`:num>0, `unit`:str}] | req | ต่อ 1 หน่วยเสิร์ฟ; unit ต้องตรง supply_item |
| `tags` | [enum(`halal`,`soft_food`,`vegetarian`,`infant`)] | opt | default `[]` |
| `active` | bool | req | — |

`producible(recipe) = min(stock_balance[item] / qty)` — คำนวณฝั่ง client (data-model §4)

---

## 5. DB `central_ops` (central เท่านั้น)

### 5.1 `search_audit` — `search_audit:{ulid}` · **append-only**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `query_kind` | enum(`name`,`phone`) | req | — |
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
| `shelter_*` | evacuee: name, phone, household_id, stay.status · movement: (evacuee_id, occurred_at) · screening: (evacuee_id, screened_at) · stock_ledger: (item_id, occurred_at) · donation: status, tracking_token_hash, campaign_id · medical: evacuee_id · shift: (date, shift) | `occupancy` (count by stay status) · `stock_balance` (sum qty by item) · `latest_screening` · `meals_served` (sum by date+meal) · `needs_open` |
| `registry` | shelter: status · shelter: code (unique) | — |
| `catalog` | item: category · recipe: active | — |
| `central_ops` | export_job: (status, requested_by) · search_audit: occurred_at | — |

## 8. Validation rules (สรุปที่ `validate_doc_update` ต้องบังคับ — ทั้ง central และ edge)

Design docs / `validate_doc_update` ต้อง deploy ทั้ง central และ edge เพราะ edge อาจเป็น active
write target ระหว่าง LAN fallback; schema/role enforcement ต้องเหมือนกันทุก remote.

1. `type` อยู่ใน whitelist ของ db นั้น; `_id` ขึ้นต้นด้วย `{type}:`
2. append-only types (`movement`, `screening`, `stock_ledger`, `kitchen_requisition`, `meal_service`, `security_event`, `audit`, `search_audit`) — ปฏิเสธ update/delete ทุกกรณี
3. state machine types — ปฏิเสธ transition ถอยหลัง (ตามลำดับ enum ของ type นั้น)
4. role→type เขียนได้ตาม role-permission-matrix (ตรวจ `userCtx.roles`)
5. `shelter_code` ใน doc ต้องตรงกับ db
6. required fields ครบ + enum ถูกต้อง (โครงสร้างลึกตรวจฝั่ง client/Zod — validate_doc_update ตรวจเท่าที่จำเป็นกัน doc พัง ไม่ duplicate ทุก rule)
