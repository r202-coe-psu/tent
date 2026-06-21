# Agent Skill Source Log: security-rbac-bestpractices

**Location:** `frontend/.agents/skills/security-rbac-bestpractices/SKILL.md`

ข้อมูลที่นำมาใช้สังเคราะห์เป็นกฎและคำแนะนำในไฟล์ `SKILL.md` มาจากการสืบค้นเอกสารและโค้ดของระบบ ดังนี้ครับ:

### 1. Role-Based Access Control (RBAC)
* **แหล่งที่มา**: เอกสาร `docs/prd/role-permission-matrix.md`, โค้ด `frontend/src/lib/auth/roles.ts` และเอกสารการแก้โครงสร้าง `docs/changes/CR-002-registration-staff-affiliation-tags.md`
* **ข้อมูลที่พบ**: 
  - ระบบลดความซับซ้อนของ Role จาก 12 เหลือ 5 บทบาทหลัก (System Admin + 4 Shelter Staffs)
  - Role จะถูกเก็บในรูปแบบของ Array คู่กันคือ `["shelter:{code}", "capability"]` 
  - มีคำเตือนเรื่อง CR-002 ว่า **RoleKey ที่ถูกต้องคือ `registration_staff` ห้ามใช้คำว่า `volunteer` ในการเช็คสิทธิ์ (RBAC) เด็ดขาด** เพราะคำว่า volunteer ถูกย้ายไปเป็นเพียง Affiliation tag แล้ว

### 2. Shelter Scope Isolation
* **แหล่งที่มา**: เอกสาร `docs/prd/kickoff.md` และลอจิกจาก `couch-admin.ts`
* **ข้อมูลที่พบ**: 
  - ระบบทำงานแบบ Multi-tenant ผู้ใช้ระดับศูนย์พักพิง (เช่น Manager) จะทำแอคชันได้เฉพาะข้อมูลในศูนย์ตนเองเท่านั้น (Shelter Code) 
  - การบันทึกหรือดึงข้อมูลต้องบังคับกรองด้วย `shelterCode` ตลอด ห้ามเชื่อใจ Payload ที่ส่งมาจาก Client เพื่อป้องกัน Data Leak ระหว่างศูนย์

### 3. Data Privacy & Redaction
* **แหล่งที่มา**: `docs/task-breakdown/10-eoc.md` และ `docs/task-breakdown/_index.md`
* **ข้อมูลที่พบ**: 
  - ข้อมูลส่วนบุคคล (PII) เช่น เลขบัตรประชาชน (National ID), ประวัติการแพทย์ (Medical), และกลุ่มเปราะบาง (Vulnerability) ถือเป็นความลับสูงสุด
  - มีกฎระบุว่า "Public/FAM/API/EOC serializers มี no-medical/no-national-ID tests" แปลว่าระบบภายนอกห้ามเห็นข้อมูลนี้เด็ดขาด ต้องทำ Redaction เสมอ

### 4. UI Route Guards
* **แหล่งที่มา**: `docs/task-breakdown/_index.md`
* **ข้อมูลที่พบ**: 
  - มีระบุว่าระบบใช้ Auth/RBAC kernel (`$lib/guards/`) ในการทำ Guard กั้นการเข้าถึงหน้าเว็บต่างๆ ตามสิทธิ์
