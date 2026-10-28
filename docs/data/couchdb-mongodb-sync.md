---
title: Smart Shelter — CouchDB ⇄ MongoDB Sync (Public Plane)
status: draft for review
created: 2026-06-11
updated: 2026-10-28
note: CR-196 (2026-10-26) — §3.2 `public_donations.items_declared[].line_key`, PROJECTION_VERSION 10→11, inbound ปั๊ม donation schema_v 8; CR-183 (2026-10-22) — ศูนย์ปิดคง `public_shelters` + `public_persons` ไว้จนครบ `closed_at` + `retention_months_after_close`, listener/bootstrap ครอบศูนย์ปิดในระยะ retention, rescan ตอนเปิดใหม่ (bump PROJECTION_VERSION); decision sync 2026-10-25 — §3.3 `unassigned_registrations.members[]` เพิ่ม `consent` + `search_excluded` (UNASSIGNED_SCHEMA_V 3→4; PDPA consent block FR-42); CR-176 (2026-10-20) — projector evacuee `checked_in_at` = null เมื่อ `cancelled` (PROJECTION_VERSION 4→5); คู่กับ data-model.md v3 + api-contract.md v1 + CR-017/CR-044 — public tier ทำงานบน MongoDB ผ่าน FastAPI; ตัด public_transparency (CR-017 Decision B); CR-113 unassigned_registrations; CR-166 (2026-10-13) — public_persons เพิ่ม `first_name_key`/`last_name_hash`, PROJECTION_VERSION 2→3, เลิก `$text`; decision sync 2026-10-09 — worker PROJECTION_VERSION + auto re-bootstrap on start (stored in Mongo _worker_meta); bootstrap reads update_seq before scan; CR-172 (2026-10-21) — `public_donations` เพิ่ม `reject_reason`/`reject_reason_code` + `received_summary.items[].rejected/reject_reason/reject_reason_code` ส่งผ่านทั้งก้อน, PROJECTION_VERSION 6→7; CR-174 (2026-10-21) — `public_donations.items_declared[]` เพิ่ม `review_status`/`review_reason_code`/`review_reason` (PROJECTION_VERSION 7 ครอบทั้ง CR-172 + CR-174 — 6 = CR-185 บน develop); inbound ปั๊ม donation schema_v 7 + เขียน audit อนุมัติอัตโนมัติ
---

# Smart Shelter — CouchDB ⇄ MongoDB Sync

## 0. ทำไมต้องมี MongoDB

api-contract v1 เดิมเขียนว่า public plane "อ่าน central CouchDB ตรง" — รุ่นนี้ **refine**: คั่นด้วย
**MongoDB เป็น public-facing store** แทน. CouchDB central ไม่รับ public internet traffic เลย.

| เหตุผล | ผล |
| --- | --- |
| **Privacy by construction** | เฉพาะ field ที่ public เห็นได้ ถูก project ลง Mongo (นามสกุล masked, ไม่มี medical, ไม่มีเบอร์ใน response) — ต่อให้ Mongo รั่ว ก็ไม่มี PII เต็ม |
| **Blast radius** | public traffic / scraping / DDoS ชนแค่ Mongo replica — operational CouchDB (ที่ศูนย์พึ่งพา) ไม่กระทบ |
| **Query shape** | occupants search ต้องการ index ชื่อ (prefix + hash นามสกุลเต็ม — CR-166; เดิม `$text`) + phone exact + masking — ทำบน Mongo ง่ายกว่า CouchDB view มาก |
| **Scaling แยกโปรไฟล์** | public อ่านหนัก-เขียนเบา, operational เขียนหนัก — แยก store ปรับ scale อิสระ |

**กติกาเจ้าของข้อมูล (สำคัญสุด):**

- **CouchDB central = system of record** สำหรับทุก operational doc (evacuee, donation lifecycle, stock, …)
- **MongoDB = derived + buffer** — เป็นเจ้าของได้อย่างเดียวคือ *การประกาศ donation จาก public ตอนแรก*
  (ก่อนถูก persist เข้า CouchDB) เท่านั้น; ที่เหลือ Mongo คือ projection อ่านอย่างเดียว

---

## 1. Topology — ต่อจาก central-first sync

