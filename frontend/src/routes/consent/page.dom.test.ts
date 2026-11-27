// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import Page from './+page.svelte';
import { ServiceRequestError } from '$lib/api/service';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	submitConsent: vi.fn(),
	logout: vi.fn(),
	markNeedsReauth: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
	statusError: null as Error | null,
	status: {
		name: 'staff01',
		roles: ['shelter:SH001', 'registration_staff'],
		personnel_type: 'staff',
		consent: null
	}
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('svelte-sonner', () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError }
}));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		user: { name: 'staff01', roles: [] },
		logout: mocks.logout,
		markNeedsReauth: mocks.markNeedsReauth
	}
}));
vi.mock('$lib/guards/auth', () => ({
	CONSENT_ROUTE: '/consent',
	LANDING_ROUTE: '/portal',
	LOGIN_ROUTE: '/login',
	resolvePostLoginDestination: () => '/consent'
}));
vi.mock('$lib/features/users', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/users')>('$lib/features/users');
	return {
		...actual,
		fetchAuthStatus: () =>
			mocks.statusError ? Promise.reject(mocks.statusError) : Promise.resolve(mocks.status),
		invalidateAuthStatusRequest: vi.fn(),
		submitConsent: mocks.submitConsent
	};
});

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

async function render() {
	instance = mount(Page, { target: document.body });
	await settle();
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.statusError = null;
	document.body.innerHTML = '';
	mocks.submitConsent.mockResolvedValue({
		ok: true,
		consent: { agreed: true, version: '1.0', agreed_at: new Date().toISOString() }
	});
	mocks.logout.mockResolvedValue(undefined);
});

afterEach(() => {
	if (instance) {
		unmount(instance);
		instance = null;
	}
	document.body.innerHTML = '';
});

describe('/consent +page', () => {
	it('disables the accept button until checkboxes are checked', async () => {
		await render();

		const acceptBtn = document.getElementById('btn-accept-consent') as HTMLButtonElement;
		expect(acceptBtn).not.toBeNull();
		expect(acceptBtn.disabled).toBe(true);

		const ndaCheckbox = document.getElementById('consent-nda') as HTMLInputElement;
		const pdpaCheckbox = document.getElementById('consent-pdpa') as HTMLInputElement;

		ndaCheckbox.checked = true;
		ndaCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();
		expect(acceptBtn.disabled).toBe(true);

		pdpaCheckbox.checked = true;
		pdpaCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();
		expect(acceptBtn.disabled).toBe(false);
	});

	it('submits consent and redirects to portal upon acceptance', async () => {
		await render();

		const ndaCheckbox = document.getElementById('consent-nda') as HTMLInputElement;
		const pdpaCheckbox = document.getElementById('consent-pdpa') as HTMLInputElement;
		const acceptBtn = document.getElementById('btn-accept-consent') as HTMLButtonElement;

		ndaCheckbox.checked = true;
		ndaCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
		pdpaCheckbox.checked = true;
		pdpaCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();

		acceptBtn.click();
		await settle();

		expect(mocks.submitConsent).toHaveBeenCalledWith(true);
		expect(mocks.goto).toHaveBeenCalledWith('/portal');
	});

	it('logs out and redirects to login when declining consent', async () => {
		await render();

		const declineBtn = document.getElementById('btn-decline-consent') as HTMLButtonElement;
		expect(declineBtn).not.toBeNull();

		declineBtn.click();
		await settle();

		expect(mocks.logout).toHaveBeenCalled();
		expect(mocks.goto).toHaveBeenCalledWith('/login');
	});

	it('stays on the page with a toast when the status check fails (#476)', async () => {
		// Going to /login here loops: /login → /portal → requireAuth's known consent gate → /consent.
		mocks.statusError = new Error('BFF down');
		await render();

		expect(mocks.goto).not.toHaveBeenCalled();
		expect(mocks.toastError).toHaveBeenCalledWith('ตรวจสอบสถานะไม่สำเร็จ กรุณาลองใหม่');
	});

	it('sends an expired session (401) to login flagged for re-auth instead of a dead end', async () => {
		// The flag makes redirectIfAuthenticated let /login through, so it cannot loop back here.
		mocks.statusError = new ServiceRequestError('Unauthorized', 401);
		await render();

		expect(mocks.markNeedsReauth).toHaveBeenCalledOnce();
		expect(mocks.goto).toHaveBeenCalledWith('/login');
		expect(mocks.toastError).not.toHaveBeenCalled();
	});
});
