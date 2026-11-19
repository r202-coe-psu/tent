---
id: CR-262
title: ย้อนสถานะการพักพิงของผู้อพยพกลับขั้นก่อนหน้า (revert_status) กรณีเช็คอินผิดคน
status: approved
date: 2026-11-18
updated: 2026-11-19
requested_by: Feedback ระบบลงทะเบียน — GitHub #1447 (ข้อ 2)
decided_by: Soravit Sukkarn (Team Lead)
decision_date: 2026-11-18
layer: volatile
affects:
  - docs/data/schema.md §1.4 movement (`action` += `revert_status`; field ใหม่ `from_status` / `to_status`; `reason` บังคับเมื่อ `revert_status`)
  - docs/prd/role-permission-matrix.md §3 (แถวใหม่ Evacuee status revert)
  - frontend/src/lib/server/shelter-access-design.ts (`validate_doc_update` — stable core, เจ้าของโครงการอนุมัติ 2026-11-18)
  - no schema_v bump (movement ไม่มี `schema_v`; evacuee stay enum ไม่ขยาย — ดู Migration)
  - frontend/src/lib/features/people/domain (`movementActionSchema`, `Movement`, `assertMovementAllowed`, `applyMovementToStay`, `resolveStatusChangeAction`, `canRevertStatusTo`)
  - frontend/src/lib/features/people/data (`revertEvacueeStatus`) · application (`useRevertEvacueeStatus`)
  - frontend/src/lib/features/people/ui/evacuee-profile (status modal, profile view, movement history)
  - frontend/src/lib/features/shared/domain/in-shelter-day.ts
  - Amendment A1 (2026-11-18) — override ทุกสถานะ → ทุกสถานะ (SM/SA) — ขยาย `to_status` ของ movement `revert_status`, VDU rule 2c, โซนตามปลายทาง
---

# CR-262 — ย้อนสถานะการพักพิงกลับขั้นก่อนหน้า

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม movement action `revert_status` ให้ย้อน `current_stay.status` กลับขั้นก่อนหน้าได้ (เช่น `room_confirmed` → `active`, `active` → `arriving`)
> - **เพื่อใคร/ทำไม:** แก้กรณีเจ้าหน้าที่เช็คอิน / ยืนยันถึงโซนผิดคน — ปัจจุบันไม่มีทางย้อนกลับ
> - **dev ต้อง build:** domain guard + write path + ตัวเลือกย้อนในโมดัลแก้สถานะ (เฉพาะ SM / SA) + บังคับระบุเหตุผล + กฎใน CouchDB `validate_doc_update`
> - **Amendment A1 (2026-11-18):** SM / SA เปลี่ยนสถานะได้ **ทุกสถานะ → ทุกสถานะ** (ไม่จำกัดแค่ย้อนกลับ) ด้วยเหตุผลบังคับ — ดู "Amendment 2026-11-18 (A1)" ด้านล่าง ซึ่งแทนที่ FR-02/03/04/07/12
> - **กระทบ:** `schema.md` §1.4 (enum + 2 field optional), role matrix 1 แถว, `validate_doc_update` (ต้อง `pnpm redeploy:access`) · ไม่ bump `schema_v`

## Why

