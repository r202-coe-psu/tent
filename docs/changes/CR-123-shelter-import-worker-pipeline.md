---
id: CR-123
title: Shelter Excel Import — เปลี่ยนจาก browser loop เป็น Durable Worker Job Pipeline
status: approved
date: 2026-09-14
updated: 2026-09-15
requested_by: Dev Team B
decided_by: Project Owner
layer: stable
why: >-
  ลดความเสี่ยงที่ browser/proxy timeout ทำให้ import หลาย shelter หายบางแถว และทำให้มีสถานะรายแถว
  ที่ตรวจสอบและ retry ได้จาก server
migration: >-
  เพิ่ม registry job/item schema_v 1 และขยาย shelter_import_log schema_v 2 → 3 แบบ additive;
  ต้อง deploy schema/read compatibility ก่อนเปิด worker และ drain/reclaim งานค้างตามแผน migration ด้านล่าง
affects:
  - docs/changes/CR-039-shelter-excel-import.md (amendment ของ browser commit flow; template/mapping/validation ยังคงใช้)
  - docs/changes/CR-077-shelter-import-full-schema-coverage.md (ผล log และ caps ของ results[])
  - docs/data/schema.md §3.7 (shelter_import_log schema_v 2 → 3)
  - docs/data/schema.md §3.9 (shelter_import_job, schema_v 1)
  - docs/data/schema.md §3.10 (shelter_import_item, schema_v 1)
  - docs/data/schema.md §3.11 (shelter_code_sequence, schema_v 1)
  - schema_v shelter_import_log 2 → 3 (additive; ไม่เปลี่ยน shelter schema_v)
  - schema_v shelter_code_sequence 1 (new atomic allocator state)
  - frontend/src/lib/features/shelter-import/
  - frontend/src/lib/features/shelters/server/provisioner.ts (target shared service)
  - frontend/src/routes/api/back-office/shelter-import/ (target API routes)
  - frontend/server/shelter-import-worker.mjs (target worker entrypoint)
  - .env.example
  - frontend/.env.example
  - frontend/package.json (target `pnpm import-worker` script)
  - docker-compose.production*.yml, docker-compose.staging*.yml
---

# CR-123 — Shelter Excel Import: Durable Worker Job Pipeline

## สรุป (TL;DR)

เปลี่ยนการนำเข้า shelter จาก browser ที่วนเรียกสร้างทีละแถว เป็นการสร้าง **durable import job**
แล้วให้ Node worker ประมวลผลทีละ shelter บน server พร้อมบันทึกสถานะรายแถว ให้ frontend แสดงความคืบหน้า
และ retry ได้

นี่เป็นเอกสารข้อเสนอ ยังไม่มี implementation ที่ถือว่า landed ใน branch นี้ ไฟล์และคำสั่งที่ระบุใน
`affects` เป็น implementation target หลังได้รับอนุมัติ

Draft นี้เป็น amendment ที่เสนอสำหรับ [CR-039](CR-039-shelter-excel-import.md) เฉพาะ flow ที่ browser
ถือ request ระหว่าง commit; template, column mapping, validation และ duplicate policy จาก CR-039/CR-077
ยังคงเดิมถ้าไม่ขัดกับข้อกำหนดนี้

## Why

กระบวนการเดิมมีความเสี่ยงใน production:

- browser ต้องถือ request และ state ของการ import ทั้ง batch ไว้เอง
- proxy/browser timeout ทำให้ไม่รู้ว่าแถวไหนสร้างสำเร็จแล้ว
- เขียน `shelter_import_log` หลัง loop ทั้งหมด จึงไม่สะท้อน partial failure ระหว่างทาง
- ไม่มี durable retry เมื่อ tab ปิด, network หลุด หรือ request ถูกตัด
- การสร้าง shelter มีหลาย CouchDB side effects (database, security, design, registry, seed) และไม่ควรผูกกับ lifecycle ของหน้าเว็บ

เป้าหมายคือให้ request แรกสั้นและปลอดภัย ขณะที่งานระยะยาวเดินต่อได้แม้ browser ปิดหรือ worker restart

## Before → After

