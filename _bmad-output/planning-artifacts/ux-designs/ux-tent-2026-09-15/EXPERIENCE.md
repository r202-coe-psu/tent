---
name: SmartShelter Shelter Import Experience
description: พฤติกรรมและ flow สำหรับประวัติ ติดตาม และตรวจผลลัพธ์งานนำเข้า shelter
status: draft
updated: 2026-09-15
sources:
  - frontend/src/lib/features/shelter-import/ui/shelter-import-page.svelte
  - frontend/src/lib/features/shelter-import/ui/import-log-history.svelte
  - frontend/src/lib/features/shelter-import/ui/import-progress.svelte
---

## Foundation

เป็น web interface สำหรับ system administrator บน desktop และ tablet โดยใช้ Svelte 5, shadcn-svelte และ Civic Light Design System; visual identity อ้างอิง DESIGN.md ส่วนนี้กำหนดเฉพาะ behavior และ state

## Information Architecture

1. หน้า Import Shelter: upload/template และ preview ก่อน commit
2. ตารางประวัติการนำเข้า: หนึ่งแถวต่อหนึ่ง job หรือประวัติ terminal attempt
3. Progress dialog: รายละเอียดของ job ปัจจุบันและสถานะราย shelter
4. Result dialog: ตารางราย shelter ที่นำเข้าสำเร็จหรือผิดพลาดของประวัติที่เลือก

## Voice and Tone

ใช้ภาษาไทยที่ตรงไปตรงมาและระบุผลกระทบ: “เสร็จพร้อมข้อผิดพลาด” อธิบายต่อว่าแถวที่สำเร็จยังคงอยู่และสามารถลองใหม่เฉพาะแถวที่ fail ได้ หลีกเลี่ยงคำที่ทำให้เข้าใจว่า failure หนึ่งรายการยกเลิกทั้งไฟล์

## Component Patterns

- ตารางหลักมี columns: ไฟล์นำเข้า/ผู้ดำเนินการ, สถานะ, สรุปผล, จำนวนแถว, การดำเนินการ
- รายการ active ที่มีสถานะ `queued` หรือ `running` แสดงเป็นแถวปัจจุบันเหนือประวัติ และมีปุ่ม “ดู progress”
- Progress dialog แสดงรายการทีละ shelter พร้อม status และ error ของแถวนั้น
- Result dialog เปิดด้วย filter ที่ตรงกับ action (`ศูนย์ที่นำเข้าแล้ว` หรือ `รายการที่ผิดพลาด`) และสลับ filter ได้เมื่อมีทั้งสองประเภท
- ปุ่ม retry ส่งกลับเข้าคิวเฉพาะ `failed` ที่ยังไม่เกิน retry limit; validation error ไม่ถูก retry อัตโนมัติ

## State Patterns

- **Loading:** แสดงข้อความกำลังโหลดในพื้นที่ตารางหรือ dialog
- **Empty:** แสดง “ยังไม่มีประวัติการนำเข้า” เมื่อไม่มี log และไม่มี active job
- **Queued/Running:** status `กำลังทำงาน`, progress dialog เปิดอัตโนมัติหนึ่งครั้งเมื่อกลับเข้าหน้า และผู้ใช้เปิดซ้ำได้จากปุ่มในตาราง
- **Completed:** status `เสร็จสมบูรณ์` เมื่อไม่มี error
- **Completed with errors:** status `เสร็จพร้อมข้อผิดพลาด` เมื่อมีทั้งผลสำเร็จ/ข้ามและ error
- **Failed:** status `ล้มเหลว` เมื่อทุกแถวที่บันทึกเป็น error
- **Per-item failure:** บันทึกเฉพาะ shelter นั้นเป็น failed แล้ว worker ทำรายการถัดไปต่อ ไม่ cancel ทั้ง job

## Interaction Primitives

- เปิด progress modal จากปุ่มใน header หรือแถว active
- เปิด result modal จาก action ของแถวประวัติ
- ปิด modal ด้วยปุ่ม ปุ่ม close ของ dialog, Escape หรือ click นอก modal ตาม primitive ของระบบ
- เมื่อ polling เปลี่ยนข้อมูล ให้ update ตัวเลขและ status ใน modal โดยไม่เปิด modal ซ้ำหลังผู้ใช้ปิด
- หลัง terminal job ให้ invalidate shelter และ import-log queries เพื่อให้ตารางหลักสะท้อนข้อมูลล่าสุด

## Accessibility Floor

- ทุก status มีทั้ง icon และข้อความ ไม่พึ่งพาสีอย่างเดียว
- ปุ่ม action ต้องมี accessible name ที่อธิบายการกระทำ
- Dialog ต้องมี title/description และ focus management จาก shadcn primitive
- ตารางต้องมี header cells และรองรับ horizontal scroll บน viewport แคบ
- progress bar มี `role="progressbar"` และค่า `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- ข้อความ error ต้องอ่านได้เป็น text และไม่ถูกซ่อนด้วยสีเพียงอย่างเดียว

## Key Flows

### Pary ตรวจงานนำเข้าที่กำลังทำอยู่หลังกลับเข้าหน้า

1. Pary เปิดหน้า Import Shelter อีกครั้งหลังเริ่ม import ไว้
2. ระบบอ่าน active job จาก session และโหลดสถานะล่าสุด
3. ถ้า job ยัง `queued` หรือ `running` ระบบเปิด Progress dialog อัตโนมัติหนึ่งครั้ง
4. Pary เห็นรายการที่กำลังทำ/รอ พร้อมตัวเลข progress และสามารถปิด dialog ได้โดยไม่ถูกเปิดซ้ำทุก polling รอบ
5. เมื่อจบ ระบบเปลี่ยนเป็น terminal status และให้ Pary เปิดดูผลลัพธ์จากประวัติได้

### Pary ตรวจ job ที่มี shelter หนึ่งรายการล้มเหลว

1. Pary เปิด progress หรือ history detail ของ job
2. ตารางหลักแสดง `เสร็จพร้อมข้อผิดพลาด` และ summary counts โดยไม่แสดงรายชื่อศูนย์
3. Pary เปิด `รายการที่ผิดพลาด` เพื่อเห็นชื่อ แถว และสาเหตุเฉพาะรายการ
4. รายการที่สำเร็จยังอยู่ใน job และเปิดดูได้จาก `ศูนย์ที่นำเข้าแล้ว`
5. Pary กด retry แล้วระบบส่งกลับเข้าคิวเฉพาะ failed items; รายการอื่นไม่ถูกทำซ้ำ
