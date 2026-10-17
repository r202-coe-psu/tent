---
id: draft
title: "หน้าหลังบ้านรับบริจาค — รวมแท็บสแกนกับรอการประเมินเป็นแท็บ \"ตรวจรับบริจาค\" (ขวาสุด) และเลิกฟีเจอร์ส่งต่อศูนย์อื่น"
status: proposed
date: 2026-10-17
requested_by: "เจ้าของโครงการ — issue #617 และการเลือก mockup 2026-10-17 (ตัวเลือก B + ค้นหา/กรองสถานะ)"
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/changes/04-donation/CR-052-donation-system-design-v8.md §1.1–§1.3 (แท็บแยก, PendingReviewDialog, Redirect modal)
  - docs/task-breakdown/04-donation.md §T-16 DoD (ข้อ "CR-052 UI Split")
  - docs/changes/draft-donation-backoffice-screens-as-built.md Change A (จำนวนแท็บ) — ถูกแทนที่โดย draft นี้
  - docs/changes/04-donation/CR-087-donation-redirect-target.md → superseded (เลิกฟีเจอร์ส่งต่อทั้งหมด)
  - docs/data/schema.md §2.3 (`status` enum `redirected`, `redirect_to_shelter_code`) และ §2.19 `donation_redirect` — คงไว้อ่านของเดิม เลิกเขียน
  - docs/task-breakdown/04-donation.md T-16 R-16.4 (ส่งต่อศูนย์อื่น)
  - frontend/src/routes/api/back-office/donations/[query]/redirect/+server.ts และ donations/redirects/+server.ts (ลบ)
  - frontend/src/lib/features/operations/domain/operations.ts (`DONATION_TRANSITIONS` ไม่มีขาไป `redirected`)
  - frontend/src/routes/(protected)/back-office/stock-donations/+page.svelte
  - frontend/src/routes/(protected)/back-office/stock-donations/components/scan-station.svelte
  - frontend/src/lib/components/pending-review-board.svelte · pending-review-detail.svelte
  - frontend/e2e/helpers/donation-fullstack.ts (openBackOffice, openPendingRow, approvePending, openInScanStation)
why: งานประเมินกับงานตรวจรับเป็นใบเดียวกันแต่แยกสองแท็บ เจ้าหน้าที่สับสนว่าต้องทำที่ไหน · ศูนย์ไม่ส่งต่อของบริจาคให้กันผ่านระบบแล้ว ให้ติดต่อกันเอง
migration: ไม่เปลี่ยนรูป doc — enum `redirected`, field `redirect_to_shelter_code` และ doc type `donation_redirect` คงไว้อ่าน แต่ระบบเลิกเขียน · ไม่ bump schema_v
---

# หน้าหลังบ้านรับบริจาค — แท็บ "ตรวจรับบริจาค" รวมเดียว

## สรุป

- **เปลี่ยน:** รวมแท็บ "สแกนรับของเข้าคลัง" กับ "รอการประเมิน" เป็นแท็บเดียว "ตรวจรับบริจาค" วางขวาสุดของแถบแท็บและเปิดเป็นแท็บแรกเมื่อเข้าหน้า · ข้างในคง layout หน้าสแกนเดิม แล้วเพิ่มช่องค้นหา + กรองสถานะ + กลุ่ม "รอประเมิน" · **เลิกฟีเจอร์ส่งต่อศูนย์อื่นทั้งหมด**
- **เพื่อ:** เจ้าหน้าที่ทำงานประเมินและตรวจรับใบเดียวกันได้ในที่เดียว และสแกน QR ได้โดยไม่ต้องสลับแท็บ
- **dev ต้อง build:** แท็บใหม่ + ค้นหา/กรอง + เปิดใบรอประเมินในหน้าเดียวกัน + ลบ UI/API/transition ของการส่งต่อ + แก้ e2e helper
- **กระทบ:** CR-052 §1.1–§1.3 · T-16 DoD และ R-16.4 · CR-087 → superseded · ไม่เปลี่ยนรูป doc (ไม่ bump `schema_v`)

## Requirements

