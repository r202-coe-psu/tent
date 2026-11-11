---
id: draft
title: Referral — ส่งต่อผู้ป่วย medical-emergency ไปโรงพยาบาลผ่าน M5 (FastAPI outbound + health gate)
status: proposed
date: 2026-11-10
requested_by: project owner
decided_by: project owner (รอ approve)
layer: stable # เพิ่ม outbound integration plane ใหม่ใน FastAPI + worker inbound loop และแก้ invariant PDPA ของ T-34 — ต้อง review ก่อน
affects:
  - docs/data/schema.md §5.4 (referral — field ใหม่ `dispatch_mode`, `batch_id`, `to_org.m5_facility_id`, `acuity`, `transport`, `requester_contact`, `external`; authorization ของ transition เมื่อมี `external`)
  - schema_v referral 2 → 3 (additive)
  - docs/data/schema.md §9 (Mongo collection ใหม่ `m5_transfers`, `m5_outbound_logs`)
  - docs/data/api-contract.md (BFF `/api/back-office/referral/m5/*`, FastAPI `/v1/integrations/m5/*`)
  - docs/task-breakdown/09-F-referral.md (T-34 DoD — กฎ "medical detail / national ID ไม่ออกนอกระบบ" และ scope R3 internal-only)
  - docs/adr/0003-outbound-integration-plane.md (ใหม่ — outbound plane แยกจาก ADR-0002)
  - backend/apiapp/modules/integrations_m5 (ใหม่)
  - worker/src/worker/inbound (loop ใหม่ `m5_transfers` → `central_ops` referral + ซ่อมใบที่ค้าง `draft` (D7) + เขียน movement `leave_temporary` ลง `shelter_{code}` เมื่อ `in_transit` (D9))
  - worker config (`M5_SYNC_INTERVAL_S` — worker เป็นตัวเคาะ `/v1/integrations/m5/sync`)
  - docs/data/schema.md §movement (actor `m5:worker` ของ `leave_temporary` ที่ worker เขียน — D9)
  - role/permission: `medical_staff` ทำ action ของ referral `medical-emergency` ได้ (D8) — `frontend/src/routes/api/back-office/referral/_auth.ts`, `$lib/auth/roles`
  - frontend/src/lib/features/referrals (domain/schema, transitions, server repository, ui medical form/detail)
  - frontend/src/routes/api/back-office/referral (สร้างชุด, m5 facilities, ส่ง/แจ้งรถออก/ถอนรายชุด, guard ใน transition และ bulk-transition)
  - CR-167 bulk-transition (ถอนใบ m5 ทั้งชุดผ่าน FastAPI — D11) และ CR-168 shelter-closure worker (ยังไม่ได้สร้าง — ต้องใช้กฎเดียวกันเมื่อสร้าง)
source: M5_API_Patient_Referral_External.docx — "M5 Patient Referral API — Integration Guide" v1.0 (15 ต.ค. 2569, ทีม M5; ไม่ได้เก็บใน repo)
---

# Referral — ส่งต่อผู้ป่วยไปโรงพยาบาลผ่าน M5

## สรุป (TL;DR)

referral ประเภท `medical-emergency` จะส่งเป็นใบส่งต่อเข้า M5 ได้ M5 คือระบบส่งต่อผู้ป่วยของ สธ. ที่เจ้าหน้าที่ สธ. ใช้อนุมัติ และโรงพยาบาลใช้กดรับผู้ป่วย

- **staff เลือกโหมดได้ต่อใบ:**
  - "ติดตามอย่างเดียว" (`tracking`) — ประสานโรงพยาบาลเอง ไม่มีข้อมูลออกนอกระบบ
  - "ส่งผ่าน M5" (`m5`)
- **ใบ M5 หนึ่งใบมีผู้ป่วยได้หลายคน** ผูกกันด้วย `batch_id` สถานะของใบใช้กับทุกคนในชุด ชุดเกิดจากฟอร์มเดียวที่เลือกผู้ป่วยหลายคน (D6)
- **ผู้ใช้:** `shelter_manager`, `medical_staff` และ `system_admin` ของศูนย์ต้นทาง (D8)
- **เมื่อรถออก (`in_transit`)** worker ตั้งสถานะการพักของผู้ป่วยทุกคนในชุดเป็น `temporary_leave` (D9)
- **การเรียก M5 อยู่ใน FastAPI ที่เดียว** credential ของ M5 ไม่อยู่ใน Node และไม่อยู่ใน browser
- **Browser เรียกผ่าน SvelteKit BFF เท่านั้น** ตาม CR-063
- **สถานะของใบโหมด `m5` มาจาก M5 เท่านั้น** worker เป็นตัวเขียนสถานะกลับเข้า CouchDB
- **Health gate:** client ต้องตรวจก่อนว่าเชื่อมต่อ FastAPI และ M5 ได้ ถ้าไม่ได้จะปิดตัวเลือก "ส่งผ่าน M5" และแสดงว่า "เชื่อมต่อกับระบบกลางไม่ได้" ส่วนโหมดติดตามอย่างเดียวยังใช้ได้
- **schema:** referral `schema_v` 2 → 3 แบบ additive

**สถานะการตัดสิน:** owner ตัดสิน D1–D4 (2026-11-10) และ D6–D12 (2026-11-11) แล้ว D5 ปิดครบทุกข้อแล้ว (2026-11-11 — ข้อ 1, 2, 5 ยืนยันจากการยิง M5 staging จริง) ดูหัวข้อ "เรื่องที่ต้องตัดสิน"

## Why

