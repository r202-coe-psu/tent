---

## title: รายงานทดสอบ E2E — Flow ลงทะเบียนล่วงหน้า (Pre-register) จากหน้าแรก
date: 2026-10-08
updated: 2026-10-08
type: qa-report
scope: public SPA `/` → `/pre-register` → ใบลงทะเบียน/QR

# รายงานทดสอบ Flow ลงทะเบียนล่วงหน้า (Pre-register)

## สรุปผู้บริหาร


| รายการ             | ผล                             |
| ------------------ | ------------------------------ |
| จำนวนกรณีทดสอบ     | 18 (TC01–TC18)                 |
| ผ่าน               | 17                             |
| **ไม่ผ่าน (บั๊ก)** | **1 — ระดับ High** (TC12/TC13) |
| ข้อสังเกต UI/UX    | 5 รายการ (Low)                 |


Flow หลักตั้งแต่หน้าแรกจนส่งฟอร์มสำเร็จ **ใช้งานได้** ข้อมูลถูกบันทึกลง MongoDB ครบทุกฟิลด์
(ที่อยู่, สมาชิก 2 คน, กลุ่มเปราะบาง, ผู้ติดต่อฉุกเฉิน, สัตว์เลี้ยง) และ validation ฝั่ง client ทำงานถูกต้อง

