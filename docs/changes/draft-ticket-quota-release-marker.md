---
id: draft
title: ยกเลิกการสมัครจากบัตรดิจิทัล — คืนโควตาครั้งเดียวพอดีเมื่อกดซ้ำหลังคืนโควตาล้ม (marker บนใบสมัคร + ledger บน job)
status: proposed
date: 2026-10-29
requested_by: "#1003 (ผู้เปิด @Mhapong) — follow-up ของ D4 ใน CR-212 (review PR #999 B4)"
decided_by: รอ approve (@Jackyzaz)
layer: volatile
affects:
  - docs/changes/06-A-volunteer/CR-212-ticket-cancel-rules.md (FR-3 แถว "รวมยกเลิกซ้ำ", FR-4 ทั้งข้อรวม "ข้อจำกัดที่รู้ — โควตาขาด 1", AC-2, AC-3)
  - docs/data/schema.md §2.18 `job_application` (+`quota_release_due_at`, +`quota_released_at`) · schema_v 3 → 4
  - docs/data/schema.md §2.9 `shift_assignment` (+`cancel_application_id`) · schema_v 5 → 6 (หรือ 6 → 7 ถ้า CR ของ #885 merge ก่อน)
  - docs/data/schema.md §2.17 `job` (+`released_application_ids`) · schema_v 3 → 4
  - frontend/src/lib/features/volunteers/server/public-ticket.ts (`cancelTicket`, `cancelLinkedAssignments`, `markApplicationCancelled`, `readCancellableApplication`, `isTicketCancellable`)
  - frontend/src/lib/features/volunteers/server/public-schedule-action.ts (`releaseJobQuota` รับ idempotency key)
  - frontend/src/routes/api/public/v1/volunteer/ticket/[token]/+server.ts (`can_cancel`)
  - frontend/src/lib/features/volunteers/domain/{job-application.schema.ts,shift-assignment.schema.ts,job.schema.ts} (Zod รับ field ใหม่ + schema_v ใหม่)
  - frontend/src/lib/features/volunteers/server/public-ticket.test.ts · public-schedule-action.test.ts · routes/api/public/v1/volunteer/ticket/[token]/ticket.test.ts
  - VDU frontend/src/lib/server/shelter-access-design.ts — ไม่เปลี่ยน (ดู Impact)
  - worker projectors `job` / `job_application` / `shift_assignment` — ไม่เปลี่ยน, ไม่ bump `PROJECTION_VERSION`
why: กดยกเลิกซ้ำหลังคืนโควตาล้ม โควตาขาด 1 ถาวร (ข้อจำกัดที่รู้ D4 ของ CR-212) เพราะไม่มีที่บันทึกว่าโควตาของใบสมัครนี้คืนแล้วหรือยัง
migration: เพิ่ม field แบบ optional ทั้งหมด อ่าน doc เดิมโดยถือว่าไม่มี marker (ความหมายเดียวกับพฤติกรรมเดิม) ไม่ backfill — ดู §Migration
---

# draft-ticket-quota-release-marker — คืนโควตาครั้งเดียวพอดีเมื่อยกเลิกบัตรซ้ำ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ยกเลิกจากบัตรดิจิทัลแล้วคืนโควตาล้ม (502) กดซ้ำต้องได้โควตาคืนครบ 1 และกดซ้ำอีกไม่คืนเกิน ทั้งใบที่มีและไม่มีกะงานผูก — ปิดข้อจำกัด "โควตาขาด 1" ของ CR-212 FR-4
> - **ต่างจากที่ issue เสนอ:** #1003 เสนอ marker บนใบสมัครอย่างเดียว — design นี้เพิ่ม `job.released_application_ids` (ledger) และตรา `shift_assignment.cancel_application_id` ด้วย เพราะ CouchDB เขียนข้าม doc แบบ atomic ไม่ได้ ("คืนแล้ว" ต้องอยู่ใน doc เดียวกับตัวนับจึงคืนครั้งเดียวพอดี) และกะงาน `cancelled` แยกไม่ได้ว่ามาจากบัตรหรือจากการถอนตัว/ถอดออกที่คืนโควตาเองแล้ว (ดู Why)
> - **build:** ledger `job.released_application_ids` เขียนในครั้งเดียวกับตัวนับโควตา (กันคืนซ้ำ) · `shift_assignment.cancel_application_id` บอกว่ากะงานถูกยกเลิกจากบัตรของใบไหน (หนี้โควตาของใบนี้) · `job_application.quota_release_due_at` / `quota_released_at` บอกสถานะการคืนบนใบสมัคร
> - **กระทบ schema:** `job_application` 3→4, `shift_assignment` 5→6, `job` 3→4 (optional ทั้งหมด ไม่ backfill) · Zod 3 type ต้องรับ field ใหม่ (`job` `z.literal(3)` ต้องรับ 4 ใน PR เดียวกัน) ไม่อย่างนั้นการบันทึกของเจ้าหน้าที่จะลบ field ทิ้ง
> - กติกาว่ายกเลิกได้เมื่อไร (CR-212 FR-1, FR-2) ไม่เปลี่ยน ยกเว้นการ "ทำต่อให้จบ" ของใบที่ยกเลิกไปแล้วแต่ยังคืนโควตาไม่สำเร็จ (FR-6) · ข้อตัดสินเคาะแล้ว 2026-10-29 (ดู Decision log)

---

## Why

- **CR-212 FR-4 (D4):** ยอมรับโควตาขาด 1 เป็นข้อจำกัดที่รู้ และให้แก้ใน #1003
  - ใบที่มีกะงานผูก: กะงานถูกยกเลิกแล้ว คืนโควตาล้ม → กดซ้ำ `cancelLinkedAssignments` คืน `matched > 0, cancelled = 0` จึงไม่คืนโควตา
  - ใบที่ไม่มีกะงานผูก: ใบสมัครเป็น `cancelled` แล้ว คืนโควตาล้ม → กดซ้ำได้ 409 `NOT_CANCELLABLE`
- **marker บนใบสมัครอย่างเดียวไม่พอ:** CouchDB เขียนข้าม doc แบบ atomic ไม่ได้ ถ้าเขียน marker หลังคืนโควตา แล้วเขียนใบสมัครล้ม กดซ้ำจะคืนเกิน 1 ถ้าเขียนก่อน แล้วคืนโควตาล้ม กดซ้ำจะขาด 1 สิ่งที่บอกว่า "คืนแล้ว" ต้องอยู่ใน doc เดียวกับตัวนับ (`job`) จึงคืนครั้งเดียวพอดี
- **กะงานที่ `cancelled` แยกที่มาไม่ได้:** ยกเลิกจากบัตร (ยังค้างคืนโควตา) ถอนตัวจาก portal และเจ้าหน้าที่ถอดออกจากกะ (คืนโควตาเองแล้ว) ใช้สถานะ `cancelled` เหมือนกัน ถ้านับว่าค้างคืนทุกกะงานที่ `cancelled` จะคืนเกินให้กะที่ถอนตัวไปแล้ว ต้องมีตราบนกะงานที่ยกเลิกจากบัตร

## Change

### Schema (`docs/data/schema.md`)

| doc type                | field ใหม่                 | ชนิด      | req | ความหมาย                                                                                                                          |
| ----------------------- | -------------------------- | --------- | --- | --------------------------------------------------------------------------------------------------------------------------------- |
| `job_application` §2.18 | `quota_release_due_at`     | ts\|null  | opt | ใบนี้ถูกยกเลิกแล้วและยังค้างคืนโควตา 1 ที่ — เขียนพร้อมกับ `status: cancelled` (ใบที่ไม่มีกะงานผูกเท่านั้น)                       |
| `job_application` §2.18 | `quota_released_at`        | ts\|null  | opt | โควตาของใบนี้คืนให้ `job` แล้ว — มีค่าเมื่อการคืนสำเร็จเท่านั้น ใบที่ไม่เคยกินโควตา (`pending_review`) ไม่มีค่า                   |
| `shift_assignment` §2.9 | `cancel_application_id`    | str\|null | opt | → `job_application:{ulid}` ที่ยกเลิกกะงานนี้จากบัตร — เขียนในครั้งเดียวกับ `status: cancelled` โดย ticket cancel เท่านั้น         |
| `job` §2.17             | `released_application_ids` | [str]     | opt | `_id` ของใบสมัครที่คืนโควตาให้งานนี้แล้วผ่าน ticket cancel — ตรวจและเพิ่มในครั้งเดียวกับการลด `slots_confirmed` (idempotency key) |

- ไม่มีค่า = `null` / `[]` (ความหมายเดียวกับ doc เดิม)
- เขียนโดย public writer (BFF ticket cancel) เท่านั้น ทางเขียนอื่นต้องคงค่าเดิมไว้ (FR-9)

### FR

- **FR-1 คืนโควตาแบบ idempotent:** `releaseJobQuota` รับ key = `_id` ของใบสมัคร ทุกรอบ retry อ่าน `job` ใหม่
  - key อยู่ใน `released_application_ids` แล้ว → ไม่เขียน ถือว่าสำเร็จ
  - ไม่อยู่ → ลด `slots_confirmed` / เพิ่ม `slots_remaining` (job และกะ ตามโค้ดเดิม) และเพิ่ม key ลง `released_application_ids` ในการเขียนครั้งเดียวกัน (พร้อม `_rev`; 409 → อ่านใหม่)
  - ไม่ส่ง key (ทางถอนตัวจาก portal) → ทำงานแบบเดิม ไม่แตะ ledger
- **FR-2 ใบสมัครเป็นหน่วยของโควตา:** ใบ `confirmed` ที่มี `job_id` ค้างโควตา 1 ที่ ไม่ว่าจะผูกกะงานกี่ใบ คืนได้ไม่เกิน 1 ครั้งต่อใบ (key เดียว)
- **FR-3 ใบที่มีกะงานผูก — ลำดับ:** กะงาน → คืนโควตา → ใบสมัคร (คงลำดับ CR-212)
  1. ยกเลิกกะงานที่ผูกและยัง `assigned` / `standby` โดยเขียน `status: cancelled` + `cancel_application_id = <ใบนี้>` ในครั้งเดียวกัน
  2. ค้างคืนโควตาเมื่อ ใบเป็น `confirmed` **และ** มีกะงานที่ผูกที่ `status = cancelled` และ `cancel_application_id = <ใบนี้>` (ยกเลิกในคำขอนี้หรือคำขอก่อนก็ได้) → เรียก FR-1
  3. เปลี่ยนใบเป็น `cancelled` + `quota_released_at = now` (ถ้าข้อ 2 ค้างคืน) เป็นขั้นสุดท้าย
  - กะงานที่ `cancelled` แต่ไม่มี `cancel_application_id` หรือเป็นใบอื่น (ถอนตัวจาก portal, เจ้าหน้าที่ถอดออก, ข้อมูลเดิม) ไม่นับว่าค้าง — ทางนั้นคืนโควตาเองแล้ว
  - ขั้นไหนล้ม ใบสมัครยังเป็นสถานะเดิม กดซ้ำทำต่อได้: ข้อ 1 ข้ามกะงานที่ยกเลิกแล้ว ข้อ 2 เห็นตราของใบนี้จึงคืน และ ledger กันไม่ให้คืนซ้ำถ้าคำขอก่อนคืนสำเร็จแล้ว
- **FR-4 ใบที่ไม่มีกะงานผูก — ลำดับ:** ใบสมัคร → คืนโควตา → ปิด marker (ใบสมัครยังเป็นตัวแรก ตาม CR-212)
  1. เปลี่ยนใบเป็น `cancelled` และ ถ้าใบเดิม `confirmed` และมี `job_id` เขียน `quota_release_due_at = now` ในครั้งเดียวกัน (พร้อม `_rev`)
  2. คืนโควตาผ่าน FR-1
  3. เขียน `quota_released_at = now` บนใบสมัคร
  - คืนโควตาก่อนเปลี่ยนสถานะไม่ได้: ถ้าเขียนใบสมัครล้มแล้วไม่มีใครกดซ้ำ ใบจะยัง `confirmed` ทั้งที่ที่ว่างถูกคืนไปแล้ว (คนเกินโควตา)
- **FR-5 กดซ้ำ — แยก 3 กรณีจากใบสมัคร:**

  | สถานะใบ                                                             | ผล                                                      |
  | ------------------------------------------------------------------- | ------------------------------------------------------- |
  | `confirmed` / `pending_review`                                      | ยกเลิกตามปกติ (CR-212 FR-2 · FR-3 / FR-4 ของ draft นี้) |
  | `cancelled` + มี `quota_release_due_at` + ไม่มี `quota_released_at` | ทำต่อ: FR-4 ข้อ 2–3 แล้วตอบสำเร็จ                       |
  | `cancelled` อื่น ๆ (คืนครบแล้ว, ไม่เคยค้าง, ข้อมูลเดิม)             | 409 `NOT_CANCELLABLE` ไม่เขียนอะไร (เหมือน CR-212)      |

- **FR-6 การทำต่อไม่ตรวจเวลาเริ่มกะ:** กรณี "ทำต่อ" ใน FR-5 ไม่ใช้เงื่อนไขกะยังไม่เริ่มของ CR-212 FR-2 เพราะใบถูกยกเลิกไปแล้วก่อนกะเริ่ม เหลือแค่คืนโควตา
  - **ข้อจำกัดที่รู้ (เคาะ 2026-10-29):** ใบที่มีกะงานผูก (FR-3) ที่คืนโควตาล้มแล้วกะเริ่มก่อนกดซ้ำ ใบยัง `confirmed` จึงติด CR-212 FR-2 → 409 `SHIFT_STARTED` และกะขาด 1 ที่ — ระบบไม่แก้ให้ เจ้าหน้าที่ปรับตัวนับเอง (เกิดเมื่อคืนล้ม **และ** ไม่มีใครกดซ้ำก่อนกะเริ่มเท่านั้น)
- **FR-7 GET `can_cancel`:** คืน `true` สำหรับใบในสถานะ "ทำต่อ" ของ FR-5 ด้วย (อ่านจากใบสมัครอย่างเดียว) เพื่อให้กดซ้ำได้หลังรีเฟรช
  - บัตรแสดงปุ่มยกเลิกเดิม ไม่เพิ่ม field หรือข้อความใหม่ใน response / UI
- **FR-8 คำขอพร้อมกัน:**
  - ยกเลิก 2 ครั้งพร้อมกัน ใบที่มีกะงานผูก: เขียนกะงานชนกัน ฝั่งที่แพ้อ่านใหม่เห็น `cancelled` ข้ามไป ทั้งคู่เห็นตราของใบนี้และเรียก FR-1 ฝั่งที่แพ้ `_rev` ของ `job` อ่านใหม่เจอ key แล้วไม่เขียน เขียนใบสมัครชนกัน ฝั่งที่แพ้ได้ 409 `NOT_CANCELLABLE`
  - ยกเลิก 2 ครั้งพร้อมกัน ใบที่ไม่มีกะงานผูก: ฝั่งที่แพ้การเขียนใบสมัครอ่านใหม่เจอสถานะ "ทำต่อ" จึงทำต่อ (FR-5) ledger กันคืนซ้ำ ทั้งคู่ได้สำเร็จ เมื่อมี `quota_released_at` แล้ว คำขอถัดไปได้ 409
  - ยกเลิกจากบัตรพร้อมกับถอนตัวจาก portal หรือเจ้าหน้าที่ถอดออกจากกะ: การเขียนกะงานที่ชนะเป็นผู้คืนโควตา ฝั่งที่ชนะเป็นบัตร → กะงานมีตรา บัตรคืน · ฝั่งอื่นชนะ → กะงานไม่มีตรา บัตรไม่คืน · ทั้งสองทางคืนรวม 1 ครั้ง
- **FR-9 ทางเขียนอื่นต้องคง field (ไม่ต้องเขียนหรืออ่านเพื่อตัดสินใจ):**
  - Zod `jobApplicationSchema`, `shiftAssignmentSchema`, `jobSchema` รับ field ใหม่ (optional) และ `schema_v` ใหม่ ไม่อย่างนั้น `parse` ตอนบันทึกของเจ้าหน้าที่จะตัด field ทิ้ง (ledger หาย = กดซ้ำคืนเกิน) และ `isJobApplication` จะกรองใบ v4 ออกจากรายการ
  - เจ้าหน้าที่ยกเลิกใบ (`JobApplicationRemoteRepository#cancel`): ทำได้เฉพาะ `pending_review` ไม่มีโควตา ไม่เปลี่ยน logic
  - เจ้าหน้าที่ถอดออกจากกะ (`ShiftAssignmentRemoteRepository#unassign`) และถอนตัวจาก portal (`applyPublicScheduleAction` withdraw): คืนโควตาเองต่อกะงาน ไม่เขียนตราและไม่ใช้ ledger — คงเดิม
  - แก้ไขงาน / ตัวนับของเจ้าหน้าที่ (`JobRemoteRepository` `mutateQuota`, save): คง `released_application_ids` ไว้
- **FR-10 นอกขอบเขต:** ถอนตัวจาก portal ที่คืนโควตาล้มหลังยกเลิกกะงานก็ขาด 1 แบบเดียวกัน (กดซ้ำได้ `SHIFT_NOT_WITHDRAWABLE`) — แก้ใน issue follow-up แยก ไม่อยู่ใน CR นี้

### CR-212 (before → after)

| ข้อ                                         | ก่อน                                                     | หลัง                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| FR-3 แถว "สถานะไม่ผ่าน FR-2 (รวมยกเลิกซ้ำ)" | ยกเลิกซ้ำได้ 409 `NOT_CANCELLABLE` เสมอ                  | ยกเว้นใบที่ยังค้างคืนโควตา (FR-5 ของ draft นี้) ซึ่งทำต่อแล้วตอบสำเร็จ                                                                 |
| FR-4 ใบที่มีกะงานผูก ข้อ 2                  | คืนโควตาเฉพาะเมื่อขั้นที่ 1 **เพิ่ง** ยกเลิกกะงานได้     | คืนเมื่อมีกะงานที่ `cancel_application_id` = ใบนี้ (คำขอนี้หรือคำขอก่อน) โดย ledger ของ `job` กันคืนซ้ำ (FR-1, FR-3)                   |
| FR-4 ใบที่มีกะงานผูก "กดซ้ำไม่คืนโควตาซ้ำ"  | เพราะขั้นที่ 1 ไม่พบกะงานที่ต้องยกเลิกอีก                | เพราะ key ของใบอยู่ใน `job.released_application_ids` แล้ว                                                                              |
| FR-4 ใบที่ไม่มีกะงานผูก                     | ใบ `cancelled` ก่อน แล้วคืนโควตา ใบสมัครเป็นตัวกันคืนซ้ำ | ใบ `cancelled` + `quota_release_due_at` → คืนโควตา (ledger) → `quota_released_at` · กดซ้ำทำต่อได้จนมี `quota_released_at` (FR-4, FR-5) |
| FR-4 ข้อจำกัดที่รู้ — โควตาขาด 1 (D4)       | คืนโควตาล้มแล้วกดซ้ำไม่คืนให้ เจ้าหน้าที่ปรับเอง         | ตัดออก กดซ้ำคืนครบ 1 · เหลือเฉพาะกรณี FR-6 (กะเริ่มก่อนกดซ้ำ) และใบที่ยกเลิกก่อน deploy                                                |
| AC-2                                        | ยกเลิกซ้ำได้ 409 และโควตาไม่เปลี่ยน                      | คงเดิมเมื่อคืนสำเร็จในครั้งแรก                                                                                                         |
| AC-3                                        | คืนโควตาล้ม ได้ 502 โควตาไม่เกินเดิม อาจขาด 1            | แทนด้วย AC-1, AC-2 ของ draft นี้                                                                                                       |

## Acceptance

- **AC-1 (ใบไม่มีกะงานผูก):** ใบ `confirmed` คืนโควตาล้ม → 502 `WRITE_FAILED` ใบเป็น `cancelled` + มี `quota_release_due_at` ไม่มี `quota_released_at` · กดซ้ำ → สำเร็จ โควตาคืนครบ 1 และมี `quota_released_at` · กดซ้ำอีก → 409 `NOT_CANCELLABLE` โควตาไม่เปลี่ยน
- **AC-2 (ใบมีกะงานผูก):** ใบ `confirmed` คืนโควตาล้ม → 502 กะงานเป็น `cancelled` + `cancel_application_id` ใบยัง `confirmed` · กดซ้ำ → สำเร็จ โควตาคืนครบ 1 ใบ `cancelled` + มี `quota_released_at` · กดซ้ำอีก → 409 โควตาไม่เปลี่ยน
- **AC-3 (คืนสำเร็จแต่เขียนใบสมัครล้ม):** ทั้งสองทาง กดซ้ำแล้วโควตาไม่เปลี่ยน (ledger มี key แล้ว) และใบไปถึง `cancelled` + `quota_released_at`
- **AC-4 (ledger):** เรียก `releaseJobQuota` ด้วย key เดิม 2 ครั้ง ตัวนับลด 1 ครั้ง และ `released_application_ids` มี key ครั้งเดียว · ไม่ส่ง key ทำงานแบบเดิม
- **AC-5 (ถอนตัวมาก่อน):** กะงานถูกถอนตัวจาก portal แล้ว (ไม่มีตรา) ยกเลิกใบจากบัตร → ใบ `cancelled` โควตาไม่คืนเพิ่ม ไม่มี `quota_released_at`
- **AC-6 (พร้อมกัน):** ยกเลิก 2 คำขอพร้อมกัน (ทั้งสองทาง) โควตาคืนรวม 1 ครั้ง
- **AC-7 (เจ้าหน้าที่บันทึกทับ):** เจ้าหน้าที่แก้ไขงานหลัง ticket cancel แล้ว `released_application_ids` ยังอยู่ · รายการใบสมัครฝั่งเจ้าหน้าที่แสดงใบ schema_v 4 ครบ
- **AC-8 (ใบ `pending_review`):** ยกเลิกแล้วไม่มี `quota_release_due_at` / `quota_released_at` และไม่แตะ `job`
- **AC-9 (GET):** ใบในสถานะ "ทำต่อ" ได้ `can_cancel = true` และบัตรแสดงปุ่มยกเลิกเดิม (FR-7) · ใบที่คืนครบแล้วได้ `false`
- **AC-10 (กะเริ่มแล้ว — ข้อจำกัด FR-6):** ใบมีกะงานผูกที่คืนล้ม แล้วกดซ้ำหลังกะเริ่ม → 409 `SHIFT_STARTED` ไม่เขียนอะไร

## Impact

- **code:** `public-ticket.ts` (FR-3–FR-7), `public-schedule-action.ts` `releaseJobQuota` (FR-1), GET `ticket/[token]/+server.ts` (FR-7), Zod 3 ไฟล์ใน `volunteers/domain/` (FR-9)
- **test:** `public-ticket.test.ts` (AC-1–AC-3, AC-5, AC-6, AC-8), `public-schedule-action.test.ts` (AC-4), `ticket.test.ts` (AC-9), test ของ Zod / repository (AC-7)
- **VDU (`shelter-access-design.ts`):** ไม่เปลี่ยน — VDU ของ shelter DB ตรวจ `job_application` / `job` / `shift_assignment` แค่ envelope (`schema_v`, `shelter_code` ฯลฯ) และ type whitelist ไม่ตรวจ field หรือค่า `schema_v` ราย type field ใหม่จึงผ่านทั้ง public writer และ session ของเจ้าหน้าที่ ไม่ต้อง bump design version
  - ไม่เพิ่มกฎ VDU (write-once / append-only) — เจ้าหน้าที่แก้ตัวนับโควตาเองได้อยู่แล้ว กฎเพิ่มไม่ปิดช่องจริง
- **worker / Mongo / FastAPI:** projector ของ 3 type เลือก field แบบ whitelist field ใหม่ไม่ถูก project ไม่ bump `PROJECTION_VERSION` ไม่ต้อง regenerate OpenAPI
- **ขนาด ledger:** `released_application_ids` โตตามจำนวนใบที่ยกเลิกจากบัตรต่องาน (หลักสิบ) ไม่ต้องตัดทิ้ง
- **CR-212:** แก้ FR-3, FR-4, AC-2, AC-3 ตามตาราง before → after เมื่อ draft นี้ approve
- **ชน `schema_v` กับ CR ของ #885:** draft-shift-attendance-confirmation bump `shift_assignment` 5 → 6 เช่นกัน — CR ที่ merge ทีหลังใช้เลขถัดไป (6 → 7); ทั้งสองเป็น additive (field optional) ไม่ชนกันที่รูปร่าง doc
- **follow-up:** เปิด issue แยกสำหรับถอนตัวจาก portal ที่คืนโควตาล้ม (FR-10)

## Migration

- **schema_v:** `job_application` 3 → 4, `shift_assignment` 5 → 6 (6 → 7 ถ้า CR ของ #885 merge ก่อน), `job` 3 → 4
  - Zod ทั้ง 3 type รับทั้งเวอร์ชันเดิมและใหม่ — `job` ปัจจุบันเป็น `z.literal(3)` ต้องรับ 4 **ใน PR เดียวกับทางเขียน** ไม่อย่างนั้นหน้างานของเจ้าหน้าที่ parse doc v4 ไม่ผ่าน
  - writer ที่เขียน field ใหม่ (BFF ticket cancel) เขียนเวอร์ชันใหม่ · factory ของ frontend (`createJob` ฯลฯ) เขียนเวอร์ชันใหม่ · worker inbound (`volunteer_applications.py`) เขียนเวอร์ชันเดิมต่อได้ (ทาง legacy)
- **doc เดิม:** ไม่ backfill — ไม่มี field = ไม่ค้างคืน / ไม่มีตรา / ledger ว่าง ซึ่งตรงกับพฤติกรรมเดิม
  - ใบที่ยกเลิกก่อน deploy และโควตาขาด 1 อยู่แล้ว (ข้อจำกัด D4) ระบบไม่แก้ให้ เจ้าหน้าที่ปรับตัวนับเอง
  - กะงานที่ `cancelled` ก่อน deploy ไม่มีตรา จึงไม่ถูกนับว่าค้างคืน (กันคืนเกินให้กะที่ถอนตัวไปแล้ว)

## Decision log

- 2026-10-28 — CR-212 D4 (Team Lead): ยอมรับโควตาขาด 1 เป็นข้อจำกัดที่รู้ ให้แก้ใน #1003
- 2026-10-29 — #1003: ผู้รับงานเลือกบันทึกเป็น draft CR ไฟล์
- 2026-10-29 — proposed: marker บนใบสมัครอย่างเดียวคืนครั้งเดียวพอดีไม่ได้ (เขียนข้าม doc) จึงเพิ่ม ledger บน `job` และตราบน `shift_assignment` · ใบไม่มีกะงานผูกคง "ใบสมัครก่อน" ของ CR-212 แล้วเพิ่มการทำต่อ
- 2026-10-29 — owner (@Mhapong) เคาะตามค่าเสนอทุกข้อ:
  - FR-6 — ใบมีกะงานผูกที่กะเริ่มก่อนกดซ้ำ: ยัง 409 `SHIFT_STARTED` กะขาด 1 ที่ เป็นข้อจำกัดที่รู้ เจ้าหน้าที่ปรับเอง (ตัดทิ้ง: ข้ามการตรวจเวลาเมื่อมีกะงานที่มีตรา — GET ต้องอ่านกะงานเพิ่ม)
  - FR-7 — ใบที่ยกเลิกแล้วแต่ยังค้างคืน: `can_cancel = true` ปุ่มยกเลิกเดิม ให้จิตอาสากดซ้ำ (ตัดทิ้ง: flag + ข้อความแยก)
  - FR-10 — ถอนตัวจาก portal คืนล้ม: issue follow-up แยก นอกขอบเขต (ตัดทิ้ง: ใช้ตรา + ledger กับ withdraw รอบนี้)
  - VDU — ไม่เพิ่มกฎ (ตัดทิ้ง: write-once / append-only)
  - schema_v — bump ทั้ง 3 type: `job_application` 3→4, `shift_assignment` 5→6, `job` 3→4; `job` Zod literal รับ 4 ใน PR เดียวกัน (ตัดทิ้ง: additive ไม่ bump)
- รอ approve จาก @Jackyzaz
