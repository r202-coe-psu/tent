import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTransition, canTransition } from '../domain/referral.transitions';
import { assertM5TransitionAllowed, type M5BatchInput } from '../domain/referral.m5';
import { referralSchema, type Referral, type ReferralStatus } from '../domain/referral.schema';
import type { TransitionOptions } from './referral.server-repository';

vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));
vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));
vi.mock('$lib/server/integrations', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/integrations')>()),
	integrationRequest: vi.fn()
}));

const { adminRaw } = await import('$lib/server/couch-admin');
const { findMasterByCode } = await import('$lib/server/shelters.admin');
const { integrationRequest, IntegrationError } = await import('$lib/server/integrations');
const { cancelM5Batch, createM5Batch, M5BatchError, startM5Batch, submitM5Batch } =
	await import('./referral.m5.server');
const { bulkTransitionWithM5 } = await import('./referral.bulk-transition');

const BATCH = '01JC00000000000000000BATCH';
const EXTERNAL_REF = `TENT-SH001-${BATCH}`;

function m5Doc(id: string, evacueeId: string, over: Record<string, unknown> = {}): Referral {
	return referralSchema.parse({
		_id: `referral:${id}`,
		_rev: '1-a',
		type: 'referral',
		schema_v: 3,
		shelter_code: 'SH001',
		created_at: '2026-11-11T01:00:00.000Z',
		updated_at: '2026-11-11T01:00:00.000Z',
		created_by: 'manager1',
		evacuee_id: evacueeId,
		evacuee_summary: { first_name: 'ผู้ป่วย', last_name: id },
		referral_type: 'medical-emergency',
		dispatch_mode: 'm5',
		batch_id: BATCH,
		to_org: { name: 'รพ.สนาม', kind: 'hospital', m5_facility_id: 6 },
		acuity: 'red',
		transport: { vehicle_type: 'van' },
		requester_contact: { name: 'สมชาย', role: 'หัวหน้า', phone: '081' },
		reason: `อาการ ${id}`,
		urgency: 'urgent',
		status: 'draft',
		timeline: {},
		...over
	});
}

const external = (status: string) => ({
	system: 'm5',
	external_ref: EXTERNAL_REF,
	code: 'TRF-20261111-0001',
	status
});

/** In-memory `central_ops` that runs the real transition rules. */
class FakeRepo {
	docs = new Map<string, Referral>();
	created: { input: M5BatchInput; batchId: string }[] = [];
	failWriteFor = new Set<string>();

	constructor(docs: Referral[]) {
		for (const d of docs) this.docs.set(d._id, d);
	}

	async get(id: string) {
		return this.docs.get(id) ?? null;
	}

	async findByBatchId(batchId: string) {
		return [...this.docs.values()].filter((d) => 'batch_id' in d && d.batch_id === batchId);
	}

	async createM5Batch(input: M5BatchInput, batchId: string) {
		this.created.push({ input, batchId });
		return [];
	}

	async update(id: string, mutate: (d: Referral) => Referral | null) {
		const next = mutate(this.docs.get(id)!);
		if (next) this.docs.set(id, next);
		return next;
	}

	async transition(
		id: string,
		to: ReferralStatus,
		actor: string,
		reason?: string,
		_shelter?: string,
		options: TransitionOptions = {}
	) {
		const doc = this.docs.get(id)!;
		if (!canTransition(doc.status, to)) throw new Error('Invalid referral transition');
		assertM5TransitionAllowed(doc, to, options.channel ?? 'row');
		if (this.failWriteFor.has(id)) throw new Error('couch down');
		const t = applyTransition(doc, to, actor, '2026-11-11T02:00:00.000Z', reason);
		const next = options.patch ? options.patch(t) : t;
		this.docs.set(id, next);
		return next;
	}

	async hasActiveReferral() {
		return false;
	}
}

const evacueeRows = {
	rows: [
		{
			id: 'evacuee:A',
			doc: {
				_id: 'evacuee:A',
				type: 'evacuee',
				first_name: 'สมศรี',
				last_name: 'ใจดี',
				person_id: { cardType: 'national_id', number: '1101700203450' },
				age: 67
			}
		},
		{ id: 'evacuee:B', doc: { _id: 'evacuee:B', type: 'evacuee', first_name: 'สมชาย' } }
	]
};

function ctx(repo: FakeRepo) {
	return { repo: repo as never, shelterCode: 'SH001', actor: 'manager1' };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(adminRaw).mockResolvedValue({ status: 200, data: evacueeRows } as never);
	vi.mocked(findMasterByCode).mockResolvedValue({
		code: 'SH001',
		name: 'ศูนย์ทดสอบ',
		location: { lat: 7.0084, lng: 100.4747 }
	} as never);
});

