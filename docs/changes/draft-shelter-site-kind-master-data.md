---
id: draft
title: ประเภทศูนย์ (site_kind) มาจาก master data global-only
status: proposed
date: 2026-10-26
requested_by: feedback roleplay 23/10/69 — issue #836
decided_by: <รอเจ้าของโครงการ>
layer: volatile
affects:
  - docs/data/schema.md §3.1 (`site_kind` enum → master code; migration note)
  - docs/data/schema.md §3.3 (`master_type` enum 6 → 7 + seed `site_kind`; global-only)
  - docs/data/schema.md §9.1 (`public_shelters.site_kind` enum → str)
  - docs/data/data-model.md (`site_kind` ในตัวอย่าง shelter)
  - docs/features/site-occupancy-booking-program.md (D-SITE-MODEL — ชี้มา CR นี้)
  - docs/master-data/README.md (รายการ master types + seed)
  - no schema_v bump (shelter v7 และ master_data v4 รูปเดิม — ดู Migration)
  - frontend/src/lib/features/master-data/domain (MASTER_DATA_TYPES, labels/meta, GLOBAL_ONLY_MASTER_TYPES)
  - frontend/scripts/seed/master-defs.ts (seed site_kind)
  - frontend/src/lib/features/shelters (domain/schema.ts siteKindSchema + SITE_KIND_LABELS, ui/basic-info-section, ui/shelter-list, ui/shelter-form-validation, data/shelters.remote.ts)
  - frontend/src/lib/features/shelter-import (columns, import-row, sample-row)
  - frontend/src/lib/features/system-overview + frontend/src/lib/server/system-overview
  - frontend/src/routes/(protected)/system-management/shelters (ตัวกรองชนิด)
  - frontend/src/routes/api/back-office/shelter/** (POST / PATCH — ตรวจ code active ตอนเขียน)
  - frontend/src/routes/api/public/v1/config/site-kinds (ใหม่)
  - frontend/src/lib/features/public-portal (types, mappers, public-shelter-card, shelter-filter-panel, shelter-map) + frontend/src/routes/(public)/shelters/+page.ts
  - backend/apiapp/modules/shelter (SiteKind Literal → str) + frontend openapi (fastapi.json, openapi.d.ts)
  - worker/src/worker/projectors/shelter.py (เลิก coerce ค่านอก 2 ค่า) + PROJECTION_VERSION
  - tests: shelters/domain/schema.test.ts, master-data.test.ts, shelter-import tests, public-portal mappers.test.ts, backend/tests/test_shelter.py, worker/tests/projectors/test_projectors.py, e2e master-data / shelters / shelter-import / public-shelters-filter / system-admin-shelter
---

# ประเภทศูนย์ (`site_kind`) มาจาก master data global-only

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** `shelter.site_kind` เลิกเป็น enum 2 ค่าในโค้ด → เก็บ `code` จาก master ใหม่
>   `master_type = site_kind` ("ประเภทศูนย์") แบบ **global-only** ที่ SA เพิ่ม/แก้/ปิดใช้ได้
> - **ชื่อ field และ code เดิมคงเดิม:** seed `evacuation_center` (default) + `host_house` → ไม่ migrate ข้อมูล, ไม่ bump `schema_v`
> - **dev ต้อง build:** master type + seed, dropdown/label จาก master ใน back-office/import/system-overview,
>   public ดึง label ผ่าน BFF ใหม่, backend/worker รับ code ใด ๆ
> - **Blocked by #835** (เปลี่ยนชื่อ `shelter_type` เป็น "ประเภทอาคาร" ก่อน ไม่ให้ชื่อซ้ำ)

---

## Why

- `site_kind` fix ไว้ 2 ค่า (CR-067) — หน้างาน (roleplay 23/10/69) ต้องการเพิ่มประเภทศูนย์ได้เองโดยไม่แก้โค้ด
- ค่า 2 ตัวกระจายเป็น hardcode ราว 15 จุด (label, dropdown, ตัวกรอง, ไอคอนแผนที่, ตัวนับหน้า public,
  การ coerce ใน worker) — master เดียวรวม label และรายการไว้ที่เดียว
- global-only ตามแบบ CR-186: ประเภทศูนย์ต้องเหมือนกันทั้งระบบเพื่อกรองและนับจากส่วนกลางได้

## Change

### Requirements

**Master data**

- **FR-1** — `master_type` enum เพิ่ม `site_kind` (6 → 7 types); label `ประเภทศูนย์ (Site Kind)`;
  hub `shortTitle` / `title` = `ประเภทศูนย์`
- **FR-2** — `site_kind` อยู่ใน `GLOBAL_ONLY_MASTER_TYPES`: SA CRUD ที่ `/system-management/master-data`;
  back-office แสดง read-only; writer ปฏิเสธ `master_data:site_kind:{shelter_code}`
- **FR-3** — seed global `master_data:site_kind` (idempotent merge แบบ type อื่น):

  | code                | label_th      | label_en          | is_default |
  | ------------------- | ------------- | ----------------- | ---------- |
  | `evacuation_center` | ศูนย์อพยพ     | Evacuation Center | true       |
  | `host_house`        | บ้านพี่เลี้ยง | Host House        | false      |

- **FR-4** — item ของ `site_kind` ปิดใช้ได้ (`status: inactive`) แต่ไม่ถูกลบออกจาก array
  (กติกา soft-delete เดิม §3.3) — code ที่ศูนย์อ้างอยู่จึง resolve label ได้เสมอ

**ข้อมูลศูนย์ (§3.1)**

- **FR-5** — `site_kind`: `str` (master code, รูปแบบ `^[a-z0-9_]+$`), req. Zod `siteKindSchema` ตรวจรูปแบบเท่านั้น
- **FR-6** — doc ที่ไม่มี `site_kind` อ่านเป็น `evacuation_center` (กติกาเดิม CR-067)
- **FR-7** — ตอนสร้าง/แก้ศูนย์ (ฟอร์ม, BFF `POST api/back-office/shelter` / `PATCH api/back-office/shelter/[code]`, import)
  `site_kind` ต้องเป็น code ที่ `active` ใน `master_data:site_kind`; ไม่ใช่ → reject พร้อมข้อความระบุ field
- **FR-8** — ศูนย์ที่บันทึกไว้แล้วด้วย code ที่ถูกปิดใช้ภายหลัง: แก้ field อื่นแล้วบันทึกได้ (ไม่บังคับเปลี่ยน
  `site_kind`) — FR-7 ตรวจเฉพาะเมื่อค่า `site_kind` เปลี่ยน

**Back-office**

- **FR-9** — ฟอร์มจัดการศูนย์: dropdown `site_kind` จาก item `active` ของ master; ค่า default = item `is_default`
- **FR-10** — รายการศูนย์, หน้า system-management shelters (ตัวกรองชนิด), system-overview (ตัวกรอง + ตาราง):
  label จาก master (`formatMasterLabelByCode`, ไม่กรอง status); ตัวกรองแสดง "ทั้งหมด" + ทุก item `active`
- **FR-11** — การสร้างศูนย์จากตัวกรองชนิด (D-HOST-NAV) ใช้ code ที่กรองอยู่เป็นค่าเริ่มต้น; "ทั้งหมด" → item `is_default`
- **FR-12** — import ศูนย์: คอลัมน์ `ชนิดสถานที่` เป็นคอลัมน์ master (แบบ `shelter_type`) — รับ code หรือ
  `label_th`/`label_en` ของ item `active`; ว่าง → item `is_default`; template dropdown จากรายการ ณ ตอนดาวน์โหลด

**Public plane**

- **FR-13** — backend `SiteKind` Literal → `str` (schema + query param `site_kind`); ค่าที่ไม่มีศูนย์ใช้ → ผลว่าง
- **FR-14** — worker projector ส่ง `site_kind` ตามที่เก็บ (เลิก coerce ค่านอก 2 ค่าเป็น `evacuation_center`);
  ไม่มี field → `evacuation_center`. bump `PROJECTION_VERSION`. ไม่ project label (master ไม่ถูก project ลง Mongo)
- **FR-15** — BFF ใหม่ `GET /api/public/v1/config/site-kinds` → `{ types: [{code, label_th, label_en, status}] }`
  จาก global master (แบบ `config/shelter-types`); คืน item ทุก status; ล้มเหลว → list ว่าง (ไม่ทำให้หน้าพัง)
- **FR-16** — การ์ดศูนย์, popup แผนที่, ตัวกรองหน้า public แสดง label ตามภาษา (`label_th` / `label_en`);
  ตัวกรองแสดงเฉพาะ item `active`; code ที่หา label ไม่เจอ → แสดง code
- **FR-17** — ไอคอนหมุด: `host_house` → ไอคอนบ้านพี่เลี้ยงเดิม; code อื่นทั้งหมด (รวม `evacuation_center`) → ไอคอนศูนย์เดิม
- **FR-18** — ตัวนับในหน้า `/shelters` (`evac_centers` / `host_houses`) — ดู NEEDS DECISION D-3

### Out of scope

- พฤติกรรมเฉพาะชนิดสำหรับ code ใหม่ (ฟิลด์บังคับ, สูตร capacity D-SPHERE-CAP, ไอคอนเฉพาะ) — ผูกกับ
  `host_house` / `evacuation_center` ตามเดิม; code ใหม่ใช้พฤติกรรมของศูนย์ทั่วไป
- เปลี่ยนชื่อ field `site_kind` หรือ code เดิม
- shelter-local `site_kind`
- partner API (`/external/*`) — ไม่มี `site_kind` ใน `api-contract.md`

### Before → after

|                                    | ก่อน                                   | หลัง                                               |
| ---------------------------------- | -------------------------------------- | -------------------------------------------------- |
| `master_type` (§3.3)               | 6 types                                | 7 types (+ `site_kind`, global-only)               |
| `shelter.site_kind` (§3.1)         | enum(`evacuation_center`,`host_house`) | `str` master code; ค่าที่บันทึกต้อง `active`       |
| `public_shelters.site_kind` (§9.1) | enum 2 ค่า                             | `str` (ส่งตามที่เก็บ)                              |
| label ประเภทศูนย์                  | hardcode ~15 จุด                       | จาก master (staff: master-data, public: BFF FR-15) |
| เพิ่มประเภทใหม่                    | แก้โค้ด + deploy                       | SA เพิ่ม item ที่ System Management                |

### Acceptance

- [ ] `pnpm seed:master` สร้าง `master_data:site_kind` 2 รายการ; รันซ้ำไม่ซ้ำ item
- [ ] SA เพิ่ม item `field_hospital` ได้ที่ System Management; back-office เห็น read-only, สร้างระดับศูนย์ไม่ได้
- [ ] ฟอร์มศูนย์แสดง `field_hospital` ใน dropdown → บันทึก → doc เก็บ `site_kind: "field_hospital"`
- [ ] ปิดใช้ `field_hospital` → หายจาก dropdown/ตัวกรอง แต่ศูนย์เดิมยังแสดง label และแก้ field อื่นแล้วบันทึกได้
- [ ] ส่ง `site_kind` ที่ไม่มีใน master หรือ `inactive` ผ่าน BFF → reject
- [ ] doc เดิมที่ไม่มี `site_kind` แสดงเป็น "ศูนย์อพยพ" ทั้ง back-office และ public
- [ ] import ไฟล์ที่ `ชนิดสถานที่` = `บ้านพี่เลี้ยง` / `host_house` / ว่าง → `host_house` / `host_house` / `evacuation_center`
- [ ] import ไฟล์ที่ `ชนิดสถานที่` = ค่าที่ไม่มีใน master → แถว error
- [ ] หน้า public: ศูนย์ `field_hospital` แสดง label ไทย/อังกฤษตามภาษา, ไอคอนศูนย์, กรองได้
- [ ] `/public/v1/shelters?site_kind=field_hospital` คืนเฉพาะศูนย์ชนิดนั้น

## Impact

- **Docs:** schema.md §3.1 / §3.3 / §9.1, data-model.md, `docs/master-data/README.md`,
  `site-occupancy-booking-program.md` D-SITE-MODEL (เพิ่มหมายเหตุชี้ CR นี้)
- **Code:** ดู `affects:` — master-data domain + seed, shelters domain/UI/BFF, shelter-import,
  system-overview (client + server), public-portal (types/mappers/card/filter/map) + BFF ใหม่, backend shelter
  module + openapi, worker projector
- **Tests:** schema (code เดิม / code ใหม่ / format ผิด / doc ไม่มี field), active-code check ที่ BFF,
  import (label / code / ว่าง / ไม่รู้จัก), mappers, backend filter, projector pass-through, e2e
- **ไม่กระทบ:** `shelter_type` (#835), partner API, ข้อมูลที่ persist แล้ว

## Migration

N/A — ไม่ bump `schema_v` (เสนอ — ดู D-1). field ชื่อเดิม ชนิดใน storage เดิม (string) และ code เดิม 2 ค่าเป็น
item ใน seed → doc เดิมทุกตัวยัง valid. Deploy ต้องรัน `pnpm seed:master` ก่อนเปิดใช้ฟอร์ม
(ไม่มี doc `master_data:site_kind` → dropdown ว่างและบันทึกไม่ได้ตาม FR-7). worker ต้อง re-project
หลัง bump `PROJECTION_VERSION` (ค่าใน Mongo เดิมไม่เปลี่ยนเพราะมีแค่ 2 code เดิม).

## Open decisions

> [NEEDS DECISION D-1: bump `schema_v` ของ shelter หรือไม่] — เสนอ **ไม่ bump**: รูป doc ไม่เปลี่ยน
> (string เดิม, code เดิม). เลี่ยงชนลำดับกับ PR #756 (#647) และ #812 ที่จะใช้ 7 → 8 → 9.

> [NEEDS DECISION D-2: ที่มาของ label หน้า public] — เสนอ **BFF `config/site-kinds` (FR-15)** ตาม precedent
> `config/shelter-types`: แก้ label ที่ System Management แล้วหน้า public เห็นภายใน cache 5 นาที โดยไม่ต้อง
> re-project. ทางเลือก: worker project `site_kind_label_th/en` ลง `public_shelters` — ต้อง re-project ทุกครั้งที่แก้ label.

> [NEEDS DECISION D-3: ตัวนับหน้า `/shelters`] — เสนอ **นับแยกทุก code** (`counts_by_site_kind: {code: n}`)
> แล้วแสดงตาม label. ทางเลือก: คง `evac_centers` / `host_houses` 2 ตัว และ code ใหม่ไม่ถูกนับ.

## Decision log

- 2026-10-26 — proposed (#836). เคาะแล้วใน issue: แทน `site_kind` (ไม่เพิ่ม field), global-only แบบ CR-186,
  เลือกได้ค่าเดียว (req), แสดง label ในหน้า public. track ด้วย CR ไฟล์ (เจ้าของสั่ง 2026-10-26)
