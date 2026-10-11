---
id: CR-162
title: Kiosk banner — แบนเนอร์รูปภาพประชาสัมพันธ์บนหน้าแรก kiosk (attract mode · ตั้งเวลา · เรียงลำดับ · เลือกศูนย์)
status: approved
date: 2026-10-11
created: 2026-10-11
updated: 2026-10-11
requested_by: ทีม kiosk
decided_by: Soravit Sukkarn (Team Lead) — อนุมัติ 2026-10-11 (Asia/Bangkok)
decision_date: 2026-10-11
layer: volatile
base_branch: feat/pre-register_kiosk
depends_on:
  - CR-151 (kiosk home `/kiosk`, `/api/v1/scanner/kiosk/*`, scanner client allowlist FR-KPC-06)
  - CR-152 (`POST /api/v1/scanner/kiosk/config` — pattern ที่ต้อง mirror)
affects:
  - docs/data/schema.md §3.12 (ใหม่) `kiosk_banner` — schema_v 1 (doc type ใหม่ ใน DB `registry`) *(อัปเดตแล้วใน PR ของ CR นี้)*
  - docs/data/api-contract.md §2.3 (ใหม่) kiosk banner — `POST /kiosk/banners`, `GET /kiosk/banners/{id}/image`, `/api/back-office/kiosk-banners/**` *(อัปเดตแล้วใน PR ของ CR นี้)*
  - docs/prd/role-permission-matrix.md §1.1 (+ role `banner_staff` — 10 → 11 บทบาท) · docs/data/schema.md §6 `_users.roles` *(อัปเดตแล้วใน PR ของ CR นี้)*
  - frontend/src/lib/auth/roles.ts (`BANNER_STAFF` + `STAFF_CAPABILITIES`) · frontend/src/lib/features/users/domain/schema.ts · frontend/src/lib/server/user-service.ts
  - frontend/src/lib/components/backoffice-navbar/static.ts (เมนู「แบนเนอร์ Kiosk」)
  - frontend/.env.example (server-only secret ของ signed image URL)
  - docs/features/kiosk-banner-design-guideline.md (ใหม่ — แนวทาง implement, active)
  - frontend/src/lib/features/kiosk-banners/{domain,data,application,ui,index.ts} (ใหม่ — back-office)
  - frontend/src/lib/server/kiosk-banners/** (ใหม่ — registry CRUD, signed image URL)
  - frontend/src/lib/features/kiosk/data/kiosk-banners.api.ts (ใหม่) · features/kiosk/ui/kiosk-banner-attract.svelte (ใหม่) · features/kiosk/index.ts
  - frontend/src/routes/kiosk/+page.svelte (mount attract overlay)
  - frontend/src/routes/(protected)/back-office/kiosk-banners/+page.svelte (ใหม่)
  - frontend/src/routes/api/back-office/kiosk-banners/** (ใหม่ + server.test.ts)
  - frontend/src/routes/api/v1/scanner/kiosk/banners/** (ใหม่ + server.test.ts)
  - scanner_client/app/manager.py `_route_kiosk_api` allowed_paths · scanner_client/tests/test_manager.py
  - frontend/src/lib/server/registry-design.ts `buildRegistryValidateDocUpdate()` (type `kiosk_banner`)
  - frontend/e2e/kiosk-banners.test.ts (ใหม่)
  - path ทั้งหมด: docs/features/kiosk-banner-design-guideline.md §2.3
why: >
  หน้าแรก kiosk ค้างอยู่โดยไม่มีผู้ใช้เกือบตลอดเวลา ศูนย์ต้องใช้หน้าจอนี้แจ้งข่าวสาร (ตารางแจกอาหาร, จุดบริการ, คำเตือน)
  ทีมเคยใช้ banner รูปภาพบน kiosk ในระบบก่อนหน้า (ghosa) และพิสูจน์แล้วว่าพอสำหรับงานประชาสัมพันธ์หน้าตู้
migration: N/A — doc type ใหม่ ไม่มีข้อมูลเดิม; ไม่แตะ schema_v ของ doc type อื่น
---

# CR-162: Kiosk banner — แบนเนอร์รูปภาพบนหน้าแรก kiosk

> **สถานะ:** approved เป็น spec เมื่อ 2026-10-11 (Asia/Bangkok) โดย Soravit Sukkarn (Team Lead) · ยังไม่ implement · docs (schema.md §3.12, api-contract.md, role-permission-matrix.md) อัปเดตใน PR เดียวกับ CR นี้

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** เพิ่ม doc type `kiosk_banner` (รูป + ช่วงเวลาแสดง + ลำดับ + ระยะเวลาต่อสไลด์ + ศูนย์ปลายทาง) ใน DB `registry` · หน้า back-office สำหรับจัดการ · หน้า `/kiosk` เข้า **attract mode** วนแสดงแบนเนอร์เต็มจอเมื่อไม่มีการแตะ 30 วินาที แตะจอ = กลับหน้าเลือกวิธี
> - **เพื่อใคร / ทำไม:** role ใหม่ `banner_staff` + ผู้จัดการศูนย์ + SA ประชาสัมพันธ์ข่าวสารที่ตู้ได้เองโดยไม่ต้องแตะเครื่อง
> - **Dev ต้องทำอะไร:** บน base `feat/pre-register_kiosk` — feature `kiosk-banners` (back-office CRUD + อัปโหลดรูป) · `POST /api/v1/scanner/kiosk/banners` (device auth, mirror `kiosk/config`) · signed GET URL สำหรับรูป · overlay บน `/kiosk` · เพิ่ม path ใน allowlist ของ scanner client
> - **กระทบ schema / scope:** doc type ใหม่ `kiosk_banner` schema_v 1 · role ใหม่ `banner_staff` (compound scoped) · ไม่กระทบ doc type เดิม · อ่านผ่าน Node BFF → CouchDB (ไม่ผ่าน worker/Mongo)
> - **Design pattern:** [`docs/features/kiosk-banner-design-guideline.md`](../../features/kiosk-banner-design-guideline.md)

---

## 1. Why

1. หน้า `/kiosk` (IdentityMethodSelector, CR-151) เป็นหน้าที่ตู้ค้างอยู่นานที่สุด และยังไม่มี idle/attract mode
2. model ที่ต้องการ: รูป + ระยะเวลาต่อสไลด์ + ช่วงเวลาแสดง + สถานะ + ศูนย์ปลายทาง — ตามที่ทีมเคยใช้งานจริงบน kiosk ในระบบก่อนหน้า
3. หน้า `/kiosk` ไม่มีพื้นที่ว่างที่ 1024×600 (`KIOSK_COMPACT_MEDIA`) — การแทรกแถบ banner จะเบียดการ์ดเลือกวิธี จึงใช้ overlay เต็มจอตอน idle แทน
4. ประกาศ CR-100 (`announcement`) เป็นข้อความล้วน ไม่มีรูป/ช่วงเวลา/เป้าหมายรายศูนย์ และเป็นของ public portal

**ทางเลือก**

| ทางเลือก                                     | สถานะ                                                                                                    |
| :------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| ใช้/ขยาย `announcement` (CR-100)             | ตัดทิ้ง — ไม่มีรูป/ช่วงเวลา/ศูนย์; ขยายต้อง bump schema_v + PROJECTION_VERSION ของ public plane          |
| แถบ banner ถาวรบนหน้า `/kiosk`               | ตัดทิ้ง — ไม่มีที่ว่างที่ 1024×600; เบียดการ์ดเลือกวิธี (FR-KPC-13)                                      |
| attract overlay เต็มจอเมื่อ idle บน `/kiosk` | **เลือก** — ไม่แตะ layout เดิม, ใช้จอเต็มที่ตอนไม่มีผู้ใช้                                               |
| ส่งรูปเป็น base64 ใน response ของ POST       | ตัดทิ้ง — payload ใหญ่ทุกครั้งที่ refresh (20 รูป × 2 MB)                                                |
| signed GET URL สำหรับรูป                     | **เลือก** — `<img>` ส่ง GET ได้เท่านั้น และ `_route_kiosk_api` แนบ device header เฉพาะ POST ใน allowlist |
| projection ไป Mongo + FastAPI                | ตัดทิ้ง — kiosk ไม่ใช่ anonymous public; ไม่คุ้มเพิ่ม projector                                          |

---

## 2. Change (before → after)

| หัวข้อ                                     | ก่อน                                                                             | หลัง                                                                                   |
| :----------------------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| DB `registry`                              | ไม่มี banner                                                                     | + `kiosk_banner:{ulid}` schema_v 1 พร้อม attachment `image`                            |
| Back-office                                | —                                                                                | + เมนู「แบนเนอร์ Kiosk」ที่ `/back-office/kiosk-banners`                               |
| Roles (`roles.ts`, role matrix)            | 10 บทบาท                                                                         | + `banner_staff` (`{code}:banner_staff`) — SM / SA grant ได้                           |
| API ฝั่งเครื่อง                            | bootstrap, kiosk/{config, lookup, check-in, register, staff-pin/verify, thaid/*} | + `POST kiosk/banners` · `GET kiosk/banners/{id}/image` (signed, ไม่ใช้ device header) |
| scanner client `allowed_paths` (FR-KPC-06) | 8 path                                                                           | + `/api/v1/scanner/kiosk/banners`                                                      |
| หน้า `/kiosk`                              | การ์ดเลือกวิธีค้างตลอด                                                           | idle 30 วินาที + มี banner → attract overlay; ไม่มี banner = เหมือนเดิม                |

---

## 3. Requirements

### 3.1 Data — `kiosk_banner` (schema.md §3.12)

| ID        | Requirement                                                                                                                                                                                                                                           |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBN-01 | `_id` = `kiosk_banner:{ulid}`, `type: 'kiosk_banner'`, `schema_v: 1`, DB `registry` (registry doc ไม่มี `shelter_code` envelope)                                                                                                                      |
| FR-KBN-02 | `title` str req ≤120 — ใช้ในหน้าจัดการและเป็น `alt` ของรูป                                                                                                                                                                                            |
| FR-KBN-03 | `caption` str opt ≤200 — ข้อความใต้รูปบน kiosk; render เป็น text เท่านั้น (ห้าม HTML)                                                                                                                                                                 |
| FR-KBN-04 | `image` = CouchDB attachment ชื่อ `image` req · `image/png` · `image/jpeg` · `image/webp` · ≤2 MB · server ตรวจ magic bytes (mirror `decodeKioskPhoto` ใน `features/kiosk/server/kiosk-photo.server.ts`) ไม่เชื่อ extension/`Content-Type` ของ client |
| FR-KBN-05 | `order` int req ≥1 default 1 — kiosk เรียง `order` asc → `start_at` asc → `_id` asc                                                                                                                                                                   |
| FR-KBN-06 | `duration_sec` int req 3–60 default 10                                                                                                                                                                                                                |
| FR-KBN-07 | `start_at`, `end_at` ISO ts req · `end_at` > `start_at` (reject ทั้ง Zod และ VDU)                                                                                                                                                                     |
| FR-KBN-08 | `status` enum(`active`,`inactive`) req default `active`                                                                                                                                                                                               |
| FR-KBN-09 | `shelter_codes` str[] req ≥1 — เทียบกับ `shelter_code` ของ device principal                                                                                                                                                                           |
| FR-KBN-10 | `created_at`, `updated_at`, `created_by` ตาม envelope §0; timestamp สร้าง ณ เวลาเรียก                                                                                                                                                                 |
| FR-KBN-11 | ลบ = hard delete ทั้ง doc (attachment ลบไปด้วย)                                                                                                                                                                                                       |

### 3.2 Back-office

| ID        | Requirement                                                                                                                                                                                                                                                                                |
| :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBN-20 | หน้า `/back-office/kiosk-banners` แสดง 2 แท็บ:「กำลังแสดง / รอแสดง」(`end_at` ≥ now, เรียง `start_at` asc) ·「หมดอายุ」(`end_at` < now, เรียง `end_at` desc)                                                                                                                               |
| FR-KBN-21 | ฟอร์มสร้าง/แก้ไข Superforms + Zod ครบทุก field §3.1 · แก้ไขโดยไม่เลือกรูปใหม่ = คงรูปเดิม · ใต้ช่องอัปโหลดแสดงชนิดไฟล์ที่รับ (png / jpeg / webp) และขนาดสูงสุด 2 MB                                                                                                                        |
| FR-KBN-22 | อัปโหลดรูปส่งเป็น JSON base64 (back-office route เป็น JSON-only) · decode + ตรวจตาม FR-KBN-04 ฝั่ง server ก่อน PUT attachment                                                                                                                                                              |
| FR-KBN-23 | เปิด/ปิดการแสดงผลใช้ `Switch` ที่มี label สถานะ (「แสดงบนตู้」/「ไม่แสดง」) ส่ง `PATCH` · ลบ = `DELETE` พร้อม confirm dialog ผูกกับ banner รายการนั้น · ห้ามใช้ไอคอนรูปตาแทนสถานะ (สับสนกับ preview)                                                                                       |
| FR-KBN-24 | สิทธิ์จัดการ (อ่าน/สร้าง/แก้/เปิดปิด/ลบ): `system_admin` ทุกศูนย์ · `shelter_manager` และ `banner_staff` เฉพาะ banner ที่ `shelter_codes` ทั้งหมด (ทั้งค่าเดิมและค่าใหม่) อยู่ใน scope ของตัวเอง · role อื่น 403                                                                           |
| FR-KBN-25 | รูปในหน้าจัดการโหลดผ่าน back-office route ที่ตรวจ session + สิทธิ์                                                                                                                                                                                                                         |
| FR-KBN-26 | เพิ่ม role `banner_staff` ใน `roles.ts` (`BANNER_STAFF`, อยู่ใน `STAFF_CAPABILITIES`) รูปแบบ compound `{shelter_code}:banner_staff` คู่กับ `shelter:{code}` · SA และ SM ของศูนย์นั้น grant/revoke ได้ผ่านหน้าจัดการผู้ใช้เดิม                                                              |
| FR-KBN-27 | `banner_staff` เห็นเฉพาะเมนู「แบนเนอร์ Kiosk」ใน portal และไม่ได้สิทธิ์อื่นของศูนย์                                                                                                                                                                                                        |
| FR-KBN-28 | เลือกไฟล์แล้วแสดงภาพตัวอย่างทันที (client-side object URL) ก่อนบันทึก · หน้าแก้ไขแสดงรูปปัจจุบัน และเมื่อเลือกรูปใหม่ให้เห็นทั้งรูปเดิมและรูปใหม่                                                                                                                                          |
| FR-KBN-29 | ปุ่ม「ดูตัวอย่างบน kiosk」(ในรายการและในฟอร์ม) เปิด modal จำลองจอ 1024×600 และ 1080×1920 (สลับได้) · ใช้ component overlay ตัวเดียวกับบนตู้ (FR-KBN-44/45) · ในรายการ = เล่นทุก banner ที่ active ของศูนย์ที่เลือกตามลำดับจริง · ในฟอร์ม = เล่น banner ที่กำลังแก้ (รวมรูปที่ยังไม่บันทึก) |

> หน้าอยู่ใต้ `/back-office/` (ไม่ใช่ `system-management/` ที่ `requireAdmin`) เพื่อให้ SM และ `banner_staff` เข้าถึงได้

### 3.3 Kiosk API (device auth)

| ID        | Requirement                                                                                                                                                                                                                            |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBN-30 | `POST /api/v1/scanner/kiosk/banners` ยืนยันเครื่องด้วย `authenticateScannerDevice` (`lib/server/scanners/device-credentials.ts`) แบบเดียวกับ `kiosk/config` · 401 `DEVICE_AUTH_FAILED` · 503 `DEPENDENCY_UNAVAILABLE`                  |
| FR-KBN-31 | scope จาก `shelter_code` ของ device principal เท่านั้น (ห้ามใช้ query ของ URL / display context)                                                                                                                                       |
| FR-KBN-32 | คืนเฉพาะ `status = active` และ `start_at ≤ now < end_at` และ `shelter_codes` มี `shelter_code` ของเครื่อง · เรียงตาม FR-KBN-05 · สูงสุด 20 รายการ                                                                                      |
| FR-KBN-33 | Response: `{ banners: [{ id, title, caption, duration_sec, image_url }], fetched_at }` · header `cache-control: no-store` + `pragma: no-cache` (FR-KPC-07)                                                                             |
| FR-KBN-34 | `image_url` = `GET /api/v1/scanner/kiosk/banners/{id}/image?exp=&sig=` — HMAC-SHA256 ด้วย server-only secret, อายุ 15 นาที · sig ผิด/หมดอายุ = 403 · ไม่พบ / inactive / หมดช่วงเวลา = 404 · ไม่ต้องใช้ device header                   |
| FR-KBN-35 | scanner client: เพิ่ม `/api/v1/scanner/kiosk/banners` ใน `allowed_paths` ของ `_route_kiosk_api` (POST same-origin เท่านั้น) · GET รูปผ่าน `route.continue_` โดยไม่มี credential ตาม logic เดิม · path ต้องไม่อยู่ใน `LOCAL_ONLY_PATHS` |

### 3.4 Kiosk UI (`/kiosk`)

| ID        | Requirement                                                                                                                                                                                                      |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBN-40 | client `features/kiosk/data/kiosk-banners.api.ts` ใช้ plain `fetch` (mirror `kiosk-config.api.ts`: `cache: 'no-store'`, timeout 3 s) · ล้มเหลว = คืนรายการว่าง (fail soft) ไม่ cache error                       |
| FR-KBN-41 | ดึงรายการเมื่อเข้า `/kiosk` และทุก 5 นาทีระหว่างอยู่หน้าเดิม                                                                                                                                                     |
| FR-KBN-42 | ไม่มีการแตะ/คลิก/กดปุ่มบนหน้า `/kiosk` 30 วินาที และมี banner ≥1 → แสดง attract overlay เต็มจอ                                                                                                                   |
| FR-KBN-43 | แตะจอ/กดปุ่มใด ๆ ขณะ overlay แสดง → ปิด overlay กลับหน้าเลือกวิธี และ event นั้นไม่ทริกเกอร์การ์ดที่อยู่ข้างใต้ · เสียบบัตร = scanner client นำทางออกจาก `/kiosk` ตามเดิม                                        |
| FR-KBN-44 | สไลด์เปลี่ยนตาม `duration_sec` ของแต่ละรายการ วนต่อเนื่อง · fade ≤300 ms · dot indicator · รายการเดียว = ไม่หมุน · แสดงข้อความ「แตะหน้าจอเพื่อเริ่มใช้งาน」ตลอด                                                  |
| FR-KBN-45 | รูป `object-contain` (ไม่ crop) · `caption` ใต้รูป · พอดีไม่ scroll ที่ 1024×600 (`kiosk-compact`) และ 1080×1920 (`kiosk-portrait`) · ใช้ media literal เดียวกับ `kiosk-layout.ts` (ผ่าน `kiosk-layout.test.ts`) |
| FR-KBN-46 | overlay ต้องไม่บัง `SystemBannerHost` (ประกาศระบบ fixed bottom)                                                                                                                                                  |
| FR-KBN-47 | ไม่มี banner / API ล้มเหลว / รูปโหลดไม่ได้ → ไม่แสดง overlay (หรือข้ามสไลด์ที่รูปเสีย) · ไม่มี JS error · หน้าเลือกวิธีทำงานปกติ                                                                                 |

---

## 4. Acceptance

- banner ที่ `start_at` อนาคต ไม่ขึ้นจนถึงเวลา · หลัง `end_at` หายภายใน 5 นาที
- banner ของศูนย์ A ไม่ขึ้นบนตู้ศูนย์ B · `status = inactive` ไม่ขึ้น · เรียงตาม `order` จริง
- ไฟล์ `.png` ที่เนื้อในไม่ใช่ PNG หรือ >2 MB → reject · `end_at ≤ start_at` → reject ทั้งฟอร์มและ VDU
- `/kiosk` ไม่มี banner → ไม่มี overlay ไม่มี JS error · มี banner + idle 30 s → overlay · แตะ → กลับหน้าเลือกวิธีโดยไม่เลือกการ์ด
- `image_url` หมดอายุหรือแก้ `sig` → 403
- `POST kiosk/banners` ที่ header ปลอม/เครื่อง inactive → 401 และไม่ query banner
- scanner client: allowlist ฉีด header ให้ `POST /kiosk/banners` same-origin เท่านั้น
- `banner_staff` / ผู้จัดการศูนย์ A แก้ banner ของศูนย์ B ไม่ได้ · ย้าย banner ของ B มาเป็นของ A ไม่ได้ · role อื่นของศูนย์ A ได้ 403
- SM ของศูนย์ A grant `A:banner_staff` ได้ · `banner_staff` ไม่เห็นเมนูอื่น
- เลือกไฟล์แล้วเห็นภาพตัวอย่างทันที · หน้าแก้ไขแสดงรูปปัจจุบัน · ปุ่ม「ดูตัวอย่างบน kiosk」เล่นสไลด์ที่ 2 ขนาดจอได้ถูกต้อง
- Switch เปิด/ปิดเปลี่ยน `status` ผ่าน `PATCH` และ label ตรงกับสถานะจริง
- tests: domain (schema, active window, sort), signed URL, back-office + kiosk route `server.test.ts`, `kiosk-banners.api.test.ts`, attract overlay component test (fake timers), `scanner_client/tests/test_manager.py` allowlist case, e2e back-office CRUD

---

### 3.5 Out of scope (owner เคาะ 2026-10-11)

- แสดง banner ที่หน้าอื่นนอกจาก idle บน `/kiosk` (เช่นหน้า「เสร็จสิ้น」)
- แถบ banner ถาวรบนหน้า `/kiosk` รวมถึงตู้แนวตั้ง 1080×1920
- รูปแยกตามแนวจอ — ใช้รูปเดียว + `object-contain`
- ฟิลด์ภาษาอังกฤษ (`title_en` / `caption_en`)

---

## 5. Impact

- **ใหม่:** feature `kiosk-banners`, `lib/server/kiosk-banners`, routes back-office + kiosk API, หน้า admin, kiosk overlay, schema.md §3.12, api-contract.md
- **แก้:** `routes/kiosk/+page.svelte`, `features/kiosk/index.ts`, `scanner_client/app/manager.py`, VDU ของ `registry`, `lib/auth/roles.ts`, หน้าจัดการผู้ใช้ (ตัวเลือก role), portal nav, role-permission-matrix, schema.md §6
- **ไม่กระทบ:** worker, FastAPI, Mongo, `announcement` (CR-100), flow ค้นหา/ลงทะเบียนของ kiosk
- **Base branch:** โค้ดยึด `feat/pre-register_kiosk` (ยังไม่ merge เข้า develop) — branch implementation ต้องแตกจาก branch นั้น และ merge ตามหลัง CR-151/152 · เอกสารของ CR นี้เข้า `develop` ผ่าน branch `docs/cr-162-kiosk-banner`

## 6. Migration

N/A — doc type ใหม่

## Decision log

- 2026-10-11 — proposed · owner เลือก scope banner รูปภาพ, track เป็นไฟล์ CR ใน `14-kiosk/`, ยึด base code `feat/pre-register_kiosk`
- 2026-10-11 — ไม่รองรับ iframe/link slide (เปิดเว็บภายนอกบนตู้ + เสี่ยงรั่ว device credential)
- 2026-10-11 — `caption` เป็น text เท่านั้น ไม่รองรับ HTML
- 2026-10-11 — owner เคาะ: เพิ่ม role `banner_staff` และให้ `shelter_manager` + `system_admin` จัดการได้ด้วย (FR-KBN-24/26/27) · ยืนยันค่า idle 30 s, refresh 5 นาที, รูป ≤2 MB, `duration_sec` 3–60
- 2026-10-11 — เอกสารเป็น docs-only PR เข้า `develop` (branch `docs/cr-162-kiosk-banner`); implementation แยกเป็นงานถัดไปบน base `feat/pre-register_kiosk`
- 2026-10-11 — เพิ่ม FR-KBN-21/23/28/29: แจ้งชนิด/ขนาดไฟล์, Switch สถานะ, preview ตอนเลือกไฟล์ + รูปปัจจุบันในหน้าแก้ไข, ปุ่มดูตัวอย่างบน kiosk (จากผลทดสอบระบบเดิมที่ไม่มีทั้งสี่ข้อ)
- 2026-10-11 — owner เคาะ out of scope §3.5 (คงค่าเดิมทั้งหมด)
- 2026-10-11 — **approved** โดย Soravit Sukkarn (Team Lead) รวมถึง role ใหม่ `banner_staff` · รันเลข CR-162 (ล่าสุดบน develop = CR-161)
