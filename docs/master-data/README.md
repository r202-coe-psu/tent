---
title: Smart Shelter — Master Data Seed SSoT
status: draft
created: 2026-09-17
updated: 2026-09-25
language: th
---

# Smart Shelter — Master Data Seed SSoT

> **สรุป:** เอกสารนี้รวบรวมค่าที่คำสั่ง `pnpm seed:master` สร้างจริงใน registry master data, catalog reference data, SOP/Food Sphere และ app config · รายการที่ไม่มีในเอกสารนี้ไม่ถือว่าเป็นค่าเริ่มต้นจาก seed · หากเปลี่ยนค่าในเอกสาร ต้องเปลี่ยน executable seed ให้ตรงกันในการแก้ไขชุดเดียวกัน

## ขอบเขตและแหล่งข้อมูล

### ขอบเขต

`pnpm seed:master` เรียกใช้ `runMasterSeed()` และสร้างข้อมูลดังนี้:

| พื้นที่    | ข้อมูลที่ seed สร้าง                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| `registry` | global `master_data` 4 เอกสาร รวมรายการ seed 31 รายการ (CR-137)                                         |
| `registry` | `config:app` 1 singleton พร้อมค่า default                                                             |
| `registry` | `config:public_portal` 1 singleton พร้อมค่า default FAQ 13 รายการ (ช่องทางติดต่อเว้นว่างไว้ ไม่ seed) |
| `catalog`  | `unit_of_measure` 27, `item_category` 10, `item_master` 29, `recipe` 6                               |
| `catalog`  | SOP profile 1, audit 1 และ active pointer 1                                                           |
| `catalog`  | `requirement_group` 5, `food_sphere_standard` 24 และ `replenishment_policy` 5                         |

ข้อมูล shelter, users, evacuees, operations และ daily snapshots ที่สร้างโดย `pnpm seed` อยู่ใน staging seed จึงไม่รวมอยู่ใน SSoT ฉบับนี้

### แหล่งข้อมูลต้นทาง

- [master-defs.ts](../../frontend/scripts/seed/master-defs.ts) — รายการ `registry.master_data`
- [master-seed.ts](../../frontend/scripts/seed/master-seed.ts) — ลำดับและรูปแบบการสร้าง registry/catalog/config
- [unit-of-measure.ts](../../frontend/src/lib/features/catalog/domain/unit-of-measure.ts) — canonical UOM definitions 27 รายการ
- [master-data.ts](../../frontend/src/lib/features/master-data/domain/master-data.ts) — master type, schema และ vulnerable-group set
- [sop-ratio.fixture.ts](../../frontend/src/lib/features/sop-ratios/domain/sop-ratio.fixture.ts) — SOP ratio baseline
- [requirement-group.fixture.ts](../../frontend/src/lib/features/sop-ratios/domain/requirement-group.fixture.ts) — requirement groups
- [food-sphere.fixture.ts](../../frontend/src/lib/features/sop-ratios/domain/food-sphere.fixture.ts) — Food Sphere standards
- [replenishment-policy.fixture.ts](../../frontend/src/lib/features/sop-ratios/domain/replenishment-policy.fixture.ts) — replenishment policies
- [app-config.ts](../../frontend/src/lib/features/shared/domain/app-config.ts) — app config defaults
- [config.fixture.ts](../../frontend/src/lib/features/public-portal/domain/config.fixture.ts) — public portal config defaults
- [public-portal-config.md](./public-portal-config.md) — รายละเอียดชุดข้อมูล Public Portal config seed ฉบับสมบูรณ์

### กติกาของ SSoT

- **DOC-001** — รายการในตาราง `Seeded` ต้องตรงกับ executable source ทุก key, label, default, parent และค่าตัวเลข
- **DOC-002** — ค่าที่เป็นข้อเสนอหรือยังรอ owner ยืนยัน ต้องแยกไว้ในเอกสารอื่น และห้ามใส่รวมในตาราง seed
- **DOC-003** — เมื่อเพิ่ม ลบ หรือเปลี่ยนค่า seed ต้องอัปเดตเอกสารนี้และ source code ในการแก้ไขชุดเดียวกัน
- **DOC-004** — หากเปลี่ยน shape, `schema_v`, role, scope หรือ invariant ต้องแก้ technical schema และทำ CR ตาม `docs/change-management.md` ก่อน

## 1. Registry master data

### 1.1 Document contract

| Field                            | ค่า seed                           |
| -------------------------------- | ---------------------------------- |
| Database                         | `registry`                         |
| Document type                    | `master_data`                      |
| Global document ID               | `master_data:{master_type}`        |
| `schema_v`                       | `4`                                |
| Item status                      | `active` สำหรับรายการที่ seed ใหม่ |
| Author                           | `seed`                             |
| Global scope                     | ไม่มี `shelter_code`               |
| จำนวน master types               | 4 (CR-137)                         |
| จำนวนรายการใน canonical seed set | 31                                 |

Global seed ใช้ `enforceOneDefault()` เพื่อให้แต่ละ master type มีรายการที่เป็น default ได้ไม่เกินหนึ่งรายการ หากเอกสารเดิมมีรายการที่ไม่มีอยู่ใน canonical seed set ระบบจะเก็บรายการเดิมไว้ เว้นแต่เข้าเงื่อนไข migration ใน §1.4 ดังนั้น ตารางด้านล่างจึงเป็น **รายการที่ seed กำหนด** ไม่ใช่รายการทั้งหมดที่อาจมีอยู่ใน database แล้ว

### 1.2 ความหมายของ code และ key

`SeedItemDef.key` คือค่าที่บันทึกเป็น `MasterDataItem.code` (semantic snake_case) สำหรับ **ทุก** master type

| Master type | Persisted code |
| --- | --- |
| `vulnerable_group` | `d.key` (stable) |
| `housing_type` | `d.key` (stable) |
| `shelter_type` | `d.key` (stable) — เลิก `item_<ulid>` |
| `volunteer_skills` | `d.key` (stable) — เลิก `item_<ulid>` |

รายการเก็บชื่อแบบ bilingual: `label_th` + `label_en` (ทั้งคู่บังคับ). UI สร้างรายการใหม่ต้องกรอก `code` เอง (ไม่มี auto-ULID). รายการเก่า `item_*` แก้รหัสได้ตอนแก้ไข.

