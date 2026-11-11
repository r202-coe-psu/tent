// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import ShelterFilterPanel from './shelter-filter-panel.svelte';

const env = vi.hoisted(() => ({
	url: new URL('http://localhost/shelters'),
	goto: vi.fn(async () => {}),
	position: { lat: '7.0086', lng: '100.4968' }
}));

vi.mock('$app/navigation', () => ({ goto: env.goto }));
vi.mock('$app/paths', () => ({ resolve: (href: string) => href }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return env.url;
		}
	}
}));
vi.mock('$lib/features/shelters', () => ({ getAllLocations: async () => [] }));
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
	});

	it('still commits the radius when the page already resolved the shared position', async () => {
		// The /shelters page asks for GPS too and binds the result into the panel; when it
		// wins the race the panel already "has" a position on mount.
		await render({ userLat: '7.0086', userLng: '100.4968' });

		const params = committedUrl();
		expect(params.get('user_lng')).toBe('100.4968');
		expect(params.get('distance')).toBe('5');
	});
});
