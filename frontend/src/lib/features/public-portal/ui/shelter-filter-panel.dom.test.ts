// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import ShelterFilterPanel from './shelter-filter-panel.svelte';

const env = vi.hoisted(() => ({
	url: new URL('http://localhost/shelters'),
	/** Like SvelteKit: `page.url` stays put while the navigation's load is in flight. */
	pending: null as URL | null,
	goto: vi.fn(async (href: string) => {
		env.pending = new URL(href, 'http://localhost');
	}),
	position: { lat: '7.0086', lng: '100.4968' },
	locations: [] as { province: string; district: string; subdistrict: string }[]
}));

vi.mock('$app/navigation', () => ({ goto: env.goto }));
vi.mock('$app/paths', () => ({ resolve: (href: string) => href }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return env.url;
		}
	},
	navigating: {
		get to() {
			return env.pending ? { url: env.pending } : null;
		}
	}
}));
vi.mock('$lib/features/shelters', () => ({ getAllLocations: async () => env.locations }));
vi.mock('../application/queries', () => ({ useSiteKinds: () => ({ data: [] }) }));
vi.mock('../data/geolocation', () => ({
	geolocationBlockReason: () => null,
	GeolocationUnavailableError: class extends Error {},
	requestUserPosition: async () => env.position
}));

let component: ReturnType<typeof mount> | undefined;

async function render(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	component = mount(ShelterFilterPanel, { target, props });
	flushSync();
	// onMount: GPS request + locations load, then the URL commit.
	for (let i = 0; i < 5; i++) await tick();
}

function committedUrl(): URLSearchParams {
	expect(env.goto).toHaveBeenCalled();
	const href = env.goto.mock.calls.at(-1)![0] as string;
	return new URLSearchParams(href.split('?')[1] ?? '');
}

describe('ShelterFilterPanel — first-visit GPS radius', () => {
	beforeEach(() => {
		env.url = new URL('http://localhost/shelters');
		env.pending = null;
		env.goto.mockClear();
	});
	afterEach(() => {
		if (component) unmount(component);
		component = undefined;
		document.body.innerHTML = '';
	});

	it('puts the GPS position and the default 5 km radius in the URL', async () => {
		await render({});

		const params = committedUrl();
		expect(params.get('user_lat')).toBe('7.0086');
		expect(params.get('distance')).toBe('5');
		// One navigation, not one per commit path (GPS resolve, userLat effect, onMount).
		expect(env.goto).toHaveBeenCalledTimes(1);
	});

	it('still commits the radius when the page already resolved the shared position', async () => {
		// The /shelters page asks for GPS too and binds the result into the panel; when it
		// wins the race the panel already "has" a position on mount.
		await render({ userLat: '7.0086', userLng: '100.4968' });

		const params = committedUrl();
		expect(params.get('user_lng')).toBe('100.4968');
		expect(params.get('distance')).toBe('5');
		expect(env.goto).toHaveBeenCalledTimes(1);
	});

	it('adds the 5 km default once when the URL has the position but no radius', async () => {
		env.url = new URL('http://localhost/shelters?user_lat=7.0086&user_lng=100.4968');
		await render({
			userLat: '7.0086',
			userLng: '100.4968',
			filters: { user_lat: '7.0086', user_lng: '100.4968', distance: '5' }
		});

		expect(committedUrl().get('distance')).toBe('5');
		expect(env.goto).toHaveBeenCalledTimes(1);
	});

	it('does not navigate when the URL already carries the position and radius', async () => {
		env.url = new URL('http://localhost/shelters?user_lat=7.0086&user_lng=100.4968&distance=5');
		await render({
			userLat: '7.0086',
			userLng: '100.4968',
			filters: { user_lat: '7.0086', user_lng: '100.4968', distance: '5' }
		});

		expect(env.goto).not.toHaveBeenCalled();
	});

	it('keeps a radius the visitor picked from the URL and writes it back unchanged', async () => {
		env.url = new URL('http://localhost/shelters?user_lat=7.0086&user_lng=100.4968&distance=10');
		await render({
			userLat: '7.0086',
			userLng: '100.4968',
			filters: { user_lat: '7.0086', user_lng: '100.4968', distance: '10' }
		});
		// toggling an unrelated filter must not drop or change the radius
		document.body.querySelector<HTMLElement>('[name="parking_car"]')!.click();
		for (let i = 0; i < 3; i++) await tick();

		expect(committedUrl().get('distance')).toBe('10');
	});
});

