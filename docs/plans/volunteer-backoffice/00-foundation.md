---
title: "Step 00 — Foundation: schema + feature slice"
status: done
created: 2026-08-26
updated: 2026-08-27
blocked_by: CR-094 approval (แก้ schema.md + bump schema_v ต้องรอเคาะ)
---

# Step 00 — Foundation

## เป้าหมาย

`schema.md` ตรงกับ CR-094 และมี slice `features/volunteers/` ที่ครบ 3 ชั้นล่าง (domain → data → application) พร้อม seed data — ยังไม่มี UI

## 00.1 Spec sync

- [ ] `docs/data/schema.md` §2.8 `volunteer` — เพิ่ม `national_id` · `checked_in` · `current_shelter_code` · `volunteer_code` · `identity_verified` · `source` · **schema_v 1 → 2**
- [ ] §2.9 `shift_assignment` — `status` เพิ่ม `standby`/`completed` (rename `done`) · `shift` เพิ่ม `flex` + เวลามาตรฐาน 8 ชม. · `dispatch_status` · `check_in_method` · `check_in_reason` · **schema_v 2 → 3**
- [ ] §2.17 `job` — ลบ `slots_pending` · เพิ่ม `slots_dispatched`/`slots_remaining`/`is_urgent` · `status` เพิ่ม `draft`/`paused` · **schema_v 1 → 2**
- [ ] §2.18 `job_application` — `status` → `pending_review`/`confirmed`/`rejected`/`cancelled` · `applicant.national_id` · **schema_v 1 → 2**
- [ ] §ใหม่ `volunteer_transfer` — schema_v 1 (CR-094 §3.5)
- [ ] อัปเดต `updated:` frontmatter + migration note ทุก section ที่แตะ
- [ ] `docs/data/schema-er-diagram.md` + `data-model.md` — เพิ่ม `volunteer_transfer` และความสัมพันธ์ `job ↔ job_application ↔ shift_assignment ↔ volunteer`

## 00.2 `domain/` — ไม่มี I/O ไม่มี Svelte

ไฟล์ใหม่ใต้ `frontend/src/lib/features/volunteers/domain/`

| ไฟล์ | เนื้อหา |
| --- | --- |
| `volunteer.schema.ts` | Zod + type + `isVolunteer` guard + `makeVolunteer` factory (ผ่าน `catalogDoc` ใน `$lib/db/model`) |
| `job.schema.ts` | เหมือนกัน สำหรับ `job` + enum `JobStatus` |
| `job-application.schema.ts` | `job_application` |
| `shift-assignment.schema.ts` | `shift_assignment` + `SHIFT_WINDOWS` (morning 08:00–16:00 · afternoon 16:00–00:00 · night 00:00–08:00 · flex) |
| `volunteer-transfer.schema.ts` | `volunteer_transfer` |
| `quota.ts` | `computeQuota(job)` → `{confirmed, dispatched, remaining}` · `assertQuotaInvariant()` · `applyDispatch/Accept/Decline` (pure state transition) |
| `capacity.ts` | fill-rate ระดับ **กะ**: `shiftFillRate()` · `bucketFillRate()` → `critical(<50) \| near(50–99) \| met(100)` · `overallBookingRate()` |
| `duty-window.ts` | `isWithinDutyWindow(now, window, graceMinutes = 5)` · `resolveDutyWindow(date, shift)` |
| `collision.ts` | `hasTimeCollision(candidateWindow, existingAssignments)` |
| `skills.ts` | `isControlledSkill()` · `initialStatusForSkills()` (controlled → `pending_review`) |
| `volunteer-code.ts` | `nextVolunteerCode(existingCodes)` → `V-001` |
| `hub-metrics.ts` | **ตัวเดียวที่ทั้ง 3 แท็บใช้** — `computeHubMetrics({volunteers, assignments, applications})` → `{ready, assigned, checkedInNow, pendingApproval, pendingIdentity}` (CR-094 FR-VOL-08.2) |

- [ ] เขียน unit test คู่ทุกไฟล์ที่มี logic: `quota.test.ts` `capacity.test.ts` `duty-window.test.ts` `collision.test.ts` `skills.test.ts` `hub-metrics.test.ts`
- [ ] เคสที่ต้องมี: invariant `confirmed+dispatched+remaining==quota` หลัง dispatch/accept/decline · duty window ขอบ ±5 นาที · กะข้ามเที่ยงคืน (afternoon 16:00–00:00, night 00:00–08:00) · `flex` ไม่มีหน้าต่างตายตัว

## 00.3 `data/`

