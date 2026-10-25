---
title: บล็อกความยินยอม PDPA ในการลงทะเบียน (PDPA Consent Block Spec)
status: active
created: 2026-10-25
updated: 2026-10-26
tracking: decision sync note (owner เลือก 2026-10-25 — ไม่ใช้ CR ไฟล์)
source: Shelter Consent Prototype.html (การ์ด「ความยินยอมของท่าน」เท่านั้น)
affects:
  - docs/data/schema.md §1.1 (`evacuee.consent` ใหม่, evacuee schema_v 14 → 15)
  - docs/task-breakdown/11-famsearch.md T-40 (UI ของ opt-out ย้ายมาอยู่ในบล็อกนี้)
  - frontend/src/lib/features/people/ (domain schema, unified registration form, report-in)
  - frontend/src/lib/features/kiosk/ (ui/kiosk-register-consent.svelte, server/kiosk-register.server.ts)
  - frontend/src/lib/features/public-register/ (booking-form) + frontend/src/lib/features/unassigned-registration/ (claim)
  - docs/data/api-contract.md (ส่วน "ยินยอมที่ Kiosk" + payload unassigned registration)
  - backend/apiapp/modules/unassigned_registrations/ (รับ/เก็บ consent ของ public pre-register ใน Mongo)
  - frontend/src/lib/api/fastapi.json + openapi.d.ts (`pnpm openapi:update`)
  - worker/src/worker/projectors/evacuee.py (ไม่แก้ logic — ยืนยันด้วย test เท่านั้น)
---

# บล็อกความยินยอม PDPA ในการลงทะเบียน

> **สรุป (TL;DR)**
> - เพิ่มบล็อก「ความยินยอมของท่าน」ไว้ **ท้ายฟอร์มลงทะเบียน** ทุกช่องทาง (onsite, kiosk, public pre-register) ตาม prototype
> - ผู้ลงทะเบียนกดครั้งเดียว ผลบันทึกลง **ทุก evacuee ในการลงทะเบียนนั้น** เป็น `evacuee.consent` (schema_v 14 → 15)
> - ไม่ติ๊กช่องหลัก = **โหมดพื้นฐาน**: บังคับ `privacy.search_excluded=true` และไม่บันทึก `medical` ตอนลงทะเบียน. ไม่ติ๊กช่องสุขภาพ = ไม่บันทึก `medical` ตอนลงทะเบียน
> - ค้นหาญาติยังเป็น **opt-out** (K-15) โดยเปลี่ยนแค่ UI: ช่องนี้ติ๊กไว้ก่อน เอาออกได้

## 1. ขอบเขต

**อยู่ในขอบเขต**
- การ์ด「ความยินยอมของท่าน」: ช่องหลัก, ช่องสุขภาพ, ช่องค้นหาญาติ, ช่องผู้ปกครอง, ช่องเจ้าหน้าที่, notice โหมดพื้นฐาน, ปุ่มยืนยัน/ไม่ยินยอม, สรุปผล
- การเก็บผลลง CouchDB ทั้ง 3 ช่องทาง รวมถึงการพา consent ผ่านขั้น claim ของ public pre-register
- Backfill `consent` ให้ evacuee เดิม

**นอกขอบเขต**
- แท็บฉบับย่อ/ฉบับเต็ม, ปุ่มขนาดตัวอักษร และ steps header ของ prototype
- หน้าถอน/เปลี่ยนความยินยอม (prototype `Shelter Consent Withdrawal`) และประวัติแบบ append-only ซึ่งจะทำพร้อมงานถอนความยินยอม
- การแก้ระยะเวลาเก็บรักษา (ดู §10 Open issues)
- การคัดกรอง/บันทึก `medical` ที่ Station 2 (screening) — ทำต่อได้ตามฐาน vital interest (PDPA ม.26(1)) ไม่ขึ้นกับ `consent.health`

## 2. ช่องทางและตำแหน่ง

