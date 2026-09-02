---
title: "Step 05 — Public plane: Couch → Mongo → FastAPI → SPA"
status: in-progress
created: 2026-08-26
updated: 2026-09-02
depends_on: 00-foundation.md
note: ทำคู่ขนานกับ 01–03 ได้ ไม่ต้องรอ UI back-office เสร็จ
---

# Step 05 — Public plane

## เป้าหมาย

งานที่ประกาศจาก back-office ไปโผล่บนหน้า public ให้ประชาชนสมัครได้ และได้ตั๋วดิจิทัลกลับไป

## สถานะ ณ 2026-09-02

| ส่วน | สถานะ |
| --- | --- |
| 05.1 projector | ✅ `worker/src/worker/projectors/job.py` + `shift_assignment.py` |
| 05.2 FastAPI | ✅ `backend/apiapp/modules/volunteers/` (path จริงคือ `/public/v1/jobs`, ไม่ใช่ `/public/v1/volunteer/jobs` ตามที่แผนร่างไว้) |
| 05.3 BFF | ✅ ครบแล้ว — `jobs` (GET), `jobs/[id]/apply` (POST), `schedule`, `schedule/respond`, `ticket/*` |
| 05.4 SPA public | 🟡 board/ตั๋ว/พอร์ทัลต่อของจริงแล้ว · แท็บ "รวมสมัครพลังอาสา" กับ "ประกาศความต้องการกำลังพล" ใน `/volunteers/portal` ยังเป็น static markup |
| Tests | 🟡 unit BFF + domain ครบ · e2e AC-VOL-02 / AC-094-04 ยังไม่มี |

> **หมายเหตุ path:** แผนเดิมเขียน `POST /api/public/v1/volunteer/apply` — ของจริง implement เป็น
> `POST /api/public/v1/volunteer/jobs/[id]/apply` ให้ตรงกับ FastAPI `POST /public/v1/jobs/{job_id}/apply`
> ที่มีอยู่ก่อนแล้ว (งานที่สมัครต้องระบุใน path ไม่ใช่ใน body)

## 05.1 Worker projector (FR-VOL-13.1/13.2)

- [x] `worker/` — projector `public_jobs` จาก `job` doc
- [x] project เฉพาะ `status ∈ {open, almost_full}` — `draft`/`paused`/`full`/`closed`/`cancelled` ห้ามออก public (AC-094-04)
- [x] ฟิลด์ที่ project: title · description · skills_required · shift_template · quota + `slots_remaining` · `is_urgent` · shelter (ชื่อ/พิกัด) — **ห้ามมี PII**
- [ ] อัปเดต [couchdb-mongodb-sync.md](../../data/couchdb-mongodb-sync.md)

## 05.2 FastAPI

- [x] `backend/apiapp/modules/` — `GET /public/v1/jobs`, `GET /public/v1/volunteer/jobs/{id}`, `GET /public/v1/volunteer/ticket/{token}`, `POST /public/v1/volunteer/ticket/{token}/cancel`
- [x] tests ใต้ `backend/tests/` (`test_volunteers.py`)
- [x] `cd frontend && pnpm openapi:update` → commit `fastapi.json` + `openapi.d.ts`

## 05.3 BFF (CR-063 — ห้าม browser ยิง FastAPI ตรง)

- [x] อ่าน: `src/routes/api/public/v1/volunteer/**/+server.ts` (Bearer `EXTERNAL_API_SECRET`)
- [x] เขียน (สมัครงาน): `POST /api/public/v1/volunteer/jobs/[id]/apply` — reCAPTCHA v3 (fail-open เฉพาะ dev ที่ไม่ตั้งคีย์) + rate limit 3 ครั้ง/10 นาที ต่อ IP และต่อเบอร์ → forward ให้ FastAPI ซึ่งเขียน `job_application` + `volunteer` (FR-VOL-13.4)
- [x] auto-accept: `job.auto_accept && tier=operational && slots_remaining>0` → `confirmed` ทันที; controlled skill → `pending_review`

## 05.4 SPA public

- [x] `/volunteers/jobs` — 2 แท็บระดับเดียว: `ตลาดงานอาสา` · `ค้นหาตั๋วของฉัน` (AC-VOL-08)
- [x] `/volunteer/ticket/[token]` — Clean Single Ticket View + QR ความละเอียดสูง + 3 ปุ่ม (บันทึกรูป / คัดลอกลิงก์ / ขอยกเลิก)
- [x] **PII**: ไม่ส่ง `national_id` ออก response/UI · เบอร์ mask `xxx-xxx-1234` (AC-VOL-03)
- [x] `/volunteer/portal` (redirect → `/volunteers/portal?tab=portal`) — ตารางกะ + Dispatch Card `[ยอมรับ]`/`[ปฏิเสธ]` + Digital Role Card (คืนโควตาตาม `quota.ts`)
- [ ] ทุกหน้าใช้ `$lib/features/public-portal` barrel + `$lib/api/public-client.ts` เท่านั้น

## Tests

- [x] backend: projector filter, endpoint contract
- [x] frontend: BFF route tests (`jobs.test.ts`) + `isJobApplicable` + worker inbound `shift_responses`
- [ ] e2e: job `draft` ไม่โผล่ public → เปลี่ยนเป็น `open` แล้วโผล่ (AC-094-04) · สมัคร → ได้ตั๋ว ≤30 วินาที ไม่ต้องรับ SMS (AC-VOL-02) · decline จาก portal แล้วโควตา ⚪ +1 (AC-VOL-06)

## DoD

- [ ] `pnpm lint` · `pnpm check` · `pnpm test` + backend tests
- [ ] `fastapi.json` + `openapi.d.ts` commit แล้ว
