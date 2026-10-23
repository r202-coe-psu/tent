---
id: CR-163
title: Kiosk — เปิดช่องทางรายงานตัวด้วย ThaiD (QR บนตู้ → ยืนยันบนมือถือ) + toggle รายศูนย์
status: approved
date: 2026-10-10
created: 2026-10-10
updated: 2026-10-23
requested_by: ทีม kiosk
decided_by: เจ้าของโครงการ (PO, net-lynx) — approved 2026-10-11
layer: volatile
amends:
  - docs/changes/14-kiosk/CR-151-kiosk-pre-registration-check-in.md F-08 (ThaiD ⏸), FR-KPC-11, §7 สัญญา API
  - docs/changes/14-kiosk/CR-152-kiosk-phone-check-in-toggle.md FR-KPC-11 (จำนวนการ์ด/grid)
affects:
  - docs/data/schema.md §3.1 shelter `feature_flags` (+ `kiosk_thaid_check_in_enabled`; ไม่ bump schema_v ตาม precedent CR-048/CR-106/CR-152)
  - docs/data/schema.md app config `thaid_registration_enabled` (ครอบคลุม mode `kiosk_check_in`)
  - docs/data/api-contract.md (Scanner / Kiosk — `POST /api/v1/scanner/kiosk/thaid/session{,/status,/cancel}`, `source:'thaid'` ใน lookup/check-in, ThaiD OAuth mode `kiosk_check_in`)
  - frontend/src/lib/server/thaid-scan-session.ts (+ test)
  - frontend/src/lib/server/thaid-oauth.ts (+ test)
  - frontend/src/routes/api/v1/auth/oauth/thaid/{start,callback}/+server.ts (+ callback.test.ts)
  - frontend/src/routes/api/public/v1/thaid/scan-session/[id]/** (ปิดไม่ให้อ่าน kiosk session)
  - frontend/src/routes/api/v1/scanner/kiosk/thaid/session/** (ใหม่ + server.test.ts)
  - frontend/src/routes/api/v1/scanner/kiosk/{lookup,check-in,config}/+server.ts
  - frontend/src/lib/features/kiosk/{server,domain,data,application,ui}
  - frontend/src/routes/kiosk/thaid/ (ใหม่)
  - frontend/src/routes/(public)/thaid-scan-success/+page.svelte
  - frontend/src/lib/features/shelters/domain/schema.ts · ui/basic-info-section.svelte
  - scanner_client/app/manager.py (`_route_kiosk_api` allowlist) · scanner_client/tests/test_manager.py
why: >
  CR-151 วางช่องทาง ThaiD ไว้แต่พักไว้ (F-08 ⏸). ผู้ลงทะเบียนล่วงหน้าบางส่วนไม่มีบัตรติดตัวแต่มีแอป ThaiD บนมือถือ.
  กลไก cross-device ThaiD (`member_scan`) ทำงานอยู่แล้วบนหน้า pre-register ด้วย redirect URI เดิม — reuse ได้โดยไม่ต้องขอ URI ใหม่กับ DOPA
migration: ไม่มี backfill — flag ใหม่ใน `feature_flags` default `false`; doc เดิมที่ไม่มี key อ่านเป็นปิด. ไม่มี doc ใหม่ที่ persist (session อยู่ใน memory)
---

# CR-163: Kiosk — รายงานตัวด้วย ThaiD

> **สถานะ:** approved โดย PO 2026-10-11 (spec only — ยังไม่ implement) · D-1..D-8 เคาะครบ · โค้ดต้นแบบอยู่บน `feat/pre-register_kiosk` — หลัง CR approve ให้เปิด PR โค้ดใหม่เพื่อรีวิวเทียบกับ CR (ห้าม merge branch เก่าตรง ๆ)

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** การ์ด ThaiD บน `/kiosk` เปลี่ยนจาก ⏸ ปิด → ใช้งานได้; ตู้แสดง QR → ผู้อพยพยืนยันในแอป ThaiD บนมือถือตัวเอง → ตู้ lookup/check-in ต่อเหมือนช่องทางบัตร (`pre_registered → arriving`)
> - **เพื่อใคร / ทำไม:** ผู้ลงทะเบียนล่วงหน้าที่ไม่มีบัตรติดตัว · server เป็นผู้ resolve เลข 13 หลักจาก session ที่ผูกกับตู้ — browser ไม่ส่งเลขบัตร
> - **Dev ต้องทำอะไร:** session `kind=kiosk_check_in` ใน store เดิม · endpoint device-auth 3 ตัว · OAuth mode `kiosk_check_in` · `source:'thaid'` ใน lookup/check-in · allowlist scanner_client · หน้า `/kiosk/thaid` · Switch ในฟอร์มศูนย์
> - **กระทบ schema / scope:** `feature_flags.kiosk_thaid_check_in_enabled` (additive, ไม่ bump `schema_v`) · enum `source` ของ kiosk gate เพิ่ม `thaid` · walk-in ด้วย ThaiD ยังอยู่นอก scope (CR-149)

## Why

ดู frontmatter `why`.

## Change

| เรื่อง                      | ก่อน                                                                   | หลัง                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| การ์ด ThaiD ที่`/kiosk`     | `enabled:false` "ยังไม่เปิดใช้งาน" (CR-151 F-08 ⏸)                     | ใช้งานได้ →`/kiosk/thaid`; แสดงเมื่อ flag ศูนย์ + ThaiD ระดับระบบเปิด (fail closed)                                                          |
| `shelter.feature_flags`     | ไม่มี key ThaiD                                                        | +`kiosk_thaid_check_in_enabled: bool` default `false`                                                                                        |
| `/kiosk/config` response    | `{shelter_code, phone_check_in_enabled, walk_in_registration_enabled}` | +`thaid_check_in_enabled`                                                                                                                    |
| Kiosk gate`source`          | `smart-card` · `qr` · `phone`                                          | +`thaid` (`{source:'thaid', session_id}` — ไม่รับเลข 13 หลักจาก browser)                                                                     |
| Check-in`source`            | `smart-card` · `qr` · `phone`                                          | +`thaid` + `thaid_session_id` (ต้องตรง pid ของ primary; session single-use; เขียนล้ม → คืน session ให้ลองใหม่)                               |
| ขอบเขตการยืนยัน ThaiD       | —                                                                      | ยืนยันคนเดียว (คนที่สแกน) → รายงานตัวแทนทั้งครัวเรือน; แนบ session เฉพาะ batch ที่มีคนสแกน, batch อื่นตรวจแบบช่องทาง QR / บัตร / เบอร์ (D-8) |
| Session status response     | —                                                                      | 200`{status, expires_at, expires_in_sec}` · 404 `{status:'expired'}`; 429 = `KIOSK_RATE_LIMITED`                                             |
| ThaiD OAuth mode            | `link` · `stepup` · `login` · `register` · `member_scan`               | +`kiosk_check_in` (scope เดียวกับ `member_scan` — ได้เลข 13 หลัก + ชื่อ (D-6), callback เดิม)                                                |
| Scan session                | `member_scan` อย่างเดียว, อ่าน profile ผ่าน public GET/SSE             | +`kind=kiosk_check_in` ผูก `device_id`+`shelter_code`; public GET/SSE ตอบ 404 สำหรับ kind นี้                                                |
| Endpoint ใหม่ (device-auth) | —                                                                      | `POST /api/v1/scanner/kiosk/thaid/session`, `/status`, `/cancel`                                                                             |
| Face check / staff PIN      | ใช้กับช่องทางบัตร                                                      | ช่องทาง ThaiD ไม่ใช้                                                                                                                         |
| ไม่พบข้อมูลด้วย ThaiD       | —                                                                      | `not_found` + `can_register:false`                                                                                                           |

## Requirements / Acceptance

| ID        | Requirement — ผ่านเมื่อ                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| KTD-AC-01 | Session ใช้ได้ครั้งเดียว — check-in สำเร็จแล้วส่ง `thaid_session_id` เดิมซ้ำ → reject `KIOSK_THAID_SESSION_INVALID`                                  |
| KTD-AC-02 | Session ผูกกับ `device_id` + `shelter_code` ของตู้ที่สร้าง — ตู้อื่นหรือศูนย์อื่นใช้ `session_id` นี้ (status / lookup / check-in / cancel) → reject |
| KTD-AC-03 | Public `GET /api/public/v1/thaid/scan-session/[id]` และ SSE คืน **404** เมื่อ session มี `kind=kiosk_check_in`                                       |
| KTD-AC-04 | Browser ของตู้ไม่ส่งเลข 13 หลักออกไป — lookup/check-in ช่องทาง ThaiD รับแค่ `{source:'thaid', session_id}`; server resolve เลขบัตรจาก session เอง    |
| KTD-AC-05 | Check-in: pid ใน `thaid_session_id` ต้องตรงกับ pid ของผู้สแกน (primary ใน batch นั้น) — ไม่ตรง → reject `KIOSK_THAID_SESSION_INVALID`                |
| KTD-AC-06 | Timeout ตาม D-4 — pending เกิน 300 วิ หรือ completed เกิน 180 วิ → status คืน 404 `{status:'expired'}` และ lookup/check-in ด้วย session นั้น reject  |
| KTD-AC-07 | Rate limit ตาม D-5 — สร้าง session เกิน 10 ครั้ง/นาที/kiosk → 429 `KIOSK_RATE_LIMITED`                                                               |
| KTD-AC-08 | Regression — flow `member_scan` เดิมบนหน้า pre-register (สร้าง session → สแกน → อ่าน profile ผ่าน public GET/SSE) ทำงานเหมือนเดิม                    |
| KTD-AC-09 | Toggle fail closed — เมื่อ `kiosk_thaid_check_in_enabled=false` หรือ `thaid_registration_enabled=false` → การ์ด ThaiD ซ่อน และ `POST /api/v1/scanner/kiosk/thaid/session` คืน 403/404 (เพิ่มตามเงื่อนไข PO approve 2026-10-11) |
| KTD-AC-10 | Callback ข้ามเบราว์เซอร์ — mode `kiosk_check_in` และ `member_scan` ไม่บังคับให้ cookie `oauth_thaid_state` ตรงกับ `state` (มือถือสแกน QR ด้วยเบราว์เซอร์หนึ่ง แต่แอป ThaiD เปิด callback ในเบราว์เซอร์ default อีกตัว) แต่ยังต้องผ่าน HMAC ของ `state` และ session ต้อง `pending` · mode `login` / `link` / `stepup` / `register` ยังต้องตรง cookie → ไม่ตรง = `invalid_state` · error ของสอง mode นี้ redirect ตาม mode ใน `state` ที่เซ็น (ไม่ใช่ cookie ที่ค้างจาก flow อื่น) · หน้า `/thaid-scan-success` แสดงข้อความ `invalid_state` ให้สแกน QR ใหม่ (kiosk: "ข้อมูลการยืนยันตัวตนไม่ถูกต้องหรือหมดอายุ กรุณาสแกน QR ใหม่ที่ตู้" · member_scan: "…กรุณาสแกน QR ใหม่จากหน้าจอลงทะเบียน") (เพิ่ม 2026-10-23, #757) |

## Security

- **เก็บใน memory เท่านั้น** — session (รวม pid + ชื่อจาก ThaiD) อยู่ใน in-memory store ของ server; ไม่เขียน CouchDB / Mongo / ไฟล์ / browser storage
- **ลบทิ้งทันที** เมื่อ check-in สำเร็จ, cancel, หรือหมดเวลาตาม D-4 — ไม่เก็บไว้รอ GC
- **ไม่ log เลข 13 หลักและชื่อ** — log / error / telemetry ห้ามมี pid หรือชื่อเต็ม; ถ้าจำเป็นต้องอ้างถึงให้ mask (เช่น `x-xxxx-xxxxx-12-3`)
- **Reject session ที่ถูกใช้ซ้ำ** — `session_id` ที่ consume แล้ว หรือถูกลบแล้ว ใช้ซ้ำไม่ได้ทุก endpoint (KTD-AC-01)
- **ไม่ผูก callback กับเบราว์เซอร์ใน mode ข้ามอุปกรณ์** — `kiosk_check_in` / `member_scan` ข้ามการเทียบ state cookie เพราะผลลัพธ์ลงที่ scan session ฝั่ง server (single-use, `pending` เท่านั้น) ไม่ใช่เบราว์เซอร์ที่เปิด callback; `state` ยังต้องผ่าน HMAC. Mode ที่ผลลงเบราว์เซอร์ (`login` / `link` / `stepup` / `register`) ยังเทียบ cookie เพื่อกัน login CSRF (KTD-AC-10)

## D-7 — ข้อความ (PO approve 2026-10-11 ตามที่เขียน)

ข้อความจริงจากโค้ดต้นแบบบน `feat/pre-register_kiosk`

**การ์ด ThaiD บน `/kiosk`**

| ส่วน                | ข้อความ                                 |
| ------------------- | --------------------------------------- |
| หัวการ์ด            | ThaiD                                   |
| คำอธิบาย            | สแกน QR ด้วยมือถือแล้วยืนยันในแอป ThaiD |
| ปุ่ม                | ใช้ ThaiD                               |
| ขั้นที่ 2 ใน wizard | สแกนด้วย ThaiD                          |

**หน้า `/kiosk/thaid` (จอตู้)**

| สถานะ                             | หัวข้อ                               | ข้อความ / ปุ่ม                                                                                                                                                         |
| --------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| แสดง QR                           | สแกน QR ด้วยมือถือ                   | ขั้นตอน: 1 เปิดกล้องหรือ LINE · 2 สแกน QR · 3 ยืนยันในแอป ThaiD · alt ของรูป: "QR สำหรับยืนยันตัวตนด้วย ThaiD" · ระหว่างสร้าง QR: spinner (aria-label "กำลังสร้าง QR") |
| รอ (QR ขึ้นแล้ว รอยืนยันบนมือถือ) | สแกน QR ด้วยมือถือ                   | "QR หมดอายุใน m:ss" — นับถอยหลังตาม D-4 (pending 300 วิ)                                                                                                               |
| สำเร็จ                            | เลือกสมาชิก (ขั้นที่ 3: ยืนยันตัวตน) | "เลือกผู้ที่มาถึง" → หลังบันทึก: หัวข้อ "ผลรายงานตัว" · "ตรวจผล แล้วพิมพ์ QR Code" (เหมือนช่องทางอื่น)                                                                 |
| หมดเวลา                           | QR หมดอายุ                           | "กรุณาสร้าง QR ใหม่แล้วสแกนอีกครั้ง" · ปุ่ม [สร้าง QR ใหม่] [กลับหน้าเริ่มต้น]                                                                                         |
| ไม่พบข้อมูล                       | ค้นหาไม่สำเร็จ                       | "ไม่พบผู้ลงทะเบียนล่วงหน้าในศูนย์นี้" · ปุ่มหลัก [กลับ] (ไม่มี "ลองอีกครั้ง" และไม่เสนอ walk-in — `can_register:false`)                                                |
| Error — ระบบ                      | ใช้ ThaiD ไม่ได้ในขณะนี้             | "ระบบ ThaiD ไม่พร้อมใช้งาน กรุณาลองอีกครั้ง หรือเลือกวิธีอื่น" · ปุ่ม [ลองอีกครั้ง] [กลับหน้าเริ่มต้น]                                                                 |
| Error — ถี่เกิน (429)             | ขอ QR บ่อยเกินไป                     | "กรุณารอสักครู่ แล้วลองอีกครั้ง" · ปุ่ม [ลองอีกครั้ง] [กลับหน้าเริ่มต้น]                                                                                               |
| Error — session ใช้ไม่ได้         | ค้นหาไม่สำเร็จ                       | "การยืนยัน ThaiD หมดอายุหรือไม่ถูกต้อง กรุณาสแกนใหม่" · ปุ่ม [สแกนใหม่] [กลับ]                                                                                         |
| ช่องทางถูกปิดระหว่างใช้           | —                                    | ไม่มีข้อความ — กลับหน้า `/kiosk` ทันที (การ์ดหายตาม flag)                                                                                                              |

**หน้ามือถือหลังยืนยัน ThaiD (`/thaid-scan-success?flow=kiosk`)**

| สถานะ     | ข้อความ                                                                       |
| --------- | ----------------------------------------------------------------------------- |
| สำเร็จ    | ยืนยันตัวตนสำเร็จ — "กลับไปที่ตู้เพื่อเลือกสมาชิกและรับบัตรคิว ปิดหน้านี้ได้" |
| หมดเวลา   | ยืนยันตัวตนไม่สำเร็จ — "QR หมดอายุ กรุณาสร้าง QR ใหม่ที่ตู้"                  |
| ThaiD ปิด | ยืนยันตัวตนไม่สำเร็จ — "ระบบยืนยันตัวตน ThaiD ถูกปิดใช้งานชั่วคราว"           |
| อื่น ๆ    | ยืนยันตัวตนไม่สำเร็จ — "การยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"         |

## Impact

- Code/test: ตาม `affects`
- scanner_client: เพิ่ม 3 path ใน allowlist เท่านั้น; ไม่แก้ Chromium policy ของตู้
- Flow `member_scan` เดิมบนหน้า pre-register ต้องทำงานเหมือนเดิม
- Ops: มือถือผู้อพยพต้องมีอินเทอร์เน็ต; production ขึ้นกับการอนุมัติ ThaiD client ของ DOPA (redirect URI เดิม)

## Migration

N/A — additive flag (doc เดิมไม่มี key = `false`); session ไม่ persist

## Decisions (PO เคาะ 2026-10-11, D-7 approve 2026-10-11)

ทุกข้อในตารางนี้ Project Owner เป็นผู้ตัดสิน — ทีม kiosk เป็นผู้เสนอ

| ID  | เรื่อง                   | ผลการตัดสินของ PO                                                                                                   |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| D-1 | QR บนตู้ชี้ไปไหน         | รับตามที่เสนอ — QR พาไปหน้าเว็บ tent บนมือถือ แล้วต่อ ThaiD ด้วย flow เดิมของ pre-register; ตู้ไม่เปิดหน้า DOPA เอง |
| D-2 | Toggle รายศูนย์          | มี flag ต่อศูนย์ `kiosk_thaid_check_in_enabled` ค่าเริ่มต้นปิด                                                      |
| D-3 | Face check สำหรับ ThaiD  | ไม่ตรวจใบหน้า — ใช้การยืนยันตัวตนของ ThaiD                                                                          |
| D-4 | TTL session              | รอมือถือ (pending) 300 วิ · หลังยืนยัน (completed) 180 วิ                                                           |
| D-5 | Rate limit สร้าง session | ไม่เกิน 10 session/นาที/kiosk                                                                                       |
| D-6 | Scope                    | ขอทั้งเลข 13 หลักและชื่อ — ใช้ scope เดียวกับโค้ด ThaiD ของ pre-register เดิม (mode `member_scan`)                  |
| D-7 | Copy การ์ด/หน้า ThaiD    | **PO approve 2026-10-11** — ใช้ข้อความตาม §D-7 ตามที่เขียน (การ์ด ThaiD, หน้า `/kiosk/thaid` ทุกสถานะ, หน้ามือถือหลังยืนยัน) |
| D-8 | ThaiD ยืนยันใคร          | ThaiD ยืนยันเฉพาะคนที่สแกน แล้วคนนั้นเช็กอินให้ทั้งครัวเรือนได้                                                     |

## Decision log

- 2026-10-10 — proposed โดยทีม kiosk (ข้อเสนอ D-1..D-7) · รอ Project Owner เคาะ
- 2026-10-10 — sync กับ code ที่ implement (error code, 404 expired, `expires_in_sec`, release session) + เพิ่มข้อเสนอ D-8 (ยืนยันคนเดียว → รายงานตัวทั้งครัวเรือน) · รอ PO เคาะ
- 2026-10-11 — PO review: เคาะ D-1..D-6 และ D-8 (ตามตาราง Decisions; D-6 เปลี่ยนจากข้อเสนอ `openid pid` เป็น scope เดียวกับ `member_scan`) · D-7 รอ approve ข้อความ
- 2026-10-11 — ตัดการอ้างอิง implementation plan (`docs/plans/kiosk-thaid-check-in-implementation-plan.md`) ออก — ไฟล์ไม่อยู่ใน repo; CR นี้เป็น spec ที่ใช้อ้างอิง
- 2026-10-11 — PO re-review: ยังไม่ approve — FR/AC หายไปพร้อมการตัด plan · เพิ่ม §Requirements / Acceptance (KTD-AC-01..08), §Security และ §D-7 (ข้อความจริงจากโค้ดต้นแบบทุกสถานะ) · รอ PO approve D-7 + re-review
- ขั้นถัดไป (ตาม PO): approve D-7 → ใช้เลข CR ถัดไปจาก `_index.md` บน develop และย้ายไฟล์ไป `docs/changes/14-kiosk/` · PR ที่ทำ CR ตัวจริงต้องอัปเดต `schema.md` (flag), `api-contract.md` (3 endpoint, `source:'thaid'`, mode `kiosk_check_in`) และ FR-KPC-11/F-08 ใน CR-151/152
- 2026-10-11 — **PO approved (net-lynx)** — D-7 approve ตามที่เขียน · ได้เลข CR-163 ย้ายไป `docs/changes/14-kiosk/` · status approved (spec only, ยังไม่ implement) · เงื่อนไขสำหรับ code PR:
  - (a) session single-use ต้องจริงทุก web process (`WEB_CONCURRENCY=3`, broadcast ผ่าน `server/cluster.mjs`) — consume/delete ต้องยืนยันที่ primary หรือทำแบบ atomic, การลบต้องลบสำเนาของ primary ด้วย; ถ้าหลาย server ต้องใช้ shared store · เพิ่ม test check-in ซ้ำพร้อมกัน (concurrent double check-in)
  - (b) เพิ่ม **KTD-AC-09**: เมื่อ `kiosk_thaid_check_in_enabled=false` หรือ `thaid_registration_enabled=false` → การ์ดซ่อน และสร้าง session คืน 403/404
  - (c) mask เลข 13 หลักให้เหลือเปิดเผยไม่เกิน 2 หลักท้าย
  - (d) implementation มาเป็น code PR ใหม่จาก `feat/pre-register_kiosk` รีวิวเทียบกับ CR นี้ — ห้าม merge branch นั้นตรง ๆ · PR นั้นต้องอัปเดต `docs/data/schema.md`, `docs/data/api-contract.md` และ FR-KPC-11/F-08 ใน CR-151/CR-152
- 2026-10-23 — แก้ในที่ (#757, feedback หน้างาน): ThaiD บน Android ล้มด้วย `invalid_state` เมื่อเบราว์เซอร์ที่สแกน QR (เช่น in-app browser ของแอป Google) ไม่ใช่เบราว์เซอร์ default ที่แอป ThaiD เปิด callback — cookie state ไม่ตามไป · เพิ่ม KTD-AC-10 + ข้อ Security (ข้ามการเทียบ cookie เฉพาะ `kiosk_check_in` / `member_scan`) · ข้อเสนอจากทีม kiosk — รอ PO review
- 2026-10-23 — **Superseded (rate limit) by [CR-188](../01-core/CR-188-rate-limit-to-nginx.md):** KTD-AC-07 (10 ครั้ง/นาที/kiosk) ย้ายไป nginx zone `kiosk` ต่อ IP
