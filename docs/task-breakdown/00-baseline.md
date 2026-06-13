---
title: "Task Breakdown — Baseline (FR-1–20)"
status: active
created: 2026-06-11
updated: 2026-06-11
module: baseline
note: เพิ่ม manual 2026-06-11 (ปิดช่องว่างที่ _index ระบุ) — ยังไม่อยู่ใน _tasks.py ต้อง merge เข้าเมื่อ regenerate
---

# Baseline — Registration-first (FR-1–20)

> **Greenfield:** ยังไม่มีระบบ MVP มาก่อน (มีเพียง CouchDB PoC) — baseline scope FR-1–20 (auth, person registration, screening, person QR/movement, dashboard, export, offline, fallback) ต้อง **build เป็นส่วนแรกของ foundation** ก่อน R2 จะต่อยอด. Spec รายละเอียดอยู่ใน `docs/features/` + [Data Dictionary](../data/smart-shelter-data-dictionary.md)

- **Team owner:** กำหนดในการประชุม kickoff (K-13) — งานหลักคาดว่าอยู่กับทีม People + Lead pair (ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** Foundation (มิ.ย.–ก.ค. ขนาน/ก่อน R2 features)
- **Design input (บริษัท):** P-01 (ส่งแล้ว) + feature specs `docs/features/`
- **Target ส่งมอบ:** ภายใน Foundation Gate (17 ก.ค. 2026) — เป็น precondition ของหลาย feature R2/R3

หมายเหตุ: walking skeleton ของ Lead (10–17 มิ.ย.) ครอบ repo/CI/CD, auth/RBAC skeleton (T-01), Central CouchDB base schema + Central-first sync/conflict design (T-02 ตั้งต้น; LAN Edge เป็น outage fallback เท่านั้น) และ 1 vertical slice — task ในตารางนี้คือการ build baseline **เต็ม** ต่อจาก skeleton

## Features / Tasks

| ID | Feature / Task | FR | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-47 | Shelter master + config + seed data | FR-2..3 | prod | in-scope | 3 | ÷1.6 | 2 | T-02 |
| T-48 | Person registration (required ขั้นต่ำ name+gender) + แก้ไขข้อมูล | FR-4..5 | prod | in-scope | 6 | ÷1.6 | 4 | T-01,T-02 |
| T-49 | Screening: vulnerability flags / medical notes / fast-track ตาม role | FR-6..8 | prod | in-scope | 6 | ÷1.6 | 4 | T-48 |
| T-50 | Person Shelter ID/QR generation (payload ไม่มี PII/health) | FR-9 | prod | in-scope | 4 | ÷1.6 | 2.5 | T-48 |
| T-51 | Search + QR scan check-in/out + movement history + occupancy guardrail (warning-only) | FR-10..13 | prod | in-scope | 7 | ÷1.6 | 4.5 | T-50 |
| T-52 | Dashboard v1 (occupancy, capacity, vulnerable/fast-track count, in/out today, last-updated) | FR-14 | prod | in-scope | 6 | ÷1.6 | 4 | T-51 |
| T-53 | Export ตาม shelter/date/role + audit log + masking ตาม role | FR-15..16 | prod | in-scope | 5 | ÷1.25 | 4 | T-48 |
| T-54 | Offline draft/queue + Central-first PouchDB sync + LAN Edge fallback/conflict handling (registration/screening) | FR-17..18 | prod | in-scope | 10 | ÷1.25 | 8 | T-02,T-48 |
| T-55 | Manual/Excel fallback + assisted import | FR-19..20 | prod | in-scope | 5 | ÷1.25 | 4 | T-48 |
| | **รวมทั้งโมดูล** | | | | **52** | | **37** | |

> FR mapping เป็นการอิง baseline scope จาก kickoff §2 / `docs/features/` — [ASSUMPTION] เลข FR รายตัวยืนยันกับ feature specs อีกครั้งตอน workshop. Estimate ทั้งชุดเป็นค่าตั้งต้น เคาะจริงใน workshop 17/06 (K-16 recalibrate)

## Task Details

> DoD ทุก prod task ยึดมาตรฐานกลาง: **UI + API + data + test + demo ของ slice**

- **T-54 (offline sync) = tech risk #1 ของโครงการ** — app เขียน local PouchDB ก่อน, active remote มีได้หนึ่งเป้าหมาย (Central, Edge fallback, หรือ local-only), ห้าม long-lived sync ไป Central+Edge พร้อมกัน, และต้องทดสอบ failback ไม่ให้ duplicate; Lead B เป็นเจ้าของร่วม (ต่อจาก T-02); เริ่มทันทีหลัง skeleton อย่ารอท้าย phase
- T-48/T-49/T-51 คือเส้นหลักของ flow หน้างาน (register → screen → check-in) — เป็น vertical slice ที่ทีม copy pattern จาก walking skeleton
- T-52/T-53 ปิดท้าย เพราะต้องมี movement/audit data จริงให้แสดง/ตรวจ

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| Foundation (มิ.ย.–ก.ค.) | 52 | 37 |
| **รวม** | **52** | **37** |

## Dependencies

**ต้นทาง:** T-01 (RBAC skeleton), T-02 (data model + Central-first sync/fallback design) จาก walking skeleton

**ปลายทาง (block):** T-04 household (ขยายจาก person), T-40 search consent, dashboard/EOC metrics ทุกตัวอ่านข้อมูลที่ baseline ผลิต — Foundation Gate (T-20) ครอบ baseline ด้วย
