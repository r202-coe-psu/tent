---
id: draft
title: Persistent Unassigned Registration family — no hard-delete; pet claim tracking; reopen on late join
status: proposed
date: 2026-09-29
requested_by: product / persistent family queue
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §9.5 (unassigned_registrations)
  - packages/tent-model UnassignedPet / document status
  - FastAPI unassigned create/join/claim/search
  - staff ClaimDialog (people + pets)
  - public residence-match chips (honest is_in_shelter copy; no soft-join)
  - schema_v bump on unassigned_registrations (2 → 3)
supersedes_partial:
  - CR-113 claim step 6 best-effort hard-delete after full claim
---

# draft-persistent-unassigned-family — persistent Mongo family

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ใบ Mongo คิวกลาง**ไม่ hard-delete** หลัง claim ครบ; เมื่อไม่มีคน/สัตว์ `open` → เอกสาร `closed` (ประวัติ) แต่คงอยู่; คน/สัตว์ join ทีหลัง append เข้าใบเดิมแล้ว **reopen**; track claim รายสัตว์ (`pet_id` + status + shelter meta)
> - **Claim UI:** ติ๊กเฉพาะคนและสัตว์ที่ยัง `open`; ส่ง `member_ids` + `pet_ids`
> - **ไม่ทำ:** soft-join / `join_intent`; kiosk อ่านคิวกลาง; migrate ใบที่ถูกลบไปแล้ว
> - **Bump `schema_v`:** เขียนใหม่ stamp **3**; ของเก่าอ่านได้ (pet ไม่มี `pet_id`/`status` → ถือ `open`)

---

## Why

Partial claim + late joiners ต้องการประวัติครอบครัวเดียวกันใน Mongo · hard-delete หลัง full claim ทำให้ join ทีหลังสร้างใบใหม่/หาใบเดิมไม่ได้ · สัตว์เลี้ยงยังไม่มี lifecycle แยกจากคน · soft-join เข้า Couch HH จากชิป `is_in_shelter` นอกสโคปรอบนี้

## Change

### Document lifecycle

| เหตุการณ์ | พฤติกรรม |
| --- | --- |
| มีสมาชิกหรือสัตว์ `open` ≥1 | `status` เอกสาร = `open` |
| ไม่มี `open` เหลือ | `status` = `closed` (history) — **ไม่ลบ** |
| Public join (`join_registration_id`) | อนุญาตแม้เอกสาร `closed` → append members/pets เป็น `open` → ตั้งเอกสารกลับ `open` |
| `JOIN_TARGET_NOT_FOUND` | เฉพาะเมื่อ `_id` ไม่มีจริงใน Mongo |

### Pets (`household.pets[]`)

| Field | ชนิด | หมายเหตุ |
| --- | --- | --- |
| `pet_id` | str | stable id (`pet:{ulid}`); เขียนใหม่ต้องมี |
| `status` | enum(`open`,`claimed`,`cancelled`) | default อ่านของเก่า = `open` |
| `claimed_shelter_code` / `claimed_at` / `claimed_by` | opt | ตั้งตอน claim |
| `species` / `count` / `notes` / `has_cage` / `image_url` | คงเดิม | `count>1` แถว legacy = claim ทั้งแถวเป็นหน่วยเดียว (v1) |
| ของใหม่ | — | แถวละ 1 ตัว (`count=1`) + `pet_id` |

Couch `household.pets` schema **ไม่เปลี่ยน** — claim append เฉพาะสัตว์ที่ติ๊กเข้า HH ที่ศูนย์นั้น

### Claim

1. รับ `member_ids` และ/หรือ `pet_ids` (อย่างน้อยหนึ่งรายการ; ต้องเป็น `open`)
2. Option B: mark Mongo (คน+สัตว์) → birth/append Couch → revert คน+สัตว์ถ้า Couch ล้ม
3. ศูนย์เดิม: reuse `reserved_household_id` ถ้า HH มีแล้ว; **append pets** เข้า HH ที่มี
4. คนละศูนย์: สมาชิก/สัตว์ในใบเดียวกันไปคนละศูนย์ได้ — ไม่ auto-merge ข้ามศูนย์
5. หลัง mark ครบ open → ตั้งเอกสาร `closed`; **ห้าม** hard-delete (ยกเว้น `system_admin` purge ที่มีอยู่ — FR-UR-04 admin path คงไว้)

### Public copy (`is_in_shelter`)

