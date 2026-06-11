---
title: "Full-System Role Permission Matrix (R2-R4)"
status: draft proposal
created: 2026-06-04
updated: 2026-06-07
closes: K-12 (A1 RBAC phase-blocker)
---

# Full-System Role Permission Matrix (R2-R4)

## 0. Document Purpose

ออกแบบใหม่ให้ **lean** — ลด role จาก 12 เหลือ **5 internal role** ที่ตรงกับหน้าที่จริงในพื้นที่ ปิด **K-12 / A1** (RBAC phase-blocker ของ R2). เมื่อ approve = canonical ของ RBAC behavior ทั้งระบบ. field-level schema อ้าง [Data Model v3](../data/data-model.md) เป็น master *(Data Dictionary เดิม retired 2026-06-11)*.

การเปลี่ยนแปลงหลักจาก draft เดิม:
- ตัด `registration_officer`, `medical_staff`, `executive`, `eoc_viewer`, `volunteer_coordinator`, `security_officer` ออก
- เพิ่ม `volunteer`, `kitchen_staff`, `warehouse_staff`
- `shelter_manager` ดูดซับ VC + SO + สามารถทำงานแทน VOL/KS/WS ได้ในศูนย์ตน
- medical data: ไม่มี role-gate พิเศษ — volunteer เห็นได้ (ยกเว้น SM เห็น referral flag แต่ medical detail = null ผ่าน `is_medical_visible()`)
- EOC = **aggregate API + API-key principal** (FD-14, service แยก) — ไม่มี EOC dashboard/role ในระบบหลัก; cross-shelter view ภายในระบบ = SA เท่านั้น
- schema: `assigned_shelter_ids[]` → `shelter_id` (single) — SA มี `null` (global)

> **[NOTE FOR PM]** T2/T3/T4 ✅ CONFIRMED. T5 ❌ CANCELLED (EV role dropped).

---

## 1. Roles & Access Tiers

### 1.1 Internal authenticated roles (users collection, `RoleKey`)

| ตัวย่อ | Role key (code) | ชื่อในงาน | Phase | หน้าที่หลัก |
| --- | --- | --- | --- | --- |
| SA | `system_admin` | System Admin | R1 | global; จัดการ shelter/user/role/audit/catalog/SOP config ทุกอย่าง |
| SM | `shelter_manager` | Shelter Manager | R1 | บริหารศูนย์ตน; ครอบ VOL+KS+WS+security event+referral+รับสมัครอาสา |
| VOL | `volunteer` | Volunteer | R2 | ลงทะเบียน Person/Household/สัตว์/สิ่งของ, check-in/out, เช็คมื้ออาหาร |
| KS | `kitchen_staff` | Kitchen Staff | R3 | meal plan, requisition (ตัด stock), meal service record |
| WS | `warehouse_staff` | Warehouse Staff | R2 | catalog, receive/distribute/transfer, stock dashboard, reorder |

**กฎสำคัญ:**
- 1 user สามารถถือหลาย role ได้ (เช่น `volunteer` + `kitchen_staff`)
- 1 user อยู่ได้แค่ 1 shelter — ถ้าต้องทำงานอีกศูนย์ต้อง logout + ใช้ account อื่น
- `shelter_manager` มีสิทธิ์ครอบคลุม VOL/KS/WS ทั้งหมดในศูนย์ตน (ไม่ต้องถือ role เหล่านั้นเพิ่ม)

### 1.2 Non-user access tiers (ไม่อยู่ใน users collection)

| ตัวย่อ | Tier | Phase | คือ |
| --- | --- | --- | --- |
| **DN** | Donor (public) | R2→R3 | **ไม่ต้อง login** (FD-16) — สร้าง pre-declaration + reservation แล้ว track ผ่าน `tracking_token`; บังคับเบอร์+OTP กัน spam; rate-limit + CAPTCHA |
| **PUB** | Public / anonymous | R3-R4 | ไม่ต้อง login — transparency report; aggregate/consent-gated, rate-limited |
| **FAM** | Family search (public) | R3-R4 | ไม่ต้อง login — ดู evacuee directory แบบ masked (ชื่อ-นามสกุล, ชื่อเล่น, สถานะศูนย์อพยพ เท่านั้น); rate-limit + anti-enumeration |
| **API** | API consumer (machine) | R4 | One Data / Hat Yai ROD — API key + scope, aggregate no-PII, audited |

