---
id: CR-100
title: ทักษะจิตอาสาใน job board อ้างอิง master data ด้วย code + gate ทักษะควบคุมจาก master จริง
status: proposed        # proposed | approved | done | rejected | superseded
date: 2026-09-02
requested_by: เจ้าของโครงการ (คำขอในเซสชัน 2026-09-02)
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/schema.md §2.8 (`volunteer.skills` — คงเป็น label, ระบุให้ชัด)
  - docs/data/schema.md §2.17 (`job.skills_required` — เปลี่ยนความหมายเป็น master code)
  - docs/data/schema.md §2.18 (`job_application.applicant.skills` — เปลี่ยนความหมายเป็น master code)
  - schema_v — ไม่ bump (รูปร่างฟิลด์ยังเป็น `[str]` เดิม, อ่านได้ทั้งสองแบบ)
  - frontend/src/lib/features/volunteers/{domain,application,ui}
  - frontend/src/lib/features/volunteer-portal/ui
  - worker/src/worker/projectors/master_data.py (ใหม่) + worker/couch/processor.py + backend/apiapp/modules/volunteers
---

# CR-100 — ทักษะจิตอาสาใน job board อ้างอิง master data ด้วย code

## Why

ทักษะใน job board ดึงจาก Master Data `volunteer_skills` แบบ **effective** (global ของ SA
merge กับรายการของศูนย์ + รายการที่ศูนย์ปิด) อยู่แล้ว แต่เก็บ **ข้อความ label** ลงเอกสารเป็นค่าจริง
(`job-form-dialog.svelte` ใช้ `key: item.label`) ทำให้เกิดปัญหา 2 ข้อ:

1. **แก้ label ที่ master data แล้ว job เดิมกำพร้า** — ค่าที่ persist ไว้ไม่ตรงกับรายการอีกต่อไป
   จึงหลุดทั้งการแสดงผลและตัวกรอง ต่างจาก pattern ของ `vulnerable_group` ที่เก็บ **code**
   แล้ว resolve label ตอนแสดง (`evacuee-tab.svelte` × `admission_policy.supported_vulnerable_groups`)
2. **`category: controlled` ที่ตั้งใน master data ไม่มีผลจริง** — `initialStatusForSkills()`
   ถูกเรียกโดยไม่ส่ง `controlledSkills` จึงตกไปใช้ `DEFAULT_CONTROLLED_SKILLS` ที่ hardcode
   ใน `domain/skills.ts` และฝั่ง public (FastAPI `_needs_review`) ก็ใช้ค่า default เพราะ
   `volunteer_controlled_skills` ไม่ได้ถูก project ลง Mongo เลย → ทักษะควบคุมที่เพิ่มใหม่
   ที่ master data สามารถ auto-accept ผ่านได้ ซึ่งขัด CR-094 FR-VOL-10.3

## Change

| ฟิลด์ | Before | After |
| --- | --- | --- |
| `job.skills_required[]` | label เช่น `"การแพทย์ / ปฐมพยาบาล"` | master **code** เช่น `"medical"` |
| `job_application.applicant.skills[]` | label (ฟอร์ม public ติ๊กจากค่าใน `skills_required`) | master **code** |
| `volunteer.skills[]` | label | **ไม่เปลี่ยน** — ยังเป็น label (walk-in + portal profile เขียนแบบเดิม) |
| ทักษะควบคุม (staff) | `DEFAULT_CONTROLLED_SKILLS` hardcode | จาก master data (`category: controlled`) โดยส่งเข้า `initialStatusForSkills()` |
| ทักษะควบคุม (public/FastAPI) | `DEFAULT_CONTROLLED_SKILLS` | จาก `public_config` doc ที่ worker project จาก master data |

**Compat layer (บังคับ):** ค่าในเอกสารอาจเป็น code (ใหม่) หรือ label (เก่า) — ตัว resolve กลางตัวเดียว
(`domain/skill-catalog.ts`) หา option จาก code ก่อน แล้วค่อย fallback หา label
(trim/lowercase/NFC) การแสดงผลใช้ `option.label ?? ค่าดิบ`, การจับคู่ทักษะและ gate ควบคุม
เทียบด้วยชุดที่รวม **ทั้ง code และ label** ของ item นั้น ๆ ดังนั้นเอกสารเก่าไม่พังและไม่ต้องหยุดระบบ migrate

## Impact

**Frontend — staff (`features/volunteers`)**
- `domain/skill-catalog.ts` (ใหม่, pure + tests): `skillOptionsFromMaster()`, `resolveSkillOption()`,
  `resolveSkillLabel()`, `toSkillCode()`, `controlledSkillValues()`, `skillMatches()`