- ตอนนี้ medical referral เก็บปลายทางเป็นข้อความพิมพ์เอง (`to_org.name`) ไม่มีกลไกส่งถึงโรงพยาบาลจริง และ `accepted`/`rejected` ต้องให้คนในระบบกดแทน
- M5 เปิด API ให้ระบบภายนอกส่งใบส่งต่อ ติดตามผลพิจารณาของ สธ. แจ้งรถออก และถอนใบ (AUTH-001, TRF-001 ถึง TRF-006)
- ความปลอดภัย: ต้องเก็บ `client_secret` ของ M5 ไว้ฝั่ง server ที่เดียว (FastAPI) และให้ FastAPI ยังไม่ถือ CouchDB credential ตาม ADR-0002
- M5 ไม่มี webhook และไม่มีแผนจะทำ (D5-4) ระบบเราต้อง poll เอง ควรทำที่ server ที่เดียว ไม่ให้ browser ทุกเครื่องยิงไป M5

## Change

### 1. สถาปัตยกรรม

```
Browser ──► SvelteKit BFF /api/back-office/referral/m5/*   (session `_session`, shelter_manager)
              │  Bearer EXTERNAL_API_SECRET
              ▼
           FastAPI /v1/integrations/m5/*   ── ถือ M5_CLIENT_ID / M5_CLIENT_SECRET (env backend เท่านั้น)
              │  · token cache (24 ชม., ขอใหม่ก่อนหมด ≥ 60 วินาที, ไม่ขอทุก request)
              │  · Mongo `m5_transfers` (mapping + snapshot สถานะล่าสุด, ไม่มีเลขบัตรเต็ม)
              │  · /v1/integrations/m5/sync: TRF-003 + TRF-004 เฉพาะเมื่อมีใบที่ยังไม่จบ
              ▼
             M5  (staging-m5-api / onedata-dbh-api)

worker ── POST /v1/integrations/m5/sync ทุก M5_SYNC_INTERVAL_S (default 45) ──► FastAPI
worker inbound loop ── อ่าน `m5_transfers` ที่เปลี่ยน ──► อัปเดต referral ใน `central_ops`
                                                   └──► movement `leave_temporary` ใน `shelter_{code}` (D9)
```

- **worker เป็นผู้เคาะ sync เพียงผู้เดียว** FastAPI รันหลาย process จึงไม่มี poller ในตัว (ไม่มี background task ใน FastAPI)

- **FastAPI ไม่ได้รับ CouchDB credential** การเขียนสถานะกลับเข้า CouchDB ใช้ pattern เดียวกับ `external_bookings` (ADR-0002 §7)
- **BFF ประกอบ payload ฝั่ง server:**
  - อ่าน evacuee ของทุกคนในชุดด้วยสิทธิ์ server แล้วดึง `national_id`, ชื่อ และอายุมาใส่ payload
  - browser ส่งแค่ `batch_id` (หรือรายการ `referral_id`) กับค่าที่ staff กรอก ไม่ส่งเลขบัตร
- **FastAPI ถือเลขบัตรเต็มไว้ใน memory เท่านั้นระหว่างส่ง** `m5_transfers` เก็บเฉพาะ `national_id_masked` ที่ M5 ส่งกลับมา
- **env ใหม่** (เฉพาะ backend):
  - `M5_BASE_URL`, `M5_CLIENT_ID`, `M5_CLIENT_SECRET`
  - ห้ามตั้งชื่อด้วย prefix `PUBLIC_` และห้ามใส่ใน `frontend/.env`
- **env ใหม่ของ worker:** `M5_SYNC_INTERVAL_S` (default 45) — worker ไม่ถือ credential ของ M5

### 2. Health gate (client ต้องเชื่อมต่อได้ก่อนใช้งาน)

> **ใช้ร่วมกับ M6** ([draft-central-warehouse-m6-withdrawal](draft-central-warehouse-m6-withdrawal.md) §4): endpoint ตัวเดียวกันตอบสถานะแยกรายระบบ ไม่ทำ endpoint แยกของ M5

| ชั้น | Endpoint | พฤติกรรม |
|---|---|---|
| FastAPI | `GET /v1/integrations/status` | ตอบ `{m5: {configured, token_ok, reachable, checked_at, error}, m6: {…}}` และ cache ผลการตรวจ upstream ไว้ 30–60 วินาที เพื่อไม่ให้ยิง M5 ทุกครั้งที่ถูกถาม |
| BFF | `GET /api/back-office/integrations/status` | timeout 3 วินาที แล้วตอบ `state` ต่อระบบ ค่าใดค่าหนึ่งจากตารางถัดไป |
| UI | query `useIntegrationStatus('m5')` (refetch ทุก 30 วินาที, `retry: false`) | ถ้า `state ≠ ready`: ปิดตัวเลือกโหมด "ส่งผ่าน M5" และปุ่ม "ส่งไป M5", "แจ้งรถออก", "ถอนใบ" ของชุดที่ผูก M5 แล้วแสดง alert พร้อมปุ่มลองใหม่ (pattern เดียวกับ `ConnectionBanner`) · โหมด "ติดตามอย่างเดียว" ใช้ได้ตามปกติ (D3) |

| `state` | เงื่อนไข | ข้อความที่ผู้ใช้เห็น |
|---|---|---|
| `ready` | FastAPI ตอบได้ และ M5 `token_ok && reachable` | — |
| `central_unreachable` | BFF เรียก FastAPI ไม่ได้ หรือ timeout | "เชื่อมต่อกับระบบกลางไม่ได้" |
| `m5_unavailable` | FastAPI ตอบได้ แต่ M5 timeout หรือตอบ 5xx | "เชื่อมต่อระบบส่งต่อผู้ป่วย (M5) ไม่ได้ ชั่วคราว" |
| `m5_not_configured` / `m5_credential_invalid` | ไม่มี env หรือ M5 ตอบ `invalid_client` / 403 | "ระบบส่งต่อผู้ป่วยยังไม่พร้อม ติดต่อผู้ดูแลระบบ" (FastAPI หยุด retry อัตโนมัติ) |

