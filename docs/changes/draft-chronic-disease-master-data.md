---
id: draft
title: Master data chronic_disease (โรคประจำตัว) + Station 2 tag autocomplete
status: proposed
date: 2026-10-22
requested_by: feedback หน้างาน (ข้อ 7) — issue #649 (unblocks #606)
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §3.3 (`master_type` enum 4 → 5 + seed `chronic_disease`)
  - docs/data/schema.md §1.2 (`medical.conditions` = master code หรือ free text)
  - docs/master-data/README.md (รายการ master types)
  - no schema_v bump (master_data v4, medical ไม่เปลี่ยนรูป)
  - frontend/src/lib/features/master-data/domain (MASTER_DATA_TYPES, labels/meta, resolveMasterCode)
  - frontend/scripts/seed/master-defs.ts (seed chronic_disease)
  - frontend/src/lib/features/people/ui/forms (health-medical-fields, master-tag-input ใหม่)
  - frontend/src/lib/features/people/ui/evacuee-profile/evacuee-profile-health-card.svelte (แสดง label)
  - frontend/e2e/master-data.test.ts
---

# draft-chronic-disease-master-data — master `chronic_disease` + Station 2 โรคประจำตัว

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม `master_type = chronic_disease` (`_id = master_data:chronic_disease`) — CRUD
>   ผ่านหน้า Master Data เดิม (global + shelter-local) พร้อม seed 13 รายการ
> - **Station 2:** ช่อง「โรคประจำตัว」เปลี่ยนจาก textarea เป็น **tag autocomplete** — เลือกจาก master
>   หรือพิมพ์เพิ่มเอง (free text)
> - **เก็บ:** `medical.conditions[]` = master `code` หรือ free text ปนกันได้; ไม่ bump `schema_v`
> - กลับคำตัดสินบางส่วนของ CR-137 (ซึ่งตัด `health_condition` ทิ้งเพราะไม่มี form ใช้)

---

## Why

- ช่องโรคประจำตัวเป็น free text → สะกดต่างกัน ("เบาหวาน" / "DM" / "โรคเบาหวาน") นับ/กรองไม่ได้
- feedback หน้างาน (ข้อ 7) ขอรายการมาตรฐานให้เลือก; #606 ขอ tag autocomplete และให้ใช้ master นี้
- CR-137 ตัด `health_condition` เพราะ **ไม่มี form ใช้งานจริง** — ครั้งนี้ผูกกับ Station 2 ตั้งแต่ต้น
  จึงไม่ขัดเหตุผลเดิม

## Change

### Requirements

- **FR-1** — `master_type` enum เพิ่ม `chronic_disease` (4 → 5 types); label `โรคประจำตัว (Chronic Disease)`
- **FR-2** — หน้า Master Data (`/system-management/master-data`, `/back-office/master-data`) แสดง type
  `chronic_disease` และ CRUD ได้ตามกติกา two-tier เดิม (§3.3) — ไม่มี endpoint ใหม่
- **FR-3** — seed global `master_data:chronic_disease` (idempotent merge แบบ type อื่น):

  | code                   | label_th              | label_en             |
  | ---------------------- | --------------------- | -------------------- |
  | `diabetes`             | เบาหวาน               | Diabetes             |
  | `hypertension`         | ความดันโลหิตสูง       | Hypertension         |
  | `heart_disease`        | โรคหัวใจ              | Heart disease        |
  | `kidney_disease`       | โรคไต                 | Kidney disease       |
  | `asthma`               | หอบหืด                | Asthma               |
  | `dyslipidemia`         | ไขมันในเลือดสูง       | Dyslipidemia         |
  | `stroke`               | โรคหลอดเลือดสมอง      | Stroke               |
  | `copd`                 | ถุงลมโป่งพอง / COPD   | COPD                 |
  | `cancer`               | มะเร็ง                | Cancer               |
  | `epilepsy`             | ลมชัก                 | Epilepsy             |
  | `hiv`                  | ติดเชื้อเอชไอวี (HIV) | HIV infection        |
  | `psychiatric_disorder` | โรคทางจิตเวช          | Psychiatric disorder |
  | `other`                | อื่นๆ                 | Other                |

