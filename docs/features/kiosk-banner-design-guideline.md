---
title: Kiosk Banner — Design Pattern Guideline (ported from ghosa)
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
> - เอกสารนี้คือ **แนวทางออกแบบ (design pattern)** ของ kiosk banner — requirement ที่ผูกพันอยู่ใน CR [`draft-kiosk-banner`](../changes/draft-kiosk-banner.md) (FR-KBN-xx); ถ้าขัดกัน **CR ชนะ**
> - ที่มา: ฟีเจอร์ banner ของ **ghosa** (`/home/jk/ghosa`, Flask + MongoDB + Jinja) — คง pattern ที่ใช้ได้จริง 6 ข้อ (§2) และห้ามทำซ้ำ anti-pattern 10 ข้อ (§3)
> - รูปแบบใน tent: doc `kiosk_banner` ใน `registry` → back-office CRUD (`banner_staff` / SM / SA) → `POST /api/v1/scanner/kiosk/banners` (device auth) → **attract overlay** บน `/kiosk`
> - อ่านก่อนเขียนโค้ดทุกส่วนของ feature นี้ (§4 layer map, §5 state machine, §6 security, §8 checklist)

---

## 1. ghosa ทำอะไร (สรุป reference)

| ส่วน       | ghosa                                                                                                                                     | ไฟล์อ้างอิง (`/home/jk/ghosa/ghosa/`)                    |
| :--------- | :---------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------- |
| Model      | `Banner`: `name`, `description`, `order`, `image` (GridFS), `link` (iframe), `duration` (s), `status`, `start_date`, `end_date`, `groups` | `models/banners.py`                                      |
| Targeting  | `Group` (มี `landing_message`) ↔ `Device.groups` ↔ `Banner.groups`                                                                        | `models/groups.py`, `models/devices.py`                  |
| Admin      | CRUD + toggle + delete, role `admin`, แท็บ active/passed                                                                                  | `web/views/admin/banners.py`, `templates/admin/banner/*` |
| Kiosk feed | `GET /devices/landing` (HTML) ยืนยันด้วย `X-Api-Key` · filter active + ช่วงเวลา + group                                                   | `web/views/devices.py:19-71`                             |
| Render     | `setTimeout` วนสไลด์ตาม `data-duration` · รูป / iframe / placeholder                                                                      | `templates/devices/landing.html`                         |
| Refresh    | Playwright `page.goto()` ทุก 10 นาที                                                                                                      | `app/manager.py:30, 222-225`                             |

---

## 2. Patterns ที่นำมาใช้ (KEEP)

### P1 — Scheduled content window

banner มี `start_at` / `end_at`; feed คืนเฉพาะ `start_at ≤ now < end_at` · ฝั่ง admin แยกแท็บตาม `end_at`

- **tent:** เทียบเวลาที่ **server** (UTC ISO) ไม่ใช่นาฬิกาเครื่อง kiosk · ใช้ช่วงครึ่งเปิด `[start, end)` · validate `end_at > start_at` ทั้ง Zod และ VDU (ghosa ไม่ validate)

### P2 — Per-slide duration

แต่ละสไลด์มีเวลาของตัวเอง (ghosa `duration`, default 10 s)

- **tent:** `duration_sec` 3–60 default 10 · ขอบล่างกันสไลด์กระพริบ, ขอบบนกันสไลด์เดียวค้างทั้งชั่วโมง

### P3 — Content targeting via device membership

ghosa: device อยู่ใน group, banner เลือก group → ตู้แสดงเฉพาะ banner ของ group ตัวเอง

- **tent:** หน่วยเป้าหมาย = **ศูนย์** (`shelter_codes[]`) ซึ่ง `scanner_device.shelter_code` มีอยู่แล้ว — ไม่สร้าง group entity ใหม่
- scope มาจาก **device principal** (`authenticateScannerDevice`) เท่านั้น — ห้ามอ่านจาก query string / display context

### P4 — Device-authenticated feed

ตู้ดึง feed ด้วย credential ของเครื่อง ไม่ใช่ session ผู้ใช้

- **tent:** `X-Device-Id` / `X-Device-Secret` ที่ scanner client ฉีดผ่าน `_route_kiosk_api` (POST + allowlist) · browser ไม่ถือ secret (FR-KPC-06)

