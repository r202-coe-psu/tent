# PR Code Review — CR-107: Volunteer Shift Identity and Capacity Reconciliation

- **Target:** Local Unstaged Changes (`feat/volunteer`)
- **Review Date:** 2026-09-04
- **Verdict:** Request changes
- **Merge Readiness:** ❌ ยังไม่พร้อม merge
- **Review Attempt:** 1/3

---

## สรุปภาพรวม (Executive Summary)

จากการตรวจสอบการเปลี่ยนแปลงล่าสุดในชุดงาน **CR-107 (Volunteer Shift Identity and Capacity Reconciliation)** ซึ่งครอบคลุมทั้ง Frontend, Backend (FastAPI), Worker Inbound/Projector และ Database Schemas โดยเน้นเป็นพิเศษใน 3 ด้าน: **Security (ความปลอดภัยและสิทธิการเข้าถึง)**, **Edge Cases Handling (กรณีขอบเขตและความผิดพลาด)** และ **Best Practices (มาตรฐานโค้ดและการทดสอบ)**

พบประเด็นสำคัญระดับ **Blocker** 3 จุด ได้แก่:
1. **Syntax / Duplicate Declarations** ใน Frontend ทำให้ Vitest และ `svelte-check` ทำงานไม่ผ่าน
2. **Race Condition** ใน Worker `sync_job_shift_slot` ที่อาจเขียนทับและลบยอดจองกะ (atomic quota reservations) ของใบสมัครที่อยู่ใน Buffer
3. **DoS Vulnerability & Memory Leak** ใน Public Endpoint (`/api/public/v1/volunteer/apply`) จากการโหลด `_all_docs?include_docs=true`

---

## 1. Blockers (สิ่งที่ต้องแก้ไขก่อน Merge)

