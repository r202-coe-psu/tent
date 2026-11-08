import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import KioskShell from './kiosk-shell.svelte';

const route = vi.hoisted(() => ({ url: new URL('http://kiosk.test/kiosk') }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return route.url;
		}
	}
}));

const shellProps = {
	shelterName: 'ศูนย์ A',
	shelterCode: 'SH001',
	stationName: 'Station 1',
	deviceName: 'Kiosk 1'
};

function shellAt(path: string): string {
	route.url = new URL(`http://kiosk.test${path}`);
	return render(KioskShell, { props: shellProps }).body;
}

describe('KioskShell language button', () => {
	beforeEach(() => languageStore.setLanguage('th'));

	it('links to the language picker, keeping only the context that came in the URL', () => {
		const body = shellAt('/kiosk?shelter_code=SH001&station_name=Station%201&secret=x');

		expect(body).toContain('aria-label="เปลี่ยนภาษา / Change language"');
		expect(body).toContain('href="/kiosk/language?shelter_code=SH001&amp;station_name=Station+1"');
		expect(body).toContain('ภาษา / Language');
	});

	it('shows the flag of the current language', () => {
		expect(shellAt('/kiosk')).toContain('viewBox="0 0 9 6"');

		languageStore.setLanguage('en');

		expect(shellAt('/kiosk')).toContain('viewBox="0 0 60 30"');
	});

	it('is hidden on the language page itself', () => {
		expect(shellAt('/kiosk/language')).not.toContain('Change language');
	});
});