- **ด่านสุดท้าย:** ทุก BFF endpoint ที่เขียนไป M5 ตอบ `503 CENTRAL_UNAVAILABLE` หรือ `503 M5_UNAVAILABLE` เองเมื่อ upstream ล่ม UI ไม่ต้องเชื่อผล status ที่ cache ไว้เพียงอย่างเดียว
- **Edge mode** (fallback ไป LAN ตอน WAN ล่ม): FastAPI ส่วนกลางมักติดต่อไม่ได้ gate นี้จึงปิดฟีเจอร์ให้เองโดยไม่ต้องเขียนกรณีพิเศษ
- health feature เดิม (`$lib/features/health`, CouchDB `/_up`) ไม่เปลี่ยน gate นี้เป็นของ referral โดยเฉพาะ

### 3. Field ใหม่บน `referral` (§5.4) — schema_v 2 → 3

ใช้เฉพาะ `referral_type = medical-emergency` ทุก field เป็น opt (additive)

| Field | ชนิด | req | หมายเหตุ |
|---|---|---|---|
| `dispatch_mode` | enum(`tracking`,`m5`) | opt | ไม่มีค่า = `tracking` (ใบเดิมทั้งหมด) · `tracking` ใช้กฎ transition เดิมทุกข้อ ไม่ส่งข้อมูลออก · `m5` ส่งผ่าน M5 · เปลี่ยนได้เฉพาะตอน `draft` (D3) |
| `batch_id` | ulid | opt | บังคับเมื่อ `dispatch_mode = m5` · referral ทุกใบที่มี `batch_id` เดียวกันอยู่ในใบ M5 ใบเดียว (D4) · ใบเดิมไม่ต้อง backfill heuristic `referral.batch-group.ts` ยังใช้กับใบที่ไม่มี `batch_id` |
| `to_org.m5_facility_id` | int | opt | `facility_id` จาก TRF-001 บังคับเมื่อส่งผ่าน M5 ส่วน `to_org.name` ยังคงเป็น snapshot ชื่อ |
| `acuity` | enum(`red`,`yellow`,`green`,`black`) | opt | บังคับเมื่อส่งผ่าน M5 · ค่าเริ่มต้นใน UI มาจาก `medical_screening.triage_level` เก่าถ้ามี (field deprecated ตั้งแต่ CR-106 — screening ใหม่ไม่มีค่านี้) ถ้าไม่มีให้ว่างและ staff ต้องเลือกเอง (D13) · แยกจาก `urgency` |
| `transport` | {`vehicle_type`: enum(`ambulance`,`van`,`helicopter`,`other`), `note`: str?} | opt | บังคับเมื่อส่งผ่าน M5 พาหนะเป็นของศูนย์เสมอ |
| `requester_contact` | {`name`: str, `role`: str, `phone`: str} | opt | snapshot ผู้ติดต่อ ณ ตอนส่ง บังคับเมื่อส่งผ่าน M5 `phone` คือช่องทางเดียวที่ สธ. และโรงพยาบาลใช้ติดต่อกลับ |
| `external` | {`system`: `m5`, `external_ref`: str, `code`: str, `status`: enum M5, `original_m5_facility_id`: int?, `review`: {note, by, at}?, `last_synced_at`: ts} | sys | BFF เขียน `system`, `external_ref` และ `code` ตอนส่งสำเร็จ worker เขียนส่วนที่เหลือ |

**`external_ref`** ใช้รูปแบบ `TENT-{shelter_code}-{batch_id}`
- ได้ค่าเดิมทุกครั้งจาก `batch_id` จึงส่งซ้ำได้ปลอดภัยตามกฎ idempotency ของ M5 และไม่มีวันซ้ำกับชุดอื่น
- ต้องไม่เกิน 64 ตัวอักษร
- `external.external_ref` และ `external.code` ของทุก referral ในชุดมีค่าเดียวกัน

**กฎของชุด (D4, D6, D12):**
- referral ทุกใบในชุดต้องมีศูนย์ต้นทาง, `to_org`, `transport`, `requester_contact` และ `urgency` เดียวกัน (field ร่วมของชุด)
- `acuity` และ `reason` แยกรายคน
- ไม่จำกัดจำนวนผู้ป่วยต่อชุดฝั่งระบบเรา (D12) — ถ้า M5 ตอบ 400 เพราะเกิน limit ให้แสดง error ของ M5 และปรับเมื่อทีม M5 ตอบ D5-5
- ชุดที่ส่งแล้วแก้รายชื่อไม่ได้ ถ้าต้องเอาผู้ป่วยคนใดออก ให้ถอนทั้งชุดแล้วส่งชุดใหม่ (§4 ข้อ 6)

**การสร้างชุด (D6):**
- FR-B1 — ฟอร์ม medical referral โหมด `m5` เลือกผู้ป่วยได้หลายคนในฟอร์มเดียว และกรอก `acuity` / `reason` รายคน
- FR-B2 — BFF ออก `batch_id` (ulid) ครั้งเดียวต่อการสร้าง แล้วสร้าง referral `draft` 1 ใบต่อผู้ป่วย ทุกใบมี `batch_id` เดียวกัน
- FR-B3 — ปุ่ม "บันทึกร่าง" สร้างชุดเป็น `draft` · ปุ่ม "ส่งข้อมูล" สร้างชุดแล้ว submit ชุดไป M5 ต่อทันทีในการกดครั้งเดียว (ถ้า submit ล้ม ชุดยังอยู่เป็น `draft` ให้กดส่งใหม่ได้)
- FR-B4 — ~~แก้ field ร่วมระดับชุด~~ ตัดออก (D14): ระบบยังไม่มีการแก้ referral `draft` (`[id]` มีแค่ GET) ถ้าต้องแก้ชุด `draft` ให้ถอนชุด (`closed`) แล้วสร้างใหม่
- FR-B5 — ใบโหมด `tracking` สร้างแบบเดิม (1 request = 1 ใบ, ไม่มี `batch_id`)

