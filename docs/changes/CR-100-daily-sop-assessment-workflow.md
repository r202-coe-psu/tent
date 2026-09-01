---
id: CR-100
title: Daily SOP assessment workflow, incremental saves, and editable snapshots
status: proposed
date: 2026-08-31
updated: 2026-09-01
requested_by: Team-D
decided_by: pending project owner review
layer: volatile
why: ต้องมี workflow ประเมิน Daily SOP ที่บันทึกและแก้ไขผลรายศูนย์/รายวันได้ โดยไม่กระทบ Resource Dashboard
migration: none — feature is proposed and schema_v 1 has not been released
track: docs/changes (ไฟล์ CR)
affects:
  - docs/data/schema.md §2.21 — `daily_sop_assessment` schema_v 1
  - docs/features/daily-sop-assessment-flow.md
  - frontend/src/lib/features/daily-sop/
  - frontend/src/routes/(protected)/back-office/dailysop/
  - frontend/src/routes/(protected)/back-office/+layout.svelte — route-scoped connection status
  - frontend/src/lib/components/backoffice-navbar/static.ts
  - frontend/src/lib/server/shelter-access-design.ts
  - frontend/scripts/seed.ts
  - frontend/e2e/daily-sop.test.ts
---

# CR-100 — Daily SOP assessment workflow

## สถานะและคำขอ

เอกสารนี้เป็น **ข้อเสนอ (`proposed`)** สำหรับ workflow ใหม่ตาม Design ที่ให้มา ยังไม่ใช่การ
อนุมัติให้ขยาย scope ไปยังระบบอื่น และยังไม่ควรเพิ่มรายการนี้ลง Change Record index จนกว่า
เจ้าของโครงการจะเป็นผู้ตัดสินใจเอง

การเปลี่ยนนี้มีผลหลายโซนของระบบ เพราะไม่ได้เป็นเพียงหน้า UI ใหม่ แต่เพิ่ม document type,
validation invariant, seed contract และเส้นทางการอ่านข้อมูลย้อนหลัง อย่างไรก็ตามทุกส่วนถูก
แยกเป็น feature slice และไม่แก้ business logic ของ Resource Dashboard เดิม

## การปฏิบัติตาม Change Management Policy

CR นี้เปิดตาม `docs/change-management.md` §2 เพราะเพิ่ม persisted document type, field,
enum, invariant และ CouchDB write validation ซึ่งไม่ใช่การแก้ copy หรือ format อย่างเดียว

- **ช่องทางติดตาม:** เจ้าของงานเลือกให้ใช้ CR file ระดับเต็ม และให้คงสถานะ `proposed`.
- **Index:** Policy §3 ปกติให้ลง `docs/changes/_index.md`; รอบนี้เจ้าของงานสั่งให้ยังไม่ลง index.
  จึงต้องเพิ่มรายการโดยผู้รับผิดชอบ Change Management ก่อนเปลี่ยน CR เป็น `approved` หรือ `done`.
- **Schema version:** CR ยังเป็น `proposed` และไม่มี schema ที่ release แล้ว จึงกำหนด shape สุดท้าย
  (`answered`, Lifeline `null`, `InProgress`, metadata รายข้อ) เป็น `schema_v: 1` ตั้งแต่ต้น; ไม่ต้อง
  migrate. หากเปลี่ยน persisted shape หลัง approval/release ต้อง bump ตาม Policy §4.
- **Stable-core boundary:** CR นี้ไม่เปลี่ยน common envelope, auth/session, sync topology หรือ `_id`
  pattern; ถ้าต้องแตะส่วนใดส่วนหนึ่งภายหลัง ต้องเปิด review/CR เพิ่มก่อนตาม Policy §1.

## สรุป (TL;DR)

- **เพิ่ม:** `/back-office/dailysop` สำหรับประเมิน Daily SOP ประจำวัน
- **หน้าจอ:** History → Assessment Menu → Section Detail และผลเดิมที่เปิดแก้ไขผ่าน `จัดการ` ได้
- **เนื้อหา:** คำถามจริง 19 ข้อจาก Prototype แบ่ง 6 หมวด (`3/2/4/6/2/2`) และ Lifelines 4 รายการ
- **สถานะคำถาม:** UI `Pass / Fail / Pending` และ storage `Yes / No / Pending`
- **เงื่อนไขปิดงาน:** คำถามทั้ง 19 ข้อและ Lifelines ทั้ง 4 รายการต้องมีการเลือกสถานะครบถ้วน
  โดย `Pass`, `Fail`, `Pending` และ `Operational/Interrupted/Critical` เป็นผลที่บันทึกได้
  ค่า `Pending` เริ่มต้นที่ยังไม่ถูกเลือกเท่านั้นที่ถือว่ายังไม่ครบ
