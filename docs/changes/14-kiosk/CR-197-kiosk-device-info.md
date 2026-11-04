---
id: CR-197
title: Kiosk device info — แผงข้อมูลเครื่องหลัง PIN เจ้าหน้าที่ รวมปุ่มทดสอบการพิมพ์
status: approved
date: 2026-10-26
created: 2026-10-26
updated: 2026-10-26
requested_by: ทีม kiosk
decided_by: Soravit Sukkarn (Team Lead) — approved 2026-10-26
layer: volatile
affects:
  - docs/data/api-contract.md §2.2.1 (ใหม่) `POST /api/v1/kiosk/device-info` + `POST /api/v1/kiosk/host-info` (ตอบที่ตัวตู้)
  - docs/changes/14-kiosk/CR-150-kiosk-label-stacked-qr-name-tag.md FR-L6 / AC-L5 — ปุ่มทดสอบการพิมพ์ย้ายเข้าแผงข้อมูลเครื่อง (label ตัวอย่างไม่เปลี่ยน)
  - docs/changes/14-kiosk/CR-158-kiosk-staff-pin-face-bypass.md FR-32 — PIN ที่เปิดทดสอบการพิมพ์ = PIN ที่เปิดแผงข้อมูลเครื่อง (กติกา verify ไม่เปลี่ยน)
  - schema: ไม่เปลี่ยน (ไม่มี field / doc type ใหม่, ไม่ bump `schema_v`)
  - frontend/src/routes/api/v1/kiosk/device-info/+server.ts (ใหม่) · frontend/src/lib/server/kiosk-banners/kiosk-banner-group.server.ts (`readGroupDoc` export)
  - frontend/src/lib/features/kiosk/{domain/device-info.ts, data/kiosk-device-info.api.ts, data/kiosk-host-info.api.ts, application/device-info.svelte.ts, application/test-print.svelte.ts, ui/kiosk-device-info.svelte} · ลบ ui/kiosk-test-print.svelte
  - frontend/src/routes/kiosk/+page.svelte
  - kiosk/app/manager.py (`/api/v1/kiosk/host-info` ตอบในเครื่อง + แนบ device credential ให้ `/api/v1/kiosk/device-info`)
---

# CR-197 — แผงข้อมูลเครื่องของตู้ kiosk

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** หน้า `/kiosk` มีปุ่ม ℹ เล็กมุมล่างขวา → PIN เจ้าหน้าที่ของเครื่อง → แผงแสดงข้อมูลตู้ (ชื่อเครื่อง, hostname, IP, ศูนย์, จุดบริการ, PIN, banner group, ขนาดหน้าจอ) และปุ่ม "ทดสอบการพิมพ์" · ปุ่มพิมพ์กลมเดิม (CR-150 FR-L6) ถูกเอาออก
> - **เพื่อใคร/ทำไม:** เจ้าหน้าที่/ทีมติดตั้งหน้างานต้องรู้ว่าตู้นี้คือเครื่องไหน ผูกศูนย์ไหน IP อะไร โดยไม่ต้องเปิด back-office หรือต่อ SSH
> - **build:** BFF `POST /api/v1/kiosk/device-info` (device credential + PIN) · path ในเครื่อง `POST /api/v1/kiosk/host-info` (scanner client ตอบเอง) · UI แผงข้อมูลบน `/kiosk`
> - **schema/scope:** ไม่เปลี่ยน schema · แก้ requirement ของ CR-150 FR-L6 และ CR-158 FR-32 (ตำแหน่งปุ่มทดสอบการพิมพ์)

สถานะ build: implement แล้วบน branch `feat-kiosk-info-button` ก่อน CR (ข้อเสนอทีม kiosk) — ที่มา: §Why

---

## Requirements

### Server — `POST /api/v1/kiosk/device-info` (api-contract §2.2.1)

- **FR-1** — ยืนยันเครื่องด้วย `X-Device-ID` / `X-Device-Secret` ก่อนตรวจ PIN; ผิด → `401 DEVICE_AUTH_FAILED`.
- **FR-2** — body `{ "pin" }` ตรวจด้วยกติกาเดียวกับ `staff-pin/verify` (CR-158 FR-8..10) และใช้คิวต่อเครื่องเดียวกัน (`staffPinThrottle`) — ผิด `401 staff_pin_invalid` (หน่วง ~1 วินาที) · ไม่มี PIN `409 staff_pin_not_set` · คิวเต็ม `429 RATE_LIMITED` · `scanner_secrets` / registry ใช้ไม่ได้ `503 DEPENDENCY_UNAVAILABLE`.
- **FR-3** — PIN ถูก → `200` body `{ device: { device_id, name, station_name, screen_type }, shelter: { code, name }, staff_pin: { set, is_default, updated_at, updated_by }, banner_group: { id, name } | null }`.
- **FR-4** — response **ไม่มีค่า PIN** และไม่มี `device_ids` ของ banner group; ทุก response มี `cache-control: no-store`.
- **FR-5** — อ่านชื่อศูนย์ไม่สำเร็จ → `shelter.name` = รหัสศูนย์; อ่าน banner group ไม่สำเร็จหรือกลุ่มถูกลบ → `banner_group: null` — ทั้งสองกรณียังตอบ `200` ไม่ใช่ `503`.
- **FR-6** — อ่าน banner group เฉพาะ group doc (ไม่ list เครื่องทั้งศูนย์).
- **FR-7** — log `[scanner-device-info] device=… result=… at=…` หนึ่งบรรทัดต่อผลตรวจ PIN · ห้าม log ค่า PIN.

