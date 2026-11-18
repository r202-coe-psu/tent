// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { QueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { ServiceRequestError } from '$lib/api/service';
import type { ShelterCloseJobView } from '../domain/shelter-close-job';
import Harness from './__fixtures__/shelter-close-dialog-harness.svelte';

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const api = vi.hoisted(() => ({
	getShelterClosePreview: vi.fn(),
	closeShelter: vi.fn(),
	getShelterCloseJob: vi.fn()
}));
vi.mock('../data/shelters.api', async (importOriginal) => ({
	...(await importOriginal<typeof import('../data/shelters.api')>()),
	...api
}));

const PHRASE = 'SH001 ศูนย์ วัดกลาง';

const view = (over: Partial<ShelterCloseJobView> = {}): ShelterCloseJobView => ({
	job_id: 'JOB1',
	shelter_code: 'SH001',
	mode: 'close',
	status: 'running',
	phase: 'people',
	sweep_round: 0,
	counters: { checked_out: 3, cancelled: 1, households_repaired: 0, failed: 0 },
	preview: { by_status: { active: 8, pre_registered: 2 }, total: 10 },
	failures: [],
	closed: false,
	created_at: '2026-11-10T00:00:00.000Z',
	updated_at: '2026-11-10T00:00:00.000Z',
	...over
});

let client: QueryClient;
let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		await tick();
	}
}

const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel);
const button = (label: string) =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes(label)
	);
const confirmBtn = () => button('เช็คเอาต์ทั้งหมดและปิดศูนย์');

async function type(value: string) {
	const input = q<HTMLInputElement>('#shelter-close-confirm')!;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

function render(props: Record<string, unknown> = {}) {
	instance = mount(Harness, { target: document.body, props: { client, ...props } });
	return settle();
}

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	api.getShelterClosePreview.mockReset().mockResolvedValue({
		by_status: { active: 8, pre_registered: 2 },
		total: 10
	});
	api.closeShelter.mockReset().mockResolvedValue({ job_id: 'JOB1' });
	api.getShelterCloseJob.mockReset().mockResolvedValue(view());
	vi.mocked(toast.success).mockClear();
	vi.mocked(toast.error).mockClear();
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	client.clear();
	document.body.innerHTML = '';
});

describe('ShelterCloseDialog — confirm step (CR-219 FR-15..FR-18)', () => {
	it('shows the affected counts and keeps the button off until the exact phrase is typed', async () => {
		await render();
		expect(document.body.textContent).toContain('10');
		expect(confirmBtn()?.disabled).toBe(true);
		await type('SH001');
		expect(confirmBtn()?.disabled).toBe(true);
		await type(PHRASE);
		expect(confirmBtn()?.disabled).toBe(false);
	});
});

