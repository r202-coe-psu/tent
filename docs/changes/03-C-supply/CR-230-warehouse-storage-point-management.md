---
id: CR-230
title: จัดการจุดเก็บของ (sub_storage) จากหน้า supply — เพิ่มสิทธิ์ warehouse_staff
status: approved
date: 2026-11-05
updated: 2026-11-06
requested_by: GitHub #1186
decided_by: kong
layer: volatile
affects:
  - docs/changes/00-baseline/CR-139-shelter-storage-points.md §Open decisions N2 (amend — เดิมอนุญาตลบจุดที่ยังมีของ → บล็อกเมื่อมี lot คงเหลือ)
  - docs/prd/role-permission-matrix.md §3 (เพิ่มแถว Shelter Storage Points)
  - docs/data/schema.md §3.1 `common_areas.sub_storage[]` (ไม่เปลี่ยนรูป doc — เพิ่มผู้เขียนผ่าน endpoint เฉพาะ)
  - schema_v — ไม่เปลี่ยน
  - frontend/src/routes/api/back-office/shelter/[code]/storage-points/+server.ts (ใหม่)
  - frontend/src/lib/features/shelters (domain: นับ lot ที่ยังอ้างจุด; data: remote adapter; application: mutation hooks)
  - frontend/src/lib/features/operations (หน้า "จัดการคลัง" ใน /back-office/supply)
  - frontend/src/routes/(protected)/back-office/supply
  - frontend/src/routes/(protected)/back-office/shelters/edit (ฟอร์มศูนย์ — ปุ่มลบจุดใช้กติกา FR-6 เดียวกัน)
---

# CR-230 — เจ้าหน้าที่คลังจัดการจุดเก็บของ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** `warehouse_staff` ของศูนย์ (นอกเหนือจาก `shelter_manager` / SA เดิม)
>   เพิ่ม แก้ ลบ `shelter.common_areas.sub_storage[]` ของศูนย์ตนได้ ผ่าน endpoint เฉพาะที่แตะ `sub_storage` อย่างเดียว
> - **ทำไม:** ปัจจุบันแก้ได้ทางเดียวคือฟอร์มศูนย์ (SM/SA เท่านั้น) เจ้าหน้าที่คลังที่ใช้ supply ทุกวันเพิ่มคลังเองไม่ได้
> - **Dev ต้อง build:** endpoint `storage-points`, หน้า "จัดการคลัง" ใน `/back-office/supply`, ฟังก์ชันนับ lot ที่ยังอ้างจุดก่อนลบ, ปุ่มลบจุดในฟอร์มศูนย์ที่ใช้ฟังก์ชันเดียวกัน (disabled เมื่อยังมีของ)
> - **กระทบ:** role matrix §3 และ **amend CR-139 N2** (เดิมลบจุดที่ยังมีของได้ → ลบไม่ได้ ทั้ง endpoint ใหม่และฟอร์มศูนย์). ไม่เปลี่ยนรูป doc, ไม่ bump `schema_v`

---

## 1. Requirements

