---
id: draft
title: จิตอาสาหลายศูนย์ — แสดงผลยืนยันตัวตนและทักษะจากศูนย์อื่น (เบอร์และเลขบัตรตรงกัน) ให้เจ้าหน้าที่กดรับ (D-MULTI ทาง D แบบ "แสดงและกดรับ")
status: proposed
date: 2026-11-02
updated: 2026-11-04
requested_by: "#886 (@Mhapong) — คำตอบทาง D ของ @net-lynx (2026-10-26), คอมเมนต์ #886 2026-10-28 และ 2026-11-02 (เลือก \"แสดงผลและกดรับ\" ไม่รับอัตโนมัติ), และคำตอบของผู้ขอ (@mhapong) ต่อ review ของ @Jackyzaz บน PR #1118 รอบที่ 1 (2026-11-03) และรอบที่ 2 (2026-11-04)"
decided_by: "เสนอโดย @mhapong (ผู้ขอ) · รอผู้ตัดสิน @Jackyzaz approve (ต้องผ่าน review ก่อน approve เพราะ layer: stable)"
layer: stable
amends: CR-041 (D-MULTI = A → D)
affects:
  - docs/changes/06-A-volunteer/CR-041-module-a-volunteer-job-board.md (อัปเดตเมื่อ approve: decision log + ข้อ 11 ตาราง decision D-MULTI A → D · บรรทัด 78 (FR-42 "โปรไฟล์กลาง"), 90 (ข้อ 7 "โปรไฟล์อาสา **กลาง** — สมัครงานหลายศูนย์จากโปรไฟล์เดียว"), 100 (แถว `volunteer:{ulid}` "โปรไฟล์กลาง (D-MULTI=A)"), 115 (T-28 "โปรไฟล์กลาง"), 154 ("`volunteer` โปรไฟล์กลาง: migration/วางที่เก็บ") และบรรทัด 179 (decision log เดิม) ใส่หมายเหตุ "แทนที่โดย CR นี้")
  - docs/task-breakdown/06-A-volunteer-epics-stories.md (อัปเดตเมื่อ approve: บรรทัด 57 (MA-08), 92, 121, 148-149, 232-234, 250, 446 (Story 3.10), 454, 570-572, 590, 595 (`D-MULTI=A`), 606 ที่ยังเขียน "โปรไฟล์กลาง" / D-MULTI=A — ปรับเป็น "โปรไฟล์ต่อศูนย์ + ใช้ผลยืนยันจากศูนย์อื่นแบบกดรับ")
  - docs/features/volunteer-job-board-flow.md (อัปเดตเมื่อ approve: บรรทัด 673 ตาราง decision D-MULTI ที่ยังเสนอ "A) โปรไฟล์กลาง")
  - docs/prd/phase-r3-operations.md (อัปเดตเมื่อ approve: FR-42 §162 — เพิ่มข้อความเรื่องโปรไฟล์ต่อศูนย์ + ผลยืนยันข้ามศูนย์แบบกดรับ; ตรวจด้วย grep แล้ว FR-42 ใน PRD ไม่ได้เขียนคำว่า "โปรไฟล์กลาง" ตรง ๆ แต่ CR-041 FR-42 ที่ PRD อ้างอิงเขียนไว้)
  - docs/prd/role-permission-matrix.md (อัปเดตเมื่อ approve: §3 Action Matrix เพิ่มแถว "Volunteer Verification (ผลจากศูนย์อื่น)" — ดู Change § role-permission-matrix)
  - docs/changes/06-A-volunteer/CR-213-coordinator-limited-access-grant.md (อัปเดตเมื่อ approve: บรรทัด 188 "เข้มกว่าทาง D ของ #886 ที่ใช้ phone_hash อย่างเดียว" — #886 ใช้ phone_hash + national_id_hash แล้ว)
  - docs/data/api-contract.md §2.6 (endpoint ใหม่ `GET /api/v1/volunteer-access/cross-shelter-verifications` — ใช้ prefix `volunteer-access` ตามที่มีอยู่ · error `503 DEPENDENCY_UNAVAILABLE`)
  - docs/data/schema.md §2.8 `volunteer` (เพิ่ม `identity_verification.accepted_from?` และ `skill_verifications[code].accepted_from?` · **schema_v 4 → 5** · Migration note — ดู Change § schema และ Migration) และ §2.12 `audit` (เพิ่มค่า `reason = cross_shelter_verification.search` ในหมายเหตุ — FR-16)
  - frontend/src/lib/features/volunteers (domain: Zod ของ `accepted_from` + `schema_v` 5; data: `reviewIdentity` / `reviewSkill` ใน `volunteer.remote.ts` รับและเขียน `accepted_from`; server: อ่านโปรไฟล์ศูนย์อื่นด้วย admin credential (`adminRaw` + `_find` ต่อ DB แบบ `resolveTicket` ใน `public-ticket.ts:128-170`, ชุดศูนย์แบบ `shelterRefs()` ที่ `resolveIdentities` ใช้ใน `public-schedule-action.ts`) — ไม่ใช่ `findAsPublicWriter`; application: query; ui: `volunteer-qualification-dialog.svelte` แสดงผลจากศูนย์อื่น + ปุ่มรับ)
  - frontend/src/routes/api/v1/volunteer-access/cross-shelter-verifications/+server.ts (ใหม่)
  - tests: server unit (จับคู่ hash คู่ / ข้ามผลที่มี `accepted_from` / ศูนย์ปิดแล้วยังค้น / กรอง skill / ไม่คืนฟิลด์ต้องห้าม / 404 / 503 / audit), route (403 / 422), repository (`accepted_from` เขียน / ล้างเมื่อตรวจตรง), dom ของ dialog
---

# จิตอาสาหลายศูนย์ — แสดงผลยืนยันจากศูนย์อื่นให้เจ้าหน้าที่กดรับ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** dialog "ตรวจสอบคุณสมบัติ & อนุมัติการเข้าฐาน" ของจิตอาสาแสดงว่า "ยืนยันตัวตนแล้วที่ <ศูนย์> เมื่อ <วันที่>" / "รับรองแล้วที่ <ศูนย์> เมื่อ <วันที่>" เมื่อพบโปรไฟล์ศูนย์อื่นที่ `phone_hash` **และ** `national_id_hash` ตรงกันทั้งคู่ เจ้าหน้าที่**กดรับ**ทีละรายการเพื่อบันทึกในศูนย์นี้ — **ไม่มีการรับอัตโนมัติ** · ใช้เป็นต้นทางได้เฉพาะผลที่ตรวจตรงที่ศูนย์นั้น ผลที่ได้จากการกดรับไม่ส่งต่อ
> - **เพื่อใคร / ทำไม:** จิตอาสาที่ไปหลายศูนย์ไม่ต้องกรอกและตรวจหลักฐานซ้ำทั้งหมด แต่ผู้ออกสิทธิ์ในศูนย์ยังตรวจบัตรและตัดสินเอง (สอดคล้อง CR-221 FR-3)
> - **build:** endpoint อ่านอย่างเดียว `GET /api/v1/volunteer-access/cross-shelter-verifications` (SvelteKit `+server.ts` บน Node server ส่วนกลาง, admin credential ฝั่ง server, คืนเฉพาะ `shelter_code`, `shelter_name`, วันที่ยืนยัน และรหัสทักษะที่ผ่านการกรอง, บันทึก audit ทุกการค้น) + ส่วนแสดงผลและปุ่มรับใน dialog ที่เขียนลงโปรไฟล์ของศูนย์นี้ด้วย repository เดิมพร้อมตรา `accepted_from`
> - **schema / layer:** `volunteer` เพิ่ม `accepted_from?` ใน `identity_verification` และใน `skill_verifications[code]` · **schema_v 4 → 5** (ไม่ backfill) · `layer: stable` (อ่านข้ามทุก `shelter_*` ด้วย admin credential = auth / stable core ตาม change-management §1) → **ต้อง review ก่อน approve** · เปลี่ยน decision D-MULTI ของ CR-041 จาก A เป็น D

---

## Why

- **ปัญหาหน้างาน (#886):** จิตอาสาที่ไปหลายศูนย์ต้องยืนยันตัวตนและทักษะใหม่ทุกศูนย์
- **D-MULTI = A / D คืออะไร:** A = โปรไฟล์กลางใบเดียวใช้ได้ทุกศูนย์ (ที่ CR-041 ล็อกไว้ 2026-07-22) · D = คงโปรไฟล์ต่อศูนย์ตามโค้ดปัจจุบัน แต่ใช้ผลยืนยันจากศูนย์อื่นที่เป็นคนเดียวกัน (ตามคำตอบของ @net-lynx ใน #886)
- **A ไม่ตรงกับโค้ด:** โปรไฟล์เก็บแยกต่อ DB ศูนย์ (stable core: VDU ต่อศูนย์, edge replica, projection) โปรไฟล์กลางแพงและต้องเก็บ PII นอกศูนย์ (@net-lynx, #886)
- **ไม่รับผลยืนยันตัวตนอัตโนมัติ:** CR-221 FR-3 (approved 2026-11-01) กำหนดให้ยืนยันตัวตน**ในศูนย์ที่ออกสิทธิ์**ก่อนออกสิทธิ์ทุกครั้ง ผลจากศูนย์อื่นใช้แทนไม่ได้ ทาง D เดิมของ #886 ("ใช้ต่ออัตโนมัติ") จึงขัดกัน → ผู้ขอเสนอ "แสดงและกดรับ" (#886, 2026-11-02)
- **จับคู่ด้วยเบอร์ + เลขบัตรทั้งคู่:** ใช้กุญแจจับคู่เดียวกับ CR-213 FR-3(ข) / AC-3 และ CR-221 FR-30 แต่ต่างวัตถุประสงค์ (CR-221 FR-30 จับคู่เพื่อหาบัญชีเดิม CR นี้จับคู่เพื่อหาผลยืนยัน) เพื่อไม่ให้ผลยืนยันของคนหนึ่งไปปรากฏที่โปรไฟล์ของอีกคนที่ใช้เบอร์ร่วมกัน
- **ไม่อ้างต่อเป็นทอด:** ถ้าผลที่ได้จากการกดรับเป็นต้นทางได้ SH003 จะเห็น "ยืนยันแล้วที่ SH002" โดยไม่รู้ว่า SH002 กดรับต่อมาจาก SH001 และวันที่ที่เห็นเป็นวันกดรับ ไม่ใช่วันตรวจจริง ซึ่งขัดกับเจตนาให้แต่ละศูนย์ตัดสินเองและ CR-221 FR-3 → ต้องมีตราที่มา (`accepted_from`) เพื่อกรองผลที่กดรับออกจากการเป็นต้นทาง
- **ค้นศูนย์ที่ปิดแล้วด้วย:** การตรวจบัตรที่ศูนย์ซึ่งปิดไปแล้วยังเป็นการตรวจจริง ข้อเท็จจริงไม่หายไปเพราะศูนย์ปิด · ใช้ชุดศูนย์เดียวกับ `shelterRefs()` ที่ `resolveIdentities` ใช้ (ไม่กรอง `operation_status`) ตามคำตอบ "แบบเดียวกับ resolveIdentities" ของ @net-lynx
- **ข้อมูลข้ามศูนย์น้อยที่สุด:** เปิดเผยแค่ว่าเคยยืนยัน/รับรองที่ศูนย์ใดเมื่อไร ไม่เปิดชื่อเจ้าหน้าที่ของศูนย์อื่นและไม่ส่งเลขใบอนุญาต
- **audit การค้น:** endpoint อ่านข้อมูลของศูนย์อื่นด้วย admin credential จึงต้องย้อนตรวจได้ว่าใครค้น เทียบกับ CR-213 FR-14 / CR-221 FR-19 ที่ audit การออกสิทธิ์
- **ทักษะ:** มาตรฐานการรับรองแต่ละศูนย์อาจไม่เท่ากัน และบางทักษะผูกกับบริบทศูนย์ จึงต้องกดรับ (ตามคำตอบเดิมของ @net-lynx)
- **`layer: stable`:** endpoint ใหม่อ่าน `shelter_*` ของทุกศูนย์ด้วย admin credential (เรื่อง auth / data-plane boundary) ซึ่ง CR-213 ที่ใช้รูปแบบเดียวกันก็เป็น `stable`

## Change

### ค้นผลจากศูนย์อื่น (server)

- **FR-1 endpoint:** `GET /api/v1/volunteer-access/cross-shelter-verifications?shelter_code=&volunteer_id=` (prefix เดียวกับ endpoint จิตอาสาอื่น · ที่ deploy ดู FR-17)
  - ผู้เรียก: `system_admin` / `shelter_manager` / `volunteer_coordinator` ของ `shelter_code` (`canAccessVolunteerBackoffice`) · อื่น ๆ 403 · ไม่ระบุ `shelter_code` หรือ `volunteer_id` = 422
- **FR-2 ที่มาของข้อมูล:** server ใช้ **admin credential** (`adminRaw`) อ่านโปรไฟล์ `volunteer_id` ในศูนย์ที่ขอ แล้วไล่ `_find` ใน `shelter_{code}` ของทุกศูนย์ ยกเว้นศูนย์ที่ขอ ด้วย selector `{ type: volunteer, phone_hash, national_id_hash }`
  - **ชุดศูนย์:** ทุก doc `type: shelter` ใน `registry` แบบเดียวกับ `shelterRefs()` (`public-schedule-action.ts`) ที่ `resolveIdentities` ใช้ — **ไม่กรอง `operation_status`** ศูนย์ที่ `closed` / `cancelled` อยู่ในการค้นด้วย
  - **ต่างจาก `shelterRefs()` 1 จุด:** อ่าน `registry` ไม่สำเร็จ → 503 (FR-12) ไม่ใช้ค่า fallback SH001 ที่ `shelterRefs()` คืนเมื่อ registry ล่ม
  - **การอ่านต่อ DB:** `adminRaw` + `_find` ต่อ `shelter_{code}` แบบ `resolveTicket` (`public-ticket.ts:128-170`) — ไม่ใช่ `findAsPublicWriter` ที่ `resolveIdentities` ใช้ ซึ่งเป็น identity สิทธิ์จำกัด · CR นี้ใช้ admin credential เพราะต้องอ่าน `identity_verification` / `skill_verifications` ของทุก DB ศูนย์ — จึงเป็น stable core และต้อง review
  - ศูนย์ที่ไม่มี DB (404 เช่น DB ถูกลบหลังพ้นระยะเก็บ) ข้าม · อ่านไม่สำเร็จแบบอื่น endpoint ตอบ error (FR-12) ไม่คืนผลบางส่วน
  - **ข้ามผลที่ได้จากการกดรับ:** `identity_verification` ที่มี `accepted_from` ไม่เป็นต้นทางของ `identity` · `skill_verifications[code]` ที่มี `accepted_from` ไม่เป็นต้นทางของทักษะนั้น (FR-15)
- **FR-3 กฎจับคู่ (เป็นคนเดียวกัน):** โปรไฟล์ศูนย์อื่นนับว่าเป็นคนเดียวกันเมื่อ `phone_hash` **และ** `national_id_hash` ตรงกันทั้งคู่ — ไม่มีการจับคู่ด้วยเบอร์อย่างเดียว
  - โปรไฟล์ศูนย์นี้ไม่มี `phone_hash` หรือไม่มี `national_id_hash` (เช่น walk-in ใช้บัตรแทน #880 / #952) → คืน `matches: []`
  - โปรไฟล์ศูนย์อื่นที่ขาด hash ใดตัวหนึ่ง หรือ `status: inactive` → ไม่นับ
  - โปรไฟล์ศูนย์นี้ที่ `status: inactive` → คืน `matches: []`
- **FR-4 response (ฟิลด์ทั้งหมดที่คืน):** `{ ok: true, matches: [{ shelter_code, shelter_name, identity: { reviewed_at } | null, skills: [{ code, reviewed_at }] }] }` — ไม่มีฟิลด์อื่น
  - ศูนย์ที่ไม่มีทั้ง `identity` และ `skills` ไม่อยู่ใน `matches`
  - `identity` ไม่ใช่ `null` เมื่อโปรไฟล์ต้นทาง `identity_verification.status = verified` **และ**ไม่มี `accepted_from` **และ** โปรไฟล์ศูนย์นี้ยังไม่เป็น `verified`
  - `reviewed_at` = `reviewed_at` ของผลที่ศูนย์ต้นทาง (ISO 8601) · ต้นทางไม่มี `reviewed_at` (field เป็น optional ใน schema §2.8) → `reviewed_at: null` และยังคืนรายการนั้น
- **FR-5 กรอง skill ที่ server:** `skills[]` มีเฉพาะ `code` ที่ครบทั้งสี่ข้อ (กรองฝั่ง server ไม่ใช่ UI)
  - เป็นทักษะควบคุม (controlled) ตามรายการของศูนย์นี้ (`isControlledSkill` + master `volunteer_skills`)
  - อยู่ใน `skills` ของโปรไฟล์ศูนย์นี้
  - ต้นทาง `skill_verifications[code].status = verified` และศูนย์นี้ยังไม่ `verified` ทักษะนั้น
  - ต้นทาง `skill_verifications[code]` ไม่มี `accepted_from`
- **FR-6 ห้ามคืน:** ชื่อ-นามสกุล, เบอร์, เลขบัตร / hash, `_id` / รหัส V-xxx ของโปรไฟล์ศูนย์อื่น, ข้อมูลการพัก / กะ, **`reviewed_by` ของศูนย์อื่น** (ไม่ส่งชื่อเจ้าหน้าที่ข้ามศูนย์), **`credential_reference`**, `notes` และ `accepted_from` ของศูนย์อื่น

### แสดงผลและกดรับ (UI)

- **FR-7 แสดงตัวตน:** dialog "ตรวจสอบคุณสมบัติ & อนุมัติการเข้าฐาน" (`volunteer-qualification-dialog.svelte`) ของโปรไฟล์ที่ยังไม่ยืนยันตัวตนในศูนย์นี้ แสดง "ยืนยันตัวตนแล้วที่ <ศูนย์> เมื่อ <วันที่>" ต่อศูนย์ที่พบ — ไม่แสดงชื่อผู้ยืนยัน · `reviewed_at: null` แสดง "ยืนยันตัวตนแล้วที่ <ศูนย์> (ไม่ระบุวันที่)"
- **FR-8 กดรับตัวตน:** ปุ่ม "ยืนยันตัวตน (อ้างอิงผลจาก <ศูนย์>)" เรียก `reviewIdentity` (`volunteer.remote.ts`) เขียน `identity_verification` ของโปรไฟล์**ศูนย์นี้**: `status: verified`, `reviewed_by` = ผู้กด, `reviewed_at` = ตอนกด, `accepted_from` = `{ shelter_code, verified_at }` ของรายการที่กด (`verified_at` = `reviewed_at` จาก FR-4 รวมค่า `null`), `notes: null` · `identity_verified: true` ตามเดิม
  - **ต้องตรวจบัตรก่อนกด:** ข้างปุ่มแสดงข้อความ "ตรวจบัตรประชาชนตัวจริงของจิตอาสาต่อหน้าก่อนกดยืนยัน" — เจ้าหน้าที่ศูนย์ปลายทางต้องตรวจบัตรด้วยตนเองทุกครั้ง ผลจากศูนย์อื่นเป็นเพียงข้อมูลอ้างอิง
  - ปุ่มกดรับ**ไม่อ่าน**ช่อง "หมายเหตุ" ที่ใช้ร่วมกันใน dialog — ที่มาเก็บใน `accepted_from` ไม่เก็บใน `notes`
  - จนกว่าจะกดรับ โปรไฟล์ศูนย์นี้ยังเป็น "รอยืนยันตัวตน" และออกสิทธิ์ไม่ได้ (CR-221 FR-3)
- **FR-9 แสดงทักษะ:** ทักษะที่ endpoint คืนมา (FR-5) แสดง "รับรองแล้วที่ <ศูนย์> เมื่อ <วันที่>" (`reviewed_at: null` → "(ไม่ระบุวันที่)") + ปุ่ม "รับรองทักษะนี้" ข้างทักษะนั้น — ทักษะที่โปรไฟล์ศูนย์นี้ไม่ได้ระบุไม่แสดงและ CR นี้ไม่เพิ่มทักษะให้
- **FR-10 กดรับทักษะ:** กดแล้วเรียก `reviewSkill` เขียน `skill_verifications[code]` ของโปรไฟล์ศูนย์นี้: `status: verified`, `reviewed_by` = ผู้กด, `reviewed_at` = ตอนกด, `accepted_from` = `{ shelter_code, verified_at }` ของรายการที่กด, `notes: null`
  - `credential_reference` **ไม่คัดลอก**จากศูนย์ต้นทาง — เป็นค่าที่เจ้าหน้าที่ศูนย์นี้กรอกเองในช่องเดิมของ dialog (เว้นว่างได้ตามกติกาเดิม)
  - ปุ่มกดรับไม่อ่านช่อง "หมายเหตุ" ที่ใช้ร่วมกันใน dialog (เหมือน FR-8)
- **FR-11 สิทธิ์ — ตรวจที่ไหนจริง (กติกาใหม่):**
  - **อ่าน (บังคับที่ server):** endpoint ตรวจ role ตาม FR-1 ก่อนอ่านศูนย์อื่น — เป็นจุดเดียวที่ CR นี้บังคับสิทธิ์
  - **แสดง (UI เท่านั้น):** ส่วนแสดงผลจากศูนย์อื่นและปุ่มรับแสดงเฉพาะ SA / SM / VC ของศูนย์นี้ (`canAccessVolunteerBackoffice`)
  - **เขียน (ไม่ผ่าน endpoint):** การกดรับ (FR-8 / FR-10) เขียนจากเบราว์เซอร์ลง CouchDB `shelter_{code}` ตรงด้วย `_session` ของผู้กด ผ่าน `reviewIdentity` / `reviewSkill` (`volunteer.remote.ts:141-188`) ซึ่งไม่มี capability check ในตัวเอง · ฝั่งเขียนพึ่ง `_security` + `validate_doc_update` ของ `shelter_{code}` เท่านั้น ซึ่งวันนี้ตรวจแค่ว่าเป็นสมาชิกศูนย์และ `type: volunteer` อยู่ในรายการที่เขียนได้ (`shelter-access-design.ts:609`) ไม่ได้จำกัด role ที่เขียน `identity_verification` / `skill_verifications` / `accepted_from` · CR นี้ไม่เพิ่มการบังคับที่ชั้นเขียน (ดู Q1)
- **FR-12 เมื่อค้นไม่สำเร็จ:** อ่าน `registry` ไม่สำเร็จ หรืออ่านศูนย์ใดไม่สำเร็จ (นอกจาก 404) → endpoint ตอบ `503 DEPENDENCY_UNAVAILABLE` ตาม convention ของ api-contract ไม่คืนผลบางส่วน · dialog แสดง toast ผิดพลาดและซ่อนส่วนผลจากศูนย์อื่น · การยืนยันตัวตน / รับรองทักษะด้วยมือใน dialog ยังใช้ได้ตามปกติ
- **FR-13 กรณีขอบ:**
  - หลายศูนย์พบพร้อมกัน → แสดงแยกบรรทัดต่อศูนย์ ไม่รวมผล · กดรับจากศูนย์ใดก็ได้
  - โปรไฟล์ศูนย์นี้ยืนยันตัวตนแล้ว → ไม่แสดงส่วนตัวตน · ทักษะที่ `verified` แล้วไม่แสดง
  - ผลของศูนย์ต้นทางที่ถูกยกเลิก / เปลี่ยนภายหลังไม่ย้อนมายกเลิกของศูนย์นี้ (แต่ละศูนย์ตัดสินเอง)
  - **ปุ่ม submit รวมเดิมของ dialog** (`volunteer-qualification-dialog.svelte:139-160` ยืนยันตัวตนและทุกทักษะควบคุมจากปุ่มเดียวพร้อม notes ร่วม) **ไม่เขียนผลข้ามศูนย์**: ไม่อ่าน response ของ FR-4 และเขียนเป็นผลตรวจตรงที่ศูนย์นี้ (ไม่มี `accepted_from`) — ถ้าเขียนทับรายการที่เคยกดรับ `accepted_from` ของรายการนั้นหายไปและรายการนั้นกลายเป็นผลตรวจตรง (FR-15)
- **FR-14 ไม่แตะ:** ไม่มีโปรไฟล์กลาง ไม่ย้ายข้อมูล ไม่เขียนเอกสารของศูนย์อื่น

### schema — ตราที่มาของผล (schema.md §2.8)

- **FR-15 `accepted_from`:** เพิ่ม sub-field optional ใน `identity_verification` และในแต่ละ entry ของ `skill_verifications`
  - ชนิด: `{ shelter_code: str, verified_at: ts | null }` · `shelter_code` = ศูนย์ต้นทางที่ตรวจตรง · `verified_at` = `reviewed_at` ของผลที่ศูนย์ต้นทาง (`null` เมื่อต้นทางไม่มี)
  - **มี** `accepted_from` = ผลนี้ได้จากการกดรับผลของศูนย์อื่น (FR-8 / FR-10) · **ไม่มี** = ผลตรวจตรงที่ศูนย์นี้
  - เขียนได้จากการกดรับ (FR-8 / FR-10) เท่านั้น · การตรวจตรงทุกทาง (ปุ่ม submit รวม, ยืนยัน / ปฏิเสธด้วยมือ) เขียน record ใหม่**ไม่มี** `accepted_from`
  - ผลที่มี `accepted_from` ไม่เป็นต้นทางให้ศูนย์อื่น (FR-2, FR-4, FR-5)
  - `volunteer` `schema_v` **4 → 5** · เอกสารที่เขียนหลัง deploy เป็น v5 · Zod รับทั้ง v4 และ v5

| field (§2.8)            | ก่อน (schema_v 4)                                                                          | หลัง (schema_v 5)                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `identity_verification` | {`status`,`reviewed_at?`,`reviewed_by?`,`notes?`,`credential_reference?`}\|null            | {`status`,`reviewed_at?`,`reviewed_by?`,`notes?`,`credential_reference?`,`accepted_from?`}\|null                                                 |
| `skill_verifications`   | map<skill_code, {`status`,`reviewed_at?`,`reviewed_by?`,`notes?`,`credential_reference?`}> | map<skill_code, {`status`,`reviewed_at?`,`reviewed_by?`,`notes?`,`credential_reference?`,`accepted_from?`}>                                      |
| `accepted_from` (ใหม่)  | —                                                                                          | {`shelter_code`:str, `verified_at`:ts\|null} opt — มี = ได้จากการกดรับผลศูนย์อื่น (CR นี้) · ไม่มี = ตรวจตรงที่ศูนย์นี้ · ไม่เป็นต้นทางข้ามศูนย์ |

- หัว §2.8 เพิ่มบรรทัด `> **schema_v 5** — เพิ่ม accepted_from ใน identity_verification / skill_verifications (CR นี้)` และ Migration note ตาม § Migration

### audit การค้นข้ามศูนย์

- **FR-16 audit ทุกการค้น:** ทุก request ที่ผ่าน FR-1 และค้นเสร็จ (200 รวม `matches: []`) เขียนเอกสาร `audit` (append-only §2.12) ใน `shelter_{code}` ของศูนย์ที่ขอ
  - `action: other`, `reason: cross_shelter_verification.search`, `target_type: volunteer`, `target_id` = `volunteer_id` ของศูนย์ที่ขอ
  - `context`: `{ actor, shelter_code, match_count, shelters_searched }` · `actor` = ผู้เรียก · `shelter_code` = ศูนย์ที่ขอ · `match_count` = จำนวนรายการใน `matches` · `shelters_searched` = จำนวนศูนย์ที่อ่านสำเร็จ
  - **ห้ามเก็บ** ชื่อ, เบอร์, เลขบัตร, `phone_hash`, `national_id_hash`, `_id` ของโปรไฟล์ศูนย์อื่น
  - 403 / 422 / 503 ไม่เขียน audit
  - เขียน audit ไม่สำเร็จ → ลองใหม่ด้วย `_id` เดิม (409 นับว่าเขียนแล้ว) แล้ว log error พร้อม field เดียวกัน และยังคืน response ตามปกติ (รูปแบบเดียวกับ CR-213 FR-14)

### ที่ deploy endpoint

- **FR-17 ที่ deploy:** endpoint เป็น SvelteKit server route `frontend/src/routes/api/v1/volunteer-access/cross-shelter-verifications/+server.ts` (`prerender = false`) รันบน **Node server ส่วนกลาง** (`@sveltejs/adapter-node`) ใน production ชุดเดียวกับ `/api/v1/volunteer-access*` และ `/api/public/v1/volunteer/*` ที่มีอยู่
  - admin credential (`COUCHDB_ADMIN_URL`) ใช้ได้ผ่าน `$lib/server/couch-admin.ts` (`adminRaw`) ฝั่ง server เท่านั้น ห้ามอยู่ใน client bundle หรือ env `PUBLIC_*`
  - ไม่ย้ายไป FastAPI ใน CR นี้ · หมายเหตุ "dev BFF เป็น implementation ชั่วคราว" ใน api-contract §3 (`/api/v1/users`) ใช้กับ user management และเขียนไว้ก่อนแอปย้ายมา adapter-node — endpoint ของ CR นี้ไม่ได้อยู่บน dev server อย่างเดียว · ถ้าภายหลังย้ายไป service อื่น contract ของ FR-1 ถึง FR-16 คงเดิม
  - ผู้ใช้ที่ใช้ edge CouchDB บน LAN (central ไม่ถึง) เรียก endpoint ไม่ได้ → dialog ทำตาม FR-12 (ซ่อนส่วนผลจากศูนย์อื่น ยืนยันด้วยมือได้)

### role-permission-matrix

- **§3 Action Matrix เพิ่มแถว** "Volunteer Verification (ผลจากศูนย์อื่น)" — การกระทำ "ดูผลยืนยันตัวตน / รับรองทักษะจากศูนย์อื่น (ไม่มีชื่อผู้ยืนยัน) และกดรับลงโปรไฟล์ศูนย์ตน (CR นี้)" · SA `✓` · SM `scope` · VC `scope` · role อื่น `—`
- หมายเหตุใต้แถว: endpoint อ่านบังคับ role ที่ server · การกดรับบังคับที่ UI เท่านั้น ชั้นเขียนพึ่ง `validate_doc_update` (FR-11, Q1)

### CR-041 (before → after)

| ข้อ              | ก่อน                                                    | หลัง                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-MULTI (ข้อ 11) | A — โปรไฟล์กลาง อาสาหนึ่งคนหนึ่งโปรไฟล์                 | D — โปรไฟล์ต่อศูนย์ (ตามโค้ดปัจจุบัน) + แสดงผลยืนยันจากศูนย์อื่นที่เบอร์และเลขบัตรตรงกันให้เจ้าหน้าที่กดรับ เฉพาะผลที่ตรวจตรง (CR นี้) · บัญชีระบบ 1 บัญชีต่อคนข้ามศูนย์อยู่ใน CR-221 Part B |
| ข้อ 7 (`:90`)    | โปรไฟล์อาสา **กลาง** — สมัครงานหลายศูนย์จากโปรไฟล์เดียว | โปรไฟล์อาสาต่อศูนย์ — สมัครงานหลายศูนย์ได้ (โปรไฟล์ต่อศูนย์) และใช้ผลยืนยันจากศูนย์อื่นแบบกดรับ (CR นี้)                                                                                     |

## Acceptance

- [ ] **AC-1:** โปรไฟล์ SH002 ที่ `phone_hash` + `national_id_hash` ตรงกับคนที่ยืนยันตัวตนแล้วใน SH001 → dialog แสดง "ยืนยันตัวตนแล้วที่ SH001 เมื่อ …" (ไม่มีชื่อผู้ยืนยัน) แต่สถานะยังเป็น "รอยืนยันตัวตน" และออกสิทธิ์ไม่ได้ (FR-3, FR-7)
- [ ] **AC-2:** กด "ยืนยันตัวตน (อ้างอิงผลจาก SH001)" → โปรไฟล์ SH002 ยืนยันแล้ว `reviewed_by` = ผู้กด, `accepted_from = { shelter_code: SH001, verified_at: <reviewed_at ของ SH001> }`, `notes: null` แม้ช่องหมายเหตุของ dialog มีข้อความ, `schema_v: 5` (FR-8, FR-15)
- [ ] **AC-3:** dialog แสดงข้อความให้ตรวจบัตรตัวจริงก่อนกดยืนยัน (FR-8)
- [ ] **AC-4:** ตรงแค่ `phone_hash` (เลขบัตรไม่ตรง) → ไม่แสดงผลจากศูนย์นั้น · โปรไฟล์ศูนย์ใดศูนย์หนึ่งไม่มี `national_id_hash` หรือไม่มี `phone_hash` → ไม่แสดง (FR-3)
- [ ] **AC-5:** โปรไฟล์ต้นทาง `status: inactive` → ไม่แสดงผลจากศูนย์นั้น · โปรไฟล์ศูนย์นี้ `inactive` → ไม่แสดงส่วนนี้ (FR-3)
- [ ] **AC-6:** ทักษะควบคุมที่ `verified` ที่ SH001 และ SH002 ระบุไว้ → แสดงพร้อมปุ่มรับ กดแล้ว `skill_verifications` ของ SH002 เป็น `verified` มี `accepted_from.shelter_code = SH001` โดย `credential_reference` ไม่ถูกคัดลอกจาก SH001 (FR-9, FR-10)
- [ ] **AC-7:** ทักษะที่ SH002 ไม่ได้ระบุ, ทักษะที่ไม่ใช่ controlled, ทักษะที่ SH001 ยังไม่ `verified` หรือที่ SH002 `verified` แล้ว → ไม่อยู่ใน response (กรองที่ server — ตรวจที่ระดับ route test ไม่ใช่ UI) (FR-5)
- [ ] **AC-8:** response มีเฉพาะฟิลด์ใน FR-4 — ไม่มีชื่อ / เบอร์ / เลขบัตร / hash / `_id` / `reviewed_by` / `credential_reference` / `notes` / `accepted_from` ของศูนย์อื่น (FR-4, FR-6)
- [ ] **AC-9:** role อื่นเรียก endpoint ได้ 403 · `shelter_code` / `volunteer_id` หาย 422 · ปุ่มและส่วนผลไม่แสดงให้ role อื่น — AC นี้ทดสอบเฉพาะ endpoint (อ่าน) และ UI ไม่ทดสอบการบังคับที่ชั้นเขียน (FR-1, FR-11)
- [ ] **AC-10:** ศูนย์ที่ไม่มี DB (404) ถูกข้าม ผลของศูนย์อื่นยังแสดง · registry หรือศูนย์ใดอ่านผิดพลาดแบบอื่น → endpoint `503 DEPENDENCY_UNAVAILABLE` + toast ผิดพลาด แต่ยืนยันด้วยมือใน dialog ยังทำได้ (FR-2, FR-12)
- [ ] **AC-11:** พบหลายศูนย์ → แสดงแยกบรรทัด · ยืนยันตัวตนแล้วในศูนย์นี้ → ไม่แสดงส่วนตัวตน (FR-13)
- [ ] **AC-12:** SH002 กดรับผลตัวตนและทักษะ X จาก SH001 แล้ว · เปิดโปรไฟล์ SH003 ของคนเดียวกัน → response ของ SH003 มีรายการจาก SH001 แต่ไม่มีรายการจาก SH002 ทั้งตัวตนและทักษะ X (FR-2, FR-5, FR-15)
- [ ] **AC-13:** ศูนย์ต้นทาง `operation_status: closed` (DB ยังอยู่) ที่ยืนยันตัวตนตรงไว้ → แสดงผลจากศูนย์นั้นตามปกติ (FR-2)
- [ ] **AC-14:** ต้นทางยืนยันแล้วแต่ไม่มี `reviewed_at` → response `identity.reviewed_at: null`, dialog แสดง "(ไม่ระบุวันที่)", กดรับแล้ว `accepted_from.verified_at: null` (FR-4, FR-7, FR-8)
- [ ] **AC-15:** กดปุ่ม submit รวมเดิมของ dialog → ผลตัวตน / ทักษะเขียนโดยไม่มี `accepted_from` (ทับรายการที่เคยกดรับได้) และไม่ใช้ข้อมูลจาก FR-4 (FR-13, FR-15)
- [ ] **AC-16:** เรียก endpoint สำเร็จ 1 ครั้ง → `audit` 1 ฉบับใน `shelter_{code}` ของศูนย์ที่ขอ `reason: cross_shelter_verification.search` `context` มี `actor`, `shelter_code`, `match_count`, `shelters_searched` และไม่มีชื่อ / hash / `_id` ของศูนย์อื่น · 403 / 422 / 503 ไม่มี audit (FR-16)
- [ ] **AC-17:** เอกสาร `volunteer` v4 เดิม (ไม่มี `accepted_from`) อ่านผ่าน Zod ได้และนับเป็นผลตรวจตรง (เป็นต้นทางได้) (FR-15, Migration)

## คำถามที่รอเจ้าของตัดสิน

คำตอบของผู้ขอ (@mhapong) 2026-11-03 — รอ @Jackyzaz approve ([คอมเมนต์ PR #1118](https://github.com/r202-coe-psu/tent/pull/1118#issuecomment-6598794162)) และบันทึกใน Change ข้างต้น: จับคู่ด้วย hash ทั้งสอง (FR-3) · ไม่ส่งชื่อผู้ยืนยันข้ามศูนย์ (FR-4, FR-6, FR-7) · ไม่ส่ง / ไม่คัดลอก `credential_reference` (FR-6, FR-10) · กรอง skill ที่ server (FR-5) · `layer: stable` · ต้องตรวจบัตรก่อนกด (FR-8)

คำตอบของผู้ขอ (@mhapong) 2026-11-04 — รอ @Jackyzaz approve (ตอบ review รอบที่ 2 บน PR #1118) และบันทึกใน Change ข้างต้น:

- **การอ้างต่อเป็นทอด:** ไม่อนุญาต — เป็นต้นทางได้เฉพาะผลที่ตรวจตรง ผลที่กดรับมีตรา `accepted_from` และไม่ส่งต่อ (FR-2, FR-5, FR-15) · `schema_v` 4 → 5
- **ศูนย์ที่ปิดแล้ว:** ค้นทุกศูนย์ใน registry แบบเดียวกับ `shelterRefs()` / `resolveIdentities` ไม่กรอง `operation_status` (FR-2)
- **audit การค้น:** เพิ่ม FR-16
- **ที่ deploy:** Node server ส่วนกลาง (FR-17)
- **PDPA:** ยกเป็นคำถาม Q4

ยังเปิดอยู่:

- **Q1 สิทธิ์ที่ชั้นเขียน:** การกดรับเขียนจากเบราว์เซอร์ลง CouchDB ตรง (FR-11) · `reviewIdentity` / `reviewSkill` ไม่มี capability check และ `validate_doc_update` ของ `shelter_{code}` ไม่จำกัด role ที่เขียน `identity_verification` / `skill_verifications` / `accepted_from` · **ความเสี่ยง:** สมาชิกศูนย์ทุก role (เช่น REG / KS) เขียนผลยืนยันหรือ `accepted_from` ได้ด้วยการเรียก CouchDB ตรงโดยไม่ผ่าน UI — ซึ่งเป็นความเสี่ยงที่มีอยู่แล้วของการยืนยันด้วยมือ CR นี้เพิ่มแค่ `accepted_from` (ปลอมตราได้ผลแค่ทำให้ผลนั้นไม่เป็นต้นทาง แต่ลบตราออกได้ ทำให้ผลที่กดรับกลายเป็นต้นทาง) · ข้อเสนอ: ไม่เพิ่มใน CR นี้ แยกเป็น issue ต่างหากให้ VDU จำกัด role ที่เขียน field ยืนยัน เพราะกระทบทุกจุดที่เรียก flow เดิม
- **Q2 โปรไฟล์ศูนย์นี้ `rejected`:** FR-4 คืน `identity` เมื่อศูนย์นี้ "ยังไม่ `verified`" ซึ่งรวมกรณีที่เจ้าหน้าที่ศูนย์นี้ปฏิเสธไปแล้ว · ข้อเสนอ: ไม่แสดงเมื่อศูนย์นี้ `rejected` (การตัดสินของศูนย์นี้ชนะ) — รอยืนยัน
- **Q3 ประสิทธิภาพ:** ค้นขนานทุกศูนย์ (รวมศูนย์ที่ปิดแล้ว) ต่อการเปิด dialog 1 ครั้ง (`_find` 1 ครั้งต่อ DB, `fields` จำกัด, `limit` ต่ำ) · ยังไม่ระบุจำนวนศูนย์สูงสุดและเป้าเวลาตอบสนอง · ข้อเสนอ: ตั้งเป้า p95 ≤ 2 วินาทีที่จำนวนศูนย์ใน registry สูงสุด — ต้องให้ผู้ตัดสินระบุตัวเลข
- **Q4 PDPA (ถึง @Jackyzaz / DPO):** ฐานทางกฎหมายของการเปิดเผยข้อมูลข้ามศูนย์ (ศูนย์หนึ่งรู้ว่าบุคคลนี้เคยยืนยันตัวตน / รับรองทักษะที่ศูนย์ใดเมื่อไร โดยจับคู่จาก hash ของเบอร์และเลขบัตร) และการแจ้งจิตอาสาว่าผลยืนยันอาจถูกแสดงให้ศูนย์อื่นที่เขาสมัคร (เช่น ข้อความในฟอร์มสมัคร / ประกาศความเป็นส่วนตัว) ยังไม่ระบุ · ต้องตัดสินก่อน implement: ฐานที่ใช้ และข้อความ / จุดที่แจ้ง

## Impact

- **ความเป็นส่วนตัว:** SA / SM / VC ของศูนย์ใหม่รู้ว่าคนนี้เคยยืนยันตัวตน / รับรองทักษะที่ศูนย์ใดเมื่อไร (รวมศูนย์ที่ปิดแล้ว) — ไม่เห็นชื่อเจ้าหน้าที่ ข้อมูลส่วนตัว หรือเลขใบอนุญาตของศูนย์นั้น และการจับคู่ต้องมีทั้งเบอร์และเลขบัตร · ทุกการค้นมี audit (FR-16) · ฐานทางกฎหมายรอ Q4
- **ความปลอดภัย:** endpoint ใหม่ใช้ admin credential อ่านทุก `shelter_*` (server-only บน Node server ส่วนกลาง, อ่านอย่างเดียว) — ต้องผ่าน review (stable core) และกรอง response ที่ server (FR-5, FR-6) · ฝั่งเขียนไม่มีการบังคับ role เพิ่ม (Q1)
- **ประสิทธิภาพ:** ค้นทุกศูนย์ใน `registry` ต่อการเปิด dialog 1 ครั้ง (ดู Q3)
- **ข้อจำกัดที่รู้:** walk-in ที่ไม่มีเบอร์หรือเลขบัตรเชื่อมข้ามศูนย์ไม่ได้ · โปรไฟล์ที่ไม่ตรงทั้ง `phone_hash` และ `national_id_hash` ไม่แสดง (FR-3) · ผลที่ศูนย์ปลายทางกดรับไม่ส่งต่อ ถ้าศูนย์ต้นทางที่ตรวจตรงทุกศูนย์ไม่มี DB แล้ว ศูนย์ใหม่ต้องตรวจเอง · edge LAN fallback ไม่มีผลข้ามศูนย์ (FR-17)
- **CR-221:** ไม่เปลี่ยน FR-3 (ยังต้องยืนยันในศูนย์นี้ก่อนออกสิทธิ์) · ใช้กุญแจจับคู่เดียวกับ CR-213 FR-3(ข) / CR-221 FR-30 แต่ต่างวัตถุประสงค์

## Migration

- `volunteer` **schema_v 4 → 5** (additive): เพิ่ม `accepted_from?` ใน `identity_verification` และ `skill_verifications[code]`
- **ไม่ backfill** · เอกสารที่ไม่มี `accepted_from` (รวม v4 ทั้งหมด) = ผลตรวจตรงที่ศูนย์นี้ และเป็นต้นทางข้ามศูนย์ได้
- เอกสารที่เขียนหลัง deploy เป็น v5 · Zod รับทั้ง v4 และ v5 · `pnpm migrate:volunteer-review` เดิมไม่ต้องแก้ (ไม่เติม `accepted_from`)

## Decision log

- 2026-07-22 — CR-041 lock D-MULTI = A (โปรไฟล์กลาง)
- 2026-10-26 — @net-lynx ตอบใน #886: ทาง D (คงโปรไฟล์ต่อศูนย์ ใช้ผลยืนยันจากศูนย์อื่น) ตัวตนใช้ต่ออัตโนมัติ ทักษะกดรับ
- 2026-10-28 — @mhapong แจ้งใน #886: D5 ใน #1000 (CR-213) ใช้ `phone_hash` + `national_id_hash` กับการออกสิทธิ์
- 2026-11-01 — CR-221 FR-3: ยืนยันตัวตนในศูนย์นี้ก่อนออกสิทธิ์ ผลศูนย์อื่นใช้แทนไม่ได้
- 2026-11-02 — @mhapong เสนอใน #886: "แสดงและกดรับ" ทั้งตัวตนและทักษะ แทน "ตัวตนใช้ต่ออัตโนมัติ" (เหตุผล: ขัด CR-221 FR-3) · เปิด draft CR นี้ (PR #1118)
- 2026-11-03 — แก้ตาม review รอบที่ 1 ของ @Jackyzaz บน PR #1118 พร้อมคำตอบของผู้ขอ (@mhapong) ที่รอ approve: จับคู่ด้วย `phone_hash` + `national_id_hash` ทั้งคู่ (ตัดจับคู่ด้วยเบอร์อย่างเดียว) · ไม่ส่งชื่อผู้ยืนยันข้ามศูนย์ · ไม่ส่ง / ไม่คัดลอก `credential_reference` · server กรอง skill · `layer: stable` · เจ้าหน้าที่ตรวจบัตรก่อนกด · endpoint ย้ายไป prefix `volunteer-access` · เพิ่มเอกสารที่ต้องอัปเดตเมื่อ approve ใน `affects`
- 2026-11-04 — แก้ตาม review รอบที่ 2 ของ @Jackyzaz บน PR #1118 พร้อมคำตอบของผู้ขอ (@mhapong) ที่รอ approve: ไม่อ้างต่อเป็นทอด → เพิ่ม `accepted_from` + `schema_v` 4 → 5 (FR-15) · ค้นศูนย์ที่ปิดแล้วด้วย (FR-2) · audit การค้น (FR-16) · ที่ deploy (FR-17) · PDPA (Q4) · FR-11 / AC-9 แยกการบังคับสิทธิ์ฝั่งอ่าน / เขียน และย้ายความเสี่ยงไป Q1 · 502 → `503 DEPENDENCY_UNAVAILABLE` · `reviewed_at` เมื่อต้นทางไม่มี (FR-4) · ปุ่มกดรับไม่ใช้ notes และปุ่ม submit รวมไม่เขียนผลข้ามศูนย์ (FR-8, FR-10, FR-13) · แก้อ้างอิง pattern เป็น `public-ticket.ts` / `shelterRefs()` · แก้ข้อจำกัดที่ขัด FR-3 · เพิ่ม role-permission-matrix และ CR-041 `:90` ใน `affects`
- ผู้ตัดสิน: @Jackyzaz (รอ approve หลัง review)