**CR-137:** `municipality_zone` / `community` ไม่ใช่ master types — เป็น free-text บน household/shelter docs. `pets.species` เป็น domain enum `dog|cat|other` (ไม่ seed `pet_types`).

### 1.3 Canonical seeded items

#### `vulnerable_group` — กลุ่มเปราะบาง

| code                | label_th                             | label_en | default |
| ------------------- | ------------------------------------ | -------- | ------- |
| `bedridden`         | ผู้ป่วยติดเตียง                      | Bedridden | —       |
| `dialysis`          | ผู้ป่วยฟอกไต                         | Dialysis patient | —       |
| `wheelchair`        | ผู้ใช้วีลแชร์                        | Wheelchair user | —       |
| `psychiatric`       | ผู้ป่วยจิตเวช                        | Psychiatric patient | —       |
| `elderly_dependent` | ผู้สูงอายุช่วยเหลือตัวเองไม่ได้      | Dependent elderly | —       |
| `infant`            | ทารก                                 | Infant | —       |
| `young_child`       | เด็กเล็ก                             | Young child | —       |
| `pregnant`          | สตรีมีครรภ์                          | Pregnant | —       |
| `vision_impaired`   | ผู้พิการทางการมองเห็น                | Vision impaired | —       |
| `hearing_impaired`  | ผู้พิการทางการได้ยิน                 | Hearing impaired | —       |
| `disability_other`  | ผู้พิการ (อื่นๆ / ไม่ระบุรายละเอียด) | Disability (other / unspecified) | —       |
| `chronic_illness`   | ผู้มีโรคประจำตัว/เรื้อรัง            | Chronic illness | —       |

#### `housing_type` — ประเภทที่อยู่อาศัย

| code             | label_th                          | label_en | default |
| ---------------- | --------------------------------- | -------- | ------- |
| `owned_house`    | บ้านตนเอง                         | Owned house | **ใช่** |
| `rented_house`   | บ้านเช่า                          | Rented house | —       |
| `condo`          | คอนโดมิเนียม                      | Condominium | —       |
| `apartment_dorm` | อพาร์ตเมนต์/หอพัก                 | Apartment / dormitory | —       |
| `homeless`       | ไร้ที่อยู่อาศัย / ไม่มีบ้านเลขที่ | Homeless / no house number | —       |

#### `shelter_type` — ประเภทศูนย์พักพิง

| code                  | label_th    | label_en | default |
| --------------------- | ----------- | -------- | ------- |
| `school`              | โรงเรียน    | School | **ใช่** |
| `community_hall`      | ศาลาประชาคม | Community hall | —       |
| `temple`              | วัด         | Temple | —       |
| `government_building` | อาคารราชการ | Government building | —       |
| `sports_centre`       | ศูนย์กีฬา   | Sports centre | —       |

#### `volunteer_skills` — ทักษะมาตรฐานจิตอาสา

Seed ลง global `master_data:volunteer_skills` จำนวน 9 รายการ โดยมี `category: operational` 8 รายการ และ `category: controlled` 1 รายการ (`medical`)

| code | label_th | label_en | category | description | default |
| --- | --- | --- | --- | --- | --- |
| `cooking` | ประกอบอาหาร / ครัวสนาม | Cooking / field kitchen | `operational` | ช่วยเตรียมวัตถุดิบ ปรุงอาหาร แจกอาหารครัวกลาง | **ใช่** |
| `logistics` | ขนย้ายสิ่งของ / พลาธิการ | Logistics / supply movement | `operational` | ขนย้ายกระสอบทราย ลำเลียงถุงยังชีพ ยกของหนัก | — |
| `screening` | คัดกรองและสแกนประวัติ | Screening and registration | `operational` | ต้อนรับ ลงทะเบียน คัดกรองประวัติผู้ประสบภัยเบื้องต้น | — |
| `medical` | การแพทย์ / ปฐมพยาบาล | Medical / first aid | `controlled` | ปฐมพยาบาลเบื้องต้น วัดสัญญาณชีพ (ต้องผ่านการตรวจรับรองใบประกอบวิชาชีพ) | — |
| `reception` | ประสานงาน / ต้อนรับ | Coordination / reception | `operational` | ต้อนรับผู้ประสบภัย ประสานงานระหว่างจุดบริการ | — |
| `distribution` | แจกจ่ายของยังชีพ | Relief distribution | `operational` | แจกจ่ายถุงยังชีพ น้ำดื่ม เครื่องอุปโภคบริโภค | — |
| `sanitation` | ทำความสะอาด / สุขอนามัย | Cleaning / sanitation | `operational` | ทำความสะอาดพื้นที่ส่วนกลาง ดูแลสุขอนามัยในศูนย์ | — |
| `childcare` | สันทนาการ / ดูแลเด็ก | Recreation / childcare | `operational` | กิจกรรมสันทนาการ ดูแลเด็กและผู้สูงอายุ | — |
| `transport` | ขับขี่ยานพาหนะ / ขนส่ง | Driving / transport | `operational` | ขับขี่ยานพาหนะขนส่งคนและสิ่งของ | — |

### 1.4 การย้ายข้อมูลเดิมและการ seed ซ้ำ

- code เดิมของกลุ่มเปราะบาง `elderly` จะถูกย้ายเป็น `elderly_dependent`
- code เดิมของกลุ่มเปราะบาง `disabled` จะถูกย้ายเป็น `disability_other`
- label เดิม `ผู้สูงอายุ`, `ผู้พิการ` และ `ผู้ป่วยเรื้อรัง` ใช้ช่วยค้นหารายการปลายทางระหว่าง migration
- เมื่อ seed ซ้ำ ระบบจับคู่ด้วย `label_th` หรือ `code`/`key` — ถ้า reuse ได้ `item_*` แต่ `d.key` ว่าง จะ**เขียนทับเป็น `d.key`** สำหรับรายการจาก seed defs; extras ที่ผู้ใช้สร้างเองไม่แตะ
- schema_v ของเอกสารที่ seed เขียน = **4** (bilingual labels)
- **CR-137:** seed ไม่สร้าง `health_condition` / `dietary_restrictions` / `pet_types` / `house_damage` / `municipality_zone` / `community` อีก; orphan docs ใน DB ถูกละเว้นโดย enum

## 2. Catalog seed

