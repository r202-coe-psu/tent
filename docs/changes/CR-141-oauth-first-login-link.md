---
id: CR-141
title: OAuth-first staff login — hide password form behind admin toggle, hidden /admin-login, link Google/ThaID to a new account via username/password
status: approved
date: 2026-09-29
updated: 2026-09-29
requested_by: project owner (audit เบื้องต้น)
decided_by: project owner (approve 2026-09-29)
layer: stable
affects:
  - docs/data/schema.md §3.2 (config:app + password_login_enabled)
  - docs/data/api-contract.md §1.1 (login entry points, link-on-login path)
  - docs/changes/CR-124-staff-google-stepup-mfa.md FR-09a (not-enrolled behaviour superseded)
  - docs/changes/draft-staff-thaid-stepup-mfa.md (TL;DR ล้าสมัย — ThaID login มีแล้ว)
  - frontend/src/lib/features/shared/domain/app-config.ts
  - frontend/src/routes/api/v1/app-config/+server.ts
  - frontend/src/lib/features/shared/ui/ (settings card ใหม่) + routes/(protected)/system-management/security/
  - frontend/src/routes/api/public/v1/login-methods/+server.ts (new)
  - frontend/src/lib/features/login/ (login-form, link form ใหม่)
  - frontend/src/routes/login/, routes/login/link/ (new), routes/admin-login/ (new)
  - frontend/src/routes/api/v1/auth/oauth/{google,thaid}/callback/+server.ts (mode=login not-linked branch)
  - frontend/src/routes/api/v1/auth/link-account/+server.ts (new)
  - frontend/src/lib/server/user-service.ts, google-oauth.ts, thaid-oauth.ts
  - frontend/src/routes/api/v1/users/+server.ts (force must_change_password=true on create)
why: ผ่าน audit เบื้องต้นโดยไม่ให้หน้า login หลักมีช่อง username/password และให้บัญชีใหม่ผูก Google/ThaID ได้ตั้งแต่ login ครั้งแรก
migration: N/A — additive field ใน config:app (อ่านแบบ per-field .catch); _users ไม่มี field ใหม่; ไม่ bump schema_v
---

# OAuth-first staff login + link-on-first-login

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** หน้า `/login` แสดงเฉพาะ Google + ThaID เมื่อ `config:app.password_login_enabled = false` (default) · ฟอร์ม username/password ย้ายไป path ที่ไม่ลิงก์จากที่ใด `/admin-login` (ใช้ได้เสมอ) · OAuth login ที่ยังไม่ผูก → หน้า `/login/link` ให้กรอก username/password ของบัญชี**ใหม่** (ยังต้อง force-setup) → ผูก provider ทันที → mint session → force-setup
> - **เพื่อใคร/ทำไม:** audit เบื้องต้นไม่ต้องการ password form บนหน้า login หลัก; หน้างานเปิดกลับได้ด้วย toggle
> - **Dev ต้อง build:** flag + settings UI · BFF `login-methods` · route `/admin-login` · pending-link cookie + route `/login/link` + `POST /api/v1/auth/link-account` · เปลี่ยน not-linked branch ใน OAuth callbacks · บังคับ `must_change_password=true` ตอน admin สร้าง user
> - **กระทบ schema/scope:** `schema.md` §3.2 (+1 field) · `api-contract.md` §1.1 · supersede CR-124 FR-09a · ไม่ bump `schema_v`

---

## 1. Why

1. **Audit:** หน้า login หลักต้องไม่แสดงช่อง username/password — ทางเข้าหลักของ staff = Google / ThaID
2. **หน้างาน:** บางศูนย์ต้องการ password login เพื่อความสะดวก → operator เปิดกลับได้จาก System Management โดยไม่ deploy ใหม่
3. **Enroll friction:** ปัจจุบัน (CR-124 FR-09a) บัญชีที่ยังไม่ผูก OAuth ต้อง login ด้วย password ก่อนแล้วไปผูกที่ `/me` — ใช้ไม่ได้เมื่อ password form ถูกซ่อน
4. **Provisioning เดิมคงไว้:** admin/manager ยังเป็นผู้สร้างบัญชี + รหัสผ่านชั่วคราว (CR-105) — ไม่มี auto-provision จาก OAuth

---

