---
title: "Task Breakdown — Baseline (FR-1–20)"
status: active
created: 2026-06-11
updated: 2026-08-12
module: baseline
note: >
  decision-synced 2026-07-15 — T-54 realigned to CR-033 remote-first (deny PouchDB / local-first / offline draft queue);
  2026-08-12 — T-54 Package B expanded for CR-064 (network-only edge continuity); planning source = Markdown
---

# Baseline — Registration-first (FR-1–20)

> **Greenfield:** ยังไม่มีระบบ MVP มาก่อน (มีเพียง CouchDB PoC) — baseline scope FR-1–20 (auth, person registration, screening, person QR/movement, dashboard, export, **remote-first continuity + Excel fallback**) ต้อง **build เป็นส่วนแรกของ foundation** ก่อน R2 จะต่อยอด. Spec รายละเอียดอยู่ใน `docs/features/` + [Database Schema](../data/schema.md) + [Data Model](../data/data-model.md). Topology อ้าง [CR-033](../changes/CR-033-remote-first-architecture-program-index.md); edge continuity อ้าง [CR-064](../changes/CR-064-edge-disaster-continuity.md).

- **Team owner:** Team B (People) + Lead pair; ทีมอื่นช่วยตาม slice ที่ dependency แตะ (ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** Foundation (มิ.ย.–ก.ค. ขนาน/ก่อน R2 features)
- **Design input (บริษัท):** P-01 (ส่งแล้ว) + feature specs `docs/features/`
- **Target ส่งมอบ:** ภายใน Foundation Gate (17 ก.ค. 2026) — เป็น precondition ของหลาย feature R2/R3

หมายเหตุ: walking skeleton ของ Lead (10–17 มิ.ย.) ครอบ repo/CI/CD, auth/RBAC skeleton (T-01), Central CouchDB base schema + Central-first active-endpoint design (T-02 ตั้งต้น; LAN Edge เป็น outage fallback เท่านั้น) และ 1 vertical slice — task ในตารางนี้คือการ build baseline **เต็ม** ต่อจาก skeleton

> **สถานะ ณ 2026-08-12 (CR-033 + CR-064):** Legend — ✅ done · 🔄 in progress/partial · ⬜ not started
>
> - **T-47 🔄** — `features/shelters` (CRUD + admin UI + auto-assign code + seed shelter_sh001) done แล้ว; ยังต้องยืนยัน FR-2..3 ครบ DoD
> - **T-54 🔄** — Package A (central remote path + event channel + ConnectionBanner) done; **Package B (CR-064)** = network-only edge continuity + ops UI + failback/conflict tests — **deny:** PouchDB, local-only write queue, offline draft queue, app `ActiveEndpoint` switch ([CR-033](../changes/CR-033-remote-first-architecture-program-index.md), [CR-064](../changes/CR-064-edge-disaster-continuity.md))
> - **T-48..T-53, T-55** — ดูสถานะ implement จริงใน repo (people/dashboard มีแล้วบางส่วน); ตารางด้านล่างยังเป็น planning IDs

## Features / Tasks

| ID   | Status           | Feature / Task                                                                                                  | FR        | Stage | Scope    | Raw MD | AI×    | Adj MD | Depends   |
| ---- | ---------------- | --------------------------------------------------------------------------------------------------------------- | --------- | ----- | -------- | ------ | ------ | ------ | --------- |
| T-47 | 🔄 | Shelter master + config (รวมสวิตช์ Toggle เปิด/ปิดรับบริจาคระดับศูนย์ CR-048 §1.11) + seed data | FR-2..3 | prod | in-scope | 3 | ÷1.6 | 2 | T-02 |
| T-48 | 🔄 | Person registration (required `first_name`+`last_name`+`gender`+`phone`; phone เป็น `null` ได้เมื่อไม่มี) + แก้ไขข้อมูล | FR-4..5 | prod | in-scope | 6 | ÷1.6 | 4 | T-01,T-02 |
| T-49 | 🔄 | Screening: vulnerability flags / medical notes / fast-track ตาม role | FR-6..8 | prod | in-scope | 6 | ÷1.6 | 4 | T-48 |
| T-50 | 🔄 | Person Shelter ID/QR generation (payload ไม่มี PII/health) | FR-9 | prod | in-scope | 4 | ÷1.6 | 2.5 | T-48 |
| T-51 | 🔄 | Search + QR scan check-in/out + movement history + occupancy guardrail (warning-only) | FR-10..13 | prod | in-scope | 7 | ÷1.6 | 4.5 | T-50 |
| T-52 | 🔄 | Dashboard v1 (occupancy, capacity, vulnerable/fast-track count, in/out today, last-updated) | FR-14 | prod | in-scope | 6 | ÷1.6 | 4 | T-51 |
| T-53 | ⬜ | Export ตาม shelter/date/role + audit log + masking ตาม role | FR-15..16 | prod | in-scope | 5 | ÷1.25 | 4 | T-48 |
| T-54 | 🔄 | Remote-first + network-only LAN Edge continuity (CR-064) + ops status UI — **deny PouchDB / local-only / offline draft / app ActiveEndpoint** | FR-17..18 | prod | in-scope | 10 | ÷1.25 | 8 | T-02,T-48 |
| T-55 | ⬜ | Manual/Excel fallback + assisted import | FR-19..20 | prod | in-scope | 5 | ÷1.25 | 4 | T-48 |
| T-61 | 🔄 | T-61 — Master config ข้อมูลบุคคลและการลงทะเบียน (Demographic & Registration) | - | prod | in-scope | - | - | - | - |
| T-62 | 🔄 | T-62 — Back Office User Management | - | prod | in-scope | - | - | - | - |
| T-63 | 🔄 | T-63 — Master config Shelter  && Household field | - | prod | in-scope | - | - | - | - |
| T-64 | 🔄 | T-64 — Export shelter data excel | - | prod | in-scope | - | - | - | - |
| T-65 | 🔄 | T-65 — Thailand master data config data | - | prod | in-scope | - | - | - | - |
|  | **รวมทั้งโมดูล** |  |  |  | **52** |  | **37** |  |

> FR mapping accepted for planning จาก kickoff §2 / `docs/features/`; estimate ทั้งชุดใช้เป็น baseline planning แล้ว recalibrate หลัง sprint แรก (K-16). **T-54:** [CR-033](../changes/CR-033-remote-first-architecture-program-index.md) Package A · [CR-064](../changes/CR-064-edge-disaster-continuity.md) Package B (2026-08-12, proposed).

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice**

### T-54 — Remote-first continuity + network-only Edge (FR-17..18) — CR-033 + CR-064

**Description:** Continuity ของ registration/screening ภายใต้ **remote-first**: ปกติเขียน Central; ตอน WAN/central ล่มใช้ **LAN Edge** ผ่าน **network-only cutover** (DNS/router ชี้ domain เดิม — app ไม่สลับ `ActiveEndpoint`); staff **login ใหม่** บน edge / บน central หลัง cutback; มี **ops UI** ดูสถานะต่อ shelter + WAN ที่ศูนย์ — **tech risk #1** ร่วมกับ T-02; Lead B เจ้าของร่วม · รายละเอียดปฏิบัติการ:
[`docs/features/edge-disaster-continuity-idea.md`](../features/edge-disaster-continuity-idea.md)

**Packages:**

| Pkg | Status | Scope |
| --- | --- | --- |
| **A** (CR-033) | ✅ | Central remote path, event channel, ConnectionBanner/retry 3×, disconnected status-only |
| **B** (CR-064) | ⬜ proposed | Edge appliance (staff stack ยกเว้น FastAPI/Mongo), warm sync, network cutover, re-login, ops UI, failback backlog, chaos drill |

**Out of scope (deny — CR-033 + CR-064):**

- PouchDB / local client DB เป็น write path
- local-first sync, local-only mode, offline draft/write queue
- read-only local cache ตอน disconnected
- App-driven `ActiveEndpoint` probe/switch (OD-2 = network-only)
- FastAPI / Mongo / public plane บน edge; สร้าง/แก้ user บน edge

**Definition of Done — Package A (done):**

- Write path remote-first ไป Central ตาม data-model + api-contract (central-only runtime)
- Disconnected = **status-only**; Retry UX: auto 3 attempts แล้ว banner + force retry
- Live update ผ่าน **app-level event channel**

**Definition of Done — Package B (CR-064):**

- Edge image + warm central→edge sync (`shelter_*` + `registry` + `catalog` + filtered `_users`)
- Network-only cutover: staff login ใหม่บน edge แล้ว R/W `shelter_*` ได้โดยไม่แตะ central
- Failback: edge→central backlog ไม่ duplicate (ULID); staff login ใหม่บน central หลัง cutback
- Ops UI (OD-4): central เห็นสถานะต่อ shelter; ที่ศูนย์เห็น WAN up/down
- `/api/v1` + public plane = degraded/unavailable ชัดเจนตอน edge-only
- Test matrix: Central success · network cutover + edge login/write · disconnected · failback no-duplicate · conflict · WAN indicator
- Chaos drill + 5-phase runbook ผ่าน

**Notes อื่นในโมดูล**

- T-48 registration minimum ต้องตรง [Database Schema](../data/schema.md): `first_name`, `last_name`, `gender`, `phone`; phone เป็น required UI field แต่เลือก/กรอก "ไม่มี" แล้วเก็บ `null`
- T-48/T-49/T-51 คือเส้นหลักของ flow หน้างาน (register → screen → check-in) — เป็น vertical slice ที่ทีม copy pattern จาก walking skeleton
- T-52/T-53 ปิดท้าย เพราะต้องมี movement/audit data จริงให้แสดง/ตรวจ


### T-61 — Master config ข้อมูลบุคคลและการลงทะเบียน (Demographic & Registration)

**Status:** Ready for Testing / QA Ready

### T-62 — Back Office User Management

**Status:** Ready for Testing / QA Ready

### T-63 — Master config Shelter && Household field

**Status:** Ready for Testing / QA Ready

**Definition of Done:**
- [ ] เปิด `/back-office/shelter-config` → เห็น card + default seed items ของ shelter_type
- [ ] คลิก card → เพิ่ม/แก้ไข/ลบ item ได้ผ่าน modal เดิม
- [ ] เปิด `/back-office/household-master-data` → เห็น municipality_zone + community cards เท่านั้น
- [ ] แก้ label ของ zone item ใน household-master-data → reload household form → dropdown แสดง label ใหม่
- [ ] เลือก zone → community dropdown กรองเฉพาะ community ที่มี `parent_code` ตรงกัน
- [ ] ปิด network (offline) → household form แสดง loading/empty state ไม่ throw

### T-64 — Export shelter data excel

**Status:** Ready for Testing / QA Ready

### T-65 — Thailand master data config data

**Status:** Ready for Testing / QA Ready

## Effort by phase (Adj MD)

| Phase                   | Raw MD | Adj MD |
| ----------------------- | ------ | ------ |
| Foundation (มิ.ย.–ก.ค.) | 52     | 37     |
| **รวม**                 | **52** | **37** |

## Dependencies

**ต้นทาง:** T-01 (RBAC skeleton), T-02 (data model + remote-first Central-first Edge fallback design) จาก walking skeleton

**ปลายทาง (block):** T-04 household (ขยายจาก person), T-40 search consent, dashboard/EOC metrics ทุกตัวอ่านข้อมูลที่ baseline ผลิต — Foundation Gate (T-20) ครอบ baseline ด้วย
