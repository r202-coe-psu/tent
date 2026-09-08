# รายงานการตรวจสอบโค้ด (PR Code Review) — Volunteer Portal & Shift Application
# รายงานการตรวจสอบโค้ดรอบที่ 2 (PR Code Re-Review) — Volunteer Portal & Shift Application

**วันที่:** 7 กันยายน 2026  
**เป้าหมาย:** ตรวจสอบการเปลี่ยนแปลงล่าสุด (`f3ee8c49`) และของเมื่อวาน (6 ก.ย. 2026: `026d96ed`, `13944e2f`, `af6ee1cd`)  
**หัวข้อหลัก:** ความปลอดภัย (Security), การจัดการ Edge Cases, และข้อปฏิบัติที่ดี (Best Practices)  
**Verdict:** **Request changes** (❌ ยังไม่พร้อม merge — พบประเด็น Blocker 2 จุด)
**รอบการตรวจสอบ:** ครั้งที่ 2 (Re-review หลัง commit `a41623aa`)  
**Commit ล่าสุด:** `a41623aa` (*refactor: fix pr code review and clean up unused ui*)  
**Verdict:** **Approve** (✅ **พร้อม merge**)  
**ผลการทดสอบ:** 
- Vitest: ผ่านทั้งหมด 32 test files (524 tests)
- Svelte Check: 0 errors, 0 warnings
- ESLint: ผ่าน 0 errors

---

## สรุปภาพรวมการเปลี่ยนแปลง (Overview of Changes)
## ผลการตรวจสอบข้อบกพร่องเดิม (Verification of Previous Findings)

1. **ระบบคัดกรองและสมัครกะงาน (`QuickApplyModal.svelte`, `public-application.ts`, `apply/+server.ts`):**
   - รองรับการกรองทักษะจาก Master Data (CR-099)
   - รองรับสองภาษา (Bilingual i18n)
   - เพิ่ม fallback การเลือกกะและรอบเวลา
2. **ระบบบัตรประจำตัวดิจิทัล (`digital-pass.svelte`, `ticket.i18n.ts`, `ticket/[token]/+server.ts`):**
   - Redesign หน้าบัตรประจำตัวจิตอาสา (Digital Pass UI)
   - เพิ่ม Modal ยืนยันการขอยกเลิกตั๋ว
   - ปรับการจัดรูปแบบเวลาเป็น พ.ศ. (Thai BE) และแสดงผล Timezone ให้สอดคล้อง
3. **ระบบพอร์ทัลจิตอาสา (`volunteer-access-portal.svelte`, `volunteer-portal-shell.svelte`, `/resolve` endpoint):**
   - เชื่อมต่อการตรวจสอบสิทธิ์และสร้าง session ด้วย `portal_id`
   - แยกระหว่างการดูตารางงาน (Schedule) และการสมัครงานใหม่ (Job Board)
