---
id: CR-096
title: Volunteer Access Portal — ตารางงาน, Digital Pass read-only, และตอบรับภารกิจด้วยเบอร์โทร + รหัสที่อ่านทางโทรศัพท์ (superseded โดย CR-104)
status: superseded
superseded_by: CR-104
superseded_date: 2026-09-01
note: รวมเนื้อหาและยกเลิกระบบ Direct Dispatch/Voice 2FA เข้าสู่ CR-104-volunteer-backoffice-and-user-management-v10.md ฉบับสมบูรณ์แล้ว
date: 2026-08-29
updated: 2026-09-01
requested_by: เจ้าของโครงการ (ปิดช่องว่างที่พบระหว่าง implement CR-092)
decided_by: เจ้าของโครงการ (superseded โดย CR-104)
layer: volatile
affects:
  - docs/changes/CR-104-volunteer-backoffice-and-user-management-v10.md
---

# CR-096 — Volunteer Access Portal: ตารางงาน + ตอบรับภารกิจ (superseded โดย CR-104)

> ⚠️ **สถานะเอกสาร:** `superseded` — เนื้อหาในเอกสารฉบับนี้ถูกรวบรวมและยกระดับเข้าสู่ [CR-104 — Volunteer Backoffice & User Management V10](CR-104-volunteer-backoffice-and-user-management-v10.md) ฉบับสมบูรณ์แล้ว โดยระบบยกเลิกกระบวนการเสนองานตรง (Direct Dispatch) และรหัสตอบรับ 2 ปัจจัยทางโทรศัพท์ เพื่อความเรียบง่ายและเป็นไปตาม Job Board Model

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เปิด public read path ของ `shift_assignment` ให้เป็น "ตารางทำงานจิตอาสา" · ล็อกอินพอร์ทัลด้วยเบอร์โทรได้แบบ **อ่านอย่างเดียว** (ยกเลิกตั๋วต้องใช้ tracking token) · เพิ่มการ **ตอบรับ/ปฏิเสธภารกิจ** ด้วย **สองปัจจัย** คือเบอร์ที่ล็อกอิน + รหัส 6 ตัวที่ผู้จัดการศูนย์อ่านให้ทางโทรศัพท์
- **เพื่อใคร/ทำไม:** CR-092 FR-VOL-06 กำหนดปุ่มยอมรับ/ปฏิเสธไว้แต่ไม่ได้ระบุว่าอะไรพิสูจน์ตัวตน อาสาไม่มีบัญชี และการปฏิเสธย้อนกลับไม่ได้ — ถ้าไม่ปิดช่องนี้ กะจะค้างที่ `dispatched` ตลอดไปและที่นั่งถูกล็อกกับคนที่ไม่เคยตอบ
- **dev ต้อง build:** projector + read model ของ `shift_assignment` · endpoint `schedule` / `schedule/respond` / `ticket/find` · response buffer + inbound loop · view token · UI ตารางงาน + Dispatch Card
- **กระทบ schema/scope:** `shift_assignment` **v2 → v3** (additive) · เพิ่ม 4 endpoint บน public plane · ไม่แตะ stable core (envelope/auth/sync/layer boundary)

## Why

CR-092 วางระบบจิตอาสาไว้ครบ แต่เมื่อลง implement พบช่องว่าง 3 จุดที่ทำให้ flow ใช้งานจริงไม่ได้:

1. **ไม่มีทางอ่านตารางงาน** — CR-092 หน้าจอ 6 ให้อาสาดู "ตารางกะงาน" แต่ `shift_assignment` ไม่มี projection ลง public plane เลย ตารางที่สร้างจาก `job_application` แทนได้ไม่ครบ เพราะอาสาที่ผู้จัดการศูนย์มอบหมายตรงไม่เคยยื่นใบสมัคร
2. **ไม่มีเกณฑ์พิสูจน์ตัวตนสำหรับการเขียน** — พอร์ทัลล็อกอินด้วยเบอร์โทรซึ่งเดาได้ ขณะที่การยกเลิกตั๋วและการปฏิเสธภารกิจย้อนกลับไม่ได้
3. **ไม่มีช่องทางส่งรหัสให้อาสา** — Direct Dispatch เป็นฝ่ายระบบไปหาอาสา แต่ CR-092 คงหลัก No-SMS ไว้และไม่ได้ระบุ notification channel

## Decisions

