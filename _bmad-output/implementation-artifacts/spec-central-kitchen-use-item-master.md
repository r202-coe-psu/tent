---
title: 'เชื่อมครัวกลางกับ Item Master และ Unified Requisition Ticket'
type: 'feature'
created: '2026-09-16T00:00:00+07:00'
status: 'draft'
review_loop_iteration: 0
context:
  - '{project-root}/docs/changes/CR-121-spec-ticket.md'
  - '{project-root}/docs/data/schema.md'
  - '{project-root}/docs/task-breakdown/05-D-kitchen.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## สรุป (TL;DR)

เปลี่ยน kitchen flow เป็น clean cutover ตาม CR-121: วัตถุดิบและอาหารปรุงสำเร็จอ้าง Item Master เท่านั้น และการขอเบิกจากแผนอาหารต้องสร้าง `requisition_ticket` ประเภท `kitchen` แทน `kitchen_requisition`. คลังเป็นผู้จัดสรร อนุมัติ และตัดสต็อกตอน dispatch; ครัวบันทึกผลผลิตหลายเมนูผ่าน `meal_service.yield_items` เพื่อรับอาหารพร้อมทานเข้าคลังพร้อมอายุ 4 ชั่วโมง. งานนี้ครอบเฉพาะ kitchen + ticket outbound slice ไม่รวม POS แจกจ่าย ของยืม และ ticket type อื่น

## Intent

**Problem:** ครัวกลางยังจับคู่ `item_master` กับ `supply_item` ด้วยชื่อและตัดสต็อกทันทีผ่าน `kitchen_requisition` ซึ่งขัดกับ Item Master contract และ Unified Ticket lifecycle ของ CR-121 ทำให้ครัวกับคลังใช้ master data และจังหวะตัดสต็อกคนละแบบ

**Approach:** ใช้ `item_master:{id}`/`base_unit` ตลอด meal plan → `requisition_ticket` → `stock_ledger`; เพิ่ม ticket domain/repository/use cases ที่จำเป็นต่อ kitchen flow และเปลี่ยน production board ให้บันทึก Ready Meal Item Master + batch yield ตาม CR-121

## Boundaries & Constraints

**Always:** วัตถุดิบเลือกจาก Item Master หมวด `item_category:food` ที่ active; อาหารปรุงสำเร็จเลือกหรือสร้าง Item Master หมวด `item_category:ready_meal`, `type_class: CONSUMABLE`; quantity ใช้ `qty_str`; ticket เริ่ม `PENDING_PICK` โดย `allocated_qty: '0'`; ticket ต้องมี `meal_plan_id` และมี active ticket ต่อแผนได้หนึ่งใบ; `ticket_no` ออกฝั่ง server เป็นป้ายอ้างอิงที่ collision แล้ว retry โดย `_id` ยังคงเป็น identity; สต็อกและแก๊สถูกตัดเฉพาะ transition ไป `IN_TRANSIT` ด้วย operation ที่ retry ได้โดยไม่ลง ledger ซ้ำ; authorization และ shelter scope บังคับฝั่ง server; batch yield กับ receive-ledger ต้องมี idempotency/recovery เดียวกัน

**Ask First:** หากต้องขยายไป Ticket Hub ครบ 4 ประเภท, POS Distribution, loans/returns หรือฐานข้อมูลนอก local/dev; หาก implementation ต้องเปลี่ยน CR-121/schema contract ที่ approved แล้ว

**Never:** เขียน `kitchen_requisition` ใหม่; รองรับ dual-read/dual-write ของ `supply_item`, `item:*` หรือ kitchen requisition เดิม; จับคู่สินค้าด้วยชื่อ; ตัดสต็อกตอนสร้างตั๋ว; ให้ kitchen staff อนุมัติแทน manager; เชื่อ role/shelter/stock จาก client; อ้างว่า CouchDB `_bulk_docs` เป็น atomic transaction; แก้ไฟล์ untracked ที่ผู้ใช้ให้ละเว้น

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| เปิดตั๋วจากแผน | confirmed meal plan มี Item Master วัตถุดิบครบ | สร้าง ticket `PENDING_PICK`, `allocated_qty:'0'`, ผูก `meal_plan_id`; กดซ้ำคืน ticket เดิม | ไม่สร้างเมื่อ Item Master หาย/ปิดใช้/หน่วยไม่ตรง |
| คลังจัดของไม่ครบ | stock ต่ำกว่า requested | เก็บ allocation บางส่วน; แถวศูนย์ต้องแก้/นำออก หรือ cancel ticket ก่อนอนุมัติ | แสดง shortfall; ไม่ตัดสต็อกก่อน dispatch |
| อนุมัติ/dispatch | manager อนุมัติและ warehouse dispatch | `READY_FOR_DISPATCH` → `IN_TRANSIT`; ลง stock/gas ledger ครั้งเดียว | reject role/state/stock/gas/409; partial bulk ต้องตรวจพบและ retry/reconcile ได้ |
| ครัวรับวัตถุดิบ | ticket อยู่ `IN_TRANSIT` | kitchen staff ยืนยันรับแล้ว ticket เป็น `COMPLETED` พร้อม `received_by` | ห้ามรับซ้ำหรือรับ ticket คนละ shelter |
| บันทึกผลผลิต | ครัวปรุงหลายเมนูเสร็จและมี `cooking_completed_at` | สร้าง meal service + receive ledger พร้อม expiry +4h; กดซ้ำคืนผลเดิม | reject timestamp/item/unit/yield ผิด; partial bulk ต้อง recover ได้ |
| สร้างเมนูใหม่ | ไม่มี Ready Meal Item Master | สร้าง shelter-scoped Item Master ผ่าน server BFF แล้วเลือกเป็น yield item | kitchen role สร้างได้เฉพาะ READY_MEAL/CONSUMABLE ใน shelter ตัวเอง |
| แก้ Item Master หลังเปิดตั๋ว | ชื่อ/metadata เปลี่ยน แต่ ID เดิม | ticket คง snapshot เดิม; ledger ใช้ canonical Item Master ID เดิม | override ต้อง resolve เป็น ID ที่อ่านได้ใน shelter scope |

