---
id: CR-099
title: Public family search — คืนสถานะจริงตาม backoffice (เลิก 3 bucket) + ค้นชื่อไทยแบบขึ้นต้นได้ (renumbered from CR-080)
status: done
date: 2026-08-22
updated: 2026-09-01
requested_by: เจ้าของโครงการ (พบจากการทดลองใช้หน้า /search)
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/task-breakdown/11-famsearch.md FS-2 (field list — สถานะความปลอดภัย)
  - docs/features/public-tier-find-spec.html, docs/features/public-tier-flow-spec.html
  - docs/changes/CR-005-public-portal-landing-public-metrics.md (ตาราง field ของ family search)
  - backend/apiapp/modules/evacuee/use_case.py + backend/tests/test_evacuee.py
  - packages/tent-model/src/tent_model/public_person.py (index เพิ่ม ไม่ใช่ field)
  - frontend/src/lib/features/public-portal/domain/stay-status.ts (ใหม่) + ui/stay-status-chip.svelte (ใหม่)
  - frontend/src/routes/(public)/search/+page.svelte
  - ไม่ bump schema_v (ไม่มี doc shape เปลี่ยน)
---

# CR-099 — Public family search: สถานะจริง + ค้นชื่อไทยแบบขึ้นต้น

## Why

**1. สถานะที่แสดงผิดความจริง.** FS-2 / CR-005 กำหนดให้ public search คืนสถานะเป็น 3 bucket
(`in_shelter` / `moved` / `checked_out`) โดย FastAPI พับ `current_stay.status` ทั้ง 7 ค่าลงมา —
`IN_SHELTER_STATUSES = {pre_registered, active, temporary_leave}`.

พอ public booking (CR-070 / T-71) เปิดใช้ คนที่ **จองผ่านเว็บแล้วยังไม่มาถึงศูนย์** จะเป็น
`pre_registered` ตลอด และหน้า /search แสดงว่า **"ปลอดภัย (อยู่ในศูนย์แล้ว)"** ทั้งที่ไม่มีใคร
เห็นตัวคนนั้นเลย — ตอบคำถามเดียวที่หน้านี้มีอยู่เพื่อตอบ ("ญาติถึงศูนย์แล้วหรือยัง") ผิด.
ตรวจกับ Mongo dev จริง: `public_persons` 4 รายการเป็น `pre_registered` ทั้งหมด แต่ API คืน
`in_shelter` ทุกตัว.

ผลข้างเคียงอีกข้อ: `temporary_leave` (เช็คอินแล้วแต่ออกไปข้างนอก) ก็ถูกแสดงเป็นอยู่ในศูนย์
เหมือนกัน และ `deceased` ถูกพับรวมกับ `checked_out` — เจ้าหน้าที่กับญาติจึงเห็นสถานะไม่ตรงกัน

**2. ค้นชื่อไทยบางส่วนไม่เจอ.** name search ใช้ MongoDB text index
(`{"$text": {"$search": …}}`) ซึ่ง match เป็น "คำเต็ม" และไม่รองรับภาษาไทย (index สร้างด้วย
`default_language: english`). ภาษาไทยไม่มีช่องว่างระหว่างคำ → `"สักก์ธนัชญ์"` เป็น token เดียว
แยกไม่ได้. วัดจริงบน Mongo dev: `$text: "สัก"` = **0 hit**, `$text: "สักก์ธนัชญ์"` = 3 hit
ทั้งที่ regex `^สัก` = 3 hit. ญาติต้องพิมพ์ชื่อให้ตรงทุกตัวอักษรจึงจะเจอ

## Change

### สถานะ

| | Before | After |
| --- | --- | --- |
| ค่าที่ API คืน | `in_shelter` / `moved` / `checked_out` | ค่าจริงทั้ง 7: `pre_registered`, `active`, `temporary_leave`, `transferred`, `checked_out`, `deceased`, `cancelled` |
| ค่าที่ไม่รู้จัก | พับเป็น `checked_out` (เดา) | `unknown` (ไม่เดา) |
| Label บน UI สาธารณะ | คำที่แต่งขึ้นเอง เช่น "ปลอดภัย (อยู่ในศูนย์แล้ว)" | คำเดียวกับ backoffice verbatim: "ลงทะเบียนล่วงหน้า", "เข้าพักแล้ว", "ออกชั่วคราว", "ย้ายไปแล้ว", "ย้ายออก/กลับภูมิลำเนา", "เสียชีวิต", "ยกเลิกการลงทะเบียนล่วงหน้า" |
| `isInShelterStatus()` | `status === 'in_shelter'` | `status === 'active'` เท่านั้น (`temporary_leave` = false — เช็คอินแล้วแต่ไม่อยู่ที่ศูนย์) |

