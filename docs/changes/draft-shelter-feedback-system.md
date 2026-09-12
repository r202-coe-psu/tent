---
id: draft
title: ระบบประเมินความพึงพอใจศูนย์พักพิงและรับข้อความถึงเจ้าหน้าที่ (Shelter Feedback & Rubric Assessment)
status: proposed
date: 2026-09-12
requested_by: Field study / ผู้บริหารศูนย์พักพิง (ผ่าน Jk)
decided_by: Jk (Project Owner)
layer: volatile
affects:
  - docs/data/schema.md (เพิ่ม doc_type: feedback_session, feedback_response ใน shelter database)
  - docs/features/shelter-feedback-rubric-spec.md
  - frontend/src/routes/(protected)/back-office/shelters/[code]/feedback
  - frontend/src/routes/(public)/shelters/[code]/feedback/[sessionId]
  - frontend/src/routes/api/public/v1/shelters/[code]/feedback
---

# ระบบประเมินความพึงพอใจศูนย์พักพิงและรับข้อความถึงเจ้าหน้าที่ (Shelter Feedback & Rubric Assessment)

## Why
1. **แก้ปัญหาช่องว่างการสื่อสารหน้างาน:** ผู้ประสบภัยในศูนย์พักพิงต้องการช่องทางสะท้อนปัญหาเฉพาะหน้า (ความสะอาดห้องน้ำ อาหาร ความปลอดภัย) โดยไม่ต้องเผชิญหน้าเจ้าหน้าที่โดยตรง
2. **การวัดผลและปรับปรุงคุณภาพการบริการ:** ผู้บริหารศูนย์และจังหวัดต้องการตัวชี้วัดเชิงปริมาณ (Rubric Score 1-5 ดาว) ใน 4 มิติมาตรฐาน และมีระบบจัดการข้อความ (ยังไม่อ่าน / อ่านแล้ว) พร้อมการส่งออกรายงาน CSV

## Change
- **Before:** ไม่มีระบบรับฟังความคิดเห็นหรือประเมินความพึงพอใจแบบดิจิทัลในศูนย์พักพิง หากมีการประเมินต้องใช้แบบสอบถามกระดาษ
- **After:**
  - เพิ่ม `doc_type: "feedback_session"` เพื่อให้ Back Office เปิดรอบการประเมินพร้อม Snapshot ของเกณฑ์ Rubric (`rubric_v1`)
  - สร้างระบบพิมพ์โปสเตอร์ A4 QR Code คมชัดสูง ชี้ไปที่ URL เฉพาะของรอบประเมินนั้นๆ (`/shelters/[code]/feedback/[sessionId]`)
  - พัฒนาหน้า Public Mobile Form (Anonymous by default) สำหรับให้คะแนน 4 มิติ (ความสะอาด, อาหารน้ำดื่ม, ความปลอดภัย, การดูแลของเจ้าหน้าที่) + ช่องข้อความ + ช่องข้อมูลติดต่อ optional
  - พัฒนา SvelteKit BFF Endpoint สำหรับบันทึกข้อมูลอย่างปลอดภัย (Rate limit, Anti-spam, Zod validate) ลงใน CouchDB ประจำศูนย์ (`shelter_<code >`)
  - เพิ่มแดชบอร์ดสรุปสถิติคะแนนเฉลี่ย, ฟีดข้อความพร้อมสถานะ "ยังไม่อ่าน / อ่านแล้ว", และฟังก์ชันส่งออก CSV

## Impact
- **Database Schema:** เพิ่ม doc types ใหม่ 2 ตัวใน CouchDB `shelter_<code >` (Additive, ไม่กระทบเอกสารเดิม):
  - `feedback_session` (schema_v: 1)
  - `feedback_response` (schema_v: 1)
- **Frontend Paths:**
  - `frontend/src/routes/(protected)/back-office/shelters/[code]/feedback/+page.svelte`
  - `frontend/src/routes/(public)/shelters/[code]/feedback/[sessionId]/+page.svelte`
  - `frontend/src/routes/api/public/v1/shelters/[code]/feedback/+server.ts`
  - `frontend/src/lib/features/shelter-feedback/` (domain, UI components, tests)
- **Security & Privacy:**
  - ข้อมูลเป็น Anonymous by default ไม่เก็บ Cookie ติดตามตัวตน
  - Rate limiting ป้องกันสแปมที่ BFF (5 reqs / 10 min / IP hash)

## Migration
- **N/A** (Purely additive doc types ในฐานข้อมูล CouchDB รายศูนย์ ไม่กระทบ existing schemas)

## Decision log
- 2026-09-12 — Proposed ผ่านกระบวนการ `/grill-me` (Jk / Project Owner):
  - เคาะ One QR per Session (สร้างรอบใหม่ ได้ QR ใหม่ พิมพ์โปสเตอร์ A4 แผ่นใหม่)
  - เคาะ Versioned Rubric Template (`rubric_v1` 4 มิติ) พร้อมบันทึก Snapshot ไว้ที่ Session
  - เคาะ Anonymous by default + Optional Contact Info + Cooldown/Rate-limit
  - เคาะ Back Office มี Dashboard สรุปคะแนน + รายการข้อความพร้อมสถานะ อ่านแล้ว/ยังไม่อ่าน + Export CSV
