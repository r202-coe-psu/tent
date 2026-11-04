---
id: CR-160
title: Temporary RATE_LIMIT env switch — bypass donation & pre-register BFF rate limiters on local e2e and staging
status: superseded
superseded_by: CR-188
date: 2026-10-11
updated: 2026-10-23
requested_by: team A (donation) — e2e @critical failures
decided_by: เจ้าของโครงการ (PO, net-lynx) — approved 2026-10-11
layer: volatile
affects:
  - frontend/src/lib/server/security/rate-limiter.ts (RateLimiter.check)
  - frontend/playwright.config.ts (preview webServer env)
  - frontend/e2e/helpers/{e2e-env,donation-fullstack}.ts (pacer)
  - docker-compose.production.yml, docker-compose.staging.yml, docker-compose.staging.no-nginx.yml
  - .env.example, frontend/.env.example, frontend/e2e/.env.example
  - Jenkins credential tent-staging-e2e-env
  - CR-005 §F (donation booking 3/min/IP), CR-080 (edit limits) — values unchanged
  - no schema_v bump
---

# CR-160 — RATE_LIMIT env switch (donation & pre-register BFF limiters)

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม option `bypassable: true` ใน `RateLimiter` และเพิ่ม server env `RATE_LIMIT` —
>   ปิดเฉพาะ limiter ของฟอร์มสาธารณะที่ e2e ใช้ (donation, pre-register) เมื่อ `RATE_LIMIT=false`/`0`;
>   limiter อื่น (auth, third-party secret, link-account, volunteer) ยังทำงานตลอดเวลา (`bypassable: false`)
> - **ใช้ที่ไหน:** ตั้ง `false` บน local e2e (`vite preview`) และใน `.env` ที่ root ของ server staging / Jenkins credential `tent-staging-e2e-env`; compose ทุกตัว (รวม prod) ใช้ `RATE_LIMIT: ${RATE_LIMIT:-true}`; `.env` บน prod ห้ามตั้ง `false`
> - **ทำไม:** e2e donation `@critical` fail ด้วย `RATE_LIMITED` (แชร์ IP เดียว) และ pacer หน่วง 61 s ทำให้รันช้า
> - **เงื่อนไขเลิกใช้:** เมื่อ e2e helper ส่ง key แยก per-test ได้ หรือเมื่อ staging เปิด public (อย่างใดถึงก่อน); วันทบทวน 2026-11-10 · ไม่เปลี่ยนค่า limit เดิม · ไม่ bump `schema_v`

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
| BFF limiter ของ donation & pre-register (`bypassable: true`) | บังคับเสมอ (ยกเว้น loopback ใน `dev`) | ข้ามการนับเมื่อ `bypassable: true` และตั้ง `RATE_LIMIT=false`/`0` |
| BFF limiter อื่นทั้งหมด (auth, secret reveal, link-account, volunteer) | บังคับเสมอ (ยกเว้น loopback ใน `dev`) | บังคับเสมอทุกสภาพแวดล้อม ไม่ว่า `RATE_LIMIT` จะเป็นอะไร (`bypassable: false`) |
| Compose files (production, staging, staging.no-nginx) | ไม่มี `RATE_LIMIT` env | ตั้ง `RATE_LIMIT: ${RATE_LIMIT:-true}` (default fail-closed เป็น `true`) |
| Production `.env` | ไม่มี `RATE_LIMIT` | ห้ามตั้ง `false` เด็ดขาด (คง default `true`) |
| e2e pacer | เปิด default (`DONATION_E2E_PACE=0` ปิด) | เปิดเฉพาะเมื่อ limiter เปิด และ `DONATION_E2E_PACE !== '0'` |

### ขอบเขต Limiter (Limiter Scope Table)

