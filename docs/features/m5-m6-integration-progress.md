---
title: Progress — เชื่อม M5 (ส่งต่อผู้ป่วย) และ M6 (คลังกลาง)
status: in-progress
created: 2026-11-10
updated: 2026-11-11
track: draft-referral-m5-hospital-integration, draft-central-warehouse-m6-withdrawal
---

# Progress — เชื่อม M5 และ M6

ไฟล์นี้ใช้ติดตามความคืบหน้า ไม่ใช่ spec รายละเอียดที่ผูกพันอยู่ในร่าง CR สองฉบับ:

- [draft-referral-m5-hospital-integration](../changes/draft-referral-m5-hospital-integration.md) — ส่งต่อผู้ป่วย `medical-emergency` ไปโรงพยาบาลผ่าน M5
- [draft-central-warehouse-m6-withdrawal](../changes/draft-central-warehouse-m6-withdrawal.md) — หน้าคลังกลาง ขอเบิกของจาก M6 และรับของเข้าศูนย์ผ่าน donation channel `m6`

ทั้งสองใช้ outbound plane เดียวกัน:

```
browser → SvelteKit BFF → FastAPI /v1/integrations/* → M5 / M6
```

- credential ของ M5 และ M6 อยู่ใน FastAPI ที่เดียว
- health gate ใช้ร่วมกันที่ `/v1/integrations/status`
- sync worker เคาะ `POST /v1/integrations/{m5,m6}/sync` เป็นระยะ

## สรุปสถานะ

| Phase | สถานะ | ขึ้นกับ |
|---|---|---|
| P0 ปิด CR | 🟡 กำลังทำ | — |
| P1 API (FastAPI + BFF + worker tick) | ⏸ รอ | P0 approve |
| P2 Schema + worker เขียน CouchDB | ⏸ รอ | P1 |
| P3 UI | ⏸ รอ | P1, P2 |
| P4 Docs sync | ⏸ รอ | P0 approve |
| P5 ทดสอบ staging → production | ⏸ รอ | P1–P4 |

## P0 — ปิด CR

- [x] owner ตัดสิน M5 D1–D4 (2026-11-10)
  - D1: ส่งเลขบัตรและอาการพร้อม log
  - D2: ทำทันที
  - D3: staff เลือกโหมด `tracking` / `m5` ต่อใบ
  - D4: รวมหลายผู้ป่วยในใบเดียว (`batch_id`) และถอนทั้งชุดแล้วส่งใหม่
- [x] grill CR M5 รอบที่ 1 — owner ตัดสิน D6–D12 (2026-11-11)
  - D6: ฟอร์มเดียวสร้างทั้งชุด · "ส่งข้อมูล" = สร้างแล้ว submit ต่อทันที
  - D7: worker ซ่อมใบที่ค้าง `draft` จาก `m5_transfers`
  - D8: เพิ่ม `medical_staff` ให้ทำ action ของ referral `medical-emergency`
  - D9: worker เขียน `leave_temporary` เมื่อ M5 = `in_transit`
  - D10: ไม่มีเลขบัตร/อายุส่งได้ (fallback ของ D5-2)
  - D11: bulk ถอนใบ `m5` ทั้งชุด
  - D12: ไม่จำกัดจำนวนผู้ป่วยต่อชุด (fallback ของ D5-5)
- [x] owner ตัดสิน M6 D1–D5 (2026-11-10)
  - D1: สร้าง donation ตอน `in_transit`
  - D2: SA + `shelter_manager` + `warehouse_staff`
  - D3: จับคู่ด้วย `sku` และ `free_text`
  - D4: ไม่แสดงบน public plane
  - D5: `phone_hash` ว่าง และ `_id = donation:m6-{request_code}`
- [x] บันทึกคำตัดสินลงร่าง CR ทั้งสอง
- [x] M5 D5 ข้อ 3–4 ตอบแล้ว (2026-11-11): พิกัดส่งเป็น Number · ไม่มีแผนทำ webhook
- [x] M5 D5 ข้อ 1, 2, 5 ยืนยันจาก spike บน M5 staging (2026-11-11)
- [ ] ส่งคำถาม M6 D6 ให้ทีม M6
- [ ] ขอ credential staging
  - [x] M5: scope `transfer-write` (ได้แล้ว, module `M4`)
  - M6: scope `read`, `request`, `confirm` และ `resource_types` ที่ต้องใช้
- [ ] owner approve CR ทั้งสอง → ให้เลข CR-NNN, ย้ายไฟล์ และเพิ่มใน `docs/changes/_index.md`

## P1 — API (FastAPI + BFF + worker tick)

M5 ทำก่อน ทีละ PR แยกจาก `develop`: `feat/m5-fastapi` → `feat/m5-referral-domain` → `feat/m5-referral-bff` → `feat/m5-worker` → `feat/m5-referral-ui` (แผนเต็มอยู่ใน Decision log ของร่าง CR M5) · M6 ทำทีหลัง โดยแบ่งเป็น PR ละเรื่อง endpoint และ error mapping ดูใน CR §5 (M5) และ §6 (M6) ส่วน UI ยังไม่ทำใน phase นี้

### PR1 — core

- [ ] Mongo models ใน `tent_model`
  - `m5_transfers`
  - `m6_withdrawals`
  - `m6_confirm_outbox`
  - `m5_outbound_logs` และ `m6_outbound_logs`
- [ ] settings และ env
  - `M5_*`, `M6_*`
  - `.env.example`
  - compose 5 ไฟล์
- [ ] ย้าย `httpx` ไปอยู่ใน runtime dependency
- [ ] `apiapp/infrastructure/outbound/`
  - `TokenManager` (M6 refresh grant)
  - `OutboundClient`: 401 ลองซ้ำ, circuit, log
