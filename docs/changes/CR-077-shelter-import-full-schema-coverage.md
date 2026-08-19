---
id: CR-077
title: Excel import ศูนย์พักพิง — ครอบคลุมทุก field ของ shelterSchema, workbook 5 ชีต, จัดการชื่อซ้ำ, shelter_import_log schema_v 1→2
status: proposed
date: 2026-08-15
requested_by: ทีมพัฒนา (branch `refactor-import-shelter-excel`)
decided_by: <รอเจ้าของโครงการ>
layer: volatile
extends: CR-039
affects:
  - docs/data/schema.md §3.7 `shelter_import_log`
  - schema_v shelter_import_log 1 → 2
  - docs/changes/CR-039-shelter-excel-import.md §2 (column map 19 คอลัมน์ → ชุดใหม่)
  - docs/changes/CR-068-shelter-import-site-kind.md (คอลัมน์ `site_kind` ยังไม่อยู่ในชุดนี้ — ดู Open items)
  - frontend/src/lib/features/shelter-import/ (domain/data/application/ui ทั้งฟีเจอร์)
  - frontend/src/lib/features/shelters/index.ts (export `getShelter`)
  - docs/task-breakdown/00-baseline.md (T-55 / T-68 ที่อ้าง import)
---

# CR-077 — Excel import ศูนย์พักพิง ครอบคลุมทั้ง schema + จัดการชื่อซ้ำ

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เทมเพลต/ตัวนำเข้าศูนย์พักพิงขยายจาก 19 คอลัมน์ชีตเดียว → **workbook 5 ชีต ~70 คอลัมน์**
  ครอบคลุมทุก field ของ `shelterSchema` (รวม `zones[]`) + จัดการแถวที่ **ชื่อซ้ำ** (ข้าม/อัปเดต)
- **เพื่อใคร/ทำไม:** onboarding ศูนย์จำนวนมากโดยไม่ต้องเปิดฟอร์มกรอกทีละ ~70 ช่อง และ re-import ไฟล์เดิม
  ซ้ำได้โดยไม่สร้างศูนย์ซ้ำ
- **dev ต้อง build อะไร:** column contract เดียวที่ template/parser/validator ใช้ร่วมกัน · ชีต `โซน` แบบ N:1 ·
  duplicate detection ตามชื่อ · `shelter_import_log` เก็บผลรายแถวรูปแบบใหม่
- **กระทบ schema/scope ไหน:** `shelter_import_log` **schema_v 1 → 2** (additive) · `shelter` **ไม่เปลี่ยน schema** ·
  permission เดิม (system_admin เท่านั้น) ไม่เปลี่ยน

## Why

CR-039 ออกแบบไว้ตอน `shelterSchema` ยังเล็ก: 19 คอลัมน์ ชีตเดียว สร้างได้อย่างเดียว. หลัง CR-023/Addendum A
(นโยบายสัตว์เลี้ยง/สัมภาระ/ที่จอดรถ), CR-051 (โซน) และ key personnel ฟอร์มศูนย์มีราว 70 ช่อง — ไฟล์ import
เดิมกรอกได้ไม่ถึงหนึ่งในสาม ผู้ใช้จึงต้องนำเข้าแล้วตามแก้ในฟอร์มทุกศูนย์อยู่ดี. อีกปัญหาคือ import ไฟล์เดิมซ้ำ
สร้างศูนย์ชื่อซ้ำโดยไม่มีอะไรกั้น.

## Change

### 1. โครงไฟล์ workbook

| Before (CR-039) | After |
| --- | --- |
| 1 ชีตข้อมูล + README | 5 ชีตข้อมูล + `คำแนะนำ` (README) + `lists` (ซ่อน, backing dropdown) |
| 19 คอลัมน์ | ~70 คอลัมน์ แบ่งตามกลุ่มเดียวกับฟอร์ม: `ข้อมูลศูนย์` · `สิ่งอำนวยความสะดวก` · `สาธารณูปโภคและความเสี่ยง` · `นโยบาย` · `โซน` |
| หนึ่งแถว = หนึ่งศูนย์ | ชีต 1:1 สี่ชีต join กันด้วยเลขศูนย์ + ชีต `โซน` เป็น N:1 (หลายแถวต่อศูนย์) |
| — | หัวคอลัมน์ที่จำเป็นมี `*` สีแดงต่อท้ายในเซลล์หัวเอง (ไม่ใช่คอลัมน์แยก) |
| — | ปุ่ม "Template + ตัวอย่างข้อมูล" เติมศูนย์ตัวอย่าง 1 แห่งพร้อมโซน |

