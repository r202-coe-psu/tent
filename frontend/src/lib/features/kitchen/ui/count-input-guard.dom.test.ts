// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { EDIT_REJECTION_MESSAGE } from '../domain/count-input';
import { CountInputGuard } from './count-input-guard.svelte';

const detachers: (() => void)[] = [];

afterEach(() => {
	for (const detach of detachers.splice(0)) detach();
	document.body.innerHTML = '';
});

function guardedBox(guard: CountInputGuard, id: string): HTMLInputElement {
	const input = document.createElement('input');
	input.type = 'number';
	document.body.append(input);
	const detach = guard.attach(id)(input);
	if (detach) detachers.push(detach);
	return input;
}

/** What a browser reports while the box shows text it cannot parse, such as `4-`. */
function typeUnparsable(input: HTMLInputElement): void {
	Object.defineProperty(input, 'validity', {
		configurable: true,
		get: () => ({ badInput: true })
	});
	input.value = '';
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

function typeNumber(input: HTMLInputElement, value: string): void {
	delete (input as { validity?: ValidityState }).validity;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('CountInputGuard.unparsed', () => {
	it('flags a box showing unparsable text and shows the non-numeric note', () => {
		const guard = new CountInputGuard();
		const input = guardedBox(guard, 'adults');

		typeUnparsable(input);

		expect(guard.unparsed.adults).toBe(true);
		expect(guard.messages.adults).toBe(EDIT_REJECTION_MESSAGE['non-numeric']);
	});

	it('clears the flag and the note once the box holds a number again', () => {
		const guard = new CountInputGuard();
		const input = guardedBox(guard, 'adults');
		typeUnparsable(input);

		typeNumber(input, '4');

		expect(guard.unparsed.adults).toBeUndefined();
		expect(guard.messages.adults).toBeUndefined();
	});

	it('clears the flag when the box is emptied, so an empty box is not taken as unparsable', () => {
		const guard = new CountInputGuard();
		const input = guardedBox(guard, 'adults');
		typeUnparsable(input);

		typeNumber(input, '');

		expect(guard.unparsed.adults).toBeUndefined();
	});

	it('flags only the box that holds unparsable text', () => {
		const guard = new CountInputGuard();
		const adults = guardedBox(guard, 'adults');
		const infants = guardedBox(guard, 'infants');

		typeUnparsable(adults);
		typeNumber(infants, '2');

		expect(guard.unparsed).toEqual({ adults: true });
	});

	it('drops the flag when the box is detached', () => {
		const guard = new CountInputGuard();
		const input = guardedBox(guard, 'adults');
		typeUnparsable(input);

		detachers.pop()?.();

		expect(guard.unparsed.adults).toBeUndefined();
		expect(guard.messages.adults).toBeUndefined();
	});

	it('leaves a box with a valid number unflagged', () => {
		const guard = new CountInputGuard();
		const input = guardedBox(guard, 'adults');

		typeNumber(input, '12');

		expect(guard.unparsed.adults).toBeUndefined();
		expect(guard.messages.adults).toBeUndefined();
	});
});
