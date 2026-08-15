# T-31 — เครื่องมือคำนวณทรัพยากรประจำวัน: หลักฐานการสาธิต (Demo Evidence)

## 1. วัตถุประสงค์

พิสูจน์ว่าผลลัพธ์ `need` / `have` / `gap` ของเครื่องมือคำนวณตรงกับการคำนวณด้วยมือ สำหรับศูนย์พักพิง
หนึ่งแห่ง หนึ่งวันเต็ม — ตาม DoD ของ T-31: *"Demo คำนวณศูนย์ตัวอย่าง 1 วันเต็มตรงกับคำนวณมือ"*

## 2. สถานการณ์ทดสอบ

ศูนย์พักพิง **SH001** หลังรัน `pnpm seed && pnpm seed:delete-dashboard` (จำเป็น — ไม่งั้น
`seedDashboardData()` จะฉีดผู้พักพิงจำลองราว 100 คนที่ไม่คงที่เข้า SH001 ทำให้ occupancy
นับด้วยมือไม่ได้ชัดเจน)

- **Occupancy**: ผู้พักพิง 10 คน 3 ครัวเรือน ทุกคนมี `current_stay.status: 'active'` —
  ตรวจสอบด้วยการ query CouchDB โดยตรงก่อนรันจริง
- **SOP profile**: `catalog/sop_profile:master_sphere_baseline` ("Sphere Baseline") เวอร์ชัน 1
  จำนวน 20 เกณฑ์ — ตรวจค่าทีละตัวเทียบกับตัวเลขอ้างอิงมาตรฐาน Sphere ก่อนรันจริง
- **ไม่ได้ตรวจสอบในการสาธิตนี้**: พฤติกรรมการคำนวณซ้ำเมื่อ occupancy หรือเกณฑ์เปลี่ยนกลางวัน
  หรือพฤติกรรมแนวโน้มหลายวัน (ครอบคลุมโดยตรงในชุดทดสอบ domain ของ T-31.9 เรื่อง
  idempotency/recalculation)

## 3. การคำนวณด้วยมือ

### 3.1 Scenario 1 — ข้อมูล seed จริง (หลักฐานหลัก)

`need` / `have` / `gap` คือผลคำนวณด้วยมือล้วน ๆ (occupancy × เกณฑ์ หรือการหารแบบปัดขึ้น) —
การคำนวณด้วยมือจริง ส่วน `status` / `data_status` คือการจัดประเภทของระบบต่อผลคำนวณนั้น
(กฎเชิงธุรกิจที่กำหนดตายตัว ไม่ใช่การคำนวณด้วยมือ) — ใส่ไว้เพื่อให้นำไปเทียบกับผลลัพธ์ที่ระบบ
บันทึกจริงใน §5 ได้ทีละแถว ไม่ใช่เพราะต้องคำนวณสองค่านี้ด้วยมือ

ลำดับแถวเรียงตาม `ordinal` จริงที่ระบบบันทึก (0–20) เพื่อให้ตารางนี้เทียบกับ JSON ใน §5 และตาราง
§3 ของรายงาน Word ได้แบบหนึ่งต่อหนึ่ง

| ordinal | kind | key | สูตร | **need** (มือ) | **have** (มือ) | status (ระบบ) | data_status (ระบบ) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | multiply | water_l_per_person_day | 10×15 | 150 | null | insufficient_data | stock_unsynced |
| 1 | multiply | drinking_water_l_per_person_day | 10×3 | 30 | null | insufficient_data | stock_unsynced |
| 2 | multiply | cooking_water_l_per_person_day | 10×6 | 60 | null | insufficient_data | stock_unsynced |
| 3 | multiply | hygiene_water_l_per_person_day | 10×6 | 60 | null | insufficient_data | stock_unsynced |
| 4 | multiply | kcal_per_adult_day | 10×2000 | 20000 | null | insufficient_data | stock_unsynced |
| 5 | divide | people_per_tap | ceil(10/80) | 1 | null | insufficient_data | stock_unsynced |
| 6 | divide | people_per_handpump | ceil(10/500) | 1 | null | insufficient_data | stock_unsynced |
| 7 | divide | people_per_open_well | ceil(10/400) | 1 | null | insufficient_data | stock_unsynced |
| 8 | divide | people_per_laundry | ceil(10/100) | 1 | null | insufficient_data | stock_unsynced |
| 9 | divide | people_per_bathing | ceil(10/50) | 1 | null | insufficient_data | stock_unsynced |
| 10 | divide | people_per_toilet_female | ceil(10/20) | 1 | null | insufficient_data | stock_unsynced |
| 11 | divide | people_per_toilet_male | ceil(10/35) | 1 | null | insufficient_data | stock_unsynced |
| 12 | divide | people_per_dining_point_adult | ceil(10/20) | 1 | null | insufficient_data | stock_unsynced |
| 13 | divide | people_per_dining_point_child | ceil(10/10) | 1 | null | insufficient_data | stock_unsynced |
| 14 | multiply | m2_per_person_living | 10×3.5 | 35 | null | insufficient_data | stock_unsynced |
| 15 | multiply | m2_per_person_living_cold | 10×4.5 | 45 | null | insufficient_data | stock_unsynced |
| 16 | multiply | m2_per_person_total | 10×45 | 450 | null | insufficient_data | stock_unsynced |
| 17 | threshold | max_waterpoint_distance_m | เพดาน | n/a | n/a | constraint | complete |
| 18 | threshold | max_queue_minutes | เพดาน | n/a | n/a | constraint | complete |
| 19 | divide | people_per_volunteer | ceil(10/50) | 1 | null | insufficient_data | stock_unsynced |
| 20 | multiply | rice_g_per_person_meal | 10×200 | 2000 | null | insufficient_data | stock_unsynced |

