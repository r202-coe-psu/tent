---
id: CR-183
title: ศูนย์ปิด — คงข้อมูลคนใน public search ไว้ตามระยะ retention พร้อมระบุ "ศูนย์อพยพปิดแล้ว"
status: approved
date: 2026-10-21
requested_by: feedback หน้างาน (ค้นหาคน public ข้อ 1.1.1 / 1.1.2) — GitHub #644, #645
decided_by: kong
layer: volatile # rule retention/privacy · FR-7/FR-8 แตะ listener scope ของ sync worker (stable core ตาม CLAUDE.md) — kong ยืนยันขอบเขตนี้แล้ว (D-4, 2026-10-22); ดู Impact
affects:
  - docs/data/data-model.md §7 Retention (+ แถว Mongo projection ของศูนย์ปิด)
  - docs/data/schema.md §3.1 shelter `closed_at` (stamp rule) · §3.2 `config:app.retention_months_after_close`
  - docs/data/couchdb-mongodb-sync.md §3.2 (`public_shelters` comment บรรทัด 125) · ตารางลบ/retention (บรรทัด 288) · listener scope
  - docs/data/api-contract.md `POST /public/v1/occupants` · `/external/v1/occupants` (+`shelter_status` ใน response)
  - docs/changes/01-core/CR-017-dashboard-api-architecture.md Decision D (แถว "ปิดศูนย์") — ถูกแทนบางส่วน
  - docs/task-breakdown/01-core.md T-43 (RoPA/retention) — cross-ref
  - no schema_v bump (CouchDB shape ไม่เปลี่ยน; `closed_at` มีใน schema อยู่แล้ว)
  - worker PROJECTION_VERSION 5 → 6 (worker/src/worker/projection_version.py)
  - worker/src/worker/retention/job.py · couch/processor.py · couch/bootstrap.py · listeners/registry.py · projectors/shelter.py
  - backend/apiapp/modules/evacuee/schemas.py · use_case.py · backend/tests/ (+ลบ `care_zone` / `zone_name` จาก `SearchResult`)
  - frontend/src/lib/api/fastapi.json · openapi.d.ts · features/public-portal (domain/mappers.ts, ui/family-search-modal.svelte) · routes/(public)/search/+page.svelte (เอาคอลัมน์โซนออก) · i18n TH/EN
  - frontend/src/lib/features/shelters (stamp `closed_at` ตอนเปลี่ยนเป็น `closed`)
  - frontend/scripts/migrate-shelter-closed-at.ts + `package.json` `migrate:shelter-closed-at` (backfill `closed_at` ศูนย์ legacy)
---

# CR-183 — คนในศูนย์ที่ปิดแล้วต้องยังค้นเจอ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ปิดศูนย์ (`operation_status = closed`) แล้ว **ไม่ลบ** `public_persons` / `public_shelters` ทันที — คงไว้จนครบ `retention_months_after_close` (default 3 เดือน) นับจาก `closed_at` แล้วจึงลบ `public_persons` พร้อม audit
> - **เพื่อใคร:** ญาติที่ค้นหาคนหลังศูนย์ปิดต้องรู้ว่าคนนั้นเคยอยู่ศูนย์ไหน — ตอนนี้ค้นไม่เจอภายใน ~5 นาทีหลังปิด
> - **build:** worker retention ลบตามเวลาแทนลบทันที + ฟัง/rescan DB ของศูนย์ปิดที่ยังอยู่ในระยะ · FastAPI ส่ง `shelter_status` · UI แสดงป้าย "ศูนย์อพยพปิดแล้ว" · staff UI stamp `closed_at` · migration script backfill `closed_at` ศูนย์ที่ปิดไปแล้ว
> - **กระทบ:** data-model §7, schema.md §3.1, api-contract occupants (ลบ `care_zone` / `zone_name` — breaking ต่อ partner) · ไม่ bump `schema_v` · `PROJECTION_VERSION` 5→6

---

## ปัญหาปัจจุบัน (as-is, develop @ `ed9b2e98`)