```
staff device (PouchDB) ⇄ WAN ⇄ central (CouchDB) ⇄ sync worker (CDC ทั้งสองทิศ) ⇄ MongoDB ⇄ /public/v1/*
        │                              ⇅
        │ fallback only                │ edge fallback replica / backlog
        └──────── LAN ────────────⇄ edge (CouchDB @ศูนย์)
```

- public client **ไม่เคย**คุย CouchDB; คุยแค่ `/public/v1/*` ที่อ่าน/เขียน Mongo
- staff/device **ไม่เคย**คุย Mongo; app เขียน local PouchDB ก่อน แล้ว sync กับ active remote เดียว:
  central ปกติ, edge เฉพาะ WAN/central outage, local-only ถ้าไม่เห็นทั้งคู่
- edge เป็น LAN continuity/fallback replica ไม่ใช่ normal client hub; เมื่อ WAN กลับมา edge sync backlog กลับ central
- **sync worker** = service หลักที่แตะทั้งสอง storeและทำ CDC; อยู่ฝั่ง central (มี WAN ถึง central CouchDB + Mongo) ขณะที่ BFF ใช้ public writer ที่จำกัดสิทธิ์สำหรับ pre-register และ public job apply เท่านั้น
- Mongo replica ขึ้น public edge ได้ (read replica); งานที่ต้องเข้า system-of-record ผ่าน sync worker หรือ public writer ที่กำหนดขอบเขตไว้แล้วตาม flow

---

## 2. ทิศทาง sync — มี 2 plane

| Plane | ทิศ | กลไก | ใช้ทำ |
| --- | --- | --- | --- |
| **Outbound** | CouchDB central → Mongo | tail `_changes` (CDC) → project → upsert | person index, shelters, needs, donation status |
| **Inbound** | Mongo → CouchDB central | poll Mongo `donations` ใหม่ → `db.put(donation:{ulid})` | บันทึก donation ที่ public ประกาศเข้าระบบจริง |
| **Inbound (volunteer, legacy/buffered)** | Mongo → CouchDB central | poll `volunteer_applications` / `volunteer_shift_responses` / `volunteer_profile_updates` | คำขอจาก compatibility/legacy flows และการแก้ไขโปรไฟล์จากพอร์ทัล; public job apply ใหม่เขียนผ่าน public CouchDB writer โดยตรง (CR-107) |

ทั้งสอง plane **idempotent** และมี **checkpoint** — restart worker ได้ปลอดภัย ไม่ซ้ำ ไม่หาย.

---

## 3. Outbound — CouchDB → MongoDB (projection, read-only ฝั่ง Mongo)

### 3.1 กลไก

- worker tail `GET /{db}/_changes?feed=continuous&include_docs=true&since={last_seq}` ของ
  `shelter_{shelter_code}` ที่ central (+ `registry` สำหรับ shelter status)
- **Listener scope ([CR-183](../changes/11-famsearch/CR-183-closed-shelter-search-retention.md) FR-7, D-4):** ฟัง DB ของศูนย์ที่อ่านจาก `registry` (`type = shelter`) ที่
  (ก) เปิด (`is_shelter_open`) **หรือ** (ข) `operation_status = closed` และ `now < closed_at + config:app.retention_months_after_close`
  — เพื่อให้ check-out / opt-out (`privacy.search_excluded`) ของ evacuee ศูนย์ปิดไปถึง Mongo. ศูนย์ `cancelled`
  และศูนย์ปิดที่เลยระยะ retention ไม่ถูกฟัง
- **เปิดศูนย์ใหม่ (FR-9):** เมื่อ `public_shelters.status` เปลี่ยนจาก `closed` เป็นค่าอื่น processor ต้อง rescan DB
  `shelter_{code}` (`_reproject_shelter_database`) ใน change เดียวกัน — ไม่รอ restart worker
- เก็บ checkpoint `last_seq` ต่อ db ใน Mongo collection `_sync_checkpoints` — restart แล้ว resume จุดเดิม
- แต่ละ change → ผ่าน **projector** ตาม `doc.type` → upsert/ลบใน Mongo collection ปลายทาง
- เป็น CDC แบบ near-realtime (วินาที) — public เห็นข้อมูลช้ากว่า operational เล็กน้อย ยอมรับได้

> `_purge` (retention) **ไม่โผล่ใน `_changes`** — ดู §7 retention; worker ต้องลบ Mongo แยก

#### Projection version and automatic re-bootstrap

> decision sync 2026-10-09

