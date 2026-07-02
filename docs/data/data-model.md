---
title: Smart Shelter — Data Model (CouchDB/PouchDB) v3
status: draft for review
created: 2026-06-11
updated: 2026-06-18
note: ออกแบบใหม่ทั้งหมด — ไม่สืบทอดจาก docs/data v2.0 (retired 2026-06-11); decision sync 2026-06-15 เลือก MongoDB projection สำหรับ public tier และ EOC read-model
---

# Smart Shelter — Data Model v3 (CouchDB / PouchDB)

ระบบหลักเป็น **offline-first**: PouchDB บน device คือ store ที่ app เขียนก่อนเสมอ แล้ว sync กับ
active remote ทีละเป้าหมาย. ปกติ remote คือ CouchDB central; Edge ใช้เฉพาะตอน WAN/central
เข้าไม่ได้. Public tier และ deferred EOC/Open API read-model อ่านจาก MongoDB projection ที่ sync จาก central.

**Decisions ที่ฝังในรุ่นนี้ (เคาะ 2026-06-11):**

| Decision | ค่า |
| --- | --- |
| Medical masking | **ไม่มี** — staff ทุก role เห็น medical เต็ม (สถานการณ์ฉุกเฉิน) |
| Registration minimum | `first_name` + `last_name` + `gender` + `phone` (กรอก "ไม่มี" ได้ → เก็บ `null`) |
| Scale assumptions | ≤350 shelters · ≤20,000 คน/ศูนย์ (ใหญ่สุด) · ≤50 devices/ศูนย์ |
| Retention | purge PII ≤3 เดือนหลังปิดศูนย์ · local db บน device อายุ 1 เดือน (SOP wipe) · PSU = data controller |
| EOC / Open API | deferred service แยก ใช้ **MongoDB projection** จาก Central CouchDB — ไม่มี operational doc type ในรุ่นนี้ |
| Public tier | ทำงานบน **MongoDB projection** ที่ sync จาก central — ดู [couchdb-mongodb-sync](./couchdb-mongodb-sync.md) · [public-tier-flow-spec](../features/public-tier-flow-spec.html) |

---

## 1. Topology — central-first + LAN fallback

```
                         normal path
device (PouchDB)  ⇄ WAN ⇄  central (CouchDB)
      │                         ⇅
      │ fallback only           │ edge fallback replica / backlog
      └──────── LAN ───────⇄ edge server (CouchDB @ศูนย์)
```

- app เขียน **local PouchDB ก่อนทุกครั้ง** — UI ห้าม block รอ network; sync เป็น background
- active remote ของ device มีได้ **เป้าหมายเดียวต่อเวลา**:
  1. **Central CouchDB** เมื่อ reachable (โหมดปกติ)
  2. **Edge CouchDB บน LAN** เฉพาะเมื่อ WAN/central เข้าไม่ได้
  3. **local-only** เมื่อทั้ง central และ edge เข้าไม่ได้
- ห้าม run long-lived replication จาก device หนึ่งเครื่องไปทั้ง central และ edge พร้อมกัน; ตอนสลับเป้าหมายต้องหยุด replication เดิมก่อนเริ่มตัวใหม่
- Edge เป็น **LAN continuity/fallback replica** ไม่ใช่ normal client hub; เมื่อ WAN กลับมา edge จะ sync backlog กลับ central ด้วย checkpoint ของ replicator

| DB | central | edge (fallback replica) | device | Normal active remote | Edge fallback / server replication |
| --- | --- | --- | --- | --- | --- |
| `shelter_{shelter_code}` | ✓ (ทุกศูนย์) | ✓ (เฉพาะศูนย์ตน) | ✓ (PouchDB) | device ⇄ central (live+retry) | device ⇄ edge เฉพาะ outage · edge ⇄ central sync backlog |
| `registry` | ✓ master | ✓ replica | ✓ replica | central → device (pull, read-only) | central → edge; device pull จาก edge เฉพาะ outage |
| `catalog` | ✓ master | ✓ replica | ✓ replica | central → device (pull, read-only) | central → edge; device pull จาก edge เฉพาะ outage |
| `_users` | ✓ master | ✓ **filtered replica** (เฉพาะ user ของศูนย์ตน) | — | central `_session` | central → edge (selector by role `shelter:{id}`) เพื่อ fallback login |
| `central_ops` | ✓ เท่านั้น | — | — | central-only service/read model | — (search_audit, export_job, `counter:shelter`) |

