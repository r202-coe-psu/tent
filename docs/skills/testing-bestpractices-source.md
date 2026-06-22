# Agent Skill Source Log: testing-bestpractices

**Location:** `frontend/.agents/skills/testing-bestpractices/SKILL.md`

ข้อมูลที่นำมาใช้สังเคราะห์เป็นกฎและคำแนะนำในไฟล์ `SKILL.md` มาจากการสืบค้นโครงสร้างโปรเจกต์ ซอร์สโค้ด และเอกสารข้อกำหนด ดังนี้ครับ:

### 1. Framework & Environment
* **แหล่งที่มา**: ไฟล์ `frontend/package.json` และตัวอย่างไฟล์เทสเช่น `repository.test.ts`, `e2e/login.test.ts`
* **ข้อมูลที่พบ**: 
  - โปรเจกต์ใช้ **Vitest** ร่วมกับ `happy-dom` สำหรับทำ Unit & Integration Test
  - ใช้ **Playwright** สำหรับทำ End-to-End Test (E2E)

### 2. Mocking & Isolation (Database + Context)
* **แหล่งที่มา**: โค้ดภายใน `frontend/src/lib/db/repository.test.ts` และ `frontend/src/lib/features/operations/domain/operations.test.ts`
* **ข้อมูลที่พบ**: 
  - การเทสที่เกี่ยวกับฐานข้อมูล จะต้องรันผ่าน `PouchDB` ร่วมกับ `pouchdb-adapter-memory` เพื่อแยกฐานข้อมูลจำลองออกจากกัน ไม่เทสกับ CouchDB จริง 
  - ฟังก์ชันที่มีการปรับปรุงข้อมูลจำเป็นต้องแนบ Mock ของ `AuthorContext` (เช่น `{ shelterCode: 'SH001', createdBy: 'tester' }`)

### 3. Project-Specific Test Requirements (DoD)
* **แหล่งที่มา**: เอกสารในโฟลเดอร์ `docs/task-breakdown/` เช่น `_index.md`, `10-eoc.md`, `11-famsearch.md`, `04-donation.md`
* **ข้อมูลที่พบ**: 
  - มีการกำหนด Standard Definition of Done (DoD) ว่าฟีเจอร์ใหม่ต้องมีเทสเสมอ
  - มีข้อบังคับพิเศษเรื่อง **Security & Privacy** เช่น ต้องเขียนเทสเพื่อยืนยันว่าข้อมูล PII จะไม่หลุดออกไปทาง EOC/Public API (`no-medical/no-national-ID tests`)
  - มีข้อบังคับให้เทสระบบป้องกันภัย **Anti-Enumeration & Rate Limiting** เพื่อไม่ให้ดึงข้อมูลแบบสุ่มได้ 
  - มีคำสั่งให้เทสเรื่อง **Concurrency** บน CouchDB และการทำ Validation อย่างเข้มงวด

ทั้งหมดนี้เพื่อเป็นไกด์ไลน์ให้ Agent เข้าใจมาตรฐานการเขียนเทสและ Context ของเครื่องมือที่ใช้ใน Smart Shelter Project อย่างถูกต้องครับ