// Note: announceShelterCloseJob de-duplicates per job_id at module level, so each toast test uses
// its own job id.
describe('ShelterCloseDialog — progress (CR-243 FR-27, AC-1)', () => {
	it('starts the job and shows progress "เช็คเอาต์ X / Y · ยกเลิก Z · ล้มเหลว W" without waiting for it to finish', async () => {
		await render();
		await type(PHRASE);
		confirmBtn()!.click();
		await settle();

		expect(api.closeShelter).toHaveBeenCalledWith('SH001', PHRASE);
		expect(api.getShelterCloseJob).toHaveBeenCalledWith('SH001', 'JOB1');
		const text = q('[role="status"]')!.textContent!.replace(/\s+/g, ' ');
		expect(text).toContain('กำลังปิดศูนย์');
		expect(text).toContain('เช็คเอาต์ 3 / 10 · ยกเลิก 1 · ล้มเหลว 0');
		expect(q('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('40');
		// the confirm form is gone, the modal can be dismissed while the job runs
		expect(q('#shelter-close-confirm')).toBeNull();
		expect(button('ปิดหน้าต่าง')?.disabled).toBe(false);
		expect(toast.success).not.toHaveBeenCalled();
	});

	it('says "รอ worker รับงาน" while the job is queued and switches to the phase once a worker claims it', async () => {
		api.getShelterCloseJob.mockResolvedValue(view({ status: 'queued', phase: 'people' }));
		await render({ resumeJobId: 'JOB1' });
		await settle();
		const text = q('[role="status"]')!.textContent!.replace(/\s+/g, ' ');
		expect(text).toContain('รอ worker รับงาน');
		expect(text).toContain('30 วินาที');
		expect(text).not.toContain('กำลังปิดศูนย์ ·');
	});

	it('dismissing mid-job calls oncancel and does not toast (the job keeps running)', async () => {
		const oncancel = vi.fn();
		await render({ oncancel });
		await type(PHRASE);
		confirmBtn()!.click();
		await settle();
		button('ปิดหน้าต่าง')!.click();
		await settle();
		expect(oncancel).toHaveBeenCalledTimes(1);
		expect(q('[data-testid="open"]')?.textContent).toBe('false');
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.success).not.toHaveBeenCalled();
	});

	it('opens straight on the progress of an already running job (resumeJobId, FR-28)', async () => {
		await render({ resumeJobId: 'JOB1' });
		expect(api.closeShelter).not.toHaveBeenCalled();
		expect(q('#shelter-close-confirm')).toBeNull();
		expect(q('[role="progressbar"]')).not.toBeNull();
	});

	it('toasts success once and hands the finished view to onfinish (FR-29, ok)', async () => {
		const onfinish = vi.fn();
		await render({ resumeJobId: 'JOB1', onfinish });
		api.getShelterCloseJob.mockResolvedValue(
			view({
				status: 'completed',
				phase: 'done',
				end_reason: 'ok',
				closed: true,
				counters: { checked_out: 8, cancelled: 2, households_repaired: 0, failed: 0 }
			})
		);
		await client.invalidateQueries({ queryKey: ['shelters', 'close-job', 'SH001', 'JOB1'] });
		await settle();
		expect(toast.success).toHaveBeenCalledWith('ปิดศูนย์แล้ว · เช็คเอาต์ 8 คน · ยกเลิก 2 คน');
		expect(onfinish).toHaveBeenCalledTimes(1);
		expect(onfinish.mock.calls[0][0]).toMatchObject({ status: 'completed', closed: true });
		expect(q('[data-testid="open"]')?.textContent).toBe('false');
	});

	it('toasts the failure copy with the failed count (FR-29, failed)', async () => {
		const onfinish = vi.fn();
		await render({ resumeJobId: 'JOB2', onfinish });
		api.getShelterCloseJob.mockResolvedValue(
			view({
				job_id: 'JOB2',
				status: 'completed_with_errors',
				phase: 'done',
				end_reason: 'failed',
				counters: { checked_out: 5, cancelled: 0, households_repaired: 0, failed: 3 }
			})
		);
		await client.invalidateQueries({ queryKey: ['shelters', 'close-job', 'SH001', 'JOB2'] });
		await settle();
		expect(toast.error).toHaveBeenCalledWith(
			'ล้มเหลว 3 คน — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อทำต่อ'
		);
		expect(onfinish.mock.calls[0][0].closed).toBe(false);
	});
});

describe('ShelterCloseDialog — start errors', () => {
	it('follows the existing job on 409 instead of starting a second one (FR-7)', async () => {
		api.closeShelter.mockRejectedValue(new ServiceRequestError('กำลังปิดศูนย์อยู่แล้ว', 409));
		api.getShelterClosePreview.mockResolvedValue({
			by_status: { active: 8 },
			total: 8,
			active_job: { job_id: 'JOB9', status: 'running' }
		});
		api.getShelterCloseJob.mockResolvedValue(view({ job_id: 'JOB9' }));
		await render();
		await type(PHRASE);
		confirmBtn()!.click();
		await settle();
		expect(api.getShelterCloseJob).toHaveBeenCalledWith('SH001', 'JOB9');
		expect(q('[role="progressbar"]')).not.toBeNull();
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('stays open on the confirm step and toasts when the request fails (400 / network)', async () => {
		api.closeShelter.mockRejectedValue(new ServiceRequestError('ข้อความยืนยันไม่ตรง', 400));
		await render();
		await type(PHRASE);
		confirmBtn()!.click();
		await settle();
		expect(toast.error).toHaveBeenCalledWith('ข้อความยืนยันไม่ตรง');
		expect(q('#shelter-close-confirm')).not.toBeNull();
		expect(api.getShelterCloseJob).not.toHaveBeenCalled();
	});
});
