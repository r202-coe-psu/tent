---
title: Kiosk Banner — Design Pattern Guideline
status: active
created: 2026-10-11
updated: 2026-10-22
author: Soravit Sukkarn (Team Lead)
base_branch: feat/pre-register_kiosk
note: 2026-10-22 — banner group Team Lead อนุมัติ (CR-162 §3.7 FR-KBG) · 2026-10-21 — เพิ่มหมายเหตุ banner group: path map หน้ากลุ่ม + group API · 2026-10-18 — sync ตาม CR-162 ส่วนที่ปรับ 2026-10-15..17 (`shelter_code` เดียว, `screen_type`, `banner_enabled`, path `/back-office/kiosks/banners` + `/api/v1/kiosk/*`, role `kiosk_staff` ของ CR-165, client `kiosk/`, จัดลำดับลากวาง, overlay รูปอย่างเดียว)
affects:
  - docs/changes/14-kiosk/CR-162-kiosk-banner.md
  - docs/data/schema.md §3.11 (scanner_device) · §3.12 (kiosk_banner) · §3.13 (kiosk_banner_group — 2026-10-21)
  - docs/data/api-contract.md §2.2 · §2.3 Kiosk banner · §2.3.1 Kiosk banner group (2026-10-21)
  - docs/prd/role-permission-matrix.md §1.1 (kiosk_staff)
---

# Kiosk Banner — Design Pattern Guideline

> **สรุป (TL;DR)**
>
> - เอกสารนี้คือ **แนวทาง implement** kiosk banner ใน tent — requirement ที่ผูกพันอยู่ใน [CR-162](../changes/14-kiosk/CR-162-kiosk-banner.md) (FR-KBN-xx, FR-KBR-xx); ถ้าขัดกัน **CR ชนะ**
> - Flow: doc `kiosk_banner` ใน `registry` → back-office CRUD (`kiosk_staff` / SM / SA ของ active shelter) → `POST /api/v1/kiosk/banners` (device auth, กรองตามศูนย์ + ขนาดจอของเครื่อง) → **attract overlay** บน `/kiosk`
> - **(2026-10-21 · Team Lead อนุมัติ 2026-10-22) banner group:** เครื่องสังกัดกลุ่ม (`scanner_device.banner_group_id`) แทน `banner_enabled` · banner สังกัดกลุ่ม (`kiosk_banner.group_id`) · ข้างในกลุ่มแยกตู้เล็ก/ตู้ใหญ่ · หน้า back-office เปลี่ยนเป็น `/back-office/kiosks/banners` (กลุ่ม) → `groups/{group}` → `groups/{group}/{compact|portrait}` — ดู §2.3 ท้ายตาราง path และ CR-162 §3.7
> - อ่านก่อนเขียนโค้ดทุกส่วนของ feature นี้: §1 หลักการ, §2 layer map + path map (§2.3), §3 state machine, §4 security, §6 checklist

---

## 1. หลักการออกแบบ

