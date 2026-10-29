# สรุปงาน: RBAC audit follow-ups (#473)

> วันที่: 2026-10-30 · branch: `fix/473-rbac-audit-follow-ups` (แตกจาก `develop` ที่ `38e3403cf`) · สถานะ: commit ในเครื่องแล้ว **ยังไม่ push และยังไม่เปิด PR**

## สรุป (TL;DR)

- แก้แล้ว 3 sub-issue: **#474** (`/api/register` ตอบ 404), **#478** (guard ของหน้า readiness), **#477** (BFF ตรวจ capability ในศูนย์ที่ทำงานอยู่ สำหรับ donations / referral / transfer)
- **ไม่ได้แก้** #476 เพราะเป็นคำถามถึง PM ที่ยังไม่มีคำตอบ และ #475, #479 ปิดไปแล้ว
- **#477 ยังเหลือส่วน user management** (`authorizeUserWrite`) ที่ผู้ใช้หลายศูนย์ยังถูกผูกกับศูนย์แรก แนะนำให้ทำเป็นงานแยก
- ผลตรวจ: test ที่เกี่ยวข้อง 825/825 ผ่าน, `pnpm check` 0 error, ESLint ไฟล์ที่แก้ทั้ง 31 ไฟล์ผ่าน, Prettier ผ่านทั้งโปรเจกต์

## สถานะ sub-issue

| Issue | หัวข้อ | สถานะ issue | ผลรอบนี้ |
| --- | --- | --- | --- |
| #474 | ปิด `/api/register` (ตอบ 404) | open | **แก้แล้ว** |
| #475 | [PM] ควรยอมให้ข้าม MFA ได้หรือไม่ | closed | ไม่ต้องทำ (MFA ปิดอยู่ `MFA_STEPUP_ENABLED=false`) |
| #476 | [PM] `requireAuth` ปล่อยผ่านเมื่อเช็ค auth ไม่สำเร็จ | open | **ไม่ได้แก้** รอ PM เลือก (a)/(b)/(c) |
| #477 | BFF ตรวจ capability จากศูนย์ใดก็ได้ | open | **แก้แล้วบางส่วน** (donations, referral, transfer) |
| #478 | guard + shelter scope ให้ `/back-office/shelters/readiness/[id]` | open | **แก้แล้ว** |
| #479 | rate limit + constant-time compare | closed | ไม่ต้องทำ |

## ขั้นตอนการทำงาน

1. อ่าน #473 และ sub-issue ทั้ง 6 ฉบับพร้อม comment ผ่าน GitHub REST API (เครื่องนี้ไม่มี `gh`)
2. ตรวจว่าโค้ดปัจจุบันยังมีปัญหาตามที่ issue บอกจริง ก่อนลงมือแก้
3. สร้าง branch `fix/473-rbac-audit-follow-ups` จาก `origin/develop`
4. แต่ละ issue เขียน test ที่ fail ก่อนแล้ว commit แยกไว้ จากนั้นจึงแก้โค้ดให้ test ผ่าน เพื่อให้ประวัติ git แสดง repro ก่อน fix
5. งาน #477 กระทบหลาย route จึงให้ subagent ทำใน worktree แยกพร้อมกัน แล้วตรวจ diff เองก่อน cherry-pick เข้า branch นี้
6. รัน test ที่เกี่ยวข้อง, `pnpm check` และ ESLint/Prettier

## รายละเอียดการแก้

### #474 ปิด `POST /api/register`

- **ปัญหา:** endpoint สร้างบัญชี `_users` แบบ `roles: []` ได้โดยไม่ต้อง login ทั้งที่ไม่มี UI เรียกใช้แล้ว
- **แก้:** `frontend/src/routes/api/register/+server.ts` เหลือแค่ handler ที่ throw `error(404)` และเพิ่มหมายเหตุใน `frontend/src/lib/server/user-service.ts` ว่า endpoint ถูกปิดแล้ว
- **เก็บไว้:** `frontend/src/lib/features/register/**` ยังอยู่ครบตามที่ตัดสินใน issue
- **Test:** `src/routes/api/register/server.test.ts` ส่ง username/password ที่ถูกต้อง ต้องได้ 404 และต้องไม่มีการเรียก `createUser`
  - ก่อนแก้: fail (endpoint ตอบ `Response` ปกติ คือสร้างบัญชีได้)
  - หลังแก้: pass

### #478 guard หน้า readiness

