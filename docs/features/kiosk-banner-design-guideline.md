---
title: Kiosk Banner — Design Pattern Guideline
status: draft for review
created: 2026-10-11
updated: 2026-10-11
author: Soravit Sukkarn (Team Lead)
base_branch: feat/pre-register_kiosk
affects:
  - docs/changes/draft-kiosk-banner.md
  - docs/data/schema.md §3.12 (kiosk_banner — proposed)
  - docs/data/api-contract.md §2.1 Scanner kiosk
  - docs/prd/role-permission-matrix.md §1.1 (banner_staff — proposed)
---

# Kiosk Banner — Design Pattern Guideline

> **สรุป (TL;DR)**
>
> - เอกสารนี้คือ **แนวทาง implement** kiosk banner ใน tent — requirement ที่ผูกพันอยู่ใน CR [`draft-kiosk-banner`](../changes/draft-kiosk-banner.md) (FR-KBN-xx); ถ้าขัดกัน **CR ชนะ**
> - Flow: doc `kiosk_banner` ใน `registry` → back-office CRUD (`banner_staff` / SM / SA) → `POST /api/v1/scanner/kiosk/banners` (device auth) → **attract overlay** บน `/kiosk`
> - อ่านก่อนเขียนโค้ดทุกส่วนของ feature นี้: §1 หลักการ, §2 layer map + path map (§2.3), §3 state machine, §4 security, §6 checklist

---

## 1. หลักการออกแบบ

| #   | หลักการ                       | วิธีทำใน tent                                                                                                                                           |
| :-- | :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | **Scheduled window**          | `start_at` / `end_at` (ISO UTC) · เทียบเวลาที่ **server** ไม่ใช่นาฬิกาเครื่อง · ช่วงครึ่งเปิด `[start, end)` · `end_at > start_at` ตรวจทั้ง Zod และ VDU |
| P2  | **Per-slide duration**        | `duration_sec` 3–60 default 10 · rotation ใช้ `setTimeout` ต่อสไลด์ ไม่ใช่ `setInterval` คงที่                                                          |
| P3  | **Deterministic order**       | sort ฝั่ง server: `order` asc → `start_at` asc → `_id` asc                                                                                              |
| P4  | **Target by shelter**         | `shelter_codes[]` เทียบกับ `shelter_code` ของ device principal (`authenticateScannerDevice`) · ห้ามอ่าน scope จาก query string / display context        |
| P5  | **Device-authenticated feed** | `X-Device-Id` / `X-Device-Secret` ฉีดโดย `scanner_client` `_route_kiosk_api` (POST same-origin + allowlist) · browser ไม่ถือ secret (FR-KPC-06)         |
| P6  | **Image only**                | รองรับเฉพาะรูป png / jpeg / webp ≤2 MB · ไม่มี iframe / link slide (เปิดเว็บภายนอกบนตู้ + เสี่ยงรั่ว credential)                                        |
| P7  | **Text-only caption**         | `{caption}` ใน Svelte · ห้าม `{@html}` · `alt = title`                                                                                                  |
| P8  | **Fail soft, never break**    | ไม่มี banner / API ล้ม / รูปเสีย → ไม่แสดง overlay หรือข้ามสไลด์ · หน้าเลือกวิธีทำงานปกติ · ไม่มี JS error                                              |
| P9  | **Safe mutations**            | เปิด/ปิด = `PATCH`, ลบ = `DELETE` ผ่าน BFF ที่ตรวจ `_session` · ลบ = hard delete ทั้ง doc (attachment หายไปด้วย)                                        |
| P10 | **Refresh without reload**    | refetch JSON ทุก 5 นาที · ไม่ reload หน้า `/kiosk`                                                                                                      |
| P11 | **Timestamps at call time**   | `created_at` / `updated_at` สร้างใน factory ณ เวลาเรียก                                                                                                 |

---

## 2. Architecture

### 2.1 Data flow

