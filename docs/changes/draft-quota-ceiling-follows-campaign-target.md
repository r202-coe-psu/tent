---
id: draft
title: เพดานโควตาผู้บริจาคต้องขยับตามเป้าหมายแคมเปญ — ยกเลิก CR-060 FR-2
status: proposed
date: 2026-09-16
requested_by: เจ้าของโครงการ (พบระหว่างตรวจฟอร์ม Edit Campaign — alert บอกว่าแก้เป้าแล้วโควตาไม่ขยับ)
decided_by: <รอเจ้าของโครงการ>
layer: volatile
affects:
  - docs/changes/CR-060-donation-need-counter-worker-seed.md (ยกเลิก FR-2, แก้ Decision log)
  - worker/src/worker/quota_target_rules.py (ใหม่ — กติกาเดียวที่ทั้ง CDC path และ CLI ใช้)
  - worker/src/worker/mongo/donation_need_counter.py (apply_need_counters — เพิ่ม realign)
  - worker/src/worker/quota/reconcile.py (เรียกกติกาเดียวกันแทน inline)
  - worker/tests/test_donation_need_counter.py
  - frontend/src/routes/(protected)/back-office/stock-donations/components/edit-campaign-form.svelte
why: FR-2 ตรึงเพดานโควตาไว้ตั้งแต่สร้างประกาศ ทำให้ฟีเจอร์ "แก้เป้าหมาย" ใช้งานไม่ได้จริง — กระดานกับการ์ดสาธารณะขึ้นเลขใหม่ แต่ผู้บริจาคยังถูกปฏิเสธที่เพดานเดิม
migration: N/A ต่อ schema_v — ไม่เปลี่ยนรูป doc; counter ที่ค้างอยู่จะถูกดึงให้ตรงเองเมื่อแคมเปญนั้นถูกแก้ครั้งถัดไป หรือสั่ง `donation-quota recalculate --targets` ทันที
---

# draft — เพดานโควตาผู้บริจาคต้องขยับตามเป้าหมายแคมเปญ

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ให้ worker ขยับ `donation_need_counter.qty_target` ตามที่เจ้าหน้าที่แก้ใน
  `donation_campaign.needs[].qty_target` — แทนที่จะตรึงไว้ค่าเดิมตลอด (**ยกเลิก CR-060 FR-2**)
- **ยกเว้นกรณีเดียว:** ห้ามลดเพดานต่ำกว่า `reserved_qty` (ยอดที่ผู้บริจาคจองไว้แล้ว) — worker ปฏิเสธ
  และฟอร์มบล็อกตั้งแต่ต้นทาง
- **เพื่อใคร/ทำไม:** วันนี้เจ้าหน้าที่แก้เป้าหมายแล้ว "ไม่มีอะไรเกิดขึ้น" กับผู้บริจาค ต้องให้ผู้ดูแลระบบ
  สั่ง CLI เองถึงจะมีผล ซึ่งไม่ใช่ขั้นตอนที่ศูนย์พักพิงทำได้
- **dev ต้อง build:** เพิ่ม realign ใน `apply_need_counters` + ยกกติกา "ห้ามลดต่ำกว่าที่จอง" ออกมาเป็น
  โมดูลร่วม + บล็อกที่ฟอร์ม + ลบ alert ที่อธิบายข้อจำกัดเดิม
- **กระทบ schema:** ไม่มี — ไม่เปลี่ยนรูป doc ใด ๆ

## Why

### ปัญหาที่เจอ

ฟอร์ม Edit Campaign แสดง alert ถาวรว่า:

> เปลี่ยนเป้าหมายแล้ว แต่โควตาฝั่งผู้บริจาคจะยังไม่ขยับ — … ผู้บริจาคจะยังถูกปฏิเสธด้วย
> "รายการนี้รับบริจาคครบแล้ว" ที่เพดานเดิม จนกว่าผู้ดูแลระบบจะปรับ `donation_need_counter` ให้ตรงกัน

alert นี้พูดความจริง แต่สิ่งที่มันอธิบายคือ **ฟีเจอร์ที่ทำงานไม่ครบ**: เจ้าหน้าที่ศูนย์แก้เป้าหมายได้
กระดานหลังบ้านและการ์ดหน้าบริจาคขึ้นเลขใหม่ทันที แต่ประตูที่ตรวจผู้บริจาคจริงยังอยู่ที่เลขเก่า
การปิดช่องว่างต้องให้คนที่เข้าถึง shell ของ worker ได้สั่ง
`donation-quota recalculate --shelter <CODE> --targets` เอง — ไม่ใช่งานที่ศูนย์พักพิงทำได้

