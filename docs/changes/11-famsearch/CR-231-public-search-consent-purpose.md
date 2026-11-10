---
id: CR-231
title: Public family search — บังคับ dialog ยินยอม + จุดประสงค์ และเก็บข้อมูลผู้ค้นหาใน audit_event
status: approved
date: 2026-11-06
requested_by: Dev Team B
decided_by: Soravit Sukkarn (Team Lead)
layer: volatile
issue: "#1159"
affects:
  - docs/data/schema.md §2.12 `audit` (ขยายเป็น audit_event: `event_type`/`domain`/`actor`/`target`/`outcome`/`context`, schema_v 1 → 2)
  - docs/data/schema.md §5.1 `search_audit` (superseded โดย audit_event; migrate แล้วหยุดเขียน)
  - docs/data/api-contract.md `POST /public/v1/occupants` (body + 422 + 503 SEARCH_UNAVAILABLE)
  - docs/data/couchdb-mongodb-sync.md §4.0 audit inbound (ตัด `pii` ก่อนเข้า CouchDB)
  - docs/features/public-tier-find-spec.html / public-tier-flow-spec.html (ข้อความ "search_audit เก็บ query text, IP hash")
  - frontend/src/lib/constants/i18n/public-policy.ts, public-term.ts (FR-19)
  - backend/apiapp/modules/evacuee/{schemas,router,use_case}.py, backend/tests/test_evacuee.py
  - packages/tent-model (AuditEvent), worker/src/worker/inbound (audit), worker/tests, migration script
  - frontend/src/lib/features/public-portal/{domain,data,ui}, routes/(public)/search, family-search-modal
  - frontend/e2e/public-search-flow.test.ts
  - frontend/src/lib/api-specs/fastapi.json + frontend/src/lib/api/openapi.d.ts (regenerate)
---

