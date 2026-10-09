# Handoff: e2e zero-leak

> วันที่: 2026-10-09 · สถานะ: **เปลี่ยนแนวทาง รอเขียนแผนใหม่ เริ่มใหม่จาก `develop`**
> งานรอบก่อนอยู่บน branch ในเครื่องเก่าที่ไม่ได้ push และถูกทิ้งไปแล้ว เอกสารนี้จึงเก็บทุกอย่างที่ต้องใช้ไว้ในตัวเอง (โค้ดต้นแบบอยู่ในภาคผนวก)

## สรุปสั้น

- **เป้าหมาย:** ข้อมูลที่ e2e สร้างต้องไม่ค้างในระบบ ยกเว้นข้อมูลตั้งต้นแบบอ่านอย่างเดียว 6 รายการใน `.env` ของ staging และอยากให้ทุก deploy รันครบทุก case รวมทั้ง case ที่เขียนข้อมูลด้วย
- **รอบก่อนทำอะไรไป:** สร้างกลไกฝั่ง test (ตัวกันการเขียน, markers, ledger, `expectNoLeak`, janitor) ผ่าน lint และ type-check แต่ยังไม่เคยรัน e2e จริง และไม่ได้ push จึงไม่มีโค้ดเหลือใน repo
- **ตัดสินใจล่าสุด:** เลิกใช้แนวทางนั้น เพราะการลบกระจายอยู่หลายที่และซับซ้อนเกินไป เปลี่ยนไปใช้แนวใหม่ คือ cleanup API ฝั่ง server ตัวเดียว และย้าย e2e ออกจาก `frontend/` ไปไว้ที่ root
- **ขั้นต่อไป:** เข้า plan mode เขียนแผนชุดใหม่ (PR 1–4 ด้านล่าง) แล้ว grill เรื่องที่ต้องตัดสินใจกับเจ้าของก่อนลงมือ

## ที่มา

1. Staging e2e fail 9 เคส เพราะ copy ของหน้า public เปลี่ยน (`8c4c278a`, `7e3589ab`) แก้แล้วใน PR #425 (develop → staging) ซึ่งเอา pixel screenshot และ ARIA snapshot ที่เทียบข้อความทุกตัวออก (ดู memory `e2e-structural-not-pixel`)
2. เจ้าของถามว่า e2e ครอบคลุมแค่ไหน และข้อมูลจาก e2e หลุดเข้า staging หรือไม่ จากนั้นจึงขอให้ทำให้มั่นใจว่ามีการลบจริง

## สิ่งที่พบ (ยังจริงอยู่ ใช้ต่อได้)

**สิ่งที่ staging รันอยู่ตอนนี้:** `playwright.staging.config.ts` เลือก test ที่ติด `@release|@smoke` ได้ 99 ตัว ทั้งหมดอ่านอย่างเดียว test ที่เขียนข้อมูลทุกตัว (J3–J6, pre-register W1–W6 + Z) ถูก skip ด้วย `test.skip(IS_REMOTE)` และ 70% ของ test เป็นหน้า pre-register

**ทางที่ข้อมูลจะค้างได้:**
1. **ไม่มีตัวหยุดการเขียนกลาง:** ต้องพึ่งให้แต่ละ test ใส่ `test.skip(IS_REMOTE)` เอง ส่วน helper ฝั่ง Node (`couchReq`, `adminFastapi`) จะเขียนไปที่ใดก็ตามที่ `COUCHDB_ADMIN_URL` ชี้
2. **ledger เปราะบาง:** ledger เดิมเก็บใน `frontend/node_modules/.cache/` ซึ่ง `cleanWs` ของ Jenkins ลบทิ้ง และถ้า build ถูก abort จะไม่ไปถึง `afterAll`
3. **test Z ตรวจแคบ:** ไม่ได้ตรวจ `_users`, ข้อมูลคนฝั่ง public หรือแถวใน `public_shelters`
4. **worker ลบข้อมูลตามไม่ครบ (stable core):** เมื่อลบ registry doc ของศูนย์ ใน `worker/src/worker/couch/processor.py:79-87`
   - `apply_shelter_deactivate` แค่ตั้ง `is_active=False` ใน `public_shelters` แล้ว retention (`retention/job.py:89-121`) จะลบแถวที่ `status=closed` จริงทุก ~300 วินาที
   - ลบเฉพาะ `public_persons` กับ `public_needs`
   - เมื่อ `DELETE shelter_<code>` worker ไม่รู้เลย เพราะ follow เฉพาะฐานข้อมูลของศูนย์ที่ยังเปิด ไม่ได้ใช้ `_db_updates`
   - **collection ที่ค้างถาวร:** `shelter_occupants`, `shelter_stocks`, `donation_need_counters`, `public_donations`, `public_jobs`, `public_volunteers` (และ collection อื่นของจิตอาสา), `_sync_checkpoints`
   - **เอกสารขัดกัน 3 ที่:** `docs/data/couchdb-mongodb-sync.md:119` บอกให้ลบศูนย์ที่ปิด, ADR-0002 บอกให้เก็บแถวที่ปิดไว้, และ retention ลบแถวที่ปิดจริง
