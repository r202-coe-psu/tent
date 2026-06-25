---
id: CR-010
title: "Master Data Engine — เพิ่ม doc type `master_data` ใน registry (5 type hardcode, SA only) + UI `/registration-config`; Phase 1 = CRUD ยังไม่ wire evacuee/medical/household [⏳ OPEN: code vs ULID identifier]"
status: proposed
date: 2026-06-25
requested_by: development team (UI mockup @spec/image.png, @spec/image copy.png)
decided_by: <project owner>
layer: volatile          # new doc type ตาม pattern registry (central-managed, pull ลง device); ไม่แตะ envelope/auth/sync priority
affects:
  - docs/data/schema.md §3.3 — new `master_data` doc type (ใหม่)
  - docs/data/data-model.md §3.3 — example + sync direction
  - docs/data/schema-er-diagram.md — entity master_data
  - docs/data/couchdb-mongodb-sync.md — replicate master_data:* ลง device
  - docs/prd/role-permission-matrix.md §3 — row "Master Data Engine" = SA only
  - docs/status/schema-v3-implementation-status.md — row registry master_data ✗ → ✓
  - frontend/src/lib/features/master-data/ — feature ใหม่ทั้ง feature
  - src/routes/(protected)/registration-config/ — route ใหม่
---

# CR-010 — Master Data Engine (Phase 1: CRUD only)

## Why

ปัจจุบัน **enum values ของ personal data** (gender, religion, special_needs, pet species) ถูก **hardcode** ใน Zod schemas ที่ `frontend/src/lib/features/people/domain/people.ts:25-39` และใน `docs/data/schema.md` §1.1, §1.3, §1.2 (medical.conditions เป็น free-text ไม่มี enum) — ปัญหา:

1. **CR-007 (2026-06-22)** เพิ่งเปลี่ยน `religion` จาก `opt` → `req` เพราะต้องวางแผน Halal — แสดงว่า enum hardcode มีปัญหาเรื่อง maintenance และขัดกับ field-study finding (ต้องการ flexibility)
2. `medical.conditions` / `medical.allergies` เป็น **free-text `[str]`** — ไม่ enforce vocabulary, search/aggregate ยาก
3. `house_damage` (สถานะความเสียหายบ้าน) — **ไม่มี field ใน schema** เลย แต่เป็นข้อมูลที่ field study ต้องการ
4. Admin ไม่สามารถเพิ่ม/แก้/ลบ option ได้เอง — ทุกครั้งต้อง redeploy

**UI mockup** (`spec/image.png`, `spec/image copy.png`) แสดง **Master Data Engine** ที่ให้ admin จัดการ enum values แบบ CRUD ได้ — 5 type ที่ lock ไว้ (Vulnerable Group, Health Condition, Dietary Restrictions, Pet Types, House Damage) ตามที่ design กำหนด

CR นี้ทำ **Phase 1 = CRUD admin UI + storage เท่านั้น** ไม่ wire เข้า evacuee/medical/household form (Phase 2 = GET API + wiring, ทำใน CR ถัดไป)

### Open decision: `code` (slug) vs `id` (ULID) — รอ team/owner เคาะ

> **สถานะ: ⏳ OPEN** — ทั้งสองทางมี trade-off จริง ต้องการ input จาก team/owner ก่อน lock doc shape

#### บริบท

แต่ละ item ใน `master_data.items[]` ต้องมี identifier ใช้ 2 จุดประสงค์:
1. **Internal lookup** (ภายใน master_data doc) — ใช้แยกแต่ละ item เวลา edit/delete
2. **Map to main schema** (Phase 2 wire) — เก็บค่าใน `evacuee.special_needs`, `medical.conditions` ฯลฯ

Identifier แบบไหนตอบทั้ง 2 ข้อได้ดีกว่า?

#### Option A — `code` (slug, semantic)

```ts
interface MasterDataItem {
  code: string;         // e.g. "elderly", "halal", "dog"
  label: string;
  is_default: boolean;
}
```

