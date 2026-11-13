// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import JobShiftEditDialog from './job-shift-edit-dialog.svelte';

let instance: Record<string, unknown> | undefined;

afterEach(() => {
	if (instance) {
		unmount(instance);
		instance = undefined;
	}
	document.body.innerHTML = '';
});

function seatsInput(): HTMLInputElement {
	return document.body.querySelector<HTMLInputElement>('#edit-shift-seats')!;
}

async function settle() {
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

describe('JobShiftEditDialog seats input (#1162)', () => {
	const shift = {
		id: 's1',
		date: '2026-11-15',
		end_date: '2026-11-15',
		start_time: '08:00',
		end_time: '16:00',
		quota: 5
	};

	it('strips leading zero when user types into seats input', async () => {
		instance = mount(JobShiftEditDialog, {
			target: document.body,
			props: {
				open: true,
				shift,
				siblings: [],
				minQuota: 0,
				onsave: () => {}
			}
		});
		await settle();

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
});
