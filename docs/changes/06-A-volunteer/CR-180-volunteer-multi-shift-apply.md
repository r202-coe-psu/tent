---
id: CR-180
title: สมัครหลายกะในครั้งเดียว (multi-select) + คิวอนุมัติจัดกลุ่มตามผู้สมัคร
status: approved
date: 2026-10-20 (approved 2026-10-20)
updated: 2026-10-30 # amend FR-6 โดย CR-215 (เพิ่มรหัส SHIFT_CLOSED)
requested_by: ทีม dev (issue #716 — สมัครทีละกะ / อนุมัติทีละกะ)
decided_by: หัวหน้างาน (@net-lynx — ตอบใน #716 "ทำ multi-select", 2026-10-20) · approve CR + ยืนยันค่าเริ่มต้นโดย @mhapong (ผู้รับ issue) 2026-10-20
layer: volatile
affects:
  - docs/changes/06-A-volunteer/CR-104-volunteer-backoffice-and-user-management-v10.md §3.2 (Flow 2 สมัครงานภาคประชาชน — ขั้น 2 "สมัครกะนี้")
  - docs/changes/06-A-volunteer/CR-107-volunteer-shift-identity-reconciliation.md (1 ใบสมัคร = 1 กะ — คงเดิม)
  - docs/data/schema.md §2.18 job_application (หมายเหตุเท่านั้น — ไม่เปลี่ยน field)
  - BFF POST /api/public/v1/volunteer/jobs/{id}/apply (เพิ่ม `shifts[]` และ `results[]`)
  - frontend/src/lib/features/volunteer-portal/domain/volunteer.ts (`volunteerApplySchema.shifts`)
  - frontend/src/lib/features/volunteer-portal/data/volunteer-api.ts (`applyToJob` → `ApplyFailedError`)
  - frontend/src/lib/features/volunteers/server/public-application.ts (`applyPublicVolunteerApplicationToShifts`)
  - frontend/src/lib/features/volunteers/ui/public-quick-apply-modal.svelte (shift picker แบบเลือกหลายกะ + สรุปผลรายกะ)
  - frontend/src/lib/features/volunteers/domain/applicant-queue.ts (`groupApplicationsByApplicant`)
  - frontend/src/lib/features/volunteers/ui/job-applicants-tab.svelte / job-applicant-row.svelte / job-applicant-review-dialog.svelte
  - no schema_v bump (ไม่เปลี่ยนรูปร่าง doc ที่ persist)
---

# CR-180 — สมัครหลายกะในครั้งเดียว (multi-select) + คิวอนุมัติจัดกลุ่มตามผู้สมัคร

> **สรุป (TL;DR):**
>
> - ผู้สมัครเลือกได้หลายกะในงานเดียวแล้วส่งครั้งเดียว — ระบบยังสร้าง `job_application` **1 ใบต่อ 1 กะ** (CR-107) ·
>   schema ไม่เปลี่ยน ไม่ bump `schema_v`
> - ผลเป็นรายกะ: กะที่ผ่านถูกบันทึก กะที่เต็ม / เวลาชน / ไม่พบ ไม่ถูกบันทึก และผู้สมัครเห็นว่ากะไหนไม่ผ่านเพราะอะไร
> - คิวอนุมัติจัดกลุ่มใบสมัครที่รอพิจารณาตามผู้สมัคร มีปุ่ม **"อนุมัติทุกกะ"** และยังอนุมัติ / ปฏิเสธทีละกะได้
> - แก้ CR-104 §3.2 ขั้น 2 จาก "คลิก [สมัครกะนี้]" เป็น "เลือกกะได้หลายกะ แล้วกดสมัคร"

---

## Why

- งานหนึ่งมีหลายกะ (CR-104 §3.1) แต่ flow เดิมให้สมัครทีละกะ: ผู้สมัครต้องเปิดฟอร์ม กรอก และผ่าน reCAPTCHA ซ้ำทุกกะ และ
  rate limit 3 ครั้ง / 10 นาที / เบอร์ (FR-VOL-02.3) ทำให้สมัครเกิน 3 กะติดกันไม่ได้
- เจ้าหน้าที่เห็นใบสมัครของคนเดียวกันกระจายเป็นหลายแถว และต้องอนุมัติทีละแถว
- หัวหน้างานตัดสินใน #716: ทำ multi-select โดยคง 1 ใบต่อ 1 กะ

## Change

### ฝั่งสมัคร (public `/volunteers/jobs` และแท็บงานใน portal)

| | ก่อน | หลัง |
| --- | --- | --- |
| เลือกกะ | เลือกได้ 1 กะ | เลือกได้หลายกะในงานเดียว (กดซ้ำเพื่อเอาออก) |
| คำขอ | 1 คำขอ = 1 กะ | 1 คำขอ = 1..`MAX_SHIFTS_PER_APPLICATION` กะ (= 31 กะ, กะรายวัน 1 เดือน — ยืนยันแล้ว) |
| ผลลัพธ์ | สำเร็จ / ไม่สำเร็จทั้งคำขอ | ผลรายกะ: บันทึกแล้ว (`confirmed` / `pending_review`) หรือไม่ผ่าน + เหตุผล |
| rate limit / reCAPTCHA | 1 ครั้งต่อกะ | 1 ครั้งต่อคำขอ ไม่ว่าเลือกกี่กะ |

**Requirements**

- FR-1 — Shift picker ต้องเลือกได้หลายกะ; กะที่เต็มเลือกไม่ได้ (เหมือนเดิม); กะที่ทับเวลากับกะที่ผู้สมัครจองไว้แล้ว
  (portal รู้ล่วงหน้า) ต้องเลือกไม่ได้และบอกว่าชนกับงานอะไร
- FR-2 — BFF `POST /api/public/v1/volunteer/jobs/{id}/apply` รับ `shifts: [{shift_id?, shift_date?, start_time?, end_time?}]`
  (1..31 รายการ) นอกจาก `shift_id` / `shift_date` เดิม (คงไว้ให้ client เก่า)
- FR-3 — ตรวจระดับงานครั้งเดียวก่อน (ไม่พบงาน / งานไม่เปิดรับ / public_writer ใช้ไม่ได้) — ไม่ผ่านแล้วปฏิเสธทั้งคำขอ
- FR-4 — แต่ละกะผ่านการตรวจชุดเดิมของการสมัครหนึ่งกะ (กะมีจริง, ไม่สมัครซ้ำ, ไม่ทับเวลากับกะที่ได้รับมอบหมายแล้ว,
  โควตากะ / งาน) และบันทึกแยกกันทีละกะ — กะหนึ่งไม่ผ่านไม่ทำให้กะอื่นที่ผ่านแล้วถูกยกเลิก
- FR-4a — การตัดสินว่าใบสมัครต้องรอพิจารณา (`pending_review`) หรือรับทันที (`confirmed`) ใช้สถานะผู้สมัคร **ก่อนคำขอ**
  กับทุกกะในคำขอเดียวกัน — เบอร์ใหม่ที่สมัครหลายกะต้องได้ผลเหมือนกันทุกกะ (เดิมกะแรกสร้างโปรไฟล์ แล้วกะถัดไปจะถูกนับเป็น
  "มีโปรไฟล์แต่ยังไม่ยืนยันตัวตน" และติดรอพิจารณา)
- FR-5 — กะที่เลือกในคำขอเดียวกันทับเวลากันเอง: บันทึกกะที่มาก่อนตามลำดับในคำขอ (client เรียงตามวัน-เวลา)
  และตอบกะที่ตามมาว่า `TIME_CONFLICT`
- FR-6 — คำตอบมี `results[]` หนึ่งรายการต่อกะที่ขอ: `{ ok: true, shift_id, status, tracking_token }` หรือ
  `{ ok: false, shift_id, error }` โดย `error` ใช้รหัสเดิม (`SHIFT_FULL`, `JOB_FULL`, `TIME_CONFLICT`,
  `SHIFT_NOT_FOUND`, `DUPLICATE_APPLICATION`, … และ [CR-215](CR-215-close-ended-volunteer-shifts.md) เพิ่ม `SHIFT_CLOSED`)
- FR-7 — มีกะผ่านอย่างน้อย 1 กะ → HTTP 201 พร้อม `results[]` (+ ฟิลด์ระดับบนของกะแรกที่ผ่าน ให้ client เก่าอ่านได้);
  ไม่ผ่านเลย → สถานะ / รหัสของกะแรกที่ไม่ผ่าน พร้อม `results[]`
- FR-8 — `volunteer_token` (CR-127) ออกครั้งเดียวต่อคำขอ ตอนสร้างโปรไฟล์ใหม่
- FR-9 — มีกะไม่ผ่าน → ฟอร์มแสดงสรุป "บันทึกแล้ว n กะ / ไม่ผ่าน m กะ" พร้อมเหตุผลรายกะ ก่อนพาไปหน้าตั๋ว / portal;
  ไม่ผ่านเลย → แสดงเหตุผลรายกะและให้เลือกกะใหม่ได้
- FR-9a — ปิดฟอร์มระหว่างแสดงสรุปที่มีกะบันทึกแล้ว ต้องพาไปหน้าตั๋ว / portal เหมือนกด "ไปต่อ" — `volunteer_token`
  ของผู้สมัครครั้งแรกส่งกลับมาครั้งเดียวในคำตอบนั้น ถ้าปิดทิ้งผู้สมัครจะเปิดตั๋วไม่ได้
- FR-10 — preflight (`/apply/preflight`) ตรวจกะเฉพาะเมื่อเลือกกะเดียว; เลือกหลายกะ → ตรวจระดับงานอย่างเดียว
  แล้วให้ผลรายกะมาจากขั้น apply

### ฝั่งเจ้าหน้าที่ (รายละเอียดงาน → แท็บ "ผู้สมัคร")

| | ก่อน | หลัง |
| --- | --- | --- |
| รอพิจารณา | 1 แถวต่อใบสมัคร | 1 การ์ดต่อผู้สมัคร แสดงทุกกะที่รอพิจารณาของคนนั้นในงานนี้ |
| อนุมัติ | ทีละใบ | ปุ่ม "อนุมัติทุกกะ" (เมื่อรอ ≥ 2 กะ) + อนุมัติ / ปฏิเสธทีละกะ |
| ประวัติการพิจารณา | 1 แถวต่อใบสมัคร | คงเดิม |

**Requirements**

- FR-11 — จัดกลุ่มใบสมัคร `pending_review` ของงานเดียวกันตามผู้สมัคร: `volunteer_id` ถ้ามี, ไม่มีใช้
  `applicant.phone_hash`, ไม่มีใช้ `applicant.phone`; กลุ่มเรียงตามใบที่ยื่นก่อนสุด (first come, first served — คงกฎเดิม);
  กะในกลุ่มเรียงตามวัน-เวลา
- FR-12 — "อนุมัติทุกกะ" เปิด dialog เดียวกับการอนุมัติทีละกะ แสดงรายการกะ แล้วอนุมัติทีละใบตามลำดับ
  ผ่าน `useReviewApplication` เดิม (ทุกใบยังกินโควตาและสร้าง `shift_assignment` ตามเดิม)
- FR-13 — ใบที่อนุมัติไม่สำเร็จ (กะเต็ม / ถูกพิจารณาไปแล้ว / …) ไม่หยุดใบที่เหลือ และเจ้าหน้าที่เห็นว่ากะไหนไม่สำเร็จเพราะอะไร
- FR-14 — การปฏิเสธยังทำทีละกะ ต้องระบุเหตุผลทุกครั้ง (คงเดิม); ไม่มีปุ่ม "ปฏิเสธทุกกะ" ในรอบนี้

## Acceptance

- เลือก 3 กะแล้วส่ง → มี `job_application` 3 ใบ แต่ละใบ `shift_id` ตามกะ, rate limit นับ 1 ครั้ง
- เลือก 3 กะ โดย 1 กะเต็ม → บันทึก 2 ใบ, ผู้สมัครเห็น "กะ <วัน เวลา>: กะนี้เต็มแล้ว"
- เลือก 2 กะที่ทับเวลากัน → บันทึกกะแรก, กะที่สอง `TIME_CONFLICT`
- ทุกกะไม่ผ่าน → ไม่มีเอกสารถูกเขียน, ผู้สมัครเห็นเหตุผลรายกะ และยังอยู่ที่ฟอร์ม
- client เก่าที่ส่ง `shift_id` เดียว → พฤติกรรมเดิม
- คิวอนุมัติ: ผู้สมัครที่รอ 3 กะแสดงเป็นการ์ดเดียว; "อนุมัติทุกกะ" → 3 ใบเป็น `confirmed` + 3 `shift_assignment`;
  ถ้ากะหนึ่งเต็ม → 2 ใบสำเร็จ และแจ้งกะที่เต็ม

## Impact

- **BFF:** เพิ่ม field ใน request / response แบบ additive — ไม่กระทบ client เก่า
- **FastAPI / worker / MongoDB:** ไม่กระทบ (การสมัครเขียน CouchDB ผ่าน public_writer ที่ BFF)
- **CouchDB:** หนึ่งคำขอเขียนหลายเอกสาร โดยแต่ละกะเป็น write ชุดเดิม (application + assignment + volunteer)
- **Tests:** unit tests ของ batch apply, endpoint, client error, การจัดกลุ่มคิว และ e2e ของ shift picker

## Migration

N/A — ไม่เปลี่ยนรูปร่างเอกสาร ใบสมัครเก่าทุกใบเป็น 1 ใบต่อ 1 กะอยู่แล้ว (CR-107)

## Decision log

- 2026-10-20 — #716: หัวหน้างานตอบ "ทำ multi-select" — 1 ใบต่อ 1 กะ, schema ไม่เปลี่ยน, บันทึกเฉพาะกะที่ผ่าน,
  คิวอนุมัติจัดกลุ่มตามผู้สมัคร + "อนุมัติทุกกะ"
- 2026-10-20 — proposed (ร่างโดยผู้รับ issue ก่อนเริ่ม implement)
- 2026-10-20 — ยืนยันค่าเริ่มต้น: สูงสุด `MAX_SHIFTS_PER_APPLICATION = 31` กะต่อคำขอ และรอบนี้ **ไม่มี** ปุ่ม "ปฏิเสธทุกกะ"
- 2026-10-20 — approved → CR-180 (implement ใน PR #726)
