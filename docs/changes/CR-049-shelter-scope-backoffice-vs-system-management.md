---
id: CR-049
title: Shelter list scope split (back-office vs system management) + master data ULID-code two-tier (global read-only + shelter-local) + status soft-delete
status: proposed
date: 2026-07-25
requested_by: project owner (saktanuthpeak)
decided_by: project owner
layer: volatile
affects:
  - docs/prd/role-permission-matrix.md §3 (FR-27 pattern), §7.1 (scope rule)
  - docs/data/schema.md §3.3 (master_data — shelter_code, ULID item code, drop excluded_codes, add status; schema_v 2 → 3)
  - frontend/src/routes/(protected)/back-office/shelters/+page.svelte
  - frontend/src/routes/(protected)/portal/system-management/shelters/{+page.svelte,+page.ts}
  - frontend/src/lib/features/master-data/domain/master-data.ts (code = ULID; drop slugify + excluded_codes)
  - frontend/src/lib/server/master-data-server.ts (concat แทน merge/split; drop excluded_codes)
  - frontend/src/routes/api/back-office/master-data/[type]/+server.ts
  - frontend/src/routes/api/back-office/master-data/[type]/items/[code]/+server.ts
  - frontend/src/lib/features/master-data/ui/master-data-config-page.svelte + master-data-item-list.svelte
---

# CR-049 — Shelter list scope split + master data ULID two-tier (global read-only + shelter-local)

## สรุป (TL;DR)

แยกการมองเห็น 2 เรื่อง: (1) `/back-office/shelters` แสดงเฉพาะ shelter ของ staff คนนั้น, รายการข้ามศูนย์
ย้ายไป `/portal/system-management/shelters` (SA only). (2) `master_data` เปลี่ยนเป็น two-tier ที่
**item `code` = ULID เสมอ** (global กับ shelter-local จึง disjoint โดยอัตโนมัติ, ไม่ชน) → consumption
merge เหลือแค่ **concat** (ไม่ต้อง dedup/override), และ**ทิ้ง `excluded_codes` + override-merge**.
Back-office เห็น global (read-only) + shelter-local (แก้/toggle ได้); system-management ดูแล global เท่านั้น.
doc `_id` ยังเป็น deterministic (`master_data:{type}` / `master_data:{type}:{shelter_code}`).
(3) การ "ลบ" item เปลี่ยนเป็น **soft-delete** ผ่าน `status: active|inactive` — code ไม่หาย record ที่อ้าง
ไม่พัง; consumer กรอง `status: active` ตอน dropdown, ไม่กรองตอน display label.

---

## Why

Feature "System Management" เป็น area ใหม่ (SA-only, ข้ามศูนย์). ระหว่าง implement เกิดการเปลี่ยนแปลงที่
กระทบ **role/permission** และ **business rule การมองเห็นข้อมูล** ตรงตาม
[change-management.md](../change-management.md) §2 (เปลี่ยน business rule/invariant + เปลี่ยน role/permission):

1. `/back-office/shelters` เดิมแสดง shelter ทั้งระบบ — ควรเป็น per-shelter workspace เหมือน layer อื่น
   ที่ scope ด้วย `shelter_id` อยู่แล้ว (role-permission-matrix.md §7.1); การดูข้ามศูนย์เป็นสิทธิ์ SA
2. `master_data` (CR-012/CR-019) เดิม global-only. งานนี้เพิ่มชั้น shelter-local. การ implement รอบแรก
   เลือกวิธี **override-merge + `excluded_codes`** (shelter ทับ global ตาม code) ซึ่งสร้าง edge case:
   - **code collision ข้าม tier**: `code` มาจาก slugify(label); label ต่างศูนย์อาจได้ code ซ้ำ → record
     ที่ persist แล้ว (`evacuee.special_needs=[code]`) ชี้ item กำกวม
   - `excluded_codes` ผูกกับ global code → global ลบ item ทำเกิด dangling reference
   - ปุ่มลบ global ที่ back-office ต้อง disable รายเคส (คนละความหมายกับลบจริง)
3. ข้อเท็จจริงจากโค้ด: `slugifyAscii` คืน `''` สำหรับ label ที่ไม่มี ascii → label ภาษาไทย (ข้อมูลจริง
   เกือบทั้งหมด) **ตกไปเป็น `item_{ulid}` อยู่แล้ว**. การบังคับ **ULID เสมอ** จึงเป็นการ formalize
   พฤติกรรมที่มีอยู่ และ**ปิด edge case collision ถาวร** (ULID ชนไม่ได้ → global/shelter namespace
   disjoint → consumption แค่ concat, ไม่ต้อง dedup/override)

