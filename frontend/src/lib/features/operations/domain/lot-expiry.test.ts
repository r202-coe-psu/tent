import { describe, expect, it } from 'vitest';
import {
	applyExpiryAutofill,
	confirmExpiry,
	editExpiry,
	expiryMissing,
	initialExpiryState,
	type ExpiryState
} from './lot-expiry';

const dry180 = { requiresExpiry: true, shelf_life_days: 180 };
const chilled = { requiresExpiry: true, storage_type: 'CHILLED' as const };
const plainDry = { requiresExpiry: false };

const RECEIVED = '2026-10-02';

describe('lot expiry autofill state (CR-143 FR-D2a–D2c)', () => {
	// AC-D3
	it('fills expiry from shelf life on the receive date and flags it for review', () => {
		const state = applyExpiryAutofill(initialExpiryState(), dry180, '', RECEIVED);
		expect(state).toMatchObject({ value: '2027-03-31', autoFilled: true, shelfLifeDays: 180 });
		expect(expiryMissing(dry180, state)).toBe(false);
	});

	// AC-D4
	it('recalculates when the production date changes and the user has not edited', () => {
		let state = applyExpiryAutofill(initialExpiryState(), dry180, '', RECEIVED);
		state = applyExpiryAutofill(state, dry180, '2026-09-01', RECEIVED);
		expect(state.value).toBe('2027-02-28');
		expect(state.autoFilled).toBe(true);
	});

	// AC-D5
	it('never overwrites a value the user typed, and drops the label', () => {
		let state = applyExpiryAutofill(initialExpiryState(), dry180, '', RECEIVED);
		state = editExpiry(state, '2027-01-15');
		expect(state.autoFilled).toBe(false);
		state = applyExpiryAutofill(state, dry180, '2026-09-01', RECEIVED);
		expect(state.value).toBe('2027-01-15');
		expect(state.autoFilled).toBe(false);
	});

	// AC-D6
	it('keeps the field empty (and therefore unsaveable) once the user clears an autofill', () => {
		let state = applyExpiryAutofill(initialExpiryState(), dry180, '', RECEIVED);
		state = editExpiry(state, '');
		expect(state.value).toBe('');
		expect(expiryMissing(dry180, state)).toBe(true);
		// A later production-date change does not silently refill it.
		state = applyExpiryAutofill(state, dry180, '2026-09-01', RECEIVED);
		expect(state.value).toBe('');
		expect(expiryMissing(dry180, state)).toBe(true);
	});

	// FR-D2c / AC-D1
	it('does not autofill CHILLED / FROZEN items without shelf life', () => {
		const state = applyExpiryAutofill(initialExpiryState(), chilled, '', RECEIVED);
		expect(state).toMatchObject({ value: '', autoFilled: false, shelfLifeDays: null });
		expect(expiryMissing(chilled, state)).toBe(true);
	});

	// AC-D2
	it('does not require or fill an expiry for DRY items without shelf life', () => {
		const state = applyExpiryAutofill(initialExpiryState(), plainDry, '', RECEIVED);
		expect(state.value).toBe('');
		expect(expiryMissing(plainDry, state)).toBe(false);
	});

	it('clears a stale autofill when the item changes to one with no shelf life', () => {
		let state = applyExpiryAutofill(initialExpiryState(), dry180, '', RECEIVED);
		state = applyExpiryAutofill(state, chilled, '', RECEIVED);
		expect(state).toMatchObject({ value: '', autoFilled: false });
	});

	it('clears an autofill when no item is selected', () => {
		let state = applyExpiryAutofill(initialExpiryState(), dry180, '', RECEIVED);
		state = applyExpiryAutofill(state, null, '', RECEIVED);
		expect(state).toMatchObject({ value: '', autoFilled: false });
	});

	it('keeps a user-typed value across an item change', () => {
		let state = editExpiry(initialExpiryState(), '2027-05-05');
		state = applyExpiryAutofill(state, dry180, '', RECEIVED);
		expect(state.value).toBe('2027-05-05');
	});

	it('confirming drops the label and freezes the value', () => {
		let state = applyExpiryAutofill(initialExpiryState(), dry180, '', RECEIVED);
		state = confirmExpiry(state);
		expect(state).toMatchObject({ value: '2027-03-31', autoFilled: false });
		state = applyExpiryAutofill(state, dry180, '2026-09-01', RECEIVED);
		expect(state.value).toBe('2027-03-31');
	});

	it('does not take over the field when the date picker echoes the autofilled value back', () => {
		let state = applyExpiryAutofill(initialExpiryState(), dry180, '', RECEIVED);
		state = editExpiry(state, '2027-03-31');
		expect(state).toMatchObject({ autoFilled: true, touched: false });
		state = applyExpiryAutofill(state, dry180, '2026-09-01', RECEIVED);
		expect(state.value).toBe('2027-02-28');
	});

	it('treats whitespace as empty', () => {
		const state: ExpiryState = editExpiry(initialExpiryState(), '   ');
		expect(state.value).toBe('');
		expect(expiryMissing(chilled, state)).toBe(true);
	});
});
