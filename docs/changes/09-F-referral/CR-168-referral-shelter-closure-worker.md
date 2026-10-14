---
id: CR-168
title: Referral — flow ปิดศูนย์ด้วย durable worker job (referral-worker)
status: approved
date: 2026-10-14
approved: 2026-10-14
requested_by: project owner
decided_by: project owner
layer: stable
depends_on: CR-167 (ต้อง approve และ implement ก่อน — ใช้ `sent → closed`, `close_reason`, schema_v 2 และ core function `bulkTransition`)
affects:
  - docs/data/schema.md (doc type ใหม่ `referral_close_job` schema_v 1 ใน `central_ops`; `referral_close_lock` schema_v 1)
  - docs/data/data-model.md (topology: referral-worker, ownership ของ job doc)
  - docs/data/api-contract.md (job endpoints + internal worker route)
  - frontend/src/lib/features/referrals/server/close-job-store.ts (ใหม่)
  - frontend/src/routes/api/back-office/referral/close-shelter/** (preview, jobs, cancel — ใหม่)
  - frontend/src/routes/api/back-office/referral/+server.ts (POST: guard ขณะมี job active)
  - frontend/src/lib/features/referrals/ui/shelter-combobox.svelte (prop `includeClosed` สำหรับยืนยันปิดศูนย์)
  - frontend/src/routes/api/internal/referral-close/worker/next/+server.ts (ใหม่)
  - frontend/server/referral-worker.mjs (ใหม่)
  - frontend/package.json (script `referral-worker`)
  - frontend/src/routes/(protected)/back-office/referrals/close-shelter (หน้าใหม่)
  - frontend/src/lib/features/referrals/ui (หน้าปิดศูนย์, ตัวแสดงความคืบหน้า)
  - docker-compose.yml, docker-compose.staging*.yml, docker-compose.production*.yml (service `referral-worker`)
  - .env.example, frontend/.env.example (REFERRAL_WORKER_*)
  - nginx/nginx.conf (deny `/api/internal/referral-close/` จาก public listener)
---

# Referral — flow ปิดศูนย์ด้วย durable worker job

## สรุป (TL;DR)

ผู้ใช้สั่งปิด referral ทั้งศูนย์ครั้งเดียว ระบบสร้าง **durable job** (doc เดียวต่อการปิดศูนย์หนึ่งครั้ง) ให้ Node service ใหม่ `referral-worker` ประมวลผลต่อบน server จนจบโดยไม่ต้องเปิดหน้าจอค้าง · ขาออกปิดทุกสถานะ, ขาเข้า `sent` ปฏิเสธด้วยเหตุผล "ศูนย์ปิด" · job หน่วง 60 วินาทีก่อนเริ่มและยกเลิกได้เฉพาะช่วงนั้น · ยืนยันด้วย search-select เลือกศูนย์ (ชื่อหรือรหัส) · ขณะ job active ศูนย์นี้สร้าง referral ใหม่ไม่ได้
Dev ต้องสร้าง doc type `referral_close_job`, route internal ที่ใช้ token, worker script, compose service, หน้าสั่ง/ติดตามงาน และ guard ในการสร้าง referral · ไม่เพิ่ม Redis, ไม่ใช้ sync worker ของ Python
ชั้น **stable** (เพิ่ม service และ doc type ใหม่) ต้อง review ก่อน approve

## Why

- ศูนย์ที่มี referral สะสมหลายพันรายการต้องปิดทั้งหมดได้ในครั้งเดียว การรันจาก browser เสี่ยงที่ผู้ใช้ปิดแท็บหรือ proxy timeout แล้วงานค้างครึ่งทาง
- ต้องการให้งานจบแน่นอนโดยไม่มีผู้ใช้ต้องรอหน้าจอ (project owner, 2026-10-14)
- referral เป็น doc ใน `central_ops` ที่เปลี่ยนสถานะแบบ idempotent ต่อรายการ จึงไม่ต้องมี doc ต่อรายการเหมือน CR-123 (ลดแรงกดดัน CouchDB ตามบทเรียน CR-126)
- ไม่ใช้ Python sync worker: ทำ projection CouchDB→Mongo และไม่ projection referral state machine และสิทธิ์อยู่ใน TypeScript การเขียนซ้ำใน Python จะคลาดกัน
- ไม่ใช้ Redis: ไม่มีใน compose และ CR-126 กำหนดเป็น out of scope สถานะงานเก็บใน CouchDB

## Change

### Doc types (ใน `central_ops`, central envelope เหมือน referral)

| Doc type | `_id` pattern | schema_v | หน้าที่ |
| --- | --- | ---: | --- |
| `referral_close_job` | `referral_close_job:<ulid>` | 1 | งานปิดศูนย์หนึ่งครั้ง: ผู้สั่ง, เหตุผล, สถานะ, ตัวนับ, cursor, lease |
| `referral_close_lock` | `referral_close_lock:<shelter_code>` | 1 | กัน job active ซ้อนกันต่อศูนย์ (CAS ด้วย `_rev` แบบเดียวกับ `shelter-name-lock`) |

`referral_close_job` schema_v 1 ขั้นต่ำต้องมี: `type`, `schema_v`, `job_ulid`, `shelter_code`, `requested_by`, `reason`, `status` (`scheduled|running|completed|completed_with_errors|cancelled`), `start_after` (เวลาที่ worker เริ่มได้เร็วที่สุด), `phase` (`outgoing|incoming|sweep|done`), `cursor`, `counters` (`closed`, `rejected`, `skipped`, `failed`), `preview` (snapshot จำนวนตอนสั่ง), `failures[]` (`{ id, error }`, จำกัดจำนวน), `lease_owner?`, `lease_until?`, `attempt`, `created_at`, `updated_at`, `created_by`, `started_at?`, `finished_at?`, `cancelled_at?`, `cancelled_by?`

job "active" คือสถานะ `scheduled` หรือ `running`

ไม่มี doc ต่อรายการ referral ตัว referral เองคือสถานะงาน

### Requirements — สั่งงานและสิทธิ์

| ID | Requirement |
| --- | --- |
| FR-J1 | หน้าอยู่ที่ `/back-office/referrals/close-shelter` เป็นขั้นตอนแยกที่รันด้วยมือ ไม่ผูกกับ Shelter Master การปิดศูนย์ใน Shelter Master ต้องไม่ถูกบล็อกหรือเตือนโดย referral ค้าง |
| FR-J2 | สิทธิ์ใช้ `authorizeReferral` + `resolveShelterCode` เดิม: `shelter_manager` ของศูนย์ตัวเอง และ `system_admin` (ต้องระบุ `shelter_code`) ไม่เพิ่ม role ไม่แก้ `role-permission-matrix.md` |
| FR-J3 | ก่อนสั่ง ระบบต้องแสดง preview จำนวนที่จะถูกกระทบ แยกตามทิศทาง (ขาออก/ขาเข้า) และสถานะ ผ่าน `GET /api/back-office/referral/close-shelter/preview` |
| FR-J4 | ผู้ใช้ต้องกรอกเหตุผล 1 ข้อความ (≤ 2000 ตัวอักษร) ใช้กับทุกรายการ |
| FR-J5 | การยืนยันต้องทำด้วย search-select (combobox) ที่ค้นได้ทั้งชื่อและรหัสศูนย์ ผู้ใช้ต้องเลือกศูนย์ที่ตรงกับศูนย์เป้าหมาย ปุ่มสั่งงานต้องปิดอยู่จนกว่าจะเลือกตรง และ server ต้องตรวจซ้ำ (`confirm_shelter_code` ต้องเท่ากับ `shelter_code` ของ job) |
| FR-J5a | combobox ต้องใช้ `shelter-combobox` เดิม โดยเพิ่ม prop `includeClosed` เพื่อให้เลือกศูนย์ที่ `operation_status = closed` ได้ (ตัวเดิมกรองศูนย์ที่ปิดแล้วออก ซึ่งใช้ไม่ได้เมื่อศูนย์ถูกปิดใน Shelter Master ไปก่อนสั่ง job) ค่าเริ่มต้นของ prop ต้องคงพฤติกรรมเดิมของฟอร์มสร้าง referral |
| FR-J6 | `POST /api/back-office/referral/close-shelter/jobs` ต้องคืน job id ภายใน request budget โดยไม่รอการประมวลผล และ actor (`requested_by`) ต้องมาจาก session ฝั่ง server ไม่รับจาก client job ใหม่ต้องมี `status = scheduled` และ `start_after` = เวลาสร้าง + 60 วินาที (proposed default) |
| FR-J7 | ต้องมี job active (`scheduled`/`running`) ไม่เกิน 1 ต่อศูนย์ การสร้าง job ที่สองต้องได้ `409` (ใช้ `referral_close_lock` ตาม CAS) lock ต้องถูกปล่อยเมื่อ job เป็น terminal (`completed`, `completed_with_errors`, `cancelled`) |
| FR-J8 | ผู้ใช้สร้าง job ใหม่ของศูนย์เดิมได้เมื่อ job ก่อนหน้าเป็น terminal (เช่น `completed_with_errors`, `cancelled`) run ใหม่ต้องข้ามรายการที่ปิดแล้ว |
| FR-J9 | ยกเลิก job ได้เฉพาะช่วงหน่วงก่อนเริ่ม: `POST …/close-shelter/jobs/[id]/cancel` ต้องเปลี่ยน `scheduled → cancelled` ด้วย CAS เมื่อ `now < start_after` และ worker ยังไม่ claim เท่านั้น แล้วปล่อย `referral_close_lock` เมื่อ job เป็น `running` หรือเลยเวลาแล้วต้องได้ `409` ห้ามมีการยกเลิกหลังเริ่ม |
| FR-J10 | ขณะศูนย์มี job active ระบบต้องปฏิเสธการสร้าง referral ใหม่ **ของศูนย์นั้น** (`POST /api/back-office/referral` ที่ `shelter_code` = ศูนย์นั้น) ด้วย `409` พร้อมข้อความที่บอกว่าศูนย์กำลังปิด referral การสร้างของศูนย์อื่นและขาเข้าจากศูนย์อื่นต้องไม่ถูกบล็อก (ขาเข้าที่เกิดระหว่างทำงานพึ่ง sweep ตาม FR-P9) ศูนย์ต้องกลับมาสร้างได้เมื่อ job เป็น terminal |

### Requirements — การประมวลผล

| ID | Requirement |
| --- | --- |
| FR-P1 | phase `outgoing`: referral ที่ `shelter_code` = ศูนย์นี้ และสถานะ ≠ `closed` ต้องถูก transition เป็น `closed` เก็บเหตุผลที่ `close_reason` |
| FR-P2 | phase `incoming`: capacity referral ที่ `to_shelter_code` = ศูนย์นี้ และสถานะ = `sent` ต้องถูก transition เป็น `rejected` โดย `response_reason` ขึ้นต้นด้วย "ศูนย์ปิด" ตามด้วยเหตุผลของ job |
| FR-P3 | ขาเข้าสถานะอื่น (`accepted`, `rejected`, `closed`) ต้องไม่ถูกแตะ |
| FR-P4 | worker ต้องเรียก `bulkTransition` (CR ฐาน FR-B9) ตัวเดียวกับ endpoint ของ list โดยส่ง `actor` = `requested_by` และ `actorShelter` = `job.shelter_code` เพื่อให้ `assertActorMayTransition` ตัดสินสิทธิ์เหมือนผู้ใช้ทำเอง และ `timeline.closed.by` เป็นชื่อผู้สั่ง |
| FR-P5 | ขนาด batch ต่อการเรียก claim: proposed default 50 รายการ, concurrency ภายใน batch จำกัดตาม CR ฐาน FR-B8 (default 5) |
| FR-P6 | cursor ต้องไม่ข้ามรายการ รวมถึงกรณีหลาย referral มี `created_at` เท่ากัน และต้องใช้ index ที่มีอยู่ (`referral-type-shelter-created-idx`, `referral-type-toshelter-created-idx`) ไม่สแกนข้ามศูนย์ |
| FR-P7 | รายการที่ล้มเหลวต้องไม่ทำให้ job หยุด ให้บันทึก `{ id, error }` ใน `failures[]` (จำกัด proposed default 200 รายการ ส่วนเกินนับใน `counters.failed` อย่างเดียว) แล้วไปต่อ |
| FR-P8 | รายการที่ `closed`/`rejected` แล้วต้องนับเป็น `skipped` ไม่ใช่ `failed` เพื่อให้ run ซ้ำปลอดภัย |
| FR-P9 | เมื่อจบ phase `outgoing` และ `incoming` ต้องทำ `sweep` อีกหนึ่งรอบจากต้นเพื่อจับรายการที่เกิดระหว่างทำงาน และ job จบเมื่อ sweep ไม่พบรายการ |
| FR-P10 | จบ job: `completed` เมื่อ `counters.failed = 0`, มิฉะนั้น `completed_with_errors` และต้อง set `finished_at` และปล่อย `referral_close_lock` |

### Requirements — worker และความน่าเชื่อถือ

| ID | Requirement |
| --- | --- |
| FR-R1 | ห้ามเก็บคิวใน memory ของ process อย่างเดียว สถานะ job ต้องอยู่ใน CouchDB |
| FR-R2 | worker ต้อง claim job ที่ `scheduled` และ `now ≥ start_after` (เปลี่ยนเป็น `running`) หรือที่ `running` แต่ lease หมดอายุ ด้วย lease บน `referral_close_job` ผ่าน CouchDB `_rev` compare-and-swap (`409` = worker อื่นหรือการยกเลิกชนะ) lease TTL 5 นาที และ renew ก่อนครบครึ่งหนึ่งของ TTL |
| FR-R3 | worker ที่ lease หลุดห้ามเขียนทับผลของ worker รุ่นใหม่ job ที่ lease หมดอายุต้องถูก reclaim และทำต่อจาก cursor เดิมได้ |
| FR-R4 | การอัปเดต cursor, counters, phase และ status ต้องใช้ `_rev` (CAS) และเกิดหลังเขียนผลของ batch นั้นแล้ว |
| FR-R5 | route `POST /api/internal/referral-close/worker/next`: ยืนยันตัวตนด้วย `Authorization: Bearer <REFERRAL_WORKER_TOKEN>` เทียบด้วย constant-time comparison, ประมวลผลไม่เกิน 1 batch ต่อ request, ตอบ `204` เมื่อไม่มีงาน, ต้อง deny จาก public listener |
| FR-R6 | provisioning timeout ต่อ request: proposed default 120 วินาที; reverse proxy (ถ้ามี) ต้องมี upstream timeout ≥ 150 วินาที |
| FR-R7 | worker idle sleep 3 วินาทีเมื่อได้ `204`, backoff สูงสุด 5 วินาทีเมื่อ network error, ห้าม busy-loop |
| FR-R8 | SIGTERM ต้องหยุดรับงานใหม่และรอ batch ปัจจุบันไม่เกิน 30 วินาทีก่อน exit |
| FR-R9 | หากไม่ได้ตั้ง `REFERRAL_WORKER_TOKEN` API ต้องไม่รับ job ใหม่ และ worker ต้องหยุดพร้อม error ชัดเจน ห้ามบันทึกค่า token ลง log |
| FR-R10 | job terminal ต้องถูก cleanup หลัง 30 วัน (ตรวจจาก `finished_at`) หลักฐานรายรายการอยู่ที่ `timeline.closed` และ `close_reason` / `response_reason` ของ referral เอง |

### Requirements — หน้าและความคืบหน้า

| ID | Requirement |
| --- | --- |
| FR-U1 | หลังสั่ง ผู้ใช้ต้องออกจากหน้าได้ งานต้องวิ่งต่อ และกลับมาดูสถานะได้จากหน้าเดิม (เก็บ job id ใน `sessionStorage` เป็นความสะดวกเท่านั้น ไม่ใช่ source of truth) |
| FR-U2 | หน้าต้อง poll สถานะ job ที่ active ตาม ETag/backoff จน terminal และแสดงตัวนับ: ปิดแล้ว, ปฏิเสธแล้ว, ข้าม, ล้มเหลว, ทั้งหมดที่คาด (จาก preview) |
| FR-U3 | เมื่อ `completed_with_errors` ต้องแสดงรายการที่ล้มเหลวพร้อมข้อความ (ตาม `failures[]`) และปุ่ม "สั่งใหม่" ตาม FR-J8 |
| FR-U4 | หน้าต้องระบุชัดก่อนกดยืนยันว่า job จะเริ่มหลังหน่วง 60 วินาที ยกเลิกได้เฉพาะช่วงนั้น และหลังเริ่มแล้วยกเลิกไม่ได้ |
| FR-U5 | หลังสั่ง ขณะ `scheduled` หน้าต้องแสดงเวลานับถอยหลังและปุ่ม "ยกเลิก" ปุ่มต้องหายเมื่อ job เริ่มหรือเลยเวลา และต้องแสดงสถานะ `cancelled` เมื่อยกเลิกสำเร็จ |

## Impact

- `docs/data/schema.md` — เพิ่ม §ของ `referral_close_job` และ `referral_close_lock` (schema_v 1, อยู่ใน `central_ops`), ระบุว่าไม่มี `validate_doc_update` บน `central_ops` การบังคับอยู่ที่ server code
- `docs/data/data-model.md` — เพิ่ม `referral-worker` ใน topology และ ownership ของ job doc
- `docs/data/api-contract.md` — เพิ่ม job endpoints (preview, create, status) และ internal worker route
- โค้ด: `close-job-store.ts`, routes, `referral-worker.mjs`, หน้าและ component ใหม่, compose ทุก variant, env, nginx deny
- ใช้ร่วมกับ CR ฐาน: `bulkTransition`, `sent → closed`, `close_reason`
- `POST /api/back-office/referral` เพิ่ม guard ตาม FR-J10 (ตรวจ `referral_close_lock`/job active ของศูนย์ต้นทาง) และ `shelter-combobox` เพิ่ม prop `includeClosed` (ค่าเริ่มต้นคงเดิม)
- ไม่กระทบ: Python sync worker, Mongo projection, public plane, Shelter Master, `role-permission-matrix.md`
- งานปฏิบัติการ: ต้อง monitor log ของ `referral-worker`, job ที่ค้าง `running` เกิน lease, `failed` counter และ 5xx rate

## Migration

doc type ใหม่ทั้งหมด (schema_v 1) ไม่มี backfill ไม่แก้ doc referral เดิมนอกจากที่ CR ฐานกำหนด

ลำดับ deploy: (1) CR ฐาน (Zod รับ schema_v 1|2 และ `close_reason`) ถึงขั้นเขียน v2 แล้ว (2) ตั้ง `REFERRAL_WORKER_TOKEN` เป็นค่าเดียวกันใน API และ worker (`openssl rand -hex 32`) (3) deploy API ที่มี job endpoints และ route internal (4) เปิด service `referral-worker` (5) เปิดหน้าปิดศูนย์ ห้ามเปิดหน้าก่อน worker พร้อม

ไม่มี `validate_doc_update` ต้องอัปเดต

## Acceptance

- [ ] สั่ง job แล้วปิดแท็บทันที (หลังพ้นช่วงหน่วง) งานวิ่งจนจบและเปิดหน้ากลับมาเห็นตัวนับครบ
- [ ] ยกเลิกภายในช่วงหน่วง → job เป็น `cancelled`, ไม่มี referral ใดเปลี่ยนสถานะ, ปล่อย lock และศูนย์สร้าง referral ใหม่ได้อีก
- [ ] ยกเลิกหลัง worker เริ่มแล้ว (หรือเลย `start_after`) → `409` และ job ไม่เปลี่ยน
- [ ] ยกเลิกกับ worker claim พร้อมกัน มีผู้ชนะเพียงหนึ่ง (CAS) ไม่มีสถานะที่เป็นทั้ง `cancelled` และมีรายการถูกปิด
- [ ] ขณะ job `scheduled`/`running` สร้าง referral ใหม่ของศูนย์นั้นได้ `409`, ของศูนย์อื่นสร้างได้ปกติ, ศูนย์อื่นส่ง capacity เข้าศูนย์นี้ได้และถูก sweep จับก่อน job จบ
- [ ] combobox ยืนยัน: พิมพ์ชื่อหรือรหัสแล้วเลือกได้, เลือกศูนย์ผิดแล้วปุ่มสั่งไม่เปิด, ศูนย์ที่ `closed` อยู่แล้วเลือกได้ และฟอร์มสร้าง referral ยังซ่อนศูนย์ที่ปิดแล้วตามเดิม
- [ ] `confirm_shelter_code` ที่ไม่ตรง `shelter_code` (ยิง API ตรง) → ไม่สร้าง job
- [ ] ขาออกทุกสถานะที่ไม่ใช่ `closed` กลายเป็น `closed` พร้อม `close_reason`, `timeline.closed.by` เป็นผู้สั่ง
- [ ] ขาเข้า `sent` กลายเป็น `rejected` พร้อม `response_reason` ขึ้นต้น "ศูนย์ปิด", ขาเข้า accepted/rejected/closed ไม่เปลี่ยน
- [ ] referral ที่ปลายทางตอบรับแล้วและถูกปิดโดยศูนย์ต้นทาง ยังคง `response_reason` เดิม
- [ ] kill worker กลางงาน (หลัง lease หมดอายุ) worker ตัวใหม่ทำต่อจาก cursor โดยไม่ข้ามและไม่ปิดซ้ำ
- [ ] สอง worker แข่ง claim job เดียว มีผู้ชนะเพียงหนึ่ง และผู้แพ้ไม่เขียนทับ
- [ ] สั่ง job ที่สองของศูนย์เดียวกันขณะ job แรก active ได้ `409`
- [ ] `shelter_manager` ของศูนย์อื่นสร้าง job ของศูนย์นี้ไม่ได้, `system_admin` ที่ไม่ระบุ `shelter_code` ได้ `400`
- [ ] referral ที่ล้มเหลวบางรายการ: job จบเป็น `completed_with_errors`, `failures[]` มีรายการ, สั่งใหม่แล้วรายการที่ปิดแล้วนับเป็น `skipped`
- [ ] route internal ไม่มี/token ผิด → `401`, และเข้าถึงจาก public listener ไม่ได้
- [ ] ไม่ตั้ง `REFERRAL_WORKER_TOKEN` → API ไม่รับ job ใหม่ และ worker หยุดพร้อม error
- [ ] referral 5,000 รายการ (seed): job จบโดยไม่มี `EMFILE` ใน CouchDB และจำนวน request พร้อมกันไม่เกิน concurrency ที่กำหนด
- [ ] การปิดศูนย์ใน Shelter Master ทำได้ตามเดิมโดยไม่ถูกบล็อกด้วย referral ค้างหรือ job ที่กำลังทำงาน

## Decision log

- 2026-10-14 — project owner: ปิด referral ทั้งศูนย์เป็น flow แยก ขาเข้า `sent` ปฏิเสธอัตโนมัติด้วยเหตุผล "ศูนย์ปิด", ขาออกปิดได้ทุกสถานะ (พึ่ง `sent → closed` ใน CR ฐาน)
- 2026-10-14 — project owner (N-1): สิทธิ์ = `shelter_manager` ของศูนย์ตัวเอง + `system_admin` ตรงกับ `authorizeReferral` เดิม
- 2026-10-14 — project owner (N-2): ขั้นตอนแยกใต้หน้า referrals ไม่ผูกกับ Shelter Master
- 2026-10-14 — project owner (N-4): ขาเข้าที่ตอบแล้วถูกปล่อยไว้ไม่แตะ
- 2026-10-14 — project owner: ใช้ worker (durable job) แทนการรันสดจาก browser เพื่อให้งานจบแน่นอนโดยไม่มีผู้ใช้ต้องรอหน้าจอ
- 2026-10-14 — project owner: โมเดลงานเป็น job doc เดียว + cursor ไม่ใช้ doc ต่อรายการ (ทางเลือกแบบ CR-123 ถูกปฏิเสธเพราะ CR-126 พบแรงกดดันต่อ CouchDB เมื่อมี doc จำนวนมาก)
- 2026-10-14 — project owner: ตัวประมวลผลเป็น service ใหม่ `referral-worker` (Node, image เดียวกับ frontend) ไม่ใช้ Python sync worker และไม่พยุง `import-worker` เดิม ไม่ทำ generic runtime (CR-126 เลื่อนไว้)
- 2026-10-14 — project owner: ตอนแรกเลือกยกเลิก job ไม่ได้ รันจนจบ (ถูกแก้ด้วย N-6 ด้านล่าง ยกเลิกได้เฉพาะช่วงหน่วงก่อนเริ่ม)
- 2026-10-14 — project owner (N-5): ขณะ job active บล็อกการสร้าง referral ใหม่ของศูนย์นั้น (`409`) ไม่บล็อกศูนย์อื่นและขาเข้าจากศูนย์อื่น ขาเข้าที่เกิดระหว่างทำงานพึ่ง sweep (FR-J10)
- 2026-10-14 — project owner (N-6): ลดความเสี่ยงของ job ที่ยกเลิกไม่ได้ด้วยสองอย่างพร้อมกัน (1) ยืนยันด้วย search-select เลือกศูนย์ ค้นได้ทั้งชื่อและรหัส (2) หน่วงก่อนเริ่ม 60 วินาที ยกเลิกได้เฉพาะช่วงนั้น ปรับ FR-J9 จาก "ไม่มีการยกเลิก" เป็น "ยกเลิกได้เฉพาะช่วงหน่วง"
- 2026-10-14 — project owner: แยกเป็นสอง CR — ฉบับนี้ (stable) กับ [CR-167](CR-167-referral-withdraw-close-reason-bulk.md) (volatile)
- 2026-10-14 — proposed (ร่างโดย Claude): ยืม lease TTL 5 นาที, idle sleep 3 วินาที, backoff 5 วินาที, SIGTERM 30 วินาที, token + constant-time compare, retention 30 วัน จาก CR-123 และ pattern `import-worker`
- 2026-10-14 — proposed (ร่างโดย Claude): เพิ่ม FR-J7 (lock ต่อศูนย์), FR-P9 (sweep) และ FR-J5a (prop `includeClosed` เพราะ `shelter-combobox` เดิมกรองศูนย์ที่ปิดแล้วออก) ค่า 60 วินาทีของช่วงหน่วงเป็น proposed default
- 2026-10-14 — approved โดย project owner; รันเลข CR-168; ย้ายจาก `draft-referral-shelter-closure-worker.md` ชั้น stable ซึ่งนโยบายกำหนดให้ review ก่อน approve: owner เป็นผู้ approve โดยตรงหลังตัดสินใจรายข้อครบ (รวม N-5, N-6) ไม่มีผู้ review แยก; แก้ `schema.md`, `data-model.md`, `api-contract.md` ตาม CR นี้ (ยังไม่ implement โค้ด) และต้อง implement หลัง CR-167
