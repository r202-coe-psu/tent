---
title: Progress — เชื่อม M5 (ส่งต่อผู้ป่วย) และ M6 (คลังกลาง)
status: in-progress
created: 2026-11-10
updated: 2026-11-12
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
| P0 ปิด CR | 🟡 แผน M5 และ M6 approve แล้ว · เลข CR ออกหลังทดสอบ · M6 D6 รอทีม M6 | — |
| P1 API (FastAPI + BFF + worker tick) | ✅ M5 เสร็จ (`feat/m5-referral`) · ✅ M6 เสร็จ (`feat/m6-central-warehouse`) ยกเว้น `openapi:update` | P0 approve |
| P2 Schema + worker เขียน CouchDB | ✅ M5 เสร็จ · ✅ M6 เสร็จ | P1 |
| P3 UI | ✅ M5 เสร็จ · ✅ M6 เสร็จ (ยังไม่ตรวจใน browser) | P1, P2 |
| P4 Docs sync | ✅ M5 เสร็จ · ✅ M6 เสร็จ | P0 approve |
| P5 ทดสอบ staging → production | 🟡 M5 รอทดสอบ manual กับ M5 staging แล้วเขียน e2e · M6 ทดสอบหน้าจอจริงกับ staging แล้ว (RES-001–006, 008) · รอ RES-007 (ต้องให้ M6 ส่งของ) | P1–P4 |

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
- [x] owner approve แผน implement M5 (2026-11-11) พร้อม D13–D16
  - D13: ค่าเริ่มต้น `acuity` จาก `triage_level` เก่าถ้ามี ไม่มีให้ว่างและบังคับเลือก
  - D14: ตัด FR-B4 / `PATCH batch` — แก้ชุด draft = ถอนแล้วสร้างใหม่
  - D15: stamp `schema_v` 3 เฉพาะใบ `m5` ใบ tracking คง v2
  - D16: `medical_staff` เห็นเฉพาะ referral `medical-emergency`
- [x] owner ตัดสิน D17 (2026-11-11): เมนู OneData Platform ใน Portal + Sidebar (M5, M6 "เร็วๆ นี้") · M5 มีหน้าของตัวเอง · ข้อความ end-user ใช้ "OneData ระบบส่งต่อผู้ป่วย (M5)" / "OneData ระบบบริหารทรัพยากร (M6)" · เมนูส่งต่อเดิมคงไว้สำหรับ tracking
- [x] owner ยืนยันข้อเสนอใน D17 (2026-11-11): ตัดตัวเลือก "ส่งผ่าน M5" ออกจากฟอร์มเดิม + กล่องแนะนำ OneData
- [x] owner approve แผน implement M6 (2026-11-12) พร้อม D18 และยืนยัน D2
  - D18: หน้าอยู่ที่ `/back-office/onedata/m6` · BFF คง `/api/back-office/central-warehouse/*`
  - D2: SA, SM, `warehouse_staff` เท่านั้น — ไม่รวม `supply_coordinator`
  - D6: ใช้ค่าเริ่มต้นจนกว่าทีม M6 ตอบ
- [x] owner ตัดสิน M6 D19, D20 (2026-11-12)
  - D19: ใบ `m6` ปฏิเสธ / ส่งต่อ / ไม่รับทุกบรรทัดไม่ได้ (`422 M6_NOT_REFUSABLE`) — ของที่ขาดบันทึกเป็น "รับไม่ครบ"
  - D20: "ปิดใบ — ไม่ได้รับของ" → `received` + `received_summary.nothing_received` · RES-007 note "ไม่ได้รับของ"
- [ ] ส่งคำถาม M6 D6 ให้ทีม M6
- [ ] ขอ credential staging
  - [x] M5: scope `transfer-write` (ได้แล้ว, module `M4`)
  - [x] M6: credential staging ใช้ได้ (spike 2026-11-12: AUTH-001/002, RES-001–003) · scope `request` ใช้ได้ (RES-005, RES-008) · `confirm` ยังไม่ได้ยิงจริง
