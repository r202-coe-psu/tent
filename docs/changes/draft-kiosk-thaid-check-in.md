---
id: draft
title: Kiosk — เปิดช่องทางรายงานตัวด้วย ThaiD (QR บนตู้ → ยืนยันบนมือถือ) + toggle รายศูนย์
status: proposed
date: 2026-10-10
created: 2026-10-10
updated: 2026-10-10
requested_by: ทีม kiosk (branch feat/pre-register_kiosk)
decided_by: Project Owner (รอเคาะ)
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
# Draft CR: Kiosk — รายงานตัวด้วย ThaiD

> **สถานะ:** proposed โดยทีม kiosk · รอ Project Owner เคาะ · implement แล้วบน branch `feat/pre-register_kiosk` (รอ CR อนุมัติก่อน merge)
> แผน implement ฉบับเต็ม (FR-KTD-01..45, AC, work breakdown, tests): [`docs/plans/kiosk-thaid-check-in-implementation-plan.md`](../plans/kiosk-thaid-check-in-implementation-plan.md)

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** การ์ด ThaiD บน `/kiosk` เปลี่ยนจาก ⏸ ปิด → ใช้งานได้; ตู้แสดง QR → ผู้อพยพยืนยันในแอป ThaiD บนมือถือตัวเอง → ตู้ lookup/check-in ต่อเหมือนช่องทางบัตร (`pre_registered → arriving`)
> - **เพื่อใคร / ทำไม:** ผู้ลงทะเบียนล่วงหน้าที่ไม่มีบัตรติดตัว · server เป็นผู้ resolve เลข 13 หลักจาก session ที่ผูกกับตู้ — browser ไม่ส่งเลขบัตร
> - **Dev ต้องทำอะไร:** session `kind=kiosk_check_in` ใน store เดิม · endpoint device-auth 3 ตัว · OAuth mode `kiosk_check_in` · `source:'thaid'` ใน lookup/check-in · allowlist scanner_client · หน้า `/kiosk/thaid` · Switch ในฟอร์มศูนย์
> - **กระทบ schema / scope:** `feature_flags.kiosk_thaid_check_in_enabled` (additive, ไม่ bump `schema_v`) · enum `source` ของ kiosk gate เพิ่ม `thaid` · walk-in ด้วย ThaiD ยังอยู่นอก scope (CR-149)

## Why

ดู frontmatter `why` และ plan §10.

## Change

| เรื่อง                         | ก่อน                                                                       | หลัง                                                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| การ์ด ThaiD ที่`/kiosk`    | `enabled:false` "ยังไม่เปิดใช้งาน" (CR-151 F-08 ⏸)          | ใช้งานได้ →`/kiosk/thaid`; แสดงเมื่อ flag ศูนย์ + ThaiD ระดับระบบเปิด (fail closed)                                                                                                                 |
| `shelter.feature_flags`            | ไม่มี key ThaiD                                                           | +`kiosk_thaid_check_in_enabled: bool` default `false`                                                                                                                                                                                  |
| `/kiosk/config` response           | `{shelter_code, phone_check_in_enabled, walk_in_registration_enabled}`       | +`thaid_check_in_enabled`                                                                                                                                                                                                                |
| Kiosk gate`source`                 | `smart-card` · `qr` · `phone`                                          | +`thaid` (`{source:'thaid', session_id}` — ไม่รับเลข 13 หลักจาก browser)                                                                                                                                              |
| Check-in`source`                   | `smart-card` · `qr` · `phone`                                          | +`thaid` + `thaid_session_id` (ต้องตรง pid ของ primary; session single-use; เขียนล้ม → คืน session ให้ลองใหม่)                                                                                         |
| ขอบเขตการยืนยัน ThaiD | —                                                                             | ยืนยันคนเดียว (คนที่สแกน) → รายงานตัวแทนทั้งครัวเรือน; แนบ session เฉพาะ batch ที่มีคนสแกน, batch อื่นตรวจแบบช่องทาง QR / บัตร / เบอร์ (D-8) |
| Session status response              | —                                                                             | 200`{status, expires_at, expires_in_sec}` · 404 `{status:'expired'}`; 429 = `KIOSK_RATE_LIMITED`                                                                                                                                    |
| ThaiD OAuth mode                     | `link` · `stepup` · `login` · `register` · `member_scan`         | +`kiosk_check_in` (scope `openid pid`, callback เดิม)                                                                                                                                                                              |
| Scan session                         | `member_scan` อย่างเดียว, อ่าน profile ผ่าน public GET/SSE | +`kind=kiosk_check_in` ผูก `device_id`+`shelter_code`; public GET/SSE ตอบ 404 สำหรับ kind นี้                                                                                                                         |
| Endpoint ใหม่ (device-auth)      | —                                                                             | `POST /api/v1/scanner/kiosk/thaid/session`, `/status`, `/cancel`                                                                                                                                                                     |
| Face check / staff PIN               | ใช้กับช่องทางบัตร                                             | ช่องทาง ThaiD ไม่ใช้                                                                                                                                                                                                          |
| ไม่พบข้อมูลด้วย ThaiD | —                                                                             | `not_found` + `can_register:false`                                                                                                                                                                                                     |

