---
id: CR-079
title: เพิ่ม SOP what-if simulation แบบไม่เขียนทับ Daily Calc
status: approved
date: 2026-08-19
created: 2026-08-19
updated: 2026-08-26
requested_by: T-42 / project owner
decided_by: project owner (2026-08-21)
depends:
  - T-31 — daily resource calculation engine
layer: volatile
affects:
  - docs/data/schema.md §2.20 — เพิ่ม document type `simulation:{ulid}`, schema_v 1
  - docs/prd/role-permission-matrix.md FR-54 — shelter_manager / system_admin scope
  - frontend/src/lib/features/sop-simulation/
  - frontend/src/lib/server/shelter-access-design.ts — validator allowlist/invariants
why: ให้ผู้บริหารจำลอง occupancy, จำนวนวัน และ SOP ratio ล่วงหน้าโดยใช้ engine เดียวกับ T-31 และไม่เปลี่ยน Daily Calc จริง
migration: ไม่มี migration ของเอกสารเดิม; เป็น document type ใหม่ แต่ฐานข้อมูลเดิมต้องได้รับ validator ที่รองรับ `simulation` ก่อนเปิดใช้งาน
---

# CR-079 — เพิ่ม SOP what-if simulation แบบไม่เขียนทับ Daily Calc

## Why

T-31 มี engine คำนวณความต้องการทรัพยากรรายวัน แต่ยังไม่มี planning flow สำหรับคำถาม เช่น
ผู้พักพิงเพิ่มเป็น 2,000 คน, น้ำท่วมต่อเนื่อง 14 วัน หรือมีการเปลี่ยน ratio ชั่วคราว.

การนำค่าจำลองไปเขียนใน `daily_calc` จะปะปนกับผลจริงของศูนย์ และการทำสูตรแยกใน T-42
จะทำให้ผลจำลอง drift จาก T-31. จึงเสนอให้เพิ่ม simulation เป็น read-only calculation flow
และเก็บผลที่บันทึกไว้ใน document type แยก.

## Change

1. เพิ่ม Scenario input: `name`, `occupancy`, `days` (1–365) และ partial `ratio_overrides`
   ที่ใช้ canonical ratio keys ของ T-31.
2. รัน Current และ Scenario จาก logical input snapshot เดียวกัน ผ่าน engine T-31 เดียวกัน
   โดยไม่ fork สูตรและไม่เขียน `daily_calc`.
3. เพิ่ม comparison ของ Current → Scenario สำหรับ daily need, horizon need, available, gap และ delta
   โดยใช้ semantics `ResourceKind` ของ T-31.
4. เพิ่ม Saved Scenario เป็น immutable-on-update `simulation:{ulid}` (`schema_v: 1`) ใน shelter database
   แยกจาก `daily_calc`; Open อ่านผลเดิมโดยไม่ rerun engine. ผู้มีสิทธิ์สามารถลบเอกสารด้วย
   authorized tombstone ได้ โดยไม่แก้ผล snapshot และไม่แตะ `daily_calc`.
5. จำกัดการใช้งานตาม shelter scope: `shelter_manager` ของศูนย์ตนเอง และ `system_admin`
   ตามศูนย์ที่เลือก.
6. เพิ่มหน้า Back Office และ application contract สำหรับกรอก, รัน, เปรียบเทียบ, บันทึก และเปิด Scenario.

## Scope boundaries

- ไม่เปลี่ยนสูตร, resource keys, rounding หรือ `ResourceKind` ของ T-31.
- ไม่แก้ occupancy, active SOP, stock, facilities หรือ `daily_calc` จากหน้า Scenario.
- ไม่ทำ forecast ที่ occupancy เปลี่ยนรายวัน, chart, export, sharing หรือ edit history ในรอบนี้.
- ไม่เพิ่ม public HTTP API ใหม่ใน scope นี้; `ScenarioInput`/application contract เป็น API ภายในของ feature.
  หากต้องการ public HTTP API ต้องเปิด scope/CR เพิ่มก่อน implementation.

## Impact

### Data contract

- เพิ่ม `simulation:{ulid}` schema_v 1 ใน `docs/data/schema.md` §2.20.
- ไม่ bump schema version ของ `daily_calc` และไม่มี backfill เอกสารเดิม.
- ต้องเพิ่ม `simulation` ใน shelter access validator พร้อมกฎ shelter scope, immutable update,
  authorized delete และ shape ของ frozen result.

### Application

- ใช้ shared read-only input loader กับ T-31 เพื่อให้ Current และ Scenario ใช้ source เดียวกัน.
- เพิ่ม domain schema, runner, repository, saved-list query และ UI route.
- Save เป็น explicit action เท่านั้น; Run/Open ไม่ persist และไม่แตะ Daily Calc.

### Verification required after approval

- PR review เทียบกับ CR นี้และตรวจว่าไม่มีสูตรคำนวณซ้ำจาก T-31.
- Automated tests: schema/input validation, flood scenario 2,000 คน/14 วัน, save/load,
  tenant isolation และ proof ว่า `daily_calc` body/`_rev`/audit ไม่เปลี่ยน.
- UI verification: role access, form validation, Current/Scenario compare, ratio override,
  save/open/retry/pagination และ semantics ของ multiply/divide/threshold.
- ตรวจว่า application contract รับ occupancy, days และ ratio override ครบตาม Scenario input contract;
  public endpoint ไม่ถือว่าอยู่ใน DoD รอบนี้.
- Live smoke test หลัง deploy validator: Run → Save → Reload → Open.

## Migration and rollout

ไม่มี data migration. ก่อนเปิดใช้งานบนฐานข้อมูลเดิม ต้อง redeploy `_design/access` ที่รองรับ
document type `simulation`; หาก CouchDB environment ยังไม่พร้อม ให้ถือ T-42 เป็น code/PR pending
และยังไม่ mark production complete.

## Approval gate

CR นี้ขออนุมัติเฉพาะ contract, scope, persistence boundary และ permission boundary ข้างต้น.
ยังไม่ใช่ approval ของ implementation หรือผลการทดสอบ. เมื่อ project owner อนุมัติแล้วจึงเปิด PR
และเริ่ม verification ตามรายการด้านบน.

**Approval clarification:** ยืนยันว่า “UI/API” ใน T-42 หมายถึง UI + internal application contract
ตามข้อ Change 6 ไม่ใช่ public HTTP API.

**Scope clarification (2026-08-26):** ตามคำสั่งเจ้าของงาน ให้ Scenario repository มี `delete` ด้วย.
การลบเป็น CouchDB tombstone ที่อนุญาตเฉพาะ `shelter_manager`/`system_admin` ใน shelter scope;
เอกสารที่บันทึกแล้วห้าม update และผลที่ถูกลบต้องไม่ถูกนำกลับมาเปิดหรือเขียนทับ `daily_calc`.

## Decision log

- 2026-08-19 — proposed; รอ project owner review/approval ก่อนเริ่ม PR.
- 2026-08-21 — approved (project owner อนุมัติสเปก CR-079)
- 2026-08-26 — owner clarification: เพิ่ม authorized delete/tombstone ให้ตรงกับ Scenario repository contract