### P5 — Kiosk = full-screen browser page

ghosa: Playwright เปิด Firefox kiosk mode ชี้หน้าเว็บ — เปลี่ยน content ได้โดยไม่ deploy ที่ตู้

- **tent:** pattern เดียวกัน (Chromium `--kiosk` ใน `scanner_client`) · banner เป็นแค่ component ใน `/kiosk` ไม่ใช่หน้าแยก

### P6 — Status toggle แยกจากการลบ

ปิด banner ชั่วคราวได้โดยไม่ลบ (`active` / `inactive`)

- **tent:** `PATCH` เปลี่ยน `status` · `DELETE` = hard delete

---

## 3. Anti-patterns ที่พบใน ghosa (DO NOT COPY)

| #   | ghosa                                                            | ผลเสีย                                             | tent ทำแบบนี้แทน                                                                          |
| :-- | :--------------------------------------------------------------- | :------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| A1  | ไม่มี banner → `0 % 0` = NaN → JS throw (`landing.html:110`)     | หน้าจอค้าง/ข้อความไม่อัปเดต                        | empty state ชัดเจน: ไม่มี banner = ไม่แสดง overlay · component ต้อง guard `length === 0`  |
| A2  | `order` เก็บแต่ไม่ได้ใช้ sort                                    | admin ตั้งลำดับแล้วไม่มีผล                         | sort `order` → `start_at` → `_id` ฝั่ง server (deterministic)                             |
| A3  | toggle/delete เป็น `GET` ไม่มี CSRF                              | prefetch/crawler ลบข้อมูลได้                       | `PATCH` / `DELETE` ผ่าน BFF ที่ตรวจ `_session`                                            |
| A4  | endpoint รูปไม่ตรวจสิทธิ์ (decorator ถูก comment) · id ผิด = 500 | รูปที่ปิด/หมดอายุยังดึงได้                         | kiosk: signed URL อายุสั้น + ตรวจ active window · back-office: ตรวจ session · ไม่พบ = 404 |
| A5  | `X-Api-Key` แนบทุก request ของ browser context รวม iframe ภายนอก | device secret รั่วไปเว็บอื่น                       | ไม่มี iframe slide · header ฉีดเฉพาะ POST same-origin ใน allowlist                        |
| A6  | `iframe` ของ `link` ใด ๆ                                         | เปิดเว็บภายนอกบนตู้สาธารณะ, รั่ว key, หน้าเว็บค้าง | รองรับเฉพาะรูปภาพ                                                                         |
| A7  | `landing_message` ใส่ด้วย `innerHTML`                            | HTML injection บนตู้                               | `caption` เป็น text (`{caption}` ใน Svelte, ไม่ใช้ `{@html}`)                             |
| A8  | ตรวจแค่ extension, ไม่จำกัดขนาด                                  | ไฟล์ใหญ่/ไม่ใช่รูปจริงขึ้นตู้                      | ≤2 MB · png/jpeg/webp · ตรวจ magic bytes (mirror `decodeKioskPhoto`)                      |
| A9  | `default=datetime.now()` (มีวงเล็บ) → timestamp = เวลาตอน import | `created_at` ผิดทุก record                         | สร้าง timestamp ใน factory ณ เวลาเรียก                                                    |
| A10 | reload ทั้งหน้าทุก 10 นาที · ลบ doc ไม่ลบไฟล์ GridFS             | ข่าวช้า 10 นาที, ไฟล์ค้าง                          | refetch JSON ทุก 5 นาที ไม่ reload หน้า · รูปเป็น attachment ของ doc ลบพร้อมกัน           |

---

## 4. Architecture ใน tent

### 4.1 Data flow

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

ไม่ผ่าน worker / Mongo / FastAPI — kiosk ไม่ใช่ anonymous public plane และ pattern เดียวกับ `kiosk/config` (CR-152)

### 4.2 Layer map

