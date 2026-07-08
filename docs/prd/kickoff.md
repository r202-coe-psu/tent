---
title: "Full-System Kickoff — Smart Shelter (มิ.ย.–ก.ย. 2026 + maintenance)"
status: active
created: 2026-06-03
updated: 2026-07-07
purpose: Single source for full-scope + timeline kickoff; basis for presentation slides
note: ปรับตาม schedule decision 2026-06-09 + decision sync 2026-06-15 (teams, RBAC approved, MongoDB EOC read-model)
---

# Smart Shelter — Full-System Kickoff

เอกสาร kickoff ตัวเดียวที่รวม **scope ทั้งโครงการ + timeline + การแบ่งทีม + man-power + สิ่งที่ทุกคนต้องรู้** สำหรับประชุม kickoff (10 มิ.ย. 2026) ใช้เป็นฐานทำ slide

> รายละเอียดเจาะลึกอยู่ในเอกสารชุดเดียวกัน: [Roadmap](roadmap.html) · [R2](phase-r2-foundation.html) · [R3](phase-r3-operations.html) · [R4](phase-r4-integration-handover.html) · [Task Breakdown](../task-breakdown/_index.md) · [Dependencies & Timeline](../task-breakdown/_timeline.md)

---

## 0. ทำไมต้องมีระบบนี้

**Smart Shelter** คือระบบจัดการศูนย์พักพิงสำหรับภัยพิบัติน้ำท่วม พัฒนาโดย PSU ร่วมกับ ศูนย์คอมพิวเตอร์ ม.อ. สำหรับใช้จริงในพื้นที่เสี่ยงน้ำท่วมภาคใต้ (เน้น Hat Yai และจังหวัดใกล้เคียง) ช่วง **กันยายน–ธันวาคม** ซึ่งเป็นช่วงเสี่ยงสูงทุกปี

**ปัญหาเดิมที่ต้องแก้:** เจ้าหน้าที่ศูนย์พักพิงใช้กระดาษและ Excel บันทึกข้อมูลผู้อพยพแยกกันแต่ละศูนย์ ทำให้ไม่รู้ว่าใครอยู่ที่ไหน ซ้ำซ้อน หรือขาดหายไป และ EOC ไม่สามารถเห็นภาพรวมระดับเมือง/จังหวัดได้แบบ real-time

**สิ่งที่ระบบต้องทำได้:**
- เจ้าหน้าที่ register, screen, track movement ผู้อพยพได้แบบ real-time
- ศูนย์เดินงานประจำวัน (คลัง, ครัว, อาสาสมัคร) จากข้อมูลจริง ไม่ใช่การประมาณ
- ส่งข้อมูล aggregate ให้ EOC / Hat Yai ROD / One Data ผ่าน API (service แยก)
- ใช้งานได้แม้ network ขาด — **remote-first บน CouchDB ด้วย active endpoint model** (Central ก่อน, LAN Edge fallback เฉพาะ outage, active ได้ครั้งละ endpoint เดียว) โดย disconnected mode เป็น status-only (ไม่มี read-only local cache) และใช้ retry policy กลางระบบ (auto 3 attempts, then cannot-connect banner, force retry) — และมี fallback เป็น Excel import

**สถานะปัจจุบัน (greenfield):** ยังไม่มีระบบใช้งานจริงมาก่อน — มี **CouchDB PoC**, design package P-01 (ส่งแล้ว), feature specs ([`docs/features/`](../features/index.html)) และ technical source [`schema.md`](../data/schema.md) / [`data-model.md`](../data/data-model.md) / [`api-contract.md`](../data/api-contract.md) เป็นจุดตั้งต้น ทุกอย่างต้อง build ภายใน **มิ.ย.–ส.ค. 2026** เพื่อ **go-live full program ก.ย.** ก่อนฤดูเสี่ยง จากนั้นรับ feedback + แก้ไขจนครบกำหนดโครงการ **12 เดือน**

---

## 0.1 เป้าหมายประชุม Kickoff นี้

