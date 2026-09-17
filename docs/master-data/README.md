---
title: Smart Shelter — Master Data Seed SSoT
status: draft
updated: 2026-09-17
language: th
---

# Smart Shelter — Master Data Seed SSoT

> **สรุป:** เอกสารนี้เป็นรายการค่าที่ `pnpm seed:master` สร้างจริงสำหรับ registry master data, catalog reference data, SOP/Food Sphere และ app config · รายการที่ไม่อยู่ในเอกสารนี้ไม่ถือว่าเป็นค่า default จาก seed · การเปลี่ยนค่าในเอกสารต้องปรับ executable seed ให้ตรงกันใน change เดียวกัน

## ขอบเขตและแหล่งข้อมูล

### ขอบเขต

`pnpm seed:master` เรียก `runMasterSeed()` และสร้างข้อมูลต่อไปนี้:

| พื้นที่    | ผลลัพธ์จาก seed                                                               |
| ---------- | ----------------------------------------------------------------------------- |
| `registry` | global `master_data` 9 เอกสาร รวมรายการ seed 75 รายการ                        |
| `registry` | `config:app` 1 singleton พร้อมค่า default                                     |
| `registry` | `config:public_portal` 1 singleton พร้อมค่า default FAQ 13 รายการ (ช่องทางติดต่อเว้นว่างไว้ ไม่ seed) |
| `catalog`  | `item_category` 10, `item_master` 29, `recipe` 6 และ `supply_item` 7          |
| `catalog`  | SOP profile 1, audit 1 และ active pointer 1                                   |
| `catalog`  | `requirement_group` 5, `food_sphere_standard` 24 และ `replenishment_policy` 5 |

ข้อมูล shelter, users, evacuees, operations และ daily snapshots ที่สร้างโดย `pnpm seed` อยู่ใน staging seed และไม่รวมอยู่ใน SSoT ฉบับนี้

### Executable sources

- [master-defs.ts](../../frontend/scripts/seed/master-defs.ts) — รายการ `registry.master_data`
- [master-seed.ts](../../frontend/scripts/seed/master-seed.ts) — ลำดับและรูปแบบการสร้าง registry/catalog/config
- [master-data.ts](../../frontend/src/lib/features/master-data/domain/master-data.ts) — master type, schema และ vulnerable-group set
- [sop-ratio.fixture.ts](../../frontend/src/lib/features/sop-ratios/domain/sop-ratio.fixture.ts) — SOP ratio baseline
- [requirement-group.fixture.ts](../../frontend/src/lib/features/sop-ratios/domain/requirement-group.fixture.ts) — requirement groups
- [food-sphere.fixture.ts](../../frontend/src/lib/features/sop-ratios/domain/food-sphere.fixture.ts) — Food Sphere standards
- [replenishment-policy.fixture.ts](../../frontend/src/lib/features/sop-ratios/domain/replenishment-policy.fixture.ts) — replenishment policies
- [app-config.ts](../../frontend/src/lib/features/shared/domain/app-config.ts) — app config defaults
- [config.fixture.ts](../../frontend/src/lib/features/public-portal/domain/config.fixture.ts) — public portal config defaults
- [public-portal-config.md](./public-portal-config.md) — รายละเอียดชุดข้อมูล Public Portal config seed ฉบับสมบูรณ์

### กติกา SSoT

- **DOC-001** — รายการในตาราง `Seeded` ต้องตรงกับ executable source ทุก key, label, default, parent และค่าตัวเลข
- **DOC-002** — ค่าที่เป็นข้อเสนอหรือรอ owner ยืนยันต้องอยู่ในเอกสารแยก และห้ามปนในตาราง seed
- **DOC-003** — การเพิ่ม/ลบ/เปลี่ยนค่า seed ต้องอัปเดตเอกสารนี้และ source code ใน change เดียวกัน
- **DOC-004** — การเปลี่ยน shape, `schema_v`, role, scope หรือ invariant ต้องแก้ technical schema และทำ CR ตาม `docs/change-management.md` ก่อน

## 1. Registry master data

### 1.1 Document contract

| Field                            | ค่า seed                           |
| -------------------------------- | ---------------------------------- |
| Database                         | `registry`                         |
| Document type                    | `master_data`                      |
| Global document ID               | `master_data:{master_type}`        |
| `schema_v`                       | `3`                                |
| Item status                      | `active` สำหรับรายการที่ seed ใหม่ |
| Author                           | `seed`                             |
| Global scope                     | ไม่มี `shelter_code`               |
| จำนวน master types               | 9                                  |
| จำนวนรายการใน canonical seed set | 75                                 |

Global seed ใช้ `enforceOneDefault()` เพื่อให้แต่ละ master type มี default ได้ไม่เกินหนึ่งรายการ หากเอกสารเดิมมีรายการที่ไม่ได้อยู่ใน canonical seed set ระบบจะเก็บรายการเดิมไว้ เว้นแต่เข้าเงื่อนไข migration ที่ระบุใน §1.4 ดังนั้นตารางด้านล่างคือ **รายการที่ seed กำหนด** ไม่ใช่ snapshot ของรายการทั้งหมดที่อาจมีอยู่ใน database แล้ว

### 1.2 Code และ key

`SeedItemDef.key` เป็น seed-only key ใช้สำหรับอ้างอิงระหว่างการ seed ส่วน `MasterDataItem.code` คือค่าที่ persist ใน CouchDB

