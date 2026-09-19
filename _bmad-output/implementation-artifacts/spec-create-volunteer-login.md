---
title: สร้างบัญชีใช้งานจริงจากหน้าจัดการอาสาสมัคร
created: 2026-09-05
type: bugfix
status: done
baseline_commit: 517a2e4a9c0c077b1c00b0517af0dac9b814920c
review_loop_iteration: 0
context: []
---

## Intent

ปุ่มออกสิทธิ์เดิมบันทึกเฉพาะ user_name ทำให้แสดงว่ามีบัญชีทั้งที่ล็อกอินไม่ได้ เชื่อม API จัดการผู้ใช้ที่มีอยู่เพื่อสร้างบัญชี CouchDB พร้อมบทบาท ศูนย์พักพิง และ volunteer_id แล้วบันทึกลิงก์กลับในโปรไฟล์

## Boundaries & Constraints

ใช้ API `/api/v1/users` ที่ตรวจสิทธิ์ผู้สร้างบน server ตามเดิม ไม่ส่ง admin credentials จาก browser ใช้อีเมลเป็น username ตาม dialog เดิม ให้เบอร์โทรเป็นรหัสผ่านชั่วคราวสำหรับอาสาสมัครเท่านั้นเมื่อ `must_change_password=true` และบังคับเข้า flow เปลี่ยนรหัสผ่านครั้งแรก รหัสผ่านอื่นยังใช้ password policy กลาง นำตัวเลือก QR ที่ยังไม่มีระบบรองรับออก และไม่กล่าวอ้างว่าสิทธิ์หมดอายุอัตโนมัติ

ไม่สร้างบัญชีทดสอบในฐานข้อมูลจริง ไม่เปลี่ยนระบบยืนยันตัวตนหรือเพิ่มช่องทาง QR login ไม่รีเซ็ตรหัสผ่านบัญชีเดิม และไม่ผูกบัญชีของคนอื่นเข้ากับอาสาสมัครโดยอัตโนมัติ

## I/O & Edge-Case Matrix

| กรณี | ข้อมูล | ผลลัพธ์ |
|---|---|---|
| สร้างใหม่ | อีเมลและรหัสผ่านถูกต้อง | สร้างบัญชีพร้อมบทบาทและ shelter scope แล้วบันทึก user_name/email ในโปรไฟล์ |
| ข้อมูลไม่ถูกต้อง | อีเมลหรือรหัสผ่านไม่ผ่าน schema | แจ้งข้อผิดพลาด ไม่สร้างบัญชี |
| บัญชีซ้ำ | อีเมลเป็นบัญชีที่ไม่ได้ผูกกับอาสาคนนี้ | แจ้งซ้ำ ไม่เปลี่ยนบัญชีเดิม |
| สร้างสำเร็จแต่ผูกโปรไฟล์ไม่สำเร็จ | การเขียนที่สองล้มเหลว | แจ้งว่าสร้างบัญชีแล้ว แต่ผูกไม่สำเร็จ และลองผูกใหม่ได้โดยไม่สร้าง/เปลี่ยนรหัสผ่านซ้ำ |
| โหลดข้อมูลล่าสุด | โปรไฟล์มีข้อมูลใหม่ | บันทึกเฉพาะลิงก์และอีเมลโดยรักษาข้อมูลล่าสุด |
| ไม่ได้รับอนุญาต/เครือข่ายล้มเหลว | API ปฏิเสธ | ไม่แสดงผลสำเร็จ ปุ่มกลับมาใช้งานได้ |

## Code Map

- `frontend/src/lib/features/volunteers/ui/volunteer-access-dialog.svelte`: ฟอร์มออกสิทธิ์เดิม
- `frontend/src/lib/features/users/index.ts`: public API สำหรับสร้างและอ่านผู้ใช้
- `frontend/src/lib/features/volunteers/data/volunteer.remote.ts`: repository แยกตามศูนย์
- `frontend/src/lib/auth/password-schema.ts`: กติการหัสผ่านร่วม
- `frontend/src/routes/api/v1/users/+server.ts`: API ตรวจสิทธิ์และสร้างบัญชี

## Tasks & Acceptance

- [x] `frontend/src/lib/features/volunteers/application/volunteer-access.ts`: validation และ orchestration สร้างบัญชี/ผูกโปรไฟล์ พร้อม recovery
- [x] `frontend/src/lib/features/volunteers/ui/volunteer-access-dialog.svelte`: เรียก flow จริง เพิ่มรหัสผ่าน ป้องกันการกดซ้ำ ปรับข้อความตามความสามารถจริง และ invalidate users/volunteers
- [x] `frontend/src/lib/features/volunteers/application/volunteer-access.test.ts`: ตรวจ happy path และ failure/retry ตาม matrix

Acceptance:
- Given ผู้สร้างมีสิทธิ์ when บันทึกข้อมูลถูกต้อง then ส่ง username/password/role/shelter/volunteer_id ให้ API และผูกบัญชีกลับเข้ากับโปรไฟล์
- Given บันทึกบัญชีสำเร็จแต่โปรไฟล์ล้มเหลว when ลองซ้ำ then ไม่สร้างบัญชีหรือเปลี่ยนรหัสผ่านซ้ำ
- Given บัญชีซ้ำของบุคคลอื่น when บันทึก then ไม่แก้ไขหรือยึดบัญชีนั้น

## Verification

รัน targeted Vitest, pnpm check และ lint เฉพาะไฟล์ที่แก้ ตรวจ Svelte ด้วย autofixer หากมีเครื่องมือ उपलब्ध; หากไม่มีใช้ compiler/check และ ESLint พร้อมแจ้งข้อจำกัด

## Suggested Review Order

**บัญชีและการผูกโปรไฟล์**

- ตรวจ flow สร้างบัญชีและ recovery เมื่อการเขียนโปรไฟล์ล้มเหลว
  [`volunteer-access.ts:16`](../../frontend/src/lib/features/volunteers/application/volunteer-access.ts#L16)

- ตรวจฟอร์มรหัสผ่าน บทบาท และสถานะ pending ของปุ่มบันทึก
  [`volunteer-access-dialog.svelte:20`](../../frontend/src/lib/features/volunteers/ui/volunteer-access-dialog.svelte#L20)

**การทดสอบ**

- ตรวจ happy path, collision และ retry โดยไม่เปลี่ยนรหัสผ่านเดิม
  [`volunteer-access.test.ts:72`](../../frontend/src/lib/features/volunteers/application/volunteer-access.test.ts#L72)
