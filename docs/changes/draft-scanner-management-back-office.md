---
id: draft
title: ย้ายการจัดการเครื่องสแกน/Kiosk (scanner_device) จาก System Management ไป Back Office — SA ทุกศูนย์ + shelter_manager เฉพาะศูนย์ตัวเอง
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
  - CR-158 §3 หัวข้อ "Admin (/system-management/scanners)" FR-26..29 — path หน้าจัดการเปลี่ยนเป็น /back-office/scanners
affects:
  - docs/prd/role-permission-matrix.md §1.1 (แถวใหม่ "Scanner / Kiosk Device")
  - docs/data/api-contract.md §2.2 (สิทธิ์ admin endpoint SA → SA + SM scope · เพิ่ม GET /api/v1/scanner/devices, PATCH /api/v1/scanner/devices/[id])
  - docs/data/schema.md §3.11 (คำอธิบาย `staff_pin_updated_by`, การแก้ชื่อ/สถานะเครื่องย้ายไปฝั่ง server) — ไม่เปลี่ยนรูปร่าง doc, ไม่ bump schema_v
  - docs/data/schema.md §3.11.1 (คำอธิบาย `scanner_staff_pin.updated_by` = SA หรือ SM) — ไม่เปลี่ยนรูปร่าง doc, ไม่ bump schema_v
  - frontend/src/lib/auth/roles.ts (helper สิทธิ์ตาม capability + ศูนย์ ที่ CR-162 ใช้ต่อ)
  - frontend/src/lib/server/shelter-capability-access.ts (ใหม่ — resolve ผู้เรียก back-office ตาม capability + ศูนย์)
  - frontend/src/lib/server/scanners/{staff-pin-http.ts,device-repository.ts}
  - frontend/src/routes/api/v1/scanner/devices/{+server.ts,[id]/+server.ts,[id]/staff-pin/+server.ts,[id]/staff-pin/reveal/+server.ts}
  - frontend/src/lib/features/scanners/{data/scanner.api.ts,data/scanner.remote.ts,application/queries.ts,ui/create-scanner-dialog.svelte,ui/scanner-list.svelte,index.ts}
  - frontend/src/routes/(protected)/back-office/scanners/** (ใหม่)
  - frontend/src/routes/(protected)/system-management/scanners/** (เปลี่ยนเป็น redirect)
  - frontend/src/lib/components/{backoffice-navbar/static.ts,backoffice-navbar.svelte,system-management-navbar/static.ts}
  - frontend/src/lib/components/shelter-scope-select.svelte (ใหม่ — ตัวเลือกศูนย์ตาม scope ให้หน้า kiosk-banners ของ CR-162 ใช้ · หน้า scanners ใช้แสดงศูนย์แบบ read-only ใน dialog สร้างเครื่องเท่านั้น)
  - tests — frontend/src/routes/api/v1/scanner/devices/{server.test.ts,[id]/server.test.ts,[id]/staff-pin/server.test.ts,[id]/staff-pin/reveal/server.test.ts} (AC-SBO-04/06/07/08/11/16)
  - tests — frontend/src/lib/features/scanners/data/{scanner.api.test.ts,scanner.remote.test.ts} · frontend/src/lib/server/scanners/device-repository.test.ts · frontend/src/lib/auth/roles.test.ts
  - tests — frontend/src/lib/server/shelter-capability-access.test.ts (ใหม่)
related:
  - CR-162 Kiosk Banner (issue #466) — งานต่อยอดที่ใช้โครงสร้าง back-office kiosk ชุดเดียวกัน
why: วางฐาน back-office ของงาน kiosk รายศูนย์ก่อนต่อยอด Kiosk Banner (CR-162, issue #466) — เครื่อง kiosk เป็นสิ่งที่ banner ของศูนย์ไปแสดง และทั้งสองงานใช้โมเดลสิทธิ์ SA ทุกศูนย์ / ผู้รับผิดชอบเฉพาะศูนย์ชุดเดียวกัน · ปัจจุบันการจัดการเครื่องทำได้เฉพาะ SA ที่ส่วนกลาง ศูนย์ต้องรอส่วนกลางทุกครั้งที่ตั้งเครื่องใหม่ เปลี่ยน PIN หรือปิดเครื่อง
migration: N/A — ไม่เปลี่ยนรูปร่าง doc `scanner_device` / `scanner_staff_pin` · ไม่ bump schema_v · ไม่ต้อง backfill · ไม่กระทบเครื่อง kiosk และ `scanner_client`
---

# Draft CR: ย้ายการจัดการเครื่องสแกน/Kiosk ไป Back Office

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** หน้าจัดการเครื่องสแกน/Kiosk ย้ายจาก `/system-management/scanners` (SA เท่านั้น) ไป `/back-office/scanners` · `system_admin` จัดการได้ทุกศูนย์ · `shelter_manager` ดูและจัดการได้**ทุก action** (สร้าง, แก้ไข, เปิดปิด, ลบ, ตั้ง/สุ่ม/ดู staff PIN) เฉพาะเครื่องของศูนย์ที่ตัวเองเป็น SM
> - **เพื่อใคร/ทำไม:** ต่อยอดงาน Kiosk Banner (CR-162, issue #466) — ให้ศูนย์ดูแลทั้ง「ตู้」และ「สิ่งที่แสดงบนตู้」ได้ใน back-office ที่เดียวด้วยโมเดลสิทธิ์ชุดเดียว และไม่ต้องรอส่วนกลาง
> - **Dev ต้อง build:** เมนูแม่「จัดการ Kiosk」ใน back-office + ลูก「จัดการอุปกรณ์」(「จัดการแบนเนอร์」ของ CR-162 มาเสียบภายหลัง) · ทุก role (SA และ SM) ใช้ศูนย์ที่เลือกอยู่ (active shelter) — หน้าไม่มีตัวเลือกศูนย์ · guard สิทธิ์ SA/SM-scope ฝั่ง server ให้ทุก admin endpoint ของ scanner · `GET` (list ตาม scope) และ `PATCH` (แก้ชื่อ/จุดบริการ/สถานะ) ใหม่ — browser เลิกอ่าน/เขียน `scanner_device` ใน `registry` ตรง · หน้า back-office + เมนู · URL เดิม redirect
> - **กระทบ schema/scope:** เปลี่ยน role/permission (SA-only → SA + SM scope) · ไม่เปลี่ยนรูปร่าง doc · ไม่ bump `schema_v` · device auth ของ kiosk, `scanner_secrets` (admin-only), `scanner_client` ไม่เปลี่ยน

---

## 1. Why

1. **ต่อยอดงาน Kiosk Banner (CR-162, issue #466):** banner เป็นเนื้อหาที่ศูนย์ตั้งให้แสดงบน**ตู้ของศูนย์** (feed ของตู้กรองด้วย `shelter_code` ของเครื่อง — CR-162 FR-KBN-31/32) และจัดการที่ `/back-office/kiosk-banners` ด้วยสิทธิ์ SA ทุกศูนย์ / SM + `banner_staff` เฉพาะศูนย์ (FR-KBN-24) — แต่ตัวเครื่องที่ banner ไปแสดงยังจัดการได้เฉพาะ SA ใน system-management ผู้ดูแลศูนย์จึงไม่เห็นว่าศูนย์ตัวเองมีตู้กี่เครื่อง ตู้ไหนเปิดอยู่ และตั้งตู้ใหม่ไม่ได้ · การย้ายการจัดการเครื่องมา back-office ก่อนทำให้งาน kiosk ของศูนย์อยู่ที่เดียว (เมนูแม่「จัดการ Kiosk」) และวางสิ่งที่ banner ต้องใช้ซ้ำไว้ล่วงหน้า: การตรวจสิทธิ์ตาม capability + ศูนย์ฝั่ง server, ตัวเลือกศูนย์ตาม scope, เมนูที่ซ่อน/แสดงตาม capability
2. **งานของศูนย์:** การตั้งตู้ใหม่ ปิดเครื่องที่เสีย และเปลี่ยน staff PIN เมื่อเจ้าหน้าที่หน้าตู้เปลี่ยน เป็นงานหน้างานของศูนย์ (CR-158 กำหนดให้ PIN ผูกกับเครื่องเพราะแต่ละจุดตั้งตู้มีเจ้าหน้าที่ต่างกัน) การผูกงานนี้ไว้กับ SA ทำให้ศูนย์ต้องรอส่วนกลาง
3. **ปิดช่อง browser เขียน/อ่าน registry ตรง:** เดิม browser อ่าน `scanner_device` ทุกศูนย์จาก `registry` แล้วกรองฝั่ง client และแก้สถานะเครื่องด้วยการ `PUT` ตรง ซึ่ง VDU ของ `registry` อนุญาตเฉพาะ SA — ถ้า SM ใช้หน้าเดิม การแก้สถานะจะถูกปฏิเสธ และรายการจะไม่ถูกจำกัดตามศูนย์ จึงต้องย้าย list/update ไปฝั่ง server (แนวเดียวกับ banner ที่ทำ CRUD ผ่าน BFF ฝั่ง server ทั้งหมด)

## 2. Change

### 2.1 สิทธิ์

| Action | before | after |
| --- | --- | --- |
| ดูรายการเครื่อง | SA (browser อ่าน `registry` ทุกศูนย์) | SA และ SM: เฉพาะเครื่องของศูนย์ที่เลือกอยู่ (active shelter) — SM ต้องเป็น SM ของศูนย์นั้น · ดูศูนย์อื่นต้องสลับศูนย์ (SA สลับได้ทุกศูนย์) |
| สร้างเครื่อง (ได้ device secret + default PIN) | SA | SA และ SM: ศูนย์ที่เลือกอยู่ (active shelter) — SM ต้องเป็น SM ของศูนย์นั้น · SA สลับศูนย์ได้ทุกศูนย์ |
| แก้ชื่อ / จุดบริการ / เปิดปิดเครื่อง | SA (browser `PUT` ตรง) | SA ทุกเครื่อง · SM เครื่องในศูนย์ตัวเอง — ผ่าน server |
| ลบเครื่อง | SA | SA · SM เครื่องในศูนย์ตัวเอง |
| ตั้ง / สุ่ม staff PIN | SA | SA · SM เครื่องในศูนย์ตัวเอง |
| ดู staff PIN (reveal) | SA | SA · SM เครื่องในศูนย์ตัวเอง |
| role อื่น (registration_staff, kitchen_staff, …) | ไม่มีสิทธิ์ | ไม่มีสิทธิ์ (เหมือนเดิม) |

"SM ของศูนย์ X" = `isShelterManager(roles, X)` (รองรับ compound role `{X}:shelter_manager` ตาม CR-093) ไม่ใช่แค่มี `shelter:X`

### 2.2 หน้าจอ

| | before | after |
| --- | --- | --- |
| หน้าจัดการ | `/system-management/scanners` (layout `requireAdmin`) | `/back-office/scanners` (`requireManager`) |
| เมนู | System Management กลุ่มแรก「เครื่องสแกนบัตร (Scanners)」 · CR-162: เมนู「แบนเนอร์ Kiosk」ใน back-office (ยังไม่ implement) | Back Office กลุ่ม「4. ตั้งค่าระบบ」→ เมนูแม่「จัดการ Kiosk」→ เมนูลูก「จัดการอุปกรณ์」(`/back-office/scanners`) — ลบเมนูเครื่องสแกนออกจาก System Management · งาน CR-162 เพิ่มเมนูลูก「จัดการแบนเนอร์」(`/back-office/kiosk-banners`) ใต้เมนูแม่เดียวกัน |
| เลือกศูนย์ | dialog สร้างเครื่องเลือกได้ทุกศูนย์ | ไม่มีตัวเลือกศูนย์ในหน้าทุก role — รายการและ dialog สร้างเครื่องใช้ศูนย์ที่เลือกอยู่ (active shelter) เหมือนหน้า back-office อื่น |
| URL เดิม | — | `/system-management/scanners` → `302` ไป `/back-office/scanners` |

### 2.3 API

| Endpoint | before | after |
| --- | --- | --- |
| `GET /api/v1/scanner/devices` | ไม่มี | **ใหม่** — คืน `ScannerDeviceSummary[]` · SA ทุกศูนย์ หรือกรองด้วย `?shelter_code=` · SM ต้องส่ง `?shelter_code=` ของศูนย์ที่เลือกอยู่ |
| `PATCH /api/v1/scanner/devices/[id]` | ไม่มี (browser `PUT` registry ตรง) | **ใหม่** — แก้ `name`, `station_name`, `status` |
| `POST /api/v1/scanner/devices` | SA | SA + SM scope |
| `DELETE /api/v1/scanner/devices/[id]` | SA | SA + SM scope |
| `POST /api/v1/scanner/devices/[id]/staff-pin` | SA | SA + SM scope |
| `POST /api/v1/scanner/devices/[id]/staff-pin/reveal` | SA | SA + SM scope |
| `/api/v1/scanner/bootstrap`, `/api/v1/scanner/kiosk/*` | device credential | ไม่เปลี่ยน |

## 3. Requirements

### 3.1 Server — สิทธิ์

| ID | Requirement |
| --- | --- |
| FR-SBO-01 | ทุก admin endpoint ของ scanner (§2.3 ยกเว้นแถว kiosk) ต้องยืนยัน `_session` cookie · ไม่ login → `401 UNAUTHENTICATED` · ไม่ใช่ SA และไม่ใช่ SM ของศูนย์ใดเลย → `403 FORBIDDEN` |
| FR-SBO-02 | SA ทำทุก action กับเครื่องของทุกศูนย์ได้ |
| FR-SBO-03 | SM ทำ action กับเครื่องได้เมื่อ `isShelterManager(roles, device.shelter_code)` เป็นจริง |
| FR-SBO-04 | endpoint ที่มี `[id]` (`PATCH`, `DELETE`, `staff-pin`, `staff-pin/reveal`) เมื่อ SM เรียกกับเครื่องของศูนย์ที่ตัวเองไม่ได้เป็น SM → ตอบ `404 NOT_FOUND` เหมือนไม่พบเครื่อง (ไม่เปิดเผยว่ามี `device_id` นั้นในศูนย์อื่น) · server อ่าน registry doc ได้เพื่อตรวจ `shelter_code` เท่านั้น — ต้องไม่เขียน `registry` และต้องไม่อ่าน/เขียน `scanner_secrets` |
| FR-SBO-05 | `POST /api/v1/scanner/devices` เมื่อ SM ส่ง `shelter_code` ของศูนย์ที่ตัวเองไม่ได้เป็น SM → `403 FORBIDDEN` และไม่สร้าง doc ใด ๆ |
| FR-SBO-06 | endpoint ที่มี `[id]` ตรวจสิทธิ์จาก `shelter_code` ใน registry doc ที่อ่านฝั่ง server เท่านั้น — ไม่เชื่อ `shelter_code` จาก body/query · `POST` ตรวจ `shelter_code` จาก body ตาม FR-SBO-05 |
| FR-SBO-07 | log ทุก action ที่เขียนหรือ reveal ต้องมี `device`, `shelter`, `by`, `at` · ห้าม log ค่า PIN หรือ device secret (เหมือน CR-158) |
| FR-SBO-08 | การตั้ง / สุ่ม PIN และการสร้างเครื่องบันทึก `staff_pin_updated_by` (registry) และ `updated_by` ของ `scanner_staff_pin` (`scanner_secrets`) = `_users` name ของผู้เรียกจริง (SA หรือ SM) |

### 3.2 Server — endpoint ใหม่

| ID | Requirement |
| --- | --- |
| FR-SBO-10 | `GET /api/v1/scanner/devices` คืน `200 ScannerDeviceSummary[]` · SA ไม่ส่ง `shelter_code` → ได้ทุกเครื่อง · SM ต้องส่ง `?shelter_code=` (client ส่งศูนย์ที่เลือกอยู่ — active shelter) ไม่ส่ง → `400 VALIDATION` · ไม่มี mode รวมหลายศูนย์สำหรับ SM |
| FR-SBO-11 | `GET /api/v1/scanner/devices?shelter_code=XXX` คืนเฉพาะเครื่องของศูนย์นั้น · SA ขอได้ทุกศูนย์ · SM ขอศูนย์ที่ `isShelterManager(roles, XXX)` เป็นเท็จ → `403 FORBIDDEN` (เหมือน `POST` นอก scope ใน FR-SBO-05 — ผู้เรียกเป็นคนระบุศูนย์ จึงไม่มีข้อมูลรั่ว) |
| FR-SBO-12 | response ของ `GET` ห้ามมี `secret_hash`, `secret_prefix`, `_rev` หรือค่า PIN (ใช้ `toScannerDeviceSummary` เดิม) · ตอบด้วย `cache-control: no-store` |
| FR-SBO-13 | `PATCH /api/v1/scanner/devices/[id]` (`[id]` = `device_id` เช่น `kiosk-01` ไม่ใช่ CouchDB `_id` — เหมือน endpoint `[id]` อื่นใน api-contract.md §2.2) รับ body strict `{ name?, station_name?, status? }` อย่างน้อย 1 key · validate ด้วย rule เดียวกับ `scannerDeviceInputSchema` · `status` รับเฉพาะ `active` \| `inactive` (enum ตาม schema.md §3.11 / `deviceStatusSchema`) · key อื่น (รวม `shelter_code`, `device_id`, `staff_pin_*`, `secret_*`) → `400 VALIDATION` |
| FR-SBO-14 | `PATCH` เขียนด้วย admin credential ฝั่ง server, คง field อื่นของ doc เดิมทั้งหมด (รวม `staff_pin_*`, `secret_hash`, `schema_v`), อัปเดต `updated_at` · `_rev` ชน (เช่น kiosk เขียน `last_seen_at` ระหว่างนั้น) → อ่าน doc ล่าสุดแล้ว apply patch ซ้ำ สูงสุด 3 ครั้ง (เหมือน `METADATA_WRITE_ATTEMPTS` ของ staff PIN metadata) ยังชน → `409 CONFLICT` · สำเร็จ → `200 ScannerDeviceSummary` |
| FR-SBO-15 | การย้ายเครื่องไปศูนย์อื่นทำไม่ได้ผ่าน `PATCH` — ต้องลบแล้วสร้างใหม่ (ได้ secret และ PIN ใหม่) |

### 3.3 Client

| ID | Requirement |
| --- | --- |
| FR-SBO-20 | หน้า `/back-office/scanners` ใช้ guard `requireManager` (SA หรือ SM ของศูนย์ที่เลือกอยู่) · ผู้ใช้ที่เป็น SM ของศูนย์อื่นแต่ศูนย์ที่เลือกอยู่ไม่ได้เป็น SM → redirect ตาม guard เดิม (ต้องสลับศูนย์ก่อน) |
| FR-SBO-21 | feature `scanners` ต้องอ่านรายการผ่าน `GET /api/v1/scanner/devices` และแก้ไขผ่าน `PATCH` เท่านั้น — ไม่มี code path ใดใน browser ที่อ่าน/เขียน `scanner_device` จาก `registry` ตรง |
| FR-SBO-22 | dialog สร้างเครื่อง: ทุก role (SA และ SM) ใช้ศูนย์ที่เลือกอยู่ (active shelter) แสดงเป็นค่าคงที่ เลือกไม่ได้ |
| FR-SBO-23 | รายการแสดงคอลัมน์ศูนย์ทุก role · action ทั้งหมด (ดู secret ที่เพิ่งสร้าง, ตั้ง/ดู PIN, เปิดปิด, ลบ) แสดงเหมือนกันสำหรับ SA และ SM |
| FR-SBO-24 | back-office navbar กลุ่ม「4. ตั้งค่าระบบ」เพิ่มเมนูแม่「จัดการ Kiosk」และเมนูลูก「จัดการอุปกรณ์」→ `/back-office/scanners` · เมนูลูกที่สอง「จัดการแบนเนอร์」→ `/back-office/kiosk-banners` เพิ่มโดยงาน CR-162 เมื่อ route นั้นมีจริง — CR นี้ห้ามใส่เมนูที่ชี้ route ที่ยังไม่มี · ลบเมนูเครื่องสแกนเดิมออกจาก system-management navbar |
| FR-SBO-25 | `/system-management/scanners` redirect `302` ไป `/back-office/scanners` |
| FR-SBO-26 | เมนูลูกใน back-office navbar กำหนดการแสดงผลได้ตาม capability ในศูนย์ (ไม่จำกัดแค่ SA / SM) · เมนูแม่แสดงเมื่อมีเมนูลูกอย่างน้อย 1 รายการที่ผู้ใช้เห็น ·「จัดการอุปกรณ์」เห็นเฉพาะ SA และ SM · (เมื่อ CR-162 เพิ่ม「จัดการแบนเนอร์」: เห็น SA, SM และ `banner_staff` ตาม FR-KBN-24/27 ด้วยกลไกเดียวกัน) |
| FR-SBO-27 | หน้า `/back-office/scanners` ไม่มีตัวกรองศูนย์ทุก role (รวม SA) · รายการเป็นของศูนย์ที่เลือกอยู่ (active shelter) เสมอ — client ส่ง `?shelter_code=` ทุกครั้ง และเปลี่ยนตามเมื่อสลับศูนย์ · SA ดูศูนย์อื่นด้วยการสลับศูนย์ |

## 4. Acceptance criteria

| ID | Scenario | ผลที่คาด | FR |
| --- | --- | --- | --- |
| AC-SBO-01 | SM ศูนย์ A เปิด `/back-office/scanners` | เห็นเฉพาะเครื่องของ A | 10, 20 |
| AC-SBO-02 | SA เลือกศูนย์ A อยู่ แล้วเปิด `/back-office/scanners` | เห็นเฉพาะเครื่องของ A · ไม่มีตัวกรองศูนย์ในหน้า | 02, 10, 27 |
| AC-SBO-03 | SM ศูนย์ A สร้างเครื่องให้ A | `201` ได้ device secret + default PIN · kiosk bootstrap ด้วย secret นั้นได้ | 03, 22 |
| AC-SBO-04 | SM ศูนย์ A ยิง `POST devices` ด้วย `shelter_code: B` | `403` · ไม่มี doc ใหม่ใน `registry` / `scanner_secrets` | 05 |
| AC-SBO-05 | SM ศูนย์ A เปิดปิด / ลบ / ตั้ง PIN / reveal PIN เครื่องของ A | สำเร็จ · log มี `by` = SM · หลังตั้ง PIN `staff_pin_updated_by` = SM | 03, 07, 08 |
| AC-SBO-06 | SM ศูนย์ A ยิง `PATCH`/`DELETE`/`staff-pin`/`reveal` กับเครื่องของ B | `404` · เครื่องของ B ไม่เปลี่ยน | 04 |
| AC-SBO-07 | registration_staff ศูนย์ A ยิงทุก admin endpoint | `403` · เปิดหน้า `/back-office/scanners` ถูก redirect | 01, 20 |
| AC-SBO-08 | `PATCH` body `{ shelter_code: "B" }` หรือ `{ staff_pin_set: false }` | `400` · doc ไม่เปลี่ยน | 13, 15 |
| AC-SBO-09 | `PATCH { status: "inactive" }` | `staff_pin_*`, `secret_hash` คงเดิม · kiosk ของเครื่องนั้น auth ไม่ผ่าน (พฤติกรรม inactive เดิม) | 14 |
| AC-SBO-10 | เปิด `/system-management/scanners` | ไปที่ `/back-office/scanners` | 25 |
| AC-SBO-11 | ไม่ login ยิงทุก admin endpoint | `401` | 01 |
| AC-SBO-12 | SM เปิด back-office | เห็นเมนูแม่「จัดการ Kiosk」และเมนูลูก「จัดการอุปกรณ์」· ไม่มีเมนูที่ชี้ `/back-office/kiosk-banners` · registration_staff ไม่เห็นเมนูแม่ | 24, 26 |
| AC-SBO-13 | SA สลับศูนย์จาก A ไป B (ตัวสลับศูนย์ของ back-office) | รายการเปลี่ยนเป็นเครื่องของ B · dialog สร้างเครื่องล็อกศูนย์ B · SA และ SM ไม่เห็นตัวกรองศูนย์ในหน้า | 22, 27 |
| AC-SBO-14 | ผู้ใช้เป็น SM ทั้งศูนย์ A และ B เลือกศูนย์ A อยู่ แล้วสลับไป B | ก่อนสลับเห็นเฉพาะเครื่องของ A · หลังสลับเห็นเฉพาะเครื่องของ B · dialog สร้างเครื่องล็อกศูนย์ตามศูนย์ที่เลือก | 10, 22, 27 |
| AC-SBO-15 | ผู้ใช้เป็น SM ศูนย์ A และ registration_staff ศูนย์ B เลือกศูนย์ B อยู่ แล้วเปิด `/back-office/scanners` | redirect ตาม guard · สลับไปศูนย์ A แล้วเข้าได้ | 20 |
| AC-SBO-16 | SM ยิง `GET devices` โดยไม่ส่ง `shelter_code` | `400` | 10 |
| AC-SBO-17 | SM ศูนย์ A ยิง `GET devices?shelter_code=B` | `403` | 11 |
| AC-SBO-18 | `PATCH` ขณะ `_rev` ของ doc เปลี่ยนจาก kiosk เขียน `last_seen_at` | สำเร็จหลัง retry · `name`/`status` ใหม่ และ `last_seen_at` ล่าสุดคงอยู่ · ชนครบ 3 ครั้ง → `409` | 14 |

**DoD:** `pnpm lint` · `pnpm check` (0 error) · `pnpm test` (ผ่าน pre-push hook) · `server.test.ts` ทุก route ครอบ AC-SBO-04/06/07/08/11/16/17/18 · `svelte-autofixer` ทุก `.svelte` ที่แตะ · manual AC-SBO-01..15 ด้วยบัญชี SA, SM ศูนย์ A, SM ศูนย์ B, SM ศูนย์ A+B, SM ศูนย์ A + registration_staff ศูนย์ B, registration_staff

## 5. Impact

- **Docs:** `role-permission-matrix.md` §1.1 เพิ่มแถว「Scanner / Kiosk Device (`/back-office/scanners`)」SA ✓ · SM scope · BAN — · อื่น — · `api-contract.md` §2.2 หัวข้อ admin เปลี่ยน "SA เท่านั้น" → "SA ทุกศูนย์ / SM เฉพาะศูนย์" + เพิ่ม `GET`/`PATCH` + error 404 นอก scope · `schema.md` §3.11 `staff_pin_updated_by` = SA หรือ SM และการแก้ชื่อ/สถานะทำฝั่ง server · `schema.md` §3.11.1 `scanner_staff_pin.updated_by` = SA หรือ SM
- **Code:** ตาม `affects:` · ไม่แตะ `registry` VDU (ยังให้เขียนเฉพาะ SA/`_admin` — server ใช้ admin credential)
- **ความสัมพันธ์กับ CR-162:** path `/back-office/kiosk-banners` และ `/api/back-office/kiosk-banners/**` คงเดิม · component ตัวเลือกศูนย์ `ShelterScopeSelect` ใช้ซ้ำในหน้า banner ได้ (หน้า scanners ไม่ใช้เป็นตัวกรอง — FR-SBO-27) · เมนู banner ของ CR-162 (§2 แถว Back-office: เมนู「แบนเนอร์ Kiosk」ใน `backoffice-navbar/static.ts`) ย้ายไปเป็นเมนูลูก「จัดการแบนเนอร์」ใต้「จัดการ Kiosk」— งาน CR-162 เป็นผู้เพิ่มเมนูนี้ตอน implement route (CR นี้ไม่ใส่) · เปลี่ยนเฉพาะตำแหน่งและชื่อเมนู ไม่เปลี่ยน FR ของ CR-162 · เงื่อนไขเห็นเมนูของ `banner_staff` (FR-KBN-27) ใช้กลไก FR-SBO-26 · `banner_staff` เห็นเมนูแม่「จัดการ Kiosk」ได้เพราะเป็นแค่ตัวจัดกลุ่ม (มีลูกเดียวคือ「จัดการแบนเนอร์」)
- **ไม่กระทบ:** `/api/v1/scanner/bootstrap`, `/api/v1/scanner/kiosk/*`, `scanner_client`, `scanner_secrets` `_security`, `sync:central`
- **ความเสี่ยง:** SM ดู staff PIN ของเครื่องในศูนย์ได้ — ยอมรับเพราะ PIN ใช้ได้เฉพาะที่เครื่องนั้นและ SM เป็นผู้รับผิดชอบเจ้าหน้าที่หน้าตู้อยู่แล้ว · ทุก reveal ถูก log (FR-SBO-07)
- **ความเสี่ยง:** SM ลบเครื่องในศูนย์ได้ — ลบแล้วย้อนกลับไม่ได้ (ลบ registry doc + PIN doc) ตู้ใช้งานไม่ได้ทันทีและต้องสร้างเครื่องใหม่ + ตั้ง secret ที่ตู้ใหม่ · ยอมรับเพราะเป็นสิทธิ์เดียวกับที่ SA มีอยู่เดิม และหน้า UI ต้อง confirm ก่อนลบ (พฤติกรรมเดิม) · ทุกการลบถูก log (FR-SBO-07)

## 6. Migration

N/A — ไม่เปลี่ยนรูปร่าง doc ที่ persist · ไม่ bump `schema_v` · เครื่องที่มีอยู่ใช้งานต่อได้ทันที · deploy frontend อย่างเดียว

## 7. Decision log

> ทุกข้อด้านล่างเป็นการตัดสินระดับทีม kiosk — CR ยังเป็น `proposed` รอเจ้าของโครงการ approve

- 2026-10-12 — proposed · ทีม kiosk เคาะ: SA + SM เห็นและจัดการได้ · SM ทำได้ทุก action รวม reveal PIN · หน้าเดิม redirect ไป back-office
- 2026-10-12 — ทีม kiosk เคาะ: Why = วางฐานก่อนต่อยอด Kiosk Banner (issue #466) · เพิ่มเมนูแม่「จัดการ Kiosk」(FR-SBO-24/26) และตัวกรองศูนย์ (FR-SBO-27) ให้หน้า banner ใช้ต่อ
- 2026-10-12 — ทีม kiosk เคาะ: ไม่เพิ่ม capability role ใหม่ (ต่างจาก `banner_staff` ของ CR-162) · ศูนย์ของเครื่องแก้ไม่ได้ (FR-SBO-15) · นอก scope ตอบ 404 ไม่ใช่ 403 (FR-SBO-04)
- 2026-10-12 — ทีม kiosk เคาะ: scope ของ SM ใช้ศูนย์ที่เลือกอยู่ (active shelter) เหมือนหน้า back-office อื่น — ใช้ `requireManager` เดิม · SM ไม่มีตัวกรองศูนย์ / mode รวมหลายศูนย์ (FR-SBO-10/20/22/27)
- 2026-10-12 — ทีม kiosk เคาะ: เมนูแม่「จัดการ Kiosk」มีลูก「จัดการอุปกรณ์」และ「จัดการแบนเนอร์」— เมนู banner ของ CR-162 ย้ายมาอยู่ใต้เมนูแม่นี้และเปลี่ยนชื่อจาก「แบนเนอร์ Kiosk」(FR-SBO-24/26)
- 2026-10-12 — ทีม kiosk เคาะ (หลัง review): เมนู「จัดการแบนเนอร์」ให้งาน CR-162 เป็นผู้เพิ่ม ไม่ใส่ล่วงหน้า (กัน dead link) · `GET` ขอศูนย์นอก scope ตอบ `403` แทน `200 []` ให้ error contract ตรงกับ `POST` · `PATCH` retry เมื่อ `_rev` ชน สูงสุด 3 ครั้ง เพราะ kiosk เขียน `last_seen_at` ทุก bootstrap/lookup/check-in/register
- 2026-10-12 — ทีม kiosk เคาะ (หลัง implement): ตัดตัวกรองศูนย์ของ SA ออก — ทุก role ใช้ศูนย์ที่เลือกอยู่ (active shelter) ทั้งรายการและ dialog สร้างเครื่อง ให้หน้าทำงานเหมือนหน้า back-office อื่น · SA ดูศูนย์อื่นด้วยการสลับศูนย์ (FR-SBO-22/27, AC-SBO-02/13) · API `GET /api/v1/scanner/devices` คงเดิม (SA ไม่ส่ง `shelter_code` ยังได้ทุกศูนย์ — หน้าไม่ใช้)
- ทีม kiosk เคาะตัดทิ้ง: ย้าย `scanner_device` ไปไว้ใน `shelter_{code}` (schema.md §3.11 Future Consideration) — ต้องเปลี่ยน device auth ของ kiosk ทั้งชุด เกินขอบเขตการย้ายสิทธิ์
- ทีม kiosk เคาะตัดทิ้ง: SM เห็นรวมทุกศูนย์ที่ตัวเองเป็น SM (「ทุกศูนย์ของฉัน」) — ต้องทำ guard ใหม่แทน `requireManager` และหน้าจะทำงานต่างจากหน้า back-office อื่น · SM หลายศูนย์มีน้อย สลับศูนย์แทนได้
- ทีม kiosk เคาะตัดทิ้ง: คงหน้าไว้ทั้ง system-management และ back-office — ซ้ำซ้อน และ SA เข้า back-office ได้อยู่แล้ว