| Master type                                                                                                  | Persisted code                                                |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `vulnerable_group`                                                                                           | ใช้ key เดิมแบบ stable                                        |
| `pet_types`                                                                                                  | ใช้ key เดิมแบบ stable                                        |
| `housing_type`                                                                                               | ใช้ key เดิมแบบ stable                                        |
| `health_condition`, `dietary_restrictions`, `house_damage`, `shelter_type`, `municipality_zone`, `community` | สร้างเป็น `item_<ulid>` และ reuse code เดิมเมื่อพบ label เดิม |

`community.parent_key` อ้างถึง key ของ `municipality_zone` ระหว่าง seed และถูกแปลงเป็น `parent_code` ของ zone ที่ persist จริง

### 1.3 Canonical seeded items

#### `vulnerable_group` — กลุ่มเปราะบาง

| code                | label                                | default |
| ------------------- | ------------------------------------ | ------- |
| `bedridden`         | ผู้ป่วยติดเตียง                      | —       |
| `dialysis`          | ผู้ป่วยฟอกไต                         | —       |
| `wheelchair`        | ผู้ใช้วีลแชร์                        | —       |
| `psychiatric`       | ผู้ป่วยจิตเวช                        | —       |
| `elderly_dependent` | ผู้สูงอายุช่วยเหลือตัวเองไม่ได้      | —       |
| `infant`            | ทารก                                 | —       |
| `young_child`       | เด็กเล็ก                             | —       |
| `pregnant`          | สตรีมีครรภ์                          | —       |
| `vision_impaired`   | ผู้พิการทางการมองเห็น                | —       |
| `hearing_impaired`  | ผู้พิการทางการได้ยิน                 | —       |
| `disability_other`  | ผู้พิการ (อื่นๆ / ไม่ระบุรายละเอียด) | —       |
| `chronic_illness`   | ผู้มีโรคประจำตัว/เรื้อรัง            | —       |

#### `health_condition` — โรคประจำตัวและอาการแพ้

| key               | label           | default |
| ----------------- | --------------- | ------- |
| `diabetes`        | เบาหวาน         | —       |
| `hypertension`    | ความดันโลหิตสูง | —       |
| `heart_disease`   | โรคหัวใจ        | —       |
| `asthma`          | หอบหืด          | —       |
| `seafood_allergy` | แพ้อาหารทะเล    | —       |
| `sulfa_allergy`   | แพ้ยาซัลฟา      | —       |

#### `dietary_restrictions` — ศาสนาและข้อจำกัดอาหาร

| key     | label          | default |
| ------- | -------------- | ------- |
| `halal` | อิสลาม (ฮาลาล) | **ใช่** |

#### `pet_types` — ประเภทสัตว์เลี้ยง

| code    | label | default |
| ------- | ----- | ------- |
| `dog`   | สุนัข | —       |
| `cat`   | แมว   | —       |
| `other` | อื่นๆ | —       |

#### `housing_type` — ประเภทที่อยู่อาศัย

| code             | label                             | default |
| ---------------- | --------------------------------- | ------- |
| `owned_house`    | บ้านตนเอง                         | **ใช่** |
| `rented_house`   | บ้านเช่า                          | —       |
| `condo`          | คอนโดมิเนียม                      | —       |
| `apartment_dorm` | อพาร์ตเมนต์/หอพัก                 | —       |
| `homeless`       | ไร้ที่อยู่อาศัย / ไม่มีบ้านเลขที่ | —       |

#### `house_damage` — สถานะความเสียหายของบ้าน

| key                   | label            | default |
| --------------------- | ---------------- | ------- |
| `total_loss`          | เสียหายทั้งหลัง  | **ใช่** |
| `partial`             | เสียหายบางส่วน   | —       |
| `flooded_first_floor` | น้ำท่วมถึงชั้น 1 | —       |

#### `shelter_type` — ประเภทศูนย์พักพิง

| key                   | label       | default |
| --------------------- | ----------- | ------- |
| `school`              | โรงเรียน    | **ใช่** |
| `community_hall`      | ศาลาประชาคม | —       |
| `temple`              | วัด         | —       |
| `government_building` | อาคารราชการ | —       |
| `sports_centre`       | ศูนย์กีฬา   | —       |

#### `municipality_zone` — เขตเทศบาล

| key      | label                 | default |
| -------- | --------------------- | ------- |
| `zone_1` | เขตเทศบาลนครหาดใหญ่ 1 | **ใช่** |
| `zone_2` | เขตเทศบาลนครหาดใหญ่ 2 | —       |
| `zone_3` | เขตเทศบาลนครหาดใหญ่ 3 | —       |
| `zone_4` | เขตเทศบาลนครหาดใหญ่ 4 | —       |

#### `community` — ชุมชน

`community` มี `parent_type: municipality_zone` และมีทั้งหมด 36 รายการ แบ่งตาม zone ดังนี้

