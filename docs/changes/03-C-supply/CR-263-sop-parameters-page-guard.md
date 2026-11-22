---
id: CR-263
title: เพิ่ม role guard หน้า /back-office/sop-parameters (SA / SM / WS เข้าและทำได้, SC ดูอย่างเดียว, role อื่นเข้าไม่ได้) — Daily SOP คงเดิม
status: approved
date: 2026-11-16
updated: 2026-11-22
requested_by: "PO (Fishcanwalk) — คำตัดสินสิทธิ์ 2 หน้าที่เหลือ บน GitHub #845 (2026-11-16)"
decided_by: kong
layer: volatile
affects:
  - docs/prd/role-permission-matrix.md §3 (เพิ่มแถว SOP Parameters (หน้า) + decision sync note ของ /back-office/dailysop)
  - docs/data/schema.md — ไม่เปลี่ยนรูป doc; schema_v — ไม่เปลี่ยน
  - frontend/src/routes/(protected)/back-office/sop-parameters/+page.ts (guard)
  - frontend/src/lib/components/backoffice-navbar/static.ts (เมนู "พารามิเตอร์" `visibleTo`)
  - frontend/src/lib/components/backoffice-navbar/static.guards.test.ts (เอา /back-office/sop-parameters ออกจาก EXEMPT)
  - frontend/src/lib/auth/roles.ts — ไม่เพิ่มฟังก์ชันใหม่ (ใช้ `canAccessWarehouse` ที่มีอยู่)
---

# เพิ่ม role guard หน้า `/back-office/sop-parameters`

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** หน้า `/back-office/sop-parameters` (เมนู "พารามิเตอร์") เปลี่ยนจาก "ทุกบัญชีที่ login เข้าได้" เป็น
>   เข้าได้เฉพาะ SA, SM ของศูนย์, `warehouse_staff` (WS) และ `supply_coordinator` (SC) ของศูนย์; role อื่นถูก redirect และไม่เห็นเมนู
> - **ทำไม:** `requireAuth` อย่างเดียวทำให้บัญชีอาสาสิทธิ์จำกัด (เช่น `distribution_staff`) เห็นเมนูและเปิดหน้าได้ — PO ตัดสินสิทธิ์แล้วเมื่อ 2026-11-16
> - **Dev ต้อง build:** guard `requireWarehouseAccess` ใน `+page.ts`, `visibleTo` ของเมนูเรียก predicate ตัวเดียวกัน (`canAccessWarehouse`), ตัด EXEMPT ออกจาก `static.guards.test.ts`
> - **กระทบ:** role matrix §3 เท่านั้น — ไม่เปลี่ยนรูป doc, ไม่ bump `schema_v`, ไม่แตะ `validate_doc_update` / BFF · `/back-office/dailysop` คงเดิม (ไม่เพิ่ม guard)

---

## 1. Requirements

| ID   | Requirement |
| ---- | ----------- |
| FR-1 | ผู้ใช้เปิด `/back-office/sop-parameters` ได้เมื่อเป็น `system_admin` หรือเป็น `shelter_manager` / `warehouse_staff` / `supply_coordinator` ของศูนย์ที่เลือกอยู่ (`canAccessWarehouse`) |
| FR-2 | Role อื่นทั้งหมด (เช่น `distribution_staff`, `kitchen_staff`, `donation_staff`, `registration_staff`, `volunteer_coordinator`, อาสาสมัครสิทธิ์จำกัด) และผู้ใช้ที่ไม่มีสิทธิ์ในศูนย์ที่เลือก เปิด URL ตรงแล้วถูก redirect ตามกติกาเดียวกับหน้าคลังอื่น (`requireWarehouseAccess`) |
| FR-3 | เมนู "พารามิเตอร์" ใน sidebar back-office แสดงเฉพาะผู้ที่ผ่าน FR-1 — `visibleTo` เรียก predicate ตัวเดียวกับ guard (`canAccessWarehouse`) ไม่เขียนเงื่อนไขซ้ำ |
| FR-4 | สิทธิ์ระดับหน้าเท่านั้น: ปุ่ม/การแก้ไขภายในหน้ายังเป็นไปตาม [CR-235](03-C-supply/CR-235-warehouse-stock-parameter-access.md) เดิม — master แก้ได้เฉพาะ SA, `sop_override` แก้ได้เฉพาะ SA/SM, override 3 type ของสต็อกแก้ได้โดย SA/SM/`warehouse_staff` (`supply_coordinator` ดูอย่างเดียว) **[เปลี่ยนตาม decision sync 2026-11-22: `warehouse_staff` แก้ `sop_override` ได้ รอแก้ในโค้ด (ตาม CR-235) — มีผลกับ AC-5 ด้วย]** |
| FR-5 | `/back-office/dailysop` คงเดิม: ทุก role เข้าได้ ไม่เพิ่ม guard; เนื้อหาในหน้ายังกรองตาม role ที่บัญชีนั้นประเมินได้ ([CR-153](07-B-sop/CR-153-daily-sop-role-assessments.md): SA/SM เห็นครบ 9 role) |
| FR-6 | `/system-management/sop-parameters` (SA เท่านั้น) ไม่เปลี่ยน |

