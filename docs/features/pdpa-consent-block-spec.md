---
title: บล็อกความยินยอม PDPA ในการลงทะเบียน (PDPA Consent Block Spec)
status: active
created: 2026-10-25
updated: 2026-11-01
tracking: decision sync note (owner เลือก 2026-10-25 — ไม่ใช้ CR ไฟล์; ยืนยันอีกครั้ง 2026-10-27 สำหรับรอบปรับ UX)
source: Shelter Consent Prototype.html (การ์ด「ความยินยอมของท่าน」เท่านั้น)
affects:
  - frontend/src/lib/features/consent/ (block UI, block state, copy, `SURFACE_CAPS`, decision schema) — รอบปรับ UX 2026-10-27
  - frontend/src/lib/constants/i18n/public-policy.ts + public-term.ts (ตัดประโยค "ไม่ยินยอมก็ยังได้รับความช่วยเหลือ", D22)
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
> - การ์ด「ข้อตกลงและความยินยอม」 อยู่ **ท้ายฟอร์มลงทะเบียน** ทุกช่องทาง (onsite, kiosk, public pre-register) มีปุ่ม「ยอมรับทั้งหมด」 และคำสั้นอ่านง่าย พร้อม「ดูข้อความเต็ม」
> - ผู้ลงทะเบียนกดครั้งเดียว ผลบันทึกลง **ทุก evacuee ในการลงทะเบียนนั้น** เป็น `evacuee.consent` (schema_v 15) — ไม่มีช่องผู้ปกครอง (C4) แล้ว
> - **ไม่ติ๊กช่องหลัก (C1) = บันทึกไม่ได้** ทุกช่องทาง (ยกเลิกโหมดพื้นฐานสำหรับการลงทะเบียนใหม่, 2026-10-27). ไม่ติ๊กช่องสุขภาพ = ไม่บันทึก `medical` ตอนลงทะเบียน
> - ค้นหาญาติยังเป็น **opt-out** (K-15): ช่องนี้ติ๊กไว้ก่อน เอาออกได้. Pre-register รวมข้อรับทราบเงื่อนไขศูนย์/ข้อตกลงการใช้งานไว้ในการ์ดเดียวกัน

## 1. ขอบเขต

**อยู่ในขอบเขต**
- การ์ด「ข้อตกลงและความยินยอม」: ปุ่มยอมรับทั้งหมด, ข้อรับทราบ (pre-register), ช่องหลัก, ช่องสุขภาพ, ช่องค้นหาญาติ, ช่องเจ้าหน้าที่, ลิงก์ข้อตกลง/นโยบาย, ปุ่มยืนยัน, สรุปผล
- ตัดประโยค "ไม่ยินยอมก็ยังได้รับความช่วยเหลือขั้นพื้นฐาน" ออกจากหน้า `/policy` และ `/term` (D22)
- การเก็บผลลง CouchDB ทั้ง 3 ช่องทาง รวมถึงการพา consent ผ่านขั้น claim ของ public pre-register
- Backfill `consent` ให้ evacuee เดิม

**นอกขอบเขต**
- แท็บฉบับย่อ/ฉบับเต็ม, ปุ่มขนาดตัวอักษร และ steps header ของ prototype
- หน้าถอน/เปลี่ยนความยินยอม (prototype `Shelter Consent Withdrawal`) และประวัติแบบ append-only ซึ่งจะทำพร้อมงานถอนความยินยอม
- การแก้ระยะเวลาเก็บรักษา (ดู §10 Open issues)
- การคัดกรอง/บันทึก `medical` ที่ Station 2 (screening) — ทำต่อได้ตามฐาน vital interest (PDPA ม.26(1)) ไม่ขึ้นกับ `consent.health`

## 2. ช่องทางและตำแหน่ง

| ช่องทาง | หน้า | ตำแหน่งบล็อก | กลุ่ม A (ข้อรับทราบ) | ลิงก์ข้อตกลง/นโยบาย | ช่องเจ้าหน้าที่ (C5) |
| --- | --- | --- | --- | --- | --- |
| Onsite (Station 1) | `(protected)/onsite/people/new` | ท้ายฟอร์ม ก่อนปุ่มบันทึก | ซ่อน | แสดง | แสดง |
| Onsite report-in | `onsite/people/[id]/report-in`, `onsite/unassigned/[id]/report-in` | ท้ายฟอร์ม เฉพาะเมื่อ evacuee ยังไม่มี `consent` (FR-41) | ซ่อน | แสดง | แสดง |
| Kiosk walk-in | `kiosk/register/consent` (แทนหน้า consent เดิม) | หน้า consent ของ flow kiosk | ซ่อน | **ซ่อน** | ซ่อน |
| Public pre-register | `(public)/pre-register` (`booking-form`) | ท้ายฟอร์ม ก่อนปุ่มยืนยัน | แสดง (FR-22) | แสดง | ซ่อน |

- **FR-01** — ทุกช่องทางในตารางต้องใช้ component บล็อกเดียวกัน โดยเปิด/ปิดกลุ่ม A, ลิงก์ข้อตกลง/นโยบาย และช่องเจ้าหน้าที่ผ่าน props
- **FR-02** — หน้า consent ของ kiosk ต้องแสดงบล็อกนี้แทนข้อความยินยอมเดิมใน `kiosk-register-consent.svelte`. ข้อความว่าจะอ่านข้อมูลอะไรจากบัตร/ThaiD ให้คงไว้เหนือบล็อก

