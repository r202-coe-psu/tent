---
title: Full-System Release Roadmap (Aug-Dec 2026)
status: draft
created: 2026-06-03
updated: 2026-06-05
supersedes: prd.html §9 Release Roadmap (R2-R6)
---

# Full-System Release Roadmap — Post-July MVP

## 0. Purpose

เอกสารนี้เป็น master timeline สำหรับการพัฒนา Smart Shelter Management Platform **หลัง July MVP จนจบส่วน software platform** โดยรวมขอบเขต full-system (Module A-F, Donation, EOC/Dashboard, Household, zoning, public family search) ที่ MVP กันออกไว้ ให้กลับเข้ามาเป็นแผนส่งมอบจริง

เอกสารนี้ **แทนที่ §9 Release Roadmap เดิม** ใน [PRD MVP](../prd-smart-shelter-spec-2026-05-30/prd.html) ที่ลาก R3-R6 ไปถึงเดือน 12 ส่วน scope/FR/NFR รายละเอียดของแต่ละ phase อยู่ใน PRD ราย phase:

- [Phase R2 — Foundation (Household, Zoning, Inventory)](phase-r2-foundation.html)
- [Phase R3 — Operations (Donation, Kitchen, Volunteer, SOP, Security)](phase-r3-operations.html)
- [Phase R4 — Integration (EOC, Open API, Family Search, Handover)](phase-r4-integration-handover.html)

July MVP ยังเป็น baseline ที่ canonical สำหรับ FR-1..FR-20 / NFR-1..NFR-11 และ field contract ยังอิง [Data Dictionary](../../data/smart-shelter-data-dictionary.html) เดิม phase ถัดไปต่อยอด ไม่รื้อ

## 1. Context — ทำไมต้องบีบ timeline

Roadmap เดิมวาง full platform ไว้ 5 เดือน (R2 Aug → R6 Dec) แบบ module ต่อ module ทีละเดือน ภายใต้สมมติฐานทีมเล็ก ตอนนี้บริบทเปลี่ยน:

1. **ทีมโตเป็น 14 student developers** — รันได้หลาย vertical squad พร้อมกัน ไม่ต้องทำทีละ module
2. **build บีบเหลือ 3 เดือน (R2/R3/R4 = ส.ค.-ต.ค.)** — หลาย squad รันขนานต่อ gate แทน sequential
3. **deadline จริง = ธ.ค. 2026** — ต.ค.-ธ.ค. เป็น hardening + buffer ทำให้ **ไม่ต้องตัด scope** เพื่อให้ทัน
4. **milestone ภายใน: สิ้น ก.ย. ≈ 80% testable** — checkpoint วัด velocity ไม่ใช่ hard finish line

หลักการบีบ build: เปลี่ยนจาก "1 module / เดือน แบบ sequential" เป็น **"หลาย squad รันขนานต่อ gate"** โดยจัดลำดับตาม data dependency (ดู §4) ไม่ใช่ตามปฏิทิน — build จบ ต.ค. แล้วใช้ buffer ถึง ธ.ค. ปิดงาน UAT/handover/bug ที่เหลือ

> Demo/readiness context เดิมยังอยู่: ช่วง Sep-Dec มีโอกาสเกิดน้ำท่วมจริง — core operations (July MVP) live แล้ว, backoffice platform ทยอยขึ้นตลอด ส.ค.-ต.ค. และ harden ถึง ธ.ค. การวาง deadline จริงที่ ธ.ค. จึงสอดคล้องกับ operational readiness ตลอดช่วงเสี่ยง ไม่ใช่บีบส่งครั้งเดียว

## 2. Timeline (canonical)

| Phase | Month | Gate | Scope หลัก | PRD |
| --- | --- | --- | --- | --- |
| **R1** | July | July MVP Demo Gate *(done baseline)* | Registration-first MVP (Person-only) | [MVP PRD](../prd-smart-shelter-spec-2026-05-30/prd.html) |
| **R2** | August | **Backoffice Foundation Gate** | Household + Zoning (deferred MVP), Inventory/Supply core (Module C), Donation intake foundation, new-role RBAC, data-model expansion | [R2](phase-r2-foundation.html) |
| **R3** | September | **Operations Gate** | Donation full (cut-off / smart redirect / transparency), Kitchen & Food (Module D), Volunteer & skill matching (Module A), SOP Resource Calculator (Module B), Security + Referral (Modules E+F) | [R3](phase-r3-operations.html) |
| **R4** | October | **Final Handover Gate** | EOC dashboard + Open API → One Data / Hat Yai ROD (Part 3), public family search, SOP simulation, RoPA finalization, cross-module UAT, training, production hardening, handover | [R4](phase-r4-integration-handover.html) |
| — | Oct–Dec | **Hardening + buffer → real deadline (Dec)** | field UAT, bug-fix, training, handover refine, support buffer | — |

