---
id: CR-239 # renumbered from draft-volunteer-phone-unique
title: เบอร์โทรจิตอาสาไม่ซ้ำภายในศูนย์ — กันตอนเจ้าหน้าที่เพิ่ม / แก้เบอร์ และล้างโปรไฟล์ซ้ำที่มีอยู่
status: approved
date: 2026-11-06
updated: 2026-11-08 # approved (Soravit Sukkarn, Team Lead)
requested_by: "#694 (@Mhapong)"
decided_by: "Soravit Sukkarn (Team Lead)"
decision_date: 2026-11-08
layer: volatile
affects:
  - docs/data/schema.md §2.8 `volunteer` (เพิ่มกฎ "เบอร์ไม่ซ้ำต่อศูนย์" ในหมายเหตุ `phone` / `phone_hash` · บันทึก `merged_into?`, `merged_at?`, `merged_by?`, `migration_run_id?` ที่ `migrate-volunteer-reapply` เขียนอยู่แล้ว · ไม่ bump `schema_v` — ดู Q6)
  - frontend/src/lib/features/volunteers/domain (error `VolunteerPhoneTakenError` · Zod `volunteerSchema` รับ field `merged_*` · export ผ่าน `index.ts`)
  - frontend/src/lib/features/volunteers/data (`volunteer.repository.ts`: `getByPhoneHash` → `listByPhoneHash` · `volunteer.remote.ts`: `create()` / `update()` ตรวจเบอร์ซ้ำ)
  - frontend/src/lib/features/volunteers/ui (`walk-in-registration-dialog.svelte`, `volunteer-manage-dialog.svelte`: แสดงโปรไฟล์เดิมเมื่อเบอร์ชน)
  - frontend/scripts/migrate-volunteer-reapply.ts (รันตามแผน FR-16 ถึง FR-19 · แก้สคริปต์เฉพาะถ้า Q5 เลือกให้ตรวจ hash ค้างในสคริปต์นี้)
  - tests: `volunteer.remote.test.ts` (create / update ชนเบอร์, `listByPhoneHash`, คง `merged_into`), `walk-in-registration-dialog.dom.test.ts` (ทางเบอร์ชน)
why: "เบอร์ซ้ำภายในศูนย์ทำให้ระบบที่ระบุจิตอาสาด้วยเบอร์ (public apply, portal, kiosk #609) เจอหลายคนแล้วต้องปฏิเสธหรือเลือกผิดคน · วันนี้กันได้เฉพาะ public apply ส่วนทางเจ้าหน้าที่ไม่กัน"
migration: "ไม่เปลี่ยนรูปร่างเอกสาร ไม่ bump schema_v · ล้างโปรไฟล์ซ้ำเดิมด้วย pnpm migrate:volunteer-reapply (dry-run ทุกศูนย์ก่อน, --write --confirm หลัง owner อนุมัติ)"
---