## 3. ช่องในบล็อกและพฤติกรรม UI

ข้อความทั้งหมดอยู่ในไฟล์ i18n ไฟล์เดียว (`consent-notice.i18n.ts`) ตาม §3.1. ข้อความเต็มของ C1–C3 คือข้อความ prototype ที่อนุมัติแล้ว (D11) โดย C1 แก้ตาม D18. เปลี่ยนข้อความใดก็ตาม → bump `CONSENT_NOTICE_VERSION` (รอบนี้ = `2026-10-27`)

```
ข้อตกลงและความยินยอม
อ่าน[ข้อตกลงการใช้งาน↗]และ[นโยบายความเป็นส่วนตัว↗] แล้วกด「ยอมรับทั้งหมด」 หรือเลือกเฉพาะข้อที่ต้องการ
[ ยอมรับทั้งหมด ]

ต้องรับทราบก่อนส่งข้อมูล                          ← กลุ่ม A, pre-register เท่านั้น
  ☐ A  รับทราบเงื่อนไขศูนย์ / คิวกลาง

ความยินยอมเรื่องข้อมูล (มีผลกับทุกคนในการลงทะเบียนนี้)  ← กลุ่ม B
  ☐ C1 ใช้ข้อมูลเพื่อใช้งานระบบ (จำเป็น)          [ดูข้อความเต็ม]
      ☐ C2 ข้อมูลสุขภาพ                           [ดูข้อความเต็ม]
      ☐ C3 ให้ญาติค้นหาเจอ                         [ดูข้อความเต็ม]
  ☐ C5 เจ้าหน้าที่อ่านให้ฟัง                        ← onsite เท่านั้น

[ ปุ่มยืนยัน ]  ← ล็อกจนกว่า C1 (และ A ถ้ามี) จะติ๊ก
```

| # | ช่อง | กลุ่ม | ค่าเริ่มต้น | เงื่อนไขแสดง | ใน「ยอมรับทั้งหมด」 |
| --- | --- | --- | --- | --- | --- |
| A | รับทราบเงื่อนไขศูนย์ (เลือกศูนย์) หรือคิวกลาง (ไม่ระบุศูนย์) | A (จำเป็น) | ไม่ติ๊ก | pre-register เท่านั้น | ✅ |
| C1 | ยินยอมให้ใช้ข้อมูลเพื่อใช้งานระบบ (ช่องหลัก) | B (จำเป็น) | ไม่ติ๊ก | ทุกช่องทาง | ✅ |
| C2 | ยินยอมโดยชัดแจ้งเรื่องข้อมูลสุขภาพ | B ใต้ C1 | ไม่ติ๊ก | ทุกช่องทาง | ✅ |
| C3 | ยินยอมให้แสดงชื่อและศูนย์ในระบบค้นหาญาติ | B ใต้ C1 | **ติ๊ก** (คนใหม่) / `!privacy.search_excluded` (คนที่มี doc แล้ว) | ทุกช่องทาง | ✅ |
| C5 | เจ้าหน้าที่อ่านให้ฟังและบันทึกตามวาจา | B | ไม่ติ๊ก | onsite เท่านั้น | ❌ |

