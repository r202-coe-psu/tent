---
id: CR-243
title: ปิดศูนย์ด้วย durable job — เช็คเอาต์คนในศูนย์ผ่าน shelter-close-worker แทนการทำใน request เดียว
status: approved
date: 2026-11-06
updated: 2026-11-10
requested_by: Dev Team B issue #1216 (ต่อยอด CR-219 / #986)
decided_by: kong
layer: stable
affects:
  - docs/data/schema.md (doc type ใหม่ `shelter_close_job` / `shelter_close_lock` ใน `central_ops`) · data-model.md
  - docs/data/api-contract.md (route ใหม่ + internal route + 202/409 ของ route ปิดศูนย์)
  - docs/changes/02-people/CR-219-shelter-close-checkout.md (FR-9, FR-14, FR-19, FR-22, FR-28..FR-31 — ไม่แก้ไฟล์ CR-219, ดู Change §3)
  - frontend/src/lib/server/shelter-close.ts (แยกเป็น step function) · shelter-close-job.ts (ใหม่)
  - frontend/src/routes/api/back-office/shelter/[code]/close/** · close/jobs/[id]/** (ใหม่)
  - frontend/src/routes/api/back-office/shelter/[code]/+server.ts (PATCH บล็อกขณะ job active)
  - frontend/src/routes/api/internal/shelter-close/worker/next/** (ใหม่)
  - frontend/server/shelter-close-worker.mjs (ใหม่) · frontend/package.json
  - frontend/src/lib/features/shelters/ui/shelter-close-dialog.svelte · shelter-form-page.svelte
  - frontend/scripts/migrate-closed-shelter-checkout.ts
  - docker-compose.yml · .staging.yml · .staging.no-nginx.yml · .production.yml · .production.no-nginx.yml · .env.example · frontend/.env.example · nginx/nginx.conf
  - schema_v: doc type ใหม่ 2 ชนิดเริ่มที่ 1 · ไม่ bump type อื่น · ไม่เพิ่มค่าใน enum `operation_status`
---

# ปิดศูนย์ด้วย durable job (`shelter-close-worker`)

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** งานเช็คเอาต์/ยกเลิกคนตอนปิดศูนย์ (CR-219) ย้ายจากการทำใน HTTP request เดียว ไปเป็น
>   **durable job** ที่ Node worker ใหม่ `shelter-close-worker` ประมวลผลทีละ chunk บน server
> - **เพื่อใคร/ทำไม:** ศูนย์ที่มีคนเยอะต้องปิดจบได้เสมอ แม้ผู้ใช้ปิดแท็บ, proxy timeout หรือ server restart กลางทาง
> - **dev ต้อง build:** job doc + lock ใน `central_ops`, internal route ที่ใช้ token (1 chunk ต่อ call),
>   worker poll พร้อม lease, `POST close` → `202 { job_id }`, route สถานะ job, UI progress + banner,
>   backfill ผ่าน job, compose service + nginx deny
> - **กระทบ:** stable core — doc type ใหม่ 2 ชนิด (schema_v 1), internal route, service ใหม่ ·
>   แก้ CR-219 FR-9/14/19/22/28..31 ผ่าน CR นี้ · ไม่เพิ่มสถานะศูนย์ใหม่ · logic domain การเช็คเอาต์ไม่เปลี่ยน

---

## Why

`POST /api/back-office/shelter/[code]/close` เรียก `closeShelterPeople()` แบบ synchronous ใน request เดียว
(วนทุก chunk ≤200 docs → evacuee → movement → audit → household → derive household ทั้งศูนย์ FR-12a →
re-count → เขียน registry `closed`) ศูนย์ใหญ่ใช้เวลานาน จึงเสี่ยง proxy/route timeout, ผู้ใช้ปิดแท็บ หรือ
server restart กลางทาง ผลคืองานค้างครึ่งทางและผู้ใช้ไม่รู้ผล ต้องกดซ้ำเอง FR-12 (idempotent) และ FR-12a
(ซ่อม household) ทำให้กดซ้ำแล้วถูกต้อง แต่ไม่มีกลไกใดรับประกันว่างานจะ "จบ" โดยไม่มีคนเฝ้า
script backfill `migrate-closed-shelter-checkout.ts` เรียก service เดียวกันแบบ synchronous จึงมีปัญหาเดียวกัน

แนวทางตาม pattern เดิมของ `shelter-import-worker` (CR-123 / CR-126) และ CR-168: job doc ใน CouchDB +
internal route ที่ใช้ token + Node worker poll พร้อม lease

## Change

### 1. Requirements

**Job และ lock**

- **FR-1** — เพิ่ม doc type `shelter_close_job` (`_id = shelter_close_job:<ulid>`, schema_v 1) ใน DB `central_ops`
  ตามตาราง field ด้านล่าง และเพิ่ม view `jobs_claimable` (design doc `_design/shelter_close`) เป็น index ให้ worker
  - emit key `[status, lease_until ?? created_at]` เฉพาะ doc ที่ `type = shelter_close_job` และ `status` เป็น `queued` หรือ `running`
  - worker หางานด้วย key range: `["queued"]`..`["queued", {}]` (เรียงตามเวลาสร้าง) และ `["running"]`..`["running", <now>]` (lease หมดแล้ว)
  - ห้าม scan ทั้ง DB `central_ops` เพื่อหา job
- **FR-2** — เพิ่ม doc type `shelter_close_lock` (`_id = shelter_close_lock:<code>`, schema_v 1) ใน `central_ops`
  job ที่ `status` เป็น `queued` หรือ `running` ได้ไม่เกิน 1 ต่อศูนย์ สร้าง lock ด้วย CAS (`_rev`)
- **FR-3** — ปล่อย lock เมื่อ job เป็น terminal (`completed` / `completed_with_errors`)
- **FR-3a** — route ที่อ่าน lock (FR-5, FR-6, FR-9) ต้องตรวจ job ที่ lock ชี้ก่อน: job terminal หรือหาไม่พบ →
  ลบ lock (CAS) แล้วทำต่อตามปกติ · job active แต่ `updated_at` เก่ากว่า `SHELTER_CLOSE_STALE_MS` → ตั้ง job เป็น
  `completed_with_errors` (`end_reason = stale`) แล้วปล่อย lock (ครอบคลุม worker ไม่ได้รัน และ crash ระหว่างจบ job กับลบ lock)
  การตั้งสถานะนี้ต้อง CAS ด้วย `_rev` ของ job ที่อ่านมา ถ้า `_rev` เปลี่ยนแล้ว (แปลว่า worker ยังทำงานอยู่) ให้ยกเลิกการปิด
- **FR-4** — ห้ามเก็บ job หรือ lock ใน DB `shelter_<code>`

**Route ฝั่งผู้ใช้**

- **FR-5** — `GET /api/back-office/shelter/[code]/close` คืน preview เดิม (CR-219 FR-7) และเพิ่ม `active_job`
  ถ้ามี job active
- **FR-6** — `POST /api/back-office/shelter/[code]/close` ตรวจสิทธิ์ (`requireShelterManagerOrSA`) และ
  `confirm_text` (CR-219 FR-8) เหมือนเดิม แล้วสร้าง job + lock และตอบ `202 { job_id }` ภายใน request budget
  โดยไม่ประมวลผลคนในศูนย์ใน request นี้
- **FR-7** — มี job active อยู่แล้ว → `409 { job_id }` ของ job เดิม ห้ามสร้าง job ที่สอง
- **FR-8** — `GET /api/back-office/shelter/[code]/close/jobs/[id]` คืนสถานะ / ความคืบหน้า (`phase`, `counters`,
  `sweep_round`) / `failures[]` ใช้สิทธิ์เดียวกับ FR-6 · `job.shelter_code` ไม่ตรง `[code]` → `404` (ไม่ใช่ `403`
  เพื่อไม่บอกว่ามี job นั้นอยู่) · ตอบ `Cache-Control: no-store`
- **FR-9** — `PATCH /api/back-office/shelter/[code]` ขณะมี job active ห้ามเปลี่ยน `operation_status` (รวมเปิดศูนย์
  กลับจาก `closed`) → `409` การตั้ง `closed` ตรง ๆ ยัง `400` ตาม CR-219 FR-22 เดิม
- **FR-10** — `requested_by` ของ job มาจาก session ฝั่ง server เท่านั้น ห้ามรับจาก body · ยกเว้น job
  `mode = backfill` (FR-31) ที่ตั้ง `requested_by = BACKFILL_CREATED_BY` (ค่าเดิมของ script)
- **FR-10a** — worker ส่ง `job.requested_by` เป็น `createdBy` ของ step function ทุก chunk (movement / audit
  ที่ worker เขียนจึงระบุผู้สั่งปิดศูนย์) · ตรวจสิทธิ์ครั้งเดียวตอนสร้าง job (FR-6) worker ไม่ตรวจ role ซ้ำ

**Internal route และ worker**

- **FR-11** — `POST /api/internal/shelter-close/worker/next` ใช้ `Authorization: Bearer
$SHELTER_CLOSE_WORKER_TOKEN` ไม่มี/ผิด token → `401` ไม่มีงาน → `204`
- **FR-12** — 1 call = claim หรือต่อ lease → ประมวลผล **1 chunk** → บันทึก `cursor` / `counters` ลง job doc → คืน
  ภายใน `SHELTER_CLOSE_CHUNK_BUDGET_MS` (หมดเวลาแล้วเก็บ cursor แล้วคืน ไม่ทำต่อ) · ทุกการบันทึก chunk อัปเดต `updated_at` ของ job ด้วย (FR-3a ใช้ตรวจว่า worker ยังทำงานอยู่)
- **FR-13** — ต่อ lease **ก่อน** เขียน cursor · ถ้าเขียน cursor ได้ `409` ให้อ่าน job ใหม่: ถ้า job เป็น terminal หรือ lease เป็นของ worker อื่นแล้ว → หยุดทันที ไม่เขียนทับและไม่ทำ chunk ต่อ
- **FR-14** — lease หมด (หาจาก view `jobs_claimable`, FR-1) → worker ตัวใดก็ได้รับต่อจาก `cursor` เพิ่ม `attempt` ได้ไม่เกิน
  `SHELTER_CLOSE_MAX_ATTEMPTS` เกินแล้ว job จบเป็น `completed_with_errors`
- **FR-15** — `frontend/server/shelter-close-worker.mjs` (`pnpm shelter-close-worker`) poll internal route ทุก
  `SHELTER_CLOSE_WORKER_POLL_MS` ตอนไม่มีงาน
- **FR-16** — worker ตรวจ `CHUNK_BUDGET_MS < TIMEOUT_MS < LEASE_MS < STALE_MS` ตอนเริ่ม ตั้งผิดลำดับ → ล้มพร้อมข้อความระบุ
  ตัวแปรที่ผิด

**Phase ของ job** (ลำดับ `people → households → sweep → finalize → done`)

- **FR-17** — `people`: chunk ตาม `chunkByHousehold` (≤200) ลำดับ evacuee → movement → audit → household ตาม
  CR-219 FR-10, retry 409 ตาม FR-11, rollback movement เดิม
- **FR-18** — `households`: ซ่อม household ที่ derive ไม่ตรง (CR-219 FR-12a) ทีละ chunk
- **FR-19** — `sweep`: re-count (CR-219 FR-7) > 0 → กลับไป `people` และ `sweep_round + 1` สูงสุด **3 รอบ**
  (จับคนที่เช็คอิน/ลงทะเบียนระหว่าง job เพราะ client เขียน CouchDB ตรง server บล็อกไม่ได้)
  · ถ้า re-count ยัง > 0 หลังครบ 3 รอบ (`sweep_round = 3`) → ไม่กลับไป `people` อีก job จบเป็น `completed_with_errors`
  ด้วย `end_reason = sweep_exhausted` และศูนย์ไม่ถูกปิด (FR-22)
- **FR-20** — `finalize` โหมด `close`: re-count = 0 และ `counters.failed = 0` → เขียน registry
  `operation_status = closed` + `closed_at` (ข้ามถ้าปิดอยู่แล้ว) registry เขียนครั้งเดียวที่ phase นี้เท่านั้น
- **FR-21** — `finalize` โหมด `backfill`: ไม่แตะ registry (CR-219 FR-29) เขียน audit ต่อศูนย์ตาม CR-219 FR-30a
- **FR-22** — สถานะสุดท้าย: `completed` เมื่อ FR-20 สำเร็จ (หรือ backfill ไม่มี failed) · มิฉะนั้น
  `completed_with_errors` และศูนย์ไม่ถูกปิด · กดปิดซ้ำ = job ใหม่ (CR-219 FR-13) · ตั้ง `end_reason` ตามตาราง §2 ทุกครั้งที่ job จบ
- **FR-23** — ทุกการเปลี่ยนสถานะผ่าน domain เดิม (`buildShelterCloseCheckout`, `buildShelterCloseCancel`,
  `deriveShelterCloseHousehold`) ห้าม set `current_stay.status` ตรง
- **FR-24** — failed รายคนเก็บใน `failures[]` สูงสุด `SHELTER_CLOSE_MAX_FAILURES`; เกินแล้วนับใน
  `counters.failed` อย่างเดียว
- **FR-25** — ไม่เพิ่มค่าใน enum `operation_status` (ไม่มี `closing`) สถานะศูนย์คงเดิมจน job จบ
- **FR-26** — refactor `closeShelterPeople` เป็น step function ที่รับ cursor และคืน state ใช้ร่วมกันทั้ง worker
  และ `--dry-run` โดย logic domain ไม่เปลี่ยน (test เดิมของ `shelter-close.test.ts` ต้องยังผ่าน)

**UI**

- **FR-27** — หลังยืนยัน `shelter-close-dialog.svelte` แสดง progress (เช็คเอาต์ X / Y · ยกเลิก Z · ล้มเหลว W) โดย
  poll job ผู้ใช้ปิด modal ได้ระหว่างทำงาน
- **FR-28** — `shelter-form-page.svelte` แสดง banner "กำลังปิดศูนย์…" ขณะมี job active (เปิดหน้าใหม่ก็เห็น) และ
  ซ่อน/disable ตัวเลือกเปลี่ยนสถานะศูนย์
- **FR-29** — job จบแล้ว toast ตาม `end_reason`:
  - `ok` → "ปิดศูนย์แล้ว · เช็คเอาต์ X คน · ยกเลิก Y คน"
  - `failed` → "ล้มเหลว Z คน — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อทำต่อ" (แสดงเมื่อ `counters.failed > 0` เท่านั้น)
  - `stale` → "งานปิดศูนย์หยุดไปนาน — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อเริ่มใหม่"
  - `sweep_exhausted` → "ยังมีคนค้างหลังตรวจครบ 3 รอบ — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อทำต่อ"
  - `attempts_exhausted` → "งานถูกรับต่อเกินจำนวนที่กำหนด — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อเริ่มใหม่"
- **FR-30** — ไม่มีปุ่มยกเลิก job (ยืนยันด้วยการพิมพ์รหัส+ชื่อแล้ว และเช็คเอาต์ย้อนไม่ได้)

**Backfill**

- **FR-31** — `migrate-closed-shelter-checkout.ts --write` สร้าง job `mode = backfill` ต่อศูนย์ที่
  `operation_status = closed` (ข้ามศูนย์ที่มี job active) แล้วพิมพ์ `job_id` โดยไม่รอจน job จบ
- **FR-32** — `--dry-run` นับแบบ synchronous ผ่าน step function (FR-26) และไม่เขียนอะไร (CR-219 FR-31a)
- **FR-33** — `--shelter <code>` และการรันซ้ำได้ตาม CR-219 FR-31 คงเดิม

**Infra**

- **FR-34** — compose 5 ไฟล์ที่มี `import-worker` (`docker-compose.yml`, `.staging.yml`,
  `.staging.no-nginx.yml`, `.production.yml`, `.production.no-nginx.yml`) เพิ่ม service `shelter-close-worker`
  แบบเดียวกับ `import-worker` ไฟล์ `edge` / `seed` ไม่มี import-worker จึงไม่เพิ่ม
- **FR-35** — compose ใช้ `${SHELTER_CLOSE_WORKER_TOKEN:?... is required}`
- **FR-36** — `.env.example` (root) และ `frontend/.env.example` เพิ่มตัวแปรตามตาราง Env; token ต้องตรงกันทั้งสองไฟล์
  (เหมือน `SHELTER_IMPORT_WORKER_TOKEN`)
- **FR-37** — `nginx/nginx.conf` เพิ่ม location deny `/api/internal/shelter-close/worker/` จาก public listener
  แบบเดียวกับ `/api/internal/shelter-import/worker/`
- **FR-38** — `frontend/package.json` เพิ่ม script `shelter-close-worker` → `node server/shelter-close-worker.mjs`

### 2. `shelter_close_job:<ulid>` (central_ops · schema_v 1)

| field                         | ชนิด                                                             | req/opt | หมายเหตุ                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `type`                        | `'shelter_close_job'`                                            | req     |                                                                                                                 |
| `schema_v`                    | `1`                                                              | req     |                                                                                                                 |
| `job_ulid`                    | str                                                              | req     |                                                                                                                 |
| `shelter_code`                | str                                                              | req     |                                                                                                                 |
| `mode`                        | `'close' \| 'backfill'`                                          | req     |                                                                                                                 |
| `requested_by`                | str                                                              | req     | จาก session ฝั่ง server (FR-10)                                                                                 |
| `status`                      | `queued \| running \| completed \| completed_with_errors`        | req     |                                                                                                                 |
| `phase`                       | `people \| households \| sweep \| finalize \| done`              | req     |                                                                                                                 |
| `cursor`                      | object                                                           | req     | ตำแหน่งต่อใน phase ปัจจุบัน                                                                                     |
| `sweep_round`                 | int (0..3)                                                       | req     |                                                                                                                 |
| `counters`                    | `{ checked_out, cancelled, households_repaired, failed }` (int)  | req     |                                                                                                                 |
| `preview`                     | object                                                           | req     | snapshot ของ CR-219 FR-7 ตอนสั่ง                                                                                |
| `failures`                    | `[{ evacuee_id, error }]`                                        | req     | จำกัดขนาดตาม FR-24                                                                                              |
| `lease_owner` / `lease_until` | str / ISO                                                        | opt     |                                                                                                                 |
| `attempt`                     | int                                                              | req     |                                                                                                                 |
| `created_at` / `updated_at`   | ISO                                                              | req     |                                                                                                                 |
| `started_at` / `finished_at`  | ISO                                                              | opt     |                                                                                                                 |
| `closed`                      | bool                                                             | req     | registry ถูกปิดโดย job นี้หรือไม่                                                                               |
| `end_reason`                  | `ok \| failed \| stale \| sweep_exhausted \| attempts_exhausted` | opt     | ตั้งเมื่อ job จบเท่านั้น ถ้ามีหลายสาเหตุ ใช้ลำดับ `stale` > `attempts_exhausted` > `sweep_exhausted` > `failed` |

`shelter_close_lock:<code>`: `type`, `schema_v` (1), `shelter_code`, `job_id` (`_id` เต็มของ job ที่ถือ lock),
`created_at` · เก็บใน `central_ops`

### 3. ผลต่อข้อใน CR-219 (บันทึกที่นี่ ไม่แก้ไฟล์ CR-219)

| CR-219                                                                | ก่อน                                                  | หลัง (CR นี้)                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| FR-9                                                                  | ทำใน server ภายใน request                             | ทำใน `shelter-close-worker` ผ่าน internal route (FR-11..FR-14)                    |
| FR-14                                                                 | response `{ closed, checked_out, cancelled, failed }` | `202 { job_id }` · ผลอ่านจาก job status (FR-6, FR-8)                              |
| FR-19                                                                 | loading, ปิด modal ไม่ได้, toast ท้ายสุด              | progress poll job, ปิด modal ได้, banner, toast ท้ายสุด (FR-27..FR-29)            |
| FR-22                                                                 | PATCH ตั้ง `closed` → `400`                           | คงเดิม + PATCH เปลี่ยน `operation_status` ขณะ job active → `409` (FR-9)           |
| FR-28..FR-31                                                          | script ประมวลผล synchronous                           | `--write` สร้าง job `mode = backfill`; `--dry-run` ยัง synchronous (FR-31..FR-33) |
| FR-7, FR-8, FR-10..FR-13, FR-12a, FR-15..FR-18, FR-29, FR-30a, FR-31a | —                                                     | **ไม่เปลี่ยน** (ใช้ซ้ำใน worker)                                                  |

### 4. Env (ทุกตัว override ได้ · test ใช้ค่าเล็กผ่าน fake clock)

| ตัวแปร                            | default                            | ใช้ทำอะไร                                                                                              |
| --------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `SHELTER_CLOSE_WORKER_TOKEN`      | บังคับ ไม่มี default               | Bearer token ของ internal route                                                                        |
| `SHELTER_CLOSE_WORKER_URL`        | `http://host.docker.internal:5173` | ที่อยู่ frontend ที่ worker เรียก                                                                      |
| `SHELTER_CLOSE_WORKER_POLL_MS`    | `2000`                             | ช่วง poll ตอนไม่มีงาน                                                                                  |
| `SHELTER_CLOSE_WORKER_TIMEOUT_MS` | `30000`                            | timeout ฝั่ง worker ต่อ request                                                                        |
| `SHELTER_CLOSE_CHUNK_BUDGET_MS`   | `20000`                            | เวลาสูงสุดต่อ 1 chunk ใน route                                                                         |
| `SHELTER_CLOSE_LEASE_MS`          | `60000`                            | อายุ lease                                                                                             |
| `SHELTER_CLOSE_MAX_ATTEMPTS`      | `5`                                | จำนวนครั้งสูงสุดที่ job ถูกรับต่อ                                                                      |
| `SHELTER_CLOSE_MAX_FAILURES`      | `50`                               | เพดานรายการใน `failures[]`                                                                             |
| `SHELTER_CLOSE_STALE_MS`          | `600000`                           | job active ที่ `updated_at` ไม่ขยับนานกว่านี้ถือว่าค้าง (FR-3a) · ต้องมากกว่า `SHELTER_CLOSE_LEASE_MS` |

ค่า default เป็นการประมาณ ปรับหลัง load test (AC-11)

## Acceptance

- [ ] **AC-1** กดยืนยันปิดศูนย์ → ได้ `job_id` ทันที (ไม่รอประมวลผล) และ modal แสดงความคืบหน้า (FR-6, FR-27)
- [ ] **AC-2** ปิดแท็บ / refresh ระหว่างทำงาน → job ทำต่อจนจบ; เปิดหน้าศูนย์ใหม่เห็น banner และผลเมื่อเสร็จ (FR-28, FR-29)
- [ ] **AC-3** กดปิดศูนย์ซ้ำขณะ job active → `409` พร้อม `job_id` เดิม ไม่มี job ที่สอง (FR-2, FR-7)
- [ ] **AC-4** PATCH เปลี่ยน `operation_status` (รวมเปิดศูนย์กลับ) ขณะ job active → `409` (FR-9)
- [ ] **AC-5** kill worker กลาง job → lease หมดแล้ว worker รับต่อจาก cursor; ผลสุดท้ายไม่มี movement ซ้ำ และ household ถูกต้อง (FR-14, FR-17, FR-18)
- [ ] **AC-6** เช็คอินคนใหม่ระหว่าง job → sweep จับได้ภายใน 3 รอบ; เกินแล้วยังเหลือ → `completed_with_errors` ศูนย์ไม่ปิด (FR-19, FR-22)
- [ ] **AC-7** มี failed → `completed_with_errors`, ศูนย์ไม่ปิด, กดปิดอีกครั้งสร้าง job ใหม่ที่ทำต่อได้ถูกต้อง (FR-20, FR-22)
- [ ] **AC-8** backfill `--write` สร้าง job `mode = backfill` → ไม่แตะ `operation_status` / `closed_at` และมี audit ต่อศูนย์ (FR-21, FR-31); `--dry-run` ไม่เขียนอะไร (FR-32)
- [ ] **AC-9** `/api/internal/shelter-close/` เข้าจาก public listener ไม่ได้; ไม่มี token → `401` (FR-11, FR-37)
- [ ] **AC-10** compose ทุกไฟล์ใน FR-34 มี service `shelter-close-worker` และ env ครบใน `.env.example` ทั้งสองไฟล์ (FR-34..FR-36); worker ล้มพร้อมข้อความชัดเจนเมื่อ env ผิดลำดับ (FR-16)
- [ ] **AC-11** ศูนย์ ~5,000 คนปิดสำเร็จ (load test: `pnpm seed:master` + `pnpm seed:bulk-evacuees --shelter=SH001 --count=5000`) โดยไม่มี request ใดเกิน budget ของ route · ต้องตรวจสัดส่วนสถานะที่ `people-builder` สร้างก่อนนับ "5,000 คน" (บางคนถูกโอนย้าย)
- [ ] **AC-12** Tests ครบ: job store (CAS lock, lease, claim ผ่าน view `jobs_claimable`, lock ค้างตาม FR-3a) · step function (phase, cursor, sweep, finalize 2 mode, resume, `failures[]`, `createdBy` จาก `requested_by`) · close route (`202` / `409`) · job status route (รวม `404` เมื่อ job เป็นของศูนย์อื่น) · internal route (token, chunk, cursor) · PATCH block · backfill script · ingress/config · UI component · e2e ปิดศูนย์ผ่าน worker
- [ ] **AC-13** lock ชี้ job ที่จบแล้วหรือไม่มีอยู่ → กดปิดศูนย์ได้ `202` · ไม่มี worker รันเกิน `SHELTER_CLOSE_STALE_MS` → job เป็น `completed_with_errors` และเปลี่ยนสถานะศูนย์ได้ (FR-3a) · ถ้า worker ยังทำงานอยู่ (`_rev` ของ job เปลี่ยน) การปิดต้องไม่สำเร็จ และ worker หยุดเมื่อได้ `409` (FR-3a, FR-13)
- [ ] **AC-14** SM ของศูนย์ A ขอ `close/jobs/[id]` ของ job ศูนย์ B ผ่าน path ศูนย์ A → `404` (FR-8)
- [ ] **AC-15** movement / audit ที่ worker เขียนมีผู้เขียนเป็น `requested_by` ของ job · job backfill ใช้ `BACKFILL_CREATED_BY` (FR-10, FR-10a)

## Impact

- **Stable core:** doc type ใหม่ `shelter_close_job` / `shelter_close_lock` (schema.md, data-model.md), service ใหม่,
  internal route (api-contract.md) → ต้อง review ก่อน approve
- **Code / infra:** ดู `affects`
- **Role / permission:** ไม่เปลี่ยน — SA และ shelter manager ของศูนย์นั้นยังปิดศูนย์ได้ (CR-219 FR-22/FR-23)
- **Public plane:** ไม่ต้องแก้ worker Python — CR-183 FR-10 sync สถานะคนในศูนย์ที่ปิดเข้า `public_persons` อยู่แล้ว (CR-219 FR-24)
- **Operational:** ระหว่างมี job active ศูนย์ยังไม่ `closed` และเปลี่ยนสถานะไม่ได้ (FR-9); ผู้ใช้ยกเลิก job ไม่ได้ (FR-30)
- **Test seam:** fake CouchDB ใหม่สำหรับ job store / step function (in-memory, มี `_rev` + 409 จริง, รับชื่อ db ได้ เพื่อรองรับ `central_ops` และ `shelter_<code>`) ไม่แก้ `FakeCouch` เดิมและไม่ใช้ `createInMemoryCouch`

## Migration

- doc type ใหม่ 2 ชนิดเริ่ม schema_v 1 ไม่มี doc เดิมให้ migrate; ไม่ bump schema_v ของ type อื่น
- ลำดับ deploy: เพิ่ม env + compose service + nginx deny → deploy frontend (route + internal route) → เริ่ม `shelter-close-worker`
- ศูนย์ที่ปิดไปแล้วและยังมีคนค้าง: รัน `migrate:closed-shelter-checkout --write` ตาม FR-31 หลัง deploy แล้วตรวจ `job_id` ที่พิมพ์
- job ที่ค้างจาก deploy ก่อนหน้า: ไม่มี (โค้ดเดิมไม่สร้าง job)

## Decision log

- 2026-11-06 — proposed (draft) จาก issue #1216 (D-9 ใน issue: ทำ CR ตอนเริ่ม implement)
- 2026-11-10 — แก้ตาม review PR #1217: เพิ่ม FR-3a (เคลียร์ lock ค้าง + `SHELTER_CLOSE_STALE_MS`), FR-8 ผูก job
  กับศูนย์ใน path (`404`), FR-10 / FR-10a (`requested_by` ของ backfill และ `createdBy` ของ worker), AC-13..AC-15
- 2026-11-10 — approved โดย kong เป็น CR-243 (track ด้วยไฟล์ CR · stable-core review ผ่าน)
- 2026-11-10 — แก้ตาม review รอบ 2 (PR #1217, ข้อ 1–4): FR-3a CAS ด้วย `_rev` · FR-12 / FR-13 ทุก chunk bump `updated_at`
  และหยุดเมื่อได้ `409` · `end_reason` (§2) + FR-29 toast ตามสาเหตุ · view `jobs_claimable` (FR-1, FR-14, D-5) ·
  FR-16 ตรวจ `STALE_MS` · AC-12..AC-13 · ไม่มี decision ใหม่ด้าน scope
- 2026-11-10 — แก้ตาม review รอบ 2 ข้อ 5: FR-19 ระบุพฤติกรรมเมื่อ sweep ครบ 3 รอบแล้วยังเหลือคน (`sweep_exhausted`)

### ตัดสินแล้วใน #1216

| #    | เรื่อง                    | ตัดสิน                                                                                                | ตัดทิ้ง                                                                                                  |
| ---- | ------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| D-1  | ใครรัน                    | Node worker ใหม่ เรียก internal route ที่ใช้ `closeShelterPeople` / people domain เดิม → FR-11..FR-16 | Python sync-worker (ต้องเขียน domain logic ซ้ำ → คลาดกัน, เหตุผลเดียวกับ CR-168) · รวมเข้า import-worker |
| D-2  | สถานะศูนย์ระหว่างทำงาน    | ไม่เพิ่มสถานะ; sweep สูงสุด 3 รอบ → FR-19, FR-25                                                      | เพิ่ม `closing` ใน enum (กระทบ projection / public search / ทุกจุดที่อ่าน `operation_status`)            |
| D-3  | UX                        | `job_id` ทันที · progress · ปิด modal ได้ · banner · ยกเลิกไม่ได้ → FR-6, FR-27..FR-30                | หน่วง 60 วิ + ยกเลิกได้ (CR-168) · toast อย่างเดียว                                                      |
| D-4  | งานต่อการเรียก            | 1 chunk ต่อ call → FR-12                                                                              | ทำทั้งศูนย์ใน call เดียว (แค่ย้าย timeout)                                                               |
| D-5  | ที่เก็บ job               | `central_ops` + lock CAS ด้วย `_rev` + view `jobs_claimable` (index) → FR-1..FR-4, FR-14              | เก็บใน `shelter_<code>` · scan ทั้ง `central_ops` ทุกรอบ (ช้าเมื่อ job สะสม)                             |
| D-6  | ล้มกลางทาง                | lease หมดรับต่อ, `attempt` จำกัด, `failures[]` จำกัด, ไม่ปิดศูนย์ถ้ามี failed → FR-14, FR-22, FR-24   | หยุดรอผู้ใช้ทันทีเมื่อล้ม                                                                                |
| D-7  | Backfill                  | `mode` + script สร้าง job + `--dry-run` synchronous → FR-31..FR-33                                    | script รอจนจบทุก job                                                                                     |
| D-8  | Infra                     | compose service แยกทุกไฟล์ + env + nginx deny → FR-34..FR-38                                          | ใช้ container import-worker ร่วม                                                                         |
| D-9  | Tracking                  | CR ตอนเริ่ม implement; แก้ CR-219 ผ่าน CR นี้ ไม่แก้ไฟล์ CR-219                                       | —                                                                                                        |
| D-10 | ค่า budget/lease/failures | เป็น env ตามตาราง Env                                                                                 | hardcode                                                                                                 |
| D-11 | Test seam                 | fake CouchDB ใหม่ · S-10 (load ~5,000) อยู่ใน scope                                                   | แก้ `FakeCouch` เดิม                                                                                     |

### ตัดสินตอน approve (kong, 2026-11-10)

- วิธี track: ไฟล์ CR นี้ (CR-243)
- stable-core review (doc type ใหม่ + internal route + service ใหม่): ผ่าน