### แถบแท็บ
- **FR-1** — แท็บของ `/back-office/stock-donations` เหลือ 3 แท็บ เรียงจากซ้าย: "จัดการความต้องการ" · "ช่วงเวลารับของ" · "ตรวจรับบริจาค" (ขวาสุด)
- **FR-2** — แท็บ "ตรวจรับบริจาค" มี badge จำนวนใบ `pending_review`
- **FR-3** — URL ใช้ `?tab=intake`; `?tab=scan` และ `?tab=pending` เดิมต้อง redirect มา `intake` ด้วย `replaceState`
- **FR-4** — เลือกใบผ่าน URL ได้ด้วย `&ref=<booking_ref>`
- **FR-4a** — เข้าหน้า `/back-office/stock-donations` โดยไม่มี `?tab=` → เปิดแท็บ "ตรวจรับบริจาค"

### เนื้อหาในแท็บ (ตัวเลือก B)
- **FR-5** — คง layout หน้าสแกนเดิม: กล่องสแกน QR / ช่องรหัสการจอง / ปุ่ม Walk-in อยู่ซ้ายบน
- **FR-6** — ใต้กล่องสแกนมีช่องค้นหา (ชื่อผู้บริจาค หรือเลขจอง, partial match)
- **FR-7** — มี chip กรองสถานะพร้อมจำนวน: ทั้งหมด · รอประเมิน (`pending_review`) · รอส่งของ (`verifying`, `declared`) · รับแล้ววันนี้ (`received` ที่ `received_at` วันนี้)
- **FR-8** — รายการแบ่งกลุ่ม "รอประเมิน" อยู่เหนือ "รอตรวจรับที่ศูนย์"
- **FR-9** — คลิกใบ `pending_review` → เปิดหน้าประเมินในแท็บเดียวกัน (รายการที่แจ้ง + บันทึกการประเมิน + "อนุมัติ · ออก QR" + "ปฏิเสธ…")
- **FR-10** — คลิกใบ `verifying` → เปิดหน้าตรวจรับเดิม (จำนวนรับจริง / ที่เก็บ / วันหมดอายุ / ยืนยันรับเข้าคลัง)
- **FR-11** — อนุมัติแล้วใบย้ายจากกลุ่ม "รอประเมิน" ไป "รอตรวจรับที่ศูนย์" โดยไม่ต้องโหลดหน้าใหม่หรือสลับแท็บ
- **FR-12** — ปุ่ม "ปฏิเสธ…" ทุกจุดเปิด modal ปฏิเสธเดียวกัน (ตาม `draft-donation-reject-reason`)
- **FR-13** — การแยก **งาน** ประเมินออกจาก **งาน** กระทบยอดยังคงอยู่: หน้าประเมินไม่มีช่องกรอกจำนวนรับจริง (เจตนาเดิมของ CR-052 §1.2)