| ส่วน                                                      | ที่อยู่                                                                            | Mirror จาก                                                                          |
| :-------------------------------------------------------- | :--------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| Domain (Zod, factory, `isActiveAt`, `sortBanners`)        | `lib/features/kiosk-banners/domain/`                                               | `features/announcements/domain/announcement.ts`                                     |
| Repository interface + remote (back-office)               | `lib/features/kiosk-banners/data/`                                                 | `features/shelters/data/*.repository.ts` + `*.remote.ts`                            |
| Query hooks (back-office)                                 | `lib/features/kiosk-banners/application/`                                          | `features/announcements/application/announcement.queries.ts`                        |
| Back-office UI                                            | `lib/features/kiosk-banners/ui/` + `routes/(protected)/back-office/kiosk-banners/` | `system-management/announcements/+page.svelte`                                      |
| Server helpers (registry CRUD, image decode, sign/verify) | `lib/server/kiosk-banners/`                                                        | `lib/server/announcements-server.ts`, `features/kiosk/server/kiosk-photo.server.ts` |
| Kiosk feed route                                          | `routes/api/v1/scanner/kiosk/banners/+server.ts`                                   | `routes/api/v1/scanner/kiosk/config/+server.ts`                                     |
| Kiosk client fetch                                        | `lib/features/kiosk/data/kiosk-banners.api.ts`                                     | `features/kiosk/data/kiosk-config.api.ts`                                           |
| Attract overlay                                           | `lib/features/kiosk/ui/kiosk-banner-attract.svelte` (+ `.svelte.ts` controller)    | `features/kiosk/ui/kiosk-idle-timeout.svelte.ts`                                    |
| Device proxy                                              | `scanner_client/app/manager.py` `allowed_paths`                                    | entries เดิมของ CR-151/152                                                          |

กติกา: kiosk feature import `kiosk-banners` ผ่าน barrel เท่านั้น — หรือดีกว่านั้น ไม่ import เลย (kiosk ใช้แค่ response shape จาก API) · ฝั่ง kiosk ใช้ plain `fetch` ตาม feature kiosk เดิม ไม่ใช้ TanStack Query

---

## 5. Attract overlay — state machine

```
            fetch ok & banners>0              idle 30s
 [Hidden] ─────────────────────────► [Armed] ─────────► [Showing]
    ▲  ▲                               │  ▲                 │
    │  └── fetch fail / banners=0 ─────┘  └── tap/key ──────┘
    │                                       (ปิด overlay, กลืน event)
    └── ออกจาก /kiosk (เสียบบัตร / เลือกวิธี) → stop timers
```

| กฎ                 | รายละเอียด                                                                                                                                                            |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idle timer         | 30 s นับจาก `pointerdown` / `keydown` ล่าสุดบน `/kiosk` — reuse class `KioskIdleTimeout` ด้วย timeout ที่ส่งเข้าไป (ไม่ copy logic)                                   |
| Dismiss            | `pointerdown` บน overlay → ปิด + `preventDefault()` / `stopPropagation()` เพื่อไม่ให้ "คลิกทะลุ" ไปเลือกการ์ด · overlay ต้องอยู่บนสุดของ `/kiosk` ใน `pointer-events` |
| Rotation           | `setTimeout` ต่อสไลด์ด้วย `duration_sec` ของสไลด์นั้น (ไม่ใช้ `setInterval` คงที่) · รายการเดียว = ไม่ตั้ง timer · clear ทุก timer เมื่อ unmount                      |
| Refresh            | ดึงใหม่ทุก 5 นาที; ถ้ารายการเปลี่ยนระหว่าง Showing → แทนที่ที่สไลด์ถัดไป (ไม่กระชากสไลด์ปัจจุบัน) · ถ้าเหลือ 0 → Hidden                                               |
| Broken image       | `onerror` → ข้ามสไลด์นั้น · ทุกสไลด์เสีย → Hidden                                                                                                                     |
| Signed URL หมดอายุ | อายุ 15 นาที > รอบ refresh 5 นาที เสมอ — รอบ refresh ได้ URL ใหม่ก่อนหมด                                                                                              |
| Reactivity         | Svelte 5 runes · state ใน class `$state` · คำนวณสไลด์ปัจจุบันด้วย `$derived` · timer อยู่ใน controller ไม่ใช่ `$effect` ที่คำนวณค่า                                   |

---

## 6. Security patterns

