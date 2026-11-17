---
id: CR-258
title: คืน triage เขียว / เหลือง / แดง ใน Station 2 + แนะนำโซนจากสี
status: approved
date: 2026-11-17
updated: 2026-11-17
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/changes/00-baseline/CR-072-triage-green-yellow-red.md (superseded → reinstated โดย CR นี้)
  - docs/changes/00-baseline/CR-106-decoupled-registration-medical-screening-flow.md (FR-07, FR-12, §3.2 — ยกเลิกเฉพาะส่วนตัด triage ของ amendment 2026-09-07)
  - docs/data/schema.md §1.5 screening (`triage_level` เลิก deprecated; schema_v คง 2)
  - docs/task-breakdown/02-people.md (T-74)
  - frontend/src/lib/features/people/domain (screeningInputSchema, createScreening, recommendZoneKind)
  - frontend/src/lib/features/people/ui (TriageBadge, zone-selection-fields)
  - frontend/src/routes/(protected)/onsite/medical-screening/
  - frontend/src/routes/(protected)/onsite/zoning/
---

# CR-258 — คืน triage เขียว / เหลือง / แดง ใน Station 2 + แนะนำโซนจากสี

## สรุป (TL;DR)

- ฟอร์มคัดกรอง Station 2 กลับมามีตัวเลือก **ระดับความเร่งด่วน เขียว / เหลือง / แดง** (`screening.triage_level`) ค่าเริ่มต้นเขียว
- คิว Station 2 (ตรวจแล้ว), คิว Station 3 และหน้าจัดโซน Station 3 แสดง badge สี
- Station 3 แนะนำ **โซนกักตัว** เมื่อมีอาการ EWAR **หรือ** triage เหลือง/แดง
- ไม่ bump `schema_v` — `triage_level` มีอยู่แล้วใน `screening` schema_v 2

## Why

เจ้าของโครงการต้องการให้ Station 2 จัดระดับความเร่งด่วนเป็นสีอีกครั้ง หลังตัดออกใน CR-106 amendment 2026-09-07 (CR-072 superseded).

## Change

| รายการ | ก่อน (CR-106 2026-09-07) | หลัง |
| --- | --- | --- |
| ฟอร์ม Station 2 | ไม่มี triage | มีตัวเลือก เขียว / เหลือง / แดง (บังคับมีค่า, ค่าเริ่มต้น `green`) |
| `screening.triage_level` | deprecated — ห้ามเขียนใหม่ | เขียนได้ (`green` \| `yellow` \| `red`), optional ใน input schema |
| คิว / หน้า Station 3 | badge EWAR เท่านั้น | badge EWAR + badge สี triage |
| `recommendZoneKind` | EWAR → quarantine | EWAR **หรือ** triage `yellow`/`red` → quarantine; ไม่งั้น VG/special needs → vulnerable; ไม่งั้น general |
| vitals / อุณหภูมิ / หมู่เลือด / `needs_referral` | ตัด | **ยังตัดเหมือนเดิม** |

### Requirements

- **FR-01** — ฟอร์ม Station 2 ต้องมี section ระดับความเร่งด่วน 3 ตัวเลือก: เขียว (อาการทั่วไป), เหลือง (เฝ้าระวัง / อาการปานกลาง), แดง (เร่งด่วน / วิกฤต)
- **FR-02** — คนที่ยังไม่เคยคัดกรอง: ค่าเริ่มต้น = `green`. คนที่เคยคัดกรอง: prefill จาก `triage_level` ของ screening ล่าสุด (ไม่มีค่า → `green`)
- **FR-03** — บันทึกแล้ว screening doc ใหม่ต้องมี `triage_level`
- **FR-04** — เลือกสีต้อง **ไม่** เปลี่ยน `care_track` หรือ field อื่นอัตโนมัติ (ต่างจาก UI ก่อน 2026-09-07 ที่ เหลือง/แดง → fast_track, แดง → ส่งต่อ)
- **FR-05** — สรุปหลังบันทึก Station 2 แสดงสี triage
- **FR-06** — คิว Station 2 แท็บ "ตรวจแล้ว", คิว Station 3 (การ์ดมือถือ + ตาราง) และหน้า `/onsite/zoning/[id]` แสดง badge สีจาก screening ล่าสุด; screening ที่ไม่มี `triage_level` ไม่แสดง badge
- **FR-07** — `recommendZoneKind` คืน `quarantine` เมื่อ EWAR ไม่ว่าง หรือ triage `yellow`/`red`
- **FR-08** — ข้อความแนะนำโซนกักตัวต้องไม่อ้าง EWAR เป็นเหตุผลเดียว

### Acceptance / DoD

- [ ] Station 2 เปิดคนใหม่ → เขียวถูกเลือกอยู่; เปลี่ยนสีแล้วออกจากหน้า → ถามยืนยัน (dirty)
- [ ] บันทึกเหลือง ไม่ติ๊ก EWAR, ไม่มี VG → Station 3 แนะนำโซนกักตัว
- [ ] บันทึกเขียว ไม่ติ๊ก EWAR, มี VG → แนะนำโซนกลุ่มเปราะบาง
- [ ] Screening เก่าที่ไม่มี `triage_level` → ไม่มี badge, แนะนำโซนเหมือนเดิม
- [ ] ไม่มี vitals / อุณหภูมิ / หมู่เลือด / referral toggle กลับมาในฟอร์ม
- [ ] unit tests domain (`recommendZoneKind`, `createScreening`) + render test ฟอร์ม Station 2 ผ่าน

## Impact

- Domain: `screeningInputSchema` + `createScreening` รับ/stamp `triage_level`; `recommendZoneKind(evacuee, { symptoms, triage })`
- UI: `TriageBadge` (people barrel), `clinical-screening-form.svelte`, หน้าคิว/รายละเอียด Station 2-3, `zone-selection-fields.svelte`
- M5 referral (D13) ตั้งค่าเริ่มต้น `acuity` จาก `triage_level` ล่าสุด — screening ใหม่ทุกตัวมีสี (อย่างน้อย `green` จากค่าเริ่มต้น) ฟอร์มส่งต่อของคนที่คัดกรองหลังจากนี้จึงเริ่มที่ acuity เขียว แม้เจ้าหน้าที่ไม่ได้เปลี่ยนสีที่ Station 2 (เดิมคนที่คัดกรองช่วง 2026-09-07 → 2026-11-17 ไม่มีค่า เจ้าหน้าที่เลือก acuity เอง)
- เกณฑ์ทางการแพทย์ของแต่ละสี (D-TRIAGE-RULES ใน CR-072) ยังไม่ล็อก — ระบบเก็บสีตามที่เจ้าหน้าที่เลือก ไม่คำนวณอัตโนมัติ

## Migration

ไม่ bump `schema_v`. `screening` schema_v 2 มี `triage_level` อยู่แล้ว (`enum | null`, optional). Doc ที่บันทึกช่วง 2026-09-07 → วันนี้ไม่มี field นี้ = อ่านเป็น "ไม่ระบุ" ไม่ backfill.

## Decision log

- 2026-11-17 — proposed. เจ้าของโครงการเลือก: track ด้วย CR ใหม่; สโคป = ฟอร์ม + badge + แนะนำโซน; ค่าเริ่มต้นเขียว
- 2026-11-17 — **approved** โดยเจ้าของโครงการ รวม FR-04 (เลือกสีไม่เปลี่ยน `care_track` / สถานะส่งต่ออัตโนมัติ)