| ประเด็น | ก่อน draft นี้ (CR-039 เดิม) | หลัง draft นี้ |
|---|---|---|
| จุดเริ่มงาน | Browser loop เรียก `POST /api/back-office/shelter` หลายครั้ง | Browser เรียก create-job ครั้งเดียว |
| หน่วยประมวลผล | Promise loop ใน tab | Worker claim item ละ 1 shelter |
| Queue | อยู่ใน memory ของ browser | CouchDB `registry` job/item documents |
| ความคืบหน้า | รู้ผลเมื่อ loop จบ | อ่านสถานะ job และ item รายแถวระหว่างงาน |
| Failure | รวมผลท้าย batch, retry ยาก | เก็บ error ต่อ item และ retry เฉพาะ server failure |
| Restart | ปิด tab แล้ว state หาย | lease หมดอายุแล้ว worker อื่น reclaim ได้ |
| Audit | เขียน log หลัง loop | สร้าง log ใหม่แบบ append-only เมื่อ job terminal แต่ละครั้ง |
| Single shelter API | เป็น endpoint ที่ importer เรียกโดยตรง | ยังคงอยู่ และใช้ provisioning service/allocator ร่วมกับ worker |

## Architecture

### 1. Durable job model และ persisted document contract

เอกสารทั้งหมดอยู่ใน `registry` และต้องถูกบันทึกครบก่อนเผยแพร่ job เป็น `queued` เป็น central envelope
แบบเดียวกับ `shelter_import_log` จึงไม่มี `shelter_code`; ต้องมี common envelope (`_id`, `_rev`, `type`,
`schema_v`, `created_at`, `updated_at`, `created_by`) ครบถ้วน

| Doc type | `_id` pattern | schema_v | หน้าที่ |
|---|---|---:|---|
| `shelter_import_job` | `shelter_import_job:<ulid>` | 1 | metadata, actor, duplicate policy, counters, status และ timestamps |
| `shelter_import_item` | `shelter_import_item:<job_ulid>:<row_6_digits>` | 1 | payload ที่ผ่าน validation, original row, status, attempt, lease, code และ error |
| `shelter_import_log` | `shelter_import_log:<ulid>` | 3 สำหรับ log ใหม่ | audit snapshot ของการจบ job ครั้งหนึ่ง; ไม่ใช้ `job_id` เป็นส่วนของ `_id` |
| `shelter_code_sequence` | `shelter_code_sequence:global` | 1 | CAS-protected next numeric code shared by worker and single-shelter API |

`<row_6_digits>` เป็นเลขแถวต้นฉบับที่ zero-pad (`000001`, `000002`, …) เพื่อให้ `_all_docs` เรียงตามแถว
โดยไม่ทำให้แถว 10 มาก่อนแถว 2; field `row` ภายใน item/log ยังคงเป็น integer สำหรับแสดงผล

`shelter_import_job` schema_v 1 ขั้นต่ำต้องมี `type`, `schema_v`, `job_ulid`, `filename`, `imported_by`,
`duplicate_action`, `total_rows`, counters, `status` (`queued|running|completed|completed_with_errors`),
`attempt`, `created_at`, `updated_at`, `created_by`, `started_at?`, `finished_at?` และ `revision`/ETag source

`shelter_import_item` schema_v 1 ขั้นต่ำต้องมี `type`, `schema_v`, `job_id` (full job `_id`), `row`,
`payload`, `status` (`pending|running|created|updated|skipped|failed|validation_error`), `attempt`,
`max_attempts` (= 3), `lease_owner?`, `lease_until?`, `allocated_code?`, `error?`, `dead_lettered_at?`, `created_at`, `updated_at`, `created_by`.
`validation_error` เป็น terminal และไม่ retry อัตโนมัติ

`shelter_code_sequence` schema_v 1 เป็น central registry coordination doc มี `next_number` และ `updated_at`;
การ reserve ใช้ `_rev` CAS แล้ว persist code reservation ก่อนเริ่ม provisioning. ต้อง initialize `next_number`
จาก code สูงสุดที่มีอยู่ครั้งเดียวภายใต้ maintenance lock ก่อนเปิด worker และห้ามกลับไปใช้ `max(SHxxx)+1`
ใน request path อีก

`shelter_import_log` schema_v 3 เพิ่มแบบ additive จาก CR-077 v2:

- `job_id` (required สำหรับ log ใหม่) อ้าง full `_id` ของ job
- `attempt` (required สำหรับ log ใหม่) เป็นเลข terminal run ของ job
- คง `results[].status` และ caps เดิมของ CR-077
- log ทุก attempt สร้าง `_id` ULID ใหม่และห้าม update/delete; retry จึงไม่แก้ log เก่า