| ช่องทาง | หน้า | ตำแหน่งบล็อก | ช่องผู้ปกครอง | ช่องเจ้าหน้าที่ |
| --- | --- | --- | --- | --- |
| Onsite (Station 1) | `(protected)/onsite/people/new` | ท้ายฟอร์ม ก่อนปุ่มบันทึก | แสดง | แสดง |
| Onsite report-in | `onsite/people/[id]/report-in`, `onsite/unassigned/[id]/report-in` | ท้ายฟอร์ม เฉพาะเมื่อ evacuee ยังไม่มี `consent` (FR-41) | แสดง | แสดง |
| Kiosk walk-in | `kiosk/register/consent` (แทนหน้า consent เดิม) | หน้า consent ของ flow kiosk | ซ่อน (kiosk ลงทะเบียนทีละคน) | ซ่อน |
| Public pre-register | `(public)/pre-register` (`booking-form`) | ท้ายฟอร์ม ก่อนปุ่มยืนยัน | แสดง | ซ่อน |

- **FR-01** — ทุกช่องทางในตารางต้องใช้ component บล็อกเดียวกัน โดยเปิด/ปิดช่องผู้ปกครองและช่องเจ้าหน้าที่ผ่าน props
- **FR-02** — หน้า consent ของ kiosk ต้องแสดงบล็อกนี้แทนข้อความยินยอมเดิมใน `kiosk-register-consent.svelte`. ข้อความว่าจะอ่านข้อมูลอะไรจากบัตร/ThaiD ให้คงไว้เหนือบล็อก

## 3. ช่องในบล็อกและพฤติกรรม UI

ข้อความทุกช่องใช้ตาม prototype (owner ยืนยัน 2026-10-25 ว่าผ่านการอนุมัติแล้ว) ยกเว้นช่องค้นหาญาติที่ปรับตาม FR-12 และข้อความ notice โหมดพื้นฐานที่ปรับตาม D16. เก็บข้อความทั้งหมดไว้ในไฟล์ i18n ไฟล์เดียว

| # | ช่อง | tag | ค่าเริ่มต้น | เงื่อนไขแสดง |
| --- | --- | --- | --- | --- |
| C1 | ยินยอมบริการเต็มรูปแบบ (ช่องหลัก) | บริการเต็มรูปแบบ | ไม่ติ๊ก | ทุกช่องทาง |
| C2 | ยินยอมโดยชัดแจ้งเรื่องข้อมูลสุขภาพ | ข้อมูลอ่อนไหว | ไม่ติ๊ก | ทุกช่องทาง |
| C3 | ยินยอมให้แสดงชื่อและศูนย์ในระบบค้นหาญาติ | **เอาออกได้** (แทน「ไม่บังคับ」) | **ติ๊ก** (คนใหม่) / `!privacy.search_excluded` (คนที่มี doc แล้ว) | ทุกช่องทาง |
| C4 | เป็นผู้ปกครอง/ผู้ดูแล ให้ความยินยอมแทน | ถ้ามี | ไม่ติ๊ก | onsite, public |
| C5 | เจ้าหน้าที่อ่านให้ฟังและบันทึกตามวาจา | สำหรับเจ้าหน้าที่ | ไม่ติ๊ก | onsite เท่านั้น |

