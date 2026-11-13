// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ShiftCard from './shift-card.svelte';

let instance: Record<string, unknown> | undefined;

afterEach(() => {
	if (instance) {
		unmount(instance);
		instance = undefined;
	}
	document.body.innerHTML = '';
});

function quotaInput(): HTMLInputElement {
	return document.body.querySelector<HTMLInputElement>('input[type="number"]')!;
}

describe('ShiftCard quota input (#1162)', () => {
	it('keeps input empty when user clears the quota, without reverting to 0', async () => {
		let currentQuota = 5;
		const onchange = vi.fn((patch) => {
			if ('quota' in patch) currentQuota = patch.quota;
		});

		const shift = {
			id: 's1',
			date: '2026-11-15',
			end_date: '2026-11-15',
			start_time: '08:00',
			end_time: '16:00',
			get quota() {
				return currentQuota;
			}
		};

		instance = mount(ShiftCard, {
			target: document.body,
			props: {
				shift,
				index: 0,
				onchange,
				onremove: () => {}
			}
		});

		const input = quotaInput();
		expect(input.value).toBe('5');

		// User deletes everything
		input.value = '';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		expect(onchange).toHaveBeenCalledWith({ quota: 0 });
		expect(input.value).toBe('');
	});

	it('strips leading zero when user types after 0', async () => {
		let currentQuota = 5;
		const onchange = vi.fn((patch) => {
			if ('quota' in patch) currentQuota = patch.quota;
		});

		const shift = {
			id: 's1',
			date: '2026-11-15',
			end_date: '2026-11-15',
			start_time: '08:00',
			end_time: '16:00',
			get quota() {
				return currentQuota;
			}
		};

		instance = mount(ShiftCard, {
			target: document.body,
			props: {
				shift,
				index: 0,
				onchange,
				onremove: () => {}
			}
		});

		const input = quotaInput();

		// User types 08
		input.value = '08';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		expect(input.value).toBe('8');
		expect(onchange).toHaveBeenCalledWith({ quota: 8 });

		// User types 023
		input.value = '023';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		expect(input.value).toBe('23');
		expect(onchange).toHaveBeenCalledWith({ quota: 23 });
	});

	it('does not display 0 when shift quota is 0 (empty card)', () => {
		instance = mount(ShiftCard, {
			target: document.body,
			props: {
				shift: {
					id: 's1',
					date: '2026-11-15',
					end_date: '2026-11-15',
					start_time: '08:00',
					end_time: '16:00',
					quota: 0
				},
				index: 0,
				onchange: () => {},
				onremove: () => {}
			}
		});

		expect(quotaInput().value).toBe('');
	});
});
