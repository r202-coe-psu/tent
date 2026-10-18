---
id: CR-162
title: Kiosk banner — แบนเนอร์รูปภาพประชาสัมพันธ์บนหน้าแรก kiosk (attract mode · ตั้งเวลา · เรียงลำดับ · ศูนย์เดียวต่อ banner · แยกขนาดจอ)
status: approved
date: 2026-10-11
created: 2026-10-11
updated: 2026-10-18
requested_by: ทีม kiosk
decided_by: Soravit Sukkarn (Team Lead) — อนุมัติ 2026-10-11 (Asia/Bangkok) scope เดิม · Team Lead อนุมัติส่วนที่ปรับ/เพิ่ม 2026-10-15..17 ทั้งหมด รวม §7 Q1–Q5 ตามข้อเสนอ เมื่อ 2026-10-18
decision_date: 2026-10-18
layer: volatile
base_branch: feat/pre-register_kiosk
depends_on:
  - CR-151 (kiosk home `/kiosk`, `/api/v1/kiosk/*` — เดิม `/api/v1/scanner/kiosk/*` ก่อน CR-165, client allowlist FR-KPC-06)
  - CR-152 (`POST /api/v1/kiosk/config` — pattern ที่ต้อง mirror)
  - CR-165 (kiosk back-office, role `kiosk_staff`, `/api/v1/kiosk/*`, client `kiosk/`)
