---
id: CR-186
title: Master data chronic_disease (โรคประจำตัว) + Station 2 tag autocomplete
status: approved
date: 2026-10-22
requested_by: feedback หน้างาน (ข้อ 7) — issue #649 (unblocks #606)
decided_by: kong
layer: volatile
affects:
  - docs/data/schema.md §3.3 (`master_type` enum 4 → 5 + seed `chronic_disease`; global-only)
  - docs/data/schema.md §1.2 (`medical.conditions` = master code หรือ free text)
  - docs/master-data/README.md (รายการ master types)
  - CONTEXT.md (คำศัพท์ Chronic Disease; Vulnerable Group `chronic_illness`)
  - no schema_v bump (master_data v4, medical ไม่เปลี่ยนรูป)
  - frontend/src/lib/features/master-data/domain (MASTER_DATA_TYPES, labels/meta, resolveMasterCode, global-only)
  - frontend/scripts/seed/master-defs.ts (seed chronic_disease)
  - frontend/src/lib/features/people/ui/forms (health-medical-fields, master-tag-input ใหม่)
  - frontend/src/lib/features/people/ui/evacuee-profile/evacuee-profile-health-card.svelte (แสดง label)
  - frontend/src/lib/features/people-import (คอลัมน์โรคประจำตัว: map label/code → code; README รายการโรค)
  - frontend/e2e/master-data.test.ts
---

# CR-186 — master `chronic_disease` + Station 2 โรคประจำตัว

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม `master_type = chronic_disease` (`_id = master_data:chronic_disease`) —
>   **global-only** CRUD ที่ System Management (SA) พร้อม seed 12 รายการ
> - **Station 2:** ช่อง「โรคประจำตัว」เปลี่ยนจาก textarea เป็น **tag autocomplete** — เลือกจาก master
>   หรือพิมพ์เพิ่มเอง (free text)
> - **นำเข้าไฟล์ผู้อพยพ (xlsx/csv):** คอลัมน์โรคประจำตัวเดิม map ค่าที่ตรง master เป็น code; ที่เหลือเก็บข้อความ
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
- **FR-2** — `chronic_disease` เป็น **global-only**: SA CRUD ได้ที่ `/system-management/master-data`
  ตามกติกาเดิม (§3.3); back-office (`/back-office/master-data`) แสดงแบบ read-only และ **ไม่มี**
  shelter-local doc (`master_data:chronic_disease:{shelter_code}`) — writer ปฏิเสธ. ไม่มี endpoint ใหม่.
  เหตุผล: code ระดับศูนย์ resolve ไม่ได้เมื่อย้ายศูนย์/ดูจากส่วนกลาง และขัดเป้ารายการมาตรฐาน;
  โรคเฉพาะถิ่นใช้ free text (FR-5)
- **FR-3** — seed global `master_data:chronic_disease` (idempotent merge แบบ type อื่น), 12 รายการ
  (ไม่มี `other` — free text แทน):

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

- **FR-4** — ฟอร์ม Station 2 (`/onsite/medical-screening`) และ modal แก้ข้อมูลสุขภาพในโปรไฟล์
  (ใช้ `HealthMedicalFields` ร่วมกัน) แสดง「โรคประจำตัว」เป็น tag autocomplete: เลือกได้หลายรายการ
  จาก item `active` ของ global master, ค้นด้วย label TH/EN
- **FR-5** — ค่าที่ไม่อยู่ใน master เพิ่มเป็น free text ได้ (ตัด `,` ออก)
- **FR-6** — `medical.conditions[]` เก็บ master `code` เมื่อเลือกจาก list หรือเมื่อข้อความตรง
  `label_th`/`label_en` ของ item **`active`** (เทียบด้วย `normalizeLabel`); นอกนั้น — รวมข้อความที่ตรง
  label ของ item `inactive` — เก็บ free text ตามที่พิมพ์ (trim). code ที่บันทึกไว้แล้วของ item
  `inactive` ยัง resolve label ได้ (§3.3 soft-delete)
- **FR-7** — ค่าเดิมที่เป็น label (free text ก่อน CR นี้) ถูก map เป็น code ตามกติกา FR-6 เมื่อเปิดฟอร์ม
  แล้วบันทึก; ไม่ตรง → คงเป็น free text
- **FR-8** — ที่แสดง `medical.conditions` (การ์ดสุขภาพในโปรไฟล์) resolve code → label; free text
  แสดงตามที่เก็บ
- **FR-9** — นำเข้าไฟล์ผู้อพยพ (`/back-office/households/import`, CR-071, xlsx/csv): คอลัมน์
  `โรคประจำตัว (คั่นด้วย |)` คงหัวคอลัมน์และรูปแบบเดิม (ไม่มี dropdown — multi-value). แต่ละค่า:
  ตรง `code` หรือ `label_th`/`label_en` ของ item `active` (เทียบ `normalizeLabel`) → เก็บ code;
  นอกนั้น → free text. หน้า preview แจ้งค่าที่จะเก็บเป็นข้อความ (**เตือน ไม่ block**)
- **FR-10** — template xlsx: ชีต `คำแนะนำ` แถวคอลัมน์โรคประจำตัวแสดงรายการ label ของ item `active`
  ณ ตอนดาวน์โหลด พร้อมกำกับว่า "พิมพ์ตามรายการ หรือพิมพ์ชื่อโรคอื่นได้ คั่นด้วย |"
