---
id: CR-188
title: ย้าย rate limit ทั้งหมดออกจาก application layer ไปที่ nginx (`limit_req`) + บังคับ real client IP ทุก environment
status: approved
date: 2026-10-23
updated: 2026-10-23
requested_by: Soravit (issue #627); ทดสอบใช้งานจริง ~10 คนติด 429; เป้าหมายผู้ใช้พร้อมกันหลักพัน
decided_by: เจ้าของโครงการ — approved 2026-10-23 ("เอา rate limit ทุกอย่างออก ดักที่ nginx อย่างเดียว")
layer: volatile
affects:
  - frontend/src/lib/server/security/rate-limiter.ts (+ .test.ts) — ลบ
  - frontend/src/routes/api/** ที่ import limiter (public donations / registrations / unassigned-registrations / volunteer, v1 auth / kiosk / thirdparty-clients secret)
  - tests ที่ assert 429 `RATE_LIMITED` / `KIOSK_RATE_LIMITED`
  - RATE_LIMIT env: .env.example, frontend/.env.example, frontend/e2e/.env.example, docker-compose.{production,staging}{,.no-nginx}.yml, frontend/playwright.config.ts, e2e pacer helpers, Jenkins credential tent-staging-e2e-env
  - host nginx: staging `shelter.importstar.dev`, production `shelter.psu.ac.th` (นอก repo) + `nginx/rate-limit.conf`, `nginx/snippets/rate-limit.conf` (FR-9)
  - ~/.claude/skills/imps-deploy/templates/nginx.conf
  - backend/apiapp/modules/{donations,volunteers,unassigned_registrations,evacuee,external}/router.py + tests (ลบ FastAPI limiter)
  - frontend/src/lib/server/fastapi.ts (BFF ส่ง X-Real-IP ไป FastAPI — PR #785; ใช้กับ audit `ip_hash` ของ public search)
  - supersede ตัวเลข/กติกา rate limit ใน: CR-005 §F, CR-070, CR-080 Q5, CR-092 FR-VOL-02.3, CR-096 FR-96-18, CR-136, CR-141 FR-20, CR-151 FR-KPC-59/108/126 D7, CR-160 (ทั้ง CR), CR-163 KTD-AC-07, CR-173 FR-7, CR-175 FR-9
  - docs/data/api-contract.md L237, L302, L524–525, L569
  - docs/features/shelter-feedback-rubric-spec.md NFR-FB-02 (ยังไม่ implement — เปลี่ยนเป็นพึ่ง nginx)
  - no schema_v bump
---

# CR-188 — ย้าย rate limit ไปที่ nginx

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ลบ `RateLimiter` และ limiter ทุกตัวออกจาก SvelteKit BFF และ FastAPI (#627) · nginx `limit_req` จำกัดต่อ IP แทน
>   โดย zone/ตัวเลขอยู่ในไฟล์ snippet ใน repo · ลบ env `RATE_LIMIT` (CR-160)
> - **เงื่อนไขก่อน:** nginx ทุก environment ต้องเห็น IP ผู้ใช้จริง — staging (Cloudflare Tunnel) แก้แล้ว 2026-10-23, prod รับตรง
> - **ทำไม:** limiter ในแอปนับแยกต่อ Node worker, ต้องมีโค้ด bypass สำหรับ e2e, และกิน resource ของ Node ทุก request
> - **สิ่งที่หายไป:** limit ที่ key ด้วยตัวตน (เบอร์, token, nonce, kiosk device, จำนวนครั้งที่ verify ผิด) — nginx ทำไม่ได้;
>   ดู "Requirements ที่ถูกยกเลิก" · ไม่ bump `schema_v`

---

## Why

- **#627** (Soravit, 2026-10-17): limiter ในแอปเก็บ state ใน `Map` ต่อ process → `WEB_CONCURRENCY=3` ทำให้เพดานจริงเป็น 3×
  และไม่แชร์ข้าม container; ต้องมี `RATE_LIMIT=false` + loopback check สำหรับ e2e; ทุก request ต้องวิ่งเข้า Node ก่อนโดนตัด
- **ต้นเหตุที่ผู้ใช้ ~10 คนติด 429 (ยืนยัน 2026-10-23):**
  - staging เข้าผ่าน Cloudflare Tunnel (`cloudflared` Docker, host network → `localhost:80`); host nginx ไม่มี realip →
    `$remote_addr` = `127.0.0.1` ทุก request (access log ก่อนแก้: `127.0.0.1` ~1.11 ล้าน, `::1` 8, ไม่มี IP อื่น) →
    ผู้ใช้ทั้งระบบแชร์ bucket เดียว. แก้แล้วด้วย realip (ตาราง A); ทดสอบผ่าน AC-1/AC-1b
  - BFF ไม่ส่ง IP ไป FastAPI → FastAPI limiter เป็น global ทุก environment รวม prod. แก้ใน PR #785
- **CGNAT:** เครือข่ายมือถือ (AIS, True, dtac) และ broadband บางรายให้ผู้ใช้หลายร้อย–พันคนออก IPv4 เดียว; ศูนย์พักพิงใช้
  Wi-Fi/NAT ตัวเดียว → limit ต่อ IP ต้องเป็น flood guard ระดับ "ทั้ง NAT" ไม่ใช่ระดับคน. prod access log 2026-10-23 มี
  IP องค์กร (INET) 3,489 request และ IP dtac mobile ติดอันดับต้น
- nginx `limit_req_zone` ใช้ shared memory ข้าม nginx worker → นับแม่นยำต่อเครื่อง

## Change

### A. Real client IP (เงื่อนไขก่อน — ต้องเสร็จก่อนเปิด `limit_req`)

| ทางเข้า nginx                                       | ตัวอย่าง   | realip                                                                                             |
| --------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| Cloudflare Tunnel (`cloudflared` บนเครื่องเดียวกัน) | staging    | `set_real_ip_from 127.0.0.1;` `set_real_ip_from ::1;` `real_ip_header CF-Connecting-IP;`           |
| Cloudflare proxy (orange cloud → origin)            | —          | `set_real_ip_from` ทุกช่วงจาก https://www.cloudflare.com/ips/ + `real_ip_header CF-Connecting-IP;` |
| ผู้ใช้ต่อ nginx ตรง                                 | production | ไม่ต้องตั้ง                                                                                        |

- staging: ✅ ทำแล้ว 2026-10-23 (`/etc/nginx/snippets/cloudflare-realip.conf` + `include` ใน server block)
- ห้ามตั้ง `ADDRESS_HEADER=CF-Connecting-IP` ที่แอปแทน realip — nginx ฟัง `0.0.0.0:80`, ผู้ยิงตรงเข้า origin ปลอม header ได้

### B. nginx `limit_req` — zone

ทุก zone ใช้เพดานเดียวกัน 10000 ครั้ง/นาที/IP, burst 2000 (owner 2026-10-23 — ดู Decision log). ค่าเดิมของแต่ละ zone อยู่ใน git history

key = `$limit_key` (IPv4 เต็ม / IPv6 ตาม `$binary_remote_addr`; ว่างสำหรับ e2e allowlist ตาม FR-7)

| zone           | location                                                                                                                   | rate  | burst       | เทียบเท่า | แทนที่ limiter เดิม                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- | ----- | ----------- | --------- | ---------------------------------------------------------------- |
| `public_write` | `POST` ใต้ `/api/public/v1/` (donations, registrations, unassigned-registrations, volunteer apply/profile/respond, photos) | 10000r/m | 2000 nodelay | 10000/นาที (≈167/วินาที) | donation/register/volunteer IP limiters (3–10/นาที)              |
| `public_read`  | `/api/public/v1/` อื่นทั้งหมด                                                                                              | 10000r/m | 2000 nodelay | 10000/นาที (≈167/วินาที) | donationRead/Slots, registerLookup, volunteerTicket(Find)        |
| `auth`         | `/api/v1/auth/`, `/api/v1/thirdparty-clients/`                                                                             | 10000r/m | 2000 nodelay | 10000/นาที (≈167/วินาที) | loginCaptcha, loginResolve, linkAccount, secret reveal (10/นาที) |
| `kiosk`        | `/api/v1/kiosk/`, `/api/v1/scanner/`                                                                                       | 10000r/m | 2000 nodelay | 10000/นาที (≈167/วินาที) | kiosk device limiters (5–10/นาที/เครื่อง)                        |
| `external`     | `/external/`                                                                                                               | 10000r/m | 2000 nodelay | 10000/นาที (≈167/วินาที) | FastAPI evacuee/external backstop (30/นาที)                      |

- `limit_req_status 429;` และ `error_page 429` ตอบ JSON ตาม shape ที่ UI เดิมอ่าน — แยกตาม zone (ตรวจโค้ด 2026-10-23):

  | zone               | body 429                                                                        | header                     | UI ที่อ่าน                                                                                                           |
  | ------------------ | ------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
  | `public_*`, `auth` | `{"success":false,"error":"RATE_LIMITED","message":"Too many requests"}`        | `Retry-After: 60`          | donations, public-register, volunteer-portal (`error` string), login link-account; ส่วนใหญ่ fallback ด้วย status 429 |
  | `kiosk`            | `{"error":{"code":"KIOSK_RATE_LIMITED","message":"กรุณารอสักครู่แล้วลองใหม่"}}` | `Retry-After: 60` (บังคับ) | `reprint-session`, `volunteer-card-session` match `error.code`; `kiosk-thaid.api` อ่าน header `retry-after`          |
  | `external`         | `{"errors":[{"error":{"code":"RATE_LIMITED","message":"Too many requests"}}]}`  | `Retry-After: 60`          | partner ตาม envelope FastAPI (api-contract §5)                                                                       |

  ถ้า kiosk ได้ body แบบ `public_*` ข้อความ "ลองผิดหลายครั้ง" จะไม่แสดง (ตกไป generic error)

- `/couch/` ไม่ใส่ `limit_req` (staff UI sync กับ CouchDB ถี่ตามปกติ)

### C. Application layer

| จุด                                                                                                      | Before                    | After                                                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `rate-limiter.ts` + test                                                                                 | limiter 27 ตัว in-memory  | ลบ                                                                                  |
| route ที่เรียก `.check()` / `.isBlocked()`                                                               | ตอบ 429 จากแอป            | ลบ guard; logic อื่นคงเดิม                                                          |
| env `RATE_LIMIT` (CR-160)                                                                                | switch ปิด limiter บางตัว | ลบทุกที่ (compose, env templates, playwright config, e2e pacer, Jenkins credential) |
| FastAPI limiter (evacuee/external, volunteers, unassigned_registrations; donations ปิดแล้วใน `8d3d8335`) | 30/นาที/IP in-process     | ลบ (FR-11)                                                                          |

### Requirements

- **FR-1** — host nginx ทุก environment ตั้ง realip ตามตาราง A ก่อนเปิด `limit_req`; `$remote_addr` ใน access log ต้องเป็น IP ผู้ใช้
- **FR-2** — ลบ `frontend/src/lib/server/security/rate-limiter.ts`, `rate-limiter.test.ts` และทุก import/guard ใน `src/routes/api/**`
- **FR-3** — ลบ env `RATE_LIMIT` และโค้ด/เอกสาร/pacer ที่อ้างถึงจาก repo; ลบ key ใน Jenkins credential `tent-staging-e2e-env`
- **FR-4** — ลบ/ปรับ test ที่ assert 429 จากแอป; test ของ UI ที่ดัก `RATE_LIMITED` ต้องยังผ่านด้วย response จาก nginx
- **FR-5** — nginx ตั้ง zone ตามตาราง B; ตอบ 429 ด้วย body + `Retry-After` ตามตาราง body 429 แยกต่อ zone
- **FR-6** — `limit_req_zone` อยู่ใน context `http`; ขนาด zone ≥ 10m ต่อ zone (~160k IP)
- **FR-7** — e2e บน staging: allowlist IP ของ runner ด้วย `geo` → `map` ให้ `$limit_key` เป็นค่าว่าง (nginx ไม่นับ key ว่าง)
- **FR-8** — `imps-deploy/templates/nginx.conf` มี realip snippet (Tunnel / proxy) และ include rate-limit snippet
- **FR-9** — config rate limit เก็บใน repo เป็น source of truth: `nginx/rate-limit.conf` (http context — zone + map;
  container nginx โหลดอัตโนมัติผ่าน `conf.d`) และ `nginx/snippets/rate-limit.conf` (server context — `limit_req` + 429);
  host nginx copy ไป `/etc/nginx/conf.d/tent-rate-limit.conf` + `/etc/nginx/snippets/tent-rate-limit.conf` แล้ว `include` snippet ใน server block
- **FR-11** — ลบ limiter ใน FastAPI ทั้งหมด (`_enforce_rate_limit` / `_check_rate_limit` + ค่าคงที่ + state) ใน `donations`, `volunteers`,
  `unassigned_registrations`, `evacuee`, `external` router และ test/fixture ที่ reset หรือ assert 429; `client_ip()` คงไว้ (audit `ip_hash`)
- **FR-10** — เพิ่ม `decision sync` note อ้าง CR นี้ใน CR ทุกตัวในรายการ supersede ตรงจุดกติกา rate limit เดิม; ปิด CR-160 เป็น `superseded`

### Requirements ที่ถูกยกเลิก (owner รับทราบ 2026-10-23)

| เดิม                                                           | กติกา                                                              | ผลเมื่อยกเลิก                                                                          | ทดแทนด้วย                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------ |
| CR-151 FR-KPC-108                                              | verify เลขบัตร 4 ตัวท้ายผิด 5 ครั้ง/10 นาที ต่อ primary → 429      | เดาเลข 10 000 ค่าได้เร็วขึ้น — จำกัดแค่ zone `kiosk` 300/นาที/IP (~34 นาทีต่อ primary) | kiosk ต้อง auth ด้วย device อยู่แล้ว |
| CR-141 FR-20                                                   | link-account ผิด 5 ครั้ง ต่อ `pending_link` nonce                  | เดารหัสผ่านในรอบ OAuth เดียวได้มากขึ้น — จำกัดแค่ zone `auth`                          | CouchDB `_session` + captcha         |
| CR-005 §F / CR-070 / CR-092 FR-VOL-02.3 / CR-173 FR-7          | limit ต่อเบอร์โทร                                                  | ผู้ใช้เบอร์เดียวสร้างรายการได้ตาม zone `public_write`                                  | reCAPTCHA บนฟอร์มเขียน               |
| CR-151 FR-KPC-59/126, CR-163 KTD-AC-07, api-contract L237/L302 | limit ต่อ kiosk device / ต่อเบอร์ข้ามเครื่อง                       | kiosk ทุกเครื่องในศูนย์เดียวกันแชร์ zone `kiosk` (IP เดียว)                            | —                                    |
| CR-080 Q5, CR-096 FR-96-18, CR-136, CR-175 FR-9                | limit ต่อ IP ในแอป (แก้ใบจอง, ตอบรับกะ, secret reveal, อัปโหลดรูป) | ย้ายไป zone nginx ตาราง B                                                              | —                                    |
| CR-160                                                         | `RATE_LIMIT` switch                                                | ไม่มี limiter ในแอปให้ปิด                                                              | FR-7 allowlist                       |

## Acceptance

- [x] **AC-1** — staging: access log แสดง IP ผู้ใช้จริง ไม่ใช่ `127.0.0.1` (ผ่าน 2026-10-23)
- [x] **AC-1b** — staging: IP หนึ่งโดน `429` แล้ว IP อื่นยังผ่านในนาทีเดียวกัน (ผ่าน 2026-10-23 กับ limiter ในแอป)
- [ ] **AC-2** — `grep -rn "rate-limiter\|RATE_LIMIT\b" frontend/src` และ `grep -rn "_enforce_rate_limit\|_check_rate_limit" backend` ไม่พบผลลัพธ์;
      `pnpm check` + `pnpm test` + backend `pytest` ผ่าน
- [ ] **AC-3** — staging: ยิง `POST /api/public/v1/registrations` จาก IP เดียวเกิน burst 2000 + 10000/นาที → `429` JSON
      `{"success":false,"error":"RATE_LIMITED",…}`; IP อื่นในนาทีเดียวกันยังผ่าน
- [ ] **AC-4** — staging: login จาก IP เดียวไม่ถูกจำกัดจนเกิน burst 2000 + 10000/นาที; เกินแล้วได้ `429`
- [ ] **AC-5** — e2e `--critical` บน staging ผ่านโดยไม่มี `RATE_LIMIT` และไม่มี pacer
- [ ] **AC-6** — ทดสอบซ้ำแบบเดิม (~10 ผู้ใช้จริง) ไม่มี `429`
- [ ] **AC-7** — UI ที่แสดงข้อความ rate limit (donation, register, volunteer, kiosk) แสดงผลถูกเมื่อ nginx ตอบ 429

## Impact

- **ผู้ใช้:** คนทั้งศูนย์ / CGNAT เดียวกันใช้งานพร้อมกันได้; ไม่มีเพดานแยกต่อ worker
- **ความปลอดภัย:** เสีย limit ต่อตัวตนตามตาราง "ถูกยกเลิก"; anti-abuse ที่เหลือคือ reCAPTCHA, CouchDB auth, kiosk device auth,
  nginx ต่อ IP
- **Ops:** ตัวเลข rate limit ย้ายจาก code review ไปอยู่ใน nginx config — FR-9 กันไม่ให้ drift ระหว่าง staging/prod
- **โค้ด:** ลบ guard ใน 35 ไฟล์ที่ import limiter + ปรับ 25 test file (นับ 2026-10-23); ไม่มีการเปลี่ยน API shape (429 body เดิม)

## Migration

N/A — ไม่มี persisted doc เปลี่ยนรูป, ไม่ bump `schema_v`.

ลำดับ deploy (ห้ามสลับ):

1. realip ทุก environment (FR-1) — staging เสร็จแล้ว, prod ไม่ต้องทำ
2. PR #785 (BFF → FastAPI `X-Real-IP` — ให้ audit `ip_hash` ของ public search เป็น IP ผู้ใช้)
3. nginx `limit_req` บน staging (FR-5/7) → ทดสอบ AC-3/4/5
4. merge โค้ดที่ลบ limiter ในแอป (FR-2/3/4) → deploy staging → AC-2/6/7
5. nginx `limit_req` บน prod → deploy โค้ดขึ้น prod

ถ้าทำข้อ 4 ก่อนข้อ 3 ระบบจะไม่มี rate limit เลยช่วงหนึ่ง

## Open decisions

ไม่มี — ปิดครบ 2026-10-23 (ดู Decision log)

## Decision log

- 2026-10-17 — #627 เปิดโดย Soravit: ทิศทางย้าย rate limit ไป nginx
- 2026-10-23 — proposed. แทน draft "draft-rate-limit-relax-public-flows" (เพิ่มตัวเลขในแอป) ซึ่งยกเลิกเพราะทิศทาง #627;
  คงส่วน real client IP จาก draft นั้นไว้เป็นเงื่อนไขก่อน (A)
- 2026-10-23 — staging realip แก้แล้ว, AC-1/AC-1b ผ่าน; prod รับตรง ไม่ต้องแก้ nginx
- 2026-10-23 — **approved** โดยเจ้าของโครงการ: "เอา rate limit ทุกอย่างออกให้หมด ให้ไปดักที่ nginx อย่างเดียว" →
  (1) อนุมัติทิศทาง · (3) ลบ FastAPI limiter ด้วย (FR-11) · (4) ยอมยกเลิก FR-KPC-108 ·
  (5) รับทราบตาราง "Requirements ที่ถูกยกเลิก" · (2) ตัวเลข zone ไม่ได้ระบุ → ใช้ค่าตามตาราง B เป็นค่าเริ่มต้น ·
  (6) `/public-api/` ไม่ใช่ rate limit → นอกขอบเขต CR นี้ (คงเดิม)
- 2026-10-23 — นอกขอบเขต: staff PIN turn queue (`staff-pin-throttle.ts`, `server/staff-pin-turns.mjs`) — คิวต่อเครื่อง + หน่วง
  PIN ผิด 1 วินาที ไม่ใช่ rate limiter แบบนับครั้ง และ nginx ทำแทนไม่ได้
- 2026-10-23 — **owner ปรับตัวเลข zone (ข้อ 2):** ทุก zone = `10000r/m` ต่อ IP (≈167/วินาที), burst 2000 — "ไม่อยากให้ผู้ใช้ AIS / True /
  dtac / ISP อื่นในไทยเข้าไม่ได้" → ใช้เพดานสูงพอสำหรับ CGNAT แทนการยกเว้น IP ไทย (ยังกันการยิงถล่มจาก IP เดียวได้).
  เทียบค่าเดิม: public_write ×33, public_read ×8, auth ×83, kiosk ×33, external ×17. ผลข้างเคียงที่รับทราบ: zone `auth` กันเดารหัสผ่านต่อ IP
  ได้น้อยลง — เหลือ captcha + CouchDB `_session`