| # | พฤติกรรม | ที่ |
| --- | --- | --- |
| P-1 | `reconcile_closed_shelters` (ทุก 300 วิ) hard-delete `PublicPerson`, `PublicNeed`, `ShelterStock`, `PublicShelter` ของทุกศูนย์ที่ `status == "closed"` → ปิดแล้ว ≤5 นาทีค้นไม่เจอ | `worker/src/worker/retention/job.py:91-133` |
| P-2 | คอมเมนต์ใน job บอกว่า "CDC ลบศูนย์ปิดอยู่แล้ว" — ไม่จริง: `project_shelter` upsert ศูนย์ `closed` ตาม ADR-0002 Soft Delete | `job.py:92-94` vs `projectors/shelter.py` |
| P-3 | เอกสารขัดกัน 3 ที่: sync doc บอกลบศูนย์ปิด, ADR-0002 บอกเก็บแถว, data-model §7 บอก purge **ภายใน 3 เดือน** | `couchdb-mongodb-sync.md:125,288` · `adr/0002` §3 · `data-model.md` §7 |
| P-4 | listener + bootstrap ครอบเฉพาะศูนย์ที่ **เปิด** → evacuee ของศูนย์ปิดที่ถูกแก้หลังปิด (check-out, opt-out `privacy.search_excluded`) ไม่ไปถึง Mongo | `listeners/registry.py:23-31` · `couch/bootstrap.py:182-221` |
| P-5 | `shelter.closed_at` ไม่ถูก stamp ตอนปิดศูนย์ (staff UI ไม่เขียน) → ไม่มีจุดเริ่มนาฬิกา retention | `frontend/src/lib/features/shelters/` |
| P-6 | `shelter_occupants` ไม่ถูกลบตอนปิด → ค้างเป็นรายชื่อผู้พักปัจจุบันที่ไม่จริง | `retention/job.py` (ไม่ครอบ) |
| P-7 | FastAPI ไม่ส่งสถานะศูนย์ในผลค้นหา | `backend/apiapp/modules/evacuee/use_case.py:265-271,297-315` |

> #645 (ปิด→เปิดใหม่ค้นไม่เจอ): หลัง #703 merge, การเปิดใหม่หลังจาก retention ลบแถวแล้วเข้าเงื่อนไข `relisted` → `_reproject_shelter_database` rescan DB (`processor.py`) จึง **น่าจะหายแล้วบางส่วน — ต้อง reproduce ยืนยัน**. เมื่อ CR นี้คงแถว `public_shelters` ไว้ เงื่อนไข `relisted` จะไม่เกิดอีก จึงต้องมี FR-9 แทน.

---

## Requirements

### Retention rule (data-model §7)

- **FR-1** — ศูนย์ `closed` ต้องคงแถว `public_shelters` ไว้ (`status = closed`, `is_active = true`) ตาม ADR-0002 — retention **ห้าม** ลบแถวนี้เพราะศูนย์ปิด.
- **FR-2** — ศูนย์ `closed` ต้องคงแถว `public_persons` ไว้จนถึง `retention_deadline = closed_at + config:app.retention_months_after_close เดือน` (default `3`).
- **FR-3** — เมื่อ `now ≥ retention_deadline` retention ต้องลบ `public_persons` ของศูนย์นั้นทีละ doc ผ่าน `_audit_and_delete` (`trigger: "scheduled"`, `couchdb_ref = {db: "registry", doc_id: registry_id}`) — verify + idempotent ตาม FR-017-07..09.
- **FR-4** — ตอนศูนย์เปลี่ยนเป็น `closed` ให้ลบ `public_needs`, `shelter_stocks`, `shelter_occupants` ของศูนย์นั้น (ข้อมูล operational ปัจจุบัน ไม่ใช่ข้อมูลค้นหาคน) — ทำได้ทั้งใน processor (ทันที) และ retention (safety net).
- **FR-5** — `closed_at` ใช้จาก `public_shelters.closed_at` (projected จาก registry) เท่านั้น — ไม่มี fallback field. ศูนย์ legacy ได้ค่าจาก migration script (FR-22). ถ้ายังเป็น `null` retention ต้องไม่ลบ และ log warning (ดู D-5).
- **FR-6** — worker อ่าน `retention_months_after_close` จาก CouchDB `registry` `config:app` โดยตรงทุกรอบ retention (ไม่เพิ่มเข้า public allow-list `PUBLIC_APP_CONFIG_FIELDS`); อ่านไม่ได้/ค่าผิด → ใช้ `3`.

### Sync coverage ของศูนย์ปิด

