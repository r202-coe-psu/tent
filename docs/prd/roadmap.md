---
title: Release Roadmap (มิ.ย.–ก.ย. 2026 + maintenance)
status: active
created: 2026-06-03
updated: 2026-07-07
note: ปรับตาม schedule decision 2026-06-09 + decision sync 2026-06-15 (teams closed, RBAC approved, EOC MongoDB read-model) — canonical timeline อยู่ที่ task-breakdown/_timeline.md
---

# Release Roadmap — Smart Shelter (Greenfield)

## 0. Purpose

เอกสารนี้เป็น master timeline เชิง narrative ของการพัฒนา Smart Shelter Management Platform ทั้งระบบ (Baseline registration-first, Module A-F, Donation, Household/zoning, Family Search, EOC/Open API) — **ตัวเลขและลำดับ canonical อยู่ที่ [Dependencies & Timeline](../task-breakdown/_timeline.md)** (schedule decision 2026-06-09); เอกสารนี้อธิบายเหตุผลและภาพรวม

Scope/FR/NFR รายละเอียดของแต่ละ phase อยู่ใน PRD ราย phase:

- [Phase R2 — Foundation (Baseline, Household, Zoning, Inventory)](phase-r2-foundation.html)
- [Phase R3 — Operations (Donation, Kitchen, Volunteer, SOP, Security)](phase-r3-operations.html)
- [Phase R4 — Integration (Family Search, Governance, Handover + deferred EOC/Open API)](phase-r4-integration-handover.html)

Field contract อิง [Database Schema](../data/schema.md), [Data Model](../data/data-model.md), [API Contract](../data/api-contract.md); baseline FR-1..FR-20 spec อยู่ใน [`docs/features/`](../features/index.html)

## 1. Context — เงื่อนไขที่กำหนดแผน

1. **Greenfield** — ยังไม่มีระบบ MVP ใช้งานจริงมาก่อน มีเพียง CouchDB PoC; baseline FR-1–20 (registration-first) ต้อง build เป็นส่วนแรกของ foundation
2. **ทีม 14 คน = 2 Lead (Platform/Core) + 4 ทีม × 3** (part-time academic) — รันขนานหลายทีมต่อ gate; K-13 ปิดแล้วตาม [Squad Roster](squad-roster.html)
3. **ฤดูเสี่ยงน้ำท่วม ก.ย.–ธ.ค.** — ระบบต้อง **go-live full program ก.ย.** ก่อนช่วงเสี่ยง → build บีบอยู่ใน **มิ.ย.–ส.ค.**
4. **Remote-first บน CouchDB (active endpoint model)** — client write ไป endpoint ที่ active โดยตรง: Central ก่อนเสมอ, fallback ไป LAN Edge เฉพาะตอน WAN/Central outage, และอนุญาต active endpoint ได้ครั้งละหนึ่งเดียว; disconnected mode เป็น status-only (ไม่มี read-only local cache); retry policy กลางระบบคืออัตโนมัติ 3 ครั้ง เกินนั้นแสดงแบนเนอร์ cannot connect และเปิด force retry; sync/conflict/failback = tech risk #1; EOC/Open API เป็น service แยก (worker/ETL จาก Central)
5. **หลัง go-live**: รับ feedback + แก้ไข (maintenance) ต่อเนื่องจนครบกำหนดโครงการ **12 เดือน** — งาน feature ใหม่จบที่ 14 ก.ย. ([ASSUMPTION RM-A1])

## 2. Timeline (canonical — สรุปจาก [_timeline.md](../task-breakdown/_timeline.md))

| ช่วง | Gate / Milestone | Scope หลัก | PRD |
| --- | --- | --- | --- |
| **10 มิ.ย.** | Kickoff Lead | walking skeleton เริ่มทันที (repo/CI, auth/RBAC skeleton, CouchDB schema + sync design, 1 vertical slice) | — |
| **17 มิ.ย.** | Workshop — 4 ทีมเริ่มงาน | Baseline FR-1–20 (T-47..55) + R2 เริ่มขนาน | [R2](phase-r2-foundation.html) |
| **มิ.ย.–ก.ค.** | **Foundation Gate 17 ก.ค.** | Baseline เต็ม + Household/Zoning + Inventory core (Module C) + Donation intake + RBAC | [R2](phase-r2-foundation.html) |
| **ก.ค.–ส.ค.** | **Operations Gate 22 ส.ค.** | Donation full, Kitchen (D), Volunteer (A), SOP calculator (B), Security+Referral (E+F) | [R3](phase-r3-operations.html) |
| **ส.ค.** (ขนาน) | — | Family Search (T-40/41) + RoPA minimal (T-43) + UAT/hardening (T-44) | [R4](phase-r4-integration-handover.html) |
| **31 ส.ค.** | **In-scope ส่งมอบ** | Baseline + R2 + R3 + Family Search + governance ครบ | — |
| **ก.ย. (สัปดาห์ 1)** | **Go-live full program** | ใช้งานจริง | — |
| **≤14 ก.ย.** | **Hard deadline งาน feature** | deferred tail: EOC aggregate API (T-37/38), Open API (T-39), SOP simulation (T-42), inventory polish (T-45) | [R4](phase-r4-integration-handover.html) |
| **หลัง 14 ก.ย. → ครบ 12 เดือน** | สิ้นสุดโครงการ | feedback, bug-fix, maintenance, support — ไม่มี feature ใหม่ | — |

