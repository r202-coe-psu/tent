// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import DropOffPointsSection from './drop-off-points-section.svelte';

const GYM = { id: 'point-gym', name: 'โรงยิม' };
const MED = { id: 'point-med', name: 'ห้องพยาบาล' };
const KITCHEN = { id: 'point-kitchen', name: 'โรงครัว' };
const STORE = { id: 'point-store', name: 'ห้องเก็บของ 3' };

type Line = { key: string; name: string; pointId: string | null };

let instance: ReturnType<typeof mount> | null = null;
const onPick = vi.fn();
const onPickAll = vi.fn();

function render(points: { id: string; name: string }[], lines: Line[]) {
	instance = mount(DropOffPointsSection, {
		target: document.body,
		props: { points, lines, idPrefix: 'test', onPick, onPickAll }
	});
	flushSync();
}

const byTestId = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);
const radios = (root: Element | null) => [
	...(root?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])
];

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
		expect(radios(document.body)).toHaveLength(0);
	});

	it('gives each line buttons for two or three points, with its point checked (FR-MP-8)', () => {
		render(
			[GYM, MED],
			[
				{ key: 'a', name: 'น้ำดื่ม', pointId: 'point-gym' },
				{ key: 'b', name: 'ยา', pointId: 'point-med' }
			]
		);
		const line1 = radios(byTestId('drop-off-point-line-1'));
		expect(line1.map((radio) => radio.textContent?.trim())).toEqual(['โรงยิม', 'ห้องพยาบาล']);
		expect(line1.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true']);

		line1[0].click();
		expect(onPick).toHaveBeenCalledWith('b', 'point-gym');
	});

	it('sends every line to one point from the shortcut', () => {
		render(
			[GYM, MED],
			[
				{ key: 'a', name: 'น้ำดื่ม', pointId: 'point-gym' },
				{ key: 'b', name: 'ยา', pointId: 'point-med' }
			]
		);
		const all = radios(byTestId('drop-off-point-all'));
		// Lines on different points: the shortcut checks none.
		expect(all.every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(true);

		all[1].click();
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
		expect(
			radios(byTestId('drop-off-point-all')).map((radio) => radio.getAttribute('aria-checked'))
		).toEqual(['true', 'false']);
		unmount(instance!);
		instance = null;
		document.body.innerHTML = '';

		render([GYM, MED], [{ key: 'a', name: 'น้ำดื่ม', pointId: 'point-gym' }]);
		expect(byTestId('drop-off-point-all')).toBeNull();
	});

	it('switches to a dropdown per line from four points', () => {
		render([GYM, MED, KITCHEN, STORE], [{ key: 'a', name: 'น้ำดื่ม', pointId: 'point-store' }]);
		const line = byTestId('drop-off-point-line-0');
		expect(radios(line)).toHaveLength(0);
		expect(line?.querySelector('[data-slot="select-trigger"]')?.textContent).toContain(
			'ห้องเก็บของ 3'
		);
	});
});