| #   | หลักการ                       | วิธีทำใน tent                                                                                                                                                         |
| :-- | :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **Scheduled window**          | `start_at` / `end_at` (ISO UTC) · เทียบเวลาที่ **server** ไม่ใช่นาฬิกาเครื่อง · ช่วงครึ่งเปิด `[start, end)` · `end_at > start_at` ตรวจทั้ง Zod และ VDU               |
| P2  | **Per-slide duration**        | `duration_sec` 3–60 default 10 · rotation ใช้ `setTimeout` ต่อสไลด์ ไม่ใช่ `setInterval` คงที่                                                                        |
| P3  | **Deterministic order**       | `order` กำหนดโดย server (ต่อท้ายของขนาดจอนั้น · เปลี่ยนด้วยลากวางเท่านั้น) · sort ฝั่ง server: `order` asc → `start_at` asc → `_id` asc ภายในขนาดจอเดียวกัน           |
| P4  | **Target by shelter + screen** | `shelter_code` + `screen_type` ของ banner เทียบกับ device principal (`authenticateScannerDevice`) · ไม่มี field = `compact` · ห้ามอ่าน scope จาก query string / display context |
| P5  | **Device-authenticated feed** | `X-Device-Id` / `X-Device-Secret` ฉีดโดย `kiosk/app/manager.py` `_route_kiosk_api` (POST same-origin + allowlist) · browser ไม่ถือ secret (FR-KPC-06)                  |
| P6  | **Image only**                | รองรับเฉพาะรูป png / jpeg / webp ≤2 MB · ไม่มี iframe / link slide (เปิดเว็บภายนอกบนตู้ + เสี่ยงรั่ว credential) · overlay แสดงรูปอย่างเดียว ไม่มี caption (FR-KBR-46) |
| P7  | **Text-only caption**         | `caption` เก็บและแก้ได้ใน back-office เท่านั้น · ห้าม `{@html}` · `alt = title`                                                                                        |
| P8  | **Fail soft, never break**    | ไม่มี banner / API ล้ม / รูปเสีย / `banner_enabled = false` (2026-10-21: เครื่องไม่มี `banner_group_id`) → ไม่แสดง overlay หรือข้ามสไลด์ · หน้าเลือกวิธีทำงานปกติ · ไม่มี JS error                                  |
| P9  | **Safe mutations**            | เปิด/ปิด = `PATCH`, ลบ = `DELETE`, จัดลำดับ = `PUT …/order` ผ่าน BFF ที่ตรวจ `_session` · ลบ = hard delete ทั้ง doc (attachment หายไปด้วย)                             |
| P10 | **Refresh without reload**    | refetch JSON ทุก 5 นาที · ไม่ reload หน้า `/kiosk`                                                                                                                    |
| P11 | **Timestamps at call time**   | `created_at` / `updated_at` สร้างใน factory ณ เวลาเรียก                                                                                                               |

---

## 2. Architecture

### 2.1 Data flow

```
SA / SM / kiosk_staff (back-office, _session, active shelter = X)
  └─ /back-office/kiosks/banners[/new|/{id}|/{compact|portrait}]   guard: requireKioskManagement
       └─ /api/back-office/kiosk-banners[/{id}[/image]|/order]?shelter_code=X
            │  authz: requireShelterCapabilityCaller(cookie, SCANNER_MANAGER_CAPABILITIES)
            └─ CouchDB registry  kiosk_banner:{ulid}  + _attachments.image   (VDU + index kiosk-banner-by-shelter)

kiosk (Chromium --kiosk, /kiosk)
  └─ features/kiosk/data/kiosk-banners.api.ts   POST /api/v1/kiosk/banners
       │   (kiosk/app/manager.py _route_kiosk_api ฉีด X-Device-Id/Secret)
       └─ +server.ts → authenticateScannerDevice → principal.shelter_code + screen_type + banner_enabled
            → filter active window + shelter + screen → sort → ≤20 → sign image_url (15 min)
            (2026-10-21: principal.banner_group_id แทน banner_enabled · ไม่มีกลุ่ม → [] ไม่ query
             · filter shelter + group_id + screen · back-office เพิ่ม /api/back-office/kiosk-banner-groups[/{id}[/devices]])
  └─ <img src=image_url>   GET /api/v1/kiosk/banners/{id}/image?exp&sig  (ไม่มี device header · cache private ตามอายุลายเซ็น)
```

ไม่ผ่าน worker / Mongo / FastAPI — kiosk ไม่ใช่ anonymous public plane และใช้ pattern เดียวกับ `kiosk/config` (CR-152)

**ทำไมรูปใช้ signed GET URL:** `<img>` ส่งได้แค่ GET และ `_route_kiosk_api` ฉีด device header ให้เฉพาะ POST ใน allowlist · ส่งรูปเป็น base64 ใน POST ทำให้ payload ใหญ่ทุกรอบ refresh

### 2.2 Layer map