## 2. Change (before → after)

| | Before | After |
| --- | --- | --- |
| `/login` | password + Google + ThaID (ThaID ตาม flag) | Google + ThaID; password form แสดงเฉพาะเมื่อ `password_login_enabled = true` |
| Password login UI | `/login` | `/admin-login` (เสมอ, ไม่ขึ้นกับ flag) + `/login` เมื่อ flag ON |
| OAuth `mode=login`, `sub` ไม่ผูกกับ user ใด | redirect `/login?error=*_not_linked` | ตั้ง pending-link cookie → redirect `/login/link` |
| ผูก OAuth ครั้งแรก | ต้องมี session → `/me` | `/me` (เดิม) **หรือ** `/login/link` สำหรับบัญชีใหม่ |
| Admin สร้าง user | `must_change_password` ตาม body (default `false`) | บังคับ `true` เสมอ |

### 2.1 Sequence — link on first login

```
User ──► /login ──► Google/ThaID start (mode=login) ──► IdP ──► callback
callback: findUserBy*Subject(sub)
  ├─ found   ──► mint AuthSession + mfa_ok ──► resolvePostLoginDestination   (เดิม)
  └─ not found ──► Set-Cookie pending_link (signed, 10 min) ──► /login/link
/login/link: กรอก username|phone + password (+ reCAPTCHA ตาม flag)
  ──► POST /api/v1/auth/link-account
        1. verify pending_link (signature, expiry, attempts)
        2. resolveLoginName → verify password กับ central `_session`
        3. eligibility: must_change_password = true AND mfa.providers ว่าง AND ไม่ใช่ bootstrap _admin
        4. link*Mfa(sub, …)   (CONFLICT ถ้า sub ผูกกับ user อื่น)
        5. mint AuthSession + mfa_ok, ลบ pending_link, เขียน audit log
  ──► /force-setup ──► /portal
```

---

## 3. Requirements

### 3.1 Toggle

- **FR-01:** เพิ่ม `config:app.password_login_enabled: bool`, default `false`; อ่านแบบ per-field `.catch(false)` ใน `appConfigSchema`
- **FR-02:** `PUT /api/v1/app-config` (system admin เท่านั้น) รับ `password_login_enabled` เพิ่ม; บันทึก `updated_by` / `updated_at` ตามเดิม
- **FR-03:** หน้า `/system-management/security` มีการ์ดเปิด/ปิด "เข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่านบนหน้าหลัก" แบบเดียวกับ `RecaptchaSettings` / `ThaidSettings`
- **FR-04:** ไม่มี fallback อัตโนมัติ — ถ้า flag OFF และไม่มี OAuth ที่ใช้ได้ `/login` ไม่แสดง password form; ไม่แสดงคำเตือนตอนปิด flag

### 3.2 Login entry points

- **FR-05:** เพิ่ม public BFF `GET /api/public/v1/login-methods` → `{ password: bool, google: bool, thaid: bool }`
  - `password` = `password_login_enabled`
  - `google` = มี `GOOGLE_OAUTH_CLIENT_ID/SECRET`
  - `thaid` = ผลของ `thaid-registration-gate` เดิม (ใช้ `thaid_registration_enabled` ตัวเดิม — ไม่แยก flag)
- **FR-06:** `/login` แสดง password form เฉพาะเมื่อ `password = true`; ปุ่ม Google เมื่อ `google = true`; ปุ่ม ThaID เมื่อ `thaid = true`
- **FR-07:** route `/admin-login` แสดง password form เสมอ (ไม่ขึ้นกับ flag), ใช้ได้ทุก role, ใช้ `redirectIfAuthenticated` + `resolvePostLoginDestination` เดิม
- **FR-08:** `/admin-login` ต้องไม่ถูกลิงก์จาก navbar / หน้าใด / ข้อความ error; ตั้ง `<meta name="robots" content="noindex">`
- **FR-09:** `/admin-login` เป็นการซ่อนระดับ UX เท่านั้น — `POST /couch/_session` ด้วย password ยังใช้ได้ (ไม่ใช่ security boundary)

### 3.3 Pending-link state

