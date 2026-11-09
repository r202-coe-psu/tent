---
id: CR-221 # renumbered from draft-coordinator-grant-edit-and-roles
title: ผู้ประสานงานจิตอาสาจัดการบัญชีจิตอาสาได้ครบวงจร — 10 ตำแหน่ง, แก้สิทธิ์, หน้าบัญชีจิตอาสา, พากลับมา, สถานะใน portal และ 1 บัญชีใช้ได้หลายศูนย์
status: approved
date: 2026-10-30
updated: 2026-11-08 # A1-7 / A1-8 implemented (PR #1199)
requested_by: "@mhapong จากการทดสอบ CR-213 บน develop (2026-10-30) — #1044, #1045"
decided_by: Soravit Sukkarn (Team Lead)
decision_date: 2026-11-01
layer: stable
amends: CR-213 (FR-2, FR-3, FR-5, FR-7, FR-8, FR-10, FR-11, FR-12)
affects:
  - docs/changes/06-A-volunteer/CR-213-coordinator-limited-access-grant.md (ใส่หมายเหตุ "แก้โดย CR-221" ที่ FR-2, FR-3, FR-5, FR-7, FR-8, FR-10, FR-11, FR-12)
  - docs/data/schema.md §6 `_users` (เพิ่ม `volunteer_profiles`; `_design/tent_guard` ป้องกัน field นี้) — Part B
  - docs/data/api-contract.md (`GET /api/v1/volunteer-access/accounts` ใหม่, `POST` / `DELETE /api/v1/volunteer-access`, `PUT /api/v1/users` field `active`)
  - docs/prd/role-permission-matrix.md (แถว User Management / VC)
  - docs/prd/sitemap หรือเอกสารเมนู back-office (เมนู "บัญชีจิตอาสา")
  - ไม่ bump `schema_v` (`_users` ไม่มี common envelope; โปรไฟล์ `volunteer` ไม่เปลี่ยนรูป)
  - frontend/src/lib/auth/roles.ts (`COORDINATOR_GRANTABLE_CAPABILITIES`), frontend/src/lib/auth/role-grants.ts
  - frontend/src/lib/server/user-service.ts (`grantCoordinatorRole`, `revokeCoordinatorGrant`, `updateUser` field `active`)
  - frontend/src/lib/features/volunteers (server/volunteer-access-grant.ts, application/volunteer-access.ts, ui/volunteer-access-dialog.svelte, ui/volunteer-card.svelte, หน้าใหม่ volunteer-accounts)
  - frontend/src/lib/features/users (ui/user-form.svelte: ซ่อน / ปิดสวิตช์ `active` สำหรับ SM เมื่อบัญชีเป็นจิตอาสา — FR-23; ฟอร์มนี้เป็น checkbox หลาย role อยู่แล้ว ไม่ต้องแก้ตาม Amendment A1)
  - **Amendment A1:** frontend/src/lib/features/volunteers/ui/volunteer-card.svelte (A1-6 ปุ่มปิดโปรไฟล์ของ VC), frontend/src/lib/server/user-service.ts (`grantCoordinatorRole`: ออก grant ข้าง role ถาวรของ SM ได้; `updateUser` / `createOrMergeUser`: audit `role_grant.permanent_issued` — A1-8), frontend/src/lib/features/volunteers/ui/volunteer-access-dialog.svelte (FR-16 ใหม่, แถว FR-9 บัญชีที่มีแค่ role ถาวร), frontend/src/lib/features/volunteers/application/volunteer-access.ts (A1-4: ตัดเงื่อนไข `existing.roles.length !== 2` ของเส้นทางการ์ดของ SM), frontend/src/routes/api/v1/users/+server.ts (A1-7: `PUT` เรียก `assertVolunteerVerifiedForAccess` เมื่อเพิ่ม role), frontend/src/lib/server/user-service.role-grants.test.ts, volunteer-access-dialog.dom.test.ts, volunteer-access.test.ts
  - **Amendment A1 (เอกสาร):** docs/data/api-contract.md §2.6 (แถว error `403 FORBIDDEN` ของ `POST /api/v1/volunteer-access`: role ซ้ำกับ role ถาวรของ SM; `PUT /api/v1/users` ตรวจการยืนยันตัวตนเมื่อเพิ่ม role — A1-7), docs/data/schema.md §2.12 `audit` (reason ใหม่ `role_grant.permanent_issued` — A1-8; ไม่ bump `schema_v`), docs/changes/06-A-volunteer/CR-213-coordinator-limited-access-grant.md (ใส่หมายเหตุ "แก้โดย CR-221 Amendment A1" ที่ FR-7, FR-10, AC-3, AC-6 และ TL;DR; FR-5 เป็นฐานของ 403 ใน A1-2 ไม่เปลี่ยนข้อความ), docs/prd/role-permission-matrix.md (แถว VC §1 และ User Management), docs/changes/_index.md (แถว CR-213, CR-221)
  - frontend/src/routes/api/v1/volunteer-access/** (เพิ่ม `accounts`), frontend/src/routes/api/public/v1/volunteer/access-status/ (Part C), frontend/src/lib/features/volunteer-portal (Part C)
  - frontend/src/lib/features/volunteers/ui/roster-row.svelte (FR-24, FR-25), ui/job-applicants-tab.svelte + ui/job-applicant-row.svelte (FR-25), ui/volunteer-account-badge.svelte + ui/volunteer-access-actions.svelte (ป้ายและปุ่มที่ใช้ร่วมกัน), frontend/src/routes/(protected)/back-office/volunteers/accounts/
  - frontend/src/lib/components/backoffice-navbar/static.ts (เมนูใหม่ ใช้ `canAccessVolunteerBackoffice` ตาม #1020)
  - frontend/src/lib/server/users-guard-design.ts (Part B) → `pnpm sync:central`
  - frontend/scripts (Part B: backfill `volunteer_profiles`)
  - worker/src/worker/role_grants.py (ถอน grant ของโปรไฟล์ `status: inactive`)
  - ขึ้นกับ #984 (ปุ่ม "เปิดใช้งานอีกครั้ง" ของโปรไฟล์) และ #1020 (sidebar ตาม guard)
  - tests: role-grants, volunteer-access-grant, user-service, users-guard-design, volunteer-access-dialog / volunteer-card dom, หน้า accounts, worker test_role_grants, frontend/e2e/volunteer-access-roles.test.ts
---

# CR-221 — ผู้ประสานงานจิตอาสาจัดการบัญชีจิตอาสาได้ครบวงจร

> **สรุป (TL;DR):**
>
> - **ยืนยันตัวตนก่อน:** ผู้ออกสิทธิ์ทุกคน (SA / SM / VC) ออกสิทธิ์ได้เฉพาะจิตอาสาที่ยืนยันตัวตน**ในศูนย์นี้**แล้ว ผลยืนยันจากศูนย์อื่นใช้แทนไม่ได้
> - **role + แก้สิทธิ์:** `volunteer_coordinator` (VC) ออกได้ 10 role (ทุกตำแหน่งยกเว้น ผู้ประสานงานจิตอาสา, ดูแลตู้ Kiosk, ผู้จัดการศูนย์) จิตอาสามี role ที่ VC ออกได้ 1 role ต่อศูนย์ (SM ให้ role ถาวรได้หลาย role — Amendment A1) VC แก้ role / วันหมดอายุ และถอนสิทธิ์ที่ VC คนไหนก็ได้ออกในศูนย์ตัวเอง
> - **หน้า + ปุ่ม:** เมนูใหม่ "บัญชีจิตอาสา" แสดงบัญชีจิตอาสาของศูนย์ (รวมบัญชีที่สิทธิ์สิ้นสุดแล้ว); แท็บรายชื่อและแท็บผู้สมัครของงานแสดงตำแหน่งปัจจุบันของบัญชี + ปุ่มตามสถานะ (ออกสิทธิ์ / แก้ไขสิทธิ์ / ออกสิทธิ์อีกครั้ง)
> - **วงจรชีวิต:** ปิดโปรไฟล์ = ถอนสิทธิ์ที่ผู้ประสานงานออกในศูนย์นั้น (role ถาวรของ SM คงอยู่; worker ≤ 5 นาที); VC พาคนกลับมาได้เองโดยไม่ผ่าน SM/SA; ปิดทั้งบัญชีจิตอาสาได้เฉพาะ SA
> - **หลายศูนย์ (Part B):** จิตอาสา 1 คน = 1 บัญชี ใช้ได้หลายศูนย์ role ต่างกันต่อศูนย์ VC ของศูนย์ใหม่ผูกบัญชีเดิมได้เองเมื่อเบอร์มือถือและเลขบัตรตรงกัน
> - **portal (Part C):** จิตอาสาเห็นใน portal ว่าได้รับสิทธิ์แล้วหรือยัง (role + วันหมด ไม่แสดงชื่อบัญชี)
> - **layer: stable** (auth / `_users` / worker) ต้อง review ก่อน approve · โค้ด 3 PR: Part A → Part C → Part B

---

## Amendment A1 (2026-11-02, revised 2026-11-03 และ 2026-11-04) · **approved 2026-11-04 (Soravit Sukkarn (Team Lead), review PR #1123)**

> **สรุป (BLUF):**
>
> - SM ให้บัญชีจิตอาสามี role ถาวรได้**หลาย role ต่อศูนย์** จากหน้าผู้ใช้งาน (การ์ดจิตอาสาของ SM ใช้ออก 1 role ให้บัญชีที่ยังไม่มี role ในศูนย์นี้เท่านั้น — A1-4); VC ออก grant แบบมีวันหมดได้ **1 role ต่อศูนย์** ข้าง role ถาวรของ SM โดยไม่แตะ role ของ SM (รวมบัญชีที่มีแค่ role ถาวร)
> - VC ปิดโปรไฟล์ของจิตอาสาที่มี role ถาวรจาก SM ไม่ได้ (SM / SA ปิดได้)
> - role ถาวรที่ SM / SA เพิ่มให้บัญชีจิตอาสาต้องผ่านการยืนยันตัวตนในศูนย์นั้นทั้ง `POST` และ `PUT /api/v1/users` และเขียน audit `role_grant.permanent_issued` (A1-7, A1-8 — implement ใน PR #1199)
> - แก้ FR-3 (ฝั่ง SM / SA), FR-4, FR-8, FR-9, FR-16, FR-20, FR-23, FR-28, FR-32 และ CR-213 FR-7, FR-10 · ไม่เปลี่ยนรูป doc / `schema_v` · เพิ่ม audit reason 1 ค่าใน schema.md §2.12

- **A1-1 (แก้ FR-4):** บัญชี `personnel_type: volunteer` ในศูนย์หนึ่งมี role ถาวรจาก SM ได้ 0..n role และ grant จาก VC ได้ 0..1 grant · การแทนที่ grant ของ VC (FR-18) ยังเป็นแบบเดิม (เปลี่ยน role = แทนที่ grant เดิมของศูนย์นี้) และไม่แตะ role ถาวร
- **A1-2 (แก้ FR-16, FR-9; แก้ CR-213 FR-7):** บัญชีที่มี role ถาวรจาก SM ในศูนย์นี้: VC เห็น role ถาวรในรายการ (radio ของ role นั้น disabled + "ผู้จัดการศูนย์เป็นผู้ให้ แก้ไขได้ที่หน้าผู้ใช้งาน") และ**ออก / แก้ / ถอน grant ของ VC ได้ตามปกติ**
  - `POST /api/v1/volunteer-access` ด้วย role ที่บัญชีมีอยู่แล้วเป็น role ถาวร → `403 FORBIDDEN` "ตำแหน่งนี้ผู้จัดการศูนย์ให้ไว้แล้ว" ไม่เขียนอะไร · ใช้ 403 ตาม [CR-213 FR-5](CR-213-coordinator-limited-access-grant.md) และ `api-contract.md` §2.6: เป็นสิ่งที่ผู้เรียกทำไม่ได้เลย ไม่ใช่ข้อมูลที่แก้แล้วลองใหม่ได้ · แทนข้อ "ถ้าบัญชีมี role นั้นจาก SM อยู่แล้ว (ไม่มี grant) ไม่เปลี่ยนอะไร" ของ CR-213 FR-7
  - `DELETE` role ถาวรยัง 403 (FR-17)
  - **grant สิ้นสุด = ถอนเฉพาะ role ของ grant:** grant ของ VC หมดอายุ (worker sweep), ถูกถอน, ถูกแทนที่ด้วย role อื่น หรือถูกถอนเพราะปิดโปรไฟล์ / ผลยืนยันตัวตนถูกยกเลิก → ถอดเฉพาะ `SHxxx:<role ของ grant>` และ grant นั้น · role ถาวรจาก SM และ `shelter:SHxxx` คงอยู่ บัญชียังใช้งานในศูนย์ด้วย role ถาวรได้ต่อ
  - เหตุที่ห้ามออก grant ซ้ำกับ role ถาวร: compound role เป็นค่าเดียวกัน (`SHxxx:<role>`) ถ้าปล่อยให้มี grant ทับ เมื่อ grant หมดอายุ role ถาวรจะหลุดไปด้วย
  - กลับกัน: SM ให้ role ถาวรที่บัญชีมีเป็น grant ของ VC อยู่แล้ว → ตอนบันทึกฟอร์มผู้ใช้ `pruneRoleGrants` (`frontend/src/lib/auth/role-grants.ts`, เรียกจาก `updateUser`) ตัดรายการ grant ของ role นั้นทิ้ง เหลือ role ถาวร (ไม่มีวันหมดแล้ว) ไม่ต้องถอน grant ก่อน
  - **บัญชีที่มีแค่ role ถาวรจาก SM ในศูนย์นี้ (ไม่มี grant ของ VC):** สถานะ `active` (FR-6) · แถวใหม่ในตาราง FR-9 · พฤติกรรมของ VC:
    - การ์ด / แถว: ป้าย "<ตำแหน่ง> · ถาวร" ต่อ role ถาวร + ปุ่ม "แก้ไขสิทธิ์ใช้งาน" (`volunteer-access-actions.svelte`) เปิด dialog หัวข้อ "แก้ไขสิทธิ์"
    - dialog: username อ่านอย่างเดียว (FR-10) · radio ของ role ถาวร disabled + "ผู้จัดการศูนย์เป็นผู้ให้ แก้ไขได้ที่หน้าผู้ใช้งาน" · role อื่นที่ VC ออกได้ (FR-1) เลือกได้ ไม่มี role ที่เลือกไว้ล่วงหน้า · ช่องวันหมดว่าง required ไม่มีบรรทัด "เดิม: …" (ไม่มี grant เดิม) · ไม่มีปุ่ม "ถอนสิทธิ์" (ไม่มี grant ให้ถอน)
    - ปุ่ม "บันทึกการแก้ไข" กดได้เมื่อเลือก role และวันหมดแล้ว → `POST /api/v1/volunteer-access` เพิ่ม `SHxxx:<role ที่เลือก>` + grant ใหม่ audit `role_grant.issued` · role ถาวรไม่เปลี่ยน
    - ยังไม่ยืนยันตัวตนในศูนย์นี้: grant ข้าง role ถาวรเป็นการออกสิทธิ์ใหม่ ไม่ใช่การแก้ grant เดิม (FR-3) → ปุ่มบันทึก disabled พร้อมเหตุผล "อาสาสมัครยังไม่ยืนยันตัวตนในศูนย์นี้ กรุณายืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้" · server ตอบ `422`
    - VC ปิดบัญชี (FR-23) หรือปิดโปรไฟล์ (A1-6) ไม่ได้ และถอน role ถาวรไม่ได้ (`DELETE` → 403 ตาม FR-17)
    - grant ที่ VC ออกข้าง role ถาวรสิ้นสุดแล้ว → ถอดเฉพาะ role ของ grant (ข้อ "grant สิ้นสุด" ด้านบน) บัญชีกลับเป็นบัญชีที่มีแค่ role ถาวร
    - **โค้ดปัจจุบันต้องแก้:** `volunteer-access-dialog.svelte` ตั้ง `blockedReason` = ข้อความ role ถาวรเมื่อบัญชีมี role ถาวร (`holdsManagerRole`) ทำให้บันทึกไม่ได้ทั้ง dialog และไม่บล็อกกรณียังไม่ยืนยันตัวตนเมื่อสถานะเป็น `active` → เปลี่ยนเป็นบล็อกเฉพาะเมื่อ role ที่เลือกเป็น role ถาวร และบล็อกเมื่อยังไม่ยืนยันตัวตนในศูนย์นี้และบัญชีไม่มี grant ในศูนย์นี้
- **A1-3 (แก้ FR-23):** ตัดข้อ "ตำแหน่งหน้าที่ของศูนย์เลือกได้ 1 role (FR-4)" ในหน้าแก้ไขผู้ใช้ของ SM ออกจาก spec · `user-form.svelte` เป็น checkbox หลาย role อยู่แล้ว ไม่มีโค้ดต้องแก้ · ข้อซ่อนสวิตช์ `active` คงเดิม
- **A1-4 (แก้ FR-32, Part A + Part B):** SM / SA เพิ่ม role ให้บัญชีจิตอาสาที่**มี role ในศูนย์นี้อยู่แล้ว**ที่หน้าผู้ใช้งานเท่านั้น (A1-3) · การ์ด / แถวของบัญชี `active` สำหรับ SM / SA ยังเป็นปุ่ม "จัดการบัญชีผู้ใช้" → หน้าผู้ใช้งาน ตาม FR-9 ไม่เปลี่ยน
  - เส้นทางออกสิทธิ์จากการ์ดของ SM / SA (`grantVolunteerAccess` ใน `frontend/src/lib/features/volunteers/application/volunteer-access.ts` เรียกจาก `volunteer-access-dialog.svelte`) ใช้กับบัญชีที่**ยังไม่มี role ในศูนย์นี้**เท่านั้น และออก 1 role ต่อครั้งเหมือนเดิม
  - บัญชีจิตอาสาเดิมของโปรไฟล์นี้ (`volunteer_id` ตรง, `personnel_type: volunteer`, `active: true`) ที่มี role ในศูนย์อื่น: เพิ่ม `shelter:SHxxx` + `SHxxx:<role>` โดยคง role เดิมทุกตัวของบัญชี (ทุกศูนย์) ไม่เปลี่ยนรหัสผ่าน · ผ่าน `/api/v1/users` จึงอยู่ใต้ A1-7 และ A1-8
  - โค้ดปัจจุบันรับบัญชีเดิมเฉพาะเมื่อ `existing.roles.length === 2` (scope 1 + capability 1 และต้องเป็น role ที่เลือก) จึงปฏิเสธบัญชีที่มี role ในศูนย์อื่น → ตัดเงื่อนไขนี้
  - เงื่อนไขอื่นของบัญชีเดิมคงเดิม (บัญชีเจ้าหน้าที่ / ผูกโปรไฟล์อื่น / ปิดใช้งาน → ข้อความเดิม "จัดการผ่านหน้าผู้ใช้งาน")
  - Part B (FR-32): ตรวจเฉพาะ role ในศูนย์ของ SM ไม่ตรวจจำนวน role
- **A1-5 (แก้ FR-8, FR-9, FR-28 — การแสดงผล):** หน้าบัญชีจิตอาสา (FR-8) และป้ายในตาราง (FR-9) แสดงทุก role (ถาวร + grant) · portal (FR-26, FR-28) ยังคืน `role_label` ตัวเดียว ไม่เปลี่ยน response · เลือกตัวที่แสดงตามลำดับนี้ (แก้ FR-28):
  - มี role ถาวรจาก SM: แสดง role ถาวรที่ **role code เรียงตามตัวอักษรแล้วอยู่ก่อนสุด** (เช่น `kitchen_staff` มาก่อน `registration_staff`) · ไม่แสดงวันหมด
  - ไม่มี role ถาวร: แสดง role ของ grant (พร้อมวันหมด)
  - มี role ถาวรและ grant พร้อมกัน: แสดงเฉพาะ role ถาวร ไม่แสดง grant
- **A1-6 (แก้ FR-20):** โปรไฟล์ที่บัญชีมี role ถาวรจาก SM ในศูนย์นี้ **VC ปิดโปรไฟล์ไม่ได้** — ปุ่มปิดใช้งานของ VC ถูก disabled พร้อมเหตุผล "จิตอาสามีสิทธิ์ถาวรจากผู้จัดการศูนย์ ให้ผู้จัดการศูนย์ปิดหรือถอนสิทธิ์ก่อน" · SM / SA ปิดได้ตามเดิม (dialog ยังเตือนเรื่อง role ถาวร) · โปรไฟล์ที่มีเฉพาะ grant ของ VC: VC ปิดได้ตามเดิม (worker ถอน grant)
  - กติกานี้ตรวจที่ UI เท่านั้น: การปิดโปรไฟล์เขียน `shelter_{code}` ตรงด้วย session ของผู้ใช้ และ VDU ของ shelter DB อ่าน `_users` ไม่ได้ จึงตรวจที่ server ไม่ได้ — เป็นข้อจำกัดเชิงสถาปัตยกรรมที่ยอมรับ (design trade-off) ผู้ที่ไม่ใช้ UI ปิดโปรไฟล์ได้ แต่ผลคือสถานะที่ SM / SA แก้ได้ (ดู Why A1)
- **A1-7 (แก้ FR-3 ฝั่ง SM / SA — implement ใน PR #1199):** `PUT /api/v1/users` ที่เพิ่ม `SHxxx:<role>` ใหม่ (ไม่มีใน `roles` เดิมของบัญชี) ให้บัญชี `personnel_type: volunteer` ที่มี `volunteer_id` → server ตรวจด้วย `assertVolunteerVerifiedForAccess(<ศูนย์ของ role ใหม่>, volunteer_id)` แบบเดียวกับ `POST` (`frontend/src/routes/api/v1/users/+server.ts`) · ไม่ผ่าน → `422 VALIDATION` "อาสาสมัครต้องยืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้" ไม่เขียนอะไร
  - ไม่ตรวจเมื่อ `PUT` ไม่ได้เพิ่ม role: คง role เดิม, ถอน role, แก้ field อื่น, เปลี่ยน grant เป็นถาวร (`permanent_roles` — role นั้นมีอยู่แล้ว)
  - บัญชี `personnel_type: staff` ไม่ตรวจ (เหมือนเดิม)
  - Part B: โปรไฟล์ที่ตรวจคือโปรไฟล์ของศูนย์นั้นใน `volunteer_profiles` (ไม่มี: ใช้ `volunteer_id`)
  - ก่อน PR #1199: `PUT` ไม่เรียก `assertVolunteerVerifiedForAccess` (เรียกเฉพาะ `POST`) — SM เพิ่ม role ให้บัญชีจิตอาสาที่ยังไม่ยืนยันตัวตนจากหน้าผู้ใช้งานได้
  - **การตีความตอน implement (owner เคาะ 2026-11-06 ตาม review PR #1199):**
    - ตรวจกับโปรไฟล์ที่บัญชีผูกอยู่ก่อนบันทึกด้วย การล้างหรือเปลี่ยน `volunteer_id` ในการบันทึกเดียวกันจึงข้ามการตรวจไม่ได้
    - SM เปลี่ยน `personnel_type` ระหว่าง volunteer ↔ staff ได้ แต่ role ที่เพิ่มในการบันทึกเดียวกันต้องผ่านการตรวจและมี audit · บัญชีที่เปลี่ยนเป็น volunteer นับ role ที่คงไว้ทุกตัวเป็น role ที่ออกใหม่
    - `POST /api/v1/users` ที่ชื่อบัญชีซ้ำ (merge) ตรวจกับโปรไฟล์ของบัญชีที่ถูก merge · ถ้าคำขอระบุ `volunteer_id` หรือ `personnel_type: volunteer` บัญชีนั้นต้องเป็นบัญชีจิตอาสา `active` ของโปรไฟล์เดียวกัน ไม่เช่นนั้น `403`
    - POST merge ถือเป็นการให้ role ถาวร: grant ของ VC ที่ role เดียวกันในศูนย์นั้นเปลี่ยนเป็นถาวร (audit `role_grant.made_permanent`)
- **A1-8 (audit role ถาวรของจิตอาสา — implement ใน PR #1199):** SM / SA เพิ่ม role ถาวรใหม่ให้บัญชี `personnel_type: volunteer` ผ่าน `POST` หรือ `PUT /api/v1/users` (รวมเส้นทางการ์ดของ A1-4) → เขียน `audit` 1 ฉบับต่อ role ลง `shelter_{code}` ของศูนย์ของ role นั้น:
  - `action: other`, `reason: role_grant.permanent_issued`, `target_type: user`, `target_id: org.couchdb.user:{name}`, `context: { role, expires_at: null, actor }` (`actor` = SM / SA ผู้บันทึก)
  - grant ของ VC ที่ SM เปลี่ยนเป็นถาวร (`permanent_roles` หรือ `pruneRoleGrants`): เขียน `role_grant.made_permanent` ตาม CR-213 FR-14 อย่างเดียว ไม่เขียน `role_grant.permanent_issued` ซ้ำ
  - ชื่อ reason ตามแบบ `role_grant.*` เดิมใน schema.md §2.12 (`issued` = grant ของ VC ออกใหม่ → `permanent_issued` = role ถาวรออกใหม่) · เพิ่มในรายการของ §2.12 แล้ว (ไม่ bump `schema_v`)
  - ไม่อยู่ใน A1: audit ตอน SM ถอด role ถาวร
  - ก่อน PR #1199: `auditDroppedGrants` (`user-service.ts`) บันทึกเฉพาะ grant ที่ถูกตัดทิ้งหรือเปลี่ยนเป็นถาวร ไม่มี audit เมื่อ SM เพิ่ม role ถาวร
  - `context` คงตามข้อนี้ ไม่เพิ่ม `verified_by` (owner เคาะ 2026-11-06)
  - ความปลอดภัยของ audit (W1 / retry-safe): บันทึก audit ให้สำเร็จก่อนเขียน role ลง `_users` (หรือ rollback หากสร้างใหม่แล้ว audit ล้มเหลว) หาก audit ล้มเหลวจะตอบ 500 `INTERNAL` เพื่อป้องกันการได้ role ถาวรโดยไม่มี audit และทำให้การ retry ของผู้ใช้ปลอดภัย ไม่กลืนความล้มเหลวเงียบๆ

**Why (A1):**

- **ต้องการ:** ผู้เสนอ (@mhapong, ผู้รับงาน #1044) 2026-11-02 — SM ต้องให้จิตอาสาทำหลายหน้าที่ในศูนย์ได้เหมือนเจ้าหน้าที่ประจำ ส่วนสิทธิ์ชั่วคราวของ VC คุม 1 role ต่อศูนย์ไว้เพื่อให้แก้ / ถอนง่าย
- **A1-6 ห้าม VC ปิดโปรไฟล์ที่มี role ถาวร:** SM เป็นผู้ให้สิทธิ์ถาวรแก่จิตอาสาคนนี้ SM จึงเป็นเจ้าของสถานะบัญชีของคนนี้ในศูนย์ ถ้า VC ปิดโปรไฟล์ worker จะถอนเฉพาะ grant ของ VC (FR-20) แล้วทิ้ง role ถาวรของ SM ไว้ใช้งานได้บนโปรไฟล์ที่ปิดแล้ว — สถานะขัดกันที่มีแต่ SM แก้ได้ (ถอน role หรือปิดโปรไฟล์เอง) จึงให้ SM / SA เป็นผู้ปิด · การตรวจที่ UI อย่างเดียวเป็นข้อแลกเปลี่ยนที่ยอมรับ เพราะ VDU ของ shelter DB อ่าน `_users` ไม่ได้ ไม่มีทางตรวจ role ถาวรที่ server ได้ และ SM / SA ปิดโปรไฟล์ได้อยู่แล้ว
- **A1-7, A1-8 ยืนยันตัวตนและ audit ของ role ถาวร:** role ถาวรไม่มีวันหมดและอาจเป็น role ที่เห็นข้อมูลอ่อนไหว (`medical_staff`, `triage_staff`) จึงต้องคุมไม่น้อยกว่า grant ของ VC · ตรวจที่ `POST` อย่างเดียวมีช่อง: บัญชีที่สร้างแล้วถูกเพิ่ม role ผ่าน `PUT` ได้โดยไม่ยืนยันตัวตน และไม่มีร่องรอยใน audit ว่าใครให้
- **บัญชีที่มีแค่ role ถาวร (A1-2):** ทางเดียวที่ VC เพิ่มหน้าที่ชั่วคราวให้คนที่ SM ให้ role ไว้แล้วโดยไม่ต้องรอ SM · role ถาวรยังเป็นของ SM ทั้งหมด

**Code impact (A1):**

- #1086 (merge แล้ว) ทำให้ `grantCoordinatorRole` ปฏิเสธ (403) เมื่อบัญชีมี role ถาวรของ SM → แก้เป็น A1-2 (ปฏิเสธเฉพาะ role ที่ซ้ำกับ role ถาวร, ข้อความใหม่)
- `volunteer-access-dialog.svelte` บล็อกการบันทึกทั้ง dialog เมื่อมี role ถาวร → แก้ตาม A1-2 (บัญชีที่มีแค่ role ถาวร)
- `application/volunteer-access.ts` ตัดเงื่อนไข `existing.roles.length !== 2` และเพิ่ม role ของศูนย์นี้ให้บัญชีเดิมที่มี role ในศูนย์อื่น (A1-4)
- `routes/api/v1/users/+server.ts` `PUT` ตรวจยืนยันตัวตน (A1-7) · `user-service.ts` เขียน `role_grant.permanent_issued` (A1-8)
- `user-form.svelte` ไม่ต้องแก้ (เป็น checkbox อยู่แล้ว)

---

## Amendment A2 (2026-11-03, proposed — รอ @Jackyzaz approve)

> A2 แก้เฉพาะ Part C (FR-26, FR-28); FR-27 และส่วนอื่นของ CR ไม่เปลี่ยน

- **ที่มา:** review ของ PR #1116 (#1044, Part C) เจอว่าโค้ดที่ทำแล้วแสดงวันที่สิ้นสุดในแถว `lapsed` และคืน `account_disabled` ให้คนที่รู้แค่เบอร์ ซึ่งไม่ตรงกับ FR-26 / FR-28 เดิม owner ตัดสิน 2026-11-03 ให้แก้ spec ตามนี้

| ข้อ                              | ก่อน (approved 2026-11-01)                                                                 | หลัง (A2)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-26 ข้อความ `lapsed`           | เหมือน "ยังไม่มีบัญชี": "ยังไม่ได้รับสิทธิ์ใช้งานระบบ — ติดต่อผู้ประสานงานจิตอาสาของศูนย์" | แยกจาก `none`: "สิทธิ์ใช้งานระบบสิ้นสุดตั้งแต่วันที่ dd/mm/yyyy — ติดต่อผู้ประสานงานจิตอาสาของศูนย์" ใช้คำว่า "สิ้นสุด" กับทุกเหตุผล (หมดอายุ, ถูกถอน, ยืนยันตัวตนหมดอายุ) ไม่ใช้คำว่า "หมดอายุ"; ไม่ทราบวัน: "สิทธิ์ใช้งานระบบสิ้นสุดแล้ว — ติดต่อผู้ประสานงานจิตอาสาของศูนย์" (EN: "System access ended on <date> — contact the shelter volunteer coordinator" / "System access has ended — contact the shelter volunteer coordinator") |
| FR-26 ข้อความ `account_disabled` | "บัญชีถูกระงับ — ติดต่อผู้ดูแลระบบ"                                                        | **ตัดออก** บัญชีที่ถูกระงับแสดงเหมือน `none`                                                                                                                                                                                                                                                                                                                                                                                              |
| FR-28 `status`                   | `none` / `lapsed` / `active` / `account_disabled`                                          | `none` / `lapsed` / `active` เท่านั้น บัญชีที่ถูกระงับ (`_users.active: false`) ตอบเป็น `none` ไม่มี `role_label` ไม่มี `expires_at`                                                                                                                                                                                                                                                                                                      |
| FR-28 `expires_at`               | วันหมดของ grant (`active`) หรือ `null`                                                     | `active`: วันหมดของ grant (role ถาวร `null`) · `lapsed`: **วันที่สิทธิ์ในศูนย์นี้สิ้นสุด** (วันหมดของ grant ที่ worker ยังไม่ถอน หรือเวลาของ audit การสิ้นสุดล่าสุด) `null` เมื่อไม่ทราบ · `none`: `null`                                                                                                                                                                                                                                 |
| FR-28 grant ที่หมดแล้ว           | ไม่ระบุ                                                                                    | grant ที่ `expires_at` ผ่านแล้วไม่นับเป็นสิทธิ์ แม้ worker ยังไม่ได้ถอน (นับเป็น `lapsed`)                                                                                                                                                                                                                                                                                                                                                |

- **Why:**
  - **owner ตัดสิน (2026-11-03):** จิตอาสาควรรู้ว่าสิทธิ์เคยมีและสิ้นสุดเมื่อไร จึงเก็บวันที่ไว้ แต่ใช้คำที่ถูกกับทุกเหตุผล (เดิมเขียน "หมดอายุ" ทั้งที่อาจถูกถอน)
  - **privacy:** portal เข้าได้ด้วยเบอร์ (เดาได้ — เหมือน `ticket/find`) คนที่รู้แค่เบอร์จึงต้องไม่รู้ว่าบัญชีถูก SA ระงับ ตอบเหมือน "ไม่มีสิทธิ์" ส่วนวันที่สิ้นสุดและ role ที่แสดงมีเท่าที่ FR-28 กำหนด ไม่มี username / อีเมล / ผู้ออก
  - **ไม่เพิ่ม rate limit** ในงานนี้ (owner ตัดสิน)
- **Acceptance (เพิ่ม Part C):**
  - [ ] บัญชีที่สิทธิ์สิ้นสุดแล้ว (หมดอายุ / ถอน / ยืนยันตัวตนหมดอายุ): portal ขึ้น "สิทธิ์ใช้งานระบบสิ้นสุดตั้งแต่วันที่ …" ไม่มีปุ่มเข้าสู่ระบบ
  - [ ] บัญชีที่ถูก SA ระงับ: response และการ์ดเหมือนโปรไฟล์ที่ไม่มีบัญชีทุกอย่าง (`status: none`, ไม่มี role, ไม่มีวันที่)
  - [ ] grant ที่ `expires_at` ผ่านแล้วแต่ worker ยังไม่ถอน: การ์ดขึ้น "สิ้นสุด" ไม่ขึ้นปุ่มเข้าสู่ระบบ
- **Decision log:** 2026-11-03 — owner (@mhapong): เก็บวันที่สิ้นสุดในการ์ด `lapsed` ด้วยคำว่า "สิ้นสุดตั้งแต่วันที่" ทุกเหตุผล; ไม่ส่ง `account_disabled` ใน public endpoint (บัญชีระงับตอบเป็น `none`); ไม่เพิ่ม rate limiter; grant ที่ `expires_at` ผ่านแล้วนับเป็น `lapsed` แม้ worker ยังไม่ถอน (ยืนยันโดย owner หลัง review ของ #1116) · endpoint บันทึกใน `docs/data/api-contract.md` §2.7 — รอ @Jackyzaz approve

---

## Why

- **role ไม่พอ:** CR-213 FR-2 จำกัด VC ไว้ 4 role งานหน้าศูนย์ต้องใช้จิตอาสาในตำแหน่งอื่นด้วย
- **แก้สิทธิ์ที่ออกผิดยาก:** ไม่มีปุ่มแก้ไข (ปุ่มบนการ์ดเขียน "ออกสิทธิ์ใช้งานระบบ" แม้คนนั้นมีสิทธิ์อยู่), เลือก role ใหม่ให้บัญชีเดิมแล้วระบบ**เพิ่ม** role แทนการเปลี่ยน, ช่องอีเมลของบัญชีที่ผูกแล้วพิมพ์ได้ทั้งที่ชื่อบัญชี (`_id` ของ `_users`) เปลี่ยนไม่ได้; CR-213 FR-8 ให้ถอนหรือย่นได้เฉพาะ grant ที่ตัวเองออก VC อีกคนในกะถัดไปแก้ให้ไม่ได้
- **ถอนแล้วบัญชีหายจากศูนย์:** `withoutGrantedRole` และ worker sweep ถอด `shelter:SHxxx` เมื่อไม่เหลือ role; `listUsers` ของ SM กรองด้วย `shelter:SHxxx`; VC ไม่มีหน้าใดแสดงบัญชีจิตอาสา จึงพาคนเดิมกลับมาไม่ได้โดยไม่พึ่ง SM/SA
- **ปิดโปรไฟล์แล้วสิทธิ์ไม่ถูกถอน:** ปุ่มปิดโปรไฟล์ (`status: inactive`) ไม่แตะ `_users` คนที่ถูกปิดยังเข้าระบบได้จนหมดอายุ
- **ปิดทั้งบัญชีกระทบทุกศูนย์:** `_users.active` เป็นระดับบัญชี SM ของศูนย์หนึ่งปิดแล้วจิตอาสาทำงานศูนย์อื่นไม่ได้
- **หลายศูนย์ใช้ไม่ได้:** role แบบ compound รองรับหลายศูนย์แล้ว แต่ `_users.volunteer_id` ผูกได้ 1 โปรไฟล์ และ CR-213 FR-7 ต้องให้ `volunteer_id` ตรง VC ของศูนย์ที่ 2 จึงออกสิทธิ์ให้บัญชีเดิมไม่ได้ ต้องสร้างบัญชีที่ 2

## Change — Part A (PR 1)

### role ที่ VC ออกได้ (แก้ CR-213 FR-2)

- **FR-1:** `COORDINATOR_GRANTABLE_CAPABILITIES` = `STAFF_CAPABILITIES` ลบ `volunteer_coordinator` และ `kiosk_staff` (10 role): `registration_staff`, `triage_staff`, `medical_staff`, `kitchen_staff`, `supply_coordinator`, `warehouse_staff`, `distribution_staff`, `pr_staff`, `facility_staff`, `security_officer`
  - `shelter_manager` ไม่อยู่ใน `STAFF_CAPABILITIES` จึงออกไม่ได้; role นอกรายการได้ 403
- **FR-2:** role ที่ VC ออกใช้สิทธิ์เหมือน role ที่ SM ออกทุกประการ (guard, sidebar, VDU) ต่างกันเฉพาะมีวันหมดอายุ
- **FR-3:** กติกา CR-213 คงเดิม: ศูนย์ตัวเอง (FR-1), วันหมดไม่เกินสิ้นวันที่ +7 (FR-4), audit (FR-15)
  - **ยืนยันตัวตน (แก้ CR-213 FR-3):** ออกสิทธิ์ได้เฉพาะโปรไฟล์ที่ยืนยันตัวตน**ในศูนย์ที่ออกสิทธิ์**แล้ว ใช้กับผู้ออกสิทธิ์ทุกคน (SA / SM / VC) ผลยืนยันของโปรไฟล์ศูนย์อื่น (เบอร์ + เลขบัตรตรงกัน) **ใช้แทนไม่ได้** · `POST /api/v1/volunteer-access` ตอบ 422 "อาสาสมัครต้องยืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้" · `verified_by` ของ grant = โปรไฟล์ในศูนย์นี้
  - การถอน / แก้ grant ที่มีอยู่ไม่ต้องยืนยันซ้ำ
  - SM / SA เพิ่ม role ถาวรให้บัญชีจิตอาสาเดิมผ่าน `PUT /api/v1/users` ต้องยืนยันตัวตนเช่นกัน _(Amendment A1-7)_
- **FR-4 จำนวนตำแหน่งต่อศูนย์ (เฉพาะจิตอาสา):** บัญชี `personnel_type: volunteer` มี role ถาวรจาก SM ได้หลาย role ต่อศูนย์ และมี grant จาก VC ได้ไม่เกิน 1 grant ต่อศูนย์ · อยู่ได้หลายศูนย์ (Part B) ~~เดิม: มี role ได้ไม่เกิน 1 role ต่อศูนย์ (ทั้งที่ VC ออกและที่ SM ให้)~~ _(แก้โดย Amendment A1-1)_
  - บัญชีเจ้าหน้าที่ (ไม่ใช่จิตอาสา) ไม่เปลี่ยน: อยู่ได้หลายศูนย์และมีหลาย role ต่อศูนย์ จัดการผ่านหน้าผู้ใช้งานโดย SM/SA ตามเดิม

### หน้า "บัญชีจิตอาสา" และ endpoint

- **FR-5 เมนูและหน้า:** เพิ่มเมนู sidebar "บัญชีจิตอาสา" ใต้ "จัดการอาสาสมัคร" → `/back-office/volunteers/accounts`; guard และ `visibleTo` ใช้ `canAccessVolunteerBackoffice` (SA / SM / VC ของศูนย์ที่เลือก)
- **FR-6 endpoint:** `GET /api/v1/volunteer-access/accounts?shelter_code=` (SA / SM / VC ของศูนย์นั้น อื่น ๆ 403; ศูนย์ตรวจกับ role ใน session ตาม CR-213 FR-1) คืน `{ ok, accounts }` โดย `accounts` เป็นรายการ:
  `{ volunteer_id, name, active, grants: [{ role, expires_at }], permanent_roles: [role] }`
  - `name` = username (อีเมล) ที่ใช้ login; `active` = `_users.active`
  - `grants` = grant ของ VC ในศูนย์นี้ (มีวันหมด); `permanent_roles` = role ในศูนย์นี้ที่ SM ให้ (ไม่มีวันหมด)
  - สถานะที่หน้าจอคำนวณ: `active` (มี grant หรือ role ถาวรในศูนย์นี้) / `lapsed` (บัญชีมี ไม่มี role ในศูนย์นี้) / `account_disabled` (`active: false`)
  - ไม่คืนรหัสผ่าน, MFA, ข้อมูลติดต่อ, role ของศูนย์อื่น หรือบัญชีเจ้าหน้าที่ที่ไม่ใช่จิตอาสา
  - ใช้ 1 request ต่อหน้า โดยแท็บรายชื่อ, แท็บผู้สมัครของงาน และหน้า "บัญชีจิตอาสา" (หน้านี้อาจเพิ่ม field เช่น `granted_by` เมื่อสร้างหน้า)
- **FR-7 บัญชีของศูนย์:** นับเฉพาะบัญชีที่ผูก 2 ทาง: โปรไฟล์ใน `shelter_{code}` มี `user_name` = บัญชี **และ** บัญชีชี้กลับโปรไฟล์นั้น (`volunteer_id`; Part B: `volunteer_profiles`) และ `personnel_type: volunteer` ผูกทางเดียวไม่นับ
- **FR-8 หน้า:** _(แสดงทุก role ถาวร + grant: Amendment A1-5)_ ตาราง ชื่อ · บัญชี · ตำแหน่ง · หมดอายุ ("ถาวร" สำหรับ role ของ SM) · ออกโดย ("ผู้จัดการศูนย์" สำหรับ role ของ SM) · ปุ่มตามสถานะ (FR-9)
  - ค้นหาชื่อ / อีเมล; ตัวกรอง: มีสิทธิ์อยู่ / สิ้นสุดแล้ว / โปรไฟล์ถูกปิด / ใกล้หมดอายุ (≤ 1 วัน)

### ปุ่มบนการ์ดและในหน้าบัญชี

- **FR-9:** ข้อมูลจาก FR-6 (1 request ต่อหน้า) _(แถวบัญชีที่มีแค่ role ถาวร: Amendment A1-2 · ป้ายทุก role: A1-5)_

  | สถานะ                                                                       | ป้ายในตาราง                                                                                                                 | ปุ่ม (VC)                                                                                                                 |
  | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
  | ไม่มีบัญชี                                                                  | "ยังไม่มีบัญชีระบบ"                                                                                                         | "ออกสิทธิ์ใช้งานระบบ"                                                                                                     |
  | `active`                                                                    | "มีบัญชีแล้ว" + ป้ายต่อตำแหน่ง "<ตำแหน่ง> · ถึง dd/mm/yyyy" (grant ของ VC) หรือ "<ตำแหน่ง> · ถาวร" (role ของ SM) + username | "แก้ไขสิทธิ์"                                                                                                             |
  | `lapsed`                                                                    | "มีบัญชี · สิทธิ์ในศูนย์นี้สิ้นสุดแล้ว" + username                                                                          | "ออกสิทธิ์อีกครั้ง"                                                                                                       |
  | โปรไฟล์ `status: inactive`                                                  | ตามสถานะบัญชี                                                                                                               | "เปิดใช้งานอีกครั้ง" (#984) ไม่มีปุ่มออกสิทธิ์                                                                            |
  | `account_disabled`                                                          | "บัญชีถูกปิดใช้งาน"                                                                                                         | ไม่มีปุ่ม; ป้าย "บัญชีถูกระงับโดยผู้ดูแลระบบ"                                                                             |
  | `active` ที่มีแค่ role ถาวรจาก SM ในศูนย์นี้ (ไม่มี grant) — Amendment A1-2 | "มีบัญชีแล้ว" + "<ตำแหน่ง> · ถาวร" ต่อ role + username                                                                      | "แก้ไขสิทธิ์ใช้งาน" → dialog: radio role ถาวร disabled, ออก grant ของ role อื่นได้ ("บันทึกการแก้ไข"), ไม่มีปุ่มถอนสิทธิ์ |
  - ยังไม่ยืนยันตัวตนในศูนย์นี้ (ไม่มีบัญชี / `lapsed`): ปุ่มเป็น "ยืนยันตัวตนก่อนออกสิทธิ์" ดู FR-15
  - SM / SA กับบัญชี `active` / `account_disabled`: ปุ่ม "จัดการบัญชีผู้ใช้" → หน้าผู้ใช้งาน _(Amendment A1-4: SM เพิ่ม role ให้บัญชี `active` ที่หน้านี้ ไม่ใช่จากการ์ด)_
  - บัญชี `lapsed` ไม่มี `shelter:SHxxx` แล้ว หน้าผู้ใช้งานของ SM จึงไม่เห็น: **SA** ได้ปุ่ม "จัดการบัญชีผู้ใช้"; **SM** ไม่มีปุ่ม แสดง "ให้ผู้ประสานงานจิตอาสาออกสิทธิ์อีกครั้ง หรือผู้ดูแลระบบจัดการบัญชี" — การพากลับมาเป็นของ VC (FR-22)

### dialog

- **FR-10 username:** สถานะ `active` / `lapsed` แสดง username เป็นข้อความอ่านอย่างเดียว + "บัญชีนี้มีอยู่แล้ว การออกสิทธิ์ไม่เปลี่ยนรหัสผ่านเดิม" ไม่มีช่องรหัสผ่าน; ไม่มีบัญชี: ช่องอีเมลและรหัสผ่านตามเดิม
- **FR-11 role เป็น radio:** radio group ของ role ที่ผู้เรียกออกได้ เลือก 1; สถานะ `active` เลือก role ปัจจุบันไว้ล่วงหน้า
- **FR-12 วันหมดอายุใช้ component:** ช่องวันหมดอายุใช้ `date-picker` ของ `lib/components/ui` แทน `<input type="date">` จำกัดวันที่เลือกได้ตาม CR-213 FR-4 (วันนี้ ถึง +7, Asia/Bangkok)
- **FR-13 วันหมดอายุ:** ต้องเลือกใหม่ทุกครั้ง ช่องเริ่มว่าง required; สถานะ `active` แสดง "เดิม: หมดอายุสิ้นวันที่ dd/mm/yyyy" ใต้ช่อง และ "ออกโดย …"
- **FR-14 หัวข้อ / ปุ่ม:** "ออกสิทธิ์ใช้งานระบบ" / "แก้ไขสิทธิ์" + "บันทึกการแก้ไข" / "ออกสิทธิ์อีกครั้ง" ตามสถานะ
- **FR-15 ยังไม่ยืนยันตัวตน (FR-3):** ใช้กับผู้ออกสิทธิ์ทุกคน
  - การ์ด / แถว: ปุ่มเป็น "ยืนยันตัวตนก่อนออกสิทธิ์" กดแล้ว toast "ต้องยืนยันตัวตนอาสาสมัครก่อนจึงจะออกสิทธิ์ได้" และเปิด dialog ตรวจตัวตน (ตรวจสอบ & อนุมัติ) ยืนยันแล้วปุ่มกลับเป็น "ออกสิทธิ์ใช้งานระบบ"
  - dialog: ปุ่มบันทึกถูกปิดพร้อมเหตุผล; server ปฏิเสธ (422) แสดง toast
- **FR-16 role ของ SM:** ~~สถานะ `active` ที่ role ในศูนย์นี้เป็น role ถาวรจาก SM: VC เห็น role และ "ผู้จัดการศูนย์เป็นผู้ให้ แก้ไขได้ที่หน้าผู้ใช้งาน" บันทึกไม่ได้~~ **แก้โดย Amendment A1-2:** VC เห็น role ถาวร (radio disabled + ข้อความเดิม) และออก / แก้ / ถอน grant ของ VC ข้าง role นั้นได้

### แก้และถอนสิทธิ์ (แก้ CR-213 FR-7, FR-8)

- **FR-17 VC จัดการ grant ของ VC ทุกคน:** VC ถอน (`DELETE /api/v1/volunteer-access`), ต่ออายุ, ย่นอายุ และเปลี่ยน role ได้กับทุก grant ในศูนย์ตัวเอง ไม่ต้องเป็นผู้ออก; role ถาวรจาก SM (ไม่มี grant) ยังแตะไม่ได้ (403)
  - `mine` ใน CR-213 FR-8 เหลือไว้แสดงผลเท่านั้น ไม่ใช้ตัดสิทธิ์
- **FR-18 เปลี่ยน role:** `POST /api/v1/volunteer-access` แทนที่ grant ของศูนย์นี้ใน `PUT` `_users` ครั้งเดียว: ถอด `SHxxx:<role เดิม>` + grant เดิม เพิ่ม `SHxxx:<role ใหม่>` + grant ใหม่ (`granted_by` = ผู้เรียก) `shelter:SHxxx` คงอยู่ตลอด
  - บัญชีที่มี grant มากกว่า 1 role ในศูนย์นี้ (ออกก่อน CR นี้): แทนที่ทุก grant ของศูนย์นี้ด้วย role ที่เลือก
  - 409 จาก `_users` ตอบ CONFLICT ให้โหลดใหม่
- **FR-19 audit:** เปลี่ยน role เขียน `role_grant.revoked` (grant เดิม) + `role_grant.issued` (grant ใหม่); ทุกการถอน / แก้ grant ที่ผู้อื่นออกบันทึก `actor` = ผู้เรียก และ `context.granted_by` = ผู้ออกเดิม
  - แก้เฉพาะวันหมดอายุ (role เดิม): ใช้ `role_grant.renewed` (วันใหม่ช้ากว่า) / `role_grant.shortened` (เร็วกว่า) ตาม CR-213 FR-14 · grant คง `granted_by` / `granted_at` ของผู้ออกเดิม (CR-213 FR-8) ผู้แก้บันทึกเป็น `actor` ใน audit

### ปิด-เปิด

- **FR-20 ปิดโปรไฟล์ = ถอนสิทธิ์:** worker sweep (CR-213 FR-12) ถอนทุก grant ในศูนย์ `SHxxx` ของบัญชีที่โปรไฟล์ที่ผูกในศูนย์นั้นมี `status: inactive` audit `role_grant.revoked` `actor: worker` `context.cause: profile_inactive` (≤ 5 นาที ตาม CR-213 FR-13)
  - role ถาวรจาก SM ไม่ถูกแตะ; dialog ยืนยันการปิดโปรไฟล์เตือน "ยังมีสิทธิ์ที่ผู้จัดการศูนย์ให้ ต้องให้ผู้จัดการศูนย์ถอน" เมื่อมี
  - **Amendment A1-6:** โปรไฟล์ที่มี role ถาวรจาก SM: VC ปิดไม่ได้ (ปุ่ม disabled + เหตุผล) SM / SA ปิดได้
- **FR-21 ห้ามออกสิทธิ์ให้โปรไฟล์ที่ปิด:** `POST /api/v1/volunteer-access` ตอบ 422 "เปิดใช้งานอาสาสมัครก่อนจึงจะออกสิทธิ์ได้"
- **FR-22 พากลับมา:** ถอน / หมดอายุ / ปิดแล้วเปิดโปรไฟล์ใหม่ → สถานะ `lapsed` → VC "ออกสิทธิ์อีกครั้ง" ด้วย role เดิมหรือใหม่ + วันหมดใหม่ ให้บัญชีเดิม (รหัสผ่านเดิม) ไม่ผ่าน SM/SA; ต้องยืนยันตัวตนในศูนย์นี้ (FR-3) และ CR-213 FR-7 ยังใช้
- **FR-23 ปิดทั้งบัญชีจิตอาสา:** `PUT /api/v1/users` เปลี่ยน `active` ของบัญชี `personnel_type: volunteer` ได้เฉพาะ SA (SM ได้ 403 "บัญชีจิตอาสาใช้การถอนสิทธิ์ในศูนย์แทนการปิดบัญชี"); บัญชีเจ้าหน้าที่ทั่วไปเหมือนเดิม; VC เปิดบัญชีที่ SA ปิดไม่ได้ (CR-213 FR-7 เดิม)
  - หน้าแก้ไขผู้ใช้ (`user-form.svelte`) ของ SM: บัญชีจิตอาสาไม่แสดงสวิตช์ `active` (SA ยังเห็น) — SM จึงไม่กดบันทึกแล้วติด 403 · ~~และตำแหน่งหน้าที่ของศูนย์เลือกได้ 1 role (FR-4)~~ ตัดโดย Amendment A1-3

### ยืนยันตัวตนและออกสิทธิ์จากหน้ากะ

- **FR-24:** แถวในตารางกะ (`roster-row`) ที่ขึ้น "รอยืนยันตัวตน" มีปุ่ม "ยืนยันตัวตน" เปิด dialog ตรวจตัวตนเดียวกับหน้าโปรไฟล์ (ผู้ยืนยันและกติกาเดิม) ยืนยันแล้วแถวกลับมาเช็คอินได้ทันทีโดยไม่ออกจากหน้ากะ
- **FR-25:** แถวในตารางกะ และแถวผู้สมัครในแท็บผู้สมัครของงาน (`/back-office/volunteers/jobs/<id>`) มีป้ายและปุ่มสิทธิ์ตามสถานะ FR-9 + FR-15 เปิด dialog เดียวกับ FR-10 ถึง FR-16 (เห็นเฉพาะ SA / SM / VC)

## Change — Part C (PR 2): portal จิตอาสาแสดงสถานะสิทธิ์

- **FR-26:** หน้า portal จิตอาสา (หลังเข้าด้วยเบอร์หรือ token ตั๋ว) แสดงการ์ด "สิทธิ์ใช้งานระบบ" ของแต่ละศูนย์ที่จิตอาสามีโปรไฟล์
  - ยังไม่มีบัญชี (`none`): "ยังไม่ได้รับสิทธิ์ใช้งานระบบ — ติดต่อผู้ประสานงานจิตอาสาของศูนย์"
  - `lapsed` (แก้โดย Amendment A2): "สิทธิ์ใช้งานระบบสิ้นสุดตั้งแต่วันที่ dd/mm/yyyy — ติดต่อผู้ประสานงานจิตอาสาของศูนย์" (ไม่ทราบวัน: "สิทธิ์ใช้งานระบบสิ้นสุดแล้ว — …")
  - `active`: "<ชื่อ role> · หมดอายุสิ้นวันที่ dd/mm/yyyy" (role ถาวร: ไม่แสดงวันหมด) + ปุ่ม "เข้าสู่ระบบเจ้าหน้าที่" → `/login`
  - ~~`account_disabled`: "บัญชีถูกระงับ — ติดต่อผู้ดูแลระบบ"~~ ตัดออก — แก้โดย Amendment A2 (บัญชีที่ถูกระงับแสดงเหมือน `none`)
- **FR-27 endpoint:** `POST /api/public/v1/volunteer/access-status` รับ credential เดียวกับ `/api/public/v1/volunteer/schedule` (เบอร์หรือ token ตั๋ว) หาโปรไฟล์จาก `phone_hash` แล้วหาบัญชีด้วยการผูก 2 ทาง (FR-7) ฝั่ง server ด้วย admin credential
- **FR-28 ข้อมูลที่คืน** (`role_label` เมื่อมีหลาย role: แก้โดย Amendment A1-5 · แก้โดย Amendment A2: `status` = `none` / `lapsed` / `active` ไม่มี `account_disabled`; `expires_at` ของ `lapsed` = วันที่สิทธิ์สิ้นสุด): `[{ shelter_code, shelter_name, status, role_label | null, expires_at | null }]` เท่านั้น **ห้ามคืน username / อีเมล / ผู้ออก** (portal เข้าได้ด้วยเบอร์ คนที่รู้เบอร์ไม่ควรรู้ชื่อบัญชี)

## Change — Part B (PR 3): 1 บัญชีหลายศูนย์

- **FR-29 field ใหม่:** `_users.volunteer_profiles: [{ shelter_code, volunteer_id }]` 1 รายการต่อศูนย์
  - `volunteer_id` เดิมคงไว้ = โปรไฟล์แรก (โค้ดที่อ่านอยู่ไม่พัง)
  - ไม่ให้สิทธิ์ข้อมูล (ไม่อยู่ใน `roles`), ไม่ถูกลบตอนถอน / หมดอายุ / ปิดโปรไฟล์
  - เพิ่มในรายการ field ของ `_users/_design/tent_guard` (CR-213 FR-11) ผู้ที่ไม่ใช่ admin เปลี่ยนไม่ได้
- **FR-30 ผูกศูนย์ใหม่:** VC (หรือ SM) ของ SH002 ออกสิทธิ์ให้โปรไฟล์ SH002 แล้วพบบัญชีจิตอาสาเดิมที่โปรไฟล์ที่ผูกอยู่มี `phone_hash` **และ** `national_id_hash` ตรงกับโปรไฟล์ SH002 → เพิ่ม `{ SH002, volunteer_id }` เข้า `volunteer_profiles`, ตั้ง `user_name` ของโปรไฟล์ SH002, ออก role ของ SH002; ไม่สร้างบัญชีใหม่และไม่เปลี่ยนรหัสผ่าน
  - dialog แสดง "พบบัญชีเดิมของจิตอาสาคนนี้: <username>" อ่านอย่างเดียว
  - ที่มาของข้อมูล: เมื่อเปิด dialog ให้โปรไฟล์ที่ยังไม่มี `user_name` `GET /api/v1/volunteer-access?shelter_code=&volunteer_id=` ตรวจฝั่ง server ว่ามีบัญชีจิตอาสาที่โปรไฟล์ที่ผูกอยู่มี `phone_hash` + `national_id_hash` ตรงกันหรือไม่ ถ้ามีคืน `matched_existing_username` → dialog แสดง username แบบอ่านอย่างเดียวและไม่แสดงช่องรหัสผ่าน (เหมือนสถานะ `lapsed` ของ FR-10); ไม่มีคืน `null` → ฟอร์มบัญชีใหม่ตามเดิม · `POST` ตรวจเงื่อนไขเดิมซ้ำ ไม่เชื่อค่าจาก dialog
  - ใช้ได้แม้บัญชีไม่มี role ในศูนย์ใดเหลือ (ออกจากศูนย์ล่าสุดแล้ว) ไม่ต้องผ่าน SM ของศูนย์ใหม่
  - การจับคู่เบอร์ + เลขบัตรใช้หาบัญชีเดิมเท่านั้น ไม่ใช่ผลยืนยันตัวตน: โปรไฟล์ SH002 ต้องยืนยันตัวตนใน SH002 ก่อนออกสิทธิ์ (FR-3)
  - โปรไฟล์ SH002 ไม่มี `national_id_hash` หรือไม่ตรง: ไม่ผูก ไม่สร้างบัญชีซ้ำด้วยอีเมลเดียวกัน แจ้ง "จิตอาสาคนนี้มีบัญชีอยู่แล้ว กรุณากรอกเลขบัตรประชาชนให้ตรงกับข้อมูลเดิม"
  - บัญชีที่มี `volunteer_coordinator` หรือ `shelter_manager` ในศูนย์ใด: VC ผูกและออกสิทธิ์ให้ไม่ได้ (CR-213 FR-7) **SM ของศูนย์ที่จะให้ทำงาน (SH002) เป็นผู้ผูกและออก role ของ SH002 เอง** ไม่ต้องผ่าน SA; SM แตะได้เฉพาะ role ของศูนย์ตัวเอง
  - บัญชี `system_admin`: ไม่ผูก
- **FR-31 แยกต่อศูนย์:** ผู้ออกสิทธิ์ใน SH002 ต้องมี `volunteer_coordinator` (หรือ SM / SA) ใน SH002 เอง ศูนย์อ่านจาก session (CR-213 FR-1) VC ของ SH001 ออกสิทธิ์ใน SH002 ไม่ได้ (403); VC / SM ของ SH002 อ่าน แก้ ถอน ได้เฉพาะ role / grant ของ SH002; ปิดโปรไฟล์ SH002 ถอนเฉพาะ SH002; หน้า "บัญชีจิตอาสา" ไม่แสดง role ของศูนย์อื่น
- **FR-32 SM ออกสิทธิ์จากการ์ด:** เลิกเงื่อนไข "บัญชีเดิมต้องมี scope 1 ศูนย์ + 1 capability" ตรวจเฉพาะ role ในศูนย์ของ SM ~~(FR-4)~~ _(Amendment A1-4: การ์ดใช้กับบัญชีที่ยังไม่มี role ในศูนย์นี้ · บัญชีที่มี role ในศูนย์นี้แล้วเพิ่ม role ที่หน้าผู้ใช้งาน ได้หลาย role)_
- **FR-33 1 บัญชีต่อคน:** สร้างบัญชีจิตอาสาใหม่ถูกปฏิเสธเมื่อมีบัญชีจิตอาสาเดิมที่ตรงตาม FR-30 (ให้ผูกแทน)

### schema.md §6 `_users` — เพิ่ม field (Part B)

| Field                | ชนิด                                       | req | หมายเหตุ                                                                                                                                                                               |
| -------------------- | ------------------------------------------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `volunteer_profiles` | [{`shelter_code`:str, `volunteer_id`:str}] | opt | โปรไฟล์จิตอาสาที่บัญชีผูก 1 รายการต่อศูนย์ — ใช้หาบัญชีจิตอาสาของศูนย์ ไม่ให้สิทธิ์ข้อมูล แก้ได้เฉพาะ admin (`_design/tent_guard`) ไม่ถูกถอดโดย sweep; `volunteer_id` เดิม = รายการแรก |

## Acceptance

**Part A**

- [ ] VC เห็น radio 10 role; `POST` ด้วย `kiosk_staff` / `volunteer_coordinator` ได้ 403
- [ ] โปรไฟล์ที่ยังไม่ยืนยันตัวตนในศูนย์นี้: SA / SM / VC เห็นปุ่ม "ยืนยันตัวตนก่อนออกสิทธิ์" (กดแล้ว toast + เปิด dialog ตรวจตัวตน); `POST` ได้ 422 แม้มีโปรไฟล์ศูนย์อื่นที่เบอร์และเลขบัตรตรงและยืนยันแล้ว
- [ ] แท็บรายชื่อและแท็บผู้สมัครของงาน: VC / SM / SA เห็นตำแหน่งปัจจุบันของบัญชี ("<ตำแหน่ง> · ถึง …" / "· ถาวร") หรือ "สิทธิ์ในศูนย์นี้สิ้นสุดแล้ว" / "ยังไม่มีบัญชีระบบ"; ผู้ที่ไม่ใช่ SA / SM / VC เรียก `GET …/accounts` ได้ 403
- [ ] SM เห็นบัญชี `lapsed`: ไม่มีปุ่ม มีข้อความให้ VC ออกสิทธิ์อีกครั้ง; SA ได้ปุ่ม "จัดการบัญชีผู้ใช้"
- [ ] ผู้ที่ได้ `warehouse_staff` จาก VC เข้าเมนูและหน้าคลังได้เหมือนคนที่ SM ให้
- [ ] เมนู "บัญชีจิตอาสา" เห็นเฉพาะ SA / SM / VC; หน้าแสดงเฉพาะบัญชีที่ผูก 2 ทาง รวมบัญชีที่ไม่มี role เหลือ ไม่แสดงบัญชีเจ้าหน้าที่ทั่วไป
- [ ] ปุ่มบนการ์ดและในหน้าบัญชีตรงสถานะ FR-9
- [ ] "แก้ไขสิทธิ์": username อ่านอย่างเดียว ไม่มีรหัสผ่าน radio เลือก role ปัจจุบัน วันหมดว่างพร้อม "เดิม: …" บันทึกไม่ได้ถ้าไม่เลือกวัน
- [ ] VC เปลี่ยน role ครัว → คลัง: บัญชีมี `shelter:SH001` + `SH001:warehouse_staff` เท่านั้น audit `revoked` + `issued`
- [ ] VC คนที่ 2 ถอนและแก้ grant ที่ VC คนแรกออกได้ audit บันทึกทั้งผู้ทำและผู้ออกเดิม; แตะ role ถาวรของ SM ได้ 403
- [ ] (A1) SM ให้บัญชีจิตอาสา `registration_staff` + `kitchen_staff` ถาวรในศูนย์เดียวได้ · VC ออก grant `warehouse_staff` 3 วันข้าง 2 role นั้นได้ (บัญชีมี 3 role) · ถอน grant แล้ว role ถาวร 2 ตัวยังอยู่ · grant หมดอายุ (worker) แล้ว role ถาวร 2 ตัวและ `shelter:SHxxx` ยังอยู่ login เข้าหน้าของ role ถาวรได้
- [ ] (A1-2) VC ออก `kitchen_staff` ซ้ำกับ role ถาวรที่ SM ให้ → `403 FORBIDDEN` "ตำแหน่งนี้ผู้จัดการศูนย์ให้ไว้แล้ว" ไม่เขียนอะไร (บัญชีและ audit ไม่เปลี่ยน)
- [ ] (A1-2) บัญชีมี grant `kitchen_staff` ของ VC อยู่ แล้ว SM ให้ `kitchen_staff` ถาวรจากหน้าผู้ใช้งาน → บันทึกผ่าน: grant ของ role นั้นถูกตัดออก (`pruneRoleGrants`) เหลือ role ถาวร ไม่มีวันหมด · grant ของ role อื่นที่ยังอยู่ไม่ถูกแตะ
- [ ] (A1-5) บัญชีมี role ถาวร `registration_staff` + `kitchen_staff` และ grant `warehouse_staff`: portal คืน `role_label` = `kitchen_staff` (ไม่มีวันหมด) · มีเฉพาะ grant: คืน role ของ grant พร้อมวันหมด
- [ ] (A1-6) VC เห็นปุ่มปิดโปรไฟล์ของจิตอาสาที่มี role ถาวรจาก SM เป็น disabled พร้อมเหตุผล · SM ปิดได้ · จิตอาสาที่มีเฉพาะ grant ของ VC: VC ปิดได้
- [ ] (A1-2, FR-9) บัญชีที่มีแค่ `SH001:kitchen_staff` ถาวร (ยืนยันตัวตนใน SH001 แล้ว): VC เห็นป้าย "ครัว · ถาวร" + ปุ่ม "แก้ไขสิทธิ์ใช้งาน" · dialog: radio `kitchen_staff` disabled พร้อม "ผู้จัดการศูนย์เป็นผู้ให้ แก้ไขได้ที่หน้าผู้ใช้งาน", role อื่นเลือกได้และไม่มีตัวที่เลือกไว้, ไม่มีปุ่ม "ถอนสิทธิ์" · เลือก `warehouse_staff` + วันหมด กด "บันทึกการแก้ไข" → บัญชีมี `shelter:SH001` + `SH001:kitchen_staff` + `SH001:warehouse_staff`, grant 1 รายการ, audit `role_grant.issued` 1 ฉบับ
- [ ] (A1-2) บัญชีเดียวกัน: `DELETE` `kitchen_staff` ได้ 403 · grant `warehouse_staff` หมดอายุ (worker) → เหลือ `shelter:SH001` + `SH001:kitchen_staff` สถานะยัง `active`
- [ ] (A1-2) บัญชีที่มีแค่ role ถาวรแต่โปรไฟล์ยังไม่ยืนยันตัวตนใน SH001: ปุ่ม "บันทึกการแก้ไข" disabled พร้อมเหตุผลยืนยันตัวตน · ยิง `POST /api/v1/volunteer-access` ตรงได้ 422 `_users` ไม่เปลี่ยน
- [ ] (A1-3) SM เลือก `registration_staff` + `kitchen_staff` ให้บัญชีจิตอาสาในหน้าแก้ไขผู้ใช้แล้วบันทึกผ่าน · สวิตช์ `active` ยังไม่แสดงสำหรับ SM
- [ ] (A1-4) บัญชีจิตอาสาที่มี `SH001:registration_staff`: การ์ดของ SM แสดงปุ่ม "จัดการบัญชีผู้ใช้" (ไม่มี dialog ออกสิทธิ์) · SM เพิ่ม `kitchen_staff` ที่หน้าผู้ใช้งาน → บัญชีมี `shelter:SH001` + `SH001:registration_staff` + `SH001:kitchen_staff`
- [ ] (A1-4) บัญชีจิตอาสาเดิมของโปรไฟล์ที่มีแค่ `SH002:kitchen_staff` (ยืนยันตัวตนใน SH001 แล้ว): SM ของ SH001 ออก `registration_staff` จากการ์ด → บัญชีมี `shelter:SH001` + `SH001:registration_staff` และ role ของ SH002 ไม่หาย รหัสผ่านเดิมใช้ login ได้ ไม่ขึ้น "อีเมลนี้มีบัญชีอยู่แล้วหรือสิทธิ์ไม่ตรงกัน"
- [ ] (A1-7) SM `PUT /api/v1/users` เพิ่ม `SH001:medical_staff` ให้บัญชีจิตอาสาที่โปรไฟล์ยังไม่ยืนยันตัวตนใน SH001 → 422 `_users` ไม่เปลี่ยน · `PUT` แก้ `display_name` ของบัญชีเดียวกัน (ไม่เพิ่ม role) ผ่าน · บัญชี `personnel_type: staff` ไม่ตรวจ
- [ ] (A1-8) SM เพิ่ม `SH001:kitchen_staff` ถาวรให้บัญชีจิตอาสา (หน้าผู้ใช้งานหรือการ์ด) → audit `role_grant.permanent_issued` 1 ฉบับใน `shelter_sh001` (`context.role` = `kitchen_staff`, `context.expires_at` = `null`, `context.actor` = SM) · SM เปลี่ยน grant ของ VC เป็นถาวร → มีเฉพาะ `role_grant.made_permanent` ไม่มี `permanent_issued`
- [ ] ปิดโปรไฟล์: ภายในรอบ sweep บัญชีไม่มี role ในศูนย์; เปิดโปรไฟล์แล้ว VC "ออกสิทธิ์อีกครั้ง" ด้วย role ใหม่ login รหัสผ่านเดิมได้ ไม่ใช้ SM/SA
- [ ] ออกสิทธิ์ให้โปรไฟล์ที่ปิดได้ 422
- [ ] SM เปลี่ยน `active` ของบัญชีจิตอาสาได้ 403; SA ทำได้; การ์ดแสดง "บัญชีถูกระงับโดยผู้ดูแลระบบ"
- [ ] ช่องวันหมดอายุเป็น date-picker เลือกนอกช่วงวันนี้ถึง +7 ไม่ได้
- [ ] หน้ากะ: แถว "รอยืนยันตัวตน" กดยืนยันตัวตนแล้วเช็คอินต่อได้ทันที; ปุ่มสิทธิ์ในแถว (หน้ากะ และแท็บผู้สมัครของงาน) เปิด dialog เดียวกับการ์ด

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

- **ความเสี่ยงสิทธิ์:** VC ให้ role ที่เห็นข้อมูลอ่อนไหว (`medical_staff`, `triage_staff`) และแก้สต็อกได้ (`supply_coordinator`, `warehouse_staff`) — คุมด้วยวันหมด ≤ 7 วัน, ยืนยันตัวตน, audit ทุกครั้ง และ SA ระงับบัญชีได้ (FR-23)
- **VC จัดการ grant ของ VC คนอื่นได้ (FR-17):** ลดความปลอดภัยเชิงการแบ่งหน้าที่ระหว่าง VC แลกกับการส่งต่องานข้ามกะ ตรวจย้อนได้จาก audit
- **ยืนยันตัวตนในศูนย์นี้ (FR-3):** จิตอาสาที่ไปช่วยศูนย์ใหม่ต้องให้ VC / SM ของศูนย์นั้นตรวจบัตรและยืนยันก่อนทุกครั้ง แลกกับการที่ผู้ออกสิทธิ์เห็นตัวจริงเอง
- **VC อ่านรายชื่อบัญชีจิตอาสา (FR-6):** VC เห็น username และตำแหน่งในศูนย์ตัวเองของบัญชีที่ผูกกับโปรไฟล์จิตอาสาของศูนย์ (เดิมเห็นเฉพาะ SA / SM ผ่านหน้าผู้ใช้งาน)
- **ข้อมูลข้ามศูนย์ (FR-30):** VC SH002 เห็น username ของบัญชีเดิม (เป็นอีเมลของจิตอาสาเอง) ไม่เห็น role หรือข้อมูลของ SH001
- **Amendment A1:** จิตอาสาที่ SM ให้หลาย role ได้สิทธิ์กว้างเท่าเจ้าหน้าที่ประจำในศูนย์นั้น (SM ตัดสินใจเองเหมือนบัญชีเจ้าหน้าที่) · grant ชั่วคราวของ VC ยังจำกัด 1 role
  - role ถาวรที่ SM ให้จิตอาสา (รวม role ที่เห็นข้อมูลอ่อนไหว `medical_staff`, `triage_staff`) ไม่มีวันหมด ผู้จัดการศูนย์ต้องทบทวนและถอนเอง
  - **ช่องว่างที่ปิดแล้วใน PR #1199 (A1-7, A1-8):** ปัจจุบันตรวจยืนยันตัวตนเฉพาะตอนสร้างบัญชี (`POST /api/v1/users`) — `PUT` เพิ่ม role ให้บัญชีจิตอาสาที่ยังไม่ยืนยันตัวตนได้ และไม่มี audit เมื่อ SM เพิ่ม role ถาวร · หลัง A1-7 / A1-8 role ถาวรทุกตัวที่ SM / SA เพิ่มให้จิตอาสาผ่านการยืนยันตัวตนในศูนย์นั้นและมี audit `role_grant.permanent_issued`
- **deploy:** Part A: restart worker · Part C: ไม่มี · Part B: `pnpm sync:central` → restart worker → backfill
- **ลำดับ:** merge #984 และ #1020 ก่อน Part A

## Migration

- ไม่ bump `schema_v`
- Part A: ไม่มีข้อมูลต้องแปลง; grant หลายตัวต่อศูนย์รวมเป็นตัวเดียวเมื่อบันทึกครั้งถัดไป (FR-18); โปรไฟล์ที่ปิดอยู่ก่อน deploy ถูกถอนใน sweep รอบแรก (FR-20)
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
- 2026-10-31 — แก้ตาม review ของ @Jackyzaz (PR #1046): เรียงเลข FR ตามลำดับในเอกสาร (Part A FR-1–25, Part C FR-26–28, Part B FR-29–33; FR-11a → FR-12, FR-22a/b → FR-24/25), FR-30 ระบุที่มาของ `matched_existing_username`, เพิ่ม `user-form.svelte` ใน affects + กฎ UI ของ SM (FR-23), FR-19 audit ตอนแก้เฉพาะวันหมด
- 2026-11-01 — owner (@mhapong) จากการทดสอบ #1086:
  - ต้องยืนยันตัวตน**ในศูนย์นี้**ก่อนออกสิทธิ์ ทุกผู้ออกสิทธิ์ (FR-3, FR-15) — ตัดการใช้ผลยืนยันจากศูนย์อื่น (CR-213 FR-3 เดิม) เพื่อให้ผู้ออกสิทธิ์เห็นตัวจริงเองและกติกาเดียวทุกคน
  - แท็บรายชื่อและแท็บผู้สมัครของงานแสดงตำแหน่งปัจจุบันของบัญชี + ปุ่มสิทธิ์ (FR-9, FR-25) ข้อมูลจาก FR-6 ซึ่ง VC อ่านได้
  - บัญชี `lapsed`: VC เป็นผู้พากลับมา SM ไม่มีปุ่ม (FR-9) — ตัดทาง "SM ออกสิทธิ์อีกครั้งจาก dialog" เพราะต้องเพิ่ม API ให้ SM แตะบัญชีที่ไม่มี scope ศูนย์แล้ว
  - FR-6 ระบุ response ตามที่ทำจริง (`grants` + `permanent_roles` แทน `role` ตัวเดียว)
- 2026-11-01 — approved โดย Soravit Sukkarn (Team Lead) เป็น CR-221
- 2026-11-02 — **Amendment A1** เสนอโดย @mhapong (ผู้รับงาน #1044) — รอ @Jackyzaz approve: SM กำหนด role ถาวรให้จิตอาสาได้หลายตำแหน่งต่อศูนย์เหมือนเจ้าหน้าที่ประจำ · VC ออก grant ชั่วคราว (1 role) คู่ขนานไปกับ role ถาวรของ SM ได้ · เมื่อ grant ของ VC สิ้นสุดถอนเฉพาะ role ของ grant โดย role ถาวรของ SM และขอบเขตศูนย์คงอยู่ (A1-2) · VC ปิดโปรไฟล์ที่มี role ถาวรของ SM ไม่ได้ (A1-6) · บันทึกเป็น Amendment A1 ใน CR-221 · ยกเลิกข้อจำกัด "SM ออก 1 role ต่อศูนย์" ที่เส้นทางออกสิทธิ์จากการ์ด (`volunteer-access.ts`; ฟอร์มผู้ใช้งานเป็น checkbox อยู่แล้ว — แก้ข้อความ 2026-11-04) และยกเลิกข้อห้าม "VC ห้ามออกสิทธิ์ให้บัญชีที่มี role ของ SM" (FR-16 เดิม)
- 2026-11-03 — แก้ Amendment A1 ตาม review PR #1123: role ซ้ำกับ role ถาวรของ SM ตอบ `403` (ไม่ใช่ 422) ให้ตรง `api-contract.md` §2.6 และ CR-213 FR-5 · ใส่เหตุผลและข้อแลกเปลี่ยนของ A1-6 · กำหนด tie-break `role_label` ของ portal (A1-5) · เพิ่ม CR-213 FR-10 ใน affects
- 2026-11-04 — แก้ Amendment A1 ตาม review รอบ 2 PR #1123 · คำตอบของผู้เสนอ (@mhapong) ยังรอ @Jackyzaz approve:
  - การยืนยันตัวตนและ audit ของ role ถาวรที่ SM เพิ่มให้จิตอาสา: เลือก spec เป็นงานต้อง implement (A1-7 `PUT /api/v1/users` ตรวจเหมือน `POST`; A1-8 audit `role_grant.permanent_issued`) แทนการแก้ Impact ให้เป็นสถานะปัจจุบัน
  - บัญชีที่มีแค่ role ถาวร: VC ออก grant ของ role อื่นข้าง role ถาวรได้, radio role ถาวร disabled, VC ปิดบัญชีหรือถอน role ถาวรไม่ได้ (403), grant สิ้นสุดถอนเฉพาะ role ของ grant (A1-2, แถวใหม่ใน FR-9) · โค้ด dialog ที่บล็อกการบันทึกทั้งหมดต้องแก้
  - กติกา "1 role ต่อศูนย์" ของ SM อยู่ที่เส้นทางการ์ด (`volunteer-access.ts`) ไม่ใช่ `user-form.svelte` (A1-3, A1-4) · ใส่หมายเหตุ CR-213 TL;DR, FR-7, FR-10, AC-3, AC-6 · อัปเดต role-permission-matrix และ `_index.md`
  - ตัดรหัส A1–A7 ออกจากหัวข้อย่อยของ Part A (ไม่มีโค้ดหรือเอกสารอ้างถึง) ให้ "A1-x" / "A2" หมายถึง Amendment อย่างเดียว · ไม่เปลี่ยนรหัส Amendment เพราะโค้ด (`public-access-status.ts`, `volunteer-portal/domain/volunteer.ts`), `api-contract.md` และ CR-213 อ้าง "Amendment A1-2" / "Amendment A2" อยู่แล้ว
- 2026-11-04 — **Amendment A1 approved (Soravit Sukkarn (Team Lead), review PR #1123)** — อนุมัติตามที่เสนอ และตัดสิน A1-4: SM / SA เพิ่ม role ให้บัญชีจิตอาสาที่มี role ในศูนย์นี้อยู่แล้วที่หน้าผู้ใช้งานเท่านั้น (A1-3) การ์ดของบัญชี `active` คงปุ่ม "จัดการบัญชีผู้ใช้" ตาม FR-9 · เส้นทางการ์ดของ SM / SA ใช้กับบัญชีที่ยังไม่มี role ในศูนย์นี้ (1 role ต่อครั้ง) · ลบป้าย proposed ใน api-contract §2.6, role-permission-matrix, `_index.md` และหมายเหตุใน CR-213 · เพิ่ม `role_grant.permanent_issued` ใน schema.md §2.12 · ยังไม่ตัดสิน (ติดไว้ก่อน): ลำดับ 403 / 422 เมื่อเข้าทั้งสองเงื่อนไขของ A1-2 และขอบเขตศูนย์ที่ A1-7 ตรวจเมื่อ `PUT` ส่ง roles ทั้งชุด
