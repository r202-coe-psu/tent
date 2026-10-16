---
id: CR-140
title: Persistent Unassigned Registration family — no hard-delete; pet claim tracking; reopen on late join; claim on Report-in confirm
status: approved
date: 2026-09-29
requested_by: product / persistent family queue
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §9.5 (unassigned_registrations)
  - packages/tent-model UnassignedPet / document status
  - FastAPI unassigned create/join/claim/search
  - docs/data/api-contract.md (staff review + photo read endpoints)
  - FastAPI staff `GET /{id}/review` + `GET /photos/{photo_id}` (require_registration_staff)
  - SvelteKit BFF `/api/staff/v1/unassigned-registrations/*`
  - staff ClaimDialog (select only, no claim call)
  - new staff review page /onsite/unassigned/[id]/report-in (claim + report-in on confirm)
  - public residence-match chips (honest is_in_shelter copy; no soft-join)
  - schema_v bump on unassigned_registrations (2 → 3)
supersedes_partial:
  - CR-113 claim step 6 best-effort hard-delete after full claim
---

# CR-140 — persistent Mongo family + claim-on-report-in-confirm

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

### Addendum (2026-09-29) — claim เกิดเมื่อยืนยันที่หน้า Report-in เท่านั้น

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** กดยืนยันใน ClaimDialog แล้ว**ยังไม่ claim** — ไปหน้า review (อ่านจาก Mongo, ไม่เขียนอะไร) ก่อน · claim (Mongo `claimed` + Couch birth) และ Report-in (`pre_registered` → `arriving`) เกิดตอนกดยืนยันในหน้า review เท่านั้น
> - **ทำไม:** ตอนนี้ claim เกิดทันทีที่กดใน modal → คน/สัตว์ขึ้นว่าอยู่ศูนย์นั้นแล้ว ทั้งที่ staff ยังไม่ได้ตรวจรายละเอียด
> - **Dev ต้อง build:** staff review endpoint + photo read endpoint (FastAPI + BFF) · หน้า review ใหม่ · ClaimDialog เปลี่ยนเป็นเลือกอย่างเดียว
> - **Schema:** ไม่มี schema_v bump (Couch/Mongo shape เดิม) · เพิ่ม API 2 เส้น (volatile)

**Bug ที่พบ:** `claim-dialog.svelte` เรียก claim API ทันทีที่กด "ยืนยันรับเข้าศูนย์" → Mongo row เป็น `claimed` +
Couch birth (`pre_registered`) + สัตว์ถูก append เข้า `household.pets[]` ก่อนเปิดหน้า Report-in. สัตว์ไม่มี gate
ถัดไปเลย จึงขึ้นว่าอยู่ในศูนย์ทันที; ส่วนคน Report-in เดิมโหลดจาก Couch จึงต้อง claim ก่อนเสมอ

**Flow ใหม่:**

```
ClaimDialog (ติ๊กคน/สัตว์) ──► หน้า review /onsite/unassigned/{id}/report-in?members=…&pets=…
                                (อ่าน Mongo ผ่าน review endpoint — ไม่เขียนอะไร, row ยัง open)
                                        │ กด "ยืนยันรายงานตัว"
                                        ▼
                     claim API (Mongo → claimed + Couch birth, pets → household.pets[])
                                        ▼
                     family report-in (pre_registered → arriving) → toast "รับเข้าศูนย์สำเร็จ"
```

**ข้อมูลที่หน้า review ใช้** (ตรวจแล้ว 2026-09-29): Mongo `UnassignedMember` / `UnassignedHousehold` มีครบทุก
field ที่ `UnifiedRegistrationForm` เติมค่าจากข้อมูลเดิม · field ที่ Mongo ไม่มี (`medical_*`, `vehicles`, `assets`,
`zone`) ฟอร์มเริ่มค่าว่างอยู่แล้ว · รูป (`photo`, pet `image_url`) เป็น `gfs:{oid}` ต้องมี endpoint อ่าน (FR-PUF-09)

