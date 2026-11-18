---
id: draft
title: หน้า public /shelters ไม่แสดงบ้านพี่เลี้ยงที่ไม่ใช่ External (ถอดสวิตช์ "บ้านพี่เลี้ยง" ออกจากตัวกรองประเภท)
status: proposed
date: 2026-11-18
requested_by: "GitHub #1419 (ทีม — Before Floods)"
decided_by: รอ approve (Team Lead)
layer: volatile
affects:
  - docs/changes/00-baseline/CR-067-shelter-site-kind.md (Phase 1: "Public map: ไอคอนศูนย์ ≠ ไอคอนบ้านพี่เลี้ยง" — แก้เฉพาะหน้า /shelters)
  - docs/data/schema.md — ไม่เปลี่ยนรูป doc; schema_v — ไม่เปลี่ยน
  - docs/data/api-contract.md — ไม่เปลี่ยน (`GET /public/v1/shelters` ยังคืนบ้านพี่เลี้ยงตามเดิม; กรองฝั่ง client)
  - frontend/src/routes/(public)/shelters/+page.ts (กรองกลุ่ม `host_house` ออกเสมอ, เลิก echo `hide_host_house`)
  - frontend/src/lib/features/public-portal/domain/site-kind.ts (`SHELTER_GROUP_HIDE_PARAMS`, `hiddenShelterGroups`)
  - frontend/src/lib/features/public-portal/ui/shelter-filter-panel.svelte (ถอดสวิตช์ "บ้านพี่เลี้ยง")
  - frontend/src/lib/constants/i18n/public-filter-panel.ts (`groupHostHouse`)
  - frontend/src/routes/(public)/shelters/page.test.ts, frontend/src/lib/features/public-portal/domain/site-kind.test.ts, frontend/e2e/public-shelters-filter.test.ts
---

# หน้า public `/shelters` ไม่แสดงบ้านพี่เลี้ยงที่ไม่ใช่ External

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** หน้า public `/shelters` (ฝั่งผู้อพยพ) ไม่แสดงบ้านพี่เลี้ยงที่ไม่ใช่ External อีกต่อไป ทั้งรายการ แผนที่ ตัวเลขสรุป และตัวกรอง; ถอดสวิตช์ "บ้านพี่เลี้ยง" ออกจากตัวกรอง "ประเภทศูนย์พักพิง"
> - **ทำไม:** ข้อเสนอของทีมใน #1419 (Before Floods); ย้อนข้อกำหนดเดิมของ CR-067 ที่ให้ public map แสดงไอคอนบ้านพี่เลี้ยงแยกจากศูนย์ และสวิตช์ที่เพิ่งเพิ่มใน #1417
> - **Dev ต้อง build:** กรองกลุ่ม `host_house` ออกเสมอใน `shelters/+page.ts`, เลิกรับ/ส่งกลับ `hide_host_house`, ถอดสวิตช์และข้อความ `groupHostHouse`, ปรับเทสต์ (unit + e2e)
> - **กระทบ:** เฉพาะ UI หน้า `/shelters` — ไม่เปลี่ยน schema / `schema_v` / API / หลังบ้าน; ศูนย์ External ที่เป็นบ้านพี่เลี้ยงยังแสดงเป็นกลุ่ม "ภายนอก"

---

## 1. Requirements