ข้อมูลส่วนนี้เป็นข้อมูลอ้างอิงที่ seed ลงใน `catalog` ไม่ใช่ `registry.master_data`

### 2.1 `unit_of_measure`

หน่วยนับเป็น global master data ในฐานข้อมูล `catalog` เท่านั้น ใช้เป็น source of record สำหรับ
ทุก field หน่วยของ `item_master`: `base_unit`, `default_inventory_uom`, `default_issue_uom` และ
`conversions[].uom_name`. ชื่อบรรจุภัณฑ์ไม่ใช่ UOM code; ให้เก็บจำนวนต่อบรรจุภัณฑ์ใน
`conversions[].multiplier` โดย `shelter_*` เป็น read-only replica และห้ามเขียนเอกสารชนิดนี้

#### Document contract

| Field          | ค่า seed                                                           |
| -------------- | ------------------------------------------------------------------ |
| Database       | `catalog`                                                          |
| Document type  | `unit_of_measure`                                                  |
| `_id`          | `unit_of_measure:{code}`                                           |
| `schema_v`     | `1`                                                                |
| `is_protected` | `true` สำหรับทุก canonical unit                                    |
| `deactivated`  | `false` เมื่อสร้างใหม่; ค่าเดิมของ operator ถูกคงไว้เมื่อ seed ซ้ำ |
| Code           | lowercase `[a-z][a-z0-9_]{0,15}` และ immutable                     |
| Dimensions     | `count`, `mass`, `volume`, `length`                                |

#### Canonical seeded units

รายการด้านล่างตรงกับ `FALLBACK_UNIT_DEFINITIONS` และ seed ใหม่ด้วย `sort_order` 1–27:

| sort_order | code       | label_th  | label_th_short | label_en | dimension |
| ---------: | ---------- | --------- | -------------- | -------- | --------- |
|          1 | `piece`    | ชิ้น      | —              | pcs      | count     |
|          2 | `unit`     | หน่วย     | —              | unit     | count     |
|          3 | `item`     | อัน       | —              | item     | count     |
|          4 | `set`      | ชุด       | —              | set      | count     |
|          5 | `pair`     | คู่       | —              | pair     | count     |
|          6 | `box`      | กล่อง     | —              | box      | count     |
|          7 | `pack`     | แพ็ค      | —              | pack     | count     |
|          8 | `bag`      | ถุง       | —              | bag      | count     |
|          9 | `sachet`   | ซอง       | —              | sachet   | count     |
|         10 | `bottle`   | ขวด       | —              | bottle   | count     |
|         11 | `can`      | กระป๋อง   | —              | can      | count     |
|         12 | `tablet`   | เม็ด      | —              | tab      | count     |
|         13 | `bar`      | ก้อน      | —              | bar      | count     |
|         14 | `tube`     | หลอด      | —              | tube     | count     |
|         15 | `roll`     | ม้วน      | —              | roll     | count     |
|         16 | `sheet`    | แผ่น      | —              | sheet    | count     |
|         17 | `cloth`    | ผืน       | —              | cloth    | count     |
|         18 | `bundle`   | ห่อ       | —              | bundle   | count     |
|         19 | `egg`      | ฟอง       | —              | egg      | count     |
|         20 | `fruit`    | ผล        | —              | fruit    | count     |
|         21 | `gallon`   | แกลลอน    | —              | gallon   | volume    |
|         22 | `cylinder` | ถัง       | —              | cylinder | count     |
|         23 | `g`        | กรัม      | ก.             | g        | mass      |
|         24 | `kg`       | กิโลกรัม  | กก.            | kg       | mass      |
|         25 | `ml`       | มิลลิลิตร | มล.            | ml       | volume    |
|         26 | `l`        | ลิตร      | ล.             | L        | volume    |
|         27 | `m`        | เมตร      | ม.             | m        | length    |

จำนวนตาม dimension: `count` 21, `mass` 2, `volume` 3 และ `length` 1

#### Seed and update behavior

- เอกสารที่ไม่พบจะถูกสร้างแบบ deterministic ด้วย metadata ของ seed และ `is_protected: true`
- เอกสารที่มีอยู่จะถูก read-modify-write พร้อม `_rev` ล่าสุด
- การ seed ซ้ำจะคง `label_th`, `label_th_short`, `label_en`, `sort_order`, `deactivated` และ metadata เดิมที่ operator แก้ไขไว้
- Seeder จะบังคับ `code`, `dimension`, `schema_v: 1` และ `is_protected: true` ให้ตรงกับ canonical definition
- หากการอ่านเอกสารตอบสถานะอื่นนอกจาก `200` หรือ `404` ให้หยุดด้วย error และไม่พยายามสร้างเอกสารทับ
- หาก PUT ชน `409` จะอ่าน revision ล่าสุดแล้ว retry สูงสุด 3 ครั้ง; สถานะ PUT อื่นที่ไม่ใช่ 2xx ทำให้ seed ล้มเหลว
- เอกสารเดิมที่มี identity, revision หรือ common envelope ไม่ถูกต้องจะถูก reject เพื่อไม่เขียนทับเอกสารที่มี shape เสีย
- การเปลี่ยน code ต้องสร้างหน่วยใหม่และ deactivate หน่วยเดิม; ห้ามลบ protected unit

### 2.2 `item_category`

หมวดหมู่สิ่งของมาตรฐานมี 10 รายการ ใช้ `schema_v: 2` สร้างด้วย `_id` รูปแบบ `item_category:{ulid}` และเก็บชื่อเป็นภาษาไทย:

| `_id`                  | name                           |
| ---------------------- | ------------------------------ |
| `item_category:{ulid}` | อาหารและวัตถุดิบ               |
| `item_category:{ulid}` | น้ำดื่มสะอาด                   |
| `item_category:{ulid}` | สุขอนามัยและของใช้ส่วนตัว      |
| `item_category:{ulid}` | เวชภัณฑ์และการปฐมพยาบาล        |
| `item_category:{ulid}` | ของใช้กลุ่มเปราะบาง            |
| `item_category:{ulid}` | อุปกรณ์เจ้าหน้าที่และอาสาสมัคร |
| `item_category:{ulid}` | อาหารปรุงเสร็จและเครื่องดื่ม   |
| `item_category:{ulid}` | เครื่องนอนและที่พักพิง         |
| `item_category:{ulid}` | เชื้อเพลิงและพลังงาน           |
| `item_category:{ulid}` | ชุดพัสดุยังชีพรวม              |

