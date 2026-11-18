---
id: CR-257
title: Partner ได้ข้อมูลบุคคลเต็ม (ไม่ masked) — EXT-012, EXT-007, legacy `/external/v1/occupants` + scope `pii-full` + ย้าย masking จาก worker ไป API
status: done
date: 2026-11-17
requested_by: EOC (ผ่านเจ้าของโครงการ — ต้องการข้อมูลสมบูรณ์ให้ partner ใช้งานต่อได้)
decided_by: เจ้าของโครงการ (D-1…D-6 + OD-1…OD-6 ตามร่าง, 2026-11-17 — รวม review stable core)
layer: stable # แตะหลัก "Privacy by construction" ของ sync plane (couchdb-mongodb-sync.md) — ต้อง review ก่อน implement
supersedes_part_of:
  - CR-181 (EXT-012 masking + ข้อ 4 "ไม่คืน family_members")
  - CR-109 / CR-111 (EXT-007 คืนแบบ masked)
  - CR-099 (masking ของ `/external/v1/occupants` เท่านั้น — public search ยังใช้ CR-099 ครบ)
affects:
  - docs/data/couchdb-mongodb-sync.md §หลักการ (Privacy by construction), §`public_persons`, §`shelter_occupants`, §ตาราง read path
  - docs/data/api-contract.md §5.3 (แถว EXT-007, EXT-012, หมายเหตุท้าย §5.x) + แถว legacy `POST /external/v1/occupants`
  - docs/data/schema.md §9.4 (`third_party_access_logs.status` + `granted_full`), §9.6 (`allowed_scopes` + `pii-full`), decision sync EXT-007
  - docs/adr/0002-partner-integration-architecture.md §6, §7 (EXT-012), รายการ sensitive scope
  - docs/features/pdpa-consent-block-spec.md (แถว `mode = basic` — ตรวจถ้อยคำ)
  - PROJECTION_VERSION 22 → 23 (`public_persons` + `shelter_occupants` เก็บ plaintext)
  - schema_v — ไม่เปลี่ยน (CouchDB doc ไม่เปลี่ยนรูป; เปลี่ยนเฉพาะ Mongo projection)
  - packages/tent-model/src/tent_model/{public_person,shelter_occupant,third_party_client}.py
  - worker/src/worker/projectors/{evacuee,occupant}.py, worker/src/worker/projection_version.py
  - backend/apiapp/utils/masking.py
  - backend/apiapp/modules/evacuee/{use_case,schemas}.py
  - backend/apiapp/modules/thirdparty_person_search/{use_case,schemas,router}.py
  - backend/apiapp/modules/thirdparty_occupants/{use_case,schemas}.py
  - backend/apiapp/modules/thirdparty_clients_admin/schemas.py
  - frontend/src/lib/features/third-party-clients/domain/third-party-client.ts (+ test)
  - frontend/fastapi.json, frontend/src/lib/api/openapi.d.ts (regenerate)
  - backend/tests/test_thirdparty_person_search.py, test_thirdparty_occupants.py, test_evacuee.py, test_thirdparty_clients_admin.py, test_external_v1_auth.py
  - worker/tests/projectors/{test_projectors,test_occupant}.py, worker/tests/test_mongo_person.py, test_processor.py, test_closed_shelter_retention.py, integration/test_projection_contract.py
  - frontend/e2e/partner-api.test.ts, frontend/e2e/helpers/partner-api.ts, frontend/e2e/README.md, scripts/smoke_test_partner_api.py
migration: bump PROJECTION_VERSION 22 → 23 → worker bootstrap re-project `public_persons` + `shelter_occupants`; deploy backend ก่อน worker (ดู §Migration)
---

