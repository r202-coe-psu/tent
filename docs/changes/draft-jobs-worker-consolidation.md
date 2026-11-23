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
> - **เปลี่ยน:** รวม 4 งาน — print housekeeping · `edge-users-copy` · import ศูนย์ · close ศูนย์ — เป็น container เดียว `jobs-worker` (Python, **1 instance**, **แต่ละ job มี loop + interval ของตัวเอง** ทำงานคู่ขนานกันใน process เดียว: printing 10 วิ · edge-users-copy 10 วิ · import 30 วิ · close 30 วิ) แทน 3 service แยก + task ใน `sync-worker`
> - **ไม่รวม:** `sync-worker` (CouchDB → Mongo) คงแยก — เป็น critical path ของ public plane ห้ามให้งาน job มาบล็อก projection
> - **dev ต้อง build:** `worker/src/worker/jobs/` (loop + interval + budget ต่อ job + healthcheck) · port import/close จาก `.mjs` เป็น Python httpx · `edge-users-copy` เปลี่ยนจาก long-poll เป็น `_changes feed=normal` drain ต่อรอบ · compose 5 ไฟล์ · ลบ service/สคริปต์เดิมใน PR เดียวกัน
> - **ผลที่ต้องรับ:** import เริ่มช้าสุด ~30 วิ (เดิม 3 วิ) · close เท่าเดิม (30 วิ) · user ใหม่ขึ้น edge ช้าสุด ~10–20 วิ (เดิมใกล้ real-time; วัดจริง p95 9.8 / max 10.3 วิ) · print housekeeping ทุก 10 วิ (เดิม 30 วิ) · import/close ที่ช้าหรือ call ค้างไม่บล็อก printing/edge เพราะแยก loop
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
| print housekeeping | CR-222 FR-17/17a | asyncio task ใน `sync-worker` POST `/api/internal/printers/housekeeping` ทุก 30 วิ | job `printing` — POST เดียวต่อรอบ (ไม่มี budget) ทุก 10 วิ · OK file เดิม  |
| edge-users-copy  | CR-247 FR-11    | service Python แยก · long-poll `_changes` + refresh รายชื่อ DB ทุก 30 วิ           | job `edge-users-copy` — `_changes feed=normal` drain ต่อรอบ ทุก 10 วิ |
| import ศูนย์     | CR-123 / CR-126 | service `import-worker` (Node `shelter-import-worker.mjs`) poll route ภายในทุก 3 วิ | job `import-shelter` (Python httpx) poll route เดิมทุก 30 วิ           |
| close ศูนย์      | CR-243          | service `shelter-close-worker` (Node `.mjs`) poll 30 วิ · chunk budget 20 วิ · lease 60 วิ | job `shelter-close` (Python httpx) route เดิมทุก 30 วิ · contract CR-243 เดิม |

### 2. กติกา runtime ของ `jobs-worker`

- **1 instance** ใน compose ทั้ง 5 ไฟล์ · ไม่เพิ่ม lock — กันซ้ำด้วย lease ของ import/close + `_rev` conflict ของ checkpoint `_local/edge_users_copy`
- **loop ต่อ job (ไม่ใช่ tick รวม):** แต่ละ job เป็น asyncio task ของตัวเอง ทำงานคู่ขนานกันใน process เดียว — job หนึ่งช้า/ค้างไม่บล็อกอีก job · **fixed-period ต่อ job** (นับจากเวลาเริ่มรอบ ไม่ใช่ sleep-หลังรอบ): ถ้ารอบหนึ่งเกิน interval รอบถัดไปของ job นั้นเริ่มทันที · ไม่ทับกันภายใน job เดียวกัน · `JOBS_TICK_SECONDS` (30) เป็นค่า interval เริ่มต้นสำหรับ job ที่ไม่ได้ตั้งของตัวเอง
- **interval + budget แยกต่อ job ผ่าน env:**