| key                     | label                       | parent_key | default |
| ----------------------- | --------------------------- | ---------- | ------- |
| `na_khai_senanarong`    | ชุมชนหน้าค่ายเสนาณรงค์      | `zone_1`   | **ใช่** |
| `na_suan_satharana`     | ชุมชนหน้าสวนสาธารณะ         | `zone_1`   | —       |
| `rong_pun`              | ชุมชนโรงปูน                 | `zone_1`   | —       |
| `na_rph_sikarin`        | ชุมชนหน้าโรงพยาบาลศิครินทร์ | `zone_1`   | —       |
| `ko_suea`               | ชุมชนเกาะเสือ               | `zone_1`   | —       |
| `rongrian_chatri`       | ชุมชนโรงเรียนชาตรี          | `zone_1`   | —       |
| `sikarin`               | ชุมชนศิครินทร์              | `zone_1`   | —       |
| `rathakan`              | ชุมชนรัถการ                 | `zone_1`   | —       |
| `mae_litao`             | ชุมชนแม่ลิเตา               | `zone_1`   | —       |
| `talat_mai`             | ชุมชนตลาดใหม่               | `zone_2`   | —       |
| `suan_siri`             | ชุมชนสวนศิริ                | `zone_2`   | —       |
| `sam_chai`              | ชุมชนสามชัย                 | `zone_2`   | —       |
| `rph_bangkok`           | ชุมชนโรงพยาบาลกรุงเทพ       | `zone_2`   | —       |
| `ban_ja`                | ชุมชนบ้านจ่า                | `zone_2`   | —       |
| `klang_na`              | ชุมชนกลางนา                 | `zone_2`   | —       |
| `sam_yaek_khlong_rian`  | ชุมชนสามแยกคลองเรียน        | `zone_2`   | —       |
| `chan_prathip`          | ชุมชนจันทร์ประทีป           | `zone_3`   | —       |
| `d_land_thai_charoen`   | ชุมชนดีแลนด์-ไทยเจริญ       | `zone_3`   | —       |
| `rim_khuan`             | ชุมชนริมควน                 | `zone_3`   | —       |
| `khlong_rabai_1`        | ชุมชนคลองระบายน้ำที่ 1      | `zone_3`   | —       |
| `lang_thiwa_amphoe`     | ชุมชนหลังที่ว่าการอำเภอ     | `zone_3`   | —       |
| `plak_krim`             | ชุมชนปลักกริม               | `zone_3`   | —       |
| `rattana_wibun`         | ชุมชนรัตนวิบูลย์            | `zone_3`   | —       |
| `thung_sao`             | ชุมชนทุ่งเสา                | `zone_3`   | —       |
| `khonsong`              | ชุมชนขนส่ง                  | `zone_3`   | —       |
| `lang_rongphak`         | ชุมชนหลังโรงพัก             | `zone_3`   | —       |
| `lang_u_rotfai`         | ชุมชนหลังอู่รถไฟ            | `zone_3`   | —       |
| `ko_liap`               | ชุมชนเกาะเลียบ              | `zone_4`   | —       |
| `wat_hatyai_nai`        | ชุมชนวัดหาดใหญ่ใน           | `zone_4`   | —       |
| `rattana_uthit`         | ชุมชนรัตนอุทิศ              | `zone_4`   | —       |
| `tha_sai`               | ชุมชนท่าไทร                 | `zone_4`   | —       |
| `ratchamangkhalaphisek` | ชุมชนรัชมังคลาภิเษก         | `zone_4`   | —       |
| `mongkhon_hansa`        | ชุมชนมงคลหรรษา              | `zone_4`   | —       |
| `chok_saman`            | ชุมชนโชคสมาน                | `zone_4`   | —       |
| `rat_uthit`             | ชุมชนราษฎร์อุทิศ            | `zone_4`   | —       |
| `hua_phan_rotfai`       | ชุมชนหัวพานรถไฟ             | `zone_4`   | —       |

### 1.4 Migration และ idempotency

- Legacy vulnerable-group code `elderly` ถูกย้ายเป็น `elderly_dependent`
- Legacy vulnerable-group code `disabled` ถูกย้ายเป็น `disability_other`
- Legacy labels `ผู้สูงอายุ`, `ผู้พิการ` และ `ผู้ป่วยเรื้อรัง` ใช้ช่วยหา target ใหม่ระหว่าง migration
- รายการ `pet_types` ที่มี code `bird` หรือ label `นก` จะไม่ถูกเก็บเป็น extra
- รายการ `dietary_restrictions` ที่มี label `มังสวิรัติ` หรือ `อาหารอ่อน` จะไม่ถูกเก็บเป็น extra
- การ seed ซ้ำ reuse code ของรายการเดิมจาก label เดิม และเก็บรายการเดิมที่ไม่อยู่ใน seed ไว้ตามกติกา

## 2. Catalog seed

ข้อมูลส่วนนี้เป็น reference data ที่ seed ลง `catalog` ไม่ใช่ `registry.master_data`

### 2.1 `item_category`

หมวดหมู่สิ่งของมาตรฐาน 10 รายการ ใช้ `schema_v: 2`, สร้างด้วย `_id` รูปแบบ `item_category:{ulid}` และเก็บชื่อภาษาไทย:

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

### 2.2 `item_master`

รายการสิ่งของหลัก 29 รายการ ใช้ `schema_v: 4`, สร้างด้วย `_id` รูปแบบ `item_master:{ulid}` และผูกกับ `category` ตามชื่อหมวดหมู่ภาษาไทย:

| `_id` | name | category | base_unit | type_class | conversions | inventory / issue uom | storage / shelf life | properties / flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `item_master:{ulid}` | ข้าวสาร | อาหารและวัตถุดิบ | `kg` | `CONSUMABLE` | ถุง 5 กก. (x5), กระสอบ 50 กก. (x50) | กระสอบ 50 กก. / kg | DRY / 365 วัน | ผูก `FOOD_ENERGY` |
| `item_master:{ulid}` | ไข่ไก่ | อาหารและวัตถุดิบ | `piece` | `CONSUMABLE` | แผง 30 ฟอง (x30) | แผง 30 ฟอง / piece | DRY / 21 วัน | ผูก `FOOD_PROTEIN` |
| `item_master:{ulid}` | ผักรวม | อาหารและวัตถุดิบ | `kg` | `CONSUMABLE` | — | kg / kg | CHILLED / 5 วัน | — |
| `item_master:{ulid}` | ปลากระป๋อง | อาหารและวัตถุดิบ | `can` | `CONSUMABLE` | แพ็ค 10 กป. (x10), ลัง 100 กป. (x100) | ลัง 100 กป. / can | DRY / 730 วัน | `dietary: ['HALAL']` |
| `item_master:{ulid}` | เนื้อไก่สด | อาหารและวัตถุดิบ | `kg` | `CONSUMABLE` | — | kg / kg | CHILLED / 3 วัน | `dietary: ['HALAL']` |
| `item_master:{ulid}` | น้ำมันพืช | อาหารและวัตถุดิบ | `bottle` | `CONSUMABLE` | ลัง 12 ขวด (x12) | ลัง 12 ขวด / bottle | DRY / 365 วัน | `dietary: ['HALAL']`, ผูก `FOOD_FAT` |
| `item_master:{ulid}` | น้ำดื่ม 600 มล. | น้ำดื่มสะอาด | `bottle` | `CONSUMABLE` | แพ็ค 12 ขวด (x12) | แพ็ค 12 ขวด / bottle | DRY / 365 วัน | ผูก `DRINKING_WATER` |
| `item_master:{ulid}` | น้ำดื่มถัง 5 ลิตร | น้ำดื่มสะอาด | `bottle` | `CONSUMABLE` | แพ็ค 4 ถัง (x4) | แพ็ค 4 ถัง / bottle | DRY / 365 วัน | ผูก `DRINKING_WATER` |
| `item_master:{ulid}` | สบู่ก้อน | สุขอนามัยและของใช้ส่วนตัว | `bar` | `CONSUMABLE` | แพ็ค 4 ก้อน (x4) | แพ็ค 4 ก้อน / bar | DRY / 730 วัน | — |
| `item_master:{ulid}` | ยาสีฟัน | สุขอนามัยและของใช้ส่วนตัว | `tube` | `CONSUMABLE` | แพ็ค 6 หลอด (x6) | แพ็ค 6 หลอด / tube | DRY / 730 วัน | — |
| `item_master:{ulid}` | แปรงสีฟัน | สุขอนามัยและของใช้ส่วนตัว | `piece` | `CONSUMABLE` | แพ็ค 12 ด้าม (x12) | แพ็ค 12 ด้าม / piece | DRY / — | — |
| `item_master:{ulid}` | ผ้าอนามัย | สุขอนามัยและของใช้ส่วนตัว | `pack` | `CONSUMABLE` | ลัง 24 ห่อ (x24) | ลัง 24 ห่อ / pack | DRY / 1095 วัน | `target_gender: 'FEMALE'` |
| `item_master:{ulid}` | ผงซักฟอก | สุขอนามัยและของใช้ส่วนตัว | `bag` | `CONSUMABLE` | ลัง 12 ถุง (x12) | ลัง 12 ถุง / bag | DRY / 730 วัน | — |
| `item_master:{ulid}` | ยาพาราเซตามอล 500 มก. | เวชภัณฑ์และการปฐมพยาบาล | `tablet` | `CONSUMABLE` | แผง 10 เม็ด (x10), กระปุก 100 เม็ด (x100) | กระปุก 100 เม็ด / tablet | CONTROLLED_MED / 730 วัน | — |
| `item_master:{ulid}` | ชุดทำแผลปฐมพยาบาล | เวชภัณฑ์และการปฐมพยาบาล | `kit` | `CONSUMABLE` | กล่อง 10 ชุด (x10) | กล่อง 10 ชุด / kit | DRY / 730 วัน | — |
| `item_master:{ulid}` | แอลกอฮอล์ล้างแผล 70% | เวชภัณฑ์และการปฐมพยาบาล | `bottle` | `CONSUMABLE` | ลัง 24 ขวด (x24) | ลัง 24 ขวด / bottle | DRY / 1095 วัน | — |
| `item_master:{ulid}` | ผงเกลือแร่ ORS | เวชภัณฑ์และการปฐมพยาบาล | `sachet` | `CONSUMABLE` | กล่อง 50 ซอง (x50) | กล่อง 50 ซอง / sachet | DRY / 730 วัน | — |
| `item_master:{ulid}` | ผ้าอ้อมผู้ใหญ่ ไซส์ L | ของใช้กลุ่มเปราะบาง | `piece` | `CONSUMABLE` | แพ็ค 10 ชิ้น (x10), ลัง 8 แพ็ค (x80) | ลัง 8 แพ็ค / piece | DRY / 1095 วัน | `age_group: 'ELDERLY'` |
| `item_master:{ulid}` | ผ้าอ้อมเด็ก ไซส์ M | ของใช้กลุ่มเปราะบาง | `piece` | `CONSUMABLE` | แพ็ค 20 ชิ้น (x20), ลัง 6 แพ็ค (x120) | ลัง 6 แพ็ค / piece | DRY / 1095 วัน | `age_group: 'CHILD'` |
| `item_master:{ulid}` | นมผงสำหรับทารก | ของใช้กลุ่มเปราะบาง | `can` | `CONSUMABLE` | ลัง 12 กระป๋อง (x12) | ลัง 12 กระป๋อง / can | DRY / 365 วัน | `age_group: 'INFANT'` |
| `item_master:{ulid}` | เสื้อกั๊กสะท้อนแสง | อุปกรณ์เจ้าหน้าที่และอาสาสมัคร | `piece` | `EQUIPMENT` | — | piece / piece | — | `returnable: true`, `asset_status: 'READY'` |
| `item_master:{ulid}` | รองเท้าบูทยางกันน้ำ | อุปกรณ์เจ้าหน้าที่และอาสาสมัคร | `pair` | `EQUIPMENT` | — | pair / pair | — | `returnable: true`, `asset_status: 'READY'` |
| `item_master:{ulid}` | ข้าวกล่องทั่วไป | อาหารปรุงเสร็จและเครื่องดื่ม | `box` | `CONSUMABLE` | — | box / box | DRY / 1 วัน | `distribution_type: 'recurring'` |
| `item_master:{ulid}` | ข้าวกล่องฮาลาล | อาหารปรุงเสร็จและเครื่องดื่ม | `box` | `CONSUMABLE` | — | box / box | DRY / 1 วัน | `distribution_type: 'recurring'`, `dietary: ['HALAL']` |
| `item_master:{ulid}` | ผ้าห่มกันหนาว | เครื่องนอนและที่พักพิง | `piece` | `DURABLE` | มัด 10 ผืน (x10) | มัด 10 ผืน / piece | — | `returnable: true`, `qty_per_person: 1`, `one_time` |
| `item_master:{ulid}` | เสื่อปูนอน | เครื่องนอนและที่พักพิง | `piece` | `DURABLE` | มัด 10 ผืน (x10) | มัด 10 ผืน / piece | — | `returnable: true`, `qty_per_person: 1`, `one_time` |
| `item_master:{ulid}` | เต็นท์ครอบครัว | เครื่องนอนและที่พักพิง | `tent` | `DURABLE` | — | tent / tent | — | `returnable: true`, `qty_per_person: 1`, `one_time` |
| `item_master:{ulid}` | ถังแก๊สหุงต้ม LPG 15 กก. | เชื้อเพลิงและพลังงาน | `cylinder` | `CONSUMABLE` | — | cylinder / cylinder | — | `fuel_type: 'LPG'`, `capacity_kg: '15'`, `burn_rate: '0.35'` |
| `item_master:{ulid}` | ถุงยังชีพธารน้ำใจ | ชุดพัสดุยังชีพรวม | `kit` | `CONSUMABLE` | — | kit / kit | DRY / 180 วัน | `distribution_type: 'one_time'` |

