---
id: CR-093
title: Multi-shelter Compound Scoped Roles — รองรับ 1 ผู้ใช้งานปฏิบัติงานหลายศูนย์พักพิงและหลากบทบาท ป้องกัน Privilege Bleed
status: approved
date: 2026-08-27
updated: 2026-09-01
requested_by: stakeholder requirement (vertical shelter / host houses cluster)
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §6 (_users.roles)
  - docs/data/data-model.md §6
  - docs/prd/role-permission-matrix.md
  - frontend/src/lib/auth/roles.ts
  - frontend/src/lib/server/user-service.ts
  - frontend/src/lib/server/shelter-access-design.ts (validate_doc_update)
  - frontend/src/lib/features/users/**
  - frontend/src/lib/stores/shelter.svelte.ts (active workspace switcher)
---

# CR-093 — Multi-shelter Compound Scoped Roles

> **สรุป (TL;DR):** ปรับปรุงโครงสร้างบทบาทผู้ใช้งานใน CouchDB `_users` จากเดิมที่ผูกได้เพียง 1 ศูนย์ (1 user 1 shelter) ให้รองรับการกำหนดสิทธิ์แบบ **Compound Scoped Roles (รหัสศูนย์ + บทบาท เช่น `SH001:shelter_manager` และ `SH002:registration_staff`)** ช่วยให้ผู้ใช้ 1 คนสามารถดูแลหลายศูนย์พักพิง (Multi-shelter) ได้อย่างยืดหยุ่น โดยมีบทบาทที่แตกต่างกันในแต่ละศูนย์ได้ และป้องกันปัญหาสิทธิ์รั่วไหลข้ามศูนย์ (Privilege / Role Bleeding) ได้อย่างปลอดภัย 100%

---

## 1. Why (ที่มาและความจำเป็น)

1. **การบริหารจัดการ Vertical Shelters / บ้านพี่เลี้ยง (Host Houses Cluster):**
   * ในสถานการณ์จริง เจ้าหน้าที่ 1 คนอาจต้องรับผิดชอบดูแลอาคารที่พักพิงแนวดิ่ง (Vertical Shelters) หลายตึก หรือกลุ่มบ้านพี่เลี้ยงหลายหลังในละแวกเดียวกัน
   * ในบางศูนย์ ผู้ใช้อาจเป็น **ผู้จัดการศูนย์ (Shelter Manager)** ในศูนย์หลัก (เช่น `SH001`) แต่ทำหน้าที่เป็นเพียง **เจ้าหน้าที่ลงทะเบียน (Registration Staff)** หรือฝ่ายสนับสนุนในศูนย์ข้างเคียง (เช่น `SH002`)
2. **ข้อจำกัดของโครงสร้างปัจจุบัน (1 User = 1 Shelter Invariant):**
   * ปัจจุบัน `_users.roles` รองรับเฉพาะบทบาทแบบแบนราบ (Flat Array) เช่น `["shelter:SH001", "shelter_manager"]`
   * หากใส่หลายศูนย์และหลายบทบาทรวมกัน เช่น `["shelter:SH001", "shelter:SH002", "shelter_manager", "registration_staff"]` จะทำให้เกิดปัญหา **Role Bleeding** — ฟังก์ชัน `validate_doc_update` ของ CouchDB ในฐานข้อมูล `shelter_SH002` จะมองเห็นสิทธิ์ `shelter_manager` ทำให้ผู้ใช้ได้รับสิทธิ์สูงสุดในทั้งสองศูนย์โดยไม่ตั้งใจ
3. **ลดความซ้ำซ้อนของการถือหลายบัญชี:**
   * ช่วยให้เจ้าหน้าที่ไม่ต้องคอยสลับ Login เข้า-ออกด้วย Username หลายบัญชี (เช่น `user.sh001`, `user.sh002`) แต่สามารถใช้บัญชีเดียวสลับพื้นที่ปฏิบัติงาน (Workspace) ได้ทันที

---

## 2. Change (สิ่งที่จะเปลี่ยนแปลง)

### 2.1 โครงสร้าง `_users.roles` ใน CouchDB

| รูปแบบ | ก่อนหน้านี้ (Before) | หลังปรับปรุง (After - Compound Roles) |
| :--- | :--- | :--- |
| **Global Admin** | `["system_admin"]` | `["system_admin"]` (คงเดิม) |
| **1 ศูนย์ 1 บทบาท** | `["shelter:SH001", "shelter_manager"]` | `["shelter:SH001", "SH001:shelter_manager"]` (หรือรองรับ legacy fallback) |
| **หลายศูนย์ หลายบทบาท** | *ไม่รองรับ (เกิด Role Bleed)* | `["shelter:SH001", "shelter:SH002", "SH001:shelter_manager", "SH002:registration_staff"]` |

* **`shelter:{code}`**: ทำหน้าที่เป็น Access Gate ระดับ Database (`_security.members.roles`) ให้ผู้ใช้สามารถเปิดฐานข้อมูล `shelter_{code}` นั้นๆ ได้
* **`{code}:{capability}`**: ทำหน้าที่เป็น Permission Validator ประจำศูนย์นั้นๆ เช่น `SH001:shelter_manager`, `SH002:registration_staff`, `SH002:kitchen_staff`

---

### 2.2 การตรวจสอบสิทธิ์ใน CouchDB (`validate_doc_update`)

ใน Design Document ของแต่ละฐานข้อมูล `shelter_{code}`:
* ปรับฟังก์ชันตรวจสอบสิทธิ์ให้อ่านบทบาทที่ขึ้นต้นด้วย Prefix ของศูนย์ตนเองเป็นหลัก:
```javascript
// ตัวอย่าง logic ภายใน validate_doc_update ของ database shelter_SH002
function isRole(cap) {
  // ตรวจสอบทั้งแบบ Compound Role และ Global System Admin
  return userCtx.roles.indexOf('system_admin') !== -1 ||
         userCtx.roles.indexOf('SH002:' + cap) !== -1 ||
         userCtx.roles.indexOf(cap) !== -1; // legacy backward compatibility
}
```

---

### 2.3 การทำงานฝั่ง Application UI & BFF

1. **Active Workspace Selector (เมนูสลับศูนย์ปฏิบัติงาน):**
   * เมื่อผู้ใช้ที่มีหลายศูนย์เข้าสู่ระบบ ระบบจะตรวจจับรายการศูนย์ที่ผู้ใช้มีสิทธิ์จาก `roles` (เช่น พบ `shelter:SH001` และ `shelter:SH002`)
   * แสดง Dropdown สลับศูนย์ที่ Navbar (สลับได้เฉพาะศูนย์ที่ตนเองมีสิทธิ์ ไม่เห็นศูนย์อื่นในระบบ)
2. **Context-Aware Capabilities:**
   * เมื่อผู้ใช้เลือกทำงานใน **SH001** ➔ ระบบประเมินสิทธิ์จาก `SH001:*` ทำให้เห็นเมนูและสิทธิ์ของ **Shelter Manager** เต็มรูปแบบ
   * เมื่อผู้ใช้สลับไปที่ **SH002** ➔ ระบบประเมินสิทธิ์จาก `SH002:*` ทำให้หน้าจอเปลี่ยนเป็นโหมด **Registration Staff** (ซ่อนเมนูบริหารจัดการศูนย์/คลังพัสดุ)

---

## 3. Impact (ผลกระทบและการแก้ไข)

1. **`frontend/src/lib/auth/roles.ts`:**
   * เพิ่ม Helper Functions:
     * `userShelterCodes(roles: string[]): string[]` — ดึงรายชื่อศูนย์ทั้งหมดที่ผู้ใช้เข้าถึงได้
     * `userCapabilitiesForShelter(roles: string[], shelterCode: string): string[]` — ดึงบทบาทเฉพาะของศูนย์นั้น
     * `hasCapabilityInShelter(roles: string[], shelterCode: string, capability: string): boolean`
2. **`frontend/src/lib/server/shelter-access-design.ts`:**
   * ปรับปรุงฟังก์ชัน Template ของ `validate_doc_update` ให้ตรวจสอบ Prefix `{shelter_code}:{role}`
3. **`frontend/src/lib/server/user-service.ts`:**
   * ปรับฟอร์มและการบันทึกผู้ใช้ใน System Management ให้สามารถเลือกมอบหมายหลายศูนย์พร้อมระบุบทบาทแยกรายศูนย์ได้
4. **`docs/data/schema.md` §6 & `docs/data/data-model.md` §6:**
   * อัปเดตนิยามโครงสร้าง `_users.roles` และ Security Invariant ให้รองรับ Compound Roles

---

## 4. Migration & Backward Compatibility

* **Non-breaking / Additive:** โครงสร้างเดิมที่เป็น `["shelter:SH001", "shelter_manager"]` ยังคงใช้งานได้ตามปกติผ่าน Fallback Rule
* **Edge Server Replication:** การ Filter Replicate `_users` ลง Edge Server ประจำศูนย์ ยังคงใช้เงื่อนไขตรวจจับ `shelter:{code}` ได้เหมือนเดิมโดยไม่ต้องแก้ Replication Rule ที่ฝั่ง CouchDB Sync Gateway

---

## 5. Decision Log

* **2026-08-27:** Drafted and proposed ตามข้อสรุปความต้องการใช้งานร่วมกับ Vertical Shelter และ Host Houses Cluster (แนวทาง Compound Scoped Roles)
