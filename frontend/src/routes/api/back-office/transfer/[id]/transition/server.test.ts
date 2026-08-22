/* eslint-disable no-restricted-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATCH } from './+server';
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

const mockTransition = vi.fn();

vi.mock('$lib/features/operations/data/transfer.server-repository', () => {
	class MockTransferServerRepository {
		transition = mockTransition;
	}
	return {
		TransferServerRepository: MockTransferServerRepository
	};
});

function createMockEvent(
	id: string,
	body: unknown = null,
	cookie: string | null = 'test_cookie'
): RequestEvent {
	return {
		params: { id },
		request: {
			headers: {
				get: (key: string) => (key.toLowerCase() === 'cookie' ? cookie : null)
			},
			json: async () => body
		},
		url: new URL(`http://localhost/api/back-office/transfer/${id}/transition`)
	} as unknown as RequestEvent;
}

describe('PATCH /api/back-office/transfer/[id]/transition', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'ws_user',
			roles: ['warehouse_staff', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
	});

	it('transitions state successfully and retries on 409 conflict', async () => {
		mockTransition
			.mockRejectedValueOnce({ status: 409, message: 'Conflict' })
			.mockResolvedValueOnce({
				_id: 'stock_transfer:1',
				type: 'stock_transfer',
				status: 'shipped'
			} as unknown as StockTransfer);

		const event = createMockEvent('stock_transfer:1', { to: 'shipped' });
		const res = await PATCH(event);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.status).toBe('shipped');
		expect(mockTransition).toHaveBeenCalledTimes(2);
	});

	it('forwards receivedItems and notes to the repository transition method', async () => {
		mockTransition.mockResolvedValueOnce({
			_id: 'stock_transfer:1',
			type: 'stock_transfer',
			status: 'received'
		} as unknown as StockTransfer);

		const event = createMockEvent('stock_transfer:1', {
			to: 'received',
			receivedItems: [{ item_id: 'item:rice', qty: 85 }],
			notes: '  15kg damaged in transit  '
		});

		const res = await PATCH(event);
		expect(res.status).toBe(200);
		expect(mockTransition).toHaveBeenCalledWith(
			'stock_transfer:1',
			'received',
			'ws_user',
			'SH001',
			{
				receivedItems: [{ item_id: 'item:rice', qty: '85' }],
				notes: '15kg damaged in transit'
			}
		);
	});

	it('returns 422 for invalid transition target status', async () => {
		const event = createMockEvent('stock_transfer:1', { to: 'invalid_status' });
		const res = await PATCH(event);
		expect(res.status).toBe(422);

		const data = await res.json();
		expect(data.error).toBe('Validation failed');
	});

	it('returns 422 for forbidden transitions from the domain state machine', async () => {
		mockTransition.mockRejectedValue(new Error('Cannot dispatch transfer in status "shipped"'));

		const event = createMockEvent('stock_transfer:1', { to: 'shipped' });
		const res = await PATCH(event);
		expect(res.status).toBe(422);

		const data = await res.json();
		expect(data.error).toContain('Cannot dispatch transfer in status "shipped"');
	});

	it('returns 403 for an authorization failure surfaced by the repository', async () => {
		mockTransition.mockRejectedValue({
			status: 403,
			message: 'Only the source shelter can dispatch or cancel this transfer'
		});

		const event = createMockEvent('stock_transfer:1', { to: 'shipped' });
		const res = await PATCH(event);
		expect(res.status).toBe(403);
	});

	it('fails after 3 retries on conflict', async () => {
		mockTransition.mockRejectedValue({ status: 409, message: 'Conflict' });

		const event = createMockEvent('stock_transfer:1', { to: 'shipped' });
		const res = await PATCH(event);
		expect(res.status).toBe(409);

		const data = await res.json();
		expect(data.error).toContain('Conflict: transition failed');
		expect(mockTransition).toHaveBeenCalledTimes(3);
	});
});