รายละเอียด field table และ validation ของ doc type ใหม่ต้องถูกลงใน `docs/data/schema.md` §3.9–§3.11 พร้อมกับ
การอนุมัติ CR นี้; draft นี้ไม่ทำให้ canonical schema เปลี่ยนก่อน formal approval

Worker runtime ใช้กลไกกลาง (claim/lease/retry/counters) เป็น design direction สำหรับ job อื่นในอนาคต
แต่ CR นี้ implement และ verify แค่ `shelter-import` handler; generic runtime ไม่ใช่ functional requirement

### 2. Worker responsibility

Worker ต้องทำงานตามลำดับนี้:

1. อ่าน job ที่ `queued` หรือ `running`
2. claim item ที่ `pending` หรือ `running` แต่ lease หมดอายุ ด้วย CouchDB `_rev` compare-and-swap
3. ได้ผู้ชนะเพียงหนึ่ง worker ต่อ item
4. ตรวจ duplicate ชื่อศูนย์ภายใต้ name lock ที่ใช้ร่วมกับ single-shelter API
5. ดำเนินการ `skip`, `update` หรือ `create` ผ่าน shared provisioning service
6. บันทึก `allocated_code`, status และ error ของ item เฉพาะเมื่อ lease ยังเป็นของ worker นั้น
7. recompute counters ของ job ด้วย CAS
8. เมื่อไม่มี item ค้าง ให้สร้าง log ใหม่แบบ append-only พร้อม `job_id` และ `attempt`

Worker process ไม่รับ payload จาก client โดยตรง; รับเพียง internal token-authenticated request เพื่อ claim งานจาก registry

### 3. Generic runtime boundary (design note)

ส่วนที่อาจแยกเป็น utility ภายหลังคือ claim/lease/revision conflict, attempt counter, counters, worker identity,
timeout, graceful shutdown และ internal authentication. ส่วน domain handler ของ shelter import คือ schema
revalidation, duplicate policy, code allocation, CouchDB database/security/design/seed provisioning และ
audit result mapping. CR นี้ไม่บังคับให้สร้าง framework หรือ handler generic ตัวที่สอง

Python `sync-worker` เดิมยังคงทำ CouchDB → MongoDB projection ต่อไป ไม่ถูกนำมารวมกับ import job worker

## State model

### Job status

```text
queued → running → completed
                 ↘ completed_with_errors
```

- `queued`: รับ job แล้วและสร้าง item ครบ ยังไม่มี item กำลังประมวลผล
- `running`: มี item `pending`/`running`
- `completed`: ทุก item จบโดยไม่มี `failed` หรือ `validation_error`
- `completed_with_errors`: มี `failed` หรือ `validation_error`

### Item status

```text
pending → running → created
                  ↘ updated
                  ↘ skipped
                  ↘ failed
pending ─────────────→ validation_error
```

`failed` retry ได้ไม่เกิน `max_attempts = 3`; เมื่อครบให้ตั้ง `dead_lettered_at` และไม่วน retry ต่อ
`validation_error` ต้องแก้ข้อมูลแล้ว upload ใหม่. CR นี้ยังไม่เพิ่ม cancel endpoint; cancellation เป็น out of scope
จนกว่าจะมี state/สิทธิ์และการคืน side effects ที่ชัดเจน

## API contract

### Create job

`POST /api/back-office/shelter-import/jobs`

- authorization: system admin (`requireAdmin`)
- input: `filename`, `duplicate_action`, `rows[]` เท่านั้น; `imported_by` ห้ามรับจาก client และต้อง derive จาก server session/user context
- server revalidates every row ด้วย `createShelterSchema` ก่อนสร้าง item
- invalid rows ถูกบันทึกเป็น item `validation_error`
- limits: ไม่เกิน **1,000 rows** และ request body JSON ไม่เกิน **5 MiB**; เกินแล้วตอบ `413` ก่อนสร้าง job
- success: HTTP `202` และ `{ jobId }`
- ถ้า worker auth/config ยังไม่พร้อมให้ตอบ `503` ก่อนสร้าง job

### Read status

`GET /api/back-office/shelter-import/jobs/:jobId`

