import { describe, it, expect } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import type { ItemMaster } from '$lib/features/catalog';
import { addQty } from '$lib/utils/qty';
import {
	ItemMergeError,
	checkItemMerge,
	planItemMerge,
	type PlanItemMergeInput
} from './item-merge';
import {
	createStockLedger,
	projectStockLotBalances,
	stockBalance,
	stockLedgerInputSchema,
	type StockLedger
} from './operations';

const SH = 'SH001';
const ctx: AuthorContext = { shelterCode: SH, createdBy: 'staff1' };
const DONATION_REF = 'donation:01JFIXTUREDONATION';

const SA = ['system_admin'];
const MANAGER = ['shelter:SH001', 'SH001:shelter_manager'];
const WAREHOUSE = ['shelter:SH001', 'SH001:warehouse_staff'];
const COORDINATOR = ['shelter:SH001', 'SH001:supply_coordinator'];
const OTHER_SHELTER_MANAGER = ['shelter:SH002', 'SH002:shelter_manager'];

function master(over: Partial<ItemMaster> & { _id: string; name: string }): ItemMaster {
	return {
		type: 'item_master',
		schema_v: 4,
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'seed',
		base_unit: 'bottle',
		conversions: [],
		type_class: 'CONSUMABLE',
		dietary: [],
		...over
	} as ItemMaster;
}

/** A shelter-local duplicate and a second local item to merge it into. */
const localA = master({ _id: 'item_master:A', name: 'นมถั่วเหลือง 300 มล.', shelter_code: SH });
const localB = master({ _id: 'item_master:B', name: 'นมถั่วเหลือง 300ml', shelter_code: SH });
const centralA = master({ _id: 'item_master:CA', name: 'น้ำดื่ม (ซ้ำ)' });
const centralB = master({ _id: 'item_master:CB', name: 'น้ำดื่ม' });

function receive(
	itemId: string,
	qty: string,
	lot: Record<string, unknown>,
	occurredAt: string,
	unit = 'bottle'
): StockLedger {
	return createStockLedger(
		{
			item_id: itemId,
			qty,
			unit,
			reason: 'donation',
			ref_id: DONATION_REF,
			lot,
			occurred_at: occurredAt
		},
		ctx
	);
}

/** A: two lots (24 + 6). */
function twoLotLedger(): StockLedger[] {
	return [
		receive(
			'item_master:A',
			'24',
			{
				expiry: '2026-12-01',
				produced_at: '2026-09-01T00:00:00.000Z',
				storage_point_id: 'p1',
				storage_zone: 'ห้องเย็น'
			},
			'2026-10-01T01:00:00.000Z'
		),
		receive('item_master:A', '6', { expiry: '2027-01-01' }, '2026-10-02T01:00:00.000Z')
	];
}

function input(over: Partial<PlanItemMergeInput> = {}): PlanItemMergeInput {
	return {
		source: localA,
		target: localB,
		roles: MANAGER,
		shelterCode: SH,
		ledger: twoLotLedger(),
		ctx,
		occurredAt: '2026-10-07T00:00:00.000Z',
		...over
	};
}