describe('ShelterFilterPanel — radius presets (#1419)', () => {
	beforeEach(() => {
		env.url = new URL('http://localhost/shelters?user_lat=7.0086&user_lng=100.4968');
		env.pending = null;
		env.goto.mockClear();
	});
	afterEach(() => {
		if (component) unmount(component);
		component = undefined;
		document.body.innerHTML = '';
	});

	const presets = () =>
		[...document.body.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].filter((b) =>
			/กม/.test(b.textContent ?? '')
		);

	it('shows 5 km pressed by default', async () => {
		await render({
			userLat: '7.0086',
			userLng: '100.4968',
			filters: { user_lat: '7.0086', user_lng: '100.4968' }
		});

		const pressed = presets().filter((b) => b.getAttribute('aria-pressed') === 'true');
		expect(pressed.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['5 กม.']);
	});

	it('shows no preset pressed when the radius was cleared (distance=)', async () => {
		env.url = new URL('http://localhost/shelters?user_lat=7.0086&user_lng=100.4968&distance=');
		await render({
			userLat: '7.0086',
			userLng: '100.4968',
			filters: { user_lat: '7.0086', user_lng: '100.4968', distance: '' }
		});

		expect(presets().length).toBeGreaterThan(0);
		expect(presets().map((b) => b.getAttribute('aria-pressed'))).toEqual(
			presets().map(() => 'false')
		);
		expect(env.goto).not.toHaveBeenCalled();
	});

	it('shows the radius from the URL as pressed, and only that one', async () => {
		env.url = new URL('http://localhost/shelters?user_lat=7.0086&user_lng=100.4968&distance=10');
		await render({
			userLat: '7.0086',
			userLng: '100.4968',
			filters: { user_lat: '7.0086', user_lng: '100.4968', distance: '10' }
		});

		const pressed = presets().filter((b) => b.getAttribute('aria-pressed') === 'true');
		expect(pressed.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['10 กม.']);
	});

	it('clears the radius (distance=) when the pressed preset is pressed again', async () => {
		env.url = new URL('http://localhost/shelters?user_lat=7.0086&user_lng=100.4968&distance=10');
		await render({
			userLat: '7.0086',
			userLng: '100.4968',
			filters: { user_lat: '7.0086', user_lng: '100.4968', distance: '10' }
		});
		env.goto.mockClear();

		presets()
			.find((b) => b.getAttribute('aria-pressed') === 'true')!
			.click();
		for (let i = 0; i < 3; i++) await tick();

		// kept as an empty value, so the load does not fall back to the 5 km default
		expect(committedUrl().get('distance')).toBe('');
		expect(committedUrl().get('user_lat')).toBe('7.0086');
	});
});

describe('ShelterFilterPanel — parking filter (CR-253 FR-33)', () => {
	beforeEach(() => {
		env.url = new URL('http://localhost/shelters?user_lat=7.0086&user_lng=100.4968&distance=5');
		env.pending = null;
		env.goto.mockClear();
	});
	afterEach(() => {
		if (component) unmount(component);
		component = undefined;
		document.body.innerHTML = '';
	});

	it('shows the boxes ticked from the URL flags', async () => {
		await render({
			filters: {
				parking_car: 'on',
				parking_boat: 'on',
				user_lat: '7.0086',
				user_lng: '100.4968',
				distance: '5'
			}
		});
		const checked = (name: string) =>
			document.body.querySelector(`[name="${name}"]`)?.getAttribute('aria-checked') ??
			document.body.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.checked;
		expect(String(checked('parking_car'))).toBe('true');
		expect(String(checked('parking_motorcycle'))).toBe('false');
		expect(String(checked('parking_boat'))).toBe('true');
	});

	it('writes ticked types to the URL as parking_*=on, and drops them when unticked', async () => {
		await render({ filters: { user_lat: '7.0086', user_lng: '100.4968', distance: '5' } });
		env.goto.mockClear();

		document.body.querySelector<HTMLElement>('[name="parking_car"]')!.click();
		for (let i = 0; i < 3; i++) await tick();
		expect(committedUrl().get('parking_car')).toBe('on');
		expect(committedUrl().has('parking_boat')).toBe(false);
	});
});

