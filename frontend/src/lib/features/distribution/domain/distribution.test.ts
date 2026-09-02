import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	bufferPercentSchema,
	calculateApprovalCoverage,
	calculateNfiTarget,
	canEditDistributionRequest,
	canTransitionDistributionBatch,
	canTransitionDistributionRequest,
	createDistributionBatch,
	createDistributionIssue,
	createDistributionRequest,
	createStockLotReservation,
	distributionIssueInputSchema,
	distributionRequestInputSchema
} from './distribution';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:field-1' };

const requestItem = {
	item_id: 'item:blanket',
	requested_qty: '10',
	unit: 'ผืน',
	distribution_type_snapshot: 'one_time' as const,
	target_qty_snapshot: '10'
};

describe('distribution request contract', () => {
	it('creates a normalized pending request with a default 10% buffer', () => {
		const request = createDistributionRequest(
			{
				purpose: 'แจกผู้พักพิงใหม่',
				active_headcount_snapshot: 100,
				buffer_percent: undefined,
				items: [{ ...requestItem, requested_qty: 10 }]
			},
			ctx,
			'REQUEST1'
		);

		expect(request._id).toBe('distribution_request:REQUEST1');
		expect(request.status).toBe('pending');
		expect(request.requested_by).toBe(ctx.createdBy);
		expect(request.active_headcount_snapshot).toBe('100');
		expect(request.buffer_percent).toBe(10);
		expect(request.items[0].requested_qty).toBe('10');
	});

	it('allows duplicate request item rows when metadata is compatible', () => {
		const result = distributionRequestInputSchema.safeParse({
			purpose: 'แจกข้าวสารแบ่งรอบ',
			active_headcount_snapshot: 100,
			items: [
				{ ...requestItem, item_id: 'item:rice', requested_qty: 30, unit: 'kg' },
				{ ...requestItem, item_id: 'item:rice', requested_qty: 20, unit: 'kg' }
			]
		});
		expect(result.success).toBe(true);
	});

	it('rejects duplicate request item rows with conflicting unit', () => {
		const result = distributionRequestInputSchema.safeParse({
			purpose: 'แจกข้าวสารหน่วยต่างกัน',
			active_headcount_snapshot: 100,
			items: [
				{ ...requestItem, item_id: 'item:rice', requested_qty: 30, unit: 'kg' },
				{ ...requestItem, item_id: 'item:rice', requested_qty: 20, unit: 'ถุง' }
			]
		});
		expect(result.success).toBe(false);
	});

	it('rejects duplicate request item rows with conflicting distribution type', () => {
		const result = distributionRequestInputSchema.safeParse({
			purpose: 'แจกข้าวสารประเภทต่างกัน',
			active_headcount_snapshot: 100,
			items: [
				{
					...requestItem,
					item_id: 'item:rice',
					requested_qty: 30,
					distribution_type_snapshot: 'consumable'
				},
				{
					...requestItem,
					item_id: 'item:rice',
					requested_qty: 20,
					distribution_type_snapshot: 'one_time'
				}
			]
		});
		expect(result.success).toBe(false);
	});

	it('allows only approved request transitions', () => {
		expect(canTransitionDistributionRequest('pending', 'approving')).toBe(true);
		expect(canTransitionDistributionRequest('pending', 'rejected')).toBe(true);
		expect(canTransitionDistributionRequest('pending', 'cancelled')).toBe(true);
		expect(canTransitionDistributionRequest('approving', 'approved')).toBe(true);
		expect(canTransitionDistributionRequest('approving', 'pending')).toBe(true);
		expect(canTransitionDistributionRequest('approved', 'pending')).toBe(false);
		expect(canTransitionDistributionRequest('rejected', 'pending')).toBe(false);
		expect(canTransitionDistributionRequest('cancelled', 'pending')).toBe(false);
		expect(canTransitionDistributionRequest('pending', 'approved')).toBe(false);
	});

	it('is editable only while pending', () => {
		expect(canEditDistributionRequest('pending')).toBe(true);
		expect(canEditDistributionRequest('approving')).toBe(false);
		expect(canEditDistributionRequest('approved')).toBe(false);
	});

	it('rejects an empty request and invalid headcount', () => {
		expect(
			distributionRequestInputSchema.safeParse({
				purpose: 'x',
				active_headcount_snapshot: -1,
				items: []
			}).success
		).toBe(false);
	});
});

describe('approval coverage contract', () => {
	const item = (item_id: string, requested_qty: string) => ({
		item_id,
		requested_qty,
		unit: 'kg',
		distribution_type_snapshot: 'consumable' as const,
		target_qty_snapshot: requested_qty
	});

	it.each([
		['full allocation', [item('item:rice', '50')], [{ item_id: 'item:rice', qty: '50' }], 'full'],
		[
			'partial allocation',
			[item('item:rice', '50')],
			[{ item_id: 'item:rice', qty: '5' }],
			'partial'
		],
		[
			'multiple items with one incomplete',
			[item('item:rice', '50'), item('item:water', '20')],
			[
				{ item_id: 'item:rice', qty: '50' },
				{ item_id: 'item:water', qty: '5' }
			],
			'partial'
		],
		[
			'multiple lots with decimal quantities',
			[item('item:medicine', '0.3')],
			[
				{ item_id: 'item:medicine', qty: '0.1' },
				{ item_id: 'item:medicine', qty: '0.2' }
			],
			'full'
		],
		[
			'duplicate request rows aggregated by item identity',
			[item('item:rice', '30'), item('item:rice', '20')],
			[{ item_id: 'item:rice', qty: '50' }],
			'full'
		]
	] as const)('calculates %s', (_name, items, allocations, expected) => {
		expect(calculateApprovalCoverage(items, allocations)).toBe(expected);
	});
});

