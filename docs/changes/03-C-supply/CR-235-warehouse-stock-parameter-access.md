---
id: CR-235
title: เจ้าหน้าที่คลังแก้พารามิเตอร์สต็อกของศูนย์ (SHELTER_OVERRIDE) — เพิ่มสิทธิ์ warehouse_staff + บังคับที่ CouchDB
status: approved
date: 2026-11-05
updated: 2026-11-06
requested_by: GitHub #1189
decided_by: kong
layer: stable
affects:
  - docs/prd/role-permission-matrix.md §3 (เพิ่มแถว SOP Parameters — Stock Parameter Overrides)
  - docs/data/schema.md — ไม่เปลี่ยนรูป doc (ไม่แก้ field); schema_v — ไม่เปลี่ยน
  - frontend/src/lib/server/shelter-access-design.ts (`validate_doc_update` ของ shelter DB — เพิ่ม role gate 3 doc type + `sop_override`) — STABLE CORE (auth)
  - frontend/src/lib/auth/roles.ts (ฟังก์ชันสิทธิ์ pure ใหม่)
  - frontend/src/routes/(protected)/back-office/sop-parameters/+page.svelte
  - frontend/src/lib/features/sop-ratios (ui: `food-sphere-stock-tab.svelte` + sheet ตั้งค่าพารามิเตอร์)
---

# CR-235 — เจ้าหน้าที่คลังแก้พารามิเตอร์สต็อกของศูนย์ตน

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** `warehouse_staff` ของศูนย์ (นอกเหนือจาก `shelter_manager` / SA เดิม; `supply_coordinator` **ไม่ได้**)
>   สร้าง แก้ และปิด (deactivate) doc `SHELTER_OVERRIDE` 3 type ของศูนย์ตน:
>   `replenishment_policy`, `requirement_group`, `food_sphere_standard`
> - **ทำไม:** ปัจจุบันแก้ได้เฉพาะ SA / SM (UI: `canEditOverride`) เจ้าหน้าที่คลังที่ดูแลสต็อกจริงแก้ไม่ได้
>   และ `validate_doc_update` ของ shelter DB อนุญาต 3 type นี้ใน allowlist **โดยไม่เช็ก role** — กันไว้ที่ UI เท่านั้น
> - **Dev ต้อง build:** role gate ใน `validate_doc_update` (รวมการลบ `_deleted`), ฟังก์ชันสิทธิ์ pure ใน `roles.ts`, สิทธิ์รายแท็บใน sop-parameters,
>   ปุ่ม "ตั้งค่าพารามิเตอร์" + ปุ่มแก้รายกลุ่มในแท็บ "วิเคราะห์เสบียงอาหาร" (`/back-office/supply?tab=food-sphere`)
> - **ปิดช่อง `sop_override` ด้วย:** สิทธิ์คงเดิม (SA / SM ของศูนย์) แต่เพิ่ม role gate ที่ `validate_doc_update` — เดิมกันไว้ที่ UI เท่านั้น
> - **กระทบ:** role matrix §3, `_design/access` ของ **ทุก** shelter DB ต้อง redeploy. ไม่เปลี่ยนรูป doc, ไม่ bump `schema_v`
> - **ชั้น: STABLE CORE** — เพิ่ม role check ใน `validate_doc_update` (auth) · approved โดย kong 2026-11-06

---

## 1. Requirements

