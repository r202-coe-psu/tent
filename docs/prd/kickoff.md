---
title: "Full-System Kickoff — Smart Shelter (Aug-Dec 2026)"
status: draft
created: 2026-06-03
updated: 2026-06-05
purpose: Single source for full-scope + timeline kickoff; basis for presentation slides
---

# Smart Shelter — Full-System Kickoff

เอกสาร kickoff ตัวเดียวที่รวม **scope ทั้งโครงการ + timeline + การแบ่งทีม + man-power + สิ่งที่ทุกคนต้องรู้** สำหรับประชุม kickoff ส่วนต่อจาก July MVP ใช้เป็นฐานทำ slide — รวม baseline ของ July MVP (R1) ไว้ในตัว ไม่ต้องเปิดเอกสารแยก

> รายละเอียดเจาะลึกอยู่ในเอกสารชุดเดียวกัน: [Roadmap](roadmap.html) · [R2](phase-r2-foundation.html) · [R3](phase-r3-operations.html) · [R4](phase-r4-integration-handover.html) · [Task Breakdown](task-breakdown.html) · ฐาน MVP: [MVP PRD](../prd-smart-shelter-spec-2026-05-30/prd.html)

---

## 0. ทำไมต้องมีระบบนี้

**Smart Shelter** คือระบบจัดการศูนย์พักพิงสำหรับภัยพิบัติน้ำท่วม พัฒนาโดย PSU ร่วมกับ ศูนย์คอมพิวเตอร์ ม.อ. สำหรับใช้จริงในพื้นที่เสี่ยงน้ำท่วมภาคใต้ (เน้น Hat Yai และจังหวัดใกล้เคียง) ช่วง **กันยายน–ธันวาคม** ซึ่งเป็นช่วงเสี่ยงสูงทุกปี

**ปัญหาเดิมที่ต้องแก้:** เจ้าหน้าที่ศูนย์พักพิงใช้กระดาษและ Excel บันทึกข้อมูลผู้อพยพแยกกันแต่ละศูนย์ ทำให้ไม่รู้ว่าใครอยู่ที่ไหน ซ้ำซ้อน หรือขาดหายไป และ EOC ไม่สามารถเห็นภาพรวมระดับเมือง/จังหวัดได้แบบ real-time

**สิ่งที่ระบบต้องทำได้:**
- เจ้าหน้าที่ register, screen, track movement ผู้อพยพได้แบบ real-time
- ศูนย์เดินงานประจำวัน (คลัง, ครัว, อาสาสมัคร) จากข้อมูลจริง ไม่ใช่การประมาณ
- EOC เห็นภาพรวมข้ามศูนย์ ส่งต่อข้อมูลให้ Hat Yai ROD / One Data ได้
- ใช้งานได้แม้ network ขาด (offline draft) และมี fallback เป็น Excel import

**July MVP (R1) พิสูจน์แล้วว่า** registration-first ใช้จริงได้ — ต่อจากนี้คือ build backoffice ทั้งระบบ (R2-R4) บนข้อมูลจริงที่ MVP เก็บไว้แล้ว ให้เสร็จก่อน deadline จริง **ธ.ค. 2026**

---

## 0.1 เป้าหมายประชุม Kickoff นี้

**ต้องได้จากการประชุม:**
- ทุกคนเห็น full scope + timeline ตรงกัน (R2-R4 build ส.ค.-ต.ค., milestone ก.ย. 80%, deadline จริง ธ.ค.)
- จับ domain ลงทีม D1-D4 + ยืนยัน Lead pair + owner ชัดทุก domain
- ปิด decisions K-11..K-16 หรือมี owner + due date ชัดเจน
- ทีมเข้าใจ vertical ownership + shared core review + quality gate ก่อนเริ่ม build

**ต้องกันออกและไม่ debate ใน Kickoff:**
- Requirement ใหม่ที่ไม่อยู่ใน scope R2-R4 ที่กำหนดไว้แล้ว → เข้า change control ก่อน
- รายละเอียด implementation ระดับ API/schema → เป็น task ของ Lead pair หลัง kickoff
- SOP authoring, co-design, training content → context นอกระบบ ไม่ใช่ scope ของทีม dev

