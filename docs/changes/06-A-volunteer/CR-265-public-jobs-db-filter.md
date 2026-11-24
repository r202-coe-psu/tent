---
id: CR-265
title: กระดานงานจิตอาสาสาธารณะ — กรอง/แบ่งหน้าที่ DB, นับผู้สมัครด้วย aggregation (#1464)
status: approved
date: 2026-11-19
updated: 2026-11-24
requested_by: "GitHub #1464 (รองรับผู้ใช้เข้าพร้อมกัน ~10,000 คน)"
decided_by: kong
layer: volatile            # stable | volatile
affects:
  - docs/data/schema.md — ไม่เปลี่ยนรูป doc; schema_v — ไม่เปลี่ยน
  - docs/data/api-contract.md (`GET /public/v1/jobs` — query ใหม่ `q`, `status`, `page`, `page_size`; response ใหม่ `total`, `shelters`) — แก้ตามหลัง merge
  - backend/apiapp/modules/volunteers/{router,schemas,use_case}.py, backend/tests/test_volunteers.py
  - packages/tent-model/src/tent_model/{public_job,public_job_application}.py (index เพิ่ม)
  - frontend/src/lib/api-specs/fastapi.json, frontend/src/lib/api/openapi.d.ts (regen)
  - frontend/src/routes/api/public/v1/volunteer/jobs/+server.ts, jobs.test.ts (BFF)
  - frontend/src/lib/features/volunteers/server/public-board-fallback.ts, public-board-fallback.test.ts
  - frontend/src/lib/features/volunteers/ui/public-job-board.svelte, public-job-board.dom.test.ts
  - frontend/e2e/volunteer-portal.test.ts
---

# CR-265 — กระดานงานจิตอาสาสาธารณะ — กรอง/แบ่งหน้าที่ DB, นับผู้สมัครด้วย aggregation (#1464)

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** `GET /public/v1/jobs` รับ query ใหม่ `q`, `status` (`open` / `near_full` / `controlled`), `page`, `page_size` และคืน `total` + `shelters`; กรองและแบ่งหน้าใน Mongo; นับผู้สมัครด้วย aggregation `$group` แทนการโหลดใบสมัครทุกใบเข้า memory; หน้า `/volunteers/jobs` ส่งตัวกรองทุกครั้งและดึงทีละหน้า
> - **ทำไม:** หน้าเดิมดึงงานทั้งหมดครั้งเดียวแล้วกรองที่ browser และ backend โหลด `PublicJobApplication` ทุกใบเพื่อนับอย่างเดียว — หนักเกินไปเมื่อมีผู้เข้าพร้อมกันระดับหมื่นคน
> - **Dev ต้อง build:** query/response ใหม่ + aggregation + index ใน FastAPI, BFF ส่งต่อ query (whitelist), หน้า job board ส่งตัวกรองและแสดงผลทีละหน้า, regen OpenAPI
> - **กระทบ:** public API (additive — ผู้เรียกเดิมที่ไม่ส่ง query ใหม่ได้ผลเหมือนเดิม), UI `/volunteers/jobs`; ไม่เปลี่ยน schema / `schema_v` / หลังบ้าน; ไม่รวม cache ฝั่ง server (รอเจ้าของโครงการตัดสิน)

---

## 1. Requirements

| ID    | Requirement |
| ----- | ----------- |
| FR-1  | `GET /public/v1/jobs` รับ query ใหม่ (ไม่บังคับ ทั้งหมด AND กัน): `q` (ไม่เกิน 100 ตัวอักษร), `status` (`open` \| `near_full` \| `controlled`), `page` (1–1000, เริ่มต้น 1), `page_size` (1–50); ค่าอื่นของ `status` หรือ `page` นอกช่วง 1–1000 ตอบ 422 (BFF ปฏิเสธ `page > 1000` หรือเกิน safe integer ด้วย 400 `invalid_page`) |
| FR-2  | `q` ค้นข้อความไม่สนตัวพิมพ์ ตัดช่องว่างหัวท้าย อักขระ regex ถือเป็นข้อความธรรมดา ตรงเมื่อพบในชื่องาน, ชื่อหรือรหัสศูนย์ของงานนั้น, หรือค่าทักษะที่งานต้องการ |
| FR-3  | `status=open` = งานที่มีที่ว่างเหลือ (กะใดกะหนึ่ง `slots_remaining > 0`; งานที่ไม่มีกะใช้ค่าระดับงาน); `status=near_full` = มีกะที่เหลือ 1–2 ที่; `status=controlled` = `tier = staff-capable` หรือต้องการทักษะที่เป็น controlled (ชุดเดียวกับ `controlled_skills()`) |
| FR-4  | `skill` รับซ้ำได้ (`skill=A&skill=B`) และตรงเมื่องานต้องการค่าใดค่าหนึ่ง — หน้าเว็บส่งทั้งรหัสและป้ายของทักษะที่เลือก เพื่อให้ตรงทั้ง "รหัสหรือป้าย" เหมือน `skillsMatch` เดิม; ส่งค่าเดียวได้ผลเหมือนเดิม |
| FR-5  | แบ่งหน้าฝั่ง server: เรียงงานที่ยังมีกะเปิดรับอยู่ก่อนงานที่กะจบหมดแล้วข้ามทุกหน้า (CR-215 FR-4) โดยภายในแต่ละกลุ่มเรียงตาม `shelter_code`, `title`, `_id` · backend ดึง lightweight projection ของงานที่ตรงเงื่อนไขมาจัดลำดับเปิด/ปิดและตัดหน้า แล้วจึงโหลดเอกสารเต็มเฉพาะหน้านั้น (`page` ค่าเริ่มต้น 1, เกินหน้าสุดท้ายคืนรายการว่าง); ถ้าไม่ส่ง `page_size` คืนทุกรายการที่ตรงตัวกรองเหมือนเดิม |
| FR-6  | response เพิ่ม `total` (จำนวนงานที่ตรงตัวกรองทั้งหมด ไม่ใช่เฉพาะหน้า) และ `shelters` (`[{code, name}]` ของศูนย์ที่มีงานบนกระดาน ไม่ตามตัวกรอง เพื่อให้ตัวเลือกศูนย์ไม่หดตามหน้า) |
| FR-7  | นับ `applicants_count` (ระดับงานและระดับกะ; ไม่นับ `cancelled`) ด้วย aggregation `$group` ใน Mongo เฉพาะงานในหน้าที่ตอบ ไม่โหลดตัวเอกสารใบสมัคร; ค่าที่ได้ต้องเท่าเดิมทุกกรณี (กะอ่านจาก `shift_id` หรือ `selected_shift.shift_id`) |
| FR-8  | เพิ่ม index: `public_jobs.skills_required`, `public_jobs(shelter_code, title)`, `public_job_applications(job_id, status)`; ตรวจ index เดิม (`shelter_code`, `status`, `job_id`) แล้ว ไม่ซ้ำ |
| FR-9  | BFF `/api/public/v1/volunteer/jobs` ส่งต่อเฉพาะ `shelter_code` (หรือ `shelter`), `skill` (ทุกค่า), `q`, `status`, `page`, `page_size`; query อื่นไม่ถูกส่งต่อ; ปฏิเสธ `page > 1000` หรือเกิน safe integer ด้วย 400 `invalid_page`; ส่งต่อคำตอบ 4xx จาก FastAPI โดยไม่ตกเข้า fallback; ทางสำรอง CouchDB (เฉพาะเมื่อ FastAPI ล่ม/5xx) กรอง/เรียง/แบ่งหน้าด้วยกติกาเดียวกันและคืน `total` + `shelters` |
| FR-10 | หน้า `/volunteers/jobs` ส่ง ค้นหา/สถานะ/ศูนย์/ทักษะ/หน้า ให้ BFF ทุกครั้งที่เปลี่ยน แสดงเฉพาะหน้าที่ได้รับ (6 ใบ/หน้า) และ `total`; หน่วงการพิมพ์ค้นหา ~300 มิลลิวินาที; เปลี่ยนตัวกรองแล้วกลับหน้า 1; เปลี่ยนหน้าแล้วเลื่อนไปที่รายการ; คงสถานะว่าง/กำลังโหลดเดิม; ไม่กรองหรือแบ่งหน้าซ้ำที่ browser |

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

## 3. Why

- ที่มา: #1464 — ประเมินจากการอ่านโค้ด (ยังไม่ได้วัดโหลดจริง): หน้าเดิมโหลดงานทั้งกระดานต่อผู้ใช้ 1 คน และ backend โหลดใบสมัครทั้งหมดเพื่อนับ
- ตัดสินใจ (kong): ใช้ CR file ติดตาม; ข้อ aggregation ไม่เปลี่ยนสัญญา แต่รวมไว้ใน CR เดียวกันเพื่อให้ทบทวนพร้อมกัน
- ตัวกรองสถานะใช้ค่า `slots_remaining` ที่ projection เก็บไว้ (snapshot) เพราะต้องกรองที่ DB; ตัวเลขที่แสดงบนการ์ดยังอ่านจาก counter สดเหมือนเดิม จึงอาจคลาดได้เล็กน้อยระหว่างที่เจ้าหน้าที่ยังไม่แก้งาน (ผลคือการ์ดอาจแสดงเต็มแต่ยังผ่านตัวกรอง "เปิดรับ") — การสมัครจริงตรวจโควตาที่ server เสมอ
- `status=open` / `near_full` กรองจาก `slots_remaining` ใน Mongo เพื่อความเรียบง่ายของ query โดยไม่กรองเวลาสิ้นสุดกะในชั้น filter; งานที่กะหมดทุกกะยังแสดงในรายการแบบ "ปิดรับแล้ว" และถูกจัดไว้ท้ายสุดข้ามหน้าตาม CR-215 FR-4 (backend ดึง `shifts.{date,end_date,start_time,end_time}` ของงานที่ตรง filter มาจัดลำดับเปิด/ปิดก่อนตัดหน้า)
- `skill` ตรงแบบเท่ากันทุกตัวอักษร (ใช้ index ได้) โดยหน้าเว็บส่งทั้งรหัสและป้าย แทนการเทียบไม่สนตัวพิมพ์ฝั่ง browser
- **ไม่รวม** cache สั้น ๆ ฝั่ง server (5–10 วินาที): ขัดกับเจตนาเดิมของ `Cache-Control: no-store` (ไม่ให้เห็นงานเต็มแล้ว) ต้องให้เจ้าของโครงการตัดสินก่อน
- **ไม่รวม** endpoint สรุปจำนวนที่ไม่ตามตัวกรอง (ถ้าต้องการ แยก CR/issue)
- ชั้น `volatile`: เปลี่ยนการอ่านสาธารณะเท่านั้น ไม่แตะ auth / sync / schema

## 4. Impact

- **Backend:** `backend/apiapp/modules/volunteers/{router,schemas,use_case}.py` (query/response ใหม่, aggregation, กรอง/แบ่งหน้า); `packages/tent-model/.../public_job.py`, `public_job_application.py` (index; Beanie สร้างตอน init); `backend/tests/test_volunteers.py`
- **OpenAPI:** `frontend/src/lib/api-specs/fastapi.json`, `frontend/src/lib/api/openapi.d.ts` (regen, เพิ่มอย่างเดียว)
- **BFF:** `frontend/src/routes/api/public/v1/volunteer/jobs/+server.ts`, `jobs.test.ts`, `frontend/src/lib/features/volunteers/server/public-board-fallback.ts`, `public-board-fallback.test.ts`
- **Frontend:** `frontend/src/lib/features/volunteers/ui/public-job-board.svelte`, `public-job-board.dom.test.ts`, `frontend/e2e/volunteer-portal.test.ts`
- **Docs:** `docs/changes/_index.md` ลงแถว `CR-265` แล้ว · `docs/data/api-contract.md` แก้ตามหลัง merge
- **ข้อควรระวังตอน deploy:** backend ใหม่ก่อน frontend ใหม่ (หน้าใหม่ต้องการ `total`/`shelters`); index สร้างตอน backend เริ่มทำงาน

## 5. Migration

N/A — ไม่เปลี่ยนรูป doc ที่ persist, ไม่ bump `schema_v` (เพิ่ม index ใน Mongo เท่านั้น)

## 6. Decision log

- 2026-11-19 — proposed (ร่าง CR จาก #1464); เจ้าของโครงการเลือกติดตามด้วย CR file
- 2026-11-24 — approved และรันเลขเป็น CR-265 (ย้ายจาก `draft-public-jobs-db-filter.md` เข้า `06-A-volunteer/`); ปรับ FR-1 (ขอบบน `page <= 1000` / 400 `invalid_page`), FR-5 (เรียงงานเปิดก่อนงานปิดข้ามหน้าตาม CR-215 FR-4), FR-9 (ส่งต่อ 4xx ไม่ fallback) และ §3 ให้ตรงกับโค้ด
- รอตัดสิน: cache สั้น ๆ ฝั่ง server (ไม่รวมในร่างนี้)
