---
id: CR-051
title: Shelter Map/Reduce lifecycle ทุก module เชื่อมต่อ CI/CD
status: proposed
date: 2026-07-27
requested_by: Team B (เสนอ PO)
decided_by: project owner
layer: stable
affects:
  - CR-020 Back-office Dashboard API Architecture
  - Jenkinsfile
  - frontend/package.json
  - frontend/src/lib/features/shelters/domain/views.ts
  - frontend/src/lib/features/shelters/server/deploy.ts
  - frontend/src/lib/features/shelters/domain/view-modules.ts
  - frontend/src/lib/features/shelters/server/view-lifecycle.ts
  - frontend/scripts/deploy-shelter-views.ts
  - Map/Reduce manifests ของทุก shelter module
  - frontend/src/routes/api/back-office/shelter/[code]/dashboard/*
  - frontend/src/routes/api/back-office/shelter/+server.ts
  - frontend/scripts/
  - frontend/CONVENTIONS.md §5
  - docs/data/schema.md §7
  - docs/data/data-model.md §4
  - docker-compose.staging.no-nginx.yml
  - docker-compose.production.no-nginx.yml
---

# CR-051 — Shelter Map/Reduce lifecycle ทุก module เชื่อมต่อ CI/CD

## TL;DR สำหรับ PO

เสนอให้จัดการ CouchDB Map/Reduce View ของทุก module ใน shelter เป็น deployment artifact
ที่มี version และ lifecycle ชัดเจน ไม่ผูกอยู่กับการสร้าง shelter หรือการ seed เท่านั้น
Dashboard จะเป็น pilot แรก และใช้ stable Design Document ชื่อ `_design/dashboard`

เมื่อ source ของ module ใดเปลี่ยน CI/CD ต้อง deploy เฉพาะ Design Document ของ module นั้น
ไปยัง shelter database ทุกแห่งบน CouchDB ส่วนกลาง ตรวจสอบว่า View พร้อมใช้งาน แล้วจึง
deploy application โดยเก็บ previous stable definition ไว้หนึ่งรุ่นสำหรับ rollback และลบ candidate
ที่ promote สำเร็จแล้วออกจาก CouchDB

แนวทางเป้าหมายคือ:

```text
validate → deploy candidate ของ module ที่เปลี่ยน → warm/verify ทุก shelter database
         → promote ไปยัง _design/{module}
         → deploy application → smoke test → retain previous รุ่นเดียวไว้สำหรับ rollback
```

การเปลี่ยนแปลงนี้แก้ปัญหาที่ source code ถูก deploy แล้ว แต่ `_design/app` ใน shelter เดิมยังเป็น
revision เก่า ทำให้แต่ละศูนย์อาจใช้ Map/Reduce business rule คนละรุ่น โดย `_design/app` ถือเป็น
legacy document หลังจาก Dashboard ย้าย consumer ไปอ่าน `_design/dashboard`

ขอบเขตที่ตกลงใน CR นี้:

- lifecycle engine รองรับทุก Map/Reduce module ที่อยู่ใน `shelter_*`
- แต่ละ module มี Design Document และ ownership ของตนเอง เช่น `_design/dashboard`,
  `_design/inventory`, `_design/kitchen` และ `_design/donations`
- deploy เฉพาะ module ที่ manifest เปลี่ยน ไม่ rewrite ทุก Design Document ทุก release
- Dashboard เป็น module แรกที่ย้ายจาก `_design/app` ไป `_design/dashboard`
- View ที่ยังไม่มี implementation จริงจะเข้าระบบเมื่อ module นั้นมี manifest พร้อม ไม่สร้าง
  View จากรายการในเอกสาร spec โดยอัตโนมัติ

## 1. ปัญหาปัจจุบัน

### 1.1 Source code กับ View ที่ใช้งานจริงมี lifecycle แยกกัน

Map/Reduce definition อยู่ที่:

```text
frontend/src/lib/features/shelters/domain/views.ts
```

แต่ View ที่ Dashboard ใช้งานจริงเป็น Design Document ที่ persist อยู่ใน CouchDB ของแต่ละศูนย์:

```text
shelter_<code>/_design/app
```

การแก้ `views.ts`, build application และ restart container ไม่ได้ทำให้ Design Document ของ
shelter เดิมเปลี่ยนตามโดยอัตโนมัติ

นี่คือ root cause ของปัญหาในปัจจุบัน: เมื่อแก้ Map/Reduce ใน code แล้ว shelter ที่เคย deploy
ไปก่อนหน้านั้นยังถือ Design Document และ revision เดิมอยู่ จึงไม่ update ตาม source code
จนกว่าจะมีการ PUT Design Document รุ่นใหม่เข้าไปที่ shelter database นั้น ๆ

ผลที่ตามมาคือ หากมี shelter หลายแห่ง จะต้องมีขั้นตอน redeploy View วนไปทุก shelter ที่มีอยู่
ไม่เช่นนั้นแต่ละ shelter อาจใช้ Map/Reduce logic คนละรุ่น แม้จะรัน application release เดียวกัน

### 1.2 จุดที่ deploy View ปัจจุบันยังไม่ครอบคลุม lifecycle

ปัจจุบัน `deployShelterViewsFn` ถูกเรียกในกรณีหลัก:

1. สร้าง shelter ใหม่
2. seed ฐานข้อมูลตัวอย่าง

ยังไม่มีคำสั่งมาตรฐานที่วน deploy ไปยัง shelter database ที่มีอยู่แล้วทุกแห่ง

### 1.3 CI/CD ปัจจุบัน deploy เฉพาะ application container

`Jenkinsfile` ปัจจุบันทำงานโดย SSH เข้า server แล้วรัน:

```text
git pull
docker compose ... up -d --build --force-recreate
```

จึงไม่มีขั้นตอน:

- ตรวจว่า Map/Reduce source เปลี่ยนหรือไม่
- deploy Design Document ไปยังทุก shelter
- warm View index
- verify ผลลัพธ์
- บันทึกว่า shelter ใดใช้ View version ใด
- rollback View ให้สอดคล้องกับ application version

### 1.4 Runtime image ไม่เหมาะสำหรับรัน migration โดยตรง

`frontend/Dockerfile.prod` copy เฉพาะ application build และ `package.json` เข้า runtime image
ไม่มี TypeScript source, `tsx` และ dependencies ที่ใช้รัน script แบบ `pnpm ...`

ดังนั้น pipeline ไม่ควรสมมติว่าสามารถ `docker compose exec frontend pnpm ...` ได้ทันที
ต้องมี migration runner ที่ถูก build และกำหนดหน้าที่แยกต่างหาก

### 1.5 PoC script สำหรับ redeploy View

เพื่อพิสูจน์ lifecycle ก่อนผูกเข้ากับ Jenkins จะเพิ่มคำสั่ง:

```text
pnpm deploy:shelter-views --module dashboard
```

ค่าเริ่มต้นเป็น dry-run และรองรับการ deploy Dashboard stable document ผ่าน:

```text
TENT_ENV=staging pnpm deploy:shelter-views --module dashboard --environment staging --write --confirm
```

โหมด `--design dashboard` จะ deploy Dashboard Views ไปยัง `_design/dashboard` ซึ่งเป็น target
ที่ consumer ปัจจุบันใช้งานแล้ว ส่วน `--design app` เป็น compatibility mode สำหรับซ่อมหรือ
rollback Design Document เดิมเท่านั้น และจะ merge View ของ module อื่นไว้เหมือนเดิม

ความหมายของ target ที่ใช้กับ script มีดังนี้:

| คำสั่ง                                 | Design Document ที่เขียน                                                   | ผลต่อ API ปัจจุบัน                                                 |
| -------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `--design dashboard --write --confirm` | `_design/dashboard` ของ Dashboard                                          | ใช้กับ consumer ปัจจุบัน หลัง deploy สำเร็จและ verify แล้ว         |
| `--design app --write --confirm`       | `_design/app` เดิม โดย merge Dashboard Views และรักษา View ของ module อื่น | ใช้เฉพาะ compatibility/rollback; consumer ใหม่ไม่อ่าน document นี้ |

การรัน script ไม่ได้เปลี่ยน consumer code หรือสลับชื่อ Design Document เอง แต่ target ที่ระบุ
ด้วย `--design` จะเป็นจุดที่ถูกเขียน สำหรับ shelter เดิมต้อง deploy และ verify `_design/dashboard`
ให้ครบก่อนใช้งาน consumer ที่เปลี่ยนแล้ว

PoC รอบนี้วนเฉพาะ shelter database ที่อ่านได้จาก `registry` บน CouchDB ส่วนกลาง ไม่แตะ
replication topology และไม่ใช่ replica orchestrator (ดู §3.5 และ §9)

## 2. เป้าหมาย

- shelter database ทุกแห่งใช้ View version ของแต่ละ module ที่ตรงกับ release
- View deployment ทำซ้ำได้โดยไม่ทำให้ข้อมูลหรือ View ของ module อื่นสูญหาย
- application ไม่ถูกสลับไปใช้ View ใหม่ก่อน View พร้อม
- pipeline ระบุ shelter ที่ deploy หรือ verify ล้มเหลวได้
- rollback application แล้วสามารถกลับไปอ่าน View definition รุ่นก่อนหน้าได้
- credential ของ CouchDB อยู่ใน CI/CD secret store และไม่ปรากฏใน source/log
- shelter ที่สร้างใหม่ได้รับ active View version เดียวกับ production

## 3. ข้อเสนอเชิงสถาปัตยกรรม

### 3.0 สองเรื่องที่ต้องไม่ปนกัน: การตั้งชื่อ/แยก Design Document กับ lifecycle runner

CR นี้เสนอสองเรื่องที่แก้ปัญหาต่างกัน ตัดสินใจแยกกันได้ และมีเหตุผลของตัวเอง เอกสารส่วนที่เหลือ
จะอ้างสองเรื่องนี้ตามชื่อด้านล่าง

| เรื่อง                                                                              | แก้ปัญหาอะไร                                                                                                  | ไม่ได้แก้อะไร                               | ขึ้นกับอีกเรื่องหรือไม่                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------- |
| **A. Design Document granularity** — แยก `_design/{module}` แทน `_design/app` เดียว | blast radius: การแก้ View ของ module หนึ่งไปทำให้ index ของ module อื่น rebuild และ deploy ชนกัน              | ไม่ได้ทำให้ shelter เดิมได้ definition ใหม่ | ไม่ — ทำได้โดยไม่มี runner (deploy มือ) |
| **B. Lifecycle runner** — `deploy:shelter-views` + candidate/warm/promote/verify    | root cause ของ CR นี้: shelter เดิมค้าง Design Document revision เก่า เพราะ deploy application ไม่แตะ CouchDB | ไม่ได้ลด blast radius ถ้ายังอยู่ ddoc เดียว | ไม่ — ทำได้กับ `_design/app` เดียวก็ได้ |

ประเด็นสำคัญสำหรับ PO: **A ไม่ใช่คำตอบของปัญหาใน §1.1 และ B ไม่ใช่คำตอบของ blast radius**
ถ้าอนุมัติแค่ B ปัญหาปัจจุบันหายไปแต่การแก้ View ยัง rebuild ยกชุด; ถ้าอนุมัติแค่ A ทุก module แยกกัน
สะอาดแต่ shelter เดิมยังค้างรุ่นเก่าเหมือนเดิม CR นี้เสนอทั้งสอง โดยให้ A เป็นเงื่อนไขของ
acceptance gate ราย module และ B เป็นกลไกบังคับใช้

#### 3.0.1 เหตุผลของ A — ทำไมไม่ยัดทุก View ลง `_design/app` เดียว

CouchDB คิด view-group signature จาก definition ของ **ทุก View ใน Design Document เดียวกัน** ผลคือ:

- แก้ View ของ module เดียว → signature ของทั้งกลุ่มเปลี่ยน → **index ของทุก View ใน ddoc นั้น
  rebuild จากศูนย์** รวม View ของ module ที่ไม่ได้แตะ ระหว่าง rebuild consumer ต้องรอหรือยอมรับ
  ข้อมูล stale — ในโครงการที่ spec ยังเปลี่ยนบ่อย หมายถึง Dashboard ดับเพราะทีมอื่นแก้ View ของตัวเอง
- ddoc เดียวมีหลายเจ้าของ → ทุก module ต้อง read-modify-write document เดียวกัน เกิด `409` เวลา deploy
  พร้อมกัน และต้องมี merge logic ถาวร
- ddoc เดียวมี `_rev` เดียว → rollback ราย module ทำไม่ได้ rollback Dashboard = rollback View ของทุก module

ต้นทุนของการแยก (ยอมรับแล้ว): มี Design Document N ตัว = CouchDB ส่ง document ทุกใบเข้า view server
N รอบตอน build index → CPU/IO และ disk เพิ่มเชิงเส้นตามจำนวน module ที่ N ประมาณ 4
(dashboard/inventory/kitchen/donations) และ shelter database เป็นระดับต่อศูนย์ ต้นทุนนี้ต่ำกว่าความเสี่ยง
ที่ Dashboard rebuild ทุกครั้งที่ module อื่นขยับ

#### 3.0.2 กติกา granularity — หยุดที่ 1 Design Document ต่อ module

- **ห้ามแยกละเอียดกว่า module** (เช่น ddoc ต่อ View) เพราะจ่ายต้นทุน N× โดยไม่ได้ประโยชน์เพิ่ม
- View อยู่ Design Document เดียวกันได้เมื่อเข้าเกณฑ์ทั้งสองข้อ: (ก) อ่าน document type ชุดเดียวกัน
  และ (ข) เปลี่ยนไปพร้อมกันตามรอบงานของ module เดียวกัน
- View 4 ตัวของ Dashboard (`occupancy`, `demographics_by_age`, `demographics_by_country`,
  `registrations_by_date_status`) เข้าเกณฑ์ทั้งสองข้อ จึงอยู่ `_design/dashboard` ก้อนเดียว
- module ใหม่ที่ยังไม่มี View จริงไม่ต้องจอง Design Document ล่วงหน้า

#### 3.0.3 เหตุผลของ B — ทำไมต้องมี runner แม้จะแยก ddoc แล้ว

การแยก ddoc ไม่ได้เขียน Design Document ใหม่ลง shelter database ที่ deploy ไปแล้ว ต้องมีคำสั่งที่
วน deploy + warm + verify ครบทุก shelter database และรายงานผลรายศูนย์ ตามที่กำหนดใน §3.3 และ §4
โดย runner ต้องรับ manifest จาก A เป็น input (`--module`) จึง deploy เฉพาะ module ที่เปลี่ยนได้

### 3.1 แยก ownership เป็น Design Document ราย module

ใช้ชื่อ stable Design Document รูปแบบ:

```text
_design/{module}
```

ตัวอย่าง:

```text
_design/dashboard
_design/inventory
_design/kitchen
_design/donations
```

Dashboard ใช้ `_design/dashboard` และมี View เช่น:

- `occupancy`
- `demographics_by_age`
- `demographics_by_country`
- `registrations_by_date_status`

ระหว่าง rollout ใช้ Design Document ชั่วคราว:

```text
_design/dashboard__next_<hash>
_design/dashboard__prev_<version>
```

เมื่อ candidate warm และ verify แล้ว จึง promote executable definition เดียวกันไปยัง
`_design/dashboard` จากนั้นลบ candidate และเก็บ previous stable ไว้เพียงหนึ่งรุ่น
เพื่อ rollback; หาก cleanup ล้มเหลวให้รายงาน `cleanup_pending` และทำ cleanup ซ้ำเป็นงานแยกได้

เหตุผลที่แยก Design Document ราย module:

- module เปลี่ยนและ deploy แยกกันได้
- warm และ verify index รุ่นใหม่ก่อนเปิดใช้
- rollback ไปใช้ previous definition ได้
- ลดการ rebuild View group ที่ไม่เกี่ยวข้อง เพราะ View ใน Design Document เดียวกันอยู่ใน
  view group เดียวกัน
- ownership ชัดเจนและไม่เขียนทับ View ของ module อื่น

`_design/app` เดิมยังคงไว้ระหว่าง migration และจะไม่ถูกลบใน deployment รอบเดียวกัน

### 3.2 เพิ่ม View manifest

แต่ละ module ต้องมี manifest เป็น source of truth เช่น:

```ts
{
  module: "dashboard",
  designName: "dashboard",
  version: 2,
  hash: "<sha256-of-canonical-view-definition>",
  views: { ... }
}
```

กติกา:

- เปลี่ยน logic หรือ key contract ของ View ต้องเพิ่ม module version
- การแก้ที่ไม่เปลี่ยน output contract อาจคง version แต่ hash ต้องเปลี่ยน
- pipeline ต้องตรวจว่า module manifest ใดเปลี่ยน และ deploy เฉพาะ module นั้น
- pipeline ต้องบันทึก module, version, hash และ Git commit ที่ deploy
- application query stable path `_design/{module}` และตรวจ compatibility จาก manifest
- provisioning shelter ใหม่ต้องใช้ manifest เดียวกับ migration runner

### 3.3 เพิ่ม migration runner แยกจาก frontend runtime

PoC ใช้คำสั่งกลางนี้:

```text
pnpm deploy:shelter-views --module dashboard --json
TENT_ENV=staging pnpm deploy:shelter-views --module dashboard --environment staging --write --confirm
pnpm deploy:shelter-views --module dashboard --verify --json
```

การเลือก module จาก Git ด้วย `--changed-since` ยังไม่อยู่ใน PoC นี้ และต้องทำเป็นงานต่อยอดก่อน
นำไปใช้เป็น CI/CD gate จริง ส่วน `--all` ใช้สำหรับรันทุก module ที่มี manifest; ไม่ใช้
`--module all` ปะปนกัน

runner ต้อง:

1. อ่าน shelter master จาก `registry`
2. สร้างชื่อ database ด้วย utility กลาง ไม่ประกอบชื่อแบบกระจัดกระจาย
3. ตรวจว่า shelter database มีอยู่จริง
4. deploy เฉพาะ Design Document จาก manifest ที่เลือก
5. ใช้ `_rev` สำหรับการ update Design Document version เดิม
6. retry แบบ bounded เมื่อเกิด `409 Conflict` หรือ network error ชั่วคราว
7. warm View โดย query ด้วย `limit=0` หรือ query ที่กำหนด
8. verify version/hash และ query contract
9. สรุปผลราย shelter เป็น machine-readable report
10. exit non-zero เมื่อมี failure

runner ควรถูก package เป็น one-shot migration image หรือ executable artifact แยกจาก
frontend runtime เพื่อให้ CI/CD เรียกใช้ version เดียวกับ release ได้

### 3.4 เก็บ deployment state แยกจาก business data

บันทึกผล deployment อย่างน้อย:

```json
{
  "shelter_code": "SH001",
  "database": "shelter_sh001",
  "module": "dashboard",
  "design_name": "dashboard",
  "version": 2,
  "hash": "...",
  "git_commit": "...",
  "deployed_at": "...",
  "verified_at": "...",
  "status": "verified"
}
```

ข้อมูลนี้อาจอยู่ใน pipeline artifact หรือ deployment registry กลาง โดยไม่จำเป็นต้องเพิ่ม
business document ลงในทุก shelter database

### 3.5 ขอบเขต endpoint — CR นี้ทำเฉพาะ CouchDB ส่วนกลาง

CR นี้แก้เฉพาะปัญหาใน §1.1 คือ **shelter database ที่ CouchDB ส่วนกลางค้าง Design Document รุ่นเก่า**
runner วนเฉพาะ `shelter_*` ที่อ่านได้จาก `registry` บน endpoint เดียวที่กำหนดด้วย
`COUCHDB_ADMIN_URL` เท่านั้น

**เรื่อง edge/replica ต่อศูนย์ไม่อยู่ใน CR นี้** — ยังไม่ออกแบบ endpoint discovery, replication
policy, สถานะ `pending` ของ edge ที่ offline หรือ reconciliation job ทั้งหมดนั้นจะแยกเป็น CR ใหม่
เมื่อ topology ของศูนย์ชัดเจน (ดู §9)

ข้อเท็จจริงของ CouchDB ที่ต้องจำไว้ตอนออกแบบ CR นั้นในอนาคต เพราะเป็นจุดที่คนพลาดบ่อย:

- **Design Document replicate ได้เหมือน document ปกติ แต่ view index ไม่ replicate** —
  index เป็น local derived state ของแต่ละ node/shard และ CouchDB จะ build ตามการ query เท่านั้น
- ดังนั้นการเห็น `_design/{module}` ปรากฏที่ปลายทางแล้ว **ไม่ได้แปลว่า View พร้อมใช้** ยังต้อง
  warm ที่ CouchDB ตัวที่รับ request จริงอยู่ดี — เหตุผลเดียวกับที่ Stage D ต้อง warm ไม่ใช่แค่ verify hash

## 4. CI/CD lifecycle ที่เสนอ

### Stage A — Validate

ทำก่อนแตะ environment:

1. lint/type-check source
2. unit test Map function, Reduce contract และ key shape
3. ตรวจ module manifest version/hash และรายการ module ที่เปลี่ยน
4. ตรวจว่า application consumer รองรับ View version เป้าหมาย
5. build application image และ migration image จาก Git commit เดียวกัน

หาก Stage A ไม่ผ่าน ให้หยุด pipeline โดยยังไม่เปลี่ยน CouchDB หรือ application

### Stage B — Plan / Dry-run

runner อ่าน `registry` และสร้าง deployment plan:

- จำนวน shelter ที่พบ
- database ที่จะเขียน
- current/target version และ hash แยกราย module
- shelter ที่ขาด database หรืออ่านไม่ได้

pipeline เก็บ plan เป็น artifact และหยุดก่อน write หากจำนวน shelter ไม่ตรงกับ policy

### Stage C — Deploy View

deploy candidate Design Document ของ module ที่เปลี่ยนไปยัง shelter database ทุกแห่ง โดย:

- จำกัด concurrency เพื่อไม่ให้ CouchDB รับ load สูงพร้อมกัน
- retry เฉพาะ transient failure
- ไม่ลบ Design Document รุ่นเดิม
- บันทึกผลราย shelter

สำหรับ production สามารถใช้ batch เช่น 10–20% ต่อรอบ หากจำนวน shelter มีขนาดใหญ่

### Stage D — Warm และ Verify

หลัง deploy ให้ query candidate View ที่ CouchDB ซึ่งรับ request จริง เพื่อ:

- trigger index build
- ตรวจว่า HTTP response สำเร็จ
- ตรวจ key/value shape
- ตรวจ business fixture หรือ invariant ที่สำคัญ
- ยืนยัน version/hash ตรงกับ target

application จะยังไม่ถูกสลับไปใช้รุ่นใหม่หาก shelter ใดไม่ผ่านเกณฑ์ที่ PO/ทีมกำหนด

### Stage E — Deploy Application

เมื่อ candidate พร้อมแล้ว ให้ promote ไปยัง stable Design Document และ deploy application ที่ query:

```text
_design/dashboard
```

จากนั้นรัน smoke test Dashboard อย่างน้อย:

- occupancy
- demographics
- registrations
- shelter ที่ไม่มีข้อมูล
- shelter ที่มี `active`, `pre_registered` และ `checked_out`

### Stage F — Observe และ Promote

- staging ต้องผ่าน smoke/QA ก่อน production
- production เก็บ previous Design Document ไว้ตลอด rollback window
- monitor error rate, latency และ mismatch ของ aggregate
- mark release เป็น complete เมื่อ application และ shelter database ทุกแห่งอยู่ใน target version

### Stage G — Retire รุ่นเก่า

การลบ Design Document รุ่นเก่าเป็น maintenance job แยก ไม่ทำใน deployment เดียวกับการ promote

ลบได้เมื่อ:

- rollback window สิ้นสุด
- ไม่มี application version ที่ใช้งาน View รุ่นนั้น
- verify ทุก shelter ผ่าน
- มี approval และ dry-run report

เสนอให้เก็บอย่างน้อย current และ previous version (`N` และ `N-1`)

## 5. ลำดับใน Jenkins ที่เสนอ

```text
Checkout
  ↓
Test + Build application/migration artifacts
  ↓
Detect changed module manifests + dry-run
  ↓
Deploy candidate + verify/warm ทุก shelter database
  ↓
Promote ไปยัง _design/{module}
  ↓
Deploy application containers
  ↓
Dashboard smoke test
  ↓
Publish per-shelter deployment report
```

ข้อกำหนดเพิ่มเติม:

- staging branch ใช้ staging CouchDB credential เท่านั้น
- main branch ใช้ production credential พร้อม approval ตาม policy
- credential เก็บใน Jenkins Credentials
- ห้ามส่ง URL ที่มี username/password เข้า console log
- pipeline ต้องมี timeout และ bounded retry
- production write ต้องไม่ใช้ flag ยืนยันแบบ hard-code ที่ผู้ใช้อาจเรียกผิด environment
- module ที่ไม่มีการเปลี่ยน manifest ต้องไม่ถูก rewrite

## 6. Rollback

### กรณี View deploy ไม่ครบก่อน application deploy

- หยุด pipeline
- application รุ่นปัจจุบันยังอ่าน stable `_design/{module}`
- แก้ shelter ที่ล้มเหลวแล้ว rerun runner ได้

### กรณี application ใหม่มีปัญหาหลัง promote

- rollback application image/config ไป commit ก่อนหน้า
- promote previous executable definition กลับมายัง stable `_design/{module}` แล้ว rollback application
- target View ไม่จำเป็นต้องลบทันที

### กรณีข้อมูล aggregate ของ View ใหม่ผิด

- disable promotion หรือ rollback application
- เก็บ target Design Document เพื่อ investigation
- แก้ View ด้วย version ใหม่ ห้ามแก้ความหมายของ version ที่ถูก promote แล้วแบบเงียบ ๆ

## 7. ลำดับที่บังคับทางเทคนิค (ไม่ใช่แผนงาน)

CR นี้**ไม่กำหนดแผนดำเนินงาน phase, timeline หรือผู้รับผิดชอบ** — การจัดลำดับงาน การแบ่ง phase และ
การมอบหมาย owner เป็นของ project owner จัดการใน task-breakdown/Notion ตามปกติ

สิ่งที่ CR นี้บังคับคือ **ข้อจำกัดลำดับที่ผิดแล้วข้อมูลเสียหรือ service ดับ** ซึ่งต้องถูกบังคับใน
pipeline ตาม Stage A–G ใน §4 ไม่ใช่ด้วยวินัยของคน:

1. **View ต้องพร้อมก่อน consumer** — deploy + warm + verify `_design/{module}` ครบทุก shelter
   database ก่อน จึง deploy application ที่อ่าน stable path นั้น (Stage C→D→E)
   ห้ามสลับ consumer ไป Design Document ที่ยังไม่ได้ deploy
2. **ห้าม retire `_design/app`** ก่อน compatibility window และ production QA สิ้นสุด และก่อนยืนยันว่า
   ไม่มี consumer เหลือ (Stage G) — เป็น job แยกจาก deployment ที่ promote
3. **application กับ migration artifact ต้องมาจาก Git commit เดียวกัน** (Stage A)
4. **staging ต้องผ่านก่อน production** และใช้ credential แยกกัน (§5)
5. **module ที่ manifest ไม่เปลี่ยน ต้องไม่ถูก rewrite** (§5)

สถานะ implementation ปัจจุบันติดตามที่ §8 Acceptance Criteria (`[x]` = ทำแล้ว) ไม่ต้องมีรายการ phase ซ้ำ

## 8. Acceptance Criteria

- [ ] มี module registry และ manifest contract ที่รองรับ Map/Reduce ทุก shelter module
- [x] Dashboard ใช้ stable Design Document `_design/dashboard`
- [x] อัปเดต convention จาก Design Document เดียว `_design/app` เป็น `_design/{module}`
- [x] อัปเดต schema/data-model ให้ระบุ ownership และ lifecycle ราย module
- [ ] มี deterministic hash และ test ตรวจ View contract
- [ ] มีคำสั่งเลือก `--module`, detect changed module, dry-run, write และ verify
- [ ] runner อ่าน shelter จาก `registry` และรายงานผลครบทุก shelter database
- [ ] runner ทำซ้ำได้โดยไม่สร้างผลข้างเคียงหรือทำลาย View อื่น
- [ ] รองรับ bounded retry สำหรับ `409` และ transient failure
- [ ] candidate View ถูก warm และ verify ก่อน promote
- [ ] Design Document revision/hash ถูก verify หลัง deploy
- [ ] Jenkins staging และ production ใช้ credential แยกกัน
- [ ] pipeline หยุดก่อน application deploy เมื่อ View deployment ไม่ผ่าน policy
- [ ] application และ migration artifact มาจาก Git commit เดียวกัน
- [ ] มี smoke test สำหรับ Dashboard endpoints หลัง deploy
- [ ] rollback previous definition กลับมายัง stable `_design/{module}` ได้
- [ ] shelter ใหม่ได้รับ active View version ระหว่าง provisioning
- [ ] มี report ที่ระบุ version/hash/commit/status ราย shelter
- [ ] การลบ View รุ่นเก่าเป็น job แยกพร้อม dry-run และ approval

## 9. สิ่งที่ไม่อยู่ใน scope

- การเปลี่ยน schema ของ evacuee หรือ movement
- การเปลี่ยน business rule ของ occupancy และ registrations
- การลบ `_design/app` เดิมทันที
- การลบ `_design/app` เดิมก่อน compatibility window และ production QA สิ้นสุด
- การ redesign หน้า Dashboard
- การสร้าง planned View ของ module ที่ยังไม่มี implementation จริง
- **edge/replica ต่อศูนย์ทั้งหมด** — endpoint discovery, replication policy/filter สำหรับ `_design/*`,
  สถานะ `pending` ของ edge ที่ offline, reconciliation job และการ warm index ที่ replica
  จะแยกเป็น CR ใหม่เมื่อ topology ของศูนย์ชัดเจน (ดู §3.5)

ไม่มีการ bump `schema_v` เพราะ CR นี้เปลี่ยน deployment lifecycle และ read model
ไม่เปลี่ยน shape ของ persisted business document

## 10. ความเสี่ยงและมาตรการควบคุม

| ความเสี่ยง                                      | มาตรการ                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| CouchDB load สูงจากการ build index พร้อมกัน     | จำกัด concurrency, batch rollout และ warm ทีละกลุ่ม               |
| shelter บางแห่ง deploy ไม่สำเร็จ                | per-shelter report, bounded retry และหยุดก่อน promote             |
| Design Document มีอยู่แต่ index ยังไม่ถูก build | verify revision/hash **และ** warm ที่ CouchDB ที่รับ request จริง |
| มีคนแก้ managed Design Document เองบน server    | CI/CD เป็น single writer; verify hash จับ drift ได้               |
| app/View version ไม่ตรงกัน                      | build จาก commit เดียวกันและตรวจ manifest compatibility           |
| rollback ไม่ได้เพราะ View เก่าถูกลบ             | เก็บ `N-1` และแยก cleanup ออกจาก deploy                           |
| credential รั่วใน log                           | Jenkins Credentials และ sanitize URL/error output                 |
| View contract เปลี่ยนโดยไม่เพิ่ม version        | CI test และ manifest version policy                               |
| มี consumer เก่ายังใช้ `_design/app`            | inventory และ compatibility window ก่อน retire                    |

## 11. ประเด็นที่ขอให้ PO ตัดสินใจ

1. อนุมัติ **B (lifecycle runner)** — ให้ Map/Reduce ของทุก shelter module เป็น deployment artifact
   ที่ต้องผ่าน CI/CD (ดู §3.0 สำหรับเหตุผลที่แยกจากข้อ 2)
2. อนุมัติ **A (Design Document granularity)** — Design Document ราย module โดยเริ่ม Dashboard ที่
   `_design/dashboard` และหยุด granularity ที่ 1 ddoc ต่อ module ตาม §3.0.2
3. เลือก production rollout policy: all-at-once หรือ staged batch
4. กำหนด rollback window สำหรับ candidate/previous Design Document
5. กำหนดว่า deploy/verify ล้มเหลวที่ shelter หนึ่งแห่ง ต้อง block ทั้ง release หรือปล่อยผ่านได้
6. อนุมัติให้ CI/CD เป็น single writer ของ managed `_design/{module}`
7. ยืนยันว่า Dashboard/Public demographics ต้องนับเฉพาะ `active` — age view จะ emit `birth_year`
   แบบ deterministic และ API จะจัด bucket ตามปีปัจจุบันตอน query; อนุมัติและ implement แล้วใน follow-up นี้
8. ยืนยันว่าเมื่อ Dashboard Design Document หายหรือ query ไม่สำเร็จ Back-office ต้องแจ้ง error
   ส่วน Public Transparency ต้องคืน metric เป็น `null`/สถานะ stale ไม่ตีความเป็นศูนย์
9. จัดลำดับงาน/phase และมอบหมาย owner (CR นี้ไม่เสนอแผน — ให้ PO จัดใน task-breakdown, ดู §7 และ §12)

## 12. Task breakdown และ owner

ไม่อยู่ใน CR นี้ — project owner จัดการใน `docs/task-breakdown/` หรือ Notion ตามปกติ
CR นี้ให้เฉพาะ contract ที่งานเหล่านั้นต้องทำให้ผ่าน: Stage A–G (§4), ลำดับบังคับ (§7),
Acceptance Criteria (§8) และสิ่งที่อยู่นอก scope (§9)

## Migration

ไม่ใช่ business-data migration แต่เป็น read-model migration:

```text
_design/app
    ↓ coexistence
_design/dashboard__next_<hash>
    ↓ warm/verify ทุก shelter database
_design/dashboard
    ↓ application promotion
_design/app retained during compatibility window
    ↓ retire after approval
```

## Decision log

- 2026-07-27 — proposed for PO review
- 2026-07-27 — แนะนำ candidate/previous rotation + deploy-before-application เพื่อรองรับ safe rollout/rollback
- 2026-07-27 — แนะนำ migration runner แยก เพราะ frontend production runtime ไม่มี toolchain สำหรับรัน TypeScript migration
- 2026-07-27 — ขยาย lifecycle ให้รองรับทุก Map/Reduce module ใน shelter โดยแยก `_design/{module}`
- 2026-07-27 — กำหนด Dashboard stable path เป็น `_design/dashboard`
- 2026-07-27 — ผู้ใช้อนุมัติให้ Dashboard และ Public Transparency consumers อ่าน `_design/dashboard`; demographics ใช้ Map/Reduce ที่กรอง `active` และ `_design/app` คงไว้เป็น legacy
- 2026-07-27 — แก้ตาม code review: age Map/Reduce emit `birth_year` แบบ deterministic (manifest version 2), API bucket ตามปีปัจจุบัน และ missing Dashboard ddoc ไม่ถูกแปลงเป็นศูนย์
- 2026-07-27 — provisioning ใช้ lifecycle runner กลาง; write mode บังคับ `TENT_ENV` ตรงกับ `--environment`, เพิ่ม warm timeout และ cleanup candidate/previous rotation
- 2026-07-27 — Design Document replicate ได้ตาม replication policy แต่ View index ต้อง warm/build ที่ replica เอง
- 2026-07-27 — **ถอด replication/edge contract (§3.5 เดิม) ออกจาก scope** — CR นี้โฟกัสปัญหาเดียวคือ
  shelter database บน CouchDB ส่วนกลางค้าง Design Document รุ่นเก่า (§1.1) เรื่อง endpoint discovery,
  replication filter, edge pending/reconcile จะแยกเป็น CR ใหม่เมื่อ topology ของศูนย์ชัดเจน
  โดยเก็บข้อเท็จจริงที่ต้องจำไว้ใน §3.5 (index ไม่ replicate — ต้อง warm ที่ node ที่รับ request)
- 2026-07-27 — ถอดแผน phase (§7 เดิม) และ task breakdown/owner (§12 เดิม) ออกจาก CR — CR ให้เฉพาะ
  contract ที่ pipeline ต้องบังคับ (Stage A–G + ลำดับบังคับ + AC) ส่วนการจัดลำดับงานและ owner เป็นของ PO
- 2026-07-27 — เพิ่ม §3.0 แยกสองเรื่องออกจากกัน: A = Design Document granularity (`_design/{module}`)
  แก้ blast radius, B = lifecycle runner แก้ root cause §1.1 — อนุมัติแยกกันได้ และยืนยันกติกา
  granularity หยุดที่ 1 Design Document ต่อ module (§3.0.2)
