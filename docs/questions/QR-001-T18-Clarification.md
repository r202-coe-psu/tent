---
title: T-18 Clarification Questions — Round 1
created: 2026-06-20
updated: 2026-07-03   # CR-026 approved — Q-T18-1 ratified
module: B (SOP & Resource Calc) + A (Volunteer)
status: in-progress
---

# QR-1 — T-18 Clarification Questions

คำถามที่ต้องการ clarify ก่อนเริ่ม implement T-18 (Groundwork: SOP ratio + volunteer schema)

---

## Q-T18-1: sop_profile อยู่ใน DB ไหน?

**คำถาม:** `sop_profile` เก็บใน `catalog` DB (admin กลาง) หรือ `shelter_*` DB (shelter_manager แก้เองได้)?

**สถานการณ์:** schema.md §4.2 เขียนว่าอยู่ใน `catalog` — แต่มีข้อสงสัยว่า factory จะติด `shelter_code` มาด้วยทำให้ลงผิด DB

**ที่ตรวจสอบได้จากโค้ด:** `catalogDoc()` helper ใน `seed.ts` ไม่มี `shelter_code` — ยืนยันว่า seed ปัจจุบันเขียนลง `catalog` DB
feature `sop-ratios` ยังไม่มีในโค้ด — ไฟล์ที่อ้างถึงใน PDF ยังไม่ถูกสร้าง

**ที่ยังไม่ชัด (dev lead ยืนยันไม่ได้):** `catalog` DB ในระบบนี้เป็น central-only จริงไหม หรือมี mechanism ให้แต่ละ shelter แก้ได้ด้วย — ส่งผลต่อ factory, route guard, sync direction, validate_doc_update ทั้งหมด

**✅ RESOLVED → [CR-006](../changes/CR-006-sop-profile-master-override.md)** — สองชั้น: master
(`sop_profile`) อยู่ `catalog` (central, `system_admin` แก้) + override (`sop_override`) อยู่
`shelter_*` (`shelter_manager` แก้เฉพาะศูนย์ตัวเอง) resolve = `override active ?? master` —
ยืนยันซ้ำโดย PO ในที่ประชุม 2026-07-01 (ดู [CR-026](../changes/CR-026-sop-ratio-catalog-scope-and-history-ratification.md))

**สถานะ:** ✅ RESOLVED → CR-006 + CR-026 (ratified 2026-07-03)

---

## Q-T18-2: sop_profile.ratios — canonical key list คืออะไร?

**คำถาม (จริง):** `sop_profile.ratios` whitelist of valid keys ยังไม่ถูกกำหนดในเอกสารใดเลย — schema.md §4.2 ใช้คำว่า "เช่น" กับ 3 keys (ไม่ใช่ canonical list) PO ต้องอนุมัติ key list ก่อน T-18 จึงเขียนลง schema.md ได้

**สถานการณ์:** ผู้ถามเสนอ 20 keys จาก ปภ. 2565 (13 keys) + Sphere 2018 (16 keys) รวมไม่ซ้ำ พร้อม source verbatim

**คำตอบจาก Dev Lead:** รอ PO อนุมัติ key list

**✅ RESOLVED 2026-06-25 (PO):** ครอบคลุมทุกมิติ ปภ.2565 + Sphere 2018, **merge** คีย์ความหมายซ้ำ →
**20 canonical keys**, คงรูป `{key: num>0}` (เลขเดียวต่อคีย์ ไม่ใช่ range), เพิ่ม `SOP_RATIO_KIND`
(multiply/divide/threshold). บันทึก → [CR-006 §"SOP ratio canonical key list"](../changes/CR-006-sop-profile-master-override.md).
ค่า seed จริงต่อคีย์ยังตาม Q-T18-3.

**สถานะ:** ✅ RESOLVED → CR-006 (amend 2026-06-25)

---

## Q-T18-3: rice_g_per_person_meal ตั้งค่าเริ่มต้นเท่าไร?