## 2. Acceptance

- **AC-1** `system_admin`, `{code}:shelter_manager`, `{code}:warehouse_staff`, `{code}:supply_coordinator` เปิด `/back-office/sop-parameters` ของศูนย์ตนได้
- **AC-2** `distribution_staff`, `kitchen_staff`, `donation_staff`, `registration_staff`, `volunteer_coordinator` และบัญชีที่ไม่มี role ของศูนย์ที่เลือก เปิด URL ตรงแล้วถูก redirect และไม่เห็นเมนู "พารามิเตอร์"
- **AC-3** บัญชีหลายศูนย์: ศูนย์ที่เลือกอยู่เป็นตัวตัดสิน (เช่น SM ของ SH002 แต่เลือก SH001 ที่เป็น `kiosk_staff` → เข้าไม่ได้)
- **AC-4** `static.guards.test.ts` ครอบ `/back-office/sop-parameters` ผ่าน guard จริง: ผลของ guard ตรงกับ `visibleTo` ของเมนูทุกชุด role ใน `ROLE_SETS`; `/back-office/dailysop` ยังอยู่ใน EXEMPT
- **AC-5** `supply_coordinator` เข้าหน้าได้แต่ไม่เห็นปุ่มแก้ของ master / `sop_override` / override 3 type (พฤติกรรมเดิมของ CR-235 ไม่เปลี่ยน)
- **AC-6** `/back-office/dailysop` เปิดได้ทุก role เหมือนเดิม

## 3. Spec delta — `docs/prd/role-permission-matrix.md` §3

เพิ่มแถวหลังแถว "Stock Parameter Overrides" และ decision sync note:

| หมวดงาน / เอกสาร | การกระทำ (Action) | SA | SM | REG | TRG | MED | KS | SC | DON | VC | SO | FAC |
| ---------------- | ----------------- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **SOP Parameters (หน้า)** | เข้าหน้า `/back-office/sop-parameters` และเห็นเมนู "พารามิเตอร์" (สิทธิ์ระดับหน้า — ปุ่มแก้ยังเป็นไปตามแถว Stock Parameter Overrides / CR-235) | ✓ | scope | — | — | — | — | read | — | — | — | — |

> ช่อง SC = `read` (เข้าหน้าได้ แก้ไม่ได้) · แถว Stock Parameter Overrides ที่ `WS` ในช่อง SC หมายถึง `warehouse_staff` — `warehouse_staff` เข้าหน้านี้ได้เช่นกัน (ผ่าน `canAccessWarehouse`)
>
> **decision sync 2026-11-16** — `/back-office/dailysop` เข้าได้ทุก role (ไม่เพิ่ม guard); เนื้อหากรองตาม role ที่ประเมินได้ ตาม CR-153

## 4. Why

