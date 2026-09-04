/* eslint-disable no-restricted-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './+server';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { RequestEvent } from './$types';
import type { StockTransfer } from '$lib/features/operations/domain/operations';

vi.mock('$lib/server/couch-admin', () => ({
	requireShelterScopeOrSA: vi.fn(),
	adminRaw: vi.fn(),
	ServiceError: class extends Error {
		constructor(
			public code: string,
			message: string
		) {
			super(message);
		}
	}
}));

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockRestore = vi.fn();

vi.mock('$lib/features/operations/data/transfer.server-repository', () => {
	class MockTransferServerRepository {
		list = mockList;
		create = mockCreate;
		restore = mockRestore;
	}
	return {
		TransferServerRepository: MockTransferServerRepository
	};
});

function createMockEvent(
	searchParams: Record<string, string> = {},
	body: unknown = null,
	cookie: string | null = 'test_cookie'
): RequestEvent {
	const url = new URL('http://localhost/api/back-office/transfer');
	for (const [k, v] of Object.entries(searchParams)) {
		url.searchParams.set(k, v);
	}
	return {
		request: {
			headers: {
				get: (key: string) => (key.toLowerCase() === 'cookie' ? cookie : null)
			},
			json: async () => body
		},
		url
	} as unknown as RequestEvent;
}

describe('BFF Transfer List and Create Endpoints', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /api/back-office/transfer', () => {
		it('returns 403 when caller lacks warehouse/manager/SA role', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'staff_user',
				roles: ['registration_staff'],
				isSA: false,
				shelterCode: 'SH001'
			});

			const event = createMockEvent();
			const res = await GET(event);
			expect(res.status).toBe(403);
			const data = await res.json();
			expect(data.error).toContain('warehouse_staff');
		});

		it('allows warehouse_staff and lists transfers scoped to their shelter', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'ws_user',
				roles: ['warehouse_staff', 'shelter:SH002'],
				isSA: false,
				shelterCode: 'SH002'
			});

			const mockTransfers = [
				{
					_id: 'stock_transfer:1',
					type: 'stock_transfer',
					schema_v: 2,
					shelter_code: 'SH001',
					created_at: '2026-08-22T05:00:00.000Z',
					updated_at: '2026-08-22T05:00:00.000Z',
					created_by: 'ws_user',
					from_shelter: 'SH001',
					to_shelter: 'SH002',
					items: [{ item_id: 'item:rice', qty: '100', unit: 'kg' }],
					status: 'requested',
					timeline: { requested: { at: '2026-08-22T05:00:00.000Z', by: 'ws_user' } }
				}
			];
			mockList.mockResolvedValue(mockTransfers as unknown as StockTransfer[]);

			const event = createMockEvent({ status: 'requested' });
			const res = await GET(event);
			expect(res.status).toBe(200);

			const data = await res.json();
			expect(data).toEqual(mockTransfers);
			expect(mockList).toHaveBeenCalledWith({ status: 'requested' });
		});
	});

	describe('POST /api/back-office/transfer', () => {
		const validBody = {
			from_shelter: 'SH001',
			to_shelter: 'SH002',
			items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
		};

		it('creates a new requested transfer successfully', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'ws_user',
				roles: ['warehouse_staff', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});

			const mockCreatedTransfer = {
				_id: 'stock_transfer:01F8MECHJCZGWFCP',
				type: 'stock_transfer',
				schema_v: 2,
				shelter_code: 'SH001',
				created_at: '2026-08-22T05:00:00.000Z',
				updated_at: '2026-08-22T05:00:00.000Z',
				created_by: 'ws_user',
				status: 'requested',
				timeline: { requested: { at: '2026-08-22T05:00:00.000Z', by: 'ws_user' } },
				...validBody,
				items: [{ item_id: 'item:rice', qty: '100', unit: 'kg' }]
			};
			mockCreate.mockResolvedValue(mockCreatedTransfer as unknown as StockTransfer);

			const event = createMockEvent({}, validBody);
			const res = await POST(event);
			expect(res.status).toBe(201);

			const data = await res.json();
			expect(data).toEqual(mockCreatedTransfer);
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({ from_shelter: 'SH001', to_shelter: 'SH002' }),
				{ shelterCode: 'SH001', createdBy: 'ws_user' }
			);
		});

		it('returns 400 on validation failure', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'ws_user',
				roles: ['warehouse_staff', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});

			const event = createMockEvent({}, { to_shelter: 'SH002' });
			const res = await POST(event);
			expect(res.status).toBe(400);
			expect(mockCreate).not.toHaveBeenCalled();
		});

		it('returns 422 when from_shelter does not match the creating shelter scope', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'ws_user',
				roles: ['warehouse_staff', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});

			const event = createMockEvent({}, { ...validBody, from_shelter: 'SH999' });
			const res = await POST(event);
			expect(res.status).toBe(422);
			expect(mockCreate).not.toHaveBeenCalled();
		});

		it('returns 422 when from_shelter equals to_shelter', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'ws_user',
				roles: ['warehouse_staff', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});

			const event = createMockEvent({}, { ...validBody, to_shelter: 'SH001' });
			const res = await POST(event);
			expect(res.status).toBe(422);
			expect(mockCreate).not.toHaveBeenCalled();
		});
	});
});

describe('POST /api/back-office/transfer — restore branch (CR-090 FR-05)', () => {
	const deletedDoc: StockTransfer = {
		_id: 'stock_transfer:1',
		type: 'stock_transfer',
		schema_v: 3,
		shelter_code: 'SH001',
		created_at: '2026-08-22T05:00:00.000Z',
		updated_at: '2026-08-22T05:00:00.000Z',
		created_by: 'ws_user',
		from_shelter: 'SH001',
		to_shelter: 'SH002',
		items: [{ item_id: 'item:rice', qty: '100', unit: 'kg' }],
		status: 'requested',
		timeline: { requested: { at: '2026-08-22T05:00:00.000Z', by: 'ws_user' } }
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'ws_user',
			roles: ['warehouse_staff', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
	});

	it('routes a `restore` envelope to restore(), not create()', async () => {
		mockRestore.mockResolvedValue({ ...deletedDoc, _rev: '5-restored' });

		const res = await POST(createMockEvent({}, { restore: { doc: deletedDoc } }));
		expect(res.status).toBe(201);

		const data = await res.json();
		expect(data._id).toBe('stock_transfer:1');
		expect(mockRestore).toHaveBeenCalledWith(deletedDoc, 'SH001');
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('leaves the ordinary create path untouched', async () => {
		// FR-05 keeps restore as a separate code path; a normal create must never be able to
		// choose its own `_id`.
		mockCreate.mockResolvedValue(deletedDoc);

		const res = await POST(
			createMockEvent(
				{},
				{
					from_shelter: 'SH001',
					to_shelter: 'SH002',
					items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
				}
			)
		);
		expect(res.status).toBe(201);
		expect(mockCreate).toHaveBeenCalled();
		expect(mockRestore).not.toHaveBeenCalled();
	});

	it('passes a repository refusal through with its status', async () => {
		mockRestore.mockRejectedValue(
			Object.assign(new Error('Only a `requested` transfer can be restored'), { status: 403 })
		);

		const res = await POST(
			createMockEvent({}, { restore: { doc: { ...deletedDoc, status: 'shipped' } } })
		);
		expect(res.status).toBe(403);
		expect(mockCreate).not.toHaveBeenCalled();
	});
});