**คำถาม (จริง):** ไม่มีค่ากลางในแหล่งอ้างอิงใดเลย (ปภ. + Sphere บอกแค่ kcal target) — ค่า ~120g เป็นการ derive ของผู้ถามเอง ไม่ใช่ standard จะใช้ค่าอะไรเป็น seed?

**คำตอบจาก Dev Lead:** seed ด้วยค่ากลางไปก่อน แล้วให้เจ้าหน้าที่ศูนย์ปรับได้

**Conflict กับ Q-T18-1:** `catalog` = admin-only → shelter staff ปรับตรงไม่ได้

**Option ที่อยู่ระหว่างพิจารณา:**
- **Option 1:** ย้าย `sop_profile` ไป `shelter_*` DB → shelter_manager แก้ได้เต็ม แต่ reverts Q-T18-1
- **Option 2:** per-shelter override layer — `catalog` เก็บ default, `shelter_*` DB เก็บ override ต่อ key → ต้องการ doc type ใหม่ใน schema + CR (Dev Lead สนใจ option นี้)

**สถานะ:** ⏳ WAITING on PO (รอ confirm option)

---

## Q-T18-4: Volunteer schema — affiliation_tags และ availability วางยังไง?

**คำถาม:**
1. `affiliation_tags` อยู่บน `_users` (auth layer) หรือบน `volunteer:{ulid}` doc?
2. `availability` จะเก็บแบบไหน — recurring (จันทร์–ศุกร์ 9–17), specific date, หรือทั้งสอง?

**ตอบได้จาก spec:**
- `affiliation_tags` → บน `_users` ชัดเจน (schema.md §6) ✅
- `availability` → ไม่มีใน schema.md §2.8 เลย — เป็น spec gap

**คำตอบจาก Dev Lead:** รอปรึกษา PO ก่อนกำหนด shape

**สถานะ:** ⏳ WAITING on PO

---

## Q-T18-5: Output ของ T-18.1 (ตาราง ratio) เก็บไว้ที่ไหน?

**คำถาม:** Output ratio table + source per value เขียนที่ไหน — `docs/changes/<id>.md`, Notion, หรือ decision-sync frontmatter?

**คำตอบจาก Dev Lead:** ใช้คำถามรูปแบบปัจจุบัน (Q-format) นำเข้าประชุม PO → พอตกลงกันแล้วค่อยบันทึกลง `docs/changes/`

**สถานะ:** ✅ RESOLVED

---

## Q-T18-6: Skill master list อยู่ที่ไหน?

**คำถาม:** `volunteer.skills` เป็น `[str]` free text ใน schema.md §2.8 — ไม่มี master list ผูกไว้ แต่ T-28 ต้องให้เลือกจากรายการ และ T-29 ต้องใช้ match กับงาน free text ทำให้ match ไม่ได้ถูกต้อง

**Options:**
- **(a)** doc type ใหม่ `skill_master` ใน `catalog` → admin จัดการได้ แต่ต้อง CR + เพิ่มใน schema.md
- **(b)** hardcode enum ใน domain code → ง่าย แต่เพิ่ม skill ต้อง deploy ใหม่
- **(c)** master-data system อื่นที่ยังไม่เห็นใน plan

**คำตอบจาก Dev Lead:** บันทึก options ไว้ จะนำเข้าคุย PO

**สถานะ:** ⏳ WAITING on PO

---

## สรุปสถานะ

| Q | คำถาม | สถานะ |
|---|---|---|
| Q-T18-1 | sop_profile อยู่ใน DB ไหน | ✅ RESOLVED → CR-006 + CR-026 (สองชั้น master/override, ratified 2026-07-03) |
| Q-T18-2 | ratios canonical key list | ✅ RESOLVED 2026-06-25 → CR-006 (3→20 keys, merge ปภ.+Sphere) |
| Q-T18-3 | rice_g_per_person_meal default | ⏳ รอ PO confirm option (override layer) |
| Q-T18-4 | availability shape | ⏳ dev lead รอปรึกษา PO |
| Q-T18-5 | output เก็บที่ไหน | ✅ ประชุม PO → docs/changes/ |
| Q-T18-6 | skill master list location | ⏳ dev lead จะนำ options คุย PO |

