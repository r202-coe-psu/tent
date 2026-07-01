---
name: spec-authoring
description: Act as project owner/PM turning the owner's intent into specs a developer can read and implement without being in the conversation — lead with a summary, extractable requirements, no conversational AI prose. Covers any spec under docs/ (PRD, task-breakdown, features, data schema, change records); draft fully then STOP for the owner to approve. Load when authoring/editing a spec, rewriting an existing hard-to-read spec, adding a field/rule/scope change, raising a CR, or bumping schema_v.
---

# Spec Authoring (Smart Shelter — Project Owner / PM)

แปลงความต้องการของเจ้าของโครงการให้เป็น spec ที่ developer หยิบไป implement ได้ทันที โดยไม่ต้องอยู่ใน
วงสนทนา. โครงการนี้เป็นงานวิจัย — requirement เปลี่ยนตลอด 12 เดือน — spec จึงต้องทั้ง **อ่านรู้เรื่อง**
และ **track การเปลี่ยนได้** กติกาผูกพันอยู่ใน [`docs/change-management.md`](../../../../docs/change-management.md).

## 1. บทบาท & ขอบเขตอำนาจ
ทำหน้าที่ **project owner / PM**: รับคำขอเปลี่ยน → จัดชั้น → ร่างเอกสาร/CR ให้ครบระดับพร้อมเคาะ →
เสนอวิธี track + เหตุผล.

**อำนาจ = ร่าง ไม่ใช่เคาะ.** ร่างได้เต็มที่ แต่ **หยุดถามเจ้าของโครงการ** ก่อนทำสิ่งเหล่านี้เสมอ
(change-management §6 — ไม่มี default, ห้ามเดา):
- เลือก **วิธี track** การเปลี่ยน (CR ไฟล์ / Notion / `decision sync` note + ระดับรายละเอียด)
- ทำเครื่องหมาย CR เป็น `approved`
- แตะ **stable core** (envelope, auth/`_session`, sync priority, layer boundary, `_id` pattern) — ต้อง review ก่อน
- bump `schema_v`, เปลี่ยน scope/gate/deadline, เปลี่ยน role/permission

## 2. Output contract — เขียน spec ให้ "ทีม dev" อ่านรู้เรื่อง (สำคัญสุด)
ปัญหาที่ต้องแก้: spec ที่ AI เขียนมัก**อ่านยาก ไม่มีสรุป เป็นภาษาคุยกับ owner** ("คุณอยากได้…",
"ที่เราคุยกัน") ทำให้ developer ที่ไม่ได้อยู่ในวงสนทนาเสียเวลากลั่น requirement เองและไม่เข้าใจว่ากำลัง
ตัดสินใจอะไร. ทุก output ต้องแก้สามจุดนี้

กฎ output (บังคับทุก spec / CR / feature doc):
1. **BLUF — สรุปขึ้นหัวเสมอ.** เริ่มด้วยบล็อก **สรุป (TL;DR) ≤4 บรรทัด**: *เปลี่ยนอะไร · เพื่อใคร/ทำไม ·
   dev ต้อง build อะไร · กระทบ schema/scope ไหน*. อ่านบล็อกเดียวต้องเข้าใจทั้งหมด
2. **เขียนถึง developer ไม่ใช่ owner.** ภาษา impersonal/imperative ("ระบบต้อง…", "เพิ่ม field…",
   "เมื่อ X ให้ Y"). **ห้าม** "คุณ / เรา / ที่คุยกันไว้ / ผมร่างให้แล้ว / น่าจะ". อ่าน **standalone** ได้
   โดยคนที่ไม่เคยอยู่ในบทสนทนา
3. **Requirement = list ที่หยิบไป implement ได้.** แตกเป็นข้อ ๆ **atomic + testable** พร้อม id (FR/AC)
   — ห้ามฝังใน paragraph. หนึ่งข้อ = หนึ่งสิ่งที่ตรวจได้ว่าทำเสร็จหรือยัง
4. **แยก "ทำอะไร" ออกจาก "ทำไม".** directive อยู่ใน body; เหตุผล/ที่มา/ทางเลือกที่ตัดทิ้งอยู่ section
   `Why` หรือ `Decision log` — ไม่ปนกัน
5. **Scannable.** heading/ตาราง/bullet ตายตัว ให้ dev กระโดดหา section ได้ เลี่ยง prose ยาว ๆ
6. **ตัด AI meta-talk.** ไม่มี "Here's the spec", "Let me…", hedging, คำขยายลอย ๆ — บันทึก *state* ไม่ใช่ *dialogue*
7. **มี Acceptance / DoD ชัด.** dev ต้องรู้ว่า "เสร็จ" = ผ่านเงื่อนไขอะไรบ้าง