- 1 ศูนย์ = 1 db → ปิดศูนย์ = หยุด replication + purge ทั้ง db ที่ central, ล้าง edge server ทั้งเครื่อง
- ศูนย์ 20,000 คน: initial sync ปกติวิ่งกับ **central**; ถ้า WAN/central ล่มระหว่าง onboarding จึงใช้
  **LAN กับ edge fallback** — ตั้ง `batch_size` ใหญ่ได้; ไม่ทำ filtered replication ฝั่ง device ในรุ่นแรก
  (ความซับซ้อนไม่คุ้ม)
- edge→central ตอน WAN กลับมาหลังขาดนาน: backlog จากช่วง LAN fallback ไหลเป็น batch อัตโนมัติ (checkpoint ของ
  replicator) — ไม่ต้องมี logic พิเศษ

## 2. Conventions

- ทุก doc มี: `type`, `schema_v` (int), `created_at`/`updated_at` (ISO-8601 UTC), `created_by` (user id), `shelter_code`
- `_id = "{type}:{ulid}"` — client สร้าง ULID ตอน offline ได้ทันที **ULID คือ idempotency key ในตัว**:
  retry เขียน doc เดิม → 409 → ถือว่าสำเร็จ ไม่เกิด record ซ้ำ
- ห้ามใช้ CouchDB-generated id; ห้าม sequence กลางตอน offline — ข้อยกเว้นเดียวคือ `shelter.code`
  ที่ mint จาก central counter (`central_ops:counter:shelter`) ตอน provisioning ศูนย์ (central-only,
  ต้องมี WAN — ไม่ใช่ offline write); operational doc ทุกตัวยังใช้ ULID เท่านั้น
- enum เก็บเป็น string ตายตัว (ภาษาอังกฤษ lower_snake) — label ภาษาไทยอยู่ฝั่ง UI

## 3. Doc types — `shelter_{shelter_code}`

> ระดับ field เต็มทุก type (required/enum/default/index) อยู่ที่ **[schema.md](./schema.md)** — หัวข้อนี้คือภาพรวม + ตัวอย่าง

### 3.1 People (baseline FR-4..13)

| type | mutability | สาระ |
| --- | --- | --- |
| `evacuee` | mutable (LWW) | ตัวตน + สถานะการพักปัจจุบัน |
| `medical` | mutable (LWW), **purge แยกได้** | ข้อมูล screening/แพทย์ของ evacuee — แยก doc เพื่อ purge ก่อนตามวงจร PDPA |
| `household` | mutable (LWW) | ครัวเรือน — สมาชิกอ้าง evacuee id |
| `movement` | **append-only** | event เข้า/ออก/ย้าย — ห้ามแก้ ห้ามลบ |
| `screening` | **append-only** | event คัดกรองแต่ละครั้ง (ผลสรุปล่าสุดดูผ่าน view) |

```js
// evacuee:{ulid}
{
  type: "evacuee", schema_v: 2,
  // ---- minimum (บังคับแค่นี้ — เคาะ 2026-06-11) ----
  first_name: "สมชาย", last_name: "ใจดี", gender: "male|female|other",
  phone: "0812345678" | null,         // required ใน UI — ผู้ลงทะเบียนกด/กรอก "ไม่มี" → เก็บ null
                                      // ใช้ค้นใน FAM search (เบอร์เต็มเท่านั้น) — ไม่ส่งกลับใน public response
  country: "THAILAND",                // ประเทศต้นทาง (เพิ่มใน v2 — CR-007)
  // ---- optional เติมทีหลัง ----
  nickname, birth_year,
  person_id: { cardType: "national_id|passport|pink_card|other", number }, // เอกสารแสดงตน (v2 — CR-027)
  religion,
  special_needs: ["elderly","disabled","pregnant","infant", ...],
  emergency_contact: { name, phone, relation },
  household_id,                       // -> household:{ulid}
  current_stay: { status: "registered|checked_in|checked_out|transferred",
                  zone, since },      // denormalized เพื่อ UI; ความจริงอยู่ที่ movement events
  privacy: { search_excluded: false },// FAM opt-out (default ค้นเจอ)
  registered_via: "app|import|paper"
}

// movement:{ulid}  (append-only)
{ type: "movement", evacuee_id, action: "check_in|check_out|transfer_out|transfer_in",
  zone, destination, reason, occurred_at, recorded_by }

// medical:{ulid}   (1 doc / evacuee — _id เก็บใน evacuee ไม่ได้ ใช้ index หา)
{ type: "medical", evacuee_id, blood_group, conditions: [], medications: [],
  allergies: [], notes, track: "normal|fast_track" }
```

