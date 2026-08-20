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
}

/** Open the booking dialog from the landing page and wait for the form. */
async function openBooking(page: Page) {
	await page.goto('/');
	await page.evaluate(() => {
		(window as Window & { __captchaToken?: string }).__captchaToken = 'e2e-captcha-token';
	});
	await page
		.getByRole('button', { name: /จองเข้าศูนย์ล่วงหน้า/ })
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

		await dialog.locator('input[name="members[0].name"]').fill('สมชาย ใจดี');
		await dialog.locator('input[name="phone"]').fill('0812345678');

		await dialog.getByRole('button', { name: 'ยืนยันการจองเข้าศูนย์' }).click();

		await expect(dialog.getByText(BOOKING_CODE)).toBeVisible();
		await expect(dialog.getByAltText('QR สำหรับยืนยันตัวตนที่ประตูศูนย์')).toBeVisible();

		expect(submitted).toMatchObject({
			shelter_code: 'SH001',
			phone: '0812345678',
			members: [{ name: 'สมชาย ใจดี', gender: 'male', special_needs: [] }],
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
		await dialog.locator('input[name="members[0].name"]').fill('สมชาย ใจดี');
		await dialog.locator('input[name="phone"]').fill('0812345678');

		// The tag choices come from the selected shelter, not a hardcoded list.
		await expect(dialog.getByText('ผู้สูงอายุ').first()).toBeVisible();
		await expect(dialog.getByText('ผู้ป่วยติดเตียง').first()).toBeVisible();

		await dialog.getByRole('button', { name: 'เพิ่มจำนวนผู้พักพิง' }).click();
		await dialog.locator('input[name="members[1].name"]').fill('สมหญิง ใจดี');
		// Second member is elderly.
		await dialog.getByLabel('ผู้สูงอายุ — สมาชิกคนที่ 2').check();

		await dialog.getByRole('button', { name: 'ยืนยันการจองเข้าศูนย์' }).click();
		await expect(dialog.getByText(BOOKING_CODE)).toBeVisible();

		expect(submitted).toMatchObject({
			members: [
				{ name: 'สมชาย ใจดี', special_needs: [] },
				{ name: 'สมหญิง ใจดี', special_needs: ['ผู้สูงอายุ'] }
			]
		});
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
		await dialog.locator('input[name="members[0].name"]').fill('สมชาย ใจดี');
		await dialog.locator('input[name="phone"]').fill('0812345678');

		await dialog.getByLabel('นำสัตว์เลี้ยงมาด้วย').check();
		await dialog.locator('input[name="pets[0].notes"]').fill('โกโก้ ชิวาว่า');
		await dialog.getByLabel('นำกรง/สายจูง/ตะกร้าติดตัวมาด้วย').check();

		await dialog.getByRole('button', { name: 'ยืนยันการจองเข้าศูนย์' }).click();
		await expect(dialog.getByText(BOOKING_CODE)).toBeVisible();

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
		await dialog.locator('input[name="members[0].name"]').fill('สมชาย ใจดี');
		await dialog.locator('input[name="phone"]').fill('0812345678');
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

	test('track page needs both the code and the phone', async ({ page }) => {
		await page.route('**/api/public/v1/registrations/lookup', async (route) => {
			const body = route.request().postDataJSON();
			if (body.phone !== '0812345678') {
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ success: false, error: 'BOOKING_NOT_FOUND' })
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(TICKET)
			});
		});

		await page.goto('/register/track');

		await page.getByLabel('รหัสการจอง').fill(BOOKING_CODE);
		await page.getByLabel('เบอร์โทรศัพท์').fill('0899999999');
		await page.getByRole('button', { name: 'ตรวจสอบสถานะ' }).click();
		await expect(page.getByRole('alert')).toContainText('ไม่พบการจอง');

		await page.getByLabel('เบอร์โทรศัพท์').fill('0812345678');
		await page.getByRole('button', { name: 'ตรวจสอบสถานะ' }).click();
		await expect(page.getByText(BOOKING_CODE)).toBeVisible();
	});
});