# Partner ได้ข้อมูลบุคคลเต็ม — EXT-012, EXT-007, legacy `/external/v1/occupants`

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** EXT-012 และ EXT-007 คืนข้อมูลบุคคลเต็ม (ชื่อ-สกุล, เลขบัตร, passport, เบอร์, ที่อยู่, ครอบครัว/อายุ) เมื่อ client มี scope ใหม่ `pii-full` คู่กับ scope หลัก; legacy `/external/v1/occupants` ปลด mask ทั้งหมด; public search (`/public/v1/occupants`) **ยัง masked เหมือนเดิม**
> - **เพื่อใคร/ทำไม:** EOC ต้องใช้ข้อมูลที่สมบูรณ์ส่งต่อ partner — ค่าที่ masked ใช้ติดตาม/ยืนยันตัวตนต่อไม่ได้
> - **dev ต้อง build:** worker เก็บ plaintext ใน `public_persons` / `shelter_occupants`; backend mask ตอนตอบ (ย้าย masking จาก worker → API); scope gate 2 ระดับ; admin UI scope ใหม่
> - **กระทบ:** `PROJECTION_VERSION` 22→23, `allowed_scopes` + `pii-full`, `third_party_access_logs.status` + `granted_full`; ไม่ bump `schema_v`

## Decisions (เจ้าของโครงการ 2026-11-17)

| #   | เรื่อง                               | ตัดสิน                                                                                                                |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| D-1 | Field ของ EXT-012                    | ชื่อ-สกุลเต็ม, เลขบัตรเต็ม, ที่อยู่เดิมเต็ม (มีบ้านเลขที่), **เพิ่ม** passport + เบอร์โทร, **เพิ่ม** `family_members` |
| D-2 | Scope                                | **scope ใหม่** (sensitive, ติ๊กรายกรณี); scope เดิมยังได้แบบ masked                                                   |
| D-3 | ที่เก็บข้อมูลเต็ม                    | **Mongo projection เก็บ plaintext**; mask ที่ระดับ schema/response ใน backend                                         |
| D-4 | Tracking                             | CR ใหม่ หมวด `10-eoc/`                                                                                                |
| D-5 | EXT-007                              | **รวม** — คืนข้อมูลเต็มด้วย                                                                                           |
| D-6 | Legacy `POST /external/v1/occupants` | **ปลด mask**                                                                                                          |

## Decisions เพิ่มเติม (OD-1…OD-6 — เคาะตามร่าง 2026-11-17)

- **OD-1** — ชื่อและรูปแบบ scope — **`pii-full` ตัวเดียวใช้คู่กับ scope หลัก** (แบบเดียวกับ `booking-bypass` + `booking-write`, CR-182). (ทางเลือกแยก scope ต่อ endpoint ไม่เลือก)

- **OD-2** — field เต็มของ legacy — ปลด mask เฉพาะ field เดิม (`name`, `national_id`, `origin_address`, `family_members[].name`) **ไม่เพิ่ม** passport/เบอร์

- **OD-3** — field เต็มของ EXT-007 — `first_name`, `last_name`, `name`, `age`, `national_id`, `passport_id`, `id_card_type`, `phone` **ไม่มี** ที่อยู่/ครอบครัว

- **OD-4** — บัตรชมพู / บัตรอื่น — projection เดิมใส่เลข `pink_card` / `other` ไว้ช่อง national ID (เพื่อค้นด้วย hash); คืน `id_card_type` (`national_id` / `passport` / `pink_card` / `other`) คู่กับ `national_id` ในโหมดเต็ม

- **OD-5** — access log — `status = "granted_full"` เมื่อคืนข้อมูลเต็ม (enum ใหม่) แยกจาก `granted` (masked)

- **OD-6** — ยอมรับความเสี่ยง legacy — `/external/v1/occupants` ไม่มี scope และไม่มี `purpose`; ปลด mask แล้ว **ทุก API key ที่ active ได้ PII เต็มทันที**; audit รายการ `api_keys` และ revoke key ที่ไม่ใช้ก่อน deploy

## Change (before → after)