- ใช้กับทั้งตัวคนที่ค้นและ `family_members[]`
- ยังคง masking เดิมทุกอย่าง (นามสกุล, เลขบัตร, ที่อยู่) และยัง**ไม่**คืน field ใหม่ใดๆ —
  เปลี่ยนแค่ *ค่า* ของ `status` ที่มีอยู่แล้ว ไม่ใช่รูปร่าง response (type ยังเป็น `str`
  → `openapi.d.ts` ไม่เปลี่ยน ไม่ต้อง `pnpm openapi:update`)

### ค้นชื่อ

- ลำดับใหม่: text index ก่อน → ถ้า 0 ผลลัพธ์ จึง fallback เป็น regex **anchored** `^<query>`
  บน `first_name` และ `last_name_masked`
- anchored (ไม่ใช่ substring) โดยเจตนา: "จำได้ว่าชื่อขึ้นต้นแบบนี้" คือสิ่งที่ญาติต้องการ
  ส่วน substring จะทำให้ endpoint กลายเป็นเครื่องมือไล่ดูคนทั้งระบบ
- guard เดิมยังอยู่ครบ: `parse_search_query` ปฏิเสธ query < 3 ตัวอักษร, per-IP rate limiter,
  `NAME_RESULT_LIMIT = 10`, `search_excluded` ยังถูกตัดออก
- fallback ทำงานเฉพาะกรณี text search ไม่เจอ → query ชื่อเต็มยังใช้ 1 round trip เท่าเดิม
- เพิ่ม btree index `first_name`, `last_name_masked` ใน `PublicPerson.Settings` เพื่อให้
  anchored regex ใช้ index ได้ (เพิ่ม index ไม่ใช่เพิ่ม field)

### ที่ยังไม่ทำใน CR นี้

mockup ที่เจ้าของโครงการส่งมามี field ที่ **ยังไม่มีใน data model เลย** — จึงยกออกทั้งชุด
(ตัดสินใจ 2026-08-22 ว่า "ข้ามไปก่อน"):

| ใน mockup | สถานะจริงในระบบ |
| --- | --- |
| ความสัมพันธ์ (ภรรยา / บุตร / บิดา) | ไม่มี field ความสัมพันธ์ใน `evacuee` หรือ `household` — มีแค่ `emergency_contact.relation` ซึ่งเป็นผู้ติดต่อฉุกเฉิน ไม่ใช่ความสัมพันธ์ในครัวเรือน |
| บทบาท (อาสาสมัคร / ผู้อพยพ / รอตรวจสอบ) | ไม่มี field บทบาทของบุคคล — feature จัดการอาสาสมัครยังเป็น nav stub (`href: null`) |
| tag ทักษะ (ประกอบอาหาร/ครัวสนาม, การแพทย์/ปฐมพยาบาล) | ไม่มี |
| สถานะ "พลัดหลง (อยู่ระหว่างค้นหา)" | ไม่มีใน `stayStatusSchema` (7 ค่า) |

ถ้าจะทำต้องเปิด CR แยก + กระทบ backoffice (ต้องมีที่ให้เจ้าหน้าที่กรอก) + projector + FastAPI

## Impact

**Docs ที่ต้องแก้ตาม CR นี้ (ยังไม่แก้ — รอ approve):**

- `docs/task-breakdown/11-famsearch.md` FS-2 — บรรทัด field list ระบุ `(in_shelter/moved/checked_out)`
- `docs/features/public-tier-find-spec.html` บรรทัดที่อ้าง 3 bucket (2 จุด)
- `docs/features/public-tier-flow-spec.html` บรรทัดที่อ้าง 3 bucket
- `docs/changes/CR-005-*.md` ตาราง field — mark ว่า superseded โดย CR-099 ในส่วนสถานะ

