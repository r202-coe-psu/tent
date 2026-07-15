/**
 * E2E Tests: Shelter Excel Import — upload, validation, commit, and history.
 *
 * The external boundaries are mocked: master data supplies deterministic label
 * lookups, shelter creation is intercepted so no databases are provisioned,
 * and the registry import-log document lives in an in-memory CouchDB stub.
 */

import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { createCouchUser, deleteCouchUser, couchLogin, SA_ROLES } from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';

const BASE = 'http://localhost:4173';
const IMPORT_PATH = '/back-office/shelters/import';
const HEADERS = [
	'ชื่อศูนย์พักพิง',
	'สถานะ',
	'ระดับโครงการ',
	'ที่อยู่ตามเขตการปกครอง',
	'ละติจูด',
	'ลองจิจูด',
	'โซนเทศบาล',
	'ชุมชน',
	'บ้านเลขที่',
	'หมู่ที่',
	'จังหวัด',
	'อำเภอ/เขต',
	'ตำบล/แขวง',
	'รหัสไปรษณีย์',
	'ผู้จัดการศูนย์',
	'เบอร์โทรผู้จัดการศูนย์',
	'ความจุสูงสุด (คน)',
	'พื้นที่ใช้สอยรวม (ตร.ม.)',
	'สถานะพื้นที่อาคาร'
];

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
const SA = {
	name: `shelter_import_sa_${RUN_ID}`,
	password: 'Password1!',
	roles: SA_ROLES,
	display_name: 'Shelter Import SA'
};
let session = '';

test.beforeAll(async () => {
	await createCouchUser(SA);
	session = await couchLogin(SA.name, SA.password);
});

test.afterAll(async () => {
	await deleteCouchUser(SA.name);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

async function workbook(rows: string[][], headers = HEADERS): Promise<Buffer> {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('ศูนย์พักพิง');
	ws.addRow(headers);
	rows.forEach((row) => ws.addRow(row));
	return Buffer.from(await wb.xlsx.writeBuffer());
}

async function mockMasterData(page: Page): Promise<void> {
	await page.route('**/api/back-office/master-data/*', async (route) => {
		const type = new URL(route.request().url()).pathname.split('/').pop();
		const items =
			type === 'municipality_zone'
				? [{ code: 'zone_1', label: 'โซน 1' }]
				: type === 'community'
					? [{ code: 'community_1', label: 'ชุมชน 1' }]
					: [];
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ _id: `master_data:${type}`, master_type: type, items })
		});
	});
}

/** Mock registry prefix scans and PUTs so logs are asserted without shared CouchDB state. */
async function mockRegistry(
	page: Page,
	initialLogs: Record<string, unknown>[] = []
): Promise<{ logs: Record<string, unknown>[] }> {
	const logs = [...initialLogs];
	await page.route('**/registry/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.pathname.endsWith('/_all_docs')) {
			const startkey = url.searchParams.get('startkey') ?? '';
			const docs = startkey.includes('shelter_import_log:') ? logs : [];
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ rows: docs.map((doc) => ({ id: doc._id, doc })) })
			});
			return;
		}
		if (request.method() === 'PUT') {
			const doc = request.postDataJSON() as Record<string, unknown>;
			logs.push({ ...doc, _rev: '1-mock' });
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true, id: doc._id, rev: '1-mock' })
			});
			return;
		}
		await route.continue();
	});
	return { logs };
}

async function mockShelterCreate(
	page: Page,
	outcome: (index: number) => { status: number; body: unknown } = (index) => ({
		status: 200,
		body: { ok: true, code: `SH9${index}` }
	})
): Promise<{ bodies: Record<string, unknown>[] }> {
	const bodies: Record<string, unknown>[] = [];
	await page.route('**/api/back-office/shelter', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		bodies.push(route.request().postDataJSON() as Record<string, unknown>);
		const response = outcome(bodies.length);
		await route.fulfill({
			status: response.status,
			contentType: 'application/json',
			body: JSON.stringify(response.body)
		});
	});
	return { bodies };
}