| job              | interval env                               | interval | budget env                            | budget |
| ---------------- | ------------------------------------------ | -------- | ------------------------------------- | ------ |
| printing         | `JOBS_PRINTING_INTERVAL_SECONDS`           | 10       | — (1 POST ไม่มี budget)                | —      |
| edge-users-copy  | `JOBS_EDGE_USERS_COPY_INTERVAL_SECONDS`    | 10       | `JOBS_EDGE_USERS_COPY_BUDGET_SECONDS` | 10     |
| import-shelter   | `JOBS_IMPORT_INTERVAL_SECONDS`             | 30       | `JOBS_IMPORT_BUDGET_SECONDS`          | 30     |
| shelter-close    | `JOBS_CLOSE_INTERVAL_SECONDS`              | 30       | `JOBS_CLOSE_BUDGET_SECONDS`           | 30     |

  - งานค้าง (import / close / backfill) ทำต่อจนว่างหรือหมด budget ของ job นั้น · budget ตรวจ**ระหว่าง call** (ไม่ตัด call ที่กำลังทำ) — close มี chunk budget ฝั่ง server 20 วิต่อ call
  - **ขอบเวลาที่สัญญา (SLA) — คิดจาก interval + budget + timeout ต่อ call ของ job นั้นเอง (ไม่รวมของ job อื่น):**
    - **printing:** ห่างกันปกติ 10 วิ · ถ้า frontend ค้าง POST มี timeout 25 วิ → ห่างได้สูงสุด ~35 วิ (healthcheck เพดาน 120 วิ ไม่ตก)
    - **edge-users-copy:** user ใหม่ขึ้น edge ≤ interval 10 วิ + เวลา copy ของรอบนั้น — ปกติ ≤ ~10–11 วิ (วัดจริง p95 9.8 / max 10.3 วิ) · เพดานเชิงทฤษฎี ≈ interval + budget = 20 วิ + 1 call ของ CouchDB (ตอน backfill ศูนย์ใหม่ที่ drain ใช้ budget เต็ม)
    - **import-shelter:** งานใหม่เริ่มช้าสุด ≈ interval 30 วิ · 1 รอบใช้ได้ ≤ budget 30 วิ + 1 call สุดท้าย (timeout ต่อ call 120 วิ ตามของเดิม) → รอบหนึ่งนานสุด ~150 วิ แต่ไม่กระทบ job อื่น
    - **shelter-close:** งานใหม่เริ่มช้าสุด ≈ interval 30 วิ · 1 รอบ ≤ budget 30 วิ + 1 chunk (timeout ต่อ call 30 วิ / chunk budget ฝั่ง server 20 วิ) → นานสุด ~60 วิ · ศูนย์ ~3,000 คน ≈ 15 chunk
  - ค่าข้างบนเลือกจาก load test บน mock frontend (ดู Decision log) · ยังต้องยืนยัน — วัดเวลาจริงต่อ chunk (close) และต่อ item (import) ด้วยศูนย์ขนาดใหญ่บน staging แล้วแก้ค่าใน compose / `.env.example` + บันทึกใน Decision log
- **แยกความล้มเหลว:** แต่ละ job ห่อ try/except ของตัวเอง (และมี loop ของตัวเอง) ล้มตัวหนึ่งไม่กระทบ job อื่น · log ไม่มี token/body
- **healthcheck:** ใช้ `worker-healthcheck` เดิมของ image `worker/Dockerfile` · เขียน OK file แยกต่อ job หลังรอบสำเร็จ (204 / ว่างนับว่าสำเร็จ) · unhealthy เมื่อ job ใดเก่ากว่า `max(120 วิ, 4 × interval ของ job นั้น)` ตามกติกาเดิมของ housekeeping
- **env ที่ service ถือ (union ของที่ถูกแทน):** `COUCHDB_URL/USER/PASSWORD` (จาก `edge-users-copy`) · `PRINT_HOUSEKEEPING_URL/TOKEN` · `SHELTER_IMPORT_WORKER_URL/TOKEN` · `SHELTER_CLOSE_WORKER_URL/TOKEN` · `JOBS_TICK_SECONDS` · `JOBS_*_INTERVAL_SECONDS` · `JOBS_*_BUDGET_SECONDS` — **ชื่อ env token เดิมคงไว้ทั้งหมด** (ไม่ต้องหมุน/เปลี่ยน secret ที่ deploy แล้ว) · ไม่มี env MongoDB (MongoDB ล่มไม่กระทบ job เหล่านี้ ตามเจตนาเดิมของ CR-247)
- **ที่ต้องคงตามเดิม:** ไม่แก้ logic ฝั่ง SvelteKit ของ import/close (route ภายใน, lease, chunk budget ฝั่ง server) · checkpoint `_local/edge_users_copy`, backfill ครั้งละ 1 DB, `new_edits:false`, รูปแบบข้อมูล `edge_users_<code>` ตาม CR-247 · `PRINT_HOUSEKEEPING_TOKEN` / OK file / doc `print_housekeeping` ตาม CR-222

