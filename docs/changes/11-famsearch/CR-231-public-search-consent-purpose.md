---
id: CR-231
title: Public family search — บังคับ dialog ยินยอม + จุดประสงค์ และเก็บข้อมูลผู้ค้นหาใน Mongo `audit_events`
status: proposed
date: 2026-11-06
requested_by: Dev Team B
decided_by: 
layer: volatile
issue: "#1159"
affects:
  - docs/data/schema.md §5.1 `search_audit` → แทนด้วย Mongo collection `audit_events` (event_type `public.search`; schema_v 1)
  - docs/data/api-contract.md `POST /public/v1/occupants` (body + 422 + 503 SEARCH_UNAVAILABLE)
  - docs/data/couchdb-mongodb-sync.md §4.0 search_audit inbound (เลิก sync public log เข้า CouchDB)
  - docs/features/public-tier-find-spec.html / public-tier-flow-spec.html (ข้อความ "search_audit เก็บ query text, IP hash")
  - backend/apiapp/modules/evacuee/{schemas,router,use_case}.py, backend/tests/test_evacuee.py
  - worker/src/worker/inbound/search_audit.py (ยกเลิก/ปิด inbound), worker/tests
  - frontend/src/lib/features/public-portal/{domain,data,ui}, routes/(public)/search, family-search-modal
  - public-policy.ts / public-term.ts (ข้อความเก็บข้อมูลผู้ค้นหา — ไม่มีกำหนดการลบ)
  - frontend/e2e/public-search-flow.test.ts
  - frontend/src/lib/api-specs/fastapi.json + frontend/src/lib/api/openapi.d.ts (regenerate)
---