---

## 1. TL;DR (สรุป 1 หน้า)

| หัวข้อ | สาระ |
| --- | --- |
| **ทำอะไร** | ต่อยอด July MVP (registration-first) → **full software platform**: Household, Inventory, Donation, Kitchen, Volunteer, SOP, Security, Referral, EOC |
| **เมื่อไร** | **build R2/R3/R4 = ส.ค.-ต.ค. 2026** (3 gate ราย module); **deadline จริง = ธ.ค. 2026** (ต.ค.-ธ.ค. = hardening + buffer) |
| **milestone ภายใน** | **สิ้น ก.ย. = ~80% feature testable** (internal checkpoint ไม่ใช่ hard finish) |
| **ใคร** | นักศึกษา **14 คน = 2 Lead (Platform/Core) + 4 ทีม × 3** (Lead pair ควบ integrator + shared core) |
| **scope** | full software platform — **ไม่ตัด scope** (SOP authoring/training/co-design = context นอกระบบ) |
| **finish line** | R4 Final Handover Gate (ต.ค.) → hardening/handover ถึง **ธ.ค.**; ระบบ core (MVP) live แล้ว backoffice ทยอยขึ้นตลอดช่วงเสี่ยงน้ำท่วม ก.ย.-ธ.ค. |
| **งานรวม (full lifecycle)** | 324 raw MD → **242.5 MD หลัง AI uplift (−25%)** — pre บริษัท 30, นักศึกษา (prod+post) 212.5 |
| **แบ่งงาน** | **Pre-production = บริษัท** (UX/design/spec — ส่งแล้ว กำลัง refine ไม่ block); **Production + Post = นักศึกษา 2 Lead + 4 ทีม** |

**Thesis:** MVP พิสูจน์ว่า registration-first ใช้จริงได้ → ต่อยอด backoffice บนข้อมูลจริง ทีมโต (14 คน) รันขนานหลายทีมทำให้ build หลักจบใน ส.ค.-ต.ค. โดย**ไม่ต้องตัด scope** เหลือ ต.ค.-ธ.ค. เป็น buffer สำหรับ hardening + UAT + handover ก่อน deadline จริง ธ.ค.

---

## 2. เรามาถึงไหนแล้ว → จะไปไหนต่อ

**ทำเสร็จ (R1 / July MVP):** auth+RBAC, Shelter master, Person registration, screening/medical/fast-track, Person Shelter ID/QR, search, check-in/out, Dashboard v1, export, offline draft, fallback, audit — Person-only

> **R1 baseline (สรุปจาก July MVP — canonical FR 1-20):** Registration-first, Person-only ไม่มี Household. E2E flow: login (role+shelter scope) → register Person (required ขั้นต่ำ name+gender) → screening/vulnerability/medical/fast-track ตามสิทธิ์ → Person Shelter ID/QR → search/scan check-in → check-out + occupancy guardrail (warning-only) → Dashboard v1 (occupancy, capacity, vulnerable/fast-track count, medical summary, in/out today) → export ตาม shelter/date/role พร้อม audit+masking → offline draft/queue (registration/screening) + manual/Excel fallback + assisted import.
> **Data contract MVP:** 10 collections — `users`, `shelters`, `evacuees`, `movement_events`, `dashboard_summaries`, `offline_submissions`, `import_batches`, `export_jobs`, `id_counters`, `audit_logs`. `national_id_hash` ห้าม return จาก API; sensitive fields mask/hide ตาม role ทั้ง UI/API/export; QR payload ไม่มี PII/health. MongoDB = source of truth, PouchDB/CouchDB = staging/sync layer.
> รายละเอียดเต็มดู [MVP PRD](../prd-smart-shelter-spec-2026-05-30/prd.html) · [Data Dictionary](../../data/smart-shelter-data-dictionary.html) · เอกสาร kickoff July ฉบับเดิมถูกย้ายไป [legacy](../../legacy/mvp-kickoff.html)

