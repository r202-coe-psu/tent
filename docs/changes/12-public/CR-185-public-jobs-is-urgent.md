---
id: CR-185
title: public_jobs.is_urgent — การ์ดจิตอาสาหน้าแรกนับเฉพาะงานเร่งด่วนจากข้อมูลจริง
status: approved
date: 2026-10-21 (approved 2026-10-22)
requested_by: feedback หน้างาน 2026-10-20 (issue #709 — การ์ดหน้าแรกแสดง "ต้องการอีก 0 คน" เสมอ)
decided_by: ผู้รับ issue (@mhapong — เลือก "เฉพาะงานเร่งด่วน" และ track ด้วย CR, 2026-10-21) · approve CR โดย @mhapong 2026-10-22
layer: volatile
affects:
  - docs/data/schema.md §9.2 public_jobs (field ใหม่ `is_urgent`)
  - packages/tent-model/src/tent_model/public_job.py (`PublicJob.is_urgent`)
  - worker/src/worker/projectors/job.py · worker/src/worker/projection_version.py (`PROJECTION_VERSION` 5 → 6)
  - backend/apiapp/modules/volunteers/schemas.py · use_case.py (`PublicJobItem.is_urgent` ใน GET /public/v1/jobs)
  - frontend/src/lib/api-specs/fastapi.json · frontend/src/lib/api/openapi.d.ts
  - frontend/src/lib/features/volunteer-portal/domain/urgent-need.ts (`summarizeUrgentVolunteerNeed`)
  - frontend/src/routes/(public)/+page.svelte (การ์ด KPI + รายการจิตอาสา)
  - no schema_v bump (CouchDB `job.is_urgent` มีอยู่แล้วใน §2.17)
---

# CR-185 — public_jobs.is_urgent — การ์ดจิตอาสาหน้าแรกนับเฉพาะงานเร่งด่วนจากข้อมูลจริง

> **สรุป (TL;DR):**
>
> - หน้าแรก public การ์ด "ต้องการอีก n คน (มีแล้ว m คน) — จิตอาสาสำหรับงานอาสาสมัครเร่งด่วน" ต้องนับจาก**งานที่เจ้าหน้าที่
>   ติดธงเร่งด่วน** (`job.is_urgent`) ที่ยังเปิดรับ แทนค่า 0 ที่ hardcode ไว้
> - projection `public_jobs` ต้องมี `is_urgent` (คัดลอกจาก CouchDB) และ `GET /public/v1/jobs` ต้องส่ง field นี้ ·
>   `PROJECTION_VERSION` 5 → 6 (worker bootstrap ใหม่หลัง deploy) · ไม่ bump `schema_v`

---

## Why

- ค่าบนการ์ดถูก hardcode เป็น 0 ตั้งแต่ overhaul หน้าแรก (`af5f65104`) และไม่เคยต่อข้อมูลจริง — ประชาชนเห็น "ต้องการอีก 0 คน"
  ทั้งที่มีงานเปิดรับ (#709)
- การ์ดเขียนว่า "งานอาสาสมัคร**เร่งด่วน**" จึงต้องนับเฉพาะงานที่ติดธงด่วน แต่ธงนี้มีแค่ใน CouchDB (`job.is_urgent`, §2.17) —
  projection `public_jobs` ที่ FastAPI ส่งให้ public plane ไม่มี จึงต้องเพิ่ม field ใน projection

## Change

| | ก่อน | หลัง |
| --- | --- | --- |
| `public_jobs` (§9.2) | ไม่มี `is_urgent` | `is_urgent: bool` (default `false`) จาก `job.is_urgent` |
| `GET /public/v1/jobs` | ไม่ส่ง | `jobs[].is_urgent` |
| การ์ด KPI หน้าแรก | `0` / `0` เสมอ | ผลรวมจากงานเร่งด่วนที่เปิดรับ |
| รายการจิตอาสาหน้าแรก | ว่างเสมอ | 1 การ์ดต่อศูนย์ที่มีงานเร่งด่วนยังรับได้ |

**Requirements**

- FR-1 — projector `job` ต้องเขียน `is_urgent = bool(job.is_urgent)` ลง `public_jobs` (ไม่มีค่า = `false`)
- FR-2 — `GET /public/v1/jobs` ต้องส่ง `is_urgent` ต่องาน; BFF `GET /api/public/v1/volunteer/jobs` ส่งต่อโดยไม่แก้
  (CouchDB fallback ของ BFF ส่ง field นี้อยู่แล้ว)
- FR-3 — **ต้องการอีก** = ผลรวม `slots_remaining` ของงานที่ `is_urgent = true` และ `status = open`
- FR-4 — **มีแล้ว** = ผลรวม `slots_confirmed` ของงานชุดเดียวกับ FR-3
- FR-5 — รายการจิตอาสา: 1 การ์ดต่อศูนย์ที่มีงานตาม FR-3 ที่ยังมี `slots_remaining > 0` เรียงศูนย์ที่ขาดมากสุดก่อน;
  การ์ดแสดงชื่องาน (ขาดมากสุดก่อน), สัดส่วนที่มีแล้วต่อโควตา และจำนวนที่ยังขาด
- FR-6 — ระหว่างโหลด หรืออ่านกระดานงานไม่ได้ (เช่น API ล่ม / rate limit) การ์ดต้องแสดง "—" ไม่ใช่ `0`
  และหน้าแรกต้องใช้งานส่วนอื่นได้ตามปกติ
- FR-7 — คำนวณด้วยฟังก์ชัน pure `summarizeUrgentVolunteerNeed` (feature `volunteer-portal`) พร้อม unit test

## Acceptance

- ไม่มีงานเร่งด่วน → การ์ดแสดง "ต้องการอีก 0 คน (มีแล้ว 0 คน)" และรายการแสดงข้อความว่างเดิม
- งานเร่งด่วนเปิดรับ 2 งาน (ขาด 6 + 2, มีแล้ว 4 + 3) → "ต้องการอีก 8 คน (มีแล้ว 7 คน)"
- งานที่ไม่ติดธงด่วน หรือสถานะไม่ใช่ `open` ไม่ถูกนับ
- worker bootstrap หลัง deploy เติม `is_urgent` ให้ `public_jobs` ทุกแถว (รวมศูนย์ที่ไม่มีการเปลี่ยนแปลง)

## Impact

- **worker:** projector + `PROJECTION_VERSION` 6 → bootstrap ทั้งชุดหนึ่งครั้งเมื่อ deploy
- **tent-model / backend:** field ใหม่แบบมีค่า default — แถวเก่าก่อน bootstrap อ่านได้เป็น `false`
- **frontend:** type `PublicJob.is_urgent?` (optional เผื่อ projection เก่า), regenerate OpenAPI types, หน้าแรกเพิ่มการเรียก
  `GET /api/public/v1/volunteer/jobs` หนึ่งครั้งต่อการเปิดหน้า (ใช้ rate limit 30/นาที/IP ร่วมกับหน้ากระดานงาน — เกินแล้ว
  การ์ดแสดง "—" ตาม FR-6)
- **partner / external API:** ไม่กระทบ (`public_jobs` ไม่อยู่ใน `/external/v1/*`)

## Migration

ไม่มี migration ของเอกสาร CouchDB (`job.is_urgent` มีอยู่แล้ว). MongoDB: worker เห็น `PROJECTION_VERSION` เพิ่มแล้ว bootstrap
ใหม่เอง — แถวที่ยังไม่ถูกเขียนใหม่อ่าน `is_urgent` เป็น `false` (default ของ model)

## Decision log

- 2026-10-20 — #709 เปิด issue (Phase 3) จาก feedback หน้างาน
- 2026-10-21 — ผู้รับ issue เลือกนับ "เฉพาะงานเร่งด่วน" และให้ track ด้วย draft CR ใน PR; พบว่าต้องเพิ่ม field ใน projection
- 2026-10-21 — proposed
- 2026-10-22 — ตอบ review PR #727: หน้าแรกใช้ `staleTime` 60 วินาที + ไม่ refetch ตอนสลับแท็บ; แยก rate limiter ของการอ่าน public ไปเป็น #761
- 2026-10-22 — approved → CR-185 (implement ใน PR #727)
