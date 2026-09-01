import { test, expect, type Locator, type Page } from '@playwright/test';

const SHELTERS = {
	shelters: [
		{
			code: 'SH001',
			name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่',
			status: 'open',
			capacity: 200,
			province: 'สงขลา',
			district: 'หาดใหญ่',
			subdistrict: 'หาดใหญ่',
			vulnerable_groups: ['vg_elderly', 'vg_bedridden'],
			pet_policy: 'conditional'
		},
		{
			code: 'SH002',
			name: 'ศูนย์พักพิง โรงเรียนวัดโคกสมานคุณ',
			status: 'closed',
			capacity: 100,
			province: 'สงขลา',
			vulnerable_groups: [],
			pet_policy: 'no_pets'
		}
	],
	count: 2,
	as_of: '2026-08-21T03:00:00.000Z'
};

const GROUPS = {
	groups: [
		{ code: 'vg_elderly', label: 'ผู้สูงอายุ' },
		{ code: 'vg_bedridden', label: 'ผู้ป่วยติดเตียง' }
	]
};

// pet_types master data for the selected shelter — `dog` is the shelter's
// configured default, so a newly added pet row preselects it without the
// citizen having to choose (same code the pet-recording test submits).
const PET_TYPES = {
	petTypes: [
		{ code: 'dog', label: 'สุนัข', is_default: true },
		{ code: 'cat', label: 'แมว', is_default: false }
	]
};

/**
 * Pick a value from a shadcn Select. `Form.Control` spreads the superforms field
 * name onto `Select.Trigger`, so the trigger is `button[name="<field>"]` — there
 * is no native <select> to `selectOption` on.
 */
async function selectOption(scope: Locator, field: string, optionLabel: string | RegExp) {
	await scope.locator(`button[name="${field}"]`).click();
	await scope.page().getByRole('option', { name: optionLabel }).click();
}

const BOOKING_CODE = '01JABCDEFGHJKMNPQRSTVWXYZ0';

const TICKET = {
	success: true,
	code: BOOKING_CODE,
	shelter_code: 'SH001',
	shelter_name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่',
	first_name: 'สมชาย',
	member_count: 1,
	pet_count: 0,
	status: 'pre_registered',
	booked_at: '2026-08-21T03:00:00.000Z'
};

// Thailand address cascade for the household head's domicile (CR-105). The BFF
// answers with a different key per cascade level, keyed on how much of the query
// string is filled in — mocked the same way here.
const LOCATIONS = {
	provinces: { provinces: ['สงขลา', 'ปัตตานี'] },
	districts: { districts: ['หาดใหญ่', 'เมืองสงขลา'] },
	subdistricts: { subdistricts: [{ subdistrict: 'คอหงส์', zipcode: 90110 }] }
};

async function mockReferenceData(page: Page) {
	await page.route('**/api/public/v1/shelters**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(SHELTERS)
		})
	);
	await page.route('**/api/public/v1/config/vulnerable-groups', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GROUPS) })
	);
	await page.route('**/api/public/v1/config/pet-types**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PET_TYPES) })
	);
	await page.route('**/api/public/v1/config/locations**', (route) => {
		const params = new URL(route.request().url()).searchParams;
		const body = params.get('district')
			? LOCATIONS.subdistricts
			: params.get('province')
				? LOCATIONS.districts
				: LOCATIONS.provinces;
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(body)
		});
	});
}

/**
 * Fill the required domicile address (CR-105). จังหวัด → อำเภอ → ตำบล are
 * `SearchSelect` popovers, not native selects: the trigger carries the superforms
 * field name, and each option is a plain button labelled with its value.
 */
async function fillAddress(dialog: Locator) {
	await dialog.locator('input[name="address.address_no"]').fill('123/45');
	for (const [field, option] of [
		['address.province', 'สงขลา'],
		['address.district', 'หาดใหญ่'],
		['address.subdistrict', 'คอหงส์']
	] as const) {
		await dialog.locator(`button[name="${field}"]`).click();
		await dialog.page().getByRole('button', { name: option, exact: true }).click();
	}
}

/** Open the booking dialog from the landing page and wait for the form. */
async function openBooking(page: Page) {
	await page.goto('/');
	await page.evaluate(() => {
		(window as Window & { __captchaToken?: string }).__captchaToken = 'e2e-captcha-token';
	});
	// Landing-page CTA copy is now "ลงทะเบียน (เร็วๆนี้)" (public-home i18n `regBtn`) —
	// the button still opens the booking dialog.
	await page
		.getByRole('button', { name: /ลงทะเบียน/ })
		.first()
		.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText('ศูนย์พักพิงและข้อมูลผู้ติดต่อหลัก')).toBeVisible();
	return dialog;
}