```
banner_staff / SM / SA (portal, _session)
  └─ /back-office/kiosk-banners  (Superforms + Zod)
       └─ /api/back-office/kiosk-banners/**   ── authz: SA | {code}:shelter_manager | {code}:banner_staff
            └─ CouchDB registry  kiosk_banner:{ulid}  + _attachments.image

kiosk (Chromium --kiosk, /kiosk)
  └─ features/kiosk/data/kiosk-banners.api.ts   POST /api/v1/scanner/kiosk/banners
       │   (scanner_client _route_kiosk_api ฉีด X-Device-Id/Secret)
       └─ +server.ts → authenticateScannerDevice → principal.shelter_code
            → filter active window + shelter → sort → ≤20 → sign image_url (15 min)
  └─ <img src=image_url>   GET /api/v1/scanner/kiosk/banners/{id}/image?exp&sig  (ไม่มี device header)
```

ไม่ผ่าน worker / Mongo / FastAPI — kiosk ไม่ใช่ anonymous public plane และใช้ pattern เดียวกับ `kiosk/config` (CR-152)

**ทำไมรูปใช้ signed GET URL:** `<img>` ส่งได้แค่ GET และ `_route_kiosk_api` ฉีด device header ให้เฉพาะ POST ใน allowlist · ส่งรูปเป็น base64 ใน POST ทำให้ payload ใหญ่ทุกรอบ refresh

### 2.2 Layer map

| ส่วน                                                      | ที่อยู่                                                                            | Mirror จาก                                                                                               |
| :-------------------------------------------------------- | :--------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| Domain (Zod, factory, `isActiveAt`, `sortBanners`)        | `lib/features/kiosk-banners/domain/`                                               | `features/announcements/domain/announcement.ts`                                                          |
| Repository interface + remote (back-office)               | `lib/features/kiosk-banners/data/`                                                 | `features/shelters/data/*.repository.ts` + `*.remote.ts`                                                 |
| Query hooks (back-office)                                 | `lib/features/kiosk-banners/application/`                                          | `features/announcements/application/announcement.queries.ts`                                             |
| Back-office UI                                            | `lib/features/kiosk-banners/ui/` + `routes/(protected)/back-office/kiosk-banners/` | `system-management/announcements/+page.svelte`                                                           |
| Server helpers (registry CRUD, image decode, sign/verify) | `lib/server/kiosk-banners/`                                                        | `lib/server/announcements-server.ts`, `features/kiosk/server/kiosk-photo.server.ts` (`decodeKioskPhoto`) |
| Kiosk feed route                                          | `routes/api/v1/scanner/kiosk/banners/+server.ts`                                   | `routes/api/v1/scanner/kiosk/config/+server.ts`                                                          |
| Kiosk image route                                         | `routes/api/v1/scanner/kiosk/banners/[id]/image/+server.ts`                        | —                                                                                                        |
| Kiosk client fetch                                        | `lib/features/kiosk/data/kiosk-banners.api.ts`                                     | `features/kiosk/data/kiosk-config.api.ts`                                                                |
| Attract overlay                                           | `lib/features/kiosk/ui/kiosk-banner-attract.svelte` (+ `.svelte.ts` controller)    | `features/kiosk/ui/kiosk-idle-timeout.svelte.ts`                                                         |
| Device proxy                                              | `scanner_client/app/manager.py` `allowed_paths`                                    | entries เดิมของ CR-151/152                                                                               |
| Role                                                      | `lib/auth/roles.ts` `BANNER_STAFF` ใน `STAFF_CAPABILITIES`                         | capability roles เดิม (CR-104)                                                                           |

กติกา:

- ฝั่ง kiosk ใช้ plain `fetch` ตาม feature kiosk เดิม (timeout 3 s, `cache: 'no-store'`) ไม่ใช้ TanStack Query
- kiosk ไม่ import `kiosk-banners` — ใช้แค่ response shape ของ API (กำหนด type ใน `features/kiosk/domain/`)
- ฝั่ง back-office import ข้าม feature ผ่าน barrel เท่านั้น

### 2.3 Path map

#### URL paths

