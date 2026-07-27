---
id: CR-051
title: Shelter Map/Reduce lifecycle เชื่อมต่อ CI/CD
status: approved
date: 2026-07-27
updated: 2026-07-27
requested_by: Team B (เสนอ PO)
decided_by: project owner
layer: stable
affects:
  - CR-020 Back-office Dashboard API Architecture
  - Jenkinsfile
  - frontend/package.json
  - frontend/src/lib/features/shelters/domain/views.ts
  - frontend/src/lib/features/shelters/server/deploy.ts
  - frontend/src/lib/features/shelters/server/view-lifecycle.ts
  - frontend/scripts/deploy-shelter-views.ts
  - frontend/src/routes/api/back-office/shelter/[code]/dashboard/*
  - frontend/src/routes/api/back-office/shelter/+server.ts
  - frontend/scripts/
  - docs/data/schema.md §7
  - docs/data/data-model.md §4
  - docker-compose.staging.no-nginx.yml
  - docker-compose.production.no-nginx.yml
---

# CR-051 — Shelter Map/Reduce lifecycle เชื่อมต่อ CI/CD

## TL;DR สำหรับ PO

เสนอให้จัดการ CouchDB Map/Reduce View ของ shelter เป็น deployment artifact ที่มี version และ
lifecycle ชัดเจน ไม่ผูกอยู่กับการสร้าง shelter หรือการ seed เท่านั้น

ปัญหาที่แก้: source code ถูก deploy แล้ว แต่ `_design/app` ใน shelter ที่มีอยู่ยังเป็น revision เก่า
ทำให้แต่ละศูนย์อาจใช้ Map/Reduce business rule คนละรุ่นแม้รัน application release เดียวกัน

เมื่อ Map/Reduce source เปลี่ยน CI/CD ต้อง deploy Design Document ไปยัง shelter database ทุกแห่ง
บน CouchDB ส่วนกลาง ตรวจว่า View พร้อมใช้งานจริง แล้วจึง deploy application โดยเก็บ previous
definition ไว้หนึ่งรุ่นสำหรับ rollback และลบ candidate ที่ promote สำเร็จแล้วออกจาก CouchDB

```text
validate → deploy candidate → warm/verify ทุก shelter database
         → promote ไปยัง _design/app
         → deploy application → smoke test → retain previous รุ่นเดียวไว้สำหรับ rollback
```

**ขอบเขตที่ตกลงใน CR นี้:**

- คง Design Document เดียวต่อ database คือ **`_design/app`** ตาม convention เดิม ไม่แยกราย module
  (เหตุผลและเงื่อนไขที่จะกลับมาพิจารณาอยู่ใน §3.0)
- ชื่อ Design Document และ query path ของ consumer **ไม่เปลี่ยน** — CR นี้ไม่มี read-model migration
- manifest ของ `_design/app` เป็น view set ทั้งก้อน และ CI/CD เป็นผู้เขียนคนเดียว
- runner วนเฉพาะ `shelter_*` ที่อ่านได้จาก `registry` บน CouchDB ส่วนกลาง

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
pnpm deploy:shelter-views              # dry-run (ค่าเริ่มต้น)
pnpm deploy:shelter-views --verify
pnpm deploy:shelter-views --write --confirm
```

script ไม่มี flag เลือก Design Document และไม่มี flag เลือก environment โดยเจตนา:

- **ไม่มี `--design`** — มี Design Document เดียวคือ `_design/app` ไม่มีอะไรให้เลือก
- **ไม่มี `--environment`** — ปลายทางคือสิ่งที่ `COUCHDB_ADMIN_URL` ชี้อยู่ การแยก staging กับ
  production มาจากการที่ CI job แต่ละตัว bind credential ต่างกัน ซึ่งผู้สั่งงานแก้จาก command line
  ไม่ได้ flag ที่ผู้สั่งงานพิมพ์เองไม่เพิ่มการป้องกันให้ แต่ต้อง log **host** ของ endpoint ที่เขียน
  ทุกครั้งเพื่อให้ CI log บันทึกไว้ว่ารอบนั้นเขียน cluster ใด (ห้าม log URL ที่มี credential)

PoC รอบนี้วนเฉพาะ shelter database ที่อ่านได้จาก `registry` บน CouchDB ส่วนกลาง ไม่แตะ
replication topology และไม่ใช่ replica orchestrator (ดู §3.5 และ §9)

## 2. เป้าหมาย

- shelter database ทุกแห่งใช้ View version ที่ตรงกับ release
- View deployment ทำซ้ำได้โดยไม่ทำให้ข้อมูลสูญหาย
- application ไม่ถูกสลับไปใช้ View ใหม่ก่อน View พร้อมใช้จริง
- pipeline ระบุ shelter ที่ deploy หรือ verify ล้มเหลวได้
- rollback application แล้วสามารถกลับไปอ่าน View definition รุ่นก่อนหน้าได้
- credential ของ CouchDB อยู่ใน CI/CD secret store และไม่ปรากฏใน source/log
- shelter ที่สร้างใหม่ได้รับ active View version เดียวกับ production

## 3. ข้อเสนอเชิงสถาปัตยกรรม

### 3.0 ขอบเขตที่ตัดสินแล้ว: ทำ lifecycle runner คงไว้ Design Document เดียว

ตอนร่าง CR นี้มีสองเรื่องปนกันอยู่ ซึ่งแก้ปัญหาต่างกันและตัดสินใจแยกกันได้:

| เรื่อง                                                                              | แก้ปัญหาอะไร                                                                                                  | ไม่ได้แก้อะไร                               | สถานะ                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------ |
| **A. Design Document granularity** — แยก `_design/{module}` แทน `_design/app` เดียว | blast radius: การแก้ View ของ module หนึ่งไปทำให้ index ของ module อื่น rebuild และ deploy ชนกัน              | ไม่ได้ทำให้ shelter เดิมได้ definition ใหม่ | **ไม่ทำใน CR นี้**       |
| **B. Lifecycle runner** — `deploy:shelter-views` + candidate/warm/promote/verify    | root cause ของ CR นี้: shelter เดิมค้าง Design Document revision เก่า เพราะ deploy application ไม่แตะ CouchDB | ไม่ได้ลด blast radius                       | **ทำ — เนื้อหลักของ CR** |

**A ไม่ใช่คำตอบของปัญหาใน §1.1** การแยก Design Document ไม่ได้เขียน definition ใหม่ลง shelter ที่
deploy ไปแล้วแม้แต่แห่งเดียว ปัญหาที่ร้องเรียนจะยังอยู่ครบ ตัวที่แก้ปัญหาคือ B เท่านั้น

#### 3.0.1 เหตุผลที่ไม่ทำ A ในรอบนี้

1. **ประโยชน์ยังไม่เกิด** ประโยชน์ของการแยก ddoc (rebuild แยก, `_rev` แยก, rollback แยก) เกิดค่าเมื่อ
   **มีหลายโมดูลที่มี View จริง** ตอนนี้มีชุดเดียว จำนวน index file, จำนวน view-server pass ต่อ
   document, blast radius และ `_rev` contention เท่ากันทุกช่องระหว่าง `_design/app` กับ
   `_design/{module}` — การแยกจึงไม่ซื้ออะไรเลยในวันนี้
2. **ต้นทุนต้องจ่ายทันทีและเป็นต้นทุนด้าน correctness** การเปลี่ยนชื่อทำให้ query path ของ consumer
   ทุกตัวเปลี่ยน ถ้า deploy ไม่ทันหรือพลาด shelter ใด consumer จะได้ `404` ซึ่งถ้าถูกแปลงเป็นเลข 0
   จะกลายเป็น Dashboard และ public transparency API ที่รายงาน "ผู้อพยพ 0 คน" ขณะศูนย์เต็ม
   ความเสี่ยงนี้ไม่มีเลยถ้าไม่เปลี่ยนชื่อ
3. **แยกทีหลังได้ และไม่ถูกกว่าถ้าทำวันนี้แต่ก็ไม่แพงขึ้นแบบผูกมัด** — งานที่เพิ่มคือย้าย consumer path
   ซึ่งเป็นงานเท่าเดิมไม่ว่าจะทำเมื่อไหร่ ต่างกันที่จำนวนข้อมูลตอน rebuild

ต้นทุนของการอยู่ Design Document เดียวที่ยอมรับแล้ว — CouchDB คิด view-group signature จาก
definition ของ **ทุก View ใน Design Document เดียวกัน** จึงเกิดผลตามนี้:

- แก้ View ตัวเดียว → signature ของทั้งกลุ่มเปลี่ยน → **index ของทุก View ใน `_design/app` rebuild
  จากศูนย์** รวม View ที่ไม่ได้แตะ
- ทุกคนที่ต้องเพิ่ม View ต้องแก้ document เดียวกัน จึงต้องมีผู้เขียนคนเดียว (§3.2)
- `_rev` เดียว = rollback ได้ทั้งก้อนเท่านั้น

#### 3.0.2 เงื่อนไขที่จะกลับมาพิจารณา A

เสนอให้เปิด CR ใหม่เพื่อแยก Design Document เมื่อเข้า **ข้อใดข้อหนึ่ง**:

- มีโมดูลที่สองที่ต้องการ View บน `shelter_*` จริง (ไม่ใช่แค่ในเอกสาร spec) และรอบการเปลี่ยนของมัน
  ไม่ตรงกับรอบของ Dashboard
- เวลา rebuild `_design/app` ทั้งกลุ่มยาวจนกระทบการใช้งาน (วัดจากเวลา warm ใน Stage D)
- มีทีมที่ต้อง deploy View พร้อมกันจนเกิด `409` ซ้ำ ๆ เกินที่ bounded retry รับได้

เมื่อถึงเวลานั้น กติกาที่เสนอไว้คือ **หยุด granularity ที่ 1 Design Document ต่อ module** ไม่แยก
ละเอียดกว่านั้น (เช่น ddoc ต่อ View) เพราะจ่ายต้นทุน N× ของ view-server pass โดยไม่ได้ประโยชน์เพิ่ม
และ View อยู่ Design Document เดียวกันได้เมื่อเข้าเกณฑ์ทั้งสองข้อ: (ก) อ่าน document type ชุดเดียวกัน
และ (ข) เปลี่ยนไปพร้อมกันตามรอบงานเดียวกัน

### 3.1 Design Document เดียวต่อ database

stable Design Document คือ:

```text
_design/app
```

View ของ Dashboard ที่อยู่ใน document นี้:

- `occupancy`
- `demographics_by_age`
- `demographics_by_country`
- `registrations_by_date_status`

ระหว่าง rollout ใช้ Design Document ชั่วคราว:

```text
_design/app__next_<hash>
_design/app__prev_<version>
```

เมื่อ candidate warm และ verify แล้ว จึง promote executable definition เดียวกันไปยัง `_design/app`
จากนั้นลบ candidate และเก็บ previous stable ไว้เพียงหนึ่งรุ่นเพื่อ rollback; หาก cleanup ล้มเหลว
ให้รายงาน `cleanup_pending` และทำ cleanup ซ้ำเป็นงานแยกได้

เหตุที่ต้องมี candidate แยกแทนการ PUT ทับ `_design/app` ตรง ๆ: CouchDB build index ตอน query
ครั้งแรกเท่านั้น และ reader คนแรกต้องรอจน build เสร็จ การ PUT ทับตรง ๆ จึงผลัก cost นั้นไปให้
ผู้ใช้คนแรกที่เปิด Dashboard หลัง deploy candidate ให้ pipeline เป็นคนจ่าย cost นั้นแทน

> ข้อสังเกตทางเทคนิคที่ต้อง verify ก่อนใช้จริง: CouchDB คิด view-group signature จาก
> `{views, language, options, lib}` **ไม่รวมชื่อ Design Document** ถ้าจริง candidate กับ stable ที่มี
> definition เหมือนกันจะใช้ index file เดียวกัน ทำให้ promote ไม่ต้อง rebuild ซ้ำ ต้องพิสูจน์บน
> staging หนึ่งครั้งโดยเทียบ `view_index.signature` จาก `_design/app__next_<hash>/_info` กับ
> `_design/app/_info` — **ถ้าไม่ตรง candidate ไม่ได้ประโยชน์อะไรและควรถอดออก**

### 3.2 View manifest — เป็น view set ทั้งก้อน และมีผู้เขียนคนเดียว

manifest เป็น source of truth ของ **ทุก View ใน `_design/app`** ไม่ใช่ส่วนเพิ่มของโมดูลใดโมดูลหนึ่ง:

```ts
{
  designName: 'app',
  version: 2,
  hash: '<sha256 ของ canonical definition ของ views ทั้งก้อน>',
  views: { occupancy, demographics_by_age, demographics_by_country, registrations_by_date_status }
}
```

กติกา:

- **deploy คือ replace ไม่ใช่ merge** View ที่ไม่อยู่ใน manifest จะไม่อยู่ใน `_design/app` หลัง deploy
  ข้อนี้บังคับ เพราะถ้า runner merge กับของเดิม hash ของผลลัพธ์จะไม่ตรง manifest ตลอดไป ทำให้
  การ verify hash (§8) เป็นไปไม่ได้ และ View ที่เลิกใช้จะค้างอยู่ตลอดกาล
- **CI/CD เป็นผู้เขียน `_design/app` คนเดียว** ห้าม PUT Design Document เองบน server ทีมที่ต้องการ
  View ใหม่ต้องเพิ่มเข้า manifest กลางผ่าน PR
- เปลี่ยน logic หรือ key contract ของ View ต้องเพิ่ม version
- การแก้ที่ไม่เปลี่ยน output contract อาจคง version แต่ hash ต้องเปลี่ยน
- pipeline ต้องบันทึก version, hash และ Git commit ที่ deploy
- provisioning shelter ใหม่ต้องใช้ manifest เดียวกับ migration runner ไม่มี code path ที่ deploy
  View คนละทางกับ runner

### 3.3 เพิ่ม migration runner แยกจาก frontend runtime

PoC ใช้คำสั่งกลางนี้:

```text
pnpm deploy:shelter-views --json
pnpm deploy:shelter-views --write --confirm
pnpm deploy:shelter-views --verify --json
```

runner ต้อง:

1. อ่าน shelter master จาก `registry`
2. สร้างชื่อ database ด้วย utility กลาง ไม่ประกอบชื่อแบบกระจัดกระจาย
3. ตรวจว่า shelter database มีอยู่จริง
4. deploy Design Document จาก manifest แบบ replace
5. ใช้ `_rev` สำหรับการ update Design Document version เดิม
6. retry แบบ bounded เมื่อเกิด `409 Conflict` หรือ network error ชั่วคราว
7. warm View โดย query ด้วย `limit=0` หรือ query ที่กำหนด **โดยใช้ timeout ที่ยาวพอสำหรับ index
   build** (การ warm ตั้งใจให้ block จน build เสร็จ จึงต้องไม่ใช้ timeout เดียวกับ request ปกติ)
8. verify version/hash และ query contract
9. สรุปผลราย shelter เป็น machine-readable report และแยก failure จาก lifecycle ออกจาก failure
   จาก preflight (เช่น registry มี shelter แต่ database ไม่มี) เพราะสองอย่างนี้ต้องการคนแก้ต่างกลุ่ม
10. exit non-zero เมื่อมี failure ของ lifecycle

runner ควรถูก package เป็น one-shot migration image หรือ executable artifact แยกจาก
frontend runtime เพื่อให้ CI/CD เรียกใช้ version เดียวกับ release ได้

### 3.4 เก็บ deployment state แยกจาก business data

บันทึกผล deployment อย่างน้อย:

```json
{
  "shelter_code": "SH001",
  "database": "shelter_sh001",
  "design_name": "app",
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

### 3.6 View พร้อมใช้ ≠ Design Document ถูกเขียนแล้ว

สองข้อเท็จจริงของ CouchDB ที่กำหนดว่าทำไม Stage D ต้อง **warm** ไม่ใช่แค่ verify hash:

1. **Design Document replicate ได้เหมือน document ปกติ แต่ view index ไม่ replicate** — index เป็น
   local derived state ของแต่ละ node/shard และ CouchDB build ตามการ query เท่านั้น การเห็น
   `_design/app` ปรากฏที่ปลายทางจึงไม่ได้แปลว่า View พร้อมใช้
2. **index ที่ยังไม่ถูก build ไม่ได้คืนข้อมูลเก่า — มันคืนความว่าง** เมื่อ definition เปลี่ยน signature
   จะเปลี่ยน CouchDB จะเริ่ม build index ใหม่ตั้งแต่ต้น query ปกติจะ block จน build เสร็จ แต่ query
   ที่ใช้ `update=false`/`stale=ok` จะได้ `rows: []` ทันที

ข้อ 2 สำคัญกับ CR นี้เป็นพิเศษ: **การคง `_design/app` ตัดความเสี่ยง `404` ออกไปได้ แต่ไม่ได้ตัด
ความเสี่ยง "อ่านได้แต่ว่าง"** เพราะการแก้ definition ของ demographics ก็ทำให้ signature เปลี่ยนอยู่ดี
consumer ที่แปลง empty result เป็นเลข 0 จะรายงานยอดเป็นศูนย์ระหว่างหน้าต่าง rebuild
จึงยังต้องมี §7 ข้อ 1 และข้อกำหนดใน §11 ข้อ 6

## 4. CI/CD lifecycle ที่เสนอ

### Stage A — Validate

ทำก่อนแตะ environment:

1. lint/type-check source
2. unit test Map function, Reduce contract และ key shape
3. ตรวจ manifest version/hash ว่าเปลี่ยนหรือไม่
4. ตรวจว่า application consumer รองรับ View version เป้าหมาย
5. build application image และ migration image จาก Git commit เดียวกัน

หาก Stage A ไม่ผ่าน ให้หยุด pipeline โดยยังไม่เปลี่ยน CouchDB หรือ application

### Stage B — Plan / Dry-run

runner อ่าน `registry` และสร้าง deployment plan:

- จำนวน shelter ที่พบ
- database ที่จะเขียน
- current/target version และ hash
- shelter ที่ขาด database หรืออ่านไม่ได้ (แยกออกจาก failure จริง)

pipeline เก็บ plan เป็น artifact และหยุดก่อน write หากจำนวน shelter ไม่ตรงกับ policy

### Stage C — Deploy View

deploy candidate Design Document ไปยัง shelter database ทุกแห่ง โดย:

- จำกัด concurrency เพื่อไม่ให้ CouchDB รับ load สูงพร้อมกัน
- retry เฉพาะ transient failure
- ไม่ลบ Design Document รุ่นเดิม
- บันทึกผลราย shelter

สำหรับ production สามารถใช้ batch เช่น 10–20% ต่อรอบ หากจำนวน shelter มีขนาดใหญ่

### Stage D — Warm และ Verify

หลัง deploy ให้ query candidate View ที่ CouchDB ซึ่งรับ request จริง เพื่อ:

- trigger index build และ **รอจนเสร็จ** (ดู §3.6)
- ตรวจว่า HTTP response สำเร็จ
- ตรวจ key/value shape
- ตรวจ business fixture หรือ invariant ที่สำคัญ
- ยืนยัน version/hash ตรงกับ target

application จะยังไม่ถูกสลับไปใช้รุ่นใหม่หาก shelter ใดไม่ผ่านเกณฑ์ที่ PO/ทีมกำหนด

### Stage E — Promote และ Deploy Application

เมื่อ candidate พร้อมแล้ว ให้ promote definition เดียวกันไปยัง `_design/app` และ deploy application

จากนั้นรัน smoke test Dashboard อย่างน้อย:

- occupancy
- demographics
- registrations
- shelter ที่ไม่มีข้อมูล
- shelter ที่มี `active`, `pre_registered` และ `checked_out`

### Stage F — Observe

- staging ต้องผ่าน smoke/QA ก่อน production
- production เก็บ previous Design Document ไว้ตลอด rollback window
- monitor error rate, latency และ mismatch ของ aggregate
- mark release เป็น complete เมื่อ application และ shelter database ทุกแห่งอยู่ใน target version

### Stage G — Retire รุ่นเก่า

การลบ `_design/app__prev_<version>` เป็น maintenance job แยก ไม่ทำใน deployment เดียวกับ promote

ลบได้เมื่อ:

- rollback window สิ้นสุด
- ไม่มี application version ที่ใช้งาน View รุ่นนั้น
- verify ทุก shelter ผ่าน
- มี approval และ dry-run report

เสนอให้เก็บอย่างน้อย current และ previous version (`N` และ `N-1`) และเรียก `_view_cleanup`
ต่อ database หลังลบ เพื่อไม่ให้ index file ที่ไม่มีเจ้าของค้างบนดิสก์

## 5. ลำดับใน Jenkins ที่เสนอ

```text
Checkout
  ↓
Test + Build application/migration artifacts
  ↓
Detect manifest change + dry-run
  ↓
Deploy candidate + warm/verify ทุก shelter database
  ↓
Promote ไปยัง _design/app
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
- ห้ามส่ง URL ที่มี username/password เข้า console log — แต่ **ต้อง log host ของ endpoint**
  ที่ถูกเขียนทุกครั้ง
- pipeline ต้องมี timeout และ bounded retry
- manifest ที่ไม่เปลี่ยน ต้องไม่ทำให้ Design Document ถูก rewrite

## 6. Rollback

### กรณี View deploy ไม่ครบก่อน application deploy

- หยุด pipeline
- application รุ่นปัจจุบันยังอ่าน `_design/app` รุ่นเดิมที่ยังไม่ถูก promote
- แก้ shelter ที่ล้มเหลวแล้ว rerun runner ได้

### กรณี application ใหม่มีปัญหาหลัง promote

- rollback application image/config ไป commit ก่อนหน้า
- promote previous definition กลับมายัง `_design/app` แล้ว rollback application
- candidate ไม่จำเป็นต้องลบทันที

### กรณีข้อมูล aggregate ของ View ใหม่ผิด

- disable promotion หรือ rollback application
- เก็บ Design Document ที่มีปัญหาไว้เพื่อ investigation
- แก้ View ด้วย version ใหม่ ห้ามแก้ความหมายของ version ที่ถูก promote แล้วแบบเงียบ ๆ

## 7. ลำดับที่บังคับทางเทคนิค (ไม่ใช่แผนงาน)

CR นี้**ไม่กำหนดแผนดำเนินงาน phase, timeline หรือผู้รับผิดชอบ** — การจัดลำดับงาน การแบ่ง phase และ
การมอบหมาย owner เป็นของ project owner จัดการใน task-breakdown/Notion ตามปกติ

สิ่งที่ CR นี้บังคับคือ **ข้อจำกัดลำดับที่ผิดแล้วข้อมูลเสียหรือ service ดับ** ซึ่งต้องถูกบังคับใน
pipeline ตาม Stage A–G ใน §4 ไม่ใช่ด้วยวินัยของคน:

1. **View ต้องพร้อมก่อน consumer** — deploy + warm + verify ครบทุก shelter database ก่อน จึง
   deploy application ที่พึ่ง definition ใหม่ (Stage C→D→E) ข้อนี้ยังบังคับแม้ชื่อ Design Document
   ไม่เปลี่ยน เพราะ index ที่ยังไม่ build คืนผลว่าง (§3.6)
2. **application กับ migration artifact ต้องมาจาก Git commit เดียวกัน** (Stage A)
3. **staging ต้องผ่านก่อน production** และใช้ credential แยกกัน (§5)
4. **manifest ที่ไม่เปลี่ยน ต้องไม่ทำให้ Design Document ถูก rewrite** (§5)
5. **การลบ previous definition เป็น job แยกจาก deployment ที่ promote** (Stage G)

## 8. Acceptance Criteria

> implementation รอบแรกถูก revert เมื่อ 2026-07-27 เพื่อรอการตัดสินใจใน §3.0 ทุกข้อจึงยังเปิดอยู่

- [ ] manifest ของ `_design/app` เป็น view set ทั้งก้อน และ deploy แบบ replace ไม่ merge
- [ ] มี deterministic hash และ test ตรวจ View contract
- [ ] Map function เป็น deterministic — ห้ามใช้เวลาปัจจุบันใน map (ค่าที่ emit ถูก persist ใน B-tree
      ตอน index จึงค้างอยู่ที่เวลาที่ index ไม่ใช่เวลาที่ query) การจัด bucket ที่ขึ้นกับวันที่ต้องทำ
      ตอน query
- [ ] มีคำสั่ง dry-run, write และ verify โดย dry-run เป็นค่าเริ่มต้น
- [ ] runner อ่าน shelter จาก `registry` และรายงานผลครบทุก shelter database
- [ ] runner แยก preflight failure (database ไม่มี) ออกจาก lifecycle failure ใน report และ exit code
- [ ] runner ทำซ้ำได้โดยไม่สร้างผลข้างเคียง
- [ ] รองรับ bounded retry สำหรับ `409` และ transient failure
- [ ] candidate View ถูก warm ด้วย timeout ที่ยาวพอสำหรับ index build และ verify ก่อน promote
- [ ] พิสูจน์บน staging แล้วว่า signature ของ candidate ตรงกับ stable (§3.1) หรือถอด candidate ออก
- [ ] Design Document revision/hash ถูก verify หลัง deploy
- [ ] CI/CD เป็นผู้เขียน `_design/app` คนเดียว และ verify hash จับ drift ได้
- [ ] Jenkins staging และ production ใช้ credential แยกกัน และ log host ของ endpoint ที่เขียน
- [ ] pipeline หยุดก่อน application deploy เมื่อ View deployment ไม่ผ่าน policy
- [ ] application และ migration artifact มาจาก Git commit เดียวกัน
- [ ] มี smoke test สำหรับ Dashboard endpoints หลัง deploy
- [ ] rollback previous definition กลับมายัง `_design/app` ได้
- [ ] shelter ใหม่ได้รับ active View version ระหว่าง provisioning ผ่าน runner เดียวกัน
- [ ] มี report ที่ระบุ version/hash/commit/status ราย shelter
- [ ] การลบ definition รุ่นเก่าเป็น job แยกพร้อม dry-run, approval และ `_view_cleanup`

## 9. สิ่งที่ไม่อยู่ใน scope

- **การแยก Design Document ราย module (`_design/{module}`)** — ตัดออกจาก CR นี้ตาม §3.0
  จะแยกเป็น CR ใหม่เมื่อเข้าเงื่อนไขใน §3.0.2
- การเปลี่ยนชื่อ Design Document หรือ query path ของ consumer
- การเปลี่ยน schema ของ evacuee หรือ movement
- การเปลี่ยน business rule ของ occupancy และ registrations
- การ redesign หน้า Dashboard
- การสร้าง planned View ของ module ที่ยังไม่มี implementation จริง
- **edge/replica ต่อศูนย์ทั้งหมด** — endpoint discovery, replication policy/filter สำหรับ `_design/*`,
  สถานะ `pending` ของ edge ที่ offline, reconciliation job และการ warm index ที่ replica
  จะแยกเป็น CR ใหม่เมื่อ topology ของศูนย์ชัดเจน (ดู §3.5)

ไม่มีการ bump `schema_v` เพราะ CR นี้เปลี่ยน deployment lifecycle และ read model
ไม่เปลี่ยน shape ของ persisted business document

## 10. ความเสี่ยงและมาตรการควบคุม

| ความเสี่ยง                                         | มาตรการ                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| CouchDB load สูงจากการ build index พร้อมกัน        | จำกัด concurrency, batch rollout และ warm ทีละกลุ่ม                        |
| shelter บางแห่ง deploy ไม่สำเร็จ                   | per-shelter report, bounded retry และหยุดก่อน promote                      |
| index ยังไม่ build → consumer อ่านได้แต่ได้ผลว่าง  | warm จนเสร็จใน Stage D ก่อน promote และห้ามแปลง empty เป็น 0 (§11 ข้อ 6)   |
| แก้ View ตัวเดียวทำให้ทั้ง `_design/app` rebuild   | ยอมรับใน §3.0.1; วัดเวลา warm และเปิด CR แยก ddoc เมื่อเข้าเงื่อนไข §3.0.2 |
| runner merge View แล้ว hash ไม่ตรง manifest ตลอดไป | deploy แบบ replace เท่านั้น (§3.2)                                         |
| มีคนแก้ `_design/app` เองบน server                 | CI/CD เป็น single writer; verify hash จับ drift ได้                        |
| app/View version ไม่ตรงกัน                         | build จาก commit เดียวกันและตรวจ manifest compatibility                    |
| rollback ไม่ได้เพราะ definition เก่าถูกลบ          | เก็บ `N-1` และแยก cleanup ออกจาก deploy                                    |
| index file ที่ไม่มีเจ้าของค้างบนดิสก์              | `_view_cleanup` ต่อ database หลังลบ definition เก่า (Stage G)              |
| credential รั่วใน log                              | Jenkins Credentials, sanitize URL/error output, log เฉพาะ host             |
| View contract เปลี่ยนโดยไม่เพิ่ม version           | CI test และ manifest version policy                                        |

## 11. ประเด็นที่ขอให้ PO ตัดสินใจ

1. อนุมัติ **B (lifecycle runner)** — ให้ Map/Reduce ของ shelter เป็น deployment artifact ที่ต้องผ่าน
   CI/CD
2. **ยืนยันการไม่ทำ A** — คง `_design/app` เดียวตาม convention เดิม และรับเงื่อนไขที่จะกลับมา
   พิจารณาใน §3.0.2
3. อนุมัติให้ **CI/CD เป็นผู้เขียน `_design/app` คนเดียว และ deploy แบบ replace** — ทีมที่ต้องการ
   View ใหม่ต้องเพิ่มเข้า manifest กลางผ่าน PR ไม่ PUT เองบน server (§3.2)
4. เลือก production rollout policy: all-at-once หรือ staged batch
5. กำหนด rollback window สำหรับ candidate/previous Design Document
6. ยืนยันว่าเมื่อ query View ไม่สำเร็จ **หรือ index ยังไม่ build (ได้ผลว่าง)** Back-office ต้องแจ้ง
   error ส่วน Public Transparency ต้องคืน metric เป็น `null`/สถานะ stale — **ห้ามตีความเป็นศูนย์**
7. กำหนดว่า deploy/verify ล้มเหลวที่ shelter หนึ่งแห่ง ต้อง block ทั้ง release หรือปล่อยผ่านได้
   และ preflight failure (registry มี shelter แต่ database ไม่มี) ควร block หรือแค่รายงาน
8. ยืนยันว่า Dashboard/Public demographics ต้องนับเฉพาะ `active` — age view จะ emit `birth_year`
   แบบ deterministic และ API จะจัด bucket ตามปีปัจจุบันตอน query
9. จัดลำดับงาน/phase และมอบหมาย owner (CR นี้ไม่เสนอแผน — ให้ PO จัดใน task-breakdown, ดู §7 และ §12)

## 12. Task breakdown และ owner

ไม่อยู่ใน CR นี้ — project owner จัดการใน `docs/task-breakdown/` หรือ Notion ตามปกติ
CR นี้ให้เฉพาะ contract ที่งานเหล่านั้นต้องทำให้ผ่าน: Stage A–G (§4), ลำดับบังคับ (§7),
Acceptance Criteria (§8) และสิ่งที่อยู่นอก scope (§9)

## Migration

**ไม่มี read-model migration** — ชื่อ Design Document และ query path ของ consumer ไม่เปลี่ยน
สิ่งที่เปลี่ยนคือ definition ภายใน `_design/app` และวิธี deploy:

```text
_design/app (definition รุ่นเก่า, revision กระจัดกระจายตาม shelter)
    ↓ deploy candidate
_design/app__next_<hash>
    ↓ warm/verify ทุก shelter database
_design/app (promote definition ใหม่ ชื่อเดิม)
    ↓ retain _design/app__prev_<version> หนึ่งรุ่น
    ↓ retire + _view_cleanup after approval (Stage G)
```

## Decision log

- 2026-07-27 — proposed for PO review
- 2026-07-27 — แนะนำ candidate/previous rotation + deploy-before-application เพื่อรองรับ safe rollout/rollback
- 2026-07-27 — แนะนำ migration runner แยก เพราะ frontend production runtime ไม่มี toolchain สำหรับรัน TypeScript migration
- 2026-07-27 — **ถอด replication/edge contract ออกจาก scope** — CR นี้โฟกัสปัญหาเดียวคือ shelter
  database บน CouchDB ส่วนกลางค้าง Design Document รุ่นเก่า (§1.1) โดยเก็บข้อเท็จจริงที่ต้องจำไว้ใน §3.6
- 2026-07-27 — ถอดแผน phase และ task breakdown/owner ออกจาก CR — CR ให้เฉพาะ contract ที่ pipeline
  ต้องบังคับ (Stage A–G + ลำดับบังคับ + AC) ส่วนการจัดลำดับงานและ owner เป็นของ PO
- 2026-07-27 — **ถอด A (Design Document granularity `_design/{module}`) ออกจาก scope — คง
  `_design/app` เดียว** เหตุผล: มีชุด View เดียวจริง ประโยชน์ของการแยก (rebuild/`_rev`/rollback แยก)
  ยังไม่เกิดค่า ขณะที่ต้นทุนคือการย้าย query path ของ consumer ทุกตัวซึ่งเปิดความเสี่ยง `404` →
  ถูกตีความเป็นศูนย์ CR ยังเก็บเงื่อนไขที่จะกลับมาพิจารณาไว้ใน §3.0.2 พร้อมด้วยผลสืบเนื่องที่ตามมา:
  manifest ต้องเป็น view set ทั้งก้อนและ CI เป็น single writer มิฉะนั้น verify hash เป็นไปไม่ได้ (§3.2)
- 2026-07-27 — implementation รอบแรก (view-modules/view-lifecycle/runner + consumer ย้ายไป
  `_design/dashboard`) ถูก revert เพื่อรอการตัดสินใจข้างต้น
- 2026-07-27 — ถอด `--design` และ `--environment`/`TENT_ENV` ออกจาก runner: `--design` ไม่มี
  ความหมายเมื่อมี Design Document เดียว และ `--environment` เทียบค่าที่ผู้สั่งงานพิมพ์เองสองค่า
  จึงไม่เพิ่มการป้องกัน — การแยก environment มาจาก credential ต่อ CI job และให้ log host แทน (§1.5)
