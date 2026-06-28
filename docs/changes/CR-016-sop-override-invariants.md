---
id: CR-016
title: "SOP master/override invariants and resolve semantics"
status: proposed
date: 2026-06-27
requested_by: development team D
decided_by: project owner
layer: stable         
affects:
  - docs/data/schema.md §4.2.2 — ratios partial (master) vs full-replacement (override) semantics
  - docs/data/schema.md §4.4.1 — resolve invariants (active uniqueness, base_profile lineage, no-active fallback)
  - docs/data/schema.md §8 — validation rules: master/override write + active≤1 + no-delete-referenced
  - schema_v — ไม่ bump (ไม่เปลี่ยน field/shape ของ sop_profile/sop_override)
  - SOP ratio resolution layer + validation layer
  - implementation (T-30/T-31)
---

# CR-016 — SOP master/override invariants and resolve semantics

**สรุป:** กำหนด invariant ของ `sop_profile` (master) / `sop_override` ที่ CR-006 วางโครงไว้แต่ไม่ได้เขียน
lifecycle ให้ครบ (เขียน/แก้/ลบ/resolve). ไม่เปลี่ยน field → **ไม่ bump schema_v**. กระทบ schema.md
§4.2.2/§4.4.1/§8 + validation layer.

> **ยึดตาม [CR-006](CR-006-sop-profile-master-override.md):** invariant ทั้งหมดอ้าง ratio model ของ
> CR-006 — `canonical key` / `whitelist` ในเอกสารนี้ = **20 keys + `SOP_RATIO_KIND`** ตาม CR-006
> §"Canonical 20 keys". CR นี้เพิ่มเฉพาะ lifecycle/semantics ไม่เปลี่ยนชุดคีย์

## Why

CR-006 กำหนดโครงสองชั้น master/override + 20 canonical keys แต่ไม่ได้ระบุ lifecycle ให้ครบ —
uniqueness ของ active override, ความสัมพันธ์ override→master, พฤติกรรมเมื่อไม่มี active master,
และความครบของ ratios ตอนแก้. ช่องว่างนี้ทำให้ implement ตีความต่างกันได้ (เช่น แก้ override บางคีย์
ทำให้ snapshot ไม่ครบ → คำนวณผิด).

## Change

### Requirements (invariant)

- **INV-1** — `sop_override.ratios` ต้องเป็น complete snapshot ครบทุก canonical key; การแก้ override =
  ส่งทั้ง document (full replacement) — ปฏิเสธ partial patch
- **INV-2** — `sop_profile` (master) แก้แบบ partial ได้ (≥1 key); `ratios = {}` (ว่าง) → reject;
  key นอก whitelist → reject
- **INV-3** — ต่อ 1 `shelter_code` มี `sop_override` ที่ `active = true` ได้ไม่เกิน 1 ตัว (logical
  invariant; การบังคับด้วย index/transaction = deferred)
- **INV-4** — `sop_override.base_profile_id` immutable หลัง create; ตรวจ referential integrity ตอน create
  (master ที่อ้างต้องมีอยู่)
- **INV-5** — ปฏิเสธการลบ master `sop_profile` ที่ยังถูก `sop_override.base_profile_id` อ้างถึง
- **INV-6** — resolve effective profile = `active override ?? active master`; ไม่มี active master →
  คืนสถานะ `no_effective_profile` (ไม่ throw / ไม่ crash)
- **INV-7** — `version` ต้องเพิ่มแบบ monotonic; วิธีนับ (จำนวนเต็ม/อื่น) = deferred

### Acceptance

- override ที่ส่ง `ratios` ไม่ครบทุก key → reject; ครบ → accept
- partial patch บน override → reject; partial patch (บาง key) บน master → accept
- ตั้ง `active = true` ให้ override ตัวที่ 2 ของ shelter เดิม → reject
- ลบ master ที่มี override อ้างถึง → reject
- มี active override และ active master พร้อมกัน → resolve = override (override ชนะ)
- ไม่มี active master → resolve = `no_effective_profile` โดยไม่ error

## Impact

- **Docs:** schema.md §4.2.2 (semantics), §4.4.1 (resolve invariants), §8 (validation rules)
- **Stable core:** INV-3/INV-4/INV-5 ต้องถูก enforce ผ่าน validation layer ที่เลือกตอน implement
  (`validate_doc_update` = preferred location) — ไม่ล็อก architecture; การ enforce active-uniqueness
  ด้วย index/transaction (INV-3) = deferred (T-31)
- **Resolution + validation layer:** resolve precedence + invariant checks + test ครอบ Acceptance
- **schema_v:** ไม่ bump (ไม่เปลี่ยน field/shape)

## Migration

N/A — ไม่เปลี่ยนรูป doc

## Decision log

- 2026-06-27 — proposed; anchored to CR-006 (20-key canonical ratio model) — ไม่เปลี่ยนชุดคีย์, เพิ่มเฉพาะ invariant/semantics