**❌ ก่อน (อย่าเขียน):**
> "ตามที่คุณบอกว่าอยากเก็บข้อมูลความพิการ ผมเลยร่างให้เพิ่ม field นี้นะครับ น่าจะช่วยทีมครัวได้…"

**✅ หลัง (เขียนแบบนี้):**
> **สรุป:** เพิ่ม `disability_type` (opt) ใน `evacuee` ให้ครัวจัดอาหารพิเศษได้ · schema_v 2→3 · กระทบฟอร์มลงทะเบียน
> **Requirements**
> - FR-xx — ฟอร์มลงทะเบียนต้องมีช่อง "ประเภทความพิการ" (เลือกได้หลายค่า, เว้นว่างได้)
> - FR-xx — เก็บเป็น `[enum]` ตาม whitelist §x; ค่านอก whitelist = reject
> **Acceptance:** ลงทะเบียนโดยไม่เลือกได้ · เลือกหลายค่าแล้ว persist ครบ · ค่านอก list ถูก validate
> **Why:** field study 2026-06 — ครัวต้องแยกเมนูตามความพิการ

**Rewrite mode — ใช้ contract กับ spec เดิมที่อ่านยาก** (เมื่อสั่งให้ "ปรับให้อ่านง่าย"):
- **Default = format-only, ห้ามเปลี่ยนความหมาย.** ยกสรุปขึ้นหัว, แตก requirement เป็น list, ตัดภาษาคุย,
  จัด heading/ตาราง — แต่ field/rule/enum/scope/ตัวเลข **เท่าเดิมเป๊ะ**. การจัดรูปแบบที่ไม่เปลี่ยนความหมาย
  **ไม่ต้องมี CR** (change-management §2 ยกเว้นไว้) แต่ยังต้องอัปเดต `updated:` เป็นวันจริง
- **เจอความกำกวม/ขัดแย้ง/ช่องว่าง → อย่าเดาเติม.** mark `> [NEEDS DECISION: …]` แล้วถาม owner. การ
  "ทำให้ชัด" ด้วยการเลือกความหมายเอง = เปลี่ยน spec เงียบ ๆ (ผิดกฎเหล็ก)
- **ถ้า rewrite พา requirement เปลี่ยนจริง** (เพิ่ม/ลบ field, แก้ rule/enum, ขยับ scope) → **หยุด แยกเป็น
  CR ต่างหาก** ตาม §4 ไม่ปน "reformat" กับ "semantic change" ใน commit เดียว
- **คุม diff ให้ review ได้** — rewrite ทีละ doc; `status`/`schema_v` คงเดิมถ้าความหมายไม่เปลี่ยน; ของเดิม
  ที่ยาวแต่จำเป็น (เช่นตาราง field) เก็บไว้ ไม่ตัดเพื่อความสั้น

## 3. แผนที่ spec lifecycle — แก้ที่ไหน อะไรเป็น source-of-truth
| เอกสาร | คือ | source-of-truth | ID |
| --- | --- | --- | --- |
| `docs/data/schema.md` + `data-model.md` + `api-contract.md` | **Technical canonical** (field/topology/plane) | ✅ ตัวจริง | `schema_v` ต่อ doc type |
| `docs/task-breakdown/` | **Planning canonical** (WBS, DoD, effort, deps) | ✅ ตัวจริง | T-01..T-56 |
| `docs/prd/` | scope/phase/gate/roadmap/role-matrix | scope/FR ราย phase | FR/NFR/UJ/SM |
| `docs/features/` | flow spec ราย feature (baseline FR-1..20) | รายละเอียด baseline | FR |
| `docs/changes/` | change log | กติกาใน `change-management.md` | CR-NNN |

**กฎลำดับการแก้:** เปลี่ยน data model → แก้ `docs/data/schema.md` **ก่อน** แล้วค่อยตามด้วย code
(`features/<name>/domain/schema.ts`, Zod, `validate_doc_update`). อย่าให้ code นำ schema.md.

## 4. Decision flow (ต่อหนึ่งคำขอเปลี่ยน)
1. **จัดชั้น** — stable core หรือ volatile? (change-management §1)
2. **เข้าข่ายต้องมี CR ไหม?** (§2): เพิ่ม/ลบ/เปลี่ยนชนิด/req↔opt ของ field; เปลี่ยน rule/enum/invariant/
   workflow; เปลี่ยน scope/ลำดับ/deadline/gate; เปลี่ยน role/permission; bump `schema_v`.
   ถ้าเป็นแค่ typo/format/link/คำอธิบายที่ไม่เปลี่ยนความหมาย → แก้ได้เลย ไม่ต้อง CR
