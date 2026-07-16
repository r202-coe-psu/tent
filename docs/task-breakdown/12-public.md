---
title: "Task Breakdown — Public Portal (PUB tier)"
status: active
created: 2026-06-22
updated: 2026-07-16
module: public
note: เพิ่มตาม CR-005 (2026-06-22) — public/no-login portal surface (landing + /shelters + FAQ) ที่ task-breakdown เดิมยังไม่มี module รองรับ
---

# Public Portal (PUB tier)

> public/no-login landing page + real-time metrics, Public Shelter Dashboard (`/shelters`), dynamic FAQ

โมดูลนี้เกิดจาก **CR-005** — เป็น **public / no-login tier (PUB)** ที่รวม surface ฝั่งสาธารณะของ landing page และ `/shelters` ซึ่งเดิมไม่มี T-task รองรับ. ฝั่ง `/search` (FAM tier) อยู่ที่ [Family Search](11-famsearch.md) (T-41); `/donate` (DN tier) อยู่ที่ [Donation](04-donation.md) (T-60). ทุก field ที่ public expose ผ่าน redaction whitelist ของ [T-01](01-core.md) และอ่านจาก read-model [T-35](01-core.md).

Spec: `docs/features/public-portal-landing-spec.html` (v0.3) + `docs/features/public-portal-shelter-spec.html`.

- **Team owner:** Lead pair (public surface integration) + Team B (occupancy/shelter data) — **ต้องยืนยันการจัดทีมใน workshop (K-13 follow-up)**: landing/shelters ตัดข้ามทีม (people/occupancy + donation + search)
- **Phase:** R3 (อ่าน occupancy/vulnerable aggregate + read-model T-35; landing scaffold + FAQ เริ่มได้ตั้งแต่ R2)
- **Design input (บริษัท):** mockup session 2026-06-21/22 (CR-005)
- **Target ส่งมอบ:** ภายในสิงหาคม 2026

## Features / Tasks

| ID | Status | Feature / Task | Ref | Phase | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-57 | 🔄 | Public Portal landing + real-time metrics panel | CR-005 §A/B/C | R3 | prod | ส.ค. | 6 | ÷1.6 | 4 | T-52,T-35,T-01 |
| T-58 | 🔄 | Public Shelter Dashboard (`/shelters`) — cards + map + filter | CR-005 §D | R3 | prod | ส.ค. | 7 | ÷1.4 | 5 | T-57,T-47 |
| T-59 | 🔄 | Public FAQ (dynamic) + EOC FAQ setup screen | CR-005 OP-1 | R3 | prod | ส.ค. | 4 | ÷1.6 | 2.5 | T-03 |
|  |  | **รวมทั้งโมดูล** |  |  |  |  | **17** |  | **11.5** |  |

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod) + **Public task DoD**: rate-limit/anti-enumeration + no-PII/no-medical/no-national-ID tests + production CAPTCHA gate เมื่อ public-facing

### T-57 — Public Portal landing + real-time metrics panel (CR-005 §A/B/C)

**Description:** หน้าแรก public/no-login — alert banner + real-time metrics panel + quick-service cards + nav. metric "ผู้ประสบภัยปลอดภัย" = `occupancy_total` (occupancy รวมทุกศูนย์) expose สู่ public ได้ (OP-6 approved) เพื่อให้ประชาชน/ญาติรู้ว่าศูนย์เต็มหรือยัง

**Definition of Done:**
- Metrics panel อ่าน `GET /public/v1/transparency/summary` (aggregate ระบบ): `occupancy_total` (OP-6) + `shelters_open/total`; **กั้นด้วย flag `public_metrics_occupancy` = kill-switch default on** — ปิด flag แล้ว metric ซ่อน, หน้าไม่พัง
- **Polling 10 นาที, stale-threshold 30 นาที (OP-7):** เกิน 30 นาทีโชว์ค่าเก่า + ป้าย "ข้อมูลอาจไม่เป็นปัจจุบัน"; **ไม่ poll DB ตรง** (อ่าน read-model T-35)
- **Deferrals (CR-005 §B):** ซ่อน nav "รายงานความโปร่งใส" (`/transparency`) + nav/card "อาสาสมัคร" (`/volunteer*`) + metric `volunteers_active` — เปิดภายหลัง (ไม่กระทบ scope ภายในของ [Module A — Volunteer](06-A.md))
- **UX (CR-005 §C):** alert level 4 บน mobile = sticky top (OP-4); ลิงก์ "ตรวจสอบพิกัด..." = internal `/shelters` (OP-5); ปุ่ม LINE OA/FB ซ่อน เหลือปุ่มโทร 1669/1784 (OP-2)
- aggregate-only, no PII/no person-level (test ยืนยัน) + demo เปิด/ปิด kill-switch flag