5. **janitor เดิม** (`scripts/staging-e2e-janitor.mjs`) ดูแค่ศูนย์ `E2E*` ใน registry ค่าเริ่มต้นเป็น dry-run และไม่มี cron
6. **คิวที่ยังไม่ได้เลือกศูนย์ (CR-113):** อยู่ใน Mongo `unassigned_registrations` มี `DELETE /staff/v1/unassigned-registrations/{id}` (เฉพาะ system admin, ลบจริง, คืน 204 และ 404 ถ้าไม่มี) list คืน `{items, total, open_member_count, limit}` และ `q` จับ identity, id และชื่อสมาชิก

**เครื่องหมายข้อมูลทดสอบ:**
- `RUN_ID = Date.now().toString(36)` (ตัวพิมพ์เล็ก 8 ตัว)
- ศูนย์ชื่อ `E2E <label> <RUN_ID>`
- นามสกุล `<label><RUN_ID>` เช่น `ทดสอบ<RUN_ID>`
- เลขบัตรประชาชนขึ้นต้นด้วย `0`
- ข้อมูลตั้งต้นที่ห้ามแตะ: `E2E Search Fixture`, `E2Eกรอง` (ไม่มีรหัสต่อท้าย), `ทดสอบE2E*`, `0800000001`, `0123456789012`, `ZZ0000001`

## แนวทางใหม่ (ตกลงหลักการแล้ว ยังไม่มีแผนละเอียด)

1. **ย้าย e2e ไป root:** ย้าย `frontend/e2e` ไปที่ `e2e/` เป็นสมาชิกของ pnpm workspace มี `package.json`, tsconfig และ ESLint ของตัวเอง
   - การผูกกับ frontend มีน้อย: import โค้ดแอปแค่ 4 จุด (`ulid` 3 ที่, `subQty` 1 ที่) และ `webServer` ใน `playwright.config.ts` ที่สั่ง `pnpm preview` กับ `mock-api.js`
2. **รายการ case:** ใช้ชุด test ที่ติด tag `@release` เป็นรายการ case ที่ต้องผ่านทุกครั้งที่ deploy แต่ละ case สร้างข้อมูลที่มีเครื่องหมายเป็นลำดับ
3. **cleanup API ฝั่ง server:** เช่น `POST /api/e2e/cleanup { runId }` ลบทุกอย่างที่มีเครื่องหมายของ run นั้น แล้วคืนรายงานว่าลบอะไรไปและเหลืออะไรค้าง เรียกครั้งเดียวตอนจบ ถ้ามีของค้างให้ fail กติกาความปลอดภัยที่ต้องมี:
   - เปิดเฉพาะเมื่อ `E2E_CLEANUP_ENABLED=true` บน staging ส่วน prod ต้องคืน 404
   - ต้องใช้ secret แยก
   - ลบเฉพาะ record ที่มีเครื่องหมายตรงกับ runId ที่ส่งมา
   - บันทึก audit ทุกครั้ง
4. **janitor:** เปลี่ยนเป็นตัวเรียก API เดียวกันสำหรับ run เก่าที่ค้าง
5. **prod:** ยังอ่านอย่างเดียว และยังใช้ตัวกันการเขียน

