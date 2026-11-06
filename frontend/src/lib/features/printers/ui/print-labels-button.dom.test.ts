// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { QueryClient } from '@tanstack/svelte-query';
import { endpointStore } from '$lib/stores/endpoint.svelte';
import { stationPrinter } from '../application/station-printer.svelte';
import { PRINT_JOB_POLL_TIMEOUT_MS } from '../domain/print-job-status';
import {
	PRINT_JOB_CREATE_TIMEOUT_MS,
	PRINT_JOB_FINAL_CHECK_MS,
	PRINT_JOB_PICKUP_HINT_MS
} from '../domain/print-job-timing';
import { PrintApiError } from '../data/printers.api';
import type { PrinterSummary } from '../domain/print-device.schema';
import Harness from './__fixtures__/print-labels-button-harness.svelte';

const api = vi.hoisted(() => ({
	listShelterPrinters: vi.fn(),
	createPrintJob: vi.fn(),
	getPrintJobStatus: vi.fn()
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const session = vi.hoisted(() => ({ roles: [] as string[] }));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'staff', roles: session.roles };
		}
	}
}));

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

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const labels = (count: number) => Array.from({ length: count }, (_, i) => `label-${i}`);
/** Labels of every create call so far, in order. */
const sentLabels = () => api.createPrintJob.mock.calls.map(([input]) => input.labels);
/** Job id of every create call so far, in order. */
const sentJobIds = () => api.createPrintJob.mock.calls.map(([input]) => input.job_id as string);
/** A create call that never answers until its signal aborts, as a stalled fetch would. */
function hangUntilAborted() {
	return (_input: unknown, signal: AbortSignal) =>
		new Promise((_resolve, reject) => {
			signal.addEventListener('abort', () => reject(signal.reason));
		});
}
const mainButton = () => buttons()[0];
const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="radio"]')];
const buttons = () => [...document.body.querySelectorAll<HTMLButtonElement>('button')];

