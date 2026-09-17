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
| `registry` | global `master_data` 9 เอกสาร รวมรายการ seed 77 รายการ                        |
| `registry` | `config:app` 1 singleton พร้อมค่า default                                     |
| `catalog`  | `supply_item` 7, `item_master` 4 และ `recipe` 3                               |
| `catalog`  | SOP profile 1, audit 1 และ active pointer 1                                   |
| `catalog`  | `requirement_group` 3, `food_sphere_standard` 14 และ `replenishment_policy` 3 |

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
| จำนวนรายการใน canonical seed set | 77                                 |

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
| `elderly_dependent` | ผู้สูงอายุช่วยเหลือตัวเองไม่ได้      | **ใช่** |
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
| `diabetes`        | เบาหวาน         | **ใช่** |
| `hypertension`    | ความดันโลหิตสูง | —       |
| `heart_disease`   | โรคหัวใจ        | —       |
| `asthma`          | หอบหืด          | —       |
| `seafood_allergy` | แพ้อาหารทะเล    | —       |
| `sulfa_allergy`   | แพ้ยาซัลฟา      | —       |

#### `dietary_restrictions` — ศาสนาและข้อจำกัดอาหาร

| key          | label          | default |
| ------------ | -------------- | ------- |
| `halal`      | อิสลาม (ฮาลาล) | **ใช่** |
| `vegetarian` | มังสวิรัติ     | —       |
| `soft_diet`  | อาหารอ่อน      | —       |

#### `pet_types` — ประเภทสัตว์เลี้ยง

| code    | label | default |
| ------- | ----- | ------- |
| `dog`   | สุนัข | **ใช่** |
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
- การ seed ซ้ำ reuse code ของรายการเดิมจาก label เดิม และเก็บรายการเดิมที่ไม่อยู่ใน seed ไว้ตามกติกา

## 2. Catalog seed

ข้อมูลส่วนนี้เป็น reference data ที่ seed ลง `catalog` ไม่ใช่ `registry.master_data`

### 2.1 `supply_item`

| `_id`              | name          | category   | unit     | perishable | reorder level |
| ------------------ | ------------- | ---------- | -------- | ---------: | ------------: |
| `item:rice`        | ข้าวสาร       | `food`     | `kg`     |     ไม่ใช่ |            50 |
| `item:water`       | น้ำดื่ม       | `water`    | `bottle` |     ไม่ใช่ |           200 |
| `item:paracetamol` | ยาพาราเซตามอล | `medicine` | `tablet` |        ใช่ |           500 |
| `item:soap`        | สบู่ก้อน      | `hygiene`  | `bar`    |     ไม่ใช่ |           100 |
| `item:blanket`     | ผ้าห่ม        | `bedding`  | `piece`  |     ไม่ใช่ |            30 |
| `item:egg`         | ไข่ไก่        | `food`     | `piece`  |        ใช่ |           100 |
| `item:vegetable`   | ผักรวม        | `food`     | `kg`     |        ใช่ |            30 |

### 2.2 `item_master`

รายการทั้งหมดใช้ `schema_v: 4`, `type_class: CONSUMABLE`, `distribution_type: recurring`, `conversions: []` และ `dietary: []`

| `_id`                     | name       | category | base_unit |
| ------------------------- | ---------- | -------- | --------- |
| `item_master:rice`        | ข้าวสาร    | `food`   | `kg`      |
| `item_master:egg`         | ไข่ไก่     | `food`   | `piece`   |
| `item_master:vegetable`   | ผักรวม     | `food`   | `kg`      |
| `item_master:canned-fish` | ปลากระป๋อง | `food`   | `can`     |

### 2.3 `recipe`

รายการทั้งหมดใช้ `schema_v: 4`, `standard_portions: "1"` และ `standard_duration_hours: "1"`

| `_id`                     | label          | ingredients                                                  |
| ------------------------- | -------------- | ------------------------------------------------------------ |
| `recipe:fried-egg-rice`   | ข้าวไข่เจียว   | `item_master:rice` 0.2 kg; `item_master:egg` 2 piece         |
| `recipe:congee`           | ข้าวต้ม        | `item_master:rice` 0.15 kg                                   |
| `recipe:canned-fish-rice` | ข้าวปลากระป๋อง | `item_master:rice` 0.2 kg; `item_master:canned-fish` 0.5 can |

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

| `_id`                            | name         | standard_uom | item map                                               |
| -------------------------------- | ------------ | ------------ | ------------------------------------------------------ |
| `requirement_group:FOOD_ENERGY`  | พลังงานอาหาร | `kcal`       | `item_master:rice`, `kg`, factor `3600`, share `100%`  |
| `requirement_group:FOOD_PROTEIN` | โปรตีน       | `gram`       | `item_master:egg`, `piece`, factor `6.3`, share `100%` |
| `requirement_group:FOOD_FAT`     | ไขมัน        | `gram`       | ไม่มี item map                                         |