**ลำดับ PR ที่เสนอ:**

| PR | งาน | หมายเหตุ |
| --- | --- | --- |
| 1 | ย้าย `frontend/e2e` → `e2e/` + package/config + แก้ path ใน CI, lefthook และเอกสาร | ย้ายอย่างเดียว ไม่เปลี่ยน logic ควรแจ้งทีมเพราะ branch อื่นจะ conflict |
| 2 | ตัวกันการเขียน + markers ที่ `e2e/` (ใช้โค้ดในภาคผนวกเป็นต้นแบบ) | |
| 3 | cleanup API + test Z/janitor เรียก API + เปิดให้ staging รัน case ที่เขียนข้อมูล | เป็น spec/stable core change ต้องถามวิธีบันทึก CR |
| 4 | Phase 6 worker ลบ projection ตาม (OD-9) + decision sync note (OD-10) | ทำพร้อม PR 1 ได้ |

**คำถามที่ต้องตอบก่อนเขียนแผนใหม่:**
- Mongo projection จะให้รอ worker ลบตาม (PR 4) หรือให้ cleanup API ลบเองผ่าน endpoint ใหม่ฝั่ง FastAPI ซึ่งเป็นการข้าม worker
- จะให้ staging รัน case ที่เขียนข้อมูลทุก deploy หรือเฉพาะ nightly
- cleanup API จะอยู่ที่ SvelteKit BFF หรือ FastAPI และจะใช้ auth แบบไหน
- จะบันทึกการเปลี่ยนแปลง (นโยบายให้ staging ถูกเขียน + API ใหม่) อย่างไร ตาม CLAUDE.md ห้ามเดา ต้องถามเจ้าของ

## ผลการ grill รอบก่อน

| # | ตัดสินใจ | ยังใช้กับแนวใหม่? |
| --- | --- | --- |
| OD-1 | allowlist แบบ (b): `_session`, reCAPTCHA และ POST ที่จริงๆ แค่อ่าน (รายการอยู่ในภาคผนวก A) | ใช้ |
| OD-2 | ตัวกันฝั่ง Node มีทางยกเว้น `{ janitor: true }` | ทบทวน: ถ้าใช้ cleanup API อาจไม่จำเป็น |
| OD-3 | ชื่อ user `e2e_<role>_<RUN_ID>` และ janitor จับชื่อเดิม `onsite_*` ไปอีก 1 release | ใช้ |
| OD-4 | ledger ใน `os.tmpdir()` | **ไม่ใช้แล้ว** |
| OD-5 | ในเครื่องอ่าน Mongo ตรง (`E2E_MONGO_URL`) บน staging ใช้ API | ทบทวน: API อาจตรวจให้แทน |
| OD-6 | janitor ไม่ลบใน Mongo | ทบทวนพร้อมคำถามเรื่อง Mongo ข้างบน |
| OD-7 | cron ทุก 30 นาที ไม่แจ้งเตือน ลบอัตโนมัติ | ใช้ได้ (เปลี่ยนให้ cron เรียก API) |
| OD-8/14 | ท้าย e2e-staging trigger job janitor แบบ dry-run (`propagate: false`) | ทบทวน: cleanup API อาจทำหน้าที่นี้แทน |
| OD-9 | ลบ registry → ลบทุก projection ของศูนย์; ปิดศูนย์ → เก็บแถวตาม ADR-0002 (retention เลิกลบแถวที่ปิด) | ใช้ (PR 4) |
| OD-10 | ใช้ decision sync note ใน `couchdb-mongodb-sync.md` | ใช้ (PR 4) |
| OD-11 | ตัวกันเป็น `off` ในเครื่อง | ใช้ |
| OD-12 | แบ่ง 2 PR | **แทนด้วยลำดับ PR 1–4 ข้างบน** |
| OD-13 | janitor ไม่ตรวจคิว | ทบทวน: cleanup API ฝั่ง server เข้าถึงคิวได้ |
| OD-15 | health check ชุดอื่นเป็น `warn` ไปก่อน | ใช้ |
| OD-16 | `guardedContext(browser)` + ESLint rule ห้าม `browser.newContext` | ใช้ |
| OD-17 | `couchLogin` ใช้บน remote ได้ | ใช้ |
| OD-18 | ไม่มี CI job สำหรับ self-test ของตัวกัน | ใช้ |
| OD-J2 | ของที่บอกอายุไม่ได้นับเป็นข้อมูลค้างใน dry-run แต่ cron ไม่ลบ | ทบทวน |
| OD-B2-2 | ตรวจฝั่ง public ครั้งเดียวตอนจบ | ใช้ในรูปแบบ "เรียก API ครั้งเดียว" |

