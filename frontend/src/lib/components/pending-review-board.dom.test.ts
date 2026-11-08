// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import PendingReviewBoard from './pending-review-board.svelte';

vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] })
}));

let instance: ReturnType<typeof mount> | null = null;

async function render() {
	instance = mount(PendingReviewBoard, {
		target: document.body,
		props: { requests: [], onViewDetails: vi.fn() }
	});
	flushSync();
	await tick();
	flushSync();
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.clearAllMocks();
});

const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('donation list filters (#1058)', () => {
	it.each([
		['ที่มา', 'ทั้งหมด'],
		['เรียง', 'ใหม่สุดก่อน']
	])(
		'puts the "%s" label above its select and only the value in the button',
		async (label, value) => {
			await render();
			const labelEl = [...document.body.querySelectorAll('label')].find((l) => text(l) === label)!;
			expect(labelEl).toBeDefined();
			const trigger = document.getElementById(labelEl.htmlFor)!;
			expect(trigger.tagName).toBe('BUTTON');
			expect(text(trigger)).toBe(value);
			// Named by the label and its own text, so the selected value is announced too.
			expect(trigger.getAttribute('aria-labelledby')).toBe(`${labelEl.id} ${trigger.id}`);
		}
	);
});