- **FR-7** — listener `_changes` ต้องครอบ DB ของศูนย์ที่เปิด **และ** ศูนย์ `closed` ที่ยังไม่ถึง `retention_deadline` (แทน `list_open_shelter_codes` ด้วยชุดเดียวกับ FR-8 ที่อ่านจาก registry). ศูนย์ `cancelled` ยังไม่ถูกฟังตาม draft-shelter-cancelled-status.
- **FR-8** — `bootstrap_all` ต้อง scan DB เฉพาะศูนย์ที่อ่านจาก **registry** (`type = shelter`) และเป็นศูนย์เปิดตาม `is_shelter_open` **หรือ** `operation_status = closed` ที่ `closed_at + retention_months_after_close` ยังไม่ถึง — ศูนย์ `cancelled` ไม่ scan. ต้องอ่านจาก registry เพื่อกรองด้วย `closed_at` + deadline ก่อน scan — แถว `public_shelters` ของศูนย์ที่เลยระยะยังคงอยู่ตาม FR-1 แต่ `public_persons` ของศูนย์นั้นถูกลบแล้ว จึงต้องไม่ scan กลับมา. เป้าหมายคือให้ projection ของศูนย์ที่ยังอยู่ในระยะได้รับ shape ใหม่เมื่อ `PROJECTION_VERSION` bump โดยไม่ publish ข้อมูลของศูนย์ที่เลยระยะ (D-3).
- **FR-9** — เมื่อ `public_shelters.status` เปลี่ยนจาก `closed` → ค่าอื่น (เปิดใหม่) processor ต้อง rescan DB `shelter_{code}` (`_reproject_shelter_database`) ใน change เดียวกัน — ไม่รอ restart worker.
- **FR-10** — evacuee ของศูนย์ปิดที่ตั้ง `privacy.search_excluded = true` หลังปิด ต้องหายจาก `public_persons` ภายในรอบ sync ตามปกติ (ผลของ FR-7).

### Projection

- **FR-11** — _(ถอนออก 2026-10-22: ไม่เพิ่ม field `closed_seen_at` — ศูนย์ legacy ได้ `closed_at` จาก migration script FR-22 แทน)_
- **FR-12** — bump `PROJECTION_VERSION` 5 → 6 เพื่อให้ worker รัน `bootstrap_all` หนึ่งครั้งหลัง deploy (scan DB ศูนย์ปิดตาม FR-8 / D-3) — shape ของ projection ไม่เปลี่ยน.
- **FR-13** — แก้ docstring/คอมเมนต์ที่ล้าสมัยใน `retention/job.py` และ `projectors/shelter.py` ให้ตรง FR-1..FR-5.
- **FR-24** — projector ถ้า `closed_at` มีค่าแต่ parse ไม่ได้ ให้ log error พร้อม `shelter_code` และไม่ตั้ง `closed_at` เป็น `null` ใน payload ที่ upsert (คงค่าเดิมใน Mongo).

### Staff UI และการนำเข้า (registry)

- **FR-14** — เมื่อบันทึกศูนย์ที่เปลี่ยน `operation_status` เป็น `closed` ระบบต้อง stamp `closed_at` = เวลาปัจจุบัน (ISO UTC) ถ้ายังไม่มีค่า. ทำใน PATCH route `frontend/src/routes/api/back-office/shelter/[code]/+server.ts` โดย server เป็นผู้ตั้งค่าเอง ไม่รับจาก client และต้องเพิ่ม `closed_at` เข้า input schema ด้วย `.optional()` — **ห้าม**ใช้ `.nullish().default(null)` เพราะ `.partial()` จะ reset เป็น `null` ทุกครั้งที่แก้ศูนย์ปิด (ทดสอบแล้วด้วย zod 4).
- **FR-15** — เมื่อเปลี่ยนจาก `closed` เป็นสถานะอื่น ให้ตั้ง `closed_at = null` (นาฬิกา retention หยุด; ปิดใหม่ = นับใหม่).
- **FR-23** — นำเข้า CSV (`frontend/src/lib/features/shelter-import`) **ห้าม**ตั้ง `operation_status = closed` — แถวที่มีสถานะ `closed` ต้องถูกปฏิเสธพร้อม error ต่อแถว และไม่เขียน registry doc. การปิดศูนย์ทำได้จากหน้า staff เท่านั้น เพื่อให้ `closed_at` มาจาก FR-14 เส้นทางเดียว.

### FastAPI (public + external)

