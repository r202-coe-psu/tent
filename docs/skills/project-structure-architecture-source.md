# Agent Skill Source Log: project-structure-architecture

**Location:** `frontend/.agents/skills/project-structure-architecture/SKILL.md`

ข้อมูลที่นำมาใช้สังเคราะห์เป็นกฎและคำแนะนำในไฟล์ `SKILL.md` มาจากการสแกนและวิเคราะห์โครงสร้างโฟลเดอร์จริงของโปรเจกต์ (Reverse Engineering) ดังนี้ครับ:

### 1. Feature-Sliced Design (DDD)
* **แหล่งที่มา**: โครงสร้างโฟลเดอร์ `frontend/src/lib/features/`
* **ข้อมูลที่พบ**: 
  - โปรเจกต์มีการแบ่งโฟลเดอร์ตาม Domain ชัดเจน เช่น `people`, `users`, `operations`, `shelters`
  - ภายในแต่ละ Feature จะถูกบังคับจัดเรียงแบบ Clean Architecture / DDD ประกอบด้วยโฟลเดอร์ `domain/`, `data/`, `application/`, `ui/` และมี `index.ts` ทำหน้าที่เป็น Public API ของโมดูลนั้น

### 2. Separation of Concerns (UI vs Logic vs Server)
* **แหล่งที่มา**: โครงสร้างรวมของ `frontend/src/lib/` และ `frontend/src/routes/`
* **ข้อมูลที่พบ**: 
  - โค้ดที่รันฝั่งเซิร์ฟเวอร์แบบมีสิทธิ์พิเศษ (Privileged) จะถูกแยกเก็บใน `$lib/server/` อย่างเด็ดขาด (เช่น `couch-admin.ts`)
  - โค้ดที่เกี่ยวกับสิทธิ์ (Auth/RBAC) จะรวมศูนย์ที่ `$lib/auth/` และ `$lib/guards/`
  - หน้า UI ภายใต้ `routes/` ทำหน้าที่เป็นเพียงกระดูกสันหลัง (Wiring) ที่ดึงเอา Component จากโฟลเดอร์ Features มาประกอบร่างเท่านั้น ไม่มีการเขียนลอจิกหนักๆ ลงในไฟล์ `+page.svelte` โดยตรง
