---
id: draft
title: public_needs — เปิด qty_target / on_hand / reserved / category ออกสู่หน้าเว็บสาธารณะ
status: proposed
date: 2026-09-02
requested_by: "field test — เจ้าของโครงการรายงานบั๊ก 2026-09-01 (จองไว้ รอส่งมอบ = 0 ทุกการ์ด)"
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/data/couchdb-mongodb-sync.md §projection `public_needs` (field allow-list)
  - docs/data/api-contract.md §`GET /public/v1/needs`
  - packages/tent-model/src/tent_model/public_need.py
  - backend/apiapp/modules/needs/{schemas.py,use_case.py}
  - worker/src/worker/projectors/{needs.py,compute_needs.py}
  - frontend/src/lib/components/{public-donor-needs,needs-board-admin}.svelte
  - frontend/src/lib/api-specs/fastapi.json + frontend/src/lib/api/openapi.d.ts (regenerated)
why: หน้าเว็บผู้บริจาควาดความคืบหน้าจากตัวเลขที่คิดขึ้นเองเพราะ projection ไม่เคยส่งตัวตั้งออกมา
migration: ไม่ bump schema_v (เป็น Mongo projection ไม่ใช่ doc ที่ persist ใน CouchDB) — ดู §Migration
---

# public_needs — เปิดตัวตั้งของ "ยังขาดอีกเท่าไร" ออกสู่หน้าเว็บสาธารณะ

## Why

`public_needs` ส่งออกมาแค่ **ผลลัพธ์** (`qty_needed` = ยังขาดเท่าไร) ไม่เคยส่ง **ตัวตั้ง** ที่ทำให้เกิดตัวเลขนั้น
แต่หน้าเว็บผู้บริจาคต้องการวาดแถบความคืบหน้าและบอกว่า "ได้รับแล้วเท่าไร / จองไว้เท่าไร / เป้าหมายเท่าไร"

ผลคือ component ไปแต่งตัวเลขขึ้นมาเองเพื่อให้มีอะไรวาด:

```
target   = qty_needed × 2      // ⇒ ทุกการ์ดโชว์ 50% เท่ากันหมด
received = target − qty_needed
reserved = 0                   // ⇒ ทุกการ์ดโชว์ "จองไว้ รอส่งมอบ: 0"
```

เจ้าของโครงการเจอเองตอนทดสอบจริง (2026-09-01) ว่า "จองไว้ รอส่งมอบ: 0 กก. มันขึ้นแบบนี้ทุกอันเลย"
— **นี่คือข้อมูลปลอมบนหน้าจอที่ประชาชนใช้ตัดสินใจบริจาค** ผู้บริจาคเห็นว่าศูนย์ขาดเท่ากันหมด
ทั้งที่บางรายการมีคนจองไว้เกือบเต็มแล้ว ⇒ ของไปกองผิดที่

**บั๊กที่สองที่แก้พร้อมกัน:** `NeedItemResponse` ไม่เคยส่ง `category` ออกมา (ทั้งที่ projection เก็บไว้ตั้งแต่แรก)
ฟอร์มบริจาคจึงไม่มีอะไรใช้เดาหมวดหมู่ แล้ว default เป็น `"อาหาร/เครื่องดื่ม"` ทุกใบ
⇒ ผ้าห่มถูกยื่นเข้าระบบเป็นอาหาร (ขัด `schema.md §2.3 items[].category`)

## Change

### 1. `docs/data/couchdb-mongodb-sync.md` — field allow-list ของ `public_needs`

เอกสารระบุหลักการไว้ชัดว่า **"allow-list field เท่านั้น — projector มี whitelist ตายตัวต่อ type;
field ใหม่ใน CouchDB ไม่หลุดไป Mongo เองจนกว่าจะเพิ่มใน whitelist (กัน PII leak โดยอุบัติเหตุ)"**
⇒ การเพิ่ม field จึงต้องแก้เอกสารนี้ ไม่ใช่แก้แต่โค้ด

**Before**

```js
{
  _id: ("{shelter_code}:item:01H...",
    shelter_code,
    item_name,
    category,
    qty_needed,
    unit,
    updated_at);
}
```

**After**

```js
{
  _id: ("{shelter_code}:item:01H...",
    shelter_code,
    item_name,
    category,
    qty_needed,
    unit,
    qty_target,
    on_hand,
    reserved,
    updated_at);
}
// invariant: qty_needed = max(0, qty_target − on_hand − reserved)
// qty_target = ผลรวม needs[].qty_target ของ open campaigns ที่ visible_on_home ≠ false
// on_hand    = ยอดคงเหลือจาก stock_ledger ของศูนย์
// reserved   = ของที่จองแล้วยังไม่ส่ง (QUOTA_HOLDING_STATUSES) — ไม่นับซ้ำกับ on_hand
```

### 2. `GET /public/v1/needs` — response ของ `NeedItemResponse`

| Field        | Before                           | After                |
| ------------ | -------------------------------- | -------------------- |
| `qty_target` | —                                | `str`, default `"0"` |
| `on_hand`    | —                                | `str`, default `"0"` |
| `reserved`   | —                                | `str`, default `"0"` |
| `category`   | มีใน projection แต่**ไม่ส่งออก** | `str \| None`        |

เป็น **additive change** ทั้งหมด — ไม่มี field ไหนถูกลบหรือเปลี่ยนชนิด ⇒ client เก่าไม่พัง
ส่งเป็น `str` ด้วยเหตุผลเดียวกับ `qty_needed` เดิม (จำนวนข้ามสายไม่ให้ติด float error)

### 3. โค้ดที่ทำให้เกิดขึ้นจริง (ทำไปแล้วบน `team-A-donation`)

