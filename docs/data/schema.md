---
title: Smart Shelter — Database Schema v5
status: draft for review
created: 2026-06-11
updated: 2026-09-03
note: field-level canonical — คู่กับ data-model.md (topology/policy) และ api-contract.md (planes)
---

# Database Schema v5 — field-level

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

> **schema_v 9** — เพิ่มสถานะ `arriving` ใน `current_stay.status` (CR-106) — ผู้ประสบภัยที่รายงานตัวหน้างานแล้ว อยู่ระหว่างรอตรวจคัดกรองการแพทย์ หรือรอจัดสรรที่พัก (ไม่นับเตียงที่ถูกใช้จริงใน occupancy dashboard จนกว่าจะ check-in เป็น `active`).
> **schema_v 8** — เพิ่ม `card_snapshot` (CR-084) — สำหรับการสแกนบัตรประชาชน Smart Card Kiosk รอเจ้าหน้าที่คัดกรองและยืนยันตัวตน; Walk-in จาก Kiosk กำหนดสถานะเป็น `pre_registered` และ `registered_via: 'kiosk'`.
> **schema_v 7** — เพิ่ม `web` ใน `registered_via` (CR-070 D-REG-VIA) — ประชาชนจองเข้าศูนย์เอง
> ผ่าน public portal (T-71). `api` (inbound, CR-071) ยังไม่เพิ่มในรอบนี้.
> **schema_v 6** — เพิ่ม `cancelled` ใน `current_stay.status` (CR-070 D-HOLD-CANCEL) — ยกเลิก
> hold/pre-registration; ไม่นับ occupancy; ไม่เช็คอินจากสถานะนี้.
> **schema_v 5** — เพิ่ม `age` (CR-057) — snapshot อายุตอนนี้ อิสระจาก `birth_year` (ไม่ derive
> ไปมา). ข้าม `schema_v 4` ในโค้ด — จองไว้ให้ `photo` (CR-054, approved แต่ยังไม่ implement ใน
> code ณ วันที่ CR-057 done); เมื่อ `photo` implement จริงจะต้อง reconcile เลข schema_v อีกครั้ง.
> **schema_v 4** — เพิ่ม `photo` (CR-049).
> **schema_v 3** — `current_stay.status` เปลี่ยนจาก 4 ค่าเป็น 6 ค่า: `pre_registered`,`active`,
> `temporary_leave`,`transferred`,`checked_out`,`deceased` (UI v5, CR-035).
> `special_needs` เปลี่ยนจาก fixed enum เป็น free-form `[str]` (6).
> schema_v 2 — เพิ่ม `country` (CR-007) และปรับปรุง `national_id` เป็น `person_id` (CR-028).

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `first_name` | str | req | ตัดช่องว่างหัวท้าย; ห้าม empty |
| `last_name` | str | req | ตัดช่องว่างหัวท้าย; **ว่างได้** เมื่อไม่มีนามสกุล (mononym / ชาวต่างชาติ เช่น พม่า) — field คงมีเสมอ เป็น `""` ได้ (CR-106) |
| `gender` | enum(`male`,`female`,`other`) | req | — |
| `phone` | str\|null | req | UI บังคับกรอก — กด/พิมพ์ "ไม่มี" → เก็บ `null`; เก็บ normalize แล้ว (ตัวเลขล้วน เช่น `"0812345678"`) |
| `nickname` | str | opt | — |
| `birth_year` | int | opt | พ.ศ. 4 หลัก |
| `age` | int | opt | อายุ (ปี) ณ ตอนกรอกล่าสุด — snapshot ตรงๆ ไม่ derive จาก/ไปเป็น `birth_year` (CR-057) |
| `person_id` | {`cardType`:enum(`national_id`,`passport`,`pink_card`,`other`), `number`:str\|null} | opt | เอกสารแสดงตน — `cardType` default `"national_id"`; `number` คือเลขที่บัตร (opt); เก็บ plaintext ไม่ออก public tier ทุกกรณี |
| `religion` | enum(`buddhist`,`muslim`,`christian`,`other`,`unknown`) | opt | ใช้วางแผนอาหาร halal |
| `country` | str | req | ประเทศ | 
| `special_needs` | [str] | opt | free-form, nonempty หลัง trim; default `[]` (CR-046 — เดิม fixed enum; ไม่ผูก whitelist ในโค้ด, ไม่ใช่ master_data-wired — รอ CR แยกถ้าจะ wire ไป master_data) |
| `emergency_contact` | {`name`:str, `phone`:str, `relation`:str} | opt | — |
| `household_id` | str\|null | opt | → `household:{ulid}` (null ได้สำหรับ `pre_registered` ก่อนจัดเข้าครัวเรือน) |
| `photo` | str\|null | opt | → image:{ulid} (§1.6) (CR-049) null/ไม่มี field = ไม่มีรูป |
| `card_snapshot` | {...} | opt | snapshot ข้อมูลชิปบัตรและที่อยู่ตามบัตรประชาชน (CR-084) |
| `current_stay` | {`status`, `zone`, `since`} | req | `status`: enum(`pre_registered`,`arriving`,`active`,`temporary_leave`,`transferred`,`checked_out`,`deceased`,`cancelled`) · `zone`: str\|null · `since`: ts — snapshot เท่านั้น ความจริง = movement |
| `privacy` | {`search_excluded`:bool} | req | default `{search_excluded:false}` (opt-out model) |
| `registered_via` | enum(`kiosk`,`staff`,`backoffice`,`app`,`web`,`import`,`paper`) | req | `kiosk` = Smart Card Kiosk, `staff` = Onsite desk walk-in, `web` = public portal (CR-070), `backoffice` = Admin desk |
| `anonymized` | bool | sys | default ไม่มี field; purge job ตั้ง `true` พร้อมล้าง PII (§retention data-model §7) |

**Index:** `(last_name, first_name)` · `(phone)` · `(household_id)` · `(current_stay.status)` · `(person_id.number)`

**Migration (schema_v 2 → 3):** rename บน read — `registered`→`pre_registered`, `checked_in`→`active`;
`checked_out` เดิม (ออกทั่วไป) → `checked_out` ใหม่ (กลับภูมิลำเนา) ชั่วคราวจนกว่า manual review แยก
เคสที่ควรเป็น `transferred`; ไม่มี legacy value map ไป `temporary_leave`/`deceased` (เกิดจาก movement
action ใหม่เท่านั้น). `special_needs` (CR-046) ไม่ต้อง rename/transform — ค่า enum เดิม (เช่น
`"elderly"`) เป็น subset ของ "any nonempty string" อ่านผ่านได้ตรง ๆ

**Migration (schema_v 3 → 5, CR-057):** purely additive — `age` เป็น field เสริมล้วนๆ, doc เดิม
(schema_v ≤3) ไม่มี `age` ก็อ่านได้ปกติ ไม่ต้อง backfill; UI fallback ไปคำนวณอายุจาก `birth_year`
เมื่อไม่มี `age` (`evacueeAgeYears()` helper). เลข `4` (`photo`, CR-054) ถูกข้ามในโค้ดเพราะยังไม่
implement — ไม่กระทบ migration นี้

**Migration (schema_v 5 → 6, CR-070):** purely additive enum — `cancelled` เป็นค่าใหม่ของ
`current_stay.status`; doc เดิมไม่ต้อง backfill. ตั้งผ่าน `cancelPreRegistration` /
`cancelEvacueePreRegistration` (ไม่ผ่าน movement). Occupancy view ยัง emit ตาม status key;
`cancelled` ไม่รวมใน total/pre_registered buckets ของ dashboard payload

**Migration (schema_v 6 → 7, CR-070):** purely additive enum — `web` เป็นค่าใหม่ของ
`registered_via`; doc เดิมไม่ต้อง backfill และไม่มีโค้ดไหน branch บนค่านี้ (เขียนอย่างเดียว).
เขียนโดย public booking BFF เท่านั้น (`POST /api/public/v1/registrations`, T-71); staff UI
ยังใช้ `app` เหมือนเดิม. `api` (CR-071 inbound) ยังไม่เพิ่ม — รอ D-INBOUND-PLANE

**Migration (schema_v 7 → 8, CR-097):** purely additive — เพิ่ม `card_snapshot`, เพิ่ม `registered_via: 'kiosk'`, `person_id.number` index; doc เดิมไม่ต้อง backfill

**Migration (schema_v 8 → 9, CR-106):** purely additive enum — เพิ่ม `arriving` ใน `current_stay.status`; doc เดิม schema_v 8 อ่านได้ตามปกติโดยไม่ต้อง backfill, เมื่อเขียนใหม่ stamp schema_v 9


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
>
> **Residence (CR-106):** ฟิลด์ `address_no`…`postal_code` คือ **Residence** (ที่พักอาศัยร่วมของ Household) — ไม่ใช่ที่อยู่บนบัตรประชาชน (Identity-document address อยู่ที่ Evacuee). Station 1 บังคับขั้นต่ำตอนสร้างครอบครัวใหม่ที่ชั้น UI/validation; ไม่ bump schema_v. UI ไทยใช้คำว่า「ครอบครัว」; canonical type ยังเป็น `household`.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `label` | str | req | ชื่อเรียก — Station 1 สร้างอัตโนมัติ เช่น `ครอบครัวสมชาย` (CR-106) |
| `head_evacuee_id` | str\|null | opt | หัวหน้าครัวเรือน |
| `status` | enum(`pre-registered`,`arriving`,`checked-in`,`checked-out`,`cancelled`) | req | สถานะครัวเรือน — default `'arriving'` (ลงทะเบียนทั่วไป) หรือ `'pre-registered'` (จองล่วงหน้า) |
| `checkout_destination` | {`type`:enum(`returned_home`,`transferred_shelter`,`referred_facility`,`other`), `destination_name`:str?, `notes`:str?} \| null | opt | ปลายทางหลังเช็คเอาต์ — บังคับเมื่อ `status = 'checked-out'` |
| `municipality_zone` | str\|null | opt | เขตเทศบาล เช่น `"zone_1"` — code จาก `master_data:municipality_zone` |
| `community` | str\|null | opt | ชุมชน เช่น `"z1_c16"` — code จาก `master_data:community` (filter by zone) |
| `pets` | [{`species`:enum(`dog`,`cat`,`bird`,`other`), `count`:int, `notes`:str?, `has_cage`:bool?, `image_url`:str?}] | opt | default `[]` — แสดงเฉพาะเมื่อ shelter `feature_flags.allow_pets = true` |
| `assets` | {`description`:str, `image_url`:str\|null} \| null | opt | ทรัพย์สินมีค่า/สัมภาระ — แสดงเฉพาะเมื่อ `feature_flags.allow_assets = true` |
| `vehicles` | [{`type`:enum(`car`,`motorcycle`,`other`), `license_plate`:str\|null}] | opt | default `[]` — รายการยานพาหนะ (หลายคันได้) แสดงเฉพาะเมื่อ `feature_flags.allow_vehicles = true` |
| `notes` | str | opt | — |
| `address_no` | str\|null | opt | Residence — บ้านเลขที่ เช่น `"123/45"` (Station 1 บังคับตอนสร้าง) |
| `village_no` | str\|null | opt | Residence — หมู่ที่ / ตรอก / ซอย / ถนน เช่น `"หมู่ 2"` |
| `subdistrict` | str\|null | opt | Residence — ตำบล / แขวง (Station 1 บังคับตอนสร้าง) |
| `district` | str\|null | opt | Residence — อำเภอ / เขต (Station 1 บังคับตอนสร้าง) |
| `province` | str\|null | opt | Residence — จังหวัด (Station 1 บังคับตอนสร้าง) |
| `postal_code` | str\|null | opt | Residence — รหัสไปรษณีย์ เช่น `"90110"` |

สมาชิก = evacuee ที่ `household_id` ชี้มา (ทางเดียว — ไม่เก็บ list สมาชิกใน household กัน conflict)

**Migration (schema_v 1 → 2):** ลบ `zone`; field ใหม่ทั้งหมด optional → doc เดิมไม่ต้อง backfill.
**Migration (schema_v 2 → 3):** `assets`/`vehicles` optional/default-empty — doc เดิมไม่ต้อง backfill; ไม่มีข้อมูล production ณ วันที่ bump จึง ignore `vehicle` เดี่ยว (ถ้ามี) แล้วเริ่มต้น `vehicles: []`.
**Migration (schema_v 3 → 4):** lazy read-on-open — doc ที่ไม่มี `status` ได้ `status: 'checked-in'` (สมมติอยู่ในศูนย์แล้ว); `checkout_destination` default `null`; ไม่ต้อง backfill batch

### 1.4 `movement` — `movement:{ulid}` · **append-only**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `evacuee_id` | str | req | — |
| `action` | enum(`check_in`,`check_out`,`transfer_out`,`transfer_in`,`leave_temporary`,`return_from_leave`,`mark_deceased`,`zone_change`) | req | ผลต่อ `current_stay.status`: `check_in`/`transfer_in`→`active` · `check_out`→`checked_out` · `transfer_out`→`transferred` · `leave_temporary`→`temporary_leave` · `return_from_leave`→`active` · `mark_deceased`→`deceased` (terminal, ไม่มี action ย้อนกลับ) · `zone_change`→**คง status** (ปกติ `active`) อัปเดตเฉพาะโซน (CR-106 Station 3 rezone) |
| `zone` | str\|null | opt | โซนที่เข้า (`check_in`) หรือโซนปลายทาง (`zone_change`; บังคับมีค่าเมื่อ action เป็น `zone_change`) |
| `destination` | {`kind`:enum(`home`,`shelter`,`hospital`,`other`), `shelter_code`:str?, `detail`:str?} | opt | ใช้กับ check_out / transfer_out |
| `reason` | str | opt | — |
| `occurred_at` | ts | req | เวลาเหตุการณ์จริง (ไม่ใช่เวลา sync) |

**Index:** `(evacuee_id, occurred_at)` · view `occupancy`

### 1.5 `screening` — `screening:{ulid}` · **append-only** · **schema_v 2** (CR-106)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `evacuee_id` | str | req | — |
| `symptoms` | [str] | opt | default `[]` |
| `temperature_c` | num\|null | opt | — |
| `track` | enum(`normal`,`fast_track`) | req | ผลการคัดแยกครั้งนี้ |
| `needs_referral` | bool | req | default `false` |
| `notes` | str | opt | — |
| `screened_at` | ts | req | — |
| `triage_level` | enum(`green`,`yellow`,`red`)\|null | opt | ผลคัดแยก triage 3 สี (schema_v 2, CR-072/CR-106) |
| `vital_signs` | {`blood_pressure_sys`:num?, `blood_pressure_dia`:num?, `heart_rate`:num?, `spo2_percent`:num?} | opt | สัญญาณชีพ (schema_v 2) |

**Index:** `(evacuee_id, screened_at)` · view `latest_screening`

**Migration (schema_v 1 → 2, CR-106):** purely additive — เพิ่ม `triage_level` (เขียว/เหลือง/แดง) และ `vital_signs` (ความดัน, ชีพจร, SpO2); doc เดิม schema_v 1 อ่านได้ตามปกติโดยไม่ต้อง backfill, เมื่อเขียนใหม่ stamp schema_v 2

### 1.6 `image` — `image:{ulid}` · **schema_v 1** (CR-049)
Doc type ทั่วไป (ไม่ผูกเฉพาะ evacuee) สำหรับเก็บรูปเป็น **CouchDB attachment** — ตัวเอกสารเก็บแค่
เมตาดาต้า ตัวไบต์รูปจริงอยู่ใน `_attachments`

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `filename` | str | req | ชื่อไฟล์ต้นฉบับจาก client |
| `content_type` | str | req | mime type หลัง compress (`image/webp`) |
| `width` / `height` | int | req | ขนาดพิกเซลหลัง resize (ด้านยาวสุด ≤ 1024px) |
| `original_size` / `compressed_size` / `thumbnail_size` | int | req | bytes — ก่อน compress / หลัง compress / thumbnail |
| `caption` | str | opt | default `''` |