**ค่าใน payload ของ TRF-002 ที่ไม่ได้เก็บใน referral** (อ่านจาก evacuee หรือศูนย์ ณ ตอนส่ง) — `patients[i]` 1 รายการต่อ referral ในชุด:

| payload | แหล่ง | ถ้าไม่มี |
|---|---|---|
| `patients[i].acuity` | `acuity` ของ referral | — |
| `patients[i].name` | `first_name` + `last_name` | — |
| `patients[i].national_id` | `person_id.number` เมื่อ `cardType = national_id` | เว้นว่างและส่งได้ ไม่บล็อก (D10) · UI แสดงป้าย "ไม่มีเลขบัตร" รายคน |
| `patients[i].age` | `age` หรือคำนวณจาก `birth_year` | เว้นว่างและส่งได้ ไม่บล็อก (D10) |
| `patients[i].condition` | `reason` ของ referral | — |
| `origin.location_code` / `location_name` | `shelter_code` / ชื่อศูนย์ | — |
| `origin.latitude` / `longitude` | `shelter.location.lat` / `lng` ส่งเป็น Number (D5-3) | บล็อกการส่งพร้อมข้อความให้ไปตั้งพิกัดศูนย์ |

**PDPA (D1):** ส่ง `national_id` และ `condition` ไป สธ. ในฐานะผู้ให้การรักษา ทุกการส่งบันทึกใน `m5_outbound_logs` (ใคร, เมื่อไร, `external_ref`, จำนวนผู้ป่วย — ไม่เก็บ payload) และ DoD ของ T-34 ต้องเพิ่มข้อยกเว้นนี้

### 4. State mapping และ transition

ตารางนี้ใช้กับ `dispatch_mode = m5` เท่านั้น สถานะเป็นของทั้งใบ M5 worker จึงเขียนให้ referral **ทุกใบในชุด** ส่วนโหมด `tracking` ใช้กฎเดิมทั้งหมด

| M5 `status` | referral `status` | ผู้ทำให้เกิด | หมายเหตุ |
|---|---|---|---|
| (TRF-002 สำเร็จ) | `draft → sent` | staff ต้นทาง ผ่าน BFF | BFF เรียก FastAPI ครั้งเดียวต่อชุด แล้วจึงเขียน `sent` + `external` ให้ทุกใบ |
| `awaiting_review` | `sent` | — | — |
| `pending` | `sent → accepted` | worker | `timeline.responded.by = "m5:{review.by}"` · `response_reason = review.note` · ถ้า สธ. เปลี่ยนโรงพยาบาล worker อัปเดต `to_org` และเก็บ `external.original_m5_facility_id` |
| `rejected` | `sent → rejected` | worker | `response_reason = review.note` |
| `in_transit` | คงเป็น `accepted` | staff ต้นทาง (TRF-005) | สะท้อนผ่าน `external.status` ไม่เพิ่มค่าใน enum `status` · worker เขียน movement `leave_temporary` ให้ผู้ป่วยทุกคนในชุด (D9 — ดูข้อ 8) |
| `arrived` | `accepted → closed` | worker | `close_reason = "ผู้ป่วยถึงโรงพยาบาลปลายทางแล้ว (M5)"` |
| `cancelled` | `sent → closed` | staff (TRF-006) หรือ worker เมื่อ สธ. ยกเลิก | — |

**กฎที่เปลี่ยน (เฉพาะ referral ที่มี `external`):**

1. **`accepted` / `rejected` มาจาก worker เท่านั้น** BFF ปฏิเสธ transition เหล่านี้จากผู้ใช้ด้วย `409 EXTERNALLY_MANAGED`
2. **ส่งและถอนทำรายชุดเท่านั้น** `transition` endpoint รายใบตอบ `409 EXTERNALLY_MANAGED` สำหรับ `draft → sent` และ `sent → closed` ของใบโหมด `m5` ให้ใช้ endpoint รายชุดใน §5 แทน
3. **ถอนคำขอ (ทั้งชุด)** BFF เรียก TRF-006 พร้อม `close_reason` ก่อน และเขียน `closed` ให้ทุกใบในชุดเมื่อ M5 สำเร็จเท่านั้น
   - M5 ตอบ `cancel_needs_moph` → ตอบ `409 CANCEL_NEEDS_MOPH` และ UI แสดง "ใบนี้ สธ. อนุมัติแล้ว โทรประสาน สธ. เพื่อยกเลิก"
   - M5 ตอบ `already_closed` → ให้ worker sync สถานะจริงมาแทน
4. **ปิดรายการ `accepted → closed` ด้วยมือ** ทำได้หลัง `external.status ∈ {arrived, cancelled}` เท่านั้น
5. **แจ้งรถออก (action ใหม่)** เรียก TRF-005 ได้เฉพาะเมื่อ `external.status = pending` ทำครั้งเดียวต่อชุดและไม่เปลี่ยน `status`
6. **เอาผู้ป่วยออกจากชุด (D4):** M5 ถอนได้แค่ทั้งใบ จึงทำได้เฉพาะตอน `external.status = awaiting_review`
   1. ถอนทั้งชุด (ข้อ 3)
   2. สร้างชุดใหม่ (`batch_id` ใหม่) เป็น `draft` จากผู้ป่วยที่เหลือ โดยคัดลอก `acuity` / `reason` / ปลายทาง / พาหนะ / ผู้ติดต่อ
   3. staff ตรวจแล้วส่งใหม่

   ถ้า สธ. อนุมัติแล้ว (`pending` ขึ้นไป) → `CANCEL_NEEDS_MOPH` ให้โทรประสาน สธ.
