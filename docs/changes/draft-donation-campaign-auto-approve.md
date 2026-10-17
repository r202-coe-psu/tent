---
id: draft
title: "ประเมินใบบริจาครายบรรทัด — บรรทัดที่อยู่ในแคมเปญข้ามการประเมิน (ใบที่ทุกบรรทัดอยู่ในแคมเปญได้ QR ทันที)"
status: proposed
date: 2026-10-17
requested_by: "เจ้าของโครงการ — issue #610 (ข้อกำหนดในคำอธิบาย issue)"
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/changes/04-donation/CR-052-donation-system-design-v8.md §1.4 (บังคับประเมินทุกรายการ), flowchart B1, §2.6 (QR เมื่ออนุมัติ)
  - docs/task-breakdown/04-donation.md T-16 (ข้อ "CR-052 (Task #52)" และ "CR-052 Cold-chain")
  - docs/data/schema.md §2.3 `donation` — field ระดับบรรทัด `items[].review_status`, `items[].review_reason`; เส้นทางสถานะ
  - schema_v donation 5 → 6 (หรือเลขถัดไปถ้า draft-donation-reject-reason อนุมัติก่อน)
  - docs/features/public-tier-donation-spec.html — สถานะที่ผู้บริจาคเห็น
  - docs/data/api-contract.md — response ของ `POST /public/v1/donations` (`status`), เส้นทาง donor edit
  - backend/apiapp/modules/donations (use_case: create, update_items) · packages/tent-model (DonationBuffer)
  - worker/src/worker/inbound/donations.py (copy field ใหม่)
  - frontend/src/lib/features/operations/domain/operations.ts (type, `DONATION_TRANSITIONS`)
  - frontend/src/lib/components/pending-review-detail.svelte · routes/api/back-office/donations/[query]/approve (+ reject)
  - frontend/src/lib/components/public-donor-success-ticket.svelte · lib/features/donations/domain/tracking.ts
why: ของที่ศูนย์ประกาศขอในแคมเปญไม่ต้องรอเจ้าหน้าที่ประเมิน คิว "รอการประเมิน" จะเหลือเฉพาะของนอกรายการ
migration: field ใหม่ optional — doc เดิมไม่ต้อง backfill (ไม่มี `review_status` = ใช้สถานะระดับใบตามเดิม)
---

# ประเมินใบบริจาครายบรรทัด — บรรทัดในแคมเปญข้ามการประเมิน

## สรุป

- **เปลี่ยน:** การประเมินย้ายจากระดับใบเป็น**ระดับบรรทัด** บรรทัดที่เป็นของในแคมเปญถือว่าอนุมัติแล้วตั้งแต่จอง ส่วนบรรทัดพิมพ์เอง/นอกรายการยังต้องประเมิน · ใบที่ทุกบรรทัดอยู่ในแคมเปญเริ่มที่ `verifying` และได้ QR ทันที · กลับกฎ CR-052 §1.4
- **เพื่อ:** ลดงานในคิว "รอการประเมิน" ที่ล้นโดยไม่จำเป็น
- **dev ต้อง build:** `items[].review_status` + คำนวณสถานะใบจากบรรทัด (ตอนสร้างและตอนผู้บริจาคแก้) · หน้าประเมินแสดงเฉพาะบรรทัดที่ต้องประเมิน · ตั๋ว/หน้าติดตามแสดงสถานะใหม่
- **กระทบ:** `donation` schema_v +1 · CR-052 §1.4 · quota/slot ไม่เปลี่ยน

## Requirements

### สถานะรายบรรทัด
- **FR-1** — `donation.items[]` เพิ่ม `review_status: enum('approved','pending','rejected')` และ `review_reason: str|null` (≤ 500, เขียนเมื่อ `rejected`)
- **FR-2** — ตอนสร้าง บรรทัดที่มี `item_id` อยู่ในแคมเปญที่เปิดอยู่ของใบนั้น และจองโควต้าได้ → `approved` · บรรทัดอื่น (free text, ไม่มีแคมเปญ, counter `NOT_SEEDED`) → `pending`
- **FR-3** — ฝั่ง client กำหนด `review_status` เองไม่ได้ (FastAPI คำนวณหลังจองโควต้า)

### สถานะระดับใบ (derived จากบรรทัด)
- **FR-4** — มีบรรทัด `pending` อย่างน้อย 1 → ใบเป็น `pending_review`
- **FR-5** — ไม่มีบรรทัด `pending` และมี `approved` อย่างน้อย 1 → ใบเป็น `verifying`
- **FR-6** — ทุกบรรทัด `rejected` → ใบเป็น `rejected`
- **FR-7** — ใบที่ทุกบรรทัดอยู่ในแคมเปญจึงเริ่มที่ `verifying` ทันที ไม่ขึ้นในคิว "รอการประเมิน" · ใบที่มีแต่ free text เริ่มที่ `pending_review` (เหมือนเดิม)

