// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount, type ComponentProps } from 'svelte';
import ShelterHeadcountCard from './shelter-headcount-card.svelte';

let instance: ReturnType<typeof mount> | null = null;

function render(props: ComponentProps<typeof ShelterHeadcountCard>) {
	instance = mount(ShelterHeadcountCard, { target: document.body, props });
	flushSync();
}

function value(key: string): string {
	const el = document.querySelector(`[data-testid="kitchen-headcount-${key}-value"]`);
	return el?.textContent?.trim() ?? '';
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

const PEOPLE = { evacuees: 120, staff: 6, volunteers: 4 };
const HEADCOUNT = { halal: 35, infant: 8, soft_food: 12, regular: 77, volunteer: 10, total: 130 };

describe('ShelterHeadcountCard', () => {
	it('shows four group cards with their headcounts', () => {
		render({ people: PEOPLE, headcount: HEADCOUNT });
		expect(value('total')).toBe('130');
		expect(value('evacuees')).toBe('120');
		expect(value('staff')).toBe('6');
		expect(value('volunteers')).toBe('4');
	});

	it('shows the three special-diet groups open by default', () => {
		render({ people: PEOPLE, headcount: HEADCOUNT });
		expect(value('halal')).toBe('35');
		expect(value('soft_food')).toBe('12');
		expect(value('infant')).toBe('8');
		expect(document.body.textContent).toContain('นับซ้อนกันได้');
	});

	it('collapses and reopens the special-diet section', () => {
		render({ people: PEOPLE, headcount: HEADCOUNT });
		const toggle = document.querySelector<HTMLButtonElement>(
			'[aria-controls="kitchen-headcount-diets"]'
		)!;
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		toggle.click();
		flushSync();
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(value('halal')).toBe('');
		toggle.click();
		flushSync();
		expect(value('halal')).toBe('35');
	});

	it('shows a dash for every count while loading', () => {
		render({ people: undefined, headcount: undefined });
		for (const key of [
			'total',
			'evacuees',
			'staff',
			'volunteers',
			'halal',
			'soft_food',
			'infant'
		]) {
			expect(value(key)).toBe('–');
		}
	});

	it('renders zero as 0, not a dash', () => {
		render({
			people: { evacuees: 0, staff: 0, volunteers: 0 },
			headcount: { halal: 0, infant: 0, soft_food: 0, regular: 0, volunteer: 0, total: 0 }
		});
		expect(value('halal')).toBe('0');
		expect(value('total')).toBe('0');
	});
});