| ID   | Requirement                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1 | `{code}:warehouse_staff`, `{code}:shelter_manager` ของศูนย์ `{code}` และ SA สร้าง แก้ และปิด doc `SHELTER_OVERRIDE` ของ type `replenishment_policy`, `requirement_group`, `food_sphere_standard` ใน shelter DB ของศูนย์นั้นได้                                                                                                                                                                                  |
| FR-2 | Role อื่น (เช่น `supply_coordinator`, `kitchen_staff`, `donation_staff`, `distribution_staff`, `registration_staff`, อาสาสมัคร) และผู้ใช้ศูนย์อื่น เขียนหรือลบ doc 3 type นี้ใน shelter DB ไม่ได้ — `validate_doc_update` ตอบ `forbidden`. การลบ (`_deleted: true`) ไม่มี `type` ใน `newDoc` จึงต้องเช็ก `oldDoc.type` ด้วย แบบเดียวกับ gate ของ `recipe` (CR-217)                                              |
| FR-3 | `sop_override` (แท็บ Sphere standard / SOP ratio — ค่าน้ำ, kcal, สุขาภิบาล, สัดส่วนอาสา) **สิทธิ์เหมือนเดิม** คือ SA และ SM ของศูนย์เท่านั้น — WH ดูได้แต่สร้าง/แก้/ปิดไม่ได้ (รวมปุ่ม "สร้างค่าปรับแต่ง" ระดับหน้า). CR นี้ **เพิ่ม** role gate ของ `sop_override` ที่ `validate_doc_update` (SA/SM เท่านั้น, รวม `_deleted` ตาม FR-2) — เดิมกันไว้ที่ UI เท่านั้น. doc audit ที่เขียนคู่กันไม่อยู่ใน gate นี้ |
| FR-4 | ค่ามาตรฐานกลาง (master, DB `catalog`, `source: SPHERE_BASELINE`) แก้ได้เฉพาะ SA เหมือนเดิม — CR นี้ไม่แตะ                                                                                                                                                                                                                                                                                                       |
| FR-5 | UI แยกสิทธิ์รายแท็บ: แท็บ `sop_override` ใช้สิทธิ์เดิม (SA/SM); แท็บ 3 type ข้างต้นใช้สิทธิ์ใหม่ (SA/SM/WH ของศูนย์). ตรรกะสิทธิ์เป็นฟังก์ชัน pure ใน `$lib/auth/roles.ts` ไม่คำนวณใน component                                                                                                                                                                                                                 |
| FR-6 | แท็บ "วิเคราะห์เสบียงอาหาร" ใน `/back-office/supply?tab=food-sphere` มีปุ่ม "ตั้งค่าพารามิเตอร์" (เปิด sheet 3 แท็บย่อย reuse component แท็บเดิม) และปุ่มแก้รายกลุ่ม (เปิดฟอร์ม requirement group + replenishment policy ของกลุ่มนั้น) — ผู้ไม่มีสิทธิ์ไม่เห็นปุ่ม (UX เท่านั้น การบังคับจริงอยู่ที่ FR-2)                                                                                                      |
| FR-7 | ศูนย์ที่ยังไม่มีค่าปรับแต่งของ 3 type: WH สร้าง override ทีละรายการจากปุ่ม "เพิ่มกลุ่มความต้องการ" / "เพิ่มนโยบาย" / "เพิ่มเกณฑ์โภชนาการ" ในแท็บนั้น (ฟอร์มเขียน doc `source: SHELTER_OVERRIDE` ลง shelter DB ผ่าน session ของผู้ใช้ — ผ่าน gate ตาม FR-1). ปุ่ม "สร้างค่าปรับแต่ง" ระดับหน้า (`createInitialOverride`) สร้าง `sop_override` และยังเป็น SA/SM ตาม FR-3                                          |
| FR-8 | หลังบันทึก invalidate query (`useRequirementGroups`, `useReplenishmentPolicies`, `useFoodSphereStandards`) ให้ตารางวิเคราะห์คำนวณใหม่ทันที และแจ้งผลด้วย toast                                                                                                                                                                                                                                                  |
| FR-9 | `_admin` (CouchDB server admin) ยัง bypass `validate_doc_update` ตามเดิม (provisioning / seed)                                                                                                                                                                                                                                                                                                                  |

## 2. Acceptance

- **AC-1** `warehouse_staff` / `shelter_manager` ของ SH001 เขียน (สร้าง/แก้/ตั้ง `status` inactive) doc 3 type ใน `shelter_sh001` ได้; SA ได้
- **AC-2** `supply_coordinator`, `kitchen_staff`, `donation_staff`, `registration_staff` ของ SH001 เขียนหรือลบ (`_deleted`) doc 3 type ตรงผ่าน `/couch` → `forbidden`; `warehouse_staff` ของ SH002 เขียนลง `shelter_sh001` → ไม่ผ่าน (ไม่มี scope ของศูนย์นั้น)
- **AC-3** UI: `warehouse_staff` ไม่เห็นปุ่มแก้/สร้าง/ปิดของแท็บ `sop_override` และปุ่ม "สร้างค่าปรับแต่ง" ระดับหน้า เหมือนเดิม; master (`catalog`) ยังแก้ได้เฉพาะ SA. ฝั่ง CouchDB: `warehouse_staff` / `supply_coordinator` / `kitchen_staff` เขียนหรือลบ `sop_override` ตรงผ่าน `/couch` → `forbidden`; SM ของศูนย์และ SA ผ่าน
- **AC-4** domain/unit: ฟังก์ชันสิทธิ์ pure ใน `roles.ts` — own shelter WH/SM ได้, ศูนย์อื่น/`supply_coordinator`/`kitchen_staff` ไม่ได้, SA ได้, WH แก้ `sop_override` ไม่ได้
- **AC-5** unit test ของ `buildValidateDocUpdate` (เช่น `shelter-access-design.test.ts`) ครอบ 3 type: WH/SM/SA ผ่าน, `supply_coordinator`/`kitchen_staff`/volunteer ถูก forbidden; ครอบ `sop_override`: SM/SA ผ่าน, WH/SC/KS ถูก forbidden; ทุกเคสมีทั้ง write และ `_deleted`
- **AC-6** flow สร้าง override ครั้งแรกและ seed เดิมยังทำงาน (ดู §4)
- **AC-7** หลังบันทึกจากแท็บ "วิเคราะห์เสบียงอาหาร" ตารางอัปเดตทันทีโดยไม่ต้องรีเฟรช