- **ปัญหา:** `/back-office/shelters/readiness/[id]` มีแค่ `requireAuth` จาก layout ผู้ใช้ที่ login แล้วทุกคนเปิด readiness ของศูนย์ใดก็ได้ด้วยการแก้ URL
- **แก้:** `requireManager(fetchFn, shelterCode?)` ใน `frontend/src/lib/guards/auth.ts` รับ shelter code จาก URL เป็น argument เสริม ถ้าส่งมาจะตรวจสิทธิ์ manager **ในศูนย์นั้น** แทนศูนย์ที่เลือกอยู่ หน้า readiness `[id]/+page.ts` เรียก `requireManager(fetch, params.id)`
- **เลือกเกณฑ์:** ใช้ "เป็น SA หรือเป็น shelter_manager ของศูนย์ใน URL" ซึ่งเข้มกว่าแค่มี `shelter:{code}` เพราะ tile ใน portal แสดงเฉพาะ SA/SM และฝั่ง server (`requireShelterManagerOrSA`) ก็ใช้เกณฑ์นี้ ถ้า PM ต้องการให้ FAC เข้าได้ ต้องเพิ่ม guard ใหม่ตามที่ issue บอก
- **ขยายผลจุดที่มีปัญหาเดียวกัน:** `/back-office/shelters/edit/[id]` ใช้ `requireManager` ที่ตรวจศูนย์ที่เลือกอยู่ ไม่ใช่ศูนย์ใน URL (หน้านั้นเปลี่ยน selected shelter ให้ตรง URL ทีหลัง) จึงส่ง `params.id` เข้าไปด้วย ตรวจแล้วว่า `params.id` เป็น shelter code (ดู `portal-menu.ts` และ `back-office/shelters/+page.svelte`)
- **Test:** `src/lib/guards/auth.test.ts` เพิ่ม 4 กรณี SA ผ่านทุกศูนย์, SM ของศูนย์นั้นผ่าน, SM ของศูนย์อื่นถูก redirect แม้จะเลือกศูนย์ของตัวเองอยู่, และ user ที่เป็นแค่ staff ในศูนย์ใน URL ถูก redirect
  - ก่อนแก้: 2 กรณีหลัง fail
  - หลังแก้: 31/31 pass

### #477 BFF ตรวจ capability ในศูนย์ที่ทำงานอยู่

- **ปัญหา:** helper ตรวจว่ามี capability "ที่ไหนก็ได้" แต่ทำงานกับ `caller.shelterCode` ซึ่งคือ `shelter:` ตัวแรกใน roles ตัวอย่างเช่น roles `shelter:SH001`, `shelter:SH002`, `SH002:warehouse_staff` ทำงานคลังของ SH001 ได้
- **แก้:** เพิ่ม `frontend/src/lib/server/active-shelter.ts` (`resolveActiveShelter`) เป็นจุดตัดสินจุดเดียว
  - non-SA ส่ง `shelter_code` มา: ใช้ศูนย์นั้นเมื่อมี capability ในศูนย์นั้น ไม่มีตอบ 403
  - non-SA ไม่ส่ง: ใช้ศูนย์เดียวของตน ถ้ามีหลายศูนย์ตอบ 400
  - SA: พฤติกรรมเดิม
- **ที่มาของศูนย์ที่ทำงานอยู่ แยกตาม route:**

| Route | ที่มาของศูนย์ |
| --- | --- |
| `GET donations` (queue), `GET donations/redirects` | `?shelter_code` (SA ไม่ส่งจะเห็นทุกศูนย์) |
| `POST donations` (walk-in) | `?shelter_code` หรือ `shelter_code` ใน body |
| `donations/[query]/…` (GET/POST, approve, reject, redirect, audit) | `shelter_code` ของเอกสาร donation เอง |
| `referral/**` | `?shelter_code` |
| `transfer/**` | `?shelter_code` |

- **ฝั่ง client:**
  - referral และ transfer ส่ง `shelter_code` อยู่แล้ว แต่ server ไม่เคยใช้ (ตรวจแล้วใน `referral.remote.ts` และ `operations.remote.ts`)
  - donation queue เพิ่มการส่ง `shelter_code` จาก `resolveContextShelterCode()` และแยก query key ตามศูนย์
