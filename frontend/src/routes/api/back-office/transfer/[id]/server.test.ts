/* eslint-disable no-restricted-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, DELETE } from './+server';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { RequestEvent } from './$types';
import type { StockTransfer } from '$lib/features/operations/domain/operations';

vi.mock('$lib/server/couch-admin', () => ({
	requireShelterScopeOrSA: vi.fn(),
	ServiceError: class extends Error {
		constructor(
			public code: string,
			message: string
		) {
			super(message);
		}
	}
}));

const mockGet = vi.fn();
const mockRemove = vi.fn();

vi.mock('$lib/features/operations/data/transfer.server-repository', () => {
	class MockTransferServerRepository {
		get = mockGet;
		remove = mockRemove;
	}
	return {
		TransferServerRepository: MockTransferServerRepository
	};
});

function createMockEvent(
	id: string,
	searchParams: Record<string, string> = {},
	cookie: string | null = 'test_cookie'
): RequestEvent {
	const url = new URL(`http://localhost/api/back-office/transfer/${id}`);
	for (const [k, v] of Object.entries(searchParams)) {
		url.searchParams.set(k, v);
	}
	return {
		params: { id },
		request: {
			headers: {
				get: (key: string) => (key.toLowerCase() === 'cookie' ? cookie : null)
			}
		},
		url
	} as unknown as RequestEvent;
}

const mockTransfer: StockTransfer = {
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
};

describe('GET /api/back-office/transfer/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('allows System Admin to retrieve any transfer', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'sa_user',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		mockGet.mockResolvedValue(mockTransfer);

		const event = createMockEvent('stock_transfer:1', { shelter_code: 'SH003' });
		const res = await GET(event);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data._id).toBe('stock_transfer:1');
	});

	it('allows the source shelter to retrieve their transfer', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'ws_user',
			roles: ['warehouse_staff', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		mockGet.mockResolvedValue(mockTransfer);

		const event = createMockEvent('stock_transfer:1');
		const res = await GET(event);
		expect(res.status).toBe(200);
	});

	it('allows the destination shelter to retrieve their transfer', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'ws_user2',
			roles: ['warehouse_staff', 'shelter:SH002'],
			isSA: false,
			shelterCode: 'SH002'
		});
		mockGet.mockResolvedValue(mockTransfer);

		const event = createMockEvent('stock_transfer:1');
		const res = await GET(event);
		expect(res.status).toBe(200);
	});

	it('blocks (returns 403) a third-party shelter from retrieving the transfer', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'ws_user3',
			roles: ['warehouse_staff', 'shelter:SH003'],
			isSA: false,
			shelterCode: 'SH003'
		});
		mockGet.mockResolvedValue(mockTransfer);

		const event = createMockEvent('stock_transfer:1');
		const res = await GET(event);
		expect(res.status).toBe(403);

		const data = await res.json();
		expect(data.error).toContain('Forbidden: You do not have access');
	});

	it('returns 404 when transfer is not found', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'ws_user',
			roles: ['warehouse_staff', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		mockGet.mockResolvedValue(null);

		const event = createMockEvent('stock_transfer:999');
		const res = await GET(event);
		expect(res.status).toBe(404);

		const data = await res.json();
		expect(data.error).toContain('Transfer not found');
	});
});

describe('DELETE /api/back-office/transfer/[id] (CR-090)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'ws_user',
			roles: ['warehouse_staff', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
	});

	it('returns the tombstone rev and the deleted body so the caller can offer an undo', async () => {
		mockRemove.mockResolvedValue({
			id: 'stock_transfer:1',
			rev: '4-tombstone',
			doc: mockTransfer
		});

		const res = await DELETE(createMockEvent('stock_transfer:1'));
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(data.rev).toBe('4-tombstone');
		expect(data.doc._id).toBe('stock_transfer:1');
		expect(mockRemove).toHaveBeenCalledWith('stock_transfer:1', 'SH001');
	});

	it('passes the repository status through — a `shipped` transfer is refused with 422', async () => {
		// CR-090 FR-03 — this must hold for a request sent straight at the API, not only for a
		// button the UI hides.
		mockRemove.mockRejectedValue(
			Object.assign(new Error('Cannot delete a transfer in status "shipped"'), { status: 422 })
		);

		const res = await DELETE(createMockEvent('stock_transfer:1'));
		expect(res.status).toBe(422);

		const data = await res.json();
		expect(data.error).toContain('shipped');
	});

	it('passes a 403 through when the caller is not the source shelter', async () => {
		mockRemove.mockRejectedValue(
			Object.assign(new Error('Only the source shelter can delete this transfer'), { status: 403 })
		);

		const res = await DELETE(createMockEvent('stock_transfer:1'));
		expect(res.status).toBe(403);
	});

	it('returns 400 without an id', async () => {
		const res = await DELETE(createMockEvent(''));
		expect(res.status).toBe(400);
		expect(mockRemove).not.toHaveBeenCalled();
	});
});
