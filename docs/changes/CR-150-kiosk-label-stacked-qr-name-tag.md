---
id: CR-150
title: Kiosk label — QR บน / ข้อความล่าง ใช้ component QR + ชื่อ ร่วมกับตั๋ว pre-register
status: approved
date: 2026-09-27
updated: 2026-10-04 # approved โดย Dev Lead Soravit Sukkarn + รันเลข CR-150 และลงทะเบียนใน _index.md
requested_by: ทีม (kiosk pre-register)
decided_by: Soravit Sukkarn (Dev Lead)
layer: volatile
affects:
  - docs/changes/CR-151-kiosk-pre-registration-check-in.md (ปรับปรุง layout label ใน kiosk pre-register; merge ผ่าน PR #309 แล้ว)
  - frontend/src/lib/components/qr-name-tag.svelte (ใหม่ — shared; ขึ้นกับ branch feat/pre-register_kiosk)
  - frontend/src/lib/utils/qrcode.ts (เพิ่ม qrModuleCount)
  - frontend/src/lib/features/kiosk/domain/print-label.ts (+ test) — ตัด layout 'side' (ขึ้นกับ branch feat/pre-register_kiosk)
  - frontend/src/lib/features/kiosk/ui/kiosk-pre-registered-check-in.svelte (print markup/CSS; ขึ้นกับ branch feat/pre-register_kiosk)
  - frontend/src/lib/features/public-register/ui/booking-ticket.svelte (ใช้ component ร่วม)
why: label ของ kiosk กับตั๋ว QR ที่ดาวน์โหลดจากหน้า pre-register เป็นบล็อก "QR + ชื่อ" แบบเดียวกัน แต่เขียน markup และสร้าง QR แยกกันคนละที่ — ต้องการหน้าตาเดียวกันและดูแลที่เดียว
migration: N/A (ไม่แตะ API / CouchDB / MongoDB / schema_v)
---

# CR-150: Kiosk label — QR บน / ข้อความล่าง ใช้ component QR + ชื่อ ร่วมกับตั๋ว pre-register

> [!NOTE]
> **Branch Dependency & Retrospective Spec:** เอกสารนี้เป็นการ sync spec ย้อนหลัง (retrospective documentation) สำหรับการปรับปรุง layout label และการแชร์ component ที่เริ่มพัฒนาบน feature branch `feat/pre-register_kiosk` (โฟลเดอร์ `frontend/src/lib/features/kiosk` จะเข้าสู่ `develop` พร้อม feature branch ดังกล่าว)

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** label 80×60 mm ของ kiosk เปลี่ยนจาก QR ชิดซ้าย / ข้อความขวา → **QR บน / ข้อความล่าง** (`ชื่อ` · ชื่อ-นามสกุล · `ศูนย์ {shelter_code}`) — ตัดบรรทัด `SMART SHELTER`, ไม่แสดง ULID
> - **เพื่อใคร/ทำไม:** label ของ kiosk และตั๋วที่ดาวน์โหลดจากหน้า pre-register ใช้หน้าตาเดียวกัน · markup "QR + caption + ชื่อ" อยู่ใน component เดียว
> - **Dev ต้อง build:** `$lib/components/qr-name-tag.svelte` (variant `screen` / `label`) · `qrModuleCount()` ใน `$lib/utils/qrcode.ts` · ย้าย kiosk + `booking-ticket.svelte` มาใช้ component นี้
> - **กระทบ schema/scope:** ไม่แตะ schema / API / `schema_v` / QR payload (`evacuee:{ULID}` เท่าเดิม) · ปรับปรุงข้อกำหนด label ใน kiosk pre-register (ผูกกับ feature branch `feat/pre-register_kiosk`)

---

## 1. Why

1. หน้าตาไม่ตรงกัน: ตั๋ว pre-register (ดาวน์โหลด PDF) เป็น QR บน + `ชื่อผู้จอง` + ชื่อ; label kiosk เป็น QR ซ้าย + `SMART SHELTER` + ชื่อ + ศูนย์ — ผู้อพยพเห็นเอกสาร QR สองแบบ
2. โค้ดซ้ำ: `booking-ticket.svelte` สร้าง QR ผ่าน `$lib/utils/qrcode.ts`; kiosk import `qrcode` ตรงและเขียน markup/CSS ของตัวเอง

## 2. Change (before → after)

| หัวข้อ                                | ก่อน                                                                                                                                                          | หลัง                                                                                                               |
| :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------- |
| Layout label kiosk                    | `KIOSK_LABEL_LAYOUT = 'side'` — QR ชิดซ้าย, คอลัมน์ข้อความขวา ≥ 24 mm                                                                                         | QR บนกึ่งกลาง, ข้อความล่างกึ่งกลาง (layout เดียว, ตัดตัวเลือก `'side'`)                                            |
| ข้อความบน label                       | `SMART SHELTER` / ชื่อ-นามสกุล (16pt, ≤ 4 บรรทัด) / `ศูนย์ {code}`                                                                                            | 3 ส่วนข้อมูล (3–4 บรรทัดเมื่อชื่อตัด 2 บรรทัด): `ชื่อ` (8pt) / ชื่อ-นามสกุล (12pt bold, ≤ 2 บรรทัด) / `ศูนย์ {code}` (8pt)            |
| ขนาด QR (evacuee id, v3 = 29 modules) | 350 px, margin 3, 10 dots/module ≈ 43.8 mm                                                                                                                    | 264 px, margin 2, 8 dots/module ≈ 33.0 mm                                                                          |
| Markup QR + ชื่อ                      | ไม่มี component — เขียน inline ใน `booking-ticket.svelte` (`#booking-ticket-print`) และเขียนแยกอีกชุดใน `kiosk-pre-registered-check-in.svelte` (`.wristband`) | แยกบล็อก `#booking-ticket-print` ออกมาเป็น `$lib/components/qr-name-tag.svelte` แล้วให้ทั้งสองที่ใช้ component นี้ |
| สร้าง QR ของ kiosk                    | `import QRCode from 'qrcode'` ตรง                                                                                                                             | `generateQrDataUrl()` + `qrModuleCount()` จาก `$lib/utils/qrcode.ts`                                               |
| ตั๋ว pre-register                     | —                                                                                                                                                             | หน้าตาเดิม (caption `ชื่อผู้จอง`, `รหัส: {code}` เฉพาะ unassigned)                                                 |

### Requirements

| ID                                | Requirement                                                                                                                                                                                                                                                                                              |
| :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-P8 (แก้ — Kiosk Label Layout) | Label แสดง QR กึ่งกลางด้านบน + ข้อความกึ่งกลางด้านล่าง 3 ส่วนข้อมูล (3–4 บรรทัดเมื่อชื่อตัด 2 บรรทัด): `ชื่อ` (8pt), ชื่อ-นามสกุล (12pt bold, ≤ 2 บรรทัด ไม่ล้นขอบ — ต้องผ่านการ mask นามสกุลบางส่วนตามนโยบายความเป็นส่วนตัว FR-KPC-28), `ศูนย์ {shelter_code}` (8pt); พื้นที่ข้อความใต้ QR ≤ `KIOSK_LABEL_TEXT_MM` (20 mm) |
| FR-L1       | `qr-name-tag.svelte` รับ `src` (data URL หรือ Promise), `alt`, `caption`, `name`, `detail?`, `fallback?`, `variant` (`screen` \| `label`)                                                                                                   |
| FR-L2       | variant `label`: สีดำล้วน, ขนาด QR จาก CSS var `--qr-size` (mm), `image-rendering: pixelated`, ตัวอักษร ≥ 8pt; กรณีสร้าง/โหลด QR ไม่สำเร็จหรือไม่มีข้อมูล ให้แสดงกรอบ placeholder ขนาดเท่า QR พร้อมตัวหนังสือ "QR" (8pt) กึ่งกลางกรอบ |
| FR-L3       | variant `screen`: หน้าตาเดิมของ `#booking-ticket-print` (QR 176 px, placeholder ระหว่างสร้าง, ข้อความ fallback เมื่อสร้าง QR ไม่สำเร็จ)                                                                                                       |
| FR-L4       | kiosk ไม่ import `qrcode` ตรง; ขนาด QR ยังคำนวณด้วย `kioskQrPrintSize()` (1 module = จำนวน dot เต็ม, quiet zone ≥ 4 modules)                                                                                                                 |

### Acceptance

- AC-L1 — `pnpm test` ผ่าน: `print-label.test.ts` ยืนยัน QR box ของ layout ใหม่, v3 → 8 dots/module, QR ≥ 20 mm, quiet zone ≥ 4 modules
- AC-L2 — พิมพ์ครัวเรือน 2 คน (1 คนชื่อยาว ≥ 40 ตัวอักษร) บน XP-365B → 2 label, QR บน ข้อความล่าง, ชื่อ ≤ 2 บรรทัด ไม่ล้นขอบ, สแกนกลับที่ kiosk ได้
- AC-L3 — ตั๋ว pre-register (ทั้งแบบระบุศูนย์และ unassigned) ดาวน์โหลด PDF ได้หน้าตาเดิม; Ctrl+P ยังได้หน้าเดียวเฉพาะ QR

## 3. Impact

| พื้นที่                    | ผลกระทบ                                                                                                                                                                                                                                                           |
| :------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/kiosk`           | `domain/print-label.ts`: ลบ `KIOSK_LABEL_LAYOUT`, `KIOSK_LABEL_SIDE_TEXT_MM`; `kioskQrBoxMm()` เหลือสูตร stacked · print CSS ของ `kiosk-pre-registered-check-in.svelte` เหลือเฉพาะกรอบ label (ขนาด/padding/page break) *(ขึ้นกับ feature branch `feat/pre-register_kiosk`)* |
| `features/public-register` | `booking-ticket.svelte` ใช้ `QrNameTag`; print CSS เปลี่ยน selector ของ `img`/descendant เป็น `:global()` เพราะ element อยู่ใน child component                                                                                                                   |
| Shared                     | component ใหม่ใน `$lib/components/` (ข้าม feature จึงไม่อยู่ใน `features/*/ui`)                                                                                                                                                                                   |
| API / DB / QR payload      | ไม่มี                                                                                                                                                                                                                                                             |
| Scanner client / CUPS      | ไม่มี (`KIOSK_LABEL_MM` = 80×60 เท่าเดิม)                                                                                                                                                                                                                         |

## 4. Migration

N/A

## 5. Out of scope

- QR ที่อื่น (`evacuee-qr-modal`, `volunteer-portal/digital-pass`, `donations/track`) ยังไม่ย้ายมาใช้ `QrNameTag`
- การรวม string `evacuee:{ULID}` ไว้ที่เดียว
- ตั๋ว unassigned (QR = registration id) ยังสแกนที่ kiosk ไม่ได้ตามเดิม (#255)

## Decision log

- 2026-09-27 — proposed; เจ้าของเลือก layout "QR บน / `ชื่อ` + ชื่อ + `ศูนย์ X`, ไม่แสดง ULID" และ track เป็น CR ไฟล์ใหม่
- 2026-10-04 — ปรับปรุงตาม PR Review (#321): ลบ dead link, ปรับ `affects:` อ้างอิงเอกสารที่มีอยู่จริง (ระบุสถานะรอ merge), ระบุ branch dependency (`feat/pre-register_kiosk`), ขยายความ FR-P8 เรื่องจำนวนบรรทัด (3–4 บรรทัดเมื่อชื่อตัด 2 บรรทัด), FR-L2 พฤติกรรม placeholder บนกระดาษความร้อน, ระบุรหัสเป็น FR-P8 (แก้ — Kiosk Label Layout) ให้ชัดเจน และเพิ่มหมายเหตุนโยบาย Privacy การ mask นามสกุล (FR-KPC-28)
- 2026-10-04 — approved โดย Dev Lead Soravit Sukkarn หลัง merge PR #321 เข้า develop · รันเลข CR-150 จาก docs/changes/_index.md


