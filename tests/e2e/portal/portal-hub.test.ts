/**
 * Which departments (ฝ่าย) each role sees on /portal — UAT-020, 021, 022.
 *
 * The UAT rows still describe the old hub of four cards (ระบบส่วนหน้า / เว็บพอร์ทัลสาธารณะ /
 * ระบบส่วนกลาง / ระบบส่วนหลัง). The hub is now grouped by department (decision sync 2026-10-10,
 * docs/prd/role-permission-matrix.md §3), so the same intent is checked on departments:
 *   - SA sees ส่วนกลาง (central settings) and the shelter departments;
 *   - SM sees ฝ่ายบริหารศูนย์ (which holds ระบบหลังบ้าน) but not ส่วนกลาง;
 *   - REG / KS / WS see their own department and neither ฝ่ายบริหารศูนย์ nor ส่วนกลาง.
 * Every signed-in role also sees the public website link.
 */
import { shelterCodes } from '../../lib/env.ts';
import { checkpoint, expect, signIn, test } from '../fixtures.ts';

const SHELTER = shelterCodes().a;

const CENTRAL = 'ส่วนกลาง';
const MANAGEMENT = 'ฝ่ายบริหารศูนย์';
const REGISTRATION = 'ฝ่ายทะเบียน';
const KITCHEN = 'ฝ่ายครัว';
const SUPPLY = 'ฝ่ายพัสดุและคลัง';
const PUBLIC_LINK = 'เว็บไซต์บริการประชาชน';

type Case = {
	uat: string;
	label: string;
	roles: string[];
	sees: string[];
	doesNotSee: string[];
};

const CASES: Case[] = [
	{
		uat: 'UAT-020',
		label: 'system_admin',
		roles: ['system_admin'],
		sees: [CENTRAL, MANAGEMENT, REGISTRATION, KITCHEN, SUPPLY],
		doesNotSee: []
	},
	{
		uat: 'UAT-021',
		label: 'shelter_manager',
		roles: [`shelter:${SHELTER}`, `${SHELTER}:shelter_manager`],
		sees: [MANAGEMENT, REGISTRATION, KITCHEN, SUPPLY],
		doesNotSee: [CENTRAL]
	},
	{
		uat: 'UAT-022',
		label: 'registration_staff',
		roles: [`shelter:${SHELTER}`, `${SHELTER}:registration_staff`],
		sees: [REGISTRATION],
		doesNotSee: [CENTRAL, MANAGEMENT, KITCHEN, SUPPLY]
	},
	{
		uat: 'UAT-022',
		label: 'kitchen_staff',
		roles: [`shelter:${SHELTER}`, `${SHELTER}:kitchen_staff`],
		sees: [KITCHEN],
		// Kitchen requisition sits in ฝ่ายพัสดุและคลัง too (KS + SC), so supply is not asserted.
		doesNotSee: [CENTRAL, MANAGEMENT, REGISTRATION]
	},
	{
		uat: 'UAT-022',
		label: 'warehouse_staff',
		roles: [`shelter:${SHELTER}`, `${SHELTER}:warehouse_staff`],
		sees: [SUPPLY],
		// Kitchen requisition sits in ฝ่ายครัว too (KS + SC), so kitchen is not asserted.
		doesNotSee: [CENTRAL, MANAGEMENT, REGISTRATION]
	}
];

for (const c of CASES) {
	test(`${c.uat} ${c.label} sees ${c.sees.join(', ')}${
		c.doesNotSee.length ? ` and not ${c.doesNotSee.join(', ')}` : ''
	}`, async ({ page, staffAccount }, testInfo) => {
		const account = await staffAccount(`portal_${c.label}`, c.roles);
		await signIn(page, account);
		await expect(page).toHaveURL(/\/portal$/);
		await expect(page.getByRole('link', { name: PUBLIC_LINK })).toBeVisible();

		const department = (name: string) => page.getByRole('heading', { level: 2, name, exact: true });
		for (const name of c.sees) {
			await expect(department(name), `${c.label} should see ${name}`).toBeVisible();
		}
		for (const name of c.doesNotSee) {
			await expect(department(name), `${c.label} should not see ${name}`).toHaveCount(0);
		}
		await checkpoint(page, testInfo, `portal-${c.label}`);
	});
}
