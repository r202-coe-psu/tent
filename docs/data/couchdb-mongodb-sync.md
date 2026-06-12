---
title: Smart Shelter — CouchDB ⇄ MongoDB Sync (Public Plane)
status: draft for review
created: 2026-06-11
updated: 2026-06-12
note: คู่กับ data-model.md v3 + api-contract.md v1 — กำหนดว่า public tier (family-search / donate / needs / transparency) ทำงานบน MongoDB ไม่แตะ CouchDB central ตรง; CouchDB central = system of record, MongoDB = derived public store + intake buffer
---

# Smart Shelter — CouchDB ⇄ MongoDB Sync

## 0. ทำไมต้องมี MongoDB

api-contract v1 เดิมเขียนว่า public plane "อ่าน central CouchDB ตรง" — รุ่นนี้ **refine**: คั่นด้วย
**MongoDB เป็น public-facing store** แทน. CouchDB central ไม่รับ public internet traffic เลย.

| เหตุผล | ผล |
| --- | --- |
| **Privacy by construction** | เฉพาะ field ที่ public เห็นได้ ถูก project ลง Mongo (นามสกุล masked, ไม่มี medical, ไม่มีเบอร์ใน response) — ต่อให้ Mongo รั่ว ก็ไม่มี PII เต็ม |
| **Blast radius** | public traffic / scraping / DDoS ชนแค่ Mongo replica — operational CouchDB (ที่ศูนย์พึ่งพา) ไม่กระทบ |
| **Query shape** | family-search ต้องการ text index + phone exact + masking — ทำบน Mongo (aggregation/`$text`) ง่ายกว่า CouchDB view มาก |
| **Scaling แยกโปรไฟล์** | public อ่านหนัก-เขียนเบา, operational เขียนหนัก — แยก store ปรับ scale อิสระ |

**กติกาเจ้าของข้อมูล (สำคัญสุด):**

- **CouchDB central = system of record** สำหรับทุก operational doc (evacuee, donation lifecycle, stock, …)
- **MongoDB = derived + buffer** — เป็นเจ้าของได้อย่างเดียวคือ *การประกาศ donation จาก public ตอนแรก*
  (ก่อนถูก persist เข้า CouchDB) เท่านั้น; ที่เหลือ Mongo คือ projection อ่านอย่างเดียว

---

## 1. Topology — ต่อจาก 3 ชั้นเดิม

```
device (PouchDB) ⇄ LAN ⇄ edge (CouchDB @ศูนย์) ⇄ WAN ⇄ central (CouchDB)
                                                            │
                                            sync worker (CDC ทั้งสองทิศ)
                                                            │
                                                       MongoDB  ⇄  /public/v1/* (internet)
```

- public client **ไม่เคย**คุย CouchDB; คุยแค่ `/public/v1/*` ที่อ่าน/เขียน Mongo
- staff/device **ไม่เคย**คุย Mongo; อยู่บน sync plane (PouchDB⇄edge⇄central) เหมือนเดิม
- **sync worker** = service เดียวที่แตะทั้งสอง store; อยู่ฝั่ง central (มี WAN ถึง central CouchDB + Mongo)
- Mongo replica ขึ้น public edge ได้ (read replica) แต่ write ทุกอย่างวิ่งผ่าน sync worker จุดเดียว

---

## 2. ทิศทาง sync — มี 2 plane

| Plane | ทิศ | กลไก | ใช้ทำ |
| --- | --- | --- | --- |
| **Outbound** | CouchDB central → Mongo | tail `_changes` (CDC) → project → upsert | person index, needs, transparency, donation status |
| **Inbound** | Mongo → CouchDB central | poll Mongo `donations` ใหม่ → `db.put(donation:{ulid})` | บันทึก donation ที่ public ประกาศเข้าระบบจริง |

ทั้งสอง plane **idempotent** และมี **checkpoint** — restart worker ได้ปลอดภัย ไม่ซ้ำ ไม่หาย.

---

## 3. Outbound — CouchDB → MongoDB (projection, read-only ฝั่ง Mongo)

### 3.1 กลไก

