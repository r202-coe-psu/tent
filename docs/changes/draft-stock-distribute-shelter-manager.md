---
id: draft
title: เบิกจ่ายพัสดุตรงจากคลัง — ให้ shelter_manager เบิกได้, supply_coordinator ยังเบิกไม่ได้ (แก้เพิ่ม CR-156 §H)
status: proposed
date: 2026-10-27
requested_by: Dev Team B PR #869 review (Fishcanwalk) + AC ของ GitHub #837
decided_by: project owner
layer: volatile
amends: CR-156 (§H FR-H1)
affects:
  - docs/prd/role-permission-matrix.md §3 (แยกแถว Inventory & Supply → เพิ่มแถว Stock Distribution — แก้หลัง approve ตาม §3)
  - docs/changes/03-C-supply/CR-156-stock-redesign-amendment.md §H FR-H1 (บันทึกผลกระทบไว้ใน CR นี้ ไม่แก้ CR-156)
  - schema_v — ไม่เปลี่ยน
  - frontend/src/lib/auth/roles.ts (canDistributeStock, STOCK_DISTRIBUTOR_CAPABILITIES)
  - frontend/src/lib/server/shelter-access-design.ts (validate_doc_update — stock_ledger direct distribute + stock_lot_reservation role gate)
  - frontend/src/lib/features/operations/ui (stock-table, stock/row-actions, item-detail-sheet, distribute-stock-form)
  - frontend/src/lib/auth/roles.test.ts, frontend/src/lib/server/shelter-access-design.test.ts, frontend/e2e/stock-inventory.test.ts
---

# draft-stock-distribute-shelter-manager — สิทธิ์เบิกจ่ายพัสดุตรงจากคลัง

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ผู้ที่เบิกจ่ายพัสดุตรงจากคลังได้ = SA, `warehouse_staff` และ **`shelter_manager`** (เพิ่ม)
>   ของศูนย์นั้น. `supply_coordinator` ยังเบิกไม่ได้ตาม CR-156 FR-H1 และถูกบังคับที่ชั้น DB ด้วย
> - **ทำไม:** AC ของ #837 และ role matrix ให้ SM คุมงานคลังของศูนย์ตน แต่ gate ใน UI และ VDU
>   (`stock_lot_reservation`) ให้เฉพาะ `warehouse_staff` ทำให้ SM เห็นปุ่มเบิกจ่ายแต่กดไม่ได้
> - **Dev ต้อง build:** gate UI ตัวเดียว (`canDistributeStock`), VDU ของแถวเบิกตรงและ `stock_lot_reservation`
>   รับ WS/SM, ข้อความ tooltip ใหม่
> - **กระทบ:** ไม่เปลี่ยน schema / `schema_v`. ต้อง **redeploy `_design/access`** ทุก shelter DB.
>   แก้ role matrix หลัง approve (§3)

---

## 1. Requirements