- authorization: system admin
- output: `{ job, items }` โดย `items` มีสถานะรายแถวเต็มของ job เดียว ไม่อ่านประวัติทั้งหมดใน endpoint นี้
- `Cache-Control: no-store` และ `ETag` จาก job revision; รับ `If-None-Match` และตอบ `304` เมื่อไม่มีการเปลี่ยน
- frontend poll เฉพาะ job ที่ active เริ่มที่ **2 วินาที**, ใช้ exponential backoff เมื่อไม่มี revision change จนสูงสุด **10 วินาที**;
  history ใช้ registry changes feed ไม่ poll เป็นระยะถาวร

### Retry failed items

`POST /api/back-office/shelter-import/jobs/:jobId/retry`

- authorization: system admin
- รับเฉพาะ job terminal `completed_with_errors`; ถ้า `queued`/`running` ตอบ `409`
- เปลี่ยนเฉพาะ item `failed` ที่ `attempt < 3` กลับเป็น `pending`; `validation_error` ไม่ถูก retry
- preserve allocated shelter code เพื่อให้ retry idempotent และเพิ่ม job `attempt` เมื่อ run terminal ใหม่

### Internal worker claim/process

`POST /api/back-office/shelter-import/worker/next`

- route อยู่หลัง private Docker network/ingress policy และห้าม expose สู่ public plane
- authentication: `Authorization: Bearer <SHELTER_IMPORT_WORKER_TOKEN>`; เปรียบเทียบด้วย constant-time comparison (`crypto.timingSafeEqual` หลังทำ buffer length ให้เท่ากัน)
- หนึ่ง request claim/process ได้ไม่เกินหนึ่ง item; `204` เมื่อไม่มีงาน
- worker เรียก API ผ่าน internal service address; ถ้าจำเป็นต้องผ่าน reverse proxy ให้ upstream timeout อย่างน้อย **150 วินาที** (มากกว่า item timeout + margin)
- provisioning timeout ต่อ item **120 วินาที**; lease TTL **5 นาที** และ renew ก่อนครบครึ่งหนึ่งของ TTL
- ถ้า request ถูกตัดกลางคัน item จะคง lease จนหมดอายุแล้วถูก reclaim; idempotency rules ต้องทำให้การทำซ้ำปลอดภัย
- worker idle sleep **3 วินาที** เมื่อได้ `204`, และ backoff สูงสุด **5 วินาที** เมื่อ network error; ไม่ busy-loop
- SIGTERM หยุดรับ item ใหม่และรอ item ปัจจุบันไม่เกิน **30 วินาที** ก่อน exit

## Reliability and idempotency rules

- ห้าม queue อยู่ใน process memory อย่างเดียว
- claim, lease renew, status transition และ counter update ต้องใช้ CouchDB `_rev`; `409` แปลว่า worker อื่นชนะ claim แล้ว
- worker ที่ lease หลุดห้ามเขียนทับผลของ worker รุ่นใหม่
- `max_attempts = 3`; เมื่อครบให้เก็บ `dead_lettered_at`/error ล่าสุดและคง item เป็น `failed` เพื่อให้ operator ตรวจสอบ
- item ที่ได้ code แล้วต้อง persist code ก่อนเริ่ม provisioning เพื่อให้ retry ใช้ code เดิม
- การออก code ต้องผ่าน `shelter_code_sequence:global` atomic allocator ที่ใช้ร่วมกันระหว่าง worker และ single-shelter API
  (CAS-protected registry sequence/reservation); ห้ามใช้ `max(SHxxx)+1` ใน path ใดอีก และ acceptance ต้องทดสอบ race ระหว่างสอง worker กับ single-shelter API
- same-name imports ใช้ name lock เดียวกับ single-shelter API พร้อม lease และอ่านซ้ำหลัง conflict
- แต่ละ provisioning step ต้อง idempotent: database exists (`412`) และ design/security/index/seed ที่มีอยู่แล้ว
  ต้อง verify ว่า shape ถูกต้องแล้วถือว่าสำเร็จ; conflict (`409`) ต้อง reread/repair ตาม policy ไม่ blind retry
- registry master และ seed writes ต้องตรวจ HTTP status ทุกครั้ง
- mapping จาก item status ไป audit `results[].status` ต้องคง enum ของ CR-077:

  | item status | audit result status |
  |---|---|
  | `created` | `created` |
  | `updated` | `updated` |
  | `skipped` | `skipped_duplicate` |
  | `validation_error` | `validation_error` |
  | `failed` | `server_error` |

