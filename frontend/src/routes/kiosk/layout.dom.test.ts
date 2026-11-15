// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { KIOSK_SERVICE_POLL_MS } from '$lib/features/kiosk';
import Layout from './+layout.svelte';

const route = vi.hoisted(() => ({ url: new URL('http://kiosk.test/kiosk') }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return route.url;
		}
	}
}));

const kiosk = vi.hoisted(() => ({
	goToKioskClosed: vi.fn(),
	readKioskServiceOpen: vi.fn<() => Promise<boolean | null>>()
}));
vi.mock('$lib/features/kiosk', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/kiosk')>()),
	goToKioskClosed: kiosk.goToKioskClosed,
	readKioskServiceOpen: kiosk.readKioskServiceOpen
}));

const children = createRawSnippet(() => ({ render: () => '<p>page</p>' }));
let instance: ReturnType<typeof mount> | null = null;

function render(path: string) {
	route.url = new URL(`http://kiosk.test${path}`);
	instance = mount(Layout, { target: document.body, props: { children } });
	flushSync();
}

async function pollOnce() {
	await vi.advanceTimersByTimeAsync(KIOSK_SERVICE_POLL_MS);
}

describe('kiosk layout closure watch', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// KioskShell's own reads (banners, host info) are not under test here.
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
		kiosk.goToKioskClosed.mockReset();
		kiosk.readKioskServiceOpen.mockReset();
	});

	afterEach(() => {
		if (instance) unmount(instance);
		instance = null;
		document.body.innerHTML = '';
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it.each(['/kiosk', '/kiosk/language'])(
		'on an idle %s, a server answer of closed goes to the closed page with the display query',
		async (path) => {
			kiosk.readKioskServiceOpen.mockResolvedValue(false);
			render(`${path}?shelter_name=A&secret=x`);

			await pollOnce();

			expect(kiosk.goToKioskClosed).toHaveBeenCalledExactlyOnceWith('?shelter_name=A');
		}
	);

	it('stays put while the kiosk is open or the read fails', async () => {
		kiosk.readKioskServiceOpen.mockResolvedValueOnce(true).mockResolvedValueOnce(null);
		render('/kiosk');

		await pollOnce();
		await pollOnce();

		expect(kiosk.readKioskServiceOpen).toHaveBeenCalledTimes(2);
		expect(kiosk.goToKioskClosed).not.toHaveBeenCalled();
	});

	it('does not poll on a mid-flow page (the next action is refused with 403 KIOSK_CLOSED)', async () => {
		kiosk.readKioskServiceOpen.mockResolvedValue(false);
		render('/kiosk/qr');

		await pollOnce();

		expect(kiosk.readKioskServiceOpen).not.toHaveBeenCalled();
	});

	it('stops polling once the layout is gone', async () => {
		kiosk.readKioskServiceOpen.mockResolvedValue(false);
		render('/kiosk');
		unmount(instance!);
		instance = null;

		await pollOnce();

		expect(kiosk.readKioskServiceOpen).not.toHaveBeenCalled();
	});
});
