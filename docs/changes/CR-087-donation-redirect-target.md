---
id: CR-087
title: donation — เพิ่ม field ปลายทางที่ส่งต่อ (redirect_to_shelter_code) + ticket ฝั่งศูนย์ปลายทาง สำหรับสถานะ redirected (T-16 R-16.4)
status: proposed
date: 2026-08-25
requested_by: Team A (T-16 intake review implementation) / Kunanon Nusaeng
decided_by: <รอเจ้าของโครงการ>
layer: volatile
affects:
  - docs/data/schema.md §2.3 donation
  - docs/data/schema.md (doc type ใหม่ donation_redirect — ดู §Change)
  - schema_v donation 4 → 5
  - frontend/src/lib/features/operations/domain/operations.ts (Donation, DONATION_TRANSITIONS)
  - frontend/src/lib/features/donations/ (PublicDonationDoc, back-office types)
  - frontend/src/routes/api/back-office/donations/[query]/redirect/+server.ts (endpoint ใหม่)
  - frontend/src/lib/components/redirect-donation-dialog.svelte (UI มีอยู่แล้วเป็น stub — รอ endpoint จริง)
---

# CR-087 — donation redirect target + destination-shelter ticket

## Why

`docs/task-breakdown/04-donation.md` §T-16 ("CR-048 Redirect Transfer Ticket" — จริงๆ คือ CR-052
Design V8, ดู B-3 ในบันทึกสถานะ T-16) ต้องการปุ่ม "ส่งต่อ" ในแท็บรอการประเมิน — เมื่อศูนย์ปัจจุบัน
รับของชิ้นนี้ไม่ได้ (เต็ม/ไม่ตรงเงื่อนไข) เจ้าหน้าที่เลือกศูนย์ปลายทางแล้วส่งต่อคำขอไปให้ที่นั่นพิจารณาแทน
โดยไม่สร้าง lot/ledger ที่ศูนย์ต้นทาง

สถานะ `redirected` มีอยู่ใน `donation.status` enum แล้ว (schema.md §2.3, CR-052 อนุมัติไปตั้งแต่ก่อนหน้า)
แต่**ไม่มีที่เก็บว่าส่งไปศูนย์ไหน** — และเพราะสถาปัตยกรรมเป็น per-shelter CouchDB
(`shelter_<code>`) พร้อม shelter-scope isolation (`isInCallerScope` — เจ้าหน้าที่ศูนย์ B มองไม่เห็น DB
ของศูนย์ A เลย) การมี field เฉยๆ บน doc ที่ยังอยู่ใน DB ศูนย์ต้นทางจะทำให้ **เจ้าหน้าที่ศูนย์ปลายทางมองไม่เห็น
คำขอที่ถูกส่งมาหาตัวเองเลย** ต้องมีอะไรบางอย่างเขียนเข้า DB ของศูนย์ปลายทางจริงๆ

ตอนนี้ UI ฝั่ง staff (`redirect-donation-dialog.svelte`) สร้างไว้แล้วและใช้งานได้ (เลือกศูนย์ปลายทาง +
หมายเหตุ) แต่ handler เป็น mock — กด "ยืนยัน" แล้ว toast สำเร็จเฉยๆ ไม่ได้เขียนอะไรเข้า CouchDB —
CR นี้เป็นตัวปลดล็อกให้ต่อปุ่มที่มีอยู่แล้วเข้ากับของจริง

## Change

**แนวทางที่เสนอ (recommended): field เบาบนต้นทาง + doc ใหม่แบบเบาที่ปลายทาง** — ไม่ทำ full copy
ของ donation doc ข้าม DB (จะซ้ำซ้อน PII และเสี่ยง diverge) ไม่ยืมโครง `stock_transfer` (§2.2 นั้นออกแบบ
ไว้สำหรับของที่ "มีในคลังแล้ว" ย้ายไปอีกศูนย์ — เคสนี้ของยังไม่เคยเข้าคลังที่ไหนเลย)

1. **`donation` (schema_v 4 → 5)** — เพิ่ม field เดียว:

   | field | type | req/opt | หมายเหตุ |
   | --- | --- | --- | --- |
   | `redirect_to_shelter_code` | `str \| null` | opt | ตั้งค่าตอน `status → redirected` เท่านั้น; อื่นๆ เป็น `null` |

   ไม่เก็บ "ใครกด/เมื่อไร/เพราะอะไร" บน doc นี้ซ้ำ — ใช้ `audit` doc ที่มีอยู่แล้วบันทึกเหมือนที่ approve/reject
   ทำ (`action: manual_adjust`, `target_type: donation`) เพื่อไม่เพิ่ม field ซ้ำซ้อนกับของที่มีอยู่แล้ว

