---
title: Smart Shelter — Data Docs (CouchDB / PouchDB)
summary: ชุดเอกสาร data model หลังเปลี่ยนเป็น distributed CouchDB/PouchDB
badges: CouchDB, PouchDB, Index, v2.0
lang: th
footer: Smart Shelter Full-System · Data Docs
---

# Smart Shelter — Data Docs

เอกสาร data ทั้งหมดเปลี่ยนจาก MongoDB เป็น **distributed CouchDB/PouchDB** (multi-master,
offline-first). canonical source = ไฟล์ Markdown ใน `docs/data/` + `docs/architecture/`,
generate เป็น HTML ด้วย `docs/_tools/md-to-html.mjs`

## เอกสารในชุดนี้

- [Data Model](./smart-shelter-data-model.html) — doc types, db-per-shelter, Mango/views, conflict policy *(canonical field/index/enum source)*
- [ERD](./smart-shelter-erd.html) — ความสัมพันธ์ระหว่าง doc type (mermaid)
- [Architecture](../architecture/architecture.html) — topology, replication, FastAPI scope, official-id minting
- [Auth & RBAC Flows](../architecture/auth-rbac-flows.html) — CouchDB `_users` + `_security` + `validate_doc_update`

## หลักการย่อ

- **SoT = CouchDB replication graph** ไม่มี primary เดียว — ทุก node เขียน/อ่านได้ตลอด
- **db-per-shelter** + ฟิลด์ `type` แยกชนิด doc (ไม่มี collection)
- **append-only event** (ledger/movement/security) `_id` = idempotency_key → ไม่มี conflict
- **read model = view** (balance/occupancy/dashboard) ไม่ใช่ doc ที่เขียนทับ
- **FastAPI** เหลือเฉพาะ central egress/mint/reconcile — edge ไม่มี
