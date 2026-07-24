---
id: CR-046
title: Referral — อนุญาต draft → closed (ยกเลิกร่างก่อนส่ง)
status: done
date: 2026-07-24
requested_by: project owner
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §2.11 (status transition matrix)
  - docs/task-breakdown/09-F-referral.md (state machine DoD)
  - frontend/src/lib/features/referrals/domain/referral.transitions.ts
  - frontend/src/lib/features/referrals/ui/referral-detail.svelte
  - frontend/src/lib/features/referrals/server/referral.server-repository.ts
---

# CR-046 — Referral draft cancel (`draft → closed`)

## สรุป (TL;DR)

อนุญาต transition **`draft → closed`** เพื่อยกเลิกฉบับร่างก่อนส่ง · ไม่ bump `schema_v` · ไม่ลบเอกสาร (เก็บ audit ผ่าน `timeline.closed`) · capacity draft ที่ยังไม่ mirror **ห้าม** สร้าง peer ที่ปลายทางตอนปิด

## Why

หลังสร้าง referral เป็น `draft` ผู้ใช้ไม่มีทางทิ้งรายการที่ไม่ใช้ — state machine เดิมอนุญาตแค่ `draft → sent` ทำให้ฉบับร่างค้างในรายการ

## Change

**Before**

```
draft    → sent
sent     → accepted | rejected
accepted → closed
rejected → closed
```

**After**

```
draft    → sent | closed
sent     → accepted | rejected
accepted → closed
rejected → closed
```

| Rule | Spec |
| --- | --- |
| FR-046-1 | `canTransition('draft','closed')` = true |
| FR-046-2 | เมื่อ `draft → closed` ตั้ง `timeline.closed = { at, by }` ตาม pattern เดียวกับ close อื่น |
| FR-046-3 | UI ต้นทางแสดงปุ่ม **ยกเลิกร่าง** เมื่อ `status === draft` และ actor มีสิทธิ์ close (capacity = ต้นทางเท่านั้น) |
| FR-046-4 | capacity ที่ยังเป็น draft (ยังไม่ mirror) — BFF ปิดที่ source เท่านั้น **ไม่** `put` peer ไป `shelter_{to}` |
| FR-046-5 | ไม่ hard-delete; ไม่เพิ่ม enum status ใหม่ |

## Impact

- `docs/data/schema.md` §2.11 — ระบุ transition matrix รวม `draft → closed`
- `docs/task-breakdown/09-F-referral.md` — อัปเดตบรรทัด state machine DoD
- domain `referral.transitions.ts` + tests
- UI `referral-detail.svelte` (label ยกเลิกร่าง)
- optional: ปุ่มยกเลิกบน batch cards สำหรับใบที่ยัง draft
- server: ข้าม `syncCapacityReferralPeer` เมื่อ `from === draft` และ `to === closed`

## Migration

N/A — ไม่ bump `schema_v`; docs เดิมที่เป็น draft ยังอ่านได้; close เป็น write ใหม่

## Acceptance

- [x] จาก detail ของ draft กดยกเลิกร่าง → สถานะ `closed` + มี `timeline.closed`
- [x] draft ที่ `closed` ส่ง (`sent`) ไม่ได้
- [x] capacity draft ปิดแล้วไม่มี doc ใหม่ใน DB ปลายทาง
- [x] unit tests ครอบคลุม `draft → closed` และปฏิเสธ transition อื่นจาก draft นอก `sent|closed`

## Decision log

- 2026-07-24 — owner ขอให้ยกเลิกร่างได้ก่อนส่ง; track ด้วย CR ไฟล์ใน `docs/changes/`
- 2026-07-24 — approved; implement ในรอบเดียวกัน
