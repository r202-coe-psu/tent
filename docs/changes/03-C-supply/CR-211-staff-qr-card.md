---
id: CR-211 # renumbered from draft-staff-qr-card
title: Staff QR card — permanent staff_token_hash in _users + recipient_type staff at distribution
status: approved
date: 2026-10-28
updated: 2026-10-31 # A2 approved (kong, 2026-10-31) — บัตรแสดง "เจ้าหน้าที่" แทนรายการ role, PNG = ป้าย 80×60 เดียวกับพิมพ์ · approved (kong); ส่วนที่ปรับ A1 approved (kong, 2026-10-30) — payload case, affects, role ของ resolve (ไม่มี rate limit ในแอป ตาม CR-188), createUser ตัวไหน, e2e AC
requested_by: ทีม (issue #893)
decided_by: kong
decision_date: 2026-10-29
layer: volatile
affects:
  - docs/data/schema.md §6 (`_users.staff_token_hash` — additive)
  - docs/data/schema.md §2.30 (`distribution_log.recipient_type` + `staff`, `recipient_id` = `user:{name}`)
  - docs/data/api-contract.md §2 (endpoint บัตร QR ใต้ `/api/v1/users` และ `/api/v1/me` — service plane ไม่ใช่ §3 Provisioning)
  - docs/prd/role-permission-matrix.md (ใครดู/พิมพ์/หมุนบัตร staff และใคร resolve QR staff ที่หน้าแจก)
  - frontend/src/lib/server/user-service.ts (mint ตอน `createUser`, ซ่อน hash จาก summary, กัน self-edit)
  - frontend/src/lib/server/shelter-access-design.ts (VDU `distribution_log` รับ `staff`) + frontend/scripts/redeploy-access.ts
  - frontend/src/routes/api/v1/users/ · frontend/src/routes/api/v1/me/
  - frontend/src/lib/features/users/ · frontend/src/lib/features/me/
  - frontend/src/lib/features/distribution/domain/food-supplies/distribution-log.ts
  - frontend/src/lib/features/distribution/ui/model/recipient-scan.ts · frontend/src/lib/features/distribution/ui/common/RecipientName.svelte
  - frontend/src/lib/features/distribution/application/food-supplies/distribution-workflow.ts · frontend/src/lib/features/distribution/ui/model/frontline-handover.ts
  - frontend/src/lib/features/distribution/ui/common/RecipientSearchPicker.svelte · frontend/src/lib/features/distribution/ui/common/DistributionHistory.svelte
  - frontend/src/lib/features/distribution/ui/frontline/FoodDistributionCard.svelte · frontend/src/lib/features/distribution/ui/frontline/SuppliesDistributionCard.svelte · frontend/src/lib/features/distribution/ui/frontline/LoanReturnCard.svelte
  - frontend/src/routes/(protected)/portal/+page.svelte
  - frontend/src/lib/features/volunteers/server/public-schedule-action.ts (reuse read-or-mint role-card ของ CR-127)
  - frontend/scripts/seed/users.ts
why: เจ้าหน้าที่รับอาหาร/ของที่หน้าแจกด้วยการสแกนไม่ได้ เพราะไม่มี QR ประจำตัวและ `recipient_type` ไม่มี `staff`
migration: one-off backfill `staff_token_hash` ให้ `_users` เดิมที่ไม่มี `volunteer_id` (idempotent); `distribution_log` เดิมไม่ต้อง migrate
---

# CR-211 — Staff QR card — permanent `staff_token_hash` in `_users` + `recipient_type: 'staff'`

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม token ถาวรของเจ้าหน้าที่ `_users.staff_token_hash` (เก็บแค่ SHA-256) ออกตอนสร้าง user · QR payload `TKT-STF-HASH-<hash>` · เพิ่ม `distribution_log.recipient_type: 'staff'` พร้อม `recipient_id: user:{name}`
> - **เพื่อใคร/ทำไม:** เจ้าหน้าที่ศูนย์สแกนรับอาหาร/ของที่ `/onsite/distribution` ได้เหมือนจิตอาสา (#650) และกันรับซ้ำในมื้อเดียวกัน
> - **Dev ต้อง build:** mint ใน `createUser` + backfill · endpoint อ่านบัตรตัวเอง / admin พิมพ์และหมุน / หน้าแจก resolve QR · ปุ่ม "ดูบัตรของฉัน" ที่ portal · scan routing + VDU รับ `staff`
> - **กระทบ schema/scope:** `schema.md` §6 (additive บน `_users`, ไม่มี `schema_v`) · §2.30 enum เพิ่ม `staff` (ไม่ bump `schema_v`) · VDU shelter DB ต้อง redeploy · user ที่มี `volunteer_id` ใช้ QR จิตอาสาเดิม (CR-127) ไม่ได้ token staff

> **ส่วนที่ปรับ 2026-10-29 (A1) — เสนอโดยทีม, approved (kong) 2026-10-30** — ปิด warning จาก PR review หลัง approve
> ไม่เปลี่ยนแนวทางที่ kong approve · แก้ใน §2.1, FR-SQR-02/03/13/21, เพิ่ม FR-SQR-40..43, AC-15, `affects` และ Decision log
>
> 1. **payload case:** QR พิมพ์ hex ตัวใหญ่แบบ `TKT-VOL-HASH-` · parser ไม่สนตัวพิมพ์ · เก็บและค้นด้วยตัวเล็ก (FR-SQR-40)
> 2. **`affects`:** เพิ่มไฟล์ distribution ที่ใช้ `recipient_type` 7 ไฟล์ + `role-permission-matrix.md` · endpoint ย้ายไป api-contract §2
> 3. **ใคร resolve ได้:** ตาม gate หน้าแจก `canAccessDistributionDesk` — `system_admin`, `shelter_manager` / `distribution_staff` ของศูนย์นั้น (FR-SQR-13/21)
> 4. **กันใช้ resolve เป็นตัวเช็ก hash:** ตรวจสิทธิ์ผู้เรียกก่อน lookup · ไม่เจอกับ user ไม่อยู่ศูนย์ตอบเหมือนกัน (FR-SQR-41) · ไม่มี rate limit ในแอป (CR-188 — nginx ต่อ IP เท่านั้น, FR-SQR-42)
> 5. **`createUser` ตัวไหน:** ตัว server `frontend/src/lib/server/user-service.ts` (FR-SQR-02/03/43)
> 6. **e2e:** เพิ่ม AC-15 สำหรับ flow สแกน แจก และ log

> **ส่วนที่ปรับ 2026-10-31 (A2) — เสนอโดยทีม, approved (kong) 2026-10-31** — หน้าตาบัตรหลังใช้งานจริง
> แก้ FR-SQR-26/27/29, AC-04 และ Decision log · เพิ่ม FR-SQR-44/45 · ไม่แตะ token, endpoint หรือ `resolve`
>
> 1. **ไม่แสดง role บนบัตร:** บัตร staff ทุกคน (รวม `system_admin` และคนที่มีหลาย role) แสดงคำว่า **"เจ้าหน้าที่"** อย่างเดียว ตัวใหญ่หนา ล่างสุดของคอลัมน์ข้อความ เหนือบรรทัด shelter.psu.ac.th — role หลายตัวทำให้ป้าย 80×60 รก (FR-SQR-26, FR-SQR-44)
> 2. **ไม่แสดง `position` บนบัตร** (FR-SQR-26)
> 3. **PNG = ป้ายเดียวกับพิมพ์:** ปุ่มดาวน์โหลด PNG ได้ภาพป้าย 80×60 mm หน้าตาเดียวกับที่พิมพ์ ไม่ใช่รูป QR เปล่า (FR-SQR-29, FR-SQR-45)
> 4. **หน้าแจกไม่เปลี่ยน:** `resolve` ยังคืน `role_label` ตาม scoped role (FR-SQR-23) ให้คนแจกเทียบตัวตนตาม R1

---

## 1. Why

1. **ไม่มี QR ประจำตัวของเจ้าหน้าที่:** `_users` (schema.md §6) ไม่มี field token/QR หน้าแจกรู้จักแค่ QR ผู้อพยพและ QR จิตอาสา (#650) เจ้าหน้าที่ต้องถูกบันทึกแบบ `outside` หรือค้นชื่อเอง ทำให้กันรับซ้ำไม่ได้
2. **ใช้แบบอย่างเดิม:** CR-127 วาง token ถาวรที่เก็บแค่ hash และ payload `TKT-VOL-HASH-<sha256>` ไว้แล้ว ใช้รูปแบบเดียวกันกับเจ้าหน้าที่ลดความเสี่ยงและโค้ดซ้ำ
3. **หนึ่งคนหนึ่ง QR:** การกันรับซ้ำเทียบ `recipient_id` อย่างเดียว (`distribution-workflow.ts`) คนเดียวที่มีสอง QR (จิตอาสา + staff) จะได้ `recipient_id` ต่างกันและรับซ้ำมื้อเดียวกันได้

---

## 2. Change (before → after)

| หัวข้อ | ก่อน | หลัง |
| --- | --- | --- |
| `_users` token | ไม่มี | `staff_token_hash` (str\|null, sys) — SHA-256 ของ token, ไม่เก็บ plaintext |
| ใครได้ token staff | — | user ที่ไม่มี `volunteer_id` |
| เวลาออก token | — | ตอนสร้าง user (`createUser`) + backfill user เดิม · admin หมุนได้ · การอ่านบัตรไม่ออก/ไม่หมุน token |
| QR payload | — | `TKT-STF-HASH-<staff_token_hash>` |
| `distribution_log.recipient_type` | `evacuee` \| `volunteer` \| `outside` | `evacuee` \| `volunteer` \| `staff` \| `outside` |
| `recipient_id` ของ `staff` | — | `user:{name}` (`name` = CouchDB username) |
| ปุ่ม "ดูบัตรของฉัน" | ไม่มี | header หน้า portal → dialog บัตร |
| user ที่มี `volunteer_id` กดดูบัตร | — | แสดง QR จิตอาสา (`TKT-VOL-HASH-…`) ใบเดิม |

### 2.1 Token format

| สิ่ง | ค่า | เก็บไหม |
| --- | --- | --- |
| plaintext | `TKT-STF-` + 16 random bytes (CSPRNG) เป็น hex 32 ตัว | ไม่เก็บ — ทิ้งหลัง hash |
| `staff_token_hash` | `sha256(plaintext)` hex 64 ตัว lowercase | เก็บใน `_users` |
| QR payload | `TKT-STF-HASH-` + `staff_token_hash` เป็น hex **ตัวใหญ่** (เหมือน `TKT-VOL-HASH-`) — A1 | ไม่เก็บ — สร้างจาก hash ตอนแสดง |

> **A1:** parser รับ payload ทุกตัวพิมพ์ (`trim` + `toUpperCase` ก่อนเทียบ prefix แบบ `trackingTokenHashFromPayload` ใน `volunteer-portal/domain/volunteer.ts`) แล้วแปลง hash เป็นตัวเล็กก่อน lookup — ดู FR-SQR-40

---

## 3. Requirements

### 3.1 Token และการออก token

- **FR-SQR-01** — `_users` มี field `staff_token_hash` (str\|null) ค่าเป็น SHA-256 hex 64 ตัว ห้ามเก็บ plaintext token ใน CouchDB
- **FR-SQR-02** — `createUser` ของ server (`frontend/src/lib/server/user-service.ts`, A1) ต้องออก `staff_token_hash` ให้ user ใหม่ทุกคนที่ไม่มี `volunteer_id` · `createOrMergeUser` ที่ merge เข้า account เดิมต้องไม่ออก token (ให้ backfill หรือ admin หมุนแทน)
- **FR-SQR-03** — user ที่มี `volunteer_id` (รวมที่สร้างจาก `grantVolunteerAccess` — A1: ตัวนี้เรียก `createUser` ของ `$lib/features/users` → `POST /api/v1/users` → `createOrMergeUser` → `createUser` ของ server จึงต้องตัดสินจาก `volunteer_id`/`personnel_type` ใน input ที่ server ไม่ใช่ฝั่ง client) และ user ที่ `personnel_type: 'volunteer'` แต่ไม่มี `volunteer_id` ต้องไม่ได้ `staff_token_hash`
- **FR-SQR-04** — service account ที่ไม่ใช่คน (public writer) ต้องไม่ได้ `staff_token_hash`
- **FR-SQR-05** — การแก้ user (`updateUser`, `updateOwnProfile`) ต้องคง `staff_token_hash` เดิมไว้
- **FR-SQR-06** — `updateOwnProfile` ต้องไม่รับ `staff_token_hash` และ `volunteer_id` จาก input ของผู้ใช้
- **FR-SQR-07** — response รายชื่อ/รายละเอียด user (`UserSummary`) ต้องไม่มี `staff_token_hash` — ใช้ `has_staff_card: boolean` แทน
- **FR-SQR-08** — มี one-off backfill script (ใต้ `frontend/scripts/`) ออก `staff_token_hash` ให้ `_users` เดิมที่ไม่มี `volunteer_id` และยังไม่มี hash ตามกฎ FR-SQR-03 · รวม user ที่ `active: false` · default dry-run · รันซ้ำแล้วออกเพิ่ม 0 · เขียนด้วย `_rev` เดิม เจอ 409 อ่านใหม่และ retry · ไม่แตะ field อื่น
- **FR-SQR-09** — seed (`frontend/scripts/seed/users.ts`) ต้องได้ `staff_token_hash` ตามกฎ FR-SQR-02/03

### 3.2 Endpoint (server เท่านั้น, admin credential ไม่ออก client)

| ID | Endpoint | Auth | ผล |
| --- | --- | --- | --- |
| FR-SQR-10 | `GET /api/v1/me/card` | `_session` ของตัวเอง | บัตรของตัวเอง: `staff` / `volunteer` / `none` |
| FR-SQR-11 | `GET /api/v1/users/staff-card?name=` | `system_admin` หรือ manager ที่มี scope ของ user | payload + ข้อมูลบัตรสำหรับพิมพ์ |
| FR-SQR-12 | `POST /api/v1/users/staff-card/rotate` | `system_admin` หรือ manager ที่ดูแล**ทุก**ศูนย์ใน roles ของ user นั้น · เจ้าหน้าที่หมุนของตัวเองไม่ได้ | ออก hash ใหม่, QR เก่าใช้ไม่ได้ทันที |
| FR-SQR-13 | `POST /api/v1/users/staff-card/resolve` | `_session` + `canAccessDistributionDesk(roles, shelter_code)` (A1) — `system_admin`, `shelter_manager` / `distribution_staff` ของศูนย์นั้น | หน้าแจก resolve payload → ผู้รับ |
| FR-SQR-14 | แปลง `user:{name}` → ชื่อแสดงผล | `_session` + shelter scope | ใช้กับรายการประวัติการแจก |

- **FR-SQR-15** — `GET /api/v1/me/card`: user ไม่มี `volunteer_id` และมี hash → `kind: 'staff'` · ไม่มี hash (รวม user ที่ `personnel_type: 'volunteer'` แต่ไม่มี `volunteer_id`) → `kind: 'none'` และ **ห้ามออก token**
- **FR-SQR-16** — `GET /api/v1/me/card`: user มี `volunteer_id` → ต้องตรวจว่า volunteer doc มี `user_name === session.name` (ลิงก์สองทาง) ก่อนคืน QR จิตอาสา · ไม่ตรง → `kind: 'none'`
- **FR-SQR-17** — `GET /api/v1/me/card` สำหรับจิตอาสา: มี `tracking_token_hash` → คืน `TKT-VOL-HASH-…` · ยังไม่มี → ออกครั้งแรกได้ตาม CR-127 · มีอยู่แล้ว → ห้ามออกใหม่/หมุน
- **FR-SQR-18** — `GET /api/v1/me/card`: `active: false` → `kind: 'none'`
- **FR-SQR-19** — `staff-card` / `rotate`: user ที่มี `volunteer_id` → ปฏิเสธ (409)
- **FR-SQR-20** — `rotate` เขียนด้วย `_rev` เดิม · 409 → คืน 409 ให้ client ลองใหม่ · ไม่แตะ field อื่น
- **FR-SQR-21** — `resolve` ตรวจที่ server ตามลำดับ: caller ผ่าน `canAccessDistributionDesk` (`frontend/src/lib/auth/roles.ts`) ของศูนย์ที่ระบุ จาก roles ใน `_session` (A1 — ไม่เชื่อ role จาก body) → payload ถูกรูปแบบ → หา user ด้วย `staff_token_hash` ผ่าน `_find` บน `_users` แบบไม่สร้าง index (0 → 404, >1 → 409) → `active !== false` (ไม่งั้น 403) → user มี `shelter:{code}` หรือ `{code}:{capability}` ของศูนย์นั้น หรือ `system_admin` (ไม่งั้น 404 แบบเดียวกับไม่เจอ hash — FR-SQR-41)
- **FR-SQR-22** — `resolve`: user ที่มี `volunteer_id` และลิงก์สองทางถูกต้อง → คืนผู้รับเป็น `recipient_type: 'volunteer'`, `recipient_id: volunteer:{ulid}` · ลิงก์ไม่ตรง → 409
- **FR-SQR-23** — `resolve` คืนเฉพาะ `recipient_type`, `recipient_id`, `display_name`, ป้ายบทบาทในศูนย์, `position` — ห้ามคืน hash, `phone`, `email` หรือ doc ทั้งก้อน

### 3.3 บัตร QR (UI)

- **FR-SQR-24** — header หน้า portal (`routes/(protected)/portal/+page.svelte`) มีปุ่ม "ดูบัตรของฉัน" เปิด dialog — ไม่สร้างหน้าใหม่
- **FR-SQR-25** — dialog บัตรอยู่ใน feature `me` (`lib/features/me/ui/`) export ผ่าน barrel `$lib/features/me`
- **FR-SQR-26** — บัตร staff แสดง `display_name`, คำว่า "เจ้าหน้าที่" (A2 — ทุกคนเหมือนกัน รวม `system_admin` และ user ที่มีหลาย role · ไม่แสดงรายการ role และไม่แสดง `position`) และ QR · ชื่อศูนย์แสดงบนจอใต้ตัวอย่างบัตร ไม่พิมพ์ลงบัตร (A2) — QR ใบเดียวกันทุกศูนย์
- **FR-SQR-27** — บัตรจิตอาสาแสดงชื่อ คำว่า "จิตอาสา" (ตำแหน่งเดียวกับ "เจ้าหน้าที่" — A2) `volunteer_code` และ QR จิตอาสา
- **FR-SQR-28** — `kind: 'none'` แสดงข้อความตามเหตุผล (ไม่มี QR → "ยังไม่มี QR กรุณาติดต่อผู้ดูแล" / บัญชีถูกปิด / ลิงก์จิตอาสาไม่ถูกต้อง) และแนะนำให้ติดต่อผู้ดูแล
- **FR-SQR-29** — ดาวน์โหลด (PNG) และพิมพ์บัตรจาก dialog ได้ · ทั้งสองแบบเป็นป้าย 80×60 mm หน้าตาเดียวกัน (A2 — FR-SQR-45) · dialog ไม่มีปุ่มหมุน QR
- **FR-SQR-30** — หน้าจัดการ user (`lib/features/users/`) มีปุ่ม "พิมพ์บัตร" และ "หมุน QR" (มี confirm เตือนว่า QR เก่าใช้ไม่ได้ทุกศูนย์) · ซ่อนสำหรับ user ที่มี `volunteer_id`

### 3.4 หน้าแจก `/onsite/distribution`

- **FR-SQR-31** — scanner แยก QR ตาม prefix: `TKT-STF-HASH-` → staff resolve (FR-SQR-13) · `TKT-VOL-` → จิตอาสา · อื่น ๆ → ผู้อพยพ · QR staff ต้องไม่ถูกตีความเป็นจิตอาสาหรือผู้อพยพ
- **FR-SQR-32** — QR staff รับได้ในรายการเดียวกับที่จิตอาสารับได้ (ตาม `allowVolunteer` เดิม)
- **FR-SQR-33** — สแกนสำเร็จบันทึก `recipient_type: 'staff'`, `recipient_id: user:{name}`
- **FR-SQR-34** — menu matching ส่ง `null` tags ให้ staff (เหมือน volunteer)
- **FR-SQR-35** — กันรับซ้ำมื้อเดียวกันด้วย `recipient_id` เหมือนเดิม (ใช้ override flow เดิมได้)
- **FR-SQR-36** — `RecipientName.svelte` แสดงชื่อ staff จาก `user:{name}` (ผ่าน FR-SQR-14) · fallback แสดง username

### 3.5 Data validation

- **FR-SQR-37** — Zod `distributionRecipientTypeSchema` เพิ่ม `staff` · refine: `staff` ต้องมี `recipient_id` ขึ้นต้น `user:`
- **FR-SQR-38** — VDU `distribution_log` ใน shelter DB (`shelter-access-design.ts`) รับ `staff` และบังคับ `recipient_id` ขึ้นต้น `user:` · redeploy design doc ทุกศูนย์ด้วย `scripts/redeploy-access.ts`
- **FR-SQR-39** — `returner_type` (bulk return) ไม่เปลี่ยน

### 3.6 ส่วนที่ปรับ A1 (proposed 2026-10-29 · approved kong 2026-10-30)

- **FR-SQR-40** — QR payload staff พิมพ์ hex ตัวใหญ่ · parser ของหน้าแจก (FR-SQR-31) และ `resolve` รับทุกตัวพิมพ์ (`trim` + `toUpperCase` ก่อนเทียบ prefix, hex ต้องเป็น `[0-9A-F]{64}`) แล้วแปลง hash เป็นตัวเล็กก่อน `_find` · `staff_token_hash` ใน `_users` เป็นตัวเล็กเสมอ
- **FR-SQR-41** — `resolve`: `shelter_code` ใน body ใช้เลือกศูนย์เท่านั้น ต้องผ่าน FR-SQR-21 ข้อแรกก่อน lookup ทุกครั้ง · ไม่เจอ hash กับ user ไม่มี role ในศูนย์นั้น ตอบ **404 แบบเดียวกัน** (ไม่บอกว่ามี hash อยู่ในศูนย์อื่น) · `active: false` ยังเป็น 403 · hash ซ้ำยังเป็น 409
- **FR-SQR-42** — `resolve` **ไม่มี rate limit ใน application layer** ตาม CR-188 (rate limit อยู่ที่ nginx `limit_req` ต่อ IP เท่านั้น) · การกันใช้ `resolve` เช็ก hash พึ่ง gate ผู้เรียก (FR-SQR-21) และ 404 แบบเดียวกัน (FR-SQR-41)
- **FR-SQR-43** — mint `staff_token_hash` ทำใน `createUser` ของ server ที่เดียว · `createUser` ฝั่ง client (`$lib/features/users`) ห้ามส่งหรือสร้าง hash · body ของ `POST /api/v1/users` ที่มี `staff_token_hash` → ignore

### 3.7 ส่วนที่ปรับ A2 (proposed 2026-10-31 · approved kong 2026-10-31)

- **FR-SQR-44** — ป้ายสถานะบนบัตร อยู่ล่างสุดของคอลัมน์ข้อความ เหนือบรรทัดลิงก์ shelter.psu.ac.th: staff = "เจ้าหน้าที่" (14pt หนา ตัวดำบนพื้นขาว ใหญ่กว่าบรรทัดรอง) · จิตอาสา = "จิตอาสา" ขนาดเดียวกัน และมี "รหัสจิตอาสา {volunteer_code}" ใต้ชื่อ · ไม่คำนวณจาก role ของ user
- **FR-SQR-45** — PNG ที่ดาวน์โหลดได้จากบัตร render จาก component ป้าย 80×60 mm ตัวเดียวกับตัวอย่างบนจอและแผ่นพิมพ์ (`KioskLabelCard`) · ชื่อไฟล์ `staff-card-{ชื่อ}.png` · บนมือถือที่แชร์ไฟล์ได้ เปิด share sheet แทนดาวน์โหลด

---

## 4. Acceptance criteria

- [ ] **AC-01** สร้าง staff ใหม่ → `_users` doc มี `staff_token_hash` 64 hex และไม่มี plaintext token
- [ ] **AC-02** สร้าง user จากฝั่งจิตอาสา → ไม่มี `staff_token_hash`
- [ ] **AC-03** backfill dry-run แสดงจำนวน · write แล้วรันซ้ำออกเพิ่ม 0 · password ของ user ยัง login ได้
- [ ] **AC-04** เจ้าหน้าที่กด "ดูบัตรของฉัน" เห็นชื่อ คำว่า "เจ้าหน้าที่" (ไม่มีรายการ role แม้มีหลาย role — A2) ศูนย์ และ QR ครบ · เปลี่ยนศูนย์แล้ว QR เดิม
- [ ] **AC-17** (A2) กดดาวน์โหลด PNG จากบัตร (portal หรือหน้าจัดการ user) ได้ภาพป้าย 80×60 หน้าตาเดียวกับที่พิมพ์ · user `system_admin` และ user หลาย role ได้บรรทัด "เจ้าหน้าที่" เหมือนกัน
- [ ] **AC-05** user ที่มาจากจิตอาสากด "ดูบัตรของฉัน" เห็น QR จิตอาสาใบเดิม (QR ในมือถือยังใช้ได้ ไม่ถูกหมุน)
- [ ] **AC-06** user แก้ `volunteer_id` ใน `_users` doc ตัวเองเป็นของจิตอาสาคนอื่น → `GET /api/v1/me/card` ไม่คืน QR ของจิตอาสาคนนั้น
- [ ] **AC-07** สแกน QR staff ที่หน้าแจกแล้วแจกได้ · log เป็น `recipient_type: 'staff'`, `recipient_id: user:{name}`
- [ ] **AC-08** staff ศูนย์อื่น / user ที่ `active: false` / QR ที่หมุนไปแล้ว → สแกนไม่ผ่าน
- [ ] **AC-09** รับซ้ำมื้อเดียวกันไม่ได้ (ยกเว้น override)
- [ ] **AC-10** สแกน QR จิตอาสาแล้วสแกน QR staff ของ user คนเดียวกันที่มี `volunteer_id` ในมื้อเดียวกัน → ครั้งที่สองติด "รับไปแล้ว"
- [ ] **AC-11** QR ผู้อพยพและ QR จิตอาสายังทำงานเหมือนเดิม
- [ ] **AC-12** response ของ `GET /api/v1/users` และ `resolve` ไม่มี `staff_token_hash`
- [ ] **AC-13** client bundle ไม่มี admin credential
- [ ] **AC-15** (A1) Playwright e2e ที่ `/onsite/distribution` ครอบ AC-07, AC-09 และ AC-10: สแกน QR staff → แจก → `distribution_log` เป็น `staff` / `user:{name}` · สแกนซ้ำมื้อเดียวกันติด "รับไปแล้ว" · QR จิตอาสาแล้ว QR staff ของคนเดียวกันติด "รับไปแล้ว" · payload ตัวเล็กยัง resolve ได้ (FR-SQR-40)
- [ ] **AC-16** (A1) `resolve` จาก `warehouse_staff` / `supply_coordinator` หรือ role ของศูนย์อื่น → 403 · hash ที่ไม่มีกับ user ศูนย์อื่น → 404 เหมือนกัน
- [ ] **AC-14** unit test: token/payload parser, menu matching, scan routing, map user ที่มี `volunteer_id` · server test: mint ใน `createUser`, backfill, `me/card`, `staff-card`, `rotate`, `resolve` ทุก branch · VDU test รับ/ปฏิเสธ `staff` · `.svelte` ที่แตะผ่าน `svelte-autofixer`

---

## 5. Risks ที่ยอมรับ (kong รับ 2026-10-29)

| # | ความเสี่ยง | เหตุผลที่รับได้ / mitigation |
| --- | --- | --- |
| R1 | QR payload คือ hash ที่เก็บใน DB — เป็น bearer token; ใครมีรูป QR หรืออ่าน `_users` ได้ ใช้แทนได้ · บัตรไม่มีรูปถ่าย | แบบเดียวกับ CR-127 · หน้าแจกแสดงชื่อ/บทบาทหลังสแกนให้คนแจกเทียบ · หมุน QR ได้ · ของที่ได้คืออาหาร/ของแจก ไม่ใช่สิทธิ์ระบบ |
| R2 | กันรับซ้ำเป็น advisory ที่ client (CR-121) — สองจุดแจกสแกนพร้อมกันอาจผ่านทั้งคู่ | พฤติกรรมเดิมของผู้อพยพ/จิตอาสา |
| R3 | กันรับซ้ำเช็คได้แค่ใน DB ศูนย์เดียว — staff ที่มี role สองศูนย์รับมื้อเดียวกันได้ที่ละศูนย์ | พฤติกรรมเดิมของจิตอาสา |
| R4 | CouchDB `_users` default ให้ user แก้ doc ตัวเองได้ทุก field ยกเว้น `roles`/`name` | ไม่เชื่อ `volunteer_id` ฝ่ายเดียว (FR-SQR-16/22) · hash ซ้ำ → 409 (FR-SQR-21) · ต้องยืนยันพฤติกรรมจริงบน instance ของโครงการ · การแก้ `active` เองเป็นปัญหาเดิม นอก scope CR นี้ |

---

## 6. Out of scope

- เช็คอิน/เช็คเอาต์เจ้าหน้าที่ด้วย QR (นับเจ้าหน้าที่ใช้ user ที่มี role ของศูนย์ — #806)
- ใช้ QR login หรือ step-up
- พิมพ์บัตร staff ที่ kiosk
- หน้าใหม่สำหรับดูบัตร
- `validate_doc_update` ของ `_users` เพื่อล็อก field ที่ระบบตั้ง (stable core — แยกเรื่อง)

---

## 7. Migration

- **`_users`:** additive · ไม่มี `schema_v` · one-off backfill (FR-SQR-08) ข้าม `_design/*`, user ที่มี `volunteer_id`, user ที่ `personnel_type: 'volunteer'`, user ที่มี hash แล้ว และ service account · ไม่สร้าง Mango index
- **`distribution_log`:** doc เดิมไม่ต้องแก้ · VDU ต้อง redeploy ทุกศูนย์ก่อน client รุ่นใหม่เขียน `staff` · ไม่ bump `schema_v` (คงที่ 2)
- **QR จิตอาสา:** ไม่เปลี่ยน — `tracking_token_hash` เดิมใช้ต่อ (CR-127)

---

## 8. Decision log

- 2026-10-28 — proposed (ทีม, issue #893)
- 2026-10-28 — ข้อเสนอทีม: ชื่อ field `staff_token_hash` (ไม่ใช้ `user_token_hash` เพราะไม่ได้ออกให้ทุก user — user ที่มี `volunteer_id` ใช้ QR จิตอาสา; ชื่อตรงกับ prefix `TKT-STF-` และ `recipient_type: 'staff'`; `user_token` ฟังคล้าย auth/session token ซึ่ง QR นี้ไม่ใช่)
- 2026-10-28 — ข้อเสนอทีม: ออก token ตอนสร้าง user + backfill แทนการออกตอนเปิดบัตรครั้งแรก (การอ่านบัตรเป็น read-only, ไม่มี write race บน `_users`, admin พิมพ์บัตรล่วงหน้าได้)
- 2026-10-28 — ข้อเสนอทีม: `recipient_id` ของ staff = `user:{name}` (เข้ารูป `<type>:<id>` เดิม, username เปลี่ยนไม่ได้ใน CouchDB, ไม่ผูกกับคำว่า staff, ไม่เอา prefix `org.couchdb.user:` เข้า domain) — ตัดทิ้ง: `org.couchdb.user:{name}`, `staff:{name}`
- 2026-10-28 — ข้อเสนอทีม: endpoint บัตรจิตอาสาตรวจลิงก์สองทาง `_users.volunteer_id` ↔ `volunteer.user_name` เพราะ user แก้ `volunteer_id` ใน doc ตัวเองได้
- 2026-10-28 — ข้อเสนอทีม: แสดงชื่อ staff ในประวัติด้วย endpoint แปลงชื่อ ไม่เพิ่ม field ชื่อใน `distribution_log`
- 2026-10-29 — ข้อเสนอทีม: หมุน QR ได้เฉพาะ admin (`system_admin` หรือ manager ที่ดูแลทุกศูนย์ใน roles ของ user) เพราะหมุนแล้วกระทบทุกศูนย์ · เจ้าหน้าที่หมุนเองจาก dialog ไม่ได้
- 2026-10-29 — ข้อเสนอทีม: เปิดบัตรแล้วไม่มี hash → แสดงข้อความติดต่อผู้ดูแล ไม่ออก token ตอนอ่าน · `createOrMergeUser` ไม่ออก token (ให้ backfill/admin จัดการ)
- 2026-10-29 — ข้อเสนอทีม: user ที่ `personnel_type: 'volunteer'` แต่ไม่มี `volunteer_id` ไม่ได้บัตร staff
- 2026-10-29 — ข้อเสนอทีม: backfill ออก token ให้ user ที่ `active: false` ด้วย (สแกนไม่ผ่านอยู่แล้ว เปิดใช้ใหม่มี QR พร้อม)
- 2026-10-29 — ข้อเสนอทีม: ไม่ bump `schema_v` ของ `distribution_log` เพราะเพิ่ม enum แบบ additive และ worker/backend ไม่อ่าน `recipient_type` · ต้อง redeploy VDU ก่อนเปิดใช้
- 2026-10-29 — ข้อเสนอทีม: lookup hash ด้วย `_find` บน `_users` แบบไม่มี index เพราะปริมาณ `_users` น้อยและไม่ต้องแตะ provisioning (stable core)
- 2026-10-29 — **approved (kong)** — รับข้อเสนอทีมทุกข้อใน Decision log ตามที่เสนอ และรับความเสี่ยง R1–R4 (§5) ตามที่เขียน
- 2026-10-29 — ข้อเสนอทีม (A1, proposed): ปิด warning จาก PR review — payload ตัวใหญ่ + parser ไม่สนตัวพิมพ์ (FR-SQR-40) · resolve ตาม gate `canAccessDistributionDesk` · 404 เดียวกันสำหรับไม่เจอ/ศูนย์อื่น (FR-SQR-41) · ไม่มี rate limit ในแอปตาม CR-188 (FR-SQR-42, แก้ 2026-10-30 — เดิมเสนอ 30/นาที/user) · ระบุ `createUser` ของ server (FR-SQR-43) · e2e AC-15/16 · `affects` ครบ · รอ kong approve
- 2026-10-30 — **A1 approved (kong)** — รับข้อเสนอ A1 ทุกข้อตามที่เขียน (FR-SQR-40..43, AC-15/16, แก้ §2.1 และ FR-SQR-02/03/13/21, `affects`) รวมการตอบ 404 เดียวกันใน FR-SQR-21 และไม่มี rate limit ในแอปตาม CR-188
- 2026-10-31 — ข้อเสนอทีม (A2, proposed): บัตรแสดง "เจ้าหน้าที่" ตัวใหญ่แทนรายการ role (รวม admin) เพราะ user หลาย role ทำให้ป้ายรก · ไม่แสดง `position` บนบัตร · PNG เป็นป้าย 80×60 เดียวกับพิมพ์ · `resolve`/หน้าแจกยังแสดง role ตามเดิม (R1) · รอ approve
- 2026-10-31 — **A2 approved (kong)** — รับข้อเสนอ A2 ทุกข้อตามที่เขียน (แก้ FR-SQR-26/27/29 และ AC-04, เพิ่ม FR-SQR-44/45 และ AC-17): บัตรแสดง "เจ้าหน้าที่" / "จิตอาสา" แทนรายการ role และไม่แสดง `position` · PNG เป็นป้าย 80×60 เดียวกับที่พิมพ์ · `resolve` และหน้าแจกยังแสดง role ตามเดิม (R1) — ไม่แตะ token, endpoint หรือ schema