- log เป็น append-only: terminal run ทุกครั้งสร้าง `shelter_import_log:<ulid>` ใหม่; ห้าม “ปรับปรุง log เดิม” หลัง retry
- retention: job/item terminal docs cleanup หลัง **30 วัน** โดย job เฉพาะกิจที่ตรวจ `finished_at`; audit logs คงตาม audit-retention policy
  (อย่างน้อย **365 วัน** หาก policy กลางยังไม่มีตัวเลข) และลบได้เฉพาะ retention process ที่ได้รับอนุมัติแยกจากการ update log
- job/item changes ใน `registry` อาจเพิ่ม feed events ตามจำนวน item แต่ Python projection ไม่ consume doc type นี้; UI ใช้ ETag polling เฉพาะ active job
  และใช้ changes feed เฉพาะ history เพื่อลด churn ที่ client

## Frontend process

1. ผู้ใช้เลือกไฟล์และตรวจ preview/validation ตาม CR-039/CR-077
2. กด import แล้ว client สร้าง job เพียง request เดียว; actor มาจาก server session
3. เก็บ `jobId` ใน `sessionStorage` เพื่อกลับมาเปิดงานปัจจุบันหลัง reload (เป็น convenience ไม่ใช่ source of truth)
4. poll status ของ active job ตาม ETag/backoff ที่ระบุด้านบนจน terminal
5. แสดง counters: สำเร็จ, อัปเดต, ข้ามซ้ำ, ล้มเหลว, validation error, รอคิว
6. แสดง status, code และ error ต่อ shelter รวมถึง row ที่ worker ทำเสร็จแล้วขณะ row อื่นยังรอ
7. เปิดปุ่ม retry เฉพาะเมื่อมี item `failed` ที่ยังไม่เกิน max attempts
8. เมื่อจบ invalidate shelter list และ import history; history live-update ผ่าน registry changes feed

## Deployment and operations

- เพิ่ม `import-worker` service แยกจาก Python `worker` ใน production/staging compose เพราะ workload และ runtime budget ต่างกัน
- ใช้ image frontend เดียวกัน แต่รัน `pnpm import-worker`; script และ env key ต้องอยู่ใน `frontend/package.json`, `.env.example` และ `frontend/.env.example`
- ตั้ง `SHELTER_IMPORT_WORKER_TOKEN` เป็น secret ค่าเดียวกันใน API และ import-worker; generate ด้วย secret manager หรือ `openssl rand -hex 32`
- token เป็น defense-in-depth เท่านั้น: private network/ingress policy ยังต้องบังคับเสมอ และห้าม log ค่า token
- worker ต้องหยุดแบบ graceful ตาม 30 วินาที และ monitor worker logs, queued jobs, expired leases, dead-lettered items และ 5xx rate
- หาก token ไม่ถูกตั้ง API จะไม่รับ job ใหม่และ worker จะหยุดพร้อม error ที่ชัดเจน; single-shelter endpoint ไม่ควร fallback ไปใช้ client-supplied token

## Requirements

- **IMP-FR-01 Durable create:** initial import request ต้องคืน job id ภายใน request budget โดยไม่รอ provisioning ทั้ง batch
- **IMP-FR-02 Sequential item processing:** worker instance หนึ่งตัว process ได้ทีละ shelter item และ endpoint หนึ่ง request ทำได้ไม่เกินหนึ่ง item
- **IMP-FR-03 Server validation and actor:** ทุก row revalidate บน server; `imported_by` ต้องมาจาก server session ไม่ใช่ payload client
- **IMP-FR-04 Partial success:** item สำเร็จต้องไม่ rollback เพราะ item อื่นล้มเหลว
- **IMP-FR-05 Lease safety:** worker restart และ expired lease ต้อง resume ได้โดยไม่สร้าง completed item ซ้ำ
- **IMP-FR-06 Idempotent provisioning:** ทุก side effect และ allocated code ต้องปลอดภัยเมื่อ retry ตาม mapping/status rules
- **IMP-FR-07 Progress UI:** frontend ต้องแสดงสถานะและ error ราย shelter แบบ accessible ระหว่าง batch ยังทำงาน
- **IMP-FR-08 Append-only audit:** terminal attempt ต้องสร้าง log ใหม่ด้วย schema_v 3 และ mapping enum ของ CR-077; ห้าม update log เก่า
- **IMP-FR-09 Access and network boundary:** create/status/retry เป็น system-admin; worker ใช้ bearer secret + private network + constant-time compare
- **IMP-FR-10 Bounded retry/retention:** retry สูงสุด 3 attempts, dead-letter เมื่อครบ และ cleanup job/item terminal docs หลัง 30 วัน
- **IMP-FR-11 Atomic allocation:** worker และ single-shelter API ต้องใช้ allocator เดียวที่ป้องกัน code collision โดยไม่ scan max code
- **IMP-FR-12 Payload/timeout budget:** บังคับ 1,000 rows/5 MiB, item timeout 120 วินาที, lease 5 นาที และ graceful shutdown 30 วินาที