`current_stay` ขัดกับ movement ได้ตอน conflict — กติกา: **movement events ชนะเสมอ**, มี repair job
ฝั่ง central เทียบ view กับ snapshot แล้วแก้ snapshot

### 3.2 Operations (R2–R3)

| type | mutability | สาระ |
| --- | --- | --- |
| `stock_ledger` | **append-only** | รับ/จ่าย/ปรับ stock ราย item (+qty/−qty) — balance = reduce view |
| `stock_transfer` | state machine | โอนของข้ามศูนย์: `requested→shipped→received` (เขียนฝั่งต้นทาง replicate ผ่าน central) |
| `donation` | state machine | pre-declaration จาก public tier หรือบันทึกหน้างาน: `declared→received→expired` |
| `donation_campaign` | mutable (LWW) | ความต้องการของศูนย์ (needs ที่ public เห็นเป็น aggregate) |
| `meal_plan` | mutable (LWW) | แผนมื้ออาหารรายวัน — อ้าง `recipe` + ปริมาณ (กล่อง/หม้อ) ต่อมื้อ |
| `kitchen_requisition` | **append-only** | เบิกวัตถุดิบ — สร้าง `stock_ledger` คู่กัน (qty ติดลบ) |
| `meal_service` | **append-only** | บันทึกแจกอาหารจริงต่อมื้อ |
| `volunteer` | mutable (LWW) | อาสาสมัคร (คนละ doc กับ `_users` — อาสาไม่มี login ก็ได้) |
| `shift_assignment` | mutable (LWW) | ตารางเวร |
| `security_event` | **append-only** | เหตุการณ์ความปลอดภัย |
| `referral` | state machine | ส่งต่อหน่วยงานนอก: `draft→sent→accepted|rejected→closed` |
| `audit` | **append-only** | การกระทำสำคัญ (override duplicate-hint, แก้ retroactive, export, ลบ) |

State machine บน CouchDB = เขียน doc ใหม่ทั้ง doc พร้อม `status` ใหม่ (LWW) — ตัว transition ที่ขัดกัน
ตอน sync ใช้กติกา **forward-only**: สถานะที่"ไปข้างหน้า"กว่าชนะ (received > shipped > requested)

### 3.3 `registry` / `catalog` (central-managed, อ่านอย่างเดียวบน device; edge เป็น fallback replica)

```js
// registry:  shelter:{ulid}
{ type: "shelter",
  code: "SH001",                          // sys — unique, immutable; mint จาก central counter
                                          // (central_ops:counter:shelter) ตอน provisioning;
                                          // เป็นชื่อ db shelter_{code} + อ้างข้ามศูนย์ทุกที่ (shelter_code)
                                          // pattern ^SH\d{3,}$: 1–999 pad 3 หลัก, ≥1000 กว้างตามจริง (SH1000)
  name, status: "open|closed", capacity,
  zones: [{ code, name, capacity }],
  area_m2: 1200,                          // opt — พื้นที่ปิดรวม m² (Sphere ≥3.5 m²/คน)
  facilities: {                           // opt — นับจริง ใช้คำนวณ Sphere ratio vs occupancy
    toilets_female: 10, toilets_male: 10, toilets_accessible: 2,
    showers: 8, water_points: 3, handwashing_stations: 6
  },
  location, contact, opened_at, closed_at }
// registry:  config:app
{ type: "config", public_otp_required: false, duplicate_hint_threshold: 0.8, ... }

// catalog:   item:{ulid}
{ type: "supply_item", name, category, unit, reorder_level }
// catalog:   sop_profile:{ulid}
{ type: "sop_profile", name, ratios: { water_l_per_person_day: 3, ... } }
// catalog:   recipe:{ulid}   — สูตรต่อ 1 หน่วยเสิร์ฟ (กล่อง) ใช้ทั้งคำนวณแผนและประมาณการจาก stock
{ type: "recipe", name: "ข้าวไข่เจียว", serving_unit: "box",
  ingredients: [ { item_id: "item:01H...", qty: 0.15, unit: "kg" }, ... ],
  tags: ["halal", "soft_food"] }
```

