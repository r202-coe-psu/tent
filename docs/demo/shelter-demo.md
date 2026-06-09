# Shelter Operations — Demo Scenario

ระบบจำลองการจัดการ **ศูนย์พักพิง (shelter)** หลายแห่ง บน CouchDB + PouchDB
แบบ offline-first พร้อม RBAC สองชั้น. ใช้สาธิต multi-tenant isolation,
role-based write rules, และ event-sourced inventory.

---

## 1. Scenario

มีศูนย์พักพิง 3 แห่ง: **Shelter A / B / C** แต่ละแห่งแยกข้อมูลขาดจากกัน
(เจ้าหน้าที่ของศูนย์หนึ่งเห็น/แก้ได้เฉพาะศูนย์ตัวเอง).

แต่ละศูนย์มีเจ้าหน้าที่ 2 ระดับ:

| Role                | ทำอะไรได้                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **volunteer**       | รับคนเข้าศูนย์ (intake), จ่ายของออก (dispense)                                              |
| **shelter_manager** | ทุกอย่างของ volunteer + ตั้งค่าศูนย์ (capacity), เพิ่มสินค้า, เติมสต็อก (restock), ลบข้อมูล |

งานที่ระบบรองรับ:

1. **Intake** — รับคนเข้าศูนย์ (เช็คอิน) + กันรับเกินความจุ
2. **Shelter management** — กำหนด/แก้ความจุ, ดู occupancy ปัจจุบัน
3. **Inventory** — รายการสินค้าของแต่ละศูนย์
4. **Stock transaction** — ตัด/เติมสต็อก พร้อมประวัติ (event log)

---

## 2. Roles & Databases

แต่ละ shelter = **1 CouchDB database** (isolation ระดับ DB):

| Shelter | Database    | Roles                                      |
| ------- | ----------- | ------------------------------------------ |
| A       | `shelter_a` | `shelter_a_manager`, `shelter_a_volunteer` |
| B       | `shelter_b` | `shelter_b_manager`, `shelter_b_volunteer` |
| C       | `shelter_c` | `shelter_c_manager`, `shelter_c_volunteer` |

`_security.members.roles` ของแต่ละ DB = role ทั้ง 2 ของศูนย์นั้น →
user เข้าถึงได้เฉพาะ DB ที่ตรงกับ role ของตน.

**CouchDB server admin (`_admin`)** เข้าถึงได้ **ทุก shelter** (manager level) —
admin อ่าน/เขียนทุก DB และ bypass `validate_doc_update` ได้ตามกลไก CouchDB.
หน้า `/shelter` จึงแสดง switcher A/B/C ให้ admin สลับศูนย์ได้.

---

## 3. Data model (เอกสารในแต่ละ shelter DB)

| `type`           | `_id`                | ฟิลด์หลัก                                                         | เขียนได้โดย                                                    |
| ---------------- | -------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| `shelter_config` | `config` (singleton) | `name`, `capacity`, `shelterId`                                   | manager                                                        |
| `occupant`       | `occupant:<uuid>`    | `name`, `note`, `status` (`in`/`out`), `checkInAt`, `checkOutAt?` | ทุก member                                                     |
| `inventory_item` | `item:<uuid>`        | `name`, `unit`                                                    | manager                                                        |
| `stock_txn`      | `txn:<uuid>`         | `itemId`, `delta`, `reason`, `byUser`, `at`                       | dispense (delta<0) ทุก member; restock (delta>0) เฉพาะ manager |

### Inventory แบบ event-sourced

ไม่เก็บ `quantity` ลงบน item โดยตรง. จำนวนคงเหลือคำนวณจาก:

```
quantity(item) = Σ stock_txn.delta  (ของ item นั้น)
```

- `delta > 0` = เติมสต็อก (restock) / ตั้งต้น (opening stock)
- `delta < 0` = จ่ายออก (dispense)

ข้อดี: การแก้พร้อมกันตอน offline merge ได้โดยไม่เกิด update conflict
(ทุกการเปลี่ยนแปลงเป็น doc ใหม่ append เข้าไป ไม่ทับ doc เดิม).

---

## 4. RBAC สองชั้น

**ชั้นที่ 1 — DB-level (`_security`)**
isolation ระหว่างศูนย์: เห็น/sync ได้เฉพาะ DB ที่ role ตรง.

**ชั้นที่ 2 — Doc-level (`validate_doc_update`)**
แยกสิทธิ์ manager vs volunteer ภายใน DB เดียวกัน. ตรรกะ (ต่อ shelter):