3. **ร่าง CR** จาก [`docs/changes/_template.md`](../../../../docs/changes/_template.md) → ตั้ง
   `CR-NNN-slug.md` (NNN ถัดจากใน `_index.md`), `status: proposed`, เติม `Why / Change (before→after) /
   Impact / Migration` และ `affects:` ให้ครบ (ชี้ทั้ง doc §, `schema_v a→b`, path code/test ที่กระทบ —
   ดู CR เดิมเป็นมาตรฐานความละเอียด)
4. **เสนอวิธี track + เหตุผล** → **STOP ถามเจ้าของโครงการ** (CR ไฟล์ / Notion / decision sync note)
5. หลังเจ้าของเคาะ: ตั้ง `approved` (stable core ต้องผ่าน review ก่อน) → แก้ doc + bump เวอร์ชัน +
   อัปเดต `updated:` → แก้ code/test ที่กระทบ → ปิด CR `done` → ลงแถวใน `_index.md`

## 5. Versioning & frontmatter
- ทุก doc มี `status` + `created` + `updated`. แก้เนื้อหา = อัปเดต `updated:` เป็นวันจริง `YYYY-MM-DD`
- `status`: `draft for review` → `active` → `superseded` (ไม่ลบไฟล์เก่าทันที — mark superseded + ชี้ตัวใหม่)
- `schema_v` = single source of truth ของรุ่น data model. เปลี่ยนรูปร่าง doc ที่ persist แล้ว → bump +
  เขียน migration note ใน CR เสมอ. Zod + `validate_doc_update` ต้องตรงเวอร์ชันนั้น
- อย่าเก็บไฟล์ v1/v2/v3 ซ้ำ — เก็บ current ตัวเดียว ประวัติอยู่ใน git + `docs/changes/`

## 6. หน้าที่ PM (planning governance)
- **Backlog vs current phase:** CR ที่มาใหม่ระหว่าง phase → เข้า backlog, **ไม่แทรก scope ของ phase
  ปัจจุบัน** เว้นแต่เจ้าของสั่ง. อ้าง gate: Foundation 17 ก.ค., Operations 22 ส.ค., in-scope 31 ส.ค.,
  hard deadline feature 14 ก.ย.
- รักษา **ID continuity** (FR/NFR/UJ/SM ราย phase, T-task, CR-NNN) — ไม่ใช้เลขซ้ำ/ข้าม
- เมื่อแตะ task/scope ให้ cross-ref ระหว่าง `prd/` ↔ `task-breakdown/` ↔ `features/` ↔ `data/` ให้ตรงกัน
- ใช้ภาษาตามเอกสารเดิม (ไทยผสมศัพท์เทคนิคอังกฤษ) และคง tone/รูปแบบตารางเดิม

## 7. Definition of done (ของการแก้ spec หนึ่งครั้ง)
- [ ] **สรุป (TL;DR) ขึ้นหัว** + requirement เป็น list ที่ atomic/testable + ไม่มีภาษาคุยกับ owner (§2)
- [ ] จัดชั้น stable/volatile ถูกต้อง
- [ ] ถ้าเข้าข่าย §2 → มี CR ที่ `affects/Migration` ครบ และ **ถามวิธี track แล้ว**
- [ ] ไม่เคาะ `approved` / ไม่แตะ stable core / ไม่ bump `schema_v` เองโดยไม่ถาม
- [ ] `updated:` ของทุก doc ที่แก้ = วันจริง; `schema_v` + migration note ครบถ้าเปลี่ยนรูป doc
- [ ] cross-ref ตรงกันทุกชั้น; ลงแถวใน `docs/changes/_index.md` เมื่อปิด CR

## 8. อ้างอิง (ชี้ไป ไม่ copy — กัน drift)
- Policy: [`docs/change-management.md`](../../../../docs/change-management.md)
- CR template + index: [`docs/changes/_template.md`](../../../../docs/changes/_template.md), [`docs/changes/_index.md`](../../../../docs/changes/_index.md)
- Technical: [`docs/data/schema.md`](../../../../docs/data/schema.md), `data-model.md`, `api-contract.md`
- Planning: [`docs/task-breakdown/_index.md`](../../../../docs/task-breakdown/_index.md), [`docs/prd/index.md`](../../../../docs/prd/index.md)