- **FR-11** — `vulnerable_groups: chronic_illness` กับ `medical.conditions` **ไม่ผูกกัน**: เลือกโรคไม่ติ๊ก
  กลุ่มเปราะบางให้อัตโนมัติ และไม่มี hint (ถ้าต้องการ — CR แยก)

### Out of scope

- ฟอร์มลงทะเบียนเจ้าหน้าที่ (`evacuee-ewar-symptom.svelte`) และ public/kiosk — ยังเป็น free text;
  ค่าจะถูก map เมื่อแก้ที่ Station 2 (FR-7)
- การจำกัดสิทธิ์มองเห็นข้อมูล medical (เช่น HIV / จิตเวช) — CR แยกถ้าต้องการ
- backfill ข้อมูลเดิมทั้งหมด

### Before → after

|                             | ก่อน              | หลัง                                                     |
| --------------------------- | ----------------- | -------------------------------------------------------- |
| `master_type` (§3.3)        | 4 types           | 5 types (+ `chronic_disease`, global-only)               |
| `medical.conditions` (§1.2) | `[str]` free text | `[str]` master `chronic_disease` code **หรือ** free text |
| Station 2 UI                | textarea คั่น `,` | tag autocomplete + free text                             |
| นำเข้าไฟล์ผู้อพยพ           | เก็บข้อความตรงๆ   | map เป็น code เมื่อตรง master; README แสดงรายการโรค      |

### Acceptance

- [ ] SA เพิ่ม/แก้/ปิดใช้ item ของ `chronic_disease` ที่ System Management ได้; back-office เห็นแบบ
      read-only และสร้าง item ระดับศูนย์ไม่ได้
- [ ] `pnpm seed:master` สร้าง `master_data:chronic_disease` ครบ 12 รายการ; รันซ้ำไม่ซ้ำ item
- [ ] Station 2 เลือกโรคจาก master ได้หลายรายการ → `medical.conditions` เก็บเป็น code
- [ ] พิมพ์โรคที่ไม่มีใน master แล้วเพิ่มได้ → เก็บเป็นข้อความ
- [ ] พิมพ์ข้อความตรง label ของ item `inactive` → เก็บเป็นข้อความ
- [ ] medical เดิม `["เบาหวาน"]` เปิดแก้แล้วบันทึก → `["diabetes"]`
- [ ] โปรไฟล์แสดง label ไม่ใช่ code
- [ ] นำเข้าไฟล์ที่คอลัมน์โรคประจำตัว = `เบาหวาน|diabetes|โรคเกาต์` → `["diabetes", "โรคเกาต์"]`
      (ตัดค่าซ้ำหลัง map) และ preview เตือนว่า `โรคเกาต์` จะเก็บเป็นข้อความ
- [ ] template xlsx ชีต `คำแนะนำ` แสดงรายการโรคที่ active

## Impact

- **Docs:** schema.md §3.3 (enum + seed block + global-only note), §1.2 (`conditions` row),
  `docs/master-data/README.md`, `CONTEXT.md` (Chronic Disease; Vulnerable Group)
- **Code:** master-data domain/barrel (+ global-only guard), seed defs, `HealthMedicalFields` +
  `MasterTagInput` ใหม่, profile health card, people-import (columns/import-row/template/preview);
  tests `master-data.test.ts`, `forms.test.ts`, `medical-screening/page.test.ts`,
  `import-row.test.ts`, `template.test.ts`, `e2e/master-data.test.ts`
- **ไม่กระทบ:** worker/FastAPI (`medical` ไม่ project ไป public; worker project เฉพาะ `volunteer_skills`),
  BFF master-data (generic ตาม `MASTER_DATA_TYPES`)
- **#648 (อาการแพ้):** ใช้ `MasterTagInput` ซ้ำได้ — แยก CR

## Migration

N/A — ไม่ bump `schema_v`. `master_data` v4 รูปเดิม; `medical.conditions` ยังเป็น `[str]`.
Deploy เดิมต้องรัน `pnpm seed:master` เพื่อสร้าง doc `master_data:chronic_disease` (ไม่มี doc → dropdown
ว่าง แต่ยังพิมพ์ free text ได้). ข้อมูลเดิมไม่ backfill — map label → code เมื่อมีการแก้ไข (FR-7).

## Decision log

- 2026-10-22 — proposed (#649). เคาะก่อนเริ่ม: track ด้วย CR ไฟล์; "stage 2" = Station 2
  คัดกรองสุขภาพ (ไม่รวม public/kiosk); seed = รายการเสนอ + เพิ่มเติม; เก็บ code + free text
- 2026-10-22 — grill review, เคาะ (kong):
  - ฟอร์มลงทะเบียนเจ้าหน้าที่ out of scope; นำเข้าไฟล์ผู้อพยพ in scope — map code/label → code,
    คอลัมน์เดิม (multi-value ไม่มี dropdown), README แสดงรายการ, preview เตือนไม่ block (FR-9, FR-10)
  - `chronic_disease` global-only — ไม่มี shelter-local (FR-2)
  - `chronic_illness` (Vulnerable Group) กับ Chronic Disease แยกกัน ไม่ link อัตโนมัติ (FR-11);
    นิยามใน `CONTEXT.md`
  - ตัด seed `other` → 12 รายการ (FR-3)
  - map ข้อความ → code เฉพาะ item `active` (FR-6)
  - คง `hiv` / `psychiatric_disorder` ใน seed; การจำกัดสิทธิ์มองเห็น medical = CR แยก
- 2026-10-22 — approved (kong) → CR-186 (CR-185 ถูกใช้แล้วบน branch `fix/709-home-volunteer-card`)
