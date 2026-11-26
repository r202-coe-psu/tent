/**
 * Staff sign-in, sign-out and route guards — UAT-010, 011, 012, 014, 016.
 * Spec: docs/features (FR-1 auth), CR-141 (sign-in methods), src/lib/guards/auth.ts.
 *
 * UAT-010/011 name `/login`, but since CR-141 `/login` shows the password form only when
 * the public API turns password login on; ThaiD / Google cannot be driven by a test. The
 * password form is checked on `/admin-login`, which always shows it.
 */
import { shelterCodes } from '../../lib/env.ts';
import { PASSWORD_LOGIN, checkpoint, expect, signIn, test } from '../fixtures.ts';

const SHELTER = shelterCodes().a;
const scoped = (role: string) => [`shelter:${SHELTER}`, `${SHELTER}:${role}`];
const ON_LOGIN_PAGE = /\/(login|admin-login)$/;

test('UAT-010 staff signs in with the right password and lands on /portal', async ({
	page,
	staffAccount
}, testInfo) => {
	const account = await staffAccount('reg010', scoped('registration_staff'), 'ทดสอบ เจ้าหน้าที่ทะเบียน');

	await page.goto('/login');
	await expect(page.getByText('เข้าสู่ระบบหลังบ้าน').first()).toBeVisible();
	await checkpoint(page, testInfo, 'login-page-sign-in-options');

	await page.goto(PASSWORD_LOGIN);
	await expect(page.getByLabel('Username')).toBeVisible();
	await checkpoint(page, testInfo, 'login-form');

	await page.getByLabel('Username').fill(account.name);
	await page.getByLabel('Password').fill(account.password);
	await checkpoint(page, testInfo, 'credentials-filled');
	await page.getByRole('button', { name: 'Login' }).click();

	await expect(page).toHaveURL(/\/portal$/);
	await expect(page.getByText('เข้าสู่ระบบสำเร็จ!')).toBeVisible();
	await expect(page.getByText('ทดสอบ เจ้าหน้าที่ทะเบียน').first()).toBeVisible();
	await checkpoint(page, testInfo, 'portal-after-login');
});

test('UAT-011 a wrong password shows an error and keeps the user out', async ({
	page,
	staffAccount
}, testInfo) => {
	const account = await staffAccount('reg011', scoped('registration_staff'));

	await page.goto(PASSWORD_LOGIN);
	await page.getByLabel('Username').fill(account.name);
	await page.getByLabel('Password').fill(`${account.password}-wrong`);
	await page.getByRole('button', { name: 'Login' }).click();

	await expect(page.getByRole('alert').filter({ hasText: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' })).toBeVisible();
	await expect(page).toHaveURL(ON_LOGIN_PAGE);
	await checkpoint(page, testInfo, 'wrong-password-error');

	await page.goto('/portal');
	await expect(page).toHaveURL(/\/login$/);
	await checkpoint(page, testInfo, 'portal-still-locked');
});

test('UAT-012 an anonymous visitor is sent to /login from a protected page', async ({
	page
}, testInfo) => {
	await page.goto('/back-office/evacuee-management');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByText('เข้าสู่ระบบหลังบ้าน').first()).toBeVisible();
	await checkpoint(page, testInfo, 'evacuee-management-redirected');

	await page.goto('/portal');
	await expect(page).toHaveURL(/\/login$/);
	await checkpoint(page, testInfo, 'portal-redirected');
});

test('UAT-014 staff signs out from the account menu and loses access', async ({
	page,
	staffAccount
}, testInfo) => {
	const account = await staffAccount('sm014', scoped('shelter_manager'), 'ทดสอบ ผู้จัดการศูนย์');
	await signIn(page, account);
	await expect(page).toHaveURL(/\/portal$/);
	await checkpoint(page, testInfo, 'signed-in');

	await page.getByRole('button', { name: 'ทดสอบ ผู้จัดการศูนย์' }).first().click();
	await checkpoint(page, testInfo, 'account-menu-open');
	await page.getByRole('menuitem', { name: 'ออกจากระบบ' }).click();

	await expect(page).toHaveURL(/\/$/);
	await checkpoint(page, testInfo, 'after-logout');

	await page.goto('/portal');
	await expect(page).toHaveURL(/\/login$/);
	await checkpoint(page, testInfo, 'portal-locked-after-logout');
});

for (const role of ['registration_staff', 'kitchen_staff', 'warehouse_staff'] as const) {
	test(`UAT-016 ${role} is turned away from system management`, async ({
		page,
		staffAccount
	}, testInfo) => {
		const account = await staffAccount(`sm016_${role}`, scoped(role));
		await signIn(page, account);
		await expect(page).toHaveURL(/\/portal$/);

		for (const path of ['/portal/system-management', '/system-management/users']) {
			await page.goto(path);
			await expect(page, `${path} must not open for ${role}`).toHaveURL(/\/portal$/);
			await checkpoint(page, testInfo, `blocked${path.replaceAll('/', '-')}`);
		}
	});
}
