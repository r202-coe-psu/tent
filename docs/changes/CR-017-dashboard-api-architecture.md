---
status: proposed
created: 2026-06-28
updated: 2026-06-28
affects:
  - T-52
  - T-58
  - CR-005
---

# CR-017: Dashboard API Architecture (T-52 & T-58)

**สรุป (TL;DR):** วางโครงสร้าง API ของ Dashboard สำหรับระบบ Back-office (T-52) และ Public (T-58) ให้แยกส่วนกันชัดเจนตามหลัก DDD เปลี่ยนวิธีดึงข้อมูลสาธารณะจาก Dynamic Query เป็น Dockerized Background Worker (Daemon) + Read-Model และเพิ่มสคริปต์สร้าง CouchDB View สำหรับ T-52

## 1. สิ่งที่จะทำ

- **สำหรับ T-58 (Public):** สร้าง Service ใหม่ที่เป็น Background Worker (รันใน Docker Container แยกต่างหาก) คอย Listen `_changes` feed จาก CouchDB ตลอดเวลา เพื่อ Query สถิติรวมจากทุกศูนย์ที่เปิดอยู่ แล้วเอาไปบันทึกทับเป็น Read-Model Document ลงใน `registry` DB แบบ Real-time (API จะอ่านแค่จาก Document นี้แผ่นเดียว) พร้อมใส่ Header `Cache-Control: public, max-age=600`
- **สำหรับ T-52 (Back-office):** เพิ่มสคริปต์สร้าง Design Document (`_design/app`) และ MapReduce function เข้าไปในกระบวนการ Deploy ฐานข้อมูลศูนย์ และวาง API Guard แบบ Role-based access control (RBAC) ให้ตรงกับรหัสศูนย์
- **แยก Feature Domain:** จัดโครงสร้าง `$lib/features/occupancy-dashboard` (หลังบ้าน) และ `$lib/features/public-portal` (หน้าบ้าน) ออกจากกันอย่างชัดเจน ป้องกัน PII รั่วไหล

## 2. สาเหตุที่จะทำ

- **ป้องกัน Database Overload (T-58):** การที่ Public API วิ่งเข้าไปอ่านข้อมูล `occupancy` สดๆ จากฐานข้อมูล `shelter_{code}` ทุกศูนย์พร้อมกัน เมื่อมีคนเข้าเว็บสาธารณะจำนวนมาก จะทำให้ CouchDB ทำงานหนักจนระบบล่ม จึงต้องทำ Background Worker แยกออกมา
- **แก้ปัญหา Query ข้อมูลไม่ได้ (T-52):** เนื่องจาก CouchDB เป็น NoSQL แบบ Document-based การจะนับจำนวนคนในศูนย์ (เช่น `SELECT COUNT(*)`) ไม่สามารถทำได้ตรงๆ ถ้าเราดึงข้อมูลผู้ลี้ภัยทุกคนออกมานับด้วย API จะทำให้ระบบช้าและเปลือง Memory มาก เราจึงจำเป็นต้องสร้าง Design Document (`_design/app`) เพื่อรัน MapReduce (สร้าง View `occupancy`) ซึ่งจะทำหน้าที่คำนวณยอดสรุปเตรียมไว้ให้ในฐานข้อมูลตั้งแต่ต้น ทำให้ API ดึงสถิติไปโชว์ได้รวดเร็วทันที
- **ป้องกันข้อมูล PII รั่วไหล:** หากใช้ API รวมกันระหว่างหน้าบ้านและหลังบ้าน อาจทำให้ข้อมูลส่วนบุคคล (PII) หลุดออกไปสู่สาธารณะ จึงต้องแยก Feature กันตามสถาปัตยกรรม DDD อย่างเด็ดขาด

## 3. โครงสร้างโค้ด (Code Structure)

```text
📦 Smart Shelter
 ┣ 📂 frontend
 │ ┣ 📂 src/routes/api/
 │ │ ┣ 📂 back-office/shelter/[code]/occupancy-dashboard
 │ │ │ ┗ 📜 +server.ts       <-- [T-52] API เช็คสิทธิ์และดึงสถิติรายศูนย์ (Back-office)
 │ │ ┗ 📂 v1/public/shelters
 │ │   ┗ 📜 +server.ts       <-- [T-58] API ดึงสถิติรวมจาก Read-Model (Public)
 │ ┣ 📂 src/lib/features/
 │ │ ┣ 📂 occupancy-dashboard <-- [T-52] Zod Schema & API Wrapper หลังบ้าน
 │ │ ┗ 📂 public-portal      <-- [T-58] Zod Schema & API Wrapper หน้าบ้าน
 │ ┗ 📂 src/lib/server/
 │   ┗ 📜 shelters.admin.ts  <-- [T-52] เพิ่มโค้ด Deploy `_design/app` View
 ┣ 📂 metrics-worker         <-- [T-58] โฟลเดอร์ใหม่สำหรับ Background Service
 │ ┣ 📜 Dockerfile           <-- คอนฟิกสำหรับสร้าง Docker Image
 │ ┣ 📜 index.ts             <-- โค้ดหลักที่ทำหน้าที่ Listen CouchDB `_changes`
 │ ┗ 📜 package.json
 ┗ 📜 docker-compose.yml     <-- [T-58] เพิ่ม Service ชื่อ `metrics-worker` เข้าไป
```

## 4. ไฟล์ที่ได้รับผลกระทบ

- `frontend/src/routes/api/back-office/shelter/[code]/occupancy-dashboard/+server.ts` (สร้างใหม่)
- `frontend/src/routes/api/v1/public/shelters/+server.ts` (สร้างใหม่)
- `frontend/src/lib/features/occupancy-dashboard/...` (สร้างใหม่)
- `frontend/src/lib/features/public-portal/...` (สร้างใหม่)
- `frontend/src/lib/server/shelters.admin.ts` (แก้ไข)
- `metrics-worker/index.ts` และ `metrics-worker/Dockerfile` (สร้างใหม่ทั้งหมด)
- `docker-compose.yml` (แก้ไข)

## 5. สิ่งที่ต้องปรับ Spec

- เพิ่ม Requirements เรื่อง Background Worker (Docker Container) และ Read-Model ลงในรายละเอียดงานของ **T-58** (`docs/task-breakdown/12-public.md`)
- อัปเดตเงื่อนไขเรื่องการสร้าง CouchDB View ให้เป็นส่วนหนึ่งของงาน **T-52** (`docs/task-breakdown/00-baseline.md`)