- **ข้อมูลที่ persist:** บันทึกอย่างน้อยหนึ่งคำตอบเป็น `InProgress`; ตอบครบเป็น `Completed` โดยใช้เอกสารรายศูนย์/วันเดียวกัน
- **ความไม่ซ้ำ:** `_id = daily_sop_assessment:{shelter_code}:{YYYY-MM-DD}` ใช้ CouchDB conflict
  ป้องกันการสร้างซ้ำต่อศูนย์ต่อวัน
- **การอ่านย้อนหลัง/แก้ไข:** snapshot เก็บข้อความ คำตอบ ผู้ประเมินและเวลารายข้อ และเปิดแก้ไขได้จาก `จัดการ` โดยคงตัวตนศูนย์/วันเดิม
- **การเชื่อมต่อ:** แสดงสถานะ central CouchDB จริง ไม่มี offline write queue หรือสถานะ sync จำลอง
- **ไม่แตะ:** Resource Dashboard, T-31/T-32 calculation/ratio engine, sync core และ public API

## Why

Design ต้องการให้เจ้าหน้าที่ศูนย์พักพิงตรวจมาตรฐานการปฏิบัติงานประจำวัน และเปิดดูผลที่เคย
ประเมินได้จากหน้าเดียว ปัจจุบันยังไม่มี workflow หรือ document type ที่แยกจากการคำนวณ
ทรัพยากร จึงไม่ควรนำ route หรือข้อมูลของ Resource Dashboard มาใช้แทน Daily SOP

การบันทึกแบบรายศูนย์/รายวันมีเป้าหมายดังนี้:

1. ให้ History แสดงทั้งรายการที่กำลังประเมินและรายการที่เสร็จสิ้น พร้อมเปิดแก้ไขย้อนหลังได้
2. บันทึกความคืบหน้าได้โดยไม่สร้างเอกสารหลายฉบับระหว่างผู้ใช้สลับหมวด
3. อนุญาตแก้ผลเดิมผ่าน protected workflow โดยใช้ `_rev` และ validator ล็อก identity ของรายการ
4. ทำให้ข้อความในผลเดิมคงเดิม แม้ Prototype/definition รุ่นถัดไปเปลี่ยนข้อความ

## Impact zones — พื้นที่ที่ได้รับผลกระทบ

| โซน                               | สิ่งที่เปลี่ยน                                                                                   | ผลกระทบ/ข้อควบคุม                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Navigation และ route**       | เพิ่ม route `/back-office/dailysop` และรายการ Daily SOP ใน back-office navbar                    | ผู้ใช้เข้าหน้าใหม่ได้จาก navbar; Resource Dashboard ยังคง route `/back-office/resource-dashboard` เดิม                                                                                       |
| **2. UI/UX**                      | เพิ่ม History, Menu 7 cards, Section Detail, สี/ผู้ประเมินรายข้อ โหมดแก้ไข และ feedback ผลบันทึก | ใช้ definition เดียวทุก breakpoint; ปุ่ม `จัดการ` เปิด input ของรายการนั้น; success ใช้ Toaster component เดิม ส่วน error ใช้ dialog อธิบายสาเหตุ ไม่เพิ่ม evidence, note หรือ approval flow |
| **3. Domain model**               | เพิ่ม types, stable IDs, 6 sections, 19 questions, 4 lifelines, mapper และ gating logic          | ไม่มีการเปลี่ยน enum หรือสูตรของ feature อื่น; UI และ persistence ใช้ mapper กลางชุดเดียว                                                                                                    |
| **4. Application/data layer**     | เพิ่ม query/mutation สำหรับ list, read, create `InProgress`/`Completed` และ update ผลเดิม          | update ใช้ `_rev` ของเอกสารเดิม; แยก auth/network/policy/conflict error; ไม่มี delete API                                                                                                    |
| **5. Shelter CouchDB schema**     | เพิ่ม `daily_sop_assessment` schema_v 1                                                          | เป็น additive document type; common envelope เดิมยังใช้เหมือนเดิม; ยังไม่มี migration                                                                                                        |
| **6. CouchDB validator/security** | เพิ่ม allowlist, deterministic ID check, shape check และ identity-preservation check             | การเขียนต้องอยู่ใน shelter scope; อนุญาตแก้คำตอบ/สถานะ แต่ห้ามเปลี่ยน ID, ศูนย์, วันประเมิน หรือ metadata การสร้าง                                                                           |
| **7. Seed/operations**            | เพิ่ม seed 3 รายการตาม Design และคำสั่งลบเฉพาะ deterministic seed IDs                            | ห้ามใช้ query ลบ `daily_sop_assessment` ทั้ง type เพราะอาจลบข้อมูลจริงของผู้ใช้                                                                                                              |
| **8. Test/CI**                    | เพิ่ม domain/repository/validator และ E2E workflow tests                                         | E2E แยกจาก Resource Dashboard smoke test เพื่อแยก regression; ต้องทดสอบด้วย seed ที่ตกลงกัน                                                                                                  |
| **9. Connection presentation**    | Daily SOP header อ่าน connected/connecting/disconnected จาก `endpointStore`                      | เปลี่ยนเฉพาะ route นี้; ไม่เพิ่ม local queue, replication หรือเปลี่ยน sync protocol                                                                                                          |
| **10. Documentation/governance**  | เพิ่ม schema, feature flow และ CR นี้                                                            | CR คงสถานะ `proposed`; ไม่เพิ่มรายการใน `_index.md` ตามคำขอของเจ้าของงาน                                                                                                                     |

