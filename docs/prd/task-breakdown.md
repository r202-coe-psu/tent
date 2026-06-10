---
title: "Master Task Breakdown & Man-Power Plan (R2-R4, full lifecycle)"
status: draft
created: 2026-06-03
updated: 2026-06-03
team: 14 students / 7 squads + company (pre-production)
---

# Master Task Breakdown & Man-Power Plan

## 0. Purpose

เอกสารนี้รวบ **task ทั้งหมดของส่วน software (R2-R4 build / Aug-Oct, deadline จริง ธ.ค.) ครบทั้ง 3 ช่วง lifecycle** เป็น work breakdown structure (WBS) พร้อมประมาณ man-power ผู้อ่านคือ Student Lead Dev, squad owners, PM/SA สำหรับวางบอร์ดและตรวจ feasibility

**การแบ่งความรับผิดชอบ:**
- **Pre-production = บริษัทจัดการ** (UX/wireframe, prototype approval, requirement, architecture, API/governance spec) — **ส่งแล้ว กำลัง refine ไม่ block**; **ไม่นับใน capacity ของนักศึกษา 14 คน**
- **Production + Post-production = นักศึกษา 7 squad** (build + UAT/hardening/deploy/support/handover) โดยบริษัทถือ QA/Release go-no-go

ตัวละคร/ชื่อจริงต่อ squad เว้นไว้จับใน kickoff (ดู K-13) เอกสารนี้ระดับ squad ตัวเลขทั้งหมด generate จาก `_tasks.py` (แก้ที่เดียว rerun `gen.py`)

ทุก task map กลับ FR ใน PRD ราย phase ([R2](phase-r2-foundation.html) · [R3](phase-r3-operations.html) · [R4](phase-r4-integration-handover.html))

## 1. Estimation Method

### 1.1 หน่วยและ capacity

- หน่วย = **man-day (MD)** = 1 คนทำงาน 1 วัน
- นักศึกษาเต็มเวลา Aug-Oct, **capacity = 16 effective MD/คน/เดือน** (5 วัน/สัปดาห์ × 4 − ~20% coordination/review/rework)
- 1 squad = 2 คน = **32 MD/เดือน**; 7 squad = **224 MD/เดือน** = **672 MD ตลอด 3 เดือน**
- [ASSUMPTION] นักศึกษา junior — velocity จริงต่ำกว่ามือโปร; slack capacity เป็น buffer learning curve/rework
- Pre-production เป็นทรัพยากร**แยก**ของบริษัท (PM/SA/PO/designer) ไม่กิน 672 MD ของนักศึกษา

### 1.2 AI productivity multiplier

นักศึกษาทุกคนมี AI agent (Cursor $20 / Copilot Education / Gemini Antigravity IDE 2.0) ตัวคูณต่าง **ตามชนิดงาน** AI ไม่เร่ง coordination, stakeholder sign-off, PDPA/governance, UX sign-off loop

| ชนิดงาน | AI× (หาร raw) | | ชนิดงาน | AI× |
| --- | --- | --- | --- | --- |
| Design/UX/spec | ÷1.2 | | Algorithm/logic | ÷1.4 |
| Implementation | ÷1.6 | | Testing/UAT/bugfix | ÷1.3 |
| Data/integration | ÷1.25 | | Governance/docs | ÷1.1 |

> Adj MD = Raw ÷ multiplier (ปัด 0.5)

## 2. Lifecycle Summary

| Stage | Owner | Raw MD | Adj MD (หลัง AI) |
| --- | --- | --- | --- |
| Pre-production | บริษัท | 36 | 30 |
| Production | นักศึกษา (7 squad) | 217 | 153 |
| Post-production | นักศึกษา + บริษัท QA/Release | 71 | 59.5 |
| **รวม full lifecycle** | | **324** | **242.5** |
| _นักศึกษาเท่านั้น (prod+post)_ | _14 คน_ | _288_ | _212.5_ |

