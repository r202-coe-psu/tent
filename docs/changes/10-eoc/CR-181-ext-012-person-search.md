---
id: CR-181
title: EXT-012 — Partner person search (`POST /external/persons/search`, scope `occupant-search`) + sort deterministic ของ ID search
status: approved
date: 2026-10-21
requested_by: Dev Team (issue #736, As-Built v3.0 / Bruno collection 2026-10-20)
decided_by: เจ้าของโครงการ (ตัดสิน 5 ข้อ + audit ใน issue #736 decisions comment 2026-10-21; owner อนุมัติ CR นี้ 2026-10-21)
layer: volatile
extends: CR-154 (partner OAuth plane), CR-166 (name search + sort), CR-099 (public search + masking), CR-176 (ตัด `cancelled`)
affects:
  - docs/data/api-contract.md §5.3 (แถว EXT-012, error codes, หมายเหตุท้าย §5.x)
  - docs/data/schema.md §9.6 (`third_party_clients.allowed_scopes` เพิ่ม `occupant-search`)
  - docs/adr/0002-partner-integration-architecture.md (รายการ scope + EXT-012)
  - packages/tent-model/src/tent_model/third_party_client.py (`THIRD_PARTY_SCOPES`)
  - backend/apiapp/modules/thirdparty_person_search/ (ใหม่), backend/apiapp/modules/evacuee/use_case.py (shared finder + sort)
  - frontend/src/lib/features/third-party-clients/domain/third-party-client.ts (scope + label + sensitive)
  - frontend/e2e/partner-api.test.ts, frontend/e2e/helpers/partner-api.ts, scripts/smoke_test_partner_api.py
  - backend/tests/test_thirdparty_person_search.py, test_evacuee.py, test_thirdparty_clients_admin.py
why: partner (M2/อื่น) ต้องค้นคนด้วยชื่อ / เลขบัตร / พาสปอร์ต / เบอร์ บน OAuth plane แต่ search มีเฉพาะ public SPA และ legacy `POST /external/v1/occupants` (X-API-Key, ไม่อยู่ในเอกสารส่งมอบ)
migration: N/A — ไม่เปลี่ยนรูป doc (ไม่ bump `schema_v`, ไม่ bump `PROJECTION_VERSION`); `allowed_scopes` เป็น enum ค่าใหม่, client เดิมไม่ถูกแตะ
---

# CR-181 — EXT-012: Partner person search

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม `POST /external/persons/search?purpose=` (EXT-012) ด้วย scope ใหม่ `occupant-search`; body `{ "search": "…" }`
> - **เพื่อใคร/ทำไม:** partner ค้นคนแบบ masked ได้ โดยคำค้น (ชื่อ/เลขบัตร) ไม่ไปอยู่ใน URL / nginx access log
> - **dev ต้อง build:** module `thirdparty_person_search`, shared finder ใน `EvacueeUseCase`, scope + label ฝั่ง UI, docs, test
> - **กระทบ schema:** ไม่มี (`schema_v` คงเดิม) — เพิ่มค่า enum ของ `allowed_scopes`
> - **ผลข้างเคียง:** ID search ของ `/public/v1/occupants` และ `/external/v1/occupants` เรียงลำดับแน่นอนขึ้น (ดู §Sort)

อ้างอิง: issue #736 + decisions comment (2026-10-21); CR-154 (partner plane, `purpose`, access log), CR-166 (กติกา name search + sort), CR-099 (masking ของ public search), CR-176 (ตัด `cancelled`)

## Change (before → after)

| | Before | After |
| --- | --- | --- |
| ค้นคนบน partner OAuth plane | ไม่มี (มีเฉพาะ `/external/v1/occupants` แบบ X-API-Key, soft-deprecated) | `POST /external/persons/search?purpose=` + scope `occupant-search` |
| `allowed_scopes` ที่ admin ติ๊กได้ | 6 ค่า | 7 ค่า (+ `occupant-search`, sensitive, ไม่อยู่ใน preset ของ module ใด) |
| ID search (เลขบัตร/พาสปอร์ต/เบอร์) | ไม่ sort → 10 รายการแรกขึ้นกับ natural order | sort `first_name_key ASC, _id ASC` ทุกกรณี |

## EXT-012 — กติกา (ตาม decisions ของ owner)

| # | เรื่อง | ตัดสิน |
| --- | --- | --- |
| 1 | Method / path | `POST /external/persons/search`, body `{ "search": "…" }`, `purpose` อยู่ใน query; ตอบ `Cache-Control: no-store`; คำค้นไม่อยู่ใน URL |
| 2 | Rate limit | **ไม่มีใน FastAPI** — คุมด้วย scope รายกรณี + `ThirdPartyAccessLog`; owner จะจำกัด rate ที่ nginx แยกต่างหาก (นอก scope; `api-contract.md` "ไม่มี 429 ใน partner plane" ยังถูกต้อง) |
| 3 | สถานะ | **ตัด `cancelled`** (ตาม EXT-011 / CR-176) — กรองใน Mongo query **ก่อน** `limit(10)`; สถานะอื่นคืนค่าจริง (`pre_registered`, `kiosk_registered`, `active`, `checked_out`, `transferred`, `deceased`, …); คน opt-out (`search_excluded`) ถูกตัดเหมือน public search |
| 4 | `family_members` | **ไม่คืน** และไม่ query household เลย |
| 5 | Sort | แก้ที่ use case กลาง (ดู §Sort) |
| 6 | Audit | บันทึก **เฉพาะ** `third_party_access_logs` — **ไม่เขียน `search_audits`** (ตัดสินเพิ่ม 2026-10-21) |
| 7 | ขอบเขตศูนย์ | **ค้นข้ามทุกศูนย์** (เหมือน public search / EXT-011) — ไม่จำกัดตามศูนย์หรือ module ของ partner; คุมด้วย scope รายกรณี + `purpose` + access log (`location_code = ""`) (owner ยืนยัน 2026-10-21 ระหว่างรีวิว PR #744) |

- **ลำดับตรวจ** (เหมือน EXT-007/011): `purpose` ว่าง → 400 `missing_purpose` → ไม่มี scope → 403 `insufficient_scope` → คำค้นไม่ผ่าน `parse_search_query` / ยาวเกิน 200 ตัวอักษร / body ไม่ใช่ JSON object หรือ `search` ไม่ใช่ string → 422 `validation_error` → query; ทุก response ของ EXT-012 (รวม error) มี `Cache-Control: no-store`
- **Response 200:** `{ "status": 200, "message": "Found Data.", "result": [ … ] }` — แต่ละรายการคือ field ของ public search ที่ masked แล้ว (`name`, `status`, `national_id`, `gender`, `shelter_name`, `shelter_address`, `origin_address`, `checked_in_at` (ISO 8601 offset `+07:00` เหมือน EXT-008–011; `null` เมื่อยังไม่ check-in), `care_zone`, `zone_name`) **ไม่มี** `family_members` / เบอร์ / พาสปอร์ต; สูงสุด 10 รายการ; ไม่พบ = 200 `result: []` (ไม่ใช่ 404)
- **Access log:** 1 แถวต่อ request ทุก outcome (รวมที่ถูกปฏิเสธ): `endpoint = "EXT-012"`, `client_id`, `module_name`, `purpose`, `ip`, `status` (`granted` / `denied_missing_purpose` / `denied_insufficient_scope` / `denied_validation_error`), `result_count`, `location_code = ""` (ค้นข้ามศูนย์) — **ห้ามเก็บคำค้น / CID / ชื่อ / hash ของคำค้น**
- **Error codes:** ใช้ชุดเดิมของ plane (CR-154) — `400 missing_purpose` · `401 invalid_token` · `403 insufficient_scope` · `422 validation_error` — **ไม่เพิ่ม code ใหม่** (ไม่มี 404)
- **Scope:** `occupant-search` เป็น sensitive scope เหมือน `occupancy-pii-read` / `residency-read` — ไม่อยู่ใน `DEFAULT_SCOPES_BY_MODULE` ใด, admin ติ๊กรายกรณี

## Sort (ประเด็น 5 — กระทบ public + legacy)

- **sort key ที่เลือก:** `first_name_key ASC, _id ASC` — แบบเดียวกับ name search (CR-166)
- **ที่ไหน:** `EvacueeUseCase.find_persons(parsed, exclude_statuses=())` (shared finder) ใช้ sort นี้กับ **ทุก branch** (national_id / passport / phone / name)
- **ผลข้างเคียง (ตั้งใจ):** `POST /public/v1/occupants` และ `POST /external/v1/occupants` (legacy X-API-Key) เรียก `EvacueeUseCase.search` เดียวกัน จึงได้ลำดับแน่นอนขึ้นสำหรับ ID search ด้วย — เมื่อมี > 10 รายการที่ hash ตรงกัน ชุด 10 รายการที่ถูกเลือกเปลี่ยนจาก "natural order" เป็น "ตาม sort key"; **พฤติกรรมอื่นของสอง endpoint นี้ไม่เปลี่ยน** (ยังคืน `cancelled` + `family_members` + เขียน `search_audits` ตาม CR-099)
- test ครอบคลุมทั้งสาม endpoint: `backend/tests/test_evacuee.py` (public + legacy), `backend/tests/test_thirdparty_person_search.py` (EXT-012)

## Impact

- **Partner:** ได้ endpoint ค้นคนใหม่เมื่อ admin grant scope; client เดิมไม่เปลี่ยน
- **Public SPA / legacy `/external/v1/occupants`:** เปลี่ยนเฉพาะลำดับ/ชุดผลของ ID search ที่มี match > 10 (ดู §Sort) และคำค้นที่มี lone surrogate (เช่น `"\ud800"` ใน JSON) ได้ 422 แทน 500 — `parse_search_query` ปฏิเสธสตริงที่ encode เป็น UTF-8 ไม่ได้ (PR #744 review)
- **Admin UI (third-party-clients):** มี checkbox scope ที่ 7 พร้อมคำเตือน PDPA
- **PDPA:** คืน PII แบบ masked เท่าที่ public search เปิดอยู่แล้ว; partner ไม่เห็นเบอร์/พาสปอร์ต/ครอบครัว; access log ไม่มีคำค้น
- **ไม่ทำ:** rate limit ใน FastAPI (nginx), ไม่ลบ `/external/v1/occupants`, ไม่แก้ public/legacy ให้ตัด `cancelled` หรือ family

## Verification

- `backend/tests/test_thirdparty_person_search.py` — 401/400/403/422/200, mask, ไม่มี `family_members`, cancelled กรองก่อน limit, `search_excluded`, ไม่มี `search_audits`, log ไม่มีคำค้น, `no-store`
- `backend/tests/test_evacuee.py` — sort ID search ผ่าน `/public/v1/occupants` + `/external/v1/occupants`; public ยังคืน `cancelled` + family
- `frontend/e2e/partner-api.test.ts` — E12-1..5 + scope matrix (A4/A5) รวม EXT-012

## Decision log

- 2026-10-21 — เจ้าของโครงการตัดสิน 5 ข้อ (method/path, rate limit, สถานะ, family, sort) ใน issue #736 (decisions comment) และเพิ่ม: ไม่เขียน `search_audits` (ใช้ `ThirdPartyAccessLog` อย่างเดียว); rate limit อยู่ที่ nginx นอก scope
- 2026-10-21 — ผู้ implement ร่าง CR นี้ (status `proposed`)
- 2026-10-21 — owner อนุมัติ (`approved`) ระหว่างรีวิว PR #744
- 2026-10-21 — owner ยืนยันข้อ 7 (ค้นข้ามศูนย์); review รอบ 3: error ของ EXT-012 มี `no-store`, lone surrogate → 422
- 2026-10-21 — owner สั่งแก้ (ก่อน deploy): `checked_in_at` ของ EXT-012 เป็น ISO 8601 offset `+07:00` (เดิมเป็น UTC ไม่มี offset) ให้ตรงกับ EXT-008–011 — แก้เฉพาะชั้น EXT-012; public search / `/external/v1/occupants` คงเดิม
