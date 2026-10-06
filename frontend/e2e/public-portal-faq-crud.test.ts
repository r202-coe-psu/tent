/**
 * Public portal config — admin edits in /system-management/public-portal-config (FAQ
 * CRUD, then the LINE OA / Facebook contact links) and the result on the public landing
 * page. Real BFF + CouchDB, no response mocks.
 *
 * Both parts save the same `config:public_portal` document through the same form, so
 * they share this serial file — in separate files Playwright would run them in
 * parallel and one save could overwrite the other.
 *
 * Requires the full local stack: `docker compose up -d` (CouchDB, MongoDB, sync worker,
 * FastAPI :9000) — the landing page reads FAQs from the Mongo projection.
 * beforeAll creates a throwaway system admin (session injection) and remembers the
 * operator's contact links; afterAll removes every FAQ tagged with this run's marker,
 * puts the contact links back and deletes the user.
 *
 * Local target only: every test writes, so the whole file is skipped on a remote
 * (`E2E_BASE_URL`, staging/production) target, which is read-only.
 *
 * Locators are generated with Playwright codegen (`pnpm exec playwright codegen`).
 */
import { test, expect } from '@playwright/test';
import {
	seedSecurityQuestion,
	couchLogin,
	createCouchUser,
	deleteCouchUser,
	SA_ROLES
} from './helpers/couch';
import { IS_REMOTE, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession } from './helpers/login';
import {
	publicFaqQuestions,
	readContactLinks,
	removeTestFaqs,
	restoreContactLinks,
	waitForProjection,
	type ContactLinks
} from './helpers/public-cleanup';

test.describe.configure({ mode: 'serial' });
test.skip(IS_REMOTE, READ_ONLY_REASON);

const RUN_ID = Date.now().toString(36);
const MARKER = `[E2E-${RUN_ID}]`;
const TEST_USER = {
	name: `e2e_faq_admin_${RUN_ID}`,
	password: 'Password1!',
	roles: SA_ROLES,
	display_name: 'E2E FAQ Admin'
};

const QUESTION_TH = `ศูนย์พักพิงเปิดให้บริการตลอด 24 ชั่วโมงหรือไม่? ${MARKER}`;
const ANSWER_TH = `เปิดรับผู้ประสบภัยตลอด 24 ชั่วโมง ${MARKER}`;
const QUESTION_EN = `Is the shelter open 24 hours? ${MARKER}`;
const ANSWER_EN = `Yes, it is open 24/7. ${MARKER}`;
const UPDATED_QUESTION_TH = `มีเจ้าหน้าที่ประจำการตลอด 24 ชั่วโมงหรือไม่? ${MARKER}`;
const UPDATED_ANSWER_TH = `มีเจ้าหน้าที่และพยาบาลประจำการตลอด 24 ชั่วโมง ${MARKER}`;
// Fictitious, unique per run.
const LINE_URL = `https://line.me/R/ti/p/@e2e${RUN_ID}`;
const FACEBOOK_URL = `https://www.facebook.com/e2e.${RUN_ID}`;

let sessionCookie = '';
let operatorContactLinks: ContactLinks | null = null;

/** Wait until the landing-page FAQ projection reflects the latest admin write. */
const waitForPublicFaq = (question: string, present: boolean) =>
	waitForProjection(
		`FAQ "${question}" ${present ? 'published' : 'withdrawn'}`,
		async () => (await publicFaqQuestions()).includes(question) === present,
		{ timeoutMs: 30_000, intervalMs: 1_000 }
	);

test.beforeAll(async () => {
	if (IS_REMOTE) return;
	await createCouchUser(TEST_USER);
	await seedSecurityQuestion(TEST_USER.name);
	sessionCookie = await couchLogin(TEST_USER.name, TEST_USER.password);
	operatorContactLinks = await readContactLinks();
});

test.afterAll(async () => {
	if (IS_REMOTE) return;
	await removeTestFaqs(MARKER);
	await restoreContactLinks(operatorContactLinks);
	await deleteCouchUser(TEST_USER.name);
});