```js
function (newDoc, oldDoc, userCtx) {
  if (userCtx.roles.indexOf('_admin') !== -1) return;          // admin ผ่าน
  var isManager = userCtx.roles.indexOf('shelter_x_manager') !== -1;

  if (newDoc._deleted) {                                        // ลบ
    if (!isManager) throw({ forbidden: 'only a manager can delete' });
    return;
  }
  if (newDoc.type === 'shelter_config' || newDoc.type === 'inventory_item') {
    if (!isManager) throw({ forbidden: 'manager role required' });
    return;
  }
  if (newDoc.type === 'stock_txn') {
    if (newDoc.delta > 0 && !isManager)                         // restock = manager
      throw({ forbidden: 'only a manager can restock' });
    return;                                                     // dispense = ทุก member
  }
  if (newDoc.type === 'occupant') return;                       // intake = ทุก member
  throw({ forbidden: 'unknown document type' });
}
```

> **Capacity guard** ตรวจฝั่ง client ตอน check-in เพราะ `validate_doc_update`
> อ่าน document อื่นไม่ได้ (นับจำนวน occupant ปัจจุบันไม่ได้ใน validation).

---

## 5. Flows หลัก

**Intake (รับคน)**
volunteer/manager กรอกชื่อ → ระบบนับ occupant ที่ `status='in'` เทียบ `capacity` →
ถ้ายังไม่เต็ม สร้าง `occupant` (status `in`) → ถ้าเต็ม โยน `ShelterFullError`.

**Check-out**
อัปเดต occupant เป็น `status='out'` + `checkOutAt`.

**Dispense (จ่ายของ)**
เลือก item + จำนวน → ตรวจว่าไม่เกินคงเหลือ (client) → append `stock_txn` delta ติดลบ.

**Restock / Add item (manager)**
เพิ่ม `inventory_item` หรือ append `stock_txn` delta บวก.

**Offline / re-sync**
ทำงานบน PouchDB local ได้ตลอดแม้ออฟไลน์. กลับมาออนไลน์ → sync อัตโนมัติ.
ถ้า session หมดอายุ → banner เตือนให้ login ใหม่เพื่อ sync (ไม่ไล่ออกจากแอป).

---

## 6. Demo accounts

สร้างจากหน้า **Admin → Shelter Setup → Setup** (1 manager + 1 volunteer ต่อศูนย์):

| Username    | Password        | Shelter            | Role      |
| ----------- | --------------- | ------------------ | --------- |
| `manager_a` | `manager_a1234` | A — Riverside Hall | manager   |
| `vol_a`     | `vol_a1234`     | A — Riverside Hall | volunteer |
| `manager_b` | `manager_b1234` | B — Central School | manager   |
| `vol_b`     | `vol_b1234`     | B — Central School | volunteer |
| `manager_c` | `manager_c1234` | C — Community Gym  | manager   |
| `vol_c`     | `vol_c1234`     | C — Community Gym  | volunteer |

**Seed config:** A capacity 50 / B 30 / C 20.
**Seed inventory** (ทุกศูนย์): Water bottle ×200, Blanket ×80, Food pack ×150, First-aid kit ×25.

---

## 7. การรันสาธิต

1. `docker compose up -d` (CouchDB)
2. `cd web && pnpm dev`
3. login เป็น admin → เมนู **Shelter Setup** → กด **Setup**
   (สร้าง 3 DB + `_security` + `validate_doc_update` + seed + 6 users)
4. logout → login เป็น `manager_a` / `vol_a` → เมนู **Shelter**
5. ทดลอง: check-in จนเต็ม capacity, dispense จนของหมด, ลอง restock ด้วย volunteer
   (ถูกปฏิเสธ), สลับ login ข้ามศูนย์ (เห็นเฉพาะศูนย์ตัวเอง)

**Reset:** หน้า Shelter Setup → **Teardown** (ลบ DB + users), **Verify** (ตรวจสถานะ).

---

## 8. Source layout

```
web/src/lib/features/shelter/
  domain/shelter.ts          # types, zod schemas, factories, role parser, derive fns (+ .test.ts)
  data/
    shelter.repository.ts    # persistence interface
    shelter.pouch.ts         # PouchDB impl (1 local DB ต่อ shelter)
    shelter.seed.ts          # seed users/config/items + validate_doc_update generator (pure)
    shelter.admin.ts         # client wrappers → /api/admin/shelter
  application/
    queries.ts               # tanstack-query hooks + capacity guard
    shelter-sync.ts          # start live sync ตาม role
  ui/                        # capacity-card, intake-form, occupant-list, inventory-panel
  index.ts                   # feature barrel

web/src/routes/
  (protected)/shelter/+page.svelte          # dashboard
  (protected)/admin/shelter/+page.svelte    # setup/teardown/verify UI
  api/admin/shelter/+server.ts              # privileged setup (admin creds server-side)
```
