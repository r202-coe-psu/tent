---
id: CR-172
title: "เหตุผลปฏิเสธบนใบบริจาค + ไม่รับรายบรรทัดตอนตรวจรับ (แสดงบนหน้าติดตาม)"
status: approved
date: 2026-10-17
updated: 2026-10-22
approved_at: 2026-10-18
requested_by: "Kan"
decided_by: "Soravit Sukkarn (Team Lead)"
layer: volatile
affects:
  - docs/data/schema.md §2.3 `donation` — field ใหม่ `reject_reason`, `reject_reason_code`; เขียน `received_summary` ลง spec ครั้งแรก + `items[].rejected`, `items[].reject_reason`, `items[].reject_reason_code`
  - schema_v donation 5 → 6
  - docs/data/couchdb-mongodb-sync.md §3.2 (`public_donations`)
  - docs/data/api-contract.md — response ของ `GET /public/v1/donations/{tracking_token}`
  - docs/features/public-tier-donation-spec.html — field ที่เปิดให้ประชาชนเห็น
  - docs/changes/03-C-supply/CR-143-stock-redesign-rules.md FR-B3/B5/B6 และ CR-156 §I — แยก "ไม่รับ" ออกจาก "ขาด"
  - frontend/src/lib/features/donations/domain/public-donation.ts (`receiveDonationInputSchema`)
  - frontend/src/lib/features/operations/domain/operations.ts (`Donation`, `DONATION_TRANSITIONS`)
  - frontend/src/routes/api/back-office/donations/[query]/+server.ts (รับของ) และ [query]/reject/+server.ts
  - worker/src/worker/projectors/donation.py · packages/tent-model/src/tent_model/public_donation.py
  - backend/apiapp/modules/donations (tracking response)
  - frontend/src/routes/(public)/donations/track/[token]/+page.svelte · lib/features/donations/domain/tracking.ts
why: เหตุผลที่เจ้าหน้าที่ปฏิเสธอยู่ใน audit อย่างเดียว ผู้บริจาคไม่รู้ว่าทำไมของไม่ถูกรับ และตอนตรวจรับไม่รับบางรายการไม่ได้
migration: field ใหม่ทั้งหมด optional — doc เดิมไม่ต้อง backfill
---

# เหตุผลปฏิเสธบนใบบริจาค + ไม่รับรายบรรทัดตอนตรวจรับ

## สรุป

- **เปลี่ยน:** เก็บเหตุผลปฏิเสธบน donation doc (เดิมอยู่ใน `audit` อย่างเดียว) และให้ตรวจรับแบบ "ไม่รับบางบรรทัด" ได้
- **เพื่อ:** ผู้บริจาครู้เหตุผลบนหน้าติดตาม · เจ้าหน้าที่รับของที่ใช้ได้เข้าคลังและปฏิเสธส่วนที่เหลือในใบเดียว
- **dev ต้อง build:** field ใหม่ + route รับของ/ปฏิเสธ + sync ไป `public_donations` + modal ปฏิเสธ + สวิตช์ "ไม่รับรายการนี้" + กล่องเหตุผลบนหน้าติดตาม
- **กระทบ:** `donation` schema_v 5 → 6 (optional ทั้งหมด) · projection `public_donations` (bump `PROJECTION_VERSION`)

## Requirements

### ข้อมูล
- **FR-1** — `donation` เพิ่ม `reject_reason: str|null` (≤ 500 ตัวอักษร) เขียนเมื่อ `status → rejected` เท่านั้น
- **FR-2** — `donation` เพิ่ม `reject_reason_code: enum|null` ค่า: `not_needed`, `expired`, `damaged`, `other` (label ภาษาไทยของ `not_needed` สื่อถึง "ไม่ตรงเกณฑ์การรับ / เกินความต้องการ")
- **FR-3** — `received_summary.items[]` เพิ่ม `rejected: bool?`, `reject_reason_code: enum?` (FR-2), และ `reject_reason: str?` (≤ 500) ต่อบรรทัด
- **FR-4** — `schema.md` §2.3 ต้องระบุรูปของ `received_summary` ทั้งก้อน (ตอนนี้โค้ดเขียนอยู่แล้วแต่ spec ไม่มี): `{total_items, received_at, remarks?, shortfalls?[], items?[]}`

### ปฏิเสธทั้งใบ
- **FR-5** — ปฏิเสธได้จากสถานะ `pending_review` และ `verifying` (ตาม `DONATION_TRANSITIONS` เดิม)
- **FR-6** — การปฏิเสธต้องผ่าน modal ที่มีเหตุผลสำเร็จรูป (FR-2) + ช่องรายละเอียด ช่องรายละเอียดบังคับเมื่อเลือก `other`
- **FR-7** — modal แสดง preview ข้อความที่ผู้บริจาคจะเห็น และคำเตือนห้ามใส่ข้อมูลส่วนตัว
- **FR-8** — route ปฏิเสธเขียน `reject_reason` + `reject_reason_code` ลง doc และเขียน `audit` (ใครกด/เมื่อไร/เหตุผล) เหมือนเดิม