### 4.2 `food_sphere_standard`

ทุกเอกสารมี `schema_v: 1`, `effective_date: 2026-07-16`, `status: active`, `source: SPHERE_BASELINE` และ `created_by: system`

| `_id`                                          | target segment | requirement group | daily demand | unit |
| ---------------------------------------------- | -------------- | ----------------- | -----------: | ---- |
| `food_sphere_standard:ALL:FOOD_ENERGY`         | `ALL`          | `FOOD_ENERGY`     |         2100 | kcal |
| `food_sphere_standard:ALL:FOOD_FAT`            | `ALL`          | `FOOD_FAT`        |           40 | gram |
| `food_sphere_standard:ALL:FOOD_PROTEIN`        | `ALL`          | `FOOD_PROTEIN`    |           53 | gram |
| `food_sphere_standard:INFANT_0_6:FOOD_ENERGY`  | `INFANT_0_6`   | `FOOD_ENERGY`     |          550 | kcal |
| `food_sphere_standard:INFANT_6_23:FOOD_ENERGY` | `INFANT_6_23`  | `FOOD_ENERGY`     |          850 | kcal |
| `food_sphere_standard:CHILD_2_5:FOOD_ENERGY`   | `CHILD_2_5`    | `FOOD_ENERGY`     |         1250 | kcal |
| `food_sphere_standard:CHILD_2_5:FOOD_PROTEIN`  | `CHILD_2_5`    | `FOOD_PROTEIN`    |           25 | gram |
| `food_sphere_standard:PREGNANT:FOOD_ENERGY`    | `PREGNANT`     | `FOOD_ENERGY`     |         2400 | kcal |
| `food_sphere_standard:PREGNANT:FOOD_PROTEIN`   | `PREGNANT`     | `FOOD_PROTEIN`    |           70 | gram |
| `food_sphere_standard:PREGNANT:FOOD_FAT`       | `PREGNANT`     | `FOOD_FAT`        |           45 | gram |
| `food_sphere_standard:LACTATING:FOOD_ENERGY`   | `LACTATING`    | `FOOD_ENERGY`     |         2600 | kcal |
| `food_sphere_standard:LACTATING:FOOD_PROTEIN`  | `LACTATING`    | `FOOD_PROTEIN`    |           75 | gram |
| `food_sphere_standard:ELDERLY:FOOD_ENERGY`     | `ELDERLY`      | `FOOD_ENERGY`     |         1900 | kcal |
| `food_sphere_standard:ELDERLY:FOOD_PROTEIN`    | `ELDERLY`      | `FOOD_PROTEIN`    |           60 | gram |

### 4.3 `replenishment_policy`

ทุกเอกสารมี `schema_v: 1`, `scope_type: REQUIREMENT_GROUP`, `status: active`, `source: SPHERE_BASELINE` และ `created_by: system`

| `_id`                                                 | target         | lead time (วัน) | review period (วัน) | safety (วัน) | min days | max days |
| ----------------------------------------------------- | -------------- | --------------: | ------------------: | -----------: | -------: | -------: |
| `replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY`  | `FOOD_ENERGY`  |               3 |                   4 |            3 |        3 |       45 |
| `replenishment_policy:REQUIREMENT_GROUP:FOOD_PROTEIN` | `FOOD_PROTEIN` |               2 |                   2 |            2 |        2 |       20 |
| `replenishment_policy:REQUIREMENT_GROUP:FOOD_FAT`     | `FOOD_FAT`     |               2 |                   3 |            2 |        2 |       30 |

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

## 6. รายการที่ไม่ใช่ seeded master data

ค่าต่อไปนี้ไม่ถูกสร้างโดย `runMasterSeed()` และห้ามอ้างว่าเป็น default จาก seed จนกว่าจะเพิ่มลง executable source และเอกสารนี้พร้อมกัน:

- ตัวเลือก WASH, sanitation และ facility ที่เป็นข้อเสนอ
- health service, referral reason และ medical catalog groups ที่ยังไม่มี fixture ใน seed
- NFI items, kits และ item categories ที่ยังไม่มีใน `seedCatalog()`
- shelter facility values ที่เป็น enum/schema แต่ไม่ได้สร้างเป็น `master_data` document
- master-data local override ราย shelter ซึ่งเป็น runtime operation ไม่ใช่ global seed

## 7. Definition of done สำหรับการแก้รายการ seed

- รายการในเอกสารตรงกับ source code ครบทุก key, label, default, parent และตัวเลข
- จำนวนรายการและ document ID ใน §1–§5 ถูกต้องหลังรัน static seed inspection
- ไม่มีรายการ proposal ปะปนในตาราง `Seeded`
- หากเปลี่ยน persisted shape, `schema_v`, scope, permission หรือ invariant ให้มี schema/CR ที่เกี่ยวข้องก่อน
- อัปเดต `updated` เป็นวันที่แก้จริง และคงลิงก์ไปยัง executable source ที่เป็นคู่ mirror