- **FR-4** — ฟอร์ม Station 2 (`/onsite/medical-screening`) และ modal แก้ข้อมูลสุขภาพในโปรไฟล์
  (ใช้ `HealthMedicalFields` ร่วมกัน) แสดง「โรคประจำตัว」เป็น tag autocomplete: เลือกได้หลายรายการ
  จาก item `active` ของ master (effective = global ∪ shelter-local), ค้นด้วย label TH/EN
- **FR-5** — ค่าที่ไม่อยู่ใน master เพิ่มเป็น free text ได้ (ตัด `,` ออก)
- **FR-6** — `medical.conditions[]` เก็บ master `code` เมื่อเลือกจาก list หรือเมื่อข้อความตรง
  `label_th`/`label_en` (เทียบด้วย `normalizeLabel`); นอกนั้นเก็บ free text ตามที่พิมพ์ (trim)
- **FR-7** — ค่าเดิมที่เป็น label (free text ก่อน CR นี้) ถูก map เป็น code เมื่อเปิดฟอร์มแล้วบันทึก;
  ไม่ตรง label ใด → คงเป็น free text
- **FR-8** — ที่แสดง `medical.conditions` (การ์ดสุขภาพในโปรไฟล์) resolve code → label; free text
  แสดงตามที่เก็บ

### Before → after

|                             | ก่อน              | หลัง                                                     |
| --------------------------- | ----------------- | -------------------------------------------------------- |
| `master_type` (§3.3)        | 4 types           | 5 types (+ `chronic_disease`)                            |
| `medical.conditions` (§1.2) | `[str]` free text | `[str]` master `chronic_disease` code **หรือ** free text |
| Station 2 UI                | textarea คั่น `,` | tag autocomplete + free text                             |

### Acceptance

- [ ] SA เพิ่ม/แก้/ปิดใช้ item ของ `chronic_disease` ที่ System Management ได้; SM เพิ่ม item ระดับศูนย์ได้
- [ ] `pnpm seed:master` สร้าง `master_data:chronic_disease` ครบ 13 รายการ; รันซ้ำไม่ซ้ำ item
- [ ] Station 2 เลือกโรคจาก master ได้หลายรายการ → `medical.conditions` เก็บเป็น code
- [ ] พิมพ์โรคที่ไม่มีใน master แล้วเพิ่มได้ → เก็บเป็นข้อความ
- [ ] medical เดิม `["เบาหวาน"]` เปิดแก้แล้วบันทึก → `["diabetes"]`
- [ ] โปรไฟล์แสดง label ไม่ใช่ code

## Impact

- **Docs:** schema.md §3.3 (enum + seed block), §1.2 (`conditions` row), `docs/master-data/README.md`
- **Code:** master-data domain/barrel, seed defs, `HealthMedicalFields` + `MasterTagInput` ใหม่,
  profile health card; tests `master-data.test.ts`, `forms.test.ts`, `medical-screening/page.test.ts`,
  `e2e/master-data.test.ts`
- **ไม่กระทบ:** worker/FastAPI (`medical` ไม่ project ไป public; worker project เฉพาะ `volunteer_skills`),
  BFF master-data (generic ตาม `MASTER_DATA_TYPES`)
- **#648 (อาการแพ้):** ใช้ `MasterTagInput` ซ้ำได้ — แยก CR

## Migration

N/A — ไม่ bump `schema_v`. `master_data` v4 รูปเดิม; `medical.conditions` ยังเป็น `[str]`.
Deploy เดิมต้องรัน `pnpm seed:master` เพื่อสร้าง doc `master_data:chronic_disease` (ไม่มี doc → dropdown
ว่าง แต่ยังพิมพ์ free text ได้). ข้อมูลเดิมไม่ backfill — map label → code เมื่อมีการแก้ไข (FR-7).

## Decision log

- 2026-10-22 — proposed (#649). Owner เคาะก่อนเริ่ม: track ด้วย CR ไฟล์; "stage 2" = Station 2
  คัดกรองสุขภาพ (ไม่รวม public/kiosk); seed = รายการเสนอ + เพิ่มเติม (13); เก็บ code + free text