### 2.3 `recipe`

สูตรอาหารมาตรฐานสำหรับโรงครัวศูนย์พักพิง 6 รายการ ใช้ `schema_v: 4`, `standard_portions: "1"` และ `standard_duration_hours: "1"`, สร้างด้วย `_id` รูปแบบ `recipe:{ulid}`:

| `_id`          | label                    | ingredients                                                  |
| -------------- | ------------------------ | ------------------------------------------------------------ |
| `recipe:{ulid}` | ข้าวไข่เจียว             | ข้าวสาร 0.2 kg; ไข่ไก่ 2 piece                               |
| `recipe:{ulid}` | ข้าวต้มไก่สับ            | ข้าวสาร 0.15 kg; เนื้อไก่สด 0.1 kg                           |
| `recipe:{ulid}` | ข้าวกะเพราไก่สับ         | ข้าวสาร 0.2 kg; เนื้อไก่สด 0.15 kg                          |
| `recipe:{ulid}` | ข้าวไก่ผัดกระเทียม       | ข้าวสาร 0.2 kg; เนื้อไก่สด 0.15 kg                          |
| `recipe:{ulid}` | ข้าวไข่พะโล้ไก่          | ข้าวสาร 0.2 kg; ไข่ไก่ 2 piece; เนื้อไก่สด 0.1 kg           |
| `recipe:{ulid}` | ข้าวปลากระป๋องทรงเครื่อง | ข้าวสาร 0.2 kg; ปลากระป๋อง 0.5 can                           |

### 2.4 `supply_item`

เอกสารพัสดุแบบเดิม 7 รายการ สำหรับ backward compatibility กับโมเดลสต็อก/การบริจาคเดิม:

| `_id`              | name          | category   | unit     | perishable | reorder level |
| ------------------ | ------------- | ---------- | -------- | ---------: | ------------: |
| `item:rice`        | ข้าวสาร       | `food`     | `kg`     |     ไม่ใช่ |            50 |
| `item:water`       | น้ำดื่ม       | `water`    | `bottle` |     ไม่ใช่ |           200 |
| `item:paracetamol` | ยาพาราเซตามอล | `medicine` | `tablet` |        ใช่ |           500 |
| `item:soap`        | สบู่ก้อน      | `hygiene`  | `bar`    |     ไม่ใช่ |           100 |
| `item:blanket`     | ผ้าห่ม        | `bedding`  | `piece`  |     ไม่ใช่ |            30 |
| `item:egg`         | ไข่ไก่        | `food`     | `piece`  |        ใช่ |           100 |
| `item:vegetable`   | ผักรวม        | `food`     | `kg`     |        ใช่ |            30 |