| Path                                                 | Method                                      | ผู้เรียก                     | Auth                                          | สถานะ                        |
| :--------------------------------------------------- | :------------------------------------------ | :--------------------------- | :-------------------------------------------- | :--------------------------- |
| `/kiosk`                                             | page                                        | Chromium บนตู้               | — (anonymous page; API ใช้ device credential) | มีอยู่ — เพิ่ม overlay       |
| `/back-office/kiosk-banners`                         | page                                        | `banner_staff` / SM / SA     | `_session`                                    | **ใหม่**                     |
| `/api/back-office/kiosk-banners`                     | `GET` (list) · `POST` (create + รูป base64) | back-office UI               | `_session` + scope                            | **ใหม่**                     |
| `/api/back-office/kiosk-banners/{id}`                | `GET` · `PUT` · `PATCH` (status) · `DELETE` | back-office UI               | `_session` + scope ค่าเดิม/ค่าใหม่            | **ใหม่**                     |
| `/api/back-office/kiosk-banners/{id}/image`          | `GET`                                       | back-office UI (preview)     | `_session` + scope                            | **ใหม่**                     |
| `/api/v1/scanner/kiosk/banners`                      | `POST`                                      | ตู้ (ผ่าน scanner client)    | `X-Device-Id` / `X-Device-Secret`             | **ใหม่**                     |
| `/api/v1/scanner/kiosk/banners/{id}/image?exp=&sig=` | `GET`                                       | `<img>` บนตู้                | signed URL (HMAC, 15 นาที)                    | **ใหม่**                     |
| `/api/v1/scanner/kiosk/config`                       | `POST`                                      | ตู้                          | device credential                             | มีอยู่ — template ที่ mirror |
| `/api/public/v1/system-banner`                       | `GET`                                       | ทุกหน้า (`SystemBannerHost`) | —                                             | มีอยู่ — overlay ห้ามบัง     |

#### ไฟล์ใหม่ (`frontend/src/` ยกเว้นระบุ)

| ไฟล์                                                                                  | หน้าที่                                                   |
| :------------------------------------------------------------------------------------ | :-------------------------------------------------------- |
| `lib/features/kiosk-banners/domain/kiosk-banner.ts` (+ `.test.ts`)                    | Zod schema, factory, `isActiveAt`, `sortBanners`          |
| `lib/features/kiosk-banners/data/kiosk-banner.repository.ts`                          | repository interface                                      |
| `lib/features/kiosk-banners/data/kiosk-banner.remote.ts` (+ `.test.ts`)               | adapter เรียก `/api/back-office/kiosk-banners/**`         |
| `lib/features/kiosk-banners/application/kiosk-banner.queries.ts`                      | query-key factory + `createQuery` / `createMutation`      |
| `lib/features/kiosk-banners/ui/kiosk-banner-list.svelte` · `kiosk-banner-form.svelte` | ตาราง 2 แท็บ, ฟอร์ม + upload preview                      |
| `lib/features/kiosk-banners/index.ts`                                                 | barrel                                                    |
| `lib/server/kiosk-banners/kiosk-banner.server.ts` (+ `.test.ts`)                      | registry CRUD, decode/ตรวจรูป, PUT attachment             |
| `lib/server/kiosk-banners/signed-image-url.ts` (+ `.test.ts`)                         | sign / verify HMAC                                        |
| `routes/(protected)/back-office/kiosk-banners/+page.svelte` (+ `+page.ts` guard)      | หน้าจัดการ                                                |
| `routes/api/back-office/kiosk-banners/+server.ts` (+ `server.test.ts`)                | list / create                                             |
| `routes/api/back-office/kiosk-banners/[id]/+server.ts` (+ `server.test.ts`)           | get / update / status / delete                            |
| `routes/api/back-office/kiosk-banners/[id]/image/+server.ts` (+ `server.test.ts`)     | รูปสำหรับ preview                                         |
| `routes/api/v1/scanner/kiosk/banners/+server.ts` (+ `server.test.ts`)                 | feed ของตู้                                               |
| `routes/api/v1/scanner/kiosk/banners/[id]/image/+server.ts` (+ `server.test.ts`)      | รูปของตู้ (signed)                                        |
| `lib/features/kiosk/domain/kiosk-banner-feed.ts`                                      | type ของ response feed (kiosk ไม่ import `kiosk-banners`) |
| `lib/features/kiosk/data/kiosk-banners.api.ts` (+ `.test.ts`)                         | `fetch` feed, timeout 3 s, fail soft                      |
| `lib/features/kiosk/ui/kiosk-banner-attract.svelte` (+ `.test.ts`)                    | overlay เต็มจอ                                            |
| `lib/features/kiosk/ui/kiosk-banner-attract.svelte.ts` (+ `.test.ts`)                 | controller: idle, rotation, refresh                       |
| `frontend/e2e/kiosk-banners.test.ts`                                                  | e2e back-office CRUD + upload                             |

