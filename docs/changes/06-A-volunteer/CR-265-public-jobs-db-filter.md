---
id: CR-265
title: กระดานงานจิตอาสาสาธารณะ — กรอง/แบ่งหน้าที่ DB, นับผู้สมัครด้วย aggregation, endpoint สรุปยอด (#1464)
status: approved
date: 2026-11-19
updated: 2026-11-25
requested_by: "GitHub #1464 (รองรับผู้ใช้เข้าพร้อมกัน ~10,000 คน)"
decided_by: kong
decision_date: 2026-11-24
layer: volatile # stable | volatile
affects:
  - docs/data/schema.md — ไม่เปลี่ยนรูป doc; schema_v — ไม่เปลี่ยน
  - docs/data/api-contract.md (`GET /public/v1/jobs` — query ใหม่ `q`, `status`, `page`, `page_size`; response ใหม่ `total`, `shelters`; endpoint ใหม่ `GET /public/v1/jobs/summary`) — แก้ตามหลัง merge
  - backend/apiapp/modules/volunteers/{router,schemas,use_case}.py, backend/tests/test_volunteers.py
  - packages/tent-model/src/tent_model/{public_job,public_job_application}.py (index เพิ่ม)
  - frontend/src/lib/api-specs/fastapi.json, frontend/src/lib/api/openapi.d.ts (regen)
  - frontend/src/routes/api/public/v1/volunteer/jobs/+server.ts, summary/+server.ts, jobs.test.ts (BFF)
  - frontend/src/lib/features/volunteers/server/public-board-fallback.ts, public-board-couch.ts, public-board-item.ts (+ tests)
  - frontend/src/lib/features/volunteers/domain/job.schema.ts (`PUBLIC_JOB_STATUSES` = `open`, `full`)
  - frontend/src/lib/features/volunteers/{data/public-board.api.ts,application/public-board-queries.ts,i18n/jobs.i18n.ts}
  - worker/src/worker/projectors/master_data.py, worker/src/worker/projection_version.py (`PROJECTION_VERSION` 25), worker/tests/projectors/test_master_data_projector.py
  - frontend/src/lib/features/volunteers/ui/public-job-board.svelte, public-job-board.dom.test.ts
  - frontend/e2e/{volunteer-portal,volunteer-flow,volunteer-module,public-home-flow,csp}.test.ts, frontend/e2e/helpers/volunteer-portal.ts (mock `/jobs/summary`)
---

# CR-265 — กระดานงานจิตอาสาสาธารณะ — กรอง/แบ่งหน้าที่ DB, นับผู้สมัครด้วย aggregation, endpoint สรุปยอด (#1464)

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** `GET /public/v1/jobs` รับ query ใหม่ `q` (รวมค้น label ทักษะ), `status` (`open` / `near_full` / `controlled` — `open`/`near_full` ใช้ live counter และตัดกะที่จบแล้ว), `page` (1–1000), `page_size` (1–50) และคืน `total` + `shelters`; เพิ่ม `GET /public/v1/jobs/summary` (+ BFF `summary`) คืนยอดรวมคงที่ไม่ตามตัวกรอง; นับผู้สมัครด้วย aggregation `$group` แทนการโหลดใบสมัครทุกใบ; หน้า `/volunteers/jobs` ส่งตัวกรองทุกครั้งและดึงทีละหน้า
> - **ทำไม:** หน้าเดิมดึงงานทั้งหมดครั้งเดียวแล้วกรองที่ browser และ backend โหลด `PublicJobApplication` ทุกใบเพื่อนับอย่างเดียว — หนักเกินไปเมื่อมีผู้เข้าพร้อมกันระดับหมื่นคน
> - **Dev ต้อง build:** query/response ใหม่ + live-counter/open-shift filter + label lookup + `GET /public/v1/jobs/summary` + aggregation + index ใน FastAPI, BFF whitelist + route `summary` + CouchDB fallback, หน้า job board ส่งตัวกรอง/แสดงทีละหน้า + ยอดรวมจาก `summary`, regen OpenAPI
> - **กระทบ:** public API (additive — ผู้เรียกเดิมที่ไม่ส่ง query ใหม่ได้ผลเหมือนเดิม), UI `/volunteers/jobs`; ไม่เปลี่ยน schema / `schema_v`; worker ส่ง `skills` เพิ่มใน `config:volunteer_skills` (additive, `PROJECTION_VERSION` 25 — ต้อง rescan หลัง deploy); คง `Cache-Control: no-store` (ไม่เปิด cache สั้นฝั่ง server)

---

## 1. Requirements

| ID    | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1  | `GET /public/v1/jobs` รับ query ใหม่ (ไม่บังคับ ทั้งหมด AND กัน): `q` (ไม่เกิน 100 ตัวอักษร), `status` (`open` \| `near_full` \| `controlled`), `page` (1–1000, เริ่มต้น 1), `page_size` (1–50); ค่าอื่นของ `status` หรือ `page` นอกช่วง 1–1000 ตอบ 422 (BFF ปฏิเสธ `page > 1000` หรือเกิน safe integer ด้วย 400 `invalid_page`)                                                                                                                                                                                                                  |
| FR-2  | `q` ค้นข้อความไม่สนตัวพิมพ์ ตัดช่องว่างหัวท้าย อักขระ regex ถือเป็นข้อความธรรมดา ตรงเมื่อพบในชื่องาน, ชื่อหรือรหัสศูนย์ของงานนั้น, ค่าทักษะที่งานต้องการ (`skills_required`), หรือ **ชื่อแสดงผล (`label_th` / `label_en`)** ของทักษะใน Master Data `volunteer_skills` (resolve เป็น `code` ของทักษะที่ตรงแล้วนำมาเข้า `$or`)                                                                                                                                                                                                                      |
| FR-3  | `status=open` = งานที่มีกะซึ่ง**ยังเปิดรับตามเวลา (CR-215 FR-1)** และมีที่ว่างเหลือ `> 0` โดยอ่านจาก **live counter** (`VolunteerJobSlot` / `VolunteerJobShiftSlot`, fallback ค่าจาก `PublicJob` เมื่อไม่มีแถว live; งานที่ไม่มีกะใช้ค่าระดับงาน); `status=near_full` = งานที่มีกะซึ่งยังเปิดรับตาม CR-215 FR-1 และเหลือ 1–2 ที่จาก live counter; `status=controlled` = `tier = staff-capable` หรือต้องการทักษะที่เป็น controlled (ชุดเดียวกับ `controlled_skills()`)                                                                             |
| FR-4  | `skill` รับซ้ำได้ (`skill=A&skill=B`) และตรงเมื่องานต้องการค่าใดค่าหนึ่ง — หน้าเว็บส่งทั้งรหัสและป้ายของทักษะ (`code`, `label_th`, `label_en`) เพื่อให้ตรงทั้ง "รหัสหรือป้าย" เหมือน `skillsMatch` เดิม; ส่งค่าเดียวได้ผลเหมือนเดิม                                                                                                                                                                                                                                                                                                               |
| FR-5  | แบ่งหน้าฝั่ง server: เรียงงานที่ยังมีกะเปิดรับอยู่ก่อนงานที่กะจบหมดแล้วข้ามทุกหน้า (CR-215 FR-4) โดยภายในแต่ละกลุ่มเรียงตาม `shelter_code`, `title`, `_id` · backend ดึง lightweight projection ของงานที่ตรงเงื่อนไขมาตรวจเงื่อนไข live/เวลา (เมื่อจำเป็น), จัดลำดับเปิด/ปิดและตัดหน้า แล้วจึงโหลดเอกสารเต็มเฉพาะหน้านั้น (`page` ค่าเริ่มต้น 1, เกินหน้าสุดท้ายคืนรายการว่าง); ถ้าไม่ส่ง `page_size` คืนทุกรายการที่ตรงตัวกรองเหมือนเดิม                                                                                                         |
| FR-6  | response เพิ่ม `total` (จำนวนงานที่ตรงตัวกรองทั้งหมด ไม่ใช่เฉพาะหน้า) และ `shelters` (`[{code, name}]` ของศูนย์ที่มีงานบนกระดาน ไม่ตามตัวกรอง เพื่อให้ตัวเลือกศูนย์ไม่หดตามหน้า)                                                                                                                                                                                                                                                                                                                                                                  |
| FR-7  | นับ `applicants_count` (ระดับงานและระดับกะ; ไม่นับ `cancelled`) ด้วย aggregation `$group` ใน Mongo เฉพาะงานในหน้าที่ตอบ ไม่โหลดตัวเอกสารใบสมัคร; ค่าที่ได้ต้องเท่าเดิมทุกกรณี (กะอ่านจาก `shift_id` หรือ `selected_shift.shift_id`)                                                                                                                                                                                                                                                                                                               |
| FR-8  | เพิ่ม index: `public_jobs.skills_required`, `public_jobs(shelter_code, title)`, `public_job_applications(job_id, status)`; เลิกประกาศ index เดี่ยว `public_jobs.shelter_code` และ `public_job_applications.job_id` ในโมเดล เพราะ compound ที่เพิ่มใหม่ครอบคลุมเป็น prefix อยู่แล้ว (`status` คงไว้)                                                                                                                                                                                                                                               |
| FR-9  | BFF `/api/public/v1/volunteer/jobs` ส่งต่อเฉพาะ `shelter_code` (หรือ `shelter`), `skill` (ทุกค่า), `q`, `status`, `page`, `page_size`; query อื่นไม่ถูกส่งต่อ; ปฏิเสธ `page > 1000` หรือเกิน safe integer ด้วย 400 `invalid_page`; ส่งต่อคำตอบ 4xx จาก FastAPI โดยไม่ตกเข้า fallback; ทางสำรอง CouchDB (เฉพาะเมื่อ FastAPI ล่ม/5xx) กรอง/เรียง/แบ่งหน้าด้วยกติกาเดียวกันและคืน `total` + `shelters` · และเพิ่ม BFF `GET /api/public/v1/volunteer/jobs/summary` ส่งต่อ `GET /public/v1/jobs/summary` พร้อมทางสำรอง CouchDB ด้วยกติกาเดียวกับ FR-11 |
| FR-10 | หน้า `/volunteers/jobs` ส่ง ค้นหา/สถานะ/ศูนย์/ทักษะ/หน้า ให้ BFF ทุกครั้งที่เปลี่ยน แสดงเฉพาะหน้าที่ได้รับ (6 ใบ/หน้า) และ `total`; หน่วงการพิมพ์ค้นหา ~300 มิลลิวินาที; เปลี่ยนตัวกรองแล้วกลับหน้า 1; เปลี่ยนหน้าแล้วเลื่อนไปที่รายการ; คงสถานะว่าง/กำลังโหลดเดิม; ไม่กรองหรือแบ่งหน้าซ้ำที่ browser; และดึงยอดรวมคงที่จาก `/api/public/v1/volunteer/jobs/summary` เพื่อแสดงบนปุ่มตัวกรองโดยไม่เปลี่ยนตามตัวกรองหรือหน้า                                                                                                                         |
| FR-11 | endpoint ใหม่ `GET /public/v1/jobs/summary` (Bearer `EXTERNAL_API_SECRET`, ประกาศก่อน `/jobs/{job_id}/...`, `Cache-Control: no-store`) คืน `{ success, total, open, near_full, controlled, as_of }` ของงานบนกระดานทั้งหมดโดย**ไม่ตามตัวกรอง**ของรายการ และนับ `open` / `near_full` / `controlled` ด้วยกติกาเดียวกับ FR-3 (live counter + กะที่ยังเปิดรับตาม CR-215 FR-1)                                                                                                                                                                          |

## 2. Acceptance

- **AC-1** ไม่ส่ง query ใหม่ → รายการและลำดับเหมือนเดิม (ทดสอบเดิมผ่านโดยไม่แก้) และมี `total` เท่าจำนวนรายการ
- **AC-2** งาน 5 งาน `page_size=2&page=3` → 1 รายการ, `total=5`; `page=9` → รายการว่าง, `total=5`
- **AC-3** `q` ตรงกับชื่องาน / ชื่อศูนย์ / ทักษะ ได้ผลตามต้น; `q=.*` ไม่ตรงทุกงาน
- **AC-4** `status=open` ตัดงานเต็มออก; `status=near_full` เหลือเฉพาะงานที่มีกะเหลือ 1–2 ที่; `status=controlled` ตรงทั้งงาน `staff-capable` และงานที่ต้องการทักษะ controlled; `status=bogus` → 422
- **AC-5** `skill=<รหัส>&skill=<ป้าย>` ตรงงานที่เก็บไว้เป็นรหัสหรือป้ายอย่างใดอย่างหนึ่ง
- **AC-6** `applicants_count` ของงานและกะเท่าเดิม ไม่นับใบที่ยกเลิก และการเรียกใช้ aggregation ไม่โหลดเอกสาร `PublicJobApplication`
- **AC-7** `shelters` ครบทุกศูนย์ที่มีงานบนกระดานแม้กรองด้วย `shelter_code`
- **AC-8** BFF ไม่ส่งต่อ query ที่ไม่อยู่ใน whitelist และส่งต่อ `skill` ซ้ำได้ทุกค่า
- **AC-9** job board: พิมพ์ค้นหาเร็ว ๆ ส่ง request ครั้งเดียวหลังหยุดพิมพ์; กดตัวกรองส่ง request พร้อมพารามิเตอร์ และกลับหน้า 1; กดหน้า 2 ขอ `page=2&page_size=6`; ผลว่าง → สถานะ "ไม่พบงาน"
- **AC-10** (D1=B) งานที่ `public_jobs.slots_remaining > 0` แต่ live counter (`VolunteerJobSlot` / `VolunteerJobShiftSlot`) เหลือ 0 แล้ว **ไม่** ปรากฏใต้ `status=open` / `near_full`
- **AC-11** (D2=A) งานที่ทุกกะสิ้นสุดเวลาแล้ว (CR-215 FR-1) แม้ยังมีโควตาเหลือ **ไม่** ปรากฏใต้ `status=open` / `near_full`
- **AC-12** (D3=B) `q=ทำอาหาร` ค้นเจองานที่เก็บ `skills_required: ["cooking"]` ผ่าน Master Data `volunteer_skills` (`label_th` / `label_en`)
- **AC-13** (D4+D6) `GET /public/v1/jobs/summary` ไม่มี Bearer → 401; คืน `total`, `open`, `near_full`, `controlled`, `as_of` ด้วยกติกาเดียวกับ FR-3 และไม่เปลี่ยนเมื่อหน้ากระดานกรอง/เปลี่ยนหน้า

## 3. Why

- ที่มา: #1464 — ประเมินจากการอ่านโค้ด (ยังไม่ได้วัดโหลดจริง): หน้าเดิมโหลดงานทั้งกระดานต่อผู้ใช้ 1 คน และ backend โหลดใบสมัครทั้งหมดเพื่อนับ
- ตัดสินใจ (kong): ใช้ CR file ติดตาม; ข้อ aggregation ไม่เปลี่ยนสัญญา แต่รวมไว้ใน CR เดียวกันเพื่อให้ทบทวนพร้อมกัน
- ตัดสินใจ 2026-11-24 (เจ้าของโครงการ):
  - **D1 = B:** ใช้ **live counter** (`VolunteerJobSlot` / `VolunteerJobShiftSlot`) ในการกรอง `open` / `near_full` เพื่อไม่ให้งานที่เต็มแล้วโผล่ใต้ "เปิดรับ" ระหว่าง worker projection lag
  - **D2 = A:** ตัดกะ/งานที่สิ้นสุดเวลาแล้ว (CR-215 FR-1) ออกจาก `open` / `near_full` ให้ตรงกับพฤติกรรมเดิมและไม่ทำให้ผู้ใช้สับสนว่าเห็นป้าย "ปิดรับแล้ว" ใต้ตัวกรองเปิดรับ (หลังแก้ B1 backend โหลดเวลาของกะมาคำนวณ `_job_has_open_shift` อยู่แล้ว)
  - **D3 = B:** ให้ `q` ค้นหา `label_th` / `label_en` ของทักษะจาก Master Data `volunteer_skills` ได้ด้วย (resolve เป็น `code` ที่ตรงแล้วเข้า `$or`) เพื่อคง UX เดิมหลัง CR-100 เก็บเป็น code
  - **D4 + D6:** เพิ่ม endpoint `GET /public/v1/jobs/summary` (+ BFF `summary`) แบบเดียวกับ `CR-261` (`/public/v1/shelters/summary`) เพื่อให้นับข้อมูลรวมทั้งหมดและแยกตามสถานะโดยไม่เปลี่ยนตามตัวกรอง/หน้า
  - **D5 = A:** คง `Cache-Control: no-store` ยังไม่เปิด cache สั้น ๆ ฝั่ง server เพื่อไม่ให้แสดงงานที่เต็มแล้ว
- `skill` ตรงแบบเท่ากันทุกตัวอักษร (ใช้ index ได้) โดยหน้าเว็บส่งทั้งรหัสและป้าย (`code`, `label_th`, `label_en`) แทนการเทียบไม่สนตัวพิมพ์ฝั่ง browser
- ชั้น `volatile`: เปลี่ยนการอ่านสาธารณะเท่านั้น ไม่แตะ auth / sync / schema

## 4. Impact

- **Backend:** `backend/apiapp/modules/volunteers/{router,schemas,use_case}.py` (query/response ใหม่, live-counter & open-shift filter, label lookup, `GET /public/v1/jobs/summary`, aggregation, กรอง/แบ่งหน้า); `packages/tent-model/.../public_job.py`, `public_job_application.py` (index; Beanie สร้างตอน init); `backend/tests/test_volunteers.py`
- **OpenAPI:** `frontend/src/lib/api-specs/fastapi.json`, `frontend/src/lib/api/openapi.d.ts` (regen, เพิ่มอย่างเดียว)
- **BFF:** `frontend/src/routes/api/public/v1/volunteer/jobs/+server.ts`, `summary/+server.ts`, `jobs.test.ts`, `frontend/src/lib/features/volunteers/server/public-board-fallback.ts`, `public-board-fallback.test.ts`
- **Worker:** `worker/src/worker/projectors/master_data.py` ส่ง `skills` (code + ชื่อแสดงผลของทักษะที่ active ทุกตัว) ไปที่ `config:volunteer_skills` เพื่อให้ `q` ค้น label ทักษะได้ (D3); bump `PROJECTION_VERSION` เป็น **25**
- **Frontend:** `frontend/src/lib/features/volunteers/ui/public-job-board.svelte` (ย้าย fetch ไป `data/public-board.api.ts` + `application/public-board-queries.ts`), `public-job-board.dom.test.ts`, e2e `volunteer-portal` / `volunteer-flow` / `volunteer-module` / `public-home-flow` / `csp` (mock `/jobs/summary`)
- **Fallback (CouchDB):** `public-board-couch.ts` แสดงเฉพาะสถานะที่ worker ขึ้นกระดาน (`open`, `full` และ `almost_full` ที่เลิกใช้แล้วซึ่ง worker อ่านเป็น `open`) และ `public-board-item.ts` ตอบเฉพาะฟิลด์ของการ์ด (`PublicJobItem`) ไม่ส่ง CouchDB doc ทั้งก้อนให้ผู้ไม่ล็อกอิน
- **Docs:** `docs/changes/_index.md` ลงแถว `CR-265` แล้ว · `docs/data/api-contract.md` แก้ตามหลัง merge
- **ข้อควรระวังตอน deploy:** หลัง deploy ต้อง **rescan worker** ให้ `PROJECTION_VERSION` 25 re-project `config:volunteer_skills` — ถ้าไม่ rescan ช่องค้น `q` จะหา label ทักษะไม่เจอและคืน 0 งานโดยไม่มี error; backend ใหม่ก่อน frontend ใหม่ (หน้าใหม่ต้องการ `total`/`shelters` และ `/jobs/summary`); index สร้างตอน backend เริ่มทำงาน

## 5. Migration

ไม่เปลี่ยนรูป doc ที่ persist ใน CouchDB, ไม่ bump `schema_v` — เพิ่ม index ใน Mongo และเพิ่มฟิลด์ `skills` ใน projection `config:volunteer_skills` (additive) จึง **ต้อง rescan worker** หลัง deploy (`PROJECTION_VERSION` 25)

Beanie ไม่ drop index เดิมให้ — index เดี่ยว `shelter_code_1` (`public_jobs`) และ `job_id_1` (`public_job_applications`) ที่มีอยู่แล้วบน DB ยังค้างอยู่และไม่เป็นอันตราย (แค่เปลือง write) จะ drop ด้วยมือเมื่อสะดวกก็ได้: `db.public_jobs.dropIndex("shelter_code_1")`, `db.public_job_applications.dropIndex("job_id_1")`

## 6. Decision log

- 2026-11-19 — proposed (ร่าง CR จาก #1464); เจ้าของโครงการเลือกติดตามด้วย CR file
- 2026-11-24 — approved และรันเลขเป็น CR-265 (ย้ายจาก `draft-public-jobs-db-filter.md` เข้า `06-A-volunteer/`); ปรับ FR-1 (ขอบบน `page <= 1000` / 400 `invalid_page`), FR-5 (เรียงงานเปิดก่อนงานปิดข้ามหน้าตาม CR-215 FR-4), FR-9 (ส่งต่อ 4xx ไม่ fallback) และ §3 ให้ตรงกับโค้ด
- 2026-11-24 — เจ้าของโครงการเคาะคำตัดสิน D1–D6: D1=B (กรอง `open`/`near_full` ด้วย live counter), D2=A (ตัดกะที่จบเวลาแล้วออกใน `open`/`near_full`), D3=B (`q` ค้น label ทักษะผ่าน Master Data), D4+D6 (เพิ่ม `GET /public/v1/jobs/summary` + BFF `/api/public/v1/volunteer/jobs/summary` นับยอดรวมคงที่), D5=A (คง `no-store` ยังไม่ cache ฝั่ง server)
- 2026-11-25 — แก้ FR-8 ตามรีวิว S3: ตัด index เดี่ยวที่ซ้ำ prefix ออกจากโมเดล และเพิ่มบันทึกการ drop index เดิม
- 2026-11-25 — แก้ตามรีวิวรอบ 3 (W-1/W-2/W-3): เพิ่ม worker (`skills` + `PROJECTION_VERSION` 25 + ขั้น rescan) และไฟล์ fallback/e2e ที่ขาดใน `affects`/Impact/Migration/deploy; fallback ใช้ allow-list สถานะและตอบเฉพาะฟิลด์ของการ์ด; `PROJECTION_VERSION` เลื่อนจาก 24 เป็น 25 เพราะ 24 ถูกใช้บน develop แล้ว
- 2026-11-25 — เจ้าของโครงการเคาะนิยามสถานะที่ขึ้นกระดานสาธารณะเป็น `{open, full}` (ตรงกับ worker และ FastAPI) แทนกฎ `open`-only ของ CR-094 FR-VOL-13.2 ที่ล้าสมัย: แก้ `PUBLIC_JOB_STATUSES` ใน `domain/job.schema.ts` ให้ตรง; งานที่เต็มยังขึ้นกระดานพร้อมป้าย "เต็ม"
