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
ไปยัง shelter database และ replica ที่เกี่ยวข้องทุกแห่ง ตรวจสอบว่า View พร้อมใช้งาน แล้วจึง
deploy application โดยเก็บ candidate/previous Design Document ไว้ชั่วคราวสำหรับ rollback

แนวทางเป้าหมายคือ:

```text
validate → deploy candidate ของ module ที่เปลี่ยน → warm/verify ทุก shelter/replica
         → promote ไปยัง _design/{module}
         → deploy application → smoke test → retain รุ่นเก่าไว้สำหรับ rollback
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
pnpm deploy:shelter-views --module dashboard --design dashboard --write --confirm
```

โหมด `--design dashboard` จะ deploy Dashboard Views ไปยัง `_design/dashboard` ซึ่งเป็น target
ที่ consumer ปัจจุบันใช้งานแล้ว ส่วน `--design app` เป็น compatibility mode สำหรับซ่อมหรือ
rollback Design Document เดิมเท่านั้น และจะ merge View ของ module อื่นไว้เหมือนเดิม

ความหมายของ target ที่ใช้กับ script มีดังนี้:

| คำสั่ง | Design Document ที่เขียน | ผลต่อ API ปัจจุบัน |
| --- | --- | --- |
| `--design dashboard --write --confirm` | `_design/dashboard` ของ Dashboard | ใช้กับ consumer ปัจจุบัน หลัง deploy สำเร็จและ verify แล้ว |
| `--design app --write --confirm` | `_design/app` เดิม โดย merge Dashboard Views และรักษา View ของ module อื่น | ใช้เฉพาะ compatibility/rollback; consumer ใหม่ไม่อ่าน document นี้ |

การรัน script ไม่ได้เปลี่ยน consumer code หรือสลับชื่อ Design Document เอง แต่ target ที่ระบุ
ด้วย `--design` จะเป็นจุดที่ถูกเขียน สำหรับ shelter เดิมต้อง deploy และ verify `_design/dashboard`
ให้ครบก่อนใช้งาน consumer ที่เปลี่ยนแล้ว

PoC รอบนี้วนเฉพาะ shelter database ที่อ่านได้จาก `registry` ยังไม่ถือว่าเป็น replica
orchestrator และยังไม่เปลี่ยน replication topology หากศูนย์มี edge/replica แยกต่างหาก จะต้อง
เพิ่ม endpoint discovery หรือ deploy agent ใน Phase ถัดไป พร้อม verify Design Document และ
warm index ที่ replica นั้นโดยเฉพาะ

## 2. เป้าหมาย

- shelter และ replica ทุกแห่งใช้ View version ของแต่ละ module ที่ตรงกับ release
- View deployment ทำซ้ำได้โดยไม่ทำให้ข้อมูลหรือ View ของ module อื่นสูญหาย
- application ไม่ถูกสลับไปใช้ View ใหม่ก่อน View พร้อม
- pipeline ระบุ shelter ที่ deploy หรือ verify ล้มเหลวได้
- rollback application แล้วสามารถกลับไปอ่าน View definition รุ่นก่อนหน้าได้
- credential ของ CouchDB อยู่ใน CI/CD secret store และไม่ปรากฏใน source/log
- shelter ที่สร้างใหม่ได้รับ active View version เดียวกับ production

## 3. ข้อเสนอเชิงสถาปัตยกรรม

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
`_design/dashboard` ส่วน temporary document จะถูกเก็บตาม rollback window แล้ว cleanup ภายหลัง

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

สร้างคำสั่ง เช่น:

```text
pnpm deploy:dashboard-views
```

รองรับ mode:

```text
pnpm deploy:dashboard-views --dry-run
pnpm deploy:dashboard-views --write --environment staging
pnpm deploy:dashboard-views --verify --environment staging
```

เมื่อรองรับหลาย module ให้มีคำสั่งกลาง เช่น:

