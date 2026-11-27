// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MealCoverageGaugeCard from './MealCoverageGaugeCard.svelte';
import { COVERAGE_STATUS_TONES } from '../model/meal-coverage-view';

let cmp: ReturnType<typeof mount> | undefined;
afterEach(() => {
	if (cmp) void unmount(cmp);
	cmp = undefined;
	document.body.innerHTML = '';
});

function render(props: { complete: number; partial: number; none: number; multiDay?: boolean }) {
	cmp = mount(MealCoverageGaugeCard, {
		target: document.body,
		props: { present: props.complete + props.partial + props.none, multiDay: false, ...props }
	});
	flushSync();
}
const segment = (status: string) =>
	document.querySelector(`circle[data-status="${status}"]`) as SVGCircleElement | null;
const dot = (status: string) =>
	document.querySelector(`li[data-status="${status}"] [data-dot]`) as HTMLElement;

describe('MealCoverageGaugeCard donut', () => {
	it('colours each segment by status: green complete, amber one meal, red no record', () => {
		render({ complete: 96, partial: 12, none: 184 });
		expect(segment('complete')?.getAttribute('stroke')).toBe(COVERAGE_STATUS_TONES.complete.color);
		expect(segment('partial')?.getAttribute('stroke')).toBe(COVERAGE_STATUS_TONES.partial.color);
		expect(segment('none')?.getAttribute('stroke')).toBe(COVERAGE_STATUS_TONES.none.color);
	});

	it('uses the very same colours for the legend dots as for the segments', () => {
		render({ complete: 96, partial: 12, none: 184 });
		for (const status of ['complete', 'partial', 'none']) {
			expect(dot(status).getAttribute('style')?.toLowerCase()).toContain(
				(segment(status)?.getAttribute('stroke') ?? 'missing').toLowerCase()
			);
		}
	});

	it('sizes the segments by share, starting with the complete one at 12 o clock', () => {
		render({ complete: 1, partial: 1, none: 2 });
		const dash = (status: string) => segment(status)?.getAttribute('stroke-dasharray');
		const offset = (status: string) => Number(segment(status)?.getAttribute('stroke-dashoffset'));
		const C = 2 * Math.PI * 52;
		expect(Number(dash('complete')?.split(' ')[0])).toBeLessThan(C / 4);
		expect(Number(dash('complete')?.split(' ')[0])).toBeGreaterThan(C / 4 - 5);
		expect(offset('complete')).toBeCloseTo(0, 5);
		expect(offset('partial')).toBeCloseTo(-C / 4, 5);
		expect(offset('none')).toBeCloseTo(-C / 2, 5);
	});

	it('keeps the centre text on the complete share with its label', () => {
		render({ complete: 96, partial: 12, none: 184 });
		const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('33%');
		expect(text).toContain('96 / 292 คน');
		expect(text).toContain('รับ 2 มื้อขึ้นไป/วัน');
	});

	it('draws no segment for a status nobody has', () => {
		render({ complete: 5, partial: 0, none: 0 });
		expect(segment('partial')).toBeNull();
		expect(segment('none')).toBeNull();
		expect(segment('complete')).not.toBeNull();
	});
});
