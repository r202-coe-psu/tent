---
title: Password Policy
status: active
created: 2026-07-01
updated: 2026-09-01 # CR-105: Memorable Temporary Passphrase & Security Questions Policy
note: นโยบายการตั้งรหัสผ่านสำหรับระบบ Smart Shelter
---

# Password Policy (นโยบายรหัสผ่าน)

เอกสารนี้กำหนดมาตรฐานการตั้งรหัสผ่านสำหรับผู้ใช้งานระบบ Smart Shelter เพื่อให้สอดคล้องกับมาตรฐานความปลอดภัย และใช้เป็นแหล่งอ้างอิง (Single Source of Truth) สำหรับการตรวจสอบ (Validation) ทั้งฝั่ง Client และ Server

---

## 1. กฎการตั้งรหัสผ่านถาวร (Permanent Password Requirements)

รหัสผ่านที่ถูกต้องจะต้องผ่านเงื่อนไข **ทุกข้อ** ดังต่อไปนี้:

1. **ความยาว (Length):** ต้องมีความยาวไม่น้อยกว่า **10 ตัวอักษร**
2. **ตัวพิมพ์ใหญ่ (Uppercase):** ต้องมีตัวอักษรภาษาอังกฤษพิมพ์ใหญ่ (A-Z) อย่างน้อย **1 ตัว**
3. **ตัวพิมพ์เล็ก (Lowercase):** ต้องมีตัวอักษรภาษาอังกฤษพิมพ์เล็ก (a-z) อย่างน้อย **1 ตัว**
4. **ตัวเลข (Digit):** ต้องมีตัวเลข (0-9) อย่างน้อย **1 ตัว**
5. **อักขระพิเศษ (Special Character):** ต้องมีอักขระพิเศษที่ไม่ใช่ตัวอักษรและตัวเลข (เช่น `!@#$%^&*`) อย่างน้อย **1 ตัว**

> **หมายเหตุ:** รหัสผ่านจะถูกลบช่องว่างหัวท้าย (trim) ออกก่อนทำการตรวจสอบความยาวในฝั่งระบบ

---

## 2. รหัสผ่านชั่วคราวแบบจำง่าย (Memorable Temporary Passphrase / Admin OTP)

กรณีที่ผู้จัดการศูนย์ (Shelter Manager) หรือผู้ดูแลระบบ (System Admin) ดำเนินการรีเซ็ตรหัสผ่านให้แก่ผู้ใช้งานในหน้าจัดการผู้ใช้:

1. **รูปแบบ Passphrase:** ระบบจะสร้างรหัสผ่านชั่วคราวในรูปแบบ `Word1-Word2-Digits!` เช่น `Safe-Camp-2026!`, `River-Star-4921!`
2. **พูลคำศัพท์ (Word Pool):** สุ่มจับคู่จากพูล 100 คำศัพท์ภาษาอังกฤษที่จำง่าย ออกเสียงชัดเจน และไม่กำกวมทางโทรศัพท์/วิทยุสื่อสาร
3. **ความสอดคล้องกับนโยบาย:** รูปแบบ Passphrase นี้ผ่านเกณฑ์ความยาว $\ge 10$ ตัวอักษร, มีตัวพิมพ์ใหญ่, ตัวพิมพ์เล็ก, ตัวเลข 4 หลัก และเครื่องหมาย `!`
4. **การบังคับเปลี่ยนรหัสผ่าน:** เมื่อถูกรีเซ็ต เอกสาร `_users` จะถูกตั้งค่า `must_change_password: true` เพื่อบังคับให้ผู้ใช้ต้องตั้งรหัสผ่านถาวรของตนเองทันทีที่เข้าสู่ระบบ

---

## 3. นโยบายคำถามความปลอดภัย (Security Questions Recovery Policy)

สำหรับการกู้คืนรหัสผ่านด้วยตนเอง (Self-Service Recovery):

1. **6 คำถามมาตรฐาน (Fixed Catalog):**
   * `high_school`: โรงเรียนมัธยมที่คุณเคยศึกษาคือที่ใด?
   * `birth_province`: จังหวัดที่คุณเกิดคือจังหวัดใด?
   * `first_pet`: สัตว์เลี้ยงตัวแรกของคุณชื่ออะไร?
   * `primary_school`: โรงเรียนประถมที่คุณเคยศึกษาคือที่ใด?
   * `favorite_teacher`: คุณครูที่คุณประทับใจมากที่สุดชื่ออะไร?
   * `first_workplace`: สถานที่ทำงานหรือบริษัทแห่งแรกของคุณคือที่ใด?
2. **การจัดเก็บอย่างปลอดภัย (Salted Hashing):**
   * คำตอบความปลอดภัยจะถูกตัดช่องว่างหัวท้าย (Trim) และแปลงเป็นตัวพิมพ์เล็ก (Lowercase) ก่อนทำการ Hash
   * ระบบใช้ **Salted SHA-256** (สุ่ม Salt 16 bytes) บันทึกในฟิลด์ `security_question: { question_id, answer_hash, salt, set_at }`
   * การตรวจสอบคำตอบใช้ `timingSafeEqual` เพื่อป้องกัน Timing Attack

---

## 4. การบังคับใช้ (Enforcement)

กฎเหล่านี้ถูกบังคับใช้สองชั้น เพื่อป้องกันข้อมูลที่ไม่ผ่านเกณฑ์เข้าสู่ระบบและให้ Feedback แก่ผู้ใช้งานได้ทันที:

- **Client-side (Zod):** 
  ถูกกำหนดไว้ใน `frontend/src/lib/auth/password-schema.ts` และ `frontend/src/lib/features/users/domain/schema.ts` เพื่อให้ผู้ใช้งานเห็น Validation Error ทันทีใน UI ก่อนกด Submit

- **Server-side (Validation Logic):**
  ถูกตรวจสอบซ้ำที่ `frontend/src/lib/server/password-policy.ts` (ใช้งานผ่านฟังก์ชัน `validatePassword`) หาก Request มีรหัสผ่านที่ไม่ผ่านเกณฑ์ จะส่งคืน `ServiceError('VALIDATION', ...)`

---

## 5. ประวัติการแก้ไข (Changelog)

| วันที่ | เวอร์ชัน | รายละเอียดการเปลี่ยนแปลง | อ้างอิง | ผู้รับรอง |
| --- | --- | --- | --- | --- |
| 2026-07-01 | 1.0 | กำหนดมาตรฐานความยาว 10 ตัวอักษร, พิมพ์ใหญ่, พิมพ์เล็ก, ตัวเลข และอักขระพิเศษ | [CR-027](../changes/CR-027-user-schema-update-and-password-policy.md) | Soravit Sukkarn |
| 2026-09-01 | 2.0 | เพิ่มมาตรฐาน Memorable Temporary Passphrase (Admin OTP) และนโยบายคำถามความปลอดภัยสำหรับ Self-Service Recovery | [CR-105](../changes/CR-105-user-form-redesign-security-questions-and-passphrase-reset.md) | Project Owner |
