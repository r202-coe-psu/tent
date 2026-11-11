---
id: CR-242
title: ถอน role ที่ grant หมดอายุบน edge CouchDB ระหว่าง WAN ล่ม (edge fallback ของ `_users.role_grants`)
status: approved
date: 2026-11-06
updated: 2026-11-09
requested_by: "#1002 (@Mhapong) — review PR #1000 / D7"
decided_by: Soravit Sukkarn (Team Lead)
layer: stable
related:
  - docs/changes/06-A-volunteer/CR-213-coordinator-limited-access-grant.md (FR-12 sweep, นอกขอบเขต "edge fallback")
  - docs/changes/06-A-volunteer/CR-221-coordinator-grant-edit-and-roles.md (FR-20 ถอนเมื่อโปรไฟล์ปิด)
  - docs/changes/01-core/CR-171-users-edge-shelters-soft-delete.md (selector `edge_shelters`)
  - docs/changes/01-core/CR-064-edge-disaster-continuity.md (edge appliance, OD-1 container list, OD-6)
  - "#1173 / #1179 / #1180 (EDGE_MODE — A2 บล็อกการเขียน `_users` ที่ edge)"
affects:
  - docs/data/schema.md §6 `_users` (field ใหม่ `edge_revoked_at` — มีเฉพาะบน edge)
  - docs/data/data-model.md §6 (พฤติกรรม grant บน edge; แก้ข้อความ "role `shelter:{id}`" ที่ §6 ให้ตรง selector `edge_shelters` — ส่วน §1 แถว `_users` ทำแล้วใน PR #348)
  - docs/couchdb-replication/README.md §7 (ข้อจำกัด A2 และแถว "การถอดสิทธิ์ช่วง WAN ล่มไม่ถึง edge"), SETUP-EDGE.md
  - docs/features/edge-disaster-continuity-idea.md (§4 ตาราง `_users`, OD-6 ต่อ / A2)
  - docs/changes/01-core/CR-064-edge-disaster-continuity.md (บันทึกข้อยกเว้น OD-1 เพิ่ม container `edge-grant-sweep` บน edge)
  - docs/changes/06-A-volunteer/CR-213-coordinator-limited-access-grant.md (นอกขอบเขต "edge fallback" → ชี้ CR นี้)
  - ไม่ bump `schema_v` (`_users` ไม่มี common envelope / `schema_v`)
  - docker-compose.edge.yml (service ใหม่ `edge-grant-sweep`), .env.edge.example
  - worker/src/worker/role_grants.py (แยกฟังก์ชัน pure ให้ edge ใช้ร่วม) + worker/src/worker/edge_grant_sweep.py (ใหม่) + worker/pyproject.toml (entrypoint)
  - worker/tests/test_role_grants.py (คง `edge_shelters`), worker/tests/test_edge_grant_sweep.py (ใหม่)
  - frontend/src/lib/server/user-service.test.ts (path ถอน grant คง `edge_shelters`)
why: grant ของ coordinator หมดอายุตามปกติทุกฉบับ แต่ระหว่าง WAN ล่ม sweep ที่ central ไปไม่ถึง edge ทำให้ role ที่หมดอายุยังใช้ login และเขียน `shelter_{code}` ที่ edge ได้ตลอดช่วงที่ WAN ล่ม
---

# CR-242 — ถอน role ที่ grant หมดอายุบน edge ระหว่าง WAN ล่ม

> **สรุป (TL;DR):**
>
> - **ปัญหา:** `_users` ถูก replicate ลง edge แล้ว (PR #348, `scripts/edge-init.sh`) แต่ sweep ถอน grant (CR-213 FR-12) รันที่ central เท่านั้น ระหว่าง WAN ล่ม role ที่หมดอายุยังใช้ได้ที่ edge จนกว่า WAN กลับ
> - **ข้อเสนอ (ตัวเลือก D):** คง selector `edge_shelters` ของ CR-171 (ส่งการถอนลง edge เมื่อ WAN ปกติ — มีอยู่แล้ว ต้องล็อกด้วย test) และเพิ่ม service `edge-grant-sweep` บน edge ที่ถอน grant หมดอายุของศูนย์ตัวเอง **เฉพาะเมื่อ central ติดต่อไม่ได้ ≥ 15 นาที** แล้วล้าง conflict เมื่อ WAN กลับ
> - **ทางเลือกที่ถูกที่สุด (ตัวเลือก E):** ยอมรับเป็นข้อจำกัด เหมือนการถอดสิทธิ์โดย SM (decision sync 2026-10-18)
> - **layer: stable** (auth + sync + edge appliance) · approved โดย Soravit Sukkarn (Team Lead) 2026-11-09 · ไม่ bump `schema_v` · ขึ้นกับ EDGE_MODE (#1179, #1180)

---

## Why

- **ที่มา:** review PR #1000 (Warning "Edge fallback") และ D7 ของ Team Lead: พฤติกรรมบน edge ไม่อยู่ในขอบเขต CR-213 ให้เปิด #1002
- **สถานะปัจจุบัน (ตรวจ 2026-11-06, ต่างจากตอนเปิด #1002):**
  - `_users` **ถูก replicate ลง edge แล้ว** — PR #348 merge 2026-11-05: job `users_<code>_pull` (`scripts/edge-init.sh:131-136`) selector `edge_shelters` มี `<CODE>` **หรือ** `roles` มี `shelter:<CODE>` (CR-171 FR-9) #1002 เปิด 2026-10-28 ก่อน #348 merge จึงเขียนว่ายังไม่มีโค้ด
  - ยังไม่มี edge ที่ศูนย์จริง: gate "ห้ามติดตั้ง edge ที่ศูนย์จริงจนกว่า PR edge mode (A2) จะ merge" (`docs/couchdb-replication/README.md:626-628`) และ EDGE_MODE ยังเปิดอยู่ (#1179, #1180) **ปัญหาจึงยังไม่เกิดจริง แต่จะเกิดทันทีที่ติดตั้ง edge เครื่องแรก**
  - edge appliance ไม่มี sync worker (`docker-compose.edge.yml:1-2`) sweep ของ grant รันใน retention job ของ central ทุก 300 วินาที (`worker/src/worker/retention/job.py:36,211`)
- **failure mode 1 — WAN ล่ม:** central ถอน role ใน `_users` ของ central ได้ตามเวลา แต่ revision นั้นไปไม่ถึง edge จนกว่า WAN กลับ ระหว่างนั้น login ที่ edge ตรวจกับ `_users` ของ edge จึงยังได้ `SHxxx:<role>` และ `shelter:SHxxx` (อ่าน PII + เขียนตาม VDU) นานเท่าที่ WAN ล่ม ไม่ใช่ ≤ 5 นาทีตาม CR-213 FR-13
  - ระหว่าง WAN ล่ม ไม่มีใครที่ศูนย์ถอนสิทธิ์ได้: การจัดการผู้ใช้ทำที่ central เท่านั้น (`docs/data/data-model.md:214`) และ EDGE_MODE บล็อกการเขียน `_users` ที่ edge
- **failure mode 2 — sweep ถอด `shelter:SHxxx`:** ถ้า selector ดู `roles` อย่างเดียว revision ที่ถอด `shelter:SHxxx` ไม่ตรง selector และไม่ถูกส่งลง edge ตลอดไป
  - **แก้แล้วโดย CR-171:** selector ใช้ `edge_shelters` (append-only) ทุก path ที่เขียน grant คง field นี้: `createUser` (`frontend/src/lib/server/user-service.ts:474`), `grantCoordinatorRole` (`:677`), `revokeCoordinatorGrant` / `updateUser` ผ่าน `nextEdgeShelters` (`:178-179`) และ sweep ของ worker spread `**doc` (`worker/src/worker/role_grants.py:145-150`)
  - **ช่องว่าง:** ไม่มี test ของ worker ที่ล็อกว่า sweep คง `edge_shelters` (`grep edge_shelters worker/` ไม่พบ)
- **ต่างจากการถอดสิทธิ์โดย SM:** decision sync 2026-10-18 ยอมรับว่าการถอดสิทธิ์ช่วง WAN ล่มไปไม่ถึง edge (`README.md:638`) แต่การถอดสิทธิ์โดย SM เป็นเหตุพิเศษ ส่วน grant **หมดอายุทุกฉบับ** (สูงสุดสิ้นวันที่ +7) และออกให้จิตอาสาเพื่อจำกัดเวลาโดยเฉพาะ ถ้าไม่บังคับที่ edge grant ทุกฉบับที่ยังไม่หมดตอน WAN ล่มจะไม่มีวันหมดจนกว่า WAN กลับ

## ทางเลือก

|                                                  | กลไก                                                                                                                                                  | ต้องมี                                                                                                        | ระหว่าง WAN ล่ม                        | failure mode                                                                                                                                                                                                                                                                                                                | effort                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **A** edge sweep เต็มรูป                         | edge รัน sweep เดียวกับ central จาก `role_grants` ตลอดเวลา                                                                                            | service บน edge, นาฬิกา edge                                                                                  | ถอนตามเวลา ✅                          | WAN ปกติ: edge กับ central ถอน grant เดียวกันห่างกันไม่กี่นาที → **conflict ใน `_users` ทุกครั้งที่ grant หมด** และ CouchDB ปฏิเสธ login ของ doc ที่มี conflict (`README.md:610`) · กฎโปรไฟล์ (FR-12/FR-20) ต้องอ่าน `shelter_{code}` ของศูนย์อื่นที่ edge ไม่มี → 404 = ถอนผิด                                             | สูง                   |
| **B** selector `edge_shelters`                   | revision ที่ถอน role ยังตรง selector จึงไหลลง edge                                                                                                    | — (มีแล้ว CR-171)                                                                                             | **ไม่ช่วย** — role ค้างจน WAN กลับ ❌  | ถ้า path ใหม่เขียน `_users` โดยไม่คง `edge_shelters` การถอนไม่ถึง edge เลย (ต้องล็อกด้วย test)                                                                                                                                                                                                                              | ต่ำ (test เท่านั้น)   |
| **C** edge ไม่รับ role ที่มี grant               | กัน role ที่มาจาก grant ไม่ให้ใช้ที่ edge                                                                                                             | เปลี่ยนรูป role (เช่น grant ใช้ prefix อื่นที่ `_security` ของ edge ไม่รับ) หรือ selector ตัด doc ที่มี grant | ปลอดภัยสุด ✅                          | replication แปลง doc ไม่ได้ จึงต้องแก้รูป role แบบ compound (CR-093, stable core) หรือใช้ selector ซึ่งประเมินเฉพาะ revision ใหม่ → doc ค้าง revision เก่าที่ edge (ปัญหาเดียวกับ CR-171) · VDU เห็นแค่ `userCtx.roles` อ่าน `role_grants` ไม่ได้ · **จิตอาสาที่ได้ grant ใช้ edge ไม่ได้เลย** ทั้งที่เป็นกำลังเสริมช่วงภัย | สูง + เสีย continuity |
| **D (เสนอ)** B + edge sweep เฉพาะตอน central ล่ม | B เป็นฐาน · service บน edge ถอน grant หมดอายุของศูนย์ตัวเองเฉพาะเมื่อ central `_up` ล้มต่อเนื่อง ≥ 15 นาที · WAN กลับแล้วลบ branch ที่ edge เขียนทิ้ง | service บน edge (image worker), นาฬิกา edge                                                                   | ถอนตามเวลา (ช้าสุด 15 นาที + 1 รอบ) ✅ | conflict เกิดเฉพาะหลัง outage และถูกล้างอัตโนมัติ · นาฬิกา edge ผิดมาก = ถอนเร็ว/ช้า (มี guard) · ต้องยกเว้น A2 ให้ service นี้เขียน `_users` ที่ edge                                                                                                                                                                      | กลาง                  |
| **E** B + ยอมรับข้อจำกัด                         | เหมือน B · บันทึกว่า grant ไม่หมดอายุที่ edge ระหว่าง WAN ล่ม                                                                                         | —                                                                                                             | role ค้างจน WAN กลับ ❌                | เหมือน B · ความเสี่ยงยาวเท่า outage                                                                                                                                                                                                                                                                                         | ต่ำ                   |

**ข้อเสนอ: D**

- ปิด failure mode 1 สำหรับกรณีที่เกิดบ่อยที่สุด (หมดอายุ) โดยไม่แก้รูป role, selector หรือ VDU
- จิตอาสายังใช้ edge ได้จนถึงวันหมดจริง (ต่างจาก C)
- ไม่สร้าง conflict ตอน WAN ปกติ (ต่างจาก A) เพราะ edge ทำงานเฉพาะตอน central ติดต่อไม่ได้ และ conflict หลัง outage ถูกล้างโดย service เดียวกัน
- ใช้ฟังก์ชัน pure ของ central ร่วมกัน โดยกรองผลเฉพาะ grant ของศูนย์ตัวเอง (`shelter_code == SHELTER_CODE`) ก่อนเรียก `apply_revocations` เพื่อไม่ให้ edge แตะ grant ของศูนย์อื่น
- ถ้า Team Lead เห็นว่าต้นทุน service บน edge ไม่คุ้มสำหรับ pilot ศูนย์เดียว ให้เลือก **E** และทำเฉพาะ FR-1, FR-2, FR-12, FR-13

## Change (ตัวเลือก D)

### FR — ฐาน: การถอนไหลลง edge เมื่อ WAN ปกติ (B)

- **FR-1:** ทุก path ที่ถอน role ที่มาจาก grant ต้องคง `edge_shelters` ไม่ให้หดตัว (CR-171 FR-1, FR-2): `revokeCoordinatorGrant`, `updateUser`, `deleteUser`, `grantCoordinatorRole` (กรณีแทนที่ grant) และ sweep ของ worker
- **FR-2:** เพิ่ม test ล็อก FR-1: worker `apply_revocations` คืน `edge_shelters` เท่าเดิม (รวมกรณีถอด `shelter:SHxxx`) และ BFF path ถอน grant ใน `user-service.test.ts`

### FR — `edge-grant-sweep` บน edge

- **FR-3:** เพิ่ม service `edge-grant-sweep` ใน `docker-compose.edge.yml` ใช้ image ของ worker กับ entrypoint ใหม่ env เฉพาะ CouchDB ของ edge (`COUCHDB_USER`, `COUCHDB_PASSWORD`), `SHELTER_CODE`, `SYNC_URL` ไม่มี MongoDB และไม่รัน job อื่นของ worker
- **FR-4:** วนทุก `EDGE_GRANT_SWEEP_INTERVAL` (default 60 วินาที) ตรวจ central ด้วย `GET <SYNC_URL>/_up` แบบเดียวกับ `central_up` ของ `scripts/edge-watchdog.sh:45` (ต้องได้ JSON `"status":"ok"` ไม่ใช่แค่ HTTP 200)
- **FR-5:** ถอน grant เฉพาะเมื่อ central ล้มต่อเนื่อง ≥ `EDGE_GRANT_SWEEP_AFTER` (default 900 วินาที) นับจากเวลาที่ central เริ่มติดต่อไม่ได้ โดยเก็บ timestamp `down_since` ใน memory ของ service (หาก container restart ค่าจะถูกรีเซ็ตและเริ่มนับ streak ใหม่ เป็น fail-safe ไม่ให้รีบถอนเร็วเกินไป) ถ้า central ตอบได้แม้ครั้งเดียว ให้รีเซ็ตค่านับใหม่และไม่เขียน `_users`
- **FR-6:** ขอบเขตการถอน: grant ที่ `shelter_code == SHELTER_CODE` และ `expires_at <= now` เท่านั้น
  - นำผลลัพธ์จาก `grants_to_revoke(doc, now)` มากรองเฉพาะรายการที่ `grant["shelter_code"] == SHELTER_CODE` ก่อนส่งต่อเข้า `apply_revocations(doc, filtered_grants)` เพื่อถอนเฉพาะ `SHxxx:<role>` ของศูนย์ตัวเอง, ถอด `shelter:SHxxx` เมื่อไม่เหลือ role ในศูนย์ตัวเอง, คง `edge_shelters` และบัญชี
  - ห้ามแตะ role ถาวร, grant ของศูนย์อื่น (ฟังก์ชัน `apply_revocations` ได้รับเฉพาะ grant ของศูนย์นี้จึงไม่แตะศูนย์อื่น) และกฎโปรไฟล์ (ยกเลิกยืนยันตัวตน / โปรไฟล์ปิด — CR-213 FR-12, CR-221 FR-20) ดู Q3
- **FR-7:** revision ที่ edge เขียนตั้ง `edge_revoked_at: <ISO UTC>` เพื่อแยก branch ของ edge จาก branch ของ central เขียนด้วย admin ของ edge แบบ read-modify-write (409 = อ่านใหม่แล้วคำนวณซ้ำ เหมือน CR-213 FR-12)
- **FR-8:** ล้าง conflict ทุกรอบ (ไม่ขึ้นกับสถานะ central): doc ใน `_users` ของ edge ที่มี `_conflicts` ให้ลบทุก revision ที่มี `edge_revoked_at` ซึ่งมี revision พี่น้องที่ไม่มี field นี้ ไม่แตะ doc ที่ไม่มี conflict
- **FR-9:** guard นาฬิกา: ข้ามรอบและ log warning เมื่อ `now` น้อยกว่า `granted_at` ล่าสุดของ grant ในศูนย์นี้ (นาฬิกาถอยหลัง / RTC reset) ไม่ถอนอะไรในรอบนั้น
- **FR-10:** audit: ทุก grant ที่ edge ถอนเขียน `audit` ใน `shelter_{code}` ของ edge ตาม CR-213 FR-14 (`reason: role_grant.expired`) โดย `context.actor = "edge-worker"` เอกสารขึ้น central ผ่าน job `<code>_push` เดิม (ดู Q4)
- **FR-11:** service นี้เป็นผู้เขียน `_users` บน edge **รายเดียว** ที่ได้รับยกเว้นจาก A2 / EDGE_MODE (เขียน CouchDB ตรงด้วย admin ของ edge ไม่ผ่าน BFF) ข้อความ A2 ใน README §7 และ CR-171 amendment (#1179) ต้องระบุข้อยกเว้นนี้

### FR — เอกสารและ gate

- **FR-12:** แก้ `docs/couchdb-replication/README.md:638` แยกเป็นสองแถว: "grant หมดอายุระหว่าง WAN ล่ม — ทำ (CR นี้)" และ "SM / VC ถอดสิทธิ์ด้วยมือระหว่าง WAN ล่ม — ไม่ทำ ยอมรับเป็นข้อจำกัด" · แก้ `data-model.md` §6 (`:208-209`) และ `edge-disaster-continuity-idea.md` (`:86`, `:160`) ที่ยังเขียนว่า selector คือ `shelter:{id}` ให้ตรง CR-171
- **FR-13:** gate: ห้ามติดตั้ง edge ที่ศูนย์จริงจนกว่า EDGE_MODE (#1180) **และ** FR-1 ถึง FR-11 ของ CR นี้ merge (ถ้าเลือก E: FR-1, FR-2, FR-12 พร้อมบันทึกข้อจำกัดใน README §7 และ CR-213 นอกขอบเขต)

### schema.md §6 `_users` — เพิ่ม field

| Field             | ชนิด | req | หมายเหตุ                                                                                                                                                                                          |
| ----------------- | ---- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edge_revoked_at` | ts   | opt | **มีเฉพาะบน edge** — เวลาที่ `edge-grant-sweep` ถอน grant ระหว่าง central ล่ม (CR นี้) ใช้แยก branch ของ edge ตอนล้าง conflict ไม่ขึ้น central (job `_users` เป็น pull ทางเดียว) ไม่ให้สิทธิ์ใด ๆ |

## นอกขอบเขต

- SM / VC ถอดสิทธิ์ด้วยมือที่ edge ระหว่าง WAN ล่ม (ยังทำที่ central เท่านั้น ตาม data-model §6 และ A2)
- เปลี่ยน OD-6 (edge ถือ central admin) — เครื่อง edge ถูกขโมยยังเขียน central ได้ตามที่ยอมรับไว้
- การออก / ต่ออายุ grant ที่ edge

## Acceptance

- **AC-1 (WAN ปกติ):** grant `SH001:distribution_staff` ของบัญชีที่ `edge_shelters: ["SH001"]` หมดอายุ → central sweep ถอนและถอด `shelter:SH001` → doc ที่ edge ได้ revision เดียวกับ central ภายในรอบ replication ไม่มี `edge_revoked_at` และ `_session` ที่ edge ไม่มี role ของ SH001
- **AC-2:** unit test: `apply_revocations` คง `edge_shelters` เท่าเดิมทุกกรณี และ BFF ถอน grant แล้ว `edge_shelters` ไม่หด
- **AC-3 (WAN ล่ม):** ตัดการเข้าถึง `SYNC_URL` จาก edge ≥ 15 นาที แล้ว grant หมดอายุ → ภายใน 1 รอบ `edge-grant-sweep` doc ที่ edge ไม่มี `SH001:<role>` มี `edge_revoked_at` และ login ที่ edge ได้ role ที่เหลือเท่านั้น (ไม่เหลือ role ในศูนย์ = `GET /shelter_sh001` ได้ 403)
- **AC-4:** central ตอบ `_up` ปกติ → `edge-grant-sweep` ไม่เขียน `_users` แม้มี grant หมดอายุ
- **AC-5:** WAN กลับหลัง AC-3 → ภายใน 1 รอบ doc ที่ edge ไม่มี `_conflicts` revision ที่ชนะเป็นของ central และผู้ใช้ login ที่ edge ได้ตาม role ปัจจุบันของ central (รวมกรณี central ออก grant ใหม่ระหว่าง outage)
- **AC-6:** role ถาวรของ SM และ grant ของศูนย์อื่นใน doc เดียวกันไม่ถูกแตะที่ edge
- **AC-7:** ตั้งนาฬิกา edge ให้ก่อน `granted_at` ล่าสุด → ไม่ถอนอะไรและมี log warning
- **AC-8:** audit `role_grant.expired` ที่ `actor: edge-worker` ขึ้น central หลัง WAN กลับ

## Impact

- **auth / sync (stable core):**
  - edge เขียน `_users` ได้เป็นครั้งแรก (ผ่าน service เดียว) — ยกเว้นจาก A2 ที่ owner (@net-lynx) ตัดสิน 2026-10-18 ต้องแก้ CR-171 amendment (#1179) ให้สอดคล้อง
  - ไม่เปลี่ยน `_session`, รูป role (CR-093), selector ของ replication หรือ VDU
  - เพิ่ม container บน edge appliance ขยายจาก CR-064 OD-1 เดิม (CouchDB + nginx + frontend + init/watchdog เพิ่ม `edge-grant-sweep`) และพึ่งนาฬิกาของ edge
- **ความเสี่ยงที่เหลือ:** role หมดอายุยังใช้ได้ที่ edge ช่วงแรกของ outage ไม่เกิน `EDGE_GRANT_SWEEP_AFTER` + 1 รอบ (~16 นาที) โดยวัดจากเวลาที่ grant หมดอายุจริง (ไม่ใช่เวลาที่เริ่มล่ม) · หลัง WAN กลับและ edge ลบ branch ที่มี `edge_revoked_at` ออกแล้ว อาจมีช่วงสั้นๆ ที่ central ยังคงมี revision ที่มี grant หมดอายุอยู่จนกว่า retention sweep ของ central (`RETENTION_INTERVAL_SECONDS = 300`) จะรันและ replicate กลับมา · ระหว่าง conflict ยังไม่ถูกล้าง (หลัง WAN กลับ ≤ 1 รอบ) login ที่ edge ของ doc นั้นล้มแบบ fail-closed
- **audit:** grant ที่ edge ถอนมี audit 2 ฉบับ (central `worker` ตอนหมดอายุจริง + `edge-worker`) แยกด้วย `actor`
- **test:** worker `test_role_grants.py` (FR-2), `test_edge_grant_sweep.py` (FR-4 ถึง FR-10 ด้วย CouchDB mock พร้อมเคส multi-shelter ป้องกันการถอน grant ของศูนย์อื่น), `user-service.test.ts` (FR-2), ทดสอบบน edge จริงตาม AC-3 / AC-5 (เพิ่ม test case ใน README §4)

## Migration

ไม่ bump `schema_v` (`_users` ไม่มี envelope) · `edge_revoked_at` เป็น field ใหม่ที่มีเฉพาะบน edge ไม่มีเอกสารเดิมต้องแก้ · ยังไม่มี edge ที่ศูนย์จริง ลำดับ deploy:

1. FR-1, FR-2 (test) merge
2. EDGE_MODE (#1180) + `edge-grant-sweep` merge
3. ติดตั้ง edge: `docker compose -f docker-compose.edge.yml up -d` (service ใหม่ขึ้นพร้อม `edge-watchdog`)

## คำถามถึง owner / Team Lead

- **Q1:** เลือก D (service บน edge) หรือ E (ยอมรับข้อจำกัด) สำหรับ pilot?
- **Q2:** `EDGE_GRANT_SWEEP_AFTER` 15 นาทีเหมาะไหม (สั้นลง = role ค้างน้อยลง แต่ WAN กระตุกบ่อยจะเกิด conflict บ่อยขึ้น)
- **Q3:** edge ควรใช้กฎโปรไฟล์ด้วยไหม (coordinator ปิดโปรไฟล์ / ยกเลิกยืนยันตัวตนที่ edge ระหว่าง outage แล้วถอน grant ทันที) ถ้าใช้ ต้องอ่านเฉพาะ `shelter_{code}` ของ edge และโปรไฟล์ไม่พบ = ข้าม (ต่างจาก central ที่ 404 = ถอน)
- **Q4:** audit จาก edge: เขียน `role_grant.expired` (`actor: edge-worker`) ซ้ำกับของ central หรือ log อย่างเดียว
- **Q5:** ยกเว้น A2 ให้ service นี้เขียน `_users` ที่ edge ต้องให้ @net-lynx (ผู้ตัดสิน A2) approve ด้วยไหม

## Decision log

- 2026-10-28 — Soravit Sukkarn (Team Lead) ตัดสิน D7 ใน review PR #1000: พฤติกรรมบน edge fallback ไม่อยู่ในขอบเขต CR-213 เปิด issue follow-up (#1002)
- 2026-10-28 — เปิด #1002 (@Mhapong) ขณะนั้นยังไม่มีโค้ด replicate `_users` ลง edge
- 2026-11-05 — PR #348 merge: job `users_<code>_pull` ใช้ selector `edge_shelters` (CR-171) failure mode 2 จึงแก้แล้วสำหรับ path ที่เขียนผ่าน `user-service` และ worker
- 2026-11-06 — proposed (ร่างนี้): เสนอ D, ทางเลือกราคาต่ำ E · ตัด A (conflict ทุกครั้งที่ grant หมดตอน WAN ปกติ) และ C (ต้องแก้รูป role และจิตอาสาเสีย edge)
- 2026-11-09 — approved โดย Soravit Sukkarn (Team Lead) เลือกตัวเลือก D (service edge-grant-sweep บน edge) · รันเลข CR-242 และบันทึกลง _index.md §01-core