| ID   | Requirement |
| ---- | ----------- |
| FR-1 | หน้า `/shelters` ต้องไม่แสดงศูนย์ที่ `shelterGroup = host_house` (ไม่ใช่ External และ `site_kind = host_house`) ในรายการ ในแผนที่ (หมุดศูนย์และหมุดจอดรถของศูนย์นั้น) และในการ์ดสรุป ไม่ว่า URL จะมี query ใด |
| FR-2 | ตัวเลขสรุป (`shelters_total`, `shelters_open`, `counts_by_site_kind`) ต้องคำนวณจากรายการหลังตัดบ้านพี่เลี้ยงออก; การ์ดประเภทสถานที่ไม่แสดงบ้านพี่เลี้ยงที่ถูกซ่อน |
| FR-3 | ตัวกรอง "ประเภทศูนย์พักพิง" เหลือ 2 สวิตช์: "ศูนย์อพยพ" และ "ศูนย์อพยพภายนอก"; ต้องไม่มีสวิตช์ "บ้านพี่เลี้ยง" |
| FR-4 | `hide_host_house` ใน URL (ลิงก์หรือบุ๊กมาร์กเก่าจาก #1417) ถูกเมินและไม่ถูกส่งกลับใน `filters`; `hide_evacuation` และ `hide_external` ทำงานตามเดิม |
| FR-5 | ศูนย์ External ที่ `site_kind = host_house` ยังแสดงเป็นกลุ่ม "ภายนอก" ตามเดิม (กรองได้ด้วย `hide_external`) |
| FR-6 | ขอบเขตจำกัดที่หน้า `/shelters` เท่านั้น: `GET /public/v1/shelters`, หน้า `/shelters/[id]`, ฟอร์มลงทะเบียนล่วงหน้า, หน้าบริจาค, หน้าค้นหาผู้พักพิง, หน้าแรก และหลังบ้าน ไม่เปลี่ยน |

## 2. Acceptance

- **AC-1** ข้อมูลมีศูนย์อพยพ 1, บ้านพี่เลี้ยง (ไม่ใช่ External) 1, ศูนย์ External 1 → `/shelters` แสดง 2 รายการ (ศูนย์อพยพและ External) ไม่มีบ้านพี่เลี้ยงทั้งในรายการและบนแผนที่
- **AC-2** `shelters_total` เท่ากับจำนวนที่แสดง และไม่นับบ้านพี่เลี้ยงที่ซ่อน; การ์ดประเภทสถานที่ไม่มี "บ้านพี่เลี้ยง" เมื่อมีแต่บ้านพี่เลี้ยงที่ซ่อน
- **AC-3** ตัวกรอง "ประเภทศูนย์พักพิง" มีสวิตช์เพียง 2 ตัว
- **AC-4** เปิด `/shelters?hide_host_house=on` ได้ผลเหมือนไม่มี param (ไม่ error ไม่ echo)
- **AC-5** ศูนย์ External ที่ `site_kind = host_house` ยังแสดง และหายเมื่อเปิด `hide_external=on`
- **AC-6** parking pin ของบ้านพี่เลี้ยงที่ซ่อนไม่ขึ้นบนแผนที่ (หมุดจอดรถตามผลลัพธ์ที่แสดง, CR-253 FR-30)
- **AC-7** `/shelters/<id>` ของบ้านพี่เลี้ยงยังเปิดได้ด้วยลิงก์ตรงตามเดิม

## 3. Why

- ที่มา: #1419 ข้อ "ไม่แสดงบ้านพี่เลี้ยงในฝั่งผู้อพยพ" (ทีม — Before Floods) โดยไม่ระบุเหตุผลเพิ่ม
- ตัดสินใจ (owner, 2026-11-18): ซ่อนเฉพาะบ้านพี่เลี้ยงที่ไม่ใช่ External; ติดตามด้วย CR file
- ย้อน CR-067 Phase 1 บรรทัด "Public map: ไอคอนศูนย์ ≠ ไอคอนบ้านพี่เลี้ยง" เฉพาะหน้า `/shelters` และถอดสวิตช์ที่ #1417 เพิ่ม (#1417 ไม่มี CR แยก)
- กรองฝั่ง client ใน `load` เหมือนสวิตช์ `hide_*` เดิม ไม่เพิ่มตัวกรองที่ FastAPI — ลดผลกระทบและคง API สาธารณะเดิมให้ผู้ใช้อื่น (เช่นหน้าอื่นที่ยังใช้ข้อมูลบ้านพี่เลี้ยง)
- ชั้น `volatile`: เปลี่ยนการแสดงผลฝั่ง client เท่านั้น ไม่แตะ auth / sync / schema

## 4. Impact

- `frontend/src/routes/(public)/shelters/+page.ts` — กรอง `shelterGroup(s) === 'host_house'` ออกเสมอ (ก่อนคำนวณ summary); ลบ `hide_host_house` ออกจาก `filters`
- `frontend/src/lib/features/public-portal/domain/site-kind.ts` — ลบ `hide_host_house` ออกจาก `SHELTER_GROUP_HIDE_PARAMS` (หรือแยกค่าคงที่ "กลุ่มที่ไม่แสดงในหน้า public"); `shelterGroup` คงเดิม
- `frontend/src/lib/features/public-portal/ui/shelter-filter-panel.svelte`, `frontend/src/lib/constants/i18n/public-filter-panel.ts` — ถอดสวิตช์และ `groupHostHouse`
- เทสต์: `shelters/page.test.ts`, `site-kind.test.ts`, `e2e/public-shelters-filter.test.ts` (ลบกรณี `hide_host_house`, เพิ่มกรณีซ่อนเสมอและ External host house)
- ผลต่อผู้ใช้: ผู้ใช้ที่เคยกดสวิตช์ "บ้านพี่เลี้ยง" จะเห็นว่าสวิตช์หาย; ลิงก์ที่มี `hide_host_house=on` ยังเปิดได้

## 5. Migration

N/A — ไม่เปลี่ยนรูป doc ที่ persist, ไม่ bump `schema_v`, ไม่ต้อง redeploy `_design/access`

## 6. Decision log

- 2026-08-13 — CR-067 (approved) ให้ public map แสดงไอคอนบ้านพี่เลี้ยงแยกจากศูนย์ (อ้างอิงบรรทัดใน CR-067 Phase 1)
- 2026-11-18 — owner ตัดสิน: ซ่อนเฉพาะบ้านพี่เลี้ยงที่ไม่ใช่ External; ติดตามด้วย CR file
- 2026-11-18 — proposed (ร่าง CR จาก #1419 ข้อ 3)