|                                             | Before                                                | After                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public_persons` (Mongo)                    | เฉพาะ `*_masked` + hash (worker mask)                 | plaintext `last_name`, `national_id`, `passport_id`, `id_card_type`, `phone`, `address{…}` + hash เดิม; `*_masked` deprecated (อ่านเป็น fallback เท่านั้น) |
| `shelter_occupants` (Mongo)                 | `name_masked`, `age_range`                            | + plaintext `first_name`, `last_name`, `age`, `national_id`, `passport_id`, `id_card_type`, `phone`; `name_masked` deprecated                              |
| ที่ทำ masking                               | worker ตอน project                                    | backend ตอนประกอบ response                                                                                                                                 |
| `/public/v1/occupants`                      | masked                                                | **masked เหมือนเดิมทุกตัวอักษร**                                                                                                                           |
| EXT-012 + `occupant-search`                 | masked, ไม่มี family                                  | เหมือนเดิม                                                                                                                                                 |
| EXT-012 + `occupant-search` + `pii-full`    | —                                                     | ข้อมูลเต็ม + `family_members`                                                                                                                              |
| EXT-007 + `occupancy-pii-read`              | masked                                                | เหมือนเดิม                                                                                                                                                 |
| EXT-007 + `occupancy-pii-read` + `pii-full` | —                                                     | ข้อมูลเต็ม                                                                                                                                                 |
| Legacy `/external/v1/occupants`             | masked                                                | ข้อมูลเต็ม (field เดิม, OD-2)                                                                                                                              |
| `allowed_scopes`                            | 8 ค่า                                                 | + `pii-full`                                                                                                                                               |
| หลัก sync plane                             | "Privacy by construction — Mongo ไม่มี plaintext PII" | "Mongo เก็บ plaintext; การเปิดเผยคุมที่ API (mask ตาม endpoint/scope)"                                                                                     |

## Requirements

### Projection (worker)

- **FR-1** — `project_evacuee` ต้องเขียน `last_name`, `national_id`, `passport_id`, `id_card_type`, `phone` และ `address` (`address_no`, `village_no`, `subdistrict`, `district`, `province`, `postal_code` จาก household) เป็น plaintext ลง `public_persons`
- **FR-2** — hash / key สำหรับค้น (`first_name_key`, `last_name_hash`, `national_id_hash`, `passport_hash`, `phone_hash`) ต้องคงเดิม (byte-identical)
- **FR-3** — `project_shelter_occupant` ต้องเขียน `first_name`, `last_name`, `age` (`resolve_age`), `national_id`, `passport_id`, `id_card_type`, `phone` ลง `shelter_occupants`; `age_range` คงเดิม
- **FR-4** — worker ต้องไม่เขียน `*_masked` อีก (`last_name_masked`, `national_id_masked`, `passport_id_masked`, `address_masked`, `name_masked`)
- **FR-5** — คนที่ `privacy.search_excluded = true` ยังไม่ถูก project ลงทั้งสอง collection (เหมือนเดิม)
- **FR-6** — `PROJECTION_VERSION` 22 → 23

### Masking (backend)

- **FR-7** — `backend/apiapp/utils/masking.py` ต้องมี `mask_passport`, `mask_address`, `mask_occupant_name` ที่ให้ output เหมือน `worker/src/worker/masking.py` / `projectors/occupant.py` ทุก byte
- **FR-8** — `/public/v1/occupants` ต้องคืนค่าเท่าเดิมทุกตัวอักษร: mask จาก plaintext; row ที่ยังไม่ re-project ใช้ `*_masked` เดิม
- **FR-9** — โหมดเต็มทุก endpoint **ห้าม fallback ไปค่า masked**: plaintext ไม่มี → field นั้นเป็น `null`
- **FR-10** — การค้นนามสกุลต้องใช้ `last_name_hash` exact เท่านั้น; ห้าม query regex/prefix บน `last_name` plaintext (CR-099 / CR-166)
- **FR-11** — ห้าม endpoint ใด serialize `PublicPerson` / `ShelterOccupant` ทั้งก้อน; ทุก response ต้องผ่าน schema ที่ระบุ field ชัด

### Scope

- **FR-12** — เพิ่ม `pii-full` ใน `THIRD_PARTY_SCOPES`; sensitive; ไม่อยู่ใน `DEFAULT_SCOPES_BY_MODULE` ใด; admin ติ๊กรายกรณี (OD-1)
- **FR-13** — `pii-full` ไม่ให้สิทธิ์เรียก endpoint ใดด้วยตัวเอง: ไม่มี scope หลัก → 403 `insufficient_scope` (ลำดับตรวจเดิม `purpose` → scope → validation)
- **FR-14** — admin UI แสดง `pii-full` พร้อมคำเตือน PDPA ที่ระบุว่าได้ชื่อ-สกุลเต็ม เลขบัตร passport เบอร์ ที่อยู่ และครอบครัว

### EXT-012 (`POST /external/persons/search`)

- **FR-15** — `occupant-search` อย่างเดียว → response เดิมตาม CR-181 (ไม่มี key ใหม่ใด ๆ)
- **FR-16** — `occupant-search` + `pii-full` → แต่ละรายการมี field เดิม (ค่าไม่ masked) + `first_name`, `last_name`, `passport_id`, `id_card_type`, `phone`, `family_members[]`
- **FR-17** — `name` = `first_name + " " + last_name`; `national_id` = เลขเต็ม; `origin_address` = ที่อยู่เต็ม (`address_no`, `village_no`, ต./อ./จ., `postal_code` — ตัดส่วนว่าง)
- **FR-18** — `family_members[]` = คนในครัวเรือนเดียวกัน ศูนย์เดียวกัน ไม่รวม `search_excluded` และ `cancelled`; แต่ละคน `{first_name, last_name, name, status, shelter_name, shelter_status}`
- **FR-19** — คงกติกาเดิม: ตัด `cancelled` ก่อน limit, สูงสุด 10, sort `first_name_key, _id`, `Cache-Control: no-store`, ไม่เขียน `search_audits`, access log ไม่มีคำค้น
- **FR-20** — access log `status = "granted_full"` เมื่อตอบโหมดเต็ม (OD-5)

### EXT-007 (`GET /external/locations/{code}/occupants`)

- **FR-21** — `occupancy-pii-read` อย่างเดียว → response เดิม (`name_masked` คำนวณจาก plaintext = ค่าเดิม)
- **FR-22** — `occupancy-pii-read` + `pii-full` → เพิ่ม `first_name`, `last_name`, `name`, `age`, `national_id`, `passport_id`, `id_card_type`, `phone` (OD-3); field เดิมคงอยู่
- **FR-23** — access log `status = "granted_full"` เมื่อตอบโหมดเต็ม

### Legacy `POST /external/v1/occupants` (X-API-Key)

- **FR-24** — `name`, `national_id`, `origin_address`, `family_members[].name` คืนค่าเต็ม (OD-2); พฤติกรรมอื่นคงเดิม (คืน `cancelled` + family, เขียน `search_audits`)
- **FR-25** — โค้ด builder ต้องรับ `full: bool` ชัดเจน — public = `False`, legacy = `True` — เพื่อไม่ให้การแก้ legacy/EXT-012 ทำให้ public เปลี่ยนตาม

## Migration

1. Deploy **backend ก่อน** (FR-8 fallback ทำให้ public search ถูกต้องทั้ง row เก่าและใหม่)
2. Deploy worker → `PROJECTION_VERSION` 23 → bootstrap re-project `public_persons` + `shelter_occupants`
3. ระหว่าง re-project: โหมดเต็มคืน `null` สำหรับ row เก่า (FR-9) — ยอมรับได้
4. ไม่มี CouchDB migration; ไม่ bump `schema_v`
5. ก่อน deploy: audit `api_keys` ที่ active (OD-6)
6. ลบ field `*_masked` ออกจาก model เป็นงาน follow-up หลังยืนยันว่า re-project ครบทุก environment

## Impact

- **PDPA:** Mongo (และ backup ของ Mongo) เก็บ PII plaintext — การป้องกันย้ายจาก "ไม่มีข้อมูล" ไปเป็น "API คุม field". ความผิดพลาดใน endpoint public ใด ๆ ที่อ่าน `public_persons` อาจทำให้ PII หลุด → FR-11 + guard test
- **Retention:** ไม่เปลี่ยน — `public_persons` ยังถูกลบตาม CR-183 (ปิดศูนย์ + 3 เดือน); `shelter_occupants` ถูกลบเมื่อปิดศูนย์; plaintext ถูกลบไปพร้อม row
- **Partner เดิม:** client ที่มี `occupant-search` / `occupancy-pii-read` อย่างเดียวไม่เห็นความต่าง
- **Legacy API key:** ทุก key ได้ PII เต็ม (OD-6)
- **ไม่กระทบ:** EXT-001–006, EXT-008–011, `/v1/integrations/m5|m6`, staff UI, kiosk; ผู้อ่าน `public_persons` อื่น (`shelter`, `transparency`, `thirdparty_bookings`, `thirdparty_residency`) ใช้แค่ count/status/hash

## Acceptance / Verification

- `backend/tests/test_thirdparty_person_search.py` — scope หลักอย่างเดียว = response เดิม (ไม่มี `passport_id` / `phone` / `family_members`); + `pii-full` = field เต็ม + family; `pii-full` อย่างเดียว = 403; row เก่า → field เต็ม `null`; log `granted_full`; ไม่มีคำค้นใน log; `no-store`
- `backend/tests/test_thirdparty_occupants.py` — คู่ขนานกับข้างบนสำหรับ EXT-007; `name_masked` = golden เดิม
- `backend/tests/test_evacuee.py` — `/public/v1/occupants` golden output ไม่เปลี่ยน (row ใหม่และ row เก่า) + guard: response ไม่มีนามสกุลเต็ม / เลขบัตร 13 หลัก / เบอร์ / บ้านเลขที่ของ fixture; legacy คืนค่าเต็ม
- Parity test — golden strings ของ `mask_last_name` / `mask_national_id` / `mask_passport` / `mask_address` / `mask_occupant_name` (hard-code จาก output worker ปัจจุบัน) ตรงกับ backend
- `backend/tests/test_thirdparty_clients_admin.py` + `third-party-client.test.ts` — `pii-full` grant ได้, sensitive, ไม่อยู่ใน preset
- worker tests — projector เขียน plaintext, ไม่มี `*_masked`, hash เดิม, retention ลบ row
- `frontend/e2e/partner-api.test.ts` — E12-1 (masked) คงเดิม; เพิ่ม E12-full, E07-full; scope matrix A4/A5 รวม `pii-full`
- `scripts/smoke_test_partner_api.py` — ผ่านบน staging หลัง deploy

## Why

- EOC ต้องส่งต่อข้อมูลผู้อพยพให้ partner ดำเนินการต่อ (ยืนยันตัวตน, ติดต่อ, ติดตามครอบครัว) — ค่า masked เช่น `390-XXXX-XX-192` / `สม****ดี` ใช้ทำงานต่อไม่ได้
- **ทำไม scope ใหม่ (D-2):** client ที่ได้ `occupant-search` / `occupancy-pii-read` แล้วได้รับอนุมัติภายใต้คำอธิบายแบบ masked — ถ้าปลด mask ใน scope เดิม client เหล่านั้นจะได้ PII เต็มโดยไม่มีการอนุมัติใหม่
- **ทำไม plaintext ใน Mongo (D-3):** FastAPI ไม่มี credential CouchDB (ADR 0002) และข้อมูลเต็มไม่มีใน Mongo; เจ้าของโครงการเลือกเก็บใน `public_persons` ที่มีอยู่แล้ว (ทางเลือก collection แยกเฉพาะ partner ถูกพิจารณาและไม่เลือก)
- **ทำไม public search ยัง masked:** endpoint anonymous — ไม่มี scope / `purpose` / ตัวตนผู้ค้น

## Decision log

- 2026-11-17 — เจ้าของโครงการตัดสิน D-1…D-6 (requirement ใหม่จาก EOC: ปลด mask EXT-012 แล้วขยายไป EXT-007 + legacy)
- 2026-11-17 — ผู้ implement ร่าง CR นี้ (`proposed`, `id: draft`) พร้อม OD-1…OD-6
- 2026-11-17 — เจ้าของโครงการเคาะ OD-1…OD-6 ตามร่างและอนุมัติ (`approved`, CR-257) รวมการเปลี่ยนหลัก privacy ของ sync plane (stable core)
- 2026-11-17 — implement ครบ (tent-model, worker PROJECTION_VERSION 23, backend EXT-012/EXT-007/legacy, admin scope `pii-full`, docs) ตรวจ response จริงทั้ง 8 กรณีกับเจ้าของโครงการแล้ว → `done`