| หมวดหมู่ | Instance / Symbol | ตำแหน่งในโค้ด | ปิดได้ (`bypassable: true`) | เหตุผล / ขอบเขต |
| --- | --- | --- | :---: | --- |
| Donation | `donationIpLimiter` | `rate-limiter.ts:104` | ✅ ปิดได้ (`true`) | ฟอร์มจองบริจาคสาธารณะ (IP) — e2e suite ยิงทดสอบ |
| Donation | `donationPhoneLimiter` | `rate-limiter.ts:106` | ✅ ปิดได้ (`true`) | ฟอร์มจองบริจาคสาธารณะ (เบอร์โทร) — e2e suite ยิงทดสอบ |
| Donation | `donationEditLimiter` | `rate-limiter.ts:114` | ✅ ปิดได้ (`true`) | แก้ไข/ยกเลิกบริจาค — e2e suite ยิงทดสอบ |
| Donation | `donationReadLimiter` | `rate-limiter.ts:120` | ✅ ปิดได้ (`true`) | อ่าน ticket บริจาค — e2e suite ยิงทดสอบ |
| Pre-register | `registerIpLimiter` | `rate-limiter.ts:125` | ✅ ปิดได้ (`true`) | ลงทะเบียนล่วงหน้าสาธารณะ (IP) — e2e suite ยิงทดสอบ |
| Pre-register | `registerPhoneLimiter` | `rate-limiter.ts:126` | ✅ ปิดได้ (`true`) | ลงทะเบียนล่วงหน้าสาธารณะ (เบอร์โทร) — e2e suite ยิงทดสอบ |
| Pre-register | `registerLookupIpLimiter` | `rate-limiter.ts:128` | ✅ ปิดได้ (`true`) | ค้นหาข้อมูลลงทะเบียน — e2e suite ยิงทดสอบ |
| Auth / Security | `loginCaptchaIpLimiter` | `rate-limiter.ts:78` | ❌ **ห้ามปิด** (`false`) | Staff login captcha verify — ป้องกัน credential-stuffing |
| Auth / Security | `loginResolveIpLimiter` | `rate-limiter.ts:84` | ❌ **ห้ามปิด** (`false`) | Staff login identifier resolve — ป้องกัน user enumeration |
| Auth / Security | `thirdPartyClientSecretRevealLimiter` | `rate-limiter.ts:92` | ❌ **ห้ามปิด** (`false`) | Client secret reveal — ป้องกัน brute-force รหัสผ่าน |
| Auth / Security | `linkAccountNonceLimiter` | `rate-limiter.ts:98` | ❌ **ห้ามปิด** (`false`) | Link account attempts per nonce — ป้องกัน brute-force OAuth link |
| Auth / Security | `linkAccountIpLimiter` | `rate-limiter.ts:101` | ❌ **ห้ามปิด** (`false`) | Link account per IP — ป้องกัน brute-force OAuth link |
| Volunteer | `volunteerApplyIpLimiter` | `rate-limiter.ts:138` | ❌ **ห้ามปิด** (`false`) | สมัครอาสาสมัครสาธารณะ per IP |
| Volunteer | `volunteerApplyPhoneLimiter` | `rate-limiter.ts:140` | ❌ **ห้ามปิด** (`false`) | สมัครอาสาสมัครสาธารณะ per phone |
| Volunteer | `volunteerTicketFindLimiter` | `rate-limiter.ts:146` | ❌ **ห้ามปิด** (`false`) | ค้นหาตั๋วอาสาสมัคร — ป้องกัน enumeration |
| Volunteer | `volunteerTicketLimiter` | `rate-limiter.ts:148` | ❌ **ห้ามปิด** (`false`) | อ่าน/ยกเลิกตั๋วอาสาสมัคร |
| Volunteer | `volunteerProfileUpdateLimiter` | `rate-limiter.ts:161` | ❌ **ห้ามปิด** (`false`) | แก้ไขโปรไฟล์อาสาสมัคร |
| Volunteer | `volunteerDispatchRespondLimiter` | `rate-limiter.ts:163` | ❌ **ห้ามปิด** (`false`) | ตอบรับจัดสรรกะงานอาสาสมัคร |
| อื่น ๆ ทั้งหมด | Instance ใหม่ในอนาคต | - | ❌ **ห้ามปิด** (`false`) | Default constructor คือ `bypassable: false` เพื่อความปลอดภัย (fail-closed) |