### เลิกฟีเจอร์ส่งต่อศูนย์อื่นทั้งหมด
- **FR-14** — ไม่มีปุ่ม/handler "ส่งต่อศูนย์อื่น" ในหน้าใด (ลบ wiring ใน `+page.svelte:168-202` และปุ่มที่ comment ไว้ใน `pending-review-detail.svelte:380-397` ไม่ comment ทิ้ง)
- **FR-15** — ลบ route `POST /api/back-office/donations/[query]/redirect` และ `GET /api/back-office/donations/redirects` พร้อม test
- **FR-16** — `DONATION_TRANSITIONS` ไม่มีขาไป `redirected` จากสถานะใด (ระบบเลิกเขียนสถานะนี้)
- **FR-17** — คง enum `redirected`, field `redirect_to_shelter_code` และ doc type `donation_redirect` (§2.19) ไว้ใน schema เพื่ออ่านของเดิม · ระบุใน `schema.md` ว่า "เลิกเขียนแล้ว (draft นี้)"
- **FR-18** — ที่ใดที่อ่าน `redirected` อยู่ (ป้ายสถานะบนหน้าติดตาม `tracking.ts`, ชุดสถานะที่ปล่อยโควต้า) ยังทำงานกับ doc เดิมได้ ไม่ลบ
- **FR-19** — ศูนย์ที่รับของไม่ไหวให้ปฏิเสธพร้อมเหตุผล (ตาม `draft-donation-reject-reason`) แล้วติดต่อศูนย์อื่นกันเองนอกระบบ

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| แท็บ | `สแกนรับของ | รอการประเมิน | จัดการความต้องการ | ช่วงเวลารับของ` (`+page.svelte:42`) | `จัดการความต้องการ | ช่วงเวลารับของ | ตรวจรับบริจาค` |
| ใบ `pending_review` | ขึ้นทั้งแท็บประเมินและคิวในหน้าสแกน | ขึ้นที่เดียว (กลุ่ม "รอประเมิน") |
| ค้นหา/กรอง | แท็บประเมินมีค้นหา + กรองที่มา · หน้าสแกนไม่มี | ค้นหา + กรองสถานะในแท็บเดียว |
| ส่งต่อศูนย์อื่น | handler อยู่ใน `+page.svelte:168-202` ปุ่มถูก comment ไว้ · มี API `redirect` / `redirects` | ไม่มีทั้ง UI, API และ transition · enum/field/doc type คงไว้อ่านของเดิม |
| แท็บเริ่มต้น | `scan` (`+page.svelte:48-50`) | `intake` |
| CR-087 | approved | superseded |
| CR-052 §1.2 | "2 แท็บ: Pending Review / Verifying Drop-off" | "1 แท็บ ตรวจรับบริจาค แยกงานประเมินกับงานกระทบยอดเป็นคนละหน้าจอย่อย" |

## Acceptance

- **AC-1** — เปิด `?tab=pending` เดิม → ไปแท็บ "ตรวจรับบริจาค" และ URL เป็น `?tab=intake`
- **AC-2** — กรอง "รอประเมิน" → เห็นเฉพาะใบ `pending_review` · ค้นเลขจองบางส่วน → เจอใบนั้น
- **AC-3** — อนุมัติใบจากกลุ่ม "รอประเมิน" → ใบไปอยู่กลุ่ม "รอตรวจรับที่ศูนย์" ทันที → เปิดแล้วตรวจรับเข้าคลังได้
- **AC-4** — สแกน/พิมพ์รหัสการจองได้ตลอดขณะเปิดใบอื่นอยู่
- **AC-5** — ไม่มีปุ่ม "ส่งต่อศูนย์อื่น" ในหน้าใด · เรียก `POST …/[query]/redirect` ได้ 404
- **AC-5a** — `canTransitionDonation(<สถานะใดก็ได้>, 'redirected')` = `false`
- **AC-5b** — doc เดิมที่ `status: redirected` เปิดดูบนหน้าติดตามได้ ไม่มี error
- **AC-6** — e2e donation full-stack 3 ชุดผ่านหลังแก้ helper

## Impact

- **frontend:** `+page.svelte` (TABS, redirect query, ลบ redirect handler) · `scan-station.svelte` (ค้นหา/กรอง/กลุ่ม, เปิดหน้าประเมิน) · ย้าย `pending-review-board/detail.svelte` เข้า `features/donations/ui` · ใช้ TanStack Query แทน `fetch` เองสำหรับคิว
- **e2e:** `helpers/donation-fullstack.ts` — `openBackOffice` (รอแท็บใหม่), `openPendingRow` (ค้นในคิวแทนกดปุ่ม "จัดการ"), `approvePending`, `openInScanStation` · `donation-fullstack.test.ts` จุดที่คลิกแท็บรอการประเมิน · walk-in ใน `donation-fullstack-admin.test.ts` ต้องเข้าถึงปุ่มได้
- **API:** ลบ route `redirect` และ `redirects` (frontend BFF) พร้อม test · `docs/data/api-contract.md` ถ้ามีแถวของสอง route นี้ให้ลบ
- **domain:** `DONATION_TRANSITIONS` เอาขา `redirected` ออก · `features/donations/domain/donation-redirect.ts` และ component `incoming-redirects-board.svelte` ลบได้ (ตรวจด้วย grep ก่อน)
- **ไม่กระทบ:** รูปของ doc (ไม่ bump `schema_v`), worker, backend
- **dead code ที่ลบได้หลังรวมแท็บ:** `lib/components/verifying-board.svelte`, `incoming-redirects-board.svelte`, `pending-review-dialog.svelte`, `lib/components/scan-station.svelte` (ไม่มีใคร import — ตรวจด้วย grep ก่อนลบ)