Gate semantics: ทุก gate ต้องผ่าน automated checks + staging UAT + critical bug = 0 + backup/rollback readiness ก่อน production

## 3. Team Model — 14 คน = 2 Lead + 4 ทีม × 3

แต่ละทีมถือ UI + API + data model + validation + tests + demo ของ slice ตนเอง (vertical ownership) Shared core (auth, permission, data model, sync, deployment) ต้องผ่าน review โดย Lead pair

| หน่วย | คน | Domain | Active |
| --- | --- | --- | --- |
| **Lead pair** Platform/Core | 2 | auth, RBAC, data model, shared API, remote-first CouchDB active-endpoint orchestration (Central-first + Edge fallback), DevOps, integration + floating reviewer | ตลอด |
| **Team A** | 3 | Donation + Volunteer (ชิโน/นัท/กาน) | R2-R3 |
| **Team B** | 3 | People/Household + Family Search + Security (พีค/โฮป/ปิ๊ก) | R2-R4 |
| **Team C** | 3 | Supply/Inventory + Kitchen/Food (ก้อง/มิว/พัฟ) | R2-R3 |
| **Team D** | 3 | SOP/Resource Calc + Referral; support EOC after SOP/Referral stabilized (เน/ภูดิท/วิลเลียม) | R2-R4 |

Domain load รายทีมดู [Task Breakdown](../task-breakdown/_index.md) และ [Squad Roster](squad-roster.html).

[ASSUMPTION RM-A2] นักศึกษา 14 คน available แบบ part-time academic ตลอด build มิ.ย.–ส.ค.; estimate (Adj MD) recalibrate หลัง velocity จริง 1–2 สัปดาห์แรก (K-16)

## 4. Dependency Order (ทำไมจัดลำดับแบบนี้)

```
Skeleton (T-01/02/03) ──> Baseline FR-1–20 (T-47..55) ─── occupancy/movement data
        │
        ├─> Household & Zoning ──> Family Search (T-40/41, ส.ค.)
        ├─> Inventory core ──┬─> Donation full (ต้องมี stock + reorder threshold)
        │                    ├─> Kitchen (ดึงวัตถุดิบจาก Inventory)
        │                    └─> SOP calc (occupancy + inventory + meal data)
        └─> groundwork R3 ──> Volunteer, Security + Referral

all R3 producers ──> (deferred ≤14 ก.ย.) EOC aggregate API ──> Open API
```

- **Baseline มาก่อนทุกอย่าง** — flow หน้างาน (register → screen → check-in) ผลิต occupancy data ที่ R2/R3 ทุก module ใช้
- **Inventory ต้องมาก่อน Donation/Kitchen/SOP** เพราะทั้งสามอ่าน/เขียน stock
- **SOP Calculator มาทีหลังสุดของ R3** เพราะต้องการ input ครบ (occupancy, inventory, meal, volunteer)
- **EOC/Open API = deferred** — รวบ metric จากทุก module ที่เพิ่งเสร็จ R3 และเป็น service แยก (ดู §5) จึงไม่ block go-live
- **Family Search อยู่ใน scope ส.ค.** (core public feature) + T-43 RoPA minimal บังคับเพราะเปิด public = PII exposure จริง

## 5. Data Layer & EOC Architecture (เคาะ 2026-06-11)