### 2.3 `item_master`

รายการสิ่งของหลักมี 29 รายการ ใช้ `schema_v: 4` สร้างด้วย `_id` รูปแบบ `item_master:{ulid}` และผูกกับ `category` ตามชื่อหมวดหมู่ภาษาไทย:

ค่า `base_unit`, `default_inventory_uom`, `default_issue_uom` และ `conversions[].uom_name`
ของ item master ที่สร้างใหม่ต้องเป็น canonical code จาก `unit_of_measure` เช่น `bag`, `box`,
`pack`, `set` และ `piece`; จำนวนต่อบรรจุภัณฑ์เก็บใน `conversions[].multiplier`. เมื่อ seed ซ้ำ
ระบบจะคงค่า canonical/custom UOM ที่มีอยู่ และ normalize ชื่อบรรจุภัณฑ์ legacy ที่ไม่ใช่ code
กลับเป็นค่า canonical ของ item โดยไม่แก้ไข stock ledger ย้อนหลัง. `base_unit` legacy เดิมของ
item ที่มีอยู่จะคงไว้เพื่อไม่ทำให้ `stock_ledger.unit` ย้อนหลังไม่ตรงกัน; item ใหม่ใช้ canonical
code เสมอ. หากไม่มีค่า default เฉพาะ ระบบจะใช้ `base_unit` เป็นค่า `default_inventory_uom` และ
`default_issue_uom`.

| `_id`                | name                     | category                       | base_unit  | type_class   | conversions                | inventory / issue uom | storage / shelf life     | properties / flags                                           |
| -------------------- | ------------------------ | ------------------------------ | ---------- | ------------ | -------------------------- | --------------------- | ------------------------ | ------------------------------------------------------------ |
| `item_master:{ulid}` | ข้าวสาร                  | อาหารและวัตถุดิบ               | `kg`       | `CONSUMABLE` | `bag` (x5), `bag` (x50)    | `bag` / kg            | DRY / 365 วัน            | ผูก `FOOD_ENERGY`                                            |
| `item_master:{ulid}` | ไข่ไก่                   | อาหารและวัตถุดิบ               | `piece`    | `CONSUMABLE` | `pack` (x30)               | `pack` / piece        | DRY / 21 วัน             | ผูก `FOOD_PROTEIN`                                           |
| `item_master:{ulid}` | ผักรวม                   | อาหารและวัตถุดิบ               | `kg`       | `CONSUMABLE` | —                          | kg / kg               | CHILLED / 5 วัน          | —                                                            |
| `item_master:{ulid}` | ปลากระป๋อง               | อาหารและวัตถุดิบ               | `can`      | `CONSUMABLE` | `pack` (x10), `box` (x100) | `box` / can           | DRY / 730 วัน            | `dietary: ['HALAL']`                                         |
| `item_master:{ulid}` | เนื้อไก่สด               | อาหารและวัตถุดิบ               | `kg`       | `CONSUMABLE` | —                          | kg / kg               | CHILLED / 3 วัน          | `dietary: ['HALAL']`                                         |
| `item_master:{ulid}` | น้ำมันพืช                | อาหารและวัตถุดิบ               | `bottle`   | `CONSUMABLE` | `box` (x12)                | `box` / bottle        | DRY / 365 วัน            | `dietary: ['HALAL']`, ผูก `FOOD_FAT`                         |
| `item_master:{ulid}` | น้ำดื่ม 600 มล.          | น้ำดื่มสะอาด                   | `bottle`   | `CONSUMABLE` | `pack` (x12)               | `pack` / bottle       | DRY / 365 วัน            | ผูก `DRINKING_WATER`                                         |
| `item_master:{ulid}` | น้ำดื่มถัง 5 ลิตร        | น้ำดื่มสะอาด                   | `bottle`   | `CONSUMABLE` | `pack` (x4)                | `pack` / bottle       | DRY / 365 วัน            | ผูก `DRINKING_WATER`                                         |
| `item_master:{ulid}` | สบู่ก้อน                 | สุขอนามัยและของใช้ส่วนตัว      | `bar`      | `CONSUMABLE` | `pack` (x4)                | `pack` / bar          | DRY / 730 วัน            | —                                                            |
| `item_master:{ulid}` | ยาสีฟัน                  | สุขอนามัยและของใช้ส่วนตัว      | `tube`     | `CONSUMABLE` | `pack` (x6)                | `pack` / tube         | DRY / 730 วัน            | —                                                            |
| `item_master:{ulid}` | แปรงสีฟัน                | สุขอนามัยและของใช้ส่วนตัว      | `piece`    | `CONSUMABLE` | `pack` (x12)               | `pack` / piece        | DRY / —                  | —                                                            |
| `item_master:{ulid}` | ผ้าอนามัย                | สุขอนามัยและของใช้ส่วนตัว      | `pack`     | `CONSUMABLE` | `box` (x24)                | `box` / pack          | DRY / 1095 วัน           | `target_gender: 'FEMALE'`                                    |
| `item_master:{ulid}` | ผงซักฟอก                 | สุขอนามัยและของใช้ส่วนตัว      | `bag`      | `CONSUMABLE` | `box` (x12)                | `box` / bag           | DRY / 730 วัน            | —                                                            |
| `item_master:{ulid}` | ยาพาราเซตามอล 500 มก.    | เวชภัณฑ์และการปฐมพยาบาล        | `tablet`   | `CONSUMABLE` | `pack` (x10), `box` (x100) | `box` / tablet        | CONTROLLED_MED / 730 วัน | —                                                            |
| `item_master:{ulid}` | ชุดทำแผลปฐมพยาบาล        | เวชภัณฑ์และการปฐมพยาบาล        | `set`      | `CONSUMABLE` | `box` (x10)                | `box` / set           | DRY / 730 วัน            | —                                                            |
| `item_master:{ulid}` | แอลกอฮอล์ล้างแผล 70%     | เวชภัณฑ์และการปฐมพยาบาล        | `bottle`   | `CONSUMABLE` | `box` (x24)                | `box` / bottle        | DRY / 1095 วัน           | —                                                            |
| `item_master:{ulid}` | ผงเกลือแร่ ORS           | เวชภัณฑ์และการปฐมพยาบาล        | `sachet`   | `CONSUMABLE` | `box` (x50)                | `box` / sachet        | DRY / 730 วัน            | —                                                            |
| `item_master:{ulid}` | ผ้าอ้อมผู้ใหญ่ ไซส์ L    | ของใช้กลุ่มเปราะบาง            | `piece`    | `CONSUMABLE` | `pack` (x10), `box` (x80)  | `box` / piece         | DRY / 1095 วัน           | `age_group: 'ELDERLY'`                                       |
| `item_master:{ulid}` | ผ้าอ้อมเด็ก ไซส์ M       | ของใช้กลุ่มเปราะบาง            | `piece`    | `CONSUMABLE` | `pack` (x20), `box` (x120) | `box` / piece         | DRY / 1095 วัน           | `age_group: 'CHILD'`                                         |
| `item_master:{ulid}` | นมผงสำหรับทารก           | ของใช้กลุ่มเปราะบาง            | `can`      | `CONSUMABLE` | `box` (x12)                | `box` / can           | DRY / 365 วัน            | `age_group: 'INFANT'`                                        |
| `item_master:{ulid}` | เสื้อกั๊กสะท้อนแสง       | อุปกรณ์เจ้าหน้าที่และอาสาสมัคร | `piece`    | `EQUIPMENT`  | —                          | — / —                 | —                        | `returnable: true`, `asset_status: 'READY'`                  |
| `item_master:{ulid}` | รองเท้าบูทยางกันน้ำ      | อุปกรณ์เจ้าหน้าที่และอาสาสมัคร | `pair`     | `EQUIPMENT`  | —                          | — / —                 | —                        | `returnable: true`, `asset_status: 'READY'`                  |
| `item_master:{ulid}` | ข้าวกล่องทั่วไป          | อาหารปรุงเสร็จและเครื่องดื่ม   | `box`      | `CONSUMABLE` | —                          | box / box             | DRY / 1 วัน              | `distribution_type: 'recurring'`                             |
| `item_master:{ulid}` | ข้าวกล่องฮาลาล           | อาหารปรุงเสร็จและเครื่องดื่ม   | `box`      | `CONSUMABLE` | —                          | box / box             | DRY / 1 วัน              | `distribution_type: 'recurring'`, `dietary: ['HALAL']`       |
| `item_master:{ulid}` | ผ้าห่มกันหนาว            | เครื่องนอนและที่พักพิง         | `piece`    | `DURABLE`    | `bundle` (x10)             | `bundle` / piece      | —                        | `returnable: true`, `qty_per_person: 1`, `one_time`          |
| `item_master:{ulid}` | เสื่อปูนอน               | เครื่องนอนและที่พักพิง         | `piece`    | `DURABLE`    | `bundle` (x10)             | `bundle` / piece      | —                        | `returnable: true`, `qty_per_person: 1`, `one_time`          |
| `item_master:{ulid}` | เต็นท์ครอบครัว           | เครื่องนอนและที่พักพิง         | `piece`    | `DURABLE`    | —                          | piece / piece         | —                        | `returnable: true`, `qty_per_person: 1`, `one_time`          |
| `item_master:{ulid}` | ถังแก๊สหุงต้ม LPG 15 กก. | เชื้อเพลิงและพลังงาน           | `cylinder` | `CONSUMABLE` | —                          | cylinder / cylinder   | —                        | `fuel_type: 'LPG'`, `capacity_kg: '15'`, `burn_rate: '0.35'` |
| `item_master:{ulid}` | ถุงยังชีพธารน้ำใจ        | ชุดพัสดุยังชีพรวม              | `set`      | `CONSUMABLE` | —                          | set / set             | DRY / 180 วัน            | `distribution_type: 'one_time'`                              |

