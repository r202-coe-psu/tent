---
id: draft
title: บ้านพี่เลี้ยง (site_kind = host_house) เป็นศูนย์ External ไม่ได้ (amend CR-252)
status: proposed
date: 2026-11-23
requested_by: "@mhapong (2026-11-23) — หน้าสร้างศูนย์พักพิง: บ้านพี่เลี้ยงไม่มี External"
decided_by:
layer: volatile
affects:
  - docs/changes/00-baseline/CR-252-external-shelter.md (เพิ่ม invariant ใน "Schema / domain")
  - docs/changes/12-public/CR-261-public-shelters-search.md (FR-5, AC-5, AC-9 อ้างถึง "ศูนย์ External ที่ site_kind = host_house" — แก้เป็นกรณีที่ไม่เกิด)
  - docs/data/schema.md §shelter (หมายเหตุ schema_v 10 — เพิ่มกฎ) · schema_v — ไม่เปลี่ยน
  - frontend/src/lib/features/shelters/domain/schema.ts (`externalInvariantIssues` + Zod)
  - frontend/src/lib/features/shelters/ui/basic-info-section.svelte (ฟอร์มสร้าง/แก้ศูนย์)
  - frontend/src/routes/api/back-office/shelter/** (BFF สร้าง/แก้ไข)
  - frontend/src/lib/features/shelter-import/** (นำเข้าศูนย์จากไฟล์ รวมศูนย์ External)
---

# draft — บ้านพี่เลี้ยงเป็นศูนย์ External ไม่ได้

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม invariant ของ shelter doc: `is_external = true` ⇒ `site_kind ≠ host_house` (บ้านพี่เลี้ยงไม่มีแบบ External).
> - **ทำไม:** บ้านพี่เลี้ยงเป็นที่พักในระบบเท่านั้น; CR-252 ไม่ได้ห้ามคู่นี้ ฟอร์มจึงสร้างบ้านพี่เลี้ยงแบบ External ได้.
> - **Dev ต้อง build:** กฎใน domain (Zod + `externalInvariantIssues`) ที่ BFF สร้าง/แก้ไขและการนำเข้าไฟล์ใช้ร่วมกัน + ฟอร์มกันเลือกคู่นี้.
> - **กระทบ:** CR-252, CR-261 FR-5/AC-5/AC-9 (ถ้อยคำ), schema.md หมายเหตุ; ไม่ bump `schema_v`, ไม่แตะ worker/FastAPI.

---

## 1. Requirements

| ID | Requirement |
| --- | --- |
| FR-1 | shelter doc ที่ `is_external = true` ต้องมี `site_kind` ที่ไม่ใช่ `host_house` (ค่าว่าง/ไม่มี `site_kind` อ่านเป็น `evacuation_center` ตาม CR-067 จึงผ่าน) |
| FR-2 | กฎ FR-1 อยู่ที่ domain ของ `shelters` (`externalInvariantIssues` / Zod) ตัวเดียว ให้ฟอร์ม, BFF สร้าง/แก้ไข และการนำเข้าไฟล์เรียกใช้ร่วมกัน |
| FR-3 | ฟอร์มสร้างศูนย์: เมื่อเลือก `site_kind = host_house` สวิตช์ "ศูนย์ภายนอก (External)" ปิดและเปิดไม่ได้ พร้อมข้อความ "บ้านพี่เลี้ยงเป็นศูนย์ภายนอกไม่ได้"; เมื่อเปิด External ตัวเลือก "บ้านพี่เลี้ยง" ใน `site_kind` เลือกไม่ได้ |
| FR-4 | ฟอร์มแก้ไขศูนย์ External (หลังสร้าง `is_external` เปลี่ยนไม่ได้ ตาม CR-252 FR-9): เปลี่ยน `site_kind` เป็น `host_house` ไม่ได้ |
| FR-5 | BFF สร้าง/แก้ไข shelter ปฏิเสธคู่ `is_external = true` + `site_kind = host_house` ด้วย 400 และข้อความเดียวกับ FR-3 — รวมกรณี PATCH ส่งแค่ `site_kind` ของศูนย์ External เดิม |
| FR-6 | การนำเข้าศูนย์จากไฟล์: แถวที่เป็น External + ชนิดสถานที่ "บ้านพี่เลี้ยง" เป็น error ของแถวนั้น (ไม่นำเข้า) |
| FR-7 | ข้อมูลเดิมที่เป็นคู่นี้แล้ว (ถ้ามี) อ่าน/แสดงได้ตามเดิม ไม่ backfill; การบันทึกครั้งถัดไปต้องเปลี่ยน `site_kind` ก่อน |

## 2. Acceptance

- **AC-1** หน้าสร้างศูนย์: เลือก "บ้านพี่เลี้ยง" แล้ว สวิตช์ External ปิดและกดไม่ได้ พร้อมข้อความ
- **AC-2** หน้าสร้างศูนย์: เปิด External ก่อน แล้วรายการชนิดสถานที่ "บ้านพี่เลี้ยง" เลือกไม่ได้
- **AC-3** `POST`/`PATCH` ของ BFF ด้วย `is_external: true, site_kind: "host_house"` → 400; ส่วน `is_external: true, site_kind: "evacuation_center"` ผ่าน
- **AC-4** ไฟล์นำเข้าที่มีแถว External + บ้านพี่เลี้ยง → แถวนั้นขึ้น error ไม่ถูกนำเข้า แถวอื่นนำเข้าตามปกติ
- **AC-5** บ้านพี่เลี้ยงปกติ (`is_external = false`) สร้าง/แก้ไข/นำเข้าได้เหมือนเดิม
- **AC-6** เทสต์ domain: `externalInvariantIssues` คืน issue ที่ `site_kind` สำหรับคู่นี้

## 3. Why

- @mhapong (2026-11-23): "หน้าสร้างศูนย์พักพิงถ้ามี type host_house ไม่ให้เป็น external — บ้านพี่เลี้ยงไม่มี external"; เลือกติดตามด้วย CR file และบังคับทุกทางเข้า (ฟอร์ม, BFF, นำเข้าไฟล์)
- CR-252 กำหนดกฎ External กับ `operation_status`/`capacity` แต่ไม่ได้กำหนดกับ `site_kind`
- CR-261 FR-5 เขียนเผื่อ "ศูนย์ External ที่ `site_kind = host_house`" ไว้ — หลัง CR นี้กรณีนั้นไม่เกิดกับข้อมูลใหม่

## 4. Impact

- **Domain:** `shelters/domain/schema.ts` — `ExternalInvariantInput` เพิ่ม `site_kind`, issue path ใหม่ `site_kind`; เทสต์
- **UI:** `shelters/ui/basic-info-section.svelte` — ล็อกสวิตช์ External / ตัวเลือกบ้านพี่เลี้ยง
- **BFF:** `routes/api/back-office/shelter/**` (สร้างและ `[code]` PATCH) — ส่ง `site_kind` เข้า invariant (PATCH: ใช้ค่าเดิมของ doc เมื่อ body ไม่ส่ง)
- **Import:** `shelter-import` — ตรวจแถวด้วยกฎเดียวกัน
- **Docs (หลัง approve):** CR-252 เพิ่ม FR, CR-261 FR-5/AC-5/AC-9 ปรับถ้อยคำ, `docs/data/schema.md` หมายเหตุ shelter schema_v 10, แถวใน `_index.md`
- **ไม่กระทบ:** worker, FastAPI, public plane (CR-261 ยังกรองตาม `is_external` เหมือนเดิม)

## 5. Migration

ไม่ bump `schema_v` (ไม่เปลี่ยนรูป doc — เพิ่มกฎ validation เท่านั้น). ไม่ backfill. ก่อน deploy ควรตรวจ staging/prod ว่ามี shelter `is_external = true` + `site_kind = host_house` หรือไม่ (ในเครื่อง dev ไม่มี — `public_shelters` 0 แถว); ถ้ามี ให้ SA เปลี่ยน `site_kind` เอง

## 6. Decision log

- 2026-11-23 — @mhapong: บ้านพี่เลี้ยงไม่มี External; track ด้วย CR file; บังคับทุกทางเข้า
- 2026-11-23 — proposed (ร่าง CR)
