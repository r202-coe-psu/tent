// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, unmount } from 'svelte';
import { langState } from '$lib/states/i18n.svelte';
import type { PublicShelterDetail } from '$lib/features/public-portal';
import ShelterZones from './shelter-zones.svelte';

type Shelter = NonNullable<PublicShelterDetail>;
type Zone = NonNullable<Shelter['zones']>[number];

let instance: ReturnType<typeof mount> | null = null;
let previousLanguage = langState.current;

beforeEach(() => {
	previousLanguage = langState.current;
	langState.current = 'th';
});

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	langState.current = previousLanguage;
});

function render(zones: Zone[]) {
	instance = mount(ShelterZones, {
		target: document.body,
		props: { shelter: { zones } as unknown as Shelter }
	});
}

const zone = (overrides: Partial<Zone>): Zone => ({
	code: 'Z1',
	name: 'โซนครอบครัว',
	type: 'general',
	status: 'active',
	capacity: 10,
	present: 0,
	...overrides
});

const cards = () => [...document.body.querySelectorAll('section .rounded-xl')];
const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('ShelterZones per-zone headcount (#1241)', () => {
	it('shows present of capacity with a level label, not colour alone', () => {
		render([
			zone({ code: 'Z1', present: 3 }),
			zone({ code: 'Z2', present: 8 }),
			zone({ code: 'Z3', present: 12 })
		]);
		const [normal, warning, full] = cards().map(text);
		expect(normal).toContain('3 จาก 10');
		expect(normal).toContain('ยังว่าง · 30%');
		expect(warning).toContain('ใกล้เต็ม · 80%');
		// Overfull: the label says 120%, the bar stops at the edge.
		expect(full).toContain('เต็ม · 120%');
		const bar = cards()[2].querySelector<HTMLElement>('.bg-red-500');
		expect(bar?.style.width).toBe('100%');
	});

	it('marks a closed zone and gives it no fill colour', () => {
		render([zone({ status: 'closed', present: 9 })]);
		const card = cards()[0];
		expect(text(card)).toContain('ปิด');
		expect(text(card)).not.toContain('ใกล้เต็ม');
		expect(card.querySelector('.bg-amber-500')).toBeNull();
		expect(card.querySelector('.bg-slate-400')).not.toBeNull();
	});

	it('shows the headcount alone when the zone has no capacity on record', () => {
		render([zone({ capacity: null, present: 4 })]);
		const card = cards()[0];
		expect(text(card)).toContain('4 คน');
		expect(text(card)).not.toContain('จาก');
		expect(text(card)).not.toMatch(/ยังว่าง|ใกล้เต็ม|เต็ม|NaN/);
		expect(card.querySelector('.bg-slate-100')).toBeNull();
	});

	it('shows only capacity before the worker has projected per-zone counts', () => {
		render([zone({ present: null })]);
		const card = cards()[0];
		expect(text(card)).not.toContain('จาก');
		expect(text(card)).toContain('10 คน');
		expect(card.querySelector('.bg-slate-100')).toBeNull();
	});
});