---

## 2. Legend

- ✓ = อนุญาต · — = ปฏิเสธ (backend `NoPermission`)
- **scope** = เฉพาะ shelter ที่ user ถือ `shelter_id` ตรงกัน; `system_admin` = global (ไม่มี shelter_id check)
- **self** = เฉพาะ record ของตน — Donor (DN) = match ด้วย `tracking_token`
- **agg** = เห็นเฉพาะ aggregate ไม่ลงถึง record รายคน
- **null** = field ถูก set null ก่อน return
- **never** = field ถูก pop ทิ้งเสมอ ไม่ส่งออก
- 🔒 = ต้องผ่าน governance/DPIA review ก่อนเปิด (NFR-15/19/22)

---

## 3. Action Matrix — R2 (Household, Zoning, Inventory, Donation intake)

| Action | FR | SA | SM | VOL | WS | DN |
| --- | --- | --- | --- | --- | --- | --- |
| สร้าง/แก้ Household + attach members | FR-21 | ✓ | scope | scope | — | — |
| ออก Household Shelter ID/QR | FR-22 | ✓ | scope | scope | — | — |
| Household search + check-in/out | FR-23 | ✓ | scope | scope | — | — |
| บันทึก pet/asset/vehicle | FR-24 | ✓ | scope | scope | — | — |
| กำหนด zone + capacity | FR-25 | ✓ | scope | — | — | — |
| assign/ย้าย person·household → zone | FR-26 | ✓ | scope | scope | — | — |
| จัดการ Supply Item catalog (master) | FR-27 | ✓ | — | — | — | — |
| Stock receive (inbound) | FR-28 | ✓ | — | — | scope | — |
| Stock distribute (outbound) | FR-29 | ✓ | — | — | scope | — |
| Inter-shelter transfer (สร้าง/ยืนยันรับ) | FR-30 | ✓ | — | — | scope | — |
| Stock dashboard + ตั้ง reorder threshold | FR-31 | ✓ | scope (ดู) | — | scope | — |
| Donor pre-declaration (สร้าง) | FR-32 | ✓ | scope | scope | scope | self |
| Donation intake audit trail (ดู) | FR-33 | ✓ | scope | — | scope | — |
| กำหนด role ใหม่ + field permission | FR-34 | ✓ | — | — | — | — |

**หมายเหตุ:**
- WS เห็นเฉพาะ inventory/donation ของศูนย์ตน — **ไม่เห็น** Person/medical (ดู §6)
- catalog (FR-27) = master ข้ามศูนย์ → SA only
- SM ดู stock dashboard ได้ (วางแผน) แต่ไม่ write ledger โดยตรง (เว้นแต่ KS tasks ใน §4)
- DN pre-declaration: no-auth (FD-16), track ผ่าน `tracking_token` → `self` = match by token

---

## 4. Action Matrix — R3 (Donation full, Kitchen, Volunteer, SOP, Security, Referral)

| Action | FR | SA | SM | WS | KS | VOL | DN | PUB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Donation reservation | FR-35 | ✓ | scope | scope | — | — | self | — |
| Donation cut-off (auto/config) | FR-36 | ✓ | scope | scope | — | — | — | — |
| Smart redirect (ดู/เลือก) | FR-37 | ✓ | scope | scope | — | — | self | — |
| Donation transparency report (publish) | FR-38 | ✓ 🔒 | scope 🔒 | — | — | — | — | agg 🔒 |
| Meal plan (สร้างจาก occupancy) | FR-39 | ✓ | scope | — | scope | — | — | — |
| Kitchen requisition (ตัด stock) | FR-40 | ✓ | scope | scope | scope | — | — | — |
| Meal service record | FR-41 | ✓ | scope (ดู) | — | scope | — | — | — |
| Volunteer registration + skills | FR-42 | ✓ | scope | — | — | — | — | — |
| Skill match + task/shift assign | FR-43 | ✓ | scope | — | — | — | — | — |
| SOP ratio configuration | FR-44 | ✓ | — | — | — | — | — | — |
| Daily resource calculation (run/ดู) | FR-45 | ✓ | scope | scope (ดู) | scope (ดู) | scope (ดู) | — | — |
| Resource calc dashboard | FR-46 | ✓ | scope | — | — | — | — | — |
| Security event + safety monitoring | FR-47 | ✓ | scope | — | — | — | — | — |
| Referral & hand-off | FR-48 | ✓ | scope | — | — | — | — | — |

