---
id: CR-238 # renumbered from draft-sop-ratios-decimal
title: sop-ratios — ค่าตั้งต้น Food Sphere เป็น qty_str และคำนวณ/เทียบสถานะด้วย Decimal
status: approved
date: 2026-11-07
updated: 2026-11-11
requested_by: "PO decision 2026-10-27 (#794) ข้อ 3 — daily_demand / conversion_factor / share_percent เป็น qty_str; issue #936"
decided_by: "Soravit Sukkarn (Team Lead)"
decision_date: 2026-11-07
layer: volatile
affects:
  - docs/data/schema.md §4.6 food_sphere_standard, §4.7 requirement_group
  - schema_v food_sphere_standard 2 → 3
  - schema_v requirement_group 1 → 2
  - frontend/src/lib/features/sop-ratios/{domain,data,ui}
  - frontend/src/lib/features/sop-ratios/domain/{food-sphere,requirement-group}.fixture.ts (seed via frontend/scripts/seed/master-seed.ts)
why: daily_demand / conversion_factor / share_percent persist เป็น JSON number และ replenishment-calc เทียบสถานะด้วย float ทำให้ docDays ที่ควรเท่ากับ lead_time_days พอดีหลุดเกณฑ์ CRITICAL
migration: ไม่มีสคริปต์ migrate — อ่านรับทั้ง number เดิมและ string (coerce), เขียนเป็น qty_str + schema_v ใหม่เสมอ; doc เก่าเปลี่ยนเป็น qty_str เมื่อถูกแก้ครั้งถัดไป
---

# CR-238 — sop-ratios: ค่าตั้งต้น Food Sphere เป็น qty_str และคำนวณ/เทียบสถานะด้วย Decimal

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ปรับชนิดข้อมูล `daily_demand`, `conversion_factor`, `share_percent` จาก JSON `number` เป็น `qty_str` ตาม CR-038 และคำนวณ DoC ตลอดสายด้วย Decimal (`qtyLte` / `qtyGt`) เพื่อแก้ปัญหา floating-point หลุดเกณฑ์ CRITICAL
> - **Schema & Scope:** bump `schema_v` ของ `food_sphere_standard` (2 → 3) และ `requirement_group` (1 → 2); `replenishment_policy` คงเดิม
> - **Dev ต้อง build:** อัปเดต domain/data/ui ใน `frontend/src/lib/features/sop-ratios/`, fixture seed และ tests ที่เกี่ยวข้อง โดยไม่ต้องรัน batch migration (อ่านได้ทั้ง number เดิมและ string ผ่าน coerce)

อ้างอิง: [CR-038](../01-core/CR-038-decimal-qty-strings.md) (qty_str), [CR-042](CR-042-daily-sop-calc-follow-up.md), [CR-095](../05-D-kitchen/CR-095-food-sphere-replenishment-schema.md) (สูตร), issue #936, parent #794

## Why

CR-038 ย้าย qty เป็น `qty_str` แล้ว แต่ฟีเจอร์ `sop-ratios` ยังเก็บและคำนวณเป็น float:

- `daily_demand`, `conversion_factor`, `share_percent` persist เป็น JSON number
  (`food-sphere.remote.ts` ใช้ `Number(...)`, zod `z.coerce.number()`)
- `replenishment-calc.ts` คำนวณด้วย Decimal แต่เรียก `.toNumber()` ระหว่างขั้น และเทียบสถานะด้วย float
  ตัวอย่าง: group demand 2, share 100, conversion_factor 3, stock 2, lead_time_days 3
  → item demand `0.6666666666666666` → docDays `3.0000000000000003` → ไม่เข้า CRITICAL (ได้ WARNING_REORDER)
  ทั้งที่ docDays จริง = 3 ซึ่งต้องเป็น CRITICAL ตามกฎเดิม (`docDays <= lead_time_days`)
- `food-sphere-table.ts` ใช้ `parseFloat(rawStock) || 0`: `"abc"` → 0 เงียบ ๆ, `"12abc"` → 12
- `requirement-group-form.svelte` บวก `share_percent` ด้วย float; `sop-edit-form.svelte` dirty check
  `Number(a) !== Number(b)`; `resource-calc.provider.ts` ปัดด้วย `Math.round(x*100)/100`