describe('ShelterFilterPanel — advanced filters: province / district / subdistrict (#1419)', () => {
	const URL_WITH_POSITION =
		'http://localhost/shelters?user_lat=7.0086&user_lng=100.4968&distance=5';
	const POSITION = { user_lat: '7.0086', user_lng: '100.4968', distance: '5' };

	beforeEach(() => {
		env.url = new URL(URL_WITH_POSITION);
		env.pending = null;
		env.goto.mockClear();
		env.locations = [{ province: 'สงขลา', district: 'หาดใหญ่', subdistrict: 'บ้านพรุ' }];
	});
	afterEach(() => {
		if (component) unmount(component);
		component = undefined;
		document.body.innerHTML = '';
		env.locations = [];
	});

	const trigger = () =>
		[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
			b.textContent?.includes('ตัวกรองขั้นสูง')
		);
	const areaSelects = () =>
		['province', 'district', 'subdistrict'].map((n) =>
			document.body.querySelector(`[data-name="${n}"]`)
		);
	/** The section the trigger controls is open and every area select sits inside it. */
	const areaShown = () => {
		const content = trigger()!
			.closest('[data-accordion-item]')
			?.querySelector<HTMLElement>('[data-accordion-content]');
		if (!content || content.getAttribute('data-state') !== 'open' || content.hidden) return false;
		return areaSelects().every((el) => el !== null && content.contains(el));
	};

	it('starts collapsed, with the area selects hidden until it is expanded', async () => {
		await render({ userLat: '7.0086', userLng: '100.4968', filters: POSITION });

		expect(trigger()).toBeDefined();
		expect(trigger()!.getAttribute('aria-expanded')).toBe('false');
		expect(areaShown()).toBe(false);

		trigger()!.click();
		flushSync();
		await tick();

		expect(trigger()!.getAttribute('aria-expanded')).toBe('true');
		expect(areaShown()).toBe(true);
	});

	it.each([
		['province', { province: 'สงขลา' }],
		['district', { province: 'สงขลา', district: 'หาดใหญ่' }],
		['subdistrict', { province: 'สงขลา', district: 'หาดใหญ่', subdistrict: 'บ้านพรุ' }]
	])('opens by itself when the URL already filters by %s', async (_name, area) => {
		const qs = new URLSearchParams({ ...POSITION, ...area });
		env.url = new URL(`http://localhost/shelters?${qs}`);
		await render({ userLat: '7.0086', userLng: '100.4968', filters: { ...POSITION, ...area } });

		expect(trigger()!.getAttribute('aria-expanded')).toBe('true');
		expect(areaShown()).toBe(true);
		expect(env.goto).not.toHaveBeenCalled();
	});

	it('still writes a picked province to the URL', async () => {
		await render({ userLat: '7.0086', userLng: '100.4968', filters: POSITION });
		trigger()!.click();
		flushSync();
		await tick();
		env.goto.mockClear();

		document.body.querySelector<HTMLElement>('[data-name="province"]')!.click();
		flushSync();
		await tick();
		[...document.body.querySelectorAll<HTMLButtonElement>('button')]
			.find((b) => b.textContent?.trim() === 'สงขลา')!
			.click();
		for (let i = 0; i < 3; i++) await tick();

		expect(committedUrl().get('province')).toBe('สงขลา');
		expect(committedUrl().get('distance')).toBe('5');
	});
});