- `application/queries.ts`: `useSkillOptions()` (ห่อ `useMasterData('volunteer_skills')` +
  fallback `SKILL_MASTER`), `useCreateJobApplication` รับ/ส่ง `controlledSkills`
- `ui/job-form-dialog.svelte`: ติ๊กเก็บ `code`; เปิดแก้ไข job เก่าที่เก็บ label จะถูก normalize
  เป็น code ให้ (บันทึกครั้งถัดไป = ย้ายค่าเงียบ ๆ)
- `ui/job-card.svelte`, `ui/job-detail-overview-tab.svelte`: แสดง label จาก resolver
  (เลิกใช้ `findSkill()` ที่อ่านจาก `skill-master.ts` hardcode)
- `domain/assign-roster.ts`: รับ `skillOptions` เพิ่ม (optional) เพื่อเทียบ job code ↔ volunteer label

**Frontend — public (`features/volunteer-portal`)**
- `ui/job-card.svelte`, `ui/quick-apply-modal.svelte`, `ui/job-board.svelte` (ช่องค้นหา):
  แสดง label จาก `/api/public/v1/config/volunteer-skills` แต่ส่ง **code** กลับเป็น `applicant.skills`

**Worker + backend (public plane)**
- `worker/projectors/master_data.py` (ใหม่) + routing ใน `worker/couch/processor.py`:
  project `master_data:volunteer_skills` → `public_config` doc `config:volunteer_skills`
  (ของศูนย์ = `config:volunteer_skills:{SHELTER}`) เฉพาะ `controlled_codes` +
  `controlled_labels` — allow-list เหมือน `config:app`; ลบ master doc แล้ว config ที่ project
  ไว้ถูกลบตาม
- `backend/.../volunteers/use_case.py#controlled_skills(shelter_code)`: union ของ doc global +
  doc ของศูนย์ ก่อน แล้ว fallback `config:app.volunteer_controlled_skills` →
  `DEFAULT_CONTROLLED_SKILLS`; `apply()` ส่ง `job.shelter_code` เข้าไป

**Seeds**: `frontend/scripts/seed.ts` — job/dashboard job ทุกตัวใส่ `skills_required` เป็น
`masterCodes(master, 'volunteer_skills', …)` และ `volunteer.skills` ใช้ `masterLabels(…)`
(`seedVolunteers`/`seedVolunteerJobs` รับ `MasterLookup` เพิ่ม)

**Tests ที่เพิ่ม/รัน**: `skill-catalog.test.ts` (20), `skill-label.test.ts` (7),
`worker/tests/projectors/test_master_data_projector.py` (8),
`backend/tests/test_volunteers.py` +4 (code gate / label gate / master ทับ default floor /
รายการของศูนย์)

## Migration

**ไม่ bump `schema_v`** — รูปร่างฟิลด์ยังเป็น `[str]` เดิม เปลี่ยนแค่ "ความหมายของค่า" และ
reader ใหม่อ่านได้ทั้ง code/label (ดู Compat layer) จึงไม่มี migration ที่ต้องรันแบบ blocking

- `job` เดิมที่เก็บ label: แสดงผล/จับคู่ได้ปกติผ่าน resolver และจะถูกเขียนเป็น code
  เมื่อมีการแก้ไข job นั้นครั้งถัดไป
- `job_application` เดิม: อ่านอย่างเดียว ไม่แตะ
- `volunteer.skills`: ตั้งใจไม่เปลี่ยน — ถ้าภายหลังต้องการให้เป็น code ด้วย ให้เปิด CR ใหม่
  (กระทบ portal profile + walk-in + ตัวกรองหลังบ้าน)
- ทักษะควบคุมฝั่ง public จะเริ่มมีผลจริงหลัง worker project `config:volunteer_skills` ครบ 1 รอบ
  (ก่อนหน้านั้นยังใช้ default floor เดิม — fail-safe คือ "ต้องรีวิว" ไม่ใช่ auto-accept)

## Decision log

- 2026-09-02 — เจ้าของโครงการเลือกแนวทาง "ใช้ code + gate จาก master จริง" และให้ track ด้วยไฟล์ CR
  ในโฟลเดอร์นี้ (ทางเลือกที่ไม่เอา: เพิ่มฟิลด์ `supported_volunteer_skills` บนเอกสาร shelter,
  และแบบแตะแค่ UI ไม่แตะค่าที่ persist)
- 2026-09-02 — proposed (renumbered จาก CR-099 — เลข CR-099 ถูกใช้แล้วโดย
  `CR-099-master-data-volunteer-skills.md` ใน `_index.md`)
