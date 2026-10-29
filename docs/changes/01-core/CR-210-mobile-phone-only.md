---
id: CR-210 # renumbered from draft-mobile-phone-only
title: เบอร์โทรต้องเป็นมือถือ 10 หลักทั้งระบบ (เลิกรับเบอร์บ้าน 9 หลัก, ถอน CR-202) + กติกาเบอร์ของจิตอาสา
status: approved
date: 2026-10-28
updated: 2026-10-29 # approved (Soravit Sukkarn, Team Lead)
requested_by: "@net-lynx — #880 ทาง B (2026-10-27) และสั่งเลิกรับเบอร์บ้านทั้งระบบ (2026-10-28) ผ่านผู้รับงาน @Mhapong — #951, #882, #991"
decided_by: "Soravit Sukkarn (Team Lead)"
decision_date: 2026-10-29
layer: volatile
supersedes:
  - CR-202 (บัญชีผู้ใช้เก็บเบอร์บ้าน 9 หลัก)
affects:
  - docs/data/schema.md §6 `_users.phone`, §2.8 `volunteer.phone`, evacuee `phone`
  - docs/changes/01-core/CR-202-account-contact-phone.md (status → superseded)
  - docs/changes/00-baseline/CR-148-pre-register-validation-and-fields.md FR-11
  - docs/changes/14-kiosk/CR-151-kiosk-pre-registration-check-in.md FR-KPC-51, FR-KPC-53, E-14
  - "ฝั่งบริจาค, นำเข้า Excel, `emergency_contact.phone` (spec ติดตามใน #1001): docs/changes/04-donation/CR-173-donation-track-by-phone.md FR-1, docs/data/schema.md §2.3 `donation.donor.phone`, CR-055 (walk-in donor ตาม #981)"
  - docs/changes/10-eoc/CR-154-m2-partner-booking-residency.md FR-12
  - docs/changes/10-eoc/CR-169-ext-008-multi-cid-booking.md FR-2
  - docs/data/api-contract.md (validation ของ `phone` ใน external bookings)
  - ไม่ bump `schema_v` (ไม่เปลี่ยนรูปร่างเอกสาร)
  - "กฎกลาง: frontend/src/lib/db/model.ts `normalizeThaiPhone` + `thaiMobilePhoneSchema` (#981), backend/apiapp/utils/masking.py และ worker/src/worker/masking.py `normalize_phone`"
  - "ส่วนจิตอาสา (implement ใน PR #984): frontend/src/lib/utils/volunteer-phone.ts (ใช้ `normalizeThaiPhone` แล้ว re-export `thaiMobilePhoneSchema` เมื่อ #981 merge), volunteers (walk-in, แก้ไขโปรไฟล์, volunteer-card, volunteer-access), volunteer-portal (`phoneField`), quick apply, BFF /api/public/v1/volunteer/apply + /preflight, volunteers/server/public-application.ts"
  - "ส่วนที่เหลือ (implement ใน #991): users, me, server/user-service.ts, people/domain/registration-validation.ts, people/domain/unified-registration.ts, people/ui/registration/, people-import/domain/import-row.ts, people/domain/people.ts (`emergency_contact.phone`), public-register, routes/api/public/v1/registrations, kiosk/domain/phone.ts, public-portal/domain/search-input.ts, db/model.ts, backend/apiapp/utils/search_query.py, backend/apiapp/modules/thirdparty_bookings"
---

