---
id: draft
title: การแจกของหน้างาน (Distribution Desk / Station 4 — `/onsite/distribution`) — ขอบเขตหน้าจอ + role, กติกาแจกอาหารปรุงสุก, จับคู่ผู้รับ↔เมนู, ปิด CR-109
status: proposed
date: 2026-10-06
updated: 2026-10-10
requested_by: ทีม frontend (รับช่วง `/onsite/distribution` ต่อ)
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/changes/CR-121-spec-ticket.md §1.2 ข้อ 2, ผัง §2.1 (โหนด D2), ผัง §2.2 (Step 6), FR-DST-02, FR-DST-03, FR-DST-05, FR-LON-02, §5 ตาราง Screen/Role (หน้าจอ 13–17)
  - docs/changes/CR-109-meal-distribution-onsite-scan.md (frontmatter `status` + หมายเหตุ superseded)
  - docs/changes/_index.md แถว CR-109
  - docs/prd/role-permission-matrix.md §3 (แถว Meal Planning & Service — RM:85, แถว Inventory & Supply — RM:87)
  - docs/task-breakdown/03-C-supply.md T-12 (อ้างอิง — ไม่ต้องแก้)
  - docs/data/schema.md §2.5 (อ้างอิง CR-022), §2.7 (ข้อความค้าง), §2.29 `requisition_ticket`, §2.30 `distribution_log` (เพิ่มกติกา)
  - docs/sitemap.md (ยังไม่มี `/onsite/distribution`)
  - schema_v — ไม่เปลี่ยน ถ้าเลือกทางเลือกที่ไม่แตะ schema; `requisition_ticket` 1 → 2 ถ้า FR-MQW-03 B หรือ FR-MQW-06 A; `evacuee` ถ้า FR-MRM-01 VEGAN C
  - branch `docs/draft-meal-distribution-onsite-scan` (local + origin) — ไม่ merge
  - frontend/src/routes/(protected)/onsite/distribution/+page.ts + frontend/src/lib/guards/auth.ts (guard)
  - frontend/src/lib/features/distribution/application/food-supplies/auth.ts
  - frontend/src/lib/features/distribution/application/food-supplies/distribution-workflow.ts (CapacityExceededError, cooking_completed_at)
  - frontend/src/lib/features/distribution/domain/food-supplies/distribution-log.ts (isDuplicateMealDistributionLog)
  - frontend/src/lib/features/distribution/domain/food-supplies/menu-matching.ts (ใหม่ — derive แท็กผู้รับ + เทียบเมนู)
  - frontend/src/lib/features/distribution/ui/frontline/FrontlineStationPage.svelte, FoodDistributionCard.svelte (FOOD_4H_TIMESTAMP_BLOCKER), MealEntitlementWarning.svelte
---

# การแจกของหน้างาน (Distribution Desk / Station 4)