| ส่วน                                                      | ที่อยู่                                                                                  | Mirror จาก                                                                                               |
| :-------------------------------------------------------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| Domain (Zod, factory, `isActiveAt`, `sortBanners`, order) | `lib/features/kiosk-banners/domain/`                                                     | `features/announcements/domain/announcement.ts`                                                          |
| Screen type enum + ขนาดจอ                                 | `lib/features/shared/domain/kiosk-screen.ts` · `params/kioskScreen.ts`                   | —                                                                                                        |
| Repository interface + remote (back-office)               | `lib/features/kiosk-banners/data/`                                                       | `features/shelters/data/*.repository.ts` + `*.remote.ts`                                                 |
| Query hooks (back-office)                                 | `lib/features/kiosk-banners/application/`                                                | `features/announcements/application/announcement.queries.ts`                                             |
| Back-office UI                                            | `lib/features/kiosk-banners/ui/` + `routes/(protected)/back-office/kiosks/banners/`      | หน้า `/back-office/kiosks` (CR-165)                                                                      |
| Server helpers (registry CRUD, image decode, sign/verify) | `lib/server/kiosk-banners/`                                                              | `lib/server/announcements-server.ts`, `features/kiosk/server/kiosk-photo.server.ts` (`decodeKioskPhoto`) |
| Server authz                                              | `lib/server/kiosk-banners/kiosk-banner-access.ts`                                        | `lib/server/scanners/scanner-access.ts`                                                                  |
| Registry design + Mango index                             | `lib/server/registry-design.ts` · `lib/server/registry-redeploy.ts` (`pnpm db:sync`)     | views เดิมของ `registry`                                                                                 |
| Kiosk feed route                                          | `routes/api/v1/kiosk/banners/+server.ts`                                                 | `routes/api/v1/kiosk/config/+server.ts`                                                                  |
| Kiosk image route                                         | `routes/api/v1/kiosk/banners/[id]/image/+server.ts`                                      | —                                                                                                        |
| Kiosk client fetch                                        | `lib/features/kiosk/data/kiosk-banners.api.ts`                                           | `features/kiosk/data/kiosk-config.api.ts`                                                                |
| Attract overlay                                           | `lib/features/kiosk/ui/kiosk-banner-attract.svelte` (+ `.svelte.ts` controller)          | `features/kiosk/ui/kiosk-idle-timeout.svelte.ts`                                                         |
| Device proxy                                              | `kiosk/app/manager.py` `allowed_paths`                                                   | entries เดิมของ CR-151/152                                                                               |
| Role                                                      | `lib/auth/roles.ts` `KIOSK_STAFF` + `SCANNER_MANAGER_CAPABILITIES` (CR-165) — ไม่มี role ใหม่ | capability roles เดิม (CR-104)                                                                       |

กติกา:

- ฝั่ง kiosk ใช้ plain `fetch` ตาม feature kiosk เดิม (timeout 3 s, `cache: 'no-store'`) ไม่ใช้ TanStack Query
- kiosk ไม่ import `kiosk-banners` — ใช้แค่ response shape ของ API (กำหนด type ใน `features/kiosk/domain/`)
- ฝั่ง back-office import ข้าม feature ผ่าน barrel เท่านั้น — preview ใช้ `KioskBannerAttract` จาก `$lib/features/kiosk` เพื่อให้ตัวอย่างตรงกับบนตู้ (component รับ `banners` เป็น prop และมีโหมด preview ที่ไม่ใช้ idle timer)
- ทุกหน้า back-office ใช้ active shelter (`shelterStore.selectedShelterCode ?? getShelterCode()`) · ไม่มีตัวเลือกศูนย์ในฟอร์ม

### 2.3 Path map

#### URL paths