- **FR-10** — C2 และ C3 แสดงซ้อนใต้ C1 และกดได้เฉพาะเมื่อ C1 ติ๊ก. C1 ไม่ติ๊ก → C2/C3 เป็น disabled
- **FR-11** — ปุ่มยืนยันถูก disable จนกว่า C1 จะติ๊ก และ (pre-register) A จะติ๊ก. ขณะ disable ให้แสดงข้อความในบล็อกและผูกกับปุ่มด้วย `aria-describedby`: C1 ไม่ติ๊ก →「ข้อความตอนปุ่มถูกล็อก」 (§3.1); A ไม่ติ๊ก → ข้อความเดิมของ `booking-form` (`shelterDisclaimerRequired` / `unassignedDisclaimerRequired`). ใช้กับทุกช่องทาง
- **FR-12** — C3 คนใหม่: ติ๊กไว้ตั้งแต่ต้น. evacuee ที่มี doc อยู่แล้ว (report-in, claim): ค่าเริ่มต้น = `!privacy.search_excluded` ของคนนั้น — ห้ามดึงคนที่ opt-out ไว้แล้วกลับเข้าการค้นหาโดยไม่ได้ตั้งใจ (T-40). เอาติ๊กออก = ขอไม่แสดงในระบบค้นหาญาติ
- **FR-13** — *(ยกเลิก 2026-10-27, D17 — ไม่มีช่องผู้ปกครอง C4)*
- **FR-14** — *(ยกเลิก 2026-10-27, D17)*
- **FR-15** — เมื่อติ๊ก C5 ให้แสดงชื่อและรหัสผู้ใช้ของเจ้าหน้าที่ที่ login อยู่ (จาก `authStore`) แบบอ่านอย่างเดียว ห้ามพิมพ์แก้
- **FR-16** — ถ้ามีข้อมูลที่จะไปลง `medical` (โรคประจำตัว/แพ้/ยา/หมายเหตุสุขภาพ) กรอกค้างในฟอร์ม แต่ C2 ไม่ติ๊ก บล็อกต้องแสดงคำเตือน「ข้อมูลสุขภาพที่กรอกไว้จะไม่ถูกบันทึก」 ก่อนกดยืนยัน
- **FR-17** — ปุ่ม「ยอมรับทั้งหมด」 ติ๊กทุกช่องที่มีเครื่องหมาย ✅ ในตาราง (เฉพาะช่องที่แสดงในช่องทางนั้น) และไม่ submit ฟอร์ม. ผู้ใช้ยังเอาติ๊กรายข้อออกได้ภายหลัง
- **FR-18** — แต่ละช่องแสดง **คำสั้น** (§3.1). C1–C3 มีปุ่ม「ดูข้อความเต็ม」/「ย่อ」 กาง/ย่อข้อความเต็มใต้ช่องนั้น (ปุ่มเป็น `button` แยกจาก label ของ checkbox — กดแล้วไม่สลับค่าติ๊ก, มี `aria-expanded`)
- **FR-19** — ปุ่มยืนยันของบล็อกคือปุ่ม submit ของฟอร์มลงทะเบียนนั้น ไม่มีขั้นยืนยันแยก (kiosk: บล็อกแสดงปุ่มยืนยันเอง เพราะไม่มีฟอร์ม). ไม่มีปุ่ม「ไม่ยินยอม」 และไม่มี notice โหมดพื้นฐาน. การบันทึก consent กับการบันทึกการลงทะเบียนต้องสำเร็จหรือล้มเหลวไปด้วยกัน
- **FR-20** — หลังบันทึกสำเร็จ หน้าผลลัพธ์/หน้าสำเร็จของแต่ละช่องทางต้องแสดงสรุปตามตาราง §5. kiosk แสดงเฉพาะเลขอ้างอิง
- **FR-21** — label ทุกช่องคลิกได้ทั้งแถว, checkbox มี `focus-visible`. ใช้ component จาก `$lib/components/ui` และ token ของ civic-design-system ไม่ copy CSS จาก prototype
- **FR-22** — Pre-register: ย้ายข้อรับทราบเดิมของ `booking-form` (การ์ด「เงื่อนไขและมาตรการความปลอดภัยของศูนย์พักพิง」 และการ์ด「เงื่อนไขการใช้งานระบบลงทะเบียนล่วงหน้า」) มาเป็นกลุ่ม A ในบล็อก. รายการเงื่อนไขของศูนย์ (`buildDisclaimerGroups`) ยังแสดงเหนือ checkbox A. ศูนย์ที่ไม่มีรายการเงื่อนไข → ไม่แสดงกลุ่ม A. ช่อง A ไม่ติ๊ก → ปุ่มส่ง disable (แก้ bug เดิมที่เลือกศูนย์แล้วส่งได้ก่อนติ๊ก แล้วค่อยได้ toast)
- **FR-23** — คำอธิบายใต้หัวการ์ดมีลิงก์ `/term` และ `/policy` เปิดแท็บใหม่ (`target="_blank" rel="noopener noreferrer"`) บน onsite และ pre-register. kiosk ไม่แสดงลิงก์ (ใช้คำอธิบายฉบับ kiosk)
- **FR-24** — Kiosk ใช้บล็อกเดียวกันแบบ standalone: ไม่มีกลุ่ม A, ไม่มีลิงก์, ไม่มี C5; ปุ่มยืนยันในบล็อก disable จนกว่า C1 จะติ๊ก

### 3.1 ข้อความ (notice_version `2026-10-27`)

