---
id: CR-033
title: Remote-first architecture pivot (single comprehensive change record)
status: approved
date: 2026-07-07
requested_by: project owner
decided_by: project owner
layer: stable
affects:
  - docs/data/data-model.md §1, §6, §8
  - docs/data/api-contract.md §1, §2, §6
  - docs/task-breakdown/01-core.md (T-02, T-03, T-43)
  - docs/task-breakdown/00-baseline.md (T-54)
  - docs/task-breakdown/_index.md
  - docs/task-breakdown/_timeline.md
  - docs/task-breakdown/glossary.md
  - docs/task-breakdown/10-eoc.md
  - docs/task-breakdown/teamplanning.md
  - docs/features/offline-fallback-flow-spec.html
  - docs/prd/index.md
  - docs/prd/roadmap.md
  - docs/prd/kickoff.md
  - docs/prd/phase-r2-foundation.md
  - frontend/CONTRIBUTING.md
  - frontend/CONVENTIONS.md
  - frontend/.agents/skills/couchdb-bestpractices/SKILL.md
  - frontend/.agents/skills/pr-code-review/SKILL.md
  - Notion Projects Tasks (T-02, T-54 scope realign — owner sync 2026-07-15)
---

# CR-033 — Remote-first Architecture Pivot (Single Comprehensive CR)

## TL;DR
ยกเลิกสมมติฐาน local-first (ตัด PouchDB ออกจาก client write path) และปรับเป็น remote-first
(main-first + edge fallback) ภายใต้ **CR เดียว**. เอกสารนี้เป็น master record สำหรับงานทั้งหมดทั้งด้าน
data model, API contract, planning, feature flow, conventions และ governance alignment.

## Why
- สถาปัตยกรรมปัจจุบันผูกกับ local-first/PouchDB ในระดับ stable core (topology, sync boundary,
  auth/session semantics, task DoD หลัก) ทำให้เปลี่ยนทีเดียวมีความเสี่ยงสูง.
- ต้องการ single source ของ decision เพื่ออนุมัติและ trace ได้จาก record เดียว.
- ลด overhead ในการบริหารหลาย CR และลดความเสี่ยง cross-reference ไม่ตรงกันระหว่างหลายไฟล์ CR.

## Change
### Scope
- เปลี่ยน from: local-first (`app -> local PouchDB -> sync`) + local-only mode
- เปลี่ยน to: remote-first (`app -> BFF/service -> CouchDB`) โดยคุย main เป็นหลัก และใช้ edge เป็น fallback

### Work packages ภายใน CR เดียว
1. Data model topology rewrite (`docs/data/data-model.md`)
2. API contract rewrite (`docs/data/api-contract.md`)
3. Core task breakdown realignment (`docs/task-breakdown/01-core.md`)
4. Offline/fallback feature spec rewrite (`docs/features/offline-fallback-flow-spec.html`)
5. PRD/roadmap wording alignment (`docs/prd/*.md` ที่อ้าง local-first)
6. Technical conventions alignment (`frontend/CONTRIBUTING.md`, `frontend/CONVENTIONS.md`, docs skills sources)
7. Legacy CR supersession map and terminology cleanup (`docs/changes/_index.md` + superseded links)

## Progress status (2026-07-15)
- ✅ Done — Package 1: `docs/data/data-model.md` ปรับเป็น remote-first + active endpoint
- ✅ Done — Package 2: `docs/data/api-contract.md` ปรับ sync/service/public plane ให้ตรงกับ active endpoint policy
- ✅ Done — Package 3: `docs/task-breakdown/01-core.md` ปรับ T-02/T-03 ให้ตัด local-first baseline
- ✅ Done — Package 4: `docs/features/offline-fallback-flow-spec.html` ปรับ state machine เป็น send/fail/retry ตาม endpoint
- ✅ Done — Package 5: PRD wording alignment (`docs/prd/index.md`, `roadmap.md`, `kickoff.md`, `phase-r2-foundation.md`) รวม locked decisions (disconnected A, live-update B, retry policy)
- ✅ Done — Package 6 (ส่วน frontend docs): `frontend/CONTRIBUTING.md` และ `frontend/CONVENTIONS.md` align กับ remote-first + canonical app-level event channel + retry UX policy
- ✅ Done — Skill alignment: rename `couchdb-pouchdb-bestpractices` -> `couchdb-bestpractices` และอัปเดต skill references ที่เกี่ยวข้อง รวม review checklist ให้ enforce locked decisions
- ✅ Done — Package 7 (propagation status): locked decisions propagated across data/api/task/flow/PRD/frontend docs and skills listed in `affects`
- ✅ Done — Package 8: frontend implementation — central-only remote path (`couch-db.ts`, `*.remote.ts`, event channel, ConnectionBanner)
- ✅ Done — Package 9 (2026-07-15): task-breakdown baseline/index/glossary/timeline/T-54 realign (deny PouchDB); Notion T-54/T-02 synced via `ntn` (`docs/changes/CR-033-notion-sync-checklist.md`)
- ⬜ Follow-up — edge failover orchestration (deferred from Package 8)

