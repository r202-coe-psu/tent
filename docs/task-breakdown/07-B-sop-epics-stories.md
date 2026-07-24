---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - docs/changes/CR-042-daily-sop-calc-follow-up.md
  - docs/features/daily-sop-resource-calc-flow.md
  - docs/task-breakdown/07-B-sop.md
  - docs/prd/phase-r3-operations.md
  - docs/prd/role-permission-matrix.md
  - docs/data/schema.md
  - docs/changes/CR-036-daily-calc-doc-type.md
  - frontend/CONTRIBUTING.md
  - frontend/CONVENTIONS.md
status: ready-for-development
module: B
source_cr: CR-042
created: 2026-07-23
updated: 2026-07-23
---

# Module B (CR-042) — Epic Breakdown

## Overview

Epic/story breakdown สำหรับ **Module B — SOP & Resource Calc** ตาม [CR-042](../changes/CR-042-daily-sop-calc-follow-up.md) (`approved`) ที่ปิด follow-up จาก CR-036 และทำให้ T-31/T-32 develop-ready  
แมปกับบอร์ดโปรเจกต์: **T-30 / T-31 / T-32** · Team D · Phase R3

**ตำแหน่งผลิตภัณฑ์ (R3):** Daily SOP เป็น **โมดูลแยกสำหรับ decision support** — SM ตั้ง ratio → คำนวณ need/have/gap → ดู dashboard แล้ว**ตัดสินใจมือ** (ขอบริจาค / เรียกอาสา / แจ้งครัว ฯลฯ)  
**ไม่ใช่ hub ที่โยงหรือป้อนข้อมูลเข้า** Meal Plan · Donation · Volunteer โดยอัตโนมัติ (สอดคล้อง OD-4=C; peer modules ปิด DoD ของตัวเองได้โดยไม่รอ `daily_calc`)

**นอกขอบเขต R3:** T-42 what-if · auto scheduler · การผูก/feed ไปโมดูลอื่น

มติผลิตภัณฑ์และ follow-ups ปิดครบแล้ว — Epic 1–3 มี stories + AC ครบ (12 stories) · ส่วนท้ายพร้อม handoff หลัง validation

### Recommended ship order (CR-042 core)

ลำดับ merge ที่แนะนำ (ไม่บังคับเลข story ใน Epic 1 ทั้งหมดก่อน):

1. **1.4** — ถอด `rice_g_per_person_meal` จาก SOP keys  
2. **2.1 + 2.2** — schema_v 2 / `ratio_source` **คู่กับ** hardcode have map (PR เดียวหรือติดกัน)  
3. **2.3 / 2.4** — on-demand + audit + unit tests  
4. **3.1 + 3.4** — `/resources` อ่าน snapshot + ปุ่มรัน ← **outcome แรกของ SM**  
5. **3.2** — severity + empty/unsynced  
6. **3.3** — drill-down provenance (พึ่ง fields จาก 2.1)

**1.1–1.3** (T-30 CRUD/audit) ทำขนานได้ — ไม่บล็อกลำดับด้านบน

## Requirements Inventory

### Functional Requirements

**จาก PRD R3 (canonical IDs):**

- FR-44: ผู้ดูแลตั้งค่า SOP Ratio (วัตถุดิบ/ของ/อาสา ต่อหน่วยอ้างอิง) — master + override ได้พร้อม audit
- FR-45: คำนวณความต้องการรายวันต่อศูนย์จาก occupancy × SOP Ratio เทียบ on-hand → gap; R3 = **on-demand** จาก UI; ผลเป็นแหล่งของ **dashboard Module B** (decision support) — ไม่ใช่ท่อป้อน Meal/Donation/Volunteer
- FR-46: Shelter Manager เห็นความต้องการรายวันและ gap ในมุมมองเดียว พร้อม drill-down provenance เพื่อตัดสินใจต่อด้วยมือ

**จาก feature flow / CR-042 (testable — ใช้เป็น coverage สำหรับ stories):**

**Config (FR-44 / T-30) — baseline ที่ยังต้องครบ DoD:**