**Attachments:** `full` (WEBP ≤1024px, quality 0.82), `thumb` (WEBP square-crop 200px) — เขียนผ่าน
`PUT /{db}/{docid}/{attname}?rev=...` (HTTP ตรง ผ่าน `/couch` proxy คุกกี้ `_session`)
### 1.7 `people_import_log` — `people_import_log:{ulid}` · **schema_v 1** · **append-only** (CR-071)

Log 1 doc ต่อ 1 batch ของการ import ครัวเรือน+สมาชิกจาก Excel/CSV (T-72). envelope กลาง **มี
`shelter_code`** — ต่างจาก `shelter_import_log` (§3.7) ที่อยู่ใน `registry` เพราะ `results[]` ของ log นี้
มีชื่อผู้ประสบภัย จึงต้องอยู่ใน db ของศูนย์เดียวกับข้อมูลคนที่มันอ้างถึง (shelter-scope isolation).
เขียนหลัง commit เสร็จ; ไม่แก้ย้อนหลัง

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `source` | enum(`people`) | req | ชนิดข้อมูลที่ import (ตอนนี้มีแค่ people) |
| `filename` | str | req | ชื่อไฟล์ที่อัปโหลด (.xlsx หรือ .csv) |
| `imported_by` | str | req | `name` ของผู้ import (จาก session) |
| `total_rows` | int | req | จำนวน**ครัวเรือน**ที่อ่านได้จากไฟล์ (ไม่ใช่จำนวนคน) |
| `success_count` | int | req | ครัวเรือนที่สร้างสำเร็จ |
| `skipped_count` | int | req | ครัวเรือนที่ข้ามเพราะหัวหน้าครัวเรือนซ้ำกับคนในศูนย์นี้แล้ว |
| `error_count` | int | req | ครัวเรือนที่ล้มเหลว (validation + server) |
| `created_people` | int | req | จำนวนคนที่เขียนจริงรวมทุกครัวเรือน (หัวหน้า + สมาชิก) |
| `skipped_people` | int | req | จำนวนคนที่ข้ามเพราะซ้ำกับคนที่มีอยู่แล้วในศูนย์นี้ |
| `results` | array | req | ผลรายครัวเรือน — ดูรูปด้านล่าง |
| `started_at` | str (ISO) | req | เวลาเริ่ม commit |
| `finished_at` | str (ISO) | req | เวลาเสร็จ |

`results[]`: `{ row: int (แถวข้อมูลที่ 1-based ของชีตครัวเรือน), label: str|null, status:
'created'|'skipped_duplicate'|'validation_error'|'server_error', household_id?: str (เมื่อ created),
created_members?: int (สมาชิกที่เขียน ไม่รวมหัวหน้า), skipped_members?: int,
existing_evacuee_id?: str (คนเดิมที่ทำให้ครัวเรือนนี้ถูกข้าม), errors?: [{ column: str, message: str,
sheet?: str, line?: int }] }`

**ขอบเขตของ `results[]`:** เก็บไม่เกิน **200 ครัวเรือนแรก** และ `message` ยาวไม่เกิน **200 ตัวอักษร**
(เกินแล้วตัดท้ายด้วย `…`) — เหตุผลเดียวกับ §3.7. counters ด้านบนยังนับครบทุกแถวเสมอ

**เขียน/อ่าน:** บทบาทที่ import ได้ (`registration_staff`, `shelter_admin`, `shelter_manager` — CR-071)
เขียนผ่านเซสชัน staff ตรงจาก browser; `_design/access` ของ `shelter_*` ต้องมี `people_import_log`
ทั้งใน whitelist และ append-only list (ดู §8 ข้อ 2) มิฉะนั้น import สำเร็จแต่ประวัติเขียนไม่ลง

**Index:** ไม่ต้องมี secondary index — prefix scan `people_import_log:` ผ่าน `_all_docs` เพียงพอ

**หมายเหตุ sync:** worker ไม่รู้จัก doc type นี้ จึงถูกข้ามในการ project ลง MongoDB (ไม่มี public
projection — เป็นข้อมูลหลังบ้านล้วน)

---

## 2. DB `shelter_{shelter_code}` — Operations

### 2.1 `stock_ledger` — `stock_ledger:{ulid}` · **append-only**

> **schema_v 4** — เพิ่ม `lot.lot_no` (`L-YYMMDD-XXX`) + `lot.storage_zone` ([CR-088](../changes/CR-088-stock-ledger-lot-storage-zone.md)) — ขั้นตรวจรับบริจาค (T-16 R-16.5) ต้องมีที่เก็บเลขล็อตกับโซนจัดเก็บ. optional ทั้งคู่ ⇒ แถวเก่าไม่ต้อง backfill. `lot_no` ออกโดย **server** ตอนเขียน ledger (`lib/server/lot-number.ts`) ไม่รับจาก client. ผู้เขียน ledger ทุกที่ stamp `schema_v 4` เท่ากัน (`createStockLedger`)
> **schema_v 3** — เพิ่ม `purchase` ใน reason enum (CR-032) — รองรับรับสต็อกจากแหล่ง "จัดซื้อจัดจ้าง" แยกจากบริจาค; ยอดจริงยังมาจาก ledger. doc type `purchase` (§2.16) + write path มาใน slice ถัดไปของ CR-032. ผู้เขียน ledger ทุกที่ stamp `schema_v 3` เท่ากัน (operations `createStockLedger`, kitchen `issueRequisition`).
> schema_v 2 — `qty` เป็น `qty_str` (ไม่ใช่ JSON number). CR-038.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `item_id` | str | req | → `item_master:{sku\|ulid}` ใน catalog |
| `qty` | qty_str | req | **signed**: + รับเข้า / − จ่ายออก; ≠ 0; ใน `base_unit` |
| `unit` | str | req | ต้องตรงกับ `item_master.base_unit` |
| `reason` | enum(`receive`,`distribute`,`requisition`,`adjust`,`transfer_out`,`transfer_in`,`donation`,`purchase`) | req | `purchase` = รับจากจัดซื้อ (CR-032) |
| `ref_id` | str\|null | ตาม `reason` | doc ต้นเหตุ — **ค่าที่ยอมรับผูกกับ `reason` ตามตาราง "`reason` → `ref_id`" ด้านล่าง** (CR-055) |
| `lot` | {`expiry`:ts?, `note`:str?, `lot_no`:str?, `storage_zone`:str?} | opt | ของหมดอายุได้ (อาหาร/ยา) · `lot_no`/`storage_zone` = CR-088 (ดูตารางย่อยด้านล่าง) |
| `occurred_at` | ts | req | — |

**`lot` (CR-088)**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `expiry` | ts | opt | วันหมดอายุ — บังคับโดย caller เมื่อ `item_master.perishable` (catalog อยู่คนละ DB, domain มองไม่เห็น) |
| `note` | str | opt | — |
| `lot_no` | str | opt | `L-YYMMDD-XXX` — `YYMMDD` = วันที่รับจริง, `XXX` = ลำดับ 3 หลัก **ต่อวันต่อศูนย์** นับต่อจากเลขสูงสุดที่มีใน ledger ของ DB นั้น · **label สำหรับคนอ่านเท่านั้น** ไม่มี business rule ใดผูกกับค่านี้ ⇒ การชนกันในเคสรับพร้อมกันให้ป้ายซ้ำ ไม่ทำให้ยอดผิด (CR-088 ยอมรับความเสี่ยงนี้ แลกกับการไม่ต้องมี counter doc) · **server ออกให้เท่านั้น** (`lib/server/lot-number.ts`) — schema ฝั่งรับ input จาก client strip ค่านี้ทิ้ง |
| `storage_zone` | str | opt | โซนที่เก็บของจริง — free text ≤100 ตัวอักษร, ยังไม่มี master data โซน |

**Index:** `(item_id, occurred_at)` · `(reason)` · `stock_balance` = **client** Decimal sum ของ `qty` ต่อ item (อย่าพึ่ง CouchDB `_sum` ของ float/string)

**`reason` → `ref_id` (CR-055 R2)** — `_id` ของ CouchDB บอกชนิดตัวเองอยู่แล้วผ่าน prefix (`donation:01J…`) ตาราง
นี้จึงเป็นตัวกันไม่ให้แถวอ้าง `reason` หนึ่งแต่ชี้ไป doc อีกชนิด · **เพิ่มแหล่งที่มาใหม่ = เพิ่มแถวในตารางนี้**
(ห้ามกระจายเป็นเงื่อนไขรายตัวที่อื่น)

| `reason` | `ref_id` ต้องเป็น | ที่มา (ผู้เขียน) |
| --- | --- | --- |
| `donation` | `donation:{ulid}` — req | `keyDonationReceipt` |
| `purchase` | `purchase:{ulid}` — req | `keyPurchaseReceipt` (CR-032 · §2.16) |
| `requisition` | `kitchen_requisition:{ulid}` — req | kitchen `issueRequisition` |
| `transfer_in` / `transfer_out` | `stock_transfer:{ulid}` — req | transition ของ §2.2 (T-13 — ยังไม่ wired) |
| `adjust` | **`null` เสมอ** | ปรับสต็อกมือ ไม่มีใบต้นเหตุ |
| `distribute` | **`null` เสมอ** | `createDistributeEntry` — ทบทวนเมื่อ CR-059 ให้การแจกจ่ายมี doc ต้นเหตุ |
| `receive` | **`null` เสมอ** | ค่ากำพร้า — ไม่มีผู้เขียนใน production (CR-055 Q-2 ข: คงไว้ใน enum + บังคับ `null`) |

**ขอบเขตการบังคับ — client เท่านั้น:** กฎนี้บังคับที่ Zod (`stockLedgerInputSchema.superRefine` →
`features/operations/domain/operations.ts`) ผ่าน `createStockLedger` ซึ่งเป็นทางเดียวที่เขียนแถวนี้ได้ ·
`_design/access` ของ shelter DB (`lib/server/shelter-access-design.ts`) ตรวจ **envelope + append-only +
role gate** ของ `stock_ledger` แต่ **ไม่ตรวจ `reason` ↔ `ref_id`** และมี `_admin` bypass (seed / back-office
intake ไม่ผ่าน guard นี้อยู่แล้ว) ⇒ **ห้ามเคลมว่าเป็น server-side guard** (CR-055 Q-6 ก)

**Migration (schema_v 1 → 2):** pre-prod — wipe/re-seed; ไม่มี dual-read บังคับ
**Migration (schema_v 2 → 3):** additive — เพิ่ม enum value อย่างเดียว ไม่เปลี่ยนโครงสร้าง field; doc `schema_v: 2` เดิมอ่าน/ใช้ได้ปกติ ไม่ต้อง backfill
**Migration (CR-055 — ไม่ bump `schema_v`, คง 3):** ไม่เปลี่ยนรูป doc → ไม่มี backfill; เปลี่ยนแค่**ค่าที่ยอมรับตอนเขียน**ให้แคบลงตามตาราง `reason` → `ref_id` ด้านบน; แถวเก่าที่ละเมิดยัง**อ่านได้ปกติ** (`stockBalance` / `calculateReserved` / `LedgerTable` ต้องไม่ throw — CR-055 R5) และแก้ย้อนหลังไม่ได้เพราะ append-only → ถ้าต้องแก้ยอดให้ใช้ correction entry `reason:'adjust'` ตามกติกา T-11

### 2.2 `stock_transfer` — [MIGRATED TO central_ops]

