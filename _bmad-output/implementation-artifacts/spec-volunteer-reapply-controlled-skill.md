---
title: 'Volunteer re-application with controlled-skill preservation'
type: 'feature'
created: '2026-09-09'
status: 'done'
review_loop_iteration: 0
baseline_commit: '5d10e2b30e6cff19a5299b74985750c0b8f95bc6'
context:
  - '/home/saktanuthpeak/tent/_bmad-output/specs/spec-volunteer-reapply-controlled-skill/SPEC.md'
  - '/home/saktanuthpeak/tent/_bmad-output/specs/spec-volunteer-reapply-controlled-skill/data-contract.md'
  - '/home/saktanuthpeak/tent/_bmad-output/specs/spec-volunteer-reapply-controlled-skill/confirmation-modal-flow.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** การสมัครงานซ้ำจาก backend buffer สร้าง volunteer profile ใหม่ทุกครั้ง ขณะที่ flow ตรงจาก frontend และ worker ยังไม่มีกติกาเดียวกัน จึงเสี่ยง duplicate identity และทำให้ verification เดิมถูกเขียนทับ

**Approach:** ใช้ phone ที่ normalize แล้วภายใน shelter เป็น candidate key, resolve/reuse profile เดิมแบบไม่ merge เมื่อ ambiguous, union skills และ verification โดยห้าม downgrade ผลเดิม, สร้าง job application ใหม่ทุกครั้ง และเพิ่ม read-only preflight กับ confirmation ก่อน public write

## Boundaries & Constraints

**Always:** identity verification, controlled-skill verification และ job-fit เป็นคนละ state; duplicate ป้องกันด้วย volunteer/job/shift และ active status; controlled skill ใหม่เป็น pending และไม่ reserve slot; preflight ไม่ใช่ authorization และ final submit ต้อง resolve ซ้ำ; migration ต้องมี dry-run, report, quarantine และ idempotency

**Ask First:** ไม่รวม profile ข้าม shelter; conflict ของ national ID หรือ identity ที่ขัดแย้งกันต้อง manual review; assignment ที่ check-in แล้วให้รายงาน conflict แทนการ relink อัตโนมัติ

**Never:** สร้าง `volunteer_id` ใหม่แบบ unconditional เมื่อ match ได้ชัดเจน, reset verified identity/skill, แสดง national ID/token ใน preflight, ลบ duplicate ทันที, หรือ auto-approve งานเพียงเพราะ skill ผ่าน

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| New applicant | no matching phone hash | one profile and one new application | normal policy |
| Repeat applicant | one profile in shelter | reuse volunteer ID, union skills, new application | duplicate active same job/shift rejected |
| New controlled skill | skill has no verified evidence | profile skill added as pending; application `pending_review` with `skill_certification` | no slot reservation |
| Verified preservation | existing verified identity/skill | existing verified records and credentials remain unchanged | rejected is never auto-promoted |
| Ambiguous phone | multiple candidates with conflict | no auto-merge and no confirmation action | manual-resolution response |
| Preflight cancel | matched profile, modal open | zero database/slot mutations | keep form data |

</frozen-after-approval>

## Code Map

- `backend/apiapp/modules/volunteers/identity.py` -- normalized phone lookup, candidate classification and profile merge rules
- `backend/apiapp/modules/volunteers/use_case.py` -- buffer apply, duplicate application guard, profile reuse and preflight
- `packages/tent-model/src/tent_model/volunteer_application_buffer.py` -- resolved identity/preflight-compatible buffer contract
- `worker/src/worker/inbound/volunteer_applications.py` -- CouchDB-side re-resolution and idempotent profile/application persistence
- `frontend/src/lib/features/volunteers/server/public-application.ts` -- direct CouchDB path, preflight and safe profile merge
- `frontend/src/routes/api/public/v1/volunteer/apply/+server.ts` -- preflight/final-submit HTTP boundary
- `frontend/src/lib/features/volunteers/components/QuickApplyModal.svelte` -- confirmation modal and final submit state
- `frontend/scripts/migrate-volunteer-reapply.ts` -- duplicate dry-run/write migration and conflict report
- `backend/tests/test_volunteers.py`, `worker/tests/test_volunteer_shift_identity.py`, and frontend tests -- regression coverage