**แต่พบบั๊กร้ายแรง:** ใบลงทะเบียน (QR) แบบ "ไม่ระบุศูนย์พักพิง" **ถูกลบออกจากอุปกรณ์ทันที**
เมื่อผู้ใช้เปิดแท็บ "ใบลงทะเบียนของฉัน" หรือรีโหลดหน้า และระบบขึ้นข้อความผิดว่า
"ใบลงทะเบียนได้รับการยืนยันเข้าศูนย์พักพิงแล้ว" ทั้งที่ยังไม่ได้ยืนยัน — ผู้ใช้จึงทำ QR หาย
และ **ลงทะเบียนใหม่ไม่ได้ด้วย** เพราะติด `DUPLICATE_OPEN_IDENTITY` (ดู [BUG-01](#bug-01))

## สภาพแวดล้อมการทดสอบ


| รายการ          | ค่า                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------- |
| วันที่          | 2026-10-08                                                                                        |
| Branch / commit | `develop` @ `408f2b4c` (+ working tree ที่ยังไม่ commit ใน `unified-registration*`)               |
| Frontend        | Vite dev server `http://localhost:5173`                                                           |
| Backend         | FastAPI `:9000`, CouchDB, MongoDB `tentdb`, sync-worker (docker compose — healthy)                |
| reCAPTCHA       | ปิด (`/api/public/v1/recaptcha` → `{"enabled":false}`)                                            |
| เครื่องมือ      | Playwright (Chromium headless) — สคริปต์ `[run-pre-register-e2e.cjs](./run-pre-register-e2e.cjs)` |
| Viewport        | Desktop 1440×900, Mobile 390×844                                                                  |
| Mock            | **ไม่มี** — ยิง API จริงทั้งหมด, เขียนข้อมูลจริงลง dev DB                                         |


ข้อมูลศูนย์ ณ วันทดสอบ: SH001–SH004 เปิดอยู่ทั้งหมด แต่ `accepts_pre_registration = false`
ทุกศูนย์ → dropdown จึงมีแค่ตัวเลือก **"ไม่ระบุศูนย์พักพิง"** (Unassigned Registration, CR-113)
รายงานนี้จึงครอบคลุมเส้นทาง `POST /api/public/v1/unassigned-registrations` เท่านั้น
(ไม่ได้ทดสอบการจองแบบระบุศูนย์ `POST /api/public/v1/registrations`)

---



## ผลการทดสอบรายกรณี


| #    | กรณีทดสอบ                                                    | ผล                    | หลักฐาน                                                |
| ---- | ------------------------------------------------------------ | --------------------- | ------------------------------------------------------ |
| TC01 | เปิดหน้าแรก                                                  | ✅ PASS                | 01, 02                                                 |
| TC02 | กด CTA "ลงทะเบียนผู้ประสบภัยล่วงหน้า" → `/pre-register`      | ✅ PASS                | 03, 04, 05                                             |
| TC03 | ตัวเลือกศูนย์พักพิง                                          | ✅ PASS                | 06                                                     |
| TC04 | ปุ่มยืนยันถูก disable จนกว่าจะยอมรับเงื่อนไข / ส่งฟอร์มว่าง  | ✅ PASS                | 07, 08, 09                                             |
| TC05 | ที่อยู่ + cascade จังหวัด→อำเภอ→ตำบล + รหัสไปรษณีย์อัตโนมัติ | ✅ PASS                | 10–13                                                  |
| TC06 | ยังไม่เลือกเพศ → error เพศ                                   | ✅ PASS                | 14                                                     |
| TC07 | กรอกผู้ติดต่อหลัก + ผู้ติดต่อฉุกเฉิน                         | ✅ PASS                | 15, 16                                                 |
| TC08 | เพิ่มสมาชิกคนที่ 2 + กลุ่มเปราะบาง                           | ✅ PASS                | 17, 18                                                 |
| TC09 | เพิ่มสัตว์เลี้ยง (แมว)                                       | ✅ PASS                | 19                                                     |
| TC10 | ยอมรับเงื่อนไข + Live Summary                                | ✅ PASS                | 20, 21                                                 |
| TC11 | ส่งฟอร์ม → ได้ใบลงทะเบียน + QR                               | ✅ PASS                | 22, 23                                                 |
| TC12 | เปิดแท็บ "ใบลงทะเบียนของฉัน"                                 | ❌ **FAIL**            | 24                                                     |
| TC13 | รีโหลดหน้า → ใบลงทะเบียนยังอยู่                              | ❌ **FAIL**            | 25, 26                                                 |
| TC14 | ลงทะเบียนซ้ำด้วยเลขบัตร/เบอร์เดิม                            | ✅ PASS (แต่ดู BUG-01) | 27                                                     |
| TC15 | Responsive มือถือ 390px                                      | ✅ PASS                | 28–30                                                  |
| TC16 | สลับภาษา EN                                                  | ✅ PASS                | 31                                                     |
| TC17 | เลขบัตรประชาชนผิด checksum                                   | ✅ PASS                | 32                                                     |
| TC18 | เบอร์โทรไม่ครบ 10 หลัก                                       | ✅ PASS                | 33                                                     |
| —    | ตรวจข้อมูลใน MongoDB                                         | ✅ PASS                | [ภาคผนวก B](#ภาคผนวก-b--ข้อมูลที่บันทึกจริงใน-mongodb) |


> TC12 และ TC13 เป็นอาการของบั๊กตัวเดียวกัน (BUG-01) จึงนับเป็นบั๊ก 1 รายการ

---



## รายละเอียดทีละขั้นตอน



### TC01 — เปิดหน้าแรก

- โหลด `/` สำเร็จ (~1.9 วินาที, networkidle) ไม่มี JS error
- มีลิงก์ไป `/pre-register` 3 จุด: ปุ่ม "ลงทะเบียน" มุมขวาบน, เมนู "ลงทะเบียนล่วงหน้า", ปุ่ม CTA ใน hero

![หน้าแรก hero](./screenshots/01-home-hero.png)

หน้าแรกแบบเต็มหน้า

![หน้าแรกเต็มหน้า](./screenshots/02-home-full.png)



### TC02 — กด CTA → หน้าลงทะเบียน

- กดปุ่ม **"ลงทะเบียนผู้ประสบภัยล่วงหน้า"** → ไปที่ `/pre-register?shelter=unassigned`
- `<title>` = `ลงทะเบียนเข้าศูนย์พักพิงล่วงหน้า | SmartShelter`
- หน้าแสดง: แท็บ "ลงทะเบียนใหม่ / ใบลงทะเบียนของฉัน", กล่องเลือกศูนย์, Live Summary ด้านซ้าย,
stepper 3 ขั้น (ที่พักอาศัย → สมาชิก → สัตว์เลี้ยง), ฟอร์ม, และกล่องเงื่อนไขการใช้งาน

![hover CTA](./screenshots/03-home-cta-hover.png)

![หน้า pre-register ส่วนบน](./screenshots/04-pre-register-top.png)

หน้า pre-register แบบเต็มหน้า

![pre-register เต็มหน้า](./screenshots/05-pre-register-full.png)



### TC03 — ตัวเลือกศูนย์พักพิง

- มีตัวเลือกเดียว: **"📍 ไม่ระบุศูนย์พักพิง — ลงทะเบียนล่วงหน้าโดยไม่ระบุศูนย์ (ยืนยันศูนย์เมื่อเดินทางถึง)"**
- ถูกต้องตามข้อมูล เพราะไม่มีศูนย์ใดเปิด `accepts_pre_registration`
- มีกล่องเตือน "การลงทะเบียนล่วงหน้า จะไม่การันตีว่าคุณจะได้เข้าพักในศูนย์"

![dropdown ศูนย์](./screenshots/06-shelter-dropdown.png)

### TC04 — ปุ่มยืนยัน + ส่งฟอร์มว่าง

- ก่อนติ๊กยอมรับเงื่อนไข ปุ่ม "ยืนยันการลงทะเบียน" **disabled** ✅
- ติ๊กเงื่อนไขแล้วกดส่งขณะฟอร์มว่าง → **ไม่มี request ออกไป** ✅, focus กระโดดไปช่อง "ชื่อ" ✅
- แสดง error ทั้ง toast และใต้ช่อง: กรุณากรอกชื่อ / กรุณาเลือกเพศ / กรุณากรอกบ้านเลขที่ จังหวัด อำเภอ และตำบล

![ปุ่ม disabled](./screenshots/07-submit-disabled-before-consent.png)

![validation ฟอร์มว่าง](./screenshots/08-empty-submit-viewport.png)

validation แบบเต็มหน้า

![validation เต็มหน้า](./screenshots/09-empty-submit-full.png)



### TC05 — ที่อยู่ + cascade

- ประเภทที่อยู่อาศัย: บ้านตนเอง / บ้านเช่า / คอนโด / อะพาร์ตเมนต์ / หอพัก / ไร้ที่อยู่อาศัยเป็นหลักแหล่ง
- กรอก: จุดสังเกต "ใกล้ตลาดคอหงส์", บ้านเลขที่ 99/9, "หมู่ 3 ถ.กาญจนวนิช"
- เลือก สงขลา → หาดใหญ่ → คอหงส์ (ข้อมูลจริงจาก API) → รหัสไปรษณีย์เติมอัตโนมัติ **90110** ✅

![ประเภทที่อยู่อาศัย](./screenshots/10-housing-type-options.png)

![เลือกจังหวัด](./screenshots/11-province-picker.png)

![เลือกตำบล](./screenshots/12-subdistrict-picker.png)

![ที่อยู่ครบ](./screenshots/13-address-filled.png)

### TC06 — ยังไม่เลือกเพศ

กรอกชื่อแต่ไม่เลือกเพศ แล้วกดส่ง → error "กรุณาเลือกเพศ" ✅ (ดูข้อสังเกต OBS-02 เรื่องข้อความซ้ำใน toast)

![error เพศ](./screenshots/14-invalid-id-phone.png)

### TC07 — ผู้ติดต่อหลัก + ผู้ติดต่อฉุกเฉิน

- ชื่อ `ทดสอบคิวเอ พรีรีจิส02870`, ชื่อเล่น `คิวเอ`, เลขบัตร `1990102870128` (checksum ถูก), เพศชาย, โทร `0812345870`
- ปีเกิด พ.ศ. 2530 → **อายุคำนวณอัตโนมัติ 39 ปี** ✅
- ผู้ติดต่อฉุกเฉิน: สมศรี ทดสอบ / 0899999999 / มารดา

![ผู้ติดต่อหลัก](./screenshots/15-head-member-filled.png)

![ผู้ติดต่อฉุกเฉิน](./screenshots/16-emergency-contact.png)

### TC08 — สมาชิกคนที่ 2 + กลุ่มเปราะบาง

- กด "เพิ่มสมาชิก" → การ์ด "สมาชิก 2" ปรากฏ, badge จำนวนสมาชิกเปลี่ยนเป็น 2 คน ✅
- `ยายทดสอบ`, เพศหญิง, ปีเกิด 2485 (อายุ 84), เลือก **ผู้สูงอายุช่วยเหลือตัวเองไม่ได้** + **ใช้วีลแชร์**
- สมาชิกที่ไม่ใช่หัวหน้าครอบครัว มีตัวเลือก "ไม่มีเบอร์โทรศัพท์" (หัวหน้าครอบครัวไม่มี — ถูกต้องตาม e2e เดิม)
- Live Summary อัปเดตทันที: "สมาชิกครอบครัว 2 คน", "กลุ่มดูแลพิเศษ 1 คน"

![สมาชิกคนที่ 2](./screenshots/17-member2-filled.png)

![กลุ่มเปราะบาง](./screenshots/18-member2-vulnerable.png)

### TC09 — สัตว์เลี้ยง

กดขยายหัวข้อ "สัตว์เลี้ยง" → "เพิ่มแมว" → ชื่อ `ส้มจี๊ด`, หมายเหตุ "แมวไทย ฉีดวัคซีนแล้ว", ติ๊ก "มีกรง / สายจูง / ตะกร้า" ✅

![สัตว์เลี้ยง](./screenshots/19-pet-added.png)

### TC10 — เงื่อนไข + Live Summary

![ยอมรับเงื่อนไข](./screenshots/20-consent-checked.png)

![Live Summary](./screenshots/21-live-summary.png)

### TC11 — ส่งฟอร์ม → ใบลงทะเบียน + QR

- `POST /api/public/v1/unassigned-registrations` → **201** (77 ms)
- id = `01M4CXN810TESQA79TTPFX08HF`, `reserved_household_id = household:01M4CXN810VP5WF3Y3HYY675XQ`
- toast "ลงทะเบียนสำเร็จ", แสดง QR + ชื่อผู้ลงทะเบียน + สถานะ "รอรับเข้าศูนย์พักพิง" + จำนวนสมาชิก 2 คน + เวลา
- มีปุ่ม: ดาวน์โหลด PDF / บันทึก PNG / "ยืนยันที่ศูนย์แล้ว (ลบใบลงทะเบียน)"
- ticket ถูกเก็บลง `localStorage["smartshelter_public_booking_tickets"]` พร้อม `type: "unassigned_queue"` ✅

![หลังส่งสำเร็จ](./screenshots/22-after-submit.png)

ใบลงทะเบียนแบบเต็มหน้า

![ใบลงทะเบียนเต็มหน้า](./screenshots/23-ticket-full.png)



### TC12 / TC13 — ใบลงทะเบียนของฉัน + รีโหลด ❌

ดูรายละเอียดที่ [BUG-01](#bug-01)

![ใบลงทะเบียนของฉัน — ticket หาย](./screenshots/24-my-tickets.png)

![หลังรีโหลด](./screenshots/25-reload-top.png)

![หลังรีโหลด — แท็บใบลงทะเบียนของฉันว่าง](./screenshots/26-reload-my-tickets.png)

### TC14 — ลงทะเบียนซ้ำ

ใช้เลขบัตร + เบอร์เดิม → `409 {"error":"DUPLICATE_OPEN_IDENTITY"}` → toast
"มีผู้ลงทะเบียนด้วยบัตรหรือเบอร์นี้อยู่แล้วในคิวกลาง" ✅ ป้องกันซ้ำได้ถูกต้อง

![duplicate](./screenshots/27-duplicate-result.png)

### TC15 — มือถือ 390×844

ไม่มี horizontal scroll (overflow 0px) ✅ — ปุ่ม/แท็บตัดบรรทัดได้อ่านออก (ดู OBS-04)


| หน้าแรก                               | pre-register                                  | ฟอร์มสมาชิก                             |
| ------------------------------------- | --------------------------------------------- | --------------------------------------- |
| ![](./screenshots/28-mobile-home.png) | ![](./screenshots/29-mobile-pre-register.png) | ![](./screenshots/30-mobile-member.png) |




### TC16 — ภาษาอังกฤษ

กด EN → H1 เปลี่ยนเป็น "Pre-register for a shelter" ✅

![EN](./screenshots/31-english.png)

### TC17 / TC18 — validation เลขบัตร / เบอร์โทร

กรอกทุกช่องถูกต้องยกเว้นช่องที่ทดสอบ → ไม่มี request ออกไป, focus ไปที่ช่องที่ผิด ✅

- เลขบัตร `1234567890123` → "เลขบัตรประชาชนไม่ถูกต้อง (ตรวจสอบหลักสุดท้ายอีกครั้ง)"
- เบอร์ `08123` → "กรุณากรอกเบอร์โทรศัพท์ 10 หลักของผู้ติดต่อหลัก"

![เลขบัตรผิด](./screenshots/32-invalid-national-id.png)

![เบอร์ผิด](./screenshots/33-invalid-phone.png)

---



## บั๊กที่พบ



### BUG-01

**ใบลงทะเบียนแบบ "ไม่ระบุศูนย์" ถูกลบจากอุปกรณ์ทันที และขึ้นข้อความผิดว่า "ได้รับการยืนยันแล้ว"** — ระดับ **High**

**ขั้นตอนทำซ้ำ**

1. `/` → กด "ลงทะเบียนผู้ประสบภัยล่วงหน้า"
2. กรอกฟอร์ม (ไม่ระบุศูนย์) → ยืนยัน → ได้ QR (201)
3. กดแท็บ "ใบลงทะเบียนของฉัน" **หรือ** รีโหลดหน้า

**ผลที่ได้:** รายการว่าง "ไม่พบใบลงทะเบียนในอุปกรณ์นี้" + toast
"ใบลงทะเบียนได้รับการยืนยันเข้าศูนย์พักพิงแล้ว ระบบได้ลบข้อมูลออกจากอุปกรณ์" — `localStorage` เหลือ `[]`

**ผลที่ควรได้:** ticket ยังอยู่ สถานะ "รอรับเข้าศูนย์พักพิง" จนกว่าเจ้าหน้าที่จะ claim

**ผลกระทบ:** ผู้ประสบภัยทำ QR หาย และ **ลงทะเบียนใหม่ไม่ได้** เพราะ
เลขบัตร/เบอร์ติด `DUPLICATE_OPEN_IDENTITY` (TC14) — ทางเดียวที่เหลือคือให้เจ้าหน้าที่ค้นจากเลขบัตร/เบอร์ที่ศูนย์

**สาเหตุ (ตรวจสอบแล้ว)**

- `pre-register/+page.svelte` (`syncTicketsStatus`) และ `ticket-history.svelte` (`syncAllStatus`)
เรียก `checkTicketStatus()` ทุก ticket แล้ว **ลบทิ้งเมื่อได้** `notFound`
- BFF `src/routes/api/public/v1/registrations/status/+server.ts` สำหรับคิวกลาง fallback ไปเรียก
FastAPI `GET /staff/v1/unassigned-registrations/{id}` ด้วย `fastapiServiceHeaders()` (Bearer `EXTERNAL_API_SECRET`)
- แต่ route นั้นใน `backend/apiapp/modules/unassigned_registrations/router.py` ใช้
`Depends(require_system_admin)` (ต้องเป็น staff session ของ system admin) → ตอบ **401**:
  ```
  $ curl -H "Authorization: Bearer $EXTERNAL_API_SECRET" \
      http://localhost:9000/staff/v1/unassigned-registrations/01M4CXN810TESQA79TTPFX08HF
  {"errors":[{"error":{"code":"UNAUTHENTICATED","message":"Authentication required"}}]}  HTTP 401
  ```
- BFF ตีความทุกกรณีที่ `!res.ok` เป็น `{ notFound: true, error: 'BOOKING_NOT_FOUND' }` → client ลบ ticket
และใช้ toast ของกรณี "verified" ทั้งที่จริงเป็น "not found"

- **บั๊กซ้อน (พบตอนไล่โค้ดเพื่อแก้):** BFF ตีความ `verified = status === 'claimed' || status === 'processed'`
แต่ claim flow จริงตั้งสถานะ doc เป็น `open` (claim บางส่วน) หรือ `closed` (claim ครบ)
(`use_case.py` claim; `DocumentStatus` ใน `tent_model/unassigned_registration.py` คือ
`open|closed|claimed|partial_claim` และไม่มี `processed`) ดังนั้นต่อให้แก้เรื่อง auth แล้ว
ticket ก็จะไม่มีวันถูกมองเป็น verified — ต้องแก้เป็น `claimed = members_claimed > 0 and status in (closed, claimed)`
และให้ claim บางส่วน (`open`) ยังนับเป็น pending (สมาชิกที่เหลือยังต้องใช้ QR)

Network log ระหว่างทดสอบ:

```
POST /api/public/v1/unassigned-registrations  201  {"success":true,"id":"01M4CXN810TESQA79TTPFX08HF",...}
POST /api/public/v1/registrations/status      200  {"success":true,"verified":false,"notFound":true,"error":"BOOKING_NOT_FOUND"}
```

**แนวทางแก้ (เสนอ)**

1. เพิ่ม endpoint สถานะแบบ service-auth (`verify_external_secret`) ฝั่ง FastAPI เช่น
  `GET /public/v1/unassigned-registrations/{id}/status` คืนเฉพาะ `status` แล้วให้ BFF เรียกตัวนี้
2. BFF ควรแยก "หาไม่เจอจริง (404)" กับ "upstream error (401/5xx)" — กรณีหลังห้ามคืน `notFound`
3. Client ไม่ควรลบ ticket เมื่อสถานะไม่แน่นอน และ toast "ได้รับการยืนยันแล้ว" ควรแสดงเฉพาะกรณี `verified`
4. เพิ่ม e2e: submit → เปิดแท็บประวัติ → reload → ticket ยังอยู่ (e2e เดิม mock ทุก API จึงจับไม่ได้)

> การแก้ข้อ 1 คือการเพิ่ม API ฝั่ง public plane — ควรตัดสินใจเรื่อง Change Record ตาม
> `docs/change-management.md` ก่อน

---

