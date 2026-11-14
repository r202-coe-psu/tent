---
id: CR-255
title: "แยกเหตุผลปฏิเสธบริจาค not_needed → not_eligible (ไม่ตรงเกณฑ์การรับ) / over_need (เกินความต้องการ)"
status: approved
date: 2026-11-12
updated: 2026-11-14
requested_by: "feedback อบรมระบบ 03/11/2026 (GitHub #1166)"
decided_by: Soravit Sukkarn (Team Lead)
decision_date: 2026-11-14
layer: volatile
affects:
  - docs/data/schema.md §2.3 `donation` — enum `reject_reason_code`, `items[].review_reason_code`, `received_summary.items[].reject_reason_code`
  - schema_v donation — ไม่ bump (เพิ่มค่า enum แบบ additive)
  - docs/data/couchdb-mongodb-sync.md §3.2 (`public_donations.reject_reason_code`)
  - docs/data/api-contract.md — `GET /public/v1/donations/{tracking_token}` (`reject_reason_code`, `review_reason_code`)
  - docs/changes/04-donation/CR-172-donation-reject-reason.md FR-2 และ docs/changes/04-donation/CR-174-donation-campaign-auto-approve.md FR-1 (ชุดค่า enum)
  - frontend/src/lib/features/donations/domain/reject-reason.ts
  - frontend/src/lib/features/donations/domain/item-review.ts
  - frontend/src/lib/features/donations/domain/public-donation.ts (คงชุดเต็ม — FR-6)
  - frontend/src/lib/features/donations/ui/reject-reason-fields.svelte
  - frontend/src/routes/api/back-office/donations/[query]/reject/ และ [query]/approve/ (test)
  - worker/src/worker/donation_close.py · packages/donation-close-fixtures/cases.json
  - packages/tent-model/src/tent_model/public_donation.py (comment)
why: >
  เหตุผล "ไม่ตรงเกณฑ์การรับ / เกินความต้องการ" (`not_needed`) รวมสองความหมาย ผู้บริจาคและเจ้าหน้าที่แยกไม่ออกว่า
  ของผิดประเภทหรือแค่ศูนย์มีพอแล้ว
migration: >
  ไม่ bump `schema_v` และไม่ backfill — doc เดิมคง `not_needed` และข้อความเหตุผลเดิม ระบบยังอ่านและแสดงได้
---

# CR-255 — แยกเหตุผลปฏิเสธบริจาค: ไม่ตรงเกณฑ์การรับ / เกินความต้องการ

> **สรุป (TL;DR):**
>
> - **เปลี่ยน:** เพิ่ม code `not_eligible` ("ไม่ตรงเกณฑ์การรับ") และ `over_need` ("เกินความต้องการ") แทน `not_needed` ในฟอร์มปฏิเสธทุกจุด · `not_needed` เป็น legacy อ่านได้อย่างเดียว
> - **เพื่อ:** ผู้บริจาครู้ว่าของผิดเกณฑ์หรือศูนย์มีพอแล้ว · เจ้าหน้าที่เลือกเหตุผลได้ตรง (feedback อบรม 03/11/2026)
> - **dev ต้อง build:** enum + label ใหม่, ตัวเลือกในฟอร์มปฏิเสธ 3 จุด, validation ฝั่ง input, label ฝั่ง worker close
> - **กระทบ:** enum ของ CR-172 FR-2 / CR-174 FR-1 · ไม่ bump `schema_v` · ไม่ bump `PROJECTION_VERSION` · ไม่ต้อง regen OpenAPI

## Why

`not_needed` (CR-172 FR-2) ใช้ label "ไม่ตรงเกณฑ์การรับ / เกินความต้องการ" ซึ่งรวมสองกรณีที่ผู้บริจาคต้องตอบสนองต่างกัน
(เปลี่ยนประเภทของ vs. รอรอบหน้า). ที่มา: GitHub #1166, feedback อบรมระบบ 2026-11-03

## Change