# CR-210 — เบอร์มือถือ 10 หลักทั้งระบบ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ทุกช่องที่กรอกหรือค้นด้วยเบอร์ในระบบต้องเป็นมือถือ 10 หลัก (`^0\d{9}$` หลัง normalize) เลิกรับเบอร์บ้าน 9 หลัก
> - **ครอบคลุม:** จิตอาสา, บัญชีผู้ใช้ (ถอน CR-202), ผู้อพยพ (รวมผู้ติดต่อฉุกเฉินและนำเข้า Excel), ผู้บริจาค, kiosk, ค้นหาครอบครัว, ค้นหาฝั่ง FastAPI, API ภายนอก
> - **จิตอาสาเพิ่มเติม:**
>   - walk-in เว้นเบอร์ได้
>   - โปรไฟล์เดิมที่เป็นเบอร์ 9 หลักต้องแก้ก่อนออกสิทธิ์ใช้งานระบบ
>   - สมัครด้วยเบอร์ของโปรไฟล์ที่ถูกปิดใช้งานได้ใบ `pending_review` (#882)
> - **ข้อมูลเดิม:** ไม่ migrate เอกสารเดิมอ่านได้ แต่บันทึกฟอร์มใหม่ต้องแก้เป็นมือถือหรือเว้นว่าง
> - **ภายนอก:** API ภายนอกปฏิเสธเบอร์ 9 หลัก แจ้งพาร์ทเนอร์แล้ว · ไม่ bump `schema_v`

---

## Why

- **#880 (2026-10-26/27):** @net-lynx ตอบทาง A (รับเบอร์บ้าน) แล้วเปลี่ยนเป็นทาง B ให้เบอร์จิตอาสาเป็นมือถือ 10 หลัก "เบอร์บ้านไม่สำคัญ"
- **คำสั่ง 2026-10-28:** @net-lynx สั่ง "เอาเบอร์ 9 หลักที่เป็นเบอร์บ้านออกเลย" ผู้รับงานยืนยันว่าขอบเขตคือทั้งระบบ และไม่ migrate ข้อมูล
- **เบอร์บ้านระบุตัวคนไม่ได้:** เบอร์บ้านใช้ร่วมกันหลายคน แต่เบอร์ในระบบใช้ระบุตัวตนและค้นหา ได้แก่
  - `phone_hash` กันโปรไฟล์ซ้ำ
  - login ด้วยเบอร์
  - ค้นหาครอบครัว
  - kiosk
  - เปิด Digital Pass
- **#882:** @net-lynx ตัดสินกรณีสมัครด้วยเบอร์ของโปรไฟล์ที่ถูกปิดใช้งาน ซึ่งแก้ BFF สมัครจุดเดียวกับเบอร์จิตอาสา จึงรวมไว้ใน CR นี้
- **รวมเป็น CR เดียว:** เดิมแยกเป็น `draft-volunteer-mobile-phone` (#951) ผู้รับงานรวมเข้ามาเมื่อ 2026-10-28 ขอ approve ครั้งเดียว

## Change

### A. กฎกลาง (ทั้งระบบ)

- **FR-1:** normalize ก่อน: ตัดช่องว่าง ขีด จุด วงเล็บ และ `+66` / `66` → `0` (CR-148) แล้วต้องตรง `^0\d{9}$`
  - ฝั่ง frontend กฎกลางคือ `normalizeThaiPhone` + `thaiMobilePhoneSchema` ใน `lib/db/model.ts` (#981) ทุกช่องใช้ตัวนี้ ห้ามมี normalize ของตัวเอง เพราะผลต้องตรงกันเพื่อให้ `phone_hash` ตรงกัน
  - `lib/utils/volunteer-phone.ts` (#984) ใช้ `normalizeThaiPhone` แล้ว และเปลี่ยนเป็น re-export `thaiMobilePhoneSchema` (หรือลบทิ้ง) เมื่อ #981 merge
  - ฝั่ง FastAPI ใช้ regex จุดเดียว
  - `normalize_phone` ของ backend และ worker (`masking.py` ทั้งสองไฟล์ ใช้คำนวณ `phone_hash`) ต้องให้ผลเดียวกับ `normalizeThaiPhone` ตอนนี้ยังไม่ตัด `.` และแปลง `66…` ต่างจากฝั่ง frontend แก้ใน #991
- **FR-2 ช่องกรอกเบอร์ที่ใช้ FR-1:**
  - จิตอาสา: สมัคร portal, quick apply, walk-in, แก้ไขโปรไฟล์ และ BFF apply/preflight ตรวจซ้ำฝั่ง server
  - บัญชีผู้ใช้: ฟอร์มผู้ใช้, `/me`, `user-service`
  - เบอร์ผู้อพยพและหัวหน้าครัวเรือน: onsite, pre-register, BFF registrations
  - `emergency_contact.phone` และนำเข้า Excel (`people-import`) เว้นว่างได้ (spec ติดตามใน #1001)
  - ผู้บริจาค: walk-in donor (#981, CR-055) และค้นหาการบริจาคด้วยเบอร์ (CR-173 FR-1, `lookup-by-phone`) (spec ติดตามใน #1001)
  - kiosk: ลงทะเบียน walk-in
  - API ภายนอก (EXT bookings)
- **FR-3:** ช่องที่เดิมเว้นได้ยังเว้นได้ เช่นเบอร์ผู้อพยพ "ไม่มี" → `null`
- **FR-4 ช่องค้นหาด้วยเบอร์ที่ใช้ FR-1:**
  - จิตอาสา: ค้นหาตั๋ว, เข้า portal
  - kiosk: เช็คอิน, พิมพ์บัตรซ้ำ, บัตรจิตอาสา
  - ค้นหาครอบครัวใน public portal
  - FastAPI search
- **FR-5 บัญชีผู้ใช้:** `phone` เป็นมือถือ 10 หลักหรือ `null` ห้ามซ้ำข้ามบัญชี และห้ามชน `name` ของบัญชีอื่น (CR-105) ใช้ login และกู้รหัสได้
- **FR-6 ข้อความ error:** ใช้ข้อความเดียวกันทั้งระบบ "เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0" (`THAI_MOBILE_PHONE_MESSAGE` ของ #981) ส่วน API ภายนอกใช้รูปแบบ error เดิมของ API

### B. จิตอาสา (#951, #882)

- **FR-7 walk-in และแก้ไขโปรไฟล์จิตอาสา:**
  - เว้นเบอร์ได้ เก็บเป็น `phone: null`, `phone_hash: null`
  - ถ้ากรอกต้องผ่าน FR-1 ห้ามข้อความอย่าง "ไม่มี" หรือ "-"
  - แก้เบอร์แล้วคำนวณ `phone_hash` ใหม่
- **FR-8 โปรไฟล์ที่ `phone` ไม่ผ่าน FR-1:**
  - แสดงป้าย "เบอร์ไม่ใช่มือถือ 10 หลัก" บนการ์ดในแท็บรายชื่อจิตอาสา
  - dialog "ออกสิทธิ์ใช้งานระบบ" ไม่ให้บันทึก และบอกให้แก้เบอร์ก่อน
- **FR-9 จิตอาสาที่ `phone: null`:**
  - ออกสิทธิ์ได้ บัญชีได้ `phone: null` และ login ด้วยอีเมล
  - ต้องตั้งรหัสเองหรือกด "สร้างรหัส"
- **FR-10 worker inbound** (`volunteer_applications.py`): ไม่ตรวจรูปแบบเบอร์ ให้ BFF เป็นด่านตรวจเดียว และ worker ต้องไม่ทิ้งใบสมัครเอง (ตอนนี้ไม่มีอะไรเขียน buffer นี้แล้ว)
- **FR-11 (#882) สมัครแล้ว `phone_hash` ตรงกับโปรไฟล์ `status: inactive`:**
  - ใช้โปรไฟล์เดิม ไม่สร้างใหม่ และไม่เปิดใช้งานกลับอัตโนมัติ
  - ใบสมัครเป็น `pending_review` เสมอ แม้งานตั้งรับอัตโนมัติ
- **FR-12 (#882):** แท็บผู้สมัครแสดงป้าย "โปรไฟล์นี้ถูกปิดใช้งาน" คำนวณตอนแสดงผล ไม่มี field ใหม่
  - การเปิดใช้งานกลับเป็นปุ่มเดิมบนการ์ด ทำได้โดย `system_admin`, `shelter_manager`, `volunteer_coordinator`

### C. ข้อมูลเดิม (ไม่ migrate)

- **FR-13:** เอกสารที่เก็บเบอร์ 9 หลักไว้แล้ว (บัญชี, ผู้อพยพ, จิตอาสา) ยังอ่านและแสดงได้ ไม่ error
- **FR-14:** เปิดฟอร์มแก้ไขเอกสารเหล่านั้นแล้วบันทึก ต้องแก้เป็นมือถือ หรือเว้นว่างถ้าช่องนั้นเว้นได้
- **FR-15:** ค้นด้วยเบอร์ 9 หลักไม่ได้แล้ว ให้ค้นด้วยชื่อ เลขบัตร หรือรหัสแทน

### spec ที่ต้องแก้เมื่อ approve

| เอกสาร                                        | ก่อน                                                         | หลัง                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| CR-202                                        | approved                                                     | superseded by CR นี้                                                                                                  |
| schema.md §6 `_users.phone`                   | มือถือ 10 หลักหรือเบอร์บ้าน 9 หลัก (CR-202)                  | มือถือ 10 หลักหรือ `null`; unique ข้ามบัญชี (CR-105)                                                                  |
| schema.md §2.8 `volunteer.phone`              | เบอร์ติดต่อและระบุตัวตน; public apply ต้องมีค่า              | มือถือ 10 หลัก; public apply ต้องมีค่า; walk-in / staff entry เว้นได้ (`null`); เอกสารเดิม 9 หลักต้องแก้ก่อนออกสิทธิ์ |
| schema.md evacuee `phone`                     | normalize เป็นตัวเลขล้วน                                     | เพิ่ม "มือถือ 10 หลัก (CR นี้)"                                                                                       |
| CR-148 FR-11                                  | ค้นหาครอบครัว 9–10 หลัก                                      | 10 หลัก                                                                                                               |
| CR-151 FR-KPC-51, FR-KPC-53, E-14             | kiosk 9–10 หลัก / รองรับเบอร์บ้าน / server ตรวจ `^0\d{8,9}$` | 10 หลัก / server ตรวจ `^0\d{9}$`                                                                                      |
| CR-173 FR-1 (#1001)                           | มือถือ 10 หลักหรือเบอร์บ้าน 9 หลัก                           | 10 หลัก                                                                                                               |
| schema.md §2.3 `donation.donor.phone` (#1001) | ไม่ระบุรูปแบบ                                                | มือถือ 10 หลักหรือ `null`                                                                                             |
| CR-154 FR-12, CR-169 FR-2                     | partner `phone` 9–10 หลัก                                    | 10 หลัก                                                                                                               |

## Acceptance

- **AC-1:** ทุกจุดใน FR-2 / FR-4 ปฏิเสธ `022222222` และ `02-222-2222` ส่วน `081-234-5678`, `081.234.5678` และ `+66812345678` ผ่าน เก็บเป็น `0812345678` และได้ `phone_hash` เดียวกัน
- **AC-2:** walk-in จิตอาสาเว้นเบอร์ได้ (`null`) แต่ "ไม่มี" ไม่ผ่าน ผู้อพยพที่ไม่มีเบอร์ยังลงทะเบียนได้
- **AC-3:** โปรไฟล์จิตอาสาเบอร์ 9 หลักเดิมมีป้ายเตือนและออกสิทธิ์ไม่ได้ แก้เป็นมือถือแล้วออกสิทธิ์ได้ และ `phone_hash` เปลี่ยนตาม
- **AC-4:** จิตอาสาที่ไม่มีเบอร์ออกสิทธิ์ได้ บัญชีไม่มีเบอร์
- **AC-5:** ฟอร์มผู้ใช้และ `/me` ไม่รับเบอร์บ้าน และมือถือยังห้ามซ้ำ
- **AC-6:** API ภายนอกตอบ validation error สำหรับเบอร์ 9 หลัก
- **AC-7 (#882):** สมัครด้วยเบอร์ของโปรไฟล์ที่ถูกปิดใช้งาน ได้ `pending_review` บนโปรไฟล์เดิม มีป้าย และโปรไฟล์ยัง `inactive`
- **AC-8:** เอกสารเดิมที่มีเบอร์ 9 หลักยังเปิดดูได้ แต่บันทึกฟอร์มแล้วต้องแก้เบอร์ก่อน

## Impact

- **code:**
  - ส่วนจิตอาสา (A + B) implement แล้วใน PR #984 (#951, #882)
  - ส่วนที่เหลือ implement ใน #991 หลัง CR นี้ approve และ #984 merge
  - ฝั่งบริจาค นำเข้า Excel และ `emergency_contact.phone` ติดตาม spec ใน #1001 (walk-in donor แก้โค้ดใน #981)
- **test:**
  - frontend unit test ทุก schema/route ที่แก้
  - backend `backend/tests/` (search_query, thirdparty_bookings)
- **ภายนอก:** แจ้งพาร์ทเนอร์ที่ใช้ API EXT bookings แล้ว (Team Lead ยืนยันใน PR #994 2026-10-28)
- **ข้อมูลเดิม:** ค้นด้วยเบอร์ 9 หลักไม่ได้ เจ้าหน้าที่ต้องแก้เบอร์เมื่อเจอ
- **โปรไฟล์ซ้ำ:** คนที่เคยลงเบอร์บ้านแล้วสมัครใหม่ด้วยมือถือจะได้โปรไฟล์ใหม่ เพราะ `phone_hash` ต่างกัน (เกี่ยวกับ #694)

## Migration

ไม่มี ไม่แก้เอกสารเดิมและไม่ bump `schema_v` (FR-13 ถึง FR-15)

## Decision log

- 2026-10-26 — @net-lynx ตอบ #880 ทาง A (รับเบอร์บ้าน 9 หลัก) และตอบ #882
- 2026-10-27 — CR-202 approved: บัญชีผู้ใช้เก็บเบอร์บ้านได้ (PM + review PR #890)
- 2026-10-27 — @net-lynx เปลี่ยน #880 เป็นทาง B ผู้รับงานตัดสินรายละเอียดของจิตอาสา:
  - ช่องค้นหาบังคับ 10 หลัก
  - walk-in เว้นเบอร์ได้
  - ข้อมูลเดิมให้แก้ก่อนออกสิทธิ์
  - ไม่มีเบอร์ออกสิทธิ์ได้
- 2026-10-28 — @net-lynx สั่งเลิกรับเบอร์บ้าน 9 หลักทั้งระบบ ผู้รับงานยืนยันขอบเขตทั้งระบบและไม่ migrate
- 2026-10-28 — รวม `draft-volunteer-mobile-phone` (#951) เข้า CR นี้
- 2026-10-28 — proposed ใน PR #994
- 2026-10-28 — Soravit Sukkarn (Team Lead) ใน PR #981: เบอร์ผู้บริจาค walk-in ใช้มือถือ 10 หลัก (`thaiMobilePhoneSchema`)
- 2026-10-28 — Soravit Sukkarn (Team Lead) ตัดสินใน review PR #994:
  - กฎกลางฝั่ง frontend คือ `thaiMobilePhoneSchema` + `normalizeThaiPhone` ใน `lib/db/model.ts` ให้ `volunteer-phone.ts` re-export หรือลบ (FR-1)
  - ฝั่งบริจาคอยู่ในขอบเขต "ทั้งระบบ" ติดตาม spec ใน #1001 (FR-2)
  - `emergency_contact.phone` และนำเข้า Excel ใช้ FR-1 เว้นว่างได้ (FR-2)
  - แจ้งพาร์ทเนอร์ API EXT bookings แล้ว (Impact)
- 2026-10-29 — approved by Soravit Sukkarn (Team Lead) · รันเลข CR-210 (renumbered from draft-mobile-phone-only) ย้ายเข้า 01-core/