```text
pnpm deploy:shelter-views --module dashboard --dry-run
pnpm deploy:shelter-views --changed-since <git-ref> --write
pnpm deploy:shelter-views --all --verify
```

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

### 3.5 Replication contract สำหรับศูนย์ที่มี CouchDB replica

ต้องแยกสองสิ่งออกจากกัน:

| สิ่งที่เกี่ยวข้อง | Replicate หรือไม่ | สิ่งที่ lifecycle ต้องทำ |
| --- | --- | --- |
| Design Document เช่น `_design/dashboard` | replicate ได้เหมือน document ปกติ หาก replication job ไม่กรองออกและ account มีสิทธิ์เขียน Design Document | ตรวจ replication policy และ verify revision/hash ที่ปลายทาง |
| Map/Reduce index/B-tree ที่คำนวณแล้ว | ไม่ replicate | query/warm ที่ CouchDB replica แต่ละตัวเพื่อให้สร้าง index ในเครื่องนั้น |
| `_local/*` deployment/checkpoint document | ไม่ replicate | ห้ามใช้เป็น desired-state record ที่ต้องเหมือนทุก replica |

กรณี “ทุกศูนย์มี CouchDB ของตนเองและ sync กับส่วนกลาง” ให้ใช้ model:

```text
CI/CD publish desired module manifest ที่ส่วนกลาง
        ↓
Design Document replicate หรือ lifecycle runner deploy ตรงไปยัง edge
        ↓
ตรวจ revision/hash ที่ CouchDB ของแต่ละศูนย์
        ↓
warm View บน replica แต่ละตัว
        ↓
mark ศูนย์นั้น ready
```

ข้อกำหนด:

- CI/CD/control plane เป็น single writer ของ managed Design Document เพื่อลด conflict
- replication account ต้องมีสิทธิ์เขียน Design Document; replication ที่ใช้ selector/filter
  ต้องยืนยันว่า `_design/*` ไม่ถูกกรองออก
- bidirectional replication ห้ามให้ edge แก้ managed Design Document เอง
- edge ที่ offline ให้สถานะ `pending` และ reconcile เมื่อกลับมา online
- pipeline ต้องมี policy แยกว่า edge pending จะ block release หรืออนุญาตเฉพาะ central service
- หาก replica ถูกใช้รับ request จริง ต้อง verify และ warm replica นั้น ไม่ใช่ตรวจเฉพาะ central DB

สำหรับ CouchDB cluster ภายในศูนย์ Design Document จะเป็นส่วนหนึ่งของ database แต่ view index
ยังเป็น local derived state ของ shard/node และ CouchDB จะ build/update ตามการ query ไม่ใช่ส่ง
ไฟล์ index ที่สร้างแล้วมาจากอีกศูนย์

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

runner อ่าน registry, replica registry และสร้าง deployment plan:

- จำนวน shelter ที่พบ
- database ที่จะเขียน
- current/target version และ hash แยกราย module
- replica endpoint หรือ replication state ของแต่ละ shelter
- shelter ที่ขาด database หรืออ่านไม่ได้

pipeline เก็บ plan เป็น artifact และหยุดก่อน write หากจำนวน shelter ไม่ตรงกับ policy

### Stage C — Deploy View

deploy candidate Design Document ของ module ที่เปลี่ยนไปยัง shelter/replica ทุกแห่ง โดย:

- จำกัด concurrency เพื่อไม่ให้ CouchDB รับ load สูงพร้อมกัน
- retry เฉพาะ transient failure
- ไม่ลบ Design Document รุ่นเดิม
- บันทึกผลราย shelter

สำหรับ production สามารถใช้ batch เช่น 10–20% ต่อรอบ หากจำนวน shelter มีขนาดใหญ่

### Stage D — Warm และ Verify

หลัง deploy ให้ query candidate View ที่ replica ซึ่งให้บริการจริงทุกแห่ง เพื่อ:

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
- mark release เป็น complete เมื่อ application และ shelter/replica ทุกแห่งอยู่ใน target version

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
Deploy candidate + verify/warm ทุก serving replica
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
- edge ที่ offline ต้องมี reconciliation job เมื่อกลับมา online

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

