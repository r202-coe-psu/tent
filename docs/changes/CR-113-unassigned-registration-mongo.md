---
id: CR-113
title: Unassigned Registration — Mongo-only pre-registration without shelter until claim
status: approved
date: 2026-09-06
updated: 2026-09-06
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

### Claim algorithm (locked)

1. Staff โหลดเอกสาร · ติ๊กสมาชิกที่จะรับเข้าศูนย์นี้  
2. สำหรับแต่ละคนที่ติ๊ก (`open`): สร้าง Couch `evacuee` ด้วย `reserved_evacuee_id` + household ด้วย `reserved_household_id` (สร้าง household ครั้งแรกถ้ายังไม่มีในศูนย์) สถานะ `pre_registered`  
3. ตั้ง `members[].status = claimed` (+ metadata shelter/time/actor ตามต้องการ)  
4. คนที่ไม่ติ๊กคง `open`  
5. ถ้าไม่มีสมาชิก `open` เหลือ → hard-delete เอกสาร `unassigned_registrations`  
6. Worker project → `public_persons` จาก Couch (ครั้งแรกที่มีแถวสาธารณะ)  
7. ศูนย์อื่น claim สมาชิกที่ `claimed` แล้วไม่ได้; สมาชิก `open` ยังอยู่ในคิวให้ศูนย์อื่น/รอบหลังได้ตามนโยบายค้น

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

## Relationship

คู่กับ [CR-112](CR-112-registration-foundation-schema-stay.md) — claim ใช้ Anonymous ID / housing / VG จาก foundation

## Out of scope

- No-show aging report (เลื่อนทั้งก้อน — ไม่มี SOP)
- Auto-merge offline duplicate
- Pet image upload UX