| | ค่า |
| --- | --- |
| before | `reject_reason_code` / `items[].review_reason_code` / `received_summary.items[].reject_reason_code` = `not_needed \| expired \| damaged \| other` |
| after — ค่าที่ doc มีได้ | `not_eligible \| over_need \| expired \| damaged \| other \| not_needed` (legacy) |
| after — ค่าที่ input ใหม่รับ | `not_eligible \| over_need \| expired \| damaged \| other` |

| code | label |
| --- | --- |
| `not_eligible` | ไม่ตรงเกณฑ์การรับ |
| `over_need` | เกินความต้องการ |
| `expired` | หมดอายุ (เดิม) |
| `damaged` | ชำรุดเสียหาย (เดิม) |
| `other` | อื่นๆ (เดิม) |
| `not_needed` | ไม่ตรงเกณฑ์การรับ / เกินความต้องการ (legacy — ไม่แสดงเป็นตัวเลือก) |

### Requirements

- **FR-1** — เพิ่มค่า enum `not_eligible` label "ไม่ตรงเกณฑ์การรับ"
- **FR-2** — เพิ่มค่า enum `over_need` label "เกินความต้องการ"
- **FR-3** — `not_needed` คงอยู่ใน enum ที่อ่านได้ และคง label "ไม่ตรงเกณฑ์การรับ / เกินความต้องการ"
- **FR-4** — ฟอร์มเหตุผลปฏิเสธ (ปฏิเสธทั้งใบ, ประเมินรายบรรทัด, ไม่รับรายบรรทัดตอนตรวจรับ) แสดงตัวเลือก 5 ค่า: `not_eligible`, `over_need`, `expired`, `damaged`, `other` — ไม่แสดง `not_needed`
- **FR-5** — `POST /api/back-office/donations/[query]/reject` และ `POST /api/back-office/donations/[query]/approve` (`lines[].reason_code`) ต้องตอบ 422 เมื่อส่ง `not_needed`
- **FR-6** — การรับของ (`POST /api/back-office/donations/[query]`) ต้องยังรับรายการที่ถูกปฏิเสธตอนประเมินด้วย `not_needed` ได้ และคงเหตุผล/code เดิมลง `received_summary.items[]`
- **FR-7** — ข้อความที่ผู้บริจาคเห็นของ code ใหม่ประกอบตามกติกา CR-172 เดิม: `<label>` หรือ `<label> — <รายละเอียด>`
- **FR-8** — รวมเหตุผลรายบรรทัด (CR-172 FR-12) ใช้กติกาเดิม: code ต่างกัน (รวม `not_needed` กับค่าใหม่) → `other`
- **FR-9** — worker ที่ปิดใบอัตโนมัติ (`worker/src/worker/donation_close.py`) ใช้ label ชุดเดียวกับ frontend เมื่อรายการไม่มี `review_reason`

## Acceptance Criteria

- **AC-1** — ปฏิเสธทั้งใบด้วย "เกินความต้องการ" → doc มี `reject_reason_code: over_need`, `reject_reason: "เกินความต้องการ"` และหน้าติดตามแสดงข้อความนี้
- **AC-2** — ฟอร์มปฏิเสธทั้ง 3 จุดไม่มีตัวเลือก "ไม่ตรงเกณฑ์การรับ / เกินความต้องการ"
- **AC-3** — ส่ง `reason_code: not_needed` ไป route reject/approve → 422 และ doc ไม่เปลี่ยน
- **AC-4** — ใบเก่าที่มีรายการ `review_reason_code: not_needed` รับของที่ scan station ได้ และ `received_summary.items[]` คง `not_needed` + ข้อความเดิม
- **AC-5** — ประเมินไม่รับทุกบรรทัด โดยบรรทัดหนึ่ง `not_eligible` อีกบรรทัด `over_need` → ใบ `rejected`, `reject_reason_code: other`, `reject_reason` = "ไม่ตรงเกณฑ์การรับ; เกินความต้องการ"
- **AC-6** — fixture `packages/donation-close-fixtures/cases.json` ผ่านทั้ง vitest (`point-receipts.test.ts`) และ pytest (`worker/tests/test_donation_close.py`) รวม case code ใหม่ที่ไม่มี `review_reason`
- **AC-7** — หน้าติดตามของใบเก่าที่ปฏิเสธด้วย `not_needed` แสดงข้อความเดิมไม่เปลี่ยน