## Owner decisions (locked)
- ✅ `disconnected` policy: เลือก **A** = status-only (ไม่อนุญาต read-only local cache)
- ✅ canonical live-update mechanism: เลือก **B** = app-level event channel
- ✅ retry/UX policy: retry อัตโนมัติ 3 รอบ; เกินนั้นถือว่าเชื่อมต่อระบบไม่ได้, แสดง banner ชัดเจน, และ user สามารถ force retry ได้

### Suggested execution sequence (inside this CR)
1. แก้ canonical technical source: data model + API contract
2. แก้ planning/flow docs: task breakdown + offline/fallback spec
3. ปิด alignment/governance: PRD + conventions + supersession map

## Pipeline (Start -> End)
1. Freeze decision และ scope ใน CR-033 (target architecture, non-goals, acceptance criteria ระดับสถาปัตยกรรม)
2. แก้ canonical spec ก่อน: `docs/data/data-model.md` และ `docs/data/api-contract.md`
3. แก้ planning spec ให้สอดคล้อง: `docs/task-breakdown/01-core.md` (โดยเฉพาะ T-02/T-03 DoD และ dependencies)
4. แก้ feature flow spec ที่ผูก local-first: `docs/features/offline-fallback-flow-spec.html`
5. แก้เอกสารกำกับการพัฒนา: `frontend/CONTRIBUTING.md` และ `frontend/CONVENTIONS.md`
6. ปรับ PRD/roadmap wording และทำ supersession map ใน `docs/changes/_index.md`
7. เริ่ม implementation หลัง spec layer เสถียร: data access/repository -> auth/session/failover orchestration -> query/reactivity/UI states
8. Verification และ hardening: test matrix (main down, edge down, failback, session expiry, conflict)
9. ปิด CR-033 เป็น `done` เมื่อ docs + implementation + verification ครบตาม acceptance criteria

## Impact
- เอกสารที่เป็น source-of-truth เชิง topology/sync/auth ต้องเปลี่ยนก่อนเริ่ม implementation.
- CR เดิมจำนวนหนึ่งจะถูก supersede บางส่วน (โดยเฉพาะที่อธิบาย local-first/Pouch workflow) โดยอ้างอิงผ่าน CR-033 เดียว
- ชุดคำศัพท์มาตรฐานต้องเปลี่ยนพร้อมกัน: `local-first`, `local-only`, `active remote`, `Pouch sync`.

## Migration
- N/A (ยังไม่ระบุ schema migration รายเอนทิตีในเอกสารนี้)
- หากมีการแตะ field/rule ใน `schema.md` ระหว่างดำเนินงาน ให้เพิ่ม migration note ใน CR-033 นี้โดยตรง

## Decision log
- 2026-07-07 — proposed (single comprehensive CR drafted)
- 2026-07-07 — approved by owner as single comprehensive CR
- 2026-07-07 — canonical data/api/task/feature-flow/frontend-conventions updated to remote-first direction
- 2026-07-07 — skill set renamed and aligned (`couchdb-bestpractices`); references updated
- 2026-07-07 — PRD wording aligned under CR-033 (`index`, `roadmap`, `kickoff`, `phase-r2-foundation`)
- 2026-07-07 — owner locked architecture decisions: disconnected A, live-update B, retry policy (3 attempts + banner + force retry)
- ✅ Done — Package 8: frontend implementation — central-only remote path (`couch-db.ts`, `*.remote.ts`, event channel, ConnectionBanner)
- 2026-07-15 — owner directed Package 9: finish task-breakdown + Notion track for T-54/T-02 under CR-033
- ✅ Done — Package 9: task-breakdown docs + Notion T-54/T-02 + board comment synced (`ntn` CLI)
- ⬜ Follow-up — edge failover orchestration (deferred from Package 8)