- [ ] M5: ให้เลข CR-NNN หลังทดสอบ manual บน staging ผ่าน → ย้ายไฟล์ และเพิ่มใน `docs/changes/_index.md`
- [ ] M6: ให้เลข CR-NNN หลังทดสอบบน M6 staging ผ่าน → ย้ายไฟล์ และเพิ่มใน `docs/changes/_index.md`

## P1 — API (FastAPI + BFF + worker tick)

**M5:** ทำครบทุก phase บน branch เดียว `feat/m5-referral` (merge `develop` ล่าสุดแล้ว) และจะเปิด PR เดียวเข้า `develop` ตอนจบ (owner สั่ง 2026-11-11 · PR #1329, #1330 ที่แยกรายเฟสปิดไปแล้ว) · endpoint และ error mapping ดู CR §5 และ `api-contract.md` §2.10, §5.4

**M6:** ทำครบ P1–P4 บน branch เดียว `feat/m6-central-warehouse` (แตกจาก `feat/m5-referral`) · endpoint และ error mapping ดู CR §6 และ `api-contract.md` §2.11, §5.4

**ต่างจากแผนเดิม (M6):**
- หน้าอยู่ที่ `/back-office/onedata/m6` (D18) แทน `/back-office/central-warehouse` · BFF คง `/api/back-office/central-warehouse/*`
- ไม่ได้ทำ `apiapp/infrastructure/outbound/` ร่วมกับ M5 — `integrations_m6/client.py` (`HttpM6Client`) แยกเพราะ M6 ใช้ refresh grant (AUTH-002 + refresh token หมุน) · route `/v1/integrations/status` ยังอยู่ใน `integrations_m5/router.py` แต่ตอบ `{m5, m6}`
- health gate ฝั่ง frontend ย้ายจาก `referrals` ไป feature ใหม่ `integrations` (`useIntegrationStatus`, `integration-gate-alert.svelte`) ใช้ร่วม M5 / M6
- error ของ M6 ใช้ code ขึ้นต้น `M6_` ทุกตัว (`M6_ITEM_NOT_IN_WAREHOUSE`, `M6_BAD_REQUEST`, …) แทน "code เดิม" ในร่าง
- D19: ใบ `m6` ปฏิเสธ / ส่งต่อ / ไม่รับทุกบรรทัดไม่ได้ (`422 M6_NOT_REFUSABLE`)
- D20: "ปิดใบ — ไม่ได้รับของ" (ข้อยกเว้นของ CR-206 FR-MP-28 เฉพาะ `m6`)
- `supply_coordinator` ถูกเอาออกจากเมนู M6 (navbar + portal) ที่ D17 เคยแสดง — guard ใหม่ `canAccessCentralWarehouse` / `requireCentralWarehouseAccess`
- worker สร้าง donation ทั้งตอน `in_transit` และ `received` (กรณีพลาดสถานะ `in_transit`) · ไม่ expire อยู่ใน `quota/expiry.py` (ไม่ใช่ `donation_status.py`)
- donation `public` จาก worker ก็ stamp `schema_v` 12 (ให้ตรงกับ walk-in)

**ต่างจากแผนเดิม (M5):**
- ไม่ได้ทำ `apiapp/infrastructure/outbound/` ที่ใช้ร่วมกัน — client ของ M5 อยู่ใน `apiapp/modules/integrations_m5/client.py` (`HttpM5Client` + token cache ต่อ process) · แยกส่วนที่ใช้ร่วมออกมาตอนทำ M6
- worker tick อยู่ใน `worker/src/worker/inbound/m5_transfers.py` (loop เดียวกับการ apply) ไม่ได้แยกเป็น `integrations_tick.py`
- `external_ref_in_use` → FastAPI ดึงใบเดิมแล้วบันทึกเอง แทนการรอ worker

### PR1 — core

- [x] Mongo models ใน `tent_model` — M5: `m5_transfers`, `m5_outbound_logs`
- [x] Mongo models ใน `tent_model` — M6: `m6_withdrawals`, `m6_confirm_outbox`, `m6_outbound_logs`
- [x] settings และ env — `M5_*` ใน `core/config.py`, `.env.example`, compose 5 ไฟล์ (fastapi + worker)
- [x] settings และ env — `M6_*` ใน `core/config.py`, `.env.example`, compose 5 ไฟล์ + worker `M6_SYNC_INTERVAL_S`
- [x] ย้าย `httpx` ไปอยู่ใน runtime dependency
- [x] client ของ M5: token cache ต่อ process, 401 ลองซ้ำ 1 ครั้ง, circuit 5 นาที, outbound log
- [x] client ของ M6: access + refresh token (AUTH-002, refresh หมุน), 401 ลองซ้ำ 1 ครั้ง, circuit 5 นาที, outbound log
- [ ] ~~`apiapp/infrastructure/outbound/` ใช้ร่วมกับ M6~~ — ไม่ทำ: client แยกต่อระบบ (ดู "ต่างจากแผนเดิม (M6)")
- [x] `GET /v1/integrations/status` ตอบ `{m5, m6}`

### PR2 — `integrations_m5`

- [x] facilities (TRF-001)
- [x] transfers create (TRF-002) — หลายผู้ป่วยต่อใบ, idempotent, กู้คืนเมื่อ `external_ref_in_use`
- [x] transfers detail (TRF-004)
- [x] start (TRF-005)
- [x] cancel (TRF-006)
- [x] sync (TRF-003 + TRF-004)
- [x] tests `backend/tests/test_integrations_m5.py` (24) + ยิง status / facilities / sync กับ M5 staging จริง

### PR3 — `integrations_m6`

- [x] warehouses (RES-001)
- [x] stock (RES-002)
- [x] catalog (RES-003)
- [x] withdrawals create (RES-005) — idempotent ตาม `external_ref`, replay ตอบจาก Mongo
- [x] withdrawals list / detail (RES-006)
- [x] cancel (RES-008)
- [x] sync (RES-006 + RES-007 จาก outbox, backoff 30 วินาที × 2ⁿ สูงสุด 1 ชั่วโมง)
- [x] tests `backend/tests/test_integrations_m6.py` (42) + spike RES-001–003 กับ M6 staging จริง

### PR4 — BFF

- [x] `lib/server/integrations.ts`: timeout, `CENTRAL_UNAVAILABLE`, `mapM5State`, `mapM6State` (`resource_types` ว่าง = `m6_credential_invalid`)
- [x] `GET /api/back-office/integrations/status` — ตอบ `{m5, m6}` · รับทั้งกลุ่ม referral และกลุ่มคลังกลาง
- [x] `GET /api/back-office/referral/m5/facilities`
- [x] `/api/back-office/central-warehouse/*` ทั้งชุด พร้อม `authorizeCentralWarehouse` (M6) — warehouses, stock, catalog, withdrawals list / create / detail / cancel
- [x] `buildM6WithdrawalPayload` ใน domain `central-warehouse.payload.ts` + orchestration ใน `central-warehouse/server/withdrawal.server.ts` (`422 SHELTER_LOCATION_MISSING`)
- [x] `buildM5TransferPayload` ใน domain `referral.m5.ts` + orchestration ใน `server/referral.m5.server.ts`

### PR5 — worker tick

- [x] worker เคาะ `/v1/integrations/m5/sync` ทุก `M5_SYNC_INTERVAL_S` (default 45) — `inbound/m5_transfers.py`
- [x] worker เคาะ `/v1/integrations/m6/sync` ทุก `M6_SYNC_INTERVAL_S` (default 45) — `inbound/m6_withdrawals.py` (loop เดียวกับการ apply และการเขียน outbox)

### หลัง PR1–PR3

- [x] `pnpm openapi:update` หลัง M5 (7 path ใหม่)
- [ ] `pnpm openapi:update` หลัง M6

## P2 — Schema + worker เขียน CouchDB

- [x] referral `schema_v` 3
  - field ใหม่: `dispatch_mode`, `batch_id`, `to_org.m5_facility_id`, `acuity`, `transport`, `requester_contact`, `external`
  - Zod schema และ reader v1–v3 · stamp v3 เฉพาะใบ `m5` (D15) · ปิดใบ v3 ไม่ลดเป็น v2
- [x] guard `EXTERNALLY_MANAGED` (`assertM5TransitionAllowed`) และกฎถอนทั้งชุด
- [x] BFF สร้างชุด `POST batch` (FR-B2/B3) และรายชุด `batch/[batch_id]/m5/{submit,start,cancel}` (+ `resubmit_without`)
- [x] สิทธิ์ `medical_staff` ใน BFF (D8, D16)
- [x] กฎ bulk-transition (CR-167) — ใบ `m5` ถอนทั้งชุดผ่าน M5 (D11)
- [ ] กฎ shelter closure (CR-168) — worker ของ CR-168 ยังไม่ได้สร้างในโค้ด ต้องใช้กฎ D11 เดียวกันตอนสร้าง
- [x] worker loop `m5_transfers` → `central_ops` (ทุก referral ใน `referral_ids[]`, CAS `applied_rev`)
- [x] worker: ซ่อมใบที่ค้าง `draft` (D7) และเขียน movement `leave_temporary` ลง `shelter_{code}` เมื่อ `in_transit` (D9)
- [x] tests: domain `referral.m5.test.ts`, server `referral.m5.server.test.ts`, `integrations.test.ts`, worker `test_m5_transfers_inbound.py` (12)
- [x] donation `schema_v` 12
  - `channel: m6`
  - `external`
  - `received_summary.nothing_received` (D20)
  - ข้อยกเว้นของ `phone_hash` และ `_id`
  - worker `public` stamp 12 ด้วย (ตรงกับ walk-in)
- [x] worker loop `m6_withdrawals` (`in_transit` / `received`) → donation `donation:m6-{request_code}` (จับคู่ `item_master.sku`, CAS `applied_rev`)
- [x] worker: donation `m6` ที่ `received` → `m6_confirm_outbox` (`note` สรุปที่ขาด / "รับครบ" / "ไม่ได้รับของ")
- [x] `quota/expiry.py` ข้าม `m6`
- [x] projector ไม่ project `m6`
- [x] BFF donation: `422 M6_NOT_REFUSABLE` ที่ reject / redirect / ไม่รับทุกบรรทัด (D19) · `…/close` ปิดแบบไม่ได้รับของ (D20, `closeM6Donation`)
- [x] tests: worker `test_m6_withdrawals_inbound.py` (26), `test_donation_expiry.py`, `test_donation_projector.py` · frontend `central-warehouse` domain / server / ui, `server.test.ts` ของ BFF, `close.test.ts`, `reject.test.ts`, `redirect.test.ts`, `integrations.test.ts`

## P3 — UI

- [x] `useIntegrationStatus` และ alert ของ health gate (`m5-gate-alert.svelte`)
- [x] ฟอร์ม medical referral (`m5-referral-form.svelte` ใน `referral-create-form.svelte`)
  - ตัวเลือกโหมด tracking / M5
  - เลือกผู้ป่วยเป็นชุด
  - facility picker
  - acuity รายคน (ค่าเริ่มต้นจาก `triage_level` เก่า, D13)
  - transport
  - requester contact
- [x] หน้ารายละเอียดชุด M5 (`m5-batch-panel.svelte` บน `/back-office/referrals/[id]/batch`)
  - `external.status` และ review
  - ส่งไป M5 (ชุด draft), แจ้งรถออก
  - ถอนทั้งชุด / ถอนแล้วส่งใหม่
- [x] `medical_staff`: route guard `requireReferralAccess`, เมนู navbar และ portal, เห็นเฉพาะประเภทการแพทย์ในฟอร์ม
- [x] D17 เมนู OneData Platform
  - Portal แผนก `onedata` และ Sidebar กลุ่ม "4. OneData Platform" (ตั้งค่าระบบเลื่อนเป็น 5)
  - หน้า `/back-office/onedata/m5` (รายการ `dispatch_mode=m5`), `/back-office/onedata/m5/new` (`m5-referral-create.svelte`) และ `/back-office/onedata/m5/{id}` (หน้าชุด `referral-batch-view.svelte` ใช้ร่วมกับ `/back-office/referrals/{id}/batch`)
  - ฟอร์มเดิมตัดตัวเลือกโหมด เหลือ tracking + กล่องแนะนำ OneData
  - เมนู M6 เป็น placeholder "เร็วๆ นี้" (แทนด้วยหน้า M6 แล้ว 2026-11-12)
- [ ] ตรวจหน้าจอจริงใน browser (ตอนนี้ผ่านแค่ type-check + `svelte-autofixer`)
- [x] health gate ย้ายเป็น feature `integrations` (`useIntegrationStatus('m5' | 'm6')`, `integration-gate-alert.svelte`) ใช้ร่วม M5 / M6
- [x] `/back-office/onedata/m6` 4 แท็บ (D18)
  - คลังกลาง
  - ค้นหาของ
  - ตะกร้าขอเบิก
  - คำขอของศูนย์
- [x] เมนู M6 ใน navbar + portal ชี้ `/back-office/onedata/m6` · SA, SM, `warehouse_staff` เท่านั้น (`supply_coordinator` ไม่เห็น — D2) · guard `requireCentralWarehouseAccess`
- [x] donation UI
  - แสดงที่มา "คลังกลาง M6 · {คลัง}" (รอประเมิน, กำลังตรวจรับ, รับแล้ว, scan station)
  - แสดงสถานะการยืนยันกับ M6
  - ปุ่ม "ปิดใบ — ไม่ได้รับของ" (`close-m6-empty-dialog.svelte`, D20)
- [ ] ตรวจหน้า M6 และ donation `m6` ใน browser

## P4 — Docs sync (หลัง approve)

- [x] `docs/data/schema.md` — M5: §1.4 movement ของ worker, §5.4 referral v3, §9.9 `m5_transfers`, §9.10 `m5_outbound_logs`
- [x] `docs/data/schema.md` — M6: §2.3 donation v12 + "ใบ `m6`", §9.11 `m6_withdrawals`, §9.12 `m6_confirm_outbox`, §9.13 `m6_outbound_logs`
- [x] `docs/data/api-contract.md` — M5: §2.10 BFF, §5.4 FastAPI `/v1/integrations`
- [x] `docs/data/api-contract.md` — M6: §2.11 BFF คลังกลาง, §2.10 status `{m5, m6}`, §5 donation `m6` (D19, D20), §5.4 FastAPI `/v1/integrations/m6/*`
- [x] ADR-0003 outbound integration plane
- [x] ADR-0003 — หัวข้อ M6 (client แยก, refresh grant, outbox)
- [x] `docs/sitemap.md` — หน้า `/back-office/onedata/m6` (M6, D18)
- [x] `docs/prd/role-permission-matrix.md` — แถว referral ทางการแพทย์ของ MED (M5)
- [x] `docs/prd/role-permission-matrix.md` — แถว Central Warehouse (M6): SA / SM / WS
- [x] `docs/task-breakdown/09-F-referral.md`
  - DoD ข้อยกเว้น PDPA
  - scope release ปัจจุบัน
- [x] `docs/task-breakdown/04-donation.md` — T-16 DoD donation `channel: m6`
- [x] ร่าง CR M6: D19, D20, ผล spike, affects, เปลี่ยนจากร่าง

## P5 — ทดสอบ staging → production

- [x] spike API กับ M5 staging (AUTH-001, TRF-001 ถึง TRF-006) — 2026-11-11
- [ ] ทดสอบ manual end-to-end กับ M5 staging: ส่งชุด → รอ สธ. อนุมัติ → แจ้งรถออก → ถึงโรงพยาบาล → ถอน (ต้องมีคนกดอนุมัติฝั่ง M5)
- [ ] Playwright e2e ของ M5 (mock BFF) — เขียนหลังทดสอบ manual
- [ ] เปิด PR เดียว `feat/m5-referral` → `develop`
- [x] spike API กับ M6 staging (AUTH-001, AUTH-002, RES-001 ถึง RES-003) — 2026-11-12
- [x] ทดสอบหน้าจอจริงกับ M6 staging (SA, SM, `warehouse_staff`, `supply_coordinator`): ดูคลัง ค้นของ ตะกร้า ส่งคำขอ (RES-005) ติดตาม (RES-006) ยกเลิก (RES-008) และ health gate — 2026-11-12
- [ ] E2E กับ M6 staging: ขอเบิก → อนุมัติ → `in_transit` → รับของ → ยืนยันกลับ
- [ ] Playwright e2e ของ M6 (mock BFF)
- [ ] เปิด PR `feat/m6-central-warehouse` → `develop` (หลัง PR ของ M5)
- [ ] ขอ credential production ตามเงื่อนไขของ M5 และ M6
- [ ] เปิด env production ตามลำดับ deploy: reader ก่อน แล้วจึง writer, worker loop และ env

## Log

- 2026-11-10 — ร่าง CR ทั้งสองและบันทึกคำตัดสิน D1–D4 (M5) และ D1–D5 (M6) ตัดสินให้ P1 เริ่มหลัง CR approve
- 2026-11-11 — grill CR M5 รอบที่ 1: owner ตัดสิน D6–D12 และบันทึกลงร่าง CR · เริ่มทำ M5 ก่อน M6
- 2026-11-11 — M5 D5 ข้อ 3 (พิกัดเป็น Number) และข้อ 4 (ไม่มี webhook) ตอบแล้ว
- 2026-11-11 — owner approve แผน implement M5 (D13–D16) · spike บน M5 staging ปิด D5 ครบ
- 2026-11-11 — M5 implement ครบ Phase 1–5 และ docs sync บน branch เดียว `feat/m5-referral` (PR เดียวตอนจบ) · เหลือทดสอบ manual กับ M5 staging, e2e, เลข CR
- 2026-11-11 — merge `develop` ล่าสุดเข้า `feat/m5-referral` (แทน rebase เพื่อไม่ต้อง force-push) · อัปเดต checklist ราย item ของ M5
- 2026-11-11 — D17: เพิ่มเมนู OneData Platform (Portal + Sidebar) และหน้า OneData M5 แยกจากเมนูส่งต่อเดิม · เปลี่ยนข้อความ end-user จาก M5 เป็น OneData · ตรวจหน้าจอจริงใน browser แล้ว (SA, `medical_staff`, `supply_coordinator`) ยกเว้นการส่งเข้า M5 staging จริง
- 2026-11-12 — owner approve แผน implement M6 พร้อม D18 (`/back-office/onedata/m6`) · ยืนยัน D2 ไม่รวม `supply_coordinator` · D6 ใช้ค่าเริ่มต้น · แตก branch `feat/m6-central-warehouse` จาก `feat/m5-referral`
- 2026-11-12 — spike บน M6 staging: AUTH-001/002 (refresh token หมุน), RES-001/002/003 ผ่าน · qty มาเป็น float (`469.0`) · `district` เป็น `null` ได้ · `resource_types` มี `genaral`
- 2026-11-12 — owner ตัดสิน D19 (ใบ `m6` ปฏิเสธ / ส่งต่อไม่ได้ — `M6_NOT_REFUSABLE`) และ D20 ("ปิดใบ — ไม่ได้รับของ" → `received` + `nothing_received`, RES-007 note "ไม่ได้รับของ")
- 2026-11-12 — M6 implement P1–P3 (Mongo models, FastAPI `integrations_m6`, BFF `central-warehouse`, worker loop + expiry + projector, donation v12 + UI, หน้า OneData M6, เมนูตัด `supply_coordinator`) และ docs sync P4 · เหลือ `pnpm openapi:update`, ตรวจใน browser, ทดสอบ RES-005–008 กับ M6 staging, e2e, PR, เลข CR
