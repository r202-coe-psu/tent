---
id: CR-064
title: Edge disaster continuity — network-only LAN cutover + ops status UI (CR-033 follow-up)
status: proposed
date: 2026-08-12
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ (OD lock; CR approve รอ)
layer: stable
parent: CR-033
affects:
  - docs/features/edge-disaster-continuity-idea.md (elevate from parked idea)
  - docs/task-breakdown/00-baseline.md (T-54)
  - docs/task-breakdown/_index.md
  - docs/changes/CR-033-remote-first-architecture-program-index.md (follow-up pointer)
  - docs/data/api-contract.md §1 (reconcile app-aware → network-only; after approve)
  - docs/data/data-model.md §1 §6 §8 (edge appliance + failover wording; after approve)
  - docs/features/offline-fallback-flow-spec.html (reduce app ActiveEndpoint; keep WAN/degraded UX)
  - Notion Projects Tasks (T-54)
  - frontend ops UI (shelter continuity status + WAN indicator) — implement after approve
  - edge appliance / DevOps runbooks — implement after approve
---

# CR-064 — Edge disaster continuity (network-only)

## สรุป (TL;DR)

ปิด follow-up ของ CR-033 (edge failover orchestration): ศูนย์ใช้ **mini PC + router** เป็น warm edge
replica; ตอน WAN/central ล่มตัด traffic ด้วย **network-only** (DNS/router ชี้ domain เดิม);
staff **login ใหม่** ได้; มี **ops UI** ดูสถานะต่อ shelter + WAN ที่ศูนย์; edge image =
staff stack **ยกเว้น FastAPI/Mongo**. ขยาย T-54 เป็น delivery vehicle · deny เดิมของ CR-033 คงอยู่

## Why

- CR-033 Package 8 จบที่ **central-only**; edge orchestration ถูก defer
- ศูนย์เปิด–ปิดตามภัยพิบัติ ต้องทำงานต่อบน LAN โดยไม่พึ่ง PouchDB / local write queue
- Owner ล็อก OD-1..OD-5 (2026-08-12) ใน
  [`docs/features/edge-disaster-continuity-idea.md`](../features/edge-disaster-continuity-idea.md)

## Locked decisions (OD-1..OD-5)

| ID | Decision |
| --- | --- |
| OD-1 | Edge image = CouchDB + nginx `/couch` + staff SPA (Node) — **ไม่รวม** FastAPI + MongoDB |
| OD-2 | Failover = **network-only** (ไม่ทำ app `ActiveEndpoint` probe/switch) |
| OD-3 | Cutover/cutback **ยอมให้ login ใหม่** (ไม่บังคับ cookie continuity) |
| OD-4 | Ops UI: (1) central เห็นสถานะ **ต่อ shelter** (2) ที่ศูนย์ staff เห็นสถานะ **WAN** |
| OD-5 | Track = CR นี้ + ขยาย T-54 + sync Notion |

## Change

### Before → After

| Area | Before (CR-033 / current) | After (this CR) |
| --- | --- | --- |
| Edge runtime | Deferred / unspecified appliance | Warm mini PC: staff stack ยกเว้น public plane |
| Failover | Specs เขียน app-aware active endpoint | **Network-only** cutover บน LAN |
| Session on cutover | Implied keep/failback session | **Re-login** บน edge และบน central หลัง cutback |
| Continuity visibility | ConnectionBanner / retry UX (central path) | + **ops UI** สถานะ shelter + WAN |
| T-54 | Central path done; Edge follow-up open | T-54 ครอบ edge orchestration ตาม DoD ด้านล่าง |
| Public / `/api/v1` | Central-only | คง degraded/unavailable ตอน edge-only |

### Work packages

1. **Spec reconcile (หลัง approve)** — `api-contract.md` §1, `data-model.md` topology/edge wording,
   `offline-fallback-flow-spec.html` ลด app-aware switch; เก็บ degraded/WAN UX
2. **T-54 expand** — DoD + test matrix ตาม §Acceptance (ทำคู่กับ CR นี้)
3. **Infra / replication** — appliance image (OD-1), central→edge warm sync, filtered `_users`,
   edge→central backlog, `_security`/design parity, provision `_replicator` + `edge_url`
4. **Ops UI (OD-4)** — central: per-shelter continuity status; shelter: WAN up/down indicator
5. **Runbook + chaos drill** — 5 phases + WAN cut / write edge / restore / verify central
6. **Notion sync** — อัปเดต T-54 task ให้ตรง CR-064

### Out of scope (คงจาก idea doc)

- สร้าง/แก้ user / เปลี่ยนรหัสบน edge; merge `_users` จากหลาย edge
- PouchDB / local write queue
- Public plane / FastAPI / Mongo บน edge
- เปิดศูนย์ใหม่ตอน WAN ล่ม (mint/provision = central-only)
- App-driven `ActiveEndpoint` failover (ตัดตาม OD-2)

## Impact

- **Stable core:** sync/failover wording ใน api-contract + data-model เปลี่ยนจาก app-aware → network-only
- Planning: T-54 scope ขยาย (effort อาจ recalibrate หลัง approve)
- Frontend: งานใหม่ ops UI; **ไม่** implement C1–C3 app endpoint switch
- DevOps: edge image + LAN DNS cutover runbook เป็นส่วนของ delivery
- CR-033 follow-up ชี้มาที่ CR-064

## Migration

N/A สำหรับ `schema_v` ในรอบนี้ (ยังไม่ bump field ของ persisted docs).
ถ้าภายหลังต้องเก็บ continuity status ใน Couch/registry ให้เปิด amend + bump แยก

## Acceptance / DoD (elevate ready)

1. Staging dry-run: warm sync + network cutover + staff login ใหม่บน edge แล้วเขียน `shelter_*` ได้
2. Failback: edge→central backlog ไม่สร้าง duplicate จาก ULID retry; staff login ใหม่บน central
3. Ops UI: เห็นสถานะต่อ shelter ที่ central + WAN status ที่ศูนย์
4. Public/`/api/v1` แสดง degraded ชัดเจนช่วง edge-only
5. Chaos drill + event runbook 5 เฟสผ่าน

รายละเอียด gap checklist อยู่ใน idea doc §7 (อ้างอิงจาก CR นี้หลัง elevate)

## Decision log

- 2026-08-12 — idea parked + OD-1..OD-5 locked (owner)
- 2026-08-12 — CR-064 proposed; T-54 expanded; Notion sync initiated
- ⬜ Owner approve → แก้ binding `api-contract` / `data-model` / offline-fallback spec