**หมายเหตุ:**
- **Kitchen requisition (FR-40)** ✅ **CONFIRMED option A (2026-06-05)**: KS เขียน requisition ตัด on-hand ตรง ผ่าน Stock Ledger เดียวกับ WS (FR-29 pattern). KS เขียนได้เฉพาะ requisition-type entry; WS own receive/transfer/adjust. SM สามารถเขียน KS entries ได้ (SM ⊇ KS)
- Volunteer/VC responsibilities (FR-42/43) ย้ายมาที่ SM — **ไม่มี volunteer_coordinator role แยก**
- Security events (FR-47) = SM เท่านั้น — **ไม่มี security_officer role แยก**
- **Referral & hand-off (FR-48)** ✅ **CONFIRMED (FD-13):** `shelter_manager` เป็นเจ้าของ referral; SM เห็น **flag** medical-emergency แต่ **medical detail = null** (§6)
- SOP ratio config (FR-44) = master ข้ามศูนย์ → SA only

---

## 5. Action Matrix — R4 (EOC, Open API, Family search, Governance)

| Action | FR | SA | SM | API | PUB |
| --- | --- | --- | --- | --- | --- |
| EOC cross-shelter aggregate data API (ดึงข้อมูล) | FR-49 | ✓ | — | agg 🔒 (per-key scope) | — |
| EOC API-key management (issue/rotate/revoke + scope) | FR-50 | ✓ | — | — | — |
| Open API — aggregate data pull | FR-51 | ✓ 🔒 | — | agg 🔒 | — |
| Search consent / opt-out (ตั้งค่า) | FR-52 | ✓ | scope | — | — |
| Public family search (query) | FR-53 | — | — | — | FAM·masked dir 🔒 |
| What-if SOP simulation | FR-54 | ✓ | — | — | — |
| RoPA / consent / retention finalize | FR-55 | ✓ | — | — | — |
| Cross-module UAT + handover package | FR-56 | ✓ | — | — | — |

**หมายเหตุ:**
- EOC (FR-49/50) = **aggregate API + API-key principal (FD-14)** — EV role ถูกตัดออก (T5 CANCELLED); ไม่มี human dashboard ในระบบหลัก (service แยก, worker/ETL จาก CouchDB — ดู [task-breakdown 10-eoc](../task-breakdown/10-eoc.md)); การ manage key = SA
- Open API (FR-51) = aggregate/no-PII + 🔒 DPIA
- **family search (FR-53)** = FAM tier ไม่ต้อง login; คืน masked directory เห็นแค่ `first_name`/`last_name`/`nickname`/`shelter_status`; เคารพ opt-out (FR-52) 100%; anti-enumeration + rate-limit (NFR-24)

---

## 6. Field-Level Masking — collection ใหม่ (R2-R4)

ต่อจาก MVP §4 (Person/medical). mask ที่ backend ก่อน return — เช่นเดียวกับ `masking.serialize_evacuee()`.