- **ระบบหลัก: remote-first ผ่าน active endpoint เดียว** — client เขียนไป endpoint ที่ active โดยตรง (Central ก่อน, Edge fallback เมื่อ Central/WAN ใช้ไม่ได้) และต้องไม่ active Central+Edge พร้อมกัน; disconnected mode เป็น status-only (ไม่มี read-only local cache); เมื่อ WAN กลับมาให้ failback กลับ Central; sync/conflict design อยู่ใน T-02 (Lead B เจ้าของ, tech risk #1)
- **EOC + Open API: service แยก** — worker/ETL อ่านจาก Central CouchDB มาสรุปเป็น aggregate read-model แล้ว expose เป็น EOC API (API-key principal, FD-14) + Open API tier (One Data / Hat Yai ROD)
- **Datastore ของ aggregate read-model: MongoDB projection** จาก Central CouchDB (K-17 ปิด 2026-06-15; ดู [10-eoc](../task-breakdown/10-eoc.md))

## 6. Cross-cutting

- **RBAC**: 5 internal roles ตาม [Role Permission Matrix](role-permission-matrix.html) enforce ที่ backend. **Donor = no-auth** (track ผ่าน `tracking_token` — FD-16). **EOC = API-key principal ไม่ใช่ human role** (FD-14)
- **Visibility/PDPA**: internal authenticated staff เห็น medical ตาม shelter scope; family search + donation transparency + Open API = public-facing aggregate/masked output ไม่มี medical/national ID → ผ่าน data-governance review ก่อน publish
- **Connectivity**: remote-first เป็นค่าเริ่มต้นทุก module โดยเฉพาะ flow หน้างาน; LAN Edge fallback ไม่ใช่ normal hub และต้องมี active endpoint เดียวเสมอ; public/no-login endpoints เป็น Central-only; disconnected mode เป็น status-only (ไม่มี read-only local cache); full offline sync ทุก module = out of scope; retry UX กลางระบบ = auto 3 attempts + cannot-connect banner + force retry
- **Audit**: ทุก sensitive/stock/donation/referral action ต้อง auditable
- **Schema**: อิง [Database Schema](../data/schema.md) + [Data Model](../data/data-model.md) — ออกแบบให้ baseline collections รองรับการต่อยอด R2-R4 โดยไม่ destructive migration

## 7. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Greenfield + build บีบ มิ.ย.–ส.ค. | คุณภาพตก, bug หลุดเข้า field ช่วงเสี่ยงน้ำท่วม | walking skeleton ให้ pattern เดียวกันทุกทีม; ทุก gate คง critical bug = 0; maintenance period หลัง go-live รองรับ |
| CouchDB sync/conflict/failback (T-54/T-02) | ข้อมูลหาย/ซ้ำจาก endpoint switch ผิดลำดับ หรือ client ไปแตะ Central+Edge พร้อมกัน — พังความเชื่อใจหน้างาน | Lead B เจ้าของ; เริ่มทันทีหลัง skeleton; ทดสอบ Central success, Edge fallback, disconnected status-only (no read-only local cache), auto-retry 3 attempts + cannot-connect banner + force retry, failback และ conflict scenario ใน Foundation Gate |
| 4 ทีม + Lead pair ชน shared core | merge conflict, API contract แตก | Lead pair ถือ API convention + freeze contract ต้น phase; review ก่อนแก้ core |
| SOP calc (T-31) รอ input หลาย module | คอขวดปลาย R3 | เริ่ม SOP data contract แต่ต้น R3 ขนานกับ producer; calc logic มาทีหลัง |
| P-02 (R3 design) ส่งช้า | ทีมรอ design ~ต้น ก.ค. | บริษัท commit เสร็จก่อน ก.ค. (เงื่อนไขใน [_timeline §0](../task-breakdown/_timeline.md)) |
| Part-time academic, estimate ต่ำ (junior) | velocity ต่ำกว่าแผน | recalibrate หลัง 1–2 สัปดาห์ (K-16); deferred tail เป็น buffer แรก; ตัดเข้า maintenance ถ้าจำเป็น |
| Family Search เปิดข้อมูลเกิน | PDPA breach | T-43 RoPA minimal บังคับใน scope ส.ค.; governance review ก่อน publish |

## 8. Out of Scope (ทั้งโครงการ)

- ระบบเตือนภัยน้ำท่วมต้นน้ำ (เป็นหน้าที่ Hat Yai ROD — เราเป็น data producer ผ่าน Open API เท่านั้น)
- ERP การเงิน/บัญชี/จัดซื้อ/HR
- Full offline sync conflict resolution ทุก module
- Hardware/IoT sensor integration, VHF radio automation (analog backup เป็น manual process นอกระบบ)
- ระบบส่งเสริมอาชีพ/กิจกรรมในศูนย์ (recovery phase — นอก response phase scope)
- Native mobile app (ยังเป็น PWA)

## 9. Assumptions Index

- [ASSUMPTION RM-A1] กำหนดโครงการ 12 เดือนนับจากเริ่มโครงการ มิ.ย. 2026 → สิ้นสุดราว มิ.ย. 2027 — ยืนยันวันที่จริงกับสัญญาโครงการ
- [ASSUMPTION RM-A2] ทีม 14 คน available แบบ part-time academic ตลอด มิ.ย.–ส.ค.; estimate recalibrate หลัง velocity จริง (K-16)
- [ASSUMPTION RM-A3] Family Search อยู่ใน scope ส.ค. ภายใต้เงื่อนไข governance review + T-43 minimal ผ่านก่อน publish
