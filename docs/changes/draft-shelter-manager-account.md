---
id: draft
title: สร้างบัญชีผู้จัดการศูนย์ (shelter_manager) อัตโนมัติจาก contact ของศูนย์
status: proposed
date: 2026-11-18
requested_by: ทีมพัฒนา (จัดการศูนย์อพยพ)
decided_by: kong
layer: volatile
affects:
  - docs/data/schema.md — shelter `contact.{name,phone}` (ไม่เปลี่ยนรูป doc) · `_users` doc ที่ถูกสร้าง
  - docs/prd/role-permission-matrix.md — SM (การออกบัญชีให้ SM ทำโดย SA ผ่านการบันทึกศูนย์)
  - no schema_v bump (ใช้ field เดิม)
  - frontend/src/lib/features/shelters/domain/manager-account.ts (+ test)
  - frontend/src/lib/features/shelters/server/manager-account.ts (+ test)
  - frontend/src/routes/api/back-office/shelter/+server.ts · [code]/+server.ts
  - frontend/src/lib/features/shelters/data/shelters.api.ts · application/queries.ts
---

# draft-shelter-manager-account — สร้างบัญชีผู้จัดการศูนย์จาก contact

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เมื่อบันทึกศูนย์โดย SA และ `contact.name` + `contact.phone` (เบอร์มือถือ 10 หลัก) ถูกกรอก ระบบสร้าง user `shelter_manager` ของศูนย์นั้นให้อัตโนมัติ
> - **เพื่อ:** ลดขั้นตอนออกบัญชีผู้จัดการศูนย์แยกที่หน้า users
> - **build:** helper ฝั่ง server เรียกต่อจาก POST/PATCH ศูนย์ + toast ผลลัพธ์ฝั่ง UI
> - **กระทบ:** ไม่ bump `schema_v` · Implementation: PR #1440

---

## Requirements

- FR-1 — เมื่อ SA บันทึกศูนย์ (สร้างหรือแก้ไข) และ `contact.name` ไม่ว่าง และ `contact.phone` เป็นเบอร์มือถือ 10 หลัก (`^0\d{9}$` หลัง normalize) ระบบต้องสร้าง `_users` doc หนึ่งบัญชี
- FR-2 — ค่าของบัญชี:

  | field                  | ค่า                                                 |
  | ---------------------- | --------------------------------------------------- |
  | `name` (username)      | เบอร์โทร                                            |
  | `display_name`         | `contact.name`                                      |
  | `phone`                | เบอร์โทร                                            |
  | password               | `{phone}Sh{ตัวเลขใน code}/` เช่น `0812345678Sh001/` |
  | `roles`                | `shelter:{code}`, `{code}:shelter_manager`          |
  | `personnel_type`       | `staff`                                             |
  | `must_change_password` | `true`                                              |

- FR-3 — `contact` ไม่ครบ หรือเบอร์ไม่ถูกรูปแบบ → ไม่สร้างบัญชี และบันทึกศูนย์ต่อได้ตามปกติ
- FR-4 — เบอร์หรือ username ซ้ำกับบัญชีเดิม (`CONFLICT`) → ไม่สร้างทับ ไม่แก้บัญชีเดิม ไม่ทำให้การบันทึกศูนย์ล้มเหลว
- FR-5 — การสร้างบัญชีล้มเหลวด้วยสาเหตุอื่น → ศูนย์ยังบันทึกสำเร็จ และต้องแจ้งผู้ใช้
- FR-6 — เฉพาะ SA เท่านั้นที่สร้างบัญชีได้; SM ที่บันทึกศูนย์ตนเองต้องไม่สร้างบัญชี (สอดคล้อง `assertCanGrant`)
- FR-7 — PATCH ศูนย์สร้างบัญชีเฉพาะเมื่อ body มี key `contact`
- FR-8 — response POST/PATCH ศูนย์เพิ่ม `manager_account`: `created{username} | exists{message} | skipped | failed{message}`
- FR-9 — UI แสดง toast: `created` = success, `failed` = error, `exists` = warning เฉพาะตอนสร้างศูนย์ (ตอนแก้ไขไม่แจ้ง เพื่อไม่ให้เตือนซ้ำทุกครั้งที่บันทึก)

## Acceptance

- SA สร้างศูนย์พร้อม contact ครบ → login ด้วยเบอร์ + รหัสตาม FR-2 ได้ และถูกบังคับเปลี่ยนรหัสผ่าน
- SA แก้ศูนย์ที่ยังไม่มีบัญชี โดยเติม contact → บัญชีถูกสร้าง
- contact ว่าง / เบอร์ผิดรูปแบบ → ไม่มีบัญชีเกิดขึ้น ศูนย์บันทึกได้
- เบอร์ซ้ำ → ศูนย์บันทึกได้ บัญชีเดิมไม่เปลี่ยน
- SM บันทึก contact ของศูนย์ตนเอง → ไม่มีบัญชีเกิดขึ้น

## Why

ผู้จัดการศูนย์ต้องมี login ทุกศูนย์; เดิมต้องสร้างแยกที่หน้า users ซ้ำกับข้อมูล contact ที่กรอกอยู่แล้วในฟอร์มศูนย์.

## Change

- **Before:** `contact` เป็นข้อมูลติดต่อเท่านั้น ไม่มีผลต่อบัญชีผู้ใช้
- **After:** `contact` ที่ครบเป็นตัวกระตุ้นการสร้างบัญชี `shelter_manager` (FR-1..9)

## Impact

- Code/test: ตาม `affects` (Implementation PR #1440)
- Security: รหัสผ่านเริ่มต้นเดาได้จากเบอร์ + รหัสศูนย์ → ลดความเสี่ยงด้วย `must_change_password: true` (FR-2); ผู้ตัดสินใจรับความเสี่ยงของรูปแบบรหัสนี้
- Doc อื่น: ไม่มีการแก้ `schema.md` / role matrix ในแถว CR นี้ (ไม่เพิ่ม field / ไม่เพิ่ม role)

## Migration

N/A — ไม่เปลี่ยนรูป doc ที่ persist; ศูนย์เดิมที่มี contact อยู่แล้วจะได้บัญชีเมื่อ SA บันทึกศูนย์ครั้งถัดไปที่ส่ง `contact`.

## Decision log

- 2026-11-18 — proposed (วิธี track: CR ไฟล์ ตามที่เจ้าของโครงการเลือก); implement แยก PR #1440
