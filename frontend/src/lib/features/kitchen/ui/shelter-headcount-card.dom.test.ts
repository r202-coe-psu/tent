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

describe('ShelterHeadcountCard', () => {
	it('shows the total, people breakdown and dietary groups', () => {
		render({
			people: { evacuees: 120, staff: 6, volunteers: 4 },
			headcount: { halal: 35, infant: 8, soft_food: 12, regular: 77, volunteer: 10, total: 130 }
		});
		expect(value('total')).toBe('130');
		expect(value('evacuees')).toBe('120');
		expect(value('staff')).toBe('6');
		expect(value('volunteers')).toBe('4');
		expect(value('halal')).toBe('35');
		expect(value('infant')).toBe('8');
		expect(value('soft_food')).toBe('12');
	});

	it('labels halal as Muslim evacuees and warns that groups overlap', () => {
		render({
			people: { evacuees: 1, staff: 0, volunteers: 0 },
			headcount: { halal: 1, infant: 0, soft_food: 0, regular: 0, volunteer: 0, total: 1 }
		});
		const text = document.body.textContent ?? '';
		expect(text).toContain('ฮาลาล (มุสลิม)');
		expect(text).toContain('นับซ้อนกันได้');
	});

	it('shows a dash for every count while loading', () => {
		render({ people: undefined, headcount: undefined });
		for (const key of [
			'total',
			'evacuees',
			'staff',
			'volunteers',
			'halal',
			'infant',
			'soft_food'
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