test.describe('Public shelter booking (T-71 / CR-070)', () => {
	test('books a solo stay from the landing page and shows the QR ticket', async ({ page }) => {
		await mockReferenceData(page);

		let submitted: Record<string, unknown> | null = null;
		await page.route('**/api/public/v1/registrations', async (route) => {
			submitted = route.request().postDataJSON();
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify(TICKET)
			});
		});

		const dialog = await openBooking(page);

		// Closed shelters are not offered at all.
		await dialog.locator('button[name="shelter_code"]').click();
		await expect(page.getByRole('option')).toHaveCount(1);
		await page.getByRole('option', { name: /เทศบาลนครหาดใหญ่/ }).click();

		await dialog.locator('input[name="members[0].first_name"]').fill('สมชาย');
		await dialog.locator('input[name="members[0].last_name"]').fill('ใจดี');
		await dialog.locator('input[name="phone"]').fill('0812345678');
		await fillAddress(dialog);

		await dialog.getByRole('button', { name: 'ยืนยันการจองเข้าศูนย์' }).click();

		// CR-081: the ticket shows the holder's name, not the booking code (the code
		// is the evacuee ULID and lives only inside the QR).
		await expect(dialog.getByText('สมชาย ใจดี')).toBeVisible();
		await expect(dialog.getByAltText('QR สำหรับยืนยันตัวตนที่ประตูศูนย์')).toBeVisible();

		expect(submitted).toMatchObject({
			shelter_code: 'SH001',
			phone: '0812345678',
			address: {
				address_no: '123/45',
				province: 'สงขลา',
				district: 'หาดใหญ่',
				subdistrict: 'คอหงส์',
				// filled from the chosen subdistrict, never typed
				postal_code: '90110'
			},
			members: [{ first_name: 'สมชาย', last_name: 'ใจดี', gender: 'male', special_needs: [] }],
			pets: []
		});
	});

	test('adds family members with the counter and tags them per shelter', async ({ page }) => {
		await mockReferenceData(page);

		let submitted: Record<string, unknown> | null = null;
		await page.route('**/api/public/v1/registrations', async (route) => {
			submitted = route.request().postDataJSON();
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({ ...TICKET, member_count: 2 })
			});
		});

		const dialog = await openBooking(page);
		await selectOption(dialog, 'shelter_code', /เทศบาลนครหาดใหญ่/);
		await dialog.locator('input[name="members[0].first_name"]').fill('สมชาย');
		await dialog.locator('input[name="members[0].last_name"]').fill('ใจดี');
		await dialog.locator('input[name="phone"]').fill('0812345678');
		await fillAddress(dialog);

		// The tag choices come from the selected shelter, not a hardcoded list.
		await expect(dialog.getByText('ผู้สูงอายุ').first()).toBeVisible();
		await expect(dialog.getByText('ผู้ป่วยติดเตียง').first()).toBeVisible();

		await dialog.getByRole('button', { name: 'เพิ่มจำนวนผู้พักพิง' }).click();
		await dialog.locator('input[name="members[1].first_name"]').fill('สมหญิง');
		await dialog.locator('input[name="members[1].last_name"]').fill('ใจดี');
		// Second member is elderly.
		await dialog.getByLabel('ผู้สูงอายุ — สมาชิกคนที่ 2').check();

		await dialog.getByRole('button', { name: 'ยืนยันการจองเข้าศูนย์' }).click();
		await expect(dialog.getByAltText('QR สำหรับยืนยันตัวตนที่ประตูศูนย์')).toBeVisible();

		expect(submitted).toMatchObject({
			members: [
				{ first_name: 'สมชาย', last_name: 'ใจดี', special_needs: [] },
				{ first_name: 'สมหญิง', last_name: 'ใจดี', special_needs: ['ผู้สูงอายุ'] }
			]
		});
	});

	// The shelter payload comes from Mongo (sync worker) while the labels come from
	// CouchDB master data — right after a seed the projection can carry codes whose
	// labels have not synced yet. A checkbox reading `vg_bedridden` is worse than no
	// checkbox, so an unresolved code is dropped, not shown raw.
	//
	// Entered through the shelter-detail CTA rather than `openBooking`: the landing
	// page's booking CTA is currently "เร็วๆนี้", and this CTA also preselects the
	// shelter, so the tag list renders without touching the shelter picker.
	test('drops a vulnerable-group code whose label has not synced yet', async ({ page }) => {
		await mockReferenceData(page);
		await page.route('**/api/public/v1/config/vulnerable-groups', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ groups: [{ code: 'vg_elderly', label: 'ผู้สูงอายุ' }] })
			})
		);
		await page.route('**/api/public/v1/shelters/SH001', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ shelter: { ...SHELTERS.shelters[0], id: 'SH001' } })
			})
		);

		await page.goto('/shelters/SH001');
		await page.getByRole('button', { name: 'จองที่ศูนย์นี้' }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText('ผู้สูงอายุ').first()).toBeVisible();
		await expect(dialog.getByText('vg_bedridden')).toHaveCount(0);
	});

	test('records pets when the shelter allows them', async ({ page }) => {
		await mockReferenceData(page);

		let submitted: Record<string, unknown> | null = null;
		await page.route('**/api/public/v1/registrations', async (route) => {
			submitted = route.request().postDataJSON();
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({ ...TICKET, pet_count: 1 })
			});
		});

		const dialog = await openBooking(page);
		await selectOption(dialog, 'shelter_code', /เทศบาลนครหาดใหญ่/);
		await dialog.locator('input[name="members[0].first_name"]').fill('สมชาย');
		await dialog.locator('input[name="members[0].last_name"]').fill('ใจดี');
		await dialog.locator('input[name="phone"]').fill('0812345678');
		await fillAddress(dialog);

		await dialog.getByLabel('นำสัตว์เลี้ยงมาด้วย').check();
		// The species choices — and the preselected default — come from the
		// shelter's configured `pet_types` master data, not a hardcoded list.
		await expect(dialog.locator('button[name="pets[0].species"]')).toContainText('สุนัข');
		await dialog.locator('input[name="pets[0].notes"]').fill('โกโก้ ชิวาว่า');
		await dialog.getByLabel('นำกรง/สายจูง/ตะกร้าติดตัวมาด้วย').check();

		await dialog.getByRole('button', { name: 'ยืนยันการจองเข้าศูนย์' }).click();
		await expect(dialog.getByAltText('QR สำหรับยืนยันตัวตนที่ประตูศูนย์')).toBeVisible();

		expect(submitted).toMatchObject({
			pets: [{ species: 'dog', notes: 'โกโก้ ชิวาว่า', has_cage: true }]
		});
	});

	test('surfaces the server message when the shelter closed mid-flow', async ({ page }) => {
		await mockReferenceData(page);
		await page.route('**/api/public/v1/registrations', (route) =>
			route.fulfill({
				status: 409,
				contentType: 'application/json',
				body: JSON.stringify({ success: false, error: 'SHELTER_CLOSED' })
			})
		);

		const dialog = await openBooking(page);
		await selectOption(dialog, 'shelter_code', /เทศบาลนครหาดใหญ่/);
		await dialog.locator('input[name="members[0].first_name"]').fill('สมชาย');
		await dialog.locator('input[name="members[0].last_name"]').fill('ใจดี');
		await dialog.locator('input[name="phone"]').fill('0812345678');
		await fillAddress(dialog);
		await dialog.getByRole('button', { name: 'ยืนยันการจองเข้าศูนย์' }).click();

		await expect(dialog.getByRole('alert')).toContainText('ปิดรับผู้เข้าพัก');
	});

	test('the shelter detail CTA opens the dialog with that shelter locked', async ({ page }) => {
		await mockReferenceData(page);
		await page.route('**/api/public/v1/shelters/SH001', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ shelter: { ...SHELTERS.shelters[0], id: 'SH001' } })
			})
		);

		await page.goto('/shelters/SH001');
		await page.getByRole('button', { name: 'จองที่ศูนย์นี้' }).click();

		const dialog = page.getByRole('dialog');
		const trigger = dialog.locator('button[name="shelter_code"]');
		await expect(trigger).toBeDisabled();
		await expect(trigger).toContainText('เทศบาลนครหาดใหญ่');
	});

	test('the family-search CTA opens its own dialog', async ({ page }) => {
		await mockReferenceData(page);
		await page.route('**/api/public/v1/occupants', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ results: [] })
			})
		);

		await page.goto('/');
		await page.getByRole('button', { name: /ค้นหารายบุคคลด่วนที่สุด/ }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText('สืบค้นญาติและครอบครัว')).toBeVisible();

		await dialog.getByLabel('คำค้นหา').fill('สมชาย');
		await dialog.getByRole('button', { name: 'ค้นหา' }).click();
		await expect(dialog.getByText('ไม่พบผู้ที่ตรงกับคำค้นหา')).toBeVisible();
	});
});