# CR-231 — Public family search — dialog ยินยอมและระบุจุดประสงค์ก่อนค้นหาผู้อพยพสาธารณะ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ก่อนค้นหาผู้อพยพสาธารณะ (`/search`, modal หน้าแรก `/`, ลิงก์ `/search?q=`) ผู้ค้นหาต้องกรอก
>   ชื่อ / นามสกุล / เบอร์ / จุดประสงค์ และติกยินยอม; FastAPI บังคับฝั่ง server
> - **เก็บอะไร:** audit เป็น `audit_event` เดียว (Mongo `audit_events`, id `audit:{ulid}`) เพิ่มข้อมูลผู้ค้นหา + IP จริง
>   + จุดประสงค์ + `consent_version` — PII อยู่ใน key `pii` **Mongo เท่านั้น** ไม่ sync เข้า CouchDB;
>   **ไม่มี retention — เก็บถาวรโดยตั้งใจ** (มติทีม #1213)
> - **ผลต่อ contract:** `POST /public/v1/occupants` body ใหม่ (422 ถ้าขาด) และ audit เป็น **fail-closed** (503)
> - **กระทบ:** `audit` schema_v 1 → 2 · `search_audits` ถูกแทนที่ (one-off migrate) · แก้หลักการ "hash เท่านั้น" · ไม่ทำ retention

---

## Why

- ที่มา: feedback อบรมระบบ 03/11/2026 — หน้า search ผู้อพยพต้องมี consent, ติกจุดประสงค์การค้นหา,
  เป็น dialog ให้กรอก และเก็บลง database (ชื่อ สกุล เบอร์ IP และเหตุผล)
- ปัจจุบัน endpoint public ไม่ต้อง auth และ `search_audit` เก็บเฉพาะ `query_hash` / `ip_hash` จึงย้อนไปหาตัวผู้ค้นหาไม่ได้
- ปัจจุบัน audit เป็น fail-open (เขียนไม่สำเร็จก็ยังตอบผลลัพธ์) — ขัดกับเจตนาให้ทุกการค้นต้องมีบันทึก

## Change

### 1. UI — dialog ยินยอม (component เดียวใช้ร่วม `/search` และ modal หน้าแรก)

- **FR-1** — component เดียวใน `$lib/features/public-portal/ui/` ใช้ทั้ง `(public)/search/+page.svelte` และ `family-search-modal.svelte`
- **FR-2** — เมื่อกดค้นหา ให้ตรวจคำค้นด้วย `validateFamilySearchQuery(query)` ก่อน; คำค้นไม่ผ่าน → แสดง error เดิม
  **ไม่เปิด dialog**. คำค้นผ่านและ session ยังไม่ได้ยืนยัน → จึงเปิด dialog; ค่าที่ยืนยันเก็บใน `sessionStorage`
  (ปิดแท็บ = กรอกใหม่) และใช้ร่วมกันทั้งสองจุด. การอ่าน/เขียน `sessionStorage` ต้องครอบด้วย `browser`
  (`import { browser } from '$app/environment'`) และ try/catch (storage ถูกบล็อกได้) — ถ้าอ่านไม่ได้ให้ถือว่ายังไม่ยืนยัน
- **FR-3** — ช่องกรอก:

  | ช่อง | กติกา |
  | --- | --- |
  | ชื่อ | บังคับ; trim แล้วยาว 1–100 |
  | นามสกุล | ไม่บังคับ; trim แล้วยาว 0–100; ว่าง = `''` (รองรับคนมีชื่อเดียว) |
  | เบอร์มือถือ | เบอร์มือถือไทย 10 หลัก `^0\d{9}$` (กติกาเดียวกับ `isThaiMobilePhone` ใน `$lib/db/model`; ฝั่ง server ตรวจ regex เดียวกันก่อน `normalize_phone`); ตรวจรูปแบบอย่างเดียว ไม่มี OTP |
  | จุดประสงค์ (radio เลือก 1) | `find_family` ตามหาญาติ/ครอบครัว · `find_acquaintance` ตามหาเพื่อน/คนรู้จัก · `coordinate_aid` ประสานความช่วยเหลือ · `other` อื่นๆ |
  | เหตุผล `purpose_note` | บังคับเมื่อ `other` (trim แล้วยาว 1–200); จุดประสงค์อื่นต้องเป็น omitted / `null` / ว่างหลัง trim (ถือเป็น `None`) |
  | checkbox ยินยอม | ต้องติกก่อนกดยืนยัน; มีลิงก์ไป `/policy` |

- **FR-4** — กดยกเลิก/ปิด dialog → ไม่ค้นหา และคำค้นยังอยู่ในช่อง
- **FR-5** — `/search?q=…` ที่ยังไม่ยืนยันใน session → เปิด dialog ก่อน แล้วค้นหาอัตโนมัติหลังยืนยัน
- **FR-6** — ทุกการค้นหา (ไม่ใช่เฉพาะครั้งแรก) ส่งข้อมูลผู้ค้นหาและจุดประสงค์ไปกับ request
- **FR-7** — ข้อความไทย/อังกฤษเพิ่มใน `PUBLIC_SEARCH_I18N`

### 2. API — `POST /public/v1/occupants` (FastAPI)

- **FR-8** — body เพิ่ม `searcher {first_name, last_name, phone}`, `purpose`, `purpose_note?`, `consent_accepted: true`
- **FR-9** — ขาด/รูปแบบผิด/`consent_accepted != true`/`purpose=other` ไม่มี `purpose_note` (หรือว่างหลัง trim)/purpose อื่นส่ง `purpose_note` ที่มีตัวอักษรจริง
  → **422** envelope `VALIDATION` เดิม พร้อม path ของฟิลด์ที่ผิด
- **FR-9a** — `purpose_note` เมื่อ `purpose != other`: omitted, `null` หรือ `""`/ว่างหลัง trim → ยอมรับและ normalize เป็น `None`
  (frontend อาจส่ง `""`/`null` จากฟอร์ม — ห้าม 422); มีตัวอักษรจริง → 422. ฝั่ง frontend ควรไม่ส่งฟิลด์นี้เมื่อไม่ใช่ `other`
- **FR-10** — เบอร์ normalize ด้วย `normalize_phone` ตัวเดิม
- **FR-11** — **fail-closed:** เขียน audit ไม่สำเร็จ → **503** `SEARCH_UNAVAILABLE` และไม่ส่งผลลัพธ์กลับ
  (เดิม fail-open — เปลี่ยน behavior)
- **FR-12** — BFF `/api/public/v1/occupants` ส่ง body ต่อตรงๆ และแนบ `X-Real-IP` เดิม — ไม่แก้
- **FR-13** — หลังแก้ FastAPI รัน `pnpm openapi:update` และ commit `fastapi.json` + `openapi.d.ts`
- **FR-14** — `/external/v1/occupants` และ EXT-012 ไม่เปลี่ยน (ไม่บังคับ `searcher`/`purpose`/`consent_accepted`)
- **FR-14a** — **แยก schema:** ปัจจุบัน `external/router.py` import `SearchRequest` จาก `evacuee/schemas.py` ร่วมกับ public
  — ห้ามแก้ `SearchRequest` ให้บังคับฟิลด์ใหม่ (external จะพังทันที). ให้เพิ่ม `PublicSearchRequest` (ครอบ/ต่อยอดจาก
  `SearchRequest`) ใช้เฉพาะ `POST /public/v1/occupants`; external คง `SearchRequest` เดิม

> **[RESOLVED: ND-1]** `/external/v1/occupants` **คง fail-open + hash-only** ตามเดิม (ไม่บังคับ `searcher`/`purpose`,
> ไม่ 503 เมื่อเขียน audit ไม่สำเร็จ) — ตัดสินโดยเจ้าของโครงการ; FR-11 ใช้กับ `POST /public/v1/occupants` เท่านั้น
> เพราะ `EvacueeUseCase.search` ตัวเดียวกัน จึงต้องแยก behavior ตามผู้เรียก (เช่น parameter `fail_closed` จาก router) ไม่ใช่เปลี่ยนค่า default

### 3. Data — `audit_event` (แทน `search_audit`)

- **FR-15** — audit ของ public search เขียนเป็น **`audit_event`** ลง Mongo collection เดียว `audit_events`
  (`_id` = `audit:{ulid}`; model `AuditEvent` ใน `packages/tent-model`) — ไม่สร้าง `xxx_audit` แยกต่อชนิด.
  Event ของ search: `event_type=public.search`, `domain=public`, `actor={kind:anonymous}`, `outcome=ok`
- **FR-16** — shape ของ `public.search` (envelope เต็มดูหัวข้อ `audit_event` ด้านล่าง):

  | ที่ | Field | หมายเหตุ |
  | --- | --- | --- |
  | `context` (Mongo + CouchDB) | `query_kind`, `query_hash`, `ip_hash`, `result_count` | ค่าเดิมของ `search_audit`; คำค้นยังเป็น hash |
  | `context` (Mongo + CouchDB) | `purpose` | enum `find_family`/`find_acquaintance`/`coordinate_aid`/`other` |
  | `context` (Mongo + CouchDB) | `consent_version` | ค่าคงที่ `"search-v1"` |
  | `pii` (**Mongo เท่านั้น**) | `searcher {first_name, last_name, phone}` | **PII** ค่าจริง; `last_name` ว่างได้ |
  | `pii` (**Mongo เท่านั้น**) | `client_ip` | **PII** ค่าจริงจาก `X-Real-IP` |
  | `pii` (**Mongo เท่านั้น**) | `purpose_note` | free text อาจมี PII |

  `pii` เป็น sub-object ใน event เดียวกัน (ND-4 ข้อ 5 = แบบ A, collection เดียว)
- **FR-15a** — `/external/v1/occupants` (ND-1: fail-open + hash-only) เขียน `audit_event` ด้วย `event_type=external.search`,
  `actor={kind:partner}`, ไม่มี `pii`/`purpose`/`consent_version`; เขียนไม่สำเร็จ → log แล้วตอบต่อ
- **FR-15b** — **[DEFERRED — ไม่ผูก, ดูหมายเหตุ ND-5 ด้านล่าง]** **สิทธิ์ Mongo (append-only):** user ของ FastAPI มีเฉพาะ `insert`/`find` บน `audit_events`; worker มีสิทธิ์
  อัปเดตเฉพาะ field `synced_to_couch`; ไม่มีใครมี `update`/`delete` อื่น
- **FR-15c** — `AuditEvent` ใน `tent_model` เป็น Pydantic discriminated union ต่อ `event_type` (validate `context`/`pii` ต่อชนิด);
  registry ของ `event_type` อยู่ที่เดียวใน `tent-model`

### 4. Worker

- **FR-17** — inbound audit (แทน `worker/src/worker/inbound/search_audit.py`): ตัด **ทั้ง key `pii`** ออกก่อนเขียน
  `audit:{ulid}` ลง CouchDB `central_ops` (doc append-only ลบไม่ได้ จึงห้ามมี PII); ใช้ `_id` เดียวกับ Mongo → idempotent
- **FR-17a** — **one-off migration** `search_audits` → `audit_events`: ทุกแถวเดิม map เป็น `event_type=public.search`
  (`query_kind`/`query_hash`/`ip_hash`/`result_count` → `context`; `searcher`/`client_ip`/`purpose_note` ถ้ามี → `pii`;
  `purpose`/`consent_version` ถ้ามี → `context`); ไม่ dual-write; หยุดเขียน `search_audits` หลัง cutover; แถวเก่าแยก public/external
  ไม่ได้ จึง map เป็น `public.search` ทั้งหมด; doc `search_audit:*` ใน `central_ops` ไม่ rewrite
- **FR-18** — **ไม่มี retention (ตัดสินแล้ว):** PII ใน `pii` เก็บถาวรใน Mongo `audit_events`
  ไม่มี TTL index / purge job. มติ net-lynx ใน [#1213](https://github.com/r202-coe-psu/tent/issues/1213): "ไม่ต้องมี retention เก็บไปเลย"

> **[RESOLVED: ND-2]** ไม่มี retention — เก็บถาวร. ตัด gate "ต้องได้ระยะ retention ก่อน approve" ออก.
> ความเสี่ยง PDPA data minimisation ถูกรับไว้โดยทีม (ผู้ตัดสิน: net-lynx, #1213); ให้ RoPA (T-43) / `/policy` ระบุว่า
> ข้อมูลผู้ค้นหาเก็บไม่มีกำหนดเพื่อเป็นหลักฐานตรวจสอบย้อนหลัง (เชื่อมกับ ND-3)

- **FR-19** — อัปเดตข้อความ `/policy` และ `/term` ใน CR นี้ (ไม่แยก CR) ทั้งไทย/อังกฤษ:
  `frontend/src/lib/constants/i18n/public-policy.ts`, `public-term.ts` เพิ่มหัวข้อการเก็บข้อมูลผู้ค้นหา —
  เก็บอะไร (ชื่อ นามสกุล เบอร์ IP จุดประสงค์ เหตุผล), เก็บเพื่ออะไร (ตรวจสอบย้อนหลัง/ป้องกันการใช้ระบบค้นหาในทางมิชอบ),
  เก็บที่ไหน (ฐานข้อมูลฝั่ง public ไม่ sync เข้าระบบศูนย์), **เก็บไม่มีกำหนด** (ตาม FR-18)

> **[RESOLVED: ND-3]** แก้ข้อความ policy/term ใน CR นี้ (ตัดสินโดยเจ้าของโครงการ).
> **ข้อควรระวัง:** หัวข้อ `retention` เดิมใน `public-policy.ts` ระบุว่าเก็บข้อมูลถึง 31 ธ.ค. 2569 แล้วลบ/ทำให้ไม่ระบุตัวตน —
> ขัดกับ FR-18 สำหรับข้อมูลผู้ค้นหา ต้องแก้หัวข้อนั้นให้ยกเว้นข้อมูลผู้ค้นหา (หรือระบุกรอบเวลาแยก) ไม่ให้ policy ขัดกันเอง

> **[RESOLVED: ND-5]** FR-15b **ไม่ผูกใน CR นี้** (ตัดสินโดยเจ้าของโครงการ 2026-11-10): ทุก compose profile รัน Mongo **ไม่มี auth**
> การบังคับ role จึงต้องเปิด auth + สร้าง user ของ FastAPI/worker + เปลี่ยน `DATABASE_URI` ทุก environment — เป็นงาน infra แยก.
> ส่งมอบแล้ว: สคริปต์ `scripts/mongo-init/audit-events-roles.js` (role `auditEventsAppend` = insert/find/createIndex,
> `auditEventsSync` = find/update/createIndex) พร้อมใช้เมื่อเปิด auth. **ผลระหว่างนี้:** append-only ของ `audit_events` เป็น
> ข้อตกลงในโค้ด ไม่ถูกบังคับที่ DB — ใครเข้าถึง Mongo ได้ก็แก้/ลบได้. MongoDB จำกัดสิทธิ update ระดับ field ไม่ได้ จึงกฎ
> "worker อัปเดตเฉพาะ `synced_to_couch`" บังคับที่โค้ด (`worker/inbound/audit.py`) เท่านั้นแม้เปิด auth แล้ว.
> ต้องเปิด issue ติดตามงานเปิด Mongo auth แล้วย้ายข้อ acceptance นี้ไปที่นั่น.

## `audit_event` รวมศูนย์ (single collection) — **อยู่ใน scope ของ CR นี้**

> ที่มา: คอมเมนต์ net-lynx ใน #1213 — ออกแบบ audit เป็น event เดียว (Mongo สำหรับ public, CouchDB สำหรับ action ในศูนย์)
> ไม่แยก `search_audit` / `xxx_audit` หลายชุด เพื่อให้ scale. **เจ้าของโครงการสั่งให้ทำใน CR นี้ (ไม่แยก CR)**

**ทำไมไม่ต่อยอด `search_audit` ต่อ:** ทุก audit ใหม่ต้องมี collection + model + inbound loop + doc type ของตัวเอง
ขณะที่ CouchDB มี `audit:{ulid}` (schema.md §2.12, append-only) อยู่แล้ว แต่ `action` เป็น enum ปิด และไม่มีฝั่ง public

**Envelope เดียว:**

| Field | หมายเหตุ |
| --- | --- |
| `_id` | `audit:{ulid}` ทั้ง Mongo และ CouchDB (prefix เดิมของ schema.md §2.12 — ใช้ `_id` เดียวกันทั้งสอง store เพื่อ sync แบบ idempotent) |
| `schema_v` | เริ่ม 1 |
| `event_type` | namespaced string เช่น `public.search`, `shelter.duplicate_override`, `shelter.privacy_change` (แทน enum `action` ปิด) |
| `domain` | `public` \| `shelter` \| `central` — บอกว่า event เกิดที่ plane ไหน และเก็บที่ store ไหน |
| `occurred_at` | ts |
| `actor` | `{kind: anonymous\|staff\|partner\|system, id?}` — public search = `anonymous` (ตัวตนจริงอยู่ใน `pii`) |
| `target` | `{type, id}?` — doc ที่ถูกกระทำ (เหมือน `target_type`/`target_id` เดิม) |
| `outcome` | `ok` \| `denied` \| `error` + `result_count?` |
| `context` | `{}` ตาม `event_type` — **ห้ามมี PII** (เช่น `purpose`, `consent_version`, `query_kind`, `query_hash`, `ip_hash`) |
| `pii` | `{}?` **Mongo เท่านั้น** (sub-object ใน event เดียวกัน — ND-4 ข้อ 5) — `searcher`, `client_ip`, `purpose_note`; worker ตัดทั้ง key นี้ก่อนเขียน CouchDB |
| `synced_to_couch` | bool (Mongo เท่านั้น) — gate inbound เหมือนเดิม |

**การจัดเก็บ**

- **Mongo `audit_events`** — event ของ `domain=public` (และทุก event ที่ต้องการ query ข้าม plane); index `(event_type, occurred_at)`, `(domain, occurred_at)`, `(target.type, target.id)`, partial `synced_to_couch=false`; **ไม่มี TTL index** (ตาม FR-18)
- **CouchDB** — doc `audit` เดิมใน DB ศูนย์ขยายเป็น shape เดียวกัน (§2.12: เพิ่ม `event_type`/`domain`/`actor`/`outcome`, `schema_v` 1 → 2);
  **CR นี้ไม่ย้าย writer ของศูนย์** — doc v1 ที่ใช้ `action` ยังเขียน/อ่านได้ต่อ (reader ใช้ `event_type ?? action`), writer ของศูนย์
  ย้ายมาใช้ `event_type` ทีละจุดภายหลัง; event public ที่ sync มาลง `central_ops` ด้วย shape เดียวกัน (ไม่มี `pii`)
- **ตัดทั้ง key `pii`** แทนรายชื่อฟิลด์ → เพิ่ม event type ใหม่ไม่ต้องแก้ inbound ทุกครั้ง (ลดความเสี่ยง PII หลุดเข้า CouchDB ที่ลบไม่ได้)

**Type safety:** คง collection เดียวแต่ใน `tent_model` ใช้ Pydantic discriminated union ต่อ `event_type` (validate `context`/`pii` ต่อชนิด) และฝั่ง frontend Zod discriminated union — ไม่ปล่อย `context` เป็น dict เปล่า

**Migration:** ดู FR-17a (one-off, ไม่ dual-write)

**ข้อแลกเปลี่ยน / ความเสี่ยง**

- PII (`pii`) อยู่ใน event เดียวกัน (แบบ A) → ทุก query/export/backup ที่ดึง event พ่วง PII มาด้วย และ **ลบ/ปิดบัง PII รายคนไม่ได้โดยไม่แก้ event** (ขัด append-only); ผู้ตัดสินรับข้อแลกเปลี่ยนนี้ไว้ — API ที่อ่าน `audit_events` ต้อง project `pii` ออกโดย default
- ปริมาณ `public.search` สูงกว่า event ในศูนย์มาก → ต้องมี index/partition ตาม `event_type` ไม่ให้ query ของศูนย์ช้าลง
- enum `action` เดิมเปลี่ยนเป็น string เปิด → ต้องคุม registry ของ `event_type` ใน `tent-model` กัน typo/ชื่อซ้ำ

> **[RESOLVED: ND-4]** (1) ทำ `audit_event` รวมศูนย์ใน CR นี้ ไม่แยก CR · (2) prefix `audit:` ทั้งสอง store ·
> (3) one-off migrate `search_audits` ไม่ dual-write · (4) role Mongo append-only (insert/find; worker อัปเดตเฉพาะ `synced_to_couch`) ·
> (5) `pii` เป็น sub-object ใน collection เดียว (แบบ A) — ตัดสินโดยเจ้าของโครงการ 2026-11-08

## Out of scope

- หน้าจอให้ staff ดู/ค้นหา log การค้นหา (เปิด issue แยก)
- OTP / การยืนยันตัวตนผู้ค้นหา
- `/external/v1/occupants`, EXT-012 (`POST /external/persons/search`), หน้าค้นหาของ staff
- retention / ลบ PII ผู้ค้นหา — **ตัดสินแล้วว่าไม่ทำ** (เก็บถาวร, #1213); ไม่ต้องมี config ใน `config:app`
- ใช้ข้อมูลผู้ค้นหาทำ rate limit/block (rate limit อยู่ที่ nginx ตาม CR-188)

## Impact

**Doc ที่ต้องแก้เมื่ออนุมัติ** (ห้ามแก้ก่อน approve; CR อื่นไม่แก้ — บันทึกผลกระทบไว้ที่นี่)

| Doc | แก้อะไร |
| --- | --- |
| `docs/data/schema.md` §2.12 | ขยาย `audit` เป็น audit_event (`event_type`, `domain`, `actor`, `target`, `outcome`, `context`); schema_v 2; `action` เดิมยังอ่านได้; อัปเดต `updated:` |
| `docs/data/schema.md` §5.1 | `search_audit` superseded โดย `audit_event` (`public.search`/`external.search`); ระบุ `pii` Mongo-only; อัปเดต `updated:` |
| `docs/data/api-contract.md` | body/422/503 ของ `POST /public/v1/occupants`; ระบุ external ไม่เปลี่ยน (fail-open, hash-only) |
| `docs/data/couchdb-mongodb-sync.md` §4.0 | แทน "hash เท่านั้น / ไม่เก็บ raw IP" ด้วยกติกาใหม่; inbound ตัดทั้ง key `pii`; ไม่มี retention |
| `docs/features/public-tier-find-spec.html`, `public-tier-flow-spec.html` | ปรับข้อความ audit ให้ตรง |
| `frontend/src/lib/constants/i18n/public-policy.ts`, `public-term.ts` | FR-19: เพิ่มหัวข้อข้อมูลผู้ค้นหา + แก้ `retention` ไม่ให้ขัดกัน |
| CR-044 (`search_audits` hash/ip_hash only), CR-166 (`query_hash`), CR-181 (external ไม่เขียน audit), CR-218 (`privacy_change` ใน `audit`) | ไม่แก้ไฟล์ CR; อ้างอิงเป็น cross-ref ใน CR นี้ |

**Code / test**

- `packages/tent-model`: เพิ่ม `AuditEvent` (discriminated union, FR-15c) แทน `SearchAudit` (เก็บ model เดิมไว้อ่านสำหรับ migration)
- Backend: `backend/apiapp/modules/evacuee/*` เขียน `audit_event`; `EvacueeUseCase.search` แยก behavior ตามผู้เรียก (public fail-closed / external fail-open)
- Backend tests: `backend/tests/test_evacuee.py` กระทบกว้างกว่าเทสต์เดียว — มี ~25 เทสต์ และ fixture
  `@pytest.fixture(params=["/public/v1/occupants", "/external/v1/occupants"])` ยิง `POST` ด้วย `{"q": ...}` เดิม
  ซึ่งฝั่ง public จะติด 422 ทั้งหมด. ต้องทำ helper/fixture กลางสร้าง payload public search ที่ valid
  (`searcher`, `purpose`, `consent_accepted`) และให้ external ใช้ payload เดิม; `test_evacuee_search_writes_search_audit` เดิมต้องปรับเป็นตรวจ `audit_events`
- Worker: inbound audit (ตัด `pii`) + migration script + tests
- Mongo: user/role ของ FastAPI และ worker (FR-15b) — หาไฟล์ init/compose ที่สร้าง user ตอน implement
- Frontend: `public-portal` domain `search-consent.ts` (Zod), `familySearch(query, consent)`, dialog + 2 จุดเรียก; reader/Zod ของ doc `audit` (ถ้ามี) รับทั้ง `action` และ `event_type`; OpenAPI regenerate
- ทุกไฟล์ `.svelte` ที่แก้ผ่าน `svelte-autofixer`

**Seams ทดสอบ (TDD) — ลำดับ S0 → S1 → `pnpm openapi:update` → S2 → S3 → S4 → S5 → S6 → S7**

| Seam | ไฟล์ | ตรวจ |
| --- | --- | --- |
| S0 model | `packages/tent-model` tests | `AuditEvent` discriminated union: `public.search` ต้องมี `context.purpose`/`consent_version`; event_type ที่ไม่อยู่ใน registry → ไม่ผ่าน; `pii` ไม่ปรากฏใน `context` |
| S1 FastAPI | `backend/tests/test_evacuee.py` | ขาด `searcher`/`purpose`/`consent_accepted` → 422; `consent_accepted:false` → 422; `other` ไม่มี note → 422 และ purpose อื่นส่ง note ที่มีข้อความ → 422 (ส่ง `""`/`null`/omit → 200 และ `pii.purpose_note` เป็น `None`); เบอร์ผิด → 422; สำเร็จ → `audit_events` มี `public.search` ที่ `pii.searcher`,`pii.client_ip`(จาก `X-Real-IP`),`pii.purpose_note` และ `context.purpose`,`consent_version`,`query_hash`,`ip_hash`; เขียน audit ไม่ได้ → 503 ไม่มี `results`; external เขียน audit ไม่ได้ → ยัง 200 (ND-1) และ event เป็น `external.search` ไม่มี `pii` |
| S2 worker inbound | `worker/tests/test_audit_inbound.py` | doc `audit:{ulid}` ใน CouchDB ไม่มี key `pii`; มี `context.purpose`,`consent_version`; `_id` เดียวกับ Mongo; รันซ้ำไม่สร้างซ้ำ |
| S3 domain | `public-portal/domain/search-consent.ts` | Zod pure ใช้กติกาเดียวกับ S1 |
| S4 data | `public-portal/data/public-api.test.ts` | body ที่ส่งไป BFF มีผู้ค้นหา+จุดประสงค์ |
| S5 DOM `/search` | `frontend/src/routes/(public)/search/+page.svelte.test.ts`, `frontend/e2e/public-search-flow.test.ts` | ค้นครั้งแรก→dialog; ยกเลิก→ไม่ค้น; ยืนยัน→ค้น; ครั้งที่สอง→ไม่มี dialog; `?q=`→dialog แล้วค้น; e2e ต้องกรอก dialog/seed `sessionStorage` ก่อนค้น (ไม่งั้น fail ทั้งชุด) |
| S6 DOM modal หน้าแรก | `frontend/src/lib/features/public-portal/ui/family-search-modal.svelte.test.ts` | gate เดียวกัน ไม่ถามซ้ำใน session |
| S7 migration | `worker/tests/test_search_audit_migration.py` | แถว v1 (hash-only) และ v2 (มี `searcher`) → `public.search` ถูก field; รันซ้ำ idempotent; ไม่แก้/ลบ `search_audits` ต้นทาง |

BFF route ไม่ทดสอบแยก (ส่ง body ต่อตรงๆ; เทสต์แนบ IP มีอยู่แล้ว)

## Migration

- `audit` **schema_v 1 → 2** — additive: field ใหม่ทั้งหมด optional ตอนอ่าน; doc/แถว v1 (`action`) อ่านได้ตามปกติ
- Mongo: `search_audits` → `audit_events` ด้วย one-off migration (FR-17a) แล้วหยุดเขียน `search_audits`; collection เดิมคงไว้ไม่ลบ
  (ไม่มี retention); ไม่มี dual-write
- CouchDB `central_ops`: doc ใหม่ prefix `audit:` (shape ตาม §2.12 v2, ไม่มี `pii`); doc `search_audit:*` เดิมคงอยู่ ไม่ rewrite
  (inbound worker เขียนผ่าน `CouchClient.put_doc`; `central_ops` ไม่มี `validate_doc_update` และ frontend ไม่ได้เข้าถึง doc type นี้ตรง)
- CouchDB DB ศูนย์: writer เดิมที่เขียน `audit` ด้วย `action` ไม่เปลี่ยนใน CR นี้
- ไม่มี retention (ตั้งใจ)

## Acceptance criteria

- [ ] CR อนุมัติ (ND-1..ND-4 ตัดสินแล้ว) และ schema.md §2.12/§5.1 / api-contract / sync อัปเดตตาม CR
- [ ] ค้นหาจาก `/search`, `?q=` หรือ modal หน้าแรกไม่ได้ จนกว่ากรอก dialog และติกยินยอม
- [ ] กรอกครั้งเดียวต่อ session ใช้ได้ทั้งสองจุด
- [ ] ยิง `POST /public/v1/occupants` ตรงโดยไม่มีข้อมูลผู้ค้นหา/จุดประสงค์ → 422
- [ ] ทุกการค้นที่สำเร็จมี `audit_event` `public.search` ครบ: `pii` (ชื่อ นามสกุล เบอร์ IP + เหตุผลถ้า `other`) และ `context` (จุดประสงค์ `consent_version` hash)
- [ ] เขียน audit ไม่สำเร็จ → 503 ไม่คืนผลลัพธ์ (public); external ยัง fail-open
- [ ] doc `audit:*` ใน CouchDB ไม่มี key `pii`
- [ ] ~~role Mongo ของ FastAPI ทำได้เฉพาะ insert/find บน `audit_events`~~ — **deferred (ND-5)**: มีสคริปต์ role แต่ไม่ผูกกับ compose จนกว่าจะเปิด Mongo auth
- [ ] `search_audits` migrate แล้ว และหยุดเขียน
- [ ] `/policy` + `/term` อัปเดตตาม FR-19 และ `retention` ไม่ขัดกัน
- [ ] `fastapi.json` + `openapi.d.ts` regenerate แล้ว
- [ ] มีเทสต์ที่ seam S0–S7
- [ ] ทุกไฟล์ `.svelte` ที่แก้ผ่าน `svelte-autofixer`

## Decision log

- 2026-11-06 — proposed (Dev Team B, issue #1159); วิธี track = CR ไฟล์ (ตามที่เจ้าของโครงการสั่งให้ทำ draft CR)
- 2026-11-06 — approved by Soravit Sukkarn (Team Lead) (issue #1159, PR #1214) — รันหมายเลข CR-231
- 2026-11-08 — ND-2 resolved: **ไม่มี retention เก็บถาวร** (net-lynx, #1213); เพิ่มข้อเสนอ `audit_event` รวมศูนย์ + ND-4 เพื่อหารือ (วิธี track = แก้ CR-231 อย่างเดียว ตามเจ้าของโครงการ)
- 2026-11-08 — ยืนยันทิศทาง: ใช้ Mongo `audit_events` (single collection) ตามร่าง `audit_event`; ND-4 ข้อ (1) ส่วน "ทำใน CR นี้หรือแยก", (2)–(4) ยังเปิด
- 2026-11-08 — ND-3 resolved: แก้ `/policy` + `/term` ใน CR นี้ (FR-19) ไม่แยก CR; พบว่าหัวข้อ `retention` เดิมขัดกับ FR-18 ต้องแก้ด้วย
- 2026-11-08 — ND-1 resolved: external คง fail-open + hash-only; fail-closed เฉพาะ public
- 2026-11-08 — ND-4(1) resolved: ทำ `audit_event` ใน CR นี้ ไม่แยก CR (แทนที่แนวทางแยก CR ก่อนหน้า); เปลี่ยน `_id` เป็น prefix `audit:`; FR/seams ยังรอเขียนใหม่
- 2026-11-08 — ND-4(2)(3)(4) resolved: prefix `audit:`; one-off migrate `search_audits` ไม่ dual-write; role Mongo append-only. เหลือ (5) ตำแหน่ง `pii`
- 2026-11-08 — ND-4(5) resolved: `pii` เป็น sub-object ใน `audit_events` (แบบ A, collection เดียว); เขียน FR-15..FR-18, Impact, Migration, seams (S0–S7) และ acceptance ใหม่ตาม `audit_event`
- 2026-11-10 — ND-5 resolved: FR-15b (role Mongo append-only) **ไม่ผูก** ใน CR นี้ — Mongo ยังไม่มี auth; ส่งสคริปต์ role ไว้แต่ deferred ไปงาน infra
