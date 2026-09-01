---
title: Smart Shelter — Change Management Policy
status: active
created: 2026-06-16
updated: 2026-09-01
note: หลักการกำกับการเปลี่ยนแปลงเอกสาร (spec/docs) ของทั้งโครงการ — บังคับกับ docs/ ทั้งหมด
---

# Change Management Policy

โครงการนี้เป็น **งานวิจัย**: requirement ยัง gather ไม่ครบแต่ build เริ่มไปแล้ว และ spec จะถูก
ปรับแก้ตลอดอายุโครงการ (12 เดือน). เอกสารนี้กำหนด **หลักการเดียว** ที่ทุกการเปลี่ยนแปลง spec/docs
ต้องทำตาม เพื่อให้ trace กลับได้ว่า *อะไรเปลี่ยน เปลี่ยนเมื่อไร เพราะอะไร ใครเคาะ กระทบอะไร* —
สำคัญทั้งกับการ implement และกับการเขียน paper/รายงานภายหลัง

> **กฎเหล็ก:** ห้ามแก้ spec แบบเงียบๆ. ทุกการเปลี่ยนที่เข้าข่ายตาม §2 ต้องมี **Change Record**
> และต้อง **ถามเจ้าของโครงการก่อน** ว่าจะ track ด้วยวิธีไหน (ดู §6).

---

## 1. สองชั้นของเอกสาร — เปลี่ยนคนละน้ำหนัก

แยกสิ่งที่เปลี่ยนยากออกจากสิ่งที่เปลี่ยนบ่อย เพื่อรู้ว่าการแก้แต่ละครั้งกระทบแค่ไหน:

| ชั้น | คือ | ตัวอย่าง | น้ำหนักการเปลี่ยน |
| --- | --- | --- | --- |
| **Stable core** | สิ่งที่เปลี่ยนแล้วกระทบทั้งระบบ | common envelope, auth/`_session`, sync priority, feature-layer boundary, `_id` pattern | สูง — ต้อง CR + review ก่อนเสมอ |
| **Volatile spec** | สิ่งที่คาดว่าจะปรับระหว่าง field study | field ใน doc type, business rule, enum, workflow, UI copy | ปกติ — CR เบา แต่ยังต้อง log |

Stable core สอดคล้องกับข้อห้ามใน [`CLAUDE.md`](../CLAUDE.md) (sync/auth/layer) — แตะต้องเฉพาะเมื่อ task ระบุชัด

---

## 2. อะไรนับเป็น "Change" ที่ต้องมี Change Record

**ต้องมี** Change Record + ถามก่อน track:

- เพิ่ม/ลบ/เปลี่ยนชนิด/เปลี่ยน req↔opt ของ field ใน `docs/data/schema.md`
- เปลี่ยน business rule, enum value, invariant, หรือ workflow ใน `docs/data/` หรือ `docs/features/`
- เปลี่ยน scope/ลำดับ/deadline ของ task ใน `docs/task-breakdown/` หรือ gate ใน `docs/prd/`
- เปลี่ยน role/permission ใน `docs/prd/role-permission-matrix.md`
- bump `schema_v` (ดู §4)

**ไม่ต้อง** (แก้ได้เลย): typo, จัดรูปแบบ, เพิ่มคำอธิบายที่ไม่เปลี่ยนความหมาย, ลิงก์เสีย

---

## 3. Change Record — รูปแบบและวงจรชีวิต (Lifecycle)

เพื่อป้องกันปัญหา **หมายเลข CR ซ้ำซ้อน (Number Collision)** จากการเปิด draft หลาย branch พร้อมกัน
และการเกิดเลขขาดตอน (Gap) หากร่างไม่ผ่านการอนุมัติ ระบบจะแบ่งชื่อและสถานะไฟล์เป็น 2 ขั้น:

1. **ช่วงร่าง (Proposed / Draft):**
   - เก็บเป็น `docs/changes/draft-<slug>.md`
   - `id: draft` (หรือ `draft-<slug>`) และ `status: proposed`
   - **ห้ามรันเลข `CR-NNN` เด็ดขาด** ในขั้นตอนนี้ และยังไม่ต้องลงใน `_index.md`
   - การอ้างอิงระหว่างทบทวน: ให้อ้างอิงด้วย slug เช่น `draft-<slug>`
2. **เมื่ออนุมัติ (Approved) และรันเลข:**
   - ตรวจสอบลำดับเลขล่าสุดจาก `docs/changes/_index.md` (บน branch หลัก `develop` / `main`)
   - รันหมายเลขถัดไปและเปลี่ยนชื่อไฟล์เป็น `docs/changes/CR-NNN-<slug>.md`
   - อัปเดต frontmatter: `id: CR-NNN`, `status: approved` และบันทึกแถวลงใน `_index.md`