### T-58 — Public Shelter Dashboard `/shelters` (CR-005 §D)

**Description:** หน้า "ตรวจสอบสถานะศูนย์พักพิง" (PUB tier) — metric cards 4 ใบ + map หมุดศูนย์ + filter + list ศูนย์พร้อม occupancy/capacity. อ่าน aggregate-only จาก `GET /public/v1/transparency/shelters`

**Definition of Done:**
- Metric cards 4: `shelters_total`, `shelters_open` (เปิดปกติ), `occupancy_total` (OP-6 approved, flag `public_metrics_occupancy`), `vulnerable_count` "กลุ่มเปราะบาง" (**OP-8 approved**, flag `public_metrics_vulnerable` = kill-switch default on) — **ห้าม drill-down เป็นรายชื่อ/ราย attribute ความเปราะบาง**
- **Per-shelter occupancy/capacity แสดงตัวเลขเป๊ะเสมอ (OP-9 approved):** เช่น `3/250` + "จำนวนที่ว่าง" — ไม่ปัด/ไม่ bucket/ไม่ mask แม้ count ต่ำ; **ไม่ต้องทำ k-anonymity/low-count logic ฝั่ง service**
- Map หมุดศูนย์ + พิกัด/ระยะทาง (shelter `geo` — public เชิงปฏิบัติการ) + filter จังหวัด/อำเภอ/ตำบล/ระยะทาง 5–50กม./สถานะ/ประเภท (query param เท่านั้น, ไม่ใช่ data exposure)
- ปุ่ม "ดูรายละเอียด"/"นำทาง" ต่อศูนย์ + aggregate-only no-PII test + demo filter + kill-switch

### T-59 — Public FAQ (dynamic) + EOC FAQ setup screen (CR-005 OP-1)

**Description:** FAQ บน public portal เป็น **dynamic** — อ่าน `GET /public/v1/faq`, content จัดการผ่าน setup screen ใน EOC back-office (dependency ใหม่จาก CR-005, แยกจาก EOC aggregate API ที่ reframe เป็น API-only)

**Definition of Done:**
- Public อ่าน `GET /public/v1/faq` (no-login, cache ได้) + render เป็นภาษาไทย mobile-first
- Back-office FAQ setup: CRUD รายการ FAQ (จำกัดสิทธิ์ตาม role-permission matrix), เผยแพร่/ซ่อนได้, มีผลกับ public ทันที (ไม่ cache ค้างเกินกำหนด)
- LINE OA / FB Page URL config (OP-2) เก็บใน setup เดียวกัน (ยังซ่อนปุ่มฝั่ง public ตอนนี้) + demo เพิ่ม/แก้ FAQ แล้วเห็นบน public

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| R3 | 17 | 11.5 |
| **รวม** | **17** | **11.5** |

> estimate provisional (CR-005, 2026-06-22) — recalibrate ตาม K-16. Team assignment ของ public-portal surface ต้องยืนยันใน workshop (K-13 follow-up).

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- `T-52` (Dashboard v1 — occupancy/vulnerable/capacity count) — module **Baseline** (แหล่ง occupancy_total/vulnerable_count)
- `T-35` (Resource-calc backbone + read-model perf — public aggregate read-model) — module **Platform/Core**
- `T-01` (RBAC + public-tier redaction whitelist) — module **Platform/Core**
- `T-47` (Shelter master + geo/config) — module **Baseline** (หมุด map + per-shelter capacity)
- `T-03` (Shared API convention — public endpoint) — module **Platform/Core**

**Related public-tier surface (คนละ module):** `/search` → [T-41](11-famsearch.md) (FAM) · `/donate` → [T-60](04-donation.md) (DN)