- **Auto-generate** จาก label (slugify + dict map สำหรับภาษาไทย: "ผู้สูงอายุ" → `elderly`)
- **Immutability** — แก้ label ได้ แต่ code คงเดิม → admin งง ถ้าเห็น code ไม่ตรง label (เช่น code `elderly` แต่ label เปลี่ยนเป็น "ผู้สูงอายุ (60+)")
- **Slugify ภาษาไทย** — ต้อง dict map หรือ transliteration (`ผู้สูงอายุ` → `elderly` vs `phu-sung-ayu`); fallback = ULID suffix ถ้า slug ชน
- **ตรง schema เดิม** — `religion: enum('buddhist', 'muslim', ...)` และ `special_needs: [enum('elderly', ...)]` ใน `schema.md §1.1` ใช้ string semantic อยู่แล้ว → Phase 2 wire เปลี่ยนจาก hardcode enum → lookup master_data **ไม่ต้องเปลี่ยน doc structure**
- **Debug/query ง่าย** — `evacuee.special_needs = ["elderly"]` อ่านออก, Mango query ตรง, log human-friendly
- **Phase 1 overhead** — เพิ่ม dict map + slugify algorithm ตั้งแต่ยังไม่ใช้ (Phase 1 ไม่ wire)

#### Option B — `id` (ULID)

```ts
interface MasterDataItem {
  id: string;           // e.g. "01HABCDEF..."
  label: string;
  is_default: boolean;
}
```

- **Internal-only** — ใช้แยก item ใน array อย่างเดียว, ไม่ map ลง main doc
- **Phase 2 derive** — ตอน wire เข้า form, form save ค่า `code` (slug) แยก — master_data.items[].id ใช้ lookup ใน doc เดียวเท่านั้น
- **ไม่มี slugify** — unique by construction, ไม่ชน, ไม่ต้อง dict map
- **Phase 1 ง่ายสุด** — เก็บแค่ id + label + is_default
- **ข้อเสีย** — main schema ต้องเก็บ `code` (slug) อยู่ดี เพราะ form dropdown แสดง label แต่ save ค่า semantic (ไม่ใช่ ULID) → ต้องมี code ใน item อยู่ดี → **Option B จริง ๆ คือ "code + id"** (มี identifier 2 ตัว)
- **Doc structure เปลี่ยน** — Phase 2 wire ต้องเพิ่ม field ใน main schema (เก็บ code string เพิ่ม) แทนที่จะใช้ id ตรง

#### Option C — Hybrid `code` + `id`

```ts
interface MasterDataItem {
  id: string;           // ULID — internal array key
  code: string;         // slug — public-facing, map ลง main schema
  label: string;
  is_default: boolean;
}
```

- identifier 2 ตัว — แยก internal (id) vs external (code)
- **Phase 1 overhead สูงสุด** — slugify + ULID mint พร้อมกัน
- **Phase 2 ได้ทั้ง 2 ทาง** — ใช้ id ภายใน master doc, code map ลง main doc
- **ข้อสงสัย** — id ใช้ตอนไหน? ถ้าใช้แค่ภายใน array ใช้ array index ก็ได้ → over-engineering

#### Trade-off matrix

| | Option A (`code`) | Option B (`id`) | Option C (hybrid) |
|---|---|---|---|
| **Phase 1 complexity** | medium (slugify + dict) | low | high (slugify + ULID) |
| **Phase 2 main schema** | ไม่เปลี่ยน structure (เก็บ string) | เพิ่ม field เก็บ code เพิ่ม (id ใช้ภายในอย่างเดียว) | ไม่เปลี่ยน structure (ใช้ code) |
| **Debug/log UX** | ✅ อ่านออก ("elderly") | ❌ อ่านไม่ออก ("01HABC...") | ✅ (code) |
| **Admin UX** | เห็น code แต่ไม่ต้องกรอก (auto) | ไม่เห็น id เลย | เห็น code (auto) + ไม่เห็น id |
| **Label/code sync** | แก้ label ไม่กระทบ code → admin งง | ไม่มี code ให้งง | แก้ label ไม่กระทบ code → admin งง (เหมือน A) |
| **Backward compat** | ตรง enum เดิม | ต้องเปลี่ยน main schema | ตรง enum เดิม |

#### คำถามให้ team/owner เคาะ

1. **Phase 1 ต้องการ identifier ที่ admin เห็น/ไม่เห็น?**
   - admin ไม่ควรเห็น internal id (ULID) — ถ้าเก็บ id ก็ปิดใน UI
   - admin อาจอยากเห็น code เพื่อ verify mapping (ถ้าใช้ code)
2. **Phase 2 wire — main schema เปลี่ยน structure ได้ไหม?**
   - ถ้า "ไม่เปลี่ยน" → Option A หรือ C (code semantic string)
   - ถ้า "เปลี่ยนได้" → Option B ก็ได้ (id เป็น reference, เพิ่ม field)
