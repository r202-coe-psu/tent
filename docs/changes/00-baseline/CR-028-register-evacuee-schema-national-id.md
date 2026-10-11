---
id: CR-028
title: "Evacuee Schema Reconciliation — เปลี่ยน national_id เป็น person_id"
status: approved
date: 2026-07-02
updated: 2026-07-03
requested_by: development team B
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §1.1 — schema_v 2 (reconcile national_id → person_id)
  - docs/data/data-model.md
  - frontend/src/lib/features/people/domain/people.ts
---

# CR-028 — Evacuee Schema Reconciliation (national_id → person_id)

> [!NOTE]
> **สรุป (TL;DR):** ปรับแก้เอกสาร Canonical Schema ของ `evacuee` ให้ตรงกับโค้ดฝั่ง frontend · เปลี่ยนแปลง `national_id` (str) เป็น `person_id` (object: `cardType`, `number`) · schema_v คงที่ระดับ 2 (reconcile) · เพื่อรองรับเอกสารระบุตัวตนหลากหลายประเภท (พาสปอร์ต, บัตรสีชมพู) ของผู้อพยพ และเพิ่ม country ใน spec (data-model.md) เพื่อให้ spec มีความสอดคล้องกันทั้งระบบ

## Why
เนื่องจากในระบบจริงมีความจำเป็นต้องรองรับเอกสารแสดงตนหลายประเภทสำหรับผู้อพยพ (เช่น บัตรประชาชนไทย, พาสปอร์ต, บัตรสีชมพู หรืออื่นๆ) นอกเหนือจากเลขบัตรประชาชนไทย 13 หลัก (`national_id`) เพียงอย่างเดียว ทีมพัฒนาจึงได้ปรับปรุงโครงสร้างข้อมูลใน `people.ts` ให้เก็บข้อมูลแสดงตนผ่านฟิลด์ `person_id` ที่มีโครงสร้างเป็นออบเจกต์ `{ cardType, number }` แทน แต่เนื่องจากเอกสาร `docs/data/schema.md` และเอกสารที่เกี่ยวข้องในฝั่ง Technical Canonical ยังไม่ได้รับการปรับปรุงตามการเปลี่ยนแปลงนี้ จึงทำการเปิด CR เพื่อปรับปรุงเอกสารเหล่านี้ให้มีข้อมูลที่ถูกต้องตรงกับระบบที่พัฒนาจริง

## Change

### 1. Spec ↔ Code Schema Reconciliation
ปรับปรุงคุณสมบัติของ `evacuee` ในเอกสาร:
- นำฟิลด์ `national_id` (str, opt) ออก
- เพิ่มฟิลด์ `person_id` (object, opt) โดยมีโครงสร้างดังนี้:
  - `cardType`: enum(`national_id`, `passport`, `pink_card`, `other`) — บังคับ, ค่าเริ่มต้นเป็น `national_id`
  - `number`: str (opt) — หมายเลขบัตรแสดงตน (ตัดช่องว่างหัวท้าย, เก็บแบบ plaintext ไม่ออก public tier)

### 2. Spec / Diagram Updates
- อัปเดต `docs/data/schema.md` §1.1 (`evacuee` schema)
- อัปเดต `docs/data/data-model.md` (JSON ของ `evacuee`)

## Impact

- `docs/data/schema.md` §1.1 — ปรับข้อมูลตาราง ฟิลด์ `national_id` เป็น `person_id`
- `docs/data/data-model.md` — ปรับโครงสร้างจำลองของ `evacuee`
- `docs/changes/_index.md` — เพิ่มประวัติ Change Record นี้

## Migration
- **schema_v 2 (คงเดิม):** การเปลี่ยนแปลงนี้เกิดขึ้นภายในเวอร์ชัน 2 ของ `evacuee` ในระบบจริงอยู่แล้ว ซึ่งรองรับค่า `person_id` แบบ optional
- สำหรับข้อมูล v1 ดั้งเดิมที่มีเฉพาะ `national_id`: 
  - เมื่อโหลดเอกสารขึ้นมาใช้งาน หากไม่มี `person_id` แต่ต้องการรักษาความต่อเนื่องของข้อมูล ระบบจะถือว่า `person_id` เป็น `{ cardType: 'national_id', number: doc.national_id }` โดยอัตโนมัติ (Backward compatibility)
  - ทั้งนี้ client code ใน `people.ts` ถูกออกแบบมาให้รองรับข้อมูล `person_id` แบบ optional อยู่แล้ว จึงไม่มีความเสี่ยงต่อการพังของระบบ

## Decision log
- 2026-07-02 — proposed
- 2026-07-03 — renumbered CR-027 → **CR-028** (แก้เลขซ้ำกับ CR-027 user/password policy)
- 2026-07-03 — approved
