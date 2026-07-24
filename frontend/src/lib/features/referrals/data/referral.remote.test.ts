import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReferralBatch, ReferralRemoteRepository } from './referral.remote';
import type { Referral, ReferralInput } from '../domain/referral.schema';
import type { ReferralRepository } from './referral.repository';

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

describe('createReferralBatch', () => {
	const template: ReferralInput = {
		referral_type: 'medical-emergency',
		evacuee_id: 'evacuee:placeholder000000000001',
		reason: 'Need hospital care',
		urgency: 'normal',
		to_org: { name: 'Hospital A', kind: 'hospital' },
		notes: 'batch test'
	};

	const ctx = { shelterCode: 'SH001', createdBy: 'Staff A' };

	function makeDraft(evacueeId: string, idSuffix: string): Referral {
		return {
			_id: `referral:01BATCH${idSuffix}`,
			type: 'referral',
			schema_v: 1,
			shelter_code: 'SH001',
			created_at: '2026-07-24T05:00:00.000Z',
			updated_at: '2026-07-24T05:00:00.000Z',
			created_by: 'Staff A',
			evacuee_id: evacueeId,
			referral_type: 'medical-emergency',
			to_org: { name: 'Hospital A', kind: 'hospital' },
			reason: 'Need hospital care',
			urgency: 'normal',
			status: 'draft',
			timeline: {},
			notes: 'batch test'
		};
	}

	it('creates one draft referral per evacuee', async () => {
		const ids = ['evacuee:01AAA000000000000000001', 'evacuee:01AAA000000000000000002'];
		const create = vi
			.fn()
			.mockImplementationOnce(async (input: ReferralInput) => makeDraft(input.evacuee_id, 'A'))
			.mockImplementationOnce(async (input: ReferralInput) => makeDraft(input.evacuee_id, 'B'));
		const transition = vi.fn();
		const repo = { create, transition } as unknown as ReferralRepository;

		const result = await createReferralBatch(template, ids, { intent: 'draft', ctx, repo });

		expect(create).toHaveBeenCalledTimes(2);
		expect(transition).not.toHaveBeenCalled();
		expect(result.created).toHaveLength(2);
		expect(result.failed).toHaveLength(0);
		expect(result.created.map((r) => r.evacuee_id)).toEqual(ids);
		expect(create.mock.calls[0]![0].evacuee_id).toBe(ids[0]);
		expect(create.mock.calls[1]![0].evacuee_id).toBe(ids[1]);
	});

	it('creates then transitions each referral to sent when intent is send', async () => {
		const ids = ['evacuee:01BBB000000000000000001'];
		const draft = makeDraft(ids[0]!, 'C');
		const create = vi.fn().mockResolvedValue(draft);
		const transition = vi.fn().mockResolvedValue({
			...draft,
			status: 'sent',
			timeline: { sent: { at: '2026-07-24T05:01:00.000Z', by: 'Staff A' } }
		});
		const repo = { create, transition } as unknown as ReferralRepository;

		const result = await createReferralBatch(template, ids, { intent: 'send', ctx, repo });

		expect(create).toHaveBeenCalledTimes(1);
		expect(transition).toHaveBeenCalledWith(draft._id, 'sent', 'Staff A');
		expect(result.created).toHaveLength(1);
		expect(result.created[0]!.status).toBe('sent');
		expect(result.failed).toHaveLength(0);
	});

	it('continues on partial failure and reports created + failed', async () => {
		const ids = [
			'evacuee:01CCC000000000000000001',
			'evacuee:01CCC000000000000000002',
			'evacuee:01CCC000000000000000003'
		];
		const create = vi
			.fn()
			.mockImplementationOnce(async (input: ReferralInput) => makeDraft(input.evacuee_id, 'D'))
			.mockRejectedValueOnce(new Error('Evacuee not found'))
			.mockImplementationOnce(async (input: ReferralInput) => makeDraft(input.evacuee_id, 'E'));
		const transition = vi.fn();
		const repo = { create, transition } as unknown as ReferralRepository;

		const result = await createReferralBatch(template, ids, { intent: 'draft', ctx, repo });

		expect(create).toHaveBeenCalledTimes(3);
		expect(result.created).toHaveLength(2);
		expect(result.failed).toEqual([{ evacuee_id: ids[1], error: 'Evacuee not found' }]);
	});

	it('records send failure after create when transition fails', async () => {
		const ids = ['evacuee:01DDD000000000000000001', 'evacuee:01DDD000000000000000002'];
		const draftA = makeDraft(ids[0]!, 'F');
		const draftB = makeDraft(ids[1]!, 'G');
		const create = vi.fn().mockResolvedValueOnce(draftA).mockResolvedValueOnce(draftB);
		const transition = vi
			.fn()
			.mockResolvedValueOnce({ ...draftA, status: 'sent' })
			.mockRejectedValueOnce(new Error('BFF mirror failed'));
		const repo = { create, transition } as unknown as ReferralRepository;

		const result = await createReferralBatch(template, ids, { intent: 'send', ctx, repo });

		expect(result.created).toHaveLength(1);
		expect(result.created[0]!._id).toBe(draftA._id);
		expect(result.failed).toEqual([{ evacuee_id: ids[1], error: 'BFF mirror failed' }]);
	});
});