### ไม่รับรายบรรทัดตอนตรวจรับ
- **FR-9** — ฟอร์มตรวจรับต้องมีสวิตช์ "ไม่รับรายการนี้" ต่อบรรทัด (เป็นการปฏิเสธทั้งบรรทัด All-or-Nothing ไม่รองรับ split qty) เปิดแล้วต้องเลือกเหตุผล (FR-2) และซ่อนช่องจำนวน/ที่เก็บ
- **FR-10** — บรรทัดที่ไม่รับ: ไม่สร้างแถว `stock_ledger` ไม่มี lot และลงใน `received_summary.items[]` พร้อม `rejected: true` + `reject_reason` + `reject_reason_code`
- **FR-11** — รับอย่างน้อย 1 บรรทัด → `status: received` (ไม่เพิ่มสถานะใหม่ ตาม CR-143 §B)
- **FR-12** — ไม่รับทุกบรรทัด → `status: rejected` · `reject_reason` = รวมเหตุผลของทุกบรรทัด (คั่นด้วย `; ` และ truncate ไม่เกิน 500 ตัวอักษร) · `reject_reason_code` = ค่านั้นหากทุกบรรทัดตรงกัน หรือ `other` หากคละเหตุผล · `received_summary.items[]` เก็บเหตุผลรายบรรทัด · ไม่มีแถว ledger
- **FR-13** — "ไม่รับ" ≠ "ขาด": บรรทัดที่ `rejected: true` ไม่นับใน `shortfalls` (ทั้งฝั่ง backend คำนวณ shortfalls และ client fallback ในหน้าติดตาม)

### หน้าติดตามสถานะ (ประชาชน)
- **FR-14** — `public_donations` และ response ติดตามต้องส่ง `reject_reason` และ `received_summary.items[].rejected/reject_reason/reject_reason_code`
- **FR-15** — สถานะ `rejected`: แสดงกล่อง "เหตุผลจากศูนย์พักพิง" ใต้ป้ายสถานะ
- **FR-16** — สถานะ `received`: บรรทัดที่ไม่รับแสดงป้าย "ไม่รับ" พร้อมเหตุผล แยกจากป้าย "รับไม่ครบ" (decision sync 2026-10-22: หน้าติดตามไม่มีป้าย "รับไม่ครบ" แล้ว — ยกเลิก [CR-156](../03-C-supply/CR-156-stock-redesign-amendment.md) FR-I3 — ป้าย "ไม่รับ" ใช้ตามเดิม)
- **FR-17** — doc ที่ไม่มี field ใหม่ (สร้างก่อน schema_v 6) แสดงผลได้ตามเดิมโดยไม่มีกล่องเหตุผล

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| เหตุผลปฏิเสธ | `audit.reason` อย่างเดียว (`[query]/reject/+server.ts:19-24`, `:73-82`) | `donation.reject_reason` + `reject_reason_code` และยังมีใน audit |
| ตรวจรับ | ทุกบรรทัดต้อง qty > 0 (`public-donation.ts:95`) | บรรทัดที่ไม่รับมี `rejected: true` และ qty 0 ได้ |
| ไม่รับทุกบรรทัด | ทำไม่ได้ ต้องกดปฏิเสธทั้งใบแยก | `status: rejected` อัตโนมัติพร้อมเหตุผลทุกบรรทัด |
| `received_summary` ใน spec | ไม่มีใน `schema.md` (มีแค่ `couchdb-mongodb-sync.md` §3.2) | ระบุรูปเต็มใน `schema.md` §2.3 |
| ฟอร์มปฏิเสธ | inline 2 ชุด (`pending-review-detail.svelte`, `scan-station.svelte`) | modal เดียว `RejectDonationDialog` |
| หน้าติดตาม | ป้าย "ไม่รับรายการนี้" ไม่มีเหตุผล | กล่องเหตุผล + ป้าย "ไม่รับ" รายบรรทัด |

## Acceptance

- **AC-1** — ปฏิเสธใบ `pending_review` ผ่าน modal → หน้าติดตามแสดงเหตุผลที่เลือก + รายละเอียด
- **AC-2** — ตรวจรับใบ 2 บรรทัด รับ 1 ไม่รับ 1 → `status: received` · ledger 1 แถว · หน้าติดตามแสดงป้าย "ไม่รับ" พร้อมเหตุผลที่บรรทัดนั้น
- **AC-3** — ตรวจรับแล้วไม่รับทุกบรรทัด → `status: rejected` · ไม่มีแถว ledger · หน้าติดตามแสดงเหตุผลทุกรายการ
- **AC-4** — เลือกเหตุผล `other` โดยไม่กรอกรายละเอียด → ยืนยันไม่ได้ (422 จาก API ด้วย)
- **AC-5** — doc schema_v 5 ที่ `rejected` อยู่แล้วเปิดหน้าติดตามได้ ไม่มี error
- **AC-6** — บรรทัดที่ไม่รับไม่ปรากฏใน `shortfalls`