| Path                                                       | Method                                      | ผู้เรียก                        | Auth                                          | สถานะ                        |
| :--------------------------------------------------------- | :------------------------------------------ | :------------------------------ | :-------------------------------------------- | :--------------------------- |
| `/kiosk`                                                   | page                                        | Chromium บนตู้                  | — (anonymous page; API ใช้ device credential) | มีอยู่ — เพิ่ม overlay       |
| `/back-office/kiosks/banners`                              | page (card ต่อขนาดจอ)                       | `kiosk_staff` / SM / SA         | `_session` + `requireKioskManagement`         | **ใหม่**                     |
| `/back-office/kiosks/banners/{compact\|portrait}`          | page (2 แท็บ + ลากวางจัดลำดับ)              | `kiosk_staff` / SM / SA         | `_session` + `requireKioskManagement`         | **ใหม่**                     |
| `/back-office/kiosks/banners/new` · `/back-office/kiosks/banners/{id}` | page (ฟอร์มสร้าง / แก้ไข)       | `kiosk_staff` / SM / SA         | `_session` + `requireKioskManagement`         | **ใหม่**                     |
| `/api/back-office/kiosk-banners`                           | `GET` (list) · `POST` (create + รูป base64) | back-office UI                  | `_session` + scope ของ `?shelter_code=`       | **ใหม่**                     |
| `/api/back-office/kiosk-banners/{id}`                      | `GET` · `PUT` · `PATCH` (status) · `DELETE` | back-office UI                  | `_session` + scope ของ `doc.shelter_code` (นอก scope `404`) | **ใหม่**       |
| `/api/back-office/kiosk-banners/{id}/image`                | `GET`                                       | back-office UI (preview)        | `_session` + scope                            | **ใหม่**                     |
| `/api/back-office/kiosk-banners/order`                     | `PUT`                                       | back-office UI (ลากวาง)         | `_session` + scope ของ `?shelter_code=`       | **ใหม่**                     |
| `/api/v1/kiosk/banners`                                    | `POST`                                      | ตู้ (ผ่าน `kiosk/app/manager.py`) | `X-Device-Id` / `X-Device-Secret`           | **ใหม่**                     |
| `/api/v1/kiosk/banners/{id}/image?exp=&sig=`               | `GET`                                       | `<img>` บนตู้                   | signed URL (HMAC, 15 นาที)                    | **ใหม่**                     |
| `/api/v1/kiosk/config`                                     | `POST`                                      | ตู้                             | device credential                             | มีอยู่ — template ที่ mirror |
| `/api/public/v1/system-banner`                             | `GET`                                       | ทุกหน้า (`SystemBannerHost`)    | —                                             | มีอยู่ — overlay ห้ามบัง     |

#### Banner group — path เพิ่ม/เปลี่ยน (2026-10-21 — CR-162 §3.7)

> แถว `/back-office/kiosks/banners` (card ต่อขนาดจอ) และ `/back-office/kiosks/banners/{compact|portrait}` ในตารางด้านบนถูกแทนที่ด้วยตารางนี้ (Team Lead อนุมัติ 2026-10-22) · `/new` / `/{id}` ยังอยู่ (เพิ่ม select กลุ่ม required) · ตารางด้านบนไม่ถูกแก้เพื่อคงฉบับที่อนุมัติไว้

| Path                                                              | Method                              | ผู้เรียก                | Auth                                                     | สถานะ                                                         |
| :---------------------------------------------------------------- | :---------------------------------- | :---------------------- | :------------------------------------------------------- | :------------------------------------------------------------ |
| `/back-office/kiosks/banners`                                     | page (card ต่อกลุ่ม + สร้างกลุ่ม + ยังไม่จัดกลุ่ม) | `kiosk_staff` / SM / SA | `_session` + `requireKioskManagement`                    | **แทนที่** card ต่อขนาดจอ                                      |
| `/back-office/kiosks/banners/groups/new`                          | page (ขั้น 1 ชื่อ · ขั้น 2 เลือกเครื่อง)           | `kiosk_staff` / SM / SA | เหมือนข้างบน                                             | **ใหม่**                                                       |
| `/back-office/kiosks/banners/groups/{group}`                      | page (header กลุ่ม + card ต่อขนาดจอ + สร้างแบนเนอร์) | `kiosk_staff` / SM / SA | เหมือนข้างบน                                             | **ใหม่**                                                       |
| `/back-office/kiosks/banners/groups/{group}/{compact\|portrait}`  | page (2 แท็บ + ลากวางจัดลำดับต่อ slot)           | `kiosk_staff` / SM / SA | เหมือนข้างบน                                             | **ใหม่** — แทน `/back-office/kiosks/banners/{compact\|portrait}` (route เดิม redirect ไป `/back-office/kiosks/banners`) |
| `/back-office/kiosks/banners/new?group=&screen=` · `/{id}`        | page (ฟอร์ม + select กลุ่ม required)               | `kiosk_staff` / SM / SA | เหมือนข้างบน                                             | แก้                                                            |
| `/api/back-office/kiosk-banner-groups`                            | `GET` (list + `device_ids`) · `POST`               | back-office UI          | `_session` + scope ของ `?shelter_code=`                  | **ใหม่**                                                       |
| `/api/back-office/kiosk-banner-groups/{id}`                       | `GET` · `PUT` · `DELETE ?rev=` (มี banner `409`)   | back-office UI          | `_session` + scope ของ `doc.shelter_code` (นอก scope `404`) | **ใหม่**                                                    |
| `/api/back-office/kiosk-banner-groups/{id}/devices`               | `PUT` `{ device_ids }` (แทนที่สมาชิก)              | back-office UI          | `_session` + scope                                       | **ใหม่**                                                       |
| `/api/back-office/kiosk-banners` · `/{id}` · `/order`             | เพิ่ม `group_id` (create / update) · order body `{ group_id, screen_type, items }` | back-office UI | เหมือนเดิม                                    | แก้                                                            |
| `/api/v1/kiosk/banners`                                           | `POST` — กรองตาม `banner_group_id` ของเครื่อง · shape เดิม | ตู้                | device credential                                        | แก้ (allowlist `manager.py` ไม่เปลี่ยน)                        |
| `/api/v1/kiosk/devices/{id}`                                      | `PATCH` ตัด `banner_enabled` · summary มี `banner_group_id` | back-office UI   | เหมือนเดิม                                               | แก้                                                            |

