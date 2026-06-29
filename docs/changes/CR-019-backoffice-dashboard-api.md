---
status: proposed
created: 2026-06-29
updated: 2026-06-29
affects:
  - T-52
---

# CR-019: Back-office Dashboard API Architecture (T-52)

**สรุป (TL;DR):** วางโครงสร้าง API ของ Dashboard สำหรับระบบ Back-office (T-52) เพิ่มสคริปต์สร้าง CouchDB View (MapReduce) สำหรับดึงสถิติรายศูนย์แบบ Real-time และแยก Feature Domain ให้ชัดเจนตามหลัก DDD

## 1. สาเหตุที่จะทำ

- **รายละเอียดตกหล่นจาก Task หลัก (T-52):** ใน Task Breakdown เดิมไม่ได้มีการระบุโครงสร้างการทำงาน (Architecture), การแยกโดเมน (DDD), หรือการดึงข้อมูลประชากรศาสตร์ผ่าน View อย่างชัดเจน จึงจำเป็นต้องสร้าง CR นี้ขึ้นมาเพื่อตีกรอบสเปคการทำงานของ Dashboard API ให้ฝั่ง Backend นำไปพัฒนากันได้ถูกทางและสอดคล้องกัน
- **แก้ปัญหา Query ข้อมูลไม่ได้ (T-52):** เนื่องจาก CouchDB เป็น NoSQL แบบ Document-based การจะนับจำนวนคนในศูนย์ (เช่น `SELECT COUNT(*)`) ไม่สามารถทำได้ตรงๆ ถ้าเราดึงข้อมูลผู้ลี้ภัยทุกคนออกมานับด้วย API จะทำให้ระบบช้าและเปลือง Memory มาก เราจึงจำเป็นต้องสร้าง Design Document (`_design/app`) เพื่อรัน MapReduce (สร้าง View `occupancy` และอื่นๆ เพื่อรองรับข้อมูลด้านบน) ซึ่งจะทำหน้าที่คำนวณยอดสรุปเตรียมไว้ให้ในฐานข้อมูลตั้งแต่ต้น ทำให้ API ดึงสถิติไปโชว์ได้รวดเร็วทันที

## 2. สิ่งที่จะทำ

- **สำหรับ T-52 (Back-office):** เพิ่มสคริปต์สร้าง Design Document (`_design/app`) และ MapReduce function เข้าไปในกระบวนการ Deploy ฐานข้อมูลศูนย์ และวาง API Guard แบบ Role-based access control (RBAC) ให้ตรงกับรหัสศูนย์
- **แยก Feature Domain:** จัดโครงสร้างโฟลเดอร์ `$lib/features/dashboard-*` (หลังบ้าน) ออกเป็น 3 ส่วนย่อย (Occupancy, Demographics, Registration) เพื่อให้จัดการ Zod Schema และ Business Logic แยกกันได้ตามหลัก DDD

## 3. ข้อมูลที่ API ต้องส่งกลับ (API Payload Requirements)

API (แบ่งเป็น 3 เส้นทางย่อยภายใต้ `/api/back-office/shelter/[code]/dashboard/`) จะต้องส่งคืนสถิติเหล่านี้ (โดยดึงจาก CouchDB Views):

1. **สถิติการลงทะเบียน:** จำนวนคนลงทะเบียนรายวัน
2. **สถานะผู้อพยพ:**
   - ผู้อพยพทั้งหมด (Total)
   - ผู้อพยพที่ยังอยู่ (Currently Present / Checked-in)
   - ผู้อพยพที่ออกไปแล้ว (Checked-out)
3. **ช่วงอายุผู้อพยพทั้งหมด:**
   - 0 - 4 ปี: ทารกและเด็กเล็ก (ต้องการการดูแลสุขภาพเฉพาะ)
   - 5 - 11 ปี: เด็กวัยประถม (ต้องการการศึกษาขั้นพื้นฐาน)
   - 12 - 17 ปี: วัยรุ่น (กลุ่มเสี่ยงที่อาจต้องการการปกป้องเป็นพิเศษ)
   - 18 - 59 ปี: ผู้ใหญ่ (วัยทำงาน)
   - 60 ปีขึ้นไป: ผู้สูงอายุ
   - ไม่ทราบอายุ
4. **สัญชาติ/ประเทศ:** จำนวนผู้อพยพแบ่งตามแต่ละประเทศ (Nationalities Breakdown)

## 4. โครงสร้างโค้ด (Code Structure)

เพื่อให้เป็นไปตามหลัก Single Responsibility และให้ Frontend ดึงข้อมูลได้แบบขนาน (Parallel Fetch) จึงแบ่งย่อย Feature และ API ออกเป็น 3 ส่วน:

```text
📦 Smart Shelter
 ┣ 📂 frontend
 │ ┣ 📂 src/routes/api/back-office/shelter/[code]/dashboard/
 │ │ ┣ 📂 occupancy
 │ │ │ ┗ 📜 +server.ts       <-- API ดึงข้อมูลสถานะการเข้าพัก
 │ │ ┣ 📂 demographics
 │ │ │ ┗ 📜 +server.ts       <-- API ดึงข้อมูลช่วงอายุ และสัญชาติ
 │ │ ┗ 📂 registrations
 │ │   ┗ 📜 +server.ts       <-- API ดึงข้อมูลสถิติการลงทะเบียนรายวัน
 │ ┣ 📂 src/lib/features/
 │ │ ┣ 📂 dashboard-occupancy
 │ │ │ ┣ 📂 domain/schema.ts
 │ │ │ ┗ 📂 data/occupancy.api.ts
 │ │ ┣ 📂 dashboard-demographics
 │ │ │ ┣ 📂 domain/schema.ts
 │ │ │ ┗ 📂 data/demographics.api.ts
 │ │ ┗ 📂 dashboard-registration
 │ │   ┣ 📂 domain/schema.ts
 │ │   ┗ 📂 data/registration.api.ts
 │ ┗ 📂 src/lib/server/
 │   ┗ 📜 shelters.admin.ts  <-- [T-52] เพิ่มสคริปต์ Deploy `_design/app` (สร้าง Views แยกตามหมวดหมู่)
```

## 5. ไฟล์ที่ได้รับผลกระทบ

- `frontend/src/routes/api/back-office/shelter/[code]/dashboard/*` (สร้างใหม่ 3 endpoints)
- `frontend/src/lib/features/dashboard-occupancy/...` (สร้างใหม่)
- `frontend/src/lib/features/dashboard-demographics/...` (สร้างใหม่)
- `frontend/src/lib/features/dashboard-registration/...` (สร้างใหม่)
- `frontend/src/lib/server/shelters.admin.ts` (แก้ไข)

## 6. สิ่งที่ต้องปรับ Spec

- อัปเดตเงื่อนไขเรื่องการสร้าง CouchDB View ให้เป็นส่วนหนึ่งของงาน **T-52** (`docs/task-breakdown/00-baseline.md`)