### 2.4 `recipe`

สูตรอาหารมาตรฐานสำหรับโรงครัวศูนย์พักพิงมี 6 รายการ ใช้ `schema_v: 4`, `standard_portions: "1"` และ `standard_duration_hours: "1"` และสร้างด้วย `_id` รูปแบบ `recipe:{ulid}`:

| `_id`           | label                    | ingredients                                       |
| --------------- | ------------------------ | ------------------------------------------------- |
| `recipe:{ulid}` | ข้าวไข่เจียว             | ข้าวสาร 0.2 kg; ไข่ไก่ 2 piece                    |
| `recipe:{ulid}` | ข้าวต้มไก่สับ            | ข้าวสาร 0.15 kg; เนื้อไก่สด 0.1 kg                |
| `recipe:{ulid}` | ข้าวกะเพราไก่สับ         | ข้าวสาร 0.2 kg; เนื้อไก่สด 0.15 kg                |
| `recipe:{ulid}` | ข้าวไก่ผัดกระเทียม       | ข้าวสาร 0.2 kg; เนื้อไก่สด 0.15 kg                |
| `recipe:{ulid}` | ข้าวไข่พะโล้ไก่          | ข้าวสาร 0.2 kg; ไข่ไก่ 2 piece; เนื้อไก่สด 0.1 kg |
| `recipe:{ulid}` | ข้าวปลากระป๋องทรงเครื่อง | ข้าวสาร 0.2 kg; ปลากระป๋อง 0.5 can                |

## 3. SOP ratio seed

การ seed จะสร้าง profile ใน `catalog` ดังนี้:

| รายการ         | ค่า                                  |
| -------------- | ------------------------------------ |
| profile ID     | `sop_profile:master_sphere_baseline` |
| name           | `Sphere Baseline`                    |
| slug           | `sphere-baseline`                    |
| `schema_v`     | `3`                                  |
| version        | `1`                                  |
| active         | `true`                               |
| active pointer | `sop_profile_active:global`          |
| audit ID       | `audit:seed_sphere_baseline`         |

### `sop_profile.ratios`

ค่าทั้งหมดจะถูกบันทึกเป็น string ตาม strict 20-key schema