---

## Change

### Before → After

| เรื่อง | Before | After |
| --- | --- | --- |
| `/back-office/shelters` | shelter ทั้งระบบ (requireAdmin) | เฉพาะ shelter ที่ user ถือ (`shelterStore.selectedShelterCode` ?? `getShelterCode()`) — 1 card |
| shelter list ข้ามศูนย์ | อยู่ที่ back-office | ย้ายไป `/portal/system-management/shelters` (SA only, `requireAdmin`, `useShelters()` + pagination) |
| master data item `code` | slugify(label) → fallback ULID เมื่อไม่มี ascii | **ULID เสมอ** (`item_{ulid}`); ทิ้ง `slugifyLabel`/`slugifyAscii` |
| global ↔ shelter resolution | override-merge ตาม code (`mergeMasterDataItems` เทียบ field) + `excluded_codes` ซ่อน global item | **concat**: `global.items ++ shelterLocal.items` (code disjoint การันตี → ไม่มี override/ไม่มี dedup) |
| `master_data` doc shape | `shelter_code?`, `excluded_codes?`, item `{code,label,is_default,parent_code?}`, `schema_v 1\|2` | `shelter_code?` คงไว้; **ลบ `excluded_codes`**; **เพิ่ม item `status: 'active'\|'inactive'`** (default active); **`schema_v 2 → 3`** |
| การ "ลบ" item | hard delete — เอา item ออกจาก array (code หายจริง → record ที่อ้างพัง) | **soft-delete**: set `status: 'inactive'` (item คงอยู่ใน doc → code resolve ได้ตลอด); toggle กลับ active ได้ |
| consumption dropdown (เลือกค่าใหม่) | แสดงทุก item | กรอง `status === 'active'` เท่านั้น (inactive เลือกใหม่ไม่ได้ แต่ record เก่ายัง resolve label ได้) |
| back-office config (`registration-config`/`shelter-config`/`household-master-data`) | 1 list ผสม global+shelter, ปุ่มลบ global disable รายเคส | global = **read-only** (ดูได้ ไม่มีปุ่มแก้/toggle); shelter-local = แก้/toggle active ได้ |
| system-management config | — | global เท่านั้น (`scope: "global"`) — SA ดูแล canonical list |
| doc `_id` | `master_data:{type}` / `master_data:{type}:{shelter_code}` (deterministic) | **คงเดิม** — deterministic; ไม่เปลี่ยนเป็น ULID (กัน 2 docs/tier + idempotent re-seed) |

### Requirements

| ID | Requirement |
| --- | --- |
| FR-049-1 | `/back-office/shelters` แสดงเฉพาะ shelter ที่ session ถือ `shelter_code` ตรงกัน — ไม่มี list ข้ามศูนย์ |
| FR-049-2 | `/portal/system-management/shelters` แสดง shelter ทั้งหมด, guard `requireAdmin` (SA only) |
| FR-049-3 | master data item `code` ที่สร้างใหม่ต้องเป็น ULID (`item_{ulid}`) เสมอ — ไม่ derive จาก label |
| FR-049-4 | global กับ shelter-local ห้ามใช้ code เดียวกัน (การันตีโดย ULID); consumption (`scope: effective`) คืน `global.items ++ shelterLocal.items` แบบ concat — ไม่ dedup, ไม่ override |
| FR-049-5 | back-office config: global items = read-only (ไม่มีปุ่มแก้/toggle); shelter-local items = add/edit/toggle active ได้ (เขียนลง `master_data:{type}:{shelter_code}` เท่านั้น) |
| FR-049-6 | system-management config: query/เขียน `scope: "global"` เท่านั้น — ไม่แตะ shelter-local; SA toggle active/inactive ของ global item ได้ |
| FR-049-7 | ลบ `excluded_codes` ออกจาก domain schema, server, endpoints; ลบ `mergeMasterDataItems` override logic + `splitMasterDataItems` (แทนด้วย concat + source tag สำหรับ badge) |
| FR-049-11 | เพิ่ม item field `status: 'active' \| 'inactive'` (default `active`) ใน `masterDataItemSchema`; การลบ = set `inactive` (soft-delete) ไม่เอา item ออกจาก array |
| FR-049-12 | consumer ทุกตัวที่ทำ dropdown (household-form, evacuee-registration, evacuee-profile-health-card, admission-policy-section, basic-info-section, shelter-list, shelter-import) ต้องกรอง `status === 'active'` ตอนสร้าง options; ตอน **display/resolve label** ต้องไม่กรอง (คง `find(code)?.label ?? fallback`) |
| FR-049-8 | staff ที่ไม่ใช่ SA ต้องเข้า `/portal/system-management/*` ไม่ได้ — `system-management/+layout.ts` ใช้ `requireAdmin` (guard ทั้ง area ที่ layout) |
| FR-049-9 | `docs/data/schema.md §3.3` อัปเดตให้ตรง: `code` = ULID, `shelter_code?`, ลบ `excluded_codes`, `_id` deterministic pattern, scope `global\|shelter\|effective` |
| FR-049-10 | `docs/prd/role-permission-matrix.md`: global master data = SA only; shelter-local master data = SA + SM (write scope ตน) |

