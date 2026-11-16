// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';

vi.mock('svelte-sonner', () => ({
	toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }
}));
vi.mock('$app/navigation', () => ({ beforeNavigate: vi.fn(), goto: vi.fn() }));
vi.mock('$lib/db/shelter', async (importActual) => ({
	...(await importActual<typeof import('$lib/db/shelter')>()),
	resolveShelterCode: () => null
}));
vi.mock('$lib/features/people', async (importActual) => ({
	...(await importActual<typeof import('$lib/features/people')>()),
	useCreateFamilyRegistration: () => ({ mutateAsync: vi.fn(), isPending: false })
}));

const Page = (await import('./+page.svelte')).default;

let instance: ReturnType<typeof mount> | null = null;

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.clearAllMocks();
});

async function render() {
	instance = mount(Page, { target: document.body });
	await tick();
	flushSync();
}

const dispatch = (type: string, detail: unknown = {}) => {
	const event = new CustomEvent(type, { detail, cancelable: true });
	window.dispatchEvent(event);
	return event;
};

describe('/onsite/people/new without an active shelter', () => {
	it('acknowledges scanner:card-reading so the scanner client goes on to send the card', async () => {
		await render();

		expect(dispatch('scanner:card-reading').defaultPrevented).toBe(true);
	});

	it('acknowledges the card and tells staff to pick a shelter first', async () => {
		await render();

		expect(dispatch('scanner:card-read', { citizen_id: '1234567890123' }).defaultPrevented).toBe(
			true
		);
		expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
	});

	it('acknowledges the card photo so the client does not retry it', async () => {
		await render();

		expect(dispatch('scanner:card-photo').defaultPrevented).toBe(true);
	});
});
