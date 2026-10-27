import { describe, it, expect, beforeEach } from 'vitest';
import { ulid } from '$lib/db/ulid';
import type { AuthorContext } from '$lib/db/model';
import type {
	DistributionLog,
	DistributionLogInput,
	Flow2RequisitionTicket,
	RequisitionTicket,
	RequisitionTicketInput
} from '../../domain/food-supplies';
import { createDistributionLog } from '../../domain/food-supplies';
import { deriveDeterministicLedgerId, type StockLedger } from '$lib/features/operations';
import type {
	DistributionLogListFilter,
	DistributionLogRepository,
	RecordReturnInput,
	RecordClearInput,
	RequisitionTicketRepository
} from '../../data/food-supplies';
import { DistributionDataIntegrityError } from './errors';
import {
	recordFoodDistribution,
	recordSuppliesDistribution,
	voidDistributionLog
} from './distribution-workflow';

class InMemoryTicketRepository implements RequisitionTicketRepository {
	tickets = new Map<string, RequisitionTicket>();

	async create(
		input: RequisitionTicketInput | Flow2RequisitionTicket,
		ctx: AuthorContext
	): Promise<Flow2RequisitionTicket> {
		const id = `requisition_ticket:${ulid()}`;
		const doc = {
			_id: id,
			type: 'requisition_ticket',
			schema_v: 1,
			shelter_code: ctx.shelterCode,
			ticket_no: `TKT-${input.requisition_type.toUpperCase()}-0001`,
			requisition_type: input.requisition_type,
			meal: 'meal' in input ? input.meal : undefined,
			source_location: input.source_location,
			destination_location: input.destination_location,
			status: 'DISTRIBUTING' as const,
			requested_by: ctx.createdBy,
			items: input.items.map((i) => {
				const item = i as { requested_qty: string; allocated_qty?: string };
				return {
					...i,
					allocated_qty: item.allocated_qty ?? item.requested_qty
				};
			}),
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: ctx.createdBy
		} as unknown as Flow2RequisitionTicket;
		this.tickets.set(id, doc);
		return doc;
	}

	async get(ticketId: string): Promise<RequisitionTicket | null> {
		return this.tickets.get(ticketId) ?? null;
	}

	async list(): Promise<RequisitionTicket[]> {
		return Array.from(this.tickets.values());
	}

	async mutateTicketCAS(
		ticketId: string,
		mutator: (current: RequisitionTicket) => RequisitionTicket,
		_ctx: AuthorContext
	): Promise<RequisitionTicket> {
		void _ctx;
		const current = this.tickets.get(ticketId);
		if (!current) throw new Error('Not found');
		const updated = mutator(current);
		this.tickets.set(ticketId, updated);
		return updated;
	}

	async transitionTicket(
		ticketId: string,
		toStatus: RequisitionTicket['status'],
		_ctx: AuthorContext,
		patch?: Partial<RequisitionTicket>
	): Promise<RequisitionTicket> {
		void _ctx;
		const current = this.tickets.get(ticketId);
		if (!current) throw new Error('Not found');
		const updated = {
			...current,
			...patch,
			status: toStatus,
			updated_at: new Date().toISOString()
		};
		this.tickets.set(ticketId, updated);
		return updated;
	}
}

class InMemoryLogRepository implements DistributionLogRepository {
	logs = new Map<string, DistributionLog>();

	async create(
		input: DistributionLogInput | DistributionLog,
		ctx: AuthorContext
	): Promise<DistributionLog> {
		if ('_id' in input && input.type === 'distribution_log') {
			this.logs.set(input._id, input);
			return input;
		}
		const doc = createDistributionLog(input as DistributionLogInput, ctx);
		this.logs.set(doc._id, doc);
		return doc;
	}

	async get(logId: string): Promise<DistributionLog | null> {
		return this.logs.get(logId) ?? null;
	}

	async getMany(ids: readonly string[]) {
		const items = ids.flatMap((id) => this.logs.get(id) ?? []);
		return { items, skipped: [] };
	}

	/** Malformed docs `listWithSkipped` reports as matching the filter (the repo does the matching). */
	skipped: { _id: string; type: string; reason: string }[] = [];