| ID    | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1  | `{code}:warehouse_staff`, `{code}:shelter_manager` ของศูนย์ `{code}` และ SA เพิ่ม แก้ ลบ `common_areas.sub_storage[]` ของศูนย์นั้นได้ — ศูนย์อื่นและ role อื่น (เช่น `supply_coordinator`, `kitchen_staff`, `donation_staff`) ทำไม่ได้                                                                                                                                                                                                                                          |
| FR-2  | การเขียนผ่าน endpoint เฉพาะ `/api/back-office/shelter/[code]/storage-points` ที่แก้ได้เฉพาะ `common_areas.sub_storage` — field อื่นของ shelter doc ที่ถูกส่งมาใน body ต้องถูกเพิกเฉย (ไม่เปลี่ยนค่า)                                                                                                                                                                                                                                                                            |
| FR-3  | Guard ฝั่งเซิร์ฟเวอร์ตรวจ role + shelter scope จาก session cookie; `{code}` จาก path ต้องตรงกับ scope ของผู้เรียก (SA ผ่านทุกศูนย์). ไม่ผ่าน → 403                                                                                                                                                                                                                                                                                                                              |
| FR-4  | `id` ของจุดใหม่ออกโดยเซิร์ฟเวอร์เป็น ULID (รูปแบบเดียวกับ `addPoint` ในฟอร์มศูนย์); `id` ใน body ของการเพิ่มถูกเพิกเฉย และ `id` ของจุดเดิมแก้ไม่ได้                                                                                                                                                                                                                                                                                                                             |
| FR-5  | Field ของจุดและ validation ใช้ชุดเดียวกับ `subStorageItemSchema` ของ feature `shelters` (`name`, `types[]`, `area_m2`, `accepts_donations`, `lat`/`lng`, `location_note`) — ไม่สร้างกติกาชุดใหม่                                                                                                                                                                                                                                                                                |
| FR-6  | **Amend CR-139 N2** — ลบจุดได้เมื่อไม่มี lot คงเหลือ (qty > 0) ที่ `lot.storage_point_id` ชี้มาที่จุดนั้น; ถ้ายังมี → เซิร์ฟเวอร์ตอบ 409 พร้อมจำนวน lot ที่ยังมีของ และไม่ลบ · กติกานี้ใช้กับการลบจุดจากฟอร์มศูนย์ด้วย (ดู FR-11) · **ไม่นับ** `bulk_return_pool.location_storage_point_id` — เป็นแค่ตำแหน่งกอง (กรองคิว) ไม่ใช่ที่เก็บสต็อก; ที่เก็บจริงกำหนดตอนรับ (`received_storage_point_id` / `lot.storage_point_id`) และกองเก็บชื่อ snapshot `location_storage_zone` ไว้ |
| FR-7  | เขียนด้วย `_rev` ของ shelter doc ที่ client อ่านมา; `_rev` ไม่ตรง (มีผู้แก้ฟอร์มศูนย์พร้อมกัน) → 409 ให้ UI โหลดใหม่ ไม่ merge เงียบ                                                                                                                                                                                                                                                                                                                                            |
| FR-8  | UI: หน้า "จัดการคลัง" ใน `/back-office/supply` แสดง "คลังหลัก" (ไม่มี point id) เป็นแถวคงที่ แก้/ลบไม่ได้; ปุ่มลบ disabled พร้อมจำนวน lot ที่ยังมีของเมื่อ FR-6 ไม่ผ่าน; ยืนยันก่อนลบ; แจ้งผลด้วย toast                                                                                                                                                                                                                                                                         |
| FR-9  | UI ซ่อน/ปิดการจัดการสำหรับ role ที่ไม่มีสิทธิ์ตาม FR-1 (UX เท่านั้น — การบังคับจริงอยู่ที่ FR-3)                                                                                                                                                                                                                                                                                                                                                                                |
| FR-10 | จุดที่เพิ่ม/แก้ปรากฏใน `useStoragePoints` ทุก consumer เดิมโดยไม่ต้องแก้ consumer; การเปลี่ยนชื่อไม่กระทบ ledger เดิม เพราะ `lot.storage_zone` เก็บชื่อ snapshot                                                                                                                                                                                                                                                                                                                |
| FR-11 | ฟอร์มศูนย์ (`/back-office/shelters/edit`) ยังเพิ่ม/แก้ `sub_storage` ได้เหมือนเดิม (SM/SA) แต่ปุ่มลบจุดใช้ฟังก์ชัน domain เดียวกับ FR-6/AC-7 — disabled พร้อมจำนวน lot ที่ยังมีของ (บังคับฝั่ง UI เท่านั้น เพราะฟอร์มเขียน shelter doc ตรง; ด่าน 409 ฝั่งเซิร์ฟเวอร์มีเฉพาะ endpoint ใหม่)                                                                                                                                                                                      |

## 2. Acceptance

- **AC-1** `warehouse_staff` ของ SH001 เพิ่ม แก้ ลบจุดของ SH001 ผ่าน endpoint ได้ (2xx); `shelter_manager` ของ SH001 ทำได้เช่นกัน
- **AC-2** `warehouse_staff` ของ SH002 เรียก endpoint ของ SH001 → 403; `supply_coordinator` และ `kitchen_staff` ของ SH001 → 403
- **AC-3** body ที่มี field อื่นของ shelter (เช่น `name`, `capacity`, `operation_status`) → field เหล่านั้นไม่เปลี่ยนใน doc
- **AC-4** ลบจุดที่ยังมี lot คงเหลือ (qty > 0) → 409; หลังย้าย/ใช้ของหมดแล้วลบได้
- **AC-5** ส่ง `_rev` เก่า → 409; doc ไม่ถูกเปลี่ยน
- **AC-6** จุดที่เพิ่มใหม่ขึ้นในฟอร์มรับของเข้าและ filter ตารางคลังทันที
- **AC-7** domain: ฟังก์ชันรับ storage point id + lot balances คืนจำนวน lot ที่ยังมีของ (0 = ลบได้) — unit test
- **AC-8** ฟอร์มศูนย์: ปุ่มลบจุดที่ยังมี lot คงเหลือ (qty > 0) disabled พร้อมจำนวน lot; จุดที่ไม่มีของลบได้ (กติกาเดียวกับ AC-4)