- **Test:** `active-shelter.test.ts` (9 กรณี) และกรณีเพิ่มใน `donations_queue.test.ts`, `walkin_intake.test.ts`, `audit.test.ts`, `referral/server.test.ts`, `transfer/server.test.ts` ครอบกรณี "มี capability ในศูนย์อื่นแต่ไม่มีในศูนย์ที่ทำงาน → 403" ตาม acceptance criteria

## ผลการตรวจ

| ตรวจ | ผล |
| --- | --- |
| `pnpm vitest run` เฉพาะ suite ที่แตะ (active-shelter, `api/back-office`, `features/donations`, `api/register`, `guards`) | `Test Files 61 passed (61)` · `Tests 825 passed (825)` |
| `pnpm check` | `COMPLETED 10200 FILES 0 ERRORS 0 WARNINGS` |
| Prettier (`pnpm lint` ช่วงแรก) | `All matched files use Prettier code style!` |
| ESLint ไฟล์ที่เปลี่ยน 31 ไฟล์ | exit 0 |
| Lefthook pre-commit | ผ่านทุก commit |

**ยังไม่ได้ตรวจ:**

- ESLint ทั้งโปรเจกต์ ถูก OOM kill (exit 137) บนเครื่องนี้ จึงรันเฉพาะไฟล์ที่เปลี่ยน
- unit test ทั้งชุด และ E2E (Playwright) ยังไม่ได้รัน
- ยังไม่ได้ลองบนเบราว์เซอร์จริง
- pre-push hook จะรัน `pnpm check` + `pnpm test` ทั้งชุดตอน push

## สิ่งที่เปลี่ยนพฤติกรรม (ต้องรู้ก่อน merge)

- user ที่ไม่ใช่ SA และอยู่หลายศูนย์ ถ้าเรียก list route ของ donations / referral / transfer โดยไม่ส่ง `shelter_code` จะได้ **400** แทนการตกไปที่ศูนย์แรกแบบเงียบๆ (client ในโปรเจกต์ส่งครบแล้ว)
- ถ้า `tent.activeShelterCode` ใน localStorage ค้างเป็นศูนย์ที่ user ไม่มีสิทธิ์ จะได้ **403** แทนการใช้ศูนย์แรก
- SM หลายศูนย์ที่เปิด `/back-office/shelters/edit/{code}` ของศูนย์ที่ตนไม่ได้เป็น SM จะถูก redirect ไป `/portal`

## งานที่เหลือ / ต้องตัดสินใจ

1. **#476 (PM):** เลือก (a) ใช้สถานะล่าสุดที่รู้, (b) fail-closed ทุกกรณี หรือ (c) แก้แค่ comment ข้อมูลประกอบ: #475 ปิดแล้วเพราะ MFA ปิดอยู่ แต่ `must_change_password` (force-setup) ยังถูกข้ามได้เมื่อ `/api/v1/auth/me` ล้มเหลว
2. **#477 ส่วน user management:**
   - **ไม่หลวมกว่าหน้า:** `assertCanGrant`, `listUsers` และ `managerMayMutateTarget` ตรวจรายศูนย์ด้วย `managerShelterCodes` อยู่แล้ว
   - **ยังผูกกับศูนย์แรก:** `updateUser`, `deleteUser` และ `createOrMergeUser` ใน `user-service.ts` ใช้ `managed[0] ?? caller.shelterCode` หน้า `user-edit-page`, `user-create-page` และ `user-management-page` ก็ใช้ `shelterCodeFromRoles` (ศูนย์แรก) เช่นกัน
   - **ข้อเสนอ:** เปิดเป็น issue แยก เพราะต้องแก้ทั้ง service, route และหน้า Svelte 3 หน้า
3. **#478:** ถ้า PM ต้องการให้ facility_staff เปิด readiness ได้ ต้องเพิ่ม guard ใหม่และทำ CR
4. ปิด issue / เปิด PR: ยังไม่ได้ทำ ต้อง push branch และเปิด PR ไปที่ `develop` ก่อน

## Commits

| SHA | ข้อความ |
| --- | --- |
| `c6c1e8dad` | test(register): expect /api/register to answer 404 (#474) |
| `0c861f5f5` | fix(register): close unused self-signup endpoint with 404 (#474) |
| `4c1d634b4` | test(guards): scope requireManager to the shelter in the url (#478) |
| `09b1b6ee5` | fix(guards): check manager rights in the shelter the url names (#478) |
| `deffad469` | fix(bff): check referral/transfer capability in the active shelter (#477) |
| `2d0d516a2` | fix(donations): check warehouse capability in the active shelter (#477) |