- **FR-10** — C1–C5 เป็น checkbox อิสระ ติ๊กแต่ละข้อได้โดยไม่ขึ้นกับข้ออื่น
- **FR-11** — เมื่อ C1 ไม่ติ๊ก ระบบต้องบันทึก C2 และ C3 เป็น "ไม่ยินยอม" ไม่ว่าช่องจะติ๊กอยู่หรือไม่ (ตาม `finish('basic')` ของ prototype)
- **FR-12** — C3 ใช้ข้อความเดิมของ prototype. คนใหม่: ติ๊กไว้ตั้งแต่ต้น. evacuee ที่มี doc อยู่แล้ว (report-in, claim): ค่าเริ่มต้น = `!privacy.search_excluded` ของคนนั้น — ห้ามดึงคนที่ opt-out ไว้แล้วกลับเข้าการค้นหาโดยไม่ได้ตั้งใจ (T-40). เอาติ๊กออก = ขอไม่แสดงในระบบค้นหาญาติ
- **FR-13** — เมื่อติ๊ก C4 ให้แสดงรายการสมาชิกที่กรอกไว้ในฟอร์ม (ไม่รวมผู้ลงทะเบียน) เป็น checkbox รายคน ไม่ติ๊กไว้ก่อน (รวมสมาชิกที่เป็นผู้เยาว์) ให้ผู้ลงทะเบียนเลือกเอง. ห้ามใช้ช่องพิมพ์ชื่อแบบ free text
- **FR-14** — ถ้าติ๊ก C4 แต่ไม่ได้เลือกสมาชิกเลย ให้ปิดปุ่มยืนยันและแสดงข้อความให้เลือกอย่างน้อย 1 คน
- **FR-15** — เมื่อติ๊ก C5 ให้แสดงชื่อและรหัสผู้ใช้ของเจ้าหน้าที่ที่ login อยู่ (จาก `authStore`) แบบอ่านอย่างเดียว ห้ามพิมพ์แก้
- **FR-16** — ถ้ามีข้อมูลที่จะไปลง `medical` (โรคประจำตัว/แพ้/ยา/หมายเหตุสุขภาพ) กรอกค้างในฟอร์ม แต่ C2 ไม่ติ๊กหรือ C1 ไม่ติ๊ก บล็อกต้องแสดงคำเตือน「ข้อมูลสุขภาพที่กรอกไว้จะไม่ถูกบันทึก」 ก่อนกดยืนยัน
- **FR-17** — กด「ยืนยัน」ขณะ C1 ไม่ติ๊ก หรือกด「ไม่ยินยอม」 → ซ่อนปุ่มหลัก แล้วแสดง notice โหมดพื้นฐาน (ข้อความตาม D16) พร้อมปุ่ม「ลงทะเบียนแบบพื้นฐาน」และ「กลับไปเลือกความยินยอม」. focus ไปที่ปุ่ม「ลงทะเบียนแบบพื้นฐาน」
- **FR-18** — ติ๊ก C1 ขณะ notice แสดงอยู่ หรือกด「กลับไปเลือกความยินยอม」 → ซ่อน notice แสดงปุ่มหลักกลับมา (กดปุ่มกลับแล้วให้ focus ไปที่ C1)
- **FR-19** — ปุ่มยืนยันของบล็อกคือปุ่ม submit ของฟอร์มลงทะเบียนนั้น ไม่มีขั้นยืนยันแยก. การบันทึก consent กับการบันทึกการลงทะเบียนต้องสำเร็จหรือล้มเหลวไปด้วยกัน
- **FR-20** — หลังบันทึกสำเร็จ หน้าผลลัพธ์/หน้าสำเร็จของแต่ละช่องทางต้องแสดงสรุปตามตาราง §5. kiosk แสดงเฉพาะเลขอ้างอิงและโหมด
- **FR-21** — label ทุกช่องคลิกได้ทั้งแถว, checkbox มี `focus-visible` และ notice ใช้ `role="alert"` ตาม prototype. ใช้ component จาก `$lib/components/ui` และ token ของ civic-design-system ไม่ copy CSS จาก prototype

## 4. รูปข้อมูล — `evacuee.consent` (schema_v 14 → 15)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `consent` | object | opt | ไม่มี = ยังไม่ได้บันทึก (หลัง backfill ไม่ควรเหลือ) |
| `consent.mode` | enum(`full`,`basic`) | req | `basic` เมื่อ C1 ไม่ติ๊ก |
| `consent.health` | bool | req | `false` เสมอเมื่อ `mode = basic` |
| `consent.ref` | str | req | `CS-` + 8 ตัวท้ายของ ULID ใหม่ที่สร้างตอนกดยืนยัน (Crockford base32 ตัวพิมพ์ใหญ่) เช่น `CS-7K3QZ9MD` — 1 ค่าต่อการลงทะเบียน สมาชิกทุกคนใช้ค่าเดียวกัน |
| `consent.given_at` | ts (ISO 8601) | req | เวลาที่กดยืนยันฝั่ง client. แสดงผลเป็น พ.ศ. + `น.` เท่านั้น |
| `consent.given_by` | enum(`self`,`guardian`,`household_member`,`backfill`) | req | `self` = ผู้ลงทะเบียน; `guardian` = สมาชิกที่ถูกเลือกใน C4; `household_member` = สมาชิกผู้ใหญ่คนอื่นที่ผู้ลงทะเบียนให้แทน; `backfill` = FR-50 |
| `consent.giver_evacuee_id` | str\|null | req | evacuee id ของผู้ลงทะเบียน; `null` เมื่อ `given_by = self` หรือ `backfill` |
| `consent.recorded_verbally_by` | str\|null | req | user id ของเจ้าหน้าที่เมื่อติ๊ก C5; อื่น ๆ `null` |
| `consent.channel` | enum(`staff`,`kiosk`,`web`,`backfill`) | req | ช่องทางที่บันทึก |
| `consent.notice_version` | str | req | เวอร์ชันข้อความ consent ที่แสดงตอนยินยอม (ค่าคงที่ในไฟล์ i18n เริ่ม `2026-10-25`) |

