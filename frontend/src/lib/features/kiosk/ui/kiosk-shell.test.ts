import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskShell from './kiosk-shell.svelte';

describe('KioskShell', () => {
	it('marks the shell so the portrait profile can scope the root font size to kiosk screens', () => {
		const result = render(KioskShell, {
			props: {
				shelterName: 'ศูนย์ทดสอบ',
				shelterCode: 'SH001',
				stationName: 'จุดคัดกรอง',
				deviceName: 'KIOSK-01'
			}
		});

		expect(result.body).toContain('data-kiosk-shell');
	});
});