### R1 UAT E2E Scenarios (regression baseline — ต้องรักษาไว้ตลอด R2-R4)

ทุก build ใหม่ต้องไม่ทำให้ scenarios เหล่านี้พัง ใช้เป็นชุด smoke test ก่อน gate ทุก phase:

1. เจ้าหน้าที่ login ตาม role และ shelter scope ที่กำหนด
2. ลงทะเบียน Person ด้วย required fields ขั้นต่ำ (name + gender)
3. บันทึก screening / vulnerability flags / medical notes / fast-track ตามสิทธิ์ของ role
4. สร้าง Shelter ID / QR ระดับ Person
5. ค้นหา Person หรือ scan QR เพื่อ check-in
6. check-out → movement history และ occupancy guardrail (warning-only) ถูกต้อง
7. Dashboard v1 แสดง occupancy, capacity, vulnerable count, fast-track count, medical summary, in/out today และ last updated
8. Export ตาม shelter / date / role พร้อม audit log และ masking ตาม role
9. Offline draft / fallback ไม่ทำข้อมูลหายหรือซ้ำ และมี assisted import path

**ยังไม่ทำ (เป้าหมาย R2-R4):** ทุกอย่างที่ proposal วางไว้แต่ MVP กันออก — Household, zoning, คลังสิ่งของ, donation อัจฉริยะ, ครัวกลาง, อาสาสมัคร, SOP calculator, security, referral, EOC + Open API, family search

---

## 3. Full Scope Map (ภาพรวมทั้งระบบ)

| Layer | Module | Phase | สถานะ |
| --- | --- | --- | --- |
| Front | Person registration + screening + QR + check-in | R1 | ✅ MVP |
| Front | **Household + zoning + pets/assets** | R2 | 🔜 |
| Back | **Module C: Inventory/Supply** (รับ/แจก/โอน, stock dashboard) | R2 | 🔜 |
| Back | **Donation** (intake → reservation/cut-off/redirect/transparency) | R2→R3 | 🔜 |
| Back | **Module D: Kitchen & Food** (meal plan, requisition, service) | R3 | 🔜 |
| Back | **Module A: Volunteer** (register, skill match, shift) | R3 | 🔜 |
| Back | **Module B: SOP Resource Calculator** | R3 | 🔜 |
| Back | **Module E: Security** + **Module F: Referral** | R3 | 🔜 |
| Top | **EOC Dashboard + Open API** → One Data / Hat Yai ROD | R4 | 🔜 |
| Top | **Public family search** (privacy-preserving) | R4 | 🔜 |
| Cross | RoPA/consent/retention, cross-module UAT, handover | R4 | 🔜 |

**Non-goals (ทั้งโครงการ):** ระบบเตือนภัยน้ำท่วมต้นน้ำ (Hat Yai ROD ทำ — เราส่ง data ให้), ERP การเงิน/HR, full offline sync ทุก module, hardware/IoT/VHF automation, recovery-phase (อาชีพ/ปิดศูนย์ระยะยาว), native mobile app

---

## 4. Timeline (canonical)

| Phase | เดือน | Gate | Scope หลัก | FR |
| --- | --- | --- | --- | --- |
| R1 | ก.ค. | July MVP Demo *(done)* | Registration-first MVP | 1–20 |
| **R2** | **ส.ค.** | **Backoffice Foundation Gate** | Household, Zoning, Inventory(C), Donation intake, RBAC ext | 21–34 |
| **R3** | **ก.ย.** | **Operations Gate** | Donation full, Kitchen(D), Volunteer(A), SOP(B), Security+Referral(E+F) | 35–48 |
| **R4** | **ต.ค.** | **Final Handover Gate** | EOC+Open API, family search, simulation, RoPA, UAT, handover | 49–56 |
| — | **ต.ค.–ธ.ค.** | **Hardening + buffer → deadline จริง ธ.ค.** | field UAT, bug-fix, training, handover refine, support | — |

ทุก gate ต้องผ่าน: automated checks + staging UAT + **critical bug = 0** + backup/rollback readiness ([Delivery Agreement](../../delivery/project-delivery-agreement.html))