| ID   | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1 | การเบิกจ่ายตรงจากคลัง (direct issue, `ref_id` = `requisition_ticket:direct-…`) ทำได้เฉพาะ SA, `{code}:warehouse_staff` และ `{code}:shelter_manager` ของศูนย์ที่ใช้งานอยู่ (รองรับ role แบบ flat legacy ตาม `hasCapabilityInShelter`) — บังคับทั้ง UI (FR-2) และ VDU (FR-4, FR-5)                                                                                                                                              |
| FR-2 | ผู้ใช้ที่ไม่มี `warehouse_staff` หรือ `shelter_manager` ในศูนย์นั้น (เช่น `supply_coordinator` อย่างเดียว) เห็นปุ่มเบิกจ่ายทุกจุดเป็น `disabled` แทนการซ่อนปุ่ม: ปุ่ม header และแถบปุ่มล่างของ `stock-table.svelte`, ปุ่มในแถว (`stock/stock-row.svelte`) และการ์ดมือถือ (`stock/stock-card.svelte`) ผ่าน `stock/row-actions.svelte`, `item-detail-sheet.svelte`, ฟอร์ม `distribute-stock-form.svelte`                        |
| FR-3 | Tooltip / ข้อความแจ้งของ FR-2 = `"ต้องมีสิทธิ์เจ้าหน้าที่คลัง (warehouse_staff) หรือผู้จัดการศูนย์ (shelter_manager) จึงจะเบิกจ่ายได้"`                                                                                                                                                                                                                                                                                       |
| FR-4 | `validate_doc_update` ของ `stock_lot_reservation` อนุญาต `warehouse_staff`, `shelter_manager` (และ SA / `_admin`); role อื่นถูกปฏิเสธด้วย `Only warehouse staff, shelter manager, or system admin can manage stock lot reservations`                                                                                                                                                                                          |
| FR-5 | `validate_doc_update` ของ `stock_ledger` แถว `reason: 'distribute'`: `ref_id` ขึ้นต้น `requisition_ticket:direct-` อนุญาตเฉพาะ `warehouse_staff`, `shelter_manager` (และ SA / `_admin`) — role อื่นถูกปฏิเสธด้วย `Only warehouse staff, shelter manager, or system admin can write direct distribute stock ledger`. `requisition_ticket:{ulid}` (ใบเบิก CR-121) ยังรับ WS/SC/SM; `distribution_batch:` ยังเป็น warehouse-only |
| FR-6 | UI gate และ VDU ใช้ชุดสิทธิ์เดียวกัน (WS/SM/SA): UI ใช้ `canDistributeStock(roles, shelterCode)` ใน `$lib/auth/roles` เพียงจุดเดียว                                                                                                                                                                                                                                                                                           |
| FR-7 | Release: redeploy `_design/access` (`pnpm redeploy:access --write --confirm`) บนทุก shelter DB **ก่อนหรือพร้อม** deploy frontend; ถ้า frontend ขึ้นก่อน SM จะได้ 403 ตอนจองล็อต                                                                                                                                                                                                                                               |
| FR-8 | เมื่อ CR นี้ approve: แก้ `role-permission-matrix.md` §3 ตาม §3 ของ CR นี้                                                                                                                                                                                                                                                                                                                                                    |

### ผลต่อ CR-156 (บันทึกที่นี่ ไม่แก้ CR-156)

| CR-156                                                  | ก่อน                                                             | หลัง                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| §H FR-H1 เงื่อนไข disabled                              | ผู้ใช้ที่ไม่มี capability `warehouse_staff`                      | ผู้ใช้ที่ไม่มี capability `warehouse_staff` **หรือ** `shelter_manager` (FR-2) |
| §H FR-H1 ข้อความ tooltip                                | `ต้องมีสิทธิ์เจ้าหน้าที่คลัง (warehouse_staff) จึงจะเบิกจ่ายได้` | ข้อความตาม FR-3                                                               |
| §H FR-H1 ชั้นที่บังคับ                                  | UI เท่านั้น                                                      | UI + VDU (FR-4, FR-5)                                                         |
| §H AC-H1 (`staff03` = supply_coordinator ปุ่ม disabled) | —                                                                | คงเดิม                                                                        |

## 2. Acceptance

