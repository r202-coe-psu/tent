---
id: CR-247
title: edge แต่ละศูนย์ sync ด้วย replication user ของตัวเอง + DB เก็บ user ต่อศูนย์ (แทน central admin — แก้ OD-6 ของ CR-064)
status: approved
date: 2026-11-09
updated: 2026-11-11
requested_by: "#1165 (PO เลือกข้อ 1, 2026-11-07) · #1298"
decided_by: kong (ขอบเขตข้อ 1 + 2 และวิธีบันทึกเป็น CR, 2026-11-09 · ตัวคัดลอกเป็น service แยก, 2026-11-11 · approved 2026-11-11)
layer: stable
related:
  - docs/changes/01-core/CR-064-edge-disaster-continuity.md (OD-6 — edge ถือ central admin; decision sync 2026-10-18 B)
  - docs/changes/01-core/CR-171-users-edge-shelters-soft-delete.md (selector `edge_shelters`, FR-13–FR-17 edge mode)
  - docs/changes/01-core/CR-242-edge-role-grant-expiry.md (`edge-grant-sweep` อ่าน/เขียน `_users` ของ edge)
  - "#1296 (EDGE_MODE — บล็อกการเขียน `_users` ที่ edge, merge แล้ว)"
  - "#1331 (hard delete ใน `_users` ไม่ไหลถึง `edge_users_<code>` — แยกไว้ Phase 4)"
affects:
  - docs/couchdb-replication/SETUP-EDGE.md (credential ของ edge, runbook "เครื่อง edge หาย"), SETUP-CENTRAL.md (provision / ปิด edge ต่อศูนย์), README.md §7 (F2 lockout, OD-6)
  - docs/changes/01-core/CR-064-edge-disaster-continuity.md (บันทึกใน Decision log ว่า OD-6 ถูกแทนด้วย CR นี้)
  - docs/data/data-model.md §6 (topology ของ `_users` → edge ผ่าน `edge_users_<code>`)
  - ไม่ bump `schema_v` (`_users` ไม่มี common envelope; ไม่เปลี่ยนรูป doc ของ `shelter_<code>`)
  - frontend/src/lib/server/shelter-access-design.ts (VDU ของ `shelter_<code>`: role `repl:<CODE>` ผ่านแบบเดียวกับ `_admin`)
  - frontend/src/lib/server/registry-design.ts + `syncCatalogAccessDesign` ใน frontend/scripts/sync-central-db.ts (ปฏิเสธ `repl:*`)
  - worker/src/worker/ (คำสั่งใหม่ `edge-users-copy` — คัดลอก `_users` ของ central ลง `edge_users_<code>`) + worker/tests/ (unit + integration)
  - docker-compose.yml (service ใหม่ `edge-users-copy` บน central — build จาก `worker/Dockerfile` ตัวเดียวกับ service `worker`, ไม่มี env ของ MongoDB, ตั้ง `mem_limit`)
  - scripts/central-repl-user.sh (มีอยู่แล้ว — ต่อยอด: ชื่อเดายาก, สร้าง `edge_users_<code>`, `--status`, ตรวจ `_security` ของ `edge_users_*`) + scripts/tests/central-repl-user.test.sh (ใหม่)
  - frontend/src/lib/server/user-service.ts (ซ่อน/กันแก้บัญชี `repl_*` ในหน้าจัดการผู้ใช้)
  - scripts/edge-init.sh, scripts/edge-watchdog.sh, .env.edge.example, docker-compose.edge.yml (`CENTRAL_REPL_*` → `EDGE_REPL_*`)