**Join key ต่างชื่อกันตามชีต:** ชีต 1:1 ใช้ `ลำดับที่`; ชีต `โซน` ใช้ **`รหัสศูนย์พักพิง`** (= เลข `ลำดับที่`
ของศูนย์ที่โซนนั้นสังกัด) เพราะหัวคอลัมน์ `ลำดับที่` บนชีตโซนถูกเข้าใจผิดเป็นลำดับของโซน

### 2. Field mapping

Column contract ตัวจริงอยู่ที่ `frontend/src/lib/features/shelter-import/domain/columns.ts` — ไฟล์เดียวที่
template generator, parser และ validator ใช้ร่วมกัน (หัวคอลัมน์ภาษาไทย = key). เอกสารนี้ไม่ทำสำเนารายคอลัมน์
ซ้ำ เพื่อไม่ให้ drift; หลักการ mapping:

| กรณี | วิธี |
| --- | --- |
| enum ของ schema | dropdown เก็บ **label ไทย** → validator resolve เป็น code (คงหลัก CR-039) |
| master_data | เฉพาะ `shelter_type`; `municipality_zone` / `community` / `vulnerable_group` **ไม่อยู่ในไฟล์** |
| array ที่เลือกได้หลายค่า (`communications`, `pet conditions`) | แตกเป็นคอลัมน์ ใช่/ไม่ใช่ ต่อค่า แล้วประกอบกลับ (Excel data validation เลือกได้ค่าเดียวต่อเซลล์) |
| list ที่มีอันดับ (`luggage.rules`, `parking.rules`) | เซลล์เดียว คั่นด้วย `\|` |
| composite (`sub_storage`) | `ชื่อ:ประเภท:ตร.ม.` คั่นแต่ละรายการด้วย `\|` |
| ฟิลด์ที่ฟอร์ม gate ไว้ | validator ใช้ gate เดียวกับฟอร์ม (เช่น `max_per_family` กรอกได้เมื่อ `limitation=limited`) |

### 3. แถวที่ชื่อซ้ำ (ใหม่)

| กรณี | พฤติกรรม |
| --- | --- |
| ชื่อซ้ำกับศูนย์ที่มีอยู่ | แสดงในตาราง preview + ให้เลือกทั้งไฟล์: **ข้าม** (default) หรือ **อัปเดตทับ** |
| ชื่อซ้ำกันเองในไฟล์ | แถวหลังถูก reject เป็น validation error |
| การเทียบชื่อ | normalize: trim + ยุบช่องว่าง + lowercase |

**อัปเดตทับต้องไม่ลบสิ่งที่ไฟล์ไม่มี:** ฟิลด์ที่ workbook ไม่มีคอลัมน์ (`municipality_zone`, `community`,
`admission_policy.supported_vulnerable_groups`) ต้องคงค่าเดิมที่ตั้งไว้ในระบบ — endpoint `PATCH` merge ระดับบนสุด
การส่ง `null`/`[]` ไปจึงเท่ากับลบทิ้ง

### 4. `shelter_import_log` — schema_v 1 → 2 (additive)

| Before (v1) | After (v2) |
| --- | --- |
| `success_count`, `error_count` | + `updated_count`, `skipped_count` |
| `results[].status`: `created`/`validation_error`/`server_error` | + `updated`, `skipped_duplicate` |
| `results[].errors[]`: `{column, message}` | + `sheet?`, `line?` (ชี้ชีต/แถวของชีตโซน) |
| — | `results[].existing_code?` (ศูนย์ที่ถูกอัปเดต/ถูกข้าม) |
| `results[]` ไม่จำกัดจำนวน | เก็บไม่เกิน **200 แถว** และ `message` ยาวไม่เกิน **200 ตัวอักษร** (counters ยังนับครบทุกแถว) |