### ตู้ — `POST /api/v1/kiosk/host-info` (scanner client)

- **FR-8** — scanner client ตอบ path นี้เองในเครื่อง (ไม่ส่งต่อไป server, ไม่แนบ device credential) เฉพาะ same-origin `POST`; อื่น ๆ → `404` ในเครื่อง.
- **FR-9** — ตอบ `200 { "hostname": string | null, "ips": string[] }` (LAN IPv4 ที่ใช้ออกไปหา `TENT_BASE_URL`) · lookup เกิน 2 วินาทีหรือพัง → `{ "hostname": null, "ips": [] }`.
- **FR-10** — เปิดหน้าใน browser ธรรมดา (ไม่มี scanner client) → แผงแสดง `—` สำหรับ hostname/IP.

### UI — แผงข้อมูลเครื่องบน `/kiosk`

- **FR-11** — ปุ่มกลม ℹ aria-label「ข้อมูลเครื่อง」มุมล่างขวา (ตำแหน่งเดิมของปุ่มทดสอบการพิมพ์) → หน้ากรอก PIN 6 หลัก → แผงข้อมูล.
- **FR-12** — หน้า `/kiosk` **ไม่มี** ปุ่มทดสอบการพิมพ์แยกแล้ว (แทน CR-150 FR-L6 ส่วนตำแหน่งปุ่ม).
- **FR-13** — แผงแสดง: ชื่อเครื่อง + Device ID · Hostname · IP address · ศูนย์พักพิง (ชื่อ (รหัส)) · จุดบริการ · PIN เจ้าหน้าที่ · Banner group (ไม่มี = 「ไม่ได้อยู่ในกลุ่ม」) · หน้าจอ.
- **FR-14** — แถว「หน้าจอ」แสดงค่าที่ตั้งใน device management: `compact` → 「ตู้เล็ก · 1024×600」, `portrait` → 「ตู้ใหญ่ · 1080×1920」 · `screen_type` ค่าอื่นจาก server = error (ไม่แสดงแผง).
- **FR-15** — แถว「PIN เจ้าหน้าที่」แสดง PIN เป็น `••••••` + ปุ่มตา (「แสดง PIN」/「ซ่อน PIN」) · PIN ที่แสดง = PIN ที่เจ้าหน้าที่เพิ่งกรอกถูก (server ไม่ส่ง PIN) · ใต้ PIN แสดงสถานะ (「ตั้งแล้ว」/「ยังเป็นค่าเริ่มต้น」) และ「อัปเดต <วันเวลา>」 — **ไม่แสดงผู้แก้ล่าสุด**.
- **FR-16** — ปุ่ม「ทดสอบการพิมพ์」ในแผง พิมพ์ label ตัวอย่างตาม CR-150 FR-L6 (ชื่อ「ทดสอบการพิมพ์」· QR `KIOSK-TEST-PRINT`) ทันทีโดยไม่ถาม PIN ซ้ำ · ระหว่างพิมพ์ปุ่ม「ปิด」และปุ่มพิมพ์กดไม่ได้ · พิมพ์ไม่สำเร็จ → ข้อความ「ทดสอบการพิมพ์ไม่สำเร็จ: …」ในแผง.
- **FR-17** — แผงปิดเองเมื่อไม่มีการแตะ **20 วินาที** (ต้องสั้นกว่า banner attract 30 วินาที — แผงต้องปิดก่อน banner ขึ้นทับ) · แตะในแผง = เริ่มนับใหม่ · ปิด (ปุ่ม / Esc / หมดเวลา) → ล้างข้อมูลและ PIN ออกจากหน้า.
- **FR-18** — Focus: เปิดแผง → focus ที่ปุ่ม「ปิด」· Tab / Shift+Tab วนในแผง · ปิดแผง → focus กลับปุ่ม ℹ.
- **FR-19** — Layout: จอ 1024×600 แผงแสดงครบโดยไม่ต้อง scroll (ข้อมูล 2 คอลัมน์) · จอ 1080×1920 ตัวอักษรและปุ่มขยายสำหรับสัมผัส.

