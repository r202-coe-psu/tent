---
id: CR-166
title: Public name search — เปลี่ยนจาก "ตรงคำเดียว (OR)" เป็น "ชื่อต้น AND นามสกุลเต็ม" (GitHub #533)
status: approved # proposed | approved | done | rejected | superseded
date: 2026-10-13
updated: 2026-10-13
requested_by: GitHub issue #533 (r202-coe-psu/tent) — ค้น "สมหมาย มีบุญ" ได้ "สมหมาย มี****" (นามสกุลจริง มีโชค)
decided_by: เจ้าของโครงการ — เคาะ D1–D3, D8, D10 ระหว่างร่าง; approve ทั้ง CR 2026-10-13 (รวมข้อเสนอ D3b, D4, D5–D7 ตามที่เขียน — ดูตาราง Decisions)
layer: volatile
affects:
  - docs/features/public-tier-find-spec.html §3 FS-1 (บรรทัด ~258-330; "token match ขั้นต่ำ 3 ตัวอักษร" ที่ ~297, ~514, ~662, ~722)
  - docs/task-breakdown/11-famsearch.md:47 (FS-1 DoD "token ≥3 ตัว")
  - docs/data/couchdb-mongodb-sync.md §3.2 (public_persons shape ~104-117), §endpoint (~261), index list (~305-306)
  - docs/data/api-contract.md (~431 ตาราง public endpoint, ~511 ตาราง /external/v1)
  - docs/changes/11-famsearch/CR-099-public-search-real-stay-status.md (ส่วน "ค้นชื่อ" ถูกแทนที่บางส่วน)
  - docs/changes/_index.md (แถว CR-166)
  - packages/tent-model/src/tent_model/public_person.py (field + index)
  - worker/src/worker/masking.py, worker/src/worker/projectors/evacuee.py, worker/src/worker/projection_version.py (2 → 3)
  - backend/apiapp/utils/masking.py, backend/apiapp/utils/search_query.py, backend/apiapp/modules/evacuee/use_case.py
  - frontend/src/routes/(public)/search/+page.svelte, frontend/src/lib/features/public-portal/ui/family-search-modal.svelte, frontend/src/lib/constants/i18n/public-search.ts, frontend/src/lib/features/public-portal/domain/search-query.ts (ใหม่)
  - /external/v1/occupants (partner-facing — ใช้ use case เดียวกัน)
  - ไม่ bump schema_v (CouchDB evacuee doc ไม่เปลี่ยน); Mongo public_persons shape เปลี่ยน → PROJECTION_VERSION 2 → 3
why: ค้นชื่อ+นามสกุลคืนคนที่นามสกุลไม่ตรง (false positive) เพราะ $text OR คำ และระบบตรวจนามสกุลจริงไม่ได้
migration: PROJECTION_VERSION 2 → 3 (worker re-bootstrap อัตโนมัติ) + index ใหม่ผ่าน Beanie — ดู §Migration
---

# Public name search — ชื่อต้น AND นามสกุลเต็ม

> **สถานะ:** approved 2026-10-13 (เดิม `draft-public-name-search-and-match`; รันเลข CR-166 หลังตรวจว่าว่างบน `origin/develop` และทุก remote branch).

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** name search ของ `POST /public/v1/occupants` และ `POST /external/v1/occupants` เลิกใช้ `$text` (OR ทุกคำ) และเลิก match `last_name_masked` → ใช้ **ชื่อต้นแบบขึ้นต้น AND นามสกุลเต็มแบบ exact (ผ่าน hash)**; ความยาวขั้นต่ำเปลี่ยนจาก "ทั้งก้อน ≥3 ตัวอักษร" เป็น "ทุกคำ ≥2 grapheme".
- **ทำไม:** `สมหมาย มีบุญ` คืน `สมหมาย มี****` (นามสกุลจริง มีโชค) เพราะแค่ชื่อต้นตรง + worker project เฉพาะนามสกุลที่ mask จึงตรวจนามสกุลจริงไม่ได้ (#533).
- **dev ต้อง build:** field ใหม่ `first_name_key`, `last_name_hash` ใน `public_persons` (worker projector) + helper normalize 3 ตัวที่ผลเหมือนกันทุก byte ในทั้ง worker/backend + query ใหม่ + index ใหม่ 2 ตัว + validation ฝั่ง frontend ตรงกัน.
- **กระทบ:** `PROJECTION_VERSION` 2 → 3 (full re-bootstrap; ระหว่างนั้นค้นชื่อได้ 0/บางส่วน — เจ้าของรับแล้ว), `schema_v` ไม่เปลี่ยน, partner ที่ใช้ `/external/v1/occupants` เห็นพฤติกรรมเปลี่ยน, e2e 2 เคส (E01 + short-query-recover) พัง.

## Decisions

| #   | เรื่อง                        | ข้อสรุป                                                                                                                                                       | สถานะ                                                                                                              |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| D1  | คำค้นหลายคำ                   | **AND** — คำแรก(หลายคำ) = prefix ของชื่อต้น; คำที่เหลือต้องเท่ากับนามสกุล**เต็ม** exact (ผ่าน hash)                                                           | เจ้าของตัดสินใจแล้ว 2026-10-13                                                                                     |
| D2  | คำค้นคำเดียว                  | ชื่อต้นขึ้นต้นด้วยคำนั้น **หรือ** นามสกุลเต็มตรงเป๊ะ (ผ่าน hash)                                                                                              | เจ้าของตัดสินใจแล้ว                                                                                                |
| D3  | ความยาวขั้นต่ำ                | **ทุกคำ ≥ 2 grapheme** (แทน "ทั้งก้อน ≥ 3 ตัวอักษร" ของ FS-1/CR-005)                                                                                          | เจ้าของตัดสินใจแล้ว                                                                                                |
| D3b | จำนวนคำสูงสุด                 | **4 คำ** (เกิน → 422) เพื่อจำกัดจำนวน `$or` branch                                                                                                            | อนุมัติตามข้อเสนอ 2026-10-13                                                                                       |
| D4  | การเรียงผล                    | `first_name_key ASC, _id ASC`, limit 10 (`NAME_RESULT_LIMIT` เดิม)                                                                                            | อนุมัติตามข้อเสนอ 2026-10-13 (เหตุผล: ผลต้อง deterministic เมื่อ >10 ราย)                                          |
| D5  | field ใหม่ใน `public_persons` | `first_name_key`, `last_name_hash` — **ไม่มี salt** (เหมือน `phone_hash`/`national_id_hash`); **ห้าม**คืนใน API response                                      | อนุมัติตามข้อเสนอ 2026-10-13 (ไม่ใส่ salt — ดู R2)                                                                 |
| D6  | `$text` / `last_name_masked`  | เลิกใช้ทั้งคู่ในการค้น; index ใหม่ = compound `(last_name_hash, first_name_key)` + `(first_name_key)`; **คง index เก่าไว้ใน DB** จนระบบนิ่ง แล้ว drop ด้วยมือ | อนุมัติตามข้อเสนอ 2026-10-13                                                                                       |
| D7  | version                       | `PROJECTION_VERSION` 2 → 3; ไม่ bump `schema_v` (evacuee doc ใน CouchDB ไม่เปลี่ยน)                                                                           | อนุมัติตามข้อเสนอ 2026-10-13 (issue #533 เสนอไว้)                                                                  |
| D8  | วิธี deploy                   | deploy ทุก service รอบเดียวในช่วงที่ไม่มีผู้ใช้; ค้นชื่อได้ 0/บางส่วนระหว่าง re-bootstrap — **รับได้**                                                        | เจ้าของตัดสินใจแล้ว 2026-10-13                                                                                     |
| D9  | partner API                   | `/external/v1/occupants` เปลี่ยนตาม (use case เดียวกัน) → ต้องแจ้ง partner                                                                                    | ข้อเท็จจริงจากโค้ด; approve 2026-10-13 — เจ้าของโครงการดูแลการแจ้ง partner เอง (partner มีไม่มาก) |
| D10 | วิธี track                    | CR ไฟล์ (draft → CR-166 ใน `11-famsearch/`)                                                                                                                   | เจ้าของตัดสินใจแล้ว                                                                                                |

## Requirements

### R-A. Normalization (ต้องให้ผลเหมือนกันทุก byte ใน worker และ backend)

- **NS-01** — `name_key(s)` = `unicodedata.normalize("NFKC", s)` → `.casefold()` → ยุบช่องว่างติดกันเป็นช่องว่างเดียว (`\s+` → `" "`) → `.strip()`.
- **NS-02** — `surname_key(s)` = `name_key(s)` แล้วลบช่องว่าง**ทั้งหมด**ออก.
- **NS-03** — `last_name_hash(s)` = `sha256_hex(surname_key(s))` (`sha256_hex` = UTF-8 SHA-256 hex เดิมใน `masking.py`); คืน `None` เมื่อ `surname_key(s)` ว่าง.
- **NS-04** — ฟังก์ชันทั้ง 3 ต้องมีใน `worker/src/worker/masking.py` และ `backend/apiapp/utils/masking.py` (สำเนาคู่ เหมือนที่ `phone_hash` ทำอยู่) พร้อม test vector ชุดเดียวกันทั้งสองฝั่ง (อย่างน้อย: `ำ` vs `ํา` → key เท่ากัน, `SOMCHAI` vs `somchai`, นามสกุลมีช่องว่าง `van der Berg` → `vanderberg`, ค่าว่าง → `None`).

### R-B. Projection (`public_persons`)

- **NS-05** — projector evacuee เขียน `first_name_key = name_key(first_name)` (ไม่เป็น `None` — ว่างคือ `""`) และ `last_name_hash = last_name_hash(last_name)` ลง payload.
- **NS-06** — `last_name_masked` ยัง project ต่อเหมือนเดิม (ใช้แสดงผล); `last_name` เต็มยัง**ห้าม**อยู่ใน payload (test เดิมที่ assert `"last_name" not in payload` ต้องคงอยู่).
- **NS-07** — `PublicPerson` เพิ่ม `first_name_key: str = ""` และ `last_name_hash: str | None = None`; ทั้งสอง field **ห้าม**อยู่ใน `SearchResult`/response ใดๆ.
- **NS-08** — `PROJECTION_VERSION = 3`.
- **NS-08b** — การ re-project จากการ bump ครอบคลุมเฉพาะ shelter database ที่ `is_shelter_open` (`bootstrap_all` วน `list_open_shelter_codes`, `worker/src/worker/couch/bootstrap.py` ~บรรทัด 208). แถว `public_persons` ของศูนย์ที่ `public_shelters.status == "closed"` ถูก retention loop ลบอยู่แล้ว (`reconcile_closed_shelters`, `worker/src/worker/retention/job.py` ~บรรทัด 91-107, รอบละ 300 วินาที) จึงไม่ต้อง re-project. ช่องว่างที่เหลือคือศูนย์ที่ `is_shelter_open` เป็น False แต่ `public_shelters.status` ไม่ใช่ `closed` (เช่น registry doc ไม่มี `operation_status`/`status` เลย — `resolve_operation_status` คืน `None` → bootstrap ข้าม แต่ `map_public_shelter_status` ให้ `open`) — แถวเหล่านั้นจะไม่มี field ใหม่ ดู R7.

### R-C. Query parsing (`parse_search_query`, หลังตรวจว่าไม่ใช่เลขบัตร/passport/เบอร์โทร)

- **NS-09** — `normalized = name_key(raw)`; `tokens = normalized.split(" ")`.
- **NS-10** — ทุก token ต้องยาว ≥ 2 grapheme (นับด้วย `grapheme.length` จาก lib `grapheme` ที่ backend ใช้อยู่แล้ว) มิฉะนั้นคืน `None` (→ 422).
- **NS-11** — token > 4 คำ → `None` (→ 422) _(D3b)_.
- **NS-12** — `ParsedSearchQuery.normalized` ของชื่อ = `normalized` ข้างต้น (ไม่ใช่ `raw`); `query_hash` ใน `SearchAudit` (`use_case.py:165` = `sha256_hex(parsed.normalized)`) จึงเปลี่ยนค่าตาม — ดู Risks.
- **NS-13** — เส้นทาง national_id / passport / phone **ไม่เปลี่ยน** (ลำดับการตรวจ, exact hash, ไม่ผ่าน `name_key`).

### R-D. Query construction (`_find_by_name`)

ทุกกรณี: filter `search_excluded != True`, sort `[("first_name_key", 1), ("_id", 1)]`, `limit(NAME_RESULT_LIMIT = 10)`. **ห้ามใช้ `$text` และห้าม match `last_name_masked`.**

- **NS-14** — 1 token `t`:
  `{"$or": [{"first_name_key": {"$regex": "^" + re.escape(t)}}, {"last_name_hash": last_name_hash(t)}]}`.
- **NS-15** — n ≥ 2 tokens: ลอง**ทุกจุดแบ่ง** `k = 1 … n-1` (รองรับชื่อต้นหลายคำ เช่น "John Paul Smith") แล้ว OR กัน:
  `{"$or": [{"first_name_key": {"$regex": "^" + re.escape(" ".join(tokens[:k]))}, "last_name_hash": last_name_hash("".join(tokens[k:]))} for k in 1..n-1]}`.
- **NS-16** — ผลลัพธ์ต่อ query เป็น 1 round trip (ไม่มี fallback 2 ขั้นแบบ CR-099 อีก).

### R-E. Response / ขอบเขตที่ไม่เปลี่ยน

- **NS-17** — รูปร่าง `SearchRequest`/`SearchResponse` ไม่เปลี่ยน → `pnpm openapi:update` ต้องไม่มี diff (รันเพื่อยืนยัน; ถ้ามี diff ให้ commit `fastapi.json` + `openapi.d.ts`).
- **NS-18** — family members, masking (นามสกุล/เลขบัตร/ที่อยู่), สถานะจริง (CR-099), rate limiter, `search_excluded`, `NAME_RESULT_LIMIT` — ไม่เปลี่ยน.

### R-F. Index (`public_person.py`)

- **NS-19** — เพิ่ม `IndexModel([("last_name_hash", 1), ("first_name_key", 1)])` และ `IndexModel([("first_name_key", 1)])`.
- **NS-20** — ลบ TEXT index `(first_name, last_name_masked)` และ index `last_name_masked` ออกจาก `Settings.indexes`. Beanie ไม่ได้เปิด `allow_index_dropping` (ตรวจแล้ว: ไม่พบการตั้งค่านี้ใน `backend/`, `packages/`, `worker/`) → index เก่าจะค้างใน DB เดิมโดยไม่มีผล; index `first_name` (btree) คงอยู่ตามเดิม.

### R-G. Frontend

- **NS-21** — เพิ่ม `validateSearchQuery(q): 'ok' | 'tooShort'` ใน `features/public-portal/domain/search-query.ts` (+ `.test.ts`, export ผ่าน `index.ts`): trim, ยุบช่องว่าง; ถ้าเป็นตัวเลขล้วน/รูปแบบ passport/เบอร์ → ผ่าน (ให้ backend ตัดสิน); มิฉะนั้นทุกคำต้อง ≥ 2 grapheme (`Intl.Segmenter`) โดย **normalize NFKC + casefold ก่อนนับ** ให้เหมือน `name_key` ฝั่ง backend. backend (422) เป็นตัวตัดสินสุดท้าย; ต้องมี test vector ภาษาไทยชุดเดียวกับฝั่ง Python (เช่น `สม` = 2, `ที่` = 1, `ก` = 1, `มีโชค` = 4, `สักก์` = 3 ตาม `grapheme.length` ที่ตรวจแล้ว).
- **NS-22** — `+page.svelte` (ปัจจุบัน `query.length < 3` ที่บรรทัด 48 ไม่ trim) และ `family-search-modal.svelte` (ปัจจุบัน `query.trim().length < 3` ที่บรรทัด 35) ใช้ helper เดียวกัน และส่ง `query.trim()` ไป API.
- **NS-23** — แก้ข้อความใน `public-search.ts` ทั้ง TH และ EN: `errorMinChars` (TH บรรทัด 13 / EN 58) และ `tooShort` (TH 102 / EN 121) → "อย่างน้อย 2 ตัวอักษรต่อคำ"; `searchBoxDesc` (9/54) และ `description` (97/115) อธิบายว่าค้นด้วย "ชื่อ, ชื่อ + นามสกุลเต็ม หรือนามสกุลเต็ม"; `noResults` (104/123) แนะนำให้ลองค้นด้วยชื่อต้นอย่างเดียว.
- **NS-24** — **ห้ามเปลี่ยน** `searchPlaceholder` (บรรทัด 10) เพราะ e2e ใช้ข้อความนี้หา textbox (`SEARCH_BOX`).
- **NS-25** — ทุก `.svelte` ที่แก้ต้องผ่าน `svelte-autofixer`.

## Use case เดิม vs ใหม่

ตัวอย่างใช้คน **สมหมาย มีโชค** (masked `มี****`). ถ้ามีคนชื่อสมหมายเกิน 10 คน ผลถูกตัดที่ 10 ทั้งเดิมและใหม่.

| #   | คำค้น                                   | เดิม                                                                     | ใหม่                                                                  | ผลกระทบ                                                     |
| --- | --------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| U1  | `สมหมาย มีโชค`                          | เจอ แต่เพราะชื่อต้นตรงอย่างเดียว ปนกับสมหมายคนอื่นสูงสุด 10 คน ลำดับสุ่ม | เจอ**เฉพาะ**คนที่ชื่อขึ้นต้น "สมหมาย" **และ** นามสกุล "มีโชค"         | แม่นขึ้น คนที่หาไม่หลุดจาก 10 อันดับ                        |
| U2  | `สมหมาย มีบุญ`                          | เจอ (false positive)                                                     | **ไม่เจอ**                                                            | แก้ bug หลักของ #533                                        |
| U3  | `สมหมาย บุญ`                            | เจอ (false positive)                                                     | **ไม่เจอ** (นามสกุลต้องเต็ม)                                          | ญาติที่จำนามสกุลไม่ครบหาไม่เจอ ต้องค้นด้วยชื่อต้นอย่างเดียว |
| U4  | `สมห มีโชค`                             | ไม่เจอ (`$text` ได้ 0 และ fallback ใช้ทั้งก้อน)                          | **เจอ** (ชื่อต้นขึ้นต้น + นามสกุลเต็ม)                                | ความสามารถใหม่                                              |
| U5  | `สมหมาย`                                | เจอ ≤10 คน ลำดับไม่แน่นอน                                                | เจอ ≤10 คน **ลำดับคงที่**                                             | ≈ เดิม                                                      |
| U6  | `มีโชค`                                 | **ไม่เจอ** (index มีแค่ "มี")                                            | **เจอ**ทุกคนที่นามสกุล "มีโชค" ≤10                                    | ความสามารถใหม่ ตรงกับ UI ที่บอกว่าค้นด้วย "สกุล" ได้        |
| U7  | `มีโช` (นามสกุลไม่ครบ)                  | ไม่เจอ                                                                   | ไม่เจอ                                                                | =                                                           |
| U8  | `สัก` (CR-099: ชื่อต้นแบบขึ้นต้น)       | เจอผ่าน fallback                                                         | เจอผ่าน prefix ตรงๆ                                                   | = ไม่ regress CR-099                                        |
| U9  | `ธนัชญ์` (คำกลางชื่อ)                   | ไม่เจอ                                                                   | ไม่เจอ (anchored เหมือนเดิม)                                          | =                                                           |
| U10 | `สม` (2 ตัว)                            | **422** (ทั้งก้อน < 3)                                                   | **ผ่าน**: ชื่อต้นขึ้นต้น "สม" ≤10 คน หรือนามสกุล "สม" ตรงเป๊ะ         | **ผ่อนเกณฑ์ anti-browse** ตามที่เจ้าของเลือก — ดู Risks R1  |
| U11 | `ก ข`                                   | **ผ่าน** (ทั้งก้อนยาว 3) แล้วอาจ match token จากนามสกุลที่ mask          | **422** (มีคำยาว < 2)                                                 | ปิดช่องเลี่ยงที่ issue ชี้ไว้                               |
| U12 | `สมหมาย มี`                             | เจอ (สมหมาย + ทุกคนที่นามสกุลขึ้นต้น "มี")                               | ไม่เจอ (hash "มี" ≠ "มีโชค")                                          | เลิกใช้นามสกุลที่ mask ในการ match                          |
| U13 | `Somchai` / `SOMCHAI`                   | เจอ (`$text` ไม่สนตัวพิมพ์)                                              | เจอ (key ผ่าน casefold)                                               | =                                                           |
| U14 | `John van der Berg`                     | OR ทุกคำ                                                                 | first=`john` + surname=`vanderberg` (ตัดช่องว่างใน key)               | นามสกุลหลายคำใช้ได้                                         |
| U15 | `John Paul Smith` (ชื่อต้น "John Paul") | OR                                                                       | ลองทุกจุดแบ่ง (`john`/`paulsmith`, `john paul`/`smith`) แล้ว OR → เจอ | รองรับชื่อต้นหลายคำ                                         |
| U16 | เลขบัตร / passport / เบอร์โทร           | exact ผ่าน hash                                                          | **ไม่เปลี่ยน**                                                        | =                                                           |
| U17 | ผล family members                       | ชื่อต้น + นามสกุลที่ mask                                                | **ไม่เปลี่ยน**                                                        | =                                                           |

**สิ่งที่ผู้ใช้/partner เห็นต่าง:**

1. ข้อความ error ขั้นต่ำ: "อย่างน้อย 3 ตัวอักษร" → "อย่างน้อย 2 ตัวอักษรต่อคำ".
2. พิมพ์นามสกุลผิด/ไม่ครบ → ได้ "ไม่พบรายชื่อ" แทนรายชื่อทุกคนที่ชื่อต้นเหมือนกัน (ข้อความ `noResults` แนะนำให้ค้นด้วยชื่อต้นอย่างเดียว).
3. ค้นด้วยนามสกุลเต็มอย่างเดียวได้ (U6).
4. Partner `/external/v1/occupants` ได้พฤติกรรมเดียวกัน (กติกา AND, ขั้นต่ำ 2 ตัวอักษร/คำ, ลำดับผลคงที่, `query_hash` ใน audit เปลี่ยนวิธีคำนวณ) — ต้องแจ้งล่วงหน้า และอัปเดต `api-contract.md`.

## Risks & trade-offs

| #   | ความเสี่ยง                                                                                                                                                                                        | ผลกระทบ                                                                     | การจัดการ                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **U10 — ผ่อน anti-browse:** query 2 ตัวอักษรผ่านแล้ว (เดิมต้อง ≥3) — อ่อนกว่าเจตนา CR-099/FS-1 ที่กัน "เดาแล้วไล่ดูคนทั้งระบบ"                                                                    | ผู้ไม่ประสงค์ดีไล่ prefix 2 ตัวได้ถี่ขึ้น                                   | พึ่ง **per-IP rate limit + cap 10 ผล + `SearchAudit`** เท่านั้น — **trade-off ที่ต้องให้เจ้าของลงนามรับตอน approve**. ทางถอย: ปรับเกณฑ์เป็น 3 ได้ที่ `search_query.py` + `validateSearchQuery` โดยไม่กระทบข้อมูล |
| R2  | `last_name_hash` **ไม่มี salt** → ใครเข้าถึง Mongo `public_persons` ได้สามารถเดานามสกุลด้วย dictionary attack                                                                                     | นามสกุลเต็มเดาย้อนได้                                                       | ความเสี่ยงระดับเดียวกับ `phone_hash`/`national_id_hash` เดิม (exposure class เดียวกัน); ไม่มี field ใหม่ใน API response; เจ้าของตัดสินใจ "ไม่ salt" แล้ว (D5)                                                    |
| R3  | ผู้ใช้จำนามสกุลได้ไม่ครบ → "ไม่พบ" (U3, U7, U12)                                                                                                                                                  | ญาติหาคนไม่เจอ ทั้งที่มีในระบบ                                              | UI hint ใน `noResults` ให้ลองค้นด้วยชื่อต้นอย่างเดียว (NS-23); ไม่ทำ partial surname (Out of scope)                                                                                                              |
| R4  | ช่วง re-bootstrap หลัง deploy: แถวที่ยังไม่ถูก re-project ไม่มี `first_name_key`/`last_name_hash` → ค้นชื่อได้ 0/บางส่วน                                                                          | ญาติค้นไม่เจอชั่วคราว (เส้นทางเบอร์/เลขบัตรไม่กระทบ)                        | เจ้าของรับแล้ว (D8): deploy ครั้งเดียวในช่วงไม่มีผู้ใช้ + ห้าม deploy ระหว่างเหตุภัยพิบัติ/ศูนย์เปิดรับ; จดเวลา bootstrap จริงจาก staging                                                                        |
| R5  | `query_hash` ใน `SearchAudit` เปลี่ยนค่า (hash ของ `name_key` แทน raw)                                                                                                                            | audit เก่า/ใหม่ของคำค้นเดียวกันเทียบ hash ตรงๆ ไม่ได้                       | ยอมรับ; บันทึกใน migration note                                                                                                                                                                                  |
| R6  | `first_name_key` ใช้ prefix regex ต้องอาศัย index — ถ้า index ยังสร้างไม่เสร็จ query ช้า                                                                                                          | latency ช่วงแรกหลัง deploy                                                  | Beanie สร้าง index ตอน init; ตรวจ `getIndexes()` ในขั้น deploy                                                                                                                                                   |
| R7  | **ศูนย์ที่ bootstrap ข้ามแต่ retention ไม่ลบ** (ช่องว่างแคบ: registry doc ไม่มี `operation_status`/`status`; หรือช่วงก่อนรอบ retention ถัดไปหลังปิดศูนย์) → แถว `public_persons` ไม่มี field ใหม่ | คนในศูนย์เหล่านั้นค้นด้วยชื่อ/นามสกุลไม่เจอ (เบอร์/เลขบัตร/passport ยังเจอ) | ตัวเช็ก `countDocuments({first_name_key: {$exists: false}})` ใน checklist จะจับได้; ถ้า count > 0 ให้ตรวจว่าเป็นศูนย์แบบไหนก่อน แล้วค่อยทำ backfill (ดู Open item 4)                                             |

## Affects

**Docs (แก้เมื่อ approve — ยังไม่แก้ในร่างนี้):**

| ไฟล์                                                                                                                 | การเปลี่ยน                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `docs/features/public-tier-find-spec.html` §3 FS-1 (~258-330; จุดที่อ้าง "≥3" ~297, ~514, ~662, ~722)                | เปลี่ยนกติกาชื่อ/สกุลเป็น AND + ขั้นต่ำ 2 grapheme/คำ + sort                     |
| `docs/task-breakdown/11-famsearch.md:47`                                                                             | "ชื่อ-สกุล (token ≥3 ตัว, max 10 ผล)" → กติกาใหม่ + อ้าง CR-166                  |
| `docs/data/couchdb-mongodb-sync.md` (shape ~104-117, endpoint ~261, index ~305-306; บรรทัด 20 เหตุผลที่อ้าง `$text`) | เพิ่ม `first_name_key`, `last_name_hash`; อัปเดตรายการ index; เลิกพูดถึง `$text` |
| `docs/data/api-contract.md` (~431, ~511)                                                                             | หมายเหตุกติกาค้นชื่อ (มีผลกับ partner)                                           |
| `docs/changes/11-famsearch/CR-099-public-search-real-stay-status.md`                                                 | เพิ่มลิงก์ "ส่วน name matching ถูกแทนที่บางส่วนโดย CR-166"                       |
| `docs/changes/_index.md`                                                                                             | เพิ่มแถว CR-166 (11-famsearch), จำนวน CR 2 → 3, `updated:`                       |

**Code:**

| ชั้น                 | ไฟล์                                                                                                                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared model         | `packages/tent-model/src/tent_model/public_person.py` — field + index (บรรทัด 34-45 เป็น `Settings.indexes` ปัจจุบัน)                                                                                                                                                              |
| Worker               | `worker/src/worker/masking.py`, `worker/src/worker/projectors/evacuee.py` (payload ~116-135), `worker/src/worker/projection_version.py` (`PROJECTION_VERSION: int = 2` → 3)                                                                                                        |
| Backend              | `backend/apiapp/utils/masking.py`, `backend/apiapp/utils/search_query.py` (เกณฑ์เดิม `len(raw) < 3` บรรทัด 77), `backend/apiapp/modules/evacuee/use_case.py` (`_find_by_name` 208-251; `query_hash` บรรทัด 165)                                                                    |
| Backend (ไม่แก้โค้ด) | `backend/apiapp/modules/external/router.py` — ได้ผลตามผ่าน use case                                                                                                                                                                                                                |
| Frontend             | `frontend/src/routes/(public)/search/+page.svelte`, `frontend/src/lib/features/public-portal/ui/family-search-modal.svelte`, `frontend/src/lib/constants/i18n/public-search.ts`, `frontend/src/lib/features/public-portal/domain/search-query.ts` (ใหม่) + test, `index.ts` barrel |

## Test / E2E impact

สิ่งที่ต้องทำ:

| ชั้น          | ไฟล์                                                   | สิ่งที่ต้องทำ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend       | `backend/tests/test_search_query.py`                   | `"สม"` ผ่าน; `"ก ข"`/`"ก"` → `None`; 5 token → `None`; NFKC/whitespace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Backend       | `backend/tests/test_evacuee.py`                        | `_insert_person` (บรรทัด 22-28) เป็นแค่ `insert_one(doc)` — ทุก doc ที่ test สร้างต้องใส่ `first_name_key`/`last_name_hash` (คำนวณด้วย helper จริง); เคส `"ab"` ใน `test_evacuee_search_rejects_invalid_query` (บรรทัด 374-382) **จะไม่ 422 อีก** → เปลี่ยนเป็น `"a"`/`"a b"`; เพิ่มเคสครอบคลุม U1-U7, U10-U15 (หัวใจ: `สมหมาย มีบุญ` → 0, `สมหมาย มีโชค` → เฉพาะคนนั้น, `มีโชค` → เจอ, `สมห มีโชค` → เจอ, ลำดับคงที่เมื่อ >10); `test_evacuee_search_matches_a_thai_name_prefix` (282-339) ต้องยัง pass (`สักก์` → 1, `ธนัชญ์` → 0)                                                                                                        |
| Backend       | `backend/tests/test_masking.py`                        | test vector ของ `name_key`/`surname_key`/`last_name_hash` ตรงกับฝั่ง worker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Worker        | `worker/tests/projectors/test_projectors.py`           | `test_project_evacuee_maps_person_id_and_masked_fields` (บรรทัด 190) assert field ใหม่ + ยังคง `"last_name" not in payload`; เพิ่ม test vector                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Worker        | `worker/tests/integration/test_projection_contract.py` | assert `last_name_hash`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Worker        | `worker/tests/test_projection_version.py`              | ไม่ต้องแก้ (อ้างค่าคงที่)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Frontend unit | `search-query.test.ts` (ใหม่)                          | ครอบ `validateSearchQuery`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| E2E           | `frontend/e2e/public-search-flow.test.ts`              | **E01** (บรรทัด 83, `@smoke @release @prod`) และ **"rejects a short query then recovers…"** (160) **พัง** — input `'ทด'` (2 grapheme) ผ่านเกณฑ์ใหม่แล้ว → เปลี่ยนเป็น `'ท'` (หรือ `'ทด ก'`), เปลี่ยนข้อความ error ที่คาดหวัง + ชื่อ test; เทสต์อื่นในไฟล์ (prefix, household, deep link, phone/national ID/passport, empty state, S1 mock, teardown) ไม่กระทบ; เพิ่ม test `@critical`: `${HEAD} ${LAST_NAME}` → 1 รายการ, `${HEAD} ทดสอบ` → ไม่พบ, `${HEAD} ผิดนามสกุล` → ไม่พบ, `${PREFIX} ${LAST_NAME}` → `TOTAL` รายการ (ไม่ทำ e2e นามสกุลอย่างเดียว เพราะ `FIXTURE_LAST_NAME` ใช้ร่วมทุก run/env นับจำนวนไม่ได้ — ทดสอบที่ backend แทน) |

## Migration

- **`schema_v`:** N/A — CouchDB `evacuee` doc ไม่เปลี่ยน; ไม่ต้องแปลง doc ใดใน CouchDB.
- **Mongo `public_persons` shape เปลี่ยน** (เพิ่ม `first_name_key`, `last_name_hash`) → `PROJECTION_VERSION` 2 → 3. เมื่อ worker start เห็น stored < code จะ re-run full bootstrap อัตโนมัติ (`worker/src/worker/couch/bootstrap.py` `bootstrap_reason` ~บรรทัด 214-233) และบันทึกเวอร์ชันหลัง bootstrap สำเร็จเท่านั้น (ถ้าล้ม → ลองใหม่ตอน start ถัดไป).
- **Index ใหม่ 2 ตัว** สร้างโดย Beanie ตอน init FastAPI (ต้อง restart/rebuild FastAPI 1 ครั้ง).
- **Drop index เก่าด้วยมือ — ทำภายหลังเมื่อระบบนิ่ง (เช่น 1-2 สัปดาห์; ไม่ทำใน release เดียวกัน)** เพื่อให้ rollback ใช้ `$text` ได้. ก่อนรัน **ต้องยืนยันชื่อ index จริงด้วย `db.public_persons.getIndexes()`**; ชื่อที่คาด (ตามกติกา default ของ MongoDB — ยังไม่ได้ตรวจกับ DB จริง): `first_name_text_last_name_masked_text` และ `last_name_masked_1`:
  `db.public_persons.dropIndex("first_name_text_last_name_masked_text")` / `db.public_persons.dropIndex("last_name_masked_1")`.
- **Rollback:** ถอย fastapi + frontend เป็น image เดิม → backend เก่าใช้ `$text` ได้ทันที (TEXT index ยังอยู่). worker อาจไม่ต้องถอย: worker v2 เห็น stored v3 > code จะ log warning และไม่ bootstrap ซ้ำ (`bootstrap.py` `bootstrap_reason`); แถวที่มี field เกินไม่ทำให้ backend เก่าพัง. ไม่ต้องย้อนข้อมูล CouchDB.

## Deploy & rollback

ลำดับ: **staging ก่อน แล้ว prod**; ขึ้นทุก service (worker + fastapi + frontend) พร้อมกันรอบเดียว.

**ก่อน deploy**

- [ ] PR merge, CI/pre-push ผ่าน (ห้าม `--no-verify`); CR-166 `approved` และ docs อัปเดตแล้ว
- [ ] ไม่มีเหตุภัยพิบัติ/ศูนย์เปิดรับในช่วงนั้น (ญาติค้นตลอดคืน — "กลางคืน" อย่างเดียวไม่พอ)
- [ ] แจ้ง partner ที่ใช้ `/external/v1/occupants` ล่วงหน้า (AND, ≥2 ตัวอักษร/คำ, ค้นนามสกุลเต็มได้)
- [ ] จดเวลา bootstrap จริงจาก staging; backup Mongo (`scripts/backup-mongo.sh`); จด image/commit ปัจจุบันไว้ rollback

**ระหว่าง deploy**

- [ ] `up -d` ทุก service; log worker ต้องขึ้น `projection version upgrade from v2 to v3` ตามด้วย `Bootstrap finished (projection version 3 stored)`
- [ ] อย่าปิดงานจน bootstrap เสร็จ (ถ้าล้ม ค้นชื่อใช้ไม่ได้จนกว่าจะแก้)
- [ ] เช็ก Mongo: `db.public_persons.countDocuments({first_name_key: {$exists: false}})` = 0 และ `getIndexes()` มี `last_name_hash_1_first_name_key_1`, `first_name_key_1`

**หลัง deploy**

- [ ] ค้นจริงด้วย fixture e2e: ชื่อต้น → เจอ, ชื่อ+นามสกุลเต็ม → 1, ชื่อ+นามสกุลผิด → ไม่พบ, เบอร์/เลขบัตร → เจอ, `"ท"` → error ใหม่
- [ ] รัน prod smoke (`scripts/run-prod-e2e.sh`, `@prod`) **หลัง** deploy เสร็จเท่านั้น (E01 ใหม่ fail กับ prod เก่า); staging รัน `scripts/run-staging-e2e.sh` หลัง bootstrap เสร็จ
- [ ] ดู log fastapi: ไม่มี 5xx / 422 เพิ่มผิดปกติในวันแรก
- [ ] **ยังไม่ drop index เก่า** (ทำหลังนิ่ง ตาม §Migration)

## Out of scope

- เปลี่ยน rate limiter / PoW / anti-bot
- normalize คำค้นประเภท identifier (เลขบัตร, passport, เบอร์โทร)
- fuzzy / phonetic / สะกดใกล้เคียง
- ค้นด้วยนามสกุลบางส่วน (partial surname) — ต้องเป็นนามสกุลเต็มเท่านั้น

## Follow-ups (ก่อน/ระหว่าง implement)

1. **R1 (เกณฑ์ขั้นต่ำ 2 ตัวอักษร):** approve แล้วตามที่เจ้าของเลือก — ทางถอยคือปรับเป็น 3 ที่ `search_query.py` + `validateSearchQuery` โดยไม่กระทบข้อมูล.
2. **แจ้ง partner (D9):** เจ้าของโครงการดูแลเอง (partner มีไม่มาก) — ต้องแจ้งก่อน deploy ตาม §Deploy & rollback.
3. **แถวที่ไม่มี field ใหม่หลัง bootstrap (R7 — ความเสี่ยงต่ำ):** ไม่ต้องแก้โค้ดล่วงหน้า; ใช้ตัวเช็กใน checklist เป็นด่าน. ถ้า count > 0 ให้ (ก) **backfill evacuee อย่างเดียว** สำหรับศูนย์ที่ถูกข้าม (โหลด households → `project_evacuee` → `apply_person` ไม่แตะอย่างอื่น) — **แนะนำ**; หรือ (ข) ให้ `bootstrap_all` ใช้ `list_all_shelter_codes` ซึ่งจะ re-project donation / need counter / job / occupancy / needs ของศูนย์ที่ถูกข้ามด้วย (ผลข้างเคียงกว้าง ต้องประเมินก่อน). **ห้าม**แก้ด้วย Mongo อย่างเดียวเพราะนามสกุลเต็มมีแค่ใน CouchDB.

## Decision log

- 2026-10-13 — proposed (ร่างจาก GitHub #533; เจ้าของเคาะ D1–D3, D8, D10)
- 2026-10-13 — approved ทั้ง CR (รวมข้อเสนอ D3b/D4/D5–D7) → รันเลข CR-166; แก้ docs ที่เกี่ยวข้อง (ยังไม่แตะโค้ด)