## Tasks & Acceptance

**Execution:**
- [x] Add canonical identity resolution and merge helpers; use them in FastAPI and worker paths so clear matches reuse one profile and ambiguous matches stop safely.
- [x] Preserve identity/skill verification records, mark new controlled skills pending, and create a fresh application with only the intended review reasons.
- [x] Add preflight response and server re-check, then implement matched-one confirmation, cancel/no-write, and ambiguous-match UI states.
- [x] Add duplicate application protection for active/pending same volunteer/job/shift and keep confirmed/pending slot behavior unchanged.
- [x] Add migration dry-run/write/idempotency with canonical selection, relinking, quarantine metadata, and masked conflict reports.
- [x] Add deterministic fixtures and tests for new, repeat, controlled-skill, verified-reuse, ambiguous, duplicate, preflight, and migration scenarios.

**Acceptance Criteria:**
- [x] Given a clear phone match in one shelter, when either public apply path is submitted, then the new application references the existing volunteer ID and existing applications/assignments remain unchanged.
- [x] Given a new controlled skill without verified evidence, when the application is persisted, then the skill is pending, the application includes `skill_certification`, and no slot/assignment is created automatically.
- [x] Given verified identity or skill evidence, when the volunteer re-applies, then the evidence and verified status are retained exactly.
- [x] Given multiple conflicting candidates, when preflight or final submit runs, then no profile is selected and no write occurs.
- [x] Given a matched-one preflight, when the user cancels, then no document, skill, assignment, or slot counter changes.
- [x] Given an active/pending application for the same volunteer, job, and shift, when a duplicate is submitted, then the request is rejected without a second application.
- [x] Given duplicate profiles, when migration runs dry-run, then CouchDB is unchanged; when write mode runs, then canonical relinking and quarantine are idempotent and conflicts are reported without plaintext secrets.

## Verification

**Commands:**
- `pytest -q backend/tests/test_volunteers.py` -- backend apply/preflight/reuse tests pass
- `pytest -q worker/tests/test_volunteer_shift_identity.py` -- worker identity/application projection tests pass
- `pnpm --dir frontend check` -- Svelte/TypeScript checks pass
- `pnpm --dir frontend lint` -- lint passes
- `pnpm --dir frontend test --run` -- frontend regression tests pass
- `git diff --check` -- no whitespace errors

## Suggested Review Order

**Identity resolution and persistence boundary**

- Resolve existing profiles inside the shelter and treat ambiguity as a hard stop.
  [`use_case.py:307`](../../backend/apiapp/modules/volunteers/use_case.py#L307)

- Re-check identity at worker write time before merging verification-safe profile data.
  [`volunteer_applications.py:255`](../../worker/src/worker/inbound/volunteer_applications.py#L255)

- Share normalization and merge invariants across backend and worker implementations.
  [`volunteer_identity.py:1`](../../packages/tent-model/src/tent_model/volunteer_identity.py#L1)

**Preflight and public write flow**

- Return masked matched-one details while keeping preflight read-only.
  [`public-application.ts:411`](../../frontend/src/lib/features/volunteers/server/public-application.ts#L411)

- Re-resolve the final submission and persist pending controlled-skill evidence safely.
  [`public-application.ts:457`](../../frontend/src/lib/features/volunteers/server/public-application.ts#L457)

- Require explicit confirmation before updating a matched profile and creating its application.
  [`QuickApplyModal.svelte:383`](../../frontend/src/lib/features/volunteers/components/QuickApplyModal.svelte#L383)

**Migration and verification**

- Select a canonical profile conservatively and report conflicts without plaintext secrets.
  [`migrate-volunteer-reapply.ts:120`](../../frontend/scripts/migrate-volunteer-reapply.ts#L120)

- Verify frontend, worker, identity-merge, and formatting regressions with the listed commands.
  [`test_volunteer_identity.py:1`](../../backend/tests/test_volunteer_identity.py#L1)
