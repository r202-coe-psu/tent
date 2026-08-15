---
title: "Task Breakdown — Module B — SOP & Resource Calc"
status: active
created: 2026-06-05
updated: 2026-08-13
module: B
note: >
  decision-synced 2026-06-15 — task details and DoD maintained directly in Markdown;
  CR-006 (SOP master/override) applied 2026-06-22;
  CR-042 (OD-1=A, OD-2=B, OD-3=A, OD-4=C) applied 2026-07-23;
  2026-08-13 — CR-066 T-69 occupancy health **approved** (Wave 1–3); T-76 SOP-lite/Sphere = Wave 4 รอบ CR ถัดไป
---

# Module B — SOP & Resource Calc

> SOP ratio config, daily resource calc engine + dashboard, what-if simulation

- **Team owner:** Team D — เน, ภูดิท, วิลเลียม (SOP/Resource Calc; ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** R2, R3, R4
- **Design input (บริษัท):** P-01 (ส่งมอบแล้ว), P-02 (กำหนดส่งก่อนกรกฎาคม 2026), P-03 (Family Search ส่งล่วงหน้า; EOC/Open API ตาม deferred)
- **Target ส่งมอบ:** in-scope ภายในสิงหาคม 2026 · deferred (T-42) ภายในสัปดาห์ที่ 2 กันยายน 2026

## Features / Tasks

| ID | Status | Feature / Task | FR | Phase | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-18 | 🔄 | Groundwork: SOP ratio data gathering + volunteer schema | prep R3 | R2 | prod | ส.ค. | 6 | ÷1.25 | 5 | T-02 |
| T-30 | 🔄 | SOP ratio configuration (master + per-shelter override) | FR-44 | R3 | prod | ส.ค. | 6 | ÷1.6 | 4 | T-18 |
| T-31 | 🔄 | Daily resource calculation engine | FR-45 | R3 | prod | ส.ค. | 7 | ÷1.4 | 5 | T-30,T-14 |
| T-32 | 🔄 | Resource calculation dashboard | FR-46 | R3 | prod | ส.ค. | 5 | ÷1.6 | 3 | T-31 |
| T-42 | ⬜ | SOP what-if simulation | FR-54 | R4 | prod | deferred | 6 | ÷1.4 | 4.5 | T-31 |
| T-69 | ⬜ | Occupancy health 5 สี (derived) staff + public — CR-069 P3 | FR-66..68 | R3 | prod | in-scope | 5 | ÷1.4 | 3.5 | T-52 |
| T-76 | ⬜ | SOP-lite บ้านพี่เลี้ยง + Sphere auto-capacity + ไม่บังคับ staff — **blocked workshop** | FR-63 phase2 | R4 | prod | blocked | 6 | ÷1.25 | 5 | T-66, SOP workshop |
|  |  | **รวมทั้งโมดูล** |  |  |  |  | **30** |  | **21.5** |  |

> **Deferred** (ส่งมอบหลัง go-live, ภายในสัปดาห์ที่ 2 กันยายน 2026): T-42

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง

### T-18 — Groundwork: SOP ratio data gathering + volunteer schema (prep R3)

**Description:** งานเตรียม R3 ระหว่าง R2: รวบรวมค่า SOP ratio seed จาก Sphere Handbook + Thai shelter handbook ใน `docs/source/handbooks/` (อัตราข้าว-ไข่-น้ำต่อหัว, อาสาต่อผู้พักพิง ฯลฯ) แล้วให้ PO/ผู้เชี่ยวชาญ sign-off ก่อน T-30; ออกแบบ volunteer schema ให้ Module A — ไม่ใช่ feature ที่ user ใช้

**Definition of Done:**
- ตาราง SOP ratio ตั้งต้น (พร้อมแหล่งอ้างอิงต่อค่า) ผ่าน review และ sign-off จาก PO/ผู้เชี่ยวชาญ ก่อน T-30 เริ่ม build
- Volunteer schema (skills master list, availability shape) ผ่าน review Lead + สอดคล้อง T-02
- ข้อสรุปส่งเป็น input ให้ T-28/T-30 เริ่มงานได้โดยไม่ต้อง redesign

### T-30 — SOP ratio configuration (FR-44)

**Description:** หน้าตั้งค่า SOP ratio (วัตถุดิบต่อหัวต่อมื้อ, ของใช้ต่อคนต่อวัน, อาสาต่อผู้พักพิง, ต่อเตาประกอบอาหาร — ตาม source Module B) **สองชั้นตาม [CR-006](../changes/CR-006-sop-profile-master-override.md)**: (1) master `sop_profile` ที่ catalog — `system_admin` ดูแลเป็นค่าตั้งต้นกลางจาก T-18; (2) per-shelter override `sop_override` ที่ `shelter_*` — `shelter_manager` ปรับของศูนย์ตัวเองได้โดยไม่ต้อง deploy ใหม่

**Definition of Done:**
- **Master CRUD** (`sop_profile`, catalog): จำกัดสิทธิ์ `system_admin`; replicate ลง shelter เป็น read-only
- **Override CRUD** (`sop_override`, shelter_*): `shelter_manager` สร้าง/แก้ของศูนย์ตัวเอง และ **set `active` เองได้**; override เก็บ ratios **ครบทั้งชุด** (override ทั้ง profile, ไม่ใช่ per-key) อ้าง `base_profile_id`
- CRUD ratio ต่อประเภททรัพยากร และต่อหน่วยอ้างอิง (ต่อหัว, ต่อเตา, ต่อครัวเรือน — FR-44) จำกัดสิทธิ์ตาม role-permission matrix
- แก้ค่าแล้วมีผลกับการคำนวณรอบถัดไปทันที (ไม่ cache ค้าง) + เก็บประวัติการแก้ (ใคร/เมื่อไร/ค่าเดิม) ทั้ง master และ override
- Seed master ค่าตั้งต้นจาก T-18 ครบ และ test + demo: SA แก้ master, shelter_manager override แล้วเห็นผลต่างกันใน calc

### T-31 — Daily resource calculation engine (FR-45)

**Description:** Engine คำนวณความต้องการทรัพยากรรายวันของศูนย์: occupancy จริง (T-06) × SOP ratio (T-30) เทียบ stock คงเหลือ (T-14) → ออกเป็น "ต้องการเท่าไร มีเท่าไร ขาดเท่าไร" ทั้งวัตถุดิบ ของใช้ และจำนวนอาสา — เป็น **hub ของ critical path** (block meal plan T-25, dashboard T-32, backbone T-35, simulation T-42)

**Definition of Done:**
- คำนวณ need/have/gap ต่อ item ต่อวันจากข้อมูลล่าสุดแบบ **on-demand** (ปุ่มรันจาก UI) — **ไม่มี**รอบอัตโนมัติใน R3 ([CR-042](../changes/CR-042-daily-sop-calc-follow-up.md) OD-3=A; scheduler = backlog)
- **ใช้ effective ratio ตาม [CR-006](../changes/CR-006-sop-profile-master-override.md)**: resolve `override active ?? master` ก่อนคูณ occupancy (ไม่อ่าน master ตรงเมื่อศูนย์มี override active)
- Persist `daily_calc:{date}` schema_v **2** พร้อม `ratio_source` + override id/version ([CR-042](../changes/CR-042-daily-sop-calc-follow-up.md) OD-1=A)
- `have` ตาม **hardcode map** ใน CR-042 OD-2=B (ไม่ lookup ด้วยชื่อ ratio key); key ที่ `have_source=none` → `have=null`
- ผลให้ **dashboard T-32** อ่านจาก `daily_calc` — **ไม่บังคับ** feed Meal Plan (T-25) / Donation (T-23) / Volunteer demand (T-29) ใน R3 ([CR-042](../changes/CR-042-daily-sop-calc-follow-up.md) OD-4=C)
- สูตรมี unit test เทียบค่าคาดหวังจาก SOP จริงครบทุกประเภททรัพยากร (อาหาร/ของใช้/อาสา) ภายใต้ map ที่ล็อก
- Edge cases ครอบ: occupancy = 0, ratio ขาด, **ศูนย์ไม่มี override → fall back master**, stock = 0 หรือข้อมูลยังไม่ sync — ไม่ crash, แสดงสถานะข้อมูลไม่พอ
- Demo คำนวณศูนย์ตัวอย่าง 1 วันเต็มตรงกับคำนวณมือ
- ถอด `rice_g_per_person_meal` จาก runtime `SOP_RATIO_KEYS` ให้ตรง [CR-021](../changes/CR-021-sop-ratio-scope-handbook-plus-volunteer.md)

### T-32 — Resource calculation dashboard (FR-46)

**Description:** Dashboard แสดงผลการคำนวณของ T-31 สำหรับผู้บริหารศูนย์: ภาพรวม need/have/gap วันนี้ + แนวโน้ม เพื่อใช้ตัดสินใจขอของบริจาค/เกลี่ยทรัพยากร/เรียกอาสาเพิ่ม

**Definition of Done:**
- แสดง gap รายหมวด (อาหาร/ของใช้/อาสา) ชัดเจน รายการขาดเรียงตามความรุนแรง — อ่านจาก `daily_calc` เป็น source หลัก
- Drill-down ดูที่มาตัวเลขได้ (occupancy, ratio, have/stock, `as_of`) — ระบุว่า ratio มาจาก **master หรือ override** จาก field ใน snapshot (`ratio_source` + override id/version) ไม่ resolve สด ([CR-006](../changes/CR-006-sop-profile-master-override.md) / [CR-042](../changes/CR-042-daily-sop-calc-follow-up.md) OD-1=A)
- มีทางรันคำนวณ on-demand จากหน้า dashboard เมื่อยังไม่มี doc ของวันนั้น
- จำกัดตาม shelter scope + role, โหลดตาม NFR และ test + demo ผ่าน

### T-42 — SOP what-if simulation (FR-54, deferred)

**Description:** เครื่องมือจำลองสถานการณ์บน engine T-31: ปรับตัวแปรสมมุติ (เช่น ผู้พักพิงเพิ่มเป็น 2,000 คน, น้ำท่วมยาว 14 วัน, ratio เปลี่ยน) แล้วดูผลกระทบความต้องการทรัพยากรล่วงหน้า — ใช้วางแผนเตรียมการ ไม่แตะข้อมูลจริง ส่งมอบหลัง go-live

**Definition of Done:**
- ตั้ง scenario (occupancy สมมุติ, จำนวนวัน, ratio override) แล้วรันผลผ่าน engine เดียวกับ T-31 (ไม่ fork สูตร)
- ผล simulation แยกขาดจากข้อมูลจริง (ไม่เขียนทับ calc รายวัน) + เทียบ scenario กับปัจจุบันได้
- บันทึก/เปิด scenario ซ้ำได้ และ test + demo จำลองเหตุการณ์น้ำท่วมตัวอย่าง — ส่งมอบภายใน 14/09/2026

---

### T-69 — Occupancy health 5 สี (CR-069 P3)

**Status:** ⬜ ready — CR-069 **approved** 2026-08-13. Wave 1–2 ล็อกแล้ว; ตัวเศษ occupancy ตาม Wave 3 D-BOOK-OCC=C
**Owner:** Team D (เน, ภูดิท, วิลเลียม) เจ้าของสูตร; Lead รีวิว public plane
**Depends:** T-52; [CR-069](../changes/CR-069-occupancy-health-colors.md) — occupancy health นับ stay `active` + `pre_registered` (D-BOOK-OCC=C)
**Program:** P3

**Description:** ฟังก์ชัน domain บริสุทธิ์ derive `occupancy_health` จาก occupancy÷capacity + override จาก `operation_status`. **ไม่ persist.** Occupancy = count stay `active` **และ** `pre_registered` (D-BOOK-OCC=C — ทับ T-04/T-06 และตัวเศษ Wave 1 ที่นับแค่ `active`). แทนแถบ staff 3 สีด้วย 5 สีบน staff list/dashboard **และ** public map/card (D-HEALTH-SURFACE=A). **ไม่สร้างหน้า EOC ในแอป (FD-14)** — EOC = ฟิลด์ API ทีหลัง (T-70). กติการวม: `standby`/`closed` → เทา (ไม่เข้า %); `full_capacity` → แดงแม้ occupancy &lt;100%; นอกนั้นตาม % (เทาปิด · ฟ้า &lt;60 · เหลือง 60–89 · แดง 90–100 · แดงเข้ม &gt;100). `capacity=0` + สถานะเปิด → ไม่มีข้อมูลความจุ ห้ามหารศูนย์. เปิดอยู่ = `{active, full_capacity}`. Kitchen/SOP คนอยู่จริง (T-31) ยังนับ `active` อย่างเดียว.

**Files likely touched:** `features/shelters` หรือ `features/dashboard` domain health; staff list occupancy bar; public-portal map/card color; ห้าม hardcode % กระจาย — ค่าคงที่ที่เดียว

**Definition of Done:**
- UI: staff list/dashboard **และ** public map/card แสดง 5 สีตามสูตรที่ล็อก
- Write path: **ไม่มี** — derived ตอนอ่าน
- Validation: `capacity<=0` + สถานะเปิด ไม่หารศูนย์; occupancy=0 + `active` = ฟ้า; `standby` = เทาแม้ occupancy สูง; `pre_registered` นับเข้า occupancy
- Permission: อ่านตาม shelter scope เดิม
- Test: ทุกแถบสี + `closed`/`standby` ทั้งที่ยังมีคน + `full_capacity` + occupancy 50/100 = แดง + ขอบ 89/90 และ 100/101 + hold `pre_registered` ทำให้สีขยับ
- Demo: 5 ศูนย์ครบ 5 สี

**Out of scope:** T-70 EOC API field; auto-เขียน `operation_status`; block check-in เมื่อเกินจุ; SOP-lite (T-76); kitchen headcount (CR-022)

---

### T-76 — SOP-lite + Sphere auto-capacity + ไม่บังคับ staff ประจำบ้าน — BLOCKED

**Status:** ⬜ blocked — SOP workshop ยังไม่เกิด — **Wave 4 รอบ CR ถัดไป**
**Owner:** Team D
**Depends:** T-66; D-SOP-LITE, D-HOST-STAFF, D-SPHERE-CAP
**Program:** P1b

**Description:** หลัง workshop — ฟิลด์บังคับบ้านพี่เลี้ยงเบากว่าศูนย์; capacity จาก `floor(area_m2 / 3.5)` ถ้าล็อกสูตร; บ้านไม่บังคับ user ประจำ. **ห้ามเดารายการฟิลด์ SOP ในรอบนี้.**

**Definition of Done:** ยังไม่มีจนกว่า workshop + decision. หลังล็อก: schema/form ตามรายการที่เซ็น, test Sphere rounding, demo บ้านไม่มี SM ประจำตาม D-HOST-STAFF

**Out of scope:** สมมติ checklist พื้นที่ปลอดภัยจาก CR-014 โดยไม่มี workshop

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| R2 | 6 | 5 |
| R3 | 18 | 12 |
| R4 | 6 | 4.5 |
| **รวม** | **30** | **21.5** |

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- `T-02` (Data-model expansion (household, zone, supply, ledger, donation) — additive) — module **Platform/Core**
- `T-14` (Stock dashboard + reorder threshold) — module **Module C — Supply & Inventory**
