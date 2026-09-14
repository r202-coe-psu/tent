---
id: draft
title: ระบบประเมินความพึงพอใจศูนย์พักพิงและรับข้อความถึงเจ้าหน้าที่ (Shelter Feedback & Rubric Assessment)
status: proposed
date: 2026-09-12
requested_by: Field study / ผู้บริหารศูนย์พักพิง (ผ่าน Jk)
layer: volatile
affects:
  - docs/data/schema.md (เพิ่ม type: feedback_session, feedback_response ใน shelter database)
  - docs/features/shelter-feedback-rubric-spec.md
  - frontend/src/lib/server/shelter-access-design.ts (เพิ่ม feedback_session, feedback_response ใน allowed types ของ buildValidateDocUpdate)
  - frontend/src/lib/server/shelter-access-design.test.ts
  - frontend/scripts/redeploy-access.ts (redeploy _design/access ไปยังฐานข้อมูลรายศูนย์)
  - frontend/src/routes/(protected)/back-office/feedback
  - frontend/src/routes/(public)/shelters/[id]/feedback/[sessionId]
  - frontend/src/routes/api/public/v1/shelters/[id]/feedback
  - frontend/src/routes/api/public/v1/shelters/[id]/feedback/[sessionId]
---

# ระบบประเมินความพึงพอใจศูนย์พักพิงและรับข้อความถึงเจ้าหน้าที่ (Shelter Feedback & Rubric Assessment)

## Why

1. **แก้ปัญหาช่องว่างการสื่อสารหน้างาน:** ผู้ประสบภัยในศูนย์พักพิงต้องการช่องทางสะท้อนปัญหาเฉพาะหน้า (ความสะอาดห้องน้ำ อาหาร ความปลอดภัย) โดยไม่ต้องเผชิญหน้าเจ้าหน้าที่โดยตรง
2. **การวัดผลและปรับปรุงคุณภาพการบริการ:** ผู้บริหารศูนย์และจังหวัดต้องการตัวชี้วัดเชิงปริมาณ (Rubric Score 1-5 ดาว) ใน 4 มิติมาตรฐาน และมีระบบจัดการข้อความ (ยังไม่อ่าน / อ่านแล้ว) พร้อมการส่งออกรายงาน CSV

## Single Source of Truth (SoT) & Requirements Contract

- **เอกสารแม่บท (Single Source of Truth):** เอกสารข้อกำหนดความต้องการเชิงฟังก์ชัน (FR), ข้อกำหนดที่ไม่ใช่เชิงฟังก์ชัน (NFR), สเปกการเชื่อมต่อ API, เกณฑ์การตรวจรับ (Acceptance Criteria: AC) และ Definition of Done (DoD) ทั้งหมด ยึดถือ **[`docs/features/shelter-feedback-rubric-spec.md`](../features/shelter-feedback-rubric-spec.md)** เป็น **Single Source of Truth (SoT)** ฉบับสมบูรณ์
- **หน้าที่ของ Change Record (CR ฉบับนี้):** ทำหน้าที่บันทึกการขออนุมัติและประเมินผลกระทบต่อระบบ (Change Management) ตามมาตรฐาน `docs/change-management.md` โดยสรุปสาระสำคัญตามสัญญา ดังนี้:
  - **Back Office (FR-FB-01 – FR-FB-06):** สร้าง/ปิด Session, พิมพ์โปสเตอร์ A4 QR Code (`window.print()`), แดชบอร์ดสรุปคะแนนเฉลี่ย 4 มิติ, จัดการฟีดข้อความ (Unread/Read), และส่งออก CSV (UTF-8 with BOM) ผ่านหน้า `(protected)/back-office/feedback` (อ้างอิง active shelter จาก `shelterStore`)
  - **Public Web Form (FR-FB-10 – FR-FB-13):** หน้าฟอร์มมือถือ Anonymous by default ไม่เก็บคุกกี้, ให้คะแนน 4 มิติ (Required) + ความคิดเห็นและข้อมูลติดต่อ (Optional), มี Rate limiting (5 reqs / 10 min / IP hash ผ่าน `RateLimiter`) และ Cooldown
  - **CouchDB Access & Security Whitelist (§4.6):** อัปเดต `allowed` types ใน `shelter-access-design.ts` และ redeploy `_design/access` บนฐานข้อมูลศูนย์
  - **เกณฑ์ตรวจรับ (AC-01 – AC-11 & DoD):** ทดสอบครบวงจรตามข้อกำหนด พร้อม Unit Tests สำหรับ Domain, Aggregation, Anti-abuse, `shelter-access-design.test.ts`, และ BFF API Endpoints

## Change