โครงสร้าง Frontmatter ของ Change Record:

```yaml
id: draft               # draft (ตอน proposed) -> CR-NNN (เมื่อ approved)
title: เพิ่ม field X ใน evacuee
status: proposed        # proposed | approved | done | rejected | superseded
date: 2026-09-01
requested_by: <ผู้ใหญ่ / field study / ทีม>
decided_by: <เจ้าของโครงการ>
layer: volatile         # stable | volatile
affects:
  - docs/data/schema.md §1
  - schema_v 3 → 4
  - frontend/src/lib/features/people/domain
why: <เหตุผลสั้นๆ — ทำไมต้องเปลี่ยน>
migration: <ถ้า bump schema_v: ทำกับ doc เดิมยังไง>
```

CR ที่ approve แล้วและลงมือทำเสร็จ → set `status: done` + อัปเดต `updated:` ใน doc ที่ถูกแก้ และอัปเดตสถานะใน `_index.md`

---

## 4. Versioning เอกสาร

- **Frontmatter ทุก doc** ต้องมี `status` + `created` + `updated`. แก้เนื้อหา = อัปเดต `updated`
  เป็นวันที่จริง (โครงการใช้ format `YYYY-MM-DD`)
- **`status`**: `draft for review` → `active` → `superseded` (อย่าลบไฟล์เก่าทันที — mark superseded
  แล้วชี้ไปตัวใหม่ใน note)
- **Schema version (`schema_v`)** = single source of truth ของรุ่น data model. เปลี่ยนรูปร่าง doc
  ที่ persist แล้ว → bump `schema_v` + เขียน migration note ใน CR เสมอ. Zod (client) และ
  `validate_doc_update` (CouchDB) ต้อง generate ให้ตรง schema เวอร์ชันนั้น
- **อย่าเก็บไฟล์ v1/v2/v3 ซ้ำกัน** — เก็บ doc current ตัวเดียว ประวัติอยู่ใน git + `docs/changes/`
- **Git tag** เมื่อ spec ถึง milestone สำคัญ (`spec-v1`, ก่อน gate) เพื่ออ้างอิงย้อนหลังในรายงานวิจัย

---

## 5. Workflow ต่อการเปลี่ยนหนึ่งครั้ง

1. **มีคำขอเปลี่ยน** (ผู้ใหญ่ / field / ทีม)
2. **ถามเจ้าของโครงการก่อนว่าจะ track ยังไง** (CR ไฟล์? Notion? decision sync note? — §6)
3. **เปิด Draft Change Record** — สร้างไฟล์ `docs/changes/draft-<slug>.md` (`id: draft`, `status: proposed`) ระบุ impact + layer (ยังไม่ให้เลข CR-NNN)
4. **เจ้าของเคาะ (Approval)**:
   - ตรวจสอบ `docs/changes/_index.md` บน branch หลักเพื่อกำหนดเลข `CR-NNN` ถัดไป
   - Rename ไฟล์เป็น `docs/changes/CR-NNN-<slug>.md`
   - อัปเดต frontmatter `id: CR-NNN`, `status: approved` (ถ้า stable core ต้องผ่าน review ก่อน)
   - เพิ่มแถวใน `docs/changes/_index.md`
5. **แก้ doc** + bump version/`schema_v` ถ้าเข้าข่าย + อัปเดต `updated:`
6. **แก้ code/test ที่กระทบ** (test ที่ domain/data layer จะ fail บอกจุดกระทบ)
7. **ปิด CR** (`status: done` ใน CR และ `_index.md`)

CR ที่มาใหม่ระหว่าง phase → เข้า backlog, **ไม่แทรก scope ของ phase ปัจจุบัน** เว้นแต่เจ้าของสั่ง.
อ้างอิง gate: Foundation Gate (17 ก.ค.), Operations Gate (22 ส.ค.) ใน [`docs/prd/roadmap.md`](prd/roadmap.md)

---

## 6. การเลือกวิธี track — ต้องถามก่อนเสมอ

โครงการนี้มีหลายช่องทาง (ไฟล์ `docs/changes/`, Notion task board, `decision sync` note ใน
frontmatter). **ไม่มี default** — ก่อนบันทึกการเปลี่ยนใดๆ ต้องถามเจ้าของโครงการว่าจะให้ track
ช่องทางไหนและในระดับไหน (CR เต็ม / note สั้น / Notion entry). ห้ามเดาเอง

---

## 7. อ้างอิง

- Technical source: [`docs/data/schema.md`](data/schema.md), [`docs/data/data-model.md`](data/data-model.md), [`docs/data/api-contract.md`](data/api-contract.md)
- Planning source: [`docs/task-breakdown/_index.md`](task-breakdown/_index.md), [`docs/prd/index.md`](prd/index.md)
- Change log: [`docs/changes/_index.md`](changes/_index.md)