**ผลลัพธ์: ตรงกัน 21/21 แถว** — ดู §5 สำหรับผลลัพธ์ที่ระบบบันทึกจริงที่นำมาเทียบกับตารางนี้

### 3.2 Scenario 2 — การพิสูจน์เชิงตัวอย่าง (ok/gap/surplus)

ข้อมูลจริงใน Scenario 1 ไม่กระตุ้นสาขา `ok`/`gap`/`surplus` เลย เพราะ `have` เป็น `null`
เสมอ (ดู §8 ข้อจำกัดที่ทราบ) สคริปต์นี้พิสูจน์ว่าสาขาเหล่านั้นทำงานถูกต้อง โดยเรียก
`calculateResources()` ตัวจริงด้วยค่า `have` ที่กำหนดเอง — ไม่ได้เชื่อมกับฐานข้อมูลใด ๆ
เป็นการเรียก pure domain function ล้วน ๆ:

```
water_l_per_person_day           need=150 have=100  -> gap       (need > have)
drinking_water_l_per_person_day  need=30  have=50   -> surplus   (need < have)
cooking_water_l_per_person_day   need=60  have=60   -> ok        (need = have)
people_per_toilet_female         need=1   have=0    -> gap
people_per_tap                   need=1   have=1    -> ok
people_per_volunteer             need=1   have=2    -> surplus
```

**ผลลัพธ์: ตรงกัน 6/6 แถว** ตามสาขาที่ตั้งใจไว้ทุกแถว

## 4. การสั่งงานจริงผ่านระบบ

สั่งงานผ่านเส้นทางคำนวณตามคำสั่ง (on-demand) ของแอปเอง: เข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์ระดับศูนย์
กดปุ่ม **"คำนวณใหม่"** บน `CalcStatusBadge` (T-31.7) ซึ่งเรียก `useRunCalc()` →
`DailyCalcRemoteRepository.runOnDemand()` — เส้นทางโค้ดจริงของระบบ (auth แบบ cookie-session,
อ่านผ่าน peer barrel, เขียน `daily_calc:{date}` แบบ deterministic)

กลไกการ trigger เองไม่ใช่สิ่งที่การสาธิตนี้ต้องพิสูจน์ — สิ่งที่ต้องพิสูจน์คือผลลัพธ์ที่บันทึกจริง
เท่านั้น (§5) — เอกสารนี้จึงไม่ยึดติดกับรายละเอียดการ implement แบบใดแบบหนึ่งที่อาจล้าสมัยได้
หลัง refactor

ผลลัพธ์: toast แจ้ง **"คำนวณใหม่เรียบร้อย"**, badge อัปเดตเป็น **"อัปเดตล่าสุด 15 ก.ค. 2569 18:33"**

## 5. ผลลัพธ์ที่ระบบบันทึก

เอกสาร `daily_calc:2026-07-15` ที่บันทึกจริงใน `shelter_sh001` ผลจากการ trigger ผ่าน UI จริง
ใน §4 (`GET /couch/shelter_sh001/daily_calc%3A2026-07-15`):

