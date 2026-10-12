import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isKioskThaidCheckInAllowed } from './kiosk-thaid-gate.server';
import { isThaidRegistrationEnabled } from '$lib/server/thaid-registration-gate';
import { findMasterByCode } from '$lib/server/shelters.admin';

vi.mock('$lib/server/thaid-registration-gate', () => ({ isThaidRegistrationEnabled: vi.fn() }));
vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));

const mockSystemGate = vi.mocked(isThaidRegistrationEnabled);
const mockFindShelter = vi.mocked(findMasterByCode);

const shelterWith = (enabled: unknown) =>
	({ code: 'SH001', feature_flags: { kiosk_thaid_check_in_enabled: enabled } }) as never;

describe('isKioskThaidCheckInAllowed (FR-KTD-13)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSystemGate.mockResolvedValue({ enabled: true, isDev: false, mode: 'real' });
		mockFindShelter.mockResolvedValue(shelterWith(true));
	});

	it('allows when system ThaiD is enabled in real mode and the shelter flag is on', async () => {
		await expect(isKioskThaidCheckInAllowed('SH001')).resolves.toBe(true);
		expect(mockFindShelter).toHaveBeenCalledWith('SH001');
	});

	it('denies when the system flag is off', async () => {
		mockSystemGate.mockResolvedValue({ enabled: false, isDev: false, mode: 'real' });
		await expect(isKioskThaidCheckInAllowed('SH001')).resolves.toBe(false);
	});

	it('denies in mock mode even when enabled', async () => {
		mockSystemGate.mockResolvedValue({ enabled: true, isDev: true, mode: 'mock' });
		await expect(isKioskThaidCheckInAllowed('SH001')).resolves.toBe(false);
	});

	it.each([
		['flag false', shelterWith(false)],
		['flag missing', { code: 'SH001', feature_flags: {} } as never],
		['flag not strictly true', shelterWith('true')],
		['shelter missing', null as never]
	])('denies when shelter has %s', async (_label, shelter) => {
		mockFindShelter.mockResolvedValue(shelter);
		await expect(isKioskThaidCheckInAllowed('SH001')).resolves.toBe(false);
	});

	it('fails closed when the system gate throws', async () => {
		mockSystemGate.mockRejectedValue(new Error('couch down'));
		await expect(isKioskThaidCheckInAllowed('SH001')).resolves.toBe(false);
	});

	it('fails closed when the shelter lookup throws', async () => {
		mockFindShelter.mockRejectedValue(new Error('registry unavailable'));
		await expect(isKioskThaidCheckInAllowed('SH001')).resolves.toBe(false);
	});

	it('uses a pre-fetched shelter instead of reading it again', async () => {
		await expect(isKioskThaidCheckInAllowed('SH001', { shelter: shelterWith(true) })).resolves.toBe(
			true
		);
		await expect(
			isKioskThaidCheckInAllowed('SH001', { shelter: shelterWith(false) })
		).resolves.toBe(false);
		await expect(isKioskThaidCheckInAllowed('SH001', { shelter: null })).resolves.toBe(false);
		expect(mockFindShelter).not.toHaveBeenCalled();
	});

	it('asks the system gate to fail closed when config:app cannot be read', async () => {
		await isKioskThaidCheckInAllowed('SH001');
		expect(mockSystemGate).toHaveBeenCalledWith({ onConfigError: 'deny' });
	});
});