**ต้องได้จากการประชุม:**
- ทุกคนเห็น full scope + timeline ตรงกัน (build มิ.ย.–ส.ค., go-live ก.ย., hard deadline งาน feature 14 ก.ย.)
- ใช้ domain/team assignment ที่ปิด K-13 แล้วเป็น owner canonical ทุก domain
- ปิด decisions K-11..K-17 หรือมี owner + due date ชัดเจน
- ทีมเข้าใจ vertical ownership + shared core review + quality gate ก่อนเริ่ม build

**ต้องกันออกและไม่ debate ใน Kickoff:**
- Requirement ใหม่ที่ไม่อยู่ใน scope ที่กำหนดไว้แล้ว → เข้า change control ก่อน
- รายละเอียด implementation ระดับ API/schema → เป็น task ของ Lead pair หลัง kickoff
- SOP authoring, co-design, training content → context นอกระบบ ไม่ใช่ scope ของทีม dev

---

## 1. TL;DR (สรุป 1 หน้า)

| หัวข้อ | สาระ |
| --- | --- |
| **ทำอะไร** | build **full software platform จากศูนย์ (greenfield)**: Baseline registration-first (FR-1–20), Household, Inventory, Donation, Kitchen, Volunteer, SOP, Security, Referral, Family Search + (deferred) EOC/Open API |
| **เมื่อไร** | **build = มิ.ย.–ส.ค. 2026** · in-scope ส่งมอบ **31 ส.ค.** · **go-live full program ก.ย.** (สัปดาห์ 1) · deferred tail ≤ **14 ก.ย.** (hard deadline งาน feature) |
| **หลัง go-live** | รับ feedback + แก้ไข (maintenance) จนครบกำหนดโครงการ **12 เดือน** — ไม่มี feature ใหม่หลัง 14 ก.ย. |
| **ใคร** | นักศึกษา **14 คน = 2 Lead (Platform/Core) + 4 ทีม × 3** — Lead แจ็ก/เด่น; Team A Donation+Volunteer; Team B People+Family Search+Security; Team C Supply+Kitchen; Team D SOP+Referral |
| **stack หลัก** | **remote-first บน CouchDB ด้วย active endpoint model** (Central-first, Edge fallback เมื่อจำเป็น, active endpoint เดียวต่อช่วงเวลา, disconnected status-only (no read-only local cache)); public tier และ EOC/Open API read-model ใช้ **MongoDB projection** จาก Central CouchDB |
| **scope** | in-scope ส.ค.: Baseline + R2 + R3 + Family Search + governance · deferred ≤14 ก.ย.: EOC aggregate API, Open API, SOP simulation, inventory polish |
| **งานรวม** | นักศึกษา (prod+post) **250 Adj MD** หลัง AI uplift + pre-production บริษัท 30 — ดู [Task Breakdown](../task-breakdown/_index.md) |
| **แบ่งงาน** | **Pre-production = บริษัท** (UX/design/spec — P-01 ส่งแล้ว, P-02 ก่อน ก.ค.); **Production + Post = นักศึกษา 2 Lead + 4 ทีม** |

**Thesis:** greenfield + ฤดูเสี่ยงน้ำท่วมเริ่ม ก.ย. → ต้อง build ให้จบใน มิ.ย.–ส.ค. ด้วย walking skeleton จาก Lead pair + 4 ทีมรันขนานตาม dependency; ตัด EOC/Open API/SOP simulation เป็น deferred tail หลัง go-live (≤14 ก.ย.) แล้วใช้ช่วงที่เหลือของโครงการ (จนครบ 12 เดือน) รับ feedback จากการใช้งานจริงช่วงฤดูเสี่ยง

---

## 2. เรามาถึงไหนแล้ว → จะไปไหนต่อ