- ชิปจากใบ Mongo ที่เคยมีคน claim แล้ว: แสดงว่ามีครอบครัวที่ศูนย์นั้นแล้ว — **แนะนำไปศูนย์ / แจ้งเจ้าหน้าที่**; ปุ่มเข้าร่วมยังหมายถึง **append เข้าใบ Mongo เดิม** (ไม่ soft-join Couch HH)
- **ไม่** implement `join_intent` / soft-join

### Search / list

- คืนเฉพาะสมาชิก `open` (และ open pets ใน hit เมื่อ UI ต้องใช้)
- Indexes กันซ้ำยังนับเฉพาะ identity ของสมาชิก `open`

## Requirements

- FR-PUF-01 — หลัง claim จนไม่มี `open` เอกสารยังอยู่และ `status=closed`
- FR-PUF-02 — join ใบ `closed` ได้ → append + reopen เป็น `open`
- FR-PUF-03 — สัตว์มี `pet_id` + `status` + claim meta; ของเก่าไม่มี field → ถือ `open`
- FR-PUF-04 — claim รับ `pet_ids`; ติ๊กเฉพาะ open คน/สัตว์; append pets ที่ติ๊กเข้า Couch HH
- FR-PUF-05 — ชิป `is_in_shelter` บนคิวกลาง = แนะนำศูนย์; ไม่ soft-join
- FR-PUF-06 — เขียนใหม่ stamp `schema_v: 3`

## Acceptance

- [ ] AC-01: full claim → Mongo doc คงอยู่, `status=closed`, `deleted=false`
- [ ] AC-02: join หลัง closed → สมาชิกใหม่ `open`, เอกสาร `open`
- [ ] AC-03: claim คน+สัตว์ / สัตว์อย่างเดียว (หลังมี HH) / สองศูนย์คนละรอบ ผ่าน
- [ ] AC-04: ClaimDialog โชว์ติ๊ก open pets + ส่ง `pet_ids`
- [ ] AC-05: public chip มีครอบครัวในศูนย์แล้ว = copy แนะนำ; ไม่สัญญา「เข้าร่วมศูนย์แล้ว」
- [ ] AC-06: อ่าน schema_v ≤2 pets ได้โดยไม่ throw

## Out of scope

- Soft-join / `join_intent` เข้า Couch HH จากชิป shelter
- Auto-merge ข้ามศูนย์
- Kiosk อ่านใบ Mongo / ติ๊กจากคิวกลาง
- Migrate ใบที่ถูกลบไปแล้วหรือ HH ซ้ำที่มีอยู่
- เปลี่ยน shelter booking hard-join

## Follow-up (ไม่บล็อก MVP นี้)

### Household merge suggestions

Staff อาจมี HH ซ้ำในศูนย์เดียวกันจาก claim คนละรอบ / ลงทะเบียนซ้อน — แนะนำ merge บน household profile โดยเทียบ `matchesResidenceAddress` แล้วเปิด `HouseholdMergeDialog` ที่มีอยู่ · **implement ขั้นต่ำ:** banner บน profile เมื่อเจอ candidate · **เต็มรูปแบบ / ranking** ทำเป็น issue แยกหลัง draft นี้ได้เลข CR

### Kiosk team handoff

แจ้งทีม kiosk: คิวกลางอาจมีใบ `closed` ค้าง + สมาชิก/สัตว์ `open` หลัง late join — **อย่าสมมติ** soft-join หรือว่าใบหายหลัง claim ครบ; Station 1 claim จากคิวกลางยังเป็นแหล่งรับคน/สัตว์ที่เหลือ

## Impact

- `packages/tent-model/src/tent_model/unassigned_registration.py`
- `docs/data/schema.md` §9.5
- `backend/apiapp/modules/unassigned_registrations/{use_case,schemas,couch_birth}.py`
- `backend/tests/test_unassigned_registration_*.py`
- `frontend/.../unassigned-registration/` (claim domain + ClaimDialog)
- `frontend/.../public-register/residence-match.server.ts` + unified registration chip copy
- optional: household-profile merge-suggest banner

## Migration

- Additive pet fields + document `closed` status
- ไม่ backfill batch; reader default pet `status=open` เมื่อขาด field; writer ใหม่ stamp `schema_v: 3` และ mint `pet_id` ตอนสร้าง/join
- แถว `count>1` เดิม: claim ทั้งแถวเป็นหน่วยเดียวใน v1

## Decision log

- 2026-09-29 — proposed (draft; รอ owner อนุมัติเลข CR + ช่องทาง track) · แทน soft-join เป็นแกน · ไม่ hard-delete · reopen on join
