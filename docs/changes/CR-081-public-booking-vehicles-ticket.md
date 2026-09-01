---
id: CR-081
title: Public booking — เก็บยานพาหนะ + ทะเบียนรถ, ใบจองดาวน์โหลดตรง และแสดงชื่อ-นามสกุลแทนรหัสจอง
status: approved
date: 2026-08-22
updated: 2026-08-31
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/features/site-occupancy-booking-program.md (ขอบเขตข้อมูลที่ public booking เก็บ)
  - docs/changes/CR-070-public-booking-gate-confirm.md (ต่อยอด — field list ของ booking form)
  - frontend/src/lib/features/public-register/domain/booking.ts + booking.test.ts
  - frontend/src/lib/features/public-register/ui/booking-form.svelte, booking-ticket.svelte
  - frontend/src/lib/features/public-register/application/booking-store.svelte.ts
  - frontend/src/lib/utils/pdf.ts
  - ไม่ bump schema_v (`household.vehicles[]` มีอยู่แล้วตั้งแต่ schema_v 4)
---

# CR-081 — Public booking: ยานพาหนะ + ใบจอง

## Why

**1. ยานพาหนะ.** เจ้าหน้าที่ต้องจัดที่จอดรถและระบุรถของแต่ละครัวเรือนได้ ฟอร์มจองผ่านเว็บ
(CR-070 / T-71) เก็บแค่คน + สัตว์เลี้ยง ทั้งที่ `household.vehicles[]` มีในสคีมาฝั่ง staff
อยู่แล้ว (schema_v 4, `{type, license_plate}`) — ข้อมูลที่ประชาชนรู้อยู่แล้วตอนจึงไม่ถูกเก็บ
แล้วต้องมาถามซ้ำที่ประตู

**2. ใบจอง — print dialog.** ปุ่มเดิมเรียก `window.print()` ประชาชนที่ใช้มือถือที่หน้าประตู
ศูนย์ต้องมาปิด print dialog เอง และไม่ได้ไฟล์เก็บไว้

**3. ใบจอง — รหัสจองไม่มีประโยชน์กับคน.** รหัสที่พิมพ์บนใบจองคือ evacuee ULID
(`bookingCodeFrom`) — 26 ตัวอักษรที่คนอ่านไม่ออกและ QR ก็ถือค่าเดียวกันอยู่แล้ว. เจ้าหน้าที่
ที่ประตูเทียบคนตรงหน้ากับ **ชื่อ** ไม่ใช่ ULID. เมนูตรวจสอบสถานะการจองด้วยรหัสถูกถอดออกไป
แล้ว (commit 9dd4a141) ประชาชนจึงไม่ต้องใช้รหัสนี้อีกเลย

## Change

### ฟอร์มจอง — ยานพาหนะ

- เพิ่ม `publicBookingVehicleSchema = { type, license_plate? }` และ
  `publicBookingInputSchema.vehicles: array(...).max(10).default([])`
- `type` ใช้ enum ปิดชุดเดียวกับ `household.vehicles[].type` (`car | motorcycle | other`) —
  **ไม่ขยาย** enum ฝั่ง staff (ต่างจาก pet species ที่เป็น master data ตาม CR-049)
- `license_plate` optional — คนที่หนีน้ำกลางคืนอาจจำทะเบียนไม่ได้ และสคีมา staff เก็บ nullable
  อยู่แล้ว; ค่าว่างถูก normalize เป็น `null` ใน `toHouseholdInput`
- UI เป็น **choice 3 ปุ่มแถวเดียว**: `ไม่มีพาหนะ` (default) / `รถยนต์` / `มอเตอร์ไซค์`
  — ครัวเรือนที่อพยพมาด้วยรถคันเดียวหรือไม่มีเลย ไม่ใช่ repeatable rows แบบฟอร์ม staff.
  `other` ไม่ถูกเสนอบน public form (ประชาชนเลือก "อื่น ๆ" แล้วไม่ได้บอกอะไรกับคนจัดที่จอด)
- ช่องทะเบียนรถแสดงเมื่อเลือกรถยนต์/มอเตอร์ไซค์ และคงค่าที่พิมพ์ไว้เมื่อสลับประเภท
- อยู่ใน section 3 ร่วมกับสัตว์เลี้ยง แต่**ไม่**อยู่ใต้ `petsAllowed` — ศูนย์ที่ไม่รับสัตว์เลี้ยง
  ก็ยังมีที่จอดรถ