## 3. Spec delta — `docs/prd/role-permission-matrix.md` §3

เพิ่มแถว (ผู้เขียน SHELTER_OVERRIDE ของพารามิเตอร์สต็อก):

| หมวดงาน / เอกสาร                       | การกระทำ (Action)                                                                                                                                                                                       | SA  |  SM   | REG | TRG | MED | KS  | SC  | DON | VC  | SO  | FAC |
| :------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-: | :---: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **Stock Parameter Overrides** (CR-235) | สร้าง/แก้/ปิด `SHELTER_OVERRIDE` ของ `replenishment_policy`, `requirement_group`, `food_sphere_standard` ของศูนย์ตน (บังคับที่ `validate_doc_update` ของ shelter DB) · `sop_override` และ master คงเดิม |  ✓  | scope |  —  |  —  |  —  |  —  | WS  |  —  |  —  |  —  |  —  |

- `WS` ในคอลัมน์ SC = เฉพาะ `{code}:warehouse_staff`; `supply_coordinator` ไม่มีสิทธิ์ (เหมือน CR-204 / CR-230)
- `sop_override` (แท็บ Sphere standard): SA / SM ของศูนย์เท่านั้น — คงเดิม แต่บังคับที่ `validate_doc_update` ด้วย; master: SA เท่านั้น — คงเดิม

## 4. Impact

### 4.1 ใครเขียน doc 3 type นี้ในปัจจุบัน และด้วย credential อะไร (ผลสืบสวน)

| ผู้เขียน                                                                                                                                                            | เขียนที่ไหน                    | Credential                                     | ผ่าน `validate_doc_update` ของ shelter DB?           | ผลกระทบจาก CR นี้                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| UI แท็บ/ฟอร์ม sop-ratios (`requirement-group.remote.ts`, `replenishment-policy.remote.ts`, `food-sphere.remote.ts`) ผ่าน `createRemoteRepository('shelter_<code>')` | shelter DB (override)          | cookie `_session` ของผู้ใช้ผ่าน proxy `/couch` | **ใช่**                                              | โดน gate ใหม่ — เป็นเป้าหมายของ CR นี้                  |
| UI เดียวกันเมื่อ `source` ไม่ใช่ override                                                                                                                           | DB `catalog` (master)          | `_session` ของ SA                              | ไม่ (คนละ DB; catalog มี `_design/access` ของตัวเอง) | ไม่กระทบ                                                |
| `scripts/seed/master-seed.ts` (`pnpm seed:master`)                                                                                                                  | DB `catalog` / master เท่านั้น | admin (`COUCHDB_ADMIN_URL`)                    | ไม่ (admin bypass + คนละ DB)                         | ไม่กระทบ                                                |
| `scripts/sync-central-db.ts` (`pnpm sync:central`)                                                                                                                  | DB `catalog` (+ design)        | admin                                          | ไม่ (ไม่แตะ shelter DB)                              | ไม่กระทบ                                                |
| Provisioner / seed ของ shelter DB (`provisioner.ts`, staging seed)                                                                                                  | shelter DB                     | admin                                          | ไม่ (admin bypass — FR-9)                            | ไม่กระทบ; ไม่พบ writer ที่เขียน 3 type นี้ลง shelter DB |
| Worker (`worker/`)                                                                                                                                                  | อ่านผ่าน projection เท่านั้น   | —                                              | —                                                    | ไม่กระทบ                                                |