describe('AC-F1 — merge A (2 lots, 24 + 6) into B', () => {
	it('writes 4 merge rows, empties A and adds 30 to B', async () => {
		const ledger = twoLotLedger();
		const plan = await planItemMerge(input({ ledger }));

		expect(plan.entries).toHaveLength(4);
		for (const row of plan.entries) {
			expect(row.reason).toBe('adjust');
			expect(row.adjust_reason).toBe('merge');
			expect(row.ref_id).toBeNull();
			expect(row.schema_v).toBe(6);
			// each row passes the same Zod gate the factory uses
			expect(
				stockLedgerInputSchema.safeParse({
					item_id: row.item_id,
					qty: row.qty,
					unit: row.unit,
					reason: row.reason,
					ref_id: row.ref_id,
					lot_ref: row.lot_ref,
					adjust_reason: row.adjust_reason,
					note: row.note
				}).success
			).toBe(true);
		}

		const after = [...ledger, ...plan.entries];
		const balance = stockBalance(after);
		expect(balance.get('item_master:A')).toBe('0');
		expect(balance.get('item_master:B')).toBe('30');
		// A's lots all read zero, B has two lots
		expect(
			projectStockLotBalances(after.filter((e) => e.item_id === 'item_master:A')).every(
				(l) => l.qty === '0'
			)
		).toBe(true);
		expect(
			projectStockLotBalances(after.filter((e) => e.item_id === 'item_master:B'))
		).toHaveLength(2);
	});

	it('FR-F1 — each pair names the other side in note, out row targets the source lot', async () => {
		const ledger = twoLotLedger();
		const plan = await planItemMerge(input({ ledger }));
		const outs = plan.entries.filter((e) => e.item_id === 'item_master:A');
		const ins = plan.entries.filter((e) => e.item_id === 'item_master:B');

		expect(outs.map((e) => e.qty).sort()).toEqual(['-24', '-6']);
		expect(ins.map((e) => e.qty).sort()).toEqual(['24', '6']);
		expect(outs.every((e) => e.note === 'item_master:B')).toBe(true);
		expect(ins.every((e) => e.note === 'item_master:A')).toBe(true);
		expect(new Set(outs.map((e) => e.lot_ref))).toEqual(new Set(ledger.map((e) => e._id)));
		// the destination row is a NEW physical lot (its own _id)
		for (const row of ins) expect(row.lot_ref).toBe(row._id);
	});

	it('FR-F1 — the destination lot keeps expiry, produced_at and storage point', async () => {
		const plan = await planItemMerge(input());
		const moved = plan.entries.find((e) => e.item_id === 'item_master:B' && e.qty === '24');
		expect(moved?.lot).toMatchObject({
			expiry: '2026-12-01',
			produced_at: '2026-09-01T00:00:00.000Z',
			storage_point_id: 'p1',
			storage_zone: 'ห้องเย็น'
		});
	});

	it('FR-F1 — skips empty lots and moves only what is left of a part-used lot', async () => {
		const ledger = twoLotLedger();
		const used = createStockLedger(
			{
				item_id: 'item_master:A',
				qty: '-24',
				unit: 'bottle',
				reason: 'distribute',
				ref_id: 'requisition_ticket:01JFIXTURETICKET',
				lot_ref: ledger[0]._id,
				occurred_at: '2026-10-03T00:00:00.000Z'
			},
			ctx
		);
		const plan = await planItemMerge(input({ ledger: [...ledger, used] }));
		expect(plan.entries).toHaveLength(2);
		expect(plan.legs.map((l) => l.sourceQty)).toEqual(['6']);
	});

	it('FR-F2 — returns the source deactivated with merged_into and schema_v 5', async () => {
		const plan = await planItemMerge(input());
		expect(plan.source).toMatchObject({
			_id: 'item_master:A',
			merged_into: 'item_master:B',
			deactivated: true,
			schema_v: 5
		});
	});

	it('merges an item that has no stock: no rows, still deactivated', async () => {
		const plan = await planItemMerge(input({ ledger: [] }));
		expect(plan.entries).toEqual([]);
		expect(plan.source.merged_into).toBe('item_master:B');
	});

	it('uses deterministic ids, so a double submit hits a conflict instead of moving stock twice', async () => {
		const ledger = twoLotLedger();
		const a = await planItemMerge(input({ ledger }));
		const b = await planItemMerge(input({ ledger }));
		expect(a.entries.map((e) => e._id)).toEqual(b.entries.map((e) => e._id));
		expect(new Set(a.entries.map((e) => e._id)).size).toBe(4);
	});
});

describe('AC-F2 / FR-F3 — base units', () => {
	const bottles = localA;
	const litres = master({
		_id: 'item_master:L',
		name: 'น้ำ (ลิตร)',
		base_unit: 'liter',
		shelter_code: SH
	});

	it('AC-F2 — refuses incompatible base units and writes nothing', async () => {
		await expect(planItemMerge(input({ target: litres }))).rejects.toMatchObject({
			name: 'ItemMergeError',
			code: 'unit_mismatch'
		});
		expect(
			checkItemMerge({ source: bottles, target: litres, roles: MANAGER, shelterCode: SH })?.code
		).toBe('unit_mismatch');
	});

	it('merges across units when the destination lists the source unit as a conversion', async () => {
		// B counts in packs; 1 bottle = 0.5 pack  (i.e. destination: 1 bottle = 0.5 pack)
		const packs = master({
			_id: 'item_master:P',
			name: 'นม (แพ็ค)',
			base_unit: 'pack',
			shelter_code: SH,
			conversions: [{ uom_name: 'bottle', multiplier: '0.5' }]
		});
		const plan = await planItemMerge(input({ target: packs }));
		const ins = plan.entries.filter((e) => e.item_id === 'item_master:P');
		expect(ins.map((e) => e.qty).sort()).toEqual(['12', '3']);
		expect(ins.every((e) => e.unit === 'pack')).toBe(true);
		expect(
			plan.entries.filter((e) => e.item_id === 'item_master:A').every((e) => e.unit === 'bottle')
		).toBe(true);
	});

	it('merges when the source lists the destination unit (divides)', async () => {
		const crates = master({
			_id: 'item_master:S',
			name: 'นม (ขวด)',
			base_unit: 'bottle',
			shelter_code: SH,
			conversions: [{ uom_name: 'crate', multiplier: '6' }]
		});
		const crate = master({
			_id: 'item_master:C',
			name: 'นม (ลัง)',
			base_unit: 'crate',
			shelter_code: SH
		});
		const plan = await planItemMerge(
			input({ source: { ...crates, _id: 'item_master:A' }, target: crate })
		);
		const ins = plan.entries.filter((e) => e.item_id === 'item_master:C');
		expect(ins.map((e) => e.qty).sort()).toEqual(['1', '4']);
	});

	it('refuses a conversion that does not divide a lot exactly (no silent rounding)', async () => {
		const src = master({
			_id: 'item_master:A',
			name: 'A',
			base_unit: 'bottle',
			shelter_code: SH,
			conversions: [{ uom_name: 'crate', multiplier: '7' }]
		});
		const crate = master({
			_id: 'item_master:C',
			name: 'ลัง',
			base_unit: 'crate',
			shelter_code: SH
		});
		await expect(planItemMerge(input({ source: src, target: crate }))).rejects.toMatchObject({
			code: 'unit_mismatch'
		});
	});
});