| หัวข้อเดิม | ระดับความรุนแรงเดิม | สถานะในรอบนี้ | รายละเอียดการแก้ไข |
|---|---|---|---|
| **1.1 Fallback กะเวลาเงียบๆ ใน `selectedShift()`** | 🔴 Blocker | ✅ แก้ไขแล้ว | คืนค่าการตรวจสอบที่เข้มงวด หากระบุ `shift_id` หรือ `shift_date` แล้วไม่ตรงกับกะในระบบ จะโยน `SHIFT_NOT_FOUND` / `SHIFT_DATE_AMBIGUOUS` / `SHIFT_ID_REQUIRED` ทันที และมี regression unit tests 5 ข้อใน `public-application.test.ts` |
| **1.2 ค้นหาตั๋วด้วย `_id` ใน Public Endpoint** | 🔴 Blocker | ✅ แก้ไขแล้ว | ลบเงื่อนไข `{ _id: token }` ออกทั้งหมด และค้นหาเฉพาะ `tracking_token` และ `tracking_token_hash` เท่านั้น มี regression test ยืนยันว่าการส่ง CouchDB `_id` จะได้ 404 เสมอ |
| **2.1 จิตอาสาที่เข้าด้วย QR ไม่สามารถสมัครงานได้** | 🟡 Warning | ✅ แก้ไขแล้ว | เพิ่มกล่องแจ้งเตือนสีเหลืองและช่องให้ระบุเบอร์โทรศัพท์เดิมสำหรับผู้ที่เข้าสู่ระบบผ่าน QR token เพื่อใช้ผูกใบสมัครเข้ากับโปรไฟล์เดิม |
| **2.2 ความเสี่ยง Reactive Loop ใน `$effect`** | 🟡 Warning | ✅ แก้ไขแล้ว | เปลี่ยนการ restore session จาก `sessionStorage` ไปไว้ใน `onMount()` แทน ทำให้รันเพียงครั้งเดียวตอน mount ไม่เกิด dependency cycle |
| **2.3 Timezone เพี้ยนจากการ append `Z`** | 🟡 Warning | ✅ แก้ไขแล้ว | เขียน `parseBackendTimestamp()` ใหม่ โดยเคารพ offset เดิม และ parse naive timestamp ในฐานะ UTC โดยตรงผ่าน `Date.UTC()` พร้อม unit tests ครอบคลุม |
| **3.1 ใช้ `new SvelteMap()` ในตัวแปรชั่วคราว** | 🟢 Suggestion | ✅ แก้ไขแล้ว | เปลี่ยนกลับมาใช้ standard `new Map()` ใน `$derived.by` ของแถวตารางและ Card ทั้งหมด |
| **3.2 Redirect 308 ซ้ำซ้อนหลังสมัครสำเร็จ** | 🟢 Suggestion | ✅ แก้ไขแล้ว | เปลี่ยนเส้นทางไปที่ canonical route `/volunteer/ticket/${encodeURIComponent(trackingToken)}` โดยตรง |
| **4.1 Guard ป้องกัน clipboard crash บน HTTP** | ⚪ Nitpick | ✅ แก้ไขแล้ว | เพิ่มการตรวจสอบ `navigator.clipboard?.writeText` และ handle error toast เรียบร้อย |

---

## 1. ประเด็นระดับวิกฤต (Blockers — ต้องแก้ไขก่อน Merge)
## สรุปผลการรีวิว (Review Summary)

### 1.1 [Edge Case & Silent Misallocation] การ Fallback กะเวลาเงียบๆ ใน `selectedShift()` ทำให้ผู้สมัครถูกลงทะเบียนในกะ/วันที่ไม่ได้เลือก
### Blockers
None. (แก้ไขครบถ้วนแล้วทั้ง 2 จุด พร้อม regression test ครอบคลุม)

