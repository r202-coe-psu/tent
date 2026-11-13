// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ShiftBatchGenerator from './shift-batch-generator.svelte';

let instance: Record<string, unknown> | undefined;

afterEach(() => {
	if (instance) {
		unmount(instance);
		instance = undefined;
	}
	document.body.innerHTML = '';
});

function seatsInput(): HTMLInputElement {
	return document.body.querySelector<HTMLInputElement>('input[type="number"]')!;
}

describe('ShiftBatchGenerator seats input (#1162)', () => {
	it('strips leading zero when user types into seats input', async () => {
		instance = mount(ShiftBatchGenerator, {
			target: document.body,
			props: {
				idFactory: () => '1',
				ongenerate: () => {}
			}
		});

		const input = seatsInput();
		expect(input.value).toBe('5');

		input.value = '08';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		expect(input.value).toBe('8');

		input.value = '023';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		expect(input.value).toBe('23');
	});

	it('keeps seats input empty when cleared', async () => {
		instance = mount(ShiftBatchGenerator, {
			target: document.body,
			props: {
				idFactory: () => '1',
				ongenerate: () => {}
			}
		});

		const input = seatsInput();
		input.value = '';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		expect(input.value).toBe('');
	});
});
