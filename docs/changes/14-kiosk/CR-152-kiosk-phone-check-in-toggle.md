---
id: CR-152
title: Kiosk — เปิด/ปิดช่องทางรายงานตัวด้วยเบอร์โทรรายศูนย์ผ่าน shelter `feature_flags` (backoffice)
status: approved
date: 2026-09-25
created: 2026-09-25
updated: 2026-10-04
requested_by: ทีม kiosk (branch feat/pre-register_kiosk)
decided_by: Jakee Indapanya (GitHub net-lynx), Project Owner — อนุมัติ 2026-10-04 (Asia/Bangkok)
decision_date: 2026-10-04
layer: volatile
amends:
  - docs/changes/draft-kiosk-pre-registration-check-in.md (branch docs-kiosk-pre-register) FR-KPC-06, FR-KPC-11, §6.6, §7 สัญญา API
affects:
  - docs/data/schema.md §3.1 shelter `feature_flags` (+ `kiosk_phone_check_in_enabled`; ไม่ bump schema_v ตาม §6) *(commit `9a73d6ba` บน branch `feat/pre-register_kiosk` — รอ merge เข้า develop)*
  - docs/data/api-contract.md (Scanner / Kiosk — เพิ่ม `POST /api/v1/scanner/kiosk/config`) *(commit `9a73d6ba` บน branch `feat/pre-register_kiosk` — รอ merge เข้า develop)*
  - frontend/src/lib/features/shelters/domain/schema.ts (+ schema.test.ts)
  - frontend/src/lib/features/shelters/ui/basic-info-section.svelte
  - frontend/src/routes/api/v1/scanner/kiosk/config/+server.ts (ใหม่ + server.test.ts)
  - frontend/src/routes/api/v1/scanner/kiosk/lookup/+server.ts (ตรวจ flag เมื่อ `source:'phone'` ตาม FR-KPT-14)
  - frontend/src/lib/features/kiosk/{data,domain,ui}
  - frontend/src/routes/kiosk/{+page.ts,+page.svelte,phone/+page.ts}
  - scanner_client/app/manager.py (`_route_kiosk_api` allowlist) · scanner_client/tests/test_manager.py
  - scanner_client/{app/config.py,.env.example,README.md,tests/test_config.py} (ถอด `KIOSK_PHONE_CHECK_IN_ENABLED` จาก commit `d29ffcdb`)
why: >
  การเปิดช่องทางเบอร์โทรขึ้นกับความพร้อมของศูนย์ (index เบอร์ deploy แล้วหรือยัง, ศูนย์ต้องการให้เจ้าหน้าที่ดูแลเคสเบอร์เองหรือไม่)
  ผู้จัดการศูนย์ต้องเปิด/ปิดได้เองจาก backoffice โดยไม่ต้องเข้าไปแก้ไฟล์บนเครื่อง kiosk ทีละเครื่อง
migration: ไม่มี backfill — flag ใหม่ใน `feature_flags` default `false`; doc เดิมที่ไม่มี key อ่านเป็นปิด
---
# CR-152: Kiosk — เปิด/ปิดช่องทางเบอร์โทรรายศูนย์ผ่าน backoffice

> **สถานะ:** approved เป็น spec เมื่อ 2026-10-04 (Asia/Bangkok) โดย Project Owner Jakee Indapanya (GitHub net-lynx) · ยังไม่ implement · ยอมรับ flag รายศูนย์ผ่าน backoffice แล้ว

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** เพิ่ม `feature_flags.kiosk_phone_check_in_enabled` (bool, default `false`) ใน shelter master · ผู้จัดการศูนย์เปิด/ปิดที่ฟอร์มศูนย์ (กลุ่ม Feature Flags) · kiosk อ่านค่าผ่าน `POST /api/v1/scanner/kiosk/config` ทุกครั้งที่เข้า `/kiosk` → ปิด = ซ่อนการ์ด「เบอร์โทรศัพท์」(เหลือ 3 การ์ดแถวเดียว) และ `/kiosk/phone` redirect กลับ `/kiosk`
> - **เพื่อใคร / ทำไม:** ผู้จัดการศูนย์คุมช่องทางเบอร์ได้เองรายศูนย์ มีผลกับทุกเครื่องของศูนย์ในรอบถัดไปที่กลับหน้าแรก ไม่ต้องแก้ `.env` หรือรีสตาร์ท client
> - **Dev ต้องทำอะไร:** field + Switch ในฟอร์มศูนย์ · endpoint config ที่ยืนยันเครื่อง · kiosk load config ก่อน render · เพิ่ม path ใน allowlist ของ scanner client · ถอด `.env` toggle รอบก่อน
> - **กระทบ schema / scope:** เพิ่ม key ใน `feature_flags` แบบ additive (ไม่ bump `schema_v` ตาม precedent CR-048/CR-106) · ช่องทางเบอร์ถูกปิดที่ server ด้วย (FR-KPT-14) · ค่าเริ่มต้นทุกศูนย์ = ปิด

