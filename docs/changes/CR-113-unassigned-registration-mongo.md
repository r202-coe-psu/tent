---
id: CR-113
title: Unassigned Registration — Mongo-only pre-registration without shelter until claim
status: done
date: 2026-09-06
updated: 2026-09-09
requested_by: เจ้าของโครงการ (grill-with-docs session)
decided_by: เจ้าของโครงการ
layer: stable
affects:
  - docs/data/schema.md §9.5 (new Mongo collection `unassigned_registrations` — not Couch evacuee)
  - docs/data/couchdb-mongodb-sync.md (explicit non-sync / claim birth of Couch SoR; no public_persons stub until claim)
  - docs/data/api-contract.md (create + staff search + claim APIs)
  - docs/features/site-occupancy-booking-program.md (parallel path vs shelter-known booking)
  - CONTEXT.md Unassigned Registration / Public Pre-registration
  - backend FastAPI modules (new)
  - frontend staff search + public pre-register without shelter
supersedes_draft: draft-central-pool-mongo.md
tracking_note: >-
  track=CR file. sheet=OK 2026-09-06. Owner approved + stable-core review OK
  2026-09-06. Pair: CR-112 (registration foundation). Schema delta §6 merged from
  docs/data/proposed-registration-foundation-schema-delta.md (superseded).
  2026-09-08: claim algorithm locked to option B (Mongo mark/lock → Couch birth →
  revert on Couch failure); #247 review alignment — edit in place, no new CR.
  2026-09-08: leftovers grill — full-claim Mongo delete best-effort; orphan returns
  HTTP 200 with deleted:false + id; CR marked done after #245–#247 delivery.
  2026-09-09: #255 Amendment — queue field parity with public UnifiedRegistrationForm
  (+ photo GridFS); schema_v 2 for new docs; overall status remains done.
  2026-09-09: #255 pet photo — UnassignedPet.image_url (gfs:) + claim → Couch pet image_url.
  2026-09-09: Amendment — public **shelter-specific** booking photos (face + pet) via
  BFF → Couch `image:{ulid}` (public writer); unassigned remains GridFS.
---

# Unassigned Registration — Mongo-only, shelter not chosen yet

## สรุป (TL;DR)

**Unassigned Registration** (ไทย: ลงทะเบียนล่วงหน้าแบบไม่ระบุศูนย์) = ครัวเรือนที่ลงทะเบียนล่วงหน้าแต่**ยังไม่เลือกศูนย์** เก็บใน Mongo collection **`unassigned_registrations`** เท่านั้น — **ยังไม่ใช่ Evacuee** · staff ค้นจาก collection นี้โดยตรง (ไม่สร้าง stub ใน `public_persons`) · claim เข้าศูนย์ → สร้าง Couch `evacuee`(+`household`) ที่ `pre_registered` ด้วย reserved ids · คนที่ไม่มากับชุดยังคง `open` ในเอกสารเดิมได้ · ไม่นับ Forecast รายศูนย์จนกว่า claim · คู่ขนานกับจองรายศูนย์บน Couch เมื่อรู้ศูนย์แล้ว

## Why

จองเข้าศูนย์ที่รู้แล้ว (CR-070/108) ไม่ครอบคลุม “ลงทะเบียนก่อน ยังไม่รู้จะเข้าศูนย์ไหน” · เขียน Couch ทุกศูนย์จะกระจาย SoR ผิด · แยก PII ออกจาก `public_persons` (projection สาธารณะ) กัน leak / reconcile ทับ

## Change (before → after)

| หัวข้อ | Before | After |
| --- | --- | --- |
| ไม่รู้ศูนย์ | ไม่มี / บังคับเลือกศูนย์ | เขียน **`unassigned_registrations`** ใน Mongo |
| รู้ศูนย์ | Couch `evacuee` `pre_registered` | **คงเส้นนี้** คู่ขนาน |
| เอกสาร | — | หนึ่งเอกสารต่อครัวเรือน; `members[]` + ที่อยู่/pets ระดับบ้าน — **ไม่เรียก Evacuee** จน claim |
| ค้น | — | Staff เท่านั้น · ค้นตรงจาก `unassigned_registrations` · **ไม่มี** แถวใน `public_persons` จน claim + worker project |
| Claim | — | สร้าง Couch ด้วย `members[].reserved_evacuee_id` + `reserved_household_id` · stay `pre_registered` · API ตั้งบริบทศูนย์ทันที · สมาชิกที่รับ → `claimed` |
| Partial claim | — | ติ๊กคนที่มา; คนไม่มาคง `open` ในเอกสารเดิม (ดึงกลับมาทีหลังได้) |
| ลบเอกสารคิว | — | Hard-delete ได้เมื่อ**ไม่มี**สมาชิก `open` แล้ว · หรือ `system_admin` ลบทั้งใบขณะยังเป็นคิวกลาง |
| จองรายศูนย์ Couch | soft `cancelled` | **คง** ห้าม hard-delete |
| Offline | — | search ไม่เจอ; เฟสนี้ไม่ auto-merge ซ้ำบัตร |
| Forecast | — | เอกสารคิวกลาง **ไม่นับ** จน claim |