CR-060 §Decision log เรียกอาการนี้เองว่า **"Known consequence"** — รับรู้ว่าเป็นหนี้ ไม่ใช่คุณสมบัติที่ต้องการ

### ทำไม FR-2 ถึงไม่จำเป็นอีกต่อไป

FR-2 กำหนดว่า `qty_target` เขียนด้วย `$setOnInsert` เท่านั้น ด้วยเหตุผล 2 ข้อ
(`seed_counter` docstring) — ตรวจโค้ดจริงแล้วทั้งสองข้อไม่ผูกมัด:

| เหตุผลเดิม | ผลการตรวจ |
| --- | --- |
| "กันเพดานขยับใต้ booking ที่กำลังวิ่ง" | FastAPI จองด้วย `find_one_and_update` + `$expr` และ worker เขียนด้วย `find_one_and_update` เหมือนกัน — **single-document atomic ทั้งคู่** MongoDB serialize ให้ ไม่มีทาง interleave กลางคัน |
| "replay จาก checkpoint เก่าเป็น no-op โดยอัตโนมัติ" | `_changes` ถูกอ่านด้วย `include_docs=true` (`couch/client.py`) ซึ่งคืน **revision ปัจจุบัน** ไม่ใช่ของ ณ sequence นั้น → replay เขียนค่าปัจจุบัน ไม่ใช่ค่าย้อนหลัง; `set_qty_target` ยังมี optimistic filter (`qty_target: expected`) ซ้อนอีกชั้น |

**สิ่งที่ต้องกันจริงมีข้อเดียว** — ลดเพดานต่ำกว่า `reserved_qty` ซึ่งทำให้ invariant
`reserved_qty ≤ qty_target` พัง และ guard ตัวนั้น **เขียนไว้แล้ว** ที่ `quota/reconcile.py`
เพียงแต่เรียกได้จาก CLI เท่านั้น

## Change

### Before

```
เจ้าหน้าที่แก้ qty_target → CouchDB
        ↓ CDC
seed_counter()  $setOnInsert  → counter มีอยู่แล้ว ⇒ no-op
        ↓
public_needs recompute → การ์ดขึ้นเลขใหม่
donation_need_counter  → เพดานค้างที่เลขเก่า
        ↓
ผู้บริจาคเห็น "ยังขาด" แต่กดจองแล้วเด้ง NEED_FULL
```

### After

```
เจ้าหน้าที่แก้ qty_target → CouchDB
        ↓ CDC
apply_need_counters()
  ├─ counter ยังไม่มี → seed_counter()            (เหมือนเดิม)
  └─ counter มีแล้ว   → decide_target_change()
                        ├─ UNCHANGED              → ไม่เขียน
                        ├─ APPLY                  → set_qty_target()
                        └─ REFUSED_BELOW_RESERVED → ไม่เขียน + log error
```

- กติกาตัดสินอยู่ที่ `worker/quota_target_rules.py` — pure, ไม่มี I/O, ใช้ร่วมกันระหว่าง CDC path
  กับ `donation-quota recalculate --targets` เพื่อไม่ให้สองทางตอบไม่ตรงกัน
  (โมดูลวางไว้ระดับ flat แบบ `worker.donation_status` เพราะ import `worker.quota.*` จะวน
  กลับมาที่ `worker.mongo`)
- ฝั่ง CDC อ่าน `reserved_qty` ที่เก็บไว้อย่างเดียว ไม่ recompute จาก `DonationBuffer` เหมือน CLI —
  การ scan donation ทั้งศูนย์ทุกครั้งที่แก้แคมเปญจะทำให้ change feed ตามไม่ทัน ค่าที่อ่านได้
  **ล้าหลังได้ทางเดียว** (FastAPI `$inc` ทันทีที่รับจอง) การปฏิเสธที่คำนวณจากค่านี้จึงอนุรักษ์นิยมเสมอ
- `donation-quota recalculate --targets` **ยังอยู่** ในฐานะเครื่องมือ DR (ซ่อม counter ที่หลุด sync
  หรือดึงให้ตรงทันทีโดยไม่รอแคมเปญถูกแก้) แต่ไม่ใช่ทางเดียวอีกต่อไป

### ฝั่ง UI

- ฟอร์ม Edit Campaign **บล็อกการบันทึก** เมื่อเป้าหมายต่ำกว่ายอดที่ผู้บริจาคจองไว้ พร้อมบอกว่าให้ใช้
  **Force Cut-off** แทนถ้าต้องการหยุดรับ
- ลบ alert "เปลี่ยนเป้าหมายแล้ว แต่โควตาฝั่งผู้บริจาคจะยังไม่ขยับ" — ไม่เป็นความจริงอีกต่อไป

## Requirements