- **FR-30** — ช่องค้นหาญาติไม่มี field ใน `consent`. C3 เขียนลง `privacy.search_excluded` เดิม: C3 ติ๊ก → `false`, ไม่ติ๊ก → `true`
- **FR-31** — `mode = basic` → ต้องเขียน `privacy.search_excluded = true` เสมอ
- **FR-32** — `consent.health = false` → การบันทึกลงทะเบียนครั้งนี้ห้ามสร้างหรืออัปเดต `medical` doc ของ evacuee คนนั้น. ข้อมูล `medical` ในฟอร์มถูกทิ้ง. `vulnerable_groups`, `disability_other_detail`, `special_needs` และอาการ EWAR บันทึกตามปกติ. กฎนี้ใช้เฉพาะ save ของฟอร์มลงทะเบียน ไม่ใช้กับ screening ที่ Station 2
- **FR-33** — ผู้ลงทะเบียนได้ `given_by = self`. สมาชิกที่เลือกใน C4 ได้ `guardian`. สมาชิกอื่นได้ `household_member`
- **FR-34** — ใช้ Zod schema เดียวกันทั้ง client และ server (kiosk endpoint, FastAPI unassigned registration) และให้ `validate_doc_update` ตรวจ `consent` เมื่อมี field (enum + req ตามตาราง)
- **FR-35** — เขียน `schema_v: 15` เมื่อสร้างหรือแก้ evacuee หลังเปลี่ยนนี้. evacuee ที่ไม่มี `consent` อ่านได้ตามปกติ

## 5. สรุปผลหลังบันทึก

| แถว | ค่า |
| --- | --- |
| รูปแบบการลงทะเบียน | 「บริการเต็มรูปแบบ」 / 「ช่วยเหลือขั้นพื้นฐาน」 |
| ข้อมูลทั่วไปและการประสานงาน | ยินยอม / ไม่ยินยอม (`mode`) |
| ข้อมูลสุขภาพ | ยินยอม / ไม่ยินยอม (`health`) |
| แสดงในระบบค้นหาญาติ | ยินยอม / ไม่ยินยอม (`!search_excluded`) |
| ยินยอมแทนผู้อยู่ในความดูแล | ชื่อสมาชิกที่เลือกใน C4 (แสดงเมื่อมี) |
| บันทึกโดยเจ้าหน้าที่ | ชื่อ + รหัสผู้ใช้ (แสดงเมื่อติ๊ก C5) |
| เวลาที่บันทึก | `DD/MM/YYYY(พ.ศ.) HH:mm น.` |
| เลขอ้างอิงความยินยอม | `consent.ref` (font mono) |

ข้อความท้ายสรุป:「ท่านถอนหรือเปลี่ยนความยินยอมได้ทุกเมื่อที่จุดลงทะเบียนของศูนย์」. หัวข้อ:「บันทึกความยินยอมแล้ว」 หรือ「ลงทะเบียนแบบพื้นฐานแล้ว」

## 6. ผลของโหมดและ downstream

| สถานะ | ผล |
| --- | --- |
| `mode = basic` | บันทึกฟิลด์ลงทะเบียนตามปกติ; `search_excluded = true`; ไม่มี `medical`; หายจาก public family search และ partner person search (EXT-012); ยังนับในยอด aggregate/occupancy |
| `mode = full`, `health = false` | ไม่มี `medical` จากการลงทะเบียนนี้; ส่วนอื่นปกติ |
| C3 ไม่ติ๊ก | `search_excluded = true` (พฤติกรรม opt-out เดิมของ T-40/T-41) |

