// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ShelterParking from './shelter-parking.svelte';

const lang = vi.hoisted(() => ({ current: 'th' }));
vi.mock('$lib/states/i18n.svelte', () => ({ langState: lang }));

let component: ReturnType<typeof mount> | undefined;

function render(parking_points: unknown[]) {
	component = mount(ShelterParking, {
		target: document.body,
		props: { shelter: { code: 'SH1', parking_points } as never }
	});
	flushSync();
}

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.innerHTML = '';
	lang.current = 'th';
});

const lot = {
	id: 'p1',
	name: 'ลานหน้าอาคาร',
	note: 'จอดได้เฉพาะรถยนต์',
	geo: { lat: 7, lng: 100 },
	vehicles: [
		{ type: 'car', max_capacity: 30 },
		{ type: 'boat', max_capacity: null }
	]
};

describe('ShelterParking (CR-253 FR-31)', () => {
	it('lists each point with its note and vehicle capacities', () => {
		render([lot]);
		const text = document.body.textContent ?? '';
		expect(text).toContain('จุดจอดรถ');
		expect(text).toContain('ลานหน้าอาคาร');
		expect(text).toContain('จอดได้เฉพาะรถยนต์');
		expect(text).toContain('รองรับสูงสุด 30 คัน');
		expect(text).toContain('ไม่ระบุจำนวน');
	});

	it('renders nothing for a shelter without parking points', () => {
		render([]);
		expect(document.body.querySelector('[data-testid="shelter-parking"]')).toBeNull();
	});

	it('switches to English', () => {
		lang.current = 'en';
		render([lot]);
		const text = document.body.textContent ?? '';
		expect(text).toContain('Parking');
		expect(text).toContain('Up to 30 vehicles');
	});
});
