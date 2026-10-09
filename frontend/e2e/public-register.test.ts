import { test, expect, type Page } from '@playwright/test';

const SHELTERS = {
	shelters: [
		{
			code: 'SH001',
			name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่',
			status: 'open',
			capacity: 200,
			accepts_pre_registration: true,
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
			accepts_pre_registration: false,
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
		{ code: 'vg_elderly', label_th: 'ผู้สูงอายุ', label_en: 'Elderly' },
		{ code: 'vg_bedridden', label_th: 'ผู้ป่วยติดเตียง', label_en: 'Bedridden' }
	]
};

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
	await page.route('**/api/public/v1/config/shelter-policy**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				code: 'SH001',
				feature_flags: { allow_pets: true, allow_assets: true, allow_vehicles: true },
				admission_policy: { pet_policy: { policy: 'conditional' } },
				luggage_policy: { limitation: 'limited' },
				parking_policy: { availability: 'available' }
			})
		})
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
	// Unified form address cascade uses staff thailand-location BFF (not public config/locations).
	await page.route('**/api/v1/thailand-location/provinces**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(['สงขลา', 'ปัตตานี'])
		})
	);
	await page.route('**/api/v1/thailand-location/districts**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(['หาดใหญ่', 'เมืองสงขลา'])
		})
	);
	await page.route('**/api/v1/thailand-location/subdistricts**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([{ subdistrict: 'คอหงส์', zipcode: 90110 }])
		})
	);
}

/** Pick a shadcn Select option from the shelter trigger (bits Select = button, not combobox). */
async function selectShelter(page: Page, optionLabel: string | RegExp) {
	await page
		.getByRole('button', { name: /เลือกศูนย์พักพิง|ไม่ระบุศูนย์พักพิง|เทศบาล|โรงเรียน/ })
		.first()
		.click();
	await page.getByRole('option', { name: optionLabel }).click();
}

/** Fill domicile via HouseholdAddressFields (SearchSelect triggers use id, not name). */
async function fillAddress(page: Page) {
	await page.locator('#address-no').fill('123/45');
	for (const [id, option] of [
		['province', 'สงขลา'],
		['district', 'หาดใหญ่'],
		['subdistrict', 'คอหงส์']
	] as const) {
		await page.locator(`#${id}`).click();
		await page.getByRole('button', { name: option, exact: true }).click();
	}
}

/** Fill primary contact on UnifiedRegistrationForm (idPrefix member-0). */
async function fillPrimaryMember(
	page: Page,
	opts: { firstName: string; lastName: string; phone: string; gender?: 'male' | 'female' }
) {
	const gender = opts.gender ?? 'male';
	await page.locator('#member-0-first-name').fill(opts.firstName);
	await page.locator('#member-0-last-name').fill(opts.lastName);
	await page.locator(`#member-0-gender-${gender}`).click({ force: true });
	await page.locator('#member-0-phone').fill(opts.phone);
}

/** Open the booking page and wait for the shelter step. */
async function openBooking(page: Page) {
	const pageErrors: string[] = [];
	page.on('pageerror', (err) => {
		pageErrors.push(err.message);
	});

	await page.goto('/');
	await page.evaluate(() => {
		(window as Window & { __captchaToken?: string }).__captchaToken = 'e2e-captcha-token';
	});
	await page
		.getByRole('link', { name: /ลงทะเบียน/ })
		.first()
		.click();
	await page.waitForURL('**/pre-register');
	// Shelter heading lives outside UnifiedRegistrationForm — also require the address
	// field so a props_invalid_value crash in the form cannot look like a green open.
	await expect(page.getByRole('heading', { name: 'ศูนย์พักพิงที่ต้องการเข้าพัก' })).toBeVisible();
	await expect(page.locator('#address-no')).toBeVisible({ timeout: 15_000 });
	expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
	return page;
}

