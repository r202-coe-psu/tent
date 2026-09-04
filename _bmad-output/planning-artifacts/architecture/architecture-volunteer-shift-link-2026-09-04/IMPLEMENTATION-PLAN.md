# Implementation Plan — Volunteer Shift Identity

Status: **รออนุมัติ — ยังไม่เริ่มแก้โค้ด**

## Outcome ที่ต้องได้

หน้า `/back-office/volunteers/jobs/:id` ต้องนับและแสดงอาสาของกะจาก `job_id + shift_id` จริง ไม่เทียบเวลา, ไม่รวมกะอื่นที่เวลาเหมือนกัน, ไม่รวมสถานะประวัติในเลข “อาสาในกะนี้” และทุก write/API/worker path ต้องรักษา ID เดียวกันตลอดสาย

## CR-104 reconciliation ที่ต้องทำก่อน coding

CR-104 เป็น approved SSOT แต่ schema ในเอกสารเป็น target shape ที่ runtime ยังไม่ตรง จึงต้องออก amendment/CR ใหม่ก่อนเปลี่ยน code โดยห้ามแก้เลข schema เดิมแบบเงียบ ๆ:

- `job` ใน CR-104 ระบุ `shifts[].shift_id` และ counters รายกะ แต่ runtime ใช้ `shifts[].id` และมี `slots_dispatched` จาก flow เดิม; amendment ต้องกำหนด canonical `job` v4 และลบ yellow/dispatch ออกจาก canonical model ตาม AC-104-01/02.
- `shift_assignment` ใน CR-104 ระบุว่ามี `shift_id` อยู่แล้วใน v3 แต่ runtime v3 ไม่มี field นี้และยังมี `standby/dispatch_status`; amendment ต้องกำหนด migration เป็น v4 โดยให้ v3 เป็น legacy compatibility เท่านั้น.
- `job_application.shift_ids[]` ใน CR-104 ไม่ตรงกับ UX “สมัครกะนี้” และ runtime `selected_shift`; แผนนี้เลือก singular `shift_id` + snapshot ใน v3 เพื่อให้ approval สร้าง assignment ได้แน่นอน หากต้องคง array ต้องเปลี่ยน scope เป็นหลาย assignment/partial approval.
- Flow ใน CR-104 ที่วาด `BFF → CouchDB` ต้องเปลี่ยนเป็น `BFF → FastAPI → Mongo buffer → worker → CouchDB` ตาม two-plane architecture; assignment/application writes ต้อง idempotent.
- CR-104 ระบุ split กะข้าม midnight แต่ runtime มี `end_date`; amendment ต้องบังคับ `date == end_date` และสร้างสอง rows หรือประกาศยอมรับ cross-midnight เป็น exception ให้ชัด.
- การตรวจว่า `shift_id` มีอยู่ใน `job` ทำใน application/repository/worker เพราะ CouchDB `validate_doc_update` ไม่สามารถ query parent document ได้; Couch validation ทำได้เฉพาะ shape/tenant/role.

## Contract ที่เสนอให้อนุมัติ

| เรื่อง | ข้อเสนอ |
| --- | --- |
| ชื่อ field | ใช้ `shift_id` ทุก layer ตาม CR-104/schema docs; ไม่สร้างชื่อที่สาม `job_shift_id` |
| Parent key | เปลี่ยน `job.shifts[].id` → `job.shifts[].shift_id` ใน job schema v4 |
| Assignment | `shift_assignment` v3→v4 เพิ่ม required `shift_id` |
| Application | `job_application` v2→v3 เพิ่ม singular `shift_id`; เก็บ `selected_shift` เป็น snapshot |
| Reverse reference | ไม่เพิ่ม `assignment_ids[]` ใน job; query ด้วย `(job_id, shift_id)` |
| เลขใน modal | distinct volunteer ที่ status เป็น `assigned`, `standby`, `checked_in` |
| ประวัติ | `completed`, `no_show`, `cancelled` แสดงใน history แต่ไม่นับ current roster |
| Quota | counter ต่อ sub-shift เป็น authoritative; job total เป็นผลรวม |