| ไฟล์ | เนื้อหา |
| --- | --- |
| `volunteer.repository.ts` | **interface** ของทุก entity (`VolunteerRepository`, `JobRepository`, …) — ไม่มี implementation |
| `volunteer.remote.ts` | adapter จริงบน `createRemoteRepository(getShelterDb())` ตาม pattern `referrals/data/referral.remote.ts` |
| `job.remote.ts` / `job-application.remote.ts` / `shift-assignment.remote.ts` / `volunteer-transfer.remote.ts` | เหมือนกัน; query ที่ต้องกรอง → `find()` (Mango) |

- [ ] Mango index ที่ต้องประกาศ: `(shelter_code, status)` บน `job` · `(job_id, status)` บน `job_application` · `(volunteer_id, status)` + `(duty_window.start_ts, duty_window.end_ts)` + `(date, shift)` บน `shift_assignment` · `(tracking_token)` · `(to_shelter_code, status)` บน `volunteer_transfer`
- [ ] Quota mutation (dispatch/accept/decline) ต้องอัปเดต `job.slots_*` **ในลำดับ read-modify-write ที่ retry เมื่อ 409** — ตรวจ invariant ก่อน `put` เสมอ
- [ ] test: `*.remote.test.ts` ด้วย `in-memory-repository.ts`

## 00.4 `application/`

- [ ] `queries.ts` — key factory `volunteerKeys` ผูก `getShelterCode()` (ตาม `referrals/application/queries.ts`)
- [ ] hooks: `useHubMetrics` `useJobs` `useJob` `useJobApplications` `useShiftAssignments` `useTodayAttendance` `useVolunteers` `useTransfers`
- [ ] mutations: `useCreateJob` `useUpdateJob` `useDispatchVolunteers` `useReviewApplication` `useCheckIn` `useCheckOut` `useCreateWalkInVolunteer` `useRequestTransfer` `useDecideTransfer`
- [ ] แท็บ 2 ต่อ live ผ่าน `subscribeDataChanges` (`$lib/db/subscribe-data-changes.ts`) เพื่อ invalidate attendance แบบสด

## 00.5 Barrel + seed

- [ ] `index.ts` — export domain types/funcs, repository factories, queries ทั้งหมด (ไม่ export ไฟล์ภายในตรง ๆ ที่อื่น)
- [ ] `frontend/scripts/seed.ts` — เพิ่ม 3 job (`open` / `draft` / `paused`, มี `is_urgent` 1 ตัว), 5 volunteer (source ต่างกัน), 4 shift_assignment (standby / checked_in / completed), 2 job_application (`pending_review` / `confirmed`), 1 volunteer_transfer

## DoD

- [ ] `pnpm test` ผ่าน — domain coverage ครบทุกฟังก์ชันที่มี branch
- [ ] `pnpm check` 0 error · `pnpm lint` ผ่าน
- [ ] `pnpm seed` แล้วเห็น doc ทั้ง 5 type ใน CouchDB

---

## ภาคผนวก — มติเพิ่มเติม 2026-08-26 (หลัง domain review)

**นิยาม 5 ตัวนับของ `hub-metrics.ts`** (single source of truth ตาม FR-VOL-08.2 / AC-094-09) — อ่านสถานะจาก `shift_assignment.status` เท่านั้น ห้ามอ่าน `volunteer.checked_in` (เป็น cache ที่ skew ได้) และทุกค่าที่นับกะต้อง **scope เฉพาะวันนี้ + ศูนย์ปัจจุบัน** และนับเป็น **distinct volunteer** ไม่ใช่จำนวนแถว

| ตัวนับ | นิยาม |
| --- | --- |
| พร้อมปฏิบัติงาน (`ready`) | distinct อาสา `status='active'` ทั้งหมดในศูนย์ (pool — ทับกับตัวอื่นได้ ตรงกับแท็บ 3: ทั้งหมด = รออนุมัติ + พร้อมปฏิบัติงาน) |
| รับกะแล้ว (`assigned`) | distinct อาสาที่มี `shift_assignment` **ของวันนี้** สถานะ `assigned` หรือ `standby` |
| เช็คอินอยู่ตอนนี้ (`checkedInNow`) | distinct อาสาที่มี `shift_assignment` **ของวันนี้** สถานะ `checked_in` |
| รออนุมัติ (`pendingApproval`) | `job_application` สถานะ `pending_review` |
| รอยืนยันตัวตน (`pendingIdentity`) | อาสา `status='active'` และ `identity_verified=false` |

**`job` default status = `open`** (ตรงกับ schema.md §2.17 เดิม) — `draft` เป็นตัวเลือกในฟอร์ม ไม่ใช่ค่าเริ่มต้น

