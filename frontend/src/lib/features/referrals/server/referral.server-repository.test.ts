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

describe('CouchDbReferralServerRepository capacity destination-gated accept', () => {
	let repo: CouchDbReferralServerRepository;

	beforeEach(() => {
		vi.clearAllMocks();
		repo = new CouchDbReferralServerRepository('shelter_sh002');
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
		expect(putCalls.length).toBe(4);

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

	it('skips duplicate dest write when dest already active and only finishes source', async () => {
		const evacuee = activeEvacuee();
		const destActive = activeEvacuee({
			shelter_code: 'SH002',
			_rev: '2-dest'
		});
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded.includes('/shelter_sh001/evacuee:')) {
				return { status: 200, data: evacuee };
			}
			if (method === 'GET' && decoded.includes('/shelter_sh002/evacuee:')) {
				return { status: 200, data: destActive };
			}
			if (method === 'PUT') {
				return { status: 201, data: { ok: true, id: 'x', rev: '3-new' } };
			}
			return { status: 500, data: { error: 'unexpected', path, method } };
		});

		await repo.completeCapacityTransfer(capacitySent, 'Staff B', '2026-07-24T04:00:00.000Z');

		const putCalls = adminRaw.mock.calls.filter((c) => c[1] === 'PUT');
		expect(putCalls.length).toBe(2); // source movement + source evacuee only
		expect(
			putCalls.every((c) => decodeURIComponent(String(c[0])).startsWith('/shelter_sh001/'))
		).toBe(true);
	});

	it('rejects capacity accept when actor is source shelter (403)', async () => {
		const sourceRepo = new CouchDbReferralServerRepository('shelter_sh001');
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded.includes('referral:01CAPACITY')) {
				return { status: 200, data: capacitySent };
			}
			return { status: 500, data: { error: 'unexpected', path, method } };
		});

		await expect(
			sourceRepo.transition('referral:01CAPACITY', 'accepted', 'Staff A', 'nope', 'SH001')
		).rejects.toMatchObject({
			status: 403,
			message: expect.stringMatching(/destination shelter/i)
		});
	});

	it('mirrors referral into destination DB on sent', async () => {
		const sourceRepo = new CouchDbReferralServerRepository('shelter_sh001');
		const draft: Referral = {
			...capacitySent,
			status: 'draft',
			timeline: {},
			_rev: '1-draft'
		};

		adminRaw.mockImplementation(async (path: string, method: string, body?: unknown) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded.includes('/shelter_sh001/referral:')) {
				return { status: 200, data: draft };
			}
			if (method === 'GET' && decoded.includes('/shelter_sh002/referral:')) {
				return { status: 404, data: { error: 'not_found' } };
			}
			if (method === 'PUT') {
				return { status: 201, data: { ok: true, id: 'referral:01CAPACITY', rev: '2-x' } };
			}
			return { status: 500, data: { path, method, body } };
		});

		const saved = await sourceRepo.transition(
			'referral:01CAPACITY',
			'sent',
			'Staff A',
			undefined,
			'SH001'
		);
		expect(saved.status).toBe('sent');

		const destMirrorPut = adminRaw.mock.calls.find(
			(c) =>
				c[1] === 'PUT' && decodeURIComponent(String(c[0])).startsWith('/shelter_sh002/referral:')
		);
		expect(destMirrorPut?.[2]).toEqual(
			expect.objectContaining({
				_id: 'referral:01CAPACITY',
				status: 'sent',
				shelter_code: 'SH001',
				to_shelter_code: 'SH002'
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
