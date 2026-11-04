/**
 * Kitchen meal-session people counts (#806) against the real local CouchDB.
 *
 * The create-session dialog shows how many evacuees, staff and checked-in volunteers are in the
 * shelter, and prefills the "เจ้าหน้าที่/อาสา" target with staff + volunteers. A staff user linked
 * to a volunteer profile counts once, as the volunteer; volunteers checked in elsewhere or checked
 * out do not count.
 *
 * SH001 already holds seed data, so the assertions are deltas against counts read before this run
 * seeds anything. Teardown deletes only documents and users this run created and ends with a
 * zero-leak check.
 */

import {
	expect,
	test,
	type Browser,
	type BrowserContext,
	type Locator,
	type Page
} from '@playwright/test';
import { ulid } from '../src/lib/db/ulid';
import {
	allDocuments,
	couchLogin,
	createCouchUser,
	deleteCouchUser,
	deleteDocument,
	putDocument,
	routeBrowserCouchThroughApp,
	seedSecurityQuestion,
	type CouchDocument,
	type TestUser
} from './helpers/couch';
import { CAN_WRITE, LOCAL_RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession } from './helpers/login';

const SHELTER_DB = 'shelter_sh001';
const RUN = `${LOCAL_RUN_ID}${ulid().slice(-4).toLowerCase()}`;

const SH001_STAFF_ROLES = ['shelter:SH001', 'registration_staff'];