---

## 1. Why

1. ช่องทางเบอร์ (§6.6 ของ CR แม่) ต้องพึ่ง Mango index `evacuee-type-phone-idx` ที่ deploy รายศูนย์ (FR-KPC-62) — ความพร้อมเป็นรายศูนย์ ไม่ใช่รายเครื่อง
2. ผู้ตัดสินใจเปิดช่องทางคือผู้จัดการศูนย์ ไม่ใช่ผู้ติดตั้งเครื่อง — ค่าต้องอยู่ใน backoffice ที่มี RBAC (`requireShelterManagerOrSA`)
3. shelter master มี `feature_flags` สำหรับเปิด/ปิดฟีเจอร์รายศูนย์อยู่แล้ว (`accepts_pre_registration`, `enable_medical_screening`, …) พร้อม Switch ในฟอร์ม — ต่อยอด pattern เดิม
4. ฉบับ `.env` ต่อเครื่อง (Decision log 2026-09-25) แก้ได้เฉพาะคนที่เข้าถึงเครื่อง และเครื่องที่ `.env` ไม่มี key จะเปิดช่องทางเบอร์โดยไม่ตั้งใจ

**ทางเลือก**

| ทางเลือก                                                                                                 | สถานะ                                                                                                                                                                      |
| :--------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.env` ต่อเครื่อง (`KIOSK_PHONE_CHECK_IN_ENABLED`)                                                 | **แทนที่** โดย CR ฉบับนี้                                                                                                                                 |
| (A) bootstrap คืน flag → scanner client แนบ`phone_check_in=off` ใน URL                                | ตัดทิ้ง — แก้โค้ดน้อยสุด แต่ค่าใหม่มีผลเมื่อรีสตาร์ท client เท่านั้น และ flag อยู่ใน URL ที่แก้ได้   |
| (B) kiosk เรียก`POST /api/v1/scanner/kiosk/config` ทุกครั้งที่เข้า `/kiosk` (เลือก) | **เลือก** — มีผลในรอบถัดไปที่กลับหน้าแรก, อ่านค่าไม่ได้ = ปิด (fail closed), ค่ามาจาก server ไม่ผ่าน URL |
| field บน`scanner_device` (รายเครื่อง)                                                              | ตัดทิ้ง — owner ต้องการรายศูนย์                                                                                                                          |

---

## 2. Change (before → after)

| หัวข้อ                              | ก่อน                                               | หลัง                                                                                                                                        |
| :---------------------------------------- | :----------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| shelter`feature_flags`                  | 6 key                                                  | +`kiosk_phone_check_in_enabled` (bool, default `false`)                                                                                     |
| ฟอร์มศูนย์ (Feature Flags)      | 5 Switch                                               | + Switch「รับรายงานตัวด้วยเบอร์โทรที่ Kiosk」                                                                        |
| FR-KPC-06 allowlist ของ scanner client | `/kiosk/lookup`, `/kiosk/check-in`                 | +`/kiosk/config`                                                                                                                              |
| FR-KPC-11 การ์ดหน้า`/kiosk`    | 4 การ์ดเสมอ (grid 2×2)                       | flag เปิด: 4 การ์ด 2×2 · ปิด / อ่านค่าไม่ได้: 3 การ์ด QR · บัตร · ThaiD แถวเดียว 3 คอลัมน์ |
| §6.6`/kiosk/phone`                     | เข้าถึงได้เสมอ                           | flag ปิด / อ่านค่าไม่ได้ → redirect`/kiosk` พร้อม context เดิม                                                      |
| API lookup`source:'phone'`              | รับเสมอ                                         | flag ปิด → 403`KIOSK_METHOD_DISABLED` (FR-KPT-14)                                                                                         |
| `scanner_client/.env`                   | `KIOSK_PHONE_CHECK_IN_ENABLED` (commit `d29ffcdb`) | ถอดออก                                                                                                                                    |

---

## 3. Requirements

### 3.1 Shelter master + backoffice

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KPT-01 | `feature_flags` มี key `kiosk_phone_check_in_enabled: boolean` default `false` ใน `shelterFeatureFlagsSchema` และ `DEFAULT_SHELTER_FEATURE_FLAGS`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| FR-KPT-02 | doc เดิมที่ไม่มี key (หรือไม่มี`feature_flags`) อ่านเป็น `false` · ผู้อ่านฝั่ง server ทุกจุดใช้ `=== true`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| FR-KPT-03 | หน้าตั้งค่าศูนย์ (`/back-office/shelters/[mode]/[[id]]` และ `/system-management/shelters/[mode]/[[id]]` — ใช้ `ShelterFormPage` ตัวเดียวกัน) section「ข้อมูลพื้นฐานและที่ตั้ง」หมวด「คุณสมบัติการปฏิบัติการ (Feature Flags)」มี Switch `id="kiosk-phone-check-in"` label「รับรายงานตัวด้วยเบอร์โทรที่ Kiosk」คำอธิบาย「เปิด: ผู้ประสบภัยค้นหาด้วยเบอร์โทรที่ตู้ Kiosk ได้ · ปิด: ซ่อนช่องทางนี้ (ค่าเริ่มต้นปิด)」 |
| FR-KPT-04 | บันทึกผ่าน`PATCH /api/back-office/shelter/[code]` เดิม — สิทธิ์ตาม `requireShelterManagerOrSA` · ไม่มี endpoint ใหม่ฝั่ง backoffice                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### 3.2 Kiosk config API

| ID        | Requirement                                                                                                                                                                                                                                                                           |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-KPT-10 | `POST /api/v1/scanner/kiosk/config` ยืนยันเครื่องด้วย `authenticateScannerDevice` (FR-KPC-03) · ศูนย์มาจาก principal เท่านั้น (FR-KPC-04) · ไม่อ่าน body                                                                              |
| FR-KPT-11 | 200 → `{ shelter_code, phone_check_in_enabled, ... }` · `phone_check_in_enabled = shelter.feature_flags?.kiosk_phone_check_in_enabled === true` · shelter ไม่พบ → `false` · รองรับการคืน flag เสริมของ Kiosk อื่น ๆ (เช่น `walk_in_registration_enabled` ตาม FR-KWR-01) โดยไม่กระทบสัญญาเดิม (additive fields) |
| FR-KPT-12 | 401`DEVICE_AUTH_FAILED` / 503 `DEPENDENCY_UNAVAILABLE` ตาม pattern `bootstrap` · ทุก response มี `cache-control: no-store` (FR-KPC-07)                                                                                                                               |
| FR-KPT-13 | `scanner_client` `_route_kiosk_api` เพิ่ม `/api/v1/scanner/kiosk/config` ใน allowlist (POST same-origin เท่านั้น เหมือน path เดิม)                                                                                                                     |
| FR-KPT-14 | lookup`source:'phone'` ตรวจ flag ของศูนย์หลังยืนยันเครื่อง ก่อน rate limiter · ปิด → 403 `KIOSK_METHOD_DISABLED`「ช่องทางนี้ปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่」· QR / บัตร ไม่ตรวจ flag |

### 3.3 Kiosk UI

| ID        | Requirement                                                                                                                                                                                                 |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KPT-20 | `/kiosk` โหลด config ใน `+page.ts` ก่อน render ทุกครั้งที่เข้า route (cache ใน memory ได้สั้น ๆ ไม่เกิน 30 วินาทีตาม `KIOSK_CONFIG_CACHE_TTL_MS` เพื่อลด round-trip latency เมื่อผู้ใช้กลับหน้าแรก; กรณี error/timeout ไม่ cache เพื่อให้ตรวจ network ใหม่ทันที) · timeout 3 วินาที |
| FR-KPT-21 | config error / timeout / 401 / 503 →`phone_check_in_enabled = false` (fail closed ตามค่าเริ่มต้นปิด) · ไม่แสดง error ให้ผู้ประสบภัย                               |
| FR-KPT-22 | ปิด → ไม่ render การ์ด`phone` · การ์ดที่เหลือเรียงแถวเดียว 3 คอลัมน์ · เปิด → 4 การ์ด grid 2×2 เดิม                                         |
| FR-KPT-23 | `/kiosk/phone` โหลด config ใน `+page.ts` · ปิด → redirect 307 ไป `/kiosk` พร้อม context query เดิม ก่อน render numpad                                                       |
| FR-KPT-24 | หน้าเบอร์ได้ 403`KIOSK_METHOD_DISABLED` ระหว่างค้นหา → แสดงข้อความตาม FR-KPT-14 แล้วกลับ `/kiosk` (กรณี flag ถูกปิดระหว่างใช้งาน) |
| FR-KPT-25 | ค่า flag ไม่อยู่ใน URL / storage · query param`phone_check_in` ของฉบับ `.env` ถูกถอด                                                                                          |
| FR-KPT-26 | layout 3 คอลัมน์ไม่ scroll และอ่านได้ที่ 1024×600 และ 540×960 (FR-KPC-13)                                                                                                       |

---

## 4. Acceptance criteria

| ID        | เงื่อนไข                                                                                                                                                                                | FR             |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------- |
| AC-KPT-01 | ศูนย์ใหม่ / ศูนย์เดิมที่ไม่เคยตั้งค่า → kiosk ของศูนย์แสดง 3 การ์ด (ไม่มีเบอร์)                                                   | 01, 02, 22     |
| AC-KPT-02 | ผู้จัดการศูนย์เปิด Switch → บันทึก → kiosk กลับหน้าแรก (idle / จบ check-in / กดกลับ) → 4 การ์ด โดยไม่รีสตาร์ท client (มีผลทันทีเมื่อ cache ใน memory 30s หมดอายุ) | 03, 04, 20, 22 |
| AC-KPT-03 | ปิด Switch → kiosk กลับหน้าแรก → 3 การ์ด ·`/kiosk/phone` ถูก redirect                                                                                                | 22, 23         |
| AC-KPT-04 | ผู้ใช้ที่ไม่ใช่ manager ของศูนย์ / SA → PATCH flag ไม่ได้ (403 เดิม)                                                                                          | 04             |
| AC-KPT-05 | `POST /api/v1/scanner/kiosk/config` ไม่มี header / secret ผิด → 401 · เครื่องศูนย์ A อ่าน flag ของศูนย์ A เท่านั้น                                                 | 10, 11, 12     |
| AC-KPT-06 | ตัด network ไป server ระหว่างโหลดหน้าแรก → 3 การ์ด ภายใน ~3 วินาที ไม่ค้าง                                                                       | 20, 21         |
| AC-KPT-07 | เปิด`/kiosk` ในเบราว์เซอร์ทั่วไป (ไม่ผ่าน scanner client) → 3 การ์ด (config 401 → ปิด)                                                                | 21             |
| AC-KPT-08 | flag ปิด → `POST /api/v1/scanner/kiosk/lookup {source:'phone'}` ได้ 403 `KIOSK_METHOD_DISABLED` · `source:'qr'` / `'smart-card'` ทำงานปกติ                                             | 14             |
| AC-KPT-09 | Unit test: schema default · config endpoint (200 เปิด/ปิด/ไม่มี key, 401, 503, no-store) · allowlist Python · load`/kiosk` + `/kiosk/phone` fail closed · filter การ์ด | ทั้งหมด |

**DoD:** `pnpm lint` · `pnpm check` (0 error) · `pnpm test` · `svelte-autofixer` ทุก `.svelte` ที่แตะ · `python -m unittest` ใน `scanner_client` · manual AC-KPT-01..08 บนจอ kiosk จริง

---

## 5. Impact

- **Schema:** `docs/data/schema.md` §3.1 แถว `feature_flags` — เพิ่ม `kiosk_phone_check_in_enabled:bool` และหมายเหตุ default `false` (เนื้อหาพร้อมแล้วใน commit `9a73d6ba` บน branch `feat/pre-register_kiosk` รอ merge เข้า `develop`; shelter `schema_v` คง 6)
- **API contract:** เพิ่ม `POST /api/v1/scanner/kiosk/config` และ error `KIOSK_METHOD_DISABLED` ในหัวข้อ Scanner / Kiosk (`docs/data/api-contract.md` §2.1 ใน commit `9a73d6ba` บน branch `feat/pre-register_kiosk` และ CR แม่ §7)
- **Public plane:** worker `project_shelter` เก็บ doc ทั้งก้อนใน `raw_data` ของ `public_shelters` → flag ไปอยู่ใน Mongo ด้วย แต่ FastAPI อ่านเฉพาะ key ที่กำหนด (`accepts_pre_registration`) จึงไม่ถูกส่งออก public/external API · ไม่ต้องแก้ worker
- **Security:** endpoint config คืนแค่ boolean + `shelter_code` ไม่มี PII · ช่องทางเบอร์ถูกปิดจริงที่ server (FR-KPT-14) ไม่ใช่แค่ซ่อน UI
- **Code ฉบับ `.env` (commit `d29ffcdb`):** ได้รับการ rework เป็นระบบ shelter `feature_flags` และ config endpoint เรียบร้อยแล้ว (commit `31c87846` บน branch `feat/pre-register_kiosk`)

## 6. Migration

- ไม่ bump `schema_v` (additive key ใน object ที่มี default — precedent: `public_donations_enabled` CR-048, `enable_medical_screening` CR-106, `accepts_pre_registration`) · `docs/data/schema.md` §3.1 อัปเดตใน branch `feat/pre-register_kiosk` (commit `9a73d6ba`)
- ไม่มี backfill: Zod default + reader `=== true` ทำให้ doc เดิมอ่านเป็นปิด
- Rollout: หลัง deploy ทุกศูนย์ปิดช่องทางเบอร์ · ผู้จัดการศูนย์ที่พร้อม (index deploy แล้ว) เปิดเองในฟอร์มศูนย์
- เครื่อง kiosk ต้องอัปเดต `scanner_client` (allowlist ใหม่) — เครื่องที่ยังไม่อัปเดตได้ config 401 → ปิดช่องทางเบอร์ (fail closed ปิดตามค่าเริ่มต้น)

## 7. Open decisions

ไม่มี open decision

## 8. Decision log

- 2026-09-25 — proposed (เดิมเสนอแบบ `.env` ต่อเครื่อง)
- 2026-09-25 — เจ้าของโครงการตัดสินใจเปลี่ยนแนวทางเป็นการควบคุมรายศูนย์ผ่าน backoffice (shelter `feature_flags`) แทนการตั้งค่าต่อเครื่อง — ไม่มี open decision ค้าง, ข้อกำหนดการทำงานทั้งหมดระบุเป็น spec ไว้ข้างบนแล้ว (§1–§6)
- 2026-10-04 — ปรับปรุงตาม PR Review (#311): ตัดลิงก์ phantom plan ที่ไม่มีอยู่จริง, ระบุสถานะการ rework ของโค้ด (commit `31c87846` บน `feat/pre-register_kiosk`), ระบุ branch dependency ของ `docs/data/{schema,api-contract}.md` (commit `9a73d6ba`), ขยายความ FR-KPT-20 และ AC-KPT-02 เรื่อง in-memory cache TTL 30s ให้ตรงกับโค้ดจริง, ระบุ additive extensibility ของ endpoint ใน FR-KPT-11 และปรับ path ใน AC-KPT-05/08 ให้เป็น full API path
- 2026-10-04 (Asia/Bangkok) — **Project Owner Jakee Indapanya (GitHub net-lynx) ให้สัตยาบันและอนุมัติ spec นี้ (`status: approved`)** · ยังไม่ implement
  - ยอมรับการควบคุมรายศูนย์ผ่าน backoffice: `feature_flags.kiosk_phone_check_in_enabled` (bool, default `false`)
  - kiosk อ่านค่าผ่าน `POST /api/v1/scanner/kiosk/config` · อ่านค่าไม่ได้ = ปิด (fail closed)
  - §7 ไม่มี open decision
  - รันเลข CR-152 จาก `docs/changes/_index.md` บน `develop` (เลขที่จัดสรรล่าสุดคือ CR-151; ไม่ใช้ช่องว่าง 131–133 และ 144–147) · ถอด `docs/changes/draft-kiosk-phone-check-in-toggle.md`