**Deadline จริง = ธ.ค. 2026 (ไม่ตัด scope):** build R2/R3/R4 จบภายใน ต.ค. แล้วใช้ ต.ค.-ธ.ค. เป็น buffer hardening/UAT/handover — full scope ครบ ไม่บีบจนต้องตัด feature

**Internal milestone — สิ้น ก.ย. ≈ 80% testable:** R2 ปิด + R3 ส่วนใหญ่ขึ้น ≈ 80% ของ feature พร้อม test ภายใน *(checkpoint วัด velocity, re-balance squad ก่อนเข้า R4 — ไม่ใช่ hard finish, ดู §5)*

Gate semantics ต่อยอดจาก [Project Delivery Agreement](../../delivery/project-delivery-agreement.html): ทุก gate ต้องผ่าน automated checks + staging UAT + critical bug = 0 + backup/rollback readiness ก่อน production

## 3. Team Model — 14 students, 7 vertical squads

อิง vertical feature ownership จาก [Team Operating Model](../../org/teams.html): แต่ละ squad ถือ UI + API + data model + validation + tests + demo ของ slice ตนเอง Shared core (auth, permission, data model, sync, deployment) ต้องผ่าน review โดย Student Lead Dev + PM/SA

| Squad | คน | Domain ownership | Active phases |
| --- | --- | --- | --- |
| S1 Platform/Core | 2 | auth, RBAC ขยาย role ใหม่, data-model expansion, sync, DevOps, shared API convention | R2-R4 (foundation-heavy ใน R2) |
| S2 People & Zoning | 2 | Household registration, household QR/search/check-in, zoning allocation, pets/assets/vehicle | R2 หลัก, R4 (family search) |
| S3 Supply & Inventory | 2 | Module C: รับเข้า/แจกจ่าย/โอน, stock dashboard | R2-R3 |
| S4 Donation | 2 | Reservation, cut-off, smart redirect, transparency report | R2 (intake) → R3 (full) |
| S5 Kitchen & Food | 2 | Module D: central kitchen, food tracking, meal demand | R3 |
| S6 Volunteer & SOP | 2 | Module A volunteer + skill matching, Module B SOP calculator | R3, R4 (simulation) |
| S7 Security, Referral & EOC | 2 | Module E security, Module F referral, Part 3 EOC + Open API | R3 (E+F) → R4 (EOC) |

รวม 14 คน เป็น 7 squad × 2 บวก Student Lead Dev เป็น floating reviewer/integrator (นับใน S1) จำนวนต่อ squad ปรับได้ตาม load จริงราย phase — [ASSUMPTION FD-A3] นักศึกษาทั้ง 14 คน available เต็มเวลาตลอด Aug-Dec (build หนัก Aug-Oct, hardening/support Oct-Dec เบาลง)

QA/Release Owner ยังเป็นทีม IMPS (เน็ท, ฟู่, เซียน) ตาม [PRD §11](../prd-smart-shelter-spec-2026-05-30/prd.html) ถือ go/no-go ทุก gate

## 4. Dependency Order (ทำไมจัดลำดับแบบนี้)

การบีบทำได้เพราะรันขนาน แต่บาง module มี hard dependency ที่กำหนดว่าต้องอยู่ phase ไหน:

```
R2  People&Zoning ──┐
    Inventory core ─┼─> R3  Donation full (ต้องมี stock + reorder threshold)
    Donation intake ┘        Kitchen (ต้องดึงวัตถุดิบจาก Inventory)
                             SOP calc (ต้องมี occupancy + inventory + meal data)
    Inventory ───────────>   Volunteer (จับคู่งานคลัง/ครัว)
                             Security + Referral (ต่อยอด check-in/out MVP)
                                   │
R3  ทุก module เป็น data producer ─┴─> R4  EOC dashboard + Open API (รวมทุก metric)
                                          Family search (ต้องรอ governance + masking)
```

- **Inventory ต้องมาก่อน Donation/Kitchen/SOP** เพราะทั้งสามอ่าน/เขียน stock
- **SOP Calculator มาทีหลังสุดของ R3** เพราะต้องการ input ครบ (occupancy, inventory, meal, volunteer)
- **EOC/Open API ต้องอยู่ R4** เพราะรวบ metric จากทุก module ที่เพิ่งเสร็จ R3
- **Family search อยู่ R4** หลัง consent/masking/RoPA โตพอ ([ASSUMPTION FD-A1])

## 5. September Milestone (~80% testable — ไม่ใช่ finish line)

ก.ย. **ไม่ใช่** hard finish ที่ต้องตัด scope ให้ทัน — เป็น **internal checkpoint** วัดว่า velocity ตรงแผนไหม ก่อนเข้า R4 + buffer:

| ตัวชี้วัด ณ สิ้น ก.ย. | เป้า |
| --- | --- |
| R2 (Foundation) ปิด gate | ✅ ครบ |
| R3 (Operations) module ส่วนใหญ่ขึ้น demo/test ได้ | ≈ 80% ของ feature รวมทั้งระบบ testable ภายใน |
| งานที่ยังเหลือ (R4 integration, EOC/API, family search, polish) | ทำต่อใน ต.ค. + buffer ต.ค.-ธ.ค. |

