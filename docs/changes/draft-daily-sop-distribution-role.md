---
id: draft
title: Daily SOP — เพิ่ม Role "จุดแจกจ่าย" (DST) ให้ distribution_staff ประเมินงานของตนเอง (amend CR-153)
status: proposed
date: 2026-11-23
updated: 2026-11-27
requested_by: "@Fishcanwalk — ทดสอบมือ #1422 ข้อ 7 (2026-11-22): distribution_staff เปิด /back-office/dailysop แล้วไม่มีแบบประเมินให้ทำ"
decided_by:
layer: volatile
affects:
  - docs/changes/07-B-sop/CR-153-daily-sop-role-assessments.md (9 Role → 10 Role, ตาราง Role mapping, ภาคผนวก A)
  - docs/data/schema.md §2.34 `daily_sop_role_assessment` (`role_code` enum +`DST`, `question_set_version`)
  - schema_v — [NEEDS DECISION: ดู D3]
  - docs/prd/role-permission-matrix.md (แถว Daily SOP 3 แถว: UI visibility, CouchDB read, Write — และโครงสร้างคอลัมน์ ซึ่งไม่มี DST/distribution_staff — [NEEDS DECISION: ดู D6])
  - docs/features/daily-sop-assessment-flow.md
  - frontend/src/lib/features/daily-sop/domain/daily-sop.ts (`DAILY_SOP_ROLES`), domain/daily-sop.questions.ts, ui/daily-sop-page.svelte
  - frontend/src/lib/server/shelter-access-design.ts (VDU: role_code enum, capability ของ DST, question set)
  - frontend/src/lib/features/daily-sop/** tests, VDU tests, e2e `daily-sop-role-assessment.test.ts` และ `daily-sop.test.ts` (assertion ตรึง 9 Role)
  - อ้างอิง CR-263 (`/back-office/dailysop` เปิดได้ทุก role ไม่เพิ่ม guard) — ไม่แก้
---

# draft — Daily SOP: Role "จุดแจกจ่าย" (DST) สำหรับ distribution_staff

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม Role ที่ 10 ของแบบประเมินประจำวัน `DST` (จุดแจกจ่าย) ให้ `distribution_staff` ประเมินงานจุดแจกของตนเองได้; ปัจจุบัน `distribution_staff` ไม่มี Role ใดให้ประเมิน (CR-153 ให้ SC ประเมินได้เฉพาะ `supply_coordinator` / `warehouse_staff`).
> - **ทำไม:** หลังเพิ่มปุ่ม "การประเมินประจำวัน" ใน `/portal` (#845) `distribution_staff` เข้าหน้าได้แต่เห็น "บัญชีนี้ยังไม่มีแบบประเมินที่สามารถทำได้ในศูนย์นี้"; @Fishcanwalk ยืนยันว่าฝ่ายแจกจ่ายต้องประเมินตัวเองได้.
> - **Dev ต้อง build:** Role `DST` ใน `DAILY_SOP_ROLES` + ชุดคำถาม, VDU รับ `role_code: DST` จาก `distribution_staff` (และ SM), เทสต์ UI/VDU.
> - **กระทบ:** schema §2.34 enum `role_code` (+`DST`), ทะเบียนคำถาม (`question_set_version`), role-permission matrix; ยังต้องตัดสิน D1–D6 ก่อน implement.
> - **ขอบเขต:** ร่างนี้ครอบ `distribution_staff` เท่านั้น; `donation_staff` / `kiosk_staff` / `pr_staff` ก็ไม่มีแบบประเมิน (ทางตันเดียวกัน) — รอ D5.

---

## 1. ต้องตัดสินก่อน implement

> [NEEDS DECISION: D1 — ชุดคำถามของ DST] ตัวเลือก:
>
> - **(ก) ย้าย** ข้อที่เป็นงานจุดแจกจาก SC ไป DST: D-SC-08 (จัดคิว/สุภาพ), D-SC-09 (จำนวนตรงสิทธิ), D-SC-10 (ช่องทางแจ้งไม่ได้รับ) และอาจรวม D-SC-03 (เบิกและแจกสอดคล้องจำนวนผู้พักพิง) → SC เหลือ 6–7 ข้อเรื่องคลัง
> - **(ข) คัดลอก** ข้อข้างบนเป็นรหัสใหม่ `D-DST-xx` โดย SC คงเดิม 10 ข้อ (ฝ่ายคลังและฝ่ายแจกตอบซ้ำกัน)
> - **(ค) ชุดใหม่** จาก PO / ทีมหน้างาน — ข้อเสนอเบื้องต้น 5 ข้อ:
>   1. ก่อนเริ่มแจก มีการเตรียมสิ่งของครบตามรายการของรอบนั้นหรือไม่?
>   2. จัดจุดแจกและคิวให้เป็นระเบียบและปลอดภัยหรือไม่?
>   3. ตรวจสอบผู้รับและจำนวนสิ่งของให้ตรงตามสิทธิหรือเกณฑ์ก่อนจ่ายหรือไม่?
>   4. บันทึกจำนวนสิ่งของที่จ่ายในแต่ละรอบไว้หรือไม่?
>   5. หากผู้พักพิงได้รับไม่ครบ มีช่องทางแจ้งและมีคนช่วยแก้ไขหรือไม่?
>
>   หากเลือกชุดนี้ ให้กำหนดรหัส `D-DST-01` ถึง `D-DST-05`; จำนวนข้อรวมจะเป็น 84 ข้อเมื่อ SC คง 10 ข้อ (ทางเลือก ข) แต่ต้องนับใหม่หากย้ายข้อจาก SC (ทางเลือก ก).
>
> หมายเหตุ: label ปัจจุบันของ SC คือ "คลัง พัสดุ และการแจกจ่าย" (`daily-sop.ts`) ซึ่งครอบงานแจกอยู่แล้ว — ถ้าเลือก (ก)/(ข) ต้องตัดสินด้วยว่าจะเปลี่ยน label SC และ `role_label` ที่ snapshot ไว้ในเอกสารเดิมหรือไม่ (ดู D4)
>
> หมายเหตุ: CR-153 ระบุ "รหัสคำถามที่เหลือคงเดิมเพื่อรักษาการอ้างอิงใน snapshot" — ทางเลือก (ก) ต้องตัดสินว่ารหัสใหม่เป็น `D-DST-xx` หรือคง `D-SC-08..10` ไว้ใต้ Role DST

> [NEEDS DECISION: D2 — ใครประเมิน DST ได้] เสนอ: `distribution_staff` ของศูนย์นั้น + `shelter_manager` ของศูนย์นั้น (เหมือนทุก Role ใน CR-153). ต้องการให้ `supply_coordinator` / `warehouse_staff` ประเมิน DST ได้ด้วยหรือไม่

> [NEEDS DECISION: D3 — รุ่นทะเบียนคำถามและ schema_v] CR-153 กำหนด `question_set_version` เป็น literal `daily-sop-role-v1` (79 ข้อ) และ "schema_v 1 รองรับทะเบียนรุ่นเดียว". เสนอ:
>
> - เพิ่มรุ่น `daily-sop-role-v2` (v1 + DST และถ้าเลือก (ก) คือ SC ที่ลดข้อ); เอกสารใหม่ใช้ v2, เอกสารเดิม v1 ยัง valid และอ่านได้
> - VDU รับทั้งสองรุ่น; รูปร่างเอกสารไม่เปลี่ยน (field เดิมทั้งหมด) → **ไม่ bump `schema_v`** แต่ต้องแก้คำอธิบาย `question_set_version` ใน schema §2.34
> - ข้อโต้แย้ง: การเพิ่มค่า `DST` ใน enum `role_code` (§2.34, ปัจจุบัน 9 ค่า) เปลี่ยน allowlist ที่ VDU ตรวจ และ CR-153 กำหนด "schema_v 1 รองรับทะเบียนรุ่นเดียว" — จึงอาจตีความเป็นการเปลี่ยนรูป doc ที่ต้อง bump (CR-153 เองไม่ bump ตอนเปลี่ยนถ้อยคำเมื่อ 2026-10-25 แต่ไม่ได้เปลี่ยน enum)
> - ถ้าเจ้าของต้องการให้ทุกการเปลี่ยนทะเบียนคำถาม bump `schema_v` → 1→2 + migration note (ไม่แปลงเอกสารเดิม)

> [NEEDS DECISION: D4 — เอกสาร SC ของวันที่มีอยู่แล้ว] ถ้าเลือก (ก) วันที่ deploy อาจมีเอกสาร SC v1 (10 ข้อ) สร้างไว้แล้ว: เสนอให้เอกสารเดิมคง v1 จนจบวัน ส่วนวันถัดไปสร้างด้วย v2

> [NEEDS DECISION: D5 — role อื่นที่ไม่มีแบบประเมิน] `donation_staff`, `kiosk_staff`, `pr_staff` เข้า `/back-office/dailysop` แล้วเจอ "ยังไม่มีแบบประเมิน" เหมือน `distribution_staff` (ข้อเสนอจากรีวิว #1422 โดย @Fishcanwalk). ตัวเลือก:
>
> - **(ก)** เพิ่ม Role แบบประเมินของตัวเองให้แต่ละ role (เหมือน DST)
> - **(ข)** ซ่อนปุ่ม "การประเมินประจำวัน" ใน `/portal` สำหรับ role ที่ `assessableRoles(...)` ว่าง
> - **(ค)** ยอมรับข้อความเดิม บันทึกเป็นข้อยกเว้นใน CR นี้
>
> หมายเหตุ: (ข) ต้องไม่ขัด CR-263 FR-5/AC-6 (เปิดหน้าได้ทุก role) — ซ่อนเฉพาะปุ่มใน portal ไม่ใช่เพิ่ม guard

> [NEEDS DECISION: D6 — โครงสร้าง role matrix] `docs/prd/role-permission-matrix.md` มีคอลัมน์ SA SM REG TRG MED KS SC DON VC SO FAC และไม่มี `distribution_staff`. ต้องตัดสินว่าเพิ่มคอลัมน์ใหม่ หรือ map `distribution_staff` ไปคอลัมน์เดิม (เช่น SC) และระบุหมายเหตุ — เป็นการเปลี่ยนโครงสร้างตารางสิทธิ์ ไม่ใช่แค่เพิ่มแถว

## 2. Requirements (หลังตัดสิน D1–D6)

| ID    | Requirement                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1  | `DAILY_SOP_ROLES` มี Role `DST` — label "จุดแจกจ่าย", `role_key: distribution_staff`, capabilities ตาม D2                                                           |
| FR-2  | `distribution_staff` ของศูนย์ที่เลือกเห็น Role DST ในหน้า `/back-office/dailysop` และเริ่ม/บันทึก/ทำให้ Completed ได้ในวันปัจจุบัน (Bangkok) ตามกติกาเดิมของ CR-153 |
| FR-3  | Role DST ใช้ชุดคำถามตาม D1; ลำดับและรหัสคำถามคงที่ในรุ่นทะเบียนที่ใช้                                                                                               |
| FR-4a | VDU (`shelter-access-design.ts`) รับ `role_code: DST` เมื่อผู้เขียนถือ capability scoped `{shelter}:distribution_staff` ตาม D2                                      |
| FR-4b | VDU รับ `role_code: DST` เมื่อผู้เขียนถือ capability แบบ legacy bare ตามกติกาข้อ 4 ของ CR-153                                                                       |
| FR-4c | VDU รับ `role_code: DST` เมื่อผู้เขียนเป็น SM ของศูนย์เดียวกัน                                                                                                      |
| FR-4d | VDU ปฏิเสธผู้ไม่มีสิทธิ์ที่เขียน `role_code: DST` เหมือน Role อื่น                                                                                                  |
| FR-5  | VDU ตรวจ controls ของ DST ครบตามทะเบียนรุ่นที่ระบุ (D3) เหมือน Role อื่น                                                                                            |
| FR-6  | `distribution_staff` ยังประเมิน Role อื่น (รวม SC) ไม่ได้ เว้นแต่ D2 กำหนด                                                                                          |
| FR-7  | จำนวน Role ที่ SM เห็นในหน้า dailysop ("/ N ตำแหน่ง" ตามแถวที่แสดง) นับ DST รวมเป็น 10 Role                                                                         |
| FR-8  | acceptance ของ CR-153 ที่ตรึงจำนวน "9 Role / 79 ข้อ" ต้องปรับตามรุ่นทะเบียนที่เลือกใน D3 (และ e2e/unit ที่ตรึง 9 Role)                                              |

## 3. Acceptance

- **AC-1** login เป็น `distribution_staff` (SH001) เปิด `/back-office/dailysop` → เห็น Role "จุดแจกจ่าย" แทนข้อความ "ยังไม่มีแบบประเมิน"
- **AC-2** ตอบครบทุกข้อแล้วบันทึก → เอกสาร `daily_sop_role_assessment:SH001:{วันนี้}:DST` status `Completed`
- **AC-3** `kitchen_staff` เขียนเอกสาร `role_code: DST` ตรงผ่าน CouchDB → VDU ปฏิเสธ (403)
- **AC-4** `distribution_staff` เขียนเอกสาร `role_code: SC` → VDU ปฏิเสธ (ถ้า D2 ไม่ให้)
- **AC-5** เอกสาร SC/อื่น ๆ รุ่น v1 ที่มีอยู่ยังเปิดดูและแก้ (วันปัจจุบัน) ได้
- **AC-6** SM เห็น "/ 10 ตำแหน่ง" ในวันนั้น

## 4. Why

- ที่มา: ทดสอบมือ #1422 ข้อ 7 (2026-11-22) — ปุ่ม "การประเมินประจำวัน" ใน `/portal` (คำตัดสิน kong 2026-11-22, คอมเมนต์ใน #845) ทำให้ `distribution_staff` เข้าหน้าได้ แต่ CR-153 ไม่มี Role ให้ role นี้
- @Fishcanwalk (2026-11-23): `distribution_staff` ต้องประเมินตัวเองได้; @mhapong เลือก "Role ใหม่ของฝ่ายแจกจ่าย" แทนการให้ประเมิน SC และให้ track ด้วย CR file
- ตัดทิ้ง: ให้ `distribution_staff` ประเมิน Role SC — SC มีข้อเรื่องคลัง (ตรวจนับ, หมดอายุ, รับบริจาค) ที่ฝ่ายแจกไม่ได้ดูแล

- ความสัมพันธ์กับ CR-263: `/back-office/dailysop` เปิดได้ทุก role และไม่เพิ่ม guard (FR-5/AC-6; decision sync 2026-11-16 ใน role-permission-matrix) — CR นี้คงหลักนี้ ไม่แก้ด้วย guard (ดู D5)
- พึ่ง PR #1422: ปุ่มใน `/portal` และข้อความ "ยังไม่มีแบบประเมินที่สามารถทำได้ในศูนย์นี้" อยู่ใน #1422 ที่ยังไม่ merge

## 5. Impact

- **Docs:** CR-153 (ตาราง Role mapping, ภาคผนวก A, จำนวน Role/ข้อ), `docs/data/schema.md` §2.34, `docs/prd/role-permission-matrix.md` (แถว Daily SOP 3 แถว + โครงสร้างคอลัมน์ ดู D6), `docs/features/daily-sop-assessment-flow.md`
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
- 2026-11-27 — แก้ตาม review: เพิ่ม D5 (role ที่เหลือ, จากคอมเมนต์ #1422) และ D6 (โครงสร้าง matrix), อ้าง CR-263, `affects` ครบ, แตก FR-4/FR-7 ให้ atomic