2. **doc type ใหม่ `donation_redirect:{ulid}`** เขียนเข้า `shelter_<ปลายทาง>` ตอนกดส่งต่อ:

   | field | type | req/opt | หมายเหตุ |
   | --- | --- | --- | --- |
   | `type` | `"donation_redirect"` | req | |
   | `origin_shelter_code` | `str` | req | ศูนย์ต้นทาง |
   | `origin_donation_id` | `str` | req | ชี้กลับไป `donation:{ulid}` ที่ศูนย์ต้นทาง (ข้าม DB — เก็บไว้เผื่อ SA ต้องสอบย้อนกลับ) |
   | `booking_ref` | `str \| null` | opt | โชว์ให้เจ้าหน้าที่ปลายทางอ้างอิงกับ donor ได้ |
   | `donor` | `{name, phone}` | req | เท่าที่จำเป็นให้ปลายทางติดต่อได้ — ไม่ลาก `phone_hash`/`line_id`/`email` ตาม (data minimization) |
   | `items` | เหมือน `donation.items` | req | snapshot ตอนส่งต่อ ไม่ sync กับต้นทางอีก |
   | `note` | `str \| null` | opt | หมายเหตุจากเจ้าหน้าที่ต้นทาง (ช่องที่ dialog มีอยู่แล้ว) |
   | `status` | `enum(pending_review)` | req | ปลายทางเริ่มพิจารณาใหม่ตั้งแต่ `pending_review` เหมือนคำขอปกติ — **ไม่สืบทอด**สถานะเดิม |
   | `created_at` | `ts` | sys | |

   เจ้าหน้าที่ศูนย์ปลายทางเห็น `donation_redirect` แยกจากคิว `donation` ปกติ (หรือจะรวม UI queue เดียวกัน
   เป็นรายละเอียด implementation ไม่ใช่ schema) แล้วพิจารณา approve/reject ตาม flow เดิมของ T-16

3. **`DONATION_TRANSITIONS`** (`operations.ts`) — เพิ่ม `pending_review → redirected` (มีแค่
   `verifying`/`rejected`/`expired`/`cancelled` อยู่ตอนนี้)

4. **Endpoint ใหม่** `POST /api/back-office/donations/[query]/redirect` — รับ
   `{ target_shelter_code, note? }`, guard `canTransitionDonation(status, 'redirected')`, เขียน:
   - `audit` ที่ DB ต้นทาง (เหมือน approve/reject)
   - `donation_redirect` ที่ DB ปลายทาง
   - `PUT` donation ต้นทางเป็น `status: redirected, redirect_to_shelter_code`
   **ห้าม** เขียน `stock_ledger`/lot ใดๆ ที่ต้นทาง (ตรง acceptance ของ R-16.4 เดิม)

## Open questions ให้เจ้าของโครงการเคาะ

- [NEEDS DECISION] ยอมรับแนวทาง "doc ใหม่ที่ปลายทาง" ไหม หรืออยากให้ทำง่ายกว่านี้ (เช่น แค่ field
  บน `donation` แล้วให้ SA เป็นคนมองเห็นข้ามศูนย์แทน ไม่ต้องมี queue ที่ปลายทาง) — ทางเลือกหลังง่ายกว่า
  มากแต่ปลายทางจะไม่เห็นคำขอเอง ต้องรอ SA forward ให้
- [NEEDS DECISION] ถ้าปลายทางก็ปิดรับ item นี้เหมือนกัน (เต็มซ้ำ) จะให้ทำอะไรต่อ — ส่งต่อเป็นทอดๆ ได้
  กี่ครั้ง มีเพดานไหม (ป้องกันวนไม่รู้จบ) — ยังไม่ได้กำหนดไว้ในเอกสารไหนเลย

## Impact

- **Docs**: `schema.md` §2.3 (field ใหม่ + schema_v bump), เพิ่ม doc type ใหม่ (เสนอเป็น §2.14 ถัดจาก
  `donation_slot`), `api-contract.md` (endpoint ใหม่)
- **Code**: `operations.ts` (`Donation`, `DONATION_TRANSITIONS`), endpoint ใหม่
  `[query]/redirect/+server.ts`, wiring `handleRedirectPending` ใน `stock-donations/+page.svelte` ให้
  เรียก endpoint จริงแทน toast mock, list endpoint ใหม่ฝั่งปลายทางสำหรับอ่าน `donation_redirect`
  (คิวใหม่ในหน้าหลังบ้าน หรือรวมกับแท็บรอการประเมินเดิม — ตัดสินใจตอน implement)
- **Test**: unit test transition guard (`pending_review → redirected` ผ่าน, สถานะอื่น block),
  integration test endpoint (audit เขียนถูก DB, `donation_redirect` เขียนถูก DB ปลายทาง, ไม่มี
  `stock_ledger` เพิ่มที่ต้นทาง)

## Migration

ไม่มีข้อมูล `donation` ที่ persist อยู่ตัวไหนมี `status: redirected` มาก่อน (grep แล้วไม่พบ — สถานะนี้ยัง
ไม่เคยถูกเซ็ตจากที่ไหนเลยในโค้ดปัจจุบัน) จึงไม่ต้อง backfill — เพิ่ม field ใหม่เป็น optional ตรงไปตรงมา

## Decision log

- 2026-08-25 — proposed
