# Agent Skill Source Log: couchdb-bestpractices

**Location:** `frontend/.agents/skills/couchdb-bestpractices/SKILL.md`

ข้อมูลที่นำมาใช้สังเคราะห์เป็นกฎและคำแนะนำในไฟล์ `SKILL.md` มาจากการสืบค้นเอกสารและซอร์สโค้ดในระบบก่อนหน้านี้ครับ โดยได้ดึงเอา Best Practices ที่ถูกกำหนดไว้แล้วในโปรเจกต์ มาสรุปเป็น 6 Core Principles ดังนี้ครับ:

### 1. Remote-First Endpoint Policy และ Topology (ข้อ 1 และ 2)
* **แหล่งที่มา**: [README.md](../../../README.md) และ [docs/task-breakdown/_index.md](../task-breakdown/_index.md)
* **ข้อมูลที่พบ**: topology ปรับเป็น remote-first โดย app ส่ง write ไป active endpoint เดียว (central ปกติ, edge เฉพาะ WAN outage) และไม่ใช้ local-only write queue เป็น canonical path

### 2. Repository Pattern (ข้อ 2 และ Workflow ข้อ 2)
* **แหล่งที่มา**: คอมเมนต์ในไฟล์ [frontend/src/lib/features/people/data/people.pouch.ts](../../../frontend/src/lib/features/people/data/people.pouch.ts) และ [frontend/src/lib/db/repository.ts](../../../frontend/src/lib/db/repository.ts)
* **ข้อมูลที่พบ**: โค้ดระบุว่าฟีเจอร์ต่างๆ ห้ามเรียก PouchDB โดยตรง แต่จะต้องสร้าง Repository pattern โดยสืบทอดมาจาก base `createRepository` เพื่อเป็นตัวครอบการทำงาน (Abstraction layer)

### 3. Live Update / Invalidation Pattern (ข้อ 7)
* **แหล่งที่มา**: ไฟล์ [frontend/src/lib/db/live-query.ts](../../../frontend/src/lib/db/live-query.ts)
* **ข้อมูลที่พบ**: แนวทาง reactivity ของระบบต้องไม่พึ่ง polling เป็น default และต้อง align กับกลไก invalidation/live update ที่ทีมตกลงเป็น canonical

### 4. MVCC and `_rev` (ข้อ 5 และ Workflow ข้อ 3)
* **แหล่งที่มา**: คู่มือ [docs/create-database.html](../create-database.html) (หัวข้อ เรื่อง _rev — กฎเหล็ก)
* **ข้อมูลที่พบ**: ระบุว่าระบบจัดการเอกสารของ CouchDB ใช้ MVCC การอัปเดตหรือลบเอกสารจะต้องมีค่า `_rev` (Revision) ล่าสุดส่งไปด้วยเสมอ หากไม่ส่งหรือส่งเลขเก่าไปจะเจอกับ Error 409 Conflict จึงตั้งเป็นกฎว่าต้อง GET เอา `_rev` ปัจจุบันออกมาก่อนอัปเดตเสมอ

### 5. Admin Operations (ข้อ 6 และ Workflow ข้อ 4)
* **แหล่งที่มา**: คู่มือ [docs/create-database.html](../create-database.html) (หัวข้อ ก่อนเริ่ม — Admin Client)
* **ข้อมูลที่พบ**: ระบุคำเตือนสำคัญว่า "ทุก privileged call (เช่น การสร้าง DB, จัดการ users, จัดการสิทธิ์ `_security`) ต้องผ่าน admin client ฝั่ง server เท่านั้น เพื่อไม่ให้รหัสผ่านแอดมินหลุดไปฝั่งเบราว์เซอร์" โดยบังคับให้เรียกใช้งานผ่านฟังก์ชัน `adminRaw` หรือ `adminFetch` จาก `$lib/server/couch-admin.ts`

### 6. Workflow การพัฒนา (Workflow ข้อ 1)
* **แหล่งที่มา**: [docs/data/schema.md](../data/schema.md) และเอกสาร Task Breakdown
* **ข้อมูลที่พบ**: ระบุว่า `schema.md` คือ Technical Source หลักของโปรเจกต์ เมื่อจะเพิ่มฟีเจอร์ใดๆ ก็ตาม ให้เริ่มต้นจากการกำหนดและแก้ไขโครงสร้างข้อมูลในไฟล์สกีมาให้เรียบร้อยก่อนลงมือเขียนโค้ด

### 7. Code Patterns (ตัวอย่างโค้ด Do / Don't)
* **แหล่งที่มา**: โค้ดตัวอย่างในคู่มือ [docs/create-database.html](../create-database.html) (ฟังก์ชันอย่าง `grantNotesAccess()` และการเรียก `adminRaw`), รวมถึงรูปแบบของ [svelte-core-bestpractices](../../frontend/.agents/skills/svelte-core-bestpractices/SKILL.md)
* **ข้อมูลที่พบ**: 
  - ตัวอย่างการเขียน Repository Pattern จำลองมาจากการเรียกใช้โค้ดจริงใน `frontend/src/lib/features/people/data/people.pouch.ts`
  - ตัวอย่างการทำ Read-Modify-Write สำหรับเอกสารทั่วไปและ `_security` จำลองมาจากโค้ดฝั่ง Server-side (`couch-admin.ts`) ในคู่มือฐานข้อมูล

ทั้งหมดนี้คือที่มาของการตั้งกฎใน Skill เพื่อให้ Agent (หรือ Developer) ในอนาคตที่เข้ามาทำงานเกี่ยวกับ Database ในโปรเจกต์นี้ ปฏิบัติตามโครงสร้างที่ระบบถูกออกแบบไว้ตั้งแต่ต้นครับ
