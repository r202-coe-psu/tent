---
status: proposed
created: 2026-06-29
updated: 2026-06-30
affects:
  - T-58
  - CR-005
---

# CR-017: Public Dashboard API Architecture (T-58)

**สรุป (TL;DR):** วางโครงสร้าง API ของ Dashboard สำหรับระบบ Public (T-58) เปลี่ยนวิธีดึงข้อมูลสาธารณะโดยใช้ MongoDB เป็น Public-facing Store ควบคู่กับ Sync Worker (CDC) ทำหน้าที่เป็น Read-Model แทนการอ่าน CouchDB โดยตรง เพื่อแยก Blast Radius ป้องกัน CouchDB กลางล่ม และใช้กลไก Projection ป้องกันข้อมูลส่วนบุคคล (PII) รั่วไหลเด็ดขาด

## 1. สาเหตุที่จะทำ

- **ป้องกัน Database Overload (Blast Radius):** การที่ Public API วิ่งเข้าไปอ่านข้อมูลจากฐานข้อมูล `shelter_{code}` สดๆ จาก CouchDB จะทำให้ระบบหลักที่ใช้งานโดยเจ้าหน้าที่ (Operational) ได้รับผลกระทบหากมี public traffic หรือ DDoS เข้ามา การแยก MongoDB มารับโหลดจะช่วยจำกัดขอบเขตความเสียหาย
- **ป้องกันข้อมูล PII รั่วไหล (Privacy by Construction):** การฉาย (Project) ข้อมูลจาก CouchDB ไปยัง MongoDB จะทำการกรองข้อมูล (Allow-list) เฉพาะฟิลด์ที่เปิดเผยได้เท่านั้น ทำให้ต่อให้ MongoDB รั่วไหลก็ไม่มีข้อมูล PII หลุดออกไป
- **ประสิทธิภาพการค้นหา (Query Shape):** หน้า Public ต้องการการค้นหาแบบ Text Index (เช่น หาชื่อครอบครัว หรือ เบอร์โทร) ซึ่งทำบน MongoDB ได้มีประสิทธิภาพและง่ายกว่า CouchDB View มาก

## 2. สิ่งที่จะทำ

เพื่อให้ระบบสามารถรองรับประชาชนที่เข้ามาดู Dashboard หรือค้นหาข้อมูลจำนวนมหาศาลได้พร้อมกันโดยไม่ล่ม เราจะแบ่งการพัฒนาระบบออกเป็น 3 ส่วนหลัก ดังนี้:

### ส่วนที่ 1: สร้าง Sync Worker (Background Worker)

สร้าง Service ใหม่ด้วย Python/FastAPI (รันแยกใน Docker Container) โดยทำงานร่วมกับ **Redis** เพื่อทำหน้าที่คอยซิงก์ข้อมูลระหว่าง CouchDB (Central) และ MongoDB โดยมีกลไกสำหรับ Public Dashboard (Outbound Plane) คือ:

1. **Tail `_changes` & Debounce:** เกาะติดความเคลื่อนไหว (CDC) ของฐานข้อมูล CouchDB ในทุกศูนย์ (`shelter_{code}`) และ `registry` โดยอาจใช้ **Redis** ในการพักข้อมูล (Cache) หรือทำ Debounce เพื่อลดภาระการทำงานซ้ำซ้อนหากมีอัปเดตเข้ามาพร้อมกันจำนวนมาก
   > คำถาม: การ sync ข้อมูลจะทำแบบใด
   >
   > 1.ให้ Worker polling couchdb ทุกวินาทีเพื่อตรวจสอบการเปลี่ยนแปลง แล้วค่อย syncฦ
   > 2.เปิด api ให้ Worker ถูก trigger จาก couchdb คล้ายๆ (hook)
   > 2.1 ถามต่อ - ทำยังไง ทำได้จริงไหม?
2. **Projector:** ทำหน้าที่กรองข้อมูลตาม whitelist โดยดึงเฉพาะข้อมูลที่จะให้ Public ดูได้ (เช่น `public_transparency` ที่รวม occupancy_count และยอดบริจาค, `public_persons` สำหรับค้นหา)
3. **Upsert:** นำข้อมูลที่ผ่านการ Project แล้วไปอัปเดตหรือลบใน MongoDB Collection ปลายทาง

### ส่วนที่ 2: ใช้ MongoDB เป็น Public-facing Store

ข้อมูลที่จะนำไปแสดงใน Public Dashboard (T-58) จะถูกดึงมาจาก MongoDB ทั้งหมด:

- **Collections หลัก:**
  - `public_transparency`: ยอดสรุปแต่ละศูนย์ (เช่น คนเข้าพัก, ยอดของบริจาค)
  - `public_needs`: ความต้องการสิ่งของ
  - `public_persons`: ข้อมูลคนในศูนย์ (บังข้อมูลบางส่วน เพื่อค้นหา)
- ไม่มีการให้ Public API เข้าถึง CouchDB โดยตรง (CouchDB ไม่รับ Public Internet Traffic เลย)

### ส่วนที่ 3: ปรับปรุง Public API & โครงสร้างหน้าบ้าน (T-58)

- **API ดึงข้อมูล:** API ของหน้าเว็บสาธารณะจะวิ่งมาดึงข้อมูลสรุปจาก **MongoDB** เท่านั้น
- **เพิ่มประสิทธิภาพ:** มีการแนบ Header `Cache-Control: public, max-age=600` เพื่อช่วยลดภาระของเซิร์ฟเวอร์
- **ความปลอดภัยของข้อมูล (DDD):** แยกโค้ดหน้าบ้านไปไว้ที่ `$lib/features/public-portal` อย่างเด็ดขาด