**อ่าน:** งานนักศึกษา **212.5 Adj MD** กระจาย 3 เดือน เทียบ capacity 672 MD → util รวม ~**32%** (slack สูง = buffer) งานบริษัท (pre) 30 MD แยกต่างหาก มี **lead time** ต้องเสร็จก่อนแต่ละ phase

## 3. Work Breakdown Structure

Stage: pre (บริษัท) / prod / post Adj MD = แรงจริงหลัง AI Depends = task ที่ต้องเสร็จก่อน

### R2 tasks

| ID | Task | Stage | Owner | Raw MD | AI× | Adj MD | Depends | FR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-01 | R2 design package: UX/wireframe (household, zoning, inventory, donation), prototype approval, role-permission matrix full-system, API spec | pre | บริษัท | 12 | ÷1.2 | 10 | - | FR-21..34 |
| T-01 | RBAC extension: new roles + field-level permissions | prod | S1 | 8 | ÷1.25 | 6.5 | P-01 | FR-34 |
| T-02 | Data-model expansion (household, zone, supply, ledger, donation) — additive | prod | S1 | 10 | ÷1.25 | 8 | P-01 | FR-34 |
| T-03 | Shared API convention + contract freeze for phase | prod | S1 | 4 | ÷1.25 | 3 | P-01 | - |
| T-04 | Household create + attach members + head | prod | S2 | 6 | ÷1.6 | 4 | T-02 | FR-21 |
| T-05 | Household Shelter ID/QR generation | prod | S2 | 4 | ÷1.6 | 2.5 | T-04 | FR-22 |
| T-06 | Household search + household check-in/out | prod | S2 | 6 | ÷1.6 | 4 | T-05 | FR-23 |
| T-07 | Pet / asset / vehicle records | prod | S2 | 3 | ÷1.6 | 2 | T-04 | FR-24 |
| T-08 | Zone definition + capacity | prod | S2 | 4 | ÷1.6 | 2.5 | T-02 | FR-25 |
| T-09 | Zone allocation + suggest (warning-only) | prod | S2 | 5 | ÷1.4 | 3.5 | T-08 | FR-26 |
| T-10 | Supply Item catalog (master) | prod | S3 | 3 | ÷1.6 | 2 | T-02 | FR-27 |
| T-11 | Stock receive (inbound) + ledger write | prod | S3 | 4 | ÷1.6 | 2.5 | T-10 | FR-28 |
| T-12 | Stock distribute (outbound) | prod | S3 | 4 | ÷1.6 | 2.5 | T-11 | FR-29 |
| T-13 | Inter-shelter transfer + receive confirm | prod | S3 | 6 | ÷1.4 | 4.5 | T-11 | FR-30 |
| T-14 | Stock dashboard + reorder threshold | prod | S3 | 6 | ÷1.6 | 4 | T-11 | FR-31 |
| T-15 | Donor pre-declaration (QR/form, no-auth: tracking_token + phone OTP + rate-limit/CAPTCHA) | prod | S4 | 5 | ÷1.6 | 3 | T-11 | FR-32 |
| T-16 | Donation intake audit trail | prod | S4 | 4 | ÷1.25 | 3 | T-15 | FR-33 |
| T-17 | Groundwork: kitchen schema + Inventory linkage spike | prod | S5 | 6 | ÷1.25 | 5 | T-02 | prep R3 |
| T-18 | Groundwork: SOP ratio data gathering + volunteer schema | prod | S6 | 6 | ÷1.25 | 5 | T-02 | prep R3 |
| T-19 | Groundwork: security/referral design + event schema | prod | S7 | 6 | ÷1.25 | 5 | T-02 | prep R3 |
| T-20 | R2 integration + Backoffice Foundation Gate UAT | post | S1 | 5 | ÷1.3 | 4 | all R2 | gate |
| | **R2 total (all stages)** | | | **117** | | **86.5** | | |

### R3 tasks