---

## ภาคผนวก — คำถามต้นฉบับ (origin จาก PDF 2026-06-20)

### Q-T18-1 (ต้นฉบับ)

**SOP ratio profile เก็บไว้ที่ฐานข้อมูลไหน? (catalog หรือ shelter)**

สถานการณ์ตอนนี้: ใน schema.md §4.2 เขียนว่า `sop_profile` อยู่ใน catalog db (ส่วนกลาง admin ดูแล) — แต่ factory ทำ `shelter_code` ติดมาด้วยทุก doc แปลว่ามันจะลง shelter db เลย ไม่ใช่ catalog 2 อย่างนี้ขัดกัน

คำถาม: ratio แก้ได้แค่ admin กลาง (catalog) หรือ shelter_manager แก้ของศูนย์ตัวเองได้ (shelter)?

ทำไมต้องถามก่อนเริ่ม: 2 option ต่างกันแทบทุกชั้น — factory, route guard, sync direction, validate_doc_update, seed location, tests ทั้งหมด ถ้าเดาผิดต้องรื้อทั้ง stack

---

### Q-T18-2 (ต้นฉบับ)

**SOP ratio whitelist 3 → 20+ keys ขยายมั้ย?**

สถานการณ์ตอนนี้: กำหนด `SOP_RATIO_KEYS` ไว้เพียง 3 keys (น้ำ, ข้าว, ส้วม) ใน code แต่ผม audit handbook ได้ 13 จาก ปภ. + 16 จาก Sphere ครบทุกมิติ (น้ำดื่ม/ทำอาหาร/อาบ, kcal, จุดอาหาร, จุดซักล้าง ฯลฯ)

คำถาม: T-31 calc engine จะคำนวณแค่ 3 มิติ หรือครบทุกมิติ?

ทำไมต้องถามก่อนเริ่ม: ถ้า 3 keys = T-32 dashboard บอก gap ได้แค่น้ำ/ข้าว/ส้วม — ผู้บริหารศูนย์ไม่เห็น gap อาสา/พื้นที่/อุปกรณ์ครัว ซึ่งสำคัญพอ ๆ กัน ถ้าขยาย = ต้อง CR เพิ่ม enum + bump schema_v + update test

**SOP_RATIO_KEYS ปัจจุบัน (verified origin/team-D 2026-06-20):**

```ts
// frontend/src/lib/features/sop-ratios/domain/sop-ratio.ts:5-9
export const SOP_RATIO_KEYS = [
  'water_l_per_person_day',
  'rice_g_per_person_meal',
  'toilet_per_person'
] as const;
```

**Thai handbook (ปภ. 2565) — 13 values verified:**

| # | Key (proposed) | Value | Source verbatim | Line |
|---|---|---|---|---|
| 1 | `water_l_per_person_day` | 7.5–15 ลิตร | "ปริมาณความต้องการใช้น้ำต่อคนต่อวันโดยเฉลี่ย" | 2308 |
| 2 | `drinking_water_l_per_person_day` | 2.5–3 ลิตร | "น้ำดื่ม 2.5 - 3 ลิตร" | 2315 |
| 3 | `cooking_water_l_per_person_day` | 3–6 ลิตร | "น้ำทำอาหาร 3 - 6 ลิตร" | 2315 |
| 4 | `hygiene_water_l_per_person_day` | 2–6 ลิตร | "น้ำทำความสะอาดร่างกาย 2 - 6 ลิตร" | 2316 |
| 5 | `kcal_per_adult_day` | 1,500–2,000 | "ให้ได้รับอาหาร 1,500 - 2,000 กิโลแคลอรี/ต่อคน/ต่อวัน" | 1993–1994 |
| 6 | `people_per_water_point` | 1:80 | "น้ำประปา 1 จุดต่อผู้พักพิง 80 คน ระยะห่าง 500 ม." | 2505–2507 |
| 7 | `people_per_toilet_female` | 1:20 | "1 ห้องต่อผู้หญิง 20 คน" | 2508 |
| 8 | `people_per_toilet_male` | 1:35 (โถ+ปัสสาวะ) | "1 ห้อง พร้อมโถปัสสาวะ ต่อผู้ชาย 35 คน" | 2510 |
| 9 | `m2_per_person_sleeping` | ≥ 3.5 | "อย่างน้อย 3.5 ตารางเมตร ต่อคน" | 2504 |
| 10 | `m2_per_person_total` | 30–45 | "อย่างน้อย 30 – 45 ตารางเมตรต่อคน" | 2502 |
| 11 | `people_per_dining_point_adult` | 1:20–50 | "1 จุด ต่อผู้ใหญ่ 20 - 50 คน" | 2523 |
| 12 | `people_per_dining_point_child` | 1:10–20 | "1 จุด ต่อเด็ก 10 - 20 คน" | 2524–2525 |
| 13 | `people_per_washing_point` | 1:≥100 | "พื้นที่ซักล้าง 1 จุด ต่อผู้พักพิง ≥ 100 คน" | 2512 |

