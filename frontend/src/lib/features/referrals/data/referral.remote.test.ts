import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReferralRemoteRepository } from './referral.remote';
import type { Referral } from '../domain/referral.schema';

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

vi.mock('$lib/features/people', () => ({
	peopleRepository: () => ({
		getEvacuee: mockGetEvacuee
	})
}));

vi.mock('$lib/db/shelter', () => ({
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));

describe('ReferralRemoteRepository — capacity via BFF', () => {
	let repo: ReferralRemoteRepository;
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		repo = new ReferralRemoteRepository('shelter_sh001');
		vi.stubGlobal('fetch', fetchMock);
	});

	const capacitySent: Referral = {
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

	it('delegates all capacity transitions to BFF (not local put)', async () => {
		mockRepoGet.mockResolvedValue(capacitySent);
		const accepted: Referral = {
			...capacitySent,
			status: 'accepted',
			response_reason: 'Accepted by SH002',
			timeline: {
				...capacitySent.timeline,
				responded: { at: '2026-07-11T06:00:00.000Z', by: 'Staff B' }
			}
		};
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => accepted
		});

		const result = await repo.transition(
			capacitySent._id,
			'accepted',
			'Staff B',
			'Accepted by SH002'
		);

		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining('/api/back-office/referral/'),
			expect.objectContaining({ method: 'PATCH', credentials: 'include' })
		);
		expect(mockRepoPut).not.toHaveBeenCalled();
		expect(result.status).toBe('accepted');
	});

	it('delegates capacity send (draft→sent) to BFF for destination mirror', async () => {
		const draft: Referral = { ...capacitySent, status: 'draft', timeline: {} };
		mockRepoGet.mockResolvedValue(draft);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ ...draft, status: 'sent' })
		});

		await repo.transition(draft._id, 'sent', 'Staff A');
		expect(fetchMock).toHaveBeenCalled();
		expect(mockRepoPut).not.toHaveBeenCalled();
	});

	it('fail-fast: does not put referral when BFF capacity transfer fails', async () => {
		mockRepoGet.mockResolvedValue(capacitySent);
		fetchMock.mockResolvedValue({
			ok: false,
			status: 403,
			json: async () => ({
				error: 'Only the destination shelter can accept or reject a capacity referral'
			})
		});

		await expect(repo.transition(capacitySent._id, 'accepted', 'Staff A')).rejects.toThrow(
			/destination shelter/
		);

		expect(mockRepoPut).not.toHaveBeenCalled();
	});

	it('keeps non-capacity transitions on the remote session path', async () => {
		const medicalSent: Referral = {
			...capacitySent,
			referral_type: 'medical-emergency',
			to_shelter_code: undefined,
			to_org: { name: 'Hospital A', kind: 'hospital' }
		};
		mockRepoGet.mockResolvedValue(medicalSent);
		mockRepoPut.mockImplementation((doc) => Promise.resolve(doc));

		const result = await repo.transition(medicalSent._id, 'accepted', 'Staff B', 'Bed ready');

		expect(fetchMock).not.toHaveBeenCalled();
		expect(mockRepoPut).toHaveBeenCalled();
		expect(result.status).toBe('accepted');
	});
});