- MB-C1: Master CRUD `sop_profile` (catalog) — `system_admin` only; replicate ลง shelter เป็น read-only
- MB-C2: Override CRUD `sop_override` (shelter_*) — `shelter_manager` สร้าง/แก้ + set `active`; ratios ครบทั้งชุด 20 keys; อ้าง `base_profile_id`
- MB-C3: Effective resolve = `override active ?? master`; ≤1 active override ต่อศูนย์
- MB-C4: แก้ค่าแล้วมีผลรอบคำนวณถัดไปทันที + audit (ใคร/เมื่อไร/ค่าเดิม)
- MB-C5: Seed master จาก T-18 / reference table; **ไม่มี** `rice_g_per_person_meal` ใน SOP (CR-021)

**Engine (FR-45 / T-31) — DS-E* + CR-042:**

- MB-E1: คำนวณ need/have/gap จาก occupancy × effective ratio เทียบ have ตาม map
- MB-E2: ไม่มี effective profile → reject calc
- MB-E3: Occupancy = count `evacuee` ที่ `current_stay.status = active`
- MB-E4: Persist `daily_calc:{YYYY-MM-DD}` deterministic / idempotent (1 doc/วัน/ศูนย์)
- MB-E5: occupancy = 0 → need ตามสูตร ไม่ crash
- MB-E6: stock/facility ขาดหรือ `have_source=none` → `have=null` + `data_status` ที่เหมาะสม — **ไม่ใส่ 0 มั่ว**
- MB-E7: ไม่มี override → ใช้ master
- MB-E8: Overwrite วันเดิม → `audit.retro_edit` ก่อนใส่ doc ใหม่
- MB-E9: `status` ⊥ `data_status` ตามสูตร domain
- MB-E10: Snapshot freeze: `ratio_snapshot`, `occupancy_snapshot`, `stock_snapshot`, `sop_profile_version`, `ratio_source`, `sop_override_id`, `sop_override_version`, `formula_v`, `as_of`
- MB-E11: R3 รองรับ **on-demand run จาก UI เท่านั้น** — ไม่มี scheduler (OD-3=A)
- MB-E12: Unit test สูตรครอบ multiply/divide/threshold + edge MB-E5..E7
- MB-E13: `have` ตาม **hardcode map** ใน CR-042 OD-2=B เท่านั้น — ไม่ lookup ด้วยชื่อ ratio key
- MB-E14: ทุก doc ใหม่ `schema_v = 2` (`DAILY_CALC_SCHEMA_VERSION=2`)
- MB-E15: เมื่อ `ratio_source=master` → `sop_override_id` / `sop_override_version` = `null`; เมื่อ `override` → ทั้งสอง field บังคับมีค่า
- MB-E16: ถอด `rice_g_per_person_meal` จาก runtime `SOP_RATIO_KEYS` ให้ตรง CR-021
- MB-E17: Peer input ผ่าน barrel เท่านั้น (people / sop-ratios / operations / shelters; volunteer have เมื่อพร้อม ไม่งั้น null)

**Dashboard (FR-46 / T-32) — DS-D*:**

- MB-D1: หน้า `/resources` แสดงผลของวันเลือกได้ (default = วันนี้ตาม timezone โปรเจกต์) จาก `daily_calc`
- MB-D2: สรุป gap รายหมวดอย่างน้อย อาหาร/ของใช้/อาสา (หรือ category ที่ล็อกใน domain)
- MB-D3: รายการขาดเรียงตามความรุนแรง (severity)
- MB-D4: Drill-down provenance: occupancy, ratio, have/stock, `as_of`
- MB-D5: Drill-down ระบุ master vs override จาก `ratio_source` (+ override id/version) — **ไม่ resolve สด**
- MB-D6: จำกัด shelter scope + role ตาม matrix (SM scope; SA global; WS/KS/REG ดู calc ตาม FR-45 ถ้าแยกจาก dashboard)
- MB-D7: แสดง `last-updated` / `as_of` เสมอ (NFR-18)
- MB-D8: อ่านจาก `daily_calc` เป็น source หลัก — เลิกพึ่ง provisional provider
- MB-D9: มีปุ่มรัน on-demand เมื่อยังไม่มี doc ของวันนั้น (และรันซ้ำได้ตาม engine)

**Explicit non-goals / boundary (OD-4 / T-42):**