| key | ข้อความ |
| --- | --- |
| หัวการ์ด | ข้อตกลงและความยินยอม |
| คำอธิบาย (onsite, pre-register) | อ่าน[ข้อตกลงการใช้งาน]และ[นโยบายความเป็นส่วนตัว] แล้วกด「ยอมรับทั้งหมด」 หรือเลือกเฉพาะข้อที่ต้องการ |
| คำอธิบาย (kiosk) | กด「ยอมรับทั้งหมด」 หรือเลือกเฉพาะข้อที่ต้องการ |
| ปุ่มรวม | ยอมรับทั้งหมด |
| หัวกลุ่ม A | ต้องรับทราบก่อนส่งข้อมูล |
| A (เลือกศูนย์) | รับทราบและจะปฏิบัติตามกฎความปลอดภัยของศูนย์ |
| A (ไม่ระบุศูนย์) | เข้าใจว่าข้อมูลจะรอในคิวจนกว่าเจ้าหน้าที่ศูนย์จะยืนยัน |
| หัวกลุ่ม B | ความยินยอมเรื่องข้อมูล (มีผลกับทุกคนในการลงทะเบียนนี้) |
| C1 คำสั้น | ให้ใช้ข้อมูลของท่านและสมาชิกทุกคนที่ลงทะเบียนครั้งนี้ เพื่อใช้งานระบบ และประสานกับหน่วยงานที่เกี่ยวข้อง |
| C1 ข้อความเต็ม | ข้าพเจ้ายินยอมให้ระบบเก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของข้าพเจ้าและสมาชิกทุกคนที่ลงทะเบียนร่วมในครั้งนี้ เพื่อการลงทะเบียน การจัดสรรความช่วยเหลือ การรวมญาติ และการประสานงานกับหน่วยงานที่เกี่ยวข้อง |
| C2 คำสั้น | ให้เก็บข้อมูลสุขภาพ (โรคประจำตัว การแพ้ ยาที่ใช้) เพื่อดูแลและส่งต่อการรักษา |
| C2 ข้อความเต็ม | ข้าพเจ้ายินยอมโดยชัดแจ้งให้เก็บรวบรวมและใช้ข้อมูลสุขภาพ เพื่อการดูแลกลุ่มเปราะบางและการส่งต่อการรักษาพยาบาล |
| C3 คำสั้น | ให้ญาติค้นหาชื่อและศูนย์ที่ท่านพักอยู่ได้ |
| C3 ข้อความเต็ม | ข้าพเจ้ายินยอมให้แสดงชื่อและศูนย์พักพิงที่ข้าพเจ้าพักอยู่ในระบบค้นหาญาติ เพื่อให้ญาติหรือผู้ติดต่อตามตัวได้ |
| C5 | เจ้าหน้าที่อ่านข้อความให้ผู้ลงทะเบียนฟัง และบันทึกตามที่ตอบด้วยวาจา |
| C5 ชื่อเจ้าหน้าที่ | เจ้าหน้าที่ผู้บันทึก: {ชื่อ} ({รหัส}) |
| ปุ่มกาง/ย่อ | ดูข้อความเต็ม / ย่อ |
| เตือนข้อมูลสุขภาพ | ข้อมูลสุขภาพที่กรอกไว้จะไม่ถูกบันทึก |
| ข้อความตอนปุ่มถูกล็อก | กรุณายินยอมข้อแรกก่อนบันทึก |
| ปุ่มยืนยัน | ป้ายเดิมของแต่ละช่องทาง (pre-register「ยืนยันการลงทะเบียน」, onsite「บันทึกลงทะเบียนทั้งครอบครัว」, kiosk「ยืนยัน」) |

ข้อความ A และลิงก์ใน `public-booking-form.ts` ต้องมีฉบับ EN คู่กัน

## 4. รูปข้อมูล — `evacuee.consent` (schema_v 14 → 15)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `consent` | object | opt | ไม่มี = ยังไม่ได้บันทึก (หลัง backfill ไม่ควรเหลือ) |
| `consent.mode` | enum(`full`,`basic`) | req | การลงทะเบียนใหม่เขียน `full` เสมอ (FR-36). `basic` คงไว้ใน enum สำหรับ doc ที่บันทึกก่อน 2026-10-27 |
| `consent.health` | bool | req | `false` เสมอเมื่อ `mode = basic` |
| `consent.ref` | str | req | `CS-` + 8 ตัวท้ายของ ULID ใหม่ที่สร้างตอนกดยืนยัน (Crockford base32 ตัวพิมพ์ใหญ่) เช่น `CS-7K3QZ9MD` — 1 ค่าต่อการลงทะเบียน สมาชิกทุกคนใช้ค่าเดียวกัน |
| `consent.given_at` | ts (ISO 8601) | req | เวลาที่กดยืนยันฝั่ง client. แสดงผลเป็น พ.ศ. + `น.` เท่านั้น |
| `consent.given_by` | enum(`self`,`guardian`,`household_member`,`backfill`) | req | `self` = ผู้ลงทะเบียน; `household_member` = สมาชิกคนอื่นทุกคน (รวมผู้เยาว์) ที่ผู้ลงทะเบียนให้แทน; `backfill` = FR-50; `guardian` = เฉพาะ doc ที่บันทึกก่อน 2026-10-27 (C4 เดิม) — ไม่เขียนค่านี้แล้ว |
| `consent.giver_evacuee_id` | str\|null | req | evacuee id ของผู้ลงทะเบียน; `null` เมื่อ `given_by = self` หรือ `backfill` |
| `consent.recorded_verbally_by` | str\|null | req | user id ของเจ้าหน้าที่เมื่อติ๊ก C5; อื่น ๆ `null` |
| `consent.channel` | enum(`staff`,`kiosk`,`web`,`backfill`) | req | ช่องทางที่บันทึก |
| `consent.notice_version` | str | req | เวอร์ชันข้อความ consent ที่แสดงตอนยินยอม (ค่าคงที่ในไฟล์ i18n เริ่ม `2026-10-25`) |