vi.mock('$lib/features/people/domain/people', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/people/domain/people')>()),
	isEvacuee: (d: unknown) => !!d && (d as { type?: string }).type === 'evacuee'
}));

describe('submitM5Batch', () => {
	it('sends one transfer and marks every draft sent with the M5 link', async () => {
		const repo = new FakeRepo([m5Doc('A', 'evacuee:A'), m5Doc('B', 'evacuee:B')]);
		vi.mocked(integrationRequest).mockResolvedValue({
			code: 'TRF-20261111-0001',
			status: 'awaiting_review',
			external_ref: EXTERNAL_REF
		});

		const res = await submitM5Batch(ctx(repo), BATCH);

		expect(integrationRequest).toHaveBeenCalledTimes(1);
		const [method, path, body] = vi.mocked(integrationRequest).mock.calls[0];
		expect([method, path]).toEqual(['POST', '/v1/integrations/m5/transfers']);
		expect(body).toMatchObject({
			external_ref: EXTERNAL_REF,
			actor: 'manager1',
			patients: [
				{ referral_id: 'referral:A', national_id: '1101700203450', age: 67 },
				{ referral_id: 'referral:B', name: 'สมชาย' }
			]
		});
		expect(res.failed).toEqual([]);
		for (const id of ['referral:A', 'referral:B']) {
			expect(repo.docs.get(id)).toMatchObject({
				status: 'sent',
				external: { code: 'TRF-20261111-0001', status: 'awaiting_review' }
			});
		}
	});

	it('reports members it could not write and leaves them for the worker (D7)', async () => {
		const repo = new FakeRepo([m5Doc('A', 'evacuee:A'), m5Doc('B', 'evacuee:B')]);
		repo.failWriteFor.add('referral:B');
		vi.mocked(integrationRequest).mockResolvedValue({
			code: 'TRF-20261111-0001',
			status: 'awaiting_review',
			external_ref: EXTERNAL_REF
		});
		const res = await submitM5Batch(ctx(repo), BATCH);
		expect(res.failed).toEqual([{ id: 'referral:B', error: 'couch down' }]);
		expect(repo.docs.get('referral:A')?.status).toBe('sent');
	});

	it('does not report a member the worker already moved to sent', async () => {
		const repo = new FakeRepo([m5Doc('A', 'evacuee:A')]);
		vi.mocked(integrationRequest).mockImplementation(async () => {
			// The worker applies the new m5_transfers row before the BFF writes.
			repo.docs.set('referral:A', {
				...repo.docs.get('referral:A')!,
				status: 'sent',
				external: external('awaiting_review')
			} as Referral);
			return { code: 'TRF-20261111-0001', status: 'awaiting_review', external_ref: EXTERNAL_REF };
		});
		const res = await submitM5Batch(ctx(repo), BATCH);
		expect(res.failed).toEqual([]);
		expect(res.referrals.map((r) => r._id)).toEqual(['referral:A']);
	});

	it('is a no-op when every member is already sent', async () => {
		const repo = new FakeRepo([
			m5Doc('A', 'evacuee:A', { status: 'sent', external: external('awaiting_review') })
		]);
		const res = await submitM5Batch(ctx(repo), BATCH);
		expect(integrationRequest).not.toHaveBeenCalled();
		expect(res.transfer.code).toBe('TRF-20261111-0001');
	});

	it('blocks a shelter without coordinates before calling M5', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue({
			code: 'SH001',
			name: 'ศูนย์',
			location: {}
		} as never);
		const repo = new FakeRepo([m5Doc('A', 'evacuee:A')]);
		await expect(submitM5Batch(ctx(repo), BATCH)).rejects.toMatchObject({
			status: 422,
			code: 'SHELTER_LOCATION_MISSING'
		});
		expect(integrationRequest).not.toHaveBeenCalled();
	});

	it('passes M5 failures through with their code', async () => {
		const repo = new FakeRepo([m5Doc('A', 'evacuee:A')]);
		vi.mocked(integrationRequest).mockRejectedValue(
			new IntegrationError(503, 'M5_UNAVAILABLE', 'down')
		);
		await expect(submitM5Batch(ctx(repo), BATCH)).rejects.toMatchObject({
			status: 503,
			code: 'M5_UNAVAILABLE'
		});
		expect(repo.docs.get('referral:A')?.status).toBe('draft');
	});

	it('404s an unknown batch', async () => {
		await expect(submitM5Batch(ctx(new FakeRepo([])), BATCH)).rejects.toBeInstanceOf(M5BatchError);
	});
});

