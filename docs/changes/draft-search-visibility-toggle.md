---
id: draft
title: สวิตช์「แสดงในระบบค้นหาญาติ」บนหน้ารายละเอียดผู้เข้าพัก + audit `privacy_change`
status: proposed
date: 2026-10-31
requested_by: owner (สรุป 2026-10-28 บน issue #790)
decided_by:
layer: volatile
affects:
  - docs/data/schema.md §2.12 `audit.action` (+`privacy_change`) · §1.1 `evacuee.consent` / `privacy.search_excluded` (กฎเปลี่ยนค่าหลังลงทะเบียน)
  - docs/features/pdpa-consent-block-spec.md (กฎ basic ⇒ search_excluded; ช่องทางเปลี่ยนค่าหลังลงทะเบียน)
  - docs/task-breakdown/11-famsearch.md T-40 (DoD ข้อ "แก้ภายหลังได้ ... พร้อมประวัติการเปลี่ยน")
  - no schema_v bump (additive enum value; doc เดิมยัง valid)
  - frontend/src/lib/features/shared/domain/audit.ts (`auditActionSchema`)
  - frontend/src/lib/features/people/domain/search-visibility.ts · data/people.remote.ts · application/queries.ts · ui/evacuee-profile/evacuee-profile-privacy-card.svelte
  - frontend/src/lib/features/people/ui/household-form/household-form.svelte (bug fix)
---

# draft-search-visibility-toggle — สวิตช์แสดง/ซ่อนในระบบค้นหาญาติ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เจ้าหน้าที่เปลี่ยน `privacy.search_excluded` ของผู้เข้าพักได้ทุกเวลาจากหน้ารายละเอียด (ตามที่เจ้าตัวขอ) โดยไม่ต้องลงทะเบียนซ้ำ; ทุกครั้งที่เปลี่ยนเขียน `audit` ใหม่ `action: privacy_change`
> - **กฎ consent ที่เปลี่ยน:** doc ที่ `consent.mode = basic` เมื่อสวิตช์เป็น "แสดง" → `consent.mode` เป็น `full` พร้อมกันใน doc เดียว (หลังเจ้าตัวรับทราบข้อความ full notice)
> - **แก้บั๊ก:** ตัวเลือกหัวหน้า/สมาชิกใน household form เลิกกรอง `search_excluded` ออก (การซ่อนมีผลเฉพาะฝั่ง public)
> - **ไม่ bump `schema_v`**, ไม่มี migration

## Why

- T-40 กำหนดว่า opt-out เปลี่ยนใจได้ทุกเมื่อ "โดยเจ้าตัวผ่านเจ้าหน้าที่ พร้อมประวัติการเปลี่ยน" แต่ยังไม่มีหน้าจอเปลี่ยนค่าหลังลงทะเบียน และไม่มีค่า `audit.action` ที่ตรงความหมาย (issue #790)
- VDU (`consent.ts` ฝั่ง validator) บังคับ `consent.mode = basic` ⇒ `privacy.search_excluded = true` จึงเปิดการแสดงของคน `basic` ไม่ได้ถ้าไม่เปลี่ยน mode พร้อมกัน
- household picker กรองคนที่ `search_excluded` ออกจากรายชื่อ ทำให้เจ้าหน้าที่จัดครัวเรือนให้คนที่ถูกซ่อนไม่ได้ ทั้งที่การซ่อนควรมีผลแค่ฝั่ง public

## Change

**1. สวิตช์บนหน้ารายละเอียดผู้เข้าพัก** (`/onsite/people/evacuee-profile-view/[id]`, การ์ด "ความเป็นส่วนตัว")

- เปลี่ยนได้ทุกเวลา; สิทธิ์ = ผู้ที่แก้โปรไฟล์ผู้เข้าพักได้อยู่แล้ว (`canEditProfile`) — **ไม่เพิ่มกฎสิทธิ์ใหม่**
- ไม่มีช่องกรอกเหตุผล; กดสวิตช์ → dialog ยืนยันว่าเจ้าตัวเป็นผู้ขอ
- เขียน evacuee + `audit` ใน `_bulk_docs` request เดียว; ถ้า evacuee ไม่สำเร็จ แสดง error; ถ้าเฉพาะ audit ไม่สำเร็จ เขียน audit ซ้ำอีก 1 ครั้ง และแสดง error ถ้ายังไม่สำเร็จ (ไม่เงียบ); ใช้ `_rev` ที่อ่านมา (ชนกัน = error)
- ค่าเดิมเท่ากับค่าที่ขอ → ไม่เขียนอะไร

**2. `audit.action` เพิ่มค่า `privacy_change`** (schema.md §2.12)

before: `duplicate_override | retro_edit | export | purge | conflict_resolved | manual_adjust | created | other`
after: เพิ่ม `privacy_change`

| field                       | ค่า                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `action`                    | `privacy_change`                                                                                               |
| `target_type` / `target_id` | `evacuee` / `evacuee:{ulid}`                                                                                   |
| `reason`                    | ข้อความคงที่ `เจ้าตัวขอเปลี่ยนการแสดงในระบบค้นหาญาติ` (schema บังคับ `reason`; ไม่มีเหตุผลที่เจ้าหน้าที่พิมพ์) |
| `context.search_excluded`   | `{from: bool, to: bool}` เสมอ                                                                                  |
| `context.consent_mode`      | `{from: 'basic', to: 'full'}` **เฉพาะเมื่อ mode เปลี่ยนในครั้งนั้น**; ไม่มี key นี้ถ้า mode ไม่เปลี่ยน         |
| ใครทำ / เมื่อไร             | `created_by` / `occurred_at` ตาม envelope ปกติ                                                                 |

**3. กฎ consent: เจ้าหน้าที่เปลี่ยน basic → full ผ่านสวิตช์ได้**

เงื่อนไข: evacuee มี `consent.mode = basic` และเจ้าหน้าที่กดสวิตช์เป็น "แสดง"

- dialog แสดงข้อความ full notice (`CONSENT_COPY` ใน `consent-notice.i18n.ts`) ให้เจ้าตัวรับทราบก่อนยืนยัน
- เมื่อยืนยัน เขียนใน evacuee doc เดียว (กฎ VDU จึงผ่าน):

| field                                                                            | ค่าใหม่                                                                     |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `privacy.search_excluded`                                                        | `false`                                                                     |
| `consent.mode`                                                                   | `full`                                                                      |
| `consent.health`                                                                 | `false` (คงเดิม; การให้ข้อมูลสุขภาพไม่เปลี่ยนด้วยทางนี้)                    |
| `consent.notice_version`                                                         | `CONSENT_NOTICE_VERSION` ปัจจุบัน (เจ้าตัวเพิ่งรับทราบ full notice ฉบับนี้) |
| `consent.given_at`                                                               | เวลาที่ยืนยัน                                                               |
| `consent.ref`, `given_by`, `giver_evacuee_id`, `channel`, `recorded_verbally_by` | คงเดิม                                                                      |
| `schema_v`                                                                       | `15` (EVACUEE_SCHEMA_V)                                                     |

- ทิศกลับ (ซ่อน): ไม่แตะ `consent` เลย — คนที่เป็น `full` ยังเป็น `full` แค่ `search_excluded = true`
- doc ที่ไม่มี `consent`: เปลี่ยนเฉพาะ `privacy.search_excluded`
- ลงทะเบียนใหม่ยังเขียน `mode = full` เท่านั้นตาม decision sync 2026-10-27 (ไม่เปลี่ยน)

**4. Household picker** (`household-form.svelte`): ลบ filter `!e.privacy?.search_excluded` ของ `memberItems` และ `headItems` — การซ่อนมีผลเฉพาะ public plane (`public_persons` ถูกลบโดย worker อยู่แล้ว ไม่กระทบ)

**5. T-40 (`docs/task-breakdown/11-famsearch.md`)** — สถานะคง `⬜`→ เจ้าของโครงการตัดสินว่าจะขยับเป็น `🟡`/`✅` เมื่อ PR นี้ merge; DoD ข้อ "แก้ภายหลังได้ (โดยเจ้าตัวผ่านเจ้าหน้าที่) พร้อมประวัติการเปลี่ยน" ถูกตอบด้วย CR นี้ (สวิตช์ + `privacy_change`)

## Edits ที่ตั้งใจจะทำหลัง owner approve (ยังไม่แก้ในไฟล์เหล่านี้)

- `docs/data/schema.md` §2.12 บรรทัด `action`: เพิ่ม `privacy_change` ใน enum + ย่อหน้าอธิบาย context ตามตารางข้อ 2
- `docs/data/schema.md` §1.1 `consent` / `privacy`: เพิ่มกฎ "เจ้าหน้าที่เปลี่ยน `basic` → `full` ผ่านสวิตช์ได้ (field ที่เปลี่ยนตามข้อ 3)" และ decision-sync note + อัปเดต `updated:`
- `docs/data/schema-er-diagram.md`: เพิ่มค่า enum ของ audit
- `docs/features/pdpa-consent-block-spec.md`: เพิ่มช่องทางเปลี่ยนค่าหลังลงทะเบียน + ข้อยกเว้นกฎ basic
- `docs/task-breakdown/11-famsearch.md` T-40: อัปเดตสถานะและอ้าง CR
- `docs/changes/_index.md`: เพิ่มแถว CR เมื่อรันเลข

## Impact

- code: `audit.ts` (enum), `people/domain/search-visibility.ts` (ฟังก์ชัน pure `planSearchVisibilityChange`), `people.remote.ts` `setSearchVisibility`, `queries.ts` `useSetSearchVisibility`, การ์ดความเป็นส่วนตัว + dialog, `household-form.svelte`
- worker: ไม่แก้ projector — `search_excluded` false → true ถูกลบจาก `public_persons` และ true → false ถูกสร้างใหม่ผ่าน path เดิม; ไม่ bump `PROJECTION_VERSION`
- test: unit `search-visibility.test.ts`, remote `people.remote.search-visibility.test.ts`, worker `test_mongo_person.py`, E2E `e2e/search-visibility-toggle.test.ts`
- ข้อจำกัดที่ทราบ: `_bulk_docs` ไม่ atomic — (ก) evacuee สำเร็จแต่ audit ไม่สำเร็จ: เขียน audit ซ้ำ 1 ครั้ง ถ้ายังไม่สำเร็จ UI แจ้ง error ทั้งที่ค่าใหม่มีผลแล้ว; (ข) evacuee ชน `_rev` แต่ audit สำเร็จ: เหลือ audit ของการเปลี่ยนที่ไม่เกิดขึ้น (audit เป็น append-only ลบไม่ได้) — โอกาสต่ำเพราะอ่าน `_rev` ล่าสุดก่อนเขียนทันที

## Migration

N/A — เพิ่มค่า enum อย่างเดียว ไม่มี field ใหม่; doc เดิมอ่านได้; doc ที่ upgrade จาก basic → full stamp `schema_v: 15`

## Decision log

- 2026-10-28 — owner สรุปบน #790 (ข้อ 1–6, ต้องมี CR, ผู้ implement เป็นผู้ร่าง)
- 2026-10-31 — proposed (ร่างโดยผู้ implement, รอ owner approve ก่อนแก้ schema.md / task-breakdown / `_index.md`)