## 3. Spec delta — `docs/prd/role-permission-matrix.md` §3

เพิ่มแถว (ผู้เขียน `sub_storage` ต่อ role):

| หมวดงาน / เอกสาร                    | การกระทำ (Action)                                                              | SA  |  SM   | REG | TRG | MED | KS  | SC  | DON | VC  | SO  | FAC |
| :---------------------------------- | :----------------------------------------------------------------------------- | :-: | :---: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **Shelter Storage Points** (CR นี้) | เพิ่ม/แก้/ลบจุดเก็บของ (`sub_storage`) ของศูนย์ตนจากหน้า supply หรือฟอร์มศูนย์ |  ✓  | scope |  —  |  —  |  —  |  —  | WS  |  —  |  —  |  —  |  —  |

- `WS` ในคอลัมน์ SC = เฉพาะ `{code}:warehouse_staff`; `supply_coordinator` จัดการจุดเก็บของไม่ได้ (รูปแบบเดียวกับแถว Stock Distribution, CR-204)
- สิทธิ์เดิม: การแก้ฟอร์มศูนย์ทั้งฉบับ (field อื่นทั้งหมด) ยังเป็น SM/SA เท่านั้น — CR นี้ให้เฉพาะ `sub_storage`

## 4. Impact

- **Docs:** `docs/prd/role-permission-matrix.md` §3 (แถวใหม่ + note); `CR-139` N2 (เพิ่มหมายเหตุ amend)
- **Code:** endpoint ใหม่ (guard ใหม่หรือ `requireShelterScopeOrSA` + ตรวจ capability), feature `shelters` (domain count, data, application), หน้า supply
- **Tests:** unit (นับ lot), integration `+server.ts` (FR-1 – FR-7); UI ฟอร์มศูนย์ปุ่มลบ (AC-8)
- **Ops:** ไม่ต้อง redeploy `_design/*` — การเขียนผ่าน server route ด้วย admin credential เดิม

## 5. Migration

N/A — ไม่เปลี่ยนรูป doc ที่ persist, ไม่ bump `schema_v` (shelter คง schema_v 9)

## 6. Out of scope

- คลังกลางแยกจากศูนย์ (เช่น `warehouse:main` ใน ticket)
- เพิ่มคลังจาก dropdown ในฟอร์มรับของเข้า
- ย้ายของระหว่างคลัง (ใช้ flow เดิม)
- เปิดสิทธิ์แก้ field อื่นของ shelter doc ให้ role นอกเหนือ SM/SA

## Why

- เจ้าหน้าที่คลังใช้หน้า supply ทุกวันแต่เพิ่มจุดเก็บของเองไม่ได้ ต้องรอ SM/SA เข้าฟอร์มศูนย์
- แยก endpoint ให้แตะเฉพาะ `sub_storage` เพื่อไม่ขยายสิทธิ์แก้ shelter doc ทั้งฉบับ

## Decision log

- 2026-11-05 — proposed (GitHub #1186)
- 2026-11-06 — เคาะ (kong, 2026-11-06) — approved; สิทธิ์เฉพาะ `warehouse_staff` (+ SM/SA), `supply_coordinator` ไม่มีสิทธิ์; track ด้วย CR ไฟล์
- 2026-11-06 — เคาะ (kong, 2026-11-06) — FR-6 amend CR-139 N2: บล็อกลบจุดที่มี lot คงเหลือทั้งที่ endpoint ใหม่ (409) และฟอร์มศูนย์ (UI disabled)
- 2026-11-06 — เคาะ (kong, 2026-11-06) — FR-6 ไม่นับ `bulk_return_pool.location_storage_point_id` (ตำแหน่งกอง ไม่ใช่ที่เก็บสต็อก)