## 3. SOP ratio seed

Seed สร้าง profile ใน `catalog` ดังนี้:

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

ค่าถูก persist เป็น string ตาม strict 20-key schema

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

ทุกเอกสารมี `schema_v: 1`, `status: active`, `source: SPHERE_BASELINE`, `created_by: system` และวันที่ `2026-07-16`

| `_id` | name | standard_uom | item map |
| --- | --- | --- | --- |
| `requirement_group:FOOD_ENERGY` | กลุ่มแป้งและพลังงานหลัก | `kcal` | ข้าวสาร (`kg`), factor `3600`, share `100%` |
| `requirement_group:FOOD_PROTEIN` | กลุ่มโปรตีนและเนื้อสัตว์ | `gram` | ไข่ไก่ (`piece`), factor `6.3`, share `50%`<br/>ปลากระป๋อง (`can`), factor `17`, share `50%` |
| `requirement_group:FOOD_PROTEIN_HALAL` | กลุ่มโปรตีนและเนื้อสัตว์ (ฮาลาล) | `gram` | เนื้อไก่สด (`kg`), factor `200`, share `70%`<br/>ไข่ไก่ (`piece`), factor `6.3`, share `30%` |
| `requirement_group:FOOD_FAT` | กลุ่มน้ำมันและไขมัน | `gram` | น้ำมันพืช (`bottle`), factor `900`, share `100%` |
| `requirement_group:DRINKING_WATER` | กลุ่มน้ำดื่มสะอาด | `liter` | น้ำดื่ม 600 มล. (`bottle`), factor `0.6`, share `70%`<br/>น้ำดื่มถัง 5 ลิตร (`bottle`), factor `5.0`, share `30%` |

> **หมายเหตุ:** ในฐานข้อมูลจริง `item_maps[].item_id` ถูก resolve เป็น `item_master:{ulid}` จริงอัตโนมัติขณะรัน seed ตามชื่อสิ่งของภาษาไทย

### 4.2 `food_sphere_standard`

ทุกเอกสารมี `schema_v: 1`, `effective_date: 2026-07-16`, `status: active`, `source: SPHERE_BASELINE` และ `created_by: system` (รวม 24 รายการ)

| `_id` | target segment | requirement group | daily demand | unit |
| --- | --- | --- | ---: | --- |
| `food_sphere_standard:ALL:FOOD_ENERGY` | `ALL` | `FOOD_ENERGY` | 2100 | kcal |
| `food_sphere_standard:ALL:FOOD_FAT` | `ALL` | `FOOD_FAT` | 40 | gram |
| `food_sphere_standard:ALL:FOOD_PROTEIN` | `ALL` | `FOOD_PROTEIN` | 53 | gram |
| `food_sphere_standard:ALL:FOOD_PROTEIN_HALAL` | `ALL` | `FOOD_PROTEIN_HALAL` | 53 | gram |
| `food_sphere_standard:ALL:DRINKING_WATER` | `ALL` | `DRINKING_WATER` | 3 | liter |
| `food_sphere_standard:INFANT_0_6:FOOD_ENERGY` | `INFANT_0_6` | `FOOD_ENERGY` | 550 | kcal |
| `food_sphere_standard:INFANT_6_23:FOOD_ENERGY` | `INFANT_6_23` | `FOOD_ENERGY` | 850 | kcal |
| `food_sphere_standard:CHILD_2_5:FOOD_ENERGY` | `CHILD_2_5` | `FOOD_ENERGY` | 1250 | kcal |
| `food_sphere_standard:CHILD_2_5:FOOD_PROTEIN` | `CHILD_2_5` | `FOOD_PROTEIN` | 25 | gram |
| `food_sphere_standard:CHILD_2_5:FOOD_PROTEIN_HALAL` | `CHILD_2_5` | `FOOD_PROTEIN_HALAL` | 25 | gram |
| `food_sphere_standard:CHILD_2_5:DRINKING_WATER` | `CHILD_2_5` | `DRINKING_WATER` | 1.5 | liter |
| `food_sphere_standard:PREGNANT:FOOD_ENERGY` | `PREGNANT` | `FOOD_ENERGY` | 2400 | kcal |
| `food_sphere_standard:PREGNANT:FOOD_PROTEIN` | `PREGNANT` | `FOOD_PROTEIN` | 70 | gram |
| `food_sphere_standard:PREGNANT:FOOD_PROTEIN_HALAL` | `PREGNANT` | `FOOD_PROTEIN_HALAL` | 70 | gram |
| `food_sphere_standard:PREGNANT:FOOD_FAT` | `PREGNANT` | `FOOD_FAT` | 45 | gram |
| `food_sphere_standard:PREGNANT:DRINKING_WATER` | `PREGNANT` | `DRINKING_WATER` | 3.5 | liter |
| `food_sphere_standard:LACTATING:FOOD_ENERGY` | `LACTATING` | `FOOD_ENERGY` | 2600 | kcal |
| `food_sphere_standard:LACTATING:FOOD_PROTEIN` | `LACTATING` | `FOOD_PROTEIN` | 75 | gram |
| `food_sphere_standard:LACTATING:FOOD_PROTEIN_HALAL` | `LACTATING` | `FOOD_PROTEIN_HALAL` | 75 | gram |
| `food_sphere_standard:LACTATING:DRINKING_WATER` | `LACTATING` | `DRINKING_WATER` | 4 | liter |
| `food_sphere_standard:ELDERLY:FOOD_ENERGY` | `ELDERLY` | `FOOD_ENERGY` | 1900 | kcal |
| `food_sphere_standard:ELDERLY:FOOD_PROTEIN` | `ELDERLY` | `FOOD_PROTEIN` | 60 | gram |
| `food_sphere_standard:ELDERLY:FOOD_PROTEIN_HALAL` | `ELDERLY` | `FOOD_PROTEIN_HALAL` | 60 | gram |
| `food_sphere_standard:ELDERLY:DRINKING_WATER` | `ELDERLY` | `DRINKING_WATER` | 2.5 | liter |