### Collection shape (locked)

```text
unassigned_registrations
  _id, schema_v
  reserved_household_id          // household:{ulid} จองตั้งแต่สร้าง
  members[]:
    reserved_evacuee_id          // evacuee:{ulid}
    status: open | claimed | cancelled
    person fields (name, phone, person_id, country, vulnerable_groups, special_needs, …)
  household: housing_type, residence_landmark, geo, pets, …
  status                         // สรุประดับเอกสาร (derive จาก members ได้)
  registered_via                 // web | staff | …
  created_at
```

**Indexes:** unique partial บน identity ที่สมาชิกยัง `open` (national_id / passport / ANON; เบอร์ตามกฎกันซ้ำ Q66 — unique บัตร/ANON เข้ม, เบอร์ตาม implement note ใน foundation) · index `created_at`, member status.

### Claim algorithm (locked) — option B: Mongo mark/lock → Couch birth

ลำดับนี้ตั้งใจให้ศูนย์อื่น claim คนเดียวกันไม่ได้ระหว่าง birth — **ห้าม** สลับเป็น Couch-first.

1. Staff โหลดเอกสาร · ติ๊กสมาชิกที่จะรับเข้าศูนย์นี้ (ต้องเลือกเอง — ไม่ pre-check ทั้งชุด)
2. **Atomic mark ใน Mongo:** สำหรับทุกคนที่ติ๊กที่ยัง `open` → ตั้ง `members[].status = claimed` (+ shelter/time/actor) และอัปเดต identity indexes / document status — ถ้า mark ไม่ผ่าน (แข่ง claim) → 409 ไม่แตะ Couch
3. **Birth Couch SoR:** สร้าง `evacuee` ด้วย `reserved_evacuee_id` + `household` ด้วย `reserved_household_id` (สร้าง household ครั้งแรกถ้ายังไม่มีในศูนย์) สถานะ `pre_registered` · `_bulk_docs` `conflict` บน reserved id = สำเร็จแบบ idempotent (เอกสารเกิดแล้ว)
4. ถ้า Couch birth ล้มเหลว (ยกเว้น conflict ที่ถือว่าสำเร็จ) → **revert** สมาชิกที่ mark ไปกลับเป็น `open` ใน Mongo แล้วตอบ 503 `ONLINE_REQUIRED`
5. คนที่ไม่ติ๊กคง `open`
6. ถ้าไม่มีสมาชิก `open` เหลือ → **best-effort** hard-delete เอกสาร `unassigned_registrations` (ไม่ atomic กับ birth; orphan claimed-without-delete ยอมได้จนกว่า cleanup). ถ้า delete ล้มหลัง birth สำเร็จแล้ว → ยังตอบ **HTTP 200** claim success ด้วย `deleted: false` และ `id: <registration_id>` (ตาม orphan ได้) + log ฝั่งเซิร์ฟเวอร์ — **ไม่** ตอบ 503
7. Worker project → `public_persons` จาก Couch (ครั้งแรกที่มีแถวสาธารณะ)
8. ศูนย์อื่น claim สมาชิกที่ `claimed` แล้วไม่ได้; สมาชิก `open` ยังอยู่ในคิวให้ศูนย์อื่น/รอบหลังได้ตามนโยบายค้น