7. **bulk และปิดศูนย์ (D11):**
   - `bulk-transition` (CR-167) ใช้กฎข้อ 1–4 รายตัว · ใบโหมด `m5` ที่ถูกเลือก (แม้เลือกมาใบเดียว) ทำให้ถอน **ทั้งชุด** ผ่าน FastAPI (TRF-006) ครั้งเดียวต่อ `batch_id`
   - dialog ยืนยันของ bulk ต้องแสดงว่าจะถอนทั้งชุด พร้อมรายชื่อผู้ป่วยทุกคนในชุด รวมคนที่ไม่ได้ถูกเลือก
   - ชุดที่ได้ `CANCEL_NEEDS_MOPH` นับทุกใบในชุดเป็นรายการที่ล้มเหลว พร้อมเหตุผลในผลลัพธ์ ไม่ทำให้ทั้ง bulk ล้ม
   - shelter-closure worker (CR-168) ยังไม่ได้สร้าง — เมื่อสร้างต้องใช้กฎเดียวกันนี้ และเรียกการถอนผ่าน FastAPI (worker ไม่ถือ credential ของ M5)
8. **สถานะการพักเมื่อรถออก (D9):** เมื่อ worker เห็น `external.status = in_transit`
   - เขียน movement `leave_temporary` ลง `shelter_{code}` ให้ผู้ป่วยทุกคนในชุดที่ `current_stay.status ∈ {active, room_confirmed}` · สถานะอื่นข้าม (ไม่เขียนทับ)
   - movement มี `_id` ที่ได้ค่าเดิมทุกครั้งจาก referral (idempotent — sync ซ้ำไม่เกิด movement ซ้ำ) และ `actor = m5:worker`, `reason` อ้าง `external.code`
   - `temporary_leave` ยังนับเป็น Present (schema.md §evacuee) ยอด occupancy / `present` / EXT-00x จึงไม่เปลี่ยน
   - ผู้ป่วยกลับศูนย์ใช้ `return_from_leave` เดิม · ไม่กลับ (รักษาตัวต่อ/ย้ายที่) staff `check_out` เอง · worker ไม่ทำทั้งสองอย่าง
   - M5 `cancelled` หลัง `in_transit` ไม่ย้อน movement — staff บันทึก `return_from_leave` เอง
9. **ซ่อมใบที่ส่งไม่ครบ (D7):** `m5_transfers.referral_ids` เป็นตัวตั้ง
   - ถ้า BFF ส่ง TRF-002 สำเร็จแต่เขียน `sent` + `external` ลง CouchDB ไม่ครบ worker ต้องเขียน `draft → sent` + `external` ให้ใบที่ขาดก่อน แล้วจึง apply สถานะ M5 ตามตาราง
   - staff กด "ส่ง" ซ้ำได้ — `external_ref` เดิมทำให้ M5 ไม่สร้างใบซ้ำ (idempotent)
10. **สิทธิ์ (D8):** ทุก action ของ referral `medical-emergency` (ทั้งโหมด `tracking` และ `m5`: สร้าง, ส่ง, แจ้งรถออก, ถอน, ปิด) ทำได้โดย `shelter_manager`, `medical_staff` หรือ `system_admin` ของศูนย์ต้นทาง · referral ประเภทอื่นคงสิทธิ์เดิม (`shelter_manager`, `system_admin`) · list ของ `medical_staff` (ที่ไม่ใช่ manager / SA) แสดงเฉพาะ `medical-emergency` (D16)

**การเขียนพร้อมกันใน `central_ops`:** BFF และ worker เขียน doc เดียวกันได้ ทั้งคู่ต้อง retry ด้วย `_rev` ใหม่เมื่อเจอ 409 (ใช้ `referral.transition-retry.ts` ที่มีอยู่)

### 5. API ใหม่

**FastAPI** (route ภายใน เรียกจาก BFF ด้วย Bearer `EXTERNAL_API_SECRET` เท่านั้น ไม่เปิดผ่าน nginx):

| Method | Path | เรียก M5 | หมายเหตุ |
|---|---|---|---|
| GET | `/v1/integrations/status` | AUTH-001 (ใช้ token ใน cache) | health gate ร่วมกับ M6 |
| GET | `/v1/integrations/m5/facilities?q=` | TRF-001 | cache 60 วินาที |
| POST | `/v1/integrations/m5/transfers` | TRF-002 | body: `shelter_code`, `batch_id`, `external_ref`, `origin`, `requester`, `destination_facility_id`, `patients[]` (แต่ละคนมี `referral_id`) · upsert `m5_transfers` ตาม `external_ref` และคืนค่า `code` |
| GET | `/v1/integrations/m5/transfers/{code}` | TRF-004 | อ่านสด ใช้ตอนเปิดหน้ารายละเอียด |
| POST | `/v1/integrations/m5/transfers/{code}/start` | TRF-005 | — |
| POST | `/v1/integrations/m5/transfers/{code}/cancel` | TRF-006 | body `{reason}` |
| POST | `/v1/integrations/m5/sync` | TRF-003 + TRF-004 | sync worker เรียกทุก `M5_SYNC_INTERVAL_S` (default 45 วินาที; FastAPI รันหลาย process จึงไม่ poll เอง) · ข้ามทันทีถ้าไม่มีใบที่ยังไม่จบ |