- **FR-40** — การซ่อนจากการค้นหาทำผ่าน `privacy.search_excluded` และ projector เดิม (`worker/src/worker/projectors/evacuee.py` ลบ projection เมื่อ `true`). ไม่ต้องเพิ่ม filter ใหม่ และไม่ bump `PROJECTION_VERSION`. ต้องมี test ยืนยันว่า evacuee `mode = basic` ไม่ปรากฏใน `POST /public/v1/occupants`, partner person search (`thirdparty_person_search`, ผ่าน `EvacueeUseCase`) และ partner residency (`thirdparty_residency`, อ่าน `PublicPerson`). `thirdparty_occupants` เป็นยอด aggregate จาก `PublicShelter` จึงยังนับรวม
- **FR-41** — หน้า report-in แสดงบล็อกเฉพาะเมื่อมีสมาชิกที่ยังไม่มี `consent`. บล็อกบันทึกลงเฉพาะสมาชิกที่ยังไม่มี `consent`; สมาชิกที่มีแล้ว (รวม `backfill`, kiosk, public) แสดงสรุปตาม §5 แบบอ่านอย่างเดียว และค่าไม่เปลี่ยน
- **FR-44** — evacuee ที่ถูกสร้างหลัง backfill จากช่องทางที่ไม่มีบล็อก (back-office pre-register, partner EXT-008 `worker/src/worker/inbound/external_bookings.py`, `import`, `paper`) ไม่มี `consent` ตอนสร้าง และเก็บ consent ที่ report-in ตาม FR-41
- **FR-42** — Public pre-register: ส่ง consent ไปกับ payload ของ unassigned registration แล้วเก็บใน Mongo. ตอน claim (`unassigned-registration/domain/claim.ts`) ต้องคัดลอก `consent` ไปยัง evacuee doc ทุกคนโดยไม่เปลี่ยนค่า และใช้ FR-31/FR-32 ตอนสร้าง doc. ก่อน claim ห้ามนำข้อมูลสุขภาพของคน `health = false` เข้า Mongo
- **FR-43** — Kiosk: ส่ง `consent` ไปพร้อม `consented_at` เดิมที่ `POST /api/v1/kiosk/register`. server ต้องตรวจด้วย Zod (FR-34) และตั้ง `channel = kiosk`, `given_by = self`. `card_snapshot.consented_at` คงไว้เหมือนเดิม
- **FR-45** — Kiosk payload ที่ไม่มี `consent` หรือ `consent` ไม่ผ่าน Zod → server ตอบ 400 และไม่สร้าง evacuee (kiosk client และ server deploy พร้อมกัน)

## 7. Backfill evacuee เดิม

- **FR-50** — migration script ครั้งเดียว (central CouchDB, admin): evacuee ทุกคนที่ไม่มี `consent` และไม่ `anonymized` ได้ `consent = {mode:'full', health:<มี medical doc ของคนนั้นหรือไม่>, ref:<ใหม่ต่อคน>, given_at:<เวลารัน>, given_by:'backfill', giver_evacuee_id:null, recorded_verbally_by:null, channel:'backfill', notice_version:'backfill'}` และ `schema_v: 15`
- **FR-51** — Backfill ห้ามแตะ `privacy.search_excluded` และ `medical`
- **FR-52** — Script ต้องรันซ้ำได้ (ข้ามคนที่มี `consent` แล้ว) และพิมพ์จำนวนที่แก้ต่อศูนย์

## 8. Acceptance