The worker resumes `_changes` from its checkpoint, so documents that never change
(e.g. an idle shelter) are not re-projected after a projector changes. To keep Mongo
`public_*` shapes current, the code defines `PROJECTION_VERSION`
(`worker/src/worker/projection_version.py`).

- After every successful full bootstrap the worker stores the version in Mongo
  (`_worker_meta`, `_id: "projection_version"`, next to `_sync_checkpoints`).
- On start the worker runs a full bootstrap when: the registry checkpoint is missing
  (first install), OR no stored version exists (one-off on installs that predate this
  rule), OR stored < `PROJECTION_VERSION`. Stored > code (rollback) does not bootstrap
  and logs a warning. `--bootstrap` / `--bootstrap-only` always run it.
- The stored version is written only after the whole scan succeeds; a failed bootstrap
  is retried on the next start.
- Bootstrap reads each database's `update_seq` **before** scanning and checkpoints that
  value, so edits made during the scan are replayed by the `_changes` tail (upserts are
  idempotent).
- **When to bump:** whenever a projector or `refresh_*` aggregation changes what it
  writes (field added/removed/renamed/re-typed, changed semantics, new or newly
  filtered doc type). Do not bump for refactors or read-side changes. Never decrement.
- **Deploy effect:** staging/prod deploys (`up -d --build --force-recreate`) re-project
  automatically on the first start after a bump; no manual `--bootstrap-only` is needed.
- Scope ([CR-183](../changes/11-famsearch/CR-183-closed-shelter-search-retention.md) FR-8): bootstrap reads shelters from `registry` (`type = shelter`)
  and scans only open shelters (`is_shelter_open`) plus `closed` shelters whose
  `closed_at + retention_months_after_close` has not passed. `cancelled` shelters and
  closed shelters past the deadline are not scanned, so their `public_persons` are not
  re-published (their `public_shelters` row stays).
- Limits: bootstrap never removes orphan rows. After a
  rollback followed by a redeploy at the same version, run `sync-worker --bootstrap-only`
  manually.

### 3.2 Mongo collections (ปลายทาง projection)

