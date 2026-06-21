# Agent Skill Source Log: pr-code-review

**Location:** `frontend/.agents/skills/pr-code-review/SKILL.md`

ข้อมูลที่นำมาใช้สังเคราะห์เป็น Checklist และคำแนะนำในไฟล์ `SKILL.md` สำหรับการทำ Code Review มาจากการสืบค้นมาตรฐานและข้อกำหนดของโปรเจกต์ โดยสรุปเป็นหมวดหมู่หลักๆ ดังนี้ครับ:

### 1. Architecture & Data Flow (Offline-First)
* **แหล่งที่มา**: เอกสาร [README.md](../../../README.md), [docs/task-breakdown/_index.md](../task-breakdown/_index.md), สกีมา [docs/data/schema.md](../data/schema.md), และโค้ดใน `frontend/src/lib/db/`
* **ข้อมูลที่พบ**: 
  - โครงการใช้สถาปัตยกรรม Offline-First เป็นหลัก จึงต้องตรวจสอบเสมอว่าโค้ดไม่มีการเรียกฐานข้อมูลตรงๆ แต่ต้องผ่าน `Repository Pattern` เสมอ มีการจัดการ `_rev` อย่างถูกต้องเพื่อกัน 409 Conflict และใช้ `live-query` เพื่อรับข้อมูลที่ sync มาจาก PouchDB
  - มีข้อบังคับเรื่อง **Schema Documentation** หากมีการแก้โครงสร้าง DB จะต้องอัปเดตไฟล์ `schema.md` ควบคู่กันเสมอ

### 2. Security & Access Control
* **แหล่งที่มา**: คู่มือ [docs/create-database.html](../create-database.html), [docs/prd/kickoff.md](../prd/kickoff.md), และ [docs/task-breakdown/10-eoc.md](../task-breakdown/10-eoc.md)
* **ข้อมูลที่พบ**: 
  - มีข้อบังคับเข้มงวดว่าโค้ดที่รันฝั่ง Client ห้ามมีสิทธิ์ระดับ Admin 
  - การจัดการฐานข้อมูลหรือ users ต้องผ่าน `$lib/server/couch-admin.ts` เท่านั้น 
  - กฎด้าน Data Privacy กำหนดว่าข้อมูล 민감 (PII, Medical data, National ID) จะต้องไม่หลุดรอดไปในระบบ EOC หรือ Open API แบบสาธารณะ

### 3. Frontend & Framework Standards
* **แหล่งที่มา**: [README.md](../../../README.md) (หัวข้อ Tech Stack) และบริบทการใช้งานของระบบ (ศูนย์พักพิง)
* **ข้อมูลที่พบ**: 
  - ระบบหน้าบ้านถูกล็อกสเปกให้ใช้ `Svelte 5 (Runes)` ดังนั้นเวลารีวิวโค้ดต้องเช็คการใช้ `$state`, `$derived`, `$effect` ให้ถูกต้อง ไม่ใช้ Syntax เก่า
  - การเขียน CSS ถูกกำหนดให้ใช้ `Tailwind CSS v4` เป็นหลัก และใช้ `shadcn-svelte` เพื่อความสม่ำเสมอของ UI
  - **Accessibility (a11y)**: ระบบมีกลุ่มผู้ใช้ที่หลากหลาย (รวมถึงผู้สูงอายุในศูนย์พักพิง) จึงบังคับให้รีวิวเรื่อง Keyboard navigation, ARIA attributes และ Semantic HTML

### 4. Code Quality & General Principles
* **แหล่งที่มา**: มาตรฐานโปรเจกต์จากเอกสาร [docs/task-breakdown/](../task-breakdown/) และหลักการพัฒนาซอฟต์แวร์สากล
* **ข้อมูลที่พบ**: 
  - **Testing**: การเขียนโค้ดผูกกับ Standard Definition of Done (DoD) ของระบบที่บังคับว่า `UI + data/write path + validation + permission + test` แปลว่าทุก PR โค้ดใหม่ต้องมีเทส (Unit/Integration) เสมอ
  - เพิ่มข้อกำหนดในการรีวิวหลักการ Clean Code, DRY (Don't Repeat Yourself), YAGNI, การจัดการ Error ที่เหมาะสม และการทำ **PR Hygiene** (สแกนหา `console.log` หรือโค้ดขยะที่ลืมลบ)

ทั้งหมดนี้ถูกรวบรวมเพื่อสร้างเป็นระบบตรวจทานโค้ด (PR Code Review) ที่ไม่ได้อิงแค่มาตรฐานทั่วไป แต่เจาะจงตรวจสอบจุดตายสำคัญของ Smart Shelter Project โดยเฉพาะครับ
