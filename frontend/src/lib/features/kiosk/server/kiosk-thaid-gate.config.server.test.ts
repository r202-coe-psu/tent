import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isKioskThaidCheckInAllowed } from './kiosk-thaid-gate.server';
import { adminRaw } from '$lib/server/couch-admin';
import { findMasterByCode } from '$lib/server/shelters.admin';

vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$env/dynamic/private', () => ({
	env: { THAID_OAUTH_CLIENT_ID: 'client-id', THAID_OAUTH_CLIENT_SECRET: 'client-secret' }
}));
vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));
vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));

const mockAdminRaw = vi.mocked(adminRaw);
const mockFindShelter = vi.mocked(findMasterByCode);

// Real system gate, mocked I/O boundaries: FR-KTD-13 "cannot read config:app -> 403".
describe('isKioskThaidCheckInAllowed with an unreadable config:app (FR-KTD-13)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFindShelter.mockResolvedValue({
			code: 'SH001',
			feature_flags: { kiosk_thaid_check_in_enabled: true }
		} as never);
	});

	it('allows when config:app is readable and ThaiD is configured', async () => {
		mockAdminRaw.mockResolvedValue({ status: 200, data: { thaid_registration_enabled: true } });
		await expect(isKioskThaidCheckInAllowed('SH001')).resolves.toBe(true);
	});

	it('denies when the config:app read throws', async () => {
		mockAdminRaw.mockRejectedValue(new Error('couch down'));
		await expect(isKioskThaidCheckInAllowed('SH001')).resolves.toBe(false);
	});

	it('denies when config:app answers with a server error status', async () => {
		mockAdminRaw.mockResolvedValue({ status: 500, data: {} });
		await expect(isKioskThaidCheckInAllowed('SH001')).resolves.toBe(false);
	});
});
