---
title: Smart Shelter — ERD (CouchDB doc-type relationships)
summary: ความสัมพันธ์ระหว่าง doc type ใน db-per-shelter + global db. FK = string _id; ไม่มี join — resolve ด้วย _id หรือ view
badges: CouchDB, ERD, v2.0, Draft
lang: th
footer: Smart Shelter Full-System · ERD
---

# Smart Shelter — ERD (doc-type relationships)

CouchDB ไม่มี join/FK constraint — ความสัมพันธ์เป็น **string `_id` reference** + resolve
ฝั่ง app หรือผ่าน `_design` view. ERD ข้างล่างแสดงความสัมพันธ์เชิงตรรกะระหว่าง **doc type**
(ดูฟิลด์เต็มที่ [data model](./smart-shelter-data-model.html))

> Cardinality: `||--o{` = one-to-many · `}o--o{` = many-to-many · `|o--o|` = zero/one

---

## 1. Core (people) doc types

```mermaid
erDiagram
  shelter ||--o{ evacuee : "shelter_id"
  shelter ||--o{ household : "shelter_id"
  household ||--o{ evacuee : "household.household_id"
  household |o--o| evacuee : "head_evacuee_id"
  evacuee |o--o| evacuee : "care.guardian_evacuee_id"
  evacuee ||--o| evacuee_medical : "1:1 sensitive split (separate doc/db)"
  evacuee ||--o{ movement : "evacuee_id (append-only)"
  evacuee ||--o{ security_event : "subject.id (append-only)"
  user }o--o{ shelter : "assigned via _users role / _security"

  shelter {
    string _id "shelter:SH001"
    string type "shelter"
    string profile_key "→ sop_profile"
    object zones
  }
  evacuee {
    string _id "evacuee:P-SH001-000045"
    string type "evacuee"
    string shelter_id FK
    string household_id FK
    object privacy "consent / search_excluded"
  }
  evacuee_medical {
    string _id "evacuee_medical:P-SH001-000045"
    string type "evacuee_medical"
    string evacuee_id FK
  }
  movement {
    string _id "movement:<idempotency_key>"
    string type "movement"
    string evacuee_id FK
    int signed "+in / -out → occupancy view"
  }
```

---

## 2. Supply, donation, kitchen

```mermaid
erDiagram
  supply_item ||--o{ stock_ledger : "item_id (catalog global)"
  shelter ||--o{ stock_ledger : "shelter_id"
  stock_ledger ||..|| stock_balance_view : "_sum reduce view (ไม่ใช่ doc)"
  supply_item ||--o{ stock_balance_view : "item_code key"
  shelter ||--o{ stock_transfer : "from/to_shelter_id"
  stock_transfer ||--o{ stock_ledger : "ledger_out/in_ids"

  shelter ||--o{ donation : "shelter_id"
  donation_campaign ||--o{ donation : "campaign_id"
  donation ||--o{ stock_ledger : "intake.ledger_ids"
  shelter ||--o{ donation_campaign : "shelter_id"

  shelter ||--o{ meal_plan : "shelter_id"
  meal_plan ||--o{ kitchen_requisition : "meal_plan_id"
  kitchen_requisition ||--o{ stock_ledger : "lines.ledger_id (distribute)"
  meal_plan ||--o{ meal_service : "meal_plan_id"

  stock_ledger {
    string _id "stock_ledger:<idempotency_key>"
    string type "stock_ledger"
    int quantity_base "signed, immutable"
  }
  stock_balance_view {
    string key "[shelter_id,item_code]"
    int value "_sum"
  }
```

---

## 3. Volunteer, SOP, resource, referral, EOC

```mermaid
erDiagram
  shelter ||--o{ volunteer : "shelter_id"
  volunteer ||--o{ shift_assignment : "volunteer_id"
  user |o--o| volunteer : "user_id (optional)"

  shelter ||--o{ referral : "from_shelter_id"
  household |o--o{ referral : "subject.id"

  sop_profile ||--o{ shelter : "profile_key"
  sop_profile ||--o{ resource_calc : "profile_key"
  shelter ||--o{ resource_calc : "shelter_id"
  resource_calc ||--o| meal_plan : "occupancy × ratio"

  dashboard_view ||--o{ eoc_aggregate : "central rollup"
  api_key ||--o{ eoc_aggregate : "access principal (FastAPI egress)"

  id_mint ||--o{ donation : "mint official_code (central)"
  audit }o--|| user : "actor_user_id"
  search_audit }o--o| evacuee : "consent-gated, no FK"

  sop_profile {
    string _id "sop_profile:sphere"
    object ratios "config, global db"
  }
  eoc_aggregate {
    string _id "eoc_aggregate:date:scope"
    string note "no person row, central-only"
  }
```

---

## 4. Database boundary

```mermaid
flowchart LR
  subgraph shelterdb["shelter-&lt;code&gt; (replicate edge ⇄ central)"]
    evacuee & household & movement & security_event
    donation & donation_campaign & stock_ledger & stock_transfer
    meal_plan & kitchen_requisition & meal_service
    volunteer & shift_assignment & referral & resource_calc
    evacuee_medical
  end
  subgraph globaldb["global (central → edge pull)"]
    supply_item & sop_profile & shelter_config["config"] & users["_users"]
  end
  subgraph centraldb["central-only"]
    eoc_aggregate & audit & api_key & search_audit & id_mint
  end
```

> `evacuee_medical` อยู่ shelter db แต่ **filtered replication** — replicate ไป device/role ที่มีสิทธิ์ medical เท่านั้น (PII minimization, ดู [auth-rbac-flows](../architecture/auth-rbac-flows.html))