**มีแล้ววันนี้:**
- **CouchDB PoC** — พิสูจน์การ sync เบื้องต้น (ยังไม่ใช่ระบบใช้งานจริง; production topology ต้องเป็น remote-first active endpoint: Central-first + Edge fallback เท่านั้น)
- **Design package P-01** (บริษัท — ส่งแล้ว): UX/wireframe household/zoning/inventory/donation, role-permission matrix, API spec
- **Feature specs baseline FR-1–20** ใน [`docs/features/`](../features/index.html) + [Database Schema](../data/schema.md) / [Data Model](../data/data-model.md) / [API Contract](../data/api-contract.md)

**ยังไม่มี:** โค้ดระบบจริงทุกส่วน — **baseline FR-1–20 (registration-first) คือสิ่งแรกที่ต้อง build** (T-47..T-55, [module 0](../task-breakdown/00-baseline.md)) ต่อจาก walking skeleton ของ Lead pair

> **Baseline scope (FR 1-20):** Registration-first, Person-only. E2E flow: login (role+shelter scope) → register Person (`first_name` + `last_name` + `gender` + `phone`; phone required in UI แต่เลือก/กรอก "ไม่มี" แล้วเก็บ `null` ได้) → screening/vulnerability/medical/fast-track ตามสิทธิ์ → Person Shelter ID/QR → search/scan check-in → check-out + occupancy guardrail (warning-only) → Dashboard v1 (occupancy, capacity, vulnerable/fast-track count, medical summary, in/out today) → export ตาม shelter/date/role พร้อม audit+redaction ตาม role/tier → disconnected status-only สำหรับ registration/screening (ไม่มี read-only local cache) + automatic retry 3 attempts แล้วแสดง cannot-connect banner พร้อม force retry + manual/Excel fallback + assisted import.
> **Data contract:** doc types หลักตาม [Database Schema](../data/schema.md) และ [Data Model](../data/data-model.md). Public/FAM/API/EOC ไม่ส่ง medical หรือ national ID; QR payload ไม่มี PII/health. **Central CouchDB = source of truth**; write path เป็น remote-first ไปยัง active endpoint เดียว (Central ก่อน, LAN Edge fallback ตอน WAN/Central ล่ม) โดย disconnected mode เป็น status-only (ไม่มี read-only local cache). Public tier และ EOC/Open API ใช้ MongoDB projection แยกจาก Central CouchDB

### Baseline acceptance scenarios (FR-1–20) — เกณฑ์รับ baseline + smoke test ทุก gate

Baseline build เสร็จเมื่อ scenarios เหล่านี้ผ่าน และทุก build หลังจากนั้นต้องไม่ทำให้พัง (ใช้เป็นชุด smoke test ก่อน gate ทุก phase):

1. เจ้าหน้าที่ login ตาม role และ shelter scope ที่กำหนด
2. ลงทะเบียน Person ด้วย required fields ขั้นต่ำ (`first_name` + `last_name` + `gender` + `phone|null`)
3. บันทึก screening / vulnerability flags / medical notes / fast-track ตามสิทธิ์ของ role
4. สร้าง Shelter ID / QR ระดับ Person
5. ค้นหา Person หรือ scan QR เพื่อ check-in
6. check-out → movement history และ occupancy guardrail (warning-only) ถูกต้อง
7. Dashboard v1 แสดง occupancy, capacity, vulnerable count, fast-track count, medical summary, in/out today และ last updated
8. Export ตาม shelter / date / role พร้อม audit log และ masking ตาม role
9. Endpoint switch / draft fallback ไม่ทำข้อมูลหายหรือซ้ำ: Central online write/sync ไป Central เท่านั้น, Central down + LAN Edge write/sync ไป Edge เท่านั้น, กรณีไม่มี remote ให้เข้า disconnected status-only (ไม่มี read-only local cache), automatic retry 3 attempts แล้วแสดง cannot-connect banner พร้อม force retry; failback กลับ Central ไม่สร้าง duplicate และมี assisted import path

