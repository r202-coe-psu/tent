---
id: draft
title: ย้ายการจัดการเครื่องสแกน/Kiosk (scanner_device) จาก System Management ไป Back Office — SA ทุกศูนย์ + shelter_manager / kiosk_staff เฉพาะศูนย์ตัวเอง · ย้าย API `/api/v1/scanner/*` → `/api/v1/kiosk/*`
status: proposed
date: 2026-10-12
updated: 2026-10-12
requested_by: ทีม kiosk
decided_by: <รอเจ้าของโครงการ>
layer: volatile
supersedes_rules:
  - schema.md §3.11 — การสร้าง/จัดการ scanner_device เป็นของ system_admin เท่านั้น (§3.11 อ้างที่มาเป็น "CR-084" แต่ CR-084 ใน _index.md คือ catalog schema reconciliation — เลขชน ไม่พบไฟล์ CR ต้นทาง)
  - CR-158 §2.3 — สิทธิ์ "SA" ของ POST /api/v1/scanner/devices, staff-pin, staff-pin/reveal, DELETE devices/[id]
  - CR-158 FR-5 — ตั้ง / สุ่ม / ดู PIN ได้เฉพาะ SA (authorizeUserWrite + isSA)
  - CR-158 AC-5 — non-SA เรียก set/reveal ได้ 403 (หลัง CR นี้ SM ศูนย์ตัวเองได้ 200, SM ศูนย์อื่นได้ 404 ตาม FR-SBO-04)
  - CR-158 §3 หัวข้อ "Admin (/system-management/scanners)" FR-26..29 — path หน้าจัดการเปลี่ยนเป็น /back-office/kiosks
  - CR-162 role `banner_staff` (§2 แถว Roles, FR-KBN-24, FR-KBN-26, FR-KBN-27, AC ที่อ้าง `banner_staff`, decision log 2026-10-11) — แทนที่ด้วย `kiosk_staff` ตาม §3.6 · ไม่เพิ่ม `banner_staff` ใน `roles.ts` · `kiosk_staff` ใช้ช่องบทบาทที่ 11 เดิมของ `banner_staff` (ไม่มีบทบาทที่ 12)
  - role-permission-matrix.md §1.1 แถว **BAN** `banner_staff` + note CR-162 · schema.md §3.12 / §6 และ api-contract.md §2.3 ส่วนที่อ้าง `{code}:banner_staff` → `{code}:kiosk_staff`
  - path API `/api/v1/scanner/*` ทั้งหมดที่กำหนดใน CR-097, CR-149, CR-151, CR-152, CR-158, CR-162 (banner — ยังไม่ build), CR-163 และ api-contract.md §2.1–2.3 → `/api/v1/kiosk/*` ตาม §2.4 (พฤติกรรม / body / response / auth ไม่เปลี่ยน)