## Impact

- **frontend:** schema รับของ/ปฏิเสธ · `Donation` type · route รับของและปฏิเสธ · `RejectDonationDialog` (ใหม่, `features/donations/ui`) แทนฟอร์ม inline 2 ชุด · สวิตช์ไม่รับใน `ReceiveLineEditor` · BFF overlay whitelist (`api/public/v1/donations/[tracking_token]/+server.ts:107-120`) · `toDonationTrackView` · หน้าติดตาม
- **worker:** projector `donation.py` ส่ง field ใหม่ · bump `PROJECTION_VERSION`
- **tent-model / backend:** `PublicDonation` + tracking response · `pnpm openapi:update`
- **quota:** ไม่มีผล — `received` ไม่ถือโควต้าค้างหลังลง ledger แล้ว และ `rejected` ปล่อยโควต้าตามเดิม
- **test:** `reject.test.ts` (เคส "keeps the reason on the audit entry" ต้องเช็คทั้ง doc และ audit) · `donations_admin.test.ts` · `tracking.test.ts` · worker projector · backend tracking · e2e `donation-fullstack.test.ts` (reject จาก pending และจากหน้าสแกน + เคสรับบางบรรทัด) — assertion เดิม `getByText('ปฏิเสธ')` ไป match ชื่อผู้บริจาค ต้องแก้ให้เช็คข้อความเหตุผล

## Migration

- **schema_v 5 → 6:** field ใหม่ทั้งหมด optional → doc เดิมไม่ต้อง backfill; reader ถือว่าไม่มี `reject_reason` = ไม่มีเหตุผลให้แสดง
- donation ใหม่ทุกใบเขียนเป็น schema_v 6 ทั้งสอง channel
- `public_donations`: bump `PROJECTION_VERSION` เพื่อ re-project ใบเดิม (ใบเดิมไม่มี field ใหม่ ผลคือรูปเท่าเดิม)
- **ลำดับเลข schema_v:** draft `draft-donation-campaign-auto-approve` และ `draft-donation-donor-photos` เพิ่ม field บน `donation` เช่นกัน CR ที่อนุมัติก่อนได้เลข 6 ตัวถัดไปเลื่อนตาม หรือรวมเป็น bump เดียวถ้าออก release พร้อมกัน

## Why

- เจ้าหน้าที่ปฏิเสธได้ แต่ผู้บริจาคเห็นแค่ "ไม่รับรายการนี้" ไม่รู้เหตุผล จึงไม่รู้ว่าครั้งหน้าควรบริจาคอะไร
- ตอนตรวจรับมีกรณีที่ของบางรายการใช้ไม่ได้ (หมดอายุ ชำรุด) แต่รายการอื่นใช้ได้ ระบบบังคับรับทุกบรรทัด จึงต้องปฏิเสธทั้งใบหรือรับของที่ใช้ไม่ได้เข้าคลัง
- ช่องเหตุผลมีช่องเดียวและแสดงให้ผู้บริจาคเห็น (ไม่แยกบันทึกภายใน) ตามการตัดสินใจของเจ้าของโครงการ 2026-10-17 จึงต้องมีเหตุผลสำเร็จรูปและ preview เพื่อลดโอกาสข้อมูลส่วนตัวหลุดไปหน้าสาธารณะ

## Decision log

- 2026-10-17 — proposed (track ด้วย CR file แยก branch ตามที่เจ้าของโครงการกำหนด)
- 2026-10-18 — approved by Soravit Sukkarn (Team Lead) — requested by Kan (รันเลข CR-172 ย้ายเข้าหมวด 04-donation)
- 2026-10-21 — implement ใน branch `feat/donation-review-intake-flow` — donation schema_v 6 (worker inbound + walk-in), projector `public_donations` ส่ง `reject_reason`/`reject_reason_code` (PROJECTION_VERSION 6 → 7 — 6 ถูกใช้โดย CR-185 ใน develop แล้ว), `PublicDonation` + tracking response ของ FastAPI (OpenAPI ไม่เปลี่ยน — `donation` เป็น `dict`), อัปเดต schema.md §2.3 / couchdb-mongodb-sync.md §3.2 / api-contract.md §5 / public-tier-donation-spec.html และหมายเหตุใน CR-143 §B, CR-156 §I