**Sphere Handbook 2018 (4th ed.) — 16 values verified:**

| # | Key (proposed) | Value | Source verbatim | Line |
|---|---|---|---|---|
| 1 | `water_l_per_person_day` | 7.5–15 (min 15 std) | "Minimum of 15 litres per person per day" | 5846, 5918 |
| 2 | `drinking_water_l_per_person_day` | 2.5–3 | "Survival: water intake (drinking and food) 2.5–3" | 5913 |
| 3 | `cooking_water_l_per_person_day` | 3–6 | "Basic cooking 3–6" | 5916 |
| 4 | `hygiene_water_l_per_person_day` | 2–6 | "Hygiene practices 2–6" | 5915 |
| 5 | `people_per_tap` | 1:250 | "250 people per tap (flow 7.5 L/min)" | 5850 |
| 6 | `people_per_handpump` | 1:500 | "500 people per hand pump (flow 17 L/min)" | 5851 |
| 7 | `people_per_open_well` | 1:400 | "400 people per open hand well (flow 12.5 L/min)" | 5852 |
| 8 | `people_per_laundry` | 1:100 | "100 people per laundry facility" | 5853 |
| 9 | `people_per_bathing` | 1:50 | "50 people per bathing facility (short-term)" | 5854 |
| 10 | `people_per_toilet` | 1:20 | "Minimum 1 per 20 people (community long-term)" | 6328, 7754 |
| 11 | `max_waterpoint_distance_m` | < 500 | "Distance from any household to the nearest waterpoint < 500 metres" | 5864 |
| 12 | `max_queue_minutes` | < 30 | "Queuing time at water sources < 30 minutes" | 5867 |
| 13 | `m2_per_person_living` | ≥ 3.5 | "Minimum 3.5 square metres of living space per person, excluding cooking" | 13035 |
| 14 | `m2_per_person_living_cold` | 4.5–5.5 | "4.5–5.5 square metres of living space per person in cold climates or urban" | 13037 |
| 15 | `m2_per_person_camp` | 45 | "minimum usable surface area is 45 square metres per person in camp-type" | 12893 |
| 16 | `m2_per_person_camp_good_access` | 30 | "minimum surface area should be 30 square metres per person. If [good access]" | 12901 |

**Unique keys ที่ proposed (เอา Thai + Sphere รวมไม่ซ้ำ):**

- Water (8 keys): total / drinking / cooking / hygiene / tap / handpump / open_well / waterpoint
- Toilet (3 keys): unisex (Sphere) / female (Thai) / male (Thai)
- Other facility (4 keys): laundry / bathing / dining_adult / dining_child / washing_point
- Space (5 keys): sleeping / living_cold / total / camp / camp_good_access
- Food/Energy (2 keys): kcal_per_adult_day / rice_g_per_person_meal (derived)
- Distance/Time (2 keys): waterpoint_distance / queue_minutes

