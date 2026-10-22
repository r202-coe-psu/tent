---
id: draft
title: Master data allergy (อาการแพ้) + Station 2 tag autocomplete
status: proposed
date: 2026-10-22
requested_by: feedback หน้างาน (ข้อ 6) — issue #648 (unblocks #607)
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §3.3 (`master_type` enum + seed `allergy`)
  - docs/data/schema.md §1.2 (`medical.allergies` = master code หรือ free text)
  - docs/master-data/README.md (รายการ master types)
  - no schema_v bump (master_data v4, medical ไม่เปลี่ยนรูป)
  - frontend/src/lib/features/master-data/domain (MASTER_DATA_TYPES, labels/meta)
  - frontend/scripts/seed/master-defs.ts (seed allergy)
  - frontend/src/lib/features/people/ui/forms/health-medical-fields.svelte (ใช้ MasterTagInput จาก draft-chronic-disease-master-data)
  - frontend/src/lib/features/people/ui/evacuee-profile/evacuee-profile-health-card.svelte (แสดง label)
---

# draft-allergy-master-data — master `allergy` + Station 2 ประวัติการแพ้

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม `master_type = allergy` (`_id = master_data:allergy`) — CRUD ผ่านหน้า Master
>   Data เดิม (global + shelter-local) พร้อม seed 5 รายการ: อาหารทะเล, นม, ไข่, แป้งสาลี, ถั่ว
> - **Station 2:** ช่อง「ประวัติการแพ้」เปลี่ยนจาก textarea เป็น **tag autocomplete** — เลือกจาก master
>   หรือพิมพ์เพิ่มเอง (free text เช่น แพ้ยา "เพนิซิลลิน")
> - **เก็บ:** `medical.allergies[]` = master `code` หรือ free text ปนกันได้; ไม่ bump `schema_v`
> - **ใช้ต่อ:** #607 เทียบ code ใน `medical.allergies` กับสารก่อแพ้ของอาหารตอนแจก (แยก CR)
> - รูปแบบเดียวกับ draft-chronic-disease-master-data (#649) — ใช้ component และ helper เดียวกัน

---

## Why

- ช่องประวัติการแพ้เป็น free text → "แพ้กุ้ง" / "อาหารทะเล" / "seafood" เทียบกันอัตโนมัติไม่ได้
- feedback หน้างาน (ข้อ 6): ตอนแจกอาหารต้องรู้ว่าผู้รับแพ้อะไร (#607) → ต้องเก็บเป็น code จาก master
  เดียวกับที่ใช้กำกับสารก่อแพ้ของสินค้า

## Change

### Requirements

- **FR-1** — `master_type` enum เพิ่ม `allergy`; label `อาการแพ้ (Allergy)`
- **FR-2** — หน้า Master Data (`/system-management/master-data`, `/back-office/master-data`) แสดง type
  `allergy` และ CRUD ได้ตามกติกา two-tier เดิม (§3.3) — ไม่มี endpoint ใหม่
- **FR-3** — seed global `master_data:allergy` (idempotent merge แบบ type อื่น):

  | code      | label_th  | label_en |
  | --------- | --------- | -------- |
  | `seafood` | อาหารทะเล | Seafood  |
  | `milk`    | นม        | Milk     |
  | `egg`     | ไข่       | Egg      |
  | `wheat`   | แป้งสาลี  | Wheat    |
  | `nuts`    | ถั่ว      | Nuts     |

- **FR-4** — ฟอร์ม Station 2 (`/onsite/medical-screening`) และ modal แก้ข้อมูลสุขภาพในโปรไฟล์
  (ใช้ `HealthMedicalFields` ร่วมกัน) แสดง「ประวัติการแพ้」เป็น tag autocomplete: เลือกได้หลายรายการ
  จาก item `active` ของ master (effective = global ∪ shelter-local), ค้นด้วย label TH/EN
- **FR-5** — ค่าที่ไม่อยู่ใน master เพิ่มเป็น free text ได้ (แพ้ยา/สารอื่น) — ตัด `,` ออก
- **FR-6** — `medical.allergies[]` เก็บ master `code` เมื่อเลือกจาก list หรือเมื่อข้อความตรง
  `label_th`/`label_en` (`resolveMasterCode`); นอกนั้นเก็บ free text ตามที่พิมพ์ (trim)
- **FR-7** — ค่าเดิมที่เป็น label ถูก map เป็น code เมื่อเปิดฟอร์มแล้วบันทึก; ไม่ตรง label ใด → คงเป็น free text
- **FR-8** — ที่แสดง `medical.allergies` (การ์ดสุขภาพในโปรไฟล์) resolve code → label; free text แสดงตามที่เก็บ

### Before → after

|                            | ก่อน              | หลัง                                             |
| -------------------------- | ----------------- | ------------------------------------------------ |
| `master_type` (§3.3)       | เดิม + `allergy`  | + `allergy`                                      |
| `medical.allergies` (§1.2) | `[str]` free text | `[str]` master `allergy` code **หรือ** free text |
| Station 2 UI               | textarea คั่น `,` | tag autocomplete + free text                     |

### Acceptance

- [ ] SA เพิ่ม/แก้/ปิดใช้ item ของ `allergy` ที่ System Management ได้; SM เพิ่ม item ระดับศูนย์ได้
- [ ] `pnpm seed:master` สร้าง `master_data:allergy` ครบ 5 รายการ; รันซ้ำไม่ซ้ำ item
- [ ] Station 2 เลือกอาการแพ้จาก master ได้หลายรายการ → `medical.allergies` เก็บเป็น code
- [ ] พิมพ์สิ่งที่แพ้ที่ไม่มีใน master (เช่น เพนิซิลลิน) แล้วเพิ่มได้ → เก็บเป็นข้อความ
- [ ] medical เดิม `["ไข่"]` เปิดแก้แล้วบันทึก → `["egg"]`
- [ ] โปรไฟล์แสดง label ไม่ใช่ code

## Impact

- **Docs:** schema.md §3.3 (enum + seed block), §1.2 (`allergies` row), `docs/master-data/README.md`
- **Code:** master-data domain, seed defs, `HealthMedicalFields`, profile health card; tests
  `master-data.test.ts`, `forms.test.ts`, `e2e/master-data.test.ts`
- **ไม่กระทบ:** worker/FastAPI (`medical` ไม่ project ไป public), BFF master-data (generic ตาม
  `MASTER_DATA_TYPES`), CSV import (ยังรับ free text — map เป็น code เมื่อแก้ในฟอร์ม)
- **ลำดับ:** ต่อจาก draft-chronic-disease-master-data (#649) — ใช้ `MasterTagInput` +
  `resolveMasterCode` ที่ #649 เพิ่ม; ถ้า #649 merge ก่อน enum จะเป็น 6 types

## Migration

N/A — ไม่ bump `schema_v`. `master_data` v4 รูปเดิม; `medical.allergies` ยังเป็น `[str]`.
Deploy เดิมต้องรัน `pnpm seed:master` เพื่อสร้าง doc `master_data:allergy` (ไม่มี doc → dropdown ว่าง
แต่ยังพิมพ์ free text ได้). ข้อมูลเดิมไม่ backfill — map label → code เมื่อมีการแก้ไข (FR-7).

## Decision log

- 2026-10-22 — proposed (#648). ใช้คำตัดสินเดียวกับ #649: track ด้วย CR ไฟล์; "stage 2" = Station 2
  คัดกรองสุขภาพ; เก็บ code + free text (ต้องพิมพ์เพิ่มได้เพราะรวมแพ้ยา) — รอ owner ยืนยัน