## สิ่งที่ไม่กระทบ (explicit non-impact)

- ไม่เปลี่ยน component, domain, repository, route หรือ data flow ของ Resource Dashboard
- ไม่เปลี่ยน T-31/T-32, resource ratio, calculation engine, daily calculation หรือ stock ledger
- ไม่เปลี่ยน common envelope, authentication/session core, sync protocol หรือ database topology
- ไม่เพิ่ม public endpoint, external API, scheduler, notification หรือ approval workflow
- ไม่เพิ่ม N/A, Skip, reason, evidence, note, attachment หรือ metric dashboard; `InProgress` เป็นสถานะเอกสาร ไม่ใช่สถานะคำตอบเพิ่ม
- ไม่ลบ assessment ผ่านผู้ใช้; การแก้ไขทำได้ผ่าน `จัดการ` เท่านั้นและต้องคง ID/ศูนย์/วัน/metadata การสร้าง
- การลบ seed เป็น operation เฉพาะของ seed script เท่านั้น และไม่แตะรายการที่ผู้ใช้สร้างเอง

## Functional scope

### 1. History

`/back-office/dailysop` อ่าน `daily_sop_assessment` ของศูนย์ที่เลือกและเรียงจากใหม่ไปเก่า
โดยแสดงวันที่/เวลา ศูนย์ ผู้ประเมิน ความคืบหน้า สถานะ และปุ่ม `จัดการ`
เพื่อเปิดผลเดิมในโหมดแก้ไข ตาม Prototype ที่ไม่มีคอลัมน์ `ผ่าน` แยกต่างหาก
ค่า `pass_percent` ยังเก็บในเอกสารเพื่อ compatibility แต่ไม่แสดงเป็นคอลัมน์ใน History

เมื่อไม่มีข้อมูลให้แสดง empty state ตาม Design ไม่ใช้เงื่อนไขแยก production เพื่อซ่อนข้อมูล

### 2. Assessment Menu

ปุ่ม `เริ่มการประเมิน` จะเปิดเมนู 7 cards:

- หมวด 1 ระบบลงทะเบียนผู้ประสบภัย — 3 ข้อ
- หมวด 2 การดูแลกลุ่มเปราะบาง — 2 ข้อ
- หมวด 3 การบริหารจัดการอาสาสมัคร — 4 ข้อ
- หมวด 4 ระบบสาธารณูปโภคและอาหาร — 6 ข้อ
- หมวด 5 ระบบสื่อสารและแจ้งเตือน — 2 ข้อ
- หมวด 6 การเชื่อมต่อกับ One Data Platform — 2 ข้อ
- สถานะสาธารณูปโภค (Lifelines) — 4 รายการ

ตัวนับคำถามเพิ่มเมื่อผู้ใช้เลือกสถานะแล้ว รวมถึง Pending ที่เลือกอย่างชัดเจน; ตัวนับ Lifeline เพิ่มเมื่อเลือกสถานะแล้ว
ไม่ว่าจะเป็น Operational, Interrupted หรือ Critical

