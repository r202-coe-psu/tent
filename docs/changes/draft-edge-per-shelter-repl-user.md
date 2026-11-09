---
id: draft
title: edge แต่ละศูนย์ sync ด้วย replication user ของตัวเอง + DB เก็บ user ต่อศูนย์ (แทน central admin — แก้ OD-6 ของ CR-064)
status: proposed
date: 2026-11-09
updated: 2026-11-09
requested_by: "#1165 (PO เลือกข้อ 1, 2026-11-07) · #1298"
decided_by: kong (ขอบเขตข้อ 1 + 2 และวิธีบันทึกเป็น CR, 2026-11-09) — รออนุมัติตัว CR
layer: stable
related:
  - docs/changes/01-core/CR-064-edge-disaster-continuity.md (OD-6 — edge ถือ central admin; decision sync 2026-10-18 B)
  - docs/changes/01-core/CR-171-users-edge-shelters-soft-delete.md (selector `edge_shelters`, FR-13–FR-17 edge mode)
  - docs/changes/01-core/CR-242-edge-role-grant-expiry.md (`edge-grant-sweep` อ่าน/เขียน `_users` ของ edge)
  - "#1296 (EDGE_MODE — บล็อกการเขียน `_users` ที่ edge, merge แล้ว)"
affects:
  - docs/couchdb-replication/SETUP-EDGE.md (credential ของ edge, runbook "เครื่อง edge หาย"), SETUP-CENTRAL.md (provision / ปิด edge ต่อศูนย์), README.md §7 (F2 lockout, OD-6)
  - docs/changes/01-core/CR-064-edge-disaster-continuity.md (บันทึกใน Decision log ว่า OD-6 ถูกแทนด้วย CR นี้)
  - docs/data/data-model.md §6 (topology ของ `_users` → edge ผ่าน `edge_users_<code>`)
  - ไม่ bump `schema_v` (`_users` และ `_replicator` ไม่มี common envelope; ไม่เปลี่ยนรูป doc ของ `shelter_<code>`)
  - frontend/src/lib/server/shelter-access-design.ts (VDU ของ `shelter_<code>`: role `repl:<CODE>` ผ่านแบบเดียวกับ `_admin`)
  - frontend/src/lib/server/registry-design.ts + `syncCatalogAccessDesign` ใน frontend/scripts/sync-central-db.ts (ปฏิเสธ `repl:*`)
  - scripts/central-repl-user.sh (มีอยู่แล้ว — ต่อยอด: ชื่อเดายาก, `edge_users_<code>` + job copy, `--status`, ตรวจ `_security` ของ `edge_users_*`) + scripts/tests/central-repl-user.test.sh (ใหม่)
  - frontend/src/lib/server/user-service.ts (ซ่อน/กันแก้บัญชี `repl_*` ในหน้าจัดการผู้ใช้)
  - scripts/edge-init.sh, scripts/edge-watchdog.sh, .env.edge.example, docker-compose.edge.yml (`CENTRAL_REPL_*` → `EDGE_REPL_*`)