## สิ่งที่ควรยกมาใช้จากรอบก่อน

ใช้โค้ดในภาคผนวกเป็นต้นแบบ แล้วเขียนใหม่ในที่ใหม่ (`e2e/` ที่ root):
- **ตัวกันการเขียน** (ภาคผนวก A): fixture กลาง `test`/`expect` ทุกไฟล์ test ต้อง import จากที่นี่ ไม่ใช่จาก `@playwright/test` ลงทะเบียน route ระดับ context ก่อน mock ของ test เพื่อให้ mock ที่ลงทะเบียนทีหลังได้ทำงานก่อน
  - ทำ `guardedContext(browser)` ให้ context ที่ test สร้างเองถูกครอบด้วย (OD-16) จุดที่สร้าง context เองอยู่ใน `registration-evacuee`, `public-pre-register-flow` และ `helpers/onsite.ts`
  - helper ฝั่ง Node ที่ยิงคำขอเขียน (`couchReq` ใน `helpers/couch.ts`, `adminFastapi` ใน `helpers/public-cleanup.ts`, `putDocAsSession` ใน `helpers/households.ts`) ต้องเรียก `assertWritable` (ภาคผนวก B)
  - self-test ที่ไม่ต้องใช้แอป: เปิดหน้า `http://guard.test/` ด้วย `page.route` แล้วตรวจ 4 กรณี คือ POST ที่ไม่ mock ต้องถูกบล็อก, POST ที่ mock แล้วต้องไม่ถูกนับ, POST ใน allowlist ต้องไม่ถูกนับ และ GET ผ่านได้ ใช้ config แยกที่ไม่มี `webServer`
- **markers** (ภาคผนวก C): สร้างชื่อทดสอบจากจุดเดียว และ helper ที่สร้างข้อมูลต้องตรวจเครื่องหมาย ต้องเปลี่ยนชื่อ user ทดสอบเดิมทั้งหมดที่ไม่มีเครื่องหมาย ได้แก่ `catalog_*`, `login_test_*`, `onsite_reg_*`, `onsite_med_*` และ user ใน `users/*`, `food-sphere`, `household-*`, `intake-pipeline`, `master-data`, `referrals`, `stock-*`, `volunteer-*` ให้เป็น `e2eUserName(...)`
- **รายการที่ต้องตรวจหลังลบ** (ใช้เป็น spec ของฝั่งตรวจใน cleanup API):
  - registry ต้องไม่มี doc ที่ชื่อหรือ code มี runId
  - view `by_code` ต้องว่าง
  - `GET /shelter_<code>` ต้องคืน 404
  - `GET /_users/org.couchdb.user:<name>` ต้องคืน 404
  - `/_users/_all_docs` ต้องไม่มี id ที่มี runId
  - คิวต้องว่างทั้งเมื่อค้นด้วย marker และเมื่อดูทีละ id
  - `public_shelters` ต้องไม่มีแถว (ต้องหายไป ไม่ใช่แค่ปิด)
  - ค้นผู้พักพิงฝั่ง public (`POST /api/public/v1/occupants`) ด้วยนามสกุลต้องได้ 0 รายการ (rate limit 30 ครั้งต่อนาที)
  - collection ใน Mongo ที่อยู่ในรายการข้อ 4 ต้องไม่มีข้อมูลของศูนย์
  - ควรรวบรวมของค้างทั้งหมดแล้วรายงานครั้งเดียว ไม่หยุดที่ตัวแรก