### 1.1 Syntax & Duplicate Identifiers ทำให้ Build และ Test Suite พัง
- **ไฟล์ที่พบ:** 
  - [`frontend/src/lib/server/user-service.test.ts`](file:///home/saktanuthpeak/tent/frontend/src/lib/server/user-service.test.ts#L5-L18)
  - [`frontend/src/routes/force-setup/+page.svelte`](file:///home/saktanuthpeak/tent/frontend/src/routes/force-setup/+page.svelte#L8-L25)
- **รายละเอียด:**
  - `user-service.test.ts`: บรรทัดที่ 8 มีการ import `setupSecurityQuestionAndResetPassword` ซ้ำโดยลืมเครื่องหมายจุลภาค `,` ทำให้เกิด `[PARSE_ERROR] Expected ',' or '}'` ส่งผลให้ Vitest รันไม่ผ่านทั้งชุดทดสอบ นอกจากนี้ยังมีการประกาศตัวแปร `fakeUsersDb` และ `docBody` ซ้ำซ้อน 2 รอบ
  - `force-setup/+page.svelte`: มีการ import `SECURITY_QUESTIONS` ซ้ำสองบรรทัด, อ้างอิง type `SecurityQuestionId` ที่ไม่มีอยู่จริง และประกาศตัวแปร `let questionId = $state(...)` ซ้ำ 2 รอบ ทำให้ `svelte-check` ล้มเหลวทันที (15 errors)
- **ผลกระทบ:** CI/CD Build pipeline ล้มเหลวทั้งหมด โค้ดไม่สามารถ compile หรือ deploy ได้
- **แนวทางแก้ไข (Diff):**

```diff
--- a/frontend/src/lib/server/user-service.test.ts
+++ b/frontend/src/lib/server/user-service.test.ts
@@ -5,9 +5,8 @@ import {
 	resetUserPasswordByAdmin,
 	getSecurityQuestionChallenge,
 	verifySecurityQuestionAndResetPassword,
-	setupSecurityQuestionAndResetPassword
 	setupSecurityQuestionAndResetPassword,
 	type CouchUserDoc
 } from './user-service';
@@ -13,7 +12,6 @@ import { hashSecurityAnswer } from './security-questions';
 type FakeUserDoc = CouchUserDoc & { password?: string };
 
 describe('user-service', () => {
-	let fakeUsersDb: Record<string, Record<string, unknown>>;
 	let fakeUsersDb: Record<string, FakeUserDoc>;
 
 	beforeEach(() => {
@@ -39,7 +37,6 @@ describe('user-service', () => {
 
 			if (method === 'PUT' && cleanPath.startsWith('/_users/org.couchdb.user:')) {
 				const id = cleanPath.slice('/_users/'.length);
-				const docBody = (body ?? {}) as Record<string, unknown>;
 				const docBody = (body ?? {}) as FakeUserDoc;
 				if (fakeUsersDb[id] && !docBody._rev) {
 					return { status: 409, data: { error: 'conflict', reason: 'Document update conflict.' } };
@@ -174,7 +171,6 @@ describe('user-service', () => {
 		expect(updated.password).toBe('PermanentPass123!');
 		expect(updated.must_change_password).toBe(false);
 		expect(updated.security_question).toBeDefined();
-		expect(updated.security_question.question_id).toBe('birth_province');
 		expect(updated.security_question?.question_id).toBe('birth_province');
 	});
 });
```

```diff
--- a/frontend/src/routes/force-setup/+page.svelte
+++ b/frontend/src/routes/force-setup/+page.svelte
@@ -8,8 +8,6 @@
 	import { resolve } from '$app/paths';
 	import { LANDING_ROUTE } from '$lib/guards/auth';
 	import { authStore } from '$lib/stores/auth.svelte';
-	import { SECURITY_QUESTIONS, type SecurityQuestionId } from '$lib/auth/security-questions';
 	import { SECURITY_QUESTIONS } from '$lib/auth/security-questions';
 	import { fetchAuthStatus, submitForceSetup } from '$lib/features/users';
 	import { ShieldCheck, Lock, ShieldQuestion } from '@lucide/svelte';
@@ -19,7 +17,6 @@
 	let mustChangePassword = $state(false);
 	let newPassword = $state('');
 	let confirmPassword = $state('');
-	let questionId = $state<SecurityQuestionId>(SECURITY_QUESTIONS[0].id);
 	let questionId = $state(SECURITY_QUESTIONS[0].id);
 	let answer = $state('');
 	let showPassword = $state(false);
```

---

### 1.2 Race Condition: Worker เขียนทับยอดจองกะใน Buffer (Slot Reservation Wipeout)
- **ไฟล์ที่พบ:** [`worker/src/worker/mongo/job.py`](file:///home/saktanuthpeak/tent/worker/src/worker/mongo/job.py#L73-L116) (`sync_job_shift_slot`)
- **รายละเอียด:** เมื่อมีเหตุการณ์เกี่ยวกับ assignment ตัว worker จะเรียก `sync_job_shift_slot` เพื่อ reconcile ตัวนับโควตาใน MongoDB (`VolunteerJobShiftSlot.confirmed_qty = len(confirmed_ids)`) โดยดึงข้อมูลจาก `PublicJobApplication` (ที่ถูกโปรเจกต์มาจาก CouchDB แล้ว) และ `PublicShiftAssignment` เท่านั้น แต่ **ไม่ได้รวมเอกสารใน `VolunteerApplicationBuffer`**
- **ผลกระทบ:**
  1. อาสาสมัครสมัครผ่านหน้าเว็บ -> FastAPI จองโควตาแบบ atomic `$inc: {"confirmed_qty": 1}` และบันทึก `VolunteerApplicationBuffer` ลง MongoDB
  2. ใบสมัครยังรอ Inbound Worker sync เข้า CouchDB (ช่วงเวลาไม่กี่วินาที)
  3. ในช่วงเวลานี้ หากเจ้าหน้าที่หลังบ้านขยับ assignment ใน CouchDB -> Worker จะรัน `sync_job_shift_slot`
  4. เนื่องจาก `PublicJobApplication` ยังไม่มีใบสมัครใหม่ `sync_job_shift_slot` จึงคำนวณยอดโดยไม่รวมใบสมัครที่เพิ่งเข้ามา แล้วสั่ง `counter.confirmed_qty = len(confirmed_ids)` ซึ่งเป็นการ **ล้างยอดจองที่เพิ่งจองไปทิ้งทันที**
  5. ระบบจะแสดงว่ากะยังว่าง ทำให้มีคนสมัครเข้ามาซ้ำซ้อนเกินโควตา (Overbooking)
- **แนวทางแก้ไข (Diff):**

```diff
--- a/worker/src/worker/mongo/job.py
+++ b/worker/src/worker/mongo/job.py
@@ -90,7 +90,14 @@ async def sync_job_shift_slot(*, job_id: str, shift_id: str) -> None:
     applications = await PublicJobApplication.find(
         {"job_id": job_id, "shift_id": shift_id, "status": "confirmed"}
     ).to_list()
+    pending_buffers = await VolunteerApplicationBuffer.find(
+        {"job_id": job_id, "shift_id": shift_id, "status": "confirmed", "synced_to_couch": False}
+    ).to_list()
     confirmed_ids: set[str] = set()
+    for buf in pending_buffers:
+        confirmed_ids.add(buf.volunteer_id or buf.id)
     dispatched_ids: set[str] = set()
     for assignment in assignments:
```

---

### 1.3 DoS Risk & Data Leakage จาก `_all_docs?include_docs=true` ใน Public Apply Route
- **ไฟล์ที่พบ:** [`frontend/src/routes/api/public/v1/volunteer/apply/+server.ts`](file:///home/saktanuthpeak/tent/frontend/src/routes/api/public/v1/volunteer/apply/+server.ts#L218-L220)
- **รายละเอียด:** 
  - ในฟังก์ชัน `POST` มีการเรียก `adminRaw('/' + targetShelterDb + '/_all_docs?include_docs=true', 'GET')` เพื่อตรวจสอบประวัติใบสมัครเดิมของเบอร์โทรศัพท์
  - คำสั่งนี้ดึงเอกสารทั้งหมดทุกประเภทในฐานข้อมูลศูนย์พักพิง (ทั้งข้อมูลผู้อพยพ, บันทึกการรักษา, การเบิกจ่ายสิ่งของ ฯลฯ) ขึ้นมาบน Node.js Memory ทุกครั้งที่มีคนส่งคำขอสมัคร
  - หากค้นหา `job_id` ไม่พบ โค้ดจะ fallback ไปบันทึกลงฐานข้อมูล `shelter_sh001` โดยอัตโนมัติ (บรรทัด 214–216)
  - เส้นทางนี้เขียนตรงเข้า CouchDB ด้วย Admin context โดยไม่ผ่านการตรวจสอบและตัดยอดโควตาใน MongoDB ของ FastAPI (ขัดแย้งกับ CR-107 ข้อ 5)
- **ผลกระทบ:** เสี่ยงต่อการเกิด Out-of-Memory Crash (DoS Attack) เมื่อฐานข้อมูลศูนย์พักพิงเติบโต และอาจเกิดข้อมูลรั่วไหลใน Process memory
- **แนวทางแก้ไข:** 
  - หากยังคงเส้นทางนี้ไว้ชั่วคราว ต้องเปลี่ยนจากการดึง `_all_docs` มาเป็นการ query ผ่าน Mango query หรือ View เฉพาะเอกสาร `job_application` เท่านั้น
  - หรือแนะนำให้ปิด/redirect การทำงานให้ส่งต่อไปยัง `/api/public/v1/volunteer/jobs/[id]/apply` ซึ่งเป็น BFF pipeline หลักที่ส่งต่อให้ FastAPI จัดการอย่างถูกต้อง

---

## 2. Warnings (ควรแก้ไขเพื่อป้องกันปัญหาเชิงพฤติกรรม)

### 2.1 Short-circuit คืนค่า 0 ผิดพลาดใน `confirmedAssignmentsForShift` (`capacity.ts`)
- **ไฟล์ที่พบ:** [`frontend/src/lib/features/volunteers/domain/capacity.ts`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteers/domain/capacity.ts#L121)
- **ปัญหา:** โค้ดใส่ guard `if (!shift.date || !shift.end_date || !shift.start_time || !shift.end_time) return 0;` ไว้ก่อนการตรวจ assignments ทั้งที่ type กำหนดให้ฟิลด์เหล่านั้นเป็น `Partial` ได้ หาก caller ส่ง shift object ที่มีเฉพาะ `{ id, quota }` แม้ assignments จะมี `shift_id === shift.id` ตรงกันเป๊ะ ฟังก์ชันจะคืนค่า 0 ทันที
- **แนวทางแก้ไข (Diff):** คำนวณ `shiftDutyWindow` แบบ lazy เฉพาะเมื่อต้องใช้ fallback (กรณีที่ assignment ไม่มี `shift_id`)

```diff
--- a/frontend/src/lib/features/volunteers/domain/capacity.ts
+++ b/frontend/src/lib/features/volunteers/domain/capacity.ts
@@ -118,20 +118,17 @@ function confirmedAssignmentsForShift(
 	shift: Pick<JobShift, 'id'> &
 		Partial<Pick<JobShift, 'date' | 'end_date' | 'start_time' | 'end_time'>>,
 	assignments: readonly ShiftAssignment[]
 ): number {
-	if (!shift.date || !shift.end_date || !shift.start_time || !shift.end_time) return 0;
-	const concreteShift = {
-		...shift,
-		date: shift.date,
-		end_date: shift.end_date,
-		start_time: shift.start_time,
-		end_time: shift.end_time
-	};
-	let window: ReturnType<typeof shiftDutyWindow>;
-	try {
-		window = shiftDutyWindow(concreteShift);
-	} catch {
-		return 0;
+	let window: ReturnType<typeof shiftDutyWindow> | null = null;
+	if (shift.date && shift.end_date && shift.start_time && shift.end_time) {
+		try {
+			window = shiftDutyWindow({
+				...shift,
+				date: shift.date,
+				end_date: shift.end_date,
+				start_time: shift.start_time,
+				end_time: shift.end_time
+			});
+		} catch {
+			window = null;
+		}
 	}
 	const volunteerIds = new Set<string>();
 	for (const assignment of assignments) {
@@ -142,3 +139,3 @@ function confirmedAssignmentsForShift(
 		const matches = assignment.shift_id
 			? assignment.shift_id === shift.id
-			: sameDutyWindow(assignment.duty_window, window);
+			: window ? sameDutyWindow(assignment.duty_window, window) : false;
 		if (matches) volunteerIds.add(assignment.volunteer_id);
 	}
```

---

### 2.2 Roster ว่างเปล่าทั้งกะหาก `shiftDutyWindow` ล้มเหลวใน `shiftRoster` (`shift-roster.ts`)
- **ไฟล์ที่พบ:** [`frontend/src/lib/features/volunteers/domain/shift-roster.ts`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteers/domain/shift-roster.ts#L66-L71)
- **ปัญหา:** หาก `shiftDutyWindow(shift)` throw error (เช่น parsing เวลาผิดพลาด) บล็อก `catch` จะคืนค่า `[]` ทันที ทำให้ assignments ที่ผูกด้วย `assignment.shift_id === shift.id` ไว้อย่างถูกต้องถูกทิ้งไปทั้งหมด
- **แนวทางแก้ไข:** ให้คำนวณ `window` เป็น optional/nullable หากคำนวณไม่ได้ ให้ match เฉพาะรายการที่มี `shift_id` ตรงกันแทนที่จะทิ้งข้อมูลทั้งกะ

---

### 2.3 `assertNoDuplicate` ขาดการตรวจสอบแถว Legacy ใน `shift-assignment.remote.ts`
- **ไฟล์ที่พบ:** [`frontend/src/lib/features/volunteers/data/shift-assignment.remote.ts`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteers/data/shift-assignment.remote.ts#L55-L68)
- **ปัญหา:** ฟังก์ชัน `assertNoDuplicate` เช็คเฉพาะ `a.shift_id === input.shift_id` ซึ่งหากในระบบมีเอกสาร assignment รุ่นเก่า (schema_v 3 ที่ยังไม่มี `shift_id`) เงื่อนไขนี้จะไม่ดักจับ ทำให้สามารถ assign อาสาสมัครคนเดิมซ้ำในช่วงเวลาเดียวกันได้
- **แนวทางแก้ไข:** เพิ่มเงื่อนไข fallback เช็คช่วงเวลา `duty_window` กรณีที่ `!a.shift_id`

---

### 2.4 ขาด Error Copy ภาษาไทยสำหรับ Error Codes ใหม่ใน Volunteer Portal
- **ไฟล์ที่พบ:** [`frontend/src/lib/features/volunteer-portal/data/volunteer-api.ts`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteer-portal/data/volunteer-api.ts#L20-L35)
- **ปัญหา:** เมื่อ FastAPI ส่ง error code ใหม่ เช่น `SHIFT_FULL`, `SHIFT_NOT_FOUND`, `SHIFT_ID_REQUIRED`, `SHIFT_DATE_AMBIGUOUS` เนื่องจากไม่มีในตาราง `ERROR_COPY` ผู้ใช้จะเห็นข้อความภาษาอังกฤษดิบๆ ขึ้นบนหน้าจอ
- **แนวทางแก้ไข:** เพิ่ม mapping ใน `ERROR_COPY` เช่น:
  - `SHIFT_FULL: 'กะนี้เต็มแล้ว กรุณาเลือกกะหรือภารกิจอื่น'`
  - `SHIFT_NOT_FOUND: 'ไม่พบกะงานที่เลือก'`
  - `SHIFT_ID_REQUIRED: 'กรุณาเลือกกะที่ต้องการสมัคร'`

---

## 3. Suggestions (ข้อเสนอแนะเพื่อความสมบูรณ์ของโค้ด)

1. **Defensive Validation ใน `_select_concrete_shift` (`use_case.py`):**
   - หาก client ส่ง `shift_id` มาแต่ `not job.shifts` (งานไม่มี sub-shifts) โค้ดปัจจุบันจะ return `None` แล้วกลับไปจองระดับ job เงียบๆ ควรพิจารณาตรวจสอบว่าหากระบุ `shift_id` มาแต่องค์ประกอบกะไม่ตรง ควร raise HTTP 422 `SHIFT_NOT_FOUND`
2. **การ Normalize เบอร์โทรศัพท์ก่อนคำนวณ SHA-256:**
   - ใน `routes/api/public/v1/volunteer/apply/+server.ts` ใช้ `applicant.phone.trim()` คำนวณ hash ตรงๆ ขณะที่ worker/backend มีการตัดอักขระพิเศษออก (`re.sub(r"\D", "", phone)`) ส่งผลให้เบอร์ที่มีขีด (`081-234-5678`) กับไม่มีขีด (`0812345678`) ได้ค่า hash ไม่ตรงกัน
3. **การ Sync `shiftDate` ใน `quick-apply-modal.svelte`:**
   - เมื่อผู้ใช้เลือก `shiftId` ควรนำค่า `date` ของ shift นั้นมากำหนดลงใน `shiftDate` ด้วย เพื่อให้ backward compatibility ครบถ้วนทั้งสองฟิลด์

---

## 4. Nitpicks (จุดเล็กน้อยด้านเอกสารและสไตล์)

1. **ความสอดคล้องของเอกสาร Migration ใน `CR-107` vs `schema.md`:**
   - ใน CR-107 ระบุว่าจะ bump monotonic version: `job v3→v4` แต่ในทางปฏิบัติ `job` ยังคงใช้ `schema_v: 3` เพื่อความเข้ากันได้ และ normalize key `id` เป็น `shift_id` ใน worker ควรรีวิวอัปเดตข้อความในเอกสาร CR-107 ให้ตรงกับการตัดสินใจจริง

---

## 5. สรุปความพร้อมในการ Merge (Merge Readiness)

- **สถานะ:** ❌ **ยังไม่พร้อม merge**
- **เหตุผล:** ยังมี Syntax Errors ที่ทำให้ build/test suite ไม่ผ่าน, มีปัญหา Race Condition ของ Worker ในการนับโควตา และมีช่องโหว่ความปลอดภัย/ประสิทธิภาพใน Public Endpoint
- **สิ่งที่ต้องทำก่อน merge:**
  1. แก้ไข Syntax errors ใน `user-service.test.ts` และ `force-setup/+page.svelte` ให้ผ่านทั้ง `pnpm check` และ `vitest run`
  2. แก้ไข `sync_job_shift_slot` ใน `worker/mongo/job.py` ให้รวมยอดจองจาก `VolunteerApplicationBuffer`
  3. ปรับปรุง edge case fallback ใน `capacity.ts`, `shift-roster.ts` และ `shift-assignment.remote.ts`
  4. เพิ่ม error copy ภาษาไทยสำหรับ error code กะเต็มใน `volunteer-api.ts`
