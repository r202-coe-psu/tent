---
id: draft
title: Residence-based household join on all create paths
status: proposed
date: 2026-09-17
requested_by: ทีม / field study
decided_by: project owner
layer: volatile
affects:
  - docs/changes/CR-106-decoupled-registration-medical-screening-flow.md (FR-03b-H suggest semantics — amend)
  - docs/adr/0001-decoupled-registration-and-medical-screening-flow.md (suggest + confirm join on create)
  - frontend/src/lib/features/people/domain (UnifiedRegistrationInput join fields; planFamilyRegistration join mode; homeless residence match)
  - frontend/src/lib/features/people/data/people.remote.ts (createFamilyRegistration join path)
  - frontend/src/lib/features/people/ui/registration (UnifiedRegistrationForm residence suggest + join confirm)
  - frontend/src/lib/features/people/ui/household-flows/household-pre-register.svelte (address-step join)
  - frontend/src/routes/api/public/v1/households/residence-match (BFF match; signed token; no PII)
  - frontend/src/lib/features/public-register (executePublicFamilyRegistration join; unassigned append)
  - backend unassigned registrations (append members into existing reserved household)
why: >
  เมื่อที่อยู่ Residence ตรงกับครอบครัวที่มีอยู่แล้ว ผู้ใช้ควรยืนยัน「เข้าร่วม」ได้บนทุก create path
  โดยฝั่งประชาชนไม่เห็น PII ของสมาชิกเดิม และยังคงสร้างใหม่ได้เสมอ (ที่อยู่เดียวกัน ≠ หน่วยเดียวกัน)
migration: N/A (additive write path; ไม่ bump schema_v)
---

# Draft: Residence-based household join on all create paths

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ทุก **create path** ของ registration รองรับ **join household เดิม** เมื่อ Residence ตรงกัน — suggest + ยืนยันเข้าร่วม (ไม่บังคับ) · public ได้แค่ non-PII chips + signed `match_token`
> - **เพื่อใคร/ทำไม:** ลดครัวเรือนซ้ำจากที่อยู่เดียวกันโดยไม่บังคับ join และไม่เปิดเผยรายชื่อสมาชิกเดิมให้ประชาชน
> - **Dev ต้อง build:** domain join mode · staff `createFamilyRegistration` join · public residence-match BFF · unassigned append · UI banner เข้าร่วม/สร้างใหม่
> - **กระทบ schema:** ไม่ bump `schema_v` — ใช้ `household_id` / `reserved_household_id` เดิม

---

## 1. Why

1. **ที่อยู่ซ้ำบ่อยในสนาม:** ครอบครัวเดียวกันมักลงทะเบียนแยกคน/แยกครั้ง ทำให้เกิด Household ซ้ำที่ต้องรวมทีหลังด้วยมือ
2. **Privacy ฝั่งประชาชน:** public ต้องรู้แค่ว่า「มีครอบครัวที่อยู่นี้แล้ว」— **ห้าม** ส่งชื่อ / เบอร์ / รายชื่อสมาชิก / จำนวนคน
3. **CR-106 / ADR-0001 ยังไม่บังคับ join:** ที่อยู่เดียวกัน ≠ หน่วยเดียวกันเสมอ — create ยังเป็นทางเลือกเสมอ; รอบนี้ขยายจาก「suggest ไม่บล็อก」เป็น「suggest + ยืนยัน join บน create」โดยไม่บังคับ

---

## 2. Amend CR-106 / ADR-0001 suggest semantics