- **การ stub CouchDB/FastAPI ด้วย `node:http`** บน port ชั่วคราว ใช้ได้ดีสำหรับ test ของ janitor และ cleanup API โดยไม่ต้องมี stack จริง

**ไม่ต้องทำซ้ำ:** ledger แยกไฟล์ต่อรอบ, `globalTeardown` ที่ไล่ลบ ledger และการค้นสำรองฝั่ง test เพราะ cleanup API ทำหน้าที่นี้แทนทั้งหมด

## ข้อจำกัดที่เจอในเครื่องเก่า (เช็คในเครื่องใหม่ด้วย)

- **Chromium:** ถ้า Playwright เปิด browser แล้วได้ exit 127 แปลว่าขาด system library ต้องรัน `sudo node_modules/.bin/playwright install-deps chromium` (ต้องรัน `playwright install chromium` ก่อนด้วย)
- **Docker stack:** ต้องมี CouchDB, Mongo, worker และ FastAPI ที่ :9000 และต้องมีไฟล์ `.env` ที่ root ของ repo (สร้างจาก `.env.example`)
- **pnpm:** `frontend/package.json` กำหนด `packageManager: pnpm@12.6.0` ถ้า pnpm ในเครื่องเป็นคนละเวอร์ชัน `frontend/pnpm-lock.yaml` จะถูกแก้เองทุกครั้งที่รัน แนะนำ `corepack enable` และอย่าให้ pnpm ตัวอื่นอยู่ก่อนใน PATH
- **lefthook:** ต้องรัน `pnpm install` ที่ root เพื่อติดตั้ง hook (ใน `.git/hooks` ต้องมีไฟล์ `pre-commit` และ `pre-push` ไม่ใช่แค่ `.sample`)
- **บนเครื่อง WSL:** ต้องเปิด Docker Desktop และเปิด WSL integration ให้ distro ที่ใช้

## ความชอบของเจ้าของที่ควรรู้