ไฟล์เพิ่มของ group: `lib/features/kiosk-banners/domain/kiosk-banner-group.ts` · `ui/kiosk-banner-group-{card,form,device-picker}.svelte` · `lib/server/kiosk-banners/kiosk-banner-group.server.ts` · `routes/api/back-office/kiosk-banner-groups/**` · `routes/(protected)/back-office/kiosks/banners/groups/{new,[group],[group]/[screen=kioskScreen]}/+page.{ts,svelte}` · schema.md §3.13 · api-contract.md §2.3.1

#### ไฟล์ใหม่ (`frontend/src/` ยกเว้นระบุ)

| ไฟล์                                                                                                   | หน้าที่                                                                                       |
| :----------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| `lib/features/kiosk-banners/domain/{kiosk-banner,kiosk-banner-image,kiosk-banner-form,kiosk-banner-datetime}.ts` (+ `.test.ts`) | Zod schema, factory, `isActiveAt`, `sortBanners`, ลำดับ, decode รูป, ค่าฟอร์ม/เวลา |
| `lib/features/shared/domain/kiosk-screen.ts` · `params/kioskScreen.ts`                                 | enum `compact` / `portrait` + ขนาดจอ · param matcher ของหน้าขนาดจอ                            |
| `lib/features/kiosk-banners/data/kiosk-banner.repository.ts` · `kiosk-banner.remote.ts` (+ `.test.ts`) | repository interface + adapter เรียก `/api/back-office/kiosk-banners/**`                      |
| `lib/features/kiosk-banners/application/kiosk-banner.queries.ts`                                       | query-key factory + `createQuery` / `createMutation`                                          |
| `lib/features/kiosk-banners/ui/kiosk-banner-{form,screen-card,screen-manager,order-list,row-actions,preview-dialog}.svelte` | ฟอร์ม + preview, card ต่อขนาดจอ, หน้าจัดการต่อขนาดจอ (2 แท็บ + ลากวาง), เมนูต่อแถว, ตัวอย่างบนตู้ |
| `lib/features/kiosk-banners/index.ts`                                                                  | barrel                                                                                        |
| `lib/server/kiosk-banners/kiosk-banner.server.ts` (+ `.test.ts`)                                       | registry CRUD, PUT attachment, reorder (`_bulk_docs`)                                         |
| `lib/server/kiosk-banners/kiosk-banner-access.ts`                                                      | `requireBannerManager` / `loadBannerInScope`                                                  |
| `lib/server/kiosk-banners/signed-image-url.ts` (+ `.test.ts`)                                          | sign / verify HMAC                                                                            |
| `routes/(protected)/back-office/kiosks/banners/{+page,new/+page,[id]/+page,[screen=kioskScreen]/+page}.{ts,svelte}` | หน้ารายการ / สร้าง / แก้ไข / จัดการต่อขนาดจอ                                 |
| `routes/api/back-office/kiosk-banners/{+server,[id]/+server,[id]/image/+server,order/+server}.ts` (+ `server.test.ts`) | list / create · get / update / status / delete · รูป preview · จัดลำดับ    |
| `routes/api/v1/kiosk/banners/+server.ts` · `[id]/image/+server.ts` (+ `server.test.ts`)                | feed ของตู้ · รูปของตู้ (signed)                                                              |
| `lib/features/kiosk/domain/kiosk-banner-feed.ts`                                                       | type ของ response feed (kiosk ไม่ import `kiosk-banners`)                                     |
| `lib/features/kiosk/data/kiosk-banners.api.ts` (+ `.test.ts`)                                          | `fetch` feed, timeout 3 s, fail soft                                                          |
| `lib/features/kiosk/ui/kiosk-banner-attract.svelte` · `.svelte.ts` (+ `.test.ts`)                      | overlay เต็มจอ · controller: idle, rotation, refresh                                          |