## Migration

- ไม่มี doc ที่ persist เปลี่ยนรูปร่าง → ไม่ bump `schema_v`
- doc ที่ `status: redirected` และ doc `donation_redirect` ที่มีอยู่แล้ว (ถ้ามี) คงไว้ตามเดิม อ่านได้ ไม่ migrate · production ยังไม่เปิดใช้งานจริง จึงคาดว่าไม่มีข้อมูลจริงค้าง

## ความสัมพันธ์กับ draft อื่น

- **`draft-donation-backoffice-screens-as-built`** (proposed 2026-09-02): Change A (3 แท็บ `สแกน | รอการประเมิน | จัดการความต้องการ`) ถูกแทนที่ด้วย FR-1 ของ draft นี้ · Change B (ขา transition ของ `donation.status`) และ Change C (erratum CR-052 เรื่อง QR) ไม่เกี่ยวกับ draft นี้ แต่ Change C จะถูกกระทบโดย `draft-donation-campaign-auto-approve` (#610) ที่กลับกฎ CR-052 §1.4
- ข้อเสนอ: อนุมัติ draft นี้แล้ว mark Change A ของ draft เดิมว่า superseded

## Why

- ใบจองหนึ่งใบต้องผ่าน "ประเมิน" ที่แท็บหนึ่ง แล้วไป "นับของ" อีกแท็บ แต่ใบรอประเมินก็ขึ้นในคิวหน้าสแกนด้วย (`scan-station.svelte:386`) เจ้าหน้าที่จึงไม่แน่ใจว่าต้องทำที่ไหน
- ปุ่มสแกน QR อยู่ในแท็บแรกเท่านั้น ผู้บริจาคมาถึงขณะเจ้าหน้าที่อยู่แท็บอื่นต้องสลับแท็บก่อน
- เจ้าของโครงการเลือกตัวเลือก B (คงหน้าสแกนเดิม) จาก mockup เพราะใช้งานง่ายกว่าแบบสามคอลัมน์ แล้วเอาช่องค้นหาและการกรองสถานะจากแบบสามคอลัมน์มาเพิ่ม
- ตัวเลือกที่ตัดทิ้ง: แบบสามคอลัมน์ (คิว · รายละเอียด · แผงปุ่ม) และแถบปุ่มติดล่างบนมือถือ
- เลิกส่งต่อศูนย์อื่น: เจ้าของโครงการตัดสินว่าศูนย์ไม่ส่งต่อของบริจาคให้กันผ่านระบบแล้ว ให้ติดต่อกันเอง · ฝั่งปลายทางไม่เคยมีหน้าจอที่ทำอะไรกับตั๋วได้จริง (ดู `draft-donation-backoffice-screens-as-built` §2) · เลือก "คง enum ไว้แต่เลิกเขียน" แทนการลบ enum เพื่อไม่ต้อง bump `schema_v`

## Decision log

- 2026-10-17 — เจ้าของโครงการ: "รวมเมนูไว้ขวามือสุด" = ย้ายแท็บที่รวมแล้วไปขวาสุดของแถบแท็บ
- 2026-10-17 — เจ้าของโครงการ: เลือกตัวเลือก B + ค้นหา/กรองสถานะจากตัวเลือก A · ไม่มีการส่งต่อศูนย์อื่นแล้ว · modal ปฏิเสธผ่าน (mockup: https://claude.ai/artifact/4xCMWzjha3siAfs6BXCSTd)
- 2026-10-17 — เจ้าของโครงการ: เลิกฟีเจอร์ส่งต่อศูนย์อื่นทั้งหมด (ให้ติดต่อกันเอง) · คง enum `redirected` ไว้แต่เลิกเขียน · เปิดหน้ามาที่แท็บ "ตรวจรับบริจาค"
- 2026-10-17 — proposed (track ด้วย CR file แยก branch ตามที่เจ้าของโครงการกำหนด)
