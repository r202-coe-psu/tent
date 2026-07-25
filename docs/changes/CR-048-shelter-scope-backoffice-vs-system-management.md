---
id: CR-047
title: Back-office shelter list scoped to own shelter · master data split global (system management) vs shelter-effective (back-office)
status: proposed
date: 2026-07-25
requested_by: project owner (saktanuthpeak)
decided_by: project owner
layer: volatile
affects:
  - docs/prd/role-permission-matrix.md §3 (FR-27 catalog note pattern), §7.1 (scope rule)
  - docs/data/schema.md §3.3 (master_data — reconcile schema_v 2 shape, shelter_code, excluded_codes; not yet documented)
  - frontend/src/routes/(protected)/back-office/shelters/+page.svelte
  - frontend/src/routes/(protected)/portal/system-management/shelters/+page.svelte
  - frontend/src/routes/(protected)/portal/system-management/shelters/+page.ts
  - frontend/src/lib/features/master-data/ui/master-data-config-page.svelte
  - frontend/src/routes/(protected)/back-office/{registration-config,shelter-config,household-master-data}/+page.svelte
  - frontend/src/routes/(protected)/portal/system-management/{registration-config,shelter-config,household-master-data}/+page.svelte
---

# CR-047 — Shelter list scope split (back-office vs system management) + master data global/effective split

## สรุป (TL;DR)

Back-office `/back-office/shelters` แสดงเฉพาะ shelter ที่ staff คนนั้นถือ (`shelter_id`) แทนรายการทั้งระบบ;
รายการ shelter ทั้งหมด (ข้ามศูนย์) ย้ายไปอยู่ที่ `system-management` (SA only) แทน. Master data ที่
back-office อ่านต้องเป็น **effective view** (global + shelter-local ของศูนย์ตน, ลบ `excluded_codes`) —
เขียนได้เฉพาะ shelter-local doc; system-management อ่าน/เขียนเฉพาะ **global doc** เท่านั้น. งานนี้
**implement แล้วในโค้ดบน branch `feat-system-management`** — CR นี้ทำหน้าที่ ratify + reconcile เอกสารที่
ยังไม่ตามทัน (role-permission-matrix ไม่มี master_data scope rule, schema.md §3.3 ไม่มี shelter_code/
excluded_codes/schema_v 2).

---

## Why

Feature "System Management" เป็น area ใหม่ (menu แยกจาก back-office) ที่รวมงาน SA-only ข้ามศูนย์
(shelter registry, master data ระดับ global, announcements, host houses). ระหว่าง implement เกิด 2
การเปลี่ยนแปลงที่กระทบ **role/permission** และ **business rule การมองเห็นข้อมูล** ตรงตาม
[change-management.md](../change-management.md) §2 (ข้อ 2 "เปลี่ยน business rule/invariant" + ข้อ 4
"เปลี่ยน role/permission"):

1. เดิม `/back-office/shelters` (requireAdmin) แสดงรายการ shelter ทั้งระบบ — ทับซ้อนกับสิ่งที่ควรเป็น
   SA-only cross-shelter view; back-office ควรเป็น per-shelter workspace ตาม norm ของ layer อื่นทั้งหมด
   (dashboard, kitchen, referral ฯลฯ ที่ scope ด้วย `shelter_id` อยู่แล้ว — role-permission-matrix.md §7.1)
2. Master data (`master_data` doc type, CR-012/CR-019) เดิมเป็น global-only, SA-write. งานนี้เพิ่มชั้น
   "shelter-local override/addition" (`shelter_code`, `excluded_codes`, `schema_v: 2`) ที่ยังไม่เคยผ่าน
   CR — ต้อง reconcile schema.md ให้ตรงกับโค้ดจริง (เหมือน pattern CR-028/CR-031)