ถ้าวันนี้มีรายการของศูนย์นั้นแล้ว ระบบต้องเปิดผลเดิมในโหมดแก้ไขแทนการสร้างเอกสารใหม่

### 3. Section Detail

คำถามอ่านจาก canonical definition ชุดเดียวและแสดงข้อความ verbatim จาก Prototype
ผู้ใช้เลือกได้เฉพาะ `Pass`, `Fail`, `Pending` ส่วน Lifeline เลือกได้เฉพาะ
`Operational`, `Interrupted`, `Critical`

คำตอบที่ยังไม่กดบันทึกอยู่ใน state ของ assessment flow เท่านั้น สลับ Menu ↔ Section แล้วคำตอบยังอยู่
แต่ refresh หรือออกจาก flow จะล้างเฉพาะส่วนที่ยังไม่บันทึก; หากบันทึกแล้ว ผู้ใช้เปิดรายการรายวันเดิม
จาก History เพื่อแก้ไขต่อได้

### 4. Incremental save และ Snapshot

ผู้ใช้บันทึกได้ทันทีหลังเลือกอย่างน้อยหนึ่งคำตอบหรือ Lifeline เพื่อให้รายการปรากฏใน History โดยไม่ต้อง
ทำครบ 19 ข้อก่อน เอกสารที่ยังตอบไม่ครบเป็น `InProgress`; เมื่อเลือกครบทั้ง 19 control และ 4 Lifeline
ระบบเปลี่ยนเป็น `Completed` อัตโนมัติ ทั้ง `Pass`, `Fail` และ `Pending` เป็นผลที่บันทึกได้ โดย
`answered` แยก Pending ที่ผู้ใช้เลือกออกจากค่าเริ่มต้นที่ยังไม่ตอบ Repository ตรวจว่าอย่างน้อยมี
คำตอบหนึ่งรายการก่อนเขียน เพื่อกันเอกสารว่าง

หลังสร้างสำเร็จ ระบบ merge ผลลง History และกลับหน้า History เพื่อให้รายการใหม่แสดงทันที
จากนั้น refetch จากฐานข้อมูลกลางเพื่อยืนยันผล ปุ่ม `จัดการ` ของแถวใด ๆ
เปิดผลเดิมในโหมดแก้ไขได้ เมื่อบันทึกให้เขียนเอกสารเดิมด้วย `_rev` ล่าสุด โดยไม่สร้างแถวใหม่

### 5. Edit ผลที่ประเมินแล้ว

ปุ่ม `จัดการ` ใช้ได้กับทุกแถว ไม่ว่าคำตอบเดิมจะเป็น Pass, Fail หรือ Pending และไม่ว่า
Lifeline จะเป็น Operational, Interrupted หรือ Critical ผู้ใช้แก้ไขคำถามทั้ง 19 ข้อและ
Lifelines ทั้ง 4 รายการได้ด้วยตัวเลือกเดิมตาม Design แล้วกด `บันทึกการแก้ไข`

การแก้ไขไม่เปิด draft document ใหม่และไม่เปลี่ยน `_id`, `shelter_code`, `assessment_date`,
`assessed_at`, `assessor_name`, `created_at` หรือ `created_by` ระบบอัปเดต `updated_at` และคำนวณ Progress,
เปอร์เซ็นต์ผ่าน และป้ายความเสี่ยงใหม่จากค่าที่เลือก การแก้ไขอาจบันทึกสถานะ Fail/Pending ได้
เพราะเป็นการแก้ผลเดิม ไม่ใช่การสร้าง Completed รอบใหม่

ทุก control เก็บ `checked_by` และ `checked_at` รายข้อ เมื่อผู้ใช้เลือกสถานะใหม่ให้ประทับ username
จาก CouchDB session และเวลาปัจจุบันเฉพาะข้อนั้น ข้อที่ไม่ได้เปลี่ยนต้องรักษา metadata เดิม เอกสาร
development เก่าที่ยังไม่มีสอง field นี้ใช้ `assessor_name`/`assessed_at` เป็น read fallback และจะได้
metadata ครบเมื่อถูกบันทึกแก้ไขผ่าน UI รุ่นนี้

## Data contract

### Document identity and envelope

เอกสารอยู่ใน `shelter_{shelter_code}` และใช้ common envelope ของโครงการ:

```text
_id          = daily_sop_assessment:{shelter_code}:{YYYY-MM-DD}
type         = daily_sop_assessment
schema_v     = 1
shelter_code = รหัสศูนย์เดียวกับฐานข้อมูล
status       = InProgress | Completed
```

