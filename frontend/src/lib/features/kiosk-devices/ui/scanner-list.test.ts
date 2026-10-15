import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { ScannerDevice } from '../domain/scanner.schema';
import ScannerList from './scanner-list.svelte';

vi.mock('../application/queries', () => ({
	useDeleteScannerDevice: () => ({ mutate: vi.fn(), isPending: false }),
	useUpdateScannerDevice: () => ({ mutate: vi.fn(), isPending: false })
}));

const device = (id: string, over: Partial<ScannerDevice> = {}): ScannerDevice => ({
	id: `scanner:${id}`,
	device_id: id,
	name: `Kiosk ${id}`,
	shelter_code: 'SH001',
	station_name: 'จุดคัดกรอง',
	status: 'active',
	last_seen_at: null,
	staff_pin_set: false,
	staff_pin_is_default: false,
	banner_enabled: true,
	...over
});

const html = (devices: ScannerDevice[]) => render(ScannerList, { props: { devices } }).body;

describe('ScannerList banner switch (FR-KBR-38)', () => {
	it('shows a checked switch labelled แสดงแบนเนอร์ when banners are on', () => {
		const body = html([device('a')]);

		expect(body).toContain('แสดงแบนเนอร์');
		expect(body).not.toContain('ไม่แสดงแบนเนอร์');
		expect(body).toMatch(/role="switch"[^>]*aria-checked="true"/);
	});

	it('shows an unchecked switch labelled ไม่แสดงแบนเนอร์ when banners are off', () => {
		const body = html([device('a', { banner_enabled: false })]);

		expect(body).toContain('ไม่แสดงแบนเนอร์');
		expect(body).toMatch(/role="switch"[^>]*aria-checked="false"/);
	});

	it('renders one banner switch per device with an accessible name naming the device', () => {
		const body = html([device('a'), device('b', { banner_enabled: false })]);

		expect(body.match(/role="switch"/g)).toHaveLength(2);
		expect(body).toContain('Kiosk a');
		expect(body).toContain('Kiosk b');
	});
});
