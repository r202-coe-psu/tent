---
id: draft
title: ผู้ประสานงานจิตอาสาจัดการบัญชีจิตอาสาได้ครบวงจร — 10 ตำแหน่ง, แก้สิทธิ์, หน้าบัญชีจิตอาสา, พากลับมา, สถานะใน portal และ 1 บัญชีใช้ได้หลายศูนย์
status: proposed
date: 2026-10-30
updated: 2026-10-30
requested_by: "@mhapong จากการทดสอบ CR-213 บน develop (2026-10-30) — #1044, #1045"
decided_by: "รอ @Jackyzaz approve"
layer: stable
amends: CR-213 (FR-2, FR-5, FR-7, FR-8, FR-10, FR-11, FR-12)
affects:
  - docs/changes/06-A-volunteer/CR-213-coordinator-limited-access-grant.md (ใส่หมายเหตุ "แก้โดย CR นี้" ที่ FR-2, FR-5, FR-7, FR-8, FR-10, FR-11, FR-12)
  - docs/data/schema.md §6 `_users` (เพิ่ม `volunteer_profiles`; `_design/tent_guard` ป้องกัน field นี้) — Part B
  - docs/data/api-contract.md (`GET /api/v1/volunteer-access/accounts` ใหม่, `POST` / `DELETE /api/v1/volunteer-access`, `PUT /api/v1/users` field `active`)
  - docs/prd/role-permission-matrix.md (แถว User Management / VC)
  - docs/prd/sitemap หรือเอกสารเมนู back-office (เมนู "บัญชีจิตอาสา")
  - ไม่ bump `schema_v` (`_users` ไม่มี common envelope; โปรไฟล์ `volunteer` ไม่เปลี่ยนรูป)
  - frontend/src/lib/auth/roles.ts (`COORDINATOR_GRANTABLE_CAPABILITIES`), frontend/src/lib/auth/role-grants.ts
  - frontend/src/lib/server/user-service.ts (`grantCoordinatorRole`, `revokeCoordinatorGrant`, `updateUser` field `active`)
  - frontend/src/lib/features/volunteers (server/volunteer-access-grant.ts, application/volunteer-access.ts, ui/volunteer-access-dialog.svelte, ui/volunteer-card.svelte, หน้าใหม่ volunteer-accounts)
  - frontend/src/routes/api/v1/volunteer-access/** (เพิ่ม `accounts`), frontend/src/routes/api/public/v1/volunteer/access-status/ (Part C), frontend/src/lib/features/volunteer-portal (Part C)
  - frontend/src/lib/features/volunteers/ui/roster-row.svelte (FR-22a/b), frontend/src/routes/(protected)/back-office/volunteers/accounts/
  - frontend/src/lib/components/backoffice-navbar/static.ts (เมนูใหม่ ใช้ `canAccessVolunteerBackoffice` ตาม #1020)
  - frontend/src/lib/server/users-guard-design.ts (Part B) → `pnpm sync:central`
  - frontend/scripts (Part B: backfill `volunteer_profiles`)
  - worker/src/worker/role_grants.py (ถอน grant ของโปรไฟล์ `status: inactive`)
  - ขึ้นกับ #984 (ปุ่ม "เปิดใช้งานอีกครั้ง" ของโปรไฟล์) และ #1020 (sidebar ตาม guard)
  - tests: role-grants, volunteer-access-grant, user-service, users-guard-design, volunteer-access-dialog / volunteer-card dom, หน้า accounts, worker test_role_grants, frontend/e2e/volunteer-access-roles.test.ts
---

# ผู้ประสานงานจิตอาสาจัดการบัญชีจิตอาสาได้ครบวงจร

> **สรุป (TL;DR):**
>
> - **role + แก้สิทธิ์:** `volunteer_coordinator` (VC) ออกได้ 10 role (ทุกตำแหน่งยกเว้น ผู้ประสานงานจิตอาสา, ดูแลตู้ Kiosk, ผู้จัดการศูนย์) จิตอาสามีได้ 1 role ต่อศูนย์ VC แก้ role / วันหมดอายุ และถอนสิทธิ์ที่ VC คนไหนก็ได้ออกในศูนย์ตัวเอง
> - **หน้า + ปุ่ม:** เมนูใหม่ "บัญชีจิตอาสา" แสดงบัญชีจิตอาสาของศูนย์ (รวมบัญชีที่สิทธิ์สิ้นสุดแล้ว); ปุ่มบนการ์ดเปลี่ยนตามสถานะ (ออกสิทธิ์ / แก้ไขสิทธิ์ / ออกสิทธิ์อีกครั้ง)
> - **วงจรชีวิต:** ปิดโปรไฟล์ = ถอนสิทธิ์ในศูนย์นั้น (worker ≤ 5 นาที); VC พาคนกลับมาได้เองโดยไม่ผ่าน SM/SA; ปิดทั้งบัญชีจิตอาสาได้เฉพาะ SA
> - **หลายศูนย์ (Part B):** จิตอาสา 1 คน = 1 บัญชี ใช้ได้หลายศูนย์ role ต่างกันต่อศูนย์ VC ของศูนย์ใหม่ผูกบัญชีเดิมได้เองเมื่อเบอร์มือถือและเลขบัตรตรงกัน
> - **portal (Part C):** จิตอาสาเห็นใน portal ว่าได้รับสิทธิ์แล้วหรือยัง (role + วันหมด ไม่แสดงชื่อบัญชี)
> - **layer: stable** (auth / `_users` / worker) ต้อง review ก่อน approve · โค้ด 3 PR: Part A → Part C → Part B

---

## Why

- **role ไม่พอ:** CR-213 FR-2 จำกัด VC ไว้ 4 role งานหน้าศูนย์ต้องใช้จิตอาสาในตำแหน่งอื่นด้วย
- **แก้สิทธิ์ที่ออกผิดยาก:** ไม่มีปุ่มแก้ไข (ปุ่มบนการ์ดเขียน "ออกสิทธิ์ใช้งานระบบ" แม้คนนั้นมีสิทธิ์อยู่), เลือก role ใหม่ให้บัญชีเดิมแล้วระบบ**เพิ่ม** role แทนการเปลี่ยน, ช่องอีเมลของบัญชีที่ผูกแล้วพิมพ์ได้ทั้งที่ชื่อบัญชี (`_id` ของ `_users`) เปลี่ยนไม่ได้; CR-213 FR-8 ให้ถอนหรือย่นได้เฉพาะ grant ที่ตัวเองออก VC อีกคนในกะถัดไปแก้ให้ไม่ได้
- **ถอนแล้วบัญชีหายจากศูนย์:** `withoutGrantedRole` และ worker sweep ถอด `shelter:SHxxx` เมื่อไม่เหลือ role; `listUsers` ของ SM กรองด้วย `shelter:SHxxx`; VC ไม่มีหน้าใดแสดงบัญชีจิตอาสา จึงพาคนเดิมกลับมาไม่ได้โดยไม่พึ่ง SM/SA
- **ปิดโปรไฟล์แล้วสิทธิ์ไม่ถูกถอน:** ปุ่มปิดโปรไฟล์ (`status: inactive`) ไม่แตะ `_users` คนที่ถูกปิดยังเข้าระบบได้จนหมดอายุ
- **ปิดทั้งบัญชีกระทบทุกศูนย์:** `_users.active` เป็นระดับบัญชี SM ของศูนย์หนึ่งปิดแล้วจิตอาสาทำงานศูนย์อื่นไม่ได้
- **หลายศูนย์ใช้ไม่ได้:** role แบบ compound รองรับหลายศูนย์แล้ว แต่ `_users.volunteer_id` ผูกได้ 1 โปรไฟล์ และ CR-213 FR-7 ต้องให้ `volunteer_id` ตรง VC ของศูนย์ที่ 2 จึงออกสิทธิ์ให้บัญชีเดิมไม่ได้ ต้องสร้างบัญชีที่ 2

## Change — Part A (PR 1)

### A1 — role ที่ VC ออกได้ (แก้ CR-213 FR-2)

- **FR-1:** `COORDINATOR_GRANTABLE_CAPABILITIES` = `STAFF_CAPABILITIES` ลบ `volunteer_coordinator` และ `kiosk_staff` (10 role): `registration_staff`, `triage_staff`, `medical_staff`, `kitchen_staff`, `supply_coordinator`, `warehouse_staff`, `distribution_staff`, `pr_staff`, `facility_staff`, `security_officer`
  - `shelter_manager` ไม่อยู่ใน `STAFF_CAPABILITIES` จึงออกไม่ได้; role นอกรายการได้ 403
- **FR-2:** role ที่ VC ออกใช้สิทธิ์เหมือน role ที่ SM ออกทุกประการ (guard, sidebar, VDU) ต่างกันเฉพาะมีวันหมดอายุ
- **FR-3:** กติกา CR-213 คงเดิม: ศูนย์ตัวเอง (FR-1), ยืนยันตัวตน (FR-3), วันหมดไม่เกินสิ้นวันที่ +7 (FR-4), audit (FR-14)
- **FR-4 1 role ต่อศูนย์ (เฉพาะจิตอาสา):** บัญชี `personnel_type: volunteer` มี role ได้ไม่เกิน 1 role ต่อศูนย์ (ทั้งที่ VC ออกและที่ SM ให้) และอยู่ได้หลายศูนย์ (Part B)
  - บัญชีเจ้าหน้าที่ (ไม่ใช่จิตอาสา) ไม่เปลี่ยน: อยู่ได้หลายศูนย์และมีหลาย role ต่อศูนย์ จัดการผ่านหน้าผู้ใช้งานโดย SM/SA ตามเดิม

### A2 — หน้า "บัญชีจิตอาสา" และ endpoint

- **FR-5 เมนูและหน้า:** เพิ่มเมนู sidebar "บัญชีจิตอาสา" ใต้ "จัดการอาสาสมัคร" → `/back-office/volunteers/accounts`; guard และ `visibleTo` ใช้ `canAccessVolunteerBackoffice` (SA / SM / VC ของศูนย์ที่เลือก)
- **FR-6 endpoint:** `GET /api/v1/volunteer-access/accounts?shelter_code=` (SA / SM / VC ของศูนย์นั้น; ศูนย์อ่านจาก session ตาม CR-213 FR-1) คืนรายการ:
  `{ volunteer_id, display_name, login_name, status, role: { role, expires_at | null, granted_by | null, mine } | null, profile_active }`
  - `status` ∈ `active` (มี role ในศูนย์นี้) / `lapsed` (บัญชีมี ไม่มี role ในศูนย์นี้) / `account_disabled` (`_users.active = false`)
  - `expires_at: null` = role ถาวรจาก SM; `granted_by` มีเฉพาะ grant ของ VC
  - ไม่คืนรหัสผ่าน, MFA, ข้อมูลติดต่อ หรือ role ของศูนย์อื่น
- **FR-7 บัญชีของศูนย์:** นับเฉพาะบัญชีที่ผูก 2 ทาง: โปรไฟล์ใน `shelter_{code}` มี `user_name` = บัญชี **และ** บัญชีชี้กลับโปรไฟล์นั้น (`volunteer_id`; Part B: `volunteer_profiles`) และ `personnel_type: volunteer` ผูกทางเดียวไม่นับ
- **FR-8 หน้า:** ตาราง ชื่อ · บัญชี · ตำแหน่ง · หมดอายุ ("ถาวร" สำหรับ role ของ SM) · ออกโดย ("ผู้จัดการศูนย์" สำหรับ role ของ SM) · ปุ่มตามสถานะ (FR-9)
  - ค้นหาชื่อ / อีเมล; ตัวกรอง: มีสิทธิ์อยู่ / สิ้นสุดแล้ว / โปรไฟล์ถูกปิด / ใกล้หมดอายุ (≤ 1 วัน)

### A3 — ปุ่มบนการ์ดและในหน้าบัญชี

- **FR-9:** ข้อมูลจาก FR-6 (1 request ต่อหน้า)

  | สถานะ | ปุ่ม |
  | --- | --- |
  | ไม่มีบัญชี | "ออกสิทธิ์ใช้งานระบบ" |
  | `active` | "แก้ไขสิทธิ์" |
  | `lapsed` | "ออกสิทธิ์อีกครั้ง" |
  | โปรไฟล์ `status: inactive` | "เปิดใช้งานอีกครั้ง" (#984) ไม่มีปุ่มออกสิทธิ์ |
  | `account_disabled` | ไม่มีปุ่ม; ป้าย "บัญชีถูกระงับโดยผู้ดูแลระบบ" |

  - SM/SA: บัญชีสถานะ `lapsed` เปิด dialog "ออกสิทธิ์อีกครั้ง" แทนลิงก์ "จัดการบัญชีผู้ใช้"

### A4 — dialog

- **FR-10 username:** สถานะ `active` / `lapsed` แสดง username เป็นข้อความอ่านอย่างเดียว + "บัญชีนี้มีอยู่แล้ว การออกสิทธิ์ไม่เปลี่ยนรหัสผ่านเดิม" ไม่มีช่องรหัสผ่าน; ไม่มีบัญชี: ช่องอีเมลและรหัสผ่านตามเดิม
- **FR-11a วันหมดอายุใช้ component:** ช่องวันหมดอายุใช้ `date-picker` ของ `lib/components/ui` แทน `<input type="date">` จำกัดวันที่เลือกได้ตาม CR-213 FR-4 (วันนี้ ถึง +7, Asia/Bangkok)
- **FR-11 role เป็น radio:** radio group ของ role ที่ผู้เรียกออกได้ เลือก 1; สถานะ `active` เลือก role ปัจจุบันไว้ล่วงหน้า
- **FR-12 วันหมดอายุ:** ต้องเลือกใหม่ทุกครั้ง ช่องเริ่มว่าง required; สถานะ `active` แสดง "เดิม: หมดอายุสิ้นวันที่ dd/mm/yyyy" ใต้ช่อง และ "ออกโดย …"
- **FR-13 หัวข้อ / ปุ่ม:** "ออกสิทธิ์ใช้งานระบบ" / "แก้ไขสิทธิ์" + "บันทึกการแก้ไข" / "ออกสิทธิ์อีกครั้ง" ตามสถานะ
- **FR-14 ยังไม่ยืนยันตัวตน:** ปุ่มบันทึกถูกปิดพร้อมเหตุผลใน dialog (ตามเดิม); server ปฏิเสธแสดง toast
- **FR-15 role ของ SM:** สถานะ `active` ที่ role ในศูนย์นี้เป็น role ถาวรจาก SM: VC เห็น role และ "ผู้จัดการศูนย์เป็นผู้ให้ แก้ไขได้ที่หน้าผู้ใช้งาน" บันทึกไม่ได้

### A5 — แก้และถอนสิทธิ์ (แก้ CR-213 FR-7, FR-8)

- **FR-16 VC จัดการ grant ของ VC ทุกคน:** VC ถอน (`DELETE /api/v1/volunteer-access`), ต่ออายุ, ย่นอายุ และเปลี่ยน role ได้กับทุก grant ในศูนย์ตัวเอง ไม่ต้องเป็นผู้ออก; role ถาวรจาก SM (ไม่มี grant) ยังแตะไม่ได้ (403)
  - `mine` ใน CR-213 FR-8 เหลือไว้แสดงผลเท่านั้น ไม่ใช้ตัดสิทธิ์
- **FR-17 เปลี่ยน role:** `POST /api/v1/volunteer-access` แทนที่ grant ของศูนย์นี้ใน `PUT` `_users` ครั้งเดียว: ถอด `SHxxx:<role เดิม>` + grant เดิม เพิ่ม `SHxxx:<role ใหม่>` + grant ใหม่ (`granted_by` = ผู้เรียก) `shelter:SHxxx` คงอยู่ตลอด
  - บัญชีที่มี grant มากกว่า 1 role ในศูนย์นี้ (ออกก่อน CR นี้): แทนที่ทุก grant ของศูนย์นี้ด้วย role ที่เลือก
  - 409 จาก `_users` ตอบ CONFLICT ให้โหลดใหม่
- **FR-18 audit:** เปลี่ยน role เขียน `role_grant.revoked` (grant เดิม) + `role_grant.issued` (grant ใหม่); ทุกการถอน / แก้ grant ที่ผู้อื่นออกบันทึก `actor` = ผู้เรียก และ `context.granted_by` = ผู้ออกเดิม

### A6 — ปิด-เปิด

- **FR-19 ปิดโปรไฟล์ = ถอนสิทธิ์:** worker sweep (CR-213 FR-12) ถอนทุก grant ในศูนย์ `SHxxx` ของบัญชีที่โปรไฟล์ที่ผูกในศูนย์นั้นมี `status: inactive` audit `role_grant.revoked` `actor: worker` `context.cause: profile_inactive` (≤ 5 นาที ตาม CR-213 FR-13)
  - role ถาวรจาก SM ไม่ถูกแตะ; dialog ยืนยันการปิดโปรไฟล์เตือน "ยังมีสิทธิ์ที่ผู้จัดการศูนย์ให้ ต้องให้ผู้จัดการศูนย์ถอน" เมื่อมี
- **FR-20 ห้ามออกสิทธิ์ให้โปรไฟล์ที่ปิด:** `POST /api/v1/volunteer-access` ตอบ 422 "เปิดใช้งานอาสาสมัครก่อนจึงจะออกสิทธิ์ได้"
- **FR-21 พากลับมา:** ถอน / หมดอายุ / ปิดแล้วเปิดโปรไฟล์ใหม่ → สถานะ `lapsed` → VC "ออกสิทธิ์อีกครั้ง" ด้วย role เดิมหรือใหม่ + วันหมดใหม่ ให้บัญชีเดิม (รหัสผ่านเดิม) ไม่ผ่าน SM/SA; เงื่อนไข CR-213 FR-3 และ FR-7 ยังใช้
- **FR-22 ปิดทั้งบัญชีจิตอาสา:** `PUT /api/v1/users` เปลี่ยน `active` ของบัญชี `personnel_type: volunteer` ได้เฉพาะ SA (SM ได้ 403 "บัญชีจิตอาสาใช้การถอนสิทธิ์ในศูนย์แทนการปิดบัญชี"); บัญชีเจ้าหน้าที่ทั่วไปเหมือนเดิม; VC เปิดบัญชีที่ SA ปิดไม่ได้ (CR-213 FR-7 เดิม)

### A7 — ยืนยันตัวตนและออกสิทธิ์จากหน้ากะ

- **FR-22a:** แถวในตารางกะ (`roster-row`) ที่ขึ้น "รอยืนยันตัวตน" มีปุ่ม "ยืนยันตัวตน" เปิด dialog ตรวจตัวตนเดียวกับหน้าโปรไฟล์ (ผู้ยืนยันและกติกาเดิม) ยืนยันแล้วแถวกลับมาเช็คอินได้ทันทีโดยไม่ออกจากหน้ากะ
- **FR-22b:** แถวในตารางกะมีปุ่มสิทธิ์ตามสถานะ FR-9 เปิด dialog เดียวกับ FR-10 ถึง FR-15 (เห็นเฉพาะ SA / SM / VC)

## Change — Part C (PR 2): portal จิตอาสาแสดงสถานะสิทธิ์

- **FR-28:** หน้า portal จิตอาสา (หลังเข้าด้วยเบอร์หรือ token ตั๋ว) แสดงการ์ด "สิทธิ์ใช้งานระบบ" ของแต่ละศูนย์ที่จิตอาสามีโปรไฟล์
  - ยังไม่มีบัญชี / `lapsed`: "ยังไม่ได้รับสิทธิ์ใช้งานระบบ — ติดต่อผู้ประสานงานจิตอาสาของศูนย์"
  - `active`: "<ชื่อ role> · หมดอายุสิ้นวันที่ dd/mm/yyyy" (role ถาวร: ไม่แสดงวันหมด) + ปุ่ม "เข้าสู่ระบบเจ้าหน้าที่" → `/login`
  - `account_disabled`: "บัญชีถูกระงับ — ติดต่อผู้ดูแลระบบ"
- **FR-29 endpoint:** `POST /api/public/v1/volunteer/access-status` รับ credential เดียวกับ `/api/public/v1/volunteer/schedule` (เบอร์หรือ token ตั๋ว) หาโปรไฟล์จาก `phone_hash` แล้วหาบัญชีด้วยการผูก 2 ทาง (FR-7) ฝั่ง server ด้วย admin credential
- **FR-30 ข้อมูลที่คืน:** `[{ shelter_code, shelter_name, status, role_label | null, expires_at | null }]` เท่านั้น **ห้ามคืน username / อีเมล / ผู้ออก** (portal เข้าได้ด้วยเบอร์ คนที่รู้เบอร์ไม่ควรรู้ชื่อบัญชี)

## Change — Part B (PR 3): 1 บัญชีหลายศูนย์

- **FR-23 field ใหม่:** `_users.volunteer_profiles: [{ shelter_code, volunteer_id }]` 1 รายการต่อศูนย์
  - `volunteer_id` เดิมคงไว้ = โปรไฟล์แรก (โค้ดที่อ่านอยู่ไม่พัง)
  - ไม่ให้สิทธิ์ข้อมูล (ไม่อยู่ใน `roles`), ไม่ถูกลบตอนถอน / หมดอายุ / ปิดโปรไฟล์
  - เพิ่มในรายการ field ของ `_users/_design/tent_guard` (CR-213 FR-11) ผู้ที่ไม่ใช่ admin เปลี่ยนไม่ได้
- **FR-24 ผูกศูนย์ใหม่:** VC (หรือ SM) ของ SH002 ออกสิทธิ์ให้โปรไฟล์ SH002 แล้วพบบัญชีจิตอาสาเดิมที่โปรไฟล์ที่ผูกอยู่มี `phone_hash` **และ** `national_id_hash` ตรงกับโปรไฟล์ SH002 → เพิ่ม `{ SH002, volunteer_id }` เข้า `volunteer_profiles`, ตั้ง `user_name` ของโปรไฟล์ SH002, ออก role ของ SH002; ไม่สร้างบัญชีใหม่และไม่เปลี่ยนรหัสผ่าน
  - dialog แสดง "พบบัญชีเดิมของจิตอาสาคนนี้: <username>" อ่านอย่างเดียว
  - ใช้ได้แม้บัญชีไม่มี role ในศูนย์ใดเหลือ (ออกจากศูนย์ล่าสุดแล้ว) ไม่ต้องผ่าน SM ของศูนย์ใหม่
  - โปรไฟล์ SH002 ไม่มี `national_id_hash` หรือไม่ตรง: ไม่ผูก ไม่สร้างบัญชีซ้ำด้วยอีเมลเดียวกัน แจ้ง "จิตอาสาคนนี้มีบัญชีอยู่แล้ว กรุณากรอกเลขบัตรประชาชนให้ตรงกับข้อมูลเดิม"
  - บัญชีที่มี `volunteer_coordinator` หรือ `shelter_manager` ในศูนย์ใด: VC ผูกและออกสิทธิ์ให้ไม่ได้ (CR-213 FR-7) **SM ของศูนย์ที่จะให้ทำงาน (SH002) เป็นผู้ผูกและออก role ของ SH002 เอง** ไม่ต้องผ่าน SA; SM แตะได้เฉพาะ role ของศูนย์ตัวเอง
  - บัญชี `system_admin`: ไม่ผูก
- **FR-25 แยกต่อศูนย์:** ผู้ออกสิทธิ์ใน SH002 ต้องมี `volunteer_coordinator` (หรือ SM / SA) ใน SH002 เอง ศูนย์อ่านจาก session (CR-213 FR-1) VC ของ SH001 ออกสิทธิ์ใน SH002 ไม่ได้ (403); VC / SM ของ SH002 อ่าน แก้ ถอน ได้เฉพาะ role / grant ของ SH002; ปิดโปรไฟล์ SH002 ถอนเฉพาะ SH002; หน้า "บัญชีจิตอาสา" ไม่แสดง role ของศูนย์อื่น
- **FR-26 SM ออกสิทธิ์จากการ์ด:** เลิกเงื่อนไข "บัญชีเดิมต้องมี scope 1 ศูนย์ + 1 capability" ตรวจเฉพาะ role ในศูนย์ของ SM (FR-4)
- **FR-27 1 บัญชีต่อคน:** สร้างบัญชีจิตอาสาใหม่ถูกปฏิเสธเมื่อมีบัญชีจิตอาสาเดิมที่ตรงตาม FR-24 (ให้ผูกแทน)

### schema.md §6 `_users` — เพิ่ม field (Part B)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `volunteer_profiles` | [{`shelter_code`:str, `volunteer_id`:str}] | opt | โปรไฟล์จิตอาสาที่บัญชีผูก 1 รายการต่อศูนย์ — ใช้หาบัญชีจิตอาสาของศูนย์ ไม่ให้สิทธิ์ข้อมูล แก้ได้เฉพาะ admin (`_design/tent_guard`) ไม่ถูกถอดโดย sweep; `volunteer_id` เดิม = รายการแรก |

## Acceptance

**Part A**
- [ ] VC เห็น radio 10 role; `POST` ด้วย `kiosk_staff` / `volunteer_coordinator` ได้ 403
- [ ] ผู้ที่ได้ `warehouse_staff` จาก VC เข้าเมนูและหน้าคลังได้เหมือนคนที่ SM ให้
- [ ] เมนู "บัญชีจิตอาสา" เห็นเฉพาะ SA / SM / VC; หน้าแสดงเฉพาะบัญชีที่ผูก 2 ทาง รวมบัญชีที่ไม่มี role เหลือ ไม่แสดงบัญชีเจ้าหน้าที่ทั่วไป
- [ ] ปุ่มบนการ์ดและในหน้าบัญชีตรงสถานะ FR-9
- [ ] "แก้ไขสิทธิ์": username อ่านอย่างเดียว ไม่มีรหัสผ่าน radio เลือก role ปัจจุบัน วันหมดว่างพร้อม "เดิม: …" บันทึกไม่ได้ถ้าไม่เลือกวัน
- [ ] VC เปลี่ยน role ครัว → คลัง: บัญชีมี `shelter:SH001` + `SH001:warehouse_staff` เท่านั้น audit `revoked` + `issued`
- [ ] VC คนที่ 2 ถอนและแก้ grant ที่ VC คนแรกออกได้ audit บันทึกทั้งผู้ทำและผู้ออกเดิม; แตะ role ถาวรของ SM ได้ 403
- [ ] ปิดโปรไฟล์: ภายในรอบ sweep บัญชีไม่มี role ในศูนย์; เปิดโปรไฟล์แล้ว VC "ออกสิทธิ์อีกครั้ง" ด้วย role ใหม่ login รหัสผ่านเดิมได้ ไม่ใช้ SM/SA
- [ ] ออกสิทธิ์ให้โปรไฟล์ที่ปิดได้ 422
- [ ] SM เปลี่ยน `active` ของบัญชีจิตอาสาได้ 403; SA ทำได้; การ์ดแสดง "บัญชีถูกระงับโดยผู้ดูแลระบบ"

- [ ] ช่องวันหมดอายุเป็น date-picker เลือกนอกช่วงวันนี้ถึง +7 ไม่ได้
- [ ] หน้ากะ: แถว "รอยืนยันตัวตน" กดยืนยันตัวตนแล้วเช็คอินต่อได้ทันที; ปุ่มสิทธิ์ในแถวเปิด dialog เดียวกับการ์ด

**Part C**
- [ ] portal: ยังไม่ได้รับสิทธิ์ขึ้น "ยังไม่ได้รับสิทธิ์ใช้งานระบบ"; ได้รับแล้วขึ้น role + วันหมด + ปุ่มเข้าสู่ระบบ; response ไม่มี username / อีเมล

**Part B**
- [ ] นาย ก. มี role ครัว @SH001; VC SH002 ออก "คลัง" ให้โปรไฟล์ SH002 ที่เบอร์และเลขบัตรตรง → บัญชีเดียวมี `SH001:kitchen_staff` + `SH002:warehouse_staff` เลือกศูนย์แล้วเมนูเปลี่ยนตาม
- [ ] นาย ก. ไม่เหลือ role ในศูนย์ใด VC SH002 ผูกและออกสิทธิ์ได้โดยไม่ใช้ SM
- [ ] เลขบัตรไม่ตรง: ไม่ผูก ไม่สร้างบัญชีซ้ำ
- [ ] บัญชีที่เป็น VC @SH001: VC SH002 ออกสิทธิ์ไม่ได้ (403); SM SH002 ผูกและออก role ของ SH002 ได้ role @SH001 ไม่เปลี่ยน
- [ ] ถอน / หมดอายุ / ปิดโปรไฟล์ที่ SH001 ไม่กระทบ SH002
- [ ] ผู้ใช้แก้ `volunteer_profiles` ของตัวเองได้ 403 `forbidden`
- [ ] backfill: บัญชีจิตอาสาเดิมมี `volunteer_profiles` 1 รายการตาม `volunteer_id`

## Impact

- **ความเสี่ยงสิทธิ์:** VC ให้ role ที่เห็นข้อมูลอ่อนไหว (`medical_staff`, `triage_staff`) และแก้สต็อกได้ (`supply_coordinator`, `warehouse_staff`) — คุมด้วยวันหมด ≤ 7 วัน, ยืนยันตัวตน, audit ทุกครั้ง และ SA ระงับบัญชีได้ (FR-22)
- **VC จัดการ grant ของ VC คนอื่นได้ (FR-16):** ลดความปลอดภัยเชิงการแบ่งหน้าที่ระหว่าง VC แลกกับการส่งต่องานข้ามกะ ตรวจย้อนได้จาก audit
- **ข้อมูลข้ามศูนย์ (FR-24):** VC SH002 เห็น username ของบัญชีเดิม (เป็นอีเมลของจิตอาสาเอง) ไม่เห็น role หรือข้อมูลของ SH001
- **deploy:** Part A: restart worker · Part C: ไม่มี · Part B: `pnpm sync:central` → restart worker → backfill
- **ลำดับ:** merge #984 และ #1020 ก่อน Part A

## Migration

- ไม่ bump `schema_v`
- Part A: ไม่มีข้อมูลต้องแปลง; grant หลายตัวต่อศูนย์รวมเป็นตัวเดียวเมื่อบันทึกครั้งถัดไป (FR-17); โปรไฟล์ที่ปิดอยู่ก่อน deploy ถูกถอนใน sweep รอบแรก (FR-19)
- Part B: script backfill (dry-run ได้) ตั้ง `volunteer_profiles = [{ shelter_code, volunteer_id }]` ให้ทุก `_users` ที่ `personnel_type: volunteer` และมี `volunteer_id` (หาศูนย์จากโปรไฟล์ใน `shelter_{code}` ตาม `registry`; ไม่เจอให้ log และข้าม)

## Decision log

- 2026-10-30 — proposed จากการทดสอบ CR-213 บน develop
- 2026-10-30 — owner (@mhapong):
  - แก้ role ต้องเลือกวันหมดอายุใหม่ แสดงวันเดิม; ปุ่มบนการ์ดเปลี่ยนตามสถานะ
  - VC ต้องพาจิตอาสากลับมาได้เอง ไม่ผ่าน SM/SA ทั้งศูนย์เดิมและศูนย์ใหม่
  - VC ถอน / แก้ grant ที่ VC คนไหนก็ได้ออกในศูนย์ตัวเอง; role ถาวรของ SM ไม่แตะ
  - จิตอาสา 1 คน = 1 บัญชี อยู่ได้หลายศูนย์ 1 role ต่อศูนย์; เจ้าหน้าที่อยู่ได้หลายศูนย์และมีหลาย role ได้ (ไม่เปลี่ยน)
  - ปิดทั้งบัญชีจิตอาสาได้เฉพาะ SA; ปิดโปรไฟล์ถอนสิทธิ์ผ่าน worker ≤ 5 นาทียอมรับได้
  - หน้า "บัญชีจิตอาสา" เป็นเมนูแยกใน sidebar
  - คนที่เป็น VC (หรือ SM) ที่ศูนย์หนึ่งแล้วไปช่วยอีกศูนย์: SM ของศูนย์นั้นจัดการเอง ไม่ใช่ SA
  - จากการทดสอบจริง: ช่องวันหมดใช้ date-picker, ยืนยันตัวตนและออกสิทธิ์จากหน้ากะ, portal แสดงสถานะสิทธิ์ (ไม่แสดงชื่อบัญชี)
- 2026-10-30 — ตัดทาง "คง `shelter:SHxxx` หลังถอนสิทธิ์" (เป็นสมาชิก `_security` ของ `shelter_{code}` คนที่ถูกถอนจะยังอ่านข้อมูลได้) และตัด field `volunteer_shelter_code` (หน้าบัญชีจิตอาสาหาบัญชีจากการผูกโปรไฟล์แทน; Part B ใช้ `volunteer_profiles`)
- 2026-10-30 — ยกเว้น `volunteer_coordinator` (กันตั้งต่อเป็นทอด), `kiosk_staff`, `shelter_manager` ตามคำขอ