| key                               |    ค่า | หน่วย/ความหมาย          |
| --------------------------------- | -----: | ----------------------- |
| `water_l_per_person_day`          |   `15` | ลิตรน้ำรวม/คน/วัน       |
| `drinking_water_l_per_person_day` |    `3` | ลิตรน้ำดื่ม/คน/วัน      |
| `cooking_water_l_per_person_day`  |    `6` | ลิตรน้ำทำอาหาร/คน/วัน   |
| `hygiene_water_l_per_person_day`  |    `6` | ลิตรน้ำสุขอนามัย/คน/วัน |
| `kcal_per_adult_day`              | `2000` | kcal/ผู้ใหญ่/วัน        |
| `people_per_tap`                  |   `80` | คน/ก๊อก                 |
| `people_per_handpump`             |  `500` | คน/hand pump            |
| `people_per_open_well`            |  `400` | คน/บ่อเปิด              |
| `people_per_laundry`              |  `100` | คน/จุดซักผ้า            |
| `people_per_bathing`              |   `50` | คน/จุดอาบน้ำ            |
| `people_per_toilet_female`        |   `20` | คน/ห้องน้ำหญิง          |
| `people_per_toilet_male`          |   `35` | คน/ห้องน้ำชาย           |
| `people_per_dining_point_adult`   |   `20` | คน/จุดแจกอาหารผู้ใหญ่   |
| `people_per_dining_point_child`   |   `10` | คน/จุดแจกอาหารเด็ก      |
| `m2_per_person_living`            |  `3.5` | m²/คน                   |
| `m2_per_person_living_cold`       |  `4.5` | m²/คน เขตหนาว           |
| `m2_per_person_total`             |   `45` | m²/คนรวม                |
| `max_waterpoint_distance_m`       |  `500` | ระยะสูงสุดจุดน้ำ เมตร   |
| `max_queue_minutes`               |   `30` | เวลารอสูงสุด นาที       |
| `people_per_volunteer`            |   `50` | คน/อาสาสมัคร            |

## 4. Food Sphere และ replenishment seed

### 4.1 `requirement_group`

เอกสารทุกฉบับมี `schema_v: 1`, `status: active`, `source: SPHERE_BASELINE`, `created_by: system` และวันที่ `2026-07-16`

| `_id`                                  | name                             | standard_uom | item map                                                                                                          |
| -------------------------------------- | -------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `requirement_group:FOOD_ENERGY`        | กลุ่มแป้งและพลังงานหลัก          | `kcal`       | ข้าวสาร (`kg`), factor `3600`, share `100%`                                                                       |
| `requirement_group:FOOD_PROTEIN`       | กลุ่มโปรตีนและเนื้อสัตว์         | `gram`       | ไข่ไก่ (`piece`), factor `6.3`, share `50%`<br/>ปลากระป๋อง (`can`), factor `17`, share `50%`                      |
| `requirement_group:FOOD_PROTEIN_HALAL` | กลุ่มโปรตีนและเนื้อสัตว์ (ฮาลาล) | `gram`       | เนื้อไก่สด (`kg`), factor `200`, share `70%`<br/>ไข่ไก่ (`piece`), factor `6.3`, share `30%`                      |
| `requirement_group:FOOD_FAT`           | กลุ่มน้ำมันและไขมัน              | `gram`       | น้ำมันพืช (`bottle`), factor `900`, share `100%`                                                                  |
| `requirement_group:DRINKING_WATER`     | กลุ่มน้ำดื่มสะอาด                | `liter`      | น้ำดื่ม 600 มล. (`bottle`), factor `0.6`, share `70%`<br/>น้ำดื่มถัง 5 ลิตร (`bottle`), factor `5.0`, share `30%` |

> **หมายเหตุ:** ในฐานข้อมูลจริง ระบบจะ resolve `item_maps[].item_id` เป็น `item_master:{ulid}` ที่ตรงกับรายการจริงโดยอัตโนมัติขณะรัน seed โดยค้นหาจากชื่อสิ่งของภาษาไทย

### 4.2 `food_sphere_standard`

เอกสารทุกฉบับมี `schema_v: 1`, `effective_date: 2026-07-16`, `status: active`, `source: SPHERE_BASELINE` และ `created_by: system` รวม 24 รายการ

| `_id`                                               | target segment | requirement group    | daily demand | unit  |
| --------------------------------------------------- | -------------- | -------------------- | -----------: | ----- |
| `food_sphere_standard:ALL:FOOD_ENERGY`              | `ALL`          | `FOOD_ENERGY`        |         2100 | kcal  |
| `food_sphere_standard:ALL:FOOD_FAT`                 | `ALL`          | `FOOD_FAT`           |           40 | gram  |
| `food_sphere_standard:ALL:FOOD_PROTEIN`             | `ALL`          | `FOOD_PROTEIN`       |           53 | gram  |
| `food_sphere_standard:ALL:FOOD_PROTEIN_HALAL`       | `ALL`          | `FOOD_PROTEIN_HALAL` |           53 | gram  |
| `food_sphere_standard:ALL:DRINKING_WATER`           | `ALL`          | `DRINKING_WATER`     |            3 | liter |
| `food_sphere_standard:INFANT_0_6:FOOD_ENERGY`       | `INFANT_0_6`   | `FOOD_ENERGY`        |          550 | kcal  |
| `food_sphere_standard:INFANT_6_23:FOOD_ENERGY`      | `INFANT_6_23`  | `FOOD_ENERGY`        |          850 | kcal  |
| `food_sphere_standard:CHILD_2_5:FOOD_ENERGY`        | `CHILD_2_5`    | `FOOD_ENERGY`        |         1250 | kcal  |
| `food_sphere_standard:CHILD_2_5:FOOD_PROTEIN`       | `CHILD_2_5`    | `FOOD_PROTEIN`       |           25 | gram  |
| `food_sphere_standard:CHILD_2_5:FOOD_PROTEIN_HALAL` | `CHILD_2_5`    | `FOOD_PROTEIN_HALAL` |           25 | gram  |
| `food_sphere_standard:CHILD_2_5:DRINKING_WATER`     | `CHILD_2_5`    | `DRINKING_WATER`     |          1.5 | liter |
| `food_sphere_standard:PREGNANT:FOOD_ENERGY`         | `PREGNANT`     | `FOOD_ENERGY`        |         2400 | kcal  |
| `food_sphere_standard:PREGNANT:FOOD_PROTEIN`        | `PREGNANT`     | `FOOD_PROTEIN`       |           70 | gram  |
| `food_sphere_standard:PREGNANT:FOOD_PROTEIN_HALAL`  | `PREGNANT`     | `FOOD_PROTEIN_HALAL` |           70 | gram  |
| `food_sphere_standard:PREGNANT:FOOD_FAT`            | `PREGNANT`     | `FOOD_FAT`           |           45 | gram  |
| `food_sphere_standard:PREGNANT:DRINKING_WATER`      | `PREGNANT`     | `DRINKING_WATER`     |          3.5 | liter |
| `food_sphere_standard:LACTATING:FOOD_ENERGY`        | `LACTATING`    | `FOOD_ENERGY`        |         2600 | kcal  |
| `food_sphere_standard:LACTATING:FOOD_PROTEIN`       | `LACTATING`    | `FOOD_PROTEIN`       |           75 | gram  |
| `food_sphere_standard:LACTATING:FOOD_PROTEIN_HALAL` | `LACTATING`    | `FOOD_PROTEIN_HALAL` |           75 | gram  |
| `food_sphere_standard:LACTATING:DRINKING_WATER`     | `LACTATING`    | `DRINKING_WATER`     |            4 | liter |
| `food_sphere_standard:ELDERLY:FOOD_ENERGY`          | `ELDERLY`      | `FOOD_ENERGY`        |         1900 | kcal  |
| `food_sphere_standard:ELDERLY:FOOD_PROTEIN`         | `ELDERLY`      | `FOOD_PROTEIN`       |           60 | gram  |
| `food_sphere_standard:ELDERLY:FOOD_PROTEIN_HALAL`   | `ELDERLY`      | `FOOD_PROTEIN_HALAL` |           60 | gram  |
| `food_sphere_standard:ELDERLY:DRINKING_WATER`       | `ELDERLY`      | `DRINKING_WATER`     |          2.5 | liter |