- [ ] Report-in ของคนที่ `search_excluded=true` อยู่แล้ว: C3 เริ่มต้นไม่ติ๊ก และหลังบันทึกยังเป็น `true`
- [ ] C2 ไม่ติ๊ก: `vulnerable_groups`/`special_needs`/EWAR ยังถูกบันทึก; screening ที่ Station 2 ยังสร้าง `medical` ได้
- [ ] Onsite: ติ๊ก C1+C2, C3 คงติ๊ก → ทุก evacuee ได้ `mode=full, health=true`, `search_excluded=false`, `ref` เดียวกัน, มี `medical` ตามที่กรอก
- [ ] Onsite: กด「ไม่ยินยอม」→「ลงทะเบียนแบบพื้นฐาน」→ ทุกคน `mode=basic, health=false`, `search_excluded=true`, ไม่มี `medical`; ค้นใน `/search` และ partner person search ไม่เจอ
- [ ] C1 ติ๊ก, C2 ไม่ติ๊ก, กรอกโรคประจำตัวไว้ → คำเตือน FR-16 แสดง; หลังบันทึกไม่มี `medical`
- [ ] เอาติ๊ก C3 ออก → `search_excluded=true`, `mode=full`
- [ ] C4: เลือกเด็ก 2 คน → เด็ก `given_by=guardian`, ผู้ใหญ่อื่น `household_member`, ผู้ลงทะเบียน `self`; ติ๊ก C4 แต่ไม่เลือกใคร → ปุ่มยืนยันปิด
- [ ] C5: แสดงชื่อ/รหัสของผู้ login แก้ไม่ได้; บันทึก `recorded_verbally_by` = user id นั้น; ไม่แสดงบน kiosk/public
- [ ] Kiosk: หน้า consent ใหม่ไม่มี C4/C5; evacuee ได้ `channel=kiosk`; payload ที่ไม่มี/ผิด `consent` ได้ 400 และไม่มี evacuee ถูกสร้าง
- [ ] Public: claim แล้ว evacuee ได้ `consent` ตรงกับที่ส่งมา; คน `health=false` ไม่มีข้อมูลสุขภาพทั้งใน Mongo และ Couch
- [ ] Report-in: คนที่มี `consent` เห็นสรุปอ่านอย่างเดียว; คนที่ไม่มีเห็นบล็อก
- [ ] Backfill: รันสองรอบได้ผลเท่ากัน; `health` ตรงกับการมี `medical` doc; `search_excluded` ไม่เปลี่ยน
- [ ] Unit test: Zod schema ของ `consent`, ฟังก์ชันคำนวณผลจาก C1–C5 (FR-11, FR-30–33), ฟังก์ชันสร้าง `ref`; ทุก `.svelte` ที่แตะผ่าน `svelte-autofixer`

## 9. Decision sync note (ใส่ใน `docs/data/schema.md` ตอน implement — ก่อนแก้ code)