describe('startM5Batch', () => {
	it('refuses before MOPH approved, without calling M5', async () => {
		const repo = new FakeRepo([
			m5Doc('A', 'evacuee:A', { status: 'sent', external: external('awaiting_review') })
		]);
		await expect(startM5Batch(ctx(repo), BATCH)).rejects.toMatchObject({
			status: 409,
			code: 'NOT_PENDING'
		});
		expect(integrationRequest).not.toHaveBeenCalled();
	});

	it('reports the vehicle and mirrors in_transit without changing status', async () => {
		const repo = new FakeRepo([
			m5Doc('A', 'evacuee:A', { status: 'accepted', external: external('pending') })
		]);
		vi.mocked(integrationRequest).mockResolvedValue({});
		await startM5Batch(ctx(repo), BATCH);
		expect(vi.mocked(integrationRequest).mock.calls[0][1]).toBe(
			'/v1/integrations/m5/transfers/TRF-20261111-0001/start'
		);
		expect(repo.docs.get('referral:A')).toMatchObject({
			status: 'accepted',
			external: { status: 'in_transit' }
		});
	});
});

describe('cancelM5Batch', () => {
	it('withdraws through M5 first, then closes every member', async () => {
		const repo = new FakeRepo([
			m5Doc('A', 'evacuee:A', { status: 'sent', external: external('awaiting_review') }),
			m5Doc('B', 'evacuee:B', { status: 'sent', external: external('awaiting_review') })
		]);
		vi.mocked(integrationRequest).mockResolvedValue({});
		const res = await cancelM5Batch(ctx(repo), BATCH, 'อาการดีขึ้น');
		expect(vi.mocked(integrationRequest).mock.calls[0]).toEqual([
			'POST',
			'/v1/integrations/m5/transfers/TRF-20261111-0001/cancel',
			{ reason: 'อาการดีขึ้น', actor: 'manager1' }
		]);
		expect(res.closed).toHaveLength(2);
		expect(repo.docs.get('referral:A')).toMatchObject({
			status: 'closed',
			close_reason: 'อาการดีขึ้น',
			external: { status: 'cancelled' },
			schema_v: 3
		});
	});

	it('keeps referrals open when M5 refuses', async () => {
		const repo = new FakeRepo([
			m5Doc('A', 'evacuee:A', { status: 'sent', external: external('awaiting_review') })
		]);
		vi.mocked(integrationRequest).mockRejectedValue(
			new IntegrationError(409, 'CANCEL_NEEDS_MOPH', 'approved')
		);
		await expect(cancelM5Batch(ctx(repo), BATCH, 'x')).rejects.toMatchObject({
			code: 'CANCEL_NEEDS_MOPH'
		});
		expect(repo.docs.get('referral:A')?.status).toBe('sent');
	});

	it('refuses an approved batch without calling M5', async () => {
		const repo = new FakeRepo([
			m5Doc('A', 'evacuee:A', { status: 'accepted', external: external('pending') })
		]);
		await expect(cancelM5Batch(ctx(repo), BATCH, 'x')).rejects.toMatchObject({
			status: 409,
			code: 'CANCEL_NEEDS_MOPH'
		});
		expect(integrationRequest).not.toHaveBeenCalled();
	});

	it('closes a never-sent draft batch without M5', async () => {
		const repo = new FakeRepo([m5Doc('A', 'evacuee:A')]);
		await cancelM5Batch(ctx(repo), BATCH, 'แก้ข้อมูล');
		expect(integrationRequest).not.toHaveBeenCalled();
		expect(repo.docs.get('referral:A')?.status).toBe('closed');
	});

	it('recreates the remaining patients as a new draft batch (rule 6)', async () => {
		const repo = new FakeRepo([
			m5Doc('A', 'evacuee:A', { status: 'sent', external: external('awaiting_review') }),
			m5Doc('B', 'evacuee:B', {
				status: 'sent',
				acuity: 'green',
				external: external('awaiting_review')
			})
		]);
		vi.mocked(integrationRequest).mockResolvedValue({});
		const res = await cancelM5Batch(ctx(repo), BATCH, 'เอาคนออก', ['referral:A']);
		expect(res.new_batch_id).toEqual(expect.any(String));
		expect(res.new_batch_id).not.toBe(BATCH);
		expect(repo.created).toHaveLength(1);
		expect(repo.created[0].input.patients).toEqual([
			{ evacuee_id: 'evacuee:B', acuity: 'green', reason: 'อาการ B' }
		]);
		expect(repo.created[0].input.to_org.m5_facility_id).toBe(6);
	});
});