- **FR-10:** OAuth callback `mode=login` (Google + ThaID) เมื่อไม่พบ user ที่ผูก `sub` → **ไม่** mint session; ตั้ง cookie `pending_link` แล้ว redirect `/login/link`
- **FR-11:** `pending_link` = HttpOnly, SameSite=Lax, Secure (prod), path `/`, อายุ 10 นาที, sign ด้วย HMAC ฝั่งเซิร์ฟเวอร์; payload = `{ provider, sub, email?|name?|pid_masked?, nonce, exp }`
- **FR-12:** เข้า `/login/link` โดยไม่มี `pending_link` ที่ valid → redirect `/login`
- **FR-13:** หน้า `/login/link` แสดง provider ที่กำลังผูก (เช่น email Google / ชื่อ ThaID), ช่อง username-หรือ-เบอร์โทร + password, reCAPTCHA ตาม `recaptcha_enabled`, และปุ่มยกเลิก (ลบ cookie → `/login`)

### 3.4 Link endpoint

- **FR-14:** `POST /api/v1/auth/link-account` `{ login, password, captcha_token? }` — ไม่ต้องมี `AuthSession`; ต้องมี `pending_link` ที่ valid
- **FR-15:** `login` ผ่าน `resolveLoginName` (รับ username หรือเบอร์ `^0\d{9}$`) แล้วตรวจรหัสผ่านกับ **central** `_session` ฝั่งเซิร์ฟเวอร์
- **FR-16 (Eligibility):** ผูกได้เฉพาะเมื่อ `must_change_password = true` **และ** `mfa.providers` ว่าง **และ** ไม่ใช่ bootstrap `_admin`; ไม่ผ่าน → 403 ข้อความเดียว "ไม่สามารถเชื่อมบัญชีนี้ได้ กรุณาติดต่อผู้ดูแลระบบ"
- **FR-17:** ตรวจ eligibility **หลัง** รหัสผ่านถูกเท่านั้น; รหัสผิด / ไม่พบ user → 401 ข้อความเดียวกัน (ไม่เปิดเผยว่ามี user หรือไม่)
- **FR-18:** ผูกด้วย `linkGoogleMfa` / `linkThaidMfa` เดิม; `sub` ผูกกับ user อื่นอยู่ → 409, ไม่ mint
- **FR-19:** สำเร็จ → mint `AuthSession` + ตั้ง `mfa_ok` (เหมือน CR-124 FR-09b), ลบ `pending_link`, ตอบ destination จาก `resolvePostLoginDestination` (คาดว่า `/force-setup`)
- **FR-20 (Rate limit):** ผิดได้ไม่เกิน 5 ครั้งต่อ `pending_link.nonce` ต่อ Node worker (นับฝั่งเซิร์ฟเวอร์ in-memory; prod `WEB_CONCURRENCY=3` → effective ≤ 15 ครั้งภายในอายุ cookie 10 นาที) + จำกัดต่อ IP; เกิน → ลบ cookie, 429, ต้องเริ่ม OAuth ใหม่
- **FR-21 (Audit):** บันทึก log ทุกครั้งที่ link สำเร็จ / ถูกปฏิเสธ: `{ at, provider, sub (masked), user_name?, result }`
- **FR-22:** ทำได้เฉพาะเมื่อ central เข้าถึงได้ (ตาม CR-124 FR-08); edge-only → error

### 3.5 Provisioning & recovery

- **FR-23:** `POST /api/v1/users` (สร้างใหม่) บังคับ `must_change_password = true` ไม่ว่า body ส่งอะไร; merge บทบาทเข้าบัญชีเดิม (`createOrMergeUser`) ไม่เปลี่ยนค่านี้
- **FR-24:** admin reset password คงพฤติกรรมเดิม (`must_change_password = true`) → บัญชีที่ unlink provider ครบแล้วกลับมาผูกผ่าน `/login/link` ได้
- **FR-25:** บัญชีที่ใช้งานอยู่แล้วและยังไม่ผูก OAuth → เข้า `/admin-login` แล้วผูกที่ `/me` (flow เดิม); path ส่งให้ผู้ใช้โดยผู้ดูแล
- **FR-26:** OAuth callback ที่ส่งผลลัพธ์ link ไม่ผ่าน / ข้อความ `*_not_linked` เดิม → เปลี่ยนเป็น "บัญชีนี้ยังไม่ได้เชื่อม กรุณาติดต่อผู้ดูแลระบบ" — ห้ามอ้างถึง `/admin-login`