> **decision sync 2026-10-25 (evacuee schema_v 14 → 15)** — เพิ่ม `consent` (opt) = `{mode, health, ref, given_at, given_by, giver_evacuee_id, recorded_verbally_by, channel, notice_version}` จากบล็อกความยินยอม PDPA (`docs/features/pdpa-consent-block-spec.md`). `mode = basic` บังคับ `privacy.search_excluded = true`; `mode = basic` หรือ `health = false` → **save ของฟอร์มลงทะเบียน** ห้ามสร้าง/แก้ `medical` (screening Station 2 ไม่ขึ้นกับกฎนี้). ค้นหาญาติยังเป็น opt-out (K-15). Kiosk register และ public unassigned registration รับ `consent` ใน payload (api-contract) และ claim คัดลอกไป evacuee. Migration: additive + backfill ครั้งเดียว (`given_by: 'backfill'`, `health` = มี `medical` doc หรือไม่).
> **decision sync 2026-10-25 — เพิ่มเติม (ไม่ bump `schema_v`)** — kiosk register: `consent` ที่ถูกรูปแบบแต่ `given_at` ย้อนหลังเกิน 10 นาที → `400 KIOSK_CONSENT_EXPIRED` (แทน `INVALID_KIOSK_REGISTRATION`); ตู้ล้าง decision แล้วพาผู้ใช้กลับหน้ายินยอมพร้อมข้อความแจ้ง (เก็บข้อมูลบัตร/ผลตรวจใบหน้า/ThaiD ไว้) แทนการ retry ด้วย decision เดิม. `given_at` ล้ำอนาคตเกิน 10 นาทียังเป็น `INVALID_KIOSK_REGISTRATION`; กฎ 10 นาทีไม่เปลี่ยน (api-contract §2.1, PR #892).

## 10. Open issues (ไม่ block งานนี้)

- ระยะเวลาเก็บรักษาในข้อความ notice ของ prototype คือ「[๒ ปี]」 แต่ `docs/data/data-model.md` §7 กำหนด 3 เดือนหลังปิดศูนย์. ต้องทำให้ตรงกันก่อนเปิดใช้แท็บ notice
- Backfill เป็น `full` ไม่ได้มาจากการยินยอมจริงของเจ้าของข้อมูล. `given_by: 'backfill'` แยกไว้ให้ DPO ตรวจสอบหรือขอยินยอมใหม่ภายหลังได้

## Decision log

| # | การตัดสินใจ | ทางเลือกที่ตัดทิ้ง / เหตุผล |
| --- | --- | --- |
| D1 | ค้นหาญาติคง opt-out (K-15) | opt-in ตาม prototype — ต้องกลับ policy ที่ยืนยันแล้ว และแก้ T-40/T-41/projector/ข้อมูลเดิม |
| D2 | C3 ติ๊กไว้ก่อน ใช้ข้อความ prototype, tag「เอาออกได้」 | checkbox เชิงปฏิเสธ — ต่างรูปแบบจากช่องอื่น |
| D3 | ใช้ทุกช่องทาง (onsite + kiosk + public) | onsite ก่อน — owner ต้องการครบในรอบเดียว |
| D4 | ช่องเจ้าหน้าที่เฉพาะ onsite, รหัสดึงจาก session | พิมพ์รหัสเอง — ตรวจสอบไม่ได้; kiosk PIN — งานเพิ่ม |
| D5 | 1 บล็อกต่อการลงทะเบียน ผลลงทุก evacuee พร้อม `given_by` | ผู้ใหญ่ทุกคนติ๊กเอง — ช้าเกินไปหน้าศูนย์ช่วงเกิดเหตุ |
| D6 | บล็อกอยู่ท้ายฟอร์ม ผู้อยู่ในความดูแลเลือกจากสมาชิก | ขั้นแรก + free text ตาม prototype — ถอนรายคนต้องจับคู่ชื่อเอง |
| D7 | สุขภาพ = ไม่ → ไม่บันทึก `medical` ตอนลงทะเบียน + เตือน; คง `vulnerable_groups`/`special_needs`/EWAR | ตัดกลุ่มเปราะบางด้านสุขภาพด้วย — ศูนย์จะไม่รู้ว่าใครต้องดูแลพิเศษ |
| D8 | โหมดพื้นฐานใช้ฟอร์มเดิม แต่ปิดการเปิดเผย | ลดฟิลด์ — กระทบการตรวจซ้ำ/ความจุ และต้องกำหนดรายการกับ DPO |
| D9 | `evacuee.consent` (สถานะปัจจุบัน), ประวัติไปทำกับงานถอน | doc ใหม่ `consent:{ulid}` — แตะ VDU whitelist (stable-core adjacent) |
| D10 | `ref` = `CS-` + 8 ตัวท้าย ULID | สุ่ม 6 หลักตาม prototype — ชนกันได้ และเป็น key ค้นหาในหน้าถอน |
| D11 | ข้อความ prototype อนุมัติแล้ว + เก็บ `notice_version` | — |
| D12 | Backfill คนเดิมเป็น `full`, `health` ตามการมี `medical` | ไม่ backfill (ข้อเสนอเดิม) — owner เลือก backfill |
| D13 | Track ด้วย decision sync note | CR ไฟล์ / Notion |
| D14 | C4 ไม่ติ๊กผู้เยาว์ไว้ก่อน | ติ๊กอายุ < 20 ไว้ก่อน — ผู้ลงทะเบียนอาจไม่ใช่ผู้ปกครองของเด็กทุกคน |
| D15 | Kiosk payload ไม่มี `consent` → 400 | รับแบบไม่มี consent ช่วง deploy — client/server deploy พร้อมกัน |
| D16 | ข้อความ notice โหมดพื้นฐานเปลี่ยนเป็น「…แต่ชื่อของท่านจะไม่แสดงในระบบค้นหาญาติ ข้อมูลจะไม่ถูกส่งต่อให้หน่วยงานภายนอก และจะไม่มีการประสานเยียวยาผ่านระบบ…」 (`notice_version` 2026-10-26) | ข้อความ prototype「เก็บเฉพาะข้อมูลที่จำเป็นต่อความปลอดภัยของชีวิต」 — ขัดกับ D8 ที่บันทึกฟิลด์ลงทะเบียนตามปกติ (owner อนุมัติ 2026-10-26) |

Owner อนุมัติ spec 2026-10-25.