3. **ค่า semantic (string) vs random (ULID) — อันไหนตรงกับ field-study และ existing data?**
   - ถ้ามี evacuee/medical doc เดิมที่ hardcode enum (`elderly`, `muslim`) → **Option A** ตรงเป๊ะ
   - ถ้าเริ่มใหม่หมด → เปิดทาง Option B

#### Recommendation (เบื้องต้น)

**Option A (`code` semantic string)** — เพราะ:
- schema เดิมใช้ string semantic อยู่แล้ว → ไม่ต้องเปลี่ยน main schema
- Phase 2 wire ตรง ไม่มี lookup table
- Debug/query/log ง่ายกว่ามาก
- Overhead ของ slugify + dict map รับได้ (one-time investment)

> ⏳ **รอ decision** — implement Phase 1 จะ block จนกว่า owner/team จะเคาะ A/B/C

## Change

### 1. New doc type `master_data` ใน `registry` DB

| Field | ชนิด | req | หมายเหตน |
| --- | --- | --- | --- |
| `_id` | str | sys | `master_data:{type}` (5 type, 1 doc ต่อ type) — exception ของ `{type}:{ulid}` pattern (ใช้ deterministic id เพราะ 1:1 กับ type, ไม่ต้อง ULID) |
| `type` | str | client | `"master_data"` — discriminator |
| `schema_v` | int | client | `1` (initial) |
| `master_type` | enum(5 type) | req | `vulnerable_group` \| `health_condition` \| `dietary_restrictions` \| `pet_types` \| `house_damage` (hardcode ใน code ตาม UI mockup) |
| `items` | [{**id?**, **code?**, label, is_default}] | req | ≥1 item; **identifier shape ⏳ OPEN** (ดู "Open decision" section ด้านบน — `code` semantic, `id` ULID, หรือ hybrid) |
| common envelope | — | sys | `created_at`/`updated_at`/`created_by` (registry ไม่มี `shelter_code` — เป็น global) |

**Master type labels (hardcode ใน code):**

```ts
const MASTER_DATA_TYPES = [
  'vulnerable_group',      // ประเภทกลุ่มเปราะบาง (Vulnerable Group)
  'health_condition',      // โรคประจำตัวและอาการแพ้ (Health Condition)
  'dietary_restrictions',  // ศาสนาและข้อจำกัดอาหาร (Dietary Restrictions)
  'pet_types',             // ประเภทสัตว์เลี้ยง (Pet Types)
  'house_damage'           // สถานะความเสียหายของบ้าน (House Damage)
] as const;
```

**Item shape:**

> ⏳ **Open decision** (ดู "Open decision" section ด้านบน) — final shape รอ A/B/C:

```ts
// Option A (recommended) — code semantic
interface MasterDataItemA {
  code: string;         // immutable, lower_snake, auto-generate จาก label
  label: string;        // Thai display, editable
  is_default: boolean;  // 1 item per type = true (enforce)
}

// Option B — id ULID (Phase 2 derive code เพิ่ม)
interface MasterDataItemB {
  id: string;           // ULID, internal key ใน array
  label: string;
  is_default: boolean;
}

// Option C — hybrid
interface MasterDataItemC {
  id: string;           // ULID, internal key
  code: string;         // slug, map ลง main schema
  label: string;
  is_default: boolean;
}

// ไม่มี `active` field — hard delete (Phase 1, ทั้ง 3 option)
```

### 2. Permission

- **Read:** ทุก authenticated role อ่านได้ (เพื่อเตรียม Phase 2 API) — แต่ Phase 1 อ่านผ่าน PouchDB changes feed เท่านั้น (no API endpoint)
- **Write:** `system_admin` (SA) เท่านั้น — implement ที่ `validate_doc_update` ฝั่ง CouchDB (rule ใหม่: "reject `master_data:*` write จาก non-SA user")
- **Route guard:** `requireAdmin` (`$lib/guards/auth.ts`) ที่ `+page.ts` `load`

### 3. UI — `/registration-config` (back-office admin)

**Layout (ตาม `ui mock V5`):**
- **Left column** — 5 cards (vertical list) แสดง `MASTER_DATA_TYPE_LABELS` + count(items) · active card = dark blue bg
- **Right column** — header "รายการข้อมูล (N)" + search input + "+ เพิ่มข้อมูล" button · table rows
- **Table row** — label (left) · "จัดการ" button (blue) · "ลบ" button (red, AU = admin only)
- **Search** — filter label (client-side, debounced)