## Impact

- `frontend/src/lib/features/donations/domain/reject-reason.ts` — enum ชุดอ่าน (`DONATION_REJECT_REASON_CODES`) + ชุดเลือกได้ (ใหม่), labels, `rejectDonationInputSchema` ใช้ชุดเลือกได้
- `frontend/src/lib/features/donations/domain/item-review.ts` — `lineReviewDecisionSchema.reason_code` ใช้ชุดเลือกได้
- `frontend/src/lib/features/donations/domain/public-donation.ts` — `receiveDonationInputSchema.items[].reject_reason_code` คงชุดเต็ม (FR-6)
- `frontend/src/lib/features/donations/ui/reject-reason-fields.svelte` — ตัวเลือก radio ใช้ชุดเลือกได้
- `frontend/src/routes/api/back-office/donations/[query]/reject/reject.test.ts`, `[query]/approve/approve.test.ts`, `[query]/donations_admin.test.ts` — test FR-5, FR-6
- `worker/src/worker/donation_close.py` — `_REJECT_REASON_LABELS` เพิ่ม 2 code
- `packages/donation-close-fixtures/cases.json` — case ใหม่ (code ใหม่ไม่มี `review_reason`)
- `packages/tent-model/src/tent_model/public_donation.py` — comment รายการ code
- `docs/data/schema.md` §2.3, `docs/data/couchdb-mongodb-sync.md` §3.2, `docs/data/api-contract.md` — ชุดค่า enum
- ไม่กระทบ: backend FastAPI (field เป็น `str`), `frontend/src/lib/api/openapi.d.ts`, worker projector / `PROJECTION_VERSION`, CouchDB VDU (`frontend/src/lib/server/shelter-access-design.ts` ไม่มี whitelist ของ code ชุดนี้), หน้าติดตาม (แสดง `reject_reason` ที่เก็บไว้แล้ว)

## Migration

N/A — ไม่ bump `schema_v` (เพิ่มค่า enum แบบ additive) · ไม่ backfill: doc ที่มี `not_needed` คงค่าและข้อความเดิม และระบบยังอ่าน/แสดงได้ (FR-3, FR-6)

## Decision log

- 2026-11-12 — proposed (GitHub #1166). Owner เคาะค่าตั้งต้น: เพิ่ม code ใหม่ 2 ตัว, คง `not_needed` แบบอ่านอย่างเดียว, ไม่ bump `schema_v`, ใช้ label ตามตาราง Change
- 2026-11-12 — ทางเลือกที่ตัด: rename `not_needed` → ค่าใหม่ค่าเดียว + backfill (เดาความหมายเดิมของ doc เก่าไม่ได้)
- 2026-11-12 — ช่องว่างที่รู้และยอมรับไว้ก่อน: route รับของ (`POST /api/back-office/donations/[query]`) ยังรับ `not_needed` บนรายการที่ไม่รับที่เคาน์เตอร์ ถ้ามีการยิง request เอง (UI ไม่เสนอตัวเลือกนี้) — ไม่ใช่ requirement ของ CR นี้
- 2026-11-12 — preset ข้อความเหตุผล (GitHub #1256) ทำต่อหลัง CR นี้ merge และไม่มี CR แยก
- 2026-11-14 — approved โดย Soravit Sukkarn (Team Lead) หลัง review PR #1376 · รันเลข CR-255 · ข้อที่ reviewer ยกและ owner รับตามที่ร่างไว้: (a) route รับของ (`POST /api/back-office/donations/[query]`) คงชุด code เต็มตาม FR-6 / Impact ("คงชุดเต็ม") · (b) ช่องว่าง `not_needed` ที่ยิง request เองได้ที่ route รับของ — ยอมรับ · (c) รายการ Impact ที่ยังไม่ครบ (`reject-reason.test.ts`, `item-review.test.ts`, `test_donation_close.py`, `point-receipts.test.ts`) และการจัดการ CR-172 FR-2 / CR-174 FR-1 — ยอมรับตามที่ร่างไว้
