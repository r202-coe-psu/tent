// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Harness from './__fixtures__/group-device-picker-harness.svelte';

const GROUP_A = 'kiosk_banner_group:A';
const GROUP_B = 'kiosk_banner_group:B';

const groups = [
	{ _id: GROUP_A, name: 'หน้าประตู' },
	{ _id: GROUP_B, name: 'โรงอาหาร' }
];

const device = (id: string, over: Record<string, unknown> = {}) => ({
	device_id: id,
	name: `เครื่อง ${id}`,
	station_name: `จุด ${id}`,
	screen_type: 'compact' as const,
	banner_group_id: null as string | null,
	...over
});

let instance: ReturnType<typeof mount> | null = null;

function render(props: {
	devices: ReturnType<typeof device>[];
	groupId?: string | null;
	initialSelected?: string[];
}) {
	instance = mount(Harness, { target: document.body, props: { groups, ...props } });
	flushSync();
}

const rows = () => [...document.body.querySelectorAll<HTMLLabelElement>('label')];
const row = (id: string) => rows().find((r) => r.textContent?.includes(`เครื่อง ${id}`))!;
const box = (id: string) => row(id).querySelector('input[type="checkbox"]') as HTMLInputElement;
const toggle = (id: string) => {
	box(id).click();
	flushSync();
};
const selectedOut = () => document.body.querySelector('[data-testid="selected"]')?.textContent;
const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '';

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('KioskBannerGroupDevicePicker', () => {
	it('shows an empty message when the shelter has no kiosk', () => {
		render({ devices: [] });

		expect(document.body.textContent).toContain('ยังไม่มีเครื่อง kiosk ในศูนย์นี้');
		expect(document.body.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
	});

	it('lists name, station, screen size and the current group of each kiosk', () => {
		render({
			devices: [device('K1', { screen_type: 'portrait', banner_group_id: GROUP_B }), device('K2')]
		});

		expect(text(row('K1'))).toContain('เครื่อง K1');
		expect(text(row('K1'))).toContain('จุด K1');
		expect(text(row('K1'))).toContain('ตู้ใหญ่ 1080×1920');
		expect(text(row('K1'))).toContain('โรงอาหาร');
		expect(text(row('K2'))).toContain('ตู้เล็ก 1024×600');
		expect(text(row('K2'))).toContain('ไม่มีกลุ่ม');
	});

	it('toggling a kiosk adds it to and removes it from the selection', () => {
		render({ devices: [device('K1'), device('K2')] });

		toggle('K1');
		toggle('K2');
		expect(selectedOut()).toBe('K1,K2');

		toggle('K1');
		expect(selectedOut()).toBe('K2');
	});

	it('shows the kiosks already in the selection as checked', () => {
		render({ devices: [device('K1'), device('K2')], initialSelected: ['K2'] });

		expect(box('K1').checked).toBe(false);
		expect(box('K2').checked).toBe(true);
	});

	it('warns about the move only for a checked kiosk that belongs to another group', () => {
		render({
			groupId: GROUP_A,
			devices: [
				device('K1', { banner_group_id: GROUP_B }),
				device('K2', { banner_group_id: GROUP_A }),
				device('K3')
			]
		});

		expect(document.body.textContent).not.toContain('จะย้ายออกจากกลุ่ม');

		toggle('K1');
		expect(text(row('K1'))).toContain('จะย้ายออกจากกลุ่ม โรงอาหาร');

		toggle('K2');
		toggle('K3');
		expect(text(row('K2'))).not.toContain('จะย้ายออกจากกลุ่ม');
		expect(text(row('K3'))).not.toContain('จะย้ายออกจากกลุ่ม');
	});

	it('treats every grouped kiosk as a move while creating a group', () => {
		render({ groupId: null, devices: [device('K1', { banner_group_id: GROUP_A })] });

		toggle('K1');

		expect(text(row('K1'))).toContain('จะย้ายออกจากกลุ่ม หน้าประตู');
	});
});
