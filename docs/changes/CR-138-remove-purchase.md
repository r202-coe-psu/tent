---
id: CR-138
title: "Remove purchase doc type and ใบจัดซื้อ UI"
status: done
date: 2026-09-26
updated: 2026-09-26
requested_by: Project Owner (Build on remove-purchase plan)
decided_by: Project Owner
layer: volatile
affects:
  - docs/data/schema.md §2.16 (remove) · §2.1 reason enum + ref_id table (withdraw purchase row from CR-055 R2)
  - CR-032 superseded · CR-055 stays done (R2 purchase row withdrawn here)
  - docs/task-breakdown/03-C-supply.md T-11
  - docs/uat/* (UAT-085) · docs/sop/SOP-SmartShelter.md · CR-121 prefix row
  - frontend purchases route/UI · operations domain/data/application/barrel
  - shelter-access-design allowlist · catalog.remote · staging-ops seed
  - worker/tests/projectors/test_needs_projection.py fixture
why: Withdraw procurement (ใบจัดซื้อ) from the warehouse surface — aligns with A6 in CR-058/082; no PO surface in app
migration: No schema_v bump (stock_ledger stays at 3+). No backfill. Staging with purchase:* / reason:purchase → unseed/reseed or leave orphans (Zod write path rejects).
---

# CR-138 — Remove purchase doc type and ใบจัดซื้อ UI

## Why

ถอนฟีเจอร์จัดซื้อ (CR-032) ออกจากระบบคลัง — สอดคล้องหลัก A6 ใน CR-058/082 และไม่ต้องการ surface PO ในแอป. ถอนทั้งก้อน: doc type `purchase` + `stock_ledger.reason: purchase` + UI/route/seed — ไม่เหลือเส้นทางกำพร้า.

## Change

1. ลบ `docs/data/schema.md` §2.16 `purchase`
2. ถอน `purchase` จาก `stock_ledger.reason` enum + แถว `ref_id` mapping (CR-055 R2); แก้ note schema_v 3 ที่อ้าง CR-032
3. Soft-kill แล้วลบ: nav ใบจัดซื้อ, route `/back-office/purchases`, UI (`PurchaseForm` / `PurchaseReceiptForm` / `PurchaseTable`), domain/data/application/barrel, allowlist, catalog branch, seed
4. Supersede CR-032; CR-055 คง `done` — แถว R2 `purchase` ถูกถอนโดย CR นี้ (ไม่ rewrite CR-055 เป็น rejected)
5. ตัด T-11 / UAT-085 / SOP / CR-121 prefix ที่อ้างจัดซื้อ
6. Worker fixture ที่ใช้ `reason: "purchase"` → reason อื่นที่ยัง valid

**ไม่ bump** `schema_v` ของ `stock_ledger` (คง 3+ ตามที่ stamp อยู่แล้ว).

## Impact

- Spec: schema.md, task-breakdown 03-C T-11, UAT checklist/reference, SOP-SmartShelter, CR-121
- CR hygiene: CR-032 → superseded; `_index.md` แถวใหม่; CR-055 ไม่ rewrite
- Frontend: navbar, purchases route, operations feature layers, shelter-access-design, catalog.remote, staging-ops seed
- Worker: needs_projection test fixture

## Migration

N/A (no schema_v bump).

- ไม่ backfill / ไม่ hard-delete ledger บน DB จริงในโค้ดแอป
- Lab ที่ seed แล้วมี `purchase:*` หรือ ledger `reason:purchase` → แนะนำ unseed/reseed/reset; หรือปล่อย orphan (อ่านไม่ได้ผ่าน Zod write path แล้ว)

## Decision log

- 2026-09-26 — proposed (draft-remove-purchase)
- 2026-09-26 — approved as CR-138 (owner Build on plan); soft-kill nav then full removal
- 2026-09-26 — soft-kill shipped: nav ใบจัดซื้อ removed
- 2026-09-26 — full removal shipped (schema, code, seed, UAT; purchases route folder deleted; CR-032 superseded); status → done
