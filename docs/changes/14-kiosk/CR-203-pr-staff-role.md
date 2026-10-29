---
id: CR-203
title: Kiosk — role pr_staff (เจ้าหน้าที่ประชาสัมพันธ์) จัดการข่าวสารบนตู้ Kiosk ของศูนย์
status: approved
date: 2026-10-27
updated: 2026-10-28 # amend: สี department pr = domain family ใหม่ `pr` (ทอง) · FR-PRS-11 ใช้ DEVICE_VIEWER_CAPABILITIES · FR-PRS-22 SM/KIO เปลี่ยน PIN จากหน้ากลุ่มได้
requested_by: ทีม kiosk (issue #930)
decided_by: Soravit Sukkarn (Team Lead)
layer: volatile
affects:
  - docs/prd/role-permission-matrix.md §1.1 (บทบาทที่ 12 + คอลัมน์ PR แถว Kiosk Device / Banner / Banner Group)
  - docs/data/schema.md §6 `_users.roles`
  - docs/data/api-contract.md §2.2 (สิทธิ์ `/api/v1/kiosk/devices/**`) · §2.3 / §2.3.1 (guard back-office banner + กลุ่ม)
  - no schema_v bump (เพิ่ม role string เท่านั้น)
  - frontend/src/lib/auth/roles.ts (`PR_STAFF`, `BANNER_MANAGER_CAPABILITIES`, `DEVICE_VIEWER_CAPABILITIES`, `canManageBanners`, `kioskConfinement`)
  - frontend/src/lib/guards/auth.ts (`requireBannerManagement`, `confineKioskStaffOnly`)
  - frontend/src/lib/server/kiosk-banners/kiosk-banner-access.ts · frontend/src/lib/server/scanners/scanner-access.ts (`requireDeviceViewer`)
  - frontend/src/routes/api/v1/kiosk/devices/+server.ts (GET) · .../[id]/staff-pin/reveal/+server.ts
  - frontend/src/routes/(protected)/back-office/kiosks/banners/** (+page.ts guard · หน้ากลุ่ม: ปุ่มดู PIN)
  - frontend/src/lib/features/portal/domain/{portal-menu,portal-preview}.ts · lib/components/backoffice-navbar/static.ts
  - frontend/src/lib/features/users/ui/user-form.svelte
  - frontend/src/lib/tokens/colors.ts · frontend/src/app.css (domain family ใหม่ `pr`)
  - tests: roles / guards / navbar / portal unit · banner + group + devices + reveal + staff-pin server tests (session `prA`) · e2e/kiosk-pr-staff.test.ts
---

# CR-203 — role `pr_staff` สำหรับข่าวสารบนตู้ Kiosk

> **สรุป (TL;DR):**
>
> - **เพิ่ม role ประจำศูนย์** `pr_staff` (compound `{code}:pr_staff`, label **เจ้าหน้าที่ประชาสัมพันธ์**) — SM ของศูนย์และ SA ให้ / ถอนได้
> - **สิทธิ์:** banner + กลุ่ม banner ของศูนย์ตัวเอง, ผูกกลุ่มกับเครื่อง, ดูรายชื่อเครื่อง, ดู staff PIN (reveal + log) — **สร้าง / แก้ / ลบเครื่อง และตั้ง / สุ่ม PIN ไม่ได้** (`403`)
> - **ทางเข้า:** portal แท็บ **ฝ่ายประชาสัมพันธ์** → ปุ่ม **ข่าวสารบน Kiosk** · back-office ถูกจำกัดไว้ที่ `/back-office/kiosks/banners/**`
> - **ไม่ bump `schema_v`** · ไม่แตะประกาศส่วนกลาง (`announcement`)

---

## Why

- ศูนย์มอบงานประชาสัมพันธ์บนตู้ Kiosk ให้ใครโดยไม่ให้สิทธิ์ตั้งค่าเครื่องไม่ได้ — banner ใช้ capability ชุดเดียวกับการจัดการเครื่อง
  (`SCANNER_MANAGER_CAPABILITIES = [shelter_manager, kiosk_staff]`)
- CR-165 ยุบ `banner_staff` (CR-162) เข้า `kiosk_staff`; CR นี้แยก role ฝั่งข่าวสารออกมาใหม่ โดย **ไม่** คืนสิทธิ์ตั้งค่าเครื่อง
- ความเสี่ยงที่ยอมรับ (ระบุใน issue #930): staff PIN ใช้ข้าม face check และพิมพ์ซ้ำบนตู้ได้ — `pr_staff` ดู PIN ได้แต่ทุกครั้งมี log `by=` และแก้ PIN ไม่ได้

## Change

### Role

| Code   | Key        | Label                    | ขอบเขต                                                                                               |
| ------ | ---------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| **PR** | `pr_staff` | เจ้าหน้าที่ประชาสัมพันธ์ | banner + กลุ่ม banner ของศูนย์ตัวเอง · ดูรายชื่อเครื่อง + reveal staff PIN — ไม่มีสิทธิ์อื่นของศูนย์ |

- **FR-PRS-01** — `pr_staff` อยู่ใน `STAFF_CAPABILITIES`; เก็บใน `_users.roles` เป็น `{code}:pr_staff` คู่ `shelter:{code}`
- **FR-PRS-02** — label `เจ้าหน้าที่ประชาสัมพันธ์` ทั้งในรายการ role และฟอร์มผู้ใช้ (มีคำอธิบายขอบเขต)
- **FR-PRS-03** — `BANNER_MANAGER_CAPABILITIES = [shelter_manager, kiosk_staff, pr_staff]`; `SCANNER_MANAGER_CAPABILITIES` คงเดิม

### สิทธิ์ API

| Endpoint                                                                                                 | SA  |  SM   |  KIO  |  PR   |
| -------------------------------------------------------------------------------------------------------- | :-: | :---: | :---: | :---: |
| `/api/back-office/kiosk-banners/**` · `/api/back-office/kiosk-banner-groups/**` (รวม `PUT {id}/devices`) |  ✓  | scope | scope | scope |
| `GET /api/v1/kiosk/devices`                                                                              |  ✓  | scope | scope | scope |
| `POST /api/v1/kiosk/devices/[id]/staff-pin/reveal` (log `by=`)                                           |  ✓  | scope | scope | scope |
| `POST /api/v1/kiosk/devices` · `PATCH` / `DELETE devices/[id]` · `POST .../staff-pin`                    |  ✓  | scope | scope | `403` |

- **FR-PRS-10** — route banner + กลุ่ม resolve ผู้เรียกด้วย `BANNER_MANAGER_CAPABILITIES`
- **FR-PRS-11** — `GET devices` + `staff-pin/reveal` resolve ด้วย `DEVICE_VIEWER_CAPABILITIES = [shelter_manager, kiosk_staff, pr_staff]` (แยกจาก `BANNER_MANAGER_CAPABILITIES` แม้สมาชิกเท่ากัน — role ที่จัดการ banner ได้อย่างเดียวในอนาคตจะไม่ได้สิทธิ์ดู PIN ตามไปด้วย); reveal log `by=<user>` ทุกครั้ง ไม่ log ค่า PIN
- **FR-PRS-12** — endpoint เขียนเครื่อง / ตั้ง PIN คง `SCANNER_MANAGER_CAPABILITIES` → `pr_staff` ได้ `403 FORBIDDEN`
- **FR-PRS-13** — ศูนย์นอก scope: list / create `403` · `{id}` `404` (FR-KBR-11/12, FR-SBO-04/05 เดิม)

### หน้าและการเข้าถึง

- **FR-PRS-20** — ทุก `+page.ts` ใต้ `/back-office/kiosks/banners/**` ใช้ guard `requireBannerManagement` (SA / SM / KIO / PR ของศูนย์ที่เลือก) · `/back-office/kiosks` คง `requireKioskManagement`
- **FR-PRS-21** (ขยาย FR-SBO-29) — user ที่มีแค่ `kiosk_staff` และ/หรือ `pr_staff` ในศูนย์ที่เลือก:
  - มี `kiosk_staff` → เข้า back-office ได้เฉพาะ `/back-office/kiosks/**`
  - `pr_staff` อย่างเดียว → เข้าได้เฉพาะ `/back-office/kiosks/banners/**`
  - path อื่นใน back-office → redirect ไป portal
- **FR-PRS-22** — หน้ากลุ่ม banner แสดงปุ่ม "ดู PIN" ที่เครื่องในกลุ่มแต่ละเครื่อง; สำหรับ `pr_staff` dialog ไม่มีปุ่มตั้ง / สุ่ม PIN (แสดงข้อความให้ติดต่อ SM / `kiosk_staff`) · SA / SM / `kiosk_staff` เห็นปุ่ม "เปลี่ยน PIN" ที่เปิด dialog ตั้ง PIN ในหน้าเดิม
- **FR-PRS-23** — navbar back-office: เมนู "จัดการแบนเนอร์" เห็นได้ด้วย `BANNER_MANAGER_CAPABILITIES`; `pr_staff` อย่างเดียวเห็นเมนูนี้เมนูเดียว

### Portal

- **FR-PRS-30** — department `pr` "ฝ่ายประชาสัมพันธ์" มี item เดียว "ข่าวสารบน Kiosk" → `/back-office/kiosks/banners` (`roles: ['pr_staff']`, scope `shelter` — SA / SM เห็นด้วยตามกฎเดิม)
- **FR-PRS-31** — portal preview ของ SA มีตัวเลือก `pr_staff` ("ประชาสัมพันธ์")

- **FR-PRS-32** — department `pr` ใช้ domain family ใหม่ `pr` "ประชาสัมพันธ์" (ทอง) ใน `tokens/colors.ts` + `--domain-pr-*` ใน `app.css`:

  | step     | hex       |
  | -------- | --------- |
  | `base`   | `#CA8A04` |
  | `strong` | `#A16207` |
  | `subtle` | `#FEFCE8` |
  | `border` | `#FEF08A` |
  | `text`   | `#713F12` |

  ผ่าน WCAG AA ตาม test เดิมของ domain token และไม่ใช้ค่าสี status ที่จองไว้ (`#F59E0B` warning amber) · ใช้คู่กับ icon `megaphone` + label เสมอ เพราะโทนใกล้ warning

## Acceptance

- [ ] SM ให้ `pr_staff` จากหน้าผู้ใช้งานได้ · label แสดง "เจ้าหน้าที่ประชาสัมพันธ์"
- [ ] login `pr_staff` → portal เห็นแท็บ "ฝ่ายประชาสัมพันธ์" แท็บเดียว ปุ่ม "ข่าวสารบน Kiosk" ปุ่มเดียว
- [ ] `pr_staff` สร้าง / แก้ / จัดลำดับ / ลบ banner และกลุ่มของศูนย์ตัวเองได้ · ผูกกลุ่มกับเครื่องแล้ว feed `/api/v1/kiosk/banners` ของเครื่องนั้นคืน banner ใหม่
- [ ] `pr_staff` ดู PIN ในหน้ากลุ่ม banner ได้ และมี log `by=` · ไม่มีทางตั้งหรือสุ่ม PIN
- [ ] `pr_staff` เรียก POST / PATCH / DELETE device หรือ `POST staff-pin` → `403`
- [ ] `pr_staff` เปิด `/back-office/kiosks` หรือหน้า back-office อื่นตรง ๆ → redirect ไป portal
- [ ] `pr_staff` ของ SH001 แตะ banner / กลุ่ม / เครื่องของ SH002 ไม่ได้ (`403` / `404`)
- [ ] user ที่มี `kiosk_staff` + `pr_staff` เข้าหน้าเครื่องได้ แต่เข้าหน้า back-office อื่นไม่ได้
- [ ] SM และ `kiosk_staff` ใช้งานได้เหมือนเดิมทุก route (regression)

## Impact

- **Docs:** role-permission-matrix §1.1 · schema.md §6 · api-contract.md §2.2 / §2.3 / §2.3.1 (เตรียมพร้อม merge บน `feat/pr-staff-role`)
- **Code + tests:** ดู `affects:` — implement แล้วบน branch `feat/pr-staff-role`
- **Out of scope:** ประกาศส่วนกลาง (`announcement`) และ system banner · สิทธิ์ SM / `kiosk_staff` เดิม · หน้าใหม่สำหรับดูเครื่อง

## Migration

N/A — เพิ่ม role string เท่านั้น ไม่เปลี่ยน shape ของ doc ที่ persist · ไม่ bump `schema_v`

## Decision log

- 2026-10-28 — amend (ทีม kiosk เสนอ, review PR #985 — รอ owner ยืนยัน): ปิด `[NEEDS DECISION: สีของ department pr]` → เพิ่ม domain family `pr` สีทอง (FR-PRS-32) แทนการใช้ `volunteer` ร่วมกับฝ่ายอาสา · FR-PRS-11 อ้าง `DEVICE_VIEWER_CAPABILITIES` ให้ตรงโค้ด · FR-PRS-22 ให้ SM / `kiosk_staff` เปลี่ยน PIN จากหน้ากลุ่มได้ (เดิมเห็นข้อความให้ติดต่อตัวเอง)
- 2026-10-27 — approved โดย Soravit Sukkarn (Team Lead) · รันเลข CR-203
- 2026-10-27 — proposed (ทีม kiosk, issue #930) · implement ล่วงหน้าบน `feat/pr-staff-role`