- **e2e ตรวจแค่โครงสร้าง:** ตรวจว่าหน้าและฟอร์ม render ครบ ไม่มี error และเห็นข้อมูล **ไม่ใช้** `toHaveScreenshot` และไม่ใช้ `toMatchAriaSnapshot` ที่เทียบข้อความทุกตัว เพราะ copy เปลี่ยนบ่อย (เหตุการณ์ PR #425)
- **ใช้ locator ตาม role/landmark:** เช่น `main header`, `banner` แทนการเทียบข้อความทั้งหน้า

## ภาคผนวก A: ตัวกันการเขียน (`helpers/fixtures.ts` จากรอบก่อน)

```ts
// OD-1: default allowlist — only requests that POST but do NOT persist anything.
const DEFAULT_ALLOWLIST: AllowRule[] = [
	// CouchDB login — creates a session cookie, writes no data.
	{ method: 'POST', url: /\/couch\/_session(\?|$)/ },
	// reCAPTCHA's own widget traffic to Google, not our backend.
	{ url: /^https:\/\/(www\.)?(google\.com|gstatic\.com|recaptcha\.net)\/recaptcha\// },
	// Public search is a POST only to carry the query body.
	{ method: 'POST', url: /\/api\/public\/v1\/occupants(\?|$)/ },
	// Read-only lookups (rate-limited, no persistence).
	{ method: 'POST', url: /\/api\/public\/v1\/registrations\/(status|lookup|check-duplicate)(\?|$)/ },
	{ method: 'POST', url: /\/api\/public\/v1\/households\/residence-match(\?|$)/ },
	{ method: 'POST', url: /\/api\/public\/v1\/donations\/track-search(\?|$)/ },
	{ method: 'POST', url: /\/api\/public\/v1\/volunteer\/(ticket\/find|access\/resolve)(\?|$)/ },
	// Validates a volunteer application without saving it.
	{ method: 'POST', url: /\/api\/public\/v1\/volunteer\/apply\/preflight(\?|$)/ },
	// Opens an in-memory scan session (QR); nothing is stored in CouchDB / Mongo.
	{ method: 'POST', url: /\/api\/public\/v1\/thaid\/scan-session(\?|$)/ }
];
// Deliberately NOT allowlisted: volunteer/access/role-card (can mint a token).

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// mode: E2E_WRITE_GUARD=enforce|warn|off — default enforce when E2E_BASE_URL is set, else off.
// extra: E2E_WRITE_ALLOWLIST_EXTRA = comma-separated `METHOD url-regex` or `url-regex`.

writeGuard: [
	async ({ context, writeGuardMode }, use) => {
		const guard = { blocked: [] as string[], allow: (..._: RegExp[]) => {} };
		if (writeGuardMode === 'off') return use(guard);
		const rules = [...DEFAULT_ALLOWLIST, ...envAllowlist()];
		const extra: RegExp[] = [];
		guard.allow = (...patterns) => void extra.push(...patterns);
		// Registered before any test-level route so mocks (registered later) win.
		await context.route('**/*', async (route) => {
			const req = route.request();
			const method = req.method();
			const url = req.url();
			const allowed =
				SAFE_METHODS.has(method) ||
				rules.some((r) => (!r.method || r.method === method) && r.url.test(url)) ||
				extra.some((re) => re.test(url));
			if (allowed) return route.fallback();
			guard.blocked.push(`${method} ${url}`);
			if (writeGuardMode === 'enforce') return route.abort('blockedbyclient');
			return route.fallback();
		});
		await use(guard);
		if (!guard.blocked.length) return;
		if (writeGuardMode === 'warn') return console.warn('[write-guard] …', guard.blocked);
		expect(guard.blocked, 'write guard blocked unmocked write(s) …').toEqual([]);
	},
	{ auto: true }
]
```

fixture `health` เดิมอยู่ใน `frontend/e2e/public-pre-register-flow.test.ts:162-178` (ใช้ `watchPage` จาก `helpers/pre-register.ts`) ให้ยกเป็น auto fixture กลาง มี option `healthMode: 'enforce' | 'warn'` ค่าเริ่มต้น `warn` (OD-15) และให้ไฟล์ pre-register ตั้ง `test.use({ healthMode: 'enforce' })`

## ภาคผนวก B: `assertWritable` (ใส่ใน `helpers/e2e-env.ts`)

```ts
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Node-side admin writes are refused on remote targets (E2E_BASE_URL set). */
export function assertWritable(method: string, path: string): void {
	if (!IS_REMOTE || SAFE.has(method.toUpperCase())) return;
	throw new Error(`Refusing ${method} ${path}: remote target is read-only (E2E_BASE_URL is set)`);
}
```

ข้อยกเว้น: `couchLogin` (POST `/_session` เพื่อเอา cookie) ใช้บน remote ได้ (OD-17)

## ภาคผนวก C: markers (`helpers/markers.ts`)

```ts
export const RUN_ID = Date.now().toString(36); // per worker process
export const E2E_USER_PREFIX = 'e2e_';
const SHELTER_PREFIX = 'E2E';

export const e2eShelterName = (label: string) => `${SHELTER_PREFIX} ${label} ${RUN_ID}`;
export const e2eLastName = (label: string) => `${label}${RUN_ID}`;
export const e2eUserName = (role: string) => `${E2E_USER_PREFIX}${role}_${RUN_ID}`;

export type MarkedKind = 'shelter' | 'user' | 'person';
export function isE2EMarked(kind: MarkedKind, value: string): boolean {
	if (kind === 'shelter') return value.startsWith(SHELTER_PREFIX);
	if (kind === 'user') return value.startsWith(E2E_USER_PREFIX);
	return value.includes(RUN_ID);
}
export function assertE2EMarked(kind: MarkedKind, value: string): void {
	if (!isE2EMarked(kind, value)) throw new Error(`Unmarked E2E ${kind} "${value}"`);
}
// create paths (createShelterViaUi, createCouchUser, …) call assertE2EMarked first.
```

ข้อควรระวังเรื่อง `RUN_ID`: Playwright สร้าง worker ใหม่หลัง serial test fail ทำให้ `RUN_ID` เปลี่ยนกลางรอบ cleanup API จึงควรรับได้หลาย runId หรือให้ pipeline ส่ง runId เดียวกันผ่าน env (เช่น `E2E_RUN_ID`) แทนการสร้างใน process