### หน้าประเมิน (เจ้าหน้าที่)
- **FR-8** — หน้าประเมิน (`pending-review-detail`) แสดงเฉพาะบรรทัด `pending` ให้อนุมัติหรือปฏิเสธ บรรทัด `approved` แสดงเป็นข้อมูลว่า "อยู่ในแคมเปญ · อนุมัติแล้ว"
- **FR-9** — ปฏิเสธบรรทัดต้องใส่เหตุผล (`review_reason`) — ใช้ชุดเหตุผลเดียวกับ `draft-donation-reject-reason`
- **FR-10** — ประเมินครบทุกบรรทัดที่ `pending` แล้ว ระบบคำนวณสถานะใบตาม FR-4..FR-6 (ใบไป `verifying` หรือ `rejected`)
- **FR-11** — การอนุมัติ/ปฏิเสธเขียน `audit` เหมือนเดิม (route `/approve`, `/reject` เดิมขยายให้รับรายการบรรทัด)
- **FR-12** — ปุ่ม "ปฏิเสธคำขอ" ทั้งใบยังอยู่

### ของสด / แช่เย็น
- **FR-13** — ไม่มีข้อยกเว้นสำหรับของสด/แช่เย็น บรรทัดในแคมเปญข้ามการประเมินเท่ากันทุกชนิด · เจ้าหน้าที่ปฏิเสธได้ที่หน้าตรวจรับตอนของมาถึง (`verifying → rejected` มีอยู่แล้ว · ไม่รับรายบรรทัดตาม #621)
- **FR-14** — ตัดข้อ "CR-052 Cold-chain" (เช็ค `is_cold_chain` จาก item master) ออกจาก T-16 — field นี้ไม่เคยมีในโค้ดหรือ schema

### ผู้บริจาค
- **FR-15** — response ของ `POST /public/v1/donations` (FastAPI และ BFF) ส่ง `status` กลับ
- **FR-16** — ตั๋วหลังจอง: ไม่มีบรรทัดรอประเมิน → แสดง QR ทันที · มีบรรทัดรอประเมิน → ข้อความรอเจ้าหน้าที่ตรวจสอบ
- **FR-17** — หน้าติดตามแสดงสถานะรายบรรทัด: "อนุมัติแล้ว / รอนำส่ง" (`approved`) · "รอประเมิน" (`pending`) · "ไม่รับ" + เหตุผล (`rejected`)
- **FR-18** — ผู้บริจาคแก้รายการ (PATCH items) → FastAPI คำนวณ `review_status` ของทุกบรรทัดใหม่ตาม FR-2 แล้วคำนวณสถานะใบตาม FR-4..FR-6 · บรรทัดที่เจ้าหน้าที่ประเมินไปแล้วและไม่ถูกแก้คงผลเดิม

### Quota / slot
- **FR-19** — quota counter และ slot นับเหมือนเดิม (`pending_review` และ `verifying` อยู่ใน `DONATION_OUTSTANDING_STATUSES` ทั้งสองฝั่ง)

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ระดับการประเมิน | ทั้งใบ | รายบรรทัด (`items[].review_status`) |
| สถานะตั้งต้น | `pending_review` ทุกใบ (`use_case.py` `INITIAL_DONATION_STATUS`) | คำนวณจากบรรทัด (FR-4..FR-7) |
| CR-052 §1.4 | บังคับประเมินทุกรายการ ห้ามออก QR อัตโนมัติทุกกรณี | บรรทัดในแคมเปญไม่ต้องประเมิน · ใบที่ทุกบรรทัดอยู่ในแคมเปญได้ QR ทันที |
| T-16 "CR-052 Cold-chain" | เช็ค `is_cold_chain` แล้วบังคับประเมิน | ตัดออก (FR-14) |
| หน้าประเมิน | อนุมัติ/ปฏิเสธทั้งใบ | อนุมัติ/ปฏิเสธเฉพาะบรรทัดที่รอประเมิน (ปฏิเสธทั้งใบยังทำได้) |
| ตั๋วหลังจอง | "ส่งรายการรอเจ้าหน้าที่ตรวจสอบ" เสมอ | QR ทันทีเมื่อไม่มีบรรทัดรอประเมิน |

## Acceptance

- **AC-1** — ใบที่ทุกบรรทัดเป็นของในแคมเปญ → สร้างเป็น `verifying` · ไม่ขึ้นในคิว "รอประเมิน" · ตั๋วแสดง QR
- **AC-2** — ใบผสม → บรรทัดในแคมเปญ `approved` · บรรทัด free text `pending` ขึ้นให้ประเมิน · อนุมัติครบ → ใบไป `verifying`
- **AC-3** — ใบผสม ปฏิเสธบรรทัด free text ทุกบรรทัด → ใบไป `verifying` (เหลือบรรทัดในแคมเปญ) · ผู้บริจาคเห็นเหตุผลที่บรรทัดนั้น
- **AC-4** — ใบที่มีแต่ free text → เริ่มที่ `pending_review` · ปฏิเสธทุกบรรทัด → `rejected`
- **AC-5** — ของสด/แช่เย็นในแคมเปญข้ามการประเมินเหมือนรายการอื่น และปฏิเสธได้ที่หน้าตรวจรับ
- **AC-6** — quota counter และ slot นับเหมือนเดิม
- **AC-7** — ผู้บริจาคแก้ใบที่ `verifying` ให้มีบรรทัด free text เพิ่ม → ใบกลับไป `pending_review` และบรรทัดใหม่ `pending`
- **AC-8** — doc schema_v 5 (ไม่มี `review_status`) แสดงผลและประเมินแบบทั้งใบได้ตามเดิม

## Impact

- **backend:** ฟังก์ชัน pure คำนวณ `review_status` และสถานะใบ (ใช้ทั้ง create และ `update_items`) + test ครบทุกกรณี · `DonationCreateResponse.status` · `pnpm openapi:update`
- **tent-model:** `DonationBuffer.items_declared[].review_status`
- **worker:** inbound copy `items` อยู่แล้วทั้งก้อน — ตรวจว่า field ใหม่ผ่านถึง CouchDB และ projector ส่งต่อให้หน้าติดตาม
- **frontend:** type `Donation` + `DONATION_TRANSITIONS` (เพิ่ม edge `verifying → pending_review` สำหรับ FR-18) · route approve/reject รับรายบรรทัด · `pending-review-detail.svelte` · ตั๋ว · `tracking.ts` + หน้าติดตาม
- **e2e:** `bookAsDonor` จองจากการ์ดแคมเปญ → จะได้ `verifying` ทันที ต้องแยก helper (`bookFromCampaign` / `bookUnsolicited`) · test ที่ต้องการใบรอประเมินใช้ `bookUnsolicited`
- **ซ้อนกับ #621 (`draft-donation-reject-reason`):** การไม่รับรายบรรทัด**ตอนตรวจรับ**ใช้ `received_summary.items[].rejected` ส่วน FR-9 นี้คือการปฏิเสธรายบรรทัด**ตอนประเมิน** ใช้ชุดเหตุผลเดียวกัน และหน้าติดตามแสดงแบบเดียวกัน

## Migration

- **schema_v +1:** `items[].review_status` / `review_reason` optional → doc เดิมไม่ต้อง backfill · reader ที่เจอใบไม่มี `review_status` ใช้สถานะระดับใบตามเดิม
- **ลำดับเลข:** เรียงกับ `draft-donation-reject-reason` (#621) ที่เพิ่ม field บน `donation` เช่นกัน

## Why

- ของในแคมเปญคือของที่ศูนย์ประกาศขอเอง การบังคับประเมินซ้ำทำให้คิว "รอการประเมิน" ล้นโดยไม่จำเป็น
- บรรทัดนอกรายการยังต้องประเมิน เพราะศูนย์ยังไม่รู้ว่าเป็นของอะไร — การแยกระดับบรรทัดทำให้ใบผสมไม่ต้องรอทั้งใบเพราะบรรทัดเดียว
- เหตุผลเดิมของ CR-052 §1.4 คือของแช่เย็น — ของมาถึงแล้วเจ้าหน้าที่ยังตรวจจริงที่หน้างานและปฏิเสธได้ จึงไม่ต้องกั้นไว้ที่ขั้นประเมิน
- ทางเลือกที่ตัดทิ้ง: ข้ามการประเมินทั้งใบเฉพาะใบที่ทุกบรรทัดอยู่ในแคมเปญ (ใบผสมรอประเมินทั้งใบ) — ใบผสมจะยังติดคิวทั้งที่ส่วนใหญ่อยู่ในแคมเปญ

## Decision log

- 2026-10-17 — เจ้าของโครงการ: ใช้ข้อกำหนดตามคำอธิบาย issue #610 (ประเมินรายบรรทัด · ไม่มีข้อยกเว้น cold-chain · quota/slot ไม่เปลี่ยน)
- 2026-10-17 — proposed (track ด้วย CR file แยก branch)