### 4.3 `replenishment_policy`

เอกสารทุกฉบับมี `schema_v: 1`, `scope_type: REQUIREMENT_GROUP`, `status: active`, `source: SPHERE_BASELINE` และ `created_by: system` รวม 5 รายการ

| `_id`                                                       | target               | lead time (วัน) | review period (วัน) | safety (วัน) | min days | max days |
| ----------------------------------------------------------- | -------------------- | --------------: | ------------------: | -----------: | -------: | -------: |
| `replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY`        | `FOOD_ENERGY`        |               3 |                   4 |            3 |        3 |       45 |
| `replenishment_policy:REQUIREMENT_GROUP:FOOD_PROTEIN`       | `FOOD_PROTEIN`       |               2 |                   2 |            2 |        2 |       20 |
| `replenishment_policy:REQUIREMENT_GROUP:FOOD_PROTEIN_HALAL` | `FOOD_PROTEIN_HALAL` |               2 |                   2 |            2 |        2 |       20 |
| `replenishment_policy:REQUIREMENT_GROUP:FOOD_FAT`           | `FOOD_FAT`           |               2 |                   3 |            2 |        2 |       30 |
| `replenishment_policy:REQUIREMENT_GROUP:DRINKING_WATER`     | `DRINKING_WATER`     |               1 |                   2 |            2 |        2 |       14 |

## 5. App config seed

`seedAppConfig()` จะสร้างเอกสารนี้เมื่อยังไม่มีอยู่เท่านั้น หากมี `config:app` อยู่แล้ว ระบบจะไม่เขียนทับค่าที่ operator ตั้งไว้

| Field                            |  ค่า default | ความหมาย                         |
| -------------------------------- | -----------: | -------------------------------- |
| `_id`                            | `config:app` | singleton ใน `registry`          |
| `type`                           |     `config` | document type                    |
| `schema_v`                       |          `1` | config schema                    |
| `public_otp_required`            |      `false` | ไม่บังคับ public OTP โดย default |
| `recaptcha_enabled`              |       `true` | เปิด reCAPTCHA โดย default       |
| `duplicate_hint_threshold`       |        `0.8` | threshold สำหรับ duplicate hint  |
| `donation_reservation_ttl_hours` |         `72` | อายุ reservation บริจาค ชั่วโมง  |
| `device_db_ttl_days`             |         `30` | อายุ device DB วัน               |
| `retention_months_after_close`   |          `3` | retention หลังปิดเคส เดือน       |
| `fam_search_max_results`         |         `10` | จำนวนผลค้นหา family สูงสุด       |

## 6. Public portal config seed

`seedPublicPortalConfig()` จะสร้างเอกสารนี้เมื่อยังไม่มีอยู่เท่านั้น หากมี `config:public_portal` อยู่แล้ว ระบบจะไม่เขียนทับค่าที่ operator ตั้งไว้ ดูรายละเอียดและคำแปลภาษาอังกฤษฉบับเต็มได้ที่ [public-portal-config.md](./public-portal-config.md)

### 6.1 Document contract

| Field          | ค่า seed                 | ความหมาย                                          |
| -------------- | ------------------------ | ------------------------------------------------- |
| `_id`          | `config:public_portal`   | singleton ใน `registry`                           |
| `type`         | `config`                 | document type                                     |
| `schema_v`     | `1`                      | config schema                                     |
| `phone_number` | `""`                     | ไม่ seed — เว้นว่างไว้รอผู้ดูแลระบบกำหนดค่า       |
| `line_oa_url`  | `""`                     | ไม่ seed — เว้นว่างไว้รอผู้ดูแลระบบกำหนดค่า       |
| `facebook_url` | `""`                     | ไม่ seed — เว้นว่างไว้รอผู้ดูแลระบบกำหนดค่า       |
| `faqs`         | 3 หมวดหมู่ รวม 13 รายการ | `public` (5), `registration` (4), `volunteer` (4) |

### 6.2 Canonical seeded FAQ items

#### `public` — FAQ หน้าเว็บสาธารณะ (5 รายการ)