test.describe('Public portal FAQ management', () => {
	test('admin creates a published FAQ', async ({ page }) => {
		await injectSession(page, TEST_USER, sessionCookie);
		await page.goto('/system-management/public-portal-config');
		await expect(
			page.getByRole('heading', { name: 'การตั้งค่า Public Portal (FAQ)' })
		).toBeVisible();

		await page.getByRole('button', { name: 'เพิ่มข้อมูล' }).click();
		await expect(page.getByRole('heading', { name: 'เพิ่มคำถามใหม่' })).toBeVisible();
		await page.getByRole('textbox', { name: 'คำถาม (ไทย)' }).fill(QUESTION_TH);
		await page.getByRole('textbox', { name: 'คำตอบ (ไทย)' }).fill(ANSWER_TH);
		await page.getByRole('textbox', { name: 'คำถาม (English)' }).fill(QUESTION_EN);
		await page.getByRole('textbox', { name: 'คำตอบ (English)' }).fill(ANSWER_EN);
		await expect(page.getByRole('dialog').getByRole('switch')).toBeChecked();
		await page.getByRole('button', { name: 'ยืนยัน' }).click();

		await expect(page.getByRole('dialog')).toBeHidden();
		await expect(page.getByRole('row', { name: QUESTION_TH })).toBeVisible();
		await expect(
			page.getByRole('row', { name: QUESTION_TH }).getByRole('cell', { name: 'เผยแพร่' })
		).toBeVisible();
	});

	test('the landing page shows the FAQ in Thai and English', async ({ page }) => {
		await waitForPublicFaq(QUESTION_TH, true);
		await page.goto('/');
		await page.getByRole('button', { name: QUESTION_TH }).click();
		await expect(page.getByText(ANSWER_TH)).toBeVisible();

		// The open accordion item stays open across the language switch.
		await page.getByRole('button', { name: 'Switch to English' }).click();
		await expect(page.getByRole('button', { name: QUESTION_EN })).toBeVisible();
		await expect(page.getByText(ANSWER_EN)).toBeVisible();

		await page.getByRole('button', { name: 'เปลี่ยนเป็นภาษาไทย' }).click();
		await expect(page.getByRole('button', { name: QUESTION_TH })).toBeVisible();
	});

	test('admin edits the FAQ and the landing page follows', async ({ page }) => {
		await injectSession(page, TEST_USER, sessionCookie);
		await page.goto('/system-management/public-portal-config');
		await page
			.getByRole('row', { name: QUESTION_TH })
			.getByRole('button', { name: 'จัดการ' })
			.click();
		await expect(page.getByRole('heading', { name: 'แก้ไขคำถาม' })).toBeVisible();
		await page.getByRole('textbox', { name: 'คำถาม (ไทย)' }).fill(UPDATED_QUESTION_TH);
		await page.getByRole('textbox', { name: 'คำตอบ (ไทย)' }).fill(UPDATED_ANSWER_TH);
		await page.getByRole('button', { name: 'ยืนยัน' }).click();
		await expect(page.getByRole('row', { name: UPDATED_QUESTION_TH })).toBeVisible();

		await waitForPublicFaq(UPDATED_QUESTION_TH, true);
		await page.goto('/');
		await page.getByRole('button', { name: UPDATED_QUESTION_TH }).click();
		await expect(page.getByText(UPDATED_ANSWER_TH)).toBeVisible();
		await expect(page.getByRole('button', { name: QUESTION_TH })).toHaveCount(0);
	});

	test('admin hides the FAQ and the landing page drops it', async ({ page }) => {
		await injectSession(page, TEST_USER, sessionCookie);
		await page.goto('/system-management/public-portal-config');
		await page
			.getByRole('row', { name: UPDATED_QUESTION_TH })
			.getByRole('button', { name: 'จัดการ' })
			.click();
		await page.getByRole('dialog').getByRole('switch').click();
		await expect(page.getByRole('dialog').getByRole('switch')).not.toBeChecked();
		await page.getByRole('button', { name: 'ยืนยัน' }).click();
		await expect(
			page.getByRole('row', { name: UPDATED_QUESTION_TH }).getByRole('cell', { name: 'ซ่อน' })
		).toBeVisible();

		await waitForPublicFaq(UPDATED_QUESTION_TH, false);
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'คำถามที่พบบ่อย' })).toBeVisible();
		await expect(page.getByRole('button', { name: UPDATED_QUESTION_TH })).toHaveCount(0);
	});

	test('admin finds the FAQ with the table search', async ({ page }) => {
		await injectSession(page, TEST_USER, sessionCookie);
		await page.goto('/system-management/public-portal-config');
		await page.getByRole('searchbox', { name: 'ค้นหา' }).fill(MARKER);
		await expect(page.getByRole('row', { name: UPDATED_QUESTION_TH })).toBeVisible();
		await expect(page.getByRole('row', { name: MARKER })).toHaveCount(1);
	});

	test('admin deletes the FAQ', async ({ page }) => {
		await injectSession(page, TEST_USER, sessionCookie);
		await page.goto('/system-management/public-portal-config');
		page.once('dialog', (dialog) => dialog.accept());
		await page
			.getByRole('row', { name: UPDATED_QUESTION_TH })
			.getByRole('button', { name: 'ลบ' })
			.click();
		await expect(page.getByRole('row', { name: UPDATED_QUESTION_TH })).toHaveCount(0);

		await waitForPublicFaq(UPDATED_QUESTION_TH, false);
		await page.goto('/');
		await expect(page.getByRole('button', { name: UPDATED_QUESTION_TH })).toHaveCount(0);
	});
});