กลไก generic runtime เป็น design note เท่านั้น ไม่ใช่ requirement แยก (เพราะ CR นี้มี handler เดียว)

## Acceptance criteria

- [ ] ไฟล์ valid จำนวน N แถวตอบกลับ `202 + jobId` ภายใน request budget โดยไม่รอสร้าง N shelter และปฏิเสธ payload ที่เกิน 1,000 rows/5 MiB
- [ ] มี worker request ที่กำลัง provisioning ได้ไม่เกินหนึ่ง shelter ต่อ worker instance และ request ภายนอกไม่สามารถเรียก internal route ได้
- [ ] `imported_by` ที่ส่งปลอมจาก client ถูก ignore/reject และ log ใช้ actor จาก server session
- [ ] เมื่อมีทั้ง success และ failure งานอื่นยังดำเนินต่อ และ UI แสดงผลรายแถวตรงกับ job items
- [ ] ปิด tab หรือ restart worker แล้ว item pending/running ที่ lease หมดอายุยังทำต่อได้ภายใน lease budget
- [ ] สอง worker claim item เดียวกันได้ผู้ชนะเพียงหนึ่งรายจาก CouchDB revision conflict
- [ ] provisioning timeout/request cut-off ไม่ทำให้ duplicate side effect และ item ถูก reclaim ได้หลัง TTL
- [ ] retry รับเฉพาะ terminal `completed_with_errors`, requeue เฉพาะ `failed` ที่ยังไม่เกิน 3 attempts; `validation_error` ไม่ retry
- [ ] retry หลัง allocate code แล้วไม่สร้าง shelter code ใหม่ และ race กับ single-shelter API ไม่เกิด code ซ้ำ
- [ ] duplicate skip/update ทำงานตาม policy และไม่สร้างชื่อซ้ำจาก concurrent jobs
- [ ] terminal run แต่ละครั้งสร้าง log `_id` ใหม่; ไม่มี update/delete log เก่า; status mapping ตรงตามตาราง
- [ ] `shelter_import_log` v2 อ่านได้ และ log ใหม่มี schema_v 3 พร้อม `job_id`/`attempt`; counters นับครบทุกแถว
- [ ] audit parity หมายถึง counters และสถานะล่าสุดครบทุกแถวผ่าน job items; รายละเอียดใน `results[]` ของ log ถูกจำกัดตาม CR-077 ที่ 200 แถว/ข้อความ 200 ตัวอักษร
- [ ] single-shelter create endpoint ยังผ่าน regression tests และใช้ allocator/provisioner/lock เดียวกับ worker
- [ ] Python sync worker ยังทำ projection ตามเดิมและไม่ถูก block จาก import provisioning
- [ ] cleanup ลบเฉพาะ job/item terminal ที่เกิน 30 วัน และไม่แก้ log ที่ยังอยู่ใน audit retention

## Test and verification plan

- unit test: state transitions รวม `pending → validation_error`, lease expiry, revision conflict, retry filtering, max attempts และ name lock
- unit/API test: server revalidation, actor spoofing, payload/body limits, ETag/304, admin/internal authorization และ private-route policy
- worker test: one-item processing, partial failure, restart/reclaim, 120-second timeout, graceful shutdown และ idempotent code reuse
- concurrency test: atomic allocator ระหว่าง worker หลายตัวและ single-shelter API; same-name lock race
- audit test: append-only rejection, fresh ULID per terminal attempt, schema_v 2 compatibility, v3 mapping และ CR-077 caps
- UI test: counters, per-row status while job is active, accessible progress, ETag/backoff และ retry visibility
- integration test กับ CouchDB สำหรับ registry job/item/log documents และ cleanup อายุ 30 วัน
- command baseline:

```bash
pnpm --dir frontend check
pnpm --dir frontend exec vitest run src/lib/features/shelter-import
pnpm --dir frontend lint
docker compose -f docker-compose.production.yml config --quiet
```