| หัวข้อ | ก่อน (CR-106 FR-03b-H / ADR-0001) | หลัง (draft นี้) |
| :--- | :--- | :--- |
| Residence suggest บน create | แสดงรายการแนะนำ; เข้าร่วมได้หรือสร้างใหม่ได้เสมอ | เหมือนเดิม + **ยืนยัน join** เขียนสมาชิกใหม่เข้า HH เป้าหมายทันทีบน create path |
| Public create | (ยังไม่มี join-by-residence บน BFF) | Match API คืน `match_token` + non-PII chips เท่านั้น |
| Staff create | Suggest จากรายการ HH ในศูนย์; join แยกค้นชื่อ/เบอร์ | Suggest ที่อยู่บนฟอร์ม create (onsite / back-office) + `join_household_id` |
| บังคับ join เมื่อที่อยู่ตรง | **ปฏิเสธ** (คงเดิม) | **ปฏิเสธ** (คงเดิม) — create ยังเลือกได้เสมอ |

**ไม่เปลี่ยน:** ปุ่ม「เข้าร่วม」ค้น Evacuee ด้วยชื่อ/เบอร์ (staff); leave/head atomic; Residence อยู่บน Household เท่านั้น

---

## 3. Business rules

### 3.1 Match key

Reuse `matchesResidenceAddress` (`address_no` + ตำบล/อำเภอ/จังหวัด + `village_no` เมื่อมีบน query).

**Homeless:** เมื่อไม่มีบ้านเลขที่ จับคู่ด้วย `residence_landmark` (norm) + จังหวัด/อำเภอ/ตำบล

### 3.2 Join write

- สร้างเฉพาะ **evacuee ใหม่** ผูก `household_id` เดิม
- **ไม่เปลี่ยน** `head_evacuee_id` / Residence ของ HH เป้าหมาย
- pets / vehicles / assets จากฟอร์มผู้เข้าร่วม (ถ้ามี) → **append** เข้า HH เดิม (เจ้าหน้าที่แก้ทีหลังได้)
- Multi-match: คืนหลาย chip ให้เลือกหนึ่ง token/id หรือ「สร้างใหม่」

### 3.3 Privacy (public)

Match response อนุญาตเฉพาะ:

- `match_token` (HMAC/signed, short-lived; ถอดเป็น shelter+household_id หรือ unassigned doc id)
- `residence_landmark?`, `housing_type?` (non-PII chips)

**ห้าม:** ชื่อ, เบอร์, รายชื่อสมาชิก, จำนวนคน, `household_id` ดิบใน response ฝั่ง client

### 3.4 Scope create paths

| Path | Join mechanism |
| :--- | :--- |
| Public `/pre-register` (shelter) | `join_match_token` → Couch HH |
| Public `/pre-register` (unassigned) | `join_match_token` → append Mongo reserved HH |
| Onsite `/onsite/people/new` | `join_household_id` (client มี HH list) |
| Back-office `/back-office/households/pre-register` | join ที่ขั้นที่อยู่ |

**Out of scope รอบนี้:** kiosk (`household_id: null`); report-in Pull (มีแล้ว); ThaiD auth (เตรียม residence join ไว้ในโดเมน; ไม่ implement auth)

### 3.5 Staff adjust หลังรวม

ไม่สร้าง UI dedupe ใหม่ — ใช้โปรไฟล์ household/evacuee, ยกเลิก stay, Pull report-in ที่มีอยู่แล้ว

---

## 4. Acceptance (proposed)

- [ ] Domain: `planFamilyRegistration` โหมด create vs join; homeless match; multi-match
- [ ] Public match API ไม่รั่ว PII; token หมดอายุ/ปลอม → 4xx
- [ ] Create-with-token ผูก HH เดิม; ไม่ overwrite Residence/head
- [ ] Unassigned: append members เข้า `reserved_household_id` เดิม
- [ ] Staff: `createFamilyRegistration` join + compensation เมื่อ fail
- [ ] UI: banner เข้าร่วมไม่เรนเดอร์รายชื่อสมาชิกเมื่อ `channel === 'public'`
- [ ] Create ยังเลือกได้เมื่อมี match

---

## 5. Notes / history

- 2026-09-17 — proposed as `draft-residence-join-on-create` (ยังไม่รันเลข CR)
