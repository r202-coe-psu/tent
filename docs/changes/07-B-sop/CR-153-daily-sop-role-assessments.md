---
id: CR-153
title: แบบประเมิน Daily SOP ประจำวันแยกตามหน้าที่
status: approved
date: 2026-09-26
created: 2026-09-26
updated: 2026-10-25
requested_by: Team D
decided_by: kong — อนุมัติ 2026-10-05
decision_date: 2026-10-05
layer: volatile
affects:
  - docs/data/schema.md §2.34
  - daily_sop_role_assessment schema_v 1
  - frontend/src/lib/features/daily-sop
  - frontend/src/lib/server/shelter-access-design.ts
  - docs/prd/role-permission-matrix.md
why: แบบประเมินเดิมรวมผลของหลายฝ่ายไว้ในชุดเดียว จึงไม่สะท้อนผู้รับผิดชอบและงานประจำวันจริงของศูนย์พักพิงอุทกภัย
migration: เพิ่มเอกสาร daily_sop_role_assessment schema_v 1; ไม่แปลงเอกสาร daily_sop_assessment เดิมตาม CR-106/schema §2.21 และรายการประเมิน Role ไม่แสดงเอกสาร Legacy
note: แก้ไข 2026-10-25 — Pass/Fail ไม่บังคับ notes (Pending ยังบังคับ), ปรับถ้อยคำคำถาม 79 ข้อและชื่อช่องตัวเลข 19 ข้อในภาคผนวก A, เพิ่มข้อความหน้าจอในภาคผนวก B และซ่อนรหัสคำถาม/สูตรเกณฑ์ใน UI โดยไม่เปลี่ยน id, threshold, field keys, `question_set_version` และ schema_v. ก่อนหน้า 2026-10-24 — UI แสดงเฉพาะ Role ที่ผู้ใช้ประเมินได้ (SM/SA เห็นครบ 9) เป็น UI-only ไม่เปลี่ยน data contract, schema, VDU, Question Bank, id และ schema_v. ก่อนหน้า 2026-10-20 — ปรับถ้อยคำของคำถาม 19 ข้อในภาคผนวก A
---

# CR-153: แบบประเมิน Daily SOP ประจำวันแยกตามหน้าที่

> **สรุป:** แยกแบบประเมิน Daily SOP เป็น 9 Role รวม 79 ข้อ และบันทึกหนึ่งเอกสารต่อศูนย์/วัน/Role; กำหนด schema, authorization, Bangkok-date rules และ index สำหรับ implementation ในงานถัดไป โดยไม่แปลงเอกสาร Legacy. D-SC-01 ตรวจทั้งคลังด้วยสถานะและไม่บันทึกตัวเลขรวมข้ามหน่วย

## Why

การตรวจรายวันควรให้ผู้รับผิดชอบแต่ละงานประเมินส่วนที่ตนดูแลได้โดยตรง เช่น ทะเบียน คลัง ครัว
สุขภาพ ความปลอดภัย และสถานที่ ผู้จัดการศูนย์ดูภาพรวมจากความคืบหน้าและข้อที่ต้องติดตาม
โดยไม่ต้องลงผลซ้ำ และไม่รวมทุกข้อเป็นคะแนนเดียวจนความเสี่ยงสำคัญถูกกลบ

## Change

เปลี่ยนจากแบบประเมินเดิมที่รวมหลายหน้าที่ไว้ในชุดเดียว มาเป็นแบบตรวจรายวันแยกตามหน้าที่ 9 Role
โดย Question Bank ในภาคผนวก A ตามมติที่บันทึกในเอกสารนี้มี 79 ข้อ จาก 91 ข้อ (ตัด 12 ข้อ)