## Impact

| ที่ | อะไร |
|---|---|
| `docs/data/schema.md` §3.7 | `shelter_import_log` schema_v 2 → 3 แบบ additive; คง append-only และ CR-077 caps |
| `docs/data/schema.md` §3.9–§3.11 | เพิ่ม field table ของ job/item และ atomic `shelter_code_sequence`, schema_v 1 และ `_id` patterns หลังอนุมัติ |
| `frontend/src/lib/features/shelter-import/` | create/status/retry API client, active-job query, ETag/backoff UI, history feed และ log mapping |
| target server routes/provisioner | auth/session actor, worker boundary, shared name lock, allocator และ idempotent provisioning |
| worker/deployment | `frontend/server/shelter-import-worker.mjs`, package script, compose service, env examples และ secret wiring |
| Python sync worker | ไม่เปลี่ยน code หรือ projection contract; ต้องยืนยันว่า ignore job/item/log events |
| tests/operations | concurrency, timeout/lease, cleanup, dead-letter, audit compatibility และ dashboards/alerts |

## Migration and compatibility

- เนื่องจาก draft ยัง `proposed` canonical `docs/data/schema.md` จะถูกแก้ใน implementation/approval PR เดียวกัน ไม่แก้แบบเงียบใน draft:
  ต้องเพิ่ม §3.9–§3.11 และ bump §3.7 `shelter_import_log` v2 → v3 ตาม data contract ข้างต้น
- `shelter` schema version **ไม่เปลี่ยน**
- log v1/v2 เดิมอ่านได้ตามปกติ (ไม่มี `job_id`/`attempt` ให้ถือเป็น legacy run); log ใหม่เขียน v3 และใช้ ULID ใหม่ทุก terminal attempt
- ไม่มี backfill job/item สำหรับ browser imports ที่จบไปแล้ว; import ใหม่หลัง feature flag เปิดเท่านั้นจึงใช้ durable job
- initialize `shelter_code_sequence:global` จาก code สูงสุดภายใต้ maintenance lock ก่อนเปิด endpoint/worker; หาก initialize ไม่สำเร็จให้ตอบ `503`
- deployment order: (1) deploy readers/schema validation ที่อ่าน v1/v2/v3 ได้, (2) deploy API + worker ที่สร้าง docs ใหม่, (3) enable worker/feature flag, (4) drain/reclaim queued jobs และตรวจ dead-letter
- ถ้ามี job `queued`/`running` ตอน deploy ให้ worker รุ่นใหม่ reclaim ตาม lease; ห้ามลบ queue docs เพื่อ rollback
- rollback: stop `import-worker`, ปิด create-job feature flag, คง reader ที่อ่าน job/log ไว้, และให้ single-shelter API เดิมทำงานต่อ; job ที่ค้างรอ operator ตรวจ ไม่ถูก mark สำเร็จปลอม
- เมื่อ draft นี้ได้รับอนุมัติ ให้ mark CR-039 เป็น `superseded` เฉพาะ browser commit flow; column mapping/template/validation และ CR-077 log caps ยังคงใช้

## Out of scope

- ไม่รวมการเปลี่ยน Python CouchDB → Mongo projection worker ให้เป็น job worker
- ไม่รวม distributed scheduler หรือ autoscaling หลาย worker แบบ dynamic
- ไม่รวม cancel/resume งานเก่าที่ไม่มี job/item documents จาก implementation เดิม
- ไม่รวมการ rollback shelter ที่สร้างสำเร็จแล้วเมื่อแถวอื่นล้มเหลว
- ไม่บังคับสร้าง generic job framework หรือ handler ที่สองใน CR นี้

## Decision log

- 2026-09-14 — Project Owner requested this draft to document the change from browser sequential import to durable worker job pipeline.
- 2026-09-14 — Proposed to separate import job worker from Python sync worker so provisioning workload cannot block Mongo projection.
- 2026-09-14 — Accepted bounded active-job polling with ETag/backoff; history remains changes-feed driven, rather than polling all logs.
- 2026-09-14 — Preserved append-only audit invariant; retries create a new log ULID instead of mutating a prior log.
- 2026-09-14 — Generic runtime retained as a design note, not a verifiable requirement, because this change has one domain handler.
- 2026-09-15 — Project Owner approved and assigned number as CR-123.