- **FR-30** — ช่องค้นหาญาติไม่มี field ใน `consent`. C3 เขียนลง `privacy.search_excluded` เดิม: C3 ติ๊ก → `false`, ไม่ติ๊ก → `true`
- **FR-31** — `mode = basic` → ต้องเขียน `privacy.search_excluded = true` เสมอ
- **FR-31a** (CR-218) — หลังลงทะเบียน เจ้าหน้าที่เปลี่ยน `privacy.search_excluded` ได้จากการ์ด "ความเป็นส่วนตัว" บนหน้ารายละเอียดผู้เข้าพัก ตามที่เจ้าตัวขอ (ไม่มีช่องเหตุผล, dialog ยืนยันว่าเจ้าตัวเป็นผู้ขอ). ทุกครั้งเขียน `audit` `action: privacy_change`. เปิดการแสดงของคน `mode = basic` → dialog แสดง full notice ก่อน แล้วเขียน `mode = full` (`health = false`, `notice_version` ฉบับปัจจุบัน, `given_at` = เวลายืนยัน) พร้อม `search_excluded = false` ใน doc เดียว จึงไม่ขัด FR-31. ซ่อน (→ `true`) ไม่แตะ `consent`. ศูนย์ที่ปิดแล้ว: ซ่อนได้ แต่เปิดแสดงกลับไม่ได้ (CR-218 D-1)
- **FR-32** — `consent.health = false` → การบันทึกลงทะเบียนครั้งนี้ห้ามสร้างหรืออัปเดต `medical` doc ของ evacuee คนนั้น. ข้อมูล `medical` ในฟอร์มถูกทิ้ง. `vulnerable_groups`, `disability_other_detail`, `special_needs` และอาการ EWAR บันทึกตามปกติ. กฎนี้ใช้เฉพาะ save ของฟอร์มลงทะเบียน ไม่ใช้กับ screening ที่ Station 2
- **FR-33** — ผู้ลงทะเบียนได้ `given_by = self`. สมาชิกคนอื่นทุกคนได้ `household_member` (D17)
- **FR-34** — ใช้ Zod schema เดียวกันทั้ง client และ server (kiosk endpoint, FastAPI unassigned registration) และให้ `validate_doc_update` ตรวจ `consent` เมื่อมี field (enum + req ตามตาราง)
- **FR-35** — เขียน `schema_v: 15` เมื่อสร้างหรือแก้ evacuee หลังเปลี่ยนนี้. evacuee ที่ไม่มี `consent` อ่านได้ตามปกติ
- **FR-36** — Decision schema ของบล็อก (client + kiosk endpoint + public BFF, FR-34) รับเฉพาะ `mode = "full"` และ `guardian_for = []` ทุกช่องทาง (`SURFACE_CAPS.guardian = false` ทุก channel). payload ที่เป็น `basic` หรือมี `guardian_for` → error เดิมของแต่ละ endpoint (kiosk register `400`, public registrations/unassigned-registrations `422 INVALID_INPUT`). รูป payload (key) ไม่เปลี่ยน. Schema ของ `evacuee.consent` ที่อ่านจาก CouchDB, `validate_doc_update` และ FastAPI `members[].consent` ยังรับ `basic`/`guardian` เพื่ออ่าน doc เดิม

## 5. สรุปผลหลังบันทึก

| แถว | ค่า |
| --- | --- |
| รูปแบบการลงทะเบียน | 「บริการเต็มรูปแบบ」 / 「ช่วยเหลือขั้นพื้นฐาน」 (ค่าหลังมีเฉพาะ doc เดิม — แสดงในสรุปอ่านอย่างเดียวของ report-in) |
| ข้อมูลทั่วไปและการประสานงาน | ยินยอม / ไม่ยินยอม (`mode`) |
| ข้อมูลสุขภาพ | ยินยอม / ไม่ยินยอม (`health`) |
| แสดงในระบบค้นหาญาติ | ยินยอม / ไม่ยินยอม (`!search_excluded`) |
| บันทึกโดยเจ้าหน้าที่ | ชื่อ + รหัสผู้ใช้ (แสดงเมื่อติ๊ก C5) |
| เวลาที่บันทึก | `DD/MM/YYYY(พ.ศ.) HH:mm น.` |
| เลขอ้างอิงความยินยอม | `consent.ref` (font mono) |

แถว「ยินยอมแทนผู้อยู่ในความดูแล」 ถูกตัด (D17). ข้อความท้ายสรุป:「ท่านถอนหรือเปลี่ยนความยินยอมได้ทุกเมื่อที่จุดลงทะเบียนของศูนย์」. หัวข้อ:「บันทึกความยินยอมแล้ว」 (หัวข้อ「ลงทะเบียนแบบพื้นฐานแล้ว」 ถูกตัด)

## 6. ผลของโหมดและ downstream

| สถานะ | ผล |
| --- | --- |
| `mode = basic` (doc ก่อน 2026-10-27 เท่านั้น) | บันทึกฟิลด์ลงทะเบียนตามปกติ; `search_excluded = true`; ไม่มี `medical`; หายจาก public family search, partner person search (EXT-012) และ partner occupant list (EXT-007); ยังนับในยอด aggregate/occupancy |
| `mode = full`, `health = false` | ไม่มี `medical` จากการลงทะเบียนนี้; ส่วนอื่นปกติ |
| C3 ไม่ติ๊ก | `search_excluded = true` (พฤติกรรม opt-out เดิมของ T-40/T-41) |

