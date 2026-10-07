---
id: draft
title: กติกาจับคู่ผู้รับกับเมนูอาหารปรุงสำเร็จ (HALAL / VEGAN / กลุ่มอายุ) ที่จุดแจกอาหาร
status: proposed
date: 2026-10-06
updated: 2026-10-07
requested_by: ทีม frontend (onsite meal distribution)
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/data/schema.md §2.30 distribution_log (เพิ่มย่อหน้ากติกา — ไม่เปลี่ยนรูป doc)
  - docs/data/schema.md §2.5 headcount mapping (CR-022) — อ้างอิงร่วม
  - docs/changes/CR-121-spec-ticket.md FR-DST-02 + ผัง §2.1 โหนด D2 ("ตรวจสิทธิ์อัตโนมัติ (โควตา & Special Needs)")
  - schema_v — ไม่เปลี่ยน
  - frontend/src/lib/features/distribution/domain/food-supplies/ (ฟังก์ชันใหม่ derive แท็กผู้รับ + เทียบเมนู)
  - frontend/src/lib/features/distribution/ui/frontline/FoodDistributionCard.svelte, MealEntitlementWarning.svelte
---

# กติกาจับคู่ผู้รับกับเมนูอาหารปรุงสำเร็จ

> **สรุป (TL;DR)**
> - **เปลี่ยนอะไร:** กำหนดกติกา derive "กลุ่มเป้าหมาย" ของผู้รับ (`evacuee`) แล้วเทียบกับแท็กเมนู (`item_master.dietary` / `age_group`) ที่จุดแจกอาหาร
> - **ทำไม:** CR-121 ผัง §2.1 โหนด D2 ระบุ "ตรวจสิทธิ์ (โควตา & Special Needs)" แต่ไม่มี FR/กติกา mapping; จุดแจก `/onsite/distribution` (ขั้น 2) ตอนนี้ตรวจแค่โควตามื้อ ไม่ตรวจ Special Needs เลย
> - **dev ต้อง build:** ฟังก์ชัน derive แท็กผู้รับตามตาราง FR-MRM-01 + พฤติกรรมเมื่อไม่ตรงตาม FR-MRM-04
> - **กระทบ:** ไม่เปลี่ยน schema / `schema_v`; เพิ่มกติกาใน schema.md §2.30

## Why
- CR-121 FR-DST-02 / ผัง §2.1 โหนด D2 อ้าง "ตรวจสิทธิ์ Special Needs" แต่ไม่นิยามกติกา → แต่ละหน้าจอ derive ต่างกันได้
- ถ้าจะคัดกรองหน้าจุดแจก ต้องสอดคล้องกับ mapping CR-022 ของ headcount (`special_needs`) ไม่งั้นยอดวางแผน (halal/infant) กับการคัดกรองหน้าจุดแจกจะไม่ตรงกัน; ร่างนี้รวม `special_needs`, `vulnerable_groups` และอายุ

## Change

**Before:** ไม่มีกติกา. แท็กเมนูมีใน `item_master` (`dietary: [HALAL|VEGAN]`, `age_group: ALL|INFANT|CHILD|ELDERLY` — AC-TKT-05.1) แต่ไม่มีนิยามว่าผู้รับคนไหน "ตรง" เมนูไหน. Mapping ที่มีอยู่คือ headcount ของ `meal_plan` (CR-022): `halal` = `religion='muslim'`, `infant` = `special_needs` มี `'infant'`, `soft_food` = `special_needs` ∈ {`bedridden`,`chronic_illness`,`elderly`}. หมายเหตุ: ตั้งแต่ CR-046 `special_needs` เป็น free text (schema.md §1.1) — การจับ `'infant'` / `'elderly'` จึงเป็นการเทียบสตริงตรงตัว ไม่มี whitelist รับประกัน.

**After (เสนอ):**