**Deadline = ธ.ค. 2026 (ไม่ตัด scope):** build หลัก R2/R3/R4 จบ ส.ค.-ต.ค. แล้วเหลือ ต.ค.-ธ.ค. เป็น buffer สำหรับ hardening, field UAT, training, handover — ไม่ต้องบีบจนต้องตัด feature

**Internal milestone — สิ้น ก.ย. ≈ 80% testable:** R2 ปิด + R3 ส่วนใหญ่ขึ้น = ราว 80% ของ feature พร้อมให้ test ภายใน *(checkpoint วัด velocity ไม่ใช่ hard finish line)* ใช้ตัดสินว่าต้อง re-balance ทีมตรงไหนก่อนเข้า R4 ([Roadmap §5](roadmap.html))

---

## 5. เจาะราย Phase

### R2 — Foundation (สิงหาคม)

- **เป้า:** ปูฐานหลังบ้าน — ผูกคนเป็นครัวเรือน+จัดโซน, เปิดคลังกลางเห็น stock real-time, รับ donation เข้าคลัง
- **ส่งมอบ:** Household reg + Household QR/search/check-in, zoning, pet/asset, supply catalog + receive/distribute/transfer + stock dashboard + reorder threshold, donor pre-declaration, RBAC role ใหม่ + field-level
- **Gate:** Backoffice Foundation — stock dashboard reconcile กับ ledger, household check-in ถูกต้อง
- **คอขวด:** Lead pair (Platform/Core) ต้องปิด data model (T-02) + RBAC (T-01) ให้ไว ทุกทีมขึ้นกับมัน

### R3 — Operations (กันยายน · phase หนักสุด)

- **เป้า:** ศูนย์เดินงานประจำวันได้จริง — donation ไม่ล้น (cut-off+redirect), ครัววางแผนจากยอดจริง, อาสาจับคู่ทักษะ, SOP บอกความต้องการรายวัน
- **ส่งมอบ:** donation reservation/cut-off/redirect/transparency, meal plan+requisition+service, volunteer+skill match, SOP ratio+resource calc+dashboard, security event, referral
- **Gate:** Operations — cut-off+redirect ทำงาน, kitchen requisition ตัด stock ถูก, resource calc ตรง occupancy×ratio
- **คอขวด:** 5 module-group ขนานพร้อมกัน; SOP calc (T-31) อยู่ปลายสุดของ logic chain → เริ่ม data contract แต่ต้น phase

### R4 — Integration & Handover (ตุลาคม)

- **เป้า:** รวบข้อมูลรายศูนย์ → ภาพรวมเมือง/จังหวัด ส่ง EOC/One Data, เปิด family search ปลอดภัย, ทำให้ระบบ handover ได้
- **ส่งมอบ:** EOC aggregate dashboard + role-scoped views, Open API (aggregate, no PII), consent/opt-out + privacy-preserving family search, SOP simulation, RoPA/retention, cross-module UAT, handover package + training
- **Gate:** Final Handover — UAT ข้าม module critical bug = 0, backup/restore tested, handover package ครบ
- **คอขวด:** EOC/API รอ R3 producer ครบ; T-44 (UAT+handover 9 MD) เป็น single task ยาวสุด เริ่มทันที R3 ปิด

---

## 6. Team Model — 2 Lead + 4 ทีม × 3 / 14 คน

**โครงสร้าง: 2 Lead (Platform/Core, floating) + 4 ทีมโดเมน × 3 คน.** domain grouping เคาะใน kickoff (K-13) — ดู [Squad Roster](squad-roster.html).

| หน่วย | คน | Domain | Active |
| --- | --- | --- | --- |
| **Lead pair** Platform/Core ⭐ | 2 | auth, RBAC, data model, shared API, sync, DevOps, integration + integrator/review | R2-R4 |
| **D1** | 3 | _(จับในห้อง)_ | — |
| **D2** | 3 | _(จับในห้อง)_ | — |
| **D3** | 3 | _(จับในห้อง)_ | — |
| **D4** | 3 | _(จับในห้อง)_ | — |

