---
id: CR-171
title: "`_users.edge_shelters` + soft delete — ถอดสิทธิ์/ลบ user ที่ central ต้องตามไปถึง edge"
status: approved
date: 2026-10-17
updated: 2026-10-17
requested_by: ทีม (review PR #348 edge replication — ข้อจำกัด A ใน docs/couchdb-replication/README.md §7)
decided_by: Fishcanwalk (project owner) — อนุมัติ 2026-10-17
layer: stable
affects:
  - docs/data/schema.md §6 (`_users` — field ใหม่ `edge_shelters`, `deleted_at`, `deleted_by` + กฎ soft delete)
  - docs/data/data-model.md §1 (ตาราง DB — selector ของ filtered `_users` replica)
  - no schema_v bump (`_users` ไม่มี envelope / `schema_v`; field ใหม่เป็น opt, doc เดิมยังถูกต้อง)
  - frontend/src/lib/auth/roles.ts (helper `mergeEdgeShelters`)
  - frontend/src/lib/server/user-service.ts (create / update / delete / list / phone lookup)
  - frontend/src/lib/server/google-oauth.ts, thaid OAuth login (ปฏิเสธบัญชีที่ถูกลบ)
  - frontend/scripts/backfill-edge-shelters.ts (ใหม่ — `pnpm backfill:edge-shelters`)
  - frontend/scripts/seed/users.ts (dev parity)
  - scripts/edge-init.sh (selector ของ job `users_<code>_pull`)
  - docs/couchdb-replication/README.md §7, SETUP-EDGE.md
related:
  - docs/changes/01-core/CR-064-edge-disaster-continuity.md
  - docs/changes/01-core/CR-093-multi-shelter-compound-roles.md
---

# `_users.edge_shelters` + soft delete

> **สรุป (TL;DR):** เพิ่ม `edge_shelters` (รหัสศูนย์ทุกศูนย์ที่ user **เคย** มี `shelter:{code}` — เพิ่มได้อย่างเดียว)
> ใน `_users` แล้วให้ job `users_<code>_pull` ของ edge กรองด้วย field นี้แทน `roles` · "ลบ user" ทุกเส้นทางเปลี่ยนเป็น
> **soft delete** (ถอด role, สุ่มรหัส, `deleted_at`) ห้าม `DELETE` · ผล: ถอดสิทธิ์/ลบที่ central ไหลถึง edge ผ่าน
> replication เดิม · dev แก้ `user-service.ts` + OAuth login + `edge-init.sh` + backfill script · ไม่ bump `schema_v`

## Why

- edge ได้ `_users` ผ่าน filtered replication (CR-064) ด้วย selector `roles` มี `shelter:{CODE}`. Selector ประเมิน
  **เฉพาะ revision ใหม่**: revision ที่ถอด role ออกไม่ตรง selector และ tombstone (`DELETE`) ไม่มี `roles` →
  ไม่ถูก replicate, checkpoint เลยไป. edge จึงเก็บ revision เก่า (role เดิม + รหัสเดิม) ไว้ตลอด.
- login ที่ edge ตรวจกับ `_users` ของ edge เอง → คนที่ถูกถอดสิทธิ์/ลบที่ central ยัง login ที่ edge ได้ (รวมผ่าน IP
  ของ edge ใน LAN ตอน WAN ปกติ) และสิ่งที่เขียนถูก push ขึ้น central ด้วยสิทธิ์ admin (OD-6) — ขัด CR-064 A1
  (central เป็นเจ้าของ user).
- `deleteUser` ปัจจุบันใช้ `DELETE` จริงทุกครั้งที่ SA ลบ และเมื่อ manager ถอดศูนย์สุดท้ายของ user → tombstone
  ไม่มี field ใดให้ selector จับได้ จึงต้องเลิก hard delete.

ทางเลือกที่ตัดทิ้ง: ดู Decision log.

## Change

### Fields ใหม่ใน `_users` (schema.md §6)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `edge_shelters` | [str] | opt (ทุก doc ที่เขียนผ่าน `user-service` ต้องมี) | รหัสศูนย์ (`SH001`) ทุกศูนย์ที่ user เคยมี `shelter:{code}` · **append-only** · ใช้กำหนดปลายทาง replication ไป edge เท่านั้น **ไม่ให้สิทธิ์ใด ๆ** |
| `deleted_at` | ts\|null | opt | เวลาที่ soft delete · `null`/ไม่มี = บัญชีปกติ |
| `deleted_by` | str\|null | opt | `_users` name ของผู้ลบ |

### Before → After

| เรื่อง | Before | After |
| --- | --- | --- |
| selector ของ `users_<code>_pull` | `roles` มี `shelter:{CODE}` | `edge_shelters` มี `{CODE}` **หรือ** `roles` มี `shelter:{CODE}` (กันช่วงก่อน backfill) |
| SA ลบ user | `DELETE` | soft delete |
| manager ลบ user ที่เหลือแค่ศูนย์ตน | `DELETE` | soft delete |
| manager ลบ user ที่มีศูนย์อื่นด้วย | ถอด assignment ศูนย์ตน | เหมือนเดิม (`edge_shelters` คงเดิม) |
| สร้าง user ชื่อที่ถูกลบไปแล้ว | สร้างใหม่ได้ (doc เดิมเป็น tombstone) | `CONFLICT` — ชื่อถูกจองถาวร ข้อความแยกจากชื่อที่ยังใช้งาน |

### Requirements

- **FR-1** ทุกครั้งที่ `user-service` เขียน `roles` (create, update, ถอดศูนย์) ต้องตั้ง
  `edge_shelters = edge_shelters เดิม ∪ ศูนย์ใน roles เดิม ∪ ศูนย์ใน roles ใหม่` ผ่าน helper pure `mergeEdgeShelters`
  ใน `$lib/auth/roles.ts` — ไม่ซ้ำ, คงลำดับเดิม, ค่าใหม่ต่อท้าย. (รวม roles เดิมด้วย เพื่อให้ doc ที่ยังไม่ backfill
  บันทึกศูนย์ที่กำลังถูกถอดไว้.)
- **FR-2** ห้ามลบค่าออกจาก `edge_shelters` ในทุกเส้นทาง. ทุก PUT ของ `_users` ใน `user-service` / OAuth ต้องคง
  field นี้ (spread doc เดิม).
- **FR-3** `deleteUser` ห้ามเรียก `DELETE` บน `_users`. เมื่อผลคือ user ไม่เหลือศูนย์ (SA ลบ หรือ manager ถอดศูนย์สุดท้าย)
  ให้ PUT doc เดิมด้วย: `roles: []`, `shelter_id: null`, `active: false`, `password: <สุ่ม ≥ 32 byte hex>`,
  `deleted_at: now`, `deleted_by: caller.name` — field อื่น (รวม PII และ `edge_shelters`) คงเดิม.
- **FR-4** กติกาเดิมยังบังคับ: bootstrap admin ห้ามลบ, ห้ามลบ SA คนสุดท้าย (`assertNotLastAppSa`), manager ลบได้
  เฉพาะ user ในศูนย์ตน.
- **FR-5** บัญชีที่ `deleted_at` ไม่ว่าง **ไม่ใช่ user** สำหรับ management API: `listUsers` ไม่คืน, get/update/
  reset-password/delete ตอบเหมือน user ที่ไม่มีอยู่ (error "not found" เดิมของ `readUserDoc`), นับ SA (`assertNotLastAppSa`) ไม่นับ.
- **FR-6** `createUser` เมื่อ `_users/{name}` มีอยู่แล้ว → `CONFLICT` เสมอ (ห้ามเขียนทับ doc เดิม). ถ้า doc เดิม
  `deleted_at` ไม่ว่าง ข้อความต้องบอกว่า "ชื่อผู้ใช้นี้เคยถูกใช้และถูกลบไปแล้ว กรุณาใช้ชื่ออื่น" (แยกจาก "มีอยู่แล้ว" ของบัญชีที่ใช้งาน)
  เพราะบัญชีที่ถูกลบไม่อยู่ในรายการ user. ชื่อที่ถูกลบถูกจองถาวร (กู้คืนบัญชี = ฟีเจอร์แยก ไม่อยู่ใน CR นี้).
- **FR-7** ตรวจเบอร์ซ้ำ (`assertPhoneAvailable`) และ login ด้วยเบอร์ (`resolveLoginName` / `findUserNameByPhone`)
  ไม่นับบัญชีที่ถูกลบ.
- **FR-8** OAuth login (Google, ThaiD) ต้องไม่ mint session ให้ doc ที่ `deleted_at` ไม่ว่าง → ถือเป็นยังไม่ผูก
  (ไม่เปิด flow link CR-141 ให้บัญชีที่ถูกลบ). เหตุ: mint ใช้ `salt` ปัจจุบัน ไม่ผ่านรหัสผ่าน.
- **FR-9** `scripts/edge-init.sh` job `users_<code>_pull` ใช้ selector
  `{"$or":[{"edge_shelters":{"$elemMatch":{"$eq":"<CODE>"}}},{"roles":{"$elemMatch":{"$eq":"shelter:<CODE>"}}}]}`.
  (hash ของ job เปลี่ยน → `edge-init` สร้าง job ใหม่เอง, checkpoint เริ่มใหม่ครั้งเดียว.)
- **FR-10** `pnpm backfill:edge-shelters` — เติม `edge_shelters` ให้ทุก `_users` doc (ยกเว้น `_design/*`) =
  `mergeEdgeShelters(เดิม, roles)`; dry-run เป็น default, เขียนเมื่อ `--write`; idempotent (รอบสองไม่มีอะไรเปลี่ยน).
- **FR-11** seed (`frontend/scripts/seed/users.ts`) เขียน `edge_shelters` ตาม FR-1 (dev parity).

### Acceptance

- สร้าง user `shelter:SH001` → doc มี `edge_shelters: ["SH001"]`; เพิ่ม SH002 → `["SH001","SH002"]`; ถอด SH001 → ยัง
  `["SH001","SH002"]`.
- SA ลบ user → doc ยังอยู่ (`GET` 200) ด้วย `roles: []`, `active: false`, `deleted_at` ไม่ว่าง; login ด้วยรหัสเดิมไม่ผ่าน;
  cookie `AuthSession` เดิมใช้ไม่ได้ (salt เปลี่ยน).
- ไม่มีโค้ดใน `user-service` เรียก `DELETE` บน `_users` (unit test ล็อก).
- user ที่ถูกลบไม่อยู่ใน `listUsers`; สร้างชื่อเดิมซ้ำได้ `CONFLICT` พร้อมข้อความ "เคยถูกใช้และถูกลบไปแล้ว" และ doc เดิมไม่เปลี่ยน.
- Google/ThaiD login ของบัญชีที่ถูกลบไม่ได้ session.
- edge (CouchDB 3.5): ถอด role / soft delete ที่ central → doc ที่ edge ได้ revision ใหม่ (`roles: []`) ภายในรอบ
  replication และ login ที่ edge ไม่ผ่าน.
- `backfill:edge-shelters --write` รอบสองรายงาน 0 doc เปลี่ยน.

## Impact

- **Code:** ตาม `affects`. Unit test: `roles.test.ts` (`mergeEdgeShelters`), `user-service.test.ts` (FR-1–FR-7),
  OAuth resolve (FR-8).
- **Docs:** schema.md §6, data-model.md §1 แถว `_users`, README §7 ข้อจำกัด A → แก้ด้วย CR นี้ (เหลือช่องที่ระบุด้านล่าง).
- **พฤติกรรม UI:** ปุ่มลบ user ยังเป็นปุ่มเดิม ผลต่อผู้ใช้เหมือนเดิม (หายจากรายการ, login ไม่ได้).
- **ข้อจำกัดที่เหลือ (ยอมรับ):**
  - ลบ/แก้ `_users` ตรงผ่าน Fauxton / admin API นอก `user-service` ข้ามกฎนี้ได้ — ห้ามทำใน runbook.
  - ช่วง WAN ของศูนย์ล่ม การถอดสิทธิ์ที่ central ไปไม่ถึง edge จนกว่า WAN กลับ.
  - doc ที่ถูกลบ (พร้อม PII และ password hash ของรหัสสุ่ม) ค้างที่ central และที่ edge ทุกศูนย์ใน `edge_shelters`
    จนกว่าจะ wipe edge ตอนปิดศูนย์ (data-model.md — retention ของ edge server). ชื่อ user ที่ถูกลบถูกจองถาวร.

## Migration

ไม่ bump `schema_v`. ลำดับ deploy:

1. deploy frontend (central) — writer เริ่มเขียน `edge_shelters`.
2. `pnpm backfill:edge-shelters` (dry-run) → ตรวจ → `--write`.
3. edge แต่ละเครื่อง: `git pull` แล้ว `docker compose -f docker-compose.edge.yml run --rm edge-init` (job `_users`
   ถูกสร้างใหม่ด้วย selector ใหม่).

ข้อ 3 ก่อนข้อ 2 ยังปลอดภัย: selector มี `$or` กับ `roles` จึงไม่ทำ user หายจาก edge.
user ที่ถูก `DELETE` ไปก่อน CR นี้ (tombstone) ไม่ถูกแก้ย้อนหลัง — ลบที่ edge ด้วยมือ หรือ wipe edge.

## Decision log

- 2026-10-17 — proposed + approved (owner). Decisions:
  - กลไก: field `edge_shelters` + selector แทน reconcile ฝั่ง edge (`edge-watchdog` เทียบ `_rev` กับ central) —
    reconcile ต้องยิง central ตามจำนวน user (~100,000 user/edge ≈ 15 MB/นาที/edge ถ้าเทียบทุกคน) หรือเก็บ seq ของ `_changes`;
    selector ใช้ replication เดิม ไม่มีภาระเพิ่มและมีผลทันที.
  - ตัดทิ้ง: เอา selector ออก (ส่ง user + PII ทุกศูนย์ไปทุก edge), `$or` กับ `_deleted` (ไม่ครอบการถอด role),
    runbook ลบมือ.
  - soft delete: ถอดสิทธิ์ + สุ่มรหัส **คง PII** (ไม่ล้าง phone/email/mfa).
  - ชื่อซ้ำ: reactivate บัญชีเดิม (แก้ 2026-10-17 — ดูบรรทัดถัดไป).
  - hard delete: ไม่อนุญาตทุกกรณี (รวม SA).
- 2026-10-17 — แก้ FR-6 (owner): ชื่อที่ถูกลบ → `CONFLICT` แทน reactivate. เหตุผล: audit trail อ้าง user ด้วย `name`
  (`created_by` ฯลฯ) — ใช้ชื่อซ้ำทำให้ประวัติคนเก่าปนกับคนใหม่, `edge_shelters` ของคนเก่าติดไปกับคนใหม่, และ doc ของคนเก่าถูกเขียนทับ.
  ราคา: ชื่อถูกจองถาวร. กู้คืนบัญชีโดย SA ให้ทำเป็นฟีเจอร์แยกถ้าจำเป็น.