test.describe(
	'Public shelter booking (T-71 / CR-070)',
	{ tag: ['@pre-register', '@regression'] },
	() => {
		test('a failed submit jumps straight to the first invalid field', async ({ page }) => {
			await mockReferenceData(page);
			let posted = false;
			await page.route('**/api/public/v1/registrations', (route) => {
				posted = true;
				return route.abort();
			});

			await openBooking(page);
			await selectShelter(page, /ไม่ระบุศูนย์พักพิง/);
			await fillAddress(page);
			await page.locator('#member-0-first-name').fill('สมชาย');
			await page.locator('#member-0-last-name').fill('ใจดี');
			await page.locator('#member-0-gender-male').click({ force: true });
			await page.getByLabel(/ข้าพเจ้ารับทราบเงื่อนไขการใช้งานระบบ/).check();

			// The sticky summary aside repeats the submit button; use the one in the form body.
			await page.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last().click();

			// No extra "go to field" click needed — the missing phone is focused on submit.
			await expect(page.locator('#member-0-phone')).toBeFocused();
			await expect(page.locator('#member-0-phone')).toBeInViewport();
			expect(posted).toBe(false);
		});

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

			await openBooking(page);

			await page.getByRole('button', { name: /เลือกศูนย์พักพิง|ไม่ระบุศูนย์พักพิง/ }).click();
			// Unassigned + one open shelter (closed shelters omitted).
			await expect(page.getByRole('option')).toHaveCount(2);
			await page.getByRole('option', { name: /เทศบาลนครหาดใหญ่/ }).click();

			await fillAddress(page);
			await fillPrimaryMember(page, {
				firstName: 'สมชาย',
				lastName: 'ใจดี',
				phone: '0812345678'
			});
			// Public head must enter phone — no「ไม่มีเบอร์」checkbox.
			await expect(page.locator('#member-0-no-phone')).toHaveCount(0);

			await page.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last().click();

			await expect(page.getByText('สมชาย ใจดี')).toBeVisible();
			await expect(page.getByAltText('QR สำหรับยืนยันตัวตนที่ประตูศูนย์')).toBeVisible();

			expect(submitted).toMatchObject({
				shelter_code: 'SH001',
				members: [{ first_name: 'สมชาย', last_name: 'ใจดี', gender: 'male', phone: '0812345678' }],
				household: {
					address_no: '123/45',
					province: 'สงขลา',
					district: 'หาดใหญ่',
					subdistrict: 'คอหงส์',
					postal_code: '90110'
				}
			});
		});

		test('adds family members and tags CR-112 vulnerable groups', async ({ page }) => {
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

			await openBooking(page);
			await selectShelter(page, /เทศบาลนครหาดใหญ่/);
			await fillAddress(page);
			await fillPrimaryMember(page, {
				firstName: 'สมชาย',
				lastName: 'ใจดี',
				phone: '0812345678'
			});

			// The vulnerable-group checklist sits in a collapsed accordion on every member card.
			await page
				.getByRole('region', { name: 'ผู้ติดต่อหลัก' })
				.getByRole('button', { name: 'กลุ่มเปราะบาง' })
				.click();
			await expect(page.getByText('ผู้ป่วยติดเตียง').first()).toBeVisible();
			await expect(page.getByText('ผู้สูงอายุช่วยเหลือตัวเองไม่ได้').first()).toBeVisible();

			await page.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
			const member2 = page.getByRole('region', { name: 'สมาชิกคนที่ 2' });
			await expect(member2).toBeVisible();
			await member2.locator('#member-1-first-name').fill('สมหญิง');
			await member2.locator('#member-1-last-name').fill('ใจดี');
			await member2.locator('#member-1-gender-female').click({ force: true });
			// No phone for this member — the field opens ready to type, so say so (roleplay #10).
			await member2.locator('#member-1-no-phone').click();
			await member2.getByRole('button', { name: 'กลุ่มเปราะบาง' }).click();
			await member2.locator('#vg-1-elderly_dependent').click();

			await page.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last().click();
			await expect(page.getByAltText('QR สำหรับยืนยันตัวตนที่ประตูศูนย์')).toBeVisible();

			expect(submitted).toMatchObject({
				members: [
					{ first_name: 'สมชาย', last_name: 'ใจดี', gender: 'male' },
					{
						first_name: 'สมหญิง',
						last_name: 'ใจดี',
						gender: 'female',
						vulnerable_groups: ['elderly_dependent']
					}
				]
			});
		});

		test('hides public head no-phone and offers religion without อื่นๆ', async ({ page }) => {
			await mockReferenceData(page);
			await openBooking(page);
			await selectShelter(page, /เทศบาลนครหาดใหญ่/);

			await expect(page.locator('#member-0-no-phone')).toHaveCount(0);
			await expect(page.locator('#member-0-gender-male')).toBeVisible();
			await expect(page.locator('#member-0-gender-female')).toBeVisible();

			// Open religion select — options are พุทธ / อิสลาม / คริสต์ / ไม่ระบุ
			const religionTrigger = page
				.getByRole('region', { name: 'ผู้ติดต่อหลัก' })
				.locator('button')
				.filter({ hasText: /ไม่ระบุ|พุทธ|อิสลาม|คริสต์/ })
				.first();
			await religionTrigger.click();
			await expect(page.getByRole('option', { name: 'พุทธ' })).toBeVisible();
			await expect(page.getByRole('option', { name: 'อิสลาม' })).toBeVisible();
			await expect(page.getByRole('option', { name: 'คริสต์' })).toBeVisible();
			await expect(page.getByRole('option', { name: 'ไม่ระบุ' })).toBeVisible();
			await expect(page.getByRole('option', { name: /^อื่นๆ$/ })).toHaveCount(0);
			await page.keyboard.press('Escape');
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

			await openBooking(page);
			await selectShelter(page, /เทศบาลนครหาดใหญ่/);
			await fillAddress(page);
			await fillPrimaryMember(page, {
				firstName: 'สมชาย',
				lastName: 'ใจดี',
				phone: '0812345678'
			});

			// The pets section is a collapsed accordion until opened.
			await page
				.locator('#unified-pets')
				.getByRole('button', { name: /^สัตว์เลี้ยง/ })
				.click();
			await page.getByRole('button', { name: 'เพิ่มสุนัข' }).click();
			await page.getByPlaceholder('เช่น ถุงเงิน, เจ้าส้ม, บ๊อบบี้').fill('โกโก้');
			await page.getByPlaceholder(/มีโรคประจำตัว|สายพันธุ์/).fill('ชิวาว่า');
			await page.getByText('มีกรง / สายจูง / ตะกร้า').click();

			await page
				.getByLabel(/ข้าพเจ้ารับทราบและยินยอมปฏิบัติตามเงื่อนไขและมาตรการด้านความปลอดภัย/)
				.check();

			await page.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last().click();
			await expect(page.getByAltText('QR สำหรับยืนยันตัวตนที่ประตูศูนย์')).toBeVisible();

			const household = submitted?.household as { pets?: Array<Record<string, unknown>> };
			expect(household?.pets?.[0]).toMatchObject({
				species: 'dog',
				has_cage: true
			});
			expect(String(household?.pets?.[0]?.notes ?? '')).toContain('โกโก้');
			expect(String(household?.pets?.[0]?.notes ?? '')).toContain('ชิวาว่า');
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

			await openBooking(page);
			await selectShelter(page, /เทศบาลนครหาดใหญ่/);
			await fillAddress(page);
			await fillPrimaryMember(page, {
				firstName: 'สมชาย',
				lastName: 'ใจดี',
				phone: '0812345678'
			});
			await page.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last().click();

			// Server errors surface as toast (booking-form catch); form alert is for client validation.
			await expect(
				page.getByText(/ปิดรับผู้เข้าพัก|ศูนย์.*ปิด|ไม่สามารถ|ไม่สำเร็จ/i).first()
			).toBeVisible({
				timeout: 10_000
			});
		});

		test('the shelter detail CTA opens the form with that shelter preselected', async ({
			page
		}) => {
			await mockReferenceData(page);
			await page.route('**/api/public/v1/shelters/SH001', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ shelter: { ...SHELTERS.shelters[0], id: 'SH001' } })
				})
			);

			await page.goto('/shelters/SH001');
			await page.getByRole('link', { name: 'ลงทะเบียนล่วงหน้าที่ศูนย์นี้' }).first().click();
			await page.waitForURL('**/pre-register?shelter=SH001');

			// /pre-register is a page, not a modal: the shelter is preselected but still changeable.
			const trigger = page.getByRole('button', { name: /เทศบาลนครหาดใหญ่/ });
			await expect(trigger).toBeEnabled();
			await expect(trigger).toContainText('เทศบาลนครหาดใหญ่');
			await expect(page.locator('#address-no')).toBeVisible();
		});

		test('the hero search opens the family-search dialog when the query is empty', async ({
			page
		}) => {
			await mockReferenceData(page);
			await page.route('**/api/public/v1/occupants**', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ results: [] })
				})
			);

			await page.goto('/');
			await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();

			const dialog = page.getByRole('dialog', { name: 'ค้นหาผู้พักพิง' });
			await expect(dialog).toBeVisible();
			await expect(dialog.getByRole('textbox', { name: 'คำค้นหา' })).toBeVisible();
		});
	}
);

