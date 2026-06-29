---
status: proposed
created: 2026-06-29
updated: 2026-06-29
affects:
  - T-58
  - CR-005
---

# CR-017: Public Dashboard API Architecture (T-58)

**สรุป (TL;DR):** วางโครงสร้าง API ของ Dashboard สำหรับระบบ Public (T-58) เปลี่ยนวิธีดึงข้อมูลสาธารณะจาก Dynamic Query เป็น Dockerized Background Worker (Daemon) + Read-Model เพื่อป้องกันระบบล่ม และแยก Feature Domain ป้องกันข้อมูลส่วนบุคคล (PII) รั่วไหล

## 1. สิ่งที่จะทำ

เพื่อให้ระบบสามารถรองรับประชาชนที่เข้ามาดู Dashboard จำนวนมหาศาลได้พร้อมกันโดยไม่ล่ม เราจะแบ่งการพัฒนาระบบออกเป็น 3 ส่วนหลัก ดังนี้:

### ส่วนที่ 1: สร้าง Background Worker (`metrics-worker`)
สร้าง Service ใหม่ด้วย Node.js (รันแยกใน Docker Container) เพื่อทำหน้าที่เป็น "พนักงานหลังบ้าน" คอยรวบรวมข้อมูลอัตโนมัติ โดยมีขั้นตอนดังนี้:
1. **Listen (ดักฟัง):** เกาะติด (`Subscribe`) ความเคลื่อนไหวของฐานข้อมูล CouchDB ในทุกศูนย์ที่กำลังเปิดอยู่
2. **Trigger (กระตุ้น):** เมื่อมีประชาชน Check-in หรือ Check-out ระบบจะกระตุ้นให้ Worker ตื่นขึ้นมาทำงาน
3. **Aggregate (รวบยอด):** Worker จะหน่วงเวลาเล็กน้อย (Debounce) เพื่อรอกวาดตัวเลขสถิติรวมจากทุกศูนย์มาบวกกันในรอบเดียว

### ส่วนที่ 2: ใช้ Redis เป็นที่เก็บข้อมูลความเร็วสูง (In-memory Cache)
เพื่อความเร็วในการดึงข้อมูลสูงสุด เราจะใช้ Redis เป็นตัวกลาง:
- **Save:** เมื่อ Worker คำนวณยอดรวมเสร็จ จะนำตัวเลขไปบันทึกทับลงใน **Redis** (เช่น Key: `public_metrics:latest`) 
- ข้อมูลใน Redis จะถูกอัปเดตให้สดใหม่เสมอ (Real-time) ตามความเคลื่อนไหวในศูนย์

### ส่วนที่ 3: ปรับปรุง Public API & โครงสร้างหน้าบ้าน (T-58)
- **API ดึงข้อมูล:** API ของหน้าเว็บสาธารณะจะไม่ไปยุ่งกับ CouchDB เลย แต่จะวิ่งมาดึงข้อมูลสรุปจาก **Redis** แทนเท่านั้น
- **เพิ่มประสิทธิภาพ:** มีการแนบ Header `Cache-Control: public, max-age=600` เพื่อช่วยลดภาระของเซิร์ฟเวอร์
- **ความปลอดภัยของข้อมูล (DDD):** แยกโค้ดหน้าบ้านไปไว้ที่ `$lib/features/public-portal` อย่างเด็ดขาด เพื่อป้องกันไม่ให้ข้อมูลส่วนบุคคล (PII) หลุดออกสู่สาธารณะ

## 2. สาเหตุที่จะทำ

- **ป้องกัน Database Overload:** การที่ Public API วิ่งเข้าไปอ่านข้อมูล `occupancy` สดๆ จากฐานข้อมูล `shelter_{code}` ทุกศูนย์พร้อมกัน เมื่อมีคนเข้าเว็บสาธารณะจำนวนมาก จะทำให้ CouchDB ทำงานหนักจนระบบล่ม จึงต้องทำ Background Worker แยกออกมา
- **ป้องกันข้อมูล PII รั่วไหล:** หากใช้ API รวมกันระหว่างหน้าบ้านและหลังบ้าน อาจทำให้ข้อมูลส่วนบุคคล (PII) หลุดออกไปสู่สาธารณะ จึงต้องแยก Feature กันอย่างเด็ดขาด

## 3. โครงสร้างโค้ด (Code Structure)