### Requirements
- **FR-MRM-00** — ขอบเขต > [NEEDS DECISION: (A) ทำใน V1 ตาม FR-MRM-01..05, (B) ตัดออกจาก V1 — ลบ "Special Needs" ออกจาก flow D2 ของ CR-121 แล้ว reject ร่างนี้]
- **FR-MRM-01** — แท็กของผู้รับประเภท `evacuee` derive ดังนี้ (คนหนึ่งมีได้หลายแท็ก):

  | แท็ก | เงื่อนไข (เสนอ) |
  | --- | --- |
  | `HALAL` | `religion = 'muslim'` (ตรงกับ CR-022) |
  | `INFANT` | `vulnerable_groups` มี `infant` **หรือ** `special_needs` มี `'infant'` (CR-022) **หรือ** `age < 2` |
  | `CHILD` | `vulnerable_groups` มี `young_child` **หรือ** `2 ≤ age < 13` |
  | `ELDERLY` | `vulnerable_groups` มี `elderly_dependent` **หรือ** `special_needs` มี `'elderly'` (CR-022) **หรือ** `age ≥ 60` |
  | `VEGAN` | > [NEEDS DECISION: ไม่มี field โครงสร้างรองรับ — `dietary_restrictions` master ถูกตัดใน CR-137; `special_needs` เป็น free text (CR-046). ทางเลือก: (A) จับคำใน `special_needs` (`มังสวิรัติ`, `เจ`, `vegan`, `vegetarian`) แบบ heuristic, (B) ไม่ derive — ผู้รับเลือกเมนู VEGAN เองโดยไม่ต้อง override, (C) เพิ่ม field ใหม่ใน `evacuee` (ต้อง CR + bump schema_v)] |

  > [NEEDS DECISION: เส้นแบ่งอายุ `<2` / `<13` / `≥60` เป็นค่าที่ implementation ตั้งเอง ยังไม่มีแหล่งอ้างอิง — ยืนยันหรือกำหนดใหม่ (เช่น อิง Sphere / SOP ratio)]
- **FR-MRM-02** — ผู้รับประเภท `volunteer` และ `outside` ไม่มีแท็ก → รับได้เฉพาะเมนูที่ไม่มีแท็ก (เมนูทั่วไป) โดยไม่ต้อง override
- **FR-MRM-03** — เมนูที่ไม่มีแท็ก (`dietary = []` และ `age_group ∈ {ALL, ไม่ระบุ}`) = เมนูทั่วไป แจกได้ทุกคน. เมนูที่มีแท็ก: ผู้รับต้องมีแท็กร่วมอย่างน้อย 1 แท็ก จึงถือว่า "ตรง"
- **FR-MRM-04** — เมื่อไม่ตรง: > [NEEDS DECISION: (A) เตือน + บังคับ override พร้อมเหตุผล บันทึก `is_override: true` + `override_reason` — ใช้กลไกเดียวกับรับซ้ำ (FR-DST-02), (B) เตือนอย่างเดียว ไม่บังคับ override, (C) บล็อก]
- **FR-MRM-05** — กติกานี้ไม่เขียน field ใหม่ลง `distribution_log`; ใช้ `is_override` / `override_reason` (§2.30) เดิมเท่านั้น

### Acceptance
- ผู้รับ `religion='muslim'` เลือกเมนู `dietary:['HALAL']` → ไม่ต้อง override
- ผู้รับไม่มีแท็กเลือกเมนู HALAL → แสดงคำเตือนตาม FR-MRM-04
- เมนูทั่วไป → ทุก `recipient_type` แจกได้โดยไม่เตือน
- unit test ครอบทุกแถวของตาราง FR-MRM-01

## Impact
- docs: เพิ่มย่อหน้า "Recipient ↔ menu matching" ใต้ §2.30; cross-ref CR-022 ที่ §2.5
- code: เพิ่มฟังก์ชัน domain ใน `features/distribution` + test; แสดงคำเตือนใน `FoodDistributionCard` (ใช้ `MealEntitlementWarning` เดิม)
- ไม่กระทบ VDU / Mango index / backend

## Migration
N/A — ไม่เปลี่ยนรูป doc ที่ persist

## Decision log
- 2026-10-06 — proposed (จากการ align `meal-distribution` เข้ากับ schema กลาง)
- 2026-10-06 — rescoped ให้ชี้ที่ `/onsite/distribution` (`features/distribution`) แทน `features/meal-distribution` ที่เลิกใช้; เพิ่ม FR-MRM-00 (ทำ/ไม่ทำใน V1)
- 2026-10-07 — จัดลำดับ section เป็น Why → Change ตาม template; อ้าง D2 เป็นผัง §2.1; แก้ TL;DR ให้ชี้ FR-MRM-04; เพิ่มหมายเหตุว่า `special_needs` เป็น free text (CR-046)