**ถ้า velocity ต่ำกว่า 80% ณ ก.ย.:** re-balance squad / ดึง buffer ต.ค.-ธ.ค. มาช่วย — **ไม่ตัด scope** เพราะ deadline จริง = ธ.ค. ยังมีที่ว่างปิดงาน เงื่อนไขที่ทำให้ milestone นี้ตรงแผน: R2 ต้องปิด Backoffice Foundation Gate **ทันสิ้น Aug ไม่เลื่อน** และทั้ง 7 squad รันขนานเต็มตลอด Sep ([ASSUMPTION FD-A2])

> family search, EOC dashboard, SOP simulation = full scope ใน R4 ทั้งหมด (ไม่ตัดเป็น Open-API-only แบบแผนบีบเดิม); buffer ต.ค.-ธ.ค. มีไว้ทำ governance/consent/masking ให้ครบก่อน publish

## 6. Cross-cutting carried forward

NFR/governance จาก MVP applies ต่อทุก phase และเข้มขึ้นตาม scope:

- **RBAC ขยาย role ใหม่**: Warehouse/Supply Officer, Kitchen Lead, Volunteer Coordinator, Security Officer — ทุก role ต้อง enforce ที่ backend (ต่อ NFR-4). **Donor = no-auth** (track ผ่าน `tracking_token`, ไม่ใช่ role — FD-16)
- **Masking/PDPA**: ข้อมูล medical/national-ID ยัง mask; family search + donation transparency เพิ่ม public-facing surface → ต้องผ่าน data-governance review ก่อน implement (ต่อ NFR-5, §12 Change Control เดิม)
- **Offline**: ขยาย offline เฉพาะ flow หน้างานจริง (registration ยังเป็นหลัก) module หลังบ้าน online-first; full offline sync ทุก module ยัง out of scope
- **Audit**: ทุก sensitive/stock/donation/referral action ต้อง auditable (ต่อ NFR-10)
- **Data model**: ขยายแบบ additive ไม่ทำลาย MVP collections; collection ใหม่อยู่ใน PRD ราย phase

## 7. Risks เฉพาะการบีบ timeline

| Risk | Impact | Mitigation |
| --- | --- | --- |
| บีบ build เหลือ 3 เดือน (Aug-Oct) คุณภาพตก | bug หลุดเข้า field ช่วงเสี่ยงน้ำท่วม | ทุก gate คง critical bug = 0; ใช้ buffer Oct-Dec hardening แทนลดคุณภาพ/ตัด scope |
| build ไม่ครบ 100% ภายใน ต.ค. | งานค้างเข้า buffer | milestone ก.ย. 80% จับ slip เร็ว; deadline จริง ธ.ค. มี buffer ปิดงานที่เหลือ |
| 7 squad ขนานชน shared core | merge conflict, API contract แตก | S1 ถือ API convention + freeze contract ต้น phase; review ก่อนแก้ core |
| Module B SOP calc รอ input หลาย module | คอขวดปลาย R3 | เริ่ม SOP data contract แต่ต้น R3 ขนานกับ producer; calc logic มาทีหลัง |
| 14 คนไม่ available เต็มเวลา (สอบ/ปิดเทอม) | velocity ต่ำกว่าแผน | ผูก deadline จริงกับ ธ.ค.; buffer Oct-Dec absorb slip; ก.ย. 80% เป็น checkpoint ไม่ใช่ commit |
| Public family search เปิดข้อมูลเกิน | PDPA breach | gate ด้วย governance review ใน R4; buffer Dec ทำ consent/masking ครบก่อน publish |

## 8. Out of Scope (ทั้ง 3 phase)

- ระบบเตือนภัยน้ำท่วมต้นน้ำ (เป็นหน้าที่ Hat Yai ROD — เราเป็น data producer ผ่าน Open API เท่านั้น)
- ERP การเงิน/บัญชี/จัดซื้อ/HR
- Full offline sync conflict resolution ทุก module
- Hardware/IoT sensor integration, VHF radio automation (analog backup เป็น manual process นอกระบบ)
- ระบบส่งเสริมอาชีพ/กิจกรรมในศูนย์ (recovery phase — นอก response phase scope)
- Native mobile app (ยังเป็น PWA)

## 9. Assumptions Index

- [ASSUMPTION FD-A1] Public family search อยู่ R4 หลัง governance gate; buffer Oct-Dec ทำ consent/masking ให้ครบก่อน publish
- [ASSUMPTION FD-A2] Sep = internal checkpoint ~80% testable (ไม่ตัด scope); ถ้า velocity ต่ำใช้ buffer Oct-Dec ปิดงาน — deadline จริง = ธ.ค.
- [ASSUMPTION FD-A3] นักศึกษา 14 คน available เต็มเวลาตลอด Aug-Dec ตาม squad split §3 (build หนัก Aug-Oct)