> **สรุป (TL;DR)**
> - **เปลี่ยนอะไร:** รวมทุกเรื่องของการแจกของหน้างาน `/onsite/distribution` ไว้ใน CR เดียว แบ่ง 4 หัวข้อ:
>   - **A. ขอบเขตหน้าจอ + role** — รับรองหน้าเดียว 5 ขั้น (as-built, PR #312) แทนหน้าจอ 13–17 ของ CR-121; role ต่อขั้น; จุดแจกเห็นตั๋วไหน; ยอดของยืมตอนปิดรอบ
>   - **B. กติกาแจกอาหารปรุงสุก** — รับซ้ำนับต่อมื้อ/ต่อเมนู + บล็อกหรือ override, "วันเดียวกัน", เพดาน In-Hand, นาฬิกา 4 ชม.
>   - **C. จับคู่ผู้รับ↔เมนู** — derive แท็กผู้รับ (HALAL / VEGAN / กลุ่มอายุ) เทียบแท็กเมนู
>   - **D. ปิด CR-109** — mark superseded โดย CR-121, ทิ้ง branch ร่างเก่า, แก้ข้อความค้างใน schema.md §2.7
> - **ทำไม:** spec 3 ที่ (CR-121, role matrix, schema/VDU) ขัดกันเอง; CR-121 อ้างมติ CR-109 ผิดเรื่อง; โค้ดบน `develop` เลือกไปแล้วหลายข้อโดยไม่มี doc รองรับ
> - **dev ต้อง build:** ส่วนใหญ่มีแล้ว — CR นี้ทำให้ doc ตามโค้ด. งานใหม่จริง: route guard (A, FR-DDS-04 — ทำแล้วบน `feat/distribution-desk`), filter ตั๋วตามจุดแจก (ถ้า FR-DDS-07 B), นาฬิกา 4 ชม. (B, FR-MQW-06), จับคู่เมนู (C)
> - **กระทบ:** scope + role/permission + กติกาใน schema.md §2.29/§2.30; `schema_v` ไม่เปลี่ยนถ้าเลือกทางเลือก A ทุกข้อ

## สารบัญ / สถานะการตัดสินใจ

| หัวข้อ | FR | ต้องเคาะ |
| --- | --- | --- |
| [A. ขอบเขตหน้าจอ + role](#a-ขอบเขตหน้าจอ--role) | FR-DDS-01..07 | FR-DDS-02, 03, 05, 07 |
| [B. กติกาแจกอาหารปรุงสุก](#b-กติกาแจกอาหารปรุงสุก) | FR-MQW-01..06 | FR-MQW-01, 03, 05, 06 |
| [C. จับคู่ผู้รับ↔เมนู](#c-จับคู่ผู้รับเมนู) | FR-MRM-00..05 | FR-MRM-00, 01 (VEGAN + เส้นแบ่งอายุ), 04 |
| [D. ปิด CR-109](#d-ปิด-cr-109-เป็น-superseded-โดย-cr-121) | FR-CRS-01..04 | FR-CRS-04 |

---

## A. ขอบเขตหน้าจอ + role

### Why

**As-built (`develop`, PR #312):** `/onsite/distribution` = `FrontlineStationPage` มี 5 แท็บ: 1 รับของถึงจุดแจก · 2 แจกอาหารปรุงสุก · 3 จ่ายพัสดุ & ยืม · 4 รับคืนสิ่งของ · 5 ปิดรอบ & คืนของ. guard ระดับ route = `requireAuth` อย่างเดียว; role ตรวจในปุ่ม (`canPerformFrontlineDistribution` = SA, REG, SC, SM; รับคืนแบบ PHYSICAL = `canReceivePhysicalStock` = WH, SC, SM).

**ความขัดแย้งของ role:**

| ขั้น | CR-121 §5 | role matrix | schema / VDU | โค้ด |
| --- | --- | --- | --- | --- |
| 1 รับของ, 2 แจกอาหาร | REG, SC, SM (+ Shift Pass) — ไม่มี SA, KS | RM:85 Meal Planning & Service ("บันทึกแจกจ่ายมื้ออาหาร") = SA, SM, KS; REG "—" | — | SA, REG, SC, SM |
| 3 จ่ายพัสดุ & ยืม | REG, SC, SM (+ Shift Pass) | RM:87 Inventory & Supply ("ตัดจ่ายพัสดุ") = SA, SM, SC; REG "—" | — | SA, REG, SC, SM |
| 4 รับคืน | WH, SC, **REG** — ไม่มี SM | `warehouse_staff` ไม่อยู่ใน 10 canonical roles (RM §1.1) | §2.33 Mode-Specific RBAC (VDU Rule 16) `PHYSICAL` = WH, SC, SM, SA, **ปฏิเสธ REG**; VDU `distribution_log` (`shelter-access-design.ts` ข้อ 13) routine physical return = WH, SC, SM, SA | WH, SC, SM, SA (REG เห็นแต่กดไม่ได้) |
| 5 ปิดรอบ | REG, SC, SM (ไม่มี Shift Pass) | — | — | SA, REG, SC, SM |

**ยอดของยืมตอนปิดรอบ:** FR-DST-05 และผัง §2.2 (Step 6) ของ CR-121 ส่ง "ของที่เหลือ **รวมของยืมที่ได้คืน**" กลับคลัง 100% แล้วคลังเขียน `receive` อีกรอบ — แต่ FR-LON-02 ของยืมที่คืนที่เคาน์เตอร์เขียน `receive` เข้าคลังทันทีแล้ว → นับซ้ำ. โค้ดเลือกไว้: ของยืมนับเป็น "แจกออก" ตอนปิดรอบ (`remaining_in_hand = allocated − distributed`) และไม่รวมของที่คืนเคาน์เตอร์.

**จุดแจกเห็นตั๋วไหน:** ตั๋วชี้ปลายทางด้วย `destination_location = distribution_point:{zone}` (§2.29) แต่ CR-128 ให้ shelter มี `food_distribution_points[{id,name}]` — ไม่มีนิยามว่าเชื่อมกันอย่างไร. โค้ดแสดงทุกตั๋วของ shelter.

### Requirements
- **FR-DDS-01** — รับรอง `/onsite/distribution` เป็นหน้าเดียว 5 ขั้น ครอบหน้าจอ 13, 14, 15, 16 และ 17 ของ CR-121 §5; แก้ตาราง §5 ให้ชี้ route เดียว และตัด `/onsite/distribution/scan`, `/onsite/distribution/reconcile`, `/onsite/loans`, `/onsite/returns` ออก. หน้าจอ 18 (`/onsite/scan-check-in-out`) คงเดิม
- **FR-DDS-02** — role ขั้น 1–3 และ 5 > [NEEDS DECISION: (A) SA, REG, SC, SM — ตามโค้ด และแก้ RM:85 ให้ REG/SC แจกได้ (KS ไม่แจก — ครัวจบที่ส่งเข้าคลัง), (B) ตาม RM:85 (SA, SM, KS) — แก้โค้ดและ CR-121 §5]
- **FR-DDS-03** — role ขั้น 4 > [NEEDS DECISION: (A) รับคืนแบบ PHYSICAL (มีของ → `receive`) = WH, SC, SM, SA ตาม §2.33 (VDU Rule 16) และ VDU `distribution_log`; REG ทำได้แค่ค้นหา/ดูยอดค้าง และแก้ CR-121 §5 หน้าจอ 17 ตัด REG, (B) ให้ REG รับคืนได้ — ต้องแก้ §2.33, VDU Rule 16 และ VDU `distribution_log` (stable-ish)]
- **FR-DDS-04** — route guard: `+page.ts` ต้องใช้ guard ที่ยอมรับ **union** ของ role ทุกขั้น (ตาม FR-DDS-02/03 ที่เคาะ) แล้วซ่อน/ปิดปุ่มรายขั้นตาม role ใน UI; ผู้ใช้นอก union ถูก redirect
- **FR-DDS-05** — Volunteer Shift Pass > [NEEDS DECISION: (A) ตัดออกจาก V1 — ผู้ใช้ทุกคนต้องมีบัญชี staff (`distributed_by` = user id), (B) คงไว้ — ต้องมี CR แยกนิยามการ auth ของ Shift Pass]
- **FR-DDS-06** — ยอดของยืมตอนปิดรอบ: `distribution_log` ที่ `is_returnable=true` นับเป็น **แจกออก** ใน `distributed_qty`; ยอดส่งคืนคลังตอนปิดรอบ (`returned_qty`) = ของที่ยังไม่ได้แจกเท่านั้น; ของยืมที่คืนภายหลังเข้าคลังผ่าน FR-LON-02 (เคาน์เตอร์) หรือ bulk pool (CR-134) เท่านั้น — แก้ข้อความ FR-DST-05 และผัง §2.2 Step 6 ของ CR-121 ("รวมของยืมที่ได้คืน") ให้ตรง
- **FR-DDS-07** — ตั๋วที่จุดแจกเห็น > [NEEDS DECISION: (A) ทุกตั๋ว food/supplies ของ shelter ที่เลือก (as-built), (B) ให้ผู้ใช้เลือกจุดแจก (`food_distribution_points[].id`) แล้ว filter `destination_location = distribution_point:{id}` — ต้องกำหนดว่า `{zone}` ใน §2.29 = `food_distribution_points[].id`]

### Acceptance
- ตาราง CR-121 §5 + RM ระบุ route และ role ของ Station 4 ตรงกันทุกขั้น
- ผู้ใช้ role นอก union เปิด `/onsite/distribution` → redirect
- REG (ถ้า FR-DDS-03 A) เห็นแท็บรับคืนแต่ปุ่มรับคืนแบบมีของถูกปิดพร้อมข้อความ
- ตั๋ว supplies ที่มีของยืม 10 ชิ้น แจก 10 คืนเคาน์เตอร์ 4 → ปิดรอบ: `distributed_qty=10`, `returned_qty=0`, ไม่มีการ `receive` ซ้ำ 4 ชิ้น

---

## B. กติกาแจกอาหารปรุงสุก

ขอบเขต: ขั้น 2 (แจกอาหารปรุงสุก) และเพดานยอดของขั้น 2–3.

### Why

| เรื่อง | ฝั่ง A | ฝั่ง B | โค้ดปัจจุบัน (`develop`) |
| --- | --- | --- | --- |
| รับซ้ำ | CR-121 §1.2 ข้อ 2 คงกติกา CR-109: "คนเดิม + **เมนูเดิม** ในมื้อเดียวกัน" — CR-109 FR-MD-03 = **hard-block**, ตัด `override_reason` ใน V1 | CR-121 FR-DST-02 / หน้าจอ 14: "โควตา **1 คน/มื้อ**" + ปุ่ม `[กรณีพิเศษ Override]` บังคับเหตุผล | ต่อ **มื้อ** (ไม่ดูเมนู) + วันปฏิทินไทย, **override ได้**พร้อมเหตุผล (`isDuplicateMealDistributionLog`) |
| Soft warning ของ CR-109 | CR-121 §1.2 ข้อ 2 บอกว่าคงมติ "Soft Warning 4 ชม." ของ CR-109 | CR-109 จริง ๆ คือ soft warning ของ **เพดานยอดผลิต** `Σ portions ≤ actual_yield` — ไม่มีเรื่อง 4 ชม. | — |
| แจกเกินยอด | CR-109: เกิน `actual_yield` ได้ (soft) | T-12 (03-C-supply.md): "แจกเกิน on-hand → เตือน/ปฏิเสธ — ห้ามทำให้ stock ติดลบ" (สต็อกคลัง) | **ปฏิเสธ** เมื่อเกิน `allocated_qty` (`CapacityExceededError`) |
| วันของรอบ | `requisition_ticket` (food) มี `meal` แต่ไม่มีวันที่ให้บริการ | — | derive จาก `thailandCalendarDay(distributed_at)` ตอนเช็คซ้ำ |
| นาฬิกา 4 ชม. | FR-DST-03 "นับจากเวลาปรุงเสร็จ" | ตั๋วไม่มี lot/เวลาปรุง; 1 ตั๋วอาจมีหลาย lot | workflow รองรับ `cooking_completed_at` แต่ UI ส่งไม่ได้ → ปิดไว้ (`FOOD_4H_TIMESTAMP_BLOCKER`) |

### Requirements
- **FR-MQW-01** — "รับซ้ำ" > [NEEDS DECISION: (A) ต่อ **มื้อ**: ผู้รับคนเดิม + `meal` เดียวกัน + วันเดียวกัน ไม่ว่าเมนูใด — ตรง FR-DST-02 และโค้ดปัจจุบัน, (B) ต่อ **เมนู**: + `item_id` เดียวกัน — ตรง CR-121 §1.2 ข้อ 2 / CR-109]
- **FR-MQW-02** — "วันเดียวกัน" = วันปฏิทิน Asia/Bangkok (UTC+7) ของ `distribution_log.distributed_at`; log ที่ `status='voided'` หรือ `is_returnable=true` ไม่นับ
- **FR-MQW-03** — วันของรอบแจก (จัดกลุ่ม/filter ตั๋วอาหารตามวัน) > [NEEDS DECISION: (A) derive = `thailandCalendarDay(requisition_ticket.created_at)` — ไม่เปลี่ยน schema; ข้อเสีย: ตั๋วเปิดล่วงหน้าข้ามวันจะอยู่ผิดวัน, (B) เพิ่ม `service_date` (str `YYYY-MM-DD`, req เมื่อ `requisition_type='food'`) → bump schema_v 1→2, (C) derive จาก `meal_plan.date` ผ่าน `distribution_log.meal_service_id`]
- **FR-MQW-04** — ห้ามบันทึก `distribution_log` ที่ทำให้ `Σ qty (non-voided)` ของ ticket+item เกิน `allocated_qty` (รวม amendments) — ระบบปฏิเสธพร้อมข้อความ; เติมของใช้ amendment (FR-DST-04) เท่านั้น. **ยกเลิก** soft warning `Σ portions ≤ actual_yield` ของ CR-109 (ถูก cap ด้วย `allocated_qty` แทนแล้ว เพราะของออกจากคลังได้ไม่เกินที่ผลิตเข้า)
- **FR-MQW-05** — รับซ้ำตาม FR-MQW-01 > [NEEDS DECISION: (A) ไม่บล็อก — override พร้อมเหตุผล (`is_override: true`, `override_reason` req) ตาม FR-DST-02 และโค้ดปัจจุบัน, (B) บล็อกแข็งตาม CR-109 FR-MD-03]. role ที่ override ได้ = ทุก role ที่แจกได้ (ไม่ต้องยกระดับ)
- **FR-MQW-06** — เวลาเริ่มนาฬิกา 4 ชม. ของ `item_category:ready_meal` > [NEEDS DECISION: (A) `meal_service.cooking_completed_at` ของ `meal_service_id` ที่ผูกกับตั๋ว — ต้องให้ตั๋ว food ระบุ `meal_service_id` (ยังไม่มีใน §2.29 → field ใหม่ + bump schema_v), (B) `lot.produced_at`/`lot.expiry` ของ lot ที่ถูก `distribute` ออกให้ตั๋วนี้ (ผ่าน `stock_ledger.lot_ref`) — ไม่เปลี่ยน schema ticket; หลาย lot ใช้ lot **ที่เก่าที่สุด** (ขึ้นกับ `draft-lot-produced-at`), (C) เลื่อนออกจาก V1 — ไม่แสดงนาฬิกา, ไม่ stamp `is_expired_warning`]

### Acceptance
- ผู้รับรับ lunch เมนู X แล้ว สแกน lunch เมนู Y วันเดียวกัน → ผลตาม FR-MQW-01/05 ที่เคาะ
- log `distributed_at` 23:30 (UTC+7) กับ 00:10 วันถัดไป → ไม่นับซ้ำ
- log ที่ voided → ไม่นับซ้ำ และคืน In-Hand
- แจก qty ที่ทำให้เกิน `allocated_qty` → ถูกปฏิเสธ ไม่มี doc ถูกเขียน
- (ถ้า FR-MQW-06 ≠ C) อาหารเกิน 4 ชม. → แบนเนอร์แดง, ยืนยันได้, log มี `is_expired_warning: true`

---

## C. จับคู่ผู้รับ↔เมนู

ขอบเขต: ขั้น 2 (แจกอาหารปรุงสุก) — กติกา "ตรวจสิทธิ์ Special Needs" ของ CR-121 ผัง §2.1 โหนด D2.

### Why
- CR-121 FR-DST-02 / ผัง §2.1 โหนด D2 อ้าง "ตรวจสิทธิ์ (โควตา & Special Needs)" แต่ไม่นิยามกติกา → แต่ละหน้าจอ derive ต่างกันได้; จุดแจกตอนนี้ตรวจแค่โควตามื้อ ไม่ตรวจ Special Needs เลย
- ถ้าจะคัดกรองหน้าจุดแจก ต้องสอดคล้องกับ mapping CR-022 ของ headcount (`special_needs`) ไม่งั้นยอดวางแผน (halal/infant) กับการคัดกรองหน้าจุดแจกจะไม่ตรงกัน; หัวข้อนี้รวม `special_needs`, `vulnerable_groups` และอายุ

**Before:** ไม่มีกติกา. แท็กเมนูมีใน `item_master` (`dietary: [HALAL|VEGAN]`, `age_group: ALL|INFANT|CHILD|ELDERLY` — AC-TKT-05.1) แต่ไม่มีนิยามว่าผู้รับคนไหน "ตรง" เมนูไหน. Mapping ที่มีอยู่คือ headcount ของ `meal_plan` (CR-022): `halal` = `religion='muslim'`, `infant` = `special_needs` มี `'infant'`, `soft_food` = `special_needs` ∈ {`bedridden`,`chronic_illness`,`elderly`}. หมายเหตุ: ตั้งแต่ CR-046 `special_needs` เป็น free text (schema.md §1.1) — การจับ `'infant'` / `'elderly'` จึงเป็นการเทียบสตริงตรงตัว ไม่มี whitelist รับประกัน.

### Requirements
- **FR-MRM-00** — ขอบเขต > [NEEDS DECISION: (A) ทำใน V1 ตาม FR-MRM-01..05, (B) ตัดออกจาก V1 — ลบ "Special Needs" ออกจาก flow D2 ของ CR-121 แล้วตัดหัวข้อ C ทิ้ง]
- **FR-MRM-01** — แท็กของผู้รับประเภท `evacuee` derive ดังนี้ (คนหนึ่งมีได้หลายแท็ก):

  | แท็ก | เงื่อนไข (เสนอ) |
  | --- | --- |
  | `HALAL` | `religion = 'muslim'` (ตรงกับ CR-022) |
  | `INFANT` | `vulnerable_groups` มี `infant` **หรือ** `special_needs` มี `'infant'` (CR-022) **หรือ** `age < 2` |
  | `CHILD` | `vulnerable_groups` มี `young_child` **หรือ** `2 ≤ age < 13` |
  | `ELDERLY` | `vulnerable_groups` มี `elderly_dependent` **หรือ** `special_needs` มี `'elderly'` (CR-022) **หรือ** `age ≥ 60` |
  | `VEGAN` | > [NEEDS DECISION: ไม่มี field โครงสร้างรองรับ — `dietary_restrictions` master ถูกตัดใน CR-137; `special_needs` เป็น free text (CR-046). ทางเลือก: (A) จับคำใน `special_needs` (`มังสวิรัติ`, `เจ`, `vegan`, `vegetarian`) แบบ heuristic, (B) ไม่ derive — ผู้รับเลือกเมนู VEGAN เองโดยไม่ต้อง override, (C) เพิ่ม field ใหม่ใน `evacuee` (bump schema_v)] |

  > [NEEDS DECISION: เส้นแบ่งอายุ `<2` / `<13` / `≥60` เป็นค่าที่ implementation ตั้งเอง ยังไม่มีแหล่งอ้างอิง — ยืนยันหรือกำหนดใหม่ (เช่น อิง Sphere / SOP ratio)]
- **FR-MRM-02** — ผู้รับประเภท `volunteer` และ `outside` ไม่มีแท็ก → รับได้เฉพาะเมนูที่ไม่มีแท็ก (เมนูทั่วไป) โดยไม่ต้อง override
- **FR-MRM-03** — เมนูที่ไม่มีแท็ก (`dietary = []` และ `age_group ∈ {ALL, ไม่ระบุ}`) = เมนูทั่วไป แจกได้ทุกคน. เมนูที่มีแท็ก: ผู้รับต้องมีแท็กร่วมอย่างน้อย 1 แท็ก จึงถือว่า "ตรง"
- **FR-MRM-04** — เมื่อไม่ตรง: > [NEEDS DECISION: (A) เตือน + บังคับ override พร้อมเหตุผล บันทึก `is_override: true` + `override_reason` — ใช้กลไกเดียวกับรับซ้ำ (FR-DST-02 / FR-MQW-05), (B) เตือนอย่างเดียว ไม่บังคับ override, (C) บล็อก]
- **FR-MRM-05** — กติกานี้ไม่เขียน field ใหม่ลง `distribution_log`; ใช้ `is_override` / `override_reason` (§2.30) เดิมเท่านั้น

### Acceptance
- ผู้รับ `religion='muslim'` เลือกเมนู `dietary:['HALAL']` → ไม่ต้อง override
- ผู้รับไม่มีแท็กเลือกเมนู HALAL → แสดงคำเตือนตาม FR-MRM-04
- เมนูทั่วไป → ทุก `recipient_type` แจกได้โดยไม่เตือน
- unit test ครอบทุกแถวของตาราง FR-MRM-01

---

## D. ปิด CR-109 เป็น superseded โดย CR-121

ขอบเขต: งานเอกสารล้วน — ไม่เปลี่ยนรูป doc, ไม่เปลี่ยนกติกา.

### Why

**ที่มาของร่างที่ค้าง:** branch `docs/draft-meal-distribution-onsite-scan` (commit `d14f85469`, 2026-09-05, ยังไม่ merge) มีไฟล์เดียว `docs/changes/draft-meal-distribution-onsite-scan.md` ซึ่งเป็น **ร่างก่อนอนุมัติของ CR-109** (หัวเรื่อง/field/FR-MD-01..04 ตรงกัน). เนื้อหาทุกข้อถูกตัดสินหรือถูกแทนที่แล้ว:

| ข้อในร่าง | ผลลัพธ์ปัจจุบัน |
| --- | --- |
| doc type ใหม่ `meal_distribution:{ulid}` | CR-109 อนุมัติ (2026-09-06) → CR-121 ผนวกเข้า `distribution_log` (schema.md §2.30) |
| FR-MD-02 เพดาน `Σ portions ≤ actual_yield` แบบ hard-block | CR-109 เปลี่ยนเป็น soft warning → หัวข้อ B FR-MQW-04 |
| FR-MD-03 กันรับซ้ำ (คน + เมนู + มื้อ) แบบ hard-block | CR-121 FR-DST-02 เปลี่ยนเป็นโควตาต่อมื้อ + override → หัวข้อ B FR-MQW-01/05 |
| FR-MD-04 void แทน hard-delete | อยู่ใน `distribution_log` (`status='voided'`, `voided_at`, `voided_by`) |
| OQ1 ความหมายของ `meal_service.served` | CR-109 เคาะ Option 1A (กรอกมือเหมือนเดิม) |
| OQ2 `override_reason` | CR-109 ตัดออก → CR-121 นำกลับมาใน `distribution_log.override_reason` |
| OQ3 `recipe_id` req/opt | `distribution_log.meal_service_id` / `recipe_id` เป็น opt (§2.30) |

ไม่มีเนื้อหาในร่างที่ยังไม่ถูกบันทึกที่อื่น → merge ร่างนั้นจะสร้าง CR ซ้ำซ้อนกับ CR-109.

**ทะเบียนไม่ตรงความจริง:** CR-121 frontmatter + §1.2 ข้อ 2 ระบุว่า supersede CR-109 แต่ `CR-109-meal-distribution-onsite-scan.md` (`status: approved`) และ `_index.md` แถว CR-109 (`approved`) ไม่มีการชี้ไป CR-121. CR อื่นที่ถูกแทนที่ใช้รูปแบบ `status: superseded` + `superseded_by` (เช่น CR-096, CR-102).

**ข้อความค้างใน schema.md §2.7:** ย่อหน้า "`actual_yield` vs `served` (CR-084)" ยังระบุว่าการบังคับเพดาน "เป็นงานของ flow แจกจ่าย/สแกนหน้างานที่ยังไม่มีในระบบ" — flow นั้นมีแล้วคือ `distribution_log` (§2.30) + `/onsite/distribution`.

### Requirements
- **FR-CRS-01** — `CR-109-meal-distribution-onsite-scan.md` frontmatter: `status: approved` → `superseded`; เพิ่ม `superseded_by: CR-121`, `superseded_date: <วันที่ approve CR นี้>`, `note: ผนวก meal_distribution เข้า distribution_log (schema.md §2.30) ใน CR-121`; อัปเดต `updated:`; เพิ่มบรรทัดใน Decision log. เนื้อหาเดิมของ CR-109 คงไว้ไม่แก้
- **FR-CRS-02** — `_index.md` แถว CR-109: คอลัมน์สถานะ `approved` → `superseded`; ต่อท้ายหัวเรื่องด้วย "— **superseded โดย [CR-121](CR-121-spec-ticket.md)**" (รูปแบบเดียวกับ CR-032/CR-096)
- **FR-CRS-03** — schema.md §2.7 ย่อหน้า "`actual_yield` vs `served` (CR-084)": แทนวลี "การบังคับเพดานจริงเป็นงานของ flow แจกจ่าย/สแกนหน้างานที่ยังไม่มีในระบบ" ด้วยการอ้างอิง "การแจกรายคนบันทึกใน `distribution_log` (§2.30, CR-121); กติกาเพดานยอดแจกดู §2.30". ไม่เปลี่ยนความหมายของ `served`/`actual_yield`/`MealVariance`; อัปเดต `updated:` และ `note:` ของ schema.md
- **FR-CRS-04** — branch `docs/draft-meal-distribution-onsite-scan` ไม่ merge > [NEEDS DECISION: (A) ลบทั้ง local และ `origin` หลัง CR นี้ approve — เนื้อหายังอยู่ใน git history ของ CR-109, (B) เก็บ branch ไว้เป็นประวัติ]

### Acceptance
- `CR-109-*.md` และ `_index.md` แสดง `superseded` + ลิงก์ไป CR-121 ตรงกัน
- ค้น `ยังไม่มีในระบบ` ใน schema.md §2.7 → ไม่พบ; ย่อหน้าชี้ไป §2.30
- ไม่มี field / enum / `schema_v` ใดใน schema.md เปลี่ยนจากหัวข้อ D
- branch ร่างถูกจัดการตาม FR-CRS-04 ที่เคาะ

---

## Impact

- **docs**
  - CR-121: §5 (A), ข้อความ FR-DST-05 / ผัง §2.2 Step 6 (A, FR-DDS-06), §1.2 ข้อ 2 ให้ชี้มาที่ CR นี้ (B)
  - RM:85 (+ RM:87 ถ้าเปลี่ยน role ขั้น 3) (A)
  - sitemap.md เพิ่ม `/onsite/distribution` (A)
  - schema.md §2.29 (ถ้า FR-DDS-07 B / FR-MQW-03 B / FR-MQW-06 A); §2.30 เพิ่มกติกา: ของยืมตอนปิดรอบ (A), quota/capacity/4h (B), ย่อหน้า "Recipient ↔ menu matching" (C); §2.5 cross-ref CR-022 (C); §2.7 ข้อความอ้างอิง (D)
  - CR-109 + `_index.md` (D)
  - T-12 ไม่ต้องแก้ (ตรงกับ FR-MQW-04)
- **code**
  - `onsite/distribution/+page.ts` guard ใหม่ — ทำแล้วบน `feat/distribution-desk` (`requireDistributionDesk` = SA, SM, REG, WH/SC; ตรงกับ role ที่เห็น tile ใน `/onsite`) ต้องปรับถ้า FR-DDS-02/03 เคาะ B; `auth.ts` ตาม FR-DDS-02/03
  - filter จุดแจกใน `FrontlineStationPage` (ถ้า FR-DDS-07 B); filter ตามวัน (FR-MQW-03)
  - `isDuplicateMealDistributionLog` (ถ้า FR-MQW-01 B เพิ่ม `item_id`)
  - `FoodDistributionCard` เปิดนาฬิกา 4 ชม. ตาม FR-MQW-06; แสดงคำเตือนจับคู่เมนูผ่าน `MealEntitlementWarning` เดิม (C)
  - ฟังก์ชัน domain `menu-matching.ts` + test (C)
- **VDU / Mango index / backend:** ไม่กระทบ (กติกา cross-doc อยู่ใน application layer) — ยกเว้น FR-DDS-03 B ที่ต้องแก้ VDU Rule 16 / VDU `distribution_log`

## Migration
- ทางเลือก A ทุกข้อ: N/A — ไม่มี doc ที่ persist เปลี่ยนรูป
- FR-MQW-03 B: อ่าน default `service_date = thailandCalendarDay(created_at)` สำหรับ doc schema_v 1; ไม่ backfill; เขียนใหม่ stamp schema_v 2
- FR-MQW-06 A: ตั๋ว food เดิมไม่มี `meal_service_id` → ไม่แสดงนาฬิกา (เท่ากับ C สำหรับ doc เก่า)
- FR-MRM-01 VEGAN C: ต้องเขียน migration note ของ `evacuee` แยกเมื่อเคาะ

## Decision log
- 2026-10-06 — proposed เป็น 3 ร่างแยก: `draft-distribution-desk-station-scope` (A), `draft-meal-quota-window` (B), `draft-meal-recipient-menu-matching` (C) — จากการ align `meal-distribution` เข้ากับ schema กลาง แล้ว rescope ให้ชี้ที่ `/onsite/distribution` (`features/distribution`) แทน `features/meal-distribution` ที่เลิกใช้; เพิ่ม FR-MQW-05/06, FR-MRM-00
- 2026-10-07 — แก้การอ้างอิง: แยกขั้น 3 ไปอ้าง RM:87, VDU Rule 16 / `distribution_log` แทน "VDU 14", อ้าง §1.2 ข้อ 2 / §2.1 / §2.2 / FR-DST-05 แทนเลขบรรทัด, อ้างข้อความ T-12 ตามต้นฉบับ; บันทึกว่า guard FR-DDS-04 ทำแล้วบน `feat/distribution-desk`; เพิ่มร่าง `draft-cr-109-superseded-by-cr-121` (D)
- 2026-10-10 — รวม 4 ร่าง (A–D) เป็นไฟล์เดียว `draft-onsite-distribution.md` ตามที่เจ้าของโครงการขอ — ไม่แตก CR ย่อย; เลข FR คงเดิม
