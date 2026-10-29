// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import DropOffPointsSection from './drop-off-points-section.svelte';
import { ALL_LINES_PICKER } from '../domain/line-points';

const GYM = { id: 'point-gym', name: 'โรงยิม' };
const MED = { id: 'point-med', name: 'ห้องพยาบาล' };
const KITCHEN = { id: 'point-kitchen', name: 'โรงครัว' };
const STORE = { id: 'point-store', name: 'ห้องเก็บของ 3' };

type Line = { key: string; name: string; pointId: string | null };

let instance: ReturnType<typeof mount> | null = null;
const onPick = vi.fn();
const onPickAll = vi.fn();
const onActivate = vi.fn();

function render(
	points: { id: string; name: string }[],
	lines: Line[],
	activePicker: string | null = null
) {
	instance = mount(DropOffPointsSection, {
		target: document.body,
		props: { points, lines, idPrefix: 'test', activePicker, onPick, onPickAll, onActivate }
	});
	flushSync();
}

const byTestId = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);
const triggerIn = (root: Element | null) =>
	root?.querySelector<HTMLElement>('[data-slot="select-trigger"]') ?? null;

async function press(el: Element) {
	el.dispatchEvent(
		new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
	);
	el.dispatchEvent(
		new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })
	);
	(el as HTMLElement).click();
	await tick();
	flushSync();
}

/** Opens a picker and chooses `name` from its list (portalled to the end of `body`). */
async function choose(root: Element | null, name: string) {
	await press(triggerIn(root)!);
	const listbox = [...document.body.querySelectorAll('[role="listbox"]')].at(-1)!;
	const option = [...listbox.querySelectorAll('[role="option"]')].find(
		(o) => o.textContent?.trim() === name
	)!;
	await press(option);
}

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	vi.clearAllMocks();
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('DropOffPointsSection (CR-206)', () => {
	it('renders nothing without points (FR-MP-11)', () => {
		render([], [{ key: 'a', name: 'น้ำดื่ม', pointId: null }]);
		expect(document.body.textContent?.trim()).toBe('');
	});

	it('names the only point and offers no choice (FR-MP-10)', () => {
		render([GYM], [{ key: 'a', name: 'น้ำดื่ม', pointId: 'point-gym' }]);
		expect(byTestId('drop-off-single-point')?.textContent).toContain('โรงยิม');
		expect(triggerIn(document.body)).toBeNull();
	});

	it('gives each line a dropdown showing its point, even with two points (FR-MP-8)', () => {
		render(
			[GYM, MED],
			[
				{ key: 'a', name: 'น้ำดื่ม', pointId: 'point-gym' },
				{ key: 'b', name: 'ยา', pointId: 'point-med' }
			]
		);
		expect(triggerIn(byTestId('drop-off-point-line-0'))?.textContent).toContain('โรงยิม');
		expect(triggerIn(byTestId('drop-off-point-line-1'))?.textContent).toContain('ห้องพยาบาล');
		expect(document.body.querySelector('[role="radio"]')).toBeNull();
	});

	it('picks a point for one line and makes that dropdown the one a map tap fills', async () => {
		render(
			[GYM, MED, KITCHEN, STORE],
			[
				{ key: 'a', name: 'น้ำดื่ม', pointId: 'point-gym' },
				{ key: 'b', name: 'ยา', pointId: 'point-gym' }
			]
		);
		await choose(byTestId('drop-off-point-line-1'), 'ห้องพยาบาล');

		expect(onActivate).toHaveBeenCalledWith('b');
		expect(onPick).toHaveBeenCalledWith('b', 'point-med');
	});

	it('sends every line to one point from the shortcut', async () => {
		render(
			[GYM, MED],
			[
				{ key: 'a', name: 'น้ำดื่ม', pointId: 'point-gym' },
				{ key: 'b', name: 'ยา', pointId: 'point-med' }
			]
		);
		const all = byTestId('drop-off-point-all');
		// Lines on different points: the shortcut names none.
		expect(triggerIn(all)?.textContent).toContain('แยกหลายจุด');

		await choose(all, 'ห้องพยาบาล');
		expect(onActivate).toHaveBeenCalledWith(ALL_LINES_PICKER);
		expect(onPickAll).toHaveBeenCalledWith('point-med');
	});

	it('shows the shared point on the shortcut, and no shortcut for a single line', () => {
		render(
			[GYM, MED],
			[
				{ key: 'a', name: 'น้ำดื่ม', pointId: 'point-gym' },
				{ key: 'b', name: 'ยา', pointId: 'point-gym' }
			]
		);
		expect(triggerIn(byTestId('drop-off-point-all'))?.textContent).toContain('โรงยิม');
		unmount(instance!);
		instance = null;
		document.body.innerHTML = '';

		render([GYM, MED], [{ key: 'a', name: 'น้ำดื่ม', pointId: 'point-gym' }]);
		expect(byTestId('drop-off-point-all')).toBeNull();
	});

	it('marks the dropdown a map tap fills', () => {
		render(
			[GYM, MED],
			[
				{ key: 'a', name: 'น้ำดื่ม', pointId: 'point-gym' },
				{ key: 'b', name: 'ยา', pointId: 'point-gym' }
			],
			'b'
		);
		expect(byTestId('drop-off-point-line-0')?.getAttribute('data-active')).toBe('false');
		expect(byTestId('drop-off-point-line-1')?.getAttribute('data-active')).toBe('true');
	});
});