**6 domain ที่จับลง D1-D4 (โหลดราย domain, Adj MD prod+post):**

| Domain | R2 | R3 | R4 | รวม | dependency |
| --- | --- | --- | --- | --- | --- |
| People & Search | 18.5 | 3 | 7.5 | 29 | standalone; R3 เบา |
| Supply & Inventory | 15.5 | — | 4 | 19.5 | คู่กับ Kitchen (FD-10) |
| Donation | 6 | 14 | 4.5 | 24.5 | feed inventory |
| Kitchen & Food | 5 | 10.5 | — | 15.5 | ขึ้นกับ Supply |
| Volunteer & SOP | 5 | 15 | 4.5 | 24.5 | SOP ขึ้นกับ resource (T-31) |
| Security/Referral/EOC | 5 | 8 | 13 | 26 | EOC = aggregate API (FD-14), R4 หนัก |
| _Platform/Core (Lead pair)_ | 21.5 | 9.5 | 27 | 58 | คอขวด, ทุกทีมขึ้นกับ |
| _Q-02 support buffer_ | — | — | 15.5 | 15.5 | เฉลี่ยทุกทีม |
| **รวม/phase** | **76.5** | **60** | **76** | **212.5** | |

*capacity ทีม 3 คน = 48 MD/เดือน, Lead pair = 32 MD/เดือน. util ราย team คำนวณหลังจับ domain ในห้อง — load รวมไม่ binding, **ไม่ติดคน ติด dependency ข้าม team**. Lead pair R4 ตึงสุด (27/32 = 84%) → กระจาย post-prod ลง buffer ต.ค.-ธ.ค.*

**ข้อควรจัดการ:**
- **Pre-production (บริษัท) ส่งแล้ว กำลัง refine — ไม่ block** ใช้ design/spec ที่ส่งมาเริ่ม build ได้; ส่วน refine คู่ขนานไม่ถือเป็น gate (ดู [Task Breakdown §4](task-breakdown.html))
- R2: domain ที่ยังไม่มี module หลัก (Kitchen/Volunteer/Security) → มอบ **groundwork จริง** (schema, prototype, เก็บค่า SOP) อย่าให้ idle
- **R4 Platform/Core (27/32 ใน ต.ค.)** — post-production (deploy, support, manual, handover) กระจายลง buffer ต.ค.-ธ.ค. ได้ + แบ่ง Q-01/Q-03/T-44 ให้ทีมที่เบาลง → ไม่ตึงเท่าแผนบีบเดิม
- ทีม 3 คน ทนกว่าเดิม (เคย 2 คน) แต่ยัง cross-train ในทีม; **Lead pair floating** ช่วยทีมที่ติด dependency

---

## 7. Man-Power + AI Uplift

ทุกคนมี AI agent (Cursor $20 / Copilot Education / Gemini Antigravity IDE 2.0) ใช้ตัวคูณตาม **ชนิดงาน** — AI เร่ง implementation มาก แต่ **ไม่เร่ง** coordination, PDPA/governance, stakeholder sign-off

| ชนิดงาน | AI× | | ชนิดงาน | AI× |
| --- | --- | --- | --- | --- |
| Design/UX/spec | ÷1.2 | | Algorithm/logic | ÷1.4 |
| Implementation | ÷1.6 | | Testing/UAT/bugfix | ÷1.3 |
| Data/integration | ÷1.25 | | Governance/docs | ÷1.1 |

**ผล (full lifecycle):** 324 raw MD → **242.5 MD (−25%)**

| Stage | Owner | Adj MD |
| --- | --- | --- |
| Pre-production | บริษัท | 30 |
| Production | นักศึกษา | 153 |
| Post-production | นักศึกษา + บริษัท QA | 59.5 |

รายละเอียด task-by-task ใน [Task Breakdown](task-breakdown.html)

---

## 8. Critical Path & Dependencies