## 4. Read models = CouchDB views (ไม่เก็บ aggregate เป็น doc)

| View (design doc `_design/app`) | ใช้ทำ |
| --- | --- |
| `occupancy` — map movement → reduce `_count` ตาม status | dashboard FR-14, occupancy guard FR-12 |
| `stock_balance` — map stock_ledger (item, ±qty) → reduce `_sum` | stock dashboard, reorder alert |
| `latest_screening` — map screening by (evacuee, ts) | ผลคัดกรองล่าสุด |
| `meals_served` — reduce `_sum` ต่อวัน/มื้อ | kitchen dashboard |
| `needs_open` — donation_campaign − donation(declared+received) | GET /public/v1/needs |

**Producible boxes (FR-39 ส่วนขยาย — "stock ทำได้กี่กล่อง"):** คำนวณฝั่ง client ไม่ใช่ view
(ต้อง join ข้าม db) — `producible(recipe) = min( stock_balance[item] / qty_per_box[item] )`
ต่อทุก ingredient ของ recipe; UI หน้า meal plan แสดงต่อเมนูว่า stock ปัจจุบันทำได้สูงสุดกี่กล่อง
เทียบกับจำนวนที่แผนต้องการ (occupancy × ratio) — ขาดเท่าไรส่งเข้า requisition/จัดหา

Mango indexes: `evacuee(last_name, first_name)`, `evacuee(phone)`,
`movement(evacuee_id, occurred_at)`, `donation(status)`, `medical(evacuee_id)` — สร้างผ่าน
design doc เดียวกัน deploy พร้อม db provisioning

## 5. Conflict policy

| กลุ่ม | นโยบาย |
| --- | --- |
| append-only (movement, ledger, screening, …) | ไม่มี conflict — `_id` ULID ไม่ชนกัน ห้าม update |
| mutable (evacuee, household, …) | LWW ด้วย `updated_at`; CouchDB เลือก winner เองแล้ว repair job ฝั่ง central ตรวจ `_conflicts` ทุกชม. → เก็บ revision แพ้ลง `audit` แล้วลบ conflict branch |
| state machine (donation, transfer, referral) | forward-only: สถานะปลายทางไกลกว่าชนะ |
| `current_stay` snapshot | movement view ชนะ — repair job sync snapshot |

## 6. Security & validation

- Auth = CouchDB `_session` cookie — app login กับ **central** ก่อนเสมอ (ผ่าน proxy `/couch`);
  ถ้า WAN/central เข้าไม่ได้จึง login กับ **edge fallback** ของศูนย์ตน เพราะ `_users` ถูก
  filtered-replicate ลง edge (เฉพาะ user ที่มี role `shelter:{id}` นั้น) → login ได้แม้ WAN ขาด; ไม่มี JWT layer
- central และ edge ออก `_session` cookie แยกกันตาม origin/remote; session ของ edge ใช้ได้แค่
  sync กับ edge fallback และ **ไม่** grant สิทธิ์เรียก `/api/v1/*` หรือ service API ของ central
- เมื่อ central กลับมา app ต้อง validate/login central session แล้วสลับ active remote กลับ central;
  ระหว่างสลับยังคงกติกา device replicate ไป remote เดียวเท่านั้น