`_id` เป็น deterministic ต่อศูนย์และวัน ทำให้การสร้างซ้ำชน `409 Conflict` ที่ CouchDB แทนการ
เขียนทับของเดิม การตรวจ duplicate ก่อนเขียนเป็นเพียง UX optimization ไม่ใช่กลไกความถูกต้อง
หลัก ส่วนการแก้ไขใช้ `_rev` เพื่อให้ CouchDB ปฏิเสธการเขียนทับเมื่อมีคนแก้เอกสารเดียวกันไปก่อนแล้ว

### Status contract

| ความหมาย    | UI        | Storage     | ใช้ใน Snapshot                 |
| ----------- | --------- | ----------- | ------------------------------ |
| ผ่าน        | `Pass`    | `Yes`       | ได้                            |
| ไม่ผ่าน     | `Fail`    | `No`        | ได้                            |
| รอแก้ไข     | `Pending` | `Pending`   | ได้; ใช้ `answered` แยกจากยังไม่ตอบ |
| สถานะเอกสาร | —         | `InProgress` / `Completed` | บันทึกบางส่วน / ตอบครบ |

การเปลี่ยนสถานะใน draft อยู่ในหน่วยความจำจนผู้ใช้กดบันทึก; การบันทึกครั้งแรกสร้างหนึ่งแถวต่อศูนย์/วัน
และครั้งถัดไปแก้เอกสารเดิมด้วย `_rev`

### Snapshot fields

| Field              | ความหมาย                        | กติกา                                                                                       |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------- |
| `assessment_date`  | วันประเมินท้องถิ่น              | `YYYY-MM-DD`, อ้างอิง Asia/Bangkok                                                          |
| `assessed_at`      | เวลาสร้างผลประเมินครั้งแรก      | ISO 8601 และคงเดิมเมื่อแก้ไข                                                                |
| `assessor_name`    | ผู้ประเมิน                      | ต้องมีค่า                                                                                   |
| `progress_percent` | ค่าที่แสดงใน History            | 100% เมื่อเลือกสถานะครบทุก control/Lifeline; seed รองรับค่าตาม Design                       |
| `pass_percent`     | สัดส่วน control ที่ผ่าน         | คำนวณจากจำนวน Pass เทียบกับ control ที่เลือกสถานะแล้ว                                       |
| `risk_label`       | ป้ายความเสี่ยง                  | `ไม่พบความเสี่ยง` เมื่อ Pass และ Operational ทั้งหมด มิฉะนั้น `พบความเสี่ยง`                |
| `controls[]`       | คำถาม คำตอบ และผู้ประเมินรายข้อ | ต้องมี 19 รายการ พร้อม `id`, `section_id`, `question`, `status`, `answered`, `checked_by`, `checked_at` |
| `lifelines`        | สถานะสาธารณูปโภค                | มี electricity/water/gas/telecom ครบ 4 key; ใช้ `null` ได้เมื่อยังไม่ตอบ                   |

ข้อความใน `controls[].question` ต้องถูกเก็บซ้ำใน snapshot เพื่อไม่ให้ประวัติเดิมเปลี่ยนตาม
canonical definition ในอนาคต

## Invariants and validation

1. `controls` ต้องมี canonical ID/section ครบ 19 รายการโดยไม่ซ้ำ, status อยู่ใน `Yes | No | Pending`, มี `answered` และมี `checked_by`/`checked_at`
2. `lifelines` ต้องมี 4 key; ค่าเป็น `null` หรือ `Operational | Interrupted | Critical`
3. เอกสารใช้ `schema_v: 1`; `Completed` ใช้ได้เมื่อครบทุกคำตอบ/Lifeline และ `InProgress` ใช้ได้เฉพาะเมื่อยังไม่ครบ
4. `_id` ต้องตรงกับ `shelter_code` และ `assessment_date` แบบ deterministic
5. เอกสารเดิม update ได้เฉพาะคำตอบ/สถานะและ metadata ผลลัพธ์ โดยต้องส่ง `_rev` ล่าสุดและคง identity/creation metadata เดิม; progress, pass และ risk ต้องคำนวณตรงกับข้อมูลจริง
6. เอกสารใหม่ต้องมี control หรือ Lifeline ที่เลือกแล้วอย่างน้อยหนึ่งรายการ; `Completed` ใช้เมื่อครบทุก control/Lifeline เท่านั้น
7. สร้างซ้ำวันเดิมต้องไม่เพิ่ม History row; UI ต้องเก็บคำตอบท้องถิ่นไว้และให้ผู้ใช้เปิดรายการล่าสุดก่อนตัดสินใจแก้
8. การอ่านข้อมูลต้องกรองตาม shelter scope ไม่อ่านข้ามศูนย์

