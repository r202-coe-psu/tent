---
id: CR-126
extends: CR-123
title: ป้องกัน CouchDB ค้างเมื่อนำเข้าศูนย์พักพิงจำนวนมาก
status: approved
date: 2026-09-16
updated: 2026-09-17
requested_by: Dev Team B
decided_by: เจ้าของโครงการอนุมัติ
layer: volatile
scope:
  in_scope:
    - ระยะที่ 0: ตั้ง file descriptor limit ของ CouchDB container ใน compose ทุก variant
    - ระยะที่ 0: runbook เรื่อง descriptor scaling ที่ docs/sop/couchdb-file-descriptors.md
  out_of_scope:
    - ระยะที่ 1: แก้ query และการคำนวณสถานะ — เลื่อนออก; วิเคราะห์ไว้ในเอกสารนี้แล้วแต่ยังไม่ implement
    - ระยะที่ 2: แยกเอกสาร job/item ออกจาก registry — เลื่อนออก; วิเคราะห์ไว้ในเอกสารนี้แล้วแต่ยังไม่ implement
    - migration, security boundary, rollback และ test ของระยะที่ 1–2
    - การแก้ไขโค้ดทุกไฟล์ใน §ไฟล์ที่ต้องแก้ (ระยะที่ 1–2)
    - ระยะที่ 3: generic worker runtime, autoscaling และ distributed scheduler
    - การเพิ่ม Redis/PostgreSQL
    - การยกเลิกหรือลบศูนย์พักพิงที่สร้างสำเร็จแล้ว
affects:
  # แก้จริงใน change นี้ (ระยะที่ 0)
  - docker-compose.yml, docker-compose.staging*.yml, docker-compose.production*.yml — ulimits.nofile ของ service couchdb
  - docs/sop/couchdb-file-descriptors.md — runbook ใหม่ตาม FR-0-5
  # อ้างอิงไว้สำหรับระยะที่ 1-2 ซึ่งเลื่อนออก — ยังไม่แก้ในรอบนี้
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