## 7. แผนดำเนินงาน

### Phase 1 — Deployment foundation และ module registry

- inventory Map/Reduce ของทุก module แยก actual implementation ออกจาก planned View ใน spec
- แยก View definition เป็น pure manifest ราย module ที่ CLI และ provisioning ใช้ร่วมกัน
- กำหนด stable Design Document เป็น `_design/{module}`
- เพิ่ม unit test และ deterministic hash
- สร้าง migration runner พร้อม `--module`, `--changed-since`, dry-run/write/verify
- เพิ่ม report ราย shelter

### Phase 2 — Staging integration

- เพิ่ม migration image/runner ใน Docker build
- เชื่อม Jenkins staging ตาม Stage A–F
- migration Dashboard จาก `_design/app` ไป `_design/dashboard`
- ทดสอบ candidate → warm → promote, partial failure, rerun และ rollback
- ทดสอบ replication/edge offline แล้ว reconcile เมื่อกลับมา online

### Phase 3 — Production rollout

- inventory shelter และ current Design Document
- deploy/warm candidate Dashboard โดยยังไม่เปลี่ยน consumer
- QA เทียบผลเดิมกับผลใหม่
- promote `_design/dashboard` และ deploy application ให้ใช้ stable path
- monitor ตลอด rollback window

### Phase 4 — Active-only demographics (consumer migration implemented)

- [x] ออก View contract ที่ emit เฉพาะ `current_stay.status = active`
- [x] เปลี่ยน Back-office demographics จาก Mango `_find` มาใช้ `_design/dashboard`
- [x] เปลี่ยน Back-office/Public Dashboard consumers ให้ใช้ stable `_design/dashboard`
- [x] เปลี่ยน provisioning และ seed ให้สร้าง `_design/dashboard`
- [ ] deploy/warm/verify shelter เดิมครบทุกแห่งและทำ staging/production QA sign-off

### Phase 5 — Cleanup

- ตรวจ consumer ที่ยังอ่าน `_design/app`
- retire View เดิมเมื่อไม่มี consumer
- กำหนด retention policy สำหรับ Design Document รุ่นเก่า
- เพิ่ม runbook สำหรับ deploy, incident และ rollback

### Phase 6 — Onboard module อื่น

- เพิ่ม manifest ให้ inventory, kitchen, donations และ module อื่นเมื่อ View มี implementation จริง
- ย้าย View ของแต่ละ module จาก `_design/app` ไป `_design/{module}` ทีละ module
- ใช้ lifecycle และ acceptance gate เดียวกับ Dashboard
- ไม่จำเป็นต้องรอให้ทุก module พร้อมจึงเริ่มใช้ lifecycle กับ Dashboard

## 8. Acceptance Criteria

- [ ] มี module registry และ manifest contract ที่รองรับ Map/Reduce ทุก shelter module
- [x] Dashboard ใช้ stable Design Document `_design/dashboard`
- [x] อัปเดต convention จาก Design Document เดียว `_design/app` เป็น `_design/{module}`
- [x] อัปเดต schema/data-model ให้ระบุ ownership และ lifecycle ราย module
- [ ] มี deterministic hash และ test ตรวจ View contract
- [ ] มีคำสั่งเลือก `--module`, detect changed module, dry-run, write และ verify
- [ ] runner อ่าน shelter/replica จาก registry และรายงานผลทุก endpoint
- [ ] PoC runner รายงาน shelter database จาก registry ครบถ้วน; replica orchestration เป็น Phase ถัดไป
- [ ] runner ทำซ้ำได้โดยไม่สร้างผลข้างเคียงหรือทำลาย View อื่น
- [ ] รองรับ bounded retry สำหรับ `409` และ transient failure
- [ ] candidate View ถูก warm และ verify บน serving replica ก่อน promote
- [ ] Design Document revision/hash ถูก verify หลัง replication หรือ direct deploy
- [ ] edge ที่ offline ถูกบันทึกเป็น pending และ reconcile ได้
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