test('imports valid spreadsheet rows, skips invalid rows, and records the outcome', async ({
	page
}) => {
	await mockMasterData(page);
	const registry = await mockRegistry(page);
	const created = await mockShelterCreate(page);
	await injectSession(page, SA, session);
	await page.goto(`${BASE}${IMPORT_PATH}`);

	await expect(page.getByRole('heading', { name: 'นำเข้าศูนย์พักพิงจาก Excel' })).toBeVisible();
	await expect(page.getByText('ยังไม่มีประวัติการนำเข้า')).toBeVisible();

	const valid = Array(HEADERS.length).fill('');
	valid[0] = 'ศูนย์พักพิง E2E พร้อมนำเข้า';
	valid[1] = 'เตรียมพร้อม';
	valid[6] = 'โซน 1';
	valid[7] = 'ชุมชน 1';
	valid[16] = '120';
	const invalid = Array(HEADERS.length).fill('');
	invalid[0] = 'ศูนย์พักพิง E2E ผิดพลาด';
	invalid[16] = '';

	await page.locator('input[type="file"]').setInputFiles({
		name: 'shelters-e2e.xlsx',
		mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		buffer: await workbook([valid, invalid])
	});

	await expect(page.getByText('shelters-e2e.xlsx')).toBeVisible();
	await expect(page.getByText('พร้อมนำเข้า 1')).toBeVisible();
	await expect(
		page.getByText('· 2 แถว · พร้อมนำเข้า 1 · ผิดพลาด 1', { exact: true })
	).toBeVisible();
	await expect(page.getByText('ต้องระบุความจุสูงสุด (คน)')).toBeVisible();
	await expect(page.getByRole('button', { name: 'นำเข้า 1 ศูนย์' })).toBeEnabled();

	await page.getByRole('button', { name: 'นำเข้า 1 ศูนย์' }).click();

	await expect(page.getByText(/นำเข้าสำเร็จ 1 แห่ง, ล้มเหลว 1 แถว/)).toBeVisible();
	expect(created.bodies).toHaveLength(1);
	expect(created.bodies[0]).toMatchObject({
		name: 'ศูนย์พักพิง E2E พร้อมนำเข้า',
		capacity: 120,
		municipality_zone: 'zone_1',
		community: 'community_1'
	});
	expect(registry.logs).toHaveLength(1);
	expect(registry.logs[0]).toMatchObject({
		filename: 'shelters-e2e.xlsx',
		imported_by: SA.name,
		total_rows: 2,
		success_count: 1,
		error_count: 1
	});
	await expect(page.getByText('SH91')).toBeVisible();
	await expect(page.getByText('แถว 2')).toBeVisible();
});

test('records a server error and continues importing later valid rows', async ({ page }) => {
	await mockMasterData(page);
	const registry = await mockRegistry(page);
	const created = await mockShelterCreate(page, (index) =>
		index === 1
			? { status: 409, body: { error: { code: 'DUPLICATE', message: 'ชื่อศูนย์ซ้ำ' } } }
			: { status: 200, body: { ok: true, code: 'SH92' } }
	);
	await injectSession(page, SA, session);
	await page.goto(`${BASE}${IMPORT_PATH}`);

	const first = Array(HEADERS.length).fill('');
	first[0] = 'ศูนย์พักพิง E2E ซ้ำ';
	first[16] = '50';
	const second = Array(HEADERS.length).fill('');
	second[0] = 'ศูนย์พักพิง E2E แถวถัดไป';
	second[16] = '75';

	await page.locator('input[type="file"]').setInputFiles({
		name: 'server-error.xlsx',
		mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		buffer: await workbook([first, second])
	});
	await page.getByRole('button', { name: 'นำเข้า 2 ศูนย์' }).click();

	await expect(page.getByText(/นำเข้าสำเร็จ 1 แห่ง, ล้มเหลว 1 แถว/)).toBeVisible();
	expect(created.bodies).toHaveLength(2);
	expect(registry.logs).toHaveLength(1);
	expect(registry.logs[0]).toMatchObject({ success_count: 1, error_count: 1 });
	expect(registry.logs[0].results).toEqual([
		{
			row: 1,
			name: 'ศูนย์พักพิง E2E ซ้ำ',
			status: 'server_error',
			errors: [{ column: '-', message: 'ชื่อศูนย์ซ้ำ' }]
		},
		{ row: 2, name: 'ศูนย์พักพิง E2E แถวถัดไป', status: 'created', code: 'SH92' }
	]);
	await expect(page.getByText('ชื่อศูนย์ซ้ำ')).toBeVisible();
	await expect(page.getByText('SH92')).toBeVisible();
});

