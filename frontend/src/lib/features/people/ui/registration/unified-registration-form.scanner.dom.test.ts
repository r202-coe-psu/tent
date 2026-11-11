// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { QueryClient } from '@tanstack/svelte-query';
import UnifiedRegistrationFormHarness from './__fixtures__/unified-registration-form-harness.svelte';

vi.mock('svelte-sonner', () => ({
	toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	replaceState: vi.fn(),
	beforeNavigate: vi.fn()
}));

/** A card the desktop scanner client read (issue #1326 `scanner:card-read` detail). */
const card = {
	citizen_id: '1234567890123',
	first_name_th: 'สมหญิง',
	last_name_th: 'ใจดี',
	gender: 'female',
	birth_date: '2535-04-12',
	birth_year_ce: 1992,
	age: 34,
	address_no: '99/1',
	village_no: '3',
	lane: '',
	road: '',
	subdistrict: 'ในเมือง',
	district: 'เมือง',
	province: 'ขอนแก่น',
	scanned_at: '2026-11-11T09:00:00+07:00'
};

let instance: ReturnType<typeof mount> | null = null;

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json([]))
	);
});

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

const values = (suffix: string) =>
	[...document.querySelectorAll<HTMLInputElement>(`input[id$="${suffix}"]`)].map((i) => i.value);

/** Mounted the way the staff walk-in page `/onsite/people/new` mounts it. */
function renderWalkInForm() {
	instance = mount(UnifiedRegistrationFormHarness, {
		target: document.body,
		props: {
			client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
			channel: 'onsite',
			includeVehiclesAssets: true,
			shelterCode: 'SH001',
			onsubmit: vi.fn(),
			onDirtyChange: vi.fn()
		}
	});
	flushSync();
}

const dispatchCardRead = () => {
	const event = new CustomEvent('scanner:card-read', { detail: card, cancelable: true });
	window.dispatchEvent(event);
	return event;
};

describe('UnifiedRegistrationForm — scanner client card read', () => {
	it('acknowledges scanner:card-read and fills the first empty member name and ID number', async () => {
		renderWalkInForm();
		expect(values('first-name')).toEqual(['']);

		const event = dispatchCardRead();
		await tick();
		flushSync();

		expect(event.defaultPrevented).toBe(true);
		expect(values('first-name')).toEqual(['สมหญิง']);
		expect(values('last-name')).toEqual(['ใจดี']);
		expect(values('card-number')).toEqual(['1234567890123']);
	});
});