# CR-239 — เบอร์โทรจิตอาสาไม่ซ้ำภายในศูนย์

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ในศูนย์เดียวกัน โปรไฟล์ `volunteer` ที่ไม่มี `merged_into` ต้องมีเบอร์ไม่ซ้ำกัน (เทียบด้วย `phone_hash`) · เบอร์ว่างยังได้ · ข้ามศูนย์ยังซ้ำได้ (CR-104)
> - **เพื่อใคร / ทำไม:** ระบบที่หาจิตอาสาด้วยเบอร์ (public apply, portal, kiosk #609) ต้องเจอคนเดียว · วันนี้กันได้เฉพาะทาง public apply ส่วนทาง walk-in และการแก้เบอร์โดยเจ้าหน้าที่ยังสร้างเบอร์ซ้ำได้
> - **build:** `create()` / `update()` ใน `volunteer.remote.ts` ปฏิเสธเบอร์ที่ชน แล้วแจ้งรหัส `V-xxx` ของโปรไฟล์เดิมพร้อมปุ่มเปิด · `getByPhoneHash` → `listByPhoneHash` คืนทุกโปรไฟล์ที่ตรง · Zod เก็บตรา `merged_*` ไว้ · ล้างโปรไฟล์ซ้ำเดิมด้วย `pnpm migrate:volunteer-reapply` (dry-run ก่อน, เขียนจริงหลัง owner อนุมัติ)
> - **schema / layer:** ไม่ bump `schema_v` · `layer: volatile` (business rule ใหม่ ไม่แตะ `_id` pattern / VDU / auth)

---

## Why

- **เบอร์ซ้ำทำให้ระบุตัวไม่ได้:** public apply ตอบ `AMBIGUOUS_VOLUNTEER` (409) และ kiosk ไม่พิมพ์บัตรเมื่อเจอหลายคน (`kiosk-volunteer-card.server.ts:64-68`) — จิตอาสาคนนั้นใช้สองทางนี้ไม่ได้จนกว่าเจ้าหน้าที่จะล้างข้อมูล
- **ทางเจ้าหน้าที่ไม่มี guard:** `create()` (`volunteer.remote.ts:105-119`) และ `update()` (`:121-127`) ไม่ตรวจเบอร์ซ้ำ · `getByPhoneHash` (`:97-103`) ไม่มีผู้เรียกนอก test และใช้ `limit: 1` จึงคืนคนแรกโดยไม่บอกว่ามีหลายคน
- **CouchDB บังคับ unique ให้ไม่ได้:** unique ได้แค่ `_id` (`volunteer:<ulid>`) · `validate_doc_update` เห็นแค่ `newDoc` / `oldDoc` / `userCtx` / `secObj` ค้นเอกสารอื่นไม่ได้ และสำหรับ `volunteer` ตรวจแค่ type อยู่ใน whitelist (`shelter-access-design.ts:603-615`) → ต้องบังคับที่ repository
- **นับรวมโปรไฟล์ `inactive` (FR-2):** public apply นับ `inactive` เป็นโปรไฟล์เดิม (`matchingVolunteers`, `public-application.ts:140-151` กรองออกแค่ `merged_into`) — ถ้าเจ้าหน้าที่สร้างโปรไฟล์ใหม่ทับเบอร์ของคนที่ถูกปิดใช้งาน public apply ครั้งต่อไปจะได้ `AMBIGUOUS_VOLUNTEER` · ทางที่ถูกคือเปิดใช้งานโปรไฟล์เดิม (#882)
- **คืนเป็น list (FR-5):** การตรวจเบอร์ซ้ำต้องเห็นทุกโปรไฟล์ที่ตรงเพื่อตัดตัวเองออก (ตอน `update`) และบอกเจ้าหน้าที่ว่าชนกับใคร · ผู้เรียกที่ต้องการคนเดียวตัดสินเองแบบที่ public apply และ kiosk ทำอยู่แล้ว · throw ตอนเจอหลายคนทำให้ผู้เรียกที่ต้องการรายชื่อต้องเขียน query แยก
- **ตรวจตอน `update` เฉพาะเมื่อเบอร์เปลี่ยน (FR-8):** ก่อนล้างข้อมูล (FR-16 ถึง FR-19) ยังมีคู่ที่ซ้ำอยู่ · ถ้าตรวจทุกครั้ง เจ้าหน้าที่จะแก้ชื่อหรือทักษะของโปรไฟล์เหล่านี้ไม่ได้
- **ตรา `merged_*` หายตอนแก้ไข (FR-6):** `volunteerSchema` เป็น `z.object` ที่ตัด key ที่ไม่รู้จักทิ้ง และ `save()` (`volunteer.remote.ts:52-54`) parse ก่อนเขียนทุกครั้ง → เจ้าหน้าที่แก้โปรไฟล์ที่ถูก merge แล้ว `merged_into` หาย โปรไฟล์นั้นจะกลับมานับเป็นเบอร์ซ้ำ
- **ไม่ทำ lock ใน CR นี้ (FR-14):** lock ที่ `_id` มาจาก `phone_hash` = เปลี่ยน `_id` pattern = stable core ต้องคุยแยก (#694 §สิ่งที่ต้องการ)
- **#693 แก้แล้ว:** `update()` คำนวณ `phone_hash` ใหม่ทุกครั้งตั้งแต่ #708 (2026-10-20, `volunteer.remote.ts:125`) — กฎของ CR นี้พึ่ง `phone_hash` ที่ตรงกับ `phone` · โปรไฟล์ที่ถูกแก้เบอร์ก่อน #708 อาจยังมี hash ค้าง (FR-17)

## Change

### กฎ

- **FR-1 เบอร์ไม่ซ้ำต่อศูนย์:** ใน DB `shelter_{code}` เดียวกัน โปรไฟล์ `volunteer` ที่ไม่มี `merged_into` มี `phone_hash` ซ้ำกันไม่ได้
  - เทียบด้วย `phone_hash` = `sha256(normalizeThaiPhone(phone))` (`phoneHashOf`, `volunteer.remote.ts:22-26`) → `081-234-5678`, `0812345678`, `+66812345678` นับเป็นเบอร์เดียวกัน
- **FR-2 นับ `inactive`:** โปรไฟล์ `status: inactive` ที่ไม่มี `merged_into` นับในกฎ FR-1 (เหตุผลใน Why · Q1)
- **FR-3 เบอร์ว่าง:** `phone: null` (`phone_hash: null`) ไม่อยู่ในกฎ — หลายโปรไฟล์ไม่มีเบอร์ได้ (walk-in / staff entry เว้นเบอร์ได้ตาม schema §2.8)
- **FR-4 ข้ามศูนย์:** เบอร์เดียวกันในศูนย์อื่นไม่นับ — ตรวจเฉพาะ DB ศูนย์ที่กำลังเขียน (CR-104)

### repository (`volunteers/data`)

- **FR-5 `listByPhoneHash`:** แทน `getByPhoneHash(phoneHash): Promise<Volunteer | null>` ด้วย `listByPhoneHash(phoneHash): Promise<Volunteer[]>`
  - คืนทุกโปรไฟล์ `type: volunteer` ที่ `phone_hash` ตรง และไม่มี `merged_into` · `limit: 100` (เท่า `matchingVolunteers`) · ใช้ index `volunteer-type-phone-hash-idx` (`volunteer.repository.ts:100`)
  - ลบ `getByPhoneHash` ออกจาก interface และ implementation (ไม่มีผู้เรียกนอก test)
- **FR-6 Zod เก็บตรา merge:** `volunteerSchema` รับ `merged_into?: str`, `merged_at?: ts`, `merged_by?: str`, `migration_run_id?: str` → `update()` / `deactivate()` / `reactivate()` / review ไม่ลบตราเหล่านี้
- **FR-7 `create()`:** เมื่อ `phone_hash` ไม่เป็น `null` เรียก `listByPhoneHash` ก่อนสร้าง · พบอย่างน้อย 1 โปรไฟล์ → throw `VolunteerPhoneTakenError` และไม่เขียนเอกสาร
- **FR-8 `update()`:** ตรวจเฉพาะเมื่อ `phone_hash` ใหม่ไม่เป็น `null` **และ**ต่างจาก `phone_hash` ของ `latest` ที่อ่านมาใน `update()` · ตัดโปรไฟล์ที่กำลังแก้ (`_id` เดียวกัน) ออก · ยังพบโปรไฟล์อื่น → throw `VolunteerPhoneTakenError` และไม่เขียน
- **FR-9 error:** `VolunteerPhoneTakenError` อยู่ใน `volunteers/domain` (ไม่มี I/O) export ผ่าน barrel
  - `existing: { _id, volunteer_code, first_name, last_name, status }[]` · เรียงตาม `volunteer_code`
  - `message`: `เบอร์นี้มีอยู่แล้วในศูนย์: V-012 สมชาย ใจดี` · หลายคนคั่นด้วย `, ` · โปรไฟล์ `inactive` ต่อท้าย ` (ปิดใช้งานอยู่)`

### UI

- **FR-10 walk-in:** `walk-in-registration-dialog.svelte` จับ `VolunteerPhoneTakenError` จาก `useCreateWalkInVolunteer`
  - แสดงข้อความ FR-9 ที่ช่อง "เบอร์" (`setError`) และ toast error · ข้อมูลที่กรอกยังอยู่
  - แสดงปุ่ม "เปิดโปรไฟล์ V-012" ต่อโปรไฟล์ใน `existing` → เปิด `volunteer-manage-dialog.svelte` ของโปรไฟล์นั้น (ทางเลือกอื่นดู Q2)
  - ไม่มอบหมายกะ / ไม่ check-in (การสร้างล้มเหลวก่อนขั้นตอนเหล่านี้ตามลำดับเดิมของ dialog)
- **FR-11 แก้เบอร์:** `volunteer-manage-dialog.svelte` จับ `VolunteerPhoneTakenError` จาก `useUpdateVolunteer` → toast error ข้อความ FR-9 + ปุ่มเปิดโปรไฟล์เดิมแบบ FR-10 · dialog ยังเปิดอยู่ ไม่มีอะไรถูกบันทึก
- **FR-12 โปรไฟล์เดิมปิดใช้งาน:** เมื่อโปรไฟล์ที่ชน `inactive` ข้อความบอกให้เปิดใช้งานโปรไฟล์เดิม (`useReactivateVolunteer`, #882) แทนการสร้างใหม่

### public apply

- **FR-13 คงเดิม:** ไม่เปลี่ยน guard ของ public apply
  - `preflightPublicVolunteerApplication` (`public-application.ts:499`) พบมากกว่า 1 → `match: ambiguous_match` (`:521-526`)
  - `applyPublicVolunteerApplication` (`:561`) พบมากกว่า 1 → `AMBIGUOUS_VOLUNTEER` 409 (`:595-596`) · พบ 1 → ใช้โปรไฟล์เดิม
  - ทั้งสองทางใช้ `matchingVolunteers` ที่ไม่นับ `merged_into` · ทางนี้เขียนผ่าน `putAsPublicWriter` ไม่ผ่าน repository จึงไม่อยู่ใต้ FR-7
- **FR-14 race ที่ยอมรับ:** ทั้ง public apply และ FR-7 / FR-8 เป็น check-then-write — สอง request ที่มาพร้อมกันด้วยเบอร์ใหม่เบอร์เดียวกันยังสร้างได้สองโปรไฟล์ · CR นี้ยอมรับความเสี่ยงนี้ (Q4)
  - เมื่อเกิด: public apply ครั้งต่อไปได้ `AMBIGUOUS_VOLUNTEER` · kiosk ปฏิเสธ · dry-run ของ FR-16 พบกลุ่มนั้น แล้วล้างตาม FR-18
  - ถ้า dry-run หลังใช้งานกฎนี้ยังพบกลุ่มใหม่ → เปิด issue แยกสำหรับ lock (stable core, ต้อง review)

### บังคับที่ไหน

- **FR-15 จุดบังคับ:** repository (FR-7, FR-8) เป็นจุดบังคับของการเขียนจากเจ้าหน้าที่ทั้งหมด · UI (FR-10, FR-11) แสดงผล · `validate_doc_update` **ไม่**บังคับ (ค้นเอกสารอื่นไม่ได้ — Why)
  - การเขียนที่ไม่ผ่าน repository ไม่อยู่ใต้กฎนี้: public apply (มี guard ของตัวเอง FR-13), สคริปต์ที่ใช้ admin credential, การแก้ใน Fauxton

### ล้างโปรไฟล์ซ้ำที่มีอยู่

- **FR-16 dry-run ทุกศูนย์:** ในแต่ละ environment (staging, production — Q7) รัน `SHELTER_DB=shelter_<code> pnpm migrate:volunteer-reapply` ครั้งละ 1 ศูนย์ ให้ครบทุกศูนย์ใน `registry` · สรุปลง #694 เป็นตารางต่อศูนย์: จำนวนกลุ่มซ้ำ, `auto_merge`, `manual_review` พร้อมเหตุผล (`conflicts`)
- **FR-17 hash ค้าง:** รายงานของ FR-16 ต้องมีจำนวนโปรไฟล์ต่อศูนย์ที่ `phone_hash` ≠ `sha256(normalizeThaiPhone(phone))` (แก้เบอร์ก่อน #708) — สคริปต์จัดกลุ่มด้วย `phone_hash` ที่เก็บไว้จึงไม่เห็นคู่ซ้ำเหล่านี้ และ FR-7 / FR-8 ก็ไม่เห็น · วิธีแก้ hash ค้างดู Q5
- **FR-18 เขียนจริงหลังอนุมัติ:** รัน `--write --confirm` ต่อศูนย์ / environment ที่ owner อนุมัติเท่านั้น · สคริปต์ merge เฉพาะกลุ่ม `auto_merge` · กลุ่ม `manual_review` ไม่ถูกแตะ (การจัดการดู Q3)
- **FR-19 ตรวจหลังเขียน:** หลัง `--write` รัน dry-run ซ้ำในศูนย์เดิม → ต้องไม่เหลือกลุ่ม `auto_merge` (สคริปต์ไม่ตรวจผลของ `PUT` แต่ละครั้ง)

## Acceptance

- [ ] **AC-1:** walk-in ด้วยเบอร์ที่มีโปรไฟล์อยู่แล้วในศูนย์ (รวมรูปแบบต่าง เช่น `+66…` / มีขีด) → ถูกปฏิเสธ ข้อความมี `volunteer_code` + ชื่อของโปรไฟล์เดิม มีปุ่มเปิดโปรไฟล์เดิม ไม่มีเอกสาร `volunteer` ใหม่ (FR-1, FR-7, FR-9, FR-10)
- [ ] **AC-2:** walk-in โดยไม่กรอกเบอร์ → สร้างได้แม้มีโปรไฟล์อื่นที่ไม่มีเบอร์ (FR-3)
- [ ] **AC-3:** เบอร์ชนกับโปรไฟล์ `inactive` → ถูกปฏิเสธ ข้อความมี "(ปิดใช้งานอยู่)" และแนะนำให้เปิดใช้งานโปรไฟล์เดิม (FR-2, FR-12)
- [ ] **AC-4:** เบอร์ตรงกับโปรไฟล์ที่มี `merged_into` เท่านั้น → สร้างได้ (FR-1, FR-5)
- [ ] **AC-5:** แก้เบอร์ให้ชนกับโปรไฟล์อื่น → ถูกปฏิเสธ ไม่มีอะไรถูกบันทึก · บันทึกโดยเบอร์เดิมของตัวเอง → ผ่าน · แก้ชื่อของโปรไฟล์ที่ซ้ำอยู่แล้วโดยไม่แตะเบอร์ → ผ่าน (FR-8, FR-11)
- [ ] **AC-6:** มี 2 โปรไฟล์ `phone_hash` เดียวกัน → `listByPhoneHash` คืนทั้งสอง · โปรไฟล์ที่มี `merged_into` ไม่อยู่ในผล · `getByPhoneHash` ไม่มีแล้ว (FR-5)
- [ ] **AC-7:** เจ้าหน้าที่แก้โปรไฟล์ที่มี `merged_into` → หลังบันทึก `merged_into`, `merged_at`, `merged_by`, `migration_run_id` ยังอยู่ (FR-6)
- [ ] **AC-8:** เบอร์เดียวกันในอีกศูนย์ → สร้างได้ (FR-4)
- [ ] **AC-9:** public apply: test เดิมของ `ambiguous_match` / `AMBIGUOUS_VOLUNTEER` ผ่านโดยไม่แก้ (FR-13)
- [ ] **AC-10:** รายงาน dry-run ต่อศูนย์ของ staging และ production (รวมจำนวน hash ค้าง) อยู่ใน #694 · `--write` รันเฉพาะที่ owner อนุมัติ · dry-run หลังเขียนไม่เหลือ `auto_merge` (FR-16 ถึง FR-19)
- [ ] **AC-11:** unit test ใน `volunteer.remote.test.ts` ครอบ FR-5 ถึง FR-8 · DOM test ของ walk-in dialog ครอบทางเบอร์ชน · ไฟล์ `.svelte` ที่แก้ผ่าน `svelte-autofixer`

## คำถามถึง owner

- **Q1 นับ `inactive`:** โปรไฟล์ที่ปิดใช้งาน (ไม่มี `merged_into`) นับในกฎเบอร์ไม่ซ้ำหรือไม่ · **ข้อเสนอ:** นับ (FR-2) ให้ตรงกับ public apply ที่นับอยู่แล้ว
- **Q2 ปุ่มเมื่อเบอร์ชนใน walk-in:** "เปิดโปรไฟล์เดิม" (เปิด dialog จัดการข้อมูล) หรือ "ใช้โปรไฟล์เดิม" (มอบหมายกะ / check-in ที่เลือกไว้ให้โปรไฟล์เดิมแทน) · **ข้อเสนอ:** เปิดโปรไฟล์เดิมใน CR นี้ "ใช้โปรไฟล์เดิม" เป็น follow-up
- **Q3 กลุ่ม `manual_review`:** ใครจัดการ (VC / SM ของศูนย์นั้น?) และด้วยวิธีใด · **ข้อเสนอ:** ส่งรายการให้ SM ของแต่ละศูนย์ตัดสินด้วยมือ ไม่สร้างเครื่องมือใน CR นี้
- **Q4 race:** ยอมรับ race ของ FR-14 แล้วพึ่ง dry-run เป็นระยะ หรือเปิด issue lock ตอนนี้ · **ข้อเสนอ:** ยอมรับ เปิด issue เมื่อพบกลุ่มใหม่หลังใช้งาน
- **Q5 hash ค้างจากก่อน #708:** แก้อย่างไร — (ก) เพิ่มขั้นคำนวณ `phone_hash` ใหม่ในสคริปต์นี้ (dry-run / `--write --confirm` เหมือนเดิม) (ข) สคริปต์ backfill แยก (ค) ไม่แก้ · **ข้อเสนอ:** (ข) รันก่อน FR-18 ภายใต้การอนุมัติเดียวกัน
- **Q6 field `merged_*` ใน schema.md:** บันทึก `merged_into?`, `merged_at?`, `merged_by?`, `migration_run_id?` ใน §2.8 โดยไม่ bump `schema_v` หรือไม่ · **ข้อเสนอ:** ไม่ bump — สคริปต์เขียน field เหล่านี้อยู่แล้ว เป็น optional และ Zod รับเพิ่มแบบ additive
- **Q7 ผู้รันและ environment:** รันสคริปต์ที่ staging และ production ใครเป็นคนรัน (ต้องมี `COUCHDB_ADMIN_URL`) และ production ต้องมีช่วงเวลาที่ตกลงไว้หรือไม่

## Impact

- **โค้ด:** `volunteers/domain` (error + Zod), `volunteers/data` (`listByPhoneHash`, `create`, `update`), `volunteers/ui` (2 dialog) · public apply และ kiosk ไม่เปลี่ยน
- **ประสิทธิภาพ:** `_find` 1 ครั้งต่อการสร้าง / การเปลี่ยนเบอร์ บน index `volunteer-type-phone-hash-idx`
- **edge LAN fallback:** ตอนเขียนผ่าน edge การตรวจเห็นเฉพาะเอกสารที่ replicate มาถึง edge แล้ว → อาจเกิดเบอร์ซ้ำ ซึ่ง FR-16 จะพบ
- **docs:** `docs/data/data-model.md` ไม่ต้องแก้ (แถว `volunteer` ใน §3.2 และ §6 ไม่ได้อ้างถึง uniqueness) · `schema.md` §2.8 ตาม `affects`
- **ข้อจำกัดที่รู้:** การเขียนที่ไม่ผ่าน repository ไม่ถูกตรวจ (FR-15) · race ของ FR-14 · hash ค้างจนกว่าจะแก้ตาม Q5

## Migration

- ไม่เปลี่ยนรูปร่างเอกสาร ไม่ bump `schema_v` · `merged_*` เป็น field ที่มีอยู่แล้วในข้อมูลที่ผ่านสคริปต์
- **`pnpm migrate:volunteer-reapply`** (`frontend/scripts/migrate-volunteer-reapply.ts`) — สิ่งที่สคริปต์ทำ:
  - 1 ศูนย์ต่อการรัน: `SHELTER_DB` (ค่าเริ่มต้น `shelter_sh001`) · ใช้ `COUCHDB_ADMIN_URL` จาก env หรือ `frontend/.env`
  - ค่าเริ่มต้นเป็น dry-run · `--write` ต้องมี `--confirm`
  - อ่านทั้ง DB (`_all_docs?include_docs=true`) จัดกลุ่ม `volunteer` ที่มี `phone_hash` และไม่มี `merged_into` ด้วย `shelter_code|phone_hash` (รวม `inactive`) · กลุ่มที่มีมากกว่า 1 โปรไฟล์ = กลุ่มซ้ำ
  - กลุ่มเป็น `manual_review` เมื่อมีเหตุใดเหตุหนึ่ง: ชื่อไม่ตรงกัน (`name_conflict`), `national_id_hash` ต่างกัน (`national_id_conflict`), ทักษะเดียวกันมีทั้ง `verified` และ `rejected` (`skill_conflict:<skill>`), เลือกโปรไฟล์หลักไม่ได้ (`canonical_tie`), มีกะที่ check-in แล้ว (`checked_in_assignment`) · นอกนั้น `auto_merge`
  - โปรไฟล์หลัก: ยืนยันตัวตนแล้วก่อน → ทักษะ `verified` มากกว่า → ใบสมัคร + กะงานมากกว่า → `created_at` เก่ากว่า
  - `--write` (กลุ่ม `auto_merge` เท่านั้น): รวม `skills` และ `skill_verifications` เข้าโปรไฟล์หลัก (`verified` ชนะ) · ย้าย `volunteer_id` ของ `job_application` และ `shift_assignment` ไปโปรไฟล์หลัก · โปรไฟล์อื่นได้ `merged_into`, `merged_at`, `merged_by`, `migration_run_id` และ `status: inactive` · ไม่ลบเอกสาร
  - พิมพ์รายงาน JSON: ต่อกลุ่มมี `shelter_code`, `phone_hash` 8 ตัวแรก, รายการโปรไฟล์ (`volunteer_id`, `created_at`, `identity_status`, จำนวนใบสมัคร), โปรไฟล์หลัก, `decision`, `conflicts`
  - ไม่ตรวจ hash ค้าง (FR-17) และไม่ตรวจผล `PUT` (FR-19)

## Decision log

- 2026-10-20 — #693 แก้แล้วโดย #708: `update()` คำนวณ `phone_hash` ใหม่ทุกครั้ง
- 2026-11-06 — proposed (#694) · owner เลือก track ด้วย draft CR ไฟล์นี้
- 2026-11-08 — approved โดย Soravit Sukkarn (Team Lead) — มอบหมายเลข CR-239
