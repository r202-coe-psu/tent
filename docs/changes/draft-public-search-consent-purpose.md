---
id: draft
title: Public family search — บังคับ dialog ยินยอม + จุดประสงค์ และเก็บข้อมูลผู้ค้นหาใน search_audit
status: proposed
date: 2026-11-06
requested_by: Dev Team B
decided_by:
layer: volatile
issue: "#1159"
affects:
  - docs/data/schema.md §5.1 `search_audit` (field ใหม่ 5 ตัว)
  - search_audit schema_v 1 → 2
  - docs/data/api-contract.md `POST /public/v1/occupants` (body + 422 + 503 SEARCH_UNAVAILABLE)
  - docs/data/couchdb-mongodb-sync.md §4.0 search_audit inbound (ตัด PII ก่อนเข้า CouchDB)
  - docs/features/public-tier-find-spec.html / public-tier-flow-spec.html (ข้อความ "search_audit เก็บ query text, IP hash")
  - backend/apiapp/modules/evacuee/{schemas,router,use_case}.py, backend/tests/test_evacuee.py
  - worker/src/worker/inbound/search_audit.py, worker/tests
  - frontend/src/lib/features/public-portal/{domain,data,ui}, routes/(public)/search, family-search-modal
  - frontend/e2e/public-search-flow.test.ts
  - frontend/src/lib/api-specs/fastapi.json + frontend/src/lib/api/openapi.d.ts (regenerate)
---

# draft-public-search-consent-purpose — dialog ยินยอมและระบุจุดประสงค์ก่อนค้นหาผู้อพยพสาธารณะ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ก่อนค้นหาผู้อพยพสาธารณะ (`/search`, modal หน้าแรก `/`, ลิงก์ `/search?q=`) ผู้ค้นหาต้องกรอก
>   ชื่อ / นามสกุล / เบอร์ / จุดประสงค์ และติกยินยอม; FastAPI บังคับฝั่ง server
> - **เก็บอะไร:** `search_audit` เพิ่มข้อมูลผู้ค้นหา + IP จริง + จุดประสงค์ + `consent_version` — PII อยู่ **Mongo เท่านั้น**
>   ไม่ sync เข้า CouchDB; **ยังไม่มี retention/ลบอัตโนมัติ**
> - **ผลต่อ contract:** `POST /public/v1/occupants` body ใหม่ (422 ถ้าขาด) และ audit เป็น **fail-closed** (503)
> - **กระทบ:** `search_audit` schema_v 1 → 2 · แก้หลักการ "hash เท่านั้น" · ต้องกำหนด retention ภายหลัง (DPO + RoPA)

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

> **[NEEDS DECISION: ND-1]** `/external/v1/occupants` เรียก `EvacueeUseCase.search` ตัวเดียวกัน (CR-181) —
> เมื่อ audit เป็น fail-closed ต้องตัดสินว่า external ยัง fail-open + hash-only เหมือนเดิม
> หรือ fail-closed ตาม public. Draft นี้ถือว่า **external ไม่เปลี่ยนพฤติกรรม** (ตาม issue) จนกว่าเจ้าของเคาะ

### 3. Data — `search_audit` (schema_v 1 → 2)

- **FR-15** — ฟิลด์เดิมคงไว้: `query_kind`, `query_hash`, `ip_hash`, `result_count`, `occurred_at` (คำค้นยังเก็บเป็น hash)
- **FR-16** — ฟิลด์ใหม่ (optional ตอนอ่าน; **ไม่ backfill** แถวเก่า):

  | Field | req | เก็บที่ | หมายเหตุ |
  | --- | --- | --- | --- |
  | `searcher` `{first_name, last_name, phone}` | opt | Mongo เท่านั้น | **PII** ค่าจริง; `last_name` ว่างได้ |
  | `client_ip` | opt | Mongo เท่านั้น | **PII** ค่าจริงจาก `X-Real-IP` |
  | `purpose_note` | opt | Mongo เท่านั้น | free text อาจมี PII |
  | `purpose` | opt | Mongo + CouchDB | enum `find_family`/`find_acquaintance`/`coordinate_aid`/`other` |
  | `consent_version` | opt | Mongo + CouchDB | ค่าคงที่ `"search-v1"` |