```text
📦 Smart Shelter
 ┣ 📂 frontend
 │ ┣ 📂 src/routes/api/
 │ │ ┗ 📂 v1/public/shelters
 │ │   ┗ 📜 +server.ts       <-- [T-58] API ดึงสถิติรวมจาก Read-Model (Public)
 │ ┗ 📂 src/lib/features/
 │   ┗ 📂 public-portal      <-- [T-58] Zod Schema (Non-PII) & API Wrapper หน้าบ้าน
 ┣ 📂 metrics-worker         <-- [T-58] โฟลเดอร์ใหม่สำหรับ Background Service
 │ ┣ 📜 Dockerfile           <-- คอนฟิกสำหรับสร้าง Docker Image
 │ ┣ 📜 index.ts             <-- โค้ดหลักที่ทำหน้าที่ Listen CouchDB `_changes`
 │ ┗ 📜 package.json
 ┗ 📜 docker-compose.yml     <-- [T-58] เพิ่ม Service `metrics-worker` และ `redis`
```

## 4. ไฟล์ที่ได้รับผลกระทบ

- `frontend/src/routes/api/v1/public/shelters/+server.ts` (สร้างใหม่)
- `frontend/src/lib/features/public-portal/...` (สร้างใหม่)
- `metrics-worker/index.ts` และ `metrics-worker/Dockerfile` (สร้างใหม่ทั้งหมด)
- `docker-compose.yml` (แก้ไข)

## 5. Edge Cases & Mitigations (กรณีสุดวิสัยและวิธีรับมือ)

เนื่องจากสถาปัตยกรรมนี้ใช้ Background Worker และ In-memory Cache จึงมีความเสี่ยงที่ต้องจัดการเพิ่มเติมดังนี้:

1. **Redis Connection Failure (Redis ล่ม):**
   - **ปัญหา:** Worker ไม่สามารถบันทึกสถิติได้ หรือ Public API ดึงข้อมูลไม่ได้
   - **วิธีรับมือ:** Worker ต้องมี Retry Logic ในการพยายามต่อใหม่ ส่วนฝั่ง API หากดึงข้อมูลจาก Redis ไม่สำเร็จ ให้พิจารณาส่ง HTTP 503 กลับไปพร้อม Cache-Control เล็กน้อยเพื่อป้องกันบอทสแปมและไม่ให้หน้าบ้านค้าง

2. **CouchDB `_changes` Feed Disconnected (สายหลุดจากฐานข้อมูล):**
   - **ปัญหา:** Worker ขาดการเชื่อมต่อ ทำให้ตัวเลขสถิติบนหน้าเว็บหยุดนิ่งโดยไม่มี Error แจ้งเตือน (Silent Failure)
   - **วิธีรับมือ:** ดักจับ Event `error` และ `end` บน Feed Listener แล้วสั่ง `.stop()` เคลียร์หน่วยความจำ ก่อนที่จะหน่วงเวลาพยายาม Reconnect ใหม่อัตโนมัติ

3. **Partial Aggregation Failure (ดึงข้อมูลล้มเหลวเฉพาะบางศูนย์):**
   - **ปัญหา:** หากศูนย์ใดศูนย์หนึ่งฐานข้อมูลมีปัญหา (ตอบสนองช้า/พัง) ตอนกวาดข้อมูลรวมทั้งหมดอาจพาให้พังทั้งระบบ
   - **วิธีรับมือ:** ใช้ `Promise.allSettled()` แทน `Promise.all()` เพื่อให้ Worker ยังคงนำข้อมูลจากศูนย์ที่ "สำเร็จ" มารวมกันได้ ส่วนศูนย์ที่ดึงไม่สำเร็จให้ Log แจ้งเตือนไว้ โดยไม่ทำให้หน้าเว็บสาธารณะล่ม

4. **Dynamic Listener Miss (เปิด/ปิดศูนย์กะทันหัน):**
   - **ปัญหา:** แอดมินปิดศูนย์ไปแล้วแต่ Worker ยังพยายามดึงข้อมูล หรือเปิดศูนย์ใหม่แต่ Worker ไม่ยอมเข้าไปดักฟัง
   - **วิธีรับมือ:** Worker ต้องเกาะติด `_changes` feed ของฐานข้อมูล `registry` เป็นหลัก เพื่อตรวจจับ `operation_status` แบบ Real-time แล้วเรียกฟังก์ชัน `startShelterListener()` หรือ `stopShelterListener()` อัปเดตตัวเองให้ตรงกับสถานะจริงเสมอ

## 6. สิ่งที่ต้องปรับ Spec

- เพิ่ม Requirements เรื่อง Background Worker (Docker Container), การใช้ **Redis** สำหรับเก็บ Read-Model ลงในรายละเอียดงานของ **T-58** (`docs/task-breakdown/12-public.md`)