- worker tail `GET /{db}/_changes?feed=continuous&include_docs=true&since={last_seq}` ของ **ทุก
  `shelter_{shelter_id}`** ที่ central (+ `registry` สำหรับ shelter status)
- เก็บ checkpoint `last_seq` ต่อ db ใน Mongo collection `_sync_checkpoints` — restart แล้ว resume จุดเดิม
- แต่ละ change → ผ่าน **projector** ตาม `doc.type` → upsert/ลบใน Mongo collection ปลายทาง
- เป็น CDC แบบ near-realtime (วินาที) — public เห็นข้อมูลช้ากว่า operational เล็กน้อย ยอมรับได้

> `_purge` (retention) **ไม่โผล่ใน `_changes`** — ดู §7 retention; worker ต้องลบ Mongo แยก

### 3.2 Mongo collections (ปลายทาง projection)

```js
// public_persons — family-search index (1 doc / evacuee ที่ค้นเจอได้)
{ _id: "evacuee:01H...",            // = CouchDB _id (idempotency)
  shelter_id: "01H...",             // ULID ของ shelter
  first_name: "สมชาย",              // ชื่อจริงเต็ม
  last_name_masked: "ใจ****ดี",      // mask ตอน project (≥5: 2หน้า+****+2ท้าย; ≤4: ตัวแรก+****; นับ grapheme)
  phone_hash: "sha256(0812345678)", // ค้นด้วยเบอร์เต็ม = hash แล้วเทียบ — เบอร์จริงไม่ลง Mongo
  status: "checked_in",             // จาก current_stay
  updated_at: "..." }
// projector: ถ้า evacuee.privacy.search_excluded == true → ลบ doc นี้ออกจาก Mongo (opt-out = หายทั้ง record)
// ไม่มี: นามสกุลเต็ม, เบอร์ดิบ, medical, national_id, household — ไม่ project เด็ดขาด

// public_needs — ความต้องการรวม (จาก donation_campaign − donation ที่รับแล้ว)
{ _id: "{shelter_id}:item:01H...", shelter_id, item_name, category, qty_needed, unit, updated_at }
// projector: คำนวณจาก view needs_open ของแต่ละ shelter; qty_needed ≤ 0 → ลบ doc

// public_donations — สำหรับ tracking_token lookup (mirror สถานะจาก CouchDB)
{ _id: "donation:01H...", tracking_token, shelter_id, status: "declared|received|expired",
  items_declared: [...], received_summary: {...} | null, updated_at }
// projector: sync สถานะ donation กลับมาให้ public ดูผ่าน GET /public/v1/donations/{token}

// public_transparency — aggregate ต่อศูนย์ (donations รับแล้ว, occupancy ระดับนับ)
{ _id: "{shelter_id}", shelter_id, name, status, total_donations_received, occupancy_count, updated_at }
```

**หลักการ projection:** allow-list field เท่านั้น — projector มี whitelist ตายตัวต่อ type; field
ใหม่ใน CouchDB **ไม่หลุด**ไป Mongo เองจนกว่าจะเพิ่มใน whitelist (กัน PII leak โดยอุบัติเหตุ).

---

## 4. Inbound — MongoDB → CouchDB (donation intake)

public ประกาศบริจาคผ่าน `POST /public/v1/donations` → เขียน Mongo ก่อน → worker ค่อย persist เข้า CouchDB.

### 4.1 ลำดับ

```
1. public POST /public/v1/donations
   → API เขียน Mongo `donations`:
     { _id: <ULID>, shelter_id, donor: { name, phone },      // PII อยู่ Mongo ชั่วคราว
       items_declared: [{ item_name, qty, unit }],
       status: "declared", tracking_token: <random>,
       synced_to_couch: false, created_at }
   → ตอบ public { tracking_token }   ทันที (ไม่รอ CouchDB)

2. inbound worker poll Mongo `donations` where synced_to_couch=false
   → db.put ลง central shelter_{shelter_id}:
     donation:{ULID} { type:"donation", schema_v:1, status:"declared",
                       donor:{name,phone}, items_declared:[...],
                       tracking_token, source:"public", created_at }
   → ULID ของ Mongo = ULID ของ _id ใน CouchDB → idempotency key
     (worker crash/retry → put ซ้ำ → 409 = สำเร็จแล้ว ไม่เกิด donation ซ้ำ)
   → mark Mongo doc synced_to_couch=true

3. central → edge → device (replication ปกติ)
   → staff ที่ศูนย์เห็น "donation ขาเข้า" สถานะ declared ในแอป
```

