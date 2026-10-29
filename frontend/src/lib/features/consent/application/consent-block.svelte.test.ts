import { describe, expect, it } from 'vitest';
import { ConsentBlockState, type ConsentGate } from './consent-block.svelte';

const STAFF = { name: 'สมศรี อาสา', userId: 'vol0427' };
const T0 = new Date('2026-10-25T03:00:00.000Z');
const T1 = new Date('2026-10-25T03:05:00.000Z');

function decided(gate: ConsentGate) {
	if (gate.kind !== 'decided') throw new Error(`expected a decision, got ${gate.kind}`);
	return gate.decision;
}

describe('ConsentBlockState defaults', () => {
	it('starts with only C3 ticked for new people (FR-12)', () => {
		const block = new ConsentBlockState({ channel: 'staff', staff: STAFF });
		expect([block.full, block.health, block.searchVisible, block.verbal]).toEqual([
			false,
			false,
			true,
			false
		]);
	});

	it('keeps an existing opt-out unticked (FR-12)', () => {
		const block = new ConsentBlockState({ channel: 'staff', initialSearchVisible: false });
		expect(block.searchVisible).toBe(false);
	});

	it('shows C5 only on the staff channel with a logged-in user (FR-15)', () => {
		expect(new ConsentBlockState({ channel: 'staff', staff: STAFF }).showsVerbal).toBe(true);
		expect(new ConsentBlockState({ channel: 'staff', staff: null }).showsVerbal).toBe(false);
		expect(new ConsentBlockState({ channel: 'web', staff: STAFF }).showsVerbal).toBe(false);
	});
});

describe('ConsentBlockState.confirm', () => {
	it('refuses to decide while C1 is unticked (FR-11)', () => {
		const block = new ConsentBlockState({ channel: 'staff', staff: STAFF });
		block.health = true;
		expect(block.canConfirm).toBe(false);
		expect(block.confirm(T0)).toEqual({ kind: 'needs-main' });
	});

	it('decides full with the ticked boxes when C1 is ticked', () => {
		const block = new ConsentBlockState({ channel: 'staff', staff: STAFF });
		block.full = true;
		block.health = true;
		block.verbal = true;
		expect(block.canConfirm).toBe(true);
		expect(decided(block.confirm(T0))).toMatchObject({
			mode: 'full',
			health: true,
			search_visible: true,
			guardian_for: [],
			verbal: true,
			given_at: T0.toISOString()
		});
	});

	it('never records verbal consent off the staff channel', () => {
		const block = new ConsentBlockState({ channel: 'web', staff: STAFF });
		block.full = true;
		block.verbal = true;
		expect(decided(block.confirm(T0)).verbal).toBe(false);
	});
});

describe('ConsentBlockState.acceptAll (FR-17)', () => {
	it('ticks C1–C3 but never C5', () => {
		const block = new ConsentBlockState({
			channel: 'staff',
			staff: STAFF,
			initialSearchVisible: false
		});
		block.acceptAll();
		expect([block.full, block.health, block.searchVisible, block.verbal]).toEqual([
			true,
			true,
			true,
			false
		]);
	});
});

describe('medical discard warning (FR-16)', () => {
	it('warns when medical input exists without full + health consent', () => {
		const block = new ConsentBlockState({ channel: 'staff' });
		block.health = true;
		expect(block.discardsMedical(true)).toBe(true);
		block.full = true;
		expect(block.discardsMedical(true)).toBe(false);
		expect(block.discardsMedical(false)).toBe(false);
	});
});

describe('consent stamp reuse', () => {
	it('reuses ref and given_at while the choice is unchanged', () => {
		const block = new ConsentBlockState({ channel: 'staff' });
		block.full = true;
		const first = decided(block.confirm(T0));
		const retry = decided(block.confirm(T1));
		expect(retry.ref).toBe(first.ref);
		expect(retry.given_at).toBe(T0.toISOString());
	});

	it('mints a new stamp when the choice changes', () => {
		const block = new ConsentBlockState({ channel: 'staff' });
		block.full = true;
		const first = decided(block.confirm(T0));
		block.health = true;
		const changed = decided(block.confirm(T1));
		expect(changed.ref).not.toBe(first.ref);
		expect(changed.given_at).toBe(T1.toISOString());
	});
});
