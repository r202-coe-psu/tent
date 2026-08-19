---
id: CR-068
title: ขยาย CR-039 Excel import — คอลัมน์ชนิดสถานที่ site_kind
status: approved
date: 2026-08-13
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ (IMPS, approved 2026-08-13)
layer: volatile
parent: CR-066
extends: CR-039
affects:
  - docs/changes/CR-039-shelter-excel-import.md (column map)
  - frontend/src/lib/features/shelter-import/ (domain column map + template)
  - docs/task-breakdown/00-baseline.md (T-68)
  - schema_v shelter_import_log คง 1 (ไม่ bump)
---

# CR-068 — Excel import ขยาย CR-039 (`site_kind`)

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เทมเพลต/validator import ศูนย์เพิ่มคอลัมน์ชนิดสถานที่ → `site_kind`
- **เพื่อใคร/ทำไม:** onboarding ศูนย์และบ้านพี่เลี้ยงจากไฟล์เดียว
- **dev ต้อง build อะไร:** คอลัมน์ใหม่ใน exceljs template + label→enum + default เมื่อว่าง (T-68)
- **กระทบ schema/scope ไหน:** ไม่ bump shelter schema (ใช้ field จาก CR-067); ไม่เปลี่ยน `shelter_import_log` schema_v

## Why

CR-039 มี 19 คอลัมน์ ไม่มีชนิดสถานที่. หลังมี `site_kind` (CR-067) import ต้องสร้างบ้านพี่เลี้ยงได้โดยไม่กรอกฟอร์มทีละหลัง.

## Change

### Before → After

| Before (CR-039) | After |
| --- | --- |
| 19 คอลัมน์; ทุกแถวเป็นศูนย์โดยนัย | +1 คอลัมน์ชนิดสถานที่ |
| ไม่มี `site_kind` | map label ไทย → enum |

### คอลัมน์ใหม่ (proposed)

| # | คอลัมน์ Excel (TH) | field | บังคับ | ค่า |
| --- | --- | --- | --- | --- |
| 20 | ชนิดสถานที่ | `site_kind` | ไม่ | ศูนย์อพยพ=`evacuation_center` · บ้านพี่เลี้ยง=`host_house`; ว่าง = `evacuation_center` |

ลำดับคอลัมน์ 1–19 คงตาม CR-039. Dropdown ในเทมเพลตเหมือนคอลัมน์ enum อื่น.

พฤติกรรม commit คงเดิม: validate รายแถว, POST sequential, partial success, เขียน `shelter_import_log`.

## Requirements

- **FR-64, FR-65** ตาม program spec
- Access ยัง `requireAdmin` ตาม CR-039
- แถว `host_house` ผ่าน `shelterSchema` ชุดเดียวกับฟอร์ม (P1 ยังไม่ลดฟิลด์บังคับ)

### Acceptance (T-68)

- ดาวน์โหลดเทมเพลตแล้วมี dropdown ชนิดสถานที่
- import บ้าน 1 แถว + ศูนย์ 1 แถวในไฟล์เดียว สำเร็จ; log บันทึกครบ
- ค่าว่าง → `evacuation_center`; ค่านอก dropdown → error รายช่อง ไม่ commit แถวนั้น
- unit test label→enum + default
- demo ไฟล์ผสม 2 ชนิด

## Impact

- `features/shelter-import` domain/data/ui เท่านั้น; reuse `createShelter` ผ่าน barrel
- ขึ้นกับ CR-067 (field ต้องมีใน schema ก่อน)

## Migration

N/A. เทมเพลตเก่า 19 คอลัมน์ยัง import ได้ (คอลัมน์หาย = default ศูนย์).

## Out of scope

- People/evacuee import (CR-071 / T-72)
- ลดคอลัมน์บังคับสำหรับบ้าน (T-76)

## Decision log

- 2026-08-13 — proposed. ทำหลัง T-66.
- 2026-08-13 — D-SITE-MODEL=A ล็อกแล้ว (`site_kind` บน `shelter`). CR นี้ยัง `proposed` — ไม่ bump schema.
- 2026-08-13 — **approved** โดยเจ้าของโครงการ (IMPS): คอลัมน์ import `site_kind` ครอบคลุมด้วย D-SITE-MODEL=A; ไม่มีสไลซ์ Wave 4. ทำหลัง T-66. **ไม่ bump schema.**