#### ไฟล์ที่ต้องแก้

| ไฟล์                                                      | แก้อะไร                                                                   |
| :-------------------------------------------------------- | :------------------------------------------------------------------------ |
| `frontend/src/routes/kiosk/+page.svelte`                  | mount `KioskBannerAttract`                                                |
| `frontend/src/lib/features/kiosk/index.ts`                | export overlay + `fetchKioskBanners`                                      |
| `frontend/src/lib/auth/roles.ts` (+ `roles.test.ts`)      | `BANNER_STAFF` ใน `STAFF_CAPABILITIES` + helper `canManageKioskBanners`   |
| `frontend/src/lib/features/users/domain/schema.ts`        | role ใหม่ในตัวเลือกของฟอร์มผู้ใช้                                         |
| `frontend/src/lib/server/user-service.ts`                 | ยอมให้ SM grant `banner_staff`                                            |
| `frontend/src/lib/server/registry-design.ts`              | VDU `buildRegistryValidateDocUpdate()` รองรับ `type: 'kiosk_banner'`      |
| `frontend/src/lib/components/backoffice-navbar/static.ts` | เมนู「แบนเนอร์ Kiosk」(เห็นเฉพาะ `banner_staff` / SM / SA)                |
| `scanner_client/app/manager.py`                           | `/api/v1/scanner/kiosk/banners` ใน `allowed_paths` ของ `_route_kiosk_api` |
| `scanner_client/tests/test_manager.py`                    | test allowlist + GET ไม่ได้ header                                        |
| `docs/data/schema.md`                                     | §3.12 `kiosk_banner` · §6 `_users.roles` (`banner_staff`)                 |
| `docs/data/api-contract.md`                               | §2.1 kiosk banners · back-office kiosk-banners                            |
| `docs/prd/role-permission-matrix.md`                      | §1.1 + ตารางสิทธิ์ `banner_staff`                                         |
| `frontend/.env.example`                                   | server-only secret สำหรับ signed URL (เช่น `KIOSK_BANNER_URL_SECRET`)     |

#### ไฟล์อ้างอิง (อ่านเป็นแบบอย่าง ไม่ต้องแก้)