### 3. ส่วนของ CR เดิมที่ถูกทับ (CR เดิมไม่ถูกแก้ไฟล์ — ให้อ่านคู่กับ CR นี้)

| CR เดิม            | ส่วนที่ CR นี้ทับ                                                                                                                              | ส่วนที่ยังใช้ตามเดิม                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| CR-222             | FR-17: task `print-housekeeping` ใน `sync-worker` → job `printing` ของ `jobs-worker` (ช่วง = `JOBS_PRINTING_INTERVAL_SECONDS` (10 วิ) แทน `PRINT_HOUSEKEEPING_INTERVAL_MS` (30 วิ)) · healthcheck/OK file ตามกติกาด้านบน | FR-17a (`last_run_at` / `last_error`), endpoint, token, retention                       |
| CR-243             | FR-34/FR-35 (service `shelter-close-worker`, compose, `healthcheck: disable`) · `SHELTER_CLOSE_WORKER_POLL_MS` (ลบ — ใช้ `JOBS_CLOSE_INTERVAL_SECONDS`) · worker เป็น Node `.mjs` | internal route `…/shelter-close/worker/next`, lease, chunk budget, `SHELTER_CLOSE_WORKER_TOKEN`, FR อื่นทั้งหมด |
| CR-247             | FR-11: service `edge-users-copy` (container แยก, long-poll) → job ใน `jobs-worker` (`feed=normal` drain ต่อรอบทุก 10 วิ; ผู้ใช้ใหม่ขึ้น edge ช้าสุด ~10–20 วิ) | checkpoint, backfill, `new_edits:false`, DB `edge_users_<code>`, `central-repl-user.sh --status` |
| CR-123 / CR-126    | service `import-worker` / worker Node `.mjs` poll 3 วิ → job `import-shelter` poll ทุก 30 วิ                                                  | pipeline, route ภายใน, token `SHELTER_IMPORT_WORKER_TOKEN`                              |

## Impact

- **compose:** ทั้ง 5 ไฟล์ — ลบ `edge-users-copy`, `import-worker`, `shelter-close-worker` และ env print housekeeping ใน `sync-worker` · เพิ่ม `jobs-worker` (`build: worker/Dockerfile`, `command: ["uv","run","--project","worker","jobs-worker"]`, `mem_limit: 256m`) · container ชื่อ `tent-jobs-worker-<env>` (dev: `jobs-worker`) แทน `tent-edge-users-copy-*` / `tent-import-worker-*` / `tent-shelter-close-worker-*`
- **ผู้ดูแล:** คำสั่ง `docker compose logs/up -d edge-users-copy` ใน `docs/couchdb-replication/*` เปลี่ยนเป็น `jobs-worker` · `.env` ที่ deploy แล้วไม่ต้องเพิ่มอะไร (ค่า `JOBS_*` มี default ใน compose) · `SHELTER_CLOSE_WORKER_POLL_MS` ที่ค้างใน `.env` ไม่มีผล
- **โค้ด/test:** port import/close เป็น Python + test · แก้ test ของ `edge_users_copy` · ลบ `.mjs` + script + test ที่อ้าง service เดิม (`frontend/src/lib/server/shelter-close-infra.test.ts`, `shelter-close-worker-script.test.ts`) · ถอด print housekeeping ออกจาก `worker/src/worker/main.py`
- **ขึ้นกับ:** PR #1403 (แก้ `worker/src/worker/cli/edge_users_copy.py` อยู่) — ควร merge ก่อน หรือ rebase ตามให้ทัน
- **ความเสี่ยง:** import/close ทำงานคู่ขนานกับ edge/printing ใน process เดียว (asyncio) — ถ้า call ช้ากินเวลาก็ไม่บล็อก job อื่น แต่ใช้ RAM/CPU ร่วมกัน (วัดจริง: steady ~170–190 MiB, **ช่วงสตาร์ต peak ~252 MiB จาก limit 256m** — เสนอเพิ่ม `mem_limit` เป็น 384m ตอนอนุมัติ) · `jobs-worker` ตัวเดียว = จุดล้มเดียวของ 4 งาน (ลดผลด้วย restart policy + try/except ต่อ job + healthcheck)