## Requirements

- FR-PUF-01 — หลัง claim จนไม่มี `open` เอกสารยังอยู่และ `status=closed`
- FR-PUF-02 — join ใบ `closed` ได้ → append + reopen เป็น `open`
- FR-PUF-03 — สัตว์มี `pet_id` + `status` + claim meta; ของเก่าไม่มี field → ถือ `open`
- FR-PUF-04 — claim รับ `pet_ids`; ติ๊กเฉพาะ open คน/สัตว์; append pets ที่ติ๊กเข้า Couch HH
- FR-PUF-05 — ชิป `is_in_shelter` บนคิวกลาง = แนะนำศูนย์; ไม่ soft-join
- FR-PUF-06 — เขียนใหม่ stamp `schema_v: 3`
- FR-PUF-07 — ClaimDialog **ห้าม** เรียก claim API · ปุ่มยืนยันเปลี่ยนเป็น "ตรวจสอบรายละเอียด →" แล้ว navigate ไปหน้า review พร้อม `member_ids` / `pet_ids` ที่ติ๊ก (query string) · ต้องติ๊กอย่างน้อย 1 รายการ
- FR-PUF-08 — FastAPI เพิ่ม `GET /staff/v1/unassigned-registrations/{id}/review` guard `require_registration_staff` (สิทธิ์เดียวกับ claim) · คืน `household` (housing_type, residence_landmark, address_no…postal_code, label), `reserved_household_id`, `registered_via`, `created_at`, **เฉพาะ** members/pets ที่ `open` (field ตาม `OpenMemberHit` / `OpenPetHit`) · id ไม่มี → 404 · endpoint `GET /{id}` เดิมคง `require_system_admin` ไม่แตะ
- FR-PUF-09 — FastAPI เพิ่ม `GET /staff/v1/unassigned-registrations/photos/{photo_id}` guard `require_registration_staff` · stream bytes จาก GridFS พร้อม `Content-Type` ที่เก็บไว้ · คืนเฉพาะ `photo_id` ที่ถูกอ้างอิงโดย member `photo` หรือ pet `image_url` ของ registration ที่ยังมีอยู่ (ไม่อ้างอิง → 404) · header `Cache-Control: private, no-store`
- FR-PUF-10 — SvelteKit BFF เพิ่ม `GET /api/staff/v1/unassigned-registrations/[id]/review` และ `GET /api/staff/v1/unassigned-registrations/photos/[photoId]` ส่งต่อ staff cookie แบบเดียวกับ `…/search` และ `…/[id]/claim` · UI เรียกผ่าน BFF เท่านั้น
- FR-PUF-11 — หน้า review `/onsite/unassigned/[id]/report-in` (guard `requireAuth`) · โหลด review data แล้วเติม `UnifiedRegistrationForm` ด้วยเฉพาะคน/สัตว์ที่อยู่ใน query และยัง `open` · แสดงรูปผ่าน FR-PUF-10 · ออกจากหน้าโดยไม่กดยืนยัน = ไม่มีการเขียน Mongo/Couch และ row ยังคง `open`
- FR-PUF-12 — ถ้า `reserved_household_id` มี household ใน Couch ศูนย์นี้แล้ว (claim รอบก่อน) หน้า review ต้องเติมส่วน household จาก Couch HH นั้น และรวม `pets[]` เดิมกับสัตว์ที่เลือก — **ห้าม** ให้ report-in submit เขียนทับจนสัตว์/ข้อมูลเดิมหาย
- FR-PUF-13 — กด "ยืนยันรายงานตัว": (1) เรียก claim ด้วย `member_ids` / `pet_ids` / `shelter_code` (2) เรียก family report-in ด้วยข้อมูลที่แก้ในฟอร์มสำหรับ evacuee ที่ birth แล้ว (`pre_registered` → `arriving`) (3) toast "รับเข้าศูนย์สำเร็จ" หลังผ่านทั้ง (1) และ (2) เท่านั้น
- FR-PUF-14 — claim ล้มเหลว → ไม่มีอะไรถูกเขียน, toast error, อยู่หน้าเดิม · ถ้ารายการไม่ `open` แล้ว (ศูนย์อื่น claim ไปก่อน) → แจ้งข้อความแล้ว reload review data
- FR-PUF-15 — claim สำเร็จแต่ report-in ล้มเหลว → อยู่หน้าเดิม เก็บค่าฟอร์มไว้ แสดง `RegistrationSaveErrorAlert` + ปุ่มลองใหม่ที่รันเฉพาะขั้น (2) (ไม่ claim ซ้ำ) · staff ยังแก้ต่อได้ที่ `/onsite/people/{id}/report-in` เดิม (row อยู่ที่ `pre_registered`)
- FR-PUF-16 — claim เฉพาะสัตว์ (ไม่มี `member_ids`) ใช้หน้า review เดียวกัน แสดงเฉพาะส่วนสัตว์เลี้ยง · กดยืนยัน = claim อย่างเดียว (สัตว์ไม่มี stay status จึงไม่มีขั้น report-in) · toast หลัง claim สำเร็จ
- FR-PUF-17 — copy: ClaimDialog title "เลือกรายการจากคิวกลาง" และปุ่มตาม FR-PUF-07 · คำว่า "รับเข้าศูนย์" ใช้หลังยืนยันในหน้า review เท่านั้น · `CLAIM_FLOW_STATUS_GUIDANCE` อธิบาย flow ใหม่