## Case Handling Contract

- **Unit:** ก่อนสร้าง `TicketItem` ให้ resolve `base_unit` และแปลงจาก `recipe.uom`/หน่วยที่กรอกด้วย `ItemMaster.conversions` (base unit = multiplier `1`); ไม่พบ conversion, conversion ซ้ำ หรือผลลัพธ์ไม่เป็น `qty_str` ให้ reject
- **Duplicate:** ใช้ `meal_plan_id` เป็น link/idempotency key และสร้าง operation record แบบ deterministic ฝั่ง server; คำขอพร้อมกันต้องคืน ticket เดียว ไม่สร้าง ticket/เลข running ซ้ำ
- **Allocation/roles:** ticket ใหม่ใช้ `allocated_qty:'0'`; ทุกบรรทัดต้อง `>0` ก่อน approve. `kitchen_staff` เปิด/รับของ/บันทึก yield, `warehouse_staff` allocate/dispatch, `shelter_manager` หรือ `system_admin` approve; server ตรวจ role, session shelter และ Item Master ใหม่ทุก mutation
- **Dispatch:** `gas_drawdown` เป็น snapshot ใน ticket; ตรวจ stock และ gas ก่อนเขียน, เขียน `stock_ledger`/`gas_ledger` ด้วย operation ID เดียวกัน และใช้ `_rev`/stable ledger IDs ป้องกันซ้ำ. Partial `_bulk_docs` ต้องตรวจผลและ retry/reconcile เฉพาะเอกสารที่ขาด; ห้ามอ้าง atomic transaction
- **Lifecycle:** kitchen transition คือ `PENDING_PICK → READY_FOR_DISPATCH → IN_TRANSIT → COMPLETED`; รับของซ้ำ, ข้าม shelter หรือ dispatch state ผิดให้ reject. ก่อน dispatch ให้แก้ allocation หรือตัดสินใจ cancel ได้
- **Yield:** บังคับ `cooking_completed_at` เป็น ISO timestamp, ตรวจ Ready Meal `category`/`type_class`/unit ฝั่ง server, สร้าง `lot.note=menu_name`, `lot.storage_zone`, `lot_no` ที่ server ออก และ `expiry = cooking_completed_at + 4h`; retry ต้องคืน `meal_service`/ledger ชุดเดิม
- **HTTP contract:** mutation สำเร็จคืนเอกสาร canonical; validation = `422`, ไม่มีสิทธิ์/ผิด shelter = `403`, state หรือ revision ชน = `409`, network retry ต้องไม่สร้างผลซ้ำ

</frozen-after-approval>

## Code Map

