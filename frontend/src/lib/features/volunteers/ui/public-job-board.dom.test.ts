// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { langState } from '$lib/states/i18n.svelte';
import PublicJobBoard from './public-job-board.svelte';

vi.mock('$lib/features/volunteer-portal/data/volunteer-api', async (original) => ({
	...(await original<typeof import('$lib/features/volunteer-portal/data/volunteer-api')>()),
	fetchVolunteerSkills: vi.fn(async () => [
		{ code: 'cooking', label: 'ทำอาหาร', category: 'general' }
	])
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const job = (n: number) => ({
	job_id: `job:${n}`,
	title: `Job ${n}`,
	shelter_code: 'SH001',
	shelter_name: 'Main shelter',
	quota: 5,
	slots_confirmed: 0,
	slots_remaining: 5,
	status: 'open',
	shifts: [
		{
			shift_id: `s${n}`,
			date: '2099-09-10',
			start_time: '08:00',
			end_time: '12:00',
			quota: 5,
			slots_confirmed: 0,
			applicants_count: 0
		}
	]
});

let instance: ReturnType<typeof mount> | null = null;
const fetchMock = vi.fn();

function lastUrl(): URL {
	const call = fetchMock.mock.calls.at(-1);
	return new URL(String(call?.[0]), 'http://localhost');
}

async function settle() {
	for (let i = 0; i < 5; i++) {
		await tick();
		await Promise.resolve();
	}
	flushSync();
}

beforeEach(() => {
	vi.useFakeTimers();
	langState.current = 'th';
	fetchMock.mockReset();
	fetchMock.mockImplementation(async (input: string) => {
		const url = new URL(input, 'http://localhost');
		const page = Number(url.searchParams.get('page') ?? '1');
		return {
			ok: true,
			json: async () => ({
				success: true,
				jobs: [job(page * 10)],
				total: 13,
				shelters: [{ code: 'SH001', name: 'Main shelter' }]
			})
		};
	});
	vi.stubGlobal('fetch', fetchMock);
	window.HTMLElement.prototype.scrollIntoView = vi.fn();
	window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia;
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('public job board server-side filtering', () => {
	it('asks the BFF for page 1 with the page size and renders only the returned page', async () => {
		instance = mount(PublicJobBoard, { target: document.body });
		await settle();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(lastUrl().pathname).toBe('/api/public/v1/volunteer/jobs');
		expect(lastUrl().searchParams.get('page')).toBe('1');
		expect(lastUrl().searchParams.get('page_size')).toBe('6');
		expect(document.body.textContent).toContain('Job 10');
		// The total comes from the API, not from the rows in hand.
		expect(document.body.textContent).toContain('13');
	});

	it('debounces typing into a single request carrying q', async () => {
		instance = mount(PublicJobBoard, { target: document.body });
		await settle();
		fetchMock.mockClear();

		const input = document.body.querySelector('input[type="text"]') as HTMLInputElement;
		for (const value of ['k', 'ki', 'kit']) {
			input.value = value;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			flushSync();
			await vi.advanceTimersByTimeAsync(100);
		}
		expect(fetchMock).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(300);
		await settle();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(lastUrl().searchParams.get('q')).toBe('kit');
		expect(lastUrl().searchParams.get('page')).toBe('1');
	});

	it('sends the status filter and goes back to page 1', async () => {
		instance = mount(PublicJobBoard, { target: document.body });
		await settle();
		fetchMock.mockClear();

		const pills = [...document.body.querySelectorAll('button')];
		const nearFull = pills.find((b) => b.textContent?.includes('ใกล้เต็ม'));
		nearFull?.click();
		await settle();

		expect(lastUrl().searchParams.get('status')).toBe('near_full');
		expect(lastUrl().searchParams.get('page')).toBe('1');
	});

	it('requests the next page when a page number is picked', async () => {
		instance = mount(PublicJobBoard, { target: document.body });
		await settle();
		fetchMock.mockClear();

		const link = [...document.body.querySelectorAll('a, button')].find(
			(el) => el.textContent?.trim() === '2'
		) as HTMLElement | undefined;
		expect(link).toBeTruthy();
		link?.click();
		await settle();

		expect(lastUrl().searchParams.get('page')).toBe('2');
		expect(document.body.textContent).toContain('Job 20');
	});
});