**Modal (ตาม `ui mock V5`):**
- Title: "ฐานข้อมูลมาสเตอร์ล่วงกลาง (MASTER DATA ENGINE)"
- Subtitle: "🛠️ แก้ไขข้อมูลพารามิเตอร์มาตรฐาน / สูตรเสมือน"
- **หมวดหมู่ข้อมูล (Type):** disabled Select — แสดง label ของ `master_type` ที่กำลัง edit (mockup: "Vulnerable Group" — disabled เพราะ type hardcode)
- **Label (ชื่อแสดงผลภาษาไทย) *:** Input text, required, validation `min(1)`
- **Checkbox:** "ตั้งค่าเป็นค่าเริ่มต้นสำหรับประเภทนี้ (Set as Default Option)" + helper text "เมื่อเลือก ตัวเลือกนี้จะถูกตั้งเป็นตัวเลือกเริ่มต้นอัตโนมัติในการลงทะเบียนหรือเรียกใช้งานของหัววัยนี้"
- **Buttons:** "ยกเลิกและย้อนกลับ" · "บันทึก" (primary, blue)
- **Behavior เพิ่มเติม (ไม่มีใน mockup แต่ต้องมี):**
  - ติ๊ก `is_default` → unset `is_default` ของ item เดิมใน type เดียวกัน (1 default per type)
  - **Identifier generation** — ⏳ OPEN (ดู "Open decision" section):
    - **Option A:** auto-generate `code` จาก label ตอน create (slugify + dict map)
    - **Option B:** mint ULID เป็น `id`
    - **Option C:** ทำทั้งสองอย่าง
  - Validation: label required, label unique case-insensitive ภายใน type, identifier (code/id) unique ใน array
  - Hard delete: ลบ item ออกจาก array (item หายจาก UI ทันที) — **Phase 2 จะ block delete เมื่อ code ถูก reference ใน evacuee/medical/household doc**
  - แก้ label: แก้ได้, `code` ไม่เปลี่ยน

### 4. Sync direction (ตาม pattern registry)

- `master_data:*` replicate: **Central → device** (read-only ฝั่ง device) — pattern เดียวกับ `sop_profile` master ใน `catalog` (CR-006)
- Edge fallback replica: เก็บใน `registry` DB ที่ edge (ถ้า WAN ขาด device ยังอ่านได้)
- Live query: `useMasterData(type)` invalidate on PouchDB `change` event ใน `registry` DB (pattern `startPeopleLiveQuery`)

## Impact

### Docs
- `docs/data/schema.md` §3.3 — เพิ่ม `master_data` section (หลัง §3.2 `config:app`)
- `docs/data/data-model.md` §3.3 — เพิ่ม example doc + note "central-managed, pull ลง device, edge fallback replica"
- `docs/data/schema-er-diagram.md` — เพิ่ม entity `master_data` ใน `registry` group
- `docs/data/couchdb-mongodb-sync.md` — เพิ่ม replicate rule `master_data:*` central → device
- `docs/prd/role-permission-matrix.md` §3 — เพิ่ม row:
  ```
  | จัดการ Master Data (vulnerable/health/dietary/pet/house_damage) | new | ✓ | — | — | — | — |
  ```
- `docs/status/schema-v3-implementation-status.md` — เพิ่ม row `master_data` ใน table "DBs ใน catalog/registry" ✗ → ✓
- `docs/changes/_index.md` — เพิ่ม row CR-010 (proposed)

### Code (frontend — feature ใหม่ทั้ง feature)

```
src/lib/features/master-data/
├── domain/
│   ├── master-data.ts         # types + zod + factory + slugifyThai/en + 1-default-enforce
│   └── master-data.test.ts    # invariants: code slugify, is_default unique, factory stamps envelope
├── data/
│   ├── master-data.repository.ts  # interface (read/write)
│   └── master-data.pouch.ts       # PouchDB impl over `registry` db (namedLocalDb)
├── application/
│   └── queries.ts             # useMasterData(type), useUpdateMasterData, useDeleteMasterDataItem, startMasterDataLiveQuery
├── ui/
│   ├── registration-config-page.svelte  # main page
│   ├── master-data-type-list.svelte     # left column 5 cards
│   ├── master-data-item-list.svelte     # right column table
│   └── master-data-edit-modal.svelte    # modal (add/edit)
└── index.ts                   # public barrel

src/routes/(protected)/registration-config/
├── +page.svelte
└── +page.ts                   # load: requireAdmin guard
```