**BFF** (session + สิทธิ์ตาม §4 ข้อ 10 ของศูนย์ต้นทาง):
- `GET /api/back-office/integrations/status` (ร่วมกับ M6)
- `GET /api/back-office/referral/m5/facilities`
- `POST /api/back-office/referral/batch` — สร้างชุด `draft` (FR-B2) body: field ร่วม + `patients[]: {evacuee_id, acuity, reason}` + `submit?: boolean` (true = submit ต่อทันที, FR-B3)
- `POST /api/back-office/referral/batch/[batch_id]/m5/submit` — ส่งทั้งชุด (`draft → sent`)
- `POST /api/back-office/referral/batch/[batch_id]/m5/start` — แจ้งรถออก
- `POST /api/back-office/referral/batch/[batch_id]/m5/cancel` — ถอนทั้งชุด body `{reason, resubmit_without?: referral_id[]}` · ถ้ามี `resubmit_without` จะสร้างชุดใหม่เป็น `draft` ตาม §4 ข้อ 6
- `transition` endpoint รายใบใช้ได้ตามเดิมกับโหมด `tracking`

**การแปลง error ของ M5 ที่ FastAPI:**

| M5 | FastAPI ตอบ | หมายเหตุ |
|---|---|---|
| 400 validation | `422` + รายฟิลด์ | — |
| `destination_not_found` | `409 M5_DESTINATION_NOT_FOUND` | — |
| `external_ref_in_use` | — (กู้คืนใบเดิม) | เกิดเมื่อส่งซ้ำด้วย ref เดิมแต่เนื้อหาต่าง (ยืนยันบน staging) · BFF สร้าง payload ของชุดเดิมให้ได้ค่าเดิมทุกครั้ง (เรียงผู้ป่วยตาม `referral_id`) · ถ้ายังได้ 409 FastAPI ดึงใบเดิมจาก `transfer_code` (TRF-004) บันทึกลง `m5_transfers` แล้วตอบ `200` `replayed: true` แทนการล้ม |
| `not_pending` / `cancel_needs_moph` / `already_closed` | `409` + code เดิม | — |
| 401 token หมดอายุ | — | ขอ token ใหม่และลองซ้ำ 1 ครั้ง |
| `invalid_client` / 403 | `503 M5_CREDENTIAL_INVALID` | เปิด circuit และไม่ retry |
| timeout / 5xx | `503 M5_UNAVAILABLE` | — |

### 6. Mongo (FastAPI เป็นเจ้าของ)

- **`m5_transfers`** key = `external_ref`
  - เก็บ `batch_id`, `referral_ids[]`, `shelter_code`, `code`, `status`, `destination`, `original_destination`, `review`, `activity`, `patients[].{referral_id, acuity, national_id_masked}`, `fetched_at`, `applied_rev`
  - ไม่มีเลขบัตรเต็ม
- **`m5_outbound_logs`**
  - เก็บทุกการเรียก M5: `endpoint`, `external_ref` / `code`, HTTP status, `error`, `at`, `actor`
  - ไม่เก็บ payload และไม่เก็บ PII

## เรื่องที่ต้องตัดสิน (ก่อน approve)

- **D1 — PDPA** ✅ ตัดสินแล้ว: **(a)** ส่ง `national_id` และ `condition` ไป สธ. ผ่าน M5 ในฐานะผู้ให้การรักษา และ log ทุกการส่ง ต้องแก้ DoD ของ T-34 ซึ่งเดิมเขียนว่า "public/FAM/EOC/Open API ไม่ได้รับ medical detail หรือ national ID ทุกกรณี" ให้มีข้อยกเว้นนี้ (ตัวเลือกที่ไม่เลือก: (b) ส่งแค่ชื่อ/อายุ/acuity, (c) ให้ staff ยืนยันรายใบ)
- **D2 — Scope** ✅ ตัดสินแล้ว: **ทำทันที** แก้ `09-F-referral.md` ที่เดิมกำหนดให้ R3 เป็น referral ภายในเครือข่ายเท่านั้น ให้รวมการส่งต่อผ่าน M5 ใน release ปัจจุบัน
- **D3 — ระหว่างที่ gate ไม่ผ่าน** ✅ ตัดสินแล้ว: **ให้ staff เลือกโหมดต่อใบ** `dispatch_mode`
  - `tracking` — ติดตามอย่างเดียว staff ประสานโรงพยาบาลเอง ไม่ส่งข้อมูลออก ใช้ได้แม้ gate ไม่ผ่าน
  - `m5` — ส่งผ่าน M5 เลือกได้เมื่อ gate `ready` เท่านั้น
- **D4 — ผู้ป่วยหลายคน** ✅ ตัดสินแล้ว: **รวมหลายคนในใบ M5 เดียว** ผูกกันด้วย `batch_id` (§3) ถ้าต้องเอาคนใดออก ให้ถอนทั้งชุดแล้วส่งใหม่ (§4 ข้อ 6)
- **D5 — ผลการตรวจของทีม M5** ✅ ปิดครบ (เอกสาร v1.0 ขัดกันเอง ยืนยันด้วยการยิง M5 staging 2026-11-11 แล้วถอนใบทดสอบทั้งหมด):
  - (1) ✅ ใช้ path `GET /api/thirdparty/transfers/{code}` — ตอบเป็น object ใบเดียว ไม่ห่อ `data` · ส่วน `?code=` คือ TRF-003 ที่กรองตาม code (ห่อ `{data, total, page, limit}`)
  - (2) ✅ ไม่บังคับ — ส่งผู้ป่วยที่ไม่มี `national_id` และ `age` ได้ 201 (M5 ตอบ `national_id_masked: ""`, `age: null`) · D10 ใช้ได้ตามเดิม
  - (3) ✅ (2026-11-11, owner) ส่ง `origin.latitude` / `longitude` เป็น **Number** — ถ้า M5 ตอบ 400 ที่ฟิลด์นี้ ให้กลับมาทบทวน
  - (4) ✅ (2026-11-11) M5 **ไม่มีแผนทำ webhook** — ใช้ polling ผ่าน `/v1/integrations/m5/sync` ตาม §5 เป็นการถาวร
  - (5) ✅ ไม่พบเพดาน — ใบละ 60 คนได้ 201 · D12 (ไม่จำกัดฝั่งเรา) ใช้ได้ตามเดิม
  - ผลอื่นจาก staging: ขอ token ใหม่แล้ว token เก่ายังใช้ได้ (FastAPI cache token แยกต่อ process ได้) · ส่งซ้ำเนื้อหาเดิมได้ 200 `replayed: true` · เนื้อหาต่างได้ 409 `external_ref_in_use` · TRF-005 ก่อนอนุมัติได้ 409 `not_pending` · ถอนซ้ำได้ 409 `already_closed`