1. **Credential boundary:** device secret อยู่ใน scanner client เท่านั้น · เพิ่ม path ใน `allowed_paths` = จุดเดียวที่เปิดสิทธิ์ · test spoof header (มีแบบอย่างใน `test_manager.py`)
2. **Signed image URL:** `sig = HMAC-SHA256(server_secret, "{id}.{exp}")` · เทียบด้วย `timingSafeEqual` · secret เป็น server-only env (ห้าม `PUBLIC_`) · URL ไม่มีข้อมูลบุคคล
3. **Authorization (back-office):** ตรวจทุก write ที่ BFF: SA ผ่านทุกศูนย์ · `shelter_manager` / `banner_staff` ต้องมี scope ครอบ **ทุก** `shelter_codes` ของ banner — ทั้งค่าเดิม (ก่อนแก้) และค่าใหม่ เพื่อกันการ "ย้าย" banner ของศูนย์อื่นมาเป็นของตัวเอง
4. **Input validation:** Zod ที่ client + server · VDU ใน `registry` เป็นด่านสุดท้าย · decode รูปฝั่ง server ก่อน PUT attachment
5. **Output encoding:** text เท่านั้น ห้าม `{@html}` · `alt = title`
6. **Cache:** `no-store` ทุก response ของ `/api/v1/scanner/*` รวม route รูป

---

## 7. Content guideline (สำหรับผู้สร้าง banner)

| หัวข้อ    | แนวทาง                                                                                                                                                              |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ขนาดรูป   | ทำแนวนอน 16:9 (เช่น 1920×1080) สำหรับตู้ 1024×600 · ทำแนวตั้ง 9:16 (1080×1920) ถ้าศูนย์ใช้ตู้แนวตั้ง · ระบบใช้ `object-contain` → อัตราส่วนผิดจะมีขอบดำ ไม่ถูก crop |
| Safe area | เว้นขอบล่าง ~12% สำหรับ caption และแถบประกาศระบบ (`SystemBannerHost`)                                                                                               |
| ตัวอักษร  | ≥48 px ที่ 1920 กว้าง · ข้อความหลักไม่เกิน 2 บรรทัด                                                                                                                 |
| ไฟล์      | png / jpeg / webp · ≤2 MB · ไม่ใส่ข้อมูลส่วนบุคคลของผู้อพยพ                                                                                                         |
| ระยะเวลา  | 8–15 s ต่อรูปที่มีข้อความ · ทั้งรอบไม่ควรเกิน ~2 นาที                                                                                                               |

---

## 8. Implementation checklist

- [ ] schema.md §3.12 + VDU ก่อนเขียนโค้ด (code ห้ามนำ schema)
- [ ] `banner_staff` ใน `roles.ts` (`STAFF_CAPABILITIES`) + role-permission-matrix + เมนู portal
- [ ] domain tests: schema, `isActiveAt` (ขอบ start/end), sort ครบ 3 key
- [ ] server tests: back-office authz (SA / SM / banner_staff / ศูนย์อื่น / role อื่น) · kiosk feed (401, 503, filter, sort, limit, no-store) · signed URL (ok / expired / tampered)
- [ ] overlay test (fake timers): idle 30 s, dismiss กลืน event, rotation ตาม duration, empty, broken image
- [ ] `kiosk-layout.test.ts` ผ่าน (media literal ตรง `kiosk-layout.ts`)
- [ ] `scanner_client/tests/test_manager.py`: path ใหม่ใน allowlist, GET ไม่ได้ header
- [ ] ทุก `.svelte` ผ่าน `svelte-autofixer`
- [ ] e2e: back-office CRUD + upload

---

## 9. อ้างอิง

- CR: [`docs/changes/draft-kiosk-banner.md`](../changes/draft-kiosk-banner.md)
- Kiosk: CR-151 (FR-KPC-06/07/13/14), CR-152 (`kiosk/config`), [`smart-card-registration-spec.md`](smart-card-registration-spec.md)
- Roles: [`docs/prd/role-permission-matrix.md`](../prd/role-permission-matrix.md), `frontend/src/lib/auth/roles.ts`
- ghosa: `/home/jk/ghosa/ghosa/models/banners.py`, `web/views/devices.py`, `web/templates/devices/landing.html`, `app/manager.py`
