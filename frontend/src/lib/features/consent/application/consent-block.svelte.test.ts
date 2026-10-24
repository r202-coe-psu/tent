import { describe, expect, it } from 'vitest';
import { ConsentBlockState, type ConsentGate } from './consent-block.svelte';

const STAFF = { name: 'สมศรี อาสา', userId: 'vol0427' };
const KEYS = ['m2', 'm3'];
const T0 = new Date('2026-10-25T03:00:00.000Z');
const T1 = new Date('2026-10-25T03:05:00.000Z');

function decided(gate: ConsentGate) {
	if (gate.kind !== 'decided') throw new Error(`expected a decision, got ${gate.kind}`);
	return gate.decision;
}

describe('ConsentBlockState defaults', () => {
	it('starts with only C3 ticked for new people (FR-12)', () => {
		const block = new ConsentBlockState({ channel: 'staff', staff: STAFF });
		expect([block.full, block.health, block.searchVisible, block.guardian, block.verbal]).toEqual([
			false,
			false,
			true,
			false,
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
	it('opens the basic notice instead of deciding when C1 is unticked (FR-17)', () => {
		const block = new ConsentBlockState({ channel: 'staff', staff: STAFF });
		expect(block.confirm(KEYS, T0)).toEqual({ kind: 'needs-basic-confirm' });
		expect(block.noticeVisible).toBe(true);
	});

	it('decides full with the ticked boxes when C1 is ticked', () => {
		const block = new ConsentBlockState({ channel: 'staff', staff: STAFF });
		block.full = true;
		block.health = true;
		block.verbal = true;
		expect(decided(block.confirm(KEYS, T0))).toMatchObject({
			mode: 'full',
			health: true,
			search_visible: true,
			guardian_for: [],
			verbal: true,
			given_at: T0.toISOString()
		});
	});

	it('keeps asking for the basic confirm after a decline even with C1 ticked', () => {
		const block = new ConsentBlockState({ channel: 'staff' });
		block.full = true;
		block.decline();
		expect(block.confirm(KEYS, T0).kind).toBe('needs-basic-confirm');
	});
});

describe('ConsentBlockState.confirmBasic', () => {
	it('records C2 and C3 as refused whatever their ticks (FR-11)', () => {
		const block = new ConsentBlockState({ channel: 'staff', staff: STAFF });
		block.health = true;
		block.searchVisible = true;
		const decision = decided(block.confirmBasic(KEYS, T0));
		expect(decision.mode).toBe('basic');
		expect(decision).not.toHaveProperty('health');
		expect(decision).not.toHaveProperty('search_visible');
	});
});

describe('basic notice visibility (FR-17/FR-18)', () => {
	it('hides the notice when C1 gets ticked', () => {
		const block = new ConsentBlockState({ channel: 'staff' });
		block.decline();
		block.full = true;
		expect(block.noticeVisible).toBe(false);
	});

	it('hides the notice on back-to-choosing', () => {
		const block = new ConsentBlockState({ channel: 'staff' });
		block.decline();
		block.backToChoosing();
		expect(block.noticeVisible).toBe(false);
	});
});

describe('guardian picks (FR-13/FR-14)', () => {
	it('blocks confirming while C4 is ticked with nobody picked', () => {
		const block = new ConsentBlockState({ channel: 'staff' });
		block.full = true;
		block.guardian = true;
		expect(block.canConfirm(KEYS)).toBe(false);
		expect(block.confirm(KEYS, T0)).toEqual({ kind: 'needs-guardian-pick' });
		expect(block.confirmBasic(KEYS, T0)).toEqual({ kind: 'needs-guardian-pick' });
	});

	it('records picks in form order and drops members that left the form', () => {
		const block = new ConsentBlockState({ channel: 'staff' });
		block.full = true;
		block.guardian = true;
		block.setGuardianPick('m3', true);
		block.setGuardianPick('gone', true);
		block.setGuardianPick('m2', true);
		expect(decided(block.confirm(KEYS, T0)).guardian_for).toEqual(['m2', 'm3']);
	});

	it('ignores picks while C4 is unticked', () => {
		const block = new ConsentBlockState({ channel: 'staff' });
		block.full = true;
		block.setGuardianPick('m2', true);
		expect(decided(block.confirm(KEYS, T0)).guardian_for).toEqual([]);
	});

	it('does not block when there is no member to pick', () => {
		const block = new ConsentBlockState({ channel: 'staff' });
		block.guardian = true;
		expect(block.canConfirm([])).toBe(true);
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
		const first = decided(block.confirm(KEYS, T0));
		const retry = decided(block.confirm(KEYS, T1));
		expect(retry.ref).toBe(first.ref);
		expect(retry.given_at).toBe(T0.toISOString());
	});

	it('mints a new stamp when the choice changes', () => {
		const block = new ConsentBlockState({ channel: 'staff' });
		block.full = true;
		const first = decided(block.confirm(KEYS, T0));
		block.health = true;
		const changed = decided(block.confirm(KEYS, T1));
		expect(changed.ref).not.toBe(first.ref);
		expect(changed.given_at).toBe(T1.toISOString());
	});

	it('ignores C2/C3 ticks in basic mode when deciding whether the choice changed', () => {
		const block = new ConsentBlockState({ channel: 'staff' });
		const first = decided(block.confirmBasic(KEYS, T0));
		block.health = true;
		expect(decided(block.confirmBasic(KEYS, T1)).ref).toBe(first.ref);
	});
});