- [ ] `GET /v1/integrations/status`

### PR2 — `integrations_m5`

- [ ] facilities (TRF-001)
- [ ] transfers create (TRF-002) — หลายผู้ป่วยต่อใบ
- [ ] transfers detail (TRF-004)
- [ ] start (TRF-005)
- [ ] cancel (TRF-006)
- [ ] sync (TRF-003 + TRF-004)

### PR3 — `integrations_m6`

- [ ] warehouses (RES-001)
- [ ] stock (RES-002)
- [ ] catalog (RES-003)
- [ ] withdrawals create (RES-005)
- [ ] withdrawals list / detail (RES-006)
- [ ] cancel (RES-008)
- [ ] sync (RES-006 + RES-007 จาก outbox)

### PR4 — BFF

- [ ] `lib/server/integrations.ts`: timeout, `CENTRAL_UNAVAILABLE`, `mapIntegrationState`
- [ ] `GET /api/back-office/integrations/status`
- [ ] `GET /api/back-office/referral/m5/facilities`
- [ ] `/api/back-office/central-warehouse/*` ทั้งชุด พร้อม `authorizeCentralWarehouse`
- [ ] server helper `referral.m5.ts` (`buildM5TransferPayload`)

### PR5 — worker tick

- [ ] `integrations_tick.py` เคาะ `/sync` ทุก 45 วินาที

### หลัง PR1–PR3

- [ ] `pnpm openapi:update`

## P2 — Schema + worker เขียน CouchDB

- [ ] referral `schema_v` 3
  - field ใหม่: `dispatch_mode`, `batch_id`, `to_org.m5_facility_id`, `acuity`, `transport`, `requester_contact`, `external`
  - Zod schema และ reader v1–v3
- [ ] `referral.transitions`
  - guard `EXTERNALLY_MANAGED`
  - กฎถอนทั้งชุด
- [ ] BFF รายชุด
  - `batch/[batch_id]/m5/submit`
  - `start`
  - `cancel` (+ `resubmit_without`)
- [ ] กฎ bulk-transition (CR-167) และ shelter closure (CR-168)
- [ ] worker loop `m5_transfers` → `central_ops` (ทุก referral ใน `referral_ids[]`)
- [ ] worker: ซ่อมใบที่ค้าง `draft` (D7) และเขียน movement `leave_temporary` ลง `shelter_{code}` เมื่อ `in_transit` (D9)
- [ ] donation `schema_v` 12
  - `channel: m6`
  - `external`
  - ข้อยกเว้นของ `phone_hash` และ `_id`
- [ ] worker loop `m6_withdrawals` (`in_transit`) → donation `donation:m6-{request_code}`
- [ ] worker: donation `m6` ที่ `received` → `m6_confirm_outbox`
- [ ] `quota/expiry.py` ข้าม `m6`
- [ ] projector ไม่ project `m6`

## P3 — UI

- [ ] `useIntegrationStatus` และ alert "เชื่อมต่อกับระบบกลางไม่ได้"
- [ ] ฟอร์ม medical referral
  - ตัวเลือกโหมด tracking / M5
  - เลือกผู้ป่วยเป็นชุด
  - facility picker
  - acuity รายคน
  - transport
  - requester contact
- [ ] หน้ารายละเอียดชุด M5
  - `external.status` และ review
  - แจ้งรถออก
  - ถอนทั้งชุด / ถอนแล้วส่งใหม่
- [ ] `/back-office/central-warehouse` 4 แท็บ
  - คลังกลาง
  - ค้นหาของ
  - ตะกร้าขอเบิก
  - คำขอของศูนย์
- [ ] donation UI
  - แสดงที่มา "คลังกลาง M6 · {คลัง}"
  - แสดงสถานะการยืนยันกับ M6

## P4 — Docs sync (หลัง approve)

- [ ] `docs/data/schema.md` §2.3, §5.4, §9
- [ ] `docs/data/api-contract.md`
- [ ] ADR-0003 outbound integration plane (หรือเพิ่มใน ADR-0002)
- [ ] `docs/sitemap.md` — หน้า `/back-office/central-warehouse`
- [ ] `docs/prd/role-permission-matrix.md` — สิทธิ์คลังกลาง
- [ ] `docs/task-breakdown/09-F-referral.md`
  - DoD ข้อยกเว้น PDPA
  - scope release ปัจจุบัน

## P5 — ทดสอบ staging → production

- [ ] E2E กับ M5 staging: ส่งชุด → รอ สธ. อนุมัติ → แจ้งรถออก → ถึงโรงพยาบาล → ถอน
- [ ] E2E กับ M6 staging: ขอเบิก → อนุมัติ → `in_transit` → รับของ → ยืนยันกลับ
- [ ] ขอ credential production ตามเงื่อนไขของ M5 และ M6
- [ ] เปิด env production ตามลำดับ deploy: reader ก่อน แล้วจึง writer, worker loop และ env

## Log

- 2026-11-10 — ร่าง CR ทั้งสองและบันทึกคำตัดสิน D1–D4 (M5) และ D1–D5 (M6) ตัดสินให้ P1 เริ่มหลัง CR approve
- 2026-11-11 — grill CR M5 รอบที่ 1: owner ตัดสิน D6–D12 และบันทึกลงร่าง CR · เริ่มทำ M5 ก่อน M6
- 2026-11-11 — M5 D5 ข้อ 3 (พิกัดเป็น Number) และข้อ 4 (ไม่มี webhook) ตอบแล้ว
- 2026-11-11 — owner approve แผน implement M5 (D13–D16) · spike บน M5 staging ปิด D5 ครบ