**เป้าหมายทั้งโครงการ:** ทุกอย่างที่ proposal วางไว้ — Baseline + Household, zoning, คลังสิ่งของ, donation อัจฉริยะ, ครัวกลาง, อาสาสมัคร, SOP calculator, security, referral, family search + (deferred) EOC aggregate API / Open API

---

## 3. Full Scope Map (ภาพรวมทั้งระบบ)

| Layer | Module | ช่วง build | สถานะ |
| --- | --- | --- | --- |
| Front | **Baseline: Person registration + screening + QR + check-in + dashboard + offline** | มิ.ย.–ก.ค. | 🔜 build ก่อนทุกอย่าง |
| Front | **Household + zoning + pets/assets** | มิ.ย.–ก.ค. (R2) | 🔜 |
| Back | **Module C: Inventory/Supply** (รับ/แจก/โอน, stock dashboard) | มิ.ย.–ก.ค. (R2) | 🔜 |
| Back | **Donation** (intake → reservation/cut-off/redirect/transparency) | R2→R3 | 🔜 |
| Back | **Module D: Kitchen & Food** (meal plan, requisition, service) | ก.ค.–ส.ค. (R3) | 🔜 |
| Back | **Module A: Volunteer** (register, skill match, shift) | ก.ค.–ส.ค. (R3) | 🔜 |
| Back | **Module B: SOP Resource Calculator** | ก.ค.–ส.ค. (R3) | 🔜 |
| Back | **Module E: Security** + **Module F: Referral** | ก.ค.–ส.ค. (R3) | 🔜 |
| Top | **Public family search** (privacy-preserving) + RoPA minimal | ส.ค. (R4 in-scope) | 🔜 |
| Top | **EOC aggregate API + Open API** → One Data / Hat Yai ROD *(service แยก, FD-14)* | deferred ≤14 ก.ย. | 🔜 |
| Cross | Cross-module UAT, hardening, handover | ส.ค. | 🔜 |

**Non-goals (ทั้งโครงการ):** ระบบเตือนภัยน้ำท่วมต้นน้ำ (Hat Yai ROD ทำ — เราส่ง data ให้), ERP การเงิน/HR, full offline sync ทุก module, hardware/IoT/VHF automation, recovery-phase (อาชีพ/ปิดศูนย์ระยะยาว), native mobile app

---

## 4. Timeline (canonical — [_timeline.md](../task-breakdown/_timeline.md))

| ช่วง | Gate / Milestone | Scope หลัก | FR |
| --- | --- | --- | --- |
| 10 มิ.ย. | Kickoff Lead — walking skeleton เริ่มทันที | repo/CI, auth/RBAC skeleton, CouchDB schema + sync design, 1 vertical slice | — |
| 17 มิ.ย. | Workshop — 4 ทีมเริ่มงาน | Baseline + R2 ขนาน | 1–20 |
| มิ.ย.–ก.ค. | **Foundation Gate 17 ก.ค.** | Baseline เต็ม + Household, Zoning, Inventory(C), Donation intake, RBAC ext | 1–34 |
| ก.ค.–ส.ค. | **Operations Gate 22 ส.ค.** | Donation full, Kitchen(D), Volunteer(A), SOP(B), Security+Referral(E+F) | 35–48 |
| ส.ค. (ขนาน) | — | Family search + consent, RoPA minimal, cross-module UAT, hardening, handover | 52, 53, 55, 56 |
| **31 ส.ค.** | **In-scope ส่งมอบ** | ทั้งหมดข้างต้นครบ | — |
| **ก.ย. wk1** | **Go-live full program** | ใช้งานจริงก่อนฤดูเสี่ยง | — |
| **≤14 ก.ย.** | **Hard deadline งาน feature** | deferred: EOC aggregate API, Open API, SOP simulation, inventory polish | 49–51, 54 |
| หลัง 14 ก.ย. → ครบ 12 เดือน | สิ้นสุดโครงการ | feedback + แก้ไข (maintenance) — ไม่มี feature ใหม่ | — |

ทุก gate ต้องผ่าน: automated checks + staging UAT + **critical bug = 0** + backup/rollback readiness