## Requirements

ID ระดับ CR (`FR-77-x`) — ใช้ตรวจรับงานของ CR นี้

- **FR-77-1** — ไฟล์เทมเพลตต้องมี 5 ชีตข้อมูล + `คำแนะนำ` และครอบคลุมทุก field ของ `shelterSchema`
  ยกเว้นรายการที่ระบุว่าไม่อยู่ในไฟล์ (§2)
- **FR-77-2** — หัวคอลัมน์ที่จำเป็นต้องมี `*` ต่อท้ายในเซลล์หัวเอง และ parser ต้องอ่านไฟล์กลับได้ทั้งแบบมี
  และไม่มี `*`
- **FR-77-3** — ชีต `โซน` ใช้คอลัมน์ join key ชื่อ `รหัสศูนย์พักพิง`; ไฟล์รุ่นก่อนที่ใช้ `ลำดับที่` ต้องยัง import ได้
- **FR-77-4** — แถวโซนที่ join ไม่ตรงศูนย์ใดเลย ต้องแจ้งเป็นคำเตือนพร้อมเลขแถว และไม่ถูกนำเข้า
- **FR-77-5** — รหัสโซนห้ามซ้ำภายในศูนย์เดียวกัน (ซ้ำ = validation error ระบุแถวของชีตโซน)
- **FR-77-6** — ทุกแถวที่ validate ไม่ผ่าน ต้องมีข้อความผิดพลาดอย่างน้อยหนึ่งข้อ ระบุคอลัมน์เสมอ
  (ห้ามมีแถว "ผิดพลาด" ที่ไม่มีเหตุผล)
- **FR-77-7** — ตรวจชื่อซ้ำกับศูนย์ในระบบและซ้ำกันเองในไฟล์ ตามพฤติกรรมใน §3
- **FR-77-8** — เมื่อเลือก "อัปเดตทับ" ระบบต้องคง `municipality_zone`, `community`,
  `admission_policy.supported_vulnerable_groups` ของศูนย์เดิมไว้
- **FR-77-9** — บันทึก `shelter_import_log` v2 ต่อหนึ่ง batch ตาม §4 พร้อม counters ที่นับครบทุกแถว
- **FR-77-10** — สิทธิ์ใช้งานหน้า import คง **system_admin เท่านั้น** (ไม่เปลี่ยนจาก CR-039)

## Acceptance

- ดาวน์โหลดเทมเพลต → กรอก → อัปโหลด → preview แสดงจำนวนศูนย์/โซน/พร้อมนำเข้า/ผิดพลาด/ชื่อซ้ำ ครบ
- นำเข้าไฟล์ที่มีศูนย์ 1 แห่ง + โซน 3 แถว → ได้ศูนย์ 1 แห่งที่มี 3 โซน
- นำเข้าไฟล์เดิมซ้ำโดยเลือก "ข้าม" → ไม่มีศูนย์ใหม่, log นับ `skipped_count`
- นำเข้าไฟล์เดิมซ้ำโดยเลือก "อัปเดตทับ" หลังตั้ง `municipality_zone`/`community`/กลุ่มเปราะบางในระบบ →
  ค่าทั้งสามยังอยู่ครบหลัง import
- กรอกค่าผิดในคอลัมน์ที่ validator ประกอบเอง (เช่น จำนวนที่จอดรถติดลบ) → แถวขึ้นผิดพลาดพร้อมชื่อคอลัมน์
- ไฟล์เทมเพลตรุ่นก่อน (ชีตโซนหัว `ลำดับที่`, `*` เป็นคอลัมน์แยก) ยัง import ได้
- `pnpm lint` / `pnpm check` / `pnpm test` ผ่าน

## Impact

