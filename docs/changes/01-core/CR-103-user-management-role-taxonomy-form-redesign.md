---
id: CR-103
title: User Management V10 — ขยาย Role Taxonomy เป็น 10 บทบาท + Redesign ฟอร์มสร้าง/แก้ผู้ใช้ ให้ผูกกับ volunteer feature (Personnel Type, Volunteer Link, Duty-Access Window) (renumbered from CR-098)
status: superseded
superseded_by: CR-104
superseded_date: 2026-08-31
note: รวมเนื้อหาเข้าสู่ CR-104-volunteer-backoffice-and-user-management-v10.md ฉบับสมบูรณ์แล้ว (renumbered จาก CR-098 เดิมเพื่อคืนหมายเลข CR-098 ให้กับ M2 External API Integration)
date: 2026-08-30
requested_by: Dev Team-B (UI V10 mockup — user management redesign)
depends_on:
  - CR-092 (Volunteer Management V10 — Unified Identity, Time-Bound RBAC)
  - CR-101 (Volunteer Back-office V10 reconcile — `volunteer` schema_v 2)
  - CR-102 (Volunteer job shifts + `personnel_type` — `volunteer` schema_v 3)
decided_by: project owner
layer: volatile
affects:
  - docs/prd/role-permission-matrix.md §1.1 (RoleKey vocabulary)
  - docs/data/schema.md §6 `_users` (duty_window, volunteer_id, active)
  - docs/data/schema.md §2.8 `volunteer.user_name` (เขียนสองทางจากฟอร์มผู้ใช้)
  - docs/features/volunteer-job-board-flow.md R-AFFIL-1/2/5
  - frontend/src/lib/auth/roles.ts
  - frontend/src/lib/features/users/**
  - frontend/src/lib/features/volunteers (อ่านผ่าน barrel: `useVolunteers`, `personnelTypeSchema`, `useUpdateVolunteer`)
  - frontend/src/lib/server/user-service.ts
  - frontend/src/routes/api/v1/users/+server.ts
  - schema_v: `_users` metadata (ไม่ bump — เพิ่ม optional field เท่านั้น)
---

# CR-103 — Role Taxonomy 10 บทบาท + Redesign ฟอร์มจัดการผู้ใช้งาน (V10, renumbered จาก CR-098)

> **สรุป (TL;DR):** ต่อยอด **UI V10** ของสายจิตอาสา (CR-092 / CR-094 / CR-097) มาที่หน้าจัดการผู้ใช้งาน:
> ขยายชุด RoleKey จาก 5 เป็น **10 บทบาท** ให้ตรงกับหน้าที่จริงหน้างาน และ redesign ฟอร์ม
> "เพิ่มผู้ใช้ใหม่ในระบบ" ให้เลือก **ชนิดคน (Staff ประจำ / อาสาสมัคร)** ตาม R-AFFIL-1/2,
> **ผูกกับโปรไฟล์ในทะเบียนจิตอาสาที่มีอยู่จริง** (อ่านผ่าน barrel `$lib/features/volunteers`)
> และกำหนด **ช่วงเวลาปฏิบัติงาน (Duty-Access Window)** ตาม D-DUTY-ACCESS=B.
> **ขอบเขตรอบนี้จำกัดที่ vocabulary + ฟอร์ม + การเก็บข้อมูลเท่านั้น — ยังไม่แตะ enforcement ของ RBAC**
> (validate_doc_update / guard / matrix ยังบังคับใช้ 5 บทบาทเดิม) ตามที่เจ้าของโครงการสั่ง

**ทำไมต้องผูกกับ volunteer feature:** ตอนนี้ feature `volunteers` build เสร็จแล้ว (V10) และมี
`useVolunteers()` / `volunteerRepository()` ให้ดึงรายชื่อได้ทันที — หน้าจัดการผู้ใช้จึงไม่ควรสร้าง
adapter อ่านทะเบียนอาสาซ้ำอีกชุด แต่ต้องเรียกผ่าน barrel ของ `volunteers` และเขียนความเชื่อมโยง
กลับเข้า `volunteer.user_name` ให้ฝั่ง roster / dispatch มองเห็นว่าอาสาคนนี้มีบัญชีหลังบ้านแล้ว

---

## 1. Why

1. **บทบาทจริงหน้างานละเอียดกว่า 5 role ที่ lean ไว้ตอน K-12** — ศูนย์ที่ใช้งานจริงแยกงาน
   คัดกรองพยาบาล / คัดกรองเฉพาะทาง / ประสานงานทีม / ประสานงานจิตอาสา ออกจาก "staff ทั่วไป"
   แต่ปัจจุบันทุกคนถูกยัดเป็น `registration_staff` ทำให้ audit trail อ่านไม่ออกว่าใครทำหน้าที่อะไร
2. **ฟอร์มปัจจุบันไม่บังคับ "ชนิดคน"** — ขัดกับ R-AFFIL-1/2 ใน `volunteer-job-board-flow.md`
   ที่ระบุว่าช่องชนิดคนต้องเลือกชัด **Staff ประจำ vs อาสา** และห้ามเดา `affiliation_tags` จาก RoleKey
3. **ไม่มีทางผูก user login กับโปรไฟล์อาสาในทะเบียน** — CR-092 กำหนด `volunteer.user_name` เป็น
   จุดเชื่อม แต่ฝั่ง UI ยังไม่มีที่ให้เลือก ทำให้ต้องพิมพ์ username ให้ตรงเองซึ่งพลาดง่าย
4. **Time-Bound Access ของ CR-092 ยังไม่มีที่ป้อนข้อมูล** — ต้องมีช่องบันทึก duty window ก่อน
   จึงจะทำ enforcement ที่ BFF ได้ในเฟสถัดไป

---

## 2. Change

### 2.1 Role vocabulary — 5 → 10 RoleKey

| # | RoleKey | ชื่อไทย (UI) | ชื่ออังกฤษ (UI) | สถานะ | Enforcement รอบนี้ |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | `system_admin` | ผู้ดูแลระบบสูงสุด | System Admin | เดิม | ✅ บังคับใช้จริง |
| 2 | `shelter_manager` | ผู้จัดการศูนย์พักพิง | Shelter Manager | เดิม | ✅ บังคับใช้จริง |
| 3 | `team_coordinator` | ผู้ประสานงานทีม | Team Coordinator | **ใหม่** | ⚠️ grant ได้ แต่ยังไม่ให้สิทธิ์เพิ่ม |
| 4 | `operations_staff` | เจ้าหน้าที่ปฏิบัติการทั่วไป | Operations Staff | **ใหม่** | ⚠️ grant ได้ แต่ยังไม่ให้สิทธิ์เพิ่ม |
| 5 | `medical_staff` | แพทย์ / เจ้าหน้าที่คัดกรองพยาบาล | Doctor / Nurse | **ใหม่** | ⚠️ grant ได้ แต่ยังไม่ให้สิทธิ์เพิ่ม |
| 6 | `warehouse_staff` | ผู้จัดการคลังเสบียง / ส่งต่อสิ่งของ | Logistics Lead | เดิม (เปลี่ยน label) | ✅ บังคับใช้จริง |
| 7 | `registration_staff` | เจ้าหน้าที่ลงทะเบียนหน้าด่าน | Smart Reg Staff | เดิม (เปลี่ยน label) | ✅ บังคับใช้จริง |
| 8 | `triage_staff` | เจ้าหน้าที่คัดกรองเฉพาะทาง | Triage Staff | **ใหม่** | ⚠️ grant ได้ แต่ยังไม่ให้สิทธิ์เพิ่ม |
| 9 | `kitchen_staff` | เจ้าหน้าที่ครัว / จัดเตรียมอาหาร | Kitchen Lead | เดิม (เปลี่ยน label) | ✅ บังคับใช้จริง |
| 10 | `volunteer_coordinator` | ผู้ประสานงานจิตอาสา | Volunteer Coordinator | **ใหม่** | ⚠️ grant ได้ แต่ยังไม่ให้สิทธิ์เพิ่ม |

**กฎที่ไม่เปลี่ยนในรอบนี้ (สำคัญ):**

- **RoleKey ใหม่ 5 ตัวเป็น "grantable but non-privileged"** — เก็บลง `_users.roles[]` ได้,
  แสดงใน UI ได้, ใช้เป็น label/audit ได้ แต่ **ไม่มี guard / `validate_doc_update` /
  matrix entry ใดอ่านค่าเหล่านี้** ผู้ถือจึงได้สิทธิ์เท่ากับ authenticated staff ในศูนย์ตน
- **ไม่ migrate ข้อมูลเดิม** — `registration_staff` / `kitchen_staff` / `warehouse_staff`
  ยังคงเป็นคีย์เดิม เปลี่ยนเฉพาะ **ข้อความที่แสดง** ให้ตรงกับภาษาที่ใช้หน้างาน
- **ไม่มี RoleKey ชื่อ `volunteer`** — ยังยึดตาม schema.md §6: ความเป็นอาสาอยู่ที่
  `affiliation_tags` เท่านั้น (R-AFFIL-5)

**ผลกระทบต่อ grant surface (จุดที่ต้องเคาะ):** `assertCanGrant` เดิมให้ SM grant ได้เฉพาะ 3 staff key.
CR นี้ขยายให้ SM grant RoleKey ใหม่ทั้ง 5 ได้ด้วย (เพราะเป็น non-privileged) แต่ยัง **ห้าม**
`shelter_manager` / `system_admin` เหมือนเดิม → เป็นการขยาย *สิ่งที่กรอกได้* ไม่ใช่ *สิทธิ์ที่ได้รับ*

### 2.2 ฟอร์มผู้ใช้ — โครงใหม่

ลำดับฟิลด์ตาม mockup:

| ลำดับ | ฟิลด์ | ชนิด | บังคับ | หมายเหตุ |
| :-- | :-- | :-- | :-- | :-- |
| 1 | **ชนิดคน (Personnel Classification)** | การ์ด 2 ตัวเลือก: `เจ้าหน้าที่ประจำ` / `อาสาสมัคร` | ✅ | R-AFFIL-1/2 — ตั้ง `affiliation_tags` |
| 2 | ค้นหาจากทะเบียนอาสา | search + dropdown (ชื่อ / เบอร์โทร) | — | แสดงเมื่อเลือก "อาสาสมัคร" เท่านั้น; เลือกแล้ว **auto-fill** username = เบอร์โทร, ชื่อ-สกุล, ศูนย์, volunteer link |
| 3 | Username | text | ✅ | ≥3 ตัวอักษร (เดิม) |
| 4 | ชื่อ-สกุล | text | ✅ | เดิม |
| 5 | รหัสผ่าน | password + toggle | ✅ ตอนสร้าง | เดิม (edit = ว่างได้) |
| 6 | สังกัดศูนย์ปฏิบัติการ (Shelter Affiliation) | select | ✅ | เพิ่มตัวเลือก **"ทุกศูนย์ (Platform-wide / EOC)"** สำหรับ SA |
| 7 | บทบาทและสิทธิ์การเข้าถึง (System Role) | select 10 รายการ พร้อมคำอธิบายท้ายบรรทัด | ✅ | ตาม §2.1 |
| 8 | แถบชี้แจง R-AFFIL-5 | callout อ่านอย่างเดียว | — | "สิทธิ์กำหนดโดย Role เท่านั้น ไม่จำกัดจากชนิดคน" |
| 9 | ผูกเชื่อมโยงโปรไฟล์ทะเบียนจิตอาสา | select | — | แสดงเมื่อ "อาสาสมัคร"; ค่า = `volunteer:{ulid}` |
| 10 | สิทธิ์ตามช่วงเวลาปฏิบัติงาน (Duty-Access B) | datetime-local × 2 | — | ว่าง = สิทธิ์ถาวร |
| 11 | สถานะบัญชีการใช้งาน | สวิตช์ Active / ระงับ | — | default Active |

### 2.3 การเชื่อม `_users` ↔ `volunteer` — สถานะปัจจุบันและสิ่งที่เพิ่ม

**สถานะปัจจุบัน (ตรวจจาก code จริง):** `volunteer` schema_v 3 **ไม่มี `user_id`** — มีเพียง
`user_name: str|null` (schema.md §2.8) ซึ่งหมายถึง `_users.name` ของบัญชี login. ทิศทางการเชื่อม
จึงเป็น **ทางเดียว จาก volunteer → _users** และฝั่ง `_users` ยังไม่รู้ว่าตัวเองผูกกับอาสาคนไหน

> ⚠️ **ข้อบกพร่องที่พบระหว่างสำรวจ:** `volunteer-access-dialog.svelte` เขียน **อีเมล** ลงใน
> `user_name` ซึ่งผิดความหมายของฟิลด์ (ต้องเป็น `_users.name`). ต้องตัดสินใจว่าจะแก้ dialog
> ให้เขียน username จริง หรือแยกฟิลด์อีเมลออกมาต่างหาก — ดู open question #6

**สิ่งที่ CR นี้เพิ่ม:**

| ที่ | field | ชนิด | req | ความหมาย |
| :-- | :-- | :-- | :-- | :-- |
| `_users` | `volunteer_id` | str\|null | opt | → `volunteer:{ulid}` — back-pointer ให้ user list/form แสดงผลได้โดยไม่ต้อง scan ทะเบียนทั้งศูนย์ |
| `_users` | `duty_window` | {`start_ts`:ISO8601, `end_ts`:ISO8601}\|null | opt | ช่วงเวลาที่บัญชีมีสิทธิ์เขียน; `null`/ไม่มี = ถาวร |
| `_users` | `active` | bool | opt | default `true`; `false` = ระงับการใช้งาน (ยังไม่ลบบัญชี) |
| `volunteer` | `user_name` | str\|null | opt | **ไม่ใช่ field ใหม่** — แต่ฟอร์มผู้ใช้จะเขียนค่านี้ให้ตรงกับ `_users.name` เมื่อผูกโปรไฟล์ |

- **ไม่ bump `schema_v`** ทั้งสองฝั่ง — `_users` เพิ่ม optional field ที่ไม่กระทบ doc เดิม และ
  `volunteer.user_name` มีอยู่แล้วตั้งแต่ schema_v 1
- **Invariant:** ถ้ามี `duty_window` ต้องมีทั้ง `start_ts` และ `end_ts` และ `start_ts < end_ts`
- **Invariant (สองทาง):** ถ้า `_users.volunteer_id = volunteer:X` แล้ว `volunteer:X.user_name`
  ต้องเท่ากับ `_users.name` — ฟอร์มเขียนทั้งสองฝั่งในการบันทึกครั้งเดียว
- **ยังไม่ enforce:** `duty_window` และ `active` เป็น **ข้อมูลที่บันทึกไว้เฉย ๆ** ในรอบนี้ —
  การตัดสิทธิ์ตามเวลาและการบล็อก login ของบัญชีที่ระงับ จะทำใน CR-092 เฟส Time-Bound Guard ที่ BFF

### 2.4 `personnel_type` — ใช้ของเดิม ห้ามนิยามซ้ำ

CR-097 นิยาม `personnelTypeSchema = z.enum(['volunteer', 'staff'])` ไว้แล้วใน
`features/volunteers/domain/volunteer.schema.ts` และ export ผ่าน barrel. ฟอร์มผู้ใช้ต้อง
**import ตัวเดิมจาก `$lib/features/volunteers`** ไม่สร้าง enum ชุดที่สองในฝั่ง `users` —
มิฉะนั้นค่าจะ drift กันระหว่างหน้า roster กับหน้าจัดการผู้ใช้

- ฝั่ง `volunteer` doc: เก็บใน `volunteer.personnel_type` (CR-097)
- ฝั่ง `_users`: ยังเก็บเป็น `affiliation_tags` ตาม R-AFFIL-1/2/5 (ไม่เพิ่ม field ใหม่)

### 2.5 หมายเหตุการ implement (ต่างจาก mockup เล็กน้อย)

- **ชื่อคอมโพเนนต์:** `ui/user-form-dialog.svelte` (แทน `user-form.svelte` เดิม) — ถือ dialog shell
  ของตัวเองและใช้สัดส่วน/ความหนาแน่นชุดเดียวกับ `volunteers/ui/job-form-dialog.svelte`
  (`max-h-[92vh]` + body `max-h-[70vh] space-y-6` + footer ปักหมุด + ทุก control `!h-11`)
- **รวมช่องค้นหาอาสา 2 ช่องเป็นช่องเดียว:** mockup วาดช่อง "ค้นหาจากทะเบียนอาสา" ไว้ด้านบน และ
  "ผูกเชื่อมโยงโปรไฟล์" ไว้ด้านล่าง ทั้งสองอ่าน/เขียนข้อมูลชุดเดียวกัน — implement เป็น picker
  เดียวที่ทำทั้งค้นหาและเป็นค่าที่บันทึก เพื่อลด dead space และไม่ให้สองช่องขัดกันเอง
- **ลำดับฟิลด์:** Role มาก่อน สังกัดศูนย์ (ต่างจากตาราง §2.2) — เพราะเลือก `system_admin` แล้ว
  ระบบตั้งสังกัดเป็น "ทุกศูนย์" ให้อัตโนมัติและล็อกช่องนั้น
- **ช่องค้นหาในหน้า list:** ค้นเฉพาะ ชื่อ-สกุล และ Username (ไม่ค้น role/ศูนย์ — สองอย่างนั้นมี
  filter ของตัวเองอยู่ข้างๆ). Back-office เห็นเฉพาะศูนย์ตน; portal system-management เห็นทุกศูนย์
  และมี filter แยกศูนย์

---

## 3. Scope — สิ่งที่ **ไม่** ทำในรอบนี้

- ❌ ไม่แก้ `validate_doc_update` / `shelter-access-design.ts`
- ❌ ไม่แก้ action matrix ใน `role-permission-matrix.md` §3–§5 (ยังเป็นของ 5 role เดิม)
- ❌ ไม่ทำ enforcement ของ duty window / สถานะระงับ
- ❌ ไม่ทำ compound roles ของ CR-093 (ยังคง 1 user = 1 shelter) — ฟอร์มออกแบบให้ต่อยอดได้
- ❌ ไม่แก้ feature `volunteers` — รอบนี้เรียกผ่าน barrel เท่านั้น (`useVolunteers`,
  `useUpdateVolunteer`, `personnelTypeSchema`) ไม่แตะ domain/data ภายในของ volunteers
- ❌ ไม่ทำหน้าจอ roster / dispatch / check-in ใด ๆ (เป็นของ CR-092 / CR-094 / CR-097)

---

## 4. Migration

ไม่มี migration บังคับ:

- doc `_users` เดิมไม่มี `volunteer_id` / `duty_window` / `active` → ถือว่า `null` / `true`
- RoleKey เดิมไม่เปลี่ยนค่า เปลี่ยนเฉพาะข้อความแสดงผล → ไม่ต้องแตะข้อมูล
- RoleKey ใหม่จะปรากฏก็ต่อเมื่อมีคนเลือกจากฟอร์มเท่านั้น

---

## 5. Acceptance

| # | เกณฑ์ |
| :-- | :-- |
| A1 | dropdown บทบาทแสดงครบ 10 รายการ พร้อมคำอธิบายไทย ตามลำดับใน §2.1 |
| A2 | เลือกชนิดคน = อาสาสมัคร → `affiliation_tags` มี `"volunteer"`; เลือก staff ประจำ → ไม่มี |
| A3 | ค้นหาทะเบียนอาสาแล้วเลือก → username/ชื่อ-สกุล/volunteer link ถูก auto-fill จากข้อมูลจริงใน `volunteers` |
| A3b | บันทึกแล้ว `volunteer.user_name` ของโปรไฟล์ที่ผูก เท่ากับ `_users.name` (roster เห็นว่า "มีบัญชีหลังบ้าน") |
| A4 | SA เลือก "ทุกศูนย์" ได้ และบันทึกเป็น `["system_admin"]` โดยไม่มี `shelter:` |
| A5 | กรอก duty window ไม่ครบคู่ หรือ start ≥ end → validation error ที่ฟอร์ม |
| A6 | ผู้ใช้ที่ถือ RoleKey ใหม่ login แล้วได้สิทธิ์เท่าเดิม (ไม่มีสิทธิ์เพิ่ม, ไม่มี error) |
| A7 | `pnpm lint` + `pnpm check` + `pnpm test` ผ่าน |

---

## 6. Open questions (ต้องเคาะก่อน status → approved)

1. **`volunteer_id` ใน `_users`** — เก็บ back-pointer ตาม §2.3 หรือยึด CR-092 (ทางเดียว)?
2. **`medical_staff` vs `triage_staff`** — แยกจริงสองบทบาท หรือ `triage_staff` เป็นสับเซตของ medical?
3. **ชื่อคีย์** — ใช้ `medical_staff` หรือ `doctor_nurse`? (mockup เขียน "Doctor / Nurse")
4. **SM grant RoleKey ใหม่ได้ไหม** (§2.1) — หรือสงวนให้ SA เท่านั้นจนกว่าจะมี enforcement?
5. **สถานะระงับ (`active: false`)** — บล็อกที่ BFF หรือใช้วิธีลบ role ออกให้หมด?
6. **`volunteer-access-dialog.svelte` เขียนอีเมลลง `user_name`** — แก้ให้เขียน username จริง,
   หรือเพิ่มฟิลด์ `access_email` แยก? (ถ้าไม่แก้ การผูกจากฟอร์มผู้ใช้จะทับค่าอีเมลเดิมทิ้ง)
7. **การเขียนสองฝั่งพลาดกลางทาง** — `_users` สำเร็จแต่ `volunteer.user_name` ล้มเหลว จะ
   retry, rollback, หรือปล่อยแล้วให้ reconcile job ตามเก็บ?

## 7. Decision log

- 2026-08-30 — เปิด CR (proposed) จาก UI V10 mockup ของหน้าจัดการผู้ใช้งาน
- 2026-08-30 — renumber CR-096 → **CR-098**: หมายเลข CR-096 ถูกใช้ไปแล้วโดย `CR-096-volunteer-portal-dispatch-response.md` บน `develop` — เลี่ยงเลขชนใน `_index.md`
