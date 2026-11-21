---
id: draft
title: รวม worker เบ็ดเตล็ด 4 ตัวเป็น container เดียว `jobs-worker` (แก้ส่วน runtime/compose ของ CR-222, CR-243, CR-247 และ import worker ของ CR-123/126)
status: proposed # รอ owner อนุมัติ — ยังไม่เริ่มโค้ด (change-management §2: service/compose/runtime = stable core)
date: 2026-11-21
requested_by: "#1479 (grill 2026-11-19)"
decided_by: รอ project owner (ช่องทางบันทึก = CR ไฟล์นี้ ตามที่ #1479 ระบุ)
layer: stable
related:
  - docs/changes/14-kiosk/CR-222-station-print-server.md (FR-17/FR-17a — print housekeeping)
  - docs/changes/02-people/CR-243-shelter-close-worker.md (FR-34/FR-35, §4 — service `shelter-close-worker`, `SHELTER_CLOSE_WORKER_POLL_MS`)
  - docs/changes/01-core/CR-247-edge-per-shelter-repl-user.md (FR-11 — service `edge-users-copy`)
  - docs/changes/00-baseline/CR-123-shelter-import-worker-pipeline.md · CR-126-shelter-import-couchdb-scalability.md (service `import-worker`)
affects:
  - docker-compose.yml · .staging.yml · .staging.no-nginx.yml · .production.yml · .production.no-nginx.yml (ลบ service `edge-users-copy`, `import-worker`, `shelter-close-worker` + env print housekeeping ของ `sync-worker`; เพิ่ม service `jobs-worker` 1 ตัว)
  - .env.example · frontend/.env.example (เพิ่ม `JOBS_*`, ลบ `SHELTER_CLOSE_WORKER_POLL_MS`)
  - worker/src/worker/jobs/ (ใหม่) · worker/pyproject.toml (entry point `jobs-worker`; ถอด `edge-users-copy`) · worker/src/worker/main.py (ถอด print housekeeping task)
  - frontend/server/shelter-import-worker.mjs · shelter-close-worker.mjs (ลบ) · frontend/package.json (ลบ script `import-worker`, `shelter-close-worker`)
  - docs/couchdb-replication/{README,SETUP-CENTRAL,SETUP-EDGE}.md · scripts/{central-repl-user,edge-init,edge-users-clean}.sh · scripts/tests/{central-repl-user,edge-repl-e2e}.test.sh (ชื่อ service/container/คำสั่ง)
  - ไม่แก้ไฟล์ CR-222 / CR-243 / CR-247 / CR-123 / CR-126 (CR นี้ทับเฉพาะส่วน runtime — ดู Change §3)
  - ไม่แก้ schema_v · ไม่แก้ doc shape · ไม่แก้ internal route/contract ของ import, close, printing housekeeping · ไม่แก้ `sync-worker` (CouchDB → Mongo)
why: ลดจำนวน container ต่อ environment — worker เบ็ดเตล็ด 4 ตัวแยก container กันทั้งที่งานเบา (poll route ภายใน / `_changes` drain)
---

# รวม worker เบ็ดเตล็ดเป็น `jobs-worker` เดียว

> **สรุป (TL;DR):**
>
> - **เปลี่ยน:** รวม 4 งาน — print housekeeping · `edge-users-copy` · import ศูนย์ · close ศูนย์ — เป็น container เดียว `jobs-worker` (Python, **1 instance**, tick ทุก 30 วิ, รันตามลำดับ printing → edge-users-copy → import → close ใน 1 tick) แทน 3 service แยก + task ใน `sync-worker`
> - **ไม่รวม:** `sync-worker` (CouchDB → Mongo) คงแยก — เป็น critical path ของ public plane ห้ามให้งาน job มาบล็อก projection
> - **dev ต้อง build:** `worker/src/worker/jobs/` (loop + budget ต่อ job + healthcheck) · port import/close จาก `.mjs` เป็น Python httpx · `edge-users-copy` เปลี่ยนจาก long-poll เป็น `_changes feed=normal` drain ต่อ tick · compose 5 ไฟล์ · ลบ service/สคริปต์เดิมใน PR เดียวกัน
> - **ผลที่ต้องรับ:** import เริ่มช้าสุด ~30 วิ (เดิม 3 วิ) · user ใหม่ขึ้น edge ช้าสุด ~30 วิ (เดิมใกล้ real-time) · close เท่าเดิม
> - **layer: stable** (service/compose/runtime) · ไม่ bump `schema_v`

---

## Why

- ตอนนี้แต่ละ environment มี container เบ็ดเตล็ดแยกกัน 3 ตัว (`edge-users-copy`, `import-worker`, `shelter-close-worker`) + task print housekeeping ที่ฝังใน `sync-worker` (#1361) — งานทุกตัวเป็นงาน poll/drain เบา ๆ ที่ไม่ต้องการ process แยก
- Issue #1479 (grill 2026-11-19) ตกลงให้รวมเหลือ `jobs-worker` เดียว เพื่อลดจำนวน container ต่อ environment โดยคง `sync-worker` แยก
- งานเหล่านี้ถูกกำหนดเป็น service/container แยกใน CR เดิม 4 ฉบับ (ตารางด้านล่าง) จึงต้องมี CR กำกับการเปลี่ยน runtime (`docs/change-management.md` §2 — stable core)

## Change

### 1. สภาพปัจจุบัน → เป้าหมาย

| งาน              | CR ต้นทาง       | ตอนนี้                                                                            | หลังรวม (job ใน `jobs-worker`)                                     |
| ---------------- | --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| print housekeeping | CR-222 FR-17/17a | asyncio task ใน `sync-worker` POST `/api/internal/printers/housekeeping` ทุก 30 วิ | job `printing` — POST เดียวต่อ tick (ไม่มี budget) · OK file เดิม  |
| edge-users-copy  | CR-247 FR-11    | service Python แยก · long-poll `_changes` + refresh รายชื่อ DB ทุก 30 วิ           | job `edge-users-copy` — `_changes feed=normal` drain ต่อ tick       |
| import ศูนย์     | CR-123 / CR-126 | service `import-worker` (Node `shelter-import-worker.mjs`) poll route ภายในทุก 3 วิ | job `import-shelter` (Python httpx) poll route เดิมทุก tick         |
| close ศูนย์      | CR-243          | service `shelter-close-worker` (Node `.mjs`) poll 30 วิ · chunk budget 20 วิ · lease 60 วิ | job `shelter-close` (Python httpx) route เดิม · contract CR-243 เดิม |

### 2. กติกา runtime ของ `jobs-worker`

- **1 instance** ใน compose ทั้ง 5 ไฟล์ · ไม่เพิ่ม lock — กันซ้ำด้วย lease ของ import/close + `_rev` conflict ของ checkpoint `_local/edge_users_copy`
- **tick** `JOBS_TICK_SECONDS` (30) · ลำดับใน 1 tick: **printing → edge-users-copy → import → close** (เป็นลำดับรัน ไม่ใช่ลำดับ implement) · ถ้า tick เกิน 30 วิ รอบถัดไปเริ่มทันที ไม่ทับกัน
- **budget แยกต่อ job ผ่าน env:**

| job              | env                                       | ค่าเริ่มต้นชั่วคราว |
| ---------------- | ----------------------------------------- | ------------------- |
| printing         | — (1 POST ไม่มี budget)                   | —                   |
| edge-users-copy  | `JOBS_EDGE_USERS_COPY_BUDGET_SECONDS`     | 10                  |
| import-shelter   | `JOBS_IMPORT_BUDGET_SECONDS`              | 30                  |
| shelter-close    | `JOBS_CLOSE_BUDGET_SECONDS`               | 30                  |

  - งานค้าง (import / close / backfill) ทำต่อจนว่างหรือหมด budget แล้วส่งต่อ job ถัดไป · budget ตรวจ**ระหว่าง call** (ไม่ตัด call ที่กำลังทำ) — close มี chunk budget ฝั่ง server 20 วิต่อ call จึงอาจได้ 1 chunk ต่อ tick ถ้า chunk ใกล้เพดาน
  - ค่าข้างบนเป็นค่าเริ่มต้นชั่วคราว — ล็อกหลังวัดเวลาจริงต่อ chunk (close) และต่อ item (import) ด้วยศูนย์ขนาดใหญ่บน staging (ศูนย์ ~3,000 คน ≈ 15 chunk ≈ 7 นาที ถ้า 1 chunk ต่อ tick) แล้วแก้ค่าใน compose / `.env.example` + บันทึกใน Decision log
- **แยกความล้มเหลว:** แต่ละ job ห่อ try/except ของตัวเอง ล้มตัวหนึ่งไม่ล้มทั้ง tick · log ไม่มี token/body
- **healthcheck:** ใช้ `worker-healthcheck` เดิมของ image `worker/Dockerfile` · เขียน OK file แยกต่อ job หลัง tick สำเร็จ (204 / ว่างนับว่าสำเร็จ) · unhealthy เมื่อ job ใดเก่ากว่า `max(120 วิ, 4 × tick)` ตามกติกาเดิมของ housekeeping
- **env ที่ service ถือ (union ของที่ถูกแทน):** `COUCHDB_URL/USER/PASSWORD` (จาก `edge-users-copy`) · `PRINT_HOUSEKEEPING_URL/TOKEN` · `SHELTER_IMPORT_WORKER_URL/TOKEN` · `SHELTER_CLOSE_WORKER_URL/TOKEN` · `JOBS_TICK_SECONDS` · `JOBS_*_BUDGET_SECONDS` — **ชื่อ env token เดิมคงไว้ทั้งหมด** (ไม่ต้องหมุน/เปลี่ยน secret ที่ deploy แล้ว) · ไม่มี env MongoDB (MongoDB ล่มไม่กระทบ job เหล่านี้ ตามเจตนาเดิมของ CR-247)
- **ที่ต้องคงตามเดิม:** ไม่แก้ logic ฝั่ง SvelteKit ของ import/close (route ภายใน, lease, chunk budget ฝั่ง server) · checkpoint `_local/edge_users_copy`, backfill ครั้งละ 1 DB, `new_edits:false`, รูปแบบข้อมูล `edge_users_<code>` ตาม CR-247 · `PRINT_HOUSEKEEPING_TOKEN` / OK file / doc `print_housekeeping` ตาม CR-222

### 3. ส่วนของ CR เดิมที่ถูกทับ (CR เดิมไม่ถูกแก้ไฟล์ — ให้อ่านคู่กับ CR นี้)

| CR เดิม            | ส่วนที่ CR นี้ทับ                                                                                                                              | ส่วนที่ยังใช้ตามเดิม                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| CR-222             | FR-17: task `print-housekeeping` ใน `sync-worker` → job `printing` ของ `jobs-worker` (ช่วง = `JOBS_TICK_SECONDS` แทน `PRINT_HOUSEKEEPING_INTERVAL_MS`) · healthcheck/OK file ตามกติกาด้านบน | FR-17a (`last_run_at` / `last_error`), endpoint, token, retention                       |
| CR-243             | FR-34/FR-35 (service `shelter-close-worker`, compose, `healthcheck: disable`) · `SHELTER_CLOSE_WORKER_POLL_MS` (ลบ — ใช้ tick) · worker เป็น Node `.mjs` | internal route `…/shelter-close/worker/next`, lease, chunk budget, `SHELTER_CLOSE_WORKER_TOKEN`, FR อื่นทั้งหมด |
| CR-247             | FR-11: service `edge-users-copy` (container แยก, long-poll) → job ใน `jobs-worker` (`feed=normal` drain ต่อ tick; ผู้ใช้ใหม่ขึ้น edge ช้าสุด ~30 วิ) | checkpoint, backfill, `new_edits:false`, DB `edge_users_<code>`, `central-repl-user.sh --status` |
| CR-123 / CR-126    | service `import-worker` / worker Node `.mjs` poll 3 วิ → job `import-shelter` poll ทุก tick                                                  | pipeline, route ภายใน, token `SHELTER_IMPORT_WORKER_TOKEN`                              |

## Impact

- **compose:** ทั้ง 5 ไฟล์ — ลบ `edge-users-copy`, `import-worker`, `shelter-close-worker` และ env print housekeeping ใน `sync-worker` · เพิ่ม `jobs-worker` (`build: worker/Dockerfile`, `command: ["uv","run","--project","worker","jobs-worker"]`, `mem_limit: 256m`) · container ชื่อ `tent-jobs-worker-<env>` (dev: `jobs-worker`) แทน `tent-edge-users-copy-*` / `tent-import-worker-*` / `tent-shelter-close-worker-*`
- **ผู้ดูแล:** คำสั่ง `docker compose logs/up -d edge-users-copy` ใน `docs/couchdb-replication/*` เปลี่ยนเป็น `jobs-worker` · `.env` ที่ deploy แล้วไม่ต้องเพิ่มอะไร (ค่า `JOBS_*` มี default ใน compose) · `SHELTER_CLOSE_WORKER_POLL_MS` ที่ค้างใน `.env` ไม่มีผล
- **โค้ด/test:** port import/close เป็น Python + test · แก้ test ของ `edge_users_copy` · ลบ `.mjs` + script + test ที่อ้าง service เดิม (`frontend/src/lib/server/shelter-close-infra.test.ts`, `shelter-close-worker-script.test.ts`) · ถอด print housekeeping ออกจาก `worker/src/worker/main.py`
- **ขึ้นกับ:** PR #1403 (แก้ `worker/src/worker/cli/edge_users_copy.py` อยู่) — ควร merge ก่อน หรือ rebase ตามให้ทัน
- **ความเสี่ยง:** job หนึ่งใช้ budget เต็ม → job ท้ายแถวรอ tick ถัดไป · `jobs-worker` ตัวเดียว = จุดล้มเดียวของ 4 งาน (ลดผลด้วย restart policy + try/except ต่อ job + healthcheck)

## Migration

N/A (ไม่มี doc ที่ persist เปลี่ยนรูป · ไม่ bump `schema_v`) — ลำดับ cutover: deploy PR เดียวที่ลบ service เดิมและเพิ่ม `jobs-worker` พร้อมกัน (`docker compose up -d --remove-orphans`) · checkpoint `_local/edge_users_copy` และ job/lease ของ import/close ใน CouchDB ใช้ต่อได้ทันที · verify บน staging: ทดสอบ import, close ศูนย์ใหญ่, เพิ่ม user เข้า edge, housekeeping `.ok` / healthcheck

## Decision log

- 2026-11-19 — grill #1479: ตกลงรวม 4 งาน, `sync-worker` ไม่รวม, PR เดียว, budget แยกต่อ job ผ่าน env, cutover/ชื่อ token ตามข้างบน
- 2026-11-21 — proposed (ร่างจาก #1479 ข้อ 6–7) — **รอ project owner อนุมัติก่อนเริ่มโค้ด** · ตัวเลข budget เป็นค่าชั่วคราว รอวัดบน staging
