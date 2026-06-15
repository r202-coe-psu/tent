---
title: "Task Breakdown — EOC + Open API (Part 3)"
status: active
created: 2026-06-05
updated: 2026-06-15
module: eoc
note: decision-synced 2026-06-15 — task details and DoD maintained directly in Markdown; MongoDB read-model selected for K-17
---

# EOC + Open API (Part 3)

> EOC cross-shelter aggregate API + API-key (FD-14), Open API tier to One Data/Hat Yai ROD

**Architecture (เคาะ 2026-06-11; K-17 ปิด 2026-06-15):** โมดูลนี้เป็น **service แยก** ออกจากระบบหลัก — worker/ETL อ่านข้อมูลจาก Central CouchDB (ระบบหลัก offline-first; LAN Edge เป็น fallback replica ไม่ใช่ API source) มาคำนวณสรุปเป็น **MongoDB aggregate projection** แล้ว expose ผ่าน EOC API + Open API tier; ระบบหลักไม่มี EOC dashboard/role. Payload เป็น aggregate/no-PII/no-medical/no-national-ID เท่านั้น และไม่มี person-level drilldown

- **Team owner:** Lead pair — แจ็ก/เด่น; Team D support หลัง SOP/Referral stabilized (ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** R4
- **Design input (บริษัท):** P-03 (Family Search ส่งล่วงหน้า; EOC/Open API ตาม deferred)
- **Target ส่งมอบ:** deferred — ส่งมอบหลัง go-live ภายในสัปดาห์ที่ 2 กันยายน 2026 (≤ 2026-09-14)

## Features / Tasks

| ID | Feature / Task | FR | Phase | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-37 | EOC cross-shelter aggregate data API (read-only; aggregate + selected fields, no person drill) — FD-14 | FR-49 | R4 | prod | deferred | 8 | ÷1.6 | 5 | all R3 |
| T-38 | EOC API scope rules + API-key principal (issue/rotate/revoke, per-key rate-limit + audit) — FD-14, replaces eoc_viewer role | FR-50 | R4 | prod | deferred | 4 | ÷1.25 | 3 | T-37 |
| T-39 | Open API: aggregate, auth, rate-limit, versioned (separate tier from EOC API per FD-14) | FR-51 | R4 | prod | deferred | 7 | ÷1.25 | 5.5 | T-37,P-03 |
| | **รวมทั้งโมดูล** | | | | | **19** | | **13.5** | |

> **Deferred** (ส่งมอบหลัง go-live, ภายในสัปดาห์ที่ 2 กันยายน 2026): T-37, T-38, T-39

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง
> ทั้งโมดูล reframe ตาม **FD-14**: ส่งมอบเป็น aggregate API + API key (ไม่ใช่ human dashboard / role-scoped views) — source proposal ส่วนที่ 3 "เชื่อมโยงข้อมูลสถานะศูนย์ส่งต่อ EOC อำเภอ/จังหวัด" ยังคงเป็นเป้าหมายเดิม แค่เปลี่ยนรูปแบบส่งมอบ

### T-37 — EOC cross-shelter aggregate data API (FR-49, FD-14)

**Description:** Read-only API รวมข้อมูลข้ามศูนย์สำหรับ EOC อำเภอ/จังหวัด: ยอดผู้พักพิงต่อศูนย์, สถานะ capacity, ทรัพยากรขาด/เกิน, กลุ่มเปราะบาง (aggregate + selected fields เท่านั้น — **ไม่มี person-level drill-down**, ไม่มี medical/national ID) ตาม FD-14

**Definition of Done:**
- Endpoint aggregate ครอบชุดข้อมูลที่ P-03 design กำหนด (occupancy, capacity, resource gap, vulnerable counts)
- ไม่มีทางดึง PII/person-level/medical/national ID ผ่าน API ชุดนี้ (test ยืนยัน รวม parameter manipulation)
- ข้อมูลอ่านจาก MongoDB aggregate projection ที่ worker/ETL สร้างจาก Central CouchDB; ไม่ query operational CouchDB ต่อ request
- ข้อมูล as-of timestamp ชัดเจน, perf รับ polling จาก EOC ได้ตาม NFR
- API doc (OpenAPI spec) ครบ + demo ดึงข้อมูลจริงข้ามอย่างน้อย 2 ศูนย์ — ส่งมอบภายใน 14/09/2026

### T-38 — EOC API scope rules + API-key principal (FR-50, FD-14)

**Description:** กลไก API key เป็น principal สำหรับผู้ใช้ API ฝั่ง EOC (แทน `eoc_viewer` role เดิมตาม FD-14): ออก/หมุน/เพิกถอน key, จำกัด scope ข้อมูลต่อ key (เช่น เฉพาะอำเภอตน), rate-limit ต่อ key + audit ทุก request

**Definition of Done:**
- Issue/rotate/revoke API key ได้โดย admin พร้อม scope ต่อ key — revoke แล้วใช้ไม่ได้ทันที
- Request เกิน scope → 403, เกิน rate-limit → 429 (test ครบทั้งสอง)
- ทุก request ลง audit log (key, endpoint, เวลา) query ย้อนหลังได้
- เอกสารขั้นตอนออก key ให้หน่วยงาน + demo วงจรชีวิต key ครบ — ส่งมอบภายใน 14/09/2026

### T-39 — Open API: aggregate, auth, rate-limit, versioned (FR-51)

**Description:** Open API tier สาธารณะสำหรับหน่วยงานภายนอก (One Data / Hat Yai ROD) — **แยก tier จาก EOC API ตาม FD-14**: ชุดข้อมูล aggregate ที่เปิดกว้างกว่าแต่หยาบกว่า, มี auth + rate-limit + versioning ตาม Open API contract ใน P-03 และอ่านจาก MongoDB projection เดียวกัน

**Definition of Done:**
- Endpoint ตาม contract P-03, versioned (`/v1/`) — breaking change ต้องออก version ใหม่
- Auth + rate-limit แยกจาก EOC tier, ข้อมูลเป็น aggregate ที่ผ่านเกณฑ์เปิดเผยสาธารณะเท่านั้น (ไม่มี PII/medical/national ID — test ยืนยัน)
- OpenAPI spec + คู่มือ integrate สำหรับหน่วยงานภายนอกเผยแพร่ได้
- Demo ดึงข้อมูลจาก client ภายนอกจริง 1 ราย — ส่งมอบภายใน 14/09/2026

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| R4 | 19 | 13.5 |
| **รวม** | **19** | **13.5** |

## Dependencies

**Gate / integration:** all R3 (รอให้ทั้ง phase เสร็จก่อน)

**Design input:** P-03 (pre-production โดยบริษัท)