## Migration

N/A (ไม่มี doc ที่ persist เปลี่ยนรูป · ไม่ bump `schema_v`) — ลำดับ cutover: deploy PR เดียวที่ลบ service เดิมและเพิ่ม `jobs-worker` พร้อมกัน (`docker compose up -d --remove-orphans`) · checkpoint `_local/edge_users_copy` และ job/lease ของ import/close ใน CouchDB ใช้ต่อได้ทันที · verify บน staging: ทดสอบ import, close ศูนย์ใหญ่, เพิ่ม user เข้า edge, housekeeping `.ok` / healthcheck

## Decision log

- 2026-11-19 — grill #1479: ตกลงรวม 4 งาน, `sync-worker` ไม่รวม, PR เดียว, budget แยกต่อ job ผ่าน env, cutover/ชื่อ token ตามข้างบน
- 2026-11-21 — proposed (ร่างจาก #1479 ข้อ 6–7) — **รอ project owner อนุมัติก่อนเริ่มโค้ด**
- 2026-11-21 — (ถูกแทนที่ด้านล่าง) ตัวเลข budget แบบ tick เดียว: import **12** · close **10** · edge-users-copy 10 (เดิมร่างไว้ 10/30/30) — จาก load test (100 ศูนย์ / 3,000 users, import 300 items, close 15 chunks, mock frontend): 30/30 → edge p95 53 / max 60 วิ ❌ · 10/10 → max 30.1 วิ แต่ import ช้า (~533 วิ) · 16/8 → max 30.1 วิ แต่ close 1 chunk/tick (~431 วิ) · **12/10 → max 30.2 วิ, import ~471 วิ, close ~261 วิ** · 20/10 → import ~352 วิ แต่ edge p95 33 / max 36 วิ ❌ · ผลดิบ/สคริปต์อยู่ใน `jobs-worker-load-test/` ของ branch `feat/1479-jobs-worker` (ไม่ได้ commit) · ตัวเลขยังต้องยืนยันบน staging
- 2026-11-23 — review PR #1492 (W1): SLA "tick ≲ 30 วิ / edge ≤ ~30 วิ" ขัดกับ budget ของ CR เอง (edge 10 + import 12 + close 10 = 32 วิ, printing ไม่มี budget, call เดียวนานได้ถึง 120/30 วิ) → **owner สั่งเปลี่ยนเป็น interval + loop ต่อ job คู่ขนาน** (printing 10 วิ · edge 10 วิ · import 30 วิ/budget 30 · close 30 วิ/budget 30) แทน tick เดียวที่รันตามลำดับ — ลำดับ printing → edge → import → close ใน #1479 ข้อ 3 จึงไม่ใช้อีก (ไม่มี "ลำดับใน tick") · SLA เขียนเป็นรายงาน job ใน §2 (fixed-period ต่อ job)
- 2026-11-23 — prototype ทดสอบ (100 ศูนย์ / 3,000 users, import 300 items × 0.5 วิ, close 15 chunks × 8 วิ, mock frontend, limit 256m; โค้ด prototype ไม่ได้อยู่ใน branch — เป็นแค่การแก้ runner ให้ 1 job = 1 loop): printing ห่างกัน **10.0 วิ คงที่ (36 ครั้ง ทุกช่วงห่างกัน 10.0 วิ)** · user ใหม่ → edge **p50 5.4 / p95 9.8 / max 10.3 วิ** (40/40 ครบ; รุ่น tick เดียว 12/10 ได้ max 30.2 วิ) · backfill 100 DB **25 วิ** (เดิม 70–116 วิ) · import 300 items เสร็จ **~288 วิ** (12/10 tick เดียว ~471 วิ) · close 15 chunks เสร็จ **~136 วิ** (~261 วิ) · healthy / ไม่ restart / ไม่ OOM · RAM steady ~170–190 MiB, peak ตอนสตาร์ต 252 MiB · ตัวเลขทั้งหมดยังต้องยืนยันบน staging · S3: ที่เปลี่ยนจาก budget 30/30 ใน #1479 → 12/10 → กลับมา 30/30 เพราะแยก loop แล้ว budget ยาวไม่ทำให้ edge ช้าอีก
