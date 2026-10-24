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
	banner_group_id: null,
	screen_type: 'compact',
	...over
});

const html = (devices: ScannerDevice[], groupNames?: ReadonlyMap<string, string>) =>
	render(ScannerList, { props: { devices, groupNames } }).body;

describe('ScannerList', () => {
	it('shows the banner group name as a labelled badge, not a switch', () => {
		const names = new Map([['kiosk_banner_group:lobby', 'ล็อบบี้']]);
		const body = html([device('a', { banner_group_id: 'kiosk_banner_group:lobby' })], names);
		expect(body).toContain('ล็อบบี้');
		expect(body).not.toContain('ไม่มีกลุ่มแบนเนอร์');
		expect(body).not.toContain('role="switch"');
	});

	it('says ไม่มีกลุ่มแบนเนอร์ for a device without a group or whose group is gone', () => {
		const names = new Map([['kiosk_banner_group:lobby', 'ล็อบบี้']]);
		expect(html([device('a')], names)).toContain('ไม่มีกลุ่มแบนเนอร์');
		expect(html([device('a', { banner_group_id: 'kiosk_banner_group:deleted' })], names)).toContain(
			'ไม่มีกลุ่มแบนเนอร์'
		);
		expect(html([device('a')])).toContain('ไม่มีกลุ่มแบนเนอร์');
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