test('does not submit or log an all-invalid workbook', async ({ page }) => {
	await mockMasterData(page);
	const registry = await mockRegistry(page);
	const created = await mockShelterCreate(page);
	await injectSession(page, SA, session);
	await page.goto(`${BASE}${IMPORT_PATH}`);

	const invalid = Array(HEADERS.length).fill('');
	invalid[0] = 'ศูนย์พักพิง E2E ไม่มีความจุ';
	await page.locator('input[type="file"]').setInputFiles({
		name: 'all-invalid.xlsx',
		mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		buffer: await workbook([invalid])
	});

	await expect(page.getByText('พร้อมนำเข้า 0')).toBeVisible();
	await expect(page.getByRole('button', { name: 'นำเข้า 0 ศูนย์' })).toBeDisabled();
	expect(created.bodies).toHaveLength(0);
	expect(registry.logs).toHaveLength(0);
});

test('warns for empty or unrecognized workbooks and reports unreadable files', async ({ page }) => {
	await mockMasterData(page);
	await mockRegistry(page);
	await injectSession(page, SA, session);
	await page.goto(`${BASE}${IMPORT_PATH}`);

	const input = page.locator('input[type="file"]');
	await input.setInputFiles({
		name: 'empty.xlsx',
		mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		buffer: await workbook([])
	});
	await expect(page.getByText('ไม่พบข้อมูลในไฟล์')).toBeVisible();
	await page.getByRole('button', { name: 'ล้างไฟล์' }).click();

	await input.setInputFiles({
		name: 'unrecognized.xlsx',
		mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		buffer: await workbook([['ข้อมูล']], ['คอลัมน์อื่น'])
	});
	await expect(page.getByText('ไม่พบข้อมูลในไฟล์')).toBeVisible();
	await page.getByRole('button', { name: 'ล้างไฟล์' }).click();

	await input.setInputFiles({
		name: 'broken.xlsx',
		mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		buffer: Buffer.from('not an xlsx file')
	});
	await expect(page.getByText('อ่านไฟล์ไม่สำเร็จ — ตรวจสอบว่าเป็นไฟล์ .xlsx ที่ถูกต้อง')).toBeVisible();
	await expect(page.getByText('เลือกไฟล์ .xlsx')).toBeVisible();
});

test('renders import history that existed before the current visit', async ({ page }) => {
	await mockMasterData(page);
	await mockRegistry(page, [
		{
			_id: 'shelter_import_log:01HISTORY',
			type: 'shelter_import_log',
			filename: 'previous-import.xlsx',
			imported_by: 'previous_admin',
			total_rows: 2,
			success_count: 1,
			error_count: 1,
			finished_at: '2026-07-15T00:00:00.000Z',
			results: [
				{ row: 1, name: 'ศูนย์เดิม', status: 'created', code: 'SH777' },
				{
					row: 2,
					name: 'ศูนย์ผิดพลาด',
					status: 'server_error',
					errors: [{ column: '-', message: 'สร้างไม่สำเร็จ' }]
				}
			]
		}
	]);
	await injectSession(page, SA, session);
	await page.goto(`${BASE}${IMPORT_PATH}`);

	await expect(page.getByText('previous-import.xlsx')).toBeVisible();
	await expect(page.getByText('SH777')).toBeVisible();
	await expect(page.getByText('แถว 2')).toBeVisible();
	await expect(page.getByText('สร้างไม่สำเร็จ')).toBeVisible();
});