---

## 4. Out of scope

- แยก flag ThaID login ออกจาก `thaid_registration_enabled`
- บังคับปิด password login ที่ระดับ CouchDB / proxy / ตาม role
- auto-provision บัญชีจาก OAuth
- ผูก provider ที่ 2 ผ่าน `/login/link` (ใช้ `/me`)
- ตรวจเลขบัตร ThaID กับข้อมูลบัญชี

---

## 5. Acceptance Criteria (DoD)

- [ ] AC-01: flag OFF → `/login` ไม่มีช่อง username/password; มีปุ่ม Google / ThaID ตาม `login-methods`
- [ ] AC-02: flag ON → `/login` เหมือนก่อน CR นี้
- [ ] AC-03: `/admin-login` login ด้วย password ได้ทั้ง flag ON/OFF; ไม่มีลิงก์ไปยังหน้านี้จากที่ใดใน UI
- [ ] AC-04: admin สร้าง user → Google login ด้วย `sub` ใหม่ → `/login/link` → กรอกถูก → `/force-setup` → `/portal`; login รอบต่อไปด้วย Google เข้าได้ทันที
- [ ] AC-05: เหมือน AC-04 ด้วย ThaID
- [ ] AC-06: บัญชีที่ทำ force-setup แล้ว / มี provider อยู่แล้ว / bootstrap `_admin` → link ถูกปฏิเสธ (403) แม้รหัสถูก
- [ ] AC-07: รหัสผิด 5 ครั้ง → ครั้งที่ 6 ได้ 429 และ cookie ถูกลบ
- [ ] AC-08: `sub` ผูกกับ user อื่นแล้ว → 409, ไม่มี session
- [ ] AC-09: `/login/link` โดยไม่มี / cookie หมดอายุ → redirect `/login`
- [ ] AC-10: `POST /api/v1/users` ด้วย `must_change_password: false` → doc ที่สร้างมี `true`
- [ ] AC-11: unit tests: eligibility, pending-link sign/verify/expiry, rate limit, `login-methods` mapping, app-config parse default
- [ ] AC-12: `pnpm lint`, `pnpm check`, `pnpm test` ผ่าน; `.svelte` ที่แตะผ่าน `svelte-autofixer`

---

## 6. Docs to update on approve

- `docs/data/schema.md` §3.2 — เพิ่มแถว `password_login_enabled` (และแถว `recaptcha_enabled` / `thaid_registration_enabled` ที่มีใน code แต่ขาดใน doc — format-only)
- `docs/data/api-contract.md` §1.1 — entry points ใหม่ + link-on-login path + endpoint `link-account`, `login-methods`
- `docs/changes/CR-124-staff-google-stepup-mfa.md` — หมายเหตุ FR-09a superseded by CR นี้
- `docs/changes/draft-staff-thaid-stepup-mfa.md` — TL;DR ล้าสมัย (ThaID `mode=login` implement แล้ว) — แก้แยก

---

## 7. Decision log

- 2026-09-29 — proposed. Decisions (owner, grilling session):
  - Toggle ควบคุมเฉพาะ password form บน `/login`; `/admin-login` ใช้ได้เสมอ (กัน lockout) — ทางเลือก "toggle ปิด `/admin-login`" ถูกตัด
  - หลัง link → `mfa_ok` ทันที และยังต้อง force-setup (รหัสชั่วคราวอาจรั่ว และยังใช้ผ่าน `/admin-login` ได้)
  - Link ผ่านหน้า login จำกัดเฉพาะบัญชีใหม่ (`must_change_password = true`, ไม่มี provider) — กันผู้โจมตีผูก OAuth ของตนเข้าบัญชีที่ใช้งานอยู่แบบถาวร
  - บัญชีเดิมที่ยังไม่ผูก → ใช้ `/admin-login` + `/me` (ทางเลือก admin reset / เปิด flag ช่วงเปลี่ยนผ่าน ไม่เลือก)
  - ใช้ `thaid_registration_enabled` เดิม; ไม่มี fallback อัตโนมัติ / คำเตือน
  - Track ด้วย CR file ใหม่
- 2026-09-29 — approved (owner) → CR-141; FR-20 ระบุ limit ต่อ worker
