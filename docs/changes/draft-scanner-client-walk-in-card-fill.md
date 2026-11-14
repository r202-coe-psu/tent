---
id: draft # draft (ตอน proposed) -> เปลี่ยนเป็น CR-NNN เมื่อเจ้าของโครงการ approve
title: Scanner client — เสียบบัตรประชาชนที่ notebook แล้วเติมฟอร์มลงทะเบียน walk-in
status: proposed
date: 2026-11-14
created: 2026-11-14
updated: 2026-11-14
requested_by: ทีม kiosk — หน่วยงานพันธมิตรที่ไม่มีตู้ Kiosk แต่มี notebook + เครื่องอ่านบัตร USB (#1326 / PR #1355)
decided_by: รอเจ้าของโครงการ approve
layer: volatile
affects:
  - frontend/src/lib/features/people/domain/scanner-card.ts (ใหม่ — scannerCardSchema, cardToUnifiedMember, applyScannedCard)
  - frontend/src/lib/features/people/domain/{unified-registration,instant-duplicate}.ts
  - frontend/src/lib/features/people/ui/registration/unified-registration-form.svelte (handler scanner:*)
  - frontend/src/routes/(protected)/onsite/people/new/+page.svelte (ตรวจซ้ำตอนเสียบบัตร)
  - frontend/src/lib/constants/i18n/staff-registration-desk.ts (copy th/en)
  - scanner-client/ (โปรแกรมใหม่ Python + Playwright)
  - kiosk/app/scard.py (ใช้ร่วม ไม่แก้)
  - no schema_v bump — ไม่มี field ใหม่ ข้อมูลที่บันทึกรูปร่างเดิม
why: >
  เจ้าหน้าที่ Station 1 ของหน่วยงานที่ไม่มีตู้ Kiosk ต้องพิมพ์ข้อมูลจากบัตรประชาชนเองทีละช่อง ไม่มีรูป
  และรู้ว่าคนนี้ลงทะเบียนแล้วก็ต่อเมื่อกดบันทึก notebook กับเครื่องอ่านบัตร USB มีอยู่แล้ว
  จึงให้โปรแกรมบนเครื่องอ่านบัตรแล้วเติมฟอร์ม walk-in ให้ เจ้าหน้าที่ตรวจแล้วกดบันทึกเอง
migration: N/A — ไม่เปลี่ยนรูปร่าง doc ที่ persist
---

# Scanner client — เสียบบัตรประชาชนที่ notebook แล้วเติมฟอร์มลงทะเบียน walk-in

> **สรุป (TL;DR):**
>
> - **เพิ่มอะไร:** โปรแกรม `scanner-client` บน notebook เปิด browser ไปที่ระบบ เจ้าหน้าที่ login ด้วยบัญชีตัวเอง
>   เสียบบัตรแล้วหน้า ลงทะเบียน walk-in (`/onsite/people/new`) เติมข้อมูลสมาชิกให้ และแนบรูปจากชิปตามมา
> - **business behavior ใหม่ที่หน้า walk-in:** ตรวจคนซ้ำทันทีตอนเสียบบัตร (D3), ถามก่อนเขียนทับสมาชิกที่มีข้อมูล (D1),
>   รูปจากชิปเป็นรูปของสมาชิกคนที่เลขบัตรตรง (D2)
> - **ไม่เปลี่ยน:** schema, `schema_v`, ตรวจซ้ำตอนบันทึก (override เดิม), ช่องทางลงทะเบียน (`registered_via: 'staff'`)
> - **ไม่มี event `scanner:*` = หน้า walk-in ทำงานเหมือนเดิม**

---

## Why

- หน้า walk-in ต้องพิมพ์ชื่อ นามสกุล เพศ ปีเกิด เลขบัตร และที่อยู่เองทุกคน ช้าและพิมพ์ผิดได้ ไม่มีรูป
- คนซ้ำ (อยู่ในศูนย์หรือคิวกลางแล้ว) รู้ตอนกดบันทึก หลังจากกรอกทั้งครอบครัวไปแล้ว
- หน่วยงานพันธมิตรไม่มีงบตู้ Kiosk แต่มี notebook Windows กับเครื่องอ่านบัตร CCID
- ตู้ Kiosk อ่านบัตรได้อยู่แล้ว (`kiosk/app/scard.py`) จึงใช้ตัวอ่านเดิมร่วมกัน

## Change

### Functional requirements — หน้า walk-in (feature `people`)

1. **FR-1 รับ event เฉพาะหน้า walk-in:** หน้า `/onsite/people/new` ฟัง event `scanner:*` บน `window`
   ผูก/ถอด listener ตาม lifecycle ของหน้า หน้าอื่นไม่รับ ไม่มีโปรแกรม client = หน้าทำงานเหมือนเดิม
2. **FR-2 validate ก่อนใช้:** detail ของทุก event ผ่าน Zod (`scannerCardSchema`, `scannerCardPhotoSchema`,
   `scannerCardErrorSchema`) ไม่ผ่าน = ไม่ตอบรับและไม่แตะฟอร์ม
3. **FR-3 เติมสมาชิก:** ใส่ชื่อ นามสกุล เพศ ปีเกิด (เก็บเป็น พ.ศ.) / อายุ และเลขบัตร (`cardType: 'national_id'`)
   ลงสมาชิกคนแรกที่ยังว่าง (ไม่มีชื่อและไม่มีเลขบัตร) ข้อมูลบัตรชนะค่าในช่องที่บัตรมี
4. **FR-4 เติมที่อยู่ครัวเรือน:** เติมเฉพาะตอนที่อยู่ยังว่างทุกช่อง normalize แบบเดียวกับหน้ารับรายงานตัว
   (`cleanAreaPrefix`, join หมู่/ซอย/ถนน) บัตรใบถัดไปไม่ทับที่อยู่ บัตรไม่มีรหัสไปรษณีย์
5. **FR-5 (D3) ตรวจซ้ำตอนเสียบ:** ค้นเลขบัตรทันทีด้วยแหล่งเดียวกับตอนบันทึก (ศูนย์ CouchDB + คิวกลาง unassigned)
   - พบ → dialog "พบบุคคลนี้ในระบบแล้ว" ปุ่ม "ไปหน้าคนนั้น" / "ลงทะเบียนต่อ"
   - "ลงทะเบียนต่อ" → เติมฟอร์ม และตอนบันทึกยังผ่าน override ตรวจซ้ำเดิม (CR-115) ไม่ข้าม
   - ค้นไม่สำเร็จ → toast เตือน แล้วเติมฟอร์มต่อ
6. **FR-6 (D1) ถามก่อนทับ:** ไม่มีสมาชิกว่าง → dialog "ทับคนที่ N / เพิ่มเป็นสมาชิกใหม่ / ยกเลิก"
   ยกเลิก = ฟอร์มไม่เปลี่ยนและล้างข้อมูลบัตรจาก state · บัตรที่เลขตรงกับสมาชิกในฟอร์มแล้ว → แจ้ง "บัตรนี้อยู่ในฟอร์มแล้ว"
7. **FR-7 (D2) รูปจากชิป:** แปลง data URL เป็น File → `saveImage` เดิม → `member.photo = image:` id
   ของสมาชิกที่เลขบัตรตรง
   - รูปมาตอน dialog ยังเปิด → พักไว้ แล้วแนบหลังเจ้าหน้าที่เลือก
   - สมาชิกถูกลบ / แก้เลขบัตร / บันทึกไปแล้ว ก่อนรูปมา → ทิ้งรูป
   - ปุ่มบันทึกไม่ถูกบล็อกระหว่างรอรูป
8. **FR-8 feedback:** toast ความคืบหน้าอันเดียวต่อบัตรหนึ่งใบ ("กำลังอ่านบัตร…" → "กำลังอ่านรูป…" → "อ่านบัตรเรียบร้อย")
   อ่านพลาด → "อ่านบัตรไม่สำเร็จ ลองเสียบใหม่" · copy อยู่ใน `staff-registration-desk.ts` ทั้ง th/en
9. **FR-9 ข้อมูลบัตร:** ไม่เข้า URL / localStorage / sessionStorage / console

### Event contract (client → หน้าเว็บ)

`window.dispatchEvent(new CustomEvent(name, { detail, cancelable: true }))` · หน้าเว็บตอบรับด้วย `event.preventDefault()`

| event                  | detail                                         | หน้าเว็บทำ                                        |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `scanner:card-reading` | `{}`                                           | สถานะ "กำลังอ่านบัตร…"                            |
| `scanner:card-read`    | `ScannerCard` (ไม่มีรูป)                       | ตรวจซ้ำ → เลือกช่อง / ถามก่อนทับ → เติมฟอร์ม      |
| `scanner:card-photo`   | `{ citizen_id, photo_base64 }` (JPEG data URL) | ผูกรูปกับสมาชิกที่เลขบัตรตรง · ไม่มีใครตรง → ทิ้ง |
| `scanner:card-error`   | `{ code: 'READ_FAILED' \| 'PHOTO_FAILED' }`    | toast                                             |

`ScannerCard` = `citizen_id, first_name_th, last_name_th, gender, birth_date, birth_year_ce, age, address_no, village_no,
lane, road, subdistrict, district, province, scanned_at` · ไม่ส่งชื่ออังกฤษ ผู้ออกบัตร วันออก/หมดอายุ

### Functional requirements — โปรแกรม `scanner-client`

1. **FR-C1 ไม่มี secret บนเครื่อง:** เจ้าหน้าที่ login ด้วยบัญชีตัวเองในหน้าต่าง browser · สิทธิ์ตาม guard เดิมของหน้า walk-in
   (`requireEvacueeRegistration` — SA / SM / `registration_staff` ของศูนย์)
2. **FR-C2 ส่งให้ origin เดียว:** ก่อนส่ง event ทุกครั้ง ตรวจว่าแท็บอยู่ที่ origin ของ `SHELTER_URL` + path walk-in
   - อยู่หน้าอื่นของระบบ → พาไปหน้า walk-in ใน tab เดิม
   - ถูก redirect ไปหน้า login หรือไปเว็บอื่น → ทิ้งข้อมูลบัตร + log เตือน
   - ส่งซ้ำทุก 0.5 วิ จนหน้าเว็บตอบรับ สูงสุด 15 วิ ไม่ตอบรับ → ทิ้ง
3. **FR-C3 `SHELTER_URL`:** ต้องเป็น origin เปล่า (ไม่มี path / query / user:pass) และ host เป็น ASCII เท่านั้น
   - `https` เสมอ ยกเว้น localhost / loopback / IP วง LAN (เครื่อง edge ใช้ http :80)
   - ค่าไม่ใช่ `https://shelter.psu.ac.th` → กล่องเตือนสีแดง ต้องติ๊กยืนยันทุกครั้งที่เปิดโปรแกรม
4. **FR-C4 อ่าน 2 จังหวะ:** ข้อความก่อน (`scanner:card-read`) แล้วรูป (`scanner:card-photo`) · รอถอดบัตรก่อนอ่านใบถัดไป
5. **FR-C5 เครื่องอ่าน:** เลือกตาม `CARD_READER_NAME` ถ้าตั้ง ไม่ตั้ง → ตัวแรกที่ไม่ใช่ virtual (ข้าม Windows Hello / TPM)
   ถอดแล้วเสียบใหม่ต่อเองได้
6. **FR-C6 ข้อมูลบัตรอยู่ในหน่วยความจำเท่านั้น:** log มีแค่ "อ่านบัตรแล้ว" / error code
7. **FR-C7 `KEEP_LOGIN`:** ค่าเริ่มต้น `false` (ปิดโปรแกรม = ต้อง login ใหม่) · `true` เก็บ profile ไว้ในเครื่อง
   เฉพาะเครื่องที่เจ้าหน้าที่ใช้คนเดียว
8. **FR-C8 หน้าแรก:** `START_PATH` ค่าเริ่มต้น `/admin-login`

### ข้อตัดสินใจของทีม

| #   | ข้อตัดสินใจ                                                                    | เหตุผล                                                                              |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| D1  | ฟอร์มเต็มแล้วถามก่อนทับ                                                        | ไม่ให้ข้อมูลที่เจ้าหน้าที่พิมพ์ไว้หายเงียบ ๆ                                        |
| D2  | รูปจากชิปเป็นรูปของสมาชิกที่เลขบัตรตรง ผ่าน `saveImage` เดิม                   | evacuee เก็บ `image:` id เหมือนรูปที่ถ่ายเอง ไม่มี data URL ใน doc                  |
| D3  | ตรวจซ้ำทันทีตอนเสียบ ด้วย query ชุดเดียวกับตอนบันทึก                           | รู้ก่อนกรอกทั้งครอบครัว ตอนบันทึกยังตรวจซ้ำอีกรอบเหมือนเดิม                         |
| D4  | การลงทะเบียนที่เติมจากบัตรบันทึก `registered_via: 'staff'` เหมือน walk-in ปกติ | เป็นช่องทาง walk-in — บัตรแค่ช่วยกรอก ไม่เพิ่ม field / ค่า enum ไม่ bump `schema_v` |
| D5  | พาไปหน้า walk-in ใน tab เดิม                                                   | เจ้าหน้าที่เห็นหน้าต่างเดียว ไม่มี tab ค้าง (ความเสี่ยงดูด้านล่าง)                  |
| D6  | `START_PATH` ค่าเริ่มต้น `/admin-login`                                        | หน้า login เจ้าหน้าที่ ปิดเรื่องแล้วในทีม                                           |
| D7  | ส่งข้อมูลบัตร 2 จังหวะ (ข้อความก่อน รูปทีหลัง)                                 | อ่านรูปใช้ ~20 APDU ช้ากว่าข้อความมาก ให้ฟอร์มเติมได้ก่อน                           |

### Out of scope

- ระบบ kiosk (`/kiosk/*`, kiosk API, device registry) — แค่ใช้ `scard.py` ร่วม
- เขียน `card_snapshot` / เปลี่ยน schema / bump `schema_v`
- field หรือ audit แยกว่าการลงทะเบียนนี้เติมจากบัตร (D4)
- installer แบบ sign, auto-update, CI build
- โปรแกรมกรอกช่องเอง (`page.fill`), เครื่องพิมพ์, face check, ล็อกเครื่อง

## Impact

- **frontend `people`:** domain ใหม่ `scanner-card.ts` (export ผ่าน barrel), handler ใน `unified-registration-form.svelte`,
  ตรวจซ้ำตอนเสียบใน `onsite/people/new/+page.svelte`, copy ใหม่ใน `staff-registration-desk.ts`
- **โฟลเดอร์ใหม่ `scanner-client/`:** โปรแกรม, build Windows (`build.ps1`), สคริปต์ Linux (`run-linux.sh`), README ไทย
- **`kiosk/app/scard.py`:** ไม่แก้ · มี test ฝั่ง client ที่จับว่า getter ที่ใช้ยังอยู่ครบ
- **ข้อมูลที่บันทึก:** รูปร่างเดิม — evacuee จาก walk-in, `photo` เป็น `image:` id, `registered_via: 'staff'`
- **test:** pytest ของ `scanner-client`, vitest `scanner-card.test.ts`, dom test `unified-registration-form.scanner.dom.test.ts`

## ความเสี่ยงที่ทีมรับไว้

- **tab เดิม (D5):** ถ้าเจ้าหน้าที่มีงานค้างที่ยังไม่บันทึกในหน้าอื่นแล้วเสียบบัตร browser จะถามก่อนออกจากหน้า
  ถ้ากด "อยู่หน้านี้" บัตรใบนั้นถูกข้าม ต้องเสียบใหม่
- **event `scanner:*` ไม่ยืนยันผู้ส่ง:** สคริปต์ใดก็ได้ใน origin เดียวกันส่ง event ปลอมได้ ยอมรับได้เพราะสคริปต์ใน origin
  เดียวกันอ่านหน้าได้อยู่แล้ว และเจ้าหน้าที่ตรวจฟอร์มก่อนบันทึกเสมอ · ห้ามใส่สคริปต์ third-party ในหน้า walk-in
- **http บน LAN:** เมื่อชี้ไปเครื่อง edge ข้อมูลบัตร รหัสผ่าน และ cookie `_session` วิ่งบน LAN แบบไม่เข้ารหัส
- **domain อื่น:** ตั้งได้ (ศูนย์ที่มี domain ของตัวเอง) แต่ต้องติ๊กยืนยันทุกครั้ง ไม่มี allowlist
- **Windows:** SmartScreen / Defender อาจบล็อก exe ที่ไม่ได้ sign · policy องค์กรอาจขวาง automation ของ Edge ·
  Edge อัปเดตแล้ว Playwright อาจไม่ตรงรุ่นจนต้อง rebuild

## Acceptance

- [ ] เสียบบัตรที่หน้า walk-in → สมาชิกคนแรกที่ว่างถูกเติม ชื่อ นามสกุล เพศ ปีเกิด/อายุ เลขบัตร ที่อยู่ที่ normalize แล้ว → รูปตามมาที่คนนั้น
- [ ] บันทึกแล้ว evacuee มี `photo` เป็น `image:` id และ `registered_via: 'staff'`
- [ ] ครอบครัว 3 คนเสียบทีละใบ → เติมคนที่ 1, 2, 3 · เสียบใบเดิมซ้ำ → "บัตรนี้อยู่ในฟอร์มแล้ว"
- [ ] ฟอร์มเต็มแล้วเสียบบัตรใหม่ → ทับ / เพิ่ม / ยกเลิก ทำงานตามที่เลือก · ยกเลิก → ฟอร์มไม่เปลี่ยน
- [ ] บัตรของคนในศูนย์ / คิวกลาง → dialog พบซ้ำตอนเสียบ · ตอนบันทึกยังขึ้น override เดิม
- [ ] ค้นซ้ำล้มเหลว → toast เตือนแล้วเติมฟอร์มต่อ
- [ ] ลบสมาชิก / แก้เลขบัตร / กดบันทึก ก่อนรูปมา → รูปไม่ไปติดใคร · ปุ่มบันทึกกดได้ตลอด
- [ ] ยังไม่ login หรือแท็บอยู่เว็บอื่น → ไม่มีข้อมูลบัตรถูกส่ง
- [ ] `SHELTER_URL` ที่ host ไม่ใช่ ASCII (เช่นตัวอักษร Cyrillic ที่หน้าตาเหมือน Latin) → ไม่เปิด
- [ ] เปิดหน้า walk-in โดยไม่มีโปรแกรม → ทำงานเหมือนเดิม
- [ ] ทดสอบบน Windows 11 (user ธรรมดา) + เครื่องอ่าน CCID — staging ก่อน production

## Open questions (รอเจ้าของโครงการ)

- ไม่มี — ข้อตัดสินใจ D1–D7 เป็นข้อเสนอของทีม รอเจ้าของโครงการ approve ทั้งชุด

## Migration

N/A — ไม่เปลี่ยนรูปร่าง doc ที่ persist ไม่ bump `schema_v`

## Decision log

- 2026-11-14 — proposed (draft) จาก #1326 / PR #1355 · ทีมเสนอ: ไม่ทำ audit แยกว่ามาจากบัตร ใช้ช่องทาง walk-in
  (`registered_via: 'staff'`) เดิม (D4) · tab เดิมเป็นความเสี่ยงที่รับไว้ (D5) · `START_PATH=/admin-login` ปิดเรื่องแล้ว (D6)
