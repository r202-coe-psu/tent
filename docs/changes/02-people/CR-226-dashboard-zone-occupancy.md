---
id: CR-226
title: Back-office dashboard — กราฟความเต็มรายโซน (Present ต่อโซน)
status: approved
date: 2026-11-03
requested_by: Soravit Sukkarn (Team Lead) — requirement จาก feedback 2026-11-03 · GitHub #1135
decided_by: Soravit Sukkarn (Team Lead)
layer: volatile
affects:
  - docs/data/data-model.md §4 Read models (+ view `occupancy_by_zone`)
  - docs/data/api-contract.md (+ BFF `GET /api/back-office/shelter/{code}/dashboard/zones`)
  - docs/task-breakdown/02-people.md T-08 / T-09 (zone overview + occupancy dashboard)
  - no schema_v bump (ไม่เปลี่ยนรูป doc ที่ persist)
  - shelter view manifest v7 → v8 (frontend/src/lib/features/shelters/domain/view-manifest.ts)
  - frontend/src/lib/features/shelters/domain/views.ts (`SHELTER_DASHBOARD_VIEWS.occupancy_by_zone`)
  - frontend/src/lib/features/dashboard/** (domain + data + application + ui)
  - frontend/src/routes/api/back-office/shelter/[code]/dashboard/zones/+server.ts (+ server.test.ts)
  - frontend/src/routes/(protected)/back-office/evacuee-management/dashboard-tab.svelte
---

# CR-226 — กราฟความเต็มรายโซน

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** แท็บ "ภาพรวม" ของ Back-office evacuee management เพิ่ม widget ความเต็มรายโซน แสดงเป็นแท่งแนวนอน หนึ่งแท่งต่อโซน
> - **เพื่อใคร:** ผู้จัดการศูนย์ ใช้ตัดสินใจเพิ่ม ลด หรือปิดโซน
> - **build:** เพิ่ม CouchDB view `occupancy_by_zone`, BFF `GET …/dashboard/zones`, domain function และ UI widget โดยนับคนในโซนด้วยนิยาม **Present** (`active`, `room_confirmed`, `temporary_leave`)
> - **กระทบ:** view manifest v7 → v8 (ต้อง redeploy `_design/app`) · ไม่ bump `schema_v` · ไม่แตะ public plane

---

## Requirements

**นิยาม**

- FR-1 — ยอดคนในโซน = จำนวน evacuee ใน `shelter_{code}` ที่ `current_stay.zone = <zone code>` และ `current_stay.status` ∈ **Present** (`active`, `room_confirmed`, `temporary_leave`) ตาม `docs/data/schema.md` §1.1
- FR-2 — evacuee ที่ `current_stay.zone = null` ไม่นับใน widget นี้
- FR-3 — evacuee ที่ `current_stay.zone` ไม่ตรงกับโซนใดใน `zones[]` ของ shelter ไม่แสดงใน widget นี้

**CouchDB view**

- FR-4 — เพิ่ม view `occupancy_by_zone` ใน `SHELTER_DASHBOARD_VIEWS` (`_design/app`): map emit key `[current_stay.zone, current_stay.status]` value `1` เฉพาะ `doc.type = 'evacuee'` ที่มี `current_stay.zone`; reduce `_count`
- FR-5 — bump `SHELTER_VIEW_MANIFEST.version` 7 → 8 พร้อมคอมเมนต์อ้าง CR นี้

**BFF**

- FR-6 — เพิ่ม `GET /api/back-office/shelter/{code}/dashboard/zones` ใช้ auth และ shelter scope เดียวกับ route `dashboard/occupancy`
- FR-7 — route query `_design/app/_view/occupancy_by_zone?group=true` ผ่าน `adminRaw` แล้วคืน rows `{ zone, status, count }[]`
- FR-8 — response ห้ามมี PII (ไม่มี `_id` หรือชื่อ evacuee)
- FR-9 — ถ้า view ยังไม่ deploy (manifest เก่ากว่า v8) route ต้องคืน 500 พร้อมข้อความ ตามพฤติกรรม `view-version-guard` เดิม

**Domain**

- FR-10 — เพิ่มฟังก์ชัน pure ใน `features/dashboard/domain` รับ rows จาก FR-7 กับ `zones[]` ของ shelter แล้วคืน `ZoneOccupancy[]` ต่อโซน: `code`, `name`, `count`, `capacity`, `percent`, `level` (`normal` | `warning` | `full`), `closed`
- FR-11 — `count` รวมเฉพาะสถานะ Present (FR-1) ส่วนสถานะอื่นใน rows ไม่นับ
- FR-12 — `level` = `full` เมื่อ `count ≥ capacity`, `warning` เมื่อ `count ≥ 80%` ของ `capacity`, นอกนั้น `normal` (เกณฑ์เดียวกับ `shelter-occupancy-cell`)
- FR-13 — โซนที่ไม่มีคนเลยต้องอยู่ในผลลัพธ์ด้วย `count = 0`
- FR-14 — `closed = true` เมื่อ zone `status = 'closed'`

**UI**

- FR-15 — แท็บ "ภาพรวม" (`dashboard-tab.svelte`) มี widget "ความเต็มรายโซน" แสดงทุกโซนของศูนย์ที่เลือก เป็นแท่งแนวนอนหนึ่งแท่งต่อโซน พร้อม label `N / capacity` และ %
- FR-16 — แท่งใช้สีตาม `level`: `warning` เป็นสีเหลือง, `full` เป็นสีแดง
- FR-17 — โซนที่ `closed` แสดงจางพร้อมป้าย "ปิด"
- FR-18 — widget ใช้ TanStack Query hook ใหม่ใน `features/dashboard/application` และ export ผ่าน barrel `$lib/features/dashboard`

## Acceptance

- [ ] ยอดของแต่ละโซนใน widget ตรงกับหน้า `onsite/zoning` ("พักอยู่ N / capacity คน") สำหรับศูนย์และเวลาเดียวกัน
- [ ] โซนที่ถึง 80% แสดงสีเหลือง ถึง 100% แสดงสีแดง และโซนปิดแสดงจางพร้อมป้าย "ปิด"
- [ ] โซนที่ไม่มีคนแสดง `0 / capacity`
- [ ] BFF ไม่ส่ง PII และคืน 500 พร้อมข้อความเมื่อ view ยังไม่ deploy
- [ ] Tests:
  - domain: rows + zones → `ZoneOccupancy[]` (สถานะที่นับ, เกณฑ์ 80/100%, โซนว่าง, โซนปิด)
  - view map: emit `[zone, status]` ถูก และข้าม doc ที่ `zone = null`
  - BFF `server.test.ts`: สิทธิ์และ shelter scope, path ของ view, 500 เมื่อ view ยังไม่ deploy
- [ ] ทุกไฟล์ `.svelte` ที่แก้ผ่าน `svelte-autofixer`

## Why

- แท็บภาพรวมมีแค่ยอดรวมทั้งศูนย์ ผู้จัดการศูนย์จึงไม่เห็นว่าโซนไหนเต็มหรือว่าง และตัดสินใจเพิ่ม ลด หรือปิดโซนไม่ได้ (#1135)
- **ใช้ Present แทน In-shelter (`active` + `room_confirmed`):** คนที่ `temporary_leave` ยังถือที่ในโซนอยู่ และหน้า `onsite/zoning` (`countPresentOccupantsByZone`) นับด้วย Present อยู่แล้ว widget นี้จึงต้องนับแบบเดียวกันเพื่อให้สองหน้าตรงกัน ผลคือผลรวมของทุกโซนอาจไม่เท่ากับ KPI "ในศูนย์" ที่นับด้วย In-shelter (CR-170 / CR-224) ซึ่งสอดคล้องกับ CR-224 FR-7 ที่คง Present ไว้โดยเจตนา (คนออกชั่วคราวยังจองที่นอน) และ widget นี้ไม่อยู่ในรายการจุดที่ต้องใช้ In-shelter ของ CR-224 FR-3
- **นับฝั่ง server ด้วย view:** หน้า zoning โหลด evacuee ทั้งศูนย์มานับที่ browser ซึ่งไม่เหมาะกับ dashboard ของศูนย์ใหญ่ (~1k+ คน) และ view ไม่ส่ง PII ออกไป
- **emit `[zone, status]` แทน emit เฉพาะ Present:** ถ้านิยามเปลี่ยนภายหลัง (เช่นเพิ่ม reserved จาก `pre_registered` ตาม T-08 DoD) จะแก้แค่ domain function โดยไม่ต้อง bump manifest อีกรอบ

**ทางเลือกที่ตัดทิ้ง**

- นับฝั่ง client ด้วย `useEvacuees()`: โหลดข้อมูลคนทั้งศูนย์
- แยกแท่ง occupied กับ reserved (`pre_registered` ที่จองโซน): ยังไม่มีที่ไหนนับ reserved รายโซน เก็บไว้เป็นงานถัดไป
- แถว "ยังไม่จัดโซน" และยอดรวม capacity โซนเทียบศูนย์: ไม่อยู่ในขอบเขตนี้

## Migration

- CouchDB: ไม่มี doc ต้องแก้ ไม่ bump `schema_v`
- `_design/app`: CI/CD deploy manifest v8 ให้ทุก `shelter_{code}` ก่อนเปิดใช้ widget ระหว่างนั้น route `dashboard/zones` จะคืน 500 ตาม FR-9 โดยไม่กระทบ widget อื่นในแท็บ
- Mongo / worker: ไม่มี

## Decision log

- 2026-11-03 — proposed (grill #1135: นับด้วย Present, แท่งแนวนอนต่อโซน, view + BFF, โซนปิดแสดงจาง, track ด้วย CR ไฟล์)
- 2026-11-03 — approved by Soravit Sukkarn (Team Lead)