## Acceptance

- **AC-1** กด ℹ → PIN ถูก → เห็นข้อมูลครบตาม FR-13 · PIN ผิด → ไม่เห็นข้อมูล.
- **AC-2** PIN แสดงเป็น `••••••` · กดตาเห็น 6 หลัก · ปิดแล้วเปิดใหม่กลับเป็น `••••••`.
- **AC-3** กด「ทดสอบการพิมพ์」ในแผง → ได้ label ตัวอย่าง 1 ใบ โดยไม่มีหน้า PIN รอบสอง · หน้า `/kiosk` ไม่มีปุ่มพิมพ์กลมแล้ว.
- **AC-4** ทิ้งแผงไว้ 20 วินาที → ปิดเอง ก่อน banner attract ขึ้น.
- **AC-5** ศูนย์/banner group อ่านไม่ได้แต่ PIN ถูก → ยังเห็นแผง (ชื่อศูนย์ = รหัส, group = ไม่ได้อยู่ในกลุ่ม).
- **AC-6** จอ 1024×600 เห็นทุกแถว + ปุ่มทั้งสองโดยไม่ scroll.

## Why

- ทีมติดตั้งหน้างานต้องระบุตู้ (device id, hostname, IP) เพื่อ SSH / แก้ปัญหา และตรวจว่าตู้ผูกศูนย์/จุดบริการ/banner group ถูกหรือไม่ โดยไม่ต้องมีสิทธิ์ back-office.
- server เห็นแค่ IP หลัง NAT จึงให้ตัวตู้ตอบ hostname/LAN IP เอง (FR-8) — แยก path จาก `/api/v1/kiosk/hardware` เพื่อให้ DNS ที่ช้าไม่ถ่วงหน้าที่รอ hardware.
- รวมทดสอบการพิมพ์เข้าแผง: เดิมสองปุ่มต่างคนต่างถาม PIN · หน้างานใช้คู่กัน (ตรวจตู้แล้วลองพิมพ์).
- แสดง PIN จากค่าที่กรอก: เลี่ยงให้ endpoint ส่ง PIN ออกจาก server (คงหลัก "ไม่ echo PIN" ของ CR-158).
- ไม่แสดงผู้แก้ PIN ล่าสุด: ค่าเป็น id ผู้ใช้ ไม่มีประโยชน์หน้าตู้และเปิดเผยตัวตน staff ต่อคนหน้าตู้.
- idle 20 วินาที: review 2026-10-26 พบว่า 60 วินาที (เดิม) ยาวกว่า banner attract 30 วินาที — คนเดินผ่านแตะปิด banner แล้วเจอแผงที่มี PIN ค้างอยู่.

## Impact

- ไม่เปลี่ยน schema / `schema_v` / role · ไม่มี doc type ใหม่.
- api-contract §2.2.1 (ใหม่ — แก้แล้วในรอบนี้ ระบุ "ยังไม่ approved").
- CR-150 FR-L6 / AC-L5 และ CR-158 FR-32 ยังเขียนว่าปุ่มทดสอบการพิมพ์อยู่หน้า `/kiosk` — แก้ข้อความเมื่อ CR นี้ approve (ยังไม่แก้ CR ที่ approved แล้ว).
- Tests: `routes/api/v1/kiosk/device-info/server.test.ts`, `features/kiosk/{application/device-info.svelte.test.ts, application/test-print.svelte.test.ts, data/kiosk-device-info.api.test.ts, data/kiosk-host-info.api.test.ts, ui/kiosk-device-info.dom.test.ts}`, `routes/kiosk/page.render.test.ts`, `kiosk/tests/test_manager.py`.

## Migration

N/A — ไม่มี doc ที่ persist เปลี่ยนรูป. ตู้ที่ยังใช้ scanner client รุ่นก่อนหน้า: `/api/v1/kiosk/device-info` ไม่ถูกแนบ device credential (→ `401`) และ `/host-info` ไม่มีคนตอบ — ต้องอัปเดต `kiosk/` บนตู้พร้อม frontend.

## Decision log

- 2026-10-26 — approved (Soravit Sukkarn, Team Lead) · กำหนดเลขเป็น CR-197
- 2026-10-26 — proposed (ทีม kiosk) · implement ก่อน CR บน `feat-kiosk-info-button` · ปรับจาก review: idle 60→20 วินาที, fail-soft ชื่อศูนย์/banner group, focus management, ตัด "โดย <ผู้แก้>" ออกจากแถว PIN