- `docs/data/schema.md` -- เปลี่ยน kitchen handoff เป็น Item Master + `requisition_ticket` clean cutover และลบคำอธิบาย flow เก่า
- `frontend/src/lib/features/tickets/domain/ticket.ts` -- kitchen ticket schema, factory, state transitions และ role-independent invariants
- `frontend/src/lib/features/tickets/data/` -- shelter-scoped repository; MVCC, ticket number allocation และ recoverable bulk dispatch
- `frontend/src/lib/features/tickets/application/queries.ts` -- query/mutation + live invalidation สำหรับ kitchen tickets
- `frontend/src/routes/api/tickets/` -- server-authorized create/allocate/approve/dispatch/receive commands และ idempotent recovery
- `frontend/src/routes/(protected)/back-office/tickets/kitchen/` -- คิวตั๋ววัตถุดิบสำหรับครัวและคลัง
- `frontend/src/routes/(protected)/back-office/tickets/[id]/` -- จัดสรร, approve, dispatch และติดตามผลคำสั่ง
- `frontend/src/lib/features/operations/domain/operations.ts` -- `reason: requisition` รับเฉพาะ `requisition_ticket:` และ validate ledger contract
- `frontend/src/lib/features/kitchen/domain/meal-calc.ts` -- Item Master direct mapping และแปลง meal plan เป็น TicketItem snapshot
- `frontend/src/lib/features/kitchen/domain/kitchen.ts` -- ลบ kitchen requisition write model; validate batch `yield_items`
- `frontend/src/lib/features/kitchen/data/kitchen.remote.ts` -- สร้าง meal service + receive ledgers ต่อ Ready Meal ใน batch เดียว
- `frontend/src/lib/features/kitchen/application/queries.ts` -- เปิด ticket จาก meal planผ่าน tickets feature และตัด supply dependency
- `frontend/src/lib/features/kitchen/ui/meal-plan-form.svelte` -- เลือกวัตถุดิบ Item Master FOOD และ preview ด้วย ledger ID เดียวกัน
- `frontend/src/lib/features/kitchen/ui/meal-plan-list.svelte` -- action เปิด/ติดตาม TKT-KITCHEN แทนเบิกทันที
- `frontend/src/routes/(protected)/back-office/kitchen/production-board/[session_id]/+page.svelte` -- ticket status + multi-menu yield + on-the-fly Ready Meal Item Master
- `frontend/src/lib/server/shelter-access-design.ts` -- whitelist, role gate และ transition guard สำหรับ `requisition_ticket`
- `frontend/src/lib/db/staff-couch-sync.ts` และ feature barrels/navigation -- ลบ consumer/notification/live-query ของ kitchen requisition เก่าและเชื่อม ticket ใหม่

## Tasks & Acceptance

**Execution:**
- [ ] `docs/data/schema.md`, `docs/changes/CR-121-spec-ticket.md` -- reconcile kitchen slice: เพิ่ม `meal_plan_id`, อนุญาต `allocated_qty:'0'` เฉพาะก่อน approve, กำหนด kitchen terminal transition, dispatch idempotency fields, gas drawdown และตัด contract `kitchen_requisition` เก่า
- [ ] `docs/data/schema.md`, `frontend/src/lib/features/catalog/domain/catalog.ts`, `frontend/src/routes/api/tickets/` -- กำหนด `ItemMaster.conversions`, deterministic operation record, ticket-number allocation และ HTTP error contract ก่อน implement
- [ ] `frontend/src/lib/features/tickets/domain/ticket.ts`, `frontend/src/lib/features/tickets/data/`, `frontend/src/lib/features/tickets/application/queries.ts`, `frontend/src/routes/api/tickets/` -- implement create/idempotent lookup, allocate/edit/cancel, approve, dispatch/recover, receive และ list/get พร้อม server-side authorization
- [ ] `frontend/src/routes/(protected)/back-office/tickets/kitchen/+page.svelte`, `frontend/src/routes/(protected)/back-office/tickets/[id]/+page.svelte`, `frontend/src/lib/components/backoffice-navbar/static.ts` -- สร้าง warehouse queue/detail สำหรับจัดสรร อนุมัติ dispatch และติดตามสถานะตาม role
- [ ] `frontend/src/lib/features/kitchen/domain/meal-calc.ts`, `frontend/src/lib/features/kitchen/application/queries.ts`, `frontend/src/lib/features/kitchen/ui/meal-plan-form.svelte`, `frontend/src/lib/features/kitchen/ui/meal-plan-list.svelte` -- ใช้ Item Master โดยตรง, แปลงหน่วยด้วย canonical conversions และเปิด kitchen ticket จาก meal plan
- [ ] `frontend/src/lib/features/kitchen/domain/kitchen.ts`, `frontend/src/lib/features/kitchen/data/kitchen.remote.ts`, `frontend/src/routes/(protected)/back-office/kitchen/production-board/[session_id]/+page.svelte` -- รองรับ multi-menu yield, shelter-scoped Ready Meal creation, `cooking_completed_at`, expiry +4h และ recoverable receive-ledger batch
- [ ] `frontend/src/lib/features/tickets/data/`, `frontend/src/lib/features/kitchen/domain/gas-ledger.ts` -- ย้าย gas drawdown ไป dispatch command; gas ไม่พอบล็อกทั้งคำสั่ง และ retry ไม่ลง stock/gas ledger ซ้ำ
- [ ] `frontend/src/lib/features/kitchen/`, `frontend/src/lib/db/staff-couch-sync.ts`, feature barrels, navigation และ seed/fixtures ที่เกี่ยวข้อง -- ลบ production dependency/exports/live queries/history/notifications ของ `SupplyItem`, `kitchen_requisition`, `item:*` และใช้ clean Item Master data
- [ ] `frontend/src/lib/features/tickets/**/*.test.ts`, `frontend/src/lib/features/kitchen/**/*.test.ts`, `frontend/src/lib/features/operations/domain/operations.test.ts`, `frontend/src/lib/server/shelter-access-design.test.ts`, `frontend/src/routes/api/tickets/**/*.test.ts` -- ครอบ duplicate action, RBAC/shelter isolation, transitions, zero allocation, stock/gas insufficiency, concurrent 409, partial bulk recovery, yield expiry และ missing/deactivated master