affects:
  - docs/data/schema.md §3.12 `kiosk_banner` — schema_v 1 (doc type ใหม่ ใน DB `registry`) · **ต้อง sync ใหม่ตาม §2.3** (`shelter_codes` → `shelter_code`, `screen_type`, VDU, index, path `/api/v1/kiosk/banners`, role `kiosk_staff`) · schema_v คง 1 (ยังไม่มี doc persist)
  - docs/data/schema.md §3.11 `scanner_device` (+ `banner_enabled`, `screen_type` optional · ไม่ bump schema_v) · docs/data/schema.md §6 `_users.roles` (`banner_staff` → `kiosk_staff` ตาม CR-165 — ยังไม่ได้ sync)
  - docs/data/api-contract.md §2.2 (`POST`/`PATCH /api/v1/kiosk/devices` รับ `screen_type`, `banner_enabled`) · §2.3 kiosk banner — `POST /kiosk/banners`, `GET /kiosk/banners/{id}/image`, `/api/back-office/kiosk-banners/**` (+ `PUT …/order`, กฎ back-office ตาม §2.4)
  - docs/prd/role-permission-matrix.md §1.1 แถว「Kiosk Banner」→ path `/back-office/kiosks/banners` · คอลัมน์ BAN → KIO (ตาม CR-165) · ไม่เพิ่ม role `banner_staff`
  - docs/changes/_index.md (แถว CR-162 — summary ยังเขียน `shelter_codes` / `banner_staff` / `/scanner/`)
  - docs/features/kiosk-banner-design-guideline.md (path map, role, client dir, หน้า back-office)
  - frontend/src/lib/features/kiosk-banners/{domain,data,application,ui,index.ts} (ใหม่ — back-office) · ui/{kiosk-banner-form,kiosk-banner-screen-card,kiosk-banner-screen-manager,kiosk-banner-order-list,kiosk-banner-row-actions,kiosk-banner-preview-dialog}.svelte
  - frontend/src/lib/features/shared/domain/kiosk-screen.ts (ใหม่ — enum + ขนาดจอ) · frontend/src/params/kioskScreen.ts (ใหม่)
  - frontend/src/lib/server/kiosk-banners/** (ใหม่ — signed-image-url, kiosk-banner.server, kiosk-banner-access)
  - frontend/src/lib/server/registry-design.ts (VDU branch `kiosk_banner` · `REGISTRY_DESIGN_VERSION` 5 → 6 → 7 · `KIOSK_BANNER_MANGO_INDEX`) · frontend/src/lib/server/registry-redeploy.ts (deploy Mango index ของ `registry` ใน `pnpm db:sync` / `sync:central`)
  - frontend/src/lib/features/kiosk/{data/kiosk-banners.api.ts,domain/kiosk-banner-feed.ts,ui/kiosk-banner-attract.svelte.ts,ui/kiosk-banner-attract.svelte,index.ts} (ใหม่) · frontend/src/routes/kiosk/+page.svelte (mount attract overlay)
  - frontend/src/routes/(protected)/back-office/kiosks/banners/{+page.svelte,new/+page.{ts,svelte},[id]/+page.{ts,svelte},[screen=kioskScreen]/+page.{ts,svelte}} (ใหม่)
  - frontend/src/routes/api/back-office/kiosk-banners/** (ใหม่ + `order/+server.ts` + server.test.ts)
  - frontend/src/routes/api/v1/kiosk/banners/{+server.ts,[id]/image/+server.ts} (ใหม่ + server.test.ts)
  - frontend/src/lib/components/backoffice-navbar/static.ts · frontend/src/lib/components/backoffice-navbar.svelte (active = match ยาวที่สุด)
  - frontend/src/lib/features/users/ui/user-form.svelte (คำอธิบาย `kiosk_staff` รวมแบนเนอร์)
  - frontend/src/lib/features/kiosk-devices/** (schema, remote, scanner-list Switch + ขนาดจอ) · frontend/src/lib/server/scanners/{device-repository,device-credentials}.ts · frontend/src/routes/api/v1/kiosk/devices/[id]/+server.ts
  - kiosk/app/manager.py `_route_kiosk_api` allowed_paths · kiosk/tests/test_manager.py
  - env ของ service frontend ใน compose prod (`BODY_SIZE_LIMIT=4M`) · frontend/.env.example (หมายเหตุ: `EXTERNAL_API_SECRET` ใช้ derive key ของ signed URL ด้วย)
  - frontend/e2e/kiosk-banners.test.ts (ใหม่)
  - path ทั้งหมด: docs/features/kiosk-banner-design-guideline.md §2.3
why: >
  หน้าแรก kiosk ค้างอยู่โดยไม่มีผู้ใช้เกือบตลอดเวลา ศูนย์ต้องใช้หน้าจอนี้แจ้งข่าวสาร (ตารางแจกอาหาร, จุดบริการ, คำเตือน)
  ทีมเคยใช้ banner รูปภาพบน kiosk ในระบบก่อนหน้า (ghosa) และพิสูจน์แล้วว่าพอสำหรับงานประชาสัมพันธ์หน้าตู้ ·
  (เพิ่ม 2026-10-15..17) CR-162 ออกแบบก่อน CR-165 — role, path, ชื่อ client และเมนูไม่ตรงกับโค้ดปัจจุบัน ·
  หน้า `/back-office/kiosk-banners` อยู่นอก route ที่ `kiosk_staff` เข้าได้ (FR-SBO-29) ·
  banner หลายศูนย์ทำให้ต้องตรวจสิทธิ์ทั้งค่าเดิมและค่าใหม่และต้องมี multi-select ขณะที่หน้า kiosk อื่นใช้ active shelter อย่างเดียว (FR-SBO-27)
migration: >
  N/A สำหรับ data — doc type ใหม่ ไม่มีข้อมูลเดิม (ยังไม่มี doc `kiosk_banner` ใน `registry`) จึงคง `schema_v 1` และเปลี่ยนรูปร่างได้โดยไม่ต้อง migrate ·
  `scanner_device.banner_enabled` / `screen_type` และ `kiosk_banner.screen_type` เป็น additive optional ไม่ backfill ·
  deploy ต้องตั้ง `BODY_SIZE_LIMIT=4M` และ deploy kiosk client ที่มี allowlist ใหม่ (รายละเอียด §6)
---

# CR-162: Kiosk banner — แบนเนอร์รูปภาพบนหน้าแรก kiosk

> **สถานะ:** approved เป็น spec เมื่อ 2026-10-11 (Asia/Bangkok) โดย Soravit Sukkarn (Team Lead) สำหรับ scope เดิม · ส่วนที่ปรับ 2026-10-15..17 Team Lead อนุมัติแล้วเมื่อ 2026-10-18 · implementation อยู่บน branch `feat-kiosk-banner` (ยังไม่ merge) · schema.md §3.11 / §3.12 / §6 / §7, api-contract.md §2.2 / §2.3 และ role-permission-matrix.md §1.1 sync ตามไฟล์นี้แล้ว (2026-10-18)

> **ส่วนที่ปรับ/เพิ่มเมื่อ 2026-10-15..17 — เสนอโดย ทีม kiosk · Team Lead อนุมัติแล้ว 2026-10-18:**
>
> - **Section ที่เพิ่ม/เขียนใหม่:** §1.2 · §2.1–§2.5 · §3.6 (FR-KBR-01..46) · §4.2 (AC-KBR-01..20) · §5 · §6 · §7
> - **แถวที่แก้ในที่เดิม:** FR-KBN-01, 03, 05, 09, 19 (เดิมใช้เลขซ้ำ FR-KBN-30), 20, 21, 24, 26, 27, 29, 30, 32, 34, 35, 43, 44, 45 · §3.5 ข้อ「รูปแยกตามแนวจอ」· §4.1 ข้อสิทธิ์ข้ามศูนย์ / role / kiosk client / path
> - **แถวที่ยังเป็นผลของการอนุมัติ 2026-10-11 โดยไม่ถูกแก้:** FR-KBN-02, 04, 06–08, 10, 11, 22, 23, 25, 28, 31, 33, 40–42, 46, 47
> - **แถวที่ปรับตาม CR-165 (approved แยกต่างหาก):** role `banner_staff` → `kiosk_staff`, `/api/v1/scanner/kiosk/*` → `/api/v1/kiosk/*`, `scanner_client/` → `kiosk/`

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** doc type `kiosk_banner` ใน DB `registry` (รูป + ช่วงเวลา + ลำดับ + ระยะเวลาต่อสไลด์ + ศูนย์เดียว `shelter_code` แก้ไม่ได้ + `screen_type` ตู้เล็ก/ตู้ใหญ่) · `scanner_device` มี `screen_type` + `banner_enabled` รายเครื่อง · `/kiosk` เข้า **attract mode** เมื่อไม่มีการแตะ 30 วินาที — overlay เต็มจอแสดง**รูปอย่างเดียว** (ไม่มี caption / dot / ข้อความ) วนตาม `duration_sec` · แตะจอ = กลับหน้าเลือกวิธี
> - **เพื่อใคร / ทำไม:** SA / SM / `kiosk_staff` ประชาสัมพันธ์ข่าวสารที่ตู้ได้เองโดยไม่ต้องแตะเครื่อง · หน้า banner ใช้ guard + active shelter เดียวกับหน้าจัดการอุปกรณ์ · ไม่เพิ่ม role (`kiosk_staff` ของ CR-165 แทน `banner_staff`)
> - **Dev ต้องทำอะไร:** feature `kiosk-banners` (back-office `/back-office/kiosks/banners` · `/new` · `/[id]` · `/{compact|portrait}` · อัปโหลดรูป JSON base64) · `POST /api/v1/kiosk/banners` (device auth, กรองตาม `shelter_code` + `screen_type` ของเครื่อง) · signed GET URL ของรูป (key derive จาก `EXTERNAL_API_SECRET`) · overlay บน `/kiosk` · `/kiosk/banners` ใน allowlist ของ `kiosk/app/manager.py` · `BODY_SIZE_LIMIT=4M`
> - **ลำดับ:** server กำหนด `order` (ฟอร์มไม่มีช่องลำดับ) · banner ใหม่ต่อท้ายของขนาดจอนั้น · จัดลำดับแบบลากวางในหน้าจัดการต่อขนาดจอ + `PUT /api/back-office/kiosk-banners/order`
> - **สิทธิ์:** SA ทุกศูนย์ · SM / `kiosk_staff` เฉพาะ `shelter_code` ของ banner · `{id}` นอก scope ตอบ `404` · list/create นอก scope `403`
> - **กระทบ schema / scope:** `kiosk_banner` v1 (ใหม่ ไม่ bump) · `scanner_device` +2 field optional (ไม่ bump) · อ่านผ่าน Node BFF → CouchDB (ไม่ผ่าน worker/Mongo/FastAPI)
> - **Design pattern:** [`docs/features/kiosk-banner-design-guideline.md`](../../features/kiosk-banner-design-guideline.md)

---

## 1. Why

### 1.1 ที่มาของ banner (2026-10-11)

1. หน้า `/kiosk` (IdentityMethodSelector, CR-151) เป็นหน้าที่ตู้ค้างอยู่นานที่สุด และยังไม่มี idle/attract mode
2. model ที่ต้องการ: รูป + ระยะเวลาต่อสไลด์ + ช่วงเวลาแสดง + สถานะ + ศูนย์ปลายทาง — ตามที่ทีมเคยใช้งานจริงบน kiosk ในระบบก่อนหน้า
3. หน้า `/kiosk` ไม่มีพื้นที่ว่างที่ 1024×600 (`KIOSK_COMPACT_MEDIA`) — การแทรกแถบ banner จะเบียดการ์ดเลือกวิธี จึงใช้ overlay เต็มจอตอน idle แทน
4. ประกาศ CR-100 (`announcement`) เป็นข้อความล้วน ไม่มีรูป/ช่วงเวลา/เป้าหมายรายศูนย์ และเป็นของ public portal

### 1.2 ทำไมต้องปรับหลัง CR-165 (เพิ่ม 2026-10-15)

1. **CR-162 กับโค้ดหลัง CR-165 ไม่ตรงกัน:** CR-162 ฉบับ 2026-10-11 ระบุ role `banner_staff`, path `/api/v1/scanner/kiosk/banners`, client `scanner_client/` และเมนูเดี่ยว「แบนเนอร์ Kiosk」· CR-165 (implement แล้วใน PR #496) แทนด้วย `kiosk_staff`, `/api/v1/kiosk/*`, `kiosk/` และเมนูแม่「จัดการ Kiosk」 แต่ schema.md §3.12, api-contract §2.3 และ guideline ยังไม่ sync
2. **`kiosk_staff` เข้าหน้า banner ไม่ได้:** `confineKioskStaffOnly` ให้ผู้ใช้ที่มีแค่ `kiosk_staff` เปิดได้เฉพาะ `/back-office/kiosks` และ path ย่อย · หน้า `/back-office/kiosk-banners` (path เดิม) จะ redirect ผู้ใช้กลุ่มนี้ทิ้ง ซึ่งขัด FR-SBO-40
3. **หลายศูนย์ซับซ้อนเกินใช้งาน:** `shelter_codes[]` บังคับให้ BFF ตรวจสิทธิ์ทั้งค่าเดิมและค่าใหม่, ต้องมี multi-select ที่ยังไม่มี component รองรับ และทำให้ SM ศูนย์ A มองไม่เห็น banner A+B ที่ SA สร้าง · หน้า kiosk ใน back-office ทุกหน้าทำงานกับ active shelter เท่านั้น (FR-SBO-22, FR-SBO-27)
4. **ข้อมูลรั่วข้ามศูนย์:** การตอบ `403` เมื่อเรียก `{id}` ของศูนย์อื่นบอกได้ว่ามี banner id นั้นอยู่ · CR-165 FR-SBO-04 ใช้ `404` กับกรณีเดียวกันของเครื่อง

### 1.3 ทางเลือก

| ทางเลือก                                     | สถานะ                                                                                                    |
| :------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| ใช้/ขยาย `announcement` (CR-100)             | ตัดทิ้ง — ไม่มีรูป/ช่วงเวลา/ศูนย์; ขยายต้อง bump schema_v + PROJECTION_VERSION ของ public plane          |
| แถบ banner ถาวรบนหน้า `/kiosk`               | ตัดทิ้ง — ไม่มีที่ว่างที่ 1024×600; เบียดการ์ดเลือกวิธี (FR-KPC-13)                                      |
| attract overlay เต็มจอเมื่อ idle บน `/kiosk` | **เลือก** — ไม่แตะ layout เดิม, ใช้จอเต็มที่ตอนไม่มีผู้ใช้                                               |
| ส่งรูปเป็น base64 ใน response ของ POST       | ตัดทิ้ง — payload ใหญ่ทุกครั้งที่ refresh (20 รูป × 2 MB)                                                |
| signed GET URL สำหรับรูป                     | **เลือก** — `<img>` ส่ง GET ได้เท่านั้น และ `_route_kiosk_api` แนบ device header เฉพาะ POST ใน allowlist |
| projection ไป Mongo + FastAPI                | ตัดทิ้ง — kiosk ไม่ใช่ anonymous public; ไม่คุ้มเพิ่ม projector                                          |

---

## 2. Change

### 2.1 Before → after

| เรื่อง                       | ก่อน (CR-162 ฉบับ 2026-10-11 / ก่อน CR-165)                                        | ปัจจุบัน (ปรับ 2026-10-15..17)                                                                             |
| :--------------------------- | :--------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| DB `registry`                | ไม่มี banner                                                                       | + `kiosk_banner:{ulid}` schema_v 1 พร้อม attachment `image` (§2.3)                                         |
| ศูนย์ของ banner              | `shelter_codes: string[]` ≥1 · แก้ได้                                              | `shelter_code: string` · = active shelter ตอนสร้าง · แก้ไม่ได้                                             |
| ขนาดจอของ banner / เครื่อง   | ไม่มี (รูปเดียว `object-contain`)                                                  | `screen_type` `compact` / `portrait` ต่อ banner และต่อเครื่อง · ตู้ดึงเฉพาะ banner ขนาดตัวเอง              |
| เปิด/ปิด banner รายเครื่อง   | ไม่มี                                                                              | `scanner_device.banner_enabled` (ไม่มี field = เปิด)                                                       |
| ลำดับ (`order`)              | กรอกในฟอร์ม                                                                        | server กำหนด · ฟอร์มไม่มีช่องลำดับ · จัดลำดับด้วยลากวางในหน้าขนาดจอ                                        |
| Roles                        | + `banner_staff` (`{code}:banner_staff`) — 10 → 11 บทบาท                           | ไม่เพิ่ม role · ใช้ `kiosk_staff` (CR-165) + SM + SA                                                       |
| ใครจัดการได้                 | SA ทุกศูนย์ · SM / `banner_staff` เมื่อ scope ครอบ `shelter_codes` ทั้งเดิมและใหม่ | SA ทุกศูนย์ · SM / `kiosk_staff` ของ `shelter_code` นั้น                                                   |
| `{id}` นอก scope             | `403`                                                                              | `404 NOT_FOUND`                                                                                            |
| หน้าจัดการ                   | `/back-office/kiosk-banners` (มีฟอร์มในหน้าเดียวกัน)                               | `/back-office/kiosks/banners` · `/new` · `/[id]` · `/{compact\|portrait}`                                  |
| guard หน้า                   | ไม่ระบุ                                                                            | `requireKioskManagement` เดิม                                                                              |
| เลือกศูนย์                   | "ศูนย์ที่เลือก" + multi-select ในฟอร์ม                                             | active shelter อย่างเดียว · ไม่มีตัวเลือก (SA สลับศูนย์ที่ shelter switcher)                               |
| เมนู                         | 「แบนเนอร์ Kiosk」ใน portal (เมนูเดี่ยว)                                           | ลูก「จัดการแบนเนอร์」ของ「จัดการ Kiosk」(CR-165 FR-SBO-42) · ไม่เพิ่ม tile ใน portal                       |
| API ฝั่งเครื่อง              | bootstrap, kiosk/{config, lookup, check-in, register, staff-pin/verify, thaid/*}   | + `POST /api/v1/kiosk/banners` · `GET /api/v1/kiosk/banners/{id}/image` (signed, ไม่ใช้ device header)     |
| signed image URL             | HMAC ด้วย server-only secret ใหม่                                                  | key derive จาก `EXTERNAL_API_SECRET` เดิม (ไม่มี env ใหม่) · `sig` เป็น hex lowercase                      |
| kiosk client `allowed_paths` | 8 path (`scanner_client/`)                                                         | 9 path ปัจจุบัน (รวม `/api/v1/kiosk/reprint`) + `/api/v1/kiosk/banners` = 10 path (`kiosk/app/manager.py`) |
| body upload                  | JSON base64 (FR-KBN-22)                                                            | เหมือนเดิม + `BODY_SIZE_LIMIT=4M` ที่ Node server                                                          |
| หน้า `/kiosk`                | การ์ดเลือกวิธีค้างตลอด                                                             | idle 30 วินาที + มี banner → attract overlay (รูปอย่างเดียว เต็มพื้นที่); ไม่มี banner = เหมือนเดิม        |

### 2.2 System design

```text
SA / SM / kiosk_staff  (_session, active shelter = X)
  └─ /back-office/kiosks/banners[/new|/{id}|/{compact|portrait}]   guard: requireKioskManagement (เดิม)
       └─ $lib/features/kiosk-banners  (TanStack Query → kiosk-banner.remote.ts)
            └─ /api/back-office/kiosk-banners[/{id}[/image]|/order]?shelter_code=X
                 │ requireShelterCapabilityCaller(cookie, SCANNER_MANAGER_CAPABILITIES)
                 │ list / create / order: X นอก scope → 403 · {id}: doc.shelter_code นอก scope → 404
                 └─ lib/server/kiosk-banners/kiosk-banner.server.ts (admin credential)
                      └─ registry  kiosk_banner:{ulid} + _attachments.image   (VDU ตรวจ field)

ตู้ kiosk (Chromium ภายใต้ kiosk/app/manager.py)
  └─ /kiosk → KioskBannerAttract (idle 30 s)
       ├─ POST /api/v1/kiosk/banners          ← manager.py แนบ X-Device-Id/Secret (allowlist, same-origin POST)
       │    authenticateScannerDevice → principal.shelter_code + screen_type + banner_enabled
       │    → listActiveForShelter → sign image_url
       └─ <img src="/api/v1/kiosk/banners/{id}/image?exp=&sig=">   (GET ไม่มี device header)
```

| ส่วน            | ไฟล์                                                                                    | หมายเหตุ                                                                                  |
| --------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| domain          | `lib/features/kiosk-banners/domain/{kiosk-banner,kiosk-banner-image}.ts`                | Zod, `isActiveAt`, `sortBanners`, `splitByView`, `createKioskBanner`, `decodeBannerImage` |
| server repo     | `lib/server/kiosk-banners/kiosk-banner.server.ts`                                       | `_find` ใน `registry` · PUT doc + inline attachment                                       |
| server auth     | `lib/server/kiosk-banners/kiosk-banner-access.ts`                                       | mirror `lib/server/scanners/scanner-access.ts`                                            |
| signed URL      | `lib/server/kiosk-banners/signed-image-url.ts`                                          | HMAC-SHA256 hex · `timingSafeEqual` · TTL 15 นาที                                         |
| back-office API | `routes/api/back-office/kiosk-banners/**`                                               | §2.4                                                                                      |
| kiosk API       | `routes/api/v1/kiosk/banners/+server.ts` · `[id]/image/+server.ts`                      | mirror `routes/api/v1/kiosk/config`                                                       |
| kiosk UI        | `lib/features/kiosk/{data/kiosk-banners.api.ts,ui/kiosk-banner-attract.svelte(.ts)}`    | kiosk ไม่ import `kiosk-banners`                                                          |
| back-office UI  | `routes/(protected)/back-office/kiosks/banners/**` · `lib/features/kiosk-banners/ui/**` | §2.5                                                                                      |
| kiosk client    | `kiosk/app/manager.py` `allowed_paths`                                                  | + `/api/v1/kiosk/banners`                                                                 |
| VDU             | `lib/server/registry-design.ts`                                                         | branch `type === 'kiosk_banner'` · version 5 → 6                                          |

### 2.3 Schema — `kiosk_banner` v1 (แทน schema.md §3.12 ทั้งตาราง)

| Field                                      | ชนิด                       | req | หมายเหตุ                                                                                                              |
| ------------------------------------------ | -------------------------- | --- | --------------------------------------------------------------------------------------------------------------------- |
| `_id`                                      | str                        | req | `kiosk_banner:{ulid}`                                                                                                 |
| `type`                                     | `"kiosk_banner"`           | req | —                                                                                                                     |
| `schema_v`                                 | int                        | req | `1`                                                                                                                   |
| `shelter_code`                             | str                        | req | ศูนย์ที่แสดง banner · = active shelter ของผู้สร้าง · **แก้ไม่ได้** หลังสร้าง · เทียบกับ `scanner_device.shelter_code` |
| `screen_type`                              | enum(`compact`,`portrait`) | opt | ขนาดจอที่แสดง · ไม่มี field = `compact` · แก้ได้ (ย้ายขนาด → `order` ต่อท้ายขนาดใหม่)                                 |
| `title`                                    | str                        | req | trim · 1–120 ตัวอักษร · เป็น `alt` ของรูป                                                                             |
| `caption`                                  | str\|null                  | opt | trim · ≤200 ตัวอักษร · text เท่านั้น · เก็บและแก้ได้ใน back-office แต่ไม่แสดงบนตู้ (FR-KBR-46)                        |
| `order`                                    | int                        | req | ≥1 · server กำหนด (FR-KBN-05)                                                                                         |
| `duration_sec`                             | int                        | req | 3–60 · default `10`                                                                                                   |
| `start_at`                                 | ts                         | req | ISO UTC · รวม                                                                                                         |
| `end_at`                                   | ts                         | req | ISO UTC · ไม่รวม · `> start_at`                                                                                       |
| `status`                                   | enum(`active`,`inactive`)  | req | default `active`                                                                                                      |
| `created_at` / `updated_at` / `created_by` | ts / ts / str              | req | envelope §0 · `created_by` = `_users` name                                                                            |
| `_attachments.image`                       | attachment                 | req | `image/png` · `image/jpeg` · `image/webp` · ≤2 MB หลัง decode · `content_type` มาจาก magic bytes                      |

- **ไม่มี** `shelter_codes`
- **`scanner_device` (schema.md §3.11) เพิ่ม field optional:** `screen_type` (`compact` \| `portrait` · ไม่มี = `compact`) · `banner_enabled` (boolean · ไม่มี = `true`) · ไม่ bump `schema_v`
- **แสดงบนตู้เมื่อ:** เครื่องมี `banner_enabled ≠ false` และ banner `status = active` และ `start_at ≤ now < end_at` (เวลา server) และ `shelter_code` = ศูนย์ของเครื่อง และ `screen_type` = ขนาดจอของเครื่อง (ไม่มี field = `compact` ทั้งสองฝั่ง) · เรียง `order` → `start_at` → `_id` · สูงสุด 20 (กรองก่อนตัด cap)
- **VDU:** reject เมื่อ `shelter_code` ว่าง/ไม่ใช่ string, `screen_type` นอก enum, `title` ว่างหรือ >120, `caption` >200, `order` ไม่ใช่ int ≥1, `duration_sec` ไม่ใช่ int 3–60, `status` นอก enum, `end_at ≤ start_at`, `schema_v ≠ 1` · ไม่ตรวจ doc ที่ `_deleted` · เงื่อนไขผู้เขียนเดิมของ `registry` (`_admin` / SA) คงไว้
- **Index (Mango):** `kiosk-banner-by-shelter` = `["type", "shelter_code"]` (แทน `(type, status, end_at)` เดิม) · CouchDB ใช้ json index เฉพาะเมื่อ selector ระบุครบทุก field จึงตรงกับ selector ของรายการ banner พอดี · deploy โดย `pnpm db:sync` / `sync:central` (`registry-redeploy.ts`)
- **ลบ:** hard delete ทั้ง doc

### 2.4 API

**ฝั่งตู้ — ไม่เปลี่ยน shape จาก api-contract §2.3 · path ตาม CR-165**

| Method | Path                                                        | Auth              | ผล                                                                                                                                                                                                       |
| ------ | ----------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/v1/kiosk/banners`                                     | device credential | `200 { banners: [{ id, title, caption, duration_sec, image_url }], fetched_at }` · `401 DEVICE_AUTH_FAILED` · `503 DEPENDENCY_UNAVAILABLE` · ทุก response `cache-control: no-store` + `pragma: no-cache` |
| `GET`  | `/api/v1/kiosk/banners/{id}/image?exp={unix_sec}&sig={hex}` | signed URL        | `200` + `content-type` ของรูป · sig ผิด / หมดอายุ `403` · ไม่พบ / inactive / นอกช่วงเวลา `404` · `200` ส่ง `cache-control: private, max-age={วินาทีที่ลายเซ็นเหลือ}` (≤900) · error `no-store` |

**ฝั่ง back-office — `_session`**

| Method   | Path                                        | Body / query                                                                                                              | สำเร็จ                                                                      | ข้อผิดพลาด                                                                                  |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET`    | `/api/back-office/kiosk-banners`            | `?shelter_code=` (req) `&view=current\|expired` (default `current`)                                                       | `200 KioskBannerSummary[]` (ไม่มี `_attachments` · มี `image_content_type`) | ไม่ส่ง `shelter_code` `422` · นอก scope `403`                                               |
| `POST`   | `/api/back-office/kiosk-banners`            | `?shelter_code=` (req) · body = field แก้ไขได้ + `image: { content_type, data_base64 }` (req)                             | `201 KioskBannerSummary`                                                    | นอก scope `403` · field / รูปผิด `422`                                                      |
| `GET`    | `/api/back-office/kiosk-banners/{id}`       | —                                                                                                                         | `200 KioskBannerSummary` (มี `_rev`)                                        | ไม่พบ / นอก scope `404`                                                                     |
| `PUT`    | `/api/back-office/kiosk-banners/{id}`       | field แก้ไขได้ + `_rev` (req) + `image` (opt — ไม่ส่ง = คงรูปเดิม) · ห้ามมี `shelter_code` · ไม่รับ `order`               | `200`                                                                       | ไม่พบ / นอก scope `404` · มี `shelter_code` หรือ field ผิด `422` · `_rev` ชน `409 CONFLICT` |
| `PATCH`  | `/api/back-office/kiosk-banners/{id}`       | `{ _rev, status }` เท่านั้น (strict)                                                                                      | `200`                                                                       | `404` · `422` · `409`                                                                       |
| `DELETE` | `/api/back-office/kiosk-banners/{id}?rev=`  | —                                                                                                                         | `204`                                                                       | `404` · `409`                                                                               |
| `GET`    | `/api/back-office/kiosk-banners/{id}/image` | —                                                                                                                         | `200` + รูป · `cache-control: private, no-store`                            | `404`                                                                                       |
| `PUT`    | `/api/back-office/kiosk-banners/order`      | `?shelter_code=` (req) · `{ screen_type, items: [{ id, _rev }] }` (ครบทุก banner ที่ยังไม่หมดอายุของขนาดนั้น) — FR-KBN-19 | `200` (เขียน `order` 1..n เฉพาะรายการที่เปลี่ยน)                            | นอก scope `403` · `id` ซ้ำ `422` · ชุด `id` ไม่ตรง / `_rev` ไม่ตรง `409`                    |

"field แก้ไขได้" = `title`, `caption`, `duration_sec`, `start_at`, `end_at`, `status`, `screen_type` · ไม่มี session `401 UNAUTHENTICATED` · ไม่มี capability `shelter_manager` / `kiosk_staff` ที่ศูนย์ใดเลยและไม่ใช่ SA `403 FORBIDDEN`

### 2.5 UI

**(a) รายการ — `/back-office/kiosks/banners` และหน้าขนาดจอ `/back-office/kiosks/banners/{compact|portrait}`** (FR-KBN-20, FR-KBN-19)

```text
┌ จัดการ Kiosk ▸ จัดการแบนเนอร์ ───────────────────────────────────────────────┐
│ แบนเนอร์ Kiosk                         [ดูตัวอย่างบน kiosk] [+ สร้างแบนเนอร์] │
│ ศูนย์: SH001 ศูนย์พักพิง A  (เปลี่ยนศูนย์ที่ตัวเลือกศูนย์ด้านบน)                  │
├──────────────────────────────────────┬───────────────────────────────────────┤
│ ตู้เล็ก 1024×600                      │ ตู้ใหญ่ 1080×1920                      │
│ ● แสดงอยู่ 3 · รอแสดง 1 · หมดอายุ 5    │ ● แสดงอยู่ 2                          │
│ [1][2][3][4]               [จัดการ ›] │ [1][2]                    [จัดการ ›]  │
└──────────────────────────────────────┴───────────────────────────────────────┘

┌ แบนเนอร์ตู้เล็ก 1024×600 ← กลับไปรายการแบนเนอร์      [ดูตัวอย่าง] [+ สร้างแบนเนอร์] ┐
│ [ กำลังแสดง / รอแสดง (4) ] [ หมดอายุ (5) ]                                   │
│ ⠿ 1 ▣ แจกอาหารกลางวัน  15 ต.ค. 08:00–18:00  แสดงอยู่ (●) แสดงบนตู้ ✎ 🗑 ↑ ↓ │
│ ⠿ 2 ▣ ตรวจสุขภาพฟรี    16 ต.ค. 09:00–12:00  ปิดอยู่  ( ) ไม่แสดง  ✎ 🗑 ↑ ↓ │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⚠ มีลำดับที่ยังไม่บันทึก                               [ยกเลิก] [บันทึกลำดับ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Switch มี label ข้อความ「แสดงบนตู้」/「ไม่แสดง」ตามค่าจริง (ไม่ใช้ไอคอนตา) · ลบเปิด AlertDialog ที่ระบุชื่อ banner
- 「ดูตัวอย่างบน kiosk」เล่น banner ที่ `isActiveAt(now)` ของศูนย์นี้ตามลำดับจริง (สลับขนาดจอแล้วเล่นเฉพาะ banner ของขนาดนั้น — FR-KBR-44) ·「ดูตัวอย่าง」ในหน้าขนาดจอเล่นตามลำดับที่ยังไม่บันทึก
- แถวในแท็บหมดอายุไม่มี Switch และไม่มีการจัดลำดับ (แก้ไข / ลบ ได้) · แถบบันทึกลำดับแสดงเมื่อมีร่างเท่านั้น

**(b) ฟอร์ม — `/back-office/kiosks/banners/new` และ `/back-office/kiosks/banners/{id}`**

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ← กลับ   สร้างแบนเนอร์ / แก้ไขแบนเนอร์                                │
├──────────────────────────────────┬───────────────────────────────────┤
│ ศูนย์   SH001 ศูนย์พักพิง A (คงที่) │  รูปปัจจุบัน        รูปใหม่ (ถ้าเลือก) │
│ ขนาดจอ* (●) ตู้เล็ก ( ) ตู้ใหญ่      │  ┌──────────┐     ┌──────────┐    │
│ ชื่อ*   [..........................]│  │          │     │          │    │
│ คำบรรยาย[..........................]│  └──────────┘     └──────────┘    │
│ วินาที/สไลด์* [ 10 ]                │  [เลือกรูป]                        │
│ เริ่ม*   [2026-10-15 08:00]         │  รองรับ png / jpeg / webp ≤ 2 MB  │
│ สิ้นสุด* [2026-10-15 18:00]         │                                   │
│ (●) แสดงบนตู้                       │  (ไม่มีช่องลำดับ — FR-KBN-05)       │
├──────────────────────────────────┴───────────────────────────────────┤
│ [ดูตัวอย่างบน kiosk]                               [ยกเลิก] [บันทึก]  │
└──────────────────────────────────────────────────────────────────────┘
```

- หน้า `/new` ไม่มีช่อง「รูปปัจจุบัน」· error ของ Zod แสดงใต้ช่องที่ผิด (`end_at` สำหรับช่วงเวลา)
- เวลาในฟอร์มเป็นเวลาไทย (`Asia/Bangkok`) แปลงเป็น ISO UTC ก่อนส่ง
- 「ดูตัวอย่างบน kiosk」ในฟอร์มเล่นเฉพาะ banner ที่กำลังแก้ (รูปจาก object URL ถ้ายังไม่บันทึก) ในขนาดจอที่เลือก

**(c) Preview dialog**

```text
┌ ตัวอย่างบน kiosk ─────────────── [1024×600] [1080×1920] ─ ✕ ┐
│   ┌───────────────────────────────┐                         │
│   │  (KioskBannerAttract preview) │  ← ย่อให้พอดีจอ admin     │
│   └───────────────────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

**(d) Overlay บนตู้ (`/kiosk`, idle 30 s)**

```text
1024×600 (kiosk-compact)               1080×1920 (kiosk-portrait)
┌──────────────────────────────┐       ┌──────────────────┐
│                              │       │                  │
│  รูป object-contain เต็มพื้นที่  │       │  รูป object-     │
│  (ไม่มี padding · ขอบดำถ้า     │       │  contain         │
│   สัดส่วนไม่ตรงจอ)             │       │  เต็มพื้นที่        │
│  ไม่มี caption / dot / ข้อความ │       │                  │
├──────────────────────────────┤       │                  │
│ SystemBannerHost (ไม่ถูกบัง)  │       ├──────────────────┤
└──────────────────────────────┘       │ SystemBannerHost │
                                       └──────────────────┘
```

---

## 3. Requirements

> ตาราง FR-KBN (§3.1–§3.4) = requirement ตั้งต้นของ CR-162 · แถวที่ปรับ 2026-10-15..17 ลงท้ายด้วย「(ปรับ 2026-10-15/17 — ดู FR-KBR-xx)」· ตาราง FR-KBR (§3.6) = requirement ที่เพิ่มจากการปรับ design หลัง CR-165 (อนุมัติ 2026-10-18)

### 3.1 Data — `kiosk_banner` (schema.md §3.12)

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBN-01 | `_id` = `kiosk_banner:{ulid}`, `type: 'kiosk_banner'`, `schema_v: 1`, DB `registry` (registry doc ไม่มี envelope `shelter_code` · `shelter_code` ของ banner เป็น field เฉพาะของ doc type ตาม FR-KBN-09 — ปรับ 2026-10-15/17 — ดู FR-KBR-01)                                                                                                                |
| FR-KBN-02 | `title` str req ≤120 — ใช้ในหน้าจัดการและเป็น `alt` ของรูป                                                                                                                                                                                                                                                                                                 |
| FR-KBN-03 | `caption` str opt ≤200 — เก็บและแก้ได้ใน back-office; render เป็น text เท่านั้น (ห้าม HTML) · ไม่แสดงบนตู้ (ปรับ 2026-10-17 — ดู FR-KBR-46)                                                                                                                                                                                                                |
| FR-KBN-04 | `image` = CouchDB attachment ชื่อ `image` req · `image/png` · `image/jpeg` · `image/webp` · ≤2 MB · server ตรวจ magic bytes (mirror `decodeKioskPhoto` ใน `features/kiosk/server/kiosk-photo.server.ts`) ไม่เชื่อ extension/`Content-Type` ของ client                                                                                                      |
| FR-KBN-05 | `order` int req ≥1 — kiosk เรียง `order` asc → `start_at` asc → `_id` asc ภายในขนาดจอเดียวกัน · **server เป็นผู้กำหนด** (client ส่ง `order` มาจะถูกละเลย): สร้าง = ค่าสูงสุดของ banner ที่ยังไม่หมดอายุในขนาดจอเดียวกัน + 1 (ไม่มี = 1) · แก้ไขไม่เปลี่ยน `order` ยกเว้นย้ายขนาดจอ → ต่อท้ายขนาดใหม่ · เปลี่ยนลำดับได้ทางหน้าจัดลำดับ (FR-KBN-19) เท่านั้น |
| FR-KBN-06 | `duration_sec` int req 3–60 default 10                                                                                                                                                                                                                                                                                                                     |
| FR-KBN-07 | `start_at`, `end_at` ISO ts req · `end_at` > `start_at` (reject ทั้ง Zod และ VDU)                                                                                                                                                                                                                                                                          |
| FR-KBN-08 | `status` enum(`active`,`inactive`) req default `active`                                                                                                                                                                                                                                                                                                    |
| FR-KBN-09 | `shelter_code` str req — ศูนย์เดียว · เทียบกับ `shelter_code` ของ device principal · ตั้งตอนสร้าง แก้ไม่ได้ (แทน `shelter_codes[]` เดิม — ปรับ 2026-10-15 — ดู FR-KBR-01..03)                                                                                                                                                                              |
| FR-KBN-10 | `created_at`, `updated_at`, `created_by` ตาม envelope §0; timestamp สร้าง ณ เวลาเรียก                                                                                                                                                                                                                                                                      |
| FR-KBN-11 | ลบ = hard delete ทั้ง doc (attachment ลบไปด้วย)                                                                                                                                                                                                                                                                                                            |

### 3.2 Back-office

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-KBN-19 | **จัดลำดับ** ในแท็บ「กำลังแสดง / รอแสดง」ของหน้าขนาดจอ (banner ที่ยังไม่หมดอายุ รวมที่ปิดอยู่และรอแสดง): **ลากวาง**ที่ handle ได้ทั้งเมาส์และจอสัมผัส + ปุ่ม ↑↓ (focus อยู่ที่ปุ่มเดิมหลังย้าย) · `Esc` ระหว่างลาก = ยกเลิก · ลำดับเป็นร่างจนกด「บันทึกลำดับ」(แถบบันทึก/ยกเลิกติดล่างจอเมื่อมีร่าง) ·「ดูตัวอย่าง」เล่นตามร่าง · เปิด/ปิด/ลบระหว่างมีร่างไม่ทำให้ร่างเสีย · ออกจากหน้าตอนมีร่างต้องยืนยัน · บันทึกด้วย `PUT /api/back-office/kiosk-banners/order?shelter_code=` body `{ screen_type, items: [{ id, _rev }] }` (ครบทุก banner ที่ยังไม่หมดอายุของขนาดนั้น) → server เขียน `order` 1..n เฉพาะรายการที่เปลี่ยน (`_bulk_docs` คง attachment) · ชุด `id` ไม่ตรงหรือ `_rev` ไม่ตรง `409` · `id` ซ้ำ `422` · นอก scope `403` (เพิ่ม 2026-10-17 · ร่างเดิมใช้เลข FR-KBN-30 ซ้ำกับ §3.3 จึงเปลี่ยนเป็น FR-KBN-19) |
| FR-KBN-20 | หน้ารายการ `/back-office/kiosks/banners` แสดง **card ต่อขนาดจอ** (ตู้เล็ก 1024×600 / ตู้ใหญ่ 1080×1920): จำนวน แสดงอยู่ / รอแสดง / ปิดอยู่ / หมดอายุ + แถบรูปตามลำดับที่ตู้เล่น · กด「จัดการ」ไปหน้าของขนาดนั้น `/back-office/kiosks/banners/{compact\|portrait}` ที่มี 2 แท็บ:「กำลังแสดง / รอแสดง」(`end_at` ≥ now, เรียงตามลำดับที่ตู้เล่น — จัดลำดับได้ตาม FR-KBN-19) ·「หมดอายุ」(`end_at` < now, เรียง `end_at` desc) · แถวในแท็บแรกมี Switch / แก้ไข / ลบ (FR-KBN-23) · แถวในแท็บหมดอายุมีแก้ไข / ลบ (ไม่มี Switch ไม่มีจัดลำดับ) · หน้าสร้าง `/back-office/kiosks/banners/new` · หน้าแก้ไข `/back-office/kiosks/banners/{id}` (ปรับ 2026-10-15/17 — path เดิม `/back-office/kiosk-banners` · ดู FR-KBR-20..25, 44)                                                                                                |
| FR-KBN-21 | ฟอร์มสร้าง/แก้ไข Superforms + Zod ครบทุก field §3.1 และ `screen_type` (FR-KBR-44) **ยกเว้น `order`** (ไม่มีช่องลำดับ — FR-KBN-05) และ `shelter_code` (แสดงเป็นค่าคงที่ — FR-KBR-23) · สร้างจากหน้าขนาดจอ = ฟอร์มเลือกขนาดนั้นไว้ให้ · บันทึก/ย้อนกลับไปหน้าขนาดจอของ banner · แก้ไขโดยไม่เลือกรูปใหม่ = คงรูปเดิม · ใต้ช่องอัปโหลดแสดงชนิดไฟล์ที่รับ (png / jpeg / webp) และขนาดสูงสุด 2 MB                                                                                                                                                                                                                                                                                                                                                                                                                               |
| FR-KBN-22 | อัปโหลดรูปส่งเป็น JSON base64 (back-office route เป็น JSON-only) · decode + ตรวจตาม FR-KBN-04 ฝั่ง server ก่อน PUT attachment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| FR-KBN-23 | เปิด/ปิดการแสดงผลใช้ `Switch` ที่มี label สถานะ (「แสดงบนตู้」/「ไม่แสดง」) ส่ง `PATCH` · ลบ = `DELETE` พร้อม confirm dialog ผูกกับ banner รายการนั้น · ห้ามใช้ไอคอนรูปตาแทนสถานะ (สับสนกับ preview)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| FR-KBN-24 | สิทธิ์จัดการ (อ่าน/สร้าง/แก้/เปิดปิด/ลบ/จัดลำดับ): `system_admin` ทุกศูนย์ · `shelter_manager` และ `kiosk_staff` เฉพาะ banner ที่ `shelter_code` = ศูนย์ของตัวเอง · list / create / order นอก scope `403` · endpoint ที่มี `{id}` ไม่พบหรือนอก scope `404` (ไม่เขียน `registry`) · role อื่น `403` (ปรับ 2026-10-15 — ดู FR-KBR-10..13)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| FR-KBN-25 | รูปในหน้าจัดการโหลดผ่าน back-office route ที่ตรวจ session + สิทธิ์                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| FR-KBN-26 | ~~role ใหม่ `banner_staff`~~ **ถูกแทนด้วย `kiosk_staff` ของ CR-165** · ไม่เพิ่ม role ใหม่ใน `roles.ts` · SA และ SM ของศูนย์นั้น grant/revoke `{shelter_code}:kiosk_staff` ผ่านหน้าจัดการผู้ใช้เดิม (ปรับ 2026-10-15 — ดู FR-KBR-14)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| FR-KBN-27 | ~~`banner_staff` เห็นเฉพาะเมนู「แบนเนอร์ Kiosk」~~ **ถูกแทนด้วย:** ผู้ใช้ที่มีแค่ `kiosk_staff` เข้าได้เฉพาะ `/back-office/kiosks` และ path ย่อย (รวม `/back-office/kiosks/banners/**` — CR-165 FR-SBO-40) · เมนูลูก「จัดการแบนเนอร์」ตาม FR-KBR-22 (ปรับ 2026-10-15 — ดู FR-KBR-21, 22)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| FR-KBN-28 | เลือกไฟล์แล้วแสดงภาพตัวอย่างทันที (client-side object URL) ก่อนบันทึก · หน้าแก้ไขแสดงรูปปัจจุบัน และเมื่อเลือกรูปใหม่ให้เห็นทั้งรูปเดิมและรูปใหม่                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| FR-KBN-29 | ปุ่ม「ดูตัวอย่างบน kiosk」(ในรายการและในฟอร์ม) เปิด modal จำลองจอ 1024×600 และ 1080×1920 (สลับได้ · สลับแล้วเล่นเฉพาะ banner ของขนาดนั้น) · ใช้ component overlay ตัวเดียวกับบนตู้ (FR-KBN-44/45) · ในรายการ = เล่นทุก banner ที่ active ของ **active shelter** ตามลำดับจริง · ในฟอร์ม = เล่น banner ที่กำลังแก้ (รวมรูปที่ยังไม่บันทึก) (ปรับ 2026-10-15/16 — ดู FR-KBR-23, 44)                                                                                                                                                                                                                                                                                                                                                                                                                                          |

> หน้าอยู่ใต้ `/back-office/kiosks/` (ไม่ใช่ `system-management/` ที่ `requireAdmin`) เพื่อให้ SM และ `kiosk_staff` เข้าถึงได้ด้วย guard `requireKioskManagement`

### 3.3 Kiosk API (device auth)

| ID        | Requirement                                                                                                                                                                                                                                                                                                                |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBN-30 | `POST /api/v1/kiosk/banners` ยืนยันเครื่องด้วย `authenticateScannerDevice` (`lib/server/scanners/device-credentials.ts`) แบบเดียวกับ `kiosk/config` · 401 `DEVICE_AUTH_FAILED` · 503 `DEPENDENCY_UNAVAILABLE` (ปรับ — path เดิม `/api/v1/scanner/kiosk/banners` ตาม CR-165)                                                |
| FR-KBN-31 | scope จาก `shelter_code` ของ device principal เท่านั้น (ห้ามใช้ query ของ URL / display context)                                                                                                                                                                                                                           |
| FR-KBN-32 | คืนเฉพาะ `status = active` และ `start_at ≤ now < end_at` และ `shelter_code` ตรงกับของเครื่อง และ `screen_type` ตรงกับของเครื่อง · เครื่องที่ `banner_enabled = false` ได้รายการว่าง · เรียงตาม FR-KBN-05 · สูงสุด 20 รายการ (ปรับ 2026-10-15/16 — ดู FR-KBR-37, 42)                                                        |
| FR-KBN-33 | Response: `{ banners: [{ id, title, caption, duration_sec, image_url }], fetched_at }` · header `cache-control: no-store` + `pragma: no-cache` (FR-KPC-07)                                                                                                                                                                 |
| FR-KBN-34 | `image_url` = `GET /api/v1/kiosk/banners/{id}/image?exp=&sig=` — HMAC-SHA256 hex lowercase ด้วย key ที่ derive จาก `EXTERNAL_API_SECRET` (FR-KBR-30), อายุ 15 นาที · sig ผิด/หมดอายุ = 403 · ไม่พบ / inactive / หมดช่วงเวลา = 404 · ไม่ต้องใช้ device header (ปรับ 2026-10-15 — path ตาม CR-165)                           |
| FR-KBN-35 | kiosk client: เพิ่ม `/api/v1/kiosk/banners` ใน `allowed_paths` ของ `_route_kiosk_api` ใน `kiosk/app/manager.py` (รวม 10 path · POST same-origin เท่านั้น) · GET รูปผ่าน `route.continue_` โดยไม่มี credential ตาม logic เดิม · path ต้องไม่อยู่ใน `LOCAL_ONLY_PATHS` (ปรับ — ชื่อ client / path ตาม CR-165 · ดู FR-KBR-31) |

### 3.4 Kiosk UI (`/kiosk`)

| ID        | Requirement                                                                                                                                                                                                                                                                                     |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBN-40 | client `features/kiosk/data/kiosk-banners.api.ts` ใช้ plain `fetch` (mirror `kiosk-config.api.ts`: `cache: 'no-store'`, timeout 3 s) · ล้มเหลว = คืนรายการว่าง (fail soft) ไม่ cache error                                                                                                      |
| FR-KBN-41 | ดึงรายการเมื่อเข้า `/kiosk` และทุก 5 นาทีระหว่างอยู่หน้าเดิม                                                                                                                                                                                                                                    |
| FR-KBN-42 | ไม่มีการแตะ/คลิก/กดปุ่มบนหน้า `/kiosk` 30 วินาที และมี banner ≥1 → แสดง attract overlay เต็มจอ                                                                                                                                                                                                  |
| FR-KBN-43 | แตะจอ/กดปุ่มใด ๆ ขณะ overlay แสดง → ปิด overlay กลับหน้าเลือกวิธี และ event นั้นไม่ทริกเกอร์การ์ดที่อยู่ข้างใต้ · เสียบบัตร = kiosk client นำทางออกจาก `/kiosk` ตามเดิม                                                                                                                         |
| FR-KBN-44 | สไลด์เปลี่ยนตาม `duration_sec` ของแต่ละรายการ วนต่อเนื่อง · fade ≤300 ms · รายการเดียว = ไม่หมุน · **ไม่แสดง** dot indicator และข้อความ「แตะหน้าจอเพื่อเริ่มใช้งาน」(ปรับ 2026-10-17 — เดิมมีทั้งสอง · ดู FR-KBR-46)                                                                            |
| FR-KBN-45 | รูป `object-contain` (ไม่ crop) เต็มพื้นที่ overlay ไม่มี padding · **ไม่แสดง** `caption` ใต้รูป (ปรับ 2026-10-17 · ดู FR-KBR-46) · พอดีไม่ scroll ที่ 1024×600 (`kiosk-compact`) และ 1080×1920 (`kiosk-portrait`) · ใช้ media literal เดียวกับ `kiosk-layout.ts` (ผ่าน `kiosk-layout.test.ts`) |
| FR-KBN-46 | overlay ต้องไม่บัง `SystemBannerHost` (ประกาศระบบ fixed bottom)                                                                                                                                                                                                                                 |
| FR-KBN-47 | ไม่มี banner / API ล้มเหลว / รูปโหลดไม่ได้ → ไม่แสดง overlay (หรือข้ามสไลด์ที่รูปเสีย) · ไม่มี JS error · หน้าเลือกวิธีทำงานปกติ                                                                                                                                                                |

### 3.5 Out of scope (owner เคาะ 2026-10-11)

- แสดง banner ที่หน้าอื่นนอกจาก idle บน `/kiosk` (เช่นหน้า「เสร็จสิ้น」)
- แถบ banner ถาวรบนหน้า `/kiosk` รวมถึงตู้แนวตั้ง 1080×1920
- รูปแยกตามแนวจอ**ใน banner เดียว** — ใช้รูปเดียวต่อ banner + `object-contain` · การแยกขนาดจอทำด้วย banner ต่อ `screen_type` (ปรับ 2026-10-16 โดยทีม kiosk รออนุมัติ — ดู §3.6.6)
- ฟิลด์ภาษาอังกฤษ (`title_en` / `caption_en`)
- banner เดียวหลายศูนย์ / broadcast ทุกศูนย์ / ย้าย banner ข้ามศูนย์ (เพิ่ม 2026-10-15 — ดู Q4)

### 3.6 ปรับ design หลัง CR-165 (FR-KBR-01..46)

> เสนอโดย ทีม kiosk 2026-10-15..17 — **Team Lead อนุมัติ 2026-10-18** · FR-KBR ขยายและแทนที่ส่วนที่เกี่ยวข้องของ FR-KBN (แถว FR-KBN ที่เกี่ยวข้องถูกแก้ในที่เดิมและอ้าง FR-KBR แล้ว)

#### 3.6.1 Data

| ID        | Requirement                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-KBR-01 | `kiosk_banner` เก็บศูนย์เป็น `shelter_code` (string ไม่ว่าง) ตัวเดียว · ไม่มี field `shelter_codes`                                                                                  |
| FR-KBR-02 | `shelter_code` ตั้งครั้งเดียวตอนสร้างจาก `?shelter_code=` ของ request (client ส่ง active shelter) · `PUT` / `PATCH` เปลี่ยนไม่ได้                                                    |
| FR-KBR-03 | VDU ของ `registry` reject doc `kiosk_banner` ตามกฎ §2.3 · `REGISTRY_DESIGN_VERSION` 5 → 6                                                                                            |
| FR-KBR-04 | ตรวจรูปที่ server: base64 ต้อง canonical · ≤2 MB หลัง decode · magic bytes ต้องเป็น png / jpeg / webp · `content_type` ของ attachment = ค่าจาก magic bytes (ไม่ใช้ค่าที่ client ส่ง) |
| FR-KBR-05 | `PUT` ที่ไม่มี `image` ต้องคง attachment เดิม (ส่ง stub กลับไปกับ doc)                                                                                                               |

#### 3.6.2 สิทธิ์ (back-office BFF)

| ID        | Requirement                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBR-10 | ทุก endpoint ใต้ `/api/back-office/kiosk-banners` resolve ผู้เรียกด้วย `requireShelterCapabilityCaller(cookie, SCANNER_MANAGER_CAPABILITIES)` · ไม่มี session `401` · ไม่ใช่ SA และไม่มี `shelter_manager` / `kiosk_staff` ที่ศูนย์ใด `403` |
| FR-KBR-11 | `GET` list และ `POST` ต้องมี `?shelter_code=` ทุก role (ไม่ส่ง `422`) · ศูนย์นอก scope ของผู้เรียก `403` และไม่อ่าน / ไม่เขียน `registry`                                                                                                   |
| FR-KBR-12 | endpoint ที่มี `{id}` ตอบ `404 NOT_FOUND` เมื่อไม่พบ doc หรือ `doc.shelter_code` อยู่นอก scope ของผู้เรียก · ไม่เขียน `registry` ในกรณีนี้                                                                                                  |
| FR-KBR-13 | SA จัดการ banner ได้ทุกศูนย์ · SM / `kiosk_staff` ของศูนย์ X จัดการได้ทุก action กับ banner ที่ `shelter_code = X`                                                                                                                          |
| FR-KBR-14 | ไม่เพิ่ม role ใหม่ · ไม่เพิ่ม `kiosk_staff` ใน VDU ของ shelter DB · คำอธิบายตัวเลือก `kiosk_staff` ในหน้าจัดการผู้ใช้ต้องบอกว่ารวมการจัดการแบนเนอร์                                                                                         |

#### 3.6.3 Back-office UI

| ID        | Requirement                                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBR-20 | หน้ารายการ `/back-office/kiosks/banners` · หน้าสร้าง `/back-office/kiosks/banners/new` · หน้าแก้ไข `/back-office/kiosks/banners/{id}`                                                                                                                                     |
| FR-KBR-21 | ทั้ง 3 หน้าใช้ guard `requireKioskManagement` · ผู้ใช้ที่มีแค่ `kiosk_staff` เข้าได้โดยไม่ต้องแก้ `confineKioskStaffOnly`                                                                                                                                                 |
| FR-KBR-22 | เมนูลูก「จัดการแบนเนอร์」ใต้「จัดการ Kiosk」ถัดจาก「จัดการอุปกรณ์」· เห็นเมื่อ `hasCapabilityAnywhere(roles, SCANNER_MANAGER_CAPABILITIES)` หรือ SA · ไม่เพิ่ม tile ใน portal                                                                                             |
| FR-KBR-23 | ทุกหน้าใช้ active shelter (`shelterStore.selectedShelterCode ?? getShelterCode()`) · ไม่มีตัวเลือกศูนย์ · ฟอร์มแสดงศูนย์เป็นค่าคงที่ · สลับศูนย์แล้วรายการเปลี่ยนตาม                                                                                                      |
| FR-KBR-24 | เมนูที่ active ใน back-office navbar = รายการที่ `href` match กับ path ปัจจุบันยาวที่สุด · บน `/back-office/kiosks/banners/**` เมนู「จัดการอุปกรณ์」ต้องไม่ active                                                                                                        |
| FR-KBR-25 | หน้ารายการ card ต่อขนาดจอ + หน้าขนาดจอที่มี 2 แท็บ (FR-KBN-20) · Switch + label (FR-KBN-23) · ลบผ่าน AlertDialog ที่ระบุชื่อ · ปุ่ม「ดูตัวอย่างบน kiosk」(FR-KBN-29)                                                                                                      |
| FR-KBR-26 | หน้าฟอร์ม: Superforms + `zod4Client` · preview รูปทันทีที่เลือกไฟล์ · หน้าแก้ไขแสดงรูปปัจจุบันคู่รูปใหม่ · ข้อความ「รองรับ png / jpeg / webp ขนาดไม่เกิน 2 MB」· ตรวจชนิด/ขนาดฝั่ง client ก่อนส่ง (UX เท่านั้น) · `409` → toast「มีผู้อื่นแก้ไขแบนเนอร์นี้ โปรดโหลดใหม่」 |

#### 3.6.4 ฝั่งตู้ + infra

| ID        | Requirement                                                                                                                                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBR-30 | kiosk feed และ image endpoint อยู่ที่ path ตาม §2.4 · `image_url` ใช้ path ใหม่ · `sig` = HMAC-SHA256(key, `"{id}.{exp}"`) เป็น hex lowercase โดย key = HMAC-SHA256(`EXTERNAL_API_SECRET`, `"kiosk-banner-image-url:v1"`) · `exp` เป็น unix seconds · เทียบด้วย `crypto.timingSafeEqual` |
| FR-KBR-31 | `kiosk/app/manager.py` เพิ่ม `/api/v1/kiosk/banners` ใน `allowed_paths` (รวม 10 path) · ไม่อยู่ใน `LOCAL_ONLY_PATHS` · GET รูปไม่ได้ device header                                                                                                                                       |
| FR-KBR-32 | overlay ใช้ค่าคงที่ `KIOSK_BANNER_IDLE_MS = 30_000` แยกจาก `KIOSK_IDLE_TIMEOUT_MS` · หลังปิด overlay ต้องเริ่มนับ idle ใหม่ทุกครั้ง (`KioskIdleTimeout` เรียก `onIdle` ครั้งเดียวต่อ `start()`)                                                                                          |
| FR-KBR-33 | ไม่เพิ่ม env ใหม่สำหรับ signed URL · key derive จาก `EXTERNAL_API_SECRET` (server-only, frontend ต้องมีอยู่แล้วสำหรับ BFF) · ไม่มีค่า → feed และ image ตอบ `503 DEPENDENCY_UNAVAILABLE`                                                                                                  |
| FR-KBR-34 | service frontend (adapter-node) ตั้ง `BODY_SIZE_LIMIT=4M` ใน env ของ compose ที่ใช้ deploy · ทดสอบอัปโหลดรูป ~1.9 MB บน build จริง (ไม่ใช่ `pnpm dev`)                                                                                                                                   |

#### 3.6.5 เปิด / ปิด banner รายเครื่อง

| ID        | Requirement                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBR-35 | `scanner_device` เพิ่ม field optional `banner_enabled: boolean` · ไม่มี field = `true` (เครื่องเดิมแสดง banner ตามปกติ) · ไม่ bump `schema_v`                                                                       |
| FR-KBR-36 | `PATCH /api/v1/kiosk/devices/[id]` รับ `banner_enabled` ร่วมกับ field เดิม (สิทธิ์ / scope ตาม CR-165 — นอก scope `404`) · summary ของ `GET /api/v1/kiosk/devices` และ `PATCH` มี `banner_enabled` (default `true`) |
| FR-KBR-37 | เครื่องที่ `banner_enabled = false` เรียก `POST /api/v1/kiosk/banners` ได้ `200 { banners: [], fetched_at }` โดย server ไม่ query banner · overlay ไม่ขึ้น (หน้าตู้ไม่ต้องรู้ว่าปิดด้วย flag หรือไม่มี banner)      |
| FR-KBR-38 | หน้า `/back-office/kiosks` แสดง Switch ต่อเครื่องพร้อม label「แสดงแบนเนอร์」/「ไม่แสดงแบนเนอร์」(ไม่ใช้ไอคอนตา) → `PATCH` · แจ้งผลด้วย toast                                                                        |

#### 3.6.6 ขนาดหน้าจอ kiosk (`screen_type`)

ตู้มี 2 ขนาด: **ตู้เล็ก** `compact` 1024×600 (แนวนอน) และ **ตู้ใหญ่** `portrait` 1080×1920 (แนวตั้ง) — รูปแนวนอนบนตู้แนวตั้ง (และกลับกัน) แสดงแบบมีขอบดำ จึงให้ banner ผูกขนาดจอและตู้ดึงเฉพาะ banner ขนาดตัวเอง

| ID        | Requirement                                                                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBR-39 | `scanner_device` และ `kiosk_banner` เพิ่ม field optional `screen_type: "compact" \| "portrait"` · ไม่มี field = `compact` (เครื่อง / banner เดิมทำงานเหมือนเดิม) · ไม่ bump `schema_v` · VDU ของ `kiosk_banner` ปฏิเสธค่านอก enum                                                           |
| FR-KBR-40 | `POST /api/v1/kiosk/devices` และ `PATCH /api/v1/kiosk/devices/[id]` รับ `screen_type` (สร้างไม่ส่ง = `compact`) · summary มี `screen_type` เสมอ · bootstrap ของตู้ไม่เปลี่ยน                                                                                                                |
| FR-KBR-41 | banner หนึ่งรายการมี `screen_type` เดียว (ถ้าจะแสดงทั้ง 2 ขนาดให้สร้าง 2 รายการ) · `POST`/`PUT` back-office รับ `screen_type` (ไม่ส่ง = `compact`)                                                                                                                                          |
| FR-KBR-42 | `POST /api/v1/kiosk/banners` คืนเฉพาะ banner ที่ `screen_type` ตรงกับเครื่อง (กรองก่อนตัด cap 20 รายการ)                                                                                                                                                                                    |
| FR-KBR-43 | หน้า「จัดการเครื่อง」และ dialog สร้างเครื่องมีตัวเลือก「ขนาดหน้าจอ」ตู้เล็ก 1024×600 / ตู้ใหญ่ 1080×1920 · ตารางเครื่องแสดง badge ขนาดจอ                                                                                                                                                    |
| FR-KBR-44 | ฟอร์ม banner มีตัวเลือก「ขนาดหน้าจอ」(required) · ตัวอย่างในฟอร์มเปิดเฉพาะขนาดที่เลือก · หน้ารายการแยก card ต่อขนาดจอ → หน้าจัดการของแต่ละขนาด (FR-KBN-20) · สร้างจากหน้าขนาดจอ = ฟอร์มเลือกขนาดนั้นไว้ให้ ·「ดูตัวอย่างบน kiosk」สลับขนาดแล้วเล่นเฉพาะ banner ของขนาดนั้น (นับจำนวนบนปุ่ม) |
| FR-KBR-45 | ลำดับ (`order`) แยกตามขนาดจอ: ตู้เรียง `order` → `start_at` → `_id` ภายในขนาดจอเดียวกัน · การกำหนดและจัดลำดับตาม FR-KBN-05 / FR-KBN-19 (ฟอร์มไม่มีช่องลำดับ · banner ใหม่ต่อท้ายขนาดจอนั้น · ย้ายขนาดจอแล้วต่อท้ายขนาดใหม่ · จัดลำดับแบบลากวางในหน้าขนาดจอ)                                 |

#### 3.6.7 Overlay บนตู้

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KBR-46 | overlay แสดง**รูปอย่างเดียว**เต็มพื้นที่ overlay ทั้ง 1024×600 และ 1080×1920 (`object-contain` · ไม่ crop · ไม่มี padding · ขอบดำเมื่อสัดส่วนรูปไม่ตรงจอ) · **ไม่แสดง** `caption`, dot indicator และข้อความ「แตะหน้าจอเพื่อเริ่มใช้งาน」(แทนส่วนนั้นของ FR-KBN-44/45 — สไลด์ยังหมุนตาม `duration_sec` + fade ตามเดิม · `caption` ยังเก็บและแก้ได้ใน back-office) · ยังเว้นความสูงแถบประกาศระบบตาม FR-KBN-46 · แตะที่ใดก็ได้ยังปิด overlay |

แถว FR-KBN ที่ไม่ได้ระบุว่าปรับ ใช้ตามเดิม โดยอ่าน role เป็น `kiosk_staff` และ path ตาม CR-165

---

## 4. Acceptance

### 4.1 Acceptance ตั้งต้น (ปรับตามการเปลี่ยน design)

- banner ที่ `start_at` อนาคต ไม่ขึ้นจนถึงเวลา · หลัง `end_at` หายภายใน 5 นาที
- banner ของศูนย์ A ไม่ขึ้นบนตู้ศูนย์ B · `status = inactive` ไม่ขึ้น · เรียงตาม `order` จริง
- ไฟล์ `.png` ที่เนื้อในไม่ใช่ PNG หรือ >2 MB → reject · `end_at ≤ start_at` → reject ทั้งฟอร์มและ VDU
- `/kiosk` ไม่มี banner → ไม่มี overlay ไม่มี JS error · มี banner + idle 30 s → overlay · แตะ → กลับหน้าเลือกวิธีโดยไม่เลือกการ์ด
- `image_url` หมดอายุหรือแก้ `sig` → 403
- `POST /api/v1/kiosk/banners` ที่ header ปลอม/เครื่อง inactive → 401 และไม่ query banner
- kiosk client: allowlist ฉีด header ให้ `POST /api/v1/kiosk/banners` same-origin เท่านั้น
- SM / `kiosk_staff` ของศูนย์ A: `{id}` ของ banner ศูนย์ B → `404` · list/create `?shelter_code=B` → `403` · ไม่มีการย้ายศูนย์ของ banner · role อื่นของศูนย์ A ได้ `403` (ปรับ 2026-10-15 — แทนข้อ「ย้าย banner ของ B มาเป็นของ A ไม่ได้」· ดู AC-KBR-03, 05..07)
- `kiosk_staff` ของศูนย์ A เข้า `/back-office/kiosks/banners` ได้ · เข้าหน้า back-office อื่นไม่ได้ · ไม่มี role `banner_staff` (ปรับ 2026-10-15 — ดู AC-KBR-02)
- เลือกไฟล์แล้วเห็นภาพตัวอย่างทันที · หน้าแก้ไขแสดงรูปปัจจุบัน · ปุ่ม「ดูตัวอย่างบน kiosk」เล่นสไลด์ที่ 2 ขนาดจอได้ถูกต้อง
- Switch เปิด/ปิดเปลี่ยน `status` ผ่าน `PATCH` และ label ตรงกับสถานะจริง
- สร้าง banner ใหม่ไม่ต้องกรอกลำดับ และได้ลำดับท้ายสุดของขนาดจอนั้น · ย้ายขนาดจอแล้วไปอยู่ท้ายขนาดใหม่
- หน้าตู้เล็ก (A, B, C) ลาก C ขึ้นบนสุด (เมาส์และจอสัมผัส) · ปิด Switch ของ B ระหว่างมีร่าง · บันทึก → ไม่ 409 · ลำดับ C, A, B · reload แล้วคงอยู่ · feed ตู้เล็กเรียงตามใหม่ · ตู้ใหญ่ไม่เปลี่ยน
- เปิดหน้าเดียวกัน 2 แท็บ บันทึกแท็บแรกแล้วบันทึกแท็บสอง → `409` + toast ให้โหลดใหม่ · มีร่างแล้วกดออก/ย้อนกลับ → dialog ยืนยันก่อน

### 4.2 Acceptance หลังปรับ design (AC-KBR-01..20 — อนุมัติ 2026-10-18)

| ID        | ขั้นตอน                                                                                             | ผลที่คาด                                                                                                                                        | FR     |
| --------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| AC-KBR-01 | SA / SM A / `kiosk_staff` A เปิด `/back-office/kiosks/banners` ขณะ active shelter = A               | เห็นรายการของ A · เมนู「จัดการแบนเนอร์」active ·「จัดการอุปกรณ์」ไม่ active                                                                     | 20–24  |
| AC-KBR-02 | ผู้ใช้ที่มีแค่ `kiosk_staff` A เปิด `/back-office/kiosks/banners/new`                               | เข้าได้ · หน้า back-office อื่นยัง redirect                                                                                                     | 21     |
| AC-KBR-03 | `registration_staff` A เปิดหน้า / ยิง API                                                           | redirect / `403`                                                                                                                                | 10, 21 |
| AC-KBR-04 | สร้าง banner ที่ active shelter = A                                                                 | doc มี `shelter_code: "A"` และไม่มี `shelter_codes`                                                                                             | 01, 02 |
| AC-KBR-05 | SM A / `kiosk_staff` A ยิง `GET`/`PUT`/`PATCH`/`DELETE`/`image` ของ banner B                        | `404` ทุกตัว · banner B ไม่เปลี่ยน                                                                                                              | 12     |
| AC-KBR-06 | SM A ยิง `GET ?shelter_code=B` และ `POST ?shelter_code=B`                                           | `403` · ไม่มี doc ใหม่                                                                                                                          | 11     |
| AC-KBR-07 | `PUT` ที่มี `shelter_code` ใน body                                                                  | `422`                                                                                                                                           | 02     |
| AC-KBR-08 | `PUT` ไม่ส่ง `image`                                                                                | รูปเดิมยังอยู่                                                                                                                                  | 05     |
| AC-KBR-09 | อัปโหลด `.png` ที่เป็น text · GIF · 2.5 MB                                                          | `422` · ไม่มี doc ใหม่                                                                                                                          | 04     |
| AC-KBR-10 | อัปโหลดรูป ~1.9 MB บน build จริง                                                                    | `201` (ไม่ `413`)                                                                                                                               | 34     |
| AC-KBR-11 | ตู้ A1 POST feed · แก้ `sig` · รอเกิน 15 นาที                                                       | ได้ banner ของ A · `403` · `403`                                                                                                                | 30     |
| AC-KBR-12 | ตู้ค้าง `/kiosk` 30 s → แตะปิด → ค้างอีก 30 s                                                       | overlay ขึ้น · ปิดโดยไม่เลือกการ์ด · ขึ้นอีกครั้ง                                                                                               | 32     |
| AC-KBR-13 | `kiosk/tests/test_manager.py`                                                                       | POST `/api/v1/kiosk/banners` ได้ header · GET image ไม่ได้                                                                                      | 31     |
| AC-KBR-14 | ไม่ตั้ง `EXTERNAL_API_SECRET` แล้วตู้ POST feed                                                     | `503` · หน้า `/kiosk` ทำงานปกติ ไม่มี overlay                                                                                                   | 33     |
| AC-KBR-15 | ปิด Switch「แสดงแบนเนอร์」ของตู้ A1 (A2 เปิด) → รอ ≤5 นาที                                          | A1 ไม่มี overlay · feed ของ A1 คืน `[]` · A2 ยังแสดง                                                                                            | 35–38  |
| AC-KBR-16 | เครื่องเดิมที่ไม่มี field `banner_enabled`                                                          | แสดง banner ตามปกติ · Switch แสดงสถานะเปิด                                                                                                      | 35     |
| AC-KBR-17 | ตั้งตู้ A1 = ตู้ใหญ่ · สร้าง banner ตู้เล็ก 1 + ตู้ใหญ่ 1 ที่ศูนย์ A                                | feed ของ A1 มีเฉพาะ banner ตู้ใหญ่ · ตู้ A2 (ไม่มี `screen_type`) ได้เฉพาะตู้เล็ก                                                               | 39, 42 |
| AC-KBR-18 | หน้ารายการ · กด card ตู้ใหญ่ · กดดูตัวอย่างบน kiosk แล้วสลับขนาด                                    | ไปหน้า `/back-office/kiosks/banners/portrait` มีเฉพาะ banner ตู้ใหญ่ · กรอบ 1080×1920 เล่นเฉพาะ banner ตู้ใหญ่ · กรอบ 1024×600 เล่นเฉพาะตู้เล็ก | 44     |
| AC-KBR-19 | มี banner ตู้เล็ก ลำดับ 1, 2 · สร้าง banner ตู้เล็กใหม่ · แก้ banner ลำดับ 1 เป็นตู้ใหญ่            | ฟอร์มไม่มีช่องลำดับ · banner ใหม่ได้ลำดับ 3 · banner ที่ย้ายไปอยู่ท้ายตู้ใหญ่                                                                   | 45     |
| AC-KBR-20 | ตู้เล็ก 1024×600 และตู้ใหญ่ 1080×1920 ค้าง `/kiosk` จน overlay ขึ้น (banner ≥2 รายการ มี `caption`) | รูปเต็มพื้นที่ overlay ไม่มี padding · ไม่มี caption, dot และข้อความ「แตะหน้าจอเพื่อเริ่มใช้งาน」· สไลด์ยังหมุน · แตะแล้ว overlay ปิด           | 46     |

### 4.3 Definition of done

- tests: domain (schema, active window, sort), signed URL, back-office + kiosk route `server.test.ts` (ครอบ AC-KBR-03..09, 11, 14, 15), `kiosk-banners.api.test.ts`, attract overlay component test (fake timers), `kiosk/tests/test_manager.py` allowlist case, e2e back-office CRUD
- AC ใน §4.1 และ §4.2 ผ่านครบ
- `svelte-autofixer` ผ่านทุก `.svelte` ที่แตะ

---

## 5. Impact

- **ใหม่:** feature `kiosk-banners`, `lib/server/kiosk-banners`, routes back-office + kiosk API, หน้า `/back-office/kiosks/banners/**`, kiosk overlay, `lib/features/shared/domain/kiosk-screen.ts`, schema.md §3.12, api-contract.md §2.3
- **แก้:** `routes/kiosk/+page.svelte`, `features/kiosk/index.ts`, `kiosk/app/manager.py`, VDU ของ `registry` (version 5 → 6), back-office navbar (`static.ts` + active = match ยาวที่สุด), `user-form.svelte` (คำอธิบาย `kiosk_staff`), `scanner_device` (`banner_enabled`, `screen_type`) + หน้า/API จัดการเครื่อง, env ของ service frontend (`BODY_SIZE_LIMIT`)
- **Docs (หลัง approve ส่วนที่ปรับ):** schema.md §3.11 / §3.12 / §6 · api-contract.md §2.2–2.3 · kiosk-banner-design-guideline.md · role-permission-matrix.md แถว Kiosk Banner · แถว CR-162 ใน `_index.md`
- **ไม่กระทบ:** worker, FastAPI, Mongo, `announcement` (CR-100), flow ค้นหา/ลงทะเบียนของ kiosk, `confineKioskStaffOnly`, `ShelterScopeSelect`, `roles.ts` (นอกจาก test)
- **ความเสี่ยง:** SA ต้องสลับศูนย์ก่อนสร้าง banner ให้ศูนย์อื่น และ banner เดียวกันหลายศูนย์ต้องสร้างซ้ำ — ยอมรับเพื่อให้ตรงกับหน้า kiosk อื่น · `BODY_SIZE_LIMIT` เป็นค่า global ของ Node server (กระทบทุก route ฝั่ง SvelteKit)
- **Base branch:** โค้ดยึด `feat/pre-register_kiosk` (ยังไม่ merge เข้า develop) — branch implementation ต้องแตกจาก branch นั้น และ merge ตามหลัง CR-151/152 · เอกสารของ CR นี้เข้า `develop` ผ่าน branch `docs/cr-162-kiosk-banner`

## 6. Migration

- **Data:** N/A — ยังไม่มี doc `kiosk_banner` · คง `schema_v 1`
- **Users:** ตรวจ `_users` ว่ามี `{code}:banner_staff` หรือไม่ (ตาม CR-165 §6) ถ้ามีให้แทนด้วย `{code}:kiosk_staff`
- **`scanner_device.banner_enabled`:** additive optional — ไม่ backfill · doc เดิมอ่านเป็น `true`
- **`screen_type` (`scanner_device`, `kiosk_banner`):** additive optional — ไม่ backfill · doc เดิมอ่านเป็น `compact` · ตู้ใหญ่ที่มีอยู่แล้วต้องตั้ง「ตู้ใหญ่」ในหน้าจัดการเครื่องหลัง deploy ไม่งั้นจะได้ banner ตู้เล็ก · `REGISTRY_DESIGN_VERSION` +1 (VDU เช็ก enum)
- **Deploy:** ตั้ง `BODY_SIZE_LIMIT=4M` ให้ service frontend (ไม่มี env ใหม่สำหรับ signed URL — ใช้ `EXTERNAL_API_SECRET` เดิม) · deploy kiosk client ที่มี allowlist ใหม่ (ตู้ที่ยังไม่อัปเดตแค่ไม่เห็น banner — feed POST ไม่ได้ credential → `401` → fail soft)
- **Registry design:** version 6 ถูก push ตอน server start ตามกลไกเดิมของ `registry-design.ts`

## 7. Open questions (ข้อเสนอของทีม kiosk — Team Lead อนุมัติตามข้อเสนอทั้งหมด 2026-10-18)

| #   | คำถาม                                                                                      | ข้อเสนอ                                                                        |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Q1  | ชื่อเมนูลูก                                                                                | 「จัดการแบนเนอร์」(คู่กับ「จัดการอุปกรณ์」)                                    |
| Q2  | เก็บ `updated_by` ด้วยไหม                                                                  | ยังไม่เพิ่ม — ถ้าต้องการ audit เพิ่มเป็น field additive ใน v1 ได้ก่อน deploy   |
| Q3  | ใครทำ docs-sync ที่ค้างจาก CR-165 (schema.md §3.11/§6, api-contract §2.1–2.2, role matrix) | แยกเป็นงาน docs ของ CR-165 · CR นี้แก้เฉพาะส่วน banner                         |
| Q4  | SA สร้าง banner ให้หลายศูนย์ด้วยการสลับศูนย์ — ยอมรับได้ไหม                                | ยอมรับ · ถ้าภายหลังต้องการ broadcast ทุกศูนย์ให้เปิด CR ใหม่                   |
| Q5  | ค่าเริ่มต้นของ `banner_enabled` สำหรับเครื่องใหม่ / เครื่องเดิม                            | เปิด (`true` / ไม่มี field) — banner ขึ้นเฉพาะเมื่อเจ้าหน้าที่สร้างไว้อยู่แล้ว |

## 8. อ้างอิง

- ไฟล์ประกอบ CR (Google Drive): <https://drive.google.com/drive/folders/1WveB8a35GO591A-blUZuFdyKzdxRz51H?usp=sharing>
- แนวทาง implement: [`docs/features/kiosk-banner-design-guideline.md`](../../features/kiosk-banner-design-guideline.md)
- CR ที่เกี่ยวข้อง: [CR-165](./CR-165-kiosk-management-back-office.md) (kiosk back-office, `kiosk_staff`, `/api/v1/kiosk/*`)

## Decision log

- 2026-10-11 — proposed · owner เลือก scope banner รูปภาพ, track เป็นไฟล์ CR ใน `14-kiosk/`, ยึด base code `feat/pre-register_kiosk`
- 2026-10-11 — ไม่รองรับ iframe/link slide (เปิดเว็บภายนอกบนตู้ + เสี่ยงรั่ว device credential)
- 2026-10-11 — `caption` เป็น text เท่านั้น ไม่รองรับ HTML
- 2026-10-11 — owner เคาะ: เพิ่ม role `banner_staff` และให้ `shelter_manager` + `system_admin` จัดการได้ด้วย (FR-KBN-24/26/27) · ยืนยันค่า idle 30 s, refresh 5 นาที, รูป ≤2 MB, `duration_sec` 3–60 (role `banner_staff` ถูกแทนด้วย `kiosk_staff` ตาม CR-165 — ดู FR-KBN-26)
- 2026-10-11 — เอกสารเป็น docs-only PR เข้า `develop` (branch `docs/cr-162-kiosk-banner`); implementation แยกเป็นงานถัดไปบน base `feat/pre-register_kiosk`
- 2026-10-11 — เพิ่ม FR-KBN-21/23/28/29: แจ้งชนิด/ขนาดไฟล์, Switch สถานะ, preview ตอนเลือกไฟล์ + รูปปัจจุบันในหน้าแก้ไข, ปุ่มดูตัวอย่างบน kiosk (จากผลทดสอบระบบเดิมที่ไม่มีทั้งสี่ข้อ)
- 2026-10-11 — owner เคาะ out of scope §3.5 (คงค่าเดิมทั้งหมด)
- 2026-10-11 — **approved** โดย Soravit Sukkarn (Team Lead) รวมถึง role ใหม่ `banner_staff` (ต่อมาแทนด้วย `kiosk_staff`) · รันเลข CR-162 (ล่าสุดบน develop = CR-161)
- 2026-10-15 — proposed โดยทีม kiosk: `shelter_code` เดียวตาม active shelter, หน้า `/back-office/kiosks/banners` + `/new` + `/[id]`, `{id}` นอก scope `404`, reuse guard / capability ของ CR-165 (FR-KBR-01..34) · รอ Team Lead / Project Owner เคาะ
- 2026-10-15 — proposed โดยทีม kiosk (เพิ่ม): ไม่ใช้ env `KIOSK_BANNER_URL_SECRET` — derive key ของ signed URL จาก `EXTERNAL_API_SECRET` · flag `banner_enabled` รายเครื่องใน `scanner_device` (FR-KBR-35..38) · รอ Team Lead / Project Owner เคาะ
- 2026-10-16 — proposed โดยทีม kiosk (เพิ่ม): `screen_type` ตู้เล็ก 1024×600 / ตู้ใหญ่ 1080×1920 ต่อเครื่องและต่อ banner (banner ละ 1 ขนาด · ไม่มี field = ตู้เล็ก) · feed กรองตามขนาดเครื่อง · filter + preview แยกขนาด (FR-KBR-39..44) · เตือนลำดับซ้ำแบบไม่บล็อก + ค่าเริ่มต้นลำดับถัดไป (FR-KBR-45 — ส่วนเตือนลำดับซ้ำ/กรอกลำดับถูกแทนด้วยรายการ 2026-10-17 ด้านล่าง) · รอ Team Lead / Project Owner เคาะ
- 2026-10-17 — proposed โดยทีม kiosk (แก้ในไฟล์นี้): ลำดับกำหนดโดย server · ฟอร์มไม่มีช่องลำดับ · หน้ารายการเป็น card ต่อขนาดจอ → หน้าจัดการต่อขนาดจอ · จัดลำดับแบบลากวาง + `PUT …/order` (FR-KBN-05/19/20/21 + Acceptance · แถวจัดลำดับเดิมใช้เลข FR-KBN-30 ซ้ำกับ kiosk API จึงเปลี่ยนเป็น FR-KBN-19) · รอ Team Lead เคาะ
- 2026-10-17 — proposed โดยทีม kiosk (เพิ่ม): overlay บนตู้แสดงรูปอย่างเดียวเต็มพื้นที่ทั้ง 2 ขนาด (`object-contain` ไม่ crop) · เอา caption, dot indicator และข้อความ「แตะหน้าจอเพื่อเริ่มใช้งาน」ออก (แทนส่วนนั้นของ FR-KBN-44/45 · FR-KBR-46, AC-KBR-20) · รอ Team Lead / Project Owner เคาะ
- 2026-10-17 — รวม `draft-kiosk-banner-design-revision.md` เข้ามาใน CR นี้ (FR-KBR-01..46, AC-KBR-01..20 คง id เดิม) · ลบไฟล์ draft · รอ Team Lead / Project Owner เคาะส่วนที่ปรับ
- 2026-10-18 — **approved** โดย Team Lead: ส่วนที่ปรับ/เพิ่ม 2026-10-15..17 ทั้งหมด (FR-KBR-01..46, AC-KBR-01..20, แถว FR-KBN ที่แก้) และ §7 Q1–Q5 ตามข้อเสนอ · sync schema.md / api-contract.md / role-permission-matrix.md ตามไฟล์นี้
- 2026-10-18 — แก้ตาม PR review: Mango index เป็น `["type", "shelter_code"]` (index 3 field เดิมไม่ถูกใช้เพราะ selector ไม่มี `end_at`) และ deploy ใน `registry-redeploy.ts` · GET รูปฝั่งตู้ cache ได้ `private` ตามอายุลายเซ็นที่เหลือ (รูปเดิมวนซ้ำทุกรอบสไลด์)