affects:
  - docs/prd/role-permission-matrix.md §1.1 (แถว **BAN** `banner_staff` → **KIO** `kiosk_staff` — ยังคง 11 บทบาท · แถวสิทธิ์ใหม่ "Kiosk Device" (`/back-office/kiosks`) · แถว "Kiosk Banner" คอลัมน์ BAN → KIO)
  - docs/changes/14-kiosk/CR-162-kiosk-banner.md (หมายเหตุหัวไฟล์: `banner_staff` ถูกแทนที่ด้วย `kiosk_staff` โดย CR นี้ §3.6) · docs/features/kiosk-banner-design-guideline.md (`banner_staff` → `kiosk_staff`)
  - docs/data/schema.md §3.12 `kiosk_banner` (สิทธิ์ `{code}:banner_staff` → `{code}:kiosk_staff`) · docs/data/api-contract.md §2.3 ฝั่ง back-office (เหมือนกัน)
  - docs/data/schema.md §6 `_users.roles` (`{code}:banner_staff` → `{code}:kiosk_staff`) — ไม่เปลี่ยนรูปร่าง doc, ไม่ bump schema_v
  - docs/data/api-contract.md §2.2 (สิทธิ์ admin endpoint SA → SA + SM / kiosk_staff scope · เพิ่ม GET /api/v1/kiosk/devices, PATCH /api/v1/kiosk/devices/[id])
  - docs/data/api-contract.md §2.1, §2.1.1, §2.2, §2.3 (path `/api/v1/scanner/*` → `/api/v1/kiosk/*` ตาม §2.4 · ชื่อ client `scanner_client` → kiosk client)
  - docs/data/schema.md §1.6 หมายเหตุรูป kiosk walk-in, §3.11 Design Choice, §3.11.1 Delete order, §3.12 kiosk_banner (อ้าง path endpoint เท่านั้น — ไม่เปลี่ยนรูปร่าง doc, ไม่ bump schema_v)
  - docs/features/smart-card-registration-spec.md (path register / draft / routes dir) · docs/features/kiosk-banner-design-guideline.md (path banner feed / image / route files / allowlist)
  - frontend/src/routes/api/v1/scanner/** → frontend/src/routes/api/v1/kiosk/** (`git mv` ทั้ง dir: bootstrap, devices/**, kiosk/* → ระดับบนของ kiosk/ — รวม server.test.ts ทุกไฟล์) · ลบ `scanner/draft/**` (legacy `410`)
  - frontend/src/lib/features/kiosk/data/{kiosk-check-in,kiosk-config,kiosk-face,kiosk-hardware,kiosk-print,kiosk-staff-pin,kiosk-thaid}.api.ts (+ kiosk-config.api.test.ts, kiosk-thaid.api.test.ts)
  - frontend/src/lib/features/kiosk-devices/{data/scanner.api.ts,data/scanner.api.test.ts,domain/scanner.schema.ts (JSDoc)} · frontend/src/lib/server/thaid-oauth.test.ts · frontend/scripts/mock-kiosk-family.ts
  - kiosk/app/manager.py (`KIOSK_*_PATH`, bootstrap URL, `allowed_paths` ของ `_route_kiosk_api`, glob `context.route`) · kiosk/tests/test_manager.py · kiosk/README.md (directory เดิม `scanner_client/` — เปลี่ยนชื่อใน f80bbeb9)
  - docs/data/schema.md §3.11 (คำอธิบาย `staff_pin_updated_by`, การแก้ชื่อ/สถานะเครื่องย้ายไปฝั่ง server) — ไม่เปลี่ยนรูปร่าง doc, ไม่ bump schema_v
  - docs/data/schema.md §3.11.1 (คำอธิบาย `scanner_staff_pin.updated_by` = SA หรือ SM) — ไม่เปลี่ยนรูปร่าง doc, ไม่ bump schema_v
  - frontend/src/lib/auth/roles.ts (+ role `kiosk_staff` ใน `STAFF_CAPABILITIES` · `SCANNER_MANAGER_CAPABILITIES` = `shelter_manager` + `kiosk_staff` · helper สิทธิ์ตาม capability + ศูนย์)
  - frontend/src/lib/guards/auth.ts (+ `requireKioskManagement` ให้ SA / SM / `kiosk_staff` ของศูนย์ที่เลือกอยู่เข้าหน้าได้ — `requireManager` เดิมไม่รู้จัก `kiosk_staff` · + `confineKioskStaffOnly` สำหรับ back-office layout)
  - frontend/src/routes/(protected)/back-office/+layout.ts (ผู้ใช้ที่มีแค่ `kiosk_staff` ในศูนย์ที่เลือกอยู่ เข้าได้เฉพาะหน้า kiosk — FR-SBO-29)
  - frontend/src/lib/features/users/** (grant / revoke `{code}:kiosk_staff` ในหน้าจัดการผู้ใช้เดิม)
  - frontend/src/lib/server/shelter-capability-access.ts (ใหม่ — resolve ผู้เรียก back-office ตาม capability + ศูนย์)
  - frontend/src/lib/server/scanners/{staff-pin-http.ts,device-repository.ts}
  - frontend/src/routes/api/v1/scanner/devices/{+server.ts,[id]/+server.ts,[id]/staff-pin/+server.ts,[id]/staff-pin/reveal/+server.ts}
  - frontend/src/lib/features/scanners/** → frontend/src/lib/features/kiosk-devices/** (`git mv` ทั้ง feature · barrel `$lib/features/kiosk-devices` · ชื่อไฟล์ / ชื่อ export ภายในคงเดิม)
  - frontend/src/lib/features/kiosk-devices/{data/scanner.api.ts,data/scanner.remote.ts,application/queries.ts,ui/create-scanner-dialog.svelte,ui/scanner-list.svelte,ui/delete-scanner-dialog.svelte (ใหม่ — confirm dialog ก่อนลบ),index.ts}
  - frontend/src/routes/(protected)/back-office/kiosks/** (ใหม่)
  - frontend/src/lib/features/portal/** (tile「จัดการ Kiosk」→ `/back-office/kiosks` สำหรับ SA / SM / `kiosk_staff`) · frontend/src/lib/features/users/ui/user-form.svelte (ตัวเลือก role `kiosk_staff`)
  - frontend/src/routes/(protected)/system-management/scanners/** (เปลี่ยนเป็น redirect)
  - frontend/src/lib/components/{backoffice-navbar/static.ts,backoffice-navbar.svelte,system-management-navbar/static.ts}
  - frontend/src/lib/components/shelter-scope-select.svelte (ใหม่ — ตัวเลือกศูนย์ตาม scope · หน้า scanners ใช้แสดงศูนย์แบบ read-only ใน dialog สร้างเครื่องเท่านั้น)
  - tests — frontend/src/routes/api/v1/kiosk/devices/{server.test.ts,[id]/server.test.ts,[id]/staff-pin/server.test.ts,[id]/staff-pin/reveal/server.test.ts} (AC-SBO-04/06/07/08/11/16)
  - tests — frontend/src/lib/features/kiosk-devices/data/{scanner.api.test.ts,scanner.remote.test.ts} · frontend/src/lib/server/scanners/device-repository.test.ts · frontend/src/lib/auth/roles.test.ts
  - tests — frontend/src/lib/server/shelter-capability-access.test.ts (ใหม่)
why: ปัจจุบันการจัดการเครื่องทำได้เฉพาะ SA ที่ส่วนกลาง ศูนย์ต้องรอส่วนกลางทุกครั้งที่ตั้งเครื่องใหม่ เปลี่ยน PIN หรือปิดเครื่อง · ให้ศูนย์ดูแลตู้ของตัวเองได้ใน back-office และมอบงานนี้ให้เจ้าหน้าที่ดูแลตู้ (`kiosk_staff`) ได้โดยไม่ต้องให้สิทธิ์ผู้จัดการศูนย์ทั้งหมด
migration: ไม่เปลี่ยนรูปร่าง doc `scanner_device` / `scanner_staff_pin` · ไม่ bump schema_v · ไม่ต้อง backfill · **ตัดทันที** — deploy server กับอัปเดต kiosk client ทุกเครื่องในรอบเดียวกัน ไม่มี alias path เดิม (§6)
---

# Draft CR: ย้ายการจัดการเครื่องสแกน/Kiosk ไป Back Office

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** หน้าจัดการเครื่องสแกน/Kiosk ย้ายจาก `/system-management/scanners` (SA เท่านั้น) ไป `/back-office/kiosks` · `system_admin` จัดการได้ทุกศูนย์ · `shelter_manager` และ role ใหม่ `kiosk_staff` ดูและจัดการได้**ทุก action** (สร้าง, แก้ไข, เปิดปิด, ลบ, ตั้ง/สุ่ม/ดู staff PIN) เฉพาะเครื่องของศูนย์ที่ตัวเองมี role นั้น · ลบต้องผ่าน confirm dialog
> - **เพื่อใคร/ทำไม:** ให้ศูนย์ดูแลตู้ของตัวเองได้ใน back-office ไม่ต้องรอส่วนกลาง และมอบงานดูแลตู้ให้ `kiosk_staff` ได้โดยไม่ต้องเป็นผู้จัดการศูนย์
> - **ตกลงกับ Team Lead แล้ว (2026-10-12):** ใช้ role `kiosk_staff` แทน `banner_staff` ของ CR-162 — `kiosk_staff` ได้สิทธิ์หน้าแบนเนอร์แทน และใช้ช่องบทบาทที่ 11 เดิม ไม่เพิ่มบทบาทที่ 12 (§3.6) · ฟีเจอร์ Kiosk Banner เองยังเป็นของ CR-162 (ดู §7)
> - **Dev ต้อง build:** role ใหม่ `kiosk_staff` + guard หน้าที่ยอม role นี้ · เมนูแม่「จัดการ Kiosk」ใน back-office + ลูก「จัดการอุปกรณ์」· ทุก role (SA และ SM) ใช้ศูนย์ที่เลือกอยู่ (active shelter) — หน้าไม่มีตัวเลือกศูนย์ · guard สิทธิ์ SA/SM-scope ฝั่ง server ให้ทุก admin endpoint ของ scanner · `GET` (list ตาม scope) และ `PATCH` (แก้ชื่อ/จุดบริการ/สถานะ) ใหม่ — browser เลิกอ่าน/เขียน `scanner_device` ใน `registry` ตรง · หน้า back-office + เมนู · URL เดิม redirect
> - **ชื่อหน้า / feature:** หน้า `/back-office/kiosks` · feature `$lib/features/scanners` → `$lib/features/kiosk-devices` (ไม่ใช้ `kiosks` เพราะชนกับ `$lib/features/kiosk` ที่เป็นหน้าตู้)
> - **ย้าย API path:** `/api/v1/scanner/*` ทั้งหมด → `/api/v1/kiosk/*` (`/api/v1/scanner/kiosk/x` → `/api/v1/kiosk/x`, `/api/v1/scanner/devices` → `/api/v1/kiosk/devices` ฯลฯ ตาม §2.4) · body / response / auth ไม่เปลี่ยน · **ตัดทันที** ไม่มี alias path เดิม — deploy server กับ kiosk client ทุกเครื่องพร้อมกัน
> - **กระทบ schema/scope:** เปลี่ยน role/permission (SA-only → SA + SM / `kiosk_staff` scope) · role ใหม่ `kiosk_staff` (compound `{code}:kiosk_staff`) · ไม่เปลี่ยนรูปร่าง doc · ไม่ bump `schema_v` · device auth ของ kiosk และ `scanner_secrets` (admin-only) ไม่เปลี่ยน · kiosk client เปลี่ยนเฉพาะ path

---

## 1. Why

1. **ให้คนที่ดูแลตู้จัดการได้เอง:** ผู้ดูแลศูนย์ไม่เห็นว่าศูนย์ตัวเองมีตู้กี่เครื่อง ตู้ไหนเปิดอยู่ และตั้งตู้ใหม่ไม่ได้ เพราะการจัดการเครื่องอยู่ใน system-management ที่ SA เท่านั้นเข้าได้ · งานดูแลตู้ (ตั้งเครื่อง เปลี่ยน PIN ปิดเครื่องเสีย) เป็นงานหน้างานที่ไม่จำเป็นต้องเป็นผู้จัดการศูนย์ จึงเพิ่ม role `kiosk_staff` ให้ SM มอบงานนี้ได้
2. **งานของศูนย์:** การตั้งตู้ใหม่ ปิดเครื่องที่เสีย และเปลี่ยน staff PIN เมื่อเจ้าหน้าที่หน้าตู้เปลี่ยน เป็นงานหน้างานของศูนย์ (CR-158 กำหนดให้ PIN ผูกกับเครื่องเพราะแต่ละจุดตั้งตู้มีเจ้าหน้าที่ต่างกัน) การผูกงานนี้ไว้กับ SA ทำให้ศูนย์ต้องรอส่วนกลาง
3. **ปิดช่อง browser เขียน/อ่าน registry ตรง:** เดิม browser อ่าน `scanner_device` ทุกศูนย์จาก `registry` แล้วกรองฝั่ง client และแก้สถานะเครื่องด้วยการ `PUT` ตรง ซึ่ง VDU ของ `registry` อนุญาตเฉพาะ SA — ถ้า SM / `kiosk_staff` ใช้หน้าเดิม การแก้สถานะจะถูกปฏิเสธ และรายการจะไม่ถูกจำกัดตามศูนย์ จึงต้องย้าย list/update ไปฝั่ง server
4. **ชื่อ API ตรงกับระบบที่ใช้:** endpoint ทั้งหมดใต้ `/api/v1/scanner/*` ให้บริการตู้ Kiosk และการจัดการตู้ · client เปลี่ยนชื่อจาก `scanner_client/` เป็น `kiosk/` แล้ว (f80bbeb9) · path `/api/v1/scanner/kiosk/*` มีชื่อซ้อนสองชั้น · CR นี้เพิ่ม endpoint ใหม่ใต้ `devices` อยู่แล้ว จึงย้ายรอบเดียวกันก่อนมี endpoint เพิ่ม (banner ของ CR-162 ยังไม่ build)

## 2. Change

### 2.1 สิทธิ์

| Action | before | after |
| --- | --- | --- |
| ดูรายการเครื่อง | SA (browser อ่าน `registry` ทุกศูนย์) | SA, SM และ `kiosk_staff`: เฉพาะเครื่องของศูนย์ที่เลือกอยู่ (active shelter) — SM / `kiosk_staff` ต้องมี role นั้นในศูนย์นั้น · ดูศูนย์อื่นต้องสลับศูนย์ (SA สลับได้ทุกศูนย์) |
| สร้างเครื่อง (ได้ device secret + default PIN) | SA | SA, SM และ `kiosk_staff`: ศูนย์ที่เลือกอยู่ (active shelter) — SM / `kiosk_staff` ต้องมี role นั้นในศูนย์นั้น · SA สลับศูนย์ได้ทุกศูนย์ |
| แก้ชื่อ / จุดบริการ / เปิดปิดเครื่อง | SA (browser `PUT` ตรง) | SA ทุกเครื่อง · SM / `kiosk_staff` เครื่องในศูนย์ตัวเอง — ผ่าน server |
| ลบเครื่อง | SA | SA · SM / `kiosk_staff` เครื่องในศูนย์ตัวเอง · ทุก role ต้องผ่าน confirm dialog |
| ตั้ง / สุ่ม staff PIN | SA | SA · SM / `kiosk_staff` เครื่องในศูนย์ตัวเอง |
| ดู staff PIN (reveal) | SA | SA · SM / `kiosk_staff` เครื่องในศูนย์ตัวเอง |
| role อื่น (registration_staff, kitchen_staff, …) | ไม่มีสิทธิ์ | ไม่มีสิทธิ์ (เหมือนเดิม) |

"SM ของศูนย์ X" = `isShelterManager(roles, X)` (รองรับ compound role `{X}:shelter_manager` ตาม CR-093) ไม่ใช่แค่มี `shelter:X` · "`kiosk_staff` ของศูนย์ X" = มี `{X}:kiosk_staff` · สองกลุ่มนี้มีสิทธิ์กับเครื่องเท่ากันทุก action

### 2.2 หน้าจอ

| | before | after |
| --- | --- | --- |
| หน้าจัดการ | `/system-management/scanners` (layout `requireAdmin`) | `/back-office/kiosks` (guard SA / SM / `kiosk_staff` ของศูนย์ที่เลือกอยู่) |
| เมนู | System Management กลุ่มแรก「เครื่องสแกนบัตร (Scanners)」 | Back Office กลุ่ม「4. ตั้งค่าระบบ」→ เมนูแม่「จัดการ Kiosk」→ เมนูลูก「จัดการอุปกรณ์」(`/back-office/kiosks`) — ลบเมนูเครื่องสแกนออกจาก System Management |
| เลือกศูนย์ | dialog สร้างเครื่องเลือกได้ทุกศูนย์ | ไม่มีตัวเลือกศูนย์ในหน้าทุก role — รายการและ dialog สร้างเครื่องใช้ศูนย์ที่เลือกอยู่ (active shelter) เหมือนหน้า back-office อื่น |
| URL เดิม | — | `/system-management/scanners` → `302` ไป `/back-office/kiosks` |

### 2.3 API

| Endpoint | before | after |
| --- | --- | --- |
| `GET /api/v1/kiosk/devices` | ไม่มี | **ใหม่** — คืน `ScannerDeviceSummary[]` · SA ทุกศูนย์ หรือกรองด้วย `?shelter_code=` · SM / `kiosk_staff` ต้องส่ง `?shelter_code=` ของศูนย์ที่เลือกอยู่ |
| `PATCH /api/v1/kiosk/devices/[id]` | ไม่มี (browser `PUT` registry ตรง) | **ใหม่** — แก้ `name`, `station_name`, `status` |
| `POST /api/v1/kiosk/devices` | SA | SA + SM / `kiosk_staff` scope |
| `DELETE /api/v1/kiosk/devices/[id]` | SA | SA + SM / `kiosk_staff` scope |
| `POST /api/v1/kiosk/devices/[id]/staff-pin` | SA | SA + SM / `kiosk_staff` scope |
| `POST /api/v1/kiosk/devices/[id]/staff-pin/reveal` | SA | SA + SM / `kiosk_staff` scope |
| endpoint device credential (`bootstrap` และของตู้ใน §2.4) | device credential | สิทธิ์ไม่เปลี่ยน · เปลี่ยนเฉพาะ path |

path ในตารางนี้เป็น path หลังย้าย (§2.4) · path เดิมของแถว `POST` / `DELETE` / `staff-pin` คือ `/api/v1/scanner/devices/**`

### 2.4 API path — `/api/v1/scanner/*` → `/api/v1/kiosk/*`

| before | after | auth | หมายเหตุ |
| --- | --- | --- | --- |
| `POST /api/v1/scanner/bootstrap` | `POST /api/v1/kiosk/bootstrap` | device credential | kiosk client เรียกตรงก่อนเปิด browser |
| `POST /api/v1/scanner/draft` | **ลบ** — ไม่มี `/api/v1/kiosk/draft` | — | legacy ปิดแล้ว ตอบ `410` ตั้งแต่ CR-151 และไม่มีผู้เรียก (FR-SBO-37) |
| `/api/v1/scanner/devices/**` | `/api/v1/kiosk/devices/**` | `_session` | admin endpoint ตาม §2.3 |
| `POST /api/v1/scanner/kiosk/config` | `POST /api/v1/kiosk/config` | device credential | CR-152 |
| `POST /api/v1/scanner/kiosk/lookup` | `POST /api/v1/kiosk/lookup` | device credential | CR-151 / CR-163 |
| `POST /api/v1/scanner/kiosk/check-in` | `POST /api/v1/kiosk/check-in` | device credential | CR-151 / CR-163 |
| `POST /api/v1/scanner/kiosk/register` | `POST /api/v1/kiosk/register` | device credential | CR-149 |
| `POST /api/v1/scanner/kiosk/staff-pin/verify` | `POST /api/v1/kiosk/staff-pin/verify` | device credential | CR-158 |
| `POST /api/v1/scanner/kiosk/thaid/session{,/status,/cancel}` | `POST /api/v1/kiosk/thaid/session{,/status,/cancel}` | device credential | CR-163 |
| `POST /api/v1/scanner/kiosk/banners` · `GET …/banners/{id}/image` | `POST /api/v1/kiosk/banners` · `GET /api/v1/kiosk/banners/{id}/image` | device credential · signed URL | CR-162 — ยังไม่ build · build ที่ path ใหม่เลย |
| `POST /api/v1/scanner/kiosk/{print,hardware,face/*}` | `POST /api/v1/kiosk/{print,hardware,face/*}` | — | local-only: kiosk client ตอบเองใน browser ของตู้ ไม่ส่งต่อไป server |

**ไม่เปลี่ยน:** body / response / error code / header ของทุก endpoint · ชื่อ doc / DB `scanner_device`, `scanner_secrets`, `scanner_staff_pin` · `client_version` default `scanner-client` ที่ kiosk client รายงาน · `GET /api/v1/auth/oauth/thaid/start?mode=kiosk_check_in` (อยู่ใต้ `auth`)

## 3. Requirements

### 3.1 Server — สิทธิ์

| ID | Requirement |
| --- | --- |
| FR-SBO-01 | ทุก admin endpoint ของ scanner (§2.3 ยกเว้นแถว kiosk) ต้องยืนยัน `_session` cookie · ไม่ login → `401 UNAUTHENTICATED` · ไม่ใช่ SA และไม่ใช่ SM หรือ `kiosk_staff` ของศูนย์ใดเลย → `403 FORBIDDEN` |
| FR-SBO-02 | SA ทำทุก action กับเครื่องของทุกศูนย์ได้ |
| FR-SBO-03 | SM และ `kiosk_staff` ทำทุก action กับเครื่องได้ (รวมลบและ reveal PIN) เมื่อ `isShelterManager(roles, device.shelter_code)` เป็นจริง หรือมี `{device.shelter_code}:kiosk_staff` |
| FR-SBO-04 | endpoint ที่มี `[id]` (`PATCH`, `DELETE`, `staff-pin`, `staff-pin/reveal`) เมื่อ SM / `kiosk_staff` เรียกกับเครื่องของศูนย์ที่ตัวเองไม่มี role นั้น → ตอบ `404 NOT_FOUND` เหมือนไม่พบเครื่อง (ไม่เปิดเผยว่ามี `device_id` นั้นในศูนย์อื่น) · server อ่าน registry doc ได้เพื่อตรวจ `shelter_code` เท่านั้น — ต้องไม่เขียน `registry` และต้องไม่อ่าน/เขียน `scanner_secrets` |
| FR-SBO-05 | `POST /api/v1/kiosk/devices` เมื่อ SM / `kiosk_staff` ส่ง `shelter_code` ของศูนย์ที่ตัวเองไม่มี role นั้น → `403 FORBIDDEN` และไม่สร้าง doc ใด ๆ |
| FR-SBO-06 | endpoint ที่มี `[id]` ตรวจสิทธิ์จาก `shelter_code` ใน registry doc ที่อ่านฝั่ง server เท่านั้น — ไม่เชื่อ `shelter_code` จาก body/query · `POST` ตรวจ `shelter_code` จาก body ตาม FR-SBO-05 |
| FR-SBO-07 | log ทุก action ที่เขียนหรือ reveal ต้องมี `device`, `shelter`, `by`, `at` · ห้าม log ค่า PIN หรือ device secret (เหมือน CR-158) |
| FR-SBO-08 | การตั้ง / สุ่ม PIN และการสร้างเครื่องบันทึก `staff_pin_updated_by` (registry) และ `updated_by` ของ `scanner_staff_pin` (`scanner_secrets`) = `_users` name ของผู้เรียกจริง (SA, SM หรือ `kiosk_staff`) |

### 3.2 Server — endpoint ใหม่

| ID | Requirement |
| --- | --- |
| FR-SBO-10 | `GET /api/v1/kiosk/devices` คืน `200 ScannerDeviceSummary[]` · SA ไม่ส่ง `shelter_code` → ได้ทุกเครื่อง · SM / `kiosk_staff` ต้องส่ง `?shelter_code=` (client ส่งศูนย์ที่เลือกอยู่ — active shelter) ไม่ส่ง → `400 VALIDATION` · ไม่มี mode รวมหลายศูนย์สำหรับ SM / `kiosk_staff` |
| FR-SBO-11 | `GET /api/v1/kiosk/devices?shelter_code=XXX` คืนเฉพาะเครื่องของศูนย์นั้น · SA ขอได้ทุกศูนย์ · SM / `kiosk_staff` ขอศูนย์ที่ตัวเองไม่มี role นั้น → `403 FORBIDDEN` (เหมือน `POST` นอก scope ใน FR-SBO-05 — ผู้เรียกเป็นคนระบุศูนย์ จึงไม่มีข้อมูลรั่ว) |
| FR-SBO-12 | response ของ `GET` ห้ามมี `secret_hash`, `secret_prefix`, `_rev` หรือค่า PIN (ใช้ `toScannerDeviceSummary` เดิม) · ตอบด้วย `cache-control: no-store` |
| FR-SBO-13 | `PATCH /api/v1/kiosk/devices/[id]` (`[id]` = `device_id` เช่น `kiosk-01` ไม่ใช่ CouchDB `_id` — เหมือน endpoint `[id]` อื่นใน api-contract.md §2.2) รับ body strict `{ name?, station_name?, status? }` อย่างน้อย 1 key · validate ด้วย rule เดียวกับ `scannerDeviceInputSchema` · `status` รับเฉพาะ `active` \| `inactive` (enum ตาม schema.md §3.11 / `deviceStatusSchema`) · key อื่น (รวม `shelter_code`, `device_id`, `staff_pin_*`, `secret_*`) → `400 VALIDATION` |
| FR-SBO-14 | `PATCH` เขียนด้วย admin credential ฝั่ง server, คง field อื่นของ doc เดิมทั้งหมด (รวม `staff_pin_*`, `secret_hash`, `schema_v`), อัปเดต `updated_at` · `_rev` ชน (เช่น kiosk เขียน `last_seen_at` ระหว่างนั้น) → อ่าน doc ล่าสุดแล้ว apply patch ซ้ำ สูงสุด 3 ครั้ง (เหมือน `METADATA_WRITE_ATTEMPTS` ของ staff PIN metadata) ยังชน → `409 CONFLICT` · สำเร็จ → `200 ScannerDeviceSummary` |
| FR-SBO-15 | การย้ายเครื่องไปศูนย์อื่นทำไม่ได้ผ่าน `PATCH` — ต้องลบแล้วสร้างใหม่ (ได้ secret และ PIN ใหม่) |

### 3.3 Client

| ID | Requirement |
| --- | --- |
| FR-SBO-20 | หน้า `/back-office/kiosks` ใช้ guard `requireKioskManagement` (ใหม่ใน `$lib/guards/auth.ts`) ที่ยอม SA หรือ SM / `kiosk_staff` ของศูนย์ที่เลือกอยู่ (`requireManager` เดิมไม่รู้จัก `kiosk_staff`) · ผู้ใช้ที่มี role นี้ในศูนย์อื่นแต่ไม่มีในศูนย์ที่เลือกอยู่ → redirect (ต้องสลับศูนย์ก่อน) |
| FR-SBO-21 | feature `kiosk-devices` ต้องอ่านรายการผ่าน `GET /api/v1/kiosk/devices` และแก้ไขผ่าน `PATCH` เท่านั้น — ไม่มี code path ใดใน browser ที่อ่าน/เขียน `scanner_device` จาก `registry` ตรง |
| FR-SBO-22 | dialog สร้างเครื่อง: ทุก role (SA, SM, `kiosk_staff`) ใช้ศูนย์ที่เลือกอยู่ (active shelter) แสดงเป็นค่าคงที่ เลือกไม่ได้ |
| FR-SBO-23 | รายการแสดงคอลัมน์ศูนย์ทุก role · action ทั้งหมด (ดู secret ที่เพิ่งสร้าง, ตั้ง/ดู PIN, เปิดปิด, ลบ) แสดงเหมือนกันสำหรับ SA, SM และ `kiosk_staff` |
| FR-SBO-24 | back-office navbar กลุ่ม「4. ตั้งค่าระบบ」เพิ่มเมนูแม่「จัดการ Kiosk」และเมนูลูก「จัดการอุปกรณ์」→ `/back-office/kiosks` · ลบเมนูเครื่องสแกนเดิมออกจาก system-management navbar |
| FR-SBO-25 | `/system-management/scanners` redirect `302` ไป `/back-office/kiosks` |
| FR-SBO-26 | เมนูลูกใน back-office navbar กำหนดการแสดงผลได้ตาม capability ในศูนย์ (ไม่จำกัดแค่ SA / SM) · เมนูแม่แสดงเมื่อมีเมนูลูกอย่างน้อย 1 รายการที่ผู้ใช้เห็น ·「จัดการอุปกรณ์」เห็นเฉพาะ SA, SM และ `kiosk_staff` |
| FR-SBO-27 | หน้า `/back-office/kiosks` ไม่มีตัวกรองศูนย์ทุก role (รวม SA) · รายการเป็นของศูนย์ที่เลือกอยู่ (active shelter) เสมอ — client ส่ง `?shelter_code=` ทุกครั้ง และเปลี่ยนตามเมื่อสลับศูนย์ · SA ดูศูนย์อื่นด้วยการสลับศูนย์ |

### 3.4 Role `kiosk_staff`

| ID | Requirement |
| --- | --- |
| FR-SBO-28 | เพิ่ม role `kiosk_staff` ใน `roles.ts` (`KIOSK_STAFF`, อยู่ใน `STAFF_CAPABILITIES`) รูปแบบ compound `{shelter_code}:kiosk_staff` คู่กับ `shelter:{code}` · `SCANNER_MANAGER_CAPABILITIES` = `shelter_manager` + `kiosk_staff` · SA และ SM ของศูนย์นั้น grant / revoke ได้ผ่านหน้าจัดการผู้ใช้เดิม |
| FR-SBO-29 | `kiosk_staff` เห็นเฉพาะเมนูแม่「จัดการ Kiosk」ใน back-office และไม่ได้สิทธิ์อื่นของศูนย์ |
| FR-SBO-30 | ลบเครื่อง: ทุก role ต้องผ่าน confirm dialog (ไม่ใช่ `window.confirm`) ที่ผูกกับเครื่องรายการนั้น แสดงชื่อและ `device_id` และบอกว่าลบแล้วย้อนกลับไม่ได้ (ตู้ใช้งานไม่ได้ทันที ต้องสร้างเครื่องใหม่ + ตั้ง secret ใหม่) · กดยกเลิก → ไม่ส่ง `DELETE` |

### 3.5 API path `/api/v1/kiosk/*`

| ID | Requirement |
| --- | --- |
| FR-SBO-31 | ย้าย route ทุกตัวใต้ `frontend/src/routes/api/v1/scanner/` ไป `frontend/src/routes/api/v1/kiosk/` ตาม §2.4 (`scanner/kiosk/<x>` → `kiosk/<x>`, `scanner/<x>` → `kiosk/<x>`) ยกเว้น `draft` ที่ลบ (FR-SBO-37) · handler, body, response, error code และ header ไม่เปลี่ยน |
| FR-SBO-32 | หลัง deploy ไม่มี route ใดใต้ `/api/v1/scanner/` เหลืออยู่ — ไม่มี alias, redirect หรือ proxy จาก path เดิม (request ไป path เดิมได้ `404` ของ SvelteKit) |
| FR-SBO-33 | client ฝั่ง browser (feature `kiosk`, feature `kiosk-devices`) เรียกเฉพาะ path ใหม่ · ไม่มีสตริง `/api/v1/scanner/` เหลือใน `frontend/src` และ `frontend/scripts` |
| FR-SBO-34 | kiosk client เรียก bootstrap ที่ `POST /api/v1/kiosk/bootstrap` · route ของ browser ดัก `**/api/v1/kiosk/**` · `allowed_paths` (แนบ `X-Device-ID` / `X-Device-Secret`) = 8 path ของตู้ใน §2.4 (`config`, `lookup`, `check-in`, `register`, `staff-pin/verify`, `thaid/session`, `thaid/session/status`, `thaid/session/cancel`) ที่ path ใหม่ · path local-only (`print`, `hardware`, `face/*`) ใช้ path ใหม่ |
| FR-SBO-35 | kiosk client ต้องไม่แนบ device credential ให้ path ใต้ `/api/v1/kiosk/` ที่ไม่อยู่ใน `allowed_paths` (รวม `devices/**` และ `bootstrap`) — ลบ header เดิมแล้วส่งต่อเหมือนพฤติกรรมเดิมของ path นอก allowlist · กฎ same-origin + `POST` เดิมคงไว้ |
| FR-SBO-36 | banner ของ CR-162 build ที่ `POST /api/v1/kiosk/banners` และ `GET /api/v1/kiosk/banners/{id}/image` · `image_url` ใน response ใช้ path ใหม่ · เพิ่ม `/api/v1/kiosk/banners` ใน `allowed_paths` เมื่อ build |
| FR-SBO-37 | ลบ `POST /api/v1/scanner/draft` (legacy ตอบ `410` ตั้งแต่ CR-151) ทั้ง route และ test · ไม่สร้าง `/api/v1/kiosk/draft` · request ไป path ใด ๆ ของ draft ได้ `404` |
| FR-SBO-38 | ย้าย feature `frontend/src/lib/features/scanners/` → `frontend/src/lib/features/kiosk-devices/` (`git mv`) · ทุกที่ import ผ่าน barrel `$lib/features/kiosk-devices` · ชื่อไฟล์ / ชื่อ export ภายใน (`scanner.api.ts`, `ScannerDevice`, …) คงเดิม · ไม่มีสตริง `$lib/features/scanners` เหลือใน `frontend/src` |

### 3.6 `kiosk_staff` แทน `banner_staff` (CR-162)

| ID | Requirement |
| --- | --- |
| FR-SBO-39 | ไม่เพิ่ม `banner_staff` ใน `roles.ts` · ทุกข้อของ CR-162 ที่อ้าง `banner_staff` (FR-KBN-24, FR-KBN-26, FR-KBN-27) ให้อ่านเป็น `kiosk_staff` |
| FR-SBO-40 | `kiosk_staff` ของศูนย์ X จัดการ banner ได้ตาม FR-KBN-24 (อ่าน / สร้าง / แก้ / เปิดปิด / ลบ เฉพาะ banner ที่ `shelter_codes` ทั้งหมดอยู่ใน scope) — สิทธิ์เท่า `banner_staff` เดิม |
| FR-SBO-41 | role taxonomy คง 11 บทบาท: `kiosk_staff` (ตัวย่อ **KIO**) อยู่ช่องบทบาทที่ 11 แทน **BAN** · ขอบเขต = ดูแลตู้ Kiosk ของศูนย์ตัวเอง (เครื่อง + staff PIN ตาม CR นี้ และแบนเนอร์ตาม CR-162) · ไม่ได้สิทธิ์อื่นของศูนย์ |
| FR-SBO-42 | เมนูแบนเนอร์ของ CR-162 (เมื่อ build) อยู่ใต้เมนูแม่「จัดการ Kiosk」คู่กับ「จัดการอุปกรณ์」· เห็นเฉพาะ SA, SM และ `kiosk_staff` · FR-KBN-27 (`banner_staff` เห็นเฉพาะเมนูแบนเนอร์) ถูกแทนด้วย FR-SBO-29 |

## 4. Acceptance criteria

| ID | Scenario | ผลที่คาด | FR |
| --- | --- | --- | --- |
| AC-SBO-01 | SM ศูนย์ A เปิด `/back-office/kiosks` | เห็นเฉพาะเครื่องของ A | 10, 20 |
| AC-SBO-02 | SA เลือกศูนย์ A อยู่ แล้วเปิด `/back-office/kiosks` | เห็นเฉพาะเครื่องของ A · ไม่มีตัวกรองศูนย์ในหน้า | 02, 10, 27 |
| AC-SBO-03 | SM ศูนย์ A สร้างเครื่องให้ A | `201` ได้ device secret + default PIN · kiosk bootstrap ด้วย secret นั้นได้ | 03, 22 |
| AC-SBO-04 | SM ศูนย์ A ยิง `POST devices` ด้วย `shelter_code: B` | `403` · ไม่มี doc ใหม่ใน `registry` / `scanner_secrets` | 05 |
| AC-SBO-05 | SM ศูนย์ A เปิดปิด / ลบ / ตั้ง PIN / reveal PIN เครื่องของ A | สำเร็จ · log มี `by` = SM · หลังตั้ง PIN `staff_pin_updated_by` = SM | 03, 07, 08 |
| AC-SBO-06 | SM ศูนย์ A ยิง `PATCH`/`DELETE`/`staff-pin`/`reveal` กับเครื่องของ B | `404` · เครื่องของ B ไม่เปลี่ยน | 04 |
| AC-SBO-07 | registration_staff ศูนย์ A ยิงทุก admin endpoint | `403` · เปิดหน้า `/back-office/kiosks` ถูก redirect | 01, 20 |
| AC-SBO-08 | `PATCH` body `{ shelter_code: "B" }` หรือ `{ staff_pin_set: false }` | `400` · doc ไม่เปลี่ยน | 13, 15 |
| AC-SBO-09 | `PATCH { status: "inactive" }` | `staff_pin_*`, `secret_hash` คงเดิม · kiosk ของเครื่องนั้น auth ไม่ผ่าน (พฤติกรรม inactive เดิม) | 14 |
| AC-SBO-10 | เปิด `/system-management/scanners` | ไปที่ `/back-office/kiosks` | 25 |
| AC-SBO-11 | ไม่ login ยิงทุก admin endpoint | `401` | 01 |
| AC-SBO-12 | SM เปิด back-office | เห็นเมนูแม่「จัดการ Kiosk」และเมนูลูก「จัดการอุปกรณ์」· registration_staff ไม่เห็นเมนูแม่ | 24, 26 |
| AC-SBO-13 | SA สลับศูนย์จาก A ไป B (ตัวสลับศูนย์ของ back-office) | รายการเปลี่ยนเป็นเครื่องของ B · dialog สร้างเครื่องล็อกศูนย์ B · SA และ SM ไม่เห็นตัวกรองศูนย์ในหน้า | 22, 27 |
| AC-SBO-14 | ผู้ใช้เป็น SM ทั้งศูนย์ A และ B เลือกศูนย์ A อยู่ แล้วสลับไป B | ก่อนสลับเห็นเฉพาะเครื่องของ A · หลังสลับเห็นเฉพาะเครื่องของ B · dialog สร้างเครื่องล็อกศูนย์ตามศูนย์ที่เลือก | 10, 22, 27 |
| AC-SBO-15 | ผู้ใช้เป็น SM ศูนย์ A และ registration_staff ศูนย์ B เลือกศูนย์ B อยู่ แล้วเปิด `/back-office/kiosks` | redirect ตาม guard · สลับไปศูนย์ A แล้วเข้าได้ | 20 |
| AC-SBO-16 | SM ยิง `GET devices` โดยไม่ส่ง `shelter_code` | `400` | 10 |
| AC-SBO-17 | SM ศูนย์ A ยิง `GET devices?shelter_code=B` | `403` | 11 |
| AC-SBO-18 | `PATCH` ขณะ `_rev` ของ doc เปลี่ยนจาก kiosk เขียน `last_seen_at` | สำเร็จหลัง retry · `name`/`status` ใหม่ และ `last_seen_at` ล่าสุดคงอยู่ · ชนครบ 3 ครั้ง → `409` | 14 |
| AC-SBO-19 | `kiosk_staff` ศูนย์ A (เลือกศูนย์ A อยู่) เปิด `/back-office/kiosks` แล้วสร้าง / แก้ / เปิดปิด / ตั้ง PIN / reveal PIN / ลบเครื่องของ A | สำเร็จทุก action · log มี `by` = ผู้ใช้ `kiosk_staff` · หลังตั้ง PIN `staff_pin_updated_by` = ผู้ใช้นั้น | 03, 07, 08, 20, 28 |
| AC-SBO-20 | `kiosk_staff` ศูนย์ A ยิง `PATCH`/`DELETE`/`staff-pin`/`reveal` กับเครื่องของ B · `POST` ด้วย `shelter_code: B` · `GET ?shelter_code=B` | `404` · `403` · `403` · เครื่องของ B ไม่เปลี่ยน | 04, 05, 11 |
| AC-SBO-21 | `kiosk_staff` ศูนย์ A เปิด back-office | เห็นเฉพาะเมนูแม่「จัดการ Kiosk」และ「จัดการอุปกรณ์」· หน้า back-office อื่นเข้าไม่ได้ | 26, 29 |
| AC-SBO-22 | กดลบเครื่อง (SA / SM / `kiosk_staff`) | ขึ้น confirm dialog ระบุชื่อ + `device_id` · กดยกเลิก → ไม่ส่ง `DELETE` · กดยืนยัน → ลบ | 30 |
| AC-SBO-23 | SM ศูนย์ A grant `A:kiosk_staff` ให้ผู้ใช้ · grant `B:kiosk_staff` | สำเร็จ · ไม่ได้ | 28 |
| AC-SBO-24 | ตู้ที่อัปเดต kiosk client แล้วเริ่มเครื่อง → bootstrap → โหลด config → lookup / check-in ด้วย QR, เบอร์โทร, บัตร, ThaiD → walk-in register → staff PIN → พิมพ์ใบ | ทุกขั้นสำเร็จที่ path `/api/v1/kiosk/*` | 31, 34 |
| AC-SBO-25 | `POST /api/v1/scanner/kiosk/config` หรือ `POST /api/v1/scanner/bootstrap` ด้วย device credential ที่ถูกต้อง | `404` | 32 |
| AC-SBO-26 | browser ของตู้ส่ง `POST /api/v1/kiosk/devices` (same-origin) | request ไป server โดยไม่มี `X-Device-ID` / `X-Device-Secret` | 35 |
| AC-SBO-27 | `grep -rn "/api/v1/scanner/" frontend/src frontend/scripts <kiosk client dir>` | ไม่พบ | 33, 34 |
| AC-SBO-28 | `POST /api/v1/kiosk/draft` และ `POST /api/v1/scanner/draft` | `404` ทั้งคู่ | 37 |
| AC-SBO-29 | `grep -rn "features/scanners" frontend/src` | ไม่พบ · `$lib/features/kiosk-devices` import ได้ | 38 |
| AC-SBO-30 | `grep -n "banner_staff" frontend/src/lib/auth/roles.ts` · ตัวเลือก role ในหน้าจัดการผู้ใช้ | ไม่พบ `banner_staff` · มี `kiosk_staff` | 39, 41 |

**DoD:** `pnpm lint` · `pnpm check` (0 error) · `pnpm test` (ผ่าน pre-push hook) · test ของ kiosk client ผ่าน (allowlist path ใหม่ + AC-SBO-26) · `server.test.ts` ทุก route ครอบ AC-SBO-04/06/07/08/11/16/17/18/20 · `svelte-autofixer` ทุก `.svelte` ที่แตะ · manual AC-SBO-01..15, 19, 21..25 ด้วยบัญชี SA, SM ศูนย์ A, SM ศูนย์ B, SM ศูนย์ A+B, SM ศูนย์ A + registration_staff ศูนย์ B, registration_staff, `kiosk_staff` ศูนย์ A

## 5. Impact

- **Docs:** `role-permission-matrix.md` §1.1 แทนแถว BAN `banner_staff` ด้วย KIO `kiosk_staff` (คง 11 บทบาท) · เพิ่มแถวสิทธิ์「Kiosk Device (`/back-office/kiosks`)」SA ✓ · SM scope · KIO scope · อื่น — · แถว「Kiosk Banner」คอลัมน์ BAN → KIO · CR-162 เพิ่มหมายเหตุว่า `banner_staff` ถูกแทนที่ (FR-SBO-39..42) · `api-contract.md` §2.2 หัวข้อ admin เปลี่ยน "SA เท่านั้น" → "SA ทุกศูนย์ / SM + `kiosk_staff` เฉพาะศูนย์" + เพิ่ม `GET`/`PATCH` + error 404 นอก scope · `schema.md` §3.11 `staff_pin_updated_by` = SA, SM หรือ `kiosk_staff` และการแก้ชื่อ/สถานะทำฝั่ง server · `schema.md` §3.11.1 `scanner_staff_pin.updated_by` = SA, SM หรือ `kiosk_staff` · `schema.md` §6 `_users.roles` เพิ่ม `{code}:kiosk_staff`
- **Code:** ตาม `affects:` · ไม่แตะ `registry` VDU (ยังให้เขียนเฉพาะ SA/`_admin` — server ใช้ admin credential)
- **Docs (path):** `api-contract.md` §2.1–2.3 แก้ path ทุกจุดตาม §2.4 และเปลี่ยนชื่อ `scanner_client` → kiosk client · `schema.md` §1.6, §3.11, §3.11.1, §3.12 แก้ path ที่อ้าง · `smart-card-registration-spec.md`, `kiosk-banner-design-guideline.md` แก้ path · CR เดิม (CR-097/149/151/152/158/162/163) ไม่แก้ย้อนหลัง — CR นี้อ้างไว้ใน `supersedes_rules`
- **ไม่กระทบ:** body / response / auth ของ endpoint · `scanner_secrets` `_security` · `sync:central` · ชื่อ doc / DB `scanner_*`
- **ความเสี่ยง:** ตัดทันทีไม่มี alias — ตู้ที่ยังไม่อัปเดต kiosk client หลัง deploy server จะ bootstrap ไม่ผ่านและเรียก API ของตู้ไม่ได้ทั้งหมด (`404`) จนกว่าจะอัปเดต · กลับกัน ตู้ที่อัปเดตก่อน deploy server ก็ใช้ไม่ได้ · รับมือด้วยขั้น cutover ใน §6
- **ความเสี่ยง:** SM และ `kiosk_staff` ดู staff PIN ของเครื่องในศูนย์ได้ — ยอมรับเพราะ PIN ใช้ได้เฉพาะที่เครื่องนั้น และทั้งสอง role เป็นผู้รับผิดชอบตู้และเจ้าหน้าที่หน้าตู้ · ทุก reveal ถูก log (FR-SBO-07)
- **ความเสี่ยง:** SM และ `kiosk_staff` ลบเครื่องในศูนย์ได้ — ลบแล้วย้อนกลับไม่ได้ (ลบ registry doc + PIN doc) ตู้ใช้งานไม่ได้ทันทีและต้องสร้างเครื่องใหม่ + ตั้ง secret ที่ตู้ใหม่ · ยอมรับตามที่ทีม kiosk ตกลงกับ Team Lead แล้ว โดยต้องผ่าน confirm dialog (FR-SBO-30) · ทุกการลบถูก log (FR-SBO-07)
- **ความเสี่ยง:** role ใหม่ `kiosk_staff` ได้สิทธิ์ลบและดู PIN เท่า SM — SM ต้อง grant ให้เฉพาะคนที่ดูแลตู้จริง · ยอมรับตามที่ตกลงกับ Team Lead (คงสิทธิ์ลบหลัง review PR #491 — §7)

## 6. Migration

- **Data:** ไม่เปลี่ยนรูปร่าง doc ที่ persist · ไม่ bump `schema_v` · ไม่ต้อง backfill · device credential / PIN เดิมใช้ต่อได้
- **Cutover (ตัดทันที — ไม่มี alias path เดิม):**
  1. นัดช่วงเวลาที่ไม่มีการลงทะเบียน / check-in ที่ตู้ และแจ้งทุกศูนย์ที่มีตู้
  2. เตรียม kiosk client เวอร์ชันที่ใช้ path ใหม่ให้ทุกตู้ (ดึง code / build) แต่ยังไม่ restart
  3. deploy server (SvelteKit central)
  4. restart kiosk client ทุกตู้ทันที → ตรวจว่า bootstrap ผ่านและหน้า `/kiosk` โหลด config ได้ (AC-SBO-24)
  5. ตู้ที่ bootstrap ไม่ผ่านหลังขั้น 4 = ยังเป็น client เวอร์ชันเดิม → อัปเดตแล้ว restart
- **Rollback:** revert server + kiosk client คู่กัน (path ต้องตรงกันทั้งสองฝั่ง)
- **`banner_staff` → `kiosk_staff`:** ณ 2026-10-12 ไม่มี `banner_staff` ใน `roles.ts` (CR-162 ยังไม่ build) จึงไม่มี `_users` ที่ถือ role นี้ผ่านแอป · ก่อน deploy ตรวจ `_users` ว่ามี `{code}:banner_staff` หรือไม่ ถ้ามีให้แทนด้วย `{code}:kiosk_staff`
- **URL หน้า:** `/back-office/kiosks` ยังไม่เคยขึ้น production · `/system-management/scanners` redirect ไป `/back-office/kiosks` (FR-SBO-25)

## 7. Decision log

> ทุกข้อด้านล่างเป็นการตัดสินระดับทีม kiosk (ข้อที่ระบุ Team Lead = ทีม kiosk + Team Lead) — CR ยังเป็น `proposed` รอเจ้าของโครงการ approve

- 2026-10-12 — proposed · ทีม kiosk เคาะ: SA + SM เห็นและจัดการได้ · SM ทำได้ทุก action รวม reveal PIN · หน้าเดิม redirect ไป back-office
- ~~2026-10-12 — ทีม kiosk เคาะ: Why = วางฐานก่อนต่อยอด Kiosk Banner (issue #466) · เพิ่มเมนูแม่「จัดการ Kiosk」(FR-SBO-24/26) และตัวกรองศูนย์ (FR-SBO-27) ให้หน้า banner ใช้ต่อ~~ — แทนที่ 2026-10-12: ตัดเรื่อง Kiosk Banner ออกจาก CR นี้
- 2026-10-12 — ทีม kiosk เคาะ: ~~ไม่เพิ่ม capability role ใหม่ (ต่างจาก `banner_staff` ของ CR-162)~~ (แทนที่ 2026-10-12 ด้วย role `kiosk_staff`) · ศูนย์ของเครื่องแก้ไม่ได้ (FR-SBO-15) · นอก scope ตอบ 404 ไม่ใช่ 403 (FR-SBO-04)
- 2026-10-12 — ทีม kiosk เคาะ: scope ของ SM ใช้ศูนย์ที่เลือกอยู่ (active shelter) เหมือนหน้า back-office อื่น — ใช้ `requireManager` เดิม · SM ไม่มีตัวกรองศูนย์ / mode รวมหลายศูนย์ (FR-SBO-10/20/22/27)
- 2026-10-12 — ทีม kiosk เคาะ: เมนูแม่「จัดการ Kiosk」มีลูก「จัดการอุปกรณ์」(FR-SBO-24/26) · ~~ลูก「จัดการแบนเนอร์」ของ CR-162~~ (ตัดออกจาก CR นี้ 2026-10-12)
- 2026-10-12 — ทีม kiosk เคาะ (หลัง review): ~~เมนู「จัดการแบนเนอร์」ให้งาน CR-162 เป็นผู้เพิ่ม ไม่ใส่ล่วงหน้า (กัน dead link)~~ (ตัดออกจาก CR นี้ 2026-10-12) · `GET` ขอศูนย์นอก scope ตอบ `403` แทน `200 []` ให้ error contract ตรงกับ `POST` · `PATCH` retry เมื่อ `_rev` ชน สูงสุด 3 ครั้ง เพราะ kiosk เขียน `last_seen_at` ทุก bootstrap/lookup/check-in/register
- 2026-10-12 — ทีม kiosk เคาะ (หลัง implement): ตัดตัวกรองศูนย์ของ SA ออก — ทุก role ใช้ศูนย์ที่เลือกอยู่ (active shelter) ทั้งรายการและ dialog สร้างเครื่อง ให้หน้าทำงานเหมือนหน้า back-office อื่น · SA ดูศูนย์อื่นด้วยการสลับศูนย์ (FR-SBO-22/27, AC-SBO-02/13) · API `GET /api/v1/scanner/devices` คงเดิม (SA ไม่ส่ง `shelter_code` ยังได้ทุกศูนย์ — หน้าไม่ใช้)
- 2026-10-12 — ทีม kiosk เคาะ **และตกลงกับ Team Lead แล้ว**: เพิ่ม role ใหม่ `kiosk_staff` (`{code}:kiosk_staff`) จัดการเครื่องของศูนย์ตัวเองได้ทุก action เท่า SM รวมลบ (ต้องผ่าน confirm dialog) และ reveal PIN (FR-SBO-03/28/30) · **ใช้ `kiosk_staff` ไม่ใช้ `banner_staff`** — ยกเลิก role `banner_staff` ของ CR-162 (ต้องแก้ CR-162 แยก) · ตัดเรื่อง Kiosk Banner ออกจาก CR นี้ทั้งหมด
- ~~2026-10-12 — แผน (ตกลงกับ Team Lead แล้ว · นอก scope CR นี้): `kiosk_staff` จะเข้าถึงหน้าแบนเนอร์ (`/back-office/kiosk-banners`) ได้ด้วย แทน `banner_staff` — ระบุใน CR-162 ตอนแก้~~ — แทนที่ 2026-10-12: ระบุใน CR นี้ §3.6 แทน (review PR #491)
- 2026-10-12 — ทีม kiosk เคาะ: ย้าย API `/api/v1/scanner/*` **ทั้งหมด** (รวม `bootstrap`, `draft`, `devices/**`) → `/api/v1/kiosk/*` ใน CR นี้ (§2.4, FR-SBO-31..36) · **ตัดทันที** ไม่มี alias path เดิม — deploy server + kiosk client พร้อมกัน (§6) · ไม่เปลี่ยนชื่อ feature `scanners`, หน้า `/back-office/kiosks`, doc / DB `scanner_*`, `client_version` `scanner-client`
- 2026-10-12 — ทีม kiosk เคาะ (หลัง implement): ลบ endpoint legacy `draft` แทนการย้ายไป `/api/v1/kiosk/draft` — ตอบ `410` ตั้งแต่ CR-151 และไม่มีผู้เรียก (FR-SBO-37)
- 2026-10-12 — ทีม kiosk เคาะ (หลัง review PR #491): หน้า `/back-office/scanners` → `/back-office/kiosks` · feature `scanners` → `kiosk-devices` (ไม่ใช้ `kiosks` เพราะชื่อใกล้ `$lib/features/kiosk` ของหน้าตู้) · guard ชื่อ `requireKioskManagement` (FR-SBO-20/38)
- 2026-10-12 — ทีม kiosk เคาะ (หลัง review PR #491): `kiosk_staff` แทน `banner_staff` ของ CR-162 ใน CR นี้ — ใช้ช่องบทบาทที่ 11 เดิม ไม่เพิ่มบทบาทที่ 12 · `kiosk_staff` ได้สิทธิ์หน้าแบนเนอร์ตาม FR-KBN-24 (§3.6, FR-SBO-39..42)
- 2026-10-12 — ทีม kiosk เคาะ (หลัง review PR #491): คงสิทธิ์ลบเครื่องและ reveal PIN ของ `kiosk_staff` ตามที่ตกลงกับ Team Lead · คงชื่อเมนูลูก「จัดการอุปกรณ์」
- ทีม kiosk เคาะตัดทิ้ง: ย้ายเฉพาะ `/api/v1/scanner/kiosk/*` (คง `bootstrap`, `draft`, `devices` ไว้ใต้ `scanner`) — API ของระบบเดียวกันจะแยกอยู่สอง prefix
- ทีม kiosk เคาะตัดทิ้ง: รับทั้ง path เดิมและใหม่ชั่วคราว (alias) ระหว่างอัปเดตตู้
- ทีม kiosk เคาะตัดทิ้ง: ย้าย `scanner_device` ไปไว้ใน `shelter_{code}` (schema.md §3.11 Future Consideration) — ต้องเปลี่ยน device auth ของ kiosk ทั้งชุด เกินขอบเขตการย้ายสิทธิ์
- ทีม kiosk เคาะตัดทิ้ง: SM เห็นรวมทุกศูนย์ที่ตัวเองเป็น SM (「ทุกศูนย์ของฉัน」) — ต้องทำ guard ใหม่แทน `requireManager` และหน้าจะทำงานต่างจากหน้า back-office อื่น · SM หลายศูนย์มีน้อย สลับศูนย์แทนได้
- ทีม kiosk เคาะตัดทิ้ง: คงหน้าไว้ทั้ง system-management และ back-office — ซ้ำซ้อน และ SA เข้า back-office ได้อยู่แล้ว