ไม่ทำ CR นี้ = spec (role-permission-matrix, schema.md) ไม่ตรงกับพฤติกรรมจริงของระบบ ผิดกฎเหล็กของ
change-management.md ("ห้ามแก้ spec แบบเงียบๆ" — ในที่นี้คือ "ห้ามให้ code เปลี่ยน behavior ที่กระทบ
scope/permission โดยไม่มี CR ตาม")

---

## Change

### Before → After

| เรื่อง | Before | After |
| --- | --- | --- |
| `/back-office/shelters` | แสดง shelter ทั้งหมดในระบบ (SA only, `requireAdmin`) | แสดงเฉพาะ shelter ที่ user ถือ (`shelterStore.selectedShelterCode` ?? `getShelterCode()`) — 1 shelter card |
| รายการ shelter ทั้งระบบ | อยู่ที่ `/back-office/shelters` | ย้ายไปที่ `/portal/system-management/shelters` (SA only, `requireAdmin`, `useShelters()` ทั้งหมด + pagination) |
| Master data ที่ back-office อ่าน | global doc เดียว (`master_data:{type}`) | **effective view**: global items + shelter-local items (`master_data:{type}:{shelter_code}`) รวมกัน ลบรายการที่อยู่ใน global `excluded_codes`; เขียน (add/edit/delete) ลง shelter-local doc เท่านั้น |
| Master data ที่ system-management อ่าน/เขียน | — (ยังไม่มี area นี้) | global doc เท่านั้น (`scope: "global"`, ไม่มี `shelterCode`) — SA เป็นคนดูแล canonical list ข้ามศูนย์ |
| `master_data` doc shape | 1 doc/type, ไม่มี shelter variant (schema.md §3.3 ปัจจุบัน) | เพิ่ม optional `shelter_code` (ทำให้ `_id = master_data:{type}:{shelter_code}`), เพิ่ม `excluded_codes: string[]` (เฉพาะ global doc — ซ่อน global item รายตัวจาก effective view ของศูนย์ที่ระบุ — **ต้องยืนยัน**: ปัจจุบัน field นี้อยู่ระดับ global doc หรือ shelter-local doc, ดู Decision log), `schema_v: 1 \| 2` |

### Requirements

| ID | Requirement |
| --- | --- |
| FR-047-1 | `/back-office/shelters` ต้องแสดงเฉพาะ shelter ที่ user session ถือ `shelter_id`/`shelter_code` ตรงกันเท่านั้น — ไม่มี list ข้ามศูนย์ |
| FR-047-2 | `/portal/system-management/shelters` ต้องแสดง shelter ทั้งหมดในระบบ, guard `requireAdmin` (SA only) |
| FR-047-3 | Master data config page ฝั่ง back-office (`registration-config`, `shelter-config`, `household-master-data`) ต้อง query ด้วย `scope: "effective"` (merge global + shelter-local ของศูนย์ที่ session ถืออยู่, ลบ excluded codes) และเขียน (`writeContext`) ลง shelter-local doc เท่านั้น (`scope: "global"` สำหรับ write ก็เขียนเป็น shelter override เพราะ effective read คู่กับ global write ถูกแปลงเป็น shelter scope ใน `writeContext` ของ `master-data-config-page.svelte` — **ต้องยืนยันพฤติกรรมนี้กับโค้ดจริงก่อนปิด CR**, ดู Decision log) |
| FR-047-4 | Master data config page ฝั่ง system-management ต้อง query/เขียนด้วย `scope: "global"` เท่านั้น — ไม่รับ/ไม่ query shelter-local doc |
| FR-047-5 | staff ที่ไม่ใช่ SA (SM/REG/KS/WS) ต้อง**ไม่**เข้าถึง `/portal/system-management/*` ได้ (SA only ทั้ง area) — ต้องยืนยัน guard ที่ layout ระดับ `system-management/+layout.ts` (ปัจจุบันเป็น `requireAuth` เฉยๆ — **ช่องโหว่ที่ต้องปิด**, ดู Decision log) |
| FR-047-6 | `docs/data/schema.md` §3.3 ต้องอัปเดตให้ตรงกับ shape จริง: `shelter_code?: string`, `excluded_codes?: string[]`, `schema_v: 1 \| 2`, พร้อมอธิบาย `_id` pattern ที่มี shelter variant และความหมายของ scope `global \| shelter \| effective` |
| FR-047-7 | `docs/prd/role-permission-matrix.md` ต้องมีแถว/หมายเหตุใหม่สำหรับ master data scope: global master data = SA only (เดิมมีอยู่แล้ว, FR-27 pattern); shelter-local master data (effective view) = SA + SM (write scope ตน) |

---

## Impact

| ไฟล์/เอกสาร | ผลกระทบ |
| --- | --- |
| `docs/prd/role-permission-matrix.md` | เพิ่มแถว/หมายเหตุ shelter-local master data scope (FR-047-7); ยืนยัน §7.1 ครอบ shelter list ด้วย |
| `docs/data/schema.md §3.3` | เพิ่ม `shelter_code`, `excluded_codes`, `schema_v 2` shape ที่ขาดหายไป (ไม่ใช่ field ใหม่ — โค้ด implement แล้ว, เอกสารตามไม่ทัน) |
| `frontend/src/routes/(protected)/back-office/shelters/+page.svelte` | มีอยู่แล้ว (own-shelter only) — ไม่ต้องแก้โค้ด เว้นแต่ verify เท่านั้น |
| `frontend/src/routes/(protected)/portal/system-management/shelters/{+page.svelte,+page.ts}` | มีอยู่แล้ว (all shelters, requireAdmin) — ไม่ต้องแก้โค้ด เว้นแต่ verify เท่านั้น |
| `frontend/src/lib/features/master-data/ui/master-data-config-page.svelte` | มีอยู่แล้ว (`scope` prop, effective merge) — verify write-context behavior ตาม FR-047-3 |
| `frontend/src/routes/(protected)/portal/system-management/+layout.ts` | อาจต้องเปลี่ยนจาก `requireAuth` → `requireAdmin` ถ้ายืนยัน FR-047-5 ว่าเป็นช่องโหว่จริง |

---

## Migration

ไม่ bump `schema_v` เพิ่ม (ของเดิมมี `schema_v: 1 | 2` อยู่แล้วในโค้ด — CR นี้แค่ backfill เอกสารให้ตรง
โค้ด ไม่ได้เปลี่ยน shape เพิ่ม). ไม่มี migration script — dev DB เท่านั้น ไม่มี production data (ตาม
pattern CR-019/CR-031).

---

## Decision log

- 2026-07-25 — proposed. เปิดเป็น CR ไฟล์เต็มตามที่เจ้าของโครงการเลือก (track ใน `docs/changes/`)
- 2026-07-25 — พบว่า behavior หลักถูก implement ไปแล้วบน branch `feat-system-management` — CR นี้เป็น
  reconciliation (ratify code, sync spec) ไม่ใช่ new-build spec
- **[NEEDS DECISION]** FR-047-3: ต้องยืนยันกับโค้ด `master-data-config-page.svelte` ว่า write context
  ของ back-office (`scope: "shelter"` prop) เขียนลง shelter-local doc เสมอจริงหรือไม่ (ไม่ใช่ทับ global)
  ก่อน mark `approved`
- **[NEEDS DECISION]** FR-047-5: `system-management/+layout.ts` ปัจจุบันใช้ `requireAuth` (ไม่ใช่
  `requireAdmin`) — ต้องเช็คว่าตั้งใจปล่อยให้ per-page guard ทำหน้าที่แทน (เหมือน pattern
  `back-office/+layout.ts` ตาม CR-024) หรือเป็นช่องโหว่ที่ SM/staff เข้าถึง system-management routes
  ที่ยังไม่มี guard เฉพาะหน้าได้