> **สรุป (TL;DR)**
>
> - **สาเหตุของอาการค้างยืนยันแล้ว:** CouchDB container ใช้ `ulimit -n` ค่า default ของ Docker คือ `1024` เมื่อนำเข้าถึงศูนย์ที่ ~50 file descriptor เต็ม CouchDB ตอบ `EMFILE` และหยุดรับ connection — **ไม่ใช่** ผลจาก query pattern
> - **แนวทางแก้ไข (ระยะที่ 0):** ตั้ง `ulimits.nofile = 65536` ให้ service `couchdb` ใน compose ทุก variant ตาม [CouchDB performance docs](https://docs.couchdb.org/en/stable/maintenance/performance.html)
> - **ไม่ทำในรอบนี้:** ระยะที่ 1–2 (แก้ query O(N²) และแยก job/item ไป `shelter_import_queue`) **เลื่อนออกทั้งหมด** — ยังเป็นปัญหา scalability จริงแต่คนละเรื่องกับ file descriptor; บทวิเคราะห์คงไว้ในเอกสารนี้เพื่อใช้เป็นฐานของ change ถัดไป
> - **dev ต้อง build อะไร:** แก้ `ulimits.nofile` ในไฟล์ Docker Compose ตาม FR-0-1 (ภายใต้ข้อจำกัด FR-0-2, FR-0-3) และเพิ่ม runbook ตาม FR-0-5 — **ไม่มีการแก้โค้ด**
> - **กระทบ:** compose ทุก variant; ไม่กระทบ `schema_v`, field ของ doc ใด หรือ API contract

## ความสัมพันธ์กับ CR-123 และขอบเขต

เอกสารนี้เป็น amendment ของ [CR-123](CR-123-shelter-import-worker-pipeline.md) เฉพาะเรื่องความสามารถในการรองรับข้อมูลจำนวนมากและการแยกพื้นที่เก็บคิว โดย CR-123 ยังเป็นแหล่งอ้างอิงหลักของ template, column mapping, validation, duplicate policy, worker lifecycle และ audit log schema หากข้อความใดขัดกัน ให้ใช้กติกาต่อไปนี้:

- **ทำใน change นี้:** ระยะที่ 0 เท่านั้น — `ulimits.nofile` ของ CouchDB container ใน compose ทุก variant
- **เป็น design ไว้ก่อน (ยังไม่ implement):** ระยะที่ 1 และระยะที่ 2, migration, security boundary, query contract, counter recovery และ test ที่ระบุในเอกสารนี้ รวมถึงระยะที่ 3 เรื่อง generic runtime, backpressure แบบกระจาย, autoscaling และ scheduler กลาง
- **ไม่ทำ:** เพิ่ม Redis/PostgreSQL หรือเปลี่ยน Python `worker` ที่ทำ CouchDB → MongoDB projection ให้เป็น import worker
- เมื่อเจ้าของโครงการอนุมัติ ต้องปรับ `CR-123` และเอกสาร canonical ให้ไม่เหลือข้อความที่บอกว่า job/item อยู่ใน `registry` อย่างเดียว รวมถึงแก้ route worker จาก path เดิมเป็น `/api/internal/shelter-import/worker/next` ให้ตรงกับโค้ดปัจจุบัน

## เป้าหมายที่วัดผลได้

> **สถานะ: เลื่อนออก — เป็นเป้าหมายของระยะที่ 1–2.** ไม่ใช้ตัดสิน change นี้ ซึ่งวัดผลด้วย §เกณฑ์ยอมรับ › ของ change นี้ (ระยะที่ 0) เท่านั้น

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

- query สำหรับ claim ต้องคืนข้อมูลไม่เกิน `limit` ที่กำหนด และไม่มี `/_all_docs` หรือ `skip` แบบ offset ในเส้นทาง worker/provisioning ปกติ (`skip=1` สำหรับ cursor stepping ไม่นับ)
- ปริมาณข้อมูลที่อ่านรวมต้องเพิ่มตามจำนวนรายการแบบ O(N) ไม่ใช่ O(N²); ต่อการ claim ต้องอ่าน candidate แบบจำกัดขอบเขต ไม่ใช่ item ทั้งงาน
- target เริ่มต้นของ query claim และ query เลือก job คือ p95 ไม่เกิน `500 ms` ใน fixture ข้างต้น หากเครื่อง dev เล็กกว่านี้ ให้บันทึก baseline และให้เจ้าของโครงการอนุมัติ target ใหม่ก่อนเปลี่ยน acceptance
- Status API อนุญาตให้อ่านรายการของ job เดียวได้ครบตามจำนวนสูงสุด 1,000 แถว เพราะหน้าจอต้องแสดงผลรายแถว แต่ไม่ใช่เส้นทางที่ worker เรียกซ้ำต่อ item และต้องใช้ ETag/304 เมื่อไม่มีการเปลี่ยนแปลง

## เหตุผล

### อาการที่พบ

เมื่อนำเข้าศูนย์พักพิงหลายร้อยถึง 1,000 แถวใน dev/local โปรแกรม worker จะทำงานช้าลงมาก CouchDB ใช้ CPU/RAM สูง คำขอใช้เวลานานจนหมดเวลา และงานนำเข้าดูเหมือนค้าง แม้ข้อมูลบางแถวจะเขียนสำเร็จแล้ว

### สาเหตุที่ยืนยันแล้ว — file descriptor limit ของ CouchDB container

อาการ "ค้างกลางทางที่ประมาณแถวที่ 50" เกิดจาก CouchDB ใช้ file descriptor จนหมดโควตาของ OS ไม่ใช่จาก query pattern

หลักฐานจากการตรวจสอบ 2026-09-17:

| หลักฐาน | ค่าที่วัดได้ |
|---|---|
| `ulimit -n` ใน container `couchdb` | `1024` (ค่า default ของ Docker; ไม่มี compose variant ใดตั้งค่าไว้) |
| file descriptor ที่ `beam.smp` เปิดอยู่ขณะพัง | `1022 / 1024` |
| CouchDB log | `application: mochiweb, "Accept failed error", "{error,emfile}"` |
| error ที่ worker ได้รับ | `_security write failed (500): No DB shards could be opened.` ที่ `mergeShelterSecurity` |
| ผลของงานนำเข้า 56 แถว | สำเร็จ 49 แถว; แถว 49, 51–56 ล้มพร้อมกันหลังชนเพดาน |

กลไก: สถาปัตยกรรมนี้ใช้ **1 ศูนย์ = 1 database** แต่ละ shelter database กินไฟล์ `18` ไฟล์ (shard `2` + view index `16` ซึ่งมาจาก Mango index ของ referral `7` ตัว × `2` shard) ดังนั้นที่ ~50 ศูนย์จะใช้ ~900 ไฟล์ บวก database พื้นฐานและ socket แล้วทะลุ `1024`

ปัจจัยที่ทำให้ descriptor ไม่ถูกคืน: Python sync worker เปิด `_changes` แบบ `continuous` ค้างไว้ต่อ database (`worker/src/worker/couch/client.py`) ทุก shelter database จึงถูกนับเป็น recently-used ตลอดเวลา LRU ของ CouchDB จึงไม่ปิดและไม่คืน descriptor

คอนฟิกสองค่านี้ขัดกันเอง: `max_dbs_open` ของ image `couchdb:3.5.2` คือ `500` แต่ `ulimit -n` ที่ `1024` รองรับได้จริงเพียง ~56 database (ที่ `18` descriptor ต่อ database) CouchDB จึงเปิด database ต่อไปตามที่คอนฟิกอนุญาตจนกระทั่ง kernel ปฏิเสธ

> **หมายเหตุ:** ขณะเกิดเหตุ error ระดับ item ถูกแทนที่ด้วยข้อความคงที่ `'ประมวลผลศูนย์พักพิงไม่สำเร็จ'` โดยไม่มี log ฝั่ง server ทำให้สาเหตุนี้มองไม่เห็นจนกว่าจะเพิ่ม log — ข้อกำหนดเรื่อง server-side logging อยู่ใน FR-0-4 ซึ่ง**เลื่อนไประยะที่ 1–2** เพราะต้องแก้โค้ด

### สาเหตุรองที่ยังไม่ถูกแก้ — query และการจัดเก็บคิว

ข้อนี้ยังเป็นปัญหาจริงและ **ไม่ถูกลบล้าง** ด้วยการแก้ file descriptor แต่ไม่ใช่สาเหตุของอาการค้างที่พบในงาน 56 แถว

ปัจจุบันฐานข้อมูล `registry` ถูกใช้รวมกันทั้งข้อมูลหลักของศูนย์พักพิง งาน/รายการนำเข้า lock ตัวนับ และประวัติการทำงาน แล้วมีการอ่านข้อมูลทั้งหมดซ้ำในขั้นตอนที่ถูกเรียกบ่อย:

1. `listRunnableImportJobs()` อ่าน job ทั้งหมดเพื่อเลือกงานที่ยังทำได้
2. `claimNextImportItem()` อ่าน item ทั้งงานด้วย `_all_docs?include_docs=true` ทุกครั้งที่หยิบรายการ ถ้ามี N รายการจะอ่านซ้ำระดับ O(N²)
3. `listShelterMasters()` อ่านเอกสารทั้งหมดใน `registry` รวมข้อมูลคิวทุกครั้งที่ตรวจชื่อซ้ำ และถูกเรียกหลายครั้งต่อรายการ
4. `recomputeImportJob()` อ่าน item ทั้งชุดหลังเปลี่ยนสถานะทุกครั้ง
5. การเตรียมรายการนำเข้าเขียนทีละเอกสาร ทำให้มี network round-trip จำนวนมาก
6. การเก็บข้อมูลคิวปนกับข้อมูลหลักทำให้ query ที่ควรอ่านเฉพาะ shelter master ต้องผ่านเอกสารที่ไม่เกี่ยวข้อง และควบคุมสิทธิ์ได้ยากขึ้น

ปัญหาข้อนี้ทำให้ปริมาณงานเพิ่มขึ้นแบบกำลังสองเมื่อจำนวนแถวเพิ่มขึ้น และจะปรากฏชัดที่ระดับ 1,000 แถวตามเป้าหมายของ change นี้ แต่ต้องแยกจากสาเหตุ file descriptor ข้างต้น: การแก้ query อย่างเดียวจะไม่ทำให้งานนำเข้าผ่าน ~50 ศูนย์ได้ และการแก้ file descriptor อย่างเดียวก็ไม่ทำให้ query ที่เป็น O(N²) เร็วขึ้น — ต้องแก้ทั้งสองส่วน

## ระยะที่ 0 — file descriptor limit ของ CouchDB

### ข้อกำหนด

**Implementation requirement**

- **FR-0-1** — service `couchdb` ใน compose ทุก variant (`docker-compose.yml`, `docker-compose.staging*.yml`, `docker-compose.production*.yml`) ต้องกำหนด `ulimits.nofile` ทั้ง `soft` และ `hard` เป็น `65536`

```yaml
services:
  couchdb:
    ulimits:
      nofile:
        soft: 65536
        hard: 65536
```

**Architectural constraint**

- **FR-0-2** — ค่า `ulimits` ต้องอยู่ในไฟล์ compose ไม่ใช่ตั้งผ่าน `docker run` หรือ host config เพราะ container ไม่สืบทอด `/etc/security/limits.conf` ของ host
- **FR-0-3** — ถ้าภายหลังปรับ `nofile` เกิน `65536` ต้องตั้ง Erlang port limit `+Q` ใน `vm.args` ให้สูงกว่าค่านั้นด้วย มิฉะนั้นเพดานใหม่จะไม่มีผล (ค่าปัจจุบันไม่ได้ตั้ง `+Q` จึงอยู่ที่ default `65536`)

**Operational note**

- **FR-0-5** — สร้าง/ปรับ runbook ที่ `docs/sop/couchdb-file-descriptors.md` ระบุว่าจำนวน descriptor เพิ่มแบบเชิงเส้นตามจำนวนศูนย์พักพิง (~`18` descriptor + `1` continuous connection ต่อศูนย์) พร้อมวิธีตรวจ: เทียบ `docker exec <couchdb> sh -c 'ulimit -n'` กับจำนวน descriptor ที่เปิดอยู่จริง

> **หมายเหตุเรื่อง path:** `deployment/` ไม่ได้อยู่ใน repo — compose mount จาก `../deployment/` ซึ่งเป็น data directory บน host เอกสารปฏิบัติการจึงต้องอยู่ใน `docs/sop/`

**ID ที่ย้ายออก**

- **FR-0-4** — ย้ายไประยะที่ 1–2 (ดู §ระยะที่ 1–2 › ข้อกำหนดที่ย้ายมาจากระยะที่ 0) เพราะเป็น server-side logging ที่ต้องแก้โค้ดและอ้างถึง `job_id`/`item_id` ซึ่งยังไม่มีในระบบปัจจุบัน; หมายเลขนี้สงวนไว้ ไม่นำกลับมาใช้ซ้ำ

### อ้างอิง

[CouchDB — Maintenance › Performance › System Resource Limits](https://docs.couchdb.org/en/stable/maintenance/performance.html) ระบุตรงกับกรณีนี้:

> "On a system with many databases or many views, CouchDB can very rapidly hit this limit."

ค่าที่เอกสารกำหนดสำหรับแต่ละกลไก — systemd `LimitNOFILE=65536`, PAM `couchdb hard nofile 65536` / `couchdb soft nofile 65536`, shell `ulimit -n 65536` — โดย `ulimits.nofile` ใน compose คือกลไกเทียบเท่าสำหรับ container เอกสารยังระบุว่าระบบ UNIX สมัยใหม่รองรับ descriptor ระดับ `100000` ต่อ process ได้ ค่า `65536` จึงไม่ถือว่าสูงเกิน

### ข้อจำกัดที่ทราบ

`65536` แก้เพดานเฉพาะหน้า แต่ต้นทุนยังโตเชิงเส้นตามจำนวนศูนย์ (`18` descriptor + `1` continuous connection ต่อศูนย์) ที่ระดับ 1,000 ศูนย์ `max_dbs_open = 500` จะกลายเป็นคอขวดถัดไปแทน การลดจำนวน Mango index ที่สร้างซ้ำในทุก shelter database เป็นแนวทางที่ให้ผลมากที่สุด แต่อยู่นอก scope ของ change นี้

## โครงสร้างข้อมูลและเจ้าของข้อมูล

> **สถานะ: เลื่อนออก — ไม่ implement ใน change นี้.** เนื้อหาส่วนนี้เป็น design ที่วิเคราะห์ไว้แล้วสำหรับระยะที่ 1–2 เก็บไว้เป็นฐานของ change ถัดไป ห้ามใช้เป็น requirement ของรอบนี้

การแยก queue จะย้ายเฉพาะ job/item ไม่ย้ายเอกสารที่ใช้ร่วมกับ single-shelter API:

| ฐานข้อมูล | เอกสารที่เก็บ | ผู้เขียน | หมายเหตุ |
|---|---|---|---|
| `shelter_import_queue` | `shelter_import_job`, `shelter_import_item`, migration marker | SvelteKit server เท่านั้น | ฐานข้อมูลใหม่สำหรับคิวโดยเฉพาะ; เป็น transient/high-write ให้สร้างด้วย `q=1, n=1` บน dev/local เพื่อลด latency และจำนวน shard file |
| `registry` | `shelter:{ulid}`, `shelter_import_name_lock`, `shelter_counter` | server-side provisioning/admin + scoped registry reads | name lock และ code allocator ต้องใช้ร่วมกับ single-shelter API |
| `shelter_import_audit` | `shelter_import_log` | server-side admin เท่านั้น | private audit store; browser อ่านผ่าน SA-only BFF projection |
| `shelter_{code}` | ข้อมูลภายในศูนย์พักพิงและ seed | provisioning service | ไม่เปลี่ยน schema จาก CR-123 |

`shelter_import_job` และ `shelter_import_item` คงชื่อ field และ `schema_v` เดิมจาก CR-123 เพื่อให้ reader เดิมเข้าใจข้อมูลได้ การเปลี่ยน database เป็น storage migration ไม่ใช่การ bump `shelter` schema และไม่อนุญาตให้ worker รุ่นเก่าเขียน queue ใหม่หลัง cutover

### Contract ของ job และ item

| ประเภทเอกสาร | ID | ฟิลด์สำคัญ | กติกา |
|---|---|---|---|
| `shelter_import_job` | `shelter_import_job:<ulid>` | metadata, actor, duplicate policy, counters, status, attempt, audit marker, timestamps | สร้างหลัง stage item ครบ; `queued/running` คือ job ที่ worker มองเห็น |
| `shelter_import_item` | `shelter_import_item:<job_ulid>:<row_6_digits>` | validated `input`, row, status, attempts, lease, claim token, code, errors | status ของ item เป็นแหล่งข้อมูลจริงของความคืบหน้า; `input` ห้ามคืนให้ browser |
| `shelter_import_migration` | `shelter_import_migration:<job_ulid>` | source DB, target DB, state, count/hash, timestamps | marker สำหรับ migration ที่รันซ้ำได้; ไม่ใช่ job ที่ worker หยิบไปทำ |
| `shelter_import_log` | `shelter_import_log:<ulid>` | audit snapshot ต่อ terminal attempt | อยู่ `shelter_import_audit`, append-only, ใช้ schema_v 3 และ cap จาก CR-077 |
| `shelter_import_name_lock` | `shelter_import_name_lock:<normalized-name>` | owner, lease, updated_at | อยู่ `registry` เพราะใช้ร่วมกับ single-shelter API |
| `shelter_counter` | `counter:shelter` | value | อยู่ `registry`; อัปเดตด้วย `_rev` CAS และใช้ร่วมกับ single-shelter API |

ข้อกำหนดเพิ่มเติม:

- `imported_by` ต้องมาจาก server session ไม่รับจาก request body
- ข้อมูล `input` ต้องผ่าน server-side schema validation และไม่เก็บค่าที่ไม่จำเป็น
- `errors` ที่มาจาก client ให้ใช้ได้เฉพาะเป็นข้อมูลช่วย preview ที่ผ่าน schema จำกัดขนาด; error ที่บันทึกจริงต้องสร้างหรือยืนยันจาก server เพื่อป้องกันการปลอม audit/error message
- `results[]` ใน audit log นับ counters จากทุกแถว แต่เก็บรายละเอียดได้ไม่เกิน 200 แถว และข้อความไม่เกิน 200 ตัวอักษรตาม `docs/data/schema.md`

## Query และ index contract

> **สถานะ: นำไปปฏิบัติใน change นี้ (ระยะที่ 1)**

### Design doc ของ queue

เพิ่ม `frontend/src/lib/server/shelter-import-queue-design.ts` เพื่อสร้าง design doc ใน `shelter_import_queue` โดยต้องมี version แยกจาก `registry` และ deploy แบบ read-modify-write พร้อม `_rev` เช่นเดียวกับ design doc อื่น

การตั้งชื่อต้องตาม convention ของโครงการ (`.agents/skills/couchdb-bestpractices/SKILL.md` §View Naming and Query Conventions) ซึ่งแยกหน้าที่ของ design doc ออกจากกัน:

| Design doc | เก็บอะไร | หมายเหตุ |
|---|---|---|
| `_design/app` | view ทั้งหมดของ database | "All views live in one design doc per DB: `_design/app`" |
| `_design/access` | `validate_doc_update` | ตรงกับรูปแบบที่ `shelter_{code}` และ `registry` ใช้อยู่ |

ห้ามรวม view กับ `validate_doc_update` ไว้ใน design doc เดียวกัน และห้ามตั้งชื่ออื่นเช่น `_design/import` เพราะ lifecycle tooling (`deploy.ts`, `redeploy-access.ts`) อ้างอิงชื่อทั้งสองนี้

| View | Key | ใช้ทำอะไร | ขอบเขต |
|---|---|---|---|
| `jobs_by_runnable` | `[state, created_at, _id]` | เลือก job ที่ `queued`/`running` หรือรอ retry/audit repair | worker poll ใช้ `limit=20` และ keyset pagination |
| `items_by_job_row` | `[job_id, row]` | อ่านรายการของ job สำหรับ Status API | ใช้เฉพาะ status; อ่านได้ไม่เกิน 1,000 รายการ |
| `items_by_job_status_row` | `[job_id, status, row]` | เลือก item `pending` ทีละรายการ | worker claim ใช้ `limit=1` |
| `running_items_by_lease` | `[job_id, lease_until, row]` | หา `running` ที่ lease หมดอายุ | query ด้วยเวลาปัจจุบันและ `limit=1` |
| `items_by_job_status_count` | `[job_id, status]` + reduce `_count` | คำนวณ counters และ recovery | ใช้ `group=true`; ห้ามโหลด item docs ทั้งชุด |

ตัวอย่าง query ที่ implementation ต้องสร้างให้ได้ (แสดง key แบบอ่านง่ายก่อน URL-encode):

```text
GET /shelter_import_queue/_design/app/_view/jobs_by_runnable
    ?startkey=["queued",null,null]
    &endkey=["queued",{},{}]
    &include_docs=true&reduce=false&limit=20

GET /shelter_import_queue/_design/app/_view/items_by_job_status_row
    ?startkey=["shelter_import_job:01J...","pending",0]
    &endkey=["shelter_import_job:01J...","pending",{}]
    &include_docs=true&reduce=false&limit=1

GET /shelter_import_queue/_design/app/_view/running_items_by_lease
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

- ใช้ `limit` และ keyset pagination (`startkey` หรือ `startkey` + `startkey_docid`) ห้ามใช้ `skip` เป็น offset ขนาดใหญ่ เพราะ CouchDB ต้องเดินผ่านทุกแถวที่ข้าม — อนุญาตเฉพาะ `skip=1` สำหรับขยับ cursor ข้ามแถวสุดท้ายของหน้าก่อน (ต้นทุน O(1)) หรือกรองแถวแรกออกใน application code
- ตัวอย่างการ claim pending: query `items_by_job_status_row` ด้วย key ช่วง `[job_id, "pending", ...]` และ `limit=1`
- ตัวอย่างการ reclaim: query `running_items_by_lease` ถึง `lease_until <= now` และ `limit=1`; ค่า `now` ต้องสร้างจากเวลาปัจจุบันใน server และ worker ต้องอ่าน document จริงซ้ำก่อน PUT
- view ที่คืน candidate อาจล้าหลังได้ แต่ใช้เพื่อหา candidate เท่านั้น การตัดสินสิทธิ์ต้องอ่าน `_rev`, `claim_token`, `lease_until` แล้วทำ CAS; `409` ให้ข้ามและเริ่ม candidate ถัดไป
- หาก view/design หายหรือ version ไม่ตรง ให้ตอบ `503`/หยุด worker อย่างชัดเจน ห้าม fallback กลับไปอ่าน `registry` ทั้งฐานข้อมูล
- ถ้า queue database ใช้งานไม่ได้ ให้ fail closed และ backoff; ห้ามสลับไปอ่าน `registry` แบบเงียบ ๆ เพราะจะทำให้มี worker สองแหล่งประมวลผลงานเดียวกัน
- `listRunnableImportJobs()` ต้องไม่ใช้ `_all_docs`; ถ้ามี job จำนวนมากให้ใช้ cursor ต่อเนื่อง ไม่อ่าน job ทั้งฐานข้อมูลในแต่ละ poll
- `listShelterMasters()` อนุญาตเฉพาะ migration/repair ที่ระบุไว้เท่านั้น ขั้นตอนสร้าง shelter และ duplicate check ต้องใช้ `by_code`/`by_normalized_name`

## การเปลี่ยนสถานะและความถูกต้องของ counter

> **สถานะ: นำไปปฏิบัติใน change นี้ (ระยะที่ 1)**

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
7. การสร้าง audit log เป็นงานข้ามฐานข้อมูล: จอง `audit_log_id` ใน job ด้วย CAS, เขียน log append-only ใน `shelter_import_audit`, แล้ว mark `audit_logged`; ถ้าขั้นใดล้มให้ซ่อมต่อด้วย ID เดิมและไม่สร้าง log ซ้ำ

## Security และขอบเขตการเข้าถึง

> **สถานะ: นำไปปฏิบัติใน change นี้ (ระยะที่ 1)**

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

> **สถานะ: นำไปปฏิบัติใน change นี้ (ระยะที่ 1)**

- stage item ด้วย `_bulk_docs` ไม่เกิน 100 รายการหรือ 512 KiB ต่อ batch แล้วอ่านผลลัพธ์รายเอกสารทุกตัว
- `_bulk_docs` ไม่ใช่ transaction: ถ้าบางเอกสารล้ม ให้ retry เฉพาะเอกสารที่ยังไม่ยืนยันผลด้วย deterministic ID; ถ้า response หาย ให้ตรวจ ID เดิมก่อนเขียนซ้ำ
- สร้าง job ที่ `queued` หลัง item valid/invalid ถูก stage ครบเท่านั้น ถ้า stage ไม่ครบ ห้ามให้ worker เห็น job
- ถ้า cleanup item ที่เขียนค้างทำไม่สำเร็จ ต้องสร้าง metric/alert และมี `migrate-shelter-import-queue.ts` หรือ repair command ที่ล้างด้วย job ID เดิมได้
- ทุก HTTP 409 ต้องแยกเป็น concurrency conflict แล้ว re-read ตาม policy; 429/5xx/network timeout ให้ backoff จำกัดครั้ง; validation error และ permission error ห้าม retry แบบไม่จำกัด
- ถ้า queue database หรือ design deployment ล้มตอนสร้างงาน ให้ตอบ `503`/`409` ตามสาเหตุ และห้ามสร้าง job บางส่วนที่ worker มองเห็นได้

## การย้ายข้อมูลและ rollback

> **สถานะ: นำไปปฏิบัติใน change นี้ (ระยะที่ 1)**

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

### ไฟล์ที่แก้ใน change นี้ (ระยะที่ 0)

- `docker-compose.yml`, `docker-compose.staging.yml`, `docker-compose.staging.no-nginx.yml`, `docker-compose.production.yml`, `docker-compose.production.no-nginx.yml` — `ulimits.nofile` ของ service `couchdb` (FR-0-1)
- `docs/sop/couchdb-file-descriptors.md` — runbook ใหม่เรื่อง descriptor scaling และวิธีตรวจ (FR-0-5)

ไม่มีการแก้ไฟล์โค้ดใน change นี้ — มีเฉพาะไฟล์ config ของ compose และเอกสารปฏิบัติการ

### ข้อกำหนดที่ย้ายมาจากระยะที่ 0

> **สถานะ: เลื่อนออก — ไม่ implement ใน change นี้**

- **FR-0-4 (ย้ายมา)** — ความล้มเหลวระดับ item ต้องถูกบันทึกฝั่ง server พร้อม `job_id`, `row`, `item_id`, `code` และ error ต้นทาง; ข้อความที่ส่งให้ browser ยังคงเป็นข้อความทั่วไปตาม §Response projection
  - เหตุผลที่ย้าย: ต้องแก้โค้ดของ internal worker route และอ้างถึง `job_id`/`item_id` ซึ่งเป็น entity ของ CR-123 ที่ยังไม่ได้ implement จึงตรวจรับในระยะที่ 0 ไม่ได้
  - ที่มา: เหตุการณ์ 2026-09-17 error ระดับ item ถูกแทนที่ด้วยข้อความคงที่โดยไม่มี log ฝั่ง server ทำให้สาเหตุ `EMFILE` มองไม่เห็นจนกว่าจะเพิ่ม log

### ไฟล์ของระยะที่ 1–2 — เลื่อนออก ยังไม่แก้

> **สถานะ: เลื่อนออก — ไม่ implement ใน change นี้.** รายการด้านล่างเป็น design ไว้สำหรับ change ถัดไป

#### ไฟล์ระบบหลัก

- `frontend/src/lib/server/shelter-import-queue-design.ts` — design doc, views, version และ validation ของ queue
- `frontend/src/lib/server/registry-design.ts` — `by_normalized_name` และคง shelter/code views
- `frontend/src/lib/features/shelter-import/server/job-store.ts` — เปลี่ยน database client, bounded claim, reduce counter, bulk staging, migration compatibility และ audit repair
- `frontend/src/lib/server/shelters.admin.ts` — เพิ่ม lookup ตาม code/normalized name และกัน full scan ใน provisioning path
- `frontend/src/lib/features/shelter-import/application/queries.ts` — คง active-job ETag/backoff และ history changes feed ให้ถูก database
- `frontend/src/lib/features/shelter-import/data/import-log.remote.ts` — อ่าน audit log ผ่าน BFF จาก `shelter_import_audit` และคง response cap
- `frontend/src/lib/features/shelters/server/provisioner.ts` — ใช้ indexed duplicate lookup โดยยังใช้ name lock/code allocator จาก `registry`
- `frontend/src/lib/server/shelter-name-lock.ts` — ตรวจและทดสอบว่า lock ไม่ถูกย้ายไป queue จนทำให้ single-shelter API ใช้คนละ lock

#### Routes และ worker

- `frontend/src/routes/api/back-office/shelter-import/jobs/+server.ts` — admin auth, body limit, server validation และสร้าง job แบบ stage-then-publish
- `frontend/src/routes/api/back-office/shelter-import/jobs/[jobId]/+server.ts` — อ่าน queue status, ETag และ response projection
- `frontend/src/routes/api/back-office/shelter-import/jobs/[jobId]/retry/+server.ts` — retry เฉพาะ failed ตาม transition contract
- `frontend/src/routes/api/internal/shelter-import/worker/next/+server.ts` — private route, token auth, one-item processing และ error mapping
- `frontend/server/shelter-import-worker.mjs` — polling/backoff, timeout, worker ID และ graceful shutdown
- `nginx/nginx.conf` หรือ ingress policy ของ deployment — deny internal worker route จาก public plane หาก catch-all ยังส่งทุก path ไป frontend

#### Database, deployment และเอกสาร

- `frontend/scripts/seed.ts` และ `frontend/scripts/redeploy-access.ts` — สร้าง queue database, deploy design/security แบบ idempotent และตรวจ version
- `frontend/scripts/migrate-shelter-import-queue.ts` — migration, verification, marker และ repair command
- `docs/data/schema.md` — job/item queue contract, view keys, security และ retention
- `docs/data/data-model.md` — ownership/topology ของ queue กับ registry
- `docs/data/api-contract.md` — BFF, internal route, session และ failure boundary
- `docs/changes/CR-123-shelter-import-worker-pipeline.md` — อัปเดต amendment เรื่อง storage และ route ให้ไม่ขัดกัน
- `.env.example`, `frontend/.env.example` และ compose ทุก variant — queue DB name, worker token และ internal-only network wiring

## อายุข้อมูลและการล้างข้อมูล

> **สถานะ: เลื่อนออก — ไม่ implement ใน change นี้.** เนื้อหาส่วนนี้เป็น design ที่วิเคราะห์ไว้แล้วสำหรับระยะที่ 1–2 เก็บไว้เป็นฐานของ change ถัดไป ห้ามใช้เป็น requirement ของรอบนี้

- job/item ที่ terminal แล้วล้างหลัง 30 วัน โดย cleanup ต้องตรวจ `finished_at`, database ที่ถูกต้อง และไม่ลบงาน `queued/running`
- audit log อยู่ `shelter_import_audit` และเก็บตาม audit-retention policy ของโครงการ อย่างน้อย 365 วันจนกว่าจะมี policy กลางที่อนุมัติตัวเลขอื่น
- cleanup ใช้ server-side credential ที่ได้รับอนุญาตเท่านั้น ทำงานแบบ idempotent และบันทึกจำนวนเอกสารที่ลบ/ล้มเหลว
- ห้ามลบ audit log เพื่อแก้ counter และห้าม cleanup เอกสารที่มี migration marker แต่ยังตรวจสอบไม่เสร็จ

## เกณฑ์ยอมรับ

### ของ change นี้ (ระยะที่ 0)

- [ ] compose ทุก variant ตั้ง `ulimits.nofile` เป็น `65536` และ `docker compose config --quiet` ผ่านทุกไฟล์
- [ ] `docker exec <couchdb> sh -c 'ulimit -n'` คืนค่า `65536` หลัง recreate container
- [ ] นำเข้าชุดข้อมูลที่เกินเพดานเดิม (>50 ศูนย์ เช่น 70–100 ศูนย์) ไม่เกิด `EMFILE` หรือ `No DB shards could be opened` และจำนวน descriptor ที่เปิดอยู่ไม่ถึงเพดานตลอดงาน
- [ ] มี runbook ที่ `docs/sop/couchdb-file-descriptors.md` ตาม FR-0-5

### ของระยะที่ 1 — นำไปปฏิบัติใน change นี้

> **สถานะ: นำไปปฏิบัติใน change นี้ (ระยะที่ 1)**

- [ ] ความล้มเหลวระดับ item ปรากฏใน server log พร้อม `job_id`, `row`, `item_id` และ error ต้นทาง โดย response ที่ส่งให้ browser ไม่มีรายละเอียดภายใน (FR-0-4 ที่ย้ายมา)
- [ ] นำเข้า 1,000 แถวไม่เกิด `EMFILE` และผ่าน target latency ตาม §เป้าหมายที่วัดผลได้ — ทดสอบได้เมื่อ worker pipeline ของ CR-123 พร้อม เพราะเส้นทางปัจจุบัน (browser loop ของ CR-039) จะติด HTTP timeout ก่อนถึงเพดาน descriptor

- [ ] งาน 1,000 แถวตอบ `202 + jobId` หลัง stage ครบ โดยไม่รอ provisioning ทั้งงาน และปฏิเสธ request ที่เกิน 1,000 แถวหรือ 5 MiB
- [ ] worker poll ไม่อ่าน job ทั้งฐานข้อมูล; query ใช้ `jobs_by_runnable`, `limit` และ keyset pagination
- [ ] การ claim ใช้ `items_by_job_status_row` หรือ `running_items_by_lease`, คืน candidate ไม่เกิน 1 รายการ และไม่ใช้ `_all_docs` หรือ `skip` แบบ offset ใน hot path
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

### ของ change นี้ (ระยะที่ 0)

```bash
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.staging.yml config --quiet
docker compose -f docker-compose.staging.no-nginx.yml config --quiet
docker compose -f docker-compose.production.yml config --quiet
docker compose -f docker-compose.production.no-nginx.yml config --quiet
docker compose up -d couchdb && docker exec couchdb sh -c 'ulimit -n'   # ต้องได้ 65536

# ตรวจ descriptor ที่เปิดอยู่จริงเทียบเพดาน หลัง provision >50 ศูนย์
docker exec couchdb sh -c 'P=$(pgrep beam.smp | head -1); echo "$(ls /proc/$P/fd | wc -l) / $(ulimit -n)"'
```

การตรวจรับระยะที่ 0 ใช้ชุดข้อมูล >50 ศูนย์ (เกินเพดานเดิม) ไม่ใช่ 1,000 แถว เพราะเส้นทางนำเข้าปัจจุบันเป็น browser loop ของ CR-039 ซึ่งจะติด HTTP timeout ก่อนถึงเพดาน descriptor; การทดสอบระดับ 1,000 แถวทำได้เมื่อ worker pipeline ของ CR-123 พร้อม หรือทำผ่าน script จำลอง provisioning

### ของระยะที่ 1–2 — เลื่อนออก

> **สถานะ: เลื่อนออก.** ไม่ใช้ตัดสิน change นี้

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
- 2026-09-17 — proposed: ยืนยันสาเหตุของอาการค้างเป็น file descriptor limit (`EMFILE` ที่ `ulimit -n = 1024`) ไม่ใช่ query pattern; แก้ข้อความเดิมที่ระบุว่าปัญหาไม่ได้อยู่ที่การตั้งค่า CouchDB
- 2026-09-17 — proposed: เพิ่มระยะที่ 0 ตั้ง `ulimits.nofile = 65536` ใน compose ทุก variant ตาม CouchDB performance docs; ใช้ compose แทน host limit เพราะ container ไม่สืบทอด `limits.conf` ของ host
- 2026-09-17 — proposed: คงระยะที่ 1–2 ไว้ตามเดิม เพราะ query O(N²) เป็นปัญหาคนละตัวที่ยังไม่ถูกแก้ด้วยระยะที่ 0
- 2026-09-17 — proposed: บันทึกว่า `max_dbs_open = 500` จะเป็นคอขวดถัดไปที่ระดับ 1,000 ศูนย์; การลด Mango index ต่อ shelter database อยู่นอก scope
- 2026-09-17 — proposed: **ลด scope เหลือระยะที่ 0 เท่านั้น** ระยะที่ 1–2 เลื่อนออกและไม่แก้โค้ดใด ๆ ใน change นี้; เหตุผลคือระยะที่ 0 แก้สาเหตุที่ยืนยันแล้วของอาการค้าง ส่วนระยะที่ 1–2 เป็นงาน scalability ที่ยังไม่มีหลักฐานว่าเป็นสาเหตุของอาการที่รายงาน จึงควรแยกประเมินและอนุมัติต่างหาก
- 2026-09-17 — proposed: คงบทวิเคราะห์ของระยะที่ 1–2 ไว้ในเอกสารนี้ทั้งหมด (ติดป้าย "เลื่อนออก") แทนการลบ เพื่อไม่ให้ต้องวิเคราะห์ซ้ำใน change ถัดไป
- 2026-09-17 — proposed: แก้ชื่อ design doc ของ `shelter_import_queue` จาก `_design/import` เป็น `_design/app` (view) + `_design/access` (`validate_doc_update`) ตาม `couchdb-bestpractices` §View Naming and Query Conventions; เดิมรวมทั้งสองหน้าที่ไว้ใน design doc เดียวซึ่งขัด convention
- 2026-09-17 — proposed: ระบุให้ชัดว่าข้อห้ามเรื่อง `skip` หมายถึง offset ขนาดใหญ่เท่านั้น `skip=1` สำหรับขยับ cursor ใน keyset pagination ยังใช้ได้
- 2026-09-17 — proposed: คงคีย์ `running_items_by_lease` เป็น `[job_id, lease_until, row]` ตามเดิม ไม่เปลี่ยนเป็นคีย์ระดับคิวตามที่ review เสนอ; ถือเป็นการปรับแต่งภายในที่ทำได้ภายหลังโดยไม่กระทบ scope ของระยะที่เลื่อนออก
- 2026-09-17 — proposed: กำหนดให้ `shelter_import_queue` บน dev/local ใช้ `q=1, n=1`
- 2026-09-17 — proposed: ย้าย FR-0-4 (server-side item logging) ออกจากระยะที่ 0 ไประยะที่ 1–2 เพราะต้องแก้โค้ดและอ้าง `job_id`/`item_id` ของ CR-123 ที่ยังไม่ implement — ขัดกับหลักการ "ระยะที่ 0 ไม่แก้โค้ด"; สงวนหมายเลข FR-0-4 ไม่นำกลับมาใช้ซ้ำ
- 2026-09-17 — proposed: เปลี่ยนเกณฑ์ตรวจรับระยะที่ 0 จาก "นำเข้า 1,000 แถว" เป็น ">50 ศูนย์ (70–100)" เพราะเส้นทางนำเข้าปัจจุบัน (browser loop ของ CR-039) ติด HTTP timeout ก่อนถึงเพดาน descriptor จึงพิสูจน์ระยะที่ 0 ไม่ได้
- 2026-09-17 — proposed: ย้าย runbook ของ FR-0-5 จาก `deployment/` เป็น `docs/sop/couchdb-file-descriptors.md` เพราะ `deployment/` เป็น data directory บน host ที่ compose mount จาก `../deployment/` ไม่ได้อยู่ใน repo
- 2026-09-17 — approved: เจ้าของโครงการอนุมัติลด scope เหลือระยะที่ 0 เท่านั้น และกำหนดหมายเลขเป็น CR-126