```js
// public_persons — occupants search index (1 doc / evacuee ที่ค้นเจอได้)
{ _id: "evacuee:01H...",            // = CouchDB _id (idempotency)
  shelter_code: "SH001",            // code ของ shelter
  first_name: "สมชาย",              // ชื่อจริงเต็ม
  last_name_masked: "ใจ****ดี",      // mask ตอน project (≥5: 2หน้า+****+2ท้าย; ≤4: ตัวแรก+****; นับ grapheme) — ใช้แสดงผลเท่านั้น ไม่ใช้ค้น (CR-166)
  first_name_key: "สมชาย",          // CR-166: NFKC → casefold → ยุบช่องว่าง → strip; ใช้ prefix match
  last_name_hash: "sha256(ใจดี)",   // CR-166: sha256(surname_key) — surname_key = name_key ตัดช่องว่างทั้งหมด; None ถ้าว่าง; ไม่ส่งออก API
  phone_hash: "sha256(0812345678)", // ค้นด้วยเบอร์เต็ม = hash แล้วเทียบ — เบอร์จริงไม่ลง Mongo
  status: "active",                 // จาก current_stay (CR-035 v3)
  national_id_hash, national_id_masked, passport_hash, passport_id_masked,
  address_masked, gender, checked_in_at, care_zone, household_id,
  updated_at: "..." }
// projector: ถ้า evacuee.privacy.search_excluded == true → ลบ doc นี้ออกจาก Mongo (opt-out = หายทั้ง record)
// ไม่มี: นามสกุลเต็ม, เบอร์ดิบ, medical, national_id plaintext — ไม่ project เด็ดขาด

การเปลี่ยนสูตร projector ของ `checked_in_at` ให้เป็น `null` สำหรับ `pre_registered`,
`kiosk_registered` และ `cancelled` (CR-176) มีผลกับ event ใหม่เท่านั้น; ต้อง bootstrap/reproject `public_persons` เดิม
หลัง deploy worker เพื่อให้ Mongo สะท้อนสูตรใหม่ด้วย (ติดตามใน CR ของ kiosk walk-in ก่อน deploy).

// public_shelters — shelter list (จาก registry)
// ศูนย์ closed คงแถวไว้ status = "closed" (ADR-0002 Soft Delete, CR-183 FR-1) — retention ไม่ลบแถวนี้;
// เฉพาะ cancelled ที่ถูกลบออกจาก public plane (draft-shelter-cancelled-status)
{ _id: "SH001", shelter_code: "SH001", registry_id: "shelter:{ulid}", name, status: "open|full|standby|closed",
  closed_at,                        // จาก registry — นาฬิกา retention ของ public_persons (data-model §7)
  geo, capacity, province, district, subdistrict, updated_at }

// public_needs — ความต้องการรวม (จาก donation_campaign − donation ที่รับแล้ว)
{ _id: "{shelter_code}:item:01H...", shelter_code, item_name, category, qty_needed, unit, updated_at }
// projector: คำนวณจาก open campaigns − donations; qty_needed ≤ 0 → ลบ doc
// recompute เมื่อ donation / donation_campaign / supply_item เปลี่ยน (CDC)

// public_donations — สำหรับ tracking_token lookup (mirror สถานะจาก CouchDB)
// lookup ด้วย tracking_token_hash เท่านั้น — ไม่เก็บ plaintext token
{ _id: "donation:01H...", tracking_token_hash, shelter_code, status: "declared|received|expired",
  items_declared: [...], received_summary: {...} | null,
  reject_reason: str | null, reject_reason_code: "not_needed|expired|damaged|other" | null,
  updated_at }
// projector: sync สถานะ donation กลับมาให้ public ดูผ่าน GET /public/v1/donations/{token}
// received_summary ส่งทั้งก้อนตามรูปใน schema.md §2.3 — รวม items[].rejected / reject_reason /
//   reject_reason_code (CR-172) โดยไม่ map ทีละ field
// reject_reason / reject_reason_code (CR-172) = ข้อความที่ผู้บริจาคเห็น + code — มีค่าเฉพาะ
//   status rejected; doc ก่อน schema_v 6 ไม่มี field → project เป็น null (PROJECTION_VERSION 7)
// items_declared[] = [{ item_id? (มีเฉพาะ stub ของ FastAPI), item_name, qty, unit, category,
//   line_key | null, review_status: "approved|pending|rejected" | null, review_reason_code | null, review_reason | null }]
//   review_* (CR-174 FR-27) ส่งต่อจาก donation.items[] ตรง ๆ — หน้าติดตามอ่าน items จาก CouchDB ก่อน
//   projection เป็น fallback จึงต้องมีข้อมูลเท่ากัน; รายการก่อน schema_v 7 ไม่มี field → null
//   (PROJECTION_VERSION 7 — bump เดียวกับ CR-172 เพราะ implement พร้อมกันก่อน release; 6 = CR-185)
//   line_key (CR-196 FR-LK-8) ส่งต่อจาก donation.items[].line_key ตรง ๆ — ฟอร์มแก้รายการของผู้บริจาค
//   ใช้บอกว่าแก้รายการไหน; รายการก่อน schema_v 8 ไม่มี → null (PROJECTION_VERSION 11)
// create path เขียน stub ทันทีก่อน outbound CDC เพื่อให้ GET tracking ใช้ได้ทันที — stub ใช้ status
//   และ review_status ที่ FastAPI คำนวณ (CR-174: `verifying` เมื่อทุกรายการอยู่ในแคมเปญ ไม่งั้น
//   `pending_review`); PATCH items อัปเดต stub ด้วยเหตุผลเดียวกัน — items ทุกครั้ง, status เฉพาะใบ
//   ที่ยังไม่ sync (ใบที่ sync แล้ว status มาจาก projector หลัง BFF เขียน CouchDB สำเร็จ)

// public_volunteers — โปรไฟล์จิตอาสาสำหรับหน้า "แก้ไขโปรไฟล์" ใน Access Portal
// lookup ด้วย phone_hash เท่านั้น (คีย์เดียวกับ schedule / ticket find)
{ _id: "volunteer:01H...", shelter_code, phone_hash, first_name, last_name, nickname,
  phone_masked, email, volunteer_code, skills: [...], organization,
  identity_verified, personnel_type, status: "active", updated_at }
// projector: status != active → ลบ doc (ไม่ project เป็น inactive)
// ไม่มี: national_id, เบอร์ดิบ, user_name, tracking_token — ไม่ project เด็ดขาด
// 1 doc / ศูนย์ที่มีโปรไฟล์ — คนเดียวช่วยหลายศูนย์ = หลายแถว, API merge ให้ตอนอ่าน

// public_transparency — ตัดออก (CR-017 Decision B); ใช้ public_shelters แทนสำหรับ shelter list
```