- **FR-16** — `SearchResult` เพิ่ม `shelter_status: "open" | "closed" | "full" | "standby" | null` จาก `public_shelters.status` ของ `person.shelter_code` (join ใน `_load_shelters` ที่มีอยู่) — ไม่มีแถวศูนย์ = `null`.
- **FR-17** — `FamilyMember` เพิ่ม `shelter_status` แบบเดียวกัน.
- **FR-18** — ลบ `care_zone` และ `zone_name` ออกจาก `SearchResult` (ไม่ส่ง field ใน response เลย) — มีผลกับ**ทุกศูนย์** ทั้งเปิดและปิด (D-2). ลบ `_resolve_zone_name` ที่ไม่มีผู้ใช้แล้ว. Projection `public_persons.care_zone` ไม่แก้ใน CR นี้.
- **FR-19** — `/external/v1/occupants` ใช้ use case เดียวกัน → ได้ `shelter_status` เพิ่ม และ**ไม่มี** `care_zone` / `zone_name` แล้ว (FR-18 = breaking change ของ response) — ต้องแจ้ง partner ใน api-contract พร้อมวันที่มีผล.

### Frontend (public portal)

- **FR-20** — `pnpm openapi:update` แล้ว commit `fastapi.json` + `openapi.d.ts`.
- **FR-21a** — หน้า `/search` (`routes/(public)/search/+page.svelte`) เอาการแสดงโซน (`zone_name` / `care_zone`) ออก.
- **FR-21** — ผลค้นหาที่ `shelter_status = "closed"` แสดงป้าย "ศูนย์อพยพปิดแล้ว" / "Shelter closed" (i18n TH/EN) ข้างชื่อศูนย์ ทั้งผลหลักและสมาชิกครอบครัว — ผ่าน barrel `$lib/features/public-portal`.

### Migration script (CouchDB registry)

- **FR-22** — script `frontend/scripts/migrate-shelter-closed-at.ts` (`pnpm migrate:shelter-closed-at`) backfill `closed_at` ให้ registry doc `type = shelter` ที่ `operation_status` (หรือ `status` legacy) `= closed` และ `closed_at` ว่าง:
  - ค่า `closed_at` = `updated_at` ของ doc (normalize เป็น ISO UTC); ถ้าไม่มี/parse ไม่ได้ → เวลาที่รัน script (ดู Decision log 2026-10-22).
  - ตั้ง `updated_at` = เวลารัน และ `updated_by` = `migration:<run_id>`; ไม่แตะ field อื่น · ไม่ bump `schema_v`.
  - default เป็น dry-run; เขียนจริงต้องใช้ `--write --confirm` · อ่าน `COUCHDB_ADMIN_URL` จาก `frontend/.env` (pattern เดียวกับ `migrate-volunteer-reapply.ts`).
  - idempotent — รันซ้ำไม่แก้ doc ที่มี `closed_at` แล้ว; ไม่แตะศูนย์ `cancelled` หรือศูนย์ที่เปิดอยู่.
  - พิมพ์รายงาน JSON: `shelter_code`, `closed_at`, `source` (`updated_at` | `now`), `result`; exit code ≠ 0 ถ้ามี doc เขียนไม่สำเร็จ.

---

## Acceptance