test.describe('Public portal contact links', () => {
	test('admin sets LINE OA and Facebook links and the footer shows them', async ({ page }) => {
		await injectSession(page, TEST_USER, sessionCookie);
		await page.goto('/system-management/public-portal-config');
		await page.getByRole('button', { name: 'ช่องทางการติดต่อ ตั้งค่าลิงก์ติดต่อ' }).click();
		await page.getByRole('textbox', { name: 'LINE OA URL' }).fill(LINE_URL);
		await page.getByRole('textbox', { name: 'Facebook URL' }).fill(FACEBOOK_URL);
		await page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' }).click();
		await expect(page.getByText('บันทึกการตั้งค่าเรียบร้อยแล้ว')).toBeVisible();

		// The BFF reads the config straight from CouchDB — no projection wait.
		await page.goto('/');
		const footer = page.getByRole('contentinfo');
		await expect(footer.getByRole('heading', { name: 'ช่องทางออนไลน์ด่วน' })).toBeVisible();
		await expect(footer.getByRole('link', { name: 'LINE OA ฉุกเฉิน' })).toHaveAttribute(
			'href',
			LINE_URL
		);
		await expect(footer.getByRole('link', { name: 'Facebook ข่าวสาร EOC' })).toHaveAttribute(
			'href',
			FACEBOOK_URL
		);
	});

	test('admin clears the links and the footer drops the online channels', async ({ page }) => {
		await injectSession(page, TEST_USER, sessionCookie);
		await page.goto('/system-management/public-portal-config');
		await page.getByRole('button', { name: 'ช่องทางการติดต่อ ตั้งค่าลิงก์ติดต่อ' }).click();
		await expect(page.getByRole('textbox', { name: 'LINE OA URL' })).toHaveValue(LINE_URL);
		await page.getByRole('textbox', { name: 'LINE OA URL' }).fill('');
		await page.getByRole('textbox', { name: 'Facebook URL' }).fill('');
		await page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' }).click();
		await expect(page.getByText('บันทึกการตั้งค่าเรียบร้อยแล้ว')).toBeVisible();

		await page.goto('/');
		const footer = page.getByRole('contentinfo');
		await expect(footer.getByRole('heading', { name: 'เบอร์ติดต่อฉุกเฉิน' })).toBeVisible();
		await expect(footer.getByRole('heading', { name: 'ช่องทางออนไลน์ด่วน' })).toHaveCount(0);
		await expect(footer.getByRole('link', { name: 'LINE OA ฉุกเฉิน' })).toHaveCount(0);
		await expect(footer.getByRole('link', { name: 'Facebook ข่าวสาร EOC' })).toHaveCount(0);
	});
});