donation doc ที่ลงไปเป็น state machine แบบ **forward-only** (data-model §3.2): `declared → received → expired`.

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
| donation lifecycle | CouchDB | → Mongo | หลัง persist แล้ว CouchDB คุม status; Mongo mirror |
| stock_ledger | CouchDB | — (ไม่ขึ้น Mongo) | ไม่ project — stock เป็นข้อมูลภายในศูนย์ |
| needs / transparency | CouchDB (view) | → Mongo | Mongo อ่านอย่างเดียว |

- **ไม่มี conflict ข้าม store**: donation มี boundary ชัด (Mongo เป็นเจ้าของก่อน persist, CouchDB หลัง persist)
  — ULID เดียวกันตลอด ใช้เป็น idempotency key ทั้งสองฝั่ง
- ถ้า worker ตายระหว่าง persist: Mongo `synced_to_couch` ยัง false → poll รอบหน้า retry → put ซ้ำ → 409 ปลอดภัย

---

## 6. Public endpoints map → Mongo (refine api-contract §5)

| Endpoint | แตะ Mongo | หมายเหตุ |
| --- | --- | --- |
| `POST /public/v1/family-search` | read `public_persons` (`$text` ชื่อ หรือ `phone_hash`) | response: ชื่อจริง + นามสกุล masked + ศูนย์ + สถานะ; **ไม่มีเบอร์**; audit ลง Mongo → sync → `central_ops.search_audit` |
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

| ตอนปิดศูนย์ / ครบ 3 เดือน | CouchDB | MongoDB (ต้องทำคู่กัน) |
| --- | --- | --- |
| evacuee → tombstone | `_purge` + tombstone | ลบ `public_persons` ของ shelter นั้น |
| donor PII ใน donation | ลบ name/phone | ลบ donor PII ใน `public_donations` + `donations` |
| ปิดศูนย์ | status=closed | ลบ `public_needs`, `public_transparency` ของ shelter |

donor PII (`donor.name/phone`) ใน Mongo `donations`: ลบทันทีที่ donation ถึง terminal state นานพอ
หรืออย่างช้า 3 เดือนหลังปิดศูนย์ (เหลือ hash + ยอด) — เหมือนกฎ CouchDB.

---

## 8. การเขียนโค้ด / tooling

- **sync worker** = service เดียว (เสนอ FastAPI worker / standalone process ที่ central) มี 3 loop:
  outbound `_changes` tailer (ต่อ shelter db), inbound donation poller, retention reaper
- **checkpoint** อยู่ Mongo `_sync_checkpoints` (`{db, last_seq}`) — แหล่งความจริงเดียวของความคืบหน้า
- **projector** มี unit test ต่อ type ยืนยัน allow-list (กัน field ใหม่หลุด) + masking ถูกต้อง
- **seed script** (data-model §8) ควร seed ทั้ง CouchDB และรัน worker 1 รอบให้ Mongo มี projection
  สำหรับ dev/e2e ของ public tier
- Mongo indexes: `public_persons`: `$text(first_name,last_name_masked)`, `{phone_hash}`,
  `{shelter_id}`; `public_donations`: `{tracking_token}`; `donations`: `{synced_to_couch}`

## 9. สิ่งที่ตั้งใจ "ไม่มี"

- Mongo **ไม่ใช่** source of truth ของอะไรเลยนอกจาก donation ก่อน persist — ห้าม UI/แอป staff อ่าน Mongo
- **ไม่** sync stock_ledger / movement / medical / household ขึ้น Mongo — operational data ไม่ออกนอกศูนย์
- **ไม่มี** auto donation→stock — ของเข้า stock ผ่านการคีย์มือของ staff เท่านั้น (§4.2)
- **ไม่มี** two-way merge ของ field เดียวกันข้าม store — ทุก field มีเจ้าของฝั่งเดียว (§5)
</content>
</invoke>