| # | ID | คำตัดสิน |
| --- | --- | --- |
| 1 | **D-PORTAL-AUTH** | พอร์ทัลล็อกอินด้วยเบอร์โทร หรือรหัสตั๋ว — ไม่มีบัญชี ไม่มีรหัสผ่าน (คงตาม CR-092 §2.1.1) |
| 2 | **D-READ-ONLY-LOOKUP** | เข้าด้วยเบอร์โทร = **อ่านอย่างเดียว** · การยกเลิกตั๋วต้องใช้ `tracking_token` ที่ผู้สมัครถือ |
| 3 | **D-DISPATCH-AUTH** | ตอบรับ/ปฏิเสธภารกิจต้องมี **สองปัจจัย**: เบอร์ที่ล็อกอินตรงกับเจ้าของกะ **และ** รหัสที่ผู้จัดการศูนย์อ่านให้ |
| 4 | **D-DISPATCH-CHANNEL** | ช่องทางแจ้งรหัส = **ผู้จัดการศูนย์โทรบอก** — ไม่ใช้ SMS/push (คงหลัก No-SMS ของ CR-092) |
| 5 | **F-CODE-FORMAT** | รหัส 6 ตัว 2 กลุ่ม (`4K7-2M9`) จาก alphabet 30 ตัวที่ตัด `I L O U 0 1` ออกเพราะฟัง/อ่านสับสน |
| 6 | **F-CODE-SINGLE-USE** | ใช้ได้ครั้งเดียว — ล้าง `response_code` ทิ้งเมื่อบันทึกคำตอบแล้ว |
| 7 | **F-UNIFORM-404** | ผิดปัจจัยใดก็ตาม (เบอร์ผิด / รหัสผิด / กะไม่มี / ตอบไปแล้ว) ตอบ **404 เหมือนกันหมด** |
| 8 | **F-SCHEDULE-SOURCE** | ตารางงานอ่านจาก `shift_assignment` ไม่ใช่ `job_application` |

## Requirements

### ตารางทำงานจิตอาสา

- **FR-96-01** — ระบบต้อง project `shift_assignment` ลง public read model โดยเก็บ `phone_hash` ของอาสาที่ถูกมอบหมาย เพื่อให้ค้นตารางด้วยเบอร์โทรได้
- **FR-96-02** — `POST /public/v1/volunteer/schedule` รับ `{phone}` คืนรายการกะเรียงตามเวลาเริ่มกะจากใกล้ที่สุดไปไกลที่สุด กะที่ไม่มีเวลากำหนดเรียงท้ายสุด
- **FR-96-03** — แต่ละกะต้องคืน `job_title`, `shelter_name`, `station`, `duty_window`, `check_in_at`, `check_out_at`, `status`, `dispatch_status`
- **FR-96-04** — กะที่ `status = cancelled` ต้องไม่ปรากฏใน public read model
- **FR-96-05** — เบอร์ที่ไม่มีในระบบต้องคืน list ว่างพร้อม HTTP 200 — ห้ามคืน 404 หรือข้อความที่บอกว่ารู้จักเบอร์นั้นหรือไม่

### Digital Pass — อ่านอย่างเดียวเมื่อเข้าด้วยเบอร์โทร (D-READ-ONLY-LOOKUP)

- **FR-96-06** — `POST /public/v1/volunteer/ticket/find` ต้องคืน **view token** ที่มีอายุจำกัดและเปิดบัตรได้อย่างเดียว — ห้ามคืน `tracking_token`
- **FR-96-07** — `GET /public/v1/volunteer/ticket/{token}` ต้องรับได้ทั้ง tracking token และ view token และคืน `can_cancel` ตามชนิดของ token ที่ใช้เปิด
- **FR-96-08** — `POST /public/v1/volunteer/ticket/{token}/cancel` ต้องรับเฉพาะ tracking token · view token ตอบ 404
- **FR-96-09** — view token ต้องหมดอายุภายใน 30 นาที และต้องตรวจสอบลายเซ็นได้โดยไม่ต้องเก็บ state
- **FR-96-10** — `ticket/find` ต้องคืน `applicant_name` เพื่อให้พอร์ทัลแสดงชื่อผู้ล็อกอินได้ (ข้อมูลนี้เปิดอยู่แล้วบนบัตรที่ view token เดียวกันเปิดได้)

### ตอบรับ/ปฏิเสธภารกิจ (CR-092 FR-VOL-06)