describe('NFI target calculation', () => {
	it.each([
		{ activeHeadcount: 100, bufferPercent: 10, expected: '110' },
		{ activeHeadcount: 101, bufferPercent: 10, expected: '112' },
		{ activeHeadcount: 100, bufferPercent: 5, expected: '105' }
	])(
		'calculates $activeHeadcount people with $bufferPercent percent as $expected',
		({ activeHeadcount, bufferPercent, expected }) => {
			expect(
				calculateNfiTarget({
					active_headcount: activeHeadcount,
					buffer_percent: bufferPercent
				})
			).toBe(expected);
		}
	);

	it('rejects buffers below 5 or above 10', () => {
		expect(bufferPercentSchema.safeParse(4).success).toBe(false);
		expect(bufferPercentSchema.safeParse(11).success).toBe(false);
	});

	it('rejects a negative headcount', () => {
		expect(() => calculateNfiTarget({ active_headcount: -1, buffer_percent: 10 })).toThrow();
	});

	it('returns a deterministic normalized qty string', () => {
		expect(calculateNfiTarget({ active_headcount: '00101', buffer_percent: 10 })).toBe('112');
	});
});

describe('distribution batch contract', () => {
	it('derives its ID from the request and starts activating', () => {
		const batch = createDistributionBatch(
			{
				request_id: 'distribution_request:REQUEST1',
				items: [
					{
						item_id: 'item:blanket',
						allocated_qty: '10',
						unit: 'ผืน',
						distribution_type_snapshot: 'one_time'
					}
				],
				allocations: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:LOT1',
						lot: { lot_no: 'L-260829-001' },
						qty: '10',
						allocation_ledger_id: 'stock_ledger:ALLOC1'
					}
				]
			},
			ctx
		);

		expect(batch._id).toBe('distribution_batch:REQUEST1');
		expect(batch.status).toBe('activating');
		expect(batch.reconciliation).toEqual([]);
		expect(batch.return_ledger_ids).toEqual([]);
	});

	it('allows only forward batch transitions', () => {
		expect(canTransitionDistributionBatch('activating', 'active')).toBe(true);
		expect(canTransitionDistributionBatch('active', 'closing')).toBe(true);
		expect(canTransitionDistributionBatch('closing', 'closed')).toBe(true);
		expect(canTransitionDistributionBatch('active', 'activating')).toBe(false);
		expect(canTransitionDistributionBatch('closing', 'active')).toBe(false);
		expect(canTransitionDistributionBatch('closed', 'active')).toBe(false);
	});
});

describe('distribution issue and reservation contracts', () => {
	const eligibility = {
		distribution_type: 'one_time' as const,
		had_previous_receipt: false,
		previous_receipt_count: 0,
		eligible: true,
		decision: 'first_receipt' as const
	};

	it('requires a non-empty issue idempotency key', () => {
		const input = {
			batch_id: 'distribution_batch:REQUEST1',
			evacuee_id: 'evacuee:PERSON1',
			item_id: 'item:blanket',
			qty: '1',
			unit: 'ผืน',
			distribution_type_snapshot: 'one_time' as const,
			eligibility_snapshot: eligibility,
			idempotency_key: ''
		};
		expect(distributionIssueInputSchema.safeParse(input).success).toBe(false);
		expect(() => createDistributionIssue(input, ctx)).toThrow();
	});

	it('creates an issue with the approved ULID-style ID contract', () => {
		const issue = createDistributionIssue(
			{
				batch_id: 'distribution_batch:REQUEST1',
				evacuee_id: 'evacuee:PERSON1',
				item_id: 'item:blanket',
				qty: '1',
				unit: 'ผืน',
				distribution_type_snapshot: 'one_time',
				eligibility_snapshot: eligibility,
				idempotency_key: 'device-operation-1'
			},
			ctx,
			'01JABCDEFGHJKMNPQRSTVWXYZ0'
		);
		expect(issue._id).toBe('distribution_issue:01JABCDEFGHJKMNPQRSTVWXYZ0');
		expect(issue.distributed_by).toBe(ctx.createdBy);
		expect(issue.idempotency_key).toBe('device-operation-1');
	});

	it('defines recoverable reservation claim identity without implementing CAS', () => {
		const reservation = createStockLotReservation(
			{
				lot_ref: 'stock_ledger:LOT1',
				pending_claims: [
					{
						operation_id: 'approval-operation-1',
						request_id: 'distribution_request:REQUEST1',
						batch_id: 'distribution_batch:REQUEST1',
						item_id: 'item:soap',
						lot_ref: 'stock_ledger:LOT1',
						qty: '5',
						claimed_at: '2026-08-29T00:00:00Z'
					}
				]
			},
			'LOT1HASH',
			ctx
		);
		expect(reservation._id).toBe('stock_lot_reservation:LOT1HASH');
		expect(reservation.pending_claims[0]).toMatchObject({
			operation_id: 'approval-operation-1',
			request_id: 'distribution_request:REQUEST1',
			batch_id: 'distribution_batch:REQUEST1',
			item_id: 'item:soap',
			lot_ref: 'stock_ledger:LOT1',
			qty: '5'
		});
	});
});
