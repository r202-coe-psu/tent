---
id: draft
title: Shelter Excel Import — เปลี่ยนจาก browser loop เป็น Durable Worker Job Pipeline
status: proposed
date: 2026-09-14
updated: 2026-09-14
requested_by: Project Owner
decided_by: pending formal approval
layer: volatile
affects:
  - CR-039 (proposed amendment ของ FR-06, FR-07, FR-08 และ flow การ commit)
  - _bmad-output/implementation-artifacts/spec-async-shelter-import-job.md
  - frontend/src/lib/features/shelter-import/
  - frontend/src/lib/features/shelters/server/provisioner.ts
  - frontend/src/routes/api/back-office/shelter-import/
  - frontend/server/shelter-import-worker.mjs
  - docker-compose.production*.yml, docker-compose.staging*.yml
---

# Draft — Shelter Excel Import: Durable Worker Job Pipeline

## สรุป (TL;DR)

เปลี่ยนกระบวนการนำเข้า shelter จากการให้ browser วนเรียกสร้าง shelter ทีละแถว ไปเป็นการสร้าง
**durable import job** แล้วให้ **Node worker ประมวลผลทีละ shelter** บน server พร้อมบันทึกสถานะรายแถว
ให้ frontend แสดงความคืบหน้าและ retry ได้

Draft นี้เป็น amendment ที่เสนอสำหรับ [CR-039](CR-039-shelter-excel-import.md) โดยเฉพาะข้อกำหนดเดิมที่ให้
browser commit แบบ sequential; ข้อมูล template, column mapping และ validation ที่ไม่ขัดกับ CR นี้ยังคงเดิม

รายละเอียด implementation ที่ลงมือแล้วอยู่ใน
[`spec-async-shelter-import-job.md`](../../_bmad-output/implementation-artifacts/spec-async-shelter-import-job.md)

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
| ความคืบหน้า | รู้ผลเมื่อ loop จบ | Poll สถานะ job และ item รายแถว |
| Failure | รวมผลท้าย batch, retry ยาก | เก็บ error ต่อ item และ retry เฉพาะ `failed` |
| Restart | ปิด tab แล้ว state หาย | Lease หมดอายุแล้ว worker อื่น reclaim ได้ |
| Audit | เขียน log หลัง loop | สร้าง/ปรับปรุง log เมื่อ job terminal ให้ตรงกับผลล่าสุด |
| Single shelter API | เป็น endpoint ที่ importer เรียกโดยตรง | ยังคงอยู่ และใช้ provisioning service ร่วมกับ worker |

## Architecture

### 1. Durable job model

งานหนึ่งชุดประกอบด้วยเอกสารใน `registry`:

- `shelter_import_job:<ulid>` — metadata, duplicate policy, counters และ job status
- `shelter_import_item:<job_id>:<row>` — payload ที่ผ่าน server validation, status, code, error และ lease
- `shelter_import_log:<job_id>` — audit result ที่สร้างเมื่อ job จบ

เอกสาร item ถูกเขียนให้ครบก่อนเผยแพร่ job เป็น `queued` เพื่อไม่ให้ worker เห็น batch ที่ยังสร้างไม่ครบ

Worker runtime ใช้กลไกกลางที่นำกลับไปใช้กับ job ประเภทอื่นได้ในอนาคต โดยให้แต่ละประเภทมี handler ของตัวเอง
เช่น `shelter-import`, `report-export` หรือ `notification` แต่ CR นี้ implement handler แรกคือ shelter import

### 2. Worker responsibility

Worker ต้องทำงานตามลำดับนี้:

1. อ่าน job ที่ `queued` หรือ `running`
2. claim item ที่ `pending` หรือ `running` แต่ lease หมดอายุ ด้วย CouchDB `_rev` compare-and-swap
3. ได้ผู้ชนะเพียงหนึ่ง worker ต่อ item
4. ตรวจ duplicate ชื่อศูนย์ภายใต้ name lock
5. ดำเนินการ `skip`, `update` หรือ `create`
6. บันทึก `code`, status และ error ของ item
7. recompute counters ของ job
8. เมื่อไม่มี item ค้าง ให้สร้าง/ปรับปรุง `shelter_import_log`

Worker process ไม่รับ payload จาก client โดยตรง; รับเพียง internal token-authenticated request เพื่อ claim งานจาก registry

### 3. Generic runtime boundary

ส่วนที่เป็น generic และควรใช้ซ้ำ:

- claim / lease / revision conflict
- retry และ attempt counter
- job/item status และ progress counters
- worker identity, timeout และ graceful shutdown
- internal worker authentication และ logging

ส่วนที่เป็น domain handler ของ shelter import:

- `createShelterSchema` server revalidation
- duplicate-by-name policy
- shelter code allocation
- CouchDB database/security/design/seed provisioning
- `shelter_import_log` result mapping

Python `sync-worker` เดิมยังคงทำหน้าที่ CouchDB → MongoDB projection ต่อไป ไม่ถูกนำมารวมกับ import job worker

## State model

### Job status

```text
queued → running → completed
                 ↘ completed_with_errors
```

- `queued`: รับ job แล้ว ยังไม่มี item ถูกประมวลผล
- `running`: มี item pending/running
- `completed`: ทุก item จบโดยไม่มี failure
- `completed_with_errors`: มี `failed` หรือ `validation_error`

### Item status

```text
pending → running → created
                  ↘ updated
                  ↘ skipped
                  ↘ failed
validation_error (terminal; ไม่ retry อัตโนมัติ)
```

`failed` เท่านั้นที่ผู้ใช้สั่ง retry ได้ ส่วน `validation_error` ต้องแก้ข้อมูลแล้ว upload ใหม่

## API contract

### Create job

`POST /api/back-office/shelter-import/jobs`

- authorization: system admin
- input: `filename`, `imported_by`, `duplicate_action`, `rows[]`
- server revalidates every `shelter` payload ด้วย `createShelterSchema`
- invalid rows ถูกบันทึกเป็น item `validation_error`
- success: HTTP `202` และ `{ jobId }`
- request ต้องมี worker token configuration; ถ้า deployment ไม่พร้อมให้ตอบ `503` ก่อนสร้าง job

### Read status

`GET /api/back-office/shelter-import/jobs/:jobId`

- authorization: system admin
- output: `{ job, items }`
- no-store response เพื่อให้ polling เห็นสถานะล่าสุด

### Retry failed items

`POST /api/back-office/shelter-import/jobs/:jobId/retry`

- authorization: system admin
- เปลี่ยนเฉพาะ item ที่เป็น `failed` กลับเป็น `pending`
- preserve allocated shelter code เพื่อให้ retry idempotent

### Internal worker claim/process

`POST /api/back-office/shelter-import/worker/next`

- internal worker token เท่านั้น
- หนึ่ง request ทำสำเร็จได้ไม่เกินหนึ่ง item
- `204` เมื่อไม่มีงาน
- item error ไม่หยุด worker loop; บันทึก `failed` แล้วไป item ถัดไปใน poll รอบถัดไป

## Reliability and idempotency rules

- ห้าม queue อยู่ใน process memory อย่างเดียว
- claim ต้องใช้ CouchDB `_rev`; `409` แปลว่า worker อื่นชนะ claim แล้ว
- lease default มีอายุจำกัด; worker ใหม่ reclaim item ที่ค้างหลัง restart
- item ที่ได้ code แล้วต้องเก็บ code ก่อนเริ่ม provisioning เพื่อให้ retry ใช้ code เดิม
- `updateImportItem` ต้องไม่ให้ worker ที่ lease หลุดเขียนทับผลของ worker รุ่นใหม่
- same-name imports ใช้ registry name lock แบบมี lease
- registry master และ seed writes ต้องตรวจ HTTP status ทุกครั้ง
- import log ต้อง idempotent และสะท้อนผลล่าสุดหลัง retry
- single-shelter API ต้องยังทำงานเหมือนเดิมผ่าน shared provisioning service

## Frontend process

1. ผู้ใช้เลือกไฟล์และตรวจ preview/validation ตาม CR-039
2. กด import แล้ว client สร้าง job เพียง request เดียว
3. เก็บ `jobId` ใน `sessionStorage` เพื่อกลับมาเห็นงานปัจจุบันหลัง reload
4. poll สถานะทุกประมาณ 1.5 วินาทีจน terminal
5. แสดง counters: สำเร็จ, ข้ามซ้ำ, ล้มเหลว, รอคิว
6. แสดง status, code และ error ต่อ shelter
7. เปิดปุ่ม retry เฉพาะเมื่อมี item `failed`
8. เมื่อจบ invalidate shelter list และ import history

## Deployment and operations

- เพิ่ม `import-worker` service แยกจาก Python `worker` ใน production/staging compose
- ใช้ image frontend เดียวกัน แต่รัน `pnpm import-worker`
- ตั้ง `SHELTER_IMPORT_WORKER_TOKEN` ค่าเดียวกันใน frontend และ import-worker
- worker ต้องหยุดแบบ graceful เมื่อได้รับ `SIGTERM`
- หาก token ไม่ถูกตั้ง API จะไม่รับ job ใหม่ และ worker จะหยุดพร้อม error ที่ชัดเจน
- การ monitor ขั้นต้นดู worker logs, queued jobs และ jobs ที่มี lease หมดอายุ