### 4.3 `replenishment_policy`

ทุกเอกสารมี `schema_v: 1`, `scope_type: REQUIREMENT_GROUP`, `status: active`, `source: SPHERE_BASELINE` และ `created_by: system` (รวม 5 รายการ)

| `_id` | target | lead time (วัน) | review period (วัน) | safety (วัน) | min days | max days |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY` | `FOOD_ENERGY` | 3 | 4 | 3 | 3 | 45 |
| `replenishment_policy:REQUIREMENT_GROUP:FOOD_PROTEIN` | `FOOD_PROTEIN` | 2 | 2 | 2 | 2 | 20 |
| `replenishment_policy:REQUIREMENT_GROUP:FOOD_PROTEIN_HALAL` | `FOOD_PROTEIN_HALAL` | 2 | 2 | 2 | 2 | 20 |
| `replenishment_policy:REQUIREMENT_GROUP:FOOD_FAT` | `FOOD_FAT` | 2 | 3 | 2 | 2 | 30 |
| `replenishment_policy:REQUIREMENT_GROUP:DRINKING_WATER` | `DRINKING_WATER` | 1 | 2 | 2 | 2 | 14 |

## 5. App config seed

`seedAppConfig()` สร้างเอกสารนี้เฉพาะเมื่อยังไม่มีอยู่ หากมี `config:app` อยู่แล้วจะไม่ overwrite ค่า operator ที่ตั้งไว้

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

`seedPublicPortalConfig()` สร้างเอกสารนี้เฉพาะเมื่อยังไม่มีอยู่ หากมี `config:public_portal` อยู่แล้วจะไม่ overwrite ค่า operator ที่ตั้งไว้ ดูรายละเอียดและคำแปลภาษาอังกฤษฉบับเต็มได้ที่ [public-portal-config.md](./public-portal-config.md)

### 6.1 Document contract

| Field | ค่า seed | ความหมาย |
| --- | --- | --- |
| `_id` | `config:public_portal` | singleton ใน `registry` |
| `type` | `config` | document type |
| `schema_v` | `1` | config schema |
| `phone_number` | `""` | ไม่ seed — เว้นว่างไว้รอผู้ดูแลระบบกำหนดค่า |
| `line_oa_url` | `""` | ไม่ seed — เว้นว่างไว้รอผู้ดูแลระบบกำหนดค่า |
| `facebook_url` | `""` | ไม่ seed — เว้นว่างไว้รอผู้ดูแลระบบกำหนดค่า |
| `faqs` | 3 หมวดหมู่ รวม 13 รายการ | `public` (5), `registration` (4), `volunteer` (4) |

### 6.2 Canonical seeded FAQ items

#### `public` — FAQ หน้าเว็บสาธารณะ (5 รายการ)

| ID | Order | คำถาม | สรุปคำตอบ |
|---|:---:|---|---|
| `c30b393c-29e8-4a3d-a583-d99a3cf9e34a` | 0 | วิธีการลงทะเบียนขอเข้าพักศูนย์พักพิงต้องทำอย่างไร? | ลงทะเบียนได้ 2 วิธี: หน้าศูนย์พักพิง หรือลงทะเบียนล่วงหน้าผ่านระบบออนไลน์ |
| `aa67cda9-a91a-4e25-b3c3-236319e03a43` | 1 | ศูนย์พักพิงเปิดรับบริจาคสิ่งของอะไรบ้าง และส่งมอบได้ที่ไหน? | ตรวจสอบรายการขาดแคลนจริงแบบเรียลไทม์ที่หน้าแจ้งบริจาค และส่งมอบที่จุดรับบริจาคกลาง |
| `e6b05673-b95b-4082-9dec-795e977fee10` | 2 | สามารถนำสัตว์เลี้ยงเข้ามาพักในศูนย์พักพิงได้หรือไม่? | มีโซนดูแลสัตว์เลี้ยงแยกเฉพาะ ขอความร่วมมือนำกรง สายจูง และอาหารสัตว์เลี้ยงมาด้วย |
| `1fe16114-7187-4995-9db8-60ec542c1cf0` | 3 | ค้นหาข้อมูลญาติหรือคนในครอบครัวที่อยู่ในศูนย์พักพิงอย่างไร? | ค้นหาด้วยชื่อ-สกุลหรือเบอร์โทร ผ่านระบบค้นหาญาติภายใต้มาตรฐาน PDPA |
| `893b5d08-fecb-45f4-a37f-b65023b3d72e` | 4 | หากเกิดเหตุฉุกเฉินหรือติดค้างในพื้นที่น้ำท่วมสูง ต้องติดต่อใคร? | สายด่วนกู้ชีพ 1669, สายด่วน ปภ. 1784 ตลอด 24 ชม. หรือสายตรงศูนย์ประสานงาน |

#### `registration` — FAQ ระบบลงทะเบียน (4 รายการ)

| ID | Order | คำถาม | สรุปคำตอบ |
|---|:---:|---|---|
| `5e454675-5dae-4f29-b78c-6d7d709261b8` | 0 | ต้องใช้เอกสารอะไรบ้างในการลงทะเบียนเข้าพัก? | บัตรประชาชนหรือเอกสารราชการ หากสูญหายเจ้าหน้าที่ช่วยบันทึกข้อมูลเข้าสู่ระบบได้ |
| `379d26b7-b44f-4235-ad2a-13eea2834fc6` | 1 | สามารถลงทะเบียนล่วงหน้าแทนสมาชิกในครอบครัวได้หรือไม่? | ลงทะเบียนแทนได้ โดยระบุจำนวนและข้อมูลกลุ่มเปราะบางเพื่อเตรียมยา/พื้นที่ |
| `8363a757-0036-4ca0-a1bf-eae2cc574aa8` | 2 | การลงทะเบียนล่วงหน้าถือเป็นการยืนยันสิทธิ์เตียงทันทีหรือไม่? | สำรองคิวคัดกรอง ยืนยันสิทธิ์เตียงสมบูรณ์เมื่อรายงานตัวและผ่านการคัดกรองหน้าศูนย์ |
| `4d2d8417-c4e6-4ac3-8229-06f14f1300bc` | 3 | หากมีผู้ป่วยติดเตียงหรือผู้ใช้วีลแชร์ ต้องแจ้งในขั้นตอนใด? | ระบุในกลุ่มเปราะบางขณะลงทะเบียน เพื่อจัดพื้นที่ชั้นล่างและเตรียมอุปกรณ์แพทย์ |

#### `volunteer` — FAQ อาสาสมัคร (4 รายการ)

| ID | Order | คำถาม | สรุปคำตอบ |
|---|:---:|---|---|
| `b1d4b33d-bc65-45c5-8e45-d8ac616fc669` | 0 | คุณสมบัติของผู้ที่ต้องการสมัครเป็นอาสาสมัครมีอะไรบ้าง? | อายุ 18 ปีขึ้นไป สุขภาพแข็งแรง งานเฉพาะทาง (แพทย์/พยาบาล/ช่าง) ต้องมีใบวิชาชีพ |
| `5ef35c15-c779-4ab4-a046-c0851e2ac4a6` | 1 | มีฝ่ายและบทบาทหน้าที่ใดบ้างที่เปิดรับอาสาสมัคร? | ครัวกลาง, คลังพัสดุ, คัดกรองผู้ประสบภัย, ขนย้ายกู้ภัย ปฏิบัติงานเป็นกะ |
| `c11866ae-6466-4ea8-96e3-c5753cbcdb46` | 2 | อาสาสมัครต้องเตรียมสิ่งของใดมาในวันปฏิบัติหน้าที่? | บัตรประชาชน ยาประจำตัว รองเท้าหุ้มส้น ศูนย์มีเสื้อกั๊ก ป้ายชื่อ PPE และอาหารให้ |
| `59a4b8af-f337-4a14-9311-2fa27d4bebc9` | 3 | หากต้องการเปลี่ยนหรือยกเลิกกะงานต้องทำอย่างไร? | แจ้งล่วงหน้าอย่างน้อย 6 ชั่วโมงผ่านระบบหรือติดต่อหัวหน้าฝ่ายอาสาสมัคร |

## 7. รายการที่ไม่ใช่ seeded master data

ค่าต่อไปนี้ไม่ถูกสร้างโดย `runMasterSeed()` และห้ามอ้างว่าเป็น default จาก seed จนกว่าจะเพิ่มลง executable source และเอกสารนี้พร้อมกัน:

- ตัวเลือก WASH, sanitation และ facility ที่เป็นข้อเสนอ
- health service, referral reason และ medical catalog groups ที่ยังไม่มี fixture ใน seed
- shelter facility values ที่เป็น enum/schema แต่ไม่ได้สร้างเป็น `master_data` document
- master-data local override ราย shelter ซึ่งเป็น runtime operation ไม่ใช่ global seed

## 8. Definition of done สำหรับการแก้รายการ seed

- รายการในเอกสารตรงกับ source code ครบทุก key, label, default, parent และตัวเลข
- จำนวนรายการและ document ID ใน §1–§6 ถูกต้องหลังรัน static seed inspection
- ไม่มีรายการ proposal ปะปนในตาราง `Seeded`
- หากเปลี่ยน persisted shape, `schema_v`, scope, permission หรือ invariant ให้มี schema/CR ที่เกี่ยวข้องก่อน
- อัปเดต `updated` เป็นวันที่แก้จริง และคงลิงก์ไปยัง executable source ที่เป็นคู่ mirror