- **FR-40** — การซ่อนจากการค้นหาทำผ่าน `privacy.search_excluded`: `worker/src/worker/projectors/evacuee.py` ลบ projection ใน `public_persons` และ `worker/src/worker/projectors/occupant.py` ไม่ project ลง `shelter_occupants` (EXT-007) เมื่อ `true` (EXT-007 เพิ่มตาม decision sync 2026-10-26, #791 — bump `PROJECTION_VERSION` 7 → 8; ส่วน `evacuee.py` ไม่ต้องแก้). ต้องมี test ยืนยันว่า evacuee `mode = basic` ไม่ปรากฏใน `POST /public/v1/occupants`, partner person search (`thirdparty_person_search`, ผ่าน `EvacueeUseCase`), partner residency (`thirdparty_residency`, อ่าน `PublicPerson`) และ partner occupant list (`thirdparty_occupants`, EXT-007, อ่าน `ShelterOccupant`). ยอด aggregate EXT-005 (`thirdparty_occupancy`, อ่าน `PublicShelter` ที่ worker นับจาก CouchDB) ยังนับรวม
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
- [ ] ทุกช่องทาง: C1 ไม่ติ๊ก → ปุ่มยืนยัน disable + ข้อความ「กรุณายินยอมข้อแรกก่อนบันทึก」; ไม่มีปุ่ม「ไม่ยินยอม」/notice โหมดพื้นฐาน; C2/C3 disable
- [ ] กด「ยอมรับทั้งหมด」 → A (ถ้ามี) + C1 + C2 + C3 ติ๊ก, C5 ไม่ติ๊ก, ฟอร์มยังไม่ถูกส่ง; เอาติ๊กรายข้อออกได้
- [ ] กด「ดูข้อความเต็ม」 → ข้อความเต็มกางออก ค่าติ๊กไม่เปลี่ยน
- [ ] Pre-register เลือกศูนย์ที่มีเงื่อนไข: ไม่ติ๊ก A → ปุ่มส่ง disable (ไม่ใช่ toast หลังกด); ไม่ระบุศูนย์: เหมือนกัน
- [ ] Onsite/pre-register เห็นลิงก์ `/term` และ `/policy` เปิดแท็บใหม่; kiosk ไม่เห็นลิงก์
- [ ] payload `mode=basic` หรือ `guardian_for` ไม่ว่าง → kiosk register ได้ 400, public registrations/unassigned-registrations ได้ 422 และไม่มี evacuee/คิวถูกสร้าง
- [ ] C1 ติ๊ก, C2 ไม่ติ๊ก, กรอกโรคประจำตัวไว้ → คำเตือน FR-16 แสดง; หลังบันทึกไม่มี `medical`
- [ ] เอาติ๊ก C3 ออก → `search_excluded=true`, `mode=full`
- [ ] ลงทะเบียน 3 คน (มีเด็ก) → ผู้ลงทะเบียน `given_by=self`, อีก 2 คน `household_member`; ไม่มีช่อง C4 ในทุกช่องทาง
- [ ] Report-in ของ evacuee เดิมที่ `mode=basic` หรือ `given_by=guardian`: สรุปอ่านอย่างเดียวแสดงได้ ไม่ error
- [ ] C5: แสดงชื่อ/รหัสของผู้ login แก้ไม่ได้; บันทึก `recorded_verbally_by` = user id นั้น; ไม่แสดงบน kiosk/public
- [ ] Kiosk: หน้า consent ใหม่ไม่มี C5/ลิงก์; evacuee ได้ `channel=kiosk`; payload ที่ไม่มี/ผิด `consent` ได้ 400 และไม่มี evacuee ถูกสร้าง
- [ ] หน้า `/policy` (intro + closing) และ `/term` (ข้อสิทธิ) ทั้ง TH/EN ไม่มีประโยค "ไม่ยินยอม/ถอนความยินยอมก็ยังได้รับความช่วยเหลือขั้นพื้นฐาน"
- [ ] Public: claim แล้ว evacuee ได้ `consent` ตรงกับที่ส่งมา; คน `health=false` ไม่มีข้อมูลสุขภาพทั้งใน Mongo และ Couch
- [ ] Report-in: คนที่มี `consent` เห็นสรุปอ่านอย่างเดียว; คนที่ไม่มีเห็นบล็อก
- [ ] Backfill: รันสองรอบได้ผลเท่ากัน; `health` ตรงกับการมี `medical` doc; `search_excluded` ไม่เปลี่ยน
- [ ] Unit test: Zod schema ของ `consent` (FR-36), ฟังก์ชันคำนวณผลจาก C1–C5 (FR-30–33), ฟังก์ชันสร้าง `ref`, block state (FR-10/11/17); ทุก `.svelte` ที่แตะผ่าน `svelte-autofixer`

## 9. Decision sync note (ใส่ใน `docs/data/schema.md` ตอน implement — ก่อนแก้ code)

> **decision sync 2026-10-25 (evacuee schema_v 14 → 15)** — เพิ่ม `consent` (opt) = `{mode, health, ref, given_at, given_by, giver_evacuee_id, recorded_verbally_by, channel, notice_version}` จากบล็อกความยินยอม PDPA (`docs/features/pdpa-consent-block-spec.md`). `mode = basic` บังคับ `privacy.search_excluded = true`; `mode = basic` หรือ `health = false` → **save ของฟอร์มลงทะเบียน** ห้ามสร้าง/แก้ `medical` (screening Station 2 ไม่ขึ้นกับกฎนี้). ค้นหาญาติยังเป็น opt-out (K-15). Kiosk register และ public unassigned registration รับ `consent` ใน payload (api-contract) และ claim คัดลอกไป evacuee. Migration: additive + backfill ครั้งเดียว (`given_by: 'backfill'`, `health` = มี `medical` doc หรือไม่).
> **decision sync 2026-10-25 — เพิ่มเติม (ไม่ bump `schema_v`)** — kiosk register: `consent` ที่ถูกรูปแบบแต่ `given_at` ย้อนหลังเกิน 10 นาที → `400 KIOSK_CONSENT_EXPIRED` (แทน `INVALID_KIOSK_REGISTRATION`); ตู้ล้าง decision แล้วพาผู้ใช้กลับหน้ายินยอมพร้อมข้อความแจ้ง (บัตรสมาร์ทการ์ด: เก็บข้อมูลบัตร/ผลตรวจใบหน้าไว้; ThaiD: session สแกนอายุ 180 วินาทีหลังยืนยัน จึงหมดอายุแล้วเสมอ ตู้รีเซ็ตและพากลับหน้าสแกน ThaiD พร้อมข้อความแจ้ง ไม่ให้ยินยอมซ้ำก่อนต้องสแกนใหม่อยู่ดี) แทนการ retry ด้วย decision เดิม. `given_at` ล้ำอนาคตเกิน 10 นาทียังเป็น `INVALID_KIOSK_REGISTRATION`; กฎ 10 นาทีไม่เปลี่ยน (api-contract §2.1, PR #892).
> **decision sync 2026-10-26 — เพิ่มเติม (ไม่ bump `schema_v`; bump `PROJECTION_VERSION` 7 → 8)** — EXT-007 (`shelter_occupants`, `/external/locations/{code}/occupants`) ไม่ project evacuee ที่ `privacy.search_excluded = true` (ทั้ง `mode = basic` และไม่ติ๊ก C3) และลบ row เดิมเมื่อค่าเปลี่ยนจาก `false` เป็น `true` เหมือน `evacuee.py`; ยอด aggregate/occupancy (EXT-005) ยังนับรวม. Owner อนุมัติ 2026-10-26 (#791).
> **decision sync 2026-10-26 (PDPA D8 — aggregate นับคนที่ `search_excluded`, ไม่ bump `schema_v`)** — worker ลบ `public_persons` ของ evacuee ที่ `privacy.search_excluded = true` (โหมดพื้นฐาน หรือไม่ติ๊ก C3) จึงห้ามนับยอด aggregate จาก `public_persons`. เพิ่ม `public_shelters.occupancy_by_status` (`{stay status: count}`, worker `refresh_occupancy` นับจาก evacuee **ทุกคน** ใน `shelter_{code}` ไม่สนใจ `privacy`) — public transparency `occupancy_total` (รวมเฉพาะศูนย์ `is_active`) และ shelter detail `occupancy`/`present`/`in_zone` รวมจาก field นี้ตามชุดสถานะเดิม (CR-112). `occupancy_total`/`occupancy_breakdown` ของ EXT-005 คงเดิม (`active` only). เพิ่ม `external_bookings.stay_status` (worker คัดลอก `current_stay.status` ของ evacuee ที่มี `booking_ref` ลงแถวของมัน โดยไม่แตะ `updated_at`) — EXT-009 cancel ใช้ค่านี้เมื่อคนนั้นไม่มีแถว `public_persons` → คนที่ check-in แล้วได้ `409 booking_not_cancellable` ไม่ใช่ 200. Migration: additive; bump `PROJECTION_VERSION` (→ 9) เพื่อให้ bootstrap เติมค่าให้ทุกศูนย์/ทุก booking; แถว `public_shelters` ที่ยังไม่มี key (`null`) → backend นับจาก `public_persons` แบบเดิมจนกว่าจะ re-project. EXT-008 ตรวจซ้ำยังอ่าน `public_persons` — คนที่ search-excluded ได้ 201 แล้ว worker ปฏิเสธ `duplicate` ทีหลัง (owner ยอมรับ, ปิด #903).
> **decision sync 2026-10-27 (PDPA consent UX — ไม่ bump `schema_v`)** — บล็อกเปลี่ยนเป็นการ์ด「ข้อตกลงและความยินยอม」 พร้อมปุ่ม「ยอมรับทั้งหมด」 และคำสั้น +「ดูข้อความเต็ม」 (`notice_version` `2026-10-27`). ยกเลิกช่องผู้ปกครอง (C4): สมาชิกที่ไม่ใช่ผู้ลงทะเบียนได้ `given_by = household_member` ทุกคน. ยกเลิกโหมดพื้นฐานสำหรับการลงทะเบียนใหม่: C1 ไม่ติ๊ก → บันทึกไม่ได้ทุกช่องทาง. Decision payload (kiosk register, public registrations/unassigned-registrations) รับเฉพาะ `mode = "full"` และ `guardian_for = []` — payload อื่น → kiosk `400` / public `422 INVALID_INPUT`; key ของ payload ไม่เปลี่ยน. `evacuee.consent.mode` enum คง `basic` และ `given_by` คง `guardian` เพื่ออ่าน doc เดิม (VDU + FastAPI `members[].consent` ไม่แก้). ตัดประโยค "ไม่ยินยอม/ถอนความยินยอมก็ยังได้รับความช่วยเหลือขั้นพื้นฐาน" ออกจาก `/policy` และ `/term`. Migration: ไม่มี — doc เดิมที่เป็น `basic`/`guardian` คงค่าเดิม. Owner อนุมัติ 2026-10-27.

## 10. Open issues (ไม่ block งานนี้)

- ผู้ที่ไม่ยินยอม C1 ที่ onsite/kiosk บันทึกเข้าระบบไม่ได้ (D21). ยังไม่มีขั้นตอนรองรับคนกลุ่มนี้ (เช่น บันทึกนอกระบบ/กระดาษ) — ต้องกำหนดร่วมกับทีมปฏิบัติการและ DPO
- การบังคับ C1 เพื่อรับบริการ (D21) และการตัดข้อความใน `/policy`/`/term` (D22) ควรผ่านการทบทวนของ DPO/ฝ่ายกฎหมาย ตาม PDPA ม.19 วรรคสี่
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
| D14 | C4 ไม่ติ๊กผู้เยาว์ไว้ก่อน. **ถูกแทนที่โดย D17** | ติ๊กอายุ < 20 ไว้ก่อน — ผู้ลงทะเบียนอาจไม่ใช่ผู้ปกครองของเด็กทุกคน |
| D15 | Kiosk payload ไม่มี `consent` → 400 | รับแบบไม่มี consent ช่วง deploy — client/server deploy พร้อมกัน |
| D16 | ข้อความ notice โหมดพื้นฐานเปลี่ยนเป็น「…แต่ชื่อของท่านจะไม่แสดงในระบบค้นหาญาติ ข้อมูลจะไม่ถูกส่งต่อให้หน่วยงานภายนอก และจะไม่มีการประสานเยียวยาผ่านระบบ…」 (`notice_version` 2026-10-26) | ข้อความ prototype「เก็บเฉพาะข้อมูลที่จำเป็นต่อความปลอดภัยของชีวิต」 — ขัดกับ D8 ที่บันทึกฟิลด์ลงทะเบียนตามปกติ (owner อนุมัติ 2026-10-26). **ถูกแทนที่โดย D21** (ไม่มี notice โหมดพื้นฐานแล้ว) |
| D17 | ยกเลิก C4 — กดยินยอมครั้งเดียวมีผลกับทุกคน, สมาชิกอื่นเป็น `household_member` ทั้งหมด (ทุกช่องทาง). **แทนที่ D14** | คง C4 + เลือกรายคน — ผู้ใช้งง และช้าที่หน้าศูนย์; ตั้ง `guardian` ตามอายุอัตโนมัติ — ผู้ลงทะเบียนอาจไม่ใช่ผู้ปกครอง (เหตุผลเดียวกับ D14) |
| D18 | C1 คำสั้น「…เพื่อใช้งานระบบ และประสานกับหน่วยงานที่เกี่ยวข้อง」; ข้อความเต็มคงวัตถุประสงค์ครบ แก้「สมาชิกในครอบครัวที่อยู่ในความดูแล」 เป็น「สมาชิกทุกคนที่ลงทะเบียนร่วมในครั้งนี้」 | ระบุวัตถุประสงค์ในคำสั้น — ยาว; ตัดวัตถุประสงค์ออกจากข้อความเต็ม — PDPA ต้องแจ้งวัตถุประสงค์ |
| D19 | การ์ดเดียว + ปุ่ม「ยอมรับทั้งหมด」 (A + C1–C3, ไม่รวม C5) และ C2/C3 ซ้อนใต้ C1; ทุกช่องทาง. แก้ FR-10 | checkbox อิสระ (FR-10 เดิม) — ติ๊ก C2/C3 ได้ทั้งที่ระบบทิ้งค่าเมื่อ C1 ไม่ติ๊ก ทำให้ผู้ใช้งง |
| D20 | คำสั้นสรรพนาม「ท่าน」 + ปุ่ม「ดูข้อความเต็ม」 ข้อความเต็มคงตามที่อนุมัติ (D11). ลิงก์ `/term` `/policy` ทุกช่องทางยกเว้น kiosk | แทนข้อความเต็มด้วยคำสั้น — ต้องขออนุมัติข้อความใหม่; ลิงก์บน kiosk — เปิดแท็บใหม่แล้วหลุด flow ที่ล็อกหน้าจอ |
| D21 | C1 ไม่ติ๊ก → บันทึกไม่ได้ ทุกช่องทาง (เหมือน checkbox ยินยอมแบบเดิมก่อนมีบล็อก). ยกเลิกโหมดพื้นฐานสำหรับการลงทะเบียนใหม่; แทนที่ FR-11/FR-17/FR-18 เดิมและ D16 | คงโหมดพื้นฐาน — ผู้ใช้เข้าใจว่ากดผ่านได้โดยไม่ยินยอม; ล็อกเฉพาะ pre-register — owner เลือกทุกช่องทาง |
| D22 | ตัดประโยค "ไม่ยินยอม/ถอนความยินยอมก็ยังได้รับความช่วยเหลือขั้นพื้นฐาน" ออกจาก `/policy` (intro, closing) และ `/term` (ข้อสิทธิ) TH/EN | คงข้อความ — ขัดกับ D21 |
| D23 | Pre-register ย้ายข้อรับทราบศูนย์/คิวกลางเข้ากลุ่ม A ของบล็อก, ตัด「และยินยอมให้เก็บข้อมูล…」 ออก (ซ้ำกับ C1), ไม่ติ๊ก A → ปุ่มส่ง disable | การ์ดแยกเดิม + toast หลังกดส่ง — แยกหลายจุด และเลือกศูนย์แล้วกดส่งได้ก่อนติ๊ก |

Owner อนุมัติ spec 2026-10-25. รอบปรับ UX (D17–D23) owner อนุมัติ 2026-10-27.