#### ไฟล์ที่ต้องแก้

| ไฟล์                                                                            | แก้อะไร                                                                                      |
| :------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------- |
| `frontend/src/routes/kiosk/+page.svelte`                                        | mount `KioskBannerAttract`                                                                   |
| `frontend/src/lib/features/kiosk/index.ts`                                      | export overlay + `fetchKioskBanners`                                                         |
| `frontend/src/lib/server/registry-design.ts`                                    | VDU รองรับ `type: 'kiosk_banner'` (version 5 → 6 → 7) · `KIOSK_BANNER_MANGO_INDEX`           |
| `frontend/src/lib/server/registry-redeploy.ts`                                  | deploy Mango index ของ `registry` ใน `pnpm db:sync` / `sync:central`                         |
| `frontend/src/lib/components/backoffice-navbar/static.ts` · `backoffice-navbar.svelte` | เมนูลูก「จัดการแบนเนอร์」ใต้「จัดการ Kiosk」· active = match ยาวที่สุด                 |
| `frontend/src/lib/features/users/ui/user-form.svelte`                           | คำอธิบาย `kiosk_staff` รวมแบนเนอร์                                                           |
| `frontend/src/lib/features/kiosk-devices/**` · `lib/server/scanners/{device-repository,device-credentials}.ts` · `routes/api/v1/kiosk/devices/**` | `screen_type` + `banner_enabled` ของเครื่อง (Switch + ขนาดจอ) |
| `kiosk/app/manager.py` · `kiosk/tests/test_manager.py`                          | `/api/v1/kiosk/banners` ใน `allowed_paths` ของ `_route_kiosk_api` + test                     |
| compose prod (service frontend) · `frontend/.env.example`                       | `BODY_SIZE_LIMIT=4M` · หมายเหตุ `EXTERNAL_API_SECRET` ใช้ derive key ของ signed URL (ไม่มี env ใหม่) |
| `docs/data/schema.md`                                                           | §3.11 `scanner_device` · §3.12 `kiosk_banner` · §6 `_users.roles` · §7 index                 |
| `docs/data/api-contract.md`                                                     | §2.2 field เครื่อง · §2.3 kiosk banners + back-office kiosk-banners                          |
| `docs/prd/role-permission-matrix.md`                                            | §1.1 KIO `kiosk_staff` + แถว Kiosk Banner                                                    |

#### ไฟล์อ้างอิง (อ่านเป็นแบบอย่าง ไม่ต้องแก้)

| ไฟล์                                                                                           | ใช้เป็นแบบอย่างเรื่อง                                              |
| :--------------------------------------------------------------------------------------------- | :----------------------------------------------------------------- |
| `frontend/src/routes/api/v1/kiosk/config/+server.ts` + `server.test.ts`                        | device auth, no-store, error envelope, mock pattern                |
| `frontend/src/lib/features/kiosk/data/kiosk-config.api.ts` + `.test.ts`                        | plain fetch, timeout, fail closed/soft                             |
| `frontend/src/lib/server/scanners/device-credentials.ts`                                       | `authenticateScannerDevice`, `ScannerAuthError`, `timingSafeEqual` |
| `frontend/src/lib/server/scanners/scanner-access.ts`                                           | authz ของ back-office kiosk (SA / SM / `kiosk_staff`)              |
| `frontend/src/lib/features/kiosk/server/kiosk-photo.server.ts`                                 | decode base64 + ตรวจ MIME + PUT attachment                         |
| `frontend/src/lib/server/announcements-server.ts` · `routes/api/back-office/announcements/**`  | registry CRUD + back-office BFF                                    |
| `frontend/src/lib/features/shelters/data/shelters.repository.ts` + `shelters.remote.ts`        | repository interface + remote adapter                              |
| `frontend/src/lib/features/kiosk/ui/kiosk-idle-timeout.svelte.ts` + `.test.ts`                 | idle timer + fake-timer test                                       |
| `frontend/src/lib/features/kiosk/domain/kiosk-layout.ts` + `.test.ts` · `frontend/src/app.css` | media literal `kiosk-compact` / `kiosk-portrait`                   |
| `frontend/src/lib/features/kiosk/ui/identity-method-selector.svelte` · `kiosk-shell.svelte`    | layout หน้า `/kiosk` ที่ overlay ทับ                               |
| `frontend/src/lib/components/system-banner-host.svelte` · `frontend/src/routes/+layout.svelte` | ประกาศระบบ fixed bottom                                            |
| `frontend/src/lib/guards/auth.ts` (`requireKioskManagement`) · `routes/(protected)/back-office/+layout.ts` | guard ของ back-office kiosk                          |

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