## Acceptance

- [ ] AC-01: full claim → Mongo doc คงอยู่, `status=closed`, `deleted=false`
- [ ] AC-02: join หลัง closed → สมาชิกใหม่ `open`, เอกสาร `open`
- [ ] AC-03: claim คน+สัตว์ / สัตว์อย่างเดียว (หลังมี HH) / สองศูนย์คนละรอบ ผ่าน
- [ ] AC-04: ClaimDialog โชว์ติ๊ก open pets + ส่ง `pet_ids`
- [ ] AC-05: public chip มีครอบครัวในศูนย์แล้ว = copy แนะนำ; ไม่สัญญา「เข้าร่วมศูนย์แล้ว」
- [ ] AC-06: อ่าน schema_v ≤2 pets ได้โดยไม่ throw
- [ ] AC-07: ติ๊กคน/สัตว์ใน ClaimDialog แล้วกด → ไปหน้า review; Mongo rows ยัง `open`, ไม่มี evacuee/household ใหม่ใน Couch
- [ ] AC-08: ออกจากหน้า review โดยไม่ยืนยัน → rows ยัง `open` และยังค้นเจอใน Station 1 search
- [ ] AC-09: หน้า review เติมข้อมูลคน + ที่อยู่ครัวเรือนจาก Mongo ครบ และแสดงรูปคน/สัตว์ได้
- [ ] AC-10: กดยืนยัน → rows `claimed`, evacuee ใน Couch เป็น `arriving`, สัตว์อยู่ใน `household.pets[]`, toast "รับเข้าศูนย์สำเร็จ"
- [ ] AC-11: claim รอบสองเข้า household เดิม → `pets[]` และข้อมูล household เดิมไม่หาย
- [ ] AC-12: ระหว่างเปิดหน้า review ศูนย์อื่น claim รายการเดียวกันไปก่อน → กดยืนยันแล้วได้ข้อความแจ้ง ไม่มีการเขียนซ้ำ
- [ ] AC-13: จำลอง report-in ล้มหลัง claim สำเร็จ → ฟอร์มยังอยู่, กดลองใหม่แล้วไม่เรียก claim ซ้ำ
- [ ] AC-14: claim เฉพาะสัตว์ → หน้า review มีแต่ส่วนสัตว์; ยืนยันแล้วสัตว์เข้า `household.pets[]`
- [ ] AC-15: review / photo endpoint: ไม่มี session → 401; role ไม่มีสิทธิ์ registration → 403; photo_id ที่ไม่ถูกอ้างอิง → 404
- [ ] AC-16: ClaimDialog ไม่มีคำว่า "รับเข้าศูนย์ … สำเร็จ" ก่อนยืนยันในหน้า review

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
- `docs/data/api-contract.md` — staff review + photo read endpoints
- `backend/apiapp/modules/unassigned_registrations/{use_case,schemas,couch_birth,router}.py` — review + photo read endpoints
- `backend/apiapp/infrastructure/gridfs.py` — read helper
- `backend/tests/test_unassigned_registration_*.py`
- `frontend/.../unassigned-registration/` — ClaimDialog (select only), review data/remote + Zod schema, mapping Mongo → `UnifiedRegistrationInput`, copy
- `frontend/src/routes/api/staff/v1/unassigned-registrations/[id]/review/+server.ts`, `…/photos/[photoId]/+server.ts`
- `frontend/src/routes/(protected)/onsite/unassigned/[id]/report-in/` — review page (claim → family report-in)
- `frontend/.../people/` — reuse `UnifiedRegistrationForm` + `useSubmitFamilyReportIn` via barrel
- `frontend/src/lib/api/openapi.d.ts` + `fastapi.json` — regenerate
- `frontend/.../public-register/residence-match.server.ts` + unified registration chip copy
- optional: household-profile merge-suggest banner