## ลำดับ implementation

### Phase 1 — Change record และ compatibility schemas

1. สร้าง CR ใหม่เพื่อ amend ช่องว่าง/ความขัดแย้งระหว่าง CR-102, CR-104 และ runtime.
2. เพิ่ม job v4, shift-assignment v4 และ job-application v3 schemas พร้อม explicit v3/v2 compatibility parsers.
3. เพิ่ม invariant: `shift_id` immutable, unique ใน job, และ counter รายกะรวมเท่ากับ counter ระดับ job.
4. เพิ่ม index/query contract สำหรับ `(job_id, shift_id)`, `(job_id, shift_id, volunteer_id)`, และสถานะ active.

ไฟล์หลัก: `job.schema.ts`, `shift-assignment.schema.ts`, `job-application.schema.ts`, `volunteer.repository.ts`, CouchDB design/provisioning files และ schema docs.

### Phase 2 — Seed และ compatibility data

1. ไม่เพิ่ม production migration CLI หรือ batch backfill ในรอบนี้.
2. คง compatibility reader สำหรับข้อมูลเก่าที่ไม่มี `shift_id` โดยใช้ duty window เฉพาะ fallback.
3. อัปเดต seeds ให้สร้างข้อมูลที่มี identity ของกะล่าสุดเท่านั้น.

### Phase 3 — Back-office write path และ roster UI

1. เปลี่ยน assign/dispatch input ให้รับ `shift_id`; repository โหลด job และ derive snapshot/window เอง.
2. ใช้ CAS บน job doc เพื่อ reserve/release/accept/decline counter ของกะและยอดรวมใน mutation เดียว พร้อม compensation เมื่อ assignment write ล้มเหลว.
3. เพิ่ม duplicate/idempotency guard สำหรับ active `(job_id, shift_id, volunteer_id)`.
4. เปลี่ยน `shiftRoster`, `assignRoster`, capacity และ shift cards/modal ให้ join ด้วย ID เท่านั้น.
5. แยก current roster ออกจาก history และป้องกัน hard-delete กะที่ถูกอ้างอิงแล้ว.

ไฟล์หลัก: `shift-assignment.remote.ts`, `job.remote.ts`, `queries.ts`, `shift-roster.ts`, `assign-roster.ts`, `capacity.ts`, `job-assign-page.svelte`, `job-shifts-tab.svelte`, `job-shift-card.svelte`, `job-shift-roster-dialog.svelte`.

### Phase 4 — Public API และ worker pipeline

1. Project `job.shifts[]` พร้อม `shift_id` และ per-shift availability เข้า `public_jobs`.
2. เปลี่ยน public apply request จาก date-only เป็น required `shift_id`; FastAPI validate ว่า ID อยู่ใน job, เปิดรับ และมีที่ว่าง.
3. เพิ่ม atomic Mongo counter ต่อ `(job_id, shift_id)`; reserve/release แบบ idempotent และทดสอบ concurrent last-slot requests.
4. Propagate ID ผ่าน application buffer, Couch application inbound, application projector, assignment projector, ticket และ schedule models/responses.
5. เมื่อ auto-confirm หรือ manager approve ให้ create/link assignment ของ shift เดียวกันแบบ idempotent.
6. แก้ BFF ปัจจุบัน `/jobs/[id]/apply`; สำหรับ legacy `/volunteer/apply` ให้ migrate ให้ contract เดียวกัน แล้ว mark deprecated (ลบภายหลังเมื่อยืนยันว่าไม่มี consumer).
7. Regenerate `fastapi.json` และ `openapi.d.ts` จาก backend schema.

ไฟล์หลัก: `packages/tent-model/src/tent_model/*volunteer*`, `backend/apiapp/modules/volunteers/{schemas,use_case,router}.py`, `worker/src/worker/{projectors,inbound}/`, public-portal domain/data/UI และ SvelteKit BFF routes.

### Phase 5 — Contract cleanup และ documentation