### Acceptance

- back-office เปิด `registration-config`: global items แสดงพร้อม badge "GLOBAL", ไม่มีปุ่มลบ/แก้; เพิ่ม
  item ใหม่ → เป็น shelter-local badge "SHELTER", ลบ/แก้ได้
- ลบ shelter-local item → เขียนทับ `master_data:{type}:{shelter_code}` เท่านั้น; global doc ไม่เปลี่ยน rev
- registration form dropdown แสดง global + shelter-local รวมกัน (เฉพาะ `status: active`), ไม่มี option ซ้ำ code
- system-management `registration-config` เพิ่ม/toggle global item ได้; back-office ศูนย์ใดๆ เห็นทันทีตอน reload
- ไม่มี `excluded_codes` ถูกเขียนลง doc ใหม่; endpoints ไม่ import merge/split override helper อีก
- toggle item เป็น `inactive` → หายจาก dropdown ตอนเลือกใหม่ แต่ evacuee/household เก่าที่อ้าง code นั้นยังโชว์ label เดิม (ไม่พัง, ไม่โชว์ ULID ดิบ)

---

## Impact (implemented ✅ — branch `feat-system-management`)

| ไฟล์ | การเปลี่ยนแปลง |
| --- | --- |
| `frontend/.../portal/system-management/+layout.ts` | `requireAuth` → `requireAdmin` (guard ทั้ง area, FR-049-8) |
| `frontend/.../back-office/shelters/+page.svelte` | own-shelter only (มีอยู่แล้ว) |
| `frontend/.../system-management/shelters/{+page.svelte,+page.ts}` | all shelters, requireAdmin (มีอยู่แล้ว) |
| `frontend/src/lib/features/master-data/domain/master-data.ts` | `applyItemOp('add')` → ULID เสมอ; op `delete`→`setStatus`; ลบ `slugifyLabel`/`slugifyAscii`/`uniqueCode`; เพิ่ม item `status`; ลบ `excluded_codes`; `schema_v 1\|2\|3`; เพิ่ม `needsMasterDataMigration`/`migrateMasterDataToV3` |
| `.../master-data/{domain.ts,index.ts}` (barrels) | ลบ export slugify/uniqueCode/deleteItem/useDeleteMasterItem; เพิ่ม migration fns |
| `frontend/src/lib/server/master-data-server.ts` | `mergeMasterDataItems` → concat + source tag (ไม่ override/ไม่ dedup); ลบ `splitMasterDataItems`/`sameMasterDataItem`/`excluded_codes` |
| `.../api/back-office/master-data/[type]/+server.ts` | PUT เขียน items ตรง, stamp `schema_v: 3`; ลบ split/exclude |
| `.../api/back-office/master-data/[type]/items/[code]/**` | **ลบทั้ง route** (hard-delete endpoint ไม่มีแล้ว — soft-delete ผ่าน PUT setStatus) |
| `.../master-data/data/master-data.api.ts` + `application/queries.ts` | ลบ `deleteItem`/`useDeleteMasterItem` (เหลือ `usePutMaster`) |
| `.../master-data/ui/master-data-item-list.svelte` | ปุ่ม toggle ปิด/เปิดใช้งาน; global read-only (`isManageable`); **column "สถานะปัจจุบัน"** ใหม่; inactive row จาง |
| `.../master-data/ui/master-data-config-page.svelte` | `localOnly()` write-filter (shelter PUT ส่งเฉพาะ shelter-local); `handleToggleStatus` |
| `.../features/{people,shelters,shelter-import}/**` (7 forms) | dropdown กรอง `status === 'active'` (display/label-resolve คงเดิม) |
| `frontend/scripts/migrate-master-data.ts` + `package.json` | migration runner `pnpm migrate:master-data` (dry-run default, `--write --confirm`) |
| `frontend/scripts/seed.ts` | `seedMasterData()` — global docs 6 types (vulnerable_group/health_condition/dietary_restrictions/pet_types/house_damage/shelter_type), status active, schema_v 3, idempotent |
| `docs/data/schema.md §3.3` | two-tier, code=ULID, `status`, ลบ `excluded_codes`, schema_v 3 + migration note |
| `docs/prd/role-permission-matrix.md` | master data scope rule (FR-049-10) |
| tests | `master-data.test.ts` (ULID, status, setStatus, migration) 24 pass; `server.test.ts` × endpoints (concat, verbatim write, schema_v 3) |

