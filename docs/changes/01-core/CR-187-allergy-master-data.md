---
id: CR-187
title: Master data allergy (อาการแพ้) + Station 2 tag autocomplete
status: approved
date: 2026-10-22
requested_by: feedback หน้างาน (ข้อ 6) — issue #648 (unblocks #607)
decided_by: kong
layer: volatile
affects:
  - docs/data/schema.md §3.3 (`master_type` enum 5 → 6 + seed `allergy`; global-only)
  - docs/data/schema.md §1.2 (`medical.allergies` = master code หรือ free text)
  - docs/master-data/README.md (รายการ master types)
  - CONTEXT.md (คำศัพท์ Allergy)
  - no schema_v bump (master_data v4, medical ไม่เปลี่ยนรูป)
  - frontend/src/lib/features/master-data/domain (MASTER_DATA_TYPES, labels/meta, global-only)
  - frontend/scripts/seed/master-defs.ts (seed allergy)
  - frontend/src/lib/features/people/ui/forms/health-medical-fields.svelte (ใช้ MasterTagInput จาก CR-186)
  - frontend/src/lib/features/people/ui/evacuee-profile/evacuee-profile-health-card.svelte (แสดง label)
  - frontend/e2e/master-data.test.ts
---

# CR-187 — master `allergy` + Station 2 ประวัติการแพ้

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม `master_type = allergy` (`_id = master_data:allergy`) — **global-only**
>   CRUD ที่ System Management (SA) พร้อม seed 5 รายการ: อาหารทะเล, นม, ไข่, แป้งสาลี, ถั่ว
> - **Station 2:** ช่อง「ประวัติการแพ้」เปลี่ยนจาก textarea เป็น **tag autocomplete** — เลือกจาก master
>   หรือพิมพ์เพิ่มเอง (free text เช่น แพ้ยา "เพนิซิลลิน")
> - **เก็บ:** `medical.allergies[]` = master `code` หรือ free text ปนกันได้; ไม่ bump `schema_v`
> - **ใช้ต่อ:** #607 เทียบ code ใน `medical.allergies` กับสารก่อแพ้ของอาหารตอนแจก (แยก CR)
> - รูปแบบเดียวกับ [CR-186](CR-186-chronic-disease-master-data.md) (#649) — ใช้ component และ helper
>   เดียวกัน; ต่างกันที่นำเข้าไฟล์ผู้อพยพ **ไม่** map (out of scope)

---

## Why

- ช่องประวัติการแพ้เป็น free text → "แพ้กุ้ง" / "อาหารทะเล" / "seafood" เทียบกันอัตโนมัติไม่ได้
- feedback หน้างาน (ข้อ 6): ตอนแจกอาหารต้องรู้ว่าผู้รับแพ้อะไร (#607) → ต้องเก็บเป็น code จาก master
  เดียวกับที่ใช้กำกับสารก่อแพ้ของสินค้า

## Change

### Requirements

- **FR-1** — `master_type` enum เพิ่ม `allergy` (5 → 6 types); label `อาการแพ้ (Allergy)`
- **FR-2** — `allergy` เป็น **global-only**: SA CRUD ได้ที่ `/system-management/master-data`
  ตามกติกาเดิม (§3.3); back-office (`/back-office/master-data`) แสดงแบบ read-only และ **ไม่มี**
  shelter-local doc (`master_data:allergy:{shelter_code}`) — writer ปฏิเสธ. ไม่มี endpoint ใหม่.
  เหตุผล (เหมือน CR-186 FR-2): code ระดับศูนย์ resolve ไม่ได้เมื่อย้ายศูนย์/ดูจากส่วนกลาง และ #607
  ต้องเทียบ code ของผู้รับกับสารก่อแพ้ของสินค้าข้ามศูนย์ได้; สิ่งที่แพ้นอกรายการใช้ free text (FR-5)
- **FR-3** — seed global `master_data:allergy` (idempotent merge แบบ type อื่น), 5 รายการ
  (ไม่มี `other` — free text แทน):

  | code      | label_th  | label_en |
  | --------- | --------- | -------- |
  | `seafood` | อาหารทะเล | Seafood  |
  | `milk`    | นม        | Milk     |
  | `egg`     | ไข่       | Egg      |
  | `wheat`   | แป้งสาลี  | Wheat    |
  | `nuts`    | ถั่ว      | Nuts     |

- **FR-4** — ฟอร์ม Station 2 (`/onsite/medical-screening`) และ modal แก้ข้อมูลสุขภาพในโปรไฟล์
  (ใช้ `HealthMedicalFields` ร่วมกัน) แสดง「ประวัติการแพ้」เป็น tag autocomplete (`MasterTagInput`
  ของ CR-186): เลือกได้หลายรายการจาก item `active` ของ global master, ค้นด้วย label TH/EN
- **FR-5** — ค่าที่ไม่อยู่ใน master เพิ่มเป็น free text ได้ (แพ้ยา/สารอื่น) — ตัด `,` ออก
- **FR-6** — `medical.allergies[]` เก็บ master `code` เมื่อเลือกจาก list หรือเมื่อข้อความตรง
  `label_th`/`label_en` ของ item **`active`** (เทียบด้วย `normalizeLabel`); นอกนั้น — รวมข้อความที่ตรง
  label ของ item `inactive` — เก็บ free text ตามที่พิมพ์ (trim). code ที่บันทึกไว้แล้วของ item
  `inactive` ยัง resolve label ได้ (§3.3 soft-delete)
- **FR-7** — ค่าเดิมที่เป็น label (free text ก่อน CR นี้) ถูก map เป็น code ตามกติกา FR-6 เมื่อเปิดฟอร์ม
  แล้วบันทึก; ไม่ตรง → คงเป็น free text
- **FR-8** — ที่แสดง `medical.allergies` (การ์ดสุขภาพในโปรไฟล์) resolve code → label; free text
  แสดงตามที่เก็บ

### Out of scope

- นำเข้าไฟล์ผู้อพยพ (`/back-office/households/import`, CR-071): คอลัมน์
  `ประวัติการแพ้ (คั่นด้วย |)` คงเก็บข้อความตามเดิม **ไม่** map เป็น code (ต่างจาก CR-186 FR-9) —
  ค่าจะถูก map เมื่อแก้ที่ Station 2 (FR-7)
- ฟอร์มลงทะเบียนเจ้าหน้าที่ และ public/kiosk — ยังเป็น free text; map เมื่อแก้ที่ Station 2 (FR-7)
- backfill ข้อมูลเดิมทั้งหมด
- การกำกับสารก่อแพ้ของสินค้า/อาหารและการเตือนตอนแจก — #607 (CR แยก)

### Before → after

|                            | ก่อน              | หลัง                                             |
| -------------------------- | ----------------- | ------------------------------------------------ |
| `master_type` (§3.3)       | 5 types           | 6 types (+ `allergy`, global-only)               |
| `medical.allergies` (§1.2) | `[str]` free text | `[str]` master `allergy` code **หรือ** free text |
| Station 2 UI               | textarea คั่น `,` | tag autocomplete + free text                     |
| นำเข้าไฟล์ผู้อพยพ          | เก็บข้อความตรงๆ   | ไม่เปลี่ยน (out of scope)                        |

### Acceptance

- [ ] SA เพิ่ม/แก้/ปิดใช้ item ของ `allergy` ที่ System Management ได้; back-office เห็นแบบ
      read-only และสร้าง item ระดับศูนย์ไม่ได้
- [ ] `pnpm seed:master` สร้าง `master_data:allergy` ครบ 5 รายการ; รันซ้ำไม่ซ้ำ item
- [ ] Station 2 เลือกอาการแพ้จาก master ได้หลายรายการ → `medical.allergies` เก็บเป็น code
- [ ] พิมพ์สิ่งที่แพ้ที่ไม่มีใน master (เช่น เพนิซิลลิน) แล้วเพิ่มได้ → เก็บเป็นข้อความ
- [ ] พิมพ์ข้อความตรง label ของ item `inactive` → เก็บเป็นข้อความ
- [ ] medical เดิม `["ไข่"]` เปิดแก้แล้วบันทึก → `["egg"]`
- [ ] โปรไฟล์แสดง label ไม่ใช่ code

## Impact

- **Docs:** schema.md §3.3 (enum + seed block + global-only note), §1.2 (`allergies` row),
  `docs/master-data/README.md`, `CONTEXT.md` (Allergy)
- **Code:** master-data domain/barrel (global-only guard ของ CR-186 ครอบ `allergy`), seed defs,
  `HealthMedicalFields`, profile health card; tests `master-data.test.ts`, `forms.test.ts`,
  `e2e/master-data.test.ts`
- **ไม่กระทบ:** worker/FastAPI (`medical` ไม่ project ไป public), BFF master-data (generic ตาม
  `MASTER_DATA_TYPES`), people-import (out of scope)
- **ลำดับ:** ต่อจาก CR-186 (#649) — ใช้ `MasterTagInput` + `resolveMasterCode` + global-only guard ที่
  CR-186 เพิ่ม

## Migration

N/A — ไม่ bump `schema_v`. `master_data` v4 รูปเดิม; `medical.allergies` ยังเป็น `[str]`.
Deploy เดิมต้องรัน `pnpm seed:master` เพื่อสร้าง doc `master_data:allergy` (ไม่มี doc → dropdown ว่าง
แต่ยังพิมพ์ free text ได้). ข้อมูลเดิมไม่ backfill — map label → code เมื่อมีการแก้ไข (FR-7).

## Decision log

- 2026-10-22 — proposed (#648). ใช้คำตัดสินเดียวกับ #649: track ด้วย CR ไฟล์; "stage 2" = Station 2
  คัดกรองสุขภาพ; เก็บ code + free text (ต้องพิมพ์เพิ่มได้เพราะรวมแพ้ยา)
- 2026-10-22 — review PR #766, เคาะ (kong):
  - `allergy` global-only เหมือน CR-186 — ไม่มี shelter-local (FR-2)
  - map ข้อความ → code เฉพาะ item `active` (FR-6) ตาม CR-186
  - นำเข้าไฟล์ผู้อพยพไม่ map — out of scope
- 2026-10-22 — approved (kong) → CR-187