### APIs (indicative)

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/public/v1/unassigned-registrations` | public BFF + secret |
| GET | `/staff/v1/unassigned-registrations/search?q=` | staff session |
| POST | `/staff/v1/unassigned-registrations/{id}/claim` | staff + shelter scope |
| DELETE | `/staff/v1/unassigned-registrations/{id}` | **`system_admin` only** |

## Requirements

- FR-UR-01 — สร้าง `unassigned_registrations` โดยไม่สร้าง Couch `evacuee` / ไม่สร้าง `public_persons`  
- FR-UR-02 — Staff ค้นสมาชิก/เอกสาร `open` ได้เมื่อ online  
- FR-UR-03 — Claim บางส่วนได้; สร้าง Couch ด้วย reserved ids ที่ `pre_registered`  
- FR-UR-04 — Hard-delete เอกสารเมื่อไม่มี `open` เหลือ; `system_admin` ลบทั้งใบได้ก่อนนั้น  
- FR-UR-05 — จองรายศูนย์ Couch คู่ขนานเมื่อมีศูนย์  
- FR-UR-06 — ไม่นับ Forecast รายศูนย์จากคิวกลาง  
- FR-UR-07 — Glossary: Unassigned Registration ≠ Evacuee; ≠ Couch `pre_registered` hold  

## Acceptance

- Pre-reg ไม่เลือกศูนย์ → มีแค่ Mongo `unassigned_registrations` (Couch + `public_persons` ว่างสำหรับคนนั้น)  
- Claim บางสมาชิก → มี evacuee ใน Couch ของศูนย์; คนไม่มาค้นจากคิวกลางเจออยู่  
- เคลียร์สมาชิก `open` หมด → เอกสารคิวถูกลบ  
- ตัดเน็ตศูนย์ → ค้นคิวว่าง/error ที่เข้าใจได้  
- Forecast ศูนย์ไม่กระโดดตอนสร้างคิวกลาง  

## Impact

- **Stable core** (ที่มา SoR / Mongo เขียนตรง) — ต้อง stable review ก่อน approve  
- Public pre-register UX สองเส้น  
- Staff Station 1 claim UI (รายการสมาชิกติ๊กได้)  

## Migration

- N/A Couch  
- เพิ่ม collection + indexes  

## Decision log

- 2026-09-06 — grill Q35=C (Mongo-only เมื่อไม่รู้ศูนย์); Q39+ sheet=OK แทน draft ชื่อ Central Pool / `central_pool_registration`
- 2026-09-06 — เลิกคำหลัก Central Pool → **Unassigned Registration**; collection **`unassigned_registrations`**
- 2026-09-06 — Owner approve: `track=CR file` + stable review OK → **CR-113**; merge delta §6 เข้า `schema.md`
- 2026-09-08 — #247 review: lock claim order = **option B** (Mongo mark → Couch birth → revert on Couch failure); `_bulk_docs` conflict = OK; full-claim hard-delete = best-effort; Station 1 checkboxes start empty
- 2026-09-08 — leftovers grill: orphan delete path = 200 + `deleted: false` + `id`; UI secondary toast; mark CR **done** after #245–#247

## Relationship

คู่กับ [CR-112](CR-112-registration-foundation-schema-stay.md) — claim ใช้ Anonymous ID / housing / VG จาก foundation

## Out of scope

- No-show aging report (เลื่อนทั้งก้อน — ไม่มี SOP)
- Auto-merge offline duplicate

## Amendment — 2026-09-09 (#255 public no-shelter → Mongo)

**Status of original CR work:** remains **done**. This amendment expands the queue
shape so public UnifiedRegistrationForm fields (plus face photo) persist and survive
claim into Couch — without reopening the original claim algorithm.

### Decisions locked (#255 grill)

| Topic | Decision |
| --- | --- |
| Executor | Browser → SvelteKit BFF → FastAPI (Bearer). Dedicated `executeUnassignedRegistration` mirrors #254 Couch executor but POSTs Mongo via FastAPI. Shared `UnifiedRegistrationInput` — **not** `FamilyRegistrationPlan`. |
| Fields on Mongo member | identity/person_id, phone, nickname, religion, emergency_contact, vulnerable_groups, special_needs, birth_year/age, **photo** |
| Household | housing / address / pets as public already collects; pets may carry optional **`image_url`** (`gfs:{oid}`) |
| Explicitly out | vehicles/assets (public clears/hides); medical_conditions / medical_allergies / medical_medications |
| Blank emergency_contact | `{name,phone,relation}` all blank → **omit** from Mongo and do not put on Couch at claim |
| Non-blank emergency_contact | persist on Mongo member + copy into Couch Evacuee on claim |
| nickname / religion | copy on claim when present |
| schema_v | New docs stamp **`2`**; old `1` readable without backfill |
| Photo | MongoDB **GridFS** (`unassigned_registration_photos`); member.photo = `gfs:{oid}`; pet.image_url = `gfs:{oid}` (same upload endpoint); claim births Couch `image:{ulid}` + sets `evacuee.photo` / `household.pets[].image_url` |
| Ticket QR | Unassigned booking ticket = Mongo registration id — **not** Station-1 Person QR / FamilyBatchPrint / Handover until claim |
| Disclaimer | General system disclaimer (i18n) must be acknowledged before unassigned submit |

### Follow-up (optional)

Field parity for vehicles/assets **if** public channel ever enables them — track as a separate issue; do not expand this CR again for that.

## Amendment — 2026-09-09 (public shelter booking photos → Couch)

**Parallel path (not Unassigned):** when the citizen **chooses a shelter**, public booking
already writes Couch via BFF `POST /api/public/v1/registrations` (CR-070). Face + pet photos
on that path now use **`POST /api/public/v1/registrations/photos`** → Couch `image:{ulid}`
(+ `full`/`thumb` attachments) in `shelter_{code}` via the roleless public writer — same SoR
shape as onsite (CR-054). Refs land on `evacuee.photo` / `household.pets[].image_url` as
`image:{ulid}` (never `gfs:`).

| Path | Photo store | Ref shape |
| --- | --- | --- |
| Onsite staff | Couch (AuthSession `useSaveImage`) | `image:{ulid}` |
| Public **unassigned** (no shelter) | Mongo GridFS (#255) | `gfs:{oid}` → Couch on claim |
| Public **shelter booking** | Couch via BFF public writer | `image:{ulid}` |

Unassigned GridFS endpoint and claim migration are unchanged.

