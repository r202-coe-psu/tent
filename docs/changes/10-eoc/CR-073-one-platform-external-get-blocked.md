---
id: CR-073
title: ONE PLATFORM + external GET payload — blocked รอ SPEC หน่วยงาน
status: approved
date: 2026-08-13
updated: 2026-08-31
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ
layer: volatile
parent: CR-066
affects:
  - docs/data/api-contract.md (หลังมี SPEC ภายนอก)
  - docs/task-breakdown/10-eoc.md (T-75, T-39)
  - K-14 Open API contract owner
  - backend /external/v1 (CR-062) — คงสัญญาปัจจุบันจนกว่า SPEC เข้า
---

# CR-073 — ONE PLATFORM / external GET (blocked stub)

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** จอดงานเชื่อม ONE PLATFORM และชุด field ที่หน่วยงานต้องการจาก GET
- **เพื่อใคร/ทำไม:** มีช่องทางรับ SPEC โดยไม่ให้ทีมสมมติสัญญา
- **dev ต้อง build อะไร:** **ห้ามสร้าง endpoint/field ใหม่จาก CR นี้**
- **กระทบ schema/scope ไหน:** ไม่มีจนกว่า SPEC เข้าแล้ว amend

## Why

K-14 ยังเปิด — owner ฝั่ง Open API = PM/SA + ศูนย์คอม; implement รอ P-03 contract/sign-off. Owner ยืนยัน **รอเขาส่ง SPEC**. `/external/v1` + API keys (CR-062) มีแล้วเป็น GET mirror ของชั้น public — **ไม่ใช่** สัญญา ONE PLATFORM.

## Change

### Before → After

| Before | After |
| --- | --- |
| ไม่มี CR จอดงานนี้ | CR-073 + T-75 = blocked placeholder |
| `/external/v1` GET mirror (CR-062) | **คงเดิม** — ห้าม breaking change เพื่อ «เดา» ONE PLATFORM |
| T-39 Open API aggregate | คง deferred; T-75 เป็นงานตาม SPEC เขาเมื่อมา ไม่แทนที่ T-39 จนกว่าจะเทียบสัญญา |

เมื่อ SPEC เข้า: **amend CR นี้** (หรือเปิด CR ลูก) ใส่ field/path/auth จริง แล้วค่อยเปลี่ยนสถานะ T-75 เป็น ready.

> [NEEDS DECISION: D-ONE-PLATFORM] รอไฟล์ SPEC จากหน่วยงาน — ห้ามเดา resource, paging, PII, rate-limit เพิ่มจาก CR-062

## Requirements

- **FR-76** — blocked
- ของที่ทำได้โดยไม่เดา: เอกสารชี้ `/external/v1` ปัจจุบัน + วิธีออก API key (CR-062) ให้หน่วยงานทดลองอ่านข้อมูล public-plane ที่มีอยู่

### Acceptance (T-75)

ยังไม่มี. หลัง SPEC: OpenAPI ตรงสัญญา, test auth, ไม่มี PII นอกอนุญาต, demo กับ client หน่วยงาน 1 ราย.

## Impact

ไม่มีโค้ดในรอบนี้. Lead เป็นเจ้าของเมื่อ unblock.

## Migration

N/A.

## Out of scope

- สมมติ payload / path / versioning ของ ONE PLATFORM
- EOC human dashboard
- Inbound POST คน (CR-071 T-73 — คนละ stub)

## Decision log

- 2026-08-13 — proposed stub. **blocked** จนกว่า SPEC ภายนอกเข้า. K-14 คงเปิด.
- 2026-08-13 — Wave 1 ล็อกใน CR-066 (D-TRACK-METHOD=CR+Notion). ห้ามสมมติ payload ONE PLATFORM.
- 2026-08-13 — เจ้าของโครงการ (IMPS) **ไม่ approve** CR นี้. D-ONE-PLATFORM / K-14 = Wave 4 **จอดรอบ CR ถัดไป**. คง `proposed`. **ห้ามเปลี่ยน** CR-062 GET mirror.
