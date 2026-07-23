import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CouchDbReferralServerRepository } from './referral.server-repository';
import type { Referral } from '../domain/referral.schema';
import type { Evacuee } from '$lib/features/people/domain/people';

const adminRaw = vi.fn();

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: (...args: unknown[]) => adminRaw(...args)
}));

function activeEvacuee(overrides: Partial<Evacuee> = {}): Evacuee {
	return {
		_id: 'evacuee:01F8MECHEVACUEEID1234567',
		_rev: '1-abc',
		type: 'evacuee',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: '2026-07-11T05:00:00.000Z',
		updated_at: '2026-07-11T05:00:00.000Z',
		created_by: 'Staff A',
		first_name: 'John',
		last_name: 'Doe',
		gender: 'male',
		phone: '0812345678',
		country: 'THAILAND',
		special_needs: [],
		household_id: null,
		current_stay: { status: 'active', zone: 'A', since: '2026-07-11T05:00:00.000Z' },
		privacy: { search_excluded: false },
		registered_via: 'app',
		...overrides
	} as Evacuee;
}

const capacitySent: Referral = {
	_id: 'referral:01CAPACITY',
	_rev: '1-ref',
	type: 'referral',
	schema_v: 1,
	shelter_code: 'SH001',
	created_at: '2026-07-11T05:00:00.000Z',
	updated_at: '2026-07-11T05:00:00.000Z',
	created_by: 'Staff A',
	evacuee_id: 'evacuee:01F8MECHEVACUEEID1234567',
	referral_type: 'capacity',
	to_shelter_code: 'SH002',
	reason: 'Full',
	urgency: 'normal',
	status: 'sent',
	timeline: { sent: { at: '2026-07-11T05:00:00.000Z', by: 'Staff A' } }
};

describe('CouchDbReferralServerRepository.completeCapacityTransfer', () => {
	let repo: CouchDbReferralServerRepository;

	beforeEach(() => {
		vi.clearAllMocks();
		repo = new CouchDbReferralServerRepository('shelter_sh001');
	});

	it('writes dest intake then source transfer_out without rewriting source shelter_code', async () => {
		const evacuee = activeEvacuee();
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded.includes('/shelter_sh001/evacuee:')) {
				return { status: 200, data: evacuee };
			}
			if (method === 'GET' && decoded.includes('/shelter_sh002/evacuee:')) {
				return { status: 404, data: { error: 'not_found' } };
			}
			if (method === 'PUT') {
				return { status: 201, data: { ok: true, id: 'x', rev: '2-new' } };
			}
			return { status: 500, data: { error: 'unexpected', path, method } };
		});

		await repo.completeCapacityTransfer(capacitySent, 'Staff B', '2026-07-24T04:00:00.000Z', 'ok');

		const putCalls = adminRaw.mock.calls.filter((c) => c[1] === 'PUT');
		expect(putCalls.length).toBe(4); // dest evacuee, dest movement, source movement, source evacuee

		const destEvacueePut = putCalls.find((c) =>
			decodeURIComponent(String(c[0])).startsWith('/shelter_sh002/evacuee:')
		);
		const sourceEvacueePut = putCalls.find((c) =>
			decodeURIComponent(String(c[0])).startsWith('/shelter_sh001/evacuee:')
		);
		expect(destEvacueePut?.[2]).toEqual(
			expect.objectContaining({
				shelter_code: 'SH002',
				current_stay: expect.objectContaining({ status: 'active' })
			})
		);
		expect(sourceEvacueePut?.[2]).toEqual(
			expect.objectContaining({
				shelter_code: 'SH001',
				current_stay: expect.objectContaining({ status: 'transferred' })
			})
		);
	});

	it('fail-fast when source evacuee missing', async () => {
		adminRaw.mockResolvedValue({ status: 404, data: { error: 'not_found' } });

		await expect(
			repo.completeCapacityTransfer(capacitySent, 'Staff B', '2026-07-24T04:00:00.000Z')
		).rejects.toThrow(/not found/);

		expect(adminRaw.mock.calls.every((c) => c[1] !== 'PUT')).toBe(true);
	});
});
