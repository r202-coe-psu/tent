// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import PreRegistrationsPage from './pre-registrations-page.svelte';

const mocks = vi.hoisted(() => ({
	seen: [] as { limit?: number; offset?: number }[],
	total: 45
}));

vi.mock('../application/queries', () => ({
	usePreRegistrations: (get: () => { limit?: number; offset?: number }) => ({
		get data() {
			const f = get();
			mocks.seen.push({ limit: f.limit, offset: f.offset });
			return { items: [], total: mocks.total, limit: f.limit, offset: f.offset };
		},
		isError: false,
		isPending: false
	})
}));
vi.mock('./overview-filter-bar.svelte', () => ({ default: () => {} }));
vi.mock('$lib/features/dashboard', () => ({ AGE_BUCKET_LABELS: {} }));

let instance: ReturnType<typeof mount> | null = null;

beforeEach(() => {
	mocks.seen.length = 0;
	mocks.total = 45;
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

async function render() {
	instance = mount(PreRegistrationsPage, { target: document.body });
	await tick();
	flushSync();
}

describe('pre-registrations-page paging', () => {
	it('requests 20 rows per page and shows the range footer', async () => {
		await render();
		expect(mocks.seen[0]).toEqual({ limit: 20, offset: 0 });
		expect(document.body.textContent?.replace(/\s+/g, ' ')).toContain('แสดง 1 - 20 จาก 45 รายการ');
	});

	it('moves the offset by one page when Next is clicked', async () => {
		await render();
		(document.querySelector('[aria-label="Go to next page"]') as HTMLElement).click();
		await tick();
		flushSync();
		expect(mocks.seen.at(-1)).toEqual({ limit: 20, offset: 20 });
		expect(document.body.textContent?.replace(/\s+/g, ' ')).toContain('แสดง 21 - 40 จาก 45 รายการ');
	});

	it('hides the footer when everything fits on one page', async () => {
		mocks.total = 12;
		await render();
		expect(document.querySelector('[aria-label="Go to next page"]')).toBeNull();
	});
});