- MB-X1: Module B **ไม่โยง** Meal Plan / Donation / Volunteer — ไม่มี write/read contract จาก `daily_calc` เข้าโมดูลเหล่านั้นใน R3; เป็น dashboard ช่วยตัดสินใจ ไม่ใช่ integration hub (ห้าม half-wire)
- MB-X2: ไม่ทำ auto scheduler / what-if simulation (T-42)
- MB-X3: Peer tasks (T-25 / T-23 / T-29) **ไม่**ใส่ dependency บังคับบน `daily_calc` เพื่อปิด DoD ของตัวเอง

### NonFunctional Requirements

- NFR-18: Resource Calculation ใช้ occupancy + stock ล่าสุด ไม่ cache ค้างจน gap ผิด; แสดง last-updated เสมอ
- NFR-21: Dashboard resource calc ต้องไม่ scan record ทีละตัวต่อ request (ใช้ deterministic id / bounded range)
- SM-13: UAT — Daily Resource Calculation ตรง occupancy × SOP Ratio และ gap ตรง on-hand ภายใต้ map ที่ล็อก
- Engineering DoD: UI + data/write path + validation + permission + test + demo ต่อ slice; remote-first; feature barrel only; ห้ามแตะ stable core โดยไม่ review

### Additional Requirements

