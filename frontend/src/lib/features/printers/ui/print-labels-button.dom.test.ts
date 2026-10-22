// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { QueryClient } from '@tanstack/svelte-query';
import { endpointStore } from '$lib/stores/endpoint.svelte';
import { stationPrinter } from '../application/station-printer.svelte';
import { PRINT_JOB_POLL_TIMEOUT_MS } from '../domain/print-job-status';
import { PRINT_JOB_PICKUP_HINT_MS } from '../domain/print-job-timing';
import { PrintApiError } from '../data/printers.api';
import type { PrinterSummary } from '../domain/print-device.schema';
import Harness from './__fixtures__/print-labels-button-harness.svelte';

const api = vi.hoisted(() => ({
	listShelterPrinters: vi.fn(),
	createPrintJob: vi.fn(),
	getPrintJobStatus: vi.fn()
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('../data/printers.api', async (importOriginal) => ({
	...(await importOriginal<typeof import('../data/printers.api')>()),
	...api
}));
vi.mock('svelte-sonner', () => ({ toast }));

const printer = (id: string, over: Partial<PrinterSummary> = {}): PrinterSummary => ({
	id,
	name: `เครื่อง-${id}`,
	station: null,
	online: true,
	queue_state: 'ready',
	last_seen_at: '2026-10-22T03:00:00.000Z',
	...over
});

let instance: ReturnType<typeof mount> | null = null;

async function render(props: { printers: PrinterSummary[] } & Record<string, unknown>) {
	const { printers, ...rest } = props;
	api.listShelterPrinters.mockResolvedValue({
		printers,
		server_time: '2026-10-22T03:00:10.000Z'
	});
	instance = mount(Harness, {
		target: document.body,
		props: {
			client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
			shelterCode: 'SH001',
			labelCount: 1,
			source: 'walk_in',
			renderLabels: async () => ['AAAA'],
			...rest
		}
	});
	await settle();
}

/** Let the printer-list query resolve and the DOM catch up. */
async function settle() {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
		flushSync();
	}
}

const labels = (count: number) => Array.from({ length: count }, (_, i) => `label-${i}`);
const mainButton = () => buttons()[0];
const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="radio"]')];
const buttons = () => [...document.body.querySelectorAll<HTMLButtonElement>('button')];

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	stationPrinter.set('SH001', null);
	endpointStore.markConnected();
});
afterEach(() => {
	vi.useRealTimers();
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('PrintLabelsButton', () => {
	it('renders nothing when the shelter has no active printers', async () => {
		await render({ printers: [] });

		expect(buttons()).toHaveLength(0);
	});

	it('disables the button and points to the PDF preview while the app is disconnected', async () => {
		endpointStore.markDisconnected();

		await render({ printers: [printer('p1')] });

		expect(buttons()).toHaveLength(1);
		expect(buttons()[0].disabled).toBe(true);
		expect(document.body.textContent).toContain(
			'พิมพ์ผ่านเครื่องพิมพ์ไม่ได้ขณะออฟไลน์ — ใช้พรีวิว PDF'
		);
	});

	it('opens the printer picker when no printer is chosen and remembers the choice', async () => {
		await render({
			printers: [printer('p1'), printer('p2', { online: false })]
		});

		buttons()[0].click();
		flushSync();

		expect(options().map((o) => o.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'เครื่อง-p1 ● ออนไลน์',
			'เครื่อง-p2 ● ออฟไลน์'
		]);

		options()[1].click();
		flushSync();

		expect(stationPrinter.get('SH001')).toBe('p2');
	});

	it('disables the button and names the printer when the chosen printer is offline', async () => {
		stationPrinter.set('SH001', 'p2');

		await render({
			printers: [printer('p1'), printer('p2', { name: 'โต๊ะ 1', online: false })]
		});

		const main = buttons()[0];
		expect(main.disabled).toBe(true);
		expect(document.body.textContent).toContain('เครื่อง โต๊ะ 1 ออฟไลน์');

		buttons()
			.find((b) => b.textContent?.includes('เปลี่ยนเครื่อง'))
			?.click();
		flushSync();
		expect(options()).toHaveLength(2);
	});

	it('renders lazily on click, sends one job and ignores a second click while printing', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({ job_id: 'job-1', expires_at: '2026-10-22T04:00:00Z' });
		api.getPrintJobStatus.mockResolvedValue({
			status: 'printing',
			printed: 0,
			label_count: 20,
			error_code: null
		});
		const renderLabels = vi.fn(async () => labels(45));
		await render({ printers: [printer('p1')], labelCount: 45, renderLabels });
		expect(renderLabels).not.toHaveBeenCalled();

		mainButton().click();
		await settle();
		mainButton().click();
		await settle();

		expect(renderLabels).toHaveBeenCalledTimes(1);
		expect(api.createPrintJob).toHaveBeenCalledTimes(1);
		expect(api.createPrintJob).toHaveBeenCalledWith({
			printer_id: 'p1',
			source: 'walk_in',
			labels: labels(20)
		});
		expect(mainButton().disabled).toBe(true);
		expect(mainButton().textContent).toContain('กำลังพิมพ์ 0/45…');
	});

	it('sends 45 labels as three sequential jobs and toasts the total once the last is claimed', async () => {
		stationPrinter.set('SH001', 'p1');
		let created = 0;
		api.createPrintJob.mockImplementation(async () => ({
			job_id: `job-${++created}`,
			expires_at: '2026-10-22T04:00:00Z'
		}));
		const sizes: Record<string, number> = { 'job-1': 20, 'job-2': 20, 'job-3': 5 };
		api.getPrintJobStatus.mockImplementation(async (jobId: string) => ({
			status: 'printed',
			printed: sizes[jobId],
			label_count: sizes[jobId],
			error_code: null
		}));
		await render({
			printers: [printer('p1')],
			labelCount: 45,
			renderLabels: async () => labels(45)
		});

		mainButton().click();
		await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

		expect(toast.success).toHaveBeenCalledWith('สั่งพิมพ์ 45 ใบไปที่ เครื่อง-p1 แล้ว');
		expect(api.createPrintJob.mock.calls.map(([input]) => input.labels)).toEqual([
			labels(45).slice(0, 20),
			labels(45).slice(20, 40),
			labels(45).slice(40)
		]);
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('toasts "sent" and frees the button as soon as the printer claims the last job', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({ job_id: 'job-1', expires_at: '2026-10-22T04:00:00Z' });
		api.getPrintJobStatus.mockResolvedValue({
			status: 'printing',
			printed: 0,
			label_count: 3,
			error_code: null
		});
		await render({ printers: [printer('p1')], labelCount: 3, renderLabels: async () => labels(3) });

		mainButton().click();
		await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
		await settle();

		expect(toast.success).toHaveBeenCalledWith('สั่งพิมพ์ 3 ใบไปที่ เครื่อง-p1 แล้ว');
		expect(toast.error).not.toHaveBeenCalled();
		expect(mainButton().disabled).toBe(false);
		expect(mainButton().textContent).toContain('พิมพ์ 3 ใบที่ เครื่อง-p1');
	});

	it('waits for earlier chunks to finish printing before sending the next one', async () => {
		stationPrinter.set('SH001', 'p1');
		let created = 0;
		api.createPrintJob.mockImplementation(async () => ({
			job_id: `job-${++created}`,
			expires_at: '2026-10-22T04:00:00Z'
		}));
		api.getPrintJobStatus.mockResolvedValue({
			status: 'printing',
			printed: 0,
			label_count: 20,
			error_code: null
		});
		await render({
			printers: [printer('p1')],
			labelCount: 25,
			renderLabels: async () => labels(25)
		});

		mainButton().click();
		await settle();
		await new Promise((resolve) => setTimeout(resolve, 50));
		await settle();

		expect(api.createPrintJob).toHaveBeenCalledTimes(1);
		expect(toast.success).not.toHaveBeenCalled();
		expect(mainButton().disabled).toBe(true);
	});

	it('toasts the reason for a failed job, stops sending and offers to print again', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({ job_id: 'job-1', expires_at: '2026-10-22T04:00:00Z' });
		api.getPrintJobStatus.mockResolvedValue({
			status: 'failed',
			printed: 0,
			label_count: 20,
			error_code: 'printer_timeout'
		});
		await render({
			printers: [printer('p1')],
			labelCount: 25,
			renderLabels: async () => labels(25)
		});

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		await settle();

		expect(toast.error).toHaveBeenCalledWith(
			'เครื่อง เครื่อง-p1 พิมพ์ไม่เสร็จในเวลาที่กำหนด ตรวจสอบกระดาษและสายไฟ'
		);
		expect(api.createPrintJob).toHaveBeenCalledTimes(1);
		expect(mainButton().textContent).toContain('พิมพ์อีกครั้ง');
		expect(mainButton().disabled).toBe(false);
	});

	it('resumes a part-printed chunk from the first label that did not come out', async () => {
		stationPrinter.set('SH001', 'p1');
		let created = 0;
		api.createPrintJob.mockImplementation(async () => ({
			job_id: `job-${++created}`,
			expires_at: '2026-10-22T04:00:00Z'
		}));
		api.getPrintJobStatus.mockImplementation(async (jobId: string) =>
			jobId === 'job-1'
				? { status: 'failed', printed: 7, label_count: 20, error_code: 'printer_timeout' }
				: { status: 'printed', printed: 0, label_count: 0, error_code: null }
		);
		await render({
			printers: [printer('p1')],
			labelCount: 25,
			renderLabels: async () => labels(25)
		});

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		await settle();
		mainButton().click();
		await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

		expect(api.createPrintJob.mock.calls.map(([input]) => input.labels)).toEqual([
			labels(25).slice(0, 20),
			labels(25).slice(7, 20),
			labels(25).slice(20)
		]);
	});

	it('hints that the printer has not picked up the job, without offering a retry yet', async () => {
		vi.useFakeTimers();
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({ job_id: 'job-1', expires_at: '2026-10-22T04:00:00Z' });
		api.getPrintJobStatus.mockResolvedValue({
			status: 'pending',
			printed: 0,
			label_count: 1,
			error_code: null
		});
		await render({ printers: [printer('p1')] });
		const hint = 'เครื่อง เครื่อง-p1 ยังไม่รับงาน — ตรวจสอบว่าเครื่องเปิดอยู่';

		mainButton().click();
		await vi.advanceTimersByTimeAsync(PRINT_JOB_PICKUP_HINT_MS - 1_000);
		expect(document.body.textContent).not.toContain(hint);
		await vi.advanceTimersByTimeAsync(2_000);

		expect(document.body.textContent).toContain(hint);
		expect(mainButton().disabled).toBe(true);
		expect(mainButton().textContent).not.toContain('พิมพ์อีกครั้ง');
	});

	it('gives up with a not-responding toast when the printer never claims the job', async () => {
		vi.useFakeTimers();
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({ job_id: 'job-1', expires_at: '2026-10-22T04:00:00Z' });
		api.getPrintJobStatus.mockResolvedValue({
			status: 'pending',
			printed: 0,
			label_count: 1,
			error_code: null
		});
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.advanceTimersByTimeAsync(PRINT_JOB_POLL_TIMEOUT_MS - 1_000);
		expect(toast.error).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(2_000);

		expect(toast.error).toHaveBeenCalledWith('เครื่อง เครื่อง-p1 ไม่ตอบ');
		expect(mainButton().textContent).toContain('พิมพ์อีกครั้ง');
	});

	it('treats an expired job as the printer not responding', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({ job_id: 'job-1', expires_at: '2026-10-22T04:00:00Z' });
		api.getPrintJobStatus.mockResolvedValue({
			status: 'expired',
			printed: 0,
			label_count: 1,
			error_code: null
		});
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

		expect(toast.error).toHaveBeenCalledWith('เครื่อง เครื่อง-p1 ไม่ตอบ');
	});

	it('tells the printer is offline when the server refuses the job with PRINTER_OFFLINE', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockRejectedValue(new PrintApiError('offline', 409, 'PRINTER_OFFLINE'));
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

		expect(toast.error).toHaveBeenCalledWith('เครื่อง เครื่อง-p1 ออฟไลน์');
		expect(mainButton().disabled).toBe(false);
	});

	it('shows a generic toast when sending the job fails for any other reason', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockRejectedValue(new PrintApiError('boom', 500, 'INTERNAL'));
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

		expect(toast.error).toHaveBeenCalledWith('ส่งงานพิมพ์ไปที่ เครื่อง-p1 ไม่สำเร็จ');
		expect(mainButton().disabled).toBe(false);
	});

	it('toasts and lets the user try again when the labels cannot be rendered', async () => {
		stationPrinter.set('SH001', 'p1');
		const renderLabels = vi.fn().mockRejectedValue(new Error('canvas failed'));
		await render({ printers: [printer('p1')], renderLabels });

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

		expect(toast.error).toHaveBeenCalledWith('สร้างภาพฉลากไม่สำเร็จ');
		expect(api.createPrintJob).not.toHaveBeenCalled();
		expect(mainButton().disabled).toBe(false);
	});
});