---

## 5. เจาะราย Phase

### R2 — Foundation (มิ.ย.–ก.ค. · Foundation Gate 17 ก.ค.)

- **เป้า:** build baseline (registration-first) + ปูฐานหลังบ้าน — ผูกคนเป็นครัวเรือน+จัดโซน, เปิดคลังกลางเห็น stock real-time, รับ donation เข้าคลัง
- **ส่งมอบ:** Baseline FR-1–20 เต็ม (T-47..55), Household reg + QR/search/check-in, zoning, pet/asset, supply catalog + receive/distribute/transfer + stock dashboard + reorder threshold, donor pre-declaration, RBAC role/shelter-scope enforcement
- **Gate:** Foundation — baseline acceptance scenarios ผ่าน, stock dashboard reconcile กับ ledger, household check-in ถูกต้อง
- **คอขวด:** Lead pair ต้องปิด data model (T-02) + RBAC (T-01) ให้ไว ทุกทีมขึ้นกับมัน; **T-54 Central-first offline sync/failback = tech risk #1**

### R3 — Operations (ก.ค.–ส.ค. · Operations Gate 22 ส.ค. · phase หนักสุด)

- **เป้า:** ศูนย์เดินงานประจำวันได้จริง — donation ไม่ล้น (cut-off+redirect), ครัววางแผนจากยอดจริง, อาสาจับคู่ทักษะ, SOP บอกความต้องการรายวัน
- **ส่งมอบ:** donation reservation/cut-off/redirect/transparency, meal plan+requisition+service, volunteer+skill match, SOP ratio+resource calc+dashboard, security event, referral
- **Gate:** Operations — cut-off+redirect ทำงาน, kitchen requisition ตัด stock ถูก, resource calc ตรง occupancy×ratio
- **คอขวด:** 5 module-group ขนานพร้อมกัน; SOP calc (T-31) อยู่ปลายสุดของ logic chain → เริ่ม data contract แต่ต้น phase; **P-02 design ต้องเสร็จก่อน ก.ค.**

### R4 — Integration & Handover (in-scope ส.ค. · deferred ≤14 ก.ย.)

- **In-scope (ส.ค.):** consent/opt-out + privacy-preserving family search, RoPA/retention minimal (T-43 — บังคับเพราะ family search เปิด public), cross-module UAT + hardening + handover package
- **Deferred (หลัง go-live, ≤14 ก.ย.):** EOC aggregate API + API-key principal (FD-14, service แยก), Open API tier, SOP simulation, inventory polish
- **Gate:** Final Handover — UAT ข้าม module critical bug = 0, backup/restore tested, handover package ครบ
- **คอขวด:** EOC API รอ R3 producer ครบ; T-44 (UAT+handover 9 MD) เป็น single task ยาวสุด เริ่มทันที R3 ปิด

---

## 6. Team Model — 2 Lead + 4 ทีม × 3 / 14 คน

**โครงสร้าง: 2 Lead (Platform/Core, floating) + 4 ทีมโดเมน × 3 คน.** K-13 ปิดแล้ว — ดู [Squad Roster](squad-roster.html)

| หน่วย | คน | Domain | Active |
| --- | --- | --- | --- |
| **Lead pair** Platform/Core ⭐ | 2 | แจ็ก/เด่น — auth, RBAC, data model, shared API, remote-first CouchDB active-endpoint orchestration (Central-first + Edge fallback), DevOps, integration + integrator/review; EOC deferred owner | ตลอด |
| **Team A** | 3 | ชิโน/นัท/กาน — Donation + Volunteer | R2-R3 |
| **Team B** | 3 | พีค/โฮป/ปิ๊ก — People/Household + Family Search + Security | R2-R4 |
| **Team C** | 3 | ก้อง/มิว/พัฟ — Supply/Inventory + Kitchen/Food | R2-R3 |
| **Team D** | 3 | เน/ภูดิท/วิลเลียม — SOP/Resource Calc + Referral; support EOC after SOP/Referral stabilized | R2-R4 |