- **Before:** ไม่มีระบบรับฟังความคิดเห็นหรือประเมินความพึงพอใจแบบดิจิทัลในศูนย์พักพิง หากมีการประเมินต้องใช้แบบสอบถามกระดาษ
- **After:**
  - เพิ่ม `type: "feedback_session"` เพื่อให้ Back Office เปิดรอบการประเมินพร้อม Snapshot ของเกณฑ์ Rubric (`rubric_v1`)
  - สร้างระบบพิมพ์โปสเตอร์ A4 QR Code คมชัดสูง ชี้ไปที่ URL เฉพาะของรอบประเมินนั้นๆ (`/shelters/[id]/feedback/[sessionId]`)
  - พัฒนาหน้า Public Mobile Form (Anonymous by default) สำหรับให้คะแนน 4 มิติ (ความสะอาด, อาหารน้ำดื่ม, ความปลอดภัย, การดูแลของเจ้าหน้าที่) + ช่องข้อความ + ช่องข้อมูลติดต่อ optional
  - พัฒนา SvelteKit BFF Endpoints สำหรับดึงข้อมูล Session และบันทึกข้อมูลอย่างปลอดภัย (Rate limit ด้วย `RateLimiter`, Anti-spam, Zod validate) ลงใน CouchDB ประจำศูนย์ (`shelter_{shelter_code}`)
  - เพิ่มแดชบอร์ดสรุปสถิติคะแนนเฉลี่ย, ฟีดข้อความพร้อมสถานะ "ยังไม่อ่าน / อ่านแล้ว", และฟังก์ชันส่งออก CSV ในโมดูล Back Office (`/back-office/feedback`)
  - อัปเดต `buildValidateDocUpdate()` ใน `frontend/src/lib/server/shelter-access-design.ts` เพิ่ม `feedback_session` และ `feedback_response` ใน whitelist allowed types และ redeploy `_design/access` บนฐานข้อมูลรายศูนย์

## Impact

- **Database Schema:** เพิ่ม doc types ใหม่ 2 ตัวใน CouchDB `shelter_{shelter_code}` (Additive, ไม่กระทบเอกสารเดิม):
  - `feedback_session` (schema_v: 1, `_id: "feedback_session:{ulid}"`, `type: "feedback_session"`)
  - `feedback_response` (schema_v: 1, `_id: "feedback_response:{ulid}"`, `type: "feedback_response"`)
- **CouchDB Access Whitelist & Design Documents (`_design/access`):**
  - ไฟล์ `frontend/src/lib/server/shelter-access-design.ts`: ฟังก์ชัน `buildValidateDocUpdate()` ต้องเพิ่ม `'feedback_session'` และ `'feedback_response'` เข้าในรายการ `allowed` types
  - ไฟล์ทดสอบ `frontend/src/lib/server/shelter-access-design.test.ts`: เพิ่มชุดการทดสอบยืนยันสิทธิ์การเขียนเอกสารทั้งสองประเภท
  - **ผลกระทบสำคัญ:** หากไม่เพิ่มลงใน allowlist หรือไม่ได้ redeploy `_design/access` ฝั่ง CouchDB ประจำศูนย์จะปฏิเสธการบันทึกด้วย HTTP 403 (`doc type not allowed yet: <type>`) ทันทีเมื่อมีการบันทึกผ่าน non-admin role / staff session
- **Frontend Paths:**
  - `frontend/src/routes/(protected)/back-office/feedback/+page.svelte` (เชื่อมต่อกับ active shelter ผ่าน `shelterStore`)
  - `frontend/src/routes/(public)/shelters/[id]/feedback/[sessionId]/+page.svelte`
  - `frontend/src/routes/api/public/v1/shelters/[id]/feedback/+server.ts`
  - `frontend/src/routes/api/public/v1/shelters/[id]/feedback/[sessionId]/+server.ts`
  - `frontend/src/lib/features/shelter-feedback/` (domain, UI components, tests)
- **Security & Privacy:**
  - ข้อมูลเป็น Anonymous by default ไม่เก็บ Cookie ติดตามตัวตน
  - Rate limiting ป้องกันสแปมที่ BFF (5 reqs / 10 min / IP hash โดยใช้ `RateLimiter` ที่มีอยู่แล้วใน codebase)
  - Role-Based Access Control (RBAC): สิทธิ์จัดการสงวนไว้เฉพาะ `system_admin` (SA), `shelter_manager` (SM), และ `registration_staff` (RS)

## Migration

- **Data Schema Migration:** N/A (Purely additive doc types ในฐานข้อมูล CouchDB รายศูนย์ ไม่กระทบ existing schemas)
- **Design Document Deployment:** ต้องรัน redeploy `_design/access` บนฐานข้อมูลศูนย์เดิม (`shelter_*`) ทุกแห่งที่มีอยู่แล้วในระบบ ผ่านคำสั่ง `pnpm redeploy:access --write --confirm` (จาก `frontend/`) เพื่อให้ `validate_doc_update` ใช้งาน allowlist ใหม่ สำหรับศูนย์พักพิงที่ถูกสร้างใหม่ (Provisioning) จะได้รับ design doc ฉบับล่าสุดโดยอัตโนมัติ

## Decision log

- 2026-09-12 — Proposed ผ่านกระบวนการ `/grill-me` (Soravit Sukkarn):
  - เคาะ One QR per Session (สร้างรอบใหม่ ได้ QR ใหม่ พิมพ์โปสเตอร์ A4 แผ่นใหม่)
  - เคาะ Versioned Rubric Template (`rubric_v1` 4 มิติ) พร้อมบันทึก Snapshot ไว้ที่ Session
  - เคาะ Anonymous by default + Optional Contact Info + Cooldown/Rate-limit
  - เคาะ Back Office มี Dashboard สรุปคะแนน + รายการข้อความพร้อมสถานะ อ่านแล้ว/ยังไม่อ่าน + Export CSV
- 2026-09-14 — ปรับปรุง Impact Analysis:
  - เพิ่มข้อกำหนด CouchDB Whitelist ใน `shelter-access-design.ts` และการ redeploy `_design/access` ป้องกัน HTTP 403