| ID                                     | Order | คำถาม                                                           | สรุปคำตอบ                                                                          |
| -------------------------------------- | :---: | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `c30b393c-29e8-4a3d-a583-d99a3cf9e34a` |   0   | วิธีการลงทะเบียนขอเข้าพักศูนย์พักพิงต้องทำอย่างไร?              | ลงทะเบียนได้ 2 วิธี: หน้าศูนย์พักพิง หรือลงทะเบียนล่วงหน้าผ่านระบบออนไลน์          |
| `aa67cda9-a91a-4e25-b3c3-236319e03a43` |   1   | ศูนย์พักพิงเปิดรับบริจาคสิ่งของอะไรบ้าง และส่งมอบได้ที่ไหน?     | ตรวจสอบรายการขาดแคลนจริงแบบเรียลไทม์ที่หน้าแจ้งบริจาค และส่งมอบที่จุดรับบริจาคกลาง |
| `e6b05673-b95b-4082-9dec-795e977fee10` |   2   | สามารถนำสัตว์เลี้ยงเข้ามาพักในศูนย์พักพิงได้หรือไม่?            | มีโซนดูแลสัตว์เลี้ยงแยกเฉพาะ ขอความร่วมมือนำกรง สายจูง และอาหารสัตว์เลี้ยงมาด้วย   |
| `1fe16114-7187-4995-9db8-60ec542c1cf0` |   3   | ค้นหาข้อมูลญาติหรือคนในครอบครัวที่อยู่ในศูนย์พักพิงอย่างไร?     | ค้นหาด้วยชื่อ-สกุลหรือเบอร์โทร ผ่านระบบค้นหาญาติภายใต้มาตรฐาน PDPA                 |
| `893b5d08-fecb-45f4-a37f-b65023b3d72e` |   4   | หากเกิดเหตุฉุกเฉินหรือติดค้างในพื้นที่น้ำท่วมสูง ต้องติดต่อใคร? | สายด่วนกู้ชีพ 1669, สายด่วน ปภ. 1784 ตลอด 24 ชม. หรือสายตรงศูนย์ประสานงาน          |

#### `registration` — FAQ ระบบลงทะเบียน (4 รายการ)

| ID                                     | Order | คำถาม                                                        | สรุปคำตอบ                                                                        |
| -------------------------------------- | :---: | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `5e454675-5dae-4f29-b78c-6d7d709261b8` |   0   | ต้องใช้เอกสารอะไรบ้างในการลงทะเบียนเข้าพัก?                  | บัตรประชาชนหรือเอกสารราชการ หากสูญหายเจ้าหน้าที่ช่วยบันทึกข้อมูลเข้าสู่ระบบได้   |
| `379d26b7-b44f-4235-ad2a-13eea2834fc6` |   1   | สามารถลงทะเบียนล่วงหน้าแทนสมาชิกในครอบครัวได้หรือไม่?        | ลงทะเบียนแทนได้ โดยระบุจำนวนและข้อมูลกลุ่มเปราะบางเพื่อเตรียมยา/พื้นที่          |
| `8363a757-0036-4ca0-a1bf-eae2cc574aa8` |   2   | การลงทะเบียนล่วงหน้าถือเป็นการยืนยันสิทธิ์เตียงทันทีหรือไม่? | สำรองคิวคัดกรอง ยืนยันสิทธิ์เตียงสมบูรณ์เมื่อรายงานตัวและผ่านการคัดกรองหน้าศูนย์ |
| `4d2d8417-c4e6-4ac3-8229-06f14f1300bc` |   3   | หากมีผู้ป่วยติดเตียงหรือผู้ใช้วีลแชร์ ต้องแจ้งในขั้นตอนใด?   | ระบุในกลุ่มเปราะบางขณะลงทะเบียน เพื่อจัดพื้นที่ชั้นล่างและเตรียมอุปกรณ์แพทย์     |

#### `volunteer` — FAQ อาสาสมัคร (4 รายการ)

| ID                                     | Order | คำถาม                                                  | สรุปคำตอบ                                                                       |
| -------------------------------------- | :---: | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `b1d4b33d-bc65-45c5-8e45-d8ac616fc669` |   0   | คุณสมบัติของผู้ที่ต้องการสมัครเป็นอาสาสมัครมีอะไรบ้าง? | อายุ 18 ปีขึ้นไป สุขภาพแข็งแรง งานเฉพาะทาง (แพทย์/พยาบาล/ช่าง) ต้องมีใบวิชาชีพ  |
| `5ef35c15-c779-4ab4-a046-c0851e2ac4a6` |   1   | มีฝ่ายและบทบาทหน้าที่ใดบ้างที่เปิดรับอาสาสมัคร?        | ครัวกลาง, คลังพัสดุ, คัดกรองผู้ประสบภัย, ขนย้ายกู้ภัย ปฏิบัติงานเป็นกะ          |
| `c11866ae-6466-4ea8-96e3-c5753cbcdb46` |   2   | อาสาสมัครต้องเตรียมสิ่งของใดมาในวันปฏิบัติหน้าที่?     | บัตรประชาชน ยาประจำตัว รองเท้าหุ้มส้น ศูนย์มีเสื้อกั๊ก ป้ายชื่อ PPE และอาหารให้ |
| `59a4b8af-f337-4a14-9311-2fa27d4bebc9` |   3   | หากต้องการเปลี่ยนหรือยกเลิกกะงานต้องทำอย่างไร?         | แจ้งล่วงหน้าอย่างน้อย 6 ชั่วโมงผ่านระบบหรือติดต่อหัวหน้าฝ่ายอาสาสมัคร           |

## 7. รายการที่ไม่ได้สร้างเป็น seeded master data

รายการต่อไปนี้ไม่ได้สร้างโดย `runMasterSeed()` จึงห้ามถือว่าเป็นค่าเริ่มต้นจาก seed จนกว่าจะเพิ่มรายการลงใน executable source และเอกสารนี้พร้อมกัน:

- ตัวเลือก WASH, sanitation และ facility ที่เป็นข้อเสนอ
- health service, referral reason และ medical catalog groups ที่ยังไม่มี fixture ใน seed
- shelter facility values ที่เป็น enum/schema แต่ไม่ได้สร้างเป็น `master_data` document
- master-data local override ราย shelter ซึ่งเป็น runtime operation ไม่ใช่ global seed

## 8. เกณฑ์ตรวจสอบเมื่อแก้รายการ seed

- รายการในเอกสารต้องตรงกับ source code ทุก key, label, default, parent และค่าตัวเลข
- จำนวนรายการและ document ID ใน §1–§6 ต้องถูกต้องหลังรัน static seed inspection
- ห้ามมีรายการ proposal ปะปนอยู่ในตาราง `Seeded`
- หากเปลี่ยน persisted shape, `schema_v`, scope, permission หรือ invariant ต้องมี schema/CR ที่เกี่ยวข้องก่อน
- อัปเดต `updated` เป็นวันที่แก้ไขจริง และคงลิงก์ไปยัง executable source ที่เป็นคู่ mirror