| ID | Task | Stage | Owner | Raw MD | AI× | Adj MD | Depends | FR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-02 | R3 design package: UX/wireframe (donation flows, kitchen, volunteer, SOP, security, referral), prototype approval, API spec | pre | บริษัท | 14 | ÷1.2 | 11.5 | - | FR-35..48 |
| T-21 | Donation reservation (quota vs stock, no-auth via tracking_token + TTL) | prod | S4 | 5 | ÷1.4 | 3.5 | T-14,T-16 | FR-35 |
| T-22 | Donation cut-off (auto close at target) | prod | S4 | 4 | ÷1.4 | 3 | T-21 | FR-36 |
| T-23 | Smart redirect to under-threshold shelters | prod | S4 | 5 | ÷1.4 | 3.5 | T-22,T-14 | FR-37 |
| T-24 | Donation transparency report (24h, public, QR) | prod | S4 | 6 | ÷1.6 | 4 | T-16 | FR-38 |
| T-25 | Meal plan from occupancy x SOP ratio | prod | S5 | 6 | ÷1.4 | 4.5 | T-17,T-31 | FR-39 |
| T-26 | Kitchen requisition (deduct stock) | prod | S5 | 5 | ÷1.6 | 3 | T-25,T-12 | FR-40 |
| T-27 | Meal service record (served / waste / external) | prod | S5 | 5 | ÷1.6 | 3 | T-26 | FR-41 |
| T-28 | Volunteer registration + skills + availability | prod | S2 | 5 | ÷1.6 | 3 | T-18 | FR-42 |
| T-29 | Skill match + task/shift assignment | prod | S6 | 6 | ÷1.4 | 4.5 | T-28 | FR-43 |
| T-30 | SOP ratio configuration | prod | S6 | 4 | ÷1.6 | 2.5 | T-18 | FR-44 |
| T-31 | Daily resource calculation engine | prod | S6 | 7 | ÷1.4 | 5 | T-30,T-14 | FR-45 |
| T-32 | Resource calculation dashboard | prod | S6 | 5 | ÷1.6 | 3 | T-31 | FR-46 |
| T-33 | Security check-in/out + safety monitoring (people+pets) | prod | S7 | 6 | ÷1.6 | 4 | T-19 | FR-47 |
| T-34 | Referral & hand-off (capacity/resource/medical) | prod | S7 | 6 | ÷1.6 | 4 | T-19 | FR-48 |
| T-35 | Resource-calc backbone + read-model perf (cross-squad) | prod | S1 | 6 | ÷1.25 | 5 | T-31 | NFR-18,21 |
| T-36 | R3 integration + Operations Gate UAT | post | S1 | 6 | ÷1.3 | 4.5 | all R3 | gate |
| | **R3 total (all stages)** | | | **101** | | **71.5** | | |

### R4 tasks