| กฎ           | รายละเอียด                                                                                                                                                                                            |
| :----------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idle timer   | 30 s (`KIOSK_BANNER_IDLE_MS`) นับจาก `pointerdown` / `keydown` ล่าสุดบน `/kiosk` — reuse `KioskIdleTimeout` โดยส่ง timeout เข้าไป (ไม่ copy logic) · หลังปิด overlay เริ่มนับใหม่                     |
| Dismiss      | `pointerdown` บน overlay → ปิด + `preventDefault()` / `stopPropagation()` และกลืน click ถัดไป เพื่อไม่ให้คลิกทะลุไปเลือกการ์ด                                                                          |
| Rotation     | `setTimeout` ด้วย `duration_sec` ของสไลด์ปัจจุบัน · รายการเดียว = ไม่ตั้ง timer · clear ทุก timer เมื่อ unmount                                                                                       |
| Refresh      | ดึงใหม่ทุก 5 นาที · รายการเปลี่ยนระหว่าง Showing → ใช้ชุดใหม่ที่สไลด์ถัดไป · เหลือ 0 → Hidden                                                                                                         |
| Broken image | `onerror` → ข้ามสไลด์ · ทุกสไลด์เสีย → Hidden                                                                                                                                                         |
| Signed URL   | อายุ 15 นาที > รอบ refresh 5 นาที → ได้ URL ใหม่ก่อนหมดเสมอ · รูปตอบ `cache-control: private, max-age` ตามอายุที่เหลือ จึงวนรูปเดิมโดยไม่โหลดใหม่                                                     |
| Layout       | รูปอย่างเดียว `object-contain` เต็มพื้นที่ overlay · ไม่มี caption / dot / ข้อความ · ไม่ scroll ที่ 1024×600 (`kiosk-compact`) และ 1080×1920 (`kiosk-portrait`) · ใช้ media literal จาก `kiosk-layout.ts` · ไม่บัง `SystemBannerHost` |
| Reactivity   | Svelte 5 runes · state ใน class `$state` · สไลด์ปัจจุบันใช้ `$derived` · timer อยู่ใน controller ไม่ใช่ `$effect` ที่คำนวณค่า                                                                         |

---

## 4. Security

1. **Credential boundary:** device secret อยู่ใน kiosk client (`kiosk/`) เท่านั้น · การเพิ่ม path ใน `allowed_paths` คือจุดเดียวที่เปิดสิทธิ์ · ต้องมี test spoof header
2. **Signed image URL:** `sig = HMAC-SHA256(key, "{id}.{exp}")` hex lowercase · `key = HMAC-SHA256(EXTERNAL_API_SECRET, "kiosk-banner-image-url:v1")` (server-only, ไม่มี env ใหม่, ห้าม `PUBLIC_`) · เทียบด้วย `timingSafeEqual` · sig ผิด/หมดอายุ = 403 · ไม่พบ/ไม่ active = 404 · secret ไม่ได้ตั้ง = 503
3. **Authorization (back-office):** ตรวจทุก request ที่ BFF · SA ผ่านทุกศูนย์ · `shelter_manager` / `kiosk_staff` จัดการได้เฉพาะ banner ที่ `shelter_code` อยู่ใน scope · `shelter_code` ตั้งครั้งเดียวตอนสร้างและแก้ไม่ได้ (กันการย้าย banner ข้ามศูนย์) · `{id}` นอก scope ตอบ `404` (ไม่บอกว่ามี id อยู่)
4. **Input validation:** Zod ที่ client + server · VDU ใน `registry` เป็นด่านสุดท้าย · decode รูป (base64 canonical) + ตรวจ magic bytes ฝั่ง server ก่อน PUT attachment (ไม่เชื่อ extension / `Content-Type`)
5. **รูปฝั่ง back-office:** โหลดผ่าน route ที่ตรวจ session + scope (`private, no-store`) — ไม่มี endpoint รูปที่ไม่ยืนยันตัวตน
6. **Cache:** feed และ error ทุกกรณีของ `/api/v1/kiosk/*` ตอบ `cache-control: no-store` + `pragma: no-cache` · ยกเว้นรูปที่ลายเซ็นถูกต้อง ตอบ `private, max-age={วินาทีที่ลายเซ็นเหลือ}` (≤900)

