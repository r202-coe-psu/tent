---
id: draft
title: ให้ `shelter:{code}` เป็นกุญแจอ่าน DB กลาง `registry` / `catalog` — แก้ผู้ใช้ compound role อ่านรายชื่อศูนย์และ catalog ไม่ได้
status: proposed
date: 2026-10-12
updated: 2026-10-12
requested_by: ทีม (staging — ผู้ใช้ `SH001:distribution_staff` เห็น "เกิดข้อผิดพลาดในการโหลดข้อมูล" ที่ navbar)
decided_by: <เจ้าของโครงการ — รอเคาะ>
layer: stable
affects:
  - docs/data/schema.md §6 (กฎความปลอดภัยของ Compound Roles — เพิ่มกฎ DB กลาง)
  - docs/data/data-model.md §3.3, §6 (`_security` ของ registry/catalog)
  - no schema_v bump (ไม่เปลี่ยนรูป doc ที่ persist; `_users.roles` เท่าเดิม)
  - frontend/src/lib/server/central-db-security.ts (ใหม่ — role list + write-policy guard)
  - frontend/src/lib/features/shelters/server/provisioner.ts (grant ตอนสร้างศูนย์)
  - frontend/scripts/sync-central-db.ts (`pnpm sync:central` / `pnpm db:sync` — backfill + ลำดับ deploy)
  - frontend/scripts/seed/registry-shelters.ts, frontend/scripts/seed/master-seed.ts (dev parity)
---

# ให้ `shelter:{code}` เป็นกุญแจอ่าน DB กลาง `registry` / `catalog`

> **สรุป (TL;DR):** เพิ่ม `shelter:{code}` ของทุกศูนย์เข้า `_security.members.roles` ของ `registry` และ
> `catalog` (คง role แบนเดิมไว้) ให้ผู้ใช้ทุกคนที่มี scope ศูนย์อ่าน DB กลางได้ ไม่ว่าจะถือ capability แบบ
> compound (`SH001:distribution_staff`) หรือ flat ตัวไหน · dev ต้องแก้ provisioner + `sync:central` + seed ·
> ไม่แตะ `_users.roles` / VDU ของ `shelter_*` / ไม่ bump `schema_v` · การเขียนยังคุมด้วย VDU เดิม

## Why

- CR-093 กำหนด `shelter:{code}` เป็น **กุญแจผ่านประตู DB** และ `{code}:{capability}` เป็นสิทธิ์ระดับ
  `validate_doc_update` เท่านั้น — แต่ไม่เคยระบุ `_security` ของ DB กลาง `registry` / `catalog`.
- โค้ดที่ตั้ง `_security` ของ DB กลางยังเป็นยุคก่อน CR-093: `sync-central-db.ts` และ seed ให้ member
  แค่ flat 4 role (`shelter_manager`, `registration_staff`, `kitchen_staff`, `warehouse_staff`);
  provisioner ให้ `registry` แค่ flat `SHELTER_CAPABILITIES` และไม่แตะ `catalog`.
- ฟอร์มจัดการผู้ใช้เขียน role แบบ compound เสมอ (`roles.ts` `buildRoles…` "always compound form") →
  ผู้ใช้ที่สร้าง/แก้ผ่านฟอร์ม **ทุก capability** ได้ 403 ที่ `registry`/`catalog`; flat `triage_staff`,
  `medical_staff`, `supply_coordinator`, `volunteer_coordinator`, `security_officer`, `facility_staff` ก็เช่นกัน.
  อาการ: navbar โหลดรายชื่อศูนย์ไม่ได้ (`shelter-navbar.svelte` → "เกิดข้อผิดพลาดในการโหลดข้อมูล"),
  อ่าน item master ใน `catalog` ไม่ได้.
- dev local บางเครื่องใช้ได้เพราะมีคนเติม `SHxxx:distribution_staff` ลง `_security` ด้วยมือ — ไม่มีโค้ดใดทำ.

## Change

### Before → After (`_security.members.roles`)

| DB | before | after |
| --- | --- | --- |
| `registry` | flat 4 role (sync/seed) ∪ flat `SHELTER_CAPABILITIES` (provisioner) | เดิม ∪ `shelter:{code}` ทุกศูนย์ใน registry |
| `catalog` | flat 4 role | เดิม ∪ `shelter:{code}` ทุกศูนย์ใน registry |

`admins.roles` คงเดิม (`system_admin`). การเปลี่ยนเป็นแบบ **merge เพิ่มเท่านั้น** — ไม่ลบ entry ใด.

### Requirements

- **FR-1** ต้องมีฟังก์ชัน pure เดียว (`centralMemberRoles(shelterCodes)`) คืน member roles ของ DB กลาง =
  flat 4 role เดิม ∪ `shelter:{code}` ต่อศูนย์ (ไม่ซ้ำ, เรียงคงที่). ทุก writer ใช้ฟังก์ชันนี้ ห้าม hardcode list.
- **FR-2** สร้างศูนย์ใหม่ (`provisionShelter`) ต้อง merge `shelter:{code}` ของศูนย์นั้นเข้า `registry` และ `catalog`.
- **FR-3** `pnpm sync:central --write --confirm` ต้อง merge `centralMemberRoles(ทุกศูนย์ใน registry)` เข้า
  `registry` และ `catalog` (idempotent; dry-run รายงานโดยไม่เขียน).