```
T-02 data model ─> T-11 stock ─> T-14 dashboard ─┬─> donation cut-off/redirect (R3)
                                                 ├─> T-31 resource calc ─> meal plan
                                                 └─> volunteer demand
all R3 producers ─> T-37 EOC dashboard ─> T-39 Open API (R4)
all build ─> T-44 cross-module UAT + handover ─> Q-02 support buffer (ต.ค.-ธ.ค.)
```

- **Pre-production (design/spec บริษัท) ส่งแล้ว — ไม่ใช่ gate ที่ block** ใช้เริ่ม build ได้; refine เพิ่มเติมคู่ขนาน
- **เส้นยาวสุด (internal):** T-02 → T-14 → T-31 (ทุก resource feature ขึ้นกับ resource calc) — เป็น dependency ข้ามทีม ไม่ใช่ external lead time
- **เริ่ม UAT ข้าม module ทันที R3 ปิด** ไม่รอครบทุกอย่าง; **support/hardening buffer (Q-02) อยู่ใน ต.ค.-ธ.ค. ก่อน deadline จริง**

---

## 9. สิ่งที่ทุกคนต้องรู้ (ก่อนเริ่ม)

**Engineering convention**
- Vertical ownership: 1 ทีม ถือ UI+API+data+validation+test+demo ของ slice ตน
- Shared core (auth, permission, data model, API convention, sync, deploy) แก้ได้ต่อเมื่อ Lead pair review
- 1 task (T-NN) = 1 epic/card บนบอร์ด ผูกกับ FR; DoD = UI+API+data+test+demo
- Branch: `main` production-ready, `develop` integration, `feature/*`, `release/*`; PR ต้องผ่าน lint/test/build
- Quality gates เดิม MVP: `scripts/check-backend`, `check-frontend`, `check-secrets`, `check-all`
- ID ต่อเนื่องทั้งระบบ: FR 21-56, NFR 12-26, UJ 5-10, SM 7-20 (ห้ามชน MVP 1-20)

**Data & RBAC**
- Data model ขยายแบบ **additive** — ห้ามทำลาย MVP collections; field ใหม่อิง [Data Dictionary](../../data/smart-shelter-data-dictionary.html)
- Role ใหม่: Warehouse/Supply Officer, Kitchen Lead, Volunteer Coordinator, Security Officer — enforce ที่ **backend** ทุกตัว. **Donor = no-auth public surface** (track ผ่าน `tracking_token`, ไม่ใช่ login role — FD-16). **EOC = aggregate API + API KEY** (machine-to-machine, ไม่ใช่ login role — FD-14)
- Masking/PDPA: medical + national-ID mask ตาม role; donation transparency + family search + EOC API + Open API = **aggregate/no-PII** ต้องผ่าน governance review ก่อน publish (EOC field เกิน aggregate รอ PDPA review)
- Audit: ทุก sensitive/stock/donation/referral action auditable

**Governance ownership**
- PDPA/RoPA/retention owner = ศูนย์คอมพิวเตอร์ ม.อ.
- QA/Release go-no-go = ทีม IMPS (เน็ท, ฟู่, เซียน)
- Scope/architecture/release decision = PM/SA; requirement/UAT = PO

---

## 10. Risks (top)

| Risk | Mitigation |
| --- | --- |
| build 3 เดือน (ส.ค.-ต.ค.) คุณภาพตก | คง critical bug = 0 ทุก gate; ใช้ buffer ต.ค.-ธ.ค. hardening แทนลดคุณภาพ/ตัด scope |
| ส่งไม่ครบ 100% ภายใน ต.ค. | milestone ก.ย. 80% ใช้จับ slip เร็ว; deadline จริง ธ.ค. มี buffer ปิดงานที่เหลือ |
| Platform/Core foundation ช้า block ทุกคน | Lead pair = คนเก่งสุด; freeze API contract วันแรก |
| ประเมิน MD ต่ำ (junior+ERP) | slack capacity + buffer ต.ค.-ธ.ค. เป็น absorber; ผูก deadline จริงที่ ธ.ค. |
| family search เปิดข้อมูลเกิน | governance/DPIA gate; ส่งใน R4, buffer Dec ทำ consent/masking ให้ครบก่อน publish |
| 4 ทีม + Lead pair coordination | Lead pair คุม integration แน่น; weekly burn-down ต่อทีม |

