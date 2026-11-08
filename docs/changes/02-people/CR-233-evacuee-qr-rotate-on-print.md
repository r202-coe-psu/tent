---
id: CR-233
title: Person QR ของผู้อพยพออกใหม่ทุกครั้งที่ปริ้น — payload `evacuee:{ULID}@{hash6}` + log `evacuee_qr:{ULID}` ให้ใบเก่าหมดอายุ
status: approved
date: 2026-11-06
updated: 2026-11-08
requested_by: feedback อบรมระบบ 03/11/2026 (GitHub issue #1156)
decided_by: Project Owner (เจ้าของโครงการ) — อนุมัติ 2026-11-06 (grill #1156, ข้อ 1–9)
decision_date: 2026-11-06
layer: volatile
supersedes:
  - docs/changes/14-kiosk/CR-151-kiosk-pre-registration-check-in.md FR-KPC-107 (reprint ไม่เขียน doc) และข้อความ payload ใน FR-KPC-81
  - docs/changes/14-kiosk/CR-149-kiosk-walk-in-registration.md ข้อความ payload ใน FR-KWR-19 และ FR-KWR-71
affects:
  - docs/data/schema.md §1.9 (+ doc type `evacuee_qr`), §0 (ข้อยกเว้น `_id`), §8 ข้อ 1–2 · A1: §2.30 `distribution_log` `recipient_qr_override`
  - schema_v: `evacuee_qr` ใหม่ = 1 · `evacuee` คงที่ 15 (ไม่ bump) · A1: `distribution_log` 2 → 3 (lazy — เขียน v3 เฉพาะ log ที่ override)
  - docs/data/api-contract.md §1.3 (แถว ค้นหา/QR), §2.1 (`/kiosk/register` response), §2.1.3 (`source:"qr"`), §2.1.4 (ใหม่), §2.8 (ใหม่ — `POST /api/v1/evacuee-qr/issue`)
  - docs/sop/SOP-SmartShelter.md P3-04 · docs/sitemap.md (`/people/[id]/card`)
  - frontend/src/lib/server/evacuee-qr-service.ts (ใหม่) + frontend/src/routes/api/v1/evacuee-qr/issue/+server.ts (ใหม่)
  - frontend/src/lib/server/shelter-access-design.ts (`_design/access` — whitelist + append-only ของ `evacuee_qr`)
  - frontend/src/lib/features/kiosk/{domain/kiosk-qr.ts,server/kiosk-check-in.server.ts,server/kiosk-reprint.server.ts} · frontend/src/routes/api/v1/kiosk/register/+server.ts
  - frontend/src/lib/features/people/{domain/scan-lookup.ts,domain/intake-pipeline.ts,application/federated-scan-lookup.ts,ui/evacuee-profile/evacuee-qr-modal.svelte,ui/registration/family-batch-print.svelte,ui/registration/evacuee-wristband-success.svelte}
  - frontend/src/lib/utils/scan-code.ts · frontend/src/lib/features/distribution/ui/model/recipient-scan.ts · frontend/src/lib/utils/qrcode.test.ts
  - A1: frontend/src/lib/features/distribution/{domain/food-supplies/distribution-log.ts,application/food-supplies/distribution-workflow.ts,ui/common/RecipientSearchPicker.svelte,ui/frontline/{FoodDistributionCard,SuppliesDistributionCard}.svelte} · frontend/src/lib/components/camera-code-scanner-dialog.svelte · frontend/src/lib/server/shelter-access-design.ts (`distribution_log` VDU)
related:
  - docs/changes/14-kiosk/CR-151-kiosk-pre-registration-check-in.md
  - docs/changes/14-kiosk/CR-149-kiosk-walk-in-registration.md
  - docs/changes/03-C-supply/CR-211-staff-qr-card.md (แบบอย่าง rotate)
  - docs/changes/06-A-volunteer/CR-127-volunteer-permanent-tracking-token.md (volunteer QR never rotate — ไม่เปลี่ยน)
  - docs/changes/02-people/CR-192-station-time-tracking.md (แบบอย่าง log ราย person)
  - docs/changes/14-kiosk/CR-222-station-print-server.md (ชื่อ `source: evacuee_qr` ของ print-job — คนละแนวคิด, ดู FR-EQR-43)
---

# CR-233 — Person QR ออกใหม่ทุกครั้งที่ปริ้น

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** Person QR ของผู้อพยพเปลี่ยนจาก `evacuee:{ULID}` (คงที่ทุกครั้งที่ปริ้น) เป็น `evacuee:{ULID}@{hash6}` ที่ออกใหม่ทุกครั้งที่สั่งปริ้น และบันทึกทุกครั้งใน doc `evacuee_qr:{ULID}` โดย QR ใบล่าสุดเท่านั้นที่ใช้ได้
> - **เพื่อใคร:** ศูนย์พักพิง — สายรัด/สติกเกอร์ที่ทำหาย ถูกแทนที่ หรือถูกถ่ายสำเนา ต้องสแกนไม่ผ่านหลังมีใบใหม่
> - **build:** server ออก payload + เขียน log ก่อนพิมพ์ (kiosk: ภายใน endpoint เดิม; staff: `POST /api/v1/evacuee-qr/issue`) · parser ทุกตัวรับ `…@hex6` และใช้กฎสแกน 5 แถว · ปฏิเสธ QR หมดอายุพร้อมวันที่
> - **กระทบ:** doc type ใหม่ `evacuee_qr` (schema_v 1) · `evacuee` ไม่ bump · worker ไม่ project · แก้ SOP P3-04 และ sitemap · supersede CR-151 FR-KPC-107 และข้อความ payload ใน CR-151 FR-KPC-81, CR-149 FR-KWR-19/71

---

## Requirements

### A. Payload

- FR-EQR-1 — Person QR ที่ออกด้วยระบบนี้ต้องเป็น `evacuee:{ULID}@{hash6}` เช่น `evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0@683508` โดย `{ULID}` คือ ULID 26 ตัวพิมพ์ใหญ่ของ evacuee
- FR-EQR-2 — `printed_at` ต้องเป็น ISO 8601 UTC ความละเอียด ms ลงท้าย `Z` (รูปแบบเดียวกับ `Date.prototype.toISOString()` เช่น `2026-11-06T08:15:30.123Z`) และ string ที่ใช้คำนวณ hash ต้องตรงกับ `prints[].printed_at` ที่เก็บทุกตัวอักษร
- FR-EQR-3 — `hash6` = 6 ตัวแรกของ SHA-1 ที่เป็น hex ตัวพิมพ์เล็ก โดย input = UTF-8 bytes ของ string `printed_at` (ไม่ใส่ ULID หรือ secret) คำนวณฝั่ง server ตอนออก QR เท่านั้นแล้วเก็บใน `prints[].hash` (FR-EQR-9a) test vector: `sha1("2026-11-06T08:15:30.123Z")` = `68350862d3bd07c4…` → `hash6 = 683508`
- FR-EQR-4 — parser ทุกตัวต้องรับทั้ง `evacuee:{ULID}` (ไม่มี `@`) และ `evacuee:{ULID}@{hash6}`; ULID และ `hash6` ไม่แยกตัวพิมพ์ (normalize ULID เป็นตัวใหญ่ และ `hash6` เป็นตัวเล็กก่อนเทียบ)
- FR-EQR-5 — ข้อความที่มี `@` แต่ส่วนหลัง `@` ไม่ใช่ `[0-9a-f]{6}` (ไม่แยกตัวพิมพ์) ต้องถือว่ารูปแบบผิด (ไม่ใช่ Person QR) ไม่ใช่ "หมดอายุ"
- FR-EQR-6 — ค่าที่เป็น doc id (`primary_evacuee_id`, `evacuee_ids[]`, `evacuee_id` ใน response) ต้องเป็น `evacuee:{ULID}` ไม่มี `@` เสมอ ส่วนที่รับ `…@hex6` ได้คือ payload ที่ได้จากการสแกน (`token` ของ lookup `source:"qr"` และ input ของตัวสแกนฝั่ง staff) เท่านั้น
- FR-EQR-7 — การเติม `@hash6` ต่อท้ายต้องไม่ทำให้ QR ใหญ่ขึ้น: payload 41 ตัวอักษรต้องได้ QR 29 modules (version 3) เท่าเดิมที่ ECC ค่าเริ่มต้นของ `qrcode` (ดู Risk)

### B. log `evacuee_qr:{ULID}`

- FR-EQR-8 — เพิ่ม doc type `evacuee_qr` ใน `shelter_{code}` ตามรูปด้านล่าง (รายละเอียด field: `docs/data/schema.md` §1.9) — 1 doc ต่อ 1 evacuee, `_id` = `evacuee_qr:{ULID}` โดย `{ULID}` เท่ากับ ULID ของ evacuee ที่อ้างถึง (ข้อยกเว้น `_id` ของ §0 — ไม่ใช่ ULID ใหม่)

```json
{
  "_id": "evacuee_qr:{ULID}",
  "type": "evacuee_qr",
  "schema_v": 1,
  "shelter_code": "SH001",
  "evacuee_id": "evacuee:{ULID}",
  "prints": [
    {
      "printed_at": "2026-11-03T02:10:00.000Z",
      "hash": "289170",
      "printed_by": "kiosk:kiosk-sh001-01",
      "source": "kiosk_checkin"
    },
    {
      "printed_at": "2026-11-05T09:41:12.512Z",
      "hash": "2d23a3",
      "printed_by": "staff01",
      "source": "profile"
    }
  ],
  "created_at": "2026-11-03T02:10:00.000Z",
  "updated_at": "2026-11-05T09:41:12.512Z",
  "created_by": "kiosk:kiosk-sh001-01"
}
```

- FR-EQR-9 — `prints[].source` ต้องเป็นหนึ่งใน `kiosk_checkin` | `kiosk_reprint` | `profile` | `family_batch` (ค่านอก enum = ปฏิเสธ)
- FR-EQR-9a — ทุก entry ใน `prints[]` ต้องมี `hash` = `hash6` ของ entry นั้น (6 ตัว hex ตัวพิมพ์เล็ก `^[0-9a-f]{6}$`) ที่ server คำนวณตอนออกและเขียนพร้อม entry; ห้ามแก้ภายหลัง; ตัวตรวจทุกตัวใช้ค่านี้ ไม่คำนวณซ้ำ (FR-EQR-28)
- FR-EQR-10 — `prints[].printed_by` = `kiosk:{device_id}` เมื่อ kiosk ออก, ชื่อผู้ใช้ staff (`_users` name จาก `_session`) เมื่อ staff ออก — server ตั้งเอง ไม่รับจาก body
- FR-EQR-11 — entry สุดท้ายของ `prints[]` คือ QR ที่ยังใช้ได้เพียงใบเดียวของคนนั้น
- FR-EQR-12 — `prints[]` เป็น append-only: เพิ่ม entry ท้ายเท่านั้น; ห้ามลบ แก้ หรือสลับลำดับ entry เดิม; ห้ามลบ doc
- FR-EQR-13 — `printed_at` ของ entry ใหม่ต้องมากกว่า `printed_at` ของ entry ก่อนหน้าเสมอ (strictly increasing)
- FR-EQR-14 — ไม่มี TTL: QR ใบล่าสุดไม่หมดอายุตามเวลา หมดอายุเฉพาะเมื่อมี entry ใหม่

### C. การออก QR (server-issued)

- FR-EQR-15 — การออก Person QR ต้องทำฝั่ง server เท่านั้น ผ่านฟังก์ชันเดียว `issueEvacueeQr` (`frontend/src/lib/server/evacuee-qr-service.ts`) ที่รับ `shelter_code`, `evacuee_id`, `source`, `printed_by` และคืน `{ evacuee_id, qr_payload, printed_at }`; client ห้ามคำนวณ `hash6` หรือสร้าง payload เอง (`crypto.subtle` ใช้ไม่ได้บน http LAN ของ kiosk/edge)
- FR-EQR-16 — `issueEvacueeQr` ต้องตรวจว่า `evacuee:{ULID}` มีอยู่ใน `shelter_{code}` ก่อน (ไม่มี = ไม่เขียนอะไร)
- FR-EQR-17 — เวลาของ entry ใหม่ = `max(now, last.printed_at + 1 ms)` (รูปแบบตาม FR-EQR-2) เพื่อให้ FR-EQR-13 เป็นจริงแม้นาฬิกาเครื่องย้อน
- FR-EQR-17a — ถ้า `hash` ที่คำนวณได้ของ entry ใหม่เท่ากับ `hash` ของ entry ใดก็ตามที่มีอยู่แล้วของคนเดียวกัน server ต้องออกใหม่โดยเลื่อน `printed_at` ไปอีก 1 ms แล้วคำนวณซ้ำ จนกว่า `hash` จะไม่ซ้ำกับทุก entry เดิม (การออกซ้ำนี้ยังต้องรักษา FR-EQR-13) — `hash` จึงไม่ซ้ำกันภายใน `prints[]` ของคนเดียวกัน
- FR-EQR-18 — ถ้ายังไม่มี doc `evacuee_qr:{ULID}` ให้สร้างพร้อม entry แรก; ถ้ามีแล้วให้ `PUT` พร้อม `_rev` ที่อ่านมา โดยเพิ่ม entry ท้าย `prints[]` และตั้ง `updated_at`
- FR-EQR-19 — เมื่อเขียนได้ `409` (สร้างชนกัน หรือ `_rev` เก่า) ต้องอ่าน doc ใหม่ คำนวณ `printed_at` ใหม่ตาม FR-EQR-17 แล้วลองใหม่ รวมไม่เกิน 5 ครั้ง; เกินแล้วถือว่าออกไม่สำเร็จ (`CONFLICT`)
- FR-EQR-20 — ต้องเขียน entry สำเร็จ **ก่อน** คืน `qr_payload` และก่อนที่ client จะพิมพ์ ถ้าพิมพ์ไม่สำเร็จ entry ไม่ถูกยกเลิก (ใบเก่าหมดอายุไปแล้ว) ผู้ใช้ต้องสั่งพิมพ์ใหม่ ซึ่งออก entry ใหม่อีกอัน
- FR-EQR-21 — 1 คำสั่งพิมพ์ต่อ 1 คน = 1 entry; ห้ามเขียน entry เมื่อเพียงแสดง/เปิดดูข้อมูล และห้าม cache payload ข้ามคำสั่งพิมพ์
- FR-EQR-21a — เมื่อเปิด `evacuee-qr-modal` และ `family-batch-print` (รวม `evacuee-wristband-success` ที่ห่อ modal นี้) ต้องแสดง label พร้อม QR **placeholder** ที่ไม่ใช่ payload ใช้งานได้ และห้ามเรียก `POST /api/v1/evacuee-qr/issue` หรือเขียน entry ใด ๆ — การเปิดดูอย่างเดียวไม่ทำให้ QR เดิมหมดอายุ
- FR-EQR-21b — เมื่อผู้ใช้กดพิมพ์ (หรือดู PDF เพื่อพิมพ์) ต้องเรียก `POST /api/v1/evacuee-qr/issue` ได้ payload จริง แล้ว render label ด้วย payload จริงนั้น แล้วจึงพิมพ์ ตามลำดับนี้; ถ้า item ไม่ได้ `status: issued` ต้องไม่พิมพ์ item นั้น
- FR-EQR-21c — ออก entry เฉพาะคนที่ถูกสั่งพิมพ์ (หน้า batch ไม่ออกให้สมาชิกที่ไม่ได้กดพิมพ์)

**Kiosk (device auth — ไม่มี endpoint ออก QR แยก)**

- FR-EQR-22 — kiosk ไม่มี endpoint ออก QR แยก เพราะการออกใหม่ทำให้ QR เดิมของคนนั้นใช้ไม่ได้ จึงต้องเกิดภายใน flow ที่ยืนยันตัวตนแล้วเท่านั้น: `POST /api/v1/kiosk/check-in`, `POST /api/v1/kiosk/reprint` (ยืนยันด้วย `id_last4` หรือ `staff_pin`), `POST /api/v1/kiosk/register` — ทั้งสามเรียก `issueEvacueeQr` เอง และ `qr_payload` ใน response ต้องเป็นค่าที่ออกใหม่นั้น
- FR-EQR-23 — ค่า `source` ที่แต่ละ endpoint ใช้: `check-in` → `kiosk_checkin` (ทุกสมาชิกที่ response คืน `qr_payload` รวมกรณี `already_checked_in` ที่ยัง `arriving`) · `reprint` → `kiosk_reprint` · `register` → `kiosk_checkin`
- FR-EQR-24 — สมาชิกที่ออก entry ไม่สำเร็จต้องไม่ได้ `qr_payload` (check-in/reprint: ไม่ใส่ field นี้ใน item นั้น; register: `qr_payload: null`) และตั้ง `qr_issue_failed: true`; การ check-in / การสร้าง evacuee ที่สำเร็จไปแล้วไม่ถูกย้อน และ kiosk ต้องไม่พิมพ์ของ item นั้น พร้อมแจ้งให้ลองพิมพ์ใหม่หรือติดต่อเจ้าหน้าที่

**Staff (`_session` cookie)**

- FR-EQR-25 — เพิ่ม `POST /api/v1/evacuee-qr/issue` (api-contract §2.8) สำหรับ `evacuee-qr-modal`, `family-batch-print` และ `evacuee-wristband-success`: รับ `{ shelter_code, source: "profile" | "family_batch", evacuee_ids[] }` แล้วเรียก `issueEvacueeQr` ต่อคน คืน `{ items: [{ evacuee_id, status, qr_payload?, printed_at? }] }` โดย `evacuee-qr-modal` (รวมที่ `evacuee-wristband-success` ห่อไว้) ใช้ `profile` และ `family-batch-print` ใช้ `family_batch`
- FR-EQR-26 — ผู้เรียกต้องผ่านการตรวจ `_session` และมีสิทธิ์ในศูนย์ `shelter_code` เดียวกับสิทธิ์ที่เปิดปุ่มพิมพ์ QR ในหน้า evacuee ของศูนย์นั้นอยู่แล้ว (ตรวจ role จาก `_session` ไม่เชื่อ body; ไม่เพิ่มหรือลดสิทธิ์ของ role ใด)

### D. กฎตอนสแกน

- FR-EQR-27 — ทุกจุดที่รับ Person QR ต้องประเมินด้วยกฎต่อไปนี้ โดยอ่านรายการ `prints[]` จาก `evacuee_qr:{ULID}` ใน `shelter_{code}` เดียวกับที่พบ evacuee (ไม่พบ doc = log ว่าง)

| #   | QR ที่สแกน                     | log                | ผล                                                                 |
| --- | ------------------------------ | ------------------ | ------------------------------------------------------------------ |
| 1   | ไม่มี `@`                      | ไม่มี doc หรือว่าง | **valid** (QR ที่ปริ้นก่อนเปลี่ยนระบบ และ booking ticket)          |
| 2   | ไม่มี `@`                      | มี entry           | **expired** (ไม่มี `issued_at`; `current` = `printed_at` ล่าสุด)   |
| 3   | `hash6` ตรงกับ entry ล่าสุด    | —                  | **valid**                                                          |
| 4   | `hash6` ตรงกับ entry เก่ากว่า  | —                  | **expired** (`issued_at` = entry ที่ตรง, `current` = entry ล่าสุด) |
| 5   | `hash6` ไม่ตรงกับ entry ไหนเลย | —                  | **invalid** (รวมกรณีไม่มี doc หรือ log ว่าง)                       |

- FR-EQR-28 — ตัวตรวจทุกตัว (kiosk server และ staff client) ต้องเทียบ `hash6` ที่สแกนกับ `prints[].hash` ที่เก็บไว้ **ห้ามคำนวณ sha1 หรือ hash ใด ๆ ซ้ำ**; เทียบกับ entry ล่าสุดก่อน (ค่า `hash` ไม่ซ้ำกันภายในคนเดียวตาม FR-EQR-17a จึงไม่กำกวม)
- FR-EQR-29 — ผลประเมินเป็น pure function ใน domain คืน `valid` | `expired { issued_at | null, current_printed_at }` | `invalid`; ห้ามมีการคำนวณ hash ในฟังก์ชันนี้หรือในโค้ดฝั่ง client (ใช้ได้บน http LAN ที่ไม่มี `crypto.subtle`)
- FR-EQR-30 — กฎนี้ใช้ที่: kiosk lookup `source:"qr"` (server), หน้า staff ที่สแกน/ค้น evacuee (`extractScanLookupToken`, `federated-scan-lookup`, `intake-pipeline`, `extractScanCode`) และหน้าแจกของ (`resolveScannedRecipient`)
- FR-EQR-31 — QR ที่เป็น ULID เปล่า (registration id ของตั๋วคิวกลาง, `kind: 'registration'`) ไม่ใช่ Person QR: ไม่ต้องอ่าน `evacuee_qr` และพฤติกรรมเดิมไม่เปลี่ยน

### E. UX เมื่อ QR หมดอายุ / ไม่ถูกต้อง

- FR-EQR-32 — kiosk: lookup `source:"qr"` ที่ผลเป็น expired ต้องตอบ `409 KIOSK_QR_EXPIRED` พร้อม `error.issued_at` (เว้น `null` กรณีแถว 2) และ `error.current_printed_at` (ISO 8601); ที่เป็น invalid ตอบ `400 KIOSK_QR_INVALID` — ทั้งสองกรณีไม่คืน household/สมาชิก และไม่ไปหน้าเลือกสมาชิก
- FR-EQR-33 — kiosk แสดงข้อความ "QR นี้ออกวันที่ {issued_at} มีใบใหม่วันที่ {current_printed_at} กรุณาใช้ QR ใบล่าสุดหรือติดต่อเจ้าหน้าที่" (แถว 2: "QR นี้ออกก่อนเปลี่ยนระบบ มีใบใหม่วันที่ {current_printed_at} …") ส่วน invalid แสดง "QR ไม่ถูกต้อง" วันที่แสดงเป็นเวลา Asia/Bangkok
- FR-EQR-34 — หน้า staff แสดงข้อความชุดเดียวกัน (FR-EQR-33) พร้อมแนะนำให้ค้นด้วยชื่อ และต้องไม่เปิด profile / ไม่นำทางไปหน้า evacuee / ไม่บันทึกการทำรายการ (check-in, แจกของ ฯลฯ) จาก QR ที่ expired หรือ invalid
- FR-EQR-35 — ข้อความและ response ของ expired/invalid ต้องไม่มีชื่อหรือข้อมูลส่วนบุคคลของเจ้าของ QR (มีเพียงวันที่)

### J. ยอมรับความเสี่ยงตอนแจกจ่าย (Amendment A1 — approved)

> **สถานะ:** approved โดยเจ้าของโครงการ 2026-11-08 · แก้เฉพาะกฎ FR-EQR-34 สำหรับหน้าแจกจ่ายพัสดุ/อาหารเท่านั้น (หน้าคืนของยืมและกองรับคืนยังปฏิเสธ QR หมดอายุเหมือนเดิม)

- FR-EQR-44 — หน้าแจกจ่ายพัสดุและอาหาร (`RecipientSearchPicker` / `resolveScannedRecipient`) เมื่อสแกน Person QR ที่ผลเป็น **expired** (FR-EQR-27 แถว 2 และ 4) ต้องแสดงปุ่ม "ยอมรับความเสี่ยงเพื่อแจกจ่าย" ในหน้าต่างสแกน ถัดจากข้อความ FR-EQR-33
- FR-EQR-45 — ผู้ใช้ที่มีสิทธิ์แจกจ่ายในหน้านั้นอยู่แล้วกดปุ่มได้ทุกคน ไม่เพิ่มหรือลดสิทธิ์ของ role ใด
- FR-EQR-46 — เมื่อกดปุ่ม ระบบต้องเลือกผู้รับเป็น evacuee เจ้าของ QR ตามปกติ และปิดหน้าต่างสแกน; ก่อนกดปุ่มต้องไม่เลือกผู้รับและไม่บันทึกรายการใด (ตาม FR-EQR-34)
- FR-EQR-47 — QR ที่ผลเป็น **invalid** (แถว 5) ไม่มีปุ่มนี้ และยังถูกปฏิเสธเสมอ; QR ที่ไม่ใช่ Person QR (staff / volunteer / pool) ไม่เกี่ยวข้อง
- FR-EQR-48 — รายการแจกที่เลือกผู้รับผ่านปุ่มนี้ต้องบันทึกร่องรอยในเอกสารการแจก: `recipient_qr_override` = `{ issued_at: ISO | null, current_printed_at: ISO, overridden_by: str, overridden_at: ISO }` (field เสริม ไม่มีค่า = ไม่ได้ override) · เก็บใน `distribution_log` §2.30 (`schema_v` 2→3): log ที่มี field นี้เขียน `schema_v 3`, log อื่นยังเขียน `schema_v 2`, ไม่ backfill, ห้ามเพิ่ม field ภายหลัง, `overridden_by` มาจากผู้ใช้ที่ล็อกอิน (ไม่รับจาก client)
- FR-EQR-49 — ข้อความบนหน้า/ปุ่มและ response ต้องไม่มีชื่อหรือข้อมูลส่วนบุคคลของเจ้าของ QR ก่อนกดปุ่ม (FR-EQR-35); หลังกดจึงแสดงชื่อผู้รับตามปกติ
- FR-EQR-50 — การ override ไม่เปลี่ยน `evacuee_qr` (ไม่ออก QR ใหม่ ไม่เพิ่ม entry) และไม่ใช้กับ kiosk หรือหน้า staff อื่น (check-in/out, คัดกรอง, จัดโซน, ค้นหา) — หน้าเหล่านั้นยังตาม FR-EQR-34

### F. ขอบเขต (ไม่เปลี่ยน)

- FR-EQR-36 — CR นี้ใช้กับ Person QR ของผู้อพยพ (`evacuee`) เท่านั้น ไม่เปลี่ยน: บัตรเจ้าหน้าที่ `TKT-STF-HASH-…` (CR-211), บัตรจิตอาสา `TKT-VOL-HASH-…` (CR-127, never rotate), QR บริจาค `TX-…` / `DN-…`, QR ของ bulk-return pool และ QR ตั๋วจอง (booking ticket / ตั๋วคิวกลาง ULID เปล่า) — การออกตั๋วเหล่านี้ไม่ถือเป็นการปริ้น Person QR และไม่เขียน `evacuee_qr`

### G. Sync / worker / validation

- FR-EQR-37 — worker ต้องไม่ project `evacuee_qr` ลง MongoDB (ไม่มี `public_*` ใหม่, ไม่ bump `PROJECTION_VERSION`) และไม่แตะ `public_persons`
- FR-EQR-38 — `validate_doc_update` ของ `shelter_*` (`_design/access`) ต้องเพิ่ม `evacuee_qr` ใน type whitelist และตรวจว่า: `_id` ขึ้นต้น `evacuee_qr:`; `prints[]` ของ `newDoc` ต้องมี `prints[]` ของ `oldDoc` เป็นส่วนนำหน้าเหมือนเดิมทุก entry (เพิ่มท้ายได้เท่านั้น); `printed_at` เพิ่มขึ้นเข้มงวด; `hash` ตรง `^[0-9a-f]{6}$` และไม่ซ้ำกันใน `prints[]`; `source` อยู่ใน enum; ปฏิเสธ `DELETE`
- FR-EQR-39 — การเขียน `evacuee_qr` ทำได้เฉพาะ server ด้วย admin credential (`issueEvacueeQr`); `validate_doc_update` ต้องปฏิเสธการเขียนจาก session ผู้ใช้ทั่วไปทุกบทบาท (อ่านได้ตามสิทธิ์อ่านของ evacuee ในศูนย์นั้น เพื่อให้หน้า staff ตรวจกฎสแกนได้)
- FR-EQR-40 — ไม่ต้องมี Mango index ใหม่ (อ่านด้วย `_id` ตรง)

### H. ความปลอดภัย

- FR-EQR-41 — `hash6` เป็น SHA-1 ที่ไม่มี secret: ใช้กันการนำ QR เก่ากลับมาใช้ **ไม่ใช่** กันการปลอม (ผู้ที่รู้ ULID และเวลาปริ้นโดยประมาณหาค่า hash ได้) เอกสารและ UI ห้ามอ้างว่า QR ใหม่ "ปลอมไม่ได้"
- FR-EQR-42 — การอัปเกรดเป็น HMAC ในอนาคตเป็นงานฝั่ง server เท่านั้น (เปลี่ยนวิธีคำนวณ `hash` ที่ `issueEvacueeQr`) ไม่แตะ client และไม่แตะตัวตรวจ เพราะตัวตรวจเทียบกับ `prints[].hash` ที่เก็บ (FR-EQR-28); entry เดิมที่ `hash` คำนวณด้วยวิธีเก่ายังตรวจได้ตามปกติ

### I. ชื่อที่ซ้ำกัน (ห้ามสับสน)

- FR-EQR-43 — `prints[].source` (`kiosk_checkin` | `kiosk_reprint` | `profile` | `family_batch`) เป็นคนละ field กับ `source: "qr"` ของ kiosk lookup (ช่องทางที่ผู้ใช้ยืนยันตัวตน: `qr` | `smart-card` | `phone` | `thaid`) และคนละแนวคิดกับ `source: evacuee_qr` ของ print-job ใน CR-222 (ชนิดงานพิมพ์) — โค้ดและเอกสารห้ามใช้ enum ร่วมกัน

## Acceptance

**Spec**

- [ ] `docs/data/schema.md` §1.9 (`evacuee_qr`), §0, §8 ข้อ 1–2 และ `docs/data/api-contract.md` §1.3, §2.1, §2.1.3, §2.1.4, §2.8 อัปเดต `updated:` ตรงกับ CR นี้ (ทำใน PR เดียวกับ CR)
- [ ] `docs/sop/SOP-SmartShelter.md` P3-04 และ `docs/sitemap.md` ตรงกับ FR-EQR-1 / FR-EQR-20
- [ ] CR-151 FR-KPC-81 / FR-KPC-107 และ CR-149 FR-KWR-19 / FR-KWR-71 มีหมายเหตุ "Superseded by CR-233"

**ออก QR (ไฟล์: `kiosk/server/kiosk-check-in.server.ts:727,752,764`, `kiosk/server/kiosk-reprint.server.ts:229-237`, `routes/api/v1/kiosk/register/+server.ts:164`)**

- [ ] AC-EQR-1 — `issueEvacueeQr` เขียน entry ใน `evacuee_qr:{ULID}` (สร้าง doc ถ้ายังไม่มี), retry เมื่อ `409` (FR-EQR-19), `printed_at` มากกว่า entry ก่อนหน้าเสมอ แล้วคืน `evacuee:{ULID}@{hash6}`
- [ ] AC-EQR-2 — kiosk check-in, kiosk reprint และ `/api/v1/kiosk/register` ใช้ payload จาก `issueEvacueeQr` (ไม่มีโค้ดที่ส่ง `qr_payload = evacuee_id` อีก); ออก entry ล้มเหลวคืน `qr_issue_failed` ตาม FR-EQR-24
- [ ] AC-EQR-3 — `evacuee-qr-modal` (`people/ui/evacuee-profile/evacuee-qr-modal.svelte:54,64`), `family-batch-print.svelte` และ `evacuee-wristband-success.svelte` เรียก `POST /api/v1/evacuee-qr/issue` ตอนกดพิมพ์ แล้ว render label ด้วย payload ที่ได้ก่อนพิมพ์ (FR-EQR-21b) และแสดง label พร้อม QR placeholder ก่อนกดพิมพ์ (FR-EQR-21a) (ทุกไฟล์ `.svelte` ผ่าน `svelte-autofixer`)
- [ ] AC-EQR-4 — เปิด `evacuee-qr-modal` / `family-batch-print` แล้วปิดโดยไม่กดพิมพ์ ไม่เรียก `POST /api/v1/evacuee-qr/issue` ไม่เขียน entry และ QR เดิมของคนนั้นยังสแกนผ่าน (FR-EQR-21a); กดพิมพ์แล้วได้ entry 1 อันต่อคนที่พิมพ์ (FR-EQR-21c)
- [ ] AC-EQR-5 — `POST /api/v1/evacuee-qr/issue` ตอบ `401/403/422` ตาม §2.8 และไม่ออก QR ให้ evacuee นอก `shelter_code` ที่ผู้เรียกมีสิทธิ์

**อ่าน QR (ไฟล์: `kiosk/domain/kiosk-qr.ts:10-22`, `kiosk/server/kiosk-check-in.server.ts:37-48,529-539`, `people/domain/scan-lookup.ts:13-26`, `people/domain/intake-pipeline.ts:301-344`, `people/application/federated-scan-lookup.ts:39-68`, `utils/scan-code.ts:2-8`, `distribution/ui/model/recipient-scan.ts:45-100`)**

- [ ] AC-EQR-6 — `parseKioskQr`, Zod `evacueeIdSchema` ของ `token` ใน kiosk lookup (`source:"qr"` — id field อื่นไม่เปลี่ยน, FR-EQR-6), `extractScanLookupToken`, `intake-pipeline`, `extractScanCode` และ `resolveScannedRecipient` รับ `…@hex6` และส่งต่อ hash ให้ตัวประเมินกฎสแกน
- [ ] AC-EQR-7 — QR หมดอายุแสดงข้อความพร้อมวันที่ออก/วันที่ใบใหม่ทั้งบน kiosk (`409 KIOSK_QR_EXPIRED`) และหน้า staff และไม่เปิด profile (FR-EQR-32..35)
- [ ] AC-EQR-8 — QR ไม่มี `@` ของคนที่ยังไม่มี log ยังสแกนผ่าน (booking ticket, สายรัดเดิม — แถว 1)

**Sync / schema**

- [ ] AC-EQR-9 — worker ไม่ project `evacuee_qr` ไป Mongo (test หรือ assert ใน worker ว่าไม่มี projector ของ type นี้)
- [ ] AC-EQR-10 — `_design/access` ของ `shelter_*` รับ `evacuee_qr` (whitelist) ปฏิเสธการแก้/ลบ entry เดิม, ปฏิเสธ `DELETE`, ปฏิเสธการเขียนจาก session ที่ไม่ใช่ admin (`shelter-access-design.test.ts`)

**Tests**

- [ ] AC-EQR-11 — unit test: parse payload (มี/ไม่มี `@`, ตัวพิมพ์, `@` ผิดรูป), `hash6` ตาม test vector FR-EQR-3, กฎตอนสแกนครบ 5 แถว (รวมกรณีไม่มี doc), `issueEvacueeQr` (สร้าง doc, append, `409` retry, เกิน 5 ครั้ง, `printed_at` เพิ่มขึ้นเข้มงวดเมื่อนาฬิกาย้อน, เขียน `hash` ทุก entry, `hash` ชนกับ entry เดิม → เลื่อน `printed_at` 1 ms ตาม FR-EQR-17a) และตัวตรวจไม่เรียก sha1 (เทียบ `prints[].hash` อย่างเดียว)
- [ ] AC-EQR-12 — e2e: ปริ้นซ้ำ (kiosk reprint หรือ staff modal) แล้ว QR ใบเก่าสแกนไม่ผ่านทั้ง kiosk และหน้า staff ส่วน QR ใบใหม่สแกนผ่าน (`e2e/helpers/onsite.ts` `decodeQrImage` ต้องอ่าน payload ใหม่ได้)
- [ ] AC-EQR-13 — `frontend/src/lib/utils/qrcode.test.ts` เพิ่มเคส `qrModuleCount('evacuee:{ULID}@{hash6}')` = 29 (FR-EQR-7) และเคส label ของ kiosk ที่ใช้ ECC เดียวกัน
- [ ] AC-EQR-14 — (A1) หน้าแจกจ่ายสแกน QR expired แล้วมีปุ่มยอมรับความเสี่ยง กดแล้วได้ผู้รับและบันทึก `recipient_qr_override`; QR invalid ไม่มีปุ่ม; ก่อนกดไม่มีผู้รับถูกเลือก (FR-EQR-44..50)

## Superseded

CR นี้แทนที่ข้อความต่อไปนี้ (ไม่แก้ตัวข้อความเดิม — มีหมายเหตุ "Superseded by CR-233" ใต้ตารางที่ข้อนั้นอยู่)

| ข้อเดิม           | ข้อความเดิม                             | ใช้ข้อความนี้แทน                                                                                                                                                                                         |
| ----------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CR-151 FR-KPC-107 | reprint "**ไม่เขียน doc ใด ๆ**"         | reprint เขียน entry `source: kiosk_reprint` ใน `evacuee_qr:{ULID}` ต่อสมาชิกที่คืน `qr_payload` (FR-EQR-22..23) ส่วนที่เหลือของ FR-KPC-107 (สมาชิกที่พิมพ์ได้, ไม่ `search_excluded`, `no-store`) ยังใช้ |
| CR-151 FR-KPC-81  | สายรัดมี QR `evacuee:<ULID>`            | QR = `evacuee:<ULID>@<hash6>` (FR-EQR-1)                                                                                                                                                                 |
| CR-149 FR-KWR-19  | response `qr_payload: 'evacuee:<ULID>'` | `qr_payload` = payload ที่ออกใหม่ (FR-EQR-1, FR-EQR-22); `qr_issue_failed` ตาม FR-EQR-24                                                                                                                 |
| CR-149 FR-KWR-71  | `qr_payload: evacuee_id`                | `qr_payload` = payload ที่ออกใหม่ — ไม่ใช่ `evacuee_id` อีก                                                                                                                                              |

## Why

- Person QR เดิมคือ `_id` ตรง ๆ ปริ้นกี่ครั้งก็ได้ค่าเดิม สายรัดหรือ label ที่ทำหายหรือถูกแทนที่แล้วจึงยังสแกนผ่าน และระบบไม่รู้ว่า QR ที่สแกนออกวันไหน (feedback อบรมระบบ 03/11/2026, #1156)
- **doc แยก `evacuee_qr` ไม่ใส่บน `evacuee`:** กัน `409` conflict กับ check-in/zoning ที่ PUT evacuee อยู่ตลอด และไม่ให้ log ถูก project ไป `public_persons`
- **server ออก payload ทุกครั้ง:** `crypto.subtle` ใช้ไม่ได้บน http LAN (kiosk/edge); ฝั่งออกจึงอัปเกรดเป็น HMAC ได้โดยไม่แตะ client
- **เก็บ `hash` ใน entry และตัวตรวจไม่คำนวณซ้ำ:** ถ้าตัวตรวจคำนวณ sha1 เอง การอัปเกรดเป็น HMAC จะกระทบ client/ตัวตรวจ; เมื่อเทียบกับค่าที่ server เก็บ การอัปเกรดจึงเป็นงานฝั่ง server ล้วน (สอดคล้องข้อตัดสิน 6)
- **ไม่แสดง QR ที่ใช้ได้ตอนเปิดหน้าต่าง:** การเปิดดูเฉย ๆ ไม่ควรทำให้ใบที่ผู้พักพิงถืออยู่หมดอายุ (ข้อ 2: ออกใหม่เมื่อ "สั่งปริ้น")
- **เขียน entry ก่อนพิมพ์:** ถ้าพิมพ์ก่อนแล้วเขียนล้มเหลว จะมีใบที่ใช้ไม่ได้จริงอยู่ในมือผู้ใช้โดยไม่รู้ตัว; เขียนก่อน ความผิดพลาดมีด้านเดียวคือต้องพิมพ์ซ้ำ
- **ไม่มี endpoint ออก QR แยกบน kiosk:** การออกใหม่ทำให้ QR เดิมของคนนั้นใช้ไม่ได้ endpoint เปล่าบน device credential จะทำให้ใครก็ตามที่ถือเครื่องล้าง QR ของคนอื่นได้ การออกจึงผูกกับ flow ที่ยืนยันตัวตนแล้ว (สแกน/บัตร/เบอร์ + `id_last4` หรือ PIN)
- **ไม่มี TTL:** กฎ "ใบใหม่ทำให้ใบเก่าหมดอายุ" ตรงกับปัญหาที่ศูนย์พบ และไม่ทำให้ผู้พักพิงต้องมาพิมพ์ใหม่เพียงเพราะเวลาผ่านไป

**ทางเลือกที่ตัดทิ้ง**

- เก็บ `qr_issued_at` บน evacuee doc: ชน `409` กับ check-in/zoning
- ปุ่ม "ออก QR ใหม่" แยกจากการปริ้น: เพิ่มขั้นตอน และใบที่พิมพ์โดยไม่กดปุ่มนั้นยังเป็นใบเก่า
- คำนวณ hash ใน client: `crypto.subtle` ไม่มีบน http LAN
- ใช้ HMAC ตั้งแต่ครั้งนี้: ไม่จำเป็น — ตัวตรวจเทียบ `prints[].hash` ที่เก็บ จึงอัปเกรดทีหลังได้ฝั่ง server (FR-EQR-42)
- ให้ client คำนวณ sha1 จาก `printed_at` เพื่อตรวจ: ผูก client กับอัลกอริทึม hash และต้องมี sha1 แบบ synchronous บน http LAN

## Risk

- html5-qrcode อ่าน Person QR ผิดประมาณ 8% (`frontend/e2e/README.md:40-42`, วัด 34/400) การเติม `@hash6` ทำให้ payload ยาวขึ้นจาก 34 เป็น 41 ตัวอักษร วัดเมื่อ 2026-11-06 ด้วย `qrcode` ค่าเริ่มต้น: ยังเป็น 29 modules (version 3) เท่าเดิม จึงไม่ควรเพิ่มอัตราอ่านผิด แต่ต้องมี test ล็อกค่านี้ (AC-EQR-13) และถ้า label ใช้ ECC สูงกว่าค่าเริ่มต้นต้องวัดซ้ำ
- scanner ที่ upper-case ข้อความทั้งหมดได้ `hash6` ตัวใหญ่ — FR-EQR-4 ให้ normalize
- ตัวตรวจฝั่ง staff อ่าน `evacuee_qr` ผ่าน CouchDB ตรง: เมื่อ network ล่มจะตรวจไม่ได้ ให้ทำตามพฤติกรรม disconnected เดิม (ไม่ fallback เป็นผ่าน)

## Migration

- **ไม่ backfill:** QR เดิมที่ไม่มี `@` ใช้ได้ต่อไปจนกว่าคนนั้นจะถูกปริ้นด้วยระบบใหม่ครั้งแรก (แถว 1 → แถว 2 ของกฎสแกน)
- doc type ใหม่ `evacuee_qr` เริ่ม `schema_v: 1` · `evacuee` คง `schema_v: 15` (ไม่เปลี่ยนรูป doc)
- ลำดับ deploy: (1) `_design/access` ของทุก `shelter_*` (FR-EQR-38/39) ก่อน มิฉะนั้นการเขียน `evacuee_qr` จะถูกปฏิเสธ → (2) parser/ตัวประเมินกฎสแกนใน staff app และ kiosk BFF → (3) เปิดการออก QR (ส่ง `qr_payload` ใหม่) — client PWA ที่ค้างรุ่นเก่าจะอ่าน `…@hex6` ไม่ได้ จึงต้องไม่ออก QR ใหม่ก่อนรุ่นที่รับ `@` ถูก deploy ครบ
- Mongo / worker: ไม่มี (ไม่ bump `PROJECTION_VERSION`)
- สายรัด/สติกเกอร์ที่พิมพ์ก่อนเปลี่ยนระบบ: ใช้ได้จนมีการปริ้นใหม่ของคนนั้น ไม่ต้องพิมพ์ใหม่ทั้งศูนย์

## Decision log

- 2026-11-06 — proposed (grill #1156 — ข้อตัดสินใจ 9 ข้อ ด้านล่าง)
  1. ขอบเขต: Person QR ของผู้อพยพเท่านั้น; บัตร staff (`TKT-STF-HASH`), บัตร volunteer (`TKT-VOL-HASH`, CR-127 never rotate), `TX-…`, `DN-…` และ bulk-return pool ไม่เปลี่ยน
  2. ออกใหม่ตอนปริ้น: ทุกครั้งที่สั่งปริ้นเพิ่ม entry ใหม่ ไม่มีปุ่ม "ออกใหม่" แยก
  3. หมดอายุเมื่อมีใบใหม่: ไม่มี TTL
  4. QR เดิมที่ไม่มี `@`: ใช้ได้จนกว่าคนนั้นจะถูกปริ้นด้วยระบบใหม่ครั้งแรก
  5. ที่เก็บ: doc แยก `evacuee_qr:{ULID}` ไม่ใส่บน evacuee doc (กัน `409` กับ check-in/zoning และไม่ถูก project ไป `public_persons`)
  6. server ออก payload ทุกครั้ง: endpoint เดียวเขียน entry และคืน payload ห้ามคำนวณใน client (`crypto.subtle` ใช้ไม่ได้บน http LAN; เปลี่ยนเป็น HMAC ภายหลังได้โดยไม่แตะ client ฝั่งออก)
  7. ลำดับ: เขียน entry **ก่อน**ปริ้น ถ้าปริ้นพลาดใบเก่าหมดอายุไปแล้ว ต้องกดปริ้นซ้ำซึ่งได้ entry ใหม่อีกอัน
  8. ความปลอดภัย: sha1 ไม่มี secret กันการนำ QR เก่ากลับมาใช้ ไม่ได้กันการปลอม
  9. Spec: track ด้วย CR file ใน `docs/changes/`
- 2026-11-06 — approved by Project Owner (เจ้าของโครงการ) · หมวด 02-people · supersede CR-151 FR-KPC-107 และข้อความ payload ใน CR-151 FR-KPC-81, CR-149 FR-KWR-19 / FR-KWR-71 · แก้ SOP P3-04 และ sitemap ใน PR เดียวกัน
- 2026-11-06 — approved by Project Owner: ค่าเริ่มต้นที่ผู้ร่าง CR เติมเพื่อให้ implement ได้ (นอกรายการ grill ข้อ 1–9)
  - `printed_by` = `kiosk:{device_id}` / ชื่อผู้ใช้ staff ตามแบบ `station_log` (FR-EQR-10)
  - `/kiosk/register` ใช้ `source: kiosk_checkin` และ `evacuee-wristband-success` ใช้ `profile` ผ่าน modal (FR-EQR-23, FR-EQR-25)
  - retry `409` ไม่เกิน 5 ครั้ง และ `evacuee_ids` ไม่เกิน 30 ต่อ request (FR-EQR-19, §2.8)
  - `evacuee_qr` เขียนได้เฉพาะ server ด้วย admin credential โดย `validate_doc_update` ปฏิเสธ session ผู้ใช้ทั่วไป (FR-EQR-39)
  - kiosk ไม่มี endpoint ออก QR แยก ออกภายใน `check-in` / `reprint` / `register` (FR-EQR-22)
  - staff ใช้ `POST /api/v1/evacuee-qr/issue` (FR-EQR-25)
  - `qr_issue_failed`, `KIOSK_QR_EXPIRED` (409), `KIOSK_QR_INVALID` (400) (FR-EQR-24, FR-EQR-32)
- 2026-11-06 — approved by Project Owner: preview ก่อนพิมพ์ — modal เปิดมาแสดง label พร้อม QR placeholder ไม่เขียน entry; กดพิมพ์จึงเรียก `POST /api/v1/evacuee-qr/issue` ได้ payload จริง render แล้วพิมพ์; การเปิดดูอย่างเดียวไม่ทำให้ QR เดิมหมดอายุ (FR-EQR-21a..21c, AC-EQR-3/4) — แทนมาร์กเกอร์ NEEDS DECISION เดิมของ FR-EQR-21
- 2026-11-06 — approved by Project Owner: เก็บ `hash` (6 hex ตัวเล็ก, server เขียนตอนออก) ในทุก `prints[]` entry; ตัวตรวจทุกตัว (kiosk server และ staff client) เทียบ `hash6` ที่สแกนกับ `prints[].hash` และไม่คำนวณ hash ซ้ำ; `printed_at` ยังเพิ่มขึ้นเข้มงวด; `hash` ชนกับ entry เดิมของคนเดียวกัน → server เลื่อน `printed_at` 1 ms แล้วออกใหม่ (FR-EQR-9a, 17a, 28, 29, 38); การอัปเกรด HMAC เป็นงานฝั่ง server ล้วน สอดคล้องข้อ 6 (FR-EQR-42) — ยกเลิกข้อกำหนดเดิมที่ให้ staff คำนวณ SHA-1 บน client และข้อสรุปว่า HMAC ต้องย้ายตัวตรวจไป server
- 2026-11-06 — renumbered CR-231 → CR-232 → CR-233 เพราะเลขชนกับ CR อื่นที่ merge เข้า `develop` ก่อน (CR-231 public search consent purpose, PR #1214; CR-232 evacuee Excel export, PR #1215) — เนื้อหาไม่เปลี่ยน
- 2026-11-08 — approved by Project Owner (Amendment A1, ขอโดยทีมหน้างาน): หน้าแจกจ่ายยอมให้แจกด้วย QR เก่าได้ผ่านปุ่ม "ยอมรับความเสี่ยงเพื่อแจกจ่าย" · ทุกคนที่แจกจ่ายได้กดได้ + บันทึกร่องรอย (เจ้าของโครงการเลือก) · เก็บร่องรอยใน `distribution_log` และ bump `schema_v` 2→3 แบบ lazy (FR-EQR-48) — เจ้าของโครงการอนุมัติ 2026-11-08 · migration: redeploy `_design/access` ของทุก `shelter_*` ก่อน client รุ่นใหม่ (`pnpm redeploy:access`), ไม่ backfill
