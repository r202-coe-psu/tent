---
id: draft
title: ปลดระวางกติกา bulk_return_pool v1/v2 + bulk_return_claim แบบเดิม และ script ลบข้อมูลกองรับคืนแบบเดิม (#661)
status: proposed
date: 2026-10-25
updated: 2026-10-25
requested_by: ทีม (epic #657 — cleanup ต่อจาก CR-193, GitHub #661)
decided_by: kong (รอตัดสิน)
layer: stable
affects:
  - docs/changes/03-C-supply/CR-193-bulk-return-pool-redesign.md (ต่อยอด Rollout ข้อ 3 — ไม่แก้ decision เดิม)
  - docs/changes/03-C-supply/CR-134-bulk-return-claim-recovery.md (superseded ส่วนที่เหลือ — claim flow / BULK reservation)
  - docs/data/schema.md §2.30 (`distribution_log.bulk_pool_id` legacy), §2.31 (หมายเหตุ legacy v1/v2), §2.32 (`bulk_return_claim`), §2.33 (`loan_return_reservation` mode `BULK`), §8 ข้อ 15, 16, 17, 19, 20
  - schema_v — ไม่ bump (ลบชนิดเอกสาร/ปิด path ไม่เปลี่ยน shape ของเอกสารที่ยังใช้งาน) — รอยืนยัน (ดู Q4)
  - frontend/src/lib/server/shelter-access-design.ts (VDU — whitelist, delete guard, Rule 13 / 15 / 16 ใน comment โค้ด)
  - frontend/scripts/ (script ใหม่ cleanup legacy bulk pool — dry-run / --apply)
  - frontend/src/lib/features/distribution/ (domain / data / application ของ flow เดิม — ลบโค้ดใน #661)
why: >
  CR-193 freeze pool v1/v2 และ claim ไว้ตอน deploy และระบุว่า #661 จะลบทิ้ง แต่ VDU ปัจจุบันยังรับ
  `bulk_return_claim`, `loan_return_reservation` mode `BULK` และ path `bulk_dropoff` + `bulk_pool_id` แบบเดิมอยู่,
  และห้ามลบ `bulk_return_pool` / `bulk_return_claim` ทุกกรณี — script ลบข้อมูลจึงรันไม่ได้จนกว่ากติกาจะเปลี่ยน
migration: >
  ไม่ migrate. ลบเอกสาร legacy (pool v1/v2, claim) ด้วย script หลัง dry-run และ owner ยืนยันรายสภาพแวดล้อม.
  ไม่เปิด loan ที่ปิดผ่านกองเดิมกลับ, ไม่ลบ/แก้ `stock_ledger` หรือ lot. ลบแล้วย้อนไม่ได้ (นอกจาก restore จาก backup).
---

# draft-bulk-return-pool-legacy-cleanup — ปลดระวาง bulk pool แบบเดิม + script ลบข้อมูล

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** (a) ถอดกติกา legacy ของกองรับคืน v1/v2 ออกจาก spec และ VDU — `bulk_return_claim`, pool v1/v2,
>   `loan_return_reservation` mode `BULK`, path `bulk_dropoff` + `bulk_pool_id` ของ `distribution_log`; (b) เพิ่ม script ลบเอกสาร
>   `bulk_return_pool` v1/v2 + `bulk_return_claim` ทั้งหมด (dry-run ก่อนเสมอ)
> - **ทำไม:** CR-193 freeze ข้อมูลเดิมไว้และส่งต่อการลบให้ #661 แต่ VDU ยังห้ามลบสองชนิดนี้ และยังเปิด path เขียนแบบเดิมบางส่วน
> - **ข้อห้าม:** ห้ามเปิด loan ที่ปิดผ่านกองเดิมกลับ · ห้ามลบ/แก้ `stock_ledger` และ lot · รันบน staging/production ต้องได้คำยืนยันจาก owner ทุกครั้ง
> - **สถานะ:** ร่าง — มีคำถามเปิดสำหรับ kong (หัวข้อ Open questions) ก่อน implement

---

## Context

- CR-193 (approved 2026-10-25) แทนที่ flow โควตาแบบเดิม (CR-134) ด้วย pool v3 + entry/move/void.
  Rollout ข้อ 3 ของ CR-193 ระบุว่า #661 เก็บกวาด pool v1/v2, `bulk_return_claim`, `bulk_pool_id` บน `distribution_log` และโค้ด legacy
- schema.md §2.31 (หมายเหตุ Migration) และ §2.32 ระบุว่าเอกสาร legacy "จะถูกลบใน #661"
- issue #661 กำหนด: script ลบ doc `bulk_return_pool` / `bulk_return_claim` แบบเดิมทั้งหมดตาม pattern `frontend/scripts/`;
  ไม่เปิด loan ที่ปิดผ่านกองเดิมกลับ; ไม่ลบ `stock_ledger` / lot ที่กองเดิมรับเข้าคลังแล้ว (ยอดคลังต้องไม่เปลี่ยน);
  ลบโค้ด flow เดิม; รันบน staging / production ต้องยืนยันกับ owner ก่อนทุกครั้ง และ dry-run ก่อนเสมอ
- UI ของ flow เดิม (`BulkPoolManager.svelte`, `CreateBulkPoolDialog.svelte`, `BulkGateClearDialog.svelte`) และ barrel export
  ที่ไม่มีผู้ใช้ถูกลบแล้วใน Phase 0 (commit `refactor(distribution): remove unused legacy bulk pool ui and exports`) —
  ไม่ใช่ spec change จึงไม่อยู่ใน CR นี้

### สภาพ VDU ปัจจุบัน (`frontend/src/lib/server/shelter-access-design.ts`, ณ PR #768 head)

| จุด | บรรทัดโดยประมาณ | พฤติกรรมตอนนี้ | ขัดกับ spec |
| --- | --- | --- | --- |
| delete guard | ~428 | ห้ามลบ `distribution_log`, `bulk_return_claim`, `bulk_return_pool`, `loan_return_reservation`, `shelter_incident` ทุกกรณี | script ลบ pool v1/v2 + claim ไม่ได้ |
| allowed types whitelist | ~497 | ยังมี `bulk_return_claim` | — |
| Rule 13 `distribution_log` (comment "Rules 12-14") | ~2122–2330 | path `isBulkReturn` (`returned` + `clear_reason=bulk_dropoff` + `bulk_pool_id` โดย frontline DST/SM) ยังเปิด; `bulk_dropoff` ผ่านได้ด้วย `bulk_pool_id` legacy อย่างเดียว (~2309–2313); void ห้ามเมื่อมี `bulk_pool_id` (~2214) | §2.30 เรียก `bulk_pool_id` ว่า "legacy อ่านอย่างเดียว" แต่ VDU ยังรับการปิด loan ใหม่ผ่าน path นี้ |
| Rule 14 `bulk_return_pool` | ~2359–2370 | v1/v2 frozen (ปฏิเสธ update), สร้างใหม่ต้อง v3 | สอดคล้อง |
| Rule 15 `bulk_return_claim` (CR-134) | ~2747–2841 | ยังรับการสร้าง/เปลี่ยนสถานะ claim (role RS/DST/SC/SM/SA) | §2.32 บอก "frozen — ไม่สร้าง claim ใหม่" แต่ VDU ยังไม่บังคับ |
| Rule 16 `loan_return_reservation` mode `BULK` | ~2843–2960 | ยังรับ `mode=BULK` + `bulk_pool_id` + `claimed_qty` | §2.33 ยังอธิบาย BULK ผ่าน `bulk_return_pool`/`bulk_return_claim` |

### สภาพ schema.md ปัจจุบัน

- §2.30 แถว `bulk_pool_id` (opt, legacy อ่านอย่างเดียว, "#661 เก็บกวาด") + ย่อหน้า "`bulk_pool_id` (legacy) จำกัดการ clear ตาม `unclaimed_quota`" + ย่อหน้า path bulk แบบ legacy
- §2.31 ย่อหน้า "Legacy schema_v 1 / 2 (frozen — อ่านอย่างเดียว, ลบใน #661)" และ "Migration & Document Compatibility"
- §2.32 `bulk_return_claim` ทั้งหัวข้อ (มี banner legacy frozen)
- §2.33 `loan_return_reservation` — mode `BULK`, field `bulk_pool_id` / `claimed_qty`, ข้อความ "การปลดภาระที่ด่าน Check-out ใช้ `bulk_return_claim` (§2.32)"
- §8 ข้อ 15 (pool v1/v2), 16 (`bulk_return_claim`), 17 (`loan_return_reservation` รวม BULK), 19 (อ้างข้อ 15), 20 (`bulk_pool_id` เดิมต้องคงที่)

## Change

### (a) Spec change — ปลดระวางกติกา legacy

**Before:** pool v1/v2 + `bulk_return_claim` frozen แต่ยังเป็นส่วนหนึ่งของ spec; VDU ยังรับ claim ใหม่, reservation `BULK`
และการปิด loan ด้วย `bulk_pool_id`; ห้ามลบเอกสาร legacy

**After (เสนอ):**

- **R-a1** — VDU ปฏิเสธการสร้างและแก้ `bulk_return_claim` ทุกกรณี (ถอดออกจาก allowed types หรือคงไว้เฉพาะเพื่อให้ลบได้ — ดู Q2)
- **R-a2** — VDU ปฏิเสธการสร้าง `bulk_return_pool` ที่ `schema_v` ≠ 3 (คงเดิม) และ**อนุญาตให้ลบ** pool `schema_v` 1/2 และ `bulk_return_claim`
  เฉพาะผู้ที่กำหนดใน Q1; pool v3 ยังห้ามลบตาม CR-193
- **R-a3** — VDU ปฏิเสธ `loan_return_reservation` ที่ `mode=BULK` สำหรับ attempt ใหม่ (สร้าง / reinitialize เป็น `RESERVED`); เอกสาร BULK เดิมจัดการตาม Q3
- **R-a4** — VDU ของ `distribution_log` ปิด path `isBulkReturn` แบบ legacy: `clear_reason=bulk_dropoff` ต้องมาจาก path v3
  (`applied_bulk_entry_ids`) เท่านั้นสำหรับ transition ใหม่; loan ที่ปิดแล้วด้วย `bulk_pool_id` ยังคงสถานะเดิม (ไม่ถูกเปิดกลับ)
- **R-a5** — `distribution_log.bulk_pool_id` ที่มีอยู่แล้ว: จัดการตาม Q4 (คงเป็นประวัติ vs ถอดออก) — ไม่ว่าทางไหน loan ต้องไม่เปลี่ยน status / `qty_returned`
- **R-a6** — schema.md: ลบ/ย่อ §2.32 และส่วน BULK ของ §2.33, ปรับ §2.30–§2.31 และ §8 ข้อ 15–17, 19–20 ให้ตรงกับ R-a1–R-a5; อัปเดต `updated:` และ frontmatter note
- **R-a7** — redeploy `_design/access` บน shelter ที่ provision แล้ว (`frontend/scripts/redeploy-access.ts`) ก่อนรัน script (b)

### (b) Data-deletion script (#661)

- **R-b1** — script ใหม่ใน `frontend/scripts/` ตาม pattern เดิม (เช่น `cleanup-referral-hardening.ts`: อ่าน `.env`, default = dry-run, `--apply` = เขียนจริง)
  และเพิ่ม entry ใน `package.json` (ชื่อ script ดู Q6)
- **R-b2** — dry-run แสดงจำนวนเอกสารที่จะลบต่อ shelter DB และต่อชนิด (`bulk_return_pool` v1, v2, `bulk_return_claim` แยกตามสถานะ) โดยไม่เขียนอะไร
- **R-b3** — เลือกเฉพาะ `type='bulk_return_pool'` ที่ `schema_v` ∈ {1, 2} และ `type='bulk_return_claim'`; **ห้ามแตะ** pool v3, `bulk_return_entry*`, `stock_ledger`, lot, `distribution_log`
  (นอกจาก Q4 สั่งให้ถอด `bulk_pool_id`)
- **R-b4** — ห้ามเปิด loan ที่ปิดผ่านกองเดิมกลับ: script ไม่แก้ `status` / `qty_returned` / `clear_reason` / `returned_*` ของ `distribution_log` ใด ๆ
- **R-b5** — ตรวจก่อนและหลัง `--apply`: ยอดคลัง (ผลรวม `stock_ledger` ต่อ item/lot) และสถานะ + `qty_returned` ของ loan ทุกฉบับเท่าเดิม — ไม่เท่าให้รายงาน error
- **R-b6** — `--apply` บน staging / production ต้องได้คำยืนยันจาก owner ก่อนทุกครั้ง (กระบวนการนอก script; script อาจถามยืนยันชื่อ DB/สภาพแวดล้อมแบบ interactive — ดู Q7)
- **R-b7** — rerun ได้ (idempotent): รอบสองหลังลบครบแล้ว dry-run แสดง 0

### Acceptance

- [ ] dry-run แสดงจำนวน doc ที่จะลบ (ต่อ DB / ต่อชนิด) และไม่เขียนอะไร
- [ ] หลัง `--apply` ยอดคลังเท่าเดิม และ status / `qty_returned` ของรายการยืมไม่เปลี่ยน
- [ ] หลัง redeploy VDU: สร้าง `bulk_return_claim`, reservation `BULK` ใหม่ และปิด loan ด้วย `bulk_pool_id` ถูกปฏิเสธ; pool v3 / entry / ledger ยังทำงานตามเดิม
- [ ] ไม่มีโค้ด/route/test อ้าง `bulk_return_claim` หรือ pool v1/v2 นอกเหนือจาก script cleanup และ schema/VDU test ที่ยืนยันการปฏิเสธ

## Open questions (สำหรับ kong)

1. **Q1 — ใครลบได้:** VDU ทำงานกับ server admin ด้วย — ให้ลบ pool v1/v2 + claim ได้เฉพาะ `_admin` (script ใช้ `COUCHDB_ADMIN_URL`) หรือรวม `system_admin`?
2. **Q2 — `bulk_return_claim` ใน VDU หลังลบเสร็จ:** ถอดออกจาก allowed types ทั้งหมด (rule 15 หายไป) ในการ deploy เดียวกัน หรือทำสองรอบ (รอบแรกเปิดให้ลบ → รัน script → รอบสองถอดชนิดออก)?
3. **Q3 — `loan_return_reservation` mode `BULK` ที่มีอยู่:** ลบด้วย script (ขัดกับ §8 ข้อ 17 "ห้ามลบเด็ดขาด" ต้องแก้กติกา) หรือคงไว้เป็นประวัติแบบอ่านอย่างเดียว? ถ้าคงไว้ `bulk_pool_id` ในนั้นจะชี้ไปเอกสารที่ถูกลบ
4. **Q4 — `distribution_log.bulk_pool_id`:** schema.md §2.31 บอกว่า #661 ลบ `bulk_pool_id` เดิมบน `distribution_log` แต่ #661 ห้ามเปลี่ยนรายการยืม —
   คง field ไว้เป็นประวัติ (ชี้ไป pool ที่ลบแล้ว) หรือถอดออก (ต้องแก้ทุก log ที่ปิดผ่านกองเดิม, VDU ต้องอนุญาต, และกระทบกติกา void ข้อ ~2214)? ถ้าถอด ต้อง bump `schema_v` ของ `distribution_log` หรือไม่?
5. **Q5 — `stock_ledger.ref_id='bulk_return_pool:{ulid}'` ของกองเดิม:** หลังลบ pool แถว ledger จะชี้ไปเอกสารที่ไม่มีแล้ว — ยอมรับเป็น dangling ref
   (ledger append-only) และให้ `audit-stock-ledger-refid.ts` ไม่ถือเป็น error หรือไม่?
6. **Q6 — ชื่อ script:** เช่น `pnpm cleanup:legacy-bulk-pool` (`frontend/scripts/cleanup-legacy-bulk-pool.ts`) — ยืนยันชื่อ
7. **Q7 — การยืนยันก่อน `--apply`:** ให้ script ถามพิมพ์ชื่อ DB/สภาพแวดล้อมซ้ำ หรือพึ่ง process (owner ยืนยันใน issue/PR) อย่างเดียว? ต้อง backup DB ก่อนหรือไม่?
8. **Q8 — tracking:** ใช้ไฟล์ CR เดียวครอบ (a) + (b) แบบนี้ หรือแยก spec change กับ script? และให้อยู่หมวด `03-C-supply`

## Impact

- **Spec:** `docs/data/schema.md` §2.30, §2.31, §2.32, §2.33, §8 (ข้อ 15–17, 19–20) + frontmatter; CR-193 / CR-134 (cross-ref)
- **VDU:** `frontend/src/lib/server/shelter-access-design.ts` — delete guard (~428), allowed types (~497), Rule 13 legacy bulk path (~2122–2330),
  Rule 15 claim (~2747–2841), Rule 16 reservation BULK (~2843–2960) + test ของ VDU
- **Script:** `frontend/scripts/` (ไฟล์ใหม่) + `frontend/package.json`
- **โค้ด legacy ที่ลบได้หลัง R-a1–R-a4 (#661, ไม่ใช่ spec change):**
  - `frontend/src/lib/features/distribution/domain/food-supplies/bulk-return-claim.ts`, ส่วน v1/v2 ใน `bulk-return-pool.ts`, export ใน `domain/food-supplies/index.ts`
  - `frontend/src/lib/features/distribution/data/food-supplies/bulk-return-pool.repository.ts` (ส่วน legacy + claim)
  - `frontend/src/lib/features/distribution/application/food-supplies/return-workflow.ts` (`createBulkReturnPool`, `clearLoanViaBulkPool`, reservation BULK)
  - `frontend/src/lib/features/distribution/application/query/return-mutations.ts` (`useCreateBulkReturnPool`, `useClearLoanViaBulkPool`),
    `read-queries.ts` (`useBulkReturnClaim`), `invalidation.ts` (`invalidateBulkPools`, `invalidateBulkClaims`), `live-query.ts`
  - barrel `frontend/src/lib/features/distribution/index.ts` (`useCreateBulkReturnPool` ยังถูก export อยู่แต่ไม่มีผู้ใช้แล้ว)
  - `frontend/src/lib/features/distribution/ui/model/bulk-pool-manager.ts` + `loan-return.ts` (`isEligibleBulkPool`, `validateBulkForwardRecovery`) — ตรวจผู้ใช้ก่อนลบ
  - test ที่เกี่ยวข้อง (`application/queries.test.ts`, `ui/model/loan-return.test.ts`, `ui/frontline/counter-return-flow.test.ts`, `ui/model/bulk-pool-manager.test.ts`)

## Migration

- ไม่ migrate และไม่ backfill. pool v1/v2 + claim ถูกลบด้วย script; pool v3 / entry / move / void / `stock_ledger` / lot ไม่เปลี่ยน
- `schema_v` ไม่ bump ในข้อเสนอนี้ (ลบชนิดเอกสาร / ปิด path) — ยกเว้น Q4 ตัดสินให้ถอด `bulk_pool_id` ออกจาก `distribution_log`
- ลำดับ rollout ที่เสนอ: (1) แก้ schema.md + VDU (R-a1–R-a4) → (2) redeploy `_design/access` → (3) dry-run ต่อสภาพแวดล้อม → (4) owner ยืนยัน → (5) `--apply` → (6) ตรวจ R-b5 → (7) ลบโค้ด legacy
- **Rollback:** ลบแล้วย้อนไม่ได้นอกจาก restore จาก backup; VDU revert ได้ แต่ไม่คืนเอกสารที่ลบแล้ว

## Decision log

- 2026-10-25 — proposed (draft คู่กับ #661; CR-191 และ CR-193 ใช้แล้ว — รอ kong กำหนดเลขและวิธี track)