---

## 11. ต้องเคาะใน Kickoff (decisions)

| # | เรื่อง | Owner |
| --- | --- | --- |
| K-11 | ยืนยัน **deadline จริง = ธ.ค. 2026** (build R2/R3/R4 จบ ต.ค. + buffer ต.ค.-ธ.ค.) และ **milestone ก.ย. = ~80% testable** (internal checkpoint ไม่ใช่ hard finish, ไม่ตัด scope) | PM/SA + sponsor |
| K-12 | Approve **role-permission matrix full-system** ก่อนเริ่ม R2 *(phase-blocker)* | PM/SA + PO |
| K-13 | ยืนยันสมาชิกจริง (14 คน = 2 Lead + 4 ทีม×3) + จับ domain ลง D1-D4 + ใครเป็น Lead pair | Lead + PM/SA |
| K-14 | Open API contract กับ One Data / Hat Yai ROD ใคร sign-off *(R4 blocker)* | PM/SA + ศูนย์คอม |
| K-15 | Family search consent: opt-in vs opt-out + ผ่าน governance เมื่อไร | ศูนย์คอม + PO |
| K-16 | ยืนยัน estimate/AI multiplier; recalibrate หลัง velocity จริง 1-2 สัปดาห์ | Lead |

---

## 12. Kickoff Exit Criteria

- ทุกคนเห็น full scope + timeline ตรงกัน (R2-R4 build ส.ค.-ต.ค., milestone ก.ย. 80%, deadline จริง ธ.ค.)
- 2 Lead + 4 ทีม มีสมาชิกจริง + domain จับครบ D1-D4 + owner ชัด
- Decisions K-11..K-16 ปิดหรือมี owner + due
- RBAC matrix full-system มีแผน approve ก่อน R2
- ทีมเข้าใจ vertical ownership + shared-core review + branch/gate
- เริ่ม Sprint R2: Lead pair ลุย data model/RBAC, 4 ทีมเริ่ม slice/groundwork ของตน

---

## 13. Reference

| ใช้ตอบเรื่อง | เอกสาร |
| --- | --- |
| Timeline, gates, squad, ก.ย. milestone, risk | [Roadmap](roadmap.html) |
| Scope/FR/NFR ราย phase | [R2](phase-r2-foundation.html) · [R3](phase-r3-operations.html) · [R4](phase-r4-integration-handover.html) |
| Task ทุกตัว + man-power + AI uplift | [Task Breakdown](task-breakdown.html) |
| Role/action/field permission | [Role Permission Matrix](role-permission-matrix.html) |
| Squad roster (เคาะ K-13 ในห้อง) | [Squad Roster](squad-roster.html) |
| FR 1-20 baseline + UAT + open questions | [MVP PRD](../prd-smart-shelter-spec-2026-05-30/prd.html) |
| MVP open questions / decision trail | [Open Questions](../prd-smart-shelter-spec-2026-05-30/open-questions-tracking.html) · [Decision Log](../prd-smart-shelter-spec-2026-05-30/decision-log.html) |
| Field schema / data model / ERD | [Data Dictionary](../../data/smart-shelter-data-dictionary.html) · [Data Model](../../data/smart-shelter-data-model.html) · [ERD](../../data/smart-shelter-erd.html) |
| Delivery gates | [Delivery Agreement](../../delivery/project-delivery-agreement.html) |
| Team/RACI | [Team Operating Model](../../org/teams.html) |
| Engineering baseline / setup / release | [Sprint 0](../../engineering/sprint-0-start-here.md) · [Local Dev & Seed](../../engineering/local-dev-and-seed.md) · [Release Runbook](../../engineering/release-runbook.md) |
| July MVP kickoff (historical) | [legacy/mvp-kickoff](../../legacy/mvp-kickoff.html) |
| Full-project source | [proposal PDF](../../../source/psu-smart-shelter-f-20260522.pdf) |
| Decision trail | `.decision-log.md` |