why: edge ทุกเครื่องถือรหัส central admin (OD-6) — เครื่องหาย = เสีย admin ทั้งระบบ และรหัสผิด 5 ครั้งของชื่อ admin หยุด replication ของทุก edge พร้อมกัน (#1165)
---

# ร่าง CR — edge sync ด้วย replication user ต่อศูนย์ + `edge_users_<code>`

> **สรุป (TL;DR):**
>
> - **เปลี่ยน:** job replication ทุกตัวของ edge ใช้บัญชี `repl_<code>_<suffix>` (role `repl:<CODE>`) แทน central admin · `_users` ลง edge ผ่าน DB ใหม่ `edge_users_<code>` ที่ central คัดลอกให้ด้วย `_replicator` ของ central เอง
> - **ผล:** รหัส central admin อยู่ที่ central เท่านั้น · เครื่อง edge หายปิดได้ที่ central ทันทีโดยไม่กระทบศูนย์อื่น · lockout ของบัญชีหนึ่งหยุดแค่ศูนย์เดียว
> - **dev build:** คำสั่ง `scripts/central-repl-user.sh <CODE>` / `scripts/central-repl-user.sh <CODE> --remove` · VDU 3 ชุด (`shelter_<code>`, `registry`/`catalog`, `edge_users_<code>`) · แก้ `edge-init.sh` + env ของ edge · runbook
> - **layer: stable** (auth + sync) · ไม่ bump `schema_v` · effort ราว 4–7 วัน · ขึ้นกับ #1296 (merge แล้ว)

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
| **ข้อ 1 + 2 (CR นี้)** | `_replicator` ของ central              | **central เท่านั้น**      |

### ผลตรวจก่อนเริ่ม — user ธรรมดา push เข้า `shelter_<code>` ไม่ผ่าน VDU ปัจจุบัน

ตรวจจาก `buildValidateDocUpdate` (`frontend/src/lib/server/shelter-access-design.ts`) 2026-11-09: วันนี้ push ผ่านเพราะ job ใช้ `_admin` (`if (isCouchAdmin && !isRoleAssessmentWrite) return;`) ถ้าเปลี่ยนเป็น user ที่มีแค่ membership จะถูกปฏิเสธอย่างน้อย:

- `evacuee_qr` — `if (!isCouchAdmin) throw 'evacuee_qr is written by the server only'` (edge server เขียนด้วย admin ของ edge)
- doc ที่เช็กผู้เขียน — เช่น `created_by !== userCtx.name`, `checked_by !== userCtx.name` (`userCtx.name` ตอน push = บัญชี replication ไม่ใช่ staff ที่เขียนจริง)
- doc ที่เช็ก role ของผู้เขียน — ทุก type ที่ต้องมี `<CODE>:<role>` หรือ `shelter_manager`
- `daily_sop_role_assessment` — `assessment_date !== currentBangkokDate` (push ย้อนหลังหลัง WAN กลับข้ามวันจะถูกปฏิเสธ)

**สรุป:** ต้องแก้ VDU ของ `shelter_<code>` (FR-6) ขนาดงานอยู่ในกรอบ 4–7 วันเดิม เพราะแก้จุดเดียว (ตัวแปร bypass) ไม่ต้องแก้กฎราย type

## Change

### ภาพรวม

```
central (admin ใช้ภายใน central เท่านั้น):
  _users ──[_replicator ของ central, selector edge_shelters]──► edge_users_<code>   (VDU: เขียนได้เฉพาะ _admin)

edge <code> ──(repl_<code>_<suffix>, role repl:<CODE>)──► shelter_<code>      อ่าน + เขียน
                                                               registry, catalog   อ่านอย่างเดียว (VDU ปฏิเสธ repl:*)
                                                               edge_users_<code>   อ่านอย่างเดียว → _users ของ edge
```

|                                  | ก่อน                                                          | หลัง                                                                                       |
| -------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| credential ฝั่ง central ของ edge | `CENTRAL_REPL_USER` / `CENTRAL_REPL_PASSWORD` = central admin | `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD` = `repl_<code>_<suffix>` (ไม่ใช่ admin)            |
| source ของ `users_<code>_pull`   | `$CEN/_users` + selector `edge_shelters`                      | `$CEN/edge_users_<code>` (ไม่มี selector — กรองแล้วที่ central)                            |
| ตัวกรอง user ต่อศูนย์            | selector ของ job บน edge                                      | selector ของ job `edge_users_<code>` บน `_replicator` ของ central (กฎเดียวกับ CR-171 FR-9) |
| ปิดเครื่อง edge หนึ่งเครื่อง     | หมุนรหัส admin + แก้ edge ทุกเครื่อง                          | `scripts/central-repl-user.sh <CODE> --remove` ที่ central                                 |

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

### Requirements — `edge_users_<code>` (ตัว copy)

- **FR-10** — `central-repl-user.sh` สร้าง `edge_users_<code>` + `_security` = `{"admins":{"names":[],"roles":[]},"members":{"names":[],"roles":["repl:<CODE>"]}}` (server admin เข้าได้เสมอโดยไม่ต้องอยู่ใน `admins`) + FR-8 **ก่อน** สร้างบัญชีใน FR-1
- **FR-11** — ตัว copy = doc `edge_users_<code>` ใน `_replicator` ของ **central**: source `http://127.0.0.1:5984/_users`, target `http://127.0.0.1:5984/edge_users_<code>`, auth = admin ของ central, `continuous: true`, selector เดียวกับ job `users_<code>_pull` ปัจจุบัน (`edge_shelters` มี `<CODE>` หรือ `roles` มี `shelter:<CODE>`)
  - **เหตุผล (ใช้ `_replicator` แทนโค้ดใน `worker/`):** คง revision tree ของ `_users` เดิม — edge ที่ติดตั้งแล้วเปลี่ยน source ได้โดยไม่เกิด conflict · ครอบทุกกรณี (user ใหม่, เปลี่ยนรหัส, ถอด role, soft delete, ย้ายศูนย์) ด้วยกลไกเดียวกับ job ปัจจุบันที่ทดสอบแล้วใน CR-171 · backfill = replication จาก seq 0 · checkpoint/retry เป็นของ CouchDB
  - doc ของ job เก็บ hash ของ config (เหมือน `edge_init_hash`) — admin/รหัสเปลี่ยน → รัน `central-repl-user.sh <CODE>` อีกครั้งแล้ว job ถูกสร้างใหม่
- **FR-12** — `central-repl-user.sh` ทุก action ตรวจ `edge_users_*` ทุก DB บน central: `members.names` ไม่ว่าง หรือ `members.roles` ≠ `["repl:<CODE>"]` พอดี (รวมกรณีว่าง = เปิดสาธารณะ) → หยุดพร้อม error ระบุชื่อ DB · ตรวจว่า job ใน FR-11 มีอยู่และ hash ตรง
- **FR-13 (health)** — `scripts/central-repl-user.sh <CODE> --status` แสดง `state` / `error_count` / `last_updated` ของ job FR-11 จาก `_scheduler/docs/_replicator` ของ central และ exit ≠ 0 เมื่อ state ไม่ใช่ `running`/`pending` · SETUP-CENTRAL.md ระบุให้ใส่ในการตรวจประจำวันของ central

### Requirements — edge

- **FR-14** — `scripts/edge-init.sh` ใช้ `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD` กับทุก job ฝั่ง central (`registry_pull`, `catalog_pull`, `<code>_pull`, `<code>_push`, `users_<code>_pull`) · ไม่อ่าน `CENTRAL_REPL_*` อีก
- **FR-15** — `users_<code>_pull` = source `$CEN/edge_users_<code>` → target `$LOC/_users` ไม่มี selector
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
- **FR-22** — หลัง deploy CR นี้ครบทุก edge: หมุนรหัส central admin (edge ที่ติดตั้งก่อนหน้ายังมีรหัสเก่าใน `.env`/`_replicator`) แล้วรัน `central-repl-user.sh <CODE>` ของทุกศูนย์ที่มี edge ให้ job FR-11 ใช้รหัสใหม่

## Acceptance

- **AC-1** — `.env` ของ edge และ doc ทุกตัวใน `_replicator` ของ edge ไม่มีรหัส central admin
- **AC-2** — ใช้ `repl_sh001_*` อ่าน `shelter_sh002`, `_users` ของ central, `edge_users_sh002` → 401/403
- **AC-3** — ใช้ `repl_sh001_*` เขียน `registry`, `catalog`, `edge_users_sh001` ของ central → 403
- **AC-4** — อ่าน `edge_users_sh001` แบบไม่ login และด้วย staff ของ SH001 → 401/403
- **AC-5** — ยิงรหัสผิดด้วย `repl_sh001_*` จนถูกล็อก → replication ของ SH002 ยังทำงาน
- **AC-6** — `central-repl-user.sh SH001 --remove` → job ของ SH001 หยุด (401) ส่วน SH002 ยัง sync ได้
- **AC-7** — sync สองทางของ `shelter_<code>` ครบทุก doc type (รวม `evacuee_qr`, doc ที่มี `created_by`, `daily_sop_role_assessment` ข้ามวัน) และ login ที่ edge ตอน WAN ล่ม ผ่าน checklist ใน SETUP-EDGE.md
- **AC-8** — user ที่ถูกถอด role หรือ soft delete ที่ central → login ที่ edge ไม่ได้ภายในเวลา sync ปกติ
- **AC-9** — edge ที่ติดตั้งก่อน CR นี้ เปลี่ยน credential + รัน `edge-init` ใหม่ → `_users` ของ edge ไม่มี conflict
- **AC-10** — `edge-init` ด้วย credential ที่เป็น admin → `FAILED` (FR-16)
- **AC-11** — unit test VDU FR-6–FR-8 ครอบ `repl:<CODE>` ตรงศูนย์, ต่างศูนย์, ไม่มี role · `scripts/tests/central-repl-user.test.sh` ครอบ FR-1–FR-4, FR-10–FR-12 บน CouchDB local (แบบเดียวกับ `edge-watchdog.test.sh`)

## Impact

- **ความเสี่ยง:** `edge_users_<code>` มี password hash ซ้ำอีกชุด — ตั้ง `_security` พลาดจะรั่วกว่าเดิม (กันด้วย FR-10 + FR-12) · job FR-11 หยุด = user ที่ควรหมดสิทธิ์ยัง login ที่ edge ได้ (กันด้วย FR-13)
- **ยอมรับ:** เครื่อง edge ที่ถูกขโมยยังเขียน `shelter_<code>` ของตัวเองได้ (ข้าม VDU ตาม FR-6) จนกว่า `--remove` · ข้อมูลในเครื่อง (`shelter_<code>`, password hash ของ staff ศูนย์นั้น) ยังอยู่ในมือคนขโมย → FR-21
- **ไม่เปลี่ยน:** EDGE_MODE, `edge-grant-sweep`, การเขียน `_users` ทั้งหมดยังทำที่ central ผ่าน `user-service.ts`
- **นอกขอบเขต:** เปลี่ยนชื่อ central admin บน staging/prod · reset password ทั้งศูนย์ในคำสั่งเดียว · เครื่องมือตรวจ revision ตามช่วงเวลา · เข้ารหัสดิสก์ edge · hard delete ใน `_users` ไม่ลง edge (เหมือนเดิม — CR-064 decision sync 2026-10-18)

## Migration

- ไม่ bump `schema_v`
- edge ที่ติดตั้งแล้ว (ยังไม่มีในศูนย์จริง — gate A2): `scripts/central-repl-user.sh <CODE>` ที่ central → ใส่ `EDGE_REPL_*` ใน `.env` ของ edge, ลบ `CENTRAL_REPL_*` → `docker compose -f docker-compose.edge.yml run --rm edge-init` (hash เปลี่ยน → job ถูกสร้างใหม่ตาม `stale`) → FR-22

## Decision log

- 2026-10-05 — OD-6 (CR-064): edge ใช้ central admin เป็น credential replication
- 2026-10-18 — decision sync: ทบทวน OD-6 ก่อนติดตั้ง edge ศูนย์ที่สอง หรือเมื่อเครื่อง edge หาย
- 2026-11-07 — PO เลือกข้อ 1 (replication user ต่อศูนย์) ใน #1165
- 2026-11-09 — kong: ทำข้อ 1 + 2 คู่กัน · บันทึกเป็น CR
- 2026-11-09 — proposed (#1298) · ตัวเลือกในร่าง: ตัว copy ใช้ `_replicator` ของ central แทนโค้ดใน `worker/` (FR-11) · ต่อยอด `scripts/central-repl-user.sh` แทนเขียนคำสั่งใหม่ (FR-1)