beforeEach(() => {
	vi.clearAllMocks();
	session.roles = ['shelter:SH001', 'SH001:registration_staff'];
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

	it('renders nothing for staff who may not print this source in the shelter', async () => {
		session.roles = ['shelter:SH001', 'SH001:kiosk_staff'];

		await render({ printers: [printer('p1')] });

		expect(buttons()).toHaveLength(0);
	});

	it('renders nothing for registration staff of another shelter', async () => {
		session.roles = ['shelter:SH002', 'SH002:registration_staff'];

		await render({ printers: [printer('p1')] });

		expect(buttons()).toHaveLength(0);
	});

	it('shows the button to a system admin in any shelter', async () => {
		session.roles = ['system_admin'];

		await render({ printers: [printer('p1')] });

		expect(buttons()).toHaveLength(1);
	});

	it('tells the user they may not print when the server answers 403', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockRejectedValue(new PrintApiError('no', 403, 'FORBIDDEN'));
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

		expect(toast.error).toHaveBeenCalledWith('คุณไม่มีสิทธิ์พิมพ์ฉลากในศูนย์นี้');
		expect(mainButton().disabled).toBe(false);
	});

	it('explains an invalid_label failure from the job status', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
		api.getPrintJobStatus.mockResolvedValue({
			status: 'failed',
			printed: 0,
			label_count: 1,
			error_code: 'invalid_label'
		});
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

		expect(toast.error).toHaveBeenCalledWith('รูป label ไม่ถูกต้อง — ลองพิมพ์ใหม่จากหน้านี้');
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
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
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
		expect(api.createPrintJob).toHaveBeenCalledWith(
			{
				job_id: expect.stringMatching(ULID),
				printer_id: 'p1',
				source: 'walk_in',
				labels: labels(20)
			},
			expect.any(AbortSignal)
		);
		expect(mainButton().disabled).toBe(true);
		expect(mainButton().textContent).toContain('กำลังพิมพ์ 0/45…');
	});

	it('polls the job with the shelter code the server returned when it created the job', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH009',
			expires_at: '2026-10-22T04:00:00Z'
		});
		api.getPrintJobStatus.mockResolvedValue({
			status: 'printing',
			printed: 0,
			label_count: 1,
			error_code: null
		});
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

		expect(api.getPrintJobStatus).toHaveBeenCalledWith('job-1', 'SH009');
	});

	it('sends 45 labels as three sequential jobs and toasts the total once the last is claimed', async () => {
		stationPrinter.set('SH001', 'p1');
		let created = 0;
		api.createPrintJob.mockImplementation(async () => ({
			job_id: `job-${++created}`,
			shelter_code: 'SH001',
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
		expect(sentLabels()).toEqual([
			labels(45).slice(0, 20),
			labels(45).slice(20, 40),
			labels(45).slice(40)
		]);
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('toasts "sent" and frees the button as soon as the printer claims the last job', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
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
			shelter_code: 'SH001',
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

	it('cancels a multi-chunk print: stops sending, frees the button and keeps the unsent chunk', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
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
		const cancel = buttons().find((b) => b.textContent?.trim() === 'ยกเลิก');
		expect(cancel).toBeDefined();
		cancel?.click();
		await vi.waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));

		expect(api.createPrintJob).toHaveBeenCalledTimes(1);
		expect(toast.success).not.toHaveBeenCalled();
		expect(mainButton().disabled).toBe(false);
		expect(mainButton().textContent).toContain('พิมพ์อีกครั้ง');
		expect(buttons().some((b) => b.textContent?.trim() === 'ยกเลิก')).toBe(false);
	});

	it('does not poll or announce anything when unmounted while a job is being created', async () => {
		stationPrinter.set('SH001', 'p1');
		let release: (value: unknown) => void = () => {};
		api.createPrintJob.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		await render({
			printers: [printer('p1')],
			labelCount: 25,
			renderLabels: async () => labels(25)
		});

		mainButton().click();
		await settle();
		unmount(instance as ReturnType<typeof mount>);
		instance = null;
		release({ job_id: 'job-1', shelter_code: 'SH001', expires_at: '2026-10-22T04:00:00Z' });
		await settle();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(api.createPrintJob).toHaveBeenCalledTimes(1);
		expect(api.getPrintJobStatus).not.toHaveBeenCalled();
		expect(toast.info).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.success).not.toHaveBeenCalled();
	});

	it('toasts the reason for a failed job, stops sending and offers to print again', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
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
			shelter_code: 'SH001',
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

		expect(sentLabels()).toEqual([
			labels(25).slice(0, 20),
			labels(25).slice(7, 20),
			labels(25).slice(20)
		]);
	});

	it('hints that the printer has not picked up the job, without offering a retry yet', async () => {
		vi.useFakeTimers();
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
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
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
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

	it('keeps polling and shows "unknown result" without a retry while the status route keeps failing', async () => {
		vi.useFakeTimers();
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
		api.getPrintJobStatus.mockRejectedValue(new PrintApiError('forbidden', 403, 'FORBIDDEN'));
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.advanceTimersByTimeAsync(PRINT_JOB_POLL_TIMEOUT_MS / 2);

		expect(toast.error).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('ยังไม่ทราบผล — ตรวจที่เครื่องพิมพ์ เครื่อง-p1');
		expect(mainButton().disabled).toBe(true);
		expect(mainButton().textContent).not.toContain('พิมพ์อีกครั้ง');
		expect(api.getPrintJobStatus.mock.calls.length).toBeGreaterThan(10);
	});

	it('offers a retry only after the full poll timeout when the status route never recovers', async () => {
		vi.useFakeTimers();
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
		api.getPrintJobStatus.mockRejectedValue(new Error('network'));
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.advanceTimersByTimeAsync(PRINT_JOB_POLL_TIMEOUT_MS - 1_000);
		expect(toast.error).not.toHaveBeenCalled();
		expect(mainButton().textContent).not.toContain('พิมพ์อีกครั้ง');
		await vi.advanceTimersByTimeAsync(2_000);

		expect(toast.error).toHaveBeenCalledWith(
			'ไม่ทราบผลการพิมพ์ที่ เครื่อง-p1 — กดพิมพ์อีกครั้งเพื่อตามผลงานเดิม ระบบจะไม่ส่งฉลากซ้ำ'
		);
		expect(mainButton().textContent).toContain('พิมพ์อีกครั้ง');
		expect(mainButton().disabled).toBe(false);
	});

	it('retries an unknown result under the same job id on the same printer, then resumes after what it printed', async () => {
		vi.useFakeTimers();
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockImplementation(async (input: { job_id: string }) => ({
			job_id: input.job_id,
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		}));
		// The status route is down for the whole first wait; the replayed job then turns out failed.
		const outageEndsAt = Date.now() + PRINT_JOB_POLL_TIMEOUT_MS + PRINT_JOB_FINAL_CHECK_MS;
		api.getPrintJobStatus.mockImplementation(async () => {
			if (Date.now() < outageEndsAt) throw new Error('network');
			return { status: 'failed', printed: 5, label_count: 20, error_code: 'printer_timeout' };
		});
		await render({
			printers: [printer('p1'), printer('p2')],
			labelCount: 25,
			renderLabels: async () => labels(25)
		});

		mainButton().click();
		await vi.advanceTimersByTimeAsync(PRINT_JOB_POLL_TIMEOUT_MS + PRINT_JOB_FINAL_CHECK_MS);
		expect(toast.error).toHaveBeenCalledWith(
			'ไม่ทราบผลการพิมพ์ที่ เครื่อง-p1 — กดพิมพ์อีกครั้งเพื่อตามผลงานเดิม ระบบจะไม่ส่งฉลากซ้ำ'
		);
		stationPrinter.set('SH001', 'p2');
		await settle();
		mainButton().click();
		await vi.advanceTimersByTimeAsync(5_000);

		const calls = api.createPrintJob.mock.calls.map(([input]) => input);
		expect(calls).toHaveLength(2);
		expect(calls[1].job_id).toBe(calls[0].job_id);
		expect(calls[1].printer_id).toBe('p1');
		expect(calls[1].labels).toEqual(labels(25).slice(0, 20));

		// The replayed job ended failed after 5 labels: only the rest goes out, under a new id.
		mainButton().click();
		await vi.advanceTimersByTimeAsync(0);
		expect(sentLabels()[2]).toEqual(labels(25).slice(5, 20));
		expect(sentJobIds()[2]).not.toBe(calls[0].job_id);
	});

	it('retries a job still open at the poll timeout under the same job id', async () => {
		vi.useFakeTimers();
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockImplementation(async (input: { job_id: string }) => ({
			job_id: input.job_id,
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		}));
		api.getPrintJobStatus.mockResolvedValue({
			status: 'pending',
			printed: 0,
			label_count: 1,
			error_code: null
		});
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.advanceTimersByTimeAsync(PRINT_JOB_POLL_TIMEOUT_MS + 1_000);
		expect(toast.error).toHaveBeenCalledWith('เครื่อง เครื่อง-p1 ไม่ตอบ');
		api.getPrintJobStatus.mockResolvedValue({
			status: 'printed',
			printed: 1,
			label_count: 1,
			error_code: null
		});
		mainButton().click();
		await vi.advanceTimersByTimeAsync(5_000);

		expect(toast.success).toHaveBeenCalledTimes(1);
		const [first, second] = sentJobIds();
		expect(second).toBe(first);
	});

	it('checks the status once more at the poll timeout and goes on when the job did print', async () => {
		vi.useFakeTimers();
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
		const outageEndsAt = Date.now() + PRINT_JOB_POLL_TIMEOUT_MS;
		api.getPrintJobStatus.mockImplementation(async () => {
			if (Date.now() < outageEndsAt) throw new Error('network');
			return { status: 'printed', printed: 20, label_count: 20, error_code: null };
		});
		await render({
			printers: [printer('p1')],
			labelCount: 25,
			renderLabels: async () => labels(25)
		});

		mainButton().click();
		await vi.advanceTimersByTimeAsync(PRINT_JOB_POLL_TIMEOUT_MS + 1_000);

		expect(toast.error).not.toHaveBeenCalled();
		expect(sentLabels()).toEqual([labels(25).slice(0, 20), labels(25).slice(20)]);
	});

	it('gives up on a final status check that hangs', async () => {
		vi.useFakeTimers();
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
		const outageEndsAt = Date.now() + PRINT_JOB_POLL_TIMEOUT_MS;
		api.getPrintJobStatus.mockImplementation(async () => {
			if (Date.now() < outageEndsAt) throw new Error('network');
			return new Promise(() => {});
		});
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.advanceTimersByTimeAsync(PRINT_JOB_POLL_TIMEOUT_MS + 1_000);
		expect(toast.error).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(PRINT_JOB_FINAL_CHECK_MS);

		expect(toast.error).toHaveBeenCalledWith(
			'ไม่ทราบผลการพิมพ์ที่ เครื่อง-p1 — กดพิมพ์อีกครั้งเพื่อตามผลงานเดิม ระบบจะไม่ส่งฉลากซ้ำ'
		);
		expect(mainButton().textContent).toContain('พิมพ์อีกครั้ง');
	});

	it('drops the "unknown result" note and finishes once the status route recovers', async () => {
		vi.useFakeTimers();
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
		api.getPrintJobStatus
			.mockRejectedValueOnce(new Error('network'))
			.mockRejectedValueOnce(new Error('network'))
			.mockRejectedValueOnce(new Error('network'))
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValueOnce({ status: 'pending', printed: 0, label_count: 1, error_code: null })
			.mockResolvedValue({ status: 'printed', printed: 1, label_count: 1, error_code: null });
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.advanceTimersByTimeAsync(3_000);
		expect(document.body.textContent).toContain('ยังไม่ทราบผล');
		await vi.advanceTimersByTimeAsync(5_000);

		expect(document.body.textContent).not.toContain('ยังไม่ทราบผล');
		expect(toast.success).toHaveBeenCalledTimes(1);
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('keeps waiting through a one-off status failure', async () => {
		vi.useFakeTimers();
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
		api.getPrintJobStatus
			.mockRejectedValueOnce(new Error('network'))
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValueOnce({ status: 'pending', printed: 0, label_count: 1, error_code: null })
			.mockRejectedValueOnce(new Error('network'))
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValue({ status: 'printed', printed: 1, label_count: 1, error_code: null });
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.advanceTimersByTimeAsync(10_000);

		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.success).toHaveBeenCalledTimes(1);
	});

	it('mints one distinct job id per chunk', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockImplementation(async (input: { job_id: string }) => ({
			job_id: input.job_id,
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		}));
		api.getPrintJobStatus.mockImplementation(async () => ({
			status: 'printed',
			printed: 20,
			label_count: 20,
			error_code: null
		}));
		await render({
			printers: [printer('p1')],
			labelCount: 45,
			renderLabels: async () => labels(45)
		});

		mainButton().click();
		await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

		const ids = sentJobIds();
		expect(ids).toHaveLength(3);
		expect(ids.every((id) => ULID.test(id))).toBe(true);
		expect(new Set(ids).size).toBe(3);
	});

	it('keeps a chunk whose create outcome is unknown on its printer after the user switches printers', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob
			.mockRejectedValueOnce(new TypeError('network'))
			.mockImplementation(async (input: { job_id: string }) => ({
				job_id: input.job_id,
				shelter_code: 'SH001',
				expires_at: '2026-10-22T04:00:00Z'
			}));
		api.getPrintJobStatus.mockResolvedValue({
			status: 'printed',
			printed: 1,
			label_count: 1,
			error_code: null
		});
		await render({ printers: [printer('p1'), printer('p2')] });

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		stationPrinter.set('SH001', 'p2');
		await settle();
		expect(document.body.textContent).toContain(
			'งานก่อนหน้ายังไม่ทราบผล — พิมพ์อีกครั้งจะส่งไปที่ เครื่อง-p1 เพื่อไม่ให้พิมพ์ซ้ำ'
		);
		mainButton().click();
		await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

		const calls = api.createPrintJob.mock.calls.map(([input]) => input);
		expect(calls.map((c) => c.printer_id)).toEqual(['p1', 'p1']);
		expect(calls[1].job_id).toBe(calls[0].job_id);
	});

	it('keeps a chunk on its printer after a 5xx create, which may have been written', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob
			.mockRejectedValueOnce(new PrintApiError('unavailable', 503, 'DEPENDENCY_UNAVAILABLE'))
			.mockImplementation(async (input: { job_id: string }) => ({
				job_id: input.job_id,
				shelter_code: 'SH001',
				expires_at: '2026-10-22T04:00:00Z'
			}));
		api.getPrintJobStatus.mockResolvedValue({
			status: 'printed',
			printed: 1,
			label_count: 1,
			error_code: null
		});
		await render({ printers: [printer('p1'), printer('p2')] });

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		stationPrinter.set('SH001', 'p2');
		await settle();
		mainButton().click();
		await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

		const calls = api.createPrintJob.mock.calls.map(([input]) => input);
		expect(calls.map((c) => c.printer_id)).toEqual(['p1', 'p1']);
		expect(calls[1].job_id).toBe(calls[0].job_id);
	});

	it('keeps a chunk on its printer after cancelling its create, even when the user switches printers', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob
			.mockImplementationOnce(hangUntilAborted())
			.mockImplementation(async (input: { job_id: string }) => ({
				job_id: input.job_id,
				shelter_code: 'SH001',
				expires_at: '2026-10-22T04:00:00Z'
			}));
		api.getPrintJobStatus.mockResolvedValue({
			status: 'printed',
			printed: 1,
			label_count: 1,
			error_code: null
		});
		await render({ printers: [printer('p1'), printer('p2')] });

		mainButton().click();
		await settle();
		buttons()
			.find((b) => b.textContent?.trim() === 'ยกเลิก')
			?.click();
		await vi.waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
		stationPrinter.set('SH001', 'p2');
		await settle();
		expect(document.body.textContent).toContain('พิมพ์อีกครั้งจะส่งไปที่ เครื่อง-p1');
		mainButton().click();
		await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

		const calls = api.createPrintJob.mock.calls.map(([input]) => input);
		expect(calls.map((c) => c.printer_id)).toEqual(['p1', 'p1']);
		expect(calls[1].job_id).toBe(calls[0].job_id);
	});

	it('sends to the newly chosen printer when the old one refused the job outright', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob
			.mockRejectedValueOnce(new PrintApiError('offline', 409, 'PRINTER_OFFLINE'))
			.mockImplementation(async (input: { job_id: string }) => ({
				job_id: input.job_id,
				shelter_code: 'SH001',
				expires_at: '2026-10-22T04:00:00Z'
			}));
		api.getPrintJobStatus.mockResolvedValue({
			status: 'printed',
			printed: 1,
			label_count: 1,
			error_code: null
		});
		await render({ printers: [printer('p1'), printer('p2')] });

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		stationPrinter.set('SH001', 'p2');
		await settle();
		mainButton().click();
		await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

		expect(api.createPrintJob.mock.calls.map(([input]) => input.printer_id)).toEqual(['p1', 'p2']);
	});

	it('retries a create whose outcome was unknown under the same job id', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob
			.mockRejectedValueOnce(new TypeError('network'))
			.mockImplementation(async (input: { job_id: string }) => ({
				job_id: input.job_id,
				shelter_code: 'SH001',
				expires_at: '2026-10-22T04:00:00Z'
			}));
		api.getPrintJobStatus.mockResolvedValue({
			status: 'printed',
			printed: 1,
			label_count: 1,
			error_code: null
		});
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		await settle();
		expect(mainButton().textContent).toContain('พิมพ์อีกครั้ง');
		mainButton().click();
		await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

		const [first, second] = sentJobIds();
		expect(first).toMatch(ULID);
		expect(second).toBe(first);
	});

	it('cancel aborts the create that is in flight and a retry reuses its job id', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockImplementationOnce(hangUntilAborted());
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await settle();
		const signal = api.createPrintJob.mock.calls[0][1] as AbortSignal;
		expect(signal.aborted).toBe(false);
		buttons()
			.find((b) => b.textContent?.trim() === 'ยกเลิก')
			?.click();
		await vi.waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));

		expect(signal.aborted).toBe(true);
		expect(mainButton().textContent).toContain('พิมพ์อีกครั้ง');

		api.createPrintJob.mockResolvedValue({
			job_id: 'x',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
		api.getPrintJobStatus.mockResolvedValue({
			status: 'printed',
			printed: 1,
			label_count: 1,
			error_code: null
		});
		mainButton().click();
		await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

		const [first, second] = sentJobIds();
		expect(second).toBe(first);
	});

	it('gives up on a create that hangs after the send timeout and retries under the same job id', async () => {
		vi.useFakeTimers();
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockImplementationOnce(hangUntilAborted());
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.advanceTimersByTimeAsync(PRINT_JOB_CREATE_TIMEOUT_MS - 1_000);
		expect(toast.error).not.toHaveBeenCalled();
		expect(mainButton().textContent).toContain('กำลังพิมพ์ 0/1');
		await vi.advanceTimersByTimeAsync(2_000);

		expect(toast.error).toHaveBeenCalledWith('ส่งงานพิมพ์ไปที่ เครื่อง-p1 ไม่สำเร็จ');
		expect(mainButton().textContent).toContain('พิมพ์อีกครั้ง');
		expect(mainButton().disabled).toBe(false);

		api.createPrintJob.mockResolvedValue({
			job_id: 'x',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
		api.getPrintJobStatus.mockResolvedValue({
			status: 'printed',
			printed: 1,
			label_count: 1,
			error_code: null
		});
		mainButton().click();
		await vi.advanceTimersByTimeAsync(3_000);

		const [first, second] = sentJobIds();
		expect(second).toBe(first);
		expect(toast.success).toHaveBeenCalledTimes(1);
	});

	it('uses a fresh job id for the rest of a chunk whose job failed', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockImplementation(async (input: { job_id: string }) => ({
			job_id: input.job_id,
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		}));
		api.getPrintJobStatus.mockImplementation(async (jobId: string) =>
			jobId === sentJobIds()[0]
				? { status: 'failed', printed: 7, label_count: 20, error_code: 'printer_timeout' }
				: { status: 'printed', printed: 13, label_count: 13, error_code: null }
		);
		await render({
			printers: [printer('p1')],
			labelCount: 20,
			renderLabels: async () => labels(20)
		});

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		await settle();
		mainButton().click();
		await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

		const [first, second] = sentJobIds();
		expect(second).toMatch(ULID);
		expect(second).not.toBe(first);
	});

	it('mints a new job id when the server says the old one belongs to another job', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockRejectedValueOnce(new PrintApiError('taken', 409, 'JOB_ID_CONFLICT'));
		await render({ printers: [printer('p1')] });

		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		await settle();
		api.createPrintJob.mockRejectedValueOnce(new Error('stop'));
		mainButton().click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));

		const [first, second] = sentJobIds();
		expect(second).toMatch(ULID);
		expect(second).not.toBe(first);
	});

	it('treats an expired job as the printer not responding', async () => {
		stationPrinter.set('SH001', 'p1');
		api.createPrintJob.mockResolvedValue({
			job_id: 'job-1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T04:00:00Z'
		});
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