- Schema §2.15 `daily_calc` schema_v **2** applied ใน docs แล้ว — code/Zod ต้อง sync (`dailyCalcDocSchema` + persist path)
- Migration R3 pre-prod: wipe หรือ re-run on-demand หลัง deploy — ไม่มี lazy migration
- Hardcode have map เปลี่ยนภายหลัง = CR ใหม่ (ไม่ config ใน DB)
- Interim: water keys #1–4 ใช้ SKU `item:water` เดียวกัน; m2 keys #15–17 ใช้ `area_m2` เดียวกัน
- Threshold keys (#18–19) ไม่คำนวณ gap จาก stock
- `people_per_volunteer` have จาก Module A barrel — ถ้ายังไม่มี API → `have=null`
- Qty drift: operations ใช้ `qty_str` (CR-038); snapshot ปัจจุบันยัง num — ไม่บังคับแก้ใน CR-042 เว้น follow-up
- Code targets: `features/resource-calc/` · `features/sop-ratios/` · ไม่ import ข้าม barrel
- CR-042 คง `approved` จน code+test ครบแล้วค่อย `done`

### UX Design Requirements

ไม่พบ UX design contract แบบ BMad (`DESIGN.md` / `EXPERIENCE.md`)

อิงจาก feature flow + routes ที่มีอยู่:

- UX-DR1: `/resources` — dashboard need/have/gap + ปุ่มรัน on-demand + เลือกวัน
- UX-DR2: Drill-down แสดง provenance รวมป้าย `ratio_source` (master/override)
- UX-DR3: Master SOP ที่ `/admin/catalog` (SA); override UI ใน shelter back-office ของ `sop-ratios`
- UX-DR4: ใช้ shadcn-svelte / protected routes ที่มีอยู่; toast สำหรับ feedback; ไม่ invent design system ใหม่
- UX-DR5: สถานะข้อมูลไม่พอ / `stock_unsynced` / empty day ต้องสื่อใน UI ชัด ไม่ crash
- UX-DR6: บน `/resources` มีข้อความสั้นชัดว่าเป็นเครื่องมือช่วยตัดสินใจ — **ไม่**ส่งต่อไปครัว/บริจาค/อาสาอัตโนมัติ

### FR Coverage Map

| ID | Epic | สั้น ๆ |
| --- | --- | --- |
| FR-44 | Epic 1 | ตั้ง SOP ratio master + override |
| MB-C1 | Epic 1 | Master CRUD catalog (SA) |
| MB-C2 | Epic 1 | Override CRUD + active (SM) |
| MB-C3 | Epic 1 | Effective = override ?? master |
| MB-C4 | Epic 1 | ผลทันที + audit |
| MB-C5 | Epic 1 | Seed 20 keys · ไม่มี rice_g |
| FR-45 | Epic 2 | Engine need/have/gap + persist |
| MB-E1 | Epic 2 | คำนวณ need/have/gap |
| MB-E2 | Epic 2 | ไม่มี effective → reject |
| MB-E3 | Epic 2 | Occupancy = active stay |
| MB-E4 | Epic 2 | Persist daily_calc idempotent |
| MB-E5 | Epic 2 | occupancy 0 ไม่ crash |
| MB-E6 | Epic 2 | have=null เมื่อขาดข้อมูล |
| MB-E7 | Epic 2 | ไม่มี override → master |
| MB-E8 | Epic 2 | overwrite → audit.retro_edit |
| MB-E9 | Epic 2 | status ⊥ data_status |
| MB-E10 | Epic 2 | Snapshot freeze fields |
| MB-E11 | Epic 2 | On-demand only (OD-3) |
| MB-E12 | Epic 2 | Unit test สูตร + edges |
| MB-E13 | Epic 2 | Hardcode have map (OD-2) |
| MB-E14 | Epic 2 | schema_v 2 |
| MB-E15 | Epic 2 | ratio_source invariants (OD-1) |
| MB-E16 | Epic 2 | ถอด rice_g จาก runtime keys |
| MB-E17 | Epic 2 | Peer ผ่าน barrel |
| NFR-18 | Epic 2 (+ แสดงใน Epic 3) | ไม่ cache ค้าง · as_of |
| FR-46 | Epic 3 | Dashboard gap + drill-down |
| MB-D1 | Epic 3 | `/resources` เลือกวัน |
| MB-D2 | Epic 3 | สรุป gap รายหมวด |
| MB-D3 | Epic 3 | เรียงตาม severity |
| MB-D4 | Epic 3 | Drill-down provenance |
| MB-D5 | Epic 3 | ratio_source จาก snapshot |
| MB-D6 | Epic 3 | Shelter scope + role |
| MB-D7 | Epic 3 | แสดง as_of / last-updated |
| MB-D8 | Epic 3 | อ่าน daily_calc เป็นหลัก |
| MB-D9 | Epic 3 | ปุ่มรัน on-demand |
| NFR-21 | Epic 3 | ไม่ full-scan ต่อ request |
| SM-13 | Epic 2–3 | UAT ความถูกต้อง calc/gap |
| UX-DR1..6 | Epic 1 = UX-DR3; Epic 3 = UX-DR1/2/4/5/6 | ตาม flow |
| MB-X1 | ทุก epic (constraint) | Module B แยก — ไม่โยง Meal/Donation/Volunteer |
| MB-X2 | ทุก epic (constraint) | ไม่ scheduler / T-42 |
| MB-X3 | ทุก epic (constraint) | Peer tasks ไม่ block บน daily_calc |

## Epic List

### Epic 1: ตั้ง SOP ratio ให้ศูนย์ใช้ได้จริง
SA ดูแล master ใน catalog; SM สร้าง/เปิด override ของศูนย์ — effective = override active ?? master พร้อม audit และ seed 20 keys (ไม่มี rice_g)
**FRs covered:** FR-44, MB-C1..C5 · UX-DR3  
**บอร์ด:** T-30 · `features/sop-ratios/` · **standalone** — config ใช้ได้แม้ยังไม่รัน calc

### Epic 2: คำนวณ need/have/gap รายวันแบบเชื่อถือได้
SM (และ role ที่อนุญาต) รัน on-demand ได้ผล need/have/gap ที่ persist เป็น `daily_calc` schema_v 2 — hardcode have map, freeze `ratio_source`/override ids, ไม่มี scheduler
**FRs covered:** FR-45, MB-E1..E17 · NFR-18 · SM-13 (engine) · MB-X1/X2/X3  
**บอร์ด:** T-31 · `features/resource-calc/` · ขึ้นกับ Epic 1 สำหรับ effective ratio · **CR-042 core**

### Epic 3: เห็นช่องว่างทรัพยากรและที่มาตัวเลขในมุมเดียว
SM เปิด `/resources` ดู gap รายหมวด + เรียง severity + drill-down จาก snapshot (ไม่ resolve สด) และกดรันเมื่อยังไม่มี doc วันนั้น — ใช้ตัดสินใจต่อด้วยมือ ไม่ผูกโมดูลอื่น
**FRs covered:** FR-46, MB-D1..D9 · NFR-18 (display), NFR-21 · SM-13 (UAT dashboard) · UX-DR1/2/4/5/6  
**บอร์ด:** T-32 · อ่านจาก Epic 2 · decision-support surface ของ Module B

**Dependency ธรรมชาติ:** Epic 1 → Epic 2 → Epic 3  
**ทำไมไม่รวม 2+3:** คนละ outcome (ผลิต snapshot vs ตัดสินใจจาก snapshot) และแมป T-31/T-32 บนบอร์ด — แม้แชร์ `resource-calc` ก็เรียง stories ในแต่ละ epic ได้โดยไม่วนแก้ไฟล์ซ้ำข้าม epic  
**Ship order:** ดู [Recommended ship order](#recommended-ship-order-cr-042-core) ด้านบน

---

## Epic 1: ตั้ง SOP ratio ให้ศูนย์ใช้ได้จริง

SA ดูแล master ใน catalog; SM สร้าง/เปิด override ของศูนย์ — effective = override active ?? master พร้อม audit และ seed 20 keys (ไม่มี rice_g)

**FRs covered:** FR-44, MB-C1..C5 · UX-DR3  
**บอร์ด:** T-30 · `features/sop-ratios/`

### Story 1.1: SA จัดการ master SOP ใน catalog

As a System Admin,  
I want to create and edit master `sop_profile` with all 20 canonical ratio keys,  
So that every shelter has a shared baseline without deploying new code.

**Acceptance Criteria:**

**Given** SA เปิดหน้า master SOP (`/admin/catalog` หรือเทียบเท่า)  
**When** สร้าง/แก้ profile ครบ 20 keys แล้วบันทึก  
**Then** persist `sop_profile` ใน catalog พร้อม `version` + audit  
**And** role อื่นสร้าง/แก้ master ไม่ได้  
**And** shelter อ่าน master เป็น read-only (MB-C1, FR-44, UX-DR3)

### Story 1.2: SM สร้าง override และตั้ง active ของศูนย์

As a Shelter Manager,  
I want to create a full-set `sop_override` for my shelter and mark it active,  
So that my center can use local ratios without changing the global master.

**Acceptance Criteria:**

**Given** มี master ที่อ้างเป็น `base_profile_id` ได้  
**When** SM สร้าง/แก้ override ครบ 20 keys และ set `active`  
**Then** มี override ของศูนย์ตน และ ≤1 `active` ต่อศูนย์  
**And** SA ทำ platform override ได้ตาม pattern โปรเจกต์ แต่ไม่ใช่ผู้ใช้หลัก  
**And** WS/KS/REG แก้ override ไม่ได้ (MB-C2, MB-C3)

### Story 1.3: แก้ ratio แล้วมีผลรอบถัดไป + เก็บประวัติ

As a Shelter Manager (หรือ SA สำหรับ master),  
I want ratio edits to take effect on the next calculation and keep an audit trail,  
So that I can change planning numbers safely and explain what changed.

**Acceptance Criteria:**

**Given** มี master หรือ override ที่แก้ได้  
**When** ผู้มีสิทธิ์แก้ค่าแล้วบันทึก  
**Then** ค่าใหม่ถูกใช้ในรอบคำนวณถัดไป (ไม่ cache ค้าง)  
**And** มีประวัติใคร/เมื่อไร/ค่าเดิม  
**And** ปิด active override → รอบถัดไปกลับไป master (MB-C3, MB-C4)

### Story 1.4: Seed 20 keys และถอด `rice_g_per_person_meal` จาก SOP

As a developer delivering Module B config,  
I want the canonical 20-key whitelist and seed to match CR-021,  
So that rice/egg stay out of SOP and kitchen owns consumption separately.

**Acceptance Criteria:**

**Given** runtime `SOP_RATIO_KEYS` / labels / seed / Zod ยังมีหรือเคยมี `rice_g_per_person_meal`  
**When** story นี้เสร็จ  
**Then** key นั้นถูกถอดจาก whitelist, UI, seed, และ validation ของ SOP  
**And** seed master จาก reference table / T-18 ครบ 20 keys  
**And** demo: SA แก้ master + SM override แล้วค่าต่างกันชัด (MB-C5)

---

## Epic 2: คำนวณ need/have/gap รายวันแบบเชื่อถือได้

SM (และ role ที่อนุญาต) รัน on-demand ได้ผล need/have/gap ที่ persist เป็น `daily_calc` schema_v 2 — hardcode have map, freeze `ratio_source`/override ids, ไม่มี scheduler

**FRs covered:** FR-45, MB-E1..E17 · NFR-18 · SM-13 (engine) · MB-X1/X2/X3  
**บอร์ด:** T-31 · `features/resource-calc/` · **CR-042 core**

### Story 2.1: Bump `daily_calc` เป็น schema_v 2 + freeze ratio_source

As a Shelter Manager,  
I want each saved daily calc to record whether ratios came from master or override,  
So that later drill-down can explain the numbers without re-resolving live config.

**Acceptance Criteria:**

**Given** Zod/`DAILY_CALC_SCHEMA_VERSION` ยังเป็น 1 และยังไม่มี `ratio_source`  
**When** รัน on-demand สำเร็จ  
**Then** doc ที่ persist มี `schema_v = 2`, `ratio_source`, `sop_override_id`, `sop_override_version`  
**And** `ratio_source=master` → override id/version เป็น `null`; `override` → ทั้งคู่มีค่า  
**And** snapshot อื่น (`ratio_snapshot`, `occupancy_snapshot`, `stock_snapshot`, `sop_profile_version`, `formula_v`, `as_of`) ครบ (MB-E10, MB-E14, MB-E15, OD-1)

### Story 2.2: Hardcode `have` map ตาม CR-042

As a Shelter Manager,  
I want `have` to come from the locked stock/shelter/volunteer map — not ratio key names,  
So that gap rows stop showing false `stock_unsynced` for mapped resources.

**Acceptance Criteria:**

**Given** ตาราง have map ใน CR-042 OD-2=B  
**When** engine สร้าง input ต่อ key  
**Then** `resolveHave` (หรือโมดูลเทียบเท่า) อ่านตาม map เท่านั้น — ไม่ `stock.get(ratioKey)`  
**And** water keys ใช้ `item:water`; facility keys อ่านจาก shelter barrel (`facilities.*` / `area_m2`); `have_source=none` หรือค่าขาด → `have=null`  
**And** threshold ไม่มี `have`; `people_per_volunteer` จาก Module A barrel หรือ `null` ถ้ายังไม่มี API  
**And** เปลี่ยน map ภายหลังต้อง CR ใหม่ — ไม่ใส่ config ใน DB (MB-E1, MB-E6, MB-E13, MB-E17)

### Story 2.3: รัน on-demand + overwrite audit + ปฏิเสธเมื่อไม่มี effective

As a Shelter Manager,  
I want to run today’s calc on demand and safely overwrite the same day,  
So that I get a fresh snapshot without duplicate docs or silent data loss.

**Acceptance Criteria:**

**Given** มี effective profile (override active ?? master) และ session ใน scope ศูนย์  
**When** เรียก `runOnDemand(date)`  
**Then** ได้ `_id = daily_calc:{date}` แบบ idempotent  
**And** ถ้ามีของเก่า → เขียน `audit.retro_edit` ก่อนทับ  
**And** ไม่มี effective → reject ชัดเจน ไม่เขียน doc บางส่วน  
**And** ไม่มี scheduler / job อัตโนมัติใน R3 (MB-E2, MB-E4, MB-E7, MB-E8, MB-E11, OD-3)

### Story 2.4: Edge cases + unit tests สูตรและ map

As a developer on Team D,  
I want formula and have-map unit tests covering multiply/divide/threshold and edges,  
So that SM-13 UAT and regressions stay green under the locked map.

**Acceptance Criteria:**

**Given** occupancy = 0, stock/facility ขาด, และศูนย์ไม่มี override  
**When** รันชุด unit tests ของ domain + `resolveHave` map  
**Then** ไม่ crash; need ตามสูตร; `have=null` เมื่อข้อมูลไม่พอ; fallback master เมื่อไม่มี override  
**And** ครอบ kind multiply/divide/threshold และแถว map หลัก (อย่างน้อย water / facility / none / threshold / volunteer)  
**And** ไม่มีโค้ดที่อ่าน/เขียน `daily_calc` เพื่อป้อน Meal Plan / Donation / Volunteer — Module B แยกเป็น decision support (MB-E5..E7, MB-E9, MB-E12, MB-X1, MB-X3, NFR-18, SM-13)

---

## Epic 3: เห็นช่องว่างทรัพยากรและที่มาตัวเลขในมุมเดียว

SM เปิด `/resources` ดู gap รายหมวด + เรียง severity + drill-down จาก snapshot (ไม่ resolve สด) และกดรันเมื่อยังไม่มี doc วันนั้น — decision support ของ Module B ไม่ผูกโมดูลอื่น

**FRs covered:** FR-46, MB-D1..D9 · NFR-18 (display), NFR-21 · SM-13 (UAT dashboard) · UX-DR1/2/4/5/6 · MB-X1  
**บอร์ด:** T-32 · อ่านจาก Epic 2

### Story 3.1: Dashboard `/resources` อ่านจาก `daily_calc`

As a Shelter Manager,  
I want `/resources` to show today’s need/have/gap from the saved daily calc,  
So that I can decide next actions myself (request donations, call volunteers, brief kitchen) from one trusted snapshot.

**Acceptance Criteria:**

**Given** มี `daily_calc` ของวันเลือก (default = วันนี้ตาม timezone โปรเจกต์)  
**When** SM เปิด `/resources`  
**Then** แสดงผลจาก `daily_calc` เป็น source หลัก — ไม่พึ่ง provisional provider  
**And** แสดงสรุป gap รายหมวดอย่างน้อย อาหาร/ของใช้/อาสา (หรือ category ที่ล็อก)  
**And** แสดง `as_of` / last-updated เสมอ  
**And** มีข้อความสั้นบนหน้าว่าเป็นเครื่องมือช่วยตัดสินใจ — **ไม่**ส่งต่อไปครัว/บริจาค/อาสาอัตโนมัติ (UX-DR6, MB-X1)  
**And** โหลดด้วย deterministic id / bounded range — ไม่ full-scan (MB-D1, MB-D2, MB-D7, MB-D8, NFR-18, NFR-21, UX-DR1)

### Story 3.2: เรียงรายการขาดตามความรุนแรง + สถานะข้อมูลไม่พอ

As a Shelter Manager,  
I want shortage rows ordered by severity and clear empty/unsynced states,  
So that I know what to act on first and when numbers are incomplete.

**Acceptance Criteria:**

**Given** snapshot มีแถวหลาย `status` / `data_status`  
**When** ดูรายการบน dashboard  
**Then** รายการขาดเรียงตามความรุนแรง (severity)  
**And** สถานะ `stock_unsynced` / ไม่มี doc วันนั้น / ข้อมูลไม่พอ สื่อใน UI ชัด ไม่ crash  
**And** toast ตาม pattern โปรเจกต์เมื่อโหลด/รันล้มเหลว (MB-D3, UX-DR4, UX-DR5)

### Story 3.3: Drill-down provenance จาก snapshot รวม ratio_source

As a Shelter Manager,  
I want to open a row and see occupancy, ratio, have/stock, as_of, and whether ratio was master or override,  
So that I can trust and explain the gap without guessing live config.

**Acceptance Criteria:**

**Given** เปิด drill-down ของแถวจาก `daily_calc` schema_v 2  
**When** ดูรายละเอียด  
**Then** แสดง occupancy, ratio, have/stock, `as_of` จาก snapshot  
**And** แสดง `ratio_source` (master/override) และ override id/version เมื่อเป็น override  
**And** **ไม่**เรียก resolve effective สดใน drill-down (MB-D4, MB-D5, UX-DR2)

### Story 3.4: ปุ่มรัน on-demand + จำกัดสิทธิ์ตาม matrix

As a Shelter Manager,  
I want a run button when today’s calc is missing (and permission-gated views),  
So that I can produce a snapshot from the dashboard without leaving the page.

**Acceptance Criteria:**

**Given** ยังไม่มี `daily_calc` ของวันนั้น หรือต้องการรันซ้ำ  
**When** SM กดรันคำนวณ  
**Then** เรียก engine on-demand ของ Epic 2 แล้วรีเฟรช dashboard จาก doc ใหม่  
**And** SA เห็นได้ global; SM จำกัด shelter scope; dashboard FR-46 หลักเป็น SM/SA ตาม matrix  
**And** demo UAT: ตัวเลขตรง occupancy × ratio และ gap ภายใต้ map ที่ล็อก (MB-D6, MB-D9, SM-13, UX-DR1)
