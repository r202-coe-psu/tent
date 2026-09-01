---
title: Feature Flow — Daily SOP Assessment
status: proposed
created: 2026-08-31
updated: 2026-09-01
track: CR-100
---

# Daily SOP Assessment Workflow

โมดูลนี้เป็นแบบประเมินประจำวันตาม Design โดยแยกจาก Resource Dashboard และ T-32

## Flow

1. `/back-office/dailysop` โหลด Daily SOP records ของศูนย์ที่เลือก เรียงใหม่ไปเก่า โดยตารางแสดง
   ความคืบหน้าและสถานะตาม Design; ไม่แสดงคอลัมน์ `ผ่าน` แยกต่างหาก
2. กด `เริ่มการประเมิน` เพื่อสร้าง in-memory draft ของวันนี้ หากวันนี้มี snapshot แล้วให้เปิดผลเดิมในโหมดแก้ไข
3. Assessment Menu แสดง 6 cards ของหมวดคำถามและ 1 card Lifelines พร้อมตัวนับที่ตอบแล้ว
4. Section detail ให้เลือกสถานะตามตัวเลือกใน Design เท่านั้น
   ทุกครั้งที่เลือกสถานะ ระบบประทับ username จาก CouchDB session และเวลาที่เลือกไว้กับคำถามนั้น
5. เลือกอย่างน้อยหนึ่งคำตอบแล้วกดบันทึกได้ทันที; เอกสารเป็น `InProgress` จนกว่าจะเลือกครบทั้ง
   19 คำถามและ 4 Lifelines แล้วเปลี่ยนเป็น `Completed` อัตโนมัติ
6. เขียน record ด้วย deterministic ID; conflict ให้เปิดผลเดิมและไม่สร้างแถวซ้ำ
   หลังบันทึกสำเร็จให้ merge ผลลง History ทันที และแสดง success toast ผ่าน Toaster component เดิม
7. History ปุ่ม `จัดการ` เปิดผลเดิมในโหมดแก้ไข โดยเริ่มค่าจาก document ที่บันทึกไว้และให้บันทึกกลับเอกสารเดิม
8. Header แสดงสถานะการเชื่อมต่อ central CouchDB จริง; เมื่อ disconnected คำตอบยังอยู่ใน in-memory draft แต่บันทึกไม่ได้จนกว่าจะเชื่อมต่อใหม่

9. หน้าคำถามและเมนูมี action bar แบบลอยที่ใช้ซ้ำได้: บันทึกรายการใหม่หรือแก้เอกสารเดิมด้วย `_rev` โดยไม่สร้างแถวเพิ่ม

## Persistence

`daily_sop_assessment` อยู่ใน `shelter_{code}` และใช้ common envelope ของระบบ
เอกสารทั้ง `InProgress` และ `Completed` แก้ไขได้ผ่าน `จัดการ` โดยใช้ `_rev` และคง `_id`, ศูนย์, วันประเมิน
และ creation metadata เดิม การ seed ใช้วัน 9–11 มิถุนายน 2569 ตาม Design และลบเฉพาะ IDs
ของ Daily SOP ที่ seed ไว้ โดยวันที่ 9–10 มีผลผสม Pass/Fail/Pending และวันที่ 11 เป็น all-pass

Document ทั้งหมดใช้ `schema_v: 1` เดียวกัน เนื่องจาก CR-100 ยังเป็น `proposed` และ schema นี้ยังไม่
release; control ทุกข้อจึงเก็บ `answered` และ metadata ผู้ประเมินรายข้อตั้งแต่การเขียนครั้งแรก.

## Explicit boundaries

ไม่มี N/A, evidence, note, attachment, metric dashboard, approval workflow หรือ delete
Draft ที่ยังไม่กดบันทึกไม่ใช้ localStorage/sessionStorage และการออกจาก flow หรือ refresh จะเริ่ม draft ใหม่
ระบบไม่มี offline write queue และไม่อ้างว่าข้อมูลถูกซิงค์แล้วขณะ endpoint disconnected