## 3. โครงสร้างโค้ด (Code Structure)

```text
📦 Smart Shelter
 ┣ 📂 frontend
 │ ┣ 📂 src/routes/api/
 │ │ ┗ 📂 v1/public/shelters
 │ │   ┗ 📜 +server.ts       <-- [T-58] API ดึงสถิติรวมจาก MongoDB (Public)
 │ ┗ 📂 src/lib/features/
 │   ┗ 📂 public-portal      <-- [T-58] Zod Schema (Non-PII) & API Wrapper หน้าบ้าน
 ┣ 📂 worker            <-- [T-58] โฟลเดอร์ใหม่สำหรับ Sync Service (Python/FastAPI)
 │ ┣ 📜 Dockerfile           <-- คอนฟิกสำหรับสร้าง Docker Image
 │ ┣ 📜 main.py              <-- โค้ดหลักที่ทำหน้าที่ Listen CouchDB, คุยกับ Redis และ MongoDB
 │ ┗ 📜 requirements.txt     <-- ไฟล์จัดการ Dependencies
 ┗ 📜 docker-compose.yml     <-- [T-58] เพิ่ม Service `worker`, `redis` และ `mongodb`
 ┗ ิ📂 backend                 <-- clone มาจาก repo https://github.com/importstar/fastapi-beanie-simplified
```
> คำถาม: init backend พี่เน็ทจะ init เองหรือให้ TL init ครับ
## 4. ไฟล์ที่ได้รับผลกระทบ

- `frontend/src/routes/api/v1/public/shelters/+server.ts` (สร้างใหม่)
- `frontend/src/lib/features/public-portal/...` (สร้างใหม่)
- `worker/main.py` และ `worker/Dockerfile` (สร้างใหม่/แทนที่ metrics-worker)
- `docker-compose.yml` (แก้ไข เพิ่ม MongoDB, Redis และ Sync Worker)

## 5. Edge Cases & Mitigations (กรณีสุดวิสัยและวิธีรับมือ)

1. **MongoDB Connection Failure / Replica ล่ม:**
   - **ปัญหา:** Public API ดึงข้อมูลไม่ได้
   - **วิธีรับมือ:** ฝั่ง API ส่ง HTTP 503 กลับไปพร้อม Cache-Control เล็กน้อยเพื่อป้องกันบอทสแปม โดยที่ระบบ Operational ของศูนย์ (CouchDB) จะไม่ได้รับผลกระทบใดๆ (Blast Radius จำกัดแค่ระดับ Public Plane)

2. **CouchDB `_changes` Feed Disconnected (สายหลุดจากฐานข้อมูลกลาง):**
   - **ปัญหา:** Sync Worker ขาดการเชื่อมต่อ ทำให้ข้อมูลฝั่ง MongoDB ไม่ถูกอัปเดต (Stale Data) แต่หน้าเว็บสาธารณะไม่ล่ม
   - **วิธีรับมือ:** เก็บ Checkpoint (`last_seq`) ไว้ใน MongoDB collection `_sync_checkpoints` เพื่อให้เวลา Worker ทำการตื่นขึ้นมาใหม่ หรือ Reconnect สำเร็จ จะสามารถทำงานต่อจากจุดเดิมได้ทันที โดยไม่ตกหล่น

3. **Data Retention และ Purge (การลบข้อมูล):**
   - **ปัญหา:** คำสั่ง `_purge` ใน CouchDB จะไม่มี event ส่งไปยัง `_changes` feed ทำให้ข้อมูลฝั่ง MongoDB อาจจะค้าง PII
   - **วิธีรับมือ:** ต้องมี Retention Job ที่ทำงานคู่กัน หากทำการลบข้อมูลถาวรฝั่ง CouchDB (เช่น ปิดศูนย์เกิน 3 เดือน หรือลบข้อมูลผู้บริจาค) จะต้องลบข้อมูลใน MongoDB Collection ที่เกี่ยวข้องด้วยพร้อมกัน

4. **Dynamic Listener Miss (เปิด/ปิดศูนย์กะทันหัน):**
   - **ปัญหา:** แอดมินปิดศูนย์ไปแล้วแต่ Worker ยังพยายามดึงข้อมูล หรือเปิดศูนย์ใหม่แต่ Worker ไม่ยอมเข้าไปดักฟัง
   - **วิธีรับมือ:** Worker ต้องเกาะติด `_changes` feed ของฐานข้อมูล `registry` เป็นหลัก เพื่อตรวจจับ `operation_status` แบบ Real-time แล้วสั่งรันหรือหยุด Listener ของศูนย์นั้นๆ ให้สัมพันธ์กับสถานะจริงเสมอ

## 6. สิ่งที่ต้องปรับ Spec

- เปลี่ยนข้อกำหนดการออกแบบจาก In-memory Cache (Redis) เป็น **MongoDB** ควบคู่กับ **Sync Worker** เป็น Public-facing Store แทน
- อัปเดต Task Breakdown **T-58** (`docs/task-breakdown/12-public.md`) และอ้างอิงกลับไปยังหลักการ Sync ตามเอกสาร `docs/data/couchdb-mongodb-sync.md`
