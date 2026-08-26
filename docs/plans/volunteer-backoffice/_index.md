---
title: "Implementation Plan — Volunteer Backoffice (CR-094)"
status: active
created: 2026-08-26
updated: 2026-08-26
source_of_truth: docs/changes/CR-094-volunteer-backoffice-v10-reconcile.md
note: แผน implement เท่านั้น — ไม่ใช่ spec. ทุก requirement อ้าง CR-094 / CR-092; ถ้าขัดกัน CR ชนะ
---

# Implementation Plan — Volunteer Backoffice

## สรุป (TL;DR)

- **สร้างอะไร:** feature slice `frontend/src/lib/features/volunteers/` + หน้า back-office 1 หน้า 3 แท็บ ที่ `/back-office/volunteers` + kiosk เช็คอินแยกหน้า + CouchDB time-bound access + public plane sync
- **ลำดับ:** ทำทีละสเต็ปตามไฟล์ `00` → `05` — แต่ละสเต็ปจบในตัว (lint/check/test ผ่าน + demo ได้) ก่อนขึ้นสเต็ปถัดไป
- **ตอนนี้ทำได้เลย:** `00` → `01` → `02` → `03` (ส่วนที่ไม่ต้องใช้ admin credential)
- **ล็อกอยู่:** `04` (stable core รอ review), บางส่วนของ `03` (provisioning / โอนย้ายศูนย์ รอ open decisions CR-094 §7)

## ลำดับงาน

| # | ไฟล์แผน | ผลลัพธ์ที่จับต้องได้ | สถานะเริ่มได้ |
| --- | --- | --- | --- |
| 00 | [00-foundation.md](00-foundation.md) | schema.md อัปเดต + slice `features/volunteers/` (domain→data→application) + seed | ✅ เริ่มได้ |
| 01 | [01-tab-job-board.md](01-tab-job-board.md) | หน้า `/back-office/volunteers` + Control Hub + **แท็บ 1** Job Board & Capacity + Job CRUD | ✅ ต่อจาก 00 |
| 02 | [02-tab-roster-attendance.md](02-tab-roster-attendance.md) | **แท็บ 2** ตารางกะและเช็คอิน + kiosk `/back-office/volunteers/checkin` + audit trail | ✅ ต่อจาก 01 |
| 03 | [03-tab-volunteer-roster.md](03-tab-volunteer-roster.md) | **แท็บ 3** รายชื่อและการอนุมัติ + walk-in + ออกสิทธิ์ + โอนย้ายศูนย์ | ⚠️ บางส่วนรอเคาะ |
| 04 | [04-time-bound-access.md](04-time-bound-access.md) | CouchDB `validate_doc_update` + role grant/revoke ตามกะ | 🔒 stable core — รอ review |
| 05 | [05-public-plane.md](05-public-plane.md) | worker projector `public_jobs` + FastAPI + public board/ticket/portal | ✅ ทำคู่ขนานกับ 01–03 ได้หลัง 00 |

## Blockers ที่ค้างอยู่ (CR-094 §7)

| ID | คำถาม | บล็อกอะไร |
| --- | --- | --- |
| D-VOL-REVOKE | revoke role ตอนลืมเช็คเอาต์ — worker sweeper ทุก 5 นาที (แนะนำ) หรือตรวจตอน session refresh | 04 |
| D-VOL-TRANSFER-APPROVE | ใครอนุมัติโอนย้ายศูนย์ — ปลายทาง / ต้นทาง / two-phase | 03 (V-39) |
| D-VOL-PWDFLAG | เก็บ `must_change_password` ที่ `user_profile` doc หรือใน `_users` | 03 (V-38) |

> CR-094 ยัง `status: proposed` — สเต็ป 00 (แก้ `schema.md` + bump `schema_v`) **ต้องรอเจ้าของโครงการเคาะ CR ก่อน** ตาม [change-management.md](../../change-management.md) §6

## กติกาที่ทุกสเต็ปต้องยึด

- **Layer direction** `ui → application → data → domain` · import ข้ามฟีเจอร์ผ่าน barrel `$lib/features/volunteers` เท่านั้น ([CONVENTIONS.md](../../../frontend/CONVENTIONS.md))
- **Remote-first** — UI เขียน CouchDB ตรงผ่าน `$lib/db/repository.ts`; ใช้ `+server.ts` เฉพาะงานที่ต้องใช้ admin credential (grant role, provisioning, public write path)
- **ห้าม implement** แบนเนอร์ offline mode และโหมดสาธิต RBAC ที่เห็นใน mockup (CR-094 FR-VOL-08.7)
- **Reference slice:** `frontend/src/lib/features/referrals/` — ครบทุก layer + `server/` + tests ใช้เป็นแม่แบบ
- **DoD ทุกสเต็ป:** `pnpm lint` · `pnpm check` (0 error) · `pnpm test` · ทุก `.svelte` ผ่าน `svelte-autofixer`