Feedback ระบบลงทะเบียน (#1447 ข้อ 2): ต้องแก้สถานะผู้อพยพย้อนกลับได้เมื่อเช็คอินผิดคน โดยต้องมีเหตุผลประกอบ. เดิมสถานะเดินหน้าอย่างเดียว (`pre_registered` → `arriving` → `active` → `room_confirmed`) — `assertMovementAllowed` ไม่มี action ย้อน และ `resolveStatusChangeAction` คืน `null` สำหรับทุกการย้อน.

## Change

### Requirements

- **FR-01** — เพิ่ม `revert_status` ใน `movementActionSchema` (action เดียวสำหรับทุกการย้อน; ผลลัพธ์ระบุด้วย `to_status`).
- **FR-02** — ลำดับ pipeline = `pre_registered` < `arriving` < `active` < `room_confirmed`. `to_status` ต้องอยู่ **ก่อน** สถานะปัจจุบันอย่างเคร่งครัด.
- **FR-03** — ย้อนได้จาก `active` / `room_confirmed` เท่านั้น; `to_status` ∈ {`pre_registered`, `arriving`, `active`}. ขั้นต่ำที่ต้องรองรับ: `room_confirmed` → `active`; `active` / `room_confirmed` → `arriving`; `active` / `room_confirmed` → `pre_registered`.
- **FR-04** — `deceased` และ `cancelled` เป็น terminal เหมือนเดิม — ย้อนไม่ได้. `temporary_leave`, `checked_out`, `transferred` ไม่ใช่ต้นทางของการย้อน (กลับเข้าด้วย `check_in` ตามเดิม).
- **FR-05** — `reason` **บังคับ** nonempty หลัง trim (เหมือน `check_out`) — บังคับทั้งใน `assertMovementAllowed` (domain) และโมดัลแก้สถานะ (UI).
- **FR-06** — movement doc บันทึก `reason`, `created_by`, `from_status`, `to_status` เพื่อให้ audit trail / ประวัติการเคลื่อนไหวแสดงว่าใคร ย้อนจากอะไรเป็นอะไร เพราะอะไร.
- **FR-07** — ผลต่อ `current_stay`: `status` = `to_status`; `since` = `occurred_at`; `zone` **ล้างเป็น `null`** เมื่อ `to_status` ต่ำกว่า `active` (`arriving` / `pre_registered`); `room_confirmed` → `active` **คง `zone`** (ล้างเฉพาะการยืนยันถึงโซน — `confirm_room` ตั้งแค่ `status`/`since`, ไม่มี field ยืนยันแยก).
- **FR-08** — สิทธิ์: เฉพาะ `shelter_manager` (ศูนย์ปัจจุบัน) และ `system_admin`. `registration_staff` ต้องไม่เห็นตัวเลือกย้อนและทำรายการไม่ได้ (UI ซ่อนตัวเลือก + `updateStatus` ปฏิเสธ) และ CouchDB ปฏิเสธการเขียน (FR-13, FR-14).
- **FR-09** — แถว `station_log` (append-only) ที่เขียนโดยขั้นเดินหน้า (เช่น Station 3 `complete` ตอน check-in) **ไม่ถูกแก้ / ลบ** เมื่อย้อน.
- **FR-10** — ประวัติการเคลื่อนไหวในโปรไฟล์แสดงป้าย "ย้อนสถานะ (Status reverted)" (TH + EN), สถานะต้นทาง → ปลายทาง, เหตุผล และผู้ทำรายการ.
- **FR-11** — `household.status` ยัง derive จากสถานะสมาชิก (CR-112 A2) — ไม่เขียนแยก.
- **FR-12** — presence รายวัน (`wasInShelterAllDay`) ถือ `revert_status` ที่ `to_status` ต่ำกว่า `active` เป็นการออกจากศูนย์; ย้อน `room_confirmed` → `active` ไม่เปลี่ยน presence.

- **FR-13** — `validate_doc_update` (`shelter-access-design.ts`): movement ที่ `action = revert_status` ต้องมาจาก `system_admin` หรือ `shelter_manager` ของศูนย์นั้น (ตรวจด้วย `isRole('shelter_manager')` เดียวกับกฎ manager อื่น: `{code}:shelter_manager`, หรือ `shelter_manager` เปล่าที่ผู้ใช้มี scope `shelter:{code}` เพียงศูนย์เดียว) · `reason` ต้อง nonempty หลัง trim · `to_status` ∈ {`pre_registered`, `arriving`, `active`}. ผิดเงื่อนไข → `forbidden`.
- **FR-14** — `validate_doc_update`: evacuee doc ที่ `current_stay.status` เดิมเป็น `active` / `room_confirmed` แล้วเขียนใหม่เป็นสถานะที่อยู่ก่อนตามลำดับ (`pre_registered` = `kiosk_registered` < `arriving` < `active` < `room_confirmed`) ต้องมาจาก `system_admin` / `shelter_manager` ของศูนย์นั้นเท่านั้น — ปิดช่องที่ `registration_staff` แก้ evacuee doc ตรงโดยข้าม movement. การเปลี่ยนไปสถานะนอกลำดับ (`checked_out`, `temporary_leave`, `transferred`, `deceased`, …), การเดินหน้า และ rezone ไม่ถูกกระทบ. การเขียนที่ **ตัด `current_stay` ทิ้ง** (ไม่มี / `null` / ไม่มี `status`) จาก doc ที่เดิมเป็น `active` / `room_confirmed` นับเป็นการถอยสถานะด้วย (กันการเขียนสองรอบเพื่อเลี่ยงกฎ); การลบ doc (`_deleted`) ไม่นับ. `_admin` และ `repl:{code}` ข้าม validator ตามเดิม.

### ที่ไม่เปลี่ยน

- **Rollout:** ไม่มี version constant — `_design/access.validate_doc_update` ถูกเทียบกับผลของ `buildValidateDocUpdate(code)` แบบ string. ศูนย์ที่สร้างใหม่ได้ validator ใหม่จาก provisioner (`provisioner.ts`) อัตโนมัติ; **ศูนย์เดิมต้องรัน `pnpm redeploy:access --write --confirm`** (หรือ `pnpm db:sync`) หนึ่งครั้งหลัง deploy. จนกว่าจะ redeploy ศูนย์เดิมยังบังคับสิทธิ์ที่ domain + UI เท่านั้น.
- **Known gap:** `updateEvacuee` / `patchEvacuee` เขียนทับด้วย snapshot ฝั่ง client — ถ้า REG ถือ snapshot เก่า (เช่น ฟอร์มเปิดค้างตอนคนยัง `arriving` แต่ใน DB เป็น `active` แล้ว) การบันทึกจะเป็นการถอยสถานะโดยไม่ตั้งใจ และ FR-14 จะปฏิเสธ (เดิมเงียบ ๆ เขียนทับ). ถือเป็นพฤติกรรมที่ถูกต้อง; ไม่พบ flow ปกติที่ถอยสถานะโดยผู้ที่ไม่ใช่ manager.
- Worker projectors (`worker/.../projectors/evacuee.py`, `occupant.py`) อ่าน `current_stay.status` / `zone` / `since` เท่านั้น ไม่มี enum ของ movement action — ย้อนไป `arriving` / `pre_registered` ทำให้ `checked_in_at = null` และถูกถอดออกจาก `shelter_occupants` อัตโนมัติ; ไม่ต้องแก้ worker หรือ bump `PROJECTION_VERSION`. FastAPI / BFF ไม่มี allow-list ของ movement action.

### Acceptance / DoD

- [ ] SM / SA เปิดโมดัลแก้สถานะของคน `room_confirmed` เห็นตัวเลือก ลงทะเบียนล่วงหน้า / รอส่งต่อ / เข้าพัก; REG ไม่เห็น
- [ ] เลือกตัวเลือกย้อนโดยไม่ใส่เหตุผล → ยืนยันไม่ได้ (toast) และ domain throw
- [ ] ย้อน `room_confirmed` → `active` คงโซน; ย้อนเป็น `arriving` / `pre_registered` ล้างโซน
- [ ] `deceased` / `cancelled` ย้อนไม่ได้
- [ ] movement ใหม่มี `reason`, `created_by`, `from_status`, `to_status`; ประวัติในโปรไฟล์แสดงรายการ
- [ ] CouchDB `validate_doc_update`: REG ถูกปฏิเสธทั้ง movement `revert_status` และการแก้ evacuee doc ตรงเพื่อถอยสถานะ; SM / SA ผ่าน; การเดินหน้าและ rezone ของ REG ไม่กระทบ; รัน `pnpm redeploy:access` แล้วในศูนย์เดิม
- [ ] unit tests: `assertMovementAllowed`, `applyMovementToStay`, `resolveStatusChangeAction`, `revertEvacueeStatus`, `wasInShelterAllDay`; DOM test โมดัล (บังคับเหตุผล + ซ่อนตามสิทธิ์)

## Impact

- **Domain:** `revert_status`, `Movement.from_status` / `to_status`, `canRevertStatusTo`, `listRevertTargets`; `resolveStatusChangeAction` คืน `revert_status` สำหรับการย้อน; `statusChangeHandlerKind` เพิ่ม `revert_status`.
- **Data / application:** `PeopleRepository.revertEvacueeStatus` + `useRevertEvacueeStatus` (fetch latest → `assertMovementAllowed` → เขียน movement → apply snapshot → refresh household).
- **UI:** `evacuee-status-modal.svelte` (prop `canRevert`, เหตุผลบังคับ), `evacuee-profile-view.svelte` (gate `canRevertStatus` = SA หรือ SM ของศูนย์ปัจจุบัน), label movement + `MOVEMENT_DOT_CLASS`.
- **Specs:** `schema.md` §1.4, `role-permission-matrix.md` §3.
- **Known limitation:** `zoneOnDay` (รายงานมื้ออาหารย้อนหลัง) ข้าม movement ที่ `zone = null` จึงยังเห็นโซนก่อนย้อนในวันก่อนหน้า — ตรงกับพฤติกรรมของ `check_out` ที่ `zone = null`.
- **เปิดให้ตัดสิน:** `pre_registered` เป็นตัวเลือกย้อนสำหรับทุกคนที่ `active` / `room_confirmed` (ระบบไม่เก็บว่าคนนั้นเคยลงทะเบียนล่วงหน้าหรือไม่) — เจ้าหน้าที่เลือกเอง.

## Migration

ไม่ bump `schema_v`. เทียบ precedent:

- **CR-070** bump evacuee `schema_v` เพราะขยาย **stay status enum** ของ evacuee (`cancelled`) ซึ่ง Zod / `validate_doc_update` ตรวจ. CR นี้ **ไม่เพิ่มค่า stay status** — `to_status` ใช้ค่าที่มีอยู่แล้ว.
- **CR-112** เพิ่ม movement action `confirm_room` โดยไม่ bump — movement doc ไม่มี `schema_v` ใน `schema.md` §1.4 (factory stamp `1`).
- `from_status` / `to_status` เป็น field optional ใหม่ (additive); movement เดิมไม่ต้อง backfill; reader ที่ไม่รู้จัก action ใหม่ต้องไม่พัง (UI ใช้ label fallback).

## Amendment 2026-11-18 (A1) — SM / SA เปลี่ยนสถานะได้ทุกสถานะ → ทุกสถานะ · **approved 2026-11-18 (Soravit Sukkarn (Team Lead), #1447 / PR #1458)**

เจ้าของโครงการตัดสิน (ตัวอย่างหน้าจอ: คน `arriving` เห็นแค่ "รอเข้าพัก (ปัจจุบัน)" กับ "เช็คอิน"): **SM (ศูนย์ปัจจุบัน) / SA ทำได้ทุกสถานะ** — override ด้วยมือจาก **ทุก** `current_stay.status` ไป **ทุก** stay status อื่น (รวม `checked_out`, `temporary_leave`, `transferred`, `deceased`, `cancelled`, `kiosk_registered`) โดยต้องระบุเหตุผลเสมอ. `registration_staff` ยังเหมือนเดิม (เฉพาะตัวเลือกเดินหน้าปกติ ไม่มี override). Amendment นี้ **แทนที่** FR-02, FR-03, FR-04, FR-07 ด้านล่าง; FR-01, FR-05, FR-06, FR-08–FR-11 คงเดิม.

- **A1-FR-01 (แทน FR-02/03/04)** — action ยังชื่อ `revert_status` (ตอนนี้หมายถึง "manual status override โดย SM/SA"). ต้นทาง = สถานะใดก็ได้; `to_status` = stay status ใดก็ได้ที่ **ต่างจาก** สถานะปัจจุบัน. ไม่มีลำดับ pipeline และ **ไม่มี** terminal block สำหรับ action นี้ (action ปกติอื่นยังถูกบล็อกจาก `deceased` / `cancelled`).
- **A1-FR-02 (UI)** — โมดัลแก้สถานะ (`canRevert` = SM ศูนย์ปัจจุบัน / SA) แสดง **ทุก** stay status ยกเว้นสถานะปัจจุบัน. ถ้ามี action ปกติที่ตรงกับตัวเลือก ให้ใช้ action ปกติเดิม (เช่น `arriving` → `active` ผ่าน `check_in` + เลือกโซน, `active` → `checked_out` ผ่าน `check_out`, `active` → `room_confirmed` ผ่าน `confirm_room`); ตัวเลือกที่ไม่มี action ปกติ → `revert_status`. เหตุผลบังคับทุกครั้งที่เป็น `revert_status`. REG เห็นตัวเลือกเดินหน้าปกติเท่านั้น.
- **A1-FR-03 (แทน FR-07: โซน)** — `current_stay.status` = `to_status`, `since` = `occurred_at` และ `zone` ตามปลายทาง: `pre_registered` / `kiosk_registered` / `arriving` / `cancelled` → **ล้างโซนเป็น `null`** · `active` / `room_confirmed` → **คงโซนปัจจุบัน**; ถ้าไม่มีโซน **ต้องเลือกโซนก่อน** (UI เปิด zone modal เหมือน check-in; domain / repo throw ถ้าไม่มี — ไม่สร้างสถานะ in-shelter ที่ไม่มีโซน) · `checked_out` / `temporary_leave` / `transferred` / `deceased` → คงโซนปัจจุบันเหมือน action ปกติที่ `applyMovementToStay` (`zone ?? current zone`). `movement.zone` = โซนผลลัพธ์.
- **A1-FR-04 (แทน FR-12: presence)** — `wasInShelterAllDay`: `revert_status` ที่จบด้วย `active` / `room_confirmed` นับเป็น **เข้าศูนย์**; จบด้วยสถานะอื่นนับเป็น **ออกจากศูนย์**.
- **A1-FR-05 (VDU rule 2c แทน FR-13 ข้อ `to_status`)** — `to_status` ของ movement `revert_status` ต้องเป็น stay status ที่ถูกต้อง (10 ค่า: `pre_registered`, `kiosk_registered`, `arriving`, `active`, `room_confirmed`, `temporary_leave`, `transferred`, `checked_out`, `deceased`, `cancelled`); ค่าที่ไม่รู้จัก / ไม่มี → `forbidden`. ยังต้อง SM/SA + `reason` nonempty; `from_status` ≠ `to_status`; `to_status` เป็น `active` / `room_confirmed` ต้องมี `zone` nonempty บน movement. **FR-14 (evacuee-doc guard ของ REG) ไม่เปลี่ยน** — ไม่ขยายไป `arriving` เพราะ flow ร่างลงทะเบียน (`registerEvacuee` + `draft_id`) ย้าย `arriving` → `pre_registered` โดย REG อย่างถูกต้อง. ต้อง `pnpm redeploy:access --write --confirm` ในศูนย์เดิมอีกครั้ง.
- **Side effects ที่ไม่เปลี่ยน / จงใจข้าม:**
  - **คง:** `refreshDerivedHouseholdStatus` (household derive จากสมาชิก, CR-112 A2 — ไม่ assert `checkout_destination` เหมือน `check_out` ปกติ); append movement ก่อน snapshot.
  - **จงใจข้าม:** `station_log` (override ไม่เขียน/ลบ — เขียนเฉพาะ Station 3 `complete` ของ `check_in` ปกติจาก `arriving`); การ normalize remark ของ `check_out` (override ใช้ `reason` ที่ trim แล้วเสมอ); `destination` ของ movement (override ไม่มี destination — `checkout_destination` ของครัวเรือนไม่ถูกตั้ง); view `registrations_by_date_status` นับเฉพาะ `check_in`/`check_out`/`transfer_*` จึงไม่นับ override (ตัวเลข checkin/checkout รายวันไม่รวมการแก้ด้วยมือ).
  - Worker projectors อ่านเฉพาะ `current_stay` (`status`/`zone`/`since`) — ไม่ต้องแก้ worker / `PROJECTION_VERSION`.
- **ความเสี่ยงที่ยอมรับ:** override ออกจาก `deceased` / `cancelled`, และไปสถานะ `cancelled` / `deceased` โดยไม่มี guard ลำดับ — ความรับผิดชอบอยู่ที่ SM/SA + เหตุผลบังคับ + ประวัติ movement.

## Decision log

- 2026-11-19 — FR-14: นับ `kiosk_registered` อยู่ขั้นเดียวกับ `pre_registered` ในลำดับของ VDU — REG เขียนตรง `active` / `room_confirmed` → `kiosk_registered` ถูกปฏิเสธเหมือน `pre_registered` (ปิด blocker จาก review PR #1458; ไม่เปลี่ยนกฎธุรกิจ แค่ให้ guard ครอบสถานะลงทะเบียนล่วงหน้าทั้งสองแบบ).
- 2026-11-18 — **Amendment A1 approved** โดย Soravit Sukkarn (Team Lead) (#1447 / PR #1458): SM/SA เปลี่ยนสถานะได้ทุกสถานะ → ทุกสถานะ (override ผ่าน `revert_status` เดิม), เหตุผลบังคับ, ล้าง/คงโซนตามปลายทาง, VDU rule 2c ขยาย `to_status`, REG เหมือนเดิม.
- 2026-11-18 — **approved** โดย Soravit Sukkarn (Team Lead) — ได้เลข CR-262 (CR-259–261 ถูกใช้ไปแล้วบน `develop`). ยอมรับช่องที่เหลือเป็น edge case: REG ที่เขียน CouchDB ตรงยังไปถึงสถานะก่อนหน้าได้หลายขั้นตอน (status ที่ไม่รู้จัก, `checked_out` → `pre_registered`, ลบแล้วสร้างใหม่) เพราะ VDU ไม่มี whitelist การเปลี่ยนสถานะเต็มรูปแบบ (#1447 / PR #1458).
- 2026-11-18 — เจ้าของโครงการอนุมัติให้เพิ่มการบังคับใน CouchDB `validate_doc_update` (แตะ stable core) — เพิ่ม FR-13, FR-14.
- 2026-11-18 — proposed (ร่างจาก #1447 ข้อ 2). เจ้าของโครงการตัดสินแล้ว: ย้อนได้ทุกขั้นถอยหลังผ่าน action เดียว `revert_status`; เหตุผลบังคับ; เฉพาะ SM (ศูนย์ปัจจุบัน) + SA; `deceased` / `cancelled` terminal; ไม่แตะ `station_log`; ไม่แก้ `validate_doc_update` (ภายหลังเปลี่ยนเป็นแก้ — ดูรายการก่อนหน้า).