**Verified:** `pnpm check` 0 errors · `pnpm lint` clean · `pnpm test` 721 passed / 2 skipped

**Consumer ที่ไม่ต้องแก้ logic (verify only):** household-form, evacuee-registration, evacuee-profile-health-card,
admission-policy-section, basic-info-section, shelter-list, shelter-import — ทุกตัวใช้ `useMasterData`
(`scope: effective`) ซึ่งยังคืน list เดียว (concat) เหมือนเดิม

---

## Migration

- **`excluded_codes` removal** — doc เดิมที่มี `excluded_codes` จะถูก ignore; global item ที่เคยถูกซ่อน
  ในศูนย์นั้นจะ**กลับมาแสดง** (ตรงกับ intent ใหม่: global แสดงทุกศูนย์เสมอ). dev DB เท่านั้น ไม่มี prod
  data → reset ได้ (ตาม pattern CR-019/CR-031); ไม่ต้อง migration script
- **`code` slug → ULID** — item เดิมที่มี slug code (`elderly`, หรือ seed `zone_1`/`z1_c16`) **คงอยู่ได้**
  (ULID rule ใช้กับ item ที่สร้างใหม่); ไม่ rewrite code เดิม เพราะจะทำ record ที่อ้าง code นั้นพัง
- **`status` เพิ่มใหม่** — item เดิมที่ไม่มี `status` ให้ default เป็น `active` (ตอนอ่าน/parse); การ "ลบ"
  ต่อจากนี้เขียน `status: inactive` แทนการเอา item ออก. hard-delete เดิมไม่ใช้แล้ว
- **schema_v 2 → 3** (เจ้าของเคาะ 2026-07-25) — เพิ่ม `status` + ลบ `excluded_codes`. doc เดิม (schema_v ≤2)
  อ่านแบบ tolerant: `status` ที่หายไป default เป็น `active`, `excluded_codes` ที่มีอยู่ถูก ignore.
  write ใหม่ทั้งหมด stamp `schema_v: 3`

---

## Decision log

- 2026-07-25 — proposed. track เป็น CR ไฟล์เต็ม (เจ้าของเลือก)
- 2026-07-25 — behavior shelter-list scope + master data two-tier implement บางส่วนแล้วบน branch
  `feat-system-management` (override-merge + excluded_codes)
- 2026-07-25 — **เปลี่ยนทิศ architecture** (เจ้าของเคาะ): item code = ULID เสมอ → namespace disjoint →
  ทิ้ง override-merge + `excluded_codes`, consumption = concat, global read-only ที่ back-office.
  doc `_id` คง deterministic (ไม่เปลี่ยน ULID — กัน dup docs/tier + รักษา idempotent re-seed)
- 2026-07-25 — เหตุผลเลือก ULID เหนือ slug: (ก) label ไทยตกไป ULID อยู่แล้ว, (ข) ปิด edge case
  code-collision ถาวร, (ค) ตัด dedup/override logic ทั้งหมด
- 2026-07-25 — **delete-in-use policy** (เจ้าของเคาะ): soft-delete ผ่าน `status: active|inactive` แทน
  hard-delete → code ไม่หาย record ไม่พัง; แต่ละ module กรอง `status: active` ตอน dropdown, ไม่กรองตอน
  display. ไม่ทำ cascade rewrite record เดิม (เปราะในระบบ replicated)
- 2026-07-25 — **เจ้าของเคาะ**: (1) schema_v 2→3 (เพิ่ม `status` + ลบ `excluded_codes`); (2)
  `system-management/+layout.ts` ใช้ `requireAdmin` guard ทั้ง area ที่ layout (ต่างจาก
  `back-office/+layout.ts` ที่เป็น per-page เพราะ back-office มีหลาย role) → เริ่ม implement
- **Replication note (edge)**: filtered replication ลง edge ต้อง include global doc (ไม่มี `shelter_code`)
  ด้วย มิฉะนั้นศูนย์ offline จะไม่เห็น global master data — เป็นเรื่อง replication filter config
  ไม่ใช่ data model แต่ต้องกำหนดตอน setup edge