| ที่ | อะไร |
| --- | --- |
| `docs/data/schema.md` §3.7 | schema_v 1 → 2, ฟิลด์/สถานะใหม่, หมายเหตุ cap ของ `results[]` |
| `docs/changes/CR-039` | §2 column map (19 คอลัมน์) ถือว่าถูกแทนที่ด้วย CR นี้ — contract ตัวจริงอยู่ใน `domain/columns.ts` |
| `frontend/.../shelter-import/domain/` | `columns.ts` (contract 5 ชีต), `import-row.ts` (validator + `buildUpdatePayload`), `duplicates.ts` (ใหม่), `import-log.ts` (v2 + cap) |
| `frontend/.../shelter-import/data/` | `template.ts` (exceljs 5 ชีต + `*` + ตัวอย่าง), `sample-row.ts` (ใหม่), `parse.ts` (join หลายชีต + รองรับหัวคอลัมน์รุ่นเก่า) |
| `frontend/.../shelter-import/application/` | `queries.ts` — เส้นทาง update ใช้ `buildUpdatePayload` + อ่านศูนย์เดิมก่อน PATCH |
| `frontend/.../shelter-import/ui/` | preview แสดงชีต/แถวของ error, ตัวเลือกจัดการชื่อซ้ำ, คำเตือนโซนกำพร้า |
| `frontend/.../shelters/index.ts` | export `getShelter` (ใช้ preserve ฟิลด์ตอนอัปเดต) |
| Tests | `columns`/`import-row`/`import-log`/`duplicates`/`sample-row`/`template` (round-trip สร้างไฟล์ → parse กลับ) |

## Migration

- **`shelter_import_log` v1 → v2 = additive**: doc เดิมไม่มี `updated_count` / `skipped_count` —
  Zod ใส่ default `0` ตอนอ่าน จึงไม่ต้องแตะ doc ที่เขียนไปแล้ว **ไม่มี migration script**
- doc เป็น append-only อยู่แล้ว: log เก่าคงค่าเดิม, log ใหม่เขียนเป็น v2
- **ไฟล์เทมเพลตที่ผู้ใช้ดาวน์โหลดไปก่อนหน้านี้**: parser ยังรับได้ (หัวคอลัมน์ `*` แยกคอลัมน์ และชีตโซนหัว
  `ลำดับที่`) — แต่ไฟล์เก่ากรอกได้แค่คอลัมน์ชุดเดิม แนะนำให้ดาวน์โหลดเทมเพลตใหม่
- `shelter` doc **ไม่ bump** — CR นี้ไม่เพิ่ม/ลบ field ของศูนย์

## Open items

> [NEEDS DECISION: D-IMP-DUP] เทียบชื่อซ้ำด้วย "ชื่อศูนย์ normalize" อย่างเดียว — ต้องการให้ไฟล์มีคอลัมน์
> `รหัสศูนย์` เพื่อ update แบบเจาะจงด้วยไหม (ตอนนี้ workbook ไม่มีรหัสศูนย์เลย)

> [NEEDS DECISION: D-IMP-AUDIT] `imported_by` มาจาก session ฝั่ง browser และ log ถูกเขียนตรงเข้า `registry`
> จาก client — ยอมรับระดับนี้ (พึ่ง `_security` ของ registry) หรือให้ย้ายไปเขียนผ่าน server endpoint
> เพื่อ stamp ผู้ใช้ฝั่ง server

> [NEEDS DECISION: D-IMP-LOGCAP] cap ของ `results[]` = 200 แถว และ message 200 ตัวอักษร (ตั้งเท่ากับ
> จำนวนแถวของเทมเพลต) — ยืนยันตัวเลขนี้หรือปรับ

> [NEEDS DECISION: D-IMP-SITEKIND] CR-068 (`site_kind`, approved) ยังไม่ถูก implement — ทั้ง
> `shelterSchema` และเทมเพลตชุดนี้ยังไม่มีคอลัมน์ดังกล่าว ให้ทำต่อใน CR-068 เดิมหรือรวมเข้ารอบนี้

> [NEEDS DECISION: D-IMP-LEGACY] การรองรับหัวคอลัมน์รุ่นเก่าใน parser จะคงไว้ถึงเมื่อไร (มีวันหมดอายุ
> หรือถือเป็นพฤติกรรมถาวร)

## Decision log

- 2026-08-15 — proposed (ร่างจาก branch `refactor-import-shelter-excel`; ยังไม่ approve, ยังมี 5 ข้อรอเคาะ)
