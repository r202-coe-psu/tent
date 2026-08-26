---
title: "Step 05 — Public plane: Couch → Mongo → FastAPI → SPA"
status: ready
created: 2026-08-26
updated: 2026-08-26
depends_on: 00-foundation.md
note: ทำคู่ขนานกับ 01–03 ได้ ไม่ต้องรอ UI back-office เสร็จ
---

# Step 05 — Public plane

## เป้าหมาย

งานที่ประกาศจาก back-office ไปโผล่บนหน้า public ให้ประชาชนสมัครได้ และได้ตั๋วดิจิทัลกลับไป

## 05.1 Worker projector (FR-VOL-13.1/13.2)

- [ ] `worker/` — projector `public_jobs` จาก `job` doc
- [ ] project เฉพาะ `status ∈ {open, almost_full}` — `draft`/`paused`/`full`/`closed`/`cancelled` ห้ามออก public (AC-094-04)
- [ ] ฟิลด์ที่ project: title · description · skills_required · shift_template · quota + `slots_remaining` · `is_urgent` · shelter (ชื่อ/พิกัด) — **ห้ามมี PII**
- [ ] อัปเดต [couchdb-mongodb-sync.md](../../data/couchdb-mongodb-sync.md)

## 05.2 FastAPI

- [ ] `backend/apiapp/modules/` — `GET /public/v1/volunteer/jobs`, `GET /public/v1/volunteer/jobs/{id}`, `GET /public/v1/volunteer/ticket/{token}`, `POST /public/v1/volunteer/ticket/{token}/cancel`
- [ ] tests ใต้ `backend/tests/`
- [ ] `cd frontend && pnpm openapi:update` → commit `fastapi.json` + `openapi.d.ts`

## 05.3 BFF (CR-063 — ห้าม browser ยิง FastAPI ตรง)

- [ ] อ่าน: `src/routes/api/public/v1/volunteer/**/+server.ts` (Bearer `EXTERNAL_API_SECRET`)
- [ ] เขียน (สมัครงาน): `POST /api/public/v1/volunteer/apply` — ตรวจ reCAPTCHA v3 (score ≥ 0.5) + rate limit 3 ครั้ง/10 นาที ต่อ IP และต่อเบอร์ → เขียน `job_application` + `volunteer` เข้า CouchDB ด้วยสิทธิ์ server (FR-VOL-13.4)
- [ ] auto-accept: `job.auto_accept && tier=operational && slots_remaining>0` → `confirmed` ทันที; controlled skill → `pending_review`

## 05.4 SPA public

- [ ] `/volunteers/jobs` — 2 แท็บระดับเดียว: `ตลาดงานอาสา` · `ค้นหาตั๋วของฉัน` (AC-VOL-08)
- [ ] `/volunteer/ticket/[token]` — Clean Single Ticket View + QR ความละเอียดสูง + 3 ปุ่ม (บันทึกรูป / คัดลอกลิงก์ / ขอยกเลิก)
- [ ] **PII**: ไม่ส่ง `national_id` ออก response/UI · เบอร์ mask `xxx-xxx-1234` (AC-VOL-03)
- [ ] `/volunteer/portal` — ตารางกะ + Dispatch Card `[ยอมรับ]`/`[ปฏิเสธ]` + Digital Role Card (คืนโควตาตาม `quota.ts`)
- [ ] ทุกหน้าใช้ `$lib/features/public-portal` barrel + `$lib/api/public-client.ts` เท่านั้น

## Tests

- [ ] backend: projector filter, endpoint contract
- [ ] e2e: job `draft` ไม่โผล่ public → เปลี่ยนเป็น `open` แล้วโผล่ (AC-094-04) · สมัคร → ได้ตั๋ว ≤30 วินาที ไม่ต้องรับ SMS (AC-VOL-02) · decline จาก portal แล้วโควตา ⚪ +1 (AC-VOL-06)

## DoD

- [ ] `pnpm lint` · `pnpm check` · `pnpm test` + backend tests
- [ ] `fastapi.json` + `openapi.d.ts` commit แล้ว