const KITCHEN: TestUser = {
	name: `e2e_skh_ks_${RUN}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'kitchen_staff'],
	display_name: 'E2E Kitchen Headcount'
};
const LINKED_STAFF: TestUser = {
	name: `e2e_skh_linked_${RUN}`,
	password: 'Password1!',
	roles: SH001_STAFF_ROLES
};
const PLAIN_STAFF: TestUser = {
	name: `e2e_skh_plain_${RUN}`,
	password: 'Password1!',
	roles: SH001_STAFF_ROLES
};
const OWNED_USERS = [KITCHEN, LINKED_STAFF, PLAIN_STAFF];

const ownedIds = new Set<string>();
const contexts: BrowserContext[] = [];
let session = '';
let volunteerSeq = 0;

function isOwned(doc: CouchDocument): boolean {
	return ownedIds.has(doc._id) || doc.created_by === KITCHEN.name;
}

async function seedVolunteer(fields: {
	checked_in: boolean;
	current_shelter_code: string | null;
	user_name?: string;
}): Promise<void> {
	const id = `volunteer:${ulid()}`;
	ownedIds.add(id);
	volunteerSeq += 1;
	const now = new Date().toISOString();
	await putDocument(SHELTER_DB, {
		_id: id,
		type: 'volunteer',
		schema_v: 4,
		shelter_code: 'SH001',
		created_at: now,
		updated_at: now,
		created_by: KITCHEN.name,
		first_name: 'E2E อาสา',
		last_name: `${RUN} ${volunteerSeq}`,
		phone: null,
		skills: [],
		status: 'active',
		user_name: fields.user_name ?? null,
		checked_in: fields.checked_in,
		current_shelter_code: fields.current_shelter_code,
		volunteer_code: `V-E2E${volunteerSeq}`,
		identity_verified: false,
		source: 'staff_entry',
		personnel_type: 'volunteer'
	});
}

async function cleanupOwnedDocuments(): Promise<void> {
	const errors: unknown[] = [];
	for (let pass = 0; pass < 3; pass += 1) {
		const owned = (await allDocuments(SHELTER_DB)).filter(isOwned);
		if (owned.length === 0) break;
		const results = await Promise.allSettled(owned.map((doc) => deleteDocument(SHELTER_DB, doc)));
		for (const result of results) {
			if (result.status === 'rejected') errors.push(result.reason);
		}
	}
	for (const user of OWNED_USERS) {
		try {
			await deleteCouchUser(user.name);
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length > 0) {
		throw new AggregateError(errors, `Could not fully clean kitchen headcount run ${RUN}`);
	}
}

async function openKitchen(browser: Browser, viewport?: { width: number; height: number }) {
	const context = await browser.newContext(viewport ? { viewport } : {});
	contexts.push(context);
	const page = await context.newPage();
	await routeBrowserCouchThroughApp(page);
	await injectSession(page, KITCHEN, session);
	await page.goto('/back-office/kitchen');
	await expect(page.getByRole('heading', { name: 'หน้าสรุปมื้อ' })).toBeVisible({
		timeout: 15_000
	});
	return page;
}

async function openCreateDialog(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'สร้างมื้อใหม่' }).click();
	await expect(page.getByRole('heading', { name: 'สร้างรอบมื้ออาหารใหม่' })).toBeVisible();
	await expect(page.getByTestId('shelter-people-evacuees')).toHaveText(/\d+\s*คน/, {
		timeout: 15_000
	});
}

interface PeopleCounts {
	evacuees: number;
	staff: number;
	volunteers: number;
}

async function readPeopleCounts(page: Page): Promise<PeopleCounts> {
	const read = async (key: keyof PeopleCounts) =>
		Number.parseInt(
			(await page.getByTestId(`shelter-people-${key}`).innerText()).match(/\d+/)![0],
			10
		);
	return {
		evacuees: await read('evacuees'),
		staff: await read('staff'),
		volunteers: await read('volunteers')
	};
}

function staffVolunteerInput(page: Page): Locator {
	return page
		.getByText('เจ้าหน้าที่/อาสา', { exact: true })
		.locator('xpath=following-sibling::input');
}

test.describe(
	'Kitchen — meal session people counts and staff/volunteer target (#806)',
	{ tag: ['@kitchen'] },
	() => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
		test.setTimeout(120_000);
		test.use({ actionTimeout: 10_000 });

		test.beforeAll(async () => {
			await createCouchUser(KITCHEN);
			await seedSecurityQuestion(KITCHEN.name);
			session = await couchLogin(KITCHEN.name, KITCHEN.password);
		});

		test.afterEach(async () => {
			await Promise.all(
				contexts.splice(0).map(async (context) => {
					for (const page of context.pages()) await page.unrouteAll({ behavior: 'ignoreErrors' });
					await context.close();
				})
			);
		});

		test.afterAll(async () => {
			await cleanupOwnedDocuments();
			const leftovers = (await allDocuments(SHELTER_DB)).filter(isOwned).map((d) => d._id);
			expect(leftovers, 'zero-leak: no documents from this run remain').toEqual([]);
			for (const user of OWNED_USERS) {
				await expect(deleteCouchUser(user.name)).resolves.toBeUndefined();
			}
		});

		test('counts staff and checked-in volunteers once and prefills the target', async ({
			browser
		}) => {
			const sessionName = `E2E คนในศูนย์ ${RUN}`;
			const before = await (async () => {
				const page = await openKitchen(browser);
				await openCreateDialog(page);
				const counts = await readPeopleCounts(page);
				await expect(staffVolunteerInput(page)).toHaveValue(
					String(counts.staff + counts.volunteers)
				);
				return counts;
			})();

			for (const user of [LINKED_STAFF, PLAIN_STAFF]) {
				await createCouchUser(user);
				await seedSecurityQuestion(user.name);
			}
			await seedVolunteer({
				checked_in: true,
				current_shelter_code: 'SH001',
				user_name: LINKED_STAFF.name
			});
			await seedVolunteer({ checked_in: true, current_shelter_code: 'SH002' });
			await seedVolunteer({ checked_in: false, current_shelter_code: 'SH001' });
			await seedVolunteer({ checked_in: false, current_shelter_code: null });

			const page = await openKitchen(browser);
			await openCreateDialog(page);
			await expect(page.getByTestId('shelter-people-volunteers')).toHaveText(
				new RegExp(`อาสาสมัคร\\s*${before.volunteers + 1}\\s*คน`)
			);
			const after = await readPeopleCounts(page);
			expect(after.evacuees, 'evacuees unchanged').toBe(before.evacuees);
			expect(after.volunteers, 'one more volunteer checked in at SH001').toBe(
				before.volunteers + 1
			);
			expect(after.staff, 'plain staff counts, linked staff does not').toBe(before.staff + 1);

			const prefill = after.staff + after.volunteers;
			expect(prefill).toBe(before.staff + before.volunteers + 2);
			await expect(staffVolunteerInput(page)).toHaveValue(String(prefill));

			await page.locator('#session-name').fill(sessionName);
			await page.getByRole('button', { name: 'สร้างรอบมื้ออาหาร', exact: true }).click();

			await page.getByPlaceholder('ค้นหาชื่อมื้อ หรือวันที่...').fill(sessionName);
			const card = page.locator('[data-slot="accordion-item"]').filter({ hasText: sessionName });
			await expect(card).toBeVisible({ timeout: 15_000 });
			const trigger = card.locator('[data-slot="accordion-trigger"]');
			if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();

			const row = card.getByRole('row').filter({
				has: page.getByRole('cell', { name: 'เจ้าหน้าที่/อาสาสมัคร', exact: true })
			});
			await expect(row).toHaveCount(1);
			const cells = row.getByRole('cell');
			await expect(cells.nth(1)).toHaveText(String(prefill));
			await expect(cells.nth(3)).toHaveText(`ขาด ${prefill}`);
		});

		test('the three counts stay on one row and only that strip scrolls on a phone', async ({
			browser
		}) => {
			const page = await openKitchen(browser, { width: 375, height: 812 });
			await openCreateDialog(page);

			const strip = page.getByTestId('shelter-people-counts');
			const tops = await Promise.all(
				['evacuees', 'staff', 'volunteers'].map(async (key) => {
					const box = await page.getByTestId(`shelter-people-${key}`).boundingBox();
					return Math.round(box!.y);
				})
			);
			expect(new Set(tops).size, 'all three cards share one row').toBe(1);

			const stripScroll = await strip.evaluate((el) => ({
				scrollWidth: el.scrollWidth,
				clientWidth: el.clientWidth
			}));
			expect(stripScroll.scrollWidth, 'strip overflows horizontally').toBeGreaterThan(
				stripScroll.clientWidth
			);

			const pageScroll = await page.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				clientWidth: document.documentElement.clientWidth
			}));
			expect(pageScroll.scrollWidth, 'page does not scroll horizontally').toBeLessThanOrEqual(
				pageScroll.clientWidth
			);
		});
	}
);