PO decision 2026-10-27 (#794) ข้อ 3: `daily_demand` / `conversion_factor` / `share_percent` เป็น `qty_str` + bump `schema_v`

## Change

### Before → after

| field / จุด                                                                                | Before                                      | After                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------- |
| `food_sphere_standard.daily_demand`                                                        | number > 0                                  | `qty_str` > 0                                                                   |
| `requirement_group.item_maps[].conversion_factor`                                          | number > 0                                  | `qty_str` > 0                                                                   |
| `requirement_group.item_maps[].share_percent`                                              | number 0–100 (optional)                     | `qty_str` 0–100 (optional)                                                      |
| `schema_v`                                                                                 | food_sphere_standard 2; requirement_group 1 | food_sphere_standard 3; requirement_group 2                                     |
| การคำนวณ (food-sphere-calc, replenishment-calc, food-sphere-table, resource-calc severity) | ส่งต่อระหว่างขั้นเป็น number                | ส่งต่อเป็น Decimal / `qty_str` ตลอดสาย; `.toNumber()` เฉพาะค่าที่ส่งออกไปแสดงผล |
| เทียบ threshold สถานะ                                                                      | float                                       | `qtyLte` / `qtyGt` (ปัด 4 ตำแหน่ง ROUND_HALF_UP ก่อนเทียบ ตาม CR-038)           |
| rawStock อ่านไม่ได้                                                                        | นับเป็น 0                                   | throw error ที่ระบุ `item_id` (ไม่นับเป็น 0)                                    |
| ผลรวม `share_percent`                                                                      | บวก float                                   | `addQty`                                                                        |
| provenance ratio                                                                           | `Math.round(x*100)/100`                     | Decimal `toDecimalPlaces(2)`                                                    |
| `sop-edit-form` dirty check                                                                | `Number(a) !== Number(b)`                   | Decimal `.eq` (form จัดการ `sop_profile`/`sop_override`)                        |
| แสดงผล `daily_demand`                                                                      | `toLocaleString()`                          | `formatQty()` (ผลบนจอเหมือนเดิม เช่น `2,100`)                                   |

### กติกา

**ไม่เปลี่ยนกฎธุรกิจ** — CR นี้เปลี่ยนเฉพาะชนิดข้อมูลและวิธีคำนวณ กฎที่คงไว้ตามโค้ดปัจจุบัน:

- สถานะ DoC ประเมินตามลำดับ: UNCONFIGURED (ไม่มี policy active หรือ demand ≤ 0) → CRITICAL
  (docDays ≤ lead_time_days หรือ ≤ min_doc_days) → WARNING_REORDER (docDays ≤ lead+review+safety) →
  OVERSTOCK (max_doc_days > 0 และ docDays > max_doc_days) → ADEQUATE. เครื่องหมาย `≤` / `>` เดิม
  เปลี่ยนเฉพาะการคำนวณเป็น Decimal พร้อมปัด qty
- severity: `ok` เมื่อ gap ≤ 0; `critical` เมื่อ coverage < 0.5; นอกนั้น `low` (coverage = 0.5 พอดี → `low`)
- ผลรวม `share_percent` ≠ 100 → warning ไม่บล็อก save (CR-095 FR-02.6); คงค่าคลาด 0.01 เดิม;
  share ที่ไม่กรอกนับ 0 ในผลรวม และใช้ 100 ตอนคำนวณ demand (พฤติกรรมเดิม)
- `conversion_factor` ≤ 0 ในข้อมูล → ใช้ 1 (fallback เดิม)
- หมายเหตุ: schema.md §4.8 เขียน "DoC ต่ำกว่า min_doc_days" ซึ่งไม่ตรงกับโค้ด `≤` — CR นี้คงพฤติกรรมโค้ด (`≤`)
  และไม่แก้ข้อความ §4.8 (แยกเป็นเรื่องอื่น)

### การตรวจค่า

**ฟอร์ม (ฝั่งเขียน)**

- V-1 — `share_percent` ที่ว่าง (`null` / `undefined` / `""`) ไม่ส่ง field ใน payload; `0` ที่กรอกจริงบันทึกเป็น `"0"`
- V-2 — `share_percent` ต้องอยู่ในช่วง 0–100 โดยตรวจ**หลัง**ปัด 4 ตำแหน่ง (`100.00004` → `100` ผ่าน; `100.5` ไม่ผ่าน)
- V-3 — `conversion_factor` ต้อง ≥ `0.0001` (ค่าต่ำสุดที่ยังไม่เป็น 0 หลังปัด 4 ตำแหน่ง)

**ข้อมูลที่อ่านจาก CouchDB (ฝั่งอ่าน)**

- V-4 — ตรวจชนิดก่อน coerce: รับเฉพาะ number ที่ finite หรือ string รูป `-?\d+(\.\d+)?`
- V-5 — ค่าต่อไปนี้ถือว่า**อ่านไม่ได้**: ชนิดอื่น (รวม `undefined` ของ `daily_demand`), `null`, `""`, ช่องว่าง,
  `NaN`, `Infinity`, ติดลบใน field ที่ห้ามติดลบ, `daily_demand` ≤ 0 หลังปัด, `share_percent` > 100 หลังปัด
- V-6 — `conversion_factor` ที่ค่าดิบ > 0 แต่ปัดแล้วเป็น 0 (เช่น `0.00004`) ถือว่าอ่านไม่ได้ ไม่ใช้ fallback 1
  (fallback ใช้เฉพาะค่าดิบ ≤ 0 ตามกติกาด้านบน)
- V-7 — `share_percent` ที่ไม่มี field (`undefined`) ไม่ใช่ข้อผิดพลาด: นับเป็น "ไม่กรอก" ตามกติกาด้านบน
- V-8 — เมื่อพบค่าอ่านไม่ได้ ระบบต้อง **fail-closed**: หยุดคำนวณทั้งตาราง แสดง alert ที่ระบุ `_id` และ field
  (เช่น `requirement_group:DRINKING_WATER` ช่อง `item_maps[0].share_percent`) ไม่ข้าม record เงียบ ๆ
  ไม่แสดงผลบางส่วน และไม่ตกไปใช้ค่า baseline แทนค่า override ของศูนย์
- V-9 — เมื่อแก้ข้อมูลให้ถูกแล้ว alert หายและหน้ากลับมาคำนวณตามปกติ

### คงเดิม / นอกขอบเขต

- `replenishment_policy` (`*_days` เป็น int — จำนวนวัน, out of scope ของ #794)
- `daily-sop.measured_values`
- กราฟ / `toFixed` / `toLocaleString` ที่แสดงผลอย่างเดียว
- สิทธิ์การแก้ไข (SA แก้ master, SM แก้ override ของศูนย์ตัวเอง) ไม่เปลี่ยน; CouchDB `validate_doc_update`
  ตรวจแค่ doc type allowlist จึงไม่ต้องแก้ design doc
- ไม่มี worker / backend / Mongo อ่าน doc สองชนิดนี้

## Impact

- Code: frontend `sop-ratios` (domain / data / ui) เท่านั้น
- Fixture + test: `food-sphere.fixture.ts`, `requirement-group.fixture.ts`,
  `frontend/src/lib/features/catalog/domain/master-seed.test.ts` (expectations)
- Spec: `docs/data/schema.md` §4.6 / §4.7
- ไม่ต้องแก้ e2e (number เดิมยังอ่านได้; หน้าจอยังแสดง `2,100`)
- ไม่มีการเปลี่ยน API / OpenAPI

## Migration

- ไม่มีสคริปต์ migrate และไม่ต้อง unseed
- อ่าน: data adapter ตรวจชนิดตาม V-4 แล้ว normalize (รับทั้ง number เดิมและ string) — doc `schema_v` 2
  (food_sphere_standard) / 1 (requirement_group) ยังอ่านและคำนวณได้

  | field               | schema ที่ใช้ normalize         | หมายเหตุ                                        |
  | ------------------- | ------------------------------- | ----------------------------------------------- |
  | `daily_demand`      | `qtyStrCoercePositiveSchema`    | ≤ 0 → อ่านไม่ได้                                |
  | `share_percent`     | `qtyStrCoerceNonNegativeSchema` | > 100 หลังปัด → อ่านไม่ได้                      |
  | `conversion_factor` | `qtyStrCoerceSchema`            | ไม่ใช้ Positive เพื่อคง fallback ค่าดิบ ≤ 0 → 1 |

- เขียน: `persistQty` + `schema_v` ใหม่เสมอ → doc เก่าเปลี่ยนเป็น `qty_str` เมื่อถูกแก้ครั้งถัดไป
- ช่วง client เก่า/ใหม่ปนกัน: client ใหม่อ่าน number เดิมที่ client เก่าเขียนได้ผ่าน coerce; ทั้งนี้ client เก่าจะกรอง doc ใหม่ออกเนื่องจาก predicate `isFoodSphereStandard` เดิมตรวจ `typeof daily_demand === 'number'` จึงต้องให้ client รีโหลดแอปเป็นเวอร์ชันใหม่เพื่อรองรับ doc ที่เขียนเป็น string
- Seed fixture เปลี่ยนเป็น string

## Acceptance criteria

- [ ] demand 2, share 100, conversion_factor 3, stock 2, lead_time_days 3 → CRITICAL
- [ ] docDays เท่ากับ lead_time_days / min_doc_days / standard reorder days / max_doc_days พอดี (ค่าทศนิยม) ได้สถานะตามกฎเดิม
- [ ] share `33.33 + 33.33 + 33.34` = 100 ไม่มี warning; `0.1 + 0.2 + 99.7` = 100 ไม่มี warning
- [ ] severity ที่ coverage = 0.5 → `low`; 0.4999 → `critical`
- [ ] rawStock `"abc"`, `"12abc"`, `""` → error ระบุ `item_id` ไม่ใช่ 0
- [ ] doc เก่าที่ `daily_demand` / `conversion_factor` / `share_percent` เป็น number อ่านและคำนวณได้ผลเท่ากับ string
- [ ] เขียนใหม่ได้ `qty_str` + `schema_v` food_sphere_standard 3 / requirement_group 2
- [ ] unit test เดิมผ่านโดยไม่แก้ค่า expected (ยกเว้นชนิด number → string ใน fixture/seed, และปรับ assertion ของฟังก์ชันที่เปลี่ยน signature เป็น Decimal)
- [ ] ล้าง share ที่เคยเป็น `40` แล้วบันทึก → เปิดฟอร์มซ้ำ share ว่าง ไม่มี `40` ค้าง (V-1)
- [ ] share `100.00004` บันทึกได้เป็น `100`; `100.5` ขึ้น error ใต้ช่อง (V-2)
- [ ] doc ที่ `share_percent` = `"abc"` / `null` หรือ `daily_demand` ไม่มีค่า → แท็บสต็อกแสดง alert ระบุ `_id` + field และไม่แสดงตาราง/สรุป; แก้ doc แล้วกลับมาปกติ (V-5, V-8, V-9)
- [ ] `conversion_factor` ค่าดิบ `0.00004` → alert; ค่าดิบ `0` หรือติดลบ → ใช้ 1 (V-6)
- [ ] ทุก `.svelte` ที่แตะผ่าน `svelte-autofixer`

## Decision log

- 2026-10-27 — PO decision (#794 ข้อ 3): daily_demand / conversion_factor / share_percent เป็น qty_str + bump schema_v
- 2026-11-07 — proposed (draft; PR #1270)
- 2026-11-07 — approved โดย Soravit Sukkarn (Team Lead) — มอบหมายเลข CR-238
- 2026-11-11 — เพิ่มหัวข้อ "การตรวจค่า" (V-1..V-9) และ acceptance ที่เกี่ยวข้อง; ระบุ schema ฝั่งอ่านรายฟิลด์ใน
  Migration — ไม่เปลี่ยนชนิดข้อมูล, `schema_v` หรือขอบเขตเดิม