**เกณฑ์ `almost_full`** (ไม่มีระบุใน CR-094/schema.md — **รอเจ้าของโครงการเคาะ**): `full` เมื่อ `slots_remaining === 0` · `almost_full` เมื่อ `slots_remaining <= max(1, ceil(quota × 0.2))` · นอกนั้น `open` — คิดจาก `slots_remaining` จึงนับรวมคนที่ `dispatched` ไปแล้ว และ `almost_full` เข้าถึงได้ทุกขนาด quota (เกณฑ์ 80% ของ `slots_confirmed` แบบเดิม ทำให้งาน quota ≤ 4 ข้ามจาก `open` ไป `full` เลย)

**ตัวนับที่ 6 `completed`** — เพิ่มจาก 5 ตัวในตารางข้างบน เพราะแถบ attendance (FR-VOL-11.3) ต้องใช้ "เสร็จสิ้นภารกิจ/เช็คเอาต์แล้ว" และ FR-VOL-08.2 ห้ามแท็บคำนวณเอง · นิยาม: distinct อาสาที่มี `shift_assignment` ของวันนี้สถานะ `completed`

**"วันนี้" ทุกที่ = Asia/Bangkok** ผ่าน `domain/duty-window.ts#bangkokDateString()` — ทั้ง `useHubMetrics`, `useTodayAttendance` และ `scripts/seed.ts` ห้ามใช้ UTC date เพราะช่วง 00:00–07:00 น. จะไปดึง roster ของเมื่อวาน ซึ่งคือทั้งกะดึก (00:00–08:00)

---

## ภาคผนวก — `job.shifts[]` (2026-08-27) · ⚠️ ยังไม่มี CR รองรับ

ฟอร์ม "ประกาศภารกิจงานอาสาใหม่" ที่เจ้าของโครงการส่งมา (2026-08-27) เก็บ **กะย่อยหลายแถว** แต่ละแถวมีวันที่ + เวลาเข้า/ออก + จำนวนรับของตัวเอง ซึ่ง `job` เดิม (schema_v 2) เก็บได้แค่ `shift_template` อันเดียว + `quota` ก้อนเดียว

**สิ่งที่เปลี่ยน (implement แล้ว):**

| | |
| --- | --- |
| `job.shifts[]` | `{id, date, start_time, end_time, quota}` — req, อย่างน้อย 1 แถว |
| `job.quota` | **derive** = `sum(shifts[].quota)` — บังคับด้วย `.refine` ทั้งใน doc schema และคำนวณใน `makeJob` |
| `job.shift_template` | เปลี่ยนเป็น opt + mark deprecated (คงไว้อ่าน doc schema_v 2) |
| `schema_v` | **2 → 3** |
| `jobInputSchema.status` | ขยายเป็น `draft` / `open` / `paused` / `full` / `closed` ตามปุ่ม LIFECYCLE STATUS 5 ตัวในดีไซน์ (`almost_full` และ `cancelled` ไม่อยู่ในนี้ — `almost_full` มาจาก `deriveJobStatus` เท่านั้น) |
| KPI ระดับกะ (FR-VOL-09.4) | เปลี่ยนจาก 1 bucket ต่องาน → **1 bucket ต่อกะจริง** |

**Domain modules ใหม่:**

- `domain/skill-master.ts` — master list ทักษะ 9 รายการ (`key`/`label`/`description`/`icon`/`controlled`) · `skills.ts#DEFAULT_CONTROLLED_SKILLS` derive จากที่นี่ ทำให้การ์ดที่ SM ติ๊กกับ gate ที่บังคับ `pending_review` ไม่มีทางไม่ตรงกัน
- `domain/shift-batch.ts` — ตัวขยายช่วงวันของ Batch Generator (pure + test 21 เคส) · เพดาน `MAX_BATCH_SHIFTS = 180` แถวต่อการกด Generate หนึ่งครั้ง และปฏิเสธช่วงยาวเกิน 1 ปี

> **[NEEDS CR]** การเปลี่ยนรูป doc ที่ persist แล้ว + bump `schema_v` ต้องมี Change Record ตาม [change-management.md](../../change-management.md) §2 — ต้องเปิด CR amend CR-094 ย้อนหลังให้ครบ (ยังไม่ได้ทำ เพราะยังไม่ได้เคาะวิธี track)

**Migration (2 → 3):** doc เดิมสร้าง `shifts` 1 แถวจาก `shift_template` + `quota` เดิม; `date` ไม่มีข้อมูลเดิม → ใช้วันที่ของ `created_at` ตามเวลา Asia/Bangkok
