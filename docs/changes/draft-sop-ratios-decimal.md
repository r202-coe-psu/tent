---
id: draft
title: sop-ratios — ค่าตั้งต้น Food Sphere เป็น qty_str และคำนวณ/เทียบสถานะด้วย Decimal
status: proposed
date: 2026-11-07
requested_by: "PO decision 2026-10-27 (#794) ข้อ 3 — daily_demand / conversion_factor / share_percent เป็น qty_str; issue #936"
decided_by: <เจ้าของโครงการ>
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

# sop-ratios — ค่าตั้งต้น Food Sphere เป็น qty_str และคำนวณ/เทียบสถานะด้วย Decimal

อ้างอิง: [CR-038](01-core/CR-038-decimal-qty-strings.md) (qty_str), CR-042, CR-095 (สูตร), issue #936, parent #794

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
| `sop-edit-form` dirty check                                                                | `Number(a) !== Number(b)`                   | Decimal `.eq`                                                                   |
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
- อ่าน: data adapter normalize ด้วย `qtyStrCoercePositiveSchema` / `qtyStrCoerceNonNegativeSchema`
  (รับ number เดิมและ string) — doc `schema_v` 2 (food_sphere_standard) / 1 (requirement_group) ยังอ่านและคำนวณได้
- เขียน: `persistQty` + `schema_v` ใหม่เสมอ → doc เก่าเปลี่ยนเป็น `qty_str` เมื่อถูกแก้ครั้งถัดไป
- ช่วง client เก่า/ใหม่ปนกัน: client เก่าอ่าน string ได้ (`"2100" > 0`, `new Decimal("2100")`, `Number("6.3")`);
  client ใหม่อ่าน number ที่ client เก่าเขียนได้ผ่าน coerce
- Seed fixture เปลี่ยนเป็น string

## Acceptance criteria

- [ ] demand 2, share 100, conversion_factor 3, stock 2, lead_time_days 3 → CRITICAL
- [ ] docDays เท่ากับ lead_time_days / min_doc_days / standard reorder days / max_doc_days พอดี (ค่าทศนิยม) ได้สถานะตามกฎเดิม
- [ ] share `33.33 + 33.33 + 33.34` = 100 ไม่มี warning; `0.1 + 0.2 + 99.7` = 100 ไม่มี warning
- [ ] severity ที่ coverage = 0.5 → `low`; 0.4999 → `critical`
- [ ] rawStock `"abc"`, `"12abc"`, `""` → error ระบุ `item_id` ไม่ใช่ 0
- [ ] doc เก่าที่ `daily_demand` / `conversion_factor` / `share_percent` เป็น number อ่านและคำนวณได้ผลเท่ากับ string
- [ ] เขียนใหม่ได้ `qty_str` + `schema_v` food_sphere_standard 3 / requirement_group 2
- [ ] unit test เดิมผ่านโดยไม่แก้ค่า expected (ยกเว้นชนิด number → string ใน fixture/seed)
- [ ] ทุก `.svelte` ที่แตะผ่าน `svelte-autofixer`

## Decision log

- 2026-10-27 — PO decision (#794 ข้อ 3): daily_demand / conversion_factor / share_percent เป็น qty_str + bump schema_v
- 2026-11-07 — proposed (draft; ไม่ลงเลข CR และไม่ลง `_index.md`)