- **AC-1** SM ของ SH001 (`['shelter:SH001', 'shelter_manager']`) เปิด `/back-office/supply` → ปุ่มเบิกจ่ายกดได้; เบิก 1 รายการ → มีแถว `stock_ledger` `reason: 'distribute'`, `created_by` = SM และ VDU ไม่ตอบ 403 (e2e `stock-inventory.test.ts` › _shelter manager can distribute stock directly (#837)_)
- **AC-2** SC (`supply_coordinator` + `registration_staff`) → ปุ่มเบิกจ่ายทุกจุด disabled พร้อม tooltip ตาม FR-3 (e2e _supply coordinator can view stock but distribute buttons are disabled_)
- **AC-3** VDU `stock_lot_reservation`: SM เขียนได้; SC และ REG ถูกปฏิเสธ (`shelter-access-design.test.ts`)
- **AC-4** VDU `stock_ledger` direct distribute: WS / SM / SA เขียนแถว `requisition_ticket:direct-…` ได้; SC ถูกปฏิเสธ; SC ยังเขียนแถว `requisition_ticket:{ulid}` ได้ (`shelter-access-design.test.ts` › _direct issue (requisition_ticket:direct-…, #837)_)
- **AC-5** `canDistributeStock`: SA / WS / SM ของศูนย์ = true; SM ของศูนย์อื่น, SC, REG = false (`roles.test.ts`)

## 3. Spec delta — `docs/prd/role-permission-matrix.md` §3 (แก้หลัง approve)

แถวเดิม:

| หมวดงาน / เอกสาร       | การกระทำ (Action)                 | SA  |  SM   | REG | TRG | MED | KS  |  SC   | VC  | SO  | FAC |
| :--------------------- | :-------------------------------- | :-: | :---: | :-: | :-: | :-: | :-: | :---: | :-: | :-: | :-: |
| **Inventory & Supply** | รับของบริจาค, ตัดจ่ายพัสดุ, สต็อก |  ✓  | scope |  —  |  —  |  —  |  —  | scope |  —  |  —  |  —  |

แถวใหม่ (แทนแถวเดิม):

| หมวดงาน / เอกสาร                | การกระทำ (Action)                       | SA  |  SM   | REG | TRG | MED | KS  |  SC   | VC  | SO  | FAC |
| :------------------------------ | :-------------------------------------- | :-: | :---: | :-: | :-: | :-: | :-: | :---: | :-: | :-: | :-: |
| **Inventory & Supply**          | รับของบริจาค, สต็อก                     |  ✓  | scope |  —  |  —  |  —  |  —  | scope |  —  |  —  |  —  |
| **Stock Distribution** (CR นี้) | เบิกจ่ายพัสดุออกจากคลังโดยตรง (ตัดจ่าย) |  ✓  | scope |  —  |  —  |  —  |  —  |  WS   |  —  |  —  |  —  |

- เพิ่ม note ใต้ตาราง: `WS` ในคอลัมน์ SC = เฉพาะ `{code}:warehouse_staff`; `supply_coordinator` ดูสต็อกและรับเข้าได้แต่เบิกจ่ายไม่ได้ (CR-156 §H FR-H1); SM ของศูนย์เบิกจ่ายได้
- อัปเดต `updated:` และเพิ่ม CR นี้ใน `affects:` ของ role matrix

## 4. Impact

- **Docs:** `docs/prd/role-permission-matrix.md` §3 (FR-8, หลัง approve)
- **Code:** `roles.ts` (`canDistributeStock`), `shelter-access-design.ts` (FR-4, FR-5), UI ของ operations 4 ไฟล์ (FR-2, FR-3, FR-6)
- **Tests:** unit `roles.test.ts`, `shelter-access-design.test.ts`, DOM mock ใน `distribute-stock-form.dom.test.ts`, e2e `stock-inventory.test.ts`
- **Ops:** redeploy `_design/access` (FR-7)

## 5. Migration

N/A — ไม่เปลี่ยนรูป doc ที่ persist. VDU ตรวจเฉพาะการเขียนใหม่; แถว `requisition_ticket:direct-…` เดิมไม่ถูกตรวจย้อนหลัง

## 6. Out of scope / ต้องตัดสินใจต่อ

- [NEEDS DECISION: `role-permission-matrix.md` §1.1 คำอธิบาย SC ยังเขียน "ตัดจ่ายสิ่งของจำเป็น, เบิกถุงยังชีพ" และ decision sync 2026-10-10 ระบุ `warehouse_staff` เป็น alias ของ SC แต่ CR-156 FR-H1 แยกสิทธิ์เบิกจ่ายของสองบทบาทนี้ — ยืนยันว่า SC ไม่เบิกจ่ายตรง หรือจะให้ SC เบิกได้ใน CR แยก]
- SC ยังเขียน `stock_ledger` แบบ `adjust` ยอดติดลบได้ (ลดสต็อกได้โดยไม่ผ่านการเบิก) — FR-5 กันเฉพาะแถวเบิกตรง
- จำกัดสิทธิ์ `stock_lot_reservation` ของ SM ให้เฉพาะ claim ที่ `batch_id` เป็น `distribution_batch:direct-…`

## Decision log

- 2026-10-07 — CR-156 §H FR-H1 approved: ปุ่มเบิกจ่ายเฉพาะ `warehouse_staff`
- 2026-10-27 — PR #869 review (Fishcanwalk): ให้ `shelter_manager` เบิกจ่ายได้ตาม AC #837 → proposed
- 2026-10-27 — บังคับ FR-1 ที่ VDU ด้วย (FR-5) ไม่ใช่เฉพาะ UI; role matrix แก้หลัง approve (FR-8)