- สร้าง/แก้ user ทำที่ central เท่านั้น (ผ่าน `/api/v1/users`) — เปลี่ยนรหัสผ่านต้องมี WAN ถึง central
- `_users` doc: `roles: ["system_admin"]` หรือ `["shelter:{id}", "registration_staff", "kitchen_staff", ...]`
  (1 user 1 shelter — role `shelter:{id}` ตัวเดียวเสมอ; `shelter_manager` ครอบสิทธิ์ REG/KS/WS);
  `affiliation_tags: ["volunteer"]` เป็น metadata เท่านั้น ไม่ให้สิทธิ์และไม่เปลี่ยน shelter scope
- `shelter_{shelter_code}._security.members.roles = ["shelter:{id}"]` + admins = `system_admin` —
  ตั้งเหมือนกันทั้ง central และ edge (provisioning จัดให้)
- `validate_doc_update` ต่อ shelter db บังคับ: type whitelist, append-only types ปฏิเสธ update/delete,
  ตาราง role→type ที่เขียนได้ (ตาม role-permission-matrix; public/API redaction ทำใน service layer) —
  design docs ชุดเดียว deploy ทั้ง central และ edge เพราะ edge อาจรับ write ตอน LAN fallback
- edge server = เครื่องของโครงการ อยู่ในศูนย์: disk encryption + อยู่ในวงจร wipe ตอนปิดศูนย์
- device ไม่เก็บ `_users`; local db เข้ารหัสด้วย OS storage + ลบตาม SOP 1 เดือน

## 7. Retention (PDPA — PSU เป็น data controller)

| ข้อมูล | นโยบาย |
| --- | --- |
| `medical` | purge ทันทีที่ครบ 3 เดือนหลัง `shelter.closed_at` (ลำดับแรก) |
| `evacuee`, `household` | แทนที่ด้วย tombstone ไร้ PII (`{type, anonymized: true}`) ภายใน 3 เดือนหลังปิดศูนย์ |
| `movement`, `screening`, ledger, audit | เก็บต่อได้ (อ้างถึงแค่ ULID — ไร้ PII หลัง tombstone) จนจบโครงการ |
| donor PII ใน `donation` | ลบ name/phone ภายใน 3 เดือนหลังปิดศูนย์ (เหลือ hash + ยอด) |
| local db บน device | อายุ 1 เดือน — app บังคับ destroy + SOP สั่ง wipe |
| edge server | wipe ทั้งเครื่อง (db + `_users` replica) เป็นขั้นตอนปิดศูนย์ — ก่อนนาฬิกา 3 เดือนเริ่มนับที่ central |

Purge จริงบน CouchDB ใช้ `_purge` ที่ central + บังคับ device ที่ยัง sync ค้าง resync ใหม่
(replication checkpoint ถูก invalidate หลัง purge — ตั้งใจ)

> **เผื่อ EOC (deferred):** `_purge` ไม่โผล่ใน `_changes` feed — ETL/MongoDB projection
> จะไม่เห็นการลบ ดังนั้น retention job ต้องลบข้อมูลฝั่ง MongoDB projection แยกเองเป็นขั้นตอน
> เดียวกับ purge เสมอ

## 8. Tooling

- **Seed script** (แทน e2e `mock-api.js` เดิม): สคริปต์ feed sample docs ทุก type ลง CouchDB docker —
  ใช้ทั้ง dev และ Playwright e2e ชี้ CouchDB จริง
- Provisioning script: mint `shelter.code` จาก central counter (`central_ops:counter:shelter` —
  read-modify-write `value+1`, ชน `_rev` → retry) → สร้าง `shelter_{shelter_code}` + `_security` +
  design docs ที่ central, ติดตั้ง edge fallback replica (db เดียวกัน + filtered `_users` replication +
  replication docs edge⇄central สำหรับ fallback/backlog) (ดู api-contract §3)
- Edge server image: docker compose ชุดเดียว (CouchDB + proxy) — เครื่องศูนย์ boot แล้วใส่
  `shelter_code` + central URL + credentials ก็เป็น LAN fallback; ไม่ใช่ normal client hub