```json
{
  "_id": "daily_calc:2026-07-15",
  "type": "daily_calc",
  "schema_v": 1,
  "shelter_code": "SH001",
  "formula_v": "1.2.0",
  "sop_profile_version": 1,
  "occupancy_snapshot": 10,
  "created_by": "demo-t31.10",
  "updated_at": "2026-07-15T11:33:40.778Z",
  "results": [
    { "ordinal": 0,  "key": "water_l_per_person_day",           "kind": "multiply",  "need": 150,   "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 1,  "key": "drinking_water_l_per_person_day",  "kind": "multiply",  "need": 30,    "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 2,  "key": "cooking_water_l_per_person_day",   "kind": "multiply",  "need": 60,    "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 3,  "key": "hygiene_water_l_per_person_day",   "kind": "multiply",  "need": 60,    "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 4,  "key": "kcal_per_adult_day",                "kind": "multiply",  "need": 20000, "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 5,  "key": "people_per_tap",                   "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 6,  "key": "people_per_handpump",               "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 7,  "key": "people_per_open_well",              "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 8,  "key": "people_per_laundry",                "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 9,  "key": "people_per_bathing",                "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 10, "key": "people_per_toilet_female",          "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 11, "key": "people_per_toilet_male",            "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 12, "key": "people_per_dining_point_adult",     "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 13, "key": "people_per_dining_point_child",     "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 14, "key": "m2_per_person_living",              "kind": "multiply",  "need": 35,    "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 15, "key": "m2_per_person_living_cold",         "kind": "multiply",  "need": 45,    "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 16, "key": "m2_per_person_total",               "kind": "multiply",  "need": 450,   "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 17, "key": "max_waterpoint_distance_m",         "kind": "threshold", "need": null,  "have": null, "status": "constraint",        "data_status": "complete" },
    { "ordinal": 18, "key": "max_queue_minutes",                 "kind": "threshold", "need": null,  "have": null, "status": "constraint",        "data_status": "complete" },
    { "ordinal": 19, "key": "people_per_volunteer",              "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 20, "key": "rice_g_per_person_meal",            "kind": "multiply",  "need": 2000,  "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" }
  ]
}
```

(เอกสารเต็ม 21 แถว ไม่มีการแก้ไข ตรงกับ §3.1 ทีละแถว)

## 6. ภาพหน้าจอ

`CalcStatusBadge` (T-31.7) หลังสั่งคำนวณ แสดง toast สำเร็จและเวลาอัปเดตล่าสุด:

> **[✓] คำนวณใหม่เรียบร้อย**
> อัปเดตล่าสุด 15 ก.ค. 2569 18:33 · โดย demo-t31.10 [คำนวณใหม่]

ถ่ายสดจากแอป dev ที่กำลังรันอยู่จริง (เข้าสู่ระบบเป็น `staff01`) เอกสารที่บันทึกจริงคือหลักฐานหลัก
และแสดงไว้ครบใน §5

## 7. ตารางสรุปการตรวจสอบ

| ข้อกำหนด | วิธีตรวจสอบ | หลักฐาน | ผล |
| --- | --- | --- | --- |
| คำนวณมือ (Scenario 1) | คำนวณด้วยมือ | ตารางใน §3.1 เทียบ §5 | **ตรงกัน 21/21 แถว** |
| เอกสารที่บันทึกตรงกับตาราง | สั่งผ่าน UI จริง + อ่านจาก CouchDB โดยตรง | §5 | `daily_calc:2026-07-15` ตรงกับ §3.1 ทีละแถว |
| พิสูจน์สาขาสูตร ok/gap/surplus | `scripts/demo/t31-scenario-2-illustrative.ts` | §3.2 | **ตรงกัน 6/6 แถว** |

ผลลัพธ์จากระบบถูกนำมาเทียบกับตารางคำนวณมือโดยตรง โดยไม่มีการปรับแก้ตัวเลขฝ่ายใดฝ่ายหนึ่งหลัง
รันระบบจริง

## 8. ข้อจำกัดที่ทราบ

`resolveHave()` ค้นหายอดสต็อกด้วยคีย์ของเกณฑ์ SOP แต่บัญชีสต็อกจัดเก็บด้วยรหัสสินค้าในแค็ตตาล็อก —
ทั้งสองจึงไม่ตรงกันเลยกับข้อมูล seed จริง ทำให้ `have` เป็น `null` ในทุกรายการประเภท
multiply/divide ในตอนนี้ สิ่งนี้**ไม่ใช่ข้อผิดพลาดของสูตรคำนวณ** — `calc.formula.ts`
ได้รับการยืนยันด้วยชุดทดสอบ domain ของ T-31.9 แล้ว เป็นเพียงรอยต่อของการเชื่อมโยงข้อมูลต้นทาง
ที่ยังไม่ได้แก้ไข ถูกบันทึกไว้เป็นงานถัดไป **ข้อจำกัดนี้ไม่กระทบการยืนยันความถูกต้องของสูตรคำนวณ
เอง** — ความถูกต้องของสูตรได้รับการยืนยันอย่างเป็นอิสระโดยชุดทดสอบ T-31.9 และ Scenario 2 (§3.2)

## ภาคผนวก

**การเตรียมระบบ**

```
pnpm seed && pnpm seed:delete-dashboard
pnpm dev
```

รายละเอียดการเตรียมสภาพแวดล้อมแบบเต็ม (docker compose, `.env`) — ดู `docs/demo/README.md`
ถ้ามีสำหรับการตั้งค่าโปรเจกต์ทั่วไป ไม่ขอย้ำซ้ำที่นี่

**สคริปต์สาธิต** — `frontend/scripts/demo/t31-scenario-2-illustrative.ts`:

```
pnpm tsx --tsconfig .svelte-kit/tsconfig.json scripts/demo/t31-scenario-2-illustrative.ts
```