| Field / กลุ่ม | NFR | SA | SM | VOL | KS | WS | API | PUB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Household identity (head, members ref) | NFR-5 | ✓ | ✓ | ✓ | — | — | — | — |
| Pet/asset/vehicle | — | ✓ | ✓ | ✓ | — | — | — | — |
| Supply item / stock on-hand | NFR-13 | ✓ | ✓ | — | ✓ (ดู) | ✓ | agg | agg (transparency) |
| Donor identity / contact | NFR-5 | ✓ | scope | — | — | scope | — | — |
| Volunteer PII (contact, skills) | NFR-20 | ✓ | scope | — | — | — | — | — |
| Security event detail | — | ✓ | scope | — | — | — | — | — |
| Referral medical-emergency detail | NFR-20 | ✓ | null* | — | — | — | — | — |
| Person medical / national_id | NFR-5/6 | unmasked | masked | masked | masked | null | never | never |
| Evacuee directory (family search, FAM) | NFR-5/6 | ✓ | ✓ | — | — | — | — | name+nickname+status 🔒 |

`*` SM เห็น referral record + flag medical-emergency แต่ **medical detail = `null`**; detail เห็นเฉพาะ SA ผ่าน `is_medical_visible()` ที่ปรับใหม่ (CONFIRMED T4 — FD-13).

**หมายเหตุ medical:**
- ไม่มี `medical_staff` role แล้ว — VOL/KS เห็น medical fields ได้ (masked national_id) เพื่อรองรับงาน registration + meal planning
- `is_medical_visible()` ปรับใหม่: SA = true (referral context); SM/VOL/KS = false สำหรับ referral medical detail; แต่ Person medical fields คืนตามตารางบน

---

## 7. Scope Rules

### 7.1 Internal shelter scope

- `system_admin` = global — ไม่มี shelter_id check; `shelter_id = null`
- ทุก role อื่น (SM/VOL/KS/WS): `shelter_id` ต้องตรงกัน; ข้ามศูนย์ → `NoPermission`
- 1 user = 1 shelter เสมอ — ถ้าต้องทำงานอีกศูนย์ต้อง logout + ใช้ account ที่ assign ศูนย์นั้น
- multi-role: `user.role_keys` เป็น list; permission check = `has_any_role(user, allowed_set)`
- list/search ของ non-admin filter ด้วย `shelter_id` อัตโนมัติ (NFR-4)

### 7.2 Donor (public, no-auth) scope [FD-16]

- **ไม่มี login/account** — track ผ่าน `tracking_token` (CSPRNG ≥16 char, unique index)
- สร้าง/แก้/track เฉพาะ pre-declaration + reservation ของตน (match by token)
- **บังคับเบอร์ + OTP** ก่อนสร้าง = lightweight anti-spam
- public write surface = **rate-limit + CAPTCHA + anti-enumeration** (NFR-24)
- เห็น **shortage รายศูนย์** (required resource, counts only no-PII) เพื่อ direct การบริจาค

### 7.3 Public + FAM + API tier

- PUB = no auth; เฉพาะ transparency report (agg); rate-limit + anti-enumeration (NFR-24)
- **FAM = no auth** (family search); คืน evacuee directory แบบ masked — เห็นเฉพาะ `first_name`, `last_name`, `nickname`, `shelter_status`; field อื่นทั้งหมด pop ทิ้งที่ backend; **consent = opt-out [CONFIRMED T3/K-15]** (เห็นทุกคนเว้นแต่ถอน, เคารพ FR-52 100%); rate-limit + anti-enumeration
- API = key per consumer + scope + audit; payload aggregate no-PII + schema versioning (NFR-22/24)

---

## 8. Decisions

| # | เรื่อง | Status | กระทบ |
| --- | --- | --- | --- |
| T2 | Kitchen→inventory write | ✅ **CONFIRMED (2026-06-05):** KS เขียน requisition ตัด stock ตรง (no approval); SM ⊇ KS; WS own receive/transfer/adjust | §4 FR-40 |
| T3 | Public/external tier | ✅ **CONFIRMED (FD-16, 2026-06-06):** donor = no-auth, tracking_token, OTP; shortage visible รายศูนย์ (no-PII); family search = opt-out | §1.2, §3 FR-32, §7.2, §7.3 |
| T4 | Referral masking | ✅ **CONFIRMED (FD-13, 2026-06-05):** SM เป็นเจ้าของ referral (ไม่มี role ใหม่); medical detail mask สำหรับ SM ผ่าน `is_medical_visible()` | §4 FR-48, §6 |
| T5 | EOC viewer scope | ❌ **CANCELLED:** EV role dropped; EOC = aggregate API + API-key principal (FD-14, service แยก) | §5 FR-49/50 |

