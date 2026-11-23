---
id: draft
title: Daily SOP — เพิ่ม Role "จุดแจกจ่าย" (DST) ให้ distribution_staff ประเมินงานของตนเอง (amend CR-153)
status: proposed
date: 2026-11-23
requested_by: "@Fishcanwalk — ทดสอบมือ #1422 ข้อ 7 (2026-11-22): distribution_staff เปิด /back-office/dailysop แล้วไม่มีแบบประเมินให้ทำ"
decided_by:
layer: volatile
affects:
  - docs/changes/07-B-sop/CR-153-daily-sop-role-assessments.md (9 Role → 10 Role, ตาราง Role mapping, ภาคผนวก A)
  - docs/data/schema.md §2.34 `daily_sop_role_assessment` (`role_code` enum +`DST`, `question_set_version`)
  - schema_v — [NEEDS DECISION: ดู D3]
  - docs/prd/role-permission-matrix.md (แถว Daily SOP)
  - frontend/src/lib/features/daily-sop/domain/daily-sop.ts (`DAILY_SOP_ROLES`), domain/daily-sop.questions.ts
  - frontend/src/lib/server/shelter-access-design.ts (VDU: role_code enum, capability ของ DST, question set)
  - frontend/src/lib/features/daily-sop/** tests, VDU tests
---

# draft — Daily SOP: Role "จุดแจกจ่าย" (DST) สำหรับ distribution_staff

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม Role ที่ 10 ของแบบประเมินประจำวัน `DST` (จุดแจกจ่าย) ให้ `distribution_staff` ประเมินงานจุดแจกของตนเองได้; ปัจจุบัน `distribution_staff` ไม่มี Role ใดให้ประเมิน (CR-153 ให้ SC ประเมินได้เฉพาะ `supply_coordinator` / `warehouse_staff`).
> - **ทำไม:** หลังเพิ่มปุ่ม "การประเมินประจำวัน" ใน `/portal` (#845) `distribution_staff` เข้าหน้าได้แต่เห็น "บัญชีนี้ยังไม่มีแบบประเมินที่สามารถทำได้ในศูนย์นี้"; @Fishcanwalk ยืนยันว่าฝ่ายแจกจ่ายต้องประเมินตัวเองได้.
> - **Dev ต้อง build:** Role `DST` ใน `DAILY_SOP_ROLES` + ชุดคำถาม, VDU รับ `role_code: DST` จาก `distribution_staff` (และ SM), เทสต์ UI/VDU.
> - **กระทบ:** schema §2.34 enum `role_code` (+`DST`), ทะเบียนคำถาม (`question_set_version`), role-permission matrix; ยังต้องตัดสิน D1–D4 ก่อน implement.

---

## 1. ต้องตัดสินก่อน implement

> [NEEDS DECISION: D1 — ชุดคำถามของ DST] ตัวเลือก:
> - **(ก) ย้าย** ข้อที่เป็นงานจุดแจกจาก SC ไป DST: D-SC-08 (จัดคิว/สุภาพ), D-SC-09 (จำนวนตรงสิทธิ), D-SC-10 (ช่องทางแจ้งไม่ได้รับ) และอาจรวม D-SC-03 (เบิกและแจกสอดคล้องจำนวนผู้พักพิง) → SC เหลือ 6–7 ข้อเรื่องคลัง
> - **(ข) คัดลอก** ข้อข้างบนเป็นรหัสใหม่ `D-DST-xx` โดย SC คงเดิม 10 ข้อ (ฝ่ายคลังและฝ่ายแจกตอบซ้ำกัน)
> - **(ค) ชุดใหม่** จาก PO / ทีมหน้างาน (ต้องได้รายการคำถาม + ช่องตัวเลขถ้ามี)
>
> หมายเหตุ: CR-153 ระบุ "รหัสคำถามที่เหลือคงเดิมเพื่อรักษาการอ้างอิงใน snapshot" — ทางเลือก (ก) ต้องตัดสินว่ารหัสใหม่เป็น `D-DST-xx` หรือคง `D-SC-08..10` ไว้ใต้ Role DST

> [NEEDS DECISION: D2 — ใครประเมิน DST ได้] เสนอ: `distribution_staff` ของศูนย์นั้น + `shelter_manager` ของศูนย์นั้น (เหมือนทุก Role ใน CR-153). ต้องการให้ `supply_coordinator` / `warehouse_staff` ประเมิน DST ได้ด้วยหรือไม่

> [NEEDS DECISION: D3 — รุ่นทะเบียนคำถามและ schema_v] CR-153 กำหนด `question_set_version` เป็น literal `daily-sop-role-v1` (79 ข้อ) และ "schema_v 1 รองรับทะเบียนรุ่นเดียว". เสนอ:
> - เพิ่มรุ่น `daily-sop-role-v2` (v1 + DST และถ้าเลือก (ก) คือ SC ที่ลดข้อ); เอกสารใหม่ใช้ v2, เอกสารเดิม v1 ยัง valid และอ่านได้
> - VDU รับทั้งสองรุ่น; รูปร่างเอกสารไม่เปลี่ยน (field เดิมทั้งหมด) → **ไม่ bump `schema_v`** แต่ต้องแก้คำอธิบาย `question_set_version` ใน schema §2.34
> - ถ้าเจ้าของต้องการให้ทุกการเปลี่ยนทะเบียนคำถาม bump `schema_v` → 1→2 + migration note (ไม่แปลงเอกสารเดิม)

> [NEEDS DECISION: D4 — เอกสาร SC ของวันที่มีอยู่แล้ว] ถ้าเลือก (ก) วันที่ deploy อาจมีเอกสาร SC v1 (10 ข้อ) สร้างไว้แล้ว: เสนอให้เอกสารเดิมคง v1 จนจบวัน ส่วนวันถัดไปสร้างด้วย v2

## 2. Requirements (หลังตัดสิน D1–D4)

| ID | Requirement |
| --- | --- |
| FR-1 | `DAILY_SOP_ROLES` มี Role `DST` — label "จุดแจกจ่าย", `role_key: distribution_staff`, capabilities ตาม D2 |
| FR-2 | `distribution_staff` ของศูนย์ที่เลือกเห็น Role DST ในหน้า `/back-office/dailysop` และเริ่ม/บันทึก/ทำให้ Completed ได้ในวันปัจจุบัน (Bangkok) ตามกติกาเดิมของ CR-153 |
| FR-3 | Role DST ใช้ชุดคำถามตาม D1; ลำดับและรหัสคำถามคงที่ในรุ่นทะเบียนที่ใช้ |
| FR-4 | VDU (`shelter-access-design.ts`) รับ `role_code: DST` เมื่อผู้เขียนถือ capability ตาม D2 (scoped `{shelter}:distribution_staff` หรือ legacy bare ตามกติกาข้อ 4 ของ CR-153) หรือเป็น SM ของศูนย์เดียวกัน; ปฏิเสธผู้ไม่มีสิทธิ์เหมือน Role อื่น |
| FR-5 | VDU ตรวจ controls ของ DST ครบตามทะเบียนรุ่นที่ระบุ (D3) เหมือน Role อื่น |
| FR-6 | `distribution_staff` ยังประเมิน Role อื่น (รวม SC) ไม่ได้ เว้นแต่ D2 กำหนด |
| FR-7 | ภาพรวมรายวันของ SM นับ DST เป็นหนึ่งใน Role ของวันนั้น (10 Role) |

## 3. Acceptance

- **AC-1** login เป็น `distribution_staff` (SH001) เปิด `/back-office/dailysop` → เห็น Role "จุดแจกจ่าย" แทนข้อความ "ยังไม่มีแบบประเมิน"
- **AC-2** ตอบครบทุกข้อแล้วบันทึก → เอกสาร `daily_sop_role_assessment:SH001:{วันนี้}:DST` status `Completed`
- **AC-3** `kitchen_staff` เขียนเอกสาร `role_code: DST` ตรงผ่าน CouchDB → VDU ปฏิเสธ (403)
- **AC-4** `distribution_staff` เขียนเอกสาร `role_code: SC` → VDU ปฏิเสธ (ถ้า D2 ไม่ให้)
- **AC-5** เอกสาร SC/อื่น ๆ รุ่น v1 ที่มีอยู่ยังเปิดดูและแก้ (วันปัจจุบัน) ได้
- **AC-6** SM เห็นความคืบหน้า 10 Role ในวันนั้น

## 4. Why

- ที่มา: ทดสอบมือ #1422 ข้อ 7 (2026-11-22) — ปุ่ม "การประเมินประจำวัน" ใน `/portal` (คำตัดสิน kong 2026-11-22, คอมเมนต์ใน #845) ทำให้ `distribution_staff` เข้าหน้าได้ แต่ CR-153 ไม่มี Role ให้ role นี้
- @Fishcanwalk (2026-11-23): `distribution_staff` ต้องประเมินตัวเองได้; @mhapong เลือก "Role ใหม่ของฝ่ายแจกจ่าย" แทนการให้ประเมิน SC และให้ track ด้วย CR file
- ตัดทิ้ง: ให้ `distribution_staff` ประเมิน Role SC — SC มีข้อเรื่องคลัง (ตรวจนับ, หมดอายุ, รับบริจาค) ที่ฝ่ายแจกไม่ได้ดูแล

## 5. Impact

- **Docs:** CR-153 (ตาราง Role mapping, ภาคผนวก A, จำนวน Role/ข้อ), `docs/data/schema.md` §2.34, `docs/prd/role-permission-matrix.md` แถว Daily SOP
- **Frontend:** `features/daily-sop/domain/daily-sop.ts`, `daily-sop.questions.ts`, หน้า `daily-sop-page.svelte` (ไม่น่าต้องแก้ถ้า render จาก `DAILY_SOP_ROLES`)
- **CouchDB:** `_design/access` VDU ใน `frontend/src/lib/server/shelter-access-design.ts` → ต้อง redeploy design doc ทุก shelter DB หลัง merge (layer ของ VDU = stable core ตาม CLAUDE.md → ต้อง review ก่อน)
- **Tests:** domain (`assessableRoles`, questions), VDU (สิทธิ์ DST/SC), DOM ของหน้า dailysop
- **ผู้ใช้:** `distribution_staff` เห็นแบบประเมิน 1 Role; ถ้าเลือก (ก) ฝ่ายคลังตอบน้อยลง

## 6. Migration

[NEEDS DECISION: ตาม D3] — เสนอ: ไม่แปลงเอกสารเดิม; เอกสาร v1 คง valid; เอกสารใหม่ใช้ `daily-sop-role-v2`; redeploy `_design/access`

## 7. Decision log

- 2026-11-22 — kong: เพิ่มปุ่มเข้า `/back-office/dailysop` ใน `/portal` (#845 / PR #1422)
- 2026-11-23 — @Fishcanwalk: `distribution_staff` ต้องประเมินตัวเองได้; @mhapong เลือก Role ใหม่ (DST) และ track ด้วย CR file
- 2026-11-23 — proposed (ร่าง CR)