- **FR-1** — CDC event ของ `donation_campaign` ที่ `status: open` ต้องดึง `qty_target` ของ counter
  ที่มีอยู่แล้วให้ตรงกับ `needs[].qty_target` ปัจจุบัน
- **FR-2** — ต้องปฏิเสธการลดเพดานต่ำกว่า `reserved_qty` ของ counter นั้น และบันทึก log ระดับ `error`
  โดยไม่เขียนค่าใด ๆ
- **FR-3** — การลดเพดานลงมา **เท่ากับ** `reserved_qty` พอดีต้องทำได้ (need เต็มพอดี ไม่ใช่เกิน)
- **FR-4** — worker ยังห้ามแตะ `reserved_qty` (คง CR-060 FR-3 เดิมทุกประการ)
- **FR-5** — การเขียนต้องใช้ optimistic filter เดิมของ `set_qty_target`; เมื่อชนกันให้ปล่อยผ่าน
  พร้อม log ห้าม retry ในตัว handler (จะบล็อก change feed)
- **FR-6** — ฟอร์ม Edit Campaign ต้องไม่ยอมให้บันทึกเป้าหมายที่ต่ำกว่ายอดจอง
- **FR-7** — กติกาตัดสินต้องเป็นโค้ดชุดเดียวที่ทั้ง CDC path และ CLI เรียกใช้

## Impact

- **ยกเลิก CR-060 FR-2** — ต้องแก้ CR-060 ให้ชี้มาที่ CR นี้ และแก้ Decision log ที่ระบุว่าปิด gap ได้
  ด้วย CLI เท่านั้น
- เทสต์ `test_replaying_campaign_does_not_move_qty_target` (ซึ่ง pin FR-2 ไว้) ถูกแทนที่ด้วยชุดใหม่:
  ขยับขึ้น / ขยับลงได้ / ปฏิเสธเมื่อต่ำกว่าที่จอง / ลดลงมาเท่ากับที่จอง / replay ค่าเดิมเป็น no-op
- `apply_need_counters` เปลี่ยน return จาก `int` เป็น `tuple[int, int]` (`created`, `realigned`) —
  ผู้เรียกทั้งหมด (`processor.py`, `bootstrap.py`, `cli/donation_quota.py`) ไม่ได้ใช้ค่านี้อยู่แล้ว
- ไม่กระทบ `public_needs` / `shelter_stocks` / partner API
- ไม่ bump `schema_v` — ไม่มี field ใดเปลี่ยนรูป

## Migration

N/A ต่อ `schema_v`

counter ที่ปัจจุบันเพดานไม่ตรงกับแคมเปญจะถูกดึงให้ตรงเองเมื่อแคมเปญนั้นถูกแก้ครั้งถัดไป
ถ้าต้องการให้ตรงทันทีทั้งระบบ สั่ง:

```bash
uv run --project worker donation-quota recalculate --shelter <CODE> --targets
```

(รันแบบ dry-run ก่อนได้ — ดู `--apply` ใน CLI) counter ที่ยอดจองสูงกว่าเป้าใหม่จะถูกรายงานเป็น
`qty_target refused (below reserved)` และต้องตัดสินรายกรณี (ปิด need หรือยกเลิกการจองก่อน)

## Acceptance

- [ ] **AC-01** — แก้เป้าหมายจาก 100 → 999 บนฟอร์ม แล้วผู้บริจาคจองได้ถึง 999 โดยไม่ต้องสั่ง CLI
- [ ] **AC-02** — แก้เป้าหมายจาก 100 → 30 โดยมียอดจอง 20 → บันทึกได้ และเพดานเป็น 30
- [ ] **AC-03** — แก้เป้าหมายเป็น 5 โดยมียอดจอง 20 → ฟอร์มปฏิเสธพร้อมข้อความชี้ไป Force Cut-off
- [ ] **AC-04** — เขียน `qty_target: 5` ลง CouchDB ตรง ๆ (ข้ามฟอร์ม) โดยมียอดจอง 20 → worker ไม่เขียน
      และ log `refusing to lower qty_target …`
- [ ] **AC-05** — replay CDC ด้วยค่าเดิม → ไม่มีการเขียน (`created, realigned == 0, 0`)
- [ ] **AC-06** — `reserved_qty` ไม่เปลี่ยนค่าในทุกเคสข้างบน

## Decision log

- 2026-09-16 — proposed: พบระหว่างตรวจฟอร์ม Edit Campaign ว่า alert อธิบายข้อจำกัดที่ทำให้ฟีเจอร์
  แก้เป้าหมายใช้งานไม่ได้จริง เจ้าของโครงการสั่งให้แก้ที่ต้นเหตุ ไม่ใช่แก้ข้อความ alert
  — **รอเจ้าของโครงการเคาะ `approved` + รันเลข CR-NNN**