---

## 9. Code Impact (หลัง approve)

ยังไม่ implement — รอ approve ก่อน. **Greenfield:** path ไฟล์ด้านล่างอ้างโครงร่าง backend จาก design เดิม — ใช้เป็น design intent แล้ว map เข้าโครงจริงเมื่อ walking skeleton ขึ้น (ยังไม่มี `backend/` ใน repo). baseline regression ต้องผ่าน (NFR-16).

**`backend/apiapp/modules/user/schemas.py`**
- `RoleKey` enum: คง `system_admin`, `shelter_manager`; ลบ `registration_officer`, `medical_staff`, `viewer`, `executive`; เพิ่ม `volunteer`, `kitchen_staff`, `warehouse_staff`; ไม่มี `donor`/`referral_officer`
- User model: `assigned_shelter_ids: list[PydanticObjectId]` → `shelter_id: PydanticObjectId | None` (None = global/SA)
- Migration: `assigned_shelter_ids[0]` → `shelter_id`; warn + manual review สำหรับ user ที่มีมากกว่า 1 shelter

**`backend/apiapp/modules/shelter/permissions.py`**
- ลบ `MEDICAL_ROLES`
- `EVACUEE_WRITE_ROLES` = {system_admin, shelter_manager, volunteer}
- `MOVEMENT_ROLES` = {system_admin, shelter_manager, volunteer}
- เพิ่ม `INVENTORY_WRITE_ROLES` = {system_admin, shelter_manager, warehouse_staff}
- เพิ่ม `KITCHEN_ROLES` = {system_admin, shelter_manager, kitchen_staff}
- เพิ่ม `SECURITY_EVENT_ROLES` = {system_admin, shelter_manager}
- เพิ่ม `VOLUNTEER_RECRUIT_ROLES` = {system_admin, shelter_manager}
- อัปเดต `ensure_shelter_scope()` ให้ใช้ `shelter_id` (single field แทน array)
- `is_medical_visible()` ปรับ: return True สำหรับ SA เท่านั้น (ใช้ใน referral context)

**`backend/apiapp/modules/shelter/masking.py`**
- ลบ `medical_full_v1` policy
- อัปเดต `operational_minimum_v1`: medical fields visible สำหรับ VOL/KS (ไม่ gate ด้วย MS)
- `serialize_evacuee()`: national_id masked สำหรับ SM/VOL/KS; null สำหรับ WS; medical fields คืนปกติสำหรับ VOL/KS/SM
- เพิ่ม `family_directory_v1`: คืนเฉพาะ `first_name`, `last_name`, `nickname`, `shelter_status`

**CouchDB indexes**
- ลบ index บน `assigned_shelter_ids`
- เพิ่ม index บน `shelter_id + status`

**Guardrail tests**: ต่อ role ใหม่ (write/no-write, mask, scope enforcement, SM ⊇ VOL/KS/WS)

---

## 10. Traceability

- **PRD:** [R2](phase-r2-foundation.html) FR-21..34 · [R3](phase-r3-operations.html) FR-35..48 · [R4](phase-r4-integration-handover.html) FR-49..56; NFR-12..26
- **Baseline (FR-1..20):** matrix นี้ครอบ baseline ด้วย — ไม่มี matrix แยก (greenfield, role ชุดเดียวตั้งแต่แรก); spec อยู่ใน [`docs/features/`](../features/index.html)
- **Code source of truth:** `backend/apiapp/modules/shelter/permissions.py`, `masking.py`; role enum `backend/apiapp/modules/user/schemas.py`
- **Data contract:** [Data Dictionary](../data/smart-shelter-data-dictionary.md)
- **Backlog/decisions:** `blocker-a-backlog.md` (T2-T8), `.decision-log.md`