why: edge ทุกเครื่องถือรหัส central admin (OD-6) — เครื่องหาย = เสีย admin ทั้งระบบ และรหัสผิด 5 ครั้งของชื่อ admin หยุด replication ของทุก edge พร้อมกัน (#1165)
---

# CR-247 — edge sync ด้วย replication user ต่อศูนย์ + `edge_users_<code>`

> **สรุป (TL;DR):**
>
> - **เปลี่ยน:** job replication ทุกตัวของ edge ใช้บัญชี `repl_<code>_<suffix>` (role `repl:<CODE>`) แทน central admin · `_users` ลง edge ผ่าน DB ใหม่ `edge_users_<code>` ที่ worker ของ central คัดลอกให้ (อ่าน `_users` feed เดียวไม่ว่ามีกี่ศูนย์)
> - **ผล:** รหัส central admin อยู่ที่ central เท่านั้น · เครื่อง edge หายปิดได้ที่ central ทันทีโดยไม่กระทบศูนย์อื่น · lockout ของบัญชีหนึ่งหยุดแค่ศูนย์เดียว
> - **dev build:** คำสั่ง `scripts/central-repl-user.sh <CODE>` / `scripts/central-repl-user.sh <CODE> --remove` · consumer ใหม่ใน `worker/` · VDU 3 ชุด (`shelter_<code>`, `registry`/`catalog`, `edge_users_<code>`) · แก้ `edge-init.sh` + env ของ edge · runbook
> - **layer: stable** (auth + sync) · ไม่ bump `schema_v` · ขึ้นกับ #1296 (merge แล้ว)

---

## Why

- **OD-6 ของ CR-064 (decision sync 2026-10-05):** edge ใช้ central admin ชุดเดียวทุก job (`scripts/edge-init.sh:113-116`) รหัสอยู่ใน `.env` ของ edge, env ของ `edge-init` / `edge-watchdog` และ doc ใน `_replicator` ของ edge — ใครถือเครื่องก็ดึงรหัสออกได้ เข้ารหัสไฟล์ไม่ช่วย เพราะ replicator ต้องใช้รหัสจริง
  - edge mode (#1296) บล็อกการแก้ user ผ่านแอปที่ edge เท่านั้น ผู้ได้รหัส admin ยิง `_users` ของ central ตรงได้ (สร้าง user, แก้ role ของใครก็ได้)
  - หมุนรหัส admin หลังเครื่องหาย ต้องแก้ `.env` + job ที่ edge **ทุกเครื่อง**
- **lockout DoS (#1165):** CouchDB 3.5 ล็อกต่อ (user, IP) หลังรหัสผิด 5 ครั้ง (`README.md` F2) edge ทุกเครื่องเข้า central ผ่าน nginx ตัวเดียว → คนนอกยิงรหัสผิดด้วยชื่อ admin 5 ครั้ง replication ของทุก edge หยุด 5 นาที
- **trigger ของ OD-6** ("ทบทวนก่อนติดตั้ง edge ศูนย์ที่สอง หรือเมื่อเครื่อง edge หาย") — PO เลือกข้อ 1 ใน #1165 (2026-11-07)
- **ทำไมต้องมีข้อ 2:** job `users_<code>_pull` (`scripts/edge-init.sh:135`) อ่าน `_users` ของ central ซึ่ง CouchDB ให้อ่านได้เฉพาะ server admin ทำข้อ 1 อย่างเดียว รหัส admin ยังอยู่บน edge และ lockout ยังเกิดกับ job `_users` ของทุกศูนย์

|                        | ใครใช้ admin อ่าน `_users` ของ central | รหัส admin อยู่ที่ไหน     |
| ---------------------- | -------------------------------------- | ------------------------- |
| ตอนนี้                 | edge ทุกเครื่อง                        | central + edge ทุกเครื่อง |
| ข้อ 1 อย่างเดียว       | edge ทุกเครื่อง (job `_users`)         | central + edge ทุกเครื่อง |
| **ข้อ 1 + 2 (CR นี้)** | worker ของ central                     | **central เท่านั้น**      |

### ผลตรวจก่อนเริ่ม — user ธรรมดา push เข้า `shelter_<code>` ไม่ผ่าน VDU ปัจจุบัน

ตรวจจาก `buildValidateDocUpdate` (`frontend/src/lib/server/shelter-access-design.ts`) 2026-11-09: วันนี้ push ผ่านเพราะ job ใช้ `_admin` (`if (isCouchAdmin && !isRoleAssessmentWrite) return;`) ถ้าเปลี่ยนเป็น user ที่มีแค่ membership จะถูกปฏิเสธอย่างน้อย:

- `evacuee_qr` — `if (!isCouchAdmin) throw 'evacuee_qr is written by the server only'` (edge server เขียนด้วย admin ของ edge)
- doc ที่เช็กผู้เขียน — เช่น `created_by !== userCtx.name`, `checked_by !== userCtx.name` (`userCtx.name` ตอน push = บัญชี replication ไม่ใช่ staff ที่เขียนจริง)
- doc ที่เช็ก role ของผู้เขียน — ทุก type ที่ต้องมี `<CODE>:<role>` หรือ `shelter_manager`
- `daily_sop_role_assessment` — `assessment_date !== currentBangkokDate` (push ย้อนหลังหลัง WAN กลับข้ามวันจะถูกปฏิเสธ)

**สรุป:** ต้องแก้ VDU ของ `shelter_<code>` (FR-6) — แก้จุดเดียว (ตัวแปร bypass) ไม่ต้องแก้กฎราย type

## Change

### ภาพรวม

```
central (admin ใช้ภายใน central เท่านั้น):
  _users ──[worker: _changes feed เดียว → กระจายตาม edge_shelters, new_edits:false]──► edge_users_<code>   (VDU: เขียนได้เฉพาะ _admin)

edge <code> ──(repl_<code>_<suffix>, role repl:<CODE>)──► shelter_<code>      อ่าน + เขียน
                                                               registry, catalog   อ่านอย่างเดียว (VDU ปฏิเสธ repl:*)
                                                               edge_users_<code>   อ่านอย่างเดียว → _users ของ edge
```

|                                  | ก่อน                                                          | หลัง                                                                                  |
| -------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| credential ฝั่ง central ของ edge | `CENTRAL_REPL_USER` / `CENTRAL_REPL_PASSWORD` = central admin | `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD` = `repl_<code>_<suffix>` (ไม่ใช่ admin)       |
| source ของ `users_<code>_pull`   | `$CEN/_users` + selector `edge_shelters`                      | `$CEN/edge_users_<code>` (selector กรองแค่ `_design/*` — กรอง user แล้วที่ central)   |
| ตัวกรอง user ต่อศูนย์            | selector ของ job บน edge                                      | worker ของ central เลือกปลายทางจาก `edge_shelters` + `roles` (กฎเดียวกับ CR-171 FR-9) |
| ปิดเครื่อง edge หนึ่งเครื่อง     | หมุนรหัส admin + แก้ edge ทุกเครื่อง                          | `scripts/central-repl-user.sh <CODE> --remove` ที่ central                            |

### Requirements — บัญชี replication ต่อศูนย์

- **FR-1** — `scripts/central-repl-user.sh <CODE>` (มีอยู่แล้ว — รันที่ central ด้วย admin จาก `COUCHDB_USER`/`COUCHDB_PASSWORD` หรือ `.env`; วันนี้สร้าง `repl_<code>` role `repl:<CODE>` และมี `--rotate` / `--remove`) เปลี่ยนให้สร้าง `org.couchdb.user:repl_<code>_<suffix>`: `<code>` ตัวเล็ก, `<suffix>` = 8 ตัวอักษรสุ่ม hex · `roles: ["repl:<CODE>"]` เท่านั้น · รหัสผ่านสุ่ม 32 ตัวอักษร hex · `type: "user"` · **ไม่มี** `edge_shelters`
- **FR-2** — แสดง username + password **ครั้งเดียว** ตอนสร้างหรือ `--rotate` · รันซ้ำโดยไม่ใส่ `--rotate` คงรหัสเดิม (พฤติกรรมเดิม) · หนึ่งศูนย์มีบัญชี `repl_<code>_*` ได้ ≤ 1 บัญชี — เจอบัญชีเดิมให้ใช้ตัวนั้น · เจอบัญชีแบบเก่า `repl_<code>` (ไม่มี suffix) ให้หยุดพร้อม error บอกให้ `--remove` ก่อน
- **FR-3** — role `repl:<CODE>` ถูกเพิ่มใน `_security.members.roles` ของ `shelter_<code>`, `registry`, `catalog` และเป็น member **เพียงตัวเดียว** ของ `edge_users_<code>` · ไม่เพิ่มใน `shelter_<ศูนย์อื่น>`
- **FR-4** — `scripts/central-repl-user.sh <CODE> --remove` ลบ `org.couchdb.user:repl_<code>_*` ทุกตัวของศูนย์นั้นจาก `_users` ของ central และถอด `repl:<CODE>` ออกจาก `_security` ของทุก DB ใน FR-3 · ไม่แตะ DB / job ของศูนย์อื่น · idempotent
- **FR-5** — หน้าจัดการผู้ใช้ (`user-service.ts` list / get / update / reset password / delete) ไม่แสดงและไม่แก้บัญชีที่มี role `repl:*` (404 หรือ 403) — บัญชีนี้จัดการด้วย FR-1/FR-4 เท่านั้น

### Requirements — VDU

- **FR-6** — VDU ของ `shelter_<code>`: role `repl:<CODE>` (ตรงกับ code ของ DB นี้) ได้สิทธิ์เท่า `isCouchAdmin` ทุกจุดในฟังก์ชัน รวมกฎที่รันก่อน bypass (`evacuee_qr` append-only, `daily_sop_role_assessment` ห้ามลบ) ซึ่งยังบังคับเหมือน admin · `repl:<CODE อื่น>` ไม่ได้สิทธิ์
  - **เหตุผล:** doc ผ่าน VDU ตัวเดียวกันที่ edge แล้วตอน staff เขียน (`_design/access` ถูก pull ลง edge) — central เชื่อ edge เท่ากับวันนี้ที่เชื่อ admin
- **FR-7** — VDU ของ `registry` (`_design/app`) และ `catalog` (`_design/access`) ที่ central: ถ้า `userCtx.roles` มีค่าที่ขึ้นต้น `repl:` → `forbidden` ทุกการเขียน (ตรวจก่อนกฎอื่น)
- **FR-8** — `edge_users_<code>` มี `_design/readonly`: เขียนได้เฉพาะ `_admin` นอกนั้น `forbidden`
- **FR-9** — design doc ของ `shelter_<code>` ยังเขียนไม่ได้จาก `repl:*` (CouchDB ให้เฉพาะ db admin เขียน `_design/*` — ไม่ต้องเพิ่มโค้ด แต่ต้องมี test)

### Requirements — `edge_users_<code>` (ตัว copy = worker ของ central)

- **FR-10** — `central-repl-user.sh` สร้าง `edge_users_<code>` + `_security` = `{"admins":{"names":[],"roles":[]},"members":{"names":[],"roles":["repl:<CODE>"]}}` (server admin เข้าได้เสมอโดยไม่ต้องอยู่ใน `admins`) + FR-8 **ก่อน** สร้างบัญชีใน FR-1
- **FR-11** — ตัว copy = service ใหม่ `edge-users-copy` บน **central** · โค้ดอยู่ใน `worker/` (คำสั่ง `uv run --project worker edge-users-copy`) แต่รันเป็น container แยกจาก sync-worker · ใช้ admin ของ central จาก `COUCHDB_USER`/`COUCHDB_PASSWORD` · **ต่อ CouchDB อย่างเดียว** ไม่ต่อ MongoDB และไม่รัน bootstrap ของ sync-worker:
  - อ่าน `_changes` ของ `_users` **feed เดียว** (`style=all_docs`) · checkpoint เก็บใน `_users/_local/edge_users_copy` บน central (doc `_local` ไม่ถูก replicate) · restart แล้วอ่านต่อจากจุดเดิม
  - ข้าม `_design/*`
  - ปลายทาง = ศูนย์ใน `edge_shelters` ∪ ศูนย์จาก `roles` ที่เป็น `shelter:<CODE>` (กฎเดียวกับ selector ปัจจุบัน — CR-171 FR-9) · เขียนเฉพาะศูนย์ที่มี DB `edge_users_<code>` อยู่ (ศูนย์ที่ไม่มี edge ข้าม)
  - วิธีเขียน: อ่าน revision ที่ชนะด้วย `GET _users/<id>?rev=<rev>&revs=true` แล้ว `POST edge_users_<code>/_bulk_docs` ด้วย `new_edits: false` — revision และประวัติ (`_revisions`) ตรงกับ central ทุกตัว
  - **เหตุผล (worker แทน `_replicator`):** `_replicator` ต้องมี job ต่อเนื่องหนึ่งตัวต่อศูนย์ และทุก job อ่าน + กรอง `_users` ทั้งก้อนเอง — 100 ศูนย์ = 100 job ต่อเนื่องค้างไว้บน central (เกิน `[replicator] max_jobs` ซึ่ง default = 500 เมื่อไหร่ scheduler จะหมุน job ทำให้การถอดสิทธิ์ถึง edge ช้าลง) และตอน rollout ทุก job ไล่ `_users` จาก seq 0 พร้อมกัน · worker อ่าน feed เดียวแล้วเขียนเฉพาะศูนย์ที่เกี่ยว ไม่ว่ามีกี่ศูนย์
  - **revision tree ไม่เสีย:** prototype บน CouchDB local (2026-11-11) — edge ที่ดึง `_users` ตรงอยู่แล้วเปลี่ยน source มาเป็น `edge_users_<code>` ที่เขียนด้วย `new_edits: false` → ไม่มี conflict ทุกกรณี (สลับ source, เปลี่ยนรหัส 2 ครั้งแต่คัดลอกแค่ครั้งล่าสุด, ถอด role, soft delete, ประมวลผล change ซ้ำ) · ตัวควบคุมที่เขียนแบบปกติเกิด conflict
  - ถอด role / soft delete / ย้ายศูนย์: `edge_shelters` เป็น append-only (CR-171 FR-2) → revision ใหม่ยังไปถึงศูนย์เดิมเสมอ
  - hard delete (tombstone ไม่มี `edge_shelters`) **นอกขอบเขต** — เหมือนเดิม · ติดตามที่ #1331
- **FR-11a (backfill)** — เมื่อมี `edge_users_<code>` ใหม่ (FR-10) worker ต้องคัดลอก user ที่มีอยู่แล้วของศูนย์นั้นทั้งหมดด้วยวิธีเดียวกับ FR-11 ภายใน 1 นาทีหลังสร้าง DB · อ่าน `_users` ทีละหน้า (เช่น 500 doc) ห้ามโหลดทั้งก้อน · บันทึกว่าศูนย์ไหน backfill แล้วใน `_users/_local/edge_users_copy` · backfill ซ้ำต้องไม่มีผลเสีย (`new_edits: false` กับ revision ที่มีแล้ว = no-op)
- **FR-12** — `central-repl-user.sh` ทุก action ตรวจ `edge_users_*` ทุก DB บน central: `members.names` ไม่ว่าง หรือ `members.roles` ≠ `["repl:<CODE>"]` พอดี (รวมกรณีว่าง = เปิดสาธารณะ) → หยุดพร้อม error ระบุชื่อ DB
- **FR-13 (health)** — service FR-11 บันทึกสถานะ (`last_seq` ที่ประมวลผลแล้ว, `last_error`, `updated_at`) ใน `_users/_local/edge_users_copy` · `scripts/central-repl-user.sh <CODE> --status` อ่าน doc นี้ด้วย `curl` แล้วแสดงเทียบกับ `update_seq` ของ `_users` และสถานะ backfill ของศูนย์ (FR-11a) · exit ≠ 0 เมื่อมี `last_error` หรือ service ตามหลัง `_users` นานเกิน 5 นาที · SETUP-CENTRAL.md ระบุให้ใส่ในการตรวจประจำวันของ central

### Requirements — edge

- **FR-14** — `scripts/edge-init.sh` ใช้ `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD` กับทุก job ฝั่ง central (`registry_pull`, `catalog_pull`, `<code>_pull`, `<code>_push`, `users_<code>_pull`) · ไม่อ่าน `CENTRAL_REPL_*` อีก
- **FR-15** — `users_<code>_pull` = source `$CEN/edge_users_<code>` → target `$LOC/_users` · selector กรองแค่ `_design/*` (กัน `_design/readonly` ของ FR-8 ลงไปอยู่ใน `_users` ของ edge)
- **FR-16** — `edge-init.sh` ตรวจ credential ก่อนสร้าง job: `GET $CEN/_session` ด้วย `EDGE_REPL_*` ต้องได้ 200 และ `userCtx.roles` ต้องมี `repl:<SHELTER_CODE>` และ**ไม่มี** `_admin` — ไม่ผ่าน = `FAILED` exit 1 (กันเอา admin มาใส่ซ้ำ)
- **FR-17** — จุดตรวจ uuid (`GET $CEN/`) ทำงานด้วย `EDGE_REPL_*`
- **FR-18** — `.env.edge.example`, `docker-compose.edge.yml` (`edge-init`, `edge-watchdog`) ใช้ `EDGE_REPL_*` · ลบ `CENTRAL_REPL_*` ออกทั้งหมด (`edge-watchdog` เรียกแค่ `GET $SYNC_URL/_up` ไม่ใช้ credential)
- **FR-19** — EDGE_MODE (#1296, CR-171 FR-13–FR-17) และ `edge-grant-sweep` (CR-242) ทำงานเหมือนเดิม (ใช้ admin ของ **edge** ไม่ใช่ของ central)

### Requirements — เอกสาร + rollout

- **FR-20** — SETUP-CENTRAL.md: ขั้นตอน provision / revoke / status ต่อศูนย์ · SETUP-EDGE.md: ใส่ `EDGE_REPL_*` จากผล `central-repl-user.sh`, checklist ทดสอบ (AC-7)
- **FR-21** — runbook "เครื่อง edge หาย" ใน SETUP-CENTRAL.md (ทำที่ central ทั้งหมด):
  1. `scripts/central-repl-user.sh <CODE> --remove`
  2. reset password ของ staff ทุกคนที่ `edge_shelters` มี `<CODE>` ด้วย reset password ที่มีอยู่ (`user-service.ts` — เปลี่ยนเป็นรหัสชั่วคราวทันที) · **ห้าม**ตั้งแค่ `must_change_password` (รหัสเดิมยัง login ได้)
  3. ตรวจ revision ใน `shelter_<code>` ที่ sync ขึ้นมาหลังเวลาที่เครื่องหาย
  4. ติดตั้ง edge เครื่องใหม่ด้วย `scripts/central-repl-user.sh <CODE>` ใหม่
- **FR-22** — หลัง deploy CR นี้ครบทุก edge: หมุนรหัส central admin (edge ที่ติดตั้งก่อนหน้ายังมีรหัสเก่าใน `.env`/`_replicator`) แล้วอัปเดต `COUCHDB_PASSWORD` ของ worker ที่ central + restart

## Acceptance

- **AC-1** — `.env` ของ edge และ doc ทุกตัวใน `_replicator` ของ edge ไม่มีรหัส central admin
- **AC-2** — ใช้ `repl_sh001_*` อ่าน `shelter_sh002`, `_users` ของ central, `edge_users_sh002` → 401/403
- **AC-3** — ใช้ `repl_sh001_*` เขียน `registry`, `catalog`, `edge_users_sh001` ของ central → 403
- **AC-4** — อ่าน `edge_users_sh001` แบบไม่ login และด้วย staff ของ SH001 → 401/403
- **AC-5** — ยิงรหัสผิดด้วย `repl_sh001_*` จนถูกล็อก → replication ของ SH002 ยังทำงาน
- **AC-6** — `central-repl-user.sh SH001 --remove` → job ของ SH001 หยุด (401) ส่วน SH002 ยัง sync ได้
- **AC-7** — sync สองทางของ `shelter_<code>` ครบทุก doc type (รวม `evacuee_qr`, doc ที่มี `created_by`, `daily_sop_role_assessment` ข้ามวัน) และ login ที่ edge ตอน WAN ล่ม ผ่าน checklist ใน SETUP-EDGE.md
- **AC-8** — ภายในเวลา sync ปกติ: user ที่ถูก soft delete ที่ central → login ที่ edge ไม่ได้ (401) · user ที่ถูกถอด role อย่างเดียว → login ได้แต่ `roles` ว่าง และอ่าน `shelter_<code>` ที่ edge ได้ 403
- **AC-9** — edge ที่ติดตั้งก่อน CR นี้ เปลี่ยน credential + รัน `edge-init` ใหม่ → `_users` ของ edge ไม่มี conflict
- **AC-10** — `edge-init` ด้วย credential ที่เป็น admin → `FAILED` (FR-16)
- **AC-11** — unit test VDU FR-6–FR-8 ครอบ `repl:<CODE>` ตรงศูนย์, ต่างศูนย์, ไม่มี role · `scripts/tests/central-repl-user.test.sh` ครอบ FR-1–FR-4, FR-10, FR-12 บน CouchDB local (แบบเดียวกับ `edge-watchdog.test.sh`) · `worker/tests/` ครอบ FR-11 (เลือกปลายทาง, ข้าม `_design/*`, ข้ามศูนย์ที่ไม่มี DB) และ FR-11a
- **AC-12** — หยุด worker ระหว่างมี change ค้าง แล้วเปิดใหม่ → change ทั้งหมดถึง `edge_users_<code>` ครบ และไม่มี conflict ที่ edge
- **AC-13** — สร้างศูนย์ใหม่ด้วย `central-repl-user.sh <CODE>` → ภายใน 1 นาที `edge_users_<code>` มี user เดิมทั้งหมดของศูนย์นั้น (FR-11a)
- **AC-14** — user ที่อยู่ 2 ศูนย์ → change หนึ่งครั้งถึง `edge_users_<code>` ของทั้งสองศูนย์ และไม่ถึงศูนย์อื่น

## Impact

- **ความเสี่ยง:** `edge_users_<code>` มี password hash ซ้ำอีกชุด — ตั้ง `_security` พลาดจะรั่วกว่าเดิม (กันด้วย FR-10 + FR-12) · service `edge-users-copy` หยุดหรือ error = user ที่ควรหมดสิทธิ์ยัง login ที่ edge ได้ (กันด้วย FR-13) · service นี้กลายเป็นส่วนหนึ่งของเส้นทางถอดสิทธิ์ — โค้ดที่ทีมดูแลเองแทน CouchDB (retry / checkpoint / backfill)
- **ยอมรับ:** เครื่อง edge ที่ถูกขโมยยังเขียน `shelter_<code>` ของตัวเองได้ (ข้าม VDU ตาม FR-6) จนกว่า `--remove` · ข้อมูลในเครื่อง (`shelter_<code>`, password hash ของ staff ศูนย์นั้น) ยังอยู่ในมือคนขโมย → FR-21
- **ไม่เปลี่ยน:** EDGE_MODE, `edge-grant-sweep`, การเขียน `_users` ทั้งหมดยังทำที่ central ผ่าน `user-service.ts`
- **นอกขอบเขต:** เปลี่ยนชื่อ central admin บน staging/prod · reset password ทั้งศูนย์ในคำสั่งเดียว · เครื่องมือตรวจ revision ตามช่วงเวลา · เข้ารหัสดิสก์ edge · hard delete ใน `_users` ไม่ลง edge (เหมือนเดิม — CR-064 decision sync 2026-10-18 · #1331)
- **scale:** service อ่าน `_users` feed เดียวไม่ว่ามีกี่ศูนย์ · ภาระต่อ change = เขียนเฉพาะ `edge_users_<code>` ของศูนย์ที่ user อยู่ · RAM ไม่โตตาม load (ประมวลผลทีละ change, backfill ทีละหน้า) · sync-worker ที่ทำงานหลายอย่างใช้ราว 65 MB บนเครื่อง dev
- **ไม่พึ่ง MongoDB:** การคัดลอก user ไป edge ใช้ CouchDB อย่างเดียว ทั้งข้อมูล checkpoint และสถานะ · MongoDB ล่ม หรือ sync-worker พัง / bootstrap นาน ไม่กระทบการถอดสิทธิ์ที่ edge

## Migration

- ไม่ bump `schema_v`
- ก่อนเปิด service `edge-users-copy`: ต้องทำขั้น backfill `edge_shelters` ของ CR-171 ที่ central แล้ว (SETUP-EDGE.md "อัปเกรดเป็น CR-171" ข้อ 2 — `pnpm backfill:edge-shelters --write` รันซ้ำแล้วต้องไม่มี doc เปลี่ยน) · user ที่ไม่มี `edge_shelters` แล้วถูกถอด role จะไม่ถูกส่งไป edge
- edge ที่ติดตั้งแล้ว (ยังไม่มีในศูนย์จริง — gate A2): `scripts/central-repl-user.sh <CODE>` ที่ central → ใส่ `EDGE_REPL_*` ใน `.env` ของ edge, ลบ `CENTRAL_REPL_*` → `docker compose -f docker-compose.edge.yml run --rm edge-init` (hash เปลี่ยน → job ถูกสร้างใหม่ตาม `stale`) → FR-22

## Decision log

- 2026-10-05 — OD-6 (CR-064): edge ใช้ central admin เป็น credential replication
- 2026-10-18 — decision sync: ทบทวน OD-6 ก่อนติดตั้ง edge ศูนย์ที่สอง หรือเมื่อเครื่อง edge หาย
- 2026-11-07 — PO เลือกข้อ 1 (replication user ต่อศูนย์) ใน #1165
- 2026-11-09 — kong: ทำข้อ 1 + 2 คู่กัน · บันทึกเป็น CR
- 2026-11-09 — แก้ FR-15 / AC-8 ตามผล e2e ใน #1305: `_design/readonly` หลุดลง `_users` ของ edge · ถอด role อย่างเดียวไม่ได้ทำให้ CouchDB ปฏิเสธ login
- 2026-11-09 — proposed (#1298) · ตัวเลือกในร่าง: ตัว copy ใช้ `_replicator` ของ central แทนโค้ดใน `worker/` (FR-11) · ต่อยอด `scripts/central-repl-user.sh` แทนเขียนคำสั่งใหม่ (FR-1)
- 2026-11-11 — kong: ตัว copy เปลี่ยนเป็น worker ของ central (FR-11, FR-11a, FR-13) — `_replicator` ต้องมี job ต่อศูนย์ ไม่รองรับหลักร้อยศูนย์ · ข้อกังวลเรื่อง revision tree ปิดด้วย `new_edits: false` (prototype 2026-11-11 ไม่มี conflict) · hard delete แยกเป็น #1331 (Phase 4) · ตัด effort ออกจาก CR
- 2026-11-11 — kong: ตัว copy รันเป็น service แยก `edge-users-copy` (image เดียวกับ sync-worker) และเก็บ checkpoint / สถานะใน `_users/_local/edge_users_copy` แทน MongoDB — การถอดสิทธิ์ที่ edge ไม่พึ่ง MongoDB หรือ sync-worker · `--status` อ่านด้วย `curl` ได้ · backfill ทีละหน้า + `mem_limit` · เพิ่มเงื่อนไข backfill `edge_shelters` ของ CR-171 ใน Migration
- 2026-11-11 — approved โดย kong · รันเลข CR-247 (#1298 / PR #1304)