| ไฟล์                                                                                           | ใช้เป็นแบบอย่างเรื่อง                                              |
| :--------------------------------------------------------------------------------------------- | :----------------------------------------------------------------- |
| `frontend/src/routes/api/v1/scanner/kiosk/config/+server.ts` + `server.test.ts`                | device auth, no-store, error envelope, mock pattern                |
| `frontend/src/lib/features/kiosk/data/kiosk-config.api.ts` + `.test.ts`                        | plain fetch, timeout, fail closed/soft                             |
| `frontend/src/lib/server/scanners/device-credentials.ts`                                       | `authenticateScannerDevice`, `ScannerAuthError`, `timingSafeEqual` |
| `frontend/src/lib/features/kiosk/server/kiosk-photo.server.ts`                                 | decode base64 + ตรวจ MIME + PUT attachment                         |
| `frontend/src/lib/server/announcements-server.ts` · `routes/api/back-office/announcements/**`  | registry CRUD + back-office BFF                                    |
| `frontend/src/lib/features/announcements/**`                                                   | domain / queries ของ registry doc                                  |
| `frontend/src/lib/features/shelters/data/shelters.repository.ts` + `shelters.remote.ts`        | repository interface + remote adapter                              |
| `frontend/src/lib/server/couch-admin.ts`                                                       | `requireSystemAdmin`, `requireShelterManagerOrSA`, `serviceError`  |
| `frontend/src/lib/features/kiosk/ui/kiosk-idle-timeout.svelte.ts` + `.test.ts`                 | idle timer + fake-timer test                                       |
| `frontend/src/lib/features/kiosk/domain/kiosk-layout.ts` + `.test.ts` · `frontend/src/app.css` | media literal `kiosk-compact` / `kiosk-portrait`                   |
| `frontend/src/lib/features/kiosk/ui/identity-method-selector.svelte` · `kiosk-shell.svelte`    | layout หน้า `/kiosk` ที่ overlay ทับ                               |
| `frontend/src/lib/components/system-banner-host.svelte` · `frontend/src/routes/+layout.svelte` | ประกาศระบบ fixed bottom                                            |
| `frontend/src/routes/(protected)/back-office/+layout.ts`                                       | guard ของ back-office                                              |

---

## 3. Attract overlay — state machine

```
            fetch ok & banners>0              idle 30s
 [Hidden] ─────────────────────────► [Armed] ─────────► [Showing]
    ▲  ▲                               │  ▲                 │
    │  └── fetch fail / banners=0 ─────┘  └── tap/key ──────┘
    │                                       (ปิด overlay, กลืน event)
    └── ออกจาก /kiosk (เสียบบัตร / เลือกวิธี) → stop timers
```

| กฎ           | รายละเอียด                                                                                                                                                                                                             |
| :----------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idle timer   | 30 s นับจาก `pointerdown` / `keydown` ล่าสุดบน `/kiosk` — reuse `KioskIdleTimeout` โดยส่ง timeout เข้าไป (ไม่ copy logic)                                                                                              |
| Dismiss      | `pointerdown` บน overlay → ปิด + `preventDefault()` / `stopPropagation()` เพื่อไม่ให้คลิกทะลุไปเลือกการ์ด                                                                                                              |
| Rotation     | `setTimeout` ด้วย `duration_sec` ของสไลด์ปัจจุบัน · รายการเดียว = ไม่ตั้ง timer · clear ทุก timer เมื่อ unmount                                                                                                        |
| Refresh      | ดึงใหม่ทุก 5 นาที · รายการเปลี่ยนระหว่าง Showing → ใช้ชุดใหม่ที่สไลด์ถัดไป · เหลือ 0 → Hidden                                                                                                                          |
| Broken image | `onerror` → ข้ามสไลด์ · ทุกสไลด์เสีย → Hidden                                                                                                                                                                          |
| Signed URL   | อายุ 15 นาที > รอบ refresh 5 นาที → ได้ URL ใหม่ก่อนหมดเสมอ                                                                                                                                                            |
| Layout       | `object-contain` · caption ใต้รูป · ไม่ scroll ที่ 1024×600 (`kiosk-compact`) และ 1080×1920 (`kiosk-portrait`) · ใช้ media literal จาก `kiosk-layout.ts` (ต้องผ่าน `kiosk-layout.test.ts`) · ไม่บัง `SystemBannerHost` |
| Reactivity   | Svelte 5 runes · state ใน class `$state` · สไลด์ปัจจุบันใช้ `$derived` · timer อยู่ใน controller ไม่ใช่ `$effect` ที่คำนวณค่า                                                                                          |

---

## 4. Security

