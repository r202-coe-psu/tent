/**
 * Shared mocks for the volunteer portal scan / "จดจำเครื่องนี้" e2e (#625).
 */
import type { Page } from '@playwright/test';

export const BASE = 'http://localhost:4173';
export const TOKEN = 'TKT-VOL-0123456789ABCDEF0123456789ABCDEF';
export const PORTAL_ID = 'P-SCAN-E2E';
export const REMEMBER_KEY = 'volunteer-portal-remembered';
export const DASHBOARD = new RegExp(`/volunteers/portal/volunteer/${PORTAL_ID}/dashboard$`);

const PROFILE = {
	first_name: 'สแกน',
	last_name: 'ทดสอบ',
	nickname: null,
	phone_masked: '08x-xxx-1111',
	email: null,
	volunteer_code: 'V-SCAN',
	skills: [],
	organization: null,
	identity_verified: true,
	personnel_type: 'volunteer',
	shelter_codes: ['SH001'],
	portal_id: PORTAL_ID
};

const ok = (body: unknown) => ({
	status: 200,
	contentType: 'application/json',
	body: JSON.stringify(body)
});

/**
 * Mock the portal BFF. `known()` decides whether the server still recognises the
 * token — flip it to model a revoked / reissued token. Returns the resolve calls.
 */
export async function mockPortal(page: Page, known: () => boolean = () => true) {
	const resolveCalls: unknown[] = [];
	await page.route('**/api/public/v1/volunteer/access/resolve', async (route) => {
		resolveCalls.push(route.request().postDataJSON());
		await route.fulfill(ok({ profile: known() ? PROFILE : null }));
	});
	await page.route('**/api/public/v1/volunteer/profile', (route) =>
		route.fulfill(ok({ profile: known() ? PROFILE : null }))
	);
	await page.route('**/api/public/v1/volunteer/schedule', (route) =>
		route.fulfill(ok({ shifts: [], schedule: [] }))
	);
	await page.route('**/api/public/v1/volunteer/ticket/find', (route) =>
		route.fulfill(ok({ tickets: [], phone_masked: '' }))
	);
	return resolveCalls;
}

export const remembered = (page: Page) =>
	page.evaluate((key) => localStorage.getItem(key), REMEMBER_KEY);
