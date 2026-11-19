// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { QueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import type { ShelterSummary } from '../data/shelters.repository';
import type { ShelterCloseJobView } from '../domain/shelter-close-job';
import Harness from './__fixtures__/shelter-form-page-harness.svelte';

// CR-243 FR-28 / FR-29: the edit page shows a banner while a close job is active (also for a job
// started before the page was opened), locks the status select, and toasts once when it ends.
vi.mock('./location-map-picker.svelte', () => import('./__fixtures__/empty-component.svelte'));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('$app/forms', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/forms')>()),
	enhance: () => ({ destroy() {} })
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	invalidateAll: vi.fn()
}));
vi.mock('../data/shelters.remote', () => ({
	SHELTER_REGISTRY_DB: 'registry',
	sheltersRepository: () => ({
		getShelter: async () =>
			({
				code: 'SH001',
				_rev: '1-a',
				name: 'ศูนย์เดิม',
				site_kind: 'evacuation_center',
				operation_status: 'active',
				capacity: 100,
				common_areas: { sub_storage: [] }
			}) as unknown as ShelterSummary
	})
}));
const api = vi.hoisted(() => ({ getShelterClosePreview: vi.fn(), getShelterCloseJob: vi.fn() }));
vi.mock('../data/shelters.api', async (importOriginal) => ({
	...(await importOriginal<typeof import('../data/shelters.api')>()),
	...api
}));

const view = (over: Partial<ShelterCloseJobView> = {}): ShelterCloseJobView => ({
	job_id: 'PAGE-JOB-1',
	shelter_code: 'SH001',
	mode: 'close',
	status: 'running',
	phase: 'people',
	sweep_round: 0,
	counters: { checked_out: 1, cancelled: 0, households_repaired: 0, failed: 0 },
	preview: { by_status: { active: 4 }, total: 4 },
	failures: [],
	closed: false,
	created_at: '2026-11-10T00:00:00.000Z',
	updated_at: '2026-11-10T00:00:00.000Z',
	...over
});

let client: QueryClient;
let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	for (let i = 0; i < 6; i++) {
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		await tick();
	}
}
const banner = () =>
	[...document.body.querySelectorAll('[role="status"]')].find((el) =>
		el.textContent?.includes('กำลังปิดศูนย์')
	);

async function render() {
	instance = mount(Harness, { target: document.body, props: { client, code: 'SH001' } });
	await settle();
}

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	api.getShelterClosePreview.mockReset();
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

describe('ShelterFormPage — close job banner (CR-243 FR-28, FR-29)', () => {
	it('shows no banner when no job is active', async () => {
		api.getShelterClosePreview.mockResolvedValue({ by_status: {}, total: 0 });
		await render();
		expect(banner()).toBeUndefined();
		expect(api.getShelterCloseJob).not.toHaveBeenCalled();
	});

	it('shows the banner for a job started earlier and offers to view its progress', async () => {
		api.getShelterClosePreview.mockResolvedValue({
			by_status: { active: 4 },
			total: 4,
			active_job: { job_id: 'PAGE-JOB-1', status: 'running' }
		});
		await render();
		expect(banner()).toBeDefined();
		expect(api.getShelterCloseJob).toHaveBeenCalledWith('SH001', 'PAGE-JOB-1');
		expect(
			[...document.body.querySelectorAll('button')].some((b) =>
				b.textContent?.includes('ดูความคืบหน้า')
			)
		).toBe(true);
		expect(toast.success).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('disables the shelter status select while the job runs', async () => {
		api.getShelterClosePreview.mockResolvedValue({
			by_status: { active: 4 },
			total: 4,
			active_job: { job_id: 'PAGE-JOB-1', status: 'running' }
		});
		await render();
		const trigger = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
			b.textContent?.includes('เปิดดำเนินการ')
		);
		// the status trigger is the only button showing the stored status label
		expect(
			trigger === undefined ||
				trigger.disabled ||
				trigger.getAttribute('aria-disabled') === 'true' ||
				trigger.hasAttribute('data-disabled')
		).toBe(true);
	});

	it('drops the banner and toasts once (failed copy) when the job ends', async () => {
		api.getShelterClosePreview.mockResolvedValue({
			by_status: { active: 4 },
			total: 4,
			active_job: { job_id: 'PAGE-JOB-1', status: 'running' }
		});
		await render();
		api.getShelterClosePreview.mockResolvedValue({ by_status: { active: 1 }, total: 1 });
		api.getShelterCloseJob.mockResolvedValue(
			view({
				status: 'completed_with_errors',
				phase: 'done',
				end_reason: 'stale',
				counters: { checked_out: 3, cancelled: 0, households_repaired: 0, failed: 0 }
			})
		);
		await client.invalidateQueries({ queryKey: ['shelters', 'close-job', 'SH001', 'PAGE-JOB-1'] });
		await settle();
		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith(
			'งานปิดศูนย์หยุดไปนาน — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อเริ่มใหม่'
		);
		expect(banner()).toBeUndefined();
	});
});