---

## 5. Content guideline (สำหรับผู้สร้าง banner)

| หัวข้อ    | แนวทาง                                                                                                                                               |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| ขนาดรูป   | ตู้เล็ก (`compact` 1024×600): แนวนอน เช่น 1920×1080 · ตู้ใหญ่ (`portrait` 1080×1920): แนวตั้ง 9:16 · banner หนึ่งรายการต่อหนึ่งขนาดจอ — ถ้าจะแสดงทั้งสองขนาดให้สร้าง 2 รายการ · `object-contain` → อัตราส่วนไม่ตรงจะมีขอบ ไม่ถูก crop |
| Safe area | เว้นขอบล่าง ~12% สำหรับแถบประกาศระบบ                                                                                                                 |
| ตัวอักษร  | ≥48 px ที่ความกว้าง 1920 · ข้อความหลักไม่เกิน 2 บรรทัด · ข้อความต้องอยู่ในรูป (ตู้ไม่แสดง caption)                                                    |
| ไฟล์      | png / jpeg / webp · ≤2 MB · ห้ามมีข้อมูลส่วนบุคคลของผู้อพยพ                                                                                          |
| ระยะเวลา  | 8–15 s ต่อรูปที่มีข้อความ · ทั้งรอบไม่ควรเกิน ~2 นาที                                                                                                |

---

## 6. Implementation checklist

- [ ] schema.md §3.11 / §3.12 + VDU ก่อนเขียนโค้ด (code ห้ามนำ schema)
- [ ] ใช้ `kiosk_staff` + `SCANNER_MANAGER_CAPABILITIES` ของ CR-165 (ไม่เพิ่ม role) + role-permission-matrix + schema.md §6 + คำอธิบาย role ในหน้าจัดการผู้ใช้ + เมนูลูกใต้「จัดการ Kiosk」
- [ ] domain tests: schema, `isActiveAt` (ขอบ start/end), sort ครบ 3 key, ลำดับต่อขนาดจอ, factory timestamp
- [ ] server tests: back-office authz (SA / SM / `kiosk_staff` / ศูนย์อื่น → `403` / `404` / role อื่น / แก้ `shelter_code` → `422`) · kiosk feed (401, 503, filter ศูนย์ + ขนาดจอ, `banner_enabled = false`, sort, limit, no-store) · signed URL (ok + cache private / expired / tampered / not found)
- [ ] Mango index `kiosk-banner-by-shelter` deploy ผ่าน `pnpm db:sync`
- [ ] overlay test (fake timers): idle 30 s, dismiss กลืน event, rotation ตาม duration, empty, broken image, refresh
- [ ] `kiosk-layout.test.ts` ผ่าน
- [ ] `kiosk/tests/test_manager.py`: path ใหม่ได้ header เฉพาะ POST same-origin · GET ไม่ได้ header
- [ ] ทุก `.svelte` ผ่าน `svelte-autofixer`
- [ ] e2e: back-office CRUD + upload + จัดลำดับ

---

## 7. อ้างอิง

- CR: [CR-162](../changes/14-kiosk/CR-162-kiosk-banner.md) · [CR-165](../changes/14-kiosk/CR-165-kiosk-management-back-office.md) (`kiosk_staff`, `/api/v1/kiosk/*`, client `kiosk/`)
- Kiosk: CR-151 (FR-KPC-06/07/13/14), CR-152 (`kiosk/config`), [`smart-card-registration-spec.md`](smart-card-registration-spec.md)
- Roles: [`docs/prd/role-permission-matrix.md`](../prd/role-permission-matrix.md), `frontend/src/lib/auth/roles.ts`
