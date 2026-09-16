---
id: draft
extends: CR-123
title: ป้องกัน CouchDB ค้างเมื่อนำเข้าศูนย์พักพิงจำนวนมาก
status: proposed
date: 2026-09-16
requested_by: Dev Team B
decided_by: รอเจ้าของโครงการอนุมัติ
layer: volatile
scope:
  in_scope:
    - ระยะที่ 1: แก้ query และการคำนวณสถานะให้ไม่อ่านข้อมูลทั้งชุดซ้ำ ๆ
    - ระยะที่ 2: แยกเอกสาร job/item ออกจากฐานข้อมูล registry
    - migration, security, rollback และการทดสอบของสองระยะนี้
  out_of_scope:
    - ระยะที่ 3: generic worker runtime, autoscaling และ distributed scheduler
    - การเพิ่ม Redis/PostgreSQL
    - การยกเลิกหรือลบศูนย์พักพิงที่สร้างสำเร็จแล้ว
affects:
  - docs/changes/CR-123-shelter-import-worker-pipeline.md — amendment เรื่อง query, queue storage และ migration
  - docs/data/schema.md — เพิ่ม contract ของ queue database และ index/view
  - docs/data/data-model.md — เพิ่ม topology และ ownership ของ shelter_import_queue
  - docs/data/api-contract.md — เพิ่ม service boundary ของ queue และ internal worker route
  - schema_v shelter_import_job / shelter_import_item — คง field เดิม; เปลี่ยน database ที่เก็บเมื่อ cutover
  - frontend/src/lib/server/registry-design.ts — shelter lookup ที่มีดัชนี
  - frontend/src/lib/server/shelter-import-queue-design.ts — design doc และ view ของ queue database (ไฟล์ใหม่)
  - frontend/src/lib/features/shelter-import/server/job-store.ts
  - frontend/src/lib/features/shelter-import/server/job-store.test.ts
  - frontend/src/lib/features/shelter-import/application/queries.ts
  - frontend/src/lib/features/shelter-import/data/import-log.remote.ts
  - frontend/src/lib/server/shelters.admin.ts
  - frontend/src/lib/server/shelter-name-lock.ts — ตรวจให้ยังอยู่ registry เพราะใช้ร่วมกับ single-shelter API
  - frontend/src/lib/features/shelters/server/provisioner.ts
  - frontend/src/lib/features/shelters/server/provisioner.test.ts
  - frontend/src/routes/api/back-office/shelter-import/jobs/**
  - frontend/src/routes/api/internal/shelter-import/worker/next/+server.ts
  - frontend/src/routes/api/internal/shelter-import/worker/next/+server.test.ts — ไฟล์ใหม่ถ้ายังไม่มี
  - frontend/server/shelter-import-worker.mjs
  - frontend/scripts/seed.ts
  - frontend/scripts/redeploy-access.ts
  - frontend/scripts/migrate-shelter-import-queue.ts — ไฟล์ใหม่
  - frontend/.env.example
  - .env.example
  - docker-compose.yml, docker-compose.staging*.yml, docker-compose.production*.yml
  - nginx/nginx.conf — deny internal worker route หาก public listener ใช้ catch-all
---

# ป้องกัน CouchDB ค้างเมื่อนำเข้าศูนย์พักพิงจำนวนมาก

> **สรุปสั้น ๆ:** ปัญหาเกิดจาก worker อ่านเอกสารจำนวนมากซ้ำทุกครั้งที่หยิบงานและเปลี่ยนสถานะ ไม่ใช่เพราะต้องเพิ่มเวลารอให้ CouchDB นานขึ้น
>
> รอบนี้จะแก้สองส่วนพร้อมกัน: ใช้ query ที่อ่านเฉพาะรายการที่ต้องทำ และแยก job/item ไปฐานข้อมูล `shelter_import_queue` ส่วนข้อมูลหลักของศูนย์พักพิง audit log, name lock และ code allocator ยังอยู่ใน `registry`

## ความสัมพันธ์กับ CR-123 และขอบเขต

เอกสารนี้เป็น amendment ของ [CR-123](CR-123-shelter-import-worker-pipeline.md) เฉพาะเรื่องความสามารถในการรองรับข้อมูลจำนวนมากและการแยกพื้นที่เก็บคิว โดย CR-123 ยังเป็นแหล่งอ้างอิงหลักของ template, column mapping, validation, duplicate policy, worker lifecycle และ audit log schema หากข้อความใดขัดกัน ให้ใช้กติกาต่อไปนี้:

- **ทำใน change นี้:** ระยะที่ 1 และระยะที่ 2, migration, security boundary, query contract, counter recovery และ test ที่ระบุในเอกสารนี้
- **เป็น design ไว้ก่อน:** ระยะที่ 3 เรื่อง generic runtime, backpressure แบบกระจาย, autoscaling และ scheduler กลาง
- **ไม่ทำ:** เพิ่ม Redis/PostgreSQL หรือเปลี่ยน Python `worker` ที่ทำ CouchDB → MongoDB projection ให้เป็น import worker
- เมื่อเจ้าของโครงการอนุมัติ ต้องปรับ `CR-123` และเอกสาร canonical ให้ไม่เหลือข้อความที่บอกว่า job/item อยู่ใน `registry` อย่างเดียว รวมถึงแก้ route worker จาก path เดิมเป็น `/api/internal/shelter-import/worker/next` ให้ตรงกับโค้ดปัจจุบัน

## เป้าหมายที่วัดผลได้

ค่าตั้งต้นที่ใช้ใน implementation และ test:

| ค่า | ข้อกำหนด |
|---|---:|
| จำนวนแถวสูงสุดต่องาน | `1,000` |
| ขนาด request สูงสุด | `5 MiB` |
| จำนวน item ต่อ `_bulk_docs` หนึ่งครั้ง | ไม่เกิน `100` |
| ขนาด payload ต่อ `_bulk_docs` หนึ่งครั้ง | ไม่เกิน `512 KiB` |
| จำนวน job ที่อ่านต่อ worker poll | ไม่เกิน `20` |
| จำนวน candidate item ต่อการ claim | ไม่เกิน `1` |
| เวลา timeout ต่อ item | `120 วินาที` |
| อายุ lease | `5 นาที` และต่ออายุก่อนครบครึ่งหนึ่ง |
| เวลารอหลัง worker idle | `3 วินาที` |
| เวลารอสูงสุดเมื่อ CouchDB/network error | `5 วินาที` |
| เวลารอ graceful shutdown | `30 วินาที` |

Benchmark ขั้นต่ำต้องใช้ข้อมูล 1,000 แถว, มี job อื่นในคิวอย่างน้อย 100 งาน และ worker 5 ตัวบน dev/local CouchDB เดียวกัน โดยต้องบันทึกจำนวนเอกสารที่อ่าน, จำนวน request, p95 ของ claim/status, peak memory และ CPU:

- query สำหรับ claim ต้องคืนข้อมูลไม่เกิน `limit` ที่กำหนด และไม่มี `/_all_docs` หรือ `skip` ในเส้นทาง worker/provisioning ปกติ
- ปริมาณข้อมูลที่อ่านรวมต้องเพิ่มตามจำนวนรายการแบบ O(N) ไม่ใช่ O(N²); ต่อการ claim ต้องอ่าน candidate แบบจำกัดขอบเขต ไม่ใช่ item ทั้งงาน
- target เริ่มต้นของ query claim และ query เลือก job คือ p95 ไม่เกิน `500 ms` ใน fixture ข้างต้น หากเครื่อง dev เล็กกว่านี้ ให้บันทึก baseline และให้เจ้าของโครงการอนุมัติ target ใหม่ก่อนเปลี่ยน acceptance
- Status API อนุญาตให้อ่านรายการของ job เดียวได้ครบตามจำนวนสูงสุด 1,000 แถว เพราะหน้าจอต้องแสดงผลรายแถว แต่ไม่ใช่เส้นทางที่ worker เรียกซ้ำต่อ item และต้องใช้ ETag/304 เมื่อไม่มีการเปลี่ยนแปลง

## เหตุผล

### อาการที่พบ

เมื่อนำเข้าศูนย์พักพิงหลายร้อยถึง 1,000 แถวใน dev/local โปรแกรม worker จะทำงานช้าลงมาก CouchDB ใช้ CPU/RAM สูง คำขอใช้เวลานานจนหมดเวลา และงานนำเข้าดูเหมือนค้าง แม้ข้อมูลบางแถวจะเขียนสำเร็จแล้ว

### สาเหตุหลัก

ปัจจุบันฐานข้อมูล `registry` ถูกใช้รวมกันทั้งข้อมูลหลักของศูนย์พักพิง งาน/รายการนำเข้า lock ตัวนับ และประวัติการทำงาน แล้วมีการอ่านข้อมูลทั้งหมดซ้ำในขั้นตอนที่ถูกเรียกบ่อย:

1. `listRunnableImportJobs()` อ่าน job ทั้งหมดเพื่อเลือกงานที่ยังทำได้
2. `claimNextImportItem()` อ่าน item ทั้งงานด้วย `_all_docs?include_docs=true` ทุกครั้งที่หยิบรายการ ถ้ามี N รายการจะอ่านซ้ำระดับ O(N²)
3. `listShelterMasters()` อ่านเอกสารทั้งหมดใน `registry` รวมข้อมูลคิวทุกครั้งที่ตรวจชื่อซ้ำ และถูกเรียกหลายครั้งต่อรายการ
4. `recomputeImportJob()` อ่าน item ทั้งชุดหลังเปลี่ยนสถานะทุกครั้ง
5. การเตรียมรายการนำเข้าเขียนทีละเอกสาร ทำให้มี network round-trip จำนวนมาก
6. การเก็บข้อมูลคิวปนกับข้อมูลหลักทำให้ query ที่ควรอ่านเฉพาะ shelter master ต้องผ่านเอกสารที่ไม่เกี่ยวข้อง และควบคุมสิทธิ์ได้ยากขึ้น

ดังนั้นปัญหาไม่ได้อยู่ที่การตั้งค่า CouchDB อย่างเดียว แต่เกิดจากรูปแบบการค้นหาและการจัดเก็บคิวที่ทำให้ปริมาณงานเพิ่มขึ้นแบบกำลังสองเมื่อจำนวนแถวเพิ่มขึ้น

## โครงสร้างข้อมูลและเจ้าของข้อมูล

การแยก queue จะย้ายเฉพาะ job/item ไม่ย้ายเอกสารที่ใช้ร่วมกับ single-shelter API:

| ฐานข้อมูล | เอกสารที่เก็บ | ผู้เขียน | หมายเหตุ |
|---|---|---|---|
| `shelter_import_queue` | `shelter_import_job`, `shelter_import_item`, migration marker | SvelteKit server เท่านั้น | ฐานข้อมูลใหม่สำหรับคิวโดยเฉพาะ |
| `registry` | `shelter:{ulid}`, `shelter_import_log`, `shelter_import_name_lock`, `shelter_counter` | server-side provisioning/admin | name lock และ code allocator ต้องใช้ร่วมกับ single-shelter API |
| `shelter_{code}` | ข้อมูลภายในศูนย์พักพิงและ seed | provisioning service | ไม่เปลี่ยน schema จาก CR-123 |

`shelter_import_job` และ `shelter_import_item` คงชื่อ field และ `schema_v` เดิมจาก CR-123 เพื่อให้ reader เดิมเข้าใจข้อมูลได้ การเปลี่ยน database เป็น storage migration ไม่ใช่การ bump `shelter` schema และไม่อนุญาตให้ worker รุ่นเก่าเขียน queue ใหม่หลัง cutover

### Contract ของ job และ item

| ประเภทเอกสาร | ID | ฟิลด์สำคัญ | กติกา |
|---|---|---|---|
| `shelter_import_job` | `shelter_import_job:<ulid>` | metadata, actor, duplicate policy, counters, status, attempt, audit marker, timestamps | สร้างหลัง stage item ครบ; `queued/running` คือ job ที่ worker มองเห็น |
| `shelter_import_item` | `shelter_import_item:<job_ulid>:<row_6_digits>` | validated `input`, row, status, attempts, lease, claim token, code, errors | status ของ item เป็นแหล่งข้อมูลจริงของความคืบหน้า; `input` ห้ามคืนให้ browser |
| `shelter_import_migration` | `shelter_import_migration:<job_ulid>` | source DB, target DB, state, count/hash, timestamps | marker สำหรับ migration ที่รันซ้ำได้; ไม่ใช่ job ที่ worker หยิบไปทำ |
| `shelter_import_log` | `shelter_import_log:<ulid>` | audit snapshot ต่อ terminal attempt | อยู่ `registry`, append-only, ใช้ schema_v 3 และ cap จาก CR-077 |
| `shelter_import_name_lock` | `shelter_import_name_lock:<normalized-name>` | owner, lease, updated_at | อยู่ `registry` เพราะใช้ร่วมกับ single-shelter API |
| `shelter_counter` | `counter:shelter` | value | อยู่ `registry`; อัปเดตด้วย `_rev` CAS และใช้ร่วมกับ single-shelter API |

ข้อกำหนดเพิ่มเติม:

- `imported_by` ต้องมาจาก server session ไม่รับจาก request body
- ข้อมูล `input` ต้องผ่าน server-side schema validation และไม่เก็บค่าที่ไม่จำเป็น
- `errors` ที่มาจาก client ให้ใช้ได้เฉพาะเป็นข้อมูลช่วย preview ที่ผ่าน schema จำกัดขนาด; error ที่บันทึกจริงต้องสร้างหรือยืนยันจาก server เพื่อป้องกันการปลอม audit/error message
- `results[]` ใน audit log นับ counters จากทุกแถว แต่เก็บรายละเอียดได้ไม่เกิน 200 แถว และข้อความไม่เกิน 200 ตัวอักษรตาม `docs/data/schema.md`

## Query และ index contract

### Design doc ของ queue

เพิ่ม `frontend/src/lib/server/shelter-import-queue-design.ts` เพื่อสร้าง `_design/import` ใน `shelter_import_queue` โดยต้องมี version แยกจาก `registry` และ deploy แบบ read-modify-write พร้อม `_rev` เช่นเดียวกับ design doc อื่น

| View | Key | ใช้ทำอะไร | ขอบเขต |
|---|---|---|---|
| `jobs_by_runnable` | `[state, created_at, _id]` | เลือก job ที่ `queued`/`running` หรือรอ retry/audit repair | worker poll ใช้ `limit=20` และ keyset pagination |
| `items_by_job_row` | `[job_id, row]` | อ่านรายการของ job สำหรับ Status API | ใช้เฉพาะ status; อ่านได้ไม่เกิน 1,000 รายการ |
| `items_by_job_status_row` | `[job_id, status, row]` | เลือก item `pending` ทีละรายการ | worker claim ใช้ `limit=1` |
| `running_items_by_lease` | `[job_id, lease_until, row]` | หา `running` ที่ lease หมดอายุ | query ด้วยเวลาปัจจุบันและ `limit=1` |
| `items_by_job_status_count` | `[job_id, status]` + reduce `_count` | คำนวณ counters และ recovery | ใช้ `group=true`; ห้ามโหลด item docs ทั้งชุด |

ตัวอย่าง query ที่ implementation ต้องสร้างให้ได้ (แสดง key แบบอ่านง่ายก่อน URL-encode):

```text
GET /shelter_import_queue/_design/import/_view/jobs_by_runnable
    ?startkey=["queued",null,null]
    &endkey=["queued",{},{}]
    &include_docs=true&reduce=false&limit=20

GET /shelter_import_queue/_design/import/_view/items_by_job_status_row
    ?startkey=["shelter_import_job:01J...","pending",0]
    &endkey=["shelter_import_job:01J...","pending",{}]
    &include_docs=true&reduce=false&limit=1

GET /shelter_import_queue/_design/import/_view/running_items_by_lease
    ?startkey=["shelter_import_job:01J...",null,0]
    &endkey=["shelter_import_job:01J...","2026-09-16T00:00:00.000Z",{}]
    &include_docs=true&reduce=false&limit=1
```

`jobs_by_runnable` ต้องกำหนดค่า `state` ที่ emit ให้ตายตัว (`queued`, `running`, `retry_pending`, `audit_repair`) และต้องมี cursor ต่อจาก `(state, created_at, _id)` เมื่อครบ `limit`; ห้ามใช้ `null`/`{}` แบบคลุมเครือใน implementation โดยไม่ทดสอบช่วงคีย์จริง

ใน `registry` ให้เพิ่ม/คง view ต่อไปนี้ใน `frontend/src/lib/server/registry-design.ts`:

- `by_code` สำหรับค้นหา shelter ตาม code
- `by_code_number` สำหรับ initialize code allocator
- `by_normalized_name` สำหรับตรวจชื่อซ้ำ โดย algorithm ต้องตรงกับ `normalizeShelterName()` คือ trim, รวม whitespace และ lowercase

### กติกาการเรียก query

- ใช้ `limit` และ keyset pagination (`startkey` + `startkey_docid`) ห้ามใช้ `skip` กับคิวขนาดใหญ่
- ตัวอย่างการ claim pending: query `items_by_job_status_row` ด้วย key ช่วง `[job_id, "pending", ...]` และ `limit=1`
- ตัวอย่างการ reclaim: query `running_items_by_lease` ถึง `lease_until <= now` และ `limit=1`; ค่า `now` ต้องสร้างจากเวลาปัจจุบันใน server และ worker ต้องอ่าน document จริงซ้ำก่อน PUT
- view ที่คืน candidate อาจล้าหลังได้ แต่ใช้เพื่อหา candidate เท่านั้น การตัดสินสิทธิ์ต้องอ่าน `_rev`, `claim_token`, `lease_until` แล้วทำ CAS; `409` ให้ข้ามและเริ่ม candidate ถัดไป
- หาก view/design หายหรือ version ไม่ตรง ให้ตอบ `503`/หยุด worker อย่างชัดเจน ห้าม fallback กลับไปอ่าน `registry` ทั้งฐานข้อมูล
- ถ้า queue database ใช้งานไม่ได้ ให้ fail closed และ backoff; ห้ามสลับไปอ่าน `registry` แบบเงียบ ๆ เพราะจะทำให้มี worker สองแหล่งประมวลผลงานเดียวกัน
- `listRunnableImportJobs()` ต้องไม่ใช้ `_all_docs`; ถ้ามี job จำนวนมากให้ใช้ cursor ต่อเนื่อง ไม่อ่าน job ทั้งฐานข้อมูลในแต่ละ poll
- `listShelterMasters()` อนุญาตเฉพาะ migration/repair ที่ระบุไว้เท่านั้น ขั้นตอนสร้าง shelter และ duplicate check ต้องใช้ `by_code`/`by_normalized_name`

## การเปลี่ยนสถานะและความถูกต้องของ counter

Item status เป็น source of truth ส่วน counter ใน job เป็น snapshot ที่สร้างจาก item status:

| การเปลี่ยนสถานะ | ผลต่อ counter |
|---|---|
| stage valid → `pending` | `pending + 1` |
| stage invalid → `validation_error` | `failed + 1` |
| `pending` → `running` | `pending - 1`, `running + 1` |
| `running` → `created`/`updated` | `running - 1`, `succeeded + 1` |
| `running` → `skipped` | `running - 1`, `skipped + 1` |
| `running` → `failed` | `running - 1`, `failed + 1` |
| `running` → `pending` เพราะ name lock ไม่ว่าง | `running - 1`, `pending + 1` |
| `running` ที่ lease หมดอายุ → `running` claim ใหม่ | counter ไม่เปลี่ยน |
| `failed` → `pending` ตอน retry | `failed - 1`, `pending + 1`; เพิ่ม job `attempt` หนึ่งครั้งต่อรอบ retry |

กติกาการเขียน:

1. helper ต้องอ่าน item ล่าสุด ตรวจ `expected status`, `_rev` และ claim token ก่อนเปลี่ยนสถานะ
2. หลัง item transition สำเร็จ ให้คำนวณ counter จาก `items_by_job_status_count` reduce view แล้วเขียน job ด้วย `_rev` CAS; ห้ามใช้ counter เดิมอย่างเดียวเป็นแหล่งข้อมูล
3. ถ้า response หายหรือ job CAS ชนกัน ให้ re-read และคำนวณจาก reduce view ใหม่ ห้ามบวก delta ซ้ำแบบเดา
4. ถ้า worker ตายหลังเขียน item แต่ก่อน sync job ให้ job คงสถานะที่ยังไม่ terminal และ worker/recovery รอบถัดไป sync จาก reduce view
5. ห้าม mark job เป็น `completed`/`completed_with_errors` จนกว่าจะ sync counter สำเร็จและไม่มี item `pending`/`running`
6. Recovery ต้องใช้ reduce view ไม่ใช่ `_all_docs`; ต้องแก้ counter ที่ติดลบหรือไม่ตรงกับ item และบันทึก metric/เหตุผลการซ่อม
7. การสร้าง audit log เป็นงานข้ามฐานข้อมูล: จอง `audit_log_id` ใน job ด้วย CAS, เขียน log append-only ใน `registry`, แล้ว mark `audit_logged`; ถ้าขั้นใดล้มให้ซ่อมต่อด้วย ID เดิมและไม่สร้าง log ซ้ำ

## Security และขอบเขตการเข้าถึง

### การแบ่งสิทธิ์

- Create/status/retry API ใช้ `requireAdmin` บน server เท่านั้น
- Worker process มีเพียง `SHELTER_IMPORT_WORKER_URL`, worker bearer token และ worker ID; ห้ามส่ง `COUCHDB_ADMIN_URL` หรือ CouchDB credential เข้า container worker
- SvelteKit server เป็นผู้เรียก CouchDB ผ่าน server-only `couch-admin.ts`; ถ้าจะใช้ service account แยก ต้องเพิ่ม principal และสิทธิ์ใน contract ก่อน implementation
- `_security` ของ `shelter_import_queue` ต้องไม่ให้ public/staff role อ่าน raw job/item payload โดยตรง; การอ่านของ system admin ต้องผ่าน BFF ที่ทำ response projection
- queue design doc ต้องมี `validate_doc_update` ปฏิเสธการแก้ไขจาก browser session, ปฏิเสธการเปลี่ยนชนิดเอกสาร และรักษา append-only/field invariant ที่จำเป็น
- ค่าเริ่มต้นของ queue `_security` ต้องระบุใน deployment contract: `admins.roles=["_admin"]`, `members.names=[]`, `members.roles=[]`; ไม่มี public/staff member หรือ CouchDB principal ของ worker container และ system admin ต้องอ่านผ่าน BFF เท่านั้น; `adminRaw` ของ SvelteKit server เป็นผู้ทำ privileged read/write
- worker route ใช้ `Authorization: Bearer`, เปรียบเทียบ token แบบ constant-time, จำกัดความยาว/รูปแบบ `x-shelter-import-worker-id`, ไม่ log token และต้องมีนโยบาย rotation/revocation
- `/api/internal/shelter-import/worker/next` เป็น machine-to-machine route ห้ามเปิดผ่าน public ingress; ถ้า Nginx ใช้ `location /` แบบ catch-all ต้องเพิ่ม deny สำหรับ path นี้หรือแยก internal listener โดยไม่เพิ่ม public route

### Response projection

Status API ส่งเฉพาะ:

- job: id, filename, duplicate action, counters, status, attempt, timestamps และ audit status ที่จำเป็น
- item: id, row, name, status, attempts, max_attempts, code, dead-letter timestamp และ error ที่ผ่านการจำกัดขนาด

Status API ห้ามส่ง `input`, `lease_until`, `worker_id`, `claim_token`, CouchDB admin data หรือข้อมูลภายในที่ใช้ fencing ให้ browser แม้ผู้เรียกเป็น system admin

## การเขียนข้อมูลแบบชุดและการจัดการข้อผิดพลาด

- stage item ด้วย `_bulk_docs` ไม่เกิน 100 รายการหรือ 512 KiB ต่อ batch แล้วอ่านผลลัพธ์รายเอกสารทุกตัว
- `_bulk_docs` ไม่ใช่ transaction: ถ้าบางเอกสารล้ม ให้ retry เฉพาะเอกสารที่ยังไม่ยืนยันผลด้วย deterministic ID; ถ้า response หาย ให้ตรวจ ID เดิมก่อนเขียนซ้ำ
- สร้าง job ที่ `queued` หลัง item valid/invalid ถูก stage ครบเท่านั้น ถ้า stage ไม่ครบ ห้ามให้ worker เห็น job
- ถ้า cleanup item ที่เขียนค้างทำไม่สำเร็จ ต้องสร้าง metric/alert และมี `migrate-shelter-import-queue.ts` หรือ repair command ที่ล้างด้วย job ID เดิมได้
- ทุก HTTP 409 ต้องแยกเป็น concurrency conflict แล้ว re-read ตาม policy; 429/5xx/network timeout ให้ backoff จำกัดครั้ง; validation error และ permission error ห้าม retry แบบไม่จำกัด
- ถ้า queue database หรือ design deployment ล้มตอนสร้างงาน ให้ตอบ `503`/`409` ตามสาเหตุ และห้ามสร้าง job บางส่วนที่ worker มองเห็นได้

## การย้ายข้อมูลและ rollback

### ลำดับ deploy และ cutover

1. เพิ่ม queue database, `_security`, `validate_doc_update`, design/view และ verification command ก่อนเปิด code path ใหม่
2. Deploy reader/API ที่อ่านได้ทั้ง legacy `registry` และ queue แต่กำหนด mode ชัดเจน (`legacy`, `migrate`, `queue`); การ fallback ทำได้เฉพาะ lookup งานเก่าตาม migration mode ไม่ใช่ fallback เมื่อ queue ล่ม
3. หยุดการสร้าง job ใหม่และหยุด worker รุ่นเก่า รอ request ที่กำลังทำงานจบ และรอ lease เดิมหมดอายุเพื่อกัน side effect ซ้อน
4. `migrate-shelter-import-queue.ts` คัดลอกเฉพาะ job ที่ยังไม่ terminal และ item ของ job เดียวกันไป queue ด้วย ID เดิม; ไม่คัดลอกงานที่จบแล้ว
5. ระหว่างคัดลอกให้ตรวจจำนวน item, row, status, counter, `attempt`, `audit_log_id` และ payload hash; เขียน migration marker แบบ deterministic เพื่อให้รันซ้ำได้
6. งานที่เคย `running` แต่ไม่มี worker รุ่นเก่าแล้วให้เปลี่ยนเป็น `pending` หรือ reclaim ตาม lease policy ก่อนเปิด worker รุ่นใหม่
7. เมื่อ verification ผ่าน ให้เปิด worker รุ่นใหม่แบบ queue-only และให้ create/status/retry ใช้ queue เป็น source of truth สำหรับงานใหม่
8. เก็บเอกสาร legacy ใน `registry` เป็น read-only ตาม retention และปิด legacy write หลังไม่มีงานค้าง

### กติกา rollback

- ก่อน cutover: หยุด migration และกลับไปใช้ legacy worker ได้ เพราะยังไม่มี queue write ที่เป็น source of truth
- หลัง queue worker เริ่มสร้างผลข้างเคียงแล้ว: ห้ามเปิด legacy worker กลับทันที ต้องหยุด queue worker, ตรวจงาน active, ทำ reverse migration ที่มี marker หรือแก้ไปข้างหน้าโดย operator; ห้าม mark สำเร็จปลอมและห้ามย้อนผลข้างเคียงของ shelter ที่สร้างแล้วโดยอัตโนมัติ
- ถ้า audit log เขียนสำเร็จแต่ mark ใน queue ไม่สำเร็จ ให้ repair ด้วย `audit_log_id` เดิม; ห้ามสร้าง log ใหม่เพียงเพราะ response หาย
- ถ้า queue database ใช้งานไม่ได้ระหว่าง cutover ให้หยุดรับงานใหม่และแจ้ง `503`; ห้าม fallback ไป claim จาก `registry`

## ไฟล์ที่ต้องแก้

### ไฟล์ระบบหลัก

- `frontend/src/lib/server/shelter-import-queue-design.ts` — design doc, views, version และ validation ของ queue
- `frontend/src/lib/server/registry-design.ts` — `by_normalized_name` และคง shelter/code views
- `frontend/src/lib/features/shelter-import/server/job-store.ts` — เปลี่ยน database client, bounded claim, reduce counter, bulk staging, migration compatibility และ audit repair
- `frontend/src/lib/server/shelters.admin.ts` — เพิ่ม lookup ตาม code/normalized name และกัน full scan ใน provisioning path
- `frontend/src/lib/features/shelter-import/application/queries.ts` — คง active-job ETag/backoff และ history changes feed ให้ถูก database
- `frontend/src/lib/features/shelter-import/data/import-log.remote.ts` — คง audit log ที่ `registry` และ response cap
- `frontend/src/lib/features/shelters/server/provisioner.ts` — ใช้ indexed duplicate lookup โดยยังใช้ name lock/code allocator จาก `registry`
- `frontend/src/lib/server/shelter-name-lock.ts` — ตรวจและทดสอบว่า lock ไม่ถูกย้ายไป queue จนทำให้ single-shelter API ใช้คนละ lock

### Routes และ worker

- `frontend/src/routes/api/back-office/shelter-import/jobs/+server.ts` — admin auth, body limit, server validation และสร้าง job แบบ stage-then-publish
- `frontend/src/routes/api/back-office/shelter-import/jobs/[jobId]/+server.ts` — อ่าน queue status, ETag และ response projection
- `frontend/src/routes/api/back-office/shelter-import/jobs/[jobId]/retry/+server.ts` — retry เฉพาะ failed ตาม transition contract
- `frontend/src/routes/api/internal/shelter-import/worker/next/+server.ts` — private route, token auth, one-item processing และ error mapping
- `frontend/server/shelter-import-worker.mjs` — polling/backoff, timeout, worker ID และ graceful shutdown
- `nginx/nginx.conf` หรือ ingress policy ของ deployment — deny internal worker route จาก public plane หาก catch-all ยังส่งทุก path ไป frontend

### Database, deployment และเอกสาร

- `frontend/scripts/seed.ts` และ `frontend/scripts/redeploy-access.ts` — สร้าง queue database, deploy design/security แบบ idempotent และตรวจ version
- `frontend/scripts/migrate-shelter-import-queue.ts` — migration, verification, marker และ repair command
- `docs/data/schema.md` — job/item queue contract, view keys, security และ retention
- `docs/data/data-model.md` — ownership/topology ของ queue กับ registry
- `docs/data/api-contract.md` — BFF, internal route, session และ failure boundary
- `docs/changes/CR-123-shelter-import-worker-pipeline.md` — อัปเดต amendment เรื่อง storage และ route ให้ไม่ขัดกัน
- `.env.example`, `frontend/.env.example` และ compose ทุก variant — queue DB name, worker token และ internal-only network wiring

## อายุข้อมูลและการล้างข้อมูล

- job/item ที่ terminal แล้วล้างหลัง 30 วัน โดย cleanup ต้องตรวจ `finished_at`, database ที่ถูกต้อง และไม่ลบงาน `queued/running`
- audit log อยู่ `registry` และเก็บตาม audit-retention policy ของโครงการ อย่างน้อย 365 วันจนกว่าจะมี policy กลางที่อนุมัติตัวเลขอื่น
- cleanup ใช้ server-side credential ที่ได้รับอนุญาตเท่านั้น ทำงานแบบ idempotent และบันทึกจำนวนเอกสารที่ลบ/ล้มเหลว
- ห้ามลบ audit log เพื่อแก้ counter และห้าม cleanup เอกสารที่มี migration marker แต่ยังตรวจสอบไม่เสร็จ

## เกณฑ์ยอมรับ

- [ ] งาน 1,000 แถวตอบ `202 + jobId` หลัง stage ครบ โดยไม่รอ provisioning ทั้งงาน และปฏิเสธ request ที่เกิน 1,000 แถวหรือ 5 MiB
- [ ] worker poll ไม่อ่าน job ทั้งฐานข้อมูล; query ใช้ `jobs_by_runnable`, `limit` และ keyset pagination
- [ ] การ claim ใช้ `items_by_job_status_row` หรือ `running_items_by_lease`, คืน candidate ไม่เกิน 1 รายการ และไม่ใช้ `_all_docs`/`skip` ใน hot path
- [ ] ไม่มีการเรียก `listShelterMasters()` ใน duplicate/provisioning path; code/name lookup ใช้ view และ missing design ทำให้ fail closed
- [ ] เมื่อ worker 5 ตัวประมวลผล 1,000 แถว counters สุดท้ายตรงกับ reduce view และไม่มี counter ติดลบ/นับซ้ำ
- [ ] เมื่อ worker ล้มในทุกจุดระหว่าง item update, counter sync และ audit write ระบบกู้คืนได้โดยไม่สร้าง shelter master/seed ซ้ำ
- [ ] การชน `_rev` ของ item/job/lock/counter ทำให้ผู้ชนะมีเพียงหนึ่งตัว และ worker เก่าเขียนทับ worker ใหม่ไม่ได้
- [ ] `pending/running/created/updated/skipped/failed/validation_error` เปลี่ยนตาม transition matrix และ retry ไม่แตะ `validation_error`
- [ ] งานที่มีแถวไม่ผ่าน validation ทั้งหมดจบเป็น `completed_with_errors` พร้อม audit log โดยไม่เริ่ม provisioning และงานที่ไม่มีแถวถูกปฏิเสธตั้งแต่ API validation
- [ ] ชื่อที่ซ้ำกันภายใน batch เดียวกันใช้ normalized-name lock เดียวกัน และผล `skip/update/create` ตรงกับ duplicate policy โดยไม่สร้าง master ซ้ำ
- [ ] `_bulk_docs` partial response, response หาย และ retry เฉพาะ failed docs ไม่ทำให้ job ถูกเผยแพร่เป็น `queued` แบบข้อมูลไม่ครบ
- [ ] status response ไม่คืน `input`, `claim_token`, `worker_id`, `lease_until` หรือ CouchDB credential และ user ที่ไม่ใช่ system admin อ่าน queue โดยตรงไม่ได้
- [ ] public ingress เรียก `/api/internal/shelter-import/worker/next` ไม่ได้ แม้ไม่มี route ใหม่ใน Nginx; ได้ `403/404` จาก public plane และ worker ภายในยังเรียกได้
- [ ] migration รันซ้ำได้, ไม่สร้าง job/item ซ้ำ, ตรวจ hash/count ครบ และ old/new worker ไม่ประมวลผลงานเดียวกันพร้อมกัน
- [ ] rollback ก่อนและหลัง cutover มีผลตามกติกา และไม่ mark งานสำเร็จปลอม
- [ ] benchmark fixture ผ่าน query/request/latency target และบันทึก CPU/memory ก่อนอนุมัติ

## แผนการทดสอบ

- unit: key builder, normalized name, query URL, response projection, transition matrix, counter reduce mapping และ error classification
- server/API: admin RBAC, actor spoofing, client error spoofing, body limit, 409/429/5xx, ETag/304 และ missing design fail-closed
- worker: token constant-time, invalid worker ID, one-item processing, timeout, lease renewal/reclaim, graceful shutdown และ backoff
- concurrency: worker หลายตัวกับ item เดียว, worker กับ single-shelter API, same-name lock และ code allocator
- CouchDB integration: queue design/security, view ranges, reduce counters, `_bulk_docs` partial write, lost response, migration marker และ cleanup
- security: direct queue access ของ public/staff, route ผ่าน public Nginx, ไม่ส่ง CouchDB credential เข้า worker container และไม่คืน raw payload
- audit: schema_v 2/3 compatibility, cap 200 rows/200 chars, append-only, cross-database audit repair และ duplicate log prevention
- UI/E2E: active job ETag/backoff, รายการรายแถว, retry visibility, error redaction และ history changes feed
- Python worker: ยืนยันว่าไม่ consume queue docs และ projection CouchDB → MongoDB ยังทำงานตามเดิม

คำสั่ง baseline:

```bash
pnpm --dir frontend check
pnpm --dir frontend exec vitest run src/lib/features/shelter-import src/lib/features/shelters/server
pnpm --dir frontend lint
docker compose config --quiet
```

Integration test ที่ใช้ CouchDB จริงต้องแยกจาก unit test และต้อง cleanup database/เอกสารทดสอบทุกครั้ง

## Redis ในอนาคต

Redis ไม่อยู่ใน change นี้ เพราะไม่แก้ปัญหาการอ่านข้อมูลทั้งหมดใน CouchDB โดยตรง และเพิ่มระบบที่ต้องดูแลใหม่ หากภายหลังต้องใช้ Redis ต้องทำ CR แยกพร้อมระบุ persistence, duplicate delivery, restart, dead-letter, ACL/TLS และ source of truth ว่ายังเป็น CouchDB หรือย้ายไป Redis

## บันทึกการตัดสินใจ

- 2026-09-16 — proposed: draft นี้เป็น amendment ของ CR-123 เพื่อแก้ปัญหา import จำนวนมากใน dev/local
- 2026-09-16 — proposed: ทำระยะที่ 1 และระยะที่ 2 ใน change เดียว; แยก job/item ไป `shelter_import_queue`
- 2026-09-16 — proposed: คง shelter master, audit log, name lock และ code allocator ไว้ใน `registry` เพราะถูกใช้ร่วมกับ single-shelter API
- 2026-09-16 — proposed: ใช้ item status และ reduce view เป็น source of truth ของ counter; job counter เป็น snapshot ที่ต้องซ่อมได้
- 2026-09-16 — proposed: worker ไม่มี CouchDB credential; SvelteKit server เป็นผู้เรียก CouchDB และ internal route ต้องไม่เข้าจาก public plane
- 2026-09-16 — proposed: ไม่เพิ่ม Redis/PostgreSQL และไม่นำ Python sync worker มารวมกับ import worker