ไม่มีการ bump `schema_v` เพราะ CR นี้เปลี่ยน deployment lifecycle และ read model
ไม่เปลี่ยน shape ของ persisted business document

## 10. ความเสี่ยงและมาตรการควบคุม

| ความเสี่ยง | มาตรการ |
| --- | --- |
| CouchDB load สูงจากการ build index พร้อมกัน | จำกัด concurrency, batch rollout และ warm ทีละกลุ่ม |
| shelter บางแห่ง deploy ไม่สำเร็จ | per-shelter report, bounded retry และหยุดก่อน promote |
| edge offline ระหว่าง release | mark pending, reconcile ภายหลัง และกำหนด release policy |
| Design Document sync แต่ index ยังไม่พร้อม | verify revision/hash และ warm ที่ replica ปลายทาง |
| bidirectional replication เกิด Design Document conflict | CI/CD เป็น single writer และห้าม edge แก้ managed ddoc |
| app/View version ไม่ตรงกัน | build จาก commit เดียวกันและตรวจ manifest compatibility |
| rollback ไม่ได้เพราะ View เก่าถูกลบ | เก็บ `N-1` และแยก cleanup ออกจาก deploy |
| credential รั่วใน log | Jenkins Credentials และ sanitize URL/error output |
| View contract เปลี่ยนโดยไม่เพิ่ม version | CI test และ manifest version policy |
| มี consumer เก่ายังใช้ `_design/app` | inventory และ compatibility window ก่อน retire |

## 11. ประเด็นที่ขอให้ PO ตัดสินใจ

1. อนุมัติให้ Map/Reduce ของทุก shelter module เป็น deployment artifact ที่ต้องผ่าน CI/CD
2. อนุมัติ Design Document ราย module โดยเริ่ม Dashboard ที่ `_design/dashboard`
3. เลือก production rollout policy: all-at-once หรือ staged batch
4. กำหนด rollback window สำหรับ candidate/previous Design Document
5. กำหนดว่า failure หรือ edge offline หนึ่ง shelter ต้อง block ทั้ง release หรือเป็น pending ได้
6. อนุมัติให้ CI/CD เป็น single writer ของ managed `_design/{module}`
7. ยืนยันว่า Back-office demographics ต้องนับเฉพาะ `active` — อนุมัติและ implement แล้วใน follow-up นี้
8. มอบหมาย owner ของ migration runner, replication verification, Jenkins, QA และ runbook

## 12. Task breakdown ที่เสนอ

| Task | Owner แนะนำ | Deliverable |
| --- | --- | --- |
| T1 — Inventory + module manifest contract | Backend | actual View inventory, ownership และ unit tests |
| T2 — Migration runner | Backend | module-aware dry-run/write/verify CLI |
| T3 — Migration artifact/image | Backend + DevOps | one-shot runner จาก release commit |
| T4 — Jenkins staging integration | DevOps | Stage A–F บน staging |
| T5 — Replica verification/reconcile | Backend + DevOps | revision check, warm และ pending-edge reconciliation |
| T6 — Failure/rollback test | Backend + QA | evidence ของ rerun และ rollback |
| T7 — Production rollout | DevOps + QA | per-shelter deployment report |
| T8 — Demographics active-only View | Backend | version ใหม่และ consumer migration |
| T9 — Onboard module อื่น | Module owners | `_design/{module}` manifest และ consumer migration |
| T10 — Legacy cleanup/runbook | Backend + DevOps | retention policy และ runbook |

## Migration

ไม่ใช่ business-data migration แต่เป็น read-model migration:

```text
_design/app
    ↓ coexistence
_design/dashboard__next_<hash>
    ↓ warm/verify replicas
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
- 2026-07-27 — Design Document replicate ได้ตาม replication policy แต่ View index ต้อง warm/build ที่ replica เอง
