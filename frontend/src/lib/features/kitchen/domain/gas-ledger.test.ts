import { describe, it, expect } from 'vitest';
import {
	createGasLedgerEntry,
	gasCylinderBalance,
	gasCylinderStatus,
	maxRefillKg,
	type GasLedgerEntry
} from './gas-ledger';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

function entry(
	cylinder_id: string,
	qty_kg: string,
	reason: 'consumption' | 'refill' | 'adjust'
): GasLedgerEntry {
	return createGasLedgerEntry({ cylinder_id, qty_kg, reason }, ctx);
}

describe('createGasLedgerEntry', () => {
	it('generates a ulid _id and stamps schema_v 1', () => {
		const e = createGasLedgerEntry(
			{ cylinder_id: 'gas_cylinder_type:A', qty_kg: '-1', reason: 'consumption' },
			ctx
		);
		expect(e._id).toMatch(/^gas_ledger:[0-9A-Z]{26}$/);
		expect(e.type).toBe('gas_ledger');
		expect(e.schema_v).toBe(1);
	});

	it('defaults ref_id to null when omitted', () => {
		const e = createGasLedgerEntry(
			{ cylinder_id: 'gas_cylinder_type:A', qty_kg: '2', reason: 'refill' },
			ctx
		);
		expect(e.ref_id).toBeNull();
	});

	it('carries ref_id through for a consumption entry', () => {
		const e = createGasLedgerEntry(
			{
				cylinder_id: 'gas_cylinder_type:A',
				qty_kg: '-1.5',
				reason: 'consumption',
				ref_id: 'meal_plan:X'
			},
			ctx
		);
		expect(e.ref_id).toBe('meal_plan:X');
		expect(e.qty_kg).toBe('-1.5');
	});

	it('rejects a zero qty_kg (a real event always has a non-zero delta)', () => {
		expect(() =>
			createGasLedgerEntry(
				{ cylinder_id: 'gas_cylinder_type:A', qty_kg: '0', reason: 'refill' },
				ctx
			)
		).toThrow();
	});

	it('rejects a missing cylinder_id', () => {
		expect(() =>
			createGasLedgerEntry({ cylinder_id: '', qty_kg: '1', reason: 'refill' }, ctx)
		).toThrow();
	});

	// CR-080 addendum — manual write-off for a dust remainder a hard-block
	// consumption flow could never legitimately zero out.
	it('accepts reason "adjust" (write-off addendum)', () => {
		const e = createGasLedgerEntry(
			{ cylinder_id: 'gas_cylinder_type:A', qty_kg: '-0.001', reason: 'adjust' },
			ctx
		);
		expect(e.reason).toBe('adjust');
		expect(e.qty_kg).toBe('-0.001');
	});
});

describe('gasCylinderBalance', () => {
	it('starts at capacity when there are no entries', () => {
		expect(gasCylinderBalance([], 'A', '15')).toBe('15');
	});

	it('sums consumption + refill for the matching cylinder', () => {
		const entries = [entry('A', '-1', 'consumption'), entry('A', '0.3', 'refill')];
		expect(gasCylinderBalance(entries, 'A', '15')).toBe('14.3');
	});

	it('ignores entries belonging to a different cylinder', () => {
		const entries = [entry('A', '-5', 'consumption'), entry('B', '-100', 'consumption')];
		expect(gasCylinderBalance(entries, 'A', '15')).toBe('10');
	});

	it('drives a tank to exactly empty', () => {
		const entries = [entry('A', '-15', 'consumption')];
		expect(gasCylinderBalance(entries, 'A', '15')).toBe('0');
	});

	it('an adjust entry zeroes out a dust remainder', () => {
		const entries = [entry('A', '-14.999', 'consumption'), entry('A', '-0.001', 'adjust')];
		expect(gasCylinderBalance(entries, 'A', '15')).toBe('0');
	});
});

describe('gasCylinderStatus', () => {
	it('unused when remaining equals capacity', () => {
		expect(gasCylinderStatus('15', '15')).toBe('unused');
	});

	it('in_use when partially consumed', () => {
		expect(gasCylinderStatus('7.5', '15')).toBe('in_use');
	});

	it('empty when remaining is exactly zero', () => {
		expect(gasCylinderStatus('0', '15')).toBe('empty');
	});

	it('empty also covers a negative remainder (should never happen, fail safe)', () => {
		expect(gasCylinderStatus('-1', '15')).toBe('empty');
	});
});

describe('maxRefillKg', () => {
	it('is the gap between capacity and current remaining', () => {
		expect(maxRefillKg('10', '15')).toBe('5');
	});

	it('is 0 when the tank is already full', () => {
		expect(maxRefillKg('15', '15')).toBe('0');
	});

	it('clamps to 0 rather than negative when remaining somehow exceeds capacity', () => {
		expect(maxRefillKg('16', '15')).toBe('0');
	});
});