test.describe(
	'Public unassigned registration (#255 / CR-113)',
	{ tag: ['@pre-register', '@regression'] },
	() => {
		test('submits no-shelter unified input to Mongo BFF and shows queue QR', async ({ page }) => {
			await mockReferenceData(page);

			let submitted: Record<string, unknown> | null = null;
			await page.route('**/api/public/v1/unassigned-registrations', async (route) => {
				if (route.request().method() !== 'POST') return route.continue();
				submitted = route.request().postDataJSON();
				await route.fulfill({
					status: 201,
					contentType: 'application/json',
					body: JSON.stringify({
						success: true,
						id: '01JUNASSIGNEDREG0000000001',
						schema_v: 2,
						reserved_household_id: 'household:01H',
						members: [
							{
								reserved_evacuee_id: 'evacuee:01H',
								status: 'open',
								first_name: 'สมชาย',
								last_name: 'ใจดี'
							}
						],
						registered_via: 'web',
						status: 'open',
						created_at: '2026-09-09T03:00:00.000Z'
					})
				});
			});

			await page.goto('/');
			await page.evaluate(() => {
				(window as Window & { __captchaToken?: string }).__captchaToken = 'e2e-captcha-token';
			});
			await page
				.getByRole('link', { name: /ลงทะเบียน/ })
				.first()
				.click();
			await page.waitForURL('**/pre-register');
			await expect(
				page.getByRole('heading', { name: 'ศูนย์พักพิงที่ต้องการเข้าพัก' })
			).toBeVisible();

			await page.getByRole('button', { name: /เลือกศูนย์พักพิง|ไม่ระบุศูนย์พักพิง/ }).click();
			await page.getByRole('option', { name: /ไม่ระบุศูนย์พักพิง/ }).click();

			await fillAddress(page);
			await fillPrimaryMember(page, {
				firstName: 'สมชาย',
				lastName: 'ใจดี',
				phone: '0812345678'
			});
			await expect(page.locator('#member-0-no-phone')).toHaveCount(0);

			await page.getByLabel(/ข้าพเจ้ารับทราบเงื่อนไขการใช้งานระบบ/).check();
			await page.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last().click();

			await expect(page.getByText('ลงทะเบียนล่วงหน้าสำเร็จ')).toBeVisible();
			await expect(
				page.getByAltText('QR สำหรับแสดงต่อเจ้าหน้าที่ลงทะเบียนประจำศูนย์')
			).toBeVisible();
			await expect(
				page.getByText('แสดง QR Code นี้ต่อเจ้าหน้าที่ เพื่อรับเข้าศูนย์')
			).toBeVisible();
			// The registration id rides in the QR only — never printed for a human to read.
			await expect(page.getByText('01JUNASSIGNEDREG0000000001')).toHaveCount(0);

			expect(submitted).toMatchObject({
				disclaimerAcknowledged: true,
				members: [{ first_name: 'สมชาย', last_name: 'ใจดี', gender: 'male', phone: '0812345678' }],
				household: { province: 'สงขลา', district: 'หาดใหญ่', subdistrict: 'คอหงส์' }
			});
			expect(String((submitted as { shelter_code?: string } | null)?.shelter_code ?? '')).not.toBe(
				'SH001'
			);
		});
		test.describe('background ticket status sync keeps the queue QR', () => {
			const REG_ID = '01JUNASSIGNEDREG0000000001';
			const TICKET_STORAGE_KEY = 'smartshelter_public_booking_tickets';
			const CLAIMED_TOAST = 'ใบลงทะเบียนได้รับการยืนยันเข้าศูนย์พักพิงแล้ว';

			/** Submit a no-shelter registration (mocked BFF) so a queue ticket lands in localStorage. */
			async function submitUnassigned(page: Page) {
				await mockReferenceData(page);
				await page.route('**/api/public/v1/unassigned-registrations', async (route) => {
					if (route.request().method() !== 'POST') return route.continue();
					await route.fulfill({
						status: 201,
						contentType: 'application/json',
						body: JSON.stringify({
							success: true,
							id: REG_ID,
							schema_v: 3,
							reserved_household_id: 'household:01H',
							members: [
								{
									reserved_evacuee_id: 'evacuee:01H',
									status: 'open',
									first_name: 'สมชาย',
									last_name: 'ใจดี'
								}
							],
							registered_via: 'web',
							status: 'open',
							created_at: '2026-09-09T03:00:00.000Z'
						})
					});
				});
				await openBooking(page);
				await selectShelter(page, /ไม่ระบุศูนย์พักพิง/);
				await fillAddress(page);
				await fillPrimaryMember(page, {
					firstName: 'สมชาย',
					lastName: 'ใจดี',
					phone: '0812345678'
				});
				await page.getByLabel(/ข้าพเจ้ารับทราบเงื่อนไขการใช้งานระบบ/).check();
				await page.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last().click();
				await expect(page.getByText('ลงทะเบียนล่วงหน้าสำเร็จ')).toBeVisible();
				await expect.poll(() => storedCodes(page)).toContain(REG_ID);
			}

			function storedCodes(page: Page) {
				return page.evaluate((key) => {
					try {
						const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as { code: string }[];
						return raw.map((t) => t.code);
					} catch {
						return [];
					}
				}, TICKET_STORAGE_KEY);
			}

			async function openHistoryThenReload(page: Page) {
				await page.getByRole('button', { name: /ใบลงทะเบียนของฉัน/ }).click();
				await page.waitForTimeout(500);
				await page.reload();
				await page.getByRole('button', { name: /ใบลงทะเบียนของฉัน/ }).click();
				await page.waitForTimeout(500);
			}

			const keepsTicket: [string, number, Record<string, unknown>][] = [
				[
					'upstream error (502 STATUS_UNAVAILABLE)',
					502,
					{ success: false, verified: false, error: 'STATUS_UNAVAILABLE' }
				],
				[
					'pending (verified:false, status open)',
					200,
					{ success: true, verified: false, status: 'open' }
				],
				[
					'not found (notFound:true)',
					200,
					{ success: true, verified: false, notFound: true, error: 'BOOKING_NOT_FOUND' }
				]
			];

			for (const [label, status, body] of keepsTicket) {
				test(`ticket survives history tab + reload when status is ${label}`, async ({ page }) => {
					await page.route('**/api/public/v1/registrations/status', (route) =>
						route.fulfill({
							status,
							contentType: 'application/json',
							body: JSON.stringify(body)
						})
					);
					await submitUnassigned(page);

					await openHistoryThenReload(page);

					expect(await storedCodes(page)).toContain(REG_ID);
					await expect(page.getByText(CLAIMED_TOAST)).toHaveCount(0);
				});
			}

			test('ticket is removed and toast shown only when status is verified', async ({ page }) => {
				let verified = false;
				await page.route('**/api/public/v1/registrations/status', (route) =>
					route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({
							success: true,
							verified,
							status: verified ? 'closed' : 'open'
						})
					})
				);
				await submitUnassigned(page);

				verified = true;
				await page.reload();
				await page.getByRole('button', { name: /ใบลงทะเบียนของฉัน/ }).click();

				await expect(page.getByText(CLAIMED_TOAST).first()).toBeVisible();
				await expect.poll(() => storedCodes(page)).not.toContain(REG_ID);
			});
		});
	}
);
