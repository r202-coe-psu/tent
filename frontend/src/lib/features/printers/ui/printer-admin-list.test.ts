import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { PrinterAdminItem } from '../domain/print-device.schema';
import PrinterAdminList from './printer-admin-list.svelte';

vi.mock('../application/queries', () => ({
	printerKeys: { all: ['printers'] },
	useUpdatePrinterDevice: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useRotatePrinterSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useTestPrintPrinter: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeletePrinterDevice: () => ({ mutateAsync: vi.fn(), isPending: false })
}));

const printer = (id: string, over: Partial<PrinterAdminItem> = {}): PrinterAdminItem => ({
	id: `print_device:${id}`,
	device_id: id,
	name: `เครื่อง ${id}`,
	shelter_code: 'SH001',
	station: 'จุดลงทะเบียน',
	host_kind: 'standalone',
	status: 'active',
	secret_prefix: 'sk_print_ab12',
	last_seen_at: '2026-10-22T03:00:00.000Z',
	queue_state: 'ready',
	agent_version: '0.1.0',
	local_ips: [],
	online: true,
	last_job: null,
	...over
});

const html = (printers: PrinterAdminItem[]) =>
	render(PrinterAdminList, { props: { printers } }).body;

describe('PrinterAdminList', () => {
	it('shows name, station, online state, queue state and the last job of each printer', () => {
		const body = html([
			printer('reg-1', {
				last_job: {
					status: 'failed',
					finished_at: '2026-10-22T03:01:00.000Z',
					error_code: 'printer_timeout',
					created_at: '2026-10-22T03:00:00.000Z'
				}
			}),
			printer('reg-2', { online: false, queue_state: 'disabled' })
		]);

		expect(body).toContain('เครื่อง reg-1');
		expect(body).toContain('จุดลงทะเบียน');
		expect(body).toContain('● ออนไลน์');
		expect(body).toContain('● ออฟไลน์');
		expect(body).toContain('พร้อมใช้งาน');
		expect(body).toContain('คิวถูกปิด');
		expect(body).toContain('พิมพ์ไม่สำเร็จ');
		expect(body).toContain('ยังไม่มีงานพิมพ์');
	});

	it('flags an inactive printer and shows only the secret prefix', () => {
		const body = html([printer('reg-1', { status: 'inactive' })]);

		expect(body).toContain('ปิดใช้งาน');
		expect(body).toContain('sk_print_ab12');
		expect(body).not.toMatch(/sk_print_[a-z0-9]{13,}/);
	});

	it('shows the LAN IPs the printer reported, or that none are known yet', () => {
		const body = html([
			printer('reg-1', { local_ips: ['192.168.1.50', '10.0.0.7'] }),
			printer('reg-2', { local_ips: [] })
		]);

		expect(body).toContain('IP 192.168.1.50, 10.0.0.7');
		expect(body).toContain('ยังไม่ทราบ IP');
	});

	it('has one จัดการ button per printer', () => {
		const body = html([printer('a'), printer('b')]);
		expect(body.match(/<button/g)?.length).toBe(2);
		expect(body).toContain('จัดการ');
	});

	it('invites registering the first printer when the list is empty', () => {
		expect(html([])).toContain('ยังไม่มีเครื่องพิมพ์ในศูนย์นี้');
	});
});