> **หมายเหตุ 2026-10-18 (#625, [CR-127 note](../06-A-volunteer/CR-127-volunteer-permanent-tracking-token.md)):**
> portal lookup (`access/resolve`, `profile`, `schedule`, `schedule/action`, `ticket/find`) ที่ใช้ minted token
> `TKT-VOL-` นับใน `volunteerTicketLimiter`; เบอร์โทรและรหัสที่เดาได้ยังนับใน `volunteerTicketFindLimiter` —
> ทั้งสองตัวยังห้ามปิดตามตารางนี้

### Requirements

- **FR-1** — `RateLimiter` เพิ่ม option `bypassable: boolean` (default `false`) ใน constructor (`constructor(windowMs, maxRequests, options?: { bypassable?: boolean })`):
  - กำหนด `bypassable: true` เฉพาะกับ limiter ของ donation และ pre-register ตามตารางขอบเขต
  - limiter ของ auth, third-party secret reveal, link-account, volunteer และ limiter อื่นทั้งหมดใช้ค่า default `bypassable: false`
- **FR-2** — `RateLimiter.check()` อ่าน `RATE_LIMIT` ผ่าน `$env/dynamic/private` (server-only runtime; ห้ามเป็น `PUBLIC_*`)
- **FR-3** — การ bypass จะเกิดขึ้นก็ต่อเมื่อ `this.bypassable === true` **และ** ค่า `RATE_LIMIT` (หลัง trim, case-insensitive) เป็น `'false'` หรือ `'0'`:
  - เมื่อเข้าเงื่อนไข bypass, `check()` จะคืน `true` ทุก key และไม่บันทึก hit ลง store
  - หาก `bypassable === false` (หรือไม่ได้ระบุ), `check()` จะนับและบังคับ limit ปกติเสมอไม่ว่า `RATE_LIMIT` จะถูกตั้งค่าเป็นอะไร
- **FR-4** — พฤติกรรม bypass loopback เมื่ออยู่ในโหมด `dev` (`$app/environment`) ยังคงทำงานตามเดิมกับทุก limiter
- **FR-5** — `frontend/playwright.config.ts` ส่ง `RATE_LIMIT` (default `'false'`) ให้ preview server และ test worker; override ด้วย `RATE_LIMIT=true` ได้
- **FR-6** — ไฟล์ compose ทั้งหมด (`docker-compose.production.yml`, `docker-compose.staging.yml`, `docker-compose.staging.no-nginx.yml`) อ่าน `RATE_LIMIT` จาก `.env` ที่ root ของแต่ละ server และส่งให้ service `frontend` ด้วยรูปแบบ:
  ```yaml
  RATE_LIMIT: ${RATE_LIMIT:-true}
  ```
  **ห้ามใช้ค่าเริ่มต้น `false` ในไฟล์ compose** (ต้อง fail-closed เป็น `true`)
- **FR-7** — จะปิด limiter ได้ก็ต่อเมื่อตั้ง `RATE_LIMIT=false` ไว้ใน `.env` ที่ root ของ server staging หรือใน Jenkins credential `tent-staging-e2e-env` เท่านั้น; ห้ามตั้ง `RATE_LIMIT=false` ใน `.env` ของ production เด็ดขาด (production กับ staging อยู่คนละ server)
- **FR-8** — Jenkins credential `tent-staging-e2e-env` เพิ่ม `RATE_LIMIT=false` เพื่อให้ runner ปิด pacer
- **FR-9** — `.env.example`, `frontend/.env.example`, `frontend/e2e/.env.example` มี entry `RATE_LIMIT` พร้อมคำเตือน "never false in prod; compose defaults to true"

### Out of scope

- FastAPI limiter (30 req/min/IP ใน `backend/apiapp/modules/donations/router.py` และ module อื่น) — switch นี้ไม่ครอบ
- ค่า limit ของแต่ละ surface (CR-005, CR-080) ไม่เปลี่ยน

## Impact

- Code: `frontend/src/lib/server/security/rate-limiter.ts` (+ unit test)
- E2E: `frontend/playwright.config.ts`, `frontend/e2e/helpers/{e2e-env,donation-fullstack}.ts`,
  `frontend/e2e/public-pre-register-flow.test.ts`, `frontend/e2e/donation-fullstack*.test.ts`, `frontend/e2e/README.md`
- Infra: `docker-compose.production.yml`, `docker-compose.staging.yml`, `docker-compose.staging.no-nginx.yml`, `.env` ที่ root ของ staging/prod servers, Jenkins `tent-staging-e2e-env`
- Security: เมื่อเปิดสวิตช์ `RATE_LIMIT=false` บน staging จะ bypass เฉพาะฟอร์มสาธารณะที่ e2e ใช้ (donation และ pre-register); ส่วน critical gate (login, captcha, secret reveal, link-account, volunteer) ยังมี rate limit คุ้มกันตลอดเวลา. ทั้งนี้ staging ถูกปิดไม่ให้ public ทั่วไปเข้าถึง โดยใช้ IP allowlist (จำกัดเฉพาะ IP ของ Jenkins/CI runner, VPN ภายใน และเครือข่ายทีมพัฒนา)
- Coverage: e2e local/staging ไม่ทดสอบพฤติกรรม limiter จริงของ donation/pre-register — ครอบคลุมด้วย unit test ของ `RateLimiter` แทน

## Acceptance

- [ ] ไม่ตั้ง `RATE_LIMIT` หรือตั้งเป็นค่าอื่นที่ไม่ใช่ `false`/`0` → limiter ทุกตัวทำงานปกติ, booking ครั้งที่ 4 ใน 1 นาทีจาก IP เดียวได้ `RATE_LIMITED` (unit test)
- [ ] `RATE_LIMIT=false` → limiter ที่มี `bypassable: true` (donation, pre-register) จะไม่ติด `RATE_LIMITED` (unit test)
- [ ] `RATE_LIMIT=false` → limiter ที่ไม่ได้ใส่ `bypassable` (`bypassable: false` เช่น `loginCaptchaIpLimiter`, `loginResolveIpLimiter`, `thirdPartyClientSecretRevealLimiter`, `linkAccountIpLimiter`, `volunteerApplyIpLimiter`) **ยังคงบล็อกคำขอเมื่อเกินโควตาตามปกติ** (unit test)
- [ ] ไฟล์ compose ทั้งหมด (`docker-compose.production.yml`, `docker-compose.staging.yml`, `docker-compose.staging.no-nginx.yml`) มี `RATE_LIMIT: ${RATE_LIMIT:-true}`
- [ ] `.env` ที่ root ของ server staging หรือ Jenkins credential `tent-staging-e2e-env` มีการตั้ง `RATE_LIMIT=false`; ส่วน `.env` ของ production ไม่มีการตั้ง `RATE_LIMIT=false`
- [ ] `./scripts/run-e2e-headed.sh local --critical` ผ่านครบโดยไม่มี pacer sleep

## Open issues (พบระหว่างไล่สาเหตุ — แยก ticket)

- **FastAPI shared bucket ([#458](https://github.com/r202-coe-psu/tent/issues/458)):** BFF ไม่ส่ง `X-Real-IP` / `X-Forwarded-For` ไป FastAPI → `client_ip()`
  (`backend/apiapp/utils/request_meta.py`) เห็น IP ของ BFF → ผู้บริจาคทั้งระบบอาจแชร์ 30/min เดียวกันบน prod
- **`track-search` และ race test ([#459](https://github.com/r202-coe-psu/tent/issues/459)):**
  - `track-search` ใช้ `donationIpLimiter` ร่วมกับการสร้าง booking → การค้นหา ticket กินโควตาการจอง
  - `donation-fullstack-race` ชน rate limit เมื่อยิง request พร้อมกัน ทำให้ไม่สามารถทดสอบ invariant การจอง slot ได้
- **W5 pre-register 502** (`public-pre-register-flow.test.ts`) หายไปหลังเปิด switch แต่ยังไม่ได้ยืนยันสาเหตุ

## Sunset Criteria & Review Date

- **เงื่อนไขเลิกใช้:** ยกเลิกการใช้สวิตช์ `RATE_LIMIT` (ถอด bypass option ออกและกลับมาบังคับ limiter เต็มรูปแบบ) เมื่อเข้าเงื่อนไขข้อใดข้อหนึ่งต่อไปนี้ แล้วแต่อย่างไหนถึงก่อน:
  1. e2e helper สามารถส่ง rate-limit key แยกให้แต่ละ test ได้ (isolated per-test bucket) ทำให้ไม่ชนโควตากัน
  2. Staging เปิดให้บุคคลภายนอก (public) ใช้งาน
- **วันทบทวน:** 2026-11-10

## Migration

N/A — ไม่เปลี่ยน shape ที่ persist

## Decision log

- 2026-10-11 — proposed; implementation อยู่บน branch `team-A-donation` (commit `87ad8dea`)
- 2026-10-11 — PO review blocker resolution:
  - จำกัดขอบเขตสวิตช์เฉพาะฟอร์มสาธารณะที่ e2e ใช้ (donation, pre-register) ด้วย option `bypassable: true` ใน `RateLimiter`; ห้ามปิด auth, secret reveal, link-account, volunteer
  - กำหนดแหล่งค่าและค่าเริ่มต้น: compose ทุกตัว (`production`, `staging`, `staging.no-nginx`) ใช้ `RATE_LIMIT: ${RATE_LIMIT:-true}` อ่านจาก `.env` ที่ root ของ server; ปิดได้เฉพาะบน staging/Jenkins ห้ามตั้ง `false` บน production
  - กำหนดเงื่อนไขเลิกใช้สวิตช์ (e2e per-test key หรือ staging เปิด public) และกำหนดวันทบทวนเป็น 2026-11-10
- 2026-10-11 — PO review warning resolution:
  - ระบุมาตรการควบคุมการเข้าถึง staging ด้วย IP allowlist (จำกัดเฉพาะ IP ของ CI/Jenkins, VPN ภายใน และเครือข่ายทีมพัฒนา)
  - เปิด GitHub issue ติดตามผลแยก 2 เรื่อง: [#458](https://github.com/r202-coe-psu/tent/issues/458) (FastAPI shared bucket) และ [#459](https://github.com/r202-coe-psu/tent/issues/459) (track-search & race test)
- 2026-10-11 — **approved with conditions** (PO, net-lynx) — spec only, ยังไม่ implement:
  - (a) เลข CR-160 ใช้เลขถัดไปจาก `_index.md` บน develop (CR-158 ใช้แล้ว, CR-159 จองโดย #426); ไฟล์อยู่ที่ `docs/changes/04-donation/`
  - (b) implementation ต้องมาเป็น **code PR ใหม่** ที่มีเฉพาะ commit สวิตช์ `87ad8dea` ปรับตามขอบเขตที่ approve (`bypassable: true` เฉพาะ limiter ของ donation + pre-register) แยกจาก `team-A-donation` และ CR-157; **ห้าม merge `team-A-donation` ตรง ๆ**
- 2026-10-23 — **superseded by [CR-188](../01-core/CR-188-rate-limit-to-nginx.md):** limiter ในแอปถูกลบทั้งหมด จึงไม่มีอะไรให้ `RATE_LIMIT` ปิด; e2e บน staging ใช้ nginx allowlist IP ของ runner แทน (CR-188 FR-7)