**Acceptance Criteria:**
- Given แผนอาหารที่ valid, when ครัวกดเปิดคำขอเบิก, then ระบบสร้าง TKT-KITCHEN `PENDING_PICK` ที่อ้าง Item Master และไม่เปลี่ยน stock balance
- Given แผนเดิมมี active ticket, when กดเปิดคำขอซ้ำ, then คืน ticket เดิมและไม่สร้างเอกสารเพิ่ม
- Given manager อนุมัติ allocation แล้ว, when warehouse dispatch ซ้ำหรือชน 409/partial result, then สุดท้าย ticket เป็น `IN_TRANSIT` และมี stock/gas ledger ชุดเดียวครบถ้วน
- Given ticket เป็น `IN_TRANSIT`, when kitchen staff ใน shelter เดียวกันยืนยันรับ, then ticket เป็น `COMPLETED`; การรับซ้ำถูกปฏิเสธ
- Given ผู้ใช้ไม่มีสิทธิ์หรือข้าม state, when เรียก mutation โดยตรง, then repository/server ปฏิเสธโดยไม่มี ticket/ledger เปลี่ยน
- Given ครัวบันทึกผลผลิตหลายเมนูพร้อมเวลาปรุง, when command ถูก retry หลัง partial bulk, then meal service และ receive ledgers มีครบชุดเดียวพร้อม expiry 4 ชั่วโมงจาก `cooking_completed_at`
- Given kitchen staff สร้างเมนูใหม่, when ส่ง payload นอก READY_MEAL/CONSUMABLE หรือข้าม shelter, then server ปฏิเสธ; payload ที่ถูกต้องสร้าง shelter-scoped Item Master ได้
- Given codebase หลัง cutover, when ค้นหา kitchen production paths, then ไม่มี write/read dependency บน `supply_item`, `item:*` หรือ `kitchen_requisition`

## Spec Change Log

- 2026-09-16 — เพิ่ม CR-121 kitchen ticket lifecycle, Ready Meal batch yield และ clean replacement ของ `kitchen_requisition` ตามคำสั่ง owner; จำกัด scope ไม่รวม distribution/loans และ ticket types อื่น
- 2026-09-16 — เพิ่ม Case Handling Contract สำหรับ unit conversion, duplicate/idempotency, allocation/roles, gas dispatch, lifecycle, yield lot/expiry, partial bulk recovery และ HTTP errors

## Design Notes

`meal_plan` เป็นตัวคำนวณสิ่งที่จะทำ ส่วน ticket เป็นคำขอส่งวัตถุดิบและเก็บ snapshot เพื่อ audit. `meal_plan_id` เป็น idempotency/link key; Item Master ID เป็น identity ที่ ledger ใช้ แม้ snapshot เปลี่ยนภายหลังไม่ได้. Dispatch และ yield ใช้ server command, MVCC `_rev`, stable operation/ledger IDs, pre-validation และตรวจผล `_bulk_docs` ทุกรายการ; หากเขียนบางส่วนสำเร็จ การ retry/reconciliation ต้องเติมเฉพาะเอกสารที่ขาด เพราะ CouchDB ไม่มี multi-document transaction. Ready Meal ใหม่เป็น shelter-scoped override เพื่อให้ kitchen staff ทำงานได้โดยไม่เปิดสิทธิ์เขียน catalog กลาง

## Verification

**Commands:**
- `cd frontend && pnpm vitest run src/lib/features/tickets src/lib/features/kitchen src/lib/features/operations/domain/operations.test.ts src/lib/server/shelter-access-design.test.ts` -- ticket/kitchen/domain/security tests ผ่าน
- `cd frontend && npx @sveltejs/mcp svelte-autofixer <ทุกไฟล์ .svelte ที่แก้> --svelte-version 5` -- ไม่มี issue ที่ต้องแก้
- `cd frontend && pnpm check` -- 0 errors และ 0 warnings ที่เกิดจากงานนี้
- `rg -n "SupplyItem|useSupplyItems|supplyRepository|kitchen_requisition|item:" frontend/src/lib/features/kitchen frontend/src/routes/'(protected)'/back-office/kitchen` -- ไม่พบ production dependency ที่ถูกห้าม