### Schema_v impact
- **ไม่ bump** `schema_v` ของ evacuee/medical/household (Phase 1 ไม่ wire — main schema ยัง hardcode enum เดิม)
- `master_data` เป็น doc type ใหม่, `schema_v 1` ตั้งแต่แรก
- Note: `special_needs` enum hardcode ใน `people.ts:31` ปัจจุบัน 6 ค่า (`elderly`, `disabled`, `pregnant`, `infant`, `chronic_illness`, `bedridden`) — UI mockup แสดง 4 items ใน `vulnerable_group` — **ต้อง flag ใน Decision log ว่า Phase 2 wire จะ shrink enum 6→4 พร้อม schema_v bump ใน CR ถัดไป**

### Out of scope (Phase 2 — CR ถัดไป)
- **GET API** (`GET /api/v1/master-data/{type}`) — public-ish, rate-limit + role check
- **Wire เข้า form:** แก้ `evacueeInputSchema` / `medicalInputSchema` / `householdInputSchema` ให้ lookup value จาก master_data แทน hardcode enum
- **Block delete** เมื่อ `code` ถูก reference ใน evacuee/medical/household (query Mango + count)
- **`vulnerable_group` enum shrink** 6→4 (Phase 2 wire เป็นจังหวะเดียวกับ bump `schema_v evacuee`)
- Per-shelter override (เลือก Pattern A ก่อน; Pattern B = master+override เป็น CR แยก)

## Migration

**N/A** — `master_data` เป็น doc type ใหม่, ไม่มี persisted doc เดิม (ระบบยังไม่ deploy production). Seed ผ่าน `data/master-data.pouch.ts` เมื่อ SA เปิดหน้าครั้งแรก (idempotent — ถ้ามี doc อยู่แล้วข้าม)

Phase 2 (separate CR): ตอน wire เข้า form จะต้อง backfill/migrate main schema → บันทึกไว้ที่ CR ถัดไป

## Open dependencies

- **⏳ OPEN: identifier shape (A vs B vs C)** — รอ owner/team เคาะก่อน implement (ดู "Open decision" section) — **blocker สำหรับ Phase 1 implement**
- **Slugify dictionary** (เฉพาะ Option A/C) — `domain/master-data.ts` ต้องมี dict map สำหรับ label ที่ใช้บ่อย (เช่น "ผู้สูงอายุ" → `elderly`, "หญิงตั้งครรภ์" → `pregnant`) — ถ้า slug ชนกัน fallback = append ULID suffix
- **Seed defaults** — เมื่อ admin เปิด type แรก ควร seed items ตาม mockup (4+4+5+4+3 = 20 items) เพื่อให้ไม่ว่างเปล่า — **decision: ไม่ auto-seed** ให้ SA กดเพิ่มเอง (clean state แรก ให้ admin เห็นว่าต้องเพิ่มอะไรบ้าง)
- **Phase 2 scope ใน CR ถัดไป** — จะต้องตัดสินใจ: (a) wire order (people → medical → household), (b) shrink enum 6→4 พร้อม migration main schema, (c) block-delete rule

## Decision log

- 2026-06-25 — proposed (CR นี้)
- 2026-06-25 — design decisions:
  - storage: `registry` DB, `_id = master_data:{type}` (deterministic 1 doc ต่อ type)
  - type: 5 type hardcode ใน code ตาม UI mockup (ไม่ master ในตัว)
  - permission: SA only (write); read = any authenticated (Phase 2 API)
  - path: `/(protected)/registration-config/` (ไม่ใช่ back-office/admin/onsite)
  - identifier: **⏳ OPEN** — A vs B vs C (recommend A เบื้องต้น — รอ owner/team เคาะ)
  - code generation: auto-generate จาก label (slugify + dict map สำหรับ label ไทย)
  - delete: hard delete (ไม่มี `active` field) — Phase 2 จะ block เมื่อมี reference
  - pattern: A (เก็บ code เป็น string ใน main doc เมื่อ Phase 2 wire) — ตรงกับ schema เดิม, ไม่ต้องเปลี่ยน main schema structure
  - tracking: CR file ใน `docs/changes/CR-010-master-data-engine.md` ตาม user request