1. **Credential boundary:** device secret อยู่ใน scanner client เท่านั้น · การเพิ่ม path ใน `allowed_paths` คือจุดเดียวที่เปิดสิทธิ์ · ต้องมี test spoof header
2. **Signed image URL:** `sig = HMAC-SHA256(server_secret, "{id}.{exp}")` · เทียบด้วย `timingSafeEqual` · secret เป็น server-only env (ห้าม `PUBLIC_`) · sig ผิด/หมดอายุ = 403 · ไม่พบ/ไม่ active = 404
3. **Authorization (back-office):** ตรวจทุก request ที่ BFF · SA ผ่านทุกศูนย์ · `shelter_manager` / `banner_staff` ต้องมี scope ครอบ **ทุก** `shelter_codes` ของ banner ทั้ง **ค่าเดิมและค่าใหม่** (กันการย้าย banner ของศูนย์อื่นมาเป็นของตัวเอง)
4. **Input validation:** Zod ที่ client + server · VDU ใน `registry` เป็นด่านสุดท้าย · decode รูป + ตรวจ magic bytes ฝั่ง server ก่อน PUT attachment (ไม่เชื่อ extension / `Content-Type`)
5. **รูปฝั่ง back-office:** โหลดผ่าน route ที่ตรวจ session + scope — ไม่มี endpoint รูปที่ไม่ยืนยันตัวตน
6. **Cache:** `cache-control: no-store` + `pragma: no-cache` ทุก response ของ `/api/v1/scanner/*` รวม route รูป

---

## 5. Content guideline (สำหรับผู้สร้าง banner)

| หัวข้อ    | แนวทาง                                                                                                                                                   |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ขนาดรูป   | แนวนอน 16:9 (เช่น 1920×1080) สำหรับตู้ 1024×600 · แนวตั้ง 9:16 (1080×1920) ถ้าศูนย์ใช้ตู้แนวตั้ง · `object-contain` → อัตราส่วนไม่ตรงจะมีขอบ ไม่ถูก crop |
| Safe area | เว้นขอบล่าง ~12% สำหรับ caption และแถบประกาศระบบ                                                                                                         |
| ตัวอักษร  | ≥48 px ที่ความกว้าง 1920 · ข้อความหลักไม่เกิน 2 บรรทัด                                                                                                   |
| ไฟล์      | png / jpeg / webp · ≤2 MB · ห้ามมีข้อมูลส่วนบุคคลของผู้อพยพ                                                                                              |
| ระยะเวลา  | 8–15 s ต่อรูปที่มีข้อความ · ทั้งรอบไม่ควรเกิน ~2 นาที                                                                                                    |

---

## 6. Implementation checklist

- [ ] schema.md §3.12 + VDU ก่อนเขียนโค้ด (code ห้ามนำ schema)
- [ ] `banner_staff` ใน `roles.ts` + role-permission-matrix + schema.md §6 + ตัวเลือก role ในหน้าจัดการผู้ใช้ + เมนู portal
- [ ] domain tests: schema, `isActiveAt` (ขอบ start/end), sort ครบ 3 key, factory timestamp
- [ ] server tests: back-office authz (SA / SM / banner_staff / ศูนย์อื่น / ย้ายศูนย์ / role อื่น) · kiosk feed (401, 503, filter, sort, limit, no-store) · signed URL (ok / expired / tampered / not found)
- [ ] overlay test (fake timers): idle 30 s, dismiss กลืน event, rotation ตาม duration, empty, broken image, refresh
- [ ] `kiosk-layout.test.ts` ผ่าน
- [ ] `scanner_client/tests/test_manager.py`: path ใหม่ได้ header เฉพาะ POST same-origin · GET ไม่ได้ header
- [ ] ทุก `.svelte` ผ่าน `svelte-autofixer`
- [ ] e2e: back-office CRUD + upload

---

## 7. อ้างอิง

- CR: [`docs/changes/draft-kiosk-banner.md`](../changes/draft-kiosk-banner.md)
- Kiosk: CR-151 (FR-KPC-06/07/13/14), CR-152 (`kiosk/config`), [`smart-card-registration-spec.md`](smart-card-registration-spec.md)
- Roles: [`docs/prd/role-permission-matrix.md`](../prd/role-permission-matrix.md), `frontend/src/lib/auth/roles.ts`