- **ไฟล์:** [`public-application.ts`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteers/server/public-application.ts#L124-L153)
- **ปัญหา:**  
  ในฟังก์ชัน `selectedShift()` หากผู้ใช้ส่ง `input.shift_id` หรือ `input.shift_date` ที่ไม่ตรงกับกะใดๆ ในระบบ โค้ดเดิมเคย throw `PublicApplicationError('SHIFT_NOT_FOUND', 422)` แต่ใน change ถูกแก้ให้ fallback เงียบๆ ดังนี้:
  ```typescript
  if (shifts.length > 0) {
      return shifts[0];
  }
  ```
  รวมถึงใน `reserveSlot()` และ `releaseSlot()` มี fallback `?? next.shifts?.[0]`
- **ผลกระทบ:**  
  หากผู้สมัครเลือกกะ **"วันศุกร์รอบบ่าย"** แต่ส่ง `shift_id` ผิด หรือกะดังกล่าวถูกปิดรับไปก่อนหน้า ระบบจะ **แอบจอง `shifts[0]` (เช่น วันจันทร์รอบเช้า) ให้ทันที** โดยไม่มี error แจ้งเตือน ผู้สมัครจะได้ตั๋วและกะงานผิดวัน/ผิดเวลาโดยไม่รู้ตัว นอกจากนี้ error code `SHIFT_NOT_FOUND`, `SHIFT_ID_REQUIRED`, `SHIFT_DATE_AMBIGUOUS` ที่เตรียมไว้ใน `+server.ts` จะกลายเป็น dead code ทันที
- **แนวทางแก้ไข:**
  ```diff
  --- a/frontend/src/lib/features/volunteers/server/public-application.ts
  +++ b/frontend/src/lib/features/volunteers/server/public-application.ts
  @@ -124,7 +124,8 @@ function selectedShift(job: CouchJob, input: DirectApplicationInput): CouchJobSh
   	if (shifts.length === 0) return null;
   	if (input.shift_id) {
   		const found = shifts.find((shift) => (shift.shift_id || shift.id) === input.shift_id);
  -		if (found) return found;
  +		if (!found) throw new PublicApplicationError('SHIFT_NOT_FOUND', 422);
  +		return found;
   	}
   	if (input.shift_date) {
   		const candidates = shifts.filter((shift) => shift.date === input.shift_date);
  @@ -139,13 +140,11 @@ function selectedShift(job: CouchJob, input: DirectApplicationInput): CouchJobSh
   				if (timeMatch) return timeMatch;
   			}
  -			return candidates[0];
  +			throw new PublicApplicationError('SHIFT_DATE_AMBIGUOUS', 422);
   		}
  +		throw new PublicApplicationError('SHIFT_NOT_FOUND', 422);
   	}
   	if (shifts.length === 1) {
   		return shifts[0];
   	}
  -	if (shifts.length > 0) {
  -		return shifts[0];
  -	}
  -	return null;
  +	throw new PublicApplicationError('SHIFT_ID_REQUIRED', 422);
   }
  ```
### Warnings
None. (แก้ไขครบถ้วนแล้วทุกจุด)

---
### Suggestions
None. (ปรับปรุงประสิทธิภาพและ Clean Code เรียบร้อยแล้ว)

### 1.2 [Security & Data Privacy] การเปิดค้นหาด้วย `_id` บน Public Digital Pass Endpoint ทำให้ Tracking Token และ PII เสี่ยงรั่วไหล
### Nitpicks
None.

- **ไฟล์:** [`+server.ts (ticket)`](file:///home/saktanuthpeak/tent/frontend/src/routes/api/public/v1/volunteer/ticket/%5Btoken%5D/+server.ts#L139-L167)
- **ปัญหา:**  
  Endpoint `/api/public/v1/volunteer/ticket/[token]` เป็น Public API ที่ไม่มีการยืนยันตัวตน มาตรการความปลอดภัยเดิมกำหนดให้อนุญาตเฉพาะ **unguessable tracking token (128-bit random token หรือ HMAC token)** เท่านั้น แต่ในคอมมิต `026d96ed` มีการเพิ่ม selector ดังนี้:
  ```typescript
  const appSelectors = [
      { tracking_token: token },
      { _id: token },
      ...(token.startsWith('app_') ? [{ _id: `job_application:${token}` }] : [])
  ];
  ...
  const volSelectors = [
      { tracking_token: token },
      { _id: token },
      ...(token.startsWith('vol_') ? [{ _id: `volunteer:${token}` }] : [])
  ];
  ```
- **ผลกระทบ:**  
  หากบุคคลภายนอกทราบหรือเดา CouchDB document ID (`job_application:...`, `volunteer:...` หรือ ULID จากระบบอื่น) จะสามารถเรียก endpoint นี้เพื่อดูข้อมูลบัตรจิตอาสา (ชื่อ, เบอร์โทรที่ mask, ทักษะ, ศูนย์พักพิง) และที่สำคัญคือ **ได้รับ secret `tracking_token` ตัวจริงกลับไปใน response payload** (`token: tokenOut`) ซึ่งทำให้สามารถนำ token นั้นไปยกเลิกตั๋วหรือเข้าสู่ Volunteer Portal สวมสิทธิ์เป็นจิตอาสาคนนั้นได้ทันที
- **แนวทางแก้ไข:**  
  ค้นหาผ่าน `tracking_token` เท่านั้น และลบเงื่อนไข `{ _id: token }` ออกจาก Public Fallback:
  ```diff
  --- a/frontend/src/routes/api/public/v1/volunteer/ticket/[token]/+server.ts
  +++ b/frontend/src/routes/api/public/v1/volunteer/ticket/[token]/+server.ts
  @@ -139,9 +139,7 @@ export const GET: RequestHandler = async ({ params, fetch, getClientAddress }) =
   				let volunteer: VolunteerDoc | null = null;
   
   				const appSelectors = [
  -					{ tracking_token: token },
  -					{ _id: token },
  -					...(token.startsWith('app_') ? [{ _id: `job_application:${token}` }] : [])
  +					{ tracking_token: token }
   				];
   
   				const findRes = await adminRaw(`/${dbName}/_find`, 'POST', {
  @@ -156,9 +154,7 @@ export const GET: RequestHandler = async ({ params, fetch, getClientAddress }) =
   					app = findData.docs[0];
   				} else {
   					const volSelectors = [
  -						{ tracking_token: token },
  -						{ _id: token },
  -						...(token.startsWith('vol_') ? [{ _id: `volunteer:${token}` }] : [])
  +						{ tracking_token: token }
   					];
   
   					const volFindRes = await adminRaw(`/${dbName}/_find`, 'POST', {
  ```

---

## 2. ประเด็นระดับควรปรับปรุง (Warnings)
## Merge readiness (summary)

### 2.1 [Edge Case & UX] จิตอาสาที่เข้าสู่ระบบ Portal ผ่าน QR Token ไม่สามารถสมัครงานใหม่จากภายใน Portal ได้

- **ไฟล์:** [`QuickApplyModal.svelte`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteers/components/QuickApplyModal.svelte#L230-L233)
- **ปัญหา:**  
  ใน `QuickApplyModal`:
  ```typescript
  if (isPortalApplicant && (!applicantCredential || !('phone' in applicantCredential))) {
      errorMessage = 'กรุณาเข้าสู่ระบบด้วยเบอร์โทรศัพท์ก่อนสมัครภารกิจจาก portal';
      return;
  }
  ```
  เมื่อจิตอาสาเข้า Portal ผ่านการสแกน QR Code บนบัตรดิจิทัล (`token`) ตัว credential จะไม่มีฟิลด์ `phone` (เนื่องจาก `phone_masked` ใน profile ถูก mask ไว้เพื่อความปลอดภัย) ทำให้ผู้ใช้กดสมัครงานจากภายใน portal ไม่ได้ และจะเจอ error หลังจากกรอกข้อมูลเสร็จแล้ว
- **คำแนะนำ:**  
  ควรปรับปรุง API หรือ BFF ให้รองรับการ apply โดยส่ง `token` เพื่อให้เซิร์ฟเวอร์ resolve ข้อมูลเดิมอัตโนมัติ หรืออย่างน้อยควรแสดง Warning Banner แจ้งเตือนผู้ใช้บนหน้าจอภารกิจตั้งแต่ก่อนที่ผู้ใช้จะกดเปิดฟอร์มสมัคร

### 2.2 [Svelte 5 Runes] ความเสี่ยง Reactive Dependency Cycle ใน `$effect` ของ `volunteer-access-portal.svelte`

- **ไฟล์:** [`volunteer-access-portal.svelte`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteer-portal/ui/volunteer-access-portal.svelte#L165-L211)
- **ปัญหา:**  
  ใน `$effect(() => { if (session) ... session = parsed.data; ... })` มีการอ่านตัวแปร `$state` ของ `session` และทำการ assign ค่ากลับไปยัง `session` ภายในบล็อกเดียวกัน พร้อมคำสั่ง `goto(...)`
- **คำแนะนำ:**  
  การ restore session จาก `sessionStorage` เป็น one-time setup ควรกระทำภายใน `onMount` หรือใช้ `untrack(() => session)` เพื่อไม่ให้เกิด cascading effects หรือ re-trigger effect ซ้ำซ้อน

### 2.3 [Timezone Edge Case] การเติม `Z` อัตโนมัติใน Date Parser เสี่ยงทำให้เวลาคลาดเคลื่อน +7 ชั่วโมง

- **ไฟล์:** [`ticket.i18n.ts`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteer-portal/i18n/ticket.i18n.ts#L182-L184)
- **ปัญหา:**  
  `if (!normalized.endsWith('Z')) normalized = `${normalized}Z`;` หาก timestamp ในฐานข้อมูลเป็น naive datetime ที่เป็นเวลาท้องถิ่นไทยอยู่แล้ว การเติม `Z` เข้าไปจะทำให้ JavaScript ตีความว่าเป็นเวลา UTC แล้วนำไปแปลงตาม timezone Bangkok ซ้ำ ส่งผลให้เวลาถูกบวกเพิ่มไปอีก 7 ชั่วโมง
- **คำแนะนำ:**  
  ตรวจสอบให้มั่นใจว่า backend จัดรูปแบบเวลาเป็น UTC ISO string ที่ลงท้ายด้วย `Z` เสมอ และหลีกเลี่ยงการ append `Z` สุ่มสี่สุ่มห้าหาก input อาจเป็น string เวลาท้องถิ่น

---

## 3. ข้อเสนอแนะเชิงประสิทธิภาพและโค้ดที่ดี (Suggestions)

### 3.1 [Performance & Best Practice] หลีกเลี่ยงการสร้าง `new SvelteMap()` เป็นตัวแปรชั่วคราวใน `$derived.by`

- **ไฟล์:** 
  - [`assign-roster-row.svelte`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteers/ui/assign-roster-row.svelte)
  - [`roster-row.svelte`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteers/ui/roster-row.svelte)
  - [`volunteer-card.svelte`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteers/ui/volunteer-card.svelte)
  - [`volunteer-result-card.svelte`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteers/ui/volunteer-result-card.svelte)
- **ปัญหา:**  
  ในคอมมิต `af6ee1cd` มีการสร้าง `new SvelteMap()` ภายใน `$derived.by` เพื่อทำ deduplication ทักษะ ซึ่ง `SvelteMap` ออกแบบมาสำหรับ reactive tracking ในตัวแปร state กรณีที่เป็น local variable ที่แปลงเป็น Array แล้วทิ้งทันที ควรใช้ standard JavaScript `new Map()` หรือ `Set()` ธรรมดาเพื่อลด overhead การ wrap reactivity:
  ```diff
  - const map = new SvelteMap<string, SkillOption>();
  + const map = new Map<string, SkillOption>();
  ```

### 3.2 [Navigation Optimization] ปรับลด Redirect 308 ซ้ำซ้อนหลังสมัครงานสำเร็จ

- **ไฟล์:** [`QuickApplyModal.svelte`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteers/components/QuickApplyModal.svelte#L345)
- **ปัญหา:**  
  หลังสมัครสำเร็จ มีการสั่ง `goto(`/volunteers/ticket/${trackingToken}`)` (พหูพจน์) ซึ่งจะถูก SvelteKit ทำ 308 redirect ไปยัง `/volunteer/ticket/...` (เอกพจน์)
- **คำแนะนำ:**  
  นำทางตรงไปยัง canonical route:
  ```diff
  - await goto(`/volunteers/ticket/${trackingToken}`);
  + await goto(`/volunteer/ticket/${encodeURIComponent(trackingToken)}`);
  ```

---

## 4. ประเด็นเล็กน้อย (Nitpicks)

### 4.1 [Clipboard Safety] ป้องกัน Uncaught TypeError เมื่อรันใน Non-secure Contexts (HTTP)

- **ไฟล์:** [`digital-pass.svelte`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteer-portal/ui/digital-pass.svelte#L136)
- **คำแนะนำ:**  
  หากรันหรือทดสอบบน LAN ผ่าน HTTP ตัว `navigator.clipboard` จะเป็น `undefined` ควรใช้ optional chaining:
  ```typescript
  if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t.toastCopySuccess);
  } else {
      toast.error(t.toastCopyError);
  }
  ```

---

## สรุปความพร้อมในการ Merge (Merge Readiness)

- **สถานะ:** ❌ **ยังไม่พร้อม merge**
- **เหตุผล:** พบปัญหา Blocker 2 จุด ได้แก่ บั๊กการ fallback เลือกกะเวลาเงียบๆ ซึ่งอาจทำให้ผู้สมัครถูกลงทะเบียนในกะเวลาที่ไม่ได้เลือก และช่องโหว่การค้นหาตั๋วด้วย document ID บน public endpoint ที่ทำให้ tracking token และข้อมูลส่วนตัวรั่วไหลได้
- **สิ่งที่ต้องทำก่อน merge:**
  1. แก้ไข `selectedShift()` ใน [`public-application.ts`](file:///home/saktanuthpeak/tent/frontend/src/lib/features/volunteers/server/public-application.ts) ให้โยน Error เมื่อไม่พบกะหรือวันที่ระบุ แทนการ fallback เป็น `shifts[0]`
  2. ลบเงื่อนไข `{ _id: token }` ออกจาก [`ticket/[token]/+server.ts`](file:///home/saktanuthpeak/tent/frontend/src/routes/api/public/v1/volunteer/ticket/%5Btoken%5D/+server.ts) เพื่อรักษา security invariant ของ tracking token

- **Status:** ✅ พร้อม merge
- **สรุป:** โค้ดได้รับการปรับปรุงแก้ไขจุดบกพร่องด้านความปลอดภัย (Security) และการจัดการ Edge Cases ครบถ้วนทุกจุด การทดสอบ Vitest (524 tests) และ Svelte Check (0 errors, 0 warnings) ผ่านทั้งหมด พร้อมสำหรับการ merge เข้า branch หลัก
- **ก่อน merge:** —
