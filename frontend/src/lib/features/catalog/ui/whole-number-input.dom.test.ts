import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WholeNumberGuard, wholeNumberInput } from './whole-number-input.svelte';

function beforeInput(input: HTMLInputElement, data: string | null, inputType = 'insertText') {
	const event = new InputEvent('beforeinput', { data, inputType, cancelable: true, bubbles: true });
	input.dispatchEvent(event);
	return event;
}

function clipboardEvent(type: 'paste' | 'drop', text: string) {
	const event = new Event(type, { cancelable: true, bubbles: true });
	const data = { getData: () => text };
	Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', {
		value: data
	});
	return event;
}

describe('wholeNumberInput', () => {
	let input: HTMLInputElement;
	let whole: boolean;
	let cleanup: (() => void) | void;
	let refused: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		input = document.createElement('input');
		document.body.append(input);
		whole = true;
		refused = vi.fn();
		cleanup = wholeNumberInput(() => whole, refused)(input);
	});

	afterEach(() => {
		cleanup?.();
		input.remove();
	});

	it('lets digits through', () => {
		expect(beforeInput(input, '7').defaultPrevented).toBe(false);
		expect(refused).not.toHaveBeenCalled();
	});

	it.each(['.', ',', '-', '+', 'e', 'a', ' ', '6.6'])('refuses typing %j', (data) => {
		expect(beforeInput(input, data).defaultPrevented).toBe(true);
		expect(refused).toHaveBeenCalledOnce();
	});

	it('lets deletions through', () => {
		expect(beforeInput(input, null, 'deleteContentBackward').defaultPrevented).toBe(false);
	});

	it('refuses a paste of non-digits and allows a padded whole number', () => {
		const bad = clipboardEvent('paste', '6.6');
		input.dispatchEvent(bad);
		expect(bad.defaultPrevented).toBe(true);

		const ok = clipboardEvent('paste', ' 12\n');
		input.dispatchEvent(ok);
		expect(ok.defaultPrevented).toBe(false);
	});

	it('refuses a beforeinput paste that carries its text', () => {
		expect(beforeInput(input, '1.5', 'insertFromPaste').defaultPrevented).toBe(true);
		expect(beforeInput(input, '15\n', 'insertFromPaste').defaultPrevented).toBe(false);
	});

	it('refuses a drop of non-digit text', () => {
		const drop = clipboardEvent('drop', 'abc');
		input.dispatchEvent(drop);
		expect(drop.defaultPrevented).toBe(true);
	});

	it('does nothing while the unit is not a count unit, and follows unit changes', () => {
		whole = false;
		expect(beforeInput(input, '.').defaultPrevented).toBe(false);
		const paste = clipboardEvent('paste', '0.25');
		input.dispatchEvent(paste);
		expect(paste.defaultPrevented).toBe(false);

		whole = true;
		expect(beforeInput(input, '.').defaultPrevented).toBe(true);
	});

	it('stops listening after cleanup', () => {
		cleanup?.();
		cleanup = undefined;
		expect(beforeInput(input, '.').defaultPrevented).toBe(false);
	});
});

describe('WholeNumberGuard', () => {
	it('tracks the refusing box by key and clears when it loses focus', () => {
		const guard = new WholeNumberGuard();
		const a = document.createElement('input');
		const b = document.createElement('input');
		const stopA = guard.attach(() => true, 'a')(a);
		const stopB = guard.attach(() => true, 'b')(b);

		beforeInput(a, '.');
		expect(guard.isRefused('a')).toBe(true);
		expect(guard.isRefused('b')).toBe(false);

		beforeInput(b, 'x');
		expect(guard.isRefused('a')).toBe(false);
		expect(guard.isRefused('b')).toBe(true);

		b.dispatchEvent(new Event('input'));
		expect(guard.isRefused('b')).toBe(true);
		b.dispatchEvent(new Event('blur'));
		expect(guard.isRefused('b')).toBe(false);

		beforeInput(a, '.');
		a.dispatchEvent(new Event('blur'));
		expect(guard.isRefused('a')).toBe(false);

		stopA?.();
		stopB?.();
	});
});