**Domain load (โหลด Adj MD prod+post จาก [Task Breakdown](../task-breakdown/_index.md)):**

| Domain | Adj MD | dependency note |
| --- | --- | --- |
| People & Search (+ งาน baseline registration หลัก) | 29 (+ ส่วน baseline 37*) | เส้นหลัก flow หน้างาน; family search ส.ค. |
| Supply & Inventory | 19.5 | คู่กับ Kitchen (FD-10) |
| Donation | 24.5 | feed inventory |
| Kitchen & Food | 15.5 | ขึ้นกับ Supply (requisition) |
| Volunteer & SOP | 24.5 | SOP calc ขึ้นกับ resource (T-31) |
| Security/Referral/EOC | 26 | EOC = aggregate API service แยก (FD-14), deferred |
| _Platform/Core (Lead pair)_ | 58 | คอขวด ทุกทีมขึ้นกับ |
| _Q-02 support buffer_ | 15.5 | เฉลี่ยทุกทีม |
| **รวม** | **250** | |

`*` baseline (T-47..55, 37 MD) กระจายให้ Team B + Lead pair + ทีมอื่นช่วยตาม slice

**ข้อควรจัดการ:**
- **Pre-production (บริษัท): P-01 ส่งแล้ว ไม่ block; P-02 ต้องเสร็จก่อน ก.ค.** มิฉะนั้นทีมรอ design
- มิ.ย.–ก.ค.: ทีมที่ยังไม่มี module หลัก (Kitchen/Volunteer/Security) → มอบ **groundwork จริง** (schema, prototype, เก็บค่า SOP) อย่าให้ idle
- ทีม 3 คน ต้อง cross-train ในทีม; **Lead pair floating** ช่วยทีมที่ติด dependency

---

## 7. Man-Power + AI Uplift

ทุกคนมี AI agent (Cursor $20 / Copilot Education / Gemini Antigravity IDE 2.0) ใช้ตัวคูณตาม **ชนิดงาน** — AI เร่ง implementation มาก แต่ **ไม่เร่ง** coordination, PDPA/governance, stakeholder sign-off

| ชนิดงาน | AI× | | ชนิดงาน | AI× |
| --- | --- | --- | --- | --- |
| Design/UX/spec | ÷1.2 | | Algorithm/logic | ÷1.4 |
| Implementation | ÷1.6 | | Testing/UAT/bugfix | ÷1.3 |
| Data/integration | ÷1.25 | | Governance/docs | ÷1.1 |

**ผล:** นักศึกษา (prod+post) **250 Adj MD** (รวม baseline 37) + pre-production บริษัท 30 — รายละเอียด task-by-task ใน [Task Breakdown](../task-breakdown/_index.md); estimate recalibrate หลัง velocity จริง 1–2 สัปดาห์แรก (K-16)

---

## 8. Critical Path & Dependencies

```
skeleton (T-01/02/03) ─> baseline (T-47..55 ขนาน) ─> occupancy/movement data
T-02 data model ─> T-11 stock ─> T-14 dashboard ─┬─> donation cut-off/redirect (R3)
                                                 ├─> T-31 resource calc ─> meal plan
                                                 └─> volunteer demand
all build ─> T-44 cross-module UAT + handover ─> ส่งมอบ 31 ส.ค. ─> go-live ก.ย.
all R3 producers ─> (deferred ≤14 ก.ย.) T-37 EOC API ─> T-39 Open API
```

- **เส้นวิกฤต (in-scope):** skeleton → T-11 → T-14 → T-31 → T-25 → T-26/27 → (R3 gate) → T-44 → 31 ส.ค.
- **Baseline + Family Search = branch ขนาน** ไม่ทำให้เส้นวิกฤตยาวขึ้น แต่ baseline ต้องจบใน Foundation Gate
- **เริ่ม UAT ข้าม module ทันที R3 ปิด** ไม่รอครบทุกอย่าง

