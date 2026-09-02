/* eslint-disable no-restricted-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATCH } from './+server';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { TransferServerRepositoryError } from '$lib/features/operations/data/transfer.server-repository';
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
	class TransferServerRepositoryError extends Error {
		constructor(
			message: string,
			public readonly status: number
		) {
			super(message);
		}
	}
	return {
		TransferServerRepository: MockTransferServerRepository,
		TransferServerRepositoryError
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

	it('returns 422 for an over-receipt rejected by the domain layer', async () => {
		mockTransition.mockRejectedValue(
			new Error('Received quantity for item "item:rice" (150) exceeds dispatched quantity (100)')
		);

		const event = createMockEvent('stock_transfer:1', {
			to: 'received',
			receivedItems: [{ item_id: 'item:rice', qty: 150 }]
		});
		const res = await PATCH(event);
		expect(res.status).toBe(422);

		const data = await res.json();
		expect(data.error).toContain('exceeds dispatched quantity');
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

	it('routes a non-conflict TransferServerRepositoryError through handleEndpointError, not the 422 domain-error branch', async () => {
		mockTransition.mockRejectedValue(new TransferServerRepositoryError('Failed to write x', 500));

		const event = createMockEvent('stock_transfer:1', { to: 'shipped' });
		const res = await PATCH(event);
		expect(res.status).toBe(500);

		const data = await res.json();
		expect(data.error).toBe('Failed to write x');
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

	describe('CR-089 — driver/plate + dispute', () => {
		it('forwards trimmed driver_name and vehicle_plate on a dispatch (FR-01)', async () => {
			mockTransition.mockResolvedValueOnce({
				_id: 'stock_transfer:1',
				type: 'stock_transfer',
				status: 'shipped'
			} as unknown as StockTransfer);

			const event = createMockEvent('stock_transfer:1', {
				to: 'shipped',
				driver_name: '  สมชาย ใจดี  ',
				vehicle_plate: '  กท 1234  '
			});

			const res = await PATCH(event);
			expect(res.status).toBe(200);
			expect(mockTransition).toHaveBeenCalledWith(
				'stock_transfer:1',
				'shipped',
				'ws_user',
				'SH001',
				{
					driver_name: 'สมชาย ใจดี',
					vehicle_plate: 'กท 1234'
				}
			);
		});

		it('maps a dispatch missing driver/plate to 422 — the server guard, not just the dialog (FR-01)', async () => {
			// The edge schema keeps both optional so one body shape serves every transition; the
			// domain schema is what rejects, and it must do so before any stock is deducted.
			mockTransition.mockRejectedValue(new Error('Driver name is required to dispatch a transfer'));

			const event = createMockEvent('stock_transfer:1', { to: 'shipped' });
			const res = await PATCH(event);
			expect(res.status).toBe(422);

			const data = await res.json();
			expect(data.error).toContain('Driver name is required');
		});

		it('forwards cancel_reason on a cancel (FR-03)', async () => {
			mockTransition.mockResolvedValueOnce({
				_id: 'stock_transfer:1',
				type: 'stock_transfer',
				status: 'cancelled'
			} as unknown as StockTransfer);

			const event = createMockEvent('stock_transfer:1', {
				to: 'cancelled',
				cancel_reason: 'ปลายทางแจ้งว่าไม่ต้องการแล้ว'
			});

			const res = await PATCH(event);
			expect(res.status).toBe(200);
			expect(mockTransition).toHaveBeenCalledWith(
				'stock_transfer:1',
				'cancelled',
				'ws_user',
				'SH001',
				{ cancel_reason: 'ปลายทางแจ้งว่าไม่ต้องการแล้ว' }
			);
		});

		it('accepts to: disputed and forwards dispute_reason (FR-04)', async () => {
			mockTransition.mockResolvedValueOnce({
				_id: 'stock_transfer:1',
				type: 'stock_transfer',
				status: 'disputed'
			} as unknown as StockTransfer);

			const event = createMockEvent('stock_transfer:1', {
				to: 'disputed',
				dispute_reason: 'สต็อกต้นทางไม่พอตามที่ขอ'
			});

			const res = await PATCH(event);
			expect(res.status).toBe(200);
			expect((await res.json()).status).toBe('disputed');
			expect(mockTransition).toHaveBeenCalledWith(
				'stock_transfer:1',
				'disputed',
				'ws_user',
				'SH001',
				{ dispute_reason: 'สต็อกต้นทางไม่พอตามที่ขอ' }
			);
		});

		it('accepts to: requested for a resume and carries no extra field (FR-05)', async () => {
			mockTransition.mockResolvedValueOnce({
				_id: 'stock_transfer:1',
				type: 'stock_transfer',
				status: 'requested'
			} as unknown as StockTransfer);

			const event = createMockEvent('stock_transfer:1', { to: 'requested' });
			const res = await PATCH(event);
			expect(res.status).toBe(200);
			// Every opts key is absent — resume clears the hold without restating a reason.
			expect(mockTransition).toHaveBeenCalledWith(
				'stock_transfer:1',
				'requested',
				'ws_user',
				'SH001',
				{}
			);
		});

		it('returns 403 when the destination shelter tries to dispute (FR-06)', async () => {
			mockTransition.mockRejectedValue({
				status: 403,
				message: 'Only the source shelter can dispatch or cancel this transfer'
			});

			const event = createMockEvent('stock_transfer:1', {
				to: 'disputed',
				dispute_reason: 'ขอระงับไว้ก่อน'
			});
			const res = await PATCH(event);
			expect(res.status).toBe(403);
		});

		it('returns 422 when vehicle_plate exceeds the edge length cap', async () => {
			const event = createMockEvent('stock_transfer:1', {
				to: 'shipped',
				driver_name: 'สมชาย ใจดี',
				vehicle_plate: 'x'.repeat(51)
			});
			const res = await PATCH(event);
			expect(res.status).toBe(422);
			expect((await res.json()).error).toBe('Validation failed');
			expect(mockTransition).not.toHaveBeenCalled();
		});
	});
});