### 3.3 Mongo SoR (ไม่ใช่ projection) — `unassigned_registrations` (CR-113)

**Unassigned Registration** เก็บใน Mongo collection `unassigned_registrations` โดยตรง (FastAPI write) —
**ไม่** มาจาก Couch CDC และ **ไม่** สร้างแถวใน `public_persons` จนกว่า staff จะ claim → สร้าง Couch
`evacuee`/`household` ที่ `pre_registered` แล้ว worker project ตามปกติ.

- ห้าม treat เป็น Evacuee / Couch SoR ก่อน claim
- ห้ามนับเข้า Forecast occupancy รายศูนย์จนกว่า claim
- claim order (locked, option B): Mongo mark/lock → Couch birth → revert Mongo on Couch failure
- shape + claim algorithm: `schema.md` §9.5 + [CR-113](../changes/00-baseline/CR-113-unassigned-registration-mongo.md)

**Consent ของสมาชิกในคิว (`UNASSIGNED_SCHEMA_V` 3 → 4, FR-42 · `docs/features/pdpa-consent-block-spec.md`):**
`members[]` แต่ละคนเก็บ `consent` (shape เดียวกับ `evacuee.consent` — `mode`, `health`, `ref`, `given_at`, `notice_version`,
`given_by`, `giver_evacuee_id`, `channel = "web"`, `recorded_verbally_by = null`) และ `search_excluded: boolean`
(default `false`) ที่เขียนตอน `POST /public/v1/unassigned-registrations` — FastAPI ผูก `channel`/giver ให้ ไม่คำนวณ policy
(BFF คำนวณต่อสมาชิกแล้ว).

- **Claim คัดลอกค่าเดิม** — `build_couch_evacuee` เขียน `consent` และ `privacy.search_excluded = members[].search_excluded`
  ลง evacuee doc โดยไม่เปลี่ยนค่า และ stamp `schema_v: 15` (FR-31/32 ใช้ตอนสร้าง doc); `consent` เป็น `null` → ไม่เขียน field
- **Member ที่คิวไว้ก่อน `schema_v 4` เกิดมาโดยไม่มี `consent`** (`null`, `search_excluded = false`) — ไม่มี migration/backfill ย้อนหลัง;
  claim แล้วได้ evacuee ที่ไม่มี `consent` และเก็บที่ report-in (FR-41/44)
