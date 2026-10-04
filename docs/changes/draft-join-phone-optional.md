---
id: draft
title: Public pre-register join — primary-contact phone optional
status: proposed
date: 2026-09-28
requested_by: public pre-register UX / join household flow
decided_by: project owner
layer: volatile
affects:
  - frontend public pre-register UI (unified registration members / form)
  - frontend BFF POST /api/public/v1/registrations (+ unassigned schema)
  - public booking / unassigned error copy (INVALID_JOIN_TOKEN, JOIN_TARGET_NOT_FOUND)
  - no schema_v bump (evacuee.phone already str|null)
---

# draft-join-phone-optional — join mode phone optional

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เมื่อ public pre-register **เข้าร่วม household** (`join_match_token` /
>   `join_household_id`) เบอร์ผู้ติดต่อหลักในฟอร์มเป็น **optional** — ว่างหรือติก「ไม่มีเบอร์」→
>   เก็บ `null`; กรอกบางส่วนยัง error รูปแบบ
> - **สร้างครัวเรือนใหม่:** ยังบังคับเบอร์ 10 หลัก (ซ่อน「ไม่มีเบอร์」เหมือนเดิม)
> - **ไม่** auto-copy เบอร์ head ของบ้านปลายทาง
> - **ไม่ bump `schema_v`**

---

## Why

ผู้ใช้ที่เลือกเข้าร่วมครอบครัวที่มีผู้ติดต่อหลักอยู่แล้วยังถูกบังคับกรอกเบอร์ `members[0]` ทั้ง
client (`headPhoneRequired`) และ BFF `superRefine` — UX ไม่ตรง product rule ของโหมด join

## Change

| โหมด | เบอร์ผู้ติดต่อหลัก |
| --- | --- |
| สร้างครัวเรือนใหม่ | บังคับ 10 หลัก; ไม่โชว์「ไม่มีเบอร์」 |
| Join | optional; ค่าเริ่มต้นไม่ติก「ไม่มีเบอร์」; ว่าง/ติก → `null` |

- UI: ส่ง `isJoiningExistingHousehold` ให้สมาชิกทุกคนรวม index 0; `hideNoPhone` เฉพาะ public
  create head; helper text อธิบายว่าไม่บังคับเพราะบ้านมีผู้ติดต่อแล้ว
- BFF/domain: ข้าม phone `superRefine` เมื่อมี `join_match_token`; ข้าม phone rate limit เมื่อเบอร์ว่าง;
  duplicate hold ใช้เบอร์เฉพาะเมื่อมีค่า
- Error UX: map `INVALID_JOIN_TOKEN` / `JOIN_TARGET_NOT_FOUND`; `INVALID_INPUT` + details → toast
  ข้อความ field แรก; join fail → ล้าง join selection

## Impact

- `frontend/src/lib/features/people/ui/registration/*`
- `frontend/src/routes/api/public/v1/registrations/+server.ts`
- `frontend/src/lib/features/public-register/domain/{booking,unassigned-registration}.ts`
- `frontend/src/lib/features/public-register/data/public-register.api.ts`
- i18n `public-booking-form.ts`
- unit / BFF tests ที่เกี่ยวกับเบอร์บังคับ vs join

## Migration

N/A — ไม่เปลี่ยน shape ที่ persist; `phone` ยัง `str|null`

## Decision log

- 2026-09-28 — proposed (draft; รอ owner อนุมัติเลข CR + ช่องทาง track)
