---
id: draft
title: Temporary RATE_LIMIT env switch — disable BFF rate limiters on local e2e and staging
status: proposed
date: 2026-10-11
requested_by: team A (donation) — e2e @critical failures
decided_by: project owner
layer: volatile
affects:
  - frontend/src/lib/server/security/rate-limiter.ts (RateLimiter.check)
  - frontend/playwright.config.ts (preview webServer env)
  - frontend/e2e/helpers/{e2e-env,donation-fullstack}.ts (pacer)
  - docker-compose.staging.yml, docker-compose.staging.no-nginx.yml
  - .env.example, frontend/.env.example, frontend/e2e/.env.example
  - Jenkins credential tent-staging-e2e-env
  - CR-005 §F (donation booking 3/min/IP), CR-080 (edit limits) — values unchanged
  - no schema_v bump
---

# draft-e2e-donations-temporary-disable-rate-limit — RATE_LIMIT env switch

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม server env `RATE_LIMIT` เป็น master switch ของ `RateLimiter` ทุกตัวใน BFF —
>   default **เปิด** (`true`); `false`/`0` ปิด limiter ทุก key
> - **ใช้ที่ไหน:** ตั้ง `false` บน local e2e (`vite preview`) และ staging เท่านั้น; production ไม่ตั้ง → limit คงเดิม
> - **ทำไม:** e2e donation `@critical` fail ด้วย `RATE_LIMITED` (ทุก suite ใช้ IP เดียว) และ pacer หน่วง 61 s ทำให้รันช้า
> - **ไม่เปลี่ยน** ค่า limit ของ CR-005 / CR-080 · ไม่ bump `schema_v` · เป็นมาตรการ **ชั่วคราว**

---

## Why

- `RateLimiter.check()` ยกเว้น loopback เฉพาะตอน `dev` (`vite dev`). Playwright local
  (`playwright.config.ts`, `scripts/run-e2e-headed.sh local`) รัน `vite preview` = production build →
  limiter ทำงานเต็ม และทุก suite แชร์ `127.0.0.1`
- อาการที่พบ (2026-10-10, `run-e2e-headed.sh local --critical`):
  - `donation-fullstack-race` — ฝั่งที่แพ้ race ได้ `RATE_LIMITED` แทน `SLOT_FULL` → ทดสอบ invariant ของ slot ไม่ได้
  - `donation-fullstack` — booking POST `RATE_LIMITED`
  - `donation-fullstack-admin` — donor cancel ไม่ถูกบันทึก (status ค้าง `pending_review`)
- workaround เดิม (e2e pacer, `sleep(61_000)`) ทำให้ 3 donation suites ใช้ 10–15 นาที และยังพลาดกรณี
  `track-search` ที่ใช้ `donationIpLimiter` ร่วมกับการจอง และ request พร้อมกันใน race test
- หลังเปิด switch: `--critical` 64/64 ผ่าน, ~5 นาที

## Change

| ด้าน | Before | After |
| --- | --- | --- |
| BFF limiter บน `vite preview` / staging | บังคับเสมอ (ยกเว้น loopback ใน `dev`) | บังคับ เว้นแต่ `RATE_LIMIT=false`/`0` |
| Production | บังคับ | บังคับ (ไม่ตั้งค่า = เปิด) |
| e2e pacer | เปิด default (`DONATION_E2E_PACE=0` ปิด) | เปิดเฉพาะเมื่อ limiter เปิด และ `DONATION_E2E_PACE !== '0'` |

### Requirements

- **FR-1** — `RateLimiter.check()` อ่าน `RATE_LIMIT` ผ่าน `$env/dynamic/private` (server-only runtime; ห้ามเป็น `PUBLIC_*`)
- **FR-2** — เฉพาะค่า `false` หรือ `0` (trim, case-insensitive) ปิด limiter; unset / ว่าง / ค่าอื่น = เปิด
- **FR-3** — เมื่อปิด `check()` คืน `true` ทุก key และไม่บันทึก hit
- **FR-4** — bypass loopback ตอน `dev` คงเดิม
- **FR-5** — `playwright.config.ts` ส่ง `RATE_LIMIT` (default `false`) ให้ preview server และ test worker; override ด้วย `RATE_LIMIT=true` ได้
- **FR-6** — `docker-compose.staging*.yml` ตั้ง `RATE_LIMIT: ${RATE_LIMIT:-false}` ให้ service frontend; `docker-compose.production*.yml` ห้ามตั้ง
- **FR-7** — Jenkins credential `tent-staging-e2e-env` เพิ่ม `RATE_LIMIT=false` เพื่อปิด pacer ฝั่ง runner
- **FR-8** — `.env.example` ทุกตัวที่เกี่ยวข้องมี entry `RATE_LIMIT` พร้อมคำเตือน "never false in prod"

### Out of scope

- FastAPI limiter (30 req/min/IP ใน `backend/apiapp/modules/donations/router.py` และ module อื่น) — switch นี้ไม่ครอบ
- ค่า limit ของแต่ละ surface (CR-005, CR-080) ไม่เปลี่ยน

## Impact

- Code: `frontend/src/lib/server/security/rate-limiter.ts` (+ unit test)
- E2E: `frontend/playwright.config.ts`, `frontend/e2e/helpers/{e2e-env,donation-fullstack}.ts`,
  `frontend/e2e/public-pre-register-flow.test.ts`, `frontend/e2e/donation-fullstack*.test.ts`, `frontend/e2e/README.md`
- Infra: `docker-compose.staging.yml`, `docker-compose.staging.no-nginx.yml`, Jenkins `tent-staging-e2e-env`
- Security: staging ไม่มี BFF rate limit ขณะ switch ปิด — staging ต้องไม่เปิดให้ public ทั่วไปใช้งาน
- Coverage: e2e local/staging ไม่ทดสอบพฤติกรรม limiter จริงอีกต่อไป — ครอบด้วย unit test ของ `RateLimiter` แทน

## Acceptance

- [ ] ไม่ตั้ง `RATE_LIMIT` → booking ครั้งที่ 4 ใน 1 นาทีจาก IP เดียวได้ `RATE_LIMITED` (unit test)
- [ ] `RATE_LIMIT=false` → ไม่มี `RATE_LIMITED` จาก BFF (unit test)
- [ ] `./scripts/run-e2e-headed.sh local --critical` ผ่านครบโดยไม่มี pacer sleep
- [ ] production compose ไม่มี `RATE_LIMIT`

## Open issues (พบระหว่างไล่สาเหตุ — แยก ticket)

- **FastAPI shared bucket:** BFF ไม่ส่ง `X-Real-IP` / `X-Forwarded-For` ไป FastAPI → `client_ip()`
  (`backend/apiapp/utils/request_meta.py`) เห็น IP ของ BFF → ผู้บริจาคทั้งระบบอาจแชร์ 30/min เดียวกันบน prod
- **`track-search` ใช้ `donationIpLimiter`** ร่วมกับการสร้าง booking → การค้นหา ticket กินโควตาการจอง
- **W5 pre-register 502** (`public-pre-register-flow.test.ts`) หายไปหลังเปิด switch แต่ยังไม่ยืนยันสาเหตุ

> [NEEDS DECISION: เงื่อนไขยกเลิกมาตรการชั่วคราว — เช่น ปิด switch บน staging เมื่อ e2e helper รองรับ
> limiter แยก per-test key หรือเมื่อ staging เปิด public; และกำหนดวันทบทวน]

## Migration

N/A — ไม่เปลี่ยน shape ที่ persist

## Decision log

- 2026-10-11 — proposed; implementation อยู่บน branch `team-A-donation` (commit `87ad8dea`)
