---
id: CR-026
title: "SOP ratio governance ratification (CR-D2 / T-18.3) — catalog/override scope confirmed + history mechanism ratified"
status: approved
date: 2026-07-01
requested_by: T-18.3 — Drive CR-D2 (development team D)
decided_by: project owner (meeting 2026-07-01; document approved 2026-07-03)
layer: stable
affects:
  - docs/questions/QR-001-T18-Clarification.md — close Q-T18-1 (catalog vs per-shelter)
  - docs/changes/CR-018-sop-override-invariants.md §7 — resolve "version counting method: deferred"
  - docs/changes/CR-006-sop-profile-master-override.md — cross-reference only (no content change)
  - docs/source/handbooks/sop-ratio-reference-table.md — sign-off closed (T-18.5), see decision log
  - schema_v — ไม่ bump (ไม่มี field/shape เปลี่ยน — เอกสารนี้ ratify ของที่มีอยู่แล้ว)
---

# CR-026 — SOP ratio governance ratification (CR-D2 / T-18.3)

**สรุป:** ปิด T-18.3 (Drive CR-D2) — ratify ผลจากที่ประชุม PO (2026-07-01) และอนุมัติเอกสารอย่างเป็นทางการ
(2026-07-03) 2 เรื่อง: (1) โครงสร้างสองชั้น catalog/override ตาม CR-006 (2) กลไกเก็บประวัติการแก้ไข
(`audit` doc type + `version+1`) ที่มีอยู่แล้วในโค้ด — ไม่มีการออกแบบใหม่ ไม่ bump schema_v

## Why

T-18.3 กำหนดว่าต้องปิด 2 decision ก่อน T-30 เริ่มโค้ดได้ (**"ห้ามเริ่มเขียนโค้ด T-30 เด็ดขาด" จนกว่า
CR-D2 ปิด**): (1) แก้ ratio ได้แค่ catalog หรือแยกรายศูนย์ (2) กลไกเก็บประวัติแบบไหน

ตรวจสอบพบว่าทั้ง 2 เรื่องมีคำตอบอยู่แล้วในทางปฏิบัติ — CR-006 ออกแบบ two-tier ไปแล้ว และโค้ดมีกลไก
`audit` doc type + `version: prev.version + 1` (monotonic) ใช้งานอยู่แล้วใน
`frontend/src/lib/features/sop-ratios/domain/sop-ratio.ts` (`createNewVersion`/
`createInitialProfile`) แต่ยังไม่เคยมี CR ใดที่ **ratify เป็นทางการ** — CR-018 ข้อ 7 ยังเขียนว่า
"วิธีนับ version = deferred" ทั้งที่โค้ดตอบแล้ว และ `QR-001` Q-T18-1 ยังค้าง mark `⏳ WAITING on PO`

เอกสารนี้ปิดช่องว่างนั้น โดยให้ PO รับทราบ/ยืนยันสิ่งที่มีอยู่แล้วอย่างเป็นทางการ

## Decision 1 — Catalog vs per-shelter (ratified)
PO ยืนยันแนวทางตาม [CR-006](CR-006-sop-profile-master-override.md) ในที่ประชุม 2026-07-01 —
สองชั้น:
- **Master** (`sop_profile`, catalog) — `system_admin` แก้; เป็นค่าตั้งต้นของทุกศูนย์
- **Override** (`sop_override`, `shelter_*`) — `shelter_manager` แก้เฉพาะศูนย์ตัวเอง; resolve =
  `override active ?? master`

ไม่มีการเปลี่ยนแปลงจาก CR-006 — เอกสารนี้แค่ปิด loose end ที่ `QR-001` Q-T18-1 ค้างไว้

## Decision 2 — History mechanism (ratified)

**ผลการประชุม PO (2026-07-01, ยืนยันด้วยวาจา; ratified ในเอกสาร 2026-07-03):** ยืนยันแนวทางที่ระบบรองรับอยู่แล้ว
ให้ใช้เป็นมาตรฐานของงาน SOP ratio ต่อไป:

- **`audit` doc type** (`docs/data/schema.md §2.12`, append-only, ใช้ร่วมกับทั้งระบบ) — บันทึก
  `action`, `target_type/target_id`, `reason`, `context`, `occurred_at` ทุกครั้งที่มีการแก้ไข
- **`version: prev.version + 1`** (monotonic integer) — สร้าง version ใหม่ทุกครั้งที่แก้ (ไม่ mutate
  ของเดิม), deactivate version ก่อนหน้า
- Implementation: `createNewVersion()` / `createInitialProfile()` ใน
  `frontend/src/lib/features/sop-ratios/domain/sop-ratio.ts` เขียน profile ใหม่ + audit entry
  แบบ atomic ผ่าน `sop-ratio.pouch.ts`

**ปิด CR-018 ข้อ 7:** "`version` ต้องเพิ่มแบบ monotonic; วิธีนับ (จำนวนเต็ม/อื่น) = deferred" →
resolved เป็น integer เรียง `prev.version + 1` ตามที่ implement จริง (ดู Impact §CR-018)

## Impact

- **`docs/questions/QR-001-T18-Clarification.md`:** อัปเดตแถว Q-T18-1 ในตาราง "สรุปสถานะ" จาก
  `⏳ รอ PO confirm` → `✅ RESOLVED → CR-006` (sync สถานะให้ตรงกับ CR-006 approved — ไม่ใช่ spec
  change ใหม่); ratified ซ้ำโดย CR-026 approved
- **`docs/changes/CR-018-sop-override-invariants.md` §7:** cross-reference ไปยัง CR-026 —
  วิธีนับ version = `prev.version + 1` (resolved, ไม่ deferred อีกต่อไป) — ไม่แตะ requirement อื่น
- **`docs/source/handbooks/sop-ratio-reference-table.md`:** sign-off ปิดแล้ว (T-18.5) — ดู decision
  log ในไฟล์นั้น (ไม่ใช่ผลจาก CR นี้โดยตรง แต่ปิดพร้อมกันในการประชุมเดียวกัน)
- **T-30:** ปลดล็อกแล้ว — เริ่มโค้ด T-30 (SOP ratio configuration UI) ได้ตั้งแต่ CR-026 approved
  (2026-07-03)
- **schema_v:** ไม่ bump — ไม่มี field/shape ของ `sop_profile`/`sop_override`/`audit` เปลี่ยนแปลง
  เอกสารนี้เป็นการ ratify governance เท่านั้น

## Migration

N/A — ไม่เปลี่ยนรูป doc ใดๆ

## Decision log

- 2026-07-01 — proposed: T-18.3 ตรวจพบว่าทั้ง 2 decision มีคำตอบอยู่แล้วในโค้ด/CR-006 เสนอให้ PO
  ratify เป็นทางการแทนการเปิดถามใหม่ (ผ่านเอกสารเตรียมประชุม
  `docs/questions/PO-meeting-2026-07-01-sop-ratio.md`)
- 2026-07-01 — PO ยืนยันแนวทางทั้ง decision 1 และ decision 2 ด้วยวาจาในที่ประชุม ไม่มีการปรับแก้
  แนวทางที่เสนอ
- 2026-07-03 — **approved:** PO review และอนุมัติเอกสาร CR-026 อย่างเป็นทางการ — T-18.3 (CR-D2) ปิด;
  T-30 ปลดล็อก