CR-153 (PR #326) นี้แก้เฉพาะ CR ฉบับนี้ โดยรวม Question Bank 79 ข้อและตาราง SOP Parameter ไว้ในภาคผนวก A เพื่อให้ CR อ่านและทบทวนได้ในเอกสารเดียว. CR บันทึก contract สำหรับการนำไปใช้ภายหลัง แต่ไม่แก้ `docs/data/schema.md §2.34` หรือ runtime; งาน schema §2.34 จะทำแยกบน branch DailySOP ใน PR ถัดไป และต้องยึด control snapshot contract ใน CR นี้. PR นี้ไม่เปลี่ยน implementation ของ UI, VDU, provisioner หรือ security policy. Question Bank ใน frontend ต้องมี 79 ข้อตามภาคผนวก A. เอกสารเดิมชนิด `daily_sop_assessment` คงอยู่โดยไม่แปลงข้อมูล และไม่ปรากฏในรายการประเมิน Role ใหม่ ตาม CR-106/schema §2.21

| หน้าที่ | จำนวนเดิม | ตัดออก | คงเหลือ |
| --- | ---: | ---: | ---: |
| ผู้จัดการศูนย์พักพิง (SM) | 10 | 1 | 9 |
| ลงทะเบียนและข้อมูลผู้พักพิง (REG) | 10 | 5 | 5 |
| คัดกรองและกลุ่มเปราะบาง (TRG) | 8 | 1 | 7 |
| การแพทย์และสุขภาพ (MED) | 10 | 1 | 9 |
| ครัวและโภชนาการ (KS) | 10 | 4 | 6 |
| คลัง พัสดุ และการแจกจ่าย (SC) | 10 | 0 | 10 |
| อาสาสมัครและกำลังคน (VC) | 8 | 0 | 8 |
| ความปลอดภัย (SO) | 10 | 0 | 10 |
| สถานที่ พื้นที่พัก และสาธารณูปโภค (FAC) | 15 | 0 | 15 |
| **รวม** | **91** | **12** | **79** |

มติการตัดคำถาม 12 ข้อ:

| Role | รหัสที่ตัด | เหตุผล |
| --- | --- | --- |
| SM | D-SM-01 | ลดการตรวจยอดผู้พักพิงซ้ำกับฝ่ายทะเบียน; ปรับถ้อยคำ D-SM-03 ตามมติ |
| REG | D-REG-04, D-REG-05, D-REG-06, D-REG-07, D-REG-09 | ลดความซ้ำซ้อนกับระบบและฝ่ายคัดกรอง |
| TRG | D-TRG-07 | ตัดการตรวจเรื่องผู้ดูแล |
| MED | D-MED-08 | ตัดเกณฑ์ส่งต่อ 90% |
| KS | D-KS-01, D-KS-02, D-KS-03, D-KS-08 | ตัดตามมติผู้ทบทวน |

Role SC, VC, SO และ FAC คงคำถามเดิมทั้งหมด. รหัสคำถามที่เหลือคงเดิมเพื่อรักษาการอ้างอิงใน snapshot; เลขลำดับในภาคผนวกมีไว้แสดงผลเท่านั้น.

## Impact

CR-153 (PR #326) เปลี่ยนเฉพาะ CR ฉบับนี้; ไม่แก้ runtime หรือ schema ที่ใช้งานอยู่. เมื่อนำข้อเสนอนี้ไป implement จะกระทบ `docs/data/schema.md §2.34`, `frontend/src/lib/features/daily-sop` และ `frontend/src/lib/server/shelter-access-design.ts` รวมถึง unit/VDU tests ของส่วนดังกล่าว; `docs/prd/role-permission-matrix.md` ต้องแสดงสิทธิ์ Daily SOP โดยแยก "UI-visibility" ออกจาก "DB-read". D-SC-01 ใช้ `stock-status` endpoint ที่มีอยู่เพื่อแสดงยอดแบบอ่านอย่างเดียว; ไม่เพิ่ม stock API หรือเปิดคำสั่งแก้สต็อกจากแบบประเมิน. Implementation ต้องยึด field contract, authorization และ acceptance criteria ในเอกสารนี้.

## Migration

ไม่มีการแปลงเอกสาร `daily_sop_assessment` เดิม, ไม่มีการลบข้อมูล และไม่มี batch migration. รายการประเมิน Role ใหม่อ่านเฉพาะ `daily_sop_role_assessment`; Legacy ยังคงอยู่ตามขอบเขต CR-106/schema §2.21. การ deploy implementation ต้องสร้าง Mango index ตามสเปกด้านล่างก่อนเปิดรายการประเมิน.

## ขอบเขตผลิตภัณฑ์ที่เสนอ

1. เปิดหน้า Daily SOP เป็นรายการผลรายวัน เรียงวันที่ล่าสุดก่อน และเลือกดูได้เฉพาะวันที่ปัจจุบันหรือวันที่ผ่านมา
2. UI แสดงเฉพาะ Role ที่ผู้ใช้มีสิทธิ์ประเมินในแต่ละวันที่เลือก: ผู้ถือตำแหน่งเห็นเฉพาะ Role ของตน (SC รวม `warehouse_staff`); shelter_manager (SM) ของ shelter นั้น และ app system_admin (SA, ผู้ดูแลระบบส่วนกลาง ตาม `docs/prd/role-permission-matrix.md`) เห็นครบ 9 Role. การจำกัดนี้เป็นการแสดงผลใน UI เท่านั้น; การอ่านเอกสารใน CouchDB ยังเป็น DB-wide ตาม _security (ข้อจำกัดที่ทราบ — ดู Decision log 2026-10-24). Role ที่แสดงแต่ไม่มีเอกสารแสดง `Not started` และค่าเริ่มต้น 0/จำนวนข้อทั้งหมด ซึ่งเป็นผลแสดงใน UI ไม่ใช่ค่าใน schema และไม่สร้างเอกสาร. Role ที่มีเอกสารแสดงจำนวนข้อที่ตอบแล้ว จำนวนข้อทั้งหมด ความคืบหน้า สถานะ และจำนวน Pass/Fail/Pending. Role ที่ผู้ใช้ไม่มีสิทธิ์ประเมินไม่แสดงแถว คำถาม ผลที่บันทึก หรือสรุป; สร้าง/แก้ไขได้เฉพาะ capability ที่ authorization contract อนุญาต
3. แสดงคำถามพร้อมสถานะ Pass / Fail / Pending; wire status ใช้ค่านี้โดยตรงและใช้ null สำหรับ unanswered. ต่างจาก legacy `daily_sop_assessment` ตาม CR-106 ที่เก็บ `Yes`/`No`; schema ใหม่นี้ไม่ map `Pass`/`Fail` กลับเป็น `Yes`/`No`
4. ออกแบบมือถือก่อน; ตัวเลือกสถานะต้องมี label และใช้ semantic color tokens ของระบบ (success / destructive / warning) โดยไม่ใช้สีเป็นตัวสื่อความหมายเพียงอย่างเดียว และ touch target ต้องไม่น้อยกว่า 44 px
5. แสดงผู้บันทึกล่าสุดและเวลาแยกในแต่ละ control; ไม่เก็บประวัติแก้ไขย้อนหลังในเอกสารนี้
6. Pending ต้องมี notes ที่ trim แล้วไม่ว่าง; Pass และ Fail ใช้ notes เป็นสตริงว่างได้ (UI แนะนำให้ระบุสิ่งที่พบเมื่อ Fail แต่ไม่บังคับ)
7. คำถามเชิงตัวเลขใช้ SOP Parameter ของศูนย์และเก็บค่าที่ใช้กับผลตรวจ; ถ้าขาด Parameter ให้เลือก Pending พร้อมหมายเหตุ ห้ามเดาค่า
8. สรุปจำนวน Pass, Fail, Pending และ unanswered แยกตาม Role ไม่มีคะแนนรวมข้าม Role
9. notes และ observations ใช้บันทึกเฉพาะข้อมูลปฏิบัติการแบบไม่ระบุตัวบุคคล; ห้ามใส่ชื่อ เลขประจำตัว การวินิจฉัย หรือรายละเอียดเคสคุ้มครอง
10. การบันทึกใช้ optimistic concurrency จาก `_rev`. เมื่อ create/update ชน conflict ห้าม retry draft เก่าทับเอกสารล่าสุด; คง draft ไว้และแจ้งให้ผู้ใช้โหลด/รวมการเปลี่ยนแปลงก่อนบันทึกใหม่. รายการหลายหน้าที่ใช้ bookmark รับประกันการไม่ซ้ำ/ไม่ขาดเมื่อชุดข้อมูลคงที่; เมื่อผู้ใช้ refresh ให้เริ่ม query ใหม่จากหน้าแรก เพราะ bookmark ไม่ใช่ snapshot ของข้อมูลและรายการอาจเปลี่ยนระหว่างเปิดหลายหน้า
11. D-SC-01 แสดงรายการยอดคงเหลือปัจจุบันแบบอ่านอย่างเดียวจาก `GET /api/v1/shelters/{shelter_code}/stock-status` โดยใช้ `shelter_code` จากเอกสารประเมิน; UI เลือกแสดงเฉพาะชื่อ/รหัสสินค้า หน่วย และยอดในระบบ พร้อม `last_updated` หนึ่งค่าระดับศูนย์ซึ่งหมายถึงเวลารายการ stock ledger ล่าสุด ไม่ใช่เวลาของสินค้าแต่ละรายการ. ไม่แสดง occupancy, reorder threshold, difference, status หรือคำสั่งแก้ไขสต็อก และไม่บันทึกยอดเหล่านี้ในเอกสารประเมิน. การเปิด/ปิดรายการต้องไม่ทำให้คำตอบที่กำลังกรอกหาย และผู้ประเมินทั้ง `warehouse_staff` และ `supply_coordinator` ต้องใช้ได้
12. UI แสดงถ้อยคำคำถามและชื่อช่องตัวเลขตามภาคผนวก A และข้อความหน้าจอ/ข้อความผลตรวจสอบจากตัวเลขตามภาคผนวก B (ไม่ persist). UI ไม่แสดงรหัสคำถาม (เก็บใน attribute `data-question-id`) และไม่ใส่ข้อความ `threshold`/สูตรเกณฑ์ไว้ใน DOM (คงอยู่ใน snapshot เพื่อ audit)

## Data contract และ field-level schema

หนึ่งเอกสารแทนหนึ่งศูนย์ หนึ่งวัน และหนึ่ง Role. JSON _rev เป็น metadata ของ CouchDB ไม่ใช่ field ของ schema application.

| Field | ชนิด / ค่า | Required | กติกา |
| --- | --- | --- | --- |
| _id | string | ใช่ | เท่ากับ daily_sop_role_assessment:{shelter_code}:{assessment_date}:{role_code} ทุกครั้งที่สร้างหรือแก้ไข |
| type | literal daily_sop_role_assessment | ใช่ | ชนิดเอกสารที่ VDU อนุญาต |
| schema_v | integer 1 | ใช่ | ไม่เปลี่ยนหลังสร้าง |
| shelter_code | string | ใช่ | ต้องตรงกับ shelter database ปลายทาง; immutable |
| assessment_date | valid YYYY-MM-DD | ใช่ | วันที่ปฏิทิน Bangkok; ต้องเป็นวันจริง; immutable |
| role_code | enum SM, REG, TRG, MED, KS, SC, VC, SO, FAC | ใช่ | immutable และใช้ derive _id |
| role_key | canonical role string | ใช่ | ต้องตรงกับ role_code; immutable |
| role_label | string | ใช่ | label ตาม role mapping; immutable snapshot |
| question_set_version | literal `daily-sop-role-v1` | ไม่ | schema_v 1 รองรับทะเบียนรุ่นเดียว: `daily-sop-role-v1` = Question Bank 79 ข้อและลำดับในภาคผนวก A. ถ้า omit ให้ถือเป็นรุ่นนี้; ถ้ามีต้องเป็น literal นี้. ห้ามเขียนรุ่นที่ไม่มีในทะเบียน และค่าที่เก็บหรือการ omit ต้องไม่เปลี่ยนภายหลัง |
| assessed_at | ISO-8601 UTC timestamp ที่ลงท้าย `Z` และ parse เป็นเวลาจริงได้ | ใช่ | เวลาเริ่มประเมิน; immutable |
| assessor_name | non-empty string | ใช่ | หลัง trim แล้วต้องไม่ว่าง; ชื่อแสดงผลของผู้เริ่มประเมิน; immutable และไม่ใช้ยืนยันตัวตนหรือ authorization |
| status | InProgress หรือ Completed | ใช่ | Completed เมื่อไม่มี unanswered; ไม่เช่นนั้น InProgress |
| pass_count, fail_count, pending_count, unanswered_count | integer ≥ 0 | ใช่ | ต้องเท่ากับจำนวน controls ตามสถานะจริง |
| controls | array of control snapshots | ใช่ | ต้องมี Question Bank IDs ครบตรง Role/version ที่เลือก; IDs ไม่ซ้ำ และลำดับ/จำนวนไม่เปลี่ยนหลังสร้าง |
| created_at, updated_at | ISO-8601 UTC timestamp ที่ลงท้าย `Z` และ parse เป็นเวลาจริงได้ | ใช่ | created_at immutable; updated_at เปลี่ยนเมื่อบันทึก |
| created_by | non-empty username | ใช่ | immutable; สำหรับ application writes ตอนสร้างต้องตรงกับผู้ใช้ที่ยืนยันตัวตน |

แต่ละ controls[] มี field ต่อไปนี้:

| Field | ชนิด / ค่า | Required | กติกา |
| --- | --- | --- | --- |
| id | string | ใช่ | ID คำถามที่ขึ้นต้น D-{role_code}-; unique และ immutable |
| question | string | ใช่ | immutable snapshot ของข้อความที่แสดงจริงจากภาคผนวก A; คำถามที่มี SOP Parameter ให้แทน placeholder ด้วย effective ratio ณ เวลาสร้าง. หากไม่มีค่า ให้คง token `{parameter_key}` ตามต้นฉบับไว้ใน snapshot และ UI ต้องแสดงให้ชัดว่าไม่มีค่า Parameter พร้อมบังคับให้ตอบ Pending; ห้ามแสดง token เปล่าโดยไม่มีคำอธิบาย |
| metric_spec | object หรือ null | ใช่ | เป็น object เฉพาะข้อที่ระบุในตารางตัวเลขภาคผนวก A; `fields[]` ต้องใช้ key และลำดับตามตารางนั้น โดย `key`/`label`/`unit` เป็น non-empty string. `step` เป็น positive finite decimal string: `1` สำหรับจำนวนคน/รายการ/งาน/ชิ้น/มื้อ/สถานที่, `0.01` สำหรับ ตร.ม., `0.1` สำหรับลิตร. D-SC-01 ไม่มี metric fields ใน schema_v 1 เพราะตรวจยอดแยกตามรายการสินค้าและหน่วยฐาน; ให้ `metric_spec: null` และ `measured_values: {}` ตามหัวข้อ “เกณฑ์ตรวจยอดคลัง D-SC-01”. `threshold` เป็นข้อความเกณฑ์จากตารางหลังแทน SOP Parameter ด้วยค่าที่ snapshot. ข้อที่ใช้ Parameter ต้องมี `parameter` เมื่อมีค่าที่ resolve ได้; `parameter.key` ต้องตรง key ของคำถาม และ `parameter.value` เป็น positive finite numeric string จาก active shelter `sop_override` ทั้งชุด หรือ master `sop_profile` เมื่อไม่มี active override ตาม [CR-006](CR-006-sop-profile-master-override.md) และ [CR-021](CR-021-sop-ratio-scope-handbook-plus-volunteer.md). ข้อที่ไม่ใช้ Parameter ห้ามมี `parameter`; เมื่อ Parameter ไม่มีค่าให้ `metric_spec` เป็น null พร้อม status Pending และ notes. เก็บค่า effective ที่ใช้จริงใน snapshot; schema_v 1 ไม่เก็บ profile/override ID หรือ version; immutable snapshot |
| status | Pass, Fail, Pending หรือ null | ใช่ | null หมายถึงยังไม่ตอบ |
| notes | string | ใช่ | Pass/Fail/unanswered ใช้ "" ได้; Pending ต้องมีข้อความหลัง trim |
| observations | string | ใช่ | อาจเป็น "" |
| measured_values | object ของ number ≥ 0 หรือ null | ใช่ | ต้องมี keys ตรงกับ `metric_spec.fields[].key` ทุก key (ทุกค่าที่เว้นไว้ใช้ null); ทุก value เป็น finite number หรือ null; ห้ามค่าติดลบ และค่าที่ไม่ใช่ null ต้องเป็นจำนวนเท่าของ `step` ที่ snapshot ใน field นั้น. ถ้า `metric_spec` เป็น null ต้องเป็น object ว่าง |
| checked_by | non-empty username | ใช่ | ผู้ใช้ที่บันทึก control snapshot ล่าสุด รวมถึงการสร้าง control ที่ยัง unanswered; ไม่ยืนยันว่าผู้นั้นเป็นผู้ตรวจหน้างาน. เมื่อ application write เปลี่ยน control ต้องตรงกับผู้ใช้ที่ยืนยันตัวตน |
| checked_by_name | non-empty string | ไม่ | หากระบุต้องไม่ว่างหลัง trim; ชื่อแสดงผลของผู้ใช้ที่บันทึก control ล่าสุด; ใช้แสดงผลเท่านั้น ไม่ใช่ตัวตนที่ใช้ authorization |
| checked_at | ISO-8601 UTC timestamp ที่ลงท้าย `Z` และ parse เป็นเวลาจริงได้ | ใช่ | เวลาบันทึก control ล่าสุด รวมถึงเวลาสร้าง unanswered snapshot |

สถานะระดับ control เป็น required field และใช้ null แทน unanswered; จึงไม่ใช้ทั้งการ omit field และ null เป็นความหมายเดียวกัน. เมื่อสร้างเอกสาร ระบบสร้าง snapshot ครบทุกข้อพร้อม actor/time ของผู้สร้าง แม้คำตอบยังเป็น null; UI ต้องแสดง audit นี้ในความหมาย “บันทึกล่าสุดโดย/เมื่อ” ไม่ใช่หลักฐานว่ามีการตรวจหน้างานแล้ว.
ตัวอย่าง Pass ที่ยังไม่มี note คือ notes: ""; การ omit notes ไม่ถูกต้อง. การแก้ไขอนุญาตเฉพาะคำตอบ, measured values,
notes, observations และ audit fields ของ control ที่แก้ พร้อม top-level summary/timestamp ที่ derive จากคำตอบ.
Identity, creation metadata และ question/metric snapshots ต้องไม่เปลี่ยน. `check_method`, `pass_criteria` และ `record_values` ไม่อยู่ใน persisted contract ของ schema_v 1 เพราะภาคผนวก A ไม่ได้กำหนดค่าเหล่านี้; ห้ามเติมค่าว่างหรืออนุมานค่าเอง. การลบเอกสารไม่อนุญาต.

ไม่สร้างเอกสาร Role ที่ยังไม่มีคำตอบ, ค่าตรวจ, note หรือ observation ที่ผู้ใช้บันทึกจริงอย่างน้อยหนึ่งรายการ. เมื่อเกิด create ครั้งแรก ให้ snapshot ทุก control ครบตามรุ่น; สำหรับข้อที่ยัง unanswered audit actor/time หมายถึงผู้สร้าง snapshot เท่านั้น. `Not started` จึงเป็น UI projection สำหรับ Role ที่ไม่มีเอกสารเท่านั้น.

ตาราง field ใน data contract เป็น canonical allowlist ของ application fields สำหรับ schema_v 1; เพิ่ม field ใหม่ได้เมื่อแก้ CR/schema อย่างชัดเจนเท่านั้น. CouchDB metadata เช่น `_id` และ `_rev` ไม่ใช่ application fields.

เอกสารหนึ่ง Role/วันอาจถูกแก้จากหลาย session. ทุก update ต้องอ้าง `_rev` ที่หน้าแบบประเมินโหลดมา; ถ้า revision ปัจจุบันเปลี่ยนแล้วให้ปฏิเสธ write ก่อน merge. เมื่อชน conflict ให้คง draft ของผู้ใช้ไว้และให้โหลดเอกสารล่าสุดเพื่อเลือกนำคำตอบมารวมทีละ control; ห้ามอ่าน revision ใหม่แล้วส่ง draft เต็มชุดเก่าซ้ำอัตโนมัติ เพราะอาจลบคำตอบที่ผู้ใช้อื่นเพิ่งบันทึก. กรณี create ชนกันก็ห้ามเปลี่ยน stale create เป็น update อัตโนมัติ. `assessor_name` และ `assessed_at` เป็นข้อมูลผู้เริ่มประเมิน จึงคงค่าเดิมตลอดอายุเอกสาร; ผู้แก้ล่าสุดระบุแยกใน audit ของ control.

## Role mapping และ authorization contract

| Code | Daily SOP Role / stored label | `role_key` ที่เก็บในเอกสาร | Capability ที่อนุญาตให้ประเมิน Role |
| --- | --- | --- | --- |
| SM | ผู้จัดการศูนย์พักพิง | shelter_manager | shelter_manager |
| REG | ลงทะเบียนและข้อมูลผู้พักพิง | registration_staff | registration_staff |
| TRG | คัดกรองและกลุ่มเปราะบาง | triage_staff | triage_staff |
| MED | การแพทย์และสุขภาพ | medical_staff | medical_staff |
| KS | ครัวและโภชนาการ | kitchen_staff | kitchen_staff |
| SC | คลัง พัสดุ และการแจกจ่าย | supply_coordinator | supply_coordinator หรือ warehouse_staff |
| VC | อาสาสมัครและกำลังคน | volunteer_coordinator | volunteer_coordinator |
| SO | ความปลอดภัย | security_officer | security_officer |
| FAC | สถานที่ พื้นที่พัก และสาธารณูปโภค | facility_staff | facility_staff |

`role_key` คือ canonical key ที่เก็บคู่กับ `role_code`; คอลัมน์ Capability กำหนดสิทธิ์ authorization และอาจมีหลาย capability ต่อ Role. สำหรับ SC คง `role_key: supply_coordinator` แต่ทั้ง `supply_coordinator` และ `warehouse_staff` มีสิทธิ์ประเมิน SC ตาม helper `isWarehouseStaff`. `system_admin` เป็น application authorization role ไม่ใช่ Daily SOP Role. `security_officer` คือ canonical name; ไม่ใช้ `security_staff`.

CouchDB authorization chain:

1. _security ตรวจการเข้า database ก่อน VDU. ตาม provisioner ปัจจุบัน members.roles มี shelter:{code} และ admins.roles มี system_admin. Database member อ่านเอกสารทุกชนิดใน DB และเขียนเอกสารปกติได้; database admin มีสิทธิเพิ่มในการแก้ design documents และสมาชิก/นโยบาย DB. การอยู่ใน admins.roles จึงเป็นสิทธิ์กว้างที่มีอยู่แล้ว ไม่ใช่สิทธิ์ที่ PR นี้เพิ่ม
2. แต่ละ shelter ใช้ฐานข้อมูล shelter_{code}. การอ่านเป็น DB-wide ตาม _security; VDU เป็น write validation ไม่ใช่ row-level read authorization. ผู้ใช้ที่เป็น member ของฐาน shelter อ่านเอกสารได้ทุก Role ในระดับ DB (UI แสดงเฉพาะ Role ที่ประเมินได้ ตามขอบเขตผลิตภัณฑ์ข้อ 2); notes/observations จึงต้องไม่มีข้อมูลส่วนบุคคลหรือรายละเอียดสุขภาพ/คุ้มครองรายบุคคล.
3. สำหรับ application writes ปกติ VDU ตรวจว่า newDoc.shelter_code ตรงกับ shelter DB, ผู้เขียนเป็นเจ้าของ Role หรือ shelter_manager ของ shelter เดียวกัน หรือเป็น application system_admin. เมื่อสร้าง created_by ต้องตรงกับผู้ใช้; เมื่อเปลี่ยน control ค่า checked_by ต้องตรงกับผู้ใช้. สิทธิ์ข้าม shelter ถูกปฏิเสธสำหรับ Role users/managers.
4. Scoped capability ใช้รูปแบบ {shelter_code}:{capability}. อนุญาต legacy bare capability เฉพาะเมื่อ user มี capability นั้น, มี role ที่ match ^shelter:[^:]+$ เพียงหนึ่งรายการพอดี และค่านั้นเท่ากับ shelter:{newDoc.shelter_code}. หากมี 0 หรือหลาย shelter scopes ให้ปฏิเสธ bare-role fallback.
5. สมาชิก shelter อ่านได้ตามขอบเขต DB ของตน; VDU ไม่ใช้ควบคุมการอ่าน. App system_admin ผ่าน admins.roles เป็น CouchDB database admin. CouchDB reserved _admin เป็น principal คนละตัวและห้ามใช้สองชื่อนี้แทนกัน.

CouchDB database admins แก้ design documents และ database membership/security ได้; การลดสิทธิ์ app system_admin เป็น member-level เป็นงานแยก ไม่อยู่ใน PR เอกสารนี้.
อ้างอิง [CouchDB Database Security](https://docs.couchdb.org/en/stable/api/database/security.html).

## VDU invariants, วันที่ และ trusted maintenance

สำหรับ application writes รวมถึง app system_admin:

- assessment_date ต้องเท่ากับวันที่ Bangkok ปัจจุบัน; ผู้ใช้ทุกกลุ่มสร้าง/แก้เอกสารย้อนหลังไม่ได้
- VDU คำนวณวันที่จาก wall clock ของ CouchDB query-server โดยเลื่อน epoch ด้วย UTC+07:00 แล้วใช้ UTC getters; ห้ามใช้ host locale, local-time getters หรือ timezone ที่ตั้งบนเครื่องโดยปริยาย
- โหนด CouchDB ที่รับ writes ต้องซิงก์นาฬิกาไว้
- ตัวอย่าง boundary: 2026-09-30T16:59:59Z ให้ 2026-09-30; 2026-09-30T17:00:00Z ให้ 2026-10-01

CouchDB server admin ที่ userCtx.roles มี reserved _admin และใช้กับ trusted replication, restore, migration หรือ maintenance อาจข้าม current-day check
และ application-role/actor-equality checks ที่ขัดขวางการนำเอกสารเดิมเข้าระบบ โดยคงค่า creator/checker เดิมไว้.
ข้อยกเว้นนี้ไม่ครอบคลุม application role system_admin และไม่ข้ามการตรวจ type, schema/field types, shelter/database match,
วันที่ปฏิทินจริง, deterministic ID, control IDs/order ที่ครบตาม question_set_version, count consistency, immutable identity/snapshots หรือการห้ามลบ. ถ้าไม่ระบุ question_set_version ให้ตรวจชุดปัจจุบันในภาคผนวก A; ถ้าระบุ ต้องเป็น version ที่มีทะเบียนและตรวจตรงกับชุดนั้น. VDU ต้องไม่ return ก่อนตรวจ invariants เหล่านี้.
Replication ที่ใช้ user context ปกติยังถูกกฎ current-day; การ restore acceptance ต้องยืนยันว่า target VDU เห็น _admin จริง.

CouchDB เรียก document validation กับ replicated updates ด้วย; validation function ได้ newDoc, oldDoc, userCtx, secObj.
อ้างอิง [CouchDB Validate Document Update Functions](https://docs.couchdb.org/en/stable/ddocs/ddocs.html#validate-document-update-functions)
และ [CouchDB Technical Overview](https://docs.couchdb.org/en/stable/intro/overview.html).

## Mango query และ index สำหรับรายการประเมิน

สร้าง index ผ่าน POST /{db}/_index; ใช้ ddoc แยกชื่อ daily-sop-role-assessment ไม่แก้ _design/access ซึ่งถือ VDU/access design.
Index fields และ sort order ต้องตรงกัน:

    {
      "index": {
        "fields": [
          { "type": "desc" },
          { "shelter_code": "desc" },
          { "assessment_date": "desc" },
          { "role_code": "desc" }
        ]
      },
      "ddoc": "daily-sop-role-assessment",
      "name": "daily-sop-role-assessment-by-shelter-date",
      "type": "json"
    }

ตัวอย่าง POST /{db}/_find สำหรับ shelter S001; แทนวันที่ตัวอย่างด้วย current Bangkok date:

    {
      "selector": {
        "type": "daily_sop_role_assessment",
        "shelter_code": "S001",
        "assessment_date": { "$lte": "2026-10-02" }
      },
      "sort": [
        { "type": "desc" },
        { "shelter_code": "desc" },
        { "assessment_date": "desc" },
        { "role_code": "desc" }
      ],
      "use_index": [
        "_design/daily-sop-role-assessment",
        "daily-sop-role-assessment-by-shelter-date"
      ],
      "allow_fallback": false,
      "limit": 100
    }

ผลลัพธ์หน้าถัดไปส่ง bookmark ที่ได้จาก response ก่อนหน้า โดยคง selector, sort, index และ limit เดิม.
Acceptance ใช้ /{db}/_explain ยืนยัน index ที่ระบุและทดสอบข้อมูลเกิน 100 รายการว่าอ่านต่อครบ ไม่มีซ้ำ/ขาด และเรียง assessment_date ล่าสุดก่อน.
CouchDB มี default limit 25 และ use_index เป็น hint เว้นแต่ปิด fallback; อ้างอิง [CouchDB Find API](https://docs.couchdb.org/en/stable/api/database/find.html)
และ [Mango Indexes](https://docs.couchdb.org/en/stable/ddocs/mango.html).

## Acceptance criteria

- Role owner ใน shelter เดียวกันเขียน Role ของตนในวันนี้ได้; สำหรับ SC อนุญาตทั้ง `supply_coordinator` และ `warehouse_staff`. shelter manager ของ shelter เดียวกันเขียนทุก Role วันนี้ได้; app system_admin เขียนทุก Role วันนี้ได้; unrelated role และ scope ข้าม shelter ถูกปฏิเสธ
- Normal user, shelter manager และ app system_admin สร้าง/แก้เอกสารเมื่อวานถูกปฏิเสธ; trusted _admin restore/replication เอกสารย้อนหลังที่ valid ผ่าน; replication ภายใต้ user context ปกติยังถูกปฏิเสธเมื่อเป็นวันย้อนหลัง
- _admin ยังถูกปฏิเสธเมื่อ type/schema ผิด, _id ไม่ตรงค่าที่ derive, เปลี่ยน identity/snapshot หลังสร้าง, counts ไม่ตรง, หรือส่ง _deleted: true
- ทุก actor รวมถึง `_admin` ถูกปฏิเสธเมื่อ timestamp ไม่ใช่ ISO-8601 UTC ที่ parse ได้ หรือ field ในเอกสาร/control/metric ไม่ตรงกับ canonical contract
- _id ต้องตรงกับ shelter/date/role ทั้ง create และ update; role_code และ snapshot fields เปลี่ยนหลังสร้างไม่ได้
- ถ้า `question_set_version` มีค่า ต้องเท่ากับ `daily-sop-role-v1`; การ omit เท่ากับรุ่นนี้และการเพิ่ม `null` ไม่ถือว่า omit. version, การ omit และ Question Bank snapshot เปลี่ยนไม่ได้หลังสร้าง
- `assessor_name` และ `assessed_at` ต้องคงเดิมเมื่อแก้เอกสาร; เฉพาะ audit ของ control ที่เปลี่ยนจึงเปลี่ยนผู้บันทึก/เวลา
- ไม่บันทึก `check_method`, `pass_criteria` หรือ `record_values` ใน control schema_v 1; ผู้สร้าง control ต้องบันทึก `id`, `question` และ `metric_spec` ตามที่กำหนดเท่านั้น
- Metric fields, key/label/unit/step/threshold และลำดับต้องตรง mapping ในภาคผนวก A; D-SC-01 ใช้ `metric_spec: null` คู่กับ `measured_values: {}` และเลือกสถานะตามเกณฑ์ตรวจทีละรายการสินค้า; `measured_values` ของข้อที่มี metric ต้องมี key ชุดเดียวกันครบและค่าตรง step, ข้อที่ไม่ใช้ Parameter ห้ามมี `parameter`, และ parameter ที่ไม่มีค่าต้องแสดงคำอธิบาย, เลือกได้เฉพาะ Pending และบันทึกพร้อม note
- SOP Parameter resolve จาก active shelter override ทั้งชุด หรือ master profile เมื่อไม่มี active override; ค่า effective ที่ใช้ต้องอยู่ใน snapshot และ placeholder ของ Parameter ที่หายต้องไม่ถูกแทนด้วยค่าคาดเดา
- สูตรตัวเลขที่พร้อม implement ใช้ตามภาคผนวก A รวมถึง coverage แบบ `complete = required`, ยอดครัว `produced - distributed - loss = remaining`, การปัดขึ้นสำหรับอัตราส่วนจำนวนคนต่อหน่วย และกรณีตัวตั้งเป็นศูนย์; คำนวณเมื่อ operand ครบ แต่ไม่เลือก status แทนผู้ประเมิน. Logic คำนวณต้องแยกเป็น pure functions ใน daily-sop domain และมี unit tests ครบทุกสูตร รวมกรณีศูนย์, operand ไม่ครบ, step และ `ceil`. D-SC-01 ไม่มีช่องตัวเลข; ผู้ประเมินเลือกสถานะจากการเทียบยอด `stock_ledger` กับการตรวจนับจริงทุกรายการตามเกณฑ์ในหัวข้อด้านล่าง
- `_admin` ข้ามได้เฉพาะ current-day และ actor-equality checks; วันที่ที่ไม่มีจริง, controls ไม่ครบ/ผิด version, metric ไม่สอดคล้อง, counts ผิด และ identity ผิดต้องถูกปฏิเสธ
- เมื่อ create ชนกันจากสอง session ต้องไม่เขียน draft เก่าทับค่าของผู้ชนะ; เมื่อ update จาก base `_rev` เก่าต้องแจ้ง conflict และรักษา draft ไว้ให้ผู้ใช้รวมกับฉบับล่าสุด
- ผู้ใช้ต่าง Role ใน shelter เดียวกันอ่านเอกสารได้ทุก Role ในระดับ DB ตาม DB security (UI จำกัดการแสดงตามข้อด้านล่าง); UI และคำแนะนำต้องห้ามข้อมูลส่วนบุคคล/สุขภาพ/คุ้มครองใน notes และ observations
- UI แสดงเฉพาะ Role ที่ผู้ใช้ประเมินได้ (SM/SA ครบ 9); สร้าง/แก้ไขเฉพาะ Role ที่ capability อนุญาต และห้ามเปิดฟอร์มแก้ไขย้อนหลัง
- Pending ที่ notes เป็น "" หรือ "   " ถูกปฏิเสธ; Pending พร้อมข้อความผ่าน; Pass หรือ Fail พร้อม notes: "" ผ่าน; การ omit field notes ไม่ผ่านทุกสถานะ; null ผ่านเฉพาะในฐานะ unanswered และ summary/status ต้องสอดคล้อง. ข้อที่ขาด SOP Parameter ยังต้องเป็น Pending พร้อม notes
- ปุ่มบันทึกกดได้เมื่อมีข้อมูลที่กรอก; หากมี Pending ที่ไม่มี notes ระบบไม่ส่ง request, เปิดรายละเอียดของข้อนั้น, focus ช่องข้อมูลที่ยังรอ พร้อมกรอบแดงและข้อความแจ้งเตือนตามภาคผนวก B
- สำหรับ unanswered control (`status: null`) ยังต้องมี `checked_by` และ `checked_at` ซึ่งชี้ถึงผู้สร้าง/ผู้บันทึก snapshot ล่าสุด; UI แสดงเป็น audit การบันทึก ไม่สื่อว่าได้ตรวจหน้างานแล้ว
- เอกสาร `daily_sop_assessment` เดิมตาม CR-106/schema §2.21 ไม่ถูกแปลงหรือลบ และไม่ปรากฏในรายการ `daily_sop_role_assessment` ใหม่
- Bangkok boundary tests ให้ผลตามตัวอย่างข้างต้น โดยไม่ขึ้นกับ host timezone/locale
- _security ยืนยัน member shelter role และ app system_admin ใน admin policy; ระบุว่าการอ่านเป็น DB-wide ภายในฐาน shelter ไม่ใช่ row-level VDU
- Question Bank มี 79 IDs ไม่ซ้ำและจำนวนต่อ Role เป็น 9/5/7/9/6/10/8/10/15; รายการตัด 12 ข้อไม่ปรากฏ; ถ้อยคำคำถามและชื่อช่องตัวเลขตรงกับภาคผนวก A
- Mango _explain เลือก index ที่ระบุ, ไม่มี fallback, sort วันล่าสุดก่อน และ bookmark อ่านหน้าถัดไปได้ครบ
- Mango index/sort ใช้ `role_code: desc` เป็น tiebreaker ลำดับสุดท้าย; sort ทุก field เป็นทิศเดียวกัน, Role ในวันเดียวกันเรียงแน่นอน และ bookmark ต้องไม่ทำให้รายการซ้ำหรือขาด
- จาก D-SC-01 ผู้ประเมินทั้ง `warehouse_staff` และ `supply_coordinator` เปิด/ปิดรายการยอดแบบอ่านอย่างเดียวของ shelter เดียวกับแบบประเมินได้; UI แสดงชื่อ/รหัสสินค้า หน่วย ยอดคงเหลือ และ `last_updated` ระดับศูนย์ (เวลารายการ stock ledger ล่าสุด) จาก endpoint ที่ระบุ โดยไม่แสดง occupancy, reorder threshold, difference, status หรือคำสั่งแก้สต็อก. การเปิด/ปิดรายการไม่ล้างคำตอบที่กำลังกรอก
- หากเรียก endpoint ยอดคงเหลือไม่ได้, `shelter_code` ใน response ไม่ตรงกับเอกสารประเมิน, หรือข้อมูลไม่พอ ผู้ประเมินเลือก Pending พร้อม note ได้; หาก stock ledger มี movement ระหว่างตรวจ ให้ refresh และตรวจรายการที่ได้รับผลอีกครั้ง หรือเลือก Pending เมื่อยืนยันยอด ณ เวลาตรวจไม่ได้
- ฟอร์มว่างที่ยังไม่มีคำตอบ ค่าตรวจ note หรือ observation ไม่สร้างเอกสาร; create แรกต้องสร้าง snapshot ครบทุก ID ตามรุ่น
- แต่ละวันแสดงเฉพาะ Role ที่ผู้ใช้ประเมินได้ (ลำดับ 9 Role เดิม); Role ที่แสดงแต่ยังไม่มีเอกสารแสดง `Not started` แบบ UI-only พร้อมความคืบหน้า 0/จำนวนข้อทั้งหมด โดยไม่สร้างเอกสารเปล่า; จำนวนรวม ("/ N ตำแหน่ง") นับตามแถวที่แสดง
- **Acceptance matrix (visibility)** — ทดสอบด้วย unit และ e2e:

  | บัญชี | Role ที่แสดง | Deep link ไป Role ที่ไม่มีสิทธิ์ |
  | --- | --- | --- |
  | ผู้ถือตำแหน่ง REG | REG | ปฏิเสธ |
  | REG + MED | REG, MED | ปฏิเสธสำหรับ Role อื่น |
  | `warehouse_staff` | SC | ปฏิเสธสำหรับ Role อื่น |
  | shelter_manager ของ shelter นี้ | ครบ 9 | อนุญาต |
  | app system_admin | ครบ 9 | อนุญาต |
  | ไม่มีตำแหน่ง | ไม่มี (แสดง empty state) | ปฏิเสธ |
  | เจ้าหน้าที่ของ shelter อื่น | ไม่มี | ปฏิเสธ |

- Deep link ไป Role ที่ไม่มีสิทธิ์แสดงสถานะ "ไม่มีสิทธิ์เข้าถึง" และห้ามแสดงคำถาม ผลที่บันทึก metadata หรือปุ่มควบคุมของ Role นั้น
- ปุ่มเปิดรายการยอดสต็อกของ D-SC-01 แสดงเฉพาะเมื่อเปิด Role SC และผู้ใช้ประเมิน SC ได้ (`supply_coordinator`, `warehouse_staff`, SM ของ shelter นั้น, SA); Role อื่นไม่แสดงปุ่มและไม่เรียก endpoint
- UI แสดงถ้อยคำคำถาม 79 ข้อและชื่อช่องตัวเลข 19 ข้อตามภาคผนวก A และข้อความหน้าจอ/ผลตรวจสอบตามภาคผนวก B; รหัสคำถามไม่แสดงเป็นข้อความ (มีเฉพาะ attribute `data-question-id`) และไม่มีข้อความ `threshold`/`เกณฑ์: {สูตร}` อยู่ใน DOM; ข้อความที่มี `{parameter}` แสดงค่าจริงของศูนย์
- **History contract** — รายการวันที่ย้อนหลังแสดงเฉพาะวันที่มีกิจกรรม (มีเอกสาร) ของ Role ที่ผู้ใช้ประเมินได้ บวกวันนี้ (เมื่อผู้ใช้มี Role ที่ประเมินได้อย่างน้อยหนึ่ง Role); ห้ามสรุปว่า "ไม่มีประวัติ" ขณะที่ยังมีหน้าถัดไป (หน้า repository มี 100 เอกสารรวมทุก Role จึงอาจกรองแล้วว่าง) ต้องคงการโหลดเพิ่ม; ไม่มี Role ที่ประเมินได้ = แสดง empty state ชัดเจน ไม่แสดงแถววันนี้
- เมื่อ client ทราบว่าผู้ใช้เสียสิทธิ์ต่อ Role/shelter ที่เปิดอยู่ (เปลี่ยนผู้ใช้ หรือ `authStore` ได้รับ session roles ใหม่จาก revalidation/re-login) ต้องปิด dialog บันทึกสำเร็จและแผงรายการยอดสต็อก ล้าง draft/ข้อมูลเอกสารที่เลือก และแสดงสถานะ "ไม่มีสิทธิ์เข้าถึง"; ผลบันทึกที่เสร็จทีหลังอัปเดต dialog ได้เฉพาะเมื่อผู้ใช้ shelter วันที่ และ Role เดิมยังเปิดอยู่. การตรวจจับการถอนสิทธิ์จากภายนอกแบบทันทีอยู่นอกขอบเขต (feature แยก)

_admin ที่ bypass time/actor checks เป็น trusted operational boundary; จำกัด credentials และการใช้งานไว้กับ CouchDB server administrators.
PR นี้บันทึก contract เท่านั้นและไม่เปลี่ยน credentials, provisioner, VDU หรือ runtime.

## ภาคผนวก A — Question Bank Daily SOP แยกตามหน้าที่

- ชุดคำถาม: Daily SOP แยกตามหน้าที่
- จำนวน: **79 ข้อ** ใน 9 หน้าที่ ตามมติลดจาก 91 ข้อและตัด 12 ข้อ
- สถานะคำตอบ: **ผ่าน / ไม่ผ่าน / รอตรวจ** (Pass / Fail / Pending; UI แสดง Pending เป็น "รอข้อมูล" ตามภาคผนวก B); ยังไม่ตอบเป็นอีกสถานะหนึ่ง
- ถ้อยคำคำถามที่เหลือและ D-SM-03 ปรับตามมติในส่วนสรุปของ CR นี้; snapshots ที่บันทึกแล้วไม่เปลี่ยนตาม Question Bank รุ่นใหม่
- คำถามที่มีวงเล็บปีกกา `{ค่า Parameter}` ให้แทนด้วย effective value ของศูนย์เมื่อ resolve ได้; หากไม่มีค่า ให้ snapshot เก็บ token ไว้และ UI แสดงข้อความชัดเจนว่าไม่มีค่า Parameter พร้อมให้ตอบ Pending เท่านั้น ห้ามแสดง token เปล่าโดยไม่มีคำอธิบาย
- ถ้อยคำคำถามและชื่อช่องตัวเลขในภาคผนวกนี้แสดงใน UI, snapshot และ VDU ตรวจ (ปรับถ้อยคำทั้ง 79 ข้อและชื่อช่องตัวเลข 19 ข้อเมื่อ 2026-10-25 ตามหลักการในภาคผนวก B); ข้อความหน้าจอและข้อความผลตรวจสอบจากตัวเลขอยู่ในภาคผนวก B
- ไม่แสดงแหล่งอ้างอิงหรือวิธีตรวจในหน้าแบบประเมินตามขอบเขตที่ตกลง; schema_v 1 snapshot เฉพาะ ID, ข้อความคำถาม และ metric_spec ตามตารางด้านล่าง โดยไม่เก็บ `check_method`, `pass_criteria` หรือ `record_values`

### ผู้จัดการศูนย์พักพิง (SM) — 9 ข้อ

1. **D-SM-02** ขณะนี้มีผู้พักพิงอยู่ในศูนย์ไม่เกินจำนวนที่ศูนย์รองรับได้หรือไม่?
2. **D-SM-03** ปัญหาจากการประเมินของฝ่ายต่าง ๆ ที่กระทบความปลอดภัยหรือบริการจำเป็น มีผู้รับผิดชอบและแผนแก้ไขครบทุกเรื่องหรือไม่?
3. **D-SM-04** วันนี้มีการตรวจสอบและบันทึกสถานะระบบน้ำ ไฟฟ้า การสื่อสาร และเชื้อเพลิงครบทุกส่วนแล้วหรือไม่?
4. **D-SM-05** มีแผนเตรียมน้ำ อาหาร ยา และสิ่งของจำเป็นให้เพียงพอสำหรับช่วงการทำงานถัดไปหรือไม่?
5. **D-SM-06** รถพยาบาล รถกู้ภัย และรถขนส่งสิ่งของจำเป็น ยังสามารถเข้าออกศูนย์ได้หรือไม่?
6. **D-SM-07** ศูนย์ได้ส่งรายงานสถานการณ์และความต้องการของศูนย์ภายในเวลาที่กำหนดหรือไม่?
7. **D-SM-08** ข้อร้องเรียนเร่งด่วนทุกเรื่องมีผู้รับผิดชอบและได้รับการส่งต่อเพื่อดำเนินการแล้วหรือไม่?
8. **D-SM-09** ข้อมูลที่ประกาศหรือแจ้งผู้พักพิงเป็นข้อมูลล่าสุด และสอดคล้องกับคำสั่งของศูนย์บัญชาการเหตุการณ์หรือไม่?
9. **D-SM-10** ได้รับข้อมูลงานค้างจากช่วงการทำงานก่อนหน้า และกำหนดผู้รับผิดชอบครบทุกเรื่องแล้วหรือไม่?

### ลงทะเบียนและข้อมูลผู้พักพิง (REG) — 5 ข้อ

1. **D-REG-01** จุดลงทะเบียนอยู่ก่อนทางเข้าพื้นที่พัก และมีป้ายบอกทางที่มองเห็นชัดเจนหรือไม่?
2. **D-REG-02** จุดลงทะเบียนมีวิธีช่วยเหลือผู้สูงอายุ ผู้พิการ เด็กเล็ก แม่และทารก รวมถึงผู้ที่สื่อสารภาษาไทยไม่ได้หรือไม่?
3. **D-REG-03** ผู้พักพิงที่ต้องการคนช่วยลงทะเบียนได้รับความช่วยเหลือครบทุกคนแล้วหรือไม่?
4. **D-REG-08** จำนวนผู้พักพิงในระบบตรงกับจำนวนที่ตรวจนับจริงในพื้นที่พักหรือไม่?
5. **D-REG-10** วันนี้ฝ่ายทะเบียนได้ส่งจำนวนผู้พักพิงและข้อมูลความต้องการให้ฝ่ายอาหาร น้ำ สถานที่ และสุขภาพครบแล้วหรือไม่?

### คัดกรองและกลุ่มเปราะบาง (TRG) — 7 ข้อ

1. **D-TRG-01** ผู้พักพิงที่มาถึงศูนย์ได้รับการคัดกรองเบื้องต้นก่อนเข้าพื้นที่พักครบทุกคนหรือไม่?
2. **D-TRG-02** มีการแยกผู้ที่สงสัยว่าเป็นโรคติดต่อหรือมีอาการทางเดินหายใจออกจากจุดคัดกรองทั่วไปหรือไม่?
3. **D-TRG-03** ผู้พักพิงที่มีอาการฉุกเฉินได้รับการประเมินความเร่งด่วนและส่งต่อเพื่อรักษาทันเวลาหรือไม่?
4. **D-TRG-04** เจ้าหน้าที่ทุกคนใช้แบบฟอร์มและเกณฑ์คัดกรองชุดเดียวกันในช่วงการทำงานนี้หรือไม่?
5. **D-TRG-05** บันทึกประเภทและความต้องการช่วยเหลือเป็นพิเศษของผู้พักพิงกลุ่มเปราะบางครบทุกคนหรือไม่?
6. **D-TRG-06** ตรวจสอบแล้วหรือไม่ว่าผู้พักพิงแต่ละคนมีข้อจำกัดเรื่องการสื่อสาร การเดินหรือเคลื่อนไหว และการดูแลตนเองอย่างไร?
7. **D-TRG-08** ผู้พักพิงกลุ่มเปราะบางที่ต้องติดตาม ได้รับการติดตามอาการหรือความต้องการภายในเวลาที่กำหนดครบทุกคนหรือไม่?

### การแพทย์และสุขภาพ (MED) — 9 ข้อ

1. **D-MED-01** ขณะนี้จุดปฐมพยาบาลและพื้นที่ตรวจรักษาพร้อมให้บริการผู้พักพิงหรือไม่?
2. **D-MED-02** มีเจ้าหน้าที่ด้านสุขภาพประจำการครอบคลุมทุกช่วงเวลาที่ศูนย์เปิดให้บริการหรือไม่?
3. **D-MED-03** ผู้ป่วยฉุกเฉินได้รับการประเมินและส่งต่อไปยังสถานพยาบาลตามความเร่งด่วนหรือไม่?
4. **D-MED-04** มีแผนติดตามผู้พักพิงที่มีโรคประจำตัวหรือต้องใช้ยาเป็นประจำอย่างต่อเนื่องหรือไม่?
5. **D-MED-05** ยาและเวชภัณฑ์ที่จำเป็นมีเพียงพอ อยู่ในสภาพดี และพร้อมใช้งานหรือไม่?
6. **D-MED-06** ยาเฉพาะที่ต้องควบคุม อุปกรณ์มีคม และสารอันตรายถูกจัดเก็บอย่างปลอดภัยหรือไม่?
7. **D-MED-07** มีการบันทึกผู้ป่วยและเหตุการณ์ที่เกี่ยวกับโรคติดต่อในช่วง 24 ชั่วโมงที่ผ่านมาครบหรือไม่?
8. **D-MED-09** ขยะติดเชื้อจากพื้นที่รักษาได้รับการแยกและส่งกำจัดตามขั้นตอนที่กำหนดหรือไม่?
9. **D-MED-10** ข้อมูลสุขภาพผู้พักพิงถูกเก็บรักษาเป็นความลับ และเปิดเผยเฉพาะเมื่อมีสิทธิ์หรือมีเหตุจำเป็นที่ถูกต้องหรือไม่?

### ครัวและโภชนาการ (KS) — 6 ข้อ

1. **D-KS-04** มีการเตรียมและแยกอาหารให้เหมาะกับข้อจำกัดด้านศาสนา วัฒนธรรม และความจำเป็นของผู้พักพิงแต่ละกลุ่มหรือไม่?
2. **D-KS-05** มีวัตถุดิบและอาหารพร้อมแจกเพียงพอสำหรับมื้อถัดไปตามแผนหรือไม่?
3. **D-KS-06** ภาชนะและอุปกรณ์สำหรับทำอาหาร เก็บอาหาร และแจกอาหาร สะอาด ใช้งานได้ และมีเพียงพอหรือไม่?
4. **D-KS-07** อาหารปรุงสุกมีการปิดคลุมและเก็บรักษาให้สุก ร้อน และสะอาดตามหลักสุขอนามัยหรือไม่?
5. **D-KS-09** เจ้าหน้าที่ครัวล้างมือและใช้อุปกรณ์ป้องกันที่เหมาะสมกับงานหรือไม่?
6. **D-KS-10** จำนวนอาหารที่ทำเสร็จ แจกไป เสียหรือทิ้ง และเหลืออยู่จริง ตรงกับบันทึกหรือไม่?

### คลัง พัสดุ และการแจกจ่าย (SC) — 10 ข้อ

1. **D-SC-01** จำนวนสิ่งของที่รับเข้า จ่ายออก โอนย้าย และเหลือในคลัง ตรงกับยอดตรวจนับจริงหรือไม่?
2. **D-SC-02** หากใช้สิ่งของในอัตราปัจจุบัน สิ่งของจำเป็นในคลังจะเพียงพอตามจำนวนวันที่ศูนย์กำหนดหรือไม่?
3. **D-SC-03** การเบิกและแจกสิ่งของสอดคล้องกับจำนวนผู้พักพิงและความจำเป็นของแต่ละกลุ่มหรือไม่?
4. **D-SC-04** สิ่งของในคลังถูกแยกเป็นหมวดหมู่ มีป้ายชัดเจน และหยิบหาได้ง่ายหรือไม่?
5. **D-SC-05** พื้นที่เก็บของแห้ง ไม่เสี่ยงน้ำท่วม และไม่มีสิ่งของกีดขวางทางเดินหรือไม่?
6. **D-SC-06** มีการจัดเก็บและจ่ายอาหาร ยา และเวชภัณฑ์โดยตรวจวันหมดอายุและเลขรุ่นหรือไม่?
7. **D-SC-07** การรับสิ่งของบริจาคแต่ละครั้งมีรายการรับมอบครบ และจำนวนตรงกับบัญชีคลังหรือไม่?
8. **D-SC-08** จุดแจกสิ่งของมีการจัดคิวอย่างเป็นระเบียบ และปฏิบัติต่อผู้รับอย่างสุภาพและให้เกียรติหรือไม่?
9. **D-SC-09** จำนวนสิ่งของที่แต่ละครัวเรือนได้รับตรงตามสิทธิหรือจำนวนที่กำหนดไว้หรือไม่?
10. **D-SC-10** ผู้พักพิงมีช่องทางแจ้งว่าไม่ได้รับสิ่งของหรือได้รับไม่ครบ โดยแจ้งได้อย่างปลอดภัยหรือไม่?

### อาสาสมัครและกำลังคน (VC) — 8 ข้อ

1. **D-VC-01** จำนวนอาสาสมัครที่มาทำงานจริงตรงกับจำนวนที่กำหนดไว้ในตารางกะหรือไม่?
2. **D-VC-02** ขณะนี้มีอาสาสมัครพร้อมทำงานเพียงพอต่อจำนวนผู้พักพิงตามเกณฑ์ของศูนย์หรือไม่?
3. **D-VC-03** มีการมอบหมายงานให้ตรงกับทักษะและข้อจำกัดของอาสาสมัครหรือไม่?
4. **D-VC-04** อาสาสมัครที่เริ่มทำงานได้รับคำชี้แจงเรื่องกฎ ความปลอดภัย และการคุ้มครองผู้พักพิงครบทุกคนหรือไม่?
5. **D-VC-05** อาสาสมัครทุกคนได้รับเอกสารหรือคำสั่งมอบหมายงานที่ระบุหน้าที่ ขอบเขตที่ทำได้ และผู้ควบคุมงานก่อนเริ่มงานหรือไม่?
6. **D-VC-06** ทุกช่วงกะที่ศูนย์เปิดให้บริการ มีผู้รับผิดชอบงานสำคัญครบทุกหน้าที่หรือไม่?
7. **D-VC-07** อาสาสมัครได้รับอุปกรณ์ป้องกัน น้ำ อาหาร และเวลาพักที่เหมาะสมกับความเสี่ยงของงานหรือไม่?
8. **D-VC-08** มีการบันทึกเวลาเริ่มงาน เลิกงาน และการส่งต่องานของอาสาสมัครครบหรือไม่?

### ความปลอดภัย (SO) — 10 ข้อ

1. **D-SO-01** มีการดูแลทางเข้าออกของศูนย์และตรวจสอบบุคคลภายนอกตามแผนหรือไม่?
2. **D-SO-02** มีเจ้าหน้าที่เฝ้าระวังหรือตรวจพื้นที่สำคัญครบตามตารางที่กำหนดหรือไม่?
3. **D-SO-03** ทางหนีไฟ ทางออกฉุกเฉิน และจุดรวมพลทุกจุดพร้อมใช้งานและไม่มีสิ่งกีดขวางหรือไม่?
4. **D-SO-04** อุปกรณ์ดับเพลิง ระบบแจ้งเตือน และระบบตัดไฟฉุกเฉินพร้อมใช้งานหรือไม่?
5. **D-SO-05** บริเวณเสี่ยง เช่น ริมน้ำ บ่อน้ำ ทางลาด และจุดน้ำท่วมขัง มีแนวกั้นหรือป้ายเตือนชัดเจนหรือไม่?
6. **D-SO-06** รถฉุกเฉินสามารถเข้าถึงจุดสำคัญภายในศูนย์พักพิงได้หรือไม่?
7. **D-SO-07** มีขั้นตอนรับแจ้งและส่งต่อเหตุทะเลาะวิวาท ความรุนแรง หรือการคุกคามอย่างชัดเจนหรือไม่?
8. **D-SO-08** พื้นที่พักและทางเดินไปห้องน้ำมีมาตรการดูแลความปลอดภัยให้ผู้พักพิงกลุ่มเปราะบางหรือไม่?
9. **D-SO-09** มีไฟส่องสว่างเพียงพอตลอดคืนในทางเดิน จุดอับ ห้องน้ำ และทางออกหรือไม่?
10. **D-SO-10** เหตุการณ์ด้านความปลอดภัยได้รับการบันทึกเวลา สถานที่ และวิธีดำเนินการครบหรือไม่?

### สถานที่ พื้นที่พัก และสาธารณูปโภค (FAC) — 15 ข้อ

1. **D-FAC-01** พื้นที่นอนพักที่ใช้ได้จริงมีเพียงพอ โดยผู้พักพิงแต่ละคนมีพื้นที่ไม่น้อยกว่า {m2_per_person_living} ตารางเมตรหรือไม่?
2. **D-FAC-02** ห้องน้ำหญิงที่ใช้งานได้มีเพียงพอ โดยมีผู้พักพิงหญิงไม่เกิน {people_per_toilet_female} คนต่อห้องหรือไม่?
3. **D-FAC-03** ห้องน้ำชายที่ใช้งานได้มีเพียงพอ โดยมีผู้พักพิงชายไม่เกิน {people_per_toilet_male} คนต่อห้องหรือไม่?
4. **D-FAC-04** ห้องน้ำสำหรับผู้พิการและผู้สูงอายุสามารถเดินทางไปถึงและใช้งานได้จริงหรือไม่?
5. **D-FAC-05** ทางเดินจากพื้นที่พักไปห้องน้ำปลอดภัย และผู้พักพิงที่มีข้อจำกัดในการเคลื่อนไหวสามารถใช้ได้หรือไม่?
6. **D-FAC-06** จุดอาบน้ำที่ใช้งานได้มีเพียงพอ โดยมีผู้พักพิงไม่เกิน {people_per_bathing} คนต่อจุดหรือไม่?
7. **D-FAC-07** จุดซักล้างที่ใช้งานได้มีเพียงพอ โดยมีผู้พักพิงไม่เกิน {people_per_laundry} คนต่อจุดหรือไม่?
8. **D-FAC-08** มีน้ำสะอาดที่ปลอดภัยต่อการใช้งานและการบริโภค เพียงพอตามจำนวนที่วางแผนไว้สำหรับวันนี้หรือไม่?
9. **D-FAC-09** มีผลตรวจคุณภาพน้ำหรือวิธีควบคุมความปลอดภัยของแหล่งน้ำและน้ำที่แจกให้ผู้พักพิงตามแผนหรือไม่?
10. **D-FAC-10** จุดจ่ายน้ำที่ใช้งานได้มีเพียงพอ โดยมีผู้พักพิงไม่เกิน {people_per_tap} คนต่อจุดหรือไม่?
11. **D-FAC-11** ผู้พักพิงสามารถเดินไปใช้จุดจ่ายน้ำได้อย่างปลอดภัยหรือไม่?
12. **D-FAC-12** ระบบระบายน้ำป้องกันน้ำฝนและน้ำเสียขังในพื้นที่บริการ รวมถึงป้องกันน้ำเสียปนเปื้อนแหล่งน้ำได้หรือไม่?
13. **D-FAC-13** จุดทิ้งขยะมีถังที่ปิดได้ แยกประเภทขยะ และมีพื้นที่เพียงพอก่อนถึงเวลาเก็บขยะครั้งถัดไปหรือไม่?
14. **D-FAC-14** ระบบไฟฟ้าและไฟสำรองปลอดภัย และพร้อมใช้งานเมื่อเกิดน้ำท่วมหรือไฟฟ้าดับหรือไม่?
15. **D-FAC-15** พื้นที่พักมีอากาศถ่ายเทและไม่ร้อนเกินไปสำหรับการพักอาศัยหรือไม่?

### คำถามที่แสดงค่า SOP Parameter

| รหัส     | Parameter ที่ใช้แสดงในคำถาม | ค่า/หลักการ                                                                 |
| -------- | --------------------------- | --------------------------------------------------------------------------- |
| D-VC-02  | `people_per_volunteer`      | ใช้ค่าที่ตั้งไว้ใน SOP Parameter ของศูนย์                                   |
| D-FAC-01 | `m2_per_person_living`      | พื้นที่พักอาศัยสุทธิในอากาศร้อน; ค่าโครงการที่ยืนยันไว้คือ **3.5 ตร.ม./คน** |
| D-FAC-02 | `people_per_toilet_female`  | ใช้ค่าที่ตั้งไว้ใน SOP Parameter ของศูนย์                                   |
| D-FAC-03 | `people_per_toilet_male`    | ใช้ค่าที่ตั้งไว้ใน SOP Parameter ของศูนย์                                   |
| D-FAC-06 | `people_per_bathing`        | ใช้ค่าที่ตั้งไว้ใน SOP Parameter ของศูนย์                                   |
| D-FAC-07 | `people_per_laundry`        | ใช้ค่าที่ตั้งไว้ใน SOP Parameter ของศูนย์                                   |
| D-FAC-10 | `people_per_tap`            | ใช้ค่าที่ตั้งไว้ใน SOP Parameter ของศูนย์                                   |

ระบบ resolve effective ratios จาก active shelter override ทั้งชุด หรือ master profile เมื่อไม่มี active override
แทนค่าดังกล่าวในคำถามและเก็บ effective value พร้อมผลตรวจของวันนั้นตาม contract ข้างต้น; D-FAC-01
มีค่า master 3.5 ตร.ม./คนตามที่ยืนยันไว้ แต่ active override อาจกำหนดค่าอื่น. หากไม่มีค่า Parameter
ระบบไม่ให้เลือก “ผ่าน” หรือ “ไม่ผ่าน”; ให้เลือก Pending (“รอข้อมูล” ตามภาคผนวก B) และบันทึกหมายเหตุแทนการใช้ค่าคาดเดา

### ช่องตัวเลขเพิ่มเติม (ไม่บังคับกรอก)

ช่องเหล่านี้ใช้ช่วยบันทึกค่าจริงและคำนวณเทียบเกณฑ์ ผู้ตรวจยังต้องเลือกสถานะด้วยตนเอง

| รหัส     | ค่าที่กรอกได้                                                         | `metric_spec.fields[].key` ตามลำดับ               | การเทียบ/คำนวณ                                     |
| -------- | --------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| D-SM-02  | ผู้พักพิงที่อยู่ในศูนย์ขณะนี้ (คน), จำนวนผู้พักพิงสูงสุดที่ศูนย์รองรับได้ (คน) | `occupants`, `capacity`                            | `occupants ≤ capacity`                             |
| D-REG-03 | ผู้ที่ต้องการความช่วยเหลือในการลงทะเบียน (คน), ในจำนวนนี้ ได้รับความช่วยเหลือแล้ว (คน) | `required`, `complete`                             | `complete = required`; ถ้า required = 0 ต้อง complete = 0 |
| D-TRG-01 | ผู้พักพิงที่มาถึงศูนย์ (คน), ในจำนวนนี้ คัดกรองแล้ว (คน) | `required`, `complete`                             | `complete = required`; ถ้า required = 0 ต้อง complete = 0 |
| D-TRG-05 | ผู้พักพิงกลุ่มเปราะบางที่พบ (คน), ในจำนวนนี้ บันทึกประเภทและความต้องการครบแล้ว (คน) | `required`, `complete` | `complete = required`; ถ้า required = 0 ต้อง complete = 0 |
| D-TRG-08 | รายการติดตามที่ถึงกำหนด (รายการ), ในจำนวนนี้ ติดตามแล้ว (รายการ) | `required`, `complete`                             | `complete = required`; ถ้า required = 0 ต้อง complete = 0 |
| D-KS-06  | จำนวนอุปกรณ์ที่ต้องใช้ (ชิ้น), อุปกรณ์ที่สะอาดและใช้งานได้ (ชิ้น) | `required`, `usable`                               | `usable ≥ required`                                |
| D-KS-10  | อาหารที่ทำเสร็จ (ที่), อาหารที่แจกแล้ว (ที่), อาหารเสีย หก หรือทิ้ง (ที่), อาหารที่เหลืออยู่จริง (ที่) | `produced`, `distributed`, `loss`, `remaining`     | `produced - distributed - loss = remaining`        |
| D-VC-01  | จำนวนอาสาสมัครตามตารางกะ (คน), จำนวนอาสาสมัครที่มาทำงานจริง (คน) | `rostered`, `present`                              | จำนวนตรงกันเมื่อ `present = rostered`; ผู้ประเมินเลือก status เองและบันทึกเหตุผลใน notes เมื่อเกี่ยวข้อง |
| D-VC-02  | ผู้พักพิงที่อยู่ในศูนย์ขณะนี้ (คน), อาสาสมัครที่พร้อมทำงานขณะนี้ (คน) | `occupants`, `volunteers`                          | `volunteers ≥ ceil(occupants ÷ Parameter)`; ถ้า occupants = 0 ต้องการ 0 คน |
| D-VC-03  | งานที่ต้องใช้ทักษะเฉพาะ (งาน), ในจำนวนนี้ มอบหมายให้ผู้มีทักษะตรงแล้ว (งาน) | `required`, `complete`                             | `complete = required`; ถ้า required = 0 ต้อง complete = 0 |
| D-VC-04  | อาสาสมัครที่เริ่มงาน (คน), ในจำนวนนี้ ได้รับคำชี้แจงแล้ว (คน) | `required`, `complete`                             | `complete = required`; ถ้า required = 0 ต้อง complete = 0 |
| D-VC-05  | อาสาสมัครที่ได้รับมอบหมายงาน (คน), ในจำนวนนี้ มีคำสั่งงานและผู้ควบคุมแล้ว (คน) | `required`, `complete`                             | `complete = required`; ถ้า required = 0 ต้อง complete = 0 |
| D-FAC-01 | พื้นที่นอนพักที่ใช้ได้จริง (ตร.ม.), ผู้พักพิงที่อยู่ในศูนย์ขณะนี้ (คน) | `usableArea`, `occupants`                          | ถ้า occupants > 0: `usableArea ÷ occupants ≥ Parameter`; ถ้า occupants = 0 ให้พื้นที่ขั้นต่ำเป็น 0 ตร.ม. |
| D-FAC-02 | ผู้พักพิงหญิง (คน), ห้องน้ำหญิงที่ใช้ได้จริง (ห้อง) | `people`, `units`                                  | `units ≥ ceil(people ÷ Parameter)`; ถ้า people = 0 ต้องการ 0 ห้อง |
| D-FAC-03 | ผู้พักพิงชาย (คน), ห้องน้ำชายที่ใช้ได้จริง (ห้อง) | `people`, `units`                                  | `units ≥ ceil(people ÷ Parameter)`; ถ้า people = 0 ต้องการ 0 ห้อง |
| D-FAC-06 | ผู้พักพิงที่อยู่ในศูนย์ขณะนี้ (คน), จุดอาบน้ำที่ใช้ได้จริง (จุด) | `people`, `units`                                  | `units ≥ ceil(people ÷ Parameter)`; ถ้า people = 0 ต้องการ 0 จุด |
| D-FAC-07 | ผู้พักพิงที่อยู่ในศูนย์ขณะนี้ (คน), จุดซักล้างที่ใช้ได้จริง (จุด) | `people`, `units`                                  | `units ≥ ceil(people ÷ Parameter)`; ถ้า people = 0 ต้องการ 0 จุด |
| D-FAC-08 | น้ำสะอาดที่มีพร้อมใช้ (ลิตร), ปริมาณน้ำที่ศูนย์วางแผนว่าจะใช้วันนี้ (ลิตร) | `available`, `plannedNeed`                         | `available ≥ plannedNeed`                          |
| D-FAC-10 | ผู้พักพิงที่อยู่ในศูนย์ขณะนี้ (คน), จุดจ่ายน้ำที่ใช้ได้จริง (จุด) | `people`, `units`                                  | `units ≥ ceil(people ÷ Parameter)`; ถ้า people = 0 ต้องการ 0 จุด |

สำหรับ D-TRG-05 `complete` นับผู้พักพิงหนึ่งคนต่อหนึ่งรายการ แม้คนเดียวระบุได้หลายประเภท/ความต้องการ; รายการที่ยังไม่มีข้อมูลประเภทหรือความต้องการครบไม่นับว่า complete. สำหรับแต่ละแถว ลำดับ field key ใน `metric_spec.fields[]` ตรงกับลำดับค่าในคอลัมน์ `ค่าที่กรอกได้`; `label` ใช้ชื่อค่าก่อนหน่วยในวงเล็บ, `unit` ใช้หน่วยในวงเล็บ และ `step` ต้องเป็นค่าตามกติกาหน่วยใน data contract. UI และ VDU ต้องปฏิเสธค่าที่ไม่เป็นจำนวนเท่าของ `step`. `threshold` ใช้เกณฑ์ในคอลัมน์ `การเทียบ/คำนวณ` โดยแทน `Parameter` ด้วยค่าที่ snapshot. `measured_values` ต้องมี key set ตรงกับ field keys ในแถว (ลำดับ object ไม่มีความหมาย); ช่องที่ยังไม่กรอกใช้ `null`. คำนวณด้วย decimal arithmetic ที่ความละเอียดตาม `step`; ไม่มีการปัดเศษระหว่างทางยกเว้น `ceil` ที่ระบุไว้ในสูตร. สูตรเปรียบเทียบเป็นค่าช่วยตัดสินเท่านั้น; ระบบคำนวณผลเมื่อ operand ที่สูตรต้องใช้มีครบ, ไม่บันทึกผลคำนวณแยก และไม่เลือก Pass/Fail ให้อัตโนมัติ. ผู้ประเมินเป็นผู้เลือก status เอง โดยอาศัยการตรวจจริงและบริบทหน้างาน.

การเว้นช่องตัวเลขไม่ทำให้คำถามยังไม่ตอบ หากเลือกสถานะแล้ว; แต่ระบบจะไม่มีผลคำนวณจนกว่าจะกรอก
ค่าที่จำเป็นครบถ้วน

## เกณฑ์ตรวจยอดคลัง D-SC-01

### ทางเดินผู้ตรวจ

1. เจ้าหน้าที่เปิดแบบประเมิน Role SC แล้วเปิด D-SC-01.
2. เปิดรายการยอดคงเหลือแบบอ่านอย่างเดียวในข้อประเมิน. ระบบเรียก `GET /api/v1/shelters/{shelter_code}/stock-status` โดยใช้ `shelter_code` จากเอกสารประเมิน และตรวจว่า `shelter_code` ใน response ตรงกันก่อนแสดงผล.
3. UI เลือกแสดงชื่อ/รหัสสินค้า หน่วย และยอดคงเหลือ พร้อม `last_updated` หนึ่งค่าระดับศูนย์ซึ่งหมายถึงเวลารายการ stock ledger ล่าสุด ไม่ใช่เวลาของสินค้าแต่ละรายการ. ห้ามแสดง occupancy, reorder threshold, difference, status หรือคำสั่งรับเข้า/เบิก/ปรับยอด. ผู้ประเมินทั้ง `warehouse_staff` และ `supply_coordinator` ใช้รายการอ่านอย่างเดียวนี้ได้; ไม่ต้องมีสิทธิ์แก้สต็อก.
4. ตรวจนับของจริงทีละรายการโดยใช้หน่วยเดียวกับที่แสดง. ถ้านับเป็นบรรจุภัณฑ์ ให้แปลงเป็นหน่วยฐานตาม conversion ของสินค้า; ถ้าไม่มี conversion หรือแปลงไม่ได้ให้ Pending.
5. เทียบยอดของแต่ละรายการ ณ เวลาตรวจ. หากมี stock movement ระหว่างตรวจ ให้ refresh รายการและนับซ้ำสินค้าที่ได้รับผล; ถ้ายืนยันยอด ณ เวลาตรวจไม่ได้ให้ Pending.
6. เลือก Pass เมื่อทุกรายการในขอบเขตตรง, Fail เมื่อพบอย่างน้อยหนึ่งรายการไม่ตรง หรือ Pending เมื่อตรวจไม่ครบ/ข้อมูลไม่พอ. เมื่อ Fail ควรระบุชื่อหรือรหัสสินค้าและส่วนต่างใน notes (ระบบไม่บังคับ); การแก้ยอดให้ทำผ่านขั้นตอนจัดการคลังเดิม ไม่แก้จากแบบประเมิน.
7. หากแก้ยอดในระบบคลังแล้วตรวจซ้ำภายในวันเดียวกัน ผู้ใช้แก้ D-SC-01 เป็น Pass ได้เมื่อทุกรายการตรง; ให้คง note ที่บอกส่วนต่างเดิม การแก้ไข และผลตรวจซ้ำ. `checked_by`/`checked_at` จะแสดงผู้บันทึกและเวลาล่าสุดเท่านั้น เพราะ schema_v 1 ไม่เก็บประวัติการแก้ไข.

การเปิด/ปิดรายการยอดไม่ทิ้งคำตอบที่กรอกไว้. Daily SOP ไม่เก็บยอดระบบและยอดตรวจนับเป็น field แยก; notes ใช้ระบุรายการและส่วนต่างที่ต้องติดตามได้. การบันทึกจะเกิดเมื่อผู้ใช้กดบันทึกแบบประเมินตามปกติ.

### เกณฑ์เทียบยอดและการบันทึก

- ขอบเขตตรวจรวมทุกรายการที่แสดงในรายการยอดของ shelter, มีรายการใน `stock_ledger`, มียอดทางบัญชี หรือพบของจริงในคลัง. หากพบของจริงที่ไม่มีในรายการยอด ให้ถือว่ามีความคลาดเคลื่อน; ถ้ายังระบุสินค้า/หน่วยไม่ได้ให้ Pending จนกว่าจะตรวจสอบได้.
- ยอดในระบบของแต่ละ `item_id` คือผลรวม signed `stock_ledger.qty` ถึงเวลาตรวจ; เทียบกับยอดตรวจนับจริงโดยใช้หน่วยเดียวกับรายการยอดและต้องตรงกับ `stock_ledger.unit` (สำหรับ `item_master` ต้องตรง `item_master.base_unit`) ตามสัญญา `stock_ledger` ใน schema §2.1. จึงครอบคลุมรับเข้า จ่ายออก โอน ปรับยอด และรายการคืนตาม ledger. ห้ามรวมตัวเลขข้ามสินค้า/หน่วย.
- schema_v 1 เปรียบเทียบค่าหลังแปลงเป็นหน่วยเดียวกันด้วย decimal precision ตาม CR-038 (`qty_str` สูงสุด 4 ตำแหน่งทศนิยม); ไม่ปัดเศษเพิ่มเติมและไม่มี tolerance นอกเหนือจากความละเอียดของหน่วยที่บันทึก. ถ้าเครื่องมือหรือหน่วยที่ใช้ตรวจละเอียดไม่พอยืนยันค่า ให้ Pending แทนการเดา. movement ก่อนเวลาตรวจไม่ทำให้ Fail หากยอดปัจจุบันและของจริงตรงกัน.
- **Pass:** ตรวจครบทุกสินค้าในขอบเขตและยอดตรงกัน; ถ้าไม่มีสินค้า ให้ยืนยันทั้งยอดทางบัญชีและยอดตรวจนับเป็นศูนย์ก่อน.
- **Fail:** พบอย่างน้อยหนึ่งรายการไม่ตรง รวมถึงพบของจริงที่ไม่มีในรายการยอด. notes ควรระบุชื่อ/รหัสสินค้าและส่วนต่าง (ระบบไม่บังคับ); การปรับยอดทำผ่านขั้นตอนจัดการคลังเดิม.
- **Pending:** ตรวจไม่ครบ, endpoint ใช้ไม่ได้, shelter code ใน response ไม่ตรง, หน่วย/conversion ไม่ชัด, หรือ movement ระหว่างตรวจยังทำให้ยืนยันยอดไม่ได้. notes ระบุสาเหตุและรายการที่ยังต้องตรวจ.

schema_v 1 ไม่เก็บยอดคงเหลือและยอดตรวจนับเป็น field ตัวเลขรวม/รายสินค้าสำหรับ D-SC-01 เพราะสินค้าหลายรายการใช้คนละหน่วย. `metric_spec` เป็น `null` และ `measured_values` เป็น `{}`; ผู้ประเมินบันทึกสถานะและ notes/observations ตาม contract ได้ โดย notes ระบุรหัสสินค้าและส่วนต่างที่ต้องติดตามได้ แต่ห้ามใส่ข้อมูลส่วนบุคคล.

## ภาคผนวก B — ข้อความหน้าจอ (ไม่ persist)

> **สรุป:** ข้อความบนหน้าแบบประเมินที่ไม่ถูกบันทึกในเอกสาร: ป้ายสถานะ หัวข้อ คำแนะนำ แจ้งเตือน และข้อความผลตรวจสอบจากตัวเลข. ถ้อยคำคำถามและชื่อช่องตัวเลขอยู่ในภาคผนวก A.

หลักการถ้อยคำ (ใช้กับทั้งภาคผนวก A และ B):

- อ่านแล้วรู้ทันทีว่าต้องตรวจอะไร และเลือกผ่าน/ไม่ผ่านจากอะไร โดยไม่ต้องรู้ศัพท์เทคนิค; ความหมายของเงื่อนไขต้องเท่าเดิม (ไม่ผ่านง่ายขึ้นหรือยากขึ้น)
- ใช้ "วันนี้" สำหรับช่วงวัน, "ขณะนี้" สำหรับสภาพปัจจุบัน, "ช่วงการทำงานนี้/ก่อนหน้า/ถัดไป" สำหรับกะ, "ภายในเวลาที่กำหนด" สำหรับกำหนดส่ง/ติดตาม
- "กลุ่มเปราะบาง" คงเป็นชื่อหมวดข้อมูล; ไม่เปลี่ยน classification ของ D-TRG-05
- D-KS-10 ใช้หน่วย "ที่" (ไม่บังคับว่าเป็นกล่อง); D-VC-01 ตรวจว่าจำนวนตรงตามตารางกะ (มาเกินก็ไม่ตรง)
- ข้อความผลตรวจสอบจากตัวเลขเป็นค่าช่วยตัดสินเท่านั้น ผู้ประเมินเลือกสถานะเอง; ตัวเลข 0 เป็นค่าที่คำนวณได้ ส่วนช่องที่ยังไม่กรอกไม่แสดงผลคำนวณ
- ข้อที่ขาด SOP Parameter ต้องบอกว่าขาดข้อมูลใดและให้เลือก "รอข้อมูล" พร้อม notes

### B.1 ข้อความหน้าจอ

| ตำแหน่งบนหน้าจอ | ข้อความ |
| --- | --- |
| ป้ายสถานะ (Pass / Fail / Pending) | ผ่าน / ไม่ผ่าน / รอข้อมูล |
| หัวข้อหน้ารายการ | แบบประเมินการดำเนินงานประจำวัน |
| ส่วนวันที่ | รายการประเมินประจำวันที่ {date} |
| หัวกล่องช่องตัวเลข | ข้อมูลตัวเลขสำหรับตรวจสอบ (ไม่บังคับ) |
| บรรทัดสูตรเกณฑ์ | ไม่แสดง (คงอยู่ใน snapshot เพื่อ audit) |
| หัวข้อผลคำนวณ | ผลตรวจสอบจากตัวเลข: {ข้อความผ่าน/ไม่ผ่านของข้อนั้นตาม B.3} |
| ค่าที่ควรเหลือ (D-KS-10) | ควรเหลือ {ทำเสร็จ − แจก − เสีย} ที่ (ทำเสร็จ {n} − แจก {n} − เสีย {n}); แสดงใต้ผลตรวจสอบเมื่อกรอกทำเสร็จ แจก และเสียครบ |
| ใต้ผลตรวจสอบ | ตัวเลขช่วยตรวจสอบเบื้องต้น โปรดดูสถานการณ์จริงก่อนเลือกผล |
| ค่าที่ระบบกรอกให้ | ระบบกรอกข้อมูลบางส่วนให้แล้ว โปรดตรวจสอบและแก้ไขหากไม่ตรงกับข้อมูลจริง |
| หัวรายละเอียด (รอข้อมูล) | ระบุข้อมูลที่ยังรอ (จำเป็น) |
| หัวรายละเอียด (ผ่าน/ไม่ผ่าน) | รายละเอียดเพิ่มเติม (ไม่บังคับ) |
| ช่อง observations | สิ่งที่พบจากการตรวจ (ถ้ามี) |
| ป้ายช่อง notes (รอข้อมูล) | ข้อมูลที่ยังรอ (จำเป็น) |
| ป้ายช่อง notes (ผ่าน/ไม่ผ่าน) | หมายเหตุเพิ่มเติม (ถ้ามี) |
| placeholder (ไม่ผ่าน) | เช่น พบปัญหาอะไร ดำเนินการแก้อย่างไร หรือใครรับผิดชอบ |
| placeholder (รอข้อมูล) | ระบุข้อมูลที่ยังขาด เหตุผลที่ต้องรอ และผู้รับผิดชอบติดตาม |
| แจ้งเตือนเมื่อรอข้อมูลไม่มี notes | ข้อ {n}: กรุณาระบุข้อมูลที่ยังรอ (`{n}` = ลำดับข้อที่แสดงใน Role นั้น) |
| deep link ไป Role ที่ไม่มีสิทธิ์ | บัญชีนี้ไม่สามารถเปิดแบบประเมินของตำแหน่งนี้ได้ |
| ไม่มี Role ที่ประเมินได้ | บัญชีนี้ยังไม่มีแบบประเมินที่สามารถทำได้ในศูนย์นี้ |
| ประวัติหน้าที่โหลดยังไม่พบ (ยังมีหน้าถัดไป) | ยังไม่พบประวัติที่เกี่ยวข้อง กด “โหลดเพิ่มเติม” เพื่อตรวจสอบวันก่อนหน้า |
| โหลดค่า SOP Parameter ไม่สำเร็จ | โหลดข้อมูลเกณฑ์ของศูนย์ไม่สำเร็จ โปรดลองอีกครั้ง หากยังไม่มีข้อมูลให้เลือก “รอข้อมูล” และระบุสิ่งที่ขาด |
| ปุ่มโหลดหน้าถัดไป | โหลดเพิ่มเติม |

### B.2 ข้อความผลตรวจสอบจากตัวเลข 19 ข้อ

| รหัส | ข้อความเมื่อตัวเลขเข้าเกณฑ์ | ข้อความเมื่อตัวเลขไม่เข้าเกณฑ์ |
| --- | --- | --- |
| D-SM-02 | จำนวนผู้พักพิงไม่เกินที่ศูนย์รองรับได้ | จำนวนผู้พักพิงเกินที่ศูนย์รองรับได้ |
| D-REG-03 | ได้รับความช่วยเหลือครบทุกคนแล้ว | ยังมีผู้ที่ไม่ได้รับความช่วยเหลือ |
| D-TRG-01 | คัดกรองครบทุกคนแล้ว | ยังคัดกรองไม่ครบ |
| D-TRG-05 | บันทึกข้อมูลครบทุกคนแล้ว | ยังบันทึกข้อมูลไม่ครบ |
| D-TRG-08 | ติดตามครบตามกำหนดแล้ว | ยังมีรายการที่ไม่ได้ติดตาม |
| D-KS-06 | อุปกรณ์ที่พร้อมใช้มีเพียงพอ | อุปกรณ์ที่พร้อมใช้ไม่เพียงพอ |
| D-KS-10 | ยอดอาหารคงเหลือตรงกับจำนวนที่ควรเหลือ | ยอดอาหารคงเหลือไม่ตรงกับจำนวนที่ควรเหลือ |
| D-VC-01 | จำนวนอาสาสมัครตรงตามตารางกะ | จำนวนอาสาสมัครไม่ตรงตามตารางกะ |
| D-VC-02 | จำนวนอาสาสมัครเพียงพอ | จำนวนอาสาสมัครไม่เพียงพอ |
| D-VC-03 | มอบหมายงานตรงทักษะครบแล้ว | ยังมอบหมายงานตรงทักษะไม่ครบ |
| D-VC-04 | ชี้แจงครบทุกคนแล้ว | ยังชี้แจงไม่ครบ |
| D-VC-05 | มีคำสั่งงานและผู้ควบคุมครบทุกคน | ยังมีผู้ที่ไม่มีคำสั่งงานหรือผู้ควบคุม |
| D-FAC-01 | พื้นที่นอนพักเพียงพอตามเกณฑ์ | พื้นที่นอนพักไม่เพียงพอ |
| D-FAC-02 | ห้องน้ำหญิงเพียงพอตามเกณฑ์ | ห้องน้ำหญิงไม่เพียงพอ |
| D-FAC-03 | ห้องน้ำชายเพียงพอตามเกณฑ์ | ห้องน้ำชายไม่เพียงพอ |
| D-FAC-06 | จุดอาบน้ำเพียงพอตามเกณฑ์ | จุดอาบน้ำไม่เพียงพอ |
| D-FAC-07 | จุดซักล้างเพียงพอตามเกณฑ์ | จุดซักล้างไม่เพียงพอ |
| D-FAC-08 | มีน้ำสะอาดเพียงพอตามแผน | น้ำสะอาดไม่เพียงพอตามแผน |
| D-FAC-10 | จุดจ่ายน้ำเพียงพอตามเกณฑ์ | จุดจ่ายน้ำไม่เพียงพอ |

## Decision log

- 2026-09-26 — เสนอแบบประเมินแยกตาม 9 Role (`proposed`)
- 2026-10-02 — kong อนุมัติ Question Bank 79 ข้อและถ้อยคำ D-SM-03 ตามบันทึกการทบทวน
- 2026-10-04 — ขยาย contract: ล็อก field/audit rules, เพิ่ม `warehouse_staff` สำหรับ SC, แยก UI `Not started` จาก persisted status, ระบุแหล่ง SOP ratio และสูตร/หน่วยตัวเลข, ปิดขอบเขต Legacy, conflict และ pagination; เสนอให้ D-SC-01 ตรวจยอด ledger เทียบของจริงรายสินค้าโดยไม่เก็บ metric รวมข้ามหน่วย
- 2026-10-05 — ระบุทางเดิน D-SC-01 ผ่านรายการยอดอ่านอย่างเดียวจาก stock-status endpoint ที่มีอยู่ เพื่อให้ warehouse_staff และ supply_coordinator ตรวจได้โดยไม่เปิดสิทธิ์แก้สต็อกเพิ่ม; กำหนดการเทียบตามหน่วย ledger และความละเอียด qty_str ใน CR-038
- 2026-10-05 — kong อนุมัติข้อเสนอ รันเลขเป็น CR-153 (status: approved)
- 2026-10-20 — ปรับถ้อยคำของคำถาม 19 ข้อให้อ่านเข้าใจง่ายและตรงเจตนาของข้อ (D-SM-04, D-SM-09, D-SM-10, D-TRG-02, D-TRG-05, D-TRG-06, D-MED-03, D-MED-06, D-MED-09, D-MED-10, D-KS-04, D-KS-07, D-SC-04, D-SC-06, D-SC-07, D-VC-05, D-VC-08, D-SO-10, D-FAC-12); ไม่เปลี่ยน id, จำนวน 79 ข้อ, placeholder, `metric_spec` และ `schema_v`; ถ้อยคำ D-SM-03 คงเดิม
- 2026-10-24 — kong อนุมัติ: จำกัดการแสดงผลใน UI ให้เห็นเฉพาะ Role ที่ผู้ใช้ประเมินได้ (SM/SA เห็นครบ 9; SC รวม `warehouse_staff`) แทนการเห็นครบ 9 Role ทุกคน; เพิ่ม acceptance matrix, History contract และเงื่อนไขเมื่อเสียสิทธิ์ใน Acceptance criteria. เป็น UI-only: การอ่านเอกสารใน CouchDB ยังเป็น shelter-wide; หากต้องห้ามดึงผลของ Role อื่นจริงต้องยกเป็น scope change แยก. ไม่เปลี่ยน data contract, schema, กฎเขียน VDU, Question Bank, id, `schema_v` (ไม่มี migration); ติดตามด้วย CR-153 + Decision log (ไม่เปิด CR ใหม่)
- 2026-10-25 — kong อนุมัติ: Pass และ Fail ไม่บังคับ notes; Pending ยังบังคับ notes ที่ trim แล้วไม่ว่าง (รวมข้อที่ขาด SOP Parameter). ปรับถ้อยคำคำถามทั้ง 79 ข้อและชื่อช่องตัวเลข 19 ข้อในภาคผนวก A ให้อ่านเข้าใจง่ายโดยคงความหมาย; เพิ่มภาคผนวก B (ข้อความหน้าจอ ข้อความผลตรวจสอบจากตัวเลข และค่าที่ควรเหลือของ D-KS-10 ไม่ persist); UI ไม่แสดงรหัสคำถามกับสูตรเกณฑ์. ไม่เปลี่ยน id, จำนวนข้อ, placeholder, field keys, หน่วย, step, threshold, `question_set_version` และ `schema_v`; snapshot เดิมไม่ถูกแก้ย้อนหลัง. ต้อง redeploy `_design/access` ก่อนเปิด UI ใหม่ เพราะ VDU ตรวจถ้อยคำ canonical ชุดใหม่และผ่อนกฎ notes ของ Fail. เพิ่ม acceptance ของปุ่มบันทึก ปุ่มรายการยอดสต็อก และข้อความหน้าจอ