## Seed and unseed contract

Seed สร้างเฉพาะ deterministic IDs ของ Daily SOP ในฐานข้อมูลของศูนย์ที่มีอยู่ใน registry
(SH001–SH004) โดยแต่ละศูนย์มีชุดตัวอย่าง 3 รายการตาม Design:

- `2026-06-09` เวลา `16:15` และ Progress `85%`
- `2026-06-10` เวลา `15:30` และ Progress `100%`
- `2026-06-11` เวลา `15:00` ผู้ประเมิน `พนักงานประจำศูนย์ หาดใหญ่`, Progress `100%`, ผ่าน `100%`,
  ความเสี่ยง `ไม่พบความเสี่ยง`, สถานะ `Completed`

ชุดวันที่ 9 และ 10 มิถุนายนของแต่ละศูนย์ต้องมีผลผสม `No` และ `Pending` เพื่อยืนยันสี สถานะ และการแก้ไข
ข้อมูลย้อนหลัง ไม่ใช้ข้อมูล Pass ทั้งหมด ส่วนวันที่ 11 มิถุนายนคงค่า all-pass ตาม Design ที่อนุมัติ

คำสั่งลบต้องใช้รายการ IDs ที่ seed รู้จักเท่านั้น (`pnpm seed:delete-daily-sop`) ในแต่ละฐานข้อมูล
ของ SH001–SH004 และต้องไม่ query แล้วลบเอกสารทุกตัวที่มี `type = daily_sop_assessment`
เพื่อรักษาข้อมูลที่ผู้ใช้สร้างเอง

## Security and data boundaries

- Route อยู่ใต้ protected back-office layout และใช้ shelter context เดิมของระบบ
- Validator บังคับ `shelter_code` ให้ตรงกับฐานข้อมูลปลายทาง
- Snapshot ไม่มีข้อมูล evidence/attachment/note เพิ่มเติม และไม่เปิด public read path; การแก้ไขอยู่ใน protected back-office route
- ไม่มี draft document แยกหรือคำตอบชั่วคราวใน localStorage/sessionStorage; การกดบันทึกสร้างหรือแก้เอกสารรายศูนย์/วันเดียว
- ไม่มี offline write queue; เมื่อ CouchDB disconnected ให้คง draft ใน page instance แจ้งสถานะจริง และ retry หลังเชื่อมต่อ
- การเปลี่ยน definition ในอนาคตต้องไม่ mutate ข้อความที่ฝังอยู่ใน snapshot เก่า

## Migration and compatibility

- **Migration:** ไม่มี — feature ยังเป็น `proposed`; schema v1 ใน CR นี้คือ shape สุดท้ายก่อน release
- **Schema version:** write/validator ใช้ `schema_v: 1` เพียงค่าเดียว
- **Read compatibility:** document type อื่นและ Resource Dashboard ไม่ต้องเปลี่ยน reader
- **Write compatibility:** validator เพิ่ม allowlist ใหม่ แต่ไม่เปลี่ยนกติกาของ type เดิม; Daily SOP ใช้ `_rev`
  สำหรับการแก้ไขและบังคับ shape v1 เดียวกันทุกครั้ง
- **Rollback:** ปิด route/navbar และหยุด seed ได้โดยไม่ต้องลบ snapshot จริง; ลบได้เฉพาะ seed IDs
  ผ่านคำสั่งเฉพาะ หากเจ้าของโครงการอนุมัติภายหลัง

## Verification plan

```bash
pnpm lint
pnpm check
pnpm test
pnpm seed
pnpm test:e2e
pnpm build
pnpm seed:delete-daily-sop
```
## Decision log

- 2026-08-31 — เปิด CR-100 เป็น `proposed` เพื่อเสนอ workflow ใหม่ตาม Design
- 2026-09-01 — ยืนยันว่า CR ยังเป็น `proposed` และไม่มี Daily SOP schema ที่ release แล้ว; จึงรวม
  `answered`, Lifeline `null`, `InProgress` และ metadata รายข้อไว้ใน schema_v 1 เดียว ไม่สร้าง migration ก่อนจำเป็น