ข้อสรุป: ไม่พบ flow ที่เขียน 3 type นี้ลง shelter DB ด้วย session ของ role นอกเหนือชุดใหม่ และ flow ที่ใช้ admin ข้าม `validate_doc_update` อยู่แล้ว
(ผู้ใช้ที่สร้าง override ครั้งแรกคือ SA/SM/WH ซึ่งผ่าน gate ใหม่). Dev ต้องยืนยันซ้ำด้วย test ว่า flow สร้าง override เดิมและ seed ยังผ่าน (AC-6).
`sop_override` เขียนลง shelter DB จาก flow "สร้างค่าปรับแต่ง" / แก้เวอร์ชัน (`use-create-version.ts`, `sop-ratio.remote.ts`) ผ่าน session ของ SA/SM เท่านั้นตาม UI ปัจจุบัน — gate ใหม่จึงไม่ทำให้ flow เดิมพัง

### 4.2 Docs / Code / Ops

- **Docs:** `docs/prd/role-permission-matrix.md` §3 (แถวใหม่ + note)
- **Code:** `shelter-access-design.ts` (gate ใหม่ของ 3 type และ `sop_override` ทั้ง write และ `_deleted` — pattern เดียวกับ `canWriteRecipe`, CR-217), `roles.ts`, หน้า sop-parameters, feature `sop-ratios`
- **Tests:** unit `roles.test.ts`, `shelter-access-design.test.ts`; unit/DOM ของ UI ตามสมควร
- **Ops (บังคับ):** `validate_doc_update` เปลี่ยน → ต้อง redeploy `_design/access` ไปทุก shelter DB ตามขั้นตอนเดิม
  (`redeployShelterAccessDesign` / `pnpm redeploy:access`; admin endpoint เปรียบเทียบ string แล้ว PUT เมื่อต่าง — ไม่มี version marker ให้ bump).
  ถ้าไม่ redeploy ศูนย์เดิมจะยังไม่มี gate ฝั่ง CouchDB (UI อย่างเดียว)
- **Stable-core review:** gate อยู่ใน `validate_doc_update` (auth) — kong review และ approve 2026-11-06

## 5. Migration

N/A — ไม่เปลี่ยนรูป doc ที่ persist, ไม่ bump `schema_v`. doc override เดิมที่เขียนไว้แล้วไม่ถูกแก้. เขียนทับ/ลบ doc ที่มีอยู่ ต้องผ่าน gate ใหม่ตามปกติ

## 6. Out of scope

- เปลี่ยนสิทธิ์ของ `sop_override` (SOP ratio) และ master — คงเดิม (CR นี้แค่เพิ่ม gate ของ `sop_override` ที่ CouchDB ให้ตรงสิทธิ์เดิม)
- เปลี่ยน field/enum/รูป doc ของ 3 type
- เพิ่ม role gate ให้ DB `catalog`
- ให้ WH แก้ค่ามาตรฐานกลาง
- ให้ `supply_coordinator` แก้พารามิเตอร์สต็อก

## Why

- เจ้าหน้าที่คลังเป็นผู้รู้ค่า min/max/กลุ่มคำนวณจริง แต่ต้องออกจากหน้า supply ไปให้ SM/SA แก้
- ปัจจุบันไม่มี enforcement ที่ CouchDB — role ใดที่มีสิทธิ์เขียน shelter DB เขียน 3 type นี้และ `sop_override` ตรงผ่าน `/couch` ได้; CR นี้ปิดช่องนั้นพร้อมขยายสิทธิ์ให้ตรงงานจริง

## Decision log

- 2026-11-05 — proposed (GitHub #1189)
- 2026-11-06 — เคาะ (kong, 2026-11-06) — approved; สิทธิ์เฉพาะ `warehouse_staff` (+ SM/SA), ตัด `supply_coordinator` ออก; track ด้วย CR ไฟล์
- 2026-11-06 — เคาะ (kong, 2026-11-06) — `sop_override` สิทธิ์คง SA/SM แต่เพิ่ม gate ที่ `validate_doc_update`; gate ทุก type ครอบการลบ `_deleted` (เช็ก `oldDoc.type`); FR-7 ระบุปุ่ม "เพิ่ม…" ในแท็บ ไม่ใช่ "สร้างค่าปรับแต่ง" ระดับหน้า (review PR #1198)