---

## 9. สิ่งที่ทุกคนต้องรู้ (ก่อนเริ่ม)

**Engineering convention**
- Vertical ownership: 1 ทีม ถือ UI+API+data+validation+test+demo ของ slice ตน
- Shared core (auth, permission, data model, API convention, sync, deploy) แก้ได้ต่อเมื่อ Lead pair review
- 1 task (T-NN) = 1 epic/card บนบอร์ด ผูกกับ FR; DoD = UI+API+data+test+demo
- Branch: `main` production-ready, `develop` integration, `feature/*`, `release/*`; PR ต้องผ่าน lint/test/build
- Quality gates (lint/test/build/secret-scan) ตั้งใน CI ตั้งแต่ walking skeleton — Lead pair เจ้าของ
- ID ทั้งระบบ: FR 1-56, NFR 1-26, UJ 1-10, SM 1-20 (baseline = 1-20 ต้อง build เหมือน FR อื่น)

**Data & RBAC**
- **Central CouchDB = source of truth, remote-first write path** (active endpoint เดียว: Central ก่อน, Edge fallback เมื่อจำเป็น; ห้าม active พร้อมกัน). disconnected mode เป็น status-only (ไม่มี read-only local cache); schema อิง [Database Schema](../data/schema.md) + [Data Model](../data/data-model.md); ออกแบบ baseline collections ให้ต่อยอด R2-R4 ได้โดยไม่ destructive migration. LAN Edge เป็น fallback replica เฉพาะตอน WAN/Central ล่ม และ public/no-login endpoints ไม่ fallback ไป Edge
- Internal roles: 5 role ตาม [Role Permission Matrix](role-permission-matrix.html) — enforce ที่ **backend** ทุกตัว. **Donor = no-auth public surface** (track ผ่าน `tracking_token`, ไม่ใช่ login role — FD-16). **EOC = aggregate API + API KEY** (machine-to-machine, service แยก, ไม่ใช่ login role — FD-14)
- Visibility/PDPA: internal authenticated staff เห็น medical ตาม shelter scope; family search + donation transparency + EOC/Open API = **aggregate/masked/no medical/no national ID** ต้องผ่าน data-governance review ก่อน publish
- Audit: ทุก sensitive/stock/donation/referral action auditable

**Governance ownership**
- PDPA/RoPA/retention owner = ศูนย์คอมพิวเตอร์ ม.อ.
- QA/Release go-no-go = ทีม IMPS (เน็ท, ฟู่, เซียน)
- Scope/architecture/release decision = PM/SA; requirement/UAT = PO

---

## 10. Risks (top)