- `worker/projectors/compute_needs.py` — เพิ่ม `need_breakdown()` **เป็นฟังก์ชันพี่น้อง ไม่แตะ `compute_needs`**
  (เจตนา: `compute_needs` ถูกล็อกด้วย parity fixture ข้าม TS/Python/BFF ใน `packages/needs-fixtures` อยู่ — แตะแล้ว harness พัง)
- `worker/projectors/needs.py` — upsert ฟิลด์ใหม่ + กรอง campaign ตาม `visible_on_home` (CR-034)
- `packages/tent-model/public_need.py` — 3 ฟิลด์ `float = 0.0` (มี default เพื่อให้แถวเก่าที่ project ไว้ก่อนหน้ายังโหลดได้)
- `backend/.../needs/{schemas.py,use_case.py}` — ส่งออกทาง API
- `frontend` — `public-donor-needs.svelte` เลิกแต่งเลข, `needs-board-admin.svelte` เพิ่มคอลัมน์ "ยอดในคลัง (On-hand)"

## Impact

| ชั้น        | กระทบอะไร                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Docs        | `couchdb-mongodb-sync.md` §projection, `api-contract.md` §`GET /public/v1/needs`                                                 |
| Worker      | projector เขียนฟิลด์เพิ่ม — **ต้อง re-project ถึงจะมีค่า** (ดู Migration)                                                        |
| Model / API | `PublicNeed`, `NeedItemResponse` — additive                                                                                      |
| Frontend    | หน้า `/donate` + กระดานหลังบ้าน · `openapi.d.ts` regenerate แล้ว                                                                 |
| Test        | `worker/tests/projectors/test_needs_projection.py` 9 เคส (รวมเคสยืนยัน invariant `qty_needed = qty_target − on_hand − reserved`) |
| Client อื่น | ไม่มี — additive ล้วน                                                                                                            |

## ⚠️ คำถามเชิงนโยบายที่ต้องเคาะพร้อมกัน

**ยอดของในคลังของศูนย์ (`on_hand`) เปิดสาธารณะได้หรือไม่?**

ตอนนี้ implement แบบ**เปิด** เพราะมันคือตัวตั้งของ "ยังขาดอีกเท่าไร" ที่ผู้บริจาคต้องเห็นเพื่อตัดสินใจ
แต่ถ้าถือว่าเป็นข้อมูลอ่อนไหว (เปิดเผยว่าศูนย์ไหนของหมด — อาจกระทบความปลอดภัย/ภาพลักษณ์)
ต้องเลือกอย่างใดอย่างหนึ่ง:

| ทางเลือก                           | ผล                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| **(ก) เปิดต่อ** _(ผู้เสนอแนะนำ)_   | ผู้บริจาคเห็นความจริง · ไม่มีของก็คือไม่มี · การปิดจะทำให้ต้องกลับไปเดาเลขอีก                       |
| (ข) ส่งแค่ `%` ความคืบหน้า         | ซ่อนยอดดิบ แต่ยัง reverse-engineer ได้ถ้ารู้ `qty_target`                                           |
| (ค) ส่งแค่ `qty_needed` เหมือนเดิม | ปลอดภัยที่สุด แต่**ย้อนกลับไปสู่ปัญหาเดิมทั้งหมด** — แถบความคืบหน้าต้องถูกถอดออก ไม่ใช่แต่งขึ้นใหม่ |

> **ข้อสรุปการตัดสินใจจากเจ้าของโครงการ (2026-09-03):**  
> เคาะเลือก **(ค) ส่งแค่ `qty_needed` เหมือนเดิม ไม่เปิดเผยยอดจริงในคลัง (`on_hand`) สู่สาธารณะ** เพื่อลดปัญหาดราม่าเรื่องการกระจายทรัพยากรและความปลอดภัยของศูนย์พักพิง โดยให้ถอดแถบความคืบหน้า (Progress Bar) ที่แต่งตัวเลขออก และส่งออกเฉพาะสิ่งที่ยังขาดจริง (`use_case.py` และ UI ปลายทางต้องปรับตามข้อนี้)


## Migration

**ไม่ bump `schema_v`** — `public_needs` เป็น projection ใน MongoDB ที่ derive จาก CouchDB
ไม่ใช่ doc ที่ persist เป็นแหล่งความจริง กฎ `schema_v` ใน change-management §4 จึงไม่เข้าเงื่อนไข
(ไม่มี doc เดิมใน CouchDB ที่ต้องแปลงรูปร่าง)

**สิ่งที่ต้องทำตอน deploy:**

1. แถวที่ project ไว้ก่อนหน้าจะ**ไม่มี**สามฟิลด์นี้ — model กำหนด default `0.0` ไว้แล้ว จึงโหลดได้ปกติ
   ไม่มี downtime แต่การ์ดจะโชว์ `0` จนกว่าจะ re-project
2. ให้ค่าเข้าครบด้วยวิธีใดวิธีหนึ่ง:
   - รอ CDC ปกติ (แถวจะอัปเดตเองเมื่อ `donation` / `donation_campaign` / `supply_item` ของศูนย์นั้นขยับ) หรือ
   - บังคับทันที: `uv run --project worker sync-worker --bootstrap`
3. ลำดับ deploy: **worker + model ก่อน → backend → frontend** (frontend อ่านฟิลด์ที่อาจยังไม่มี
   แต่ default `"0"` รองรับอยู่แล้ว จึงไม่ล้ม)

## Decision log

- 2026-09-02 — proposed (ยังไม่รันเลข CR ตาม change-management §3)
- 2026-09-03 — เจ้าของโครงการเคาะอนุมัตินโยบายเลือกทางเลือก (ค) ไม่เปิดเผยยอด on_hand สู่สาธารณะ เพื่อป้องกันดราม่าเรื่องทรัพยากร