## Migration

- Additive pet fields + document `closed` status
- ไม่ backfill batch; reader default pet `status=open` เมื่อขาด field; writer ใหม่ stamp `schema_v: 3` และ mint `pet_id` ตอนสร้าง/join
- แถว `count>1` เดิม: claim ทั้งแถวเป็นหน่วยเดียวใน v1
- Addendum claim-on-confirm: ไม่เปลี่ยน shape ของ doc ที่ persist (ไม่ bump `schema_v`) — เปลี่ยนเฉพาะจังหวะที่เรียก claim + เพิ่ม endpoint อ่าน

## Decision log

- 2026-09-29 — proposed (draft; รอ owner อนุมัติเลข CR + ช่องทาง track) · แทน soft-join เป็นแกน · ไม่ hard-delete · reopen on join
- 2026-09-29 — addendum เพิ่มเข้า draft เดิมตามที่เจ้าของโครงการเลือก (claim≠arrived gate จากบั๊กที่พบ: claim แล้วสัตว์ขึ้นว่าอยู่ในศูนย์ทันทีทั้งที่ยังไม่ได้ยืนยัน)
- 2026-09-29 — FR-PUF-11 ตัดสิน: pets-only claim → ยืนยันผ่านปุ่มแยกที่ household profile (ตัวเลือก ก) ไม่บังคับ `member_ids` คู่กับ `pet_ids` (ตัดตัวเลือก ข)
- 2026-09-29 — **แทนที่ addendum เดิม:** owner ต้องการให้ claim เกิดเมื่อยืนยันที่หน้า Report-in เท่านั้น (ทั้งคนและสัตว์) → ตัด `pending_pets[]` / household schema_v 5→6 / ปุ่มยืนยันสัตว์ที่ household profile ทิ้ง · ใช้หน้า review อ่านจาก Mongo แทน
- 2026-09-29 — ตรวจ Mongo fields แล้วพอสำหรับฟอร์ม · review endpoint ใช้ route ใหม่ `GET /{id}/review` + `require_registration_staff` (ไม่ผ่อน guard ของ `GET /{id}` เดิม) · ทำ photo read endpoint ในรอบนี้
- 2026-09-29 — approved, รันเลข **CR-140**; implementation plan: `/home/jakee/.claude/plans/flickering-wiggling-firefly.md`