	async list(filter?: DistributionLogListFilter): Promise<DistributionLog[]> {
		return (await this.listWithSkipped(filter)).items;
	}

	async listWithSkipped(filter?: DistributionLogListFilter) {
		const items = Array.from(this.logs.values()).filter((l) => {
			if (filter?.ticket_id && l.ticket_id !== filter.ticket_id) return false;
			if (filter?.item_id && l.item_id !== filter.item_id) return false;
			if (filter?.recipient_id && l.recipient_id !== filter.recipient_id) return false;
			return true;
		});
		return { items, skipped: this.skipped };
	}

	async mutateLogCAS(
		logId: string,
		mutator: (current: DistributionLog) => DistributionLog
	): Promise<DistributionLog> {
		const current = this.logs.get(logId);
		if (!current) throw new Error('Not found');
		const updated = mutator(current);
		this.logs.set(logId, updated);
		return updated;
	}

	async recordReturn(
		logId: string,
		input: RecordReturnInput,
		ctx: AuthorContext
	): Promise<DistributionLog> {
		return this.mutateLogCAS(logId, (l) => ({
			...l,
			status: input.qty_returned === l.qty ? 'returned' : 'partially_returned',
			qty_returned: input.qty_returned,
			clear_reason: input.clear_reason,
			condition_on_return: input.condition_on_return,
			bulk_pool_id: input.bulk_pool_id,
			returned_at: new Date().toISOString(),
			returned_by: ctx.createdBy
		}));
	}

	async recordClear(
		logId: string,
		input: RecordClearInput,
		ctx: AuthorContext
	): Promise<DistributionLog> {
		return this.mutateLogCAS(logId, (l) => ({
			...l,
			status: input.clear_reason,
			clear_reason: input.clear_reason,
			returned_at: new Date().toISOString(),
			returned_by: ctx.createdBy,
			notes: input.notes
		}));
	}

	async recordVoid(logId: string, ctx: AuthorContext, notes?: string): Promise<DistributionLog> {
		return this.mutateLogCAS(logId, (l) => ({
			...l,
			status: 'voided',
			voided_at: new Date().toISOString(),
			voided_by: ctx.createdBy,
			notes
		}));
	}
}