**Code + test ที่แก้แล้ว:**

- `backend/apiapp/modules/evacuee/use_case.py` — `map_public_status` เลิกพับ, เพิ่ม `_find_by_name`
- `backend/tests/test_evacuee.py` — 56 passed (เพิ่ม 3 เคส: `pre_registered` คืนตัวเอง,
  status ที่ไม่รู้จัก → `unknown`, ค้นชื่อไทยแบบขึ้นต้น + ยืนยันว่า fragment กลางคำไม่ match)
- `frontend/.../public-portal/domain/stay-status.ts` + `.test.ts` — label/tone map (ใหม่)
- `frontend/.../public-portal/ui/stay-status-chip.svelte` — chip ที่ใช้ร่วมกันทั้ง 2 ที่ (ใหม่)
- `frontend/.../public-portal/domain/mappers.ts` — ย้าย `isInShelterStatus` ออกไปที่ stay-status.ts
- `frontend/src/routes/(public)/search/+page.svelte` — ใช้ chip, กาง `<details>` ของครอบครัวไว้เป็น default
- `frontend/.../public-portal/ui/family-search-modal.svelte` — เดิมพิมพ์ค่า wire ดิบ
  (`in_shelter`) ด้วยสีเขียว success ตลอด ซึ่งผิดแน่ๆ เมื่อสถานะเป็น `transferred`/`deceased`

**ยืนยันกับ API จริง** (dev, หลัง rebuild `tent-fastapi`): `q=สัก` → 4 ผลลัพธ์ สถานะ
`pre_registered` (ก่อนหน้านี้ 0 ผลลัพธ์ / `in_shelter`), `q=ธนัชญ์` (กลางคำ) → 0 ผลลัพธ์

## Migration

N/A — ไม่มี doc shape เปลี่ยน ไม่ bump `schema_v`. `public_persons.status` เก็บค่าดิบจาก
`current_stay.status` อยู่แล้วตั้งแต่แรก (การพับเกิดที่ชั้น API ไม่ใช่ที่ projection) จึง
**ไม่ต้อง re-project** — เปลี่ยนโค้ด FastAPI แล้วเห็นผลทันที

index ใหม่ 2 ตัวถูกสร้างโดย Beanie ตอน init (ต้อง restart/rebuild FastAPI container 1 ครั้ง)

## Risk / ข้อควรพิจารณา

การเปิดสถานะจริงเพิ่ม information surface ของ endpoint ที่ไม่ต้อง auth:

- `temporary_leave` = บอกคนภายนอกว่า ณ ตอนนี้คนนั้นไม่อยู่ที่ศูนย์
- `deceased` = แจ้งการเสียชีวิตกับผู้ค้นที่ไม่ระบุตัวตน

เจ้าของโครงการเลือก "แสดงสถานะจริงทั้ง 7 ตัว" เมื่อ 2026-08-22 โดยรับทราบข้อนี้.
ทางเลือกที่เสนอไว้และไม่ถูกเลือกคือแยกเฉพาะ `pre_registered` ออกจาก `in_shelter` แล้วคง
`temporary_leave`/`deceased` พับไว้เหมือนเดิม — ถ้าภายหลังเห็นว่าเปิดมากเกินไป กลับมาใช้
ทางเลือกนั้นได้โดยแก้แค่ `PUBLIC_STAY_STATUSES` + label map

## Decision log

- 2026-08-22 — เจ้าของโครงการขอ "แสดงสถานะจริงตาม label ใน backoffice" + ขอรายละเอียดครอบครัว (ร่างเดิมใช้รหัส CR-080)
- 2026-08-22 — แจ้งว่าขัดกับ FS-2/CR-005 และเสนอ 3 ทางเลือก → เลือก "แสดงสถานะจริงทั้ง 7 ตัว"
- 2026-08-22 — field ใน mockup ที่ไม่มีใน data model (ความสัมพันธ์/บทบาท/tag/พลัดหลง) → "ข้ามไปก่อน"
- 2026-08-22 — เลือก track ด้วย CR ไฟล์ใน `docs/changes/` → proposed
- 2026-08-31 — renumbered เป็น CR-099 เพื่อหลีกเลี่ยงการชนกับ CR-080 donor edit reservation via token
