---
title: "Step 04 — Time-Bound Write Access บน CouchDB"
status: blocked
created: 2026-08-26
updated: 2026-08-26
layer: stable core
blocked_by: CR-094 FR-VOL-05R review + D-VOL-REVOKE
depends_on: 02-tab-roster-attendance.md
---

# Step 04 — Time-Bound Write Access (CouchDB-native)

> ⚠️ **stable core** — แตะ auth/write path ต้องผ่าน review ก่อนลงมือ ([CLAUDE.md](../../../CLAUDE.md) §Remote-first, [change-management.md](../../change-management.md) §1)

## เป้าหมาย

บัญชีอาสา staff-capable เขียน CouchDB ได้เฉพาะช่วง `duty_window ±5 นาที` และหลังเช็คอินแล้วเท่านั้น — บังคับที่ CouchDB ไม่ใช่ที่ client

## 04.1 กลไก (CR-094 FR-VOL-05R)

```
เช็คอิน  → server route (admin cred) → เพิ่ม RoleKey ตาม job.required_roles ให้บัญชี
        → _security ของ shelter_{code} ยอมให้ role นั้นเขียน
เช็คเอาต์/หมดกะ → server route หรือ sweeper → ถอด RoleKey ออก
เขียนตอนไม่มี role → validate_doc_update → forbidden ERR_OUTSIDE_SHIFT_WINDOW (HTTP 403)
```

## 04.2 งาน

- [ ] `validate_doc_update` ต่อ `shelter_{code}` — reject การเขียนของบัญชีที่ไม่มี role ที่ต้องใช้ พร้อม message `ERR_OUTSIDE_SHIFT_WINDOW`
- [ ] deploy design doc ผ่าน lifecycle ที่มีอยู่ ([CR-056](../../changes/CR-056-shelter-map-reduce-cicd-lifecycle.md)) — ห้ามแก้มือบนเซิร์ฟเวอร์
- [ ] `POST /api/back-office/volunteers/duty-grant` — ตรวจ `duty_window ±5m` + `check_in_at != null` ก่อน grant; ปฏิเสธนอกเงื่อนไข
- [ ] `POST /api/back-office/volunteers/duty-revoke` — ถอด role + เขียน audit
- [ ] ต่อ hook ที่ step 02 วางไว้ในหน้า kiosk ให้เรียกของจริง
- [ ] audit log ทุก grant/revoke: `volunteer_id` · `shift_assignment_id` · role · actor · timestamp (FR-VOL-05R.6)
- [ ] 🔒 revoke sweeper กันลืมเช็คเอาต์ — **รอ D-VOL-REVOKE** (แนะนำ: worker กวาดทุก 5 นาที)

## 04.3 Test matrix (บังคับ — ยิง HTTP ตรงไป CouchDB ไม่ผ่าน UI)

| กรณี | ผลที่ต้องได้ |
| --- | --- |
| ก่อนกะเกิน 5 นาที | 403 `ERR_OUTSIDE_SHIFT_WINDOW` |
| ในกะ ยังไม่เช็คอิน | 403 |
| ในกะ เช็คอินแล้ว | 200/201 |
| เกิน `end_ts` +5 นาที | 403 |
| หลังเช็คเอาต์ (ยังอยู่ในกะ) | 403 |
| กะ `flex` | ตามมติ — ปัจจุบันถือว่าไม่ให้ write grant |

- [ ] ครอบคลุม AC-094-02 และ AC-094-03

## DoD

- [ ] test matrix ผ่านครบ 6 แถว
- [ ] ไม่มี admin credential รั่วเข้า client bundle (`grep` หา `COUCHDB_ADMIN_URL` ใน build output)