- **FR-96-11** — เมื่อผู้จัดการศูนย์เสนอมอบหมายกะ ระบบต้องออก `response_code` ตาม F-CODE-FORMAT ลงบน `shift_assignment` ในฐานข้อมูลศูนย์
- **FR-96-12** — `POST /public/v1/volunteer/schedule/respond` รับ `{assignment_id, phone, code, action}` โดย `action` เป็น `accepted` หรือ `declined` เท่านั้น
- **FR-96-13** — ระบบต้องรับคำตอบเมื่อ **เบอร์ตรงกับเจ้าของกะ และ รหัสตรง** เท่านั้น · ผิดข้อใดข้อหนึ่งตอบ 404 ตาม F-UNIFORM-404
- **FR-96-14** — รหัสต้องเทียบแบบไม่สนตัวพิมพ์ ตัวคั่น และช่องว่าง (`4k7 2m9` = `4K7-2M9`)
- **FR-96-15** — เมื่อตอบรับ โควตาต้องขยับ 🟡 −1 / 🟢 +1 · เมื่อปฏิเสธ 🟡 −1 · ทั้งสองกรณีต้องเป็น update เดียวแบบอะตอมมิก
- **FR-96-16** — กะหนึ่งกะตอบได้ครั้งเดียว · คำตอบซ้ำหรือคำตอบพร้อมกันต้องไม่ทำให้โควตาขยับเกินหนึ่งครั้ง
- **FR-96-17** — เมื่อบันทึกคำตอบลงฐานข้อมูลศูนย์แล้ว ระบบต้องล้าง `response_code` และตั้ง `status` เป็น `standby` (ตอบรับ) หรือ `cancelled` (ปฏิเสธ)
- **FR-96-18** — endpoint นี้ต้องถูก rate limit ไม่เกิน 10 ครั้ง/นาที/IP

### Non-functional

- **NFR-96-01** — public read model ต้องไม่เก็บ `response_code` เป็น plaintext (เก็บเฉพาะ hash) · plaintext อยู่ในฐานข้อมูลศูนย์เท่านั้นเพราะเจ้าหน้าที่ต้องอ่านออกเสียง
- **NFR-96-02** — public read model ต้องไม่เก็บเบอร์โทรดิบ (เก็บเฉพาะ `phone_hash`)
- **NFR-96-03** — การเขียนจาก public plane ต้องผ่าน buffer + worker inbound loop ตามแพทเทิร์นเดียวกับ donation — ห้าม public plane เขียน CouchDB โดยตรง

## Change — schema

### `shift_assignment` §2.9 · **schema_v 2 → 3**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `dispatch_status` | enum(`dispatched`,`accepted`,`declined`)\|null | opt | สถานะการเสนอมอบหมาย (CR-092 FR-VOL-06) |
| `response_code` | str\|null | opt | รหัสที่ผู้จัดการศูนย์อ่านให้ · plaintext เฉพาะในฐานข้อมูลศูนย์ · ล้างทิ้งหลังใช้ |
| `responded_at` | ts\|null | opt | เวลาที่อาสาตอบ |
| `status` | เพิ่มค่า `standby`, `completed` | req | จากเดิม `assigned`,`checked_in`,`done`,`no_show`,`cancelled` |

> `done` กับ `completed` มีความหมายเดียวกัน — เอกสารเดิมใช้ `done`, CR-092 ใช้ `completed`
> `> [NEEDS DECISION: ใช้คำไหนเป็นค่าจริง แล้วให้อีกคำเป็น alias ตอนอ่าน หรือ migrate ค่าเดิมทั้งหมด]`

## Change — API (public plane)

| Endpoint | หน้าที่ | Auth |
| --- | --- | --- |
| `POST /public/v1/volunteer/schedule` | ตารางทำงานจิตอาสาของเบอร์นั้น | — (rate limit) |
| `POST /public/v1/volunteer/schedule/respond` | ตอบรับ/ปฏิเสธภารกิจ | เบอร์ + รหัส (สองปัจจัย) |
| `POST /public/v1/volunteer/ticket/find` | ค้นบัตรด้วยเบอร์ → view token | — (rate limit) |
| `GET /public/v1/volunteer/ticket/{token}` | เปิดบัตร (tracking หรือ view token) | token |

Route ฝั่ง SPA ที่เพิ่ม: `/volunteers/find-ticket`

## Impact

| Artifact | ผลกระทบ |
| --- | --- |
| `docs/data/schema.md` §2.9 | เพิ่ม 3 field + ขยาย enum `status` + bump `schema_v` + migration note |
| `docs/sitemap.md` §3 | เพิ่ม 4 endpoint + route `/volunteers/find-ticket` |
| `docs/task-breakdown/06-A-volunteer.md` | T-28 DoD ครอบคลุมตารางงาน + ตอบรับภารกิจ |
| `packages/tent-model` | read model + buffer + counter ops |
| `worker/` | projector `shift_assignment` + inbound loop คำตอบ |
| `backend/apiapp/modules/volunteers/` | 4 endpoint + view token + response code |
| `frontend/src/lib/features/volunteers/` | feature slice ครบ 4 ชั้น + BFF 5 route |

