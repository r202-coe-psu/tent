---
id: draft
title: ยกเลิกการสมัครจากบัตรดิจิทัล — กติกาใหม่ (สถานะ, ก่อนเริ่มกะ, token ถาวรของจิตอาสา) และ BFF เขียน CouchDB เอง
status: proposed
date: 2026-10-28
requested_by: "#967 (ผู้รับงาน @Mhapong) + review ของ @Jackyzaz ใน PR #966 (ขอ doc amend)"
decided_by: "@net-lynx"
layer: volatile
affects:
  - docs/changes/06-A-volunteer/CR-096-volunteer-portal-dispatch-response.md (FR-96-07, FR-96-08, AC-96-04)
  - docs/sitemap.md แถว `POST /public/v1/volunteer/ticket/{token}/cancel`
  - frontend/src/lib/features/volunteers/server/public-ticket.ts
  - frontend/src/routes/api/public/v1/volunteer/ticket/[token]/** (GET, cancel)
  - backend/apiapp/modules/volunteers/router.py `/volunteer/ticket/{token}/cancel` (ไม่มีใครเรียกแล้ว)
  - ไม่เปลี่ยน schema / ไม่ bump `schema_v`
---

# draft-ticket-cancel-rules — ยกเลิกการสมัครจากบัตรดิจิทัล

> **สรุป (TL;DR):**
>
> - **ยกเลิกได้เมื่อ:** ใบสมัครเป็น `confirmed` หรือ `pending_review` และกะยังไม่เริ่ม (เวลาไทย) นอกนั้น `can_cancel = false` และ cancel ได้ 409
> - **token ถาวรของจิตอาสา (CR-127):** เปิดบัตรและยกเลิกได้ โดยระบบเลือกใบที่ยังยกเลิกได้และกะเริ่มเร็วที่สุด
> - **ทางเขียน:** BFF เขียน CouchDB เอง ลำดับคือ กะงาน → คืนโควตา → ใบสมัคร (กดซ้ำได้ ไม่คืนโควตาซ้ำ) และเลิกส่งต่อไป FastAPI cancel
> - view token จากการค้นด้วยเบอร์ยังยกเลิกไม่ได้เหมือนเดิม (AC-96-03)

---

## Why

- **#967:** เปิดบัตรด้วย token ถาวรของจิตอาสาแล้วกดยกเลิกได้ 404
  - GET หาใบสมัครผ่านจิตอาสาได้ แต่ cancel ส่งต่อไป FastAPI ที่หาจาก token ของใบสมัครใน Mongo อย่างเดียว
  - กะที่ผ่านไปแล้วยังได้ `can_cancel = true`
- **ไม่มีใครเขียน buffer ของ FastAPI แล้ว:** BFF สมัครเขียน CouchDB ตรง FastAPI cancel จึงหาใบสมัครไม่เจอเลย
- **review PR #966:**
  - ถ้า cancel ล้มกลางทาง โควตาค้างถาวร และกดซ้ำไม่ได้
  - token ถาวรหยิบใบสมัครใบไหนก็ได้ที่ `_find` คืนมาเป็นใบแรก
  - ขอให้บันทึกกติกาใหม่ เพราะ CR-096 AC-96-04 ยังเขียนว่า tracking token ได้ `can_cancel = true` เสมอ

## Change

### FR

- **FR-1 resolve token** (ใช้ร่วมกันทั้ง GET และ cancel):
  - หาจาก `tracking_token_hash` ของใบสมัครก่อน
  - ถ้าไม่เจอ หาจิตอาสาที่ token ตรง (token ถาวร CR-127) แล้วเลือกใบสมัครของคนนั้น
    - ใบที่ยังยกเลิกได้ (FR-2) และกะเริ่มเร็วที่สุด
    - ถ้าไม่มีใบแบบนั้น ใช้ใบล่าสุดตามวันกะ แล้วตาม `created_at`
- **FR-2 เงื่อนไขยกเลิก:**
  - `status ∈ {confirmed, pending_review}`
  - เวลาปัจจุบันยังไม่ถึงเวลาเริ่มกะ (`selected_shift.date` + `start_time`, Asia/Bangkok)
  - `can_cancel` ใน GET คืนตามเงื่อนไขนี้
- **FR-3 error:**

  | กรณี                             | ผล                     |
  | -------------------------------- | ---------------------- |
  | สถานะไม่ผ่าน FR-2 (รวมยกเลิกซ้ำ) | 409 `NOT_CANCELLABLE`  |
  | กะเริ่มแล้ว                      | 409 `SHIFT_STARTED`    |
  | token ไม่พบ                      | 404 `TICKET_NOT_FOUND` |
  | เขียนไม่สำเร็จ                   | 502 `WRITE_FAILED`     |

- **FR-4 ลำดับการเขียน (CouchDB ผ่าน public writer):**
  1. ยกเลิก `shift_assignment` ที่ผูกกับใบสมัคร (`assigned` / `standby`)
  2. คืนโควตา (งานและกะ) เฉพาะใบ `confirmed` และเฉพาะเมื่อขั้นที่ 1 เพิ่งยกเลิกกะงานได้ หรือไม่มีกะงานที่ผูกอยู่เลย
  3. เปลี่ยนใบสมัครเป็น `cancelled` เป็นขั้นสุดท้าย
  - ถ้าขั้นไหนล้ม ใบสมัครยังเป็นสถานะเดิม จึงกดยกเลิกซ้ำได้ และไม่คืนโควตาซ้ำ
  - ในกรณีที่หายาก อาจคืนโควตาขาดไป 1 ซึ่งปลอดภัยกว่าคืนเกิน
- **FR-5:** view token จากการค้นด้วยเบอร์ยังได้ `can_cancel = false` และ cancel ได้ 404 (AC-96-03 เดิม)
- **FR-6:** BFF ไม่ส่งต่อ cancel ไป FastAPI แล้ว ส่วน route `/public/v1/volunteer/ticket/{token}/cancel` ของ FastAPI ยังอยู่แต่ไม่มีใครเรียก ให้ลบใน follow-up

### CR-096

| ข้อ      | ก่อน                                                             | หลัง                                                                                          |
| -------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| FR-96-07 | คืน `can_cancel` ตามชนิดของ token                                | ตามชนิดของ token **และ** FR-2 ของ draft นี้                                                   |
| FR-96-08 | cancel รับเฉพาะ tracking token                                   | tracking token ของใบสมัครหรือ token ถาวรของจิตอาสา (FR-1) ภายใต้ FR-2 ส่วน view token ตอบ 404 |
| AC-96-04 | เปิดบัตรด้วย tracking token ได้ `can_cancel = true` และยกเลิกได้ | ได้ `can_cancel = true` และยกเลิกได้ **เมื่อเข้า FR-2** กะที่เริ่มแล้วได้ `false` / 409       |

### docs/sitemap.md

- แถว `POST /public/v1/volunteer/ticket/{token}/cancel` ระบุว่าทางที่ใช้จริงคือ BFF `POST /api/public/v1/volunteer/ticket/{token}/cancel` เขียน CouchDB (draft นี้) และ route ของ FastAPI ไม่มีใครเรียกแล้ว

## Acceptance

- **AC-1:** token ถาวรที่มีใบอนาคต 2 ใบ เปิดบัตรแล้วเห็นใบที่เริ่มเร็วกว่า ยกเลิกแล้วรีเฟรชจะเห็นใบถัดไป
- **AC-2:** ใบ `confirmed` ยกเลิกแล้วโควตาคืน 1 ครั้ง ยกเลิกซ้ำได้ 409 และโควตาไม่เปลี่ยน
- **AC-3:** คืนโควตาล้ม ได้ 502 ใบสมัครยังเป็นสถานะเดิม กดซ้ำสำเร็จ และไม่คืนโควตาซ้ำ
- **AC-4:** กะที่เริ่มแล้ว `can_cancel = false` และ cancel ได้ 409 `SHIFT_STARTED`

## Impact

- **code / test:** PR #966 (`public-ticket.ts`, `public-ticket.test.ts`, route test)
- **ข้อมูล:** ไม่มีการ migrate

## Migration

ไม่มี

## Decision log

- 2026-10-27 — #967: ผู้รับงานสั่งให้แก้ใน PR #966
- 2026-10-28 — แก้ลำดับการเขียนและการเลือกใบสมัครของ token ถาวรตาม review ของ PR #966
- 2026-10-28 — proposed ใน PR #966 รอ @net-lynx approve