- **FR-4 (write-policy guard)** ห้ามขยาย members ของ DB กลางก่อน VDU ของ DB นั้นมีผล:
  - `sync:central` deploy `registry/_design/app` และ `catalog/_design/access` **ก่อน** ขั้น `_security`.
  - provisioner: `registry` design ถูก deploy ก่อนอยู่แล้ว; `catalog` ต้องมี `_design/access` ที่มี
    `validate_doc_update` — ไม่มี → fail closed (`ServiceError INTERNAL`, ให้รัน `pnpm sync:central`)
    **ก่อน** จอง shelter code และก่อนสร้าง `shelter_{code}` (ไม่เหลือศูนย์ค้างครึ่งทาง);
    DB `catalog` ยังไม่มี (404) → ข้ามขั้นนี้ (`sync:central` จะ grant ตอนสร้าง DB).
  - ลำดับ "VDU ก่อน `_security`" ของ `sync:central` อยู่ใน `syncCentralDbAccess()` และมี unit test ล็อกไว้.
- **FR-5** seed (`pnpm seed`) ให้ผลเหมือน FR-2/FR-3 บน local (dev parity).
- **FR-6** ไม่เปลี่ยน: `_users.roles`, `validate_doc_update` ของ `shelter_*` / `registry` / `catalog`,
  `_security` ของ `shelter_*`.

### Acceptance

- ผู้ใช้ `["shelter:SH001", "SH001:<capability>"]` ทุก capability ใน `SHELTER_CAPABILITIES` อ่าน
  `registry` และ `catalog` ได้ (200) หลังรัน `sync:central`.
- ผู้ใช้ flat เดิมที่อ่านได้ก่อนเปลี่ยน ยังอ่านได้ (ไม่มี 200 → 403).
- ผลการเขียน `registry`/`catalog` ของทุก role ไม่เปลี่ยน (`registry` = SA เท่านั้น; `catalog` ตาม VDU เดิม).
- รัน `sync:central` ซ้ำ = `already_current`.

## Impact

- **Code:** ตาม `affects`.
- **Tests:** unit — `central-db-security.test.ts` (role list, write-policy guard), `provisioner.test.ts`
  (grant registry/catalog, fail closed เมื่อ catalog ไม่มี VDU, ข้ามเมื่อไม่มี catalog).
  verification — matrix role × (flat | compound) × (อ่าน | เขียน) ก่อน/หลัง บน local CouchDB.
- **Docs (หลัง approve):** `schema.md` §6 เพิ่มกฎ "`shelter:{code}` เป็นกุญแจอ่าน DB กลาง `registry`/`catalog`;
  การเขียนคุมด้วย VDU ของ DB นั้น"; `data-model.md` §6 เพิ่ม `_security` ของ `registry`/`catalog`.
- **Ops:** หลัง merge รัน `pnpm db:sync` (หรือ `pnpm sync:central --write --confirm`) บน staging/prod หนึ่งครั้ง.
- **ผลข้างเคียง (ตั้งใจ):** ผู้ใช้ที่มี scope ศูนย์ใดก็ได้อ่าน `registry`/`catalog` **ทั้ง DB** (รวม master ของศูนย์อื่น,
  `config:app`, `kiosk_banner`) — เท่ากับที่ flat 4 role อ่านได้อยู่แล้ววันนี้; ไม่มีชนิดข้อมูลใหม่ถูกเปิด.
- **ผลข้างเคียง (แก้ช่องโหว่เดิม):** environment ที่ `registry/_design/app` ยังไม่มี `validate_doc_update`
  (เช่น local ที่ deploy design รุ่นเก่า) member flat เขียน `registry` ได้ (201). FR-4 ให้ `sync:central` deploy
  design ก่อน → ผู้ใช้ที่ไม่ใช่ SA เขียน `registry` ไม่ได้อีก (403) ตามเจตนาของ `registry-design.ts`.
  writer ฝั่ง browser เดียวของ `registry` คือ `/system-management/scanners` (`requireAdmin`) → ไม่กระทบ.

### Open points

> [NEEDS DECISION: ยืนยันว่า role ที่ยังไม่เคยอ่าน DB กลาง (TRI, MED, SC, VC, SEC, FAC และผู้ใช้ที่มีแค่
> `shelter:{code}`) ควรอ่าน `registry`/`catalog` ได้ — ตาม data-model §3.3 ที่ app ทุกหน้าอ่าน DB กลาง]

> [NEEDS DECISION: provisioner fail closed เมื่อ `catalog` ไม่มี `_design/access` (FR-4) — ยอมให้สร้างศูนย์ล้ม
> ใน environment ที่ไม่เคยรัน `sync:central` หรือไม่]

> [NEEDS DECISION: edge fallback replica — `_security` ไม่ replicate; ต้องมีขั้นตอน deploy `_security`
> ของ `registry`/`catalog` ลง edge ด้วย (data-model §6) — ยังไม่มีสคริปต์ edge ใน repo]

**นอกขอบเขต (แยก CR):** VDU ของ `catalog` ตรวจเฉพาะ flat `shelter_manager` / `warehouse_staff` สำหรับ
เอกสารระดับศูนย์ → compound `SH001:shelter_manager` เขียนเอกสารระดับศูนย์ใน `catalog` ไม่ได้.

## Migration

N/A สำหรับ schema — ไม่มี doc ที่ persist เปลี่ยนรูป. Rollout: deploy code → รัน `pnpm db:sync` ต่อ environment
(merge-only, idempotent). Rollback: ลบ `shelter:{code}` ออกจาก `members.roles` ของ `registry`/`catalog`.

## Decision log

- 2026-10-12 — proposed. ทางเลือกที่ตัดทิ้ง: ใส่ `{code}:{capability}` ทุกคู่ (ศูนย์ × 11) — list โตตาม
  capability, ต้อง re-sync ทุกครั้งที่เพิ่ม capability, ไม่ครอบ dynamic role ของ Worker Sweeper และใช้สิทธิ์ระดับ
  VDU เป็นกุญแจ DB ขัด CR-093. ใส่ตอนสร้าง user — เขียน `_security` ถี่ และต้องจัดการตอนถอน role.
