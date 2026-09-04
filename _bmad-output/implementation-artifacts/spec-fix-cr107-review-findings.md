---
title: 'แก้ข้อค้นพบจาก PR review CR-107 volunteer shift'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: 'e3bf0e43'
review_loop_iteration: 0
context:
  - '{project-root}/docs/changes/CR-107-volunteer-shift-identity-reconciliation.md'
  - '{project-root}/docs/changes/CR-063-public-bff-only.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** PR review CR-107 พบความเสี่ยงจาก legacy public apply endpoint ที่ยังเขียน CouchDB โดยตรงและไม่ผ่าน FastAPI quota reservation แม้ BFF หลักจะมี pipeline ที่ถูกต้องแล้ว นอกจากนี้ยังมี edge case เมื่อ client ส่ง `shift_id` ที่ไม่อยู่ในงาน และ coverage ยังไม่ยืนยัน behavior ของ legacy rows / pending buffers

**Approach:** ให้ endpoint legacy เป็น compatibility adapter ที่ forward เข้า FastAPI contract เดียวกับ BFF หลัก โดยไม่อ่านหรือเขียน CouchDB เอง เพิ่มการปฏิเสธ `shift_id` ที่ไม่ถูกต้อง และเพิ่ม regression tests สำหรับ identity, capacity, roster และ quota reconciliation โดยคง fixes ที่มีอยู่แล้วไว้

## Boundaries & Constraints

**Always:** Public apply ต้องผ่าน BFF → FastAPI → Mongo buffer/counter → worker; `shift_id` ต้องอ้างถึง child shift จริงเมื่อ job มี shifts; legacy assignment ที่ไม่มี `shift_id` ยังต้องอ่านและกัน duplicate ด้วย duty window; pending confirmed buffers ต้องไม่ถูก reconcile หาย; ห้าม expose หรือ scan เอกสาร shelter ที่ไม่เกี่ยวข้อง

**Ask First:** หากพบว่าต้องเปลี่ยนนิยาม quota หรือ status transition นอกเหนือจาก CR-107 ให้หยุดถามเจ้าของงาน

**Never:** ไม่ทำ migration runner production, ไม่ลบข้อมูลเดิม, ไม่ย้อนกลับไปใช้ `_all_docs?include_docs=true` ใน public apply, และไม่สร้าง write path ใหม่ที่ bypass FastAPI

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Legacy apply | old body with `job_id` and selected shift | forward normalized request to FastAPI | upstream error code/status preserved |
| Invalid child shift | job has shifts, request has unknown `shift_id` | no job-level reservation; reject | `422 SHIFT_NOT_FOUND` |
| Pending reservation | confirmed unsynced buffer plus assignment reconciliation | counter retains buffer reservation | no overwrite to zero |
| Broken shift window | valid assignment has matching `shift_id` but malformed shift times | assignment remains visible/countable | legacy window fallback is skipped only |

</frozen-after-approval>

## Code Map

- `frontend/src/routes/api/public/v1/volunteer/apply/+server.ts` -- legacy compatibility adapter; must not access CouchDB directly
- `frontend/src/lib/features/volunteers/components/JobBoard.svelte` -- maps public shift identity into the legacy UI model
- `backend/apiapp/modules/volunteers/use_case.py` -- canonical concrete-shift selection and reservation boundary
- `worker/src/worker/mongo/job.py` -- reconciles projected assignments, applications, and pending buffers
- `frontend/src/lib/features/volunteers/domain/capacity.ts` -- exact shift-level capacity count with legacy fallback
- `frontend/src/lib/features/volunteers/domain/shift-roster.ts` -- roster matching by shift identity/window
- `frontend/src/lib/features/volunteers/data/shift-assignment.remote.ts` -- duplicate assignment guard

## Tasks & Acceptance

**Execution:**
- [x] Replace legacy CouchDB apply implementation with a rate-limited, CAPTCHA-protected FastAPI adapter and update its tests -- remove the direct write/quota bypass.
- [x] Reject an unknown `shift_id` in `_select_concrete_shift` and add backend contract coverage -- prevent silent job-level booking.
- [x] Preserve `shift_id` from public projections through `JobBoard` and sync selected shift date in the portal modal -- keep the request identity canonical.
- [x] Add regression tests for pending buffers, malformed-window identity matching, and legacy duplicate matching -- lock the review fixes to observable behavior.

**Acceptance Criteria:**
- Given a legacy apply request, when the endpoint receives it, then no CouchDB admin/write function is called and FastAPI receives the normalized canonical payload.
- Given a job with concrete shifts and an unknown `shift_id`, when apply is evaluated, then it returns `SHIFT_NOT_FOUND` and does not reserve a job-level slot.
- Given a confirmed unsynced buffer, when shift reconciliation runs, then its volunteer/application identity contributes to `confirmed_qty`.
- Given a malformed shift window with a matching assignment `shift_id`, when capacity or roster is computed, then that assignment remains included.

## Design Notes

The legacy endpoint remains temporarily addressable for compatibility, but it is only an adapter. The canonical source of truth for reservation, status, token, and persistence is the existing FastAPI use case; this avoids maintaining two subtly different application semantics.

## Verification

**Commands:**
- `pnpm --dir frontend check` -- expected: no Svelte/TypeScript errors
- `pnpm --dir frontend test --run` -- expected: frontend unit tests pass
- `uv run pytest backend/tests/test_volunteer_shift_contract.py` -- expected: backend shift contract tests pass
- `uv run pytest worker/tests/test_mongo_job.py` -- expected: pending-buffer reconciliation test passes
