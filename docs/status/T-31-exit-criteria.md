---
title: T-31.11 — Exit Criteria & Contract Publication
created: 2026-08-17
status: ready-for-sign-off-runtime-and-lint-baseline-pending
source_cr: CR-042
---

# T-31.11 — Exit Criteria & Contract Publication

เอกสารนี้เป็นจุดอ้างอิงสำหรับการปิดงาน T-31 หลัง CR-042 โดยแยกหลักฐานของ contract,
ข้อมูลที่ persist จริง, การคำนวณ runtime และการรับรองจากทีมที่นำ contract ไปใช้ต่อ

## Frozen contract

- Persisted document คือ `daily_calc:{date}` และต้องเป็น `schema_v=2`
- Provenance ต้องเป็น `master/null/null` หรือ `override/{id}/{version}`
- Persisted output ต้องมี canonical SOP ratio 20 keys และไม่มี `rice_g_per_person_meal`
- `have` ต้องมาจาก CR-042 map เท่านั้น: `item:water`, shelter facilities และ `area_m2`
- Source ที่ไม่มีข้อมูลต้องเป็น `null` ไม่ใช่ `0`
- การอ่าน persisted document ใช้ fail-closed validation; schema เก่าหรือข้อมูลเสียไม่ถูกส่งต่อให้ dashboard
- `runOnDemand(date)` ใช้ deterministic ID และเขียน `audit.retro_edit` ก่อน overwrite
- R3 เป็น on-demand only; ไม่มี scheduler หรือ downstream feed ใน scope นี้

## Version policy

| การเปลี่ยนแปลง                             | การดำเนินการ                     |
| ------------------------------------------ | -------------------------------- |
| เปลี่ยน storage envelope หรือ output shape | bump `DAILY_CALC_SCHEMA_VERSION` |
| เปลี่ยนอัลกอริทึม/การปัดเศษ/การจัดสถานะ    | bump `FORMULA_V`                 |
| เปลี่ยน canonical ratios หรือ have-map     | เปิด CR ใหม่                     |

ไม่ bump schema จาก algorithm-only change และไม่ bump formula จาก storage-only change

## Verification gates

### Contract

- [x] Canonical 20-key SOP contract
- [x] `schema_v=2` และ provenance fields
- [x] CR-042 have-map
- [x] Domain coverage gate ≥95% (ปัจจุบัน 100% จาก `pnpm test:coverage`)
- [x] `pnpm check` ผ่าน 0 errors / 0 warnings
- [x] Read-boundary tests สำหรับ malformed, unsupported schema และ semantic invariant

### Seed

- [ ] Persisted master profile ผ่าน `sopMasterSchema` และเป็น exact canonical 20 keys
- [ ] Seed สร้าง daily snapshots 14 วันติดต่อกันแบบ exact set
- [ ] Water balance ตรงกับ signed sum ของ `stock_ledger`
- [ ] Facility/area values ตรงกับค่าที่ `resolveHave()` อ่านจาก registry shelter
- [ ] Unsupported sources และ volunteer เป็น `null`

คำสั่งตรวจ:

```bash
cd frontend
pnpm seed
pnpm verify:resource-calc-seed
```

`pnpm seed` เป็นคำสั่งที่เขียนข้อมูล ส่วน `pnpm verify:resource-calc-seed` เป็น read-only verifier
ที่ไม่เขียนหรือลบ CouchDB

### Runtime demo

- [ ] บันทึก code fingerprint ก่อนรัน
- [ ] รัน on-demand ผ่าน `CalcStatusBadge`
- [ ] อ่าน `daily_calc:{date}` กลับจาก CouchDB
- [ ] เทียบผลกับการคำนวณมือครบ 20/20 แถว
- [ ] แยก canonical seed evidence ออกจาก manual demo occupancy 10 คน

### Governance

| ผู้รับรอง     | ขอบเขต                                          | สถานะ   | หลักฐาน |
| ------------- | ----------------------------------------------- | ------- | ------- |
| Team C / T-25 | ตรวจความเข้ากันได้ของ output contract           | pending | —       |
| Team A / T-29 | ตรวจ provenance และ `people_per_volunteer=null` | pending | —       |

การรับรองนี้ไม่รวมการ feed ไป Meal, Donation หรือ Volunteer เพราะ CR-042 เลื่อนงานดังกล่าวออกจาก R3

## Release status

งานจะเป็น `Done` เมื่อ Contract, Seed, Runtime และ Governance gates ผ่านครบ และไม่มี T-31 file
ที่ lint ไม่ผ่าน

ถ้า `pnpm lint` ล้มเฉพาะ formatting baseline เดิมในไฟล์นอก scope T-31 ให้บันทึกเป็น repository
baseline blocker และใช้สถานะ:

`Ready for Sign-off — repository lint baseline pending`

ห้ามเปลี่ยนเป็น `Done` จนกว่า repository release gate จะผ่านตามนโยบายโครงการ

สถานะปัจจุบันคือ `Ready for Sign-off — runtime CouchDB evidence และ repository lint baseline
ยังรออยู่` ไม่ใช่ `Done`: ชุดโค้ดและ test gate ผ่านแล้ว แต่ environment นี้ไม่มี CouchDB ที่
`127.0.0.1:5984` จึงยังยืนยันข้อมูลที่ persist จริงไม่ได้ และ `pnpm lint` ยังติด formatting baseline
เดิมในไฟล์นอก scope T-31

## Verification record

| Gate                         | ผลล่าสุด         | หลักฐาน                                                                   |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------- |
| Targeted resource-calc tests | PASS             | 7 files, 141 tests                                                        |
| Full test suite              | PASS             | 81 files passed, 965 tests passed, 1 skipped file                         |
| Domain coverage              | PASS             | 100% statements/branches/functions/lines                                  |
| Type/Svelte check            | PASS             | 0 errors, 0 warnings                                                      |
| T-31 scoped ESLint/Prettier  | PASS             | touched seed/verifier/validation files pass                               |
| Repository lint              | BASELINE PENDING | 9 pre-existing donation/docs files outside T-31                           |
| Runtime seed verifier        | PENDING          | CouchDB unavailable; verifier exited on connection refusal without writes |

## Evidence record

| รายการ                        | ค่า                                            |
| ----------------------------- | ---------------------------------------------- |
| Commit / worktree fingerprint | `HEAD cd9c2331` + uncommitted worktree changes |
| Seed verification timestamp   | pending                                        |
| Runtime demo timestamp        | pending                                        |
| CouchDB shelter               | `shelter_sh001`                                |
| Snapshot window               | `D-13 ... D`                                   |
| Target output                 | 14 snapshots × 20 canonical rows               |