- ที่มา: #845 — 3 หน้าหลังบ้านไม่มี guard ทำให้ `distribution_staff` ฯลฯ เห็นเมนูและเข้าหน้าได้; #842 กรองเมนูตาม guard ที่มีอยู่เท่านั้น
- ขอบเขตลดจาก 3 หน้าเหลือ 2 หน้า: `/back-office/shelters/readiness` ตัดสินแล้ว (SA/SM ของศูนย์, decision sync 2026-11-05, PR #1181, ผู้ตัดสิน kong)
- เลือกใช้ guard เดิม `requireWarehouseAccess` ไม่สร้าง permission config กลาง: ชุด SA/SM/WS/SC ตรงกับ `canAccessWarehouse` พอดี และเป็นชุดที่หน้าคลังอื่นใช้
- สิทธิ์ระดับปุ่มอยู่นอกขอบเขต (Out of scope ของ #845): "ทำได้ทุกอย่าง" ของ SA/SM/WS ในคำตัดสินของ PO หมายถึงสิทธิ์ระดับหน้า
- ชั้น `volatile`: เปลี่ยน UX gate ฝั่ง client (route guard + เมนู) เท่านั้น — ไม่แก้ `validate_doc_update`, `_security` หรือ BFF; การบังคับสิทธิ์เขียนใน CouchDB ยังเป็นของ CR-235

## 5. Impact

- `frontend/src/routes/(protected)/back-office/sop-parameters/+page.ts` — `requireAuth` → `requireWarehouseAccess`
- `frontend/src/lib/components/backoffice-navbar/static.ts` — เมนู "พารามิเตอร์" เพิ่ม `visibleTo: ({ roles, shelterCode }) => canAccessWarehouse(roles, shelterCode)`
- `frontend/src/lib/components/backoffice-navbar/static.guards.test.ts` — เพิ่ม `'/back-office/sop-parameters': requireWarehouseAccess` ใน `GUARDS` และเอาออกจาก `EXEMPT` (คงเฉพาะ `/back-office/dailysop`)
- `docs/prd/role-permission-matrix.md` §3 — แถวใหม่ + decision sync note (หลัง CR approve)
- e2e: เพิ่มแถวในตารางสิทธิ์ของ #841 (`distribution_staff` เปิด `/back-office/sop-parameters` แล้วถูก redirect; SM/WS/SC เข้าได้)
- ผลต่อผู้ใช้ที่มีอยู่: บัญชีที่เคยเข้าหน้านี้ได้แต่ไม่อยู่ในชุด SA/SM/WS/SC จะเข้าไม่ได้หลัง deploy

## 6. Migration

N/A — ไม่เปลี่ยนรูป doc ที่ persist, ไม่ bump `schema_v`, ไม่ต้อง redeploy `_design/access`

## 7. Decision log

- 2026-11-05 — PO (Fishcanwalk) ตัด `/back-office/shelters/readiness` ออกจากขอบเขต #845 (บันทึกใน decision sync ของ role matrix แล้ว)
- 2026-11-16 — PO (Fishcanwalk) ตัดสินสิทธิ์: `/back-office/sop-parameters` = SA/SM/WS เข้าและทำได้, SC ดูอย่างเดียว, role อื่นเข้าไม่ได้; `/back-office/dailysop` = ทุก role คงเดิม — บันทึกคำตัดสินบน #845
- 2026-11-16 — proposed (ร่าง CR ตาม R1 ของ #845) · ค้างยืนยันว่า "ทำได้ทุกอย่าง" ของ SA/SM/WS = สิทธิ์ระดับหน้า (ถ้าต้องการให้ WS แก้ master หรือ `sop_override` ได้ ต้องเปิด CR แยกเพราะแก้ `validate_doc_update`)
- 2026-11-22 — approved (kong) → รันเลข CR-263 · ข้อ FR-4 (สิทธิ์ระดับหน้า ไม่ขยายสิทธิ์แก้) ใช้ตามที่ร่างไว้; ถ้าต้องการให้ WS แก้ master / `sop_override` ได้ เปิด CR แยก
- 2026-11-22 — เคาะ (kong, 2026-11-22) — `warehouse_staff` แก้ `sop_override` ได้ (master ยัง SA เท่านั้น) · **ไม่อยู่ในขอบเขต CR-263** (FR-4 คงเดิม = สิทธิ์ระดับหน้า) — track เป็น decision sync note ใน [CR-235](CR-235-warehouse-stock-parameter-access.md) Decision log; โค้ดแก้ `validate_doc_update` แยก PR