- ข้อมูลสุขภาพของคน `health = false` ไม่เข้า Mongo เลย (queue ไม่เก็บ `medical` อยู่แล้ว, #255)
- `search_excluded = true` ไม่ซ่อนอะไรใน Mongo ก่อน claim (คิวไม่ถูก project เป็น `public_persons`); มีผลเมื่อ evacuee ถูกสร้างแล้ว projector เดิมลบ projection (§1 `privacy.search_excluded`) — ไม่ bump `PROJECTION_VERSION`

**หลักการ projection:** allow-list field เท่านั้น — projector มี whitelist ตายตัวต่อ type; field
ใหม่ใน CouchDB **ไม่หลุด**ไป Mongo เองจนกว่าจะเพิ่มใน whitelist (กัน PII leak โดยอุบัติเหตุ).

---

## 4. Inbound — MongoDB → CouchDB (donation intake + search_audit)

public ประกาศบริจาคผ่าน `POST /public/v1/donations` → เขียน Mongo ก่อน → worker ค่อย persist เข้า CouchDB.
occupants search เขียน Mongo `search_audits` (hash เท่านั้น) → worker persist เข้า `central_ops`.

### 4.0 search_audit inbound

```
1. POST /public/v1/occupants
   → FastAPI เขียน Mongo `search_audits`:
     { _id: search_audit:{ULID}, query_kind, query_hash, ip_hash,
       result_count, occurred_at, synced_to_couch: false }
   → ไม่เก็บ raw query / IP

2. inbound worker poll `search_audits` where synced_to_couch=false
   → ensure DB `central_ops` → put search_audit:{ULID}
   → mark synced_to_couch=true
```

### 4.1 ลำดับ (donations)

```
1. public POST /public/v1/donations
   → API เขียน Mongo `donations`:
     { _id: <ULID>, shelter_code, donor: { name, phone },      // PII อยู่ Mongo ชั่วคราว
       items_declared: [{ item_name, qty, unit }],
       status: "declared", tracking_token: <random>,
       synced_to_couch: false, created_at }
   → ตอบ public { tracking_token }   ทันที (ไม่รอ CouchDB)

2. inbound worker poll Mongo `donations` where synced_to_couch=false
   → db.put ลง central shelter_{shelter_code}:
     donation:{ULID} { type:"donation", schema_v:1, status:"declared",
                       donor:{name,phone}, items_declared:[...],
                       tracking_token, source:"public", created_at }
   → ULID ของ Mongo = ULID ของ _id ใน CouchDB → idempotency key
     (worker crash/retry → put ซ้ำ → 409 = สำเร็จแล้ว ไม่เกิด donation ซ้ำ)
   → mark Mongo doc synced_to_couch=true

3. central → device (active remote ปกติ) + central → edge fallback replica
   → staff ที่ศูนย์เห็น "donation ขาเข้า" สถานะ declared ในแอปเมื่อ sync กับ central;
     ถ้าอยู่โหมด Edge-only fallback จะเห็นจาก edge replica และ edge จะส่ง backlog กลับ central เมื่อ WAN คืน
```

donation doc ที่ลงไปเป็น state machine แบบ **forward-only** (data-model §3.2): `declared → received → expired`.

> **CR-174 (ประเมินทีละรายการ):** ขั้น 1 FastAPI เขียน `items_declared[].review_status` และ `status`
> ที่คำนวณจากรายการ (`verifying` / `pending_review`) ลง buffer — inbound (ขั้น 2) copy `items` ทั้งก้อนและ
> `status` ตามนั้น ปั๊ม `schema_v` 8 (CR-196 เพิ่ม `items[].line_key` ที่ FastAPI ตั้ง — copy มากับ `items`) · ถ้ามีรายการ `approved` inbound เขียน `audit` อนุมัติอัตโนมัติ
> (`action: manual_adjust`, `created_by: system`, `context: {approved_by: 'system', rule: 'campaign_line',
> lines: [index…]}`) **ก่อน** put donation ด้วย `_id` คงที่ต่อใบ (`audit:` + Crockford 26 ตัวจาก
> SHA-256 ของ `"{donation _id}:campaign_auto_approve"`) → retry/ประมวลผลซ้ำได้ `conflict` = เขียนแล้ว ·
> เขียน audit ไม่สำเร็จ → ไม่ put donation รอบนี้ (poll รอบหน้าลองใหม่ทั้งคู่)

### 4.2 ⭐ donation → stock = manual (กฎธุรกิจหลักของงานนี้)

**ของบริจาคที่ "ประกาศ" ไม่กลายเป็น stock อัตโนมัติ.** `items_declared` เป็นแค่ความตั้งใจ/รายการที่
ผู้บริจาคแจ้ง — ของจริงอาจมาไม่ครบ มาเกิน มาคนละอย่าง หรือไม่มาเลย.

เมื่อของมาถึงศูนย์จริง **staff ต้องคีย์ inventory เข้า stock เอง:**

```
ของมาถึงศูนย์
  → staff เปิด donation (declared) ในแอป, นับของจริง
  → 1) put donation:{ulid} status="received"  + received_summary (ของที่ได้จริง)
  → 2) คีย์ stock เอง: put stock_ledger:{ulid} (+qty) ต่อ item ที่นับได้จริง   ← ขั้นตอนคนทำมือ
       (append-only — data-model §3.2; balance = view stock_balance)
```

- **ไม่มี** auto-create `stock_ledger` จาก donation — ระบบ**ไม่**ไว้ใจตัวเลข declared
- staff อาจรับบางส่วน / ปฏิเสธ / ปรับ item ตอนคีย์ — `stock_ledger` สะท้อนของจริงในคลังเท่านั้น
- donation ที่ declared แล้วไม่มาภายในกำหนด → staff/แอปตั้ง `status="expired"` (ไม่กระทบ stock)
- สถานะ received/expired sync กลับ Mongo (outbound §3.2 `public_donations`) → public เห็นผ่าน tracking_token

> เหตุผล: stock คือความจริงทางกายภาพในคลัง ต้องผ่านการนับของคนหน้างาน — pre-declaration จาก
> public เป็นแค่ planning signal (ช่วยให้ศูนย์รู้ว่ามีของกำลังมา) ไม่ใช่หลักฐานว่ามีของ

---

## 5. ownership / conflict ข้าม store

| ข้อมูล | เจ้าของจริง | ทิศ sync | กติกา |
| --- | --- | --- | --- |
| evacuee / person index | CouchDB | → Mongo | Mongo อ่านอย่างเดียว; แก้ที่ CouchDB เท่านั้น |
| donation (ตอนประกาศ) | Mongo | → CouchDB | Mongo เป็นเจ้าของจนถูก persist (synced_to_couch=true) |
| unassigned_registrations (CR-113) | Mongo | → Couch ตอน claim เท่านั้น | Mongo SoR ของคิวกลาง; claim สร้าง Couch evacuee/household; ไม่ project เป็น `public_persons` จน claim |
| donation lifecycle | CouchDB | → Mongo | หลัง persist แล้ว CouchDB คุม status; Mongo mirror |
| stock_ledger | CouchDB | — (ไม่ขึ้น Mongo) | ไม่ project — stock เป็นข้อมูลภายในศูนย์ |
| needs / transparency | CouchDB (view) | → Mongo | Mongo อ่านอย่างเดียว |
| volunteer profile | CouchDB | ↔ | อ่าน: project ลง `public_volunteers` · เขียน: จิตอาสาแก้ได้เฉพาะ `skills` ผ่าน `volunteer_profile_updates` แล้ว worker patch กลับ — `identity_verified` / `status` / `volunteer_code` / `personnel_type` เป็นของเจ้าหน้าที่ ไม่มีช่องทางแก้จาก public plane |

- **ไม่มี conflict ข้าม store**: donation มี boundary ชัด (Mongo เป็นเจ้าของก่อน persist, CouchDB หลัง persist)
  — ULID เดียวกันตลอด ใช้เป็น idempotency key ทั้งสองฝั่ง
- ถ้า worker ตายระหว่าง persist: Mongo `synced_to_couch` ยัง false → poll รอบหน้า retry →
  put ซ้ำ → 409 แล้ว retry ด้วย `_rev` ล่าสุด (idempotent)

---

## 6. Public endpoints map → Mongo (refine api-contract §5)

| Endpoint | แตะ Mongo | หมายเหตุ |
| --- | --- | --- |
| `POST /public/v1/occupants` | read `public_persons` (ชื่อ: `first_name_key` prefix + `last_name_hash` exact — CR-166; หรือ `phone_hash`) | response: ชื่อจริง + นามสกุล masked + ศูนย์ + สถานะ; **ไม่มีเบอร์**; audit ลง Mongo → sync → `central_ops.search_audit`; allow-list stay รวม `arriving`/`room_confirmed` (CR-112) |
| `POST /public/v1/unassigned-registrations` | write `unassigned_registrations` | CR-113 — ไม่แตะ Couch / ไม่สร้าง `public_persons` |
| `GET /staff/v1/unassigned-registrations/search` | read `unassigned_registrations` | CR-113 — staff online search ตรงจากคิวกลาง |
| `POST /staff/v1/unassigned-registrations/{id}/claim` | update/delete `unassigned_registrations` + write Couch | CR-113 — birth of Couch SoR; แล้ว worker → `public_persons` |
| `GET /public/v1/needs` | read `public_needs` | aggregate ข้ามศูนย์ |
| `POST /public/v1/donations` | write `donations` (inbound §4) | ตอบ tracking_token ทันที |
| `GET /public/v1/donations/{tracking_token}` | read `public_donations` | mirror สถานะจาก CouchDB |
| `GET /public/v1/transparency/*` | read `public_transparency` | aggregate ระดับศูนย์ |
| `POST /public/v1/otp/request` | (OTP store แยก) | เปิดเมื่อ `public_otp_required` |

CouchDB central **ไม่มี public endpoint** — §6 ของ api-contract ("สิ่งที่ตั้งใจไม่มี") ยังจริง:
public ไม่อ่าน operational doc ตรง แค่เปลี่ยน backing store ของ public plane เป็น Mongo.

---

## 7. Retention — purge ต้องลบทั้งสอง store

`_purge` ที่ CouchDB **ไม่โผล่ใน `_changes`** → outbound worker จะ**ไม่เห็น**การลบ → Mongo จะค้าง PII.

ดังนั้น retention job (data-model §7) ต้องลบ Mongo **เป็นขั้นตอนเดียวกับ purge** เสมอ:

| ตอนปิดศูนย์ / ครบระยะ retention | CouchDB (`evacuee`/`household`/`medical` purge ครบ 2 ปี, T-43) | MongoDB (ต้องทำคู่กัน) |
| --- | --- | --- |
| evacuee → tombstone | `_purge` + tombstone เมื่อครบ 2 ปีหลังปิดศูนย์ (ตาม pdpa-consent-block-spec — [CR-194](../changes/01-core/CR-194-public-person-data-retention.md)) | ลบ `public_persons` ของ shelter นั้น |
| donor PII ใน donation | ลบ name/phone | ลบ donor PII ใน `public_donations` + `donations` |
| ปิดศูนย์ | status=closed + `closed_at` | ลบ `public_needs`, `shelter_stocks`, `shelter_occupants` ของ shelter ทันที (processor + retention เป็น safety net); **คง** `public_shelters` (`status = closed`) และ `public_persons` ([CR-183](../changes/11-famsearch/CR-183-closed-shelter-search-retention.md)) |
| ครบ `closed_at` + `retention_months_after_close` | — (CouchDB purge ที่ 2 ปียังเป็นงาน T-43) | ลบ `public_persons` ของ shelter ทีละ doc พร้อม `_retention_audit` (`trigger: "scheduled"`, verify + idempotent); `public_shelters` ยังคงอยู่ |

ศูนย์ `closed` ที่ `closed_at = null` → retention ไม่ลบ `public_persons` และ log warning (CR-183 D-5).
ระยะเดือนอ่านจาก `registry` `config:app.retention_months_after_close` ทุกรอบ (อ่านไม่ได้/ค่าผิด → `3`).

donor PII (`donor.name/phone`) ใน Mongo `donations`: ลบทันทีที่ donation ถึง terminal state นานพอ
หรืออย่างช้า 3 เดือนหลังปิดศูนย์ (เหลือ hash + ยอด) — เหมือนกฎ CouchDB.

**Expired intake buffer:** retention ลบ `donations` / stub `public_donations` เมื่อ
`expires_at < now` **และ** `synced_to_couch=true` เท่านั้น — ห้ามลบแถวที่ยังไม่ถึง Couch
(ถ้า worker ล่มเกิน TTL ให้คง buffer + log warning จนกว่า inbound จะ persist).

---

## 8. การเขียนโค้ด / tooling

- **sync worker** = service เดียว (เสนอ FastAPI worker / standalone process ที่ central) มี 3 loop:
  outbound `_changes` tailer (ต่อ shelter db), inbound donation poller, retention reaper
- **checkpoint** อยู่ Mongo `_sync_checkpoints` (`{db, last_seq}`) — แหล่งความจริงเดียวของความคืบหน้า
- **projector** มี unit test ต่อ type ยืนยัน allow-list (กัน field ใหม่หลุด) + masking ถูกต้อง
- **seed script** (data-model §8) ควร seed ทั้ง CouchDB และรัน worker 1 รอบให้ Mongo มี projection
  สำหรับ dev/e2e ของ public tier
- Mongo indexes: `public_persons`: `{last_name_hash, first_name_key}`, `{first_name_key}` (CR-166 — แทน `$text(first_name,last_name_masked)` เดิมที่คงไว้ใน DB จนระบบนิ่งแล้ว drop ด้วยมือ), `{phone_hash}`,
  `{shelter_code}`; `public_donations`: `{tracking_token_hash}`; `donations`: `{synced_to_couch}`

## 9. สิ่งที่ตั้งใจ "ไม่มี"

- Mongo **ไม่ใช่** source of truth ของอะไรเลยนอกจาก donation ก่อน persist — ห้าม UI/แอป staff อ่าน Mongo
- **ไม่** sync stock_ledger / movement / medical / household ขึ้น Mongo — operational data ไม่ออกนอกศูนย์
- **ไม่มี** auto donation→stock — ของเข้า stock ผ่านการคีย์มือของ staff เท่านั้น (§4.2)
- **ไม่มี** two-way merge ของ field เดียวกันข้าม store — ทุก field มีเจ้าของฝั่งเดียว (§5)
</content>
</invoke>