| ID | Task | Stage | Owner | Raw MD | AI× | Adj MD | Depends | FR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-03 | R4 design package: UX/wireframe (EOC, family search), Open API contract w/ One Data, DPIA + governance for family search | pre | บริษัท | 10 | ÷1.2 | 8.5 | - | FR-49..56 |
| T-37 | EOC city/province aggregate dashboard | prod | S7 | 8 | ÷1.6 | 5 | all R3 | FR-49 |
| T-38 | Role-scoped EOC views (hierarchy) | prod | S7 | 4 | ÷1.6 | 2.5 | T-37 | FR-50 |
| T-39 | Open API: aggregate, auth, rate-limit, versioned | prod | S7 | 7 | ÷1.25 | 5.5 | T-37,P-03 | FR-51 |
| T-40 | Search consent / opt-out | prod | S2 | 4 | ÷1.6 | 2.5 | T-04 | FR-52 |
| T-41 | Privacy-preserving public family search + anti-enumeration | prod | S2 | 7 | ÷1.4 | 5 | T-40,P-03 | FR-53 |
| T-42 | SOP what-if simulation | prod | S6 | 6 | ÷1.4 | 4.5 | T-31 | FR-54 |
| T-43 | RoPA / consent / retention finalization | post | S1 | 6 | ÷1.1 | 5.5 | all | FR-55 |
| T-44 | Cross-module UAT + production hardening + handover package | post | S1 | 10 | ÷1.1 | 9 | all | FR-56 |
| T-45 | Donation/kitchen/inventory polish + UAT support | post | S3 | 5 | ÷1.3 | 4 | - | - |
| T-46 | Final Handover Gate sign-off + training delivery | post | S4 | 5 | ÷1.1 | 4.5 | T-44 | gate |
| Q-01 | Deployment + release automation (staging/prod, rollback) | post | S1 | 6 | ÷1.25 | 5 | - | NFR-25 |
| Q-02 | Post-launch support / warranty buffer (~2 wks bugfix after go-live) | post | ALL | 20 | ÷1.3 | 15.5 | T-44 | - |
| Q-03 | User manual (full) + ops runbook | post | S1 | 8 | ÷1.1 | 7.5 | T-44 | - |
| | **R4 total (all stages)** | | | **106** | | **84.5** | | |

## 4. Company Pre-Production Budget (บริษัท)

แยกจาก capacity นักศึกษา **มี lead time ~2-3 สัปดาห์** ต้องเสร็จ **ก่อน** แต่ละ phase ไม่งั้น squad ขึ้นงานไม่ได้ (prod task ทุกตัวใน phase นั้น depend P-0x)

| ID | Pre-production package | Phase | Raw MD | Adj MD | หมายเหตุ |
| --- | --- | --- | --- | --- | --- |
| P-01 | R2 design: UX/wireframe (household, zoning, inventory, donation), prototype approval, role-permission matrix full-system, API spec | R2 | 12 | 10 | เริ่ม ก.ค. ปลายๆ |
| P-02 | R3 design: UX/wireframe (donation flows, kitchen, volunteer, SOP, security, referral), prototype approval, API spec | R3 | 14 | 11.5 | เริ่มกลาง ส.ค. |
| P-03 | R4 design: UX/wireframe (EOC, family search), Open API contract w/ One Data, DPIA + governance | R4 | 10 | 8.5 | เริ่มกลาง ก.ย. |
| | **รวม pre-production (บริษัท)** | | **36** | **30** | |

## 5. Student Man-Power (Adj MD, prod+post)

| Squad × Phase | R2 | R3 | R4 | Squad total (Adj MD) |
| --- | --- | --- | --- | --- |
| S1 | 21.5 | 9.5 | 27 | **58** |
| S2 | 18.5 | 3 | 7.5 | **29** |
| S3 | 15.5 | — | 4 | **19.5** |
| S4 | 6 | 14 | 4.5 | **24.5** |
| S5 | 5 | 10.5 | — | **15.5** |
| S6 | 5 | 15 | 4.5 | **24.5** |
| S7 | 5 | 8 | 13 | **26** |
| _Shared buffer (Q-02, เฉลี่ยทุก squad)_ | — | — | 15.5 | **15.5** |
| **Student load/phase (Adj)** | **76.5** | **60** | **76** | |

*capacity = 32 Adj MD/squad/เดือน Q-02 buffer 15.5 เฉลี่ยทั้ง 7 squad = ~2 MD/squad*

## 6. อ่านตัวเลข — ข้อสรุปสำคัญ