## Requirements

- **FR-01 Durable create:** initial import request ต้องคืน job id โดยไม่รอ provisioning ทั้ง batch
- **FR-02 Sequential item processing:** worker หนึ่งตัว process ได้ทีละ shelter item
- **FR-03 Server validation:** ทุก row ต้องถูก revalidate บน server ก่อนเข้าคิว provisioning
- **FR-04 Partial success:** item สำเร็จต้องไม่ rollback เพราะ item อื่นล้มเหลว
- **FR-05 Lease safety:** worker restart และ expired lease ต้อง resume ได้โดยไม่สร้าง completed item ซ้ำ
- **FR-06 Idempotent retry:** retry เฉพาะ `failed` และใช้ allocated code เดิม
- **FR-07 Progress UI:** frontend ต้องแสดงสถานะและ error ราย shelter แบบ accessible
- **FR-08 Audit parity:** `shelter_import_log` ต้องตรงกับ job outcomes หลัง terminal/retry
- **FR-09 Access control:** create/status/retry เป็น system-admin; internal worker ใช้ secret แยก
- **FR-10 Reusable runtime:** queue mechanics ต้องแยกจาก shelter handler เพื่อรองรับ job type อื่น

## Acceptance criteria

- [ ] ไฟล์ที่มี valid shelters จำนวน N แถวตอบกลับ `202 + jobId` โดยไม่รอสร้าง N shelter
- [ ] มี worker request ที่กำลัง provisioning ได้ไม่เกินหนึ่ง shelter ต่อ worker instance
- [ ] เมื่อมีทั้ง success และ failure งานอื่นยังดำเนินต่อ และ UI แสดงผลรายแถวตรงกับ audit log
- [ ] ปิด tab หรือ restart worker แล้ว item pending/running ที่ lease หมดอายุยังทำต่อได้
- [ ] สอง worker claim item เดียวกันได้ผู้ชนะเพียงหนึ่งรายจาก CouchDB revision conflict
- [ ] retry requeue เฉพาะ `failed`; `validation_error` ไม่ถูก retry โดยไม่แก้ข้อมูล
- [ ] retry หลัง allocate code แล้วไม่สร้าง shelter code ใหม่
- [ ] duplicate skip/update ทำงานตาม policy และไม่สร้างชื่อซ้ำจาก concurrent jobs
- [ ] single-shelter create endpoint ยังผ่าน regression tests
- [ ] Python sync worker ยังทำ projection ตามเดิมและไม่ถูก block จาก import provisioning

## Test and verification plan

- unit test: state transitions, lease expiry, revision conflict, retry filtering, name lock
- unit/API test: server revalidation, payload size limit, admin/internal authorization
- worker test: one-item processing, partial failure, restart/reclaim, idempotent code reuse
- UI test: counters, per-row status, accessible progress, retry button visibility
- integration test กับ CouchDB สำหรับ registry job/item/log documents
- command baseline:

```bash
pnpm --dir frontend check
pnpm --dir frontend exec vitest run src/lib/features/shelter-import
pnpm --dir frontend lint
docker compose -f docker-compose.production.yml config --quiet
```

## Migration and compatibility

- ไม่เปลี่ยน `shelter` schema version
- `shelter_import_log` ยังคง schema เดิมและเพิ่ม counters ตาม CR-039 ที่ landed แล้ว
- completed legacy logs อ่านได้เหมือนเดิม
- งานใหม่ใช้ durable job documents; ไม่มีการสร้าง job ย้อนหลังสำหรับ import ที่จบไปแล้ว
- `POST /api/back-office/shelter` ยังคงเป็น public internal contract สำหรับ single shelter
- เมื่อ draft นี้ได้รับอนุมัติ ให้ mark CR-039 เป็น `superseded` เฉพาะ flow commit ที่ browser ถือ request; column mapping/template ยังคงใช้ได้

## Out of scope

- ไม่รวมการเปลี่ยน Python CouchDB → Mongo projection worker ให้เป็น job worker
- ไม่รวม distributed scheduler หรือ autoscaling หลาย worker แบบ dynamic
- ไม่รวม resume งานที่ไม่มี job/item documents จาก implementation เดิม
- ไม่รวมการ rollback shelter ที่สร้างสำเร็จแล้วเมื่อแถวอื่นล้มเหลว

## Decision log

- 2026-09-14 — Project Owner requested this draft to document the change from browser sequential import to durable worker job pipeline.
- 2026-09-14 — Proposed to separate import job worker from Python sync worker so provisioning workload cannot block Mongo projection.
- 2026-09-14 — Proposed generic queue mechanics + per-domain handlers as the reuse direction for future batch jobs.