### ฟอร์มจอง — ข้อความ error + การ gate ตามศูนย์ (แก้ของที่ผิดอยู่)

- `shelter_code` เดิมใช้ `shelterCodeSchema` ที่ใช้ร่วมกับ staff plane ซึ่งขึ้นข้อความอังกฤษ
  `"Shelter code must look like SH001"` ให้ประชาชนเห็น → ห่อเป็น `bookingShelterCodeSchema`
  (ไทย: "กรุณาเลือกศูนย์พักพิง" / "กรุณาเลือกศูนย์พักพิงจากรายการ") **ไม่แก้ schema กลาง**
  เพราะมันคุม doc id ทั้ง staff plane
- เติมข้อความไทยให้ cap ที่เดิมเงียบและจะเด้ง default ของ zod เป็นอังกฤษ (ชื่อ/นามสกุล 100,
  รายละเอียดสัตว์เลี้ยง 200, จำนวนสัตว์เลี้ยง 20, จำนวนยานพาหนะ 10)
- `petsAllowed` เดิมเป็น `(selected?.pet_policy ?? null) !== 'no_pets'` = **true ตอนยังไม่เลือกศูนย์**
  ทำให้ dropdown ชนิดสัตว์เลี้ยงโผล่มาว่างเปล่า (อ่านได้ว่า "ศูนย์นี้ไม่รับสัตว์อะไรเลย")
  → ต้องเลือกศูนย์ก่อน ไม่งั้นแสดงข้อความให้ไปเลือกในขั้นที่ 1 แทน. ใช้กับรายการความต้องการ
  พิเศษ (`availableTags`) ด้วย

### ใบจอง

| | Before | After |
| --- | --- | --- |
| ปุ่ม | "พิมพ์ใบจอง" → `window.print()` | "ดาวน์โหลดใบจอง (PDF)" → บันทึกไฟล์ `preregister-<code>.pdf` ตรงๆ |
| ใต้ QR | `รหัสการจอง` + ULID | `ชื่อผู้จอง` + ชื่อ-นามสกุล |
| แถวสรุป | มีแถว "ชื่อผู้จอง" ซ้ำ | ตัดออก (ชื่ออยู่ในบล็อก QR ซึ่งเป็นส่วนที่พิมพ์) |
| fallback ตอนสร้าง QR ไม่สำเร็จ | "กรุณาใช้รหัสการจองด้านล่างแทน" | "กรุณาแจ้งชื่อ-นามสกุลกับเจ้าหน้าที่ที่ประตูศูนย์" |

- เพิ่ม `downloadElementAsPdf()` ใน `$lib/utils/pdf.ts` คู่กับ `previewElementAsPdf()` เดิม
  (แยก `renderElementToPdf` ออกมาใช้ร่วมกัน). `jsPDF.save()` ขับ anchor click ภายใน จึงไม่ต้อง
  ขอสิทธิ์ popup แบบ preview tab
- CSS `@media print` เดิมคงไว้ — ยังใช้กับกรณีผู้ใช้กด Ctrl+P เองบนใบจองที่เปิดอยู่
- **นามสกุลไม่ถูกเพิ่มลง API response**: `registrations.test.ts` มีเทสต์ยืนยันว่านามสกุลต้อง
  ไม่อยู่บน public ticket (Public task DoD, CR-070) → `BookingTicket.last_name` เป็น field ของ
  view model ฝั่ง client ที่ `booking-form` เติมจากค่าที่ประชาชนเพิ่งพิมพ์เอง. ทางเดียวที่จะ
  เห็นใบจองคือหลังจองสำเร็จใน `booking-modal` (เมนู lookup ถูกถอดออกไปแล้ว) เบราว์เซอร์จึงมี
  ค่านี้อยู่ในมือแน่นอน — ไม่ต้องผ่อนสัญญา privacy ของ endpoint

## Impact

**Docs ที่ต้องแก้ตาม CR นี้ (ยังไม่แก้ — รอ approve):**

- `docs/features/site-occupancy-booking-program.md` — field list ที่ public booking เก็บ (เพิ่ม vehicles)
- `docs/data/schema.md` — ไม่ต้องแก้ (`household.vehicles[]` มีอยู่แล้ว ไม่มี field ใหม่ใน doc)

