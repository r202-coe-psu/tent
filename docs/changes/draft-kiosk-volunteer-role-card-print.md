---
id: draft
title: Kiosk Volunteer Role-Card Print — จิตอาสาพิมพ์ QR บัตรจิตอาสาที่ตู้ kiosk ด้วยเบอร์โทร
status: proposed
date: 2026-10-18
updated: 2026-10-18
requested_by: ทีม kiosk (issue #609)
decided_by: project owner
layer: volatile
affects:
  - docs/data/api-contract.md §2.1.2
  - frontend/src/routes/api/v1/kiosk/volunteer-card/+server.ts
  - frontend/src/lib/features/kiosk/server/kiosk-volunteer-card.server.ts
  - frontend/src/lib/server/security/rate-limiter.ts
  - frontend/src/lib/features/kiosk/** (label จิตอาสา, session, UI /kiosk/print-qr, /kiosk/volunteer)
  - kiosk/app/manager.py (allowed_paths)
---

# Kiosk Volunteer Role-Card Print

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม endpoint `POST /api/v1/kiosk/volunteer-card` ให้ตู้ kiosk หาจิตอาสาด้วยเบอร์โทร
>   ใน shelter ของเครื่องเท่านั้น แล้วคืน role-card QR (`TKT-VOL-HASH-…`) **ที่มีอยู่แล้ว** แบบอ่านอย่างเดียว
>   พร้อม label จิตอาสาแยกจาก label ผู้พักพิง และหน้าเลือก «ผู้พักพิง / จิตอาสา» หลังปุ่ม «พิมพ์ QR»
> - **เพื่อใคร/ทำไม:** จิตอาสาที่ไม่มีมือถือหรือแบตหมดได้บัตร QR กระดาษไว้ให้เจ้าหน้าที่สแกน โดยไม่ต้องให้
>   เจ้าหน้าที่ช่วยออกบัตร
> - **กระทบ schema/scope:** ไม่มี field ใหม่, ไม่ bump `schema_v`, ไม่เปลี่ยนวิธีออก/หมุน token (CR-127 คงเดิม)
> - **สถานะ:** ข้อเสนอทีม kiosk (D1–D8 ตกลงในทีม 2026-10-18) — **รอ PO อนุมัติ**

---

## 1. Requirements

### FR-01: ค้นหาแบบอ่านอย่างเดียว

1. Server หา `type: "volunteer"` ใน `shelter_{device.shelter_code}` เท่านั้น (D3) ด้วย `phone` (รวมรูปแบบ `+66`)
   หรือ `phone_hash = sha256(เบอร์ canonical)`
2. กรองซ้ำในโค้ด: เบอร์ใน `phone` ปัจจุบันต้องตรงกับเบอร์ที่กรอก — กัน `phone_hash` ค้างจาก #693
3. ต้อง `status: "active"` และเหลือ **1 คนพอดี** (D4) และมี `tracking_token_hash` เป็น hex 64 ตัว (D2)
4. คืน `qr_payload = "TKT-VOL-HASH-" + tracking_token_hash.toUpperCase()` — **ห้าม mint/rotate/backfill**
   และห้ามเรียก `readOrMintRoleCardToken`
5. ทุกกรณีที่พิมพ์ไม่ได้ (ไม่พบ / ต่าง shelter / `inactive` / ไม่มี hash / เบอร์ซ้ำ) ตอบ
   `404 KIOSK_VOLUNTEER_CARD_NOT_FOUND` body เดียวกัน — ไม่ leak ว่าเบอร์มีในระบบ

### FR-02: Gate และ rate limit

1. ผูกกับ toggle `kiosk_phone_check_in_enabled` (CR-152) เหมือน reprint (D5) — ปิดตอบ `403 KIOSK_METHOD_DISABLED`
2. ต่อเครื่อง 10 ครั้ง/นาที, ต่อเบอร์ 3 ครั้ง/10 นาที ข้ามเครื่อง นับ**ทุก** request (D7); key เบอร์เป็น sha256

### FR-03: Label และ UI

1. Label 80×60 mm: ชื่อ `first_name` + `maskLastName(last_name)` (+ ชื่อเล่น), badge `จิตอาสา · V-NNN`, QR ชิดขวา,
   link ล่างซ้าย — **ไม่พิมพ์เบอร์** (D6; จงใจต่างจาก label ผู้พักพิง)
2. หน้าแรก «พิมพ์ QR» → `/kiosk/print-qr` เลือก «ผู้พักพิง» (`/kiosk/reprint` เดิม) หรือ «จิตอาสา» (`/kiosk/volunteer`) (D8)
3. Scanner client แนบ device credential ให้ path ใหม่ (same-origin POST เท่านั้น)

## 2. Decisions (ข้อเสนอทีม 2026-10-18)

| # | ประเด็น | ข้อเสนอ |
|---|---|---|
| D1 | วิธี track | CR draft นี้ (`id: draft`) |
| D2 | ไม่มี `tracking_token_hash` | ปฏิเสธ (error เดียวกับไม่พบ) — เกิดเฉพาะข้อมูลเก่า/นำเข้าเอง; แก้หน้างานโดยเปิด role card ใน portal ครั้งหนึ่ง |
| D3 | "shelter เดียวกัน" | doc อยู่ใน `shelter_{device.shelter_code}` |
| D4 | เบอร์ซ้ำหลายคน | ปฏิเสธ (error เดียวกับไม่พบ) |
| D5 | toggle | ใช้ `kiosk_phone_check_in_enabled` |
| D6 | mask ชื่อ | first + masked last (+ ชื่อเล่น), ไม่พิมพ์เบอร์ |
| D7 | rate limit | device 10/นาที, เบอร์ 3/10 นาที นับทุก request |
| D8 | ทางเข้า UI | หน้าเลือก 2 กล่อง |

## 3. Security trade-off (accepted risk — รอ PO ยืนยัน)

- **รู้เบอร์ = พิมพ์ credential ถาวรของจิตอาสาคนนั้นได้** ที่ตู้ในศูนย์เดียวกัน
- ลดความเสี่ยงด้วย: shelter scope, rate limit ต่อเครื่อง/ต่อเบอร์, error เดียว, mask ชื่อ, ไม่พิมพ์เบอร์
- ปิดจริงต้องมี factor ที่ 2 — hardening ภายหลัง (CR-158 staff PIN หรือเลขท้าย 4 หลัก)
- Rate limiter เป็น in-memory ต่อ process (reset เมื่อ restart); เมื่อย้าย limit ไป Nginx (#627) ต้องย้าย limiter นี้ด้วย

## 4. Out of scope

- วิธีออก/หมุน token (CR-127), parse QR จิตอาสาฝั่ง scan (#650), แก้ `phone_hash` ไม่อัปเดต (#693), กันเบอร์ซ้ำ (#694)
