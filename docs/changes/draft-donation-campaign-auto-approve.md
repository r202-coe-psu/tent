---
id: draft
title: "ข้ามการประเมินสำหรับใบบริจาคที่ทุกรายการอยู่ในแคมเปญ (ได้ QR ทันที) และสิทธิ์ผู้บริจาคหลังได้ QR"
status: proposed
date: 2026-10-17
requested_by: "เจ้าของโครงการ — issue #610 และการตัดสินใจ 2026-10-17"
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/changes/04-donation/CR-052-donation-system-design-v8.md §1.4 (บังคับประเมินทุกรายการ), flowchart B1, force cut-off C3, §2.6 (QR เมื่ออนุมัติ)
  - docs/task-breakdown/04-donation.md T-16 (ข้อ "CR-052 (Task #52)" และ "CR-052 Cold-chain")
  - docs/data/schema.md §2.3 `donation` — field ใหม่ `auto_approved`; ข้อความเส้นทางสถานะ
  - schema_v donation 5 → 6 (หรือเลขถัดไปถ้า draft-donation-reject-reason อนุมัติก่อน)
  - docs/data/api-contract.md — response ของ `POST /public/v1/donations` (`status`), กฎสิทธิ์แก้/ยกเลิก (แถว `400` ที่อ้าง `DONOR_EDITABLE_STATUSES`)
  - docs/changes/04-donation/CR-080-donor-edit-reservation-via-token.md (สิทธิ์แก้รายการ)
  - docs/changes/draft-donation-backoffice-screens-as-built.md Change C (erratum เรื่อง QR)
  - backend/apiapp/modules/donations (use_case: สถานะตั้งต้น, update_items, cancel, courier) · packages/tent-model (DonationBuffer)
  - worker/src/worker/inbound/donations.py (copy `auto_approved`, เขียน audit)
  - frontend/src/lib/features/donations/domain (public-donation.ts, tracking.ts) · operations.ts (`DONATION_TRANSITIONS`)
  - frontend/src/routes/api/public/v1/donations/** · lib/components/public-donor-success-ticket.svelte · track/[token]/+page.svelte
why: ของที่ศูนย์เปิดแคมเปญขอไว้เป็นของที่ศูนย์ตัดสินแล้วว่ารับเข้าคลังได้ ไม่จำเป็นต้องรอเจ้าหน้าที่ประเมินซ้ำ
migration: field ใหม่ optional — doc เดิมไม่ต้อง backfill (ไม่มี = ไม่ได้อนุมัติอัตโนมัติ)
---

# ข้ามการประเมินสำหรับใบบริจาคที่ทุกรายการอยู่ในแคมเปญ

## สรุป

- **เปลี่ยน:** ใบจองที่**ทุกรายการ**จองโควต้าแคมเปญได้ เปิดที่ `verifying` ทันที (ผู้บริจาคได้ QR หลังกดจอง) · ใบที่มีของพิมพ์เองยังเปิดที่ `pending_review` เหมือนเดิม · กลับกฎ CR-052 §1.4
- **สิทธิ์ผู้บริจาคหลังได้ QR:** ใบที่ได้ QR อัตโนมัติแก้รายการได้แต่ต้องกลับไปรอประเมิน · ใบที่เจ้าหน้าที่อนุมัติแก้รายการไม่ได้ · ทั้งสองแบบยกเลิกและใส่เลขพัสดุได้
- **dev ต้อง build:** คำนวณสถานะตั้งต้นฝั่ง FastAPI + field `auto_approved` + ตั๋ว QR ทันที + กฎสิทธิ์ใหม่ + edge `verifying → pending_review` + audit อนุมัติอัตโนมัติ
- **กระทบ:** `donation` schema_v +1 (`auto_approved`) · CR-052 §1.4 · T-16

## Requirements

### สถานะตั้งต้น
- **FR-1** — FastAPI คำนวณสถานะตั้งต้นหลังจองโควต้า: เปิดที่ `verifying` และตั้ง `auto_approved: true` เมื่อครบทุกข้อ
  1. `campaign_id` มีค่า
  2. `items` มีอย่างน้อย 1 บรรทัด
  3. **ทุกบรรทัด**มี `item_id` และจองโควต้าสำเร็จ (`reserve_quota` = `RESERVED`)
- **FR-2** — ไม่เข้าเงื่อนไข FR-1 (มีบรรทัดพิมพ์เอง / ไม่มีแคมเปญ / counter ยังไม่ seed `NOT_SEEDED`) → `pending_review` และ `auto_approved: false`
- **FR-3** — ฝั่ง client ห้ามกำหนดสถานะตั้งต้นหรือ `auto_approved` เอง
- **FR-4** — ไม่มีตัวเลือกบังคับประเมินระดับแคมเปญหรือระดับสินค้า (เช่น cold-chain) — ทุกแคมเปญใช้กฎ FR-1 เท่ากัน
- **FR-5** — `donation` เพิ่ม `auto_approved: bool|null` (เขียนตอนสร้าง · ตั้งเป็น `false` เมื่อถูกตีกลับตาม FR-11)

### ตั๋วและหน้าติดตาม
- **FR-6** — response ของ `POST /public/v1/donations` (FastAPI และ BFF) ส่ง `status` กลับ
- **FR-7** — ตั๋วหลังจอง: `status = verifying` → แสดง QR ทันที พร้อมข้อความ "แสดง QR นี้ที่จุดรับของ" · `pending_review` → ข้อความรอเจ้าหน้าที่ตรวจสอบ (เหมือนเดิม)
- **FR-8** — ป้ายสถานะ `verifying` บนหน้าติดตามเปลี่ยนจาก "กำลังตรวจรับที่ศูนย์" เป็นข้อความที่ไม่สื่อว่าของถึงศูนย์แล้ว (เช่น "พร้อมนำส่ง · แสดง QR ที่จุดรับ")

### สิทธิ์ผู้บริจาค

| ใบ | แก้รายการ | ยกเลิก | ใส่เลขพัสดุ |
| --- | --- | --- | --- |
| `declared` / `pending_review` | ได้ | ได้ | ได้ |
| `verifying` + `auto_approved: true` | ได้ → ตีกลับ `pending_review` | ได้ | ได้ |
| `verifying` ที่เจ้าหน้าที่อนุมัติ | **ไม่ได้** | ได้ | ได้ |
| สถานะอื่น | ไม่ได้ | ไม่ได้ | ไม่ได้ |

- **FR-9** — กฎในตารางต้องมาจากฟังก์ชันเดียวต่อฝั่ง (backend + frontend) ที่ตัดสินจาก doc ทั้งใบ (`status` + `auto_approved`) แทนชุด `DONOR_EDITABLE_STATUSES` แบบเดิม
- **FR-10** — ยกเลิกใบ `verifying` คืนโควต้าและ slot ตามกลไกเดิมของการยกเลิก
- **FR-11** — แก้รายการของใบ `verifying` + `auto_approved: true` → `status: pending_review`, `auto_approved: false`, QR ใช้ไม่ได้จนกว่าเจ้าหน้าที่อนุมัติ · `DONATION_TRANSITIONS` เพิ่ม edge `verifying → pending_review` สำหรับกรณีนี้เท่านั้น
- **FR-12** — หน้าติดตามเตือนก่อนบันทึกการแก้ว่า "แก้แล้วต้องรอเจ้าหน้าที่ประเมินใหม่ และ QR จะใช้ไม่ได้จนกว่าจะอนุมัติ"
- **FR-13** — route รับของเข้าคลังต้องรับเฉพาะ doc revision ล่าสุด (เช็ค `_rev`) — ผู้บริจาคแก้ระหว่างเจ้าหน้าที่เปิดใบค้างไว้ → 409 พร้อมข้อความให้โหลดใหม่

### Audit
- **FR-14** — ใบที่เปิดที่ `verifying` อัตโนมัติ: worker inbound เขียน `audit` (`action: manual_adjust`, `context: {approved_by: 'system', rule: 'campaign_auto_approve'}`) ตอนเขียน doc ลง CouchDB (FastAPI เขียน CouchDB ไม่ได้)

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| สถานะตั้งต้น | `pending_review` ทุกใบ (`backend/apiapp/modules/donations/use_case.py` `INITIAL_DONATION_STATUS`) | `verifying` เมื่อเข้า FR-1 · นอกนั้น `pending_review` |
| CR-052 §1.4 | บังคับประเมินทุกรายการ ห้ามออก QR อัตโนมัติทุกกรณี | ยกเว้นใบที่ทุกรายการอยู่ในแคมเปญ (FR-1) |
| T-16 "CR-052 Cold-chain" | เช็ค `is_cold_chain` จาก item master แล้วบังคับประเมิน (ไม่เคยมี field นี้ในโค้ดหรือ schema) | ตัดออก (FR-4) |
| ตั๋วหลังจอง | "ส่งรายการรอเจ้าหน้าที่ตรวจสอบ" เสมอ ไม่มี QR | QR ทันทีเมื่อ `verifying` |
| แก้รายการที่ `verifying` | ไม่ได้ | ได้เฉพาะ `auto_approved` และถูกตีกลับ |
| ยกเลิก / เลขพัสดุที่ `verifying` | ไม่ได้ (UI เปิดช่องเลขพัสดุไว้แต่ API ปฏิเสธ) | ได้ |
| Force cut-off (CR-052 C3) | ยกเลิกเฉพาะใบ `pending_review` | คงเดิม — ใบที่ได้ QR แล้ว (`verifying`) ไม่ถูกยกเลิกโดย cut-off |

## Acceptance

- **AC-1** — จองจากการ์ดแคมเปญ (ทุกรายการมี `item_id` จองโควต้าได้) → ตั๋วแสดง QR ทันที · doc `verifying` + `auto_approved: true` · มี audit `approved_by: system`
- **AC-2** — จองแบบพิมพ์เอง → `pending_review` · ไม่มี QR · ขึ้นคิวรอประเมิน
- **AC-3** — counter ยังไม่ seed (`NOT_SEEDED`) → `pending_review`
- **AC-4** — ใบ `auto_approved` แก้จำนวน → `pending_review` · QR หาย · เจ้าหน้าที่อนุมัติ → QR กลับมา
- **AC-5** — ใบที่เจ้าหน้าที่อนุมัติ → ไม่มีปุ่มแก้รายการ · `PATCH …/items` ตอบปฏิเสธ · ยกเลิกได้และโควต้าคืน · ใส่เลขพัสดุได้
- **AC-6** — เจ้าหน้าที่รับของเข้าคลังใบ `auto_approved` ได้โดยไม่ต้องกดอนุมัติ
- **AC-7** — ผู้บริจาคแก้ใบขณะเจ้าหน้าที่เปิดหน้าตรวจรับค้างไว้ → กดยืนยันรับเข้าคลังได้ 409

## Impact

- **backend:** ฟังก์ชัน pure `initial_status_for()` + test ครบทุกกรณี FR-1/FR-2 · `DonationCreateResponse.status` · ฟังก์ชันสิทธิ์แทน `DONOR_EDITABLE_STATUSES` · `update_items` ตีกลับ · `cancel` / courier รับ `verifying` · `pnpm openapi:update`
- **tent-model:** `DonationBuffer.auto_approved`
- **worker:** inbound copy `auto_approved` (เขียน doc ทีละ field) + audit FR-14 · test
- **frontend:** ฟังก์ชันสิทธิ์ฝั่ง client (`public-donation.ts`, `tracking.ts`) · BFF gate (`[tracking_token]/+server.ts` DELETE + courier, `items/+server.ts`) · `DONATION_TRANSITIONS` · ตั๋ว · ป้ายสถานะ · route รับของเช็ค `_rev`
- **e2e:** `bookAsDonor` จองจากการ์ดแคมเปญทุกครั้ง → จะได้ QR ทันที ต้องแยก helper `bookFromCampaign` / `bookUnsolicited` · test ที่ต้องการใบรอประเมิน (approve, reject จากคิว) ใช้ `bookUnsolicited` · เพิ่มเคส AC-1/AC-4/AC-5
- **test เดิมที่ต้องแก้:** `backend/tests/test_donations.py` (assert `pending_review` ตอนสร้าง, parametrized ว่า `verifying` แก้ไม่ได้) · vitest `public-donation.test.ts`, `tracking.test.ts`, `items.test.ts`, `donations.test.ts`

## Migration

- **schema_v +1:** `auto_approved` optional → doc เดิมไม่ต้อง backfill; ไม่มี field = ไม่ได้อนุมัติอัตโนมัติ (ใบ `verifying` เดิมจึงถือเป็นใบที่เจ้าหน้าที่อนุมัติ แก้รายการไม่ได้)
- **ลำดับเลข:** ถ้า `draft-donation-reject-reason` อนุมัติก่อน (5 → 6) ฉบับนี้ใช้ 6 → 7 หรือรวมเป็น bump เดียวถ้าออก release พร้อมกัน

## Why

- ของในแคมเปญคือของที่ศูนย์ประกาศขอเอง ศูนย์ตัดสินแล้วว่ารับเข้าคลังได้ การบังคับประเมินซ้ำทำให้ผู้บริจาคต้องรอ QR โดยไม่จำเป็น
- ใบที่มีของพิมพ์เองยังต้องประเมิน เพราะศูนย์ยังไม่รู้ว่าเป็นของอะไร
- เหตุผลเดิมของ CR-052 §1.4 คือความเสี่ยงของแช่เย็น (cold-chain) — เจ้าของโครงการรับความเสี่ยงนี้และไม่ต้องการตัวเลือกบังคับประเมินรายแคมเปญ (2026-10-17)
- ใบที่ได้ QR อัตโนมัติไม่เคยผ่านคน การแก้รายการจึงต้องกลับไปประเมิน · ใบที่เจ้าหน้าที่อนุมัติแล้วถูกตรวจรายการไปแล้ว จึงห้ามแก้
- ยกเลิกต้องทำได้ทุกใบที่ยังไม่รับ เพราะช่วงน้ำท่วมหนักผู้บริจาคอาจเดินทางมาส่งหรือศูนย์ไปรับไม่ได้ ต้องคืนโควต้าให้คนอื่น

## Decision log

- 2026-10-17 — เจ้าของโครงการ: ไม่ต้องมีตัวเลือก "ต้องประเมินเสมอ" ในแคมเปญ · ใบ QR อัตโนมัติแก้แล้วต้องประเมินใหม่ · ใบที่เจ้าหน้าที่อนุมัติแก้ไม่ได้ แต่ยกเลิกและใส่เลขพัสดุได้ · เก็บ audit การอนุมัติอัตโนมัติ
- 2026-10-17 — proposed (track ด้วย CR file แยก branch ตามที่เจ้าของโครงการกำหนด)