- **D6 — ชุดเกิดตอนไหน** ✅ ตัดสินแล้ว (2026-11-11): **ฟอร์มเดียวสร้างทั้งชุด** BFF ออก `batch_id` ครั้งเดียวและสร้าง `draft` รายคน · "ส่งข้อมูล" = สร้างแล้ว submit ต่อทันที (§3 FR-B1–B5; FR-B4 ตัดออกใน D14) (ตัวเลือกที่ไม่เลือก: สร้างรายคนแล้วมัดชุดทีหลัง, หนึ่งคนหนึ่งชุดก่อน)
- **D7 — ส่ง M5 สำเร็จแต่เขียน CouchDB ไม่ครบ** ✅ ตัดสินแล้ว (2026-11-11): **worker ซ่อมจาก `m5_transfers`** (§4 ข้อ 9) (ตัวเลือกที่ไม่เลือก: ให้ staff กดส่งซ้ำอย่างเดียว)
- **D8 — สิทธิ์** ✅ ตัดสินแล้ว (2026-11-11): **เพิ่ม `medical_staff`** ให้ทำทุก action ของ referral `medical-emergency` (§4 ข้อ 10) (ตัวเลือกที่ไม่เลือก: คง `shelter_manager` อย่างเดียว, `medical_staff` สร้าง draft แต่ manager เป็นคนส่ง)
- **D9 — สถานะการพักของผู้ป่วย** ✅ ตัดสินแล้ว (2026-11-11): **`temporary_leave` เมื่อ M5 = `in_transit`** worker เขียน movement ให้ทุกคนในชุด (§4 ข้อ 8) (ตัวเลือกที่ไม่เลือก: `temporary_leave` ตอน `arrived`, `checked_out` ตอน `arrived`, ไม่แตะแล้วเตือน staff)
- **D10 — fallback ของ D5-2** ✅ ตัดสินแล้ว (2026-11-11): ผู้ป่วยไม่มีเลขบัตรหรืออายุ **ส่งได้โดยเว้นว่าง** ไม่บล็อก (§3 ตาราง payload) — ทบทวนเมื่อทีม M5 ตอบ (ตัวเลือกที่ไม่เลือก: บล็อกจนกว่าจะกรอก)
- **D11 — bulk ที่มีใบ `m5`** ✅ ตัดสินแล้ว (2026-11-11): **bulk ถอนทั้งชุดให้** ผ่าน FastAPI พร้อม dialog ที่แสดงทุกคนในชุด (§4 ข้อ 7) (ตัวเลือกที่ไม่เลือก: bulk ข้ามใบ `m5` และให้ใช้ปุ่มถอนรายชุด)
- **D12 — fallback ของ D5-5** ✅ ตัดสินแล้ว (2026-11-11): **ไม่จำกัดจำนวนผู้ป่วยต่อชุด** ฝั่งระบบเรา ใช้ error ของ M5 เป็นตัวกั้น (§3 กฎของชุด) (ตัวเลือกที่ไม่เลือก: config default 10, หนึ่งคนต่อใบ)
- **D13 — ค่าเริ่มต้นของ `acuity`** ✅ ตัดสินแล้ว (2026-11-11): ใช้ `triage_level` เก่าถ้ามี ไม่มีให้ว่างและบังคับเลือก (§3) (ตัวเลือกที่ไม่เลือก: ไม่มีค่าเริ่มต้นเลย, map จาก `track`)
- **D14 — แก้ชุด `draft`** ✅ ตัดสินแล้ว (2026-11-11): **ตัด FR-B4 / `PATCH batch`** ให้ถอนแล้วสร้างใหม่ (§3)
- **D15 — `schema_v` ของใบ tracking** ✅ ตัดสินแล้ว (2026-11-11): stamp v3 เฉพาะใบ `m5` ใบ `tracking` คง v2 (§Migration)
- **D16 — list ของ `medical_staff`** ✅ ตัดสินแล้ว (2026-11-11): เห็นเฉพาะ `medical-emergency` ของศูนย์ตัวเอง (§4 ข้อ 10)

## Impact

- **docs:**
  - `schema.md` §5.4: field ใหม่ (รวม `dispatch_mode`, `batch_id`), กฎ transition ข้อ 1–7, `schema_v` 3
  - `schema.md` §9: `m5_transfers` และ `m5_outbound_logs`
  - `api-contract.md`: FastAPI และ BFF endpoints
  - `09-F-referral.md`: DoD ข้อยกเว้น PDPA (D1) และ scope release ปัจจุบัน (D2)
  - ADR-0003: outbound integration plane (เขียนแล้ว)
- **backend:**
  - module `integrations_m5` ประกอบด้วย client (httpx), token cache, sync handler (ไม่มี poller ในตัว), router และ schemas
  - tests ใช้ `respx` หรือ mock M5 ให้ครบ error ทุกตัวในข้อ 5