describe('createM5Batch', () => {
	const input = {
		to_org: { name: 'รพ.สนาม', m5_facility_id: 6 },
		urgency: 'urgent',
		transport: { vehicle_type: 'van' },
		requester_contact: { name: 'สมชาย', role: 'หัวหน้า', phone: '081' },
		patients: [{ evacuee_id: 'evacuee:A', acuity: 'red', reason: 'x' }]
	};

	it('rejects an evacuee that is not in the shelter', async () => {
		const repo = new FakeRepo([]);
		const bad = { ...input, patients: [{ evacuee_id: 'evacuee:Z', acuity: 'red', reason: 'x' }] };
		await expect(
			createM5Batch({ ...ctx(repo), hasActiveReferral: async () => false }, bad)
		).rejects.toMatchObject({ status: 422, code: 'EVACUEE_NOT_FOUND' });
	});

	it('rejects an evacuee with an open referral', async () => {
		const repo = new FakeRepo([]);
		await expect(
			createM5Batch({ ...ctx(repo), hasActiveReferral: async () => true }, input)
		).rejects.toMatchObject({ status: 409, code: 'ACTIVE_REFERRAL' });
	});

	it('creates the batch with a fresh batch_id', async () => {
		const repo = new FakeRepo([]);
		const res = await createM5Batch({ ...ctx(repo), hasActiveReferral: async () => false }, input);
		expect(repo.created[0].batchId).toBe(res.batchId);
		expect(res.input.submit).toBe(false);
	});

	it('400s an invalid body', async () => {
		await expect(
			createM5Batch(
				{ ...ctx(new FakeRepo([])), hasActiveReferral: async () => false },
				{ ...input, patients: [] }
			)
		).rejects.toMatchObject({ status: 400, code: 'VALIDATION' });
	});
});

describe('bulkTransitionWithM5 (D11, D16)', () => {
	it('withdraws a selected m5 referral as its whole batch, once', async () => {
		const repo = new FakeRepo([
			m5Doc('A', 'evacuee:A', { status: 'sent', external: external('awaiting_review') }),
			m5Doc('B', 'evacuee:B', { status: 'sent', external: external('awaiting_review') })
		]);
		vi.mocked(integrationRequest).mockResolvedValue({});
		const res = await bulkTransitionWithM5(['referral:A'], 'closed', undefined, 'm', 'SH001', {
			allowedTypes: null,
			repo: repo as never
		});
		expect(integrationRequest).toHaveBeenCalledTimes(1);
		expect(vi.mocked(integrationRequest).mock.calls[0][2]).toMatchObject({
			reason: 'ถอนคำขอจากศูนย์'
		});
		expect(res.succeeded.map((r) => r._id)).toEqual(['referral:A']);
		expect(repo.docs.get('referral:B')?.status).toBe('closed');
	});

	it('fails every selected member of a batch M5 refuses, without failing the bulk', async () => {
		const repo = new FakeRepo([
			m5Doc('A', 'evacuee:A', { status: 'sent', external: external('awaiting_review') }),
			m5Doc('C', 'evacuee:B', { batch_id: 'OTHER', status: 'draft' })
		]);
		vi.mocked(integrationRequest).mockRejectedValue(
			new IntegrationError(409, 'CANCEL_NEEDS_MOPH', 'approved')
		);
		const res = await bulkTransitionWithM5(
			['referral:A', 'referral:C'],
			'closed',
			'x',
			'm',
			'SH001',
			{ allowedTypes: null, repo: repo as never }
		);
		expect(res.failed).toEqual([{ id: 'referral:A', error: 'CANCEL_NEEDS_MOPH: approved' }]);
		expect(res.succeeded.map((r) => r._id)).toEqual(['referral:C']);
	});

	it('refuses accept on an m5 referral through the per-item path', async () => {
		const repo = new FakeRepo([
			m5Doc('A', 'evacuee:A', { status: 'sent', external: external('awaiting_review') })
		]);
		const res = await bulkTransitionWithM5(['referral:A'], 'accepted', undefined, 'm', 'SH001', {
			allowedTypes: null,
			repo: repo as never
		});
		expect(res.failed[0].id).toBe('referral:A');
		expect(repo.docs.get('referral:A')?.status).toBe('sent');
	});

	it('limits role-restricted callers to their referral types', async () => {
		const capacity = referralSchema.parse({
			...m5Doc('K', 'evacuee:A'),
			schema_v: 2,
			referral_type: 'capacity',
			to_shelter_code: 'SH002',
			dispatch_mode: undefined,
			batch_id: undefined
		});
		const repo = new FakeRepo([capacity]);
		const res = await bulkTransitionWithM5(['referral:K'], 'closed', 'x', 'nurse', 'SH001', {
			allowedTypes: ['medical-emergency'],
			repo: repo as never
		});
		expect(res.failed).toEqual([
			{ id: 'referral:K', error: 'Forbidden: referral type not allowed for this role' }
		]);
	});
});