1. **Full lifecycle 242.5 Adj MD** — pre (บริษัท 30) + นักศึกษา 212.5; AI ลดจาก 324 raw ≈ **−25%**
2. **ไม่ติด capacity นักศึกษา** — load/phase สูงสุด 76.5 MD แต่ทีม 224 MD/เดือน (util รวม ~32%) คอขวดคือ **dependency ข้าม squad** (pre-production บริษัทส่งแล้ว ไม่ block)
3. **R4 หนักขึ้น (76 MD)** เท่า R2 — post-production (deploy, support buffer, user manual, handover) มาลงเดือนสุดท้าย **S1 R4 = 27/32 (84%) ใน ต.ค.** → มี buffer ต.ค.-ธ.ค. รองรับ + กระจาย T-43/T-44/Q-01/Q-03 บางส่วนให้ squad อื่นช่วย
4. **Build จบ ต.ค. + buffer ต.ค.-ธ.ค. ถึง deadline จริง** — milestone ก.ย. ~80% testable ใช้จับ slip; งานที่เหลือลง buffer ไม่ตัด scope
5. **Post-production (Q-01/02/03 = 28 MD)** กระจายลง buffer ต.ค.-ธ.ค. ได้สบาย ไม่ต้องอัดเดือนเดียว

## 7. Critical Path

```
T-02 data model ─> T-11 stock ─> T-14 dashboard ─┬─> donation cut-off (R3)
                                                 ├─> T-31 resource calc ─> meal plan
all R3 ──────────────────────────────────────────┴─> T-37 EOC ─> T-39 Open API (R4)
all build ─> T-44 UAT+handover ─> Q-02 support buffer (ต.ค.-ธ.ค.)
```

- **Pre-production (design/spec บริษัท) ส่งแล้ว** — ใช้เริ่ม build ได้, refine คู่ขนาน ไม่ใช่ gate ที่ block
- **เส้นยาวสุด:** T-02 → T-14 → T-31 (dependency ข้าม squad ภายใน)
- **Q-02 support buffer (15.5 MD)** อยู่ใน buffer ต.ค.-ธ.ค. ก่อน deadline จริง

## 8. Risks & Buffer

| Risk | Mitigation |
| --- | --- |
| ประเมิน MD ต่ำ (junior+ERP) | slack capacity + buffer ต.ค.-ธ.ค. เป็น absorber; deadline จริงที่ ธ.ค. |
| build ไม่ครบ 100% ภายใน ต.ค. | milestone ก.ย. 80% จับ slip เร็ว; ดึงงานที่เหลือลง buffer ต.ค.-ธ.ค. ไม่ตัด scope |
| R4/S1 ตึง (post-prod กระจุก ต.ค.) | กระจาย handover/manual/deploy ให้ S3/S4 + ใช้ buffer ต.ค.-ธ.ค. |
| support buffer ไม่พอ (bug หลัง go-live) | Q-02 = 2 สัปดาห์ขั้นต่ำ; ถ้า critical สูง ขยาย |
| AI uplift ไม่ถึงตัวคูณ | ตัวคูณ governance/design ตั้งต่ำแล้ว (÷1.1-1.2) |

## 9. การ track

- 1 task = 1 epic/card; T-NN (นักศึกษา) / P-NN (บริษัท) / Q-NN (post) เป็น key ผูก FR
- DoD prod = UI+API+data+test+demo ของ slice; DoD post = gate/handover artifact
- burn-down ต่อ squad/สัปดาห์ เทียบ Adj MD ที่เหลือ
- แก้ scope/estimate ที่ `_tasks.py` แล้ว rerun `gen.py`

## 10. Assumptions Index

- [ASSUMPTION] นักศึกษาเต็มเวลา 16 effective MD/คน/เดือน; junior → slack ชดเชย
- [ASSUMPTION] Pre-production เป็นทรัพยากรบริษัทแยก ไม่กิน capacity นักศึกษา; ส่ง design/spec แล้ว กำลัง refine คู่ขนาน ไม่ block
- [ASSUMPTION] Q-02 support buffer = 2 สัปดาห์หลัง go-live ขั้นต่ำ
- [ASSUMPTION] AI multiplier เป็นค่าประเมิน recalibrate หลัง velocity จริง 1-2 สัปดาห์แรก
- [ASSUMPTION] ตัวละคร/ชื่อจริงต่อ squad จับใน kickoff (K-13)