# CR-231 — Public family search — dialog ยินยอมและระบุจุดประสงค์ก่อนค้นหาผู้อพยพสาธารณะ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ก่อนค้นหาผู้อพยพสาธารณะ (`/search`, modal หน้าแรก `/`, ลิงก์ `/search?q=`) ผู้ค้นหาต้องกรอก
>   ชื่อ / นามสกุล / เบอร์ / จุดประสงค์ และติกยินยอม; FastAPI บังคับฝั่ง server
> - **เก็บอะไร:** public log เก็บเป็น **audit event** ใน Mongo collection เดียว `audit_events` (event แรก = `public.search`)
>   แทนการแยกเป็น `search_audit` / `xxx_audit` — payload มีข้อมูลผู้ค้นหา + IP จริง + จุดประสงค์ + `consent_version`;
>   PII อยู่ **Mongo เท่านั้น** ไม่ sync เข้า CouchDB; **ไม่มี retention — เก็บถาวร** (ตัดสินแล้วใน #1213)
> - **ผลต่อ contract:** `POST /public/v1/occupants` body ใหม่ (422 ถ้าขาด) และ audit เป็น **fail-closed** (503)
> - **กระทบ:** `audit_events` collection ใหม่ (schema_v 1) แทน `search_audits` · แก้หลักการ "hash เท่านั้น"

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

> **[RESOLVED: ND-1]** `/external/v1/occupants` **ไม่เปลี่ยน** — external กับ public แยกกันอยู่แล้ว: external คง fail-open + hash-only
> และไม่เขียน `audit_events` (ตาม FR-14/FR-14a)

### 3. Data — Mongo `audit_events` (single collection, schema_v 1)

> ที่มา: comment ใน [#1213](https://github.com/r202-coe-psu/tent/issues/1213) (net-lynx) — ไม่ต้องมี retention เก็บถาวร;
> ออกแบบ log เป็น **audit event collection เดียว** ใน Mongo สำหรับ public log
> เพื่อไม่ต้องแยก `search_audit` / `xxx_audit` หลาย collection และพร้อม scale

- **FR-15** — public log ทุกประเภทเขียนลง Mongo collection **`audit_events`** เดียว; การค้นผู้อพยพ = `event_type: "public.search"`.
  ไม่สร้าง collection `*_audit` ใหม่ต่อฟีเจอร์ — event ชนิดใหม่เพิ่มด้วยค่า `event_type` + `payload` ของตัวเอง
- **FR-16** — envelope (ทุก event) :

  | Field | req | หมายเหตุ |
  | --- | --- | --- |
  | `_id` | ✓ | `audit_event:{ULID}` |
  | `schema_v` | ✓ | `1` |
  | `event_type` | ✓ | dotted string; ตอนนี้มีเฉพาะ `public.search` |
  | `occurred_at` | ✓ | ISO UTC (index; ใช้เรียงเวลา) |
  | `actor` | ✓ | `{ kind: "public_searcher", ip_hash, client_ip? }` — `client_ip` **PII** ค่าจริงจาก `X-Real-IP` |
  | `request_id` | opt | ผูก event กับ log ของ FastAPI/nginx เพื่อสืบย้อน |
  | `subject` | opt | `{ kind, id }` ถ้า event ชี้ entity เฉพาะ; `public.search` ไม่มี → เว้น |
  | `payload` | ✓ | object ตาม `event_type` (ด้านล่าง) |

  `payload` ต้อง validate ต่อ `event_type` (Pydantic discriminated union ตาม `event_type`) — ห้ามเขียน payload ลอย;
  เพิ่ม event ชนิดใหม่ = เพิ่ม `event_type` + payload model ผ่าน CR/spec ที่เกี่ยวข้อง ไม่ต้องแก้ schema ของ collection

- **FR-16a** — `payload` ของ `public.search`:

  | Field | req | หมายเหตุ |
  | --- | --- | --- |
  | `query_kind` | ✓ | คงของเดิม |
  | `query_hash` | ✓ | คำค้นยังเก็บเป็น hash |
  | `result_count` | ✓ | คงของเดิม |
  | `searcher` `{first_name, last_name, phone}` | ✓ | **PII** ค่าจริง; `last_name` ว่างได้ |
  | `purpose` | ✓ | enum `find_family`/`find_acquaintance`/`coordinate_aid`/`other` |
  | `purpose_note` | opt | free text อาจมี PII; มีเมื่อ `other` เท่านั้น |
  | `consent_version` | ✓ | ค่าคงที่ `"search-v1"` |

- **FR-16b** — collection **append-only** (ไม่ update/delete จาก application code); index ขั้นต่ำ `{event_type:1, occurred_at:-1}`
- **FR-16c** — **แทน `search_audits` เลย ไม่เขียนคู่:** การเขียนใหม่ไปที่ `audit_events` เท่านั้น (fail-closed ที่เดียว); `search_audits` เดิมไม่ migrate/backfill คงไว้อ่านอย่างเดียว

### 4. Worker

- **FR-17** — **public log ไม่ sync เข้า CouchDB:** เลิกใช้ inbound `worker/src/worker/inbound/search_audit.py` สำหรับ event ใหม่
  (PII อยู่ Mongo เท่านั้น; `central_ops` ไม่รับ doc ของ public log อีก). doc `search_audit:*` เดิมใน CouchDB คงไว้
- **FR-18** — **ไม่มี retention (ตัดสินแล้ว):** `audit_events` เก็บถาวร ไม่มี TTL/ลบอัตโนมัติ ตาม [#1213](https://github.com/r202-coe-psu/tent/issues/1213)
  (net-lynx: "ไม่ต้องมี retention เก็บไปเลย"). ต้องควบคุมสิทธิ์เข้าถึง Mongo ให้เหมาะสมกับ PII ที่เก็บถาวร
- **FR-19** — ข้อความ `/policy` และ `/term` ต้องระบุการเก็บข้อมูลผู้ค้นหา (ชื่อ นามสกุล เบอร์ IP จุดประสงค์) และระบุว่า
  **ไม่มีกำหนดการลบ** (เก็บถาวร); ข้อความไทย/อังกฤษตามที่ไฟล์เดิมรองรับ

> **[RESOLVED: ND-2]** retention — เก็บถาวร ไม่มี retention (ผู้ตัดสิน: net-lynx ใน #1213). ไม่ต้องรอ DPO/RoPA T-43 เป็นเงื่อนไข approve;
> ยังควรแจ้ง DPO เพื่ออัปเดต RoPA ให้ตรงว่าเก็บถาวร
>
> **[RESOLVED: ND-3]** อัปเดตข้อความ `/policy` และ `/term` (`public-policy.ts`, `public-term.ts`) ใน CR นี้ ตาม FR-19

> **[RESOLVED: ND-4]** envelope ตาม FR-16 (รวม `request_id`, `subject`) และแทน `search_audits` เลยตาม FR-16c

## Out of scope

- หน้าจอให้ staff ดู/ค้นหา log การค้นหา (เปิด issue แยก)
- OTP / การยืนยันตัวตนผู้ค้นหา
- `/external/v1/occupants`, EXT-012 (`POST /external/persons/search`), หน้าค้นหาของ staff
- retention / ลบ PII ผู้ค้นหาอัตโนมัติ — **ตัดสินแล้วว่าไม่ทำ (เก็บถาวร)** ตาม [#1213](https://github.com/r202-coe-psu/tent/issues/1213)
- ใช้ข้อมูลผู้ค้นหาทำ rate limit/block (rate limit อยู่ที่ nginx ตาม CR-188)

## Impact

**Doc ที่ต้องแก้เมื่ออนุมัติ** (ห้ามแก้ก่อน approve; CR อื่นไม่แก้ — บันทึกผลกระทบไว้ที่นี่)

| Doc | แก้อะไร |
| --- | --- |
| `docs/data/schema.md` §5.1 | เพิ่มนิยาม Mongo `audit_events` (FR-15..16c) และระบุ `search_audit` ถูกแทนสำหรับ event ใหม่; อัปเดต `updated:` |
| `docs/data/api-contract.md` | body/422/503 ของ `POST /public/v1/occupants`; ระบุ external ไม่เปลี่ยน |
| `docs/data/couchdb-mongodb-sync.md` §4.0 | แทน "hash เท่านั้น / ไม่เก็บ raw IP" ด้วยกติกาใหม่; เลิก inbound search_audit → CouchDB |
| `docs/features/public-tier-find-spec.html`, `public-tier-flow-spec.html` | ปรับข้อความ audit ให้ตรง |
| CR-044 (`search_audits` hash/ip_hash only), CR-166 (`query_hash`), CR-181 (external ไม่เขียน audit) | ไม่แก้ไฟล์ CR; อ้างอิงเป็น cross-ref ใน CR นี้ |

**Code / test**

- Backend: `backend/apiapp/modules/evacuee/*`; เพิ่ม model `AuditEvent` ใน `tent_model` (envelope + payload `public.search`) เขียนลง `audit_events`
- Backend tests: `backend/tests/test_evacuee.py` กระทบกว้างกว่าเทสต์เดียว — มี ~25 เทสต์ และ fixture
  `@pytest.fixture(params=["/public/v1/occupants", "/external/v1/occupants"])` ยิง `POST` ด้วย `{"q": ...}` เดิม
  ซึ่งฝั่ง public จะติด 422 ทั้งหมด. ต้องทำ helper/fixture กลางสร้าง payload public search ที่ valid
  (`searcher`, `purpose`, `consent_accepted`) และให้ external ใช้ payload เดิม; `test_evacuee_search_writes_search_audit` เดิมต้องปรับ
- Worker: inbound + tests
- Frontend: `public-portal` domain `search-consent.ts` (Zod), `familySearch(query, consent)`, dialog + 2 จุดเรียก; OpenAPI regenerate
- ทุกไฟล์ `.svelte` ที่แก้ผ่าน `svelte-autofixer`

**Seams ทดสอบ (TDD) — ลำดับ S1 → `pnpm openapi:update` → S2 → S3 → S4 → S5 → S6**

| Seam | ไฟล์ | ตรวจ |
| --- | --- | --- |
| S1 FastAPI | `backend/tests/test_evacuee.py` | ขาด `searcher`/`purpose`/`consent_accepted` → 422; `consent_accepted:false` → 422; `other` ไม่มี note → 422 และ purpose อื่นส่ง note ที่มีข้อความ → 422 (ส่ง `""`/`null`/omit → 200 และ audit เก็บ `purpose_note` เป็น `None`); เบอร์ผิด → 422; สำเร็จ → `audit_events` มี event `public.search` ที่ `actor.client_ip`(จาก `X-Real-IP`),`actor.ip_hash` และ `payload` มี `searcher`,`purpose`,`purpose_note`,`consent_version`,`query_hash`; เขียน audit ไม่ได้ → 503 ไม่มี `results` |
| S2 worker inbound | `worker/tests/test_search_audit_inbound.py` | event `public.search` ใน `audit_events` ไม่ถูก sync เข้า CouchDB (ไม่มี doc ใหม่ใน `central_ops`) |
| S3 domain | `public-portal/domain/search-consent.ts` | Zod pure ใช้กติกาเดียวกับ S1 |
| S4 data | `public-portal/data/public-api.test.ts` | body ที่ส่งไป BFF มีผู้ค้นหา+จุดประสงค์ |
| S5 DOM `/search` | `frontend/src/routes/(public)/search/+page.svelte.test.ts`, `frontend/e2e/public-search-flow.test.ts` | ค้นครั้งแรก→dialog; ยกเลิก→ไม่ค้น; ยืนยัน→ค้น; ครั้งที่สอง→ไม่มี dialog; `?q=`→dialog แล้วค้น; e2e ต้องกรอก dialog/seed `sessionStorage` ก่อนค้น (ไม่งั้น fail ทั้งชุด) |
| S6 DOM modal หน้าแรก | `frontend/src/lib/features/public-portal/ui/family-search-modal.svelte.test.ts` | gate เดียวกัน ไม่ถามซ้ำใน session |

BFF route ไม่ทดสอบแยก (ส่ง body ต่อตรงๆ; เทสต์แนบ IP มีอยู่แล้ว)

## Migration

- Mongo: สร้าง collection `audit_events` (schema_v 1) + index `{event_type:1, occurred_at:-1}`; `search_audits` เดิมไม่ migrate/backfill
- CouchDB `central_ops`: ไม่มี doc ใหม่ — doc `search_audit:*` เดิมคงไว้ ไม่แก้
- ไม่มี retention (เก็บถาวร)

## Acceptance criteria

- [ ] CR อนุมัติ (ND-1..ND-4 resolved แล้ว) และ schema.md §5.1 / api-contract / sync อัปเดตตาม CR
- [ ] ค้นหาจาก `/search`, `?q=` หรือ modal หน้าแรกไม่ได้ จนกว่ากรอก dialog และติกยินยอม
- [ ] กรอกครั้งเดียวต่อ session ใช้ได้ทั้งสองจุด
- [ ] ยิง `POST /public/v1/occupants` ตรงโดยไม่มีข้อมูลผู้ค้นหา/จุดประสงค์ → 422
- [ ] ทุกการค้นที่สำเร็จมี event `public.search` ใน Mongo `audit_events` ครบ: ชื่อ นามสกุล เบอร์ IP จุดประสงค์ (+เหตุผลถ้า `other`) `consent_version`
- [ ] เขียน audit ไม่สำเร็จ → 503 ไม่คืนผลลัพธ์
- [ ] ไม่มีข้อมูลผู้ค้นหา (`searcher`/`client_ip`/`purpose_note`) ถูกเขียนเข้า CouchDB
- [ ] `fastapi.json` + `openapi.d.ts` regenerate แล้ว
- [ ] `/policy` และ `/term` ระบุการเก็บข้อมูลผู้ค้นหาและไม่มีกำหนดการลบ
- [ ] มีเทสต์ที่ seam S1–S6
- [ ] ทุกไฟล์ `.svelte` ที่แก้ผ่าน `svelte-autofixer`

## Decision log

- 2026-11-06 — proposed (Dev Team B, issue #1159); วิธี track = CR ไฟล์ (ตามที่เจ้าของโครงการสั่งให้ทำ draft CR)
- 2026-11-06 — approved by Soravit Sukkarn (Team Lead) (issue #1159, PR #1214) — รันหมายเลข CR-231
- 2026-11-09 — แก้ตาม comment ของ net-lynx ใน #1213: ไม่มี retention (เก็บถาวร, ND-2 resolved) และเปลี่ยนเป็น Mongo `audit_events` collection เดียวสำหรับ public log (FR-15..18, ND-4 เปิดใหม่ให้คุยออกแบบ)
- 2026-11-09 — ND-1 resolved (external ไม่เปลี่ยน เพราะแยกจาก public); ND-3 resolved (แก้ `/policy` `/term` ใน CR นี้ ระบุไม่มีกำหนดการลบ — FR-19)
- 2026-11-09 — ND-4 resolved: `audit_events` envelope เพิ่ม `request_id`/`subject` + payload เป็น discriminated union ตาม `event_type`; แทน `search_audits` เลย ไม่เขียนคู่ (FR-16, FR-16c)
- 2026-11-09 — status approved → proposed: เนื้อหาเปลี่ยนหลังอนุมัติ (audit_events, ไม่มี retention, FR-19) ต้องขออนุมัติใหม่