**Code + test:**

- `domain/booking.ts` + `booking.test.ts` — 30 passed (เพิ่มเคส: default `[]`, ทะเบียน optional +
  trim, ปฏิเสธ type นอก enum, cap 10, map ลง `household.vehicles[]` + ทะเบียนว่าง → `null`,
  ข้อความ error ไทยของ `shelter_code`)
- `ui/booking-form.svelte`, `ui/booking-ticket.svelte`, `application/booking-store.svelte.ts`
- `lib/utils/pdf.ts` — `previewElementAsPdf` เดิมพฤติกรรมไม่เปลี่ยน (staff QR card ยังใช้อยู่);
  เพิ่ม timeout 20s ครอบ html2canvas — บนมือถือสเปกต่ำที่ `scale: 3` การ render กินเวลา 1–2 วินาที
  และถ้า font/รูปค้าง promise จะ pending ตลอดไป (spinner หมุนไม่หยุด) จึงให้ error ที่อ่านรู้เรื่องแทน

**Defect fix ที่ทำพ่วงในรอบเดียวกัน (ไม่ใช่ spec change แต่บันทึกไว้ให้ trace ได้):**

- `lib/server/couch-public-writer.ts` + `routes/api/public/v1/registrations/+server.ts` —
  `_bulk_docs` ของ CouchDB เป็น per-row ไม่ใช่ transaction: ถ้าแถวใดถูกปฏิเสธ แถวที่ผ่านไปแล้ว
  durable ทันที เดิม route แค่ log แล้วคืน 502 ทิ้ง **household ที่ไม่มีสมาชิก** ไว้ — หรือแย่กว่านั้น
  คือ evacuee ที่ยังกินโควตา occupancy (D-BOOK-OCC=C) ของการจองที่เพิ่งบอกประชาชนว่าล้มเหลว.
  `bulkAsPublicWriter` จึงคืน `written[{id, rev}]` เพิ่ม และ route เรียก `rollbackAsPublicWriter`
  ลบแถวที่ลงไปแล้วแบบ best-effort (delete ผ่าน `validate_doc_update` ได้ เพราะ design doc บล็อก
  เฉพาะ type ที่เป็น append-only ซึ่ง booking ไม่ได้เขียน) · ถ้า rollback เองล้มเหลวจะ log ชื่อ doc
  ที่ค้างไว้ให้ตามเก็บด้วยมือ · เพิ่มเทสต์ 2 เคส

**Gate ที่รันแล้ว:** `pnpm check` 0 errors, `pnpm lint` สะอาด (แก้ eslint error ที่ค้างมาก่อนหน้าใน `public-portal/domain/mappers.ts` และ `routes/(public)/shelters/` ไปด้วย), `pnpm test` 1230 passed, `svelte-autofixer` ไม่มี issue

**ยังไม่ได้ทำ:** เคส E2E ของ vehicle choice ใน `e2e/public-register.test.ts`
(รันตรวจไม่ได้ในรอบนี้ — ต้องมี dev server + CouchDB)

## Migration

N/A — ไม่ bump `schema_v`. `household.vehicles[]` เป็น field เดิมของ schema_v 4 ที่ public
booking ไม่เคยเขียนลงไป; booking เก่าที่ไม่มีรถจะมี `vehicles: []` ตาม default ของ
`householdInputSchema` อยู่แล้ว จึงไม่ต้องแตะ doc ที่ persist แล้ว

## Decision log

- 2026-08-22 — เจ้าของโครงการขอเพิ่มรถ + ทะเบียนรถใน section สัตว์เลี้ยง และให้ปุ่ม QR
  ดาวน์โหลดตรงไม่ต้อง preview
- 2026-08-22 — ขอเปลี่ยน UI ยานพาหนะเป็น choice 3 ตัวเลือก default "ไม่มีพาหนะ"
- 2026-08-22 — ขอให้ใบจองเอารหัสจองออกและแสดงชื่อ-นามสกุล; แจ้งว่าชนกับเทสต์ DoD ที่กันนามสกุล
  ออกจาก response → ใช้ค่าจากฝั่ง client แทน โดยไม่แก้ API
- 2026-08-22 — เลือก track ด้วย CR ไฟล์ใน `docs/changes/` → proposed