### 4. Worker

- **FR-17** — inbound (`worker/src/worker/inbound/search_audit.py`): ตัด `searcher`, `client_ip`, `purpose_note` ออกก่อนเขียนเข้า
  CouchDB `central_ops` (doc append-only ลบไม่ได้ จึงห้ามมี PII)
- **FR-18** — **ไม่มี retention loop ใน CR นี้:** PII (`searcher`, `client_ip`, `purpose_note`) คงอยู่ใน Mongo `search_audits` จนกว่าจะมี CR/issue แยกกำหนดระยะเก็บรักษา — เปิด issue ติดตามแล้ว: [#1213](https://github.com/r202-coe-psu/tent/issues/1213)

> **[NEEDS DECISION: ND-2]** ไม่มี retention → PII ผู้ค้นหา (`first_name`, `last_name`, `phone`, `client_ip`, `purpose_note`)
> ไม่หมดอายุ (เสี่ยง PDPA data minimisation). ต้องตัดสินว่ายอมรับช่วงนี้ชั่วคราวจนกำหนดระยะ (DPO ยืนยัน + อัปเดต RoPA T-43)
> และเปิด issue/CR retention แยกเมื่อใด (เปิด issue แล้ว: [#1213](https://github.com/r202-coe-psu/tent/issues/1213)). **ต้องได้ระยะเวลา retention (หรือ DPO ยอมรับช่วงชั่วคราวเป็นลายลักษณ์อักษร) ก่อนเปลี่ยน `status` เป็น `approved`**
>
> **[NEEDS DECISION: ND-3]** ข้อความ `/policy` และ `/term` (`public-policy.ts`, `public-term.ts`) ปัจจุบันไม่ระบุการเก็บข้อมูลผู้ค้นหา
> — ต้องตัดสินว่าจะอัปเดตข้อความ consent/policy ใน CR นี้หรือแยก CR

## Out of scope

- หน้าจอให้ staff ดู/ค้นหา log การค้นหา (เปิด issue แยก)
- OTP / การยืนยันตัวตนผู้ค้นหา
- `/external/v1/occupants`, EXT-012 (`POST /external/persons/search`), หน้าค้นหาของ staff
- retention / ลบ PII ผู้ค้นหาอัตโนมัติ และการทำเป็น config ใน `config:app` — แยก CR/issue ภายหลัง (issue [#1213](https://github.com/r202-coe-psu/tent/issues/1213))
- ใช้ข้อมูลผู้ค้นหาทำ rate limit/block (rate limit อยู่ที่ nginx ตาม CR-188)

## Impact

**Doc ที่ต้องแก้เมื่ออนุมัติ** (ห้ามแก้ก่อน approve; CR อื่นไม่แก้ — บันทึกผลกระทบไว้ที่นี่)

| Doc | แก้อะไร |
| --- | --- |
| `docs/data/schema.md` §5.1 | เพิ่ม 5 field ตาม FR-16; `search_audit` schema_v 2; อัปเดต `updated:` |
| `docs/data/api-contract.md` | body/422/503 ของ `POST /public/v1/occupants`; ระบุ external ไม่เปลี่ยน |
| `docs/data/couchdb-mongodb-sync.md` §4.0 | แทน "hash เท่านั้น / ไม่เก็บ raw IP" ด้วยกติกาใหม่; step inbound ตัด PII |
| `docs/features/public-tier-find-spec.html`, `public-tier-flow-spec.html` | ปรับข้อความ audit ให้ตรง |
| CR-044 (`search_audits` hash/ip_hash only), CR-166 (`query_hash`), CR-181 (external ไม่เขียน audit) | ไม่แก้ไฟล์ CR; อ้างอิงเป็น cross-ref ใน CR นี้ |

**Code / test**

- Backend: `backend/apiapp/modules/evacuee/*`; `tent_model.search_audit.SearchAudit` model ต้องเพิ่ม field
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
| S1 FastAPI | `backend/tests/test_evacuee.py` | ขาด `searcher`/`purpose`/`consent_accepted` → 422; `consent_accepted:false` → 422; `other` ไม่มี note → 422 และ purpose อื่นส่ง note ที่มีข้อความ → 422 (ส่ง `""`/`null`/omit → 200 และ audit เก็บ `purpose_note` เป็น `None`); เบอร์ผิด → 422; สำเร็จ → audit มี `searcher`,`client_ip`(จาก `X-Real-IP`),`purpose`,`purpose_note`,`consent_version`,`query_hash`,`ip_hash`; เขียน audit ไม่ได้ → 503 ไม่มี `results` |
| S2 worker inbound | `worker/tests/test_search_audit_inbound.py` | doc ใน CouchDB ไม่มี `searcher`/`client_ip`/`purpose_note`; มี `purpose`,`consent_version` |
| S3 domain | `public-portal/domain/search-consent.ts` | Zod pure ใช้กติกาเดียวกับ S1 |
| S4 data | `public-portal/data/public-api.test.ts` | body ที่ส่งไป BFF มีผู้ค้นหา+จุดประสงค์ |
| S5 DOM `/search` | `frontend/src/routes/(public)/search/+page.svelte.test.ts`, `frontend/e2e/public-search-flow.test.ts` | ค้นครั้งแรก→dialog; ยกเลิก→ไม่ค้น; ยืนยัน→ค้น; ครั้งที่สอง→ไม่มี dialog; `?q=`→dialog แล้วค้น; e2e ต้องกรอก dialog/seed `sessionStorage` ก่อนค้น (ไม่งั้น fail ทั้งชุด) |
| S6 DOM modal หน้าแรก | `frontend/src/lib/features/public-portal/ui/family-search-modal.svelte.test.ts` | gate เดียวกัน ไม่ถามซ้ำใน session |

BFF route ไม่ทดสอบแยก (ส่ง body ต่อตรงๆ; เทสต์แนบ IP มีอยู่แล้ว)

## Migration

- `search_audit` **schema_v 1 → 2** — additive: field ใหม่ทั้งหมด optional ตอนอ่าน
- แถว/doc เดิม (v1) อ่านได้ตามปกติ **ไม่ backfill**
- CouchDB `central_ops`: doc ใหม่ได้เฉพาะ `purpose` + `consent_version` เพิ่ม (sync โดย inbound worker ผ่าน
  `CouchClient.put_doc`; `central_ops` ไม่มี `validate_doc_update` และ frontend ไม่ได้เข้าถึง doc type นี้ตรง
  จึงไม่มี Zod/validator ฝั่ง Couch ให้แก้)
- Mongo: ไม่ต้อง migrate; ไม่มี retention ใน CR นี้

## Acceptance criteria

- [ ] CR อนุมัติ (+ ตอบ ND-1..ND-3) และ schema.md §5.1 / api-contract / sync อัปเดตตาม CR
- [ ] ค้นหาจาก `/search`, `?q=` หรือ modal หน้าแรกไม่ได้ จนกว่ากรอก dialog และติกยินยอม
- [ ] กรอกครั้งเดียวต่อ session ใช้ได้ทั้งสองจุด
- [ ] ยิง `POST /public/v1/occupants` ตรงโดยไม่มีข้อมูลผู้ค้นหา/จุดประสงค์ → 422
- [ ] ทุกการค้นที่สำเร็จมีแถว `search_audit` ครบ: ชื่อ นามสกุล เบอร์ IP จุดประสงค์ (+เหตุผลถ้า `other`) `consent_version`
- [ ] เขียน audit ไม่สำเร็จ → 503 ไม่คืนผลลัพธ์
- [ ] doc `search_audit` ใน CouchDB ไม่มี `searcher`/`client_ip`/`purpose_note`
- [ ] `fastapi.json` + `openapi.d.ts` regenerate แล้ว
- [ ] มีเทสต์ที่ seam S1–S6
- [ ] ทุกไฟล์ `.svelte` ที่แก้ผ่าน `svelte-autofixer`

## Decision log

- 2026-11-06 — proposed (Dev Team B, issue #1159); วิธี track = CR ไฟล์ (ตามที่เจ้าของโครงการสั่งให้ทำ draft CR); ยังไม่ commit