**การแก้นอกขอบเขต CR (bug fix — ไม่ใช่ spec change):** `src/routes/+layout.svelte` เดิมเรียก `queryClient.clear()` ทุกครั้งที่ไม่มี session ทำให้ query ของหน้า public ที่โหลดข้อมูลตั้งแต่ render แรกถูกยกเลิกและค้างที่สถานะ loading ถาวร แก้เป็นล้างเฉพาะตอนออกจากระบบจริง ไม่มีเอกสารใดระบุพฤติกรรมเดิมไว้ จึงไม่เข้าข่าย change-management §2

## Migration — `shift_assignment` v2 → v3

Additive ล้วน ไม่ต้อง backfill:

- `dispatch_status`, `response_code`, `responded_at` — doc เดิมอ่านเป็น `null`
- `status` ขยาย enum โดยไม่ลบค่าเดิม — doc เดิมทุกใบยังถูกต้อง
- `validate_doc_update` และ Zod ต้องยอมรับทั้งค่าเดิมและค่าใหม่

## Acceptance

- [ ] **AC-96-01** — เบอร์ที่มีกะได้ตารางเรียงตามเวลา · เบอร์ที่ไม่มีได้ list ว่าง HTTP 200
- [ ] **AC-96-02** — อาสาที่ผู้จัดการศูนย์มอบหมายตรง (ไม่เคยยื่นใบสมัคร) เห็นกะของตนในตาราง
- [ ] **AC-96-03** — ค้นบัตรด้วยเบอร์ได้ view token ที่เปิดบัตรได้แต่ `can_cancel = false` และเรียก cancel แล้วได้ 404
- [ ] **AC-96-04** — เปิดบัตรด้วย tracking token ได้ `can_cancel = true` และยกเลิกได้สำเร็จ
- [ ] **AC-96-05** — view token ที่หมดอายุหรือถูกปลอมลายเซ็น ตอบ 404
- [ ] **AC-96-06** — ตอบรับด้วยเบอร์ถูก+รหัสถูก สำเร็จ · เบอร์ผิด หรือ รหัสผิด ตอบ 404 และโควตาไม่ขยับ
- [ ] **AC-96-07** — รหัสที่พิมพ์ต่างรูปแบบ (`seed 99`, `SEED-99`) ให้ผลเดียวกัน
- [ ] **AC-96-08** — ตอบซ้ำ และตอบพร้อมกันสองครั้ง โควตาขยับครั้งเดียว
- [ ] **AC-96-09** — หลังตอบรับ ฐานข้อมูลศูนย์มี `dispatch_status = accepted`, `status = standby`, `response_code = null`
- [ ] **AC-96-10** — Digital Pass ไม่แสดงและไม่ส่ง `national_id` และแสดงเบอร์แบบ mask
- [ ] **AC-96-11** — ไม่มี collection ใดใน public read model เก็บเบอร์โทรดิบหรือ `response_code` plaintext

## Decision log

- 2026-08-29 — proposed · เจ้าของโครงการเลือกกลไก **D-DISPATCH-AUTH** (สองปัจจัย) และ **D-DISPATCH-CHANNEL** (ผู้จัดการศูนย์โทรบอกรหัส) จากทางเลือก view token / tracking token / token ต่อ assignment
- 2026-08-29 — เจ้าของโครงการเลือก **D-READ-ONLY-LOOKUP** จากทางเลือก เบอร์อย่างเดียว / เบอร์+รหัสตั๋ว / อ่านได้ด้วยเบอร์แต่เขียนต้องมี token
- 2026-08-29 — เจ้าของโครงการกำหนดให้รวมงานทั้งชุดไว้ใน CR เดียว และ track ด้วยไฟล์ CR + `_index.md`

## รอเจ้าของเคาะ

- `> [NEEDS DECISION: ค่า status — ใช้ done หรือ completed]` (ดู §Change — schema)
- `layer` ตั้งไว้ `volatile` — กลไกพิสูจน์สิทธิ์เขียนอยู่ใกล้ stable core หากเจ้าของจัดเป็น stable ต้องผ่าน review ก่อน merge
- ยังไม่ apply ลง `docs/data/schema.md` / `docs/sitemap.md` / `docs/task-breakdown/06-A-volunteer.md` — รอ `approved`