- **worker:**
  - inbound loop `m5_transfers` → `central_ops` แบบ idempotent ตาม `applied_rev` รวมการซ่อมใบที่ค้าง `draft` (D7)
  - เขียน movement `leave_temporary` ลง `shelter_{code}` เมื่อ `in_transit` (D9) — worker เขียน DB ของศูนย์จาก referral เป็นครั้งแรก
  - เคาะ `POST /v1/integrations/m5/sync` ทุก `M5_SYNC_INTERVAL_S`
- **สิทธิ์:** `_auth.ts` ของ referral รับ `medical_staff` สำหรับ `medical-emergency` (D8) และอัปเดต role matrix ใน `docs/prd/`
- **frontend:**
  - Zod v3 และ reader ที่รับ v1–v3
  - `referral.transitions` เพิ่ม guard `EXTERNALLY_MANAGED`
  - server repository และ BFF routes
  - UI: ตัวเลือกโหมด tracking / M5, เลือกผู้ป่วยหลายคนเป็นชุด, facility picker, acuity รายคน, transport, requester contact และ `useIntegrationStatus('m5')` gate
  - หน้ารายละเอียดชุด แสดง `external.status`, `review`, ปุ่มแจ้งรถออก และถอนทั้งชุด / ถอนแล้วส่งใหม่
- **ops:** credential staging และ production แยกกัน ต้องผ่านการทดสอบบน staging ก่อนขอ production ตามที่ M5 กำหนด

## Migration

- `schema_v` 2 → 3 เป็น additive เท่านั้น doc v1/v2 อ่านได้เหมือนเดิมโดยไม่ต้อง backfill
- writer stamp `schema_v 3` เฉพาะใบโหมด `m5` (มี field ของ M5) · ใบ `tracking` ยังสร้างเป็น v2 (D15)
- referral ที่ไม่มี `external` ทำงานตามกฎเดิมทุกข้อ
- deploy สองขั้นแบบเดียวกับ CR-167:
  1. reader รับ v3 ก่อน
  2. จากนั้นเปิด writer v3 และ M5 env
- **gate ของ production:** ห้ามตั้ง env M5 จนกว่า reader v3 จะ live — read path ทิ้ง doc ที่ parse ไม่ผ่านแบบเงียบ ๆ PWA ที่ใช้ bundle เก่าจะมองไม่เห็นใบ m5

## Decision log

- 2026-11-10 — proposed (ร่างจากการวิเคราะห์ M5 Integration Guide v1.0 เทียบกับ referral ปัจจุบัน; รอ D1–D5)
- 2026-11-10 — owner ตัดสิน D1 (a) ส่งเลขบัตร + อาการพร้อม log · D2 ทำทันที · D3 staff เลือกโหมด `tracking` / `m5` ต่อใบ · D4 รวมหลายผู้ป่วยในใบเดียว (`batch_id`) และถอนทั้งชุดแล้วส่งใหม่เมื่อต้องเอาคนออก · เพิ่ม `sync` endpoint ให้ worker เคาะ · D5 ยังรอทีม M5 · ยังไม่ approve — รอ owner approve ก่อนเริ่ม implement
- 2026-11-11 — grill รอบที่ 1: owner ตัดสิน D6 ฟอร์มเดียวสร้างทั้งชุด · D7 worker ซ่อมใบที่ค้าง `draft` จาก `m5_transfers` · D8 เพิ่ม `medical_staff` · D9 `temporary_leave` เมื่อ `in_transit` · D10 ไม่มีเลขบัตร/อายุส่งได้ · D11 bulk ถอนทั้งชุด · D12 ไม่จำกัดจำนวนต่อชุด · แก้ความไม่ตรงกันในร่าง: worker เป็นผู้เคาะ sync (ย้าย interval ไปเป็น `M5_SYNC_INTERVAL_S` ของ worker), `urgency` เป็น field ร่วมของชุด, CR-168 ยังไม่ได้สร้าง · ยังไม่ approve
- 2026-11-11 — D5 ตอบแล้ว 2 ข้อ: (3) owner ตัดสินส่งพิกัดศูนย์เป็น Number · (4) M5 ไม่มีแผนทำ webhook ใช้ polling ถาวร · เหลือ (1), (2), (5) รอทีม M5 · ยังไม่ approve
- 2026-11-11 — owner approve แผน implement (เลข CR-NNN ออกหลัง implement เสร็จ) พร้อมคำตัดสิน D13 ค่าเริ่มต้น `acuity` จาก `triage_level` เก่าถ้ามี ไม่มีให้ว่างและบังคับเลือก · D14 ตัด FR-B4 / `PATCH batch` · D15 stamp v3 เฉพาะใบ `m5` · D16 `medical_staff` เห็นเฉพาะ referral `medical-emergency` ใน list · D5 ที่เหลือจะตรวจจาก M5 staging จริง
- 2026-11-11 — spike บน M5 staging ปิด D5 ข้อ 1 (ใช้ path form), 2 (ฟิลด์ผู้ป่วยไม่บังคับ), 5 (ไม่พบเพดาน, 60 คนผ่าน) · token เก่าไม่ถูก revoke เมื่อขอใหม่ · payload ของการส่งซ้ำต้องได้ค่าเดิมทุกครั้ง
- 2026-11-11 — implement ครบ Phase 1–5 บน branch `feat/m5-referral` (FastAPI `integrations_m5`, domain v3, BFF รายชุด, worker apply + tick, UI) และ sync docs (`schema.md` §1.4 §5.4 §9.9 §9.10, `api-contract.md` §2.10 §5.4, ADR-0003, `09-F-referral.md`, role matrix) · เปลี่ยนจากร่าง: `external_ref_in_use` ให้ FastAPI กู้คืนใบเดิมเอง (§5) แทนการรอ worker · ยังไม่ได้ทดสอบ end-to-end กับ M5 staging, e2e และเลข CR