---

### Q-T18-3 (ต้นฉบับ)

**`rice_g_per_person_meal` ตั้งค่าเริ่มต้นเท่าไร?**

สถานการณ์ตอนนี้: Handbook ทั้ง Thai (ปภ. 2565) และ Sphere 2018 บอกแค่ kcal เป้าหมาย 2000/วัน ไม่ระบุ "ข้าวกี่กรัมต่อมื้อ" ตรง ๆ ผม derive ได้ ~120g/มื้อ จาก kcal target — แต่นี่คือผมเดา

คำถาม: ใช้ 120g ตามที่ผม derive, หรือมีตัวเลขมาตรฐานของ ปภ./WFP/ครัวกลางที่ใช้กันจริง?

ทำไมต้องถามก่อนเริ่ม: Seed = ค่าตั้งต้นทุกศูนย์ — ผิดทีเดียว = ทุกศูนย์คำนวณข้าวขาด/เกิน ส่งผลถึง T-31 → T-25 (meal plan) → T-26 (requisition) → คลังเบิกผิดจริง

---

### Q-T18-4 (ต้นฉบับ)

**Volunteer schema — `affiliation_tags` กับ `availability` วางยังไง?**

สถานการณ์ตอนนี้: CR-002 (06-A.md verified) บอกชัด: "Volunteer = domain concept ไม่ใช่ RBAC role"; login users มี `affiliation_tags: ["volunteer"]` เป็น metadata schema.md §2.8 มี volunteer doc แล้วแต่ไม่มี `availability` field ซึ่ง T-28 ต้องใช้จัดตาราง shift

คำถาม:
- `affiliation_tags` อยู่บน `_users` (auth layer) หรือบน `volunteer:{ulid}` doc?
- `availability` จะเก็บแบบไหน — recurring (จันทร์-ศุกร์ 9-17), specific date, หรือทั้งสอง?

ทำไมต้องถามก่อนเริ่ม: ผิดที่ = Team A ต้อง redesign T-28 ทั้งฟอร์ม; availability ผิด shape = T-29 (skill match + shift) ต้องเขียน matching algorithm ใหม่

---

### Q-T18-5 (ต้นฉบับ)

**ผลลัพธ์ T-18.1 (ตาราง ratio) เก็บไว้ที่ไหน?**

สถานการณ์ตอนนี้: Spec ไม่ระบุ path กฎ docs/change-management.md บังคับว่าทุก spec change ต้องมี tracking format ที่ PO เคาะ ผมต้องเลือกระหว่าง `docs/changes/<id>.md`, Notion, หรือ decision-sync frontmatter

คำถาม: Output ของ T-18.1 (ratio table + source per value) เขียนที่ไหน?

ทำไมต้องถามก่อนเริ่ม: ใส่เองมั่ว = bypass change-management policy + ถ้าเลือก path ที่ทีมไม่ใช้ = หาเอกสารไม่เจอตอน R3 implementation

---

### Q-T18-6 (ต้นฉบับ)

**Skill master list อยู่ที่ไหน?**

สถานการณ์ตอนนี้: Verified `frontend/src/lib/features/` มี 9 features (health, login, me, operations, people, register, shelters, sop-ratios, users) **ไม่มี catalog slice เลย** `seed.ts:20` มี comment ยืนยันชัดว่า supply_item + recipe ลง catalog db ผ่าน `catalogDoc()` helper "no factory (no catalog feature)" และ `volunteer.skills` ที่ schema.md §2.8 เป็นแค่ `[str]` free text ไม่ผูกกับ master list ใดๆ

คำถาม: Skill master list (พยาบาล/ครัว/ขนของ/ล่าม) ลงที่ไหน?
- (a) catalog db doc type `skill_master` ใหม่
- (b) hardcoded enum ใน domain
- (c) มี master-data system ที่ผมยังไม่เห็นใน plan?

ทำไมต้องถามก่อนเริ่ม: ห้าม invent doc type — ต้องอยู่ใน schema.md