Requirements ละเอียด: plan §4 (FR-KTD-01..45, 15a, 27a–27c) · Acceptance: plan §5 (AC-01..09)

## Impact

- Code/test: ตาม `affects` และ plan §7
- scanner_client: เพิ่ม 3 path ใน allowlist เท่านั้น; ไม่แก้ Chromium policy ของตู้
- Flow `member_scan` เดิมบนหน้า pre-register ต้องทำงานเหมือนเดิม (AC-08)
- Ops: มือถือผู้อพยพต้องมีอินเทอร์เน็ต; production ขึ้นกับการอนุมัติ ThaiD client ของ DOPA (redirect URI เดิม)

## Migration

N/A — additive flag (doc เดิมไม่มี key = `false`); session ไม่ persist

## ข้อเสนอของทีม (รอ PO เคาะ)

| ID  | เรื่อง                   | ข้อเสนอของทีม                                                                                                                                                                                                                                                         |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | QR บนตู้ชี้ไปไหน  | start URL ของระบบ (pattern`member_scan`) — ไม่ให้ตู้เปิดหน้า DOPA เอง                                                                                                                                                                                |
| D-2 | Toggle รายศูนย์        | มี`kiosk_thaid_check_in_enabled` default `false` (pattern CR-152)                                                                                                                                                                                                            |
| D-3 | Face check สำหรับ ThaiD  | ข้าม — แอป ThaiD ยืนยันตัวด้วยกลไกของ DOPA แล้ว                                                                                                                                                                                                    |
| D-4 | TTL session                    | pending 300 วิ · completed 180 วิ                                                                                                                                                                                                                                             |
| D-5 | Rate limit สร้าง session  | 10 ครั้ง/นาที/device                                                                                                                                                                                                                                                      |
| D-6 | Scope                          | `openid pid`; ถ้า sandbox ไม่คืน `pid` → `pid name openid`                                                                                                                                                                                                         |
| D-7 | Copy การ์ด/หน้า ThaiD | ตาม plan FR-KTD-32/35/42 (ร่าง)                                                                                                                                                                                                                                             |
| D-8 | ThaiD ยืนยันใคร       | คนเดียว (คนที่สแกน) แล้วรายงานตัวทั้งครัวเรือนได้; batch ที่ไม่มีคนสแกน / ลองใหม่หลังใช้ session แล้ว ใช้ device trust เหมือนช่องทาง QR / บัตร / เบอร์ (plan FR-KTD-27b/27c) |

## Decision log

- 2026-10-10 — proposed โดยทีม kiosk (D-1, D-2, D-3 ทีมเลือกตามข้อเสนอ; D-4..D-7 ยังเป็นค่าร่าง) · รอ Project Owner เคาะ
- 2026-10-10 — sync กับ code ที่ implement (error code, 404 expired, `expires_in_sec`, release session) + เพิ่ม D-8 (ยืนยันคนเดียว → รายงานตัวทั้งครัวเรือน) — proposed โดยทีม · รอ PO เคาะ
