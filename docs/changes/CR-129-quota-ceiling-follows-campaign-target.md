---
id: CR-129
title: เพดานโควตาผู้บริจาคต้องขยับตามเป้าหมายแคมเปญ — ยกเลิก CR-060 FR-2
status: approved
date: 2026-09-16
updated: 2026-10-03 # approved โดยเจ้าของโครงการ (PR #287) + รันเลข CR-129 และลงทะเบียนใน _index.md
requested_by: เจ้าของโครงการ (พบระหว่างตรวจฟอร์ม Edit Campaign — alert บอกว่าแก้เป้าแล้วโควตาไม่ขยับ)
decided_by: เจ้าของโครงการ (2026-10-03, PR #287)
layer: volatile
affects:
  - docs/changes/CR-060-donation-need-counter-worker-seed.md (ยกเลิก FR-2, แก้ Decision log)
  - worker/src/worker/quota_target_rules.py (ใหม่ — กติกาเดียวที่ทั้ง CDC path และ CLI ใช้)
  - worker/src/worker/mongo/donation_need_counter.py (apply_need_counters — เพิ่ม realign)
  - worker/src/worker/quota/reconcile.py (เรียกกติกาเดียวกันแทน inline)
  - packages/tent-model/src/tent_model/donation_need_counter_ops.py (set_qty_target — เพิ่มเงื่อนไข reserved_qty ใน filter)
  - worker/tests/test_donation_need_counter.py
  - frontend/src/routes/(protected)/back-office/stock-donations/components/edit-campaign-form.svelte
why: FR-2 ตรึงเพดานโควตาไว้ตั้งแต่สร้างประกาศ ทำให้ฟีเจอร์ "แก้เป้าหมาย" ใช้งานไม่ได้จริง — กระดานกับการ์ดสาธารณะขึ้นเลขใหม่ แต่ผู้บริจาคยังถูกปฏิเสธที่เพดานเดิม
migration: N/A ต่อ schema_v — ไม่เปลี่ยนรูป doc; counter ที่ค้างอยู่จะถูกดึงให้ตรงเองเมื่อแคมเปญนั้นถูกแก้ครั้งถัดไป หรือสั่ง `donation-quota recalculate --targets` ทันที
---

# CR-129 — เพดานโควตาผู้บริจาคต้องขยับตามเป้าหมายแคมเปญ

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
| "กันเพดานขยับใต้ booking ที่กำลังวิ่ง" | การจอง (FastAPI) กับการเขียนเพดาน (worker) atomic แค่ทีละคำสั่ง แต่ขั้น "อ่าน `reserved_qty` → ตัดสิน → เขียน" ของ worker มีสองจังหวะ booking แทรกตรงกลางได้ เหตุผลนี้จึง**ยังใช้อยู่** แต่แก้ได้โดยไม่ต้องตรึงเพดาน: ใส่เงื่อนไขยอดจองไว้ใน filter ของ update ตัวเดียวกัน (ดู FR-2) |
| "replay จาก checkpoint เก่าเป็น no-op โดยอัตโนมัติ" | `_changes` ถูกอ่านด้วย `include_docs=true` (`couch/client.py`) ซึ่งคืน **revision ปัจจุบัน** ไม่ใช่ของ ณ sequence นั้น → replay เขียนค่าปัจจุบัน ไม่ใช่ค่าย้อนหลัง; `set_qty_target` ยังมี optimistic filter (`qty_target: expected`) ซ้อนอีกชั้น |

**สิ่งที่ต้องกันจริงมีข้อเดียว** — ลดเพดานต่ำกว่า `reserved_qty` ซึ่งทำให้ invariant
`reserved_qty ≤ qty_target` พัง และ guard ตัวนั้น **เขียนไว้แล้ว** ที่ `quota/reconcile.py`
เพียงแต่เรียกได้จาก CLI เท่านั้น — และต้องย้ายเงื่อนไขเข้าไปอยู่ใน update คำสั่งเดียวกับการเขียน
(FR-2) ไม่อย่างนั้น booking ที่แทรกระหว่างอ่านกับเขียนจะทำให้ invariant พังได้

**ตั้งใจไม่นับ `on_hand_qty`** — การจองใช้เพดานจริง `qty_target − on_hand_qty`
(`tent_model.donation_need_counter_ops.reserve_quota`) แต่ guard นี้กันแค่ `reserved_qty ≤ qty_target`
เพราะ:

- สิ่งที่ CR นี้ต้องกันคือ "ห้ามทิ้งยอดที่ผู้บริจาคจองไว้แล้ว" — ซึ่งกันได้ครบด้วย `reserved_qty` อย่างเดียว
- `on_hand_qty` ขยับเองตาม stock ledger (`worker/mongo/on_hand.py`) นอก guard นี้อยู่แล้ว ต่อให้เช็ค
  `reserved_qty + on_hand_qty ≤ qty_target` ตอนแก้เป้า ของเข้าคลังครั้งถัดไปก็ทำให้เกินได้อยู่ดี
- ถ้าเพดานจริงติดลบหรือเต็มเพราะของในคลัง ผลคือผู้บริจาครายใหม่ถูกปฏิเสธ `NEED_FULL` เท่านั้น
  ยอดที่จองไว้แล้วไม่ถูกกระทบ

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
  การ scan donation ทั้งศูนย์ทุกครั้งที่แก้แคมเปญจะทำให้ change feed ตามไม่ทัน ค่าที่อ่านก่อนตัดสิน
  ใช้แค่กรองเคสที่เห็นชัดกับเขียน log — **ห้ามใช้เป็นตัวรับประกัน** เพราะค่านี้ล้าหลังได้ (มีคนจองเพิ่ม
  หลังอ่าน) ซึ่งทำให้ยอมลดเพดานทั้งที่ไม่ควร ตัวรับประกันจริงคือเงื่อนไขใน filter ของ update (FR-2)
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
  โดยไม่เขียนค่าใด ๆ — การขยับเพดานต้องเป็น conditional update คำสั่งเดียว filter มีทั้ง
  `qty_target: <ค่าที่อ่านมา>` และ `$expr: reserved_qty ≤ <เป้าใหม่>` (ไม่นับ `on_hand_qty` — ดู §Why)
  การเช็คด้วยค่าที่อ่านไว้ก่อนอย่างเดียวไม่พอ
- **FR-3** — การลดเพดานลงมา **เท่ากับ** `reserved_qty` พอดีต้องทำได้ (need เต็มพอดี ไม่ใช่เกิน)
- **FR-4** — worker ยังห้ามแตะ `reserved_qty` (คง CR-060 FR-3 เดิมทุกประการ)
- **FR-5** — การเขียนต้องใช้ optimistic filter ของ `set_qty_target` (รวมเงื่อนไขใน FR-2); filter ไม่ match
  ได้ 2 สาเหตุ — เป้าถูกแก้ซ้อน หรือยอดจองขึ้นจนเกินเป้าใหม่ — ทั้งสองกรณีให้ปล่อยผ่านพร้อม log
  ห้าม retry ในตัว handler (จะบล็อก change feed)
- **FR-6** — ฟอร์ม Edit Campaign ต้องไม่ยอมให้บันทึกเป้าหมายที่ต่ำกว่ายอดจอง
- **FR-7** — กติกาตัดสินต้องเป็นโค้ดชุดเดียวที่ทั้ง CDC path และ CLI เรียกใช้

## Impact

- **ยกเลิก CR-060 FR-2** — แก้ CR-060 ให้ชี้มาที่ [CR-129](CR-129-quota-ceiling-follows-campaign-target.md)
  และแก้ Decision log ที่ระบุว่าปิด gap ได้ด้วย CLI เท่านั้น
- `set_qty_target` (`tent-model`) เพิ่มเงื่อนไข `reserved_qty` ใน filter — CLI `--targets` ได้ guard
  แบบ atomic ไปด้วย
- เทสต์ `test_replaying_campaign_does_not_move_qty_target` (ซึ่ง pin FR-2 ไว้) ถูกแทนที่ด้วยชุดใหม่:
  ขยับขึ้น / ขยับลงได้ / ปฏิเสธเมื่อต่ำกว่าที่จอง / ลดลงมาเท่ากับที่จอง / replay ค่าเดิมเป็น no-op /
  จองแทรกระหว่างอ่านกับเขียนเพดาน
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
- [ ] **AC-02** — แก้เป้าหมายจาก 100 → 30 โดยมียอดจอง 20 และ `on_hand_qty = 0` → บันทึกได้ และเพดานเป็น 30
- [ ] **AC-03** — แก้เป้าหมายเป็น 5 โดยมียอดจอง 20 → ฟอร์มปฏิเสธพร้อมข้อความชี้ไป Force Cut-off
- [ ] **AC-04** — เขียน `qty_target: 5` ลง CouchDB ตรง ๆ (ข้ามฟอร์ม) โดยมียอดจอง 20 → worker ไม่เขียน
      และ log `refusing to lower qty_target …`
- [ ] **AC-05** — replay CDC ด้วยค่าเดิม → ไม่มีการเขียน (`created, realigned == 0, 0`)
- [ ] **AC-06** — `reserved_qty` ไม่เปลี่ยนค่าในทุกเคสข้างบน (ยกเว้นการจองที่ผ่านใน AC-07)
- [ ] **AC-07** — การจองกับการลดเป้าเกิดพร้อมกัน (เป้า 100 → 30, ยอดจอง 20 แล้วมีคนจองเพิ่ม 50)
      ทุกลำดับที่เกิดได้ ผลสุดท้ายต้องไม่มีสถานะ `reserved_qty > qty_target` — จบที่อย่างใดอย่างหนึ่ง:
      เป้า 30 + การจองถูกปฏิเสธ `NEED_FULL` หรือยอดจอง 70 + เป้าค้างที่ 100 พร้อม log

## Decision log

- 2026-09-16 — proposed: พบระหว่างตรวจฟอร์ม Edit Campaign ว่า alert อธิบายข้อจำกัดที่ทำให้ฟีเจอร์
  แก้เป้าหมายใช้งานไม่ได้จริง เจ้าของโครงการสั่งให้แก้ที่ต้นเหตุ ไม่ใช่แก้ข้อความ alert
  — **รอเจ้าของโครงการเคาะ `approved` + รันเลข CR-NNN**
- 2026-10-02 — review พบว่าโค้ดที่ merge ไปแล้ว (`a9820c2f`) มี race ระหว่างการจองกับการลดเพดาน
  (อ่าน `reserved_qty` แล้วค่อยเขียน) แก้ FR-2 ให้เป็น conditional update และเพิ่ม AC-07
  เจ้าของโครงการเลือกไม่นับ `on_hand_qty` ใน guard นี้ (เหตุผลใน §Why) — โค้ดแก้แยก PR
- 2026-10-03 — approved โดยเจ้าของโครงการ ผ่าน PR review #287 — รันเลข CR-129 และลงทะเบียนใน `docs/changes/_index.md` (ยกเลิก CR-060 FR-2 อย่างเป็นทางการ)
