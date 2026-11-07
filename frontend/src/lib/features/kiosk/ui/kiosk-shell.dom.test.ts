// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import KioskShell from './kiosk-shell.svelte';

const pageState = vi.hoisted(() => ({ url: new URL('http://kiosk.test/kiosk') }));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('../application/kiosk-qr-input', () => ({
	loadKioskHardware: vi.fn().mockResolvedValue(null)
}));

let instance: ReturnType<typeof mount> | null = null;

function mountShell(compact: boolean) {
	window.matchMedia = ((query: string) => ({
		matches: compact,
		media: query,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	})) as unknown as typeof window.matchMedia;
	instance = mount(KioskShell, {
		target: document.body,
		props: { shelterName: 'ศูนย์ A', shelterCode: 'SH001', stationName: 'S1', deviceName: 'K1' }
	});
	flushSync();
}

beforeEach(() => {
	vi.clearAllMocks();
	pageState.url = new URL('http://kiosk.test/kiosk');
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('KioskShell language button (DOM)', () => {
	it('sits inside the one-line shelter strip on the compact kiosk, with no header', () => {
		mountShell(true);

		expect(document.querySelector('header')).toBeNull();
		const button = document.querySelector('[data-testid="kiosk-language-button"]')!;
		expect(button.getAttribute('href')).toMatch(/^\/kiosk\/language\?/);
		expect(button.closest('div.border-b')?.textContent).toContain('ศูนย์พักพิง ศูนย์ A');
	});

	it('sits in the header next to the clock on bigger kiosks', () => {
		mountShell(false);

		expect(document.querySelector('header [data-testid="kiosk-language-button"]')).not.toBeNull();
	});

	it.each(['/kiosk/scanner/reading', '/kiosk/register/phone', '/kiosk/qr', '/kiosk/language'])(
		'is hidden on %s, so a visit in progress is never thrown away',
		(path) => {
			pageState.url = new URL(`http://kiosk.test${path}`);
			mountShell(false);

			expect(document.querySelector('[data-testid="kiosk-language-button"]')).toBeNull();
		}
	);
});