- [ ] ปิดศูนย์ → รอ > 5 นาที (≥ 1 รอบ retention) → ค้นชื่อคนในศูนย์นั้นยังเจอ พร้อมป้าย "ศูนย์อพยพปิดแล้ว".
- [ ] ปิดศูนย์ → `public_needs`, `shelter_stocks`, `shelter_occupants` ของศูนย์นั้นหาย; `public_shelters` ยังอยู่ `status = closed`.
- [ ] `closed_at` + 3 เดือน ผ่านไป (test ใช้ clock ปลอม) → `public_persons` ของศูนย์นั้นถูกลบ, `_retention_audit` มีแถว `verified` ครบทุกคน, `public_shelters` ยังอยู่.
- [ ] `pnpm migrate:shelter-closed-at` (dry-run) แสดงศูนย์ `closed` ที่ไม่มี `closed_at` ครบ และไม่เขียน; `--write --confirm` เติม `closed_at` ตาม FR-22; รันซ้ำแล้วไม่มีรายการ.
- [ ] ศูนย์ `closed` ที่ `closed_at = null` → retention ไม่ลบ + warning.
- [ ] ปิดจาก staff UI (PATCH) → `closed_at` ถูก stamp; แก้ชื่อศูนย์หลังจากนั้น → `closed_at` ยังเดิม (ไม่ถูก reset เป็น `null`).
- [ ] นำเข้า CSV ที่ `operation_status = closed` → แถวนั้นถูกปฏิเสธพร้อม error และไม่มีการเขียน registry doc.
- [ ] `closed_at` parse ไม่ได้ → มี error log พร้อม `shelter_code` และ `public_shelters.closed_at` ไม่ถูกตั้งเป็น `null`.
- [ ] Bootstrap หลัง deploy: ศูนย์ที่ยังอยู่ในระยะ retention → `public_persons` ฟื้นครบ; ศูนย์ที่เลย deadline → ไม่มี `public_persons` ถูก publish ใหม่ และแถว `public_shelters` ยังคงอยู่ (FR-1).
- [ ] ปิด → เปิดใหม่ (ทั้งก่อนและหลังครบ retention) → ค้นคนเดิมเจอครบภายในรอบ sync โดยไม่ restart worker (#645).
- [ ] ศูนย์ปิด: แก้ evacuee เป็น `search_excluded = true` → หายจากผลค้นหาภายในรอบ sync.
- [ ] ปิดศูนย์จาก staff UI → registry doc มี `closed_at`; เปิดใหม่ → `closed_at = null`.
- [ ] Response ของ `POST /public/v1/occupants` และ `/external/v1/occupants` ไม่มี key `care_zone` / `zone_name` ทั้งศูนย์เปิดและปิด; หน้า `/search` ไม่แสดงโซน.
- [ ] Tests: `worker/tests/` (retention ตามเวลา, `closed_at = null` → ไม่ลบ, listener/bootstrap scope, rescan ตอน closed→open, ลบ occupants ตอนปิด) · `backend/tests/` (`shelter_status` ใน result + family member, ไม่มี key zone) · frontend domain/mapper (`shelter_status` → ป้าย) · shelters domain (stamp/clear `closed_at`).

---

## Why

- Feedback หน้างาน (ค้นหาคน public 1.1.1): ญาติมักค้นหาหลังเหตุการณ์คลี่คลาย/ศูนย์ปิดแล้ว — ผลว่างทำให้เข้าใจว่าไม่เคยมีคนนั้นอยู่ในระบบ.
- data-model §7 กำหนด PDPA purge "ภายใน 3 เดือนหลังปิดศูนย์" และ `config:app.retention_months_after_close = 3` มีอยู่แล้วแต่ไม่มีโค้ดใช้ — การลบภายใน 5 นาทีเข้มกว่า policy โดยไม่ได้ตั้งใจ และขัด ADR-0002 (Soft Delete ของ location).
- การคงข้อมูลต่อหลังปิด **เพิ่ม PII exposure บน endpoint ไม่ต้อง auth** เป็นเวลาสูงสุด 3 เดือน → ต้องเป็นการตัดสินใจของ kong (D-1, D-2) และต้อง cross-ref T-43 RoPA.
- FR-7/FR-10 จำเป็นเพื่อความเป็นส่วนตัว: ถ้าคงข้อมูลไว้แต่ไม่ฟัง DB ศูนย์ปิด การ opt-out หลังปิดจะไม่มีผล.

## Impact

| ส่วน | ผลกระทบ |
| --- | --- |
| Privacy | `public_persons` ของศูนย์ปิดเปิดเผยต่อได้ ≤ `retention_months_after_close` — rate limit + `SearchAudit` เดิมยังครอบ |
| Sync worker | listener/bootstrap ครอบศูนย์ปิดในระยะ retention → จำนวน listener และเวลา bootstrap เพิ่มตามจำนวนศูนย์ปิด — **แตะ CR-017 "registry ตรวจจับเปิด/ปิดศูนย์ → เริ่ม/หยุด listener" ยืนยันโดย kong แล้ว (D-4) — CR-017 Decision D ต้องอัปเดตตอน implement** |
| Public `/shelters` | ศูนย์ปิดคงอยู่ในรายการด้วย `status = closed` ถาวร (เดิมหายหลัง ≤5 นาที) — UI รองรับ `closed` อยู่แล้วตาม enum §9.1 |
| Partner API | EXT-002/003 เห็นศูนย์ปิด (`location_status = closed`) ตาม ADR-0002; `/external/v1/occupants` ได้ field `shelter_status` เพิ่ม (additive) และ**ลบ** `care_zone` / `zone_name` (breaking — partner ที่อ่าน field นี้ต้องปรับ) |
| draft-shelter-cancelled-status | ไม่ขัด — `cancelled` ยังลบทุก projection ทันทีและไม่ถูกฟัง |
| CouchDB | ไม่มี purge/anonymize job ฝั่ง CouchDB ใน CR นี้ (ยังเป็นงาน T-43) |
| `closed_at = null` (D-5) | ยอมรับความเสี่ยงตาม D-5: ศูนย์ที่ยังเป็น `null` คง PII บน public plane เกิน §7 — ลดโอกาสด้วย FR-14 (PATCH), FR-23 (import), FR-24 (projector) |

## Migration

- **CouchDB:** ไม่ bump `schema_v`. Backfill `closed_at` ของศูนย์ `closed` ที่มีอยู่ด้วย `pnpm migrate:shelter-closed-at` (FR-22).
- **ลำดับ deploy:**
  1. รัน `pnpm migrate:shelter-closed-at` (dry-run) → ตรวจรายงาน.
  2. รัน `pnpm migrate:shelter-closed-at --write --confirm` **ก่อน** deploy worker ใหม่ — ไม่งั้นศูนย์ legacy จะไม่มีนาฬิกา retention (ไม่ถูกลบ) จนกว่าจะ backfill.
  3. deploy worker (`PROJECTION_VERSION` 6) → bootstrap.
- **Mongo:** `PROJECTION_VERSION` 6 → full bootstrap หลัง deploy; ด้วย FR-8 bootstrap scan เฉพาะศูนย์ที่ยังอยู่ในระยะ retention (รวมค่าที่ backfill ใน FR-22) จึง **ฟื้น `public_persons` ของศูนย์ที่ปิดภายใน 3 เดือน** ที่ถูกลบโดย retention เดิม (D-3). ศูนย์ที่เลยระยะแล้วไม่ถูกฟื้น.
- **Rollback:** revert worker → retention เดิมลบศูนย์ปิดทั้งหมดในรอบถัดไป (ไม่มีข้อมูลเสีย — CouchDB ยังเป็น SoR).

## Decision log

- 2026-10-21 — proposed (จาก #644, #645)
- 2026-10-22 — **approved** โดย kong — รันเลข CR-183 · D-1..D-4 ตัดสินครบ · D-4 ยังต้อง review ผลต่อ CR-017 listener scope ตอน implement
- 2026-10-22 — ถอน field `closed_seen_at` (FR-11) ออกตาม kong: ไม่เพิ่ม field ใน `public_shelters`; ศูนย์ legacy ที่ไม่มี `closed_at` ใช้ migration script backfill แทน (FR-22) — retention อ่าน `closed_at` อย่างเดียว (FR-5)
- **D-1 — ระยะเวลาคงข้อมูล** — ✅ ตัดสิน 2026-10-22: ใช้ `retention_months_after_close` (3 เดือน) ตาม data-model §7. ทางเลือกเดิม — แนะนำ: ใช้ `retention_months_after_close` (3 เดือน) ตาม data-model §7. ทางเลือก: ระยะสั้นกว่าสำหรับ public plane โดยเฉพาะ (เช่น 30 วัน — ต้องเพิ่ม config ใหม่ = field ใหม่ใน schema §3.2) · คงไว้ไม่มีกำหนดจนกว่า T-43 purge CouchDB (ไม่แนะนำ — ขัด §7).
- **D-2 — field ที่เปิดเผยของคนในศูนย์ปิด** — ✅ ตัดสิน 2026-10-22: ลบ `care_zone` / `zone_name` ออกจาก response **ทุกศูนย์ ไม่ว่าเปิดหรือปิด** (FR-18, FR-19, FR-21a) — รวมใน CR นี้. field อื่นเท่าเดิม. ทางเลือกเดิม — แนะนำ: เท่ากับศูนย์เปิด ยกเว้น `care_zone` / `zone_name` = `null` (โซนไม่มีความหมายหลังปิด). ทางเลือก: เท่ากับศูนย์เปิดทุก field · ลดเหลือชื่อ (masked) + ชื่อศูนย์ + `status` + `shelter_status`.
- **D-3 — ฟื้นข้อมูลศูนย์ที่ปิดไปแล้ว** — ✅ ตัดสิน 2026-10-22 (แก้ตามคำตอบ kong — ดู Decision log): ฟื้นเฉพาะศูนย์ที่ยังอยู่ในระยะ retention ผ่าน bootstrap (หลัง backfill FR-22); ศูนย์ที่เลยระยะไม่ฟื้น. ทางเลือกเดิม — แนะนำ: ฟื้นผ่าน bootstrap (Migration) เพื่อให้ผลค้นหาครบทันทีหลัง deploy. ทางเลือก: ฟื้นเฉพาะศูนย์ที่ registry มี `closed_at` อยู่ในระยะ retention · ไม่ฟื้น (มีผลเฉพาะศูนย์ที่ปิดหลัง deploy).
- 2026-10-22 — D-3 ปรับตามที่ผู้ตัดสินใจยืนยันในแชต: ฟื้นเฉพาะศูนย์ที่ยังอยู่ในระยะ retention; ศูนย์ที่เลยระยะไม่ฟื้น — แก้ FR-7, FR-8, Migration และ Acceptance ให้ตรงกัน ตัวเลือก "ฟื้นทั้งหมด" ถูกยกเลิก
- **D-4 — ฟังศูนย์ปิดในระยะ retention (FR-7/FR-8)** — ✅ ตัดสิน 2026-10-22: ฟัง — ยืนยันขอบเขต listener โดย kong แล้ว (ดูรายการ 2026-10-22 ด้านล่าง); ผลต่อ CR-017 Decision D ต้องอัปเดตตอน implement. ทางเลือกเดิม — แนะนำ: ทำ — ไม่งั้น opt-out หลังปิดไม่มีผล (privacy).
- 2026-10-22 — **approved** ยืนยันอีกครั้งโดยผู้ตัดสินใจ (ยืนยันในแชต) — การลบข้อมูลของศูนย์ที่ปิด (`public_persons`, `public_needs`, `shelter_stocks`, `shelter_occupants`; `public_shelters` ไม่ถูกลบตาม FR-1) ต้องอิงกฎ CR-183 เท่านั้น (FR-3/FR-4) · D-4 listener scope ได้รับการยืนยันแล้ว · แก้ความขัดแย้งเรื่องแถว `public_shelters` ของศูนย์ที่เลยระยะ: คงไว้ตาม FR-1 (ปรับ FR-8 และ Acceptance ให้ตรงกัน) · FR-8 ตรงกับ D-3 แล้ว (ฟื้นเฉพาะศูนย์ในระยะ retention) — **ยืนยันโดย kong** (2026-10-22) การแก้ความขัดแย้งนี้ตาม FR-1: คงแถว `public_shelters` ของศูนย์ปิดไว้
- **D-5 — ศูนย์ `closed` ที่ `closed_at = null`** — ✅ ตัดสิน 2026-10-22 (ยืนยันโดย kong): คงกฎเดิมใน FR-5 — retention ไม่ลบ `public_persons` และ log warning. ความเสี่ยงที่ยอมรับ: ข้อมูลคนของศูนย์ที่ไม่มีเวลาปิดจะคงอยู่บน public plane เกินนโยบาย §7 จนกว่าจะแก้ข้อมูล เพื่อลดจำนวนเคสนี้ CR กำหนด FR-14 (PATCH), FR-23 (import) และ FR-24 (projector). ทางเลือกที่ไม่เลือก: ถือว่า `null` เป็นหมดระยะแล้วลบผ่าน audit.
- 2026-10-22 — FR-23: import ห้ามตั้งสถานะ `closed` (ปฏิเสธแถว) แทนการ stamp `closed_at` เป็นเวลานำเข้า — ปิดศูนย์ได้จากหน้า staff เท่านั้น (ยืนยันโดย kong). ทางเลือกที่ไม่เลือก: stamp เวลานำเข้า (คงข้อมูลเกินจริงเมื่อนำเข้าย้อนหลัง) · เพิ่มคอลัมน์วันที่ปิด (ต้องแก้ schema §3.1).
- 2026-10-22 — FR-22 fallback `source = now`: ใช้ตามที่เขียนไว้ — คนรันตรวจรายงาน dry-run (มี `source` ทุกรายการ) ก่อนสั่ง `--write --confirm` ไม่เพิ่มด่านกั้น (ยืนยันโดย kong). เหตุผล: `updated_at` เป็นค่าบังคับของ shelter รายการ `now` จึงน่าจะมีน้อย. ทางเลือกที่ไม่เลือก: บังคับ flag `--allow-now` · ตั้งเวลาย้อนหลังให้ถือว่าหมดระยะ.