1. อัปเดต `docs/data/schema.md`, data model/ER diagram, API contract และ CR index ให้ตรง runtime.
2. เปลี่ยน comments ที่ยังระบุว่าไม่มี shift ID; คง fallback สำหรับ legacy records เพราะไม่มี migration gate ในรอบนี้.
3. ตรวจว่า schema design docs/index provisioning ถูกติดตั้งทั้ง shelter ใหม่และ shelter เดิม.

## Test matrix / Quality gates

| Layer | Tests บังคับ |
| --- | --- |
| Domain | schema migration ทุก version, immutable/unique ID, per-shift sum invariants, active-status semantics |
| Frontend repository | exact shift write, duplicate assign, full shift, 409 retry, compensation, release/accept/decline |
| Roster/capacity | กะเวลาเดียวกันคนละ IDไม่ปน, duplicate volunteer นับครั้งเดียว, completed ไม่เพิ่ม current count |
| Worker | job/application/assignment projector contract และ buffer→Couch ID preservation |
| Backend | list jobs exposes shifts, invalid/closed/full shift errors, cancellation release, approval creates assignment |
| Concurrency | สอง request แย่งที่นั่งสุดท้าย: สำเร็จหนึ่ง, อีกหนึ่ง `SHIFT_FULL`; retry ไม่จองซ้ำ |
| BFF/OpenAPI | proxy payload/response ตรง generated types ทั้ง current และ legacy route |
| E2E | assign 2 คนแล้ว modal = 2; กะเวลาเดียวกันไม่ปน; checkout แล้ว current count ลดแต่ history ยังอยู่; public apply ถึง schedule ด้วย ID เดิม |

คำสั่ง gate จะใช้ scripts ที่มีใน repo หลังตรวจ package scripts จริง: frontend unit + check + lint, backend pytest, worker pytest/integration และ Playwright volunteer flow. ทุก suite ต้องผ่านก่อน handoff; หาก suite unrelated fail จะรายงานแยกพร้อมหลักฐาน baseline.

## Rollout / rollback

1. Deploy expand readers/models/indexes.
2. Refresh local/dev data ด้วย seed ที่อัปเดตแล้ว.
3. Enable strict writers และ ID-first joins พร้อม legacy fallback.
4. Monitor duplicate guard errors, per-shift counter drift และ `SHIFT_FULL` rate.
5. Rollback app ได้เฉพาะกลับสู่ compatibility reader; ห้ามย้อน schema/data ด้วย destructive rewrite.

## Acceptance criteria

- Assignment/application ใหม่ทุกใบอ้าง `(job_id, shift_id)` ที่มีอยู่จริง.
- คนเดิมมีกะเดียวกันได้สูงสุดหนึ่ง active assignment แม้ request ซ้ำ/พร้อมกัน.
- ไม่มี sub-shift เกิน quota ภายใต้ concurrent assign/apply.
- Modal ของกะหนึ่งไม่เห็นข้อมูลอีกกะแม้วันเวลาเหมือนกัน และ current count ตรงนิยามที่อนุมัติ.
- Confirmed application มี assignment/link ของ shift เดียวกัน; ticket/schedule คืน ID เดิม.
- Compatibility readers ไม่ทำให้ legacy docs หายเงียบ; production migration/backfill เป็นงานรอบถัดไป.
- Runtime schemas, Couch indexes, Mongo models, OpenAPI, docs และ seeds ตรงกัน.
- Frontend, backend, worker และ E2E gates ผ่านทั้งหมด.

## Agent execution หลังอนุมัติ

- Luna coder A: frontend schemas/repositories/roster/capacity/UI และ frontend tests.
- Luna coder B: Python models/FastAPI/worker/public pipeline และ Python tests.
- Main agent: docs/index/OpenAPI integration, conflict resolution และ full-suite verification.
- Luna high auditor: review architecture invariants, migrations/concurrency, diff และ test evidence; blocking findings ต้องแก้ก่อนส่งมอบ.

ขอบเขตนี้ตั้งใจแก้ root cause ครบทั้ง identity, quota, duplicate และ pipeline ไม่ใช่เพียงเปลี่ยนเลขใน modal.
