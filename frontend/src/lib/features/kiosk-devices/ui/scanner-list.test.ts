import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { ScannerDevice } from '../domain/scanner.schema';
import ScannerList from './scanner-list.svelte';

vi.mock('../application/queries', () => ({
	useDeleteScannerDevice: () => ({ mutate: vi.fn(), isPending: false }),
	useUpdateScannerDevice: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
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
	screen_type: 'compact',
	...over
});

const html = (devices: ScannerDevice[]) => render(ScannerList, { props: { devices } }).body;

describe('ScannerList', () => {
	it('shows the banner state as a labelled badge (FR-KBR-38), not a switch', () => {
		const on = html([device('a')]);
		expect(on).toContain('แสดงแบนเนอร์');
		expect(on).not.toContain('ไม่แสดงแบนเนอร์');
		expect(on).not.toContain('role="switch"');

		expect(html([device('a', { banner_enabled: false })])).toContain('ไม่แสดงแบนเนอร์');
	});

	it('labels each device with its kiosk screen and size', () => {
		const body = html([device('a'), device('b', { screen_type: 'portrait' })]);
		expect(body).toContain('ตู้เล็ก');
		expect(body).toContain('1024×600');
		expect(body).toContain('ตู้ใหญ่');
		expect(body).toContain('1080×1920');
	});

	it('shows status and PIN state as text badges', () => {
		const body = html([device('a', { status: 'inactive' })]);
		expect(body).toContain('Inactive');
		expect(body).toContain('ยังไม่ตั้ง PIN');
	});

	it('does not flag a default PIN in the table', () => {
		const body = html([device('a', { staff_pin_set: true, staff_pin_is_default: true })]);
		expect(body).not.toContain('PIN เริ่มต้น');
		expect(body).not.toContain('ตั้ง PIN แล้ว');
	});

	it('has one จัดการ button per device, named after the device', () => {
		const body = html([device('a'), device('b')]);
		expect(body.match(/>\s*จัดการ\s*</g)?.length ?? 0).toBeGreaterThanOrEqual(2);
		expect(body).toContain('เครื่อง Kiosk a');
		expect(body).toContain('เครื่อง Kiosk b');
	});
});