describe('AC-F3 / FR-F4 — who may merge', () => {
	it('AC-F3 — warehouse_staff may not merge a central item', async () => {
		const ledger = [receive('item_master:CA', '5', {}, '2026-10-01T00:00:00.000Z')];
		await expect(
			planItemMerge(input({ source: centralA, target: centralB, roles: WAREHOUSE, ledger }))
		).rejects.toMatchObject({ code: 'forbidden' });
		await expect(
			planItemMerge(input({ source: centralA, target: centralB, roles: MANAGER, ledger }))
		).rejects.toBeInstanceOf(ItemMergeError);
	});

	it('a system admin may merge a central item', async () => {
		const ledger = [receive('item_master:CA', '5', {}, '2026-10-01T00:00:00.000Z')];
		const plan = await planItemMerge(
			input({ source: centralA, target: centralB, roles: SA, ledger })
		);
		expect(plan.entries).toHaveLength(2);
		expect(stockBalance([...ledger, ...plan.entries]).get('item_master:CB')).toBe('5');
	});

	it.each([
		['system_admin', SA],
		['shelter_manager of the shelter', MANAGER],
		['warehouse_staff of the shelter', WAREHOUSE]
	])('%s may merge a shelter-local item', (_label, roles) => {
		expect(checkItemMerge({ source: localA, target: localB, roles, shelterCode: SH })).toBeNull();
	});

	it('a supply_coordinator, another shelter, and no roles may not', () => {
		for (const roles of [COORDINATOR, OTHER_SHELTER_MANAGER, []]) {
			expect(checkItemMerge({ source: localA, target: localB, roles, shelterCode: SH })?.code).toBe(
				'forbidden'
			);
		}
	});

	it('a shelter override of a central item counts as central (SA only)', () => {
		const override = master({ _id: 'item_master:CA', name: 'x', shelter_code: SH, override: true });
		expect(
			checkItemMerge({ source: override, target: centralB, roles: MANAGER, shelterCode: SH })?.code
		).toBe('forbidden');
		expect(
			checkItemMerge({ source: override, target: centralB, roles: SA, shelterCode: SH })
		).toBeNull();
	});
});

describe('target / source validity', () => {
	it('refuses merging an item into itself', () => {
		expect(
			checkItemMerge({ source: localA, target: localA, roles: MANAGER, shelterCode: SH })?.code
		).toBe('same_item');
	});

	it('refuses a deactivated or already-merged destination', () => {
		const dead = { ...localB, deactivated: true };
		const merged = { ...localB, merged_into: 'item_master:Z', deactivated: true };
		for (const target of [dead, merged]) {
			expect(
				checkItemMerge({ source: localA, target, roles: MANAGER, shelterCode: SH })?.code
			).toBe('invalid_target');
		}
	});

	it("refuses another shelter's local item as the destination", () => {
		const foreign = master({ _id: 'item_master:F', name: 'f', shelter_code: 'SH002' });
		expect(
			checkItemMerge({ source: localA, target: foreign, roles: SA, shelterCode: SH })?.code
		).toBe('invalid_target');
	});

	it('refuses a central source into a shelter-local destination', () => {
		expect(
			checkItemMerge({ source: centralA, target: localB, roles: SA, shelterCode: SH })?.code
		).toBe('invalid_target');
	});

	it('allows a shelter-local source into a central destination', () => {
		expect(
			checkItemMerge({ source: localA, target: centralB, roles: MANAGER, shelterCode: SH })
		).toBeNull();
	});

	it('refuses a source already merged elsewhere but lets a half-finished merge resume', () => {
		const mergedElsewhere = { ...localA, merged_into: 'item_master:Z', deactivated: true };
		expect(
			checkItemMerge({ source: mergedElsewhere, target: localB, roles: MANAGER, shelterCode: SH })
				?.code
		).toBe('already_merged');
		const resumable = { ...localA, merged_into: 'item_master:B', deactivated: true };
		expect(
			checkItemMerge({ source: resumable, target: localB, roles: MANAGER, shelterCode: SH })
		).toBeNull();
	});
});

describe('conservation', () => {
	it('the total on hand across both items is unchanged by the merge', async () => {
		const ledger = [
			...twoLotLedger(),
			receive('item_master:B', '10', { expiry: '2026-11-01' }, '2026-10-01T02:00:00.000Z')
		];
		const before = stockBalance(ledger);
		const plan = await planItemMerge(input({ ledger }));
		const after = stockBalance([...ledger, ...plan.entries]);
		expect(addQty(after.get('item_master:A') ?? '0', after.get('item_master:B') ?? '0')).toBe(
			addQty(before.get('item_master:A') ?? '0', before.get('item_master:B') ?? '0')
		);
		expect(after.get('item_master:B')).toBe('40');
	});
});
