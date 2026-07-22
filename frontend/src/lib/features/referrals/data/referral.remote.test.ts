import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReferralRemoteRepository } from './referral.remote';
import type { Referral } from '../domain/referral.schema';

// Mock DB Repository and People Repository
const mockRepoPut = vi.fn();
const mockRepoGet = vi.fn();

vi.mock('$lib/db/repository', () => ({
	createRemoteRepository: () => ({
		get: mockRepoGet,
		put: mockRepoPut,
		find: vi.fn()
	})
}));

const mockGetEvacuee = vi.fn();
const mockUpdateEvacuee = vi.fn();

vi.mock('$lib/features/people', () => ({
	peopleRepository: () => ({
		getEvacuee: mockGetEvacuee,
		updateEvacuee: mockUpdateEvacuee
	})
}));

describe('ReferralRemoteRepository (Fail-Fast Capacity Transfer B-1 Fix)', () => {
	let repo: ReferralRemoteRepository;

	beforeEach(() => {
		vi.clearAllMocks();
		repo = new ReferralRemoteRepository('shelter_sh001');
	});

	it('should successfully complete capacity transfer and transition when evacuee exists', async () => {
		const mockCapacityReferral: Referral = {
			_id: 'referral:01F8MECHEXAMPLEDOCID12345',
			type: 'referral',
			schema_v: 1,
			shelter_code: 'SH001',
			created_at: '2026-07-11T05:00:00.000Z',
			updated_at: '2026-07-11T05:00:00.000Z',
			created_by: 'Staff A',
			evacuee_id: 'evacuee:01F8MECHEVACUEEID1234567',
			referral_type: 'capacity',
			to_shelter_code: 'SH002',
			reason: 'Shelter capacity full',
			urgency: 'normal',
			status: 'sent',
			timeline: { sent: { at: '2026-07-11T05:00:00.000Z', by: 'Staff A' } }
		};

		mockRepoGet.mockResolvedValue(mockCapacityReferral);
		mockGetEvacuee.mockResolvedValue({
			_id: 'evacuee:01F8MECHEVACUEEID1234567',
			first_name: 'John',
			last_name: 'Doe',
			shelter_code: 'SH001'
		});
		mockUpdateEvacuee.mockResolvedValue({ ok: true });
		mockRepoPut.mockImplementation((doc) => Promise.resolve(doc));

		const result = await repo.transition(
			'referral:01F8MECHEXAMPLEDOCID12345',
			'accepted',
			'Staff B',
			'Accepted by SH002'
		);

		expect(mockGetEvacuee).toHaveBeenCalledWith('evacuee:01F8MECHEVACUEEID1234567');
		expect(mockUpdateEvacuee).toHaveBeenCalledWith(
			expect.objectContaining({
				shelter_code: 'SH002'
			})
		);
		expect(mockRepoPut).toHaveBeenCalled();
		expect(result.status).toBe('accepted');
		expect(result.response_reason).toBe('Accepted by SH002');
	});

	it('should fail-fast and throw error when evacuee is not found, without marking referral accepted', async () => {
		const mockCapacityReferral: Referral = {
			_id: 'referral:01F8MECHEXAMPLEDOCID12345',
			type: 'referral',
			schema_v: 1,
			shelter_code: 'SH001',
			created_at: '2026-07-11T05:00:00.000Z',
			updated_at: '2026-07-11T05:00:00.000Z',
			created_by: 'Staff A',
			evacuee_id: 'evacuee:MISSING_ID',
			referral_type: 'capacity',
			to_shelter_code: 'SH002',
			reason: 'Shelter capacity full',
			urgency: 'normal',
			status: 'sent',
			timeline: { sent: { at: '2026-07-11T05:00:00.000Z', by: 'Staff A' } }
		};

		mockRepoGet.mockResolvedValue(mockCapacityReferral);
		mockGetEvacuee.mockResolvedValue(null);

		await expect(
			repo.transition('referral:01F8MECHEXAMPLEDOCID12345', 'accepted', 'Staff B')
		).rejects.toThrow('Evacuee evacuee:MISSING_ID not found — cannot complete shelter transfer');

		// Verification: repo.put must NOT have been called
		expect(mockRepoPut).not.toHaveBeenCalled();
	});

	it('should fail-fast and propagate network/DB error from updateEvacuee, without updating referral', async () => {
		const mockCapacityReferral: Referral = {
			_id: 'referral:01F8MECHEXAMPLEDOCID12345',
			type: 'referral',
			schema_v: 1,
			shelter_code: 'SH001',
			created_at: '2026-07-11T05:00:00.000Z',
			updated_at: '2026-07-11T05:00:00.000Z',
			created_by: 'Staff A',
			evacuee_id: 'evacuee:01F8MECHEVACUEEID1234567',
			referral_type: 'capacity',
			to_shelter_code: 'SH002',
			reason: 'Shelter capacity full',
			urgency: 'normal',
			status: 'sent',
			timeline: { sent: { at: '2026-07-11T05:00:00.000Z', by: 'Staff A' } }
		};

		mockRepoGet.mockResolvedValue(mockCapacityReferral);
		mockGetEvacuee.mockResolvedValue({
			_id: 'evacuee:01F8MECHEVACUEEID1234567',
			first_name: 'John',
			last_name: 'Doe',
			shelter_code: 'SH001'
		});
		mockUpdateEvacuee.mockRejectedValue(new Error('CouchDB write error 500'));

		await expect(
			repo.transition('referral:01F8MECHEXAMPLEDOCID12345', 'accepted', 'Staff B')
		).rejects.toThrow('CouchDB write error 500');

		// Verification: repo.put must NOT have been called
		expect(mockRepoPut).not.toHaveBeenCalled();
	});
});