describe('distribution-workflow', () => {
	let ticketRepo: InMemoryTicketRepository;
	let logRepo: InMemoryLogRepository;
	const POS_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'pos_user',
		roles: ['shelter:SH001', 'SH001:distribution_staff']
	};

	beforeEach(() => {
		ticketRepo = new InMemoryTicketRepository();
		logRepo = new InMemoryLogRepository();
	});

	it('records food handover without mutating requisition_ticket document (AC-DST-02.2)', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0001',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:curry',
						item_name: 'Curry',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '50',
						allocated_qty: '50'
					}
				]
			},
			POS_CTX
		);

		const log = await recordFoodDistribution(
			ticket._id,
			{
				item_id: 'item:curry',
				qty: '2',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01JEVACUEE0000000000000001'
			},
			POS_CTX,
			{ ticketRepo, logRepo }
		);

		expect(log.status).toBe('fulfilled');
		expect(log.is_returnable).toBe(false);
		expect(log.qty).toBe('2');
		expect(log.ticket_id).toBe(ticket._id);

		// Assert ticket is not mutated
		const freshTicket = await ticketRepo.get(ticket._id);
		expect(freshTicket?.items[0].distributed_qty).toBeUndefined();
	});

	it('enforces in-hand capacity limits', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0002',
				requisition_type: 'food',
				meal: 'dinner',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:rice',
						item_name: 'Rice',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '3',
						allocated_qty: '3'
					}
				]
			},
			POS_CTX
		);

		// Distribute 2
		await recordFoodDistribution(
			ticket._id,
			{ item_id: 'item:rice', qty: '2', recipient_type: 'outside' },
			POS_CTX,
			{ ticketRepo, logRepo }
		);

		// Attempting to distribute 2 more (when only 1 in-hand remaining) throws CapacityExceededError
		await expect(
			recordFoodDistribution(
				ticket._id,
				{ item_id: 'item:rice', qty: '2', recipient_type: 'outside' },
				POS_CTX,
				{ ticketRepo, logRepo }
			)
		).rejects.toThrow(/Insufficient in-hand quantity/);
	});

	describe('malformed distribution logs (fail closed)', () => {
		const BAD = {
			_id: 'distribution_log:01JBAD00000000000000000001',
			type: 'distribution_log',
			reason: 'x'
		};
		const makeTicket = () =>
			ticketRepo.create(
				{
					ticket_no: 'TKT-FOOD-0009',
					requisition_type: 'food',
					meal: 'lunch',
					source_location: 'warehouse:main',
					destination_location: 'point:a',
					items: [
						{
							item_id: 'item:curry',
							item_name: 'Curry',
							type_class: 'CONSUMABLE',
							returnable: false,
							requested_qty: '10',
							allocated_qty: '10'
						}
					]
				},
				POS_CTX
			);

		it('refuses to issue when a malformed log matches the ticket item, naming its id', async () => {
			const ticket = await makeTicket();
			logRepo.skipped = [BAD];
			const attempt = recordFoodDistribution(
				ticket._id,
				{ item_id: 'item:curry', qty: '1', recipient_type: 'outside' },
				POS_CTX,
				{ ticketRepo, logRepo }
			);
			await expect(attempt).rejects.toBeInstanceOf(DistributionDataIntegrityError);
			await expect(attempt).rejects.toMatchObject({ docIds: [BAD._id] });
			expect(logRepo.logs.size).toBe(0);
		});

		it('refuses supplies issuance when a malformed log matches the ticket item', async () => {
			const ticket = await ticketRepo.create(
				{
					ticket_no: 'TKT-SUP-0009',
					requisition_type: 'supplies',
					source_location: 'warehouse:main',
					destination_location: 'point:a',
					items: [
						{
							item_id: 'item:soap',
							item_name: 'Soap',
							type_class: 'CONSUMABLE',
							returnable: false,
							requested_qty: '10',
							allocated_qty: '10'
						}
					]
				},
				POS_CTX
			);
			logRepo.skipped = [BAD];
			await expect(
				recordSuppliesDistribution(
					ticket._id,
					{ item_id: 'item:soap', qty: '1', recipient_type: 'outside' },
					POS_CTX,
					{ ticketRepo, logRepo }
				)
			).rejects.toBeInstanceOf(DistributionDataIntegrityError);
		});

		it('does not block when no malformed log matches (unrelated docs are filtered by the repo)', async () => {
			const ticket = await makeTicket();
			logRepo.skipped = [];
			const log = await recordFoodDistribution(
				ticket._id,
				{ item_id: 'item:curry', qty: '1', recipient_type: 'outside' },
				POS_CTX,
				{ ticketRepo, logRepo }
			);
			expect(log.status).toBe('fulfilled');
		});

		it('refuses the duplicate-meal check when a malformed log of the recipient exists', async () => {
			const ticket = await makeTicket();
			// Capacity check passes (nothing skipped for the ticket item); only the recipient read skips.
			const original = logRepo.listWithSkipped.bind(logRepo);
			logRepo.listWithSkipped = async (filter) => {
				const found = await original(filter);
				return filter?.recipient_id ? { ...found, skipped: [BAD] } : { ...found, skipped: [] };
			};
			await expect(
				recordFoodDistribution(
					ticket._id,
					{
						item_id: 'item:curry',
						qty: '1',
						recipient_type: 'evacuee',
						recipient_id: 'evacuee:01JEVACUEE0000000000000009'
					},
					POS_CTX,
					{ ticketRepo, logRepo }
				)
			).rejects.toBeInstanceOf(DistributionDataIntegrityError);
		});
	});

	it('detects duplicate meal for recipient and requires override', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0003',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:curry',
						item_name: 'Curry',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);

		// First distribution
		await recordFoodDistribution(
			ticket._id,
			{
				item_id: 'item:curry',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01JEVACUEE0000000000000002'
			},
			POS_CTX,
			{ ticketRepo, logRepo }
		);

		// Duplicate distribution in same meal without override rejected
		await expect(
			recordFoodDistribution(
				ticket._id,
				{
					item_id: 'item:curry',
					qty: '1',
					recipient_type: 'evacuee',
					recipient_id: 'evacuee:01JEVACUEE0000000000000002'
				},
				POS_CTX,
				{ ticketRepo, logRepo }
			)
		).rejects.toThrow(/already received a meal/);

		// With override accepted
		const overrideLog = await recordFoodDistribution(
			ticket._id,
			{
				item_id: 'item:curry',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01JEVACUEE0000000000000002',
				is_override: true,
				override_reason: 'Extra meal for visiting family elder'
			},
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		expect(overrideLog.is_override).toBe(true);
	});

	it('logs a volunteer recipient by id and blocks their repeat meal (#650)', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0650',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:curry',
						item_name: 'Curry',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);
		const volunteerInput = {
			item_id: 'item:curry',
			qty: '1',
			recipient_type: 'volunteer' as const,
			recipient_id: 'volunteer:01JVOLUNTEER000000000000001',
			menu_check: { recipient_tags: null, menu: { dietary: [], age_group: 'ALL' } }
		};

		const log = await recordFoodDistribution(ticket._id, volunteerInput, POS_CTX, {
			ticketRepo,
			logRepo
		});
		expect(log.recipient_type).toBe('volunteer');
		expect(log.recipient_id).toBe('volunteer:01JVOLUNTEER000000000000001');

		await expect(
			recordFoodDistribution(ticket._id, volunteerInput, POS_CTX, { ticketRepo, logRepo })
		).rejects.toThrow(/already received a meal/);
	});

	it('scopes food entitlement to the Thailand calendar day and ignores voided logs', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0005',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:curry',
						item_name: 'Curry',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					},
					{
						item_id: 'item:rice',
						item_name: 'Rice',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);
		const recipientId = 'evacuee:01JEVACUEE0000000000000005';
		await logRepo.create(
			{
				ticket_id: ticket._id,
				item_id: 'item:curry',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: recipientId,
				meal: 'lunch',
				is_returnable: false,
				is_override: false,
				distributed_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
			},
			POS_CTX
		);

		await expect(
			recordFoodDistribution(
				ticket._id,
				{ item_id: 'item:curry', qty: '1', recipient_type: 'evacuee', recipient_id: recipientId },
				POS_CTX,
				{ ticketRepo, logRepo }
			)
		).resolves.toMatchObject({ status: 'fulfilled' });
		await expect(
			recordFoodDistribution(
				ticket._id,
				{ item_id: 'item:rice', qty: '1', recipient_type: 'evacuee', recipient_id: recipientId },
				POS_CTX,
				{ ticketRepo, logRepo }
			)
		).rejects.toThrow(/already received a meal/);

		const voidedRecipientId = 'evacuee:01JEVACUEE0000000000000006';
		const voided = createDistributionLog(
			{
				ticket_id: ticket._id,
				item_id: 'item:curry',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: voidedRecipientId,
				meal: 'lunch',
				is_returnable: false,
				is_override: false
			},
			POS_CTX
		);
		await logRepo.create(
			{
				...voided,
				status: 'voided',
				voided_at: new Date().toISOString(),
				voided_by: POS_CTX.createdBy
			},
			POS_CTX
		);
		await expect(
			recordFoodDistribution(
				ticket._id,
				{
					item_id: 'item:curry',
					qty: '1',
					recipient_type: 'evacuee',
					recipient_id: voidedRecipientId
				},
				POS_CTX,
				{ ticketRepo, logRepo }
			)
		).resolves.toMatchObject({ status: 'fulfilled' });
	});

	it('applies 4-hour soft warning flag when food exceeds safety window', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0004',
				requisition_type: 'food',
				meal: 'dinner',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:curry',
						item_name: 'Curry',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);

		const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
		const log = await recordFoodDistribution(
			ticket._id,
			{
				item_id: 'item:curry',
				qty: '1',
				recipient_type: 'outside',
				cooking_completed_at: fiveHoursAgo
			},
			POS_CTX,
			{ ticketRepo, logRepo }
		);

		expect(log.is_expired_warning).toBe(true);
	});

	it.each([
		['expired', -60 * 60 * 1000, true],
		['still fresh', 60 * 60 * 1000, false]
	] as const)(
		'stamps is_expired_warning from the dispatched lot expiry when %s (FR-MQW-06 B)',
		async (_label, expiryOffsetMs, expected) => {
			const ticket = await ticketRepo.create(
				{
					ticket_no: `TKT-FOOD-LOT-${expected ? 'OLD' : 'NEW'}`,
					requisition_type: 'food',
					meal: 'lunch',
					source_location: 'warehouse:main',
					destination_location: 'point:a',
					items: [
						{
							item_id: 'item:rice_box',
							item_name: 'Rice Box',
							type_class: 'CONSUMABLE',
							returnable: false,
							requested_qty: '10',
							allocated_qty: '10'
						}
					]
				},
				POS_CTX
			);
			const dispatchId = await deriveDeterministicLedgerId('dispatch', ticket._id, 'item:rice_box');
			const lotId = 'stock_ledger:01JLOT0000000000000000000001';
			const rows = new Map<string, Partial<StockLedger>>([
				[dispatchId, { _id: dispatchId, lot_ref: lotId }],
				[
					lotId,
					{ _id: lotId, lot: { expiry: new Date(Date.now() + expiryOffsetMs).toISOString() } }
				]
			]);
			const ledgerReader = {
				getLedgerEntry: async (id: string) => (rows.get(id) as StockLedger | undefined) ?? null
			};

			const log = await recordFoodDistribution(
				ticket._id,
				{ item_id: 'item:rice_box', qty: '1', recipient_type: 'outside' },
				POS_CTX,
				{ ticketRepo, logRepo, ledgerReader }
			);

			expect(log.is_expired_warning).toBe(expected);
		}
	);

	async function createFoodTicket(itemId: string): Promise<RequisitionTicket> {
		return ticketRepo.create(
			{
				ticket_no: `TKT-FOOD-${itemId}`,
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: itemId,
						item_name: itemId,
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);
	}

	it('rejects registration_staff and supply_coordinator from frontline food handover (CR-161 R3)', async () => {
		const ticket = await createFoodTicket('item:curry');
		for (const roles of [
			['shelter:SH001', 'SH001:registration_staff'],
			['shelter:SH001', 'SH001:supply_coordinator']
		]) {
			await expect(
				recordFoodDistribution(
					ticket._id,
					{ item_id: 'item:curry', qty: '1', recipient_type: 'outside' },
					{ ...POS_CTX, roles },
					{ ticketRepo, logRepo }
				)
			).rejects.toThrow(/frontline distribution operations require distribution_staff/);
		}
		expect(logRepo.logs.size).toBe(0);
	});

	it('records the handover without an expiry warning when the lot lookup fails', async () => {
		const ticket = await createFoodTicket('item:rice_box');
		const ledgerReader = {
			getLedgerEntry: async (): Promise<StockLedger | null> => {
				throw new Error('ledger unavailable');
			}
		};

		const log = await recordFoodDistribution(
			ticket._id,
			{ item_id: 'item:rice_box', qty: '1', recipient_type: 'outside' },
			POS_CTX,
			{ ticketRepo, logRepo, ledgerReader }
		);

		expect(log.status).toBe('fulfilled');
		expect(log.is_expired_warning).toBe(false);
		expect(logRepo.logs.size).toBe(1);
	});

	describe('recipient allergy ↔ menu allergens (#607 FR-MRM-08)', () => {
		const evacueeInput = {
			item_id: 'item:fried_rice',
			qty: '1',
			recipient_type: 'evacuee' as const,
			recipient_id: 'evacuee:01JEVACUEE0000000000000010'
		};
		const egg = {
			recipient_allergy_codes: ['egg'],
			menu_allergen_codes: ['seafood', 'egg']
		};

		it('rejects a conflicting menu without override and writes nothing', async () => {
			const ticket = await createFoodTicket('item:fried_rice');

			await expect(
				recordFoodDistribution(ticket._id, { ...evacueeInput, allergen_check: egg }, POS_CTX, {
					ticketRepo,
					logRepo
				})
			).rejects.toThrow(/allergic to \(egg\)\. Override required/);
			expect(logRepo.logs.size).toBe(0);
		});

		it('records the conflicting codes when overridden', async () => {
			const ticket = await createFoodTicket('item:fried_rice');

			const log = await recordFoodDistribution(
				ticket._id,
				{
					...evacueeInput,
					is_override: true,
					override_reason: 'รับไปให้ลูกที่ไม่แพ้',
					allergen_check: egg
				},
				POS_CTX,
				{ ticketRepo, logRepo }
			);

			expect(log.is_override).toBe(true);
			expect(log.allergen_conflicts).toEqual(['egg']);
		});

		it('records a menu without the recipient allergens normally', async () => {
			const ticket = await createFoodTicket('item:fried_rice');

			const log = await recordFoodDistribution(
				ticket._id,
				{
					...evacueeInput,
					allergen_check: { recipient_allergy_codes: ['egg'], menu_allergen_codes: ['wheat'] }
				},
				POS_CTX,
				{ ticketRepo, logRepo }
			);

			expect(log.is_override).toBeFalsy();
			expect(log.allergen_conflicts).toBeUndefined();
		});
	});

	describe('menu ↔ recipient check (FR-MRM-04)', () => {
		const evacueeInput = {
			item_id: 'item:halal_box',
			qty: '1',
			recipient_type: 'evacuee' as const,
			recipient_id: 'evacuee:01JEVACUEE0000000000000009'
		};

		it('rejects a mismatched menu without override and writes nothing', async () => {
			const ticket = await createFoodTicket('item:halal_box');

			await expect(
				recordFoodDistribution(
					ticket._id,
					{
						...evacueeInput,
						menu_check: { recipient_tags: ['ELDERLY'], menu: { age_group: 'INFANT' } }
					},
					POS_CTX,
					{ ticketRepo, logRepo }
				)
			).rejects.toThrow(/Override required/);
			expect(logRepo.logs.size).toBe(0);
		});

		it('rejects a tagged menu for an untagged (outside) recipient without override', async () => {
			const ticket = await createFoodTicket('item:halal_box');

			await expect(
				recordFoodDistribution(
					ticket._id,
					{
						item_id: 'item:halal_box',
						qty: '1',
						recipient_type: 'outside',
						menu_check: { recipient_tags: null, menu: { age_group: 'INFANT' } }
					},
					POS_CTX,
					{ ticketRepo, logRepo }
				)
			).rejects.toThrow(/Override required/);
			expect(logRepo.logs.size).toBe(0);
		});

		it('records a mismatched menu when overridden', async () => {
			const ticket = await createFoodTicket('item:halal_box');

			const log = await recordFoodDistribution(
				ticket._id,
				{
					...evacueeInput,
					is_override: true,
					override_reason: 'Only infant boxes left',
					menu_check: { recipient_tags: ['ELDERLY'], menu: { age_group: 'INFANT' } }
				},
				POS_CTX,
				{ ticketRepo, logRepo }
			);

			expect(log.is_override).toBe(true);
			expect(logRepo.logs.size).toBe(1);
		});

		it.each([
			['a general (untagged) menu', ['ELDERLY'], { dietary: [], age_group: 'ALL' }],
			['a general menu for an untagged recipient', null, {}],
			['a matching tag', ['HALAL', 'ELDERLY'], { age_group: 'ELDERLY' }],
			['a HALAL menu for a non-muslim (#801)', ['ELDERLY'], { dietary: ['HALAL'] }]
		] as const)('records %s without override', async (_label, recipientTags, menu) => {
			const ticket = await createFoodTicket('item:halal_box');

			const log = await recordFoodDistribution(
				ticket._id,
				{ ...evacueeInput, menu_check: { recipient_tags: recipientTags, menu } },
				POS_CTX,
				{ ticketRepo, logRepo }
			);

			expect(log.status).toBe('fulfilled');
			expect(log.is_override).toBeFalsy();
		});

		it('skips the check when menu_check is omitted', async () => {
			const ticket = await createFoodTicket('item:halal_box');

			const log = await recordFoodDistribution(ticket._id, evacueeInput, POS_CTX, {
				ticketRepo,
				logRepo
			});

			expect(log.status).toBe('fulfilled');
			expect(log.is_override).toBeFalsy();
		});
	});

	it('records supplies consumable and returnable loans correctly', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:supplies',
				items: [
					{
						item_id: 'item:soap',
						item_name: 'Soap',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					},
					{
						item_id: 'item:wheelchair',
						item_name: 'Wheelchair',
						type_class: 'EQUIPMENT',
						returnable: true,
						requested_qty: '5',
						allocated_qty: '5'
					}
				]
			},
			POS_CTX
		);

		// Consumable supplies
		const consumableLog = await recordSuppliesDistribution(
			ticket._id,
			{ item_id: 'item:soap', qty: '2', recipient_type: 'outside' },
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		expect(consumableLog.is_returnable).toBe(false);
		expect(consumableLog.status).toBe('fulfilled');

		// Returnable loan requires recipient
		await expect(
			recordSuppliesDistribution(
				ticket._id,
				{ item_id: 'item:wheelchair', qty: '1', recipient_type: 'outside' },
				POS_CTX,
				{ ticketRepo, logRepo }
			)
		).rejects.toThrow(/identifiable recipient_id/);

		const loanLog = await recordSuppliesDistribution(
			ticket._id,
			{
				item_id: 'item:wheelchair',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01JEVACUEE0000000000000003'
			},
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		expect(loanLog.is_returnable).toBe(true);
		expect(loanLog.status).toBe('active');
	});

	it('voids erroneous distribution log without deleting document', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0002',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:supplies',
				items: [
					{
						item_id: 'item:soap',
						item_name: 'Soap',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);

		const log = await recordSuppliesDistribution(
			ticket._id,
			{ item_id: 'item:soap', qty: '1', recipient_type: 'outside' },
			POS_CTX,
			{ ticketRepo, logRepo }
		);

		const voided = await voidDistributionLog(log._id, 'Duplicate tap error', POS_CTX, logRepo);
		expect(voided.status).toBe('voided');
		expect(voided.voided_by).toBe(POS_CTX.createdBy);
	});

	it('allows voiding an untouched active loan but rejects loans with return or clear activity', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0003',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:supplies',
				items: [
					{
						item_id: 'item:wheelchair',
						item_name: 'Wheelchair',
						type_class: 'EQUIPMENT',
						returnable: true,
						requested_qty: '5',
						allocated_qty: '5'
					}
				]
			},
			POS_CTX
		);
		const loanInput = (recipient_id: string) => ({
			item_id: 'item:wheelchair',
			qty: '1',
			recipient_type: 'evacuee' as const,
			recipient_id
		});
		const active = await recordSuppliesDistribution(
			ticket._id,
			loanInput('evacuee:01JEVACUEE0000000000000010'),
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		await expect(
			voidDistributionLog(active._id, 'Wrong scan', POS_CTX, logRepo)
		).resolves.toMatchObject({
			status: 'voided'
		});

		const partial = await recordSuppliesDistribution(
			ticket._id,
			loanInput('evacuee:01JEVACUEE0000000000000011'),
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		await logRepo.recordReturn(
			partial._id,
			{ qty_returned: '1', clear_reason: 'routine' },
			POS_CTX
		);
		await expect(voidDistributionLog(partial._id, 'Too late', POS_CTX, logRepo)).rejects.toThrow(
			/after.*return|resolution state/
		);

		const returned = await recordSuppliesDistribution(
			ticket._id,
			loanInput('evacuee:01JEVACUEE0000000000000012'),
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		await logRepo.recordReturn(
			returned._id,
			{ qty_returned: '1', clear_reason: 'routine' },
			POS_CTX
		);
		await expect(voidDistributionLog(returned._id, 'Too late', POS_CTX, logRepo)).rejects.toThrow(
			/after return or clear activity|resolution state/
		);

		const lost = await recordSuppliesDistribution(
			ticket._id,
			loanInput('evacuee:01JEVACUEE0000000000000013'),
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		await logRepo.recordClear(lost._id, { clear_reason: 'lost', notes: 'Lost in flood' }, POS_CTX);
		await expect(voidDistributionLog(lost._id, 'Too late', POS_CTX, logRepo)).rejects.toThrow(
			/after return or clear activity|resolution state/
		);

		const waived = await recordSuppliesDistribution(
			ticket._id,
			loanInput('evacuee:01JEVACUEE0000000000000014'),
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		await logRepo.recordClear(
			waived._id,
			{ clear_reason: 'waived', notes: 'Manager approved waiver' },
			POS_CTX
		);
		await expect(voidDistributionLog(waived._id, 'Too late', POS_CTX, logRepo)).rejects.toThrow(
			/after return or clear activity|resolution state/
		);
	});
});