| Risk | Mitigation |
| --- | --- |
| Greenfield + build บีบ มิ.ย.–ส.ค. | walking skeleton ให้ pattern เดียวกัน; คง critical bug = 0 ทุก gate; maintenance period รองรับหลัง go-live |
| CouchDB sync/conflict/failback (tech risk #1) | Lead B เจ้าของ T-02/T-54; เริ่มทันทีหลัง skeleton; ทดสอบ Central success, Edge fallback, disconnected status-only (no read-only local cache), auto-retry 3 attempts + cannot-connect banner + force retry, failback และ conflict ใน Foundation Gate |
| Platform/Core foundation ช้า block ทุกคน | Lead pair = คนเก่งสุด; freeze API contract วันแรก |
| ประเมิน MD ต่ำ (junior + part-time academic) | recalibrate หลัง 1–2 สัปดาห์ (K-16); deferred tail = buffer แรก |
| P-02 design ส่งช้า | บริษัท commit ก่อน ก.ค.; ทีมขึ้น R3 ~ต้น ก.ค. |
| family search เปิดข้อมูลเกิน | T-43 RoPA minimal ใน scope ส.ค.; governance/DPIA gate ก่อน publish |
| 4 ทีม + Lead pair coordination | Lead pair คุม integration แน่น; weekly burn-down ต่อทีม |

---

## 11. ต้องเคาะใน Kickoff (decisions)

| # | เรื่อง | สถานะ | Owner |
| --- | --- | --- | --- |
| K-11 | Deadline + scope split | ✅ **ปิดแล้ว (schedule decision 2026-06-09):** in-scope 31 ส.ค., go-live ก.ย., hard deadline งาน feature 14 ก.ย., maintenance จนครบโครงการ 12 เดือน | PM/SA + sponsor |
| K-12 | Approve **role-permission matrix full-system** ก่อนเริ่ม build *(phase-blocker)* | ✅ Approved 5-role matrix ([matrix](role-permission-matrix.html)) | PM/SA + PO |
| K-13 | ยืนยันสมาชิกจริง (14 คน = 2 Lead + 4 ทีม×3) + จับ domain ลง D1-D4 + ใครเป็น Lead pair | ✅ ปิดแล้ว — Lead แจ็ก/เด่น; Team A-D ตาม [Squad Roster](squad-roster.html) | Lead + PM/SA |
| K-14 | Open API contract กับ One Data / Hat Yai ROD ใคร sign-off *(deferred-tail blocker)* | เปิดแบบมี owner — PM/SA + ศูนย์คอม; implementation รอ P-03 contract/sign-off | PM/SA + ศูนย์คอม |
| K-15 | Family search consent: opt-in vs opt-out | ✅ ปิดแล้ว — **opt-out** (CONFIRMED T3, matrix §7.3) | ศูนย์คอม + PO |
| K-16 | ยืนยัน estimate/AI multiplier; recalibrate หลัง velocity จริง 1-2 สัปดาห์ (รวม estimate baseline T-47..55) | เปิดแบบควบคุม — ใช้ Adj MD ปัจจุบันเป็น baseline planning แล้ว recalibrate หลัง sprint แรก | Lead |
| K-17 | Datastore ของ EOC aggregate read-model | ✅ ปิดแล้ว — MongoDB projection จาก Central CouchDB | PM/SA + Lead |

---

## 12. Kickoff Exit Criteria

- ทุกคนเห็น full scope + timeline ตรงกัน (build มิ.ย.–ส.ค., go-live ก.ย., feature freeze 14 ก.ย., maintenance → 12 เดือน)
- 2 Lead + 4 ทีม มีสมาชิกจริง + domain จับครบ D1-D4 + owner ชัด (ปิด K-13)
- Decisions K-12..K-17 ปิดหรือมี owner + due
- RBAC matrix full-system approved ก่อนทีมขึ้น feature ที่พึ่ง permission ใหม่
- ทีมเข้าใจ vertical ownership + shared-core review + branch/gate
- เริ่มทันที: Lead pair ลุย walking skeleton (data model/RBAC/remote-first CouchDB active-endpoint + Edge fallback), 4 ทีมเตรียมเข้า workshop 17 มิ.ย.

---

## 13. Reference

| ใช้ตอบเรื่อง | เอกสาร |
| --- | --- |
| Timeline, gates, team, dependency, risk | [Roadmap](roadmap.html) · [Dependencies & Timeline](../task-breakdown/_timeline.md) |
| Scope/FR/NFR ราย phase | [R2](phase-r2-foundation.html) · [R3](phase-r3-operations.html) · [R4](phase-r4-integration-handover.html) |
| Task ทุกตัว + man-power + AI uplift | [Task Breakdown by Module](../task-breakdown/_index.md) |
| Baseline FR-1–20 spec | [`docs/features/`](../features/index.html) · [Baseline tasks](../task-breakdown/00-baseline.md) |
| Role/action/field permission | [Role Permission Matrix](role-permission-matrix.html) |
| Squad roster (K-13 closed) | [Squad Roster](squad-roster.html) |
| Field schema / data model / API contract | [Database Schema](../data/schema.md) · [Data Model](../data/data-model.md) · [API Contract](../data/api-contract.md) |
| Full-project source | [proposal PDF](../source/psu-smart-shelter-f-20260522.pdf) |