> ⚠️ **ย้ายการจัดเก็บไปที่ DB `central_ops` (§5.5):**
> ตามการตัดสินใจสถาปัตยกรรม cross-DB write pattern ของ CR-059 (Flow 1 / T-13, approved 2026-08-22)
> เอกสารประเภท `stock_transfer` ทั้งหมดจะถูกเก็บไว้ที่ฐานข้อมูลกลาง `central_ops` โดยตรง ไม่เก็บใน
> `shelter_{shelter_code}` อีกต่อไป — เหตุผล: session ของศูนย์หนึ่งเขียนข้าม DB ของอีกศูนย์ไม่ได้
> (`_security.roles`) จึงต้องมีที่เก็บกลางเพื่อให้สถานะฝั่งต้นทางเปลี่ยนเป็น "ส่งมอบสำเร็จ" อัตโนมัติ
> หลังปลายทางยืนยันรับเข้าได้ (CR-059 ข้อ 4.4)
> ดูรายละเอียด Schema ของ `stock_transfer` ได้ที่ **[§5.5 stock_transfer — central_ops](#55-stock_transfer--stock_transferulid--state-machine-forward-only-cr-059-centralized-architecture)**

### 2.3 `donation` — `donation:{ulid}` · state machine

> **schema_v 5** — เพิ่ม `redirect_to_shelter_code` ([CR-087](../changes/CR-087-donation-redirect-target.md)) — ที่เก็บ "ส่งต่อไปศูนย์ไหน" ตอน `status: redirected` (T-16 R-16.4). optional ⇒ doc เดิมไม่ต้อง backfill. ตั๋วที่ศูนย์ปลายทางทำงานจริงคือ doc แยก `donation_redirect` (§2.19) ใน DB ของศูนย์ปลายทาง — field นี้เพียงบอกว่าใบนี้ถูกส่งไปไหน (scope isolation: ปลายทางมองไม่เห็น DB ต้นทาง)
> **schema_v 4** — เพิ่ม `revisions[]` (log การแก้ `items[]` โดย donor ผ่าน tracking_token). CR-080.
> schema_v 3 — `items[].qty` เป็น `qty_str`. CR-038.
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
| `status` | enum(`declared`,`pending_review`,`verifying`,`received`,`redirected`,`rejected`,`expired`,`cancelled`) | req | forward-only (CR-048); `declared` → `pending_review` (ประเมิน) → `verifying` (กำลังตรวจรับ) → `received` (ลงสต็อก), หรือ `redirected` (ส่งต่อศูนย์อื่น) / `rejected` (ปฏิเสธ) / `expired` (พ้น TTL) / `cancelled` (ยกเลิก) |
| `booking_ref` | str | sys | รหัสอ่านออก เช่น `DN-306892` — แสดง/พิมพ์บนตั๋วเพื่อแปะลงของ; **unique** |
| `tracking_token_hash` | str | sys | SHA-256 ของ token — **ไม่เก็บ token ตรง**; public service lookup/แก้ (PATCH) ด้วย hash |
| `declared_at` / `received_at` | ts / ts\|null | req/sys | — |
| `expires_at` | ts | sys | `declared_at` + `config.donation_reservation_ttl_hours` (default 72) |
| `redirect_to_shelter_code` | str\|null | opt | **ตั้งค่าเฉพาะตอน `status → redirected`** (CR-087); สถานะอื่นไม่มี field นี้/เป็น `null`. ใครกด/เมื่อไร/เพราะอะไร ไม่เก็บซ้ำที่นี่ — อยู่ใน `audit` (§2.12, `action: manual_adjust`) เหมือน approve/reject |
| `revisions` | [{`at`:ts, `by`:enum(`donor`), `items_before`:[{`item_id`:str?, `free_text`:str?, `qty`:qty_str, `unit`:str}], `items_after`:[…เหมือน `items_before`]}] | opt | append-only; donor แก้ `items[]` ผ่าน `PATCH /public/v1/donations/{token}` (CR-080). เก็บ **snapshot ทั้งชุด** ก่อน-หลัง ไม่ใช่ diff — เจ้าหน้าที่ต้องอ่านออกว่าใบนี้เคยเป็นอะไรโดยไม่ต้องประกอบ diff เอง. ไม่มีเพดานจำนวนครั้ง (คุมด้วย rate-limit ต่อ IP); `by` เป็น enum เผื่อขยายไป `staff` เมื่อเจ้าหน้าที่ adjust ตอนรับของ |

**Index:** `(status)` · `(tracking_token_hash)` · `(booking_ref)` · `(campaign_id)` · `(logistics.slot.date)`

**Migration (schema_v 1 → 2):** field ใหม่ทั้งหมด optional/sys → doc เดิมไม่ต้อง backfill; reader ถือว่าไม่มี `logistics`/`line_id`/`email`/`booking_ref` = walk_in เดิม. public donation ใหม่ทุกใบเขียนเป็น schema_v 2 (มี `logistics` + `booking_ref`).
**Migration (schema_v 2 → 3):** pre-prod — wipe/re-seed; `items[].qty` จาก num → qty_str
**Migration (schema_v 3 → 4):** `revisions` optional → doc เดิมไม่ต้อง backfill; reader ถือว่าไม่มี `revisions` = ยังไม่เคยถูกแก้. donation ใหม่ทุกใบเขียนเป็น schema_v 4 ทั้งสอง channel — เส้นทาง `public` เคยปั๊ม `schema_v 2` ค้างไว้ตั้งแต่ CR-038 (payload เป็น qty_str อยู่แล้วแต่ป้ายเวอร์ชันไม่ตาม) แก้ให้ตรงในรอบเดียวกัน

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

### 2.5 `meal_plan` — `meal_plan:{ulid}` (หลายแผนอาจใช้วัน+มื้อเดียวกันได้ — CR-045)

> **CR-085** — เพิ่ม `gas_usage[]` (ถังแก๊ส + ปริมาณที่แผนนี้จะใช้) — optional, **ไม่ bump schema_v**
> (คงที่ 2; precedent CR-045/CR-031/CR-084)
>
> **schema_v 2** — เพิ่ม `calc_source` (audit trail ของการคำนวณ ingredient จาก SOP ratio). CR-025.
> **CR-045** — `_id` เปลี่ยนจาก deterministic `meal_plan:{date}:{meal}` → ulid; เพิ่ม `label` และ
> `recipes[].unit` (ทั้งคู่ optional — ไม่ bump schema_v)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `date` | str | req | `YYYY-MM-DD` (เวลาท้องถิ่นศูนย์) |
| `meal` | enum(`breakfast`,`lunch`,`dinner`,`snack`) | req | — |
| `label` | str | opt | ชื่อเมนูที่ตั้งเอง (โหมด BOM/Custom) — ไม่มีค่า = ใช้ชื่อมื้อ SOP หรือชื่อสูตร BOM แทนตอนแสดงผล (CR-045) |
| `headcount` | {`total`:int, `halal`:int, `soft_food`:int, `infant`:int} | req | มาจาก occupancy (T-06) — ดู mapping ด้านล่าง; แก้ manual ได้; แต่ละ sub-count ≤ total (มิติตั้งฉาก บวกกันไม่ได้) |
| `recipes` | [{`recipe_id`:str, `planned_qty`:int>0, `unit`:str}] | req | qty = ปริมาณวัตถุดิบต่อมื้อ (หน่วยตาม recipe_id เช่น `ingredient:rice` = กรัม); T-26 map เป็น item_id; `unit` ต่อรายการ (opt) — ใส่เมื่อไม่ใช่ SOP มาตรฐาน (โหมด BOM/Custom อ้างอิง real `supply_item.unit`, CR-045) |
| `status` | enum(`draft`,`confirmed`) | req | — |
| `override_reason` | str\|null | opt | **บังคับ** เมื่อ headcount ต่างจาก occupancy snapshot ล่าสุด (CR-022) |
| `calc_source` | {`sop_profile_id`:str, `sop_profile_version`:int>0, `headcount_as_of`:ts}\|null | opt | audit trail — SOP profile + version + snapshot เวลาอ่าน headcount ที่ใช้คำนวณ |
| `gas_usage` | [{`cylinder_id`:str, `consumption_kg`:qty_str>0}] | opt | ถังแก๊ส (อ้าง `gas_cylinder_type`) + ปริมาณที่แผนนี้คำนวณว่าต้องใช้ (CR-085); ไม่มีค่า = แผนนี้ไม่ใช้แก๊ส (ยังไม่บันทึก ไม่ใช่ 0); `issueRequisition` อ่านค่านี้ไปตัด `gas_ledger` |

**Headcount source — occupancy mapping (CR-022):** derive จาก evacuee ที่ `current_stay.status = 'active'` —
`total` = จำนวนทั้งหมด, `halal` = `religion = 'muslim'`, `infant` = `special_needs` มี `'infant'`,
`soft_food` = `special_needs` มี ∈ {`bedridden`,`chronic_illness`,`elderly`}. sub-count เป็นมิติตั้งฉาก
(คนหนึ่งเป็นได้หลายกลุ่ม) → บวกกันเกิน total ได้ แต่แต่ละช่อง ≤ total. **Handoff T-26:** แต่ละ `recipe`
→ stock item (`ingredient:rice` → `item:rice`) เป็น `kitchen_requisition` input, `qty_issued` เริ่ม 0.
`planned_qty` เก็บเป็นกรัม (ความละเอียดที่ต้องใช้คำนวณ SOP ratio) แต่ `toRequisitionInput` **แปลงเป็น
`kg` ก่อนส่งต่อ** — `kitchen_requisition.items[].unit` และ `stock_ledger.unit` ที่ตัดจริงต้องเป็น `kg`
เสมอ ตามกฎ §2.1 (`unit` ต้องตรงกับ `item_master.base_unit`; `item:rice.base_unit = kg`) (CR-030)

`_id` เป็น ulid (ไม่ deterministic อีกต่อไป, CR-045) — อนุญาตให้มีหลายแผนต่อวัน+มื้อเดียวกัน (เช่น
สร้างแผนแยกก้อนสำหรับเสบียงเสริม) เพราะ workflow เบิก/บันทึกบริการเป็น one-shot ต่อแผน (เบิกซ้ำ/บันทึก
ซ้ำไม่ได้ — ถ้าต้องเบิกเพิ่มต้องสร้างแผนใหม่แยกก้อนแทน). `getMealPlan(date, meal)` จึง scan +
filter จาก `listMealPlans()` แทนการ `get` ตรงด้วย id — ambiguous ถ้ามีหลายแผนต่อมื้อ (คืนแค่ตัวแรกที่เจอ)

**Migration (schema_v 1 → 2):** `calc_source` optional → doc เดิมไม่ต้อง backfill; reader ถือว่าไม่มี `calc_source` = แผนที่สร้างก่อนมี audit trail

**Migration (_id pattern, CR-045):** แผนเก่าที่ยังมี `_id` แบบ deterministic (`meal_plan:{date}:{meal}`)
ยังอ่าน/ใช้งานได้ปกติ ไม่ต้อง backfill — โค้ดอ้างอิงผ่าน field `date`/`meal`/`_id` ตรงๆ ไม่เคย parse
รูปแบบ `_id` อยู่แล้ว

### 2.6 `kitchen_requisition` — `kitchen_requisition:{ulid}` · **append-only**

> **schema_v 2** — `qty_requested` / `qty_issued` เป็น `qty_str`. CR-038.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `meal_plan_id` | str\|null | opt | เบิกนอกแผนได้ |
| `items` | [{`item_id`:str, `qty_requested`:qty_str>0, `qty_issued`:qty_str≥0, `unit`:str}] | req | `qty_issued` < requested = เบิกบางส่วน (ของไม่พอ) |
| `ledger_ids` | [str] | sys | `stock_ledger` (reason=`requisition`, qty ลบ) ที่เกิดจากใบนี้ |
| `issued_at` | ts | req | — |

**Migration (schema_v 1 → 2):** pre-prod — wipe/re-seed

### 2.7 `meal_service` — `meal_service:{ulid}` · **append-only** · **schema_v 2** (CR-045)

> **CR-084** — เพิ่ม `actual_yield` (จำนวนเสิร์ฟที่ทำได้จริง) — optional, **ไม่ bump schema_v**
> (คงที่ 2; precedent §2.5 CR-045, §4.2 CR-031)
>
> **CR-045** — `_id` เปลี่ยนจาก deterministic `meal_service:{date}:{meal}` → ulid; เพิ่ม
> `meal_plan_id` (จำเป็นเพราะ §2.5 ตอนนี้อนุญาตหลายแผนต่อวัน+มื้อเดียวกัน — บันทึกบริการต้องผูกกับ
> แผนที่เจาะจง ไม่ใช่แค่วัน+มื้อ)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `date` / `meal` | str / enum | req | คู่กับ meal_plan |
| `meal_plan_id` | str\|null | opt | แผนที่บันทึกนี้รายงานผล — UI เช็ค "บันทึกแล้วหรือยัง" ด้วย field นี้ (เทียบ `plan._id`) ไม่ใช่ date+meal (CR-045) |
| `actual_yield` | int≥0 | opt | จำนวนที่ครัวปรุงได้จริง (ผลผลิต) — ใช้เป็นเพดานการแจก (CR-084); ไม่มีค่า = ยังไม่บันทึกผลผลิต (ไม่ใช่ 0) |
| `served` | int≥0 | req | เสิร์ฟในศูนย์ — จำนวนที่แจกออกไปจริง (คนละความหมายกับ `actual_yield`) |
| `waste` | int≥0 | req | เหลือทิ้ง |
| `external` | {`volunteers`:int≥0, `outside_evacuees`:int≥0} | req | แจกนอกศูนย์ (ตาม source Module D) |
| `notes` | str | opt | — |

`_id` เป็น ulid (ไม่ deterministic อีกต่อไป, CR-045) — เหตุผลเดียวกับ `meal_plan` §2.5:
หลายแผนอาจใช้วัน+มื้อเดียวกัน ดังนั้น "หนึ่งบันทึกต่อวัน+มื้อ" แบบเดิมใช้ไม่ได้แล้ว การซ้ำของบันทึก
กันด้วย UI (ปุ่ม "บันทึกบริการ" หายไปหลังบันทึกแล้ว) ไม่ใช่ด้วย `_id` ชนกันเหมือนเดิม.
`getMealService(date, meal)` scan + filter จาก `listMealServices()` เหมือน `getMealPlan` — ambiguous
ถ้ามีหลายบันทึกต่อมื้อ

**`actual_yield` vs `served` (CR-084):** `actual_yield` คือจำนวนที่ครัว**ปรุงได้จริง** (ผลผลิต),
`served` คือจำนวนที่**แจกออกไปจริง** — สองค่านี้ต่างกันได้ (ปรุงได้ 90 แต่แจกได้ 85) เพดาน
`served ≤ actual_yield` **ยังไม่บังคับตอนเขียนรอบนี้** (แค่ soft warning ฝั่ง UI) — การบังคับเพดานจริง
เป็นงานของ flow แจกจ่าย/สแกนหน้างานที่ยังไม่มีในระบบ. `MealVariance.variance`/`variance_pct`/`status`
ยังคงหมายถึง served-vs-planned เหมือนเดิม ไม่เปลี่ยนความหมายเพราะ `actual_yield`

**Migration (schema_v 1 → 2, CR-045):** `meal_plan_id` optional, default `null` — เอกสารเก่าที่สร้าง
ก่อน CR-045 จะไม่มี field นี้ และจะไม่ถูกนับว่า "บันทึกแล้ว" สำหรับแผนใดอีกต่อไป (UI จับคู่ด้วย
`meal_plan_id` ไม่ใช่ date+meal) — โปรเจกต์นี้อยู่ช่วง dev/test เท่านั้น (pre-prod) แนะนำ unseed/reseed
ข้อมูลทดสอบแทนการ migrate เอกสารเก่าจริง

**Migration (CR-084):** `actual_yield` optional — ไม่ bump `schema_v` (คงที่ 2); doc เดิมไม่มี field
นี้ → อ่านเป็น "ยังไม่บันทึกผลผลิต" ไม่ต้อง backfill

view `meals_served` + เทียบ plan vs actual ต่อวัน

### 2.7.1 `gas_cylinder_type` — `gas_cylinder_type:{ulid}` · **schema_v 2**

> **CR-085** — แต่ละ doc แทน**ถังแก๊สจริง 1 ใบ** (ไม่ใช่ "รุ่น" ที่ใช้ร่วมกันหลายถัง) — สต็อกจริงของ
> ถังนี้ track ผ่าน `gas_ledger` §2.7.2 แยกเอกสาร ไม่เพิ่ม field ที่นี่
>
> **schema_v 2** — `capacity_kg` / `burn_rate_kg_per_hour` / `time_multiplier` เป็น `qty_str`. CR-038.
> schema_v 1 — reference data สำหรับคำนวณเวลา/ปริมาณการใช้แก๊สหุงต้ม (LPG) ในครัว. CR-025 (ต่อยอด CR-003 T-56). mutable — LWW ผ่าน `touch()`.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | เช่น "เตาแรงดันสูง + ถัง 15kg" |
| `capacity_kg` | qty_str>0 | req | น้ำหนักแก๊สเติมต่อถัง (kg) |
| `burn_rate_kg_per_hour` | qty_str>0 | req | อัตราสิ้นเปลือง (kg/ชม.) |
| `time_multiplier` | qty_str>0 | req | ตัวคูณเวลา; default `"1"` |

**Migration (schema_v 1 → 2):** pre-prod — wipe/re-seed

### 2.7.2 `gas_ledger` — `gas_ledger:{ulid}` · **append-only** · **schema_v 1** (CR-085)

> สต็อกแก๊สจริงต่อถัง (`gas_cylinder_type` §2.7.1) — เหมือน `stock_ledger` §2.1 แต่แยกเอกสาร ไม่ผูก
> กับ `item_master`/`supply_item` เพราะแก๊สไม่ใช่ supply item ปกติ

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `cylinder_id` | str | req | อ้าง `gas_cylinder_type._id` |
| `qty_kg` | qty_str (signed, non-zero) | req | ลบ = ใช้ไป (`consumption`)/ตัดเศษ (`adjust`), บวก = เติมกลับ (`refill`) |
| `reason` | enum(`consumption`,`refill`,`adjust`) | req | `adjust` = ตัดเศษเหลือทิ้งด้วยมือ (CR-085 addendum) |
| `ref_id` | str\|null | opt | `meal_plan_id` เมื่อ `reason = consumption`; `null` เมื่อ `refill`/`adjust` |
| `occurred_at` | ts | req | — |

**ยอดเหลือ (compute เสมอ ไม่เก็บ running total):**
$$\text{remaining\_kg} = \text{capacity\_kg} + \sum \text{qty\_kg (entries ของถังนี้)}$$

**สถานะ (derive จากยอดเหลือ ไม่เก็บ field แยก):**
- `unused` (ยังไม่ใช้) — `remaining_kg == capacity_kg`
- `in_use` (กำลังใช้) — `0 < remaining_kg < capacity_kg`
- `empty` (หมดแล้ว) — `remaining_kg <= 0`

**เขียนเมื่อไหร่:** `issueRequisition` (T-26) เขียน entry `reason=consumption` พร้อม `stock_ledger`
ของอาหารใน `bulkDocs` เดียวกัน (atomic) — อ่านจาก `meal_plan.gas_usage` §2.5 เช็คยอดเหลือก่อนเขียน
**throw บล็อกทั้งหมดถ้ายอดเหลือไม่พอ** (ไม่ partial-issue เหมือนอาหาร) ปุ่ม "เติมแก๊ส" หน้า UI เขียน
entry `reason=refill` แยก (validate ไม่ให้ยอดเหลือเกิน `capacity_kg`)

เพราะ `consumption` เป็น all-or-nothing เศษเหลือขนาดเล็ก (เช่น 0.001 kg) จะไม่มีทางถูกเบิกจนหมดผ่าน
flow ปกติเลย ค้างเป็น `in_use` ตลอดไป — ปุ่ม "ตัดเศษเหลือทิ้ง" หน้า UI เขียน entry เดียว
`reason=adjust`, `qty_kg = -remaining_kg` ให้ยอดเหลือเป็น 0 พอดี (`ref_id: null`) ปฏิเสธ (throw) ถ้าถัง
ว่างอยู่แล้ว

**Migration:** N/A — doc type ใหม่ ไม่มีของเดิมต้อง migrate

### 2.8 `volunteer` — `volunteer:{ulid}` · **schema_v 3**

> **schema_v 3** — ทะเบียนประวัติจิตอาสาและบุคลากรปฏิบัติงาน (CR-104). บันทึก `phone` เป็น Mandatory Key (เบอร์โทรศัพท์สำหรับระบุตัวตนและดึงตั๋ว), `national_id` เป็น Optional, เพิ่ม `personnel_type` ('volunteer' | 'staff'), `checked_in` สถานะปฏิบัติงานสด, `current_shelter_code`, และลิงก์ไปยัง `user_name` กรณีเป็น Staff-Capable Volunteer.
> schema_v 2 — ปรับปรุงฟิลด์กะงาน.
> schema_v 1 — baseline โปรไฟล์อาสาสมัคร (CR-041).

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `first_name` | str | req | ชื่อจริง (ตัดช่องว่างหัวท้าย) |
| `last_name` | str | req | นามสกุล |
| `phone` | str | req | เบอร์โทรศัพท์สำหรับติดต่อและระบุตัวตน (ตัวเลขล้วน เช่น `"0812345678"`) |
| `phone_hash` | str\|null | opt | SHA-256 hash ของเบอร์โทรเพื่อค้นหาแบบไม่เปิดเผยตัวตน / deduplication |
| `national_id` | str\|null | opt | เลขประจำตัวประชาชน 13 หลัก (ทางเลือกเสริม ไม่บังคับ) |
| `personnel_type` | enum(`volunteer`,`staff`) | req | แยกประเภท: `'volunteer'` (อาสาสมัครทั่วไป) หรือ `'staff'` (เจ้าหน้าที่ประจำศูนย์) |
| `skills` | [str] | req | ทักษะความสามารถ เช่น `["ครัว", "ยกของ", "คอมพิวเตอร์", "ปฐมพยาบาล"]` (default `[]`) |
| `checked_in` | bool | req | สถานะกำลังปฏิบัติงานสดหน้างาน ณ ปัจจุบัน (default `false`) |
| `current_shelter_code` | str\|null | opt | รหัสศูนย์ที่กำลังปฏิบัติงานอยู่ในปัจจุบัน |
| `user_name` | str\|null | opt | ชื่อผู้ใช้ใน `_users` (เฉพาะอาสาช่วยงานระบบ Staff-Capable ที่ได้รับสิทธิ์ชั่วคราว) |
| `status` | enum(`active`,`inactive`) | req | default `active` |

**Index:** `(phone)` · `(phone_hash)` · `(status)` · `(personnel_type)` · `(checked_in)`

### 2.9 `shift_assignment` — `shift_assignment:{ulid}` · **schema_v 3**

> **schema_v 3** — การมอบหมายกะงานจิตอาสาและการเช็คอิน (CR-104). ผูกกับ `job_id` และ `shift_id` ภายในกะย่อยรายวัน `job.shifts[]`, บันทึก `duty_window` หน้าต่างเวลาจริง, `check_in_at`, `check_out_at`, `check_in_by` (เจ้าหน้าที่ผู้รับรายงานตัว หรือ `'self_service'`), ตัดฟิลด์ `dispatched` และ `response_code` ทิ้งทั้งหมด (Job Board Model เท่านั้น).
> schema_v 2 — baseline ผูก `job_id` (CR-041).
> schema_v 1 — baseline `(volunteer_id, date, shift, station)`.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `job_id` | str | req | → `job:{ulid}` (§2.17) |
| `shift_id` | str | req | อ้างอิง `shift_id` ภายใน `job.shifts[]` |
| `volunteer_id` | str | req | → `volunteer:{ulid}` (§2.8) |
| `duty_window` | {`start_ts`:ts, `end_ts`:ts} | req | หน้าต่างเวลาปฏิบัติงานจริง (ใช้สำหรับ Time-Bound Dynamic Role Sweeper) |
| `check_in_at` | ts\|null | opt | เวลาที่สแกนรายงานตัวเข้างาน |
| `check_out_at` | ts\|null | opt | เวลาที่สแกนเช็คเอาต์ออกงาน |
| `check_in_by` | str\|null | opt | username ของเจ้าหน้าที่ผู้รับรายงานตัว หรือ `'self_service'` (กรณีสแกนป้ายหน้าศูนย์) |
| `status` | enum(`assigned`,`checked_in`,`completed`,`no_show`,`cancelled`) | req | default `assigned` |

**Index:** `(job_id, shift_id)` · `(volunteer_id, status)` · `(status)` · `(duty_window.start_ts, duty_window.end_ts)`

**Migration (schema_v 2 → 3):** additive & cleanup — ตัด `dispatched_at`, `dispatched_by`, `response_code` ทิ้ง, เติม `shift_id` ให้ตรงกับกะย่อยของ job.

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

### 2.11 `referral` — [MIGRATED TO central_ops]

> ⚠️ **ย้ายการจัดเก็บไปที่ DB `central_ops` (§5.4):**
> ตั้งแต่สถาปัตยกรรม Cross-Tenant Referral แบบรวมศูนย์ (Centralized Architecture) เอกสารประเภท `referral` ทั้งหมดจะถูกเก็บไว้ที่ฐานข้อมูลกลาง `central_ops` โดยตรง ไม่เก็บใน `shelter_{shelter_code}` และไม่ใช้การ Mirror Doc ระหว่าง DB อีกต่อไป
> ดูรายละเอียด Schema, Indexes และ Access Control ของ `referral` ได้ที่ **[§5.4 referral — central_ops](#54-referral--referralulid--state-machine-cr-045-cr-046-centralized-architecture)**

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
| `ratios` | {`water_l_per_person_day`:qty_str, `drinking_water_l_per_person_day`:qty_str, `cooking_water_l_per_person_day`:qty_str, `hygiene_water_l_per_person_day`:qty_str, `kcal_per_adult_day`:qty_str, `people_per_tap`:qty_str, `people_per_handpump`:qty_str, `people_per_open_well`:qty_str, `people_per_laundry`:qty_str, `people_per_bathing`:qty_str, `people_per_toilet_female`:qty_str, `people_per_toilet_male`:qty_str, `people_per_dining_point_adult`:qty_str, `people_per_dining_point_child`:qty_str, `m2_per_person_living`:qty_str, `m2_per_person_living_cold`:qty_str, `m2_per_person_total`:qty_str, `max_waterpoint_distance_m`:qty_str, `max_queue_minutes`:qty_str, `people_per_volunteer`:qty_str} | req | ratios ต้องระบุคีย์ครบถ้วน (Full Ratios Requirement) |
| `version` | int | req | — |
| `active` | bool | req | สลับใช้ profile นี้หากเป็น true |

### 2.15 `daily_calc` — `daily_calc:{date}` (deterministic — 1 doc/วัน/ศูนย์) · **schema_v 2**

> **schema_v 2** — ปรับค่า ratios, stock snapshots, results ให้เป็น decimal strings (`qty_str` ตาม CR-038) และเพิ่ม `ratio_source` + `sop_override_id` + `sop_override_version` สำหรับ drill-down T-32 ([CR-042](../changes/CR-042-daily-sop-calc-follow-up.md) OD-1=A).
> **Migration (schema_v 1 → 2):** (Pre-Prod) ปรับฟิลด์ ratio, stock snapshot, results จากตัวเลขเป็น decimal strings (`qty_str`) นักพัฒนาต้องทำการ Re-seed หรือล้างฐานข้อมูล pre-production (`pnpm db:reset` / `pnpm db:seed`) เพื่อลบเอกสารโครงสร้างตัวเลขแบบเก่าออกก่อนเริ่มทดสอบ
> **schema_v 1** — baseline doc type ([CR-036](../changes/CR-036-daily-calc-doc-type.md)).
> Snapshot ผลการคำนวณทรัพยากรประจำวันของ engine T-31 (FR-45). `_id` deterministic ต่อวัน (`daily_calc:2026-07-08`) → **idempotent**: รันซ้ำวันเดียวกันเขียนทับ doc เดิม (ไม่สร้างซ้ำ). Input (occupancy, effective ratio, stock, shelter facilities/area ตาม hardcode map [CR-042](../changes/CR-042-daily-sop-calc-follow-up.md) OD-2=B) อ่านผ่าน barrel ของ peer feature เท่านั้น (people / sop-ratios / operations). ค่าทุกตัวถูก freeze ณ เวลาคำนวณเพื่อให้ผล reproducible. ทับข้อมูลเดิม → เขียน `audit:{action:retro_edit}` (เก็บ `_rev` + ผลเดิม) **ก่อน** เขียนทับ. R3 runtime = **on-demand อย่างเดียว** (CR-042 OD-3=A).

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `formula_v` | str | req | เวอร์ชันสูตร (`FORMULA_V`) ที่ผลิตผลชุดนี้ — algorithm version ไม่ใช่ schema |
| `sop_profile_version` | int>0 | req | `version` ของ effective SOP profile (override active ?? master) ที่ใช้ ([CR-006](../changes/CR-006-sop-profile-master-override.md)) |
| `ratio_source` | enum(`master`,`override`) | req | ที่มาของ effective ratio ที่ freeze ใน snapshot ([CR-042](../changes/CR-042-daily-sop-calc-follow-up.md)) |
| `sop_override_id` | str\|null | req | `_id` ของ `sop_override` ที่ใช้; **ต้อง `null` เมื่อ `ratio_source=master`**; บังคับมีค่าเมื่อ `override` |
| `sop_override_version` | int\|null | req | `version` ของ override ที่ใช้; **ต้อง `null` เมื่อ `ratio_source=master`**; บังคับมีค่าเมื่อ `override` |
| `ratio_snapshot` | {str:qty_str} | req | ratio ทุกคีย์ที่ freeze ตอนคำนวณ. คีย์ **generic string** (ไม่ผูก whitelist 20 keys — engine domain-agnostic); `{}` ว่างได้ |
| `occupancy_snapshot` | num≥0 | req | headcount ที่ `current_stay.status = active` (physically present, [CR-035](../changes/CR-035-evacuee-stay-status-v3-scan-check-in-out.md) stay-status v3) ณ เวลาคำนวณ |
| `as_of` | ts | req | ISO-8601 UTC ตอนจัดทำ snapshot (เวลาที่ freeze input — ต่างจาก `updated_at` ที่เป็นเวลาคำนวณล่าสุด) |
| `stock_snapshot` | {str:qty_str\|null} | req | ยอดคงเหลือต่อ resource ที่ใช้; `null` = ไม่ sync / ไม่มี mapping (`have` seam — CR-036 Open decision #2) |
| `results` | ResourceCalcResult[] | req | ผลรายแถว: `ordinal:int, key:str, kind:enum, input_valid:bool, ratio:qty_str|null, need:qty_str|null, have:qty_str|null, gap:qty_str|null, status:enum, data_status:enum, as_of:ts` (T-31.1/31.3) |

> ใช้ envelope มาตรฐาน `BaseDoc` (`_id`,`type`,`schema_v`,`shelter_code`,`created_at`,`updated_at`,`created_by`). append หรือ overwrite เท่านั้น — ไม่ mutate in place.
> **Index:** `(_id)` (deterministic; `listRange` ใช้ bounded `startkey`/`endkey` = `daily_calc:{from}`..`daily_calc:{to}` ไม่สแกนทั้ง collection)

### 2.16 `purchase` — `purchase:{ulid}` · **schema_v 1**

> **schema_v 1** — doc type ใหม่ ([CR-032](../changes/CR-032-stock-ledger-purchase-reason.md)). บันทึกการจัดซื้อจัดจ้าง — แหล่งรับสต็อกที่แยกจากบริจาค เก็บผู้ขาย/เลขใบสั่งซื้อที่ `stock_ledger` (§2.1) ไม่มีที่เก็บให้
> **ไม่มี `status`** — CR-032 ตัด state machine (`ordered`→`received`) ออกจาก scope. คำถาม "รับของแล้วหรือยัง" **อนุมานจาก ledger**: มีแถว `stock_ledger` ที่ `reason=purchase` และ `ref_id = purchase._id` หรือยัง (mirror `donation` → `keyedDonationIds`)
> ของจริงเข้าคลังเมื่อ staff key รับเข้า → เขียน `stock_ledger` (`reason:purchase`, `ref_id=purchase._id`) ซึ่งเป็น **คนละ action กับตอนสร้างใบ** (CR-032 Option A — ไม่มี cross-doc atomic write). `items[]` = **planning signal เท่านั้น** ยอดจริงมาจาก ledger (data-model.md §4) เหมือน `donation.items`

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `vendor` | str | req | ชื่อผู้ขาย / หน่วยงานที่จัดหา |
| `po_ref` | str | opt | เลขใบสั่งซื้อ / สัญญา (อ้างระบบภายนอก) |
| `items` | [{`item_id`:str, `qty`:qty_str>0, `unit`:str}] | req | ≥1 รายการ — planning signal เท่านั้น |
| `occurred_at` | ts | req | วันที่รับของเข้าศูนย์ / วันที่จัดซื้อ (ISO-8601 UTC) |
| `note` | str | opt | — |

> ใช้ envelope มาตรฐาน `BaseDoc` (`_id`,`type`,`schema_v`,`shelter_code`,`created_at`,`updated_at`,`created_by`). append หรือ overwrite (LWW ผ่าน `touch()`) — ไม่ mutate in place.
> **Index:** `(occurred_at)` · การเช็คสถานะการรับใช้ index `(reason)` ของ `stock_ledger` แล้ว match `ref_id` — ไม่ต้องมี index บน `purchase`

**สถานะการรับ (derived — ห้ามเก็บใน doc)** — คำนวณจากยอดรวมของแถว `stock_ledger` ที่ `reason='purchase'` และ `ref_id = purchase._id` เทียบกับ `items[]` (CR-032 เคาะ 2026-07-25 · T-14 DoD บังคับให้ reconcile กับ ledger ผลต่าง = 0):

| สถานะ | เงื่อนไข |
| --- | --- |
| ยังไม่รับ | ไม่มีแถว ledger ที่ชี้มาที่ใบนี้ |
| รับบางส่วน | มี ≥1 แถว แต่ยังมี item ใน `items[]` ที่ยอดรวม < `qty` ที่สั่ง |
| รับครบ | ทุก item ใน `items[]` มียอดรวม **≥** `qty` ที่สั่ง |

> **รับเกินที่สั่ง = "รับครบ"** ไม่มีสถานะที่สี่ และ **ไม่ block ตอน key** (ของหน้างานมาเกินได้) · item ที่ key เข้ามาโดยไม่อยู่ใน `items[]` ไม่เปลี่ยนสถานะ · key ได้หลายรอบต่อ 1 ใบ (partial receive) — key ผิดแก้ด้วย correction entry `reason:'adjust'` ตาม T-11 DoD ไม่ใช่แก้แถวเดิม

**การแก้ไข** — แก้ `vendor` / `po_ref` / `items` / `occurred_at` / `note` ได้ **เฉพาะใบสถานะ "ยังไม่รับ"** (LWW `touch()`) · **ไม่มีการยกเลิก/ลบใบ** (ไม่มีฟิลด์สถานะยกเลิก) — ใบที่พิมพ์ผิดปล่อยค้างได้เพราะไม่กระทบยอดสต็อกซึ่งมาจาก ledger เท่านั้น · ห้ามแก้หลังเริ่มรับ เพราะ `items[]` เป็นตัวเทียบของสถานะข้างบน และเป็นฝั่ง "ที่สั่ง" ของ audit "จำนวนจริง vs ที่แจ้ง" (task-breakdown T-16)

**Migration:** doc type ใหม่ ไม่มี doc เดิมให้ migrate

### 2.17 `job` — `job:{ulid}` · **schema_v 3**

> **schema_v 3** — ประกาศภารกิจงานอาสาและกะย่อยรายวัน (CR-104). จัดการโดย Shelter Manager หรือ Volunteer Coordinator มีรายการกะย่อยรายวัน `shifts[]` (`shift_id`, `date`, `start_time`, `end_time`, `quota`, `slots_confirmed`, `slots_remaining`) โดยตัดรอบเวลา 00:00 น. ในกรณีงานข้ามคืน และคำนวณโควตารวมโดยอัตโนมัติ.
> schema_v 2 — กะย่อยรายวัน (CR-102).
> schema_v 1 — baseline ประกาศงานอาสา (CR-041).

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `title` | str | req | ชื่องาน เช่น "ผู้ช่วยจัดเตรียมวัตถุดิบและแจกจ่ายอาหารมื้อกลางวัน" |
| `description` | str\|null | opt | รายละเอียดภารกิจ สถานที่ และคำแนะนำการเตรียมตัว |
| `tier` | enum(`operational`,`staff-capable`) | req | `operational` = งานทั่วไปไม่ต้องมีบัญชี; `staff-capable` = งานช่วยคีย์ข้อมูลระบบที่ต้องออกสิทธิ์ชั่วคราว |
| `required_role` | str\|null | opt | RoleKey ที่ต้องเปิดสิทธิ์ให้กรณีเป็น `staff-capable` เช่น `"registration_staff"` |
| `auto_accept` | bool | req | `true` = อนุมัติตั๋วทันทีเมื่อโควตาว่าง (default `true` สำหรับ operational) |
| `shifts` | [`JobShiftItem`] | req | รายการกะย่อยรายวัน (ดูโครงสร้างย่อยด้านล่าง) |
| `quota` | int>0 | req | โควตารวมทั้งภารกิจ (คำนวณอัตโนมัติจากผลรวมของ `shifts[].quota`) |
| `slots_confirmed` | int≥0 | req | ยอดรับรวมทั้งภารกิจ (คำนวณอัตโนมัติจากผลรวมของ `shifts[].slots_confirmed`) |
| `slots_remaining` | int≥0 | req | ยอดยังขาดรวมทั้งภารกิจ (คำนวณอัตโนมัติจากผลรวมของ `shifts[].slots_remaining`) |
| `status` | enum(`draft`,`open`,`almost_full`,`full`,`paused`,`closed`,`cancelled`) | req | default `open` |

#### โครงสร้างย่อย `JobShiftItem`
* `shift_id`: `str` (req) — ไอดีเฉพาะของกะ เช่น `"sft_01J6M..."`
* `date`: `str` (req) — วันที่ปฏิบัติงาน รูปแบบ `YYYY-MM-DD`
* `start_time`: `str` (req) — เวลาเริ่ม เช่น `"08:00"`
* `end_time`: `str` (req) — เวลาสิ้นสุด เช่น `"12:00"` (กะข้ามคืนให้ตัดที่ 23:59 และ 00:00 ของวันถัดไป)
* `quota`: `int` (req) — จำนวนคนที่ต้องการในกะนี้
* `slots_confirmed`: `int` (req) — จำนวนคนที่ได้ตั๋วยืนยันแล้ว
* `slots_remaining`: `int` (req) — จำนวนคนที่ยังขาดอยู่ (`quota - slots_confirmed`)

> ใช้ envelope มาตรฐาน `BaseDoc` (`_id`,`type`,`schema_v`,`shelter_code`,`created_at`,`updated_at`,`created_by`).
> **Index:** `(status)` · `(tier, status)` · `(shelter_code, status)`

### 2.18 `job_application` — `job_application:{ulid}` · **schema_v 2**

> **schema_v 2** — ใบสมัครงานอาสาสมัครและตั๋วดิจิทัล (CR-104). รองรับการเลือกสมัครกะย่อย `shift_ids[]` หลายกะ, บันทึกข้อมูลผู้สมัคร `applicant` (ชื่อ-นามสกุล, เบอร์โทร, เลข ปชช. ทางเลือก), และออก `tracking_token` สำหรับสร้าง Digital Ticket QR Code.
> schema_v 1 — baseline ใบสมัครงาน (CR-041).

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `job_id` | str | req | → `job:{ulid}` (§2.17) |
| `shift_ids` | [str] | req | รายการ `shift_id` ภายใน `job.shifts[]` ที่เลือกสมัคร |
| `volunteer_id` | str\|null | opt | → `volunteer:{ulid}` (§2.8) |
| `applicant` | `{ first_name:str, last_name:str, phone:str, national_id?:str|null, skills:[str] }` | req | ข้อมูลผู้สมัคร (ไม่มีการเปิดเผย national_id บน public tier) |
| `tracking_token` | str | req | CSPRNG token สุ่มสำหรับเปิดดูตั๋วดิจิทัล QR Code |
| `status` | enum(`confirmed`,`pending_review`,`cancelled`) | req | default `confirmed` (เมื่อ auto_accept=true) |

> ใช้ envelope มาตรฐาน `BaseDoc` (`_id`,`type`,`schema_v`,`shelter_code`,`created_at`,`updated_at`,`created_by`).
> **Index:** `(job_id, status)` · `(tracking_token)` · `(volunteer_id, status)`

### 2.19 `donation_redirect` — `donation_redirect:{ulid}` · **schema_v 1**

> **schema_v 1** — doc type ใหม่ ([CR-087](../changes/CR-087-donation-redirect-target.md), T-16 R-16.4).
> ตั๋วที่ **ศูนย์ปลายทาง** ได้รับ เมื่อศูนย์อื่นรับของชิ้นนั้นไม่ได้แล้วส่งต่อมาให้พิจารณา.
> **ทำไมต้องเป็น doc แยก ไม่ใช่แค่ field:** DB แยกต่อศูนย์ (`shelter_{code}`) + shelter-scope isolation
> ⇒ `donation.redirect_to_shelter_code` (§2.3) ที่ยังอยู่ใน DB ต้นทาง **ปลายทางมองไม่เห็นเลย** ต้องมีของจริง
> เขียนเข้า DB ปลายทาง.
> เป็น **snapshot** ตอนส่งต่อ — ไม่ sync กลับไปหา donation ต้นทางอีก และไม่ copy donation ทั้งใบ (เลี่ยง PII ซ้ำ).

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `origin_shelter_code` | str | req | ศูนย์ต้นทางที่ส่งต่อมา |
| `origin_donation_id` | str | req | → `donation:{ulid}` **ข้าม DB** — เก็บไว้ให้ SA สอบย้อนกลับได้ (ปลายทางเปิดอ่านเองไม่ได้ตาม scope) |
| `booking_ref` | str\|null | opt | รหัสจองเดิม — ให้ปลายทางอ้างอิงกับ donor ได้ |
| `donor` | {`name`:str, `phone`:str\|null} | req | เท่าที่จำเป็นให้ติดต่อได้ — **ไม่ลาก** `phone_hash`/`line_id`/`email` ตามมา (data minimization) |
| `items` | [{`item_id`:str?, `free_text`:str?, `qty`:qty_str, `unit`:str, `category`:str?, `condition`:str?, `note`:str?}] | req | snapshot ของ `donation.items` ตอนส่งต่อ |
| `note` | str\|null | opt | หมายเหตุจากเจ้าหน้าที่ต้นทาง (≤500) |
| `status` | enum(`pending_review`) | req | ปลายทางเริ่มพิจารณาใหม่ตั้งแต่ต้น — **ไม่สืบทอด**สถานะของใบต้นทาง |

> ใช้ envelope มาตรฐาน `BaseDoc`; `shelter_code` = **ศูนย์ปลายทาง** (DB ที่ doc นี้อยู่), ต้นทางอยู่ใน `origin_shelter_code`.
> **ไม่ใช่ append-only** — เผื่อปลายทางอัปเดต `status` เมื่อมี flow พิจารณาตั๋วในภายหลัง (ยังไม่อยู่ในขอบเขต CR-087).
> **ห้ามเขียน `stock_ledger` ที่ศูนย์ต้นทาง** ตอนส่งต่อ — ของยังไม่เคยเข้าคลังที่ไหน (R-16.4 acceptance).
> **Index:** `(status)` · `(origin_shelter_code)`
>
> **หมายเหตุ:** สำหรับเอกสารเกณฑ์โภชนาการและการเติมสต็อกเสบียงระดับศูนย์ (`source = SHELTER_OVERRIDE`) ได้แก่ `food_sphere_standard`, `requirement_group`, และ `replenishment_policy` ให้ดูโครงสร้างฟิลด์ในหมวด [§4.6–§4.8](#46-food_sphere_standard--food_sphere_standardtarget_segmentreq_group_id--schema_v-1)

---

### 2.20 `simulation` — `simulation:{ulid}` · **immutable snapshot · schema_v 1** (CR-079 / T-42)

> ผลการจำลอง SOP แบบ what-if สำหรับการวางแผนล่วงหน้า ใช้ input snapshot เดียวกับ T-31 และ
> ใช้ engine เดียวกัน แต่ **ไม่เขียนทับ `daily_calc`** และไม่แก้ occupancy, active SOP,
> stock หรือ facilities จริง. `Run` ไม่ persist; `Save` สร้างเอกสารใหม่เท่านั้น และเอกสารที่บันทึกแล้ว
> ห้าม update. การลบทำได้เฉพาะ `shelter_manager`/`system_admin` ใน shelter scope ผ่าน CouchDB
> tombstone; การเปิดผลเดิมอ่าน `result` ที่ freeze ไว้โดยไม่ rerun engine.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `shelter_code` | str | req | ศูนย์เจ้าของ snapshot; ต้องตรงกับฐานข้อมูลและ `result.snapshot.shelter_code` |
| `created_at` / `updated_at` | ts / ts | req | immutable; ต้องมีค่าเท่ากัน |
| `created_by` | str | req | ผู้บันทึก; ต้องตรงกับ authenticated user |
| `result.input` | object | req | `{name:str, occupancy:int≥0, days:int 1..365, ratio_overrides:Partial<SOP_RATIO_KEYS>}` |
| `result.snapshot` | object | req | `shelter_code`, `as_of`, `formula_v`, effective SOP provenance, `current_occupancy`, `current_ratios`, `resource_inputs[]`, `stock_snapshot` |
| `result.current` | object | req | baseline occupancy/ratios, T-31 `daily_results[]` และ `horizon_results[]` |
| `result.scenario` | object | req | scenario occupancy/effective ratios, T-31 `daily_results[]` และ `horizon_results[]` |
| `result.comparison` | object[] | req | ต่อ resource: current/scenario ratio, daily need, horizon need, stock, gap, delta และ data status |

`resource_inputs[]`, `daily_results[]`, `horizon_results[]` และ `comparison[]` ต้องครอบคลุม
canonical SOP ratio keys ทั้ง 20 รายการและเรียงลำดับเดียวกัน. `ratio_overrides` ใช้ได้เฉพาะ
canonical keys และเก็บค่าเป็น `qty_str` ที่มากกว่า 0.

`horizon_results` ใช้ semantics จาก T-31: resource kind `multiply` คูณด้วย `days`,
`divide` ใช้ความต้องการพร้อมกันโดยไม่สะสมตามวัน และ `threshold` ไม่สะสมและไม่ใช้ Stock gap.
Stock snapshot ชุดเดียวกันถูกใช้ทั้ง Current และ Scenario; `null` แปลว่ายังไม่มีข้อมูล Stock.

> **Index:** `_id` (ULID). สิทธิ์บันทึกจำกัด `shelter_manager` ในศูนย์ตนเองและ `system_admin`
> ตามศูนย์ที่เลือก. Public HTTP API, forecast ที่ occupancy เปลี่ยนรายวัน, chart, export,
> sharing และ edit history ไม่อยู่ใน schema/Scope ของ CR-079.

---

## 3. DB `registry` (central-managed → pull ลง device; edge fallback replica)

### 3.1 `shelter` — `shelter:{ulid}`

> **schema_v 5** — เพิ่ม `site_kind` เพื่อแยกศูนย์อพยพกับบ้านพี่เลี้ยงโดยใช้ doc type `shelter` เดิม (CR-067).
> **schema_v 4** — ขยาย shelter form v4/v5: structured address, project level, key personnel,
> zone area/specifics, admission/luggage/parking policy และ risk/common-area เพิ่มเติม. CR-023.
> **schema_v 3** — เพิ่ม `feature_flags` (allow_pets, allow_vehicles, allow_assets) ควบคุม step ลงทะเบียน. CR-016.
> schema_v 2 — `capacity` เพิ่มเป็น required, `status` enum(`open`,`closed`). CR-004.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `code` | str | sys | code ที่อ่านออก เช่น `SH001` — **unique**, immutable; central mint ตอน provisioning (จาก `central_ops` counter §5.3) เป็นชื่อ db `shelter_{code}` + ใช้อ้างข้ามศูนย์ทุกที่ (`shelter_code`). pattern `^SH\d{3,}$`: เลข 1–999 pad 3 หลัก (`SH001`), ≥1000 ความกว้างตามจริง (`SH1000`) |
| `site_kind` | enum(`evacuation_center`,`host_house`) | req | ชนิดสถานที่; เอกสารเก่าที่ไม่มี field อ่านเป็น `evacuation_center`; ใช้ doc type และ code sequence เดิมร่วมกัน |
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
| `feature_flags` | {`allow_pets`:bool, `allow_vehicles`:bool, `allow_assets`:bool, `public_donations_enabled`:bool, `enable_medical_screening`:bool} | opt | default `allow_* = false`, `public_donations_enabled = true` (CR-048), `enable_medical_screening = false` (CR-106); ควบคุมฟีเจอร์ลงทะเบียน การคัดกรองการแพทย์ และการแสดงผลบน Public Needs Board |
| `edge_url` | str\|null | sys | base URL ของ LAN Edge fallback ศูนย์นั้น — ใช้เมื่อ WAN/central เข้าไม่ได้; ไม่ใช่ normal client remote |
| `opened_at` / `closed_at` | ts / ts\|null | sys | — |

**Migration (schema_v 3 → 4):** additive default-fill บน read/write — field ใหม่เติม `null`/`[]`/default object ตาม domain schema; `status` เดิม migrate เป็น `operation_status` (`open`→`active`, `closed`→`closed`).

**Migration (schema_v 4 → 5, CR-067):** `site_kind` เป็น required สำหรับ shelter ที่สร้าง/เขียนใหม่. Reader ของเอกสาร v4 ที่ไม่มี field ให้ default เป็น `evacuation_center` แบบ lazy; ไม่บังคับ backfill batch. เมื่อเอกสารเดิมถูกเขียนใหม่ ให้ persist `site_kind` และ `schema_v: 5`. `code` ยังคงใช้ pattern `SH\d{3,}` และ database name `shelter_{code}`; ไม่มี sequence `HH` แยก.

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

### 3.3 `master_data` — two-tier: `master_data:{master_type}` (global) / `master_data:{master_type}:{shelter_code}` (shelter-local) · **schema_v 3** (CR-012, CR-049)

> **schema_v 3** — เพิ่ม item field `status`; ลบ `excluded_codes` (mechanism ทิ้งทั้งหมด); item `code`
> ที่สร้างใหม่เป็น **ULID** (`item_{ulid}`) แทน slug. [CR-049](../changes/CR-049-shelter-scope-backoffice-vs-system-management.md).
> schema_v 2 — baseline two-tier (`shelter_code?` + `excluded_codes?` override-merge) — **แนวทางนี้ถูกยกเลิกโดย CR-049**
> (แทนด้วย concat, ดูด้านล่าง); schema_v 1 — global-only (CR-012).

> **Two tiers, deterministic `_id`, ไม่มี ULID ที่ระดับ doc:**
> - **Global** — `_id = "master_data:{master_type}"` (ไม่มี `shelter_code`) — central-managed, canonical
>   ข้ามศูนย์, จัดการที่ **System Management** (SA only write; ทุก authenticated role อ่านได้)
> - **Shelter-local** — `_id = "master_data:{master_type}:{shelter_code}"` (มี `shelter_code`) — จัดการที่
>   back-office ของศูนย์นั้น (SA + `shelter_manager` ของศูนย์ตน write)
>
> `_id` ยังเป็น deterministic ทั้งคู่ (ไม่เปลี่ยนเป็น ULID) — กัน doc ซ้ำต่อ type/ศูนย์ และรักษา
> idempotent re-seed. pull ลง device; edge fallback replica ต้อง include global doc ด้วย (ไม่มี `shelter_code`)
> มิฉะนั้นศูนย์ offline จะไม่เห็น global master data.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `master_type` | enum(7 type) | req | `vulnerable_group` \| `health_condition` \| `dietary_restrictions` \| `pet_types` \| `house_damage` \| `municipality_zone` \| `community` |
| `shelter_code` | str? | opt | มีเฉพาะ doc tier shelter-local — ระบุศูนย์เจ้าของ; ไม่มี field นี้ = global doc |
| `items` | [{`code`:str, `label`:str, `is_default`:bool, `status`:enum(`active`,`inactive`), `parent_code`:str?}] | req | ≥1 item; `code` = ULID (`item_{ulid}`) สำหรับ item ที่สร้างใหม่ — immutable; item เดิม (seed) ที่เป็น slug/semantic code (เช่น `municipality_zone` เดิม `zone_1`) ยังใช้ได้ต่อ ไม่ rewrite; `parent_code` ใช้สำหรับ `community` → อ้างถึง `code` ของ `municipality_zone` item |

**Item shape:**
```ts
interface MasterDataItem {
  code: string;                    // ULID (`item_{ulid}`) สำหรับ item ใหม่ — immutable; item เดิม (seed) อาจยังเป็น slug/semantic code
  label: string;                   // Thai display, editable
  is_default: boolean;             // 1 item per type = true (enforce)
  status: 'active' | 'inactive';   // default 'active'; soft-delete = set 'inactive' (ดูด้านล่าง)
  parent_code?: string;            // community เท่านั้น — ref code ของ municipality_zone
}
```

**Resolution / consumption (`scope: "global" | "shelter" | "effective"`):**
เนื่องจาก `code` เป็น ULID เสมอสำหรับ item ใหม่ global กับ shelter-local จึง **disjoint การันตี**
(ชนกันไม่ได้) → `scope: "effective"` คืนค่าด้วย **concat ล้วนๆ**: `global.items ++ shelterLocal.items`
— **ไม่มี dedup, ไม่มี override/merge ตาม code**. Global item เป็น **read-only** ที่ back-office (แก้/toggle
ได้เฉพาะที่ System Management, SA only); shelter-local item แก้/toggle ได้ที่ back-office ของศูนย์ตนเอง.
(แนวทางเดิม override-merge + `excluded_codes` ของ schema_v 2 **ถูกยกเลิก** — ดู CR-049 เหตุผล code collision)

**Soft-delete (`status`):** การ "ลบ" item = set `status: 'inactive'` — item **ยังอยู่ใน array เดิม**
(ไม่ hard-delete) เพื่อให้ record ที่อ้าง `code` นั้นอยู่แล้ว (เช่น `evacuee.special_needs`) resolve label
ได้ตลอด. Consumer ที่สร้าง selection (dropdown ตอนเลือกค่าใหม่) กรองเฉพาะ `status === 'active'`; consumer
ที่ทำ display/resolve label (แสดงค่าที่บันทึกไว้แล้ว) **ไม่กรอง** — ใช้ `find(code)?.label` ตรงๆ ไม่ว่า
`status` จะเป็นอะไร. doc เดิม (schema_v ≤2) ที่ไม่มี `status` ต่อ item ให้ default เป็น `active` ตอนอ่าน.

**Seed data (Hat Yai):** ข้อมูล `municipality_zone` (4 เขต) และ `community` (102 ชุมชน) มาจาก [Wikipedia — เทศบาลนครหาดใหญ่](https://th.wikipedia.org/wiki/%E0%B9%80%E0%B8%97%E0%B8%A8%E0%B8%9A%E0%B8%B2%E0%B8%A5%E0%B8%99%E0%B8%84%E0%B8%A3%E0%B8%AB%E0%B8%B2%E0%B8%94%E0%B9%83%E0%B8%AB%E0%B8%8D%E0%B9%88); รายละเอียด seed ใน CR-012 Appendix A. Seed code (`zone_1` เป็นต้น) เป็น slug/semantic ที่มีอยู่ก่อน CR-049 — คงไว้ ไม่ rewrite เป็น ULID.

**Migration (schema_v 2 → 3, CR-049):** เพิ่ม `status` ต่อ item (doc เดิมไม่มี → default `active` ตอนอ่าน);
ลบ `excluded_codes` ออกจาก schema (doc เดิมที่ยังมี field นี้ถูก ignore ตอนอ่าน — ไม่ error, ไม่ backfill
ลบทิ้ง); write ใหม่ทั้งหมด stamp `schema_v: 3`. ไม่มี production data ณ วันที่ bump → dev/staging reset ได้
ตาม pattern CR-019/CR-031 ไม่บังคับ migration script.

**Index:** `(master_type)` — global unique 1 doc ต่อ type; `(master_type, shelter_code)` — shelter-local unique 1 doc ต่อ type ต่อศูนย์

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

### 3.7 `shelter_import_log` — `shelter_import_log:{ulid}` · **schema_v 2** · **append-only** (CR-039, CR-077)

Log 1 doc ต่อ 1 batch ของการ import ศูนย์พักพิงจาก Excel. envelope กลาง (ไม่มี `shelter_code` —
เป็น registry doc). เขียนหลัง commit เสร็จ; ไม่แก้ย้อนหลัง.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `source` | enum(`shelter`) | req | ชนิดข้อมูลที่ import (ตอนนี้มีแค่ shelter) |
| `filename` | str | req | ชื่อไฟล์ที่อัปโหลด |
| `imported_by` | str | req | `name` ของผู้ import (จาก session) |
| `total_rows` | int | req | จำนวนแถวข้อมูล (ไม่รวม header) |
| `success_count` | int | req | สร้าง + อัปเดตสำเร็จ (`created_count + updated_count`) |
| `updated_count` | int | req (default 0) | จำนวนศูนย์ที่ถูกอัปเดตเพราะชื่อซ้ำ — **v2** |
| `skipped_count` | int | req (default 0) | จำนวนแถวที่ข้ามเพราะชื่อซ้ำ — **v2** |
| `error_count` | int | req | จำนวนแถวที่ล้มเหลว (validation + server) |
| `results` | array | req | ผลราย row — ดูรูปด้านล่าง |
| `started_at` | str (ISO) | req | เวลาเริ่ม commit |
| `finished_at` | str (ISO) | req | เวลาเสร็จ |

`results[]`: `{ row: int, name: str|null, status: 'created'|'updated'|'skipped_duplicate'|
'validation_error'|'server_error', code?: str (เมื่อ created/updated/skipped), existing_code?: str
(ศูนย์เดิมที่ถูกอัปเดตหรือถูกข้าม), errors?: [{ column: str, message: str, sheet?: str, line?: int }] }`

**ขอบเขตของ `results[]` (CR-077):** เก็บไม่เกิน **200 แถวแรก** และ `message` ยาวไม่เกิน **200 ตัวอักษร**
(เกินแล้วตัดท้ายด้วย `…`) — กันไม่ให้ doc บวมและกันไม่ให้ข้อความที่ยกค่าจากเซลล์ติดลงไปทั้งก้อน.
`total_rows` / counters ยังนับครบทุกแถวเสมอ.

**v1 → v2 (CR-077, additive):** doc รุ่น v1 ไม่มี `updated_count` / `skipped_count` — อ่านกลับได้ตามปกติ
(Zod ใส่ค่า default 0) **ไม่มี migration script**.

**เขียน/อ่าน:** system_admin เท่านั้น (เป็น member ของ registry). อ่านตรงจาก browser ผ่าน
`createRemoteRepository('registry')`; live-sync ผ่าน changes feed ของ registry (เหมือน `shelter`).

---

### 3.8 `scanner_device` — `scanner_device:{device_id}` · **schema_v 1** (CR-084)

ทะเบียนอุปกรณ์เครื่องอ่านบัตรประชาชน Smart Card Kiosk ประจำศูนย์พักพิง (Hardware Registry). เป็น registry doc กลางสำหรับ Authentication ตรวจสอบ API Key/Secret และกำกับสิทธิ์การ Inbound สแกนบัตรเข้าสู่ฐานข้อมูลศูนย์พักพิง.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `device_id` | str | req | unique id ของเครื่อง (เช่น `"kiosk-01"`, `"kiosk-test"`) |
| `name` | str | req | ชื่อเรียกเครื่อง (เช่น `"จุดคัดกรองหน้าประตู 1"`) |
| `shelter_code` | str | req | รหัสศูนย์พักพิงที่เครื่องนี้สังกัด (เช่น `"SH001"`) |
| `station_name` | str | req | จุดติดตั้ง/สถานีคัดกรอง (default `"จุดคัดกรองทั่วไป"`) |
| `secret_hash` | str | req | SHA-256 hash ของ Device Secret สำหรับ Inbound Authentication |
| `secret_prefix` | str | req | 16 ตัวอักษรแรกของ secret เพื่อแสดงในหน้าตั้งค่า (เช่น `"sk_scan_a1b2c3d4..."`) |
| `status` | enum(`active`,`inactive`) | req | สถานะเปิด/ปิดการใช้งานเครื่อง |
| `last_seen_at` | ts\|null | sys | Timestamp ที่เครื่องยิง API ล่าสุด (Heartbeat) |

**Index:** `(device_id)` · `(shelter_code)`

> ❓ **Architecture Open Question (Registry vs Shelter DB):**
> - **ปัจจุบัน (Design Choice):** เก็บไว้ที่ DB `registry` ตรงกลาง เพื่อให้ Inbound API (`/api/v1/scanner/draft`) สามารถ lookup ตรวจสอบ `device_id` และ `secret_hash` ได้อย่างรวดเร็วใน 1 query โดย Client ไม่จำเป็นต้อง hardcode หรือส่ง `shelter_code` มาใน Request Header
> - **ประเด็นพิจารณาในอนาคต (Future Consideration):** หากต้องการให้ศูนย์พักพิงมีอิสระในการเพิ่ม/จัดการเครื่องเอง (Shelter Autonomy) หรือรองรับ Edge Node ที่เน็ตตัดขาด อาจพิจารณาย้าย `scanner_device` ไปเก็บไว้ใน `shelter_{shelter_code}` โดยมีข้อกำหนดว่า Client Kiosk จะต้องส่ง Header `X-Shelter-Code` แนบมากับทุก request ด้วย

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

### 4.4 `sop_profile` — `sop_profile:{slug}:{version}`

> **schema_v 3** — อัปเดต ratios whitelist 3 → 20 canonical keys (CR-006 amendment 2026-06-25 + CR-021). เพิ่ม `SOP_RATIO_KIND` (multiply/divide/threshold) สำหรับ calc engine (T-31).
> **Migration Note:** `schema_v` bumped due to CR-006 / CR-021. No production backfill needed. Devs must re-run the seed script (which now auto-overwrites) or delete stale catalog docs. **Breaking Change:** Legacy 3-key ratios (rice_g_per_person_meal, toilet_per_person) removed. All 20 canonical keys required; no auto-mapping from legacy keys. Devs must re-run seed or delete stale docs.
> schema_v 2 — ย้ายมาอยู่ catalog DB, ตัด `shelter_code` ออกเพื่อใช้เป็น Master Profile ส่วนกลาง (ตาม [CR-006](../changes/CR-006-sop-profile-master-override.md) และ [CR-015](../changes/CR-015-sop-ratio-schema-two-tier.md))

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `_id` | str | req | `sop_profile:{slug}:{version}` — แต่ละ immutable version ถูกบันทึกเป็น ID ในรูปแบบ `{slug}:{version}` (เช่น `sop_profile:sphere-baseline:2`) |
| `name` | str | req | เช่น "Sphere baseline", "ปภ. มาตรฐาน" |
| `slug` | str | req | Stable canonical slug used to group immutable version history; e.g. `"sphere-baseline"`. `slug` จะคงที่ข้ามเวอร์ชันของ profile เดียวกัน ในขณะที่ `version` เพิ่มขึ้นตามลำดับ |
| `ratios` | {`water_l_per_person_day`:qty_str, `drinking_water_l_per_person_day`:qty_str, `cooking_water_l_per_person_day`:qty_str, `hygiene_water_l_per_person_day`:qty_str, `kcal_per_adult_day`:qty_str, `people_per_tap`:qty_str, `people_per_handpump`:qty_str, `people_per_open_well`:qty_str, `people_per_laundry`:qty_str, `people_per_bathing`:qty_str, `people_per_toilet_female`:qty_str, `people_per_toilet_male`:qty_str, `people_per_dining_point_adult`:qty_str, `people_per_dining_point_child`:qty_str, `m2_per_person_living`:qty_str, `m2_per_person_living_cold`:qty_str, `m2_per_person_total`:qty_str, `max_waterpoint_distance_m`:qty_str, `max_queue_minutes`:qty_str, `people_per_volunteer`:qty_str} | req | ratios ต้องระบุคีย์ครบถ้วน (Full Ratios Requirement) ใช้ 20-key strict schema ทั้ง Master และ Override |
| `version` | int | req | เลขเวอร์ชันของ profile ภายใต้ `slug` นั้น (เริ่มจาก 1) |
| `active` | bool | req | (Backward-compatible projection only) `sop_profile_active:global` pointer เป็น **Authoritative Active State** เพียงหนึ่งเดียวในการตัดสิน active master (`active_profile_id`, `active_slug`, `active_version`). ค่า `sop_profile.active` บนเอกสาร profile รายตัวเป็นเพียง read-model / projection ห้ามนำมาตัดสิน active master |

> **Legacy Compatibility Note:** เอกสาร catalog ในอดีตก่อนการเปลี่ยนสเปก T-30 อาจมีรูปแบบ ID เดิม (เช่น `sop_profile:{ulid}` หรือ `sop_profile:{name}`) และอาจไม่มี field `slug` (ซึ่ง repository จะคำนวณ `slug` จาก `name` เมื่ออ่านเอกสารเก่า). เอกสาร Master SOP ใหม่ทั้งหมดที่เขียนด้วย T-30 จะใช้ ID รูปแบบ `sop_profile:{slug}:{version}` และต้องมี field `slug` เสมอ. ไม่มีสัญญาในการทำ automatic batch migration, backfill หรือ cross-document referential integrity validation.

### 4.5 `sop_profile_active` — `sop_profile_active:global` (Singleton Pointer)

> **schema_v 1** — Singleton coordination document สำหรับตัดสิน Active Master SOP Profile เพียงหนึ่งเดียวทั่วทั้งระบบผ่าน Optimistic Concurrency Control (CAS) ด้วย `_rev` (ผ่าน `putDoc` ด้วย `{ onConflict: 'throw' }`). **ข้อจำกัดการตรวจสอบของ CouchDB:** ฟังก์ชัน `validate_doc_update` ของ CouchDB ทำงานตรวจสอบความถูกต้องของเอกสารแต่ละฉบับแยกจากกันแบบเดี่ยว (Single-document isolation) จึงตรวจสอบได้เฉพาะโครงสร้าง field, schema_v และ immutable fields ของ pointer เอง แต่ไม่สามารถทำ cross-document validation เพื่อรับรองว่า `active_profile_id` อ้างอิงไปยังเอกสาร `sop_profile` ที่มีอยู่จริงใน database ได้

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `_id` | str | req | บังคับเป็น `"sop_profile_active:global"` |
| `active_profile_id` | str | req | ID เอกสาร `sop_profile` ที่เป็น Master Active หลัก |
| `active_slug` | str | req | Slug ของ Master Active หลัก |
| `active_version` | int | req | เลขเวอร์ชันที่กำลังใช้งานอยู่ |
| `updated_at` | str | req | เวลา ISO-8601 UTC |
| `updated_by` | str | req | ผู้ดำเนินการอัปเดต |

### 4.6 `food_sphere_standard` — `food_sphere_standard:{target_segment}:{req_group_id}` · **schema_v 1**

> **schema_v 1** — กำหนดเกณฑ์มาตรฐานปริมาณความต้องการสารอาหารและเสบียงต่อคนต่อวัน อ้างอิงตามมาตรฐาน Sphere Handbook (CR-058, CR-095)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `_id` | str | req | รูปแบบ `"food_sphere_standard:{target_segment}:{req_group_id}"` เช่น `"food_sphere_standard:ALL:FOOD_ENERGY"` หรือ `"food_sphere_standard:INFANT_0_6:FOOD_ENERGY"` |
| `_rev` | str | sys | MVCC revision ของ CouchDB |
| `type` | str | req | บังคับเป็น `"food_sphere_standard"` |
| `schema_v` | int | req | เวอร์ชันของสกีมา เริ่มต้น `1` |
| `target_segment` | enum(`ALL`,`INFANT_0_6`,`INFANT_6_23`,`CHILD_2_5`,`PREGNANT`,`LACTATING`,`ELDERLY`) | req | กลุ่มเป้าหมายประชากร |
| `req_group_id` | str | req | รหัสกลุ่มความต้องการ (Raw group ID เช่น `"FOOD_ENERGY"`, `"FOOD_FAT"`, `"FOOD_PROTEIN"` อ้างอิงเอกสาร `requirement_group:{group_id}`) |
| `daily_demand` | num>0 | req | ปริมาณความต้องการต่อคนต่อวัน (> 0) เช่น `2100` |
| `standard_uom` | str | opt | หน่วยนับมาตรฐานที่แสดงผล (ดึงค่าตั้งต้นจาก `requirement_group.standard_uom`) เช่น `"kcal"`, `"gram"` |
| `effective_date` | str | req | วันที่มีผลบังคับใช้ รูปแบบ ISO Date (`YYYY-MM-DD`) |
| `status` | enum(`active`,`inactive`) | req | สถานะการใช้งาน: `active` = นำไปคำนวณ demand, `inactive` = ปิดการใช้งาน (Soft-deleted) (ค่าเริ่มต้น `active`, read fallback `active`) |
| `source` | enum(`SPHERE_BASELINE`,`SHELTER_OVERRIDE`) | req | แหล่งที่มา: `SPHERE_BASELINE` (ส่วนกลางใน catalog DB) หรือ `SHELTER_OVERRIDE` (เฉพาะศูนย์ใน `shelter_{shelter_code}` DB) |
| `shelter_code` | str | opt | มีค่าเฉพาะเมื่อ `source = SHELTER_OVERRIDE`; ไม่มีเมื่อเป็น `SPHERE_BASELINE` (ใช้ตรวจ doc หลง db) |
| `created_at` / `updated_at` | ts | req | เวลาสร้าง / ปรับปรุงเอกสาร (ISO-8601 UTC) |
| `created_by` | str | req | Username ของผู้สร้างหรือแก้ไขข้อมูล |
| `updated_by` | str | opt | Username ของผู้แก้ไขล่าสุด (audit trail); opt เพื่อให้สอดคล้องกับ Common Envelope §0 |

**Soft-delete & Calculation rules (`status`):**
- **ห้ามทำ Hard-Delete (`repo.remove()`) เด็ดขาด:** การลบให้ปรับสถานะเป็น `{ status: 'inactive', updated_at: now() }` เพื่อป้องกัน Orphaned References และไม่ให้ประวัติการคำนวณย้อนหลังใน `daily_calc` เสียหาย (Delete-in-use Policy ตาม CR-053 / §3.3)
- **การกู้คืน (Reactivate):** รองรับ action ให้ผู้ใช้เปิดใช้งานกลับมาเป็น `status: 'active'` ได้ตลอดเวลา
- **Dropdown & Form rules:** ฟอร์มสร้างใหม่กรองเฉพาะ `status === 'active'`; ฟอร์มแก้ไขและตารางประวัติ/Audit trail ไม่กรองทิ้ง สามารถ resolve ค่าเดิมได้แม้เป็น inactive
- **Calculation Engine (`food-sphere-calc.ts`):** กรองเฉพาะเกณฑ์ที่ `(s.status ?? 'active') === 'active'` หากกลุ่มใดไม่มีเกณฑ์ active ให้ demand เป็น `0`
- **Backward compatibility:** Additive `schema_v: 1` ไม่ bump เวอร์ชัน, read-time fallback เป็น `'active'`, ไม่ต้อง batch migration

**Index & Views:**
- Primary Key lookup: `food_sphere_standard:{target_segment}:{req_group_id}`
- Mango index: `(type, target_segment, req_group_id, effective_date)`

---

### 4.7 `requirement_group` — `requirement_group:{group_id}` · **schema_v 1**

> **schema_v 1** — กลุ่มความต้องการสารอาหารหลักและเกณฑ์การแปลงหน่วยสินค้าเข้าสู่มาตรฐานโภชนาการ (CR-058, CR-095)  
> **ID Pattern:** ใช้ prefix `requirement_group:` (เช่น `requirement_group:FOOD_ENERGY`)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `_id` | str | req | รูปแบบ `"requirement_group:{group_id}"` เช่น `"requirement_group:FOOD_ENERGY"` |
| `_rev` | str | sys | MVCC revision ของ CouchDB |
| `type` | str | req | บังคับเป็น `"requirement_group"` |
| `schema_v` | int | req | เวอร์ชันของสกีมา เริ่มต้น `1` |
| `name` | str | req | ชื่อแสดงผลภาษาไทย เช่น `"พลังงานอาหาร"`, `"ไขมัน"`, `"โปรตีน"` |
| `standard_uom` | str | req | หน่วยนับมาตรฐานประจำกลุ่ม เช่น `"kcal"`, `"gram"`, `"litre"` (ใช้ Auto-fill ในหน้าจอกำหนด Sphere) |
| `status` | enum(`active`,`inactive`) | req | สถานะการใช้งาน: `active` = ใช้งานปกติ, `inactive` = ปิดการใช้งาน (Soft-deleted) (ค่าเริ่มต้น `active`, read fallback `active`) |
| `item_maps` | [{`item_id`:str, `base_uom`:str, `conversion_factor`:num>0, `share_percent`:num?}] | opt | รายการสินค้าที่จับคู่เข้ากลุ่มความต้องการนี้ (ดูโครงสร้างย่อยด้านล่าง) |
| `source` | enum(`SPHERE_BASELINE`,`SHELTER_OVERRIDE`) | req | แหล่งที่มา: `SPHERE_BASELINE` (ส่วนกลางใน catalog DB) หรือ `SHELTER_OVERRIDE` (เฉพาะศูนย์ใน `shelter_{shelter_code}` DB) |
| `shelter_code` | str | opt | มีค่าเฉพาะเมื่อ `source = SHELTER_OVERRIDE`; ไม่มีเมื่อเป็น `SPHERE_BASELINE` (ใช้ตรวจ doc หลง db) |
| `created_at` / `updated_at` | ts | req | เวลาสร้าง / ปรับปรุงเอกสาร (ISO-8601 UTC) |
| `created_by` | str | req | Username ของผู้สร้างหรือแก้ไขข้อมูล |
| `updated_by` | str | opt | Username ของผู้แก้ไขล่าสุด (audit trail); opt เพื่อให้สอดคล้องกับ Common Envelope §0 |

**โครงสร้างย่อย `item_maps[]`:**
- `item_id`: `str (req)` — อ้างอิง `item_master:{sku|ulid}`
- `base_uom`: `str (req)` — หน่วยนับพื้นฐานของสินค้า (Read-only อ้างอิงจาก `item_master`)
- `conversion_factor`: `num>0 (req)` — ตัวคูณแปลงจาก Base UOM ไปเป็น Standard UOM
- `share_percent`: `num (opt)` — สัดส่วนเป้าหมายในเมนู (0–100%); validation warning เมื่อผลรวมในกลุ่ม ≠ 100% แต่ไม่บล็อก save

**Soft-delete & Dropdown rules (`status`):**
- **ห้ามทำ Hard-Delete (`repo.remove()`) เด็ดขาด:** การลบให้ปรับสถานะเป็น `{ status: 'inactive', updated_at: now() }` ป้องกัน orphaned references; รองรับการ Reactivate กลับเป็น `active` ได้ตลอดเวลา
- **Dropdown & Form rules:** Dropdown ในการเลือกกลุ่มความต้องการ (หน้าเกณฑ์โภชนาการ หรือหน้านโยบายเติมสต็อก) กรองเฉพาะ `status === 'active'`; ฟอร์มแก้ไขและ audit trail ไม่กรองทิ้ง สามารถ resolve ชื่อกลุ่มและ UOM ได้ตามปกติ
- **Backward compatibility:** Additive `schema_v: 1` ไม่ bump เวอร์ชัน, read-time fallback เป็น `'active'`, ไม่ต้อง batch migration

**Index & Views:**
- Primary Key lookup: `requirement_group:{group_id}`
- Mango index: `(type, name)`

---

### 4.8 `replenishment_policy` — `replenishment_policy:{scope_type}:{target_id}` · **schema_v 1**

> **schema_v 1** — นโยบายการเติมสต็อกและเกณฑ์ความปลอดภัยสำหรับแจ้งเตือน Days of Coverage (DoC) (CR-058, CR-095, Task T-22)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `_id` | str | req | รูปแบบ `"replenishment_policy:{scope_type}:{target_id}"` เช่น `"replenishment_policy:GLOBAL:DEFAULT"` หรือ `"replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY"` |
| `_rev` | str | sys | MVCC revision ของ CouchDB |
| `type` | str | req | บังคับเป็น `"replenishment_policy"` |
| `schema_v` | int | req | เวอร์ชันของสกีมา เริ่มต้น `1` |
| `scope_type` | enum(`GLOBAL`,`REQUIREMENT_GROUP`,`ITEM`) | req | ขอบเขตนโยบาย: `GLOBAL`, `REQUIREMENT_GROUP`, `ITEM` |
| `target_id` | str | req | รหัสเป้าหมายตามขอบเขต: `GLOBAL` → `"DEFAULT"` · `REQUIREMENT_GROUP` → เช่น `"FOOD_ENERGY"` · `ITEM` → เช่น `"item_master:RICE_5KG"` |
| `lead_time_days` | int≥0 | req | ระยะเวลารอคอยสินค้า (วัน) เช่น `2` |
| `review_period_days` | int≥0 | req | รอบระยะเวลาตรวจนับ/สั่งเติม (วัน) เช่น `3` |
| `safety_days` | int≥0 | req | วันสำรองเผื่อฉุกเฉิน (วัน) เช่น `2` |
| `min_doc_days` | int≥0 | req | DoC จุดวิกฤต (วัน) — เมื่อ DoC ต่ำกว่าค่านี้จะระบุ alert สั่งซื้อจำเป็น; ต้อง $< \text{Standard Reorder Days}$ และ $< \text{max\_doc\_days}$ |
| `max_doc_days` | int≥0 | req | DoC เพดานสูงสุด (วัน) — เมื่อ DoC เกินค่านี้จะระบุ Overstock alert; ต้อง $> \text{min\_doc\_days}$ |
| `status` | enum(`active`,`inactive`) | req | สถานะการใช้งาน: `active` = มีผลประเมิน DoC, `inactive` = ปิดการใช้งาน (Soft-deleted) (ค่าเริ่มต้น `active`, read fallback `active`) |
| `source` | enum(`SPHERE_BASELINE`,`SHELTER_OVERRIDE`) | req | แหล่งที่มา: `SPHERE_BASELINE` (ส่วนกลางใน catalog DB) หรือ `SHELTER_OVERRIDE` (เฉพาะศูนย์ใน `shelter_{shelter_code}` DB) |
| `shelter_code` | str | opt | มีค่าเฉพาะเมื่อ `source = SHELTER_OVERRIDE`; ไม่มีเมื่อเป็น `SPHERE_BASELINE` (ใช้ตรวจ doc หลง db) |
| `created_at` / `updated_at` | ts | req | เวลาสร้าง / ปรับปรุงเอกสาร (ISO-8601 UTC) |
| `created_by` | str | req | Username ของผู้สร้างหรือแก้ไขข้อมูล |
| `updated_by` | str | opt | Username ของผู้แก้ไขล่าสุด (audit trail); opt เพื่อให้สอดคล้องกับ Common Envelope §0 |

**Soft-delete & Policy Resolution rules (`status`):**
- **ห้ามทำ Hard-Delete (`repo.remove()`) เด็ดขาด:** การลบให้ปรับสถานะเป็น `{ status: 'inactive', updated_at: now() }`; รองรับการ Reactivate กลับเป็น `active` ได้ตลอดเวลา
- **Dropdown & Form rules:** Dropdown ในการเลือก Target กรองเฉพาะ `status === 'active'`; ฟอร์มแก้ไขและ audit trail ไม่กรองทิ้ง
- **DoC & Policy Resolution (`food-sphere-table.ts`):** ฟังก์ชัน `resolveItemPolicy` จะเลือกเฉพาะนโยบายที่มีสถานะ `(p.status ?? 'active') === 'active'` ตามลำดับ Priority (`ITEM` $\rightarrow$ `REQUIREMENT_GROUP` $\rightarrow$ `GLOBAL`) ถ้านโยบายถูกปิดใช้งาน จะ fallback ตกไปใช้นโยบายระดับถัดไป
- **Backward compatibility:** Additive `schema_v: 1` ไม่ bump เวอร์ชัน, read-time fallback เป็น `'active'`, ไม่ต้อง batch migration

**Index & Views:**
- Primary Key lookup: `replenishment_policy:{scope_type}:{target_id}`
- Mango index: `(type, scope_type, target_id)`

---

## 5. DB `central_ops` (central เท่านั้น)

### 5.1 `search_audit` — `search_audit:{ulid}` · **append-only**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `query_kind` | enum(`name`,`phone`,`national_id`,`passport`) | req | ชนิด query ที่ parse ได้จาก public occupants search (CR-044, path CR-065) |
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

### 5.4 `referral` — `referral:{ulid}` · state machine (CR-045, CR-046, Centralized Architecture)

> **การจัดเก็บข้อมูลแบบรวมศูนย์ (Centralized Cross-Tenant Database):**
> เอกสารส่งต่อทุกประเภท (`capacity`, `resource`, `medical-emergency`) จัดเก็บรวมกันในฐานข้อมูลกลาง `central_ops` โดยตรง (ไม่ใช่ `shelter_{shelter_code}`) เพื่อรองรับการทำงานข้ามศูนย์แบบไร้รอยต่อโดยไม่ต้อง Mirror เอกสารระหว่างฐานข้อมูล

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `evacuee_id` | str | req | — |
| `evacuee_summary` | {`first_name`:str, `last_name`:str, `gender`:str?} | opt | สแนปชอตชื่อ-นามสกุล และเพศของผู้ประสบภัยสำหรับให้ศูนย์ปลายทางแสดงผลได้ทันทีก่อนตอบรับ |
| `referral_type` | enum(`capacity`,`resource`,`medical-emergency`) | req | default `medical-emergency` (CR-045) |
| `shelter_code` | str | req | รหัสศูนย์พักพิงต้นทางผู้สร้างคำร้อง |
| `to_shelter_code` | str | opt | รหัสศูนย์พักพิงปลายทาง (ระบุเมื่อ `referral_type` = `capacity`) |
| `to_org` | {`name`:str?, `kind`:enum(`hospital`,`social_services`,`other`)?, `contact`:str?} | opt | หน่วยงานปลายทาง (ระบุเมื่อ `referral_type` ≠ `capacity`) |
| `reason` | str | req | — |
| `response_reason` | str | opt | เหตุผลประกอบการตอบรับ (`accepted`) หรือปฏิเสธ (`rejected`) (CR-045) |
| `urgency` | enum(`normal`,`urgent`) | req | — |
| `status` | enum(`draft`,`sent`,`accepted`,`rejected`,`closed`) | req | forward-only — ดู transitions ด้านล่าง |
| `timeline` | {`sent`:{at,by}?, `responded`:{at,by}?, `closed`:{at,by}?} | sys | — |
| `notes` | str | opt | — |

**Status transitions (forward-only):**

```
draft    → sent | closed     (closed = ยกเลิกร่างก่อนส่ง — CR-046)
sent     → accepted | rejected
accepted → closed
rejected → closed
closed   → (terminal)
```

> **Cross-Tenant Flow & Scope Isolation (Centralized Architecture):**
> 1. **Central Database Storage:** คำร้องถูกสร้างและอัปเดตสถานะใน DB `central_ops` โดยตรง ผ่าน BFF Endpoints (`/api/back-office/referral` และ `/api/back-office/referral/[id]/transition`)
> 2. **Multi-Tenant Scope Isolation:** การเข้าถึงข้อมูลถูกควบคุมในระดับ BFF Server (`+server.ts`):
>    - `GET /api/back-office/referral` (list): กรองเฉพาะรายการที่ `shelter_code === shelterCode` (ต้นทาง) หรือ `to_shelter_code === shelterCode` (ปลายทาง) ด้วย Mango query `$or`
>    - `GET /api/back-office/referral/[id]` (single): ตรวจสอบสิทธิ์ `caller.isSA || doc.shelter_code === shelterCode || doc.to_shelter_code === shelterCode` หากไม่ใช่จะส่งคืน `403 Forbidden`
> 3. **Destination-gated Accept/Reject:** เฉพาะศูนย์ปลายทาง (`to_shelter_code`) เท่านั้นที่มีสิทธิ์กด `accepted` / `rejected` สำหรับ `capacity` referral (ตรวจสอบด้วย `assertActorMayTransition`)
> 4. **Cross-DB Transfer on Accept:** เมื่อมีการ `accepted` คำร้องประเภท `capacity` ระบบ BFF จะทำ cross-DB transfer อัตโนมัติ (เขียน `transfer_in` ที่ศูนย์ปลายทาง และ `transfer_out` ที่ศูนย์ต้นทาง) ก่อนอัปเดตสถานะใน `central_ops`
>
> **Indexes (Mango indexes deployed in `central_ops`):**
> - `referral-type-status-idx`: `['type', 'status']`
> - `referral-type-evacuee-idx`: `['type', 'evacuee_id']`
> - `referral-type-shelter-created-idx`: `['type', 'shelter_code', 'created_at']`
> - `referral-type-toshelter-created-idx`: `['type', 'to_shelter_code', 'created_at']`
> - `referral-list-sort-idx`: `['type', 'created_at', 'status', 'evacuee_id']`
> - `referral-list-basic-idx`: `['type', 'created_at']`

### 5.5 `stock_transfer` — `stock_transfer:{ulid}` · state machine (forward-only, CR-059, Centralized Architecture)

> **ย้ายมาจาก `shelter_{shelter_code}` (§2.2 เดิม, superseded) — CR-059, approved 2026-08-22:**
> เอกสารประเภท `stock_transfer` จัดเก็บรวมกันในฐานข้อมูลกลาง `central_ops` โดยตรง (ไม่ใช่
> `shelter_{shelter_code}`) แบบเดียวกับ `referral` (§5.4) เพื่อรองรับ real-time sync สถานะข้ามศูนย์โดยไม่
> ต้องพึ่ง session เขียนข้าม DB — ดูเหตุผลและรายละเอียดสถาปัตยกรรมเต็มที่
> `docs/changes/CR-059-inventory-requisition-inter-shelter-transfer.md` หัวข้อ "🏗️ การตัดสินใจทาง
> สถาปัตยกรรม"
>
> **`schema_v` ไม่ bump** (คงที่ 2 เดิม) — ย้าย location เท่านั้น ไม่ได้เปลี่ยนรูปร่าง doc (นิยามตาม
> `docs/change-management.md` §4) พร้อม precedent จาก `referral` ที่ย้าย DB แบบเดียวกันแล้วไม่ bump
> เช่นกัน (§2.11/§5.4) — ดูรายละเอียดเต็มใน CR-059 Decision Log entry 2026-08-22 ("T-13 write-path
> implementation detail")

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `from_shelter` / `to_shelter` | str | req | shelter_code (เช่น `SH001`) — canonical doc เดียวใน `central_ops`, ไม่ replicate ผ่าน central แบบเดิมอีกต่อไป |
| `items` | [{`item_id`:str, `qty`:qty_str>0, `unit`:str}] | req | ≥1 รายการ |
| `status` | enum(`requested`,`shipped`,`received`,`cancelled`) | req | forward-only: received > shipped > requested; cancelled ได้ก่อน shipped เท่านั้น |
| `timeline` | {`requested`:{at,by}, `shipped`:{at,by}?, `received`:{at,by}?} | req/sys | เติมตาม transition |
| `notes` | str | opt | — |

แต่ละ transition เขียน `stock_ledger` คู่ที่ `shelter_{shelter_code}` ของแต่ละฝั่งตามปกติ (เฉพาะ doc
`stock_transfer` เองเท่านั้นที่ย้ายมา `central_ops` — `stock_ledger` ไม่ย้าย): shipped → `transfer_out`
(−) ฝั่งต้นทาง; received → `transfer_in` (+) ฝั่งปลายทาง

> **Write path (CR-059, approved architecture):** เขียนผ่าน BFF Endpoints ที่
> `frontend/src/routes/api/back-office/transfer/**` ด้วย `adminRaw` (`$lib/server/couch-admin.ts`) แบบ
> เดียวกับ `referral` (§5.4) — client เลิกเขียน `stock_transfer` ตรงผ่าน `/couch` proxy · Mirror-write
> สองทาง: `shipped` → mirror เข้า `shelter_{to_shelter}` (แบบ referral `sent`), `received` → mirror
> ย้อนกลับเข้า `shelter_{from_shelter}` (ของใหม่ ไม่มีใน referral) เพื่อให้แต่ละศูนย์เห็นสำเนาผ่าน
> `_changes` feed ที่ subscribe อยู่แล้ว — รายละเอียด implementation ระดับ write-order/authorization guard
> (deterministic ledger id, critical/best-effort write tier) ยังเป็น proposed (ยังไม่ confirm กับ project
> owner อย่างเป็นทางการ) ดู CR-059 Decision Log entry 2026-08-22 ("T-13 write-path implementation detail")
>
> **ยังไม่ approve ในรอบนี้ (CR-059):** field ละเอียดเพิ่มเติม — บังคับกรอกผู้ขับขี่/ทะเบียนรถก่อนอนุมัติ
> ส่งมอบ, การจัดสรรเบิกข้ามล็อต ("+ แบ่งจากอีกล็อต/โซน"), Destination Lot ID ใหม่ปลายทาง, สิทธิ์
> คัดค้าน/ระงับคำสั่ง — รอ approve schema_v รอบใหม่แยกต่างหากก่อนเพิ่มเข้า field table นี้

---

## 6. DB `_users` (CouchDB system DB — central-managed)

CouchDB `_users` DB ไม่ใช่ operational doc ธรรมดา — ไม่มี common envelope; managed ผ่าน `/api/v1/users`
(ห่อ CouchDB admin API, central เท่านั้น) เอกสารนี้ระบุเฉพาะ field ที่โครงการ extend เพิ่มเข้า `_users` doc ตาม **CR-093 / CR-104 / CR-105 (Compound Scoped Roles, Profile Metadata, Security Questions, and Passphrase Reset)**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | CouchDB username — เบอร์โทรศัพท์มือถือ 10 หลัก (สำหรับเจ้าหน้าที่/อาสา) หรือ alphanumeric (สำหรับ `sa01`/System Admin) |
| `password` | str | req | CouchDB hash จัดการโดย CouchDB เอง |
| `display_name` | str\|null | opt | ชื่อ-นามสกุลแสดงผล (UI บังคับกรอกตอนสร้าง) |
| `roles` | [str] | req | Compound Scoped Roles: อย่างใดอย่างหนึ่ง — (a) `["system_admin"]` (Global Admin เข้าถึงได้ทุกศูนย์) หรือ (b) `["shelter:SH001", "shelter:SH002", "SH001:registration_staff", "SH002:medical_staff"]` (กุญแจ `shelter:{code}` + บทบาทแยกรายศูนย์ `{code}:{capability}`; รองรับ legacy แบน `["shelter:SH001", "registration_staff"]`) |
| `personnel_type` | enum(`staff`,`volunteer`) | req | แยกประเภท: `'staff'` (เจ้าหน้าที่ประจำ) หรือ `'volunteer'` (อาสาช่วยงานระบบ Staff-Capable ที่ได้รับสิทธิ์) |
| `organization` | str\|null | opt/req | หน่วยงานต้นสังกัด (**Required** สำหรับ staff, **Optional** สำหรับ volunteer) |
| `position` | str\|null | opt | ตำแหน่งหน้าที่ / วิชาชีพ (เช่น พยาบาลวิชาชีพ, เจ้าหน้าที่ป้องกันฯ) |
| `phone` | str | req | เบอร์โทรศัพท์ติดต่อ 10 หลัก |
| `email` | str\|null | opt | อีเมลติดต่อ |
| `notes` | str\|null | opt | หมายเหตุเพิ่มเติม |
| `volunteer_id` | str\|null | opt | ลิงก์สองทางไปยัง `volunteer:{ulid}` |
| `duty_window` | object\|null | opt | `{ start_ts: ISO, end_ts: ISO }` ช่วงเวลากะงานสำหรับตัดสิทธิ์อัตโนมัตินอกเวลา |
| `security_question` | object\|null | opt | `{ question_id: enum, answer_hash: str, salt: str, set_at: ISO }` สำหรับกู้คืนรหัสผ่านด้วยตนเอง (6 คำถามมาตรฐาน, Salted SHA-256) |
| `active` | bool | req | default `true` (เปิด/ปิดการเข้าใช้งานระบบ) |
| `must_change_password` | bool | opt | default `false` (บังคับเปลี่ยนรหัสผ่านและตั้งคำถามความปลอดภัยเมื่อเข้าสู่ระบบ) |
| `affiliation_tags` | [str] | opt | แท็กสังกัดหรือกลุ่มสังกัดเพิ่มเติม |

**กฎความปลอดภัยของ Compound Roles (CR-093 / CR-104):**
- กุญแจผ่านประตูฐานข้อมูล (`shelter:{code}`): กำหนดใน `_security.members.roles` ของฐานข้อมูล `shelter_{code}`
- สิทธิ์การบันทึกเอกสาร (`{code}:{capability}`): ตรวจสอบใน `validate_doc_update` ของแต่ละศูนย์
- ผู้ดูแลระบบส่วนกลาง (`system_admin`): ไม่มี prefix รหัสศูนย์ และมีสิทธิ์ครอบคลุมทุกฐานข้อมูล
- dynamic time-bound role: Worker Sweeper จะเพิ่ม/ถอน `{code}:{capability}` ตามเวลากะงานจริง

---

## 7. Index & view สรุปต่อ db (deploy ใน `_design/app` ตอน provisioning)

| DB | Mango indexes | Views (map/reduce) |
| --- | --- | --- |
| `shelter_*` | evacuee: name, phone, household_id, stay.status · movement: (evacuee_id, occurred_at) · screening: (evacuee_id, screened_at) · stock_ledger: (item_id, occurred_at) · donation: status, tracking_token_hash, booking_ref, campaign_id, (logistics.slot.date) · donation_slot: (date), (date, from) · medical: evacuee_id · shift_assignment: (job_id, shift_id), (volunteer_id, status), (status) · volunteer: (phone), (phone_hash), (status), (personnel_type) · job: (status), (tier, status) · job_application: (job_id, status), (tracking_token) · shelter_report: (status, occurred_at), (severity, status), (kind, status), (assignee_user_id, status) · sop_override: (active) · food_sphere_standard: (target_segment, req_group_id, effective_date) · requirement_group: (name) · replenishment_policy: (scope_type, target_id) | `occupancy` (count evacuees by stay status) · `demographics_by_age` (count active evacuees by birth year; dynamic age-bucket in API) · `demographics_by_country` (count active evacuees by country) · `registrations_by_date_status` (count check-in/out movements by date) · `stock_balance` (client Decimal sum qty_str by item; CR-038) · `latest_screening` · `meals_served` (sum by date+meal) · `needs_open` · `slot_availability` |
| `registry` | shelter: status · shelter: code (unique) · location_district: (province_id) · location_subdistrict: (district_id) | — |
| `catalog` | item_master: distribution_type, target_audience_type · item_category: is_default · recipe: is_default · sop_profile: active · food_sphere_standard: (target_segment, req_group_id, effective_date) · requirement_group: (name) · replenishment_policy: (scope_type, target_id) | — |
| `central_ops` | export_job: (status, requested_by) · search_audit: occurred_at | — |

## 8. Validation rules (สรุปที่ `validate_doc_update` ต้องบังคับ — ทั้ง central และ edge)

Design docs / `validate_doc_update` ต้อง deploy ทั้ง central และ edge เพราะ edge อาจเป็น active
write target ระหว่าง LAN fallback; schema/role enforcement ต้องเหมือนกันทุก remote.

1. `type` อยู่ใน whitelist ของ db นั้น; `_id` ขึ้นต้นด้วย `{type}:`
2. append-only types (`movement`, `screening`, `people_import_log`, `stock_ledger`, `kitchen_requisition`, `meal_service`, `audit`, `search_audit`) — ปฏิเสธ update/delete ทุกกรณี
3. state machine types (`stock_transfer`, `donation`, `referral`, `shelter_report`, …) — ปฏิเสธ transition ถอยหลัง (ตามลำดับ enum / กราฟของ type นั้น)
4. role→type เขียนได้ตาม role-permission-matrix (ตรวจ `userCtx.roles` แบบ Compound Scoped Roles `{shelter_code}:{role}`)
5. `shelter_code` ใน doc ต้องตรงกับ db
6. required fields ครบ + enum ถูกต้อง (โครงสร้างลึกตรวจฝั่ง client/Zod — validate_doc_update ตรวจเท่าที่จำเป็นกัน doc พัง ไม่ duplicate ทุก rule)
7. master `sop_profile` (catalog) เขียน/แก้ไขได้เฉพาะบทบาท `system_admin` เท่านั้น (replicate ลงเครื่องแบบ read-only)
8. `sop_override` (shelter_*) ต้องเขียนโดยบทบาท `shelter_manager` ที่มี `shelter_code` ตรงกับ database และเซสชันการทำงาน
9. `food_sphere_standard`, `requirement_group`, `replenishment_policy` ใน `catalog` (`source=SPHERE_BASELINE`) เขียน/แก้ไขได้เฉพาะบทบาท `system_admin`; ใน `shelter_*` (`source=SHELTER_OVERRIDE`) เขียน/แก้ไขได้เฉพาะบทบาท `shelter_manager` ที่มี `shelter_code` ตรงกับ database

---

## 9. MongoDB Read Models

### 9.1 `public_shelters` (MongoDB)

Read model สำหรับฉายข้อมูลศูนย์พักพิงออกสู่ Public Portal (ค้นหาและดูรายละเอียดศูนย์พักพิง) โดย Backend จะเป็นผู้คัดลอกข้อมูลจาก CouchDB มาเขียนลงที่นี่

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `_id` | str | req | `shelter_code` (เช่น `SH001`) |
| `shelter_code` | str | req | รหัสศูนย์พักพิง |
| `registry_id` | str\|null | opt | อ้างอิง ID จากฐานข้อมูลส่วนกลาง |
| `name` | str | req | ชื่อศูนย์พักพิง |
| `status` | enum(`open`,`closed`,`full`,`standby`) | req | สถานะของศูนย์พักพิง |
| `geo` | {`lat`:num, `lng`:num}\|null | opt | พิกัด |
| `capacity` | int | req | ความจุที่รองรับได้ทั้งหมด |
| `province` | str\|null | opt | จังหวัด |
| `district` | str\|null | opt | อำเภอ |
| `subdistrict` | str\|null | opt | ตำบล |
| `raw_data` | {str:Any} | req | โครงสร้าง JSON ต้นฉบับจากเอกสาร `shelter` ใน CouchDB `registry` เพื่อใช้สำหรับการฉายข้อมูลแบบละเอียด โดยไม่ต้องกำหนด Field ยิบย่อยใน Schema |
| `updated_at` | ts | req | เวลาที่ sync ข้อมูลล่าสุด |

### 9.2 `public_jobs` (MongoDB)

Read model สำหรับฉายข้อมูลประกาศงานจิตอาสาออกสู่ Public Job Board (`/volunteers/jobs`) โดย Worker Projector จะคัดลอกข้อมูลจาก CouchDB มาเขียนลงที่นี่ โดยตัดข้อมูลส่วนบุคคล (PII) ออกทั้งหมด

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `_id` | str | req | `job_id` (เช่น `job:01J6M...`) |
| `shelter_code` | str | req | รหัสศูนย์พักพิง |
| `shelter_name` | str | req | ชื่อศูนย์พักพิงสำหรับแสดงผล |
| `title` | str | req | ชื่องานภารกิจจิตอาสา |
| `description` | str\|null | opt | รายละเอียดงานและคำแนะนำ |
| `tier` | enum(`operational`,`staff-capable`) | req | ประเภทงาน |
| `skills` | [str] | req | รายการทักษะที่ต้องการ |
| `shifts` | [`JobShiftItem`] | req | รายการกะย่อยรายวัน พร้อมโควตาและจำนวนที่รับแล้ว |
| `quota` | int | req | โควตารวม |
| `slots_confirmed` | int | req | ยอดรับแล้วรวม (🟢) |
| `slots_remaining` | int | req | ยอดยังขาดรวม (⚪) |
| `status` | enum(`open`,`almost_full`,`full`,`paused`,`closed`) | req | สถานะเปิดรับสมัคร |
| `updated_at` | ts | req | เวลาที่ sync ข้อมูลล่าสุด |
